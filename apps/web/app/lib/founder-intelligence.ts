import type {
  EvidenceLinkedUnderstandingClaim,
  IndividualOperatingUnderstanding,
} from "./individual-operating-understanding";
import type {
  OperatingProfileSourceSubmission,
  OperatingProfileSourceAnswer,
} from "./operating-profile-evidence";

export type FounderIntelligenceEvidenceReference =
  | {
      type: "source-answer";
      personId: string;
      sourceSubmissionId: string;
      answerIndex: number;
    }
  | {
      type: "individual-understanding";
      personId: string;
      understandingId: string;
      claimId: string;
    }
  | {
      type: "pair-observation";
      pairId: string;
      observationId: string;
    }
  | {
      type: "operational-outcome";
      personId: string;
      recordType: string;
      recordId: string;
      outcomeId: string;
    };

export type FounderIntelligenceClaimStatus =
  | "evidence-grounded-understanding"
  | "supported-interpretation"
  | "unresolved";

export type FounderIntelligenceClaim = {
  id: string;
  status: FounderIntelligenceClaimStatus;
  candidateStatus?: Exclude<FounderIntelligenceClaimStatus, "unresolved">;
  statement: string;
  evidence: FounderIntelligenceEvidenceReference[];
};

export type PairIntelligenceObservation = {
  id: string;
  dimension: string;
  direction?: {
    fromPersonId: string;
    toPersonId: string;
  };
  claim: FounderIntelligenceClaim;
};

export type PairIntelligenceRecord = {
  id: string;
  personIds: [string, string];
  observations: PairIntelligenceObservation[];
};

export type TrioIntelligenceObservation = {
  id: string;
  dimension: string;
  claim: FounderIntelligenceClaim;
};

export type TrioIntelligenceRecord = {
  id: string;
  personIds: [string, string, string];
  observations: TrioIntelligenceObservation[];
};

export type ResponsibilityFitKind =
  | "stated-capability"
  | "evidence-grounded-fit"
  | "demonstrated-capability"
  | "inferred-fit"
  | "unresolved";

export type ResponsibilityFitStatus =
  | "strong-potential-fit"
  | "potential-fit"
  | "conditional-fit"
  | "insufficient-evidence"
  | "poor-evidence-fit"
  | "unresolved";

export type ResponsibilityRequirementType =
  | "capability"
  | "operating-characteristic"
  | "decision-demand"
  | "communication-demand"
  | "reliability-demand"
  | "technical-requirement"
  | "commercial-requirement"
  | "leadership-requirement"
  | "strategic-requirement"
  | "customer-facing-requirement"
  | "organisational-requirement";

export type ResponsibilityDefinition = {
  id: string;
  title: string;
  description: string;
  requirements: ResponsibilityRequirement[];
};

export type ResponsibilityWorkItemReference = {
  objectType: "Action" | "Project" | "Lead" | "Problem";
  objectId: string;
};

export type ResponsibilityContributionMode =
  | "owner"
  | "lead"
  | "executor"
  | "contributor"
  | "support"
  | "reviewer";

export type OperationalOutcomeEvidence = {
  id: string;
  personId: string;
  recordType: string;
  recordId: string;
  outcomeId: string;
  contribution: ResponsibilityContributionMode;
  outcome: "successful" | "mixed" | "unsuccessful" | "unassessed";
  observedResult: string;
  evidenceStatus: "resolved" | "unresolved";
  responsibilityId?: string;
  requirementId?: string;
};

export type ResponsibilityAssessmentTarget =
  | { type: "responsibility"; responsibilityId: string }
  | {
      type: "work-item";
      workItem: ResponsibilityWorkItemReference;
      responsibilityId?: string;
    };

export type ResponsibilityFitAssessment = {
  id: string;
  personId: string;
  responsibility: string;
  contribution: ResponsibilityContributionMode;
  fit: ResponsibilityFitKind;
  candidateFit?: Exclude<ResponsibilityFitKind, "unresolved">;
  target?: ResponsibilityAssessmentTarget;
  requirementIds?: string[];
  assessmentStatus?: ResponsibilityFitStatus;
  candidateAssessmentStatus?: Exclude<ResponsibilityFitStatus, "unresolved">;
  unresolvedRequirementIds?: string[];
  limitations?: string[];
  reviewState?: "not-reviewed" | "review-needed" | "reviewed";
  reviewedAt?: string;
  claim: FounderIntelligenceClaim;
};

export type ResponsibilityRequirement = {
  id: string;
  capability: string;
  description: string;
  type?: ResponsibilityRequirementType;
};

export type ResponsibilityFitArrangement = {
  id: string;
  assessmentIds: string[];
  status: ResponsibilityFitStatus;
  candidateStatus?: Exclude<ResponsibilityFitStatus, "unresolved">;
  claim: FounderIntelligenceClaim;
};

export type DevelopmentOpportunity = {
  id: string;
  personId: string;
  requirementId?: string;
  statement: string;
  status: "supported" | "unresolved";
  claim: FounderIntelligenceClaim;
  reviewState?: "not-reviewed" | "review-needed" | "reviewed";
};

export type ResponsibilityFitRecord = {
  id: string;
  title: string;
  responsibilityId?: string;
  target?: ResponsibilityAssessmentTarget;
  requirements: ResponsibilityRequirement[];
  assessments: ResponsibilityFitAssessment[];
  arrangements?: ResponsibilityFitArrangement[];
};

export type FounderIntelligence = {
  pairRecords: PairIntelligenceRecord[];
  trioRecords: TrioIntelligenceRecord[];
  responsibilities: ResponsibilityDefinition[];
  responsibilityFits: ResponsibilityFitRecord[];
  developmentOpportunities: DevelopmentOpportunity[];
  operationalOutcomes: OperationalOutcomeEvidence[];
};

export type FounderIntelligencePerson = {
  id: string;
  operatingProfile?: {
    sourceSubmissions?: readonly OperatingProfileSourceSubmission[];
    individualUnderstandings?: readonly IndividualOperatingUnderstanding[];
  };
};

export type FounderIntelligenceContext = {
  people: readonly FounderIntelligencePerson[];
  pairRecords?: readonly PairIntelligenceRecord[];
  responsibilities?: readonly ResponsibilityDefinition[];
  workItems?: readonly ResponsibilityWorkItemReference[];
  operationalRecords?: readonly { recordType: string; recordId: string }[];
  operationalEvidence?: readonly (Pick<
    OperationalOutcomeEvidence,
    "personId" | "recordType" | "recordId" | "outcomeId" | "contribution" | "outcome"
  > & {
    observedResult?: string;
    responsibilityId?: string;
    requirementId?: string;
  })[];
  operationalOutcomeAssertions?: readonly OperationalOutcomeEvidence[];
  operationalOutcomeAssertionsProvided?: boolean;
};

const validClaimStatuses: readonly FounderIntelligenceClaimStatus[] = [
  "evidence-grounded-understanding",
  "supported-interpretation",
  "unresolved",
];
const validResponsibilityFitKinds: readonly ResponsibilityFitKind[] = [
  "stated-capability",
  "evidence-grounded-fit",
  "demonstrated-capability",
  "inferred-fit",
  "unresolved",
];
const validResponsibilityFitStatuses: readonly ResponsibilityFitStatus[] = [
  "strong-potential-fit",
  "potential-fit",
  "conditional-fit",
  "insufficient-evidence",
  "poor-evidence-fit",
  "unresolved",
];
const validRequirementTypes: readonly ResponsibilityRequirementType[] = [
  "capability",
  "operating-characteristic",
  "decision-demand",
  "communication-demand",
  "reliability-demand",
  "technical-requirement",
  "commercial-requirement",
  "leadership-requirement",
  "strategic-requirement",
  "customer-facing-requirement",
  "organisational-requirement",
];
const validReviewStates = ["not-reviewed", "review-needed", "reviewed"] as const;
const validContributionTypes: readonly ResponsibilityFitAssessment["contribution"][] = [
  "owner",
  "lead",
  "contributor",
  "support",
  "executor",
  "reviewer",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidClaimStructure(value: unknown): boolean {
  return isPlainObject(value)
    && nonEmptyString(value.id)
    && typeof value.statement === "string"
    && (value.status === undefined || validClaimStatuses.includes(value.status as FounderIntelligenceClaimStatus))
    && (value.candidateStatus === undefined
      || ["evidence-grounded-understanding", "supported-interpretation"].includes(value.candidateStatus as string))
    && (value.evidence === undefined
      || (Array.isArray(value.evidence) && value.evidence.every((reference) =>
        isPlainObject(reference)
        && ((reference.type === "source-answer"
          && nonEmptyString(reference.personId)
          && nonEmptyString(reference.sourceSubmissionId)
          && typeof reference.answerIndex === "number"
          && Number.isInteger(reference.answerIndex))
        || (reference.type === "individual-understanding"
          && nonEmptyString(reference.personId)
          && nonEmptyString(reference.understandingId)
          && nonEmptyString(reference.claimId))
        || (reference.type === "pair-observation"
          && nonEmptyString(reference.pairId)
          && nonEmptyString(reference.observationId))
        || (reference.type === "operational-outcome"
          && nonEmptyString(reference.personId)
          && nonEmptyString(reference.recordType)
          && nonEmptyString(reference.recordId)
          && nonEmptyString(reference.outcomeId))))));
}

function isValidRequirementStructure(value: unknown): boolean {
  return isPlainObject(value)
    && nonEmptyString(value.id)
    && nonEmptyString(value.capability)
    && typeof value.description === "string"
    && (value.type === undefined || validRequirementTypes.includes(value.type as ResponsibilityRequirementType));
}

function isValidAssessmentStructure(value: unknown): boolean {
  return isPlainObject(value)
    && nonEmptyString(value.id)
    && nonEmptyString(value.personId)
    && nonEmptyString(value.responsibility)
    && validContributionTypes.includes(value.contribution as ResponsibilityContributionMode)
    && validResponsibilityFitKinds.includes((value.candidateFit ?? value.fit) as ResponsibilityFitKind)
    && isValidClaimStructure(value.claim)
    && (value.target === undefined || normaliseAssessmentTarget(value.target) !== null)
    && (value.assessmentStatus === undefined
      || validResponsibilityFitStatuses.includes(value.assessmentStatus as ResponsibilityFitStatus))
    && (value.candidateAssessmentStatus === undefined
      || validResponsibilityFitStatuses.includes(value.candidateAssessmentStatus as ResponsibilityFitStatus))
    && (value.reviewState === undefined
      || validReviewStates.includes(value.reviewState as (typeof validReviewStates)[number]))
    && (value.reviewedAt === undefined || typeof value.reviewedAt === "string")
    && (value.requirementIds === undefined
      || (Array.isArray(value.requirementIds) && value.requirementIds.every(nonEmptyString)))
    && (value.unresolvedRequirementIds === undefined
      || (Array.isArray(value.unresolvedRequirementIds) && value.unresolvedRequirementIds.every(nonEmptyString)))
    && (value.limitations === undefined
      || (Array.isArray(value.limitations) && value.limitations.every((entry) => typeof entry === "string")));
}

function isValidFounderIntelligenceRecordStructure(value: unknown, key: string): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (!isPlainObject(entry)) return false;
    switch (key) {
      case "pairRecords":
      case "trioRecords": {
        const expectedPeople = key === "pairRecords" ? 2 : 3;
        const personIds = Array.isArray(entry.personIds) ? entry.personIds : [];
        const validObservations = entry.observations === undefined
          || (Array.isArray(entry.observations) && entry.observations.every((observation) =>
            isPlainObject(observation)
            && nonEmptyString(observation.id)
            && nonEmptyString(observation.dimension)
            && isValidClaimStructure(observation.claim)
            && (observation.direction === undefined
              || (isPlainObject(observation.direction)
                && nonEmptyString(observation.direction.fromPersonId)
                && nonEmptyString(observation.direction.toPersonId)
                && observation.direction.fromPersonId !== observation.direction.toPersonId
                && personIds.includes(observation.direction.fromPersonId)
                && personIds.includes(observation.direction.toPersonId)))));
        return (entry.id === undefined || typeof entry.id === "string")
          && personIds.length === expectedPeople
          && personIds.every(nonEmptyString)
          && new Set(personIds).size === expectedPeople
          && validObservations;
      }
      case "responsibilities":
        return nonEmptyString(entry.id)
          && nonEmptyString(entry.title)
          && (entry.description === undefined || typeof entry.description === "string")
          && (entry.responsibilityId === undefined || nonEmptyString(entry.responsibilityId))
          && (entry.requirements === undefined
            || (Array.isArray(entry.requirements) && entry.requirements.every(isValidRequirementStructure)));
      case "responsibilityFits": {
        const validAssessments = entry.assessments === undefined
          || (Array.isArray(entry.assessments) && entry.assessments.every(isValidAssessmentStructure));
        const validArrangements = entry.arrangements === undefined
          || (Array.isArray(entry.arrangements) && entry.arrangements.every((arrangement) =>
            isPlainObject(arrangement)
            && nonEmptyString(arrangement.id)
            && Array.isArray(arrangement.assessmentIds)
            && arrangement.assessmentIds.every(nonEmptyString)
            && validResponsibilityFitStatuses.includes(
              (arrangement.candidateStatus ?? arrangement.status) as ResponsibilityFitStatus,
            )
            && isValidClaimStructure(arrangement.claim)));
        return nonEmptyString(entry.id)
          && nonEmptyString(entry.title)
          && (entry.responsibilityId === undefined || nonEmptyString(entry.responsibilityId))
          && (entry.target === undefined || normaliseAssessmentTarget(entry.target) !== null)
          && (entry.requirements === undefined
            || (Array.isArray(entry.requirements) && entry.requirements.every(isValidRequirementStructure)))
          && validAssessments
          && validArrangements;
      }
      case "developmentOpportunities":
        return nonEmptyString(entry.id)
          && nonEmptyString(entry.personId)
          && typeof entry.statement === "string"
          && isValidClaimStructure(entry.claim)
          && (entry.reviewState === undefined
            || validReviewStates.includes(entry.reviewState as (typeof validReviewStates)[number]))
          && (!isPlainObject(entry.claim) || entry.claim.statement === entry.statement);
      case "operationalOutcomes":
        return nonEmptyString(entry.id)
          && nonEmptyString(entry.personId)
          && nonEmptyString(entry.recordType)
          && nonEmptyString(entry.recordId)
          && nonEmptyString(entry.outcomeId)
          && validContributionTypes.includes(entry.contribution as ResponsibilityContributionMode)
          && ["successful", "mixed", "unsuccessful", "unassessed"].includes(entry.outcome as string)
          && nonEmptyString(entry.observedResult)
          && (entry.responsibilityId === undefined || nonEmptyString(entry.responsibilityId))
          && (entry.requirementId === undefined || nonEmptyString(entry.requirementId));
      default:
        return false;
    }
  });
}

export function assertFounderIntelligenceDataStructure(value: unknown): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error("Stored founder intelligence must be an object.");
  const recordKeys = [
    "pairRecords",
    "trioRecords",
    "responsibilities",
    "responsibilityFits",
    "developmentOpportunities",
    "operationalOutcomes",
  ] as const;
  for (const key of recordKeys) {
    if (key in value && !isValidFounderIntelligenceRecordStructure(value[key], key)) {
      throw new Error(`Stored founder intelligence contains malformed ${key}.`);
    }
  }
}

function sortedDistinctIds(personIds: readonly string[]): string[] {
  return [...new Set(personIds.filter(nonEmptyString))].sort();
}

function mergeClaims(
  existing: FounderIntelligenceClaim,
  incoming: FounderIntelligenceClaim,
): FounderIntelligenceClaim {
  const evidence = [...new Map(
    [...existing.evidence, ...incoming.evidence].map((reference) => [JSON.stringify(reference), reference]),
  ).values()];
  if (existing.statement !== incoming.statement) {
    return {
      id: existing.id,
      statement: existing.statement,
      status: "unresolved",
      evidence,
    };
  }
  return {
    ...incoming,
    status: existing.status === "unresolved" || incoming.status === "unresolved"
      ? "unresolved"
      : incoming.status,
    ...(existing.status === "unresolved" || incoming.status === "unresolved"
      ? {
        candidateStatus: incoming.candidateStatus
          ?? existing.candidateStatus
          ?? (incoming.status !== "unresolved" ? incoming.status : undefined),
      }
      : {}),
    evidence,
  };
}

function mergeClaimedById<T extends { id: string; claim: FounderIntelligenceClaim }>(
  left: readonly T[],
  right: readonly T[],
): T[] {
  const records = new Map(left.map((record) => [record.id, record]));
  right.forEach((record) => {
    const existing = records.get(record.id);
    if (!existing) {
      records.set(record.id, record);
      return;
    }
    const claim = mergeClaims(existing.claim, record.claim);
    const merged = { ...existing, ...record, claim };
    if (claim.status === "unresolved") {
      if ("fit" in merged && merged.fit !== "unresolved") {
        Object.assign(merged, {
          candidateFit: ("candidateFit" in merged ? merged.candidateFit : undefined) ?? merged.fit,
          fit: "unresolved",
        });
      }
      if ("assessmentStatus" in merged
        && merged.assessmentStatus !== undefined
        && merged.assessmentStatus !== "unresolved") {
        Object.assign(merged, {
          candidateAssessmentStatus: ("candidateAssessmentStatus" in merged
            ? merged.candidateAssessmentStatus
            : undefined) ?? merged.assessmentStatus,
          assessmentStatus: "unresolved",
        });
      }
      if ("status" in merged
        && validResponsibilityFitStatuses.includes(merged.status as ResponsibilityFitStatus)
        && merged.status !== "unresolved") {
        Object.assign(merged, {
          candidateStatus: ("candidateStatus" in merged ? merged.candidateStatus : undefined) ?? merged.status,
          status: "unresolved",
        });
      }
    }
    records.set(record.id, merged);
  });
  return [...records.values()];
}

function mergeById<T extends { id: string }>(left: readonly T[], right: readonly T[]): T[] {
  const records = new Map(left.map((record) => [record.id, record]));
  right.forEach((record) => {
    const existingRecord = records.get(record.id);
    records.set(record.id, existingRecord ? { ...existingRecord, ...record } : record);
  });
  return [...records.values()];
}

function deterministicId(prefix: "pair" | "trio", personIds: readonly string[]): string {
  return `${prefix}:${sortedDistinctIds(personIds).map(encodeURIComponent).join(":")}`;
}

export function createResponsibilityDefinition(
  title: string,
  description = "",
  requirements: readonly ResponsibilityRequirement[] = [],
): ResponsibilityDefinition {
  const normalisedTitle = title.trim();
  if (!normalisedTitle) throw new Error("A responsibility title is required.");
  return {
    id: `responsibility:${encodeURIComponent(normalisedTitle.toLowerCase())}`,
    title: normalisedTitle,
    description,
    requirements: requirements.map((requirement) => ({ ...requirement })),
  };
}

export function appendResponsibilityFitAssessment(
  intelligence: FounderIntelligence,
  responsibility: ResponsibilityDefinition,
  assessment: ResponsibilityFitAssessment,
): FounderIntelligence {
  const existingRecord = intelligence.responsibilityFits.find(
    (record) => record.responsibilityId === responsibility.id,
  );
  const fitRecord: ResponsibilityFitRecord = {
    ...(existingRecord ?? {
      id: `responsibility-fit:${encodeURIComponent(responsibility.id)}`,
      title: responsibility.title,
      requirements: [],
      assessments: [],
    }),
    responsibilityId: responsibility.id,
    requirements: mergeById(
      existingRecord?.requirements ?? [],
      responsibility.requirements,
    ),
    assessments: mergeClaimedById(existingRecord?.assessments ?? [], [assessment]),
  };

  return {
    ...intelligence,
    responsibilityFits: existingRecord
      ? intelligence.responsibilityFits.map((record) =>
        record.id === existingRecord.id ? fitRecord : record)
      : [...intelligence.responsibilityFits, fitRecord],
  };
}

export function appendResponsibilityExecutionAssessment(
  intelligence: FounderIntelligence,
  responsibility: ResponsibilityDefinition,
  assessment: ResponsibilityFitAssessment,
  outcomeAssertion: OperationalOutcomeEvidence,
): FounderIntelligence {
  const assertion = {
    ...outcomeAssertion,
    responsibilityId: responsibility.id,
  };
  const existingOutcome = intelligence.operationalOutcomes.find(
    (outcome) => outcome.id === assertion.id,
  );
  const operationalOutcomes = existingOutcome
    ? intelligence.operationalOutcomes.map((outcome) => {
      if (outcome.id !== assertion.id) return outcome;
      const sameAssertion = outcome.personId === assertion.personId
        && outcome.recordType === assertion.recordType
        && outcome.recordId === assertion.recordId
        && outcome.outcomeId === assertion.outcomeId
        && outcome.contribution === assertion.contribution
        && outcome.outcome === assertion.outcome
        && outcome.observedResult === assertion.observedResult
        && outcome.responsibilityId === assertion.responsibilityId
        && outcome.requirementId === assertion.requirementId;
      return sameAssertion ? outcome : { ...outcome, evidenceStatus: "unresolved" as const };
    })
    : [...intelligence.operationalOutcomes, assertion];

  return {
    ...appendResponsibilityFitAssessment(intelligence, responsibility, assessment),
    operationalOutcomes,
  };
}

export function createPairIntelligenceRecords(personIds: readonly string[]): PairIntelligenceRecord[] {
  const uniqueIds = sortedDistinctIds(personIds);
  const records: PairIntelligenceRecord[] = [];
  for (let left = 0; left < uniqueIds.length; left += 1) {
    for (let right = left + 1; right < uniqueIds.length; right += 1) {
      const pair = [uniqueIds[left], uniqueIds[right]] as [string, string];
      records.push({
        id: deterministicId("pair", pair),
        personIds: pair,
        observations: [],
      });
    }
  }
  return records;
}

export function createTrioIntelligenceRecord(personIds: readonly string[]): TrioIntelligenceRecord | null {
  const uniqueIds = sortedDistinctIds(personIds);
  if (uniqueIds.length !== 3) return null;
  const trio = [uniqueIds[0], uniqueIds[1], uniqueIds[2]] as [string, string, string];
  return {
    id: deterministicId("trio", trio),
    personIds: trio,
    observations: [],
  };
}

function validSourceAnswer(
  reference: Extract<FounderIntelligenceEvidenceReference, { type: "source-answer" }>,
  context: FounderIntelligenceContext,
): OperatingProfileSourceAnswer | null {
  const person = context.people.find((candidate) => candidate.id === reference.personId);
  const submission = person?.operatingProfile?.sourceSubmissions?.find(
    (candidate) => candidate.id === reference.sourceSubmissionId,
  );
  if (!submission || !Number.isInteger(reference.answerIndex)) return null;
  return submission.answers[reference.answerIndex] ?? null;
}

function validIndividualClaim(
  reference: Extract<FounderIntelligenceEvidenceReference, { type: "individual-understanding" }>,
  context: FounderIntelligenceContext,
): EvidenceLinkedUnderstandingClaim | null {
  const person = context.people.find((candidate) => candidate.id === reference.personId);
  const understanding = person?.operatingProfile?.individualUnderstandings?.find(
    (candidate) => candidate.id === reference.understandingId,
  );
  if (!person || !understanding) return null;
  const claims = [understanding.understanding, ...understanding.interpretations];
  const claim = claims.find((candidate) => candidate.id === reference.claimId && candidate.status !== "unresolved");
  if (!claim || claim.sourceAnswerReferences.length === 0) return null;
  const referencesResolve = claim.sourceAnswerReferences.every((answerReference) => {
    const submission = person.operatingProfile?.sourceSubmissions?.find(
      (candidate) => candidate.id === answerReference.sourceSubmissionId,
    );
    return claim.sourceSubmissionIds.includes(answerReference.sourceSubmissionId)
      && answerReference.answerIndexes.length > 0
      && answerReference.answerIndexes.every((answerIndex) =>
        Number.isInteger(answerIndex) && submission?.answers[answerIndex] !== undefined);
  });
  return referencesResolve ? claim : null;
}

function validPairObservation(
  reference: Extract<FounderIntelligenceEvidenceReference, { type: "pair-observation" }>,
  context: FounderIntelligenceContext,
): PairIntelligenceObservation | null {
  const pair = context.pairRecords?.find((candidate) => candidate.id === reference.pairId);
  const observation = pair?.observations.find((candidate) => candidate.id === reference.observationId);
  return observation && observation.claim.status !== "unresolved" ? observation : null;
}

function isValidOperationalRecord(
  reference: Extract<FounderIntelligenceEvidenceReference, { type: "operational-outcome" }>,
  context: FounderIntelligenceContext,
): boolean {
  return getOperationalEvidence(reference, context) !== undefined;
}

function getOperationalEvidence(
  reference: Extract<FounderIntelligenceEvidenceReference, { type: "operational-outcome" }>,
  context: FounderIntelligenceContext,
) {
  return context.operationalEvidence?.find(
    (candidate) =>
      candidate.personId === reference.personId
      && candidate.recordType === reference.recordType
      && candidate.recordId === reference.recordId
      && candidate.outcomeId === reference.outcomeId,
  );
}

function isReferenceValid(
  reference: FounderIntelligenceEvidenceReference,
  context: FounderIntelligenceContext,
): boolean {
  switch (reference.type) {
    case "source-answer":
      return validSourceAnswer(reference, context) !== null;
    case "individual-understanding":
      return validIndividualClaim(reference, context) !== null;
    case "pair-observation":
      return validPairObservation(reference, context) !== null;
    case "operational-outcome":
      return isValidOperationalRecord(reference, context);
  }
}

function normaliseEvidenceReference(
  value: unknown,
): FounderIntelligenceEvidenceReference | null {
  if (!isPlainObject(value)) return null;
  if (value.type === "source-answer"
    && nonEmptyString(value.personId)
    && nonEmptyString(value.sourceSubmissionId)
    && typeof value.answerIndex === "number"
    && Number.isInteger(value.answerIndex)) {
    return {
      type: "source-answer",
      personId: value.personId,
      sourceSubmissionId: value.sourceSubmissionId,
      answerIndex: value.answerIndex,
    };
  }
  if (value.type === "individual-understanding"
    && nonEmptyString(value.personId)
    && nonEmptyString(value.understandingId)
    && nonEmptyString(value.claimId)) {
    return {
      type: "individual-understanding",
      personId: value.personId,
      understandingId: value.understandingId,
      claimId: value.claimId,
    };
  }
  if (value.type === "pair-observation"
    && nonEmptyString(value.pairId)
    && nonEmptyString(value.observationId)) {
    return {
      type: "pair-observation",
      pairId: value.pairId,
      observationId: value.observationId,
    };
  }
  if (value.type === "operational-outcome"
    && nonEmptyString(value.personId)
    && nonEmptyString(value.recordType)
    && nonEmptyString(value.recordId)
    && nonEmptyString(value.outcomeId)) {
    return {
      type: "operational-outcome",
      personId: value.personId,
      recordType: value.recordType,
      recordId: value.recordId,
      outcomeId: value.outcomeId,
    };
  }
  return null;
}

function normaliseAssessmentTarget(value: unknown): ResponsibilityAssessmentTarget | null {
  if (!isPlainObject(value)) return null;
  if (value.type === "responsibility" && nonEmptyString(value.responsibilityId)) {
    return { type: "responsibility", responsibilityId: value.responsibilityId };
  }
  if (value.type === "work-item"
    && isPlainObject(value.workItem)
    && ["Action", "Project", "Lead", "Problem"].includes(value.workItem.objectType as string)
    && nonEmptyString(value.workItem.objectId)
    && (value.responsibilityId === undefined || nonEmptyString(value.responsibilityId))) {
    return {
      type: "work-item",
      workItem: {
        objectType: value.workItem.objectType as ResponsibilityWorkItemReference["objectType"],
        objectId: value.workItem.objectId,
      },
      ...(typeof value.responsibilityId === "string" ? { responsibilityId: value.responsibilityId } : {}),
    };
  }
  return null;
}

function normaliseRequirement(value: unknown): ResponsibilityRequirement | null {
  if (!isPlainObject(value)
    || !nonEmptyString(value.id)
    || !nonEmptyString(value.capability)
    || typeof value.description !== "string") return null;
  return {
    id: value.id,
    capability: value.capability,
    description: value.description,
    ...(validRequirementTypes.includes(value.type as ResponsibilityRequirementType)
      ? { type: value.type as ResponsibilityRequirementType }
      : {}),
  };
}

function normaliseResponsibilityDefinition(value: unknown): ResponsibilityDefinition | null {
  if (!isPlainObject(value) || !nonEmptyString(value.id) || !nonEmptyString(value.title)) return null;
  const requirements = Array.isArray(value.requirements)
    ? value.requirements
      .map(normaliseRequirement)
      .filter((requirement): requirement is ResponsibilityRequirement => requirement !== null)
    : [];
  return {
    id: value.id,
    title: value.title,
    description: typeof value.description === "string" ? value.description : "",
    requirements: mergeById([], requirements),
  };
}

function normaliseOperationalOutcome(
  value: unknown,
  context: FounderIntelligenceContext,
): OperationalOutcomeEvidence | null {
  if (!isPlainObject(value)
    || !nonEmptyString(value.id)
    || !nonEmptyString(value.personId)
    || !nonEmptyString(value.recordType)
    || !nonEmptyString(value.recordId)
    || !nonEmptyString(value.outcomeId)
    || !validContributionTypes.includes(value.contribution as ResponsibilityContributionMode)
    || !["successful", "mixed", "unsuccessful", "unassessed"].includes(value.outcome as string)
    || !nonEmptyString(value.observedResult)) return null;
  const personExists = context.people.some((person) => person.id === value.personId);
  const sourceRecordExists = context.operationalRecords?.some((record) =>
    record.recordType === value.recordType && record.recordId === value.recordId) === true
    || context.workItems?.some((record) =>
      record.objectType === value.recordType && record.objectId === value.recordId) === true;
  const independentOutcome = context.operationalEvidence?.find((outcome) =>
    outcome.personId === value.personId
    && outcome.recordType === value.recordType
    && outcome.recordId === value.recordId
    && outcome.outcomeId === value.outcomeId
    && outcome.contribution === value.contribution
    && outcome.outcome === value.outcome
    && (outcome.observedResult === undefined || outcome.observedResult === value.observedResult)
    && (value.responsibilityId === undefined || outcome.responsibilityId === value.responsibilityId)
    && (value.requirementId === undefined || outcome.requirementId === value.requirementId));
  return {
    id: value.id,
    personId: value.personId,
    recordType: value.recordType,
    recordId: value.recordId,
    outcomeId: value.outcomeId,
    contribution: value.contribution as ResponsibilityContributionMode,
    outcome: value.outcome as OperationalOutcomeEvidence["outcome"],
    observedResult: value.observedResult,
    evidenceStatus: personExists && sourceRecordExists && independentOutcome ? "resolved" : "unresolved",
    ...(nonEmptyString(value.responsibilityId) ? { responsibilityId: value.responsibilityId } : {}),
    ...(nonEmptyString(value.requirementId) ? { requirementId: value.requirementId } : {}),
  };
}

function mergeOperationalOutcomeAssertions(
  existing: OperationalOutcomeEvidence,
  incoming: OperationalOutcomeEvidence,
): OperationalOutcomeEvidence {
  const sameAssertion = existing.personId === incoming.personId
    && existing.recordType === incoming.recordType
    && existing.recordId === incoming.recordId
    && existing.outcomeId === incoming.outcomeId
    && existing.contribution === incoming.contribution
    && existing.outcome === incoming.outcome
    && existing.observedResult === incoming.observedResult
    && existing.responsibilityId === incoming.responsibilityId
    && existing.requirementId === incoming.requirementId;
  return sameAssertion
    ? { ...existing, evidenceStatus: existing.evidenceStatus === "resolved"
      && incoming.evidenceStatus === "resolved" ? "resolved" : "unresolved" }
    : { ...existing, evidenceStatus: "unresolved" };
}

function normaliseDevelopmentOpportunity(
  value: unknown,
  context: FounderIntelligenceContext,
): DevelopmentOpportunity | null {
  if (!isPlainObject(value)
    || !nonEmptyString(value.id)
    || !nonEmptyString(value.personId)
    || typeof value.statement !== "string") return null;
  const claim = normaliseClaim(value.claim, context);
  if (!claim || claim.statement !== value.statement) return null;
  const requirementId = nonEmptyString(value.requirementId) ? value.requirementId : undefined;
  const personExists = context.people.some((person) => person.id === value.personId);
  const requirementExists = requirementId === undefined
    || context.responsibilities?.some((responsibility) =>
      responsibility.requirements.some((requirement) => requirement.id === requirementId)) === true;
  const evidenceIsPersonScoped = claim.evidence.every((reference) => {
    if (reference.type === "pair-observation") {
      const pair = context.pairRecords?.find((candidate) => candidate.id === reference.pairId);
      return validPairObservation(reference, context) !== null
        && pair?.personIds.includes(value.personId as string) === true;
    }
    return reference.personId === value.personId;
  });
  const status = personExists
    && requirementExists
    && evidenceIsPersonScoped
    && claim.status === "supported-interpretation"
    && claim.evidence.length > 0
    ? "supported"
    : "unresolved";
  return {
    id: value.id,
    personId: value.personId,
    ...(requirementId ? { requirementId } : {}),
    statement: value.statement,
    status,
    claim: {
      ...claim,
      status: status === "supported" ? claim.status : "unresolved",
      ...(status === "unresolved" && claim.status !== "unresolved"
        ? { candidateStatus: claim.status }
        : {}),
    },
    ...(validReviewStates.includes(value.reviewState as (typeof validReviewStates)[number])
      ? { reviewState: value.reviewState as DevelopmentOpportunity["reviewState"] }
      : {}),
  };
}

function normaliseClaim(value: unknown, context: FounderIntelligenceContext): FounderIntelligenceClaim | null {
  if (!isPlainObject(value) || !nonEmptyString(value.id) || typeof value.statement !== "string") return null;
  const rawEvidence = Array.isArray(value.evidence) ? value.evidence : [];
  const references = rawEvidence
    .map(normaliseEvidenceReference)
    .filter((reference): reference is FounderIntelligenceEvidenceReference => reference !== null);
  const evidenceUnresolved = references.length !== rawEvidence.length
    || references.some((reference) => !isReferenceValid(reference, context));
  const requestedStatusValue = value.candidateStatus ?? value.status;
  const requestedStatus = validClaimStatuses.includes(requestedStatusValue as FounderIntelligenceClaimStatus)
    ? requestedStatusValue as FounderIntelligenceClaimStatus
    : "unresolved";
  const status = requestedStatus === "unresolved" || references.length === 0 || evidenceUnresolved
    ? "unresolved"
    : requestedStatus;
  return {
    id: value.id,
    statement: value.statement,
    status,
    ...(status === "unresolved" && requestedStatus !== "unresolved"
      ? { candidateStatus: requestedStatus }
      : {}),
    evidence: references,
  };
}

function normalisePairObservation(
  value: unknown,
  personIds: readonly string[],
  context: FounderIntelligenceContext,
): PairIntelligenceObservation | null {
  const direction = isPlainObject(value) && isPlainObject(value.direction)
    && typeof value.direction.fromPersonId === "string"
    && typeof value.direction.toPersonId === "string"
    ? {
      fromPersonId: value.direction.fromPersonId,
      toPersonId: value.direction.toPersonId,
    }
    : null;
  if (!isPlainObject(value)
    || !nonEmptyString(value.id)
    || !nonEmptyString(value.dimension)
    || (value.direction !== undefined && (
      !direction
      || direction.fromPersonId === direction.toPersonId
      || !personIds.includes(direction.fromPersonId)
      || !personIds.includes(direction.toPersonId)
    ))) return null;
  const claim = normaliseClaim(value.claim, context);
  if (!claim) return null;
  const correctlyScoped = claim.evidence.every((reference) => {
    if (reference.type === "pair-observation") return false;
    return personIds.includes(reference.personId);
  });
  const requestedStatus = claim.candidateStatus ?? claim.status;
  const status = claim.status === "unresolved" || !correctlyScoped ? "unresolved" : claim.status;
  return {
    id: value.id,
    dimension: value.dimension,
    ...(direction ? { direction } : {}),
    claim: {
      ...claim,
      status,
      ...(status === "unresolved" && requestedStatus !== "unresolved"
        ? { candidateStatus: requestedStatus }
        : {}),
    },
  };
}

function normalisePairRecord(value: unknown, context: FounderIntelligenceContext): PairIntelligenceRecord | null {
  if (!isPlainObject(value) || !Array.isArray(value.personIds) || value.personIds.length !== 2) return null;
  const personIds = sortedDistinctIds(value.personIds.filter(nonEmptyString));
  if (personIds.length !== 2) return null;
  const id = nonEmptyString(value.id) ? value.id : deterministicId("pair", personIds);
  const observations = Array.isArray(value.observations)
    ? value.observations
      .map((observation) => normalisePairObservation(observation, personIds, context))
      .filter((observation): observation is PairIntelligenceObservation => observation !== null)
    : [];
  return { id, personIds: personIds as [string, string], observations };
}

function normaliseTrioObservation(
  value: unknown,
  personIds: readonly string[],
  context: FounderIntelligenceContext,
): TrioIntelligenceObservation | null {
  if (!isPlainObject(value) || !nonEmptyString(value.id) || !nonEmptyString(value.dimension)) return null;
  const claim = normaliseClaim(value.claim, context);
  if (!claim) return null;
  const correctlyScoped = claim.evidence.every((reference) => {
    if (reference.type === "source-answer" || reference.type === "individual-understanding"
      || reference.type === "operational-outcome") return personIds.includes(reference.personId);
    return validPairObservation(reference, context) !== null
      && context.pairRecords?.some((pair) => pair.id === reference.pairId
        && pair.personIds.every((id) => personIds.includes(id)));
  });
  const requestedStatus = claim.candidateStatus ?? claim.status;
  return {
    id: value.id,
    dimension: value.dimension,
    claim: {
      ...claim,
      status: claim.status === "unresolved" || !correctlyScoped ? "unresolved" : claim.status,
      ...(claim.status === "unresolved" || !correctlyScoped
        ? (requestedStatus !== "unresolved" ? { candidateStatus: requestedStatus } : {})
        : {}),
    },
  };
}

function normaliseTrioRecord(value: unknown, context: FounderIntelligenceContext): TrioIntelligenceRecord | null {
  if (!isPlainObject(value) || !Array.isArray(value.personIds) || value.personIds.length !== 3) return null;
  const personIds = sortedDistinctIds(value.personIds.filter(nonEmptyString));
  if (personIds.length !== 3) return null;
  const id = nonEmptyString(value.id) ? value.id : deterministicId("trio", personIds);
  const observations = Array.isArray(value.observations)
    ? value.observations
      .map((observation) => normaliseTrioObservation(observation, personIds, context))
      .filter((observation): observation is TrioIntelligenceObservation => observation !== null)
    : [];
  return { id, personIds: personIds as [string, string, string], observations };
}

function normaliseResponsibilityFit(value: unknown, context: FounderIntelligenceContext): ResponsibilityFitRecord | null {
  if (!isPlainObject(value) || !nonEmptyString(value.id) || !nonEmptyString(value.title)) return null;
  const requirements: ResponsibilityRequirement[] = Array.isArray(value.requirements)
    ? value.requirements.flatMap((entry) => isPlainObject(entry)
      && nonEmptyString(entry.id)
      && nonEmptyString(entry.capability)
      && typeof entry.description === "string"
      ? [normaliseRequirement(entry)!]
      : [])
    : [];
  const recordTarget = normaliseAssessmentTarget(value.target);
  const recordTargetWasMalformed = value.target !== undefined && recordTarget === null;
  const responsibilityId = nonEmptyString(value.responsibilityId)
    ? value.responsibilityId
    : recordTarget?.type === "responsibility" || recordTarget?.type === "work-item"
      ? recordTarget.responsibilityId
      : undefined;
  const responsibility = context.responsibilities?.find((entry) => entry.id === responsibilityId);
  const allowedRequirementIds = new Set([
    ...requirements.map((requirement) => requirement.id),
    ...(responsibility?.requirements.map((requirement) => requirement.id) ?? []),
  ]);
  const assessments: ResponsibilityFitAssessment[] = Array.isArray(value.assessments)
    ? value.assessments.flatMap((entry) => {
      if (!isPlainObject(entry)
        || !nonEmptyString(entry.id)
        || !nonEmptyString(entry.personId)
        || !nonEmptyString(entry.responsibility)
        || !validContributionTypes.includes(entry.contribution as ResponsibilityFitAssessment["contribution"])
        || !validResponsibilityFitKinds.includes((entry.candidateFit ?? entry.fit) as ResponsibilityFitKind)) return [];
      const claim = normaliseClaim(entry.claim, context);
      if (!claim) return [];
      const personId = entry.personId;
      const target = entry.target === undefined ? recordTarget : normaliseAssessmentTarget(entry.target);
      const targetWasMalformed = recordTargetWasMalformed
        || (entry.target !== undefined && target === null);
      const evidenceForPerson = claim.evidence.every((reference) => {
        if (reference.type === "pair-observation") {
          const pair = context.pairRecords?.find((candidate) => candidate.id === reference.pairId);
          return validPairObservation(reference, context) !== null
            && pair?.personIds.includes(personId) === true;
        }
        return reference.personId === personId;
      });
      const fit = (entry.candidateFit ?? entry.fit) as ResponsibilityFitKind;
      const hasSuccessfulOutcomeEvidence = claim.evidence.some((reference) => {
        if (reference.type !== "operational-outcome") return false;
        const outcome = getOperationalEvidence(reference, context);
        const requirementScopeMatches = !outcome?.requirementId
          || (Array.isArray(entry.requirementIds)
            && entry.requirementIds.includes(outcome.requirementId));
        const responsibilityScopeMatches = !outcome?.responsibilityId
          || outcome.responsibilityId === responsibilityId;
        const matchingAssertions = context.operationalOutcomeAssertions?.filter((candidate) =>
          candidate.personId === reference.personId
          && candidate.recordType === reference.recordType
          && candidate.recordId === reference.recordId
          && candidate.outcomeId === reference.outcomeId
          && candidate.contribution === entry.contribution
          && (candidate.responsibilityId === undefined || candidate.responsibilityId === responsibilityId)
          && (candidate.requirementId === undefined
            || (Array.isArray(entry.requirementIds) && entry.requirementIds.includes(candidate.requirementId))));
        const assertionsConflict = (matchingAssertions?.length ?? 0) > 1
          && matchingAssertions?.some((candidate) =>
            candidate.outcome !== matchingAssertions[0].outcome
            || candidate.observedResult !== matchingAssertions[0].observedResult
            || candidate.evidenceStatus !== matchingAssertions[0].evidenceStatus) === true;
        const assertion = assertionsConflict ? undefined : matchingAssertions?.[0];
        const hasConflictingAssertion = assertionsConflict
          || (context.operationalOutcomeAssertions ?? []).some((candidate) =>
            candidate.personId === reference.personId
            && candidate.recordType === reference.recordType
            && candidate.recordId === reference.recordId
            && candidate.outcomeId === reference.outcomeId
            && candidate.contribution === entry.contribution
            && (candidate.outcome !== "successful"
              || candidate.evidenceStatus !== "resolved"));
        const assertionSupportsOutcome = assertion
          ? assertion.evidenceStatus === "resolved"
            && assertion.outcome === "successful"
            && (outcome?.observedResult === undefined
              || assertion.observedResult === outcome.observedResult)
          : !hasConflictingAssertion && (!context.operationalOutcomeAssertionsProvided
            || (entry.fit === "unresolved" && entry.candidateFit === "demonstrated-capability"));
        return requirementScopeMatches
          && responsibilityScopeMatches
          && assertionSupportsOutcome
          && outcome?.outcome === "successful"
          && outcome.personId === personId
          && outcome.contribution === entry.contribution;
      });
      const hasSelfReportedEvidence = claim.evidence.some((reference) => reference.type === "source-answer");
      const hasIndividualUnderstanding = claim.evidence.some((reference) => reference.type === "individual-understanding");
      const fitSupported = fit !== "demonstrated-capability"
        || (hasSuccessfulOutcomeEvidence && claim.status === "evidence-grounded-understanding");
      const statedSupported = fit !== "stated-capability"
        || (hasSelfReportedEvidence && claim.status === "evidence-grounded-understanding");
      const groundedFitSupported = fit !== "evidence-grounded-fit"
        || ((hasSelfReportedEvidence || hasIndividualUnderstanding)
          && claim.status === "evidence-grounded-understanding");
      const inferredFitSupported = fit !== "inferred-fit" || claim.status === "supported-interpretation";
      const personExists = context.people.some((person) => person.id === personId);
      const requirementIds = Array.isArray(entry.requirementIds)
        ? [...new Set(entry.requirementIds.filter(nonEmptyString))]
        : [];
      const unresolvedRequirementIds = Array.isArray(entry.unresolvedRequirementIds)
        ? [...new Set(entry.unresolvedRequirementIds.filter(nonEmptyString))]
        : [];
      const invalidRequirements = requirementIds.filter((id) => !allowedRequirementIds.has(id));
      const referencedResponsibilityExists = responsibilityId === undefined
        || responsibility !== undefined;
      const referencedWorkItemExists = target?.type !== "work-item"
        || context.workItems?.some((workItem) =>
          workItem.objectType === target.workItem.objectType
          && workItem.objectId === target.workItem.objectId) === true;
      const targetIsValid = !targetWasMalformed
        && referencedResponsibilityExists
        && referencedWorkItemExists
        && (target === undefined || target === null || requirementIds.length > 0);
      const requestedAssessmentStatusValue = entry.candidateAssessmentStatus ?? entry.assessmentStatus;
      const requestedAssessmentStatus = validResponsibilityFitStatuses.includes(
        requestedAssessmentStatusValue as ResponsibilityFitStatus,
      )
        ? requestedAssessmentStatusValue as ResponsibilityFitStatus
        : undefined;
      const evidenceGroundedFitCannotEstablishInterpretiveStatus = fit === "evidence-grounded-fit"
        && ["strong-potential-fit", "potential-fit", "conditional-fit", "poor-evidence-fit"]
          .includes(requestedAssessmentStatus ?? "");
      const assessmentSupported = requestedAssessmentStatus === undefined
        || requestedAssessmentStatus === "insufficient-evidence"
        || requestedAssessmentStatus === "unresolved"
        || (!evidenceGroundedFitCannotEstablishInterpretiveStatus
          && claim.status !== "unresolved"
          && claim.evidence.length > 0);
      const statusCanBeEstablished = personExists
        && fitSupported
        && statedSupported
        && groundedFitSupported
        && inferredFitSupported
        && evidenceForPerson
        && targetIsValid
        && invalidRequirements.length === 0
        && unresolvedRequirementIds.length === 0
        && assessmentSupported;
      const assessmentStatus = requestedAssessmentStatus === "insufficient-evidence"
        ? "insufficient-evidence"
        : requestedAssessmentStatus === "unresolved"
          ? "unresolved"
          : statusCanBeEstablished
            ? requestedAssessmentStatus
            : "unresolved";
      const normalizedFit = fit === "unresolved" || !statusCanBeEstablished ? "unresolved" : fit;
      const candidateAssessmentStatus = assessmentStatus === "unresolved"
        ? requestedAssessmentStatus && requestedAssessmentStatus !== "unresolved"
          ? requestedAssessmentStatus
          : undefined
        : undefined;
      const allUnresolvedRequirementIds = [...new Set([...unresolvedRequirementIds, ...invalidRequirements])];
      return [{
        id: entry.id,
        personId,
        responsibility: entry.responsibility,
        contribution: entry.contribution as ResponsibilityFitAssessment["contribution"],
        fit: normalizedFit,
        ...(normalizedFit === "unresolved" && fit !== "unresolved" ? { candidateFit: fit } : {}),
        ...(target ? { target } : {}),
        ...(Array.isArray(entry.requirementIds) ? { requirementIds } : {}),
        ...(requestedAssessmentStatus !== undefined || entry.assessmentStatus !== undefined
          ? { assessmentStatus }
          : {}),
        ...(candidateAssessmentStatus ? { candidateAssessmentStatus } : {}),
        ...(Array.isArray(entry.unresolvedRequirementIds) || allUnresolvedRequirementIds.length > 0
          ? { unresolvedRequirementIds: allUnresolvedRequirementIds }
          : {}),
        ...(Array.isArray(entry.limitations)
          ? { limitations: entry.limitations.filter((limitation): limitation is string => typeof limitation === "string") }
          : {}),
        ...(validReviewStates.includes(entry.reviewState as (typeof validReviewStates)[number])
          ? { reviewState: entry.reviewState as ResponsibilityFitAssessment["reviewState"] }
          : {}),
        ...(typeof entry.reviewedAt === "string" ? { reviewedAt: entry.reviewedAt } : {}),
        claim: {
          ...claim,
          status: normalizedFit === "unresolved" || assessmentStatus === "insufficient-evidence"
            ? "unresolved"
            : claim.status,
          ...(normalizedFit === "unresolved" && claim.status !== "unresolved"
            ? { candidateStatus: claim.status }
            : {}),
        },
      }];
    })
    : [];
  const arrangements: ResponsibilityFitArrangement[] = Array.isArray(value.arrangements)
    ? value.arrangements.flatMap((entry) => {
      if (!isPlainObject(entry) || !nonEmptyString(entry.id)) return [];
      const assessmentIds = Array.isArray(entry.assessmentIds)
        ? [...new Set(entry.assessmentIds.filter(nonEmptyString))]
        : [];
      const arrangementClaim = normaliseClaim(entry.claim, context);
      if (!arrangementClaim) return [];
      const members = assessmentIds.flatMap((assessmentId) =>
        assessments.find((assessment) => assessment.id === assessmentId) ?? []);
      const distinctPeople = new Set(members.map((member) => member.personId));
      const arrangementPersonIds = new Set(distinctPeople);
      const membersHaveSupportedAssessments = members.every((member) =>
        member.fit !== "unresolved"
        && member.claim.status !== "unresolved"
        && member.assessmentStatus !== "insufficient-evidence");
      const evidenceIsMemberScoped = arrangementClaim.evidence.every((reference) => {
        if (reference.type === "pair-observation") {
          const pair = context.pairRecords?.find((candidate) => candidate.id === reference.pairId);
          return validPairObservation(reference, context) !== null
            && pair?.personIds.every((personId) => arrangementPersonIds.has(personId)) === true;
        }
        return arrangementPersonIds.has(reference.personId);
      });
      const candidateStatusValue = entry.candidateStatus ?? entry.status;
      const candidateStatus = validResponsibilityFitStatuses.includes(candidateStatusValue as ResponsibilityFitStatus)
        ? candidateStatusValue as ResponsibilityFitStatus
        : "unresolved";
      const validArrangement = members.length === assessmentIds.length
        && assessmentIds.length >= 2
        && distinctPeople.size >= 2
        && membersHaveSupportedAssessments
        && evidenceIsMemberScoped
        && arrangementClaim.status === "supported-interpretation"
        && arrangementClaim.evidence.length > 0;
      const status = validArrangement ? candidateStatus : "unresolved";
      return [{
        id: entry.id,
        assessmentIds,
        status,
        ...(status === "unresolved" && candidateStatus !== "unresolved"
          ? { candidateStatus }
          : {}),
        claim: {
          ...arrangementClaim,
          status: validArrangement ? arrangementClaim.status : "unresolved",
          ...(!validArrangement && arrangementClaim.status !== "unresolved"
            ? { candidateStatus: arrangementClaim.status }
            : {}),
        },
      }];
    })
    : [];
  return {
    id: value.id,
    title: value.title,
    ...(responsibilityId ? { responsibilityId } : {}),
    ...(recordTarget ? { target: recordTarget } : {}),
    requirements,
    assessments,
    ...(Array.isArray(value.arrangements) ? { arrangements } : {}),
  };
}

export function normaliseFounderIntelligence(
  value: unknown,
  context: FounderIntelligenceContext,
): FounderIntelligence {
  if (!isPlainObject(value)) {
    return {
      pairRecords: [],
      trioRecords: [],
      responsibilities: [],
      responsibilityFits: [],
      developmentOpportunities: [],
      operationalOutcomes: [],
    };
  }
  const operationalOutcomes = new Map<string, OperationalOutcomeEvidence>();
  if (Array.isArray(value.operationalOutcomes)) {
    value.operationalOutcomes.forEach((entry) => {
      const outcome = normaliseOperationalOutcome(entry, context);
      if (outcome) {
        const existing = operationalOutcomes.get(outcome.id);
        operationalOutcomes.set(
          outcome.id,
          existing ? mergeOperationalOutcomeAssertions(existing, outcome) : outcome,
        );
      }
    });
  }
  const contextWithOperationalOutcomes: FounderIntelligenceContext = {
    ...context,
    operationalOutcomeAssertions: [...operationalOutcomes.values()],
    operationalOutcomeAssertionsProvided: Object.prototype.hasOwnProperty.call(value, "operationalOutcomes"),
  };
  const pairRecords = new Map<string, PairIntelligenceRecord>();
  if (Array.isArray(value.pairRecords)) {
    value.pairRecords.forEach((entry) => {
      const pair = normalisePairRecord(entry, contextWithOperationalOutcomes);
      if (pair) {
        const existing = pairRecords.get(pair.id);
        pairRecords.set(pair.id, {
          ...pair,
          observations: mergeClaimedById(existing?.observations ?? [], pair.observations),
        });
      }
    });
  }
  const resolvedPairs = [...pairRecords.values()];
  const pairsById = new Map((contextWithOperationalOutcomes.pairRecords ?? []).map((pair) => [pair.id, pair]));
  resolvedPairs.forEach((pair) => {
    const existing = pairsById.get(pair.id);
    pairsById.set(pair.id, {
      ...pair,
      observations: mergeClaimedById(existing?.observations ?? [], pair.observations),
    });
  });
  const contextWithPairs = { ...contextWithOperationalOutcomes, pairRecords: [...pairsById.values()] };
  const responsibilities = new Map<string, ResponsibilityDefinition>();
  if (Array.isArray(value.responsibilities)) {
    value.responsibilities.forEach((entry) => {
      const responsibility = normaliseResponsibilityDefinition(entry);
      if (responsibility) {
        const existing = responsibilities.get(responsibility.id);
        responsibilities.set(responsibility.id, {
          ...existing,
          ...responsibility,
          requirements: mergeById(existing?.requirements ?? [], responsibility.requirements),
        });
      }
    });
  }
  const contextWithResponsibilities = {
    ...contextWithPairs,
    responsibilities: [
      ...(context.responsibilities ?? []).filter((responsibility) =>
        !responsibilities.has(responsibility.id)),
      ...responsibilities.values(),
    ],
  };
  const contextForClaims = {
    ...contextWithResponsibilities,
    pairRecords: contextWithPairs.pairRecords,
  };
  const trioRecords = new Map<string, TrioIntelligenceRecord>();
  if (Array.isArray(value.trioRecords)) {
    value.trioRecords.forEach((entry) => {
      const trio = normaliseTrioRecord(entry, contextForClaims);
      if (trio) {
        const existing = trioRecords.get(trio.id);
        trioRecords.set(trio.id, {
          ...trio,
          observations: mergeClaimedById(existing?.observations ?? [], trio.observations),
        });
      }
    });
  }
  const responsibilityFits = new Map<string, ResponsibilityFitRecord>();
  if (Array.isArray(value.responsibilityFits)) {
    value.responsibilityFits.forEach((entry) => {
      const fit = normaliseResponsibilityFit(entry, contextForClaims);
      if (fit) {
        const existing = responsibilityFits.get(fit.id);
        responsibilityFits.set(fit.id, {
          ...fit,
          requirements: mergeById(existing?.requirements ?? [], fit.requirements),
          assessments: mergeClaimedById(existing?.assessments ?? [], fit.assessments),
          arrangements: mergeClaimedById(existing?.arrangements ?? [], fit.arrangements ?? []),
        });
      }
    });
  }
  const developmentOpportunities = new Map<string, DevelopmentOpportunity>();
  if (Array.isArray(value.developmentOpportunities)) {
    value.developmentOpportunities.forEach((entry) => {
      const opportunity = normaliseDevelopmentOpportunity(entry, {
        ...contextForClaims,
        pairRecords: [...(contextForClaims.pairRecords ?? []), ...pairRecords.values()],
      });
      if (opportunity) {
        const existing = developmentOpportunities.get(opportunity.id);
        const claim = existing ? mergeClaims(existing.claim, opportunity.claim) : null;
        developmentOpportunities.set(
          opportunity.id,
          existing && claim ? {
            ...existing,
            ...opportunity,
            status: claim.status === "unresolved" ? "unresolved" : opportunity.status,
            claim,
          } : opportunity,
        );
      }
    });
  }
  return {
    pairRecords: [...pairRecords.values()],
    trioRecords: [...trioRecords.values()],
    responsibilities: [...responsibilities.values()],
    responsibilityFits: [...responsibilityFits.values()],
    developmentOpportunities: [...developmentOpportunities.values()],
    operationalOutcomes: [...operationalOutcomes.values()],
  };
}

export function mergeFounderIntelligence(
  existing: unknown,
  incoming: unknown,
  context: FounderIntelligenceContext,
): FounderIntelligence {
  const current = normaliseFounderIntelligence(existing, context);
  const additions = normaliseFounderIntelligence(incoming, {
    ...context,
    pairRecords: [...current.pairRecords, ...(context.pairRecords ?? [])],
    responsibilities: [...current.responsibilities, ...(context.responsibilities ?? [])],
  });
  const mergePairs = (left: readonly PairIntelligenceRecord[], right: readonly PairIntelligenceRecord[]) =>
    mergeById(left, right).map((record) => {
      const existingRecord = left.find((candidate) => candidate.id === record.id);
      const incomingRecord = right.find((candidate) => candidate.id === record.id);
      return {
        ...record,
        observations: mergeClaimedById(existingRecord?.observations ?? [], incomingRecord?.observations ?? []),
      };
    });
  const mergeTrios = (left: readonly TrioIntelligenceRecord[], right: readonly TrioIntelligenceRecord[]) =>
    mergeById(left, right).map((record) => {
      const existingRecord = left.find((candidate) => candidate.id === record.id);
      const incomingRecord = right.find((candidate) => candidate.id === record.id);
      return {
        ...record,
        observations: mergeClaimedById(existingRecord?.observations ?? [], incomingRecord?.observations ?? []),
      };
    });
  const mergeResponsibilities = (
    left: readonly ResponsibilityFitRecord[],
    right: readonly ResponsibilityFitRecord[],
  ) => mergeById(left, right).map((record) => {
    const existingRecord = left.find((candidate) => candidate.id === record.id);
    const incomingRecord = right.find((candidate) => candidate.id === record.id);
    return {
      ...record,
      requirements: mergeById(existingRecord?.requirements ?? [], incomingRecord?.requirements ?? []),
      assessments: mergeClaimedById(existingRecord?.assessments ?? [], incomingRecord?.assessments ?? []),
      arrangements: mergeClaimedById(existingRecord?.arrangements ?? [], incomingRecord?.arrangements ?? []),
    };
  });
  const mergeResponsibilityDefinitions = (
    left: readonly ResponsibilityDefinition[],
    right: readonly ResponsibilityDefinition[],
  ) => mergeById(left, right).map((record) => {
    const existingRecord = left.find((candidate) => candidate.id === record.id);
    const incomingRecord = right.find((candidate) => candidate.id === record.id);
    return {
      ...record,
      requirements: mergeById(
        existingRecord?.requirements ?? [],
        incomingRecord?.requirements ?? [],
      ),
    };
  });
  return {
    pairRecords: mergePairs(current.pairRecords, additions.pairRecords),
    trioRecords: mergeTrios(current.trioRecords, additions.trioRecords),
    responsibilities: mergeResponsibilityDefinitions(current.responsibilities, additions.responsibilities),
    responsibilityFits: mergeResponsibilities(current.responsibilityFits, additions.responsibilityFits),
    developmentOpportunities: mergeClaimedById(
      current.developmentOpportunities,
      additions.developmentOpportunities,
    ),
    operationalOutcomes: mergeById(current.operationalOutcomes, additions.operationalOutcomes),
  };
}
