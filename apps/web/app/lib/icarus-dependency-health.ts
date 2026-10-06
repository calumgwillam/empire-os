import { getIcarusReferenceKey, type IcarusRecordReference, type IcarusSourceRecord } from "./icarus";

export const ICARUS_DEPENDENCY_HEALTH_STATES = [
  "Healthy",
  "Watch",
  "Degraded",
  "Failed",
  "Unknown",
  "Not applicable",
] as const;

export type IcarusDependencyHealthState = (typeof ICARUS_DEPENDENCY_HEALTH_STATES)[number];
export type IcarusDependencyHealthSource = "Explicit" | "Derived";

export type IcarusDependencyHealthBasis =
  | "active-person"
  | "inactive-person"
  | "missing-person-status"
  | "completed-action"
  | "blocked-action"
  | "waiting-action"
  | "overdue-action"
  | "active-action"
  | "cancelled-action"
  | "missing-action"
  | "on-track-project"
  | "at-risk-project"
  | "blocked-project"
  | "waiting-project"
  | "completed-project"
  | "cancelled-project"
  | "unsupported-project-state"
  | "no-operational-health-evidence"
  | "missing-source-record"
  | "conflicting-record-state";

export type IcarusDependencyHealth = {
  reference: IcarusRecordReference;
  health: IcarusDependencyHealthState;
  basis: IcarusDependencyHealthBasis[];
  supportingRecords: IcarusRecordReference[];
  source: IcarusDependencyHealthSource;
  relevantAt?: string;
};

export type IcarusDependencyHealthAction = {
  id: string;
  status: string;
  dueDate?: string;
};

export type IcarusDependencyHealthPerson = {
  id: string;
  status: string;
};

export type IcarusDependencyHealthInput = {
  sourceRecords: readonly IcarusSourceRecord[];
  people: readonly IcarusDependencyHealthPerson[];
  actions: readonly IcarusDependencyHealthAction[];
  nowMs?: number;
};

export type IcarusDependencyHealthRegistry = ReadonlyMap<string, IcarusDependencyHealth>;

type HealthResult = Pick<IcarusDependencyHealth, "health" | "basis"> & { relevantAt?: string };

function parseDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function uniqueState<T>(records: readonly T[], stateOf: (record: T) => string): T | null {
  if (records.length === 0) return null;
  const states = new Set(records.map(stateOf));
  return states.size === 1 ? records[0] : null;
}

function assessPerson(status: string | undefined): HealthResult {
  if (status === "Active") return { health: "Healthy", basis: ["active-person"] };
  if (status === "Inactive") return { health: "Failed", basis: ["inactive-person"] };
  return { health: "Unknown", basis: ["missing-person-status"] };
}

function assessAction(action: IcarusDependencyHealthAction | null, nowMs: number): HealthResult {
  if (!action) return { health: "Unknown", basis: ["missing-action"] };
  if (action.status === "Completed") return { health: "Not applicable", basis: ["completed-action"] };
  if (action.status === "Blocked") return { health: "Degraded", basis: ["blocked-action"] };
  if (action.status === "Waiting") return { health: "Watch", basis: ["waiting-action"] };
  if (action.status === "Cancelled") return { health: "Unknown", basis: ["cancelled-action"] };
  if (action.status === "Open" || action.status === "In Progress") {
    const dueAt = parseDate(action.dueDate);
    if (dueAt !== undefined && dueAt < nowMs) return { health: "Watch", basis: ["overdue-action"] };
    return { health: "Healthy", basis: ["active-action"] };
  }
  return { health: "Unknown", basis: ["missing-action"] };
}

function assessProject(record: IcarusSourceRecord): HealthResult {
  if (record.status === "Completed") return { health: "Not applicable", basis: ["completed-project"] };
  if (record.status === "Cancelled") return { health: "Unknown", basis: ["cancelled-project"] };
  const relevantAt = record.relevantAt && parseDate(record.relevantAt) !== undefined ? record.relevantAt : undefined;
  if (record.health === "On track") {
    return { health: "Healthy", basis: ["on-track-project"], ...(relevantAt ? { relevantAt } : {}) };
  }
  if (record.health === "At risk") {
    return { health: "Watch", basis: ["at-risk-project"], ...(relevantAt ? { relevantAt } : {}) };
  }
  if (record.health === "Blocked" || record.status === "Blocked") {
    return { health: "Degraded", basis: ["blocked-project"], ...(relevantAt ? { relevantAt } : {}) };
  }
  if (record.health === "Waiting") {
    return { health: "Watch", basis: ["waiting-project"], ...(relevantAt ? { relevantAt } : {}) };
  }
  if (record.status === "Open" || record.status === "In Progress") {
    return { health: "Healthy", basis: ["on-track-project"], ...(relevantAt ? { relevantAt } : {}) };
  }
  return { health: "Unknown", basis: ["unsupported-project-state"] };
}

function assessSource(record: IcarusSourceRecord | null): HealthResult {
  if (!record) return { health: "Unknown", basis: ["missing-source-record"] };
  if (record.recordType === "Project") return assessProject(record);
  if (record.recordType === "SOP" || record.recordType === "System") {
    return { health: "Unknown", basis: ["no-operational-health-evidence"] };
  }
  return { health: "Unknown", basis: ["no-operational-health-evidence"] };
}

export function buildIcarusDependencyHealthRegistry(
  input: IcarusDependencyHealthInput,
): IcarusDependencyHealthRegistry {
  const nowMs = input.nowMs ?? Date.now();
  const sourceGroups = new Map<string, IcarusSourceRecord[]>();
  const personGroups = new Map<string, IcarusDependencyHealthPerson[]>();
  const actionGroups = new Map<string, IcarusDependencyHealthAction[]>();
  const references = new Map<string, IcarusRecordReference>();

  const addReference = (reference: IcarusRecordReference) => {
    const key = getIcarusReferenceKey(reference);
    if (!references.has(key)) references.set(key, { ...reference });
    return key;
  };

  input.sourceRecords.forEach((record) => {
    const key = addReference(record);
    sourceGroups.set(key, [...(sourceGroups.get(key) ?? []), record]);
  });
  input.people.forEach((person) => {
    const reference = { recordType: "Person" as const, recordId: person.id };
    const key = addReference(reference);
    personGroups.set(key, [...(personGroups.get(key) ?? []), person]);
  });
  input.actions.forEach((action) => {
    const reference = { recordType: "Action" as const, recordId: action.id };
    const key = addReference(reference);
    actionGroups.set(key, [...(actionGroups.get(key) ?? []), action]);
  });

  const registry = new Map<string, IcarusDependencyHealth>();
  [...references.keys()].sort().forEach((key) => {
    const reference = references.get(key)!;
    const sourceRecords = sourceGroups.get(key) ?? [];
    const people = personGroups.get(key) ?? [];
    const actions = actionGroups.get(key) ?? [];
    let result: HealthResult;
    if (reference.recordType === "Person") {
      const person = uniqueState(people, (entry) => entry.status);
      result = person ? assessPerson(person.status) : people.length > 0
        ? { health: "Unknown", basis: ["conflicting-record-state"] }
        : assessSource(uniqueState(sourceRecords, (record) => `${record.status ?? ""}\u0000${record.health ?? ""}\u0000${record.relevantAt ?? ""}`));
    } else if (reference.recordType === "Action") {
      const action = uniqueState(actions, (entry) => `${entry.status}\u0000${entry.dueDate ?? ""}`);
      result = action ? assessAction(action, nowMs) : actions.length > 0
        ? { health: "Unknown", basis: ["conflicting-record-state"] }
        : assessSource(uniqueState(sourceRecords, (record) => `${record.status ?? ""}\u0000${record.health ?? ""}\u0000${record.relevantAt ?? ""}`));
    } else if (sourceRecords.length > 1 && new Set(sourceRecords.map((record) => `${record.status ?? ""}\u0000${record.health ?? ""}\u0000${record.relevantAt ?? ""}`)).size > 1) {
      result = { health: "Unknown", basis: ["conflicting-record-state"] };
    } else {
      result = assessSource(uniqueState(sourceRecords, (record) => `${record.status ?? ""}\u0000${record.health ?? ""}\u0000${record.relevantAt ?? ""}`));
    }
    registry.set(key, {
      reference,
      health: result.health,
      basis: result.basis,
      supportingRecords: [{ ...reference }],
      source: "Derived",
      ...(result.relevantAt ? { relevantAt: result.relevantAt } : {}),
    });
  });

  return registry;
}

export function getIcarusDependencyHealth(
  registry: IcarusDependencyHealthRegistry | undefined,
  reference: IcarusRecordReference,
): IcarusDependencyHealth {
  return registry?.get(getIcarusReferenceKey(reference)) ?? {
    reference: { ...reference },
    health: "Unknown",
    basis: ["missing-source-record"],
    supportingRecords: [],
    source: "Derived",
  };
}
