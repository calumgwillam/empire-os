import {
  CONTRIBUTION_SAFETY, contributionCounter, contributionFields, contributionId, contributionList,
  contributionRefusal, decodeContributionEvidence, decodeContributionPeriod, freezeContributionValue,
  projectContributionLedger,
  type ContributionAuditEvent, type ContributionDomainRefusal, type ContributionEntityState, type ContributionEvidenceReference,
  type ContributionPeriod, type ContributionRecord, type ContributionScope,
} from "./individual-contribution";
import {
  buildContributionPeriodReport, decodeContributionReferenceSnapshot,
  type ContributionExactShare, type ContributionPeriodReport, type ContributionReferenceSnapshot,
  type ContributionResultSummary,
} from "./individual-contribution-reporting";

export const CONTRIBUTION_INTELLIGENCE_VERSION = 1;
export type ContributionCommitmentAgreement = Readonly<{
  id: string;
  personId: string;
  businessId: string;
  roleId: string;
  departmentId: string | null;
  period: ContributionPeriod;
  expectationId: string;
  expectationVersion: number;
  criterionId: string;
  agreedMinutes: number;
  responsibilityIds: readonly string[];
  acceptedAtMs: number;
  reviewedByPersonId: string;
  reviewedAtMs: number;
  evidence: readonly ContributionEvidenceReference[];
}>;
export type ContributionDeliveryObservation = Readonly<{
  id: string;
  agreementId: string;
  responsibilityId: string;
  resultId: string;
  resultVersion: number;
  dueAtMs: number;
  acceptedAtMs: number;
  reviewedByPersonId: string;
  reviewedAtMs: number;
  evidence: readonly ContributionEvidenceReference[];
}>;
export type ContributionIntelligenceInput = Readonly<{
  ledger: unknown;
  references: unknown;
  personIds: readonly string[];
  periods: readonly Readonly<{ id: string; period: ContributionPeriod }>[];
  agreements: readonly ContributionCommitmentAgreement[];
  deliveries: readonly ContributionDeliveryObservation[];
  asOfMs: number;
  nowMs: number;
  trendPolicy: Readonly<{ minimumConsecutivePeriods: number; minimumGapBasisPoints: number }>;
}>;
export type ContributionFraction = Readonly<{ numerator: number; denominator: number }>;
export type ContributionCommitmentAnalysis = Readonly<{
  agreementId: string;
  businessId: string;
  roleId: string;
  departmentId: string | null;
  responsibilityIds: readonly string[];
  expectationId: string;
  expectationVersion: number;
  criterionId: string;
  expectationStatement: string | null;
  dimension: "reported-minutes" | "corroborated-minutes" | null;
  expectedMinutes: number | null;
  roleMinimumMinutes: number | null;
  recordedMinutes: number | null;
  shortfallMinutes: number | null;
  recordedFulfilment: ContributionFraction | null;
  status: "recorded-at-or-above" | "recorded-shortfall" | "insufficient-evidence" | "different-or-unsettled-expectations";
  comparable: boolean;
  reasons: readonly string[];
  supportingRecordIds: readonly string[];
  supportingEvidence: readonly ContributionEvidenceReference[];
}>;
export type ContributionReliabilityObservation = Readonly<{
  observationId: string;
  agreementId: string;
  responsibilityId: string;
  resultId: string;
  dueAtMs: number;
  occurredAtMs: number | null;
  status: "evidenced-on-time" | "evidenced-late" | "not-yet-due" | "completion-not-evidenced" | "uncertain";
  reasons: readonly string[];
  evidence: readonly ContributionEvidenceReference[];
}>;
export type ContributionIntelligencePersonPeriod = Readonly<{
  personId: string;
  periodId: string;
  identityStatus: "known" | "unknown";
  hours: Readonly<{
    reportedMinutes: number | null;
    corroboratedMinutes: number | null;
    corroboratedSubsetMinutes: number;
    reportedHours: ContributionFraction | null;
    corroboratedHours: ContributionFraction | null;
    limitations: readonly string[];
  }>;
  commitments: readonly ContributionCommitmentAnalysis[];
  contributions: Readonly<{
    recordedIds: readonly string[];
    evidenceSupportedIds: readonly string[];
    independentlyCorroboratedTimeIds: readonly string[];
    reviewedAttributedParticipationIds: readonly string[];
    qualitativeAssertionIds: readonly string[];
    verificationMeaning: "evidence-supported-assertions-not-independent-proof-of-enterprise-value";
  }>;
  results: readonly Readonly<{
    resultId: string;
    kind: ContributionResultSummary["resultKind"];
    independentlyReviewed: boolean;
    attributionStatus: ContributionResultSummary["attributionStatus"];
    allocatedBasisPointsForPerson: number | null;
    financialShare: ContributionExactShare | null;
  }>[];
  reliability: Readonly<{
    observations: readonly ContributionReliabilityObservation[];
    evidencedOnTime: number;
    evidencedLate: number;
    unresolvedDue: number;
    notYetDue: number;
    denominator: "explicit-delivery-observations-only-not-all-responsibilities";
  }>;
  evidenceCompleteness: Readonly<{
    includedRecordCount: number;
    supportedRecordCount: number;
    unsupportedRecordIds: readonly string[];
    referencedEvidenceCount: number;
    usableEvidenceCount: number;
    missingOrUnusableEvidence: readonly ContributionEvidenceReference[];
    missingEvidenceEntityIds: readonly string[];
    missingEvidenceAgreementIds: readonly string[];
    missingEvidenceDeliveryIds: readonly string[];
    reportingCoverage: "not-established";
  }>;
  uncertainty: Readonly<{
    excludedBoundaryRecordIds: readonly string[];
    openDisputes: readonly Readonly<{ entityId: string; disputeId: string; version: number }>[];
    adverseFindingEntityIds: readonly string[];
    blockedAllocationResultIds: readonly string[];
    unallocatedResultIds: readonly string[];
    issues: readonly Readonly<{ entityId: string | null; code: string }>[];
  }>;
  actualUnderperformance: "not-established-requires-complete-evidence-and-human-context";
  rewardDecisionSupport: Readonly<{
    status: "human-review-inputs-only";
    reviewedResultIds: readonly string[];
    reviewedAllocationResultIds: readonly string[];
    unresolvedReasons: readonly string[];
    determinesPay: false;
    determinesBonus: false;
    determinesProfitShare: false;
    determinesEquity: false;
  }>;
}>;
export type ContributionPairComparison = Readonly<{
  periodId: string;
  personIds: readonly [string, string];
  businessId: string | null;
  agreementIds: readonly [string, string] | null;
  comparable: boolean;
  recordedFulfilment: readonly [ContributionFraction, ContributionFraction] | null;
  higherRecordedFulfilmentPersonId: string | null;
  gapMeetsPolicy: boolean;
  reasons: readonly string[];
}>;
export type ContributionPersonTrend = Readonly<{
  personId: string;
  agreementContext: string;
  periodIds: readonly string[];
  fulfilment: readonly ContributionFraction[];
  direction: "increasing-recorded-fulfilment" | "decreasing-recorded-fulfilment" | "unchanged" | "mixed";
  netChangeMeetsGapPolicy: boolean;
  consecutiveRecordedShortfalls: number;
  sustainedRecordedShortfall: boolean;
  reliability: Readonly<{ evidencedOnTime: number; evidencedLate: number; unresolvedDue: number }>;
  limitations: readonly string[];
}>;
export type ContributionIntelligence = Readonly<{
  version: typeof CONTRIBUTION_INTELLIGENCE_VERSION;
  scope: ContributionScope;
  asOfMs: number;
  sourceRevision: number;
  observedRevision: number;
  personIds: readonly string[];
  periods: readonly Readonly<{
    id: string; period: ContributionPeriod;
    organisationalResults: readonly ContributionResultSummary[];
    uniqueResultCounts: ContributionPeriodReport["uniqueResultCounts"];
    financialBuckets: ContributionPeriodReport["financialBuckets"];
  }>[];
  people: readonly ContributionIntelligencePersonPeriod[];
  comparisons: readonly ContributionPairComparison[];
  trends: readonly ContributionPersonTrend[];
  sustainedImbalances: readonly Readonly<{
    personIds: readonly [string, string]; higherRecordedFulfilmentPersonId: string;
    agreementContext: string; periodIds: readonly string[]; agreementPairs: readonly (readonly [string, string])[];
  }>[];
  trendPolicy: ContributionIntelligenceInput["trendPolicy"];
  limitations: readonly string[];
}> & typeof CONTRIBUTION_SAFETY;

function keyCompare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function sorted(values: readonly string[]): string[] { return [...new Set(values)].sort(keyCompare); }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function overlaps(left: ContributionPeriod, right: ContributionPeriod): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}
function contains(inner: ContributionPeriod, outer: ContributionPeriod): boolean {
  return inner.startMs >= outer.startMs && inner.endMs <= outer.endMs;
}
function ids(value: unknown): string[] {
  const values = contributionList(value, contributionId);
  if (new Set(values).size !== values.length) throw new Error("Duplicate analytical identities are ambiguous.");
  return values.sort(keyCompare);
}
function positive(value: unknown): number {
  const result = contributionCounter(value);
  if (result === 0) throw new Error("A positive pinned version is required.");
  return result;
}
function nullableId(value: unknown): string | null { return value === null ? null : contributionId(value); }
function agreement(value: unknown): ContributionCommitmentAgreement {
  const item = contributionFields(value, [
    "id", "personId", "businessId", "roleId", "departmentId", "period", "expectationId", "expectationVersion",
    "criterionId", "agreedMinutes", "responsibilityIds", "acceptedAtMs", "reviewedByPersonId", "reviewedAtMs", "evidence",
  ]);
  return {
    id: contributionId(item.id), personId: contributionId(item.personId), businessId: contributionId(item.businessId),
    roleId: contributionId(item.roleId), departmentId: nullableId(item.departmentId), period: decodeContributionPeriod(item.period),
    expectationId: contributionId(item.expectationId), expectationVersion: positive(item.expectationVersion),
    criterionId: contributionId(item.criterionId), agreedMinutes: contributionCounter(item.agreedMinutes),
    responsibilityIds: ids(item.responsibilityIds),
    acceptedAtMs: contributionCounter(item.acceptedAtMs), reviewedByPersonId: contributionId(item.reviewedByPersonId),
    reviewedAtMs: contributionCounter(item.reviewedAtMs), evidence: decodeContributionEvidence(item.evidence),
  };
}
function delivery(value: unknown): ContributionDeliveryObservation {
  const item = contributionFields(value, [
    "id", "agreementId", "responsibilityId", "resultId", "resultVersion", "dueAtMs", "acceptedAtMs",
    "reviewedByPersonId", "reviewedAtMs", "evidence",
  ]);
  return {
    id: contributionId(item.id), agreementId: contributionId(item.agreementId), responsibilityId: contributionId(item.responsibilityId),
    resultId: contributionId(item.resultId), resultVersion: positive(item.resultVersion), dueAtMs: contributionCounter(item.dueAtMs),
    acceptedAtMs: contributionCounter(item.acceptedAtMs), reviewedByPersonId: contributionId(item.reviewedByPersonId),
    reviewedAtMs: contributionCounter(item.reviewedAtMs), evidence: decodeContributionEvidence(item.evidence),
  };
}
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => {
    const next = total + value;
    if (!Number.isSafeInteger(next)) throw new Error("Analytical sum exceeds safe integer precision.");
    return next;
  }, 0);
}
function fractionCompare(left: ContributionFraction, right: ContributionFraction): number {
  const difference = BigInt(left.numerator) * BigInt(right.denominator) - BigInt(right.numerator) * BigInt(left.denominator);
  return difference < BigInt(0) ? -1 : difference > BigInt(0) ? 1 : 0;
}
function meetsGap(left: ContributionFraction, right: ContributionFraction, basisPoints: number): boolean {
  const difference = BigInt(left.numerator) * BigInt(right.denominator) - BigInt(right.numerator) * BigInt(left.denominator);
  const absolute = difference < BigInt(0) ? -difference : difference;
  return absolute > BigInt(0) && absolute * BigInt(10_000)
    >= BigInt(basisPoints) * BigInt(left.denominator) * BigInt(right.denominator);
}
type EvidenceCheck = Readonly<{ usable: readonly ContributionEvidenceReference[]; unusable: readonly ContributionEvidenceReference[]; reasons: readonly string[] }>;
function checkEvidence(
  refs: readonly ContributionEvidenceReference[], snapshot: ContributionReferenceSnapshot, atMs: number,
  independentOf: readonly string[] = [],
): EvidenceCheck {
  const usable: ContributionEvidenceReference[] = [];
  const unusable: ContributionEvidenceReference[] = [];
  const reasons: string[] = [];
  let independent = independentOf.length === 0;
  if (refs.length === 0) reasons.push("missing-evidence");
  for (const ref of refs) {
    const descriptor = snapshot.evidence.find(entry => entry.id === ref.id && entry.revision === ref.revision);
    const valid = descriptor && descriptor.sha256 === ref.sha256 && descriptor.availability === "available"
      && descriptor.recordedAtMs <= atMs && descriptor.recordedAtMs <= snapshot.asOfMs
      && snapshot.people.some(person => person.id === descriptor.custodianPersonId);
    if (!valid) { unusable.push(ref); reasons.push("unusable-evidence"); continue; }
    usable.push(ref);
    if (descriptor.source !== "self-report" && !independentOf.includes(descriptor.custodianPersonId)) independent = true;
  }
  if (!independent) reasons.push("independent-evidence-not-established");
  return { usable, unusable, reasons: sorted(reasons) };
}
function uniqueEvidence(refs: readonly ContributionEvidenceReference[]): ContributionEvidenceReference[] {
  return [...new Map(refs.map(ref => [JSON.stringify([ref.id, ref.revision, ref.sha256]), ref])).values()]
    .sort((left, right) => keyCompare(JSON.stringify(left), JSON.stringify(right)));
}
type WorkState = ContributionEntityState & { entity: ContributionRecord };
type AnalysisEnvironment = Readonly<{
  references: ContributionReferenceSnapshot;
  states: ReadonlyMap<string, ContributionEntityState>;
  catalog: ContributionPeriodReport;
  agreements: readonly ContributionCommitmentAgreement[];
  deliveries: readonly ContributionDeliveryObservation[];
  audit: readonly ContributionAuditEvent[];
  asOfMs: number;
}>;

function analyseCommitment(
  item: ContributionCommitmentAgreement, period: ContributionPeriod, report: ContributionPeriodReport,
  work: readonly WorkState[], environment: AnalysisEnvironment,
): ContributionCommitmentAnalysis {
  const reasons: string[] = [];
  const state = environment.states.get(item.expectationId);
  const expectation = state?.entity.kind === "expectation" ? state.entity : null;
  const criterion = expectation?.criteria.find(entry => entry.id === item.criterionId);
  const dimension = criterion?.dimension === "reported-minutes" || criterion?.dimension === "corroborated-minutes" ? criterion.dimension : null;
  if (!same(item.period, period) || !expectation || !same(expectation.period, period) || state?.version !== item.expectationVersion
    || state.withdrawnAtMs !== null || expectation.businessId !== item.businessId || expectation.roleId !== item.roleId
    || expectation.departmentId !== item.departmentId || !criterion) reasons.push("expectation-binding-mismatch");
  if (!dimension) reasons.push("not-a-numerical-time-commitment");
  if (item.agreedMinutes === 0) reasons.push("zero-commitment-no-ratio");
  if (item.agreedMinutes > Math.floor((period.endMs - period.startMs) / 60_000)) reasons.push("agreed-time-exceeds-elapsed-period");
  if (item.acceptedAtMs > period.startMs || item.reviewedAtMs > period.startMs || item.reviewedAtMs < item.acceptedAtMs
    || item.acceptedAtMs > environment.asOfMs || item.reviewedAtMs > environment.asOfMs) reasons.push("agreement-not-prospective");
  const boundVersionAt = environment.audit.find(event => event.body.type === "created"
    ? event.body.entity.id === item.expectationId && item.expectationVersion === 1
    : event.body.type === "corrected" && event.body.entityId === item.expectationId
      && event.body.expectedVersion + 1 === item.expectationVersion)?.recordedAtMs;
  if (boundVersionAt === undefined || boundVersionAt > item.acceptedAtMs) reasons.push("expectation-not-known-at-acceptance");
  if (item.reviewedByPersonId === item.personId || state?.authorPersonIds.includes(item.reviewedByPersonId)
    || !environment.references.people.some(person => person.id === item.reviewedByPersonId)) reasons.push("agreement-review-not-independent");
  if (!environment.references.people.some(person => person.id === item.personId)) reasons.push("unknown-person");
  if (item.responsibilityIds.length === 0) reasons.push("responsibilities-not-specified");
  const agreementEvidence = checkEvidence(item.evidence, environment.references, item.acceptedAtMs, [item.personId, ...(state?.authorPersonIds ?? [])]);
  reasons.push(...agreementEvidence.reasons);
  const expectations = report.expectations.filter(entry => entry.expectationId === item.expectationId && entry.criterionId === item.criterionId);
  const structuralReasons = [
    "expectation-not-independently-reviewed", "retrospective-expectation-or-review", "unresolved-expectation-context", "overlapping-expectations",
    "expectation-period-mismatch-no-proration",
  ];
  if (expectations.length === 0) reasons.push("expectation-not-observed");
  for (const entry of expectations) reasons.push(...entry.reasons.filter(reason => structuralReasons.includes(reason)));
  if (environment.agreements.some(other => other.id !== item.id && other.personId === item.personId
    && other.businessId === item.businessId && overlaps(other.period, item.period))) reasons.push("overlapping-person-commitments");
  const records = work.filter(entry => entry.entity.businessId === item.businessId && overlaps(entry.entity.period, period)
    && entry.entity.roleId === item.roleId && entry.entity.departmentId === item.departmentId && entry.entity.measure.kind === "hours");
  const allTimeInBusiness = work.filter(entry => entry.entity.businessId === item.businessId
    && overlaps(entry.entity.period, period) && entry.entity.measure.kind === "hours");
  if (allTimeInBusiness.some(entry => entry.entity.roleId !== item.roleId || entry.entity.departmentId !== item.departmentId)) {
    reasons.push("role-or-responsibility-context-changed");
  }
  if (records.some(entry => !contains(entry.entity.period, period))) reasons.push("cross-period-record-not-prorated");
  const assessments = records.map(entry => report.recordAssessments.find(assessment => assessment.recordId === entry.entity.id));
  if (records.length === 0) reasons.push("no-recorded-time");
  const descriptiveTimeOnly = ["hours-not-independently-corroborated"];
  if (assessments.some(entry => !entry?.evidenceAndContextSupported
    || entry.issueCodes.some(code => dimension !== "reported-minutes" || !descriptiveTimeOnly.includes(code)))) {
    reasons.push("time-evidence-or-context-uncertain");
  }
  const reported = records.flatMap(entry => entry.entity.measure.kind === "hours" ? [entry.entity.measure.reportedMinutes] : []);
  const supported = assessments.flatMap(entry => entry?.corroboratedMinutes === null || entry?.corroboratedMinutes === undefined ? [] : [entry.corroboratedMinutes]);
  if (dimension === "corroborated-minutes" && supported.length !== records.length) reasons.push("corroboration-incomplete");
  const observed = records.length === 0 ? null : dimension === "reported-minutes" ? sum(reported)
    : dimension === "corroborated-minutes" && supported.length === records.length ? sum(supported) : null;
  if (period.endMs > environment.asOfMs) reasons.push("period-not-complete");
  const expected = item.agreedMinutes;
  const comparable = reasons.length === 0 && expected !== null && expected > 0 && observed !== null;
  const invalidAgreement = reasons.some(reason => [
    "expectation-binding-mismatch", "not-a-numerical-time-commitment", "zero-commitment-no-ratio", "agreed-time-exceeds-elapsed-period",
    "agreement-not-prospective", "expectation-not-known-at-acceptance", "overlapping-person-commitments", "role-or-responsibility-context-changed",
    ...structuralReasons,
  ].includes(reason));
  return {
    agreementId: item.id, businessId: item.businessId, roleId: item.roleId, departmentId: item.departmentId,
    responsibilityIds: item.responsibilityIds, expectationId: item.expectationId, expectationVersion: item.expectationVersion,
    criterionId: item.criterionId, dimension, expectedMinutes: expected, recordedMinutes: observed,
    roleMinimumMinutes: criterion?.minimum ?? null,
    expectationStatement: criterion?.statement ?? null,
    shortfallMinutes: comparable ? Math.max(0, expected - observed) : null,
    recordedFulfilment: comparable ? { numerator: observed, denominator: expected } : null,
    status: comparable ? observed >= expected ? "recorded-at-or-above" : "recorded-shortfall"
      : invalidAgreement ? "different-or-unsettled-expectations" : "insufficient-evidence",
    comparable, reasons: sorted([...reasons, "reporting-coverage-not-established", "agreement-is-supplied-evidence-not-server-authority",
      ...(dimension === "reported-minutes" ? ["reported-time-is-not-independent-corroboration"] : [])]),
    supportingRecordIds: records.map(entry => entry.entity.id).sort(keyCompare), supportingEvidence: item.evidence,
  };
}

function analyseDelivery(
  observation: ContributionDeliveryObservation, agreement: ContributionCommitmentAgreement,
  commitment: ContributionCommitmentAnalysis, environment: AnalysisEnvironment,
): ContributionReliabilityObservation {
  const reasons: string[] = [];
  // Time-report completeness is not a prerequisite for assessing a separately
  // evidenced delivery, but an unsettled personal agreement remains a blocker.
  if (commitment.status === "different-or-unsettled-expectations"
    || commitment.reasons.some(reason => ["agreement-review-not-independent", "unknown-person", "missing-evidence",
      "unusable-evidence", "independent-evidence-not-established", "responsibilities-not-specified"].includes(reason))) {
    reasons.push("agreement-not-established");
  }
  if (!agreement.responsibilityIds.includes(observation.responsibilityId)) reasons.push("responsibility-not-agreed");
  if (observation.dueAtMs < agreement.period.startMs || observation.dueAtMs >= agreement.period.endMs
    || observation.acceptedAtMs > observation.dueAtMs || observation.reviewedAtMs > observation.dueAtMs
    || observation.reviewedAtMs < observation.acceptedAtMs
    || observation.acceptedAtMs < agreement.acceptedAtMs || observation.reviewedAtMs > environment.asOfMs) reasons.push("deadline-not-prospectively-agreed");
  const state = environment.states.get(observation.resultId);
  const result = state?.entity.kind === "shared-result" ? state.entity : null;
  const summary = environment.catalog.results.find(entry => entry.resultId === observation.resultId);
  const interested = sorted([agreement.personId, ...(state?.authorPersonIds ?? []), ...environment.audit.flatMap(event => {
    const entity = event.body.type === "created" ? event.body.entity : event.body.type === "corrected" ? event.body.replacement : null;
    if (entity?.kind === "contribution" && "resultId" in entity.measure && entity.measure.resultId === observation.resultId) return [entity.personId];
    if (entity?.kind === "allocation" && entity.resultId === observation.resultId) return entity.shares.map(share => share.personId);
    return [];
  })]);
  if (interested.includes(observation.reviewedByPersonId)
    || !environment.references.people.some(person => person.id === observation.reviewedByPersonId)) reasons.push("delivery-review-not-independent");
  reasons.push(...checkEvidence(observation.evidence, environment.references, observation.acceptedAtMs, interested).reasons);
  if (state && !result) reasons.push("delivery-target-is-not-a-shared-result");
  if (result && (state?.version !== observation.resultVersion || result.businessId !== agreement.businessId
    || state.withdrawnAtMs !== null)) reasons.push("result-version-or-business-mismatch");
  if (result && (!summary?.independentlyReviewed || !summary.participantIds.includes(agreement.personId))) reasons.push("reviewed-person-linked-result-not-established");
  if (result && !environment.catalog.recordAssessments.some(assessment => {
    const record = environment.states.get(assessment.recordId)?.entity;
    return assessment.personId === agreement.personId && assessment.evidenceAndContextSupported
      && assessment.issueCodes.length === 0 && record?.kind === "contribution"
      && "resultId" in record.measure && record.measure.resultId === result.id;
  })) reasons.push("supported-person-participation-not-established");
  const occurrence = result?.occurredAtMs ?? null;
  if (occurrence !== null && occurrence < observation.acceptedAtMs) reasons.push("result-predates-delivery-agreement");
  return {
    observationId: observation.id, agreementId: agreement.id, responsibilityId: observation.responsibilityId,
    resultId: observation.resultId, dueAtMs: observation.dueAtMs, occurredAtMs: occurrence,
    status: reasons.length > 0 ? "uncertain" : !result
      ? observation.dueAtMs > environment.asOfMs ? "not-yet-due" : "completion-not-evidenced"
      : occurrence !== null && occurrence <= observation.dueAtMs ? "evidenced-on-time" : "evidenced-late",
    reasons: sorted([...reasons, "delivery-timing-does-not-establish-personal-fault-or-quality"]), evidence: observation.evidence,
  };
}

function personPeriod(
  personId: string, periodId: string, period: ContributionPeriod, report: ContributionPeriodReport,
  environment: AnalysisEnvironment,
): ContributionIntelligencePersonPeriod {
  const allWork = [...environment.states.values()].filter((state): state is WorkState =>
    state.entity.kind === "contribution" && state.entity.personId === personId && state.withdrawnAtMs === null);
  const relevant = allWork.filter(state => overlaps(state.entity.period, period));
  const included = relevant.filter(state => contains(state.entity.period, period));
  const assessments = report.recordAssessments.filter(entry => entry.personId === personId);
  const rows = report.people.filter(entry => entry.personId === personId);
  const reported = rows.flatMap(row => row.reportedMinutes === null ? [] : [row.reportedMinutes]);
  const corroborated = rows.flatMap(row => row.corroboratedMinutes === null ? [] : [row.corroboratedMinutes]);
  const hasIncompleteTime = rows.some(row => row.reportedMinutes !== null && row.corroboratedMinutes === null);
  const reportedMinutes = reported.length === 0 ? null : sum(reported);
  const corroboratedMinutes = corroborated.length === 0 || hasIncompleteTime ? null : sum(corroborated);
  const commitments = environment.agreements.filter(item => item.personId === personId && overlaps(item.period, period))
    .map(item => analyseCommitment(item, period, report, allWork, environment));
  const relevantAgreements = environment.agreements.filter(item => commitments.some(entry => entry.agreementId === item.id));
  const relevantDeliveries = environment.deliveries.filter(observation =>
    relevantAgreements.some(item => item.id === observation.agreementId));
  const resultRows = report.results.filter(result => result.participantIds.includes(personId));
  const catalogResultRows = environment.catalog.results.filter(result => result.participantIds.includes(personId));
  const related = new Map<string, ContributionEntityState>(relevant.map(state => [state.entity.id, state]));
  const relatedResultIds = sorted([
    ...resultRows.map(result => result.resultId),
    ...catalogResultRows.filter(result => included.some(entry => "resultId" in entry.entity.measure
      && entry.entity.measure.resultId === result.resultId)).map(result => result.resultId),
    ...relevantDeliveries.map(observation => observation.resultId),
  ]);
  for (const resultId of relatedResultIds) {
    const state = environment.states.get(resultId);
    if (state) related.set(state.entity.id, state);
    for (const participation of environment.states.values()) {
      const record = participation.entity;
      if ((record.kind === "contribution" && "resultId" in record.measure && record.measure.resultId === resultId)
        || (record.kind === "allocation" && record.resultId === resultId)) {
        related.set(record.id, participation);
      }
    }
  }
  for (const item of commitments) {
    const state = environment.states.get(item.expectationId);
    if (state) related.set(state.entity.id, state);
  }
  const relevantIds = new Set(related.keys());
  const issues = [...new Map([...report.issues, ...environment.catalog.issues.filter(issue =>
    issue.entityId !== null && environment.states.get(issue.entityId)?.entity.kind !== "expectation")]
    .filter(issue => (issue.entityId !== null && relevantIds.has(issue.entityId))
      || (issue.entityId === null && issue.code !== "period-not-complete"))
    .map(issue => [JSON.stringify(issue), issue])).values()];
  if (period.endMs > environment.asOfMs) issues.push({ entityId: null, code: "period-not-complete" });
  const evidenceUsages: { refs: readonly ContributionEvidenceReference[]; atMs: number }[] = [];
  for (const event of environment.audit) {
    const body = event.body;
    const entityId = body.type === "created" ? body.entity.id : body.entityId;
    if (!relevantIds.has(entityId)) continue;
    if (body.type === "created") evidenceUsages.push({ refs: body.entity.evidence, atMs: event.recordedAtMs });
    else {
      evidenceUsages.push({ refs: body.evidence, atMs: event.recordedAtMs });
      if (body.type === "corrected") evidenceUsages.push({ refs: body.replacement.evidence, atMs: event.recordedAtMs });
    }
  }
  relevantAgreements.forEach(item => evidenceUsages.push({ refs: item.evidence, atMs: item.acceptedAtMs }));
  relevantDeliveries.forEach(item => evidenceUsages.push({ refs: item.evidence, atMs: item.acceptedAtMs }));
  const evidence = uniqueEvidence(evidenceUsages.flatMap(usage => usage.refs));
  const unusable = uniqueEvidence(evidenceUsages.flatMap(usage => checkEvidence(usage.refs, environment.references, usage.atMs).unusable));
  const openDisputes = [...related.values()].flatMap(state => state.disputes.filter(dispute => dispute.resolution === null)
    .map(dispute => ({ entityId: state.entity.id, disputeId: dispute.id, version: dispute.version })));
  const adverse = [...related.values()].filter(state =>
    state.disputes.some(dispute => dispute.resolution?.finding === "not-supported" && dispute.resolution.version === state.version));
  const deliveries = environment.deliveries.flatMap(observation => {
    const item = environment.agreements.find(entry => entry.id === observation.agreementId && entry.personId === personId);
    const analysis = commitments.find(entry => entry.agreementId === observation.agreementId);
    return item && analysis
      ? [analyseDelivery(observation, item, analysis, environment)] : [];
  });
  const attributedParticipationIds = included.filter(state => {
    const measurement = state.entity.measure;
    if (!("resultId" in measurement)) return false;
    const result = environment.catalog.results.find(entry => entry.resultId === measurement.resultId);
    const allocationState = result?.allocationId ? environment.states.get(result.allocationId) : undefined;
    const allocation = allocationState?.entity.kind === "allocation" ? allocationState.entity : null;
    return assessments.some(entry => entry.recordId === state.entity.id && entry.evidenceAndContextSupported)
      && result?.attributionStatus === "reviewed" && result.effectiveShares.some(share => share.personId === personId)
      && allocation?.participationVersions.some(ref => ref.entityId === state.entity.id && ref.version === state.version);
  }).map(state => state.entity.id);
  const unresolvedReasons = sorted([
    ...issues.map(issue => issue.code), ...commitments.flatMap(item => item.reasons),
    ...(openDisputes.length ? ["open-disputes"] : []),
    ...deliveries.flatMap(observation => observation.reasons.filter(reason => reason !== "delivery-timing-does-not-establish-personal-fault-or-quality")),
    ...(!environment.references.people.some(person => person.id === personId) ? ["unknown-person"] : []),
    ...(relevantAgreements.some(item => item.evidence.length === 0) || relevantDeliveries.some(item => item.evidence.length === 0)
      ? ["missing-evidence"] : []),
    ...resultRows.filter(result => result.attributionStatus !== "reviewed").map(() => "attribution-not-established"),
    "coverage-not-established", "human-legal-contractual-and-budget-review-required",
  ]);
  return {
    personId, periodId, identityStatus: environment.references.people.some(person => person.id === personId) ? "known" : "unknown",
    hours: {
      reportedMinutes, corroboratedMinutes, corroboratedSubsetMinutes: sum(rows.map(row => row.corroboratedSubsetMinutes)),
      reportedHours: reportedMinutes === null ? null : { numerator: reportedMinutes, denominator: 60 },
      corroboratedHours: corroboratedMinutes === null ? null : { numerator: corroboratedMinutes, denominator: 60 },
      limitations: sorted(["hours-are-not-enterprise-value", "reporting-coverage-not-established",
        ...rows.flatMap(row => row.issueCodes),
        ...(relevant.some(state => !contains(state.entity.period, period)) ? ["boundary-records-excluded-without-proration"] : [])]),
    },
    commitments,
    contributions: {
      recordedIds: included.map(state => state.entity.id).sort(keyCompare),
      evidenceSupportedIds: assessments.filter(entry => entry.evidenceAndContextSupported).map(entry => entry.recordId).sort(keyCompare),
      independentlyCorroboratedTimeIds: assessments.filter(entry => entry.corroboratedMinutes !== null).map(entry => entry.recordId).sort(keyCompare),
      reviewedAttributedParticipationIds: attributedParticipationIds.sort(keyCompare),
      qualitativeAssertionIds: included.filter(state => state.entity.measure.kind === "quality" || state.entity.measure.kind === "initiative").map(state => state.entity.id).sort(keyCompare),
      verificationMeaning: "evidence-supported-assertions-not-independent-proof-of-enterprise-value",
    },
    results: resultRows.map(result => {
      const share = result.effectiveShares.find(entry => entry.personId === personId);
      return {
        resultId: result.resultId, kind: result.resultKind, independentlyReviewed: result.independentlyReviewed,
        attributionStatus: result.attributionStatus,
        allocatedBasisPointsForPerson: result.attributionStatus === "reviewed" ? share?.basisPoints ?? 0 : null,
        financialShare: share?.money ?? null,
      };
    }),
    reliability: {
      observations: deliveries, evidencedOnTime: deliveries.filter(entry => entry.status === "evidenced-on-time").length,
      evidencedLate: deliveries.filter(entry => entry.status === "evidenced-late").length,
      unresolvedDue: deliveries.filter(entry => entry.status === "completion-not-evidenced" || entry.status === "uncertain").length,
      notYetDue: deliveries.filter(entry => entry.status === "not-yet-due").length,
      denominator: "explicit-delivery-observations-only-not-all-responsibilities",
    },
    evidenceCompleteness: {
      includedRecordCount: included.length, supportedRecordCount: assessments.filter(entry => entry.evidenceAndContextSupported).length,
      unsupportedRecordIds: assessments.filter(entry => !entry.evidenceAndContextSupported).map(entry => entry.recordId).sort(keyCompare),
      referencedEvidenceCount: evidence.length, usableEvidenceCount: evidence.length - unusable.length,
      missingOrUnusableEvidence: unusable,
      missingEvidenceEntityIds: [...related.values()].filter(state => state.entity.evidence.length === 0).map(state => state.entity.id).sort(keyCompare),
      missingEvidenceAgreementIds: relevantAgreements.filter(item => item.evidence.length === 0).map(item => item.id),
      missingEvidenceDeliveryIds: relevantDeliveries.filter(item => item.evidence.length === 0).map(item => item.id),
      reportingCoverage: "not-established",
    },
    uncertainty: {
      excludedBoundaryRecordIds: relevant.filter(state => !contains(state.entity.period, period)).map(state => state.entity.id).sort(keyCompare),
      openDisputes, adverseFindingEntityIds: adverse.map(state => state.entity.id).sort(keyCompare),
      blockedAllocationResultIds: resultRows.filter(result => result.attributionStatus === "blocked").map(result => result.resultId),
      unallocatedResultIds: resultRows.filter(result => result.unallocatedBasisPoints > 0).map(result => result.resultId),
      issues,
    },
    actualUnderperformance: "not-established-requires-complete-evidence-and-human-context",
    rewardDecisionSupport: {
      status: "human-review-inputs-only",
      reviewedResultIds: resultRows.filter(result => result.independentlyReviewed).map(result => result.resultId),
      reviewedAllocationResultIds: resultRows.filter(result => result.attributionStatus === "reviewed").map(result => result.resultId),
      unresolvedReasons, determinesPay: false, determinesBonus: false, determinesProfitShare: false, determinesEquity: false,
    },
  };
}

function contextKey(item: ContributionCommitmentAnalysis): string {
  return JSON.stringify([item.businessId, item.roleId, item.departmentId, item.responsibilityIds, item.dimension, item.expectationStatement]);
}
function comparePeople(
  periodId: string, left: ContributionIntelligencePersonPeriod, right: ContributionIntelligencePersonPeriod,
  gap: number,
): ContributionPairComparison[] {
  const pairs = left.commitments.flatMap(a => right.commitments.filter(b => a.businessId === b.businessId).map(b => ({ a, b })));
  if (pairs.length === 0) return [{
    periodId, personIds: [left.personId, right.personId], businessId: null, agreementIds: null,
    comparable: false, recordedFulfilment: null, higherRecordedFulfilmentPersonId: null, gapMeetsPolicy: false,
    reasons: ["no-shared-explicit-commitment-context"],
  }];
  return pairs.map(({ a, b }) => {
    const reasons: string[] = [];
    if (!a.comparable || !b.comparable || !a.recordedFulfilment || !b.recordedFulfilment) reasons.push("insufficient-or-unsettled-commitment-evidence");
    if (contextKey(a) !== contextKey(b)) reasons.push("different-roles-responsibilities-or-measurement-basis");
    const comparable = reasons.length === 0 && a.recordedFulfilment !== null && b.recordedFulfilment !== null;
    const direction = comparable && a.recordedFulfilment && b.recordedFulfilment ? fractionCompare(a.recordedFulfilment, b.recordedFulfilment) : 0;
    return {
      periodId, personIds: [left.personId, right.personId], businessId: a.businessId, agreementIds: [a.agreementId, b.agreementId],
      comparable, recordedFulfilment: comparable && a.recordedFulfilment && b.recordedFulfilment ? [a.recordedFulfilment, b.recordedFulfilment] : null,
      higherRecordedFulfilmentPersonId: direction > 0 ? left.personId : direction < 0 ? right.personId : null,
      gapMeetsPolicy: comparable && a.recordedFulfilment && b.recordedFulfilment ? meetsGap(a.recordedFulfilment, b.recordedFulfilment, gap) : false,
      reasons: sorted([...reasons, "normalised-time-observations-not-personal-worth-or-complete-performance"]),
    };
  });
}

export function analyseContributionIntelligence(value: ContributionIntelligenceInput):
  | Readonly<{ status: "analysed"; intelligence: ContributionIntelligence }> & typeof CONTRIBUTION_SAFETY
  | ContributionDomainRefusal {
  try {
    const input = contributionFields(value, ["ledger", "references", "personIds", "periods", "agreements", "deliveries", "asOfMs", "nowMs", "trendPolicy"]);
    const nowMs = contributionCounter(input.nowMs);
    const asOfMs = contributionCounter(input.asOfMs);
    if (asOfMs >= Number.MAX_SAFE_INTEGER) throw new Error("As-of time leaves no safe complete result-catalog boundary.");
    const personIds = ids(input.personIds);
    const periods = contributionList(input.periods, entry => {
      const item = contributionFields(entry, ["id", "period"]);
      return { id: contributionId(item.id), period: decodeContributionPeriod(item.period) };
    }).sort((left, right) => left.period.startMs - right.period.startMs || keyCompare(left.id, right.id));
    if (periods.length === 0 || new Set(periods.map(entry => entry.id)).size !== periods.length) throw new Error("Explicit unique reporting periods are required.");
    for (let index = 1; index < periods.length; index += 1) {
      if (overlaps(periods[index - 1].period, periods[index].period)) throw new Error("Reporting periods cannot overlap or duplicate organisational outcomes.");
    }
    const agreements = contributionList(input.agreements, agreement).sort((left, right) => keyCompare(left.id, right.id));
    const deliveries = contributionList(input.deliveries, delivery).sort((left, right) => keyCompare(left.id, right.id));
    if (new Set(agreements.map(item => item.id)).size !== agreements.length || new Set(deliveries.map(item => item.id)).size !== deliveries.length) {
      throw new Error("Duplicate agreement/delivery observations must be reconciled, not double counted.");
    }
    const deliveryKeys = deliveries.map(item => JSON.stringify([item.agreementId, item.responsibilityId, item.resultId]));
    if (new Set(deliveryKeys).size !== deliveries.length) throw new Error("Conflicting deadlines for one person/result responsibility require explicit reconciliation.");
    if (deliveries.some(item => !agreements.some(entry => entry.id === item.agreementId))) throw new Error("Delivery observation references an unknown explicit agreement.");
    const policy = contributionFields(input.trendPolicy, ["minimumConsecutivePeriods", "minimumGapBasisPoints"]);
    const minimumConsecutivePeriods = contributionCounter(policy.minimumConsecutivePeriods);
    const minimumGapBasisPoints = contributionCounter(policy.minimumGapBasisPoints);
    if (minimumConsecutivePeriods < 2 || minimumGapBasisPoints < 1 || minimumGapBasisPoints > 10_000) {
      throw new Error("Trend policy needs at least two periods and an explicit 1..10000 basis-point gap; no default commitment rating is supplied.");
    }
    const references = decodeContributionReferenceSnapshot(input.references);
    const projected = projectContributionLedger(input.ledger, nowMs, asOfMs);
    if (projected.status === "refused") return projected;
    const catalogResult = buildContributionPeriodReport(input.ledger, references, { startMs: 0, endMs: asOfMs + 1 }, nowMs, asOfMs);
    if (catalogResult.status === "refused") return catalogResult;
    const environment: AnalysisEnvironment = {
      references, states: new Map(projected.projection.entities.map(state => [state.entity.id, state])),
      catalog: catalogResult.report, agreements, deliveries, asOfMs, audit: projected.projection.audit,
    };
    const reports = periods.map(item => {
      const result = buildContributionPeriodReport(input.ledger, references, item.period, nowMs, asOfMs);
      if (result.status === "refused") throw new Error(result.message);
      return result.report;
    });
    const people = periods.flatMap((item, index) => personIds.map(personId => personPeriod(personId, item.id, item.period, reports[index], environment)));
    const comparisons = periods.flatMap(item => {
      const rows = people.filter(row => row.periodId === item.id);
      return rows.flatMap((left, index) => rows.slice(index + 1).flatMap(right => comparePeople(item.id, left, right, minimumGapBasisPoints)));
    });
    const trends: ContributionPersonTrend[] = [];
    const sustainedImbalances: ContributionIntelligence["sustainedImbalances"][number][] = [];
    for (const personId of personIds) {
      const contexts = sorted(people.filter(row => row.personId === personId).flatMap(row => row.commitments.map(contextKey)));
      for (const context of contexts) {
        let run: { row: ContributionIntelligencePersonPeriod; item: ContributionCommitmentAnalysis }[] = [];
        const flush = () => {
          if (run.length < minimumConsecutivePeriods) { run = []; return; }
          const fractions = run.flatMap(entry => entry.item.recordedFulfilment ? [entry.item.recordedFulfilment] : []);
          const directions = fractions.slice(1).map((fraction, index) => fractionCompare(fraction, fractions[index]));
          let shortfalls = 0;
          for (const entry of [...run].reverse()) { if (entry.item.status !== "recorded-shortfall") break; shortfalls += 1; }
          const reliability = run.flatMap(entry => entry.row.reliability.observations.filter(observation =>
            observation.agreementId === entry.item.agreementId));
          trends.push({
            personId, agreementContext: context, periodIds: run.map(entry => entry.row.periodId), fulfilment: fractions,
            direction: directions.every(direction => direction === 0) ? "unchanged"
              : directions.every(direction => direction >= 0) ? "increasing-recorded-fulfilment"
                : directions.every(direction => direction <= 0) ? "decreasing-recorded-fulfilment" : "mixed",
            netChangeMeetsGapPolicy: meetsGap(fractions[0], fractions[fractions.length - 1], minimumGapBasisPoints),
            consecutiveRecordedShortfalls: shortfalls, sustainedRecordedShortfall: shortfalls >= minimumConsecutivePeriods,
            reliability: {
              evidencedOnTime: reliability.filter(observation => observation.status === "evidenced-on-time").length,
              evidencedLate: reliability.filter(observation => observation.status === "evidenced-late").length,
              unresolvedDue: reliability.filter(observation => observation.status === "completion-not-evidenced" || observation.status === "uncertain").length,
            },
            limitations: ["recorded-fulfilment-not-a-commitment-rating", "coverage-not-established", "common-as-of-history-may-include-late-corrections"],
          });
          run = [];
        };
        for (const [index, period] of periods.entries()) {
          const row = people.find(entry => entry.personId === personId && entry.periodId === period.id);
          const matches = row?.commitments.filter(item => contextKey(item) === context) ?? [];
          if (!row || matches.length !== 1 || !matches[0].comparable || !matches[0].recordedFulfilment
            || (run.length > 0 && (periods[index - 1].period.endMs !== period.period.startMs
              || periods[index - 1].period.endMs - periods[index - 1].period.startMs !== period.period.endMs - period.period.startMs))) flush();
          if (row && matches.length === 1 && matches[0].comparable && matches[0].recordedFulfilment) run.push({ row, item: matches[0] });
        }
        flush();
      }
    }
    for (let leftIndex = 0; leftIndex < personIds.length; leftIndex += 1) {
      for (const rightId of personIds.slice(leftIndex + 1)) {
        const leftId = personIds[leftIndex];
        const contexts = sorted(people.filter(row => row.personId === leftId).flatMap(row => row.commitments.map(contextKey)));
        for (const context of contexts) {
          let run: ContributionPairComparison[] = [];
          const flush = () => {
            const first = run[0];
            if (run.length >= minimumConsecutivePeriods && first?.higherRecordedFulfilmentPersonId) sustainedImbalances.push({
              personIds: [leftId, rightId], higherRecordedFulfilmentPersonId: first.higherRecordedFulfilmentPersonId,
              agreementContext: context, periodIds: run.map(entry => entry.periodId),
              agreementPairs: run.flatMap(entry => entry.agreementIds ? [entry.agreementIds] : []),
            });
            run = [];
          };
          for (const [index, period] of periods.entries()) {
            const left = people.find(row => row.personId === leftId && row.periodId === period.id)?.commitments.filter(item => contextKey(item) === context) ?? [];
            const right = people.find(row => row.personId === rightId && row.periodId === period.id)?.commitments.filter(item => contextKey(item) === context) ?? [];
            const pair = left.length === 1 && right.length === 1 ? comparisons.find(entry => entry.periodId === period.id
              && entry.agreementIds?.[0] === left[0].agreementId && entry.agreementIds?.[1] === right[0].agreementId) : undefined;
            if (!pair?.comparable || !pair.gapMeetsPolicy || !pair.higherRecordedFulfilmentPersonId
              || (run.length > 0 && (run[0].higherRecordedFulfilmentPersonId !== pair.higherRecordedFulfilmentPersonId
                || periods[index - 1].period.endMs !== period.period.startMs
                || periods[index - 1].period.endMs - periods[index - 1].period.startMs !== period.period.endMs - period.period.startMs))) flush();
            if (pair?.comparable && pair.gapMeetsPolicy && pair.higherRecordedFulfilmentPersonId) run.push(pair);
          }
          flush();
        }
      }
    }
    return freezeContributionValue({
      status: "analysed", ...CONTRIBUTION_SAFETY,
      intelligence: {
        version: CONTRIBUTION_INTELLIGENCE_VERSION, ...CONTRIBUTION_SAFETY,
        scope: projected.projection.scope, asOfMs, sourceRevision: projected.projection.sourceRevision,
        observedRevision: projected.projection.observedRevision, personIds,
        periods: periods.map((item, index) => ({
          ...item, organisationalResults: reports[index].results,
          uniqueResultCounts: reports[index].uniqueResultCounts, financialBuckets: reports[index].financialBuckets,
        })),
        people, comparisons, trends, sustainedImbalances, trendPolicy: { minimumConsecutivePeriods, minimumGapBasisPoints },
        limitations: [
          "supplied-agreements-and-evidence-are-not-authenticated-or-durable",
          "coverage-not-established-missing-data-is-not-zero-contribution",
          "no-composite-score-person-ranking-or-automatic-reward",
          "reviewed-allocation-is-not-legal-or-contractual-entitlement",
          "semantic-outcome-deduplication-remains-an-upstream-responsibility",
          "founder-facing-data-requires-server-authorisation-before-disclosure",
          "absent-trend-means-insufficient-comparable-consecutive-history-not-stability",
          "agreements-and-delivery-observations-require-versioned-historical-provenance-before-production",
        ],
      },
    });
  } catch (error) {
    return contributionRefusal(`Contribution intelligence refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}
