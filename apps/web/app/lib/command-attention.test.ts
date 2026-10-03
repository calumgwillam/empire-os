import { describe, expect, it } from "vitest";
import { buildOrganisationalLearning } from "./organisational-learning";
import type { LearningAttentionInput } from "./learning-attention";
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
      ...source, learning: learningFor({ objectType: "Project", id: "project-1" }, "Reviewed"),
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
    const learning = [...change, ...learningFor(target, "Reviewed", "another-lesson"), ...change];
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
