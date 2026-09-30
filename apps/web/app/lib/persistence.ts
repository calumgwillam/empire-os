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
