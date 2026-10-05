import { getIcarusIdentityKey, type IcarusRecordReference } from "./icarus";
import type { IcarusControlAssuranceStatus } from "./icarus-assurance-policy";
import { getIcarusExposureRank } from "./icarus-materiality-policy";
import type { IcarusStrategicSignal } from "./icarus-strategic-attention";
import {
  buildIcarusDependencyGraph,
  getIcarusFailureModeNodeId,
  propagateIcarusFailure,
  type IcarusChainFailureMode,
  type IcarusDependencyGraph,
  type IcarusDependencyGraphInput,
  type IcarusPropagationStep,
} from "./icarus-failure-chain-graph";
import {
  classifyIcarusBlastRadius,
  classifyIcarusChainPriority,
  getIcarusBlastRadiusRank,
  getIcarusChainPriorityRank,
  isIcarusSharedDependencyCausal,
  type IcarusBarrierState,
  type IcarusBlastRadius,
  type IcarusBlastRadiusBasis,
  type IcarusChainPriority,
  type IcarusChainPriorityBasis,
  type IcarusSharedDependencyKind,
  type IcarusSignalFailureChain,
  type IcarusSpofAssurance,
  type IcarusSpofBasis,
  type IcarusSpofKind,
} from "./icarus-failure-chain-policy";
import { OPERATING_PILLARS, type OperatingPillarId } from "./pillar-identity";

// Failure-chain analysis over the Icarus dependency graph: propagation, barriers, dependency breaks, single points
// of failure, shared dependencies, blast radius, cut points and chain priority. Pure and deterministic; every count
// uses unique identities, so duplicate references or routes never inflate concentration.

export type IcarusBlastRadiusSummary = {
  radius: IcarusBlastRadius;
  basis: IcarusBlastRadiusBasis[];
  assessmentIds: string[];
  materialAssessmentIds: string[];
  objectiveIds: string[];
  criticalObjectiveIds: string[];
  pillarIds: OperatingPillarId[];
  // Context-only records reached (no declared dependency direction).
  unknownDependencyNodeIds: string[];
  founderCritical: boolean;
};

export type IcarusChainBarrier = {
  nodeId: string;
  controlId: string;
  intervention: string;
  state: IcarusBarrierState;
  status: IcarusControlAssuranceStatus;
  dependencyNodeIds: string[];
};

// Active: no working barrier. Potential: only weak/unknown barriers. Interrupted: an assured barrier holds the chain.
export type IcarusChainStatus = "Active" | "Potential" | "Interrupted";

export type IcarusFailureChain = {
  key: string;
  assessmentId: string;
  failureModeId: string;
  outcome: string;
  mechanism: string;
  // Navigation identity (the assessment's strategic-signal key when it is a current signal).
  identityKey: string;
  origin: IcarusChainFailureMode["state"];
  status: IcarusChainStatus;
  accepted: boolean;
  barrier: IcarusBarrierState;
  barriers: IcarusChainBarrier[];
  // What the failure reaches. For an interrupted chain this is the reach the barrier currently protects.
  propagation: IcarusPropagationStep[];
  blast: IcarusBlastRadiusSummary;
  priority: IcarusChainPriority;
  basis: IcarusChainPriorityBasis[];
  spofKeys: string[];
  sharedDependencyKeys: string[];
  riskScore: number;
};

export type IcarusDependencyBreak = {
  nodeId: string;
  kind: "Dependency" | "Control";
  label: string;
  reference?: IcarusRecordReference;
  dependentControlNodeIds: string[];
  // Current modes left with no barrier-capable control if this node breaks.
  exposedModeNodeIds: string[];
  // Subset that an assured barrier currently holds.
  newlyExposedModeNodeIds: string[];
  blast: IcarusBlastRadiusSummary;
};

export type IcarusSinglePointOfFailure = {
  key: string;
  kind: IcarusSpofKind;
  nodeId: string;
  label: string;
  reference?: IcarusRecordReference;
  controlNodeId?: string;
  // Ownership concentration is governance concentration, not a causal dependency.
  causal: boolean;
  founderDependency: boolean;
  assurance: IcarusSpofAssurance;
  basis: IcarusSpofBasis[];
  dependentAssessmentIds: string[];
  dependentMaterialAssessmentIds: string[];
  dependentModeNodeIds: string[];
  dependentObjectiveIds: string[];
  blast: IcarusBlastRadiusSummary;
  // Edge ids that establish the dependency.
  provenanceEdgeIds: string[];
};

export type IcarusSharedDependency = {
  key: string;
  kind: IcarusSharedDependencyKind;
  causal: boolean;
  nodeId: string;
  label: string;
  reference?: IcarusRecordReference;
  assessmentIds: string[];
  materialAssessmentIds: string[];
  controlNodeIds: string[];
  founderDependency: boolean;
  blast: IcarusBlastRadiusSummary;
  provenanceEdgeIds: string[];
};

export type IcarusBarrierRestoration = {
  key: string;
  controlNodeId: string;
  chainKey: string;
  assessmentId: string;
  failureModeId: string;
  controlId: string;
  intervention: string;
  state: IcarusBarrierState;
  // Restoring this control to assured interrupts the whole chain (one assured barrier holds a mode).
  interrupts: IcarusBlastRadiusSummary;
  chainPriority: IcarusChainPriority;
};

export type IcarusCutPoint = {
  key: string;
  nodeId: string;
  kind: "Dependency" | "Control";
  label: string;
  reference?: IcarusRecordReference;
  exposedModeNodeIds: string[];
  newlyExposedModeNodeIds: string[];
  blast: IcarusBlastRadiusSummary;
};

export type IcarusTwoPointFragility = {
  key: string;
  modeNodeId: string;
  assessmentId: string;
  failureModeId: string;
  controlNodeIds: [string, string];
  // Independence is never recorded; it is "Shared dependency" when both barriers rely on the same record.
  independence: "Unknown" | "Shared dependency";
  sharedDependencyNodeIds: string[];
  blast: IcarusBlastRadiusSummary;
};

export const ICARUS_PILLAR_CHAIN_STATES = ["No chain exposure", "Contained", "Cross-pillar", "Single-point dependent"] as const;
export type IcarusPillarChainState = (typeof ICARUS_PILLAR_CHAIN_STATES)[number];

export type IcarusPillarChainExposure = {
  pillarId: OperatingPillarId;
  label: string;
  state: IcarusPillarChainState;
  chainKeys: string[];
  crossPillarChainKeys: string[];
  spofKeys: string[];
  sharedDependencyKeys: string[];
  weakBarrierControlNodeIds: string[];
};

export type IcarusFounderChainSynthesis = {
  // "What single failure could hurt us most?"
  mostDamagingCutPointKey?: string;
  // "What dependency is carrying too much weight?"
  heaviestSpofKey?: string;
  // "What control restoration creates the greatest resilience gain?"
  bestRestorationKey?: string;
  // "Which strategic outcomes are connected through the same fragility?"
  connectedOutcomeKeys: string[];
  // "Where is founder dependency acting as a systemic SPOF?"
  founderSpofKeys: string[];
};

export type IcarusFailureChainIntelligence = {
  dependencyGraph: IcarusDependencyGraph;
  // Active + potential chains, highest priority first.
  failureChains: IcarusFailureChain[];
  // Chains an assured barrier currently interrupts.
  interruptedChains: IcarusFailureChain[];
  singlePointsOfFailure: IcarusSinglePointOfFailure[];
  sharedDependencies: IcarusSharedDependency[];
  barrierWeaknesses: IcarusBarrierRestoration[];
  criticalCutPoints: IcarusCutPoint[];
  twoPointFragilities: IcarusTwoPointFragility[];
  pillarChainExposure: IcarusPillarChainExposure[];
  founderSynthesis: IcarusFounderChainSynthesis;
  // Per assessment id; only assessments that are current strategic signals.
  signalAnnotations: ReadonlyMap<string, IcarusSignalFailureChain>;
};

export type IcarusFailureChainInput = IcarusDependencyGraphInput & {
  primaryFounderId: string | null;
  founderDependencyActive: boolean;
};

const spofAssuranceText: Record<IcarusSpofAssurance, string> = {
  Strong: "assured",
  Weak: "weakly assured",
  Failed: "failing",
  Unknown: "unassured",
  "Not applicable": "",
};

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function compareBlast(left: IcarusBlastRadiusSummary, right: IcarusBlastRadiusSummary): number {
  return getIcarusBlastRadiusRank(right.radius) - getIcarusBlastRadiusRank(left.radius)
    || right.criticalObjectiveIds.length - left.criticalObjectiveIds.length
    || right.materialAssessmentIds.length - left.materialAssessmentIds.length
    || right.objectiveIds.length - left.objectiveIds.length
    || right.pillarIds.length - left.pillarIds.length
    || right.assessmentIds.length - left.assessmentIds.length;
}

export function buildIcarusFailureChainIntelligence(input: IcarusFailureChainInput): IcarusFailureChainIntelligence {
  const graph = buildIcarusDependencyGraph(input);
  const founderNodeId = input.primaryFounderId && input.founderDependencyActive
    ? `Person:${input.primaryFounderId}`
    : null;
  const signalByAssessment = new Map(input.signals.map((signal) => [signal.assessmentId, signal] as const));

  const summarise = (stepLists: readonly (readonly IcarusPropagationStep[])[], founderCritical = false): IcarusBlastRadiusSummary => {
    const assessmentIds = new Set<string>();
    const objectiveIds = new Set<string>();
    const pillarIds = new Set<OperatingPillarId>();
    const unknown = new Set<string>();
    const causal = new Set<string>();
    stepLists.forEach((steps) => steps.forEach((step) => {
      if (step.state === "Unknown dependency") unknown.add(step.nodeId);
      else causal.add(step.nodeId);
    }));
    causal.forEach((nodeId) => {
      unknown.delete(nodeId);
      const node = graph.nodeById.get(nodeId);
      if (!node) return;
      if (node.kind === "Assessment" && node.assessmentId) assessmentIds.add(node.assessmentId);
      if (node.kind === "Strategic objective" && node.reference) objectiveIds.add(node.reference.recordId);
      if (node.kind === "Operating pillar" && node.pillarId) pillarIds.add(node.pillarId);
    });
    const sortedAssessments = [...assessmentIds].sort();
    const sortedObjectives = [...objectiveIds].sort();
    const sortedPillars = OPERATING_PILLARS.map((pillar) => pillar.id).filter((id) => pillarIds.has(id));
    const criticalObjectiveIds = sortedObjectives.filter((id) => graph.objectiveImportance.get(id) === "Critical");
    const basis: IcarusBlastRadiusBasis[] = [sortedAssessments.length >= 2 ? "reaches-multiple-assessments" : "single-assessment"];
    if (sortedObjectives.length >= 1) basis.push(sortedObjectives.length >= 2 ? "reaches-multiple-objectives" : "reaches-objective");
    if (criticalObjectiveIds.length > 0) basis.push("reaches-critical-objective");
    if (sortedPillars.length >= 1) basis.push(sortedPillars.length >= 2 ? "reaches-multiple-pillars" : "reaches-pillar");
    if (sortedPillars.length === OPERATING_PILLARS.length) basis.push("reaches-all-operating-pillars");
    if (founderCritical) basis.push("founder-dependency");
    return {
      radius: classifyIcarusBlastRadius({
        assessmentCount: sortedAssessments.length,
        objectiveCount: sortedObjectives.length,
        pillarCount: sortedPillars.length,
        operatingPillarTotal: OPERATING_PILLARS.length,
      }),
      basis,
      assessmentIds: sortedAssessments,
      materialAssessmentIds: sortedAssessments.filter((id) => graph.assessmentById.get(id)?.material === true),
      objectiveIds: sortedObjectives,
      criticalObjectiveIds,
      pillarIds: sortedPillars,
      unknownDependencyNodeIds: [...unknown].sort(),
      founderCritical,
    };
  };

  // Reach of each mode if nothing stops it (barriers are evaluated separately).
  const reachByMode = new Map<string, IcarusPropagationStep[]>();
  const modeReach = (mode: IcarusChainFailureMode) => {
    let steps = reachByMode.get(mode.nodeId);
    if (!steps) {
      steps = propagateIcarusFailure(graph, mode.nodeId);
      reachByMode.set(mode.nodeId, steps);
    }
    return steps;
  };
  const currentModes = graph.modes.filter((mode) => mode.state !== "Not current");

  // ── Dependency breaks (record dependencies and individual controls) ──
  const dependentControlsByRecord = new Map<string, string[]>();
  graph.controls.forEach((control) => control.dependencyNodeIds.forEach((nodeId) => {
    dependentControlsByRecord.set(nodeId, [...(dependentControlsByRecord.get(nodeId) ?? []), control.nodeId]);
  }));
  const evaluateBreak = (brokenControlNodeIds: ReadonlySet<string>) => {
    const exposed: IcarusChainFailureMode[] = [];
    const newlyExposed: IcarusChainFailureMode[] = [];
    currentModes.forEach((mode) => {
      if (!mode.capableBarrierNodeIds.some((id) => brokenControlNodeIds.has(id))) return;
      if (!mode.capableBarrierNodeIds.every((id) => brokenControlNodeIds.has(id))) return;
      exposed.push(mode);
      if (mode.activeBarrierNodeIds.length > 0) newlyExposed.push(mode);
    });
    return { exposed, newlyExposed };
  };
  const breaks: IcarusDependencyBreak[] = [];
  [...dependentControlsByRecord.keys()].sort().forEach((nodeId) => {
    const node = graph.nodeById.get(nodeId);
    const dependents = [...new Set(dependentControlsByRecord.get(nodeId) ?? [])].sort();
    const { exposed, newlyExposed } = evaluateBreak(new Set(dependents));
    breaks.push({
      nodeId,
      kind: "Dependency",
      label: node?.label ?? nodeId,
      ...(node?.reference ? { reference: node.reference } : {}),
      dependentControlNodeIds: dependents,
      exposedModeNodeIds: exposed.map((mode) => mode.nodeId),
      newlyExposedModeNodeIds: newlyExposed.map((mode) => mode.nodeId),
      blast: summarise(exposed.map(modeReach), nodeId === founderNodeId),
    });
  });
  graph.controls.forEach((control) => {
    const { exposed, newlyExposed } = evaluateBreak(new Set([control.nodeId]));
    if (exposed.length === 0) return;
    breaks.push({
      nodeId: control.nodeId,
      kind: "Control",
      label: control.intervention,
      dependentControlNodeIds: [control.nodeId],
      exposedModeNodeIds: exposed.map((mode) => mode.nodeId),
      newlyExposedModeNodeIds: newlyExposed.map((mode) => mode.nodeId),
      blast: summarise(exposed.map(modeReach)),
    });
  });

  const spofAssuranceFor = (controlNodeIds: readonly string[]): IcarusSpofAssurance => {
    const states = controlNodeIds.map((id) => graph.controlById.get(id)?.barrier).filter((state): state is IcarusBarrierState => Boolean(state));
    if (states.length === 0) return "Unknown";
    if (states.includes("Failed")) return "Failed";
    if (states.every((state) => state === "Active")) return "Strong";
    if (states.includes("Weak")) return "Weak";
    return "Unknown";
  };
  const edgeIdsTo = (nodeId: string, types: readonly string[]) =>
    (graph.incoming.get(nodeId) ?? []).filter((edge) => types.includes(edge.type)).map((edge) => edge.id);

  // ── Single points of failure ──
  const spofs: IcarusSinglePointOfFailure[] = [];
  breaks.forEach((entry) => {
    const exposedModes = entry.exposedModeNodeIds.map((id) => graph.modeById.get(id)!).filter(Boolean);
    const assessmentIds = [...new Set(exposedModes.map((mode) => mode.assessmentId))].sort();
    if (entry.kind === "Dependency") {
      // Concentration: the record is the sole barrier support of current modes in at least two assessments.
      if (assessmentIds.length < 2) return;
      const capableDependents = entry.dependentControlNodeIds.filter((id) =>
        exposedModes.some((mode) => mode.capableBarrierNodeIds.includes(id)));
      const founder = entry.nodeId === founderNodeId;
      const basis: IcarusSpofBasis[] = ["sole-barrier-dependency", "multiple-assessments"];
      if (entry.blast.objectiveIds.length >= 2) basis.push("multiple-objectives");
      if (entry.blast.pillarIds.length >= 2) basis.push("multiple-pillars");
      if (entry.blast.criticalObjectiveIds.length > 0) basis.push("critical-objective");
      if (founder) basis.push("founder-dependency");
      spofs.push({
        key: `spof:Dependency:${entry.nodeId}`,
        kind: "Dependency",
        nodeId: entry.nodeId,
        label: entry.label,
        ...(entry.reference ? { reference: entry.reference } : {}),
        causal: true,
        founderDependency: founder,
        assurance: spofAssuranceFor(capableDependents),
        basis,
        dependentAssessmentIds: assessmentIds,
        dependentMaterialAssessmentIds: assessmentIds.filter((id) => graph.assessmentById.get(id)?.material === true),
        dependentModeNodeIds: entry.exposedModeNodeIds,
        dependentObjectiveIds: entry.blast.objectiveIds,
        blast: entry.blast,
        provenanceEdgeIds: edgeIdsTo(entry.nodeId, ["DEPENDS_ON"]),
      });
      return;
    }
    // Control: the only barrier-capable control of a current mode that reaches several strategic targets.
    if (entry.blast.objectiveIds.length < 2 && entry.blast.pillarIds.length < 2) return;
    const control = graph.controlById.get(entry.nodeId)!;
    const basis: IcarusSpofBasis[] = ["sole-barrier"];
    if (entry.blast.objectiveIds.length >= 2) basis.push("multiple-objectives");
    if (entry.blast.pillarIds.length >= 2) basis.push("multiple-pillars");
    if (entry.blast.criticalObjectiveIds.length > 0) basis.push("critical-objective");
    spofs.push({
      key: `spof:Control:${entry.nodeId}`,
      kind: "Control",
      nodeId: entry.nodeId,
      label: entry.label,
      controlNodeId: entry.nodeId,
      causal: true,
      founderDependency: false,
      assurance: spofAssuranceFor([control.nodeId]),
      basis,
      dependentAssessmentIds: assessmentIds,
      dependentMaterialAssessmentIds: assessmentIds.filter((id) => graph.assessmentById.get(id)?.material === true),
      dependentModeNodeIds: entry.exposedModeNodeIds,
      dependentObjectiveIds: entry.blast.objectiveIds,
      blast: entry.blast,
      provenanceEdgeIds: edgeIdsTo(entry.nodeId, ["CONTROLLED_BY"]),
    });
  });

  // Ownership concentration: one Person accountable for several material risks (governance, not causal).
  const currentAssessmentIds = new Set(currentModes.map((mode) => mode.assessmentId));
  const currentModeIds = new Set(currentModes.map((mode) => mode.nodeId));
  const ownedByPerson = new Map<string, Set<string>>();
  graph.edges.filter((edge) => edge.type === "OWNED_BY").forEach((edge) => {
    edge.provenance.forEach((provenance) => {
      if (!provenance.assessmentId || !currentAssessmentIds.has(provenance.assessmentId)) return;
      // A control owner only counts when the control sits on a current failure mode.
      if (provenance.failureModeId && !currentModeIds.has(getIcarusFailureModeNodeId(provenance.assessmentId, provenance.failureModeId))) return;
      ownedByPerson.set(edge.to, new Set([...(ownedByPerson.get(edge.to) ?? []), provenance.assessmentId]));
    });
  });
  [...ownedByPerson.keys()].sort().forEach((personNodeId) => {
    const assessmentIds = [...ownedByPerson.get(personNodeId)!].sort();
    const materialIds = assessmentIds.filter((id) => graph.assessmentById.get(id)?.material === true);
    if (materialIds.length < 2) return;
    const founder = personNodeId === founderNodeId;
    const modeNodeIds = currentModes.filter((mode) => materialIds.includes(mode.assessmentId) && mode.state !== "Barrier-held").map((mode) => mode.nodeId);
    const blast = summarise(modeNodeIds.map((id) => modeReach(graph.modeById.get(id)!)), founder);
    const basis: IcarusSpofBasis[] = ["owns-multiple-material-risks", "multiple-assessments"];
    if (blast.objectiveIds.length >= 2) basis.push("multiple-objectives");
    if (blast.pillarIds.length >= 2) basis.push("multiple-pillars");
    if (blast.criticalObjectiveIds.length > 0) basis.push("critical-objective");
    if (founder) basis.push("founder-dependency");
    const node = graph.nodeById.get(personNodeId);
    spofs.push({
      key: `spof:Ownership concentration:${personNodeId}`,
      kind: "Ownership concentration",
      nodeId: personNodeId,
      label: node?.label ?? personNodeId,
      ...(node?.reference ? { reference: node.reference } : {}),
      causal: false,
      founderDependency: founder,
      assurance: "Not applicable",
      basis,
      dependentAssessmentIds: assessmentIds,
      dependentMaterialAssessmentIds: materialIds,
      dependentModeNodeIds: modeNodeIds,
      dependentObjectiveIds: blast.objectiveIds,
      blast,
      provenanceEdgeIds: edgeIdsTo(personNodeId, ["OWNED_BY"]),
    });
  });

  // Enabling project: the only project delivering several objectives that live Icarus chains threaten.
  const chainedObjectiveIds = new Set<string>();
  currentModes.filter((mode) => mode.state !== "Barrier-held").forEach((mode) => modeReach(mode).forEach((step) => {
    const node = graph.nodeById.get(step.nodeId);
    if (node?.kind === "Strategic objective" && step.state !== "Unknown dependency" && node.reference) chainedObjectiveIds.add(node.reference.recordId);
  }));
  const soleProjectObjectives = new Map<string, string[]>();
  [...chainedObjectiveIds].sort().forEach((objectiveId) => {
    const supports = (graph.incoming.get(`Strategic Objective:${objectiveId}`) ?? []).filter((edge) => edge.type === "SUPPORTS");
    if (supports.length !== 1) return;
    const projectNodeId = supports[0].from;
    soleProjectObjectives.set(projectNodeId, [...(soleProjectObjectives.get(projectNodeId) ?? []), objectiveId]);
  });
  [...soleProjectObjectives.keys()].sort().forEach((projectNodeId) => {
    const objectiveIds = soleProjectObjectives.get(projectNodeId)!;
    if (objectiveIds.length < 2) return;
    const objectiveNodeIds = new Set(objectiveIds.map((id) => `Strategic Objective:${id}`));
    const threateningModes = currentModes.filter((mode) => mode.state !== "Barrier-held"
      && modeReach(mode).some((step) => objectiveNodeIds.has(step.nodeId) && step.state !== "Unknown dependency"));
    const assessmentIds = [...new Set(threateningModes.map((mode) => mode.assessmentId))].sort();
    const projectReach = propagateIcarusFailure(graph, projectNodeId);
    const blast = summarise([projectReach]);
    const node = graph.nodeById.get(projectNodeId);
    spofs.push({
      key: `spof:Enabling project:${projectNodeId}`,
      kind: "Enabling project",
      nodeId: projectNodeId,
      label: node?.label ?? projectNodeId,
      ...(node?.reference ? { reference: node.reference } : {}),
      causal: true,
      founderDependency: false,
      assurance: "Not applicable",
      basis: ["sole-enabling-project", "multiple-objectives",
        ...(blast.pillarIds.length >= 2 ? ["multiple-pillars" as const] : []),
        ...(blast.criticalObjectiveIds.length > 0 ? ["critical-objective" as const] : [])],
      dependentAssessmentIds: assessmentIds,
      dependentMaterialAssessmentIds: assessmentIds.filter((id) => graph.assessmentById.get(id)?.material === true),
      dependentModeNodeIds: threateningModes.map((mode) => mode.nodeId),
      dependentObjectiveIds: objectiveIds,
      blast,
      provenanceEdgeIds: (graph.outgoing.get(projectNodeId) ?? []).filter((edge) => edge.type === "SUPPORTS").map((edge) => edge.id),
    });
  });

  spofs.sort((left, right) =>
    Number(right.causal) - Number(left.causal)
    || compareBlast(left.blast, right.blast)
    || Number(right.founderDependency) - Number(left.founderDependency)
    || left.key.localeCompare(right.key));

  // ── Shared dependencies ──
  const shared: IcarusSharedDependency[] = [];
  dependentControlsByRecord.forEach((controlNodeIds, nodeId) => {
    const relevant = [...new Set(controlNodeIds)].filter((id) => {
      const control = graph.controlById.get(id)!;
      return currentModeIds.has(getIcarusFailureModeNodeId(control.assessmentId, control.failureModeId));
    }).sort();
    const assessmentIds = [...new Set(relevant.map((id) => graph.controlById.get(id)!.assessmentId))].sort();
    if (assessmentIds.length < 2) return;
    const node = graph.nodeById.get(nodeId);
    const recordType = node?.reference?.recordType;
    const kind: IcarusSharedDependencyKind = recordType === "System" || recordType === "SOP" ? "Common control mechanism" : "Shared dependency";
    const modes = currentModes.filter((mode) => relevant.some((id) => mode.controlNodeIds.includes(id)));
    shared.push({
      key: `shared:${kind}:${nodeId}`,
      kind,
      causal: true,
      nodeId,
      label: node?.label ?? nodeId,
      ...(node?.reference ? { reference: node.reference } : {}),
      assessmentIds,
      materialAssessmentIds: assessmentIds.filter((id) => graph.assessmentById.get(id)?.material === true),
      controlNodeIds: relevant,
      founderDependency: nodeId === founderNodeId,
      blast: summarise(modes.map(modeReach), nodeId === founderNodeId),
      provenanceEdgeIds: edgeIdsTo(nodeId, ["DEPENDS_ON"]),
    });
  });
  const addConcentration = (kind: IcarusSharedDependencyKind, edgeType: string) => {
    const byTarget = new Map<string, Set<string>>();
    graph.edges.filter((edge) => edge.type === edgeType).forEach((edge) => edge.provenance.forEach((provenance) => {
      if (!provenance.assessmentId || !currentAssessmentIds.has(provenance.assessmentId)) return;
      byTarget.set(edge.to, new Set([...(byTarget.get(edge.to) ?? []), provenance.assessmentId]));
    }));
    byTarget.forEach((assessmentSet, nodeId) => {
      const assessmentIds = [...assessmentSet].sort();
      if (assessmentIds.length < 2) return;
      const node = graph.nodeById.get(nodeId);
      const modes = currentModes.filter((mode) => assessmentSet.has(mode.assessmentId) && mode.state !== "Barrier-held");
      shared.push({
        key: `shared:${kind}:${nodeId}`,
        kind,
        causal: isIcarusSharedDependencyCausal(kind),
        nodeId,
        label: node?.label ?? nodeId,
        ...(node?.reference ? { reference: node.reference } : {}),
        assessmentIds,
        materialAssessmentIds: assessmentIds.filter((id) => graph.assessmentById.get(id)?.material === true),
        controlNodeIds: [],
        founderDependency: nodeId === founderNodeId,
        blast: summarise(modes.map(modeReach), nodeId === founderNodeId),
        provenanceEdgeIds: edgeIdsTo(nodeId, [edgeType]),
      });
    });
  };
  addConcentration("Common owner", "OWNED_BY");
  addConcentration("Common remediation", "REMEDIATED_BY");
  // Common strategic target: only assessments whose chains currently reach the objective (not barrier-held ones).
  const targetAssessments = new Map<string, Set<string>>();
  currentModes.filter((mode) => mode.state !== "Barrier-held").forEach((mode) => modeReach(mode).forEach((step) => {
    const node = graph.nodeById.get(step.nodeId);
    if (node?.kind !== "Strategic objective" || step.state === "Unknown dependency") return;
    targetAssessments.set(node.id, new Set([...(targetAssessments.get(node.id) ?? []), mode.assessmentId]));
  }));
  targetAssessments.forEach((assessmentSet, nodeId) => {
    const assessmentIds = [...assessmentSet].sort();
    if (assessmentIds.length < 2) return;
    const node = graph.nodeById.get(nodeId);
    const modes = currentModes.filter((mode) => assessmentSet.has(mode.assessmentId) && mode.state !== "Barrier-held");
    shared.push({
      key: `shared:Common strategic target:${nodeId}`,
      kind: "Common strategic target",
      causal: false,
      nodeId,
      label: node?.label ?? nodeId,
      ...(node?.reference ? { reference: node.reference } : {}),
      assessmentIds,
      materialAssessmentIds: assessmentIds.filter((id) => graph.assessmentById.get(id)?.material === true),
      controlNodeIds: [],
      founderDependency: false,
      blast: summarise(modes.map(modeReach)),
      provenanceEdgeIds: edgeIdsTo(nodeId, ["THREATENS"]),
    });
  });
  shared.sort((left, right) =>
    Number(right.causal) - Number(left.causal)
    || right.materialAssessmentIds.length - left.materialAssessmentIds.length
    || compareBlast(left.blast, right.blast)
    || left.key.localeCompare(right.key));

  // ── Chains ──
  const causalSpofs = spofs.filter((spof) => spof.causal);
  const causalShared = shared.filter((entry) => entry.causal);
  const chains: IcarusFailureChain[] = currentModes.map((mode) => {
    const assessment = graph.assessmentById.get(mode.assessmentId)!;
    const barriers: IcarusChainBarrier[] = mode.controlNodeIds.map((nodeId) => {
      const control = graph.controlById.get(nodeId)!;
      return {
        nodeId,
        controlId: control.controlId,
        intervention: control.intervention,
        state: control.barrier,
        status: control.status,
        dependencyNodeIds: control.dependencyNodeIds,
      };
    });
    const status: IcarusChainStatus = mode.barrier === "Active" ? "Interrupted"
      : mode.barrier === "Weak" || mode.barrier === "Unknown" ? "Potential" : "Active";
    const propagation = status === "Potential"
      ? propagateIcarusFailure(graph, mode.nodeId, { potentialOnly: true })
      : modeReach(mode);
    const spofKeys = causalSpofs
      .filter((spof) => spof.dependentModeNodeIds.includes(mode.nodeId))
      .map((spof) => spof.key);
    const founderSpof = spofs.some((spof) => spof.founderDependency
      && (spof.dependentModeNodeIds.includes(mode.nodeId) || (!spof.causal && spof.dependentMaterialAssessmentIds.includes(mode.assessmentId))));
    const sharedDependencyKeys = causalShared
      .filter((entry) => entry.controlNodeIds.some((id) => mode.controlNodeIds.includes(id)))
      .map((entry) => entry.key);
    const blast = summarise([propagation], founderSpof);
    const basis = new Set<IcarusChainPriorityBasis>();
    if (mode.state === "Material exposure") basis.add("material-origin");
    if (barriers.some((barrier) => barrier.state === "Failed")) basis.add("failed-barrier");
    if (status === "Potential") basis.add("potential-only");
    if (blast.criticalObjectiveIds.length > 0) basis.add("critical-objective");
    if (blast.radius === "Cross-objective") basis.add("cross-objective");
    if (blast.radius === "Cross-pillar") basis.add("cross-pillar");
    if (blast.radius === "Empire-wide") basis.add("empire-wide");
    if (spofKeys.length > 0) basis.add("spof");
    if (founderSpof) basis.add("founder-spof");
    if (sharedDependencyKeys.length > 0) basis.add("common-cause");
    if (mode.accepted) basis.add("accepted-exposure");
    if (status === "Interrupted") basis.add("interrupted");
    const signal = signalByAssessment.get(mode.assessmentId);
    return {
      key: mode.nodeId,
      assessmentId: mode.assessmentId,
      failureModeId: mode.failureModeId,
      outcome: assessment.outcome,
      mechanism: mode.mechanism,
      identityKey: signal?.key ?? getIcarusIdentityKey(mode.assessmentId),
      origin: mode.state,
      status,
      accepted: mode.accepted,
      barrier: mode.barrier,
      barriers,
      propagation,
      blast,
      priority: status === "Interrupted" ? "Contained" : classifyIcarusChainPriority(basis),
      basis: [...basis].sort(),
      spofKeys,
      sharedDependencyKeys,
      riskScore: assessment.riskScore,
    };
  });
  const compareChains = (left: IcarusFailureChain, right: IcarusFailureChain) =>
    getIcarusChainPriorityRank(left.priority) - getIcarusChainPriorityRank(right.priority)
    || (left.origin === right.origin ? 0 : left.origin === "Material exposure" ? -1 : right.origin === "Material exposure" ? 1 : 0)
    || (graph.modeById.get(left.key)?.exposure ? getIcarusExposureRank(graph.modeById.get(left.key)!.exposure!) : 99)
      - (graph.modeById.get(right.key)?.exposure ? getIcarusExposureRank(graph.modeById.get(right.key)!.exposure!) : 99)
    || compareBlast(left.blast, right.blast)
    || right.riskScore - left.riskScore
    || left.key.localeCompare(right.key);
  const failureChains = chains.filter((chain) => chain.status !== "Interrupted").sort(compareChains);
  const interruptedChains = chains.filter((chain) => chain.status === "Interrupted").sort(compareChains);

  // ── Cut points / restorations / two-point fragility ──
  const criticalCutPoints: IcarusCutPoint[] = breaks
    .filter((entry) => entry.exposedModeNodeIds.length > 0)
    .filter((entry) => entry.blast.materialAssessmentIds.length >= 2 || getIcarusBlastRadiusRank(entry.blast.radius) >= getIcarusBlastRadiusRank("Cross-objective"))
    .map((entry) => ({
      key: `cut:${entry.kind}:${entry.nodeId}`,
      nodeId: entry.nodeId,
      kind: entry.kind,
      label: entry.label,
      ...(entry.reference ? { reference: entry.reference } : {}),
      exposedModeNodeIds: entry.exposedModeNodeIds,
      newlyExposedModeNodeIds: entry.newlyExposedModeNodeIds,
      blast: entry.blast,
    }))
    .sort((left, right) => compareBlast(left.blast, right.blast)
      || right.newlyExposedModeNodeIds.length - left.newlyExposedModeNodeIds.length
      || left.key.localeCompare(right.key));

  const barrierWeaknesses: IcarusBarrierRestoration[] = failureChains.flatMap((chain) => chain.barriers
    .filter((barrier) => barrier.state === "Failed" || barrier.state === "Weak" || barrier.state === "Unknown")
    .map((barrier): IcarusBarrierRestoration => ({
      key: `restore:${barrier.nodeId}`,
      controlNodeId: barrier.nodeId,
      chainKey: chain.key,
      assessmentId: chain.assessmentId,
      failureModeId: chain.failureModeId,
      controlId: barrier.controlId,
      intervention: barrier.intervention,
      state: barrier.state,
      interrupts: summarise([modeReach(graph.modeById.get(chain.key)!)]),
      chainPriority: chain.priority,
    })))
    .sort((left, right) =>
      getIcarusChainPriorityRank(left.chainPriority) - getIcarusChainPriorityRank(right.chainPriority)
      || compareBlast(left.interrupts, right.interrupts)
      || left.key.localeCompare(right.key));

  const twoPointFragilities: IcarusTwoPointFragility[] = currentModes
    .filter((mode) => mode.activeBarrierNodeIds.length === 2)
    .flatMap((mode) => {
      const blast = summarise([modeReach(mode)]);
      if (blast.objectiveIds.length === 0) return [];
      const [first, second] = mode.activeBarrierNodeIds as [string, string];
      const secondDependencies = new Set(graph.controlById.get(second)?.dependencyNodeIds ?? []);
      const sharedDependencyNodeIds = (graph.controlById.get(first)?.dependencyNodeIds ?? []).filter((id) => secondDependencies.has(id));
      return [{
        key: `fragility:${mode.nodeId}`,
        modeNodeId: mode.nodeId,
        assessmentId: mode.assessmentId,
        failureModeId: mode.failureModeId,
        controlNodeIds: [first, second] as [string, string],
        independence: sharedDependencyNodeIds.length > 0 ? "Shared dependency" as const : "Unknown" as const,
        sharedDependencyNodeIds,
        blast,
      }];
    })
    .sort((left, right) => Number(right.independence === "Shared dependency") - Number(left.independence === "Shared dependency")
      || compareBlast(left.blast, right.blast) || left.key.localeCompare(right.key));

  // ── Pillar rollup ──
  const pillarChainExposure: IcarusPillarChainExposure[] = OPERATING_PILLARS.map((pillar) => {
    const reaching = failureChains.filter((chain) => chain.blast.pillarIds.includes(pillar.id));
    const spofKeys = causalSpofs.filter((spof) => spof.blast.pillarIds.includes(pillar.id)).map((spof) => spof.key).sort();
    const crossPillarChainKeys = reaching.filter((chain) => chain.blast.pillarIds.length >= 2).map((chain) => chain.key).sort();
    const state: IcarusPillarChainState = spofKeys.length > 0 ? "Single-point dependent"
      : crossPillarChainKeys.length > 0 ? "Cross-pillar"
        : reaching.length > 0 ? "Contained" : "No chain exposure";
    return {
      pillarId: pillar.id,
      label: pillar.label,
      state,
      chainKeys: reaching.map((chain) => chain.key).sort(),
      crossPillarChainKeys,
      spofKeys,
      sharedDependencyKeys: causalShared.filter((entry) => entry.blast.pillarIds.includes(pillar.id)).map((entry) => entry.key).sort(),
      weakBarrierControlNodeIds: [...new Set(reaching.flatMap((chain) => chain.barriers
        .filter((barrier) => barrier.state !== "Active" && barrier.state !== "None").map((barrier) => barrier.nodeId)))].sort(),
    };
  });

  // ── Signal annotation (Command / Founder Focus) ──
  const signalAnnotations = annotateSignals({ signals: input.signals, failureChains, spofs, shared: causalShared });

  return {
    dependencyGraph: graph,
    failureChains,
    interruptedChains,
    singlePointsOfFailure: spofs,
    sharedDependencies: shared,
    barrierWeaknesses,
    criticalCutPoints,
    twoPointFragilities,
    pillarChainExposure,
    founderSynthesis: {
      ...(criticalCutPoints[0] ? { mostDamagingCutPointKey: criticalCutPoints[0].key } : {}),
      ...(causalSpofs[0] ? { heaviestSpofKey: causalSpofs[0].key } : {}),
      ...(barrierWeaknesses[0] ? { bestRestorationKey: barrierWeaknesses[0].key } : {}),
      connectedOutcomeKeys: shared.filter((entry) => entry.kind === "Common strategic target" || entry.causal)
        .filter((entry) => entry.materialAssessmentIds.length >= 2).map((entry) => entry.key),
      founderSpofKeys: spofs.filter((spof) => spof.founderDependency).map((spof) => spof.key),
    },
    signalAnnotations,
  };
}

type SystemicIssue = {
  key: string;
  memberAssessmentIds: string[];
  commandReason: string;
  focusReason: string;
  rank: number;
};

function describeDependency(label: string, reference?: IcarusRecordReference): string {
  if (!reference) return label;
  return reference.recordType === "Person" ? "person" : `${reference.recordType} dependency`;
}

function annotateSignals(input: {
  signals: readonly IcarusStrategicSignal[];
  failureChains: readonly IcarusFailureChain[];
  spofs: readonly IcarusSinglePointOfFailure[];
  shared: readonly IcarusSharedDependency[];
}): Map<string, IcarusSignalFailureChain> {
  const annotations = new Map<string, IcarusSignalFailureChain>();
  const signalOrder = [...input.signals].sort((left, right) =>
    (left.materialityTier === right.materialityTier ? 0 : left.materialityTier === "Material" ? -1 : 1)
    || right.riskScore - left.riskScore || left.key.localeCompare(right.key));
  const materialSignalIds = new Set(input.signals.filter((signal) => signal.materialityTier === "Material").map((signal) => signal.assessmentId));

  // Systemic issues shared by several material risks are carried by exactly one member signal.
  const issues: SystemicIssue[] = [];
  input.spofs.forEach((spof) => {
    const members = spof.dependentMaterialAssessmentIds.filter((id) => materialSignalIds.has(id));
    if (spof.founderDependency && members.length >= 2) {
      issues.push({
        key: spof.key,
        memberAssessmentIds: members,
        commandReason: `FAILURE CHAIN: FOUNDER DEPENDENCY CARRIES ${members.length} MATERIAL RISKS`,
        focusReason: `Failure chain: founder dependency is a single point of failure across ${plural(members.length, "material risk")}.`,
        rank: 0,
      });
      return;
    }
    if (!spof.causal) return;
    if (spof.kind === "Dependency" && members.length >= 2) {
      const objectives = spof.dependentObjectiveIds.length;
      const what = `the same ${spofAssuranceText[spof.assurance]} ${describeDependency(spof.label, spof.reference)}`.replace(/\s+/g, " ");
      const subject = `${plural(members.length, "material risk")}${objectives > 0 ? ` and ${plural(objectives, "objective")}` : ""}`;
      issues.push({
        key: spof.key,
        memberAssessmentIds: members,
        commandReason: `FAILURE CHAIN: ${subject} DEPEND ON ${what}`.toUpperCase(),
        focusReason: `Failure chain: ${subject} depend on ${what}.`,
        rank: 1,
      });
      return;
    }
    if (spof.kind === "Control" && members.length >= 1 && spof.assurance !== "Strong") {
      const objectives = spof.blast.objectiveIds.length;
      const pillars = spof.blast.pillarIds.length;
      const scope = objectives >= 2 ? plural(objectives, "objective") : plural(pillars, "pillar");
      issues.push({
        key: spof.key,
        memberAssessmentIds: members,
        commandReason: `FAILURE CHAIN: ONE ${spofAssuranceText[spof.assurance].toUpperCase()} CONTROL IS THE ONLY BARRIER FOR ${scope.toUpperCase()}`,
        focusReason: `Failure chain: one ${spofAssuranceText[spof.assurance]} control is the only barrier protecting ${scope}.`,
        rank: 2,
      });
    }
  });
  input.shared.forEach((entry) => {
    const members = entry.materialAssessmentIds.filter((id) => materialSignalIds.has(id));
    if (members.length < 2) return;
    if (issues.some((issue) => issue.key === `spof:Dependency:${entry.nodeId}`)) return;
    issues.push({
      key: entry.key,
      memberAssessmentIds: members,
      commandReason: `FAILURE CHAIN: ${members.length} MATERIAL RISKS SHARE ONE ${describeDependency(entry.label, entry.reference).toUpperCase()}`,
      focusReason: `Failure chain: ${plural(members.length, "material risk")} share one ${describeDependency(entry.label, entry.reference)} (common cause).`,
      rank: 3,
    });
  });
  issues.sort((left, right) => left.rank - right.rank
    || right.memberAssessmentIds.length - left.memberAssessmentIds.length
    || left.key.localeCompare(right.key));

  const carried = new Map<string, SystemicIssue>();
  issues.forEach((issue) => {
    const carrier = signalOrder.find((signal) => issue.memberAssessmentIds.includes(signal.assessmentId) && !carried.has(signal.assessmentId));
    if (carrier) carried.set(carrier.assessmentId, issue);
  });

  input.signals.forEach((signal) => {
    const chains = input.failureChains.filter((chain) => chain.assessmentId === signal.assessmentId);
    if (chains.length === 0) return;
    const best = chains[0];
    const radius = [...chains].sort((left, right) => getIcarusBlastRadiusRank(right.blast.radius) - getIcarusBlastRadiusRank(left.blast.radius))[0].blast;
    const basis = [...new Set(chains.flatMap((chain) => chain.basis))].sort();
    let issue = carried.get(signal.assessmentId);
    // A material chain reaching several objectives/pillars is itself worth stating, once, on its own signal.
    if (!issue && signal.materialityTier === "Material" && best.basis.includes("material-origin")
      && getIcarusBlastRadiusRank(radius.radius) >= getIcarusBlastRadiusRank("Cross-objective")) {
      const scope = radius.pillarIds.length >= 2
        ? `${radius.radius === "Empire-wide" ? "every operating pillar" : plural(radius.pillarIds.length, "pillar")}`
        : plural(radius.objectiveIds.length, "objective");
      issue = {
        key: `blast:${signal.assessmentId}`,
        memberAssessmentIds: [signal.assessmentId],
        commandReason: `FAILURE CHAIN: ${radius.radius.toUpperCase()} BLAST RADIUS (${scope.toUpperCase()})`,
        focusReason: `Failure chain: ${radius.radius.toLowerCase()} blast radius reaching ${scope}.`,
        rank: 4,
      };
    }
    annotations.set(signal.assessmentId, {
      priority: best.priority,
      blastRadius: radius.radius,
      basis,
      spofKeys: [...new Set(chains.flatMap((chain) => chain.spofKeys))].sort(),
      sharedDependencyKeys: [...new Set(chains.flatMap((chain) => chain.sharedDependencyKeys))].sort(),
      weakBarrierControlIds: [...new Set(chains.flatMap((chain) => chain.barriers
        .filter((barrier) => barrier.state === "Failed" || barrier.state === "Weak" || barrier.state === "Unknown")
        .map((barrier) => barrier.controlId)))].sort(),
      ...(issue ? { commandReason: issue.commandReason, focusReason: issue.focusReason } : {}),
    });
  });
  return annotations;
}

// Attaches the failure-chain annotation to assured signals. Exposure, materiality and assurance are untouched.
export function attachIcarusFailureChainToSignals(
  signals: readonly IcarusStrategicSignal[],
  intelligence: Pick<IcarusFailureChainIntelligence, "signalAnnotations">,
): IcarusStrategicSignal[] {
  return signals.map((signal) => {
    const failureChain = intelligence.signalAnnotations.get(signal.assessmentId);
    return failureChain ? { ...signal, failureChain } : signal;
  });
}
