import type { CorrelationContextRecordInput } from "./correlation-graph";

// Translates existing People intelligence into correlation context records keyed by stable Person identity.
// Only explicit Person records participate: no names, owner text or free text are interpreted here, and a
// Person only joins a situation when a strategic risk explicitly references that Person's id.

export const PEOPLE_CORRELATION_SIGNALS = {
  founderDependency: "founder dependency",
  capabilityGap: "capability gap",
} as const;

export type PeopleCorrelationPerson = {
  id: string;
  name: string;
  status: string;
};

export type PeopleCorrelationContextInput = {
  people: readonly PeopleCorrelationPerson[];
  // The primary founder as resolved by delegation readiness (execution-release), or null.
  primaryFounderId: string | null;
  // Active work currently classified as requiring founder intervention (operational independence "Founder-only").
  founderDependentWork: readonly { objectType: string; id: string }[];
  // Active non-founder people missing role, responsibilities or authority (delegation readiness gap).
  capabilityGaps: readonly { personId: string; missingFields: readonly string[] }[];
};

export function getPersonCorrelationRecordKey(personId: string): string {
  return `Person:${personId}`;
}

export function buildPeopleCorrelationContext(input: PeopleCorrelationContextInput): CorrelationContextRecordInput[] {
  const activePeople = new Map(input.people
    .filter((person) => person.status === "Active" && person.id.trim())
    .map((person) => [person.id, person] as const));
  const records = new Map<string, CorrelationContextRecordInput & { evidenceRecordKeysBySignal: Record<string, string[]> }>();
  const add = (person: PeopleCorrelationPerson, signal: string, evidenceRecordKeys: readonly string[]) => {
    const recordKey = getPersonCorrelationRecordKey(person.id);
    const existing = records.get(recordKey) ?? {
      recordKey,
      objectType: "Person",
      id: person.id,
      title: person.name,
      area: "People",
      signals: [],
      evidenceRecordKeysBySignal: {},
    };
    records.set(recordKey, {
      ...existing,
      signals: [...new Set([...existing.signals, signal])].sort(),
      evidenceRecordKeysBySignal: {
        ...existing.evidenceRecordKeysBySignal,
        ...(evidenceRecordKeys.length > 0 ? { [signal]: [...new Set(evidenceRecordKeys)].sort() } : {}),
      },
    });
  };

  const founder = input.primaryFounderId ? activePeople.get(input.primaryFounderId) : undefined;
  if (founder && input.founderDependentWork.length > 0) {
    add(
      founder,
      PEOPLE_CORRELATION_SIGNALS.founderDependency,
      input.founderDependentWork.map((item) => `${item.objectType}:${item.id}`),
    );
  }

  input.capabilityGaps.forEach((gap) => {
    const person = activePeople.get(gap.personId);
    if (!person || person.id === input.primaryFounderId || gap.missingFields.length === 0) return;
    add(person, PEOPLE_CORRELATION_SIGNALS.capabilityGap, []);
  });

  return [...records.values()].sort((left, right) => left.recordKey.localeCompare(right.recordKey));
}
