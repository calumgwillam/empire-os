export type AccountabilityPersonInput = {
  id: string;
  name: string;
};

export type AccountabilityRiskInput = {
  dueDate?: string;
  targetCompletionDate?: string;
  createdAt?: string;
  priority?: string;
  severity?: string;
};

export type AccountabilitySnapshotInput = {
  person: AccountabilityPersonInput | null;
  orderedPeople: readonly (AccountabilityPersonInput & { status: string })[];
  actions: readonly (AccountabilityRiskInput & {
    owner?: string;
    ownerPersonId?: string;
    status: string;
    isActive: boolean;
    isWaiting: boolean;
  })[];
  projects: readonly (AccountabilityRiskInput & {
    owner?: string;
    status: string;
    isActive: boolean;
  })[];
  activeLeads: readonly {
    owner?: string;
    status: string;
    followUpDate?: string;
  }[];
  decisions: readonly {
    decisionMaker?: string;
    decisionStatus: string;
    reviewDate?: string;
  }[];
  problems: readonly (AccountabilityRiskInput & {
    owner?: string;
    isUnresolved: boolean;
  })[];
  nowMs: number;
};

// Source indexes retain duplicate records and let the page restore its original record references.
export type AccountabilitySnapshotResult = {
  ownerLabel: string;
  ownedActions: number[];
  overdueActions: number[];
  blockedActions: number[];
  otherOpenActions: number[];
  activeProjects: number[];
  blockedProjects: number[];
  otherActiveProjects: number[];
  pipelineLeads: number[];
  followUpLeads: number[];
  otherPipelineLeads: number[];
  waitingDecisions: number[];
  unresolvedProblems: number[];
  blockedCount: number;
  carriedCount: number;
  attentionCount: number;
};

export function buildAccountabilitySnapshot(input: AccountabilitySnapshotInput): AccountabilitySnapshotResult {
  const person = input.person;
  const personName = person?.name ?? "";
  const isBlankOwner = (ownerValue?: string) => {
    const text = (ownerValue || "").trim();
    return text === "" || text.toLowerCase() === "unassigned";
  };
  const matchesActivePerson = (ownerValue?: string) => {
    const text = (ownerValue || "").trim();
    if (text === "") return false;
    return input.orderedPeople.some((entry) =>
      entry.status === "Active" && entry.name.trim().toLowerCase() === text.toLowerCase());
  };
  const ownsByName = (ownerValue?: string) =>
    person !== null && personName.trim() !== "" && !isBlankOwner(ownerValue)
    && (ownerValue || "").trim().toLowerCase() === personName.trim().toLowerCase();
  const isOwnedAction = (action: AccountabilitySnapshotInput["actions"][number]) => {
    if (person === null) {
      if (action.ownerPersonId) {
        const activeOwner = input.orderedPeople.find((entry) =>
          entry.id === action.ownerPersonId && entry.status === "Active");
        if (activeOwner) return false;
      }
      return isBlankOwner(action.owner) || !matchesActivePerson(action.owner);
    }
    if (action.ownerPersonId) return action.ownerPersonId === person.id;
    return ownsByName(action.owner);
  };
  const isOwnedByName = (ownerValue?: string) =>
    person === null ? (isBlankOwner(ownerValue) || !matchesActivePerson(ownerValue)) : ownsByName(ownerValue);
  const isOwnedDecision = (decision: AccountabilitySnapshotInput["decisions"][number]) =>
    person === null ? isBlankOwner(decision.decisionMaker) : ownsByName(decision.decisionMaker);
  const isDue = (value?: string) =>
    Boolean(value) && new Date(value || "").getTime() <= input.nowMs;
  const sourceIndexes = <T>(records: readonly T[], predicate: (record: T) => boolean) =>
    records.flatMap((record, index) => predicate(record) ? [index] : []);

  const ownedActions = sourceIndexes(input.actions, (action) => action.isActive && isOwnedAction(action));
  const overdueActions = ownedActions.filter((index) => {
    const action = input.actions[index];
    return !action.isWaiting && isDue(action.dueDate);
  });
  const blockedActions = ownedActions.filter((index) => input.actions[index].status === "Blocked");
  const otherOpenActions = ownedActions.filter((index) =>
    !overdueActions.includes(index) && !blockedActions.includes(index));
  const activeProjects = sourceIndexes(input.projects, (project) => project.isActive && isOwnedByName(project.owner));
  const blockedProjects = activeProjects.filter((index) => input.projects[index].status.trim().toLowerCase() === "blocked");
  const otherActiveProjects = activeProjects.filter((index) => input.projects[index].status.trim().toLowerCase() !== "blocked");
  const pipelineLeads = sourceIndexes(input.activeLeads, (lead) =>
    isOwnedByName(lead.owner) && !["Won", "Lost"].includes(lead.status));
  const followUpLeads = pipelineLeads.filter((index) => {
    const lead = input.activeLeads[index];
    return lead.status === "Follow-Up" || isDue(lead.followUpDate);
  });
  const otherPipelineLeads = pipelineLeads.filter((index) => !followUpLeads.includes(index));
  const waitingDecisions = sourceIndexes(input.decisions, (decision) =>
    isOwnedDecision(decision) && (
      ["Draft", "Under Review"].includes(decision.decisionStatus)
      || (decision.decisionStatus === "Active" && isDue(decision.reviewDate))
    ));
  const unresolvedProblems = sourceIndexes(input.problems, (problem) =>
    problem.isUnresolved && isOwnedByName(problem.owner));

  const sortByRiskThenAge = (indexes: readonly number[], records: readonly AccountabilityRiskInput[]) => {
    const riskWeight = (item: AccountabilityRiskInput) => {
      const level = (item.priority || item.severity || "").toLowerCase();
      if (level === "critical") return 4;
      if (level === "high") return 3;
      if (level === "medium") return 2;
      return 1;
    };
    const ageValue = (item: AccountabilityRiskInput) => {
      const dateText = item.dueDate || item.targetCompletionDate || item.createdAt || "";
      const parsed = dateText ? new Date(dateText).getTime() : 0;
      return Number.isNaN(parsed) ? 0 : parsed;
    };
    return [...indexes].sort((first, second) => {
      const riskDiff = riskWeight(records[second]) - riskWeight(records[first]);
      if (riskDiff !== 0) return riskDiff;
      return ageValue(records[first]) - ageValue(records[second]);
    });
  };
  const blockedCount = blockedActions.length + blockedProjects.length;
  const carriedCount = ownedActions.length + activeProjects.length + pipelineLeads.length
    + waitingDecisions.length + unresolvedProblems.length;
  const attentionCount = overdueActions.length + blockedCount + followUpLeads.length + waitingDecisions.length;

  return {
    ownerLabel: person ? person.name : "Unassigned",
    ownedActions: sortByRiskThenAge(ownedActions, input.actions),
    overdueActions: sortByRiskThenAge(overdueActions, input.actions),
    blockedActions: sortByRiskThenAge(blockedActions, input.actions),
    otherOpenActions: sortByRiskThenAge(otherOpenActions, input.actions),
    activeProjects: sortByRiskThenAge(activeProjects, input.projects),
    blockedProjects: sortByRiskThenAge(blockedProjects, input.projects),
    otherActiveProjects: sortByRiskThenAge(otherActiveProjects, input.projects),
    pipelineLeads,
    followUpLeads,
    otherPipelineLeads,
    waitingDecisions,
    unresolvedProblems: sortByRiskThenAge(unresolvedProblems, input.problems),
    blockedCount,
    carriedCount,
    attentionCount,
  };
}
