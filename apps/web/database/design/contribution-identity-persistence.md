# Phase 6: restricted identity persistence candidate

## Status and boundaries

This is an **inactive, unvalidated implementation**, not a deployment approval.
No database has been contacted, no SQL has been executed, no migration runner entry,
API route, Server Action, live binding, business-data change or browser-storage
change is included. The release interlock has no environment override.

The repository reuses the Phase 5 validator and planner. It does not replace Clerk,
People or the existing membership/permission model. The production verifier,
authoritative People loader and trusted approval issuer are deliberately **not
installed**. The implementation cannot perform a live write without those
dependencies, a reviewed bootstrap and separate release approval.

## Implementation

- [postgres-contribution-identity-store.ts](../../app/lib/postgres-contribution-identity-store.ts):
  restricted transaction orchestration, request canonicalisation, trusted issuer
  record preparation, locked Phase 5 replanning, receipt verification and replay.
- [contribution-identity-release.ts](../../app/lib/contribution-identity-release.ts):
  disabled by default; caller input and environment cannot approve release.
- [contribution-identity-persistence-candidate.sql](./sql/contribution-identity-persistence-candidate.sql):
  schema/API candidate, **an alternative to, not an upgrade of**, the Phase 5 shape.
  It requires the existing isolated authorisation foundation (001-004), rejects an
  existing identity schema, installs no grants and remains outside migrations.
- The restricted provider and transaction role checks now also reject unsafe
  privileges/ownership on the identity schema.

## Two trust domains, one policy

The restricted runtime login is bound to a verified Clerk principal and one tenant
by the existing provider. It must not own schemas, inherit privileged roles, issue
approval records or directly read/write identity tables.

A separately installed trusted issuer must call `prepareIdentityPersistenceApproval`
using verified principals, authoritative People/membership data and a branded
independent-verification claim. It records the resulting exact request, planner
decision, independent verifier subject, evidence hash/reference, issuer reference and bounded expiry in
`approved_operations`, using a separate trusted connection. No runtime path can
mint these records. An arbitrary approval ID, client role or supplied plan establishes
no authority. The candidate's owner is this trust root, never an application login.

The runtime repository revalidates loaded history and calls the **same Phase 5
planner** under database locks, using independently loaded authority. SQL compares
the whole resulting plan to the protected issuer record and checks current database
role, membership, capabilities, policy revisions, affected membership fences and
independent approver authority. It is not a second TypeScript permission engine.
Before reading history, structural checks require the expected owner-bound definer
functions, forced RLS, unique indexes and enabled evidence/statement/expiry triggers.
These checks are necessary safeguards, not proof of a reviewed migration or release.

**Current scope limitation:** Phase 5 requires complete global history for replay
and uniqueness validation. SQL will not return that history to a tenant-only
administrator: the runtime actor must have explicit active identity administration
and membership in every tenant represented in history. This is narrower than the
planner's affected-tenant permissions and is intentionally default-deny, not an
implicit founder entitlement. A revoked historical tenant also blocks this full
history reader. Before supporting tenant-only delegated administrators at scale,
provide a reviewed minimised reader/global-uniqueness proof, or explicitly restrict
this repository to globally authorised identity administrators. Do not remove the
coverage check merely to make a tenant-specific operation succeed.

Plans include timestamps. For deterministic issuer/runtime agreement, SQL returns
the issuer's checked time; the observation provider must freshly resolve authority
under the held locks and bind its observation to that checked time. Actual database
time independently rejects future/expired approvals, including at COMMIT. Issuer
expiry is the earliest of observation validity, actor/approver reauthentication
expiry and identity-proof expiry. A provider must not extend validity or replay old
People/session observations to match a ticket.

This two-stage design adds an issuer round trip and operational trust boundary.
It avoids granting a runtime login the ability to fabricate its own approval or
verified evidence. A protected issuer record is evidence of an already verified
decision, not a substitute for implementing independent verification.

## Transaction guarantees intended by the candidate

1. BEGIN READ COMMITTED using the existing restricted transaction helper.
2. Lock the singleton global registry.
3. Lock the authorisation tenants table in SHARE ROW EXCLUSIVE mode, then tenant
   rows in sorted order. This freezes complete cross-organisation membership
   discovery against existing provisioning paths that do not take an identity lock.
4. Derive the actor from the restricted database role; require current membership
   and identity administration, including for replay.
5. Load and strictly validate the registry. For a new operation, independently
   reload trusted authority and replan. Reject changed expected revisions; do not
   rebase, silently retry or transfer role grants.
6. Consume the exact protected approval. Atomically append one event, update the
   current binding/admin projections, revoke all affected memberships, increment
   their policy/membership revisions and append existing-format authorisation audit
   rows linked to the identity event.
7. Commit only after the database's deferred expiry and audit checks pass.

Active subjects and Persons are globally unique. Operation IDs, event IDs,
registry revisions, verified-proof use and transaction/event relationships are
uniquely constrained. Complete original event payloads, actors, approvers, proof
references and issuer records remain append-only. Revocation removes only the
current binding projection; it does not rewrite historical Person attribution,
contributions, evidence or agreements. Administrator grant tombstones remain.
No existing tenant owner list is transferred during recovery.

The table lock is a deliberate **coarse correctness safeguard**, not a high-scale
claim: identity changes temporarily serialize against tenant mutations globally.
Existing transactions may deadlock rather than observe a partial change; SQLSTATE
deadlock/serialization/lock failures return conflicts after confirmed rollback.
Before scaling, establish a shared lock contract across provisioning, tenant
creation and identity changes, then replace this lock with measured narrower fences.
The complete JSON history is also a correctness-first, O(history) loader; pagination
or checkpoints require an independently verified replay design.

## Outcomes, replay and external effects

Only acknowledged COMMIT produces `committed`/`replayed` with
`transaction-commit-confirmed`. A lost COMMIT acknowledgement returns `unknown`
and discards the connection; a later exact request can reconcile by returning the
original receipt without repeating the transition. Changed content under the same
operation ID is denied. Revoked membership/administration cannot inspect receipts
through this API; exceptional investigation needs a separate audited recovery path.
Missing/corrupt storage, failed observation and unconfirmed rollback are explicit
failures, never success-shaped defaults. No driver error detail is returned.

Clerk session invalidation cannot be atomically committed by PostgreSQL.
`session_revocations` durably records required work in the same identity transaction;
membership and grant removal take effect immediately in database authority checks.
`requiresSessionRevocation` does **not** mean Clerk has completed invalidation.
A trusted retrying worker with durable completion evidence and recovery procedures
is required before activation. No worker is installed here.

## Recovery and activation prerequisites

Before any activation:

1. Review the alternative schema, trusted-issuer boundary, capability grants and
   authorisation-audit compatibility. Do not apply both identity candidates.
2. Establish an authoritative, complete server-side People source and tie changes
   affecting identity eligibility to transactional revision fences. Never accept
   browser People records as authentication.
3. Install an independent verifier, session-freshness resolver and trusted approval
   issuer. Protect their credentials separately from runtime logins. No issuer
   credentials may reach the web client or this restricted repository.
4. Bootstrap explicit Founder/System Owner authority, initial verified bindings and
   independent recovery approvers through a reviewed, audited offline process.
   Ensure history and all projections agree. There is no runtime bootstrap bypass.
5. Implement and verify the session-revocation worker/completion ledger.
6. On a genuinely NEW, never attempted disposable database, validate SQL, restricted
   roles, row security, every operation, transaction failure, concurrency and backup
   restoration. A skipped integration suite is not verification.
7. Back up and restore registry history, approvals/proof references, binding/admin
   projections, tenant states/audits and pending session invalidations as one
   consistent PostgreSQL snapshot. Do not independently restore a stale registry or
   resurrect revoked grants. Verify projection/history consistency before reopening.
   External Clerk state must be reconciled; a database restore cannot un-revoke
   or safely resurrect Clerk sessions.
8. Only after review and validation, version a migration and separately approve
   release. This work supplies no activation flag, credentials or deployment action.

The shortest safe route to shared multi-user functionality is the People authority,
verifier/issuer and session invalidation first; then isolated transaction verification,
reviewed bootstrap and controlled migration; finally a narrow authenticated server
boundary that returns minimised results. Contribution collection/report endpoints
remain separately gated and must use durable current bindings, not Phase 4's
injected preview observations.

## Tests supplied, not executed

- Offline driver tests cover the disabled interlock, forged principals, source
  binding, planner reuse, rollback, corrupt results, replay and uncertain COMMIT.
- Offline SQL/PLpgSQL parser and structural tests plus isolated configuration tests.
- [identity-persistence.postgres.integration.test.ts](../tests/identity-persistence.postgres.integration.test.ts)
  covers restricted SQL, concurrent exact requests, binding/replay, content conflicts,
  tampered plans, delegation/revocation, reassignment, membership audit and durable
  session-invalidation work, plus rollback and lost COMMIT acknowledgement/replay.
  It uses the existing marker, advisory lock and empty database safeguards and never
  cleans up by resetting/deleting databases or roles. Only after those guards pass,
  it permanently consumes the disposable database marker before the first migration;
  a later setup failure cannot make that database eligible for another attempt.

The integration suite uses only dedicated `EMPIRE_OS_IDENTITY_TEST_PG_*` settings:
`HOST`, `PORT`, `DATABASE`, `USER`, `PASSWORD`, `CONFIRM`. No settings means skip.
Require literal loopback, a new `empire_os_test_identity_` name and the existing
disposable marker/confirmation. Never reuse a database from any previous attempt,
even a failed setup. Provisioning, connection and test execution are left to the
operator. Integration's provider-brand/release substitutions are test-local;
loopback testing does not verify the production TLS provider or approve release.
