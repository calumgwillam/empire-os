# Isolated server persistence foundation

Status: contract, proposed schema, fail-closed server authority/configuration boundaries
and opt-in real PostgreSQL test harness.
The `pg` driver is declared as a development-only dependency; no authenticated adapter,
route handler, activation API, live import or production storage switch is installed.
The migration was executed against the designated disposable PostgreSQL integration
database, which is now nonempty. Never rerun the migration or integration suite against
that instance, and never reset or clear it. Use a separate fresh disposable database for
future real PostgreSQL integration runs. Do not interpret unit tests as database
integration or durability tests.

## Authority and security

The intended authority is authenticated PostgreSQL, not a production IndexedDB phase.
The repository interface in [server-persistence-contract.ts](../app/lib/server-persistence-contract.ts)
contains no client identity, permissions or activation operation. A future server adapter
must obtain identity from a verified session and authorize every operation, including
snapshot reads and idempotency replay. Dataset UUIDs, generation numbers and hashes are
not credentials. Authentication failures must not disclose dataset existence.

[server-persistence-authority.ts](../app/lib/server-persistence-authority.ts) is the
server-owned orchestration boundary: it resolves a principal through an injected verified
session provider, validates the existing request contracts, authorizes each capability,
then constructs a principal-scoped repository. Request bodies and authority-looking
headers never supply the principal or capabilities. The boundary intentionally has no
default session provider, route handler or repository adapter, so it cannot serve as an
active persistence endpoint by itself. Authentication/provider failures fail closed, and
unconfirmed write/import exceptions are reported as unknown rather than as rollback.

[postgres-server-config.ts](../app/lib/postgres-server-config.ts) reads only the dedicated
private `EMPIRE_OS_SERVER_PG_*` variables, requires a complete configuration and enforces
certificate-verifying TLS for any future adapter. It does not connect, log configuration
or fall back to `DATABASE_URL`, `PG*` or `NEXT_PUBLIC_*` variables. The runtime driver and
connection pool remain uninstalled until the authentication/provider and runtime-role
design is approved.

[001_isolated_persistence.sql](./migrations/001_isolated_persistence.sql) creates a separate,
default-denied schema. There are no grants, runtime roles or RLS policies. Forced RLS
without policies denies ordinary roles; migration owners/superusers are not suitable
application connections. No production-active mode is accepted. Applying this script
needs an explicitly designated disposable database and a privileged migration identity.
It is a one-time versioned migration, not an idempotent initialization script; a migration
runner must record success only after COMMIT. A failed migration rolls back its DDL.
No destructive down migration is supplied.

## Identity, tenancy and delegated authorization foundation

[authorization-contract.ts](../app/lib/authorization-contract.ts) defines server authority
records independently of People, pillar labels, project ownership and operational handoffs.
People `accessLevel`, `role`, `authority` and readiness remain organizational descriptions,
not login identity, database permission or proof of ownership. Operating pillars are not
tenants; no current business record is assigned or migrated into a tenant by this work.

[authorization-policy.ts](../app/lib/authorization-policy.ts) is a synchronous, deterministic,
default-deny evaluator. It accepts only principal objects minted by the existing server
session boundary; copied objects, JSON identity claims and People records cannot substitute.
This protects the runtime boundary, not against compromised server code: the injected
session resolver still must independently verify authentication. No provider is installed.

The policy snapshot, tenant selection, dataset mapping and evaluation time MUST be loaded
from trusted server authority state, never from a client policy, tenant header, browser
storage or an earlier decision. Runtime validation detects malformed/ambiguous records,
including sparse arrays at every policy collection level, and returns an explicit denial;
it does not authenticate the provenance of a snapshot. All records in a snapshot belong
to one tenant, and every requested dataset must be explicitly mapped into that tenant.
Owners also require active membership and cannot bypass tenant/dataset isolation.

The approved initial policy:

- Only separately server-provisioned tenant owners can assign existing active roles to
  other active members. Role assignment cannot create roles, edit capability definitions,
  assign ownership or self-escalate. Ownership assignment, transfer and recovery require
  a distinct trusted process, intentionally not exposed here.
- Roles have explicit dataset-specific read/write/import grants using existing persistence
  capability semantics. No executive hierarchy, implicit capability inheritance, pillar
  permission or wildcard tenant grant is defined.
- One-hop delegation requires an active issuer's directly assigned role and exact current
  delegable grant. Delegated authority cannot be redelegated or grant role management,
  ownership, a different dataset or a stronger capability. Even owners need an explicit
  delegable direct grant to issue a delegation.
- Delegations bind issuer and recipient membership revisions and the source role revision.
  They are revocable, are valid only from `issuedAt` until strictly before `expiresAt`, and
  cease to authorize if the source role/grant is revoked, removed, reduced or non-delegable.
  Membership restoration at a newer revision does not resurrect an old delegation.

### Transactional enforcement and audit invariants

The evaluator only assesses requests; it persists neither assignments nor delegations.
A future trusted mutator must validate an assignment/delegation, record the authenticated
actor, bind source/member revisions from locked server rows (not proposed request fields),
and save the grant plus audit evidence atomically. Role definitions are separately managed
server policy, not a role-assignment payload. Expiry uses server time.

Every authority mutation (ownership, membership, role, dataset mapping, delegation or
revocation) must monotonically advance the tenant policy revision without reuse/reset.
Relevant membership/role changes must also advance their revisions, including reactivation.
Retain revoked membership/role tombstones where referenced; ambiguous or dangling assigned
roles fail closed. Exhausted counters require explicit refusal, not rollover.

Sensitive operations MUST load and reevaluate current authorization in the same transaction
and shared locking boundary as the protected action. Revocation and all authority mutators
must participate in that boundary. Recheck expiry at the sensitive execution boundary.
`expectedPolicyRevision` must match the current trusted snapshot; a decision is point-in-time
evidence, not a token, durable permission, proof of a commit or a replacement for database
RLS. This foundation does not close the existing preflight-to-transaction race without an
adapter. Do not cache an allowed result across transactions.

Decisions contain stable reason codes, policy version, observed revision and optional
opaque grant/role/delegation evidence ID. They emit no logs, names, tokens, secrets or
business data. A future protected audit store must capture the minimal actor/action context
and decision atomically; detailed denial codes are internal audit data, not automatically
safe public responses. Existing public persistence unauthorized results remain generic.

Unresolved: identity issuer/subject mapping and account lifecycle, tenant/company structure,
role provisioning and ownership recovery governance, authority storage/RLS and lock design,
maximum delegation lifetime, audit retention and cross-process principal reconstruction.
The principal object is intentionally process-local; workers must independently resolve
verified sessions, never deserialize the brand. No endpoint, adapter, live activation,
SQL migration, browser-data rewrite or dependency installation is introduced.

Identity provider, role/policy mapping, database provider, region, retention and recovery
targets require approval before adding an adapter. Do not authorize by trusting an HTTP
body or a client-set PostgreSQL session setting. A verified server identity may set
transaction-local context only through the trusted adapter; pooled connections must not
retain identity across requests. Credentials must remain server-only. Public clients
must never connect using a migration/service-owner credential.

## Isolated PostgreSQL authorization adapter (unverified)

[002_isolated_authorization.sql](./migrations/002_isolated_authorization.sql) is a
separate one-time versioned migration after 001, intended only for a NEW verified
empty disposable database. It adds a separate schema without changing existing
preparation tables, policies, guards or data. No runtime roles or grants are installed.
Tenant ownership, memberships, roles/grants, delegation source revisions and revocations
are retained together in a versioned JSONB authority document. This deliberately reuses
the validated durable contract rather than creating divergent relational projections.
Dataset-to-tenant mappings are relational, globally unique and checked against each
loaded document. Revisions use bounded bigint counters.

[postgres-authorization-store.ts](../app/lib/postgres-authorization-store.ts) implements
the opt-in transactional store with an injected server-owned connection source. It does
not import the runtime driver, construct a pool, read credentials, choose an identity
provider or install a route. The existing development-only pg dependency is unchanged.
Any future runtime pool must use complete private configuration and verified TLS; it
must not fall back to ambient `PG*` variables. No browser can supply the connection.
Node built-ins keep this module incompatible with browser execution.

The adapter rejects current superuser, BYPASSRLS, CREATEROLE, REPLICATION and table-owner identities.
Connections must additionally have no privilege to assume a privileged role; this
membership/governance invariant is NOT fully checked by the adapter. A dedicated
restricted runtime login remains required before any non-test use.

### PostgreSQL isolation and transaction boundary

Transactions explicitly use READ COMMITTED. The adapter locks the tenant row with
`FOR UPDATE` before loading fresh policy, then locks mapped preparation datasets.
Authority updates use an expected-revision compare-and-swap; SQL triggers require
exact revision advancement and prohibit ownership/dataset changes. Audit and effect
inserts also acquire the same tenant row lock. Revocation and writes therefore have
a proposed single serial order provided all authority writers obey the interface.
No callback retry is performed. Bounded lock/statement/idle timeouts fail closed.

RLS is forced on every new table. Access depends on `current_user` matching a
separately provisioned `role_tenants` binding, not a request-supplied tenant setting.
Bindings are SELECT-only for restricted test application roles. Forging a custom GUC
cannot change the binding. A role bound to multiple tenants can see those tenants;
the final runtime role topology remains intentionally unresolved.

This RLS restricts database tenants, not individual authenticated People/subjects.
Within a permitted tenant, the trusted server policy engine still supplies actor
authorization. A compromised runtime role with direct table privileges could fabricate
actor/decision evidence or invalid nested authority changes: SQL checks are not a
complete reimplementation of the TypeScript policy/transition validators. Restrict
runtime SQL surfaces and review database-side mutation procedures before production.

Allowed writes are stored ONLY in new append-only `preparation_writes`, with exact
UTF-16 bytea values and store revision expectations starting at zero. Existing
`store_values`, transaction receipts and business datasets are not updated. This is
an isolated enforcement probe, NOT the full `ServerPersistenceRepository` adapter.
Generation/authority fences belong to the new immutable dataset mapping, separately
from tenant policy revision. Stage-import operations explicitly roll back as unsupported;
full import generation/source/idempotency/commit-sequence semantics remain unimplemented.

Audit and preparation effects use deferred foreign-key/constraint checks. An effect
requires an allowed matching dataset/write audit; an authority update requires a
matching mutation audit at its new revision. Successful actor/tenant/operation IDs
are unique, and evidence is immutable. A database deferred trigger checks delegated
expiry at constraint execution during COMMIT; audit insertion also checks the observed
and resulting policy revisions against the locked tenant. The adapter requires write
idempotency keys to equal operation IDs rather than exposing two independent replay keys.
A freshly sampled database clock also
drives the executor's final guard. That defines a proposed database completion
linearization point, not an assertion that physical commit acknowledgement precedes
wall-clock expiry. General clock skew/discontinuity remains an operational risk.

Only a `COMMIT` command acknowledgement returns confirmed transaction durability.
All COMMIT errors conservatively return `unknown` and evict the connection, including
errors that PostgreSQL may have definitively rolled back. Pre-COMMIT errors report
rollback only after an explicit ROLLBACK command acknowledgement, including after an
uncertain BEGIN acknowledgement. A failed rollback discards the connection and reports
unknown; a COMMIT error never triggers a rollback-based success claim.
Reconciliation/authorized lookup of unknown
operations is not yet implemented; do not blindly retry with a different ID.

### Separate opt-in integration harness

[authorization.postgres.integration.test.ts](./tests/authorization.postgres.integration.test.ts)
uses ONLY `EMPIRE_OS_AUTH_TEST_PG_HOST`, `PORT`, `DATABASE`, `USER`, `PASSWORD` and
`CONFIRM` (each with the same prefix). It never falls back to the old `EMPIRE_OS_TEST_PG_*`
configuration and rejects matching configured database names. Confirmation follows
the existing `<database>:empire-os-disposable-integration-test-only` format.
Loopback host, database name, connected identity, database comment marker, recovery
status, exclusive harness lock and empty-database checks are reused unchanged.
Both migrations run only after the original empty-database check succeeds.
An independent database name cannot prove freshness; the catalog guard remains essential.

The suite provisions restricted NOLOGIN roles on the verified disposable instance,
then uses separate verified connections with test-only SET ROLE. This is not a
production login model. It retains fixtures and roles, performs no cleanup/reset,
and cannot be rerun on the populated instance. Tests cover atomic preparation writes,
cross-tenant RLS/GUC spoofing, missing audit, duplicate operation IDs, revision ordering,
concurrent revocation, expiry, privileged connections and unchanged original policies.
Run it only after explicitly provisioning and verifying a NEW disposable database:
`npx vitest run database/tests/authorization.postgres.integration.test.ts`.

The adapter unit tests mock database responses; they do NOT verify SQL, RLS, locking,
durability or deferred triggers.
[authorization-migration.test.ts](./tests/authorization-migration.test.ts) adds an offline
syntax preflight using the development-only `libpg-query` PostgreSQL 18 WASM parser.
Run `npx vitest run database/tests/authorization-migration.test.ts` before attempting
the real integration suite. It parses the entire SQL migration, PL/pgSQL functions and
anonymous blocks, and SQL-language function bodies separately. Negative regression
cases prove that both original unparenthesized `CASE` expressions in PL/pgSQL `IF`
conditions fail parsing; parentheses preserve their revision checks while preventing
the inner `THEN` from terminating the condition prematurely.
This executes no SQL and opens no database connection. The parser does not validate
PostgreSQL 16 catalog resolution, privileges, RLS, concurrency or runtime behavior;
real PostgreSQL 16 integration testing remains necessary.
Real PostgreSQL tests have NOT been executed for this
stage. Before relying on this foundation, execute focused unit/type checks, review
the migration and restricted-role grants, then run the separate suite on a new instance.
Review full database-side authority invariants, audit restoration/retention, restricted
role membership, actual concurrent blocking and reconciliation before broader adoption.

## Compatibility and schema

### Durable authority and transactional execution contracts

[durable-authorization-state.ts](../app/lib/durable-authorization-state.ts) adds an
inactive, version-1 durable representation wrapping the existing version-1 authorization
snapshot and retained revocation evidence. It is a storage contract, not a database
implementation: nothing writes this state to PostgreSQL or browser storage.
Validation rejects cross-tenant references, unknown versions, malformed collections,
missing ownership memberships, dangling delegation sources, future source revisions,
and revoked records without corresponding evidence.

Ordinary transitions advance the tenant policy revision exactly once without counter
rollover. Membership/role changes increment their own revisions. Tenant identity,
ownership, dataset mappings and role grant definitions cannot change through this path;
provisioning/recovery requires a separately reviewed trusted mechanism. Memberships,
roles, delegation provenance and revocation evidence cannot be deleted or rewritten.
Reactivation is deliberately not implemented; any future lifecycle design must retain
revocation history and issue new revisions/authority rather than resurrect old grants.
Delegations bind current, directly assigned, delegable source authority, never another
delegation. Revoking a role/member invalidates its delegations through current-state
evaluation rather than rewriting their historical source evidence.

[authorization-transaction-contract.ts](../app/lib/authorization-transaction-contract.ts)
defines a separate opt-in transactional store. Existing `ServerPersistenceRepository`
methods and their confirmed-commit receipts are unchanged. Its `stagePersistence` method
must NOT invoke those independently committing methods: it must stage on the same
connection/transaction as authorization, authority changes and audit evidence. It must
also enforce the existing generation/store revision fences and idempotency rules.
Dataset `authorityRevision` and tenant policy revision are distinct counters; neither is
silently substituted for the other. Read/lookup/replay adapters remain unimplemented and
must independently authorize every access.

[authorization-transaction.ts](../app/lib/authorization-transaction.ts) is an executable
server boundary for validated writes, staged imports, owner role assignments, direct
delegations and owner-only member/role/delegation revocation. It accepts only existing
server-minted principals. Owner membership revocation, ownership transfer, role definition
editing and dataset remapping are not exposed. Requests are detached from caller-owned
objects; authority and time are read inside the transaction, not supplied by the caller.
Denied operations stage no protected effects and require a denial audit before returning
an audited denial. Missing/inconsistent state fails closed without business changes.
Unavailable audit/state infrastructure and failed transactions are never permission.

#### Lock order, concurrency and atomicity

All authority readers/writers participating in sensitive execution must acquire a
tenant-wide exclusive serialization lock BEFORE reading policy and hold it through
COMMIT/ROLLBACK. This includes provisioning, revocation, ownership recovery and future
role-definition writers. Dataset ownership must also be globally unique across tenants,
including provisioning; a single-tenant snapshot cannot establish that global invariant.
Tenant lock precedes dataset/generation/idempotency/store locks;
multi-tenant work is not supported here. Future adapters must use a fixed dataset/store
lock order and bounded lock timeouts, and fail closed on deadlock or unavailable locks.
A PostgreSQL adapter must read fresh committed policy AFTER acquiring the lock; an old
repeatable-read snapshot is not sufficient. Serializable isolation alone without shared
revocation participation does not establish this contract.

If a write acquires the lock first, it may complete before revocation; revocation waits
and only reports success after committing. If revocation commits first, a queued write
must see its newer policy revision and reduced authority. Revocation does not cancel an
already serialized transaction or erase prior outcomes. There is no allowed-result cache
across transactions. Server time is checked after staging and by a required synchronous
pre-commit guard, including after audit insertion; expiry or backwards time rolls back
all staged effects. A real database adapter must define and test the actual expiry
linearization point: the JavaScript guard does NOT prove authority remains unexpired
during network latency or PostgreSQL COMMIT.

Exactly one matching versioned audit row must commit atomically with the operation or
authority transition. Evidence contains actor subject, tenant/dataset, operation kind,
request SHA-256, policy decision/source evidence, checked/completed times and resulting
policy revision. Authority changes additionally retain their validated target/request
context for later reconstruction; business writes retain no raw payload in this audit.
Operation IDs identify requests; decision IDs bind transaction attempt
and operation ID. Retries have new transaction/decision IDs. No raw business payload,
credentials or tokens are stored in authorization evidence. These hashes identify
evidence, not credentials or a cryptographic proof that an adapter honored its contract.
Successful operation IDs must not produce a second effect. A replay/reconciliation
protocol with fresh authorization is a remaining integration requirement.

The store must reject missing/duplicate/mismatched audit evidence, preserve append-only
audit rows, roll back callback/staging/audit failures and report lost COMMIT acknowledgement
as `unknown`, never as confirmed rollback. The executor checks acknowledgement identity
and rejects mismatches as unknown; it cannot inspect or repair a dishonest adapter.
Database acknowledgement proves only the configured store's transaction commitment, not
backup durability, replication guarantees or disaster recovery.

#### Executable model and recovery limits

[authorization-transaction.test.ts](../app/lib/authorization-transaction.test.ts) contains
an isolated copy-on-write transactional model with per-tenant serialization, atomic
publication of staged authority/effects/audits, failure injection and expiry guards.
It exercises both revocation/write orderings, stale decisions, tenant isolation, invalid
delegations, role assignment, audit failures, rollback, acknowledgement loss, source
revocation, counter exhaustion and provenance/tombstone preservation. Its result explicitly
says `test-model-only`. The model is not a full persistence-protocol implementation:
it checks representative dataset fences but does not implement all store conflict,
import generation, source durability or database idempotency semantics.

No actual transactional database enforcement is implemented or verified by these tests.
No new SQL migration, RLS policy, runtime connection, provider, endpoint or live writer
is installed. The existing populated disposable integration database is untouched.
The existing `dataset_access` table is NOT automatically authoritative for this tenant
model and is not a fallback if authority state is missing.

Recovery must reconcile unknown outcomes by durable operation/transaction identifiers
under fresh authorization; never blindly submit a different request. Restore authority,
revocation tombstones, audit and business effects as one consistent recovery point.
Do not reset revision counters or restore old allowed decisions. Counter/recovery epoch
handling, audit retention/access policies, owner recovery, identity lifecycle and
database-side constraints remain unresolved. Recommended next step: review these
interfaces and design a separate versioned authority migration plus a transaction/RLS
adapter, then verify against a NEW explicitly designated empty disposable database.
Never reuse or reset the existing populated integration instance.

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
