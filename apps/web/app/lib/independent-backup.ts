import { buildFullBackup, EMPIRE_OS_BACKUP_STORAGE_KEYS, isPlainObject, validateStandaloneBackup,
  BACKUP_CURRENT_DAYS, BACKUP_STALE_DAYS, type BackupStorage, type EmpireOsBackup } from "./backup";
import { persistJsonArraysTransaction } from "./persistence";

export const BACKUP_VERIFICATIONS_STORAGE_KEY = "empire-os-backup-file-verifications-v1";
export type BackupFileVerification = {
  id: string; fileName: string; fileSha256: string; storageSha256: string; backupCreatedAt: string; verifiedAt: string;
  verifier: string; externalLocation: string; independenceDeclared: true; storeCount: number;
};
export type Digest = (value: string) => Promise<string>;

export async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function backupStorageContent(storage: EmpireOsBackup["storage"]): string {
  return JSON.stringify(EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => [key, storage[key]]));
}

export function readBackupVerifications(storage: Pick<BackupStorage, "getItem">): BackupFileVerification[] {
  const raw = storage.getItem(BACKUP_VERIFICATIONS_STORAGE_KEY);
  if (raw === null) return [];
  const records: unknown = JSON.parse(raw);
  if (!Array.isArray(records) || !records.every((record: unknown) => isPlainObject(record)
    && ["id", "fileName", "verifier", "externalLocation"].every((field) => typeof record[field] === "string" && Boolean(record[field].trim()))
    && ["fileSha256", "storageSha256"].every((field) => typeof record[field] === "string" && /^[a-f0-9]{64}$/.test(record[field]))
    && ["backupCreatedAt", "verifiedAt"].every((field) => typeof record[field] === "string"
      && /^\d{4}-\d{2}-\d{2}T/.test(record[field]) && Number.isFinite(Date.parse(record[field])))
    && typeof record.backupCreatedAt === "string" && typeof record.verifiedAt === "string"
    && Date.parse(record.backupCreatedAt) <= Date.parse(record.verifiedAt)
    && record.independenceDeclared === true && record.storeCount === EMPIRE_OS_BACKUP_STORAGE_KEYS.length)) {
    throw new Error("Backup verification history is malformed; stored evidence was preserved. It cannot establish a verified external copy.");
  }
  const typed = records as BackupFileVerification[];
  if (new Set(typed.map((record) => record.id)).size !== typed.length) throw new Error("Backup verification identities are duplicated; reconcile stored verification evidence.");
  return typed;
}

export async function verifyBackupFile(text: string, request: {
  fileName: string; verifier: string; externalLocation: string; independenceDeclared: boolean; nowMs: number;
}, digest: Digest = sha256): Promise<BackupFileVerification> {
  if (!request.fileName.trim() || !request.verifier.trim() || !request.externalLocation.trim() || !request.independenceDeclared) {
    throw new Error("Name the verifier and external copy location, and explicitly confirm it is outside this browser and available independently of this device.");
  }
  if (!Number.isFinite(request.nowMs)) throw new Error("Backup verification requires a valid clock.");
  const backup = validateStandaloneBackup(JSON.parse(text));
  if (Date.parse(backup.createdAt) > request.nowMs) throw new Error("Backup creation is in the future; check the file and clock before verification.");
  const [fileSha256, storageSha256] = await Promise.all([digest(text), digest(backupStorageContent(backup.storage))]);
  if (![fileSha256, storageSha256].every((value) => /^[a-f0-9]{64}$/.test(value))) throw new Error("Backup fingerprint could not be established.");
  const verifiedAt = new Date(request.nowMs).toISOString();
  return { id: `${verifiedAt}:${fileSha256}`, fileName: request.fileName.trim(), fileSha256, storageSha256,
    backupCreatedAt: backup.createdAt, verifiedAt, verifier: request.verifier.trim(),
    externalLocation: request.externalLocation.trim(), independenceDeclared: true, storeCount: EMPIRE_OS_BACKUP_STORAGE_KEYS.length };
}

export function recordBackupVerification(storage: BackupStorage, record: BackupFileVerification): void {
  const current = readBackupVerifications(storage);
  if (current.some((entry) => entry.id === record.id)) throw new Error("This file verification is already recorded.");
  const next = [...current, record];
  readBackupVerifications({ getItem: () => JSON.stringify(next) });
  persistJsonArraysTransaction(storage, [{ key: BACKUP_VERIFICATIONS_STORAGE_KEY, records: next }]);
}

export async function currentBackupStorageDigest(storage: Pick<BackupStorage, "getItem">, digest: Digest = sha256): Promise<string> {
  return digest(backupStorageContent(buildFullBackup(storage).storage));
}

export function independentBackupHealth(records: readonly BackupFileVerification[], currentDigest: string, nowMs: number): {
  label: string; warning: boolean; verification?: BackupFileVerification;
} {
  const valid = records.filter((record) => Date.parse(record.verifiedAt) <= nowMs && Date.parse(record.backupCreatedAt) <= Date.parse(record.verifiedAt));
  const matching = valid.filter((record) => record.storageSha256 === currentDigest)
    .sort((left, right) => right.backupCreatedAt.localeCompare(left.backupCreatedAt) || right.verifiedAt.localeCompare(left.verifiedAt));
  const verification = matching[0] || [...valid].sort((left, right) => right.verifiedAt.localeCompare(left.verifiedAt))[0];
  if (!verification) return { label: "No verified external backup file", warning: true };
  if (!matching.length) return { label: "Verified file exists; current data is not covered", warning: true, verification };
  const ageDays = (nowMs - Date.parse(verification.backupCreatedAt)) / 86400000;
  if (ageDays > BACKUP_STALE_DAYS) return { label: "Verified matching file is stale", warning: true, verification };
  if (ageDays > BACKUP_CURRENT_DAYS) return { label: "Verified matching file is getting stale", warning: true, verification };
  return { label: "Verified file matches current stored data", warning: false, verification };
}
