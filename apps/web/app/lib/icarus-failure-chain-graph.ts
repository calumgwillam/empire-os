import {
  getIcarusIdentityKey,
  getIcarusReferenceKey,
  type IcarusAssessmentRecord,
  type IcarusRecordReference,
} from "./icarus";
import type { IcarusAssuranceResult, IcarusControlAssurance } from "./icarus-assurance";
import type { IcarusControlAssuranceStatus } from "./icarus-assurance-policy";
import {
  getIcarusMaterialityTier,
  type IcarusExposure,
  type IcarusObjectiveImportance,
} from "./icarus-materiality-policy";
import type { IcarusStrategicObjectiveContext, IcarusStrategicSignal } from "./icarus-strategic-attention";
import {
  getIcarusBarrierState,
  getIcarusBarrierStrengthRank,
  getIcarusPropagationStateRank,
  isIcarusBarrierCapable,
  type IcarusBarrierState,
  type IcarusPropagationState,
} from "./icarus-failure-chain-policy";
import { resolveOperatingPillar, type OperatingPillarId } from "./pillar-identity";

// Directed failure-chain / dependency graph over Icarus records and the Empire identities they explicitly reference.
//
// Edge semantics (only causal edges carry failure):
//   CAN_TRIGGER    failure mode -> assessment          Structural: the mechanism realises the assessed failure.
//   CONTROLLED_BY  failure mode -> control             Barrier: the control may interrupt the mechanism.
//   DEPENDS_ON     control -> record                   Structural: the control is implemented through the record
//                                                      ("Link an authoritative Action, System, SOP or other record");
//                                                      failure flows record -> control.
//   THREATENS      assessment -> live objective/pillar Structural when the assessment links it; Derived when the
//                                                      pillar only comes from a control/evidence link.
//   PART_OF        objective -> operating pillar       Derived: only when the objective's stored pillar resolves to
//                                                      an operating pillar (strategic themes never do).
//   SUPPORTS       project -> live objective           Structural: the objective's own linkedProjectIds.
//   OWNED_BY       assessment/control -> Person        Governance only; never carries failure.
//   REMEDIATED_BY  assessment -> Action                Governance only (assurance obligation action links).
//   EVIDENCED_BY   failure mode -> record              Evidence only.
//   CONCERNS       assessment -> other linked record   Context: a reference with no declared dependency direction.
//                                                      Reported as an "Unknown dependency", never traversed.

export type IcarusChainNodeKind = "Assessment" | "Failure mode" | "Control" | "Record" | "Strategic objective" | "Operating pillar";

export type IcarusChainNode = {
  id: string;
  kind: IcarusChainNodeKind;
  label: string;
  assessmentId?: string;
  failureModeId?: string;
  controlId?: string;
  // Empire record identity for Record / Strategic objective / Operating pillar nodes.
  reference?: IcarusRecordReference;
  pillarId?: OperatingPillarId;
};

export const ICARUS_CHAIN_EDGE_TYPES = [
  "CAN_TRIGGER",
  "CONTROLLED_BY",
  "DEPENDS_ON",
  "THREATENS",
  "PART_OF",
  "SUPPORTS",
  "OWNED_BY",
  "REMEDIATED_BY",
  "EVIDENCED_BY",
  "CONCERNS",
] as const;
export type IcarusChainEdgeType = (typeof ICARUS_CHAIN_EDGE_TYPES)[number];

export type IcarusChainEdgeClass =
  | "Structural dependency"
  | "Derived dependency"
  | "Barrier"
  | "Governance"
  | "Evidence"
  | "Context";

export type IcarusChainEdgeOrigin =
  | "Failure mode"
  | "Control"
  | "Control link"
  | "Assessment link"
  | "Evidence source"
  | "Objective pillar"
  | "Objective project link"
  | "Risk owner"
  | "Control owner"
  | "Assurance action link";

export type IcarusChainEdgeProvenance = {
  origin: IcarusChainEdgeOrigin;
  reason: string;
  assessmentId?: string;
  failureModeId?: string;
  controlId?: string;
  evidenceId?: string;
  obligationId?: string;
  objectiveId?: string;
};

export type IcarusChainEdge = {
  id: string;
  type: IcarusChainEdgeType;
  from: string;
  to: string;
  edgeClass: IcarusChainEdgeClass;
  basis: "Direct" | "Derived";
  causal: boolean;
  // Every route that produced this edge (duplicate routes collapse into one edge with several provenances).
  provenance: IcarusChainEdgeProvenance[];
};

export type IcarusFailureModeChainState = "Material exposure" | "Corroborating exposure" | "Barrier-held" | "Not current";

export type IcarusChainAssessment = {
  nodeId: string;
  assessmentId: string;
  outcome: string;
  // Present when the assessment is a current strategic signal (material or corroborating).
  signalKey?: string;
  material: boolean;
  exposure?: IcarusExposure;
  riskScore: number;
  objectiveImportance?: IcarusObjectiveImportance;
  riskOwnerPersonId?: string;
};

export type IcarusChainFailureMode = {
  nodeId: string;
  assessmentId: string;
  failureModeId: string;
  mechanism: string;
  state: IcarusFailureModeChainState;
  exposure?: IcarusExposure;
  accepted: boolean;
  // Strongest barrier on the mode (None when it has no operating control).
  barrier: IcarusBarrierState;
  controlNodeIds: string[];
  activeBarrierNodeIds: string[];
  capableBarrierNodeIds: string[];
};

export type IcarusChainControl = {
  nodeId: string;
  assessmentId: string;
  failureModeId: string;
  controlId: string;
  intervention: string;
  status: IcarusControlAssuranceStatus;
  barrier: IcarusBarrierState;
  // DEPENDS_ON targets (record node ids), sorted.
  dependencyNodeIds: string[];
  ownerPersonId?: string;
};

export type IcarusDependencyGraph = {
  nodes: IcarusChainNode[];
  edges: IcarusChainEdge[];
  nodeById: ReadonlyMap<string, IcarusChainNode>;
  outgoing: ReadonlyMap<string, readonly IcarusChainEdge[]>;
  incoming: ReadonlyMap<string, readonly IcarusChainEdge[]>;
  assessments: IcarusChainAssessment[];
  modes: IcarusChainFailureMode[];
  controls: IcarusChainControl[];
  assessmentById: ReadonlyMap<string, IcarusChainAssessment>;
  modeById: ReadonlyMap<string, IcarusChainFailureMode>;
  controlById: ReadonlyMap<string, IcarusChainControl>;
  objectiveImportance: ReadonlyMap<string, IcarusObjectiveImportance>;
};

export type IcarusDependencyGraphInput = {
  assessments: readonly IcarusAssessmentRecord[];
  // Assured strategic signals (materiality already decided).
  signals: readonly IcarusStrategicSignal[];
  assurance: IcarusAssuranceResult;
  strategicObjectives: ReadonlyMap<string, IcarusStrategicObjectiveContext>;
};

export function getIcarusFailureModeNodeId(assessmentId: string, failureModeId: string): string {
  return `icarus-failure-mode:${assessmentId}:${failureModeId}`;
}

export function getIcarusControlNodeId(assessmentId: string, controlId: string): string {
  return `icarus-control:${assessmentId}:${controlId}`;
}

export function getIcarusPillarNodeId(pillarId: OperatingPillarId): string {
  return `Pillar:${pillarId}`;
}

function compareProvenance(left: IcarusChainEdgeProvenance, right: IcarusChainEdgeProvenance): number {
  return [
    left.assessmentId ?? "", left.origin, left.failureModeId ?? "", left.controlId ?? "", left.evidenceId ?? "",
    left.obligationId ?? "", left.objectiveId ?? "",
  ].join("\u0000").localeCompare([
    right.assessmentId ?? "", right.origin, right.failureModeId ?? "", right.controlId ?? "", right.evidenceId ?? "",
    right.obligationId ?? "", right.objectiveId ?? "",
  ].join("\u0000"));
}

function provenanceKey(provenance: IcarusChainEdgeProvenance): string {
  return [provenance.assessmentId, provenance.origin, provenance.failureModeId, provenance.controlId,
    provenance.evidenceId, provenance.obligationId, provenance.objectiveId].map((value) => value ?? "").join("\u0000");
}

export function compareIcarusChainEdges(left: IcarusChainEdge, right: IcarusChainEdge): number {
  return left.id.localeCompare(right.id);
}

// Failure-carrying direction of a causal edge: [where failure starts, where it arrives]. Non-causal edges carry none.
export function getIcarusFailureFlow(edge: IcarusChainEdge): [string, string] | null {
  if (!edge.causal) return null;
  if (edge.type === "DEPENDS_ON") return [edge.to, edge.from];
  return [edge.from, edge.to];
}

function getModeState(material: boolean, exposure: IcarusExposure | undefined, activeBarriers: number): IcarusFailureModeChainState {
  if (material && exposure) return getIcarusMaterialityTier(exposure) === "Material" ? "Material exposure" : "Corroborating exposure";
  return activeBarriers > 0 ? "Barrier-held" : "Not current";
}

function strongestBarrier(states: readonly IcarusBarrierState[]): IcarusBarrierState {
  return [...states].sort((left, right) => getIcarusBarrierStrengthRank(left) - getIcarusBarrierStrengthRank(right))[0] ?? "None";
}

export function buildIcarusDependencyGraph(input: IcarusDependencyGraphInput): IcarusDependencyGraph {
  const nodes = new Map<string, IcarusChainNode>();
  const edges = new Map<string, IcarusChainEdge>();
  const signalByAssessment = new Map(input.signals.map((signal) => [signal.assessmentId, signal] as const));
  const firstAssessment = new Map<string, IcarusAssessmentRecord>();
  input.assessments.forEach((assessment) => {
    if (!firstAssessment.has(assessment.id)) firstAssessment.set(assessment.id, assessment);
  });

  const addNode = (node: IcarusChainNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addRecordNode = (reference: IcarusRecordReference): string => {
    const id = getIcarusReferenceKey(reference);
    addNode({
      id,
      kind: reference.recordType === "Strategic Objective" ? "Strategic objective" : "Record",
      label: `${reference.recordType} ${reference.recordId}`,
      reference: { recordType: reference.recordType, recordId: reference.recordId },
    });
    return id;
  };
  const addPillarNode = (pillarId: OperatingPillarId, label: string): string => {
    const id = getIcarusPillarNodeId(pillarId);
    addNode({ id, kind: "Operating pillar", label, pillarId, reference: { recordType: "Pillar", recordId: pillarId } });
    return id;
  };
  const addEdge = (
    edge: Omit<IcarusChainEdge, "id" | "provenance">,
    provenance: IcarusChainEdgeProvenance,
  ) => {
    const id = `${edge.type}|${edge.from}|${edge.to}`;
    const existing = edges.get(id);
    if (!existing) {
      edges.set(id, { ...edge, id, provenance: [provenance] });
      return;
    }
    // A direct route always outranks a derived one for the same edge.
    if (edge.basis === "Direct" && existing.basis === "Derived") {
      existing.basis = "Direct";
      existing.edgeClass = edge.edgeClass;
    }
    if (!existing.provenance.some((entry) => provenanceKey(entry) === provenanceKey(provenance))) {
      existing.provenance.push(provenance);
    }
  };

  const assessments: IcarusChainAssessment[] = [];
  const modes: IcarusChainFailureMode[] = [];
  const controls: IcarusChainControl[] = [];
  const threatenedObjectiveIds = new Set<string>();

  input.assurance.assessments.forEach((assessmentAssurance) => {
    const assessment = firstAssessment.get(assessmentAssurance.assessmentId);
    if (!assessment || assessment.status === "Closed") return;
    const assessmentId = assessment.id;
    const assessmentNodeId = getIcarusIdentityKey(assessmentId);
    const signal = signalByAssessment.get(assessmentId);
    addNode({ id: assessmentNodeId, kind: "Assessment", label: assessment.outcome.trim() || assessmentId, assessmentId });
    assessments.push({
      nodeId: assessmentNodeId,
      assessmentId,
      outcome: assessment.outcome.trim() || assessmentId,
      ...(signal ? { signalKey: signal.key, exposure: signal.exposure } : {}),
      material: signal?.materialityTier === "Material",
      riskScore: signal?.riskScore ?? 0,
      ...(assessmentAssurance.objectiveImportance ? { objectiveImportance: assessmentAssurance.objectiveImportance } : {}),
      ...(assessmentAssurance.riskOwnerPersonId ? { riskOwnerPersonId: assessmentAssurance.riskOwnerPersonId } : {}),
    });

    const controlAssurance = new Map<string, IcarusControlAssurance>(
      assessmentAssurance.controls.map((control) => [control.controlId, control] as const),
    );
    assessmentAssurance.modes.forEach((modeAssurance) => {
      const mode = assessment.failureModes.find((candidate) => candidate.id === modeAssurance.failureModeId);
      if (!mode) return;
      const modeNodeId = getIcarusFailureModeNodeId(assessmentId, mode.id);
      const modeControls = assessment.controls.filter((control) => control.failureModeId === mode.id);
      const controlNodeIds: string[] = [];
      const activeBarrierNodeIds: string[] = [];
      const capableBarrierNodeIds: string[] = [];
      const barrierStates: IcarusBarrierState[] = [];

      modeControls.forEach((control) => {
        const status = controlAssurance.get(control.id)?.status ?? "Not operating";
        const barrier = getIcarusBarrierState(status);
        const controlNodeId = getIcarusControlNodeId(assessmentId, control.id);
        controlNodeIds.push(controlNodeId);
        barrierStates.push(barrier);
        if (barrier === "Active") activeBarrierNodeIds.push(controlNodeId);
        if (isIcarusBarrierCapable(barrier)) capableBarrierNodeIds.push(controlNodeId);
        addNode({
          id: controlNodeId,
          kind: "Control",
          label: control.intervention.trim() || control.id,
          assessmentId,
          failureModeId: mode.id,
          controlId: control.id,
        });
        addEdge(
          { type: "CONTROLLED_BY", from: modeNodeId, to: controlNodeId, edgeClass: "Barrier", basis: "Direct", causal: false },
          { origin: "Control", reason: "Control recorded against this failure mode", assessmentId, failureModeId: mode.id, controlId: control.id },
        );

        const dependencyNodeIds = new Set<string>();
        // Retired controls no longer implement anything; their links describe history, not dependency.
        if (control.lifecycle !== "Retired") {
          control.linkedRecords.forEach((reference) => {
            if (reference.recordType === "Pillar") {
              const pillar = resolveOperatingPillar(reference.recordId);
              if (!pillar) return;
              addEdge(
                { type: "THREATENS", from: assessmentNodeId, to: addPillarNode(pillar.id, pillar.label), edgeClass: "Derived dependency", basis: "Derived", causal: true },
                { origin: "Control link", reason: "Pillar inferred from a control link", assessmentId, failureModeId: mode.id, controlId: control.id },
              );
              return;
            }
            if (reference.recordType === "Strategic Objective") {
              // A control citing an objective declares context, not an implementation dependency.
              addEdge(
                { type: "CONCERNS", from: controlNodeId, to: addRecordNode(reference), edgeClass: "Context", basis: "Direct", causal: false },
                { origin: "Control link", reason: "Control references this objective without a dependency direction", assessmentId, failureModeId: mode.id, controlId: control.id },
              );
              return;
            }
            const recordNodeId = addRecordNode(reference);
            dependencyNodeIds.add(recordNodeId);
            addEdge(
              { type: "DEPENDS_ON", from: controlNodeId, to: recordNodeId, edgeClass: "Structural dependency", basis: "Direct", causal: true },
              { origin: "Control link", reason: "Control is implemented through this authoritative record", assessmentId, failureModeId: mode.id, controlId: control.id },
            );
          });
        }
        if (control.ownerPersonId) {
          addEdge(
            { type: "OWNED_BY", from: controlNodeId, to: addRecordNode({ recordType: "Person", recordId: control.ownerPersonId }), edgeClass: "Governance", basis: "Direct", causal: false },
            { origin: "Control owner", reason: "Accountable control owner", assessmentId, failureModeId: mode.id, controlId: control.id },
          );
        }
        controls.push({
          nodeId: controlNodeId,
          assessmentId,
          failureModeId: mode.id,
          controlId: control.id,
          intervention: control.intervention.trim() || control.id,
          status,
          barrier,
          dependencyNodeIds: [...dependencyNodeIds].sort(),
          ...(control.ownerPersonId ? { ownerPersonId: control.ownerPersonId } : {}),
        });
      });

      const state = getModeState(modeAssurance.material, modeAssurance.exposure, activeBarrierNodeIds.length);
      addNode({
        id: modeNodeId,
        kind: "Failure mode",
        label: modeAssurance.mechanism,
        assessmentId,
        failureModeId: mode.id,
      });
      addEdge(
        { type: "CAN_TRIGGER", from: modeNodeId, to: assessmentNodeId, edgeClass: "Structural dependency", basis: "Direct", causal: true },
        { origin: "Failure mode", reason: "Failure mechanism recorded against this outcome", assessmentId, failureModeId: mode.id },
      );
      mode.evidence.forEach((evidence) => {
        if (!evidence.reference) return;
        if (evidence.reference.recordType === "Pillar") {
          const pillar = resolveOperatingPillar(evidence.reference.recordId);
          // Only evidence that supports the mechanism of a current mode can attribute a pillar.
          if (!pillar || state === "Not current" || evidence.review !== "Supports") return;
          addEdge(
            { type: "THREATENS", from: assessmentNodeId, to: addPillarNode(pillar.id, pillar.label), edgeClass: "Derived dependency", basis: "Derived", causal: true },
            { origin: "Evidence source", reason: "Pillar inferred from supporting evidence", assessmentId, failureModeId: mode.id, evidenceId: evidence.id },
          );
          return;
        }
        addEdge(
          { type: "EVIDENCED_BY", from: modeNodeId, to: addRecordNode(evidence.reference), edgeClass: "Evidence", basis: "Direct", causal: false },
          { origin: "Evidence source", reason: "Evidence about this failure mechanism", assessmentId, failureModeId: mode.id, evidenceId: evidence.id },
        );
      });

      modes.push({
        nodeId: modeNodeId,
        assessmentId,
        failureModeId: mode.id,
        mechanism: modeAssurance.mechanism,
        state,
        ...(modeAssurance.exposure ? { exposure: modeAssurance.exposure } : {}),
        accepted: modeAssurance.assurance === "Accepted" || modeAssurance.acceptanceId !== undefined,
        barrier: strongestBarrier(barrierStates),
        controlNodeIds: [...controlNodeIds].sort(),
        activeBarrierNodeIds: [...activeBarrierNodeIds].sort(),
        capableBarrierNodeIds: [...capableBarrierNodeIds].sort(),
      });
    });

    assessment.linkedRecords.forEach((reference) => {
      if (reference.recordType === "Strategic Objective") {
        const objective = input.strategicObjectives.get(reference.recordId);
        const objectiveNodeId = addRecordNode(reference);
        if (!objective?.isLive) {
          addEdge(
            { type: "CONCERNS", from: assessmentNodeId, to: objectiveNodeId, edgeClass: "Context", basis: "Direct", causal: false },
            { origin: "Assessment link", reason: "Objective is not live, so it confers no strategic consequence", assessmentId, objectiveId: reference.recordId },
          );
          return;
        }
        threatenedObjectiveIds.add(reference.recordId);
        addEdge(
          { type: "THREATENS", from: assessmentNodeId, to: objectiveNodeId, edgeClass: "Structural dependency", basis: "Direct", causal: true },
          { origin: "Assessment link", reason: "Assessment explicitly links this live strategic objective", assessmentId, objectiveId: reference.recordId },
        );
        return;
      }
      if (reference.recordType === "Pillar") {
        const pillar = resolveOperatingPillar(reference.recordId);
        if (!pillar) return;
        addEdge(
          { type: "THREATENS", from: assessmentNodeId, to: addPillarNode(pillar.id, pillar.label), edgeClass: "Structural dependency", basis: "Direct", causal: true },
          { origin: "Assessment link", reason: "Assessment explicitly links this operating pillar", assessmentId },
        );
        return;
      }
      addEdge(
        { type: "CONCERNS", from: assessmentNodeId, to: addRecordNode(reference), edgeClass: "Context", basis: "Direct", causal: false },
        { origin: "Assessment link", reason: "Linked source record with no declared dependency direction", assessmentId },
      );
    });

    if (assessmentAssurance.riskOwnerPersonId) {
      addEdge(
        { type: "OWNED_BY", from: assessmentNodeId, to: addRecordNode({ recordType: "Person", recordId: assessmentAssurance.riskOwnerPersonId }), edgeClass: "Governance", basis: "Direct", causal: false },
        { origin: "Risk owner", reason: "Accountable risk owner", assessmentId },
      );
    }
    assessmentAssurance.obligations.forEach((obligation) => {
      obligation.actionIds.forEach((actionId) => {
        addEdge(
          { type: "REMEDIATED_BY", from: assessmentNodeId, to: addRecordNode({ recordType: "Action", recordId: actionId }), edgeClass: "Governance", basis: "Direct", causal: false },
          {
            origin: "Assurance action link",
            reason: "Action linked to an assurance obligation",
            assessmentId,
            obligationId: obligation.id,
            ...(obligation.failureModeId ? { failureModeId: obligation.failureModeId } : {}),
            ...(obligation.controlId ? { controlId: obligation.controlId } : {}),
          },
        );
      });
    });
  });

  // Objective-level structure, only for objectives an in-scope assessment threatens.
  [...threatenedObjectiveIds].sort().forEach((objectiveId) => {
    const objective = input.strategicObjectives.get(objectiveId);
    if (!objective) return;
    const objectiveNodeId = getIcarusReferenceKey({ recordType: "Strategic Objective", recordId: objectiveId });
    const pillar = resolveOperatingPillar(objective.area);
    if (pillar) {
      addEdge(
        { type: "PART_OF", from: objectiveNodeId, to: addPillarNode(pillar.id, pillar.label), edgeClass: "Derived dependency", basis: "Derived", causal: true },
        { origin: "Objective pillar", reason: "Objective's stored pillar resolves to this operating pillar", objectiveId },
      );
    }
    [...new Set(objective.linkedProjectIds ?? [])].forEach((projectId) => {
      addEdge(
        { type: "SUPPORTS", from: addRecordNode({ recordType: "Project", recordId: projectId }), to: objectiveNodeId, edgeClass: "Structural dependency", basis: "Direct", causal: true },
        { origin: "Objective project link", reason: "Project is linked as delivering this objective", objectiveId },
      );
    });
  });

  const sortedEdges = [...edges.values()]
    .map((edge) => ({ ...edge, provenance: [...edge.provenance].sort(compareProvenance) }))
    .sort(compareIcarusChainEdges);
  const outgoing = new Map<string, IcarusChainEdge[]>();
  const incoming = new Map<string, IcarusChainEdge[]>();
  sortedEdges.forEach((edge) => {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
  });
  const sortedAssessments = assessments.sort((left, right) => left.assessmentId.localeCompare(right.assessmentId));
  const sortedModes = modes.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const sortedControls = controls.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const objectiveImportance = new Map<string, IcarusObjectiveImportance>();
  threatenedObjectiveIds.forEach((objectiveId) => {
    const objective = input.strategicObjectives.get(objectiveId);
    if (objective) objectiveImportance.set(objectiveId, objective.importance);
  });

  return {
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: sortedEdges,
    nodeById: nodes,
    outgoing,
    incoming,
    assessments: sortedAssessments,
    modes: sortedModes,
    controls: sortedControls,
    assessmentById: new Map(sortedAssessments.map((entry) => [entry.assessmentId, entry] as const)),
    modeById: new Map(sortedModes.map((entry) => [entry.nodeId, entry] as const)),
    controlById: new Map(sortedControls.map((entry) => [entry.nodeId, entry] as const)),
    objectiveImportance,
  };
}

// ── Generic propagation ──

export type IcarusPropagationStep = {
  nodeId: string;
  state: IcarusPropagationState;
  depth: number;
  // Edge ids from the start node (deterministic shortest route).
  path: string[];
};

export type IcarusPropagationOptions = {
  // Downgrades every reached node to "Potential propagation" (weak/unknown barrier at the origin).
  potentialOnly?: boolean;
  // Nodes failure may not pass through (e.g. a working barrier's protected targets are reported separately).
  blockedNodeIds?: ReadonlySet<string>;
};

// Breadth-first traversal over causal failure flows from a start node. Each node is visited once (cycle safe),
// keeps its strongest state, and is reached by its first deterministic shortest route. Context (CONCERNS) targets of
// reached nodes are reported as "Unknown dependency" and never traversed further.
export function propagateIcarusFailure(
  graph: Pick<IcarusDependencyGraph, "outgoing" | "incoming">,
  startNodeId: string,
  options: IcarusPropagationOptions = {},
): IcarusPropagationStep[] {
  const reached = new Map<string, IcarusPropagationStep>();
  const visited = new Set<string>([startNodeId]);
  let frontier: { nodeId: string; path: string[]; potential: boolean }[] = [{ nodeId: startNodeId, path: [], potential: Boolean(options.potentialOnly) }];
  let depth = 0;
  const record = (step: IcarusPropagationStep) => {
    const existing = reached.get(step.nodeId);
    if (!existing || getIcarusPropagationStateRank(step.state) < getIcarusPropagationStateRank(existing.state)) {
      reached.set(step.nodeId, step);
    }
  };

  while (frontier.length > 0) {
    depth += 1;
    const next: typeof frontier = [];
    frontier.forEach(({ nodeId, path, potential }) => {
      const flows = [
        ...(graph.outgoing.get(nodeId) ?? []),
        ...(graph.incoming.get(nodeId) ?? []),
      ]
        .filter((edge) => getIcarusFailureFlow(edge)?.[0] === nodeId)
        .sort(compareIcarusChainEdges);
      flows.forEach((edge) => {
        const target = getIcarusFailureFlow(edge)![1];
        if (options.blockedNodeIds?.has(target)) return;
        const viaDerived = potential || edge.basis === "Derived";
        const state: IcarusPropagationState = viaDerived
          ? "Potential propagation"
          : depth === 1 ? "Direct consequence" : "Downstream exposure";
        record({ nodeId: target, state, depth, path: [...path, edge.id] });
        if (visited.has(target)) return;
        visited.add(target);
        next.push({ nodeId: target, path: [...path, edge.id], potential: viaDerived });
      });
      (graph.outgoing.get(nodeId) ?? [])
        .filter((edge) => edge.type === "CONCERNS")
        .forEach((edge) => {
          if (visited.has(edge.to)) return;
          record({ nodeId: edge.to, state: "Unknown dependency", depth, path: [...path, edge.id] });
        });
    });
    frontier = next.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  }

  return [...reached.values()].sort((left, right) =>
    getIcarusPropagationStateRank(left.state) - getIcarusPropagationStateRank(right.state)
    || left.depth - right.depth
    || left.nodeId.localeCompare(right.nodeId));
}
