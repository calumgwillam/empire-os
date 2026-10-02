export type OperationalIndependenceState =
  | "Independent"
  | "Ready to delegate"
  | "Guardrail gap"
  | "Ownership gap"
  | "Founder-only";

export type OperationalIndependenceObjectType = "Action" | "Project" | "Lead" | "Problem";

export type OperationalIndependenceWorkItemInput = {
  id: string;
  objectType: OperationalIndependenceObjectType;
  title: string;
  owner: string;
  ownerPersonId?: string;
  pillar: string;
  hasImmediateFounderIntervention: boolean;
  hasValidActiveOwner: boolean;
  isFounderOwned: boolean;
  areaHasDelegationReadyPerson: boolean;
  ownerReadinessMissingFields: readonly string[];
};

export type OperationalIndependenceClassifiedItem = {
  id: string;
  objectType: OperationalIndependenceObjectType;
  title: string;
  owner: string;
  ownerPersonId?: string;
  pillar: string;
  requiresFounderIntervention: boolean;
  state: OperationalIndependenceState;
  reason: string;
};

export type OperationalIndependenceInput = {
  actions: readonly OperationalIndependenceWorkItemInput[];
  projects: readonly OperationalIndependenceWorkItemInput[];
  leads: readonly OperationalIndependenceWorkItemInput[];
  problems: readonly OperationalIndependenceWorkItemInput[];
  founderReviewItems: readonly { kind: string; id: string }[];
  founderAuthorityItems: readonly { objectType: string; id: string }[];
  delegationReadyPeopleCount: number;
  delegationReadinessGapPeopleCount: number;
};

export type OperationalIndependenceResult = {
  totalActiveWork: number;
  independentCount: number;
  readyToDelegateCount: number;
  guardrailGapCount: number;
  ownershipGapCount: number;
  founderOnlyCount: number;
  operationalIndependencePct: number | null;
  classifiedItems: OperationalIndependenceClassifiedItem[];
};

export function buildOperationalIndependence(input: OperationalIndependenceInput): OperationalIndependenceResult {
  const founderAuthorityKeys = new Set([
    ...input.founderReviewItems.map((item) => `${item.kind}:${item.id}`),
    ...input.founderAuthorityItems.map((item) => `${item.objectType}:${item.id}`),
  ]);
  const activeWork = [...input.actions, ...input.projects, ...input.leads, ...input.problems];
  const classifiedItems = activeWork.map((item): OperationalIndependenceClassifiedItem => {
    const requiresFounderIntervention = item.hasImmediateFounderIntervention
      || founderAuthorityKeys.has(`${item.objectType}:${item.id}`);
    let state: OperationalIndependenceState;
    let reason: string;

    if (requiresFounderIntervention) {
      state = "Founder-only";
      reason = "The current risk, blocked, or authority state requires Founder judgement or intervention.";
    } else if (!item.hasValidActiveOwner) {
      state = "Ownership gap";
      reason = "The item does not resolve to a valid active owner, so independent progress cannot be evidenced.";
    } else if (item.isFounderOwned) {
      if (item.areaHasDelegationReadyPerson) {
        state = "Ready to delegate";
        reason = `This routine Founder-owned work has an active delegation-ready person assigned to ${item.pillar}.`;
      } else if (input.delegationReadyPeopleCount > 0) {
        state = "Guardrail gap";
        reason = `Delegation-ready people exist, but none are assigned to ${item.pillar}.`;
      } else if (input.delegationReadinessGapPeopleCount > 0) {
        state = "Guardrail gap";
        reason = "Operational delegation is plausible, but available people lack a complete role, responsibilities, or authority definition.";
      } else {
        state = "Ownership gap";
        reason = "This routine Founder-owned work has no active non-founder operational person available.";
      }
    } else if (item.ownerReadinessMissingFields.length === 0) {
      state = "Independent";
      reason = "The active non-founder owner has role, responsibilities, and authority defined, with no current Founder-intervention signal.";
    } else {
      state = "Guardrail gap";
      reason = `The assigned active non-founder owner is missing ${item.ownerReadinessMissingFields.join(", ")}.`;
    }

    return {
      id: item.id,
      objectType: item.objectType,
      title: item.title,
      owner: item.owner,
      ...(item.objectType === "Action" ? { ownerPersonId: item.ownerPersonId } : {}),
      pillar: item.pillar,
      requiresFounderIntervention,
      state,
      reason,
    };
  });
  const countState = (state: OperationalIndependenceState) =>
    classifiedItems.filter((item) => item.state === state).length;
  const totalActiveWork = classifiedItems.length;
  const independentCount = countState("Independent");

  return {
    totalActiveWork,
    independentCount,
    readyToDelegateCount: countState("Ready to delegate"),
    guardrailGapCount: countState("Guardrail gap"),
    ownershipGapCount: countState("Ownership gap"),
    founderOnlyCount: countState("Founder-only"),
    operationalIndependencePct: totalActiveWork === 0
      ? null
      : Math.round((independentCount / totalActiveWork) * 100),
    classifiedItems,
  };
}
