import { buildFullBackup, EMPIRE_OS_BACKUP_STORAGE_KEYS, runBackupRestoreTransaction,
  validateEmpireOsBackup, validateStandaloneBackup, type BackupStorage } from "./backup";

export function runRecoveryDrill(text: string) {
  const backup = validateEmpireOsBackup(JSON.parse(text));
  // Never accept a caller-supplied storage target: the production restore can only write to this private map.
  const data = new Map<string, string>();
  const isolated: BackupStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
  const result = runBackupRestoreTransaction(isolated, backup);
  if (!result.ok) {
    const detail = result.error instanceof Error ? result.error.message : String(result.error);
    throw new Error(`Isolated recovery drill failed: ${detail}${result.rollbackFailures.length
      ? ` Isolated rollback could not be verified for: ${result.rollbackFailures.join(", ")}.` : ""} Live storage was not accessed.`);
  }
  const failedKeys = EMPIRE_OS_BACKUP_STORAGE_KEYS.filter((key) => isolated.getItem(key) !== (backup.storage[key] ?? null));
  if (failedKeys.length) throw new Error(`Isolated recovery drill read-back failed for: ${failedKeys.join(", ")}. Live storage was not accessed.`);
  const restored = validateStandaloneBackup(buildFullBackup(isolated, backup.createdAt));
  const missingStorageKeys = EMPIRE_OS_BACKUP_STORAGE_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(backup.storage, key));
  return { restored, checkedStoreCount: EMPIRE_OS_BACKUP_STORAGE_KEYS.length, missingStorageKeys };
}
