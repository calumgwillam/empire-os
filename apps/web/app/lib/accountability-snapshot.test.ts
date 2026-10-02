import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";
import {
  buildAccountabilitySnapshot,
  type AccountabilityPersonInput,
  type AccountabilitySnapshotInput,
  type AccountabilitySnapshotResult,
} from "./accountability-snapshot";

const nowMs = Date.UTC(2026, 9, 2, 12);
const past = "2026-10-02T11:59:59.999Z";
const present = "2026-10-02T12:00:00.000Z";
const future = "2026-10-02T12:00:00.001Z";
const operator = { id: "operator", name: "Operator" };
const people = [
  { ...operator, status: "Active" },
  { id: "founder", name: "Founder", status: "Active" },
  { id: "inactive", name: "Former operator", status: "Inactive" },
];

type ActionInput = AccountabilitySnapshotInput["actions"][number];
type ProjectInput = AccountabilitySnapshotInput["projects"][number];
type LeadInput = AccountabilitySnapshotInput["activeLeads"][number];
type DecisionInput = AccountabilitySnapshotInput["decisions"][number];
type ProblemInput = AccountabilitySnapshotInput["problems"][number];

function input(overrides: Partial<AccountabilitySnapshotInput> = {}): AccountabilitySnapshotInput {
  return {
    person: operator,
    orderedPeople: people,
    actions: [],
    projects: [],
    activeLeads: [],
    decisions: [],
    problems: [],
    nowMs,
    ...overrides,
  };
}

function action(overrides: Partial<ActionInput> = {}): ActionInput {
  return { owner: "Operator", status: "Open", isActive: true, isWaiting: false, ...overrides };
}

function project(overrides: Partial<ProjectInput> = {}): ProjectInput {
  return { owner: "Operator", status: "Open", isActive: true, ...overrides };
}

function lead(overrides: Partial<LeadInput> = {}): LeadInput {
  return { owner: "Operator", status: "New", ...overrides };
}

function decision(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return { decisionMaker: "Operator", decisionStatus: "Draft", ...overrides };
}

function problem(overrides: Partial<ProblemInput> = {}): ProblemInput {
  return { owner: "Operator", isUnresolved: true, ...overrides };
}

type PageAction = Omit<ActionInput, "isActive" | "isWaiting"> & {
  id: string;
  actionTitle?: string;
  createdDate?: string;
  releaseSourceType?: string;
  releaseSourceId?: string;
  releaseIntent?: string;
};
type PageProject = Omit<ProjectInput, "isActive"> & { id: string; projectName?: string; health?: string; ownerPersonId?: string };
type PageLead = LeadInput & { id: string; archived?: boolean; dateCreated?: string; ownerPersonId?: string };
type PageDecision = DecisionInput & { id: string };
type PageProblem = Omit<ProblemInput, "isUnresolved"> & { id: string; problemStatus: string; ownerPersonId?: string };
type PagePerson = AccountabilityPersonInput & { status?: string; role?: string };
type PageInput = {
  person: PagePerson | null;
  orderedPeople: AccountabilitySnapshotInput["orderedPeople"];
  actionRecords: PageAction[];
  projects: PageProject[];
  activeLeads: PageLead[];
  decisionRecords: PageDecision[];
  problemRecords: PageProblem[];
  nowMs: number;
};
type PageSnapshot = Omit<AccountabilitySnapshotResult,
  "ownedActions" | "overdueActions" | "blockedActions" | "otherOpenActions"
  | "activeProjects" | "blockedProjects" | "otherActiveProjects"
  | "pipelineLeads" | "followUpLeads" | "otherPipelineLeads"
  | "waitingDecisions" | "unresolvedProblems"> & {
  person: PagePerson | null;
  ownedActions: PageAction[];
  overdueActions: PageAction[];
  blockedActions: PageAction[];
  otherOpenActions: PageAction[];
  activeProjects: PageProject[];
  blockedProjects: PageProject[];
  otherActiveProjects: PageProject[];
  pipelineLeads: PageLead[];
  followUpLeads: PageLead[];
  otherPipelineLeads: PageLead[];
  waitingDecisions: PageDecision[];
  unresolvedProblems: PageProblem[];
};

// Run only the actual page adapter and its authoritative status helpers, not the client component.
function pageSnapshot(overrides: Partial<PageInput> = {}): {
  snapshot: PageSnapshot;
  projected: AccountabilitySnapshotInput;
} {
  const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
  const section = (start: string, end: string) => {
    const startIndex = page.indexOf(start);
    const endIndex = page.indexOf(end, startIndex);
    if (startIndex < 0 || endIndex < 0) throw new Error(`Missing accountability adapter boundary: ${start}`);
    return page.slice(startIndex, endIndex);
  };
  const source = [
    section("function isActionWaiting(", "\nconst personStatusOptions"),
    section("  const isActionActive =", "  const isReleaseInterventionAction ="),
    section("  const isProblemUnresolved =", "  const isDecisionActive ="),
    section("  const isProjectActive =", "  const delegationReadiness ="),
    section("  const toAccountabilityRiskInput =", "  const personAccountabilitySummaries ="),
    "result = buildAccountabilitySnapshot(person);",
  ].join("\n");
  const { outputText } = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2020, module: ModuleKind.ESNext },
  });
  const pageInput: PageInput = {
    person: operator,
    orderedPeople: people,
    actionRecords: [],
    projects: [],
    activeLeads: [],
    decisionRecords: [],
    problemRecords: [],
    nowMs,
    ...overrides,
  };
  let projected: AccountabilitySnapshotInput | undefined;
  const context: { result: PageSnapshot | undefined } = { result: undefined };
  runInNewContext(outputText, Object.assign(context, pageInput, {
    Date: { now: () => pageInput.nowMs },
    buildAccountabilitySnapshotPolicy: (value: AccountabilitySnapshotInput) => {
      projected = value;
      return buildAccountabilitySnapshot(value);
    },
  }), { timeout: 1000 });
  if (!context.result || !projected) throw new Error("Accountability page adapter did not return a snapshot");
  return { snapshot: context.result, projected };
}

describe("Accountability snapshot empty and output contracts", () => {
  it("returns every existing bucket and zero counts for an empty named-person snapshot", () => {
    expect(buildAccountabilitySnapshot(input())).toEqual({
      ownerLabel: "Operator",
      ownedActions: [],
      overdueActions: [],
      blockedActions: [],
      otherOpenActions: [],
      activeProjects: [],
      blockedProjects: [],
      otherActiveProjects: [],
      pipelineLeads: [],
      followUpLeads: [],
      otherPipelineLeads: [],
      waitingDecisions: [],
      unresolvedProblems: [],
      blockedCount: 0,
      carriedCount: 0,
      attentionCount: 0,
    });
  });

  it("labels null as Unassigned but preserves a supplied person's untrimmed or blank name", () => {
    expect(buildAccountabilitySnapshot(input({ person: null })).ownerLabel).toBe("Unassigned");
    expect(buildAccountabilitySnapshot(input({ person: { id: "p", name: " Operator " } })).ownerLabel).toBe(" Operator ");
    expect(buildAccountabilitySnapshot(input({ person: { id: "p", name: "" } })).ownerLabel).toBe("");
  });
});

describe("Accountability named-person ownership", () => {
  it.each([
    { name: "normalised text", owner: "  oPeRaToR  ", expected: true },
    { name: "different name", owner: "Founder", expected: false },
    { name: "missing name", owner: undefined, expected: false },
    { name: "empty name", owner: "", expected: false },
    { name: "whitespace", owner: "  ", expected: false },
    { name: "Unassigned sentinel", owner: " UnAssigned ", expected: false },
  ])("uses exact name ownership for $name across all five record families", ({ owner, expected }) => {
    const result = buildAccountabilitySnapshot(input({
      actions: [action({ owner })],
      projects: [project({ owner })],
      activeLeads: [lead({ owner })],
      decisions: [decision({ decisionMaker: owner })],
      problems: [problem({ owner })],
    }));
    const indexes = expected ? [0] : [];
    expect(result.ownedActions).toEqual(indexes);
    expect(result.activeProjects).toEqual(indexes);
    expect(result.pipelineLeads).toEqual(indexes);
    expect(result.waitingDecisions).toEqual(indexes);
    expect(result.unresolvedProblems).toEqual(indexes);
  });

  it("gives a truthy action person id precedence over text, without validating selected-person activity", () => {
    const result = buildAccountabilitySnapshot(input({
      person: { id: "inactive", name: "Former operator" },
      actions: [
        action({ owner: "Founder", ownerPersonId: "inactive" }),
        action({ owner: "Former operator", ownerPersonId: "missing" }),
        action({ owner: "Former operator", ownerPersonId: "" }),
        action({ owner: "Former operator" }),
      ],
    }));
    expect(result.ownedActions).toEqual([0, 2, 3]);
  });

  it("allows name matching for inactive people and duplicate names rather than enforcing active-owner resolution", () => {
    const result = buildAccountabilitySnapshot(input({
      person: { id: "different-id", name: "Former operator" },
      actions: [action({ owner: "Former operator" })],
      projects: [project({ owner: "Former operator" })],
      activeLeads: [lead({ owner: "Former operator" })],
      decisions: [decision({ decisionMaker: "Former operator" })],
      problems: [problem({ owner: "Former operator" })],
    }));
    expect(result.carriedCount).toBe(5);
  });

  it("prevents blank or sentinel names from claiming textual ownership but permits direct action ids", () => {
    for (const name of ["", "  ", "Unassigned"]) {
      const result = buildAccountabilitySnapshot(input({
        person: { id: "p", name },
        actions: [action({ owner: name }), action({ owner: "", ownerPersonId: "p" })],
        projects: [project({ owner: name })],
        activeLeads: [lead({ owner: name })],
        decisions: [decision({ decisionMaker: name })],
        problems: [problem({ owner: name })],
      }));
      expect(result.ownedActions).toEqual([1]);
      expect(result.carriedCount).toBe(1);
    }
  });

  it("does not impose special founder-authority, access-level, or delegation eligibility rules", () => {
    const result = buildAccountabilitySnapshot(input({
      person: { id: "founder", name: "Founder" },
      actions: [action({ ownerPersonId: "founder", owner: "Operator" })],
      projects: [project({ owner: "Founder" })],
      activeLeads: [lead({ owner: "Founder" })],
      decisions: [decision({ decisionMaker: "Founder" })],
      problems: [problem({ owner: "Founder" })],
    }));
    expect(result.carriedCount).toBe(5);
  });
});

describe("Accountability unassigned and ghost ownership", () => {
  it.each([
    { owner: undefined, expected: true },
    { owner: "", expected: true },
    { owner: "  ", expected: true },
    { owner: " UnAssigned ", expected: true },
    { owner: "Ghost", expected: true },
    { owner: "Former operator", expected: true },
    { owner: "  oPeRaToR ", expected: false },
  ])("classifies unassigned operational ownership for $owner", ({ owner, expected }) => {
    const result = buildAccountabilitySnapshot(input({
      person: null,
      actions: [action({ owner })],
      projects: [project({ owner })],
      activeLeads: [lead({ owner })],
      problems: [problem({ owner })],
    }));
    expect(result.ownedActions).toEqual(expected ? [0] : []);
    expect(result.activeProjects).toEqual(expected ? [0] : []);
    expect(result.pipelineLeads).toEqual(expected ? [0] : []);
    expect(result.unresolvedProblems).toEqual(expected ? [0] : []);
  });

  it("suppresses action gaps for an active id, then falls back to valid text for missing or inactive ids", () => {
    const result = buildAccountabilitySnapshot(input({
      person: null,
      actions: [
        action({ owner: "", ownerPersonId: "operator" }),
        action({ owner: "Ghost", ownerPersonId: "operator" }),
        action({ owner: "Operator", ownerPersonId: "missing" }),
        action({ owner: "Operator", ownerPersonId: "inactive" }),
        action({ owner: "Ghost", ownerPersonId: "inactive" }),
        action({ owner: "", ownerPersonId: "missing" }),
        action({ owner: "", ownerPersonId: "" }),
      ],
    }));
    expect(result.ownedActions).toEqual([4, 5, 6]);
  });

  it("accepts any active matching id or name even if earlier duplicate People entries are inactive", () => {
    const result = buildAccountabilitySnapshot(input({
      person: null,
      orderedPeople: [
        { id: "same", name: "Operator", status: "Inactive" },
        { id: "same", name: "Operator", status: "Active" },
      ],
      actions: [action({ owner: "Ghost", ownerPersonId: "same" })],
      projects: [project()],
      activeLeads: [lead()],
      problems: [problem()],
    }));
    expect(result.carriedCount).toBe(0);
  });

  it("keeps the Unassigned sentinel a gap even when an active person has that name", () => {
    const result = buildAccountabilitySnapshot(input({
      person: null,
      orderedPeople: [{ id: "sentinel", name: "Unassigned", status: "Active" }],
      actions: [action({ owner: "Unassigned" }), action({ owner: "Unassigned", ownerPersonId: "sentinel" })],
      projects: [project({ owner: "Unassigned" })],
    }));
    expect(result.ownedActions).toEqual([0]);
    expect(result.activeProjects).toEqual([0]);
  });

  it("limits unassigned decisions to blank/sentinel makers, deliberately excluding ghost and inactive names", () => {
    const result = buildAccountabilitySnapshot(input({
      person: null,
      decisions: [
        decision({ decisionMaker: undefined }),
        decision({ decisionMaker: " " }),
        decision({ decisionMaker: " Unassigned " }),
        decision({ decisionMaker: "Ghost" }),
        decision({ decisionMaker: "Former operator" }),
        decision({ decisionMaker: "Operator" }),
      ],
    }));
    expect(result.waitingDecisions).toEqual([0, 1, 2]);
  });

  it("uses exact Active status for valid operational-owner matching", () => {
    expect(buildAccountabilitySnapshot(input({
      person: null,
      orderedPeople: [{ ...operator, status: "active" }],
      actions: [action({ ownerPersonId: "operator" })],
      projects: [project()],
    })).carriedCount).toBe(2);
  });

  it("preserves the asymmetry between a stale action id's named ownership and its unassigned text fallback", () => {
    const source = input({
      actions: [action({ owner: "Operator", ownerPersonId: "missing" })],
    });
    expect(buildAccountabilitySnapshot(source).ownedActions).toEqual([]);
    expect(buildAccountabilitySnapshot({ ...source, person: null }).ownedActions).toEqual([]);
    expect(buildAccountabilitySnapshot({ ...source, person: { id: "missing", name: "Different name" } }).ownedActions).toEqual([0]);
  });
});

describe("Accountability classification and counts", () => {
  it("keeps overdue and blocked overlap and its deliberate double contribution to attention", () => {
    const result = buildAccountabilitySnapshot(input({
      actions: [
        action({ status: "Blocked", dueDate: present }),
        action({ dueDate: past }),
        action({ status: "Waiting", isWaiting: true, dueDate: past }),
        action({ dueDate: future }),
        action({ isActive: false, dueDate: past }),
      ],
      projects: [project({ status: " BLOCKED " }), project()],
      activeLeads: [lead({ status: "Follow-Up" }), lead()],
      decisions: [decision()],
      problems: [problem()],
    }));
    expect(result).toMatchObject({
      ownedActions: [1, 2, 0, 3],
      overdueActions: [1, 0],
      blockedActions: [0],
      otherOpenActions: [2, 3],
      activeProjects: [0, 1],
      blockedProjects: [0],
      otherActiveProjects: [1],
      pipelineLeads: [0, 1],
      followUpLeads: [0],
      otherPipelineLeads: [1],
      waitingDecisions: [0],
      unresolvedProblems: [0],
      blockedCount: 2,
      carriedCount: 10,
      attentionCount: 6,
    });
  });

  it("trusts projected active/waiting/unresolved helpers rather than deriving substitute rules", () => {
    const result = buildAccountabilitySnapshot(input({
      actions: [
        action({ status: "Completed", isActive: true }),
        action({ status: "Open", isActive: false }),
        action({ status: "Open", isWaiting: true, dueDate: present }),
      ],
      projects: [project({ status: "Completed", isActive: true }), project({ isActive: false })],
      problems: [problem(), problem({ isUnresolved: false })],
    }));
    expect(result.ownedActions).toEqual([0, 2]);
    expect(result.overdueActions).toEqual([]);
    expect(result.activeProjects).toEqual([0]);
    expect(result.unresolvedProblems).toEqual([0]);
  });

  it("treats only exact Blocked action status as blocked, but normalises project blocked status", () => {
    const result = buildAccountabilitySnapshot(input({
      actions: [action({ status: "blocked" }), action({ status: " Blocked " }), action({ status: "Blocked" })],
      projects: [project({ status: " blocked " }), project({ status: "BLOCKED" }), project({ status: "Waiting" })],
    }));
    expect(result.blockedActions).toEqual([2]);
    expect(result.blockedProjects).toEqual([0, 1]);
    expect(result.otherActiveProjects).toEqual([2]);
  });

  it("excludes only exact Won and Lost leads and preserves pipeline source order", () => {
    const statuses = ["New", "Contacted", "Quote Needed", "Quote Sent", "Follow-Up", "On Hold", "Won", "Lost", "won"];
    const result = buildAccountabilitySnapshot(input({
      activeLeads: statuses.map((status) => lead({ status })),
    }));
    expect(result.pipelineLeads).toEqual([0, 1, 2, 3, 4, 5, 8]);
    expect(result.followUpLeads).toEqual([4]);
    expect(result.otherPipelineLeads).toEqual([0, 1, 2, 3, 5, 8]);
  });

  it("includes Follow-Up leads without a due date and any pipeline status with a due follow-up", () => {
    const result = buildAccountabilitySnapshot(input({
      activeLeads: [
        lead({ status: "Follow-Up" }),
        lead({ status: "Follow-Up", followUpDate: "invalid" }),
        lead({ status: "Follow-Up", followUpDate: future }),
        lead({ status: "On Hold", followUpDate: present }),
        lead({ status: "Quote Sent", followUpDate: past }),
        lead({ status: "New", followUpDate: future }),
        lead({ status: "Won", followUpDate: past }),
      ],
    }));
    expect(result.followUpLeads).toEqual([0, 1, 2, 3, 4]);
    expect(result.otherPipelineLeads).toEqual([5]);
  });

  it("includes Draft and Under Review decisions regardless of dates and only due Active decisions", () => {
    const result = buildAccountabilitySnapshot(input({
      decisions: [
        decision({ decisionStatus: "Draft", reviewDate: future }),
        decision({ decisionStatus: "Under Review", reviewDate: "invalid" }),
        decision({ decisionStatus: "Active", reviewDate: present }),
        decision({ decisionStatus: "Active", reviewDate: past }),
        decision({ decisionStatus: "Active", reviewDate: future }),
        decision({ decisionStatus: "Active" }),
        decision({ decisionStatus: "Completed", reviewDate: past }),
        decision({ decisionStatus: "Reversed", reviewDate: past }),
        decision({ decisionStatus: "draft" }),
      ],
    }));
    expect(result.waitingDecisions).toEqual([0, 1, 2, 3]);
  });

  it("counts unresolved problems as carried work but not automatically as attention", () => {
    const result = buildAccountabilitySnapshot(input({
      problems: [problem({ severity: "Critical" }), problem({ severity: "High" })],
    }));
    expect(result.carriedCount).toBe(2);
    expect(result.attentionCount).toBe(0);
    expect(result.blockedCount).toBe(0);
  });
});

describe("Accountability exact timestamp semantics", () => {
  it.each([
    { name: "missing", value: undefined, due: false },
    { name: "empty", value: "", due: false },
    { name: "invalid", value: "invalid", due: false },
    { name: "before now", value: past, due: true },
    { name: "equal to now", value: present, due: true },
    { name: "one millisecond later", value: future, due: false },
    { name: "epoch zero", value: "1970-01-01T00:00:00.000Z", due: true },
    { name: "negative timestamp", value: "1969-12-31T23:59:59.999Z", due: true },
    { name: "equivalent offset", value: "2026-10-02T13:00:00+01:00", due: true },
  ])("preserves $name date behaviour for overdue actions, follow-ups, and active decisions", ({ value, due }) => {
    const result = buildAccountabilitySnapshot(input({
      actions: [action({ dueDate: value })],
      activeLeads: [lead({ followUpDate: value })],
      decisions: [decision({ decisionStatus: "Active", reviewDate: value })],
    }));
    expect(result.overdueActions).toEqual(due ? [0] : []);
    expect(result.followUpLeads).toEqual(due ? [0] : []);
    expect(result.waitingDecisions).toEqual(due ? [0] : []);
  });

  it("uses explicit nowMs without calendar-day conversion or implicit clock reads", () => {
    const source = input({
      actions: [action({ dueDate: future })],
      activeLeads: [lead({ followUpDate: future })],
      decisions: [decision({ decisionStatus: "Active", reviewDate: future })],
    });
    expect(buildAccountabilitySnapshot(source).attentionCount).toBe(0);
    expect(buildAccountabilitySnapshot({ ...source, nowMs: nowMs + 1 }).attentionCount).toBe(3);
  });
});

describe("Accountability risk and age ordering", () => {
  it("sorts risk descending, case-insensitively without trimming, using priority before severity", () => {
    const result = buildAccountabilitySnapshot(input({
      actions: [
        action({ priority: "Low" }),
        action({ priority: "HIGH" }),
        action({ priority: "critical" }),
        action({ priority: "Medium" }),
        action({ severity: "Critical" }),
        action({ priority: "Low", severity: "Critical" }),
        action({ priority: " High " }),
        action({ priority: "", severity: "High" }),
      ],
    }));
    expect(result.ownedActions).toEqual([2, 4, 1, 7, 3, 0, 5, 6]);
  });

  it("uses dueDate, then targetCompletionDate, then createdAt, never falling through an invalid truthy date", () => {
    const result = buildAccountabilitySnapshot(input({
      actions: [
        action({ dueDate: "2026-10-03", targetCompletionDate: "2026-01-01", createdAt: "2025-01-01" }),
        action({ targetCompletionDate: "2026-10-02", createdAt: "2025-01-01" }),
        action({ createdAt: "2026-10-01" }),
        action({ dueDate: "invalid", targetCompletionDate: "2025-01-01" }),
        action({}),
        action({ dueDate: "", targetCompletionDate: "", createdAt: "2026-09-30" }),
        action({ dueDate: "1969-12-31T23:59:59.999Z" }),
      ],
    }));
    expect(result.ownedActions).toEqual([6, 3, 4, 5, 2, 1, 0]);
  });

  it("applies identical sorting to every action/project/problem bucket and retains stable ties", () => {
    const result = buildAccountabilitySnapshot(input({
      actions: [
        action({ status: "Blocked", dueDate: present, priority: "Low" }),
        action({ status: "Blocked", dueDate: past, priority: "High" }),
        action({ dueDate: future, priority: "High" }),
        action({ dueDate: future, priority: "Critical" }),
      ],
      projects: [
        project({ status: "Blocked", targetCompletionDate: "2026-10-03" }),
        project({ status: "Blocked", targetCompletionDate: "2026-10-01" }),
        project({ targetCompletionDate: "2026-10-03" }),
        project({ targetCompletionDate: "2026-10-01" }),
      ],
      problems: [
        problem({ severity: "Low", createdAt: "2025-01-01" }),
        problem({ severity: "Critical", createdAt: "2026-01-01" }),
        problem({ severity: "Critical", createdAt: "2026-01-01" }),
      ],
    }));
    expect(result.ownedActions).toEqual([3, 1, 2, 0]);
    expect(result.overdueActions).toEqual([1, 0]);
    expect(result.blockedActions).toEqual([1, 0]);
    expect(result.otherOpenActions).toEqual([3, 2]);
    expect(result.activeProjects).toEqual([1, 3, 0, 2]);
    expect(result.blockedProjects).toEqual([1, 0]);
    expect(result.otherActiveProjects).toEqual([3, 2]);
    expect(result.unresolvedProblems).toEqual([1, 2, 0]);
  });

  it("does not risk-sort pipeline leads, follow-ups, other leads, or waiting decisions", () => {
    const result = buildAccountabilitySnapshot(input({
      activeLeads: [
        lead({ followUpDate: present }),
        lead({ followUpDate: past }),
        lead({ followUpDate: future }),
        lead(),
      ],
      decisions: [
        decision({ decisionStatus: "Active", reviewDate: present }),
        decision({ decisionStatus: "Active", reviewDate: past }),
        decision(),
      ],
    }));
    expect(result.pipelineLeads).toEqual([0, 1, 2, 3]);
    expect(result.followUpLeads).toEqual([0, 1]);
    expect(result.otherPipelineLeads).toEqual([2, 3]);
    expect(result.waitingDecisions).toEqual([0, 1, 2]);
  });

  it("retains duplicate entries and repeated object references rather than deduplicating work", () => {
    const repeatedAction = action({ status: "Blocked", dueDate: past });
    const repeatedLead = lead({ status: "Follow-Up" });
    const result = buildAccountabilitySnapshot(input({
      actions: [repeatedAction, repeatedAction],
      projects: [project(), project()],
      activeLeads: [repeatedLead, repeatedLead],
      decisions: [decision(), decision()],
      problems: [problem(), problem()],
    }));
    expect(result.ownedActions).toEqual([0, 1]);
    expect(result.overdueActions).toEqual([0, 1]);
    expect(result.blockedActions).toEqual([0, 1]);
    expect(result.otherOpenActions).toEqual([]);
    expect(result.carriedCount).toBe(10);
    expect(result.attentionCount).toBe(8);
  });
});

describe("Accountability page adapter compatibility", () => {
  it("preserves authoritative active/waiting action filters and includes release-intervention actions", () => {
    const statuses = ["Open", "In Progress", "Blocked", "Waiting", "Completed", "Cancelled", "open"];
    const records = statuses.map((status, index) => ({
      id: String(index),
      status,
      owner: "Operator",
      dueDate: past,
      releaseSourceType: "Project",
      releaseSourceId: "source",
      releaseIntent: "Unblock First",
    }));
    const { snapshot, projected } = pageSnapshot({ actionRecords: records });
    expect(snapshot.ownedActions.map(({ id }) => id)).toEqual(["0", "1", "2", "3"]);
    expect(snapshot.overdueActions.map(({ id }) => id)).toEqual(["0", "1", "2"]);
    expect(snapshot.blockedActions.map(({ id }) => id)).toEqual(["2"]);
    expect(snapshot.otherOpenActions.map(({ id }) => id)).toEqual(["3"]);
    expect(projected.actions.map(({ isActive, isWaiting }) => [isActive, isWaiting])).toEqual([
      [true, false], [true, false], [true, false], [true, true],
      [false, false], [false, false], [false, false],
    ]);
  });

  it("keeps broad legacy project-active status semantics and uses status, not health, for blocked buckets", () => {
    const statuses = ["Open", "In Progress", " blocked ", "Waiting", "Draft", "Unknown", "", "completed", " Closed ", "FINAL", "cancelled", "canceled"];
    const { snapshot } = pageSnapshot({
      projects: statuses.map((status, index) => ({
        id: String(index), status, owner: "Operator", health: "Blocked",
      })),
    });
    expect(snapshot.activeProjects.map(({ id }) => id)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(snapshot.blockedProjects.map(({ id }) => id)).toEqual(["2"]);
    expect(snapshot.otherActiveProjects.map(({ id }) => id)).toEqual(["0", "1", "3", "4", "5", "6"]);
  });

  it("retains unresolved problem status filtering and the supplied activeLeads collection", () => {
    const statuses = ["Open", "Investigating", "Action required", "Resolved", "Closed", "open"];
    const activeLead = { id: "included", owner: "Operator", status: "New" };
    const { snapshot, projected } = pageSnapshot({
      problemRecords: statuses.map((problemStatus, index) => ({
        id: String(index), problemStatus, owner: "Operator",
      })),
      activeLeads: [activeLead],
    });
    expect(snapshot.unresolvedProblems.map(({ id }) => id)).toEqual(["0", "1", "2"]);
    expect(projected.problems.map(({ isUnresolved }) => isUnresolved)).toEqual([true, true, true, false, false, false]);
    expect(snapshot.pipelineLeads).toEqual([activeLead]);
  });

  it("restores original records, duplicate ids, repeated references, and the full person object", () => {
    const person = { ...operator, status: "Inactive", role: "Manager" };
    const shared = { id: "duplicate", status: "Blocked", owner: "Operator", dueDate: past, actionTitle: "Full action" };
    const another = { ...shared, dueDate: future, actionTitle: "Different same-id action" };
    const originalProject = { id: "p", status: "Open", owner: "Operator", projectName: "Full project" };
    const originalLead = { id: "l", status: "Follow-Up", owner: "Operator" };
    const originalDecision = { id: "d", decisionStatus: "Draft", decisionMaker: "Operator" };
    const originalProblem = { id: "problem", problemStatus: "Open", owner: "Operator" };
    const { snapshot } = pageSnapshot({
      person,
      actionRecords: [shared, shared, another],
      projects: [originalProject],
      activeLeads: [originalLead],
      decisionRecords: [originalDecision],
      problemRecords: [originalProblem],
    });
    expect(snapshot.person).toBe(person);
    expect(snapshot.ownedActions).toEqual([shared, shared, another]);
    expect(snapshot.ownedActions[0]).toBe(shared);
    expect(snapshot.ownedActions[1]).toBe(shared);
    expect(snapshot.ownedActions[2]).toBe(another);
    expect(snapshot.overdueActions).toEqual([shared, shared]);
    expect(snapshot.blockedActions).toEqual([shared, shared, another]);
    expect(snapshot.activeProjects[0]).toBe(originalProject);
    expect(snapshot.pipelineLeads[0]).toBe(originalLead);
    expect(snapshot.waitingDecisions[0]).toBe(originalDecision);
    expect(snapshot.unresolvedProblems[0]).toBe(originalProblem);
    expect(snapshot.carriedCount).toBe(7);
    expect(snapshot.attentionCount).toBe(7);
  });

  it("projects only narrow facts and uses createdAt, not the action's separate createdDate", () => {
    const { snapshot, projected } = pageSnapshot({
      actionRecords: [
        { id: "first", status: "Open", owner: "Operator", actionTitle: "Private content", createdDate: "2026-10-02" },
        { id: "second", status: "Open", owner: "Operator", createdAt: "1969-12-31T23:59:59.999Z" },
      ],
    });
    expect(snapshot.ownedActions.map(({ id }) => id)).toEqual(["second", "first"]);
    expect(projected.actions[0]).not.toHaveProperty("id");
    expect(projected.actions[0]).not.toHaveProperty("actionTitle");
    expect(projected.actions[0]).not.toHaveProperty("createdDate");
    expect(projected.person).toEqual(operator);
    expect(projected.orderedPeople).toEqual(people);
    expect(projected.nowMs).toBe(nowMs);
  });

  it("preserves risk-field precedence for legacy extra fields on projects and problems", () => {
    const { snapshot } = pageSnapshot({
      projects: [
        { id: "high", status: "Open", owner: "Operator", priority: "High", severity: "Critical" },
        { id: "critical", status: "Open", owner: "Operator", severity: "Critical" },
      ],
      problemRecords: [
        { id: "low", problemStatus: "Open", owner: "Operator", priority: "Low", severity: "Critical" },
        { id: "high", problemStatus: "Open", owner: "Operator", severity: "High" },
      ],
    });
    expect(snapshot.activeProjects.map(({ id }) => id)).toEqual(["critical", "high"]);
    expect(snapshot.unresolvedProblems.map(({ id }) => id)).toEqual(["high", "low"]);
  });

  it("returns the unchanged page contract for null person and empty records", () => {
    const { snapshot } = pageSnapshot({ person: null });
    expect(snapshot).toEqual({ person: null, ...buildAccountabilitySnapshot(input({ person: null })) });
  });

  it("ignores legacy person ids on projects, leads and problems while retaining action id precedence", () => {
    const records: Partial<PageInput> = {
      actionRecords: [{ id: "a", status: "Open", owner: "Ghost", ownerPersonId: "operator" }],
      projects: [{ id: "p", status: "Open", owner: "Ghost", ownerPersonId: "operator" }],
      activeLeads: [{ id: "l", status: "New", owner: "Ghost", ownerPersonId: "operator" }],
      problemRecords: [{ id: "problem", problemStatus: "Open", owner: "Ghost", ownerPersonId: "operator" }],
    };
    const named = pageSnapshot(records).snapshot;
    expect(named.ownedActions.map(({ id }) => id)).toEqual(["a"]);
    expect(named.activeProjects).toEqual([]);
    expect(named.pipelineLeads).toEqual([]);
    expect(named.unresolvedProblems).toEqual([]);
    const unassigned = pageSnapshot({ ...records, person: null }).snapshot;
    expect(unassigned.ownedActions).toEqual([]);
    expect(unassigned.activeProjects.map(({ id }) => id)).toEqual(["p"]);
    expect(unassigned.pipelineLeads.map(({ id }) => id)).toEqual(["l"]);
    expect(unassigned.unresolvedProblems.map(({ id }) => id)).toEqual(["problem"]);
  });

  it("returns no work when all page records are closed or assigned elsewhere", () => {
    const { snapshot } = pageSnapshot({
      actionRecords: [{ id: "a", status: "Completed", owner: "Operator" }],
      projects: [{ id: "p", status: "Cancelled", owner: "Operator" }],
      activeLeads: [{ id: "l", status: "Won", owner: "Operator" }],
      decisionRecords: [{ id: "d", decisionStatus: "Completed", decisionMaker: "Operator" }],
      problemRecords: [{ id: "problem", problemStatus: "Resolved", owner: "Operator" }],
    });
    expect(snapshot).toEqual({ person: operator, ...buildAccountabilitySnapshot(input()) });
  });
});

describe("Accountability snapshot determinism and non-mutation", () => {
  it("does not mutate inputs, record fields, arrays, or People, and returns independent result arrays", () => {
    const source = input({
      actions: [
        action({ priority: "Low", dueDate: past }),
        action({ priority: "Critical", status: "Blocked", dueDate: present }),
      ],
      projects: [project({ status: "Blocked" })],
      activeLeads: [lead({ status: "Follow-Up" })],
      decisions: [decision()],
      problems: [problem()],
    });
    const before = structuredClone(source);
    for (const records of [
      source.orderedPeople, source.actions, source.projects,
      source.activeLeads, source.decisions, source.problems,
    ]) {
      records.forEach(Object.freeze);
      Object.freeze(records);
    }
    Object.freeze(source.person);
    Object.freeze(source);

    const first = buildAccountabilitySnapshot(source);
    expect(buildAccountabilitySnapshot(source)).toEqual(first);
    expect(source).toEqual(before);
    first.ownedActions.reverse();
    first.overdueActions.push(999);
    expect(buildAccountabilitySnapshot(source).ownedActions).toEqual([1, 0]);
    expect(buildAccountabilitySnapshot(source).overdueActions).toEqual([1, 0]);
  });

  it("leaves page collections and source records unchanged during projection and restoration", () => {
    const pageInput: Partial<PageInput> = {
      person: { ...operator, status: "Inactive" },
      orderedPeople: people,
      actionRecords: [
        { id: "a", owner: "Operator", status: "Open", priority: "Low" },
        { id: "b", owner: "Operator", status: "Blocked", priority: "Critical" },
      ],
      projects: [{ id: "p", owner: "Operator", status: "Open" }],
      activeLeads: [{ id: "l", owner: "Operator", status: "Follow-Up" }],
      decisionRecords: [{ id: "d", decisionMaker: "Operator", decisionStatus: "Draft" }],
      problemRecords: [{ id: "problem", owner: "Operator", problemStatus: "Open" }],
    };
    const before = structuredClone(pageInput);
    const first = pageSnapshot(pageInput).snapshot;
    expect(pageSnapshot(pageInput).snapshot).toEqual(first);
    expect(pageInput).toEqual(before);
  });
});
