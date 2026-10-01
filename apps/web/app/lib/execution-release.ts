export type DelegationPersonInput = {
  id: string;
  name: string;
  role: string;
  accessLevel?: string;
  status: string;
  responsibilities: string;
  authority: string;
  pillar: string;
};

export type DelegationReadiness<T extends DelegationPersonInput = DelegationPersonInput> = {
  primaryFounder: T | null;
  activeOperationalPeople: T[];
  readyPeople: T[];
  readinessGapPeople: T[];
  teamReadinessGapPeople: T[];
  cofounderReadinessGapPeople: T[];
};

export type CapacityPersonInput = Pick<DelegationPersonInput, "id" | "name" | "pillar">;
export type CapacityFacts = { personId: string; carriedCount: number; attentionCount: number };
export type CapacityRankedPerson = CapacityPersonInput & { carriedCount: number; attentionCount: number };

export type FounderOwnedRecord = { owner?: string; ownerPersonId?: string };

export function getDelegationReadinessMissingFields(person: Pick<DelegationPersonInput, "role" | "responsibilities" | "authority">): string[] {
  const missing: string[] = [];
  if (person.role.trim() === "") missing.push("role");
  if (person.responsibilities.trim() === "") missing.push("responsibilities");
  if (person.authority.trim() === "") missing.push("authority");
  return missing;
}

export function isFounderClassPerson(person: Pick<DelegationPersonInput, "accessLevel" | "role">): boolean {
  return person.accessLevel === "Founder" || /\bco[- ]?founder\b/i.test(person.role);
}

export function selectPrimaryFounder<T extends DelegationPersonInput>(orderedPeople: readonly T[]): T | null {
  const activeFounderAccessPeople = orderedPeople.filter((person) => person.accessLevel === "Founder" && person.status === "Active");
  return activeFounderAccessPeople.find((person) => person.role.trim().toLowerCase() === "founder")
    || activeFounderAccessPeople[0]
    || null;
}

export function assessDelegationReadiness<T extends DelegationPersonInput>(orderedPeople: readonly T[]): DelegationReadiness<T> {
  const primaryFounder = selectPrimaryFounder(orderedPeople);
  const activeOperationalPeople = orderedPeople.filter((person) => person.status === "Active" && person.id !== primaryFounder?.id);
  const readyPeople = activeOperationalPeople.filter((person) => getDelegationReadinessMissingFields(person).length === 0);
  const readinessGapPeople = activeOperationalPeople.filter((person) => !readyPeople.some((readyPerson) => readyPerson.id === person.id));
  return {
    primaryFounder,
    activeOperationalPeople,
    readyPeople,
    readinessGapPeople,
    teamReadinessGapPeople: readinessGapPeople.filter((person) => !isFounderClassPerson(person)),
    cofounderReadinessGapPeople: orderedPeople.filter((person) => person.status === "Active" && isFounderClassPerson(person) && person.id !== primaryFounder?.id && getDelegationReadinessMissingFields(person).length > 0),
  };
}

export function resolveActiveOwnerKey(
  people: readonly Pick<DelegationPersonInput, "id" | "name" | "status">[],
  ownerText: string | undefined,
  ownerPersonId?: string,
): string | null {
  if (ownerPersonId) {
    const owner = people.find((person) => person.id === ownerPersonId && person.status === "Active");
    if (owner) return owner.name.trim().toLowerCase();
  }

  const text = (ownerText || "").trim();
  if (!text || text.toLowerCase() === "unassigned") return null;
  const matched = people.find((person) => person.status === "Active" && person.name.trim().toLowerCase() === text.toLowerCase());
  return matched ? matched.name.trim().toLowerCase() : null;
}

export function isFounderOwned(
  founder: Pick<DelegationPersonInput, "name"> | null,
  people: readonly Pick<DelegationPersonInput, "id" | "name" | "status">[],
  record: FounderOwnedRecord,
): boolean {
  const founderOwnerKey = founder?.name.trim().toLowerCase() || null;
  return founderOwnerKey !== null && resolveActiveOwnerKey(people, record.owner, record.ownerPersonId) === founderOwnerKey;
}

export function getDelegationReadyPeopleForArea<T extends CapacityPersonInput>(area: string, readyPeople: readonly T[]): T[] {
  const normalisedArea = area.trim().toLowerCase();
  if (!normalisedArea || normalisedArea === "unassigned") return [];
  return readyPeople.filter((person) => person.pillar.trim().toLowerCase() === normalisedArea);
}

export function rankDelegationPeopleForArea<T extends CapacityPersonInput>(
  area: string,
  readyPeople: readonly T[],
  capacityFacts: readonly CapacityFacts[],
): CapacityRankedPerson[] {
  return getDelegationReadyPeopleForArea(area, readyPeople)
    .map((person) => {
      const summary = capacityFacts.find((entry) => entry.personId === person.id);
      return {
        id: person.id,
        name: person.name,
        pillar: person.pillar,
        carriedCount: summary?.carriedCount ?? 0,
        attentionCount: summary?.attentionCount ?? 0,
      };
    })
    .sort((left, right) =>
      left.attentionCount - right.attentionCount
      || left.carriedCount - right.carriedCount
      || left.name.localeCompare(right.name),
    );
}

export type HandoffObjectType = "Action" | "Project" | "Lead" | "Problem";
export type HandoffStatus = "Healthy" | "At risk" | "Completed" | "Cancelled";
export type HandoffState = HandoffStatus | "Returned to Founder" | "Ownership changed" | "Source missing";
export type HandoffReviewState = "Healthy" | "Review due" | "At risk" | "Intervention required" | "Completed" | "Cancelled";
export type HandoffReviewDecision = "Continue" | "Support / adjust" | "Escalate" | "Complete" | "Cancel";

export type HandoffInput = {
  id: string;
  objectType: HandoffObjectType;
  objectId: string;
  title: string;
  newOwner: string;
  newOwnerPersonId?: string;
  transferredAt: string;
  reviewDate?: string;
  status?: HandoffStatus;
  lastReviewDecision?: HandoffReviewDecision;
};

export type HandoffSourceInput =
  | { objectType: "Action"; id: string; owner: string; ownerPersonId?: string; status: string; dueDate?: string }
  | { objectType: "Project"; id: string; owner: string; status: string; targetCompletionDate?: string }
  | { objectType: "Lead"; id: string; owner: string; status: string; followUpDate?: string }
  | { objectType: "Problem"; id: string; owner: string; problemStatus: string; severity: string };

export type HandoffFollowThroughItem<T extends HandoffInput = HandoffInput> = T & {
  state: HandoffState;
  reviewState: HandoffReviewState;
  reviewReasons: string[];
  needsFounderIntervention: boolean;
  currentOwner: string;
  currentStatus: string;
};

export type HandoffFollowThroughSummary<T extends HandoffInput = HandoffInput> = {
  items: HandoffFollowThroughItem<T>[];
  healthy: number;
  atRisk: number;
  completed: number;
  cancelled: number;
  reviewDue: number;
  interventionRequired: number;
  returnedToFounder: number;
  ownershipChanged: number;
  sourceMissing: number;
};

function getActionOwnerDisplay(
  action: Extract<HandoffSourceInput, { objectType: "Action" }>,
  people: readonly Pick<DelegationPersonInput, "id" | "name" | "status">[],
): string {
  const activePerson = action.ownerPersonId
    ? people.find((person) => person.id === action.ownerPersonId && person.status === "Active")
    : null;
  if (activePerson) return activePerson.name;
  if (action.owner && action.owner.trim()) return action.owner.trim();
  return "Unassigned";
}

function handoffSourceFor(handoff: HandoffInput, sources: readonly HandoffSourceInput[]): HandoffSourceInput | undefined {
  return sources.find((source) => source.objectType === handoff.objectType && source.id === handoff.objectId);
}

export function selectLatestHandoffIdByObject(handoffs: readonly HandoffInput[]): Map<string, string> {
  const latestHandoffIdByObject = new Map<string, string>();
  handoffs
    .slice()
    .sort((left, right) => new Date(right.transferredAt).getTime() - new Date(left.transferredAt).getTime())
    .forEach((handoff) => {
      const key = `${handoff.objectType}:${handoff.objectId}`;
      if (!latestHandoffIdByObject.has(key)) latestHandoffIdByObject.set(key, handoff.id);
    });
  return latestHandoffIdByObject;
}

export function deriveDelegationHandoffFollowThrough<T extends HandoffInput>(
  handoffs: readonly T[],
  sources: readonly HandoffSourceInput[],
  people: readonly Pick<DelegationPersonInput, "id" | "name" | "status">[],
  founder: Pick<DelegationPersonInput, "name"> | null,
  nowMs = Date.now(),
  ownerResolutionPeople: readonly Pick<DelegationPersonInput, "id" | "name" | "status">[] = people,
): HandoffFollowThroughSummary<T> {
  const todayStartMs = new Date(nowMs).setHours(0, 0, 0, 0);
  const latestHandoffIdByObject = selectLatestHandoffIdByObject(handoffs);

  const items = handoffs.map((handoff) => {
    const source = handoffSourceFor(handoff, sources);
    const isLatestHandoff = latestHandoffIdByObject.get(`${handoff.objectType}:${handoff.objectId}`) === handoff.id;
    let currentOwner = "Unassigned";
    let currentStatus = "Source missing";
    let sourceExists = false;
    let isCompleted = false;
    let isAtRisk = false;
    let isCurrentFounderOwned = false;
    let sourceIsBlocked = false;
    let sourceIsOverdue = false;

    if (source?.objectType === "Action") {
      sourceExists = true;
      currentOwner = getActionOwnerDisplay(source, people);
      currentStatus = source.status;
      isCompleted = source.status === "Completed";
      sourceIsBlocked = source.status === "Blocked";
      sourceIsOverdue = source.status !== "Waiting" && source.status !== "Cancelled" && Boolean(source.dueDate) && new Date(source.dueDate!).getTime() < todayStartMs;
      isAtRisk = source.status !== "Waiting" && source.status !== "Cancelled"
        && (source.status === "Blocked" || (Boolean(source.dueDate) && new Date(source.dueDate!).getTime() < nowMs));
      isCurrentFounderOwned = isFounderOwned(founder, ownerResolutionPeople, source);
    } else if (source?.objectType === "Project") {
      const normalisedStatus = source.status.trim().toLowerCase();
      sourceExists = true;
      currentOwner = source.owner || "Unassigned";
      currentStatus = source.status || "No status";
      isCompleted = ["completed", "closed", "final"].includes(normalisedStatus);
      sourceIsBlocked = normalisedStatus === "blocked";
      sourceIsOverdue = !["cancelled", "canceled"].includes(normalisedStatus) && Boolean(source.targetCompletionDate) && new Date(`${source.targetCompletionDate}T00:00:00`).getTime() < todayStartMs;
      isAtRisk = !["cancelled", "canceled"].includes(normalisedStatus)
        && (normalisedStatus === "blocked" || (Boolean(source.targetCompletionDate) && new Date(source.targetCompletionDate!).getTime() < nowMs));
      isCurrentFounderOwned = isFounderOwned(founder, ownerResolutionPeople, source);
    } else if (source?.objectType === "Lead") {
      sourceExists = true;
      currentOwner = source.owner || "Unassigned";
      currentStatus = source.status;
      isCompleted = source.status === "Won" || source.status === "Lost";
      sourceIsOverdue = Boolean(source.followUpDate) && new Date(source.followUpDate!).getTime() < todayStartMs;
      isAtRisk = (source.status === "Quote Sent" && !source.followUpDate)
        || (Boolean(source.followUpDate) && new Date(source.followUpDate!).getTime() < nowMs);
      isCurrentFounderOwned = isFounderOwned(founder, ownerResolutionPeople, source);
    } else if (source?.objectType === "Problem") {
      sourceExists = true;
      currentOwner = source.owner || "Unassigned";
      currentStatus = source.problemStatus;
      isCompleted = source.problemStatus === "Resolved" || source.problemStatus === "Closed";
      sourceIsBlocked = source.problemStatus === "Action required";
      isAtRisk = source.severity === "High" || source.severity === "Critical";
      isCurrentFounderOwned = isFounderOwned(founder, ownerResolutionPeople, source);
    }

    let state: HandoffState = "Healthy";
    if (!isLatestHandoff) {
      state = "Ownership changed";
    } else if (!sourceExists) {
      state = "Source missing";
    } else if (currentOwner.trim().toLowerCase() !== handoff.newOwner.trim().toLowerCase()) {
      state = isCurrentFounderOwned ? "Returned to Founder" : "Ownership changed";
    } else if (handoff.status === "Completed" || handoff.status === "Cancelled") {
      state = handoff.status;
    } else if (isCompleted) {
      state = "Completed";
    } else if (
      (handoff.objectType === "Action" && currentStatus === "Cancelled")
      || (handoff.objectType === "Project" && ["cancelled", "canceled"].includes(currentStatus.trim().toLowerCase()))
    ) {
      state = "Cancelled";
    } else if (handoff.status === "At risk") {
      state = "At risk";
    } else if (handoff.status === "Healthy") {
      state = "Healthy";
    } else if (handoff.reviewDate && new Date(`${handoff.reviewDate.slice(0, 10)}T00:00:00`).getTime() < todayStartMs) {
      state = "At risk";
    } else if (isAtRisk) {
      state = "At risk";
    } else {
      state = "Healthy";
    }

    const recipient = ownerResolutionPeople.find((person) => person.id === handoff.newOwnerPersonId);
    const recipientInactive = Boolean(recipient && recipient.status !== "Active");
    const reviewDateMs = handoff.reviewDate ? new Date(`${handoff.reviewDate.slice(0, 10)}T00:00:00`).getTime() : 0;
    const reviewDue = Boolean(reviewDateMs && !Number.isNaN(reviewDateMs) && reviewDateMs <= todayStartMs);
    const ownerMismatch = sourceExists && currentOwner.trim().toLowerCase() !== handoff.newOwner.trim().toLowerCase();
    const reviewReasons = [
      !sourceExists ? "Linked work record is missing" : null,
      ownerMismatch ? `Current owner is ${currentOwner}` : null,
      recipientInactive ? `${handoff.newOwner} is inactive` : null,
      handoff.lastReviewDecision === "Escalate" ? "Review decision escalated this handoff" : null,
      sourceIsBlocked ? "Linked work is blocked" : null,
      sourceIsOverdue ? "Linked work is overdue" : null,
      handoff.status === "At risk" ? "Handoff is explicitly marked at risk" : null,
      reviewDue && state !== "Completed" && state !== "Cancelled" ? `Review date reached (${handoff.reviewDate})` : null,
    ].filter((reason): reason is string => Boolean(reason));

    let reviewState: HandoffReviewState = "Healthy";
    if (state === "Completed") {
      reviewState = "Completed";
    } else if (state === "Cancelled") {
      reviewState = "Cancelled";
    } else if (!sourceExists || ownerMismatch || recipientInactive || handoff.lastReviewDecision === "Escalate" || sourceIsBlocked) {
      reviewState = "Intervention required";
    } else if (sourceIsOverdue || handoff.status === "At risk") {
      reviewState = "At risk";
    } else if (reviewDue) {
      reviewState = "Review due";
    }

    return {
      ...handoff,
      state,
      reviewState,
      reviewReasons,
      needsFounderIntervention: reviewState === "Intervention required",
      currentOwner,
      currentStatus,
    };
  }).sort((left, right) => new Date(right.transferredAt).getTime() - new Date(left.transferredAt).getTime());

  return {
    items,
    healthy: items.filter((item) => item.state === "Healthy").length,
    atRisk: items.filter((item) => item.state === "At risk").length,
    completed: items.filter((item) => item.state === "Completed").length,
    cancelled: items.filter((item) => item.state === "Cancelled").length,
    reviewDue: items.filter((item) => item.reviewState === "Review due").length,
    interventionRequired: items.filter((item) => item.reviewState === "Intervention required").length,
    returnedToFounder: items.filter((item) => item.state === "Returned to Founder").length,
    ownershipChanged: items.filter((item) => item.state === "Ownership changed").length,
    sourceMissing: items.filter((item) => item.state === "Source missing").length,
  };
}

export type DependencyProblemInput = { id: string; title: string; problemStatement?: string; problemStatus: string };
export type DependencyDecisionInput = { id: string; title: string; decisionTitle?: string; decisionStatus: string };
export type ActionDependencyInput = { relatedProblem?: string; relatedDecision?: string };
export type ActionDependencyBlocker = { objectType: "Problem" | "Decision"; id: string; reason: string; label: string };

export function getActionDependencyBlocker(
  action: ActionDependencyInput,
  problems: readonly DependencyProblemInput[],
  decisions: readonly DependencyDecisionInput[],
): ActionDependencyBlocker | null {
  const relatedProblem = problems.find((problem) => problem.id === action.relatedProblem);
  if (relatedProblem && ["Open", "Investigating", "Action required"].includes(relatedProblem.problemStatus)) {
    return {
      objectType: "Problem",
      id: relatedProblem.id,
      reason: `BLOCKED BY PROBLEM: ${relatedProblem.problemStatement || relatedProblem.title}`,
      label: "Open blocker",
    };
  }

  const relatedDecision = decisions.find((decision) => decision.id === action.relatedDecision);
  if (relatedDecision && ["Draft", "Under Review"].includes(relatedDecision.decisionStatus)) {
    return {
      objectType: "Decision",
      id: relatedDecision.id,
      reason: `WAITING ON DECISION: ${relatedDecision.decisionTitle || relatedDecision.title}`,
      label: "Open decision",
    };
  }

  return null;
}

export type ProjectReleaseState = "Not assessed" | "Blocked" | "In progress" | "Ready to delegate" | "Released";
export type ProjectReleaseItemInput = { releaseAction: ReleaseAction; releaseClosureState: ReleaseClosureState };
export type LatestHandoffInput = { state: HandoffState };

export function getProjectExecutionReleaseStatus(
  releaseItem: ProjectReleaseItemInput | null,
  latestHandoff: LatestHandoffInput | null,
): ProjectReleaseState {
  if (!releaseItem && latestHandoff && !["Returned to Founder", "Ownership changed", "Source missing"].includes(latestHandoff.state)) return "Released";
  if (!releaseItem) return "Not assessed";
  if (releaseItem.releaseAction === "Delegate Now") return "Ready to delegate";
  if (releaseItem.releaseClosureState === "In progress") return "In progress";
  if (releaseItem.releaseAction === "Prepare to Delegate" || releaseItem.releaseAction === "Unblock First" || releaseItem.releaseAction === "Retain — Founder Authority Required" || releaseItem.releaseClosureState === "Closure incomplete") return "Blocked";
  return "Not assessed";
}

export type ReleaseAction = "Delegate Now" | "Prepare to Delegate" | "Complete Personally" | "Retain — Founder Authority Required" | "Unblock First" | "Monitor / Retain Temporarily";
export type ReleaseSeverity = "Critical" | "Material" | "Low";
export type ReleaseClosureState = "Not started" | "In progress" | "Resolved" | "Closure incomplete" | "Cancelled";
export type ReleaseSourceType = "Action" | "Project" | "Lead" | "Problem";

export type ReleasePersonInput = CapacityPersonInput;
export type ReleaseReadinessGap = { name: string; missingFields: readonly string[] };
export type ReleaseActionHistoryInput = {
  id: string;
  releaseSourceType?: ReleaseSourceType;
  releaseSourceId?: string;
  releaseIntent?: "Prepare to Delegate" | "Unblock First";
  status: string;
};

export type ReleaseCandidateInput = {
  id: string;
  objectType: ReleaseSourceType;
  title: string;
  area: string;
  owner: string;
  status: string;
  dueDate?: string;
  priorityOrSeverity?: string;
  isBlocked: boolean;
  dependencyBlockerReason?: string | null;
  earliestExecutableDate?: string;
  followUpDate?: string;
  isLegitimatelyWaiting?: boolean;
  requiresAuthority: boolean;
  hasFounderAttentionObjective: boolean;
  founderAttentionObjectiveTitle?: string;
  areaDelegationReadyPeople: readonly ReleasePersonInput[];
  capacityRankedDelegationPeople: readonly ReleasePersonInput[];
  activeOperationalDelegationPeopleCount: number;
  delegationReadyPeopleCount: number;
  delegationReadinessGapPeople: readonly ReleaseReadinessGap[];
  releaseActions: readonly ReleaseActionHistoryInput[];
};

export type ReleaseRecommendation = {
  id: string;
  objectType: ReleaseSourceType;
  title: string;
  area: string;
  owner: string;
  status: string;
  releaseAction: ReleaseAction;
  severity: ReleaseSeverity;
  urgencyText: string;
  why: string;
  releasePath: string;
  hasCapacity: boolean;
  requiresAuthority: boolean;
  priorityScore: number;
  eligibleDelegationPeople: ReleasePersonInput[];
  releaseActionId?: string;
  releaseClosureActionId?: string;
  releaseClosureState: ReleaseClosureState;
  releaseClosureReason: string;
};

export type ReleaseSystemSummary = {
  headline: string;
  totalFounderOwned: number;
  delegateNowCount: number;
  prepareToDelegateCount: number;
  retainAuthorityCount: number;
  unblockFirstCount: number;
  completePersonallyCount: number;
  monitorCount: number;
  releasableCount: number;
  releasablePct: number;
};

export type ExecutionReleasePlan = { summary: ReleaseSystemSummary; items: ReleaseRecommendation[] };

function readinessGapText(gaps: readonly ReleaseReadinessGap[], withNames: boolean): string {
  return gaps.map((person) => withNames
    ? `${person.name} (${person.missingFields.join(", ")})`
    : `${person.name} — ${person.missingFields.join(", ")}`,
  ).join("; ");
}

function classifyReleaseCandidate(candidate: ReleaseCandidateInput, nowMs: number): ReleaseRecommendation | null {
  const {
    objectType, id, title, area, owner, status, dueDate, priorityOrSeverity,
    isBlocked, dependencyBlockerReason, earliestExecutableDate, followUpDate,
    isLegitimatelyWaiting = false, requiresAuthority, hasFounderAttentionObjective, founderAttentionObjectiveTitle,
    areaDelegationReadyPeople, capacityRankedDelegationPeople,
    activeOperationalDelegationPeopleCount, delegationReadyPeopleCount,
    delegationReadinessGapPeople, releaseActions,
  } = candidate;
  const dayMs = 1000 * 60 * 60 * 24;
  let releaseAction: ReleaseAction = "Monitor / Retain Temporarily";
  let severity: ReleaseSeverity = "Low";
  let why = "";
  let releasePath = "";
  let urgencyText = "";

  const dueTimestamp = dueDate ? new Date(`${dueDate.slice(0, 10)}T00:00:00`).getTime() : 0;
  const isValidDate = dueTimestamp > 0 && !Number.isNaN(dueTimestamp);
  const startOfTodayForItemMs = new Date(nowMs).setHours(0, 0, 0, 0);
  const daysUntilDue = isValidDate ? Math.round((dueTimestamp - startOfTodayForItemMs) / dayMs) : null;
  const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
  const isDueSoon = daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 7;
  const earliestExecutableTimestamp = earliestExecutableDate ? new Date(`${earliestExecutableDate.slice(0, 10)}T00:00:00`).getTime() : 0;
  const isNotYetExecutable = earliestExecutableTimestamp > 0 && !Number.isNaN(earliestExecutableTimestamp) && earliestExecutableTimestamp > startOfTodayForItemMs;
  const isDueSoonForRanking = isDueSoon && !isNotYetExecutable;
  const followUpTimestamp = followUpDate ? new Date(`${followUpDate.slice(0, 10)}T00:00:00`).getTime() : 0;
  const isFollowUpFuture = followUpTimestamp > 0 && !Number.isNaN(followUpTimestamp) && followUpTimestamp > startOfTodayForItemMs;

  if (isFollowUpFuture && (status === "Waiting" || isLegitimatelyWaiting) && !isOverdue && !isBlocked && priorityOrSeverity !== "Critical" && !requiresAuthority) return null;
  if (isNotYetExecutable && !isBlocked && !dependencyBlockerReason && !requiresAuthority && !isOverdue && priorityOrSeverity !== "Critical") return null;

  if (isOverdue) {
    urgencyText = `Overdue by ${Math.abs(daysUntilDue!)} day${Math.abs(daysUntilDue!) === 1 ? "" : "s"}`;
  } else if (isDueSoon) {
    urgencyText = daysUntilDue === 0 ? "Due today" : `Due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`;
    if (isNotYetExecutable) urgencyText += ` (not executable until ${earliestExecutableDate!.slice(0, 10)})`;
  } else if (isValidDate && daysUntilDue !== null && daysUntilDue <= 30) {
    urgencyText = `Due in ${daysUntilDue} days`;
  }

  if ((isBlocked || dependencyBlockerReason) && !hasFounderAttentionObjective) {
    releaseAction = "Unblock First";
    severity = "Critical";
    why = dependencyBlockerReason
      ? `Founder-owned ${objectType.toLowerCase()} '${title}' is blocked by an upstream dependency (${dependencyBlockerReason}). Releasing ownership now will not restore progress.`
      : `Founder-owned ${objectType.toLowerCase()} '${title}' is blocked. Resolving the operational blocker is required before transferring ownership.`;
    releasePath = dependencyBlockerReason ? "Clear upstream dependency, then evaluate for delegation." : "Resolve blocker or re-sequence work, then delegate.";
  } else if (requiresAuthority) {
    releaseAction = "Retain — Founder Authority Required";
    severity = "Critical";
    why = hasFounderAttentionObjective
      ? `Founder-owned project '${title}' is linked to active Strategic Objective '${founderAttentionObjectiveTitle}', explicitly allocated to founder attention.`
      : `Founder-owned ${objectType.toLowerCase()} '${title}' requires founder judgement or strategic decision authority.`;
    releasePath = hasFounderAttentionObjective
      ? "Retain under founder authority while this Strategic Objective requires founder attention; resolve any blockers before execution."
      : "Retain under founder ownership and execute or issue formal decision.";
  } else if (isOverdue || (isDueSoonForRanking && (priorityOrSeverity === "Critical" || priorityOrSeverity === "High"))) {
    releaseAction = "Complete Personally";
    severity = isOverdue ? "Critical" : "Material";
    why = isOverdue
      ? `Founder-owned ${objectType.toLowerCase()} '${title}' is overdue (${urgencyText}). Reassignment now would create handover drag; finishing it is the fastest path.`
      : `Founder-owned ${objectType.toLowerCase()} '${title}' is urgent (${urgencyText}) and high-priority. Finish directly to preserve momentum.`;
    releasePath = "Complete execution directly to clear the immediate backlog item.";
  } else if (areaDelegationReadyPeople.length > 0) {
    releaseAction = "Delegate Now";
    severity = "Material";
    why = `Founder-owned routine ${objectType.toLowerCase()} '${title}' is suitable for delegation and area-qualified capacity exists.`;
    releasePath = `Transfer ownership to an active delegation-ready team member for ${area} (${capacityRankedDelegationPeople.map((person) => person.name).join(", ")}).`;
  } else {
    releaseAction = "Prepare to Delegate";
    severity = "Material";
    why = activeOperationalDelegationPeopleCount === 0
      ? `Founder-owned routine ${objectType.toLowerCase()} '${title}' is suitable for delegation, but no active operational delegation person excluding the primary founder exists in People.`
      : delegationReadyPeopleCount > 0
        ? `Founder-owned routine ${objectType.toLowerCase()} '${title}' is suitable for delegation, but no delegation-ready person is assigned to ${area || "its area"}.`
        : `Founder-owned routine ${objectType.toLowerCase()} '${title}' is suitable for delegation, but readiness gaps remain: ${readinessGapText(delegationReadinessGapPeople, true)}.`;
    releasePath = activeOperationalDelegationPeopleCount === 0
      ? "Onboard or activate operational delegation people excluding the primary founder in People to absorb operational load."
      : delegationReadyPeopleCount > 0
        ? `Assign a delegation-ready Person to ${area || "the work item's area"}.`
        : `Complete delegation readiness in People: ${readinessGapText(delegationReadinessGapPeople, false)}.`;
  }

  const linkedReleaseAction = releaseAction === "Prepare to Delegate" || releaseAction === "Unblock First"
    ? releaseActions.find((action) => action.releaseSourceType === objectType && action.releaseSourceId === id && action.releaseIntent === releaseAction)
    : undefined;
  const latestHistoricalReleaseAction = releaseActions.find((action) =>
    action.releaseSourceType === objectType
    && action.releaseSourceId === id
    && (action.releaseIntent === "Prepare to Delegate" || action.releaseIntent === "Unblock First"),
  );
  const closureReleaseAction = linkedReleaseAction ?? (
    releaseAction !== "Prepare to Delegate" && releaseAction !== "Unblock First" ? latestHistoricalReleaseAction : undefined
  );

  let priorityScore = releaseAction === "Delegate Now" ? 500
    : releaseAction === "Prepare to Delegate" ? 400
      : releaseAction === "Unblock First" ? 350
        : releaseAction === "Complete Personally" ? 300
          : releaseAction === "Retain — Founder Authority Required" ? 200
            : 100;
  if (isOverdue) priorityScore += 150;
  if (isDueSoonForRanking) priorityScore += 80;
  if (priorityOrSeverity === "Critical") priorityScore += 100;
  if (priorityOrSeverity === "High") priorityScore += 50;

  let releaseClosureState: ReleaseClosureState = "Not started";
  let releaseClosureReason = "No linked release Action exists.";
  if (closureReleaseAction) {
    if (closureReleaseAction.status === "Cancelled") {
      releaseClosureState = "Cancelled";
      releaseClosureReason = "The linked release Action was cancelled.";
    } else if (closureReleaseAction.status !== "Completed") {
      releaseClosureState = "In progress";
      releaseClosureReason = `The linked release Action is ${closureReleaseAction.status.toLowerCase()}.`;
    } else if (closureReleaseAction.releaseIntent === "Prepare to Delegate") {
      if (areaDelegationReadyPeople.length > 0) {
        releaseClosureState = "Resolved";
        releaseClosureReason = `Area-qualified delegation capacity now exists through ${areaDelegationReadyPeople.map((person) => person.name).join(", ")}.`;
      } else {
        releaseClosureState = "Closure incomplete";
        releaseClosureReason = activeOperationalDelegationPeopleCount === 0
          ? "No active operational delegation person is available yet."
          : delegationReadyPeopleCount > 0
            ? `Delegation-ready people exist, but none are assigned to ${area || "the source item's area"}.`
            : `Readiness gaps remain: ${readinessGapText(delegationReadinessGapPeople, true)}.`;
      }
    } else {
      const sourceStillRequiresIntervention = isBlocked || Boolean(dependencyBlockerReason) || requiresAuthority;
      if (sourceStillRequiresIntervention) {
        releaseClosureState = "Closure incomplete";
        releaseClosureReason = requiresAuthority
          ? "The source item still requires Founder authority or intervention."
          : "The source item is still blocked or waiting on an unresolved dependency.";
      } else {
        releaseClosureState = "Resolved";
        releaseClosureReason = "The source item is no longer blocked and no longer carries a Founder-authority signal.";
      }
    }
  }

  return {
    id,
    objectType,
    title,
    area,
    owner,
    status,
    releaseAction,
    severity,
    urgencyText,
    why,
    releasePath,
    hasCapacity: areaDelegationReadyPeople.length > 0,
    requiresAuthority,
    priorityScore,
    eligibleDelegationPeople: capacityRankedDelegationPeople.map((person) => ({ ...person })),
    releaseActionId: linkedReleaseAction?.id,
    releaseClosureActionId: closureReleaseAction?.id,
    releaseClosureState,
    releaseClosureReason,
  };
}

export function buildExecutionReleasePlan(
  candidates: readonly ReleaseCandidateInput[],
  nowMs = Date.now(),
): ExecutionReleasePlan {
  const rawItems: ReleaseRecommendation[] = [];
  const usedRecordKeys = new Set<string>();
  const hasDelegationReadyPeople = candidates.some((candidate) => candidate.delegationReadyPeopleCount > 0);
  for (const candidate of candidates) {
    const recordKey = `${candidate.objectType}:${candidate.id}`;
    if (usedRecordKeys.has(recordKey)) continue;
    const recommendation = classifyReleaseCandidate(candidate, nowMs);
    if (!recommendation) continue;
    rawItems.push(recommendation);
    usedRecordKeys.add(recordKey);
  }
  const items = [...rawItems].sort((left, right) => right.priorityScore - left.priorityScore || left.title.localeCompare(right.title));
  const totalFounderOwned = items.length;
  const delegateNowCount = items.filter((item) => item.releaseAction === "Delegate Now").length;
  const prepareToDelegateCount = items.filter((item) => item.releaseAction === "Prepare to Delegate").length;
  const retainAuthorityCount = items.filter((item) => item.releaseAction === "Retain — Founder Authority Required").length;
  const unblockFirstCount = items.filter((item) => item.releaseAction === "Unblock First").length;
  const completePersonallyCount = items.filter((item) => item.releaseAction === "Complete Personally").length;
  const monitorCount = items.filter((item) => item.releaseAction === "Monitor / Retain Temporarily").length;
  const releasableCount = delegateNowCount + prepareToDelegateCount;
  const releasablePct = totalFounderOwned > 0 ? Math.round((releasableCount / totalFounderOwned) * 100) : 0;

  let headline = "";
  if (totalFounderOwned === 0) {
    headline = "Founder execution load is fully distributed — no active founder-owned execution items.";
  } else if (retainAuthorityCount > 0) {
    headline = `${retainAuthorityCount} founder-owned item${retainAuthorityCount === 1 ? " is" : "s are"} intentionally retained for founder authority${prepareToDelegateCount > 0 ? `; ${prepareToDelegateCount} await${prepareToDelegateCount === 1 ? "s" : ""} delegation readiness` : ""}.`;
  } else if (releasableCount === totalFounderOwned) {
    headline = "Founder execution load is broadly releasable.";
  } else if (delegateNowCount > 0) {
    headline = `${releasableCount} of ${totalFounderOwned} founder-owned execution items are structurally releasable.`;
  } else if (prepareToDelegateCount > 0 && !hasDelegationReadyPeople) {
    headline = `${prepareToDelegateCount} founder-owned item${prepareToDelegateCount === 1 ? " awaits" : "s await"} delegation readiness.`;
  } else {
    headline = `${releasableCount} of ${totalFounderOwned} founder-owned execution items can be released.`;
  }

  return {
    summary: {
      headline,
      totalFounderOwned,
      delegateNowCount,
      prepareToDelegateCount,
      retainAuthorityCount,
      unblockFirstCount,
      completePersonallyCount,
      monitorCount,
      releasableCount,
      releasablePct,
    },
    items,
  };
}
