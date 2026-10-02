type PostureRecordId = { id: string };
type PostureRecordIdentity = PostureRecordId & { objectType: string };

export type OperatingPostureInput = {
  focusCandidates: readonly (PostureRecordIdentity & { title: string; reason: string })[];
  authorityItems: readonly PostureRecordIdentity[];
  reviewsDue: readonly PostureRecordId[];
  unassigned: {
    ownedActions: readonly PostureRecordId[];
    activeProjects: readonly PostureRecordId[];
    pipelineLeads: readonly PostureRecordId[];
    unresolvedProblems: readonly PostureRecordId[];
    carriedCount: number;
  };
  learningGaps: readonly PostureRecordId[];
  decisionsWithoutExecution: readonly PostureRecordId[];
  confidenceLimitations: readonly { severity: string }[];
  personAttentionCounts: readonly number[];
  health: {
    delegationQualityLabel: string;
    selfSufficiencyPct: number | null;
    topOwnerShare: number | null;
  };
  operationalIndependencePct: number | null;
  delegation: {
    candidateCount: number;
    capacityCount: number;
    readinessGapCount: number;
  };
  staleRecords: readonly PostureRecordIdentity[];
  capitalAttention: readonly { key: string }[];
  growth: {
    stalledOpportunities: readonly PostureRecordId[];
    stalledLeads: readonly PostureRecordId[];
    stalledQuoteValue: number;
    formattedStalledQuoteValue: string;
    count: number;
  };
  clusters: readonly { recordKeys: readonly string[] }[];
  signalled: ReadonlyMap<string, {
    title: string;
    objectType: string;
    signals: readonly string[];
  }>;
};

export type OperatingPostureResult = {
  posture: string;
  postureIsClear: boolean;
  steps: { label: string; count: number; hint: string }[];
  ownership: string;
  ownershipIsClear: boolean;
  founderDependency: string | null;
  freshness: string;
  freshnessIsClear: boolean;
  growth: string;
  growthIsClear: boolean;
  outstandingCount: number;
  outstandingSituationCount: number;
  outstandingKeys: { key: string; title: string; objectType: string; category: string }[];
  authorityCount: number;
  reviewDueCount: number;
  ownershipGapCount: number;
  learningGapCount: number;
  executionGapCount: number;
  staleCount: number;
  financeCount: number;
  growthStallCount: number;
};

export function buildOperatingPosture(input: OperatingPostureInput): OperatingPostureResult {
  const {
    focusCandidates,
    authorityItems,
    reviewsDue,
    unassigned,
    learningGaps,
    decisionsWithoutExecution,
    confidenceLimitations,
    personAttentionCounts,
    health,
    operationalIndependencePct,
    delegation,
    staleRecords,
    capitalAttention,
    growth,
    clusters,
    signalled,
  } = input;

  const authorityCount = authorityItems.length;
  const reviewDueCount = reviewsDue.length;
  const ownershipGapCount = unassigned.ownedActions.length
    + unassigned.activeProjects.length
    + unassigned.pipelineLeads.length
    + unassigned.unresolvedProblems.length;
  const learningGapCount = learningGaps.length;
  const executionGapCount = decisionsWithoutExecution.length;
  const focusCount = focusCandidates.length;
  const ownershipHygieneGapCount = unassigned.carriedCount;
  const financeCount = capitalAttention.length;

  const postureParts: string[] = [];
  const strategicConfidenceAttentionCount = confidenceLimitations.filter(
    (limitation) => limitation.severity === "Blocker" || limitation.severity === "Material",
  ).length;

  if (authorityCount > 0) postureParts.push(`${authorityCount} need${authorityCount === 1 ? "s" : ""} your authority`);
  if (reviewDueCount > 0) postureParts.push(`${reviewDueCount} decision review${reviewDueCount === 1 ? "" : "s"} overdue`);
  if (ownershipGapCount > 0) postureParts.push(`${ownershipGapCount} ownership gap${ownershipGapCount === 1 ? "" : "s"}`);
  if (learningGapCount > 0) postureParts.push(`${learningGapCount} recurring problem${learningGapCount === 1 ? "" : "s"} not yet captured as learning`);
  if (executionGapCount > 0) postureParts.push(`${executionGapCount} decision${executionGapCount === 1 ? "" : "s"} without an execution path`);
  if (strategicConfidenceAttentionCount > 0) {
    postureParts.push(
      `${strategicConfidenceAttentionCount} strategic data confidence issue${strategicConfidenceAttentionCount === 1 ? " needs" : "s need"} attention`,
    );
  }
  if (financeCount > 0) postureParts.push(`${financeCount} capital attention item${financeCount === 1 ? " needs" : "s need"} founder review`);

  const posture = postureParts.length > 0
    ? postureParts.join(" • ")
    : "Nothing needs founder authority, review, ownership triage, learning capture or cash attention right now.";

  const steps = [
    {
      label: "Clear founder focus",
      count: focusCount,
      hint: "Work the ranked top items first.",
    },
    {
      label: "Fix ownership gaps",
      count: ownershipHygieneGapCount,
      hint: "Assign a valid active owner to dropped or ghost-owned work.",
    },
    {
      label: "Complete decision reviews",
      count: reviewDueCount,
      hint: "Record outcomes and ratings so decisions stop drifting.",
    },
    {
      label: "Restore execution paths",
      count: executionGapCount,
      hint: "Give each active decision an open linked action.",
    },
    {
      label: "Close recurring-learning gaps",
      count: learningGapCount,
      hint: "Turn repeat problems into a lesson, system or SOP.",
    },
    {
      label: "Clear cash attention",
      count: financeCount,
      hint: "Address cash buffer pressure, overdue commitments and overdue expected income.",
    },
  ];

  const peopleWithAttention = personAttentionCounts.filter((count) => count > 0);
  const ownership = ownershipHygieneGapCount === 0
    ? "Every active work item has a valid active owner."
    : `${ownershipHygieneGapCount} active item${ownershipHygieneGapCount === 1 ? "" : "s"} lack${ownershipHygieneGapCount === 1 ? "s" : ""} a valid active owner. ${peopleWithAttention.length} ${peopleWithAttention.length === 1 ? "person is" : "people are"} carrying attention items.`;
  const delegationCandidateCount = delegation.candidateCount;
  const founderDependency = health.delegationQualityLabel === "Needs attention" && health.selfSufficiencyPct !== null
    ? `${health.selfSufficiencyPct}% of validly owned active work is owned outside the primary Founder; ${operationalIndependencePct ?? 0}% can run without routine Founder intervention; the top owner carries ${health.topOwnerShare ?? 0}%${delegationCandidateCount > 0 ? `, and ${delegationCandidateCount} founder-owned item${delegationCandidateCount === 1 ? " is" : "s are"} suitable for delegation${delegation.capacityCount === 0 ? `, but ${delegation.readinessGapCount > 0 ? `${delegation.readinessGapCount} active operational delegation person${delegation.readinessGapCount === 1 ? " is" : "s are"} not yet delegation-ready` : "no active operational delegation person is available"}` : ""}.` : "."}`
    : null;

  const staleCount = staleRecords.length;
  const freshness = staleCount === 0
    ? "The operating picture looks current — no stale active records detected."
    : `${staleCount} active record${staleCount === 1 ? "" : "s"} may be stale — the operating picture needs review.`;

  const growthParts: string[] = [];
  if (growth.stalledOpportunities.length > 0) growthParts.push(`${growth.stalledOpportunities.length} high-fit opportunit${growth.stalledOpportunities.length === 1 ? "y" : "ies"} idle`);
  if (growth.stalledLeads.length > 0) growthParts.push(`${growth.stalledLeads.length} lead${growth.stalledLeads.length === 1 ? "" : "s"} stalled`);
  if (growth.stalledQuoteValue > 0) growthParts.push(`${growth.formattedStalledQuoteValue} in quotes awaiting movement`);
  const growthText = growthParts.length > 0
    ? growthParts.join(" • ")
    : "Growth pipeline is moving — no stalled high-fit opportunities or leads.";
  const growthIsClear = growthParts.length === 0;

  const outstandingRecordKeys = new Set<string>();
  focusCandidates.forEach((item) => outstandingRecordKeys.add(`${item.objectType}:${item.id}`));
  authorityItems.forEach((item) => outstandingRecordKeys.add(`${item.objectType}:${item.id}`));
  reviewsDue.forEach((decision) => outstandingRecordKeys.add(`Decision:${decision.id}`));
  unassigned.ownedActions.forEach((action) => outstandingRecordKeys.add(`Action:${action.id}`));
  unassigned.activeProjects.forEach((project) => outstandingRecordKeys.add(`Project:${project.id}`));
  unassigned.pipelineLeads.forEach((lead) => outstandingRecordKeys.add(`Lead:${lead.id}`));
  unassigned.unresolvedProblems.forEach((problem) => outstandingRecordKeys.add(`Problem:${problem.id}`));
  decisionsWithoutExecution.forEach((decision) => outstandingRecordKeys.add(`Decision:${decision.id}`));
  learningGaps.forEach((problem) => outstandingRecordKeys.add(`Problem:${problem.id}`));
  staleRecords.forEach((item) => outstandingRecordKeys.add(`${item.objectType}:${item.id}`));
  capitalAttention.forEach((item) => outstandingRecordKeys.add(item.key));
  growth.stalledOpportunities.forEach((item) => outstandingRecordKeys.add(`Opportunity:${item.id}`));
  growth.stalledLeads.forEach((item) => outstandingRecordKeys.add(`Lead:${item.id}`));
  const outstandingCount = outstandingRecordKeys.size;

  const clusteredOutstandingRecordKeys = new Set<string>();
  const clusteredSituationCount = clusters.reduce((count, cluster) => {
    const matchingRecords = cluster.recordKeys.filter((recordKey) => outstandingRecordKeys.has(recordKey));
    if (matchingRecords.length === 0) return count;
    matchingRecords.forEach((recordKey) => clusteredOutstandingRecordKeys.add(recordKey));
    return count + 1;
  }, 0);
  const unclusteredOutstandingCount = [...outstandingRecordKeys].filter(
    (key) => !clusteredOutstandingRecordKeys.has(key),
  ).length;
  const outstandingSituationCount = clusteredSituationCount + unclusteredOutstandingCount;

  const founderFocusByRecordKey = new Map(
    focusCandidates.map((item) => [`${item.objectType}:${item.id}`, item]),
  );
  const outstandingKeys = [...outstandingRecordKeys].map((key) => {
    const signalledRecord = signalled.get(key);
    const focusItem = founderFocusByRecordKey.get(key);
    const separatorIndex = key.indexOf(":");
    const objectType = separatorIndex >= 0 ? key.slice(0, separatorIndex) : key;
    return {
      key,
      title: signalledRecord?.title || focusItem?.title || key,
      objectType: signalledRecord?.objectType || focusItem?.objectType || objectType,
      category: signalledRecord
        ? [...signalledRecord.signals].join(", ")
        : focusItem?.reason || "attention",
    };
  });

  return {
    posture,
    postureIsClear: postureParts.length === 0,
    steps,
    ownership,
    ownershipIsClear: ownershipHygieneGapCount === 0,
    founderDependency,
    freshness,
    freshnessIsClear: staleCount === 0,
    growth: growthText,
    growthIsClear,
    outstandingCount,
    outstandingSituationCount,
    outstandingKeys,
    authorityCount,
    reviewDueCount,
    ownershipGapCount,
    learningGapCount,
    executionGapCount,
    staleCount,
    financeCount,
    growthStallCount: growth.count,
  };
}
