import { describe, expect, it } from "vitest";
import { buildFullBackup, retainRecoverySnapshot, runBackupRestoreTransaction, validateEmpireOsBackup,
  RECOVERY_SNAPSHOTS_STORAGE_KEY, STORAGE_KEY, PROJECT_STORAGE_KEY, CHANGE_HISTORY_STORAGE_KEY,
  type BackupStorage, type EmpireOsBackup } from "./backup";
import { BACKUP_VERIFICATIONS_STORAGE_KEY } from "./independent-backup";
import { decodeRecoverySnapshots, encodeRecoverySnapshots, RECOVERY_SNAPSHOT_BUDGET_BYTES,
  type RecoverySnapshot } from "./recovery-snapshot-storage";

const createdAt = "2026-10-10T08:00:00.000Z";
function memory(initial: Record<string, string> = {}, quota = Infinity) {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  const storage: BackupStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      const next = new Map(data);
      next.set(key, value);
      const bytes = [...next].reduce((sum, [name, content]) => sum + 2 * (name.length + content.length), 0);
      if (bytes > quota) {
        const error = new Error("Browser storage quota exceeded");
        error.name = "QuotaExceededError";
        throw error;
      }
      writes.push(key);
      data.set(key, value);
    },
    removeItem: (key) => { writes.push(key); data.delete(key); },
  };
  return { data, writes, storage };
}
function snapshot(storage: Record<string, string | null>, pinned = false): RecoverySnapshot {
  return { createdAt, storage, ...(pinned ? { pinned: true } : {}) };
}
function backup(content: string): EmpireOsBackup {
  return buildFullBackup(memory({ [STORAGE_KEY]: content }).storage, createdAt);
}

describe("Lossless recovery storage", () => {
  it("preserves legacy metadata, nulls, missing stores, Unicode and malformed raw business strings exactly", () => {
    const raw = JSON.stringify([
      { ...snapshot({ [STORAGE_KEY]: "{unparsed \u00e9 \ud83c\udf31", omitted: null }, true), note: "protected evidence", version: 1 },
      snapshot({ [STORAGE_KEY]: "prefix changed suffix", other: "" }),
      snapshot({ [STORAGE_KEY]: "prefix original suffix", other: "" }),
    ]);
    expect(JSON.stringify(decodeRecoverySnapshots(encodeRecoverySnapshots(decodeRecoverySnapshots(raw))))).toBe(raw);
  });

  it("compacts cumulative history and repeated business stores without dropping a single snapshot or event", () => {
    const events = Array.from({ length: 500 }, (_, index) => ({ id: `event-${index}`, evidence: "retained evidence ".repeat(20) }));
    const sharedBusiness = JSON.stringify([{ id: "record", notes: "business evidence ".repeat(10000) }]);
    const snapshots = Array.from({ length: 12 }, (_, index) => ({
      ...snapshot({ [STORAGE_KEY]: sharedBusiness, [CHANGE_HISTORY_STORAGE_KEY]: JSON.stringify(events.slice(0, 500 - index)) }, true),
      note: `protected-${index}`,
    }));
    const plain = JSON.stringify(snapshots);
    const compact = encodeRecoverySnapshots(snapshots);
    expect(compact.length).toBeLessThan(plain.length / 4);
    expect(decodeRecoverySnapshots(compact)).toEqual(snapshots);
    expect(JSON.stringify(decodeRecoverySnapshots(compact))).toBe(plain);
  });

  it.each([
    { format: "unknown", version: 1, pool: [], snapshots: [] },
    { format: "empire-os-recovery-snapshots", version: 2, pool: [], snapshots: [] },
    { format: "empire-os-recovery-snapshots", version: 1, pool: [[0, 0, 0, ""]], snapshots: [] },
    { format: "empire-os-recovery-snapshots", version: 1, pool: ["abc", [0, 2, 2, ""]], snapshots: [] },
    { format: "empire-os-recovery-snapshots", version: 1, pool: ["abc"], snapshots: [{ createdAt, storage: { key: 1 } }] },
  ])("rejects unsupported or corrupt compact evidence without overwriting it (%j)", (value) => {
    const raw = JSON.stringify(value);
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw });
    expect(() => retainRecoverySnapshot(target.storage, backup("[]"))).toThrow();
    expect(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe(raw);
    expect(target.writes).toEqual([]);
  });

  it("compacts an unchanged startup snapshot even at a quota that cannot hold the legacy repetitions", () => {
    const current = backup(JSON.stringify([{ id: "record", evidence: "truth ".repeat(15000) }]));
    const snapshots = Array.from({ length: 8 }, (_, index) => ({
      ...current, pinned: true, note: `receipt-${index}`,
    }));
    const legacy = JSON.stringify(snapshots);
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: legacy, [STORAGE_KEY]: current.storage[STORAGE_KEY]! }, 500000);
    retainRecoverySnapshot(target.storage, current);
    const stored = target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)!;
    expect(stored.length).toBeLessThan(legacy.length / 4);
    expect(decodeRecoverySnapshots(stored)).toEqual(snapshots);
    expect(target.storage.getItem(STORAGE_KEY)).toBe(current.storage[STORAGE_KEY]);
    target.writes.length = 0;
    retainRecoverySnapshot(target.storage, current);
    expect(target.writes).toEqual([]);
  });

  it("retains every pinned copy while rotating only the established five automatic copies", () => {
    const protectedCopies = Array.from({ length: 10 }, (_, index) => ({
      ...snapshot({ [STORAGE_KEY]: JSON.stringify([{ id: `protected-${index}`, notes: "truth ".repeat(1000) }]) }, true),
      externalEvidence: { file: `copy-${index}`, digest: `evidence-${index}` },
    }));
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: JSON.stringify(protectedCopies) });
    for (let index = 0; index < 9; index++) retainRecoverySnapshot(target.storage, backup(JSON.stringify([{ id: `current-${index}` }])));
    const retained = decodeRecoverySnapshots(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY));
    expect(retained.filter((entry) => entry.pinned)).toEqual(protectedCopies);
    expect(retained.filter((entry) => !entry.pinned)).toHaveLength(5);
  });

  it.each([0, 1])("enforces the exact budget boundary with %s extra UTF-16 code units", (extra) => {
    const empty = backup("");
    const overhead = RECOVERY_SNAPSHOTS_STORAGE_KEY.length + encodeRecoverySnapshots([{ ...empty, automatic: true }]).length;
    const sized = backup("x".repeat(RECOVERY_SNAPSHOT_BUDGET_BYTES / 2 - overhead + extra));
    const target = memory();
    const operation = () => retainRecoverySnapshot(target.storage, sized);
    if (extra) {
      expect(operation).toThrow("2 MiB storage budget");
      expect(target.writes).toEqual([]);
    } else {
      expect(operation).not.toThrow();
      expect(2 * (RECOVERY_SNAPSHOTS_STORAGE_KEY.length + target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)!.length))
        .toBe(RECOVERY_SNAPSHOT_BUDGET_BYTES);
    }
  });

  it("refuses oversized protected growth without modifying legacy snapshots, history, live records or external evidence", () => {
    const protectedHistory = JSON.stringify([snapshot({ [STORAGE_KEY]: "p".repeat(1100000) }, true)]);
    const initial = { [RECOVERY_SNAPSHOTS_STORAGE_KEY]: protectedHistory, [STORAGE_KEY]: '[{"id":"live"}]',
      [CHANGE_HISTORY_STORAGE_KEY]: '[{"evidence":"entire history"}]', [BACKUP_VERIFICATIONS_STORAGE_KEY]: "external receipts" };
    const target = memory(initial);
    expect(() => retainRecoverySnapshot(target.storage, backup('[{"id":"new"}]'), true)).toThrow("2 MiB");
    expect(Object.fromEntries(target.data)).toEqual(initial);
    expect(target.writes).toEqual([]);
  });

  it("blocks creation when protected evidence alone is over budget without modifying any existing evidence", () => {
    const copies = Array.from({ length: 3 }, (_, index) => ({
      ...snapshot({ [STORAGE_KEY]: "p".repeat(1100000) }, true), receipt: `protected-${index}`,
    }));
    const raw = JSON.stringify(copies);
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw }, 2300000);
    expect(() => retainRecoverySnapshot(target.storage, backup('[{"id":"new"}]'))).toThrow("Protected recovery evidence alone");
    const stored = target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)!;
    expect(stored).toBe(raw);
    expect(decodeRecoverySnapshots(stored)).toEqual(copies);
    expect(2 * stored.length).toBeGreaterThan(RECOVERY_SNAPSHOT_BUDGET_BYTES);
    expect(target.writes).toEqual([]);
  });

  it("reports quota exhaustion and preserves the exact original bytes without a delete-and-retry fallback", () => {
    const raw = JSON.stringify([snapshot({ [STORAGE_KEY]: "protected" }, true)]);
    const initial = { [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw, [STORAGE_KEY]: "live",
      [CHANGE_HISTORY_STORAGE_KEY]: "all history", [BACKUP_VERIFICATIONS_STORAGE_KEY]: "all receipts" };
    const target = memory(initial, 2 * Object.entries(initial).reduce((sum, [key, value]) => sum + key.length + value.length, 0));
    expect(() => retainRecoverySnapshot(target.storage, backup('[{"id":"new"}]'))).toThrow("was not saved");
    expect(Object.fromEntries(target.data)).toEqual(initial);
    expect(target.writes).toEqual([]);
  });

  it.each(["silent", "corrupt", "throw after write"] as const)("rolls back a failed compact write (%s) to exact legacy bytes", (mode) => {
    const current = backup('[{"id":"shared","notes":"' + "truth ".repeat(2000) + '"}]');
    const raw = JSON.stringify([{ ...current, pinned: true }, { ...current, pinned: true }]);
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw });
    const set = target.storage.setItem;
    let attempted = false;
    target.storage.setItem = (key, value) => {
      if (!attempted) {
        attempted = true;
        if (mode === "silent") return;
        set(key, mode === "corrupt" ? "{corrupt" : value);
        if (mode === "throw after write") throw new Error("Write failed after mutation");
        return;
      }
      set(key, value);
    };
    expect(() => retainRecoverySnapshot(target.storage, current)).toThrow("was not saved");
    expect(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe(raw);
  });

  it("explicitly reports an unverified recovery rollback without modifying live records or external evidence", () => {
    const current = backup('[{"id":"shared","notes":"' + "truth ".repeat(1000) + '"}]');
    const raw = JSON.stringify([{ ...current, pinned: true }, { ...current, pinned: true }]);
    const target = memory({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: raw, [STORAGE_KEY]: '[{"id":"live"}]',
      [BACKUP_VERIFICATIONS_STORAGE_KEY]: "external receipts" });
    const set = target.storage.setItem;
    let attempted = false;
    target.storage.setItem = (key) => {
      if (attempted) throw new Error("Rollback quota exceeded");
      attempted = true;
      set(key, "{corrupt");
    };
    expect(() => retainRecoverySnapshot(target.storage, current)).toThrow("prior recovery history could not be restored");
    expect(target.storage.getItem(STORAGE_KEY)).toBe('[{"id":"live"}]');
    expect(target.storage.getItem(BACKUP_VERIFICATIONS_STORAGE_KEY)).toBe("external receipts");
    expect(target.writes).toEqual([RECOVERY_SNAPSHOTS_STORAGE_KEY]);
  });

  it("blocks restore on safety-copy quota exhaustion before any business write", () => {
    const target = memory({ [STORAGE_KEY]: '[{"id":"original"}]' }, 100);
    const before = Object.fromEntries(target.data);
    const result = runBackupRestoreTransaction(target.storage, backup('[{"id":"replacement"}]'));
    expect(result).toMatchObject({ ok: false, writesStarted: false, rollbackFailures: [] });
    expect(Object.fromEntries(target.data)).toEqual(before);
    expect(target.writes).toEqual([]);
  });

  it("restores exact stores from compact pinned evidence and retains a full pre-restore copy", () => {
    const protectedBackup = backup('[{"id":"protected","notes":"' + "truth ".repeat(1000) + '"}]');
    const copies = [{ ...protectedBackup, pinned: true }, { ...protectedBackup, pinned: true }];
    const target = memory({ [STORAGE_KEY]: '[{"id":"current"}]', [RECOVERY_SNAPSHOTS_STORAGE_KEY]: encodeRecoverySnapshots(copies) });
    const selected = decodeRecoverySnapshots(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY))[0];
    expect(runBackupRestoreTransaction(target.storage, validateEmpireOsBackup(selected))).toEqual({ ok: true });
    expect(target.storage.getItem(STORAGE_KEY)).toBe(protectedBackup.storage[STORAGE_KEY]);
    const retained = decodeRecoverySnapshots(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY));
    expect(retained[0]).toMatchObject({ pinned: true, storage: { [STORAGE_KEY]: '[{"id":"current"}]' } });
    expect(retained.slice(1)).toEqual(copies);
  });

  it("rolls back a later business quota failure while preserving compact safety evidence and external receipts", () => {
    const protectedBackup = backup('[{"id":"protected","notes":"' + "truth ".repeat(100) + '"}]');
    const copies = [{ ...protectedBackup, pinned: true }, { ...protectedBackup, pinned: true }];
    const initial = { [STORAGE_KEY]: '[{"id":"original"}]', [BACKUP_VERIFICATIONS_STORAGE_KEY]: "untouched receipts",
      [RECOVERY_SNAPSHOTS_STORAGE_KEY]: encodeRecoverySnapshots(copies) };
    const target = memory(initial, 20000);
    const replacement = backup('[{"id":"new"}]');
    replacement.storage[PROJECT_STORAGE_KEY] = JSON.stringify(["new-project".repeat(1000)]);
    expect(runBackupRestoreTransaction(target.storage, replacement)).toMatchObject({ ok: false, writesStarted: true, rollbackFailures: [] });
    expect(target.storage.getItem(STORAGE_KEY)).toBe(initial[STORAGE_KEY]);
    expect(target.storage.getItem(PROJECT_STORAGE_KEY)).toBeNull();
    expect(target.storage.getItem(BACKUP_VERIFICATIONS_STORAGE_KEY)).toBe(initial[BACKUP_VERIFICATIONS_STORAGE_KEY]);
    expect(decodeRecoverySnapshots(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY))[0])
      .toMatchObject({ pinned: true, storage: { [STORAGE_KEY]: initial[STORAGE_KEY] } });
    expect(decodeRecoverySnapshots(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)).slice(1)).toEqual(copies);
  });
});
