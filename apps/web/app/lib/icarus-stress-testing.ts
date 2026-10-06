import { getIcarusReferenceKey } from "./icarus";
import type { IcarusRecordReference } from "./icarus";
import { getIcarusControlNodeId } from "./icarus-failure-chain-graph";
import type { IcarusFailureChain } from "./icarus-failure-chain-analysis";
import type { IcarusDependencyHealth, IcarusDependencyHealthState } from "./icarus-dependency-health";
import type { IcarusDependencyResilienceState } from "./icarus-dependency-resilience";
import {
  buildIcarusStrategicIntelligence,
  type IcarusStrategicIntelligence,
  type IcarusStrategicIntelligenceInput,
} from "./icarus-intelligence-pipeline";
import { getIcarusCommandPlacement } from "./icarus-strategic-attention";
import { getIcarusBlastRadiusRank } from "./icarus-failure-chain-policy";
import type { OperationalIndependenceState } from "./operational-independence";

export type IcarusStressOverride =
  | { type: "Dependency"; reference: IcarusRecordReference; state: Exclude<IcarusDependencyHealthState, "Not applicable">; label?: string }
  | { type: "Control"; assessmentId: string; controlId: string; state: "Assured" | "Weak" | "Failed"; label?: string }
  | { type: "Person"; personId: string; state: "Available" | "Unavailable"; label?: string }
  | { type: "Action"; actionId: string; state: "Available" | "Blocked" | "Failed"; label?: string }
  | { type: "Project"; projectId: string; state: "Operating" | "Blocked" | "Failed"; label?: string };

export type IcarusStressFounderWork = {
  objectType: string;
  id: string;
  title?: string;
  pillar?: string;
  state?: OperationalIndependenceState;
};
export type IcarusStressTestingInput = IcarusStrategicIntelligenceInput & {
  founderDependentWork?: readonly IcarusStressFounderWork[];
  operationalIndependenceWork?: readonly IcarusStressFounderWork[];
};

export type IcarusStressOutcome = "Contained" | "Material exposure" | "Systemic exposure" | "Critical propagation";
export type IcarusStressPriority = "Critical stress" | "High-value stress" | "Useful stress";

export type IcarusStressDelta = {
  newlyExposedAssessments: { assessmentId: string; outcome: string; failureModeIds: string[] }[];
  newlyActivatedChains: IcarusFailureChain[];
  newlyInterruptedChains: IcarusFailureChain[];
  barrierChanges: { controlNodeId: string; controlId: string; previous: string; current: string; worsened: boolean }[];
  newlyExposedObjectiveIds: string[];
  newlyAffectedPillarIds: string[];
  newSpofKeys: string[];
  removedSpofKeys: string[];
  blastRadiusChanges: { assessmentId: string; failureModeId: string; previous: string; current: string }[];
  resilienceChanges: { reference: IcarusRecordReference; previous: IcarusDependencyResilienceState; current: IcarusDependencyResilienceState }[];
  newSharedDependencyKeys: string[];
  attentionChanges: { assessmentId: string; commandRank?: number; previousCommandRank?: number; founderBand?: number; previousFounderBand?: number }[];
};

export type IcarusStressRestorationPriority = {
  override: IcarusStressOverride;
  proposal: string;
  relievedAssessmentIds: string[];
  protectedObjectiveIds: string[];
  protectedPillarIds: string[];
  removedSpofKeys: string[];
};

export type IcarusStressResult = {
  scenarioId: string;
  provenance: "Scenario override";
  overrides: readonly IcarusStressOverride[];
  outcome: IcarusStressOutcome;
  baseline: IcarusStrategicIntelligence;
  hypothetical: IcarusStrategicIntelligence;
  delta: IcarusStressDelta;
  hiddenSharedDependencies: { dependencyKey: string; controlIds: string[]; failureModeIds: string[] }[];
  containment: string[];
  restorationPriorities: IcarusStressRestorationPriority[];
  founderOnlyWorkAtRisk: IcarusStressFounderWork[];
  transferableWork: IcarusStressFounderWork[];
};

export type IcarusRecommendedStressScenario = {
  key: string;
  title: string;
  category: IcarusStressPriority;
  reason: string;
  overrides: readonly IcarusStressOverride[];
};

const barrierSeverity: Readonly<Record<string, number>> = { Active: 0, Weak: 1, Unknown: 1, Failed: 2, None: 2 };
const priorityRank: Readonly<Record<IcarusStressPriority, number>> = {
  "Critical stress": 0, "High-value stress": 1, "Useful stress": 2,
};

function overrideTargetKey(override: IcarusStressOverride): string {
  switch (override.type) {
    case "Dependency": return `record:${getIcarusReferenceKey(override.reference)}`;
    case "Control": return `control:${getIcarusControlNodeId(override.assessmentId, override.controlId)}`;
    case "Person": return `record:Person:${override.personId}`;
    case "Action": return `record:Action:${override.actionId}`;
    case "Project": return `record:Project:${override.projectId}`;
  }
}

function overrideSortKey(override: IcarusStressOverride): string {
  return `${overrideTargetKey(override)}:${override.state}`;
}

function canonicalOverrides(overrides: readonly IcarusStressOverride[]): IcarusStressOverride[] {
  if (overrides.length < 1 || overrides.length > 2) {
    throw new RangeError("Icarus stress tests support one or two scenario overrides.");
  }
  const canonical = [...overrides].sort((left, right) => overrideSortKey(left).localeCompare(overrideSortKey(right)));
  const targets = new Set<string>();
  canonical.forEach((override) => {
    const key = overrideTargetKey(override);
    if (targets.has(key)) throw new Error(`A stress scenario cannot override the same target twice: ${key}`);
    targets.add(key);
  });
  return canonical;
}

function scenarioId(overrides: readonly IcarusStressOverride[]): string {
  return `icarus-stress:${encodeURIComponent(overrides.map(overrideSortKey).join("|"))}`;
}

function dependencyOverride(
  reference: IcarusRecordReference,
  state: Exclude<IcarusDependencyHealthState, "Not applicable">,
): IcarusDependencyHealth {
  return {
    reference: { ...reference },
    health: state,
    basis: ["scenario-override"],
    supportingRecords: [{ ...reference }],
    source: "Scenario override",
  };
}

function applyOverrides(input: IcarusStressTestingInput, overrides: readonly IcarusStressOverride[]): IcarusStrategicIntelligenceInput {
  const dependencyHealthOverrides = new Map<string, IcarusDependencyHealth>();
  const controlAssuranceOverrides = new Map<string, "Assured" | "Evidence insufficient" | "Failed">();
  const personStates = new Map<string, "Active" | "Inactive">();
  const actionStates = new Map<string, "In Progress" | "Blocked" | "Cancelled">();
  const projectStates = new Map<string, "Operating" | "Blocked">();

  overrides.forEach((override) => {
    switch (override.type) {
      case "Dependency":
        dependencyHealthOverrides.set(getIcarusReferenceKey(override.reference), dependencyOverride(override.reference, override.state));
        break;
      case "Control":
        controlAssuranceOverrides.set(
          getIcarusControlNodeId(override.assessmentId, override.controlId),
          override.state === "Assured" ? "Assured" : override.state === "Weak" ? "Evidence insufficient" : "Failed",
        );
        break;
      case "Person": {
        const status = override.state === "Available" ? "Active" : "Inactive";
        personStates.set(override.personId, status);
        dependencyHealthOverrides.set(`Person:${override.personId}`, dependencyOverride(
          { recordType: "Person", recordId: override.personId },
          status === "Active" ? "Healthy" : "Failed",
        ));
        break;
      }
      case "Action": {
        const status = override.state === "Available" ? "In Progress" : override.state === "Blocked" ? "Blocked" : "Cancelled";
        actionStates.set(override.actionId, status);
        const health: Exclude<IcarusDependencyHealthState, "Not applicable"> = override.state === "Available"
          ? "Healthy" : override.state === "Blocked" ? "Degraded" : "Failed";
        dependencyHealthOverrides.set(`Action:${override.actionId}`, dependencyOverride(
          { recordType: "Action", recordId: override.actionId }, health,
        ));
        break;
      }
      case "Project": {
        projectStates.set(override.projectId, override.state === "Operating" ? "Operating" : "Blocked");
        const health: Exclude<IcarusDependencyHealthState, "Not applicable"> = override.state === "Operating"
          ? "Healthy" : override.state === "Blocked" ? "Degraded" : "Failed";
        dependencyHealthOverrides.set(`Project:${override.projectId}`, dependencyOverride(
          { recordType: "Project", recordId: override.projectId }, health,
        ));
        break;
      }
    }
  });

  const scenarioInput: IcarusStrategicIntelligenceInput = {
    ...input,
    nowMs: input.nowMs,
    assessments: input.assessments,
    people: input.people.map((person) => personStates.has(person.id)
      ? { ...person, status: personStates.get(person.id)! }
      : person),
    actions: input.actions.map((action) => actionStates.has(action.id)
      ? { ...action, status: actionStates.get(action.id)! }
      : action),
    sourceRecords: input.sourceRecords.map((record) => {
      if (record.recordType === "Project" && projectStates.has(record.recordId)) {
        const state = projectStates.get(record.recordId)!;
        return state === "Operating"
          ? { ...record, status: "In Progress", health: "On track" }
          : { ...record, status: "Blocked", health: "Blocked" };
      }
      return record;
    }),
    dependencyHealthOverrides,
    controlAssuranceOverrides,
    includeExposureSnapshot: false,
  };
  return scenarioInput;
}

function allChains(intelligence: IcarusStrategicIntelligence): IcarusFailureChain[] {
  return [...intelligence.failureChains.failureChains, ...intelligence.failureChains.interruptedChains];
}

function chainIdentity(chain: IcarusFailureChain): string {
  return `${chain.assessmentId}:${chain.failureModeId}`;
}

function calculateDelta(
  baseline: IcarusStrategicIntelligence,
  hypothetical: IcarusStrategicIntelligence,
): IcarusStressDelta {
  const beforeChains = new Map(allChains(baseline).map((chain) => [chainIdentity(chain), chain] as const));
  const afterChains = allChains(hypothetical);
  const newlyActivatedChains = afterChains.filter((chain) =>
    chain.status !== "Interrupted" && beforeChains.get(chainIdentity(chain))?.status !== "Active"
    && beforeChains.get(chainIdentity(chain))?.status !== "Potential");
  const newlyInterruptedChains = afterChains.filter((chain) =>
    chain.status === "Interrupted" && beforeChains.has(chainIdentity(chain))
    && beforeChains.get(chainIdentity(chain))?.status !== "Interrupted");
  const newlyExposedAssessments = [...new Map(newlyActivatedChains.map((chain) => [chain.assessmentId, {
    assessmentId: chain.assessmentId,
    outcome: chain.outcome,
    failureModeIds: newlyActivatedChains.filter((candidate) => candidate.assessmentId === chain.assessmentId)
      .map((candidate) => candidate.failureModeId).sort(),
  }] as const)).values()].sort((left, right) => left.assessmentId.localeCompare(right.assessmentId));
  const newlyExposedObjectiveIds = [...new Set(newlyActivatedChains.flatMap((chain) => chain.blast.objectiveIds))].sort();
  const newlyAffectedPillarIds = [...new Set(newlyActivatedChains.flatMap((chain) => chain.blast.pillarIds))].sort();

  const beforeControls = new Map(baseline.failureChains.dependencyGraph.controls.map((control) => [control.nodeId, control] as const));
  const barrierChanges = hypothetical.failureChains.dependencyGraph.controls.flatMap((control) => {
    const previous = beforeControls.get(control.nodeId);
    if (!previous || previous.barrier === control.barrier) return [];
    return [{
      controlNodeId: control.nodeId,
      controlId: control.controlId,
      previous: previous.barrier,
      current: control.barrier,
      worsened: (barrierSeverity[control.barrier] ?? 0) > (barrierSeverity[previous.barrier] ?? 0),
    }];
  }).sort((left, right) => left.controlNodeId.localeCompare(right.controlNodeId));

  const beforeSpofs = new Set(baseline.failureChains.singlePointsOfFailure.map((entry) => entry.key));
  const afterSpofs = new Set(hypothetical.failureChains.singlePointsOfFailure.map((entry) => entry.key));
  const beforeShared = new Set(baseline.failureChains.sharedDependencies.filter((entry) => entry.causal).map((entry) => entry.key));
  const beforeResilience = new Map(baseline.dependencyResilience.map((entry) =>
    [getIcarusReferenceKey(entry.reference), entry] as const));
  const resilienceChanges = hypothetical.dependencyResilience.flatMap((entry) => {
    const previous = beforeResilience.get(getIcarusReferenceKey(entry.reference));
    if (!previous || previous.resilience === entry.resilience) return [];
    return [{ reference: entry.reference, previous: previous.resilience, current: entry.resilience }];
  }).sort((left, right) => getIcarusReferenceKey(left.reference).localeCompare(getIcarusReferenceKey(right.reference)));
  const beforeFocus = new Map(baseline.founderFocusRisks.map((entry) => [entry.id, entry] as const));
  const beforeSignals = new Map(baseline.strategicSignals.map((entry) => [entry.assessmentId, entry] as const));
  const afterFocus = new Map(hypothetical.founderFocusRisks.map((entry) => [entry.id, entry] as const));
  const attentionChanges = hypothetical.strategicSignals.flatMap((signal) => {
    const previousSignal = beforeSignals.get(signal.assessmentId);
    const previousFocus = beforeFocus.get(signal.assessmentId);
    const currentCommandRank = getIcarusCommandPlacement(signal).attentionRank;
    const previousCommandRank = previousSignal ? getIcarusCommandPlacement(previousSignal).attentionRank : undefined;
    const currentFounderBand = afterFocus.get(signal.assessmentId)?.band;
    const previousFounderBand = previousFocus?.band;
    if (currentCommandRank === previousCommandRank && currentFounderBand === previousFounderBand) return [];
    return [{
      assessmentId: signal.assessmentId,
      commandRank: currentCommandRank,
      ...(previousCommandRank !== undefined ? { previousCommandRank } : {}),
      ...(currentFounderBand !== undefined ? { founderBand: currentFounderBand } : {}),
      ...(previousFounderBand !== undefined ? { previousFounderBand } : {}),
    }];
  }).sort((left, right) => left.assessmentId.localeCompare(right.assessmentId));

  const beforeBlast = new Map(allChains(baseline).map((chain) => [chainIdentity(chain), chain] as const));
  const blastRadiusChanges = afterChains.flatMap((chain) => {
    const previous = beforeBlast.get(chainIdentity(chain));
    if (!previous || getIcarusBlastRadiusRank(chain.blast.radius) === getIcarusBlastRadiusRank(previous.blast.radius)) return [];
    return [{
      assessmentId: chain.assessmentId,
      failureModeId: chain.failureModeId,
      previous: previous.blast.radius,
      current: chain.blast.radius,
    }];
  }).sort((left, right) => left.assessmentId.localeCompare(right.assessmentId)
    || left.failureModeId.localeCompare(right.failureModeId));

  return {
    newlyExposedAssessments,
    newlyActivatedChains,
    newlyInterruptedChains,
    barrierChanges,
    newlyExposedObjectiveIds,
    newlyAffectedPillarIds,
    newSpofKeys: [...afterSpofs].filter((key) => !beforeSpofs.has(key)).sort(),
    removedSpofKeys: [...beforeSpofs].filter((key) => !afterSpofs.has(key)).sort(),
    blastRadiusChanges,
    resilienceChanges,
    newSharedDependencyKeys: hypothetical.failureChains.sharedDependencies
      .filter((entry) => entry.causal && !beforeShared.has(entry.key)).map((entry) => entry.key).sort(),
    attentionChanges,
  };
}

function classifyOutcome(delta: IcarusStressDelta, overrides: readonly IcarusStressOverride[]): IcarusStressOutcome {
  if (delta.newlyExposedAssessments.length === 0) return "Contained";
  const founderUnavailable = overrides.some((override) => override.type === "Person" && override.state === "Unavailable");
  if (founderUnavailable && delta.newlyExposedAssessments.some((entry) =>
    delta.newlyActivatedChains.some((chain) => chain.assessmentId === entry.assessmentId && chain.priority === "Critical"))) {
    return "Critical propagation";
  }
  if (delta.newlyExposedObjectiveIds.length > 1 || delta.newlyAffectedPillarIds.length > 1) return "Systemic exposure";
  return "Material exposure";
}

function buildHiddenSharedDependencies(
  baseline: IcarusStrategicIntelligence,
  intelligence: IcarusStrategicIntelligence,
  overrides: readonly IcarusStressOverride[],
): IcarusStressResult["hiddenSharedDependencies"] {
  const failedDependencies = new Set(overrides.flatMap((override) =>
    override.type === "Dependency" && override.state === "Failed" ? [getIcarusReferenceKey(override.reference)]
      : override.type === "Person" && override.state === "Unavailable" ? [`Person:${override.personId}`] : []));
  const graph = intelligence.failureChains.dependencyGraph;
  const baselineControls = baseline.failureChains.dependencyGraph.controlById;
  const result = new Map<string, { dependencyKey: string; controlIds: string[]; failureModeIds: string[] }>();
  graph.modes.forEach((mode) => {
    const controls = mode.controlNodeIds.map((id) => graph.controlById.get(id)).filter((entry) => entry !== undefined);
    const dependencyKeys = new Set(controls.flatMap((control) => control.dependencyNodeIds).filter((key) => failedDependencies.has(key)));
    dependencyKeys.forEach((dependencyKey) => {
      const affected = controls.filter((control) => control.dependencyNodeIds.includes(dependencyKey));
      if (affected.length < 2 || !affected.every((control) => control.barrier === "Failed"
        && baselineControls.get(control.nodeId)?.barrier !== "Failed")) return;
      const existing = result.get(dependencyKey);
      result.set(dependencyKey, {
        dependencyKey,
        controlIds: [...new Set([...(existing?.controlIds ?? []), ...affected.map((control) => control.controlId)])].sort(),
        failureModeIds: [...new Set([...(existing?.failureModeIds ?? []), mode.failureModeId])].sort(),
      });
    });
  });
  return [...result.values()].sort((left, right) => left.dependencyKey.localeCompare(right.dependencyKey));
}

function restorationProposal(override: IcarusStressOverride): string {
  switch (override.type) {
    case "Dependency": return `Restore ${override.reference.recordType} ${override.reference.recordId} to its baseline state`;
    case "Control": return `Restore control ${override.controlId} to its baseline assured state`;
    case "Person": return `Restore Person ${override.personId} to their baseline availability`;
    case "Action": return `Restore Action ${override.actionId} to its baseline state`;
    case "Project": return `Restore Project ${override.projectId} to its baseline state`;
  }
}

function buildRestorationPriorities(
  input: IcarusStressTestingInput,
  baseline: IcarusStrategicIntelligence,
  overrides: readonly IcarusStressOverride[],
  hypothetical: IcarusStrategicIntelligence,
): IcarusStressRestorationPriority[] {
  return overrides.flatMap((override, index) => {
    const repairedOverrides = overrides.filter((_, itemIndex) => itemIndex !== index);
    const repaired = repairedOverrides.length === 0
      ? baseline
      : buildIcarusStrategicIntelligence(applyOverrides(input, repairedOverrides));
    const beforeRepair = new Map(allChains(hypothetical).map((chain) => [chainIdentity(chain), chain] as const));
    const relieved = allChains(repaired).filter((chain) =>
      chain.status === "Interrupted" && beforeRepair.get(chainIdentity(chain))?.status !== "Interrupted");
    const relievedAssessmentIds = [...new Set(relieved.map((chain) => chain.assessmentId))].sort();
    if (relievedAssessmentIds.length === 0) return [];
    const objectives = [...new Set(relieved.flatMap((chain) => chain.blast.objectiveIds))].sort();
    const pillars = [...new Set(relieved.flatMap((chain) => chain.blast.pillarIds))].sort();
    const beforeSpofs = new Set(hypothetical.failureChains.singlePointsOfFailure.map((item) => item.key));
    const removedSpofKeys = repaired.failureChains.singlePointsOfFailure
      .filter((item) => !beforeSpofs.has(item.key)).map((item) => item.key).sort();
    return [{
      override,
      proposal: restorationProposal(override),
      relievedAssessmentIds,
      protectedObjectiveIds: objectives,
      protectedPillarIds: pillars,
      removedSpofKeys,
    }];
  }).sort((left, right) => right.relievedAssessmentIds.length - left.relievedAssessmentIds.length
    || right.protectedObjectiveIds.length - left.protectedObjectiveIds.length
    || right.protectedPillarIds.length - left.protectedPillarIds.length
    || overrideSortKey(left.override).localeCompare(overrideSortKey(right.override)));
}

export function runIcarusStressTest(
  input: IcarusStressTestingInput,
  requestedOverrides: readonly IcarusStressOverride[],
  baseline?: IcarusStrategicIntelligence,
): IcarusStressResult {
  const overrides = canonicalOverrides(requestedOverrides);
  const nowMs = input.nowMs ?? baseline?.nowMs;
  if (nowMs === undefined) throw new Error("Icarus stress testing requires a fixed clock or baseline intelligence.");
  const stableInput = { ...input, nowMs };
  const authoritativeBaseline = baseline ?? buildIcarusStrategicIntelligence(stableInput);
  const hypothetical = buildIcarusStrategicIntelligence(applyOverrides(stableInput, overrides));
  const delta = calculateDelta(authoritativeBaseline, hypothetical);
  const founderUnavailable = overrides.some((override) => override.type === "Person" && override.state === "Unavailable");
  return {
    scenarioId: scenarioId(overrides),
    provenance: "Scenario override",
    overrides,
    outcome: classifyOutcome(delta, overrides),
    baseline: authoritativeBaseline,
    hypothetical,
    delta,
    hiddenSharedDependencies: buildHiddenSharedDependencies(authoritativeBaseline, hypothetical, overrides),
    containment: delta.newlyExposedAssessments.length === 0
      ? ["No newly exposed assessment chains.", "No new material objective or pillar exposure."]
      : delta.newlyInterruptedChains.map((chain) =>
        `Independent barrier on ${chain.outcome} interrupts the chain at ${chain.barriers.filter((barrier) => barrier.state === "Active").map((barrier) => barrier.intervention).join(", ") || "an active control"}.`),
    restorationPriorities: buildRestorationPriorities(stableInput, authoritativeBaseline, overrides, hypothetical),
    founderOnlyWorkAtRisk: founderUnavailable ? [...(input.founderDependentWork ?? [])]
      .map((work) => ({ ...work })).sort((left, right) =>
        `${left.objectType}:${left.id}`.localeCompare(`${right.objectType}:${right.id}`)) : [],
    transferableWork: founderUnavailable ? [...(input.operationalIndependenceWork ?? [])]
      .filter((work) => work.state === "Ready to delegate")
      .map((work) => ({ ...work })).sort((left, right) =>
        `${left.objectType}:${left.id}`.localeCompare(`${right.objectType}:${right.id}`)) : [],
  };
}

export function buildIcarusRecommendedStressScenarios(
  input: IcarusStressTestingInput,
  baseline: IcarusStrategicIntelligence,
  limit = 8,
): IcarusRecommendedStressScenario[] {
  const graph = baseline.failureChains.dependencyGraph;
  const dependencyControls = new Map<string, Set<string>>();
  graph.controls.forEach((control) => control.dependencyNodeIds.forEach((key) => {
    dependencyControls.set(key, new Set([...(dependencyControls.get(key) ?? []), control.nodeId]));
  }));
  const spofKeys = new Set(baseline.failureChains.singlePointsOfFailure
    .filter((entry) => entry.causal && entry.reference)
    .map((entry) => getIcarusReferenceKey(entry.reference!)));
  const resilienceByKey = new Map(baseline.dependencyResilience.map((entry) =>
    [getIcarusReferenceKey(entry.reference), entry] as const));
  const candidates: { category: IcarusStressPriority; scenario: IcarusRecommendedStressScenario }[] =
    [...graph.dependencyHealth.values()].flatMap((health) => {
    if (health.health === "Failed" || health.health === "Not applicable") return [];
    const key = getIcarusReferenceKey(health.reference);
    const dependentControls = dependencyControls.get(key)?.size ?? 0;
    const resilience = resilienceByKey.get(key);
    const isSpof = spofKeys.has(key);
    const critical = isSpof || resilience?.criticalObjectiveIds.length || resilience?.concentration === "Cross-pillar"
      || resilience?.concentration === "Systemic";
    const strategic = dependentControls > 0 && (critical || health.health === "Unknown"
      || dependentControls >= 2 || (resilience?.materialAssessmentIds.length ?? 0) > 0);
    if (!strategic) return [];
    const category: IcarusStressPriority = critical ? "Critical stress"
      : health.health === "Unknown" || dependentControls >= 2 ? "High-value stress" : "Useful stress";
    const override: IcarusStressOverride = { type: "Dependency", reference: health.reference, state: "Failed" };
    return [{
      category,
      scenario: {
        key: `recommended:${key}:Failed`,
        title: `If ${health.reference.recordType} ${health.reference.recordId} fails`,
        category,
        reason: isSpof ? "This is already a recorded causal single point of failure."
          : health.health === "Unknown" ? "Critical linked health is unverified."
            : `${dependentControls} control${dependentControls === 1 ? "" : "s"} explicitly depend on this record.`,
        overrides: [override],
      },
    }];
    });
  if (input.primaryFounderId) {
    const founderDependencyExists = (dependencyControls.get(`Person:${input.primaryFounderId}`)?.size ?? 0) > 0
      || (input.founderDependentWork?.length ?? 0) > 0;
    candidates.push({
      category: founderDependencyExists ? "Critical stress" : "Useful stress",
      scenario: {
        key: `recommended:founder:${input.primaryFounderId}:Unavailable`,
        title: "Founder unavailable for 30 days",
        category: founderDependencyExists ? "Critical stress" : "Useful stress",
        reason: "Tests explicit causal Person dependencies without treating ownership as causality.",
        overrides: [{ type: "Person", personId: input.primaryFounderId, state: "Unavailable" }],
      },
    });
  }
  return candidates.sort((left, right) =>
    priorityRank[left.category] - priorityRank[right.category]
    || left.scenario.key.localeCompare(right.scenario.key))
    .slice(0, Math.max(0, limit)).map(({ scenario }) => scenario);
}
