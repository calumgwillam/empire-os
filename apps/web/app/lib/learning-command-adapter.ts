import type { CommandAttentionItem } from "./command-attention";
import type { LearningAttentionKind, LearningAttentionSignal } from "./learning-attention";

export type LearningCommandTarget = Pick<CommandAttentionItem, "objectType" | "id">;

export type LearningCommandCandidate = Readonly<Omit<LearningAttentionSignal, "target">> & {
  target: Readonly<LearningAttentionSignal["target"]>;
};

type LearningCommandSource = Pick<LearningAttentionSignal,
  "sourceType" | "sourceId" | "sourceTitle" | "attentionKind"> & {
  reason: string;
};

export type LearningCommandAugmentation = LearningCommandSource & (
  | { targetResolution: "Augment existing target"; target: LearningCommandTarget }
  | { targetResolution: "Unresolved target"; target: null }
);

const learningReasons: Record<LearningAttentionKind, string> = {
  "Review learning": "Learning: review learning",
  "Change required": "Learning: change required",
  "Recurring learning": "Learning: review recorded recurrence",
  "Institutionalisation": "Learning: consider System/SOP change",
};

// A gate target is not proof of an existing Command item; only supplied Command identities resolve it.
export function buildLearningCommandAdapter(
  candidates: readonly LearningCommandCandidate[],
  existingCommandTargets: readonly Readonly<LearningCommandTarget>[],
): LearningCommandAugmentation[] {
  return candidates.map((candidate): LearningCommandAugmentation => {
    const source: LearningCommandSource = {
      sourceType: candidate.sourceType,
      sourceId: candidate.sourceId,
      sourceTitle: candidate.sourceTitle,
      attentionKind: candidate.attentionKind,
      reason: candidate.reasons?.length ? `Icarus learning: ${candidate.reasons.join("; ")}` : learningReasons[candidate.attentionKind],
    };
    const target = existingCommandTargets.find(
      (entry) => entry.objectType === candidate.target.objectType && entry.id === candidate.target.id,
    );

    return target
      ? {
        ...source,
        targetResolution: "Augment existing target",
        target: { objectType: target.objectType, id: target.id },
      }
      : { ...source, targetResolution: "Unresolved target", target: null };
  });
}
