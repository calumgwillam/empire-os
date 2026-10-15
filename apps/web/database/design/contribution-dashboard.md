# Contribution Intelligence - Phase 3 founder read model

## Status and boundaries

This is a reusable, inactive presentation/decision-support foundation. There is no
new dashboard component, route, browser integration, collection, surveillance,
storage adapter, schema, migration, database access or reward execution.
Existing business data, localStorage, hydration, People, Actions, Projects,
accountability, organisational health and founder access behaviour are unchanged.

Implementation:

- [contribution-dashboard.ts](../../app/lib/contribution-dashboard.ts) provides
  validated source preparation, founder projection, minimised person projection,
  disclosure prerequisites and design-only reward scenario capabilities.
- [contribution-dashboard.test.ts](../../app/lib/contribution-dashboard.test.ts)
  adds synthetic adversarial offline tests. Tests were not executed here.
- [Phase 1](./individual-contribution.md) remains the authoritative domain model.
- [Phase 2](./contribution-intelligence.md) remains the person-wide analytical engine.

The existing [page](../../app/page.tsx) authenticates with Clerk and checks the
configured founder before rendering the existing client dashboard. That guard is
not contribution-specific row/evidence authorisation, and no new data is passed
through it. People role/kind/access labels are not authenticated principals.
Existing accountability and organisational-health metrics measure operational
ownership/delegation; their scores are not repurposed as individual contribution
or reward scores. Existing founder relationship intelligence is also separate.

## Validated source boundary

[Phase 4 collection readiness](./contribution-collection.md) adds inactive authenticated
submission/review/disclosure previews and documents the durable binding, policy,
correction audit and transaction gates required before using these read models with
live multi-user data. It does not activate this dashboard or grant disclosure access.

`prepareContributionDashboardSource` accepts the existing Phase 2 analysis input,
invokes Phase 2 validation/analysis and Phase 1 projection/reporting at the exact
same scope, audit cutoff and source revision. It preserves detached, frozen source
snapshots. No caller-supplied aggregate or `validated: true` flag is accepted.

The result is an opaque in-memory source handle, associated privately with those
snapshots. A raw, copied or JSON-serialised handle cannot be used as a validated
source. This prevents accidental presentation of unvalidated or mismatched
aggregates; it is **not authentication, durable provenance, a capability token or
server authority**. A caller who supplies a structurally valid but untrue ledger
does not thereby establish truth, completeness, custody or genuine agreement.
Handles are ephemeral and require preparation again after serialisation/reload.
The private WeakMap performs no business persistence or external side effect.

`buildFounderContributionDashboard` projects a prepared source and explicit
selection into frozen data. Inputs are not modified/frozen. Invalid source,
ambiguous selection, unsupported fields, getters, sparse arrays, cross-business
references and noncanonical pillar selections return explicit safety-shaped refusals.

## Two distinct analytical planes

### Person-wide Phase 2 plane

Each person-period row retains its **unchanged Phase 2 row** under `personWide`.
This includes:

- exact reported hours, complete corroborated time or unknown, and supported subset;
- personal agreed commitments, role minima, reasons, responsibilities and shortfalls;
- narrowly supported contribution IDs, reviewed attributed participation, quality
  and initiative assertions;
- deliverables, outcomes and financial participation with reviewed shares;
- explicitly agreed delivery timing and its limited denominator;
- evidence completeness, disputes, uncertainty and bounded reward-review inputs.

Founder, department-head, employee, contractor, partner, unclassified and unknown
subjects use the same rules. Labels never increase evidential weight or privilege.
Stable IDs are identities; display names and current People roles are not guessed.

Person/period selection restricts rows and comparison participants. Whole trends
and sustained imbalances are included only if **all** their supporting periods
and subjects are selected; they are not clipped into a different historical claim.
The original trend policy is returned. No trend is recomputed, score invented,
shortfall converted into culpability or missing data turned into zero.

Dimension filters do not alter these person-wide quantities or assessments.
Person-wide comparison/trend/notice fields are explicitly labelled as such.
They must not be rendered as department/pillar/project-specific judgements.

### Record-derived dimension plane

Department, operating pillar, organisation and project selection uses explicit
associations on validated **Phase 1 records**, never ratios of person-wide totals.
Organisation means the existing contribution `businessId`, not an inferred legal
entity, employer, chart node or business pillar. Departments/projects are qualified
by business ID. Operating pillars use only canonical operating-pillar IDs, not
strategic themes, functional areas or People free text.

Filter semantics:

- `null` axis means unrestricted; an empty list means match none.
- Values within an axis are OR; different axes are AND.
- An explicit null department/project/pillar value selects records with that exact
  missing association. Missing is not inferred or converted to all.
- Unknown IDs and cross-business reference mismatches are refused as selections.
- Unresolvable record associations remain listed separately even when a known
  filter cannot place them. They are never guessed into that filter.

Selected time is the sum of included, matching time records. Corroboration comes
from the original **full-period Phase 1 assessments**, so narrowing a filter cannot
hide cross-business overlaps, contradictions, unavailable evidence or disputes.
Partial corroboration remains its exact observed quantity; a supported subset
cannot stand in for a complete total. No records means unknown time, while an
explicit supported zero remains zero. Boundary-straddling work is excluded and
listed without proration. No agreed commitment, deadline reliability or trend is
proportionally assigned to a department, project or pillar.

The dimension plane also returns evidence-supported counts, exact record/trace
references, qualitative assertion IDs and reviewed attributed participation IDs.
Support is not generic independent verification of quality or enterprise value.
There is no false confidence percentage or completeness attestation.

## Attribution and shared outcomes

Attribution explicitly separates:

1. **Direct:** a record has explicit resolved dimension associations, without an
   attribution dispute. Direct association alone does not prove the record true.
2. **Spanning dimensions:** one canonical shared result is linked to participation
   records with different explicit contexts. A single Phase 1 record still carries
   one context; multiple records are not fabricated from a person's totals.
3. **Unallocated:** one or more dimension associations are absent. Missing-dimension
   flags remain visible even if a result also spans other dimensions.
4. **Ambiguous or disputed:** unresolved associations, open/current adverse disputes
   or blocked reviewed allocation. Spanning and missing flags are retained too.

Result membership uses matching participation, including effort outside the result
occurrence period. The result appears once per selected period/selection, not once
per person. Narrowing to one person/pillar **does not remove** other participants'
dimension contexts, disputes or allocation blockers from the founder assessment.
Results without participation are explicitly unplaced (`unscopedResultIds`), not
members of the current dimension merely because the filter is active.

A spanning result may legitimately appear in multiple separate filtered views.
Those views must never be summed as exclusive outcome value. No numerical result
value, financial share or contractual ownership is automatically allocated across
departments/projects/pillars. Effective person shares remain Phase 2/Phase 1
reviewed, version-bound observations, not dimension shares or reward entitlement.
Unallocated shares are not redistributed.

## Explainability and summaries

Record metrics identify source record/version/context and original assessment
issues. Trace packets bind entity kind/version, audit event IDs and exact evidence
ID/revision/hash references, including historical corrections/reviews/corroboration.
Collaborative result traces retain related participation/allocation history even
when a historical participant's current link changes.

Commitment assessment traces pin agreement ID, expectation ID/version, criterion,
responsibilities, supporting records and evidence. Delivery traces include the
canonical outcome and collaborative dependencies. Supplied agreement/deadline
evidence remains an analytical observation, not a trusted durable acceptance.

Founder notices distinguish absent records, no matching dimension records,
insufficient evidence, recorded shortfall, unsettled expectations/responsibilities,
unresolved disputes, meaningful person-wide change and sustained person-wide
imbalance. Notices identify subjects, periods and assessment IDs; all underlying
measurements/reasons and original trend directions remain inspectable. A recorded
shortfall or ratio imbalance is not a performance, fault or enterprise-value verdict.

## Privacy-aware person-specific projection

`buildContributionPrivatePersonView` is a separate explicit allowlist projection.
It returns one requested subject's period boundaries, source cutoff/revisions,
hours, numeric dimension metrics, limited own agreement measurements, reliability
counts and count of disputes on that subject's own contribution records.

It omits other-person comparisons, global facets, shared result/allocation/money
details, peer identities/dispute details, evidence hashes and founder trace packets.
Restricted collaboration may still affect support; its details are not disclosed
merely to explain a count. This is minimisation, not proof against inference from
otherwise disclosable facts. IDs and even aggregate counts may still be sensitive.

Both projection functions remain **non-authorising**. Any code with a prepared
source can request either function; no public endpoint or People-kind gate is
installed. A future server must choose the allowed projection after resolving the
authenticated principal and binding that principal to the subject.

Strict requirements are exported as `CONTRIBUTION_DASHBOARD_ACCESS_REQUIREMENTS`:

- freshly authorise tenant/dataset/business/person/field/evidence access and
  revocation on every request, including cache hits, exports and drilldowns;
- bind private requests to the verified subject; explicit separately audited
  permission is needed to act on behalf of someone else;
- aggregate a complete authorised source server-side before disclosure filtering;
  do not discard restricted collaborators from the underlying integrity checks;
- never send a founder packet/global facets to an employee browser and rely on
  hidden UI fields; minimisation must occur before serialisation/disclosure;
- fence policy, Person bindings, source, agreement/deadline and evidence versions;
  audit disclosures and avoid cross-subject/cross-tenant shared browser caches;
- do not treat existing founder route checks, Person kind, supplied selection or
  opaque source handles as contribution-specific access grants.

Real durable source reads, evidence custody/retention, immutable agreement/deadline
history, complete-ledger attestation, concurrency and confirmed transaction
semantics from Phases 1/2 remain blockers. No adapter or new grants are added here.

## Future reward/profit-sharing scenarios

`CONTRIBUTION_DASHBOARD_SCENARIOS` is a design-only capability/prerequisite
descriptor. There is **no scenario calculator, payout, profit pool distribution,
percentage recommendation, ownership change or compensation workflow**.

Future scenarios must separately establish a human-approved purpose, participants,
period, evidence and reviewed attribution; verified distributable profit/budget,
currency, contracts and legal/financial approval; conflicts, disputes and recourse;
and explicit sensitivity/missing-evidence disclosure. Reported/corroborated hours
must not automatically become pay weights. Contribution allocation is not an
employment contract, equity entitlement or profit-sharing agreement.

Any future scenario remains a reversible human-review packet with recorded
assumptions/alternatives, separate from an authorised final decision or execution.
All existing contribution safety flags remain false for activation and changes to
pay, ownership, employment or authority.

## Validation status

Tests cover source forgery/detachment/immutability, all subject kinds, strict and
business-qualified selections, record-derived split quantities, partial/zero/
unknown time, explicit missing associations, canonical pillars, spanning outcomes,
nonselected collaborator disputes, boundary exclusions, corrections/as-of queries,
delivery/evidence traces, whole-history trend selection and private-view minimisation.

Source inspection and editor diagnostics are not execution verification. No tests,
TypeScript validation command, production build, terminal, Git operation or database
operation was run for this phase. No passing test count is claimed.
