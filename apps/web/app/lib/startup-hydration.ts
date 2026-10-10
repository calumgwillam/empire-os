import { buildFullBackup, validateEmpireOsBackup, isPlainObject, EMPIRE_OS_BACKUP_STORAGE_KEYS,
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

export function readStartupStorage(source: Pick<BackupStorage, "getItem">): Record<string, string | null> {
  const backup = buildFullBackup(source);
  validateEmpireOsBackup(backup);
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
  if (EMPIRE_OS_BACKUP_STORAGE_KEYS.some((key) => source.getItem(key) !== backup.storage[key])) {
    throw new Error("Stored data changed during startup validation; reload before enabling persistence.");
  }
  return backup.storage;
}
