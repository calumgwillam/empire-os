import { buildFullBackup, validateEmpireOsBackup, isPlainObject, EMPIRE_OS_BACKUP_STORAGE_KEYS,
  RESTORE_INTERRUPTION_STORAGE_KEY,
  BACKUP_FORMAT, BACKUP_VERSION,
  CASH_POSITION_STORAGE_KEY, FOUNDER_INTELLIGENCE_STORAGE_KEY, DEFAULT_SAVED_VIEW_STORAGE_KEY,
  SAVED_VIEWS_STORAGE_KEY, DAILY_POSTURE_SNAPSHOTS_STORAGE_KEY,
  STRATEGIC_OBJECTIVES_STORAGE_KEY, STRATEGIC_REVIEWS_STORAGE_KEY, type BackupStorage } from "./backup";
import { isStrategicObjectiveRecord, isStrategicReview } from "./strategic-reviews";

export function validateSavedViews(raw: string | null): void {
  if (raw === null) return;
  const views: unknown = JSON.parse(raw);
  if (!Array.isArray(views) || !views.every((view: unknown) => isPlainObject(view)
    && typeof view.id === "string" && view.id.length > 0 && typeof view.name === "string"
    && isPlainObject(view.controls)
    && Object.entries(view.controls).every(([key, value]) =>
      key === "attentionOnly" || key === "inMotionOnly" ? typeof value === "boolean" : typeof value === "string"))) {
    throw new Error("Saved views are malformed; existing view data must be recovered before saving.");
  }
}

export function validateStartupStorageValues(values: Record<string, string | null>): Record<string, string | null> {
  if (Object.keys(values).length !== EMPIRE_OS_BACKUP_STORAGE_KEYS.length
    || EMPIRE_OS_BACKUP_STORAGE_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(values, key))) {
    throw new Error("Business data must contain every registered store exactly once.");
  }
  const backup = validateEmpireOsBackup({
    format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(), storage: values,
  });
  for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) {
    const raw = backup.storage[key];
    if (raw === null || key === DEFAULT_SAVED_VIEW_STORAGE_KEY) continue;
    if (key === CASH_POSITION_STORAGE_KEY || key === FOUNDER_INTELLIGENCE_STORAGE_KEY) continue;
    const records: unknown = JSON.parse(raw);
    if (!Array.isArray(records) || !records.every(isPlainObject)) {
      throw new Error(`${key} contains malformed records; startup persistence remains blocked.`);
    }
    if (key === SAVED_VIEWS_STORAGE_KEY) validateSavedViews(raw);
    if (key === DAILY_POSTURE_SNAPSHOTS_STORAGE_KEY
      && !records.every((record) => typeof record.date === "string")) {
      throw new Error("Daily posture history contains malformed snapshots; startup persistence remains blocked.");
    }
    if (key === STRATEGIC_OBJECTIVES_STORAGE_KEY && !records.every(isStrategicObjectiveRecord)) {
      throw new Error("Strategic objectives are malformed; startup persistence remains blocked.");
    }
    if (key === STRATEGIC_REVIEWS_STORAGE_KEY && !records.every(isStrategicReview)) {
      throw new Error("Strategic reviews are malformed; startup persistence remains blocked.");
    }
  }
  return backup.storage;
}

export function readStartupStorage(source: Pick<BackupStorage, "getItem">): Record<string, string | null> {
  if (source.getItem(RESTORE_INTERRUPTION_STORAGE_KEY) !== null) {
    throw new Error("A previous multi-store restore was interrupted. Startup writes are blocked; inspect the retained recovery snapshot and explicitly restore a complete verified backup.");
  }
  const backup = buildFullBackup(source);
  const storage = validateStartupStorageValues(backup.storage);
  if (EMPIRE_OS_BACKUP_STORAGE_KEYS.some((key) => source.getItem(key) !== backup.storage[key])) {
    throw new Error("Stored data changed during startup validation; reload before enabling persistence.");
  }
  return storage;
}
