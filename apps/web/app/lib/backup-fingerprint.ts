import { EMPIRE_OS_BACKUP_STORAGE_KEYS, type EmpireOsBackup } from "./backup";

export type Digest = (value: string) => Promise<string>;

export async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function backupStorageContent(storage: EmpireOsBackup["storage"]): string {
  return JSON.stringify(EMPIRE_OS_BACKUP_STORAGE_KEYS.map(key => [key, storage[key]]));
}
