import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { openBackupDestination } from "./backup-destination";
import type { BackupDirectory } from "./file-backup";

function approvedFolder(): BackupDirectory {
  const directory: BackupDirectory = {
    kind: "directory", name: "Approved test directory",
    queryPermission: async () => "granted",
    getFileHandle: async () => { throw new Error("No file access in destination metadata tests."); },
    async *entries() { yield ["unrelated", { kind: "directory" }]; },
    isSameEntry: async other => other === directory,
  };
  return directory;
}

describe("backup destination metadata isolation", () => {
  it("opens only its own metadata database, with no destination or business data by default", async () => {
    const factory = new IDBFactory();
    const repository = await openBackupDestination(factory);
    expect(await repository.load()).toBeNull();
    expect(await factory.databases()).toEqual([{ name: "empire-os-backup-destination-v1", version: 1 }]);
    await repository.forget();
    expect(await repository.load()).toBeNull();
    repository.close();
  });
  it("does not save destinations without previously granted permission", async () => {
    const factory = new IDBFactory();
    const repository = await openBackupDestination(factory);
    await expect(repository.save({ ...approvedFolder(), queryPermission: async () => "prompt" })).rejects.toThrow("user-approved");
    expect(await repository.load()).toBeNull();
    repository.close();
  });
  it("surfaces unsupported handle cloning instead of claiming future automatic configuration", async () => {
    const factory = new IDBFactory();
    const repository = await openBackupDestination(factory);
    // fake-indexeddb cannot clone browser-native FileSystemDirectoryHandles.
    // A method-bearing stand-in MUST fail; production UI reports session-only approval.
    await expect(repository.save(approvedFolder())).rejects.toThrow();
    expect(await repository.load()).toBeNull();
    repository.close();
  });
  it("reports corrupt saved configuration without deleting evidence, then forgets only approval when explicitly requested", async () => {
    const factory = new IDBFactory();
    const repository = await openBackupDestination(factory);
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("empire-os-backup-destination-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = raw.transaction("approved-directory", "readwrite");
      tx.objectStore("approved-directory").put({ kind: "directory", name: "missing handle methods" }, "directory");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await expect(repository.load()).rejects.toThrow("malformed");
    await expect(repository.load()).rejects.toThrow("malformed");
    await repository.forget();
    expect(await repository.load()).toBeNull();
    expect(await factory.databases()).toHaveLength(1);
    raw.close();
    repository.close();
  });
});
