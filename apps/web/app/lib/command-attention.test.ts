import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";
import { buildOrganisationalLearning, type OrganisationalLearningInput } from "./organisational-learning";
import type { LearningAttentionInput } from "./learning-attention";
import {
  buildIcarusReview,
  type IcarusAssessmentRecord,
  type IcarusRecordReference,
  type IcarusTreatmentOutcomeRecord,
} from "./icarus";
import { buildIcarusStrategicAttention, type IcarusStrategicSignal } from "./icarus-strategic-attention";
import { resolveStrategicRiskConvergence } from "./strategic-risk-resolution";
import { buildIcarusInterventionIndex } from "./icarus-intervention-decision";
import type { IcarusTreatmentTarget } from "./icarus-treatment";
import {
  buildCommandAttention,
  compareAttentionItems,
  getActionPriorityScore,
  getDecisionPriorityScore,
  getLessonPriorityScore,
  getOpportunityPriorityScore,
  getProblemPriorityScore,
  getSopPriorityScore,
  getSystemPriorityScore,
  orderAttentionReasons,
  resolveCommandStrategicRiskConvergence,
  type CommandAttentionInput,
  type CommandAttentionItem,
} from "./command-attention";

const NOW = new Date(2025, 3, 10, 12, 0, 0, 0).getTime();
const iso = (offsetMs = 0) => new Date(NOW + offsetMs).toISOString();
const day = (offsetDays: number) => {
  const value = new Date(NOW);
  value.setDate(value.getDate() + offsetDays);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

type Problem = CommandAttentionInput["problems"][number];
type Action = CommandAttentionInput["actions"][number];
type Outreach = CommandAttentionInput["outreach"][number];
type Project = CommandAttentionInput["projects"][number];
type Decision = CommandAttentionInput["decisions"][number];
type Opportunity = CommandAttentionInput["opportunities"][number];
type Lesson = CommandAttentionInput["lessons"][number];
type System = CommandAttentionInput["systems"][number];
type Sop = CommandAttentionInput["sops"][number];
type Handoff = CommandAttentionInput["handoffs"][number];
type Procurement = CommandAttentionInput["procurementQueue"][number];

const problem = (overrides: Partial<Problem> = {}): Problem => ({
  id: "problem-1",
  severity: "Low",
  frequency: "One-off",
  problemStatus: "Open",
  problemStatement: "Problem statement",
  title: "Problem title",
  owner: "Owner",
  createdAt: iso(-30 * 86400000),
  relatedArea: "",
  relatedPillar: "Operations",
  ...overrides,
});

const action = (overrides: Partial<Action> = {}): Action => ({
  id: "action-1",
  status: "Open",
  priority: "Low",
  dueDate: "",
  followUpDate: "",
  followUpNote: "",
  createdDate: iso(-30 * 86400000),
  createdAt: iso(-30 * 86400000),
  actionTitle: "Action title",
  title: "Action title",
  relatedPillar: "Operations",
  relatedArea: "",
  relatedProblem: "",
  relatedDecision: "",
  ...overrides,
});

const outreach = (overrides: Partial<Outreach> = {}): Outreach => ({
  id: "outreach-1",
  businessName: "Outreach business",
  status: "Follow-Up Due",
  nextFollowUpDate: day(0),
  ...overrides,
});

const project = (overrides: Partial<Project> = {}): Project => ({
  id: "project-1",
  projectName: "Project title",
  area: "Operations",
  status: "in progress",
  health: undefined,
  nextReviewDate: "",
  reviewNote: "",
  targetCompletionDate: "",
  startDate: "",
  ...overrides,
});

const decision = (overrides: Partial<Decision> = {}): Decision => ({
  id: "decision-1",
  decisionTitle: "Decision title",
  title: "Decision title",
  decisionStatus: "Active",
  reviewDate: "",
  createdAt: iso(-30 * 86400000),
  relatedArea: "",
  relatedPillar: "Operations",
  ...overrides,
});

const opportunity = (overrides: Partial<Opportunity> = {}): Opportunity => ({
  id: "opportunity-1",
  opportunityTitle: "Opportunity title",
  title: "Opportunity title",
  status: "Evaluating",
  strategicFit: "High",
  dateIdentified: "",
  createdAt: iso(-30 * 86400000),
  relatedArea: "",
  relatedPillar: "Growth",
  ...overrides,
});

const lesson = (overrides: Partial<Lesson> = {}): Lesson => ({
  id: "lesson-1",
  lessonTitle: "Lesson title",
  title: "Lesson title",
  status: "New",
  dateLearned: "",
  createdAt: iso(-30 * 86400000),
  relatedArea: "",
  relatedPillar: "Operations",
  ...overrides,
});

const system = (overrides: Partial<System> = {}): System => ({
  id: "system-1",
  systemName: "System name",
  title: "System title",
  status: "Draft",
  lastReviewed: "",
  createdAt: iso(-30 * 86400000),
  relatedArea: "",
  relatedPillar: "Operations",
  ...overrides,
});

const sop = (overrides: Partial<Sop> = {}): Sop => ({
  id: "sop-1",
  sopTitle: "SOP title",
  title: "SOP title",
  status: "Active",
  reviewDate: "",
  createdAt: iso(-30 * 86400000),
  relatedArea: "",
  relatedPillar: "Operations",
  ...overrides,
});

const handoff = (overrides: Partial<Handoff> = {}): Handoff => ({
  objectType: "Lead",
  objectId: "lead-1",
  title: "Delegated lead",
  newOwner: "Operator",
  newOwnerPersonId: "operator-1",
  transferredAt: iso(-5 * 86400000),
  reviewDate: "",
  reviewState: "Intervention required",
  reviewReasons: ["Delivery is blocked."],
  area: "Growth",
  ...overrides,
});

const procurement = (overrides: Partial<Procurement> = {}): Procurement => ({
  commitment: {
    id: "commitment-1",
    commitmentName: "Supplier purchase",
    expectedPurchaseDate: day(2),
    dueDate: day(2),
    dateCreated: iso(-10 * 86400000),
    relatedPillar: "Operations",
  },
  effectiveCertainty: "Planned",
  approvalStatus: "Approved",
  readinessState: "Blocked",
  readinessReason: "Buying now would consume protected cash.",
  isRejected: false,
  isCommitted: false,
  ...overrides,
});

const input = (overrides: Partial<CommandAttentionInput> = {}): CommandAttentionInput => ({
  problems: [],
  actions: [],
  outreach: [],
  projects: [],
  decisions: [],
  opportunities: [],
  lessons: [],
  systems: [],
  sops: [],
  handoffs: [],
  procurementQueue: [],
  nowMs: NOW,
  ...overrides,
});

const item = (overrides: Partial<CommandAttentionItem> = {}): CommandAttentionItem => ({
  id: "item",
  objectType: "Action",
  title: "Item",
  reason: "Reason",
  reasons: ["Reason"],
  statusText: "Open",
  area: "Operations",
  attentionRank: 1,
  tieWeight: 0,
  priorityScore: 0,
  sortDate: NOW,
  sortDateAscending: false,
  navigationMode: "direct",
  ...overrides,
});

describe("Command Attention score and ordering rules", () => {
  it("preserves every domain score and date-sensitive score boundary", () => {
    expect(getProblemPriorityScore({ severity: "Critical", problemStatus: "Open" })).toBe(185);
    expect(getProblemPriorityScore({ severity: "High", problemStatus: "Action required" })).toBe(140);
    expect(getProblemPriorityScore({ severity: "Low", problemStatus: "Investigating" })).toBe(20);

    expect(getActionPriorityScore({ status: "Blocked", priority: "Critical", dueDate: iso() }, NOW)).toBe(320);
    expect(getActionPriorityScore({ status: "In Progress", priority: "High", dueDate: iso(-1) }, NOW)).toBe(290);
    expect(getActionPriorityScore({ status: "Open", priority: "Low", dueDate: "invalid" }, NOW)).toBe(60);

    expect(getDecisionPriorityScore({ decisionStatus: "Under Review", reviewDate: iso() }, NOW)).toBe(190);
    expect(getDecisionPriorityScore({ decisionStatus: "Active", reviewDate: iso(1) }, NOW)).toBe(60);
    expect(getDecisionPriorityScore({ decisionStatus: "Active", reviewDate: "invalid" }, NOW)).toBe(60);

    expect(getOpportunityPriorityScore({ status: "Evaluating", strategicFit: "Exceptional" })).toBe(145);
    expect(getOpportunityPriorityScore({ status: "Evaluating", strategicFit: "High" })).toBe(125);
    expect(getLessonPriorityScore({ status: "Change Required" })).toBe(80);
    expect(getSystemPriorityScore({ status: "Reviewing" })).toBe(65);
    expect(getSopPriorityScore({ reviewDate: iso() }, NOW)).toBe(150);
    expect(getSopPriorityScore({ reviewDate: iso(1) }, NOW)).toBe(60);
    expect(getSopPriorityScore({ reviewDate: "" }, NOW)).toBe(0);
  });

  it("orders reasons by policy rank then locale text without mutating input", () => {
    const reasons = ["STRATEGIC FIT: HIGH", "OPEN", "OVERDUE BY 2 DAYS", "BLOCKED", "HIGH PRIORITY", "REVIEW DUE"];
    const original = [...reasons];

    expect(orderAttentionReasons(reasons)).toEqual([
      "BLOCKED",
      "OVERDUE BY 2 DAYS",
      "REVIEW DUE",
      "HIGH PRIORITY",
      "STRATEGIC FIT: HIGH",
      "OPEN",
    ]);
    expect(reasons).toEqual(original);
  });

  it("compares rank, descending tie weight, configured date direction, title, then id", () => {
    expect(compareAttentionItems(item({ attentionRank: 1 }), item({ attentionRank: 2 }))).toBeLessThan(0);
    expect(compareAttentionItems(item({ tieWeight: 2 }), item({ tieWeight: 1 }))).toBeLessThan(0);
    expect(compareAttentionItems(item({ sortDate: NOW - 100, sortDateAscending: true }), item({ sortDate: NOW }))).toBeLessThan(0);
    expect(compareAttentionItems(item({ title: "Alpha" }), item({ title: "Beta" }))).toBeLessThan(0);
    expect(compareAttentionItems(item({ id: "a", title: "Same" }), item({ id: "b", title: "Same" }))).toBeLessThan(0);
  });
});

describe("buildCommandAttention", () => {
  it("classifies each domain and preserves its reasons, metadata, scores, and target descriptors", () => {
    const result = buildCommandAttention(input({
      problems: [problem({ id: "problem", severity: "Critical", frequency: "Persistent", problemStatus: "Open", problemStatement: "Persistent fault" })],
      actions: [action({
        id: "action",
        status: "Blocked",
        priority: "Critical",
        dueDate: iso(-2 * 86400000),
        followUpDate: day(-1),
        followUpNote: "Waiting on supplier",
        relatedProblem: "problem",
      })],
      outreach: [
        outreach({ id: "outreach-overdue", status: "Follow-Up Due", nextFollowUpDate: day(-2) }),
        outreach({ id: "outreach-today", status: "No Response", nextFollowUpDate: day(0) }),
        outreach({ id: "outreach-excluded", status: "Converted to Lead", nextFollowUpDate: day(-1) }),
      ],
      projects: [project({
        id: "project",
        status: "in progress",
        health: "Blocked",
        reviewNote: "Scope decision",
        nextReviewDate: day(0),
        targetCompletionDate: day(-2),
      })],
      decisions: [decision({ id: "decision", decisionStatus: "Under Review", reviewDate: iso() })],
      opportunities: [opportunity({ id: "opportunity", status: "Evaluating", strategicFit: "Exceptional" })],
      lessons: [lesson({ id: "lesson", status: "Change Required" })],
      systems: [system({ id: "system", status: "Reviewing" })],
      sops: [sop({ id: "sop", reviewDate: iso() })],
      handoffs: [handoff()],
      procurementQueue: [procurement()],
    }));
    const byKey = new Map(result.items.map((entry) => [`${entry.objectType}:${entry.id}`, entry]));

    expect([...byKey.keys()]).toEqual(expect.arrayContaining([
      "Problem:problem", "Action:action", "Outreach:outreach-overdue", "Outreach:outreach-today",
      "Project:project", "Decision:decision", "Opportunity:opportunity", "Lesson:lesson",
      "System:system", "SOP:sop", "Lead:lead-1", "Finance:commitment:commitment-1",
    ]));
    expect(byKey.has("Outreach:outreach-excluded")).toBe(false);
    expect(byKey.get("Problem:problem")).toMatchObject({
      title: "Persistent fault",
      reasons: ["CRITICAL SEVERITY", "OPEN", "PERSISTENT", "RECURRING PROBLEM"],
      attentionRank: 2,
      tieWeight: 3,
      priorityScore: 305,
    });
    expect(byKey.get("Action:action")).toMatchObject({
      reasons: expect.arrayContaining([
        "BLOCKED", "OVERDUE BY 2 DAYS", "CRITICAL PRIORITY", "BLOCKER: Waiting on supplier",
        "BLOCKED BY PROBLEM: Persistent fault", "FOLLOW-UP REVIEW DUE",
      ]),
      attentionRank: 1,
      tieWeight: 2,
      dependencyAction: { label: "Open blocker", target: { kind: "record", objectType: "Problem", id: "problem" } },
    });
    expect(byKey.get("Action:action")?.reason).toBe(byKey.get("Action:action")?.reasons.join(" • "));
    expect(byKey.get("Outreach:outreach-today")).toMatchObject({
      reasons: ["OUTREACH FOLLOW-UP DUE TODAY"],
      attentionRank: 6,
      priorityScore: 90,
    });
    expect(byKey.get("Project:project")).toMatchObject({
      reasons: expect.arrayContaining(["BLOCKED PROJECT", "OVERDUE PROJECT", "2 DAYS OVERDUE", "PROJECT REVIEW DUE"]),
      attentionRank: 1,
      priorityScore: 180,
      targetCompletionDate: day(-2),
    });
    expect(byKey.get("Decision:decision")?.reasons).toEqual(["REVIEW DUE", "Under review"]);
    expect(byKey.get("Opportunity:opportunity")).toMatchObject({
      reasons: ["STRATEGIC FIT: EXCEPTIONAL", "EVALUATING"],
      tieWeight: 2,
      priorityScore: 145,
    });
    expect(byKey.get("Lesson:lesson")).toMatchObject({ reason: "Status: Change required", priorityScore: 80 });
    expect(byKey.get("System:system")).toMatchObject({ reason: "Status: Reviewing", priorityScore: 65 });
    expect(byKey.get("SOP:sop")).toMatchObject({ reason: "Review date due or overdue", priorityScore: 150 });
    expect(byKey.get("Lead:lead-1")).toMatchObject({
      reasons: ["DELEGATION INTERVENTION REQUIRED: Delivery is blocked."],
      dependencyAction: { label: "Review handoff", target: { kind: "accountability", personId: "operator-1" } },
      priorityScore: 190,
    });
    expect(byKey.get("Finance:commitment:commitment-1")).toMatchObject({
      reason: "APPROVED PROCUREMENT BLOCKED: Buying now would consume protected cash.",
      attentionRank: 1,
      tieWeight: 2,
      priorityScore: 170,
    });
  });

  it("merges duplicate source signals by objectType:id, keeps first metadata, and adds group membership", () => {
    const result = buildCommandAttention(input({
      actions: [action({ id: "duplicate", status: "Blocked", priority: "High", followUpNote: "Dependency" })],
      handoffs: [handoff({ objectType: "Action", objectId: "duplicate", reviewState: "At risk", reviewReasons: ["Delivery is at risk."] })],
    }));
    const duplicate = result.items.find((entry) => entry.objectType === "Action" && entry.id === "duplicate");

    expect(result.items.filter((entry) => entry.objectType === "Action" && entry.id === "duplicate")).toHaveLength(1);
    expect(duplicate).toMatchObject({
      title: "Action title",
      statusText: expect.stringContaining("Blocked / High"),
      reasons: expect.arrayContaining(["BLOCKED", "BLOCKER: Dependency", "DELEGATION AT RISK: Delivery is at risk."]),
    });
    expect(result.groups["HIGH PRIORITY"]).toContain(duplicate);
    expect(result.groups["DELEGATION AT RISK: Delivery is at risk."]).toContain(duplicate);
  });

  it("preserves inclusive and exclusive date boundaries and future-follow-up suppression", () => {
    const result = buildCommandAttention(input({
      actions: [
        action({ id: "due-now", dueDate: iso(), priority: "Low" }),
        action({ id: "future-follow-up", followUpDate: day(1), priority: "Low" }),
        action({ id: "critical-future-follow-up", followUpDate: day(1), priority: "Critical" }),
        action({ id: "stale-at-14", status: "In Progress", dueDate: "", createdDate: iso(-14 * 86400000), createdAt: iso(-14 * 86400000), priority: "Low" }),
      ],
      outreach: [
        outreach({ id: "outreach-boundary", nextFollowUpDate: day(0) }),
        outreach({ id: "outreach-upcoming", nextFollowUpDate: day(1) }),
      ],
      projects: [
        project({ id: "due-in-seven", targetCompletionDate: day(7) }),
        project({ id: "due-in-eight", targetCompletionDate: day(8) }),
        project({ id: "completed", status: "completed", health: "Blocked", targetCompletionDate: day(-2) }),
      ],
      decisions: [
        decision({ id: "review-now", reviewDate: iso() }),
        decision({ id: "review-future", reviewDate: iso(1) }),
      ],
      sops: [sop({ id: "sop-boundary", reviewDate: iso() }), sop({ id: "sop-future", reviewDate: iso(1) })],
    }));
    const byKey = new Map(result.items.map((entry) => [`${entry.objectType}:${entry.id}`, entry]));

    expect(byKey.get("Action:due-now")?.reasons).toContain("DUE WITHIN 7 DAYS");
    expect(byKey.get("Action:due-now")?.reasons.some((reason) => reason.startsWith("OVERDUE BY "))).toBe(false);
    expect(byKey.has("Action:future-follow-up")).toBe(false);
    expect(byKey.has("Action:critical-future-follow-up")).toBe(true);
    expect(byKey.get("Action:stale-at-14")?.reasons).toContain("STALE IN-PROGRESS ACTION");
    expect(byKey.get("Outreach:outreach-boundary")?.reasons).toEqual(["OUTREACH FOLLOW-UP DUE TODAY"]);
    expect(byKey.has("Outreach:outreach-upcoming")).toBe(false);
    expect(byKey.get("Project:due-in-seven")?.reasons).toContain("DUE WITHIN 7 DAYS");
    expect(byKey.has("Project:due-in-eight")).toBe(false);
    expect(byKey.has("Project:completed")).toBe(false);
    expect(byKey.get("Decision:review-now")?.reasons).toContain("REVIEW DUE");
    expect(byKey.has("Decision:review-future")).toBe(false);
    expect(byKey.has("SOP:sop-boundary")).toBe(true);
    expect(byKey.has("SOP:sop-future")).toBe(false);
  });

  it("does not mutate any supplied records or reason arrays", () => {
    const value = input({
      problems: [problem({ frequency: "Recurring" })],
      actions: [action({ status: "Blocked", priority: "High", dueDate: iso(-1000) })],
      outreach: [outreach()],
      projects: [project({ status: "blocked" })],
      decisions: [decision({ decisionStatus: "Under Review" })],
      opportunities: [opportunity()],
      lessons: [lesson({ status: "Change Required" })],
      systems: [system({ status: "Reviewing" })],
      sops: [sop({ reviewDate: iso() })],
      handoffs: [handoff()],
      procurementQueue: [procurement()],
    });
    const before = structuredClone(value);

    buildCommandAttention(value);

    expect(value).toEqual(before);
  });
});

function learningFor(
  target: LearningAttentionInput["associatedTarget"],
  status: "Change Required" | "Reviewed" | "New" = "Change Required",
  id = "learning-lesson",
): LearningAttentionInput[] {
  return buildOrganisationalLearning({
    actions: [], projects: [], decisions: [], problems: [], systems: [], sops: [],
    lessons: [{
      id, title: "Source learning title", lessonTitle: "", status,
      description: "Recorded evidence", recommendedChange: "Update the checklist",
      relatedProblem: "", relatedProject: "", relatedDecision: "", relatedSystem: "",
    }],
  }).map((signal) => ({ signal, associatedTarget: target }));
}

function institutionalisationFor(target: LearningAttentionInput["associatedTarget"]): LearningAttentionInput[] {
  return buildOrganisationalLearning({
    actions: [], projects: [], decisions: [], systems: [], sops: [],
    problems: [{
      id: "learning-problem", title: "Recorded recurring problem", problemStatement: "",
      frequency: "Recurring", severity: "High", problemStatus: "Open", owner: "", isUnresolved: true,
    }],
    lessons: [{
      id: "learning-lesson", title: "Recorded learning", lessonTitle: "", status: "Reviewed",
      description: "Recorded evidence", recommendedChange: "",
      relatedProblem: "learning-problem", relatedProject: "", relatedDecision: "", relatedSystem: "",
    }],
  }).filter(({ sourceType }) => sourceType === "Problem")
    .map((signal) => ({ signal, associatedTarget: target }));
}

type ProductionLearningRecords = OrganisationalLearningInput & {
  icarusAssessments?: readonly IcarusAssessmentRecord[];
  icarusTreatmentTargets?: readonly { id: string; treatmentKind: string }[];
};

function productionLearning(records: ProductionLearningRecords): LearningAttentionInput[] {
  const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
  function section(start: string, end: string): string {
    const first = page.indexOf(start);
    const last = page.indexOf(end, first);
    if (first < 0 || last < 0) throw new Error(`Missing production learning boundary: ${start}`);
    return page.slice(first, last);
  }
  const source = [
    section("function isActionWaiting(", "\nconst personStatusOptions"),
    section("function deriveDecisionExecutionState(", "\nconst expenseCategoryOptions"),
    section("  const isProblemUnresolved =", "  const isDecisionActive ="),
    section("  const commandLearningInput =", "  const commandAttentionPolicy ="),
    "result = commandLearningInput;",
  ].join("\n");
  const { outputText } = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2020, module: ModuleKind.ESNext },
  });
  const context: { result?: LearningAttentionInput[] } = {};
  const targets = (records.icarusTreatmentTargets ?? []).map((entry): IcarusTreatmentTarget => ({
    ...entry, sourceKind: "Failure-chain restoration", sourceId: entry.id, assessmentId: "projection",
    reason: "Projection target", basis: [], affectedAssessmentIds: [], objectiveIds: [], pillarIds: [],
    provenance: { kind: "Failure-chain recommendation", finding: "Projection" },
    executionLinks: [], executions: [], state: "Unrouted", material: true, founderOwned: false,
  }));
  const interventionIndex = buildIcarusInterventionIndex({
    assessments: records.icarusAssessments ?? [],
    treatment: { targets, verification: new Map(), summaries: new Map(), recommendations: [], barrierRestorations: [] },
    signals: [], sources: [], decisions: records.decisions, lessons: records.lessons, people: [], nowMs: NOW,
  });
  runInNewContext(outputText, Object.assign(context, {
    Map, Set, buildOrganisationalLearning,
    actionRecords: records.actions,
    projects: records.projects,
    decisionRecords: records.decisions,
    lessonRecords: records.lessons,
    problemRecords: records.problems,
    systemRecords: records.systems,
    sopRecords: records.sops,
    icarusAssessments: records.icarusAssessments ?? [],
    icarusTreatmentIndex: { targets: records.icarusTreatmentTargets ?? [] },
    icarusInterventionIndex: interventionIndex,
  }), { timeout: 1000 });
  if (!context.result) throw new Error("Production learning projection returned no result");
  return context.result;
}

function learningRecords(overrides: Partial<ProductionLearningRecords> = {}): ProductionLearningRecords {
  return { actions: [], projects: [], decisions: [], lessons: [], problems: [], systems: [], sops: [], ...overrides };
}

describe("Production record projection into Command learning", () => {
  const metadata = ({ reason, reasons, ...rest }: CommandAttentionItem) => rest;

  it("supplies the production learning projection to the existing Command call", () => {
    const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
    const start = page.indexOf("  const commandAttentionPolicy = buildCommandAttention({");
    const end = page.indexOf("  const commandAttentionItemList:", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(page.slice(start, end)).toContain("learning: commandLearningInput,");
  });

  it("projects verified Icarus treatment learning from the real page composition", () => {
    const record: IcarusTreatmentOutcomeRecord = {
      id: "outcome-1",
      treatmentTargetId: "target-1",
      assessmentId: "icarus-1",
      executionLinks: [{ recordType: "Action", recordId: "action-1", linkedAt: icarusTimestamp }],
      outcome: "Effective",
      verifiedAt: icarusTimestamp,
      verifiedByPersonId: "person-1",
      evidence: [{
        kind: "Control test",
        assessmentId: "icarus-1",
        failureModeId: "mode-1",
        controlId: "control-1",
        testId: "test-1",
        result: "Passed",
        assuranceStatus: "Assured",
        evidenceStatus: "Current support",
        evidenceIds: ["evidence-1"],
      }],
      afterState: { kind: "Control assurance", state: "Assured" },
      verificationNote: "Current evidence confirms the control is effective.",
    };
    const learning = productionLearning(learningRecords({
      icarusAssessments: [icarusAssessment({ treatmentOutcomes: [record] })],
      icarusTreatmentTargets: [{ id: "target-1", treatmentKind: "Restore control" }],
    }));
    const treatmentSignals = learning.filter(({ signal }) => signal.sourceType === "Icarus Treatment");
    expect(treatmentSignals).toHaveLength(1);
    expect(treatmentSignals[0]?.signal).toMatchObject({
      sourceId: "outcome-1",
      sourceTitle: "Restore control",
      outcomeState: "Worked",
    });
  });

  it("leaves ordinary execution and outcomes without explicit learning conditions unchanged", () => {
    const actions = [action({ status: "Blocked" })];
    const projects = [project({ status: "blocked" })];
    const decisions = [decision({ decisionStatus: "Under Review" })];
    const baseline = input({ actions, projects, decisions });
    const learning = productionLearning(learningRecords({
      actions: actions.map((record) => ({ ...record, completionEvidence: "Work recorded" })),
      projects,
      decisions: decisions.map((record) => ({
        ...record, actualOutcome: "Recorded result",
        outcomeRating: "Worked", lessons: "",
      })),
    }));
    expect(learning.filter(({ signal }) => signal.sourceType === "Icarus Treatment")).toEqual([]);
    expect(buildCommandAttention({ ...baseline, learning })).toEqual(buildCommandAttention(baseline));
    expect(learning.find(({ signal }) => signal.sourceType === "Decision")?.signal.executionState)
      .toBe("No execution path");
  });

  it("passes a real Change Required Lesson to its existing Command item without changing metadata or ordering", () => {
    const record = {
      ...lesson({ status: "Change Required" }),
      description: "Recorded lesson", recommendedChange: "Revise the checklist",
      relatedProblem: "", relatedProject: "", relatedDecision: "", relatedSystem: "",
    };
    const source = input({ lessons: [record], actions: [action({ status: "Blocked" })] });
    const original = buildCommandAttention(source);
    const learning = productionLearning(learningRecords({ lessons: [record] }));
    const result = buildCommandAttention({ ...source, learning });
    expect(result.items.map(metadata)).toEqual(original.items.map(metadata));
    expect(result.items.filter(({ objectType, id }) => objectType === "Lesson" && id === record.id)).toHaveLength(1);
    const augmented = result.items.find(({ objectType }) => objectType === "Lesson")!;
    const prior = original.items.find(({ objectType }) => objectType === "Lesson")!;
    expect(augmented.reasons).toEqual(orderAttentionReasons([...prior.reasons, "Learning: change required"]));
    expect(augmented.reason).toBe(augmented.reasons.join(" • "));
  });

  it("reuses the production unresolved predicate and existing authoritative recurrence classification", () => {
    const record = problem({ frequency: "Persistent" });
    const source = input({ problems: [record] });
    const records = learningRecords({
      problems: [{ ...record, isUnresolved: false }],
    });
    const learning = productionLearning(records);
    expect(learning[0].signal.recurrenceState).toBe("Recorded recurrence");
    expect(learning[0].signal.evidence).toContainEqual({
      sourceType: "Problem", sourceId: record.id, field: "isUnresolved", value: "true",
    });
    const result = buildCommandAttention({ ...source, learning });
    expect(result.items).toHaveLength(1);
    expect(metadata(result.items[0])).toEqual(metadata(buildCommandAttention(source).items[0]));
    expect(result.items[0].reasons).toContain("Learning: review recorded recurrence");
  });

  it("omits historical Lesson recommendations without explicit outstanding-change evidence", () => {
    const record = {
      ...lesson({ status: "Reviewed" }),
      description: "Recorded learning", recommendedChange: "Revise an SOP",
      relatedProblem: "", relatedProject: "", relatedDecision: "", relatedSystem: "system-1",
    };
    const source = input({
      lessons: [record], systems: [system({ status: "Reviewing" })],
    });
    const learning = productionLearning(learningRecords({ lessons: [record] }));
    expect(learning[0].signal.recommendedNextTransition).toBe("Review existing Lesson");
    expect(buildCommandAttention({ ...source, learning })).toEqual(buildCommandAttention(source));
    expect(buildCommandAttention({ ...source, learning }).items.some(({ objectType }) => objectType === "Lesson"))
      .toBe(false);
  });

  it.each(["Worked", "Failed", "Partially worked"])("omits %s without explicit learning evidence in production", (outcomeRating) => {
    const record = {
      ...decision({ decisionStatus: "Under Review" }), actualOutcome: "Recorded result", outcomeRating, lessons: "",
    };
    const source = input({ decisions: [record] });
    const learning = productionLearning(learningRecords({ decisions: [record] }));
    expect(buildCommandAttention({ ...source, learning })).toEqual(buildCommandAttention(source));
  });

  it("preserves deterministic results and frozen source records through the actual page projection", () => {
    const record = {
      ...lesson({ status: "Change Required" }), description: "Source evidence", recommendedChange: "",
      relatedProblem: "", relatedProject: "", relatedDecision: "", relatedSystem: "",
    };
    const records = learningRecords({ lessons: [record] });
    const command = input({ lessons: [record] });
    const before = structuredClone({ records, command });
    function freeze(value: unknown): void {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    }
    freeze(records);
    freeze(command);
    const learning = productionLearning(records);
    expect(productionLearning(records)).toEqual(learning);
    const result = buildCommandAttention({ ...command, learning });
    expect(buildCommandAttention({ ...command, learning: productionLearning(records) })).toEqual(result);
    result.items[0].reasons.push("Changed output");
    expect({ records, command }).toEqual(before);
  });
});

describe("Command learning pipeline integration", () => {
  const withoutReasons = ({ reason, reasons, ...metadata }: CommandAttentionItem) => metadata;

  it("preserves all existing domain output with absent, empty or non-qualifying learning input", () => {
    const source = input({
      problems: [problem({ frequency: "Recurring" })],
      actions: [action({ status: "Blocked" })], outreach: [outreach()],
      projects: [project({ status: "blocked" })],
      decisions: [decision({ decisionStatus: "Under Review" })],
      opportunities: [opportunity()], lessons: [lesson({ status: "Change Required" })],
      systems: [system({ status: "Reviewing" })], sops: [sop({ reviewDate: iso() })],
      handoffs: [handoff()], procurementQueue: [procurement()],
    });
    const baseline = buildCommandAttention(source);
    expect(buildCommandAttention({ ...source, learning: [] })).toEqual(baseline);
    expect(buildCommandAttention({
      ...source, learning: learningFor({ objectType: "Action", id: "action-1" }, "New"),
    })).toEqual(baseline);
  });

  it("augments an existing Action through reason merging without changing any metadata or ordering", () => {
    const source = input({
      problems: [problem({ id: "blocker" })],
      actions: [action({ status: "Blocked", priority: "High", relatedProblem: "blocker" })],
      lessons: [lesson({ status: "Change Required" })],
    });
    const baseline = buildCommandAttention(source);
    const result = buildCommandAttention({
      ...source, learning: learningFor({ objectType: "Action", id: "action-1" }),
    });
    expect(result.items.map(({ objectType, id }) => [objectType, id]))
      .toEqual(baseline.items.map(({ objectType, id }) => [objectType, id]));
    expect(result.items.map(withoutReasons)).toEqual(baseline.items.map(withoutReasons));
    const original = baseline.items.find(({ objectType }) => objectType === "Action")!;
    const augmented = result.items.find(({ objectType }) => objectType === "Action")!;
    expect(augmented.reasons).toEqual(orderAttentionReasons([...original.reasons, "Learning: change required"]));
    expect(augmented.reason).toBe(augmented.reasons.join(" • "));
    expect(augmented.dependencyAction).toEqual(original.dependencyAction);
    expect(result.groups["Learning: change required"]).toEqual([augmented]);
    Object.entries(baseline.groups).forEach(([key, entries]) => {
      expect(result.groups[key].map(withoutReasons)).toEqual(entries.map(withoutReasons));
    });
  });

  it("augments a Project while retaining its dates, ranking, priority and navigation", () => {
    const source = input({
      projects: [project({ status: "blocked", targetCompletionDate: day(-2), reviewNote: "Blocker" })],
    });
    const baseline = buildCommandAttention(source);
    const result = buildCommandAttention({
      ...source, learning: institutionalisationFor({ objectType: "Project", id: "project-1" }),
    });
    expect(result.items).toHaveLength(1);
    expect(withoutReasons(result.items[0])).toEqual(withoutReasons(baseline.items[0]));
    expect(result.items[0].reasons).toEqual(orderAttentionReasons([
      ...baseline.items[0].reasons, "Learning: consider System/SOP change",
    ]));
  });

  it("confirms only assembled Command identities and omits unresolved or non-attention targets", () => {
    const source = input({ actions: [action({ status: "Completed" })] });
    const learning = [
      ...learningFor({ objectType: "Action", id: "action-1" }),
      ...learningFor({ objectType: "System", id: "missing" }),
      ...learningFor(undefined),
    ];
    expect(buildCommandAttention({ ...source, learning })).toEqual(buildCommandAttention(source));
    expect(buildCommandAttention({ ...source, learning }).items).toEqual([]);
  });

  it.each(["Worked", "Failed", "Partially worked"])("does not introduce %s outcome-only learning into Command", (outcomeRating) => {
    const source = input({ decisions: [decision({ decisionStatus: "Under Review" })] });
    const learning = buildOrganisationalLearning({
      actions: [], projects: [], lessons: [], problems: [], systems: [], sops: [],
      decisions: [{
        id: "decision-1", title: "Decision", decisionTitle: "",
        decisionStatus: "Completed", outcomeRating, actualOutcome: "Recorded outcome", lessons: "",
      }],
    }).map((signal) => ({ signal }));
    expect(buildCommandAttention({ ...source, learning })).toEqual(buildCommandAttention(source));
  });

  it("merges multiple qualifying reasons and duplicate candidates into one existing item", () => {
    const source = input({ actions: [action({ status: "Blocked" })] });
    const target = { objectType: "Action", id: "action-1" } as const;
    const change = learningFor(target);
    const learning = [...change, ...institutionalisationFor(target), ...change];
    const baseline = buildCommandAttention(source);
    const result = buildCommandAttention({ ...source, learning });
    expect(result.items).toHaveLength(1);
    expect(withoutReasons(result.items[0])).toEqual(withoutReasons(baseline.items[0]));
    expect(result.items[0].reasons).toEqual(orderAttentionReasons([
      ...baseline.items[0].reasons, "Learning: change required", "Learning: consider System/SOP change",
    ]));
    expect(result.groups["Learning: change required"]).toHaveLength(1);
    expect(result.groups["Learning: consider System/SOP change"]).toHaveLength(1);
  });

  it("is deterministic and does not mutate frozen records, learning evidence or targets", () => {
    const source = input({
      actions: [action({ status: "Blocked" })],
      learning: learningFor({ objectType: "Action", id: "action-1" }),
    });
    const before = structuredClone(source);
    function freeze(value: unknown): void {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    }
    freeze(source);
    const first = buildCommandAttention(source);
    expect(buildCommandAttention(source)).toEqual(first);
    first.items[0].reasons.push("Changed output");
    expect(source).toEqual(before);
  });
});

const icarusTimestamp = "2025-04-01T12:00:00.000Z";

function icarusAssessment(overrides: Partial<IcarusAssessmentRecord> = {}): IcarusAssessmentRecord {
  return {
    id: "icarus-1",
    outcome: "Excavation margin collapses",
    status: "Open",
    createdAt: icarusTimestamp,
    updatedAt: icarusTimestamp,
    linkedRecords: [],
    failureModes: [{
      id: "mode-1",
      mechanism: "Fuel costs are not repriced into quotes.",
      vulnerability: "No repricing trigger.",
      evidence: [{
        id: "evidence-1",
        statement: "Two jobs lost money last month.",
        origin: "Direct observation",
        recordedAt: icarusTimestamp,
        recordedBy: "Founder",
        review: "Supports",
        reviewedAt: icarusTimestamp,
        reviewedBy: "Founder",
      }],
    }],
    controls: [],
    ...overrides,
  };
}

function icarusSignals(assessments: readonly IcarusAssessmentRecord[]): IcarusStrategicSignal[] {
  const links: IcarusRecordReference[] = assessments.flatMap((entry) => entry.linkedRecords);
  return buildIcarusStrategicAttention({
    assessments,
    reviews: buildIcarusReview(assessments, links.map((link) => ({ ...link, title: link.recordId })), NOW),
  });
}

describe("Command Icarus strategic attention integration", () => {
  const pillarLink: IcarusRecordReference = { recordType: "Pillar", recordId: "Excavation" };

  it("leaves Command output unchanged when Icarus input is absent, empty or entirely non-material", () => {
    const source = input({
      problems: [problem({ severity: "High" })],
      actions: [action({ status: "Blocked" })],
    });
    const baseline = buildCommandAttention(source);
    expect(buildCommandAttention({ ...source, icarus: [] })).toEqual(baseline);
    const controlled = icarusAssessment({
      linkedRecords: [{ recordType: "Problem", recordId: "problem-1" }],
      failureModes: [{
        ...icarusAssessment().failureModes[0],
        evidence: [icarusAssessment().failureModes[0].evidence[0], { ...icarusAssessment().failureModes[0].evidence[0], id: "control-evidence" }],
      }],
      controls: [{
        id: "control-1",
        failureModeId: "mode-1",
        intervention: "Monthly repricing",
        lifecycle: "Active",
        effectiveness: "Evidence supports",
        effectivenessReviewedAt: icarusTimestamp,
        effectivenessReviewedBy: "Founder",
        evidenceIds: ["control-evidence"],
        linkedRecords: [],
        nextReviewAt: "2025-12-31",
      }],
    });
    const signals = icarusSignals([controlled]);
    expect(signals).toEqual([]);
    expect(buildCommandAttention({ ...source, icarus: signals })).toEqual(baseline);
  });

  it("adds an unanchored material risk as a single traceable Icarus item", () => {
    const signals = icarusSignals([icarusAssessment({ linkedRecords: [pillarLink] })]);
    const result = buildCommandAttention(input({ icarus: signals }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "icarus-1",
      objectType: "Icarus",
      title: "Excavation margin collapses",
      reasons: ["ICARUS: EXPOSED FAILURE MODE", "PILLAR LINKED"],
      area: "Excavation",
      attentionRank: 3,
      tieWeight: 1,
      priorityScore: signals[0].riskScore,
      navigationMode: "record-handler",
      strategicRisk: {
        summary: signals[0].summary,
        references: [{
          identityKey: "icarus-assessment:icarus-1",
          assessmentId: "icarus-1",
          failureModeId: "mode-1",
          evidenceId: "evidence-1",
        }],
      },
    });
    expect(result.groups["ICARUS: EXPOSED FAILURE MODE"]).toEqual([result.items[0]]);
  });

  it("enriches the existing anchored Command item instead of adding a duplicate strategic item", () => {
    const source = input({ problems: [problem({ severity: "High" })] });
    const baseline = buildCommandAttention(source);
    expect(baseline.items).toHaveLength(1);
    const signals = icarusSignals([icarusAssessment({
      linkedRecords: [pillarLink, { recordType: "Problem", recordId: "problem-1" }],
    })]);
    const result = buildCommandAttention({ ...source, icarus: signals });
    expect(result.items).toHaveLength(1);
    const [enriched] = result.items;
    const [original] = baseline.items;
    expect(enriched).toMatchObject({
      id: original.id,
      objectType: "Problem",
      title: original.title,
      statusText: original.statusText,
      area: original.area,
      navigationMode: original.navigationMode,
      sortDate: original.sortDate,
      attentionRank: Math.min(original.attentionRank, 3),
      tieWeight: Math.max(original.tieWeight, 1),
      priorityScore: Math.max(original.priorityScore, signals[0].riskScore),
    });
    expect(enriched.reasons).toEqual(orderAttentionReasons([
      ...original.reasons,
      "ICARUS RISK: Excavation margin collapses (exposed)",
    ]));
    expect(enriched.strategicRisk?.references.map((reference) => reference.identityKey)).toEqual(["icarus-assessment:icarus-1"]);
    expect(result.items.some((entry) => entry.objectType === "Icarus")).toBe(false);
  });

  it("does not let an Icarus risk weaken a stronger existing anchor", () => {
    const source = input({ actions: [action({ status: "Blocked", priority: "Critical" })] });
    const [original] = buildCommandAttention(source).items;
    const signals = icarusSignals([icarusAssessment({ linkedRecords: [{ recordType: "Action", recordId: "action-1" }] })]);
    const [enriched] = buildCommandAttention({ ...source, icarus: signals }).items;
    expect(enriched.attentionRank).toBe(original.attentionRank);
    expect(enriched.attentionRank).toBeLessThan(3);
    expect(enriched.tieWeight).toBe(original.tieWeight);
    expect(enriched.reasons[0]).toBe(original.reasons[0]);
  });

  it("merges multiple assessments on the same anchor with one traceable reference each", () => {
    const source = input({ problems: [problem({ severity: "High" })] });
    const link: IcarusRecordReference = { recordType: "Problem", recordId: "problem-1" };
    const signals = icarusSignals([
      icarusAssessment({ id: "icarus-a", outcome: "Outcome A", linkedRecords: [link] }),
      icarusAssessment({ id: "icarus-b", outcome: "Outcome B", linkedRecords: [link] }),
    ]);
    const result = buildCommandAttention({ ...source, icarus: [...signals, signals[0]] });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].strategicRisk?.references.map((reference) => reference.assessmentId)).toEqual(["icarus-a", "icarus-b"]);
    expect(result.items[0].reasons.filter((reason) => reason.startsWith("ICARUS RISK"))).toEqual([
      "ICARUS RISK: Outcome A (exposed)",
      "ICARUS RISK: Outcome B (exposed)",
    ]);
  });

  it("anchors to the strongest existing linked item and falls back to standalone when no link is in Command", () => {
    const source = input({
      problems: [problem({ severity: "High" })],
      actions: [action({ status: "Blocked" }), action({ id: "quiet-action" })],
    });
    const baselineKeys = buildCommandAttention(source).items.map((entry) => `${entry.objectType}:${entry.id}`);
    expect(baselineKeys).not.toContain("Action:quiet-action");
    expect(baselineKeys).toEqual(expect.arrayContaining(["Problem:problem-1", "Action:action-1"]));
    const result = buildCommandAttention({
      ...source,
      icarus: icarusSignals([
        icarusAssessment({ id: "multi", outcome: "Multi", linkedRecords: [
          { recordType: "Problem", recordId: "problem-1" },
          { recordType: "Action", recordId: "action-1" },
        ] }),
        icarusAssessment({ id: "quiet", outcome: "Quiet", linkedRecords: [{ recordType: "Action", recordId: "quiet-action" }] }),
      ]),
    });
    const byKey = new Map(result.items.map((entry) => [`${entry.objectType}:${entry.id}`, entry]));
    expect(byKey.get("Action:action-1")?.strategicRisk?.references[0].assessmentId).toBe("multi");
    expect(byKey.get("Problem:problem-1")?.strategicRisk).toBeUndefined();
    expect(byKey.get("Icarus:quiet")).toMatchObject({ objectType: "Icarus", navigationMode: "record-handler" });
    expect(byKey.has("Action:quiet-action")).toBe(false);
  });

  it("competes below blocked/overdue execution and above routine follow-ups", () => {
    const result = buildCommandAttention(input({
      actions: [action({ status: "Blocked", priority: "Critical" })],
      outreach: [outreach({ status: "No Response", nextFollowUpDate: day(0) })],
      icarus: icarusSignals([icarusAssessment()]),
    }));
    expect(result.items.map((entry) => entry.objectType)).toEqual(["Action", "Icarus", "Outreach"]);
  });

  it("orders multiple standalone Icarus items by materiality and stays deterministic without mutating inputs", () => {
    const signals = icarusSignals([
      icarusAssessment({ id: "unverified", outcome: "Unverified", controls: [{
        id: "control-1", failureModeId: "mode-1", intervention: "Check", lifecycle: "Active",
        effectiveness: "Unknown", evidenceIds: [], linkedRecords: [], nextReviewAt: "2025-12-31",
      }] }),
      icarusAssessment({ id: "exposed-pillar", outcome: "Pillar", linkedRecords: [pillarLink] }),
      icarusAssessment({ id: "exposed", outcome: "Plain" }),
    ]);
    const source = input({ icarus: signals });
    const before = structuredClone(source);
    const first = buildCommandAttention(source);
    expect(first.items.map((entry) => entry.id)).toEqual(["exposed-pillar", "exposed", "unverified"]);
    expect(first.items.map((entry) => entry.attentionRank)).toEqual([3, 3, 6]);
    expect(buildCommandAttention(source)).toEqual(first);
    first.items[0].strategicRisk?.references.push({ identityKey: "x", assessmentId: "x" });
    expect(source).toEqual(before);
  });
});

it("enriches the existing Icarus issue with treatment routing without crossing Command priority caps", () => {
  const [signal] = icarusSignals([icarusAssessment({
    linkedRecords: [{ recordType: "Pillar", recordId: "Excavation" }],
  })]);
  const ordinary = buildCommandAttention(input({ icarus: [signal] })).items[0];
  const treated = buildCommandAttention(input({
    icarus: [{
      ...signal,
      treatment: {
        attentionReasons: ["1 material treatment target is unrouted"],
        founderOwnedCount: 0,
        delegatedCount: 0,
      },
    }],
  })).items[0];

  expect(treated.objectType).toBe("Icarus");
  expect(treated.reason).toContain("1 material treatment target is unrouted");
  expect(treated.attentionRank).toBe(Math.max(3, ordinary.attentionRank - 1));
  expect(treated.attentionRank).toBeGreaterThanOrEqual(3);
});

describe("Command strategic-risk convergence resolution", () => {
  const riskItem = (overrides: Partial<CommandAttentionItem> = {}) => item({
    id: "icarus-1",
    objectType: "Icarus",
    title: "Margin collapses",
    reason: "STRATEGIC RISK",
    reasons: ["STRATEGIC RISK"],
    attentionRank: 3,
    tieWeight: 2,
    priorityScore: 400,
    navigationMode: "record-handler",
    strategicRisk: {
      summary: "Exposed failure mechanism",
      references: [{ identityKey: "icarus:icarus-1", assessmentId: "icarus-1", failureModeId: "mode-1" }],
      anchoredReason: "STRATEGIC RISK EXPOSURE",
    },
    ...overrides,
  });
  const host = (overrides: Partial<CommandAttentionItem> = {}) => item({
    id: "action-1",
    reason: "BLOCKED",
    reasons: ["BLOCKED"],
    attentionRank: 1,
    priorityScore: 120,
    ...overrides,
  });
  const convergence = (riskKeys: string[], members: string[]) => resolveStrategicRiskConvergence(
    [{ clusterKey: "cluster:Action:action-1", rootRecordKey: "Action:action-1", records: members.map((recordKey) => ({ recordKey })) }],
    riskKeys,
  );

  it("folds a standalone risk into its convergent host, preserving provenance and navigation references", () => {
    const items = [host(), riskItem()];
    const result = resolveCommandStrategicRiskConvergence(items, convergence(["Icarus:icarus-1"], ["Action:action-1", "Icarus:icarus-1"]));
    expect(result.map((entry) => `${entry.objectType}:${entry.id}`)).toEqual(["Action:action-1"]);
    expect(result[0]).toMatchObject({
      reasons: ["BLOCKED", "STRATEGIC RISK EXPOSURE"],
      attentionRank: 1,
      tieWeight: 2,
      priorityScore: 400,
      operationalPriorityScore: 120,
      strategicRisk: { summary: "Exposed failure mechanism", references: [{ identityKey: "icarus:icarus-1", assessmentId: "icarus-1", failureModeId: "mode-1" }] },
      convergentStrategicRisk: { clusterKey: "cluster:Action:action-1", rootRecordKey: "Action:action-1", riskRecordKeys: ["Icarus:icarus-1"] },
    });
  });

  it("restores the standalone risk when the convergent situation disappears", () => {
    const items = [host(), riskItem()];
    expect(resolveCommandStrategicRiskConvergence(items, new Map())).toEqual([...items].sort(compareAttentionItems));
  });

  it("keeps the risk standalone when no eligible host is present in Command", () => {
    const finance = host({ id: "commitment-1", objectType: "Finance" });
    const resolution = resolveStrategicRiskConvergence(
      [{ clusterKey: "c", rootRecordKey: "Finance:commitment-1", records: [{ recordKey: "Finance:commitment-1" }, { recordKey: "Icarus:icarus-1" }, { recordKey: "Project:not-in-command" }] }],
      ["Icarus:icarus-1"],
    );
    const result = resolveCommandStrategicRiskConvergence([finance, riskItem()], resolution, { isEligibleHost: (entry) => entry.objectType !== "Finance" });
    expect(result.map((entry) => entry.objectType)).toContain("Icarus");
    expect(result.find((entry) => entry.objectType === "Finance")!.convergentStrategicRisk).toBeUndefined();
  });

  it("does not hide a distinct risk that merely shares a pillar/area with a convergent situation", () => {
    const other = riskItem({ id: "icarus-2", area: "Operations", strategicRisk: { summary: "Other", references: [{ identityKey: "icarus:icarus-2", assessmentId: "icarus-2" }] } });
    const result = resolveCommandStrategicRiskConvergence(
      [host(), riskItem(), other],
      convergence(["Icarus:icarus-1", "Icarus:icarus-2"], ["Action:action-1", "Icarus:icarus-1"]),
    );
    expect(result.map((entry) => `${entry.objectType}:${entry.id}`).sort()).toEqual(["Action:action-1", "Icarus:icarus-2"]);
  });

  it("folds several risks into one host without duplicating references", () => {
    const shared = { identityKey: "icarus:icarus-1", assessmentId: "icarus-1" };
    const anchoredHost = host({ strategicRisk: { summary: "Anchored", references: [shared] } });
    const second = riskItem({ id: "icarus-2", strategicRisk: { summary: "Second", references: [{ identityKey: "icarus:icarus-2", assessmentId: "icarus-2" }], anchoredReason: "STRATEGIC RISK EXPOSURE" } });
    const result = resolveCommandStrategicRiskConvergence(
      [anchoredHost, riskItem(), second],
      convergence(["Icarus:icarus-1", "Icarus:icarus-2"], ["Action:action-1", "Icarus:icarus-1", "Icarus:icarus-2"]),
    );
    expect(result).toHaveLength(1);
    expect(result[0].strategicRisk!.summary).toBe("Anchored");
    expect(result[0].strategicRisk!.references.map((reference) => reference.identityKey)).toEqual(["icarus:icarus-1", "icarus:icarus-2"]);
    expect(result[0].convergentStrategicRisk!.riskRecordKeys).toEqual(["Icarus:icarus-1", "Icarus:icarus-2"]);
    expect(result[0].reasons.filter((reason) => reason === "STRATEGIC RISK EXPOSURE")).toHaveLength(1);
  });

  it("picks the highest-priority host deterministically and never mutates input", () => {
    const weaker = host({ id: "action-2", attentionRank: 2 });
    const items = [riskItem(), weaker, host()];
    const before = JSON.stringify(items);
    const resolution = convergence(["Icarus:icarus-1"], ["Action:action-2", "Action:action-1", "Icarus:icarus-1"]);
    const forward = resolveCommandStrategicRiskConvergence(items, resolution);
    const reversed = resolveCommandStrategicRiskConvergence([...items].reverse(), resolution);
    expect(forward).toEqual(reversed);
    expect(forward.find((entry) => entry.convergentStrategicRisk)!.id).toBe("action-1");
    expect(JSON.stringify(items)).toBe(before);
  });

  it("integrates with buildCommandAttention output: a pillar-only Icarus risk folds into a convergent blocked action", () => {
    const signals = icarusSignals([icarusAssessment({ linkedRecords: [{ recordType: "Pillar", recordId: "Excavation" }] })]);
    const command = buildCommandAttention(input({ actions: [action({ status: "Blocked" })], icarus: signals }));
    const icarusKey = `Icarus:${signals[0].assessmentId}`;
    const actionItem = command.items.find((entry) => entry.objectType === "Action")!;
    expect(command.items.map((entry) => `${entry.objectType}:${entry.id}`)).toContain(icarusKey);
    const resolved = resolveCommandStrategicRiskConvergence(command.items, resolveStrategicRiskConvergence(
      [{ clusterKey: `cluster:Action:${actionItem.id}`, rootRecordKey: `Action:${actionItem.id}`, records: [{ recordKey: `Action:${actionItem.id}` }, { recordKey: icarusKey }] }],
      [icarusKey],
    ));
    expect(resolved.map((entry) => `${entry.objectType}:${entry.id}`)).not.toContain(icarusKey);
    expect(resolved.find((entry) => entry.id === actionItem.id)!.strategicRisk!.references[0].assessmentId).toBe(signals[0].assessmentId);
    expect(resolveCommandStrategicRiskConvergence(command.items, new Map())).toEqual(command.items);
  });
});
