import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFullBackup, EMPIRE_OS_BACKUP_STORAGE_KEYS, STORAGE_KEY, validateEmpireOsBackup,
  runBackupRestoreTransaction, type BackupStorage,
} from "./backup";
import {
  assertRestoreReviewFence, buildVerifiedFullBackup, captureRestoreReviewFence, sealFullBackup, verifyBackupIntegrity,
} from "./verified-backup";
import { verifyBackupFile } from "./independent-backup";
import { runRecoveryDrill } from "./recovery-drill";
import { RESTORE_INTERRUPTION_STORAGE_KEY } from "./browser-write-fence";

const NOW = "2026-10-17T18:30:00.000Z";
function memory() {
  const data = new Map<string, string>([[STORAGE_KEY, '[{"id":"retained","notes":"Real information"}]']]);
  const writes: string[] = [];
  const storage: BackupStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); data.set(key, value); },
    removeItem: key => { writes.push(key); data.delete(key); },
  };
  return { storage, data, writes };
}
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe("full-business-data integrity and independently readable recovery files", () => {
  it("seals all 21 exact store values and metadata without any source writes", async () => {
    const target = memory();
    const sealed = await buildVerifiedFullBackup(target.storage, NOW);
    expect(Object.keys(sealed.storage)).toEqual([...EMPIRE_OS_BACKUP_STORAGE_KEYS]);
    expect(Object.keys(sealed.integrity!.stores).sort()).toEqual([...EMPIRE_OS_BACKUP_STORAGE_KEYS].sort());
    expect(sealed.integrity?.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await verifyBackupIntegrity(JSON.parse(JSON.stringify(sealed)))).toMatchObject({ integrity: "sha256-verified" });
    expect(runRecoveryDrill(JSON.stringify(sealed)).checkedStoreCount).toBe(21);
    expect(target.writes).toEqual([]);
    expect(validateEmpireOsBackup(sealed).integrity).toEqual(sealed.integrity);
  });
  it.each([...EMPIRE_OS_BACKUP_STORAGE_KEYS])("detects changed raw bytes or null substitution for %s", async key => {
    const sealed = await buildVerifiedFullBackup(memory().storage, NOW);
    const changed = { ...sealed, storage: { ...sealed.storage, [key]: sealed.storage[key] === null ? "[]" : null } };
    await expect(verifyBackupIntegrity(changed)).rejects.toThrow();
  });
  it("detects timestamp changes, per-store hash substitution and file truncation", async () => {
    const sealed = await buildVerifiedFullBackup(memory().storage, NOW);
    await expect(verifyBackupIntegrity({ ...sealed, createdAt: "2026-10-16T18:30:00.000Z" })).rejects.toThrow("SHA-256");
    await expect(verifyBackupIntegrity({
      ...sealed, integrity: { ...sealed.integrity, stores: { ...sealed.integrity!.stores, [STORAGE_KEY]: "a".repeat(64) } },
    })).rejects.toThrow("SHA-256");
    expect(() => JSON.parse(JSON.stringify(sealed).slice(0, -20))).toThrow();
  });
  it("refuses malformed/incomplete manifests and missing stores rather than manufacturing defaults", async () => {
    const sealed = await buildVerifiedFullBackup(memory().storage, NOW);
    const missingStore = structuredClone(sealed);
    delete missingStore.storage[STORAGE_KEY];
    await expect(verifyBackupIntegrity(missingStore)).rejects.toThrow();
    for (const integrity of [{}, { ...sealed.integrity, version: 2 },
      { ...sealed.integrity, algorithm: "MD5" }, { ...sealed.integrity, stores: {} }]) {
      await expect(verifyBackupIntegrity({ ...sealed, integrity })).rejects.toThrow("manifest");
    }
    const incomplete = buildFullBackup(memory().storage, NOW);
    delete incomplete.includedStorageKeys;
    delete incomplete.storage[STORAGE_KEY];
    await expect(sealFullBackup(incomplete)).rejects.toThrow("missing business stores");
  });
  it("preserves complete and partial legacy recovery without falsely claiming embedded integrity", async () => {
    const legacy = buildFullBackup(memory().storage, NOW);
    delete legacy.includedStorageKeys;
    delete legacy.storage[EMPIRE_OS_BACKUP_STORAGE_KEYS[1]];
    expect(await verifyBackupIntegrity(legacy)).toMatchObject({ integrity: "legacy-unsealed" });
    const target = memory();
    target.data.set(EMPIRE_OS_BACKUP_STORAGE_KEYS[1], "[]");
    expect(runBackupRestoreTransaction(target.storage, legacy)).toEqual({ ok: true });
    expect(target.data.get(EMPIRE_OS_BACKUP_STORAGE_KEYS[1])).toBe("[]");
  });
  it("uses the same integrity verification for external-copy receipts, not structural parsing alone", async () => {
    const sealed = await buildVerifiedFullBackup(memory().storage, NOW);
    sealed.storage[STORAGE_KEY] = '[{"id":"tampered"}]';
    await expect(verifyBackupFile(JSON.stringify(sealed), {
      fileName: "external.json", verifier: "Reviewer", externalLocation: "User-declared independent location",
      independenceDeclared: true, nowMs: Date.parse(NOW),
    })).rejects.toThrow("SHA-256");
  });
  it("fails closed if crypto is unavailable or business strings change across asynchronous verification", async () => {
    const target = memory();
    const old = target.storage.getItem;
    let captures = 0;
    target.storage.getItem = key => {
      if (key === STORAGE_KEY && ++captures >= 3) return '[{"id":"newer"}]';
      return old(key);
    };
    await expect(buildVerifiedFullBackup(target.storage, NOW)).rejects.toThrow("changed during");
    expect(target.writes).toEqual([]);
    vi.stubGlobal("crypto", {});
    await expect(buildVerifiedFullBackup(memory().storage, NOW)).rejects.toThrow();
  });
  it("refuses to certify an interrupted restore as a new good backup", async () => {
    const target = memory();
    target.data.set(RESTORE_INTERRUPTION_STORAGE_KEY, '{"version":1}');
    await expect(buildVerifiedFullBackup(target.storage, NOW)).rejects.toThrow("interrupted");
    expect(target.writes).toEqual([]);
  });
});

describe("review-to-confirm recovery fencing", () => {
  it.each([...EMPIRE_OS_BACKUP_STORAGE_KEYS])("blocks changed %s before business writes, preserving newer data", key => {
    const target = memory();
    const backup = buildFullBackup(target.storage, NOW);
    const fence = captureRestoreReviewFence(target.storage);
    target.data.set(key, key === STORAGE_KEY ? '[{"id":"newer-valid"}]' : "[]");
    if (key === STORAGE_KEY) expect(() => assertRestoreReviewFence(target.storage, fence)).toThrow("changed since");
    const result = runBackupRestoreTransaction(target.storage, backup, () => assertRestoreReviewFence(target.storage, fence));
    expect(result).toMatchObject({ ok: false, writesStarted: false });
    expect(target.writes).toEqual([]);
    expect(target.data.get(key)).toBe(key === STORAGE_KEY ? '[{"id":"newer-valid"}]' : "[]");
  });
  it("permits an explicitly reviewed unchanged restore, never an automatic application", () => {
    const target = memory();
    const fence = captureRestoreReviewFence(target.storage);
    const backup = buildFullBackup(target.storage, NOW);
    backup.storage[STORAGE_KEY] = '[{"id":"reviewed-old-record"}]';
    expect(runBackupRestoreTransaction(target.storage, backup, () => assertRestoreReviewFence(target.storage, fence)))
      .toEqual({ ok: true });
    expect(target.data.get(STORAGE_KEY)).toBe(backup.storage[STORAGE_KEY]);
  });
});
