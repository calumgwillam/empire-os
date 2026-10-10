import { describe, expect, expectTypeOf, it } from "vitest";
import {
  EMPIRE_OS_BACKUP_STORAGE_KEYS,
  STORAGE_KEY,
} from "./backup";
import {
  IndexedDbPersistenceRepository,
  prepareLegacyImport,
} from "./indexeddb-persistence";

type FailureConfig = {
  writeNumber?: number;
  errorName?: string;
  blocked?: boolean;
  silentWriteNumber?: number;
};

function memoryIndexedDb(config: FailureConfig = {}) {
  const records = new Map<string, unknown>();
  let transactionTail = Promise.resolve();
  let writeCount = 0;

  const factory = {
    open: () => {
      const request: Record<string, unknown> = {
        result: null,
        error: null,
        onblocked: null,
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        if (config.blocked) {
          (request.onblocked as ((event: Event) => void) | null)?.(new Event("blocked"));
          return;
        }

        const database = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => ({}),
          close: () => {},
          onversionchange: null,
          transaction: () => {
            const operations: Array<() => void> = [];
            let transactionRecords = new Map<string, unknown>();
            let aborted = false;
            const transaction: Record<string, unknown> = {
              error: null,
              oncomplete: null,
              onabort: null,
              onerror: null,
              abort: () => {
                aborted = true;
              },
              objectStore: () => ({
                get: (key: string) => {
                  const request: Record<string, unknown> = { result: undefined, error: null, onsuccess: null, onerror: null };
                  operations.push(() => {
                    request.result = transactionRecords.has(key) ? structuredClone(transactionRecords.get(key)) : undefined;
                    (request.onsuccess as ((event: Event) => void) | null)?.(new Event("success"));
                  });
                  return request;
                },
                put: (value: { key: string }) => {
                  const request: Record<string, unknown> = { result: value.key, error: null, onsuccess: null, onerror: null };
                  operations.push(() => {
                    writeCount++;
                    if (config.writeNumber === writeCount) {
                      const error = new Error("Simulated IndexedDB write failure") as Error & { name: string };
                      error.name = config.errorName || "UnknownError";
                      request.error = error;
                      transaction.error = error;
                      aborted = true;
                      (request.onerror as ((event: Event) => void) | null)?.(new Event("error"));
                      return;
                    }
                    if (config.silentWriteNumber !== writeCount) {
                      transactionRecords.set(value.key, structuredClone(value));
                    }
                    (request.onsuccess as ((event: Event) => void) | null)?.(new Event("success"));
                  });
                  return request;
                },
              }),
            };

            const run = transactionTail.then(() => {
              transactionRecords = new Map(records);
              while (operations.length && !aborted) operations.shift()!();
              if (aborted) {
                if (!transaction.error) {
                  const error = new Error("Transaction aborted") as Error & { name: string };
                  error.name = "AbortError";
                  transaction.error = error;
                }
                (transaction.onabort as ((event: Event) => void) | null)?.(new Event("abort"));
              } else {
                records.clear();
                transactionRecords.forEach((value, key) => records.set(key, value));
                (transaction.oncomplete as ((event: Event) => void) | null)?.(new Event("complete"));
              }
            });
            transactionTail = run.then(() => undefined);
            return transaction;
          },
        };
        request.result = database;
        (request.onupgradeneeded as ((event: Event) => void) | null)?.(new Event("upgradeneeded"));
        (request.onsuccess as ((event: Event) => void) | null)?.(new Event("success"));
      });
      return request;
    },
  } as unknown as Pick<IDBFactory, "open">;

  return { factory, records, setFailure: (next: FailureConfig) => {
    config.writeNumber = next.writeNumber;
    config.errorName = next.errorName;
    config.blocked = next.blocked;
    config.silentWriteNumber = next.silentWriteNumber;
    writeCount = 0;
  } };
}

function legacyStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  let writes = 0;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { writes++; values.set(key, value); },
    removeItem: (key: string) => { writes++; values.delete(key); },
  };
  return {
    storage,
    values,
    get writes() { return writes; },
  };
}

describe("IndexedDB persistence repository", () => {
  it("commits multiple exact raw values atomically and returns revisions only after completion", async () => {
    const indexedDb = memoryIndexedDb();
    const repository = new IndexedDbPersistenceRepository(indexedDb.factory);
    const rawValue = ' [ { "id": "legacy", "unknownEvidence": { "source": "retained" } } ] ';

    const result = await repository.write([
      { key: STORAGE_KEY, rawValue, expectedRevision: 0 },
      { key: "empire-os-projects", rawValue: null, expectedRevision: 0 },
    ]);

    expectTypeOf<Extract<typeof result, { status: "imported" | "already-imported" | "source-changed" | "source-invalid" }>>()
      .toEqualTypeOf<never>();
    expect(result).toEqual({
      status: "committed",
      revisions: { [STORAGE_KEY]: 1, "empire-os-projects": 1 },
    });
    expect(indexedDb.records.get(STORAGE_KEY)).toEqual({ key: STORAGE_KEY, rawValue, revision: 1 });
    const read = await repository.read([STORAGE_KEY, "empire-os-projects"]);
    expect(read).toEqual({
      status: "read",
      values: [
        { key: STORAGE_KEY, rawValue, revision: 1 },
        { key: "empire-os-projects", rawValue: null, revision: 1 },
      ],
    });
  });

  it("rejects a stale expected revision without overwriting the committed value", async () => {
    const repository = new IndexedDbPersistenceRepository(memoryIndexedDb().factory);
    expect(await repository.write([{ key: STORAGE_KEY, rawValue: "first", expectedRevision: 0 }]))
      .toMatchObject({ status: "committed", revisions: { [STORAGE_KEY]: 1 } });

    const stale = await repository.write([{ key: STORAGE_KEY, rawValue: "stale", expectedRevision: 0 }]);
    expect(stale).toEqual({
      status: "conflict",
      conflicts: [{ key: STORAGE_KEY, expectedRevision: 0, actualRevision: 1 }],
    });
    expect(await repository.read([STORAGE_KEY])).toMatchObject({
      status: "read", values: [{ rawValue: "first", revision: 1 }],
    });
  });

  it("serializes concurrent writers to the same key and allows only one stale revision to commit", async () => {
    const factory = memoryIndexedDb().factory;
    const firstTab = new IndexedDbPersistenceRepository(factory);
    const secondTab = new IndexedDbPersistenceRepository(factory);
    const outcomes = await Promise.all([
      firstTab.write([{ key: STORAGE_KEY, rawValue: "writer-a", expectedRevision: 0 }]),
      secondTab.write([{ key: STORAGE_KEY, rawValue: "writer-b", expectedRevision: 0 }]),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "committed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "conflict")).toHaveLength(1);
  });

  it("keeps every key unchanged when one member of a multi-key write has a stale revision", async () => {
    const repository = new IndexedDbPersistenceRepository(memoryIndexedDb().factory);
    await repository.write([{ key: "empire-os-projects", rawValue: "existing", expectedRevision: 0 }]);

    const result = await repository.write([
      { key: STORAGE_KEY, rawValue: "must-not-commit", expectedRevision: 0 },
      { key: "empire-os-projects", rawValue: "stale", expectedRevision: 0 },
    ]);

    expect(result).toMatchObject({ status: "conflict" });
    expect(await repository.read([STORAGE_KEY, "empire-os-projects"])).toMatchObject({
      status: "read",
      values: [
        { rawValue: null, revision: 0 },
        { rawValue: "existing", revision: 1 },
      ],
    });
  });

  it("increments revisions when a value is cleared and written again", async () => {
    const repository = new IndexedDbPersistenceRepository(memoryIndexedDb().factory);
    await repository.write([{ key: STORAGE_KEY, rawValue: "first", expectedRevision: 0 }]);
    await repository.write([{ key: STORAGE_KEY, rawValue: null, expectedRevision: 1 }]);

    expect(await repository.write([{ key: STORAGE_KEY, rawValue: "second", expectedRevision: 2 }]))
      .toMatchObject({ status: "committed", revisions: { [STORAGE_KEY]: 3 } });
  });

  it("commits independent transactions that update different keys", async () => {
    const repository = new IndexedDbPersistenceRepository(memoryIndexedDb().factory);
    const outcomes = await Promise.all([
      repository.write([{ key: STORAGE_KEY, rawValue: "capture", expectedRevision: 0 }]),
      repository.write([{ key: "empire-os-projects", rawValue: "project", expectedRevision: 0 }]),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["committed", "committed"]);
    expect(await repository.read([STORAGE_KEY, "empire-os-projects"])).toMatchObject({
      status: "read",
      values: [
        { rawValue: "capture", revision: 1 },
        { rawValue: "project", revision: 1 },
      ],
    });
  });

  it("aborts a failed multi-key transaction without partially applying its writes", async () => {
    const indexedDb = memoryIndexedDb({ writeNumber: 2, errorName: "UnknownError" });
    const repository = new IndexedDbPersistenceRepository(indexedDb.factory);
    const result = await repository.write([
      { key: STORAGE_KEY, rawValue: "capture", expectedRevision: 0 },
      { key: "empire-os-projects", rawValue: "project", expectedRevision: 0 },
    ]);

    expect(result).toMatchObject({ status: "transaction-failed" });
    expect(indexedDb.records.size).toBe(0);
  });

  it("rejects a write that reports request success but fails read-back verification", async () => {
    const indexedDb = memoryIndexedDb({ silentWriteNumber: 1 });
    const repository = new IndexedDbPersistenceRepository(indexedDb.factory);
    const result = await repository.write([{ key: STORAGE_KEY, rawValue: "not-written", expectedRevision: 0 }]);

    expect(result).toMatchObject({ status: "transaction-failed" });
    expect(indexedDb.records.size).toBe(0);
  });

  it("rejects corrupt repository records rather than treating them as absent", async () => {
    const indexedDb = memoryIndexedDb();
    const repository = new IndexedDbPersistenceRepository(indexedDb.factory);
    indexedDb.records.set(STORAGE_KEY, { key: STORAGE_KEY, rawValue: "value", revision: 0 });

    expect(await repository.read([STORAGE_KEY])).toMatchObject({ status: "transaction-failed" });
  });

  it("returns distinct quota and unavailable-storage outcomes", async () => {
    const quota = new IndexedDbPersistenceRepository(memoryIndexedDb({ writeNumber: 1, errorName: "QuotaExceededError" }).factory);
    const unavailable = new IndexedDbPersistenceRepository({
      open: () => {
        const error = new Error("IndexedDB access denied") as Error & { name: string };
        error.name = "SecurityError";
        throw error;
      },
    });

    expect(await quota.write([{ key: STORAGE_KEY, rawValue: "value", expectedRevision: 0 }]))
      .toMatchObject({ status: "quota-exceeded", error: { name: "QuotaExceededError" } });
    expect(await unavailable.write([{ key: STORAGE_KEY, rawValue: "value", expectedRevision: 0 }]))
      .toMatchObject({ status: "unavailable" });
  });

  it("reports a blocked database open as unavailable", async () => {
    const repository = new IndexedDbPersistenceRepository(memoryIndexedDb({ blocked: true }).factory);
    expect(await repository.read([STORAGE_KEY])).toMatchObject({
      status: "unavailable", error: { name: "BlockedError" },
    });
  });
});

describe("Non-destructive legacy import preparation", () => {
  it("preserves all registered raw values and leaves legacy storage untouched", async () => {
    const rawValue = ' [ { "id": "legacy", "unknownEvidence": { "source": "retained" } } ] ';
    const legacy = legacyStorage({ [STORAGE_KEY]: rawValue });
    const plan = prepareLegacyImport(legacy.storage);
    expect(plan.entries).toHaveLength(EMPIRE_OS_BACKUP_STORAGE_KEYS.length);
    expect(plan.entries.find(({ key }) => key === STORAGE_KEY)?.rawValue).toBe(rawValue);
    expect(legacy.values.get(STORAGE_KEY)).toBe(rawValue);
    expect(legacy.writes).toBe(0);

    const indexedDb = memoryIndexedDb();
    const repository = new IndexedDbPersistenceRepository(indexedDb.factory);
    const result = await repository.importLegacyDataset(plan, legacy.storage);
    expectTypeOf<Extract<typeof result, { status: "committed" }>>().toEqualTypeOf<never>();
    expect(result).toMatchObject({
      status: "imported", revisions: { [STORAGE_KEY]: 1 },
    });
    expect(indexedDb.records.size).toBe(EMPIRE_OS_BACKUP_STORAGE_KEYS.length);
    expect(legacy.values.get(STORAGE_KEY)).toBe(rawValue);
    expect(legacy.writes).toBe(0);

    expect(await repository.importLegacyDataset(plan, legacy.storage)).toMatchObject({
      status: "already-imported", revisions: { [STORAGE_KEY]: 1 },
    });
    expect(legacy.writes).toBe(0);
  });

  it("does not import a stale plan after legacy storage changes", async () => {
    const legacy = legacyStorage({ [STORAGE_KEY]: '[{"id":"original"}]' });
    const plan = prepareLegacyImport(legacy.storage);
    legacy.values.set(STORAGE_KEY, '[{"id":"newer"}]');
    const indexedDb = memoryIndexedDb();
    const repository = new IndexedDbPersistenceRepository(indexedDb.factory);

    expect(await repository.importLegacyDataset(plan, legacy.storage)).toEqual({
      status: "source-changed", keys: [STORAGE_KEY],
    });
    expect(indexedDb.records.size).toBe(0);
    expect(legacy.writes).toBe(0);
  });

  it("rechecks legacy values after opening IndexedDB and before queuing import writes", async () => {
    const legacy = legacyStorage({ [STORAGE_KEY]: '[{"id":"original"}]' });
    const plan = prepareLegacyImport(legacy.storage);
    const indexedDb = memoryIndexedDb();
    const repository = new IndexedDbPersistenceRepository(indexedDb.factory);

    const pendingImport = repository.importLegacyDataset(plan, legacy.storage);
    legacy.values.set(STORAGE_KEY, '[{"id":"changed-during-open"}]');

    expect(await pendingImport).toEqual({ status: "source-changed", keys: [STORAGE_KEY] });
    expect(indexedDb.records.size).toBe(0);
    expect(legacy.writes).toBe(0);
  });

  it("returns a typed invalid-source result if legacy data becomes malformed before import", async () => {
    const legacy = legacyStorage({ [STORAGE_KEY]: '[{"id":"original"}]' });
    const plan = prepareLegacyImport(legacy.storage);
    const repository = new IndexedDbPersistenceRepository(memoryIndexedDb().factory);
    legacy.values.set(STORAGE_KEY, "{malformed");

    expect(await repository.importLegacyDataset(plan, legacy.storage)).toMatchObject({
      status: "source-invalid",
    });
    expect(legacy.values.get(STORAGE_KEY)).toBe("{malformed");
    expect(legacy.writes).toBe(0);
  });

  it("safely retries an interrupted import after the failed transaction aborts", async () => {
    const legacy = legacyStorage({ [STORAGE_KEY]: '[{"id":"retained"}]' });
    const plan = prepareLegacyImport(legacy.storage);
    const indexedDb = memoryIndexedDb({ writeNumber: 3, errorName: "UnknownError" });
    const repository = new IndexedDbPersistenceRepository(indexedDb.factory);

    expect(await repository.importLegacyDataset(plan, legacy.storage)).toMatchObject({ status: "transaction-failed" });
    expect(indexedDb.records.size).toBe(0);

    indexedDb.setFailure({});
    expect(await repository.importLegacyDataset(plan, legacy.storage)).toMatchObject({ status: "imported" });
    expect(indexedDb.records.size).toBe(EMPIRE_OS_BACKUP_STORAGE_KEYS.length);
    expect(legacy.values.get(STORAGE_KEY)).toBe('[{"id":"retained"}]');
    expect(legacy.writes).toBe(0);
  });

  it("reuses startup validation and rejects malformed legacy data without writing it", () => {
    const legacy = legacyStorage({ [STORAGE_KEY]: "{malformed" });
    expect(() => prepareLegacyImport(legacy.storage)).toThrow();
    expect(legacy.values.get(STORAGE_KEY)).toBe("{malformed");
    expect(legacy.writes).toBe(0);
  });
});
