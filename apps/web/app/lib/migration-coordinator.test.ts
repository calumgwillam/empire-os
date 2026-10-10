import { IDBFactory as FakeIDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { CONVERSION_STORAGE_KEY, EMPIRE_OS_BACKUP_STORAGE_KEYS, STORAGE_KEY, type BackupStorage } from "./backup";
import {
  IndexedDbMigrationCoordinator, type MigrationResult, type MigrationState,
} from "./migration-coordinator";

function state(result: MigrationResult): MigrationState {
  if (!("state" in result)) throw new Error(`Expected migration state, got ${JSON.stringify(result)}.`);
  return result.state;
}

function legacy() {
  const values = new Map<string, string>([[STORAGE_KEY, ' [ { "id": "legacy", "unknown": "\\u0061" } ] ']]);
  const storage: BackupStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn(() => { throw new Error("Legacy writes are forbidden."); }),
    removeItem: vi.fn(() => { throw new Error("Legacy removal is forbidden."); }),
  };
  return { values, storage };
}

function context() {
  const factory = new FakeIDBFactory();
  return { factory, coordinator: () => new IndexedDbMigrationCoordinator(factory, "migration-test") };
}

async function stage(coordinator: IndexedDbMigrationCoordinator, source: BackupStorage) {
  const initial = state(await coordinator.inspect());
  const preparing = state(await coordinator.begin(initial));
  return state(await coordinator.capture(preparing, source));
}

describe("Durable migration preparation and verification", () => {
  it("stages and verifies all 21 exact values without changing legacy or the Phase 1 database", async () => {
    const { coordinator, factory } = context();
    const migration = coordinator();
    const { storage, values } = legacy();
    const original = [...values];
    expect(state(await migration.inspect()).phase).toBe("legacy-active");
    const verifying = await stage(migration, storage);
    expect(verifying.phase).toBe("migration-verifying");
    expect(verifying.verified).toBe(false);
    expect(verifying.snapshot?.entries).toHaveLength(21);
    expect(verifying.snapshot?.entries).toEqual(EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => ({
      key, rawValue: values.get(key) ?? null,
    })));
    const ready = state(await migration.verify(verifying, storage));
    expect(ready.phase).toBe("ready-for-activation");
    expect(ready.verified).toBe(true);
    expect(ready.revision).toBe(3);
    expect([...values]).toEqual(original);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect((await factory.databases()).map((database) => database.name)).toEqual(["migration-test"]);
  });

  it("detects a preparing attempt after interruption and fences a recovered retry", async () => {
    const { coordinator } = context();
    const first = coordinator();
    const preparing = state(await first.begin(state(await first.inspect())));
    const reopened = coordinator();
    expect(state(await reopened.inspect())).toEqual(preparing);
    expect((await reopened.begin(preparing)).status).toBe("blocked");
    const recovery = state(await reopened.requireRecovery(preparing));
    expect(recovery.phase).toBe("recovery-required");
    const retry = state(await reopened.begin(recovery));
    expect(retry.generation).toBe(preparing.generation + 1);
    expect((await first.capture(preparing, legacy().storage)).status).toBe("stale");
  });

  it("retains a verifying snapshot after interruption and verifies on a reopened coordinator", async () => {
    const { coordinator } = context();
    const { storage } = legacy();
    const verifying = await stage(coordinator(), storage);
    expect(state(await coordinator().inspect())).toEqual(verifying);
    const ready = state(await coordinator().verify(verifying, storage));
    expect(ready.phase).toBe("ready-for-activation");
    expect(ready.snapshot).toEqual(verifying.snapshot);
  });

  it("allows only one concurrent migration attempt using the same durable fence", async () => {
    const { coordinator } = context();
    const first = coordinator();
    const initial = state(await first.inspect());
    const results = await Promise.all([first.begin(initial), coordinator().begin(initial)]);
    expect(results.map((result) => result.status).sort()).toEqual(["saved", "stale"]);
    expect(state(await first.inspect()).generation).toBe(1);
  });

  it("fences concurrent verification and refuses an obsolete revision within one generation", async () => {
    const { coordinator } = context();
    const { storage } = legacy();
    const verifying = await stage(coordinator(), storage);
    const results = await Promise.all([
      coordinator().verify(verifying, storage), coordinator().verify(verifying, storage),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["saved", "stale"]);
    expect((await coordinator().requireRecovery(verifying)).status).toBe("stale");
  });

  it("blocks changed source data and allows a new generation to capture the current source", async () => {
    const migration = context().coordinator();
    const { storage, values } = legacy();
    const verifying = await stage(migration, storage);
    values.set(STORAGE_KEY, '[{"id":"changed"}]');
    const blocked = state(await migration.verify(verifying, storage));
    expect(blocked.phase).toBe("migration-blocked");
    expect(blocked.verified).toBe(false);
    expect(blocked.snapshot).toEqual(verifying.snapshot);
    const preparing = state(await migration.begin(blocked));
    const current = state(await migration.capture(preparing, storage));
    expect(state(await migration.verify(current, storage)).phase).toBe("ready-for-activation");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("preserves malformed legacy bytes and records capture failure durably", async () => {
    const { coordinator } = context();
    const migration = coordinator();
    const { storage, values } = legacy();
    const preparing = state(await migration.begin(state(await migration.inspect())));
    values.set(STORAGE_KEY, "{broken");
    const blocked = state(await migration.capture(preparing, storage));
    expect(blocked.phase).toBe("migration-blocked");
    expect(blocked.reason).toContain("Legacy capture failed");
    expect(state(await coordinator().inspect())).toEqual(blocked);
    expect(values.get(STORAGE_KEY)).toBe("{broken");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("blocks failed validation rather than granting readiness", async () => {
    const migration = context().coordinator();
    const { storage, values } = legacy();
    const verifying = await stage(migration, storage);
    values.set(STORAGE_KEY, "[null]");
    const result = await migration.verify(verifying, storage);
    expect(result.status).toBe("blocked");
    expect(state(result).verified).toBe(false);
    expect(state(result).phase).toBe("migration-blocked");
  });

  it("repeated verification preserves exact snapshot evidence but advances the transition revision", async () => {
    const migration = context().coordinator();
    const { storage } = legacy();
    const verifying = await stage(migration, storage);
    const ready = state(await migration.verify(verifying, storage));
    const again = state(await migration.verify(ready, storage));
    expect(again.snapshot).toEqual(ready.snapshot);
    expect(again.generation).toBe(ready.generation);
    expect(again.revision).toBe(ready.revision + 1);
    expect(again.phase).toBe("ready-for-activation");
  });

  it("never activates, even with a complete verified snapshot", async () => {
    const migration = context().coordinator();
    const { storage } = legacy();
    const verifying = await stage(migration, storage);
    const ready = state(await migration.verify(verifying, storage));
    const result = await migration.requestActivation(ready);
    expect(result.status).toBe("blocked");
    expect(state(result).phase).toBe("migration-blocked");
    expect(state(result).reason).toContain("older application versions");
    expect(state(result).snapshot).toEqual(ready.snapshot);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("refuses premature verification and activation from legacy-active", async () => {
    const migration = context().coordinator();
    const initial = state(await migration.inspect());
    expect((await migration.verify(initial, legacy().storage)).status).toBe("blocked");
    expect(state(await migration.inspect())).toEqual(initial);
    expect((await migration.requestActivation(initial)).status).toBe("blocked");
  });

  it("retains snapshot evidence when explicitly recovering an abandoned attempt", async () => {
    const migration = context().coordinator();
    const { storage } = legacy();
    const verifying = await stage(migration, storage);
    const recovery = state(await migration.requireRecovery(verifying));
    expect(recovery.snapshot).toEqual(verifying.snapshot);
    const retry = state(await migration.begin(recovery));
    expect(retry.snapshot).toEqual(verifying.snapshot);
    expect(retry.verified).toBe(false);
  });

  it("rejects a complete snapshot with broken recovery relationships", async () => {
    const migration = context().coordinator();
    const { storage, values } = legacy();
    values.set(CONVERSION_STORAGE_KEY, JSON.stringify([{
      id: "delivery", targetType: "Convert to Action", deliveryLeadId: "missing",
    }]));
    const verifying = await stage(migration, storage);
    const result = await migration.verify(verifying, storage);
    expect(result.status).toBe("blocked");
    expect(state(result).reason).toContain("inconsistent record references");
    expect(state(result).snapshot).toEqual(verifying.snapshot);
  });

  it("rolls back aborted transition metadata and retries using the original fence", async () => {
    const native = new FakeIDBFactory();
    let interrupt = true;
    let staged = false;
    const factory: Pick<IDBFactory, "open"> = {
      open(name, version) {
        const request = native.open(name, version);
        request.addEventListener("success", () => {
          const database = request.result;
          const transact = database.transaction.bind(database);
          vi.spyOn(database, "transaction").mockImplementation((stores, mode, options) => {
            const transaction = transact(stores, mode, options);
            if (mode === "readwrite" && interrupt) {
              const store = transaction.objectStore("migration-state");
              const put = store.put.bind(store);
              vi.spyOn(store, "put").mockImplementation((value, key) => {
                const write = put(value, key);
                write.addEventListener("success", () => {
                  staged = true;
                  transaction.abort();
                });
                return write;
              });
            }
            return transaction;
          });
        });
        return request;
      },
    };
    const migration = new IndexedDbMigrationCoordinator(factory, "aborted-migration");
    const initial = state(await migration.inspect());
    expect((await migration.begin(initial)).status).toBe("storage-failed");
    expect(staged).toBe(true);
    expect(state(await migration.inspect())).toEqual(initial);
    interrupt = false;
    expect(state(await migration.begin(initial)).phase).toBe("migration-preparing");
  });

  it("cannot turn changed source data into readiness on a repeated verification", async () => {
    const migration = context().coordinator();
    const { storage, values } = legacy();
    const verifying = await stage(migration, storage);
    const ready = state(await migration.verify(verifying, storage));
    values.set(STORAGE_KEY, '[{"id":"later-edit"}]');
    expect(state(await migration.verify(ready, storage)).phase).toBe("migration-blocked");
    expect((await migration.requestActivation(ready)).status).toBe("stale");
  });

  it("reports unavailable staging storage explicitly without changing legacy", async () => {
    const migration = new IndexedDbMigrationCoordinator({
      open() { throw new Error("Storage access denied."); },
    });
    expect(await migration.inspect()).toEqual({
      status: "storage-failed", error: { name: "Error", message: "Storage access denied." },
    });
  });

  it("does not treat malformed durable metadata as a fresh legacy-active state", async () => {
    const { factory, coordinator } = context();
    await coordinator().inspect();
    const original = { version: 99, phase: "ready-for-activation" };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open("migration-test", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve(open.result);
    });
    const transaction = database.transaction("migration-state", "readwrite");
    transaction.objectStore("migration-state").put(original, "legacy-to-indexeddb");
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    expect((await coordinator().inspect()).status).toBe("storage-failed");
    expect((await coordinator().begin({ generation: 0, revision: 0 })).status).toBe("storage-failed");
    const reopened = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open("migration-test", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve(open.result);
    });
    const read = reopened.transaction("migration-state", "readonly").objectStore("migration-state").get("legacy-to-indexeddb");
    const persisted = await new Promise<unknown>((resolve, reject) => {
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    expect(persisted).toEqual(original);
    reopened.close();
  });

  it("reports a saved transition only after the native metadata transaction completes", async () => {
    const native = new FakeIDBFactory();
    let completed = false;
    let pendingAtCompletion = false;
    let returned = false;
    const factory: Pick<IDBFactory, "open"> = {
      open(name, version) {
        const request = native.open(name, version);
        request.addEventListener("success", () => {
          const database = request.result;
          const transact = database.transaction.bind(database);
          vi.spyOn(database, "transaction").mockImplementation((stores, mode, options) => {
            const transaction = transact(stores, mode, options);
            if (mode === "readwrite") transaction.addEventListener("complete", () => {
              completed = true;
              pendingAtCompletion = !returned;
            });
            return transaction;
          });
        });
        return request;
      },
    };
    const migration = new IndexedDbMigrationCoordinator(factory, "completion-migration");
    const initial = state(await migration.inspect());
    const result = await migration.begin(initial).then((result) => {
      returned = true;
      return result;
    });
    expect(result.status).toBe("saved");
    expect(completed).toBe(true);
    expect(pendingAtCompletion).toBe(true);
  });
});
