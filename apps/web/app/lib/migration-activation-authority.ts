import { assertBackupRecoveryReferences, EMPIRE_OS_BACKUP_STORAGE_KEYS, type BackupStorage } from "./backup";
import { backupStorageContent, sha256 } from "./independent-backup";
import type { MigrationFence, MigrationPreparationCoordinator } from "./migration-coordinator";
import { readStartupStorage } from "./startup-hydration";
import { isFence } from "./writer-fencing";

export type ActivationBlockReason = "missing-evidence" | "invalid-evidence" | "unsupported-storage-mode"
  | "stale-generation" | "migration-not-ready" | "integrity-check-failed" | "source-changed"
  | "authority-verification-failed" | "uncontrolled-legacy-writers";

// There is intentionally no authorized outcome or caller-provided override in Phase 2B.
export type ActivationDecision = {
  status: "denied";
  reason: ActivationBlockReason;
  message: string;
};

export type ActivationEvidence = MigrationFence & {
  target: "indexeddb";
  storageSha256: string;
  writerExclusionEvidence: unknown;
};

export interface MigrationActivationAuthority {
  assess(evidence?: unknown): Promise<ActivationDecision>;
}

function deny(reason: ActivationBlockReason, message: string): ActivationDecision {
  return { status: "denied", reason, message };
}

function evidenceIsValid(value: unknown): value is ActivationEvidence {
  return isFence(value) && "target" in value && value.target === "indexeddb"
    && "storageSha256" in value && typeof value.storageSha256 === "string"
    && /^[a-f0-9]{64}$/.test(value.storageSha256) && "writerExclusionEvidence" in value;
}

export class PreparationActivationAuthority implements MigrationActivationAuthority {
  constructor(
    private readonly coordinator: Pick<MigrationPreparationCoordinator, "inspect">,
    private readonly legacySource: Pick<BackupStorage, "getItem">,
  ) {}

  async assess(evidence?: unknown): Promise<ActivationDecision> {
    if (evidence === undefined || evidence === null) return deny("missing-evidence", "Activation defaults to deny without evidence.");
    if (evidence && typeof evidence === "object" && "target" in evidence && evidence.target !== "indexeddb") {
      return deny("unsupported-storage-mode", "The requested storage mode is unsupported.");
    }
    if (!evidenceIsValid(evidence)) return deny("invalid-evidence", "Activation evidence is malformed.");
    const request = { ...evidence };
    try {
      const observed = await this.coordinator.inspect();
      if (observed.status !== "read") return deny("authority-verification-failed", "Durable migration authority could not be read.");
      const state = observed.state;
      if (state.generation !== request.generation || state.revision !== request.revision) {
        return deny("stale-generation", "Migration generation or transition revision has changed.");
      }
      if (state.phase !== "ready-for-activation" || !state.verified || !state.snapshot) {
        return deny("migration-not-ready", "Migration does not have a verified readiness state.");
      }
      const entries = state.snapshot.entries;
      if (entries.length !== EMPIRE_OS_BACKUP_STORAGE_KEYS.length
        || new Set(entries.map((entry) => entry.key)).size !== EMPIRE_OS_BACKUP_STORAGE_KEYS.length
        || !EMPIRE_OS_BACKUP_STORAGE_KEYS.every((key) => entries.some((entry) => entry.key === key))) {
        return deny("integrity-check-failed", "Readiness evidence does not cover all registered stores.");
      }
      const staged = Object.fromEntries(entries.map(({ key, rawValue }) => [key, rawValue]));
      let source: Record<string, string | null>;
      try {
        readStartupStorage({ getItem: (key) => staged[key] });
        assertBackupRecoveryReferences(staged);
        source = readStartupStorage(this.legacySource);
      } catch {
        return deny("integrity-check-failed", "Stored migration evidence or live legacy source failed validation.");
      }
      if (EMPIRE_OS_BACKUP_STORAGE_KEYS.some((key) => source[key] !== staged[key])) {
        return deny("source-changed", "Live legacy values no longer match the verified snapshot.");
      }
      const content = backupStorageContent(staged);
      if (await sha256(content) !== request.storageSha256) {
        return deny("invalid-evidence", "Claimed data fingerprint does not match independently read migration evidence.");
      }
      // Recheck after hashing; neither read makes localStorage atomic with IndexedDB.
      const latest = await this.coordinator.inspect();
      if (latest.status !== "read") return deny("authority-verification-failed", "Final authority verification failed.");
      if (latest.state.generation !== state.generation || latest.state.revision !== state.revision) {
        return deny("stale-generation", "Authority changed while evidence was being verified.");
      }
      if (JSON.stringify(latest.state) !== JSON.stringify(state)) {
        return deny("authority-verification-failed", "Migration evidence changed without advancing its fence.");
      }
      const finalSource = readStartupStorage(this.legacySource);
      if (EMPIRE_OS_BACKUP_STORAGE_KEYS.some((key) => finalSource[key] !== staged[key])) {
        return deny("source-changed", "Legacy data changed during authority verification.");
      }
      return deny("uncontrolled-legacy-writers",
        "Activation is unavailable: historical application tabs can still write localStorage outside participating-writer fences. "
        + "Announcements, storage events, acknowledgements, flags, or a caller's exclusion claim cannot establish exclusion.");
    } catch {
      return deny("authority-verification-failed", "Activation authority could not be independently verified; activation remains denied.");
    }
  }
}
