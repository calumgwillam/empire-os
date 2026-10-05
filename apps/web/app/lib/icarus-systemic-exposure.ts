import { getIcarusExposureRank, isIcarusMaterialExposure, type IcarusExposure } from "./icarus-materiality-policy";
import type { IcarusAttentionReference, IcarusStrategicSignal } from "./icarus-strategic-attention";
import {
  OPERATING_PILLARS,
  compareOperatingPillars,
  resolveOperatingPillar,
  type OperatingPillarId,
  type OperatingPillarIdentity,
} from "./pillar-identity";

// Ordered from least to most severe; index is the state rank.
export const ICARUS_PILLAR_EXPOSURE_STATES = [
  "No material exposure",
  "Watch",
  "Material exposure",
  "Systemic exposure",
] as const;

export type IcarusPillarExposureState = (typeof ICARUS_PILLAR_EXPOSURE_STATES)[number];

// Interpretable reasons for the derived state; never a synthetic score.
export type IcarusPillarExposureBasis =
  | "evidenced-or-failing-exposure"
  | "multiple-material-assessments"
  | "multiple-evidenced-or-failing-assessments"
  | "convergent-situation"
  | "cross-system-signals"
  | "unverified-or-unexamined-only";

export type IcarusPillarAttribution = "Pillar link" | "Linked record";

export type IcarusExposureHighlight = {
  assessmentId: string;
  outcome: string;
  exposure: IcarusExposure;
  riskScore: number;
  reference: IcarusAttentionReference;
};

export type IcarusPillarExposure = {
  // Canonical operating-pillar identity; `pillar` is its display label.
  pillarId: OperatingPillarId;
  pillar: string;
  state: IcarusPillarExposureState;
  basis: IcarusPillarExposureBasis[];
  pattern: "None" | "Isolated" | "Multi-signal";
  assessmentCount: number;
  evidencedOrFailingAssessmentCount: number;
  materialFailureModeCount: number;
  exposedFailureModeCount: number;
  failingControlCount: number;
  unverifiedControlCount: number;
  unexaminedFailureModeCount: number;
  highest: IcarusExposureHighlight | null;
  assessments: (IcarusExposureHighlight & { attribution: IcarusPillarAttribution[] })[];
  otherSignalCategories: string[];
  otherSignalRecordKeys: string[];
  convergentClusterKeys: string[];
};

export type IcarusObjectiveConcentration = {
  objectiveId: string;
  concentrated: boolean;
  strongestExposure: IcarusExposure;
  assessmentIds: string[];
  materialFailureModeCount: number;
  exposedFailureModeCount: number;
  references: IcarusAttentionReference[];
};

export type IcarusSystemicExposureInput = {
  signals: readonly IcarusStrategicSignal[];
  // Operating pillars to roll up (any legacy/current form; resolved canonically). Defaults to every operating pillar.
  // Values that do not resolve to an operating pillar (e.g. strategic themes) are ignored rather than coerced.
  pillars?: readonly string[];
  // Attention identity (e.g. "Project:p") -> stored pillar/area value of that record, used when an assessment links a
  // record rather than a pillar. Values are resolved canonically.
  recordPillars?: ReadonlyMap<string, string>;
  // Non-Icarus signalled records (deduplicated by record key) from the correlation layer.
  otherSignals?: readonly { recordKey: string; area: string; signals: readonly string[] }[];
  // Correlated situations that include Icarus assessments.
  clusters?: readonly { clusterKey: string; convergent: boolean; assessmentIds: readonly string[] }[];
};

export type IcarusSystemicExposure = {
  pillars: IcarusPillarExposure[];
  objectives: IcarusObjectiveConcentration[];
  unattributedAssessmentIds: string[];
};

export function getIcarusPillarExposureStateRank(state: IcarusPillarExposureState): number {
  return ICARUS_PILLAR_EXPOSURE_STATES.indexOf(state);
}

const isEvidencedOrFailing = isIcarusMaterialExposure;

function highlight(signal: IcarusStrategicSignal): IcarusExposureHighlight {
  return {
    assessmentId: signal.assessmentId,
    outcome: signal.outcome,
    exposure: signal.exposure,
    riskScore: signal.riskScore,
    reference: { ...signal.primaryReference },
  };
}

function compareSignals(left: IcarusStrategicSignal, right: IcarusStrategicSignal): number {
  return getIcarusExposureRank(left.exposure) - getIcarusExposureRank(right.exposure)
    || right.riskScore - left.riskScore
    || left.assessmentId.localeCompare(right.assessmentId);
}

// Each failure mode and control is counted once per pillar even if several links attribute it there.
function countModes(signals: readonly IcarusStrategicSignal[]) {
  const modes = new Set<string>();
  const exposedModes = new Set<string>();
  const unexaminedModes = new Set<string>();
  const failingControls = new Set<string>();
  const unverifiedControls = new Set<string>();
  signals.forEach((signal) => signal.materialFailureModes.forEach((mode) => {
    const modeKey = `${signal.assessmentId}:${mode.failureModeId}`;
    modes.add(modeKey);
    if (mode.exposure === "Exposed") exposedModes.add(modeKey);
    if (mode.exposure === "Unexamined strategic exposure") unexaminedModes.add(modeKey);
    mode.weakControlIds.forEach((controlId) => {
      const controlKey = `${signal.assessmentId}:${controlId}`;
      if (mode.controlGap === "Failing") failingControls.add(controlKey);
      else unverifiedControls.add(controlKey);
    });
  }));
  failingControls.forEach((key) => unverifiedControls.delete(key));
  return { modes, exposedModes, unexaminedModes, failingControls, unverifiedControls };
}

export function buildIcarusSystemicExposure(input: IcarusSystemicExposureInput): IcarusSystemicExposure {
  const rollupPillars = new Map<OperatingPillarId, OperatingPillarIdentity>();
  (input.pillars ?? OPERATING_PILLARS.map((pillar) => pillar.label)).forEach((value) => {
    const pillar = resolveOperatingPillar(value);
    if (pillar) rollupPillars.set(pillar.id, pillar);
  });
  const attributions = new Map<OperatingPillarId, Map<string, Set<IcarusPillarAttribution>>>();
  const attribute = (pillar: OperatingPillarIdentity | null, assessmentId: string, attribution: IcarusPillarAttribution) => {
    if (!pillar || !rollupPillars.has(pillar.id)) return false;
    if (!attributions.has(pillar.id)) attributions.set(pillar.id, new Map());
    const byAssessment = attributions.get(pillar.id)!;
    if (!byAssessment.has(assessmentId)) byAssessment.set(assessmentId, new Set());
    byAssessment.get(assessmentId)!.add(attribution);
    return true;
  };

  const unattributedAssessmentIds: string[] = [];
  input.signals.forEach((signal) => {
    let attributed = false;
    // Explicit Pillar links (assessment, control or evidence) already resolved to canonical operating pillars.
    signal.operatingPillars.forEach((pillar) => {
      if (attribute(pillar, signal.assessmentId, "Pillar link")) attributed = true;
    });
    signal.anchors.forEach((anchor) => {
      const value = input.recordPillars?.get(`${anchor.objectType}:${anchor.id}`);
      if (value && attribute(resolveOperatingPillar(value), signal.assessmentId, "Linked record")) attributed = true;
    });
    if (!attributed) unattributedAssessmentIds.push(signal.assessmentId);
  });

  const signalsById = new Map(input.signals.map((signal) => [signal.assessmentId, signal] as const));
  const pillars = [...rollupPillars.values()].sort(compareOperatingPillars).map((pillarIdentity): IcarusPillarExposure => {
    const pillar = pillarIdentity.label;
    const byAssessment = attributions.get(pillarIdentity.id) ?? new Map<string, Set<IcarusPillarAttribution>>();
    const pillarSignals = [...byAssessment.keys()]
      .map((assessmentId) => signalsById.get(assessmentId)!)
      .sort(compareSignals);
    const counts = countModes(pillarSignals);
    const evidencedOrFailing = pillarSignals.filter((signal) => isEvidencedOrFailing(signal.exposure));
    const assessmentIds = new Set(pillarSignals.map((signal) => signal.assessmentId));

    const otherRecords = (input.otherSignals ?? []).filter((record) => resolveOperatingPillar(record.area)?.id === pillarIdentity.id);
    const otherSignalCategories = [...new Set(otherRecords.flatMap((record) => record.signals))].sort();
    const otherSignalRecordKeys = [...new Set(otherRecords.map((record) => record.recordKey))].sort();
    const convergentClusterKeys = (input.clusters ?? [])
      .filter((cluster) => cluster.convergent && cluster.assessmentIds.some((id) => assessmentIds.has(id)))
      .map((cluster) => cluster.clusterKey)
      .sort();

    const basis: IcarusPillarExposureBasis[] = [];
    let state: IcarusPillarExposureState = "No material exposure";
    if (pillarSignals.length > 0) {
      if (evidencedOrFailing.length > 0) basis.push("evidenced-or-failing-exposure");
      if (pillarSignals.length >= 2) basis.push("multiple-material-assessments");
      if (evidencedOrFailing.length >= 2) basis.push("multiple-evidenced-or-failing-assessments");
      if (convergentClusterKeys.length > 0) basis.push("convergent-situation");
      if (otherSignalCategories.length >= 2) basis.push("cross-system-signals");
      if (evidencedOrFailing.length === 0) basis.push("unverified-or-unexamined-only");

      const material = evidencedOrFailing.length > 0 || pillarSignals.length >= 2;
      const systemic = evidencedOrFailing.length > 0 && (
        evidencedOrFailing.length >= 2 || convergentClusterKeys.length > 0 || otherSignalCategories.length >= 2
      );
      state = systemic ? "Systemic exposure" : material ? "Material exposure" : "Watch";
    }

    return {
      pillarId: pillarIdentity.id,
      pillar,
      state,
      basis,
      pattern: pillarSignals.length === 0
        ? "None"
        : otherSignalCategories.length > 0 || convergentClusterKeys.length > 0 ? "Multi-signal" : "Isolated",
      assessmentCount: pillarSignals.length,
      evidencedOrFailingAssessmentCount: evidencedOrFailing.length,
      materialFailureModeCount: counts.modes.size,
      exposedFailureModeCount: counts.exposedModes.size,
      failingControlCount: counts.failingControls.size,
      unverifiedControlCount: counts.unverifiedControls.size,
      unexaminedFailureModeCount: counts.unexaminedModes.size,
      highest: pillarSignals[0] ? highlight(pillarSignals[0]) : null,
      assessments: pillarSignals.map((signal) => ({
        ...highlight(signal),
        attribution: (["Pillar link", "Linked record"] as const).filter((entry) => byAssessment.get(signal.assessmentId)!.has(entry)),
      })),
      otherSignalCategories,
      otherSignalRecordKeys,
      convergentClusterKeys,
    };
  });

  const objectiveSignals = new Map<string, IcarusStrategicSignal[]>();
  input.signals.forEach((signal) => {
    new Set(signal.strategicLinks
      .filter((reference) => reference.recordType === "Strategic Objective")
      .map((reference) => reference.recordId))
      .forEach((objectiveId) => {
        if (!objectiveSignals.has(objectiveId)) objectiveSignals.set(objectiveId, []);
        objectiveSignals.get(objectiveId)!.push(signal);
      });
  });
  const objectives = [...objectiveSignals.entries()]
    .map(([objectiveId, signals]): IcarusObjectiveConcentration => {
      const ordered = [...signals].sort(compareSignals);
      const counts = countModes(ordered);
      return {
        objectiveId,
        concentrated: counts.modes.size >= 2,
        strongestExposure: ordered[0].exposure,
        assessmentIds: ordered.map((signal) => signal.assessmentId),
        materialFailureModeCount: counts.modes.size,
        exposedFailureModeCount: counts.exposedModes.size,
        references: ordered.map((signal) => ({ ...signal.primaryReference })),
      };
    })
    .sort((left, right) =>
      Number(right.concentrated) - Number(left.concentrated)
      || getIcarusExposureRank(left.strongestExposure) - getIcarusExposureRank(right.strongestExposure)
      || right.materialFailureModeCount - left.materialFailureModeCount
      || left.objectiveId.localeCompare(right.objectiveId));

  return { pillars, objectives, unattributedAssessmentIds: unattributedAssessmentIds.sort() };
}
