import { describe, expect, it } from "vitest";
import { buildCorrelationGraph, type CorrelationGraphInput } from "./correlation-graph";
import {
  buildIcarusReview,
  getIcarusIdentityKey,
  getIcarusReferenceKey,
  type IcarusAssessmentRecord,
  type IcarusControl,
  type IcarusEvidence,
  type IcarusFailureMode,
  type IcarusSourceRecord,
} from "./icarus";
import {
  buildIcarusClusterContributions,
  buildIcarusCorrelationSignals,
  getIcarusCorrelationTargets,
} from "./icarus-correlation";
import { buildIcarusStrategicAttention, type IcarusStrategicObjectiveContext } from "./icarus-strategic-attention";
import { attachIcarusAssuranceToSignals, buildIcarusAssurance } from "./icarus-assurance";

const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const timestamp = "2026-10-01T12:00:00.000Z";

function evidence(overrides: Partial<IcarusEvidence> = {}): IcarusEvidence {
  return {
    id: "evidence-1",
    statement: "The weekly close was missed twice.",
    origin: "Direct observation",
    recordedAt: timestamp,
    recordedBy: "Founder",
    review: "Supports",
    reviewedAt: timestamp,
    reviewedBy: "Founder",
    ...overrides,
  };
}

function mode(overrides: Partial<IcarusFailureMode> = {}): IcarusFailureMode {
  return {
    id: "mode-1",
    mechanism: "Required records are not collected before close.",
    vulnerability: "No accountable owner exists.",
    evidence: [evidence()],
    ...overrides,
  };
}

function control(overrides: Partial<IcarusControl> = {}): IcarusControl {
  return {
    id: "control-1",
    failureModeId: "mode-1",
    intervention: "Owned close checklist.",
    lifecycle: "Active",
    effectiveness: "Unknown",
    evidenceIds: [],
    linkedRecords: [],
    nextReviewAt: "2026-12-31",
    ...overrides,
  };
}

function assessment(overrides: Partial<IcarusAssessmentRecord> = {}): IcarusAssessmentRecord {
  return {
    id: "assessment-1",
    outcome: "Project delivery holds margin.",
    status: "Open",
    createdAt: timestamp,
    updatedAt: timestamp,
    linkedRecords: [],
    failureModes: [mode()],
    controls: [],
    ...overrides,
  };
}

function sourcesFor(assessments: readonly IcarusAssessmentRecord[]): IcarusSourceRecord[] {
  const references = assessments.flatMap((entry) => [
    ...entry.linkedRecords,
    ...entry.controls.flatMap((item) => item.linkedRecords),
    ...entry.failureModes.flatMap((item) => item.evidence.flatMap((record) => record.reference ? [record.reference] : [])),
  ]);
  const unique = new Map(references.map((reference) => [getIcarusReferenceKey(reference), reference] as const));
  return [...unique.values()].map((reference) => ({ ...reference, title: reference.recordId }));
}

const liveObjective: IcarusStrategicObjectiveContext = { area: "Operating Business", importance: "High", isLive: true };

function correlate(
  assessments: readonly IcarusAssessmentRecord[],
  options: {
    objectiveContext?: ReadonlyMap<string, IcarusStrategicObjectiveContext>;
    objectiveLinks?: ReadonlyMap<string, Pick<IcarusStrategicObjectiveContext, "linkedProjectIds" | "linkedOpportunityIds" | "linkedDecisionIds">>;
    graph?: Partial<CorrelationGraphInput>;
  } = {},
) {
  // Objective record links travel on the objective context, as the page supplies them.
  const objectiveContext = options.objectiveContext
    ? new Map([...options.objectiveContext].map(([id, context]) => [id, { ...context, ...options.objectiveLinks?.get(id) }] as const))
    : undefined;
  const signals = buildIcarusStrategicAttention({
    assessments,
    reviews: buildIcarusReview(assessments, sourcesFor(assessments), NOW),
    ...(objectiveContext ? { strategicObjectives: objectiveContext } : {}),
  });
  const correlationSignals = buildIcarusCorrelationSignals({ signals });
  const graph = buildCorrelationGraph({ ...operationalGraph(), ...options.graph, strategicRisks: correlationSignals });
  return { signals, correlationSignals, graph, contributions: buildIcarusClusterContributions(graph, correlationSignals) };
}

// A blocked action inside a stale project: two operational categories, short of convergence on its own.
function operationalGraph(): CorrelationGraphInput {
  return {
    founderAuthorityItems: [],
    commandAttentionItems: [{ objectType: "Action", id: "a", title: "Blocked action", area: "Excavation", reasons: ["BLOCKED"], priorityScore: 4 }],
    decisionReviewsDue: [],
    decisionsWithoutExecution: [],
    learningGaps: [],
    staleUnownedWork: [],
    staleRecords: [{ objectType: "Project", id: "p", title: "Stale project", area: "Excavation" }],
    stalledOpportunities: [],
    stalledLeads: [],
    cashBuffer: null,
    fundingGap: null,
    overdueCommitments: [],
    overdueExpectedIncome: [],
    captures: [],
    problems: [{ id: "pr" }],
    actions: [{ id: "a" }],
    decisions: [{ id: "d" }],
    opportunities: [],
    lessons: [],
    systems: [],
    sops: [],
    projects: [{ id: "p", relatedActionIds: ["a"] }],
    leads: [],
  };
}

const projectLink = { recordType: "Project" as const, recordId: "p" };

describe("Icarus correlation targets", () => {
  it("maps only stable identities: people become context identities, pillars and objectives none", () => {
    expect(getIcarusCorrelationTargets({ recordType: "Project", recordId: "p" })).toEqual(["Project:p"]);
    expect(getIcarusCorrelationTargets({ recordType: "Commitment", recordId: "c" })).toEqual(["Finance:commitment:c"]);
    expect(getIcarusCorrelationTargets({ recordType: "Finance", recordId: "cash-position" })).toEqual(["Finance:cash-buffer", "Finance:funding-gap"]);
    expect(getIcarusCorrelationTargets({ recordType: "Pillar", recordId: "Excavation" })).toEqual([]);
    expect(getIcarusCorrelationTargets({ recordType: "Person", recordId: "x" })).toEqual(["Person:x"]);
    expect(getIcarusCorrelationTargets({ recordType: "Strategic Objective", recordId: "o" })).toEqual([]);
  });
});

describe("Icarus correlation signals", () => {
  it("enters the graph as a native material signal and completes convergence through a shared project", () => {
    const { graph, contributions } = correlate([assessment({ linkedRecords: [projectLink] })]);
    const cluster = graph.clusterByRecordKey.get("Icarus:assessment-1")!;
    expect(cluster).toBe(graph.clusterByRecordKey.get("Action:a"));
    expect(graph.signalled.get("Icarus:assessment-1")?.signals).toEqual(new Set(["icarus exposed failure mechanism"]));
    expect(graph.convergentRisks.map((entry) => entry.clusterKey)).toEqual([cluster.clusterKey]);

    const contribution = contributions.get(cluster.clusterKey)!;
    expect(contribution).toMatchObject({ convergent: true, role: "Completes convergence", strongestExposure: "Exposed" });
    expect(contribution.rootRecordKey).toBe(cluster.rootRecordKey);
    expect(contribution.otherContributors.map((record) => record.recordKey)).toEqual(["Action:a", "Project:p"]);
    expect(contribution.assessments[0].sharedRecords).toEqual([
      { recordKey: "Project:p", links: [{ recordKey: "Project:p", via: "Assessment link", kind: "Direct" }] },
    ]);
  });

  it("does not correlate an assessment that shares no stable identity with signalled records", () => {
    const { graph, contributions } = correlate([assessment({ linkedRecords: [{ recordType: "Pillar", recordId: "Excavation" }] })]);
    expect(graph.clusterByRecordKey.get("Icarus:assessment-1")!.records).toHaveLength(1);
    expect(graph.convergentRisks).toEqual([]);
    expect(contributions.size).toBe(0);
  });

  it("adds less weight for an unverified control: it joins the situation but cannot create convergence", () => {
    const { graph, contributions } = correlate([assessment({ linkedRecords: [projectLink], controls: [control()] })]);
    const cluster = graph.clusterByRecordKey.get("Icarus:assessment-1")!;
    expect(graph.signalled.get("Icarus:assessment-1")?.signals).toEqual(new Set(["icarus unverified control"]));
    expect(cluster.records).toHaveLength(3);
    expect(graph.convergentRisks).toEqual([]);
    expect(contributions.get(cluster.clusterKey)).toMatchObject({
      convergent: false,
      role: "Correlated",
      strongestExposure: "Unverified control",
    });
    expect(contributions.get(cluster.clusterKey)!.assessments[0].weight).toBe("corroborating");
  });

  it("strengthens, rather than completes, a situation that is already convergent without Icarus", () => {
    const { graph, contributions } = correlate([assessment({ linkedRecords: [projectLink] })], {
      graph: { learningGaps: [{ id: "pr", title: "Problem", area: "Excavation" }], actions: [{ id: "a", relatedProblem: "pr" }] },
    });
    const cluster = graph.clusterByRecordKey.get("Action:a")!;
    expect(graph.convergentRisks.map((entry) => entry.clusterKey)).toEqual([cluster.clusterKey]);
    expect(contributions.get(cluster.clusterKey)!.role).toBe("Strengthens convergence");
  });

  it("expands live strategic objective links into the objective's project, opportunity and decision identities", () => {
    const objective = { recordType: "Strategic Objective" as const, recordId: "objective-1" };
    const { correlationSignals, graph, contributions } = correlate([assessment({ linkedRecords: [objective] })], {
      objectiveContext: new Map([["objective-1", liveObjective]]),
      objectiveLinks: new Map([["objective-1", { linkedProjectIds: ["p"], linkedOpportunityIds: [], linkedDecisionIds: ["d"] }]]),
    });
    expect(correlationSignals[0].links).toEqual([
      { recordKey: "Decision:d", via: "Strategic objective", kind: "Expanded", objectiveId: "objective-1" },
      { recordKey: "Project:p", via: "Strategic objective", kind: "Expanded", objectiveId: "objective-1" },
    ]);
    const cluster = graph.clusterByRecordKey.get("Icarus:assessment-1")!;
    expect(cluster).toBe(graph.clusterByRecordKey.get("Action:a"));
    expect(contributions.get(cluster.clusterKey)!.assessments[0].sharedRecords.map((record) => record.recordKey))
      .toEqual(["Decision:d", "Project:p"]);
  });

  it("ignores objective expansion when the objective is not supplied as live", () => {
    const objective = { recordType: "Strategic Objective" as const, recordId: "objective-1" };
    const { correlationSignals } = correlate([assessment({ linkedRecords: [objective] })], {
      objectiveContext: new Map([["objective-1", liveObjective]]),
      objectiveLinks: new Map(),
    });
    expect(correlationSignals[0].links).toEqual([]);
  });

  it("retains failure-mode, control and evidence provenance on correlation links", () => {
    const record = assessment({
      failureModes: [mode({
        evidence: [evidence({ origin: "Source record", reference: { recordType: "Problem", recordId: "pr" } })],
      })],
      controls: [
        control({ id: "control-x", lifecycle: "Ineffective", linkedRecords: [{ recordType: "Action", recordId: "a" }] }),
        control({ id: "control-retired", lifecycle: "Retired", linkedRecords: [{ recordType: "Decision", recordId: "d" }] }),
      ],
    });
    const { correlationSignals, graph, contributions } = correlate([record]);
    expect(correlationSignals[0].links).toEqual([
      { recordKey: "Action:a", via: "Control link", kind: "Direct", failureModeId: "mode-1", controlId: "control-x" },
      { recordKey: "Problem:pr", via: "Evidence source", kind: "Direct", failureModeId: "mode-1", evidenceId: "evidence-1" },
    ]);
    expect(correlationSignals[0].reference).toEqual({
      identityKey: getIcarusIdentityKey("assessment-1"),
      assessmentId: "assessment-1",
      failureModeId: "mode-1",
      controlId: "control-x",
      evidenceId: "evidence-1",
    });
    const contribution = contributions.get(graph.clusterByRecordKey.get("Icarus:assessment-1")!.clusterKey)!;
    expect(contribution.assessments[0].reference).toEqual(correlationSignals[0].reference);
    expect(contribution.assessments[0].sharedRecords.map((shared) => shared.recordKey)).toEqual(["Action:a", "Problem:pr"]);
  });

  it("does not inflate risk when the same record is referenced through several Icarus paths", () => {
    const record = assessment({
      linkedRecords: [projectLink, { ...projectLink }],
      failureModes: [mode({ evidence: [evidence({ origin: "Source record", reference: projectLink })] })],
    });
    const single = correlate([assessment({ linkedRecords: [projectLink] })]);
    const repeated = correlate([record]);
    const singleCluster = single.graph.clusterByRecordKey.get("Action:a")!;
    const repeatedCluster = repeated.graph.clusterByRecordKey.get("Action:a")!;
    expect(repeatedCluster.recordCount).toBe(singleCluster.recordCount);
    expect([...repeatedCluster.categories]).toEqual([...singleCluster.categories]);
    expect(repeatedCluster.strategicRiskLinks).toEqual([{ riskRecordKey: "Icarus:assessment-1", sharedRecordKey: "Project:p" }]);
    expect(repeated.correlationSignals[0].links.map((link) => link.via)).toEqual(["Assessment link", "Evidence source"]);
  });

  it("drops out of the combined risk once the exposure is controlled and verified", () => {
    const exposed = correlate([assessment({ linkedRecords: [projectLink] })]);
    expect(exposed.graph.convergentRisks).toHaveLength(1);
    const controlled = correlate([assessment({
      linkedRecords: [projectLink],
      failureModes: [mode({ evidence: [evidence(), evidence({ id: "control-evidence-1" })] })],
      controls: [control({
        effectiveness: "Evidence supports",
        effectivenessReviewedAt: timestamp,
        effectivenessReviewedBy: "Founder",
        evidenceIds: ["control-evidence-1"],
      })],
    })]);
    expect(controlled.correlationSignals).toEqual([]);
    expect(controlled.graph.signalled.has("Icarus:assessment-1")).toBe(false);
    expect(controlled.graph.convergentRisks).toEqual([]);
    expect(controlled.contributions.size).toBe(0);
    expect(controlled.graph.clusterByRecordKey.get("Action:a")!.clusterKey)
      .toBe(exposed.graph.clusterByRecordKey.get("Action:a")!.clusterKey);
  });

  it("drops out when the assessment is closed", () => {
    const { graph, contributions } = correlate([assessment({ status: "Closed", linkedRecords: [projectLink] })]);
    expect(graph.convergentRisks).toEqual([]);
    expect(contributions.size).toBe(0);
  });

  it("orders several contributing assessments by exposure then identity and is deterministic", () => {
    const records = [
      assessment({ id: "b-unverified", linkedRecords: [projectLink], controls: [control()] }),
      assessment({ id: "z-exposed", linkedRecords: [{ recordType: "Action", recordId: "a" }] }),
      assessment({ id: "a-exposed", linkedRecords: [projectLink] }),
    ];
    const first = correlate(records);
    const second = correlate([...records].reverse());
    const contribution = first.contributions.get(first.graph.clusterByRecordKey.get("Action:a")!.clusterKey)!;
    expect(contribution.assessments.map((entry) => entry.assessmentId)).toEqual(["a-exposed", "z-exposed", "b-unverified"]);
    expect([...second.contributions.values()]).toEqual([...first.contributions.values()]);
  });
});

describe("Icarus correlation governance provenance", () => {
  function correlateWithAssurance(assessments: readonly IcarusAssessmentRecord[], contextRecords: CorrelationGraphInput["contextRecords"] = []) {
    const reviews = buildIcarusReview(assessments, sourcesFor(assessments), NOW);
    const base = buildIcarusStrategicAttention({ assessments, reviews });
    const assurance = buildIcarusAssurance({
      assessments, reviews, signals: base, people: [{ id: "founder", status: "Active" }, { id: "other", status: "Active" }],
      actions: [], primaryFounderId: "founder", founderDependencyActive: true, nowMs: NOW,
    });
    const signals = attachIcarusAssuranceToSignals(base, assurance);
    const plain = buildIcarusCorrelationSignals({ signals: base });
    const governed = buildIcarusCorrelationSignals({ signals });
    const graph = buildCorrelationGraph({ ...operationalGraph(), contextRecords, strategicRisks: governed });
    const plainGraph = buildCorrelationGraph({ ...operationalGraph(), contextRecords, strategicRisks: plain });
    return { plain, governed, graph, plainGraph, contributions: buildIcarusClusterContributions(graph, governed) };
  }

  const founderDependency = [{
    recordKey: "Person:founder", objectType: "Person", id: "founder", title: "Founder", area: "People",
    signals: ["founder dependency"],
  }];

  it("carries governance as provenance without changing categories, weight or convergence", () => {
    const { plain, governed, graph, plainGraph, contributions } = correlateWithAssurance([assessment({ linkedRecords: [projectLink] })]);
    expect(governed[0].governance).toEqual({ state: "Weak", escalation: "Governance gap", categories: expect.any(Array) });
    expect(plain[0].governance).toBeUndefined();
    expect({ ...governed[0], governance: undefined }).toEqual({ ...plain[0], governance: undefined });
    expect(graph.convergentRisks.map((risk) => [risk.clusterKey, [...risk.categories].sort()]))
      .toEqual(plainGraph.convergentRisks.map((risk) => [risk.clusterKey, [...risk.categories].sort()]));
    const contribution = [...contributions.values()][0];
    expect(contribution.strongestEscalation).toBe("Governance gap");
    expect(contribution.assessments[0].governance?.escalation).toBe("Governance gap");
  });

  it("reports no escalation when assurance is absent", () => {
    const assessments = [assessment({ linkedRecords: [projectLink] })];
    const signals = buildIcarusStrategicAttention({ assessments, reviews: buildIcarusReview(assessments, sourcesFor(assessments), NOW) });
    const correlationSignals = buildIcarusCorrelationSignals({ signals });
    const graph = buildCorrelationGraph({ ...operationalGraph(), strategicRisks: correlationSignals });
    expect([...buildIcarusClusterContributions(graph, correlationSignals).values()][0].strongestEscalation).toBe("None");
  });

  it("correlates a founder-owned risk with founder dependency through the explicit owner Person id", () => {
    const { graph, governed } = correlateWithAssurance([assessment({ accountableOwnerPersonId: "founder" })], founderDependency);
    expect(governed[0].links).toContainEqual({ recordKey: "Person:founder", via: "Risk owner", kind: "Direct" });
    const cluster = graph.clusterByRecordKey.get("Icarus:assessment-1")!;
    expect(cluster.contextRecords.map((record) => record.recordKey)).toEqual(["Person:founder"]);
  });

  it("does not correlate a risk owned by an unrelated Person", () => {
    const { graph, governed } = correlateWithAssurance([assessment({ accountableOwnerPersonId: "other" })], founderDependency);
    expect(governed[0].links.map((link) => link.recordKey)).toEqual(["Person:other"]);
    expect(graph.clusterByRecordKey.get("Icarus:assessment-1")!.contextRecords).toEqual([]);
  });
});
