import { describe, expect, it } from "vitest";
import type { IcarusAssessmentRecord, IcarusRecordReference, IcarusSourceRecord } from "./icarus";
import {
  buildIcarusRecommendedStressScenarios,
  runIcarusStressTest,
  type IcarusStressOverride,
  type IcarusStressTestingInput,
} from "./icarus-stress-testing";
import { buildIcarusStrategicIntelligence } from "./icarus-intelligence-pipeline";

const NOW = Date.parse("2025-04-10T12:00:00.000Z");
const projectRef: IcarusRecordReference = { recordType: "Project", recordId: "project-1" };
const actionRef: IcarusRecordReference = { recordType: "Action", recordId: "action-1" };
const personRef: IcarusRecordReference = { recordType: "Person", recordId: "person-1" };
const objective = { id: "objective-1", pillar: "Excavation", importance: "Critical" as const, status: "Active" };

function assessment(id: string, linkedRecords: IcarusRecordReference[] = [projectRef]): IcarusAssessmentRecord {
  return {
    id,
    outcome: `Outcome ${id}`,
    status: "Open",
    createdAt: "2025-04-01T00:00:00.000Z",
    updatedAt: "2025-04-01T00:00:00.000Z",
    linkedRecords: [{ recordType: "Strategic Objective", recordId: objective.id }],
    failureModes: [{
      id: "mode-1",
      mechanism: `Failure mechanism ${id}`,
      vulnerability: "A single dependency can impair the protection.",
      evidence: [{
        id: `evidence-${id}`,
        statement: "The dependency supports the control.",
        origin: "Direct observation",
        recordedAt: "2025-04-01T00:00:00.000Z",
        recordedBy: "Founder",
        review: "Supports",
        reviewedAt: "2025-04-01T00:00:00.000Z",
        reviewedBy: "Founder",
      }],
    }],
    controls: [
      {
        id: "control-1",
        failureModeId: "mode-1",
        intervention: `Protection ${id}`,
        lifecycle: "Active",
        effectiveness: "Evidence supports",
        evidenceIds: [`evidence-${id}`],
        linkedRecords,
        nextReviewAt: "2025-12-31",
        ownerPersonId: "founder",
        assuranceTests: [{
          id: `test-${id}`,
          testedAt: "2025-04-01T00:00:00.000Z",
          testedByPersonId: "founder",
          result: "Passed",
          evidenceIds: [`evidence-${id}`],
        }],
      },
      {
        id: "failed-control",
        failureModeId: "mode-1",
        intervention: `Recorded failed protection ${id}`,
        lifecycle: "Active",
        effectiveness: "Evidence contradicts",
        evidenceIds: [`evidence-${id}`],
        linkedRecords: [],
        assuranceTests: [{
          id: `failed-test-${id}`,
          testedAt: "2025-04-01T00:00:00.000Z",
          testedByPersonId: "founder",
          result: "Failed",
          evidenceIds: [`evidence-${id}`],
        }],
      },
    ],
  };
}

function makeInput(overrides: Partial<IcarusStressTestingInput> = {}): IcarusStressTestingInput {
  const sourceRecords: IcarusSourceRecord[] = [
    { ...projectRef, title: "Project One", status: "In Progress", health: "On track" },
    { ...actionRef, title: "Action One", status: "Open" },
    { ...personRef, title: "Person One", status: "Active" },
    { recordType: "Strategic Objective", recordId: objective.id, title: "Critical objective" },
  ];
  return {
    assessments: [assessment("risk-1")],
    sourceRecords,
    strategicObjectives: [objective],
    people: [{ id: "founder", status: "Active" }, { id: "person-1", status: "Active" }],
    actions: [{ id: "action-1", status: "Open" }],
    primaryFounderId: "founder",
    founderDependencyActive: false,
    founderDependentWork: [{ objectType: "Action", id: "founder-only-action" }],
    nowMs: NOW,
    ...overrides,
  };
}

const baseline = (input: IcarusStressTestingInput) => buildIcarusStrategicIntelligence(input);

describe("Icarus counterfactual stress testing", () => {
  it("fails an explicitly required dependency and reports only newly exposed baseline-contained risk", () => {
    const input = makeInput();
    const current = baseline(input);
    const result = runIcarusStressTest(input, [{ type: "Dependency", reference: projectRef, state: "Failed" }], current);

    expect(current.failureChains.interruptedChains).toHaveLength(1);
    expect(result.outcome).toBe("Material exposure");
    expect(result.delta.newlyExposedAssessments.map((entry) => entry.assessmentId)).toEqual(["risk-1"]);
    expect(result.delta.newlyExposedObjectiveIds).toEqual([objective.id]);
    expect(result.delta.newlyAffectedPillarIds).toEqual(["excavation"]);
    expect(result.delta.barrierChanges).toMatchObject([{ previous: "Active", current: "Failed", worsened: true }]);
    expect(result.hypothetical.exposureSnapshot).toEqual([]);
    expect(current.dependencyHealth.get("Project:project-1")?.health).toBe("Healthy");
  });

  it("models project and action blockage using their existing health semantics", () => {
    const input = makeInput();
    const project = runIcarusStressTest(input, [{ type: "Project", projectId: "project-1", state: "Blocked" }], baseline(input));
    expect(project.hypothetical.dependencyHealth.get("Project:project-1")?.health).toBe("Degraded");
    expect(project.delta.newlyActivatedChains[0]?.status).toBe("Potential");

    const actionInput = makeInput({ assessments: [assessment("risk-action", [actionRef])] });
    const action = runIcarusStressTest(actionInput, [{ type: "Action", actionId: "action-1", state: "Blocked" }], baseline(actionInput));
    expect(action.hypothetical.dependencyHealth.get("Action:action-1")?.health).toBe("Degraded");
    expect(action.delta.newlyExposedAssessments.map((entry) => entry.assessmentId)).toEqual(["risk-action"]);
  });

  it("supports direct health overrides for unknown, watch, degraded, and failed dependency states", () => {
    const input = makeInput({ assessments: [assessment("risk-sop", [{ recordType: "SOP", recordId: "sop-1" }])] });
    const reference = { recordType: "SOP" as const, recordId: "sop-1" };
    const current = baseline(input);
    for (const state of ["Unknown", "Watch", "Degraded", "Failed"] as const) {
      const result = runIcarusStressTest(input, [{ type: "Dependency", reference, state }], current);
      expect(result.hypothetical.dependencyHealth.get("SOP:sop-1")).toMatchObject({
        health: state,
        source: "Scenario override",
        basis: ["scenario-override"],
      });
      expect(result.hypothetical.exposureSnapshot).toEqual([]);
    }
  });

  it("applies control failure, weakness, and restoration only in the hypothetical graph", () => {
    const input = makeInput();
    const current = baseline(input);
    const failed = runIcarusStressTest(input, [{ type: "Control", assessmentId: "risk-1", controlId: "control-1", state: "Failed" }], current);
    expect(failed.hypothetical.failureChains.dependencyGraph.controls[0].barrier).toBe("Failed");
    expect(failed.delta.newlyExposedAssessments).toHaveLength(1);
    expect(current.failureChains.dependencyGraph.controls[0].barrier).toBe("Active");
    const weak = runIcarusStressTest(input, [{ type: "Control", assessmentId: "risk-1", controlId: "control-1", state: "Weak" }], current);
    expect(weak.hypothetical.failureChains.dependencyGraph.controls[0].barrier).toBe("Weak");
  });

  it("treats person unavailability as causal only when a control explicitly depends on the Person", () => {
    const input = makeInput({ assessments: [assessment("person-risk", [personRef])] });
    const current = baseline(input);
    const result = runIcarusStressTest(input, [{ type: "Person", personId: "person-1", state: "Unavailable" }], current);
    expect(result.hypothetical.dependencyHealth.get("Person:person-1")?.health).toBe("Failed");
    expect(result.delta.newlyExposedAssessments.map((entry) => entry.assessmentId)).toEqual(["person-risk"]);

    const ownerOnlyInput = makeInput({
      assessments: [assessment("owner-risk", [])],
      founderDependentWork: [],
    });
    const ownerOnly = runIcarusStressTest(ownerOnlyInput, [{ type: "Person", personId: "founder", state: "Unavailable" }], baseline(ownerOnlyInput));
    expect(ownerOnly.delta.newlyExposedAssessments).toEqual([]);
  });

  it("keeps exposure contained when an independent assured barrier remains", () => {
    const containedAssessment = assessment("contained-risk", [projectRef]);
    const input = makeInput({
      assessments: [{
        ...containedAssessment,
        controls: [
          ...containedAssessment.controls,
          { ...containedAssessment.controls[0], id: "backup-control", intervention: "Independent backup", linkedRecords: [] },
        ],
      }],
    });
    const result = runIcarusStressTest(input, [{ type: "Dependency", reference: projectRef, state: "Failed" }], baseline(input));
    expect(result.delta.newlyExposedAssessments).toEqual([]);
    expect(result.outcome).toBe("Contained");
    expect(result.containment).toContain("No newly exposed assessment chains.");
  });

  it("flags hidden shared dependencies that collapse two apparent protections", () => {
    const sharedAssessment = assessment("shared-risk", [projectRef]);
    const input = makeInput({
      assessments: [{
        ...sharedAssessment,
        controls: [
          ...sharedAssessment.controls,
          { ...sharedAssessment.controls[0], id: "backup-control", intervention: "Second protection" },
        ],
      }],
    });
    const result = runIcarusStressTest(input, [{ type: "Dependency", reference: projectRef, state: "Failed" }], baseline(input));
    expect(result.hiddenSharedDependencies).toMatchObject([
      { dependencyKey: "Project:project-1", controlIds: ["backup-control", "control-1"] },
    ]);
    expect(result.delta.newlyExposedAssessments).toHaveLength(1);
  });

  it("does not propagate from context-only references", () => {
    const input = makeInput({
      assessments: [{
        ...assessment("context-risk", []),
        linkedRecords: [{ recordType: "Project", recordId: "project-1" }],
      }],
    });
    const result = runIcarusStressTest(input, [{ type: "Project", projectId: "project-1", state: "Failed" }], baseline(input));
    expect(result.delta.newlyExposedAssessments).toEqual([]);
    expect(result.hypothetical.failureChains.dependencyGraph.edges.some((edge) =>
      edge.type === "CONCERNS" && edge.to === "Project:project-1")).toBe(true);
  });

  it("canonicalizes two-node scenarios and rejects duplicate targets or more than two overrides", () => {
    const input = makeInput();
    const current = baseline(input);
    const first: IcarusStressOverride = { type: "Dependency", reference: projectRef, state: "Failed" };
    const second: IcarusStressOverride = { type: "Person", personId: "person-1", state: "Unavailable" };
    const left = runIcarusStressTest(input, [first, second], current);
    const right = runIcarusStressTest(input, [second, first], current);
    expect(left.scenarioId).toBe(right.scenarioId);
    expect(left.delta).toEqual(right.delta);
    expect(() => runIcarusStressTest(input, [first, { ...first, state: "Degraded" }], current)).toThrow(/same target twice/);
    expect(() => runIcarusStressTest(input, [
      first,
      { type: "Project", projectId: projectRef.recordId, state: "Blocked" },
    ], current)).toThrow(/same target twice/);
    expect(() => runIcarusStressTest(input, [first, second, { type: "Action", actionId: "action-1", state: "Blocked" }], current))
      .toThrow(/one or two/);
  });

  it("requires an explicit fixed clock or baseline to remain deterministic", () => {
    const input = makeInput({ nowMs: undefined });
    expect(() => runIcarusStressTest(input, [
      { type: "Dependency", reference: projectRef, state: "Failed" },
    ])).toThrow(/fixed clock or baseline/);
  });

  it("does not mutate authoritative inputs or baseline results and provides restoration value", () => {
    const input = makeInput();
    const current = baseline(input);
    const frozenInput = deepFreeze(input);
    const frozenBaseline = deepFreeze(current);
    const result = runIcarusStressTest(frozenInput, [{ type: "Dependency", reference: projectRef, state: "Failed" }], frozenBaseline);
    expect(frozenInput.assessments[0].controls[0].linkedRecords).toEqual([projectRef]);
    expect(frozenBaseline.dependencyHealth.get("Project:project-1")?.health).toBe("Healthy");
    expect(result.hypothetical.exposureSnapshot).toEqual([]);
    expect(result.restorationPriorities).toMatchObject([
      { proposal: "Restore Project project-1 to its baseline state", relievedAssessmentIds: ["risk-1"] },
    ]);
  });

  it("restores the exact baseline state, including completed-project not-applicable health", () => {
    const input = makeInput({
      sourceRecords: makeInput().sourceRecords.map((record) =>
        record.recordType === "Project" ? { ...record, status: "Completed" } : record),
    });
    const current = baseline(input);
    expect(current.dependencyHealth.get("Project:project-1")?.health).toBe("Not applicable");

    const result = runIcarusStressTest(input, [
      { type: "Project", projectId: "project-1", state: "Failed" },
    ], current);

    expect(result.hypothetical.dependencyHealth.get("Project:project-1")?.health).toBe("Failed");
    expect(result.restorationPriorities).toMatchObject([
      { proposal: "Restore Project project-1 to its baseline state", relievedAssessmentIds: ["risk-1"] },
    ]);
  });

  it("returns founder-absence stress and ranked structural candidates without writing history", () => {
    const input = makeInput({
      primaryFounderId: "founder",
      operationalIndependenceWork: [
        { objectType: "Action", id: "ready-action", title: "Routine work", pillar: "Excavation", state: "Ready to delegate" },
        { objectType: "Project", id: "independent-project", state: "Independent" },
      ],
    });
    const current = baseline(input);
    const founder = runIcarusStressTest(input, [{ type: "Person", personId: "founder", state: "Unavailable" }], current);
    expect(founder.founderOnlyWorkAtRisk).toEqual([{ objectType: "Action", id: "founder-only-action" }]);
    expect(founder.transferableWork).toEqual([
      { objectType: "Action", id: "ready-action", title: "Routine work", pillar: "Excavation", state: "Ready to delegate" },
    ]);
    expect(founder.provenance).toBe("Scenario override");
    expect(founder.hypothetical.exposureSnapshot).toEqual([]);
    const recommendations = buildIcarusRecommendedStressScenarios(input, current);
    expect(recommendations.find((scenario) => scenario.title === "Founder unavailable for 30 days"))
      .toMatchObject({ category: "Critical stress" });
    expect(recommendations.length).toBeLessThanOrEqual(8);
  });
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
}
