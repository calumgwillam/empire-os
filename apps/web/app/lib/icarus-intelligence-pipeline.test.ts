// Contract tests for the Icarus intelligence pipeline (composition root). They prove the pipeline orchestrates the
// existing adapters in the correct order, that it is pure and deterministic, and that every downstream consumer
// (Command, Founder Focus, systemic exposure, history) sees one consistent Icarus state.
import { describe, expect, it } from "vitest";
import {
  buildIcarusReview,
  getIcarusIdentityKey,
  getIcarusReferenceKey,
  type IcarusAssessmentRecord,
  type IcarusControl,
  type IcarusEvidence,
  type IcarusRecordReference,
  type IcarusSourceRecord,
} from "./icarus";
import { buildIcarusFounderFocusRisks, buildIcarusStrategicAttention } from "./icarus-strategic-attention";
import { attachIcarusAssuranceToSignals, buildIcarusAssurance } from "./icarus-assurance";
import { buildIcarusAssuranceRollup } from "./icarus-assurance-rollup";
import { attachIcarusFailureChainToSignals, buildIcarusFailureChainIntelligence } from "./icarus-failure-chain-analysis";
import { buildIcarusClusterContributions, buildIcarusCorrelationSignals } from "./icarus-correlation";
import { buildIcarusSystemicExposure } from "./icarus-systemic-exposure";
import { buildIcarusExposureSnapshot } from "./icarus-exposure-history";
import { buildCorrelationGraph, type CorrelationContextRecordInput, type CorrelationGraphInput } from "./correlation-graph";
import { buildCommandAttention, resolveCommandStrategicRiskConvergence, type CommandAttentionInput } from "./command-attention";
import { buildFounderFocus } from "./founder-focus";
import { buildPeopleCorrelationContext } from "./people-correlation-context";
import { resolveStrategicRiskConvergence } from "./strategic-risk-resolution";
import { resolveOperatingPillar } from "./pillar-identity";
import {
  buildIcarusCorrelationIntelligence,
  buildIcarusObjectiveContext,
  buildIcarusStrategicIntelligence,
  findIcarusCorrelationGraphMismatch,
  type IcarusPipelineObjective,
  type IcarusStrategicIntelligence,
  type IcarusStrategicIntelligenceInput,
} from "./icarus-intelligence-pipeline";

const DAY_MS = 86400000;
const NOW = new Date(2025, 3, 10, 12, 0, 0, 0).getTime();
const timestamp = "2025-04-01T12:00:00.000Z";
const createdAt = new Date(NOW - 30 * DAY_MS).toISOString();

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
const objectiveRef: IcarusRecordReference = { recordType: "Strategic Objective", recordId: "objective-1" };
const pillarRef = (value: string): IcarusRecordReference => ({ recordType: "Pillar", recordId: value });

const objective: IcarusPipelineObjective = { id: "objective-1", pillar: "Operating Business", importance: "Critical", status: "Active" };

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

const failedControl: IcarusControl = {
  id: "control-1", failureModeId: "mode-1", intervention: "Control.", lifecycle: "Active",
  effectiveness: "Unknown", evidenceIds: [], linkedRecords: [], nextReviewAt: "2025-12-31",
  assuranceTests: [{ id: "test-1", testedAt: timestamp, testedByPersonId: "founder", result: "Failed", evidenceIds: ["evidence-1"] }],
};

const failing = (id: string, overrides: Partial<IcarusAssessmentRecord> = {}) =>
  assessment(id, { linkedRecords: [objectiveRef, pillarRef("Excavation")], controls: [failedControl], ...overrides });

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

function emptyGraphInput(): CorrelationGraphInput {
  return {
    founderAuthorityItems: [], commandAttentionItems: [], decisionReviewsDue: [], decisionsWithoutExecution: [],
    learningGaps: [], staleUnownedWork: [], staleRecords: [], stalledOpportunities: [], stalledLeads: [],
    cashBuffer: null, fundingGap: null, overdueCommitments: [], overdueExpectedIncome: [], captures: [], problems: [],
    actions: [], decisions: [], opportunities: [], lessons: [], systems: [], sops: [], projects: [], leads: [],
  };
}

type Options = {
  objectives?: IcarusPipelineObjective[];
  contextRecords?: readonly CorrelationContextRecordInput[];
  actions?: Action[];
  nowMs?: number;
  includeIcarus?: boolean;
};

function stageAInput(assessments: readonly IcarusAssessmentRecord[], options: Options = {}): IcarusStrategicIntelligenceInput {
  return {
    assessments,
    sourceRecords: sourcesFor(assessments),
    strategicObjectives: options.objectives ?? [objective],
    people: [{ id: "founder", status: "Active" }, { id: "person-2", status: "Active" }],
    actions: [],
    primaryFounderId: "founder",
    founderDependencyActive: false,
    nowMs: options.nowMs ?? NOW,
  };
}

// Mirrors page.tsx: Stage A -> Command base -> generic graph -> Stage B -> final Command presentation / Founder Focus.
function runEmpire(assessments: readonly IcarusAssessmentRecord[], options: Options = {}) {
  const includeIcarus = options.includeIcarus ?? true;
  const intelligence = buildIcarusStrategicIntelligence(stageAInput(assessments, options));
  const actions = options.actions ?? [action()];
  const command = buildCommandAttention({
    problems: [], actions, outreach: [], projects: [], decisions: [], opportunities: [], lessons: [], systems: [],
    sops: [], handoffs: [], procurementQueue: [], nowMs: NOW,
    ...(includeIcarus ? { icarus: intelligence.strategicSignals } : {}),
  });
  const graph = buildCorrelationGraph({
    ...emptyGraphInput(),
    actions: actions.map((entry) => ({ id: entry.id })),
    commandAttentionItems: command.items.map((entry) => ({ ...entry, priorityScore: entry.operationalPriorityScore ?? entry.priorityScore })),
    ...(includeIcarus ? { strategicRisks: intelligence.correlationSignals } : {}),
    contextRecords: options.contextRecords ?? founderDependency(),
  });
  const correlation = includeIcarus
    ? buildIcarusCorrelationIntelligence(intelligence, {
      graph,
      recordPillars: actions.map((entry) => ({ objectType: "Action", id: entry.id, pillar: entry.relatedPillar })),
    })
    : null;
  const commandItems = resolveCommandStrategicRiskConvergence(command.items, correlation?.strategicRiskConvergence ?? new Map());
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
    ...(includeIcarus ? { strategicRisks: intelligence.founderFocusRisks } : {}),
  });
  return { intelligence, command, graph, correlation, commandItems, focus };
}

const keysOf = (items: readonly { objectType: string; id: string }[]) => items.map((entry) => `${entry.objectType}:${entry.id}`);
// Strips the annotation overlays (assurance + failure chain) to compare underlying exposure/materiality.
const withoutAssurance = (signals: IcarusStrategicIntelligence["strategicSignals"]) =>
  signals.map((signal) => {
    const copy = { ...signal };
    delete copy.assurance;
    delete copy.failureChain;
    return copy;
  });

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
}

describe("Icarus intelligence pipeline — composition", () => {
  it("produces exactly what the previous hand-composed adapter chain produced", () => {
    const assessments = [failing("a1"), assessment("a2"), assessment("a3", { status: "Closed" })];
    const options: Options = {};
    const result = runEmpire(assessments, options);

    const input = stageAInput(assessments, options);
    const objectives = buildIcarusObjectiveContext(input.strategicObjectives);
    const reviews = buildIcarusReview(assessments, input.sourceRecords, NOW);
    const base = buildIcarusStrategicAttention({ assessments, reviews, strategicObjectives: objectives });
    const assurance = buildIcarusAssurance({
      assessments, reviews, signals: base, people: input.people, actions: input.actions, primaryFounderId: "founder",
      founderDependencyActive: false, strategicObjectives: objectives, nowMs: NOW,
    });
    const assured = attachIcarusAssuranceToSignals(base, assurance);
    const failureChains = buildIcarusFailureChainIntelligence({
      assessments, signals: assured, assurance, strategicObjectives: objectives, primaryFounderId: "founder", founderDependencyActive: false,
    });
    const signals = attachIcarusFailureChainToSignals(assured, failureChains);
    const correlationSignals = buildIcarusCorrelationSignals({ signals });
    expect(result.intelligence.failureChains).toEqual(failureChains);
    expect(result.intelligence.reviews).toEqual(reviews);
    expect(result.intelligence.assurance).toEqual(assurance);
    expect(result.intelligence.assuranceRollup).toEqual(buildIcarusAssuranceRollup(assurance.assessments));
    expect(result.intelligence.strategicSignals).toEqual(signals);
    expect(result.intelligence.correlationSignals).toEqual(correlationSignals);
    expect(result.intelligence.founderFocusRisks).toEqual(buildIcarusFounderFocusRisks(signals));
    expect(result.intelligence.exposureSnapshot).toEqual(buildIcarusExposureSnapshot(signals));
    expect(result.intelligence.unresolvedFindings).toEqual(
      reviews.filter((review) => review.assessmentId !== "a3").flatMap((review) => review.findings),
    );

    const contributions = buildIcarusClusterContributions(result.graph, correlationSignals);
    expect(result.correlation!.clusterContributions).toEqual(contributions);
    expect(result.correlation!.strategicRiskConvergence)
      .toEqual(resolveStrategicRiskConvergence(result.graph.convergentRisks, correlationSignals.map((signal) => signal.recordKey)));
    expect(result.correlation!.systemicExposure).toEqual(buildIcarusSystemicExposure({
      signals,
      recordPillars: new Map([["Action:action-1", "Excavation"]]),
      otherSignals: [...result.graph.signalled.values()]
        .filter((record) => record.objectType !== "Icarus")
        .map(({ recordKey, area, signals: recordSignals }) => ({ recordKey, area, signals: [...recordSignals] })),
      clusters: [...contributions.values()].map((contribution) => ({
        clusterKey: contribution.clusterKey,
        convergent: contribution.convergent,
        assessmentIds: contribution.assessments.map((entry) => entry.assessmentId),
      })),
    }));
  });

  it("derives objective consequence only from live objectives", () => {
    const context = buildIcarusObjectiveContext([
      objective,
      { ...objective, id: "watching", status: "Watching" },
      { ...objective, id: "paused", status: "Paused" },
      { ...objective, id: "achieved", status: "Achieved" },
    ]);
    expect([...context.entries()].map(([id, entry]) => [id, entry.isLive])).toEqual([
      ["objective-1", true], ["watching", true], ["paused", false], ["achieved", false],
    ]);
  });

  it("uses one clock for reviews and assurance", () => {
    const cadenced = assessment("a1", {
      controls: [{
        ...failedControl,
        testCadenceDays: 30,
        assuranceTests: [{ id: "test-1", testedAt: timestamp, testedByPersonId: "founder", result: "Passed", evidenceIds: ["evidence-1"] }],
      }],
    });
    const current = buildIcarusStrategicIntelligence(stageAInput([cadenced]));
    const later = buildIcarusStrategicIntelligence(stageAInput([cadenced], { nowMs: NOW + 60 * DAY_MS }));
    expect(current.nowMs).toBe(NOW);
    expect(later.nowMs).toBe(NOW + 60 * DAY_MS);
    const codes = (result: IcarusStrategicIntelligence) => result.reviews[0].findings.map((finding) => finding.code);
    const controlStatus = (result: IcarusStrategicIntelligence) => result.assurance.byAssessmentId.get("a1")!.controls[0].status;
    expect(codes(current)).not.toContain("overdue-control-test");
    expect(controlStatus(current)).not.toBe("Test overdue");
    expect(codes(later)).toContain("overdue-control-test");
    expect(controlStatus(later)).toBe("Test overdue");
  });

  it("defaults the clock to the current time", () => {
    const before = Date.now();
    const { nowMs } = buildIcarusStrategicIntelligence({ ...stageAInput([]), nowMs: undefined });
    expect(nowMs).toBeGreaterThanOrEqual(before);
    expect(nowMs).toBeLessThanOrEqual(Date.now());
  });
});

describe("Icarus intelligence pipeline — sequencing", () => {
  it("rejects a correlation graph that was not built from the current strategic signals", () => {
    const open = runEmpire([assessment("a1")]);
    const closed = buildIcarusStrategicIntelligence(stageAInput([assessment("a1", { status: "Closed" })]));
    expect(findIcarusCorrelationGraphMismatch(open.graph, closed)).toEqual(["Icarus:a1"]);
    expect(() => buildIcarusCorrelationIntelligence(closed, { graph: open.graph })).toThrow(/out of sequence/);

    const graphWithoutRisks = buildCorrelationGraph({ ...emptyGraphInput(), actions: [{ id: "action-1" }] });
    expect(findIcarusCorrelationGraphMismatch(graphWithoutRisks, open.intelligence)).toEqual(["Icarus:a1"]);
    expect(() => buildIcarusCorrelationIntelligence(open.intelligence, { graph: graphWithoutRisks })).toThrow(/out of sequence/);

    expect(findIcarusCorrelationGraphMismatch(open.graph, open.intelligence)).toEqual([]);
  });

  it("stages Command as base items -> correlation -> convergence -> final presentation without a cycle", () => {
    const result = runEmpire([assessment("a1")]);
    // Base Command (pre-correlation) ranks the standalone strategic risk.
    expect(keysOf(result.command.items)).toContain("Icarus:a1");
    // Correlation depends only on base Command and Stage A; convergence is resolved from the graph alone.
    expect(result.correlation!.strategicRiskConvergence.get("Icarus:a1")?.clusterKey).toBe(result.graph.convergentRisks[0].clusterKey);
    // Final presentation folds the risk into its convergent host.
    expect(keysOf(result.commandItems)).not.toContain("Icarus:a1");
    const host = result.commandItems.find((entry) => entry.convergentStrategicRisk)!;
    expect(keysOf([host])).toEqual(["Action:action-1"]);
    expect(host.strategicRisk!.references).toEqual([result.intelligence.strategicSignals[0].primaryReference]);
  });

  it("decides materiality before assurance, and assurance never changes exposure", () => {
    const records = [failing("a1"), assessment("a2"), assessment("a3", { accountableOwnerPersonId: "person-2" })];
    const { intelligence } = runEmpire(records);
    const input = stageAInput(records);
    const exposureOnly = buildIcarusStrategicAttention({
      assessments: records,
      reviews: buildIcarusReview(records, input.sourceRecords, NOW),
      strategicObjectives: buildIcarusObjectiveContext(input.strategicObjectives),
    });
    expect(withoutAssurance(intelligence.strategicSignals)).toEqual(exposureOnly);
    expect(intelligence.strategicSignals.every((signal) => signal.assurance !== undefined)).toBe(true);
  });

  it("builds history snapshots from the final assured signals", () => {
    const { intelligence } = runEmpire([failing("a1"), assessment("a2")]);
    expect(intelligence.exposureSnapshot).toEqual(buildIcarusExposureSnapshot(intelligence.strategicSignals));
    intelligence.exposureSnapshot.forEach((entry) => {
      const assurance = intelligence.assurance.byAssessmentId.get(entry.assessmentId)!;
      expect(entry.assurance).toMatchObject({ state: assurance.state, escalation: assurance.escalation });
    });
    expect(intelligence.exposureSnapshot.map((entry) => entry.key))
      .toEqual(intelligence.strategicSignals.map((signal) => signal.key));
  });

  it("rolls systemic exposure up from the same authoritative signals as Command and Focus", () => {
    const result = runEmpire([assessment("a1"), assessment("a2", { failureModes: [{ id: "mode-1", mechanism: "M.", vulnerability: "V.", evidence: [evidence("evidence-1")] }] })]);
    const signalIds = result.intelligence.strategicSignals.map((signal) => signal.assessmentId).sort();
    const exposed = result.correlation!.systemicExposure.pillars.find((pillar) => pillar.pillarId === "excavation")!;
    expect(exposed.assessmentCount).toBe(signalIds.length);
    expect(result.intelligence.founderFocusRisks.map((risk) => risk.id).sort()).toEqual(signalIds);
    expect(keysOf(result.command.items).filter((key) => key.startsWith("Icarus:")).sort())
      .toEqual(signalIds.map((id) => `Icarus:${id}`));
  });
});

describe("Icarus intelligence pipeline — purity and determinism", () => {
  const records = () => [failing("a1"), assessment("a2"), assessment("a3", { status: "Monitoring", accountableOwnerPersonId: "person-2" })];

  it("returns deeply equivalent results for identical inputs", () => {
    const first = runEmpire(records());
    const second = runEmpire(records());
    expect(second.intelligence).toEqual(first.intelligence);
    expect(second.correlation).toEqual(first.correlation);
    expect(second.commandItems).toEqual(first.commandItems);
    expect(second.focus).toEqual(first.focus);
  });

  it("does not mutate its inputs", () => {
    const input = stageAInput(records());
    const before = structuredClone(input);
    deepFreeze(input);
    const intelligence = buildIcarusStrategicIntelligence(input);
    expect(input).toEqual(before);

    const graph = runEmpire(records()).graph;
    const recordPillars = deepFreeze([{ objectType: "Action", id: "action-1", pillar: "Excavation" }]);
    const pillars = deepFreeze(["Excavation"]);
    expect(() => buildIcarusCorrelationIntelligence(intelligence, { graph, recordPillars, pillars })).not.toThrow();
    expect(recordPillars).toEqual([{ objectType: "Action", id: "action-1", pillar: "Excavation" }]);
  });

  it("is independent of assessment input order for every strategic output", () => {
    const forward = runEmpire(records());
    const reversed = runEmpire([...records()].reverse());
    const strategic = (result: ReturnType<typeof runEmpire>) => ({
      signals: result.intelligence.strategicSignals,
      correlationSignals: result.intelligence.correlationSignals,
      assurance: result.intelligence.assurance,
      rollup: result.intelligence.assuranceRollup,
      focusRisks: result.intelligence.founderFocusRisks,
      snapshot: result.intelligence.exposureSnapshot,
      unresolvedAssessments: result.intelligence.unresolvedFindingAssessmentCount,
      correlation: result.correlation,
      commandItems: result.commandItems,
      focus: result.focus,
    });
    expect(strategic(reversed)).toEqual(strategic(forward));
    // Reviews remain a per-record projection aligned to stored order.
    expect(reversed.intelligence.reviews.map((review) => review.assessmentId)).toEqual(["a3", "a2", "a1"]);
    expect([...reversed.intelligence.reviews].reverse()).toEqual(forward.intelligence.reviews);
  });

  it("returns safe empty outputs without Icarus data and leaves pre-Icarus behaviour unchanged", () => {
    const empty = runEmpire([]);
    const without = runEmpire([], { includeIcarus: false });
    expect(empty.intelligence).toMatchObject({
      reviews: [], unresolvedFindings: [], unresolvedFindingAssessmentCount: 0, strategicSignals: [],
      correlationSignals: [], founderFocusRisks: [], exposureSnapshot: [],
    });
    expect(empty.intelligence.assessmentStatuses.size).toBe(0);
    expect(empty.intelligence.assurance.assessments).toEqual([]);
    expect(empty.intelligence.assurance.obligations).toEqual([]);
    expect(empty.intelligence.assuranceRollup.unattributedMaterialAssessmentIds).toEqual([]);
    expect(empty.correlation!.clusterContributions.size).toBe(0);
    expect(empty.correlation!.strategicRiskConvergence.size).toBe(0);
    expect(empty.correlation!.systemicExposure.pillars.every((pillar) => pillar.state === "No material exposure")).toBe(true);
    expect(empty.commandItems).toEqual(without.commandItems);
    expect(empty.focus).toEqual(without.focus);
  });
});

describe("Icarus intelligence pipeline — consistency across consumers", () => {
  it("lets legacy records and stored pillar forms flow through to the canonical pillar", () => {
    const canonical = runEmpire([assessment("a1")]);
    const legacy = runEmpire([assessment("a1", { linkedRecords: [pillarRef("  EXCAVATION ")] })]);
    for (const result of [canonical, legacy]) {
      const [signal] = result.intelligence.strategicSignals;
      expect(signal.operatingPillars).toEqual([resolveOperatingPillar("Excavation")]);
      expect(result.intelligence.assurance.byAssessmentId.get("a1")!.operatingPillarIds).toEqual(["excavation"]);
      expect(result.correlation!.systemicExposure.pillars.filter((pillar) => pillar.assessmentCount > 0).map((pillar) => pillar.pillarId))
        .toEqual(["excavation"]);
    }
    expect(legacy.correlation!.systemicExposure).toEqual(canonical.correlation!.systemicExposure);
    expect(legacy.intelligence.assuranceRollup).toEqual(canonical.intelligence.assuranceRollup);
  });

  it("removes a closed risk from every appropriate output in one pipeline call", () => {
    const open = runEmpire([failing("a1")]);
    const closed = runEmpire([failing("a1", { status: "Closed" })]);
    expect(open.intelligence.strategicSignals).toHaveLength(1);
    expect(closed.intelligence).toMatchObject({
      strategicSignals: [], correlationSignals: [], founderFocusRisks: [], exposureSnapshot: [], unresolvedFindings: [],
    });
    expect(closed.intelligence.assurance.assessments).toEqual([]);
    expect(closed.intelligence.assessmentStatuses.get("a1")).toBe("Closed");
    expect(closed.intelligence.reviews.map((review) => review.assessmentId)).toEqual(["a1"]);
    expect(closed.correlation!.clusterContributions.size).toBe(0);
    expect(closed.correlation!.strategicRiskConvergence.size).toBe(0);
    expect(closed.correlation!.systemicExposure.pillars.every((pillar) => pillar.state === "No material exposure")).toBe(true);
    expect(closed.commandItems.some((entry) => entry.objectType === "Icarus" || entry.strategicRisk)).toBe(false);
    expect(closed.focus.some((entry) => entry.strategicRiskKeys)).toBe(false);
    expect(closed.intelligence.assuranceRollup).toEqual(runEmpire([]).intelligence.assuranceRollup);
  });

  it("shows an assurance failure consistently in Command, Founder Focus and history", () => {
    const result = runEmpire([failing("a1")], { contextRecords: [] });
    const assurance = result.intelligence.assurance.byAssessmentId.get("a1")!;
    expect(assurance.escalation).toBe("Assurance failure");
    expect(result.intelligence.strategicSignals[0].assurance?.escalation).toBe("Assurance failure");
    const commandItem = result.commandItems.find((entry) => entry.objectType === "Icarus")!;
    expect(commandItem.reasons.some((reason) => reason.startsWith("ASSURANCE:"))).toBe(true);
    expect(result.intelligence.founderFocusRisks[0].reason).toContain("Icarus assurance failure");
    expect(result.focus.find((entry) => entry.key === "Icarus:a1")).toBeDefined();
    expect(result.intelligence.exposureSnapshot[0].assurance).toMatchObject({ escalation: "Assurance failure", failedControlIds: ["control-1"] });
  });

  it("suppresses a convergent risk identically in Command and Founder Focus", () => {
    const result = runEmpire([assessment("a1")]);
    const clusterKey = result.graph.convergentRisks[0].clusterKey;
    expect(result.correlation!.strategicRiskConvergence.get("Icarus:a1")?.clusterKey).toBe(clusterKey);
    expect(keysOf(result.commandItems)).not.toContain("Icarus:a1");
    expect(result.focus.map((entry) => entry.key)).not.toContain("Icarus:a1");
    expect(result.commandItems.find((entry) => entry.convergentStrategicRisk)!.convergentStrategicRisk!.clusterKey).toBe(clusterKey);
    expect(result.focus.find((entry) => entry.key === clusterKey)!.strategicRiskKeys).toEqual([getIcarusIdentityKey("a1")]);
    expect(result.correlation!.clusterContributions.get(clusterKey)!.assessments.map((entry) => entry.assessmentId)).toEqual(["a1"]);
  });

  it("reaches the same combined risk through a Person whether linked by evidence or by risk ownership", () => {
    const byEvidence = runEmpire([assessment("a1")]);
    const byOwner = runEmpire([assessment("a1", {
      accountableOwnerPersonId: "founder",
      failureModes: [{ id: "mode-1", mechanism: "M.", vulnerability: "V.", evidence: [evidence("evidence-1", actionRef)] }],
    })]);
    for (const result of [byEvidence, byOwner]) {
      const clusterKey = result.graph.convergentRisks[0]?.clusterKey;
      expect(clusterKey).toBeDefined();
      const contribution = result.correlation!.clusterContributions.get(clusterKey)!;
      expect(contribution.contextContributors.map((entry) => entry.recordKey)).toEqual(["Person:founder"]);
      expect(result.correlation!.strategicRiskConvergence.get("Icarus:a1")?.clusterKey).toBe(clusterKey);
    }
    expect(byOwner.graph.convergentRisks[0].clusterKey).toBe(byEvidence.graph.convergentRisks[0].clusterKey);
    const ownerLink = byOwner.intelligence.correlationSignals[0].links.find((link) => link.recordKey === "Person:founder");
    expect(ownerLink?.via).toBe("Risk owner");
  });

  it("keeps an accepted exposure material while changing its governance state", () => {
    const acceptance = {
      id: "acceptance-1", failureModeIds: ["mode-1"], acceptedByPersonId: "founder", rationale: "Tolerable for now.",
      acceptedAt: timestamp, reviewBy: "2025-06-01",
    };
    const unaccepted = runEmpire([assessment("a1", { linkedRecords: [objectiveRef], accountableOwnerPersonId: "founder" })], { contextRecords: [] });
    const accepted = runEmpire([assessment("a1", { linkedRecords: [objectiveRef], accountableOwnerPersonId: "founder", acceptances: [acceptance] })], { contextRecords: [] });
    expect(withoutAssurance(accepted.intelligence.strategicSignals)).toEqual(withoutAssurance(unaccepted.intelligence.strategicSignals));
    expect(accepted.intelligence.strategicSignals[0].assurance?.acceptance).toBe("Active");
    expect(accepted.intelligence.assurance.byAssessmentId.get("a1")!.state)
      .not.toBe(unaccepted.intelligence.assurance.byAssessmentId.get("a1")!.state);
    expect(keysOf(accepted.commandItems)).toContain("Icarus:a1");
    expect(accepted.commandItems.find((entry) => entry.objectType === "Icarus")!.reasons).toContain("ACCEPTED EXPOSURE");
    expect(accepted.intelligence.founderFocusRisks[0].reason).toContain("formally accepted");
    expect(accepted.intelligence.exposureSnapshot[0]).toMatchObject({
      exposure: unaccepted.intelligence.exposureSnapshot[0].exposure,
      riskScore: unaccepted.intelligence.exposureSnapshot[0].riskScore,
      assurance: { acceptance: "Active" },
    });
  });

  it("changes assurance state on improved governance without altering exposure", () => {
    const ungoverned = runEmpire([assessment("a1")], { contextRecords: [] });
    const governed = runEmpire([assessment("a1", {
      accountableOwnerPersonId: "person-2",
      reviewedAt: timestamp,
      reviewedByPersonId: "person-2",
      nextReviewBy: "2025-06-01",
    })], { contextRecords: [] });
    const before = ungoverned.intelligence.assurance.byAssessmentId.get("a1")!;
    const after = governed.intelligence.assurance.byAssessmentId.get("a1")!;
    expect(before.ownership).toBe("Unassigned");
    expect(after.ownership).toBe("Assigned");
    expect(after.obligations.map((entry) => entry.category)).not.toContain("no-risk-owner");
    expect(before.obligations.map((entry) => entry.category)).toContain("no-risk-owner");
    expect(governed.intelligence.exposureSnapshot[0].assurance?.riskOwnerPersonId)
      .toBe("person-2");
    const exposureOf = (result: ReturnType<typeof runEmpire>) => result.intelligence.strategicSignals
      .map(({ exposure, riskScore, materialFailureModes }) => ({ exposure, riskScore, materialFailureModes }));
    expect(exposureOf(governed)).toEqual(exposureOf(ungoverned));
  });
});
