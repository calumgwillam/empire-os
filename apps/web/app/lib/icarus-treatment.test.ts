import { describe, expect, it } from "vitest";
import {
  assertIcarusDataStructure,
  getIcarusTreatmentOutcomeId,
  normaliseIcarusAssessmentData,
  type IcarusAssessmentRecord,
} from "./icarus";
import type { IcarusAssuranceObligation } from "./icarus-assurance";
import type { IcarusResilienceIntervention } from "./icarus-dependency-resilience";
import {
  buildIcarusTreatmentIndex,
  createIcarusResilienceTreatmentTarget,
  createIcarusStressTreatmentTarget,
  getIcarusAssuranceTreatmentTargetId,
  getIcarusTreatmentTargetId,
  type IcarusTreatmentExecution,
} from "./icarus-treatment";

const assessmentId = "risk-1";
const nowMs = Date.parse("2026-05-20T12:00:00.000Z");

function assessment(overrides: Partial<IcarusAssessmentRecord> = {}): IcarusAssessmentRecord {
  return {
    id: assessmentId,
    outcome: "Critical service failure",
    status: "Open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    linkedRecords: [],
    failureModes: [],
    controls: [],
    ...overrides,
  };
}

function obligation(overrides: Partial<IcarusAssuranceObligation> = {}): IcarusAssuranceObligation {
  return {
    id: "obligation-1",
    category: "no-risk-owner",
    kind: "Governance gap",
    label: "Risk owner missing",
    assessmentId,
    failureModeId: "mode-1",
    evidenceIds: [],
    reason: "A material risk has no accountable owner.",
    materiality: "Material",
    dueState: "No date",
    ownerSource: "None",
    remediation: "None",
    actionIds: [],
    escalates: true,
    reference: { identityKey: "risk-1", assessmentId, failureModeId: "mode-1" },
    ...overrides,
  };
}

function index(
  records: readonly IcarusAssessmentRecord[],
  obligations: readonly IcarusAssuranceObligation[],
  actions: readonly IcarusTreatmentExecution[] = [],
  projects: readonly IcarusTreatmentExecution[] = [],
) {
  return buildIcarusTreatmentIndex({
    assessments: records,
    assurance: { byAssessmentId: new Map(), obligations },
    resilience: [],
    recommendations: [],
    barrierRestorations: [],
    dependencyHealth: new Map(),
    actions,
    projects,
    founderPersonId: "founder-1",
    nowMs,
  });
}

const action = (
  status: string,
  overrides: Partial<IcarusTreatmentExecution> = {},
): IcarusTreatmentExecution => ({
  recordType: "Action",
  recordId: "action-1",
  title: "Restore operating control",
  status,
  owner: "Founder",
  ownerPersonId: "founder-1",
  dueDate: "2026-06-01",
  ...overrides,
});

describe("Icarus treatment routing", () => {
  it("derives resolution eligibility conservatively without closing or accepting exposure", () => {
    const makeIndex = (
      record: IcarusAssessmentRecord,
      acceptances: readonly { current: boolean; validity: "Active" | "Expired" | "Invalid" | "Revoked" }[] = [],
      modes: readonly {
        failureModeId: string;
        material: boolean;
        assurance: "Failing" | "Unassured" | "Accepted" | "Partially assured" | "Assured";
      }[] = [],
    ) => buildIcarusTreatmentIndex({
      assessments: [record],
      assurance: {
        byAssessmentId: new Map([[assessmentId, {
          assessmentId,
          objectiveIds: [],
          operatingPillarIds: [],
          controls: [],
          modes,
          acceptances,
        }]]),
        obligations: [],
      },
      resilience: [],
      recommendations: [],
      barrierRestorations: [],
      dependencyHealth: new Map(),
      actions: [],
      projects: [],
      founderPersonId: null,
      nowMs,
    });

    expect(makeIndex(assessment()).summaries.get(assessmentId)?.resolutionEligibility).toBe("Eligible");
    expect(makeIndex(assessment(), [], [{
      failureModeId: "mode-1",
      material: true,
      assurance: "Assured",
    }]).summaries.get(assessmentId)?.resolutionEligibility).toBe("Not eligible");
    expect(makeIndex(assessment(), [{ current: true, validity: "Active" }]).summaries.get(assessmentId)?.resolutionEligibility)
      .toBe("Not eligible");
    expect(makeIndex(assessment({ status: "Closed" })).summaries.get(assessmentId)?.resolutionEligibility).toBe("Unknown");
  });

  it("uses deterministic source-kind-scoped identities without collisions", () => {
    expect(getIcarusTreatmentTargetId("Source A", "id:1")).toBe(getIcarusTreatmentTargetId("Source A", "id:1"));
    expect(getIcarusTreatmentTargetId("Source A", "id:1")).not.toBe(getIcarusTreatmentTargetId("Source B", "id:1"));
    expect(getIcarusAssuranceTreatmentTargetId("obligation-1")).toBe(
      getIcarusTreatmentTargetId("Assurance obligation", "obligation-1"),
    );
  });

  it("derives material obligations as unrouted and preserves legacy Action links without duplicates", () => {
    const unrouted = index([assessment()], [obligation()]);
    expect(unrouted.targets[0].state).toBe("Unrouted");
    expect(unrouted.summaries.get(assessmentId)?.unroutedCount).toBe(1);

    const legacy = {
      obligationId: "obligation-1",
      actionId: "action-1",
      linkedAt: "2026-05-01T00:00:00.000Z",
    };
    const result = index(
      [assessment({ assuranceActionLinks: [legacy, legacy] })],
      [obligation({ actionIds: ["action-1", "action-1"] })],
      [action("In Progress")],
    );
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].executionLinks).toHaveLength(1);
    expect(result.targets[0].state).toBe("In progress");
    expect(result.targets[0].sourceId).toBe("obligation-1");
  });

  it("reports stale legacy links instead of dropping them", () => {
    const result = index(
      [assessment({
        assuranceActionLinks: [{ obligationId: "obligation-1", actionId: "deleted-action", linkedAt: "2026-05-01" }],
      })],
      [obligation({ actionIds: ["deleted-action"] })],
    );
    expect(result.targets[0].state).toBe("Missing execution record");
    expect(result.targets[0].executionLinks[0].recordId).toBe("deleted-action");
  });

  it.each([
    ["Open", "Scheduled"],
    ["In Progress", "In progress"],
    ["Blocked", "Blocked"],
    ["Completed", "Completed — verification required"],
  ] as const)("derives Action status %s as %s without treating completion as resolution", (status, expected) => {
    const result = index([assessment()], [obligation({ actionIds: ["action-1"] })], [action(status)]);
    expect(result.targets[0].state).toBe(expected);
    expect(result.targets[0]).not.toHaveProperty("resolved");
  });

  it("prioritizes overdue execution and exposes missing stable ownership", () => {
    const overdue = index(
      [assessment()],
      [obligation({ actionIds: ["action-1"] })],
      [action("In Progress", { dueDate: "2026-05-01" })],
    );
    expect(overdue.targets[0].state).toBe("Overdue");

    const unowned = index(
      [assessment()],
      [obligation({ actionIds: ["action-1"] })],
      [action("In Progress", { owner: "" , ownerPersonId: undefined })],
    );
    expect(unowned.targets[0].state).toBe("Unowned");
    expect(unowned.targets[0].founderOwned).toBe(false);
  });

  it("does not report completion while any linked execution record is still active", () => {
    const result = index(
      [assessment()],
      [obligation({ actionIds: ["action-1", "action-2"] })],
      [
        action("Completed"),
        action("In Progress", { recordId: "action-2", title: "Finish remaining work" }),
      ],
    );
    expect(result.targets[0].state).toBe("In progress");
  });

  it("derives Project execution state and current owner data from the authoritative record", () => {
    const project: IcarusTreatmentExecution = {
      recordType: "Project",
      recordId: "project-1",
      title: "Independent backup",
      status: "In Progress",
      owner: "Operations",
      blocked: true,
      dueDate: "2026-06-15",
    };
    const storedTarget = {
      id: getIcarusAssuranceTreatmentTargetId("obligation-1"),
      sourceKind: "Assurance obligation" as const,
      sourceId: "obligation-1",
      assessmentId,
      failureModeId: "mode-1",
      treatmentKind: "Risk treatment",
      reason: "Protect the critical service.",
      basis: ["Material"],
      affectedAssessmentIds: [assessmentId],
      objectiveIds: [],
      pillarIds: [],
      provenance: { kind: "Assurance obligation" as const, finding: "Required control" },
      executionLinks: [{ recordType: "Project" as const, recordId: "project-1", linkedAt: "2026-05-01" }],
      promotedAt: "2026-05-01T00:00:00.000Z",
    };
    const result = index(
      [assessment({ treatmentTargets: [storedTarget] })],
      [obligation()],
      [],
      [project],
    );
    expect(result.targets[0].state).toBe("Blocked");
    expect(result.targets[0].executions[0].owner).toBe("Operations");
  });

  it("flags founder-owned work without treating delegated ownership as founder-only", () => {
    const founder = index([assessment()], [obligation({ actionIds: ["action-1"] })], [action("In Progress")]);
    expect(founder.summaries.get(assessmentId)?.founderOwnedCount).toBe(1);
    const delegated = index(
      [assessment()],
      [obligation({ actionIds: ["action-1"] })],
      [action("In Progress", { owner: "Operator", ownerPersonId: "person-2" })],
    );
    expect(delegated.summaries.get(assessmentId)?.founderOwnedCount).toBe(0);
    expect(delegated.summaries.get(assessmentId)?.delegatedCount).toBe(1);
  });

  it("leaves resilience recommendations unpromoted until explicit target creation", () => {
    const intervention: IcarusResilienceIntervention = {
      reference: { recordType: "Project", recordId: "project-1" },
      kind: "Add independent backup",
      resilience: "Critical dependency",
      concentration: "Cross-pillar",
      basis: ["single-required-path"],
      assessmentIds: [assessmentId],
      objectiveIds: ["objective-1"],
      pillarIds: ["Garden Maintenance"],
    };
    const result = index([assessment()], []);
    expect(result.targets).toHaveLength(0);
    const promoted = createIcarusResilienceTreatmentTarget(intervention, "2026-05-20T00:00:00.000Z");
    expect(promoted?.sourceKind).toBe("Dependency / resilience intervention");
    expect(promoted?.provenance.kind).toBe("Dependency / resilience recommendation");
    expect(promoted?.executionLinks).toEqual([]);
  });

  it("creates stress treatment only through explicit promotion and stores no hypothetical overrides", () => {
    const target = createIcarusStressTreatmentTarget(
      assessmentId,
      "Stress testing exposed the assessment under a hypothetical scenario.",
      [assessmentId, "risk-2"],
      ["mode-1"],
      "2026-05-20T00:00:00.000Z",
    );
    expect(target.provenance.kind).toBe("Stress discovery");
    expect(target.affectedAssessmentIds).toEqual(["risk-1", "risk-2"]);
    expect(target).not.toHaveProperty("overrides");
    expect(index([assessment()], []).targets).toEqual([]);
  });

  it("keeps legacy stored assessments readable and validates promoted target records", () => {
    const legacy = assessment({
      assuranceActionLinks: [{ obligationId: "obligation-1", actionId: "action-1", linkedAt: "2026-05-01" }],
    });
    expect(() => assertIcarusDataStructure([legacy])).not.toThrow();

    const promoted = createIcarusStressTreatmentTarget(
      assessmentId,
      "A structural finding was promoted.",
      [assessmentId],
      ["mode-1"],
      "2026-05-20T00:00:00.000Z",
    );
    expect(() => assertIcarusDataStructure([assessment({ treatmentTargets: [promoted] })])).not.toThrow();

    const malformed = normaliseIcarusAssessmentData([{ ...assessment(), treatmentTargets: [{ id: "bad" }] }]);
    expect(malformed).toEqual([assessment({ treatmentTargets: [] })]);
  });

  it("preserves valid verified outcomes, rejects altered event identities, and deduplicates legacy copies", () => {
    const evidence = [{
      kind: "Control test" as const,
      assessmentId,
      failureModeId: "mode-1",
      controlId: "control-1",
      testId: "test-1",
      result: "Passed" as const,
      assuranceStatus: "Assured" as const,
      evidenceStatus: "Current support" as const,
      evidenceIds: ["evidence-1"],
    }];
    const outcome = {
      id: getIcarusTreatmentOutcomeId("target-1", "person-1", evidence),
      treatmentTargetId: "target-1",
      assessmentId,
      executionLinks: [{ recordType: "Action" as const, recordId: "action-1", linkedAt: "2026-05-01T00:00:00.000Z" }],
      outcome: "Effective" as const,
      verifiedAt: "2026-05-02T00:00:00.000Z",
      verifiedByPersonId: "person-1",
      evidence,
      afterState: { kind: "Control assurance" as const, state: "Assured" as const },
      verificationNote: "Current control test passed.",
    };
    const valid = assessment({ treatmentOutcomes: [outcome] });
    expect(() => assertIcarusDataStructure([valid])).not.toThrow();
    expect(normaliseIcarusAssessmentData([{
      ...valid,
      treatmentOutcomes: [outcome, outcome, { ...outcome, id: "altered" }],
    }])).toEqual([valid]);
  });
});
