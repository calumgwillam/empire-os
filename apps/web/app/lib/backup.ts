import { assertIcarusDataStructure, ICARUS_STORAGE_KEY, normaliseIcarusAssessmentData } from "./icarus";
import { assertIcarusObservationActionLinks, assertIcarusObservationHandoffs } from "./icarus-observation-action";
import { assertActionFinanceLink, assertActionLeadLink } from "./capture-conversions";
import { assertIncomeCommercialEvidence, assertLeadDeliveryCommitment } from "./lead-delivery";
import { assertExpenseJobEvidence, assertLeadJobFinancialEvidence } from "./job-performance";
import { assertCommercialLessonRecord } from "./commercial-learning";
import { assertCapacityRecord } from "./delivery-capacity";
import { assertCapacityResolutionRecord } from "./capacity-resolution";
import { assertDelegationHandoffs } from "./delegation-handoffs";
import { getRecoveryReferenceIssues } from "./recovery-consistency";
import { decodeRecoverySnapshots, encodeRecoverySnapshots, RECOVERY_SNAPSHOT_BUDGET_BYTES, type RecoverySnapshot } from "./recovery-snapshot-storage";

export const STORAGE_KEY = "empire-os-captures";
export const CONVERSION_STORAGE_KEY = "empire-os-capture-conversions";
export const PERSON_STORAGE_KEY = "empire-os-people";
export const PROJECT_STORAGE_KEY = "empire-os-projects";
export const LEAD_STORAGE_KEY = "empire-os-leads";
export const OUTREACH_STORAGE_KEY = "empire-os-outreach-contacts";
export const DELEGATION_HANDOFF_STORAGE_KEY = "empire-os-delegation-handoffs";
export const CASH_POSITION_STORAGE_KEY = "empire-os-cash-position";
export const INCOME_STORAGE_KEY = "empire-os-income-records";
export const EXPENSE_STORAGE_KEY = "empire-os-expense-records";
export const COMMITMENT_STORAGE_KEY = "empire-os-financial-commitments";
export const TAX_PAYMENT_STORAGE_KEY = "empire-os-tax-payment-records";
export const SAVED_VIEWS_STORAGE_KEY = "empire-os-records-in-motion-views";
export const DEFAULT_SAVED_VIEW_STORAGE_KEY = "empire-os-records-in-motion-default-view";
export const DAILY_POSTURE_SNAPSHOTS_STORAGE_KEY = "empire-os-daily-posture-snapshots";
export const CHANGE_HISTORY_STORAGE_KEY = "empire-os-change-history";
export const STRATEGIC_OBJECTIVES_STORAGE_KEY = "empire-os-strategic-objectives";
export const STRATEGIC_REVIEWS_STORAGE_KEY = "empire-os-strategic-reviews";
export const WORKING_RELATIONSHIP_STORAGE_KEY = "empire-os-working-relationships";
export const FOUNDER_INTELLIGENCE_STORAGE_KEY = "empire-os-founder-intelligence";
export const RECOVERY_SNAPSHOTS_STORAGE_KEY = "empire-os-recovery-snapshots-v1";

export const BACKUP_FORMAT = "empire-os-backup";
export const BACKUP_VERSION = 1;
export const SUPPORTED_BACKUP_VERSIONS = [BACKUP_VERSION] as const;
export const BACKUP_CURRENT_DAYS = 7;
export const BACKUP_STALE_DAYS = 30;

export const EMPIRE_OS_BACKUP_STORAGE_KEYS = [
  STORAGE_KEY,
  CONVERSION_STORAGE_KEY,
  PERSON_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
  LEAD_STORAGE_KEY,
  OUTREACH_STORAGE_KEY,
  DELEGATION_HANDOFF_STORAGE_KEY,
  CASH_POSITION_STORAGE_KEY,
  INCOME_STORAGE_KEY,
  EXPENSE_STORAGE_KEY,
  COMMITMENT_STORAGE_KEY,
  TAX_PAYMENT_STORAGE_KEY,
  SAVED_VIEWS_STORAGE_KEY,
  DEFAULT_SAVED_VIEW_STORAGE_KEY,
  DAILY_POSTURE_SNAPSHOTS_STORAGE_KEY,
  CHANGE_HISTORY_STORAGE_KEY,
  STRATEGIC_OBJECTIVES_STORAGE_KEY,
  STRATEGIC_REVIEWS_STORAGE_KEY,
  WORKING_RELATIONSHIP_STORAGE_KEY,
  FOUNDER_INTELLIGENCE_STORAGE_KEY,
  ICARUS_STORAGE_KEY,
] as const;

export type EmpireOsBackup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  storage: Record<string, string | null>;
  includedStorageKeys?: string[];
};

export type BackupStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function buildFullBackup(source: Pick<BackupStorage, "getItem">, createdAt: string = new Date().toISOString()): EmpireOsBackup {
  const storage: Record<string, string | null> = {};
  for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) {
    storage[key] = source.getItem(key);
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    storage,
    includedStorageKeys: [...EMPIRE_OS_BACKUP_STORAGE_KEYS],
  };
}

export type BackupRestoreResult =
  | { ok: true }
  | { ok: false; error: unknown; writesStarted: boolean; rollbackFailures: string[] };

export function assertBackupRecoveryReferences(storage: EmpireOsBackup["storage"]): void {
  const referenceIssues = getRecoveryReferenceIssues({
    conversions: storage[CONVERSION_STORAGE_KEY], leads: storage[LEAD_STORAGE_KEY],
    people: storage[PERSON_STORAGE_KEY], projects: storage[PROJECT_STORAGE_KEY],
    income: storage[INCOME_STORAGE_KEY], expenses: storage[EXPENSE_STORAGE_KEY],
    commitments: storage[COMMITMENT_STORAGE_KEY], icarus: storage[ICARUS_STORAGE_KEY],
  });
  if (referenceIssues.length) throw new Error(`Restore would leave inconsistent record references: ${referenceIssues.join("; ")}`);
}

export function validateStandaloneBackup(value: unknown): EmpireOsBackup {
  const backup = validateEmpireOsBackup(value);
  const missing = EMPIRE_OS_BACKUP_STORAGE_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(backup.storage, key));
  if (missing.length) throw new Error(`This file cannot establish complete independent recovery; missing business stores: ${missing.join(", ")}. Legacy restore remains available.`);
  assertBackupRecoveryReferences(backup.storage);
  return backup;
}

// beforeWrites runs after the pre-restore snapshot and before any live write; if it throws, nothing is written.
export function runBackupRestoreTransaction(target: BackupStorage, backup: EmpireOsBackup, beforeWrites?: (safetyBackup: EmpireOsBackup) => void): BackupRestoreResult {
  const previousStorage: Record<string, string | null> = {};
  let writesStarted = false;

  try {
    const validated = validateEmpireOsBackup(backup);
    for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) previousStorage[key] = target.getItem(key);
    const effective = validateEmpireOsBackup({ ...validated, storage: { ...previousStorage, ...validated.storage } });
    assertBackupRecoveryReferences(effective.storage);
    const safetyBackup: EmpireOsBackup = { format: BACKUP_FORMAT, version: BACKUP_VERSION,
      createdAt: new Date().toISOString(), storage: { ...previousStorage }, includedStorageKeys: [...EMPIRE_OS_BACKUP_STORAGE_KEYS] };
    beforeWrites?.({ ...safetyBackup, storage: { ...previousStorage }, includedStorageKeys: [...EMPIRE_OS_BACKUP_STORAGE_KEYS] });
    if (EMPIRE_OS_BACKUP_STORAGE_KEYS.some((key) => target.getItem(key) !== previousStorage[key])) {
      throw new Error("Live data changed during restore preparation; reload and review the backup before retrying.");
    }
    retainRecoverySnapshot(target, safetyBackup, true);

    writesStarted = true;
    for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) {
      const value = effective.storage[key];
      if (value === previousStorage[key]) continue;
      if (value === null) target.removeItem(key);
      else target.setItem(key, value);
    }

    const failedKeys = EMPIRE_OS_BACKUP_STORAGE_KEYS.filter((key) => {
      const expected = effective.storage[key];
      return target.getItem(key) !== expected;
    });
    if (failedKeys.length > 0) throw new Error(`Verification failed for: ${failedKeys.join(", ")}.`);

    return { ok: true };
  } catch (error) {
    const rollbackFailures: string[] = [];
    if (writesStarted) {
      for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) {
        try {
          const previousValue = previousStorage[key];
          if (target.getItem(key) === previousValue) continue;
          if (previousValue === null) target.removeItem(key);
          else target.setItem(key, previousValue);
          if (target.getItem(key) !== previousValue) rollbackFailures.push(key);
        } catch {
          rollbackFailures.push(key);
        }
      }
    }
    return { ok: false, error, writesStarted, rollbackFailures };
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type RecoverySnapshotFailure = "budget" | "quota" | "decoding" | "verification" | "storage" | "rollback";

export class RecoverySnapshotError extends Error {
  constructor(message: string, readonly reason: RecoverySnapshotFailure, readonly existingEvidencePreserved: boolean) {
    super(message);
    this.name = "RecoverySnapshotError";
  }
}

export type RecoverySnapshotResult = {
  status: "created" | "replaced" | "existing";
  compacted: boolean;
  overBudget: boolean;
  estimatedBytes: number;
};

export function retainRecoverySnapshot(target: BackupStorage, backup: EmpireOsBackup, pinned = false): RecoverySnapshotResult {
  const raw = target.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY);
  let existing: RecoverySnapshot[];
  try {
    existing = decodeRecoverySnapshots(raw);
  } catch (error) {
    throw new RecoverySnapshotError(`Recovery history could not be decoded: ${error instanceof Error ? error.message : String(error)}. Existing recovery evidence was preserved; no new snapshot was saved.`, "decoding", true);
  }
  const duplicate = !pinned && existing.some((entry) => JSON.stringify(entry.storage) === JSON.stringify(backup.storage));
  const verified = existing.map((entry) => {
    try {
      validateStandaloneBackup(entry);
      return true;
    } catch {
      // Unverified raw evidence is retained, never treated as an eligible recovery copy.
      return false;
    }
  });
  const lastVerifiedIndex = verified.findIndex(Boolean);
  const automatic = existing.map((entry, index) => entry.pinned !== true && verified[index]
    && Object.keys(entry).every((key) => ["format", "version", "createdAt", "storage", "includedStorageKeys", "pinned", "automatic"].includes(key))
    && (entry.automatic === true || (entry.automatic === undefined
      && entry.format === BACKUP_FORMAT && entry.version === BACKUP_VERSION
      && Array.isArray(entry.includedStorageKeys))));
  const eligible = automatic.map((value, index) => value && index !== lastVerifiedIndex);
  const protectedSnapshots = existing.filter((_, index) => !eligible[index]);
  const bytes = (serialized: string) => 2 * (RECOVERY_SNAPSHOTS_STORAGE_KEY.length + serialized.length);
  const encodeVerified = (snapshots: readonly RecoverySnapshot[]): string => {
    try {
      return encodeRecoverySnapshots(snapshots);
    } catch (error) {
      throw new RecoverySnapshotError(`Recovery compaction could not be verified: ${error instanceof Error ? error.message : String(error)}. Existing recovery evidence was preserved; no new snapshot was saved.`, "verification", true);
    }
  };
  const protectedBytes = bytes(encodeVerified(protectedSnapshots));
  if (protectedBytes > RECOVERY_SNAPSHOT_BUDGET_BYTES) {
    throw new RecoverySnapshotError(`Protected recovery evidence alone requires ${protectedBytes} estimated bytes, exceeding the 2 MiB storage budget. Local snapshot creation remains blocked. Existing recovery evidence was preserved; no new snapshot was saved and nothing was deleted.`, "budget", true);
  }
  const keptAutomaticCount = (pinned ? 5 : 4) - (automatic[lastVerifiedIndex] ? 1 : 0);
  let automaticCount = 0;
  const retainedExisting = existing.filter((_, index) => !eligible[index] || automaticCount++ < keptAutomaticCount);
  // Duplicate checks never rotate away evidence or claim creation.
  let retained = duplicate ? existing : [
    { ...backup, ...(pinned ? { pinned: true } : { automatic: true }) },
    ...retainedExisting,
  ];
  let candidate = encodeVerified(retained);
  // Try fewer eligible automatic copies only when the existing over-budget store cannot grow.
  if (!pinned && !duplicate && raw !== null && bytes(candidate) > RECOVERY_SNAPSHOT_BUDGET_BYTES && candidate.length > raw.length) {
    for (let index = retained.length - 1; index > 0; index--) {
      const existingIndex = existing.indexOf(retained[index]);
      if (existingIndex < 0 || !eligible[existingIndex]) continue;
      retained = retained.filter((_, retainedIndex) => retainedIndex !== index);
      candidate = encodeVerified(retained);
      if (bytes(candidate) <= RECOVERY_SNAPSHOT_BUDGET_BYTES || candidate.length <= raw.length) break;
    }
  }
  const removedCount = duplicate ? 0 : existing.length + 1 - retained.length;
  const budgetExceeded = bytes(candidate) > RECOVERY_SNAPSHOT_BUDGET_BYTES;
  const safeReplacement = !pinned && !duplicate && removedCount > 0 && raw !== null && candidate.length <= raw.length;
  if (budgetExceeded && !duplicate && !safeReplacement) {
    throw new RecoverySnapshotError(`Local recovery snapshots exceed the 2 MiB storage budget (${bytes(candidate)} estimated candidate bytes; ${protectedBytes} protected bytes). No new snapshot was saved; all existing recovery evidence was preserved. No eligible non-growing replacement fits.`, "budget", true);
  }
  const serialized = candidate;
  const result: RecoverySnapshotResult = {
    status: duplicate ? "existing" : removedCount > 0 ? "replaced" : "created",
    compacted: duplicate && serialized !== raw,
    overBudget: 2 * (RECOVERY_SNAPSHOTS_STORAGE_KEY.length + serialized.length) > RECOVERY_SNAPSHOT_BUDGET_BYTES,
    estimatedBytes: 2 * (RECOVERY_SNAPSHOTS_STORAGE_KEY.length + serialized.length),
  };
  if (serialized === raw) return result;
  if (target.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY) !== raw) {
    throw new RecoverySnapshotError("Recovery history changed during preparation. No new snapshot was saved; the changed recovery evidence was left untouched.", "storage", false);
  }
  try {
    target.setItem(RECOVERY_SNAPSHOTS_STORAGE_KEY, serialized);
    if (target.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY) !== serialized) {
      throw new RecoverySnapshotError("Recovery snapshot write could not be verified.", "verification", false);
    }
    try {
      if (JSON.stringify(decodeRecoverySnapshots(target.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY))) !== JSON.stringify(retained)) {
        throw new Error("Reconstructed recovery data differs from the intended snapshots.");
      }
    } catch (error) {
      throw new RecoverySnapshotError(`Recovery-data reconstruction after writing could not be verified: ${error instanceof Error ? error.message : String(error)}`, "verification", false);
    }
  } catch (error) {
    try {
      if (target.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY) !== raw) {
        if (raw === null) target.removeItem(RECOVERY_SNAPSHOTS_STORAGE_KEY);
        else target.setItem(RECOVERY_SNAPSHOTS_STORAGE_KEY, raw);
      }
      if (target.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY) !== raw) throw new Error("Recovery history rollback verification failed.");
    } catch (rollbackError) {
      throw new RecoverySnapshotError(`Recovery snapshot failed and prior recovery history could not be restored: ${String(rollbackError)}. No business-store writes were started.`, "rollback", false);
    }
    const reason: RecoverySnapshotFailure = error instanceof RecoverySnapshotError ? error.reason
      : isPlainObject(error) && error.name === "QuotaExceededError" ? "quota" : "storage";
    throw new RecoverySnapshotError(`Recovery snapshot was not saved: ${error instanceof Error ? error.message : String(error)}. Previous recovery evidence was restored and verified; preserve an external backup and check available browser storage.`, reason, true);
  }
  return result;
}

export type ChangeField = { field: string; before: unknown; after: unknown };
export type ChangeEvent = {
  id: string;
  timestamp: string;
  recordType: string;
  recordId: string;
  recordTitle: string;
  actor: string;
  action: "Created" | "Updated" | "Status changed" | "Ownership changed" | "Deleted" | "Archived";
  changes: ChangeField[];
};

export function isValidChangeEvent(value: unknown): value is ChangeEvent {
  return isPlainObject(value)
    && [value.id, value.recordType, value.recordId, value.timestamp, value.actor, value.action].every((entry) => typeof entry === "string" && entry.trim().length > 0)
    && typeof value.recordTitle === "string"
    && ["Created", "Updated", "Status changed", "Ownership changed", "Deleted", "Archived"].includes(value.action as string)
    && !Number.isNaN(new Date(value.timestamp as string).getTime())
    && Array.isArray(value.changes)
    && value.changes.every((change: unknown) => isPlainObject(change) && typeof change.field === "string" && change.field.length > 0 && "before" in change && "after" in change);
}

export function validateEmpireOsBackup(value: unknown): EmpireOsBackup {
  if (!isPlainObject(value)) throw new Error("The selected file does not contain a JSON object.");
  if (value.format !== BACKUP_FORMAT) throw new Error("This is not an Empire OS full-backup file.");
  if (typeof value.version !== "number" || !SUPPORTED_BACKUP_VERSIONS.includes(value.version as typeof BACKUP_VERSION)) {
    throw new Error(`Backup version ${String(value.version)} is not supported. Supported version: ${BACKUP_VERSION}.`);
  }
  if (typeof value.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value.createdAt) || Number.isNaN(new Date(value.createdAt).getTime())) {
    throw new Error("The backup creation date is missing or invalid.");
  }
  if (!isPlainObject(value.storage)) throw new Error("The backup storage section is missing or invalid.");
  if (Object.keys(value.storage).length === 0) throw new Error("The backup storage section is empty.");

  const supportedKeys = new Set<string>(EMPIRE_OS_BACKUP_STORAGE_KEYS);
  const storage: Record<string, string | null> = {};
  for (const [key, storedValue] of Object.entries(value.storage)) {
    if (!supportedKeys.has(key)) throw new Error(`The backup contains an unsupported storage key: ${key}.`);
    if (storedValue !== null && typeof storedValue !== "string") {
      throw new Error(`The stored value for ${key} must be a string or null.`);
    }
    storage[key] = storedValue;
  }
  const includedStorageKeys = value.includedStorageKeys;
  if (includedStorageKeys !== undefined && (!Array.isArray(includedStorageKeys)
    || includedStorageKeys.length !== EMPIRE_OS_BACKUP_STORAGE_KEYS.length
    || new Set(includedStorageKeys).size !== EMPIRE_OS_BACKUP_STORAGE_KEYS.length
    || !EMPIRE_OS_BACKUP_STORAGE_KEYS.every((key) => includedStorageKeys.includes(key)
      && Object.prototype.hasOwnProperty.call(storage, key)))) {
    throw new Error("The backup completeness manifest is invalid or a declared business store is missing.");
  }

  const arrayStorageKeys = [
    STORAGE_KEY,
    CONVERSION_STORAGE_KEY,
    PERSON_STORAGE_KEY,
    PROJECT_STORAGE_KEY,
    LEAD_STORAGE_KEY,
    OUTREACH_STORAGE_KEY,
    DELEGATION_HANDOFF_STORAGE_KEY,
    INCOME_STORAGE_KEY,
    EXPENSE_STORAGE_KEY,
    COMMITMENT_STORAGE_KEY,
    TAX_PAYMENT_STORAGE_KEY,
    SAVED_VIEWS_STORAGE_KEY,
    DAILY_POSTURE_SNAPSHOTS_STORAGE_KEY,
    CHANGE_HISTORY_STORAGE_KEY,
    STRATEGIC_OBJECTIVES_STORAGE_KEY,
    STRATEGIC_REVIEWS_STORAGE_KEY,
    WORKING_RELATIONSHIP_STORAGE_KEY,
    ICARUS_STORAGE_KEY,
  ];
  for (const key of arrayStorageKeys) {
    const storedValue = storage[key];
    if (typeof storedValue !== "string") continue;
    try {
      if (!Array.isArray(JSON.parse(storedValue))) throw new Error();
    } catch {
      throw new Error(`The backup contains invalid array data for ${key}.`);
    }
  }

  const founderIntelligence = storage[FOUNDER_INTELLIGENCE_STORAGE_KEY];
  if (typeof founderIntelligence === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(founderIntelligence);
      if (!isPlainObject(parsed)) throw new Error();
    } catch {
      throw new Error(`The backup contains invalid object data for ${FOUNDER_INTELLIGENCE_STORAGE_KEY}.`);
    }
    assertFounderIntelligenceDataStructure(parsed);
  }

  const storedPeople = storage[PERSON_STORAGE_KEY];
  if (typeof storedPeople === "string") {
    const people: unknown = JSON.parse(storedPeople);
    if (Array.isArray(people)) {
      people.forEach((person: unknown) => {
        assertCapacityRecord(person, "Person");
        if (!isPlainObject(person) || !isPlainObject(person.operatingProfile)) return;
        if (Object.prototype.hasOwnProperty.call(person.operatingProfile, "individualUnderstandings")) {
          assertIndividualOperatingUnderstandingsDataStructure(person.operatingProfile.individualUnderstandings);
        }
      });
    }
  }

  const storedIcarus = storage[ICARUS_STORAGE_KEY];
  if (typeof storedIcarus === "string") {
    try {
      assertIcarusDataStructure(normaliseIcarusAssessmentData(JSON.parse(storedIcarus)));
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `The backup contains invalid Icarus data: ${error.message}`
          : "The backup contains invalid Icarus data.",
      );
    }
  }

  const storedConversions = storage[CONVERSION_STORAGE_KEY];
  const storedHandoffs = storage[DELEGATION_HANDOFF_STORAGE_KEY];
  if (typeof storedHandoffs === "string") assertDelegationHandoffs(JSON.parse(storedHandoffs));
  if (typeof storedConversions === "string") {
    const conversions: unknown = JSON.parse(storedConversions);
    if (Array.isArray(conversions)) {
      conversions.forEach((record: unknown) => {
        assertCapacityResolutionRecord(record);
        assertCommercialLessonRecord(record);
        if (!isPlainObject(record) || record.targetType !== "Convert to Action") return;
        assertCapacityRecord(record, "Action");
        assertIcarusObservationActionLinks(record.icarusObservationLinks);
        assertActionLeadLink(record.relatedLeadId);
        assertActionLeadLink(record.deliveryLeadId, "deliveryLeadId");
        assertActionFinanceLink(record.financeIncomeId, record.financeIncomeRole);
        assertIcarusObservationHandoffs(record.icarusObservationHandoffs);
        if (Object.prototype.hasOwnProperty.call(record, "responsibilityOutcomeEvidence")) {
          assertActionResponsibilityOutcomeEvidenceStructure(record.responsibilityOutcomeEvidence);
        }
      });
    }
  }

  for (const key of [LEAD_STORAGE_KEY, INCOME_STORAGE_KEY, EXPENSE_STORAGE_KEY]) {
    const stored = storage[key];
    if (typeof stored !== "string") continue;
    const records: unknown = JSON.parse(stored);
    if (!Array.isArray(records)) continue;
    records.forEach((record: unknown) => {
      if (key === LEAD_STORAGE_KEY) {
        if (!isPlainObject(record)) throw new Error("The backup contains a malformed Lead.");
        assertLeadDeliveryCommitment(record.deliveryCommitment);
        assertCapacityRecord(record, "Lead");
        assertLeadJobFinancialEvidence(record);
      } else if (key === INCOME_STORAGE_KEY) assertIncomeCommercialEvidence(record);
      else assertExpenseJobEvidence(record);
    });
  }

  if (typeof storage[CHANGE_HISTORY_STORAGE_KEY] === "string") {
    try {
      const events: unknown = JSON.parse(storage[CHANGE_HISTORY_STORAGE_KEY]);
      if (!Array.isArray(events) || !events.every(isValidChangeEvent)) throw new Error();
    } catch {
      throw new Error("The backup contains invalid change history events.");
    }
  }

  const cashValue = storage[CASH_POSITION_STORAGE_KEY];
  if (typeof cashValue === "string") {
    try {
      if (!isPlainObject(JSON.parse(cashValue))) throw new Error();
    } catch {
      throw new Error(`The backup contains invalid object data for ${CASH_POSITION_STORAGE_KEY}.`);
    }
  }

  return {
    format: BACKUP_FORMAT,
    version: value.version,
    createdAt: value.createdAt,
    storage,
    ...(value.includedStorageKeys !== undefined ? { includedStorageKeys: [...EMPIRE_OS_BACKUP_STORAGE_KEYS] } : {}),
  };
}

export function getBackupHealth(lastBackupAt: string, nowMs = Date.now()) {
  if (!lastBackupAt) return { label: "No backup recorded", tone: "text-[#6b655f]" };
  const backupMs = new Date(lastBackupAt).getTime();
  if (Number.isNaN(backupMs)) return { label: "No backup recorded", tone: "text-[#6b655f]" };
  const ageDays = Math.max(0, (nowMs - backupMs) / (1000 * 60 * 60 * 24));
  if (ageDays <= BACKUP_CURRENT_DAYS) return { label: "Current", tone: "text-[#315b45]" };
  if (ageDays <= BACKUP_STALE_DAYS) return { label: "Getting stale", tone: "text-[#755520]" };
  return { label: "Stale", tone: "text-[#7a352b]" };
}
import { assertFounderIntelligenceDataStructure } from "./founder-intelligence";
import { assertIndividualOperatingUnderstandingsDataStructure } from "./individual-operating-understanding";
import { assertActionResponsibilityOutcomeEvidenceStructure } from "./responsibility-task-intelligence";
