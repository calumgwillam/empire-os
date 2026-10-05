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

// Optional assurance state captured alongside exposure. Absent on legacy snapshots and when assurance was not derived.
export type IcarusAssuranceSnapshot = {
  state: IcarusAssuranceState;
  escalation: IcarusEscalationLevel;
  riskOwnerPersonId?: string;
  acceptance: "None" | IcarusAcceptanceValidity;
  failedControlIds: string[];
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
      ...(signal.assurance ? {
        assurance: {
          state: signal.assurance.state,
          escalation: signal.assurance.escalation,
          ...(signal.assurance.riskOwnerPersonId ? { riskOwnerPersonId: signal.assurance.riskOwnerPersonId } : {}),
          acceptance: signal.assurance.acceptance,
          failedControlIds: [...signal.assurance.failedControlIds].sort(),
        },
      } : {}),
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
    });
  });
  return [...entries.values()].sort((left, right) => left.key.localeCompare(right.key));
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
  if (!input.previous) {
    return { hasBaseline: false, changes: [], counts, hasAssuranceBaseline: false, assuranceChanges: [], assuranceCounts };
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
  return {
    hasBaseline: true,
    changes,
    counts,
    hasAssuranceBaseline: input.previous.some((entry) => entry.assurance !== undefined),
    assuranceChanges,
    assuranceCounts,
  };
}
