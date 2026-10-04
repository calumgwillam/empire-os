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
] as const;

export type EmpireOsBackup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  storage: Record<string, string | null>;
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
  };
}

export type BackupRestoreResult =
  | { ok: true }
  | { ok: false; error: unknown; writesStarted: boolean; rollbackFailures: string[] };

// beforeWrites runs after the pre-restore snapshot and before any live write; if it throws, nothing is written.
export function runBackupRestoreTransaction(target: BackupStorage, backup: EmpireOsBackup, beforeWrites?: () => void): BackupRestoreResult {
  const previousStorage: Record<string, string | null> = {};
  let writesStarted = false;

  try {
    validateEmpireOsBackup(backup);
    for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) previousStorage[key] = target.getItem(key);
    beforeWrites?.();

    writesStarted = true;
    for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) {
      const value = Object.prototype.hasOwnProperty.call(backup.storage, key) ? backup.storage[key] : null;
      if (value === null) target.removeItem(key);
      else target.setItem(key, value);
    }

    const failedKeys = EMPIRE_OS_BACKUP_STORAGE_KEYS.filter((key) => {
      const expected = Object.prototype.hasOwnProperty.call(backup.storage, key) ? backup.storage[key] : null;
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
        if (!isPlainObject(person) || !isPlainObject(person.operatingProfile)) return;
        if (Object.prototype.hasOwnProperty.call(person.operatingProfile, "individualUnderstandings")) {
          assertIndividualOperatingUnderstandingsDataStructure(person.operatingProfile.individualUnderstandings);
        }
      });
    }
  }

  const storedConversions = storage[CONVERSION_STORAGE_KEY];
  if (typeof storedConversions === "string") {
    const conversions: unknown = JSON.parse(storedConversions);
    if (Array.isArray(conversions)) {
      conversions.forEach((record: unknown) => {
        if (!isPlainObject(record) || record.targetType !== "Convert to Action") return;
        if (Object.prototype.hasOwnProperty.call(record, "responsibilityOutcomeEvidence")) {
          assertActionResponsibilityOutcomeEvidenceStructure(record.responsibilityOutcomeEvidence);
        }
      });
    }
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
