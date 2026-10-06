import { getIcarusReferenceKey } from "./icarus";
import type { IcarusDependencyHealth } from "./icarus-dependency-health";
import type { IcarusDependencyGraph, IcarusChainControl } from "./icarus-failure-chain-graph";
import { isIcarusBarrierCapable } from "./icarus-failure-chain-policy";
import { OPERATING_PILLARS } from "./pillar-identity";
import { propagateIcarusFailure } from "./icarus-failure-chain-graph";

export const ICARUS_DEPENDENCY_RESILIENCE_STATES = [
  "Resilient",
  "Adequate",
  "Fragile",
  "Critical dependency",
  "Unknown",
] as const;

export type IcarusDependencyResilienceState = (typeof ICARUS_DEPENDENCY_RESILIENCE_STATES)[number];

export type IcarusDependencyIndependence =
  | "Independent"
  | "Shared dependency"
  | "Unknown independence";

export type IcarusDependencyConcentration =
  | "Local"
  | "Multi-risk"
  | "Multi-objective"
  | "Cross-pillar"
  | "Systemic";

export type IcarusDependencyResilienceBasis =
  | "unknown-health"
  | "failed-health"
  | "degraded-health"
  | "watch-health"
  | "single-required-path"
  | "shared-required-dependency"
  | "independence-unverified"
  | "multiple-material-risks"
  | "multiple-objectives"
  | "cross-pillar-reach"
  | "critical-objective-reach";

export type IcarusDependencyResilience = {
  reference: IcarusDependencyHealth["reference"];
  health: IcarusDependencyHealth["health"];
  resilience: IcarusDependencyResilienceState;
  independence: IcarusDependencyIndependence;
  concentration: IcarusDependencyConcentration;
  basis: IcarusDependencyResilienceBasis[];
  assessmentIds: string[];
  materialAssessmentIds: string[];
  objectiveIds: string[];
  criticalObjectiveIds: string[];
  pillarIds: string[];
};

export type IcarusResilienceInterventionKind = "Restore" | "Validate" | "Add independent backup";

export type IcarusResilienceIntervention = {
  reference: IcarusDependencyHealth["reference"];
  kind: IcarusResilienceInterventionKind;
  resilience: IcarusDependencyResilienceState;
  concentration: IcarusDependencyConcentration;
  basis: IcarusDependencyResilienceBasis[];
  assessmentIds: string[];
  objectiveIds: string[];
  pillarIds: string[];
};

function getConcentration(input: {
  assessmentCount: number;
  objectiveCount: number;
  pillarCount: number;
  operatingPillarTotal: number;
}): IcarusDependencyConcentration {
  if (input.pillarCount >= input.operatingPillarTotal && input.operatingPillarTotal > 1) return "Systemic";
  if (input.pillarCount > 1) return "Cross-pillar";
  if (input.objectiveCount > 1) return "Multi-objective";
  if (input.assessmentCount > 1) return "Multi-risk";
  return "Local";
}

function controlsForMode(graph: IcarusDependencyGraph, modeNodeId: string): IcarusChainControl[] {
  const mode = graph.modeById.get(modeNodeId);
  return mode ? mode.controlNodeIds.map((nodeId) => graph.controlById.get(nodeId)).filter((value): value is IcarusChainControl => Boolean(value)) : [];
}

export function buildIcarusDependencyResilience(
  graph: IcarusDependencyGraph,
): IcarusDependencyResilience[] {
  const dependencyControls = new Map<string, IcarusChainControl[]>();
  graph.controls.forEach((control) => control.dependencyNodeIds.forEach((nodeId) => {
    dependencyControls.set(nodeId, [...(dependencyControls.get(nodeId) ?? []), control]);
  }));

  return [...dependencyControls.keys()].sort().flatMap((nodeId) => {
    const health = graph.dependencyHealth.get(nodeId);
    const reference = graph.nodeById.get(nodeId)?.reference;
    if (!health || !reference) return [];
    const controls = dependencyControls.get(nodeId) ?? [];
    const modeNodeIds = [...new Set(controls.map((control) =>
      `icarus-failure-mode:${control.assessmentId}:${control.failureModeId}`))];
    const modes = modeNodeIds.flatMap((modeNodeId) => {
      const mode = graph.modeById.get(modeNodeId);
      return mode ? [{ mode, controls: controlsForMode(graph, modeNodeId) }] : [];
    });

    const assessmentIds = new Set<string>();
    const objectiveIds = new Set<string>();
    const pillarIds = new Set<string>();
    modes.forEach(({ mode }) => {
      const assessment = graph.assessmentById.get(mode.assessmentId);
      const strategicallyRelevant = assessment?.material === true
        || assessment?.objectiveImportance === "Critical"
        || assessment?.objectiveImportance === "High";
      if (!strategicallyRelevant) return;
      assessmentIds.add(mode.assessmentId);
      propagateIcarusFailure(graph, mode.nodeId)
        .filter((step) => step.state !== "Unknown dependency")
        .forEach((step) => {
          const node = graph.nodeById.get(step.nodeId);
          if (node?.kind === "Strategic objective" && node.reference) objectiveIds.add(node.reference.recordId);
          if (node?.kind === "Operating pillar" && node.pillarId) pillarIds.add(node.pillarId);
        });
    });

    const sortedAssessmentIds = [...assessmentIds].sort();
    const sortedObjectiveIds = [...objectiveIds].sort();
    const sortedPillarIds = OPERATING_PILLARS.map((pillar) => pillar.id).filter((id) => pillarIds.has(id));
    const materialAssessmentIds = sortedAssessmentIds.filter((id) =>
      graph.assessmentById.get(id)?.material === true);
    const criticalAssessmentIds = sortedAssessmentIds.filter((id) =>
      graph.assessmentById.get(id)?.objectiveImportance === "Critical");
    const criticalObjectiveIds = sortedObjectiveIds.filter((id) => graph.objectiveImportance.get(id) === "Critical");
    const sharedRequiredDependency = modes.some(({ controls: modeControls }) => modeControls.some((control, index, candidates) =>
      candidates.slice(index + 1).some((other) =>
        control.dependencyNodeIds.includes(nodeId) && other.dependencyNodeIds.includes(nodeId))));
    const hasAlternativePath = modes.some(({ controls: modeControls }) => modeControls.some((control) =>
      control.dependencyNodeIds.includes(nodeId) && isIcarusBarrierCapable(control.barrier)
      && modeControls.some((alternative) => alternative.nodeId !== control.nodeId
        && isIcarusBarrierCapable(alternative.barrier)
        && !alternative.dependencyNodeIds.includes(nodeId))));
    const singleRequiredPath = modes.some(({ controls: modeControls }) =>
      modeControls.some((control) => control.dependencyNodeIds.includes(nodeId)
        && (health.health !== "Healthy" || control.barrier !== "Failed"))
      && !modeControls.some((alternative) => !alternative.dependencyNodeIds.includes(nodeId)
        && isIcarusBarrierCapable(alternative.barrier)));

    const basis = new Set<IcarusDependencyResilienceBasis>();
    if (health.health === "Unknown" || health.health === "Not applicable") basis.add("unknown-health");
    if (health.health === "Failed") basis.add("failed-health");
    if (health.health === "Degraded") basis.add("degraded-health");
    if (health.health === "Watch") basis.add("watch-health");
    if (singleRequiredPath) basis.add("single-required-path");
    if (sharedRequiredDependency) basis.add("shared-required-dependency");
    if (!hasAlternativePath) basis.add("independence-unverified");
    if (materialAssessmentIds.length > 1) basis.add("multiple-material-risks");
    if (sortedObjectiveIds.length > 1) basis.add("multiple-objectives");
    if (sortedPillarIds.length > 1) basis.add("cross-pillar-reach");
    if (criticalObjectiveIds.length > 0) basis.add("critical-objective-reach");

    const resilience: IcarusDependencyResilienceState = health.health === "Unknown" || health.health === "Not applicable"
      ? "Unknown"
      : singleRequiredPath && (materialAssessmentIds.length > 0 || criticalAssessmentIds.length > 0 || criticalObjectiveIds.length > 0)
        ? "Critical dependency"
        : singleRequiredPath || sharedRequiredDependency
          ? "Fragile"
          : "Unknown";
    return [{
      reference,
      health: health.health,
      resilience,
      independence: sharedRequiredDependency ? "Shared dependency" : "Unknown independence",
      concentration: getConcentration({
        assessmentCount: materialAssessmentIds.length,
        objectiveCount: sortedObjectiveIds.length,
        pillarCount: sortedPillarIds.length,
        operatingPillarTotal: OPERATING_PILLARS.length,
      }),
      basis: [...basis].sort(),
      assessmentIds: sortedAssessmentIds,
      materialAssessmentIds,
      objectiveIds: sortedObjectiveIds,
      criticalObjectiveIds,
      pillarIds: sortedPillarIds,
    }];
  });
}

const healthActionRank: Record<IcarusDependencyHealth["health"], number> = {
  Failed: 0,
  Degraded: 1,
  Unknown: 2,
  Watch: 3,
  Healthy: 4,
  "Not applicable": 5,
};

export function buildIcarusResilienceInterventions(
  resilience: readonly IcarusDependencyResilience[],
): IcarusResilienceIntervention[] {
  const entries = resilience.flatMap((dependency) => {
    const strategicallyImportant = dependency.assessmentIds.length > 0
      || dependency.criticalObjectiveIds.length > 0
      || dependency.concentration === "Cross-pillar"
      || dependency.concentration === "Systemic";
    let kind: IcarusResilienceInterventionKind | undefined;
    if ((dependency.health === "Failed" || dependency.health === "Degraded") && strategicallyImportant) kind = "Restore";
    else if (dependency.health === "Unknown" && strategicallyImportant) kind = "Validate";
    else if ((dependency.resilience === "Fragile" || dependency.resilience === "Critical dependency")
      && dependency.health === "Healthy") kind = "Add independent backup";
    if (!kind) return [];
    return [{ health: dependency.health, intervention: {
      reference: dependency.reference,
      kind,
      resilience: dependency.resilience,
      concentration: dependency.concentration,
      basis: dependency.basis,
      assessmentIds: dependency.assessmentIds,
      objectiveIds: dependency.objectiveIds,
      pillarIds: dependency.pillarIds,
    } } ];
  });
  return entries.sort((left, right) =>
    healthActionRank[left.health] - healthActionRank[right.health]
    || right.intervention.assessmentIds.length - left.intervention.assessmentIds.length
    || getIcarusReferenceKey(left.intervention.reference).localeCompare(getIcarusReferenceKey(right.intervention.reference)))
    .map(({ intervention }) => intervention);
}
