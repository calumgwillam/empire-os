# Isolated server persistence foundation

Status: server-only durable repository and import-staging implementation, fail-closed
authority/configuration boundaries, and opt-in real PostgreSQL test harness. Import SQL
is an inactive candidate in [006_stage_import_candidate.sql](./design/sql/006_stage_import_candidate.sql);
it has not been applied or granted to any runtime role. The `pg` driver is development-only;
no authenticated route, activation API, live import or production storage switch is installed.
The migration was executed against the designated disposable PostgreSQL integration
database, which is now nonempty. Never rerun the migration or integration suite against
that instance, and never reset or clear it. Use a separate fresh disposable database for
future real PostgreSQL integration runs. Do not interpret unit tests as database
integration or durability tests.

## Phase 8 Person authority-source contract (inactive)

[The server-only source boundary](../app/lib/trusted-person-authority-source.ts)
explicitly reports `unavailable/not-submitted`. Trusted multi-user snapshot, write
and reconciliation entry points refuse execution before selecting any source or
repository while this dependency remains unresolved. There is no approval flag,
issuer, route, runtime writer, source loader or new eligibility registry.

Existing canonical models remain distinct:

- Clerk establishes authentication, not organisational eligibility.
- The contribution identity registry establishes the current subject-to-Person
  binding, including revocation/reassignment history.
- The Phase 7 `person_authority_events` SQL candidate defines immutable minimal
  eligibility/audit evidence, not an operational People directory. It does **not**
  implement or approve the verifier that establishes Person truth or the issuer.
- Durable tenant authority supplies membership, dataset scope and permissions.
- Browser-local People are business information, never login eligibility evidence.

The candidate evidence validator reuses these models and revision counters. It
checks scope, binding origin, active Person and membership, issuer subject, audit
metadata, current checkpoints and existing operation policy. Its `valid` result
means internal consistency only, not trusted provenance, source approval or an
execution grant. Fabricated matching evidence cannot open the source interlock.
Current checkpoints and founder identity must eventually come from independent
server-owned configuration/locked reads, never from request data. Timestamps or
caller-provided revision numbers alone cannot establish freshness.

Founder-controlled issuance is a **proposal awaiting approval**, not activated
policy. No generic identity-administrator grant or Person `kind` label approves
eligibility issuance. Before a future issuer is implemented, approve the canonical
Person verifier, founder identity/rotation and recovery rules, and how source
evidence is independently verified. Issuance/inactivation must use the existing
append-only event contract with operation ID, expected next revision, issuer,
source reference and evidence hash. Binding revocation/reassignment must reuse the
existing identity event mechanism and its approval/audit requirements, not a
parallel eligibility-to-subject map. An uncertain commit requires exact-event
reconciliation, never blind resubmission.

Future integration must hold compatible registry-before-tenant locks while reading
the latest eligibility event, current binding and durable policy, through operation
completion. It must reject stale evidence at that boundary; this pure validator
cannot prove lock ownership or source authenticity. Existing member/provisioning
release gates, migration blockers, founder-only UI and browser persistence remain
unchanged. Offline tests prove validation and refusal behavior, not PostgreSQL
concurrency, live issuer provenance or production readiness.

### Phase 8 eligibility provenance contract (inactive)

[Eligibility provenance](../app/lib/person-eligibility-provenance.ts) separates
current authenticated founder identity from historical eligibility issuance. Its
readiness inspection resolves a Clerk session into the existing process-branded
principal and checks the same server-side founder configuration as the dashboard.
Matching `founderSubject` strings, request headers, Person labels and generic
identity-administrator capabilities cannot substitute for that authentication.
This check does not grant issuance, reassignment, recovery or employee access.

There is still **no independently approved issuer source**. Even the authenticated
founder receives `unavailable/not-submitted`, listing the missing issuer authority/
revocation source, verified Person source reference/digest, and locked latest-event/
exact-event reconciliation boundary. No verifier callback, persistence operation,
source fallback, route, grant, approval switch or independently writable registry
is installed.

The separate candidate validator checks consistency, not authenticated historical
provenance. It requires an authenticated configured founder plus matching issuer
status/revision, Person/tenant/current revision checkpoint, and the **entire**
existing immutable eligibility event: issuer, operation ID, status/kind, source
reference, evidence digest and recorded time included. A conflict in any event
field is denied even if operation ID or digest matches. Exact inactive events can
be compared for reconciliation; that does not establish active member eligibility.
The returned copy is immutable and is neither a COMMIT receipt nor an execution
grant. Matching fabricated envelopes can pass consistency checks but can never
open operational readiness. Hash format is not verification of source contents.

Future approved composition must derive all checkpoints and issuer observations
independently of browser/request claims, verify source content against the recorded
digest, observe revocation/current revisions under compatible registry-before-tenant
locks, and reconcile the exact original event after uncertain COMMIT without
resubmission. Current founder authentication cannot retroactively authenticate old
events. Founder rotation/recovery and historical issuer validity need an approved
policy; this foundation denies unrecognised founders and delegated issuers rather
than modifying existing recovery or delegated-administration semantics. No business
execution gate, existing append-only SQL contract or browser storage is changed.

### Phase 8 transaction-owned eligibility verification read (inactive)

The existing [member SQL candidate](./design/sql/member-authority-candidate.sql)
now returns `eligibility_event` alongside its locked member/policy observation.
It projects the latest existing `person_authority_events` row's Person, tenant,
revision, status/kind, operation ID, issuer, source reference, digest and recorded
time. It creates no additional tables, issuer records, grants or write APIs.
The current binding's historical event must also belong to the requested tenant.

[The existing member adapter](../app/lib/postgres-member-authority.ts) consumes
that event on the same restricted lease and bounded transaction as binding,
membership and dataset/read permission checks. It rejects missing audit fields
(including older SQL result shapes), cross-tenant/Person mismatches, inconsistent
status/kind/revision and future events. The original registry-before-tenant lock
order and compatible writer fences remain in force. Completion refreshes the
database clock and re-evaluates permission before the provenance boundary.

**Historical issuer authenticity is not established by these database structures.**
The identity candidate's `approved_operations` authorizes binding administration;
there is no eligibility-event foreign key or exact issuance approval connecting it
to Person eligibility. Reusing an operation ID, issuer string, hash, schema-owner
write, transaction ID or current founder session would not repair that absence.
No such inference is made.

The adapter now calls the real stored-event provenance refusal **before rollback,
while the same locks remain held**. It returns `unavailable/not-submitted`, never
an `observed` identity, because independent historical issuer authority and source
verification remain unimplemented. Failed rollback/disposal replaces that result
with `unavailable/unknown`. No audit evidence or Person observation is disclosed
on refusal; no business query, write, COMMIT, retry or second connection is added.
Readiness in the dormant business adapter explicitly lists historical issuer
provenance as a missing dependency.

This is measurable integration of the existing read path, **not a complete or
approved authority chain**. There is no newly trusted source. Existing synthetic
tests that model a future successful observation substitute the provenance gate
explicitly; separate tests retain the real gate and prove refusal even when the
member release is substituted as approved. Offline SQL/parser tests do not prove
PostgreSQL locking or permissions for this changed artifact.

The candidate result shape changed; this is not an upgrade migration. Any future
real verification requires separately approved fresh disposable provisioning and
exact-artifact tests. The retired Phase 7 database must never be rerun or altered.
The opt-in test's expected result columns have been updated, but it has not been
executed for this change. All production/member/provisioning/business gates remain
closed, and the 21 browser-local business stores remain untouched.

### Founder eligibility decision preparation (inactive)

[The existing provenance module](../app/lib/person-eligibility-provenance.ts) now
contains a candidate decision planner and a permanently refusing submission
boundary. The latter resolves Clerk into a branded principal and checks the
configured founder, but always returns `unavailable/not-submitted` for a well-formed
founder request. It accepts no source, writer, repository or approval callback.
There is no route, issuer record, database operation or production switch.

The pure candidate planner models only initial ordinary-Person issuance and
append-only inactivation. It reuses the binding registry, durable tenant policy,
IdentityPerson and existing eligibility event shape. It checks:

- Authenticated configured founder, active tenant ownership/membership, current
  founder binding and active founder Person/eligibility observations.
- Target subject's exact current binding to the specified Person in that tenant,
  retained membership, and active Person/membership for initial issuance.
- Matching registry, binding, policy and Person revision fences; operation reuse
  against the supplied tenant operation list and identity history; counter bounds.
- Explicit issue/revoke decision, operation ID, immutable source reference/digest,
  and a sampled observation time; authentication expiry uses the established
  five-minute identity reauthentication window.
- No self-approval, protected founder/system-owner targeting, or target with any
  identity-administrator grant history. No repeat issuance, automatic reactivation,
  founder bootstrap, identity reassignment or recovery through this path.

These are **candidate consistency checks, not independently verified facts**.
Observation fields, including authentication time, operation-history completeness,
People truth and issuer eligibility authenticity, cannot be accepted from a request
or localStorage. A caller can fabricate matching observations and source hashes;
that cannot open submission or stored-event provenance verification. The immutable
candidate carries both binding IDs, revision fences, issuer Person revision and
expiry; it is not a signed authorization, durable receipt or executable plan.
No passwords, identity documents or source contents are accepted or persisted.

For eventual transactional issuance, an approved adapter must independently load
and verify those facts under the existing registry-before-tenant locks, retain
locks through append/COMMIT, resample time, enforce issuer revocation, and persist
authenticated decision evidence tied to the exact event. The existing SQL trigger
remains authoritative for append revision and database recorded time; a preview
timestamp is not a substitute. After uncertain COMMIT, reconcile the original
operation and exact database event using its recorded timestamp; do not rerun a
planner at a new time and resubmit. The existing exact-event candidate comparison
is not proof that reconciliation occurred.

Founder recovery invariants are deliberately restrictive: missing configuration,
revoked/unbound/inactive founder observations and founder rotation fail closed;
no environment configuration change or generic admin capability creates historical
issuer proof. Protected identities and previously inactive eligibility require a
separately approved independent recovery/reauthorization process, preserving
existing fresh-approval and identity-reassignment safeguards. The current planner
also refuses revocation if a target binding is already absent; an independently
authorized administrative recovery path is needed for that case.

Before enabling issuance, approve the trusted Person/source verifier, authenticated
decision persistence and runtime role contract, historical issuer revocation rules,
founder bootstrap/rotation/recovery, and whether/when delegated issuance is allowed.
No new trust source is invented here. All existing member, provenance, provisioning
and business execution gates stay closed; no SQL candidate or migration changed.

### Durable eligibility decision ledger foundation (unapplied and disabled)

[The decision ledger SQL candidate](./design/sql/eligibility-decision-ledger-candidate.sql)
defines append-only decision evidence referencing the **existing** Person eligibility
events for both subject and issuer. It is not a People registry, migration entry
point or an installed API. No application or integration harness installs it.

The versioned [decision record contract](../app/lib/person-eligibility-provenance.ts)
binds the exact event (tenant, Person, revision, operation, issuer, status, recorded
time and source evidence) to subject and issuer binding IDs, issuer Person revision,
registry/binding/policy/membership revisions, authentication time/expiry and opaque
authentication/issuer-authority references. References must eventually identify
independently verified server records, never bearer credentials or client claims.
Their presence and format alone prove nothing.

The SQL candidate has tenant-scoped operation uniqueness and one decision per
Person event revision, foreign keys, owner-only forced RLS, immutable update/delete
and truncate guards. Its insertion fence uses registry-before-tenant locks, checks
current bindings, membership revisions, tenant ownership and subsequent Person
events, and requires the exact referenced eligibility event in the same database
transaction. Recorded time is derived from that existing database-stamped event.
It provides no runtime grants, issuer API, recovery shortcut or bootstrap data.

**All INSERTs deliberately raise an exception after preparatory checks.** The
authenticated writer/source is missing; this candidate must not accumulate
owner-asserted claims and relabel them authenticated decisions. A future writer
must atomically append event and decision, with deferred completeness enforcement
so no eligible event can commit without its authenticated decision. That reverse
event-to-decision requirement is not installed by this candidate. Existing
eligibility events remain legacy claims; no historical backfill is authorized.

The candidate reconciliation validator compares every record and event field,
ignoring object-key order but never refreshing timestamps or accepting matching
operation IDs alone. A `consistent` result does not prove a COMMIT or authenticity.
`verifyStoredEligibilityDecision` refuses malformed records and returns explicit
`unavailable/not-submitted` for every well-formed record because there is no approved
independent historical verifier or storage reader. The member adapter's real
provenance refusal remains unchanged. Forged matching records cannot open a gate.

Existing trust anchors: Clerk server authentication, configured current founder,
binding/revocation history, durable tenant policy and transaction-bound Person
event reads. Missing anchors: durable recent authentication evidence tied to the
exact decision, independent issuer authority at issuance and current revocation
policy, verified Person/source content, and issuer bootstrap/rotation/recovery.
No table, reference, xid, source hash, current founder session or caller-provided
signature can substitute for these.

Next dependency: approve and implement that server authentication-to-decision
capture/verification boundary and its transaction/recovery contract, then prove
exact artifacts on separately approved fresh infrastructure. Current tests are
offline parsers and synthetic consistency checks, not database constraint,
concurrency, durability or independent authentication verification. All consumed
PostgreSQL environments remain off-limits; no production gates are opened.

## Individual contribution domain (inactive)

[Individual contribution Phase 1](./design/individual-contribution.md) defines a
separate, non-executing domain foundation for person-linked work, append-only
corrections/disputes, unique shared outcomes, independently reviewed allocations,
role expectations and evidence-aware reporting. It supplies no adapter, production
table, localStorage schema, monitoring, UI activation or automatic entitlement changes.
The design documents server-enforced access, privacy, concurrency and durable evidence
requirements that must be satisfied before activation.

[Contribution Intelligence Phase 2](./design/contribution-intelligence.md) adds pure
person-period measurements, explicit individual commitment/deadline observations,
evidence-aware comparisons and sustained recorded trends. It reuses Phase 1
unique-outcome and reviewed-attribution rules, establishes no actual-underperformance
verdict or automatic reward, and activates no collection, storage or dashboard.
The design lists remaining durable agreement, privacy, authorisation and concurrency
prerequisites.

[Contribution Intelligence Phase 3](./design/contribution-dashboard.md) adds an
inactive founder read model and minimised person-specific projection. Person-wide
Phase 2 analysis remains unchanged; dimension metrics derive from explicit Phase 1
record associations, preserving spanning, unallocated and disputed attribution.
No UI, storage or automatic reward/profit-sharing calculation is activated.

[Contribution Intelligence Phase 4](./design/contribution-collection.md) adds an
inactive authenticated collection/review preview foundation: explicit subject/Person
bindings and scoped purposes, independent review, separately approved corrections,
operational evidence candidates and idempotency reconciliation modelling. No loader,
writer, endpoint or migration is installed. Durable binding/policy and correction/
agreement provenance remain deployment blockers.

[Contribution Intelligence Phase 5](./design/contribution-identity.md) adds a
server-only identity-administration policy model, a global one-to-one binding history
contract, organisation-scoped delegated identity capabilities and separate
personal/founder-comparative view purposes. Reassignment previews require independent
fresh approval and carry all affected membership fences; no role grants or historical
contribution attribution are transferred. The PostgreSQL schema is an inactive design
candidate only: there is no writer, verifier, runtime grant, migration or live binding.
The People records still lack an authoritative PostgreSQL source, so identity
activation and durable contribution collection remain blocked.

[Contribution Intelligence Phase 6](./design/contribution-identity-persistence.md)
adds a disabled restricted identity repository, request-bound trusted-issuer records,
an alternative transactional SQL candidate and offline/disposable integration tests.
It reuses the Phase 5 planner and existing membership/audit model. No candidate has
been applied and no issuer, verifier, authoritative People loader, session worker,
endpoint or live identity management is activated. See the design for coarse-lock
tradeoffs, uncertain-commit handling, recovery and exact activation prerequisites.

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

Direct INSERT/UPDATE/DELETE/TRUNCATE on every authorization table is rejected with
SQLSTATE 42501 for any role other than the schema owner, even after accidental grants.
Row-level guards fire only for rows RLS exposes; `role_tenants` has no runtime UPDATE or
DELETE policy, so such statements were previously filtered silently to zero rows (no
mutation, but no error). A statement-level guard now rejects them loudly regardless of
RLS visibility. The first real run of the suite (database `empire_os_test_authorization_v3`)
used the earlier migration text and is populated; it must not be reused for verification.

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
from tenant policy revision. Candidate 006 extends the audit allow-list and deferred
write check to support atomic first-import staging; it does not add a generation workflow
or permit production activation.

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
Resolve `unknown` (or a failed retry of a possibly-committed request) with authorized
reconciliation, below; never blindly retry with a different ID.

### Authorized operation reconciliation (migration 003, unverified on PostgreSQL)

[003_authorization_reconciliation.sql](./migrations/003_authorization_reconciliation.sql)
is additive and versioned: it adds only `empire_os_authorization.lookup_operation(text,text)`
(SECURITY DEFINER, `search_path = pg_catalog`, `REVOKE ALL ... FROM PUBLIC`). It creates no
table, grant, role, policy or trigger, changes no data and leaves 001/002 untouched. It
refuses to run without 002, twice, or as anyone other than the authorization schema owner
(the `trusted_api` policies are bound to that owner). Runtime roles need an explicit
`GRANT EXECUTE` on it, as for `lock_authority`/`apply_operation`.

`lookup_operation` binds the actor through `runtime_subject` (database role binding,
READ COMMITTED and unsafe-identity checks), then takes the SAME tenant row lock
(`FOR UPDATE`) as `lock_authority`/`apply_operation`, so any in-flight tenant transaction,
including one whose COMMIT acknowledgement was lost, has finished before audits are read.
It returns the locked authority state and, only while the tenant and the actor's membership
are active, that actor's audit metadata for that operation ID: transaction ID, decision ID,
request SHA-256, allowed flag, resulting revision and evidence. It never returns
`applied_request`, raw business values, other actors' audits or other operations.
Runtime roles still cannot SELECT the audit table directly.

[postgres-authorization-store.ts](../app/lib/postgres-authorization-store.ts)
`createPostgresOperationReconciliationStore` runs BEGIN READ COMMITTED, the same
timeouts and unsafe-identity check as `runLocked`, one `lookup_operation` call, then
ALWAYS `ROLLBACK`: it never commits. Any error or unconfirmed rollback returns
`unavailable`; an unconfirmed rollback also destroys the connection.
[authorization-reconciliation.ts](../app/lib/authorization-reconciliation.ts)
`createOperationReconciler(store).reconcile(principal, originalRequest)` requires a
server-minted principal and the exact original request. It recomputes the request hash
itself, revalidates authority state, the store-bound actor, independent authorization and
every record (exact fields, evidence consistency, decision-ID derivation, at most one
allowed record, no future revisions), and returns:

- `executed`: this exact request committed once; reports its transaction/decision IDs.
- `not-executed`: no allowed audit had committed while the tenant lock was held; only the
  SAME request with the SAME operation ID may be retried (still guarded by
  `successful_operation_once`).
- `conflict`: the operation ID was used for a different request.
- `unauthorized` (`forbidden` for revoked members, suspended tenants or actor mismatch),
  `invalid-request` or `unavailable` (fail closed, sanitized).

Reconciliation requires current active membership, not the original capability, so an
actor can learn the outcome of its own operation after a delegation expires. Lookups are
read-only and are not themselves audited. A `not-executed` answer is definitive for
transactions that had begun before the lookup acquired the lock. A duplicate submission
that is still connecting may commit later; the unique allowed-operation index still
prevents a second effect. No route, provider or live caller uses reconciliation yet.

### Authorized dataset snapshot and durable repository (migration 004, unverified on PostgreSQL)

[004_authorized_dataset_snapshot.sql](./migrations/004_authorized_dataset_snapshot.sql) is
additive and versioned: it adds only `empire_os_authorization.read_dataset_snapshot(text,uuid)`
(SECURITY DEFINER, `search_path = pg_catalog`, `REVOKE ALL ... FROM PUBLIC`). It creates no
table, grant, role, policy or trigger, changes no data and leaves 001–003 untouched. It
refuses to run without 002 and 003, twice, or as anyone other than the authorization schema
owner. Runtime roles need an explicit `GRANT EXECUTE` on it at provisioning.

The function binds the actor through `runtime_subject` (READ COMMITTED, unsafe-identity and
role-binding checks) before and after taking the SAME tenant `FOR UPDATE` lock as
`lock_authority`/`apply_operation`, then evaluates the `read` capability with the same
ordered rules as `apply_operation` (tenant, dataset mapping, membership, owner, direct grant,
delegation with expiry and revision binding). It returns the locked authority state, bound
actor and decision. Dataset generation, authority revision, commit sequence (the number of
distinct committed preparation writes) and the latest raw value and revision of every
registry key are returned ONLY when the read is allowed; a denial returns NULL counters and
no values. It never reads audit rows or `applied_request`. Reads are not audited (the audit
table only accepts authority and write operations).

[authorized-dataset-read.ts](../app/lib/authorized-dataset-read.ts) decodes a row fail-closed:
valid authority for the expected tenant and revision, valid actor and decision shape, no data
disclosed with a denial, exactly the 21 registry keys, strict UTF-16LE hex, a valid snapshot
and a consistent commit sequence. `createPostgresDatasetSnapshotReader` runs one call in
BEGIN READ COMMITTED with the adapter's timeouts and identity check, and ALWAYS rolls back.

`createPostgresAuthorizationStore(source, { lockedWriteCandidate })` optionally re-reads the
snapshot INSIDE the write transaction after the tenant lock and before `apply_operation`. It
requires an allowed read with identical authority, fence and current revisions, then passes
the batch and locked snapshot to the hook; any rejection rolls back with no effect or audit.

[durable-dataset-repository.ts](../app/lib/durable-dataset-repository.ts) implements
`ServerPersistenceRepository` for real business datasets (all 21 Empire OS stores) on top of
these primitives, the transactional executor and the reconciler:

- `readSnapshot` requires the committed-database source, the expected tenant, an actor equal
  to the server-minted principal, and an independent TypeScript read decision identical to
  the database decision. It then validates content and relationships (`assertDatasetContent`).
- `writeBatch` requires read authority, derives the policy revision from the server read,
  pre-validates the full candidate with `prepareWriteCandidate`, and re-validates it under the
  tenant lock through the hook before writing. Exact replays return the original receipt
  (`replayed: true`); different content under a used key is `idempotency-key-reused`;
  a stale policy is `unavailable/not-submitted` (retry the same request); a lost COMMIT
  acknowledgement or rollback is resolved through reconciliation, never assumed.
- `lookupCommit` returns `unresolved` (the reconciler needs the exact original batch).
- `stageImport` validates the full source twice, requires server-owned import and read
  authority, checks for an empty dataset, stages through candidate 006 in the same tenant-
  locked audited transaction, and verifies the first commit through authenticated exact
  read-back. It neither allocates a generation nor activates/cuts over a dataset. Exact
  retries reconcile against immutable request evidence; conflicting keys and occupied
  targets fail without overwrites. Unknown COMMIT outcomes remain unknown until exact
  operation reconciliation proves a committed audit. PostgreSQL support is dormant until
  candidate review, fresh-database integration testing, and explicit runtime grants.

`commitSequence` in a receipt is the dataset's committed write count observed at
confirmation: exact for a direct commit, at least the original for recovered receipts.
`createDurableServerPersistenceAuthority` composes a session resolver and a per-principal
restricted connection source, but nothing imports it: there is no route, identity provider,
runtime role provisioning or approval. Browser localStorage remains authoritative.
Full backup exports, automatic recovery snapshots and current-data backup fingerprints use
a two-pass inventory of the 21 registered stores and fail closed if any value changes
during capture; this detects mixed reads but does not lock other tabs or prevent a later
write. Backup assurance distinguishes file read-back from an isolated recovery-drill
receipt. Even a complete matching file and drill receipt remain a warning: external
location and ongoing availability are user-declared, and the receipts themselves are
stored in this browser. A drill is evidence of a past isolated simulation, not proof of
future external access or real-device recovery. Local snapshots remain on-device evidence,
not independent backups.

Multi-store browser restore writes a small interruption marker only after preserving a
pinned pre-restore snapshot. Startup refuses to hydrate or enable persistence while that
marker exists. This covers tab/process termination between store writes, which synchronous
rollback cannot catch. The system never auto-restores: an operator must explicitly choose
a complete 21-store backup; the marker clears only after exact store read-back. A
synchronous failure clears the marker only after rollback is verified; uncertain rollback
or marker cleanup leaves startup blocked so potentially mixed data is not silently treated
as healthy.

Browser business-store writes now check the interruption key immediately before each
guarded localStorage mutation. Shared JSON persistence helpers, dashboard direct writes,
and automatic recovery-snapshot creation use this boundary; an unreadable marker blocks
the write. Manual automatic-recovery rechecks therefore cannot rotate snapshots while
the marker is present. The explicit restore transaction uses a separate internal path so
an operator can preserve a pinned pre-restore snapshot and restore a complete backup.

This is a synchronous fail-closed check, not cross-tab mutual exclusion: another tab may
write the marker after a check and before a mutation, or continue running code outside
these guarded paths. localStorage provides no atomic lock spanning tabs and a series of
store writes. Startup blocks on the marker after reload, but this fence cannot guarantee
that no write races with marker creation. IndexedDB persistence is not wired into the live
dashboard and has no atomic fence shared with this localStorage marker; it remains
unactivated and must not be treated as protected by this mechanism.

### Exceptional recovery evidence (not a restore permission)

[exceptional-recovery-evidence.ts](../app/lib/exceptional-recovery-evidence.ts) defines a
version-1 legacy envelope and a version-2 `empire-os-exceptional-recovery-evidence`
envelope for read-only operator evidence capture. Its purpose is explicitly
`preserve-readable-corrupt-recovery-history-and-pre-restore-business-state`. It records
whether the recovery-history key was present and its exact raw JavaScript string, plus
exact values (including `null` for absent stores) for every registered business store.
The recovery-history, business-store and whole-envelope SHA-256 fingerprints are checked
independently. The business-store fingerprint reuses the established framed UTF-16 source
hash protocol, preserving NUL and lone surrogates. JSON encoding round-trips exact string
values; corrupt recovery-history bytes are never parsed by this feature. Version 2 also
binds interruption-marker presence and a domain-separated, framed UTF-16 fingerprint of
its exact raw string into the evidence fingerprint. The raw marker itself remains in the
envelope and is rechecked byte-for-code-unit during verification.
Ordinary marker-absent capture continues to produce version 1 for compatibility. Valid
version-1 files remain decodable and verifiable while no marker is present; they are never
treated as evidence of a marker-present state.

`createExceptionalRecoveryEvidence` and `verifyExceptionalRecoveryEvidenceFile` accept the
explicit `{ allowInterruptedMarker: true }` option for marker-aware read-only evidence.
Marker reads must be accessible and return the same exact value at each capture and
verification check; business stores and raw recovery history are also reread and compared
before evidence is returned. A present empty marker is distinct from an absent marker.
Unreadable marker state, source mutation, incomplete/malformed envelopes, or inaccessible
stores fail closed. This capture mode performs no storage writes. Exporting and later
reselecting a version-2 file verifies its fingerprint and compares its exact state to a
fresh browser capture, including the marker; it does not prove the file remains available
outside this browser or device.

Preparation can write only to the separate
`empire-os-exceptional-recovery-evidence-v1` slot. Any existing value, including an empty
string or malformed data, makes the slot occupied and blocks writing. Read, write and
exact read-back failures fail closed; uncertain evidence is retained for inspection and
is never automatically deleted or replaced. This existing non-overwriting slot preparation
remains blocked by an interruption marker; marker-aware capture is not a slot-write bypass.
Source stores and raw history are captured repeatedly and checked again after slot
read-back. The ordinary restore transaction, startup hydration and browser write fence are
unchanged. These envelopes and the local slot do not authorize restoration, establish an
independent backup, or make browser storage durable. No cross-tab atomic exclusion is
provided: reads detect observed differences but cannot prove that another tab did not
change and restore a value between checks.

The evidence envelope can be exported as a versioned JSON file using
`exportExceptionalRecoveryEvidenceFile`. JSON escaping preserves JavaScript strings
exactly, including NUL and lone UTF-16 surrogates. Reselected evidence is strictly
validated, then compared with a fresh stable capture of all 21 stores, the raw recovery
history and (for version 2) interruption-marker state. Verification reports an exact
current-state match, changed stores/history/marker, an invalid file, an unstable capture,
or an unavailable/marker-blocked source. A match is only evidence that the selected file
matches browser state at verification time; it does not authorize restoration or prove the
external file will remain available.

### Exceptional restore authorization assessment (not executable authority)

[exceptional-recovery-authorization.ts](../app/lib/exceptional-recovery-authorization.ts)
composes the existing standalone-backup validator, strict evidence decoder and
marker-aware current-state verifier into a pure, read-only preflight. It requires exactly
the 21 registered business stores, all existing backup validation and reference checks,
and a selected evidence file that matches a fresh observation. The binding fingerprints
cover the exact selected backup file text, its ordered store values, the exact evidence
file text, the evidence identity and a version-2 current-state evidence identity (all
stores, raw recovery history and marker presence/value). Version-1 evidence remains valid
only for marker-absent state; it cannot be treated as marker-present evidence.

The operator challenge binds those fingerprints and a caller-supplied fresh, unpredictable
nonce to a 60-second observation window. Confirmation must provide the exact displayed challenge
text, the same nonce, a non-empty operator name and a timestamp within the window.
Refusals distinguish invalid/incomplete backups, invalid/unsupported/stale evidence,
unavailable or changing source state, invalid clocks/nonces/challenges, expiry, binding
mismatch and missing/invalid confirmation. Recovery history is reported as absent,
empty, valid or corrupt; interruption-marker state is reported as absent, present-empty
or present-value.

A `preflight-passed` assessment is explicitly marked `restoreAuthorized: false`. It is
not a transferable permission, a durable receipt, or a restore command. The stateless
assessment does not maintain a replay ledger, prove that a person actually reviewed/confirmed the
displayed text, or provide cross-tab atomic isolation. A caller must generate a fresh
nonce for each confirmation. Any future transaction must independently parse and fully
validate the exact backup and evidence, reread and rebind every store/history/marker value,
revalidate references and evidence freshness, and obtain/consume a fresh explicit
confirmation immediately before writes. That future transaction, execution model,
pre-restore pinning, rollback and marker handling are outside this assessment module.

### Exceptional recovery transaction-time safety gate (still no restore execution)

[exceptional-recovery-transaction-gate.ts](../app/lib/exceptional-recovery-transaction-gate.ts)
adds a separate last-check model. It requires a Phase 2 assessment, then independently
reruns Phase 2's complete standalone-backup validation, external-evidence decoding and
verification, and current 21-store/history/marker observation three times, including
immediately before asking an injected confirmation consumer to atomically claim the nonce and exact
confirmation identity. It compares those fresh bindings and assessment identity with the
prior assessment and challenge. Changed state returns `changed-state`; malformed or failed
validation returns `validation-refused`; a prior claim returns `replay-refused`; and any
unconfirmed/ambiguous consume result returns `consumption-uncertain`, never readiness.

The caller must obtain a nonce from `createTrustedExceptionalRecoveryNonce`, which requires
32 bytes from Web Crypto's CSPRNG, rejects low-diversity output, and brands the result for
runtime checking. Repeated values generated or consumed in this module instance are
rejected. The injected consumer must atomically bind the challenge, nonce, confirmation
ID, attempt ID and expiry, and must fail closed for unknown outcomes. A process-local or
localStorage-backed implementation cannot provide cross-tab atomicity. The Phase 3B
PostgreSQL adapter is a dormant implementation, not an activated provider or deployed
authoritative service. Consumer success yields
only a short-lived attempt-scoped `transaction-ready` observation with
`transactionExecutionAllowed: false`. It is neither restoration authority nor executable
permission; no restoration code consumes it in this phase. A future writer must still
repeat all checks against fresh state at its own write boundary and preserve the pinned
pre-restore/rollback/marker requirements.

### Phase 4A: non-destructive exceptional recovery execution planning

[exceptional-recovery-execution-plan.ts](../app/lib/exceptional-recovery-execution-plan.ts)
adds a pure planning boundary, not an executor. No route, UI, startup hook, localStorage
mutation, restoration call, marker removal or database access is introduced. Every
result explicitly says `executionAllowed: false`.

The caller must explicitly select the backup and external evidence file contents,
provide a complete raw snapshot containing exactly the 21 registered business stores,
recovery-history value and interruption-marker value, select an expected attempt ID,
and supply the original successful transaction-gate result, challenge, confirmation and
trusted observation time. Missing keys are not defaulted to null. Accessor-backed raw
snapshots are refused. Inputs are copied before asynchronous verification; the planner
does not read live browser storage, a clock, a database or a confirmation consumer.

Successful gate results now have private in-memory planning provenance, recording their
challenge, assessment, nonce and acknowledgement time without changing the existing
public result shape. Preflight alone, a fabricated object, a copied/JSON-round-tripped
gate result, a refused replay or a different attempt cannot establish this provenance.
The consumer/source supplying the original gate still needs independently trusted
composition: this process-local receipt does not authenticate a backend or prove HA
durability. Reloads lose provenance and cannot resume from serialized plans.

The planner independently decodes and verifies marker-aware version-2 evidence, runs
the existing complete backup/reference and confirmation checks against the copied raw
snapshot, and requires all fresh bindings, assessment identity and expiry to match the
gate receipt. Legacy marker-absent version-1 evidence remains supported by earlier
assessment paths but is deliberately insufficient for Phase 4A planning. Planning time
must be a safe integer at or after acknowledgement and strictly before expiry. Time is
an explicit trusted observation input for deterministic testing, not a user-supplied
authority claim; a future writer must take fresh trusted clock readings at its own
boundaries. A plan may expire during/after construction and never reserves validity.

The deeply frozen version-1 plan includes:

- Exact backup-file/storage and evidence-file/evidence/current-state SHA-256 bindings.
- All 23 raw values, preserving absence, empty strings and exact UTF-16 code units,
  including lone surrogates. Existing corrupt business/history bytes remain raw rollback
  evidence; they are not repaired, interpreted as valid target data or silently dropped.
- The consumed confirmation ID, attempt ID, challenge/assessment identities,
  acknowledgement/planning times, expiry, relevant version identifiers and ordered
  business-store registry.
- Ordered per-key before/target values, set/remove/unchanged classifications, expected
  raw readbacks and history/marker fingerprints.
- Ordered safety stages for boundary revalidation and writer exclusion, verified
  external evidence and a pinned raw rollback image, durable interruption fencing,
  forward writes, complete target verification and durable outcome recording.
- Rollback obligations covering every business key, exact raw verification, preservation
  of original history/marker evidence and continued interruption fencing on uncertainty.
  Expiry does not erase rollback obligations. Rollback still requires exclusive writer
  control; loss of control requires reconciliation rather than blindly overwriting
  another tab's unattributed writes. No automatic marker clearing is planned.
- A domain-separated SHA-256 over the complete deterministic plan body. This is an
  integrity identifier, not a signature, execution permit, journal or durable claim.

Plans contain raw business and rollback data. Treat them as sensitive; do not log them,
send them to analytics or persist/export them without a separately reviewed retention
and access-control policy. The planner itself retains no plan or replay ledger.

The existing UTF-16 fingerprint algorithm is shared through
[exceptional-recovery-fingerprint.ts](../app/lib/exceptional-recovery-fingerprint.ts);
earlier challenge, assessment, confirmation and attempt hash domains/encodings are
unchanged. Repeating planning with the same inputs yields the same plan, does not
consume confirmation again, and is intentionally permitted for inspection. Gate replay
protections remain unchanged. Future exactly-once execution/reconciliation must be
separate from repeatable planning.

**Unresolved prerequisites before any real execution:**

1. A separately reviewed execution-authority boundary and durable attempt/outcome journal
   binding plan, operator, before-image, progress, failure and reconciliation decisions.
2. Enforceable cross-tab writer exclusion and a reviewed protocol for all current,
   historical and non-cooperating writers. The existing fence is a check-then-write
   guard, not a lock; sequential snapshots/readbacks cannot exclude ABA changes.
3. A verified durable, externally recoverable pre-restore image that can retain corrupt
   raw values and existing marker/history bytes without relying on decoding or replacing
   corrupt recovery history. Capacity/quota and lossless readback must be proven first.
4. Fresh exact live-state, file, attempt, permission and expiry checks immediately at the
   write boundary, plus a protocol for distinguishing authorized journal/fence changes
   from unexpected concurrent mutations.
5. Crash-safe progress and rollback rules for failure between any two localStorage
   operations, including rollback failure, lost writer control, expired attempts and
   uncertain acknowledgement. localStorage has no multi-store atomic transaction.
6. Separately reviewed successful-completion/fence-release rules that cannot erase a
   pre-existing interruption's provenance or unblock hydration on partial recovery.
7. Audited authority/consumer composition, replay retention across server failure or
   restore, and independently authorized offline/browser fault-injection verification.

[exceptional-recovery-execution-plan.test.ts](../app/lib/exceptional-recovery-execution-plan.test.ts)
covers deterministic/deeply immutable output, complete bindings, corrupt raw rollback
preservation, every store/history/marker stale-state change, file-byte changes, malformed
or legacy evidence, incomplete targets, provenance forgery, mismatched attempts,
confirmation changes, replay, expiry, interruption and rollback safeguards, asynchronous
input mutation, cryptographic failure and independent fingerprint compatibility.
Recommended focused offline validation from `apps/web`:

```sh
npm test -- app/lib/exceptional-recovery-execution-plan.test.ts app/lib/exceptional-recovery-transaction-gate.test.ts app/lib/exceptional-recovery-authorization.test.ts
```

Phase 4A neither invokes nor modifies the existing ordinary restore executor. It does
not activate the PostgreSQL consumer, run database integration tests, alter persisted
formats, migrate localStorage or change hydration/load/save behaviour.

### Phase 4B: recovery journal format and read-only reconciliation

[exceptional-recovery-journal.ts](../app/lib/exceptional-recovery-journal.ts) defines a
version-1 **planning-only** journal, canonical serialization, complete rollback image,
validator, monotonic transitions and crash-reconciliation assessment. Nothing persists
the journal or checkpoint, reads live storage, changes business data, establishes an
actual fence, restores values, clears markers, or enables restoration. Every result
denies execution; reconciliation also explicitly denies resume, rollback and marker
clearance. A structurally valid journal is not an execution permit or durability proof.

**Binding and integrity**

- Initial preparation requires an original, deeply frozen Phase 4A plan. The planner
  now weakly tracks issuance identity; copied, fabricated and serialized plans cannot
  create journals. This does not change plan contents, hash domains, confirmation
  consumption, or repeatable planning, and does not strongly retain plan data.
- The journal commits to the exact complete plan hash (including its versions, stages,
  target values and rollback obligations), plan version, consumed confirmation and
  attempt IDs, challenge/assessment identities, backup file/storage fingerprints,
  evidence file/content fingerprints, all current-state fingerprints, original
  history/marker fingerprints, acknowledgement/planning times and expiry.
  The original plan must be retained separately if its contents are needed later;
  the journal binds it by hash rather than duplicating its target payload.
- The separate versioned rollback image binds the same attempt and plan and includes
  exactly the ordered 21 business values, original recovery history and original
  interruption marker. Missing, extra, duplicate or reordered keys are rejected.
  Values remain exact strings or null: empty, absent, corrupt JSON, NUL and unpaired
  UTF-16 surrogates are not normalized, repaired or discarded. The existing marker-aware
  evidence implementation independently recomputes source-state, history and marker
  fingerprints from the complete image.
- Binding, image and each record use separate domains with the existing exact
  UTF-16-code-unit fingerprint encoding. Records bind sequence, prior record hash,
  time, state, readback observations and explicit failure reasons to the binding and
  image hashes. Strict JSON parsing/canonical round-trip rejects partial records,
  duplicate JSON fields, unknown fields and incompatible formats.
- Validation and transitions require a separately trusted checkpoint containing the
  expected attempt, plan, binding, image, sequence and head hashes. Older complete
  journals, truncated histories, alternate branches and other attempts are refused
  against that checkpoint. Never derive this trust anchor from the journal being
  assessed; storing them together in the same untrusted slot proves nothing.

**Monotonic state model**

The preparation path is `prepared -> rollback-image-checked -> fence-observed`.
Image checking requires exact canonical image readback **and all 23 unchanged current
values**. Fence observation requires another complete image readback and all original
values except the exact attempt/plan/image-bound marker. These functions inspect only
caller-supplied snapshots; they cannot prove where a readback came from, that it is
durable, or that another writer was absent. `fence-observed` is not execution readiness.

Each preparation state can move to `interrupted`, `uncertain` or terminal `refused`.
Interruption can only become uncertain or refused; uncertainty can only become refused;
refusal has no successors. No state represents successful restoration, completed
rollback, marker release or automatic resumption. Sequence strictly increases, time
cannot move backwards, and records cannot skip or repeat preparation states. Preparation
and fencing require time strictly before expiry. Failure/evidence retention remains
possible after expiry: expiry must never erase rollback obligations or interruption
evidence. Time is supplied by trusted composition; no clock is read or reserved here.

Read-only reconciliation rejects invalid records, unknown checkpoints, incomplete live
snapshots and missing/mismatched image readback. Otherwise it reports changed business
keys, history equality, original/attempt/unexpected marker classification, expiry and
the recorded state. Even a complete unchanged before-image is not proof that no writes
ever occurred (ABA remains possible). Changed bytes may be concurrent or partial
restoration writes; the assessment deliberately does not attribute ownership, infer
success, or authorize overwriting them. Original marker bytes are rollback evidence,
not permission to replace or clear the active interruption fence.

**Durability and storage failure remain unresolved**

This phase establishes a serializable format, not durable storage. Deterministic pure
transitions do not consume heads: two callers can independently propose successors to
the same checkpoint. Repeated read-only validation is intentionally safe. Process-local
issuance identity is not a durable replay ledger, and SHA-256 is not a signature.
An attacker who can replace both a journal and its trusted checkpoint can forge their
relationship. After a reload, validation is useful only with an independently
authenticated, current checkpoint; absence or uncertainty must stop recovery rather
than rebuilding trust from journal bytes.

Before persistence or execution is implemented, separately review and prove:

1. Durable single-use attempt reservation and atomic checkpoint compare-and-swap,
   including protection against rollback/replay across browser/server restarts.
2. Enforceable cross-tab/all-writer exclusion. Existing localStorage fences are
   check-then-write guards, not locks; neither multi-key writes nor journal/checkpoint/
   marker updates are atomic.
3. Pinned, externally recoverable complete image and journal storage with capacity,
   quota, lossless UTF-16 readback, access-control and retention guarantees. Corrupt
   existing recovery history must not be decoded, evicted or overwritten to store it.
4. A persistence protocol for every crash window between image, journal, checkpoint
   and marker writes. Quota/IO errors, partial writes, uncertain acknowledgements,
   missing checkpoints and failed readback must retain all available evidence and
   fences, prohibit automatic retry/reset, and require read-only reconciliation.
   A refused pure function cannot itself durably latch a failure.
5. Fresh trusted clocks and live authority/state/attempt checks at actual write
   boundaries, audited durable confirmation composition, and separately reviewed
   forward-write, rollback, crash-fault-injection and fence-release protocols.

Journal/image serializations contain sensitive raw business data and may be large.
No size/durability capacity guarantee or persistence location is supplied by this
format. Do not log, upload, automatically export or persist these values.

[exceptional-recovery-journal.test.ts](../app/lib/exceptional-recovery-journal.test.ts)
adds offline cases for exact bindings, original-plan provenance, independent fingerprint
compatibility, all 23 stale values, null/empty/lone-surrogate preservation, complete
readback, invalid/skipped/repeated transitions, expiry and backward clocks, interruption,
uncertainty, terminal refusal, tampering, partial writes, incompatible records, replay,
forks, asynchronous input capture, crypto failure and read-only crash reconciliation.
Recommended focused offline validation from `apps/web` (not integration tests):

```sh
npm test -- app/lib/exceptional-recovery-journal.test.ts app/lib/exceptional-recovery-execution-plan.test.ts app/lib/exceptional-recovery-transaction-gate.test.ts app/lib/exceptional-recovery-authorization.test.ts
npx tsc --noEmit
```

Existing storage formats, ordinary backup/restore, browser write-fencing, hydration,
database uniqueness/replay enforcement and dormant PostgreSQL fixtures are unchanged.
No migration or persisted-data conversion is required.

### Phase 4C: trusted checkpoint coordination design (non-executing)

[exceptional-recovery-checkpoint-coordination.ts](../app/lib/exceptional-recovery-checkpoint-coordination.ts)
adds an injected authority contract, a read/receipt boundary, side-effect-free proposals,
a pure CAS reference model, and conservative crash reconciliation. **There is no
checkpoint storage adapter, submission path, restoration executor or UI activation.**
The reader exposes only `read` and `lookup`; no production function calls the
contract's `compareAndSwap`. Every operational result explicitly denies execution,
resume, rollback and marker clearance. A model result says `would-advance` or
`already-modelled`, never that anything was durably committed.

#### Architectural decision and inspected boundaries

The Phase 4A original-plan receipt binds the confirmed attempt and all 23 source
values. Phase 4B validates complete canonical journal/image evidence and history
against a separately supplied checkpoint, but cannot make that checkpoint trusted,
durable or exclusive. Its `rollback-image-checked` and `fence-observed` proofs describe
caller-supplied readbacks; their hashes do not prove physical storage or exclusion.
Neither an original plan nor a journal hash is authority to execute.

The browser interruption marker blocks participating business writers but is a
check-then-write guard, not a lock. Preparation writer credentials operate in a
separate isolated database and are not business-store recovery exclusion. The
server persistence contract distinguishes confirmed database commits from requests
and ambiguous outcomes, and binds authority to server-resolved identity. The dormant
confirmation consumer covers single-use confirmation, not journal CAS, all-writer
exclusion or atomic composition with localStorage.

The selected approach is a **separately authenticated, linearizable authority for one
dataset recovery scope**, with complete journal/image evidence and the checkpoint
committed in the same logical atomic boundary. A marker, localStorage readback,
process-local mutex, hash, timestamp or tab identifier cannot enforce this contract.
The cost is a larger evidence-bearing request and conservative unavailability. This
is preferable to a small checkpoint-only write whose evidence may be missing after a
crash, or to an automatic lease/takeover policy that could overwrite another attempt.
An eventual backend may pin immutable blobs, but must prove durable reachability,
lossless bytes and atomic checkpoint publication before acknowledging success.

#### Authority and CAS invariants

- The deployment pins an authority identifier, dataset UUID and nonreusable epoch
  independently of journal/request bytes. Verified session authorization must bind
  access to this scope; request fields are not authentication.
- A provisioned snapshot contains a positive safe-integer revision, exact checkpoint,
  complete canonical journal, complete canonical 23-value rollback-image readback,
  and the last committed request fingerprint. No empty-state initialization exists.
  Missing authority is a refusal, not revision zero or a new trust anchor.
- Enrollment is intentionally absent. A separately reviewed durable transaction must
  reserve the scope exclusively, bind the authentic Phase 4A attempt/plan/consumed
  confirmation, verify and pin the initial evidence, and establish revision/epoch
  history. Restart must never re-enroll from a caller's self-consistent journal.
- CAS compares the **entire** expected snapshot, not just the journal head. A
  successful new checkpoint advances the scope revision exactly once without
  overflow, wrapping or reset, and appends exactly one valid journal record. It
  preserves attempt, full plan binding, confirmation, rollback image and exact record
  prefix. Distinct branches and attempts cannot share a successful expected revision.
- A request fingerprint covers protocol version, identity/epoch, full expected
  snapshot and complete proposed evidence using the existing lossless UTF-16
  fingerprint helper. It is an integrity/idempotency identifier, not a signature.
  Input objects are captured before asynchronous hashing; accessors and extra fields
  are rejected at captured data boundaries.
- Exact duplicate requests describe the same successor, not a second increment.
  The model recognizes an exact already-modelled successor even after expiry.
  A future backend must retain immutable historical receipts and bind the same
  fingerprint to the same request; a stale/foreign request is never silently rebased.
- Forward preparation must still be unexpired at the actual enforcing CAS boundary.
  Failure evidence may be retained after expiry. Historical receipt validation is
  separate from permission to make a new advancement. Expiry never releases a scope,
  removes evidence, clears a marker, or authorizes another attempt.
- There is no transfer, reset, deletion, takeover or release API, including for
  terminal/refused attempts. Those lifecycle decisions remain execution-blocking work.

The reference model can show which serialized schedule would win **if** a real
backend atomically enforces these invariants. It neither serializes concurrent callers
nor proves any backend atomicity. A read/proposal/model result is never a COMMIT receipt.

#### Durable acknowledgement versus observations

Only the injected authority's authenticated `current` response with confirmed-commit
durability, or its exact immutable commit lookup, enters the provenance boundary.
Complete evidence is independently validated before an opaque, process-local token is
issued. Caller checkpoints, model outputs, durability strings, copied tokens, and
deserialized tokens cannot be passed off as those observations/acknowledgements.

The injection point itself is trusted composition: a dishonest or in-memory adapter
can lie about durability. WeakMap provenance is not authentication against arbitrary
same-origin code, a durable replay ledger, a lock or a cross-process capability.
There is deliberately no default browser adapter or public result-to-token converter.

Each reader conservatively rejects backwards clocks/revisions, same-revision content
changes, cross-attempt/forked history, and impossible revision/history deltas. A
newly observed head supersedes older observations. An unavailable, malformed, missing,
revoked, uncertain or failed read/lookup invalidates that reader's previous tokens,
including in-flight verification. Fresh successful reads can re-establish observation,
but cannot make an old proposal current or release a recovery scope.

These are process-local sanity checks, not durable anti-rollback protection. After
reload, authenticated fresh authority and a nonreusable epoch must be established
externally. An observation is a point-in-time snapshot, **not a live writer lease**;
an unseen subsequent change is caught only by the future enforcing CAS. Recovery
execution may never depend on these tokens alone.

#### Crash reconciliation and conservative dispositions

| Observed crash window or conflict | Non-executing disposition |
| --- | --- |
| Candidate journal/image prepared but authority submission absent or unknown | Retain candidate evidence and fence; no commit inference or automatic submission. |
| Image/journal write missing, partial or noncanonical | Refuse checkpoint proposal/reconciliation; preserve all available bytes. |
| Authority may have committed, but acknowledgement was lost | Lookup only the exact original request and independently read current authority. |
| Lookup is not-found, times out, is unavailable, or authority disappeared | Uncertain; absence is not proof of no commit, no retry/reset/takeover. |
| Complete exact durable receipt and matching current head, but local journal/image is old, ahead, forked or incomplete | Refuse reconciliation; no automatic local repair, replacement or deletion. |
| Exact receipt, current authority and complete local evidence all agree | Report checkpoint commit only; deny execution, resume, rollback and marker clearance. |
| Receipt belongs to another request/epoch/revision, or current authority has advanced | Refuse; an old durable receipt is not current authority. |
| Identical business before-image or marker is observed again (ABA) | No claim that no writes occurred; independent writer exclusion is still required. |
| Attempt expires or reaches a failure/terminal state | Preserve obligations and fence; no automatic release or takeover. |

The new reconciliation checks checkpoint evidence and authority agreement; it does
not read live business data. Phase 4B's separate read-only reconciliation still
classifies all 23 caller-observed live values and marker/history differences. Neither
assessment attributes competing writes, repairs data, latches a durable refusal,
performs rollback, resumes recovery or clears interruption state.

#### Remaining execution-blocking gaps

1. An authenticated, authorized, genuinely durable enforcing backend with atomic
   expected-state comparison, monotonic non-resettable revisions, independently
   pinned epochs, durable initial attempt enrollment and immutable receipt retention.
   No adapter, schema, SQL migration, endpoint or database change is supplied here.
2. Evidence storage capacity, quota/IO behaviour, sensitive-data access control,
   exact UTF-16 preservation, externally recoverable/pinned retention, and tested
   crash safety at every image/journal/checkpoint publication boundary.
3. Atomic durable composition with the single-use confirmation consumer, trusted
   clock/expiry checks at commit, and a reviewed lifecycle for competing attempts.
   The test confirmation stub proves none of these deployment guarantees.
4. Independent writer exclusion across every browser/server writer and actual write
   boundary. A checkpoint CAS cannot make localStorage business writes atomic, detect
   all business-data ABA, close marker check-then-write races, or prove that a recorded
   readback/fence was ever physically durable.
5. A separately reviewed execution authority and crash-tested forward-write,
   verification, rollback, outcome retention and fence-release protocols. No marker
   clearing, automatic recovery, business writes or deletions are enabled.

[exceptional-recovery-checkpoint-coordination.test.ts](../app/lib/exceptional-recovery-checkpoint-coordination.test.ts)
adds deterministic scheduled branch/duplicate-tab races, foreign attempts, stale/ABA
revisions, epoch/scope changes, overflow, replay, complete-evidence failures,
input capture, provenance forgery, expiry, loss of authority during reads/hashing,
receipt substitution and interrupted-update reconciliation cases. The test-only
scheduled authority simulates acknowledgements in memory; it is not an adapter and
does not prove storage durability or parallel backend isolation. These tests were
**added, not run**, in Phase 4C. No tests, builds, terminal commands, database access,
Git commands, commits or pushes were performed for this phase.

The new module is not imported by runtime callers. Existing Phase 4A/4B formats,
hashes, tests, ordinary restore, localStorage keys/data, writer fences, hydration,
server persistence contracts and dormant confirmation integration remain unchanged.
No stored-data migration or backward-compatibility conversion is needed.

### Exceptional recovery durable confirmation consumer (inactive)

[postgres-exceptional-recovery-confirmation-consumer.ts](../app/lib/postgres-exceptional-recovery-confirmation-consumer.ts)
implements the Phase 3A `ExceptionalRecoveryConfirmationConsumer` contract as a separate
server-only adapter. It is not imported by a route, startup path or production provider,
has no default connection, and is not active. The inactive schema candidate is
[exceptional-recovery-confirmation-candidate.sql](./design/sql/exceptional-recovery-confirmation-candidate.sql);
it is not a numbered/live migration and has not been applied. Migrations 005 and 006
remain dormant and unchanged.

The candidate creates only `empire_os_recovery.confirmations`. Database constraints make
the nonce a primary key and confirmation ID and attempt ID independently unique. Each
append-only row binds the exact challenge SHA-256, nonce, confirmation identity, attempt
identity and expiry timestamp. Before each consume, the adapter verifies the exact
logged table shape, three valid non-deferrable unique constraints, and the deferred
commit-time expiry trigger. At deployment, provision a separate non-owner LOGIN with
only `USAGE` on `empire_os_recovery` and `SELECT, INSERT` on this table. Do not grant
`UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, schema `CREATE`, database
`CREATE`, role membership, or any access to `empire_os_preparation` or
`empire_os_authorization`. Provision a dedicated database for this capability; do not
install it into a live business/authority database. The runtime role must have no
privileges on any other user schema, table, sequence or function. The adapter verifies
these boundaries, the expected database and login, primary-server status, active TLS
in production mode, a `pg_catalog`-only search path, a logged permanent table,
`fsync=on`, `full_page_writes=on`, and
`synchronous_commit=on`. The schema owner and runtime identity must be different.
Deployment must independently review the role, connection source, backup/failover policy,
TLS certificate/hostname verification, database identity and permissions before any
activation.

The transaction acknowledgement guarantees the local PostgreSQL commit under those
server settings; it does not by itself guarantee retention through asynchronous replica
failover, point-in-time restore, or backup rollback. The deployment must prevent
acknowledged consumed confirmations from disappearing across failover/restore, or provide
a separately reviewed replay-prevention recovery procedure. That HA/reconciliation
guarantee is not implemented, so the consumer remains inactive until it is established.

The adapter starts a bounded `READ COMMITTED` transaction, sets local lock/statement/
idle timeouts and synchronous commit, and attempts one insert using `ON CONFLICT DO
NOTHING`. Database uniqueness serializes concurrent consumers. If the insert does not
occur, it checks server time and reads any conflicting row in a subsequent statement:
an exact identity is `already-consumed`, any reused nonce/confirmation/attempt bound to
different values is `conflict`, and elapsed expiry is `expired`. It never overwrites or
deletes evidence. A deferred database constraint trigger checks expiry again at commit.
A successful first use is returned only after PostgreSQL confirms
`COMMIT`. A connection failure or confirmed rollback returns `unavailable`; malformed
or expired requests return `invalid-input` or `expired`; conflicting and exact replays
remain distinct. A lost/invalid COMMIT acknowledgement, failed rollback, timeout with
unknown transaction state, or failed connection disposal returns `uncertain`, destroys
the connection where possible, and cannot produce transaction readiness. The Phase 3A
gate maps these to refusal; callers must not retry an uncertain attempt under a new
identity. Reusing the exact identity can determine whether a committed unique row exists,
but a separate operational reconciliation protocol is not implemented.

To connect it to Phase 3A, deployment code must create this adapter from a separately
verified source and pass the returned consumer as the gate's `consumer`. No such source,
credential, provider, route, restore integration or live database configuration is
installed here. The consumer has no operation that references or activates any of the 21
business stores. PostgreSQL confirmation atomicity does not make browser localStorage
restoration atomic and does not eliminate cross-tab interference; the restore writer
must independently recheck current state immediately at its write boundary.

Pure adversarial tests are in
[postgres-exceptional-recovery-confirmation-consumer.test.ts](../app/lib/postgres-exceptional-recovery-confirmation-consumer.test.ts).
The optional real PostgreSQL suite,
[recovery-confirmation.postgres.integration.test.ts](./tests/recovery-confirmation.postgres.integration.test.ts),
uses only `EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_*` settings and requires a new loopback
database named `empire_os_test_recovery_<32-hex-fixture-id>`, with a newly generated,
one-use fixture ID included in `EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_FIXTURE_ID`, the
database comment (`<database>:empire-os-recovery-confirmation-disposable-only:<fixture-id>`)
and explicit confirmation. It refuses an existing schema or nonempty fixture, applies only the inactive
candidate to that fixture, and performs no cleanup. Each run needs a newly provisioned
database; it must never reuse the previous v9 database or any prior integration database.
The integration suite has not been run as part of this change.

#### Recovery integration harness safety (Phase 3C, still dormant)

[recovery-confirmation-harness.ts](./tests/recovery-confirmation-harness.ts) now owns
the recovery suite's identity, exclusive claim, empty-database check and candidate setup.
It does not call the shared migration harness and never applies migrations 001–006.
The five tests run sequentially with test retries and repeats disabled. No infrastructure
is created by the harness.

Use a completely new, local PostgreSQL **16** cluster for each attempted run. Proposed
port **55440** is only a planning choice: independently prove it is free before provisioning.
The recovery configuration explicitly rejects **55432** (protected production) and
**55439** (protected historical v9), including numerically equivalent port settings.
Never reuse any v1–v9 cluster, database, role credentials or data directory. The older
port-55432 provisioning example elsewhere in this document is not permission to use that
port and must not be used for recovery verification.

In addition to the existing dedicated `HOST`, `PORT`, `DATABASE`, `USER`, `PASSWORD`,
`FIXTURE_ID` and exact `CONFIRM` values, the prefix
`EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_` now requires:

- `CLUSTER_DIRECTORY`: the absolute, canonical data-directory path, with final component
  exactly `empire-os-recovery-<32-hex-fixture-id>`. No symlink aliases, relative paths,
  trailing separators or normalized-path substitutions are accepted. Use the actual
  canonical path, for example `/private/tmp/...`, not a `/tmp` symlink alias on macOS.
- `CLUSTER_SYSTEM_IDENTIFIER`: the new cluster's positive uint64 system identifier,
  independently recorded from its local control data after separately authorized
  provisioning, never copied from an unverified database response.

All dedicated settings must be absent to skip; any partial or invalid configuration
refuses setup. Validated configuration objects are immutable and runtime-branded.
The cluster directory's `PG_VERSION` must be 16 before the driver is constructed.

Before connecting, the harness exclusively creates `.recovery-confirmation-spent`
inside the new cluster directory, records the fixture binding, and syncs both file and
directory. An existing file, failed write/sync, or uncertain persistence stops setup.
This file is never removed: even connection failure spends the fixture. Permissions
must allow the invoking operator to record and sync this guard.

The connected database must match the database, login/effective user, loopback server
address, port, exact data directory, cluster system identifier, PostgreSQL 16 version,
primary status and fresh database-comment marker. The setup identity must be the
disposable superuser. No databases other than the target and the standard three may
exist, no additional non-system roles may exist, and no other client sessions may be
present. Do not run a parallel psql inspector while starting the tests.

The harness takes the nonblocking **session** advisory lock `(172914, 30)`, rechecks
identity/marker after acquiring it, and holds it through the five tests until the admin
connection closes. It then commits a database comment ending in `:spent` before the
catalog check or candidate. Missing/ambiguous lock or claim acknowledgements stop setup.
The local file and database marker are independent guards; neither is automatically reset.

The catalog check refuses public functions, custom types, relations (including
sequences), other namespace-dependent objects, user-range catalog objects, non-default
extensions/languages, large objects, publications, subscriptions, event triggers,
foreign-data wrappers/servers, replication origins, default ACLs and database/role settings.
It also rejects user-defined casts/access methods, transforms, parameter ACLs, replication
slots and prepared transactions.
Every expected count must be present exactly once and equal to the string `"0"`.
An empty-looking table list is not proof of an empty fixture.

Only then is the unchanged inactive candidate read and submitted. Its inactive/no-grants
header and outer transaction boundaries are checked, and a final COMMIT acknowledgement
is required. Setup uses a 5-second connection timeout, 5-second lock timeout, 10-second
statement timeout, 12-second query timeout and 15-second idle-in-transaction timeout,
with `pg_catalog` search path and synchronous commit pinned at connection startup.
Driver passwords and replication settings explicitly override ambient pg fallbacks.
The generated runtime login remains distinct, non-owner and least-privileged; it receives
only recovery-schema USAGE and confirmation-table SELECT/INSERT, with no business access.

On any failed, interrupted or uncertain attempt, retain the cluster, database, roles,
spent file and marker for separately authorized inspection. Never retry the fixture,
remove either guard, overwrite its comment, reset, recreate or clean it. A new attempt
requires a new ID, cluster and database. Teardown closes connections only; it does not
delete or reset anything. An identity failure never authorizes a write to the mismatched
server. Operators must still independently verify the local port/process, cluster
provenance, credentials and exclusivity: advisory locks do not constrain unrelated
superusers, and the harness cannot protect against deliberate filesystem/marker tampering.

Offline safeguards are covered by
[recovery-confirmation-disposable-config.test.ts](./tests/recovery-confirmation-disposable-config.test.ts)
and [recovery-confirmation-harness.test.ts](./tests/recovery-confirmation-harness.test.ts).
The latter mocks the driver and filesystem; its SQL parser executes no SQL. Recommended
focused offline validation from `apps/web` (not an integration run):

```sh
npm test -- database/tests/recovery-confirmation-disposable-config.test.ts database/tests/recovery-confirmation-harness.test.ts
```

No recovery integration test, database provisioning or candidate application was performed
as part of this hardening. Production activation and restoration remain out of scope.

### Separate opt-in integration harness

[authorization.postgres.integration.test.ts](./tests/authorization.postgres.integration.test.ts)
uses ONLY `EMPIRE_OS_AUTH_TEST_PG_HOST`, `PORT`, `DATABASE`, `USER`, `PASSWORD` and
`CONFIRM` (each with the same prefix). It never falls back to the old `EMPIRE_OS_TEST_PG_*`
configuration and rejects matching configured database names. Confirmation follows
the existing `<database>:empire-os-disposable-integration-test-only` format.
Loopback host, database name, connected identity, database comment marker, recovery
status, exclusive harness lock and empty-database checks are reused unchanged.
All four migrations (001–004) run only after the original empty-database check succeeds.
An independent database name cannot prove freshness; the catalog guard remains essential.
Databases populated before migration 003 existed (including `empire_os_test_authorization_v3`
and `_v4`) must NEVER be reused, migrated or reset; verify 003 only on a NEW instance.
Likewise, databases populated before 004 existed (including `_v5`) must never be reused;
verify 004 only on a NEW instance.

The suite provisions restricted NOLOGIN roles on the verified disposable instance,
then uses separate verified connections with test-only SET ROLE. This is not a
production login model. It retains fixtures and roles, performs no cleanup/reset,
and cannot be rerun on the populated instance. Tests cover atomic preparation writes,
cross-tenant RLS/GUC spoofing, missing audit, duplicate operation IDs, revision ordering,
concurrent revocation, expiry, privileged connections, unchanged original policies, and
reconciliation (committed/retried, not-executed, conflict, actor binding, revoked members,
lock waiting, no request-content disclosure), and the durable dataset repository (authorized
write/read-back, replay, key reuse, stale revisions, invalid data, denied reads without
disclosure, cross-tenant denial, snapshot lock waiting and stale-snapshot refusal).
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
[authorization-reconciliation-migration.test.ts](./tests/authorization-reconciliation-migration.test.ts)
applies the same offline parse plus static security checks to migration 003, and
[authorized-dataset-snapshot-migration.test.ts](./tests/authorized-dataset-snapshot-migration.test.ts)
to migration 004.
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

The employee-provisioning SQL in `design/sql/provisioning-upgrade.sql` and
`design/sql/provision-member.sql` is a non-deployable candidate only. Migration 005 remains
fail-closed, the candidate grants no execution privileges, and its PostgreSQL integration
suite is skipped unless a separately verified fresh disposable database is configured.
The candidate also rejects unsafe login sessions and reachable privileged/differently
bound roles (including NOINHERIT memberships), checks retained revocations and ambiguous
authority records, and binds provisioning audit evidence to the exact old-to-new state
transition at the deferred commit boundary. Existing authorization operations retain
their previous audit rules. The provisioning harness installs both candidate files in one
transaction after rejecting non-empty databases, including public functions/types and
extensions. Provisioning tests use real restricted LOGIN connections, not superuser
sessions impersonating them with SET ROLE; adversarial tests explicitly exercise unsafe
sessions, role grants, evidence forgery, missing bindings and queued binding removal.
The candidate corrects the trusted row-trigger guard to return `OLD` for DELETE, so
deletes reach the existing immutability and binding-serialization triggers rather than
silently cancelling the row. Audit tests verify the same committed record before and
after both rejected mutations. Binding-removal tests first prove the provisioning backend
is blocked by the held tenant lock, then delete exactly one binding; committed removal
must deny after locking, while rolled-back removal must allow the queued operation.
These test definitions are not evidence of PostgreSQL verification until run on a newly
created, explicitly marked empty disposable database; existing populated test databases
must never be reused or reset.

The inactive server integration boundary is
[clerk-employee-provisioning.ts](../app/lib/clerk-employee-provisioning.ts), composing the
existing verified Clerk resolver with
[server-employee-provisioning.ts](../app/lib/server-employee-provisioning.ts). It reuses the
same process-local authenticated principal brand as persistence; submitted actor, tenant,
dataset, authorization and readiness claims are rejected. The tenant is configured by
trusted server code, and a per-principal restricted database source is mandatory.

[employee-provisioning-release.ts](../app/lib/employee-provisioning-release.ts) deliberately
always returns migration-005-disabled. There is no request/environment override, endpoint,
Server Action, pool initialization or runtime wiring. Both the boundary and adapter check
this interlock before acquiring a database connection. A future reviewed release must also
verify the database contract; candidate function existence alone is not release approval.

The dormant [PostgreSQL adapter](../app/lib/postgres-employee-provisioning-store.ts) reuses
READ COMMITTED transaction setup and the tenant-locked `lookup_operation` API to bind the
database actor to the verified principal. It reuses owner authorization and transition
validation, builds the existing SHA-256/request/decision conventions, calls only the atomic
SQL provisioning function, verifies returned authority/audit, and returns a minimal receipt
only after confirmed COMMIT. Lost COMMIT or rollback acknowledgement returns unknown and
discards the connection; there is no automatic retry or replacement operation ID.
The unit tests mock release approval and driver responses only, not PostgreSQL execution.
The separate [real adapter suite](tests/provisioning-adapter.postgres.integration.test.ts)
executes the unmodified adapter and server boundary against PostgreSQL 16 through genuine
restricted LOGIN connections. It requires its own `EMPIRE_OS_PROVISION_ADAPTER_TEST_PG_`
configuration (`HOST`, `PORT`, `DATABASE`, `USER`, `PASSWORD`, `CONFIRM`), a database named
`empire_os_test_provision_adapter_...`, and the existing database comment/confirmation
marker `empire-os-disposable-integration-test-only`. Configuration cannot share any of the
other suites' databases; v1-v5 names are rejected. The verified-identity, advisory-lock and
empty-database checks run before migrations 001-004 and candidate installation; migration
005 is never submitted. Missing configuration skips the suite; unsafe or nonempty
configuration fails rather than resetting anything. Every run consumes a NEW database.

Only this Vitest module substitutes release approval, after successful guarded setup;
the original application release is independently asserted to remain disabled. No
application flag, environment activation path, source injection bypass or live route is
added. Fixture LOGIN roles receive only read/lookup privileges and, for the founder login,
candidate execution; private derivation helpers and table writes stay inaccessible.
Tests read committed state/audit using the fixture administrator, verify hash/decision
conventions and immutable audit rows, and exercise denial, revision/replay fences, real SQL
errors, rollback after both writes, concurrent adapters and post-lock binding revalidation.
The verified-session provider is a fixture; this suite tests the branded server identity
contract and actual database binding, not live Clerk session issuance or verification.
Lost COMMIT/ROLLBACK acknowledgements and response corruption are explicitly simulated
around real SQL operations; independent database reads distinguish committed/rolled-back
outcomes. These definitions are NOT evidence of a successful PostgreSQL run.

From `apps/web`, after explicitly creating and marking a NEW empty database and setting
the six dedicated variables, run only:

```sh
npm run test -- database/tests/provisioning-adapter.postgres.integration.test.ts
```

Focused offline checks and TypeScript (no database required when the dedicated variables
are absent):

```sh
npm run test -- database/tests/provisioning-adapter-disposable-config.test.ts database/tests/provisioning-harness.test.ts app/lib/postgres-employee-provisioning-store.test.ts app/lib/server-employee-provisioning.test.ts app/lib/clerk-employee-provisioning.test.ts
npx tsc --noEmit
```

Production activation, restricted login lifecycle/TLS pool wiring, provisioning-specific
unknown-outcome reconciliation and any future transport/CSRF review remain blockers.
Clerk account creation/invitations, People records, role definitions, ownership and browser
localStorage are deliberately outside this membership boundary.

#### Deployment-readiness assurance (assessment only)

[employee-provisioning-readiness.ts](../app/lib/employee-provisioning-readiness.ts) provides
a server-only read-only gate. It NEVER returns an activation token: every result has
`activation: blocked`. Assurance separately reports verified, unverified or failed, with
per-control verified/unverified/failed/blocked findings. Migration approval is read only
from the existing `employeeProvisioningRelease()` interlock and rechecked at the end;
migration 005 remains disabled. The browser IndexedDB preparation activation authority
is unrelated to SQL deployment and is neither changed nor repurposed.

Trusted server composition must supply the exact production environment/deployment IDs,
reviewed artifact SHA-256, tenant, endpoint/database/LOGIN identity fingerprint, pinned
Ed25519 PUBLIC verification keys scoped to permitted controls, an explicit maximum
evidence age, trusted clock and server evidence repository. No keys, signing capability,
repository, production configuration or runtime wiring are shipped. Request-supplied
claims are rejected. The authenticated actor comes from the existing branded server
session resolver. The source must be minted by the restricted provider, whose private
WeakMap binds its actor, tenant and non-secret endpoint/database/LOGIN fingerprint.

Evidence is a repository-returned array of exact `{keyId,payload,signature}` envelopes.
`payload` is the exact UTF-8 JSON string signed with Ed25519; `signature` is standard
base64. Version 1 payloads contain exactly `control`, `target`, `actorSubject`,
`observedAt`, `expiresAt`, `catalogSha256`, `result`, `method`, `evidenceSha256` plus `version`.
The target equals the server's complete production target. Signed report bodies are read
by `evidenceSha256`, hash-verified, bounded and checked for exact environment/actor/time/
catalog and required coverage. Report fields are version, control, target, actorSubject,
observedAt, execution, catalogSha256, checks and failedChecks. Methods and required check
sets are explicit constants in the implementation; failedChecks must be zero.

Four distinct controls are required: actual PostgreSQL 16 integration for the exact
reviewed artifact, PRODUCTION TLS/restricted identity verification, PRODUCTION rollback
drill (stop dispatch, retain data/audits, drain or reconcile uncertain work, no automatic
retry or destructive schema reversal), and PRODUCTION recovery drill (tested restore,
authority/audit consistency and immutable evidence). Mocked execution or disposable-only
production claims fail. Real disposable integration may support the integration control,
but NEVER substitutes for the other three production controls. These are attested checks,
not drills run by the read-only gate. A compromised/misconfigured trusted signer can lie:
signature validity proves provenance/integrity, not physical truth. Signers must verify
real report artifacts before signing, and key rotation/revocation is controlled by server
configuration. No unsigned/manual approval path exists.

All timestamps are nonnegative integer milliseconds. Future, expired, duplicate,
overlong-validity, missing, wrong-key/scope, contradictory or mismatched evidence fails
closed; freshness is rechecked after asynchronous live verification. Unavailable reports,
databases, clocks or rollback acknowledgement remain unverified rather than success.
Raw evidence, endpoint settings, keys, credentials and driver messages are not returned.

The gate independently acquires a verified restricted lease, rechecks the live LOGIN/TLS/
privileges, locks via existing `lookup_operation`, and reuses owner authorization. It
checks the existing candidate catalog contract and hashes exact PostgreSQL catalog text
covering both protected schemas, functions/ACLs, tables/column privileges, constraints,
indexes, triggers and RLS policies against the signed reviewed catalog digest. No object
name/ready flag alone is proof. The catalog text/digest must be produced by the trusted
verifier using the same exported SQL on the reviewed target deployment; this is not a
portable cross-database migration checksum. Every assessment rolls back and releases;
no audit/membership writes, COMMIT, migration or provisioning execution occur.

The catalog fingerprint also covers procedures/window functions, views/materialized views
and foreign relations, view definitions/security options, column privileges and rewrite
rules (including enabled state). Restricted lease mutation checks include these relation
kinds, so writable views cannot evade the base-table privilege check. This expanded
fingerprint intentionally invalidates older signed catalog reports: independent verifiers
must regenerate evidence using the current query. Offline regression checks verify query
coverage and digest mismatch behavior, not actual PostgreSQL execution of these objects.
The opt-in fresh-disposable adapter suite additionally tests actual procedure-definition
and view-security catalog changes, and a view UPDATE grant observed by a genuine restricted
LOGIN. These cases remain unverified until that suite runs on another NEW marked empty
database; no existing populated database may be reused.

Endpoint identity is a hash of host/port/database/LOGIN, NOT PostgreSQL's internal cluster
system identifier. Deployment identity, DNS/certificate control, catalog provenance,
trust-key custody, global pool budget, fresh real TLS/identity tests and real production
drills remain explicit external blockers. Assessment is point-in-time, never permission
to skip transaction-time authority/revision checks or enable a release.

Focused OFFLINE verification (no configured database needed):

```sh
npm run test -- app/lib/employee-provisioning-readiness.test.ts app/lib/restricted-postgres-provider.test.ts app/lib/postgres-server-config.test.ts app/lib/postgres-employee-provisioning-store.test.ts
npx tsc --noEmit
```

#### Inactive restricted server connection lifecycle

[restricted-postgres-provider.ts](../app/lib/restricted-postgres-provider.ts) implements the
existing `AuthorizationPostgresSource` contract without application wiring. Trusted
server code constructs one provider for one branded principal, one tenant and one
dedicated restricted LOGIN configuration; `sourceForPrincipal` rejects any different
subject, unbranded identity or tenant. The provider never chooses credentials from the
principal/request, creates database roles, issues grants, enables provisioning or falls
back to a shared/privileged pool.

The existing [configuration parser](../app/lib/postgres-server-config.ts) is now guarded
by `server-only` and supports optional private `EMPIRE_OS_SERVER_PG_TLS_CA`. The provider
requires verified TLS (minimum TLS 1.2), validates CA certificates, explicitly verifies the
configured hostname, and confirms TLS on the backend. No plaintext/local bypass is added.
Existing host/port/database/user/password environment keys remain unchanged; the optional
CA does not make absent required settings valid. Generic/public PostgreSQL environment
variables are not used for credentials. Fixed startup options, replication=false and UTF8
prevent pg's ambient `PGOPTIONS`/`PGREPLICATION`/encoding fallbacks.

Acquisition verifies exact database/session/effective LOGIN, primary-server status,
restricted role attributes, no reachable role memberships or protected-schema/table
mutation privileges, and exactly one actor/tenant binding visible for the LOGIN. This is
deliberately stricter than the existing multi-tenant fixture roles. Database authorization
and post-lock revalidation still run inside the existing adapters; lease checks are not
a replacement for them or protection against a malicious database administrator.

Each lazily created pool allows at most two checked-out connections with bounded
connection and server-query/transaction-idle timeouts. A lease owns one transaction and
supports the stores' promise text/values query overload, exact READ COMMITTED BEGIN,
existing timeout SET LOCAL statements, SELECT calls and COMMIT/ROLLBACK. Concurrent lease
queries, re-entry, role switching, multiple statements and use after release are rejected.
Every physical lease is destroyed on release, even after confirmed success: session state
cannot leak into a later transaction or tenant. This trades TLS/login overhead for a
small, reliable lifecycle; safe physical-session recycling is intentionally not added.
SQLSTATE is retained for adapter mappings; driver messages/detail/causes are not exposed.

Client failures invalidate the lease. Pool failures mark the provider unavailable and
invalidate active leases. `dispose()` is idempotent, blocks new acquisitions, destroys
active leases and ends the pool. Disposal during COMMIT may make its result unknown;
existing adapters must continue to reconcile rather than retry. The server composition
owner must retain/reuse the provider for that identity scope and explicitly dispose it
on shutdown or credential rotation; no global unbounded principal cache or process hooks
are introduced. Overall provider-count limits, production role/secret lifecycle and
verified TLS infrastructure remain deployment responsibilities.

Provider tests use a mocked driver; they do NOT verify real TLS negotiation, PostgreSQL
catalog results, pool timing or deployment. Focused validation:

```sh
npm run test -- app/lib/restricted-postgres-provider.test.ts app/lib/postgres-server-config.test.ts app/lib/postgres-authorization-store.test.ts app/lib/postgres-employee-provisioning-store.test.ts app/lib/postgres-provisioning-reconciliation.test.ts
npx tsc --noEmit
```

#### Inactive provisioning outcome reconciliation

[server-employee-provisioning-reconciliation.ts](../app/lib/server-employee-provisioning-reconciliation.ts)
and its [Clerk composition](../app/lib/clerk-employee-provisioning-reconciliation.ts) reuse
verified principals, server-owned tenant configuration and per-principal restricted
connections. Both the server boundary and the
[reconciler](../app/lib/employee-provisioning-reconciliation.ts) retain the hard-disabled
migration 005 release interlock. No route, production wiring, replay or resubmission is
introduced.

The caller must retain the EXACT original validated input and request SHA-256; an optional
known transaction UUID further fences identity. The hash is independently recomputed from
the existing server-bound request serialization. No submitted actor/tenant/readiness claims
are accepted. The shared PostgreSQL reconciliation store now supports a server-owned
catalog-check query, executed inside its restricted READ COMMITTED transaction before
`lookup_operation`. It holds the existing tenant serialization lock, reads actor-scoped
immutable evidence, and ALWAYS rolls back. Lost rollback acknowledgement invalidates the
observation and destroys the connection. SQL `READ ONLY` mode is not used because PostgreSQL
does not allow the required `FOR UPDATE` serialization lock in that mode; no data mutations
or COMMIT are issued.

Outcome guarantees:

- `verified-committed`: exactly one allowed provisioning audit matches the original actor,
  tenant, operation ID, hash, transaction/decision identifiers, founder decision, requested
  subject/roles, audit dataset, times and expected revision + 1. Locked authority must have
  reached that revision and retain the employee; at that exact revision the membership
  must be active at revision 1 with the exact roles. Later legitimate revocation or role
  reassignment does not erase historical commit proof or imply current employee access.
- `verified-not-committed`: the authorized, committed, complete actor/operation lookup has
  no audit AND locked authority revision has irreversibly passed the original expected
  revision. A prior successful commit would have retained its audit; a delayed original
  request can no longer pass its revision fence. This result authorizes NO automatic retry.
- `unknown`: absent evidence at the original/future expected revision, database/contract
  unavailability, incomplete/unconfirmed observation, or authentication-service failure.
  An existing matching membership NEVER establishes original operation success.
- `integrity-conflict`: inconsistent fingerprint, database actor/tenant, evidence linkage,
  effects, duplicate records or impossible revision/state. Do not treat this as permission.
  Rejected authentication/current founder authority returns `unauthorized`.

The negative proof relies on the immutable complete actor-scoped lookup, monotonic tenant
revision and exact revision fencing; it is NOT a claim based on audit absence alone.
Unavailable current actor membership/tenant authority may deliberately prevent resolving
historical outcomes. No durable dispatch journal or provisioning activation is added.

Offline reconciliation tests and the shared store's existing tests:

```sh
npm run test -- app/lib/employee-provisioning-reconciliation.test.ts app/lib/postgres-provisioning-reconciliation.test.ts app/lib/authorization-reconciliation.test.ts app/lib/postgres-authorization-store.test.ts
npx tsc --noEmit
```

Two additional cases in the opt-in real adapter suite exercise actual committed-audit
reconciliation after simulated acknowledgement loss and absent-evidence reconciliation
before/after a real authority advance. They require ANOTHER newly created marked empty
adapter database for each run and are unverified until executed. Offline tests model
database observations; they do not verify PostgreSQL or live Clerk authentication.

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
Successful operation IDs must not produce a second effect. Authorized reconciliation
under fresh authorization is implemented (see migration 003 above); a live caller/route
that uses it remains a future integration step.

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
the authorization model alone does not implement all PostgreSQL store-conflict or
database durability semantics. The separate durable repository model covers import
source validation, atomic staging, idempotency and uncertain outcomes, but remains a
unit model rather than executable PostgreSQL evidence.

No actual transactional database enforcement is implemented or verified by these tests.
The import repository has a transactional unit model, but candidate SQL has not been
executed against PostgreSQL. Candidate 006 changes existing audit/trigger contracts and
adds a SECURITY DEFINER staging function; it creates no new tables and remains inactive.
No runtime role grant, provider, endpoint or live writer is installed. The existing
populated disposable integration database is untouched.
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

The existing `import_sources.canonical_source` column belongs to the separate generation
schema described above and is not used by candidate 006. Version-2 import plans use a framed, registry-ordered SHA-256 protocol over UTF-8 keys and exact UTF-16LE value bytes, with
explicit null/string tags and code-unit lengths. Candidate 006 independently recomputes
this digest from the hex-encoded request before writing. This preserves NUL and lone
surrogates without coercing them through PostgreSQL text or JSONB. Raw values are never
normalized or reserialized.
Import generation and idempotency metadata are outside the unchanged version-1 backup
format. Candidate 006 stores the exact submitted request in the existing immutable audit
row and the 21 raw values in `preparation_writes`; this is staging evidence, not a durable
independent backup. Backup exports must use a consistent database snapshot and emit all 21 exact
strings/nulls. Recovery snapshots and external-backup receipts are separate legacy
evidence, not silently included in or discarded by a business-data import.

Migrations 001–005 do not permit database-enforced import staging. Candidate 006 adds
complete 21-key validation, source-digest recomputation, tenant/actor/import authorization,
an uninitialized-target check, and atomic audit plus all-store insertion through the
existing transaction. Candidate SQL has only static/offline parser coverage so far:
these database guarantees remain unverified until a new disposable PostgreSQL candidate
integration suite passes. It does not activate a dataset, change generations, modify
migrations 001–005 or update existing business `store_values`.

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

`stageImport` is implemented in the dormant repository path. It recomputes the request
and source fingerprints, verifies the full snapshot, requires import plus read
authorization, and uses an empty-target check followed by atomic audit/21-store staging.
Candidate 006 binds the exact UTF-16LE source values to the source digest and records them
with immutable authorization evidence. Every success path—including exact replay and
reconciliation after an uncertain COMMIT acknowledgement—requires a fresh authenticated
read-back matching all 21 exact values, revision 1 and commit sequence 1. Replay receipts
retain the hash of the exact request recorded at commit, even if policy revision has since
advanced. Replays are exact-key and exact-request only; collisions fail closed. The
implementation does not allocate a new generation, alter the current generation, activate
storage, migrate browser data or provide independent backup/recovery. Those are separate
future decisions.

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

Candidate 006 additionally requires a separate, explicitly approved integration run on a
**new empty disposable database** after migrations 001–004. A dedicated test helper must
apply the candidate only in that suite; it must not enter ordinary migration/startup
flows. Before any candidate approval, real adapter tests must prove: valid 21-store import
and exact read-back (including null, empty, NUL, paired/lone surrogates); DB-side rejection
of a forged source digest; malformed/incomplete/duplicate stores; occupied target;
idempotent exact replay and conflicting replay; actor/tenant/dataset mismatch; failure
after partial insert and atomic rollback of rows plus audit; lost COMMIT acknowledgement
followed by locked exact reconciliation; role grants/default denial; and registry order
and byte-level hash parity with TypeScript. They must use fresh disposable PostgreSQL databases, separate migration and restricted
runtime identities, and must not touch the existing
populated integration databases. No such candidate PostgreSQL test has yet been executed.

### Candidate 006 real PostgreSQL v9 verification

[stage-import-v9.postgres.integration.test.ts](./tests/stage-import-v9.postgres.integration.test.ts)
is a dedicated opt-in suite, separate from the shared v1–v8 configurations. It accepts
only the fixed one-use database `empire_os_test_stage_v9_20261013_1754`, on literal
loopback, with the exact marker `empire-os-stage-import-v9-disposable-only`, PostgreSQL
16, and dedicated `EMPIRE_OS_STAGE_V9_TEST_PG_*` settings. Before any migration, it
checks database/user/marker/primary/version, requires a superuser belonging only to the
disposable local cluster, takes its own advisory lock, and verifies there are no
non-system schemas or public objects. Any mismatch or existing object stops setup; there
is no reset or rerun path. It applies exactly migrations 001–004 and candidate 006, never
005. The candidate remains ungranted to PUBLIC; runtime test logins receive only the
specific tenant-scoped reads and reviewed function EXECUTE privileges used by this
adapter, with no direct DML rights.

Use a newly provisioned isolated local PostgreSQL 16 cluster. These commands are
instructions only; do not point them at any shared cluster, port-forward, prior v1–v8
database, or existing `empire_os_test_stage_v9_20261013_1754` database. Choose a
test-only password for the local superuser and enter it at the prompt:

```sh
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"
export STAGE_V9_CLUSTER="$(mktemp -d /tmp/empire-os-stage-v9.XXXXXX)"
initdb -D "$STAGE_V9_CLUSTER" --username=empire_os_test_owner \
  --auth-local=scram-sha-256 --auth-host=scram-sha-256 --pwprompt
pg_ctl -D "$STAGE_V9_CLUSTER" -l "$STAGE_V9_CLUSTER/server.log" \
  -o "-h 127.0.0.1 -p 55439" start

read -rs "EMPIRE_OS_STAGE_V9_TEST_PG_PASSWORD?Disposable PostgreSQL password: "; echo
export EMPIRE_OS_STAGE_V9_TEST_PG_PASSWORD
PGPASSWORD="$EMPIRE_OS_STAGE_V9_TEST_PG_PASSWORD" createdb \
  --host=127.0.0.1 --port=55439 --username=empire_os_test_owner \
  empire_os_test_stage_v9_20261013_1754
PGPASSWORD="$EMPIRE_OS_STAGE_V9_TEST_PG_PASSWORD" psql \
  --host=127.0.0.1 --port=55439 --username=empire_os_test_owner --dbname=postgres \
  --set=ON_ERROR_STOP=1 \
  --command="COMMENT ON DATABASE empire_os_test_stage_v9_20261013_1754 IS 'empire-os-stage-import-v9-disposable-only'"
```

From `apps/web`, set `EMPIRE_OS_STAGE_V9_TEST_PG_HOST=127.0.0.1`,
`EMPIRE_OS_STAGE_V9_TEST_PG_PORT=55439`,
`EMPIRE_OS_STAGE_V9_TEST_PG_DATABASE=empire_os_test_stage_v9_20261013_1754`,
`EMPIRE_OS_STAGE_V9_TEST_PG_USER=empire_os_test_owner`, and
`EMPIRE_OS_STAGE_V9_TEST_PG_CONFIRM=empire_os_test_stage_v9_20261013_1754:empire-os-stage-import-v9-disposable-only`.
Supply the test-only password through `EMPIRE_OS_STAGE_V9_TEST_PG_PASSWORD`, then run:

```sh
npm run test:postgres:stage-v9
```

The suite intentionally leaves the migrated database and generated role fixtures in
place. Its strict empty-database guard makes this exact one-use database non-rerunnable;
do not drop/reset it. A future verification must receive a separately reviewed unique
v9 database name/configuration and a new empty local instance. After the run, stop only
the cluster created above and clear the shell variable:

```sh
pg_ctl -D "$STAGE_V9_CLUSTER" stop
unset EMPIRE_OS_STAGE_V9_TEST_PG_PASSWORD
```

Coverage includes TypeScript/PostgreSQL v2 digest parity over all 21 registry keys and
database rejection of a well-formed request with a forged source digest,
null/empty/NUL/paired and lone surrogates/NFC-vs-NFD values, exact authenticated
read-back, source-bound replay and key conflict, occupancy in both legacy `store_values`
and authorization `preparation_writes`, malformed and incomplete SQL payloads,
tenant/actor/capability denial, membership revocation, injected mid-loop database
failure with audit-and-row rollback, actual COMMIT followed by simulated lost
acknowledgement and immutable-audit reconciliation, competing concurrent imports,
default-PUBLIC execute denial, restricted-login privilege flags, direct evidence
read/DML denial, and SET ROLE escalation denial.

The integration file and SQL parser/static tests have not been run here. A successful
run is necessary but not sufficient for activation: the suite uses a superuser only for
isolated schema/fixture/test-trigger setup, does not test TLS or pool identity lifecycle,
and does not certify backup/restore or production durability. Candidate 006 remains
inactive and requires independent SQL review before any runtime grant or deployment.

No local PostgreSQL service/configuration was established for this increment, and no
terminal probes were run. Database availability and all database guarantees above remain
unverified. The unit suites exercise only pure contracts, raw codecs, candidate/import
validation and registry parity; the registry test reads SQL as text, not as executable SQL.

## Next approval boundary

The durable dataset repository (migration 004 above) is implemented but not activated.
Activation still requires: verifying 004 on a NEW disposable PostgreSQL 16 instance;
an approved authentication provider and session resolver; per-actor restricted runtime
login roles with `GRANT EXECUTE` on `lock_authority`, `apply_operation`, `lookup_operation`
and `read_dataset_snapshot`; a decision on read auditing; and explicit approval of a route.

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
