import { assertBackupRecoveryReferences, EMPIRE_OS_BACKUP_STORAGE_KEYS, type BackupStorage } from "./backup";
import { prepareLegacyImport, type LegacyImportPlan, type PersistenceErrorDetails } from "./indexeddb-persistence";
import { readStartupStorage } from "./startup-hydration";

const STORE = "migration-state";
const RECORD = "legacy-to-indexeddb";

export type MigrationPhase = "legacy-active" | "migration-preparing" | "migration-verifying"
  | "ready-for-activation" | "migration-blocked" | "recovery-required";
export type MigrationFence = { generation: number; revision: number };
export type MigrationState = MigrationFence & {
  version: 1;
  // Ready describes a verified staging snapshot, never proof that live legacy writers are stopped.
  phase: MigrationPhase;
  snapshot: LegacyImportPlan | null;
  verified: boolean;
  reason: string | null;
};

export type MigrationResult =
  | { status: "saved" | "read"; state: MigrationState }
  | { status: "stale"; expected: MigrationFence; actual: MigrationFence }
  | { status: "blocked"; state: MigrationState; reason: string }
  | { status: "storage-failed"; error: PersistenceErrorDetails };

export interface MigrationPreparationCoordinator {
  inspect(): Promise<MigrationResult>;
  begin(expected: MigrationFence): Promise<MigrationResult>;
  capture(expected: MigrationFence, source: Pick<BackupStorage, "getItem">): Promise<MigrationResult>;
  verify(expected: MigrationFence, source: Pick<BackupStorage, "getItem">): Promise<MigrationResult>;
  requireRecovery(expected: MigrationFence): Promise<MigrationResult>;
  requestActivation(expected: MigrationFence): Promise<MigrationResult>;
}

const initialState = (): MigrationState => ({
  version: 1, generation: 0, revision: 0, phase: "legacy-active", snapshot: null, verified: false, reason: null,
});

function details(error: unknown): PersistenceErrorDetails {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return { name: "name" in error && typeof error.name === "string" ? error.name : "Error", message: error.message };
  }
  return { name: "Error", message: String(error) };
}

function validateFence(fence: MigrationFence): void {
  if (!Number.isSafeInteger(fence.generation) || fence.generation < 0
    || !Number.isSafeInteger(fence.revision) || fence.revision < 0) {
    throw new Error("Migration fences require non-negative safe integer generations and revisions.");
  }
}

function snapshotStorage(snapshot: LegacyImportPlan): Record<string, string | null> {
  if (!Array.isArray(snapshot.entries) || snapshot.entries.length !== EMPIRE_OS_BACKUP_STORAGE_KEYS.length) {
    throw new Error("Migration snapshot is incomplete.");
  }
  const values: Record<string, string | null> = {};
  for (const entry of snapshot.entries) {
    if (!entry || !(EMPIRE_OS_BACKUP_STORAGE_KEYS as readonly string[]).includes(entry.key)
      || Object.prototype.hasOwnProperty.call(values, entry.key)
      || (entry.rawValue !== null && typeof entry.rawValue !== "string")) {
      throw new Error("Migration snapshot has invalid or duplicate stores.");
    }
    values[entry.key] = entry.rawValue;
  }
  return values;
}

function decodeState(value: unknown): MigrationState {
  if (value === undefined) return initialState();
  if (!value || typeof value !== "object") throw new Error("Migration metadata is malformed; evidence must be recovered.");
  const record = value as Partial<MigrationState>;
  if (record.version !== 1 || typeof record.generation !== "number" || typeof record.revision !== "number") {
    throw new Error("Migration fencing metadata is malformed.");
  }
  validateFence({ generation: record.generation, revision: record.revision });
  const phases: readonly unknown[] = ["legacy-active", "migration-preparing", "migration-verifying",
    "ready-for-activation", "migration-blocked", "recovery-required"];
  if (!phases.includes(record.phase) || typeof record.verified !== "boolean"
    || (record.reason !== null && typeof record.reason !== "string")
    || (record.snapshot !== null && (!record.snapshot || typeof record.snapshot !== "object"))) {
    throw new Error("Migration state is malformed; stored evidence was preserved.");
  }
  if (record.snapshot) snapshotStorage(record.snapshot);
  if ((record.phase === "migration-verifying" || record.phase === "ready-for-activation") && !record.snapshot
    || record.phase === "ready-for-activation" && !record.verified
    || record.verified && !record.snapshot) {
    throw new Error("Migration state lacks required verification evidence.");
  }
  // All persisted fields above are checked before the state is used.
  return {
    version: 1, generation: record.generation, revision: record.revision,
    phase: record.phase as MigrationPhase, snapshot: record.snapshot ?? null,
    verified: record.verified, reason: record.reason ?? null,
  };
}

type Transition = (state: MigrationState) =>
  | { state: MigrationState; blocked?: string }
  | { blocked: string };

// A separate staging database keeps Phase 1 repository data and production localStorage untouched.
// Metadata, raw snapshot, and fencing are committed together as one IndexedDB record.
export class IndexedDbMigrationCoordinator implements MigrationPreparationCoordinator {
  constructor(
    private readonly factory: Pick<IDBFactory, "open">,
    private readonly databaseName = "empire-os-migration-preparation",
  ) {}

  inspect(): Promise<MigrationResult> {
    // Preparing/verifying states survive interruption; inspection never assumes a pending owner has stopped.
    return this.transact();
  }

  begin(expected: MigrationFence): Promise<MigrationResult> {
    return this.transact(expected, (state) => {
      if (!["legacy-active", "migration-blocked", "recovery-required"].includes(state.phase)) {
        return { blocked: "An existing attempt must be completed or explicitly marked recovery-required before retry." };
      }
      if (state.generation === Number.MAX_SAFE_INTEGER) throw new Error("Migration generation capacity is exhausted.");
      return { state: {
        ...state, generation: state.generation + 1, phase: "migration-preparing",
        verified: false, reason: null,
      } };
    });
  }

  capture(expected: MigrationFence, source: Pick<BackupStorage, "getItem">): Promise<MigrationResult> {
    return this.transact(expected, (state) => {
      if (state.phase !== "migration-preparing") return { blocked: "Capture requires a preparing generation." };
      try {
        return { state: {
          ...state, phase: "migration-verifying", snapshot: prepareLegacyImport(source), verified: false, reason: null,
        } };
      } catch (error) {
        const reason = `Legacy capture failed: ${details(error).message}`;
        return { state: { ...state, phase: "migration-blocked", verified: false, reason }, blocked: reason };
      }
    });
  }

  verify(expected: MigrationFence, source: Pick<BackupStorage, "getItem">): Promise<MigrationResult> {
    return this.transact(expected, (state) => {
      if (!["migration-verifying", "ready-for-activation"].includes(state.phase) || !state.snapshot) {
        return { blocked: "Verification requires a complete staged snapshot." };
      }
      try {
        const staged = snapshotStorage(state.snapshot);
        readStartupStorage({ getItem: (key) => staged[key] });
        assertBackupRecoveryReferences(staged);
        const current = readStartupStorage(source);
        const changed = EMPIRE_OS_BACKUP_STORAGE_KEYS.filter((key) => current[key] !== staged[key]);
        if (changed.length) throw new Error(`Legacy source differs from staged evidence: ${changed.join(", ")}.`);
        return { state: { ...state, phase: "ready-for-activation", verified: true, reason: null } };
      } catch (error) {
        const reason = `Migration verification failed: ${details(error).message}`;
        return { state: { ...state, phase: "migration-blocked", verified: false, reason }, blocked: reason };
      }
    });
  }

  requireRecovery(expected: MigrationFence): Promise<MigrationResult> {
    return this.transact(expected, (state) => ({ state: {
      ...state, phase: "recovery-required", verified: false,
      reason: "Attempt interrupted or abandoned; retained snapshot is evidence, not activation authority.",
    } }));
  }

  requestActivation(expected: MigrationFence): Promise<MigrationResult> {
    return this.transact(expected, (state) => {
      const reason = "Activation is disabled: older application versions can still write localStorage without observing "
        + "migration fences. BroadcastChannel, storage events, and tab acknowledgements cannot prove legacy-writer exclusion.";
      return { state: { ...state, phase: "migration-blocked", verified: false, reason }, blocked: reason };
    });
  }

  private async transact(expected?: MigrationFence, transition?: Transition): Promise<MigrationResult> {
    if (expected) {
      validateFence(expected);
      expected = { ...expected };
    }
    let database: IDBDatabase;
    try {
      database = await this.open();
    } catch (error) {
      return { status: "storage-failed", error: details(error) };
    }
    return new Promise<MigrationResult>((resolve) => {
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(STORE, transition ? "readwrite" : "readonly");
      } catch (error) {
        database.close();
        resolve({ status: "storage-failed", error: details(error) });
        return;
      }
      let result: MigrationResult | null = null;
      let failure: unknown;
      const abort = (error: unknown) => {
        failure = error;
        try {
          transaction.abort();
        } catch (abortError) {
          failure = new Error(`Migration transaction failed: ${details(error).message}; abort unavailable: ${details(abortError).message}`);
        }
      };
      transaction.onabort = () => {
        database.close();
        resolve({ status: "storage-failed", error: details(failure ?? transaction.error ?? "Migration transaction aborted.") });
      };
      transaction.onerror = () => { failure ??= transaction.error; };
      transaction.oncomplete = () => {
        database.close();
        if (failure) {
          resolve({ status: "storage-failed", error: details(failure) });
          return;
        }
        resolve(result ?? { status: "storage-failed", error: {
          name: "VerificationError", message: "Migration transaction completed without verified metadata.",
        } });
      };
      try {
        const store = transaction.objectStore(STORE);
        const read = store.get(RECORD);
        read.onerror = () => { failure = read.error; };
        read.onsuccess = () => {
          try {
            const state = decodeState(read.result);
            if (expected && (expected.generation !== state.generation || expected.revision !== state.revision)) {
              result = { status: "stale", expected: { ...expected }, actual: {
                generation: state.generation, revision: state.revision,
              } };
              return;
            }
            if (!transition) {
              result = { status: "read", state };
              return;
            }
            const next = transition(state);
            if (!("state" in next)) {
              result = { status: "blocked", state, reason: next.blocked };
              return;
            }
            if (state.revision === Number.MAX_SAFE_INTEGER) throw new Error("Migration revision capacity is exhausted.");
            const saved = { ...next.state, revision: state.revision + 1 };
            decodeState(saved);
            const write = store.put(saved, RECORD);
            write.onerror = () => { failure = write.error; };
            write.onsuccess = () => {
              try {
                const verify = store.get(RECORD);
                verify.onerror = () => { failure = verify.error; };
                verify.onsuccess = () => {
                  try {
                    const verified = decodeState(verify.result);
                    if (JSON.stringify(verified) !== JSON.stringify(saved)) throw new Error("Migration metadata read-back differs.");
                    result = next.blocked
                      ? { status: "blocked", state: verified, reason: next.blocked }
                      : { status: "saved", state: verified };
                  } catch (error) {
                    abort(error);
                  }
                };
              } catch (error) {
                abort(error);
              }
            };
          } catch (error) {
            abort(error);
          }
        };
      } catch (error) {
        abort(error);
      }
    });
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, 1);
      let rejected = false;
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE);
      };
      request.onblocked = () => {
        rejected = true;
        reject(new Error("Migration staging database is blocked by another connection."));
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (rejected) request.result.close();
        else {
          request.result.onversionchange = () => request.result.close();
          resolve(request.result);
        }
      };
    });
  }
}
