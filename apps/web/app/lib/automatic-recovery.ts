import { BackupCaptureChangedError, buildStableFullBackup, RECOVERY_SNAPSHOTS_STORAGE_KEY, RecoverySnapshotError, retainRecoverySnapshot,
  type BackupStorage, type RecoverySnapshotFailure, type RecoverySnapshotResult } from "./backup";
import { assertBrowserBusinessWritesAllowed, BrowserWriteFenceError } from "./browser-write-fence";

type AutomaticRecoveryStorage = BackupStorage & {
  readonly length?: number;
  key?(index: number): string | null;
};

export type AutomaticRecoveryStatus =
  | { status: "empty"; checkedAt: string }
  | { [Status in RecoverySnapshotResult["status"]]:
    Omit<RecoverySnapshotResult, "status"> & { status: Status; checkedAt: string }
  }[RecoverySnapshotResult["status"]]
  | { status: "blocked"; checkedAt: string; reason: RecoverySnapshotFailure; message: string;
    existingEvidencePreserved: boolean; retrySuppressed: boolean };

// Suppress repeated startup attempts, but periodically retry recovered capacity.
export class AutomaticRecoverySnapshots {
  private blocked: { signature: string; result: Extract<AutomaticRecoveryStatus, { status: "blocked" }> } | null = null;

  check(storage: AutomaticRecoveryStorage, retry = false): AutomaticRecoveryStatus {
    const checkedAt = new Date().toISOString();
    let signature = "";
    try {
      assertBrowserBusinessWritesAllowed(storage);
      const backup = buildStableFullBackup(storage, checkedAt);
      if (Object.values(backup.storage).every((value) => value === null)) {
        this.blocked = null;
        return { status: "empty", checkedAt };
      }
      const raw = storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY);
      const totalCodeUnits = this.totalCodeUnits(storage);
      signature = JSON.stringify([backup.storage, raw, totalCodeUnits]);
      if (!retry && this.blocked?.signature === signature
        && Date.parse(checkedAt) - Date.parse(this.blocked.result.checkedAt) < 5 * 60_000) {
        return { ...this.blocked.result, checkedAt, retrySuppressed: true };
      }
      const result = retainRecoverySnapshot(storage, backup);
      this.blocked = null;
      return { ...result, checkedAt };
    } catch (error) {
      const result: Extract<AutomaticRecoveryStatus, { status: "blocked" }> = {
        status: "blocked", checkedAt,
        reason: error instanceof BackupCaptureChangedError ? "source-changed"
          : error instanceof RecoverySnapshotError ? error.reason : "storage",
        message: error instanceof Error ? error.message : String(error),
        existingEvidencePreserved: error instanceof BackupCaptureChangedError
          || error instanceof RecoverySnapshotError && error.existingEvidencePreserved
          || error instanceof BrowserWriteFenceError && error.reason === "interrupted",
        retrySuppressed: false,
      };
      if (result.reason === "budget" || result.reason === "quota") {
        this.blocked = { signature, result };
      } else {
        this.blocked = null;
      }
      return result;
    }
  }

  private totalCodeUnits(storage: AutomaticRecoveryStorage): number {
    let total = 0;
    if (storage.key && typeof storage.length === "number") {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key !== null) total += key.length + (storage.getItem(key)?.length ?? 0);
      }
    }
    return total;
  }
}

export function automaticRecoveryMessage(result: AutomaticRecoveryStatus): string {
  if (result.status === "empty") return "No stored business data at the last recovery check; no new snapshot was created.";
  if (result.status === "created") return `New automatic recovery snapshot created and its write verified.${result.overBudget
    ? " Existing protected evidence was preserved with a bounded automatic working allowance." : ""}`;
  if (result.status === "replaced") return `New automatic recovery snapshot saved by safely replacing eligible unpinned automatic copies. Exact recovery data and the write were verified; all protected evidence and a previously verified recovery copy were preserved.${result.overBudget
    ? " Existing protected evidence was preserved; automatic working storage remains bounded." : ""}${result.quotaLimited
    ? " Browser quota required fewer eligible automatic copies; protected evidence and the previous verified copy were retained." : ""}`;
  if (result.status === "existing") return `Matching recovery evidence already exists; no new snapshot was created.${result.compacted
    ? " Existing evidence was losslessly compacted and its write verified." : " Existing recovery evidence was preserved."}${result.overBudget
    ? " Protected evidence exceeds the normal working budget; no recovery point was deleted by this duplicate check." : ""}`;
  const label: Record<RecoverySnapshotFailure, string> = {
    budget: "Snapshot-store budget rejection",
    quota: "Browser localStorage QuotaExceededError",
    decoding: "Recovery-history decoding failure",
    verification: "Recovery verification failure",
    storage: "Recovery storage access/write failure",
    rollback: "Recovery-history rollback failure",
    "source-changed": "Business data changed during recovery capture",
  };
  return `${label[result.reason]}. ${result.message}${result.retrySuppressed
    ? " Unchanged insufficient storage was not retried." : ""}`;
}
