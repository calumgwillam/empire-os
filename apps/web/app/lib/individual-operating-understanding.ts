import {
  calumLeadershipReflectionSubmission,
  emekaLeadershipAlignmentSubmission,
  lewisLeadershipAlignmentSubmission,
  normaliseOperatingProfileSourceSubmissions,
  type OperatingProfileSourceSubmission,
} from "./operating-profile-evidence";

export const individualOperatingDimensions = [
  { key: "ultimate-motivation", label: "Ultimate motivation" },
  { key: "desired-future", label: "Desired future" },
  { key: "time-and-commitment", label: "Time and commitment" },
  { key: "sacrifice", label: "Sacrifice" },
  { key: "standards", label: "Standards" },
  { key: "disagreement-and-conflict", label: "Disagreement and conflict" },
  { key: "strengths-and-value", label: "Strengths and value" },
  { key: "weaknesses-and-development", label: "Weaknesses and development" },
  { key: "pressure-and-setbacks", label: "Pressure and setbacks" },
  { key: "financial-expectations", label: "Financial expectations" },
  { key: "unacceptable-behaviour", label: "Unacceptable behaviour and breaking points" },
  { key: "long-term-commitment", label: "Long-term commitment conditions" },
] as const;

export type IndividualOperatingDimension = (typeof individualOperatingDimensions)[number]["key"];
export type UnderstandingClaimStatus =
  | "evidence-grounded-understanding"
  | "supported-interpretation"
  | "unresolved";

export type OperatingUnderstandingAnswerReference = {
  sourceSubmissionId: string;
  answerIndexes: number[];
};

export type EvidenceLinkedUnderstandingClaim = {
  id: string;
  status: UnderstandingClaimStatus;
  statement: string;
  sourceSubmissionIds: string[];
  sourceAnswerReferences: OperatingUnderstandingAnswerReference[];
};

export type IndividualOperatingUnderstanding = {
  id: string;
  dimension: IndividualOperatingDimension;
  understanding: EvidenceLinkedUnderstandingClaim;
  interpretations: EvidenceLinkedUnderstandingClaim[];
};

export type IndividualOperatingUnderstandingSeed = {
  respondentName: string;
  understandings: IndividualOperatingUnderstanding[];
};

type DirectUnderstandingSeed = {
  dimension: IndividualOperatingDimension;
  statement: string;
  answerIndexes: number[];
};

function createIndividualSeed(
  submission: OperatingProfileSourceSubmission,
  entries: readonly DirectUnderstandingSeed[],
): IndividualOperatingUnderstandingSeed {
  return {
    respondentName: submission.respondentName,
    understandings: entries.map(({ dimension, statement, answerIndexes }) => ({
      id: `${submission.id}:individual-understanding:${dimension}`,
      dimension,
      understanding: {
        id: `${submission.id}:individual-understanding:${dimension}:grounded`,
        status: "evidence-grounded-understanding",
        statement,
        sourceSubmissionIds: [submission.id],
        sourceAnswerReferences: [{
          sourceSubmissionId: submission.id,
          answerIndexes: [...answerIndexes],
        }],
      },
      interpretations: [],
    })),
  };
}

export const individualOperatingUnderstandingSeeds: IndividualOperatingUnderstandingSeed[] = [
  createIndividualSeed(calumLeadershipReflectionSubmission, [
    { dimension: "ultimate-motivation", statement: "Calum says he wants a purposeful life and a monumental, systems-based organisation, using time, money, people and systems together to create greater freedom.", answerIndexes: [0] },
    { dimension: "desired-future", statement: "Calum says that in five years he wants to have moved away from practical delivery toward orchestrating infrastructure, with business scale guided by evidence and capability.", answerIndexes: [0, 1] },
    { dimension: "time-and-commitment", statement: "Calum says he will give essentially every waking hour outside fight training and weekly family time to building the business and wider Empire.", answerIndexes: [2] },
    { dimension: "sacrifice", statement: "Calum says he is willing to give up comfort, leisure, social time and immediate reward, but not long-term quality, standards, good people, sound systems or long-term value.", answerIndexes: [3] },
    { dimension: "standards", statement: "Calum describes a high standard as combining an optimal approach, intelligent decisions, hard work, discipline, consistency, attention to detail and doing beneficial work even when it is tedious.", answerIndexes: [4] },
    { dimension: "disagreement-and-conflict", statement: "Calum says respect should guide disagreement, with listening, honesty and challenge alongside clear authority within agreed boundaries.", answerIndexes: [5] },
    { dimension: "strengths-and-value", statement: "Calum says that when something matters to him, he will keep learning, adapting, working and expanding his capabilities to create value; he does not name a specific established strength.", answerIndexes: [6] },
    { dimension: "weaknesses-and-development", statement: "Calum identifies finance, listening fully, patience with different approaches, recognising deserved progress and handling difficult clients professionally as development areas.", answerIndexes: [7] },
    { dimension: "pressure-and-setbacks", statement: "Calum says he has thought clearly in dangerous or high-pressure situations, but has not yet established how he will respond across business-pressure situations; he also identifies frustration with unclear, slow or indirect communication as something to manage.", answerIndexes: [8] },
    { dimension: "financial-expectations", statement: "Calum says financial reward should reflect contribution, responsibility, time, commitment, risk, role and sustainable business capacity; as a co-owner, he expects reward to grow with the value created.", answerIndexes: [9] },
    { dimension: "unacceptable-behaviour", statement: "Calum identifies unreliability, poor communication, cutting corners, avoiding responsibility, dishonesty, obstructive ego, unmanaged workload resentment, disconnected financial expectations, low commitment, unconstructive negativity, poor treatment of others and lack of loyalty as behaviours that can undermine or end the working relationship.", answerIndexes: [10] },
    { dimension: "long-term-commitment", statement: "Calum says his commitment to the business is already solidified; deeper commitment to the team depends on accumulated evidence over time that standards hold and loyalty persists through difficulty.", answerIndexes: [11] },
  ]),
  createIndividualSeed(lewisLeadershipAlignmentSubmission, [
    { dimension: "ultimate-motivation", statement: "Lewis says he ultimately wants security for himself and his family across generations.", answerIndexes: [0] },
    { dimension: "desired-future", statement: "Lewis says he wants clarity about how his life will develop and sees self-employment as enabling that more than remaining in the corporate system.", answerIndexes: [1] },
    { dimension: "time-and-commitment", statement: "Lewis says he expects a gradual start followed by an accelerated move into full-time work, giving the business the work required.", answerIndexes: [2] },
    { dimension: "sacrifice", statement: "Lewis describes sacrifice as accepting a present loss in order to achieve a greater future gain.", answerIndexes: [3] },
    { dimension: "standards", statement: "Lewis describes a high standard as working until there is almost no room for improvement.", answerIndexes: [4] },
    { dimension: "disagreement-and-conflict", statement: "Lewis says disagreement and conflict should be handled in a civilised, respectful and productive manner.", answerIndexes: [5] },
    { dimension: "strengths-and-value", statement: "Lewis identifies customer service and attention to detail as strengths, and says he gives full focus and determination to work that holds his attention, challenges him and pays well.", answerIndexes: [6] },
    { dimension: "weaknesses-and-development", statement: "Lewis identifies confidence in his abilities, especially around new skills, as a development area.", answerIndexes: [7] },
    { dimension: "pressure-and-setbacks", statement: "Lewis says he first establishes the worst possible outcome, removes that threat and works backward toward the best plausible solution.", answerIndexes: [8] },
    { dimension: "financial-expectations", statement: "Lewis says he expects to receive whatever he is in receipt of if the business grows.", answerIndexes: [9] },
    { dimension: "unacceptable-behaviour", statement: "Lewis identifies irrational behaviour, ignoring previously made mistakes and reluctance to listen, learn or grow as behaviours that would make him no longer want to build a business with someone.", answerIndexes: [10] },
    { dimension: "long-term-commitment", statement: "Lewis says motion, growth and scalability would need to be present for him to make a deeper long-term commitment to the business and team.", answerIndexes: [11] },
  ]),
  createIndividualSeed(emekaLeadershipAlignmentSubmission, [
    { dimension: "ultimate-motivation", statement: "Emeka says he wants financial freedom without sacrificing time or quality of life, alongside achievement, independence, meaningful work and long-term purpose.", answerIndexes: [0] },
    { dimension: "desired-future", statement: "Emeka says he wants to contribute meaningfully to an established, growing and well-run business, with responsibility, financial independence and flexibility.", answerIndexes: [1] },
    { dimension: "time-and-commitment", statement: "Emeka says he is prepared to contribute serious time and energy, while balancing existing responsibilities and keeping commitment sustainable; he values consistent reliability.", answerIndexes: [2] },
    { dimension: "sacrifice", statement: "Emeka says he is willing to give up some short-term comfort, free time and immediate reward, while not sacrificing integrity, important relationships, long-term health or sustainable balance.", answerIndexes: [3] },
    { dimension: "standards", statement: "Emeka describes high standards as doing work properly, being reliable and accountable, acknowledging and learning from mistakes, treating others professionally and improving operations.", answerIndexes: [4] },
    { dimension: "disagreement-and-conflict", statement: "Emeka says disagreements should be direct, respectful and fact-based, with listening, consideration of evidence and impact, clear decision responsibility, and support for decisions except for serious concerns.", answerIndexes: [5] },
    { dimension: "strengths-and-value", statement: "Emeka identifies dependability, taking responsibility, organisation, communication, problem-solving and turning practical opportunities into action as ways he can add value.", answerIndexes: [6] },
    { dimension: "weaknesses-and-development", statement: "Emeka identifies decisiveness under uncertainty, commercial knowledge, leadership and financial understanding as development areas, and says he can spend too long considering possibilities.", answerIndexes: [7] },
    { dimension: "pressure-and-setbacks", statement: "Emeka says he generally tries to stay calm, focus on what is controllable, understand the problem and identify practical priorities; he notes he may become more focused and direct under pressure.", answerIndexes: [8] },
    { dimension: "financial-expectations", statement: "Emeka says financial reward should reflect contribution, responsibility, risk and commitment, with a fair, transparent structure that may include salary, profit or ownership over time.", answerIndexes: [9] },
    { dimension: "unacceptable-behaviour", statement: "Emeka identifies serious dishonesty or broken trust, repeated failure to deliver, avoiding responsibility, poor communication, below-standard work, disrespect, manipulation, ego and self-interested decisions as unacceptable.", answerIndexes: [10] },
    { dimension: "long-term-commitment", statement: "Emeka says deeper commitment depends on a genuine opportunity, alignment among the three people, clear roles and decisions, trust, transparency, shared contribution, progress and a fair structure.", answerIndexes: [11] },
  ]),
];

export const founderIndividualOperatingUnderstandings = individualOperatingUnderstandingSeeds;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDimension(value: unknown): value is IndividualOperatingDimension {
  return typeof value === "string"
    && individualOperatingDimensions.some(({ key }) => key === value);
}

function sourceReferenceKey(reference: OperatingUnderstandingAnswerReference): string {
  return `${reference.sourceSubmissionId}:${reference.answerIndexes.join(",")}`;
}

function normaliseClaim(
  value: unknown,
  sourceSubmissions: readonly OperatingProfileSourceSubmission[],
  allowedStatuses: readonly UnderstandingClaimStatus[],
): EvidenceLinkedUnderstandingClaim | null {
  if (!isPlainObject(value) || typeof value.id !== "string" || !value.id.trim()) return null;

  const unresolved: EvidenceLinkedUnderstandingClaim = {
    id: value.id,
    status: "unresolved",
    statement: "",
    sourceSubmissionIds: [],
    sourceAnswerReferences: [],
  };
  if (
    typeof value.status !== "string"
    || (value.status !== "unresolved"
      && !allowedStatuses.includes(value.status as UnderstandingClaimStatus))
    || typeof value.statement !== "string"
    || (value.status !== "unresolved" && !value.statement.trim())
    || !Array.isArray(value.sourceSubmissionIds)
    || !Array.isArray(value.sourceAnswerReferences)
  ) return unresolved;

  const references: OperatingUnderstandingAnswerReference[] = [];
  let hasInvalidReference = false;
  value.sourceAnswerReferences.forEach((entry: unknown) => {
    if (!isPlainObject(entry) || typeof entry.sourceSubmissionId !== "string" || !Array.isArray(entry.answerIndexes)) {
      hasInvalidReference = true;
      return;
    }
    const submission = sourceSubmissions.find(({ id }) => id === entry.sourceSubmissionId);
    const indexes = entry.answerIndexes.filter(
      (index: unknown): index is number => Number.isInteger(index)
        && typeof index === "number"
        && index >= 0
        && Boolean(submission?.answers[index]),
    );
    if (!submission || indexes.length !== entry.answerIndexes.length || indexes.length === 0) {
      hasInvalidReference = true;
      return;
    }
    const reference = { sourceSubmissionId: entry.sourceSubmissionId, answerIndexes: indexes };
    if (!references.some((existing) => sourceReferenceKey(existing) === sourceReferenceKey(reference))) {
      references.push(reference);
    }
  });

  const referenceIds = [...new Set(references.map(({ sourceSubmissionId }) => sourceSubmissionId))];
  const declaredIds = value.sourceSubmissionIds.filter(
    (id: unknown): id is string => typeof id === "string",
  );
  if (
    hasInvalidReference
    || references.length === 0
    || declaredIds.length !== value.sourceSubmissionIds.length
    || declaredIds.length !== referenceIds.length
    || referenceIds.some((id) => !declaredIds.includes(id))
  ) return unresolved;

  if (value.status === "unresolved") {
    return {
      ...unresolved,
      sourceSubmissionIds: referenceIds,
      sourceAnswerReferences: references,
    };
  }

  return {
    id: value.id,
    status: value.status as UnderstandingClaimStatus,
    statement: value.statement,
    sourceSubmissionIds: referenceIds,
    sourceAnswerReferences: references,
  };
}

function normaliseUnderstanding(
  value: unknown,
  sourceSubmissions: readonly OperatingProfileSourceSubmission[],
): IndividualOperatingUnderstanding | null {
  if (!isPlainObject(value) || typeof value.id !== "string" || !value.id.trim() || !isDimension(value.dimension)) {
    return null;
  }
  const understanding = normaliseClaim(
    value.understanding,
    sourceSubmissions,
    ["evidence-grounded-understanding"],
  );
  if (!understanding) return null;

  const interpretations: EvidenceLinkedUnderstandingClaim[] = [];
  if (Array.isArray(value.interpretations)) {
    value.interpretations.forEach((entry: unknown) => {
      const interpretation = normaliseClaim(entry, sourceSubmissions, ["supported-interpretation"]);
      if (interpretation) interpretations.push(interpretation);
    });
  }

  return { id: value.id, dimension: value.dimension, understanding, interpretations };
}

export function normaliseIndividualOperatingUnderstandings(
  value: unknown,
  sourceSubmissions: readonly OperatingProfileSourceSubmission[],
): IndividualOperatingUnderstanding[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("Individual operating understandings must be stored as an array.");
  }
  assertIndividualOperatingUnderstandingsDataStructure(value);
  const byId = new Map<string, IndividualOperatingUnderstanding>();
  value.forEach((entry: unknown) => {
    const understanding = normaliseUnderstanding(entry, sourceSubmissions);
    if (!understanding) {
      throw new Error("An individual operating understanding has a malformed record structure.");
    }
    const existing = byId.get(understanding.id);
    byId.set(
      understanding.id,
      existing ? mergeUnderstandingRecords(existing, understanding) : understanding,
    );
  });
  return [...byId.values()];
}

export function assertIndividualOperatingUnderstandingsDataStructure(value: unknown): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    throw new Error("Individual operating understandings must be stored as an array.");
  }

  const isClaimStructure = (claim: unknown): boolean => isPlainObject(claim)
    && typeof claim.id === "string"
    && Boolean(claim.id.trim())
    && typeof claim.status === "string"
    && typeof claim.statement === "string"
    && Array.isArray(claim.sourceSubmissionIds)
    && claim.sourceSubmissionIds.every((id) => typeof id === "string")
    && Array.isArray(claim.sourceAnswerReferences)
    && claim.sourceAnswerReferences.every((reference) => isPlainObject(reference)
      && typeof reference.sourceSubmissionId === "string"
      && Boolean(reference.sourceSubmissionId.trim())
      && Array.isArray(reference.answerIndexes)
      && reference.answerIndexes.every((index) => Number.isInteger(index)));

  const malformed = value.some((entry) => !isPlainObject(entry)
    || typeof entry.id !== "string"
    || !entry.id.trim()
    || !isDimension(entry.dimension)
    || !isClaimStructure(entry.understanding)
    || (entry.interpretations !== undefined
      && (!Array.isArray(entry.interpretations)
        || !entry.interpretations.every(isClaimStructure))));
  if (malformed) {
    throw new Error("An individual operating understanding has a malformed nested record.");
  }
}

function mergeClaim(
  existing: EvidenceLinkedUnderstandingClaim,
  incoming: EvidenceLinkedUnderstandingClaim,
): EvidenceLinkedUnderstandingClaim {
  const answerIndexesBySubmission = new Map<string, Set<number>>();
  [...existing.sourceAnswerReferences, ...incoming.sourceAnswerReferences].forEach((reference) => {
    const answerIndexes = answerIndexesBySubmission.get(reference.sourceSubmissionId) ?? new Set<number>();
    reference.answerIndexes.forEach((answerIndex) => answerIndexes.add(answerIndex));
    answerIndexesBySubmission.set(reference.sourceSubmissionId, answerIndexes);
  });
  const orderedReferences = [...answerIndexesBySubmission]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceSubmissionId, answerIndexes]) => ({
      sourceSubmissionId,
      answerIndexes: [...answerIndexes].sort((left, right) => left - right),
    }));
  const sourceSubmissionIds = [...new Set(orderedReferences.map(({ sourceSubmissionId }) => sourceSubmissionId))];
  const conflicts = existing.id !== incoming.id
    || existing.status === "unresolved"
    || incoming.status === "unresolved"
    || existing.statement !== incoming.statement;

  return conflicts
    ? {
      id: existing.id,
      status: "unresolved",
      statement: "",
      sourceSubmissionIds,
      sourceAnswerReferences: orderedReferences,
    }
    : {
      ...existing,
      sourceSubmissionIds,
      sourceAnswerReferences: orderedReferences,
    };
}

function mergeUnderstandingRecords(
  existingUnderstanding: IndividualOperatingUnderstanding,
  incomingUnderstanding: IndividualOperatingUnderstanding,
): IndividualOperatingUnderstanding {
  const interpretations = [...existingUnderstanding.interpretations];
  incomingUnderstanding.interpretations.forEach((interpretation) => {
    const interpretationIndex = interpretations.findIndex(({ id }) => id === interpretation.id);
    if (interpretationIndex === -1) interpretations.push(interpretation);
    else interpretations[interpretationIndex] = mergeClaim(
      interpretations[interpretationIndex],
      interpretation,
    );
  });

  return {
    id: existingUnderstanding.id,
    dimension: existingUnderstanding.dimension,
    understanding: {
      ...mergeClaim(existingUnderstanding.understanding, incomingUnderstanding.understanding),
      ...(existingUnderstanding.dimension !== incomingUnderstanding.dimension
        ? { status: "unresolved" as const, statement: "" }
        : {}),
    },
    interpretations,
  };
}

export function mergeIndividualOperatingUnderstandings(
  existing: unknown,
  incoming: readonly IndividualOperatingUnderstanding[],
  sourceSubmissions: readonly OperatingProfileSourceSubmission[],
): IndividualOperatingUnderstanding[] {
  assertIndividualOperatingUnderstandingsDataStructure(incoming);
  const merged = normaliseIndividualOperatingUnderstandings(existing, sourceSubmissions);
  incoming.forEach((entry) => {
    const normalised = normaliseUnderstanding(entry, sourceSubmissions);
    if (!normalised) {
      throw new Error("An incoming individual operating understanding has a malformed record structure.");
    }
    const index = merged.findIndex(({ id }) => id === normalised.id);
    if (index === -1) merged.push(normalised);
    else merged[index] = mergeUnderstandingRecords(merged[index], normalised);
  });
  return merged;
}

export function attachIndividualOperatingUnderstandings<T>(
  people: readonly T[],
  seed: IndividualOperatingUnderstandingSeed,
  getName: (person: T) => string,
  getSourceSubmissions: (person: T) => unknown,
  getUnderstandings: (person: T) => unknown,
  withUnderstandings: (person: T, understandings: IndividualOperatingUnderstanding[]) => T,
): { people: T[]; status: "attached" | "person-not-found" | "ambiguous-person" } {
  const matchingPeople = people.filter(
    (person) => getName(person).trim().toLowerCase() === seed.respondentName.trim().toLowerCase(),
  );
  if (matchingPeople.length === 0) return { people: [...people], status: "person-not-found" };
  if (matchingPeople.length > 1) return { people: [...people], status: "ambiguous-person" };

  const target = matchingPeople[0];
  const sourceSubmissions = normaliseOperatingProfileSourceSubmissions(getSourceSubmissions(target));
  return {
    people: people.map((person) => person === target
      ? withUnderstandings(
        person,
        mergeIndividualOperatingUnderstandings(
          getUnderstandings(person),
          seed.understandings,
          sourceSubmissions,
        ),
      )
      : person),
    status: "attached",
  };
}
