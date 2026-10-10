import { buildFullBackup, RECOVERY_SNAPSHOTS_STORAGE_KEY, RecoverySnapshotError, retainRecoverySnapshot,
  type BackupStorage, type RecoverySnapshotFailure, type RecoverySnapshotResult } from "./backup";

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

// Session-only cache: unchanged capacity failures are not retried by repeated startup effects.
export class AutomaticRecoverySnapshots {
  private blocked: { signature: string; result: Extract<AutomaticRecoveryStatus, { status: "blocked" }> } | null = null;

  check(storage: AutomaticRecoveryStorage, retry = false): AutomaticRecoveryStatus {
    const checkedAt = new Date().toISOString();
    let signature = "";
    try {
      const backup = buildFullBackup(storage, checkedAt);
      if (Object.values(backup.storage).every((value) => value === null)) {
        this.blocked = null;
        return { status: "empty", checkedAt };
      }
      const raw = storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY);
      const totalCodeUnits = this.totalCodeUnits(storage);
      signature = JSON.stringify([backup.storage, raw, totalCodeUnits]);
      if (!retry && this.blocked?.signature === signature) {
        return { ...this.blocked.result, retrySuppressed: true };
      }
      const result = retainRecoverySnapshot(storage, backup);
      this.blocked = null;
      return { ...result, checkedAt };
    } catch (error) {
      const result: Extract<AutomaticRecoveryStatus, { status: "blocked" }> = {
        status: "blocked", checkedAt,
        reason: error instanceof RecoverySnapshotError ? error.reason : "storage",
        message: error instanceof Error ? error.message : String(error),
        existingEvidencePreserved: error instanceof RecoverySnapshotError && error.existingEvidencePreserved,
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
    ? " Existing over-budget recovery storage did not grow; all pinned evidence was preserved." : ""}`;
  if (result.status === "replaced") return `New automatic recovery snapshot saved by safely replacing eligible unpinned automatic copies. Exact recovery data and the write were verified; all protected evidence and a previously verified recovery copy were preserved.${result.overBudget
    ? " Existing over-budget recovery storage did not grow." : ""}`;
  if (result.status === "existing") return `Matching recovery evidence already exists; no new snapshot was created.${result.compacted
    ? " Existing evidence was losslessly compacted and its write verified." : " Existing recovery evidence was preserved."}${result.overBudget
    ? " Recovery storage remains over budget; further growth is blocked." : ""}`;
  const label: Record<RecoverySnapshotFailure, string> = {
    budget: "Snapshot-store budget rejection",
    quota: "Browser localStorage QuotaExceededError",
    decoding: "Recovery-history decoding failure",
    verification: "Recovery verification failure",
    storage: "Recovery storage access/write failure",
    rollback: "Recovery-history rollback failure",
  };
  return `${label[result.reason]}. ${result.message}${result.retrySuppressed
    ? " Unchanged insufficient storage was not retried." : ""}`;
}
