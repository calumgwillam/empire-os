import { normaliseIcarusLessonLearning, type IcarusLessonLearning } from "./icarus-learning";
import type { IcarusObservationActionLink, IcarusObservationHandoff } from "./icarus-observation-action";

export const reviewOutcomes = [
  "Keep as Capture",
  "Convert to Problem",
  "Convert to Opportunity",
  "Convert to Action",
  "Convert to Decision",
  "Convert to Lesson",
  "Convert to Project",
  "Convert to System",
  "Convert to SOP",
  "Close",
] as const;

export type ReviewOutcome = (typeof reviewOutcomes)[number];

export type CaptureConversionRecord = {
  id: string;
  sourceCaptureId: string;
  targetType: ReviewOutcome;
  createdAt: string;
  title: string;
  originalRawNote: string;
  relatedArea: string;
  importance: string;
  status: string;
  problemStatement?: string;
  severity?: string;
  frequency?: string;
  impact?: string;
  rootCauseStatus?: string;
  rootCause?: string;
  owner?: string;
  resolution?: string;
  problemStatus?: string;
  actionTitle?: string;
  actionDescription?: string;
  createdBy?: string;
  createdDate?: string;
  dueDate?: string;
  priority?: string;
  relatedProblem?: string;
  relatedDecision?: string;
  relatedLeadId?: string;
  deliveryLeadId?: string;
  // Exact Lesson ID intentionally designated for this Action to implement its required change.
  // Optional: one Lesson may have many Actions; each Action implements at most one Lesson.
  implementsLessonId?: string;
  relatedOpportunity?: string;
  relatedCapture?: string;
  relatedPillar?: string;
  completionEvidence?: string;
  completionDate?: string;
  icarusObservationLinks?: IcarusObservationActionLink[];
  icarusObservationHandoffs?: IcarusObservationHandoff[];
  releaseSourceType?: "Action" | "Project" | "Lead" | "Problem";
  releaseSourceId?: string;
  releaseIntent?: "Prepare to Delegate" | "Unblock First";
  decisionTitle?: string;
  decisionStatement?: string;
  decisionMaker?: string;
  decisionDate?: string;
  context?: string;
  reasoning?: string;
  evidenceConsidered?: string;
  alternativesConsidered?: string;
  assumptions?: string;
  expectedOutcome?: string;
  riskLevel?: string;
  reviewDate?: string;
  actualOutcome?: string;
  outcomeRating?: string;
  lessons?: string;
  decisionStatus?: string;
  opportunityTitle?: string;
  source?: string;
  dateIdentified?: string;
  strategicFit?: string;
  estimatedUpside?: string;
  requiredCapital?: string;
  requiredTime?: string;
  requiredCapability?: string;
  risks?: string;
  opportunityCost?: string;
  evidence?: string;
  decision?: string;
  outcome?: string;
  opportunityStatus?: string;
  opportunityDescription?: string;
  lessonTitle?: string;
  lessonDescription?: string;
  sourceEvent?: string;
  dateLearned?: string;
  whyItMatters?: string;
  recommendedChange?: string;
  relatedProject?: string;
  relatedSystem?: string;
  lessonStatus?: string;
  icarusLearning?: IcarusLessonLearning;
  systemName?: string;
  purpose?: string;
  area?: string;
  inputs?: string;
  process?: string;
  outputs?: string;
  standards?: string;
  failurePoints?: string;
  version?: string;
  lastReviewed?: string;
  systemStatus?: string;
  relatedLesson?: string;
  sopTitle?: string;
  sopPurpose?: string;
  applicableRoles?: string;
  procedure?: string;
  requiredTools?: string;
  safetyConsiderations?: string;
  qualityStandard?: string;
  effectiveDate?: string;
  sopStatus?: string;
};

export const problemSeverityOptions = ["Low", "Medium", "High", "Critical"] as const;
export const problemFrequencyOptions = ["One-off", "Occasional", "Recurring", "Persistent"] as const;
export const problemRootCauseStatusOptions = ["Not investigated", "Investigating", "Identified"] as const;
export const problemStatusOptions = ["Open", "Investigating", "Action required", "Resolved", "Closed"] as const;

export type ProblemSeverity = (typeof problemSeverityOptions)[number];
export type ProblemFrequency = (typeof problemFrequencyOptions)[number];
export type RootCauseStatus = (typeof problemRootCauseStatusOptions)[number];
export type ProblemStatus = (typeof problemStatusOptions)[number];

export type ProblemRecord = CaptureConversionRecord & {
  problemStatement: string;
  severity: ProblemSeverity;
  frequency: ProblemFrequency;
  impact: string;
  rootCauseStatus: RootCauseStatus;
  rootCause: string;
  owner: string;
  resolution: string;
  problemStatus: ProblemStatus;
};

export const actionPriorityOptions = ["Low", "Medium", "High", "Critical"] as const;
export const actionStatusOptions = ["Open", "In Progress", "Blocked", "Waiting", "Completed", "Cancelled"] as const;

export type ActionPriority = (typeof actionPriorityOptions)[number];
export type ActionStatus = (typeof actionStatusOptions)[number];
export const actionReviewOutcomeOptions = ["Continue", "Waiting on external dependency", "Blocked", "Reassign", "Complete", "Cancel"] as const;
export type ActionReviewOutcome = (typeof actionReviewOutcomeOptions)[number];

export type ActionResponsibilityOutcomeEvidence = {
  id: string;
  responsibilityId: string;
  requirementId: string;
  personId: string;
  contribution: "owner" | "lead" | "executor" | "contributor" | "support" | "reviewer";
  outcomeId: string;
  outcome: "successful" | "mixed" | "unsuccessful" | "unassessed";
  observedResult: string;
  evidenceStatus: "unreviewed" | "validated" | "unresolved";
  reviewedByPersonId?: string;
  reviewedAt?: string;
};

export type ActionRecord = CaptureConversionRecord & {
  actionTitle: string;
  description: string;
  owner: string;
  ownerPersonId?: string;
  createdBy: string;
  createdDate: string;
  dueDate: string;
  earliestExecutableDate?: string;
  priority: ActionPriority;
  status: ActionStatus;
  relatedProblem: string;
  relatedDecision: string;
  relatedCapture: string;
  relatedPillar: string;
  completionEvidence: string;
  completionDate: string;
  responsibilityOutcomeEvidence?: ActionResponsibilityOutcomeEvidence[];
  followUpDate?: string;
  followUpOwner?: string;
  followUpOwnerPersonId?: string;
  followUpNote?: string;
  lastReviewedDate?: string;
  reviewOutcome?: ActionReviewOutcome;
  releaseSourceType?: "Action" | "Project" | "Lead" | "Problem";
  releaseSourceId?: string;
  releaseIntent?: "Prepare to Delegate" | "Unblock First";
};

export const decisionRiskOptions = ["Low", "Medium", "High", "Critical"] as const;
export const decisionStatusOptions = ["Draft", "Active", "Under Review", "Completed", "Reversed"] as const;
export const decisionOutcomeRatingOptions = ["", "Worked", "Partially worked", "Failed"] as const;

export type DecisionRiskLevel = (typeof decisionRiskOptions)[number];
export type DecisionStatus = (typeof decisionStatusOptions)[number];

export type DecisionRecord = CaptureConversionRecord & {
  decisionTitle: string;
  decisionStatement: string;
  decisionMaker: string;
  decisionDate: string;
  context: string;
  reasoning: string;
  evidenceConsidered: string;
  alternativesConsidered: string;
  assumptions: string;
  expectedOutcome: string;
  riskLevel: DecisionRiskLevel;
  reviewDate: string;
  actualOutcome: string;
  outcomeRating: string;
  lessons: string;
  decisionStatus: DecisionStatus;
  relatedOpportunity: string;
};

export const opportunityStrategicFitOptions = ["Low", "Medium", "High", "Exceptional"] as const;
export const opportunityStatusOptions = ["New", "Evaluating", "On Hold", "Approved", "Rejected", "Completed"] as const;

export type OpportunityStrategicFit = (typeof opportunityStrategicFitOptions)[number];
export type OpportunityStatus = (typeof opportunityStatusOptions)[number];

export type OpportunityRecord = CaptureConversionRecord & {
  opportunityTitle: string;
  description: string;
  source: string;
  dateIdentified: string;
  relatedPillar: string;
  strategicFit: OpportunityStrategicFit;
  estimatedUpside: string;
  requiredCapital: string;
  requiredTime: string;
  requiredCapability: string;
  risks: string;
  opportunityCost: string;
  evidence: string;
  owner: string;
  status: OpportunityStatus;
  decision: string;
  outcome: string;
};

export const lessonStatusOptions = ["New", "Reviewed", "Change Required", "Implemented", "Archived"] as const;

export type LessonStatus = (typeof lessonStatusOptions)[number];

export type LessonRecord = CaptureConversionRecord & {
  lessonTitle: string;
  description: string;
  sourceEvent: string;
  dateLearned: string;
  relatedPillar: string;
  whyItMatters: string;
  recommendedChange: string;
  relatedProblem: string;
  relatedProject: string;
  relatedDecision: string;
  relatedSystem: string;
  owner: string;
  status: LessonStatus;
};

export const systemStatusOptions = ["Draft", "Active", "Reviewing", "Deprecated"] as const;
export type SystemStatus = (typeof systemStatusOptions)[number];

export type SystemRecord = CaptureConversionRecord & {
  systemName: string;
  purpose: string;
  owner: string;
  area: string;
  inputs: string;
  process: string;
  outputs: string;
  standards: string;
  failurePoints: string;
  version: string;
  lastReviewed: string;
  status: SystemStatus;
  relatedLesson: string;
};

export const sopStatusOptions = ["Draft", "Active", "Reviewing", "Deprecated", "Archived"] as const;
export type SopStatus = (typeof sopStatusOptions)[number];

export type SopRecord = CaptureConversionRecord & {
  sopTitle: string;
  purpose: string;
  owner: string;
  relatedSystem: string;
  applicableRoles: string;
  procedure: string;
  requiredTools: string;
  safetyConsiderations: string;
  qualityStandard: string;
  completionEvidence: string;
  version: string;
  effectiveDate: string;
  reviewDate: string;
  status: SopStatus;
  relatedLesson: string;
};

export function normalizeProblemRecord(record: CaptureConversionRecord): ProblemRecord {
  const problemStatus =
    (record.problemStatus as ProblemStatus | undefined) ??
    ((record.status === "Open" || record.status === "Investigating" || record.status === "Action required" || record.status === "Resolved" || record.status === "Closed")
      ? (record.status as ProblemStatus)
      : "Open");

  return {
    ...record,
    problemStatement: record.problemStatement?.trim() || record.title,
    severity: (record.severity as ProblemSeverity | undefined) ?? "Medium",
    frequency: (record.frequency as ProblemFrequency | undefined) ?? "Occasional",
    impact: record.impact?.trim() || "",
    rootCauseStatus: (record.rootCauseStatus as RootCauseStatus | undefined) ?? "Not investigated",
    rootCause: record.rootCause?.trim() || "",
    owner: record.owner?.trim() || "",
    resolution: record.resolution?.trim() || "",
    status: problemStatus,
    problemStatus,
  };
}

export function isValidActionImplementationLessonId(
  implementsLessonId: string | undefined,
  lessons: readonly Readonly<Pick<LessonRecord, "id">>[],
): boolean {
  const lessonId = implementsLessonId?.trim() || "";
  return lessonId === "" || lessons.some((lesson) => lesson.id === lessonId);
}

export function assertActionLeadLink(value: unknown, field: "relatedLeadId" | "deliveryLeadId" = "relatedLeadId"): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`Action ${field} must be an optional string; commercial traceability cannot be loaded safely.`);
  }
}

export function normalizeActionRecord(record: CaptureConversionRecord): ActionRecord {
  // record.status holds the generic conversion status (e.g. "Converted") until
  // set to a real ActionStatus, so it must be validated rather than passed through via `??`.
  const actionStatus: ActionStatus =
    record.status === "Open" || record.status === "In Progress" || record.status === "Blocked" || record.status === "Waiting" || record.status === "Completed" || record.status === "Cancelled"
      ? record.status
      : "Open";

  return {
    ...record,
    ...(record.relatedLeadId !== undefined ? { relatedLeadId: record.relatedLeadId.trim() } : {}),
    ...(record.deliveryLeadId !== undefined ? { deliveryLeadId: record.deliveryLeadId.trim() } : {}),
    ...(record.implementsLessonId !== undefined
      ? { implementsLessonId: record.implementsLessonId.trim() }
      : {}),
    actionTitle: record.title?.trim() || "Untitled action",
    description: (record as Partial<ActionRecord>).description?.trim() || record.actionDescription?.trim() || record.originalRawNote?.trim() || "",
    owner: record.owner?.trim() || "",
    createdBy: record.createdBy?.trim() || "",
    createdDate: record.createdDate || record.createdAt || new Date().toISOString(),
    dueDate: record.dueDate?.trim() || "",
    priority: (record.priority as ActionPriority | undefined) ?? "Medium",
    status: actionStatus,
    relatedProblem: record.relatedProblem?.trim() || "",
    relatedDecision: record.relatedDecision?.trim() || "",
    relatedCapture: record.relatedCapture?.trim() || record.sourceCaptureId,
    relatedPillar: record.relatedPillar?.trim() || record.relatedArea,
    completionEvidence: record.completionEvidence?.trim() || "",
    completionDate: record.completionDate?.trim() || "",
    followUpDate: (record as Partial<ActionRecord>).followUpDate?.trim() || "",
    followUpOwner: (record as Partial<ActionRecord>).followUpOwner?.trim() || "",
    followUpOwnerPersonId: (record as Partial<ActionRecord>).followUpOwnerPersonId?.trim() || "",
    followUpNote: (record as Partial<ActionRecord>).followUpNote?.trim() || "",
    lastReviewedDate: (record as Partial<ActionRecord>).lastReviewedDate?.trim() || "",
    reviewOutcome: actionReviewOutcomeOptions.includes((record as Partial<ActionRecord>).reviewOutcome as ActionReviewOutcome)
      ? (record as Partial<ActionRecord>).reviewOutcome
      : undefined,
  };
}

export function normalizeDecisionRecord(record: CaptureConversionRecord): DecisionRecord {
  const decisionStatus =
    (record.decisionStatus as DecisionStatus | undefined) ??
    ((record.status === "Draft" || record.status === "Active" || record.status === "Under Review" || record.status === "Completed" || record.status === "Reversed")
      ? (record.status as DecisionStatus)
      : "Draft");

  return {
    ...record,
    decisionTitle: record.decisionTitle?.trim() || record.title,
    decisionStatement: record.decisionStatement?.trim() || record.title,
    decisionMaker: record.decisionMaker?.trim() || "",
    decisionDate: record.decisionDate || record.createdAt || new Date().toISOString(),
    context: record.context?.trim() || "",
    reasoning: record.reasoning?.trim() || "",
    evidenceConsidered: record.evidenceConsidered?.trim() || "",
    alternativesConsidered: record.alternativesConsidered?.trim() || "",
    assumptions: record.assumptions?.trim() || "",
    expectedOutcome: record.expectedOutcome?.trim() || "",
    riskLevel: (record.riskLevel as DecisionRiskLevel | undefined) ?? "Medium",
    reviewDate: record.reviewDate?.trim() || "",
    actualOutcome: record.actualOutcome?.trim() || "",
    outcomeRating: record.outcomeRating?.trim() || "",
    lessons: record.lessons?.trim() || "",
    status: decisionStatus,
    decisionStatus,
    relatedOpportunity: record.relatedOpportunity?.trim() || "",
  };
}

export function normalizeOpportunityRecord(record: CaptureConversionRecord): OpportunityRecord {
  const opportunityStatus =
    (record.opportunityStatus as OpportunityStatus | undefined) ??
    ((record.status === "New" || record.status === "Evaluating" || record.status === "On Hold" || record.status === "Approved" || record.status === "Rejected" || record.status === "Completed")
      ? (record.status as OpportunityStatus)
      : "New");

  return {
    ...record,
    opportunityTitle: record.opportunityTitle?.trim() || record.title || "Untitled opportunity",
    description: record.opportunityDescription?.trim() || record.originalRawNote?.trim() || "",
    source: record.source?.trim() || "Unknown",
    dateIdentified: record.dateIdentified || record.createdAt || new Date().toISOString(),
    relatedPillar: record.relatedPillar?.trim() || record.relatedArea || "",
    strategicFit: (record.strategicFit as OpportunityStrategicFit | undefined) ?? "Medium",
    estimatedUpside: record.estimatedUpside?.trim() || "",
    requiredCapital: record.requiredCapital?.trim() || "",
    requiredTime: record.requiredTime?.trim() || "",
    requiredCapability: record.requiredCapability?.trim() || "",
    risks: record.risks?.trim() || "",
    opportunityCost: record.opportunityCost?.trim() || "",
    evidence: record.evidence?.trim() || "",
    owner: record.owner?.trim() || "",
    status: opportunityStatus,
    decision: record.decision?.trim() || "",
    outcome: record.outcome?.trim() || "",
  };
}

export function normalizeLessonRecord(record: CaptureConversionRecord): LessonRecord {
  const { icarusLearning: storedLearning, ...base } = record;
  const icarusLearning = normaliseIcarusLessonLearning(storedLearning);
  const lessonStatus =
    (record.lessonStatus as LessonStatus | undefined) ??
    ((record.status === "New" || record.status === "Reviewed" || record.status === "Change Required" || record.status === "Implemented" || record.status === "Archived")
      ? (record.status as LessonStatus)
      : "New");

  return {
    ...base,
    ...(icarusLearning ? { icarusLearning } : {}),
    lessonTitle: record.lessonTitle?.trim() || record.title || "Untitled lesson",
    description: record.lessonDescription?.trim() || record.originalRawNote?.trim() || "",
    sourceEvent: record.sourceEvent?.trim() || "",
    dateLearned: record.dateLearned || record.createdAt || new Date().toISOString(),
    relatedPillar: record.relatedPillar?.trim() || record.relatedArea || "",
    whyItMatters: record.whyItMatters?.trim() || "",
    recommendedChange: record.recommendedChange?.trim() || "",
    relatedProblem: record.relatedProblem?.trim() || "",
    relatedProject: record.relatedProject?.trim() || "",
    relatedDecision: record.relatedDecision?.trim() || "",
    relatedSystem: record.relatedSystem?.trim() || "",
    owner: record.owner?.trim() || "",
    status: lessonStatus,
  };
}

export function applyLessonEditorChanges(current: CaptureConversionRecord, edited: LessonRecord): LessonRecord {
  return { ...edited, icarusLearning: current.icarusLearning };
}

export function normalizeSystemRecord(record: CaptureConversionRecord): SystemRecord {
  const systemStatus =
    (record.systemStatus as SystemStatus | undefined) ??
    ((record.status === "Draft" || record.status === "Active" || record.status === "Reviewing" || record.status === "Deprecated")
      ? (record.status as SystemStatus)
      : "Draft");

  return {
    ...record,
    systemName: record.systemName?.trim() || record.title || "Untitled system",
    purpose: record.purpose?.trim() || record.originalRawNote?.trim() || "",
    owner: record.owner?.trim() || "",
    area: record.area?.trim() || record.relatedPillar?.trim() || record.relatedArea || "",
    inputs: record.inputs?.trim() || "",
    process: record.process?.trim() || record.purpose?.trim() || "",
    outputs: record.outputs?.trim() || "",
    standards: record.standards?.trim() || "",
    failurePoints: record.failurePoints?.trim() || "",
    version: record.version?.trim() || "v1",
    lastReviewed: record.lastReviewed || record.createdAt || new Date().toISOString(),
    status: systemStatus,
    relatedLesson: record.relatedLesson?.trim() || "",
    relatedCapture: record.relatedCapture?.trim() || record.sourceCaptureId,
  };
}

export function normalizeSopRecord(record: CaptureConversionRecord): SopRecord {
  const sopStatus =
    (record.sopStatus as SopStatus | undefined) ??
    ((record.status === "Draft" || record.status === "Active" || record.status === "Reviewing" || record.status === "Deprecated" || record.status === "Archived")
      ? (record.status as SopStatus)
      : "Draft");

  return {
    ...record,
    sopTitle: record.sopTitle?.trim() || record.title || "Untitled SOP",
    purpose: record.sopPurpose?.trim() || record.purpose?.trim() || record.originalRawNote?.trim() || "",
    owner: record.owner?.trim() || "",
    relatedSystem: record.relatedSystem?.trim() || "",
    applicableRoles: record.applicableRoles?.trim() || "",
    procedure: record.procedure?.trim() || record.process?.trim() || record.originalRawNote?.trim() || "",
    requiredTools: record.requiredTools?.trim() || "",
    safetyConsiderations: record.safetyConsiderations?.trim() || "",
    qualityStandard: record.qualityStandard?.trim() || record.standards?.trim() || "",
    completionEvidence: record.completionEvidence?.trim() || "",
    version: record.version?.trim() || "v1",
    effectiveDate: record.effectiveDate || record.createdAt || new Date().toISOString(),
    reviewDate: record.reviewDate?.trim() || "",
    status: sopStatus,
    relatedLesson: record.relatedLesson?.trim() || "",
    relatedCapture: record.relatedCapture?.trim() || record.sourceCaptureId,
  };
}
