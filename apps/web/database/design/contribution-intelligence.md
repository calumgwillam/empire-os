# Contribution Intelligence - Phase 2

## Status and purpose

This is an **inactive, pure analytical foundation**, not an operational dashboard,
collection service, employee rating system or reward engine. Its purpose is to
support transparent human judgement and long-term Empire value without equating
hours, seniority, visible activity or a numerical allocation with personal worth.

Implementation:

- [contribution-intelligence.ts](../../app/lib/contribution-intelligence.ts):
  `analyseContributionIntelligence`, strict analytical input contracts, person-period
  measurements, explicit agreement comparisons, delivery observations and trends.
- [contribution-intelligence.test.ts](../../app/lib/contribution-intelligence.test.ts):
  synthetic adversarial offline tests, added but **not executed in this phase**.
- [individual-contribution-reporting.ts](../../app/lib/individual-contribution-reporting.ts):
  additive per-record evidence/context assessments and exported reference decoder;
  existing Phase 1 result, evidence, corroboration and allocation rules are reused.
- [Phase 1 architecture](./individual-contribution.md) and
  [future persistence contract](../../app/lib/individual-contribution-persistence-contract.ts):
  unchanged domain/audit and durable-authority boundaries.

No runtime caller, production UI, route, adapter, background tracking, network
access, localStorage field/key, business-store mutation, database table, migration,
restoration activation or interruption-marker operation is introduced. No data
migration is required. Existing People, Actions, Projects, accountability,
authorisation and persistence behaviour remains unchanged.

## Inspected foundations and architectural choice

People IDs are explicit subjects, not authenticated principals. Action ownership
can have a Person ID, but legacy name ownership, Project ownership, Action status,
planned capacity, founder status and organisational role descriptions do not prove
actual time, accepted commitments, timely delivery or complete reporting.

Phase 1 already validates append-only corrections/disputes, reference resolution,
evidence availability, independent time corroboration, unique organisational
results and reviewed version-pinned allocations. Reimplementing those decisions
would create competing definitions of truth. Phase 2 instead rebuilds Phase 1
reports for each requested period and one all-history result catalogue at a
single explicit audit cutoff.

A role expectation is not evidence that an individual accepted a schedule or
deadline. The smallest safe extension is an **explicit analytical overlay** of
person commitment agreements and delivery observations. These inputs are not new
persisted entity types, trusted receipts, authority or proof that agreement actually
occurred. No existing operational record is automatically converted into them.

## Input, identity and historical boundaries

[Phase 3 founder read model](./contribution-dashboard.md) consumes validated analysis
without changing these person-wide totals. Dimension filtering derives separate
metrics from explicit Phase 1 records, with spanning/unallocated/disputed attribution,
trace packets and a separately minimised person-specific projection. No UI is activated.

The caller supplies one ledger, a scope-matched reference snapshot, a unique set
of Person IDs, named nonoverlapping half-open periods, agreements, delivery
observations, `nowMs`, `asOfMs` and an explicit trend policy. There are no implicit
clocks, generated identities, default full-time commitments or arbitrary ratings.

Unknown selected IDs receive explicit unknown rows. Known people without work
records receive unknown time (`null`), not zero contribution. Empty selections
remain empty. Individual rows cover precisely the selected people; organisational
result totals still cover the supplied ledger, not a sum of selected individuals.
This is not an access-control filter and must never be used as one.

IDs, own data fields, dense lists, counters, evidence references, periods, duplicate
agreements and duplicate delivery tuples are validated. Malformed/ambiguous input
returns an explicit non-executing refusal. Semantic uncertainty remains visible
in analysed rows rather than being coerced to zero or silently discarded.

All periods use a common `asOfMs`. Late corrections/disputes can change an earlier
work period in a current analysis, while an earlier audit-prefix analysis retains
the earlier version and corroboration. The entire supplied ledger is validated,
including events later than the cutoff. Source and observed revisions are both
returned. Historical reference snapshots must use exactly the same cutoff/scope.

Agreement/deadline inputs are not yet append-only or audit-versioned. Historical
analysis therefore means **ledger-as-of plus the explicitly supplied analytical
overlay**, not independently authenticated historical agreement state. Timestamps
alone cannot prove when the overlay was actually recorded. Production use remains
blocked on immutable/versioned agreement and deadline provenance.

## Personal commitments versus role standards

An agreement binds:

- stable person, business, role and nullable department identities;
- an exact reporting interval;
- expectation identity, version and criterion;
- explicit responsibility IDs;
- personal `agreedMinutes`, separately from the role criterion's minimum;
- acceptance time, independent review identity/time and evidence references.

Different people in the same role may agree different commitments. They share the
same role expectation without inventing overlapping role plans to represent
part-time arrangements. Personal schedules are not automatically derived from a
role minimum. The exact expectation content version must already exist when the
person accepts it; acceptance/review and role standards must be prospective.

Unsupported, disputed, withdrawn, stale, retrospective or context-mismatched
expectations do not create comparable commitments. Unknown/self/interested review,
missing/unavailable evidence, unspecified responsibilities, overlapping personal
agreements in the same business, role/context changes and incomplete time evidence
are explicit blockers. An agreement covering only part of a reporting interval is
not silently prorated. Concurrent roles within one business require a future
explicit allocation-of-responsibility design, not guessed division of the same time.

The initial normalised commitment measure is deliberately restricted to reported
or corroborated minutes. Quality, initiative, financial value and outcome counts
are not reduced to interchangeable numerical commitment targets.

## Separate measurements and their meaning

| Output | Meaning and limitation |
| --- | --- |
| Reported minutes/hours | Recorded assertions, including explicit zero; never automatically independent or value. |
| Corroborated minutes/hours | Phase 1 independent, version-bound, nonconflicting time support; incomplete total is `null`, supported subset remains visible. |
| Recorded fulfilment | Exact observed minutes / personal agreed minutes, only with settled comparable context; no weighted commitment score. |
| Recorded shortfall | Supported observed quantity below the explicit agreement; not proof that all work was reported or that someone underperformed. |
| Evidence-supported record IDs | Phase 1 record/context support, not generic independent verification of all contribution or value. |
| Corroborated time IDs | Narrow independent time support, separate from other assertions. |
| Reviewed attributed participation IDs | Exact version-pinned participation with effective reviewed allocation; no inferred equal share. |
| Qualitative assertion IDs | Quality/initiative records for evidence-aware human review, not independent proof merely because an ID resolves. |
| Deliverables/outcomes/financial results | Canonical organisational identities counted once by result occurrence period, separate from work effort period. |
| Reliability | Timing of explicitly evidenced agreed deliveries, not attendance, all promises, personal fault or an employment rating. |
| Evidence completeness | Availability of unique referenced evidence and current record support, not factual truth or reporting coverage. |
| Disputes/attribution uncertainty | Related open disputes, adverse findings, blocked/unallocated results, boundary records and issues. |

Minutes-to-hours output retains exact `{numerator: minutes, denominator: 60}`
fractions. Complete absence is not conflated with an explicit zero. Overlapping
time, cross-period records, contradictory corroborators and stale corrections
never yield a favourable selected quantity or invented proration.

Recorded fulfilment fractions preserve their original numerator/denominator; zero
agreed minutes produces no ratio. Shortfall is only calculated when comparison
evidence is usable. `actualUnderperformance` always remains
`not-established-requires-complete-evidence-and-human-context`. Complete reporting,
context, accommodations, changing priorities, opportunity, causation and fair human
review are unavailable here. This deliberately distinguishes observed shortfall
from a personnel verdict.

## Collaborative outcomes and financial separation

Phase 1 remains the sole authority for canonical result counting and numerical
allocation support. Participant counts are not added together as outcomes.
Participation does not automatically imply a share. Reviewed allocations must pin
the exact result/participation versions, total at most 10,000 basis points and
remain supported despite disputes and corrections. A disputed nonselected
participant can still invalidate attribution for the selected person's result.

Unallocated shares are not redistributed. Corrections retain audit history and
invalidate stale pins/reviews as Phase 1 specifies; a dispute survives correction
and requires explicit independent resolution. Result occurrence and effort dates
remain separate, including delivery completed in a later reporting period.

Financial buckets retain business, currency, minor-unit scale, financial kind and
reported/estimated/recorded basis. Person shares retain exact whole minor units and
the remainder over 10,000. There is no currency conversion, rounding redistribution,
valuation, entitlement or mapping to personal earnings. Semantic deduplication of
two different upstream IDs describing the same real-world outcome is still an
upstream human/authority requirement.

## Delivery reliability and dependency visibility

A delivery observation binds one agreement/responsibility, result/version, explicit
due time, prospective acceptance/review and evidence. Duplicate observations of the
same agreement/responsibility/result are refused rather than multiplying counts or
choosing a convenient deadline. Invalid/out-of-period deadlines remain visible as
uncertain; they are not silently omitted.

The review/evidence must be independent of the person and known historical result
authors/beneficiaries. Completion uses a current, independently reviewed canonical
result with supported person participation. Stale result pins, disputed completion,
unsupported participation, wrong business and retrospective deadlines are uncertain.
Missing time reports do not alone invalidate a separately evidenced valid delivery.

Statuses are evidenced-on-time, evidenced-late, not-yet-due,
completion-not-evidenced and uncertain. Missing completion after a due time does
not prove a missed obligation. Late occurrence establishes timing only, not culpability,
quality or failure to create value. The denominator is the supplied explicit delivery
observations, never all responsibilities or all work.

The all-history catalogue can locate completion in a later work/reporting period.
Dependency closure includes related result, allocation and participation states,
including delivery-only references outside the person's current work interval.
Related historical audit evidence, open disputes and adverse findings remain
visible. Missing agreement/delivery evidence is listed explicitly rather than
disappearing into an empty evidence-availability denominator.

## Cross-person comparisons and meaningful trends

Comparable context requires the same business, role, department, sorted responsibility
set, measurement dimension and exact expectation statement. A similar job title
does not establish comparability. Different individual agreed quantities can be
normalised; different roles or meanings cannot be automatically ranked.

Fractions are compared using BigInt cross multiplication, not rounded floating
point percentages. An explicit `minimumGapBasisPoints` in `1..10000` measures an
**absolute gap in fulfilment ratios**, not a percentage of another person's value:

`abs(n1*d2 - n2*d1) * 10000 >= minimumGapBasisPoints * d1*d2`.

For example, 1.0 versus 0.75 is a 2,500-basis-point ratio gap. A zero gap never
becomes material. This threshold is caller-declared analysis policy, not an
empirically validated measure of fairness, effort, worth or reward entitlement.

Trends require an explicit minimum of at least two consecutive, contiguous,
equal-duration, comparable periods in the same context. Missing evidence, changed
context, missing periods and unequal duration break runs. Direction is descriptive
(increasing/decreasing/unchanged/mixed); material first-to-last change is a separate
flag. Changing personal schedules remains visible in each exact fraction.

Sustained recorded shortfall requires a trailing consecutive shortfall run meeting
the policy minimum. Sustained pair imbalance additionally needs the same direction
and threshold in every period. An isolated spike or reversal is not sustained.
Trend reliability aggregates only observations bound to that trend's agreements,
not unrelated businesses or other agreement contexts. No trend means insufficient
comparable history, not stability, consistency or adequate performance.

There is no composite productivity score, global person leaderboard, automated
causal explanation, confidence percentage or prediction of future performance.
Recorded time imbalance is one limited signal, not imbalance in enterprise value.

## Bounded reward decision support

Person-period output supplies reviewed result/allocation IDs, separate measurements
and unresolved reasons. It always requires human, legal, contractual and budget
review; reporting coverage is never established. It does not produce monetary
recommendations, reward eligibility, salary/bonus/profit-share/equity amounts or
an entitlement.

All safety flags remain false for production activation and changes to compensation,
equity, employment status or authority. The output cannot grant or revoke permissions.
Founder/department-head status does not bypass evidence, privacy, independent review
or review of conflicts of interest.

## Execution-blocking integration requirements

Before collecting operational data or activating founder dashboards:

1. **Durable authoritative collection:** implement and independently test a server
   adapter for the Phase 1 contract, complete authorised audit reads, durable evidence
   retention, integrity checks, backup/restore, idempotency and confirmed commit versus
   unknown outcome. Supplied history may be truncated; hashes and revisions alone
   do not prove completeness, truth, independence or durability.
2. **Versioned agreements/deadlines:** design append-only proposal, personal acceptance,
   independent approval, correction, rejection, withdrawal and dispute histories.
   Pin versioned responsibilities, expectations, outcome identities and deadline
   changes. Preserve what was agreed when and prohibit silent retrospective rewriting.
3. **Server identity and separation of duties:** bind verified principals to Person
   subjects server-side, authorise every read/append/replay, preserve requester/subject/
   reviewer/resolver separation and evaluate historical conflicts. Browser IDs,
   founder labels, role fields and these analytical inputs are not credentials.
4. **Concurrency:** transactionally enforce scope, ledger/head/entity and agreement
   version fences, idempotency identities, unique outcome/allocation identities,
   exact reviewed participation pins and policy revisions. Two concurrent agreement
   acceptances, corrections, disputes or deadline updates must not silently replace
   each other. Unknown commits require authoritative reconciliation, not blind retry.
5. **Privacy-safe server aggregation:** resolve a complete authorised source snapshot
   before comparison. Do not hide disputed collaborators from source truth just to
   filter dashboard rows. Then apply output-level authorisation/minimisation; this
   pure module's organisational results/evidence IDs can disclose nonselected people
   and cross-business relationships. Passing a Person-ID subset is not access control.
6. **Privacy/recourse:** establish purpose, lawful collection, retention, subject access,
   correction/dispute recourse, sensitive-evidence restrictions, auditable disclosure,
   secure transport/storage and revocation. Avoid surveillance and collection of
   irrelevant personal information. Employee collection permission must not imply
   empire-wide comparison access.
7. **Reporting and fairness:** define completeness attestations, agreed opportunity/
   responsibility context, accommodations, reporting policy, outcome semantic
   reconciliation and explainable threshold governance with affected people. Until
   then absent evidence cannot establish actual underperformance.
8. **Dashboard activation:** separately design authenticated founder/department-head
   views, explicit uncertainty/drilldown and accessible period selection. Authorise
   and audit server reads; never ship unfiltered analytical packets to a browser
   merely because the UI hides fields. No existing UI is activated here.
9. **Reward decisions:** maintain a separate human/legal/financial process and authority
   boundary. No contribution append, comparison, trend or allocation may automatically
   alter pay, equity, employment, authority or a contractual obligation.

## Validation boundary

The new offline tests cover strict input boundaries, deterministic/frozen output,
unknown/absent people, unequal agreements, different roles/responsibilities, zero
targets, missing/restricted evidence, contradictory/partial corroboration,
overlaps/boundaries, unique outcomes, exact financial remainders, collaborator
disputes, correction/resolution/repinning, deadline timing, stale versions, historical
cutoffs, late outcomes and sustained trend interruptions/thresholds.

Tests, TypeScript validation commands, full suites and production builds were **not
run**. No terminal, Git, database or browser operations were performed for this phase.
Editor diagnostics and bounded source inspection are not execution verification,
durability testing, authenticated integration testing or proof that tests pass.
