import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFullBackup, retainRecoverySnapshot, RecoverySnapshotError, RECOVERY_SNAPSHOTS_STORAGE_KEY, STORAGE_KEY,
  type BackupStorage,
} from "./backup";
import { AutomaticRecoverySnapshots } from "./automatic-recovery";
import {
  decodeRecoverySnapshots, encodeRecoverySnapshots, RECOVERY_SNAPSHOT_BUDGET_BYTES, type RecoverySnapshot,
} from "./recovery-snapshot-storage";

function memory(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  const attempts: number[] = [];
  const limits = { bytes: Infinity, silent: false, afterWrite: false };
  const storage: BackupStorage = {
    getItem: key => data.get(key) ?? null,
    setItem(key, value) {
      attempts.push(2 * (key.length + value.length));
      const total = 2 * [...data].filter(([entry]) => entry !== key)
        .reduce((sum, [entry, raw]) => sum + entry.length + raw.length, key.length + value.length);
      if (total > limits.bytes) throw new DOMException("Actual fixture quota exceeded.", "QuotaExceededError");
      if (limits.silent) return;
      data.set(key, value);
      if (limits.afterWrite) { limits.afterWrite = false; throw new Error("Mutation occurred before failure."); }
    },
    removeItem: key => { data.delete(key); },
  };
  return { data, storage, attempts, limits };
}
const bytes = (raw: string) => 2 * (RECOVERY_SNAPSHOTS_STORAGE_KEY.length + raw.length);
function point(id: number, length = 20000): RecoverySnapshot {
  let seed = id + 1;
  const text = Array.from({ length }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return String.fromCharCode(65 + seed % 26);
  }).join("");
  return { ...buildFullBackup(memory({ [STORAGE_KEY]: JSON.stringify([{ id: `fixture-${id}`, notes: text }]) }).storage,
    "2026-10-17T18:00:00.000Z"), automatic: true };
}
afterEach(() => vi.useRealTimers());

describe("protected-floor retention and actual localStorage quota", () => {
  it("repairs the reported 3,115,918-byte protected floor without raising the 2 MiB working allowance", () => {
    const protectedPoint = { ...point(0, 0), pinned: true, receipt: "retained recovery evidence" };
    const overhead = bytes(encodeRecoverySnapshots([protectedPoint]));
    protectedPoint.storage[STORAGE_KEY] = JSON.stringify([{ id: "fixture-0",
      notes: "P".repeat((3_115_918 - overhead) / 2) }]);
    const raw = encodeRecoverySnapshots([protectedPoint]);
    expect(bytes(raw)).toBe(3_115_918);
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw, [STORAGE_KEY]: "[]" });
    target.limits.bytes = 5 * 1024 * 1024;
    const result = retainRecoverySnapshot(target.storage, buildFullBackup(target.storage));
    expect(result).toMatchObject({ status: "created", protectedBytes: 3_115_918,
      workingBudgetBytes: 2 * 1024 * 1024, quotaLimited: false });
    const saved = target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)!;
    expect(decodeRecoverySnapshots(saved)).toContainEqual(protectedPoint);
    expect(decodeRecoverySnapshots(saved)[0].storage[STORAGE_KEY]).toBe("[]");
    expect(bytes(saved)).toBeLessThanOrEqual(3_115_918 + RECOVERY_SNAPSHOT_BUDGET_BYTES);
    expect(target.storage.getItem(STORAGE_KEY)).toBe("[]");
  });
  it("falls back through progressively smaller candidates only after atomic quota refusal, retaining protected and prior verified data", () => {
    const previous = point(0);
    const pinned = { ...point(1), pinned: true, evidence: "never remove" };
    const points = [previous, pinned, ...Array.from({ length: 5 }, (_, index) => point(index + 2))];
    const raw = encodeRecoverySnapshots(points);
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw, [STORAGE_KEY]: point(15).storage[STORAGE_KEY]! });
    const next = buildFullBackup(target.storage);
    const minimal = encodeRecoverySnapshots([{ ...next, automatic: true }, previous, pinned]);
    target.limits.bytes = bytes(minimal) + 2 * (STORAGE_KEY.length + target.storage.getItem(STORAGE_KEY)!.length);
    const result = retainRecoverySnapshot(target.storage, next);
    expect(result).toMatchObject({ status: "replaced", quotaLimited: true });
    expect(target.attempts.length).toBeGreaterThan(1);
    expect(target.attempts.every((attempt, index) => index === 0 || attempt < target.attempts[index - 1])).toBe(true);
    const saved = decodeRecoverySnapshots(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY));
    expect(saved).toEqual([{ ...next, automatic: true }, previous, pinned]);
  });
  it("reports real quota exhaustion if the minimum cannot fit and preserves original bytes without deleting for space", () => {
    const previous = point(0);
    const pinned = { ...point(1), pinned: true };
    const raw = encodeRecoverySnapshots([previous, pinned, point(2), point(3)]);
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw, [STORAGE_KEY]: point(10).storage[STORAGE_KEY]! });
    target.limits.bytes = 1;
    expect(() => retainRecoverySnapshot(target.storage, buildFullBackup(target.storage)))
      .toThrow("Previous recovery evidence was restored and verified");
    expect(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe(raw);
    expect(target.attempts.length).toBeLessThanOrEqual(3);
  });
  it("preserves corrupt evidence and refuses silent or post-mutation failures rather than retrying them as quota", () => {
    for (const mode of ["silent", "afterWrite"] as const) {
      const raw = encodeRecoverySnapshots([{ ...point(0), pinned: true }]);
      const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw, [STORAGE_KEY]: "[]" });
      target.limits[mode] = true;
      expect(() => retainRecoverySnapshot(target.storage, buildFullBackup(target.storage))).toThrow();
      expect(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe(raw);
    }
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: "{damaged-history", [STORAGE_KEY]: "[]" });
    expect(() => retainRecoverySnapshot(target.storage, buildFullBackup(target.storage))).toThrow("decoded");
    expect(target.attempts).toEqual([]);
  });
  it("does not mistake an unverified legacy match for a verified complete recovery point", () => {
    const current = buildFullBackup(memory({ [STORAGE_KEY]: "[]" }).storage);
    const legacy = { createdAt: "not-a-date", storage: current.storage, receipt: "preserve unverified evidence" };
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: encodeRecoverySnapshots([legacy]), [STORAGE_KEY]: "[]" });
    expect(retainRecoverySnapshot(target.storage, current).status).toBe("created");
    expect(decodeRecoverySnapshots(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY))).toContainEqual(legacy);
  });
  it.each(["automatic", "pinned", "duplicate", "initially absent", "matching candidate", "corrupt evidence"] as const)(
    "never rolls back over a concurrent recovery write discovered after quota refusal: %s", mode => {
    const previous = point(0);
    const protectedPoint = { ...point(1), pinned: true, receipt: "original protected evidence" };
    const originals = [previous, protectedPoint, point(2)];
    // Force duplicate compaction to attempt a write rather than returning early.
    const raw = mode === "duplicate" ? JSON.stringify(originals, null, 2) : encodeRecoverySnapshots(originals);
    const concurrent = mode === "corrupt evidence" ? "{concurrent unparsed evidence"
      : encodeRecoverySnapshots([{ ...point(3), pinned: true, receipt: "other tab evidence" }, ...originals]);
    const target = memory({ ...(mode === "initially absent" ? {} : { [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw }),
      [STORAGE_KEY]: mode === "duplicate" ? previous.storage[STORAGE_KEY]! : "[]" });
    const remove = vi.spyOn(target.storage, "removeItem");
    const write = vi.fn((_key: string, value: string) => {
      target.data.set(RECOVERY_SNAPSHOTS_STORAGE_KEY, mode === "matching candidate" ? value : concurrent);
      throw new DOMException("Injected concurrent quota refusal.", "QuotaExceededError");
    });
    target.storage.setItem = write;
    let failure: unknown;
    try { retainRecoverySnapshot(target.storage, buildFullBackup(target.storage), mode === "pinned"); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(RecoverySnapshotError);
    expect(failure).toMatchObject({ reason: "storage", existingEvidencePreserved: false,
      message: expect.stringContaining("Concurrent evidence was left untouched") });
    expect(write).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    const saved = target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY);
    expect(saved).toBe(mode === "matching candidate" ? write.mock.calls[0][1] : concurrent);
    if (mode !== "corrupt evidence") {
      expect(decodeRecoverySnapshots(saved)).toEqual(expect.arrayContaining([previous, protectedPoint]));
    }
    expect(target.storage.getItem(STORAGE_KEY)).toBe(mode === "duplicate" ? previous.storage[STORAGE_KEY] : "[]");
  });
  it("rechecks concurrent history before rollback after an unchanged quota inspection", () => {
    const originals = [point(0), { ...point(1), pinned: true }];
    const raw = encodeRecoverySnapshots(originals);
    const concurrent = encodeRecoverySnapshots([{ ...point(2), pinned: true }, ...originals]);
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw, [STORAGE_KEY]: "[]" });
    const get = target.storage.getItem;
    let refused = false;
    let inspections = 0;
    target.storage.getItem = key => {
      if (refused && key === RECOVERY_SNAPSHOTS_STORAGE_KEY && ++inspections === 2) {
        target.data.set(key, concurrent);
      }
      return get(key);
    };
    const write = vi.fn(() => {
      refused = true;
      throw new DOMException("Quota refusal.", "QuotaExceededError");
    });
    target.storage.setItem = write;
    expect(() => retainRecoverySnapshot(target.storage, buildFullBackup(target.storage)))
      .toThrow("Concurrent evidence was left untouched");
    expect(write).toHaveBeenCalledTimes(1);
    expect(get(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe(concurrent);
  });
  it("does not attempt rollback when history cannot be read after quota refusal", () => {
    const raw = encodeRecoverySnapshots([point(0), { ...point(1), pinned: true }]);
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw, [STORAGE_KEY]: "[]" });
    const get = target.storage.getItem;
    let refused = false;
    target.storage.getItem = key => {
      if (refused && key === RECOVERY_SNAPSHOTS_STORAGE_KEY) throw new Error("History read denied.");
      return get(key);
    };
    const write = vi.fn(() => {
      refused = true;
      throw new DOMException("Quota refusal.", "QuotaExceededError");
    });
    const remove = vi.spyOn(target.storage, "removeItem");
    target.storage.setItem = write;
    expect(() => retainRecoverySnapshot(target.storage, buildFullBackup(target.storage)))
      .toThrow("No rollback or deletion was attempted");
    expect(write).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(get(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe(raw);
  });
  it("does not grow automatic history without bound across repeated changes above a protected floor", () => {
    const pinned = { ...point(0, 0), pinned: true };
    pinned.storage[STORAGE_KEY] = JSON.stringify([{ id: "fixture-0", notes: "P".repeat(1_560_000) }]);
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: encodeRecoverySnapshots([pinned]), [STORAGE_KEY]: "[]" });
    for (let index = 0; index < 15; index++) {
      target.data.set(STORAGE_KEY, point(index + 1, 100).storage[STORAGE_KEY]!);
      const result = retainRecoverySnapshot(target.storage, buildFullBackup(target.storage));
      const saved = decodeRecoverySnapshots(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY));
      expect(saved).toContainEqual(pinned);
      expect(saved.filter(entry => entry.pinned !== true).length).toBeLessThanOrEqual(5);
      expect(result.estimatedBytes).toBeLessThanOrEqual(result.protectedBytes! + RECOVERY_SNAPSHOT_BUDGET_BYTES);
    }
  }, 30_000);
  it("never uses a non-growing legacy replacement to exceed the separate automatic allowance above an oversized floor", () => {
    const pinned = { ...point(0, 0), pinned: true };
    pinned.storage[STORAGE_KEY] = JSON.stringify([{ id: "fixture-0", notes: "P".repeat(1_100_000) }]);
    const copies = [point(1, 350_000), pinned, ...Array.from({ length: 5 }, (_, index) => point(index + 2, 350_000))];
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: encodeRecoverySnapshots(copies),
      [STORAGE_KEY]: point(10, 350_000).storage[STORAGE_KEY]! });
    const result = retainRecoverySnapshot(target.storage, buildFullBackup(target.storage));
    expect(result.status).toBe("replaced");
    expect(result.estimatedBytes).toBeLessThanOrEqual(result.protectedBytes! + RECOVERY_SNAPSHOT_BUDGET_BYTES);
    expect(decodeRecoverySnapshots(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY))).toEqual(expect.arrayContaining([pinned, copies[0]]));
  }, 30_000);
  it("automatically retries an unchanged quota failure after a bounded cooldown when browser capacity recovers", () => {
    vi.useFakeTimers();
    const target = memory({ [STORAGE_KEY]: "[]" });
    target.limits.bytes = 0;
    const checker = new AutomaticRecoverySnapshots();
    expect(checker.check(target.storage)).toMatchObject({ status: "blocked", reason: "quota" });
    expect(checker.check(target.storage)).toMatchObject({ status: "blocked", retrySuppressed: true });
    target.limits.bytes = Infinity;
    vi.advanceTimersByTime(5 * 60_000);
    expect(checker.check(target.storage)).toMatchObject({ status: "created" });
  });
});
