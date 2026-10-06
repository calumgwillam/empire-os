import type { IcarusAssessmentStatus } from "./icarus";
import { ICARUS_EXPOSURES, compareIcarusSeverity, type IcarusExposure } from "./icarus-materiality-policy";
import type { IcarusStrategicSignal } from "./icarus-strategic-attention";
import {
  ICARUS_ASSURANCE_STATES,
  ICARUS_ESCALATION_LEVELS,
  getIcarusAssuranceStateRank,
  type IcarusAcceptanceValidity,
  type IcarusAssuranceState,
  type IcarusEscalationLevel,
} from "./icarus-assurance-policy";
import {
  ICARUS_BLAST_RADII,
  ICARUS_CHAIN_PRIORITIES,
  getIcarusBlastRadiusRank,
  type IcarusBlastRadius,
  type IcarusChainPriority,
} from "./icarus-failure-chain-policy";
import {
  ICARUS_DEPENDENCY_HEALTH_STATES,
  type IcarusDependencyHealthState,
} from "./icarus-dependency-health";
import {
  ICARUS_DEPENDENCY_RESILIENCE_STATES,
  type IcarusDependencyResilienceState,
} from "./icarus-dependency-resilience";

// Optional assurance state captured alongside exposure. Absent on legacy snapshots and when assurance was not derived.
export type IcarusAssuranceSnapshot = {
  state: IcarusAssuranceState;
  escalation: IcarusEscalationLevel;
  riskOwnerPersonId?: string;
  acceptance: "None" | IcarusAcceptanceValidity;
  failedControlIds: string[];
};

// Optional failure-chain structure captured alongside exposure. Absent on legacy snapshots and when not derived.
export type IcarusFailureChainSnapshot = {
  priority: IcarusChainPriority;
  blastRadius: IcarusBlastRadius;
  spofKeys: string[];
  sharedDependencyKeys: string[];
  weakBarrierControlIds: string[];
};

export type IcarusDependencyHealthSnapshot = {
  dependencyKey: string;
  health: IcarusDependencyHealthState;
  resilience: IcarusDependencyResilienceState;
};

// Compact, persisted representation of material Icarus exposure at a point in time.
export type IcarusExposureSnapshotEntry = {
  key: string;
  assessmentId: string;
  outcome: string;
  exposure: IcarusExposure;
  failureModeIds: string[];
  riskScore: number;
  assurance?: IcarusAssuranceSnapshot;
  failureChain?: IcarusFailureChainSnapshot;
  dependencyHealth?: IcarusDependencyHealthSnapshot[];
};

export const ICARUS_STRUCTURAL_CHANGE_KINDS = [
  "Single point of failure appeared",
  "Became cross-pillar",
  "Blast radius increased",
  "Shared concentration increased",
  "Dependency health failed",
  "Dependency health degraded",
  "Dependency health became unknown",
  "Resilience deteriorated",
  "Single point of failure removed",
  "Blast radius decreased",
  "Barrier restored",
  "Dependency recovered",
  "Dependency health validated",
  "Resilience improved",
] as const;
export type IcarusStructuralChangeKind = (typeof ICARUS_STRUCTURAL_CHANGE_KINDS)[number];
export const ICARUS_STRUCTURAL_DETERIORATIONS: readonly IcarusStructuralChangeKind[] = [
  "Single point of failure appeared", "Became cross-pillar", "Blast radius increased", "Shared concentration increased",
  "Dependency health failed", "Dependency health degraded", "Dependency health became unknown", "Resilience deteriorated",
];

// Structural change keyed either by risk (blast/barrier) or by a SPOF / shared-dependency key (Empire-wide).
export type IcarusStructuralChange = {
  key: string;
  change: IcarusStructuralChangeKind;
  // Risks (snapshot keys) carrying the structure in the relevant snapshot; stable for navigation.
  riskKeys: string[];
  assessmentIds: string[];
  previousBlastRadius?: IcarusBlastRadius;
  blastRadius?: IcarusBlastRadius;
  // Barrier controls no longer weak/failed/unknown (only for "Barrier restored").
  controlIds: string[];
  previousCount?: number;
  count?: number;
  previousHealth?: IcarusDependencyHealthState;
  health?: IcarusDependencyHealthState;
  previousResilience?: IcarusDependencyResilienceState;
  resilience?: IcarusDependencyResilienceState;
};

export const ICARUS_ASSURANCE_CHANGE_KINDS = [
  "Assurance deteriorated",
  "Acceptance expired",
  "Owner removed",
  "Owner assigned",
  "Acceptance created",
  "Failed control remediated",
  "Assurance improved",
] as const;
export type IcarusAssuranceChangeKind = (typeof ICARUS_ASSURANCE_CHANGE_KINDS)[number];

export type IcarusAssuranceChange = {
  key: string;
  assessmentId: string;
  outcome: string;
  change: IcarusAssuranceChangeKind;
  previousState: IcarusAssuranceState;
  state: IcarusAssuranceState;
  // Failed controls no longer failing (only for "Failed control remediated").
  controlIds: string[];
};

export type IcarusExposureChangeKind = "New" | "Worsened" | "Persistent" | "Improved" | "Resolved";

// "No longer material": the assessment is still open but no failure mode currently meets the materiality rules.
export type IcarusExposureResolution = "Closed" | "No longer material" | "Removed";

export type IcarusExposureChange = {
  key: string;
  assessmentId: string;
  outcome: string;
  change: IcarusExposureChangeKind;
  exposure?: IcarusExposure;
  previousExposure?: IcarusExposure;
  addedFailureModeIds: string[];
  removedFailureModeIds: string[];
  resolution?: IcarusExposureResolution;
};

export type IcarusExposureTrajectory = {
  hasBaseline: boolean;
  changes: IcarusExposureChange[];
  counts: Record<IcarusExposureChangeKind, number>;
  // Assurance is only compared where both snapshots carry assurance for the same risk.
  hasAssuranceBaseline: boolean;
  assuranceChanges: IcarusAssuranceChange[];
  assuranceCounts: Record<IcarusAssuranceChangeKind, number>;
  // Failure-chain structure is only compared where the previous snapshot carried it.
  hasStructuralBaseline: boolean;
  structuralChanges: IcarusStructuralChange[];
  structuralCounts: Record<IcarusStructuralChangeKind, number>;
};

const changeOrder: readonly IcarusExposureChangeKind[] = ["Worsened", "New", "Persistent", "Improved", "Resolved"];

export function buildIcarusExposureSnapshot(
  signals: readonly IcarusStrategicSignal[],
  dependencyHealthByAssessment: ReadonlyMap<string, readonly IcarusDependencyHealthSnapshot[]> = new Map(),
): IcarusExposureSnapshotEntry[] {
  return signals
    .map((signal) => ({
      key: signal.key,
      assessmentId: signal.assessmentId,
      outcome: signal.outcome,
      exposure: signal.exposure,
      failureModeIds: signal.materialFailureModes.map((mode) => mode.failureModeId).sort(),
      riskScore: signal.riskScore,
      ...(signal.assurance ? {
        assurance: {
          state: signal.assurance.state,
          escalation: signal.assurance.escalation,
          ...(signal.assurance.riskOwnerPersonId ? { riskOwnerPersonId: signal.assurance.riskOwnerPersonId } : {}),
          acceptance: signal.assurance.acceptance,
          failedControlIds: [...signal.assurance.failedControlIds].sort(),
        },
      } : {}),
      ...(signal.failureChain ? {
        failureChain: {
          priority: signal.failureChain.priority,
          blastRadius: signal.failureChain.blastRadius,
          spofKeys: [...signal.failureChain.spofKeys].sort(),
          sharedDependencyKeys: [...signal.failureChain.sharedDependencyKeys].sort(),
          weakBarrierControlIds: [...signal.failureChain.weakBarrierControlIds].sort(),
        },
      } : {}),
      ...(dependencyHealthByAssessment.get(signal.assessmentId)
        ? { dependencyHealth: [...dependencyHealthByAssessment.get(signal.assessmentId)!]
          .sort((left, right) => left.dependencyKey.localeCompare(right.dependencyKey)) }
        : {}),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

// Returns undefined for legacy snapshots that predate Icarus history, so absence is never read as "no exposure".
export function normaliseIcarusExposureSnapshot(value: unknown): IcarusExposureSnapshotEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = new Map<string, IcarusExposureSnapshotEntry>();
  value.forEach((entry: unknown) => {
    if (!entry || typeof entry !== "object") return;
    const record = entry as Record<string, unknown>;
    if (typeof record.key !== "string" || typeof record.assessmentId !== "string") return;
    if (!ICARUS_EXPOSURES.includes(record.exposure as IcarusExposure)) return;
    if (entries.has(record.key)) return;
    entries.set(record.key, {
      key: record.key,
      assessmentId: record.assessmentId,
      outcome: typeof record.outcome === "string" ? record.outcome : record.assessmentId,
      exposure: record.exposure as IcarusExposure,
      failureModeIds: Array.isArray(record.failureModeIds)
        ? [...new Set(record.failureModeIds.filter((id): id is string => typeof id === "string"))].sort()
        : [],
      riskScore: typeof record.riskScore === "number" && Number.isFinite(record.riskScore) ? record.riskScore : 0,
      ...normaliseAssuranceSnapshot(record.assurance),
      ...normaliseFailureChainSnapshot(record.failureChain),
      ...normaliseDependencyHealthSnapshot(record.dependencyHealth),
    });
  });
  return [...entries.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function normaliseDependencyHealthSnapshot(value: unknown): { dependencyHealth?: IcarusDependencyHealthSnapshot[] } {
  if (!Array.isArray(value)) return {};
  const entries = new Map<string, IcarusDependencyHealthSnapshot>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return {};
    const record = entry as Record<string, unknown>;
    if (typeof record.dependencyKey !== "string" || !record.dependencyKey.trim()) return {};
    if (!ICARUS_DEPENDENCY_HEALTH_STATES.includes(record.health as IcarusDependencyHealthState)) return {};
    if (!ICARUS_DEPENDENCY_RESILIENCE_STATES.includes(record.resilience as IcarusDependencyResilienceState)) return {};
    const snapshot: IcarusDependencyHealthSnapshot = {
      dependencyKey: record.dependencyKey,
      health: record.health as IcarusDependencyHealthState,
      resilience: record.resilience as IcarusDependencyResilienceState,
    };
    const existing = entries.get(snapshot.dependencyKey);
    if (existing && (existing.health !== snapshot.health || existing.resilience !== snapshot.resilience)) return {};
    entries.set(snapshot.dependencyKey, snapshot);
  }
  return { dependencyHealth: [...entries.values()].sort((left, right) => left.dependencyKey.localeCompare(right.dependencyKey)) };
}

const acceptanceValues: readonly IcarusAssuranceSnapshot["acceptance"][] = ["None", "Active", "Expired", "Invalid", "Revoked"];

// Malformed assurance is dropped (never guessed); the exposure entry itself is still kept.
function normaliseAssuranceSnapshot(value: unknown): { assurance?: IcarusAssuranceSnapshot } {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  if (!ICARUS_ASSURANCE_STATES.includes(record.state as IcarusAssuranceState)) return {};
  if (!ICARUS_ESCALATION_LEVELS.includes(record.escalation as IcarusEscalationLevel)) return {};
  return {
    assurance: {
      state: record.state as IcarusAssuranceState,
      escalation: record.escalation as IcarusEscalationLevel,
      ...(typeof record.riskOwnerPersonId === "string" && record.riskOwnerPersonId.trim()
        ? { riskOwnerPersonId: record.riskOwnerPersonId } : {}),
      acceptance: acceptanceValues.includes(record.acceptance as IcarusAssuranceSnapshot["acceptance"])
        ? record.acceptance as IcarusAssuranceSnapshot["acceptance"] : "None",
      failedControlIds: Array.isArray(record.failedControlIds)
        ? [...new Set(record.failedControlIds.filter((id): id is string => typeof id === "string"))].sort()
        : [],
    },
  };
}

const uniqueStrings = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((id): id is string => typeof id === "string"))].sort()
  : [];

// Malformed structure is dropped (never guessed); the exposure entry itself is still kept.
function normaliseFailureChainSnapshot(value: unknown): { failureChain?: IcarusFailureChainSnapshot } {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  if (!ICARUS_CHAIN_PRIORITIES.includes(record.priority as IcarusChainPriority)) return {};
  if (!ICARUS_BLAST_RADII.includes(record.blastRadius as IcarusBlastRadius)) return {};
  return {
    failureChain: {
      priority: record.priority as IcarusChainPriority,
      blastRadius: record.blastRadius as IcarusBlastRadius,
      spofKeys: uniqueStrings(record.spofKeys),
      sharedDependencyKeys: uniqueStrings(record.sharedDependencyKeys),
      weakBarrierControlIds: uniqueStrings(record.weakBarrierControlIds),
    },
  };
}

function holdersByKey(
  entries: readonly IcarusExposureSnapshotEntry[],
  select: (chain: IcarusFailureChainSnapshot) => readonly string[],
): Map<string, IcarusExposureSnapshotEntry[]> {
  const holders = new Map<string, IcarusExposureSnapshotEntry[]>();
  entries.forEach((entry) => {
    if (!entry.failureChain) return;
    select(entry.failureChain).forEach((key) => holders.set(key, [...(holders.get(key) ?? []), entry]));
  });
  return holders;
}

type DependencyHealthHolders = {
  health: IcarusDependencyHealthState;
  resilience: IcarusDependencyResilienceState;
  holders: IcarusExposureSnapshotEntry[];
};

function dependencyHealthHolders(
  entries: readonly IcarusExposureSnapshotEntry[],
): Map<string, DependencyHealthHolders> {
  const holders = new Map<string, DependencyHealthHolders>();
  const conflicting = new Set<string>();
  entries.forEach((entry) => entry.dependencyHealth?.forEach((snapshot) => {
    const existing = holders.get(snapshot.dependencyKey);
    if (!existing) {
      holders.set(snapshot.dependencyKey, { health: snapshot.health, resilience: snapshot.resilience, holders: [entry] });
      return;
    }
    if (existing.health !== snapshot.health || existing.resilience !== snapshot.resilience) {
      conflicting.add(snapshot.dependencyKey);
      return;
    }
    existing.holders.push(entry);
  }));
  conflicting.forEach((key) => holders.delete(key));
  return holders;
}

const holderIds = (entries: readonly IcarusExposureSnapshotEntry[]) => ({
  riskKeys: [...new Set(entries.map((entry) => entry.key))].sort(),
  assessmentIds: [...new Set(entries.map((entry) => entry.assessmentId))].sort(),
});

function compareStructure(
  previous: readonly IcarusExposureSnapshotEntry[],
  current: readonly IcarusExposureSnapshotEntry[],
): IcarusStructuralChange[] {
  const changes: IcarusStructuralChange[] = [];
  const previousByKey = new Map(previous.map((entry) => [entry.key, entry] as const));

  current.forEach((entry) => {
    const before = previousByKey.get(entry.key)?.failureChain;
    const after = entry.failureChain;
    if (!before || !after) return;
    const base = { key: entry.key, riskKeys: [entry.key], assessmentIds: [entry.assessmentId], controlIds: [] };
    const delta = getIcarusBlastRadiusRank(after.blastRadius) - getIcarusBlastRadiusRank(before.blastRadius);
    const crossPillar = getIcarusBlastRadiusRank("Cross-pillar");
    if (delta > 0) {
      const becameCrossPillar = getIcarusBlastRadiusRank(before.blastRadius) < crossPillar
        && getIcarusBlastRadiusRank(after.blastRadius) >= crossPillar;
      changes.push({
        ...base, change: becameCrossPillar ? "Became cross-pillar" : "Blast radius increased",
        previousBlastRadius: before.blastRadius, blastRadius: after.blastRadius,
      });
    }
    if (delta < 0) {
      changes.push({ ...base, change: "Blast radius decreased", previousBlastRadius: before.blastRadius, blastRadius: after.blastRadius });
    }
    const stillWeak = new Set(after.weakBarrierControlIds);
    const restored = before.weakBarrierControlIds.filter((id) => !stillWeak.has(id));
    if (restored.length > 0) changes.push({ ...base, change: "Barrier restored", controlIds: restored });
  });

  // SPOFs and shared dependencies are Empire-wide structures: compared by key across all carrying risks, so one
  // SPOF carried by several risks is one change, not several.
  const previousSpofs = holdersByKey(previous, (chain) => chain.spofKeys);
  const currentSpofs = holdersByKey(current, (chain) => chain.spofKeys);
  currentSpofs.forEach((holders, key) => {
    if (!previousSpofs.has(key)) changes.push({ key, change: "Single point of failure appeared", ...holderIds(holders), controlIds: [] });
  });
  previousSpofs.forEach((holders, key) => {
    if (!currentSpofs.has(key)) changes.push({ key, change: "Single point of failure removed", ...holderIds(holders), controlIds: [] });
  });
  const previousShared = holdersByKey(previous, (chain) => chain.sharedDependencyKeys);
  holdersByKey(current, (chain) => chain.sharedDependencyKeys).forEach((holders, key) => {
    const count = holderIds(holders).assessmentIds.length;
    const previousCount = holderIds(previousShared.get(key) ?? []).assessmentIds.length;
    if (count >= 2 && count > previousCount) {
      changes.push({ key, change: "Shared concentration increased", ...holderIds(holders), controlIds: [], previousCount, count });
    }
  });
  const previousDependencyHealth = dependencyHealthHolders(previous);
  const currentDependencyHealth = dependencyHealthHolders(current);
  const resilienceRank: Record<IcarusDependencyResilienceState, number> = {
    Resilient: 0,
    Adequate: 1,
    Fragile: 2,
    "Critical dependency": 3,
    Unknown: -1,
  };
  [...previousDependencyHealth.keys()].filter((key) => currentDependencyHealth.has(key)).sort().forEach((key) => {
    const before = previousDependencyHealth.get(key)!;
    const after = currentDependencyHealth.get(key)!;
    const holders = [...new Map([...before.holders, ...after.holders].map((entry) => [entry.key, entry] as const)).values()];
    const base = {
      key: `Dependency:${key}`,
      ...holderIds(holders),
      controlIds: [],
    };
    if (before.health !== after.health) {
      let change: IcarusStructuralChangeKind | undefined;
      if (after.health === "Failed") change = "Dependency health failed";
      else if (after.health === "Degraded" && (before.health === "Healthy" || before.health === "Watch")) {
        change = "Dependency health degraded";
      } else if (after.health === "Unknown" && before.health !== "Unknown" && before.health !== "Not applicable") {
        change = "Dependency health became unknown";
      } else if (before.health === "Unknown" && after.health !== "Unknown" && after.health !== "Not applicable") {
        change = "Dependency health validated";
      } else if ((before.health === "Failed" || before.health === "Degraded") && (after.health === "Healthy" || after.health === "Watch")) {
        change = "Dependency recovered";
      }
      if (change) changes.push({ ...base, change, previousHealth: before.health, health: after.health });
    }
    if (before.resilience !== after.resilience) {
      const beforeRank = resilienceRank[before.resilience];
      const afterRank = resilienceRank[after.resilience];
      if (beforeRank >= 0 && afterRank >= 0 && beforeRank !== afterRank) {
        changes.push({
          ...base,
          change: afterRank > beforeRank ? "Resilience deteriorated" : "Resilience improved",
          previousResilience: before.resilience,
          resilience: after.resilience,
        });
      }
    }
  });

  return changes.sort((left, right) =>
    ICARUS_STRUCTURAL_CHANGE_KINDS.indexOf(left.change) - ICARUS_STRUCTURAL_CHANGE_KINDS.indexOf(right.change)
    || left.key.localeCompare(right.key));
}

function compareAssurance(
  previous: IcarusExposureSnapshotEntry,
  current: IcarusExposureSnapshotEntry,
): IcarusAssuranceChange[] {
  if (!previous.assurance || !current.assurance) return [];
  const before = previous.assurance;
  const after = current.assurance;
  const base = { key: current.key, assessmentId: current.assessmentId, outcome: current.outcome, previousState: before.state, state: after.state };
  const changes: IcarusAssuranceChange[] = [];
  const rankDelta = getIcarusAssuranceStateRank(after.state) - getIcarusAssuranceStateRank(before.state);
  if (rankDelta < 0) changes.push({ ...base, change: "Assurance deteriorated", controlIds: [] });
  if (rankDelta > 0) changes.push({ ...base, change: "Assurance improved", controlIds: [] });
  if (!before.riskOwnerPersonId && after.riskOwnerPersonId) changes.push({ ...base, change: "Owner assigned", controlIds: [] });
  if (before.riskOwnerPersonId && !after.riskOwnerPersonId) changes.push({ ...base, change: "Owner removed", controlIds: [] });
  if (before.acceptance !== "Active" && before.acceptance !== "Expired" && after.acceptance === "Active") {
    changes.push({ ...base, change: "Acceptance created", controlIds: [] });
  }
  if (before.acceptance !== "Expired" && after.acceptance === "Expired") changes.push({ ...base, change: "Acceptance expired", controlIds: [] });
  const stillFailing = new Set(after.failedControlIds);
  const remediated = before.failedControlIds.filter((id) => !stillFailing.has(id));
  if (remediated.length > 0) changes.push({ ...base, change: "Failed control remediated", controlIds: remediated });
  return changes;
}

function emptyAssuranceCounts(): Record<IcarusAssuranceChangeKind, number> {
  return Object.fromEntries(ICARUS_ASSURANCE_CHANGE_KINDS.map((kind) => [kind, 0])) as Record<IcarusAssuranceChangeKind, number>;
}

export function compareIcarusExposure(input: {
  previous: readonly IcarusExposureSnapshotEntry[] | undefined;
  current: readonly IcarusExposureSnapshotEntry[];
  assessmentStatuses?: ReadonlyMap<string, IcarusAssessmentStatus>;
}): IcarusExposureTrajectory {
  const counts: Record<IcarusExposureChangeKind, number> = { New: 0, Worsened: 0, Persistent: 0, Improved: 0, Resolved: 0 };
  const assuranceCounts = emptyAssuranceCounts();
  const structuralCounts = Object.fromEntries(ICARUS_STRUCTURAL_CHANGE_KINDS.map((kind) => [kind, 0])) as Record<IcarusStructuralChangeKind, number>;
  if (!input.previous) {
    return {
      hasBaseline: false, changes: [], counts, hasAssuranceBaseline: false, assuranceChanges: [], assuranceCounts,
      hasStructuralBaseline: false, structuralChanges: [], structuralCounts,
    };
  }

  const previousByKey = new Map(input.previous.map((entry) => [entry.key, entry] as const));
  const currentKeys = new Set(input.current.map((entry) => entry.key));
  const changes: IcarusExposureChange[] = [];
  const assuranceChanges: IcarusAssuranceChange[] = [];

  input.current.forEach((entry) => {
    const previous = previousByKey.get(entry.key);
    if (!previous) {
      changes.push({
        key: entry.key, assessmentId: entry.assessmentId, outcome: entry.outcome, change: "New",
        exposure: entry.exposure, addedFailureModeIds: [...entry.failureModeIds], removedFailureModeIds: [],
      });
      return;
    }
    const previousModes = new Set(previous.failureModeIds);
    const currentModes = new Set(entry.failureModeIds);
    const addedFailureModeIds = entry.failureModeIds.filter((id) => !previousModes.has(id));
    const removedFailureModeIds = previous.failureModeIds.filter((id) => !currentModes.has(id));
    // Shared severity policy: a more severe tier or a newly exposed mechanism is worsening even if another
    // mechanism was controlled.
    const change: IcarusExposureChangeKind = compareIcarusSeverity(previous, entry);
    assuranceChanges.push(...compareAssurance(previous, entry));
    changes.push({
      key: entry.key, assessmentId: entry.assessmentId, outcome: entry.outcome, change,
      exposure: entry.exposure, previousExposure: previous.exposure, addedFailureModeIds, removedFailureModeIds,
    });
  });

  input.previous.forEach((previous) => {
    if (currentKeys.has(previous.key)) return;
    const status = input.assessmentStatuses?.get(previous.assessmentId);
    changes.push({
      key: previous.key, assessmentId: previous.assessmentId, outcome: previous.outcome, change: "Resolved",
      previousExposure: previous.exposure, addedFailureModeIds: [], removedFailureModeIds: [...previous.failureModeIds],
      resolution: status === undefined ? "Removed" : status === "Closed" ? "Closed" : "No longer material",
    });
  });

  changes.sort((left, right) =>
    changeOrder.indexOf(left.change) - changeOrder.indexOf(right.change) || left.key.localeCompare(right.key));
  changes.forEach((entry) => { counts[entry.change] += 1; });
  assuranceChanges.sort((left, right) =>
    ICARUS_ASSURANCE_CHANGE_KINDS.indexOf(left.change) - ICARUS_ASSURANCE_CHANGE_KINDS.indexOf(right.change)
    || left.key.localeCompare(right.key));
  assuranceChanges.forEach((entry) => { assuranceCounts[entry.change] += 1; });
  const hasStructuralBaseline = input.previous.some((entry) =>
    entry.failureChain !== undefined || entry.dependencyHealth !== undefined);
  const structuralChanges = hasStructuralBaseline ? compareStructure(input.previous, input.current) : [];
  structuralChanges.forEach((entry) => { structuralCounts[entry.change] += 1; });
  return {
    hasBaseline: true,
    changes,
    counts,
    hasAssuranceBaseline: input.previous.some((entry) => entry.assurance !== undefined),
    assuranceChanges,
    assuranceCounts,
    hasStructuralBaseline,
    structuralChanges,
    structuralCounts,
  };
}
