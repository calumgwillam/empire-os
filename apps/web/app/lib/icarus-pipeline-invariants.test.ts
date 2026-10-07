// Architectural invariants for the whole Icarus intelligence pipeline. These exercise the real domain modules
// end-to-end (signals -> correlation -> graph -> shared resolution -> Command / Founder Focus / pillar exposure /
// trajectory) so the contracts between adapters cannot drift independently.
import { describe, expect, it } from "vitest";
import {
  buildIcarusReview,
  getIcarusIdentityKey,
  getIcarusReferenceKey,
  type IcarusAssessmentRecord,
  type IcarusEvidence,
  type IcarusRecordReference,
  type IcarusSourceRecord,
} from "./icarus";
import {
  buildIcarusFounderFocusRisks,
  buildIcarusStrategicAttention,
  type IcarusStrategicObjectiveContext,
} from "./icarus-strategic-attention";
import { buildIcarusClusterContributions, buildIcarusCorrelationSignals } from "./icarus-correlation";
import { buildIcarusSystemicExposure } from "./icarus-systemic-exposure";
import { buildIcarusExposureSnapshot, compareIcarusExposure } from "./icarus-exposure-history";
import { buildCorrelationGraph, type CorrelationContextRecordInput, type CorrelationGraphInput } from "./correlation-graph";
import { buildCommandAttention, resolveCommandStrategicRiskConvergence, type CommandAttentionInput } from "./command-attention";
import { buildFounderFocus } from "./founder-focus";
import { resolveStrategicRiskConvergence } from "./strategic-risk-resolution";
import { buildPeopleCorrelationContext } from "./people-correlation-context";
import { resolveOperatingPillar } from "./pillar-identity";
import { attachIcarusAssuranceToSignals, buildIcarusAssurance } from "./icarus-assurance";

const NOW = new Date(2025, 3, 10, 12, 0, 0, 0).getTime();
const timestamp = "2025-04-01T12:00:00.000Z";
const createdAt = new Date(NOW - 30 * 86400000).toISOString();

type Action = CommandAttentionInput["actions"][number];

const action = (overrides: Partial<Action> = {}): Action => ({
  id: "action-1",
  status: "Blocked",
  priority: "Low",
  dueDate: "",
  followUpDate: "",
  followUpNote: "",
  createdDate: createdAt,
  createdAt,
  actionTitle: "Blocked action",
  title: "Blocked action",
  relatedPillar: "Excavation",
  relatedArea: "",
  relatedProblem: "",
  relatedDecision: "",
  ...overrides,
});

function evidence(id: string, reference?: IcarusRecordReference, overrides: Partial<IcarusEvidence> = {}): IcarusEvidence {
  return {
    id,
    statement: "Observed.",
    origin: "Direct observation",
    recordedAt: timestamp,
    recordedBy: "Founder",
    review: "Supports",
    reviewedAt: timestamp,
    reviewedBy: "Founder",
    ...(reference ? { reference } : {}),
    ...overrides,
  };
}

const actionRef: IcarusRecordReference = { recordType: "Action", recordId: "action-1" };
const founderRef: IcarusRecordReference = { recordType: "Person", recordId: "founder" };
const pillarRef = (value: string): IcarusRecordReference => ({ recordType: "Pillar", recordId: value });

// Evidence (not assessment) links: correlation context only, so Phase 1 anchoring does not absorb the risk and the
// convergence path is what decides whether Command/Focus show it standalone.
function assessment(id: string, overrides: Partial<IcarusAssessmentRecord> = {}): IcarusAssessmentRecord {
  return {
    id,
    outcome: `Outcome ${id}`,
    status: "Open",
    createdAt: timestamp,
    updatedAt: timestamp,
    linkedRecords: [pillarRef("Excavation")],
    failureModes: [{
      id: "mode-1",
      mechanism: "Mechanism.",
      vulnerability: "Vulnerability.",
      evidence: [evidence("evidence-1", actionRef), evidence("evidence-2", founderRef)],
    }],
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

const founderDependency = (): CorrelationContextRecordInput[] => buildPeopleCorrelationContext({
  people: [{ id: "founder", name: "Founder", status: "Active" }],
  primaryFounderId: "founder",
  founderDependentWork: [{ objectType: "Action", id: "elsewhere" }],
  capabilityGaps: [],
});

type PipelineOptions = {
  objectives?: ReadonlyMap<string, IcarusStrategicObjectiveContext>;
  contextRecords?: readonly CorrelationContextRecordInput[];
  actions?: Action[];
  includeIcarus?: boolean;
};

function emptyGraphInput(): CorrelationGraphInput {
  return {
    founderAuthorityItems: [], commandAttentionItems: [], decisionReviewsDue: [], decisionsWithoutExecution: [],
    learningGaps: [], staleUnownedWork: [], staleRecords: [], stalledOpportunities: [], stalledLeads: [],
    cashBuffer: null, fundingGap: null, overdueCommitments: [], overdueExpectedIncome: [], captures: [], problems: [],
    actions: [], decisions: [], opportunities: [], lessons: [], systems: [], sops: [], projects: [], leads: [],
  };
}

function runPipeline(assessments: readonly IcarusAssessmentRecord[], options: PipelineOptions = {}) {
  const includeIcarus = options.includeIcarus ?? true;
  const signals = buildIcarusStrategicAttention({
    assessments,
    reviews: buildIcarusReview(assessments, sourcesFor(assessments), NOW),
    ...(options.objectives ? { strategicObjectives: options.objectives } : {}),
  });
  const actions = options.actions ?? [action()];
  const commandInput: CommandAttentionInput = {
    problems: [], actions, outreach: [], projects: [], decisions: [], opportunities: [], lessons: [], systems: [],
    sops: [], handoffs: [], procurementQueue: [], nowMs: NOW,
    ...(includeIcarus ? { icarus: signals } : {}),
  };
  const command = buildCommandAttention(commandInput);
  const correlationSignals = buildIcarusCorrelationSignals({ signals });
  const graph = buildCorrelationGraph({
    ...emptyGraphInput(),
    actions: actions.map((entry) => ({ id: entry.id })),
    commandAttentionItems: command.items.map((entry) => ({ ...entry, priorityScore: entry.operationalPriorityScore ?? entry.priorityScore })),
    ...(includeIcarus ? { strategicRisks: correlationSignals } : {}),
    contextRecords: options.contextRecords ?? founderDependency(),
  });
  const convergence = resolveStrategicRiskConvergence(graph.convergentRisks, correlationSignals.map((signal) => signal.recordKey));
  const commandItems = resolveCommandStrategicRiskConvergence(command.items, convergence);
  const focus = buildFounderFocus({
    signalledRecords: [...graph.signalled.values()].map((record) => ({ ...record, signals: [...record.signals] })),
    founderReviewItems: [],
    limitations: [],
    convergentRisks: graph.convergentRisks.map((cluster) => ({
      clusterKey: cluster.clusterKey,
      rootRecordKey: cluster.rootRecordKey,
      title: cluster.title,
      records: cluster.records,
      categories: [...cluster.categories].sort(),
      recordCount: cluster.recordCount,
    })),
    recordFacts: new Map(),
    ...(includeIcarus ? { strategicRisks: buildIcarusFounderFocusRisks(signals) } : {}),
  });
  const contributions = buildIcarusClusterContributions(graph, correlationSignals);
  const exposure = buildIcarusSystemicExposure({
    signals,
    clusters: [...contributions.values()].map((contribution) => ({
      clusterKey: contribution.clusterKey,
      convergent: contribution.convergent,
      assessmentIds: contribution.assessments.map((entry) => entry.assessmentId),
    })),
  });
  const snapshot = buildIcarusExposureSnapshot(signals);
  return { signals, command, commandItems, correlationSignals, graph, convergence, focus, contributions, exposure, snapshot };
}

const keysOf = (items: readonly { objectType: string; id: string }[]) => items.map((entry) => `${entry.objectType}:${entry.id}`);
const focusKeys = (result: ReturnType<typeof runPipeline>) => result.focus.map((entry) => entry.key);

describe("Icarus pipeline invariants", () => {
  it("gives one assessment one strategic-risk identity across every system", () => {
    const result = runPipeline([assessment("a1")], { contextRecords: [] });
    const recordKey = "Icarus:a1";
    const referenceKey = getIcarusIdentityKey("a1");
    expect(result.signals.map((signal) => signal.key)).toEqual([referenceKey]);
    expect(result.signals[0].primaryReference.identityKey).toBe(referenceKey);
    expect(result.correlationSignals.map((signal) => signal.recordKey)).toEqual([recordKey]);
    expect(keysOf(result.commandItems)).toContain(recordKey);
    expect(buildIcarusFounderFocusRisks(result.signals).map((risk) => [risk.key, risk.referenceKey])).toEqual([[recordKey, referenceKey]]);
    expect(result.snapshot.map((entry) => [entry.key, entry.assessmentId])).toEqual([[referenceKey, "a1"]]);
    expect(focusKeys(result)).toContain(recordKey);
  });

  it("resolves the same canonical pillar everywhere, including legacy stored forms", () => {
    const canonical = runPipeline([assessment("a1")]);
    const legacy = runPipeline([assessment("a1", { linkedRecords: [pillarRef("  EXCAVATION ")] })]);
    for (const result of [canonical, legacy]) {
      expect(result.signals[0].operatingPillars).toEqual([resolveOperatingPillar("Excavation")]);
      expect(result.signals[0].area).toBe("Excavation");
      expect(result.correlationSignals[0].area).toBe("Excavation");
      expect(result.exposure.pillars.filter((pillar) => pillar.assessmentCount > 0).map((pillar) => pillar.pillarId)).toEqual(["excavation"]);
    }
    expect(legacy.exposure).toEqual(canonical.exposure);
  });

  it("suppresses a convergent risk identically in Command and Founder Focus, and restores it in both when convergence ends", () => {
    const convergent = runPipeline([assessment("a1")]);
    expect(convergent.graph.convergentRisks).toHaveLength(1);
    expect(convergent.convergence.has("Icarus:a1")).toBe(true);
    expect(keysOf(convergent.commandItems)).not.toContain("Icarus:a1");
    expect(focusKeys(convergent)).not.toContain("Icarus:a1");
    const host = convergent.commandItems.find((entry) => entry.convergentStrategicRisk)!;
    expect(`${host.objectType}:${host.id}`).toBe("Action:action-1");
    expect(host.convergentStrategicRisk!.clusterKey).toBe(convergent.graph.convergentRisks[0].clusterKey);
    expect(convergent.focus.find((entry) => entry.key === convergent.graph.convergentRisks[0].clusterKey)!.strategicRiskKeys)
      .toEqual([getIcarusIdentityKey("a1")]);

    const isolated = runPipeline([assessment("a1")], { contextRecords: [] });
    expect(isolated.graph.convergentRisks).toEqual([]);
    expect(keysOf(isolated.commandItems)).toContain("Icarus:a1");
    expect(focusKeys(isolated)).toContain("Icarus:a1");
  });

  it("does not suppress a genuinely different risk that only shares the pillar", () => {
    const unrelated = assessment("a2", {
      failureModes: [{ id: "mode-1", mechanism: "M.", vulnerability: "V.", evidence: [evidence("evidence-1")] }],
    });
    const result = runPipeline([assessment("a1"), unrelated]);
    expect(keysOf(result.commandItems)).not.toContain("Icarus:a1");
    expect(keysOf(result.commandItems)).toContain("Icarus:a2");
    expect(focusKeys(result)).toContain("Icarus:a2");
  });

  it("removes a closed assessment from attention, correlation, Command, Focus, systemic exposure and trajectory", () => {
    const open = runPipeline([assessment("a1")]);
    const closed = runPipeline([assessment("a1", { status: "Closed" })]);
    expect(closed.signals).toEqual([]);
    expect(closed.correlationSignals).toEqual([]);
    expect(closed.graph.convergentRisks).toEqual([]);
    expect(closed.commandItems.some((entry) => entry.strategicRisk || entry.objectType === "Icarus")).toBe(false);
    expect(closed.focus.some((entry) => entry.strategicRiskKeys)).toBe(false);
    expect(closed.exposure.pillars.every((pillar) => pillar.state === "No material exposure")).toBe(true);
    const trajectory = compareIcarusExposure({
      previous: open.snapshot,
      current: closed.snapshot,
      assessmentStatuses: new Map([["a1", "Closed"]]),
    });
    expect(trajectory.changes.map((change) => [change.assessmentId, change.change, change.resolution])).toEqual([["a1", "No longer present", "Closed"]]);
  });

  it("drops a risk out everywhere once its mechanism is controlled by verified evidence", () => {
    const controlled = assessment("a1", {
      failureModes: [{
        id: "mode-1",
        mechanism: "M.",
        vulnerability: "V.",
        evidence: [evidence("evidence-1", actionRef), evidence("control-evidence")],
      }],
      controls: [{
        id: "control-1",
        failureModeId: "mode-1",
        intervention: "Control.",
        lifecycle: "Active",
        effectiveness: "Evidence supports",
        effectivenessReviewedAt: timestamp,
        effectivenessReviewedBy: "Founder",
        evidenceIds: ["control-evidence"],
        linkedRecords: [],
        nextReviewAt: "2025-12-31",
      }],
    });
    const result = runPipeline([controlled]);
    expect(result.signals).toEqual([]);
    expect(result.graph.convergentRisks).toEqual([]);
    expect(keysOf(result.commandItems)).toEqual(["Action:action-1"]);
  });

  it("keeps provenance through every adapter", () => {
    const result = runPipeline([assessment("a1")]);
    const host = result.commandItems.find((entry) => entry.convergentStrategicRisk)!;
    expect(host.strategicRisk!.references).toEqual([result.signals[0].primaryReference]);
    expect(host.strategicRisk!.references[0]).toMatchObject({ assessmentId: "a1", failureModeId: "mode-1" });

    const contribution = result.contributions.get(result.graph.convergentRisks[0].clusterKey)!;
    expect(contribution.assessments.map((entry) => entry.assessmentId)).toEqual(["a1"]);
    expect(contribution.assessments[0].sharedRecords).toEqual([{
      recordKey: "Action:action-1",
      links: [{ recordKey: "Action:action-1", via: "Evidence source", kind: "Direct", failureModeId: "mode-1", evidenceId: "evidence-1" }],
    }, {
      recordKey: "Person:founder",
      links: [{ recordKey: "Person:founder", via: "Evidence source", kind: "Direct", failureModeId: "mode-1", evidenceId: "evidence-2" }],
    }]);
    expect(contribution.otherContributors.map((entry) => entry.recordKey)).toEqual(["Action:action-1"]);
    expect(contribution.contextContributors.map((entry) => [entry.recordKey, entry.linkedByAssessmentIds, entry.material]))
      .toEqual([["Person:founder", ["a1"], true]]);
  });

  it("keeps direct and expanded links distinguishable in correlation", () => {
    const objectives = new Map<string, IcarusStrategicObjectiveContext>([
      ["objective-1", { area: "Operating Business", importance: "High", isLive: true, linkedProjectIds: ["project-1"] }],
    ]);
    const result = runPipeline([assessment("a1", { linkedRecords: [{ recordType: "Strategic Objective", recordId: "objective-1" }] })], { objectives });
    const kinds = Object.fromEntries(result.correlationSignals[0].links.map((link) => [link.recordKey, link.kind]));
    expect(kinds["Project:project-1"]).toBe("Expanded");
    expect(kinds["Action:action-1"]).toBe("Direct");
    expect(result.signals[0].anchors).toEqual([]);
  });

  it("does not inflate materiality through duplicate paths to the same records", () => {
    const single = runPipeline([assessment("a1")]);
    const duplicated = runPipeline([assessment("a1", {
      linkedRecords: [pillarRef("Excavation"), pillarRef("excavation")],
      failureModes: [{
        id: "mode-1",
        mechanism: "M.",
        vulnerability: "V.",
        evidence: [evidence("evidence-1", actionRef), evidence("evidence-2", founderRef), evidence("evidence-3", actionRef), evidence("evidence-4", founderRef)],
      }],
    })], { contextRecords: [...founderDependency(), ...founderDependency()] });
    const shape = (result: ReturnType<typeof runPipeline>) => result.graph.convergentRisks.map((cluster) => ({
      categories: [...cluster.categories].sort(),
      recordCount: cluster.recordCount,
      contributing: cluster.contributingRecordCount,
      context: cluster.contextRecords.length,
    }));
    expect(shape(duplicated)).toEqual(shape(single));
    expect(duplicated.exposure.pillars.find((pillar) => pillar.pillarId === "excavation")!.assessmentCount).toBe(1);
    expect(duplicated.signals[0].riskScore).toBe(single.signals[0].riskScore);
  });

  it("does not double-count two failure modes of one assessment as separate correlated records", () => {
    const twoModes = assessment("a1", {
      failureModes: [
        { id: "mode-1", mechanism: "M1.", vulnerability: "V.", evidence: [evidence("evidence-1", actionRef), evidence("evidence-2", founderRef)] },
        { id: "mode-2", mechanism: "M2.", vulnerability: "V.", evidence: [evidence("evidence-3", actionRef)] },
      ],
    });
    const result = runPipeline([twoModes]);
    expect(result.graph.convergentRisks[0].records.filter((record) => record.objectType === "Icarus")).toHaveLength(1);
    expect(result.graph.convergentRisks[0].recordCount).toBe(2);
  });

  it("leaves pre-Icarus behaviour unchanged when Icarus is absent", () => {
    const without = runPipeline([], { includeIcarus: false });
    const empty = runPipeline([]);
    expect(empty.command).toEqual(without.command);
    expect(empty.commandItems).toEqual(without.command.items);
    expect(empty.focus).toEqual(without.focus);
    expect(empty.graph.clusters.map((cluster) => [cluster.clusterKey, [...cluster.categories], cluster.contextRecords]))
      .toEqual(without.graph.clusters.map((cluster) => [cluster.clusterKey, [...cluster.categories], []]));
  });

  it("is deterministic regardless of input order", () => {
    const records = [assessment("a2", { linkedRecords: [pillarRef("Garden Maintenance")] }), assessment("a1")];
    const forward = runPipeline(records);
    const reversed = runPipeline([...records].reverse());
    expect(reversed.signals).toEqual(forward.signals);
    expect(reversed.correlationSignals).toEqual(forward.correlationSignals);
    expect(reversed.commandItems).toEqual(forward.commandItems);
    expect(reversed.focus).toEqual(forward.focus);
    expect(reversed.exposure).toEqual(forward.exposure);
    expect(reversed.snapshot).toEqual(forward.snapshot);
  });
});

describe("Icarus Phase 3 assurance invariants", () => {
  const live: IcarusStrategicObjectiveContext = { area: "Operating Business", importance: "Critical", isLive: true };
  const objectives = new Map([["objective-1", live]]);
  const objectiveRef: IcarusRecordReference = { recordType: "Strategic Objective", recordId: "objective-1" };
  const failedControl = {
    id: "control-1", failureModeId: "mode-1", intervention: "Control.", lifecycle: "Active" as const,
    effectiveness: "Unknown" as const, evidenceIds: [], linkedRecords: [], nextReviewAt: "2025-12-31",
    assuranceTests: [{ id: "test-1", testedAt: timestamp, testedByPersonId: "founder", result: "Failed" as const, evidenceIds: ["evidence-1"] }],
  };

  function assured(assessments: readonly IcarusAssessmentRecord[], actions: Action[] = [action()], withAssurance = true) {
    const reviews = buildIcarusReview(assessments, sourcesFor(assessments), NOW);
    const base = buildIcarusStrategicAttention({ assessments, reviews, strategicObjectives: objectives });
    const assurance = buildIcarusAssurance({
      assessments, reviews, signals: base, people: [{ id: "founder", status: "Active" }],
      actions: [], primaryFounderId: "founder", founderDependencyActive: false, strategicObjectives: objectives, nowMs: NOW,
    });
    const signals = withAssurance ? attachIcarusAssuranceToSignals(base, assurance) : base;
    const command = buildCommandAttention({
      problems: [], actions, outreach: [], projects: [], decisions: [], opportunities: [], lessons: [], systems: [],
      sops: [], handoffs: [], procurementQueue: [], nowMs: NOW, icarus: signals,
    });
    return { assurance, signals, command, focus: buildIcarusFounderFocusRisks(signals) };
  }

  const failing = (id: string) => assessment(id, { linkedRecords: [objectiveRef], controls: [failedControl] });

  it("never lets an assurance failure outrank blocked or overdue execution in Command", () => {
    const result = assured([failing("a1")], [
      action(),
      action({ id: "action-2", status: "Open", dueDate: "2025-04-01", actionTitle: "Overdue action", title: "Overdue action" }),
    ]);
    expect(result.assurance.byAssessmentId.get("a1")?.escalation).toBe("Assurance failure");
    const items = result.command.items;
    const icarusIndex = items.findIndex((entry) => entry.objectType === "Icarus");
    expect(icarusIndex).toBeGreaterThan(-1);
    expect(items[icarusIndex].attentionRank).toBeGreaterThanOrEqual(3);
    expect(keysOf(items.slice(0, icarusIndex))).toEqual(["Action:action-1", "Action:action-2"]);
  });

  it("ranks an assurance failure above the same exposure without assurance, within bounds", () => {
    const withAssurance = assured([failing("a1")], []).command.items.find((entry) => entry.objectType === "Icarus")!;
    const without = assured([failing("a1")], [], false).command.items.find((entry) => entry.objectType === "Icarus")!;
    expect(withAssurance.attentionRank).toBe(Math.max(3, without.attentionRank - 1));
    expect(withAssurance.reasons.length).toBeGreaterThan(without.reasons.length);
  });

  it("never removes an accepted exposure from Command or Founder Focus", () => {
    const accepted = assessment("a1", {
      linkedRecords: [objectiveRef],
      accountableOwnerPersonId: "founder",
      acceptances: [{
        id: "acceptance-1", failureModeIds: ["mode-1"], acceptedByPersonId: "founder", rationale: "Tolerable for now.",
        acceptedAt: timestamp, reviewBy: "2025-06-01",
      }],
    });
    const result = assured([accepted], []);
    expect(result.assurance.byAssessmentId.get("a1")?.signal.acceptance).toBe("Active");
    expect(keysOf(result.command.items)).toEqual(["Icarus:a1"]);
    expect(result.focus.map((entry) => entry.id)).toEqual(["a1"]);
    expect(result.focus[0].reason).toContain("formally accepted");
  });

  it("leaves pre-assurance Command and Focus output unchanged when assurance is not attached", () => {
    const pipeline = runPipeline([failing("a1")], { objectives });
    const result = assured([failing("a1")], [action()], false);
    expect(result.signals.every((signal) => signal.assurance === undefined)).toBe(true);
    expect(result.command.items).toEqual(pipeline.command.items);
    expect(result.focus).toEqual(buildIcarusFounderFocusRisks(pipeline.signals));
  });

  it("is deterministic regardless of assessment order", () => {
    const records = [failing("a1"), assessment("a2", { linkedRecords: [objectiveRef] })];
    const forward = assured(records);
    const reversed = assured([...records].reverse());
    expect(reversed.command.items).toEqual(forward.command.items);
    expect(reversed.focus).toEqual(forward.focus);
    expect([...reversed.assurance.byAssessmentId.keys()].sort()).toEqual([...forward.assurance.byAssessmentId.keys()].sort());
    expect(reversed.assurance.assessments).toEqual(forward.assurance.assessments);
  });
});
