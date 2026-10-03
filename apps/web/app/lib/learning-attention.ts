import type { CommandAttentionItem } from "./command-attention";
import type { LearningEvidence, LearningSignal } from "./organisational-learning";

export type LearningAttentionKind =
  | "Review learning"
  | "Change required"
  | "Recurring learning"
  | "Institutionalisation";

export type LearningAttentionTarget = Pick<CommandAttentionItem, "objectType" | "id">;

export type LearningAttentionInput = {
  signal: Readonly<Omit<LearningSignal, "evidence" | "linkedLessonIds">> & {
    evidence: readonly Readonly<LearningEvidence>[];
    linkedLessonIds: readonly string[];
  };
  associatedTarget?: Readonly<LearningAttentionTarget>;
};

export type LearningAttentionSignal = {
  sourceType: LearningSignal["sourceType"];
  sourceId: string;
  sourceTitle: string;
  attentionRequired: true;
  attentionKind: LearningAttentionKind;
  target: LearningAttentionTarget;
};

// Consume structured learning conditions; outcome quality and narrative text are not materiality rules.
export function buildLearningAttention(
  input: readonly LearningAttentionInput[],
): LearningAttentionSignal[] {
  const result: LearningAttentionSignal[] = [];

  input.forEach(({ signal, associatedTarget }) => {
    const belongsToLesson = (id: string) =>
      (signal.sourceType === "Lesson" && signal.sourceId === id)
      || signal.linkedLessonIds.includes(id);
    const hasLessonStatus = (id: string, statuses: readonly string[]) => signal.evidence.some(
      (entry) => entry.sourceType === "Lesson" && entry.sourceId === id
        && entry.field === "status" && statuses.includes(entry.value),
    );
    const changeRequired = signal.evidence.some(
      (entry) => entry.sourceType === "Lesson" && belongsToLesson(entry.sourceId)
        && entry.field === "status" && entry.value === "Change Required",
    );
    const meaningfulLesson = signal.evidence.some(
      (entry) => entry.sourceType === "Lesson" && belongsToLesson(entry.sourceId)
        && entry.field === "status" && ["Reviewed", "Implemented"].includes(entry.value),
    );
    const unresolvedProblem = signal.sourceType === "Problem" && signal.evidence.some(
      (entry) => entry.sourceType === "Problem" && entry.sourceId === signal.sourceId
        && entry.field === "isUnresolved" && entry.value === "true",
    );
    const authoritativeRecurrence = signal.sourceType === "Problem"
      && (signal.recurrenceState === "Recorded recurrence" || signal.recurrenceState === "Institutionalised");
    const lessonChange = signal.evidence.some(
      (entry) => entry.sourceType === "Lesson" && belongsToLesson(entry.sourceId)
        && entry.field === "recommendedChange" && entry.value.trim() !== ""
        && hasLessonStatus(entry.sourceId, ["Reviewed", "Implemented"]),
    );

    let attentionKind: LearningAttentionKind;
    if (changeRequired) {
      attentionKind = "Change required";
    } else if (
      signal.recommendedNextTransition === "Consider System/SOP change"
      && signal.learningState === "Meaningful learning captured"
      && (lessonChange || (authoritativeRecurrence && unresolvedProblem && meaningfulLesson))
    ) {
      attentionKind = "Institutionalisation";
    } else if (
      authoritativeRecurrence && unresolvedProblem
      && signal.recommendedNextTransition === "Investigate recurrence"
    ) {
      attentionKind = "Recurring learning";
    } else {
      return;
    }

    result.push({
      sourceType: signal.sourceType,
      sourceId: signal.sourceId,
      sourceTitle: signal.sourceTitle,
      attentionRequired: true,
      attentionKind,
      target: associatedTarget
        ? { objectType: associatedTarget.objectType, id: associatedTarget.id }
        : { objectType: signal.sourceType, id: signal.sourceId },
    });
  });

  return result;
}
