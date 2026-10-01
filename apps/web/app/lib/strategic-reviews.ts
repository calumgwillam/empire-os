import { isPlainObject } from "./backup";
import type { ActionRecord, DecisionRecord, OpportunityRecord } from "./capture-conversions";
import { isValidCalendarDateInput } from "./dates";
import type { ProjectRecord } from "./projects";

export const reviewTriggers = ["Weekly", "Major change", "Project completed", "Founder initiated"] as const;
export const reviewGapTypes = ["Execution Gap", "Decision Gap", "Knowledge Gap", "Capability Gap"] as const;
export const reviewCandidateResponses = ["Project", "Decision", "Investigation", "Organisation/System", "No new work required"] as const;
export const projectCounterfactuals = ["Yes — accelerate", "Yes — continue at current level", "Yes — but remove founder from routine execution", "No — not now", "No — underlying thesis no longer justifies it"] as const;
export const projectDispositions = ["Accelerate", "Continue", "Exit Founder", "Park / Stop"] as const;
export const reviewStages = ["Reality", "Constraints", "Opportunities", "Assumptions", "Blank sheet", "Objectives", "Project challenge", "Strategic gaps", "Founder allocation", "Not prioritising", "Reconciliation", "Summary"] as const;

export const strategicPillars = ["Operating Business", "Control & Orchestration", "Organisation & Leadership", "Capital & Resilience", "Expansion & Optionality"] as const;
export const strategicHorizons = ["Now", "Next", "Later"] as const;
export const strategicImportances = ["Critical", "High", "Medium"] as const;
export const strategicStatuses = ["Active", "Watching", "Achieved", "Paused"] as const;
export const founderAllocations = ["Founder attention now", "Advance through organisation", "Monitor", "Parked"] as const;

export type StrategicObjective = {
  id: string;
  title: string;
  pillar: (typeof strategicPillars)[number];
  horizon: (typeof strategicHorizons)[number];
  importance: (typeof strategicImportances)[number];
  status: (typeof strategicStatuses)[number];
  founderAllocation: (typeof founderAllocations)[number];
  owner: string;
  whyItMatters: string;
  successCondition: string;
  linkedProjectIds: string[];
  linkedOpportunityIds: string[];
  linkedDecisionIds: string[];
  createdAt: string;
  overrides: Array<{ id: string; chosenAlternative: string; rationale: string; timestamp: string; actor: string }>;
};

export type StrategicAssessment = {
  objective: StrategicObjective;
  linkedProjects: ProjectRecord[];
  linkedOpportunities: OpportunityRecord[];
  linkedDecisions: DecisionRecord[];
  gaps: string[];
  hasExecutablePath: boolean;
};

export const initialStrategicObjectives: Array<Pick<StrategicObjective, "title" | "pillar" | "horizon" | "importance" | "founderAllocation">> = [
  { title: "Validate FG Exterior Care as a reliable cash-generating operating business", pillar: "Operating Business", horizon: "Now", importance: "High", founderAllocation: "Advance through organisation" },
  { title: "Build reliable strategic prioritisation and founder allocation", pillar: "Control & Orchestration", horizon: "Now", importance: "Critical", founderAllocation: "Founder attention now" },
  { title: "Reduce routine founder dependency through systems, people and delegation", pillar: "Organisation & Leadership", horizon: "Next", importance: "High", founderAllocation: "Advance through organisation" },
  { title: "Protect capital and financial resilience", pillar: "Capital & Resilience", horizon: "Now", importance: "High", founderAllocation: "Monitor" },
  { title: "Build future optionality across new services, partnerships, geographies and ventures", pillar: "Expansion & Optionality", horizon: "Later", importance: "Medium", founderAllocation: "Parked" },
];

export type ReviewEvidence = {
  capturedAt: string;
  objectives: Array<Pick<StrategicObjective, "id" | "title" | "pillar" | "horizon" | "importance" | "status" | "founderAllocation" | "linkedProjectIds" | "linkedOpportunityIds" | "linkedDecisionIds">>;
  projects: Array<Pick<ProjectRecord, "id" | "projectName" | "status" | "owner" | "health" | "relatedActionIds">>;
  opportunities: Array<Pick<OpportunityRecord, "id" | "opportunityTitle" | "status" | "strategicFit" | "estimatedUpside">>;
  problems: Array<{ id: string; title: string; status: string }>;
  founderDependency: string;
  finance: string;
  execution: string;
};

export type ReviewConstraint = { id: string; description: string; evidence: string; objectiveIds: string[]; recommendation: string; decision: "" | "Confirm" | "Modify" | "Dismiss"; founderRationale: string; response: string };
export type ReviewOpportunity = { id: string; opportunityId: string; title: string; relevance: string; evidence: string; recommendation: string; decision: "" | "Pursue" | "Investigate" | "Monitor" | "Reject" | "Park"; founderRationale: string };
export type ReviewAssumption = { id: string; statement: string; confidence: "Low" | "Medium" | "High"; supportingEvidence: string; contraryEvidence: string; invalidationCondition: string; needsTesting: boolean; founderNote: string };
export type ReviewCandidate = { id: string; outcome: string; objectiveIds: string[]; whyNow: string; expectedStrategicEffect: string; founderNecessity: string; majorUncertainty: string; response: (typeof reviewCandidateResponses)[number]; representation: "" | "Already represented" | "Partially represented" | "Missing"; matchingProjectIds: string[] };
export type ReviewObjectiveJudgement = { objectiveId: string; evidence: string; recommendation: string; decision: "" | "Keep" | "Modify" | "Pause" | "Achieve"; horizon: StrategicObjective["horizon"]; importance: StrategicObjective["importance"]; founderAllocation: StrategicObjective["founderAllocation"]; rationale: string };
export type ReviewProjectJudgement = { projectId: string; objectiveIds: string[]; evidence: string; recommendation: string; counterfactual: "" | (typeof projectCounterfactuals)[number]; disposition: "" | (typeof projectDispositions)[number]; rationale: string; justification: string };
export type ReviewGap = { id: string; type: (typeof reviewGapTypes)[number]; description: string; evidence: string; objectiveIds: string[]; proposedResponse: string; disposition: "" | "Address" | "Monitor" | "Accept risk" | "Dismiss"; rationale: string };
export type ReviewFounderOutcome = { id: string; outcome: string; objectiveIds: string[]; whyNow: string; whyFounder: string; costOfDelay: string; dependencyUnlocked: string; uncertainty: string; allocation: "Primary" | "Secondary" | "Reserve" };
export type ReviewExclusion = { id: string; item: string; whyNotNow: string; reconsiderWhen: string };
export type ReviewContradiction = { id: string; description: string; blocking: boolean; overrideRationale: string };

export type StrategicReview = {
  id: string; status: "Draft" | "Applied" | "Superseded"; stage: number;
  reviewDate: string; trigger: (typeof reviewTriggers)[number]; reviewPeriodStart: string; nextReviewDate: string;
  realitySummary: string; evidenceSnapshot: ReviewEvidence | null;
  constraints: ReviewConstraint[]; opportunities: ReviewOpportunity[]; assumptions: ReviewAssumption[];
  blankSheetCandidates: ReviewCandidate[]; objectiveJudgements: ReviewObjectiveJudgement[];
  projectJudgements: ReviewProjectJudgement[]; strategicGaps: ReviewGap[];
  founderAllocation: ReviewFounderOutcome[]; notPrioritising: ReviewExclusion[];
  contradictions: ReviewContradiction[]; founderNotes: string;
  createdAt: string; appliedAt: string | null; supersededAt: string | null;
};

export function reviewGapCandidates(review: StrategicReview, assessments: StrategicAssessment[], projects: ProjectRecord[], opportunities: OpportunityRecord[], actions: ActionRecord[], executableAction: (action: ActionRecord) => boolean): ReviewGap[] {
  const gaps: ReviewGap[] = [];
  const add = (id: string, type: ReviewGap["type"], description: string, evidence: string, objectiveIds: string[], proposedResponse: string) => {
    const existing = review.strategicGaps.find((gap) => gap.id === id);
    gaps.push({ id, type, description, evidence, objectiveIds, proposedResponse, disposition: existing?.disposition || "", rationale: existing?.rationale || "" });
  };
  assessments.forEach(({ objective, linkedProjects, linkedOpportunities, linkedDecisions, hasExecutablePath }) => {
    const judgment = review.objectiveJudgements.find((entry) => entry.objectiveId === objective.id);
    const active = objective.status === "Active" && judgment?.decision !== "Pause" && judgment?.decision !== "Achieve";
    if (active && ["Critical", "High"].includes(judgment?.importance || objective.importance) && !hasExecutablePath)
      add(`execution:${objective.id}`, "Execution Gap", `${objective.title} lacks a meaningful active path.`, "No executable linked Action or approved Opportunity; Project status alone does not establish execution.", [objective.id], "Define an evidence-backed execution path.");
    if (active && (judgment?.founderAllocation || objective.founderAllocation) === "Founder attention now" && !review.founderAllocation.some((entry) => entry.objectiveIds.includes(objective.id)))
      add(`founder:${objective.id}`, "Decision Gap", `${objective.title} needs a defined founder contribution.`, hasExecutablePath ? "Operational work exists, but no founder-specific outcome is recorded." : "No executable linked work or reviewed founder outcome is recorded.", [objective.id], "Specify the judgement or founder outcome required.");
    if ((judgment?.founderAllocation || objective.founderAllocation) === "Parked" && linkedProjects.some((project) => !["Completed", "Cancelled"].includes(project.status)))
      add(`parked:${objective.id}`, "Execution Gap", `${objective.title} is parked while linked Projects remain active.`, "Active resources remain attached to a parked objective.", [objective.id], "Reconcile the allocation or the Project disposition.");
  });
  review.blankSheetCandidates.filter((entry) => entry.representation === "Missing").forEach((entry) => add(`missing:${entry.id}`, entry.response === "Decision" || entry.response === "No new work required" ? "Decision Gap" : entry.response === "Investigation" ? "Knowledge Gap" : entry.response === "Organisation/System" ? "Capability Gap" : "Execution Gap", `${entry.outcome} is missing from the current portfolio.`, entry.whyNow, entry.objectiveIds, entry.response === "No new work required" ? "Confirm why this missing outcome needs no new work." : `Consider ${entry.response.toLowerCase()} without creating work automatically.`));
  review.constraints.filter((entry) => entry.decision === "Confirm" && !entry.response.trim()).forEach((entry) => add(`constraint:${entry.id}`, "Capability Gap", `${entry.description} has no response.`, entry.evidence, entry.objectiveIds, "Decide how to address or explicitly accept the constraint."));
  review.opportunities.filter((entry) => ["Pursue", "Investigate"].includes(entry.decision) && (!entry.opportunityId || !opportunities.some((opportunity) => opportunity.id === entry.opportunityId && ["Evaluating", "Approved"].includes(opportunity.status)))).forEach((entry) => add(`opportunity:${entry.id}`, "Knowledge Gap", `${entry.title} has no active evaluation path.`, entry.evidence, [], "Confirm an investigation or decision path."));
  projects.filter((project) => !["Completed", "Cancelled"].includes(project.status) && !review.projectJudgements.some((entry) => entry.projectId === project.id && entry.objectiveIds.length > 0)).forEach((project) => add(`unlinked:${project.id}`, "Decision Gap", `${project.projectName} has no Strategic Objective.`, `Project is ${project.status}.`, [], "Link to an objective or record an explicit portfolio justification."));
  review.projectJudgements.filter((entry) => entry.disposition === "Accelerate" && !projects.some((project) => project.id === entry.projectId && (project.relatedActionIds || []).some((id) => actions.some((action) => action.id === id && executableAction(action))))).forEach((entry) => add(`accelerate:${entry.projectId}`, "Execution Gap", `Accelerate Project has no executable linked Action.`, entry.evidence, entry.objectiveIds, "Identify a concrete next Action before accelerating."));
  return gaps;
}

export function reviewContradictions(review: StrategicReview, objectives: StrategicObjective[], projects: ProjectRecord[], actions: ActionRecord[], gaps: ReviewGap[], executableAction: (action: ActionRecord) => boolean): ReviewContradiction[] {
  const result: ReviewContradiction[] = [];
  const add = (id: string, description: string, blocking: boolean) => result.push({ id, description, blocking, overrideRationale: review.contradictions.find((entry) => entry.id === id)?.overrideRationale || "" });
  const allocations = review.founderAllocation;
  if (allocations.filter((entry) => entry.allocation === "Primary").length > 1 || allocations.filter((entry) => entry.allocation === "Secondary").length > 2 || allocations.filter((entry) => entry.allocation === "Reserve").length > 1) add("allocation:capacity", "Founder allocation exceeds the review period budget.", true);
  review.projectJudgements.forEach((entry) => {
    const project = projects.find((item) => item.id === entry.projectId);
    if (entry.disposition === "Accelerate" && gaps.some((gap) => gap.id === `accelerate:${entry.projectId}`)) add(`project:${entry.projectId}:path`, `${project?.projectName || entry.projectId} is set to Accelerate without a concrete executable Action.`, true);
    if (entry.disposition === "Accelerate" && entry.counterfactual.startsWith("No —")) add(`project:${entry.projectId}:counterfactual`, `${project?.projectName || entry.projectId} is set to Accelerate despite a No counterfactual answer.`, true);
    if (!entry.objectiveIds.length && !entry.justification.trim() && !["Park / Stop"].includes(entry.disposition)) add(`project:${entry.projectId}:alignment`, `${project?.projectName || entry.projectId} has neither objective linkage nor explicit justification.`, true);
    if (entry.disposition === "Accelerate" && entry.objectiveIds.some((id) => review.objectiveJudgements.some((judgement) => judgement.objectiveId === id && (judgement.decision === "Pause" || judgement.founderAllocation === "Parked")))) add(`project:${entry.projectId}:parked`, `${project?.projectName || entry.projectId} is accelerating a paused or parked objective.`, true);
  });
  review.objectiveJudgements.forEach((entry) => {
    const objective = objectives.find((item) => item.id === entry.objectiveId);
    if (entry.founderAllocation === "Founder attention now" && review.projectJudgements.some((project) => project.objectiveIds.includes(entry.objectiveId) && project.disposition === "Exit Founder") && !review.founderAllocation.some((item) => item.objectiveIds.includes(entry.objectiveId))) add(`objective:${entry.objectiveId}:exit`, `${objective?.title || entry.objectiveId} needs founder attention while linked work exits founder ownership.`, true);
  });
  gaps.filter((gap) => gap.type === "Execution Gap" && gap.id.startsWith("execution:")).forEach((gap) => add(`gap:${gap.id}`, gap.description, false));
  const hasActiveLinkedAction = (projectId: string) => Boolean(projects.find((project) => project.id === projectId)?.relatedActionIds?.some((id) => actions.some((action) => action.id === id && executableAction(action))));
  allocations.filter((entry) => entry.allocation === "Primary").forEach((entry) => {
    if (entry.objectiveIds.some((id) => review.objectiveJudgements.some((judgement) => judgement.objectiveId === id && (judgement.decision === "Pause" || judgement.decision === "Achieve" || judgement.founderAllocation !== "Founder attention now" || objectives.some((objective) => objective.id === id && objective.status !== "Active"))))) add(`primary:${entry.id}:objective`, `Primary outcome ${entry.outcome} conflicts with the confirmed Objective allocation or status.`, true);
    const reviewedPath = review.blankSheetCandidates.some((candidate) => candidate.objectiveIds.some((id) => entry.objectiveIds.includes(id)) && (candidate.response === "Decision" || (candidate.representation !== "Missing" && candidate.matchingProjectIds.some(hasActiveLinkedAction))))
      || review.projectJudgements.some((judgement) => judgement.objectiveIds.some((id) => entry.objectiveIds.includes(id)) && judgement.disposition !== "Park / Stop" && hasActiveLinkedAction(judgement.projectId));
    if (!entry.objectiveIds.length || !reviewedPath) add(`primary:${entry.id}`, `Primary outcome ${entry.outcome} has no reviewed executable or decision path.`, true);
  });
  if (review.assumptions.some((entry) => entry.needsTesting && entry.confidence === "Low") && allocations.length) add("assumptions:testing", "Founder allocation includes work while low-confidence assumptions still need testing; confirm the dependency before commitment.", false);
  return result;
}

export function isStrategicObjectiveRecord(value: unknown): value is StrategicObjective {
  if (!isPlainObject(value)) return false;
  return ["id", "title", "pillar", "horizon", "importance", "status", "founderAllocation", "owner", "whyItMatters", "successCondition", "createdAt"]
    .every((field) => typeof value[field] === "string")
    && ["linkedProjectIds", "linkedOpportunityIds", "linkedDecisionIds"].every((field) => Array.isArray(value[field]) && (value[field] as unknown[]).every((id) => typeof id === "string"))
    && Array.isArray(value.overrides)
    && value.overrides.every((entry: unknown) => isPlainObject(entry) && ["id", "chosenAlternative", "rationale", "timestamp", "actor"].every((field) => typeof entry[field] === "string"));
}

export function reviewShapeIssues(value: unknown): string[] {
  if (!isPlainObject(value)) return ["Review is not an object."];
  const issues: string[] = [];
  const strings = (entry: Record<string, unknown>, fields: string[]) => fields.every((field) => typeof entry[field] === "string");
  const ids = (entry: unknown) => Array.isArray(entry) && entry.every((id) => typeof id === "string");
  const rows = (key: string, valid: (entry: Record<string, unknown>) => boolean) => {
    if (!Array.isArray(value[key]) || !value[key].every((entry: unknown) => isPlainObject(entry) && valid(entry))) issues.push(`Malformed ${key}.`);
  };
  if (!strings(value, ["id", "status", "reviewDate", "trigger", "reviewPeriodStart", "nextReviewDate", "realitySummary", "founderNotes", "createdAt"]) || !value.id) issues.push("Missing review identity or dates.");
  if (!["Draft", "Applied", "Superseded"].includes(String(value.status)) || !reviewTriggers.includes(value.trigger as StrategicReview["trigger"])) issues.push("Unsupported status or trigger.");
  if (typeof value.stage !== "number" || !Number.isInteger(value.stage) || value.stage < 0 || value.stage > 11) issues.push("Invalid review stage.");
  for (const field of ["reviewDate", "reviewPeriodStart", "nextReviewDate"] as const) {
    if (typeof value[field] !== "string" || value.status !== "Draft" || value[field]) {
      if (typeof value[field] !== "string" || value[field] !== value[field].trim() || !isValidCalendarDateInput(value[field])) issues.push(`Invalid ${field}.`);
    }
  }
  if (value.appliedAt !== null && typeof value.appliedAt !== "string" || value.supersededAt !== null && typeof value.supersededAt !== "string") issues.push("Invalid lifecycle dates.");
  if ((value.status === "Applied" || value.status === "Superseded") && (!value.appliedAt || !isPlainObject(value.evidenceSnapshot))) issues.push("Applied review lacks an application date or evidence snapshot.");
  if (value.status === "Superseded" && !value.supersededAt) issues.push("Superseded review lacks prior application or supersession date.");
  if (value.evidenceSnapshot !== null && (!isPlainObject(value.evidenceSnapshot) || !strings(value.evidenceSnapshot, ["capturedAt", "founderDependency", "finance", "execution"]) || !["objectives", "projects", "opportunities", "problems"].every((field) => Array.isArray((value.evidenceSnapshot as Record<string, unknown>)[field])))) issues.push("Malformed evidence snapshot.");
  if (isPlainObject(value.evidenceSnapshot) && ["objectives", "projects", "opportunities", "problems"].every((field) => Array.isArray((value.evidenceSnapshot as Record<string, unknown>)[field]))) {
    const snapshot = value.evidenceSnapshot;
    if (!(snapshot.objectives as unknown[]).every((entry) => isPlainObject(entry) && strings(entry, ["id", "title", "pillar", "horizon", "importance", "status", "founderAllocation"]) && ids(entry.linkedProjectIds) && ids(entry.linkedOpportunityIds) && ids(entry.linkedDecisionIds))
      || !(snapshot.projects as unknown[]).every((entry) => isPlainObject(entry) && strings(entry, ["id", "projectName", "status", "owner"]) && ids(entry.relatedActionIds))
      || !(snapshot.opportunities as unknown[]).every((entry) => isPlainObject(entry) && strings(entry, ["id", "opportunityTitle", "status", "strategicFit", "estimatedUpside"]))
      || !(snapshot.problems as unknown[]).every((entry) => isPlainObject(entry) && strings(entry, ["id", "title", "status"]))) issues.push("Malformed evidence entries.");
  }
  rows("constraints", (entry) => strings(entry, ["id", "description", "evidence", "recommendation", "decision", "founderRationale", "response"]) && ids(entry.objectiveIds) && ["", "Confirm", "Modify", "Dismiss"].includes(String(entry.decision)));
  rows("opportunities", (entry) => strings(entry, ["id", "opportunityId", "title", "relevance", "evidence", "recommendation", "decision", "founderRationale"]) && ["", "Pursue", "Investigate", "Monitor", "Reject", "Park"].includes(String(entry.decision)));
  rows("assumptions", (entry) => strings(entry, ["id", "statement", "supportingEvidence", "contraryEvidence", "invalidationCondition", "founderNote"]) && ["Low", "Medium", "High"].includes(String(entry.confidence)) && typeof entry.needsTesting === "boolean");
  rows("blankSheetCandidates", (entry) => strings(entry, ["id", "outcome", "whyNow", "expectedStrategicEffect", "founderNecessity", "majorUncertainty", "representation"]) && ids(entry.objectiveIds) && ids(entry.matchingProjectIds) && reviewCandidateResponses.includes(entry.response as ReviewCandidate["response"]) && ["", "Already represented", "Partially represented", "Missing"].includes(String(entry.representation)));
  rows("objectiveJudgements", (entry) => strings(entry, ["objectiveId", "evidence", "recommendation", "rationale"]) && ["", "Keep", "Modify", "Pause", "Achieve"].includes(String(entry.decision)) && strategicHorizons.includes(entry.horizon as StrategicObjective["horizon"]) && strategicImportances.includes(entry.importance as StrategicObjective["importance"]) && founderAllocations.includes(entry.founderAllocation as StrategicObjective["founderAllocation"]));
  rows("projectJudgements", (entry) => strings(entry, ["projectId", "evidence", "recommendation", "rationale", "justification"]) && ids(entry.objectiveIds) && (entry.counterfactual === "" || projectCounterfactuals.includes(entry.counterfactual as ReviewProjectJudgement["counterfactual"] & (typeof projectCounterfactuals)[number])) && (entry.disposition === "" || projectDispositions.includes(entry.disposition as (typeof projectDispositions)[number])));
  rows("strategicGaps", (entry) => strings(entry, ["id", "description", "evidence", "proposedResponse", "rationale"]) && ids(entry.objectiveIds) && reviewGapTypes.includes(entry.type as ReviewGap["type"]) && ["", "Address", "Monitor", "Accept risk", "Dismiss"].includes(String(entry.disposition)));
  rows("founderAllocation", (entry) => strings(entry, ["id", "outcome", "whyNow", "whyFounder", "costOfDelay", "dependencyUnlocked", "uncertainty"]) && ids(entry.objectiveIds) && ["Primary", "Secondary", "Reserve"].includes(String(entry.allocation)));
  rows("notPrioritising", (entry) => strings(entry, ["id", "item", "whyNotNow", "reconsiderWhen"]));
  rows("contradictions", (entry) => strings(entry, ["id", "description", "overrideRationale"]) && typeof entry.blocking === "boolean");
  if (value.status !== "Draft" && Array.isArray(value.founderAllocation)) {
    if (value.founderAllocation.filter((entry: ReviewFounderOutcome) => entry?.allocation === "Primary").length > 1 || value.founderAllocation.filter((entry: ReviewFounderOutcome) => entry?.allocation === "Secondary").length > 2 || value.founderAllocation.filter((entry: ReviewFounderOutcome) => entry?.allocation === "Reserve").length > 1) issues.push("Founder allocation exceeds capacity.");
  }
  return issues;
}

export function isStrategicReview(value: unknown): value is StrategicReview {
  return reviewShapeIssues(value).length === 0;
}

export type StrategicReviewApplicationValidationInput = {
  draft: StrategicReview;
  assessments: StrategicAssessment[];
  objectives: StrategicObjective[];
  reviews: StrategicReview[];
  projects: ProjectRecord[];
  activeProjects: ProjectRecord[];
  opportunities: OpportunityRecord[];
  actions: ActionRecord[];
  executableAction: (action: ActionRecord) => boolean;
};

export type StrategicReviewApplicationValidation = {
  reviewedGaps: ReviewGap[];
  contradictions: ReviewContradiction[];
  errors: string[];
};

export function validateStrategicReviewApplication(input: StrategicReviewApplicationValidationInput): StrategicReviewApplicationValidation {
  const { draft, assessments, objectives, reviews, projects, activeProjects, opportunities, actions, executableAction } = input;
  const gaps = reviewGapCandidates(draft, assessments, projects, opportunities, actions, executableAction);
  const retainedGaps = draft.strategicGaps.filter((gap) => gap.id.startsWith("manual:"));
  const reviewedGaps = [...gaps, ...retainedGaps];
  const contradictions = reviewContradictions(draft, objectives, projects, actions, reviewedGaps, executableAction);
  const errors: string[] = [];
  errors.push(...reviewShapeIssues(draft));
  if (!reviews.some((review) => review.id === draft.id && review.status === "Draft")) errors.push("Save this Draft before applying.");
  if (!draft.realitySummary.trim()) errors.push("Record what changed in reality.");
  if (!draft.nextReviewDate || draft.nextReviewDate <= draft.reviewDate || draft.reviewPeriodStart > draft.nextReviewDate) errors.push("Choose a future next review date after the review period starts.");
  if (reviews.filter((review) => review.status === "Applied").length > 1) errors.push("Multiple current Applied reviews must be reconciled first.");
  if (draft.constraints.some((entry) => !entry.description.trim() || !entry.evidence.trim() || !entry.decision || entry.decision === "Modify" && !entry.founderRationale.trim())) errors.push("Review each constraint and record its evidence.");
  if (draft.opportunities.some((entry) => !entry.title.trim() || !entry.decision)) errors.push("Disposition every strategic Opportunity.");
  if (draft.assumptions.some((entry) => !entry.statement.trim() || entry.needsTesting && !entry.invalidationCondition.trim())) errors.push("Complete assumptions and testing conditions.");
  if (!draft.blankSheetCandidates.length || draft.blankSheetCandidates.some((entry) => !entry.outcome.trim() || !entry.objectiveIds.length || !entry.whyNow.trim() || !entry.representation || entry.representation !== "Missing" && !entry.matchingProjectIds.length)) errors.push("Complete the blank-sheet reconstruction and compare each candidate to existing work.");
  if (objectives.filter((objective) => ["Active", "Watching"].includes(objective.status)).some((objective) => !draft.objectiveJudgements.some((entry) => entry.objectiveId === objective.id && entry.decision && entry.rationale.trim()))) errors.push("Confirm every Active or Watching objective with a rationale.");
  if (activeProjects.some((project) => !draft.projectJudgements.some((entry) => entry.projectId === project.id && entry.counterfactual && entry.disposition && entry.rationale.trim()))) errors.push("Answer the counterfactual and disposition every active Project.");
  if (reviewedGaps.some((entry) => !entry.description.trim() || !entry.evidence.trim() || !entry.proposedResponse.trim() || !entry.disposition || !entry.rationale.trim())) errors.push("Describe, evidence, disposition and explain every strategic gap.");
  if (draft.founderAllocation.filter((entry) => entry.allocation === "Primary").length !== 1 || draft.founderAllocation.filter((entry) => entry.allocation === "Secondary").length > 2 || draft.founderAllocation.filter((entry) => entry.allocation === "Reserve").length > 1 || draft.founderAllocation.some((entry) => !entry.outcome.trim() || !entry.objectiveIds.length || !entry.whyNow.trim() || !entry.whyFounder.trim())) errors.push("Set one Primary, at most two Secondary and one Reserve outcome with founder rationale.");
  if (draft.notPrioritising.some((entry) => !entry.item.trim() || !entry.whyNotNow.trim() || !entry.reconsiderWhen.trim())) errors.push("Complete all recorded exclusions.");
  if (contradictions.some((entry) => entry.blocking && !entry.overrideRationale.trim())) errors.push("Resolve blocking contradictions or record an explicit founder override rationale.");
  return { reviewedGaps, contradictions, errors };
}

export type StrategicReviewTransitionInput = {
  draft: StrategicReview;
  reviews: StrategicReview[];
  objectives: StrategicObjective[];
  reviewedGaps: ReviewGap[];
  contradictions: ReviewContradiction[];
  evidenceSnapshot: ReviewEvidence;
  appliedAt: string;
};

export type StrategicReviewTransition = {
  appliedReview: StrategicReview;
  nextObjectives: StrategicObjective[];
  nextReviews: StrategicReview[];
};

export function applyStrategicReviewTransition(input: StrategicReviewTransitionInput): StrategicReviewTransition {
  const { draft, reviews, objectives, reviewedGaps, contradictions, evidenceSnapshot, appliedAt } = input;
  const nextObjectives = objectives.map((objective) => {
    const judgement = draft.objectiveJudgements.find((entry) => entry.objectiveId === objective.id);
    if (!judgement) return objective;
    if (judgement.decision === "Pause") return { ...objective, status: "Paused" as const };
    if (judgement.decision === "Achieve") return { ...objective, status: "Achieved" as const };
    if (judgement.decision === "Modify") return { ...objective, horizon: judgement.horizon, importance: judgement.importance, founderAllocation: judgement.founderAllocation };
    return objective;
  });
  const appliedReview: StrategicReview = { ...draft, status: "Applied", evidenceSnapshot, strategicGaps: reviewedGaps, contradictions, appliedAt };
  const nextReviews = reviews.map((review) => review.id === draft.id ? appliedReview : review.status === "Applied" ? { ...review, status: "Superseded" as const, supersededAt: appliedAt } : review);
  return { appliedReview, nextObjectives, nextReviews };
}
