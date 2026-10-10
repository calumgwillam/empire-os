import { IDBFactory as FakeIDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CASH_POSITION_STORAGE_KEY,
  DEFAULT_SAVED_VIEW_STORAGE_KEY,
  EMPIRE_OS_BACKUP_STORAGE_KEYS,
  FOUNDER_INTELLIGENCE_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
  STORAGE_KEY,
  type BackupStorage,
} from "./backup";
import {
  IndexedDbPersistenceRepository,
  prepareLegacyImport,
  type BusinessStorageKey,
} from "./indexeddb-persistence";

const connections = new Set<IDBDatabase>();

afterEach(() => {
  for (const connection of connections) connection.close();
  connections.clear();
  vi.restoreAllMocks();
});

function environment(onTransaction?: (transaction: IDBTransaction) => void) {
  const indexedDb = new FakeIDBFactory();
  const factory: Pick<IDBFactory, "open"> = {
    open(name, version) {
      const request = indexedDb.open(name, version);
      request.addEventListener("success", () => {
        const database = request.result;
        connections.add(database);
        if (onTransaction) {
          const transaction = database.transaction.bind(database);
          vi.spyOn(database, "transaction").mockImplementation((stores, mode, options) => {
            const result = transaction(stores, mode, options);
            onTransaction(result);
            return result;
          });
        }
      });
      return request;
    },
  };
  return {
    indexedDb,
    repository: () => new IndexedDbPersistenceRepository(factory, "phase-one-integration"),
  };
}

async function readValues(repository: IndexedDbPersistenceRepository, keys: readonly BusinessStorageKey[]) {
  const result = await repository.read(keys);
  if (result.status !== "read") throw new Error(`Repository read failed: ${JSON.stringify(result)}`);
  return result.values;
}

function legacy() {
  const values = new Map<string, string>(EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => [
    key,
    key === CASH_POSITION_STORAGE_KEY || key === FOUNDER_INTELLIGENCE_STORAGE_KEY
      ? ' { "unknownEvidence": { "source": "retained" } } '
      : key === DEFAULT_SAVED_VIEW_STORAGE_KEY ? "legacy-selection" : " [ ] ",
  ]));
  values.set(STORAGE_KEY, ' [ { "id": "legacy", "unknownEvidence": { "source": "retained" } } ] ');
  const storage: BackupStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn(() => { throw new Error("Legacy writes are forbidden."); }),
    removeItem: vi.fn(() => { throw new Error("Legacy deletions are forbidden."); }),
  };
  return { values, storage };
}

function observePuts(transaction: IDBTransaction, onSuccess: (count: number) => void) {
  if (transaction.mode !== "readwrite") return;
  const store = transaction.objectStore("business-data");
  const put = store.put.bind(store);
  let count = 0;
  vi.spyOn(store, "put").mockImplementation((value, key) => {
    const request = put(value, key);
    request.addEventListener("success", () => { onSuccess(++count); });
    return request;
  });
}

describe("IndexedDB repository with independent fake-indexeddb transactions", () => {
  it("commits multiple values and revisions atomically", async () => {
    const repository = environment().repository();
    expect(await repository.write([
      { key: STORAGE_KEY, rawValue: "capture", expectedRevision: 0 },
      { key: PROJECT_STORAGE_KEY, rawValue: "project", expectedRevision: 0 },
    ])).toEqual({
      status: "committed", revisions: { [STORAGE_KEY]: 1, [PROJECT_STORAGE_KEY]: 1 },
    });
    expect(await readValues(repository, [STORAGE_KEY, PROJECT_STORAGE_KEY])).toEqual([
      { key: STORAGE_KEY, rawValue: "capture", revision: 1 },
      { key: PROJECT_STORAGE_KEY, rawValue: "project", revision: 1 },
    ]);
  });

  it("rolls back staged values and revisions when aborted after the first successful put", async () => {
    let interrupt = false;
    let stagedPuts = 0;
    const repository = environment((transaction) => {
      observePuts(transaction, (count) => {
        if (interrupt && count === 1) {
          stagedPuts++;
          transaction.abort();
        }
      });
    }).repository();
    const updates = [
      { key: STORAGE_KEY, rawValue: "original", expectedRevision: 0 },
      { key: PROJECT_STORAGE_KEY, rawValue: "original-project", expectedRevision: 0 },
    ] satisfies Parameters<IndexedDbPersistenceRepository["write"]>[0];
    expect((await repository.write(updates)).status).toBe("committed");
    const before = await readValues(repository, [STORAGE_KEY, PROJECT_STORAGE_KEY]);
    interrupt = true;
    expect((await repository.write(updates.map((update) => ({
      ...update, rawValue: "must-roll-back", expectedRevision: 1,
    })))).status).toBe("transaction-failed");
    expect(stagedPuts).toBe(1);
    expect(await readValues(repository, [STORAGE_KEY, PROJECT_STORAGE_KEY])).toEqual(before);
  });

  it("rejects stale concurrent writers on separate database connections", async () => {
    const context = environment();
    const first = context.repository();
    const second = context.repository();
    await Promise.all([first.read([STORAGE_KEY]), second.read([STORAGE_KEY])]);
    const results = await Promise.all([
      first.write([{ key: STORAGE_KEY, rawValue: "first", expectedRevision: 0 }]),
      second.write([{ key: STORAGE_KEY, rawValue: "second", expectedRevision: 0 }]),
    ]);
    expect(results.filter((result) => result.status === "committed")).toHaveLength(1);
    expect(results.filter((result) => result.status === "conflict")).toEqual([{
      status: "conflict", conflicts: [{ key: STORAGE_KEY, expectedRevision: 0, actualRevision: 1 }],
    }]);
    const winner = results[0].status === "committed" ? "first" : "second";
    expect(await readValues(first, [STORAGE_KEY])).toEqual([
      { key: STORAGE_KEY, rawValue: winner, revision: 1 },
    ]);
  });

  it("lets concurrent transactions on different keys both commit", async () => {
    const context = environment();
    const results = await Promise.all([
      context.repository().write([{ key: STORAGE_KEY, rawValue: "capture", expectedRevision: 0 }]),
      context.repository().write([{ key: PROJECT_STORAGE_KEY, rawValue: "project", expectedRevision: 0 }]),
    ]);
    expect(results.map((result) => result.status)).toEqual(["committed", "committed"]);
    expect(await readValues(context.repository(), [STORAGE_KEY, PROJECT_STORAGE_KEY])).toEqual([
      { key: STORAGE_KEY, rawValue: "capture", revision: 1 },
      { key: PROJECT_STORAGE_KEY, rawValue: "project", revision: 1 },
    ]);
  });

  it("increments revisions across unchanged writes, tombstones, and reinsertion", async () => {
    const repository = environment().repository();
    const values = ["original", "original", null, "reinserted"];
    for (const [revision, rawValue] of values.entries()) {
      expect(await repository.write([{ key: STORAGE_KEY, rawValue, expectedRevision: revision }]))
        .toEqual({ status: "committed", revisions: { [STORAGE_KEY]: revision + 1 } });
    }
    expect(await readValues(repository, [STORAGE_KEY])).toEqual([
      { key: STORAGE_KEY, rawValue: "reinserted", revision: 4 },
    ]);
  });

  it("does not resolve on request success and resolves only after transaction completion", async () => {
    let resolved = false;
    let completed = false;
    let observedPendingPut = false;
    let resolvedDuringPut = false;
    let resolvedDuringCompletion = false;
    const repository = environment((transaction) => {
      if (transaction.mode !== "readwrite") return;
      observePuts(transaction, () => {
        observedPendingPut = true;
        resolvedDuringPut = resolved;
      });
      transaction.addEventListener("complete", () => {
        completed = true;
        resolvedDuringCompletion = resolved;
      });
    }).repository();
    const result = await repository.write([{ key: STORAGE_KEY, rawValue: "written", expectedRevision: 0 }])
      .then((result) => {
        resolved = true;
        return result;
      });
    expect(result.status).toBe("committed");
    expect(observedPendingPut).toBe(true);
    expect(resolvedDuringPut).toBe(false);
    expect(completed).toBe(true);
    expect(resolvedDuringCompletion).toBe(false);
  });

  it("cannot report success if aborted during the final verification request", async () => {
    let reads = 0;
    let puts = 0;
    const repository = environment((transaction) => {
      if (transaction.mode !== "readwrite") return;
      observePuts(transaction, () => { puts++; });
      const store = transaction.objectStore("business-data");
      const get = store.get.bind(store);
      vi.spyOn(store, "get").mockImplementation((key) => {
        const request = get(key);
        request.addEventListener("success", () => {
          if (++reads === 4) transaction.abort();
        });
        return request;
      });
    }).repository();
    const result = await repository.write([
      { key: STORAGE_KEY, rawValue: "capture", expectedRevision: 0 },
      { key: PROJECT_STORAGE_KEY, rawValue: "project", expectedRevision: 0 },
    ]);
    expect(puts).toBe(2);
    expect(reads).toBe(4);
    expect(result.status).toBe("transaction-failed");
    expect(await readValues(repository, [STORAGE_KEY, PROJECT_STORAGE_KEY])).toEqual([
      { key: STORAGE_KEY, rawValue: null, revision: 0 },
      { key: PROJECT_STORAGE_KEY, rawValue: null, revision: 0 },
    ]);
  });

  it("preserves exact raw strings without parsing or reserialization", async () => {
    const repository = environment().repository();
    const rawValue = ' \n[ { "id": "legacy", "unknown": "\\u0061", "amount": "01.00" } ]\r\n ';
    expect((await repository.write([{ key: STORAGE_KEY, rawValue, expectedRevision: 0 }])).status)
      .toBe("committed");
    expect((await readValues(repository, [STORAGE_KEY]))[0].rawValue).toBe(rawValue);
  });

  it("imports every registered legacy store without changing any legacy bytes", async () => {
    const { storage, values } = legacy();
    const before = [...values];
    const plan = prepareLegacyImport(storage);
    const repository = environment().repository();
    const result = await repository.importLegacyDataset(plan, storage);
    expect(result.status).toBe("imported");
    expect(plan.entries).toHaveLength(21);
    expect(await readValues(repository, EMPIRE_OS_BACKUP_STORAGE_KEYS)).toEqual(
      plan.entries.map((entry) => ({ ...entry, revision: 1 })),
    );
    expect([...values]).toEqual(before);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("aborts an interrupted import after staged writes and safely retries on another connection", async () => {
    const { storage, values } = legacy();
    const before = [...values];
    const plan = prepareLegacyImport(storage);
    let interrupt = true;
    let stagedPuts = 0;
    const context = environment((transaction) => {
      observePuts(transaction, (count) => {
        if (interrupt && count === 3) {
          stagedPuts = count;
          transaction.abort();
        }
      });
    });
    const first = context.repository();
    expect((await first.importLegacyDataset(plan, storage)).status).toBe("transaction-failed");
    expect(stagedPuts).toBe(3);
    expect(await readValues(first, EMPIRE_OS_BACKUP_STORAGE_KEYS)).toEqual(
      EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => ({ key, rawValue: null, revision: 0 })),
    );
    interrupt = false;
    const reopened = context.repository();
    expect((await reopened.importLegacyDataset(plan, storage)).status).toBe("imported");
    expect(await readValues(reopened, EMPIRE_OS_BACKUP_STORAGE_KEYS)).toEqual(
      plan.entries.map((entry) => ({ ...entry, revision: 1 })),
    );
    expect([...values]).toEqual(before);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("recognizes repeated imports without issuing puts or increasing revisions", async () => {
    let puts = 0;
    const context = environment((transaction) => {
      observePuts(transaction, () => { puts++; });
    });
    const { storage } = legacy();
    const plan = prepareLegacyImport(storage);
    expect((await context.repository().importLegacyDataset(plan, storage)).status).toBe("imported");
    expect(puts).toBe(21);
    expect((await context.repository().importLegacyDataset(plan, storage)).status).toBe("already-imported");
    expect(puts).toBe(21);
    expect(await readValues(context.repository(), EMPIRE_OS_BACKUP_STORAGE_KEYS)).toEqual(
      plan.entries.map((entry) => ({ ...entry, revision: 1 })),
    );
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("does not overwrite newer repository data when retrying legacy import", async () => {
    const context = environment();
    const repository = context.repository();
    const { storage } = legacy();
    const plan = prepareLegacyImport(storage);
    expect((await repository.importLegacyDataset(plan, storage)).status).toBe("imported");
    expect((await repository.write([{ key: STORAGE_KEY, rawValue: "newer", expectedRevision: 1 }])).status)
      .toBe("committed");
    expect(await context.repository().importLegacyDataset(plan, storage)).toEqual({
      status: "conflict",
      conflicts: EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => ({
        key, expectedRevision: 0, actualRevision: key === STORAGE_KEY ? 2 : 1,
      })),
    });
    expect((await readValues(repository, [STORAGE_KEY]))[0]).toEqual({
      key: STORAGE_KEY, rawValue: "newer", revision: 2,
    });
  });

  it("rejects malformed or changed legacy sources without importing anything", async () => {
    const repository = environment().repository();
    const { storage, values } = legacy();
    const plan = prepareLegacyImport(storage);
    values.set(STORAGE_KEY, "{malformed");
    expect((await repository.importLegacyDataset(plan, storage)).status).toBe("source-invalid");
    values.set(STORAGE_KEY, '[{"id":"changed"}]');
    expect(await repository.importLegacyDataset(plan, storage)).toEqual({
      status: "source-changed", keys: [STORAGE_KEY],
    });
    expect(await readValues(repository, EMPIRE_OS_BACKUP_STORAGE_KEYS)).toEqual(
      EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => ({ key, rawValue: null, revision: 0 })),
    );
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("detects a source change while awaiting database initialization", async () => {
    const repository = environment().repository();
    const { storage, values } = legacy();
    const plan = prepareLegacyImport(storage);
    const pending = repository.importLegacyDataset(plan, storage);
    values.set(STORAGE_KEY, '[{"id":"changed-during-open"}]');
    expect(await pending).toEqual({ status: "source-changed", keys: [STORAGE_KEY] });
    expect(await readValues(repository, EMPIRE_OS_BACKUP_STORAGE_KEYS)).toEqual(
      EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => ({ key, rawValue: null, revision: 0 })),
    );
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("retains data and revisions after closing connections and reopening the database", async () => {
    const context = environment();
    expect((await context.repository().write([
      { key: STORAGE_KEY, rawValue: "persistent", expectedRevision: 0 },
    ])).status).toBe("committed");
    for (const connection of connections) connection.close();
    expect(await readValues(context.repository(), [STORAGE_KEY])).toEqual([
      { key: STORAGE_KEY, rawValue: "persistent", revision: 1 },
    ]);
  });

  it("initializes the version-one schema once and reopens it without upgrading", async () => {
    const context = environment();
    expect(await readValues(context.repository(), [STORAGE_KEY])).toEqual([
      { key: STORAGE_KEY, rawValue: null, revision: 0 },
    ]);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = context.indexedDb.open("phase-one-integration", 1);
      request.onupgradeneeded = () => reject(new Error("Existing version-one database must not upgrade."));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        connections.add(request.result);
        resolve(request.result);
      };
    });
    expect(database.version).toBe(1);
    expect(Array.from(database.objectStoreNames)).toEqual(["business-data"]);
    const transaction = database.transaction("business-data", "readonly");
    expect(transaction.objectStore("business-data").keyPath).toBe("key");
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  });
});
