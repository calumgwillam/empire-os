import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { buildFullBackup, runBackupRestoreTransaction, STORAGE_KEY, type BackupStorage } from "./backup";
import { assertRestoreReviewFence, captureRestoreReviewFence, sealFullBackup, verifyBackupIntegrity } from "./verified-backup";

const page = readFileSync(new URL("../empire-dashboard-client.tsx", import.meta.url), "utf8");
const start = page.indexOf("  async function handleRestoreBackupFile(");
const end = page.indexOf("  function quarantineRecoveryWrites()", start);
if (start < 0 || end < start) throw new Error("Production file-review/confirmation handlers could not be located.");
const code = transpileModule(page.slice(start, end), {
  compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext },
}).outputText;

function harness() {
  const data = new Map<string, string>([[STORAGE_KEY, '[{"id":"current"}]']]);
  const writes: string[] = [];
  const storage: BackupStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); data.set(key, value); },
    removeItem: key => { writes.push(key); data.delete(key); },
  };
  const feedback: string[] = [];
  let reloads = 0;
  let safetyDownloads = 0;
  const context = createContext({
    window: { localStorage: storage, location: { reload: () => { reloads++; } } },
    restoreBackupPreview: null,
    restoreReviewRunRef: { current: 0 }, restoreInProgressRef: { current: false },
    restoreBackupInputRef: { current: null }, auditRestoreInProgressRef: { current: false },
    captureRestoreReviewFence, assertRestoreReviewFence, verifyBackupIntegrity, runBackupRestoreTransaction,
    summarizeBackupStores: () => [], Error,
    setRestoreBackupPreview: (value: unknown) => { context.restoreBackupPreview = value; },
    setFeedback: (value: { message: string } | null) => { if (value) feedback.push(value.message); },
    setIsRestoringBackup: () => {},
    downloadBackup: () => { safetyDownloads++; }, quarantineRecoveryWrites: () => { throw new Error("Unexpected quarantine."); },
  });
  runInContext(code, context, { timeout: 1000 });
  return {
    data, writes, storage, feedback, context,
    reloads: () => reloads, safetyDownloads: () => safetyDownloads,
    async review(text: string) {
      context.file = { name: "reviewed-backup.json", text: async () => text };
      await runInContext("handleRestoreBackupFile(file)", context, { timeout: 1000 });
    },
    confirm() { runInContext("handleConfirmRestoreBackup()", context, { timeout: 1000 }); },
  };
}
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe("actual production restore-review handlers", () => {
  it("blocks intervening valid business edits without overwriting or even starting safety downloads", async () => {
    const h = harness();
    const backup = await sealFullBackup(buildFullBackup(h.storage));
    await h.review(JSON.stringify(backup));
    expect(h.context.restoreBackupPreview).toMatchObject({ integrity: "sha256-verified" });
    h.data.set(STORAGE_KEY, '[{"id":"newer-valid"}]');
    h.confirm();
    expect(h.data.get(STORAGE_KEY)).toBe('[{"id":"newer-valid"}]');
    expect(h.writes).toEqual([]);
    expect(h.safetyDownloads()).toBe(0);
    expect(h.reloads()).toBe(0);
    expect(h.feedback.at(-1)).toContain("changed since this restore was reviewed");
  });
  it("rejects tampered SHA-256 files before showing any restore confirmation", async () => {
    const h = harness();
    const backup = await sealFullBackup(buildFullBackup(h.storage));
    backup.storage[STORAGE_KEY] = '[{"id":"tampered-but-valid"}]';
    await h.review(JSON.stringify(backup));
    expect(h.context.restoreBackupPreview).toBeNull();
    expect(h.feedback.at(-1)).toContain("SHA-256");
    expect(h.writes).toEqual([]);
  });
  it("retains explicit legacy restoration without labelling the file checksum-verified", async () => {
    const h = harness();
    const backup = buildFullBackup(h.storage);
    backup.storage[STORAGE_KEY] = '[{"id":"explicitly-reviewed-legacy"}]';
    await h.review(JSON.stringify(backup));
    expect(h.context.restoreBackupPreview).toMatchObject({ integrity: "legacy-unsealed" });
    expect(h.writes).toEqual([]);
    h.confirm();
    expect(h.data.get(STORAGE_KEY)).toBe(backup.storage[STORAGE_KEY]);
    expect(h.safetyDownloads()).toBe(1);
    expect(h.reloads()).toBe(1);
  });
  it("does not resurrect a cancelled file review after an asynchronous file read completes", async () => {
    const h = harness();
    let resolveRead: (text: string) => void = () => { throw new Error("Reader not initialised."); };
    h.context.file = {
      name: "cancelled.json", text: () => new Promise<string>(resolve => { resolveRead = resolve; }),
    };
    const pending = runInContext("handleRestoreBackupFile(file)", h.context, { timeout: 1000 });
    runInContext("handleCancelRestoreBackup()", h.context);
    resolveRead(JSON.stringify(buildFullBackup(h.storage)));
    await pending;
    expect(h.context.restoreBackupPreview).toBeNull();
    expect(h.writes).toEqual([]);
  });
});
