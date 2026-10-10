# Isolated server persistence foundation

Status: contract, proposed schema and opt-in real PostgreSQL test harness.
The `pg` driver is declared as a development-only dependency; no authenticated adapter,
endpoint, activation API, live import or production storage switch is installed.
The migration has not been executed against PostgreSQL. Do not interpret unit tests as
database integration or durability tests.

## Authority and security

The intended authority is authenticated PostgreSQL, not a production IndexedDB phase.
The repository interface in [server-persistence-contract.ts](../app/lib/server-persistence-contract.ts)
contains no client identity, permissions or activation operation. A future server adapter
must obtain identity from a verified session and authorize every operation, including
snapshot reads and idempotency replay. Dataset UUIDs, generation numbers and hashes are
not credentials. Authentication failures must not disclose dataset existence.

[001_isolated_persistence.sql](./migrations/001_isolated_persistence.sql) creates a separate,
default-denied schema. There are no grants, runtime roles or RLS policies. Forced RLS
without policies denies ordinary roles; migration owners/superusers are not suitable
application connections. No production-active mode is accepted. Applying this script
needs an explicitly designated disposable database and a privileged migration identity.
It is a one-time versioned migration, not an idempotent initialization script; a migration
runner must record success only after COMMIT. A failed migration rolls back its DDL.
No destructive down migration is supplied.

Identity provider, role/policy mapping, database provider, region, retention and recovery
targets require approval before adding an adapter. Do not authorize by trusting an HTTP
body or a client-set PostgreSQL session setting. A verified server identity may set
transaction-local context only through the trusted adapter; pooled connections must not
retain identity across requests. Credentials must remain server-only. Public clients
must never connect using a migration/service-owner credential.

## Compatibility and schema

- `datasets`: protocol, current generation, authority revision/mode and commit sequence.
- `dataset_access`: server-managed read/write/import capabilities; no automatic grant.
- `generations`: isolated preparing/verified/recovery-required import generations.
- `store_values`: generation-scoped, revisioned values for the 21-key registry.
- `import_sources` / `import_source_values`: immutable exact source evidence.
- `transactions`, `transaction_reads`, `transaction_stores`: append-only actor,
  read-dependency, revision and before/after evidence.
- `idempotency_results`: immutable request digest and replay result bound to principal,
  dataset, request generation and idempotency key. Operation is checked too; reusing a
  key for another operation is a conflict.

Raw values are nullable `bytea`, not JSONB or PostgreSQL text. The codec preserves every
JavaScript UTF-16 code unit, including NUL and lone surrogates. SQL NULL represents
localStorage absence; empty bytea represents an empty string. Null writes retain rows
and advance revision, avoiding deletion/recreation ABA. Numeric counters are constrained
to JavaScript's safe integer range; an adapter must validate PostgreSQL bigint conversions
and fail on exhaustion rather than reset a counter.

The source digest is SHA-256 over the existing registry-ordered `backupStorageContent`
serialization, encoded as UTF-8. This serialization escapes lone surrogates; hashing raw
strings with TextEncoder instead would lose information. `canonical_source` stores those
serialized bytes. Raw values are never normalized or reserialized.
Import generation and idempotency metadata are outside the unchanged version-1 backup
format. Backup exports must use a consistent database snapshot and emit all 21 exact
strings/nulls. Recovery snapshots and external-backup receipts are separate legacy
evidence, not silently included in or discarded by a business-data import.

The SQL enforces key membership, counter bounds, null semantics, append-only evidence,
store update revision increments and absence of a live mode. It does **not yet enforce**
21-row completeness, source-hash recomputation, verified-generation immutability,
authority revision transitions, full receipt correctness or membership-based policies.
Those require the reviewed adapter/constraints and actual database tests. SQL constraints
alone do not implement the repository transaction protocol.

## Required adapter transaction algorithm

All participating mutators, authority transitions and import preparation must use the
same per-dataset database lock. Initially use a dataset-row lock to favour correctness
over speculative concurrent throughput. No network, identity-provider or client work
may be awaited while holding locks.

### Snapshot

Authenticate first. In one read-only REPEATABLE READ transaction, read authorization,
dataset authority, commit sequence and all 21 generation-scoped rows. Validate complete
coverage and raw decoding before returning. Do not synthesize missing rows as empty
data. A snapshot is point-in-time evidence, not continuing authority to write.

### Atomic write

1. Validate/copy the batch and recompute `writeBatchContent` SHA-256 on the server.
2. Start a READ COMMITTED transaction with `synchronous_commit = on`; lock the dataset row. All
   authority changes and permission revocations must take that lock as well.
3. Resolve and check current server-managed access. Reject unsupported protocols.
4. Look up the principal-scoped idempotency key **before checking stale store/fence
   revisions**. An exact previously committed request returns its original receipt
   after authorization, even if revisions/generation have since advanced. Same key
   plus different digest/operation is a conflict, never another write.
5. Require matching generation and authority revision and preparation-only authority.
   Read all 21 values under the lock; check every expected read and write revision.
   Validate the full candidate snapshot's structures and relationships before writing,
   using `prepareWriteCandidate`. Its pure checks cannot themselves acquire locks.
6. Update every affected row and advance its revision once, including same-value/null
   writes. Advance the dataset commit sequence. Persist read dependencies, before/after
   values, trusted actor, transaction ID and the complete replay result in this same
   transaction. Verify affected-row counts and receipt revisions. Any failure aborts
   the entire operation, including idempotency and audit records.
7. Await successful database COMMIT before returning `committed`. A driver error during
   COMMIT can mean **unknown outcome**, not proven rollback. Return only sanitized
   explicit errors; never leak credentials or raw operational data in error responses.

Confirmed COMMIT means the configured database WAL guarantee, not an independent backup
or proof of cross-region replica durability. Replication/failover settings and tested
restoration remain separate operational decisions.

The first server integration must group business changes and required audit evidence
at command boundaries. Replacing existing individual autosave effects with remote calls
does not make capture conversion, delivery or strategic-review workflows atomic.

### Lost response / retry

A client keeps the exact frozen request and idempotency key until resolved. Network
failure after submission means unknown outcome. Retry the **same** request/key, or
look up its digest under the same authenticated principal. The row lock makes a retry
wait for an in-flight operation; committed idempotency evidence causes result replay,
not another revision increment. A lookup with no visible result is `unresolved`, not
proof of failure. Never generate a new key to retry an unknown commit.

Replay records must not expire in this foundation. Future compaction must retain durable
tombstones/digests and reject old keys, not make an old operation executable again.
Receipt shape validation is not independent proof of a server COMMIT; only a trusted
authenticated adapter receiving database confirmation may produce one.

### Import preparation

`prepareServerImport` reads and validates all 21 raw values, checks relationship
integrity, hashes immutable copied values, then checks for source changes after hashing.
It cannot prevent legacy changes after the final reread. `verifyServerImportPlan`
independently repeats validation/hash checks; a claimed hash is not trusted.

The future `stageImport` implementation must validate its envelope, recompute the
`stageImportContent` request digest, authorize import, take the dataset lock,
check idempotency and expected authority, and allocate a strictly newer generation.
Save source evidence, all 21 copied values, verification and replay metadata atomically.
It must not change the dataset's current generation or activate storage. Different
sources allocate distinct generations; they never overwrite prior source evidence.
Existing same-digest evidence must be compared byte-for-byte before reuse. Conflicting
idempotency reuse fails. Failed preparation leaves the prior generation/evidence intact;
committed preparation is safely replayable. There is no source-completeness or cutover
guarantee, even when every destination row verifies.

## Required real PostgreSQL validation

Before adapter approval, exercise migrations on the selected supported PostgreSQL
version, with separate migration/runtime identities and real concurrent connections:

- Complete consistent snapshots during writes and authority changes.
- Concurrent stale readers/writers, permission revocation and authority fencing.
- Atomic multi-store update/audit/idempotency rollback after failures at each step.
- Lost COMMIT response, duplicate retry, replay after generation advance and reused keys.
- All 21 values, empty/null, NUL, surrogate and large-value bytea round trips.
- Exact backup/import, conflicting sources, interrupted import and safe reopening/retry.
- Registry parity with TypeScript, safe bigint conversion and counter exhaustion.
- Default RLS denial, unauthenticated requests, cross-dataset/actor isolation and pooled
  connection identity leakage.
- Durable recovery into a fresh database, backup retention and documented operator access.

No local PostgreSQL service/configuration was established for this increment, and no
terminal probes were run. Database availability and all database guarantees above remain
unverified. The unit suites exercise only pure contracts, raw codecs, candidate/import
validation and registry parity; the registry test reads SQL as text, not as executable SQL.

## Next approval boundary

Approve the server authentication provider and minimal identity/policy mapping before
adding a production driver/adapter or creating runtime grants.
Then implement the real adapter and database tests above without adding a live endpoint
or importing operational data. Online-confirmed writes are the proposed initial client
model; offline synchronization and dual authoritative writes are out of scope.
Whole-store bytea rows and before/after audit copies are a compatibility bridge, not the
final normalized business schema. Their storage growth, retention and request-size
limits must be measured and approved before production use.

## Disposable PostgreSQL integration harness (macOS)

The harness uses real PostgreSQL through the development-only `pg` driver.
No in-memory PostgreSQL substitute is supplied. No configured connection means a
clearly labelled skipped integration suite, not successful database verification.
Partial/unsafe configuration is a failure, not a skip. Ordinary `npm test` also discovers
these tests; it skips them when configuration is absent.

Safety checks before migration/fixtures:

- Only dedicated `EMPIRE_OS_TEST_PG_*` variables are read. No `DATABASE_URL`, `PGHOST`,
  `PGDATABASE`, `.env.local` or production config fallback.
- Host must be literal `127.0.0.1` or `::1`, with an explicit port and user.
- Database must match `empire_os_test_[a-z0-9_]+`; explicit confirmation must match.
- The connection independently checks database/user, primary-server status and the
  exact database comment `empire-os-disposable-integration-test-only`.
- The migration requires an empty database. A session advisory lock rejects concurrent
  harness runs. Existing schemas/evidence are never dropped/reset/overwritten.
- Connection, statement, lock and idle-transaction timeouts bound failed runs.
- No production reads, imports, authentication endpoint or activation runs.

These guards prevent ordinary accidental targeting; they cannot prove that a deliberately
mislabelled database has no valuable data. Use a separate disposable **local cluster**, not
a port-forward to a remote production server. The harness requires a superuser only in
that disposable cluster to seed forced-RLS tables and create transactional NOLOGIN test
roles. Never supply a production or shared-instance superuser.

Most fixtures and test grants/roles roll back. The concurrent-connection tests retain
small synthetic committed datasets for verification; the migrated schema also remains.
Use a fresh empty disposable database for each run. Do not point later runs at retained
data and expect an automatic reset. Test-only principals are created inside transactions
and rolled back, not installed as production roles.

### Install dependencies and run without a database

From `apps/web`:

```sh
npm install
npm test -- database/tests/disposable-config.test.ts
npm run test:postgres -- --reporter=verbose
npx tsc --noEmit
```

With no dedicated variables, `test:postgres` explicitly reports **NOT VERIFIED** and
skipped tests. `npm install` regenerates the dependency lockfile; no manual lockfile
editing is required. No installer or infrastructure is automatically invoked by tests.

### Provision a cost-free disposable local instance

PostgreSQL/Docker/Homebrew are not installed by this project. Manually obtain PostgreSQL
for macOS (for example Postgres.app from its official distribution). The following
commands assume its command-line tools are available at the shown path. Do not use an
existing shared production cluster. Nothing here provisions a cloud resource.

In a fresh terminal:

```sh
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"
export TEST_CLUSTER="$(mktemp -d /tmp/empire-os-pg-test.XXXXXX)"
initdb -D "$TEST_CLUSTER" --username=empire_os_test_owner \
  --auth-local=trust --auth-host=scram-sha-256 --pwprompt
pg_ctl -D "$TEST_CLUSTER" -l "$TEST_CLUSTER/server.log" \
  -o "-h 127.0.0.1 -p 55432" start
```

Choose a test-only password at the prompt. Port 55432 must be free; do not terminate
another process to free it. If unavailable, select another unused local port consistently.

In that same terminal, enter the chosen test-only password without putting it in shell
history (the `read -s` syntax below is for macOS zsh):

```sh
export EMPIRE_OS_TEST_PG_HOST=127.0.0.1
export EMPIRE_OS_TEST_PG_PORT=55432
export EMPIRE_OS_TEST_PG_USER=empire_os_test_owner
export EMPIRE_OS_TEST_PG_DATABASE=empire_os_test_integration
export EMPIRE_OS_TEST_PG_CONFIRM="empire_os_test_integration:empire-os-disposable-integration-test-only"
read -rs "EMPIRE_OS_TEST_PG_PASSWORD?Disposable test password: "; echo
export EMPIRE_OS_TEST_PG_PASSWORD

PGPASSWORD="$EMPIRE_OS_TEST_PG_PASSWORD" createdb --host=127.0.0.1 --port=55432 \
  --username=empire_os_test_owner empire_os_test_integration
PGPASSWORD="$EMPIRE_OS_TEST_PG_PASSWORD" psql --host=127.0.0.1 --port=55432 \
  --username=empire_os_test_owner --dbname=empire_os_test_integration --set=ON_ERROR_STOP=1 \
  --command="COMMENT ON DATABASE empire_os_test_integration IS 'empire-os-disposable-integration-test-only'"

cd /Users/admin/empire-os/apps/web
npm run test:postgres -- --reporter=verbose
```

This uses individual environment fields, not a committed connection string. Do not save
passwords in source, logs or shared shell transcripts.

After a run, stop only the cluster you created:

```sh
pg_ctl -D "$TEST_CLUSTER" stop
unset EMPIRE_OS_TEST_PG_PASSWORD
```

The local cluster directory remains for inspection. For another clean run, provision
a fresh cluster/database using the same procedure; no recursive cleanup command is
provided. PostgreSQL does not incur infrastructure charges when run locally.

### Scope of verification

The integration suite executes the actual migration and checks table/registry coverage,
constraint behaviour, RLS denial, negative isolation of two principals, principal-scoped
idempotency uniqueness, bytea/code-unit round trips, rollback, competing updates and
repeatable-read snapshots. The negative principal tests do **not** verify positive access
policies, login authentication, a server repository adapter or idempotency result replay.

Remaining requirements include adapter-level authorization and permission revocation,
atomic audit/idempotency workflows, lost COMMIT-response handling, import generations,
real backup restoration and production durability configuration. A successful schema
test run is not production-readiness or disaster-recovery certification.
