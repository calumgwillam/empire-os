import {
  appendFounderRelationshipObservation,
  createFounderRelationshipObservation,
  createFounderRelationshipRecord,
  deriveFounderRelationshipUnderstanding,
  normaliseFounderIntelligence,
  type FounderIntelligence,
  type FounderIntelligenceContext,
  type FounderIntelligenceEvidenceReference,
  type FounderRelationshipEvidenceKind,
  type PairIntelligenceRecord,
} from "./founder-intelligence";

export const founderRelationshipKinds: readonly {
  value: FounderRelationshipEvidenceKind;
  label: string;
}[] = [
  { value: "source-grounded-understanding", label: "Source-grounded understanding" },
  { value: "operating-observation", label: "Independently evidenced operating observation" },
  { value: "compatibility-interpretation", label: "Human-authored compatibility interpretation" },
];

export type FounderRelationshipEvidenceOption = {
  key: string;
  label: string;
  reference: FounderIntelligenceEvidenceReference;
};

export type FounderRelationshipDraft = {
  observationKey: string;
  personIds: [string, string];
  kind: FounderRelationshipEvidenceKind;
  dimension: string;
  statement: string;
  fromPersonId?: string;
  evidenceKeys: string[];
  keepUnresolved: boolean;
};

export function getFounderRelationshipEvidenceOptions(
  pair: PairIntelligenceRecord,
  kind: FounderRelationshipEvidenceKind,
  context: FounderIntelligenceContext,
): FounderRelationshipEvidenceOption[] {
  const options: FounderRelationshipEvidenceOption[] = [];
  const add = (reference: FounderIntelligenceEvidenceReference, label: string) => {
    options.push({ key: JSON.stringify(reference), label, reference });
  };
  if (kind !== "operating-observation") {
    context.people.filter((person) => pair.personIds.includes(person.id)).forEach((person) => {
      person.operatingProfile?.sourceSubmissions?.forEach((submission) => {
        submission.answers.forEach((answer, answerIndex) => add({
          type: "source-answer", personId: person.id, sourceSubmissionId: submission.id, answerIndex,
        }, `${person.id} / ${submission.sourceTitle} / answer ${answerIndex + 1}: ${answer.question}`));
      });
      person.operatingProfile?.individualUnderstandings?.forEach((understanding) => {
        const claim = understanding.understanding;
        if (claim.status !== "evidence-grounded-understanding") return;
        add({
          type: "individual-understanding", personId: person.id,
          understandingId: understanding.id, claimId: claim.id,
        }, `${person.id} / ${understanding.dimension}: ${claim.statement}`);
      });
    });
  }
  if (kind === "operating-observation") {
    context.operationalEvidence?.filter((outcome) => pair.personIds.includes(outcome.personId))
      .forEach((outcome) => add({
        type: "operational-outcome", personId: outcome.personId,
        recordType: outcome.recordType, recordId: outcome.recordId, outcomeId: outcome.outcomeId,
      }, `${outcome.personId} / ${outcome.recordType} ${outcome.recordId} / ${outcome.outcome}: ${outcome.observedResult ?? "Result unavailable"}`));
  }
  if (kind === "compatibility-interpretation") {
    const understanding = deriveFounderRelationshipUnderstanding(pair, context);
    [...understanding.sourceUnderstandings, ...understanding.operatingObservations]
      .filter((observation) => observation.claim.status === "evidence-grounded-understanding")
      .forEach((observation) => add({
        type: "pair-observation", pairId: pair.id, observationId: observation.id,
      }, `${observation.relationshipKind} / ${observation.dimension}: ${observation.claim.statement}`));
  }
  return [...new Map(options.map((option) => [option.key, option])).values()];
}

export function recordFounderRelationshipDraft(
  intelligence: FounderIntelligence,
  draft: FounderRelationshipDraft,
  context: FounderIntelligenceContext,
): FounderIntelligence {
  if (!draft.observationKey.trim() || !draft.dimension.trim() || !draft.statement.trim()) {
    throw new Error("An observation key, relationship dimension and human-authored statement are required.");
  }
  if (!founderRelationshipKinds.some((kind) => kind.value === draft.kind)) {
    throw new Error("Select a supported founder relationship evidence kind.");
  }
  const scaffold = createFounderRelationshipRecord(draft.personIds, context);
  const pair = intelligence.pairRecords.find((record) => record.id === scaffold.id) ?? scaffold;
  if (draft.fromPersonId !== undefined
    && (draft.kind !== "source-grounded-understanding" || !pair.personIds.includes(draft.fromPersonId))) {
    throw new Error("Directional understanding must identify a founder in this relationship.");
  }
  const options = getFounderRelationshipEvidenceOptions(pair, draft.kind, context);
  const evidence = [...new Set(draft.evidenceKeys)].map((key) => {
    const option = options.find((candidate) => candidate.key === key);
    if (!option) throw new Error("A selected evidence reference is no longer available. Review the evidence selection.");
    return option.reference;
  });
  if (evidence.length === 0 && !draft.keepUnresolved) {
    throw new Error("Select evidence or explicitly record this as unresolved.");
  }
  const toPersonId = pair.personIds.find((id) => id !== draft.fromPersonId);
  const observation = createFounderRelationshipObservation(pair, draft.observationKey, {
    relationshipKind: draft.kind,
    dimension: draft.dimension.trim(),
    ...(draft.fromPersonId && toPersonId
      ? { direction: { fromPersonId: draft.fromPersonId, toPersonId } } : {}),
    claim: {
      id: `${pair.id}:relationship:${encodeURIComponent(draft.observationKey)}:claim`,
      status: draft.keepUnresolved ? "unresolved"
        : draft.kind === "compatibility-interpretation"
          ? "supported-interpretation" : "evidence-grounded-understanding",
      statement: draft.statement.trim(),
      evidence,
    },
  });
  const appended = appendFounderRelationshipObservation(intelligence, pair, observation, context);
  return { ...intelligence, pairRecords: appended.pairRecords };
}

export function reviewFounderRelationshipEvidence(
  intelligence: FounderIntelligence,
  context: FounderIntelligenceContext,
): FounderIntelligence {
  const pairRecords = intelligence.pairRecords.map((pair) => {
    if (!pair.observations.some((observation) => observation.relationshipKind !== undefined)) return pair;
    const normalized = normaliseFounderIntelligence({ pairRecords: [pair] }, context).pairRecords[0];
    if (!normalized) throw new Error("The founder relationship record could not be reviewed.");
    return normalized;
  });
  return { ...intelligence, pairRecords };
}
