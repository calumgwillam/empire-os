import { describe, expect, it } from "vitest";
import {
  buildDecisionExecutionControl,
  type DecisionExecutionControlActionInput,
  type DecisionExecutionControlDecisionInput,
  type DecisionExecutionControlInput,
  type DecisionExecutionControlProjectInput,
} from "./decision-execution-control";

const nowMs = new Date(2026, 9, 2, 12).getTime();
const dayMs = 24 * 60 * 60 * 1000;

function decision(overrides: Partial<DecisionExecutionControlDecisionInput> = {}): DecisionExecutionControlDecisionInput {
  return {
    id: "decision-1",
    title: "Decision 1",
    decisionTitle: overrides.decisionTitle ?? overrides.title ?? "Decision 1",
    status: "Active",
    riskLevel: "Low",
    reviewDate: "",
    reviewDue: false,
    outcomeRating: "",
    actualOutcome: "",
    decisionMaker: "Founder",
    area: "Operations",
    ...overrides,
  };
}

function action(overrides: Partial<DecisionExecutionControlActionInput> = {}): DecisionExecutionControlActionInput {
  return {
    id: "action-1",
    relatedDecision: "decision-1",
    status: "Open",
    dueDate: "",
    title: "Action 1",
    actionTitle: "Action 1",
    hasValidOwner: true,
    ...overrides,
  };
}

function project(overrides: Partial<DecisionExecutionControlProjectInput> = {}): DecisionExecutionControlProjectInput {
  return {
    id: "project-1",
    status: "In Progress",
    relatedDecisionIds: ["decision-1"],
    relatedActionIds: [],
    targetCompletionDate: "",
    projectName: "Project 1",
    hasValidOwner: true,
    ...overrides,
  };
}

function build(
  overrides: Partial<DecisionExecutionControlInput> = {},
) {
  return buildDecisionExecutionControl({
    decisions: [decision()],
    actions: [],
    projects: [],
    delegateItems: [],
    nowMs,
    ...overrides,
  });
}

function itemFor(result: ReturnType<typeof buildDecisionExecutionControl>, id = "decision-1") {
  const item = [...result.items, ...result.onTrackItems].find((entry) => entry.id === id);
  if (!item) throw new Error(`Expected decision control item ${id}`);
  return item;
}

describe("buildDecisionExecutionControl", () => {
  it("tracks Draft, Active, and Under Review; includes closed decisions and skips other statuses", () => {
    const result = build({
      decisions: [
        decision({ id: "draft", status: "Draft" }),
        decision({ id: "active", status: "Active" }),
        decision({ id: "review", status: "Under Review" }),
        decision({ id: "completed", status: "Completed", outcomeRating: "Worked", actualOutcome: "Done" }),
        decision({ id: "reversed", status: "Reversed", outcomeRating: "Failed", actualOutcome: "Reversed" }),
        decision({ id: "cancelled", status: "Cancelled" }),
        decision({ id: "unknown", status: "Unknown" }),
      ],
    });

    expect([...result.items, ...result.onTrackItems].map((item) => item.id).sort()).toEqual([
      "active", "completed", "draft", "reversed", "review",
    ]);
    expect(result.summary.activeTrackedCount).toBe(3);
    expect(result.summary.noPathCount).toBe(3);
  });

  it("applies active control-status precedence from missing path through on track", () => {
    const noPath = build({ decisions: [decision({ reviewDue: true })] });
    expect(itemFor(noPath).controlStatus).toBe("No execution path");
    expect(itemFor(noPath).why).toContain("Decision review date is also due");

    const slipping = build({
      decisions: [decision({ reviewDue: true })],
      actions: [action({ status: "Blocked", hasValidOwner: false })],
    });
    expect(itemFor(slipping).controlStatus).toBe("Delivery slipping");

    const ownership = build({
      decisions: [decision({ reviewDue: true })],
      actions: [action({ hasValidOwner: false })],
    });
    expect(itemFor(ownership).controlStatus).toBe("Ownership gap");

    const reviewDue = build({
      decisions: [decision({ reviewDue: true })],
      actions: [action()],
    });
    expect(itemFor(reviewDue).controlStatus).toBe("Review due");

    const onTrack = build({ actions: [action()] });
    expect(itemFor(onTrack).controlStatus).toBe("On track");
  });

  it.each([
    ["High", "Critical"],
    ["Critical", "Critical"],
    ["Medium", "Material"],
    ["Low", "Material"],
  ])("sets no-path severity for %s risk", (riskLevel, severity) => {
    const result = build({ decisions: [decision({ riskLevel })] });
    expect(itemFor(result).severity).toBe(severity);
  });

  it("treats blocked actions and blocked projects as critical delivery slippage", () => {
    const blockedAction = build({ actions: [action({ status: "Blocked" })] });
    expect(itemFor(blockedAction)).toMatchObject({ controlStatus: "Delivery slipping", severity: "Critical" });

    const blockedProject = build({ projects: [project({ status: " Blocked " })] });
    expect(itemFor(blockedProject)).toMatchObject({ controlStatus: "Delivery slipping", severity: "Critical" });
  });

  it("keeps the exact seven-day overdue boundary Material and makes older actions Critical", () => {
    const exactlySevenDays = build({
      actions: [action({ dueDate: new Date(nowMs - 7 * dayMs).toISOString() })],
    });
    expect(itemFor(exactlySevenDays)).toMatchObject({ controlStatus: "Delivery slipping", severity: "Material" });

    const moreThanSevenDays = build({
      actions: [action({ dueDate: new Date(nowMs - 7 * dayMs - 1).toISOString() })],
    });
    expect(itemFor(moreThanSevenDays)).toMatchObject({ controlStatus: "Delivery slipping", severity: "Critical" });
  });

  it("uses strict action overdue comparison and excludes Waiting actions", () => {
    const dueNow = build({ actions: [action({ dueDate: new Date(nowMs).toISOString() })] });
    expect(itemFor(dueNow).controlStatus).toBe("On track");

    const waitingPastDue = build({
      actions: [action({ status: "Waiting", dueDate: new Date(nowMs - 10 * dayMs).toISOString() })],
    });
    expect(itemFor(waitingPastDue).controlStatus).toBe("On track");
  });

  it("uses the page-projected inclusive decision review fact", () => {
    const dueAtBoundary = build({ decisions: [decision({ reviewDue: true })], actions: [action()] });
    expect(itemFor(dueAtBoundary).controlStatus).toBe("Review due");

    const notDue = build({ decisions: [decision({ reviewDue: false })], actions: [action()] });
    expect(itemFor(notDue).controlStatus).toBe("On track");
  });

  it("uses local-midnight project target dates with a strict less-than comparison", () => {
    const target = new Date(2026, 9, 2, 0);
    const targetDate = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
    const atMidnight = build({
      projects: [project({ targetCompletionDate: targetDate })],
      nowMs: target.getTime(),
    });
    expect(itemFor(atMidnight).controlStatus).toBe("On track");

    const afterMidnight = build({
      projects: [project({ targetCompletionDate: targetDate })],
      nowMs: target.getTime() + 1,
    });
    expect(itemFor(afterMidnight)).toMatchObject({ controlStatus: "Delivery slipping", severity: "Material" });
  });

  it("classifies unresolved owners and delegation candidates as ownership gaps", () => {
    const invalidOwner = build({ actions: [action({ hasValidOwner: false })] });
    expect(itemFor(invalidOwner)).toMatchObject({ controlStatus: "Ownership gap", severity: "Material" });

    const delegationGap = build({
      actions: [action()],
      delegateItems: [{ objectType: "Action", id: "action-1" }],
    });
    expect(itemFor(delegationGap)).toMatchObject({ controlStatus: "Ownership gap", severity: "Material" });
  });

  it("recognizes direct actions and project-mediated actions as execution paths", () => {
    const direct = build({ actions: [action()] });
    expect(itemFor(direct)).toMatchObject({ controlStatus: "On track", directActiveActionCount: 1 });

    const throughProject = build({
      actions: [action({ relatedDecision: "unrelated" })],
      projects: [project({ relatedActionIds: ["action-1"] })],
    });
    expect(itemFor(throughProject)).toMatchObject({ controlStatus: "On track", directActiveActionCount: 0, linkedActiveProjectCount: 1 });
  });

  it("deduplicates merged execution actions by ID while retaining the pre-dedup direct count", () => {
    const result = build({
      actions: [
        action({ id: "duplicate", title: "First", actionTitle: "First", dueDate: "", status: "Open" }),
        action({ id: "duplicate", title: "Last", actionTitle: "Last", status: "Blocked" }),
      ],
    });

    expect(itemFor(result)).toMatchObject({
      controlStatus: "Delivery slipping",
      severity: "Critical",
      directActiveActionCount: 2,
      linkedActionsPreview: [{ id: "duplicate", title: "First", status: "Open" }, { id: "duplicate", title: "Last", status: "Blocked" }],
    });
  });

  it("uses the first three direct action and linked project previews in source order", () => {
    const actions = [1, 2, 3, 4].map((index) => action({ id: `a${index}`, title: `fallback ${index}`, actionTitle: `Action ${index}` }));
    const projects = [1, 2, 3, 4].map((index) => project({ id: `p${index}`, projectName: `Project ${index}` }));
    const result = build({ actions, projects });

    expect(itemFor(result).linkedActionsPreview.map((entry) => entry.id)).toEqual(["a1", "a2", "a3"]);
    expect(itemFor(result).linkedProjectsPreview.map((entry) => entry.id)).toEqual(["p1", "p2", "p3"]);
    expect(itemFor(result).directActiveActionCount).toBe(4);
    expect(itemFor(result).linkedActiveProjectCount).toBe(4);
  });

  it("sorts items by severity, status rank, then title without adding an ID tie-breaker", () => {
    const result = build({
      decisions: [
        decision({ id: "material-review-z", title: "Review Z", reviewDue: true }),
        decision({ id: "critical-slip", title: "Slip", riskLevel: "Low" }),
        decision({ id: "material-no-path-z", title: "No path Z", riskLevel: "Low" }),
        decision({ id: "material-no-path-a", title: "No path A", riskLevel: "Low" }),
        decision({ id: "material-owner", title: "Owner" }),
        decision({ id: "material-learning", title: "Learning", status: "Completed" }),
        decision({ id: "critical-no-path", title: "No path critical", riskLevel: "High" }),
      ],
      actions: [
        action({ relatedDecision: "critical-slip", status: "Blocked" }),
        action({ relatedDecision: "material-review-z", hasValidOwner: true }),
        action({ relatedDecision: "material-owner", hasValidOwner: false }),
      ],
    });

    expect(result.items.map((entry) => entry.id)).toEqual([
      "critical-no-path",
      "critical-slip",
      "material-no-path-a",
      "material-no-path-z",
      "material-owner",
      "material-review-z",
      "material-learning",
    ]);
  });

  it("preserves subset source order and includes incomplete closed decisions in both outputs", () => {
    const result = build({
      decisions: [
        decision({ id: "track-z", title: "Track Z" }),
        decision({ id: "closed-b", title: "Closed B", status: "Completed" }),
        decision({ id: "track-a", title: "Track A" }),
        decision({ id: "closed-a", title: "Closed A", status: "Reversed" }),
      ],
      actions: [action({ relatedDecision: "track-z" }), action({ id: "action-a", relatedDecision: "track-a" })],
    });

    expect(result.onTrackItems.map((entry) => entry.id)).toEqual(["track-z", "track-a"]);
    expect(result.learningIncompleteItems.map((entry) => entry.id)).toEqual(["closed-b", "closed-a"]);
    expect(result.items.map((entry) => entry.id)).toEqual(["closed-a", "closed-b"]);
    expect(result.items.find((entry) => entry.id === "closed-a")).toBe(result.learningIncompleteItems[1]);
  });

  it("returns summary counts and applies headline precedence", () => {
    const noPathOverSlipping = build({
      decisions: [decision({ id: "no-path" }), decision({ id: "slipping" })],
      actions: [action({ relatedDecision: "slipping", status: "Blocked" })],
    });
    expect(noPathOverSlipping.summary).toMatchObject({
      headline: "Decision execution is constrained by 1 missing execution path.",
      activeTrackedCount: 2,
      hasPathCount: 1,
      noPathCount: 1,
      slippingCount: 1,
      onTrackCount: 0,
    });

    const slippingOverLearning = build({
      decisions: [decision({ id: "slipping" }), decision({ id: "closed", status: "Completed" })],
      actions: [action({ relatedDecision: "slipping", status: "Blocked" })],
    });
    expect(slippingOverLearning.summary.headline).toBe("Decision delivery is slipping on 1 decision.");

    const slippingOverReview = build({
      decisions: [decision({ id: "slipping" }), decision({ id: "review", reviewDue: true })],
      actions: [
        action({ relatedDecision: "slipping", status: "Blocked" }),
        action({ id: "review-action", relatedDecision: "review" }),
      ],
    });
    expect(slippingOverReview.summary.headline).toBe("Decision delivery is slipping on 1 decision.");

    const allOnTrack = build({ actions: [action()] });
    expect(allOnTrack.summary.headline).toBe("Decision delivery is on track across all active decisions.");

    const allOnTrackOverLearning = build({
      decisions: [decision({ id: "track" }), decision({ id: "closed", status: "Completed" })],
      actions: [action({ relatedDecision: "track" })],
    });
    expect(allOnTrackOverLearning.summary.headline).toBe("Decision delivery is on track across all active decisions.");

    const reviewPriority = build({
      decisions: [decision({ id: "track" }), decision({ id: "review", reviewDue: true })],
      actions: [action({ relatedDecision: "track" }), action({ id: "review-action", relatedDecision: "review" })],
    });
    expect(reviewPriority.summary.headline).toBe("Decision delivery is broadly on track; 1 review control gap remains.");

    const learningWithActive = build({
      decisions: [decision({ id: "track" }), decision({ id: "closed", status: "Completed" })],
      actions: [action({ relatedDecision: "track", hasValidOwner: false })],
    });
    expect(learningWithActive.summary.headline).toBe("Active decision delivery is on track; 1 closed decision needs outcome rating.");

    const learningWithoutActive = build({ decisions: [decision({ status: "Completed" })] });
    expect(learningWithoutActive.summary.headline).toBe("1 closed decision needs outcome rating; no active decisions are currently being tracked.");

    expect(build({ decisions: [] }).summary.headline).toBe("No active decision-execution control gaps detected.");
  });

  it("does not mutate inputs and is deterministic for the same explicit nowMs", () => {
    const facts: DecisionExecutionControlInput = {
      decisions: [decision({ reviewDue: true })],
      actions: [action({ dueDate: new Date(nowMs - 8 * dayMs).toISOString() })],
      projects: [project()],
      delegateItems: [{ objectType: "Action", id: "action-1" }],
      nowMs,
    };
    const before = structuredClone(facts);
    const first = buildDecisionExecutionControl(facts);
    const second = buildDecisionExecutionControl(facts);

    expect(facts).toEqual(before);
    expect(first).toEqual(second);
    expect(first.items[0]).not.toHaveProperty("onOpen");
  });
});