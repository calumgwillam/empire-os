export type PersistenceStorage = {
  getItem?(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function persistJsonArray(storage: PersistenceStorage, key: string, records: readonly unknown[]): void {
  if (records.length === 0) {
    storage.removeItem(key);
  } else {
    storage.setItem(key, JSON.stringify(records));
  }
}

export function persistJsonValue(storage: PersistenceStorage, key: string, value: unknown): void {
  storage.setItem(key, JSON.stringify(value));
}

export class PersistenceTransactionError extends Error {
  constructor(message: string, readonly rollbackFailedKeys: readonly string[]) {
    super(message);
    this.name = "PersistenceTransactionError";
  }
}

export function persistJsonArraysTransaction(
  storage: Required<PersistenceStorage>,
  updates: readonly { key: string; records: readonly unknown[] }[],
): void {
  if (new Set(updates.map((update) => update.key)).size !== updates.length) throw new Error("Persistence transaction contains duplicate storage keys.");
  const writes = updates.map(({ key, records }) => ({
    key, before: storage.getItem(key), after: records.length ? JSON.stringify(records) : null,
  }));
  try {
    writes.forEach(({ key, before, after }) => {
      if (before === after) return;
      if (after === null) storage.removeItem(key);
      else storage.setItem(key, after);
    });
    if (writes.some(({ key, after }) => storage.getItem(key) !== after)) throw new Error("Storage transaction verification failed.");
  } catch (error) {
    const failures: string[] = [];
    writes.forEach(({ key, before }) => {
      try {
        if (storage.getItem(key) === before) return;
        if (before === null) storage.removeItem(key);
        else storage.setItem(key, before);
        if (storage.getItem(key) !== before) failures.push(key);
      } catch {
        failures.push(key);
      }
    });
    throw new PersistenceTransactionError(`Storage transaction failed: ${error instanceof Error ? error.message : String(error)}.${failures.length
      ? ` Rollback failed for ${failures.join(", ")}; reload and reconcile persisted records before continuing.` : " Previous storage restored."}`, failures);
  }
}
