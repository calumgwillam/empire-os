import { webcrypto } from "node:crypto";
import { IDBFactory as FakeIDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERSION_STORAGE_KEY, EMPIRE_OS_BACKUP_STORAGE_KEYS, STORAGE_KEY, type BackupStorage } from "./backup";
import { backupStorageContent, sha256 } from "./independent-backup";
import { PreparationActivationAuthority, type ActivationEvidence } from "./migration-activation-authority";
import { IndexedDbMigrationCoordinator, type MigrationResult, type MigrationState } from "./migration-coordinator";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function state(result: MigrationResult): MigrationState {
  if (!("state" in result)) throw new Error(`No migration state: ${JSON.stringify(result)}`);
  return result.state;
}

async function ready() {
  const factory = new FakeIDBFactory();
  const coordinator = new IndexedDbMigrationCoordinator(factory, "authority-readiness");
  const values = new Map<string, string>([[STORAGE_KEY, ' [ {"id":"source","unknown":"\\u0061"} ] ']]);
  const legacy: BackupStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: vi.fn(() => { throw new Error("Forbidden legacy write."); }),
    removeItem: vi.fn(() => { throw new Error("Forbidden legacy deletion."); }),
  };
  const initial = state(await coordinator.inspect());
  const preparing = state(await coordinator.begin(initial));
  const verifying = state(await coordinator.capture(preparing, legacy));
  const verified = state(await coordinator.verify(verifying, legacy));
  if (!verified.snapshot) throw new Error("Expected verified snapshot.");
  const storage = Object.fromEntries(verified.snapshot.entries.map(({ key, rawValue }) => [key, rawValue]));
  const evidence: ActivationEvidence = {
    generation: verified.generation, revision: verified.revision, target: "indexeddb",
    storageSha256: await sha256(backupStorageContent(storage)), writerExclusionEvidence: null,
  };
  return { coordinator, legacy, values, verified, evidence,
    authority: new PreparationActivationAuthority(coordinator, legacy) };
}

describe("Default-deny migration activation authority", () => {
  it("denies without evidence and does not read or mutate storage", async () => {
    const inspect = vi.fn(async (): Promise<MigrationResult> => { throw new Error("Must not inspect."); });
    const getItem = vi.fn(() => { throw new Error("Must not read."); });
    const authority = new PreparationActivationAuthority({ inspect }, { getItem });
    expect((await authority.assess()).reason).toBe("missing-evidence");
    expect(inspect).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });

  it.each([{}, { target: "indexeddb", generation: 1, revision: 1 }, {
    target: "indexeddb", generation: 1, revision: 1, storageSha256: "fabricated",
  }])("rejects incomplete or forged evidence: %j", async (evidence) => {
    const { authority } = await ready();
    expect((await authority.assess(evidence)).reason).toBe("invalid-evidence");
  });

  it("rejects a syntactically valid but false content fingerprint", async () => {
    const { authority, evidence } = await ready();
    expect((await authority.assess({ ...evidence, storageSha256: "0".repeat(64) })).reason).toBe("invalid-evidence");
  });

  it.each(["broadcast-channel", "storage-event", "tab-acknowledgements", "localStorage-flag", "all-tabs-closed"])(
    "does not accept cooperative exclusion claims as historical writer exclusion: %s", async (kind) => {
      const { authority, evidence } = await ready();
      const decision = await authority.assess({
        ...evidence, writerExclusionEvidence: { kind, allWritersStopped: true, independentlyVerified: true },
      });
      expect(decision.status).toBe("denied");
      expect(decision.reason).toBe("uncontrolled-legacy-writers");
    },
  );

  it("rejects unsupported storage modes", async () => {
    const { authority, evidence } = await ready();
    expect((await authority.assess({ ...evidence, target: "remote-database" })).reason).toBe("unsupported-storage-mode");
  });

  it("rejects a stale generation and stale readiness revision", async () => {
    const { authority, evidence } = await ready();
    expect((await authority.assess({ ...evidence, generation: evidence.generation + 1 })).reason).toBe("stale-generation");
    expect((await authority.assess({ ...evidence, revision: evidence.revision - 1 })).reason).toBe("stale-generation");
  });

  it("denies interrupted recovery and preparing states", async () => {
    const { coordinator, legacy, verified, evidence } = await ready();
    const recovery = state(await coordinator.requireRecovery(verified));
    const authority = new PreparationActivationAuthority(coordinator, legacy);
    expect((await authority.assess({ ...evidence, ...recovery })).reason).toBe("migration-not-ready");
    const preparing = state(await coordinator.begin(recovery));
    expect((await authority.assess({ ...evidence, ...preparing })).reason).toBe("migration-not-ready");
  });

  it("independently checks all 21 values rather than trusting a ready flag", async () => {
    const { authority, values, evidence } = await ready();
    values.set(STORAGE_KEY, '[{"id":"historical-tab-write"}]');
    expect((await authority.assess(evidence)).reason).toBe("source-changed");
  });

  it("denies failed live-source integrity validation", async () => {
    const { authority, values, evidence } = await ready();
    values.set(STORAGE_KEY, "[null]");
    expect((await authority.assess(evidence)).reason).toBe("integrity-check-failed");
  });

  it("revalidates recovery relationships in supplied durable readiness", async () => {
    const { verified, legacy, evidence } = await ready();
    if (!verified.snapshot) throw new Error("Missing snapshot.");
    const snapshot = {
      entries: verified.snapshot.entries.map((entry) => entry.key === CONVERSION_STORAGE_KEY
        ? { ...entry, rawValue: '[{"id":"action","targetType":"Convert to Action","deliveryLeadId":"missing"}]' } : entry),
    };
    const inspect = async (): Promise<MigrationResult> => ({ status: "read", state: { ...verified, snapshot } });
    const authority = new PreparationActivationAuthority({ inspect }, legacy);
    expect((await authority.assess(evidence)).reason).toBe("integrity-check-failed");
  });

  it("rejects incomplete staged evidence", async () => {
    const { verified, legacy, evidence } = await ready();
    const inspect = async (): Promise<MigrationResult> => ({ status: "read", state: {
      ...verified, snapshot: { entries: [] },
    } });
    expect((await new PreparationActivationAuthority({ inspect }, legacy).assess(evidence)).reason)
      .toBe("integrity-check-failed");
  });

  it("fails closed on authority access failure", async () => {
    const { legacy, evidence } = await ready();
    const inspect = async (): Promise<MigrationResult> => { throw new Error("Authority unavailable."); };
    expect((await new PreparationActivationAuthority({ inspect }, legacy).assess(evidence)).reason)
      .toBe("authority-verification-failed");
  });

  it("rechecks generation after asynchronous fingerprint verification", async () => {
    const { coordinator, legacy, evidence, verified } = await ready();
    let reads = 0;
    const inspect = async () => {
      if (++reads === 2) await coordinator.requireRecovery(verified);
      return coordinator.inspect();
    };
    expect((await new PreparationActivationAuthority({ inspect }, legacy).assess(evidence)).reason)
      .toBe("stale-generation");
  });

  it("denies if the second durable authority verification fails", async () => {
    const { coordinator, legacy, evidence } = await ready();
    let reads = 0;
    const inspect = async (): Promise<MigrationResult> => {
      if (++reads === 2) return { status: "storage-failed", error: { name: "Error", message: "Access lost." } };
      return coordinator.inspect();
    };
    expect((await new PreparationActivationAuthority({ inspect }, legacy).assess(evidence)).reason)
      .toBe("authority-verification-failed");
  });

  it("detects a legacy writer changing values after hashing begins", async () => {
    const { coordinator, legacy, evidence, values } = await ready();
    let reads = 0;
    const inspect = async (): Promise<MigrationResult> => {
      if (++reads === 2) values.set(STORAGE_KEY, '[{"id":"late-legacy-write"}]');
      return coordinator.inspect();
    };
    expect((await new PreparationActivationAuthority({ inspect }, legacy).assess(evidence)).reason)
      .toBe("source-changed");
  });

  it("denies when cryptographic evidence verification is unavailable", async () => {
    const { authority, evidence } = await ready();
    vi.stubGlobal("crypto", undefined);
    expect((await authority.assess(evidence)).reason).toBe("authority-verification-failed");
  });

  it("concurrent assessments never authorize or change live storage", async () => {
    const { authority, evidence, legacy, values, coordinator, verified } = await ready();
    const original = [...values];
    const decisions = await Promise.all([authority.assess(evidence), authority.assess(evidence)]);
    expect(decisions.map((decision) => decision.reason)).toEqual([
      "uncontrolled-legacy-writers", "uncontrolled-legacy-writers",
    ]);
    expect(state(await coordinator.inspect())).toEqual(verified);
    expect([...values]).toEqual(original);
    expect(legacy.setItem).not.toHaveBeenCalled();
    expect(legacy.removeItem).not.toHaveBeenCalled();
    expect(EMPIRE_OS_BACKUP_STORAGE_KEYS).toHaveLength(21);
  });
});
