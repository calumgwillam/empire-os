import { describe, expect, it } from "vitest";
import type { LearningAttentionSignal } from "./learning-attention";
import {
  buildLearningCommandAdapter,
  type LearningCommandTarget,
} from "./learning-command-adapter";

function candidate(overrides: Partial<LearningAttentionSignal> = {}): LearningAttentionSignal {
  return {
    sourceType: "Lesson",
    sourceId: "lesson-1",
    sourceTitle: "Recorded lesson",
    attentionRequired: true,
    attentionKind: "Change required",
    target: { objectType: "Lesson", id: "lesson-1" },
    ...overrides,
  };
}

describe("Learning Command translation boundary", () => {
  it("returns no representations for empty candidates", () => {
    expect(buildLearningCommandAdapter([], [])).toEqual([]);
    expect(buildLearningCommandAdapter([], [{ objectType: "Lesson", id: "lesson-1" }])).toEqual([]);
  });

  it.each([
    ["Review learning", "Learning: review learning"],
    ["Change required", "Learning: change required"],
    ["Recurring learning", "Learning: review recorded recurrence"],
    ["Institutionalisation", "Learning: consider System/SOP change"],
  ] as const)("translates %s without reassessing materiality", (attentionKind, reason) => {
    expect(buildLearningCommandAdapter([candidate({ attentionKind })], [])).toEqual([{
      sourceType: "Lesson", sourceId: "lesson-1", sourceTitle: "Recorded lesson",
      attentionKind, reason, targetResolution: "Unresolved target", target: null,
    }]);
  });

  it("preserves an associated existing target as an augmentation, independently of source identity", () => {
    const target: LearningCommandTarget = { objectType: "SOP", id: "sop-1" };
    const result = buildLearningCommandAdapter([candidate({
      sourceTitle: "  Original title\nverbatim  ", target,
    })], [target]);
    expect(result).toEqual([{
      sourceType: "Lesson", sourceId: "lesson-1", sourceTitle: "  Original title\nverbatim  ",
      attentionKind: "Change required", reason: "Learning: change required",
      targetResolution: "Augment existing target", target: { objectType: "SOP", id: "sop-1" },
    }]);
    expect(result[0].target).not.toBe(target);
  });

  it("does not treat a gate fallback or an unconfirmed associated target as an existing Command item", () => {
    expect(buildLearningCommandAdapter([
      candidate(),
      candidate({ target: { objectType: "System", id: "system-1" } }),
    ], []).map(({ targetResolution, target }) => ({ targetResolution, target }))).toEqual([
      { targetResolution: "Unresolved target", target: null },
      { targetResolution: "Unresolved target", target: null },
    ]);
  });

  it("requires exact object type and ID and does not fall back to the learning source", () => {
    const result = buildLearningCommandAdapter([
      candidate({ target: { objectType: "System", id: "same-id" } }),
      candidate({ target: { objectType: "Lesson", id: "LESSON-1" } }),
    ], [
      { objectType: "Lesson", id: "same-id" },
      { objectType: "Lesson", id: "lesson-1" },
    ]);
    expect(result.every(({ targetResolution }) => targetResolution === "Unresolved target")).toBe(true);
  });

  it("resolves existing source-record targets without constructing Command items", () => {
    const result = buildLearningCommandAdapter([candidate()], [
      { objectType: "Lesson", id: "lesson-1" },
    ]);
    expect(result[0]).toMatchObject({
      targetResolution: "Augment existing target", target: { objectType: "Lesson", id: "lesson-1" },
    });
    expect(Object.keys(result[0]).sort()).toEqual([
      "attentionKind", "reason", "sourceId", "sourceTitle", "sourceType", "target", "targetResolution",
    ]);
    expect(Object.keys(result[0].target ?? {}).sort()).toEqual(["id", "objectType"]);
    expect(Object.values(result[0]).some((value) => typeof value === "number")).toBe(false);
  });

  it("preserves input order and duplicate-looking candidates rather than deduplicating or ranking", () => {
    const repeated = candidate();
    const candidates = [
      candidate({ sourceType: "Problem", sourceId: "z", sourceTitle: "Z", attentionKind: "Recurring learning" }),
      repeated,
      candidate({ sourceId: "a", sourceTitle: "A", attentionKind: "Institutionalisation" }),
      repeated,
    ];
    const targets: LearningCommandTarget[] = [{ objectType: "Lesson", id: "lesson-1" }];
    const first = buildLearningCommandAdapter(candidates, targets);
    expect(first.map(({ sourceId, attentionKind }) => [sourceId, attentionKind])).toEqual([
      ["z", "Recurring learning"], ["lesson-1", "Change required"],
      ["a", "Institutionalisation"], ["lesson-1", "Change required"],
    ]);
    expect(first[1]).toEqual(first[3]);
    expect(first[1]).not.toBe(first[3]);
    expect(buildLearningCommandAdapter(candidates, targets)).toEqual(first);
  });

  it("does not mutate frozen candidates or existing Command targets, and returns independent target copies", () => {
    const candidates = [candidate({ target: { objectType: "Project", id: "project-1" } }), candidate()];
    const targets: LearningCommandTarget[] = [
      { objectType: "Project", id: "project-1" },
      { objectType: "Lesson", id: "lesson-1" },
    ];
    const before = structuredClone({ candidates, targets });
    function freeze(value: unknown): void {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    }
    freeze(candidates);
    freeze(targets);
    const result = buildLearningCommandAdapter(candidates, targets);
    expect(buildLearningCommandAdapter(candidates, targets)).toEqual(result);
    if (result[0].targetResolution === "Augment existing target") {
      result[0].target.id = "changed output";
    }
    result[0].sourceTitle = "changed title";
    expect({ candidates, targets }).toEqual(before);
  });
});
