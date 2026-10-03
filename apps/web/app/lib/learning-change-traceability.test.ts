import { describe, expect, it } from "vitest";
import {
  buildLearningChangeTraceability,
  type LearningChangeTraceabilityInput,
} from "./learning-change-traceability";

function input(overrides: Partial<LearningChangeTraceabilityInput> = {}): LearningChangeTraceabilityInput {
  return { lessons: [], actions: [], systems: [], sops: [], ...overrides };
}

function lesson(overrides: Partial<LearningChangeTraceabilityInput["lessons"][number]> = {}) {
  return {
    id: "lesson-1", title: "Source lesson", lessonTitle: "", status: "Change Required" as const,
    relatedSystem: "", ...overrides,
  };
}

function action(overrides: Partial<LearningChangeTraceabilityInput["actions"][number]> = {}) {
  return {
    id: "action-1", title: "Source lesson", actionTitle: "Source lesson",
    relatedLesson: "lesson-1", relatedProblem: "", relatedDecision: "",
    owner: "Recorded owner", ownerPersonId: "person-1", status: "Open" as const,
    completionEvidence: "", completionDate: "", ...overrides,
  };
}

function system(overrides: Partial<LearningChangeTraceabilityInput["systems"][number]> = {}) {
  return {
    id: "system-1", title: "System", systemName: "Operating standard", status: "Draft" as const,
    relatedLesson: "lesson-1", ...overrides,
  };
}

function sop(overrides: Partial<LearningChangeTraceabilityInput["sops"][number]> = {}) {
  return {
    id: "sop-1", title: "SOP", sopTitle: "Procedure", status: "Draft" as const,
    relatedLesson: "", relatedSystem: "system-1", completionEvidence: "", ...overrides,
  };
}

describe("read-only learning change traceability", () => {
  it("returns no traceability entries without source Lessons", () => {
    expect(buildLearningChangeTraceability(input())).toEqual([]);
    expect(buildLearningChangeTraceability(input({
      actions: [action()], systems: [system()], sops: [sop()],
    }))).toEqual([]);
  });

  it.each(["New", "Reviewed", "Implemented", "Archived"] as const)(
    "does not interpret %s as an explicit current change requirement or a no-change assessment",
    (status) => {
      const result = buildLearningChangeTraceability(input({ lessons: [lesson({ status })] }))[0];
      expect(result.changeRequired).toEqual({
        state: "Unknown", evidence: { sourceId: "lesson-1", field: "status", value: status },
      });
      expect(result.missingEvidence).toContain("Explicit change requirement");
    },
  );

  it("preserves exact Change Required evidence and all unsupported stages as unknown", () => {
    const result = buildLearningChangeTraceability(input({ lessons: [lesson()] }))[0];
    expect(result).toMatchObject({
      sourceLessonId: "lesson-1", sourceLessonTitle: "Source lesson", lessonStatus: "Change Required",
      changeRequired: { state: "Change required" },
      implementation: {
        state: "Unknown", action: null,
        accountability: { state: "Unknown", owner: null, ownerPersonId: null },
        completion: { state: "Unknown", status: null, evidence: null },
      },
      operatingRecords: { state: "Unknown", systems: [], sops: [], unresolvedReferences: [] },
      adoption: { state: "Unknown", evidence: null },
      effectiveness: { state: "Unknown", evidence: null },
    });
    expect(result.missingEvidence).toEqual([
      "Authoritative Lesson-to-implementation Action relationship",
      "Implementation Action accountability", "Implementation completion evidence",
      "Explicit System/SOP relationship", "Adoption evidence", "Effectiveness assessment",
    ]);
  });

  it.each(["Open", "Completed"] as const)(
    "does not treat a populated generic relatedLesson or an owned %s Action as proof of implementation",
    (status) => {
      const result = buildLearningChangeTraceability(input({
        lessons: [lesson()],
        actions: [action({ status, completionEvidence: "  Checklist changed.\nRecorded result.  ", completionDate: "2026-10-03" })],
      }))[0];
      expect(result.implementation).toEqual({
        state: "Unknown", action: null,
        accountability: { state: "Unknown", owner: null, ownerPersonId: null },
        completion: { state: "Unknown", status: null, evidence: null },
      });
      expect(result.adoption).toEqual({ state: "Unknown", evidence: null });
      expect(result.effectiveness).toEqual({ state: "Unknown", evidence: null });
    },
  );

  it.each([
    { owner: "", ownerPersonId: undefined },
    { owner: "Recorded owner", ownerPersonId: undefined },
    { owner: "", ownerPersonId: "person-1" },
    { owner: "Recorded owner", ownerPersonId: "person-1" },
  ])("does not assign Action accountability without authoritative implementation semantics: %j", (ownership) => {
    const result = buildLearningChangeTraceability(input({
      lessons: [lesson()], actions: [action(ownership)],
    }))[0];
    expect(result.implementation.accountability).toEqual({
      state: "Unknown", owner: null, ownerPersonId: null,
    });
    expect(result.missingEvidence).toContain("Authoritative Lesson-to-implementation Action relationship");
    expect(result.missingEvidence).toContain("Implementation Action accountability");
  });

  it.each([undefined, "", "lesson-1"])(
    "keeps implementation unknown for legacy or populated relatedLesson (%s), even with completion evidence",
    (relatedLesson) => {
      const result = buildLearningChangeTraceability(input({
        lessons: [lesson()],
        actions: [action({
          relatedLesson, status: "Completed", completionEvidence: "Recorded completion",
          completionDate: "2026-10-03",
        })],
      }))[0];
      expect(result.implementation.action).toBeNull();
      expect(result.implementation.completion).toEqual({ state: "Unknown", status: null, evidence: null });
      expect(result.missingEvidence).toContain("Implementation completion evidence");
      expect(result.adoption).toEqual({ state: "Unknown", evidence: null });
      expect(result.effectiveness).toEqual({ state: "Unknown", evidence: null });
    },
  );

  it("does not turn historical recommendedChange into either a requirement or an implementation link", () => {
    for (const status of ["Reviewed", "Change Required"] as const) {
      const sourceLesson = { ...lesson({ status }), recommendedChange: "Source lesson" };
      const result = buildLearningChangeTraceability(input({
        lessons: [sourceLesson], actions: [action()],
      }));
      expect(result).toEqual(buildLearningChangeTraceability(input({ lessons: [lesson({ status })] })));
      expect(result[0].changeRequired.state).toBe(status === "Change Required" ? "Change required" : "Unknown");
    }
  });

  it("does not infer implementation from shared Problems, Decisions, captures, titles or historical recommendations", () => {
    const sourceLesson = {
      ...lesson({ status: "Reviewed" }),
      recommendedChange: "Perform the Action", relatedProblem: "problem-1", relatedDecision: "decision-1",
      sourceCaptureId: "capture-1",
    };
    const sourceAction = {
      ...action({ relatedLesson: "", relatedProblem: "problem-1", relatedDecision: "decision-1" }),
      sourceCaptureId: "capture-1",
    };
    expect(buildLearningChangeTraceability(input({
      lessons: [sourceLesson], actions: [sourceAction],
    }))).toEqual(buildLearningChangeTraceability(input({ lessons: [lesson({ status: "Reviewed" })] })));
  });

  it("preserves forward and reverse System links and their exact provenance", () => {
    const result = buildLearningChangeTraceability(input({
      lessons: [lesson({ relatedSystem: "system-1" })], systems: [system()],
    }))[0];
    expect(result.operatingRecords.systems).toEqual([{
      id: "system-1", title: "System", systemName: "Operating standard", status: "Draft",
      links: [
        { objectType: "System", sourceId: "system-1", field: "relatedLesson", targetId: "lesson-1" },
        { objectType: "Lesson", sourceId: "lesson-1", field: "relatedSystem", targetId: "system-1" },
      ],
    }]);
    expect(result.operatingRecords.state).toBe("Explicit records linked");
    expect(result.missingEvidence).not.toContain("Explicit System/SOP relationship");
  });

  it("accepts an explicit Lesson-to-System ID without a reverse link", () => {
    const result = buildLearningChangeTraceability(input({
      lessons: [lesson({ relatedSystem: "system-1" })], systems: [system({ relatedLesson: "" })],
    }))[0];
    expect(result.operatingRecords.systems[0].links).toEqual([
      { objectType: "Lesson", sourceId: "lesson-1", field: "relatedSystem", targetId: "system-1" },
    ]);
  });

  it("preserves direct SOP and explicit System-mediated SOP links without requiring active status", () => {
    const result = buildLearningChangeTraceability(input({
      lessons: [lesson()], systems: [system()],
      sops: [
        sop({ id: "direct", relatedLesson: "lesson-1", relatedSystem: "" }),
        sop({ id: "via-system" }),
      ],
    }))[0];
    expect(result.operatingRecords.sops.map(({ id, links }) => ({ id, links }))).toEqual([
      { id: "direct", links: [{ objectType: "SOP", sourceId: "direct", field: "relatedLesson", targetId: "lesson-1" }] },
      { id: "via-system", links: [{ objectType: "SOP", sourceId: "via-system", field: "relatedSystem", targetId: "system-1" }] },
    ]);
  });

  it("exposes dangling System references without resolving them by name or through a nonexistent System", () => {
    const result = buildLearningChangeTraceability(input({
      lessons: [lesson({ relatedSystem: "missing" })],
      systems: [system({ relatedLesson: "", systemName: "Source lesson" })],
      sops: [sop({ relatedSystem: "missing", sopTitle: "Source lesson" })],
    }))[0];
    expect(result.operatingRecords).toEqual({
      state: "Unresolved reference", systems: [], sops: [],
      unresolvedReferences: [{
        objectType: "Lesson", sourceId: "lesson-1", field: "relatedSystem", targetId: "missing",
      }],
    });
    expect(result.missingEvidence).toContain("Referenced System record");
  });

  it.each(["", "   "])("does not create relationships by matching blank Lesson IDs (%j)", (id) => {
    const result = buildLearningChangeTraceability(input({
      lessons: [lesson({ id, relatedSystem: id })],
      systems: [system({ id, relatedLesson: id })],
      sops: [sop({ relatedLesson: id, relatedSystem: id })],
    }))[0];
    expect(result.operatingRecords).toEqual({
      state: "Unknown", systems: [], sops: [], unresolvedReferences: [],
    });
    expect(result.missingEvidence).toContain("Explicit System/SOP relationship");
  });

  it.each(["", "   "])("does not use a linked System's blank ID (%j) to invent SOP links", (id) => {
    const result = buildLearningChangeTraceability(input({
      lessons: [lesson()], systems: [system({ id })],
      sops: [sop({ relatedSystem: id })],
    }))[0];
    expect(result.operatingRecords.systems).toHaveLength(1);
    expect(result.operatingRecords.systems[0].links).toEqual([
      { objectType: "System", sourceId: id, field: "relatedLesson", targetId: "lesson-1" },
    ]);
    expect(result.operatingRecords.sops).toEqual([]);
  });

  it("does not resolve System or SOP names as relationships", () => {
    const result = buildLearningChangeTraceability(input({
      lessons: [lesson()],
      systems: [system({ relatedLesson: "", title: "Source lesson", systemName: "Source lesson" })],
      sops: [sop({ relatedSystem: "", title: "Source lesson", sopTitle: "Source lesson" })],
    }))[0];
    expect(result.operatingRecords).toEqual({
      state: "Unknown", systems: [], sops: [], unresolvedReferences: [],
    });
  });

  it.each(["Active", "Reviewing"] as const)(
    "does not treat %s operating documents, implementation status or SOP completion text as adoption/effectiveness",
    (status) => {
      const result = buildLearningChangeTraceability(input({
        lessons: [lesson({ status: "Implemented" })], systems: [system({ status })],
        sops: [sop({ status, completionEvidence: "  Work completed according to procedure.  " })],
      }))[0];
      expect(result.operatingRecords.sops[0].completionEvidence)
        .toBe("  Work completed according to procedure.  ");
      expect(result.adoption).toEqual({ state: "Unknown", evidence: null });
      expect(result.effectiveness).toEqual({ state: "Unknown", evidence: null });
      expect(result.missingEvidence).toEqual(expect.arrayContaining(["Adoption evidence", "Effectiveness assessment"]));
      expect(result).not.toHaveProperty("closed");
      expect(result).not.toHaveProperty("institutionalised");
    },
  );

  it("is deterministic, preserves source order and does not mutate frozen inputs or share mutable output links", () => {
    const source = input({
      lessons: [lesson({ id: "second" }), lesson({ lessonTitle: "  Exact title\nretained  " })],
      actions: [action()], systems: [system()], sops: [sop()],
    });
    const before = structuredClone(source);
    function freeze(value: unknown): void {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    }
    freeze(source);
    const first = buildLearningChangeTraceability(source);
    expect(buildLearningChangeTraceability(source)).toEqual(first);
    expect(first.map(({ sourceLessonId }) => sourceLessonId)).toEqual(["second", "lesson-1"]);
    expect(first[1].sourceLessonTitle).toBe("  Exact title\nretained  ");
    first[1].operatingRecords.systems[0].links[0].targetId = "changed output";
    first[1].missingEvidence.push("Explicit change requirement");
    expect(source).toEqual(before);
    expect(buildLearningChangeTraceability(source)[1].operatingRecords.systems[0].links[0].targetId).toBe("lesson-1");
  });

  it("introduces no ranking, priority, probability or strategic importance fields", () => {
    const sourceLesson = { ...lesson(), importance: "Critical" };
    const sourceAction = { ...action(), priority: "Critical" as const };
    const sourceSystem = { ...system(), importance: "Critical" };
    const sourceSop = { ...sop(), importance: "Critical" };
    const result = buildLearningChangeTraceability(input({
      lessons: [sourceLesson], actions: [sourceAction], systems: [sourceSystem], sops: [sourceSop],
    }))[0];
    expect(Object.keys(result).sort()).toEqual([
      "adoption", "changeRequired", "effectiveness", "implementation", "lessonStatus",
      "missingEvidence", "operatingRecords", "sourceLessonId", "sourceLessonTitle",
    ]);
    const forbidden = [
      "rank", "ranking", "score", "priorityScore", "attentionRank", "tieWeight",
      "priority", "probability", "importance", "strategicImportance", "closed",
    ];
    function checkFields(value: unknown): void {
      if (value && typeof value === "object") {
        for (const [field, child] of Object.entries(value)) {
          expect(forbidden).not.toContain(field);
          checkFields(child);
        }
      }
    }
    checkFields(result);
  });
});
