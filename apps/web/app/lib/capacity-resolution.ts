import { normalizeDecisionRecord, type DecisionRecord, type ActionRecord } from "./capture-conversions";
import { buildDeliveryCapacity, getCapacityDependencyReasons, type DeliveryCapacityInput, type PersonCapacityView } from "./delivery-capacity";
import { getDelegationReadinessMissingFields, getActionDependencyBlocker } from "./execution-release";
import { getLeadFollowThroughDate } from "./lead-follow-through";
import { buildLeadDelivery } from "./lead-delivery";
import { getEffectiveProcurementApprovalStatus, hasPendingProcurementValidation, parseFinanceAmountInput, type CommitmentRecord } from "./finance";
import type { CapitalAllocationResult } from "./capital-allocation";

export const capacityResponseOptions = ["Rescheduling", "Process improvement", "Delegation", "Equipment", "Subcontracting", "Recruitment"] as const;
export type CapacityResponse = (typeof capacityResponseOptions)[number];
export type CapacityAlternative = {
  kind: CapacityResponse; feasibility: "Unknown" | "Feasible" | "Not feasible"; rationale: string;
  cost: string; costEvidence: string; commitmentId: string;
  availableHours: string; availabilityEvidence: string; expectedReliefHours: string; impactEvidence: string;
  dependencyActionIds: string[]; dependencyEvidence: string; authorityEvidence: string;
  assumptions: string; validUntil: string;
};
export type CapacityBaseline = {
  personId: string; recordedAt: string; recordedByPersonId: string; evidence: string;
  windowStart: string; windowEnd: string; shortfallHours: number | null; sourceSnapshot: string;
  demand: { objectType: "Lead" | "Action" | "Project"; id: string }[];
};
export type CapacityApproval = {
  personId: string; recordedAt: string; authorityEvidence: string; evidence: string; selectionRationale: string;
  proposalSnapshot: string; financeSnapshot: string; capitalEvidence: string; personSnapshot: string;
};
export type CapacityEvaluation = {
  personId: string; recordedAt: string; validUntil: string; outcome: "Unknown" | "Improved" | "Not improved";
  evidence: string; comparabilityEvidence: string; attributionEvidence: string;
  sourceSnapshot: string; executionSnapshot: string; approvalSnapshot: string;
};
export type CapacityResolution = {
  baseline: CapacityBaseline; baselineHistory: CapacityBaseline[]; alternatives: CapacityAlternative[]; selectedKind: CapacityResponse | "";
  milestoneActionIds: string[]; approvals: CapacityApproval[]; evaluations: CapacityEvaluation[];
};
export type CapacityResolutionInput = DeliveryCapacityInput & {
  commitments: readonly CommitmentRecord[];
  capital?: Pick<CapitalAllocationResult, "cashConfigured" | "cashSnapshotFreshness" | "uncommittedDeployableCash" | "validActiveCommitments" | "procurementItems">;
};
export type CapacityResolutionView = {
  decisionId: string; personId: string; title: string; baselineCurrent: boolean; approvalCurrent: boolean;
  implementationComplete: boolean; outcomeCurrent: boolean; outcome: CapacityEvaluation["outcome"];
  baselineShortfall: number | null; currentShortfall: number | null;
  selected?: CapacityAlternative; reasons: string[];
};
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return object(value) && fields.every((field) => typeof value[field] === "string");
}
function ids(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id: unknown) => typeof id === "string" && Boolean(id.trim()))
    && new Set(value).size === value.length;
}
function baseline(value: unknown): value is Record<string, unknown> {
  return strings(value, ["personId", "recordedAt", "recordedByPersonId", "evidence", "windowStart", "windowEnd", "sourceSnapshot"])
    && ["personId", "recordedByPersonId", "evidence", "sourceSnapshot"].every((field) => String(value[field]).trim())
    && event(String(value.recordedAt), Infinity)
    && ((value.windowStart === "" && value.windowEnd === "") || Number.isFinite(getLeadFollowThroughDate(String(value.windowStart)))
      && Number.isFinite(getLeadFollowThroughDate(String(value.windowEnd))) && String(value.windowStart) <= String(value.windowEnd))
    && (value.shortfallHours === null || typeof value.shortfallHours === "number" && Number.isFinite(value.shortfallHours) && value.shortfallHours >= 0)
    && Array.isArray(value.demand) && value.demand.every((entry: unknown) =>
      strings(entry, ["objectType", "id"]) && ["Lead", "Action", "Project"].includes(String(entry.objectType)) && String(entry.id).trim());
}
export function assertCapacityResolutionRecord(value: unknown): void {
  if (!object(value) || value.capacityResolution === undefined) return;
  const resolution = value.capacityResolution;
  if (value.targetType !== "Convert to Decision" || !strings(value, ["id", "decisionStatement", "reasoning", "evidenceConsidered", "decisionDate", "decisionStatus"])
    || !object(resolution) || !baseline(resolution.baseline)
    || !Array.isArray(resolution.baselineHistory) || !resolution.baselineHistory.every(baseline)
    || !Array.isArray(resolution.alternatives) || resolution.alternatives.length !== capacityResponseOptions.length
    || !resolution.alternatives.every((option: unknown) => strings(option, ["kind", "feasibility", "rationale", "cost", "costEvidence", "commitmentId",
      "availableHours", "availabilityEvidence", "expectedReliefHours", "impactEvidence", "dependencyEvidence", "authorityEvidence", "assumptions", "validUntil"])
      && capacityResponseOptions.some((kind) => kind === option.kind) && ["Unknown", "Feasible", "Not feasible"].includes(String(option.feasibility))
      && ids(option.dependencyActionIds))
    || new Set(resolution.alternatives.map((option: { kind: string }) => option.kind)).size !== capacityResponseOptions.length
    || !(resolution.selectedKind === "" || capacityResponseOptions.some((kind) => kind === resolution.selectedKind))
    || !ids(resolution.milestoneActionIds)
    || !Array.isArray(resolution.approvals) || !resolution.approvals.every((entry: unknown) => strings(entry,
      ["personId", "recordedAt", "authorityEvidence", "evidence", "selectionRationale", "proposalSnapshot", "financeSnapshot", "capitalEvidence", "personSnapshot"])
      && event(String(entry.recordedAt), Infinity)
      && ["personId", "authorityEvidence", "evidence", "selectionRationale", "proposalSnapshot", "personSnapshot"].every((field) => String(entry[field]).trim()))
    || !Array.isArray(resolution.evaluations) || !resolution.evaluations.every((entry: unknown) => strings(entry,
      ["personId", "recordedAt", "validUntil", "outcome", "evidence", "comparabilityEvidence", "attributionEvidence", "sourceSnapshot", "executionSnapshot", "approvalSnapshot"])
      && ["Unknown", "Improved", "Not improved"].includes(String(entry.outcome)) && event(String(entry.recordedAt), Infinity)
      && currentDate(String(entry.validUntil), Date.parse(String(entry.recordedAt)))
      && ["personId", "evidence", "comparabilityEvidence", "attributionEvidence", "sourceSnapshot", "executionSnapshot", "approvalSnapshot"].every((field) => String(entry[field]).trim()))) {
    throw new Error("Capacity-resolution Decision evidence is malformed; preserve and reconcile stored history.");
  }
}
function ready(input: CapacityResolutionInput, id: string): boolean {
  const matches = input.people.filter((person) => person.id === id);
  return matches.length === 1 && matches[0].status === "Active" && Boolean(matches[0].name.trim())
    && getDelegationReadinessMissingFields(matches[0]).length === 0;
}
function event(value: string, now: number): boolean {
  return value.length > 10 && Number.isFinite(getLeadFollowThroughDate(value)) && Date.parse(value) <= now;
}
function currentDate(value: string, now: number): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && getLeadFollowThroughDate(value) >= now;
}
function pastDate(value: string, now: number): boolean {
  return value.length === 10 ? Number.isFinite(getLeadFollowThroughDate(value))
    && value <= new Date(now).toISOString().slice(0, 10) : event(value, now);
}
function quantity(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const parsed = parseFinanceAmountInput(value);
  return parsed !== null && Number.isSafeInteger(Math.round(parsed * 100)) ? parsed : null;
}
function source(input: CapacityResolutionInput, personId: string) {
  const capacity = buildDeliveryCapacity(input);
  const matches = capacity.people.filter((person) => person.personId === personId);
  const person = matches.length === 1 ? matches[0] : undefined;
  const work = capacity.work.filter((entry) => entry.ownerPersonId === personId && entry.commitment === "Committed")
    .sort((a, b) => `${a.objectType}:${a.id}`.localeCompare(`${b.objectType}:${b.id}`));
  const snapshot = JSON.stringify([person || null, input.people.filter((entry) => entry.id === personId), work]);
  return { person, work, snapshot };
}
function shortfall(person: PersonCapacityView | undefined): number | null {
  return person?.coverageCurrent && person.remainingCapacityHours !== null ? Math.max(0, -person.remainingCapacityHours) : null;
}
function uniqueDecision(input: CapacityResolutionInput, id: string): DecisionRecord {
  const matches = input.decisions.filter((decision) => decision.id === id);
  if (matches.length !== 1 || !matches[0].capacityResolution) throw new Error("Select a unique existing capacity-resolution Decision.");
  assertCapacityResolutionRecord(matches[0]);
  return matches[0];
}
function milestoneRecords(input: CapacityResolutionInput, decision: DecisionRecord): ActionRecord[] {
  return decision.capacityResolution!.milestoneActionIds.flatMap((id) => input.actions.filter((action) => action.id === id))
    .sort((a, b) => a.id.localeCompare(b.id));
}
function proposal(input: CapacityResolutionInput, decision: DecisionRecord): string {
  const resolution = decision.capacityResolution!;
  return JSON.stringify([resolution.baseline, resolution.alternatives, resolution.selectedKind, resolution.milestoneActionIds,
    decision.decisionStatement, decision.reasoning, decision.evidenceConsidered, decision.alternativesConsidered, decision.assumptions,
    decision.expectedOutcome, decision.decisionDate, decision.reviewDate,
    milestoneRecords(input, decision).map((action) => [action.id, action.relatedDecision, action.ownerPersonId, action.owner,
      action.description, action.actionTitle, action.dueDate, action.relatedProblem])]);
}
function financeSnapshot(input: CapacityResolutionInput, option: CapacityAlternative | undefined): string {
  if (!option?.commitmentId) return "";
  return JSON.stringify(input.commitments.filter((record) => record.id === option.commitmentId).map((record) => [
    record.id, record.amount, record.approvalStatus, record.approvedRejectedBy, record.approvalDate, record.approvalRationale,
    record.pendingValidationReason, record.quoteExpiryDate, record.quoteReference, record.supplier, record.notes,
    record.certainty, record.dueDate, record.procurementNeed, record.targetPrice, record.actualPurchasePrice, record.quoteNotes,
  ]));
}
function personSnapshot(input: CapacityResolutionInput, id: string): string {
  return JSON.stringify(input.people.filter((person) => person.id === id).map((person) =>
    [person.id, person.name, person.status, person.role, person.authority, person.responsibilities, person.accessLevel]));
}
function optionIssues(input: CapacityResolutionInput, option: CapacityAlternative): string[] {
  const issues: string[] = [];
  if (option.feasibility !== "Feasible" || !option.rationale.trim()) issues.push("Selected response feasibility is not evidenced");
  if (quantity(option.cost) === null || !option.costEvidence.trim()) issues.push("Cost/basis/horizon is unknown");
  if (quantity(option.availableHours) === null || !option.availabilityEvidence.trim()) issues.push("Available capacity/window is unknown");
  if (quantity(option.expectedReliefHours) === null || !option.impactEvidence.trim()) issues.push("Expected operational impact is unknown");
  if (!option.dependencyEvidence.trim() || !option.authorityEvidence.trim()) issues.push("Dependencies or authority scope are unknown");
  if (!currentDate(option.validUntil, input.nowMs)) issues.push("Selected option evidence is expired or undated");
  if (option.dependencyActionIds.some((id) => input.actions.filter((action) => action.id === id).length !== 1)) issues.push("Prerequisite Action reference is missing or ambiguous");
  if ((quantity(option.cost) ?? 0) > 0) {
    const matches = input.commitments.filter((record) => record.id === option.commitmentId);
    const record = matches[0];
    if (matches.length !== 1 || !record || getEffectiveProcurementApprovalStatus(record) !== "Approved"
      || hasPendingProcurementValidation(record) || !record.approvedRejectedBy?.trim() || !record.approvalRationale?.trim()
      || !pastDate(record.approvalDate || "", input.nowMs)
      || quantity(record.amount) !== quantity(option.cost) || ["cancelled", "canceled"].includes(record.status.trim().toLowerCase())
      || (record.targetPrice?.trim() && quantity(record.targetPrice) !== quantity(option.cost))
      || (record.actualPurchasePrice?.trim() && quantity(record.actualPurchasePrice) !== quantity(option.cost))
      || (record.quoteExpiryDate && !currentDate(record.quoteExpiryDate, input.nowMs))) {
      issues.push("Positive-cost response needs a unique approved Finance commitment for the same evidenced cost, with current quote/validation");
    }
  } else if (option.commitmentId && input.commitments.filter((record) => record.id === option.commitmentId).length !== 1) {
    issues.push("Finance commitment reference is missing or ambiguous");
  }
  return issues;
}
function complete(input: CapacityResolutionInput, action: ActionRecord, after: number): boolean {
  return action.status === "Completed" && Boolean(action.completionEvidence.trim()) && event(action.completionDate, input.nowMs)
    && Date.parse(action.completionDate) >= after && Date.parse(action.completionDate) >= Date.parse(action.createdAt)
    && !getActionDependencyBlocker(action, input.problems, input.decisions)
    && (!action.relatedProblem || input.problems.filter((problem) => problem.id === action.relatedProblem).length === 1)
    && (!action.relatedDecision || input.decisions.filter((decision) => decision.id === action.relatedDecision).length === 1)
    && (!action.workloadAssessments?.length || !getCapacityDependencyReasons(input, action.workloadAssessments.at(-1)!,
      { objectType: "Action", id: action.id }).length);
}
function prerequisiteConflict(input: CapacityResolutionInput, ids: readonly string[], milestones: readonly string[]): boolean {
  const pending = [...ids];
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (milestones.includes(id)) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const matches = input.actions.filter((action) => action.id === id);
    if (matches.length !== 1) return true;
    const assessment = matches[0].workloadAssessments?.at(-1);
    if (!assessment) continue;
    if (getCapacityDependencyReasons(input, assessment, { objectType: "Action", id }).some((reason) =>
      !reason.startsWith("Dependency unresolved:"))) return true;
    pending.push(...assessment.dependencyActionIds);
  }
  return false;
}
function retainedDemandIssues(input: CapacityResolutionInput, resolution: CapacityResolution, after: number): string[] {
  const capacity = buildDeliveryCapacity(input);
  const delivery = buildLeadDelivery(input);
  return resolution.baseline.demand.flatMap((reference) => {
    const work = capacity.work.filter((entry) => entry.id === reference.id && entry.objectType === reference.objectType);
    if (work.length === 1) {
      const item = work[0];
      const person = capacity.people.find((entry) => entry.personId === item.ownerPersonId);
      if (!item.operationallyReady || !item.assessmentCurrent || !item.assessment || !person?.coverageCurrent
        || item.assessment.windowStart < resolution.baseline.windowStart || item.assessment.windowEnd > resolution.baseline.windowEnd
        || person.windowStart !== resolution.baseline.windowStart || person.windowEnd !== resolution.baseline.windowEnd
        || Date.parse(item.assessment.recordedAt) <= after
        || Date.parse(input.people.find((entry) => entry.id === person.personId)?.availabilityReviews?.at(-1)?.recordedAt || "") <= after
        || (person.personId !== resolution.baseline.personId && (person.remainingCapacityHours === null || person.remainingCapacityHours < 0))) {
        return ["Original workload is displaced, unready or delegated without fresh covered receiving capacity; shortage reduction is not yet verified"];
      }
      return [];
    }
    if (reference.objectType === "Lead" && input.leads.filter((lead) => lead.id === reference.id).length === 1
      && delivery.some((view) => view.leadId === reference.id && view.completionSupported)
      && Date.parse(input.actions.find((action) =>
        action.id === input.leads.find((lead) => lead.id === reference.id)?.deliveryCommitment?.actionId)?.completionDate || "")
          >= Date.parse(resolution.baseline.recordedAt)) return [];
    const actions = reference.objectType === "Action" ? input.actions.filter((action) => action.id === reference.id) : [];
    if (actions.length === 1 && complete(input, actions[0], Date.parse(resolution.baseline.recordedAt))) return [];
    return ["Original obligation disappeared, was cancelled or lacks supported discharge; removing records cannot establish successful capacity improvement"];
  });
}
function outcomeSnapshot(input: CapacityResolutionInput, resolution: CapacityResolution): string {
  const capacity = buildDeliveryCapacity(input);
  const original = resolution.baseline.demand.map((reference) => ({
    reference,
    records: reference.objectType === "Lead" ? input.leads.filter((entry) => entry.id === reference.id)
      : reference.objectType === "Action" ? input.actions.filter((entry) => entry.id === reference.id)
        : input.projects.filter((entry) => entry.id === reference.id),
    delivery: reference.objectType === "Lead" ? input.actions.filter((action) =>
      action.id === input.leads.find((lead) => lead.id === reference.id)?.deliveryCommitment?.actionId) : [],
    receivingCapacity: capacity.work.filter((entry) => entry.id === reference.id && entry.objectType === reference.objectType)
      .map((work) => capacity.people.find((person) => person.personId === work.ownerPersonId)),
  }));
  const selected = resolution.alternatives.find((option) => option.kind === resolution.selectedKind);
  const ids = new Set(selected?.dependencyActionIds || []);
  const pending = [...ids];
  while (pending.length) {
    const id = pending.pop()!;
    for (const action of input.actions.filter((entry) => entry.id === id)) {
      for (const dependency of action.workloadAssessments?.at(-1)?.dependencyActionIds || []) {
        if (!ids.has(dependency)) { ids.add(dependency); pending.push(dependency); }
      }
    }
  }
  return JSON.stringify([source(input, resolution.baseline.personId).snapshot, original,
    input.actions.filter((action) => ids.has(action.id)).sort((a, b) => a.id.localeCompare(b.id))]);
}
export function buildCapacityResolutions(input: CapacityResolutionInput): CapacityResolutionView[] {
  input.decisions.forEach(assertCapacityResolutionRecord);
  return input.decisions.filter((decision) => decision.capacityResolution).map((decision) => {
    assertCapacityResolutionRecord(decision);
    const resolution = decision.capacityResolution!;
    const current = source(input, resolution.baseline.personId);
    const selected = resolution.alternatives.find((option) => option.kind === resolution.selectedKind);
    const approval = resolution.approvals.at(-1);
    const evaluation = resolution.evaluations.at(-1);
    const milestones = milestoneRecords(input, decision);
    const baselineCurrent = event(resolution.baseline.recordedAt, input.nowMs) && ready(input, resolution.baseline.recordedByPersonId)
      && current.snapshot === resolution.baseline.sourceSnapshot;
    const ownedMilestones = resolution.milestoneActionIds.length > 0 && milestones.length === resolution.milestoneActionIds.length
      && milestones.every((action) => input.actions.filter((entry) => entry.id === action.id).length === 1
        && action.relatedDecision === decision.id && ready(input, action.ownerPersonId || "")
        && input.people.find((person) => person.id === action.ownerPersonId)?.name === action.owner.trim()
        && Boolean(action.description.trim()) && Number.isFinite(getLeadFollowThroughDate(action.dueDate)));
    const optionProblems = selected ? optionIssues(input, selected) : ["No response selected"];
    const approvalCurrent = Boolean(approval && selected && !optionProblems.length && ownedMilestones
      && input.decisions.filter((entry) => entry.id === decision.id).length === 1
      && ["Active", "Under Review", "Completed"].includes(decision.decisionStatus)
      && ready(input, approval.personId) && event(approval.recordedAt, input.nowMs)
      && approval.personSnapshot === personSnapshot(input, approval.personId)
      && approval.authorityEvidence.trim() && approval.evidence.trim() && approval.selectionRationale.trim()
      && approval.proposalSnapshot === proposal(input, decision) && approval.financeSnapshot === financeSnapshot(input, selected));
    const dependenciesComplete = Boolean(selected && !prerequisiteConflict(input, selected.dependencyActionIds, resolution.milestoneActionIds)
      && selected.dependencyActionIds.every((id) => {
      const matches = input.actions.filter((action) => action.id === id);
      return matches.length === 1 && complete(input, matches[0], 0) && !resolution.milestoneActionIds.includes(id);
    }));
    const prerequisitesAt = Math.max(0, ...(selected?.dependencyActionIds || []).map((id) =>
      Date.parse(input.actions.find((action) => action.id === id)?.completionDate || "")));
    const implementationComplete = approvalCurrent && dependenciesComplete && milestones.every((action) =>
      complete(input, action, Math.max(Date.parse(approval!.recordedAt), prerequisitesAt)));
    const lastCompletion = Math.max(...milestones.map((action) => Date.parse(action.completionDate)), Date.parse(approval?.recordedAt || ""));
    const personRecord = input.people.find((person) => person.id === resolution.baseline.personId);
    const demandIssues = retainedDemandIssues(input, resolution, lastCompletion);
    const freshCapacity = !demandIssues.length && current.person?.coverageCurrent && current.person.windowStart === resolution.baseline.windowStart
      && current.person.windowEnd === resolution.baseline.windowEnd && current.work.every((work) => work.operationallyReady
        && work.assessment && Date.parse(work.assessment.recordedAt) > lastCompletion)
      && Date.parse(personRecord?.availabilityReviews?.at(-1)?.recordedAt || "") > lastCompletion;
    const resultSupported = evaluation?.outcome === "Unknown" || (resolution.baseline.shortfallHours !== null && shortfall(current.person) !== null
      && (evaluation?.outcome === "Improved" ? shortfall(current.person)! < resolution.baseline.shortfallHours
        : shortfall(current.person)! >= resolution.baseline.shortfallHours));
    const outcomeCurrent = Boolean(evaluation && resultSupported && implementationComplete && ready(input, evaluation.personId)
      && event(evaluation.recordedAt, input.nowMs) && Date.parse(evaluation.recordedAt) > lastCompletion
      && currentDate(evaluation.validUntil, input.nowMs) && freshCapacity && evaluation.evidence.trim()
      && evaluation.comparabilityEvidence.trim() && evaluation.attributionEvidence.trim()
      && evaluation.sourceSnapshot === outcomeSnapshot(input, resolution) && evaluation.executionSnapshot === JSON.stringify(milestones)
      && evaluation.approvalSnapshot === JSON.stringify(approval));
    const reasons = [...optionProblems];
    if (!baselineCurrent && !approval) reasons.push("Capacity baseline changed; explicitly re-review diagnosis before first approval, preserving prior evidence");
    if (!ownedMilestones) reasons.push("Link existing uniquely owned dated Actions as implementation milestones");
    if (!approvalCurrent) reasons.push("Explicit current approval for the exact response, authority, cost and implementation scope is missing");
    if (!dependenciesComplete) reasons.push("Intervention prerequisites remain outstanding or conflict with implementation milestones");
    if (approvalCurrent && !implementationComplete) reasons.push("Approved intervention implementation is incomplete or lacks dated post-approval evidence");
    if (milestones.some((action) => !["Completed", "Cancelled"].includes(action.status) && getLeadFollowThroughDate(action.dueDate) < input.nowMs)) reasons.push("Capacity intervention milestone is overdue");
    if (!outcomeCurrent || evaluation?.outcome === "Unknown") reasons.push("Original constraint improvement remains unverified; fresh comparable capacity evidence is required");
    if (implementationComplete) reasons.push(...new Set(demandIssues));
    if (outcomeCurrent && evaluation?.outcome === "Not improved") reasons.push("Evidence-reviewed intervention did not improve the original capacity constraint");
    return { decisionId: decision.id, personId: resolution.baseline.personId, title: decision.decisionTitle || decision.title,
      baselineCurrent, approvalCurrent, implementationComplete, outcomeCurrent, outcome: outcomeCurrent ? evaluation!.outcome : "Unknown",
      baselineShortfall: resolution.baseline.shortfallHours, currentShortfall: shortfall(current.person), selected, reasons };
  });
}
export function createCapacityResolution(input: CapacityResolutionInput, id: string, personId: string, reviewerId: string, evidence: string): DecisionRecord {
  const current = source(input, personId);
  if (!id.trim() || input.decisions.some((decision) => decision.id === id) || input.actions.some((action) => action.id === id)) throw new Error("Decision identity is missing or already exists.");
  if (!ready(input, reviewerId) || !ready(input, personId) || !evidence.trim() || !current.person?.reasons.length || !current.person.committedCount) {
    throw new Error("Record an attributable diagnosis of an existing Person capacity constraint with committed work.");
  }
  return normalizeDecisionRecord({ id, targetType: "Convert to Decision", sourceCaptureId: "", createdAt: new Date(input.nowMs).toISOString(),
    title: `Resolve capacity: ${current.person.name}`, originalRawNote: evidence.trim(), importance: "High", relatedArea: input.people.find((person) => person.id === personId)?.pillar || "",
    status: "Draft", decisionTitle: `Resolve capacity: ${current.person.name}`, context: current.person.reasons.join("; "),
    capacityResolution: { baseline: { personId, recordedAt: new Date(input.nowMs).toISOString(), recordedByPersonId: reviewerId,
      evidence: evidence.trim(), windowStart: current.person.windowStart, windowEnd: current.person.windowEnd,
      shortfallHours: shortfall(current.person), sourceSnapshot: current.snapshot, demand: current.work.map(({ objectType, id }) => ({ objectType, id })) },
      baselineHistory: [], alternatives: capacityResponseOptions.map((kind) => ({ kind, feasibility: "Unknown", rationale: "", cost: "", costEvidence: "", commitmentId: "",
        availableHours: "", availabilityEvidence: "", expectedReliefHours: "", impactEvidence: "", dependencyActionIds: [],
        dependencyEvidence: "", authorityEvidence: "", assumptions: "", validUntil: "" })),
      selectedKind: "", milestoneActionIds: [], approvals: [], evaluations: [] } });
}
export function reviseCapacityResolution(input: CapacityResolutionInput, id: string, alternatives: CapacityAlternative[],
  selectedKind: CapacityResponse | "", milestoneActionIds: string[]): DecisionRecord {
  const decision = uniqueDecision(input, id);
  const next = { ...decision, capacityResolution: { ...decision.capacityResolution!, alternatives, selectedKind, milestoneActionIds } };
  assertCapacityResolutionRecord(next);
  for (const option of alternatives) {
    if (option.feasibility !== "Unknown" && !option.rationale.trim()) throw new Error("Feasible/rejected alternatives require explicit evidence/rationale.");
    if ([option.cost, option.availableHours, option.expectedReliefHours].some((value) => value.trim() && quantity(value) === null)) throw new Error("Amounts/hours must be non-negative precise quantities or explicitly blank/unknown.");
    if (option.dependencyActionIds.some((dependency) => input.actions.filter((action) => action.id === dependency).length !== 1
      || milestoneActionIds.includes(dependency)) || prerequisiteConflict(input, option.dependencyActionIds, milestoneActionIds)) {
      throw new Error("Dependencies must be unique existing Actions, distinct from implementation milestones throughout their prerequisite chain; reconcile missing references/cycles.");
    }
    if (option.commitmentId && input.commitments.filter((record) => record.id === option.commitmentId).length !== 1) throw new Error("Finance reference is missing or ambiguous.");
  }
  if (milestoneActionIds.some((actionId) => input.actions.filter((action) => action.id === actionId && action.relatedDecision === id).length !== 1)) {
    throw new Error("Milestones must already belong to this Decision; use existing Action linking/creation first.");
  }
  return next;
}
export function refreshCapacityBaseline(input: CapacityResolutionInput, id: string, personId: string, evidence: string): DecisionRecord {
  const decision = uniqueDecision(input, id);
  const resolution = decision.capacityResolution!;
  const current = source(input, resolution.baseline.personId);
  if (resolution.approvals.length) throw new Error("An approved original constraint cannot be rewritten; preserve its outcome and use a new Decision for changed scope/windows.");
  if (!ready(input, personId) || !evidence.trim() || !current.person?.reasons.length || !current.person.committedCount) {
    throw new Error("Baseline refresh requires a named reviewer, diagnosis evidence and an existing committed capacity constraint.");
  }
  return { ...decision, capacityResolution: { ...resolution, baselineHistory: [...resolution.baselineHistory, resolution.baseline],
    baseline: { personId: resolution.baseline.personId, recordedAt: new Date(input.nowMs).toISOString(), recordedByPersonId: personId,
      evidence: evidence.trim(), windowStart: current.person.windowStart, windowEnd: current.person.windowEnd,
      shortfallHours: shortfall(current.person), sourceSnapshot: current.snapshot, demand: current.work.map(({ objectType, id }) => ({ objectType, id })) } } };
}
export function approveCapacityResolution(input: CapacityResolutionInput, id: string,
  request: Pick<CapacityApproval, "personId" | "authorityEvidence" | "evidence" | "selectionRationale" | "capitalEvidence">): DecisionRecord {
  const decision = uniqueDecision(input, id);
  const resolution = decision.capacityResolution!;
  const view = buildCapacityResolutions(input).find((entry) => entry.decisionId === id)!;
  const selected = view.selected;
  if (!selected || optionIssues(input, selected).length || prerequisiteConflict(input, selected.dependencyActionIds, resolution.milestoneActionIds)
    || !ready(input, request.personId) || !request.authorityEvidence.trim()
    || !request.evidence.trim() || !request.selectionRationale.trim() || (!view.baselineCurrent && !resolution.approvals.length)
    || !["Active", "Under Review"].includes(decision.decisionStatus) || !decision.decisionStatement.trim() || !decision.reasoning.trim()
    || !decision.evidenceConsidered.trim() || !pastDate(decision.decisionDate, input.nowMs)
    || !currentDate(decision.reviewDate, input.nowMs)
    || resolution.alternatives.some((option) => !option.rationale.trim())) {
    throw new Error("Approval requires a current evidenced selected response, comparison rationale for all six alternatives, named authority and an active dated reasoned Decision with review date.");
  }
  const milestones = milestoneRecords(input, decision);
  if (!milestones.length || milestones.length !== resolution.milestoneActionIds.length || milestones.some((action) =>
    input.actions.filter((entry) => entry.id === action.id).length !== 1 || action.relatedDecision !== id
    || !ready(input, action.ownerPersonId || "") || action.owner.trim() !== input.people.find((person) => person.id === action.ownerPersonId)?.name
    || !action.description.trim() || !Number.isFinite(getLeadFollowThroughDate(action.dueDate)) || ["Completed", "Cancelled"].includes(action.status))) {
    throw new Error("Approval requires existing explicitly owned, scoped and dated implementation Actions.");
  }
  if ((quantity(selected.cost) ?? 0) > 0 && (!request.capitalEvidence.trim() || !input.capital?.cashConfigured
    || input.capital.cashSnapshotFreshness.label !== "Current" || input.capital.uncommittedDeployableCash === null
    || input.capital.uncommittedDeployableCash < 0)) {
    throw new Error("Positive-cost approval requires current configured capital allocation without an existing cash shortfall and explicit affordability/commitment coverage evidence.");
  }
  if ((quantity(selected.cost) ?? 0) > 0 && input.capital) {
    const alreadyReserved = input.capital.validActiveCommitments.some((entry) => entry.commitment.id === selected.commitmentId
      && entry.effectiveCertainty === "Committed" && !entry.pendingValidation && !entry.isRejected);
    const alreadyPurchased = input.capital.procurementItems.some((entry) => entry.commitment.id === selected.commitmentId && entry.isPurchased);
    if (!alreadyReserved && !alreadyPurchased && input.capital.uncommittedDeployableCash! < quantity(selected.cost)!) {
      throw new Error("Unreserved response cost exceeds current deployable capital; do not double-count reserved commitments or assume affordability.");
    }
  }
  const approval = { ...request, recordedAt: new Date(input.nowMs).toISOString(), proposalSnapshot: proposal(input, decision),
    financeSnapshot: financeSnapshot(input, selected), personSnapshot: personSnapshot(input, request.personId) };
  return { ...decision, capacityResolution: { ...resolution, approvals: [...resolution.approvals, approval] } };
}
export function evaluateCapacityResolution(input: CapacityResolutionInput, id: string,
  request: Pick<CapacityEvaluation, "personId" | "validUntil" | "outcome" | "evidence" | "comparabilityEvidence" | "attributionEvidence">): DecisionRecord {
  const decision = uniqueDecision(input, id);
  const resolution = decision.capacityResolution!;
  const view = buildCapacityResolutions(input).find((entry) => entry.decisionId === id)!;
  const current = source(input, resolution.baseline.personId);
  const milestones = milestoneRecords(input, decision);
  const lastCompletion = Math.max(...milestones.map((action) => Date.parse(action.completionDate)));
  const review = input.people.find((person) => person.id === resolution.baseline.personId)?.availabilityReviews?.at(-1);
  if (!view.implementationComplete || !ready(input, request.personId) || !request.evidence.trim()
    || !request.comparabilityEvidence.trim() || !request.attributionEvidence.trim() || !currentDate(request.validUntil, input.nowMs)
    || !["Unknown", "Improved", "Not improved"].includes(request.outcome)) throw new Error("Outcome review requires approved evidenced implementation, named reviewer, adoption/attribution evidence, comparable scope/window and dated review expiry.");
  if (request.outcome !== "Unknown" && (!current.person?.coverageCurrent || current.person.windowStart !== resolution.baseline.windowStart
    || current.person.windowEnd !== resolution.baseline.windowEnd || Date.parse(review?.recordedAt || "") <= lastCompletion
    || !event(review?.recordedAt || "", input.nowMs) || current.work.some((work) => !work.operationallyReady || !work.assessment
      || Date.parse(work.assessment.recordedAt) <= lastCompletion))) {
    throw new Error("Verified outcomes need fresh post-implementation workload and availability reviews covering the original window; missing or stale evidence remains unknown.");
  }
  if (request.outcome !== "Unknown" && retainedDemandIssues(input, resolution, lastCompletion).length) {
    throw new Error(retainedDemandIssues(input, resolution, lastCompletion).join("; "));
  }
  if (request.outcome === "Improved" && (view.baselineShortfall === null || view.currentShortfall === null
    || view.currentShortfall >= view.baselineShortfall)) throw new Error("Improved requires a strictly lower evidenced shortfall in the original comparable window; completion or removed obligations alone is not success.");
  if (request.outcome === "Not improved" && (view.baselineShortfall === null || view.currentShortfall === null
    || view.currentShortfall < view.baselineShortfall)) throw new Error("Not improved requires a comparable known shortfall that did not reduce.");
  const evaluation = { ...request, recordedAt: new Date(input.nowMs).toISOString(), sourceSnapshot: outcomeSnapshot(input, resolution),
    executionSnapshot: JSON.stringify(milestones), approvalSnapshot: JSON.stringify(resolution.approvals.at(-1)) };
  return { ...decision, capacityResolution: { ...resolution, evaluations: [...resolution.evaluations, evaluation] } };
}
