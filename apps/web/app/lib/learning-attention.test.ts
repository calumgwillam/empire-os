import { describe, expect, it } from "vitest";
import {
  buildOrganisationalLearning,
  type LearningSignal,
  type OrganisationalLearningInput,
} from "./organisational-learning";
import {
  buildLearningAttention,
  type LearningAttentionInput,
} from "./learning-attention";

function signal(overrides: Partial<LearningSignal> = {}): LearningSignal {
  return {
    sourceType: "Decision", sourceId: "d", sourceTitle: "Decision",
    executionState: "Completed execution", outcomeState: "Unknown",
    learningState: "Unknown", recurrenceState: "Unknown", evidence: [],
    linkedLessonIds: [], recommendedNextTransition: "Review learning",
    ...overrides,
  };
}

function learningInput(overrides: Partial<OrganisationalLearningInput> = {}): OrganisationalLearningInput {
  return { actions: [], projects: [], decisions: [], lessons: [], problems: [], systems: [], sops: [], ...overrides };
}

function lessonSignals(status: "Reviewed" | "Implemented" | "Change Required" | "New" = "Reviewed") {
  return buildOrganisationalLearning(learningInput({
    lessons: [{
      id: "l", title: "Lesson", lessonTitle: "", status, description: "Recorded learning",
      recommendedChange: "Update the checklist", relatedProblem: "", relatedProject: "",
      relatedDecision: "", relatedSystem: "",
    }],
  }));
}

function recurrenceSignals(frequency: string, isUnresolved = true) {
  return buildOrganisationalLearning(learningInput({
    problems: [{
      id: "p", title: "Problem", problemStatement: "", frequency,
      severity: "High", problemStatus: "Open", owner: "", isUnresolved,
    }],
  }));
}

describe("Learning Attention Gate", () => {
  it("returns no candidates for empty inputs", () => {
    expect(buildLearningAttention([])).toEqual([]);
  });

  it.each(["Missing evidence", "Unknown", "Worked", "Failed", "Partially worked"] as const)(
    "does not qualify %s outcome with unassessed learning",
    (outcomeState) => {
      expect(buildLearningAttention([{ signal: signal({ outcomeState }) }])).toEqual([]);
    },
  );

  it("does not interpret identified narrative learning alone as a concrete unresolved condition", () => {
    expect(buildLearningAttention([{ signal: signal({
      learningState: "Learning identified", recommendedNextTransition: "Create/link Lesson",
      evidence: [{ sourceType: "Decision", sourceId: "d", field: "lessons", value: "Review assumptions" }],
    }) }])).toEqual([]);
  });

  it("qualifies explicit meaningful learning with a recorded unresolved institutional change", () => {
    expect(buildLearningAttention(lessonSignals().map((signal) => ({ signal })))).toEqual([{
      sourceType: "Lesson", sourceId: "l", sourceTitle: "Lesson", attentionRequired: true,
      attentionKind: "Institutionalisation", target: { objectType: "Lesson", id: "l" },
    }]);
  });

  it("qualifies exact Change Required status using actual Learning Signals", () => {
    expect(buildLearningAttention(lessonSignals("Change Required").map((signal) => ({ signal })))[0])
      .toMatchObject({ attentionRequired: true, attentionKind: "Change required" });
  });

  it.each(["change required", " Change Required ", "Reviewed", "Implemented", "New", "Archived"])(
    "does not treat %s status alone as Change Required",
    (status) => {
      expect(buildLearningAttention([{ signal: signal({
        sourceType: "Lesson", sourceId: "l", learningState: "Lesson available",
        evidence: [{ sourceType: "Lesson", sourceId: "l", field: "status", value: status }],
      }) }])).toEqual([]);
    },
  );

  it("ignores status evidence for an unrelated Lesson", () => {
    expect(buildLearningAttention([{ signal: signal({
      evidence: [{ sourceType: "Lesson", sourceId: "other", field: "status", value: "Change Required" }],
    }) }])).toEqual([]);
  });

  it("recognises a linked Lesson's explicit Change Required condition", () => {
    expect(buildLearningAttention([{ signal: signal({
      linkedLessonIds: ["l"],
      evidence: [{ sourceType: "Lesson", sourceId: "l", field: "status", value: "Change Required" }],
    }) }])[0]).toMatchObject({
      attentionKind: "Change required", target: { objectType: "Decision", id: "d" },
    });
  });

  it("requires both meaningful status and the existing institutionalisation transition", () => {
    const meaningful = lessonSignals()[0];
    expect(buildLearningAttention([{ signal: { ...meaningful, recommendedNextTransition: "Review existing Lesson" } }]))
      .toEqual([]);
    expect(buildLearningAttention(lessonSignals("New").map((signal) => ({ signal })))).toEqual([]);
    expect(buildLearningAttention([{ signal: {
      ...meaningful, evidence: meaningful.evidence.filter(({ field }) => field !== "recommendedChange"),
    } }])).toEqual([]);
  });

  it.each(["Recurring", "Persistent"])("consumes authoritative %s recurrence without reclassifying frequency", (frequency) => {
    const signals = recurrenceSignals(frequency);
    expect(signals[0].recurrenceState).toBe("Recorded recurrence");
    expect(buildLearningAttention(signals.map((signal) => ({ signal })))[0])
      .toMatchObject({ attentionKind: "Recurring learning", target: { objectType: "Problem", id: "p" } });
  });

  it.each(["One-off", "recurring", "persistent", ""])("does not qualify non-authoritative frequency %s", (frequency) => {
    expect(buildLearningAttention(recurrenceSignals(frequency).map((signal) => ({ signal })))).toEqual([]);
  });

  it("does not infer recurrence from frequency text when the authoritative state is unknown", () => {
    const original = recurrenceSignals("Recurring")[0];
    expect(buildLearningAttention([{ signal: { ...original, recurrenceState: "Unknown" } }])).toEqual([]);
  });

  it("requires a concrete unresolved recurrence condition, not historical recurrence alone", () => {
    expect(buildLearningAttention(recurrenceSignals("Recurring", false).map((signal) => ({ signal })))).toEqual([]);
    const original = recurrenceSignals("Recurring")[0];
    expect(buildLearningAttention([{ signal: {
      ...original, evidence: original.evidence.filter(({ field }) => field !== "isUnresolved"),
    } }])).toEqual([]);
  });

  it("consumes the existing captured recurrence institutionalisation condition", () => {
    const source = learningInput({
      problems: [{
        id: "p", title: "Problem", problemStatement: "", frequency: "Persistent",
        severity: "High", problemStatus: "Open", owner: "", isUnresolved: true,
      }],
      lessons: [{
        id: "l", title: "Lesson", lessonTitle: "", status: "Reviewed", description: "",
        recommendedChange: "", relatedProblem: "p", relatedProject: "",
        relatedDecision: "", relatedSystem: "",
      }],
    });
    const signals = buildOrganisationalLearning(source);
    expect(buildLearningAttention(signals.map((signal) => ({ signal })))).toEqual([{
      sourceType: "Problem", sourceId: "p", sourceTitle: "Problem",
      attentionRequired: true, attentionKind: "Institutionalisation",
      target: { objectType: "Problem", id: "p" },
    }]);
  });

  it("does not grant materiality to free-text root-cause language", () => {
    expect(buildLearningAttention([{ signal: signal({
      outcomeState: "Failed", sourceTitle: "Repeated root cause",
      evidence: [{ sourceType: "Decision", sourceId: "d", field: "actualOutcome", value: "The root cause is a recurring system failure" }],
    }) }])).toEqual([]);
  });

  it("preserves an explicit associated Command target without adding ranking fields", () => {
    const target = { objectType: "System", id: "s" } as const;
    const result = buildLearningAttention([{ signal: lessonSignals()[0], associatedTarget: target }]);
    expect(result[0].target).toEqual(target);
    expect(result[0].target).not.toBe(target);
    expect(Object.keys(result[0]).sort()).toEqual([
      "attentionKind", "attentionRequired", "sourceId", "sourceTitle", "sourceType", "target",
    ]);
    expect(Object.values(result[0]).some((value) => typeof value === "number")).toBe(false);
    expect(buildLearningAttention([{ signal: signal(), associatedTarget: target }])).toEqual([]);
  });

  it("preserves source order, deterministic output and frozen inputs", () => {
    const source: LearningAttentionInput[] = [
      { signal: recurrenceSignals("Persistent")[0] },
      { signal: signal() },
      { signal: lessonSignals("Change Required")[0], associatedTarget: { objectType: "Project", id: "project" } },
      { signal: lessonSignals()[0] },
    ];
    const before = structuredClone(source);
    function freeze(value: unknown): void {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    }
    freeze(source);
    const first = buildLearningAttention(source);
    expect(buildLearningAttention(source)).toEqual(first);
    expect(first.map(({ sourceId, attentionKind }) => [sourceId, attentionKind])).toEqual([
      ["p", "Recurring learning"], ["l", "Change required"], ["l", "Institutionalisation"],
    ]);
    first[0].target.id = "changed output";
    expect(source).toEqual(before);
  });
});
