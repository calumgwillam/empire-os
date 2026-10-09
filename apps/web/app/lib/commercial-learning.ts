import { normalizeActionRecord, normalizeDecisionRecord, normalizeLessonRecord, type ActionRecord, type DecisionRecord, type LessonRecord } from "./capture-conversions";
import { getDelegationReadinessMissingFields } from "./execution-release";
import { parseFinanceAmountInput } from "./finance";
import { buildJobPerformance, type JobPerformanceInput, type JobPerformanceView } from "./job-performance";
import { getLeadFollowThroughDate } from "./lead-follow-through";

export const commercialCauseOptions = ["Labour estimation", "Materials", "Transport", "Scheduling", "Scope change", "Subcontracting", "Equipment", "Other"] as const;
export const commercialOutcomeOptions = ["Unknown", "Improved", "Mixed", "Not improved"] as const;
export type CommercialDiagnosis = {
  leadId: string; area: string; service: string; recordedAt: string; recordedByPersonId: string;
  cause: (typeof commercialCauseOptions)[number]; attribution: "Hypothesis" | "Supported contribution";
  evidence: string; expectedDirectCost: string; estimateEvidence: string; jobSnapshot: string;
  changeKind: "Pricing" | "Operating";
};
export type CommercialApproval = {
  recordedAt: string; personId: string; authorityEvidence: string; evidence: string;
  proposalSnapshot: string; decisionSnapshot: string;
};
export type CommercialEvaluation = {
  recordedAt: string; personId: string; leadId: string; comparabilityEvidence: string; adoptionEvidence: string;
  evidence: string; outcome: (typeof commercialOutcomeOptions)[number];
  baselineSnapshot: string; subsequentSnapshot: string; implementationSnapshot: string; proposalSnapshot: string;
};
export type CommercialLearning = { diagnosis: CommercialDiagnosis; approvals: CommercialApproval[]; evaluations: CommercialEvaluation[] };
export type CommercialLearningInput = Omit<JobPerformanceInput, "actions"> & {
  actions: readonly ActionRecord[]; lessons: readonly LessonRecord[]; decisions: readonly DecisionRecord[];
};
export type CommercialLearningView = {
  lessonId: string; title: string; leadId: string; area: string; service: string;
  archived: boolean;
  diagnosisCurrent: boolean; approvalCurrent: boolean; implementationComplete: boolean;
  evaluationCurrent: boolean; outcome: CommercialEvaluation["outcome"];
  expectedDirectCost: number | null; actualDirectCost: number | null; variance: number | null;
  baseline: JobPerformanceView | undefined; subsequent: JobPerformanceView | undefined;
  actionIds: string[]; reasons: string[];
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return object(value) && fields.every((field) => typeof value[field] === "string");
}
export function assertCommercialLearning(value: unknown): void {
  if (value === undefined) return;
  const diagnosis = object(value) && object(value.diagnosis) ? value.diagnosis : undefined;
  if (!object(value) || !strings(value.diagnosis, ["leadId", "area", "service", "recordedAt", "recordedByPersonId",
    "evidence", "expectedDirectCost", "estimateEvidence", "jobSnapshot"])
    || !commercialCauseOptions.some((cause) => cause === diagnosis?.cause)
    || !["Hypothesis", "Supported contribution"].some((value) => value === diagnosis?.attribution)
    || !["Pricing", "Operating"].some((value) => value === diagnosis?.changeKind)
    || !Array.isArray(value.approvals) || !value.approvals.every((entry: unknown) =>
      strings(entry, ["recordedAt", "personId", "authorityEvidence", "evidence", "proposalSnapshot", "decisionSnapshot"]))
    || !Array.isArray(value.evaluations) || !value.evaluations.every((entry: unknown) =>
      strings(entry, ["recordedAt", "personId", "leadId", "comparabilityEvidence", "adoptionEvidence", "evidence",
        "baselineSnapshot", "subsequentSnapshot", "implementationSnapshot", "proposalSnapshot"])
      && commercialOutcomeOptions.some((outcome) => outcome === entry.outcome))) {
    throw new Error("Commercial Lesson evidence is malformed; stored learning must be preserved and reconciled.");
  }
}
export function assertCommercialLessonRecord(value: unknown): void {
  if (!object(value)) return;
  assertCommercialLearning(value.commercialLearning);
  if (value.commercialLearning !== undefined && (value.targetType !== "Convert to Lesson"
    || !["id", "owner", "recommendedChange", "relatedDecision"].every((field) => typeof value[field] === "string")
    || (value.ownerPersonId !== undefined && typeof value.ownerPersonId !== "string"))) {
    throw new Error("Commercial learning must belong to a Lesson with a valid optional Person reference.");
  }
  if (value.commercialImplementation !== undefined && (value.targetType !== "Convert to Action"
    || !strings(value.commercialImplementation, ["recordedAt", "proposalSnapshot"])
    || typeof value.implementsLessonId !== "string" || !value.implementsLessonId.trim())) {
    throw new Error("Commercial implementation must be an evidence-bound Lesson implementation Action.");
  }
}
function ready(input: CommercialLearningInput, id: string): boolean {
  const people = input.people.filter((person) => person.id === id);
  return people.length === 1 && people[0].status === "Active" && Boolean(people[0].name.trim())
    && getDelegationReadinessMissingFields(people[0]).length === 0;
}
function event(value: string, nowMs: number): boolean {
  return value.length > 10 && Number.isFinite(getLeadFollowThroughDate(value)) && Date.parse(value) <= nowMs;
}
function requireClock(input: CommercialLearningInput): void {
  if (!Number.isFinite(input.nowMs)) throw new Error("Commercial learning requires a valid explicit clock.");
}
function estimateAmount(value: string): number | null {
  const amount = parseFinanceAmountInput(value);
  return amount !== null && Number.isSafeInteger(Math.round(amount * 100))
    && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001 ? Math.round(amount * 100) / 100 : null;
}
function snapshot(input: CommercialLearningInput, job: JobPerformanceView | undefined): string {
  if (!job) return "";
  const lead = input.leads.find((entry) => entry.id === job.leadId);
  return JSON.stringify([lead?.jobFinancialReview, { ...job, incomeIds: [...job.incomeIds].sort(),
    expenseIds: [...job.expenseIds].sort(), reasons: [...job.reasons].sort() }]);
}
function proposal(lesson: LessonRecord): string {
  return JSON.stringify([lesson.commercialLearning?.diagnosis, lesson.recommendedChange, lesson.relatedDecision]);
}
function linkedDecision(input: CommercialLearningInput, lesson: LessonRecord): DecisionRecord | undefined {
  const decisions = input.decisions.filter((decision) => decision.id === lesson.relatedDecision);
  return decisions.length === 1 ? decisions[0] : undefined;
}
function implementation(input: CommercialLearningInput, lesson: LessonRecord) {
  return input.actions.filter((action) => action.implementsLessonId === lesson.id)
    .sort((first, second) => first.id.localeCompare(second.id));
}
function completed(input: CommercialLearningInput, lesson: LessonRecord): boolean {
  const history = implementation(input, lesson);
  const actions = history.filter((action) => action.status !== "Cancelled"
    && action.commercialImplementation?.proposalSnapshot === proposal(lesson));
  return actions.length > 0 && !history.some((action) => !["Completed", "Cancelled"].includes(action.status))
    && actions.every((action) => action.status === "Completed" && action.completionEvidence?.trim()
    && event(action.completionDate || "", input.nowMs) && ready(input, action.ownerPersonId || "")
    && input.people.find((person) => person.id === action.ownerPersonId)?.name === action.owner.trim()
    && action.description.trim() === lesson.recommendedChange.trim()
    && input.actions.filter((entry) => entry.id === action.id).length === 1
    && event(action.commercialImplementation?.recordedAt || "", input.nowMs)
    && Date.parse(action.completionDate || "") >= Date.parse(action.commercialImplementation?.recordedAt || "")
    && Date.parse(action.completionDate || "") >= Date.parse(lesson.commercialLearning?.diagnosis.recordedAt || ""));
}
function comparable(input: CommercialLearningInput, lesson: LessonRecord, subsequent: JobPerformanceView | undefined): boolean {
  const diagnosis = lesson.commercialLearning?.diagnosis;
  if (!diagnosis || !subsequent || subsequent.leadId === diagnosis.leadId || subsequent.contribution === null
    || !diagnosis.service.trim() || subsequent.area !== diagnosis.area
    || subsequent.service.trim().toLowerCase() !== diagnosis.service.trim().toLowerCase() || !completed(input, lesson)) return false;
  const lead = input.leads.find((entry) => entry.id === subsequent.leadId);
  // Acceptance after implementation avoids treating pre-existing work as a prospective test.
  const acceptedAt = Date.parse(lead?.deliveryCommitment?.acceptedAt || "");
  return Boolean(lead?.deliveryCommitment && implementation(input, lesson)
    .filter((action) => action.status !== "Cancelled" && action.commercialImplementation?.proposalSnapshot === proposal(lesson)).every((action) =>
      acceptedAt >= Date.parse(action.completionDate || ""))
    && (diagnosis.changeKind !== "Pricing" || acceptedAt >= Date.parse(lesson.commercialLearning?.approvals.at(-1)?.recordedAt || "")));
}
function evaluationBinding(lesson: LessonRecord): string {
  return JSON.stringify([proposal(lesson), lesson.commercialLearning?.approvals.at(-1)]);
}
export function buildCommercialLearning(input: CommercialLearningInput): CommercialLearningView[] {
  requireClock(input);
  input.actions.forEach(assertCommercialLessonRecord);
  const jobs = buildJobPerformance(input);
  return input.lessons.filter((lesson) => lesson.commercialLearning).map((lesson) => {
    const learning = lesson.commercialLearning!;
    assertCommercialLearning(learning);
    const diagnosis = learning.diagnosis;
    const baseline = jobs.find((job) => job.leadId === diagnosis.leadId);
    const estimateValid = !diagnosis.expectedDirectCost.trim()
      || (estimateAmount(diagnosis.expectedDirectCost) !== null && Boolean(diagnosis.estimateEvidence.trim()));
    const diagnosisCurrent = Boolean(input.lessons.filter((entry) => entry.id === lesson.id).length === 1
      && baseline && baseline.reviewCurrent && baseline.contribution !== null && diagnosis.evidence.trim() && estimateValid
      && snapshot(input, baseline) === diagnosis.jobSnapshot && ready(input, diagnosis.recordedByPersonId)
      && event(diagnosis.recordedAt, input.nowMs)
      && Date.parse(diagnosis.recordedAt) >= Date.parse(input.leads.find((lead) => lead.id === diagnosis.leadId)?.jobFinancialReview?.reviewedAt || ""));
    const decision = linkedDecision(input, lesson);
    const approval = learning.approvals.at(-1);
    const approvalCurrent = Boolean(lesson.status !== "Archived" && diagnosisCurrent && approval && ready(input, approval.personId)
      && event(approval.recordedAt, input.nowMs) && approval.authorityEvidence.trim() && approval.evidence.trim()
      && Date.parse(approval.recordedAt) >= Date.parse(diagnosis.recordedAt)
      && decision && ["Active", "Completed", "Under Review"].includes(decision.decisionStatus)
      && decision.reasoning.trim() && decision.evidenceConsidered.trim() && decision.decisionStatement.trim()
      && Number.isFinite(getLeadFollowThroughDate(decision.decisionDate))
      && Date.parse(decision.decisionDate) <= Date.parse(approval.recordedAt)
      && approval.proposalSnapshot === proposal(lesson) && approval.decisionSnapshot === JSON.stringify(decision));
    const implementationComplete = completed(input, lesson);
    const evaluation = learning.evaluations.at(-1);
    const subsequent = jobs.find((job) => job.leadId === evaluation?.leadId);
    const improvementSupported = evaluation?.outcome !== "Improved" || Boolean(baseline?.contributionMarginPct !== null
      && baseline?.contributionMarginPct !== undefined && subsequent?.contributionMarginPct !== null
      && subsequent?.contributionMarginPct !== undefined && subsequent.contributionMarginPct > baseline.contributionMarginPct);
    const evaluationCurrent = Boolean(diagnosisCurrent && improvementSupported && evaluation && ready(input, evaluation.personId)
      && event(evaluation.recordedAt, input.nowMs) && evaluation.comparabilityEvidence.trim() && evaluation.adoptionEvidence.trim()
      && evaluation.evidence.trim() && comparable(input, lesson, subsequent)
      && (diagnosis.changeKind !== "Pricing" || approvalCurrent)
      && evaluation.baselineSnapshot === snapshot(input, baseline) && evaluation.subsequentSnapshot === snapshot(input, subsequent)
      && evaluation.implementationSnapshot === JSON.stringify(implementation(input, lesson))
      && evaluation.proposalSnapshot === evaluationBinding(lesson)
      && Date.parse(evaluation.recordedAt) >= Date.parse(input.leads.find((lead) => lead.id === evaluation.leadId)?.jobFinancialReview?.reviewedAt || "")
      && Date.parse(evaluation.recordedAt) >= Date.parse(approval?.recordedAt || diagnosis.recordedAt));
    const expectedDirectCost = diagnosis.expectedDirectCost.trim() ? estimateAmount(diagnosis.expectedDirectCost) : null;
    const actualDirectCost = diagnosisCurrent && baseline ? baseline.directCostSubtotal : null;
    const variance = expectedDirectCost !== null && actualDirectCost !== null
      ? Math.round((actualDirectCost - expectedDirectCost) * 100) / 100 : null;
    const reasons: string[] = [];
    if (!diagnosisCurrent) reasons.push("COMMERCIAL LEARNING: Financial diagnosis is stale, incomplete or improperly attributed");
    if (variance !== null && variance > 0 && (!evaluationCurrent || evaluation?.outcome !== "Improved")) reasons.push("COMMERCIAL LEARNING: Actual direct costs exceeded the evidence-linked original estimate; corrective effectiveness remains unresolved");
    if (diagnosis.attribution === "Hypothesis") reasons.push("COMMERCIAL LEARNING: Attributable cause remains a hypothesis; investigate before treating it as established");
    if (!ready(input, lesson.ownerPersonId || "") || input.people.find((person) => person.id === lesson.ownerPersonId)?.name !== lesson.owner.trim()) reasons.push("COMMERCIAL LEARNING: Corrective responsibility needs an active delegation-ready Person");
    if (!lesson.recommendedChange.trim()) reasons.push("COMMERCIAL LEARNING: Corrective proposal is missing");
    if (diagnosis.changeKind === "Pricing" && !approvalCurrent) reasons.push("COMMERCIAL LEARNING: Pricing proposal is not a current explicitly approved policy");
    if (!implementationComplete) reasons.push("COMMERCIAL LEARNING: Corrective implementation is missing, incomplete or lacks attributable dated evidence");
    if (!evaluationCurrent) reasons.push("COMMERCIAL LEARNING: Effectiveness remains unknown; review adoption and a subsequent comparable completed job");
    else if (evaluation?.outcome !== "Improved") reasons.push("COMMERCIAL LEARNING: Comparative outcome is unresolved, mixed or not improved; reassess the corrective change");
    if (lesson.status === "Implemented" && (!evaluationCurrent || evaluation?.outcome !== "Improved")) reasons.push("COMMERCIAL LEARNING: Implemented Lesson status does not establish successful commercial improvement");
    return { lessonId: lesson.id, title: lesson.lessonTitle, leadId: diagnosis.leadId, area: diagnosis.area, service: diagnosis.service,
      archived: lesson.status === "Archived",
      diagnosisCurrent, approvalCurrent, implementationComplete, evaluationCurrent, outcome: evaluationCurrent ? evaluation!.outcome : "Unknown",
      expectedDirectCost, actualDirectCost, variance,
      baseline, subsequent, actionIds: implementation(input, lesson).map((action) => action.id), reasons };
  });
}
function uniqueLesson(input: CommercialLearningInput, id: string): LessonRecord {
  requireClock(input);
  const lessons = input.lessons.filter((lesson) => lesson.id === id);
  if (lessons.length !== 1 || !lessons[0].commercialLearning) throw new Error("Select a unique commercial Lesson.");
  if (lessons[0].status === "Archived") throw new Error("Reopen the archived Lesson before recording a new commercial step.");
  assertCommercialLearning(lessons[0].commercialLearning);
  return lessons[0];
}
export function createCommercialLesson(input: CommercialLearningInput, id: string, leadId: string,
  request: Pick<CommercialDiagnosis, "cause" | "attribution" | "evidence" | "expectedDirectCost" | "estimateEvidence" | "changeKind">
    & { ownerPersonId: string; recommendedChange: string }): LessonRecord {
  requireClock(input);
  if (!id.trim() || input.lessons.some((lesson) => lesson.id === id) || input.actions.some((action) => action.id === id)
    || input.decisions.some((decision) => decision.id === id)) throw new Error("Commercial Lesson identity is missing or already exists.");
  if (!ready(input, request.ownerPersonId)) throw new Error("Diagnosis and corrective responsibility require an active delegation-ready Person.");
  const job = buildJobPerformance(input).find((entry) => entry.leadId === leadId);
  if (!job?.reviewCurrent || job.contribution === null || input.leads.filter((lead) => lead.id === leadId).length !== 1) throw new Error("Review complete job financial evidence before recording a supported commercial diagnosis.");
  if (!request.evidence.trim() || !request.recommendedChange.trim()) throw new Error("Diagnosis evidence and a proposed corrective change are required.");
  if (request.expectedDirectCost.trim() && (estimateAmount(request.expectedDirectCost) === null || !request.estimateEvidence.trim())) throw new Error("Expected costs need a genuine recorded estimate (at most two decimal places) and its evidence; leave them unknown otherwise.");
  const diagnosis: CommercialDiagnosis = { leadId, area: job.area, service: job.service, recordedAt: new Date(input.nowMs).toISOString(),
    recordedByPersonId: request.ownerPersonId, cause: request.cause, attribution: request.attribution, evidence: request.evidence.trim(),
    expectedDirectCost: request.expectedDirectCost.trim(), estimateEvidence: request.estimateEvidence.trim(),
    jobSnapshot: snapshot(input, job), changeKind: request.changeKind };
  const commercialLearning: CommercialLearning = { diagnosis, approvals: [], evaluations: [] };
  assertCommercialLearning(commercialLearning);
  return normalizeLessonRecord({ id, sourceCaptureId: "", targetType: "Convert to Lesson", createdAt: diagnosis.recordedAt,
    title: `Commercial review: ${job.title}`, lessonTitle: `Commercial review: ${job.title}`, originalRawNote: diagnosis.evidence,
    lessonDescription: diagnosis.evidence, relatedArea: job.area, relatedPillar: job.area, importance: "High", status: "Change Required",
    lessonStatus: "Change Required", sourceEvent: `Job ${leadId}: ${job.title}`, dateLearned: diagnosis.recordedAt,
    recommendedChange: request.recommendedChange.trim(), owner: input.people.find((person) => person.id === request.ownerPersonId)!.name,
    ownerPersonId: request.ownerPersonId, commercialLearning });
}
export function approveCommercialProposal(input: CommercialLearningInput, id: string,
  request: Pick<CommercialApproval, "personId" | "authorityEvidence" | "evidence">): LessonRecord {
  const lesson = uniqueLesson(input, id);
  const view = buildCommercialLearning(input).find((entry) => entry.lessonId === id)!;
  const decision = linkedDecision(input, lesson);
  if (!view.diagnosisCurrent || !lesson.recommendedChange.trim() || !decision
    || !["Active", "Under Review", "Completed"].includes(decision.decisionStatus) || !decision.reasoning.trim()
    || !decision.evidenceConsidered.trim() || !decision.decisionStatement.trim()
    || !Number.isFinite(getLeadFollowThroughDate(decision.decisionDate)) || Date.parse(decision.decisionDate) > input.nowMs) {
    throw new Error("Approval requires current financial diagnosis and a uniquely linked non-draft Decision with dated reasoning and evidence.");
  }
  if (!ready(input, request.personId) || !request.authorityEvidence.trim() || !request.evidence.trim()) throw new Error("Approval requires an active delegation-ready Person, explicit authority/scope and approval evidence.");
  return { ...lesson, commercialLearning: { ...lesson.commercialLearning!, approvals: [...lesson.commercialLearning!.approvals,
    { ...request, recordedAt: new Date(input.nowMs).toISOString(), proposalSnapshot: proposal(lesson), decisionSnapshot: JSON.stringify(decision) }] } };
}
export function evaluateCommercialChange(input: CommercialLearningInput, id: string,
  request: Pick<CommercialEvaluation, "personId" | "leadId" | "comparabilityEvidence" | "adoptionEvidence" | "evidence" | "outcome">): LessonRecord {
  const lesson = uniqueLesson(input, id);
  const view = buildCommercialLearning(input).find((entry) => entry.lessonId === id)!;
  const subsequent = buildJobPerformance(input).find((entry) => entry.leadId === request.leadId);
  if (!view.diagnosisCurrent || !comparable(input, lesson, subsequent)
    || (lesson.commercialLearning!.diagnosis.changeKind === "Pricing" && !view.approvalCurrent)) throw new Error("Outcome review requires current diagnosis, evidenced corrective implementation and a later comparable job with reviewed contribution; pricing also requires current approval.");
  if (!ready(input, request.personId) || !request.comparabilityEvidence.trim() || !request.adoptionEvidence.trim() || !request.evidence.trim()
    || !commercialOutcomeOptions.some((outcome) => outcome === request.outcome)) throw new Error("Outcome review needs a named reviewer, scope/scale comparability, actual adoption evidence and an explicit assessment.");
  if (request.outcome === "Improved" && (view.baseline?.contributionMarginPct === null
    || view.baseline?.contributionMarginPct === undefined || subsequent?.contributionMarginPct === null
    || subsequent?.contributionMarginPct === undefined || subsequent.contributionMarginPct <= view.baseline.contributionMarginPct)) {
    throw new Error("Improved requires a higher reviewed direct contribution margin on the comparable subsequent job; correlation is not demonstrated causation.");
  }
  return { ...lesson, commercialLearning: { ...lesson.commercialLearning!, evaluations: [...lesson.commercialLearning!.evaluations,
    { ...request, recordedAt: new Date(input.nowMs).toISOString(), baselineSnapshot: snapshot(input, view.baseline),
      subsequentSnapshot: snapshot(input, subsequent), implementationSnapshot: JSON.stringify(implementation(input, lesson)),
      proposalSnapshot: evaluationBinding(lesson) }] } };
}
export function createCommercialImplementation(input: CommercialLearningInput, lessonId: string, actionId: string,
  ownerPersonId: string, dueDate: string): ActionRecord {
  const lesson = uniqueLesson(input, lessonId);
  if (!actionId.trim() || input.actions.some((action) => action.id === actionId) || input.lessons.some((entry) => entry.id === actionId)
    || input.decisions.some((entry) => entry.id === actionId)) throw new Error("Implementation Action identity is missing or already exists.");
  if (!ready(input, ownerPersonId) || !Number.isFinite(getLeadFollowThroughDate(dueDate)) || !lesson.recommendedChange.trim()) throw new Error("Implementation requires a delegation-ready owner, valid deadline and explicit corrective proposal.");
  if (implementation(input, lesson).some((action) => !["Completed", "Cancelled"].includes(action.status))) throw new Error("An implementation Action is already active; use it rather than duplicate responsibility.");
  const owner = input.people.find((person) => person.id === ownerPersonId)!;
  return { ...normalizeActionRecord({ id: actionId, sourceCaptureId: lesson.sourceCaptureId, targetType: "Convert to Action",
    createdAt: new Date(input.nowMs).toISOString(), title: `Implement: ${lesson.lessonTitle}`, originalRawNote: lesson.recommendedChange,
    actionDescription: lesson.recommendedChange, status: "Open", priority: "High", importance: "High",
    owner: owner.name, dueDate, relatedArea: lesson.relatedPillar, relatedPillar: lesson.relatedPillar,
    relatedDecision: lesson.relatedDecision, implementsLessonId: lesson.id,
    commercialImplementation: { recordedAt: new Date(input.nowMs).toISOString(), proposalSnapshot: proposal(lesson) } }), ownerPersonId };
}
export function commercialLearningValidity(
  existing: ReadonlyMap<string, { validated: boolean; institutionalised: boolean }> | undefined,
  views: readonly CommercialLearningView[], lessons: readonly Pick<LessonRecord, "id" | "relatedSystem">[],
  systems: readonly { id: string; relatedLesson: string; status: string }[],
): Map<string, { validated: boolean; institutionalised: boolean }> {
  const result = new Map(existing);
  views.forEach((view) => {
    const successful = !view.archived && view.diagnosisCurrent && view.evaluationCurrent && view.outcome === "Improved";
    const prior = result.get(view.lessonId);
    const lesson = lessons.find((entry) => entry.id === view.lessonId);
    const operatingRecord = systems.some((system) => ["Active", "Reviewing"].includes(system.status)
      && (system.relatedLesson === view.lessonId || (lesson?.relatedSystem && lesson.relatedSystem === system.id)));
    result.set(view.lessonId, { validated: successful && (prior?.validated ?? true),
      institutionalised: successful && operatingRecord && (prior?.institutionalised ?? true) });
  });
  return result;
}
export function prepareCommercialDecision(input: CommercialLearningInput, lessonId: string, decisionId: string): {
  lesson: LessonRecord; decision: DecisionRecord;
} {
  const lesson = uniqueLesson(input, lessonId);
  if (lesson.relatedDecision.trim()) throw new Error("A Decision is already linked; review it instead of replacing its reasoning.");
  if (!decisionId.trim() || [...input.lessons, ...input.decisions, ...input.actions].some((entry) => entry.id === decisionId)) throw new Error("Decision identity is missing or already exists.");
  const diagnosis = lesson.commercialLearning!.diagnosis;
  const decision = normalizeDecisionRecord({ id: decisionId, sourceCaptureId: lesson.sourceCaptureId, targetType: "Convert to Decision",
    createdAt: new Date(input.nowMs).toISOString(), title: `Commercial proposal: ${lesson.lessonTitle}`,
    decisionTitle: `Commercial proposal: ${lesson.lessonTitle}`, originalRawNote: lesson.recommendedChange,
    relatedArea: lesson.relatedPillar, importance: "High", status: "Draft", decisionStatus: "Draft",
    decisionStatement: lesson.recommendedChange, context: `Lesson ${lesson.id}; source job ${diagnosis.leadId}; ${diagnosis.area} / ${diagnosis.service}`,
    evidenceConsidered: diagnosis.evidence, reasoning: "", alternativesConsidered: "", assumptions: "",
    expectedOutcome: "", actualOutcome: "", outcomeRating: "", decisionMaker: "", decisionDate: "", reviewDate: "" });
  return { lesson: { ...lesson, relatedDecision: decision.id }, decision };
}
export function assignCommercialResponsibility(input: CommercialLearningInput, lessonId: string, personId: string): LessonRecord {
  const lesson = uniqueLesson(input, lessonId);
  if (!ready(input, personId)) throw new Error("Corrective responsibility requires an active delegation-ready Person.");
  return { ...lesson, ownerPersonId: personId, owner: input.people.find((person) => person.id === personId)!.name };
}
