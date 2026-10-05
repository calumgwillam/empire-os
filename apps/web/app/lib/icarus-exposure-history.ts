import type { IcarusAssessmentStatus } from "./icarus";
import { ICARUS_EXPOSURES, compareIcarusSeverity, type IcarusExposure } from "./icarus-materiality-policy";
import type { IcarusStrategicSignal } from "./icarus-strategic-attention";

// Compact, persisted representation of material Icarus exposure at a point in time.
export type IcarusExposureSnapshotEntry = {
  key: string;
  assessmentId: string;
  outcome: string;
  exposure: IcarusExposure;
  failureModeIds: string[];
  riskScore: number;
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
};

const changeOrder: readonly IcarusExposureChangeKind[] = ["Worsened", "New", "Persistent", "Improved", "Resolved"];

export function buildIcarusExposureSnapshot(signals: readonly IcarusStrategicSignal[]): IcarusExposureSnapshotEntry[] {
  return signals
    .map((signal) => ({
      key: signal.key,
      assessmentId: signal.assessmentId,
      outcome: signal.outcome,
      exposure: signal.exposure,
      failureModeIds: signal.materialFailureModes.map((mode) => mode.failureModeId).sort(),
      riskScore: signal.riskScore,
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
    });
  });
  return [...entries.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export function compareIcarusExposure(input: {
  previous: readonly IcarusExposureSnapshotEntry[] | undefined;
  current: readonly IcarusExposureSnapshotEntry[];
  assessmentStatuses?: ReadonlyMap<string, IcarusAssessmentStatus>;
}): IcarusExposureTrajectory {
  const counts: Record<IcarusExposureChangeKind, number> = { New: 0, Worsened: 0, Persistent: 0, Improved: 0, Resolved: 0 };
  if (!input.previous) return { hasBaseline: false, changes: [], counts };

  const previousByKey = new Map(input.previous.map((entry) => [entry.key, entry] as const));
  const currentKeys = new Set(input.current.map((entry) => entry.key));
  const changes: IcarusExposureChange[] = [];

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
  return { hasBaseline: true, changes, counts };
}
