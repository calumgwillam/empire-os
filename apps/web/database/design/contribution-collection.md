# Contribution Intelligence - Phase 4 secure collection foundation

## Status: inactive preview, not a collection service

This phase defines and tests submission/review orchestration without installing a
writer. There is no production UI, API endpoint, Server Action, PostgreSQL connection,
SQL/migration, localStorage change, automatic tracking or live employee collection.
Business data, restoration/recovery and compensation/equity remain unchanged.

Files:

- [contribution-collection-workflow.ts](../../app/lib/contribution-collection-workflow.ts):
  strict binding/permission observations, submission previews, correction proposal/
  approval previews, disclosure preflight, operational evidence candidates and pure
  idempotency reconciliation.
- [clerk-contribution-collection.ts](../../app/lib/clerk-contribution-collection.ts):
  server-only, uninstalled composition with the existing verified Clerk resolver.
  No default infrastructure, route or storage implementation.
- [workflow tests](../../app/lib/contribution-collection-workflow.test.ts) and
  [Clerk composition tests](../../app/lib/clerk-contribution-collection.test.ts):
  synthetic adversarial cases; added, not executed.
- [individual-contribution.ts](../../app/lib/individual-contribution.ts):
  exports the existing strict event-body decoder, now reused by collection requests.
  Event formats, replay and existing validation behaviour are unchanged.

The collection workflow imports the existing server principal boundary (Node runtime),
not a client-side authority mechanism. Pure here means preview/model logic without
business writes, I/O or clocks; the injected authority wrapper may resolve a session
and read an observation, but has no writer dependency.

## Inspected architecture and the highest-leverage gap

The current People model has stable IDs and organisational role/access/manager/
responsibility descriptions. These are not authenticated account bindings.
Actions can carry `ownerPersonId`, but also legacy name ownership and editable
completion evidence/date/status. Projects have stable IDs, mostly textual ownership,
review ownership, related Actions and status. None is proof of time invested,
independent quality or exclusive outcome attribution.

[Phase 1](./individual-contribution.md) provides strict event validation, immutable
identity, append-only correction/dispute history, independent corroboration,
canonical outcomes and version-pinned allocations. [Phase 2](./contribution-intelligence.md)
provides evidence-qualified person-period analysis; its personal agreement/deadline
overlay is not yet durable accepted history. [Phase 3](./contribution-dashboard.md)
provides read models, not permission to disclose their sensitive contents.

The existing Clerk resolver uses verified server `auth()` and mints principals
through the established server boundary. Existing provisioning establishes tenant
membership/roles, **not a contribution Person binding**. Existing PostgreSQL
authorisation protects dataset read/write/import and provisioning; those broad
capabilities do not define who may corroborate another person's time, approve a
founder's allocation, correct a claim or disclose evidence.

**Priority before more contribution features:** establish a durable, governed
subject-to-Person registry and purpose/row/evidence policy, consistent with the
same transaction that accepts contribution events. Without it, additional UI or
generic dataset writes would give apparent accountability without authenticated
provenance or controlled disclosure.

## Trusted observations and actor binding

Collection accepts only principals recognised by the existing minted-principal
registry. Plain objects, copied principals, request headers, People roles and
client actor fields do not substitute. The Clerk wrapper always supplies the
verified Clerk resolver, even if runtime infrastructure attempts to override it.

A trusted injected loader must resolve, consistently and freshly:

- exact tenant/dataset scope;
- current purpose policy and monotonic policy revision;
- active Clerk subject -> Person binding and monotonic binding revision;
- complete contribution ledger/head and reference/evidence snapshot;
- server observation time and nonexpired policy validity.

The preview enforces exact scope, reference cutoff, known bound Person, unique
subject binding and no active aliases for the same Person. Account merges,
impersonation, historic identity correction and multiple-account linking require
a separately governed process; names/email/role matching is never a fallback.
The initial one-active-subject-per-Person rule is deliberately conservative.
Former people remain historical subjects; actor access depends on active binding
and explicit policy, not merely being present in the People reference list.

These runtime checks validate structure and consistency, not provenance of a loader.
There is no installed trusted loader, durable binding registry or new authority grant.
Production must reload and enforce binding, membership, revocation and policy under
the write transaction, not trust an earlier preview or caller-supplied snapshot.

## Workflow and separation of responsibilities

Permission is explicit by authenticated subject, business and purpose, optionally
restricted to a set of subject Person IDs. `null` person scope means an explicit
business-wide server grant; an empty list grants nobody. A restricted person grant
cannot operate on an unassigned organisational result. No managerial hierarchy,
founder override, role-label inheritance or privilege from ownership is invented.
All subjects, including founders/heads, follow the same independence checks.

| Stage | Purpose and behaviour |
| --- | --- |
| Submit own activity | `submit-own`; actor must be bound to the subject. Reported work/evidence is not verified contribution. |
| Report for someone else | Separate `submit-on-behalf`; target Person scope required. Audit actor remains reporter, not the named subject. |
| Register result | `submit-result`; one canonical Phase 1 origin/identity, not one result per participant. |
| Propose shared allocation | `propose-allocation`; exact result/participation versions, explicit shares, no automatic redistribution or reward. |
| Set role standard | `define-expectation`; no automatic personal acceptance or deadline agreement. |
| Corroborate time | `corroborate-time`; separate actor/custodian, version-bound minutes, no duplicate/conflicting corroboration. |
| Review result/allocation/expectation | Separate purposes; independent known actor and non-self-reported evidence. Generic review of an activity record is not supported. |
| Propose amendment | `propose-correction`; exact replacement/version/reason/evidence, no ledger append yet. |
| Approve amendment | `approve-correction`; a different authenticated, uninterested actor approves identical content under unchanged proposal fences. |
| Open dispute | `open-dispute`; append-only recourse, including an evidence-free dispute against an existing poorly evidenced claim. |
| Resolve dispute | `resolve-dispute`; separate independent resolver/evidence, no automatic erasure of historical dispute. |
| Withdraw | Separate `withdraw`; explicit reason/evidence, never deletion or revival. |
| Disclose | Separate own, business-summary and evidence purposes; preview still returns `mayDisclose: false`. |

Independent review excludes authors and current/historical interested beneficiaries,
including participants/allocations that no longer appear in a current link.
Incoming correction beneficiaries and both old/new result dependencies are considered.
A self-interested founder cannot approve their own outcome/allocation or corroborate
their own time. Review scope must cover all affected participants; narrowing the
requested view does not hide collaborators from integrity checks.

Submission validation reuses the Phase 1 body decoder, append preview and full-history
report. Collection does not calculate a competing result count, time sum, allocation
or contribution rating. It additionally checks new-event evidence descriptors and
purpose/independence requirements. Unsupported references, overlapping time and
contradictory corroboration fail closed for new claims/corroboration. Review approval
cannot turn disputed/stale/unsupported outcomes or allocations into supported results.
Explicit review rejection remains an audit event, not approval.

Dispute opening, rejection and withdrawal are not blocked simply because the original
claim is unsupported. New supplied evidence must still resolve and all permissions/
version fences apply. Resolving a dispute does not invent absent evidence or clear
other disputes. Corrections preserve disputes and invalidate old version support under
the existing domain rules.

## Correction approval: intentionally not durable yet

Direct `corrected` submission is refused. A proposal contains the original decoded
correction, scope, proposer subject/Person and request fences in an opaque ephemeral
handle. Copied/JSON-forged handles fail closed. Approval requires:

- separate operation/event identity and distinct subject/Person;
- identical correction content and original ledger/head/policy/binding fences;
- proposer still actively bound and still authorised;
- independent approver permission over all affected subjects;
- normal Phase 1 replacement/version/evidence validation.

A competing append, binding change or policy revision requires reconciliation and
a new proposal; there is no automatic rebase or content edit during approval.
Multiple approvals can be previewed: a handle is **not single-use execution authority**.

The returned plan includes proposer and approver provenance. The existing Phase 1
correction event has only one actor (the approver in this preview), so that event
alone cannot durably retain the proposal actor as a historical interested author.
**Writing only `plan.event` would be incomplete and is prohibited by the activation
design.** Before execution, design durable proposal/rejection/approval records,
atomically retain both actors/exact content/fences, and integrate proposal authors
into future independence evaluation. Do not silently extend existing stored formats
or discard the extra provenance through the older generic append contract.

## Concurrency, duplicate requests and rejected writes

Every command pins operation/event identity, policy revision, binding revision,
global ledger revision/head and body content/version. The server constructs actor,
sequence, previous-event identity and recorded time. The preview returns dependency
entity-version fences and exact decoded request content, never a commit receipt.

Two valid previews may compete against the same head. A real adapter must atomically
serialize acceptance; after one append, the other must conflict. A preview is not
CAS, exclusion, durable reservation or permission to call a generic dataset writer.

`reconcileContributionOperation` is a pure decision model:

| Locked registry observation | Non-executing next step |
| --- | --- |
| Absent | Reserve/check identity under the transaction lock, not permission to write now. |
| Same scope/operation/actor/content, in flight | Wait and reconcile; never create a replacement identity. |
| Unknown outcome | Reconcile the exact original request after in-flight work settles. |
| Commit confirmed | Verify and replay the authoritative receipt after fresh access checks. |
| Rejected with no write | Return recorded rejection; do not silently retry as a new request. |
| Changed scope/actor/content under reused identity | Refuse identity reuse. |

Caller observations are not durable acknowledgements. The model returns
`mayWrite: false` and `establishesDurability: false` even for a claimed commit.
The future registry must key by scope/operation, bind the authenticated actor and
server canonical request hash, retain original event/receipt/rejection, and enforce
unique identities transactionally. A retry must not regenerate a new timestamp or
event and call it the same original request. Validate the actual transaction receipt,
policy/binding/scope/content and authoritative event before reporting success.

Authorisation failures, malformed input and preview refusals append nothing.
Future denied/rejected requests need a separate privacy-safe security/decision audit,
not fabricated successful contribution events. Unknown commit is not proven rollback.

## Operational sources as evidence, not automatic accounting

`prepareOperationalContributionEvidence` accepts an explicit Action/Project source
ID, business ID, observed status and one immutable work-record evidence reference.
It validates source resolution and descriptor identity/revision/hash/availability,
returning a **context-only candidate** with all proof/automatic-creation flags false.

The future server must independently read/authorise and retain the actual source
snapshot bytes, verify its hash and version and bind the source identity/status to
those bytes. This preview does not fetch or authenticate content. The descriptor's
existence does not prove that a supplied status matches a stored snapshot.

Completed Actions, Project reviews and delivery evidence can support inspection of
what was delivered and when, subject to canonical origin/result review. They do not
prove hours, quality, causation, accepted personal commitments or equal participation.
No owner-name matching, capacity-to-hours conversion, completion-to-outcome import,
surveillance or live record bridge is added. Financial results still need the
existing Phase 1 financial-record evidence and separate review.

## Exact shortest safe deployment sequence

1. **Govern identity/policy first.** Approve a durable tenant/dataset/subject-to-Person
   schema, provisioning/revocation/account-linking process, contribution purpose/row/
   evidence policy, independent reviewer/resolver assignment and privacy/recourse.
   Existing employee membership provisioning does not implement this binding.
2. **Close historical provenance gaps.** Specify durable correction proposal/approval/
   rejection audit and interested-author handling, plus versioned personal commitment
   acceptance and deadline changes required by Phase 2. Agree retention/redaction and
   source snapshot/evidence custody. Review formats before any migration.
3. **Approve isolated storage design.** Design separate contribution ledger/evidence/
   operation/proposal/binding tables and constraints, transactional fences and
   restricted runtime-role access. No SQL or tables are supplied/applied in this phase.
   Do not funnel contribution events through browser localStorage or broad dataset writes.
4. **Implement a server-only adapter offline first.** Compose verified Clerk identity
   with server-owned scope and a consistent complete observation. Enforce membership,
   binding, purpose/row/evidence rights and independence inside the same transaction
   as the append/operation/proposal audit. Require exact versions/head, canonical
   identity uniqueness and confirmed COMMIT receipts; never treat preview as a grant.
5. **Test a newly designated disposable database.** Obtain explicit approval before
   any migration or live connection. Existing documented integration databases are
   nonempty and must not be reset, cleared or rerun. Use a separate fresh target.
   Exercise restricted roles/RLS, concurrent first writes/approvals/revocations,
   duplicate/reused IDs, connection/COMMIT loss, locked lookup and rollback.
6. **Prove recovery and disclosure.** Test backup/restore, evidence retention,
   complete-ledger/source consistency, policy/binding revocation and output-level
   minimisation. Keep restricted collaborators in server aggregation without
   exposing their data to private views. Audit every disclosure and drilldown.
7. **Add narrowly authorised endpoints only after gates pass.** Explicitly gate
   contribution collection separately from existing founder page access. Apply
   request/origin/CSRF controls as appropriate, size/rate limits, authentication,
   fresh policy/Person binding and safe errors. Do not pass founder packets to
   employees and hide fields in UI.
8. **Controlled opt-in pilot.** Use agreed subjects/reviewers, manual evidence-based
   submissions and visible dispute/correction recourse. Pilot read/disclosure before
   writes, then deliberately enable approved collection only. No automatic tracking,
   pay, equity, employment or authority changes. Observe and refine before scaling.

## Validation boundary

Adversarial tests cover founders/heads/employees, fabricated/copied principals,
client authority claims, revoked/ambiguous bindings, scope/reference mismatch,
missing grants, independent corroboration/review, disputed outcomes, canonical
allocations, correction proposal tampering/revocation/concurrent edits, exact fences,
duplicate events/corroborators, operational source substitutions, private disclosure
and idempotency replay/unknown/rejected observations.

Tests, TypeScript validation commands and production builds were not run. No terminal,
Git, PostgreSQL, SQL/migration or production-data operation was performed.
Editor diagnostics/source inspection are not test execution, backend enforcement,
transaction verification or a claim of operational readiness.
