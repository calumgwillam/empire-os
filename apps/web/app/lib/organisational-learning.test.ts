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
import type { IcarusTreatmentOutcomeRecord } from "./icarus";

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
  it("feeds only verified Icarus outcomes into the existing learning signals with provenance", () => {
    const outcome = (
      id: string,
      value: IcarusTreatmentOutcomeRecord["outcome"],
    ): IcarusTreatmentOutcomeRecord => ({
      id,
      treatmentTargetId: "target-1",
      assessmentId: "risk-1",
      executionLinks: [{ recordType: "Action", recordId: "action-1", linkedAt: "2026-05-01T00:00:00.000Z" }],
      outcome: value,
      verifiedAt: "2026-05-04T00:00:00.000Z",
      verifiedByPersonId: "person-1",
      evidence: [{
        kind: "Control test",
        assessmentId: "risk-1",
        failureModeId: "mode-1",
        controlId: "control-1",
        testId: "test-1",
        result: "Passed",
        assuranceStatus: "Assured",
        evidenceStatus: "Current support",
        evidenceIds: ["evidence-1"],
      }],
      afterState: { kind: "Control assurance", state: "Assured" },
      verificationNote: "Verified against the current control test.",
    });
    const signals = buildOrganisationalLearning(input({
      icarusTreatmentOutcomes: [
        { targetTitle: "Restore control", record: outcome("effective", "Effective"), treatmentEvidence: { current: true, attribution: "Supported" } },
        { targetTitle: "Restore control", record: outcome("partial", "Partially effective"), treatmentEvidence: { current: true, attribution: "Uncertain" } },
        { targetTitle: "Restore control", record: outcome("ineffective", "Ineffective"), treatmentEvidence: { current: true, attribution: "Supported" } },
        { targetTitle: "Restore control", record: outcome("unknown", "Inconclusive"), treatmentEvidence: { current: true, attribution: "Uncertain" } },
      ],
    }));

    expect(signals.map(({ sourceId, outcomeState }) => [sourceId, outcomeState])).toEqual([
      ["effective", "Worked"],
      ["partial", "Partially worked"],
      ["ineffective", "Failed"],
      ["unknown", "Unknown"],
    ]);
    expect(signals[0].evidence).toContainEqual({
      sourceType: "Icarus Treatment",
      sourceId: "effective",
      field: "treatmentTargetId",
      value: "target-1",
    });
    expect(signals[0].evidence).toContainEqual({
      sourceType: "Icarus Treatment",
      sourceId: "effective",
      field: "evidenceReference",
      value: JSON.stringify(["Control test", "risk-1", "mode-1", "control-1", "test-1", "Passed", "Assured", ["evidence-1"], "Current support"]),
    });

    const recorded = outcome("historical", "Effective");
    const history = buildOrganisationalLearning(input({
      icarusTreatmentOutcomes: [
        { targetTitle: "Restore control", record: recorded, treatmentEvidence: { current: false, attribution: "Not attributable" } },
        { targetTitle: "Restore control", record: { ...recorded, id: "currency-unknown" } },
        {
          targetTitle: "Restore control", record: { ...recorded, id: "current-treatment-historical-intervention" },
          treatmentEvidence: { current: true, attribution: "Supported" },
          interventionContext: { current: false, decisionIds: ["old"], optionIds: ["rejected"], causeIds: ["cause"], lessonIds: ["l"] },
        },
      ],
      lessons: [lesson()],
    }));
    expect(history.map(({ sourceType, sourceId }) => [sourceType, sourceId])).toEqual([
      ["Lesson", "l"],
      ["Icarus Treatment", "historical"],
      ["Icarus Treatment", "currency-unknown"],
      ["Icarus Treatment", "current-treatment-historical-intervention"],
    ]);
    expect(history[0]).toMatchObject({
      sourceType: "Lesson",
      sourceId: "l",
      outcomeState: "Missing evidence",
      linkedLessonIds: ["l"],
    });
    expect(history[0].evidence).toContainEqual({
      sourceType: "Lesson", sourceId: "l", field: "status", value: "New",
    });
    const treatmentHistory = history.filter(({ sourceType }) => sourceType === "Icarus Treatment");
    expect(treatmentHistory.map(({ sourceId, outcomeState }) => [sourceId, outcomeState])).toEqual([
      ["historical", "Unknown"],
      ["currency-unknown", "Unknown"],
      ["current-treatment-historical-intervention", "Worked"],
    ]);
    expect(treatmentHistory[0].evidence).toContainEqual(expect.objectContaining({
      field: "verificationCurrency", value: "Historical / superseded or currency unknown",
    }));
    expect(treatmentHistory[0].evidence).toContainEqual(expect.objectContaining({
      field: "interventionAttribution", value: "Not attributable — historical or no intervention context",
    }));
    expect(treatmentHistory[1].evidence).toContainEqual(expect.objectContaining({
      field: "verificationCurrency", value: "Historical / superseded or currency unknown",
    }));
    expect(treatmentHistory[2].evidence).toContainEqual(expect.objectContaining({
      field: "treatmentAttribution", value: "Supported",
    }));
    expect(treatmentHistory[2].evidence).toContainEqual(expect.objectContaining({
      field: "interventionAttribution", value: "Not attributable — historical or no intervention context",
    }));
    expect(treatmentHistory[2].linkedLessonIds).toEqual(["l"]);
    expect(lesson().status).toBe("New");
  });

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

  it("preserves Lesson status meanings without treating recommendation text as outstanding work", () => {
    const statuses = ["New", "Reviewed", "Implemented", "Change Required", "Archived"] as const;
    const signals = buildOrganisationalLearning(input({
      lessons: statuses.map((status) => lesson({ id: status, status, recommendedChange: "Update the checklist" })),
    }));
    expect(signals.map(({ recommendedNextTransition }) => recommendedNextTransition)).toEqual([
      "Review existing Lesson", "Review existing Lesson", "Review existing Lesson",
      "Review existing Lesson", "Review existing Lesson",
    ]);
    expect(signals.map(({ learningState }) => learningState)).toEqual([
      "Lesson available", "Meaningful learning captured", "Meaningful learning captured",
      "Lesson available", "Lesson available",
    ]);
  });

  it.each(["Reviewed", "Implemented"] as const)(
    "retains historical recommendedChange for a %s Lesson without inferring unresolved institutionalisation",
    (status) => {
      const result = buildOrganisationalLearning(input({
        lessons: [lesson({ status, recommendedChange: "Update the checklist" })],
      }))[0];
      expect(result).toMatchObject({
        learningState: "Meaningful learning captured",
        recommendedNextTransition: "Review existing Lesson",
      });
      expect(result.evidence).toContainEqual({
        sourceType: "Lesson", sourceId: "l", field: "recommendedChange", value: "Update the checklist",
      });
    },
  );

  it.each(["System", "SOP"] as const)(
    "does not recommend unresolved institutionalisation for learning already institutionalised through an active %s",
    (objectType) => {
      const signals = buildOrganisationalLearning(input({
        problems: [problem()],
        lessons: [lesson({
          status: "Implemented", recommendedChange: "Update the checklist", relatedProblem: "r",
        })],
        systems: objectType === "System" ? [{ id: "s", relatedLesson: "l", status: "Active" }] : [],
        sops: objectType === "SOP" ? [{ relatedLesson: "l", relatedSystem: "", status: "Active" }] : [],
      }));
      expect(signals.find(({ sourceType }) => sourceType === "Lesson"))
        .toMatchObject({ recommendedNextTransition: "Review existing Lesson" });
      expect(signals.find(({ sourceType }) => sourceType === "Problem"))
        .toMatchObject({ recurrenceState: "Institutionalised", recommendedNextTransition: "Investigate recurrence" });
      expect(signals.some(({ recommendedNextTransition }) => recommendedNextTransition === "Consider System/SOP change"))
        .toBe(false);
    },
  );

  it("does not conclude that learning is unnecessary for a resolved institutionalised Problem", () => {
    const result = buildOrganisationalLearning(input({
      problems: [problem({ problemStatus: "Resolved", isUnresolved: false })],
      lessons: [lesson({ relatedProblem: "r", status: "Implemented" })],
      systems: [{ id: "s", relatedLesson: "l", status: "Active" }],
    })).find(({ sourceType }) => sourceType === "Problem");
    expect(result).toMatchObject({
      recurrenceState: "Institutionalised", learningState: "Meaningful learning captured",
      recommendedNextTransition: "Review learning",
    });
    expect(result?.recommendedNextTransition).not.toBe("No learning required");
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
      .toMatchObject({ recommendedNextTransition: "Review learning" });
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
