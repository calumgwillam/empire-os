import type { ActionRecord, LessonRecord, SopRecord, SystemRecord } from "./capture-conversions";

export type LearningChangeTraceabilityInput = {
  lessons: readonly Readonly<Pick<LessonRecord, "id" | "title" | "lessonTitle" | "status" | "relatedSystem">>[];
  actions: readonly Readonly<Pick<ActionRecord,
    "id" | "title" | "actionTitle" | "relatedLesson" | "relatedProblem" | "relatedDecision"
    | "owner" | "ownerPersonId" | "status" | "completionEvidence" | "completionDate">>[];
  systems: readonly Readonly<Pick<SystemRecord, "id" | "title" | "systemName" | "status" | "relatedLesson">>[];
  sops: readonly Readonly<Pick<SopRecord,
    "id" | "title" | "sopTitle" | "status" | "relatedLesson" | "relatedSystem" | "completionEvidence">>[];
};

type OperatingRecordLink = {
  objectType: "Lesson" | "System" | "SOP";
  sourceId: string;
  field: "relatedLesson" | "relatedSystem";
  targetId: string;
};

export type LearningChangeTraceability = {
  sourceLessonId: string;
  sourceLessonTitle: string;
  lessonStatus: LessonRecord["status"];
  changeRequired: {
    state: "Change required" | "Unknown";
    evidence: { sourceId: string; field: "status"; value: LessonRecord["status"] };
  };
  implementation: {
    state: "Unknown";
    action: null;
    accountability: { state: "Unknown"; owner: null; ownerPersonId: null };
    completion: { state: "Unknown"; status: null; evidence: null };
  };
  operatingRecords: {
    state: "Explicit records linked" | "Unresolved reference" | "Unknown";
    systems: Array<Pick<SystemRecord, "id" | "title" | "systemName" | "status"> & { links: OperatingRecordLink[] }>;
    sops: Array<Pick<SopRecord, "id" | "title" | "sopTitle" | "status" | "completionEvidence"> & { links: OperatingRecordLink[] }>;
    unresolvedReferences: OperatingRecordLink[];
  };
  adoption: { state: "Unknown"; evidence: null };
  effectiveness: { state: "Unknown"; evidence: null };
  missingEvidence: Array<
    "Explicit change requirement"
    | "Authoritative Lesson-to-implementation Action relationship"
    | "Implementation Action accountability"
    | "Implementation completion evidence"
    | "Explicit System/SOP relationship"
    | "Referenced System record"
    | "Adoption evidence"
    | "Effectiveness assessment"
  >;
};

/**
 * Reports only recorded requirements and explicit operating-record ID links.
 *
 * Structural gap: Action.relatedLesson is inherited from CaptureConversionRecord,
 * but Action normalization, creation/save handlers and relationship policies do not
 * establish it as a Lesson implementation link. Actions therefore cannot establish
 * implementation, accountability or completion for a Lesson here.
 *
 * Lesson statuses have no explicit no-change assessment. SOP completionEvidence
 * records completion, not adoption; no existing field assesses learning-change
 * adoption or effectiveness. These stages remain unknown, even for active documents
 * or Implemented Lessons. Future implementation tracing needs an explicitly defined,
 * maintained Lesson-to-Action implementation relationship; no legacy links are inferred.
 */
export function buildLearningChangeTraceability(
  input: LearningChangeTraceabilityInput,
): LearningChangeTraceability[] {
  return input.lessons.map((lesson) => {
    const hasLessonId = lesson.id.trim() !== "";
    const hasRelatedSystem = lesson.relatedSystem.trim() !== "";
    const systems = input.systems.filter((system) =>
      (hasLessonId && system.relatedLesson === lesson.id)
      || (hasRelatedSystem && lesson.relatedSystem === system.id),
    ).map((system) => {
      const links: OperatingRecordLink[] = [];
      if (hasLessonId && system.relatedLesson === lesson.id) {
        links.push({ objectType: "System", sourceId: system.id, field: "relatedLesson", targetId: lesson.id });
      }
      if (hasRelatedSystem && lesson.relatedSystem === system.id) {
        links.push({ objectType: "Lesson", sourceId: lesson.id, field: "relatedSystem", targetId: system.id });
      }
      return { id: system.id, title: system.title, systemName: system.systemName, status: system.status, links };
    });
    const systemIds = new Set(systems.map(({ id }) => id).filter((id) => id.trim() !== ""));
    const sops = input.sops.filter((sop) =>
      (hasLessonId && sop.relatedLesson === lesson.id) || systemIds.has(sop.relatedSystem),
    ).map((sop) => {
      const links: OperatingRecordLink[] = [];
      if (hasLessonId && sop.relatedLesson === lesson.id) {
        links.push({ objectType: "SOP", sourceId: sop.id, field: "relatedLesson", targetId: lesson.id });
      }
      if (systemIds.has(sop.relatedSystem)) {
        links.push({ objectType: "SOP", sourceId: sop.id, field: "relatedSystem", targetId: sop.relatedSystem });
      }
      return {
        id: sop.id, title: sop.title, sopTitle: sop.sopTitle, status: sop.status,
        completionEvidence: sop.completionEvidence, links,
      };
    });
    const unresolvedReferences: OperatingRecordLink[] = hasRelatedSystem
      && !input.systems.some(({ id }) => id === lesson.relatedSystem)
      ? [{ objectType: "Lesson", sourceId: lesson.id, field: "relatedSystem", targetId: lesson.relatedSystem }]
      : [];
    const changeRequired = lesson.status === "Change Required";
    const missingEvidence: LearningChangeTraceability["missingEvidence"] = [];
    if (!changeRequired) missingEvidence.push("Explicit change requirement");
    missingEvidence.push(
      "Authoritative Lesson-to-implementation Action relationship",
      "Implementation Action accountability",
      "Implementation completion evidence",
    );
    if (systems.length === 0 && sops.length === 0) missingEvidence.push("Explicit System/SOP relationship");
    if (unresolvedReferences.length > 0) missingEvidence.push("Referenced System record");
    missingEvidence.push("Adoption evidence", "Effectiveness assessment");

    return {
      sourceLessonId: lesson.id,
      sourceLessonTitle: lesson.lessonTitle || lesson.title,
      lessonStatus: lesson.status,
      changeRequired: {
        state: changeRequired ? "Change required" : "Unknown",
        evidence: { sourceId: lesson.id, field: "status", value: lesson.status },
      },
      implementation: {
        state: "Unknown", action: null,
        accountability: { state: "Unknown", owner: null, ownerPersonId: null },
        completion: { state: "Unknown", status: null, evidence: null },
      },
      operatingRecords: {
        state: systems.length > 0 || sops.length > 0 ? "Explicit records linked"
          : unresolvedReferences.length > 0 ? "Unresolved reference" : "Unknown",
        systems, sops, unresolvedReferences,
      },
      adoption: { state: "Unknown", evidence: null },
      effectiveness: { state: "Unknown", evidence: null },
      missingEvidence,
    };
  });
}
