// Failure-chain / dependency intelligence: graph semantics, propagation, barriers, single points of failure, shared
// dependencies, blast radius, cut points, pipeline integration, Command / Founder Focus and structural history.
import { describe, expect, it } from "vitest";
import type { IcarusAssessmentRecord, IcarusControl, IcarusEvidence, IcarusRecordReference } from "./icarus";
import {
  buildIcarusStrategicIntelligence,
  type IcarusPipelineObjective,
  type IcarusStrategicIntelligence,
} from "./icarus-intelligence-pipeline";
import {
  getIcarusFailureFlow,
  propagateIcarusFailure,
  type IcarusChainEdge,
} from "./icarus-failure-chain-graph";
import {
  adjustIcarusCommandRankForFailureChain,
  adjustIcarusFounderFocusBandForFailureChain,
  classifyIcarusBlastRadius,
  classifyIcarusChainPriority,
  getIcarusBarrierState,
  isIcarusSharedDependencyCausal,
  type IcarusSignalFailureChain,
} from "./icarus-failure-chain-policy";
import { attachIcarusFailureChainToSignals } from "./icarus-failure-chain-analysis";
import {
  buildIcarusFounderFocusRisks,
  getIcarusCommandPlacement,
  type IcarusStrategicSignal,
} from "./icarus-strategic-attention";
import { buildCommandAttention } from "./command-attention";
import {
  buildIcarusExposureSnapshot,
  compareIcarusExposure,
  normaliseIcarusExposureSnapshot,
} from "./icarus-exposure-history";
import { buildFounderOperatingReview } from "./founder-operating-review";

const NOW = new Date(2025, 3, 10, 12, 0, 0, 0).getTime();
const timestamp = "2025-04-01T12:00:00.000Z";

const ref = (recordType: IcarusRecordReference["recordType"], recordId: string): IcarusRecordReference => ({ recordType, recordId });
const objectiveRef = (id: string) => ref("Strategic Objective", id);
const sop = ref("SOP", "sop-1");

const evidence = (id: string, overrides: Partial<IcarusEvidence> = {}): IcarusEvidence => ({
  id, statement: "Observed.", origin: "Direct observation", recordedAt: timestamp, recordedBy: "Founder",
  review: "Supports", reviewedAt: timestamp, reviewedBy: "Founder", ...overrides,
});

type ControlResult = "Failed" | "Passed" | "Untested";
function control(id: string, failureModeId: string, result: ControlResult, linkedRecords: IcarusRecordReference[] = [], overrides: Partial<IcarusControl> = {}): IcarusControl {
  return {
    id, failureModeId, intervention: `Control ${id}`, lifecycle: "Active",
    effectiveness: result === "Passed" ? "Evidence supports" : "Unknown",
    evidenceIds: result === "Passed" ? ["e1"] : [], linkedRecords, nextReviewAt: "2025-12-31", testCadenceDays: 90,
    assuranceTests: result === "Untested" ? [] : [{ id: `t-${id}`, testedAt: timestamp, testedByPersonId: "founder", result, evidenceIds: ["e1"] }],
    ...overrides,
  };
}

function assessment(id: string, objectives: string[], controls: IcarusControl[], overrides: Partial<IcarusAssessmentRecord> = {}): IcarusAssessmentRecord {
  return {
    id, outcome: `Outcome ${id}`, status: "Open", createdAt: timestamp, updatedAt: timestamp,
    linkedRecords: objectives.map(objectiveRef),
    failureModes: [{ id: "m1", mechanism: `Mechanism ${id}`, vulnerability: "Vulnerability.", evidence: [evidence("e1")] }],
    controls,
    ...overrides,
  };
}

const twoModes = (id: string, objectives: string[], controls: IcarusControl[]) => assessment(id, objectives, controls, {
  failureModes: [
    { id: "m1", mechanism: `Mechanism ${id}-1`, vulnerability: "V.", evidence: [evidence("e1")] },
    { id: "m2", mechanism: `Mechanism ${id}-2`, vulnerability: "V.", evidence: [evidence("e2")] },
  ],
});

const objectives: IcarusPipelineObjective[] = [
  { id: "o1", pillar: "Excavation", importance: "Critical", status: "Active" },
  { id: "o2", pillar: "Garden Maintenance", importance: "High", status: "Active" },
  { id: "o3", pillar: "Hard Landscape Construction", importance: "High", status: "Active" },
  { id: "o4", pillar: "Excavation", importance: "Medium", status: "Active" },
  { id: "closed-objective", pillar: "Excavation", importance: "Critical", status: "Achieved" },
];

type RunOptions = { founderDependencyActive?: boolean; objectives?: IcarusPipelineObjective[] };
function run(assessments: readonly IcarusAssessmentRecord[], options: RunOptions = {}): IcarusStrategicIntelligence {
  return buildIcarusStrategicIntelligence({
    assessments,
    sourceRecords: [],
    strategicObjectives: options.objectives ?? objectives,
    people: [{ id: "founder", status: "Active" }, { id: "person-2", status: "Active" }],
    actions: [],
    primaryFounderId: "founder",
    founderDependencyActive: options.founderDependencyActive ?? false,
    nowMs: NOW,
  });
}

const chains = (result: IcarusStrategicIntelligence) => result.failureChains;
const edge = (result: IcarusStrategicIntelligence, id: string) => chains(result).dependencyGraph.edges.find((entry) => entry.id === id);
const chainFor = (result: IcarusStrategicIntelligence, assessmentId: string) =>
  chains(result).failureChains.find((chain) => chain.assessmentId === assessmentId);
const signalFor = (result: IcarusStrategicIntelligence, assessmentId: string) =>
  result.strategicSignals.find((signal) => signal.assessmentId === assessmentId)!;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
}

// Scenarios -----------------------------------------------------------------------------------------------------
const local = () => [assessment("a1", ["o1"], [control("c1", "m1", "Failed")])];
const sharedFailingSop = () => [
  assessment("a1", ["o1"], [control("c1", "m1", "Failed", [sop])]),
  assessment("a2", ["o2"], [control("c2", "m1", "Failed", [sop])]),
];
const heldBySop = () => [
  assessment("a1", ["o1"], [control("c1", "m1", "Passed", [sop])]),
  assessment("a2", ["o2"], [control("c2", "m1", "Passed", [sop])]),
];
const unverifiedOnSop = (ids: string[]) => ids.map((id, index) =>
  assessment(id, [["o1", "o2", "o3"][index % 3]], [control(`c-${id}`, "m1", "Untested", [sop])]));

describe("Icarus failure chains — graph semantics", () => {
  it("does not turn context references into causal edges", () => {
    const result = run([assessment("a1", ["o1"], [control("c1", "m1", "Failed")], {
      linkedRecords: [objectiveRef("o1"), ref("Project", "p1"), objectiveRef("closed-objective")],
    })]);
    const project = edge(result, "CONCERNS|icarus-assessment:a1|Project:p1");
    expect(project).toMatchObject({ edgeClass: "Context", causal: false });
    expect(getIcarusFailureFlow(project!)).toBeNull();
    // A non-live objective is context, not a threatened outcome.
    expect(edge(result, "CONCERNS|icarus-assessment:a1|Strategic Objective:closed-objective")?.causal).toBe(false);
    expect(edge(result, "THREATENS|icarus-assessment:a1|Strategic Objective:closed-objective")).toBeUndefined();
    // A control's link to an objective is context too; only explicit control dependencies are DEPENDS_ON.
    const withObjectiveLink = run([assessment("a1", ["o1"], [control("c1", "m1", "Failed", [objectiveRef("o2")])])]);
    expect(edge(withObjectiveLink, "DEPENDS_ON|icarus-control:a1:c1|Strategic Objective:o2")).toBeUndefined();
    expect(edge(withObjectiveLink, "CONCERNS|icarus-control:a1:c1|Strategic Objective:o2")?.causal).toBe(false);
    // Unknown dependency is reported, never traversed.
    const chain = chainFor(result, "a1")!;
    expect(chain.propagation.find((step) => step.nodeId === "Project:p1")?.state).toBe("Unknown dependency");
    expect(chain.blast.unknownDependencyNodeIds).toContain("Project:p1");
  });

  it("preserves direct dependencies and labels derived ones", () => {
    const result = run(sharedFailingSop());
    expect(edge(result, "DEPENDS_ON|icarus-control:a1:c1|SOP:sop-1")).toMatchObject({ basis: "Direct", edgeClass: "Structural dependency", causal: true });
    expect(edge(result, "THREATENS|icarus-assessment:a1|Strategic Objective:o1")).toMatchObject({ basis: "Direct", causal: true });
    expect(edge(result, "PART_OF|Strategic Objective:o1|Pillar:excavation")).toMatchObject({ basis: "Derived", edgeClass: "Derived dependency" });
    expect(edge(result, "CONTROLLED_BY|icarus-failure-mode:a1:m1|icarus-control:a1:c1")).toMatchObject({ edgeClass: "Barrier", causal: false });
    // A derived hop downgrades what it reaches to potential propagation.
    const reached = chainFor(result, "a1")!.propagation;
    expect(reached.find((step) => step.nodeId === "Strategic Objective:o1")?.state).toBe("Downstream exposure");
    expect(reached.find((step) => step.nodeId === "Pillar:excavation")?.state).toBe("Potential propagation");
  });

  it("collapses duplicate routes into one edge with deduplicated provenance", () => {
    const result = run([assessment("a1", ["o1", "o1"], [control("c1", "m1", "Failed", [sop, sop])])]);
    const graph = chains(result).dependencyGraph;
    expect(graph.edges.filter((entry) => entry.id === "DEPENDS_ON|icarus-control:a1:c1|SOP:sop-1")).toHaveLength(1);
    expect(edge(result, "DEPENDS_ON|icarus-control:a1:c1|SOP:sop-1")!.provenance).toHaveLength(1);
    expect(graph.edges.filter((entry) => entry.id === "THREATENS|icarus-assessment:a1|Strategic Objective:o1")).toHaveLength(1);
    expect(new Set(graph.edges.map((entry) => entry.id)).size).toBe(graph.edges.length);
  });

  it("orders nodes and edges deterministically", () => {
    const forward = chains(run(sharedFailingSop())).dependencyGraph;
    const reversed = chains(run([...sharedFailingSop()].reverse())).dependencyGraph;
    expect(reversed.edges).toEqual(forward.edges);
    expect(reversed.nodes).toEqual(forward.nodes);
  });
});

describe("Icarus failure chains — propagation", () => {
  const causal = (type: IcarusChainEdge["type"], from: string, to: string, basis: IcarusChainEdge["basis"] = "Direct"): IcarusChainEdge => ({
    id: `${type}|${from}|${to}`, type, from, to, edgeClass: "Structural dependency", basis, causal: true, provenance: [],
  });
  const graphOf = (edges: IcarusChainEdge[]) => {
    const outgoing = new Map<string, IcarusChainEdge[]>();
    const incoming = new Map<string, IcarusChainEdge[]>();
    edges.forEach((entry) => {
      outgoing.set(entry.from, [...(outgoing.get(entry.from) ?? []), entry]);
      incoming.set(entry.to, [...(incoming.get(entry.to) ?? []), entry]);
    });
    return { outgoing, incoming };
  };

  it("propagates one step and multiple steps with explicit states and paths", () => {
    const graph = graphOf([causal("CAN_TRIGGER", "mode", "assessment"), causal("THREATENS", "assessment", "objective")]);
    expect(propagateIcarusFailure(graph, "mode")).toEqual([
      { nodeId: "assessment", state: "Direct consequence", depth: 1, path: ["CAN_TRIGGER|mode|assessment"] },
      { nodeId: "objective", state: "Downstream exposure", depth: 2, path: ["CAN_TRIGGER|mode|assessment", "THREATENS|assessment|objective"] },
    ]);
  });

  it("flows DEPENDS_ON in reverse: a failing dependency reaches the controls that rely on it", () => {
    const graph = graphOf([causal("DEPENDS_ON", "control", "sop")]);
    expect(propagateIcarusFailure(graph, "sop").map((step) => step.nodeId)).toEqual(["control"]);
    expect(propagateIcarusFailure(graph, "control")).toEqual([]);
  });

  it("terminates on loops and visits each node once", () => {
    const graph = graphOf([causal("THREATENS", "a", "b"), causal("THREATENS", "b", "c"), causal("THREATENS", "c", "a")]);
    const steps = propagateIcarusFailure(graph, "a");
    expect(steps.map((step) => step.nodeId).sort()).toEqual(["a", "b", "c"]);
    expect(new Set(steps.map((step) => step.nodeId)).size).toBe(steps.length);
  });

  it("marks everything potential when the origin is only weakly held, and honours blocked nodes", () => {
    const graph = graphOf([causal("CAN_TRIGGER", "mode", "assessment"), causal("THREATENS", "assessment", "objective")]);
    expect(propagateIcarusFailure(graph, "mode", { potentialOnly: true }).map((step) => step.state))
      .toEqual(["Potential propagation", "Potential propagation"]);
    expect(propagateIcarusFailure(graph, "mode", { blockedNodeIds: new Set(["assessment"]) })).toEqual([]);
  });

  it("an assured barrier interrupts the chain; a failed barrier does not", () => {
    const held = run(heldBySop());
    expect(chains(held).failureChains).toEqual([]);
    expect(chains(held).interruptedChains.map((chain) => [chain.key, chain.status, chain.barrier]))
      .toEqual([["icarus-failure-mode:a1:m1", "Interrupted", "Active"], ["icarus-failure-mode:a2:m1", "Interrupted", "Active"]]);
    const failing = run(local());
    expect(chainFor(failing, "a1")).toMatchObject({ status: "Active", barrier: "Failed" });
    expect(chainFor(failing, "a1")!.propagation.find((step) => step.nodeId === "Strategic Objective:o1")?.state).toBe("Downstream exposure");
  });

  it("treats an untested barrier as weak/uncertain: the chain is potential, not interrupted", () => {
    expect(getIcarusBarrierState("Untested")).toBe("Unknown");
    const result = run([assessment("a1", ["o1"], [control("c1", "m1", "Untested")])]);
    const chain = chainFor(result, "a1")!;
    expect(chain).toMatchObject({ status: "Potential", barrier: "Unknown" });
    expect(chain.propagation.every((step) => step.state === "Potential propagation")).toBe(true);
    expect(chain.basis).toContain("potential-only");
  });

  it("accepted exposure does not stop propagation", () => {
    const acceptance = {
      id: "acceptance-1", failureModeIds: ["m1"], acceptedByPersonId: "founder", rationale: "Tolerable for now.",
      acceptedAt: timestamp, reviewBy: "2025-06-01",
    };
    const unaccepted = chainFor(run(local()), "a1")!;
    const accepted = chainFor(run([{ ...local()[0], accountableOwnerPersonId: "founder", acceptances: [acceptance] }]), "a1")!;
    expect(accepted.accepted).toBe(true);
    expect(accepted.status).toBe("Active");
    expect(accepted.propagation).toEqual(unaccepted.propagation);
    expect(accepted.basis).toContain("accepted-exposure");
  });
});

describe("Icarus failure chains — single points of failure", () => {
  it("identifies one dependency carrying several protected outcomes", () => {
    const result = run(heldBySop());
    const spof = chains(result).singlePointsOfFailure.find((entry) => entry.key === "spof:Dependency:SOP:sop-1");
    expect(spof).toMatchObject({ kind: "Dependency", causal: true, assurance: "Strong", dependentAssessmentIds: ["a1", "a2"] });
    expect(spof!.basis).toEqual(expect.arrayContaining(["sole-barrier-dependency", "multiple-assessments", "multiple-pillars"]));
    expect(spof!.provenanceEdgeIds).toEqual(["DEPENDS_ON|icarus-control:a1:c1|SOP:sop-1", "DEPENDS_ON|icarus-control:a2:c2|SOP:sop-1"]);
  });

  it("identifies one control as the only barrier for several objectives", () => {
    const result = run([assessment("a1", ["o1", "o2"], [control("c1", "m1", "Untested")])]);
    const spof = chains(result).singlePointsOfFailure.find((entry) => entry.kind === "Control");
    expect(spof).toMatchObject({ key: "spof:Control:icarus-control:a1:c1", assurance: "Unknown", dependentObjectiveIds: ["o1", "o2"] });
  });

  it("identifies one Person owning several material risks as governance concentration, not causal", () => {
    const owned = (id: string, objective: string) => ({ ...assessment(id, [objective], [control(`c-${id}`, "m1", "Failed")]), accountableOwnerPersonId: "person-2" });
    const result = run([owned("a1", "o1"), owned("a2", "o2")]);
    const spof = chains(result).singlePointsOfFailure.find((entry) => entry.kind === "Ownership concentration");
    expect(spof).toMatchObject({ nodeId: "Person:person-2", causal: false, founderDependency: false, dependentMaterialAssessmentIds: ["a1", "a2"] });
    // Not a causal reason for Command / Focus.
    expect(result.strategicSignals.every((signal) => !signal.failureChain?.commandReason?.includes("FOUNDER"))).toBe(true);
    const shared = chains(result).sharedDependencies.find((entry) => entry.nodeId === "Person:person-2");
    expect(shared).toMatchObject({ kind: "Common owner", causal: false });
    expect(isIcarusSharedDependencyCausal("Common owner")).toBe(false);
  });

  it("flags founder dependency as a systemic single point of failure only when founder dependency is active", () => {
    const owned = (id: string, objective: string) => ({ ...assessment(id, [objective], [control(`c-${id}`, "m1", "Failed")]), accountableOwnerPersonId: "founder" });
    const inactive = run([owned("a1", "o1"), owned("a2", "o2")]);
    expect(chains(inactive).founderSynthesis.founderSpofKeys).toEqual([]);
    const active = run([owned("a1", "o1"), owned("a2", "o2")], { founderDependencyActive: true });
    expect(chains(active).founderSynthesis.founderSpofKeys).toEqual(["spof:Ownership concentration:Person:founder"]);
    const carriers = active.strategicSignals.filter((signal) => signal.failureChain?.commandReason?.startsWith("FAILURE CHAIN: FOUNDER DEPENDENCY"));
    expect(carriers).toHaveLength(1);
    expect(carriers[0].failureChain!.priority).toBe("Critical");
  });

  it("duplicate references within one assessment never create a false single point of failure", () => {
    const result = run([twoModes("a1", ["o1"], [control("c1", "m1", "Passed", [sop, sop]), control("c2", "m2", "Passed", [sop])])]);
    expect(chains(result).singlePointsOfFailure.filter((entry) => entry.kind === "Dependency")).toEqual([]);
  });

  it("unrelated shared context does not count", () => {
    const result = run([
      assessment("a1", ["o1"], [control("c1", "m1", "Failed")], { linkedRecords: [objectiveRef("o1"), ref("Project", "p1")] }),
      assessment("a2", ["o2"], [control("c2", "m1", "Failed")], { linkedRecords: [objectiveRef("o2"), ref("Project", "p1")] }),
    ]);
    expect(chains(result).singlePointsOfFailure).toEqual([]);
    expect(chains(result).sharedDependencies.filter((entry) => entry.causal)).toEqual([]);
    expect(chains(result).sharedDependencies.some((entry) => entry.nodeId === "Project:p1")).toBe(false);
  });
});

describe("Icarus failure chains — common dependencies", () => {
  it("recognises two independent-looking risks sharing one control mechanism as a common cause", () => {
    const result = run(sharedFailingSop());
    const shared = chains(result).sharedDependencies.find((entry) => entry.nodeId === "SOP:sop-1");
    expect(shared).toMatchObject({ key: "shared:Common control mechanism:SOP:sop-1", kind: "Common control mechanism", causal: true, materialAssessmentIds: ["a1", "a2"] });
    expect(shared!.controlNodeIds).toEqual(["icarus-control:a1:c1", "icarus-control:a2:c2"]);
    expect(chains(result).founderSynthesis.connectedOutcomeKeys).toContain(shared!.key);
    // Already-failed barriers lose nothing more if the SOP breaks, so this is common cause, not a SPOF.
    expect(chains(result).singlePointsOfFailure).toEqual([]);
    for (const id of ["a1", "a2"]) {
      expect(chainFor(result, id)!.basis).toContain("common-cause");
      expect(signalFor(result, id).failureChain!.sharedDependencyKeys).toEqual([shared!.key]);
    }
  });

  it("states a shared common cause once, on exactly one member signal", () => {
    const result = run(sharedFailingSop());
    const carriers = result.strategicSignals.filter((signal) => signal.failureChain?.commandReason);
    expect(carriers.map((signal) => signal.assessmentId)).toEqual(["a1"]);
    expect(carriers[0].failureChain!.commandReason).toBe("FAILURE CHAIN: 2 MATERIAL RISKS SHARE ONE SOP DEPENDENCY");
  });
});

describe("Icarus failure chains — blast radius", () => {
  it("classifies local, cross-objective, cross-pillar and empire-wide reach", () => {
    expect(chainFor(run(local()), "a1")!.blast.radius).toBe("Local");
    expect(chainFor(run([assessment("a1", ["o1", "o4"], [control("c1", "m1", "Failed")])]), "a1")!.blast).toMatchObject({
      radius: "Cross-objective", objectiveIds: ["o1", "o4"], pillarIds: ["excavation"],
    });
    expect(chainFor(run([assessment("a1", ["o1", "o2"], [control("c1", "m1", "Failed")])]), "a1")!.blast).toMatchObject({
      radius: "Cross-pillar", pillarIds: ["garden-maintenance", "excavation"],
    });
    expect(chainFor(run([assessment("a1", ["o1", "o2", "o3"], [control("c1", "m1", "Failed")])]), "a1")!.blast.radius).toBe("Empire-wide");
    expect(classifyIcarusBlastRadius({ assessmentCount: 1, objectiveCount: 0, pillarCount: 0, operatingPillarTotal: 3 })).toBe("Local");
    expect(classifyIcarusBlastRadius({ assessmentCount: 2, objectiveCount: 1, pillarCount: 1, operatingPillarTotal: 3 })).toBe("Cross-assessment");
  });

  it("does not double-count duplicate paths", () => {
    const duplicated = run([assessment("a1", ["o1", "o1"], [control("c1", "m1", "Failed")], {
      linkedRecords: [objectiveRef("o1"), objectiveRef("o1"), ref("Pillar", "Excavation"), ref("Pillar", "excavation")],
    })]);
    expect(chainFor(duplicated, "a1")!.blast).toMatchObject({ radius: "Local", objectiveIds: ["o1"], pillarIds: ["excavation"] });
  });

  it("removes resolved and closed risks from every failure-chain output", () => {
    const open = run(sharedFailingSop());
    expect(chains(open).failureChains).toHaveLength(2);
    const closed = run(sharedFailingSop().map((entry) => ({ ...entry, status: "Closed" as const })));
    expect(chains(closed).failureChains).toEqual([]);
    expect(chains(closed).sharedDependencies).toEqual([]);
    expect(chains(closed).dependencyGraph.nodes).toEqual([]);
    expect(chains(closed).signalAnnotations.size).toBe(0);
    // Closing one member dissolves the common cause.
    const oneClosed = run([sharedFailingSop()[0], { ...sharedFailingSop()[1], status: "Closed" }]);
    expect(chains(oneClosed).sharedDependencies).toEqual([]);
    expect(signalFor(oneClosed, "a1").failureChain!.commandReason).toBeUndefined();
  });
});

describe("Icarus failure chains — cut points and restoration", () => {
  it("marks a dependency whose failure removes several assured barriers as a critical cut point", () => {
    const result = run(heldBySop());
    const cut = chains(result).criticalCutPoints.find((entry) => entry.nodeId === "SOP:sop-1");
    expect(cut).toMatchObject({ key: "cut:Dependency:SOP:sop-1", newlyExposedModeNodeIds: ["icarus-failure-mode:a1:m1", "icarus-failure-mode:a2:m1"] });
    expect(chains(result).founderSynthesis.mostDamagingCutPointKey).toBe(cut!.key);
  });

  it("does not mark an irrelevant node critical", () => {
    const result = run([assessment("a1", ["o1"], [control("c1", "m1", "Passed", [sop])])]);
    expect(chains(result).criticalCutPoints).toEqual([]);
    expect(chains(run(local())).criticalCutPoints).toEqual([]);
  });

  it("ranks the restoration of a weak barrier that would interrupt the highest-priority chain first", () => {
    const result = run([
      assessment("a1", ["o4"], [control("c1", "m1", "Failed")]),
      assessment("a2", ["o1", "o2"], [control("c2", "m1", "Failed")]),
    ]);
    const restorations = chains(result).barrierWeaknesses;
    expect(restorations.map((entry) => entry.key)).toEqual(["restore:icarus-control:a2:c2", "restore:icarus-control:a1:c1"]);
    expect(restorations[0].interrupts.radius).toBe("Cross-pillar");
    expect(chains(result).founderSynthesis.bestRestorationKey).toBe("restore:icarus-control:a2:c2");
  });

  it("identifies two-point fragility and whether the two barriers share a dependency", () => {
    const fragile = run([assessment("a1", ["o1"], [control("c1", "m1", "Passed", [sop]), control("c2", "m1", "Passed", [sop])])]);
    expect(chains(fragile).twoPointFragilities).toMatchObject([{
      modeNodeId: "icarus-failure-mode:a1:m1", independence: "Shared dependency", sharedDependencyNodeIds: ["SOP:sop-1"],
    }]);
    const unknown = run([assessment("a1", ["o1"], [control("c1", "m1", "Passed"), control("c2", "m1", "Passed")])]);
    expect(chains(unknown).twoPointFragilities).toMatchObject([{ independence: "Unknown", sharedDependencyNodeIds: [] }]);
  });
});

describe("Icarus failure chains — pillar exposure and priority", () => {
  it("rolls chains up to canonical operating pillars", () => {
    const result = run([assessment("a1", ["o1", "o2"], [control("c1", "m1", "Failed")])]);
    const byPillar = new Map(chains(result).pillarChainExposure.map((entry) => [entry.pillarId, entry.state] as const));
    expect(byPillar.get("excavation")).toBe("Cross-pillar");
    expect(byPillar.get("garden-maintenance")).toBe("Cross-pillar");
    expect(byPillar.get("hard-landscape-construction")).toBe("No chain exposure");
    const held = run(heldBySop());
    expect(chains(held).pillarChainExposure.every((entry) => entry.state === "No chain exposure" || entry.state === "Single-point dependent")).toBe(true);
  });

  it("classifies priority categorically from basis codes", () => {
    expect(classifyIcarusChainPriority(new Set(["material-origin", "cross-pillar", "failed-barrier"]))).toBe("Critical");
    expect(classifyIcarusChainPriority(new Set(["material-origin", "cross-pillar"]))).toBe("High");
    expect(classifyIcarusChainPriority(new Set(["material-origin", "critical-objective"]))).toBe("Elevated");
    expect(classifyIcarusChainPriority(new Set(["potential-only"]))).toBe("Contained");
    expect(classifyIcarusChainPriority(new Set(["material-origin", "founder-spof"]))).toBe("High");
    expect(classifyIcarusChainPriority(new Set(["material-origin", "founder-spof", "common-cause"]))).toBe("Critical");
    expect(chainFor(run(local()), "a1")!.priority).toBe("Elevated");
  });
});

describe("Icarus failure chains — pipeline", () => {
  it("derives from the same strategic signals and assurance state the pipeline publishes", () => {
    const result = run(sharedFailingSop());
    const graph = chains(result).dependencyGraph;
    result.strategicSignals.forEach((signal) => {
      expect(graph.assessmentById.get(signal.assessmentId)).toMatchObject({ signalKey: signal.key, exposure: signal.exposure });
    });
    graph.controls.forEach((entry) => {
      const assured = result.assurance.byAssessmentId.get(entry.assessmentId)!.controls.find((item) => item.controlId === entry.controlId)!;
      expect(entry.status).toBe(assured.status);
    });
    // Annotation is attached before every downstream consumer reads signals.
    expect(result.founderFocusRisks).toEqual(buildIcarusFounderFocusRisks(result.strategicSignals));
    expect(result.exposureSnapshot).toEqual(buildIcarusExposureSnapshot(result.strategicSignals));
    expect(result.exposureSnapshot.every((entry) => entry.failureChain !== undefined)).toBe(true);
  });

  it("never changes exposure, materiality or assurance", () => {
    const result = run(sharedFailingSop());
    const stripped = result.strategicSignals.map((signal) => { const copy = { ...signal }; delete copy.failureChain; return copy; });
    const reattached = attachIcarusFailureChainToSignals(stripped, chains(result));
    expect(reattached).toEqual(result.strategicSignals);
    expect(attachIcarusFailureChainToSignals(stripped, { signalAnnotations: new Map() })).toEqual(stripped);
  });

  it("is deterministic regardless of input ordering", () => {
    const input = [...sharedFailingSop(), assessment("a3", ["o1", "o3"], [control("c3", "m1", "Untested", [sop])])];
    const forward = run(input);
    const reversed = run([...input].reverse());
    expect(reversed.failureChains).toEqual(forward.failureChains);
    expect(reversed.strategicSignals).toEqual(forward.strategicSignals);
  });

  it("does not mutate inputs", () => {
    const input = deepFreeze([...sharedFailingSop(), ...heldBySop().map((entry) => ({ ...entry, id: `${entry.id}-held` }))]);
    expect(() => run(input)).not.toThrow();
  });

  it("returns safe empty outputs without Icarus data", () => {
    const empty = chains(run([]));
    expect(empty.failureChains).toEqual([]);
    expect(empty.interruptedChains).toEqual([]);
    expect(empty.singlePointsOfFailure).toEqual([]);
    expect(empty.sharedDependencies).toEqual([]);
    expect(empty.criticalCutPoints).toEqual([]);
    expect(empty.twoPointFragilities).toEqual([]);
    expect(empty.barrierWeaknesses).toEqual([]);
    expect(empty.pillarChainExposure.every((entry) => entry.state === "No chain exposure")).toBe(true);
    expect(empty.founderSynthesis).toEqual({ connectedOutcomeKeys: [], founderSpofKeys: [] });
  });

  it("reads legacy records without controls, owners, cadence or tests", () => {
    const legacy: IcarusAssessmentRecord = {
      id: "legacy", outcome: "Legacy outcome", status: "Monitoring", createdAt: timestamp, updatedAt: timestamp,
      linkedRecords: [ref("Pillar", "Excavation")],
      failureModes: [{ id: "m1", mechanism: "Old", vulnerability: "Old", evidence: [evidence("e1")] }],
      controls: [{ id: "c1", failureModeId: "m1", intervention: "Old control", lifecycle: "Active", effectiveness: "Unknown", evidenceIds: [], linkedRecords: [] }],
    };
    const result = run([legacy]);
    const chain = chainFor(result, "legacy");
    expect(chain).toBeDefined();
    expect(chain!.propagation.find((step) => step.nodeId === "Pillar:excavation")).toBeDefined();
  });
});

describe("Icarus failure chains — Command and Founder Focus", () => {
  const critical: IcarusSignalFailureChain = {
    priority: "Critical", blastRadius: "Cross-pillar", basis: ["material-origin", "cross-pillar", "failed-barrier"],
    spofKeys: [], sharedDependencyKeys: [], weakBarrierControlIds: [],
    commandReason: "FAILURE CHAIN: TEST", focusReason: "Failure chain: test.",
  };

  it("lifts a Critical systemic chain by one step, bounded, and never on top of an assurance lift", () => {
    expect(adjustIcarusCommandRankForFailureChain(5, 5, critical)).toBe(4);
    expect(adjustIcarusCommandRankForFailureChain(3, 3, critical)).toBe(3);
    expect(adjustIcarusCommandRankForFailureChain(4, 5, critical)).toBe(4);
    expect(adjustIcarusCommandRankForFailureChain(5, 5, { ...critical, priority: "High" })).toBe(5);
    expect(adjustIcarusCommandRankForFailureChain(5, 5, { ...critical, commandReason: undefined })).toBe(5);
    expect(adjustIcarusFounderFocusBandForFailureChain(5, 5, critical)).toBe(4);
    expect(adjustIcarusFounderFocusBandForFailureChain(4, 5, critical)).toBe(4);
  });

  it("can strengthen a signal's Command placement and states the reason", () => {
    const base = signalFor(run(local()), "a1");
    const unassured: IcarusStrategicSignal = { ...base };
    delete unassured.assurance;
    delete unassured.failureChain;
    const plain = getIcarusCommandPlacement(unassured);
    const lifted = getIcarusCommandPlacement({ ...unassured, failureChain: critical });
    expect(lifted.attentionRank).toBe(Math.max(3, plain.attentionRank - 1));
    expect(lifted.reasons).toContain("FAILURE CHAIN: TEST");
    const [focus] = buildIcarusFounderFocusRisks([{ ...unassured, failureChain: critical }]);
    expect(focus.reason).toContain("Failure chain: test.");
  });

  it("never creates a separate Command item for a chain and states a systemic issue once", () => {
    const result = run(sharedFailingSop());
    const command = buildCommandAttention({
      problems: [], actions: [], outreach: [], projects: [], decisions: [], opportunities: [], lessons: [], systems: [],
      sops: [], handoffs: [], procurementQueue: [], nowMs: NOW, icarus: result.strategicSignals,
    });
    const icarusItems = command.items.filter((item) => item.objectType === "Icarus");
    expect(icarusItems).toHaveLength(result.strategicSignals.length);
    expect(icarusItems.filter((item) => item.reasons.some((reason) => reason.startsWith("FAILURE CHAIN")))).toHaveLength(1);
    expect(result.founderFocusRisks.filter((risk) => risk.reason.includes("Failure chain:"))).toHaveLength(1);
  });

  it("does not flood attention with ordinary local chains", () => {
    const result = run(local());
    const signal = signalFor(result, "a1");
    expect(signal.failureChain).toMatchObject({ priority: "Elevated", blastRadius: "Local" });
    expect(signal.failureChain!.commandReason).toBeUndefined();
    const stripped = { ...signal };
    delete stripped.failureChain;
    expect(getIcarusCommandPlacement(signal)).toEqual(getIcarusCommandPlacement(stripped));
    expect(buildIcarusFounderFocusRisks([signal])).toEqual(buildIcarusFounderFocusRisks([stripped]));
  });
});

describe("Icarus failure chains — structural history", () => {
  const snapshot = (assessments: IcarusAssessmentRecord[]) => run(assessments).exposureSnapshot;
  const compare = (previous: IcarusAssessmentRecord[], current: IcarusAssessmentRecord[]) =>
    compareIcarusExposure({ previous: snapshot(previous), current: snapshot(current) });

  it("records structure per risk and normalises legacy or malformed structure safely", () => {
    const [entry] = snapshot(local());
    expect(entry.failureChain).toEqual({ priority: "Elevated", blastRadius: "Local", spofKeys: [], sharedDependencyKeys: [], weakBarrierControlIds: ["c1"] });
    expect(normaliseIcarusExposureSnapshot(JSON.parse(JSON.stringify([entry])))).toEqual([entry]);
    const { failureChain: _omit, ...legacy } = entry;
    void _omit;
    expect(normaliseIcarusExposureSnapshot([legacy])).toEqual([legacy]);
    expect(normaliseIcarusExposureSnapshot([{ ...entry, failureChain: { priority: "Severe", blastRadius: "Local" } }])).toEqual([legacy]);
    expect(compareIcarusExposure({ previous: [legacy], current: [entry] })).toMatchObject({ hasStructuralBaseline: false, structuralChanges: [] });
  });

  it("detects a chain becoming cross-pillar and narrowing again", () => {
    const wide = [assessment("a1", ["o1", "o2"], [control("c1", "m1", "Failed")])];
    const worse = compare(local(), wide);
    expect(worse.hasStructuralBaseline).toBe(true);
    expect(worse.structuralChanges).toMatchObject([{ key: "icarus-assessment:a1", change: "Became cross-pillar", previousBlastRadius: "Local", blastRadius: "Cross-pillar" }]);
    expect(compare(wide, local()).structuralChanges.map((change) => change.change)).toEqual(["Blast radius decreased"]);
    expect(compare(local(), [assessment("a1", ["o1", "o4"], [control("c1", "m1", "Failed")])]).structuralChanges.map((change) => change.change))
      .toEqual(["Blast radius increased"]);
  });

  it("detects a single point of failure appearing and being removed, once per structure", () => {
    const appeared = compare(unverifiedOnSop(["a1"]), unverifiedOnSop(["a1", "a2", "a3"]));
    const spofChanges = appeared.structuralChanges.filter((change) => change.change === "Single point of failure appeared");
    expect(spofChanges.map((change) => change.key)).toEqual(["spof:Dependency:SOP:sop-1"]);
    expect(spofChanges[0].assessmentIds).toEqual(["a1", "a2", "a3"]);
    const removed = compare(unverifiedOnSop(["a1", "a2", "a3"]), unverifiedOnSop(["a1"]));
    expect(removed.structuralChanges.filter((change) => change.change === "Single point of failure removed").map((change) => change.key))
      .toEqual(["spof:Dependency:SOP:sop-1"]);
  });

  it("detects shared concentration increasing and a barrier being restored", () => {
    const three = [...sharedFailingSop(), assessment("a3", ["o3"], [control("c3", "m1", "Failed", [sop])])];
    const concentration = compare(sharedFailingSop(), three).structuralChanges.find((change) => change.change === "Shared concentration increased");
    expect(concentration).toMatchObject({ key: "shared:Common control mechanism:SOP:sop-1", previousCount: 2, count: 3 });

    const before = [twoModes("a1", ["o1"], [control("c1", "m1", "Failed"), control("c2", "m2", "Failed")])];
    const after = [twoModes("a1", ["o1"], [control("c1", "m1", "Passed"), control("c2", "m2", "Failed")])];
    expect(compare(before, after).structuralChanges).toMatchObject([{ key: "icarus-assessment:a1", change: "Barrier restored", controlIds: ["c1"] }]);
  });

  it("feeds structural deterioration and improvement into the Founder Operating Review", () => {
    const review = (previous: IcarusAssessmentRecord[], current: IcarusAssessmentRecord[]) => buildFounderOperatingReview({
      todaySnapshotDate: "2025-04-10",
      snapshots: [{
        date: "2025-04-03", ownershipGapCount: 0, decisionReviewsDue: 0, executionGapCount: 0, learningGapCount: 0,
        staleRecordCount: 0, financeAttentionCount: 0, growthStallCount: 0, availableOperatingCash: null,
        icarusExposure: snapshot(previous),
      }],
      todayBrief: {
        ownershipGapCount: 0, reviewDueCount: 0, executionGapCount: 0, learningGapCount: 0, staleCount: 0,
        financeCount: 0, growthStallCount: 0, outstandingKeys: [],
      },
      selfSufficiencyPct: null, delegationQualityPct: null, cashIsConfigured: false, availableOperatingCash: null,
      topOwnerShare: null, delegateItemCount: 0, unresolvedRecurring: [], convergentRisks: [], focusCandidates: [],
      unassignedCarriedCount: 0, founderReviewQueue: [], watch: [],
      icarusExposure: { current: snapshot(current), assessmentStatuses: new Map() },
    });
    const wide = [assessment("a1", ["o1", "o2"], [control("c1", "m1", "Failed")])];
    const worse = review(local(), wide);
    expect(worse.deteriorated.some((item) => item.metric === "Failure-chain blast radius" && item.explanation.includes("Outcome a1"))).toBe(true);
    const better = review(wide, local());
    expect(better.improved.some((item) => item.metric === "Failure-chain blast radius" && item.changeText === "1 narrower")).toBe(true);
  });
});
