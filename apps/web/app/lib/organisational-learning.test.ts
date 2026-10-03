import { describe, expect, it } from "vitest";
import {
  buildOrganisationalLearning,
  type LearningActionInput,
  type LearningDecisionInput,
  type LearningLessonInput,
  type LearningProjectInput,
  type OrganisationalLearningInput,
} from "./organisational-learning";
import type { RecurringProblemInput } from "./recurring-problem-learning";

function input(overrides: Partial<OrganisationalLearningInput> = {}): OrganisationalLearningInput {
  return { actions: [], projects: [], decisions: [], lessons: [], problems: [], systems: [], sops: [], ...overrides };
}

function action(overrides: Partial<LearningActionInput> = {}): LearningActionInput {
  return { id: "a", title: "Action", actionTitle: "", status: "Completed", completionEvidence: "", ...overrides };
}

function project(overrides: Partial<LearningProjectInput> = {}): LearningProjectInput {
  return { id: "p", projectName: "Project", status: "Completed", ...overrides };
}

function decision(overrides: Partial<LearningDecisionInput> = {}): LearningDecisionInput {
  return {
    id: "d", title: "Decision", decisionTitle: "", decisionStatus: "Completed",
    executionState: "Completed execution", actualOutcome: "Recorded result",
    outcomeRating: "Worked", lessons: "", ...overrides,
  };
}

function lesson(overrides: Partial<LearningLessonInput> = {}): LearningLessonInput {
  return {
    id: "l", title: "Lesson", lessonTitle: "", description: "Source-backed learning",
    status: "New", recommendedChange: "", relatedProblem: "", relatedProject: "",
    relatedDecision: "", relatedSystem: "", ...overrides,
  };
}

function problem(overrides: Partial<RecurringProblemInput> = {}): RecurringProblemInput {
  return {
    id: "r", title: "Problem", problemStatement: "", frequency: "Recurring",
    severity: "High", problemStatus: "Open", owner: "", isUnresolved: true, ...overrides,
  };
}

describe("read-only organisational learning policy", () => {
  it("returns no signals for empty input", () => {
    expect(buildOrganisationalLearning(input())).toEqual([]);
  });

  it("keeps execution completion and review directives separate from outcome evidence", () => {
    const signals = buildOrganisationalLearning(input({
      actions: [action({
        reviewOutcome: "Complete", lastReviewedDate: "2026-10-03",
        completionEvidence: "Delivered", followUpNote: "Everything went well",
      })],
      projects: [project({ lastReviewOutcome: "Complete", reviewNote: "Successful delivery" })],
    }));
    expect(signals.map(({ executionState, outcomeState, learningState, recommendedNextTransition }) => ({
      executionState, outcomeState, learningState, recommendedNextTransition,
    }))).toEqual(Array.from({ length: 2 }, () => ({
      executionState: "Completed execution", outcomeState: "Missing evidence",
      learningState: "Unknown", recommendedNextTransition: "Review learning",
    })));
    expect(signals[0].evidence).toContainEqual({
      sourceType: "Action", sourceId: "a", field: "followUpNote", value: "Everything went well",
    });
  });

  it("keeps learning unassessed for a successful reviewed decision without learning evidence", () => {
    expect(buildOrganisationalLearning(input({ decisions: [decision()] }))[0]).toMatchObject({
      outcomeState: "Worked", learningState: "Unknown",
      recommendedNextTransition: "Review learning",
    });
  });

  it.each(["Partially worked", "Failed"])("keeps learning unassessed for %s without inventing a Lesson or causality", (rating) => {
    const result = buildOrganisationalLearning(input({ decisions: [decision({ outcomeRating: rating })] }))[0];
    expect(result).toMatchObject({
      outcomeState: rating, learningState: "Unknown", linkedLessonIds: [],
      recurrenceState: "Unknown", recommendedNextTransition: "Review learning",
    });
    expect(result.evidence.map(({ field }) => field)).not.toContain("rootCause");
  });

  it("does not treat whitespace-only learning notes as an explicit learning assessment", () => {
    const result = buildOrganisationalLearning(input({
      decisions: [decision({ lessons: " \n " })],
    }))[0];
    expect(result).toMatchObject({
      outcomeState: "Worked", learningState: "Unknown",
      recommendedNextTransition: "Review learning",
    });
    expect(result.evidence.map(({ field }) => field)).not.toContain("lessons");
  });

  it("leaves missing, unknown and incomplete decision evidence unresolved", () => {
    const signals = buildOrganisationalLearning(input({ decisions: [
      decision({ id: "missing", actualOutcome: "  ", outcomeRating: "Worked" }),
      decision({ id: "unrated", outcomeRating: "" }),
      decision({ id: "invalid", outcomeRating: "worked" }),
      decision({ id: "active", decisionStatus: "Active", executionState: "Active execution" }),
      decision({ id: "no-execution-fact", executionState: undefined }),
    ] }));
    expect(signals.map(({ outcomeState }) => outcomeState)).toEqual([
      "Missing evidence", "Unknown", "Unknown", "Worked", "Worked",
    ]);
    expect(signals.slice(0, 4).map(({ recommendedNextTransition }) => recommendedNextTransition))
      .toEqual(Array(4).fill("Review learning"));
    expect(signals[4].executionState).toBe("Unknown");
  });

  it("retains stated decision learning as evidence, not verified or institutionalised learning", () => {
    const result = buildOrganisationalLearning(input({
      decisions: [decision({ lessons: "  Check assumptions next time.\nKeep the review.  " })],
    }))[0];
    expect(result).toMatchObject({
      outcomeState: "Worked", learningState: "Learning identified",
      recommendedNextTransition: "Create/link Lesson",
    });
    expect(result.evidence).toContainEqual({
      sourceType: "Decision", sourceId: "d", field: "lessons",
      value: "  Check assumptions next time.\nKeep the review.  ",
    });
  });

  it("links existing Lessons by explicit existing decision/project relationships only", () => {
    const signals = buildOrganisationalLearning(input({
      actions: [action()], projects: [project()], decisions: [decision()],
      lessons: [
        lesson({ id: "decision-lesson", relatedDecision: "d", status: "Reviewed" }),
        lesson({ id: "project-lesson", relatedProject: "p" }),
        lesson({ id: "other", relatedDecision: "different" }),
      ],
    }));
    expect(signals[0].linkedLessonIds).toEqual([]);
    expect(signals[1]).toMatchObject({
      linkedLessonIds: ["project-lesson"], learningState: "Lesson available",
      recommendedNextTransition: "Review existing Lesson",
    });
    expect(signals[2]).toMatchObject({
      outcomeState: "Worked", linkedLessonIds: ["decision-lesson"], learningState: "Meaningful learning captured",
      recommendedNextTransition: "Review existing Lesson",
    });
  });

  it("requires exact meaningful Lesson statuses before considering a recorded System/SOP change", () => {
    const statuses = ["New", "Reviewed", "Implemented", "Change Required", "Archived"] as const;
    const signals = buildOrganisationalLearning(input({
      lessons: statuses.map((status) => lesson({ id: status, status, recommendedChange: "Update the checklist" })),
    }));
    expect(signals.map(({ recommendedNextTransition }) => recommendedNextTransition)).toEqual([
      "Review existing Lesson", "Consider System/SOP change", "Consider System/SOP change",
      "Review existing Lesson", "Review existing Lesson",
    ]);
  });

  it("uses only exact recorded Recurring/Persistent frequencies rather than names or poor outcomes", () => {
    const frequencies = ["Recurring", "Persistent", "recurring", "One-off", ""];
    const signals = buildOrganisationalLearning(input({
      problems: frequencies.map((frequency, index) => problem({ id: String(index), frequency })),
    }));
    expect(signals.map(({ recurrenceState }) => recurrenceState)).toEqual([
      "Recorded recurrence", "Recorded recurrence", "Unknown", "Unknown", "Unknown",
    ]);
    expect(signals.slice(0, 2).map(({ recommendedNextTransition }) => recommendedNextTransition))
      .toEqual(["Investigate recurrence", "Investigate recurrence"]);
  });

  it("composes existing recurrence maturity and active System/SOP linkage semantics", () => {
    const source = input({
      problems: [problem()],
      lessons: [lesson({ relatedProblem: "r", status: "Reviewed", relatedSystem: "s" })],
      systems: [{ id: "s", relatedLesson: "", status: "Draft" }],
    });
    expect(buildOrganisationalLearning(source).find(({ sourceType }) => sourceType === "Problem"))
      .toMatchObject({ recurrenceState: "Recorded recurrence", recommendedNextTransition: "Consider System/SOP change" });
    const institutionalised = {
      ...source, sops: [{ relatedLesson: "l", relatedSystem: "", status: "Active" }],
    };
    expect(buildOrganisationalLearning(institutionalised).find(({ sourceType }) => sourceType === "Problem"))
      .toMatchObject({ recurrenceState: "Institutionalised", recommendedNextTransition: "Investigate recurrence" });
    expect(buildOrganisationalLearning({
      ...institutionalised, problems: [problem({ isUnresolved: false })],
    }).find(({ sourceType }) => sourceType === "Problem"))
      .toMatchObject({ recommendedNextTransition: "No learning required" });
  });

  it("preserves execution terminology without treating reversal or cancellation as failure", () => {
    const signals = buildOrganisationalLearning(input({
      actions: [action({ status: "Cancelled" }), action({ id: "blocked", status: "Blocked" })],
      projects: [project({ status: " FINAL " })],
      decisions: [decision({ decisionStatus: "Reversed", outcomeRating: "", actualOutcome: "" })],
    }));
    expect(signals.map(({ executionState }) => executionState)).toEqual([
      "Cancelled execution", "Blocked execution", "Completed execution", "Completed execution",
    ]);
    expect(signals.every(({ outcomeState }) => outcomeState === "Missing evidence")).toBe(true);
  });

  it("is deterministic, preserves source order and never mutates source records or links", () => {
    const source = input({
      actions: [action({ id: "second" }), action({ id: "first" })],
      projects: [project()], decisions: [decision()],
      lessons: [lesson({ relatedDecision: "d" })], problems: [problem()],
      systems: [{ id: "s", status: "Active", relatedLesson: "l" }],
      sops: [{ relatedLesson: "l", relatedSystem: "s", status: "Active" }],
    });
    const before = structuredClone(source);
    function freeze(value: unknown): void {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    }
    freeze(source);
    const first = buildOrganisationalLearning(source);
    expect(buildOrganisationalLearning(source)).toEqual(first);
    expect(first.map(({ sourceType, sourceId }) => [sourceType, sourceId])).toEqual([
      ["Action", "second"], ["Action", "first"], ["Project", "p"],
      ["Decision", "d"], ["Lesson", "l"], ["Problem", "r"],
    ]);
    first[0].evidence[0].value = "Changed output";
    expect(source).toEqual(before);
  });
});
