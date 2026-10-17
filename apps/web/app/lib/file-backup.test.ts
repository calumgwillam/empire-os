import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFullBackup, EMPIRE_OS_BACKUP_STORAGE_KEYS, STORAGE_KEY, RECOVERY_SNAPSHOTS_STORAGE_KEY,
  type BackupStorage,
} from "./backup";
import {
  AUTOMATIC_BACKUP_PREFIX, AutomaticFileBackups, inspectBackupDirectory, MAX_BACKUP_FILE_BYTES,
  type BackupDirectory, type BackupFileHandle,
} from "./file-backup";
import { sealFullBackup, verifyBackupIntegrity } from "./verified-backup";
import { runRecoveryDrill } from "./recovery-drill";
import { RESTORE_INTERRUPTION_STORAGE_KEY } from "./browser-write-fence";

const NOW = Date.parse("2026-10-17T18:30:00.000Z");
function memory() {
  const data = new Map<string, string>([[STORAGE_KEY, '[{"id":"retained","notes":"Business evidence"}]']]);
  const writes: string[] = [];
  const storage: BackupStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); data.set(key, value); },
    removeItem: key => { writes.push(key); data.delete(key); },
  };
  return { data, storage, writes };
}
function folder() {
  const files = new Map<string, string>();
  const writes: string[] = [];
  const control = {
    permission: "granted" as PermissionState,
    failure: "" as "" | "write" | "close" | "abort" | "silent" | "read",
    onWrite: () => {},
  };
  const directory: BackupDirectory = {
    kind: "directory", name: "Explicitly approved test folder",
    queryPermission: vi.fn(async () => control.permission),
    async getFileHandle(name, options): Promise<BackupFileHandle> {
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException("Missing file.", "NotFoundError");
        files.set(name, "");
      }
      return {
        kind: "file",
        async getFile() {
          if (control.failure === "read") throw new Error("Read failed.");
          const text = files.get(name)!;
          return { size: new TextEncoder().encode(text).byteLength, text: async () => text };
        },
        async createWritable() {
          let pending = "";
          return {
            async write(text) {
              writes.push(name);
              control.onWrite();
              if (control.failure === "write" || control.failure === "abort") throw new DOMException("Disk full.", "QuotaExceededError");
              pending = text;
            },
            async close() {
              if (control.failure === "close") throw new Error("Close failed.");
              files.set(name, control.failure === "silent" ? pending.slice(0, -10) : pending);
            },
            async abort() {
              if (control.failure === "abort") throw new Error("Abort failed.");
            },
          };
        },
      };
    },
    async *entries() { for (const name of files.keys()) yield [name, { kind: "file" }]; },
    async isSameEntry(other) { return other === directory; },
  };
  return { directory, files, control, writes };
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("navigator", {
    locks: { request: async (_name: string, _options: unknown, run: (lock: unknown) => Promise<unknown>) => run({}) },
  });
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("automatic append-only approved-folder backups (offline file adapter)", () => {
  it("writes, closes, rereads, hashes and drills a full recovery point without changing any browser store", async () => {
    const target = memory();
    const destination = folder();
    const original = [...target.data];
    const result = await new AutomaticFileBackups().check(destination.directory, target.storage);
    expect(result).toMatchObject({ status: "created", currentDataCovered: true, verifiedRecoveryPoints: 1, damagedFiles: 0 });
    expect(destination.files.size).toBe(1);
    const text = destination.files.get(result.fileName!)!;
    expect(result.fileName).toMatch(/^empire-os-auto-v1-.*\.json$/);
    expect((await verifyBackupIntegrity(JSON.parse(text))).integrity).toBe("sha256-verified");
    const restored = runRecoveryDrill(text);
    expect(restored.checkedStoreCount).toBe(21);
    for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) expect(restored.restored.storage[key]).toBe(target.storage.getItem(key));
    expect([...target.data]).toEqual(original);
    expect(target.writes).toEqual([]);
  });
  it("does not duplicate unchanged current files, but reopens and verifies the copy on every check", async () => {
    const destination = folder();
    const target = memory();
    const controller = new AutomaticFileBackups();
    const first = await controller.check(destination.directory, target.storage);
    const again = await controller.check(destination.directory, target.storage);
    expect(again).toMatchObject({ status: "current", fileName: first.fileName, verifiedRecoveryPoints: 1 });
    expect(destination.writes).toHaveLength(1);
    destination.files.set(first.fileName!, "{damaged");
    expect(await controller.check(destination.directory, target.storage))
      .toMatchObject({ status: "created", damagedFiles: 1, verifiedRecoveryPoints: 1 });
    expect(destination.files.get(first.fileName!)).toBe("{damaged");
  });
  it("preserves every previous point after edits and accidental business-data deletion", async () => {
    const target = memory();
    const destination = folder();
    const controller = new AutomaticFileBackups();
    await controller.check(destination.directory, target.storage);
    const before = new Map(destination.files);
    target.data.set(STORAGE_KEY, "[]");
    expect(await controller.check(destination.directory, target.storage)).toMatchObject({ status: "created", verifiedRecoveryPoints: 2 });
    for (const [name, text] of before) expect(destination.files.get(name)).toBe(text);
    expect(runRecoveryDrill([...before.values()][0]).restored.storage[STORAGE_KEY]).toContain("Business evidence");
    target.data.clear();
    expect(await controller.check(destination.directory, target.storage))
      .toMatchObject({ status: "empty", verifiedRecoveryPoints: 2, currentDataCovered: false });
    expect(destination.files.size).toBe(2);
  });
  it("renews stale coverage without modifying a stale verified point", async () => {
    const target = memory();
    const destination = folder();
    const controller = new AutomaticFileBackups();
    const first = await controller.check(destination.directory, target.storage);
    const original = destination.files.get(first.fileName!);
    vi.setSystemTime(NOW + 8 * 86400000);
    expect(await controller.check(destination.directory, target.storage)).toMatchObject({ status: "created", verifiedRecoveryPoints: 2 });
    expect(destination.files.get(first.fileName!)).toBe(original);
  });
  it.each(["write", "close", "abort", "silent", "read"] as const)(
    "injects %s failures without replacing known-good files or touching business records", async mode => {
      const target = memory();
      const destination = folder();
      const controller = new AutomaticFileBackups();
      const first = await controller.check(destination.directory, target.storage);
      const original = destination.files.get(first.fileName!);
      target.data.set(STORAGE_KEY, '[{"id":"newer"}]');
      destination.control.failure = mode;
      await expect(controller.check(destination.directory, target.storage)).rejects.toThrow();
      expect(destination.files.get(first.fileName!)).toBe(original);
      expect(target.storage.getItem(STORAGE_KEY)).toBe('[{"id":"newer"}]');
      expect(target.writes).toEqual([]);
      destination.control.failure = "";
      expect(await controller.check(destination.directory, target.storage))
        .toMatchObject({ status: mode === "read" ? "current" : "created", currentDataCovered: true });
    },
  );
  it.each(["prompt", "denied"] as const)("does not prompt, write or claim success if permission is %s", async permission => {
    const destination = folder();
    destination.control.permission = permission;
    await expect(new AutomaticFileBackups().check(destination.directory, memory().storage)).rejects.toThrow("permission");
    expect(destination.files.size).toBe(0);
  });
  it("reports post-capture changes as uncovered, not a success-shaped current-data backup", async () => {
    const target = memory();
    const destination = folder();
    destination.control.onWrite = () => target.data.set(STORAGE_KEY, '[{"id":"newer-during-file-write"}]');
    expect(await new AutomaticFileBackups().check(destination.directory, target.storage))
      .toMatchObject({ status: "created", currentDataCovered: false });
    expect([...destination.files.values()][0]).not.toContain("newer-during-file-write");
  });
  it("never auto-writes corrupted source data or an interrupted-restore projection", async () => {
    const target = memory();
    const destination = folder();
    target.data.set(STORAGE_KEY, "{damaged");
    await expect(new AutomaticFileBackups().check(destination.directory, target.storage)).rejects.toThrow();
    expect(destination.files.size).toBe(0);
    target.data.set(RESTORE_INTERRUPTION_STORAGE_KEY, "interrupted");
    await expect(new AutomaticFileBackups().check(destination.directory, target.storage)).rejects.toThrow("interrupted");
  });
  it("does not depend on local recovery snapshot quota, and never deletes that evidence", async () => {
    const target = memory();
    target.data.set(RECOVERY_SNAPSHOTS_STORAGE_KEY, "damaged local history");
    const destination = folder();
    expect(await new AutomaticFileBackups().check(destination.directory, target.storage)).toMatchObject({ status: "created" });
    expect(target.data.get(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe("damaged local history");
  });
  it("refuses filename collision rather than opening an existing file for writing", async () => {
    vi.stubGlobal("crypto", { subtle: webcrypto.subtle, randomUUID: () => "fixed-unique-suffix" });
    const destination = folder();
    const target = memory();
    const controller = new AutomaticFileBackups();
    const first = await controller.check(destination.directory, target.storage);
    const saved = destination.files.get(first.fileName!);
    target.data.set(STORAGE_KEY, '[{"id":"new-value"}]');
    await expect(controller.check(destination.directory, target.storage)).rejects.toThrow("overwriting");
    expect(destination.files.get(first.fileName!)).toBe(saved);
    expect(destination.writes).toHaveLength(1);
  });
  it("refuses overlapping checks before any second write is submitted", async () => {
    const destination = folder();
    const controller = new AutomaticFileBackups();
    const pending = controller.check(destination.directory, memory().storage);
    await expect(controller.check(destination.directory, memory().storage)).rejects.toThrow("already running");
    await expect(pending).resolves.toMatchObject({ status: "created" });
    expect(destination.writes).toHaveLength(1);
  });
  it("refuses missing cross-tab locking or a lock held by another participating tab", async () => {
    const destination = folder();
    vi.stubGlobal("navigator", {});
    await expect(new AutomaticFileBackups().check(destination.directory, memory().storage)).rejects.toThrow("locking");
    vi.stubGlobal("navigator", {
      locks: { request: async (_name: string, _options: unknown, run: (lock: unknown) => Promise<unknown>) => run(null) },
    });
    await expect(new AutomaticFileBackups().check(destination.directory, memory().storage)).rejects.toThrow("Another browser tab");
    expect(destination.files.size).toBe(0);
  });
  it("detects incomplete, unsealed, future-dated and corrupt files, while ignoring unrelated folder contents", async () => {
    const destination = folder();
    destination.files.set("unrelated-private-file.json", "never parsed");
    destination.files.set(`${AUTOMATIC_BACKUP_PREFIX}truncated.json`, "{broken");
    destination.files.set(`${AUTOMATIC_BACKUP_PREFIX}unsealed.json`, JSON.stringify(buildFullBackup(memory().storage)));
    destination.files.set(`${AUTOMATIC_BACKUP_PREFIX}future.json`, JSON.stringify(
      await sealFullBackup(buildFullBackup(memory().storage, new Date(NOW + 1).toISOString()))));
    const inspection = await inspectBackupDirectory(destination.directory, NOW);
    expect(inspection.points).toHaveLength(0);
    expect(inspection.failures).toHaveLength(3);
    expect(destination.files.get("unrelated-private-file.json")).toBe("never parsed");
    expect(destination.writes).toEqual([]);
  });
  it("stops before unbounded directory inspection and preserves all entries", async () => {
    const destination = folder();
    for (let index = 0; index < 1001; index++) destination.files.set(`${AUTOMATIC_BACKUP_PREFIX}${index}`, "raw");
    await expect(inspectBackupDirectory(destination.directory, NOW)).rejects.toThrow("inspection limit");
    expect(destination.files.size).toBe(1001);
    expect(destination.writes).toEqual([]);
  });
  it("does not read oversized files into memory", async () => {
    const destination = folder();
    const text = vi.fn(async () => "not read");
    const oversized: BackupDirectory = {
      ...destination.directory,
      async *entries() { yield [`${AUTOMATIC_BACKUP_PREFIX}huge.json`, { kind: "file" }]; },
      async getFileHandle() {
        return { kind: "file", getFile: async () => ({ size: MAX_BACKUP_FILE_BYTES + 1, text }),
          createWritable: async () => { throw new Error("Forbidden."); } };
      },
    };
    const inspection = await inspectBackupDirectory(oversized, NOW);
    expect(inspection.failures).toHaveLength(1);
    expect(text).not.toHaveBeenCalled();
  });
});
