import { describe, expect, it } from "vitest";
import {
  buildIcarusReview,
  type IcarusAssessmentRecord,
  type IcarusControl,
  type IcarusControlTest,
  type IcarusExposureAcceptance,
  type IcarusSourceRecord,
} from "./icarus";
import {
  buildIcarusFounderFocusRisks,
  buildIcarusStrategicAttention,
  getIcarusCommandPlacement,
  type IcarusStrategicObjectiveContext,
} from "./icarus-strategic-attention";
import {
  attachIcarusAssuranceToSignals,
  buildIcarusAssurance,
  getIcarusNextAssuranceObligation,
  type IcarusAssuranceAction,
  type IcarusAssurancePerson,
} from "./icarus-assurance";

const NOW = Date.parse("2025-04-10T12:00:00.000Z");
const ts = "2025-04-01T12:00:00.000Z";
const DAY = 86400000;
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

const sources: IcarusSourceRecord[] = [
  { recordType: "Pillar", recordId: "Excavation", title: "Excavation" },
  { recordType: "Strategic Objective", recordId: "obj-critical", title: "Critical objective" },
  { recordType: "Strategic Objective", recordId: "obj-medium", title: "Medium objective" },
];

const objectiveContext = (importance: IcarusStrategicObjectiveContext["importance"]): IcarusStrategicObjectiveContext => ({
  area: "Excavation", importance, isLive: true, linkedProjectIds: [], linkedOpportunityIds: [], linkedDecisionIds: [],
});
const objectives = new Map<string, IcarusStrategicObjectiveContext>([
  ["obj-critical", objectiveContext("Critical")],
  ["obj-medium", objectiveContext("Medium")],
]);

const people: IcarusAssurancePerson[] = [
  { id: "owner", status: "Active" },
  { id: "tester", status: "Active" },
  { id: "founder", status: "Active" },
  { id: "former", status: "Inactive" },
];

function test(id: string, result: IcarusControlTest["result"], overrides: Partial<IcarusControlTest> = {}): IcarusControlTest {
  return { id, testedAt: ts, testedByPersonId: "tester", result, evidenceIds: result === "Passed" ? ["e1"] : [], ...overrides };
}

function control(id: string, overrides: Partial<IcarusControl> = {}): IcarusControl {
  return {
    id, failureModeId: "m1", intervention: `Control ${id}`, lifecycle: "Active", effectiveness: "Unknown",
    evidenceIds: [], linkedRecords: [], ownerPersonId: "owner", ...overrides,
  };
}

function acceptance(id: string, overrides: Partial<IcarusExposureAcceptance> = {}): IcarusExposureAcceptance {
  return {
    id, failureModeIds: ["m1"], acceptedByPersonId: "owner", rationale: "Tolerable until replacement plant arrives.",
    acceptedAt: daysAgo(5), reviewBy: "2025-06-01", ...overrides,
  };
}

function assessment(overrides: Partial<IcarusAssessmentRecord> = {}): IcarusAssessmentRecord {
  return {
    id: "a1",
    outcome: "Excavation fleet fails",
    status: "Open",
    createdAt: ts,
    updatedAt: ts,
    linkedRecords: [{ recordType: "Pillar", recordId: "Excavation" }, { recordType: "Strategic Objective", recordId: "obj-medium" }],
    failureModes: [{
      id: "m1",
      mechanism: "Single excavator breakdown",
      vulnerability: "No standby plant",
      evidence: [{
        id: "e1", statement: "Breakdown observed.", origin: "Direct observation", observedAt: "2025-04-01",
        recordedAt: ts, recordedBy: "Founder", review: "Supports", reviewedAt: ts, reviewedBy: "Founder",
      }],
    }],
    controls: [],
    accountableOwnerPersonId: "owner",
    ...overrides,
  };
}

function run(
  assessments: IcarusAssessmentRecord[],
  options: { actions?: IcarusAssuranceAction[]; founderDependencyActive?: boolean; nowMs?: number } = {},
) {
  const nowMs = options.nowMs ?? NOW;
  const reviews = buildIcarusReview(assessments, sources, nowMs);
  const signals = buildIcarusStrategicAttention({ assessments, reviews, strategicObjectives: objectives });
  const result = buildIcarusAssurance({
    assessments, reviews, signals, people, actions: options.actions ?? [],
    primaryFounderId: "founder", founderDependencyActive: options.founderDependencyActive ?? false,
    strategicObjectives: objectives, nowMs,
  });
  return { signals, result, assured: attachIcarusAssuranceToSignals(signals, result), entry: result.assessments[0] };
}

const categories = (entry: { obligations: { category: string }[] }) => entry.obligations.map((obligation) => obligation.category);

describe("risk ownership", () => {
  it("derives a material governance gap for a legacy assessment with no owner", () => {
    const { entry } = run([assessment({ accountableOwnerPersonId: undefined })]);
    expect(entry.ownership).toBe("Unassigned");
    const gap = entry.obligations.find((obligation) => obligation.category === "no-risk-owner")!;
    expect(gap).toMatchObject({ kind: "Governance gap", materiality: "Material", escalates: true, ownerSource: "None" });
    expect(entry.escalation).toBe("Governance gap");
  });

  it("distinguishes unknown and inactive owners from assigned ones", () => {
    expect(run([assessment({ accountableOwnerPersonId: "ghost" })]).entry.ownership).toBe("Unknown person");
    expect(run([assessment({ accountableOwnerPersonId: "former" })]).entry.ownership).toBe("Inactive person");
    const assigned = run([assessment()]).entry;
    expect(assigned.ownership).toBe("Assigned");
    expect(categories(assigned)).not.toContain("no-risk-owner");
  });

  it("flags founder ownership only while founder dependency is active", () => {
    const quiet = run([assessment({ accountableOwnerPersonId: "founder" })]).entry;
    expect(quiet.founderOwned).toBe(true);
    expect(quiet.founderOwnershipConcern).toBe(false);
    expect(categories(quiet)).not.toContain("founder-owner-dependency");
    const busy = run([assessment({ accountableOwnerPersonId: "founder" })], { founderDependencyActive: true }).entry;
    expect(busy.founderOwnershipConcern).toBe(true);
    expect(categories(busy)).toContain("founder-owner-dependency");
  });
});

describe("control assurance", () => {
  it("treats an evidenced mechanism with no control as a weak, treatment-needed risk — not an assurance failure", () => {
    const { entry } = run([assessment()]);
    expect(entry.state).toBe("Weak");
    expect(entry.basis).toContain("evidenced-uncontrolled-mechanism");
    const noControl = entry.obligations.find((obligation) => obligation.category === "no-control")!;
    expect(noControl).toMatchObject({ kind: "Risk treatment", escalates: false, evidenceIds: ["e1"], failureModeId: "m1" });
    expect(entry.escalation).toBe("None");
  });

  it("classifies a passed, evidenced test as assured and drops materiality", () => {
    const { entry, signals } = run([assessment({ controls: [control("c1", { assuranceTests: [test("t1", "Passed")] })] })]);
    expect(signals).toHaveLength(0);
    expect(entry.material).toBe(false);
    expect(entry.controls[0]).toMatchObject({ status: "Assured", evidence: "Current support", everTested: true });
    expect(entry.modes[0]).toMatchObject({ assurance: "Assured", depth: "Single control", independence: "Unknown" });
    expect(entry.state).toBe("Assured");
    expect(entry.obligations.every((obligation) => obligation.materiality === "Hygiene" && !obligation.escalates)).toBe(true);
  });

  it("treats a failed test as an assurance failure with remediation required", () => {
    const { entry, assured } = run([assessment({ controls: [control("c1", { assuranceTests: [test("t1", "Failed")] })] })]);
    expect(entry.controls[0].status).toBe("Failed");
    expect(entry.modes[0]).toMatchObject({ assurance: "Failing", failedControlIds: ["c1"] });
    expect(entry.state).toBe("Weak");
    expect(entry.escalation).toBe("Assurance failure");
    expect(getIcarusNextAssuranceObligation(entry)).toMatchObject({
      category: "failing-control-remediation", controlId: "c1", ownerSource: "Control owner", ownerPersonId: "owner", remediation: "None",
    });
    expect(assured[0].assurance?.failedControlIds).toEqual(["c1"]);
  });

  it("a newer passing test supersedes an older failure", () => {
    const { entry } = run([assessment({
      controls: [control("c1", { assuranceTests: [test("t1", "Failed", { testedAt: daysAgo(20) }), test("t2", "Passed", { testedAt: daysAgo(2) })] })],
    })]);
    expect(entry.controls[0].status).toBe("Assured");
    expect(entry.controls[0].lastEvent?.testId).toBe("t2");
  });

  it("flags never-tested, inconclusive and unsupported controls without calling them failures", () => {
    const never = run([assessment({ controls: [control("c1")] })]).entry;
    expect(never.controls[0].status).toBe("Untested");
    expect(categories(never)).toContain("control-never-tested");
    const inconclusive = run([assessment({ controls: [control("c1", { assuranceTests: [test("t1", "Inconclusive")] })] })]).entry;
    expect(inconclusive.controls[0].status).toBe("Inconclusive");
    expect(categories(inconclusive)).toContain("control-evidence-insufficient");
    const unsupported = run([assessment({ controls: [control("c1", { assuranceTests: [test("t1", "Passed", { evidenceIds: [] })] })] })]).entry;
    expect(unsupported.controls[0].status).toBe("Evidence insufficient");
    expect(unsupported.controls[0].evidence).toBe("No current support");
    [never, inconclusive, unsupported].forEach((entry) => expect(entry.escalation).not.toBe("Assurance failure"));
  });

  it("detects overdue tests from cadence", () => {
    const { entry } = run([assessment({
      controls: [control("c1", { testCadenceDays: 7, assuranceTests: [test("t1", "Passed", { testedAt: daysAgo(30) })] })],
    })]);
    expect(entry.controls[0].status).toBe("Test overdue");
    expect(entry.controls[0].nextDueAt).toBe(new Date(Date.parse(daysAgo(30)) + 7 * DAY).toISOString());
    const overdue = entry.obligations.find((obligation) => obligation.category === "control-test-overdue")!;
    expect(overdue).toMatchObject({ kind: "Assurance failure", dueState: "Overdue" });
  });

  it("flags unowned controls and ignores retired/planned controls", () => {
    const unowned = run([assessment({ controls: [control("c1", { ownerPersonId: undefined })] })]).entry;
    expect(categories(unowned)).toContain("control-without-owner");
    const retired = run([assessment({ controls: [control("c1", { lifecycle: "Retired", ownerPersonId: undefined })] })]).entry;
    expect(retired.controls[0].status).toBe("Not operating");
    expect(categories(retired)).not.toContain("control-without-owner");
  });

  it("reads legacy effectiveness reviews as assurance events", () => {
    const { entry } = run([assessment({
      controls: [control("c1", { effectiveness: "Weak", effectivenessReviewedAt: ts, effectivenessReviewedBy: "Founder" })],
    })]);
    expect(entry.controls[0].lastEvent).toMatchObject({ source: "Effectiveness review", result: "Failed" });
    expect(entry.controls[0].status).toBe("Failed");
  });
});

describe("assurance depth", () => {
  const critical = { linkedRecords: [{ recordType: "Pillar" as const, recordId: "Excavation" }, { recordType: "Strategic Objective" as const, recordId: "obj-critical" }] };

  it("flags single-control dependency on Critical objectives and clears it with layered controls", () => {
    const single = run([assessment({ ...critical, reviewedAt: ts, reviewedByPersonId: "owner", controls: [control("c1", { assuranceTests: [test("t1", "Passed")] })] })]).entry;
    expect(single.modes[0].depth).toBe("Single control");
    expect(categories(single)).toContain("single-control-dependency");
    const layered = run([assessment({
      ...critical, reviewedAt: ts, reviewedByPersonId: "owner",
      controls: [control("c1", { assuranceTests: [test("t1", "Passed")] }), control("c2", { assuranceTests: [test("t2", "Passed")] })],
    })]).entry;
    expect(layered.modes[0].depth).toBe("Layered");
    expect(layered.modes[0].independence).toBe("Unknown");
    expect(categories(layered)).not.toContain("single-control-dependency");
  });

  it("requires periodic review for Critical/High objective risks", () => {
    const unreviewed = run([assessment(critical)]).entry;
    expect(unreviewed.obligations.find((obligation) => obligation.category === "risk-review-due")).toMatchObject({ dueState: "Due" });
    expect(categories(run([assessment({ ...critical, reviewedAt: daysAgo(10), reviewedByPersonId: "owner" })]).entry)).not.toContain("risk-review-due");
    const lapsed = run([assessment({ ...critical, reviewedAt: daysAgo(10), reviewedByPersonId: "owner", nextReviewBy: "2025-04-05" })]).entry;
    expect(lapsed.obligations.find((obligation) => obligation.category === "risk-review-due")).toMatchObject({ dueState: "Overdue" });
    expect(categories(run([assessment()]).entry)).not.toContain("risk-review-due");
  });
});

describe("accepted exposure", () => {
  it("records an active acceptance without silencing Command or Founder Focus", () => {
    const base = run([assessment()]);
    const accepted = run([assessment({ acceptances: [acceptance("x1")] })]);
    expect(accepted.entry.state).toBe("Accepted exposure");
    expect(accepted.entry.modes[0].acceptanceId).toBe("x1");
    expect(categories(accepted.entry)).not.toContain("no-control");
    expect(accepted.signals).toHaveLength(1);
    expect(accepted.signals[0].exposure).toBe(base.signals[0].exposure);
    const before = getIcarusCommandPlacement(base.assured[0]);
    const after = getIcarusCommandPlacement(accepted.assured[0]);
    expect(after.attentionRank).toBe(before.attentionRank);
    expect(after.reasons).toContain("ACCEPTED EXPOSURE");
    const focus = buildIcarusFounderFocusRisks(accepted.assured);
    expect(focus).toHaveLength(1);
    expect(focus[0].reason).toContain("formally accepted");
  });

  it("escalates expired acceptance as an assurance failure", () => {
    const { entry } = run([assessment({ acceptances: [acceptance("x1", { acceptedAt: daysAgo(60), reviewBy: "2025-04-01" })] })]);
    expect(entry.acceptances[0].validity).toBe("Expired");
    expect(entry.modes[0].acceptanceId).toBeUndefined();
    expect(entry.obligations.find((obligation) => obligation.category === "acceptance-expired")).toMatchObject({
      kind: "Assurance failure", escalates: true, ownerSource: "Approver", ownerPersonId: "owner", dueState: "Overdue",
    });
    expect(entry.escalation).toBe("Assurance failure");
  });

  it("refuses to count invalid or revoked acceptance", () => {
    const invalid = run([assessment({ acceptances: [acceptance("x1", { acceptedByPersonId: "former" })] })]).entry;
    expect(invalid.acceptances[0]).toMatchObject({ validity: "Invalid", invalidReasons: ["approver-not-active-person"] });
    expect(invalid.modes[0].assurance).toBe("Failing");
    expect(categories(invalid)).toContain("acceptance-invalid");
    const revoked = run([assessment({ acceptances: [acceptance("x1", { revokedAt: ts })] })]).entry;
    expect(revoked.acceptances[0].validity).toBe("Revoked");
    expect(revoked.modes[0].acceptanceId).toBeUndefined();
    expect(revoked.signal.acceptance).toBe("Revoked");
  });

  it("treats the newest acceptance per failure mode as current", () => {
    const { entry } = run([assessment({
      acceptances: [
        acceptance("old", { acceptedAt: daysAgo(80), reviewBy: "2025-03-01" }),
        acceptance("new", { acceptedAt: daysAgo(2) }),
      ],
    })]);
    expect(entry.acceptances.map((entry) => [entry.acceptanceId, entry.current, entry.validity])).toEqual([
      ["new", true, "Active"],
      ["old", false, "Expired"],
    ]);
    expect(categories(entry)).not.toContain("acceptance-expired");
  });

  it("does not escalate a failing control whose exposure is validly accepted, but keeps it visible", () => {
    const { entry } = run([assessment({
      controls: [control("c1", { assuranceTests: [test("t1", "Failed")] })],
      acceptances: [acceptance("x1")],
    })]);
    const remediation = entry.obligations.find((obligation) => obligation.category === "failing-control-remediation")!;
    expect(remediation.escalates).toBe(false);
    expect(entry.escalation).not.toBe("Assurance failure");
  });
});

describe("remediation via existing Actions", () => {
  const failing = (links: IcarusAssessmentRecord["assuranceActionLinks"]) => assessment({
    controls: [control("c1", { assuranceTests: [test("t1", "Failed")] })],
    assuranceActionLinks: links,
  });
  const obligationId = "icarus-obligation:a1:failing-control-remediation:c1";

  it("uses stable obligation ids and links to existing Actions only by reference", () => {
    const { entry } = run([failing([])]);
    expect(entry.obligations[0].id).toBe(obligationId);
  });

  it("suppresses escalation while remediation is in progress and restores it when blocked", () => {
    const progressing = run([failing([{ obligationId, actionId: "act-1", linkedAt: ts }])], {
      actions: [{ id: "act-1", status: "In Progress", dueDate: "2025-05-01" }],
    }).entry;
    const remediation = progressing.obligations.find((obligation) => obligation.id === obligationId)!;
    expect(remediation).toMatchObject({ remediation: "In progress", actionIds: ["act-1"], escalates: false, dueState: "Scheduled" });
    const blocked = run([failing([{ obligationId, actionId: "act-1", linkedAt: ts }])], {
      actions: [{ id: "act-1", status: "Blocked" }],
    }).entry;
    expect(blocked.obligations.find((obligation) => obligation.id === obligationId)).toMatchObject({ remediation: "Blocked", escalates: true });
    expect(blocked.escalation).toBe("Assurance failure");
  });

  it("reports overdue, missing and completed remediation without discharging the failure", () => {
    const overdue = run([failing([{ obligationId, actionId: "act-1", linkedAt: ts }])], { actions: [{ id: "act-1", status: "Open", dueDate: "2025-04-01" }] }).entry;
    expect(overdue.obligations.find((obligation) => obligation.id === obligationId)?.remediation).toBe("Overdue");
    const missing = run([failing([{ obligationId, actionId: "gone", linkedAt: ts }])]).entry;
    expect(missing.obligations.find((obligation) => obligation.id === obligationId)?.remediation).toBe("Missing action");
    const completed = run([failing([{ obligationId, actionId: "act-1", linkedAt: ts }])], { actions: [{ id: "act-1", status: "Completed" }] }).entry;
    const done = completed.obligations.find((obligation) => obligation.id === obligationId)!;
    expect(done.remediation).toBe("Completed");
    expect(completed.controls[0].status).toBe("Failed");
  });
});

describe("assurance integration with attention", () => {
  it("never changes exposure, materiality, risk score or keys", () => {
    const { signals, assured } = run([assessment({ accountableOwnerPersonId: undefined, controls: [control("c1", { assuranceTests: [test("t1", "Failed")] })] })]);
    expect(assured).toHaveLength(signals.length);
    assured.forEach((signal, index) => {
      const { assurance, ...rest } = signal;
      expect(assurance).toBeDefined();
      expect(rest).toEqual(signals[index]);
    });
  });

  it("lifts an assurance failure by one Command rank and labels it separately in Founder Focus", () => {
    const { signals, assured } = run([assessment({
      // Unverified control with an overdue review: base rank 5, band 4.
      controls: [control("c1", { testCadenceDays: 7, assuranceTests: [test("t1", "Passed", { testedAt: daysAgo(30) })] })],
    })]);
    expect(assured[0].assurance?.escalation).toBe("Assurance failure");
    const base = getIcarusCommandPlacement(signals[0]);
    const lifted = getIcarusCommandPlacement(assured[0]);
    expect(lifted.attentionRank).toBe(Math.max(3, base.attentionRank - 1));
    expect(lifted.reasons).toContain("ASSURANCE: CONTROL TEST OVERDUE");
    expect(lifted.statusText).toContain("Assurance: ");
    const [risk] = buildIcarusFounderFocusRisks(assured);
    expect(risk.reason.startsWith("Icarus assurance failure")).toBe(true);
    const [plain] = buildIcarusFounderFocusRisks(signals);
    expect(plain.reason.startsWith("Icarus strategic risk")).toBe(true);
  });

  it("governance gaps add reasons but never move placement", () => {
    const { signals, assured } = run([assessment({ accountableOwnerPersonId: undefined })]);
    expect(assured[0].assurance?.escalation).toBe("Governance gap");
    expect(getIcarusCommandPlacement(assured[0]).attentionRank).toBe(getIcarusCommandPlacement(signals[0]).attentionRank);
    expect(getIcarusCommandPlacement(assured[0]).reasons).toContain("GOVERNANCE: NO RISK OWNER");
    expect(buildIcarusFounderFocusRisks(assured)[0].reason).toContain("Governance gap: no accountable risk owner");
  });
});

describe("determinism and scope", () => {
  it("excludes Closed assessments", () => {
    expect(run([assessment({ status: "Closed" })]).result.assessments).toHaveLength(0);
  });

  it("is deterministic and independent of assessment order", () => {
    const one = assessment({ id: "a1", accountableOwnerPersonId: undefined, controls: [control("c1", { ownerPersonId: undefined })] });
    const two = assessment({ id: "a2", controls: [control("c2", { assuranceTests: [test("t2", "Failed")] })] });
    const forward = run([one, two]).result;
    const reverse = run([two, one]).result;
    expect(run([one, two]).result.obligations).toEqual(forward.obligations);
    const byId = (result: typeof forward) => [...result.assessments].sort((left, right) => left.assessmentId.localeCompare(right.assessmentId));
    expect(byId(reverse)).toEqual(byId(forward));
    const ids = forward.obligations.map((obligation) => obligation.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves operating pillars canonically from pillar links and objective areas", () => {
    expect(run([assessment()]).entry.operatingPillarIds).toEqual(["excavation"]);
    expect(run([assessment({ linkedRecords: [] })]).entry.operatingPillarIds).toEqual([]);
  });
});
