export type OrganisationalHealthQuality = {
  label: "No active work" | "Strong" | "Adequate" | "Needs attention";
  tone: "clear" | "neutral" | "warn";
};

export type OrganisationalHealthInput = {
  workItems: readonly { ownerKey: string | null }[];
  founderOwnerKey: string | null;
  healthyHandoffCount: number;
  atRiskHandoffCount: number;
  decisions: readonly { status: string; startDate?: string }[];
  nowMs: number;
};

export type OrganisationalHealthResult = {
  totalWork: number;
  validOwned: number;
  nonFounderOwned: number;
  pctValidOwner: number | null;
  pctNonFounder: number | null;
  pctDelegatedStalled: number | null;
  topOwnerShare: number | null;
  delegationQuality: OrganisationalHealthQuality;
  delegationScore: number | null;
  openDecisionCount: number;
  activeDecisionCount: number;
  underReviewDecisionCount: number;
  openDecisionAgeSampleCount: number;
  avgOpenDecisionDays: number | null;
  medianOpenDecisionDays: number | null;
  oldestOpenDecisionDays: number | null;
  selfSufficiencyPct: number | null;
};

function getDateValue(value?: string): number {
  if (!value) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function buildOrganisationalHealth(input: OrganisationalHealthInput): OrganisationalHealthResult {
  const totalWork = input.workItems.length;
  let validOwned = 0;
  let founderOwned = 0;
  const ownerLoad = new Map<string, number>();

  input.workItems.forEach(({ ownerKey }) => {
    if (!ownerKey) return;
    validOwned += 1;
    ownerLoad.set(ownerKey, (ownerLoad.get(ownerKey) || 0) + 1);
    if (input.founderOwnerKey !== null && ownerKey === input.founderOwnerKey) {
      founderOwned += 1;
    }
  });

  const pctValidOwner = totalWork === 0 ? null : Math.round((validOwned / totalWork) * 100);
  const pctNonFounder = validOwned === 0 ? null : Math.round(((validOwned - founderOwned) / validOwned) * 100);
  const nonFounderOwned = validOwned - founderOwned;
  const delegatedCount = input.healthyHandoffCount + input.atRiskHandoffCount;
  const pctDelegatedStalled = delegatedCount === 0
    ? null
    : Math.round((input.atRiskHandoffCount / delegatedCount) * 100);

  let topOwnerShare: number | null = null;
  if (validOwned > 0 && ownerLoad.size > 0) {
    const maxLoad = Math.max(...ownerLoad.values());
    topOwnerShare = Math.round((maxLoad / validOwned) * 100);
  }

  const delegationScore = totalWork === 0
    ? null
    : validOwned === 0
      ? 0
      : (() => {
          const ownershipScore = (pctValidOwner ?? 0) * 0.30;
          const nonFounderScore = (pctNonFounder ?? 0) * 0.35;
          const concentrationScore = (100 - (topOwnerShare ?? 100)) * 0.25;
          const delegatedExecutionScore = pctDelegatedStalled === null ? 0 : (100 - pctDelegatedStalled) * 0.10;
          const availableWeight = pctDelegatedStalled === null ? 0.90 : 1;
          return Math.round((ownershipScore + nonFounderScore + concentrationScore + delegatedExecutionScore) / availableWeight);
        })();
  const delegationQuality: OrganisationalHealthQuality = totalWork === 0
    ? { label: "No active work", tone: "clear" }
    : (delegationScore ?? 0) >= 80
      ? { label: "Strong", tone: "clear" }
      : (delegationScore ?? 0) >= 60
        ? { label: "Adequate", tone: "neutral" }
        : { label: "Needs attention", tone: "warn" };

  const openDecisions = input.decisions.filter((decision) => ["Active", "Under Review"].includes(decision.status));
  const openDecisionAges = openDecisions
    .map((decision) => {
      const start = getDateValue(decision.startDate);
      const ageDays = start > 0 ? Math.floor((input.nowMs - start) / (1000 * 60 * 60 * 24)) : null;
      return ageDays !== null && ageDays >= 0 ? ageDays : null;
    })
    .filter((days): days is number => days !== null)
    .sort((first, second) => first - second);
  const avgOpenDecisionDays = openDecisionAges.length === 0
    ? null
    : Math.round(openDecisionAges.reduce((sum, age) => sum + age, 0) / openDecisionAges.length);
  const medianOpenDecisionDays = openDecisionAges.length === 0
    ? null
    : openDecisionAges.length % 2 === 1
      ? openDecisionAges[Math.floor(openDecisionAges.length / 2)]
      : Math.round((openDecisionAges[openDecisionAges.length / 2 - 1] + openDecisionAges[openDecisionAges.length / 2]) / 2);
  const oldestOpenDecisionDays = openDecisionAges.length === 0 ? null : openDecisionAges[openDecisionAges.length - 1];
  const selfSufficiencyPct = totalWork === 0 ? null : pctNonFounder;

  return {
    totalWork,
    validOwned,
    nonFounderOwned,
    pctValidOwner,
    pctNonFounder,
    pctDelegatedStalled,
    topOwnerShare,
    delegationQuality,
    delegationScore,
    openDecisionCount: openDecisions.length,
    activeDecisionCount: openDecisions.filter((decision) => decision.status === "Active").length,
    underReviewDecisionCount: openDecisions.filter((decision) => decision.status === "Under Review").length,
    openDecisionAgeSampleCount: openDecisionAges.length,
    avgOpenDecisionDays,
    medianOpenDecisionDays,
    oldestOpenDecisionDays,
    selfSufficiencyPct,
  };
}