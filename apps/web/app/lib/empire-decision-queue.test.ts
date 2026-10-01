import { describe, expect, it } from "vitest";
import {
  buildEmpireDecisionQueue,
  mergeFounderReviewQueue,
  type EmpireDecisionQueueInput,
  type FounderAuthorityCandidate,
  type FounderReviewCandidate,
} from "./empire-decision-queue";

const NOW = Date.parse("2025-04-10T12:00:00.000Z");
type Decision = EmpireDecisionQueueInput["decisions"][number];
type Problem = EmpireDecisionQueueInput["problems"][number];
type Action = EmpireDecisionQueueInput["actions"][number];
type Project = EmpireDecisionQueueInput["projects"][number];
type Opportunity = EmpireDecisionQueueInput["opportunities"][number];
type Lead = EmpireDecisionQueueInput["leads"][number];

const founder = {
  id: "founder-id",
  name: "Founder",
  role: "Founder",
  accessLevel: "Founder",
  status: "Active",
  responsibilities: "Operations",
  authority: "Full",
  pillar: "Operations",
};

const decision = (overrides: Partial<Decision> = {}): Decision => ({
  id: "decision-1",
  decisionStatus: "Active",
  reviewDate: "",
  riskLevel: "Low",
  decisionTitle: "Decision title",
  title: "Decision title",
  relatedPillar: "Operations",
  relatedArea: "",
  decisionMaker: "Founder",
  decisionStatement: "Decision statement",
  relatedOpportunity: "",
  ...overrides,
});

const problem = (overrides: Partial<Problem> = {}): Problem => ({
  id: "problem-1",
  problemStatus: "Open",
  severity: "Low",
  problemStatement: "Problem statement",
  title: "Problem title",
  owner: "Founder",
  ownerPersonId: "founder-id",
  relatedArea: "",
  relatedPillar: "Operations",
  ...overrides,
});

const action = (overrides: Partial<Action> = {}): Action => ({
  id: "action-1",
  status: "Open",
  priority: "Low",
  releaseSourceId: "",
  actionTitle: "Action title",
  title: "Action title",
  relatedPillar: "Operations",
  owner: "Founder",
  ownerPersonId: "founder-id",
  dueDate: "",
  relatedProblem: "",
  relatedDecision: "",
  relatedOpportunity: "",
  ...overrides,
});

const project = (overrides: Partial<Project> = {}): Project => ({
  id: "project-1",
  status: "in progress",
  relatedActionIds: [],
  relatedDecisionIds: [],
  relatedSystemIds: [],
  area: "Operations",
  owner: "Founder",
  ownerPersonId: "founder-id",
  projectName: "Project title",
  targetCompletionDate: "",
  ...overrides,
});

const opportunity = (overrides: Partial<Opportunity> = {}): Opportunity => ({
  id: "opportunity-1",
  status: "Evaluating",
  strategicFit: "High",
  relatedPillar: "Growth",
  relatedArea: "",
  owner: "Founder",
  opportunityTitle: "Opportunity title",
  title: "Opportunity title",
  ...overrides,
});

const lead = (overrides: Partial<Lead> = {}): Lead => ({
  id: "lead-1",
  status: "New",
  archived: false,
  owner: "Founder",
  ownerPersonId: "founder-id",
  followUpDate: "",
  relatedPillar: "Growth",
  leadName: "Lead title",
  ...overrides,
});

const isActionActive = (record: Action): boolean =>
  ["Open", "In Progress", "Blocked", "Waiting"].includes(record.status);
const isReleaseInterventionAction = (record: Action): boolean =>
  Boolean(record.releaseSourceType && record.releaseSourceId && record.releaseIntent);
const isProjectActive = (record: Project): boolean =>
  !["completed", "closed", "final", "cancelled", "canceled"].includes(record.status.trim().toLowerCase());
const isProblemUnresolved = (record: Problem): boolean =>
  ["Open", "Investigating", "Action required"].includes(record.problemStatus);

const input = (overrides: Partial<EmpireDecisionQueueInput> = {}): EmpireDecisionQueueInput => {
  const value = {
    decisions: [],
    problems: [],
    actions: [],
    projects: [],
    opportunities: [],
    leads: [],
    systems: [],
    orderedPeople: [founder],
    nowMs: NOW,
    ...overrides,
  };
  return {
    ...value,
    activeOwnershipActions: overrides.activeOwnershipActions ?? value.actions.filter((record) => isActionActive(record) && !isReleaseInterventionAction(record)),
    activeOwnershipProjects: overrides.activeOwnershipProjects ?? value.projects.filter(isProjectActive),
    activeOwnershipLeads: overrides.activeOwnershipLeads ?? value.leads.filter((record) => !record.archived && !["Won", "Lost"].includes(record.status)),
    activeOwnershipProblems: overrides.activeOwnershipProblems ?? value.problems.filter(isProblemUnresolved),
  };
};

const reviewCandidate = (overrides: Partial<FounderReviewCandidate> = {}): FounderReviewCandidate => ({
  id: "record-1",
  objectType: "Decision",
  kind: "Decision",
  title: "Review candidate",
  pillar: "Operations",
  owner: "Founder",
  reasonCategory: "High-risk judgement",
  whatIsChanging: "A decision is changing.",
  whyItMatters: "Founder judgement is needed.",
  founderIntervention: "Yes",
  delegationAction: "Founder review required",
  ...overrides,
});

const authorityCandidate = (overrides: Partial<FounderAuthorityCandidate> = {}): FounderAuthorityCandidate => ({
  id: "authority-1",
  objectType: "Project",
  title: "Blocked project",
  pillar: "Operations",
  owner: "Founder",
  reasonCategory: "Blocked project decision",
  whatIsChanging: "A blocked project needs a decision.",
  whyItMatters: "Delivery is blocked.",
  founderIntervention: "Yes",
  delegationAction: "Escalate to founder or executive decision on how to unblock",
  authorityScore: 80,
  ...overrides,
});

describe("buildEmpireDecisionQueue decision review", () => {
  it("uses exact precedence and messages at the review-date boundary", () => {
    const result = buildEmpireDecisionQueue(input({
      decisions: [
        decision({ id: "critical", riskLevel: "Critical", reviewDate: new Date(NOW).toISOString() }),
        decision({ id: "due", decisionStatus: "Under Review", riskLevel: "High", reviewDate: new Date(NOW).toISOString() }),
        decision({ id: "under-review", decisionStatus: "Under Review", riskLevel: "Low" }),
        decision({ id: "high", riskLevel: "High" }),
        decision({ id: "future", reviewDate: new Date(NOW + 1).toISOString() }),
        decision({ id: "inactive", decisionStatus: "Completed", riskLevel: "Critical" }),
      ],
    }));

    expect(result.founderReviewQueue.map(({ id, reasonCategory }) => [id, reasonCategory])).toEqual([
      ["critical", "Critical escalation"],
      ["due", "Review due"],
      ["under-review", "Under review"],
      ["high", "High-risk judgement"],
    ]);
    expect(result.founderReviewQueue.map(({ whyItMatters }) => whyItMatters)).toEqual([
      "This decision carries critical risk and needs founder judgement.",
      "This decision is due or overdue for explicit review, so its assumptions and current path need founder judgement.",
      "This decision is explicitly under review and needs a clear conclusion.",
      "This decision carries high risk and needs founder judgement.",
    ]);
  });

  it("uses the fallback statement and ignores invalid review dates", () => {
    const result = buildEmpireDecisionQueue(input({
      decisions: [
        decision({ id: "empty-statement", decisionStatement: "", riskLevel: "High" }),
        decision({ id: "invalid-date", reviewDate: "not-a-date", riskLevel: "Low" }),
      ],
    }));

    expect(result.founderReviewQueue).toHaveLength(1);
    expect(result.founderReviewQueue[0]).toMatchObject({
      id: "empty-statement",
      whatIsChanging: "No decision statement recorded.",
      delegationAction: "Founder review required",
    });
  });
});

describe("critical escalation candidates", () => {
  it("includes only unresolved critical Problems and eligible critical Actions", () => {
    const result = buildEmpireDecisionQueue(input({
      problems: [
        problem({ id: "problem-open", severity: "Critical" }),
        problem({ id: "problem-action-required", problemStatus: "Action required", severity: "Critical" }),
        problem({ id: "problem-resolved", problemStatus: "Resolved", severity: "Critical" }),
        problem({ id: "problem-medium", severity: "Medium" }),
      ],
      actions: [
        action({ id: "action-open", priority: "Critical", dueDate: new Date(NOW).toISOString() }),
        action({ id: "action-blocked", status: "Blocked", priority: "Critical" }),
        action({ id: "action-waiting", status: "Waiting", priority: "Critical" }),
        action({ id: "action-release", priority: "Critical", releaseSourceType: "Project", releaseSourceId: "p", releaseIntent: "Prepare to Delegate" }),
        action({ id: "action-complete", status: "Completed", priority: "Critical" }),
        action({ id: "action-high", priority: "High" }),
      ],
    }));

    expect(result.founderReviewQueue.map(({ id }) => id)).toEqual([
      "problem-open",
      "problem-action-required",
      "action-open",
      "action-blocked",
    ]);
    expect(result.founderReviewQueue[0]).toMatchObject({
      whatIsChanging: "Critical severity problem still requiring action.",
      whyItMatters: "This critical issue remains open and requires founder-level escalation.",
    });
    expect(result.founderReviewQueue[2]).toMatchObject({
      whyItMatters: `The due date of ${new Date(NOW).toISOString()} has passed, so momentum is slipping and downstream work is delayed.`,
      delegationAction: "Delegate with clear owner follow-up",
    });
    expect(result.founderReviewQueue[3]).toMatchObject({
      whatIsChanging: "This dependency is blocked and preventing progress.",
      delegationAction: "Escalate and remove dependency",
    });
  });
});

describe("cross-pillar issues", () => {
  it("preserves Problem, Action, Project enumeration order and applies the eight-item cap", () => {
    const problems = ["p1", "p2", "p3"].map((id, index) => problem({
      id,
      relatedPillar: `Problem area ${index + 1}`,
    }));
    const actions = ["a1", "a2", "a3", "a4"].map((id, index) => action({
      id,
      relatedPillar: `Action area ${index + 1}`,
      relatedProblem: problems[index % problems.length].id,
    }));
    const projects = ["x1", "x2"].map((id, index) => project({
      id,
      area: `Project area ${index + 1}`,
      relatedActionIds: [actions[index].id],
    }));
    const result = buildEmpireDecisionQueue(input({ problems, actions, projects }));

    expect(result.crossPillarIssues.map(({ objectType, id }) => `${objectType}:${id}`)).toEqual([
      "Problem:p1",
      "Problem:p2",
      "Problem:p3",
      "Action:a1",
      "Action:a2",
      "Action:a3",
      "Action:a4",
      "Project:x1",
    ]);
    expect(result.crossPillarIssues[0]).toMatchObject({
      area: "Problem area 1",
      why: "Linked active work connects this record across Problem area 1 and Action area 1 and Action area 4.",
      founderIntervention: "Maybe",
      delegationAction: "Delegate to the accountable lead with founder review if it becomes material",
    });
  });

  it("uses first-match related records and excludes inactive links", () => {
    const result = buildEmpireDecisionQueue(input({
      actions: [action({ id: "linked-action", relatedPillar: "Action area", relatedOpportunity: "duplicate" })],
      opportunities: [
        opportunity({ id: "duplicate", relatedPillar: "First opportunity area" }),
        opportunity({ id: "duplicate", relatedPillar: "Second opportunity area" }),
      ],
      decisions: [decision({ id: "inactive-decision", decisionStatus: "Completed", relatedPillar: "Inactive area" })],
      problems: [problem({ id: "resolved-problem", problemStatus: "Resolved", relatedPillar: "Resolved area" })],
    }));

    expect(result.crossPillarIssues).toHaveLength(1);
    expect(result.crossPillarIssues[0].why).toBe(
      "Linked active work connects this record across Action area and First opportunity area.",
    );
  });
});

describe("delegate suitability", () => {
  it("applies source-specific weights, ascending score, title tie-break, and the six-item limit", () => {
    const result = buildEmpireDecisionQueue(input({
      actions: [
        action({ id: "a-low", actionTitle: "Routine action", priority: "Low" }),
        action({ id: "a-medium", actionTitle: "Medium action", priority: "Medium" }),
        action({ id: "a-soon", actionTitle: "Soon action", priority: "Medium", dueDate: new Date(NOW + 7 * 86400000).toISOString() }),
      ],
      projects: [
        project({ id: "p-progress", projectName: "Progress project", status: "in progress" }),
        project({ id: "p-overdue", projectName: "Overdue project", status: "planning", targetCompletionDate: "2025-04-09" }),
      ],
      leads: [
        lead({ id: "l-new", leadName: "Routine lead" }),
        lead({ id: "l-follow-up", leadName: "Follow-up lead", status: "Follow-Up" }),
      ],
      problems: [
        problem({ id: "pr-low", problemStatement: "Low problem", severity: "Low" }),
        problem({ id: "pr-medium", problemStatement: "Medium problem", severity: "Medium" }),
      ],
    }));

    expect(result.delegateItems.map(({ objectType, id, title }) => [objectType, id, title])).toEqual([
      ["Action", "a-low", "Routine action"],
      ["Lead", "l-new", "Routine lead"],
      ["Problem", "pr-low", "Low problem"],
      ["Action", "a-medium", "Medium action"],
      ["Project", "p-progress", "Progress project"],
      ["Problem", "pr-medium", "Medium problem"],
    ]);
    expect(result.delegateItems[0]).toMatchObject({
      founderIntervention: "No",
      whatIsChanging: "This active action is still carried by the founder but does not have a critical or blocked authority signal.",
      whyItMatters: "Transferring routine execution creates founder capacity while preserving accountability through a named owner.",
      delegationAction: "Transfer to an active operational owner with a clear outcome and follow-up",
    });
  });

  it("scores Follow-Up timing and orders equal suitability by title", () => {
    const result = buildEmpireDecisionQueue(input({
      actions: [
        action({ id: "tie-z", actionTitle: "Z action", priority: "Medium" }),
        action({ id: "tie-a", actionTitle: "A action", priority: "Medium" }),
        action({ id: "in-progress-action", actionTitle: "In-progress action", status: "In Progress", priority: "Low" }),
      ],
      projects: [project({ id: "progress-project", projectName: "B project", status: "in progress" })],
      leads: [lead({ id: "follow-up", leadName: "Follow-up lead", status: "Follow-Up", followUpDate: new Date(NOW + 7 * 86400000).toISOString() })],
      problems: [problem({ id: "medium-problem", problemStatement: "Medium problem", severity: "Medium" })],
    }));

    expect(result.delegateItems.map(({ objectType, title }) => [objectType, title])).toEqual([
      ["Action", "In-progress action"],
      ["Action", "A action"],
      ["Project", "B project"],
      ["Action", "Z action"],
      ["Problem", "Medium problem"],
      ["Lead", "Follow-up lead"],
    ]);
  });

  it("scores due-date bands, excludes blocked/critical/release work, and resolves owners by active person ID", () => {
    const result = buildEmpireDecisionQueue(input({
      orderedPeople: [founder, {
        id: "operator-id",
        name: "Operator",
        role: "Operations lead",
        status: "Active",
        responsibilities: "Delivery",
        authority: "Team execution",
        pillar: "Operations",
      }],
      actions: [
        action({ id: "future", actionTitle: "Future", priority: "Low", dueDate: new Date(NOW + 31 * 86400000).toISOString() }),
        action({ id: "thirty", actionTitle: "Thirty", priority: "Low", dueDate: new Date(NOW + 30 * 86400000).toISOString() }),
        action({ id: "seven", actionTitle: "Seven", priority: "Low", dueDate: new Date(NOW + 7 * 86400000).toISOString() }),
        action({ id: "overdue", actionTitle: "Overdue", priority: "Low", dueDate: new Date(NOW - 1).toISOString() }),
        action({ id: "blocked", status: "Blocked", actionTitle: "Blocked", priority: "Low" }),
        action({ id: "critical", actionTitle: "Critical", priority: "Critical" }),
        action({ id: "release", actionTitle: "Release", releaseSourceType: "Project", releaseSourceId: "p", releaseIntent: "Prepare to Delegate" }),
        action({ id: "operator-owned", actionTitle: "Operator owned", owner: "Founder", ownerPersonId: "operator-id" }),
      ],
    }));

    expect(result.delegateItems.map(({ id }) => id)).toEqual(["future", "thirty", "seven", "overdue"]);
  });

  it("returns ready capacity names and readiness gaps in People input order", () => {
    const result = buildEmpireDecisionQueue(input({
      orderedPeople: [
        founder,
        { id: "ready-2", name: "Zed", role: "Lead", status: "Active", responsibilities: "Delivery", authority: "Team", pillar: "Operations" },
        { id: "gap", name: "Gap", role: "Lead", status: "Active", responsibilities: "", authority: "Team", pillar: "Operations" },
        { id: "ready-1", name: "Ada", role: "Lead", status: "Active", responsibilities: "Delivery", authority: "Team", pillar: "Operations" },
        { id: "inactive", name: "Inactive", role: "Lead", status: "Inactive", responsibilities: "Delivery", authority: "Team", pillar: "Operations" },
      ],
    }));

    expect(result.delegationCapacityNames).toEqual(["Zed", "Ada"]);
    expect(result.delegationReadinessGapNames).toEqual(["Gap"]);
  });
});

describe("founder authority candidates", () => {
  it("scores blocked-project urgency and linked review strength", () => {
    const result = buildEmpireDecisionQueue(input({
      decisions: [
        decision({ id: "critical-review", riskLevel: "Critical" }),
        decision({ id: "high-review", riskLevel: "High" }),
      ],
      projects: [
        project({ id: "past-linked", status: "blocked", area: "Operations", targetCompletionDate: "2025-04-09", relatedDecisionIds: ["critical-review"] }),
        project({ id: "soon-linked", status: "blocked", area: "Operations", targetCompletionDate: "2025-04-15", relatedDecisionIds: ["high-review"] }),
        project({ id: "later", status: "blocked", area: "Operations", targetCompletionDate: "2025-04-30" }),
        project({ id: "empty-area", status: "blocked", area: "   " }),
        project({ id: "not-blocked", status: "in progress", area: "Operations" }),
      ],
    }));

    expect(result.founderAuthorityItems.map(({ id, authorityScore }) => [id, authorityScore])).toEqual([
      ["past-linked", 150],
      ["soon-linked", 115],
      ["later", 80],
    ]);
    expect(result.founderAuthorityItems[0].whyItMatters).toBe(
      "The blocked project is preventing delivery and is linked to 1 Decision that already meet founder-review criteria.",
    );
  });

  it("applies Opportunity status, fit, settled-decision, and linked-review scoring exactly", () => {
    const result = buildEmpireDecisionQueue(input({
      decisions: [
        decision({ id: "review-opportunity", riskLevel: "High", relatedOpportunity: "linked" }),
        decision({ id: "settled-completed", decisionStatus: "Completed", relatedOpportunity: "settled" }),
        decision({ id: "settled-reversed", decisionStatus: "Reversed", relatedOpportunity: "reversed" }),
      ],
      opportunities: [
        opportunity({ id: "linked", strategicFit: "Exceptional" }),
        opportunity({ id: "high", status: "Approved", strategicFit: "High" }),
        opportunity({ id: "new", status: "New", strategicFit: "Exceptional" }),
        opportunity({ id: "low", strategicFit: "Low" }),
        opportunity({ id: "settled", strategicFit: "Exceptional" }),
        opportunity({ id: "reversed", strategicFit: "High" }),
      ],
    }));

    expect(result.founderAuthorityItems.map(({ id, authorityScore }) => [id, authorityScore])).toEqual([
      ["linked", 90],
      ["high", 50],
    ]);
    expect(result.founderAuthorityItems[0]).toMatchObject({
      reasonCategory: "Strategic opportunity approval",
      whatIsChanging: "This exceptional-fit opportunity remains evaluating without a settled linked Decision.",
      whyItMatters: "The opportunity needs deliberate approval and its linked Decision already meets founder-review criteria: high-risk judgement.",
      delegationAction: "Escalate to founder approval or strategic decision",
    });
  });

  it("replaces duplicate authority records only on a strictly greater score and sorts by type:id", () => {
    const result = buildEmpireDecisionQueue(input({
      projects: [
        project({ id: "duplicate", status: "blocked", area: "Operations", targetCompletionDate: "2025-04-30", projectName: "First equal" }),
        project({ id: "duplicate", status: "blocked", area: "Operations", targetCompletionDate: "2025-04-25", projectName: "Second equal" }),
        project({ id: "replace", status: "blocked", area: "Operations", targetCompletionDate: "2025-04-30", projectName: "Lower score" }),
        project({ id: "replace", status: "blocked", area: "Operations", targetCompletionDate: "2025-04-09", projectName: "Higher score" }),
      ],
      opportunities: [
        opportunity({ id: "alpha", strategicFit: "High" }),
      ],
    }));

    expect(result.founderAuthorityItems.map(({ objectType, id, title, authorityScore }) => [objectType, id, title, authorityScore])).toEqual([
      ["Project", "replace", "Higher score", 110],
      ["Project", "duplicate", "First equal", 80],
      ["Opportunity", "alpha", "Opportunity title", 50],
    ]);
  });

  it("returns all authority items and limits only the display list to eight", () => {
    const result = buildEmpireDecisionQueue(input({
      projects: Array.from({ length: 9 }, (_, index) => project({
        id: `project-${index + 1}`,
        status: "blocked",
        area: "Operations",
      })),
    }));

    expect(result.founderAuthorityItems).toHaveLength(9);
    expect(result.founderAuthorityDisplayItems).toHaveLength(8);
    expect(result.founderAuthorityDisplayItems.map(({ id }) => id)).toEqual([
      "project-1", "project-2", "project-3", "project-4", "project-5", "project-6", "project-7", "project-8",
    ]);
  });
});

describe("merged founder review queue", () => {
  it("uses reason priority, retains first equal-priority records, and preserves insertion order", () => {
    const first = reviewCandidate({ id: "same", reasonCategory: "High-risk judgement", title: "First" });
    const equal = reviewCandidate({ id: "same", reasonCategory: "High-risk judgement", title: "Equal later" });
    const due = reviewCandidate({ id: "same", reasonCategory: "Review due", title: "Due" });
    const critical = reviewCandidate({ id: "same", reasonCategory: "Critical escalation", title: "Critical" });
    const authority = authorityCandidate({ id: "same", title: "Authority" });
    const other = reviewCandidate({ id: "other", title: "Other" });

    const merged = mergeFounderReviewQueue([first, equal, due, critical, other], [authority]);

    expect(merged.map(({ id, title, reasonCategory }) => [id, title, reasonCategory])).toEqual([
      ["same", "Critical", "Critical escalation"],
      ["other", "Other", "High-risk judgement"],
      ["same", "Authority", "Authority required"],
    ]);
    expect(merged[2]).toMatchObject({ kind: "Project", authorityScore: 80 });
  });
});

describe("input immutability", () => {
  it("does not mutate any supplied records or People facts", () => {
    const value = input({
      decisions: [decision({ id: "decision", riskLevel: "High" })],
      problems: [problem({ id: "problem", severity: "Medium" })],
      actions: [action({ id: "action", relatedProblem: "problem" })],
      projects: [project({ id: "project", relatedActionIds: ["action"] })],
      opportunities: [opportunity({ id: "opportunity" })],
      leads: [lead({ id: "lead" })],
      systems: [{ id: "system", area: "Systems" }],
      orderedPeople: [founder],
    });
    const before = structuredClone(value);

    buildEmpireDecisionQueue(value);

    expect(value).toEqual(before);
  });
});
