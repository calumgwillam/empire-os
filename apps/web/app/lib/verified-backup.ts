import {
  buildStableFullBackup, EMPIRE_OS_BACKUP_STORAGE_KEYS, validateEmpireOsBackup, validateStandaloneBackup,
  type BackupStorage, type EmpireOsBackup,
} from "./backup";
import { backupStorageContent, sha256, type Digest } from "./backup-fingerprint";
import { runRecoveryDrill } from "./recovery-drill";
import { assertBrowserBusinessWritesAllowed } from "./browser-write-fence";

function content(backup: EmpireOsBackup): string {
  return JSON.stringify([backup.format, backup.version, backup.createdAt, backupStorageContent(backup.storage)]);
}

// Digests detect corruption, not authentic authorship, encryption or off-device durability.
export async function sealFullBackup(value: unknown, digest: Digest = sha256): Promise<EmpireOsBackup> {
  const backup = validateStandaloneBackup(value);
  const stores: Record<string, string> = {};
  await Promise.all(EMPIRE_OS_BACKUP_STORAGE_KEYS.map(async key => {
    stores[key] = await digest(JSON.stringify([key, backup.storage[key]]));
  }));
  const sealed: EmpireOsBackup = {
    ...backup, includedStorageKeys: [...EMPIRE_OS_BACKUP_STORAGE_KEYS],
    integrity: { version: 1, algorithm: "SHA-256", contentSha256: await digest(content(backup)), stores },
  };
  return validateStandaloneBackup(sealed);
}

export async function verifyBackupIntegrity(
  value: unknown, digest: Digest = sha256,
): Promise<{ backup: EmpireOsBackup; integrity: "sha256-verified" | "legacy-unsealed" }> {
  const backup = validateEmpireOsBackup(value);
  if (!backup.integrity) return { backup, integrity: "legacy-unsealed" };
  validateStandaloneBackup(backup);
  const expected = backup.integrity;
  const actual = await sealFullBackup({ ...backup, integrity: undefined }, digest);
  if (!actual.integrity || actual.integrity.contentSha256 !== expected.contentSha256
    || EMPIRE_OS_BACKUP_STORAGE_KEYS.some(key => actual.integrity?.stores[key] !== expected.stores[key])) {
    throw new Error("Backup SHA-256 verification failed. Preserve the file; no recovery data was approved.");
  }
  return { backup, integrity: "sha256-verified" };
}

export async function buildVerifiedFullBackup(
  source: Pick<BackupStorage, "getItem">, createdAt = new Date().toISOString(),
): Promise<EmpireOsBackup> {
  assertBrowserBusinessWritesAllowed(source);
  const captured = buildStableFullBackup(source, createdAt);
  const sealed = await sealFullBackup(captured);
  runRecoveryDrill(JSON.stringify(sealed));
  assertBrowserBusinessWritesAllowed(source);
  if (backupStorageContent(buildStableFullBackup(source).storage) !== backupStorageContent(captured.storage)) {
    throw new Error("Business data changed during backup verification; no current-data coverage was established.");
  }
  return sealed;
}

export type RestoreReviewFence = Readonly<Record<string, string | null>>;

export function captureRestoreReviewFence(source: Pick<BackupStorage, "getItem">): RestoreReviewFence {
  return Object.freeze({ ...buildStableFullBackup(source).storage });
}

export function assertRestoreReviewFence(
  source: Pick<BackupStorage, "getItem">, expected: RestoreReviewFence,
): void {
  if (Object.keys(expected).length !== EMPIRE_OS_BACKUP_STORAGE_KEYS.length
    || EMPIRE_OS_BACKUP_STORAGE_KEYS.some(key =>
      !Object.prototype.hasOwnProperty.call(expected, key) || source.getItem(key) !== expected[key])) {
    throw new Error("Business data changed since this restore was reviewed. Nothing was restored; select and review the backup again.");
  }
}
