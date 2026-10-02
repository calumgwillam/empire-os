import { describe, expect, it } from "vitest";
import {
  buildRecurringProblemLearning,
  type RecurringProblemInput,
  type RecurringProblemLearningInput,
} from "./recurring-problem-learning";

function problem(overrides: Partial<RecurringProblemInput> = {}): RecurringProblemInput {
  return {
    id: "problem-1",
    frequency: "Recurring",
    severity: "High",
    problemStatus: "Open",
    problemStatement: "Problem statement",
    title: "Problem title",
    owner: "Owner",
    relatedPillar: "Operations",
    relatedArea: "Alternate area",
    area: "Fallback area",
    isUnresolved: true,
    ...overrides,
  };
}

function input(overrides: Partial<RecurringProblemLearningInput> = {}): RecurringProblemLearningInput {
  return {
    problems: [],
    lessons: [],
    systems: [],
    sops: [],
    ...overrides,
  };
}

describe("buildRecurringProblemLearning", () => {
  it("includes only exact Recurring and Persistent frequencies in input order", () => {
    const result = buildRecurringProblemLearning(input({
      problems: [
        problem({ id: "one-off", frequency: "One-off" }),
        problem({ id: "recurring-a", frequency: "Recurring" }),
        problem({ id: "persistent", frequency: "Persistent" }),
        problem({ id: "lowercase", frequency: "recurring" }),
        problem({ id: "recurring-b", frequency: "Recurring" }),
      ],
    }));

    expect(result.unresolvedRecurring.map(({ id }) => id)).toEqual(["recurring-a", "persistent", "recurring-b"]);
    expect([...result.maturityByProblemId.keys()]).toEqual(["recurring-a", "persistent", "recurring-b"]);
  });

  it("uses only precomputed unresolved facts when building unresolved lists and counters", () => {
    const result = buildRecurringProblemLearning(input({
      problems: [
        problem({ id: "unresolved", isUnresolved: true }),
        problem({ id: "resolved", problemStatus: "Resolved", isUnresolved: false }),
      ],
    }));

    expect(result.unresolvedRecurring.map(({ id }) => id)).toEqual(["unresolved"]);
    expect(result.gaps.map(({ id }) => id)).toEqual(["unresolved"]);
    expect(result.closedInstitutionalised).toBe(0);
  });

  it("requires a lesson linked by relatedProblem and an exact meaningful status", () => {
    const result = buildRecurringProblemLearning(input({
      problems: [problem()],
      lessons: [
        { id: "other-problem-lesson", relatedProblem: "other", status: "Reviewed" },
        { id: "new", relatedProblem: "problem-1", status: "New" },
        { id: "change", relatedProblem: "problem-1", status: "Change Required" },
      ],
    }));

    expect(result.maturityByProblemId.get("problem-1")).toBe("missing");
    expect(result.gaps).toHaveLength(1);
  });

  it.each(["Reviewed", "Implemented"])("treats %s as meaningful captured learning", (status) => {
    const result = buildRecurringProblemLearning(input({
      problems: [problem()],
      lessons: [{ id: "lesson-1", relatedProblem: "problem-1", status }],
    }));

    expect(result.maturityByProblemId.get("problem-1")).toBe("captured");
    expect(result.gaps).toEqual([]);
    expect(result.capturedNotInstitutionalised).toBe(1);
  });

  it("recognizes an active System linked by meaningful lesson ID", () => {
    const result = buildRecurringProblemLearning(input({
      problems: [problem()],
      lessons: [{ id: "lesson-1", relatedProblem: "problem-1", status: "Reviewed" }],
      systems: [{ id: "system-1", relatedLesson: "lesson-1", status: "Active" }],
    }));

    expect(result.maturityByProblemId.get("problem-1")).toBe("institutionalised");
  });

  it("recognizes an active System linked through a meaningful lesson relatedSystem ID", () => {
    const result = buildRecurringProblemLearning(input({
      problems: [problem()],
      lessons: [{ id: "lesson-1", relatedProblem: "problem-1", relatedSystem: "system-1", status: "Implemented" }],
      systems: [{ id: "system-1", relatedLesson: "unrelated-lesson", status: "Reviewing" }],
    }));

    expect(result.maturityByProblemId.get("problem-1")).toBe("institutionalised");
  });

  it.each(["Draft", "Deprecated", "Archived"])("does not institutionalise from a %s System", (status) => {
    const result = buildRecurringProblemLearning(input({
      problems: [problem()],
      lessons: [{ id: "lesson-1", relatedProblem: "problem-1", status: "Reviewed" }],
      systems: [{ id: "system-1", relatedLesson: "lesson-1", status }],
    }));

    expect(result.maturityByProblemId.get("problem-1")).toBe("captured");
  });

  it("institutionalises from an active SOP directly linked to a meaningful lesson without an active System", () => {
    const result = buildRecurringProblemLearning(input({
      problems: [problem()],
      lessons: [{ id: "lesson-1", relatedProblem: "problem-1", status: "Reviewed" }],
      sops: [{ relatedLesson: "lesson-1", relatedSystem: "inactive-system", status: "Active" }],
    }));

    expect(result.maturityByProblemId.get("problem-1")).toBe("institutionalised");
  });

  it("institutionalises from an active SOP linked to an active linked System", () => {
    const result = buildRecurringProblemLearning(input({
      problems: [problem()],
      lessons: [{ id: "lesson-1", relatedProblem: "problem-1", status: "Implemented" }],
      systems: [{ id: "system-1", relatedLesson: "lesson-1", status: "Reviewing" }],
      sops: [{ relatedLesson: "unrelated-lesson", relatedSystem: "system-1", status: "Reviewing" }],
    }));

    expect(result.maturityByProblemId.get("problem-1")).toBe("institutionalised");
  });

  it("does not institutionalise from inactive SOPs or SOPs linked only to an inactive System", () => {
    const directInactive = buildRecurringProblemLearning(input({
      problems: [problem()],
      lessons: [{ id: "lesson-1", relatedProblem: "problem-1", status: "Reviewed" }],
      sops: [{ relatedLesson: "lesson-1", relatedSystem: "system-1", status: "Draft" }],
    }));
    expect(directInactive.maturityByProblemId.get("problem-1")).toBe("captured");

    const inactiveSystem = buildRecurringProblemLearning(input({
      problems: [problem()],
      lessons: [{ id: "lesson-1", relatedProblem: "problem-1", status: "Reviewed" }],
      systems: [{ id: "system-1", relatedLesson: "lesson-1", status: "Draft" }],
      sops: [{ relatedLesson: "unrelated-lesson", relatedSystem: "system-1", status: "Active" }],
    }));
    expect(inactiveSystem.maturityByProblemId.get("problem-1")).toBe("captured");
  });

  it("preserves exact gap projection and area/title/owner fallbacks", () => {
    const result = buildRecurringProblemLearning(input({
      problems: [problem({
        problemStatement: "",
        title: "Fallback title",
        relatedPillar: "",
        relatedArea: "Area fallback",
        owner: "",
      })],
    }));

    expect(result.gaps).toEqual([{
      id: "problem-1",
      objectType: "Problem",
      title: "Fallback title",
      frequency: "Recurring",
      severity: "High",
      status: "Open",
      area: "Area fallback",
      owner: "Unassigned",
    }]);
  });

  it("counts unresolved captured and closed institutionalised Problems independently", () => {
    const result = buildRecurringProblemLearning(input({
      problems: [
        problem({ id: "missing", isUnresolved: true }),
        problem({ id: "captured", isUnresolved: true }),
        problem({ id: "closed-institutionalised", problemStatus: "Resolved", isUnresolved: false }),
        problem({ id: "closed-captured", problemStatus: "Closed", isUnresolved: false }),
      ],
      lessons: [
        { id: "lesson-captured", relatedProblem: "captured", status: "Reviewed" },
        { id: "lesson-closed-i", relatedProblem: "closed-institutionalised", status: "Implemented" },
        { id: "lesson-closed-c", relatedProblem: "closed-captured", status: "Reviewed" },
      ],
      systems: [{ id: "system-i", relatedLesson: "lesson-closed-i", status: "Active" }],
    }));

    expect(result.gaps.map(({ id }) => id)).toEqual(["missing"]);
    expect(result.capturedNotInstitutionalised).toBe(1);
    expect(result.closedInstitutionalised).toBe(1);
  });

  it("preserves duplicate Problem entries in arrays while the maturity Map keeps the last duplicate value", () => {
    const result = buildRecurringProblemLearning(input({
      problems: [
        problem({ id: "duplicate", problemStatement: "First duplicate" }),
        problem({ id: "duplicate", problemStatement: "Second duplicate" }),
      ],
      lessons: [{ id: "lesson", relatedProblem: "duplicate", status: "Reviewed" }],
    }));

    expect(result.unresolvedRecurring.map(({ problemStatement }) => problemStatement)).toEqual([
      "First duplicate",
      "Second duplicate",
    ]);
    expect(result.gaps).toEqual([]);
    expect(result.maturityByProblemId).toEqual(new Map([["duplicate", "captured"]]));
  });

  it("retains source ordering in unresolved and gap arrays", () => {
    const result = buildRecurringProblemLearning(input({
      problems: [
        problem({ id: "third" }),
        problem({ id: "ignored", frequency: "One-off" }),
        problem({ id: "first", frequency: "Persistent" }),
        problem({ id: "resolved", isUnresolved: false }),
        problem({ id: "second" }),
      ],
    }));

    expect(result.unresolvedRecurring.map(({ id }) => id)).toEqual(["third", "first", "second"]);
    expect(result.gaps.map(({ id }) => id)).toEqual(["third", "first", "second"]);
    expect([...result.maturityByProblemId.keys()]).toEqual(["third", "first", "resolved", "second"]);
  });

  it("does not mutate inputs and remains deterministic across repeated calls", () => {
    const facts = input({
      problems: [problem()],
      lessons: [{ id: "lesson-1", relatedProblem: "problem-1", relatedSystem: "system-1", status: "Reviewed" }],
      systems: [{ id: "system-1", relatedLesson: "lesson-1", status: "Active" }],
      sops: [{ relatedLesson: "lesson-1", relatedSystem: "system-1", status: "Active" }],
    });
    const before = structuredClone(facts);
    const first = buildRecurringProblemLearning(facts);
    const second = buildRecurringProblemLearning(facts);

    expect(facts).toEqual(before);
    expect(first).toEqual(second);
  });
});