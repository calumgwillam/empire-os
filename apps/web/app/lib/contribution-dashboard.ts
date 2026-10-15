import {
  analyseContributionIntelligence, type ContributionIntelligence, type ContributionIntelligenceInput,
  type ContributionIntelligencePersonPeriod,
} from "./contribution-intelligence";
import {
  CONTRIBUTION_SAFETY, contributionCounter, contributionFields, contributionId, contributionList, contributionRefusal,
  freezeContributionValue, projectContributionLedger,
  type ContributionDomainRefusal, type ContributionEntityState, type ContributionEvidenceReference,
  type ContributionPeriod, type ContributionProjection, type ContributionRecord,
} from "./individual-contribution";
import {
  buildContributionPeriodReport, decodeContributionReferenceSnapshot,
  type ContributionPeriodReport, type ContributionReferenceSnapshot, type ContributionResultSummary,
} from "./individual-contribution-reporting";
import { OPERATING_PILLARS, type OperatingPillarId } from "./pillar-identity";

const sourceBrand: unique symbol = Symbol("validated-contribution-dashboard-source");
export type ContributionDashboardSource = Readonly<{ [sourceBrand]: true }>;
type WorkState = ContributionEntityState & { entity: ContributionRecord };
type Source = Readonly<{
  intelligence: ContributionIntelligence;
  projection: ContributionProjection;
  references: ContributionReferenceSnapshot;
  reports: readonly ContributionPeriodReport[];
  records: readonly WorkState[];
}>;
const sources = new WeakMap<ContributionDashboardSource, Source>();

export type ContributionDimensionSelection = Readonly<{
  personIds: readonly string[] | null;
  periodIds: readonly string[] | null;
  organisationIds: readonly string[] | null;
  departments: readonly Readonly<{ businessId: string; id: string | null }>[] | null;
  operatingPillarIds: readonly (OperatingPillarId | null)[] | null;
  projects: readonly Readonly<{ businessId: string; id: string | null }>[] | null;
}>;
export type ContributionDimensionContext = Readonly<{
  businessId: string;
  departmentId: string | null;
  pillarId: OperatingPillarId | null;
  projectId: string | null;
}>;
export type ContributionAttribution = Readonly<{
  classification: "direct" | "spanning-dimensions" | "unallocated" | "ambiguous-or-disputed";
  spanningDimensions: readonly string[];
  unallocatedDimensions: readonly string[];
  reasons: readonly string[];
}>;
export type ContributionDashboardTrace = Readonly<{
  entities: readonly Readonly<{
    id: string; kind: ContributionEntityState["entity"]["kind"]; version: number;
    eventIds: readonly string[];
  }>[];
  evidence: readonly ContributionEvidenceReference[];
  limitations: readonly string[];
}>;
export type ContributionDimensionRecord = Readonly<{
  recordId: string;
  version: number;
  context: ContributionDimensionContext;
  measureKind: ContributionRecord["measure"]["kind"];
  reportedMinutes: number | null;
  corroboratedMinutes: number | null;
  evidenceAndContextSupported: boolean;
  attribution: ContributionAttribution;
  issues: readonly string[];
  trace: ContributionDashboardTrace;
}>;
export type ContributionDimensionMetrics = Readonly<{
  reportedMinutes: number | null;
  corroboratedMinutes: number | null;
  corroboratedSubsetMinutes: number;
  reportedHours: Readonly<{ numerator: number; denominator: 60 }> | null;
  corroboratedHours: Readonly<{ numerator: number; denominator: 60 }> | null;
  recordCount: number;
  evidenceSupportedRecordCount: number;
  independentlyCorroboratedTimeRecordIds: readonly string[];
  qualitativeAssertionIds: readonly string[];
  linkedResultIds: readonly string[];
  reviewedAttributedParticipationIds: readonly string[];
  coverage: "not-established";
  commitmentReliabilityAndTrends: "person-wide-only-not-dimension-prorated";
}>;
export type ContributionDimensionResult = Readonly<{
  resultId: string;
  kind: ContributionResultSummary["resultKind"];
  independentlyReviewed: boolean;
  attributionStatus: ContributionResultSummary["attributionStatus"];
  attribution: ContributionAttribution;
  matchingParticipationIds: readonly string[];
  associationMeaning: "participation-linked-not-exclusive-dimension-outcome-or-value";
  trace: ContributionDashboardTrace;
}>;
export type ContributionDashboardPersonPeriod = Readonly<{
  personId: string;
  personKind: ContributionReferenceSnapshot["people"][number]["kind"] | "unknown";
  periodId: string;
  personWide: ContributionIntelligencePersonPeriod;
  dimension: Readonly<{
    metrics: ContributionDimensionMetrics;
    records: readonly ContributionDimensionRecord[];
    excludedBoundaryRecordIds: readonly string[];
    unresolvedAssociationRecordIds: readonly string[];
    resultIdsByOccurrence: readonly string[];
    unknownScopeResultIds: readonly string[];
  }>;
  assessmentTraces: readonly Readonly<{
    kind: "commitment" | "delivery";
    id: string;
    expectationId: string;
    expectationVersion: number;
    criterionId: string;
    responsibilityIds: readonly string[];
    trace: ContributionDashboardTrace;
  }>[];
}>;
export type ContributionDashboardNotice = Readonly<{
  kind: "missing-records" | "no-matching-dimension-records" | "recorded-shortfall" | "insufficient-evidence" | "different-responsibilities-or-expectations"
    | "unresolved-disputes" | "meaningful-person-wide-change" | "sustained-person-wide-imbalance";
  personIds: readonly string[];
  periodIds: readonly string[];
  assessmentIds: readonly string[];
  basis: "person-wide" | "selected-records";
  limitations: readonly string[];
}>;
export type FounderContributionDashboard = Readonly<{
  version: 1;
  source: Readonly<{ scope: ContributionIntelligence["scope"]; asOfMs: number; sourceRevision: number; observedRevision: number }>;
  selection: ContributionDimensionSelection;
  options: Readonly<{
    personIds: readonly string[];
    periods: readonly Readonly<{ id: string; period: ContributionPeriod }>[];
    periodIds: readonly string[];
    organisationIds: readonly string[];
    departments: readonly Readonly<{ businessId: string; id: string | null }>[];
    operatingPillarIds: readonly (OperatingPillarId | null)[];
    projects: readonly Readonly<{ businessId: string; id: string | null }>[];
  }>;
  people: readonly ContributionDashboardPersonPeriod[];
  dimensionResults: readonly Readonly<{
    periodId: string; results: readonly ContributionDimensionResult[];
    unscopedResultIds: readonly string[];
  }>[];
  personWideAnalysis: Readonly<{
    comparisons: ContributionIntelligence["comparisons"];
    trends: ContributionIntelligence["trends"];
    sustainedImbalances: ContributionIntelligence["sustainedImbalances"];
    trendPolicy: ContributionIntelligence["trendPolicy"];
  }>;
  notices: readonly ContributionDashboardNotice[];
  futureScenarios: typeof CONTRIBUTION_DASHBOARD_SCENARIOS;
  limitations: readonly string[];
}> & typeof CONTRIBUTION_SAFETY;

export const CONTRIBUTION_DASHBOARD_SCENARIOS = Object.freeze({
  status: "design-only-no-scenario-calculation" as const,
  capabilities: Object.freeze(["discretionary-reward-review", "contractual-profit-sharing-review"] as const),
  prerequisites: Object.freeze([
    "human-approved-purpose-participants-period-and-policy",
    "separate-verified-distributable-profit-budget-currency-and-contracts",
    "explicit-evidence-and-reviewed-attribution-with-unallocated-shares-preserved",
    "conflict-review-dispute-recourse-and-legal-financial-approval",
    "sensitivity-and-missing-evidence-disclosure-no-hours-to-pay-conversion",
    "separate-authorised-decision-record-no-execution-from-dashboard",
  ]),
  calculatesPay: false as const, allocatesProfit: false as const, allocatesOwnership: false as const,
});

export const CONTRIBUTION_DASHBOARD_ACCESS_REQUIREMENTS = Object.freeze([
  "verified-server-principal-not-person-kind-or-client-selection",
  "fresh-tenant-dataset-business-person-field-and-evidence-authorisation",
  "complete-authorised-server-aggregation-before-output-minimisation",
  "private-view-subject-person-binding-and-explicit-on-behalf-permission",
  "no-founder-packet-or-global-facets-in-person-specific-responses",
  "restricted-dependencies-retained-for-integrity-without-disclosing-peer-details",
  "policy-and-person-binding-revision-fences-revocation-and-audited-disclosure",
  "no-browser-cache-sharing-or-cross-subject-reuse",
  "source-agreement-deadline-and-evidence-version-consistency",
  "no-existing-route-guard-or-source-handle-is-a-contribution-access-grant",
] as const);

function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function unique(values: readonly string[]): string[] { return [...new Set(values)].sort(compare); }
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => {
    const next = total + value;
    if (!Number.isSafeInteger(next)) throw new Error("Dimension quantity exceeds safe integer precision.");
    return next;
  }, 0);
}
function intersects(a: ContributionPeriod, b: ContributionPeriod): boolean { return a.startMs < b.endMs && b.startMs < a.endMs; }
function contained(a: ContributionPeriod, b: ContributionPeriod): boolean { return a.startMs >= b.startMs && a.endMs <= b.endMs; }
function activeRecords(source: Source): readonly WorkState[] { return source.records; }
function context(record: ContributionRecord): ContributionDimensionContext {
  return { businessId: record.businessId, departmentId: record.departmentId, pillarId: record.pillarId, projectId: record.projectId };
}
function associationProblems(record: ContributionRecord, refs: ContributionReferenceSnapshot): string[] {
  return [
    ...(!refs.businessIds.includes(record.businessId) ? ["unknown-organisation"] : []),
    ...(record.departmentId !== null && !refs.departments.some(ref => ref.businessId === record.businessId && ref.id === record.departmentId)
      ? ["unresolved-department-association"] : []),
    ...(record.projectId !== null && !refs.projects.some(ref => ref.businessId === record.businessId && ref.id === record.projectId)
      ? ["unresolved-project-association"] : []),
  ];
}
function matches(record: ContributionRecord, selection: ContributionDimensionSelection, refs: ContributionReferenceSnapshot): boolean {
  const knownBusiness = refs.businessIds.includes(record.businessId);
  return (selection.organisationIds === null || (knownBusiness && selection.organisationIds.includes(record.businessId)))
    && (selection.departments === null || selection.departments.some(ref => ref.businessId === record.businessId
      && ref.id === record.departmentId && (ref.id === null || refs.departments.some(known => known.id === ref.id && known.businessId === ref.businessId))))
    && (selection.operatingPillarIds === null || selection.operatingPillarIds.includes(record.pillarId))
    && (selection.projects === null || selection.projects.some(ref => ref.businessId === record.businessId
      && ref.id === record.projectId && (ref.id === null || refs.projects.some(known => known.id === ref.id && known.businessId === ref.businessId))));
}
function disputed(state: ContributionEntityState): boolean {
  return state.disputes.some(dispute => dispute.resolution === null
    || (dispute.resolution.finding === "not-supported" && dispute.resolution.version === state.version));
}
function attribution(states: readonly WorkState[], source: Source,
  result?: ContributionResultSummary): ContributionAttribution {
  const spanningDimensions: string[] = [];
  const unallocatedDimensions: string[] = [];
  for (const key of ["businessId", "departmentId", "pillarId", "projectId"] as const) {
    const values = states.map(state => state.entity[key]);
    if (new Set(values.filter(value => value !== null)).size > 1) spanningDimensions.push(key);
    if (values.length === 0 || values.includes(null)) unallocatedDimensions.push(key);
  }
  const resultState = result ? source.projection.entities.find(state => state.entity.id === result.resultId) : undefined;
  const reasons = unique([
    ...states.flatMap(state => associationProblems(state.entity, source.references)),
    ...(states.some(disputed) || (resultState && disputed(resultState)) ? ["disputed-or-adversely-resolved-attribution"] : []),
    ...(result?.attributionStatus === "blocked" ? ["reviewed-allocation-blocked"] : []),
  ]);
  return {
    classification: reasons.length > 0 ? "ambiguous-or-disputed" : spanningDimensions.length > 0 ? "spanning-dimensions"
      : unallocatedDimensions.length > 0 ? "unallocated" : "direct",
    spanningDimensions, unallocatedDimensions, reasons,
  };
}
function trace(source: Source, ids: readonly string[], extra: readonly ContributionEvidenceReference[] = []): ContributionDashboardTrace {
  const states = source.projection.entities.filter(state => ids.includes(state.entity.id));
  const eventIds = new Set(states.flatMap(state => state.eventIds));
  const evidence = source.projection.audit.filter(event => eventIds.has(event.id)).flatMap(event => {
    const body = event.body;
    return body.type === "created" ? body.entity.evidence
      : body.type === "corrected" ? [...body.evidence, ...body.replacement.evidence] : body.evidence;
  });
  return {
    entities: states.map(state => ({
      id: state.entity.id, kind: state.entity.kind, version: state.version, eventIds: [...state.eventIds],
    })).sort((a, b) => compare(a.id, b.id)),
    evidence: [...new Map([...evidence, ...extra].map(ref => [JSON.stringify([ref.id, ref.revision, ref.sha256]), ref])).values()]
      .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
    limitations: ["references-not-evidence-content-or-access-grants", "complete-history-and-authenticity-not-established"],
  };
}
function resultDependencyIds(source: Source, resultId: string): string[] {
  return unique([resultId, ...source.projection.audit.flatMap(event => {
    const entity = event.body.type === "created" ? event.body.entity : event.body.type === "corrected" ? event.body.replacement : null;
    return (entity?.kind === "allocation" && entity.resultId === resultId)
      || (entity?.kind === "contribution" && "resultId" in entity.measure && entity.measure.resultId === resultId) ? [entity.id] : [];
  })]);
}

/** In-memory provenance only, not server authority, durable validation or access control. */
export function prepareContributionDashboardSource(input: ContributionIntelligenceInput):
  | Readonly<{ status: "prepared"; source: ContributionDashboardSource }> & typeof CONTRIBUTION_SAFETY
  | ContributionDomainRefusal {
  try {
    const fields = contributionFields(input, ["ledger", "references", "personIds", "periods", "agreements", "deliveries", "asOfMs", "nowMs", "trendPolicy"]);
    const analysed = analyseContributionIntelligence(input);
    if (analysed.status === "refused") return analysed;
    const nowMs = contributionCounter(fields.nowMs);
    const projected = projectContributionLedger(fields.ledger, nowMs, analysed.intelligence.asOfMs);
    if (projected.status === "refused") return projected;
    const references = decodeContributionReferenceSnapshot(fields.references);
    const reports = analysed.intelligence.periods.map(item => {
      const report = buildContributionPeriodReport(fields.ledger, references, item.period, nowMs, analysed.intelligence.asOfMs);
      if (report.status === "refused") throw new Error(report.message);
      return report.report;
    });
    const source: ContributionDashboardSource = Object.freeze({ [sourceBrand]: true });
    sources.set(source, freezeContributionValue({
      intelligence: analysed.intelligence, projection: projected.projection, references, reports,
      records: projected.projection.entities.filter((state): state is WorkState =>
        state.entity.kind === "contribution" && state.withdrawnAtMs === null),
    }));
    return Object.freeze({ status: "prepared", ...CONTRIBUTION_SAFETY, source });
  } catch (error) {
    return contributionRefusal(`Dashboard preparation refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function selectIds(value: unknown, available: readonly string[]): string[] | null {
  if (value === null) return null;
  const ids = contributionList(value, contributionId);
  if (new Set(ids).size !== ids.length || ids.some(id => !available.includes(id))) throw new Error("Unknown or duplicate dashboard selection.");
  return ids.sort(compare);
}
function scopedSelection(value: unknown, available: readonly Readonly<{ id: string; businessId: string }>[],
  businesses: readonly string[]): { id: string | null; businessId: string }[] | null {
  if (value === null) return null;
  const selected = contributionList(value, entry => {
    const ref = contributionFields(entry, ["businessId", "id"]);
    const businessId = contributionId(ref.businessId);
    const id = ref.id === null ? null : contributionId(ref.id);
    if (!businesses.includes(businessId) || (id !== null && !available.some(item => item.id === id && item.businessId === businessId))) {
      throw new Error("Unknown business-scoped dashboard association.");
    }
    return { businessId, id };
  });
  if (new Set(selected.map(item => JSON.stringify(item))).size !== selected.length) throw new Error("Duplicate scoped dashboard selection.");
  return selected.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
}
function selection(value: unknown, source: Source): ContributionDimensionSelection {
  const item = contributionFields(value, ["personIds", "periodIds", "organisationIds", "departments", "operatingPillarIds", "projects"]);
  const pillars = item.operatingPillarIds === null ? null : contributionList(item.operatingPillarIds, value => {
    if (value === null) return null;
    const pillar = OPERATING_PILLARS.find(pillar => pillar.id === value);
    if (!pillar) throw new Error("A canonical operating pillar is required; strategic themes are not pillars.");
    return pillar.id;
  });
  if (pillars && new Set(pillars).size !== pillars.length) throw new Error("Duplicate operating pillar selection.");
  return {
    personIds: selectIds(item.personIds, source.intelligence.personIds),
    periodIds: selectIds(item.periodIds, source.intelligence.periods.map(item => item.id)),
    organisationIds: selectIds(item.organisationIds, source.references.businessIds),
    departments: scopedSelection(item.departments, source.references.departments, source.references.businessIds),
    operatingPillarIds: pillars?.sort((a, b) => compare(a ?? "", b ?? "")) ?? null,
    projects: scopedSelection(item.projects, source.references.projects, source.references.businessIds),
  };
}
function metrics(records: readonly ContributionDimensionRecord[], personWide: ContributionIntelligencePersonPeriod): ContributionDimensionMetrics {
  const hours = records.filter(record => record.measureKind === "hours");
  const reportedMinutes = hours.length ? sum(hours.flatMap(record => record.reportedMinutes === null ? [] : [record.reportedMinutes])) : null;
  const supported = hours.flatMap(record => record.corroboratedMinutes === null ? [] : [record.corroboratedMinutes]);
  const corroboratedMinutes = hours.length && supported.length === hours.length ? sum(supported) : null;
  return {
    reportedMinutes, corroboratedMinutes, corroboratedSubsetMinutes: sum(supported),
    reportedHours: reportedMinutes === null ? null : { numerator: reportedMinutes, denominator: 60 },
    corroboratedHours: corroboratedMinutes === null ? null : { numerator: corroboratedMinutes, denominator: 60 },
    recordCount: records.length, evidenceSupportedRecordCount: records.filter(record => record.evidenceAndContextSupported).length,
    independentlyCorroboratedTimeRecordIds: hours.filter(record => record.corroboratedMinutes !== null).map(record => record.recordId),
    qualitativeAssertionIds: records.filter(record => record.measureKind === "quality" || record.measureKind === "initiative").map(record => record.recordId),
    linkedResultIds: unique(records.flatMap(record => record.trace.entities.filter(entity => entity.kind === "shared-result").map(entity => entity.id))),
    reviewedAttributedParticipationIds: records.filter(record =>
      personWide.contributions.reviewedAttributedParticipationIds.includes(record.recordId)).map(record => record.recordId),
    coverage: "not-established", commitmentReliabilityAndTrends: "person-wide-only-not-dimension-prorated",
  };
}
function personRow(row: ContributionIntelligencePersonPeriod, source: Source, selected: ContributionDimensionSelection): ContributionDashboardPersonPeriod {
  const period = source.intelligence.periods.find(period => period.id === row.periodId);
  const report = source.reports.find(report => period && report.period.startMs === period.period.startMs && report.period.endMs === period.period.endMs);
  if (!period || !report) throw new Error("Validated person-period/report binding is missing.");
  const work = activeRecords(source).filter(state => state.entity.personId === row.personId && intersects(state.entity.period, period.period));
  const matching = work.filter(state => matches(state.entity, selected, source.references));
  const records = matching.filter(state => contained(state.entity.period, period.period)).map(state => {
    const record = state.entity;
    const assessment = report.recordAssessments.find(item => item.recordId === record.id && item.version === state.version);
    if (!assessment) throw new Error("Validated record assessment is missing.");
    const dependencies = "resultId" in record.measure ? resultDependencyIds(source, record.measure.resultId) : [record.id];
    return {
      recordId: record.id, version: state.version, context: context(record), measureKind: record.measure.kind,
      reportedMinutes: record.measure.kind === "hours" ? record.measure.reportedMinutes : null,
      corroboratedMinutes: assessment.corroboratedMinutes,
      evidenceAndContextSupported: assessment.evidenceAndContextSupported,
      attribution: attribution([state], source), issues: assessment.issueCodes, trace: trace(source, dependencies),
    };
  }).sort((a, b) => compare(a.recordId, b.recordId));
  const resultIdsByOccurrence = report.results.filter(result => activeRecords(source).some(state =>
    state.entity.personId === row.personId && matches(state.entity, selected, source.references)
    && "resultId" in state.entity.measure && state.entity.measure.resultId === result.resultId)).map(result => result.resultId);
  const unknownScopeResultIds = row.results.filter(result => activeRecords(source).some(state =>
    state.entity.personId === row.personId && "resultId" in state.entity.measure && state.entity.measure.resultId === result.resultId
    && (associationProblems(state.entity, source.references).length > 0 || state.entity.departmentId === null
      || state.entity.pillarId === null || state.entity.projectId === null)))
    .map(result => result.resultId);
  return {
    personId: row.personId, personKind: source.references.people.find(person => person.id === row.personId)?.kind ?? "unknown",
    periodId: row.periodId, personWide: row,
    dimension: {
      metrics: metrics(records, row), records,
      excludedBoundaryRecordIds: matching.filter(state => !contained(state.entity.period, period.period)).map(state => state.entity.id).sort(compare),
      unresolvedAssociationRecordIds: work.filter(state => associationProblems(state.entity, source.references).length > 0)
        .map(state => state.entity.id).sort(compare),
      resultIdsByOccurrence, unknownScopeResultIds,
    },
    assessmentTraces: [
      ...row.commitments.map(item => ({
        kind: "commitment" as const, id: item.agreementId, expectationId: item.expectationId,
        expectationVersion: item.expectationVersion, criterionId: item.criterionId, responsibilityIds: item.responsibilityIds,
        trace: trace(source, [item.expectationId, ...item.supportingRecordIds], item.supportingEvidence),
      })),
      ...row.reliability.observations.map(item => {
        const agreement = row.commitments.find(agreement => agreement.agreementId === item.agreementId);
        if (!agreement) throw new Error("Delivery agreement binding is missing.");
        return {
          kind: "delivery" as const, id: item.observationId, expectationId: agreement.expectationId,
          expectationVersion: agreement.expectationVersion, criterionId: agreement.criterionId,
          responsibilityIds: [item.responsibilityId],
          trace: trace(source, [agreement.expectationId, ...resultDependencyIds(source, item.resultId)], [...agreement.supportingEvidence, ...item.evidence]),
        };
      }),
    ],
  };
}
function resultRows(source: Source, selected: ContributionDimensionSelection, periodId: string): ContributionDimensionResult[] {
  const period = source.intelligence.periods.find(period => period.id === periodId);
  if (!period) throw new Error("Unknown result period.");
  return period.organisationalResults.flatMap(result => {
    const participants = activeRecords(source).filter(state => "resultId" in state.entity.measure && state.entity.measure.resultId === result.resultId);
    const matching = participants.filter(state => (selected.personIds === null || selected.personIds.includes(state.entity.personId))
      && matches(state.entity, selected, source.references));
    if (matching.length === 0) return [];
    return [{
      resultId: result.resultId, kind: result.resultKind, independentlyReviewed: result.independentlyReviewed,
      attributionStatus: result.attributionStatus, attribution: attribution(participants, source, result),
      matchingParticipationIds: matching.map(state => state.entity.id).sort(compare),
      associationMeaning: "participation-linked-not-exclusive-dimension-outcome-or-value" as const,
      trace: trace(source, resultDependencyIds(source, result.resultId)),
    }];
  });
}
function sourceFor(handle: ContributionDashboardSource): Source {
  const source = sources.get(handle);
  if (!source) throw new Error("An original prepared source is required; raw, cloned or serialized intelligence is not accepted.");
  return source;
}
function notices(rows: readonly ContributionDashboardPersonPeriod[], analysis: FounderContributionDashboard["personWideAnalysis"]): ContributionDashboardNotice[] {
  const result: ContributionDashboardNotice[] = [];
  for (const row of rows) {
    const base = { personIds: [row.personId], periodIds: [row.periodId], limitations: ["no-performance-verdict-or-reward-entitlement"] };
    if (row.dimension.metrics.recordCount === 0) result.push({
      ...base, kind: row.personWide.contributions.recordedIds.length === 0 && row.personWide.uncertainty.excludedBoundaryRecordIds.length === 0
        ? "missing-records" : "no-matching-dimension-records",
      assessmentIds: [], basis: "selected-records",
    });
    if (row.personWide.uncertainty.openDisputes.length) result.push({
      ...base, kind: "unresolved-disputes", assessmentIds: row.personWide.uncertainty.openDisputes.map(dispute => dispute.disputeId), basis: "person-wide",
    });
    for (const item of row.personWide.commitments) {
      if (item.status === "recorded-at-or-above") continue;
      result.push({
        ...base, kind: item.status === "recorded-shortfall" ? "recorded-shortfall"
          : item.status === "insufficient-evidence" ? "insufficient-evidence" : "different-responsibilities-or-expectations",
        assessmentIds: [item.agreementId], basis: "person-wide",
      });
    }
  }
  for (const trend of analysis.trends.filter(trend => trend.netChangeMeetsGapPolicy)) result.push({
    kind: "meaningful-person-wide-change", personIds: [trend.personId], periodIds: trend.periodIds,
    assessmentIds: rows.filter(row => row.personId === trend.personId && trend.periodIds.includes(row.periodId))
      .flatMap(row => row.personWide.commitments.filter(item => JSON.stringify([
        item.businessId, item.roleId, item.departmentId, item.responsibilityIds, item.dimension, item.expectationStatement,
      ]) === trend.agreementContext).map(item => item.agreementId)),
    basis: "person-wide", limitations: trend.limitations,
  });
  for (const imbalance of analysis.sustainedImbalances) result.push({
    kind: "sustained-person-wide-imbalance", personIds: imbalance.personIds, periodIds: imbalance.periodIds,
    assessmentIds: imbalance.agreementPairs.flatMap(pair => [...pair]), basis: "person-wide",
    limitations: ["normalised-recorded-time-not-enterprise-value", "coverage-not-established"],
  });
  return result;
}

export function buildFounderContributionDashboard(handle: ContributionDashboardSource, value: ContributionDimensionSelection):
  | Readonly<{ status: "projected"; dashboard: FounderContributionDashboard }> & typeof CONTRIBUTION_SAFETY
  | ContributionDomainRefusal {
  try {
    const source = sourceFor(handle);
    const selected = selection(value, source);
    const periods = source.intelligence.periods.filter(period => selected.periodIds === null || selected.periodIds.includes(period.id));
    const rows = source.intelligence.people.filter(row => (selected.personIds === null || selected.personIds.includes(row.personId))
      && periods.some(period => period.id === row.periodId)).map(row => personRow(row, source, selected));
    const personIds = unique(rows.map(row => row.personId));
    const periodIds = periods.map(period => period.id);
    const analysis = {
      comparisons: source.intelligence.comparisons.filter(item => item.personIds.every(id => personIds.includes(id)) && periodIds.includes(item.periodId)),
      trends: source.intelligence.trends.filter(item => personIds.includes(item.personId) && item.periodIds.every(id => periodIds.includes(id))),
      sustainedImbalances: source.intelligence.sustainedImbalances.filter(item =>
        item.personIds.every(id => personIds.includes(id)) && item.periodIds.every(id => periodIds.includes(id))),
      trendPolicy: source.intelligence.trendPolicy,
    };
    const scopedOptions = (refs: readonly Readonly<{ id: string; businessId: string }>[]) =>
      [...refs, ...source.references.businessIds.map(businessId => ({ businessId, id: null }))]
        .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
    return freezeContributionValue({
      status: "projected", ...CONTRIBUTION_SAFETY,
      dashboard: {
        version: 1, ...CONTRIBUTION_SAFETY,
        source: {
          scope: source.intelligence.scope, asOfMs: source.intelligence.asOfMs,
          sourceRevision: source.intelligence.sourceRevision, observedRevision: source.intelligence.observedRevision,
        },
        selection: selected,
        options: {
          personIds: source.intelligence.personIds, periods: source.intelligence.periods.map(period => ({ id: period.id, period: period.period })),
          periodIds: source.intelligence.periods.map(period => period.id), organisationIds: [...source.references.businessIds].sort(compare),
          departments: scopedOptions(source.references.departments), operatingPillarIds: [...OPERATING_PILLARS.map(pillar => pillar.id), null],
          projects: scopedOptions(source.references.projects),
        },
        people: rows, dimensionResults: periods.map(period => ({
          periodId: period.id, results: resultRows(source, selected, period.id),
          unscopedResultIds: selected.personIds !== null ? [] : period.organisationalResults.filter(result =>
            !activeRecords(source).some(state => "resultId" in state.entity.measure && state.entity.measure.resultId === result.resultId))
            .map(result => result.resultId),
        })),
        personWideAnalysis: analysis, notices: notices(rows, analysis), futureScenarios: CONTRIBUTION_DASHBOARD_SCENARIOS,
        limitations: [
          ...source.intelligence.limitations,
          "dimension-metrics-derived-from-records-not-prorated-person-wide-totals",
          "person-wide-panels-and-notices-do-not-change-with-dimension-filters",
          "shared-results-may-appear-in-multiple-dimensions-never-sum-them-as-exclusive-value",
          "no-dimension-specific-financial-allocation-commitment-or-reliability-inferred",
          "organisation-means-explicit-phase-1-business-id-not-inferred-legal-entity",
          "unresolved-associations-listed-separately-not-guessed-into-filter",
          "unscoped-results-are-unplaced-not-members-of-the-selected-dimensions",
          "founder-projection-sensitive-not-authorised-for-browser-disclosure",
        ],
      },
    });
  } catch (error) {
    return contributionRefusal(`Founder dashboard refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export type ContributionPrivatePersonView = Readonly<{
  version: 1;
  personId: string;
  asOfMs: number;
  sourceRevision: number;
  observedRevision: number;
  periods: readonly Readonly<{
    periodId: string;
    period: ContributionPeriod;
    hours: ContributionIntelligencePersonPeriod["hours"];
    selectedDimension: Pick<ContributionDimensionMetrics, "reportedMinutes" | "corroboratedMinutes" | "corroboratedSubsetMinutes"
      | "reportedHours" | "corroboratedHours" | "recordCount" | "evidenceSupportedRecordCount" | "coverage" | "commitmentReliabilityAndTrends">;
    commitments: readonly Readonly<{
      agreementId: string; status: ContributionIntelligencePersonPeriod["commitments"][number]["status"];
      expectedMinutes: number | null; recordedMinutes: number | null;
      reasons: readonly string[];
    }>[];
    reliability: Readonly<{ evidencedOnTime: number; evidencedLate: number; unresolvedDue: number; notYetDue: number }>;
    ownOpenDisputeCount: number;
    limitations: readonly string[];
  }>[];
  disclosure: "minimised-design-only-not-server-authorisation";
}> & typeof CONTRIBUTION_SAFETY;

export function buildContributionPrivatePersonView(handle: ContributionDashboardSource, personId: string, value: ContributionDimensionSelection):
  | Readonly<{ status: "projected"; view: ContributionPrivatePersonView }> & typeof CONTRIBUTION_SAFETY
  | ContributionDomainRefusal {
  try {
    const source = sourceFor(handle);
    const id = contributionId(personId);
    if (!source.intelligence.personIds.includes(id) || !source.references.people.some(person => person.id === id)) {
      throw new Error("A known Person in this prepared analytical source is required for a private view.");
    }
    const selected = selection(value, source);
    if (selected.personIds !== null && (selected.personIds.length !== 1 || selected.personIds[0] !== id)) {
      throw new Error("A private view cannot select other people.");
    }
    const result = buildFounderContributionDashboard(handle, { ...selected, personIds: [id] });
    if (result.status === "refused") return result;
    return freezeContributionValue({
      status: "projected", ...CONTRIBUTION_SAFETY,
      view: {
        version: 1, ...CONTRIBUTION_SAFETY, personId: id, disclosure: "minimised-design-only-not-server-authorisation",
        asOfMs: source.intelligence.asOfMs, sourceRevision: source.intelligence.sourceRevision, observedRevision: source.intelligence.observedRevision,
        periods: result.dashboard.people.map(row => {
          const period = source.intelligence.periods.find(period => period.id === row.periodId);
          if (!period) throw new Error("Private period binding is missing.");
          return {
            periodId: row.periodId, period: period.period,
            hours: row.personWide.hours,
            selectedDimension: {
              reportedMinutes: row.dimension.metrics.reportedMinutes, corroboratedMinutes: row.dimension.metrics.corroboratedMinutes,
              corroboratedSubsetMinutes: row.dimension.metrics.corroboratedSubsetMinutes,
              reportedHours: row.dimension.metrics.reportedHours, corroboratedHours: row.dimension.metrics.corroboratedHours,
              recordCount: row.dimension.metrics.recordCount, evidenceSupportedRecordCount: row.dimension.metrics.evidenceSupportedRecordCount,
              coverage: row.dimension.metrics.coverage, commitmentReliabilityAndTrends: row.dimension.metrics.commitmentReliabilityAndTrends,
            },
            commitments: row.personWide.commitments.map(item => ({
              agreementId: item.agreementId, status: item.status, expectedMinutes: item.expectedMinutes,
              recordedMinutes: item.recordedMinutes, reasons: item.reasons,
            })),
            reliability: {
              evidencedOnTime: row.personWide.reliability.evidencedOnTime, evidencedLate: row.personWide.reliability.evidencedLate,
              unresolvedDue: row.personWide.reliability.unresolvedDue, notYetDue: row.personWide.reliability.notYetDue,
            },
            ownOpenDisputeCount: row.personWide.uncertainty.openDisputes.filter(dispute =>
              source.projection.entities.some(state => state.entity.id === dispute.entityId
                && state.entity.kind === "contribution" && state.entity.personId === id)).length,
            limitations: ["other-person-comparisons-shared-evidence-result-money-and-dispute-details-withheld",
              "restricted-collaboration-can-still-affect-support-without-disclosing-participants", "server-subject-binding-and-field-authorisation-required"],
          };
        }),
      },
    });
  } catch (error) {
    return contributionRefusal(`Private contribution view refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}
