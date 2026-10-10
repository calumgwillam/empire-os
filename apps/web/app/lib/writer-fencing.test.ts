import { IDBFactory as FakeIDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPIRE_OS_BACKUP_STORAGE_KEYS, PROJECT_STORAGE_KEY, STORAGE_KEY } from "./backup";
import { IndexedDbPersistenceRepository, prepareLegacyImport, type StorageWrite } from "./indexeddb-persistence";
import { PreparationWriterRepository } from "./preparation-writer-repository";
import {
  checkWriterAuthority, PREPARATION_DATABASE_PREFIX, WRITER_AUTHORITY_KEY,
  type WriterAuthorityResult, type WriterCredential,
} from "./writer-fencing";

const connections = new Set<IDBDatabase>();
afterEach(() => {
  for (const database of connections) database.close();
  connections.clear();
  vi.restoreAllMocks();
});

function context(observe?: (transaction: IDBTransaction) => void) {
  const native = new FakeIDBFactory();
  const factory: Pick<IDBFactory, "open"> = {
    open(name, version) {
      const open = native.open(name, version);
      open.addEventListener("success", () => {
        const database = open.result;
        connections.add(database);
        if (observe) {
          const transact = database.transaction.bind(database);
          vi.spyOn(database, "transaction").mockImplementation((stores, mode, options) => {
            const transaction = transact(stores, mode, options);
            observe(transaction);
            return transaction;
          });
        }
      });
      return open;
    },
  };
  return { native, factory, writer: () => new PreparationWriterRepository(factory, "writer-test") };
}

function credential(result: WriterAuthorityResult): WriterCredential {
  if (result.status !== "authority-saved" || result.authority.mode !== "preparation-only") {
    throw new Error(`Preparation authority missing: ${JSON.stringify(result)}`);
  }
  return { generation: result.authority.generation, revision: result.authority.revision,
    scope: result.authority.scope, mode: "preparation-only" };
}

const update: StorageWrite = { key: STORAGE_KEY, rawValue: "exact raw string", expectedRevision: 0 };

describe("Atomic participating-writer fences for isolated preparation", () => {
  it("denies missing durable authority rather than initializing permission implicitly", async () => {
    const writer = context().writer();
    expect(await writer.write([update], { generation: 0, revision: 0, scope: `${PREPARATION_DATABASE_PREFIX}writer-test`,
      mode: "preparation-only" })).toMatchObject({
      status: "authority-denied", reason: "missing-authority",
    });
    expect(await writer.read([STORAGE_KEY])).toMatchObject({
      status: "read", values: [{ key: STORAGE_KEY, rawValue: null, revision: 0 }],
    });
  });

  it("allows explicitly authorized preparation writes with exact per-store revisions", async () => {
    const writer = context().writer();
    const token = credential(await writer.changeAuthority({ generation: 0, revision: 0 }, "preparation-only"));
    expect(await writer.write([update, { key: PROJECT_STORAGE_KEY, rawValue: null, expectedRevision: 0 }], token))
      .toEqual({ status: "committed", revisions: { [STORAGE_KEY]: 1, [PROJECT_STORAGE_KEY]: 1 } });
    expect(await writer.read([STORAGE_KEY, PROJECT_STORAGE_KEY])).toMatchObject({
      status: "read", values: [
        { key: STORAGE_KEY, rawValue: update.rawValue, revision: 1 },
        { key: PROJECT_STORAGE_KEY, rawValue: null, revision: 1 },
      ],
    });
  });

  it("rejects stale generation and stale authority revision credentials", async () => {
    const writer = context().writer();
    const token = credential(await writer.changeAuthority({ generation: 0, revision: 0 }, "preparation-only"));
    expect((await writer.write([update], { ...token, generation: token.generation - 1 }))).toMatchObject({
      status: "authority-denied", reason: "stale-credential",
    });
    expect((await writer.write([update], { ...token, revision: token.revision - 1 }))).toMatchObject({
      status: "authority-denied", reason: "stale-credential",
    });
  });

  it("rejects replay of credentials from a different preparation database", async () => {
    const { factory, writer } = context();
    const first = writer();
    const second = new PreparationWriterRepository(factory, "other-scope");
    const token = credential(await first.changeAuthority({ generation: 0, revision: 0 }, "preparation-only"));
    await second.changeAuthority({ generation: 0, revision: 0 }, "preparation-only");
    expect(await second.write([update], token)).toMatchObject({
      status: "authority-denied", reason: "unsupported-storage-mode",
    });
    expect(await second.read([STORAGE_KEY])).toMatchObject({ status: "read", values: [{ revision: 0, rawValue: null }] });
  });

  it("revocation fences old writers across separate repository connections", async () => {
    const { writer } = context();
    const first = writer();
    const token = credential(await first.changeAuthority({ generation: 0, revision: 0 }, "preparation-only"));
    const revoked = await writer().changeAuthority(token, "denied");
    expect(revoked.status).toBe("authority-saved");
    expect(await first.write([update], token)).toMatchObject({ status: "authority-denied", reason: "stale-credential" });
    if (revoked.status !== "authority-saved") throw new Error("Expected revocation.");
    expect(await first.write([update], { ...revoked.authority, mode: "preparation-only" }))
      .toMatchObject({ status: "authority-denied", reason: "writers-fenced" });
  });

  it("serializes competing authority transitions and permits only one expected fence", async () => {
    const { writer } = context();
    const results = await Promise.all([
      writer().changeAuthority({ generation: 0, revision: 0 }, "preparation-only"),
      writer().changeAuthority({ generation: 0, revision: 0 }, "denied"),
    ]);
    expect(results.filter((result) => result.status === "authority-saved")).toHaveLength(1);
    expect(results.filter((result) => result.status === "authority-denied")).toMatchObject([{
      reason: "stale-credential",
    }]);
  });

  it("orders revocation before a subsequent write without a check-then-write race", async () => {
    const { writer } = context();
    const first = writer();
    const second = writer();
    const token = credential(await first.changeAuthority({ generation: 0, revision: 0 }, "preparation-only"));
    await second.read([STORAGE_KEY]);
    const revocation = second.changeAuthority(token, "denied");
    const write = first.write([update], token);
    expect((await revocation).status).toBe("authority-saved");
    expect(await write).toMatchObject({ status: "authority-denied", reason: "stale-credential" });
    expect(await first.read([STORAGE_KEY])).toMatchObject({
      status: "read", values: [{ rawValue: null, revision: 0 }],
    });
  });

  it("still rejects stale business revisions independently of valid writer authority", async () => {
    const writer = context().writer();
    const token = credential(await writer.changeAuthority({ generation: 0, revision: 0 }, "preparation-only"));
    expect((await writer.write([update], token)).status).toBe("committed");
    expect(await writer.write([update], token)).toMatchObject({
      status: "conflict", conflicts: [{ key: STORAGE_KEY, expectedRevision: 0, actualRevision: 1 }],
    });
  });

  it("cannot provision preparation authority in the original Phase 1 database", async () => {
    const repository = new IndexedDbPersistenceRepository(context().factory);
    expect(await repository.updatePreparationAuthority({ generation: 0, revision: 0 }, "preparation-only"))
      .toMatchObject({ status: "authority-denied", reason: "unsupported-storage-mode" });
    expect(await repository.writeWithAuthority([update], {
      generation: 1, revision: 1, scope: `${PREPARATION_DATABASE_PREFIX}writer-test`, mode: "preparation-only",
    }))
      .toMatchObject({ status: "authority-denied", reason: "unsupported-storage-mode" });
  });

  it("does not allow the original unfenced write or import API to bypass preparation authority", async () => {
    const repository = new IndexedDbPersistenceRepository(context().factory, `${PREPARATION_DATABASE_PREFIX}writer-test`);
    await expect(repository.write([update])).rejects.toThrow("unguarded writes are forbidden");
    const source = { getItem: () => null };
    await expect(repository.importLegacyDataset(prepareLegacyImport(source), source))
      .rejects.toThrow("Unguarded legacy imports are forbidden");
  });

  it("never accepts an indexeddb-production credential or unsupported durable mode", () => {
    const scope = `${PREPARATION_DATABASE_PREFIX}writer-test`;
    const authority = { version: 1, generation: 1, revision: 1, scope, mode: "preparation-only" };
    expect(checkWriterAuthority(authority, { generation: 1, revision: 1, mode: "indexeddb" }))
      .toMatchObject({ status: "authority-denied", reason: "unsupported-storage-mode" });
    expect(checkWriterAuthority({ ...authority, mode: "indexeddb" }, {
      generation: 1, revision: 1, scope, mode: "preparation-only",
    })).toMatchObject({ status: "authority-denied", reason: "invalid-authority" });
  });

  it("rolls back an interrupted authority transition and does not issue permission", async () => {
    let interrupted = false;
    const { writer } = context((transaction) => {
      if (transaction.mode !== "readwrite") return;
      const store = transaction.objectStore("business-data");
      const put = store.put.bind(store);
      vi.spyOn(store, "put").mockImplementation((value, key) => {
        const request = put(value, key);
        request.addEventListener("success", () => { interrupted = true; transaction.abort(); });
        return request;
      });
    });
    const repository = writer();
    expect((await repository.changeAuthority({ generation: 0, revision: 0 }, "preparation-only")).status)
      .toBe("authority-storage-failed");
    expect(interrupted).toBe(true);
    expect(await repository.write([update], {
      generation: 1, revision: 1, scope: `${PREPARATION_DATABASE_PREFIX}writer-test`, mode: "preparation-only",
    }))
      .toMatchObject({ status: "authority-denied", reason: "missing-authority" });
  });

  it("reports authority and business success only after their transactions complete", async () => {
    let completed = 0;
    const { writer } = context((transaction) => {
      if (transaction.mode === "readwrite") {
        transaction.addEventListener("complete", () => { completed++; });
      }
    });
    const repository = writer();
    const token = credential(await repository.changeAuthority({ generation: 0, revision: 0 }, "preparation-only"));
    expect(completed).toBe(1);
    expect((await repository.write([update], token)).status).toBe("committed");
    expect(completed).toBe(2);
  });

  it("rolls back every business key when a fenced multi-key transaction aborts", async () => {
    let abortWrites = false;
    let stagedWrites = 0;
    const { writer } = context((transaction) => {
      if (!abortWrites || transaction.mode !== "readwrite") return;
      const store = transaction.objectStore("business-data");
      const put = store.put.bind(store);
      vi.spyOn(store, "put").mockImplementation((value, key) => {
        const request = put(value, key);
        request.addEventListener("success", () => {
          if (++stagedWrites === 2) transaction.abort();
        });
        return request;
      });
    });
    const repository = writer();
    const token = credential(await repository.changeAuthority({ generation: 0, revision: 0 }, "preparation-only"));
    abortWrites = true;
    const result = await repository.write([
      update, { key: PROJECT_STORAGE_KEY, rawValue: "second exact value", expectedRevision: 0 },
    ], token);
    expect(stagedWrites).toBe(2);
    expect(result.status).toBe("transaction-failed");
    expect(await repository.read([STORAGE_KEY, PROJECT_STORAGE_KEY])).toMatchObject({
      status: "read", values: [
        { key: STORAGE_KEY, rawValue: null, revision: 0 },
        { key: PROJECT_STORAGE_KEY, rawValue: null, revision: 0 },
      ],
    });
  });

  it("fails closed on an authority read error before any business put", async () => {
    let failReads = false;
    let businessPuts = 0;
    const { writer } = context((transaction) => {
      if (!failReads || transaction.mode !== "readwrite") return;
      const store = transaction.objectStore("business-data");
      vi.spyOn(store, "get").mockImplementation(() => { throw new Error("Authority access failed."); });
      vi.spyOn(store, "put").mockImplementation(() => {
        businessPuts++;
        throw new Error("Business puts must not be attempted.");
      });
    });
    const repository = writer();
    const token = credential(await repository.changeAuthority({ generation: 0, revision: 0 }, "preparation-only"));
    failReads = true;
    expect(await repository.write([update], token)).toMatchObject({
      status: "authority-denied", reason: "authority-verification-failed",
    });
    expect(businessPuts).toBe(0);
  });

  it("preserves the 21-key public data contract without exposing internal authority as business data", async () => {
    const { native, writer } = context();
    const repository = writer();
    await repository.changeAuthority({ generation: 0, revision: 0 }, "preparation-only");
    const result = await repository.read(EMPIRE_OS_BACKUP_STORAGE_KEYS);
    if (result.status !== "read") throw new Error("Read failed.");
    expect(result.values).toHaveLength(21);
    expect(result.values.every((value) => value.rawValue === null && value.revision === 0)).toBe(true);
    expect(result.values.map((value) => value.key)).not.toContain(WRITER_AUTHORITY_KEY);
    expect((await native.databases()).map((database) => database.name))
      .toEqual([`${PREPARATION_DATABASE_PREFIX}writer-test`]);
  });

  it("rejects corrupted persisted authority rather than defaulting to permission", async () => {
    const { native, writer } = context();
    const repository = writer();
    const token = credential(await repository.changeAuthority({ generation: 0, revision: 0 }, "preparation-only"));
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = native.open(token.scope, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { connections.add(request.result); resolve(request.result); };
    });
    const transaction = database.transaction("business-data", "readwrite");
    transaction.objectStore("business-data").put({
      key: WRITER_AUTHORITY_KEY, version: 1, generation: token.generation, revision: token.revision,
      scope: token.scope, mode: "indexeddb",
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    expect(await repository.write([update], token)).toMatchObject({
      status: "authority-denied", reason: "invalid-authority",
    });
    expect(await repository.read([STORAGE_KEY])).toMatchObject({
      status: "read", values: [{ rawValue: null, revision: 0 }],
    });
  });

  it("does not allow caller mutation during database opening to change fenced write contents", async () => {
    const { writer } = context();
    const first = writer();
    const token = credential(await first.changeAuthority({ generation: 0, revision: 0 }, "preparation-only"));
    const updates = [{ ...update }];
    const originalToken = { ...token };
    const pending = writer().write(updates, originalToken);
    updates[0].rawValue = "mutated-after-call";
    originalToken.revision++;
    expect((await pending).status).toBe("committed");
    expect(await first.read([STORAGE_KEY])).toMatchObject({
      status: "read", values: [{ rawValue: update.rawValue, revision: 1 }],
    });
  });
});
