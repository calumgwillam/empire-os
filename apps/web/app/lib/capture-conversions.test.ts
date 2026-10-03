import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isValidActionImplementationLessonId,
  normalizeActionRecord,
  normalizeDecisionRecord,
  normalizeLessonRecord,
  normalizeOpportunityRecord,
  normalizeProblemRecord,
  normalizeSopRecord,
  normalizeSystemRecord,
  type CaptureConversionRecord,
} from "./capture-conversions";
import {
  buildFullBackup,
  CONVERSION_STORAGE_KEY,
  runBackupRestoreTransaction,
  validateEmpireOsBackup,
} from "./backup";
import { persistJsonArray } from "./persistence";

function makeConversion(
  overrides: Partial<CaptureConversionRecord> = {},
): CaptureConversionRecord {
  return {
    id: "conversion-1",
    sourceCaptureId: "capture-1",
    targetType: "Convert to Action",
    createdAt: "2026-10-01T12:00:00.000Z",
    title: "Captured title",
    originalRawNote: "Captured note",
    relatedArea: "Garden Maintenance",
    importance: "Medium",
    status: "Converted",
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("capture conversion record normalization", () => {
  it("normalizes Problems and promotes a valid generic status", () => {
    const result = normalizeProblemRecord(
      makeConversion({
        title: "  Captured title  ",
        problemStatement: "  Damaged gate  ",
        status: "Resolved",
        impact: "  Delayed access  ",
      }),
    );

    expect(result.problemStatement).toBe("Damaged gate");
    expect(result.status).toBe("Resolved");
    expect(result.problemStatus).toBe("Resolved");
    expect(result.severity).toBe("Medium");
    expect(result.frequency).toBe("Occasional");
    expect(result.impact).toBe("Delayed access");
    expect(
      normalizeProblemRecord(makeConversion({ title: "  Captured title  " })).problemStatement,
    ).toBe("  Captured title  ");
  });

  it("normalizes Actions using legacy description, lineage and status fallbacks", () => {
    const result = normalizeActionRecord(
      makeConversion({
        title: "  Repair gate  ",
        actionDescription: "  Repair the damaged gate  ",
        status: "Converted",
        relatedArea: "People",
      }),
    );

    expect(result.actionTitle).toBe("Repair gate");
    expect(result.description).toBe("Repair the damaged gate");
    expect(result.status).toBe("Open");
    expect(result.relatedCapture).toBe("capture-1");
    expect(result.relatedPillar).toBe("People");
    expect(result.createdDate).toBe("2026-10-01T12:00:00.000Z");
  });

  it("leaves existing normalized Actions without an implementation field unchanged", () => {
    const existing = normalizeActionRecord(makeConversion({ status: "Open" }));
    expect(existing).not.toHaveProperty("implementsLessonId");
    expect(normalizeActionRecord(existing)).toEqual(existing);
    expect(normalizeActionRecord(existing)).not.toHaveProperty("implementsLessonId");
  });

  it.each([
    { name: "ordinary Capture conversion", fields: {} },
    { name: "Problem-linked Action", fields: { relatedProblem: "problem-1" } },
    { name: "Decision-linked Action", fields: { relatedDecision: "decision-1" } },
    { name: "legacy Lesson association", fields: { relatedLesson: "lesson-1" } },
    {
      name: "shared links and recommendation wording",
      fields: {
        relatedLesson: "lesson-1", relatedProblem: "problem-1", relatedDecision: "decision-1",
        relatedProject: "project-1", relatedSystem: "system-1", relatedOpportunity: "opportunity-1",
        relatedCapture: "capture-1", title: "lesson-1", actionDescription: "Implement lesson-1",
        recommendedChange: "Implement lesson-1", lessonTitle: "lesson-1",
      },
    },
  ])("does not infer implementation for $name", ({ fields }) => {
    const source = makeConversion(fields);
    const result = normalizeActionRecord(source);
    expect(source).not.toHaveProperty("implementsLessonId");
    expect(result).not.toHaveProperty("implementsLessonId");
    expect(result.relatedLesson).toBe(source.relatedLesson);
  });

  it.each([
    { relatedProblem: "problem-1" },
    { relatedDecision: "decision-1" },
    {},
  ])("preserves intentional implementation independently of other links: %j", (fields) => {
    const result = normalizeActionRecord(makeConversion({
      ...fields, implementsLessonId: "lesson-1", relatedLesson: "different-lesson",
    }));
    expect(result.implementsLessonId).toBe("lesson-1");
    expect(result.relatedLesson).toBe("different-lesson");
    expect(isValidActionImplementationLessonId(result.implementsLessonId, [{ id: "lesson-1" }])).toBe(true);
  });

  it.each([undefined, "", " \t\n "])("treats missing or blank implementation IDs (%j) as unlinked", (id) => {
    const result = normalizeActionRecord(makeConversion({
      implementsLessonId: id, relatedLesson: "lesson-1",
    }));
    expect(result.implementsLessonId).toBe(id === undefined ? undefined : "");
    expect(isValidActionImplementationLessonId(result.implementsLessonId, [])).toBe(true);
    expect(result.relatedLesson).toBe("lesson-1");
  });

  it("normalizes surrounding whitespace but validates only an exact Lesson ID", () => {
    const result = normalizeActionRecord(makeConversion({ implementsLessonId: "  lesson-1  " }));
    expect(result.implementsLessonId).toBe("lesson-1");
    expect(isValidActionImplementationLessonId(result.implementsLessonId, [{ id: "lesson-1" }])).toBe(true);
    expect(isValidActionImplementationLessonId(result.implementsLessonId, [{ id: "LESSON-1" }])).toBe(false);
    expect(isValidActionImplementationLessonId(result.implementsLessonId, [{ id: "lesson-10" }])).toBe(false);
  });

  it("retains dangling implementation IDs and rejects them without reassignment or inference", () => {
    const result = normalizeActionRecord(makeConversion({
      implementsLessonId: "missing-lesson", relatedLesson: "existing-lesson",
      title: "existing-lesson", recommendedChange: "existing-lesson",
    }));
    expect(result.implementsLessonId).toBe("missing-lesson");
    expect(isValidActionImplementationLessonId(result.implementsLessonId, [{ id: "existing-lesson" }])).toBe(false);
    expect(result.implementsLessonId).toBe("missing-lesson");
    expect(result.relatedLesson).toBe("existing-lesson");
  });

  it.each(["Open", "Completed", "Cancelled"] as const)(
    "keeps ownership, %s status and completion fields independent of implementation",
    (status) => {
      const source = {
        ...makeConversion({
          owner: "Recorded owner", status, completionEvidence: "Recorded evidence", completionDate: "2026-10-03",
        }),
        ownerPersonId: "person-1",
        followUpOwnerPersonId: "person-2",
      };
      const existing = normalizeActionRecord(source);
      const linked = normalizeActionRecord({ ...source, implementsLessonId: "lesson-1" });
      expect(linked).toEqual({ ...existing, implementsLessonId: "lesson-1" });
      const cleared = normalizeActionRecord({ ...linked, implementsLessonId: "" });
      expect(cleared).toEqual({ ...existing, implementsLessonId: "" });
    },
  );

  it("supports several Actions implementing one Lesson without reciprocal storage", () => {
    const actions = ["action-1", "action-2"].map((id) =>
      normalizeActionRecord(makeConversion({ id, implementsLessonId: "lesson-1" })),
    );
    const lessons = Object.freeze([Object.freeze({ id: "lesson-1" })]);
    expect(actions.every((action) => isValidActionImplementationLessonId(action.implementsLessonId, lessons))).toBe(true);
    expect(actions.filter((action) => action.implementsLessonId === "lesson-1").map(({ id }) => id))
      .toEqual(["action-1", "action-2"]);
    expect(lessons).toEqual([{ id: "lesson-1" }]);
  });

  it("preserves the additive field through persistence, backup, restore and normalization", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
      removeItem: (key: string) => { data.delete(key); },
    };
    const source = Object.freeze(makeConversion({
      implementsLessonId: "lesson-1", relatedLesson: "generic-lesson",
    }));
    const action = Object.freeze(normalizeActionRecord(source));
    const records = Object.freeze([action]);
    persistJsonArray(storage, CONVERSION_STORAGE_KEY, records);
    const backup = validateEmpireOsBackup(buildFullBackup(storage, "2026-10-03T12:00:00.000Z"));
    data.clear();
    expect(runBackupRestoreTransaction(storage, backup)).toEqual({ ok: true });
    const stored = storage.getItem(CONVERSION_STORAGE_KEY);
    expect(stored).toBe(JSON.stringify(records));
    expect(stored).not.toBeNull();
    if (stored === null) throw new Error("Conversion data was not restored.");
    expect(normalizeActionRecord(JSON.parse(stored)[0])).toEqual(action);
    expect(source.implementsLessonId).toBe("lesson-1");
    expect(source.relatedLesson).toBe("generic-lesson");
  });

  it("does not mutate frozen records or Lesson references while normalizing or validating", () => {
    const source = Object.freeze(makeConversion({
      implementsLessonId: "  lesson-1  ", relatedLesson: "generic-lesson",
    }));
    const before = structuredClone(source);
    const lessons = Object.freeze([Object.freeze({ id: "lesson-1" })]);
    const first = normalizeActionRecord(source);
    expect(normalizeActionRecord(source)).toEqual(first);
    expect(isValidActionImplementationLessonId(first.implementsLessonId, lessons)).toBe(true);
    first.implementsLessonId = "changed-output";
    expect(source).toEqual(before);
    expect(normalizeActionRecord(source).implementsLessonId).toBe("lesson-1");
    expect(lessons).toEqual([{ id: "lesson-1" }]);
  });

  it("normalizes Decisions from captured fields and defaults", () => {
    const result = normalizeDecisionRecord(
      makeConversion({
        status: "Active",
        decisionTitle: "  Replace the supplier  ",
        decisionMaker: "  Founder  ",
      }),
    );

    expect(result.decisionTitle).toBe("Replace the supplier");
    expect(result.decisionStatement).toBe("Captured title");
    expect(result.decisionMaker).toBe("Founder");
    expect(result.status).toBe("Active");
    expect(result.decisionStatus).toBe("Active");
    expect(result.decisionDate).toBe("2026-10-01T12:00:00.000Z");
    expect(result.riskLevel).toBe("Medium");
  });

  it("normalizes Opportunities from legacy description and capture metadata", () => {
    const result = normalizeOpportunityRecord(
      makeConversion({
        opportunityDescription: "  Offer seasonal maintenance  ",
        status: "Evaluating",
      }),
    );

    expect(result.opportunityTitle).toBe("Captured title");
    expect(result.description).toBe("Offer seasonal maintenance");
    expect(result.relatedPillar).toBe("Garden Maintenance");
    expect(result.status).toBe("Evaluating");
    expect(result.dateIdentified).toBe("2026-10-01T12:00:00.000Z");
    expect(result.source).toBe("Unknown");
  });

  it("normalizes Lessons from legacy description and related area", () => {
    const result = normalizeLessonRecord(
      makeConversion({
        lessonDescription: "  Confirm access before scheduling  ",
        relatedArea: "Systems",
        status: "Reviewed",
      }),
    );

    expect(result.lessonTitle).toBe("Captured title");
    expect(result.description).toBe("Confirm access before scheduling");
    expect(result.relatedPillar).toBe("Systems");
    expect(result.status).toBe("Reviewed");
    expect(result.dateLearned).toBe("2026-10-01T12:00:00.000Z");
  });

  it("normalizes Systems from capture metadata and purpose fallbacks", () => {
    const result = normalizeSystemRecord(
      makeConversion({
        purpose: "  Standardize site handover  ",
        relatedPillar: "Operations",
      }),
    );

    expect(result.systemName).toBe("Captured title");
    expect(result.purpose).toBe("Standardize site handover");
    expect(result.process).toBe("Standardize site handover");
    expect(result.area).toBe("Operations");
    expect(result.relatedCapture).toBe("capture-1");
    expect(result.version).toBe("v1");
  });

  it("normalizes SOPs from System fields and defaults current-time dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T08:30:00.000Z"));

    const result = normalizeSopRecord(
      makeConversion({
        createdAt: "",
        process: "  Inspect, clean, record  ",
        standards: "  Site left clear  ",
      }),
    );

    expect(result.sopTitle).toBe("Captured title");
    expect(result.procedure).toBe("Inspect, clean, record");
    expect(result.qualityStandard).toBe("Site left clear");
    expect(result.status).toBe("Draft");
    expect(result.effectiveDate).toBe("2026-10-02T08:30:00.000Z");
  });
});
