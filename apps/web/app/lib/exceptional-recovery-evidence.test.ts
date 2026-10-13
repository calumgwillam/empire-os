import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPIRE_OS_BACKUP_STORAGE_KEYS, RECOVERY_SNAPSHOTS_STORAGE_KEY, STORAGE_KEY } from "./backup";
import {
  createExceptionalRecoveryEvidence, decodeExceptionalRecoveryEvidence, encodeExceptionalRecoveryEvidence,
  exportExceptionalRecoveryEvidenceFile,
  EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY, ExceptionalRecoveryEvidenceError,
  prepareExceptionalRecoveryEvidence, validateExceptionalRecoveryEvidence, verifyExceptionalRecoveryEvidenceFile,
} from "./exceptional-recovery-evidence";
import { RESTORE_INTERRUPTION_STORAGE_KEY } from "./browser-write-fence";
import { importSourceSha256 } from "./server-import-preparation";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push(`set:${key}`); data.set(key, value); },
  };
  return { data, writes, storage };
}

function fullSource(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
  };
}

describe("Exceptional recovery evidence envelope", () => {
  it("captures all 21 stores and exact corrupt-history strings, including nulls and UTF-16 edge cases", async () => {
    const history = "  \u0000broken:\ud800:end  ";
    const rawStore = ' \n[{"id":"x","raw":"\udfff\u0000"}] \t';
    const source = fullSource({
      [RECOVERY_SNAPSHOTS_STORAGE_KEY]: history,
      [STORAGE_KEY]: rawStore,
      [EMPIRE_OS_BACKUP_STORAGE_KEYS[1]]: "",
    });
    const evidence = await createExceptionalRecoveryEvidence(source);

    expect(evidence.recoveryHistory).toEqual({ present: true, rawValue: history });
    expect(Object.keys(evidence.stores)).toEqual([...EMPIRE_OS_BACKUP_STORAGE_KEYS]);
    expect(evidence.stores[STORAGE_KEY]).toBe(rawStore);
    expect(evidence.stores[EMPIRE_OS_BACKUP_STORAGE_KEYS[1]]).toBe("");
    expect(evidence.stores[EMPIRE_OS_BACKUP_STORAGE_KEYS[2]]).toBeNull();
    expect(evidence.storesSha256).toBe(await importSourceSha256({ ...evidence.stores }));

    const encoded = await encodeExceptionalRecoveryEvidence(evidence);
    const decoded = await decodeExceptionalRecoveryEvidence(encoded);
    expect(decoded.recoveryHistory.rawValue).toBe(history);
    expect(decoded.stores[STORAGE_KEY]).toBe(rawStore);
    expect(decoded.stores).toEqual(evidence.stores);
  });

  it("distinguishes missing history from a present empty history value", async () => {
    const absent = await createExceptionalRecoveryEvidence(fullSource());
    const presentEmpty = await createExceptionalRecoveryEvidence(fullSource({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: "" }));
    expect(absent.recoveryHistory).toEqual({ present: false, rawValue: null });
    expect(presentEmpty.recoveryHistory).toEqual({ present: true, rawValue: "" });
    expect(absent.recoveryHistorySha256).not.toBe(presentEmpty.recoveryHistorySha256);
    expect(absent.evidenceSha256).not.toBe(presentEmpty.evidenceSha256);
  });

  it("exports and independently re-verifies exact source strings without authorizing recovery", async () => {
    const history = "{corrupt\u0000history:\ud800}";
    const rawStore = ' \n[{"id":"raw","value":"\udfff"}] ';
    const source = fullSource({
      [RECOVERY_SNAPSHOTS_STORAGE_KEY]: history,
      [STORAGE_KEY]: rawStore,
    });
    const evidence = await createExceptionalRecoveryEvidence(source);
    const file = await exportExceptionalRecoveryEvidenceFile(evidence);
    expect(file).toContain("\\ud800");
    expect(file).toContain("\\udfff");
    expect(await verifyExceptionalRecoveryEvidenceFile(file, source)).toEqual({
      status: "matches-current-state",
      evidenceSha256: evidence.evidenceSha256,
      storesSha256: evidence.storesSha256,
      recoveryHistorySha256: evidence.recoveryHistorySha256,
      storeCount: 21,
    });
  });

  it("identifies changed business stores and recovery-history raw bytes independently", async () => {
    const source = fullSource({
      [RECOVERY_SNAPSHOTS_STORAGE_KEY]: "{first}",
      [STORAGE_KEY]: "first-store",
    });
    const file = await exportExceptionalRecoveryEvidenceFile(await createExceptionalRecoveryEvidence(source));
    source.values.set(STORAGE_KEY, "changed-store");
    const storeMismatch = await verifyExceptionalRecoveryEvidenceFile(file, source);
    expect(storeMismatch).toMatchObject({ status: "mismatch", changedStores: [STORAGE_KEY], recoveryHistoryChanged: false });

    source.values.set(STORAGE_KEY, "first-store");
    source.values.set(RECOVERY_SNAPSHOTS_STORAGE_KEY, "{changed}");
    const historyMismatch = await verifyExceptionalRecoveryEvidenceFile(file, source);
    expect(historyMismatch).toMatchObject({ status: "mismatch", changedStores: [], recoveryHistoryChanged: true });
  });

  it("rejects malformed, incomplete, unsupported and fingerprint-forged selected files", async () => {
    const source = fullSource();
    const evidence = await createExceptionalRecoveryEvidence(source);
    const malformed = await verifyExceptionalRecoveryEvidenceFile("{broken", source);
    expect(malformed).toMatchObject({ status: "invalid-file" });

    const alteredFiles = [
      JSON.stringify({ ...evidence, stores: Object.fromEntries(Object.entries(evidence.stores).slice(1)) }),
      JSON.stringify({ ...evidence, version: 2 }),
      JSON.stringify({ ...evidence, storesSha256: "0".repeat(64) }),
    ];
    for (const file of alteredFiles) {
      expect(await verifyExceptionalRecoveryEvidenceFile(file, source)).toMatchObject({ status: "invalid-file" });
    }
  });

  it("does not verify evidence if current capture is unstable, unavailable or marker-blocked", async () => {
    const stableSource = fullSource();
    const file = await exportExceptionalRecoveryEvidenceFile(await createExceptionalRecoveryEvidence(stableSource));

    let reads = 0;
    const changingSource = {
      getItem: (key: string) => key === STORAGE_KEY && ++reads === 2 ? "changed-during-capture" : stableSource.getItem(key),
    };
    expect(await verifyExceptionalRecoveryEvidenceFile(file, changingSource)).toMatchObject({ status: "source-changed" });

    expect(await verifyExceptionalRecoveryEvidenceFile(file, {
      getItem: () => { throw new Error("Browser storage unavailable"); },
    })).toMatchObject({ status: "source-unavailable" });

    stableSource.values.set(RESTORE_INTERRUPTION_STORAGE_KEY, "interrupted");
    expect(await verifyExceptionalRecoveryEvidenceFile(file, stableSource)).toMatchObject({ status: "source-unavailable" });
  });

  it("rejects missing, additional, malformed and fingerprint-tampered evidence", async () => {
    const evidence = await createExceptionalRecoveryEvidence(fullSource());
    const cases: unknown[] = [
      { ...evidence, stores: { ...evidence.stores, [EMPIRE_OS_BACKUP_STORAGE_KEYS[0]]: undefined } },
      { ...evidence, stores: { ...evidence.stores, unexpected: "not registered" } },
      { ...evidence, extraClaim: true },
      { ...evidence, version: 2 },
      { ...evidence, purpose: "authorize-restore" },
      { ...evidence, recoveryHistory: { present: false, rawValue: "" } },
      { ...evidence, storesSha256: "0".repeat(64) },
      { ...evidence, stores: { ...evidence.stores, [STORAGE_KEY]: "\ud800" } },
    ];
    for (const candidate of cases) {
      await expect(validateExceptionalRecoveryEvidence(candidate)).rejects.toBeInstanceOf(ExceptionalRecoveryEvidenceError);
    }
    await expect(decodeExceptionalRecoveryEvidence("{broken")).rejects.toMatchObject({ code: "invalid-evidence" });
  });

  it("refuses changed source values between the two capture passes", async () => {
    const source = fullSource({ [STORAGE_KEY]: "first" });
    let captureReads = 0;
    const unstable = {
      getItem: (key: string) => {
        if (key === STORAGE_KEY) {
          captureReads++;
          return captureReads === 2 ? "changed-between-passes" : source.getItem(key);
        }
        return source.getItem(key);
      },
    };
    await expect(createExceptionalRecoveryEvidence(unstable))
      .rejects.toMatchObject({ code: "source-changed", evidenceMayExist: false });
  });
});

describe("Exceptional recovery evidence local slot", () => {
  it("writes a verified evidence envelope without changing existing source values", async () => {
    const source = fullSource({
      [RECOVERY_SNAPSHOTS_STORAGE_KEY]: "{raw \ud800 corrupt history",
      [STORAGE_KEY]: ' [ {"id":"retained"} ] ',
    });
    const before = [...source.values];
    const target = memory(Object.fromEntries(source.values));
    const result = await prepareExceptionalRecoveryEvidence(source, target.storage);
    const stored = target.data.get(EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY);
    expect(stored).toBeDefined();
    expect(await decodeExceptionalRecoveryEvidence(stored!)).toEqual(result);
    expect([...source.values]).toEqual(before);
    expect(target.data.get(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe("{raw \ud800 corrupt history");
    expect(target.data.get(STORAGE_KEY)).toBe(' [ {"id":"retained"} ] ');
    expect(target.writes).toEqual([`set:${EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY}`]);
    expect(EMPIRE_OS_BACKUP_STORAGE_KEYS).not.toContain(EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY);
  });

  it.each(["", "corrupt evidence", "previous evidence"])(
    "never overwrites an occupied evidence slot, including empty or malformed bytes (%j)", async (slot) => {
      const source = fullSource();
      const target = memory({ [EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY]: slot });
      await expect(prepareExceptionalRecoveryEvidence(source, target.storage))
        .rejects.toMatchObject({ code: "slot-occupied", evidenceMayExist: true });
      expect(target.data.get(EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY)).toBe(slot);
      expect(target.writes).toEqual([]);
    },
  );

  it("rejects unreadable slot state without writing", async () => {
    const source = fullSource();
    const target = memory();
    const storage = { ...target.storage, getItem: (key: string) => {
      if (key === EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY) throw new Error("Slot unreadable");
      return target.storage.getItem(key);
    } };
    await expect(prepareExceptionalRecoveryEvidence(source, storage))
      .rejects.toMatchObject({ code: "storage-unavailable", evidenceMayExist: true });
    expect(target.writes).toEqual([]);
  });

  it("blocks evidence preparation when interruption-marker reads fail", async () => {
    const source = fullSource();
    const target = memory();
    const storage = { ...target.storage, getItem: (key: string) => {
      if (key === RESTORE_INTERRUPTION_STORAGE_KEY) throw new Error("Marker unreadable");
      return target.storage.getItem(key);
    } };
    await expect(prepareExceptionalRecoveryEvidence(source, storage))
      .rejects.toMatchObject({ code: "storage-unavailable", evidenceMayExist: true });
    expect(target.writes).toEqual([]);
  });

  it("rejects failed writes without cleanup when a write may have partially persisted", async () => {
    const source = fullSource();
    const target = memory();
    const storage = { ...target.storage, setItem: (key: string, value: string) => {
      target.data.set(key, value);
      throw new Error("Acknowledgement lost");
    } };
    await expect(prepareExceptionalRecoveryEvidence(source, storage))
      .rejects.toMatchObject({ code: "write-failed", evidenceMayExist: true });
    expect(target.data.has(EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY)).toBe(true);
    expect(target.writes).toEqual([]);
  });

  it("rejects silent truncation and retains the uncertain slot untouched", async () => {
    const source = fullSource();
    const target = memory();
    const storage = { ...target.storage, setItem: (key: string) => { target.data.set(key, "{\"truncated\":"); } };
    await expect(prepareExceptionalRecoveryEvidence(source, storage))
      .rejects.toMatchObject({ code: "readback-failed", evidenceMayExist: true });
    expect(target.data.get(EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY)).toBe("{\"truncated\":");
  });

  it("retains the slot and reports uncertainty when evidence read-back is inaccessible", async () => {
    const source = fullSource();
    const target = memory();
    let evidenceWritten = false;
    const storage = {
      getItem: (key: string) => {
        if (key === EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY && evidenceWritten) throw new Error("Readback denied");
        return target.storage.getItem(key);
      },
      setItem: (key: string, value: string) => {
        target.storage.setItem(key, value);
        evidenceWritten = true;
      },
    };
    await expect(prepareExceptionalRecoveryEvidence(source, storage))
      .rejects.toMatchObject({ code: "readback-failed", evidenceMayExist: true });
    expect(target.data.has(EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY)).toBe(true);
    expect(target.data.has(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe(false);
  });

  it("rejects source changes before evidence write and preserves all values", async () => {
    const source = fullSource({ [STORAGE_KEY]: "before" });
    let reads = 0;
    const unstable = {
      getItem: (key: string) => {
        if (key === STORAGE_KEY) {
          reads++;
          if (reads > 1) return "changed";
        }
        return source.getItem(key);
      },
    };
    const target = memory();
    await expect(prepareExceptionalRecoveryEvidence(unstable, target.storage))
      .rejects.toMatchObject({ code: "source-changed", evidenceMayExist: false });
    expect(target.writes).toEqual([]);
  });

  it("retains verified evidence but fails preparation when source changes after the slot write", async () => {
    const source = fullSource({ [STORAGE_KEY]: "before" });
    const target = memory(Object.fromEntries(source.values));
    const storage = { ...target.storage, setItem: (key: string, value: string) => {
      target.storage.setItem(key, value);
      source.values.set(STORAGE_KEY, "changed-after-write");
    } };
    await expect(prepareExceptionalRecoveryEvidence(source, storage))
      .rejects.toMatchObject({ code: "source-changed", evidenceMayExist: true });
    expect(target.data.has(EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY)).toBe(true);
    expect(target.data.has(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe(false);
  });

  it("keeps interruption-marker fencing authoritative for evidence preparation", async () => {
    const source = fullSource({ [RESTORE_INTERRUPTION_STORAGE_KEY]: "interrupted" });
    const target = memory({ [RESTORE_INTERRUPTION_STORAGE_KEY]: "interrupted" });
    await expect(prepareExceptionalRecoveryEvidence(source, target.storage))
      .rejects.toMatchObject({ code: "marker-present", evidenceMayExist: false });
    expect(target.writes).toEqual([]);
  });

  it("fails closed on quota failure and preserves the original snapshot history", async () => {
    const rawHistory = "{corrupt-but-readable}";
    const source = fullSource({ [RECOVERY_SNAPSHOTS_STORAGE_KEY]: rawHistory });
    const target = memory(Object.fromEntries(source.values));
    const storage = { ...target.storage, setItem: () => {
      const error = new Error("Quota exceeded");
      error.name = "QuotaExceededError";
      throw error;
    } };
    await expect(prepareExceptionalRecoveryEvidence(source, storage))
      .rejects.toMatchObject({ code: "write-failed", evidenceMayExist: false });
    expect(target.data.get(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe(rawHistory);
    expect(target.data.has(EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY)).toBe(false);
  });
});
