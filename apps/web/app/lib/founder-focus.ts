import { indexConvergentSituationMembers } from "./strategic-risk-resolution";

export type FounderFocusSignalInput = {
  recordKey: string;
  objectType: string;
  id: string;
  title: string;
  area: string;
  signals: readonly string[];
  baseScore: number;
};

export type FounderFocusReviewInput = {
  objectType: string;
  id: string;
  title: string;
  pillar: string;
  reasonCategory: string;
  whyItMatters: string;
};

export type FounderFocusLimitationInput = {
  key: string;
  severity: "Blocker" | "Material" | "Warning";
  label: string;
  action?: { objectType: string; id: string };
};

export type FounderFocusClusterInput = {
  clusterKey: string;
  title: string;
  records: readonly {
    recordKey: string;
    objectType: string;
    id: string;
    area: string;
    baseScore: number;
  }[];
  categories: readonly string[];
  recordCount: number;
  // When supplied, the correlation graph's stable root; otherwise the highest-scoring record.
  rootRecordKey?: string;
};

export type FounderFocusRecordFact = {
  urgencyTime: number | null;
  isWaitingAction: boolean;
};

// A derived strategic risk (e.g. Icarus) that either enriches an anchored candidate or stands alone.
export type FounderFocusStrategicRiskInput = {
  key: string;
  objectType: string;
  id: string;
  title: string;
  area: string;
  band: number;
  score: number;
  reason: string;
  anchorRecordKeys: readonly string[];
  referenceKey: string;
  treatmentReasons?: readonly string[];
  founderOwnedTreatmentCount?: number;
  delegatedTreatmentCount?: number;
};

export type FounderFocusInput = {
  icarusLearning?: readonly import("./icarus-learning").IcarusLearningAttention[];
  signalledRecords: readonly FounderFocusSignalInput[];
  founderReviewItems: readonly FounderFocusReviewInput[];
  limitations: readonly FounderFocusLimitationInput[];
  convergentRisks: readonly FounderFocusClusterInput[];
  recordFacts: ReadonlyMap<string, FounderFocusRecordFact>;
  strategicRisks?: readonly FounderFocusStrategicRiskInput[];
};

export type FounderFocusCandidate = {
  key: string;
  objectType: string;
  id: string;
  title: string;
  area: string;
  score: number;
  band: number;
  urgencyTime: number | null;
  reason: string;
  strategicRiskKeys?: string[];
};

function compareFounderFocusCandidates(left: FounderFocusCandidate, right: FounderFocusCandidate): number {
  return left.band - right.band ||
    right.score - left.score ||
    (left.urgencyTime ?? Number.POSITIVE_INFINITY) - (right.urgencyTime ?? Number.POSITIVE_INFINITY) ||
    left.key.localeCompare(right.key);
}

export function buildFounderFocus(input: FounderFocusInput): FounderFocusCandidate[] {
  const signalBand = (signals: readonly string[]) => {
    if (signals.includes("founder authority")) return 1;
    if (signals.some((signal) => ["blocked", "overdue", "review due", "cash buffer pressure", "overdue commitment", "expected income overdue"].includes(signal))) return 2;
    if (signals.some((signal) => ["no execution path", "learning not captured", "no valid owner"].includes(signal))) return 4;
    return 5;
  };
  const getUrgencyTime = (objectType: string, id: string) =>
    input.recordFacts.get(`${objectType}:${id}`)?.urgencyTime ?? null;
  const candidatesByRecord = new Map<string, FounderFocusCandidate>();
  const addOrUpgradeCandidate = (candidate: FounderFocusCandidate) => {
    if (candidate.objectType === "Action"
      && input.recordFacts.get(`Action:${candidate.id}`)?.isWaitingAction) return;

    const existing = candidatesByRecord.get(candidate.key);
    if (!existing || candidate.band < existing.band || (candidate.band === existing.band && candidate.score >= existing.score)) {
      candidatesByRecord.set(candidate.key, candidate);
    }
  };

  input.signalledRecords.forEach((record) => {
    if (record.objectType === "Finance") return;
    const signalList = record.signals;
    const combinedReason = signalList.length > 1
      ? `Needs attention for ${signalList.length} reasons: ${signalList.join(", ")}.`
      : `Needs attention: ${signalList[0]}.`;

    addOrUpgradeCandidate({
      key: record.recordKey,
      objectType: record.objectType,
      id: record.id,
      title: record.title,
      area: record.area,
      score: record.baseScore + (signalList.length - 1) * 40,
      band: signalBand(signalList),
      urgencyTime: getUrgencyTime(record.objectType, record.id),
      reason: combinedReason,
    });
  });

  const reviewScore: Record<string, number> = {
    "Authority required": 400,
    "Critical escalation": 400,
    "Review due": 300,
    "Under review": 290,
    "High-risk judgement": 280,
  };
  input.founderReviewItems.forEach((item) => {
    const key = `${item.objectType}:${item.id}`;
    const existing = candidatesByRecord.get(key);
    const band = ["Authority required", "Critical escalation"].includes(item.reasonCategory) ? 1 : 2;
    addOrUpgradeCandidate({
      key,
      objectType: item.objectType,
      id: item.id,
      title: item.title,
      area: item.pillar,
      score: Math.max(existing?.score ?? 0, reviewScore[item.reasonCategory] ?? 280),
      band: Math.min(existing?.band ?? band, band),
      urgencyTime: existing?.urgencyTime ?? getUrgencyTime(item.objectType, item.id),
      reason: `${item.reasonCategory}: ${item.whyItMatters}`,
    });
  });

  input.limitations
    .filter((limitation) => limitation.severity === "Blocker" || limitation.severity === "Material")
    .forEach((limitation) => {
      const objectType = limitation.key === "ownership" ? "People" : limitation.action?.objectType;
      const id = limitation.key === "ownership" ? "unassigned" : limitation.action?.id;
      if (!objectType || !id) return;

      addOrUpgradeCandidate({
        key: `${objectType}:${id}`,
        objectType,
        id,
        title: limitation.label,
        area: objectType,
        score: limitation.severity === "Blocker" ? 390 : 250,
        band: limitation.severity === "Blocker" ? 1 : 3,
        urgencyTime: getUrgencyTime(objectType, id),
        reason: `Strategic data confidence ${limitation.severity.toLowerCase()} — ${limitation.label}.`,
      });
    });

  input.convergentRisks.forEach((cluster) => {
    const constituentCandidates = cluster.records
      .map((record) => candidatesByRecord.get(record.recordKey))
      .filter((candidate): candidate is FounderFocusCandidate => Boolean(candidate));
    const root = cluster.records.find((record) => record.recordKey === cluster.rootRecordKey)
      ?? cluster.records.reduce((best, item) => (item.baseScore > best.baseScore ? item : best), cluster.records[0]);
    const strongestScore = Math.max(...constituentCandidates.map((candidate) => candidate.score), 0);
    const strongestBand = Math.min(...constituentCandidates.map((candidate) => candidate.band), 3);
    const urgencyTimes = constituentCandidates
      .map((candidate) => candidate.urgencyTime)
      .filter((timestamp): timestamp is number => timestamp !== null);
    cluster.records.forEach((record) => candidatesByRecord.delete(record.recordKey));
    candidatesByRecord.set(cluster.clusterKey, {
      key: cluster.clusterKey,
      objectType: root.objectType,
      id: root.id,
      title: cluster.title,
      area: root.area,
      score: Math.max(strongestScore, 420 + cluster.categories.length * 10 + cluster.recordCount),
      band: strongestBand,
      urgencyTime: urgencyTimes.length > 0 ? Math.min(...urgencyTimes) : null,
      reason: `Convergent risk — one situation is generating ${cluster.categories.length} kinds of signal (${cluster.categories.join(", ")}) across ${cluster.recordCount} linked records, so it is systemic rather than isolated.`,
    });
  });

  const clusterKeyByRecordKey = indexConvergentSituationMembers(input.convergentRisks);
  input.strategicRisks?.forEach((risk) => {
    const treatmentReason = risk.treatmentReasons?.length
      ? ` Treatment accountability: ${risk.treatmentReasons.join("; ")}.`
      : "";
    const founderTreatmentReason = risk.founderOwnedTreatmentCount
      ? ` ${risk.founderOwnedTreatmentCount} treatment${risk.founderOwnedTreatmentCount === 1 ? " is" : "s are"} owned by the primary founder.`
      : "";
    const delegatedTreatmentReason = risk.delegatedTreatmentCount
      ? ` ${risk.delegatedTreatmentCount} treatment${risk.delegatedTreatmentCount === 1 ? " is" : "s are"} assigned to non-founder owners.`
      : "";
    const treatmentBand = treatmentReason || founderTreatmentReason
      ? Math.min(risk.band, 3)
      : risk.band;
    const treatmentText = `${treatmentReason}${founderTreatmentReason}${delegatedTreatmentReason}`;
    // The strategic-risk input is authoritative for its own identity; drop any generic signalled duplicate.
    const ownClusterKey = clusterKeyByRecordKey.get(risk.key);
    if (!ownClusterKey) candidatesByRecord.delete(risk.key);
    const anchored = [...(ownClusterKey ? [ownClusterKey] : []), ...risk.anchorRecordKeys]
      .map((recordKey) => candidatesByRecord.get(clusterKeyByRecordKey.get(recordKey) ?? recordKey))
      .filter((candidate): candidate is FounderFocusCandidate => Boolean(candidate))
      .sort(compareFounderFocusCandidates)[0];
    if (anchored) {
      const strategicRiskKeys = anchored.strategicRiskKeys ?? [];
      if (strategicRiskKeys.includes(risk.referenceKey)) return;
      candidatesByRecord.set(anchored.key, {
        ...anchored,
        band: Math.min(anchored.band, treatmentBand),
        score: Math.max(anchored.score, risk.score),
        reason: `${anchored.reason} Also: ${risk.reason}${treatmentText}`,
        strategicRiskKeys: [...strategicRiskKeys, risk.referenceKey],
      });
      return;
    }
    if (candidatesByRecord.has(risk.key)) return;
    candidatesByRecord.set(risk.key, {
      key: risk.key,
      objectType: risk.objectType,
      id: risk.id,
      title: risk.title,
      area: risk.area,
      score: risk.score,
      band: treatmentBand,
      urgencyTime: null,
      reason: `${risk.reason}${treatmentText}`,
      strategicRiskKeys: [risk.referenceKey],
    });
  });

  input.icarusLearning?.forEach((learning) => {
    const key = `Icarus:${learning.assessmentId}`;
    const host = candidatesByRecord.get(clusterKeyByRecordKey.get(key) ?? key)
      ?? [...candidatesByRecord.values()].find((candidate) => candidate.strategicRiskKeys?.includes(learning.identityKey));
    const reason = `Icarus learning: ${learning.reasons.join("; ")}`;
    if (host) candidatesByRecord.set(host.key, { ...host, reason: `${host.reason} ${reason}` });
    else candidatesByRecord.set(key, {
      key, objectType: "Icarus", id: learning.assessmentId, title: learning.title, area: "Icarus",
      score: 0, band: 5, urgencyTime: null, reason,
    });
  });
  return [...candidatesByRecord.values()].sort(compareFounderFocusCandidates);
}
