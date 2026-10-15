# Individual contribution architecture — Phase 1

## Status and boundaries

This is an **inactive domain foundation**, not an employee-monitoring system, payroll
system, equity register, authorisation service or durable source of truth yet.
Nothing imports it into production UI, hydration, existing business stores or
automatic tracking. It has no localStorage key, database table, adapter, migration,
network call, timer, collection agent or execution side effect.

The objective is better organisational memory, fairer evidence-based human
judgement, clearer accountability and long-term Empire value. Reported hours,
corroborated time, participation, responsibility, deliverables, measurable outcomes,
quality, initiative, finance and long-term enterprise value remain distinct.
There is no weighted productivity score, leaderboard, hours-to-value conversion,
automatic reward, negative employment decision or entitlement calculation.

The implementation lives in:

- [individual-contribution.ts](../../app/lib/individual-contribution.ts): versioned
  identities, audit events, validation, replay/as-of projection and append previews.
- [individual-contribution-reporting.ts](../../app/lib/individual-contribution-reporting.ts):
  evidence-aware period summaries, unique organisational results, reviewed attribution,
  role expectations and cautious comparisons.
- [individual-contribution-persistence-contract.ts](../../app/lib/individual-contribution-persistence-contract.ts):
  future server dependency types and explicit enforcement prerequisites; no adapter.
- [individual-contribution.test.ts](../../app/lib/individual-contribution.test.ts):
  synthetic, adversarial offline tests. These tests were added, **not run** here.

## Inspected prior art and compatibility

[Contribution Intelligence Phase 2](./contribution-intelligence.md) adds a pure,
inactive analytical layer over this foundation, with explicit personal agreements,
delivery observations, comparisons and trends. It does not change stored formats
or activate collection, dashboards or reward decisions.

Existing People records have stable `id` values but operational role, manager,
pillar and access-level descriptions are not authenticated server authority.
Actions support `ownerPersonId`, while older ownership/project/accountability paths
also contain name-based labels. Action responsibility outcome evidence already
distinguishes contribution modes and reviewed/unresolved assertions. Projects carry
stable identities, reviews, linked actions and execution-authority descriptions.
Delivery capacity measures planned workload/availability; those estimates are not
actual contribution time. Organisational health measures ownership/delegation, not
individual economic value.

This foundation reuses the existing responsibility participation type and canonical
operating pillar identities. It does not infer people from names, infer a department
from a pillar, treat a strategic theme as an operating pillar, or turn planned hours,
an Action's Completed status, a founder label or an ownership field into contribution
evidence. Existing responsibility evidence and business records are not imported,
rewritten or reclassified automatically.

There is not yet an authoritative business/department/operational-role identity
registry in the inspected paths. Explicit reference snapshots prepare those links;
they do not create an organisation chart or grant permission. Unknown/missing links
remain visible. Role, department, project, Action and financial source references
are explicitly business-scoped; the existence of an ID in another business does not
resolve the local reference. Historical/former people must remain referenceable without requiring
them to be active employees. Person kind supports founder, department head, employee,
contractor, partner and unclassified people across multiple businesses, without
changing review independence or inventing contractual relationships.

The existing server authorisation/persistence contracts distinguish verified
principals from browser People records, tenant policy revisions from dataset fences,
and confirmed COMMIT receipts from requests/unknown outcomes. The future contribution
repository must compose with those server-side boundaries. New design-purpose strings
are **not** installed capabilities or extensions to current authorisation grants.

No existing format, localStorage inventory, backup schema, migration, server endpoint,
runtime caller or persisted record changes. No data conversion is needed.

## Stable identities and time

One ledger belongs to an explicit tenant/dataset scope and may include multiple
businesses. Identities are explicit nonblank bounded strings, never names or array
positions. Operational references are business, Person, role, department, project,
Action and optional canonical operating pillar IDs.

Every event has a unique event ID, contiguous sequence, previous event ID, reporting
actor Person ID and integer millisecond `recordedAtMs`. These are **assertions** until
a trusted server binds the actor and timestamp. Every entity starts at version 1;
corrections increment its content version. Every append also advances the global
ledger revision, including reviews/disputes that do not change content versions.

Work periods use explicit UTC epoch half-open intervals `[startMs, endMs)`. Reports
use the same boundaries; adjacent periods do not overlap. A work record straddling
a report boundary is flagged and not automatically prorated. Explicitly correcting
or separately recording evidence-grounded segments is future human work, not an
automatic split. Shared results use their own occurrence timestamp, independent of
when participants invested effort. This supports delayed outcomes without rewriting
work dates or assigning outcome value to the period in which hours were logged.

`nowMs` validates observation chronology; `asOfMs` projects the audit prefix known
then. A late correction changes current views without rewriting old as-of views.
Reference/evidence snapshots must carry the same scope and exact as-of time.
The full supplied audit is validated even for historical queries. There is no
implicit clock, generated ID, inferred historical department or silent default.

## Independent dimensions

A Person-linked contribution record contains business/role/department/work links,
category, participation mode, work interval, exact evidence references and one measure:

| Measure | Meaning and limits |
| --- | --- |
| Hours | Nonnegative integer reported minutes, no more than elapsed time. Reporting is not corroboration or value. |
| Deliverable participation | Explicit link to one canonical deliverable; multiple participants do not create multiple deliverables. |
| Outcome participation | Explicit link to one canonical measurable outcome; no implied equal share or proof of causation. |
| Financial participation | Link to one separately classified financial result; not personal earnings or automatic financial credit. |
| Quality | Stated criteria plus meets/exceeds/needs-improvement/not-assessed; no cross-role numerical quality score. |
| Initiative | An evidence-linked account of initiative, not proof that it created a realised outcome. |

Ownership/lead/executor/contributor/support/reviewer describe participation context,
not server authority, legal responsibility or reward allocation. Role and department
are work-time context; later legitimate corrections retain their original versions.
Wrong subject/business/measurement identities cannot be silently transferred through
an edit. An erroneous record may instead be withdrawn with reason and evidence,
while its history remains auditable.

## Evidence, corroboration and review

References pin an evidence ID, positive revision and SHA-256 fingerprint. The
reference snapshot describes source class, custodian Person, recording time and
available/missing/restricted status. No evidence content, external URL, surveillance
signal, tracking feed or attachment fetch is performed. Duplicate evidence revisions,
accessors, sparse lists and unsupported fields are refused rather than coerced.

Missing, unavailable, inaccessible, mismatched, future, unknown-custodian or
self-reported-only corroboration evidence is explicit uncertainty. A hash binds
bytes only if the eventual custodian actually verifies and retains those bytes.
An `available` descriptor does not prove retrieval, truth, authentication, source
independence or physical durability.

Hours corroboration is a distinct version-bound event. The subject and every content
author are ineligible to corroborate that record. The corroborator must supply
evidence; reporting checks known identities and at least one non-self-report source
outside the interested subjects/authors. Repeated corroboration by the same reviewer
is refused. Agreeing reviewers corroborate one quantity, never additive quantities.
Disagreeing reviewers produce uncertainty, not a maximum/minimum/average.

Reported minutes, the known corroborated subset, partially corroborated records,
reported minutes without corroboration, and records with no usable corroboration
are separate outputs. A total corroborated figure is null if any included time record
has unresolved corroboration; the explicitly labelled subset remains available.
Zero is a real observation, not a replacement for missing observations.

Overlapping time claims are flagged across businesses and period-straddling records.
They remain reported claims but do not contribute supported time. Adjacent intervals
are not overlaps. No background clock, GPS, screenshots, keystrokes, attendance
inference or external monitoring is introduced.

Results, allocations and expectations have separate review events. Creators,
correction authors and allocation beneficiaries cannot approve their own assertions.
Reporting also checks historical outcome participants and beneficiaries: deleting or
correcting a participation link cannot make an interested reviewer independent.
Conflicting/rejected reviews are not outvoted automatically. These deterministic
separation rules support review but cannot establish server permission or detect
collusion, duplicate real-world identities or hidden conflicts of interest.

## One outcome, separate participation, explicit allocation

Every shared organisational result has one stable identity and source identity:
scope-wide origin type/source ID/result key, with an explicit primary business.
The same origin cannot be introduced under another result ID or business, even after
withdrawal. Upstream source IDs must be properly namespaced, not local display numbers.
Deliverables, outcomes and financial
results are counted uniquely from the canonical result registry, not by summing
Person participation counts.

Different source keys can still describe the same real-world outcome. A future
authoritative registry and human duplicate-resolution process must enforce canonical
identity across imports, businesses and aliases. The pure model cannot discover
semantic duplicates or turn caller-supplied identifiers into organisational truth.
Participation and its canonical result must currently use the same explicit business.
Cross-business work must name the result's primary business deliberately; no automatic
revenue split, business ownership transfer or consolidated financial attribution is
inferred. A future cross-business consolidation model must preserve the single result.

There is at most one versioned allocation entity per result. It binds:

- the exact result content version;
- the exact contribution participation versions supporting beneficiaries;
- explicit unique Person shares in integer basis points (1 basis point = 0.01%);
- a rationale and immutable evidence references;
- an independent, evidence-backed review of that allocation version.

Each nonzero share is explicit. Shares may sum to less than 10,000 but never more.
No share is inferred from hours, titles, number of participants, ownership labels
or equal participation. An allocation correction clears its reviews; an outcome or
bound participation correction invalidates previous allocation support until the
appropriate allocation version is corrected and reviewed again.

Numerical attribution is effective only when the result and allocation are independently
reviewed, referenced evidence/context are usable, beneficiary participation resolves,
and disputes do not block it. Any unresolved participation dispute blocks attribution,
including a participant with no proposed numerical share. A pending/stale/disputed/
unsupported allocation has **no effective shares**, with all 10,000 basis points
explicitly unallocated in the current analytical view. This does not erase the
historical proposal, declare a legal redistribution, or settle the dispute.

Collaborative attribution is evidence-informed human judgement, not a claim of
mathematically proven causation or long-term enterprise value. Allocation granularity
does not mean the organisation possesses that level of certainty. Governance may
later require coarser shares or additional independent reviewers.

## Financial arithmetic and uncertainty

Money is explicit nonnegative integer minor units, a three-letter currency, an
explicit minor-unit scale and a separate financial kind (revenue, cost, cost-saving,
capital contributed, loss avoided). Recorded, reported and estimated bases never
merge. Currency syntax is validated; no exchange rate, default currency, ISO currency
metadata lookup, inflation adjustment or implicit netting is supplied.

Buckets remain separate by business, currency, scale, kind and basis. They show
canonical reported amounts separately from independently reviewed amounts. A recorded
financial result needs financial-record source evidence before analytical support.
An independently reviewed estimate is still an estimate, not cash, profit, audited
accounts or money owed to an individual.

An allocation does not multiply organisational totals. Person rows list financial
participations, not repeated copies of the entire amount. Reviewed financial shares
and unallocated amounts use exact integer arithmetic and represent fractional minor
units as whole minor units plus a numerator over 10,000. Fractions are retained, not
rounded away or silently redistributed. This is analytical arithmetic, not settlement
or a payroll instruction. Unsafe aggregate integer overflow refuses the report.

## Corrections, disputes and audit

Creation, correction, review, corroboration, dispute opening, dispute resolution and
withdrawal are append-only events. Corrections preserve IDs, source identity, old
content and historical evidence. They never mutate old events; content changes clear
old reviews/corroboration. Authorship/interested-person history is retained.

A dispute has its own unique identity. It remains open across corrections until an
independent resolver records an evidence-backed supported/not-supported finding at
the current version. The claimant, content authors and interested beneficiaries cannot
resolve it themselves. An adverse finding blocks support of that version. A later
corrected version may establish new support without deleting the adverse history.
Duplicate resolution and dispute-ID replay are refused.

Withdrawals retain everything and exclude current work/results from active totals.
They cannot silently revive a record or free its identities for reuse; dispute
history can still be appended. Reinstatement, duplicate merging, transfer to another
Person/business and exceptional audit redaction require separately reviewed policies,
not destructive edits in this foundation.

## Role expectations, reports and future dashboard seams

Expectations have explicit role/business/department, version, period, evidence and
criterion statements. Effort, corroboration, deliverable/outcome participation and
initiative may carry explicit minima; quality/financial criteria require contextual
human review rather than a scalar target. No standard or target is seeded.

Only matching recorded role context participates; no employee is assigned a role
because a plan exists. Overlapping plans, late creation/correction/review, missing
evidence and mismatched periods are flagged rather than applied automatically.
There is no implicit proration or retrospective rewriting of a person's standard.
A numerical comparison to a stated minimum describes recorded observations only.
It is not a complete performance verdict; report coverage is never assumed.

Period reports provide per-Person/business dimensions, role contexts, issue codes,
canonical results, allocation/unallocated shares, financial buckets, expectation
comparisons and people without included records. No-record is not zero value or
proof of inactivity. Reports may prepare founder-wide and department-head views,
but those are data seams only, not authorised dashboards.

Comparisons recompute both reports from validated histories/reference snapshots.
They require the same scope, explicit Person/business, equal-length nonoverlapping
periods, consistent role/department context and usable observations. Deltas describe
recorded time/participation/initiative, not quality, financial worth or an ordering of
people. Quality/financial interpretation remains human review. Missing evidence,
partial boundaries or different contexts make comparisons uncertain/noncomparable.
`coverage-not-established` is always explicit; no completeness attestation exists yet.

## Server access, privacy and durable integration requirements

Before production activation:

1. Establish durable operational-role, department, business and stable Person
   registries, including former people, contractors, partners and historical
   assignments. Bind authenticated subjects to Persons on the server. Client
   actor fields, founder labels and kind classifications grant nothing.
2. Define explicit capabilities for own reporting, on-behalf reporting, own access,
   scoped management summaries, evidence inspection, corroboration, reviews,
   standards, correction and dispute resolution. Enforce fresh tenant/dataset/
   business/row/evidence access and revocation **in the committing transaction**.
   Founder-wide organisational visibility requires server-granted scope, not a
   browser bypass. Department-head access must not reveal other departments'
   private evidence or identity details.
3. Separate reporter, evidence custodian, reviewer, beneficiary, resolver and
   authorisation administrator responsibilities. Pure checks are necessary but
   insufficient; policy must establish actual authority and conflicts of interest.
   Define appeal, independent founder review, reviewer eligibility, fair standards,
   reasonable workloads and protection against retaliation.
4. Use an atomic append transaction covering policy/person-binding fences, the
   exact ledger revision/head, entity/result/participation versions, uniqueness
   constraints, server actor/time and one audit/idempotency receipt. Every writer
   must share the enforcing lock/order. Enforce unique operation/event/entity/
   source/allocation/dispute identities durably. No last-writer-wins, revision
   reset, implicit merge or automatic rebase.
5. Persist only after server validation of all relevant evidence and current
   disputes. Pin immutable evidence revisions/hashes with access controls,
   retention, backup/restore and tested crash safety. Caller-supplied evidence
   descriptors, a complete-looking ledger or an append preview prove none of this.
6. Return confirmed transaction receipts only after COMMIT. On unknown outcome,
   retain the exact operation/request and reconcile under the same scope lock
   with fresh authorisation. Never invent a new operation ID and duplicate work.
   No adapter, database table, migration, reconciliation implementation or real
   atomicity guarantee is supplied in Phase 1.
7. Define purpose limitation, appropriate lawful basis/notices, data minimisation,
   subject access/correction/appeal, retention schedules, sensitive evidence
   handling and jurisdiction-specific privacy obligations. Avoid storing medical,
   protected-trait, family or surveillance information in contribution narratives.
   Do not log full ledgers/evidence, expose them to public telemetry, or send them
   to third-party analytics/AI by default.
8. Separate privacy-controlled evidence content from the immutable audit identity.
   Future lawful deletion/redaction/retention obligations need a reviewed protocol
   preserving a permitted audit explanation without retaining prohibited payloads.
   Append-only does not override law. No destructive redaction is implemented here.
9. Aggregate from a complete, authorised source before applying permitted summary
   projections. A department-filtered/event-filtered ledger cannot prove no hidden
   disputes, independent review or complete totals. Do not send the complete ledger
   to a client and rely on UI filtering. Authorise evidence dereferencing separately.
10. Establish reporting coverage, upstream duplicate resolution, financial evidence
    validation, measurement limitations and real concurrency/crash/revocation tests.
    Full replay is a reference implementation, not a production storage strategy.
    Index append history and source/participation dependencies; any future
    incremental/materialised views must preserve these semantics and support
    rebuilds against an authenticated revision/head. No arbitrary size/capacity
    guarantee or authenticated anti-truncation checkpoint is provided here.
    A single scope-wide append order is deliberately conservative and may become a
    throughput bottleneck; future partitioning must preserve cross-business identity,
    overlap detection, allocation dependencies and complete dispute visibility.

## Rewards, contracts and ownership

Contribution evidence and reviewed attribution may inform human discussions about
recognition, responsibilities, development, compensation, rewards or potentially
equity. They never automatically change legal ownership, contractual entitlements,
pay, employment status or authority. All operational results explicitly report these
effects as false.

Any future reward/equity decision must be a separate authorised human decision with
reasoning, legal/contractual review, consent/approvals where required and its own
audit. Attribution is neither an entitlement nor a proxy for a cap table.

## Validation status and unresolved truth boundaries

Adversarial tests cover structural malformation, source identity, stale revisions,
competing append previews, corrections/as-of history, disputes, interested reviewers,
overlapping time across businesses, missing/restricted/future evidence, duplicate
outcomes/allocations, allocation caps/dependencies, exact money, role standards and
cautious comparisons.

No tests, build, terminal commands, PostgreSQL access or Git operations were performed
for this implementation. Editor diagnostics and source inspection are not a passing
test suite. The user-provided baseline remains a reported checkpoint, not something
independently reverified here.

Most importantly: pure validation establishes consistency of supplied evidence-linked
assertions. It cannot establish factual truth, human independence, real-world outcome
uniqueness, lawful access, durable immutability, complete reporting, absence of hidden
events or enforceable concurrency. Those remain explicit production prerequisites.
