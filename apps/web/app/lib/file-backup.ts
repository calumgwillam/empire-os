import {
  BACKUP_CURRENT_DAYS, buildStableFullBackup, validateStandaloneBackup, type BackupStorage, type EmpireOsBackup,
} from "./backup";
import { backupStorageContent } from "./backup-fingerprint";
import { assertBrowserBusinessWritesAllowed } from "./browser-write-fence";
import { buildVerifiedFullBackup, verifyBackupIntegrity } from "./verified-backup";
import { runRecoveryDrill } from "./recovery-drill";

export const AUTOMATIC_BACKUP_PREFIX = "empire-os-auto-v1-";
export const MAX_BACKUP_FILE_BYTES = 64 * 1024 * 1024;
const MAX_INSPECTION_FILES = 1000;
const MAX_INSPECTION_BYTES = 128 * 1024 * 1024;

export interface BackupFileHandle {
  readonly kind: "file";
  getFile(): Promise<Pick<File, "size" | "text">>;
  createWritable(): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}

export interface BackupDirectory {
  readonly kind: "directory";
  readonly name: string;
  queryPermission(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<BackupFileHandle>;
  entries(): AsyncIterableIterator<[string, { readonly kind: string }]>;
  isSameEntry(other: BackupDirectory): Promise<boolean>;
}

export function isBackupDirectory(value: unknown): value is BackupDirectory {
  if (value === null || typeof value !== "object") return false;
  return "kind" in value && value.kind === "directory" && "name" in value && typeof value.name === "string"
    && ["queryPermission", "getFileHandle", "entries", "isSameEntry"].every(key =>
      key in value && typeof Reflect.get(value, key) === "function");
}

export type FileBackupPoint = Readonly<{ fileName: string; backup: EmpireOsBackup }>;
export type FileBackupInspection = Readonly<{
  points: readonly FileBackupPoint[];
  failures: readonly Readonly<{ fileName: string; message: string }>[];
}>;

export async function inspectBackupDirectory(directory: BackupDirectory, nowMs: number): Promise<FileBackupInspection> {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("Backup inspection clock is invalid.");
  if (await directory.queryPermission({ mode: "readwrite" }) !== "granted") {
    throw new Error("Backup folder permission is missing or revoked. Select the folder again to approve access.");
  }
  const names: string[] = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === "file" && name.startsWith(AUTOMATIC_BACKUP_PREFIX)) names.push(name);
    if (names.length > MAX_INSPECTION_FILES) {
      throw new Error("Backup folder exceeds the safe inspection limit. Files were preserved; select a new empty backup folder and retain this history.");
    }
  }
  const points: FileBackupPoint[] = [];
  const failures: { fileName: string; message: string }[] = [];
  let inspectedBytes = 0;
  for (const fileName of names.sort()) {
    try {
      const file = await (await directory.getFileHandle(fileName)).getFile();
      inspectedBytes += file.size;
      if (file.size > MAX_BACKUP_FILE_BYTES || inspectedBytes > MAX_INSPECTION_BYTES) {
        throw new Error("Backup folder exceeds the safe read budget. Files were preserved; inspect or archive this history before continuing.");
      }
      const verified = await verifyBackupIntegrity(JSON.parse(await file.text()));
      if (verified.integrity !== "sha256-verified") throw new Error("Automatic backup is missing its SHA-256 integrity manifest.");
      const backup = validateStandaloneBackup(verified.backup);
      if (Date.parse(backup.createdAt) > nowMs) throw new Error("Backup creation time is in the future.");
      runRecoveryDrill(JSON.stringify(backup));
      points.push({ fileName, backup });
    } catch (error) {
      failures.push({ fileName, message: error instanceof Error ? error.message : "Backup file could not be verified." });
    }
    if (inspectedBytes > MAX_INSPECTION_BYTES) {
      throw new Error("Backup folder inspection is incomplete: read budget exceeded. All files were preserved.");
    }
  }
  points.sort((left, right) => right.backup.createdAt.localeCompare(left.backup.createdAt));
  return { points, failures };
}

export type AutomaticFileBackupResult = Readonly<{
  status: "created" | "current" | "empty";
  checkedAt: string;
  fileName?: string;
  backupCreatedAt?: string;
  verifiedRecoveryPoints: number;
  damagedFiles: number;
  currentDataCovered: boolean;
}>;

// Only a user-approved directory is accepted. No network, credential, cloud,
// overwrite, retention deletion or live-restore capability exists in this adapter.
export class AutomaticFileBackups {
  private running = false;

  async check(directory: BackupDirectory, source: Pick<BackupStorage, "getItem">): Promise<AutomaticFileBackupResult> {
    if (this.running) throw new Error("A file backup check is already running; overlapping execution was refused.");
    if (typeof navigator === "undefined" || !navigator.locks) {
      throw new Error("Cross-tab backup locking is unavailable. Automatic file writing is blocked; manual export remains available.");
    }
    this.running = true;
    try {
      return await navigator.locks.request("empire-os-automatic-backup-files-v1",
        { mode: "exclusive", ifAvailable: true }, async lock => {
          if (!lock) throw new Error("Another browser tab is checking file backups. This check was skipped; retry after it completes.");
          return this.checkLocked(directory, source);
        });
    } finally {
      this.running = false;
    }
  }

  private async checkLocked(
    directory: BackupDirectory, source: Pick<BackupStorage, "getItem">,
  ): Promise<AutomaticFileBackupResult> {
    assertBrowserBusinessWritesAllowed(source);
    const nowMs = Date.now();
    const checkedAt = new Date(nowMs).toISOString();
    const inspection = await inspectBackupDirectory(directory, nowMs);
    const current = buildStableFullBackup(source, checkedAt);
    const rawContent = backupStorageContent(current.storage);
    const matching = inspection.points.find(point => backupStorageContent(point.backup.storage) === rawContent);
    const base = {
      checkedAt, verifiedRecoveryPoints: inspection.points.length, damagedFiles: inspection.failures.length,
    };
    if (matching && nowMs - Date.parse(matching.backup.createdAt) <= BACKUP_CURRENT_DAYS * 86400000) {
      return { ...base, status: "current", currentDataCovered: true,
        fileName: matching.fileName, backupCreatedAt: matching.backup.createdAt };
    }
    if (Object.values(current.storage).every(value => value === null)) {
      return { ...base, status: "empty", currentDataCovered: false };
    }
    const backup = await buildVerifiedFullBackup(source, checkedAt);
    const text = JSON.stringify(backup, null, 2);
    if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_FILE_BYTES) {
      throw new Error("The full backup exceeds the safe file size limit. Existing recovery points were preserved.");
    }
    const fileName = `${AUTOMATIC_BACKUP_PREFIX}${checkedAt.replace(/[:.]/g, "-")}-${crypto.randomUUID()}.json`;
    try {
      await directory.getFileHandle(fileName);
      throw new Error("Backup filename already exists; overwriting a recovery point is forbidden.");
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "NotFoundError") throw error;
    }
    assertBrowserBusinessWritesAllowed(source);
    if (backupStorageContent(buildStableFullBackup(source).storage) !== backupStorageContent(backup.storage)) {
      throw new Error("Business data changed before backup writing; retry after writes settle.");
    }
    const handle = await directory.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(text);
      await writable.close();
    } catch (error) {
      try {
        await writable.abort();
      } catch {
        throw new Error("Backup file writing failed and cleanup could not be confirmed. Earlier files were not modified; inspect the new partial file.");
      }
      throw error;
    }
    const readBack = await handle.getFile();
    if (readBack.size > MAX_BACKUP_FILE_BYTES || await readBack.text() !== text) {
      throw new Error("Backup file read-back differs from the intended full backup. Earlier files were preserved; the new file is not verified.");
    }
    const verified = await verifyBackupIntegrity(JSON.parse(text));
    runRecoveryDrill(JSON.stringify(verified.backup));
    assertBrowserBusinessWritesAllowed(source);
    const currentDataCovered = backupStorageContent(buildStableFullBackup(source).storage) === backupStorageContent(backup.storage);
    return { ...base, status: "created", fileName, backupCreatedAt: backup.createdAt,
      verifiedRecoveryPoints: inspection.points.length + 1, currentDataCovered };
  }
}
