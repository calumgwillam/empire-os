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

// beforeWrites runs after the pre-restore snapshot and before any live write; if it throws, nothing is written.
export function runBackupRestoreTransaction(target: BackupStorage, backup: EmpireOsBackup, beforeWrites?: (safetyBackup: EmpireOsBackup) => void): BackupRestoreResult {
  const previousStorage: Record<string, string | null> = {};
  let writesStarted = false;

  try {
    const validated = validateEmpireOsBackup(backup);
    for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) previousStorage[key] = target.getItem(key);
    const effective = validateEmpireOsBackup({ ...validated, storage: { ...previousStorage, ...validated.storage } });
    const referenceIssues = getRecoveryReferenceIssues({
      conversions: effective.storage[CONVERSION_STORAGE_KEY], leads: effective.storage[LEAD_STORAGE_KEY],
      people: effective.storage[PERSON_STORAGE_KEY], projects: effective.storage[PROJECT_STORAGE_KEY],
      income: effective.storage[INCOME_STORAGE_KEY], expenses: effective.storage[EXPENSE_STORAGE_KEY],
      commitments: effective.storage[COMMITMENT_STORAGE_KEY], icarus: effective.storage[ICARUS_STORAGE_KEY],
    });
    if (referenceIssues.length) throw new Error(`Restore would leave inconsistent record references: ${referenceIssues.join("; ")}`);
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

export function retainRecoverySnapshot(target: BackupStorage, backup: EmpireOsBackup, pinned = false): void {
  const raw = target.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY);
  const existing: unknown = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(existing) || !existing.every((entry: unknown) => isPlainObject(entry)
    && typeof entry.createdAt === "string" && isPlainObject(entry.storage)
    && Object.values(entry.storage).every((value) => value === null || typeof value === "string")
    && (entry.pinned === undefined || typeof entry.pinned === "boolean"))) {
    throw new Error("Existing recovery history is malformed; it was preserved instead of overwritten.");
  }
  if (!pinned && existing.some((entry) => JSON.stringify(entry.storage) === JSON.stringify(backup.storage))) return;
  const snapshots = [
    { ...backup, ...(pinned ? { pinned: true } : {}) },
    ...existing.filter((entry) => entry.pinned === true),
    ...existing.filter((entry) => entry.pinned !== true).slice(0, pinned ? 5 : 4),
  ];
  const serialized = JSON.stringify(snapshots);
  try {
    target.setItem(RECOVERY_SNAPSHOTS_STORAGE_KEY, serialized);
    if (target.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY) !== serialized) throw new Error("Recovery snapshot write could not be verified.");
  } catch (error) {
    try {
      if (target.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY) !== raw) {
        if (raw === null) target.removeItem(RECOVERY_SNAPSHOTS_STORAGE_KEY);
        else target.setItem(RECOVERY_SNAPSHOTS_STORAGE_KEY, raw);
      }
      if (target.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY) !== raw) throw new Error("Recovery history rollback verification failed.");
    } catch (rollbackError) {
      throw new Error(`Recovery snapshot failed and prior recovery history could not be restored: ${String(rollbackError)}. No business-store writes were started.`);
    }
    throw error;
  }
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
