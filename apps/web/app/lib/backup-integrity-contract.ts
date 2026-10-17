export type BackupIntegrity = Readonly<{
  version: 1;
  algorithm: "SHA-256";
  contentSha256: string;
  stores: Readonly<Record<string, string>>;
}>;

export function validateBackupIntegrity(value: unknown, keys: readonly string[]): BackupIntegrity {
  const object = (entry: unknown): entry is Record<string, unknown> =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry);
  const digest = (entry: unknown): entry is string => typeof entry === "string" && /^[a-f0-9]{64}$/.test(entry);
  if (!object(value) || Object.keys(value).length !== 4 || value.version !== 1 || value.algorithm !== "SHA-256"
    || !digest(value.contentSha256) || !object(value.stores)
    || Object.keys(value.stores).length !== keys.length || !keys.every(key =>
      Object.prototype.hasOwnProperty.call(value.stores, key) && object(value.stores) && digest(value.stores[key]))) {
    throw new Error("Backup integrity manifest is invalid or incomplete.");
  }
  const stores: Record<string, string> = {};
  for (const key of keys) {
    const entry = value.stores[key];
    if (!digest(entry)) throw new Error("Backup store fingerprint is invalid.");
    stores[key] = entry;
  }
  return { version: 1, algorithm: "SHA-256", contentSha256: value.contentSha256, stores };
}
