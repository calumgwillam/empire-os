import type { ActionRecord, DecisionRecord, ProblemRecord } from "./capture-conversions";
import type { LeadRecord } from "./crm";
import { getActionDependencyBlocker, getDelegationReadinessMissingFields, isFounderClassPerson } from "./execution-release";
import { buildLeadDelivery, type DeliveryPerson } from "./lead-delivery";
import type { IncomeRecord } from "./finance";
import { getLeadFollowThroughDate } from "./lead-follow-through";
import type { ProjectRecord } from "./projects";
import { isValidCalendarDateInput } from "./dates";

export type WorkloadAssessment = {
  personId: string; windowStart: string; windowEnd: string; remainingHours: string;
  estimateEvidence: string; readinessEvidence: string; readinessConfirmed: boolean;
  dependencyActionIds: string[]; recordedAt: string; recordedByPersonId: string; validUntil: string; sourceSnapshot: string;
};
export type AvailabilityReview = {
  windowStart: string; windowEnd: string; availableHours: string; evidence: string;
  workloadCoverageComplete: boolean; coverageEvidence: string;
  recordedAt: string; recordedByPersonId: string; validUntil: string; workloadSnapshot: string;
};
export type CapacityPerson = DeliveryPerson & { accessLevel?: string; pillar?: string; availabilityReviews?: AvailabilityReview[] };
export type DeliveryCapacityInput = {
  leads: readonly LeadRecord[]; actions: readonly ActionRecord[]; projects: readonly ProjectRecord[];
  people: readonly CapacityPerson[]; income: readonly IncomeRecord[];
  problems: readonly ProblemRecord[]; decisions: readonly DecisionRecord[]; nowMs: number;
};
export type CapacityWorkItem = {
  objectType: "Lead" | "Action" | "Project"; id: string; title: string; area: string;
  commitment: "Committed" | "Potential"; ownerPersonId: string | null;
  assessment?: WorkloadAssessment; assessmentCurrent: boolean; remainingHours: number | null;
  operationallyReady: boolean; reasons: string[];
};
export type PersonCapacityView = {
  personId: string; name: string; founder: boolean; availabilityCurrent: boolean; coverageCurrent: boolean;
  windowStart: string; windowEnd: string; availableHours: number | null;
  knownCommittedHours: number; unknownCommittedCount: number; committedCount: number; potentialCount: number;
  remainingCapacityHours: number | null; plannedOvercommitment: boolean; reasons: string[];
};
export type CapacityScenario = {
  leadId: string; personId: string | null; state: "Unknown" | "Not ready" | "Planned overcommitment" | "Evidence supports this scenario";
  remainingHoursAfter: number | null; reasons: string[];
};
export type DeliveryCapacityResult = {
  work: CapacityWorkItem[]; people: PersonCapacityView[]; scenarios: CapacityScenario[];
  committedCount: number; potentialCount: number; unownedCommittedCount: number;
};
type WorkloadSource = { objectType: "Lead" | "Action"; id: string };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return object(value) && fields.every((field) => typeof value[field] === "string");
}
export function assertWorkloadAssessments(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.every((entry: unknown) =>
    strings(entry, ["personId", "windowStart", "windowEnd", "remainingHours", "estimateEvidence", "readinessEvidence",
      "recordedAt", "recordedByPersonId", "validUntil", "sourceSnapshot"])
    && typeof entry.readinessConfirmed === "boolean" && Array.isArray(entry.dependencyActionIds)
    && entry.dependencyActionIds.every((id: unknown) => typeof id === "string")
    && period(String(entry.windowStart), String(entry.windowEnd)) && hours(String(entry.remainingHours)) !== null
    && isValidCalendarDateInput(String(entry.validUntil)) && timestamp(String(entry.recordedAt), Infinity)
    && getLeadFollowThroughDate(String(entry.validUntil)) >= Date.parse(String(entry.recordedAt))
    && String(entry.personId).trim() && String(entry.recordedByPersonId).trim() && String(entry.sourceSnapshot).trim()
    && String(entry.estimateEvidence).trim() && (!entry.readinessConfirmed || String(entry.readinessEvidence).trim()))) {
    throw new Error("Workload assessment history is malformed; stored capacity evidence must be preserved.");
  }
}
export function assertAvailabilityReviews(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.every((entry: unknown) =>
    strings(entry, ["windowStart", "windowEnd", "availableHours", "evidence", "coverageEvidence",
      "recordedAt", "recordedByPersonId", "validUntil", "workloadSnapshot"])
    && typeof entry.workloadCoverageComplete === "boolean"
    && period(String(entry.windowStart), String(entry.windowEnd)) && hours(String(entry.availableHours)) !== null
    && isValidCalendarDateInput(String(entry.validUntil)) && timestamp(String(entry.recordedAt), Infinity)
    && getLeadFollowThroughDate(String(entry.validUntil)) >= Date.parse(String(entry.recordedAt))
    && String(entry.recordedByPersonId).trim() && String(entry.workloadSnapshot).trim() && String(entry.evidence).trim()
    && (!entry.workloadCoverageComplete || String(entry.coverageEvidence).trim()))) {
    throw new Error("Person availability review history is malformed; stored capacity evidence must be preserved.");
  }
}
export function assertCapacityRecord(value: unknown, type: "Lead" | "Action" | "Person"): void {
  if (!object(value)) return;
  if (type === "Person") assertAvailabilityReviews(value.availabilityReviews);
  else assertWorkloadAssessments(value.workloadAssessments);
  const hasEvidence = type === "Person" ? value.availabilityReviews !== undefined : value.workloadAssessments !== undefined;
  const fields = type === "Person" ? ["id", "name", "status", "role", "responsibilities", "authority"]
    : type === "Lead" ? ["id", "leadName", "status", "relatedPillar", "serviceRequested", "quoteValue", "finalJobValue"]
      : ["id", "title", "status"];
  if (hasEvidence && fields.some((field) => typeof value[field] !== "string")) throw new Error("Capacity source context is malformed; existing evidence must be preserved.");
}
function hours(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isSafeInteger(Math.round(parsed * 100)) && parsed >= 0 ? parsed : null;
}
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + Math.round(value * 100), 0) / 100;
}
function period(start: string, end: string): boolean {
  return isValidCalendarDateInput(start) && isValidCalendarDateInput(end) && start <= end;
}
function timestamp(value: string, nowMs: number): boolean {
  return value.length > 10 && Number.isFinite(getLeadFollowThroughDate(value)) && Date.parse(value) <= nowMs;
}
function currentDate(recordedAt: string, validUntil: string, nowMs: number): boolean {
  return timestamp(recordedAt, nowMs) && isValidCalendarDateInput(validUntil)
    && getLeadFollowThroughDate(validUntil) >= nowMs && getLeadFollowThroughDate(validUntil) >= Date.parse(recordedAt);
}
function ready(input: DeliveryCapacityInput, id: string): boolean {
  const people = input.people.filter((person) => person.id === id);
  return people.length === 1 && people[0].status === "Active" && Boolean(people[0].name.trim())
    && getDelegationReadinessMissingFields(people[0]).length === 0;
}
function owner(input: DeliveryCapacityInput, name: string, personId?: string): string | null {
  const matches = personId ? input.people.filter((person) => person.id === personId)
    : input.people.filter((person) => person.name.trim().toLowerCase() === name.trim().toLowerCase());
  return matches.length === 1 && ready(input, matches[0].id) ? matches[0].id : null;
}
function supportedActionCompletion(action: ActionRecord, nowMs: number): boolean {
  return action.status === "Completed" && Boolean(action.completionEvidence.trim())
    && timestamp(action.completionDate, nowMs)
    && Date.parse(action.completionDate) >= Date.parse(action.createdAt)
    && (!action.workloadAssessments?.length || Date.parse(action.completionDate) >= Date.parse(action.workloadAssessments.at(-1)!.recordedAt));
}
function activeAction(action: ActionRecord, nowMs: number): boolean {
  return ["Open", "In Progress", "Blocked", "Waiting"].includes(action.status)
    || Boolean(action.workloadAssessments?.length && action.status === "Completed"
      && !supportedActionCompletion(action, nowMs));
}
function activeProject(project: ProjectRecord): boolean {
  return !["completed", "cancelled", "closed", "final", "canceled"].includes(project.status.trim().toLowerCase());
}
function workloadSnapshot(input: DeliveryCapacityInput, source: WorkloadSource): string {
  if (source.objectType === "Lead") {
    const lead = input.leads.find((record) => record.id === source.id);
    const action = input.actions.find((record) => record.id === lead?.deliveryCommitment?.actionId);
    return JSON.stringify(lead ? [lead.id, lead.leadName, lead.serviceRequested, lead.relatedPillar,
      lead.quoteValue, lead.finalJobValue, lead.deliveryCommitment || null,
      action ? [action.id, action.actionTitle, action.description, action.status, action.owner, action.ownerPersonId, action.dueDate,
        action.completionDate, action.completionEvidence, action.relatedDecision, action.relatedProblem] : null] : null);
  }
  const action = input.actions.find((record) => record.id === source.id);
  return JSON.stringify(action ? [action.id, action.title, action.actionTitle, action.description, action.owner, action.ownerPersonId,
    action.status, action.dueDate, action.relatedProblem, action.relatedDecision, action.relatedLeadId, action.relatedPillar,
    action.financeIncomeId, action.financeIncomeRole] : null);
}
function executionDependencyReasons(input: DeliveryCapacityInput, action: ActionRecord): string[] {
  const reasons: string[] = [];
  if (action.relatedProblem && input.problems.filter((problem) => problem.id === action.relatedProblem).length !== 1) {
    reasons.push("Linked Problem dependency is missing or ambiguous");
  }
  if (action.relatedDecision && input.decisions.filter((decision) => decision.id === action.relatedDecision).length !== 1) {
    reasons.push("Linked Decision dependency is missing or ambiguous");
  }
  const blocker = getActionDependencyBlocker(action, input.problems, input.decisions);
  if (blocker) reasons.push(blocker.reason);
  return reasons;
}
function dependencyReasons(input: DeliveryCapacityInput, assessment: WorkloadAssessment, source: WorkloadSource): string[] {
  const reasons: string[] = [];
  if (new Set(assessment.dependencyActionIds).size !== assessment.dependencyActionIds.length) reasons.push("Dependency Action references are duplicated");
  for (const id of assessment.dependencyActionIds) {
    const matches = input.actions.filter((action) => action.id === id);
    const action = matches[0];
    const lead = source.objectType === "Lead" ? input.leads.find((entry) => entry.id === source.id) : undefined;
    if (!id.trim() || (source.objectType === "Action" && id === source.id) || lead?.deliveryCommitment?.actionId === id
      || matches.length !== 1) reasons.push("Dependency Action is missing, self-referential or ambiguous");
    else if (!supportedActionCompletion(action, input.nowMs)) {
      reasons.push(`Dependency unresolved: ${action.actionTitle || action.title} (${action.status}); completion needs dated evidence`);
    }
  }
  const root = source.objectType === "Action" ? source.id
    : input.leads.find((lead) => lead.id === source.id)?.deliveryCommitment?.actionId;
  const visiting = new Set(root ? [root] : []);
  const visited = new Set<string>();
  const stack = assessment.dependencyActionIds.map((id) => ({ id, exit: false }));
  while (stack.length) {
    const next = stack.pop()!;
    if (next.exit) { visiting.delete(next.id); visited.add(next.id); continue; }
    if (visiting.has(next.id)) { reasons.push("Dependency Action cycle must be reconciled"); continue; }
    if (visited.has(next.id)) continue;
    const matches = input.actions.filter((action) => action.id === next.id);
    if (matches.length !== 1) { reasons.push("Dependency Action is missing or ambiguous in its prerequisite chain"); continue; }
    const action = matches[0];
    if (action.deliveryLeadId && !buildLeadDelivery(input).some((view) => view.leadId === action.deliveryLeadId && view.completionSupported)) {
      reasons.push(`Dependency unresolved: Customer delivery prerequisite ${action.title} lacks supported completion`);
    }
    if (!supportedActionCompletion(action, input.nowMs)) {
      reasons.push(`Dependency unresolved: ${action.actionTitle || action.title} (${action.status}); completion needs dated evidence`);
    }
    executionDependencyReasons(input, action).forEach((reason) => reasons.push(`Dependency unresolved: ${reason}`));
    const prerequisites = action.workloadAssessments?.at(-1)?.dependencyActionIds || [];
    if (new Set(prerequisites).size !== prerequisites.length) reasons.push("Dependency Action references are duplicated in its prerequisite chain");
    visiting.add(next.id);
    stack.push({ id: next.id, exit: true }, ...prerequisites.map((id) => ({ id, exit: false })));
  }
  return [...new Set(reasons)];
}
function assessmentCurrent(input: DeliveryCapacityInput, source: WorkloadSource, assessment: WorkloadAssessment | undefined): boolean {
  return Boolean(assessment && period(assessment.windowStart, assessment.windowEnd) && hours(assessment.remainingHours) !== null
    && assessment.estimateEvidence.trim() && ready(input, assessment.personId) && ready(input, assessment.recordedByPersonId)
    && currentDate(assessment.recordedAt, assessment.validUntil, input.nowMs)
    && assessment.sourceSnapshot === workloadSnapshot(input, source)
    && assessment.windowStart >= new Date(input.nowMs).toISOString().slice(0, 10)
    && getLeadFollowThroughDate(assessment.windowEnd) >= input.nowMs);
}
function coverageSnapshot(input: DeliveryCapacityInput, personId: string): string {
  const sort = <T extends { id: string }>(records: readonly T[]) => [...records].sort((a, b) => a.id.localeCompare(b.id));
  // Potential jobs are scenarios, not existing obligations; acceptance makes coverage stale.
  return JSON.stringify({
    person: input.people.filter((person) => person.id === personId).map((person) => [person.id, person.name, person.role, person.status, person.responsibilities, person.authority]),
    leads: sort(input.leads.filter((lead) => lead.deliveryCommitment && (lead.deliveryCommitment.assignedPersonId === personId
      || input.actions.some((action) => action.id === lead.deliveryCommitment?.actionId && action.ownerPersonId === personId)))
      .map((lead) => ({ id: lead.id, commitment: lead.deliveryCommitment, status: lead.status, archived: lead.archived,
        assessment: lead.workloadAssessments?.at(-1), source: workloadSnapshot(input, { objectType: "Lead", id: lead.id }) }))),
    actions: sort(input.actions.filter((action) => activeAction(action, input.nowMs) && owner(input, action.owner, action.ownerPersonId) === personId)
      .map((action) => ({ id: action.id, status: action.status, completionDate: action.completionDate, completionEvidence: action.completionEvidence,
        assessment: action.workloadAssessments?.at(-1), source: workloadSnapshot(input, { objectType: "Action", id: action.id }) }))),
    projects: sort(input.projects.filter((project) => activeProject(project) && owner(input, project.owner) === personId)),
  });
}
export function buildDeliveryCapacity(input: DeliveryCapacityInput): DeliveryCapacityResult {
  if (!Number.isFinite(input.nowMs) || !Number.isFinite(new Date(input.nowMs).getTime())) throw new Error("Delivery capacity requires a valid explicit clock.");
  input.leads.forEach((lead) => assertCapacityRecord(lead, "Lead"));
  input.actions.forEach((action) => assertCapacityRecord(action, "Action"));
  input.people.forEach((person) => assertCapacityRecord(person, "Person"));
  const delivery = buildLeadDelivery({ ...input });
  const work: CapacityWorkItem[] = [];
  const claimedActions = new Set<string>();
  for (const lead of input.leads) {
    const committed = Boolean(lead.deliveryCommitment || lead.status === "Won");
    const view = delivery.find((entry) => entry.leadId === lead.id);
    if (lead.deliveryCommitment) claimedActions.add(lead.deliveryCommitment.actionId);
    if (view?.completionSupported || (!committed && (lead.archived || ["Lost"].includes(lead.status)))) continue;
    const assessment = lead.workloadAssessments?.at(-1);
    const source = { objectType: "Lead" as const, id: lead.id };
    const current = assessmentCurrent(input, source, assessment) && input.leads.filter((record) => record.id === lead.id).length === 1;
    const matches = input.actions.filter((action) => action.id === lead.deliveryCommitment?.actionId);
    const assignedId = lead.deliveryCommitment ? owner(input, matches[0]?.owner || "", matches[0]?.ownerPersonId) : null;
    const personId = committed ? view?.executionLinked && view.assigned ? assignedId : null
      : assessment && ready(input, assessment.personId) ? assessment.personId : null;
    const reasons: string[] = [];
    if (committed && !personId) reasons.push("CAPACITY: Committed customer work has no uniquely linked delegation-ready delivery owner");
    if (committed && !view?.scheduled) reasons.push("CAPACITY: Customer delivery scheduling accountability is incomplete");
    if (lead.status === "Won" && !lead.deliveryCommitment) reasons.push("CAPACITY: Won customer work lacks explicit acceptance and delivery accountability");
    if (!current || assessment?.personId !== personId) reasons.push("CAPACITY: Remaining workload, estimate basis or proposed/actual owner is unknown or stale");
    if (assessment) dependencyReasons(input, assessment, source).forEach((reason) => reasons.push(`CAPACITY: ${reason}`));
    const host = matches.length === 1 ? matches[0] : undefined;
    if (host) executionDependencyReasons(input, host).forEach((reason) => reasons.push(`CAPACITY: ${reason}`));
    if (host?.status === "Blocked" || host?.status === "Waiting" || host?.status === "Cancelled" || (host?.status === "Completed" && !view?.completionSupported)) reasons.push("CAPACITY: Delivery execution is blocked, waiting, cancelled or completion is unsupported");
    if (host?.workloadAssessments?.length) reasons.push("CAPACITY: Delivery hours are assessed on the Lead; its Action assessment must not be counted again");
    const sized = current && assessment?.personId === personId;
    const promised = lead.deliveryCommitment?.promisedBy;
    if (assessment && promised && getLeadFollowThroughDate(assessment.windowEnd) > getLeadFollowThroughDate(promised)) reasons.push("CAPACITY: Workload window exceeds the customer delivery deadline");
    if (!assessment?.readinessConfirmed || !assessment.readinessEvidence.trim()) reasons.push("CAPACITY: Timing, resources, access, skills and commercial/service-quality readiness are not evidenced");
    work.push({ objectType: "Lead", id: lead.id, title: lead.leadName, area: lead.relatedPillar,
      commitment: committed ? "Committed" : "Potential", ownerPersonId: personId, assessment, assessmentCurrent: Boolean(sized),
      remainingHours: sized ? hours(assessment!.remainingHours) : null, operationallyReady: reasons.length === 0, reasons });
  }
  for (const action of input.actions) {
    if (!activeAction(action, input.nowMs) || claimedActions.has(action.id)) continue;
    const assessment = action.workloadAssessments?.at(-1);
    const source = { objectType: "Action" as const, id: action.id };
    const personId = owner(input, action.owner, action.ownerPersonId);
    const current = assessmentCurrent(input, source, assessment) && assessment?.personId === personId
      && input.actions.filter((entry) => entry.id === action.id).length === 1 && !action.deliveryLeadId;
    const reasons: string[] = [];
    if (!personId) reasons.push("CAPACITY: Active Action has no unique delegation-ready owner");
    if (!current) reasons.push("CAPACITY: Active Action remaining-work assessment is missing, stale or mismatched");
    if (action.deliveryLeadId) reasons.push("CAPACITY: Delivery Action has an orphaned customer job; reconcile its commitment before sizing capacity");
    if (assessment) dependencyReasons(input, assessment, source).forEach((reason) => reasons.push(`CAPACITY: ${reason}`));
    executionDependencyReasons(input, action).forEach((reason) => reasons.push(`CAPACITY: ${reason}`));
    if (action.status === "Blocked" || action.status === "Waiting") reasons.push("CAPACITY: Action execution is blocked or waiting");
    if (action.status === "Completed") reasons.push("CAPACITY: Assessed Action completion is unsupported; remaining work must not silently disappear");
    if (assessment && action.dueDate && getLeadFollowThroughDate(assessment.windowEnd) > getLeadFollowThroughDate(action.dueDate)) reasons.push("CAPACITY: Workload window extends beyond the Action deadline");
    if (!assessment?.readinessConfirmed || !assessment.readinessEvidence.trim()) reasons.push("CAPACITY: Operational readiness for this Action is not evidenced");
    work.push({ objectType: "Action", id: action.id, title: action.actionTitle || action.title, area: action.relatedPillar,
      commitment: "Committed", ownerPersonId: personId, assessment, assessmentCurrent: Boolean(current),
      remainingHours: current ? hours(assessment!.remainingHours) : null, operationallyReady: reasons.length === 0, reasons });
  }
  for (const project of input.projects.filter(activeProject)) {
    const linked = project.relatedActionIds || [];
    if (linked.length && new Set(linked).size === linked.length
      && input.projects.filter((entry) => entry.id === project.id).length === 1
      && linked.every((id) => input.actions.filter((action) => action.id === id).length === 1)
      && linked.some((id) => work.some((item) => item.objectType === "Action" && item.id === id)
        || input.leads.some((lead) => lead.deliveryCommitment?.actionId === id
          && work.some((item) => item.objectType === "Lead" && item.id === lead.id && item.commitment === "Committed")))) continue;
    work.push({ objectType: "Project", id: project.id, title: project.projectName, area: project.area, commitment: "Committed",
      ownerPersonId: owner(input, project.owner), assessmentCurrent: false, remainingHours: null, operationallyReady: false,
      reasons: ["CAPACITY: Active Project has no unambiguous remaining execution Actions; link/size ordinary Actions instead of counting a project twice"] });
  }
  const people = input.people.filter((person) => person.status === "Active").map((person): PersonCapacityView => {
    const review = person.availabilityReviews?.at(-1);
    const availabilityCurrent = Boolean(review && ready(input, person.id) && ready(input, review.recordedByPersonId)
      && input.people.filter((entry) => entry.id === person.id).length === 1
      && period(review.windowStart, review.windowEnd) && hours(review.availableHours) !== null && review.evidence.trim()
      && review.windowStart >= new Date(input.nowMs).toISOString().slice(0, 10)
      && currentDate(review.recordedAt, review.validUntil, input.nowMs) && getLeadFollowThroughDate(review.windowEnd) >= input.nowMs);
    const assigned = work.filter((item) => item.commitment === "Committed" && item.ownerPersonId === person.id);
    const relevant = assigned.filter((item) => !review || !item.assessmentCurrent || !item.assessment
      || !(item.assessment.windowEnd < review.windowStart || item.assessment.windowStart > review.windowEnd));
    const sized = relevant.filter((item) => item.assessmentCurrent && item.assessment && review
      && item.assessment.windowStart >= review.windowStart && item.assessment.windowEnd <= review.windowEnd);
    const knownCommittedHours = sum(sized.map((item) => item.remainingHours!));
    const unknownCommittedCount = relevant.length - sized.length;
    const availableHours = availabilityCurrent ? hours(review!.availableHours) : null;
    const plannedOvercommitment = availableHours !== null && knownCommittedHours > availableHours;
    const coverageCurrent = Boolean(availabilityCurrent && review?.workloadCoverageComplete && review.coverageEvidence.trim()
      && review.workloadSnapshot === coverageSnapshot(input, person.id) && unknownCommittedCount === 0);
    const reasons: string[] = [];
    if (!availabilityCurrent && (assigned.length || review)) reasons.push("CAPACITY: Availability is unknown, expired or lacks dated attributable evidence");
    if (relevant.some((item) => !item.operationallyReady)) reasons.push("CAPACITY: Existing committed execution readiness has unresolved gaps; aggregate hours alone cannot establish readiness");
    if (availabilityCurrent && !coverageCurrent) reasons.push("CAPACITY: Full competing-workload coverage is unknown or stale; spare hours cannot be confirmed");
    if (plannedOvercommitment) reasons.push("CAPACITY: Evidenced planned committed hours exceed recorded available hours; protect customer commitments before adding work");
    const founder = isFounderClassPerson({ role: person.role, accessLevel: person.accessLevel });
    if (founder && assigned.some((item) => item.objectType === "Lead")) reasons.push("CAPACITY: Customer delivery depends on founder capacity; review supported delegation and founder absence resilience");
    return { personId: person.id, name: person.name, founder, availabilityCurrent, coverageCurrent,
      windowStart: review?.windowStart || "", windowEnd: review?.windowEnd || "", availableHours, knownCommittedHours,
      unknownCommittedCount, committedCount: assigned.length, potentialCount: work.filter((item) => item.commitment === "Potential" && item.ownerPersonId === person.id).length,
      remainingCapacityHours: coverageCurrent && availableHours !== null ? sum([availableHours, -knownCommittedHours]) : null,
      plannedOvercommitment, reasons };
  });
  const scenarios = work.filter((item) => item.objectType === "Lead" && item.commitment === "Potential").map((item): CapacityScenario => {
    const person = people.find((entry) => entry.personId === item.ownerPersonId);
    const reasons = [...item.reasons];
    const contained = Boolean(item.assessment && person && item.assessment.windowStart >= person.windowStart && item.assessment.windowEnd <= person.windowEnd);
    const remainingHoursAfter = person?.remainingCapacityHours !== null && person?.remainingCapacityHours !== undefined
      && item.remainingHours !== null && contained ? sum([person.remainingCapacityHours, -item.remainingHours]) : null;
    const knownHoursAfter = person?.availableHours !== null && person?.availableHours !== undefined
      && item.remainingHours !== null && contained ? sum([person.availableHours, -person.knownCommittedHours, -item.remainingHours]) : null;
    let state: CapacityScenario["state"] = "Unknown";
    const committedReady = !work.some((entry) => entry.commitment === "Committed" && entry.ownerPersonId === item.ownerPersonId
      && !entry.operationallyReady && (!entry.assessmentCurrent || !entry.assessment || !person
        || !(entry.assessment.windowEnd < person.windowStart || entry.assessment.windowStart > person.windowEnd)));
    if (knownHoursAfter !== null && knownHoursAfter < 0) {
      state = "Planned overcommitment";
      reasons.push("CAPACITY: Known committed demand plus this potential job exceeds evidenced availability; incomplete coverage can only add uncertainty/demand");
    } else if (item.assessmentCurrent && !item.operationallyReady) state = "Not ready";
    else if (remainingHoursAfter !== null && committedReady && !work.some((entry) => entry.commitment === "Committed"
      && !entry.ownerPersonId && entry.area === item.area)) state = "Evidence supports this scenario";
    if (!committedReady) reasons.push("CAPACITY: Existing committed execution is not operationally ready in this window");
    if (work.some((entry) => entry.commitment === "Committed" && !entry.ownerPersonId && entry.area === item.area)) {
      reasons.push("CAPACITY: Unowned commitments in this area may compete for the proposed capacity; resolve responsibility first");
    }
    if (!contained || !person?.coverageCurrent) reasons.push("CAPACITY: Proposed job has no matching current availability window with complete competing-workload coverage");
    return { leadId: item.id, personId: item.ownerPersonId, state, remainingHoursAfter, reasons };
  });
  return { work, people, scenarios, committedCount: work.filter((item) => item.commitment === "Committed").length,
    potentialCount: scenarios.length, unownedCommittedCount: work.filter((item) => item.commitment === "Committed" && !item.ownerPersonId).length };
}

export function recordWorkloadAssessment(input: DeliveryCapacityInput, source: WorkloadSource,
  request: Omit<WorkloadAssessment, "recordedAt" | "sourceSnapshot">): LeadRecord | ActionRecord {
  const result = buildDeliveryCapacity(input);
  const records = source.objectType === "Lead" ? input.leads : input.actions;
  const matches = records.filter((record) => record.id === source.id);
  const work = result.work.find((item) => item.id === source.id && item.objectType === source.objectType);
  if (matches.length !== 1 || !work) throw new Error("Select a unique unfinished Lead/Action for remaining workload review. Delivery hours belong on its Lead.");
  if (!ready(input, request.personId) || !ready(input, request.recordedByPersonId)) throw new Error("Workload sizing requires delegation-ready proposed/actual ownership and reviewer attribution.");
  if (work.commitment === "Committed" && request.personId !== work.ownerPersonId) throw new Error("Use the existing delivery/Action delegation workflow first; sizing cannot assign or replace accountable ownership.");
  if (!period(request.windowStart, request.windowEnd) || request.windowStart < new Date(input.nowMs).toISOString().slice(0, 10)
    || getLeadFollowThroughDate(request.windowEnd) < input.nowMs
    || hours(request.remainingHours) === null || !request.estimateEvidence.trim()
    || !isValidCalendarDateInput(request.validUntil) || getLeadFollowThroughDate(request.validUntil) < input.nowMs) {
    throw new Error("Record a valid remaining-work window, non-negative precise hours, dated estimate basis and a current review expiry.");
  }
  if (request.readinessConfirmed && !request.readinessEvidence.trim()) throw new Error("Confirmed readiness requires timing, access, resources, skills, quality and commercial evidence.");
  const assessment: WorkloadAssessment = { ...request, recordedAt: new Date(input.nowMs).toISOString(), sourceSnapshot: workloadSnapshot(input, source) };
  assertWorkloadAssessments([assessment]);
  const dependencyErrors = dependencyReasons(input, assessment, source).filter((reason) => !reason.startsWith("Dependency unresolved:"));
  if (dependencyErrors.length) throw new Error(dependencyErrors.join("; "));
  return { ...matches[0], workloadAssessments: [...(matches[0].workloadAssessments || []), assessment] };
}
export function recordAvailabilityReview(input: DeliveryCapacityInput, personId: string,
  request: Omit<AvailabilityReview, "recordedAt" | "workloadSnapshot">): CapacityPerson {
  buildDeliveryCapacity(input);
  const matches = input.people.filter((person) => person.id === personId);
  if (matches.length !== 1 || !ready(input, personId) || !ready(input, request.recordedByPersonId)) throw new Error("Availability review requires a unique active delegation-ready Person and reviewer.");
  if (!period(request.windowStart, request.windowEnd) || request.windowStart < new Date(input.nowMs).toISOString().slice(0, 10)
    || getLeadFollowThroughDate(request.windowEnd) < input.nowMs
    || hours(request.availableHours) === null || !request.evidence.trim()
    || !isValidCalendarDateInput(request.validUntil) || getLeadFollowThroughDate(request.validUntil) < input.nowMs) throw new Error("Record genuine available working hours, a valid future/current window, supporting evidence and review expiry.");
  if (request.workloadCoverageComplete && !request.coverageEvidence.trim()) throw new Error("Full coverage requires evidence of all competing workload and untracked/routine work accounted for in availability.");
  const review: AvailabilityReview = { ...request, recordedAt: new Date(input.nowMs).toISOString(), workloadSnapshot: coverageSnapshot(input, personId) };
  assertAvailabilityReviews([review]);
  return { ...matches[0], availabilityReviews: [...(matches[0].availabilityReviews || []), review] };
}
