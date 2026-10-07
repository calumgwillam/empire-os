import { isValidCalendarDateInput } from "./dates";

export const ICARUS_STORAGE_KEY = "empire-os-icarus-assessments";

export const ICARUS_SOURCE_TYPES = [
  "Capture",
  "Problem",
  "Action",
  "Decision",
  "Lesson",
  "Project",
  "System",
  "SOP",
  "Opportunity",
  "Lead",
  "Outreach",
  "Commitment",
  "Finance",
  "Person",
  "Pillar",
  "Strategic Objective",
] as const;

export type IcarusSourceType = (typeof ICARUS_SOURCE_TYPES)[number];

export type IcarusRecordReference = {
  recordType: IcarusSourceType;
  recordId: string;
};

export type IcarusEvidenceReview =
  | "Unreviewed"
  | "Supports"
  | "Contradicts"
  | "Unresolved";

export type IcarusEvidence = {
  id: string;
  statement: string;
  origin: "Source record" | "Direct observation";
  reference?: IcarusRecordReference;
  observedAt?: string;
  recordedAt: string;
  recordedBy: string;
  review: IcarusEvidenceReview;
  reviewedAt?: string;
  reviewedBy?: string;
  validUntil?: string;
};

export type IcarusFailureMode = {
  id: string;
  mechanism: string;
  vulnerability: string;
  evidence: IcarusEvidence[];
};

export type IcarusControlLifecycle =
  | "Planned"
  | "Active"
  | "Monitoring"
  | "Ineffective"
  | "Retired";

export type IcarusControlEffectiveness =
  | "Unknown"
  | "Untested"
  | "Weak"
  | "Evidence supports"
  | "Evidence contradicts"
  | "Unresolved";

export const ICARUS_CONTROL_TEST_RESULTS = ["Passed", "Failed", "Inconclusive"] as const;

export type IcarusControlTestResult = (typeof ICARUS_CONTROL_TEST_RESULTS)[number];

// A recorded test of whether a control actually works. Tests are dated, attributed to a stable Person id
// (never a name) and cite the failure mode's evidence they relied on. A "Passed" test only assures the
// control when that cited evidence is current and reviewed as supporting.
export type IcarusControlTest = {
  id: string;
  testedAt: string;
  testedByPersonId: string;
  result: IcarusControlTestResult;
  evidenceIds: string[];
  note?: string;
};

export type IcarusControl = {
  id: string;
  failureModeId: string;
  intervention: string;
  lifecycle: IcarusControlLifecycle;
  effectiveness: IcarusControlEffectiveness;
  effectivenessReviewedAt?: string;
  effectivenessReviewedBy?: string;
  evidenceIds: string[];
  linkedRecords: IcarusRecordReference[];
  nextReviewAt?: string;
  // Phase 3 assurance (optional; legacy controls omit them).
  ownerPersonId?: string;
  // Test requirement: the control must be re-tested within this many days of its last assurance event.
  testCadenceDays?: number;
  assuranceTests?: IcarusControlTest[];
};

// A deliberate, attributable decision to tolerate specific failure modes for a bounded period. It never
// removes or controls the failure mechanism; it only records who owns the decision to live with it.
export type IcarusExposureAcceptance = {
  id: string;
  failureModeIds: string[];
  acceptedByPersonId: string;
  rationale: string;
  acceptedAt: string;
  reviewBy: string;
  conditions?: string;
  revokedAt?: string;
};

// Links a derived assurance obligation (by its stable id) to an existing Action. Completion of the Action
// never discharges the obligation; only the underlying assurance state can.
export type IcarusAssuranceActionLink = {
  obligationId: string;
  actionId: string;
  linkedAt: string;
};

export type IcarusTreatmentExecutionLink = {
  recordType: "Action" | "Project";
  recordId: string;
  linkedAt: string;
};

export type IcarusTreatmentTargetRecord = {
  id: string;
  sourceKind: "Assurance obligation" | "Dependency / resilience intervention" | "Failure-chain restoration" | "Stress discovery";
  sourceId: string;
  assessmentId: string;
  failureModeId?: string;
  controlId?: string;
  dependencyReference?: IcarusRecordReference;
  treatmentKind: string;
  reason: string;
  basis: string[];
  affectedAssessmentIds: string[];
  objectiveIds: string[];
  pillarIds: string[];
  provenance: {
    kind: "Assurance obligation" | "Dependency / resilience recommendation" | "Failure-chain recommendation" | "Stress discovery";
    finding: string;
  };
  executionLinks: IcarusTreatmentExecutionLink[];
  promotedAt: string;
};

export type IcarusTreatmentOutcomeCategory =
  | "Effective"
  | "Partially effective"
  | "Ineffective"
  | "Inconclusive"
  | "No longer applicable";

export type IcarusTreatmentOutcomeEvidence =
  | {
    kind: "Control test";
    assessmentId: string;
    failureModeId: string;
    controlId: string;
    testId: string;
    result: IcarusControlTestResult;
    assuranceStatus: "Assured" | "Failed" | "Test overdue" | "Evidence insufficient" | "Inconclusive" | "Untested" | "Not operating";
    evidenceStatus: "Current support" | "No current support" | "Conflicting" | "Not applicable";
    evidenceIds: string[];
  }
  | {
    kind: "Dependency health";
    dependencyReference: IcarusRecordReference;
    health: "Healthy" | "Watch" | "Degraded" | "Failed" | "Unknown" | "Not applicable";
    source: "Explicit" | "Derived";
    basis: string[];
  }
  | {
    kind: "Failure mode materiality";
    assessmentId: string;
    failureModeId: string;
    material: boolean;
  };

export type IcarusTreatmentOutcomeStateFact =
  | {
    kind: "Control assurance";
    state: "Assured" | "Failed" | "Test overdue" | "Evidence insufficient" | "Inconclusive" | "Untested" | "Not operating" | "Partially assured";
  }
  | {
    kind: "Dependency health";
    state: "Healthy" | "Watch" | "Degraded" | "Failed" | "Unknown" | "Not applicable";
  }
  | {
    kind: "Failure mode materiality";
    state: "Material" | "Not material";
  };

export type IcarusTreatmentOutcomeRecord = {
  id: string;
  treatmentTargetId: string;
  assessmentId: string;
  executionLinks: IcarusTreatmentExecutionLink[];
  outcome: IcarusTreatmentOutcomeCategory;
  verifiedAt: string;
  verifiedByPersonId: string;
  evidence: IcarusTreatmentOutcomeEvidence[];
  beforeState?: IcarusTreatmentOutcomeStateFact;
  afterState: IcarusTreatmentOutcomeStateFact;
  verificationNote: string;
};

export type IcarusInterventionScope = {
  assessmentIds: string[];
  failureModes: { assessmentId: string; failureModeId: string }[];
  dependencyReferences: IcarusRecordReference[];
  objectiveIds: string[];
  pillarIds: string[];
};

export type IcarusInterventionProvenance = {
  createdAt: string;
  updatedAt: string;
  createdByPersonId: string;
  updatedByPersonId: string;
};

export type IcarusCauseRecord = IcarusInterventionScope & IcarusInterventionProvenance & {
  id: string;
  title: string;
  description: string;
};

export const ICARUS_INTERVENTION_INTENTS = ["Symptom treatment", "Root-cause treatment", "Systemic intervention"] as const;
export const ICARUS_INTERVENTION_SCOPES = ["Local", "Multi-risk", "Cross-pillar", "Systemic"] as const;
export const ICARUS_INTERVENTION_CHARACTERS = ["Temporary", "Transitional", "Structural"] as const;
export const ICARUS_INTERVENTION_RELATIONSHIPS = [
  "prerequisite-of", "must-precede", "blocks", "mutually-exclusive-with", "complements",
] as const;
export const ICARUS_INTERVENTION_EFFECTS = [
  "Potentially improves", "Potentially worsens", "Creates dependency", "Removes dependency", "Unknown",
] as const;

export type IcarusInterventionOption = IcarusInterventionScope & {
  id: string;
  name: string;
  description: string;
  causeIds: string[];
  intent?: (typeof ICARUS_INTERVENTION_INTENTS)[number];
  scope?: (typeof ICARUS_INTERVENTION_SCOPES)[number];
  character?: (typeof ICARUS_INTERVENTION_CHARACTERS)[number];
  // Selected is derived only from the decision's explicit selectedOptionId.
  status: "Candidate" | "Rejected" | "Superseded";
  rationale: string;
  priorOptionIds: string[];
  treatmentLinks: { targetId: string; linkedAt: string; linkedByPersonId: string }[];
};

export type IcarusInterventionRelation = {
  id: string;
  fromOptionId: string;
  toOptionId: string;
  kind: (typeof ICARUS_INTERVENTION_RELATIONSHIPS)[number];
  rationale: string;
  recordedAt: string;
  recordedByPersonId: string;
};

export type IcarusInterventionEffect = {
  id: string;
  optionId: string;
  target:
    | { kind: "Cause"; id: string }
    | { kind: "Assessment"; id: string }
    | { kind: "Dependency"; reference: IcarusRecordReference }
    | { kind: "Strategic Objective"; id: string }
    | { kind: "Pillar"; id: string };
  direction: (typeof ICARUS_INTERVENTION_EFFECTS)[number];
  rationale: string;
  evidence: { assessmentId: string; failureModeId: string; evidenceId: string }[];
  recordedAt: string;
  recordedByPersonId: string;
};

export type IcarusInterventionDecisionRecord = IcarusInterventionScope & IcarusInterventionProvenance & {
  id: string;
  title: string;
  causeIds: string[];
  decisionRecordId?: string;
  status: "Draft" | "Recorded" | "Superseded";
  selectedOptionId?: string;
  rationale: string;
  nextReviewBy?: string;
  options: IcarusInterventionOption[];
  selectionHistory: {
    id: string; optionId: string; rationale: string; selectedAt: string; selectedByPersonId: string;
  }[];
  relationships: IcarusInterventionRelation[];
  effects: IcarusInterventionEffect[];
  // Lesson content/review stays in Lessons. Cause scope is explicitly confirmed, never inferred.
  lessonLinks: {
    id: string; lessonId: string; outcomeIds: string[]; causeIds: string[];
    rationale: string; linkedAt: string; linkedByPersonId: string;
  }[];
};

export type IcarusAssessmentStatus = "Open" | "Monitoring" | "Closed";

export type IcarusAssessmentRecord = {
  id: string;
  outcome: string;
  status: IcarusAssessmentStatus;
  createdAt: string;
  updatedAt: string;
  linkedRecords: IcarusRecordReference[];
  failureModes: IcarusFailureMode[];
  controls: IcarusControl[];
  // Phase 3 assurance (optional; legacy assessments omit them). Ownership is a stable Person id only.
  accountableOwnerPersonId?: string;
  reviewedAt?: string;
  reviewedByPersonId?: string;
  nextReviewBy?: string;
  acceptances?: IcarusExposureAcceptance[];
  assuranceActionLinks?: IcarusAssuranceActionLink[];
  // Derived treatment candidates remain separate from these explicitly promoted, persisted targets.
  treatmentTargets?: IcarusTreatmentTargetRecord[];
  // Explicit, evidence-linked verification events. Absence on legacy records means no verification is recorded.
  treatmentOutcomes?: IcarusTreatmentOutcomeRecord[];
  causes?: IcarusCauseRecord[];
  interventionDecisions?: IcarusInterventionDecisionRecord[];
};

export type IcarusSourceRecord = IcarusRecordReference & {
  title: string;
  status?: string;
  health?: string;
  relevantAt?: string;
};

export type IcarusEvidenceFreshness =
  | "Current"
  | "Not time-bounded"
  | "Stale"
  | "Invalid";

export type IcarusReviewFindingCode =
  | "missing-outcome"
  | "no-failure-modes"
  | "incomplete-failure-mode"
  | "no-evidence"
  | "unreviewed-evidence"
  | "unresolved-evidence"
  | "stale-evidence"
  | "invalid-evidence"
  | "conflicting-evidence"
  | "missing-source"
  | "missing-control"
  | "planned-control"
  | "untested-control"
  | "missing-control-review"
  | "weak-control"
  | "stale-control-review"
  | "invalid-control-review"
  | "invalid-control-assessment"
  | "ineffective-control"
  | "contradicted-control"
  | "failed-control-test"
  | "inconclusive-control-test"
  | "unsupported-control-test"
  | "overdue-control-test";

export type IcarusReviewFinding = {
  code: IcarusReviewFindingCode;
  assessmentId: string;
  failureModeId?: string;
  evidenceId?: string;
  controlId?: string;
  recordReference?: IcarusRecordReference;
  message: string;
};

export type IcarusReview = {
  assessmentId: string;
  findings: IcarusReviewFinding[];
};

const evidenceReviews: readonly IcarusEvidenceReview[] = [
  "Unreviewed",
  "Supports",
  "Contradicts",
  "Unresolved",
];
const assessmentStatuses: readonly IcarusAssessmentStatus[] = ["Open", "Monitoring", "Closed"];
const controlLifecycles: readonly IcarusControlLifecycle[] = [
  "Planned",
  "Active",
  "Monitoring",
  "Ineffective",
  "Retired",
];
const controlEffectiveness: readonly IcarusControlEffectiveness[] = [
  "Unknown",
  "Untested",
  "Weak",
  "Evidence supports",
  "Evidence contradicts",
  "Unresolved",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseReviewDeadline(value: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !isValidCalendarDateInput(value)) return Number.NaN;
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T23:59:59.999Z`)
    : Date.parse(value);
}

function isValidIcarusDate(value: string): boolean {
  const calendarDate = value.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/)?.[1];
  return (!calendarDate || isValidCalendarDateInput(calendarDate)) && !Number.isNaN(Date.parse(value));
}

export function getIcarusIdentityKey(assessmentId: string): string {
  return `icarus-assessment:${assessmentId}`;
}

export function getIcarusReferenceKey(reference: IcarusRecordReference): string {
  return `${reference.recordType}:${reference.recordId}`;
}

export function getIcarusTreatmentTargetId(sourceKind: string, sourceId: string): string {
  return `icarus-treatment:${encodeURIComponent(sourceKind)}:${encodeURIComponent(sourceId)}`;
}

export function getIcarusTreatmentOutcomeEvidenceKey(evidence: IcarusTreatmentOutcomeEvidence): string {
  if (evidence.kind === "Control test") {
    return JSON.stringify([
      evidence.kind, evidence.assessmentId, evidence.failureModeId, evidence.controlId, evidence.testId,
      evidence.result, evidence.assuranceStatus, [...evidence.evidenceIds].sort(),
      evidence.evidenceStatus,
    ]);
  }
  if (evidence.kind === "Dependency health") {
    return JSON.stringify([
      evidence.kind, getIcarusReferenceKey(evidence.dependencyReference), evidence.health,
      evidence.source, [...evidence.basis].sort(),
    ]);
  }
  return JSON.stringify([evidence.kind, evidence.assessmentId, evidence.failureModeId, evidence.material]);
}

export function getIcarusTreatmentOutcomeId(
  treatmentTargetId: string,
  verifiedByPersonId: string,
  evidence: readonly IcarusTreatmentOutcomeEvidence[],
): string {
  const evidenceKeys = [...new Set(evidence.map(getIcarusTreatmentOutcomeEvidenceKey))].sort();
  return `icarus-treatment-outcome:${encodeURIComponent(JSON.stringify([
    treatmentTargetId,
    verifiedByPersonId,
    evidenceKeys,
  ]))}`;
}

export function isIcarusRecordReference(value: unknown): value is IcarusRecordReference {
  return isPlainObject(value)
    && ICARUS_SOURCE_TYPES.includes(value.recordType as IcarusSourceType)
    && isNonEmptyString(value.recordId);
}

function isIcarusEvidence(value: unknown): value is IcarusEvidence {
  if (!isPlainObject(value)
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.statement)
    || (value.origin !== "Source record" && value.origin !== "Direct observation")
    || !isNonEmptyString(value.recordedAt)
    || !isNonEmptyString(value.recordedBy)
    || !evidenceReviews.includes(value.review as IcarusEvidenceReview)) {
    return false;
  }
  if (value.origin === "Source record" && !isIcarusRecordReference(value.reference)) return false;
  if (value.origin === "Direct observation"
    && (value.reference !== undefined || !isNonEmptyString(value.observedAt))) return false;
  if (value.reference !== undefined && !isIcarusRecordReference(value.reference)) return false;
  if (value.observedAt !== undefined && typeof value.observedAt !== "string") return false;
  if (value.validUntil !== undefined && typeof value.validUntil !== "string") return false;
  if (value.review !== "Unreviewed"
    && (!isNonEmptyString(value.reviewedAt) || !isNonEmptyString(value.reviewedBy))) return false;
  if (value.review === "Unreviewed" && (value.reviewedAt !== undefined || value.reviewedBy !== undefined)) return false;
  return true;
}

export function isIcarusAssessmentRecord(value: unknown): value is IcarusAssessmentRecord {
  if (!isPlainObject(value)
    || !isNonEmptyString(value.id)
    || typeof value.outcome !== "string"
    || !assessmentStatuses.includes(value.status as IcarusAssessmentStatus)
    || !isNonEmptyString(value.createdAt)
    || !isNonEmptyString(value.updatedAt)
    || !Array.isArray(value.linkedRecords)
    || !value.linkedRecords.every(isIcarusRecordReference)
    || !Array.isArray(value.failureModes)
    || !value.failureModes.every((mode: unknown) =>
      isPlainObject(mode)
      && isNonEmptyString(mode.id)
      && typeof mode.mechanism === "string"
      && typeof mode.vulnerability === "string"
      && Array.isArray(mode.evidence)
      && mode.evidence.every(isIcarusEvidence))
    || !Array.isArray(value.controls)
    || !value.controls.every((control: unknown) =>
      isPlainObject(control)
      && isNonEmptyString(control.id)
      && isNonEmptyString(control.failureModeId)
      && isNonEmptyString(control.intervention)
      && controlLifecycles.includes(control.lifecycle as IcarusControlLifecycle)
      && controlEffectiveness.includes(control.effectiveness as IcarusControlEffectiveness)
      && (control.effectivenessReviewedAt === undefined || typeof control.effectivenessReviewedAt === "string")
      && (control.effectivenessReviewedBy === undefined || typeof control.effectivenessReviewedBy === "string")
      && (control.effectiveness === "Unknown"
        ? control.effectivenessReviewedAt === undefined && control.effectivenessReviewedBy === undefined
        : isNonEmptyString(control.effectivenessReviewedAt) && isNonEmptyString(control.effectivenessReviewedBy))
      && Array.isArray(control.evidenceIds)
      && control.evidenceIds.every(isNonEmptyString)
      && Array.isArray(control.linkedRecords)
      && control.linkedRecords.every(isIcarusRecordReference)
      && (control.nextReviewAt === undefined || typeof control.nextReviewAt === "string")
      && isOptionalNonEmptyString(control.ownerPersonId)
      && (control.testCadenceDays === undefined || isValidTestCadence(control.testCadenceDays))
      && (control.assuranceTests === undefined
        || (Array.isArray(control.assuranceTests) && control.assuranceTests.every(isIcarusControlTest))))) {
    return false;
  }
  if (!isOptionalNonEmptyString(value.accountableOwnerPersonId)
    || !isOptionalValidDate(value.reviewedAt)
    || !isOptionalNonEmptyString(value.reviewedByPersonId)
    || (value.reviewedAt === undefined) !== (value.reviewedByPersonId === undefined)
    || !isOptionalValidDate(value.nextReviewBy)
    || (value.acceptances !== undefined
      && (!Array.isArray(value.acceptances) || !value.acceptances.every(isIcarusExposureAcceptance)))
    || (value.assuranceActionLinks !== undefined
      && (!Array.isArray(value.assuranceActionLinks) || !value.assuranceActionLinks.every(isIcarusAssuranceActionLink)))
    || (value.treatmentTargets !== undefined
      && (!Array.isArray(value.treatmentTargets) || !value.treatmentTargets.every(isIcarusTreatmentTargetRecord)))
    || (value.treatmentOutcomes !== undefined
      && (!Array.isArray(value.treatmentOutcomes) || !value.treatmentOutcomes.every(isIcarusTreatmentOutcomeRecord)))
    || (value.causes !== undefined
      && (!Array.isArray(value.causes) || !value.causes.every(isIcarusCauseRecord)))
    || (value.interventionDecisions !== undefined
      && (!Array.isArray(value.interventionDecisions) || !value.interventionDecisions.every(isIcarusInterventionDecisionRecord)))) {
    return false;
  }
  return true;
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isOptionalValidDate(value: unknown): boolean {
  return value === undefined || (isNonEmptyString(value) && isValidIcarusDate(value));
}

export const ICARUS_MAX_TEST_CADENCE_DAYS = 3660;

function isValidTestCadence(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= ICARUS_MAX_TEST_CADENCE_DAYS;
}

function isIcarusControlTest(value: unknown): value is IcarusControlTest {
  return isPlainObject(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.testedAt)
    && isValidIcarusDate(value.testedAt)
    && isNonEmptyString(value.testedByPersonId)
    && ICARUS_CONTROL_TEST_RESULTS.includes(value.result as IcarusControlTestResult)
    && Array.isArray(value.evidenceIds)
    && value.evidenceIds.every(isNonEmptyString)
    && (value.note === undefined || typeof value.note === "string");
}

function isIcarusExposureAcceptance(value: unknown): value is IcarusExposureAcceptance {
  return isPlainObject(value)
    && isNonEmptyString(value.id)
    && Array.isArray(value.failureModeIds)
    && value.failureModeIds.length > 0
    && value.failureModeIds.every(isNonEmptyString)
    && isNonEmptyString(value.acceptedByPersonId)
    && typeof value.rationale === "string"
    && isNonEmptyString(value.acceptedAt)
    && isNonEmptyString(value.reviewBy)
    && (value.conditions === undefined || typeof value.conditions === "string")
    && isOptionalValidDate(value.revokedAt);
}

function isIcarusAssuranceActionLink(value: unknown): value is IcarusAssuranceActionLink {
  return isPlainObject(value)
    && isNonEmptyString(value.obligationId)
    && isNonEmptyString(value.actionId)
    && isNonEmptyString(value.linkedAt);
}

function isIcarusTreatmentExecutionLink(value: unknown): value is IcarusTreatmentExecutionLink {
  return isPlainObject(value)
    && (value.recordType === "Action" || value.recordType === "Project")
    && isNonEmptyString(value.recordId)
    && isNonEmptyString(value.linkedAt);
}

function isIcarusTreatmentTargetRecord(value: unknown): value is IcarusTreatmentTargetRecord {
  return isPlainObject(value)
    && isNonEmptyString(value.id)
    && ["Assurance obligation", "Dependency / resilience intervention", "Failure-chain restoration", "Stress discovery"].includes(String(value.sourceKind))
    && isNonEmptyString(value.sourceId)
    && value.id === getIcarusTreatmentTargetId(String(value.sourceKind), value.sourceId)
    && isNonEmptyString(value.assessmentId)
    && isOptionalNonEmptyString(value.failureModeId)
    && isOptionalNonEmptyString(value.controlId)
    && (value.dependencyReference === undefined || isIcarusRecordReference(value.dependencyReference))
    && isNonEmptyString(value.treatmentKind)
    && typeof value.reason === "string"
    && Array.isArray(value.basis)
    && value.basis.every(isNonEmptyString)
    && Array.isArray(value.affectedAssessmentIds)
    && value.affectedAssessmentIds.every(isNonEmptyString)
    && Array.isArray(value.objectiveIds)
    && value.objectiveIds.every(isNonEmptyString)
    && Array.isArray(value.pillarIds)
    && value.pillarIds.every(isNonEmptyString)
    && isPlainObject(value.provenance)
    && ["Assurance obligation", "Dependency / resilience recommendation", "Failure-chain recommendation", "Stress discovery"].includes(String(value.provenance.kind))
    && typeof value.provenance.finding === "string"
    && Array.isArray(value.executionLinks)
    && value.executionLinks.every(isIcarusTreatmentExecutionLink)
    && isNonEmptyString(value.promotedAt)
    && isValidIcarusDate(value.promotedAt);
}

function isIcarusTreatmentOutcomeEvidence(value: unknown): value is IcarusTreatmentOutcomeEvidence {
  if (!isPlainObject(value)) return false;
  if (value.kind === "Control test") {
    return isNonEmptyString(value.assessmentId)
      && isNonEmptyString(value.failureModeId)
      && isNonEmptyString(value.controlId)
      && isNonEmptyString(value.testId)
      && ICARUS_CONTROL_TEST_RESULTS.includes(value.result as IcarusControlTestResult)
      && ["Assured", "Failed", "Test overdue", "Evidence insufficient", "Inconclusive", "Untested", "Not operating"]
        .includes(String(value.assuranceStatus))
      && ["Current support", "No current support", "Conflicting", "Not applicable"].includes(String(value.evidenceStatus))
      && Array.isArray(value.evidenceIds)
      && value.evidenceIds.every(isNonEmptyString);
  }
  if (value.kind === "Dependency health") {
    return isIcarusRecordReference(value.dependencyReference)
      && ["Healthy", "Watch", "Degraded", "Failed", "Unknown", "Not applicable"].includes(String(value.health))
      && (value.source === "Explicit" || value.source === "Derived")
      && Array.isArray(value.basis)
      && value.basis.every(isNonEmptyString);
  }
  return value.kind === "Failure mode materiality"
    && isNonEmptyString(value.assessmentId)
    && isNonEmptyString(value.failureModeId)
    && typeof value.material === "boolean";
}

function isIcarusTreatmentOutcomeStateFact(value: unknown): value is IcarusTreatmentOutcomeStateFact {
  if (!isPlainObject(value)) return false;
  if (value.kind === "Control assurance") {
    return ["Assured", "Failed", "Test overdue", "Evidence insufficient", "Inconclusive", "Untested", "Not operating", "Partially assured"]
      .includes(String(value.state));
  }
  if (value.kind === "Dependency health") {
    return ["Healthy", "Watch", "Degraded", "Failed", "Unknown", "Not applicable"].includes(String(value.state));
  }
  return value.kind === "Failure mode materiality"
    && (value.state === "Material" || value.state === "Not material");
}

function isIcarusTreatmentOutcomeRecord(value: unknown): value is IcarusTreatmentOutcomeRecord {
  if (!isPlainObject(value)
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.treatmentTargetId)
    || !isNonEmptyString(value.assessmentId)
    || !Array.isArray(value.executionLinks)
    || !value.executionLinks.every(isIcarusTreatmentExecutionLink)
    || !["Effective", "Partially effective", "Ineffective", "Inconclusive", "No longer applicable"].includes(String(value.outcome))
    || !isNonEmptyString(value.verifiedAt)
    || !isValidIcarusDate(value.verifiedAt)
    || !isNonEmptyString(value.verifiedByPersonId)
    || !Array.isArray(value.evidence)
    || value.evidence.length === 0
    || !value.evidence.every(isIcarusTreatmentOutcomeEvidence)
    || (value.beforeState !== undefined && !isIcarusTreatmentOutcomeStateFact(value.beforeState))
    || !isIcarusTreatmentOutcomeStateFact(value.afterState)
    || !isNonEmptyString(value.verificationNote)) {
    return false;
  }
  return value.id === getIcarusTreatmentOutcomeId(
    value.treatmentTargetId,
    value.verifiedByPersonId,
    value.evidence,
  );
}

function filterUniqueById<T>(entries: readonly T[], idOf: (entry: T) => string): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const id = idOf(entry);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isInterventionScope(value: Record<string, unknown>): boolean {
  return isStringList(value.assessmentIds) && isStringList(value.objectiveIds) && isStringList(value.pillarIds)
    && Array.isArray(value.dependencyReferences) && value.dependencyReferences.every(isIcarusRecordReference)
    && Array.isArray(value.failureModes) && value.failureModes.every((entry: unknown) =>
      isPlainObject(entry) && isNonEmptyString(entry.assessmentId) && isNonEmptyString(entry.failureModeId));
}

function isInterventionProvenance(value: Record<string, unknown>): boolean {
  return isNonEmptyString(value.createdAt) && isValidIcarusDate(value.createdAt)
    && isNonEmptyString(value.updatedAt) && isValidIcarusDate(value.updatedAt)
    && isNonEmptyString(value.createdByPersonId) && isNonEmptyString(value.updatedByPersonId);
}

function isRecordedInterventionEntry(value: Record<string, unknown>): boolean {
  return isNonEmptyString(value.id) && isNonEmptyString(value.rationale)
    && isNonEmptyString(value.recordedAt) && isValidIcarusDate(value.recordedAt)
    && isNonEmptyString(value.recordedByPersonId);
}

export function isIcarusCauseRecord(value: unknown): value is IcarusCauseRecord {
  return isPlainObject(value) && isNonEmptyString(value.id) && isNonEmptyString(value.title)
    && typeof value.description === "string" && isInterventionScope(value) && isInterventionProvenance(value);
}

function isInterventionOption(value: unknown): value is IcarusInterventionOption {
  return isPlainObject(value) && isNonEmptyString(value.id) && isNonEmptyString(value.name)
    && typeof value.description === "string" && typeof value.rationale === "string"
    && isStringList(value.causeIds) && isStringList(value.priorOptionIds) && isInterventionScope(value)
    && (value.intent === undefined || ICARUS_INTERVENTION_INTENTS.some((entry) => entry === value.intent))
    && (value.scope === undefined || ICARUS_INTERVENTION_SCOPES.some((entry) => entry === value.scope))
    && (value.character === undefined || ICARUS_INTERVENTION_CHARACTERS.some((entry) => entry === value.character))
    && ["Candidate", "Rejected", "Superseded"].some((status) => status === value.status)
    && Array.isArray(value.treatmentLinks) && value.treatmentLinks.every((link: unknown) =>
      isPlainObject(link) && isNonEmptyString(link.targetId) && isNonEmptyString(link.linkedByPersonId)
      && isNonEmptyString(link.linkedAt) && isValidIcarusDate(link.linkedAt));
}

function isInterventionEffect(value: unknown): value is IcarusInterventionEffect {
  if (!isPlainObject(value) || !isRecordedInterventionEntry(value) || !isNonEmptyString(value.optionId)
    || !ICARUS_INTERVENTION_EFFECTS.some((entry) => entry === value.direction)
    || !isPlainObject(value.target) || !Array.isArray(value.evidence)) return false;
  const target = value.target;
  return (target.kind === "Dependency" ? isIcarusRecordReference(target.reference)
    : ["Cause", "Assessment", "Strategic Objective", "Pillar"].some((kind) => kind === target.kind) && isNonEmptyString(target.id))
    && value.evidence.every((entry: unknown) => isPlainObject(entry)
      && isNonEmptyString(entry.assessmentId) && isNonEmptyString(entry.failureModeId) && isNonEmptyString(entry.evidenceId));
}

export function isIcarusInterventionDecisionRecord(value: unknown): value is IcarusInterventionDecisionRecord {
  return isPlainObject(value) && isNonEmptyString(value.id) && isNonEmptyString(value.title)
    && typeof value.rationale === "string" && isStringList(value.causeIds)
    && isInterventionScope(value) && isInterventionProvenance(value)
    && isOptionalNonEmptyString(value.decisionRecordId) && isOptionalNonEmptyString(value.selectedOptionId)
    && isOptionalValidDate(value.nextReviewBy) && ["Draft", "Recorded", "Superseded"].some((status) => status === value.status)
    && Array.isArray(value.options) && value.options.every(isInterventionOption)
    && Array.isArray(value.selectionHistory) && value.selectionHistory.every((entry: unknown) =>
      isPlainObject(entry) && isNonEmptyString(entry.id) && isNonEmptyString(entry.optionId)
      && isNonEmptyString(entry.rationale) && isNonEmptyString(entry.selectedByPersonId)
      && isNonEmptyString(entry.selectedAt) && isValidIcarusDate(entry.selectedAt))
    && Array.isArray(value.relationships) && value.relationships.every((entry: unknown) =>
      isPlainObject(entry) && isRecordedInterventionEntry(entry)
      && isNonEmptyString(entry.fromOptionId) && isNonEmptyString(entry.toOptionId)
      && ICARUS_INTERVENTION_RELATIONSHIPS.some((kind) => kind === entry.kind))
    && Array.isArray(value.effects) && value.effects.every(isInterventionEffect)
    && Array.isArray(value.lessonLinks) && value.lessonLinks.every((link: unknown) =>
      isPlainObject(link) && isNonEmptyString(link.id) && isNonEmptyString(link.lessonId)
      && isStringList(link.outcomeIds) && link.outcomeIds.length > 0 && isStringList(link.causeIds)
      && isNonEmptyString(link.rationale) && isNonEmptyString(link.linkedByPersonId)
      && isNonEmptyString(link.linkedAt) && isValidIcarusDate(link.linkedAt));
}

// Recovers optional assurance and treatment fields: malformed optional entries are dropped so one bad value cannot
// make all Icarus data unreadable. Core Icarus fields stay strictly validated by assertIcarusDataStructure.
// Legacy records without these optional fields remain unchanged.
export function normaliseIcarusAssessmentData(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((assessment: unknown) => {
    if (!isPlainObject(assessment)) return assessment;
    const next: Record<string, unknown> = { ...assessment };
    if ("causes" in next) {
      if (!Array.isArray(next.causes)) delete next.causes;
      else next.causes = filterUniqueById(next.causes.filter(isIcarusCauseRecord), (cause) => cause.id);
    }
    if ("interventionDecisions" in next) {
      if (!Array.isArray(next.interventionDecisions)) delete next.interventionDecisions;
      else next.interventionDecisions = filterUniqueById(
        next.interventionDecisions.filter(isIcarusInterventionDecisionRecord), (decision) => decision.id,
      );
    }
    const modeEvidenceIds = new Map<string, Set<string>>();
    if (Array.isArray(next.failureModes)) {
      next.failureModes.forEach((mode: unknown) => {
        if (!isPlainObject(mode) || !isNonEmptyString(mode.id) || !Array.isArray(mode.evidence)) return;
        modeEvidenceIds.set(mode.id, new Set(mode.evidence
          .map((evidence: unknown) => (isPlainObject(evidence) ? evidence.id : undefined))
          .filter(isNonEmptyString)));
      });
    }
    const dropIfInvalid = (key: string, valid: (candidate: unknown) => boolean) => {
      if (key in next && !valid(next[key])) delete next[key];
    };
    dropIfInvalid("accountableOwnerPersonId", isNonEmptyString);
    dropIfInvalid("nextReviewBy", (candidate) => isNonEmptyString(candidate) && isValidIcarusDate(candidate));
    dropIfInvalid("reviewedAt", (candidate) => isNonEmptyString(candidate) && isValidIcarusDate(candidate));
    dropIfInvalid("reviewedByPersonId", isNonEmptyString);
    if (("reviewedAt" in next) !== ("reviewedByPersonId" in next)) {
      delete next.reviewedAt;
      delete next.reviewedByPersonId;
    }
    if ("acceptances" in next) {
      if (!Array.isArray(next.acceptances)) delete next.acceptances;
      else {
        const acceptances = next.acceptances
          .map((acceptance: unknown) => {
            if (!isPlainObject(acceptance) || !Array.isArray(acceptance.failureModeIds)) return acceptance;
            const failureModeIds = [...new Set(acceptance.failureModeIds
              .filter((id: unknown): id is string => isNonEmptyString(id) && modeEvidenceIds.has(id)))];
            const normalised: Record<string, unknown> = { ...acceptance, failureModeIds };
            if ("revokedAt" in normalised && !isOptionalValidDate(normalised.revokedAt)) delete normalised.revokedAt;
            if ("conditions" in normalised && typeof normalised.conditions !== "string") delete normalised.conditions;
            return normalised;
          })
          .filter(isIcarusExposureAcceptance);
        next.acceptances = filterUniqueById(acceptances, (acceptance) => acceptance.id);
      }
    }
    if ("treatmentTargets" in next) {
      if (!Array.isArray(next.treatmentTargets)) delete next.treatmentTargets;
      else {
        next.treatmentTargets = filterUniqueById(
          next.treatmentTargets.filter(isIcarusTreatmentTargetRecord),
          (target) => target.id,
        );
      }
    }
    if ("treatmentOutcomes" in next) {
      if (!Array.isArray(next.treatmentOutcomes)) delete next.treatmentOutcomes;
      else {
        next.treatmentOutcomes = filterUniqueById(
          next.treatmentOutcomes.filter(isIcarusTreatmentOutcomeRecord),
          (outcome) => outcome.id,
        );
      }
    }
    if ("assuranceActionLinks" in next) {
      if (!Array.isArray(next.assuranceActionLinks)) delete next.assuranceActionLinks;
      else {
        next.assuranceActionLinks = filterUniqueById(
          next.assuranceActionLinks.filter(isIcarusAssuranceActionLink),
          (link) => `${link.obligationId}|${link.actionId}`,
        );
      }
    }
    if (Array.isArray(next.controls)) {
      next.controls = next.controls.map((control: unknown) => {
        if (!isPlainObject(control)) return control;
        const nextControl: Record<string, unknown> = { ...control };
        if ("ownerPersonId" in nextControl && !isNonEmptyString(nextControl.ownerPersonId)) delete nextControl.ownerPersonId;
        if ("testCadenceDays" in nextControl && !isValidTestCadence(nextControl.testCadenceDays)) delete nextControl.testCadenceDays;
        if ("assuranceTests" in nextControl) {
          if (!Array.isArray(nextControl.assuranceTests)) delete nextControl.assuranceTests;
          else {
            const allowedEvidence = isNonEmptyString(nextControl.failureModeId)
              ? modeEvidenceIds.get(nextControl.failureModeId) ?? new Set<string>()
              : new Set<string>();
            const tests = nextControl.assuranceTests
              .map((test: unknown) => {
                if (!isPlainObject(test) || !Array.isArray(test.evidenceIds)) return test;
                const normalised: Record<string, unknown> = {
                  ...test,
                  evidenceIds: [...new Set(test.evidenceIds.filter((id: unknown): id is string =>
                    isNonEmptyString(id) && allowedEvidence.has(id)))],
                };
                if ("note" in normalised && typeof normalised.note !== "string") delete normalised.note;
                return normalised;
              })
              .filter(isIcarusControlTest);
            nextControl.assuranceTests = filterUniqueById(tests, (test) => test.id);
          }
        }
        return nextControl;
      });
    }
    return next;
  });
}

function assertUniqueIds(ids: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Icarus contains a duplicate ${label} ID: ${id}.`);
    seen.add(id);
  }
}

export function assertIcarusDataStructure(value: unknown): asserts value is IcarusAssessmentRecord[] {
  if (!Array.isArray(value) || !value.every(isIcarusAssessmentRecord)) {
    throw new Error("Icarus data must be an array of valid assessment records.");
  }

  assertUniqueIds(value.map((assessment) => assessment.id), "assessment");
  const failureModeIds: string[] = [];
  const evidenceIds: string[] = [];
  const controlIds: string[] = [];

  for (const assessment of value) {
    const modes = new Map(assessment.failureModes.map((mode) => [mode.id, mode] as const));
    for (const mode of assessment.failureModes) {
      failureModeIds.push(mode.id);
      evidenceIds.push(...mode.evidence.map((evidence) => evidence.id));
    }
    for (const control of assessment.controls) {
      controlIds.push(control.id);
      if (!modes.has(control.failureModeId)) {
        throw new Error(`Icarus control ${control.id} references missing failure mode ${control.failureModeId}.`);
      }
      const modeEvidenceIds = new Set(modes.get(control.failureModeId)!.evidence.map((evidence) => evidence.id));
      if (control.evidenceIds.some((id) => !modeEvidenceIds.has(id))) {
        throw new Error(`Icarus control ${control.id} references evidence outside its failure mode.`);
      }
      assertUniqueIds(control.evidenceIds, `control evidence for ${control.id}`);
      (control.assuranceTests ?? []).forEach((test) => {
        if (test.evidenceIds.some((id) => !modeEvidenceIds.has(id))) {
          throw new Error(`Icarus control test ${test.id} references evidence outside its failure mode.`);
        }
      });
      assertUniqueIds((control.assuranceTests ?? []).map((test) => test.id), `test for control ${control.id}`);
      assertUniqueIds(control.linkedRecords.map(getIcarusReferenceKey), `linked record for control ${control.id}`);
    }
    assertUniqueIds(assessment.linkedRecords.map(getIcarusReferenceKey), `linked record for assessment ${assessment.id}`);
    (assessment.acceptances ?? []).forEach((acceptance) => {
      if (acceptance.failureModeIds.some((id) => !modes.has(id))) {
        throw new Error(`Icarus acceptance ${acceptance.id} references a missing failure mode.`);
      }
    });
    assertUniqueIds((assessment.acceptances ?? []).map((acceptance) => acceptance.id), `acceptance for assessment ${assessment.id}`);
    assertUniqueIds((assessment.treatmentOutcomes ?? []).map((outcome) => outcome.id), `treatment outcome for assessment ${assessment.id}`);
    (assessment.treatmentOutcomes ?? []).forEach((outcome) => {
      if (outcome.assessmentId !== assessment.id) {
        throw new Error(`Icarus treatment outcome ${outcome.id} belongs to a different assessment.`);
      }
    });
  }

  assertUniqueIds(failureModeIds, "failure mode");
  assertUniqueIds(evidenceIds, "evidence");
  assertUniqueIds(controlIds, "control");
}

export function parseIcarusAssessments(storedValue: string | null): IcarusAssessmentRecord[] {
  const parsed: unknown = normaliseIcarusAssessmentData(storedValue === null ? [] : JSON.parse(storedValue));
  assertIcarusDataStructure(parsed);
  return parsed;
}

export function classifyIcarusEvidenceFreshness(
  evidence: Pick<IcarusEvidence, "recordedAt" | "observedAt" | "validUntil" | "reviewedAt">,
  nowMs = Date.now(),
): IcarusEvidenceFreshness {
  const dates = [evidence.recordedAt, evidence.observedAt, evidence.validUntil, evidence.reviewedAt].filter(
    (date): date is string => date !== undefined,
  );
  if (dates.some((date) => !isValidIcarusDate(date))) return "Invalid";
  if (evidence.validUntil === undefined) return "Not time-bounded";
  return parseReviewDeadline(evidence.validUntil) < nowMs ? "Stale" : "Current";
}

export type IcarusControlAssuranceEvent = {
  source: "Control test" | "Effectiveness review";
  testId?: string;
  at: string;
  result: IcarusControlTestResult;
  evidenceIds: string[];
  byPersonId?: string;
  by?: string;
};

const effectivenessReviewResult: Partial<Record<IcarusControlEffectiveness, IcarusControlTestResult>> = {
  "Evidence supports": "Passed",
  "Weak": "Failed",
  "Evidence contradicts": "Failed",
  "Unresolved": "Inconclusive",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function eventTime(value: string): number {
  return isValidIcarusDate(value) ? parseReviewDeadline(value) : Number.NEGATIVE_INFINITY;
}

// Every dated judgement about whether a control works, newest first. A legacy effectiveness review is an
// assurance event (it is a named, dated human assessment); "Unknown"/"Untested" effectiveness is not.
// Ties prefer an explicit control test over an effectiveness review.
export function getIcarusControlAssuranceEvents(control: IcarusControl): IcarusControlAssuranceEvent[] {
  const events: IcarusControlAssuranceEvent[] = (control.assuranceTests ?? []).map((test) => ({
    source: "Control test",
    testId: test.id,
    at: test.testedAt,
    result: test.result,
    evidenceIds: [...test.evidenceIds],
    byPersonId: test.testedByPersonId,
  }));
  const reviewResult = effectivenessReviewResult[control.effectiveness];
  if (reviewResult && control.effectivenessReviewedAt) {
    events.push({
      source: "Effectiveness review",
      at: control.effectivenessReviewedAt,
      result: reviewResult,
      evidenceIds: [...control.evidenceIds],
      ...(control.effectivenessReviewedBy ? { by: control.effectivenessReviewedBy } : {}),
    });
  }
  return events.sort((left, right) =>
    eventTime(right.at) - eventTime(left.at)
    || (left.source === right.source ? 0 : left.source === "Control test" ? -1 : 1)
    || (right.testId ?? "").localeCompare(left.testId ?? ""));
}

export function getIcarusLatestControlAssuranceEvent(control: IcarusControl): IcarusControlAssuranceEvent | undefined {
  return getIcarusControlAssuranceEvents(control)[0];
}

// When the control's next test falls due under its cadence (undefined without a cadence or a dated event).
export function getIcarusControlTestDueAt(control: IcarusControl): number | undefined {
  if (!control.testCadenceDays) return undefined;
  const latest = getIcarusLatestControlAssuranceEvent(control);
  if (!latest || !isValidIcarusDate(latest.at)) return undefined;
  return parseReviewDeadline(latest.at) + control.testCadenceDays * DAY_MS;
}

export function buildIcarusReview(
  assessments: readonly IcarusAssessmentRecord[],
  sourceRecords: readonly IcarusSourceRecord[],
  nowMs = Date.now(),
): IcarusReview[] {
  const sourceKeys = new Set(sourceRecords.map(getIcarusReferenceKey));

  return assessments.map((assessment) => {
    const findings: IcarusReviewFinding[] = [];
    const addFinding = (
      code: IcarusReviewFindingCode,
      details: Omit<IcarusReviewFinding, "code" | "assessmentId" | "message">,
      message: string,
    ) => findings.push({ code, assessmentId: assessment.id, ...details, message });

    if (!assessment.outcome.trim()) {
      addFinding("missing-outcome", {}, "The failure outcome has not been stated.");
    }
    if (assessment.failureModes.length === 0) {
      addFinding("no-failure-modes", {}, "No failure mechanism has been recorded for this outcome.");
    }
    assessment.failureModes.forEach((mode) => {
      if (!mode.mechanism.trim() || !mode.vulnerability.trim()) {
        addFinding("incomplete-failure-mode", { failureModeId: mode.id }, "The failure mechanism or current vulnerability is incomplete.");
      }
      const usableEvidence: IcarusEvidence[] = [];
      mode.evidence.forEach((evidence) => {
        const freshness = classifyIcarusEvidenceFreshness(evidence, nowMs);
        if (freshness === "Invalid") {
          addFinding("invalid-evidence", { failureModeId: mode.id, evidenceId: evidence.id }, "Evidence has an invalid date and cannot support a current conclusion.");
        } else if (freshness === "Stale") {
          addFinding("stale-evidence", { failureModeId: mode.id, evidenceId: evidence.id }, "Evidence has passed its recorded validity date and needs review.");
        } else if (evidence.reference && !sourceKeys.has(getIcarusReferenceKey(evidence.reference))) {
          addFinding(
            "missing-source",
            { failureModeId: mode.id, evidenceId: evidence.id, recordReference: evidence.reference },
            `Evidence points to a missing ${evidence.reference.recordType} record ${evidence.reference.recordId}.`,
          );
        } else {
          usableEvidence.push(evidence);
          if (evidence.review === "Unreviewed") {
            addFinding("unreviewed-evidence", { failureModeId: mode.id, evidenceId: evidence.id }, "Evidence has not been reviewed by a named person.");
          } else if (evidence.review === "Unresolved") {
            addFinding("unresolved-evidence", { failureModeId: mode.id, evidenceId: evidence.id }, "Evidence has been reviewed but remains unresolved.");
          }
        }
      });

      const reviewedEvidence = usableEvidence.filter((evidence) =>
        evidence.review === "Supports" || evidence.review === "Contradicts");
      if (reviewedEvidence.length === 0) {
        addFinding("no-evidence", { failureModeId: mode.id }, "No current, reviewed evidence supports or challenges this failure mechanism.");
      }
      if (reviewedEvidence.some((evidence) => evidence.review === "Supports")
        && reviewedEvidence.some((evidence) => evidence.review === "Contradicts")) {
        addFinding("conflicting-evidence", { failureModeId: mode.id }, "Current evidence both supports and contradicts this failure mechanism.");
      }

      const controls = assessment.controls.filter((control) => control.failureModeId === mode.id);
      const operatingControls = controls.filter((control) =>
        control.lifecycle === "Active" || control.lifecycle === "Monitoring");
      if (controls.length === 0 || (controls.length > 0 && operatingControls.length === 0
        && controls.every((control) => control.lifecycle === "Retired"))) {
        addFinding("missing-control", { failureModeId: mode.id }, "No operating control or intervention is linked to this failure mechanism.");
      }
      controls.forEach((control) => {
        control.linkedRecords.forEach((reference) => {
          if (!sourceKeys.has(getIcarusReferenceKey(reference))) {
            addFinding("missing-source", {
              failureModeId: mode.id,
              controlId: control.id,
              recordReference: reference,
            }, `Control link to ${reference.recordType} ${reference.recordId} is unresolved.`);
          }
        });
        if (control.effectivenessReviewedAt !== undefined && !isValidIcarusDate(control.effectivenessReviewedAt)) {
          addFinding("invalid-control-assessment", { failureModeId: mode.id, controlId: control.id }, "The control effectiveness assessment date is invalid.");
        }
        if (control.lifecycle === "Active" || control.lifecycle === "Monitoring") {
          if (control.nextReviewAt === undefined) {
            addFinding("missing-control-review", { failureModeId: mode.id, controlId: control.id }, "No next review is recorded for this operating control.");
          } else {
            const reviewDeadline = parseReviewDeadline(control.nextReviewAt);
            if (Number.isNaN(reviewDeadline)) {
              addFinding("invalid-control-review", { failureModeId: mode.id, controlId: control.id }, "The control review date is invalid.");
            } else if (reviewDeadline < nowMs) {
              addFinding("stale-control-review", { failureModeId: mode.id, controlId: control.id }, "The control review date has passed.");
            }
          }
        }
        const controlEvidence = usableEvidence.filter((evidence) => control.evidenceIds.includes(evidence.id));
        const hasSupportingEvidence = controlEvidence.some((evidence) => evidence.review === "Supports");
        const hasContradictingEvidence = controlEvidence.some((evidence) => evidence.review === "Contradicts");
        const latestEvent = getIcarusLatestControlAssuranceEvent(control);
        const operating = control.lifecycle === "Active" || control.lifecycle === "Monitoring";
        const testDueAt = operating ? getIcarusControlTestDueAt(control) : undefined;
        if (testDueAt !== undefined && testDueAt < nowMs) {
          addFinding("overdue-control-test", { failureModeId: mode.id, controlId: control.id }, `This control's ${control.testCadenceDays}-day test cadence has lapsed since its last assurance event.`);
        }
        if (latestEvent?.source === "Control test") {
          // The most recent explicit test supersedes the earlier effectiveness assessment for this control.
          const testEvidence = usableEvidence.filter((evidence) => latestEvent.evidenceIds.includes(evidence.id));
          const testSupports = testEvidence.some((evidence) => evidence.review === "Supports");
          const testContradicts = testEvidence.some((evidence) => evidence.review === "Contradicts");
          if (control.lifecycle === "Ineffective") {
            addFinding("ineffective-control", { failureModeId: mode.id, controlId: control.id }, "This control is recorded as ineffective.");
          } else if (latestEvent.result === "Failed") {
            addFinding("failed-control-test", { failureModeId: mode.id, controlId: control.id }, "The most recent test of this control failed.");
          } else if (control.lifecycle === "Planned") {
            addFinding("planned-control", { failureModeId: mode.id, controlId: control.id }, "This control is planned but is not recorded as operating.");
          } else if (control.lifecycle !== "Retired" && latestEvent.result === "Inconclusive") {
            addFinding("inconclusive-control-test", { failureModeId: mode.id, controlId: control.id }, "The most recent test of this control was inconclusive.");
          } else if (control.lifecycle !== "Retired" && latestEvent.result === "Passed" && !testSupports) {
            addFinding("unsupported-control-test", { failureModeId: mode.id, controlId: control.id }, "The most recent test passed but cites no current, reviewed supporting evidence.");
          }
          if ((hasSupportingEvidence || testSupports) && (hasContradictingEvidence || testContradicts)) {
            addFinding("conflicting-evidence", { failureModeId: mode.id, controlId: control.id }, "Evidence linked to this control both supports and contradicts its effectiveness.");
          }
          return;
        }
        if (control.lifecycle === "Ineffective") {
          addFinding("ineffective-control", { failureModeId: mode.id, controlId: control.id }, "This control is recorded as ineffective.");
        } else if (control.effectiveness === "Weak") {
          addFinding("weak-control", { failureModeId: mode.id, controlId: control.id }, "This control is explicitly assessed as weak and needs review or strengthening.");
        } else if (control.lifecycle === "Planned") {
          addFinding("planned-control", { failureModeId: mode.id, controlId: control.id }, "This control is planned but is not recorded as operating.");
        } else if (control.lifecycle !== "Retired"
          && (control.effectiveness === "Unknown" || control.effectiveness === "Untested" || control.effectiveness === "Unresolved")) {
          addFinding("untested-control", { failureModeId: mode.id, controlId: control.id }, "This operating control has no resolved effectiveness assessment.");
        }

        if (control.effectiveness === "Evidence contradicts" && hasContradictingEvidence) {
          addFinding("contradicted-control", { failureModeId: mode.id, controlId: control.id }, "Current linked evidence contradicts this control's effectiveness.");
        } else if (control.effectiveness === "Evidence contradicts" && !hasContradictingEvidence) {
          addFinding("untested-control", { failureModeId: mode.id, controlId: control.id }, "Control effectiveness is marked as contradicted but has no current, reviewed contradicting evidence linked to it.");
        }
        if (control.effectiveness === "Evidence supports" && !hasSupportingEvidence) {
          addFinding("untested-control", { failureModeId: mode.id, controlId: control.id }, "Control effectiveness is marked as supported but has no current, reviewed supporting evidence linked to it.");
        }
        if (hasSupportingEvidence && hasContradictingEvidence) {
          addFinding("conflicting-evidence", { failureModeId: mode.id, controlId: control.id }, "Evidence linked to this control both supports and contradicts its effectiveness.");
        }
      });

    });

    assessment.linkedRecords.forEach((reference) => {
      if (!sourceKeys.has(getIcarusReferenceKey(reference))) {
        addFinding("missing-source", { recordReference: reference }, `Assessment link to ${reference.recordType} ${reference.recordId} is unresolved.`);
      }
    });

    return { assessmentId: assessment.id, findings };
  });
}
