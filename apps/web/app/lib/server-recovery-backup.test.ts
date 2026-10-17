import { webcrypto } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { readSnapshot } = vi.hoisted(() => ({ readSnapshot: vi.fn() }));
vi.mock("server-only", () => ({}));
// Test archive mechanics independently of source approval. A separate test
// exercises the real, unmodified authority gate without this substitution.
vi.mock("./trusted-multi-user-authority", () => ({
  createTrustedMultiUserAuthority: () => ({ readSnapshot }),
}));
import { EMPIRE_OS_BACKUP_STORAGE_KEYS, STORAGE_KEY } from "./backup";
import { runRecoveryDrill } from "./recovery-drill";
import { createServerRecoveryBackup, unattendedBackupReadiness, verifyServerRecoveryPoint,
  type ServerRecoveryArchive } from "./server-recovery-backup";
import type { DatasetSnapshot } from "./server-persistence-contract";
import { createFilesystemRecoveryArchive } from "./server-recovery-filesystem";

const tenantId = "tenant-offline-fixture";
const datasetId = "00000000-0000-4000-8000-000000000001";
const request = () => new Request("https://empire.invalid/internal");
function source(commitSequence = 1): DatasetSnapshot {
  return { datasetId, protocolVersion: 1, generation: 1, authorityRevision: 1, commitSequence,
    values: EMPIRE_OS_BACKUP_STORAGE_KEYS.map(key => ({
      key, revision: key === STORAGE_KEY ? commitSequence : 0, rawValue: key === STORAGE_KEY ? "[]" : null,
    })) };
}
function harness() {
  const objects = new Map<string, string>();
  const locks = new Set<string>();
  const archive: ServerRecoveryArchive = {
    list: vi.fn(async prefix => [...objects.keys()].filter(key => key.startsWith(prefix))),
    read: vi.fn(async key => {
      const value = objects.get(key);
      if (value === undefined) throw new Error("Missing recovery object.");
      return value;
    }),
    putIfAbsent: vi.fn(async (key, text) => {
      if (objects.has(key)) return "existing";
      objects.set(key, text);
      return "created";
    }),
    async withExclusiveLease<T>(prefix: string, operation: () => Promise<T>): Promise<T> {
      if (locks.has(prefix)) throw new Error("Another worker owns this namespace.");
      locks.add(prefix);
      try { return await operation(); } finally { locks.delete(prefix); }
    },
  };
  const alert = vi.fn(async () => {});
  const dependencies = { tenantId, datasetId, archive, alert,
    sourceForPrincipal: () => { throw new Error("No database is available in this offline test."); },
    repositoryForExecution: () => { throw new Error("No production repository is available."); },
  };
  const service = createServerRecoveryBackup(dependencies);
  return { objects, archive, alert, dependencies, service };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T20:25:00.000Z"));
  vi.stubGlobal("crypto", webcrypto);
  readSnapshot.mockReset();
  readSnapshot.mockResolvedValue({ status: "snapshot", snapshot: source() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("authorised committed-source recovery archive (offline candidate)", () => {
  it("creates an immutable sealed full recovery point that independently passes an isolated restore", async () => {
    const h = harness();
    expect(await h.service.capture(request())).toMatchObject({ status: "archive-verified", recoveryPoints: 1,
      browserCoverage: "not-established", remoteDurability: "not-established" });
    const [text] = h.objects.values();
    const verified = await verifyServerRecoveryPoint(text, tenantId, datasetId, Date.now());
    expect(verified.storeRevisions).toHaveLength(21);
    expect(verified.backup.includedStorageKeys).toHaveLength(21);
    expect(() => runRecoveryDrill(JSON.stringify(verified.backup))).not.toThrow();
    expect(h.alert).not.toHaveBeenCalled();
  });
  it("integrates authorised snapshot capture, actual private filesystem publication, read-back and isolated restoration", async () => {
    const path = await mkdtemp(join(tmpdir(), "empire-recovery-pipeline-fixture-"));
    try {
      const h = harness();
      const archive = await createFilesystemRecoveryArchive(path);
      const service = createServerRecoveryBackup({ ...h.dependencies, archive });
      const first = await service.capture(request());
      expect(first.status).toBe("archive-verified");
      if (!("key" in first) || typeof first.key !== "string") throw new Error("Expected an archived fixture recovery point.");
      const original = await archive.read(first.key);
      readSnapshot.mockResolvedValue({ status: "snapshot", snapshot: source(2) });
      expect(await service.capture(request())).toMatchObject({ status: "archive-verified", recoveryPoints: 2 });
      expect(await archive.read(first.key)).toBe(original);
      const restored = await verifyServerRecoveryPoint(original, tenantId, datasetId, Date.now());
      expect(() => runRecoveryDrill(JSON.stringify(restored.backup))).not.toThrow();
      expect(restored.commitSequence).toBe(1);
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  });
  it("deduplicates exactly and never refreshes original verification time or overwrites a recovery point", async () => {
    const h = harness();
    await h.service.capture(request());
    const original = [...h.objects];
    vi.advanceTimersByTime(60_000);
    expect(await h.service.capture(request())).toMatchObject({ status: "archive-verified", recoveryPoints: 1 });
    expect([...h.objects]).toEqual(original);
    expect(h.archive.putIfAbsent).toHaveBeenCalledTimes(1);
    expect(readSnapshot).toHaveBeenCalledTimes(2);
  });
  it("retains every prior source revision and detects a current source not yet covered", async () => {
    const h = harness();
    await h.service.capture(request());
    const original = [...h.objects];
    readSnapshot.mockResolvedValue({ status: "snapshot", snapshot: source(2) });
    expect(await h.service.inspect(request())).toMatchObject({ status: "attention-required", reason: "backup-not-current" });
    expect(h.alert).toHaveBeenLastCalledWith(expect.objectContaining({ code: "backup-not-current" }));
    await h.service.capture(request());
    expect(h.objects.size).toBe(2);
    for (const [key, text] of original) expect(h.objects.get(key)).toBe(text);
  });
  it("reports missing and stale archives with alerts rather than claiming current protection", async () => {
    const h = harness();
    expect(await h.service.inspect(request())).toMatchObject({ reason: "backup-missing" });
    await h.service.capture(request());
    vi.advanceTimersByTime(24 * 60 * 60_000 + 1);
    expect(await h.service.inspect(request())).toMatchObject({ reason: "backup-stale" });
    expect(h.objects.size).toBe(1);
    expect(h.alert).toHaveBeenLastCalledWith(expect.objectContaining({ code: "backup-stale" }));
  });
  it("refuses a changed source under a reused commit fence rather than replacing a file", async () => {
    const h = harness();
    await h.service.capture(request());
    const original = [...h.objects];
    readSnapshot.mockResolvedValue({ status: "snapshot",
      snapshot: { ...source(), values: source().values.map(entry => entry.key === STORAGE_KEY ? { ...entry, revision: 2 } : entry) } });
    expect(await h.service.capture(request())).toMatchObject({ status: "unavailable", outcome: "unknown" });
    expect([...h.objects]).toEqual(original);
    expect(h.alert).toHaveBeenCalledWith(expect.objectContaining({ code: "backup-failed" }));
  });
  it.each(["incomplete", "invalid-content", "empty", "foreign-tenant-data"] as const)("refuses %s sources or archive scopes", async mode => {
    const h = harness();
    const snapshot = source();
    if (mode === "foreign-tenant-data") {
      await h.service.capture(request());
      const [text] = h.objects.values();
      await expect(verifyServerRecoveryPoint(text, "tenant-other", datasetId, Date.now())).rejects.toThrow("scope");
      return;
    }
    const values = mode === "incomplete" ? snapshot.values.slice(1)
      : mode === "empty" ? snapshot.values.map(entry => ({ ...entry, rawValue: null, revision: 0 }))
        : snapshot.values.map(entry => entry.key === STORAGE_KEY ? { ...entry, rawValue: "{broken" } : entry);
    readSnapshot.mockResolvedValue({ status: "snapshot", snapshot: { ...snapshot, values } });
    expect(await h.service.capture(request())).toMatchObject({ status: "unavailable" });
    expect(h.archive.putIfAbsent).not.toHaveBeenCalled();
    expect(h.objects.size).toBe(0);
  });
  it("detects corruption and future timestamps independently and preserves damaged evidence", async () => {
    const h = harness();
    await h.service.capture(request());
    const [key, text] = [...h.objects][0];
    const corrupt = text.replace('"envelopeSha256":"', '"envelopeSha256":"bad');
    h.objects.set(key, corrupt);
    expect(await h.service.capture(request())).toMatchObject({ status: "unavailable" });
    expect(h.objects.get(key)).toBe(corrupt);
    expect(h.archive.putIfAbsent).toHaveBeenCalledTimes(1);
    await expect(verifyServerRecoveryPoint(text, tenantId, datasetId, Date.now() - 1)).rejects.toThrow("timestamp");
  });
  it("fails read-back and alert delivery explicitly without manufacturing a successful receipt", async () => {
    const h = harness();
    vi.mocked(h.archive.read).mockRejectedValue(new Error("Read-back unavailable."));
    h.alert.mockRejectedValue(new Error("Alert service unavailable."));
    expect(await h.service.capture(request())).toMatchObject({ status: "unavailable", message: expect.stringContaining("alert delivery") });
    expect(h.objects.size).toBe(1);
  });
  it("requires byte-exact read-back for a newly created recovery object, not just a parseable checksum", async () => {
    const h = harness();
    vi.mocked(h.archive.read).mockImplementation(async key => `\n${h.objects.get(key)}`);
    expect(await h.service.capture(request())).toMatchObject({ status: "unavailable", failure: "archive-readback" });
    expect(h.alert).toHaveBeenCalledWith(expect.objectContaining({ failure: "archive-readback" }));
  });
  it("reconciles a lost write acknowledgement on the next run without overwriting or duplicate versions", async () => {
    const h = harness();
    vi.mocked(h.archive.putIfAbsent).mockImplementationOnce(async (key, text) => {
      h.objects.set(key, text);
      throw new Error("Acknowledgement lost.");
    });
    expect(await h.service.capture(request())).toMatchObject({ status: "unavailable", outcome: "unknown" });
    expect(await h.service.capture(request())).toMatchObject({ status: "archive-verified" });
    expect(h.archive.putIfAbsent).toHaveBeenCalledTimes(1);
  });
  it("caps retention at 32 immutable points without deleting or overwriting any of them", async () => {
    const h = harness();
    for (let index = 1; index <= 32; index++) {
      readSnapshot.mockResolvedValue({ status: "snapshot", snapshot: source(index) });
      expect(await h.service.capture(request())).toMatchObject({ status: "archive-verified" });
    }
    const original = [...h.objects];
    readSnapshot.mockResolvedValue({ status: "snapshot", snapshot: source(33) });
    expect(await h.service.capture(request())).toMatchObject({ status: "unavailable" });
    expect([...h.objects]).toEqual(original);
    expect(h.archive.putIfAbsent).toHaveBeenCalledTimes(32);
  }, 30_000);
  it("refuses overlapping workers through the shared archive lease", async () => {
    const h = harness();
    let release: (() => void) | undefined;
    vi.mocked(h.archive.list).mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve([]);
    }));
    const first = h.service.capture(request());
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const other = createServerRecoveryBackup(h.dependencies);
    expect(await other.capture(request())).toMatchObject({ status: "unavailable" });
    release?.();
    expect(await first).toMatchObject({ status: "archive-verified" });
  });
  it("never touches the archive on refused authority and cannot approve unattended operation", async () => {
    const h = harness();
    readSnapshot.mockResolvedValue({ status: "unauthorized", reason: "forbidden" });
    expect(await h.service.capture(request())).toMatchObject({ status: "unauthorized" });
    expect(h.archive.list).not.toHaveBeenCalled();
    expect(h.archive.putIfAbsent).not.toHaveBeenCalled();
    expect(unattendedBackupReadiness()).toMatchObject({ status: "blocked", missing: expect.arrayContaining([
      "approved-durable-browser-to-server-synchronisation", "approved-noninteractive-backup-service-identity",
    ]) });
  });
});
