// Shared identity resolution between derived strategic risks (e.g. Icarus) and convergent situations from the
// correlation graph. Command Attention and Founder Focus both consume this so the same strategic risk is
// suppressed (or restored) consistently wherever a convergent situation already represents it.

export type ConvergentSituationInput = {
  clusterKey: string;
  rootRecordKey?: string;
  records: readonly { recordKey: string }[];
};

export type StrategicRiskConvergence = {
  clusterKey: string;
  rootRecordKey: string;
  // Non-strategic-risk members of the situation that can host the risk: root first, then by record key.
  hostRecordKeys: string[];
};

// Maps every member record of a convergent situation onto that situation's key (first situation wins).
export function indexConvergentSituationMembers(situations: readonly ConvergentSituationInput[]): Map<string, string> {
  const clusterKeyByRecordKey = new Map<string, string>();
  situations.forEach((situation) => situation.records.forEach((record) => {
    if (!clusterKeyByRecordKey.has(record.recordKey)) clusterKeyByRecordKey.set(record.recordKey, situation.clusterKey);
  }));
  return clusterKeyByRecordKey;
}

// Resolves which strategic risks are already represented by a convergent situation, and which operational members
// of that situation may carry the risk instead of a standalone item. A risk absent from every convergent situation
// is absent from the result, so it remains (or becomes again) independently visible.
export function resolveStrategicRiskConvergence(
  situations: readonly ConvergentSituationInput[],
  strategicRiskRecordKeys: Iterable<string>,
): Map<string, StrategicRiskConvergence> {
  const riskKeys = new Set(strategicRiskRecordKeys);
  const situationsByKey = new Map(situations.map((situation) => [situation.clusterKey, situation] as const));
  const clusterKeyByRecordKey = indexConvergentSituationMembers(situations);
  const resolutions = new Map<string, StrategicRiskConvergence>();
  [...riskKeys].sort().forEach((riskKey) => {
    const clusterKey = clusterKeyByRecordKey.get(riskKey);
    const situation = clusterKey ? situationsByKey.get(clusterKey) : undefined;
    if (!situation) return;
    const rootRecordKey = situation.rootRecordKey ?? situation.records[0]?.recordKey ?? riskKey;
    const hosts = [...new Set(situation.records.map((record) => record.recordKey))]
      .filter((recordKey) => !riskKeys.has(recordKey))
      .sort((left, right) => (left === rootRecordKey ? -1 : right === rootRecordKey ? 1 : left.localeCompare(right)));
    resolutions.set(riskKey, { clusterKey: situation.clusterKey, rootRecordKey, hostRecordKeys: hosts });
  });
  return resolutions;
}
