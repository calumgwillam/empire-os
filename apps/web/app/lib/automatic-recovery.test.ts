import { describe, expect, it } from "vitest";
import { AutomaticRecoverySnapshots, automaticRecoveryMessage } from "./automatic-recovery";
import { buildFullBackup, retainRecoverySnapshot, runBackupRestoreTransaction, RecoverySnapshotError,
  RECOVERY_SNAPSHOTS_STORAGE_KEY, STORAGE_KEY, CHANGE_HISTORY_STORAGE_KEY, type BackupStorage } from "./backup";
import { BACKUP_VERIFICATIONS_STORAGE_KEY } from "./independent-backup";
import { decodeRecoverySnapshots, encodeRecoverySnapshots, RECOVERY_SNAPSHOT_BUDGET_BYTES,
  type RecoverySnapshot } from "./recovery-snapshot-storage";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  let attempts = 0;
  const storage = {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { attempts++; data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
  return { data, storage, attempts: () => attempts };
}
function evidence(seed: number, length: number): string {
  let state = seed;
  const characters: string[] = [];
  for (let index = 0; index < length; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    characters.push(String.fromCharCode(65 + state % 26));
  }
  return characters.join("");
}
function copy(index: number, length = 220000): RecoverySnapshot {
  const target = memory({ [STORAGE_KEY]: JSON.stringify([{ id: `record-${index}`, notes: evidence(index + 1, length) }]) });
  return { ...buildFullBackup(target.storage, "2026-10-10T08:00:00.000Z"), automatic: true };
}
function overBudget() {
  const pinned = { ...copy(20, 180000), pinned: true, externalEvidence: { receipt: "preserved" } };
  const snapshots = [copy(0), pinned, ...Array.from({ length: 6 }, (_, index) => copy(index + 1))];
  const raw = encodeRecoverySnapshots(snapshots);
  const live = JSON.stringify([{ id: "live", notes: evidence(40, 220000) }]);
  const initial: Record<string, string> = { [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw, [STORAGE_KEY]: live,
    [CHANGE_HISTORY_STORAGE_KEY]: JSON.stringify([{ id: "event", timestamp: "2026-10-10T08:00:00.000Z",
      recordType: "Capture", recordId: "live", recordTitle: "Complete unchanged history", actor: "Operator",
      action: "Updated", changes: [{ field: "notes", before: "before", after: "after" }] }]),
    [BACKUP_VERIFICATIONS_STORAGE_KEY]: "all external receipts" };
  return { ...memory(initial), initial, snapshots, pinned };
}

describe("Safe automatic snapshot replacement", () => {
  it("replaces only eligible automatic copies in an over-budget store without growing it", () => {
    const target = overBudget();
    expect(2 * target.initial[RECOVERY_SNAPSHOTS_STORAGE_KEY].length).toBeGreaterThan(RECOVERY_SNAPSHOT_BUDGET_BYTES);
    const result = retainRecoverySnapshot(target.storage, buildFullBackup(target.storage));
    expect(result).toMatchObject({ status: "replaced", overBudget: true });
    const raw = target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)!;
    expect(raw.length).toBeLessThanOrEqual(target.initial[RECOVERY_SNAPSHOTS_STORAGE_KEY].length);
    const retained = decodeRecoverySnapshots(raw);
    expect(retained[0].storage[STORAGE_KEY]).toBe(target.initial[STORAGE_KEY]);
    expect(retained).toContainEqual(target.pinned);
    expect(retained).toContainEqual(target.snapshots[0]);
    expect(retained.filter((entry) => entry.pinned !== true)).toHaveLength(5);
    for (const key of [STORAGE_KEY, CHANGE_HISTORY_STORAGE_KEY, BACKUP_VERIFICATIONS_STORAGE_KEY]) {
      expect(target.storage.getItem(key)).toBe(target.initial[key]);
    }
    expect(automaticRecoveryMessage({ ...result, checkedAt: new Date().toISOString() })).toContain("safely replacing");
  });

  it("preserves unknown unpinned evidence and never replaces the sole previously verified copy", () => {
    const verified = copy(0, 300);
    const unknown = { ...copy(1, 300), automatic: undefined, evidenceReceipt: "protected metadata" };
    const unverified = { createdAt: "2026-10-10T08:00:00.000Z", storage: { [STORAGE_KEY]: "{damaged raw evidence" } };
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: encodeRecoverySnapshots([unverified, unknown, verified]) });
    const result = retainRecoverySnapshot(target.storage, buildFullBackup(memory({ [STORAGE_KEY]: "[]" }).storage));
    expect(result.status).toBe("created");
    const retained = decodeRecoverySnapshots(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY));
    expect(retained).toContainEqual(verified);
    expect(retained).toContainEqual(unverified);
    expect(retained).toContainEqual(JSON.parse(JSON.stringify(unknown)));
  });

  it("blocks even a duplicate check when protected evidence alone exceeds budget, with no writes or warning suppression", () => {
    const pinned = { ...copy(0, 1100000), pinned: true };
    const raw = encodeRecoverySnapshots([pinned]);
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw, [STORAGE_KEY]: pinned.storage[STORAGE_KEY]! });
    const checker = new AutomaticRecoverySnapshots();
    const first = checker.check(target.storage);
    const repeated = checker.check(target.storage);
    expect(first).toMatchObject({ status: "blocked", reason: "budget", existingEvidencePreserved: true });
    expect(repeated).toMatchObject({ status: "blocked", reason: "budget", retrySuppressed: true });
    expect(automaticRecoveryMessage(repeated)).toContain("Protected recovery evidence alone");
    expect(automaticRecoveryMessage(repeated)).toContain("creation remains blocked");
    expect(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe(raw);
    expect(target.attempts()).toBe(0);
  });

  it("blocks if the last verified unpinned copy alone exceeds budget instead of deleting it", () => {
    const previous = copy(0, 1100000);
    const raw = encodeRecoverySnapshots([previous]);
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw, [STORAGE_KEY]: "[]" });
    expect(() => retainRecoverySnapshot(target.storage, buildFullBackup(target.storage))).toThrow("Protected recovery evidence alone");
    expect(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe(raw);
    expect(target.attempts()).toBe(0);
  });

  it("refuses a growing over-budget candidate even after exhausting eligible replacements", () => {
    const previous = Array.from({ length: 7 }, (_, index) => copy(index, 150000));
    const raw = encodeRecoverySnapshots(previous);
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw, [STORAGE_KEY]: copy(40, 1600000).storage[STORAGE_KEY]! });
    expect(() => retainRecoverySnapshot(target.storage, buildFullBackup(target.storage))).toThrow("No eligible non-growing replacement fits");
    expect(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe(raw);
    expect(target.attempts()).toBe(0);
  });

  it.each(["quota", "silent", "corrupt", "throw after write"] as const)("restores exact original recovery bytes on replacement failure: %s", (mode) => {
    const target = overBudget();
    const originalSet = target.storage.setItem;
    let failed = false;
    target.storage.setItem = (key, value) => {
      if (!failed) {
        failed = true;
        if (mode === "quota") {
          const error = new Error("Storage full");
          error.name = "QuotaExceededError";
          throw error;
        }
        if (mode === "silent") return;
        originalSet(key, mode === "corrupt" ? "{corrupted" : value);
        if (mode === "throw after write") throw new Error("Write failed after mutation");
        return;
      }
      originalSet(key, value);
    };
    let error: unknown;
    try {
      retainRecoverySnapshot(target.storage, buildFullBackup(target.storage));
    } catch (failure) {
      error = failure;
    }
    expect(error).toBeInstanceOf(RecoverySnapshotError);
    expect(error).toMatchObject({ reason: mode === "quota" ? "quota" : mode === "throw after write" ? "storage" : "verification",
      existingEvidencePreserved: true });
    expect(Object.fromEntries(target.data)).toEqual(target.initial);
    expect(decodeRecoverySnapshots(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY))).toEqual(target.snapshots);
  });

  it("verifies reconstruction again after writing rather than trusting only the first read-back", () => {
    const target = overBudget();
    const get = target.storage.getItem;
    const set = target.storage.setItem;
    let written = false;
    let reads = 0;
    target.storage.setItem = (key, value) => { set(key, value); written = true; };
    target.storage.getItem = (key) => {
      if (key === RECOVERY_SNAPSHOTS_STORAGE_KEY && written && ++reads === 2) return "{invalid reconstruction";
      return get(key);
    };
    expect(() => retainRecoverySnapshot(target.storage, buildFullBackup(target.storage))).toThrow("was not saved");
    expect(Object.fromEntries(target.data)).toEqual(target.initial);
  });

  it("does not use non-growing automatic replacement to bypass mandatory pinned pre-restore protection", () => {
    const target = overBudget();
    const restore = buildFullBackup(memory({ [STORAGE_KEY]: "[]" }).storage);
    const result = runBackupRestoreTransaction(target.storage, restore);
    expect(result).toMatchObject({ ok: false, writesStarted: false, rollbackFailures: [] });
    if (result.ok) throw new Error("Restore must not bypass its safety copy.");
    expect(result.error).toMatchObject({ reason: "budget" });
    expect(Object.fromEntries(target.data)).toEqual(target.initial);
  });
});

describe("Automatic recovery outcomes and retry state", () => {
  it("distinguishes created, existing and blocked outcomes and clears stale failures on a successful recheck", () => {
    const target = memory({ [STORAGE_KEY]: "[]" });
    const checker = new AutomaticRecoverySnapshots();
    target.storage.setItem(RECOVERY_SNAPSHOTS_STORAGE_KEY, "{broken");
    const blocked = checker.check(target.storage);
    expect(blocked).toMatchObject({ status: "blocked", reason: "decoding" });
    target.storage.setItem(RECOVERY_SNAPSHOTS_STORAGE_KEY, "[]");
    const created = checker.check(target.storage);
    expect(created.status).toBe("created");
    expect(automaticRecoveryMessage(created)).toContain("created and its write verified");
    const existing = checker.check(target.storage);
    expect(existing.status).toBe("existing");
    expect(automaticRecoveryMessage(existing)).toContain("no new snapshot was created");
    expect(automaticRecoveryMessage(existing)).not.toContain("failure");
  });

  it("suppresses unchanged browser quota retries, keeps the warning, and retries after storage capacity changes or explicit request", () => {
    const target = memory({ [STORAGE_KEY]: "[]", unrelated: "reserved storage" });
    const checker = new AutomaticRecoverySnapshots();
    const originalSet = target.storage.setItem;
    let attempts = 0;
    target.storage.setItem = () => {
      attempts++;
      const error = new Error("Browser storage full");
      error.name = "QuotaExceededError";
      throw error;
    };
    expect(checker.check(target.storage)).toMatchObject({ status: "blocked", reason: "quota" });
    const repeated = checker.check(target.storage);
    expect(repeated).toMatchObject({ status: "blocked", retrySuppressed: true });
    expect(automaticRecoveryMessage(repeated)).toContain("Browser localStorage QuotaExceededError");
    expect(attempts).toBe(1);
    expect(checker.check(target.storage, true)).toMatchObject({ status: "blocked", retrySuppressed: false });
    expect(attempts).toBe(2);
    target.storage.removeItem("unrelated");
    target.storage.setItem = originalSet;
    expect(checker.check(target.storage).status).toBe("created");
  });

  it("retries a previously blocked budget after business data or recovery evidence changes", () => {
    const target = memory({ [STORAGE_KEY]: copy(0, 1100000).storage[STORAGE_KEY]! });
    const checker = new AutomaticRecoverySnapshots();
    expect(checker.check(target.storage)).toMatchObject({ status: "blocked", reason: "budget" });
    expect(checker.check(target.storage)).toMatchObject({ status: "blocked", retrySuppressed: true });
    target.storage.setItem(STORAGE_KEY, "[]");
    expect(checker.check(target.storage).status).toBe("created");
    target.storage.setItem(RECOVERY_SNAPSHOTS_STORAGE_KEY, "{damaged");
    expect(checker.check(target.storage)).toMatchObject({ status: "blocked", reason: "decoding", retrySuppressed: false });
  });

  it("reports a distinct rollback failure without claiming existing evidence was preserved", () => {
    const target = memory({ [STORAGE_KEY]: "[]", [RECOVERY_SNAPSHOTS_STORAGE_KEY]: "[]" });
    const set = target.storage.setItem;
    let written = false;
    target.storage.setItem = (key) => {
      if (written) throw new Error("Rollback failed");
      written = true;
      set(key, "{corrupt");
    };
    const result = new AutomaticRecoverySnapshots().check(target.storage);
    expect(result).toMatchObject({ status: "blocked", reason: "rollback", existingEvidencePreserved: false });
    expect(automaticRecoveryMessage(result)).toContain("rollback failure");
    expect(automaticRecoveryMessage(result)).not.toContain("evidence was preserved");
  });

  it("reports storage access errors separately from decoding, quota and budget failures", () => {
    const storage: BackupStorage = {
      getItem: () => { throw new Error("Storage access denied"); },
      setItem: () => { throw new Error("Unexpected write"); },
      removeItem: () => { throw new Error("Unexpected removal"); },
    };
    const result = new AutomaticRecoverySnapshots().check(storage);
    expect(result).toMatchObject({ status: "blocked", reason: "storage", existingEvidencePreserved: false });
    expect(automaticRecoveryMessage(result)).toContain("access/write failure");
  });
});
