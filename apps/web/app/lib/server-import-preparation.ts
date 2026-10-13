import { assertBackupRecoveryReferences, EMPIRE_OS_BACKUP_STORAGE_KEYS, type BackupStorage, type EmpireOsBackup } from "./backup";
import { backupStorageContent } from "./independent-backup";
import { readStartupStorage, validateStartupStorageValues } from "./startup-hydration";
import {
  hasOnlyFields, isBusinessKey, isIdempotencyKey, isObject, isSha256, validateDatasetFence, validateSnapshot,
  type DatasetSnapshot, type ImportPlan, type PersistenceProblem, type StageImportRequest, type Validation,
} from "./server-persistence-contract";

type PreparationFailure =
  | { status: "source-invalid"; message: string }
  | { status: "source-changed"; message: string }
  | Extract<PersistenceProblem, { status: "failed" }>;
export type ImportPreparationResult = { status: "prepared"; plan: ImportPlan } | PreparationFailure;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function freezePlan(storage: Record<string, string | null>, sourceSha256: string): ImportPlan {
  return Object.freeze({
    version: 2, sourceSha256,
    entries: Object.freeze(EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => Object.freeze({ key, rawValue: storage[key] }))),
  });
}

export async function prepareServerImport(source: Pick<BackupStorage, "getItem">): Promise<ImportPreparationResult> {
  let storage: Record<string, string | null>;
  try {
    storage = readStartupStorage(source);
    assertBackupRecoveryReferences(storage);
  } catch (error) {
    return { status: "source-invalid", message: message(error) };
  }
  let fingerprint: string;
  try {
    fingerprint = await importSourceSha256(storage);
  } catch (error) {
    return { status: "failed", outcome: "not-submitted", message: `Source fingerprint could not be established: ${message(error)}` };
  }
  try {
    if (EMPIRE_OS_BACKUP_STORAGE_KEYS.some((key) => source.getItem(key) !== storage[key])) {
      return { status: "source-changed", message: "Legacy values changed during fingerprinting; prepare a new snapshot." };
    }
  } catch (error) {
    return { status: "source-invalid", message: message(error) };
  }
  // No reread can exclude a historical writer after this check. This is preparation, never activation.
  return { status: "prepared", plan: freezePlan(storage, fingerprint) };
}

// Recompute on the server; a submitted fingerprint is evidence to check, not authority to trust.
export async function verifyServerImportPlan(value: unknown): Promise<ImportPreparationResult> {
  if (!isObject(value) || !hasOnlyFields(value, ["version", "sourceSha256", "entries"]) || value.version !== 2
    || !isSha256(value.sourceSha256) || !Array.isArray(value.entries) || value.entries.length !== EMPIRE_OS_BACKUP_STORAGE_KEYS.length) {
    return { status: "source-invalid", message: "Import plan must contain all 21 stores and a SHA-256 fingerprint." };
  }
  const storage: Record<string, string | null> = {};
  const claimedFingerprint = value.sourceSha256;
  for (const entry of value.entries) {
    if (!isObject(entry) || !hasOnlyFields(entry, ["key", "rawValue"]) || !isBusinessKey(entry.key)
      || Object.prototype.hasOwnProperty.call(storage, entry.key)
      || (entry.rawValue !== null && typeof entry.rawValue !== "string")) {
      return { status: "source-invalid", message: "Import entries are invalid, unregistered or duplicated." };
    }
    storage[entry.key] = entry.rawValue;
  }
  try {
    validateStartupStorageValues(storage);
    assertBackupRecoveryReferences(storage);
  } catch (error) {
    return { status: "source-invalid", message: message(error) };
  }
  let fingerprint: string;
  try {
    fingerprint = await importSourceSha256(storage);
  } catch (error) {
    return { status: "failed", outcome: "not-submitted", message: `Import fingerprint verification failed: ${message(error)}` };
  }
  if (fingerprint !== claimedFingerprint) return { status: "source-invalid", message: "Import source fingerprint does not match its exact values." };
  return { status: "prepared", plan: freezePlan(storage, fingerprint) };
}

export async function validateStageImportRequest(value: unknown): Promise<Validation<StageImportRequest> | PreparationFailure> {
  if (!isObject(value) || !hasOnlyFields(value, ["fence", "idempotencyKey", "plan"]) || !isIdempotencyKey(value.idempotencyKey)) {
    return { status: "invalid-request", message: "Import request contains unsupported claims or an invalid idempotency key." };
  }
  const fence = validateDatasetFence(value.fence);
  if (fence.status !== "valid") return fence;
  const idempotencyKey = value.idempotencyKey;
  const verified = await verifyServerImportPlan(value.plan);
  if (verified.status !== "prepared") return verified;
  return { status: "valid", value: Object.freeze({ fence: fence.value, idempotencyKey, plan: verified.plan }) };
}

export function stageImportContent(request: StageImportRequest): string {
  return JSON.stringify([
    "empire-os-stage-import", request.fence.protocolVersion, request.fence.datasetId,
    request.fence.generation, request.fence.authorityRevision, request.idempotencyKey,
    request.plan.version, request.plan.sourceSha256,
    backupStorageContent(Object.fromEntries(request.plan.entries.map(({ key, rawValue }) => [key, rawValue]))),
  ]);
}

// A framed byte protocol makes the import source digest independently reproducible in PostgreSQL,
// including NULs and lone surrogates which PostgreSQL text and JSONB cannot represent.
export function importSourceContent(storage: EmpireOsBackup["storage"]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [encoder.encode("empire-os-import-source-v2\u0000")];
  for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) {
    const keyBytes = encoder.encode(key);
    if (keyBytes.length > 0xffff) throw new Error("Import source key exceeds the canonical encoding limit.");
    chunks.push(new Uint8Array([keyBytes.length >>> 8, keyBytes.length & 0xff]), keyBytes);
    const rawValue = storage[key];
    if (rawValue === null) {
      chunks.push(new Uint8Array([0]));
      continue;
    }
    const length = rawValue.length;
    if (!Number.isSafeInteger(length)) throw new Error("Import source value exceeds the canonical encoding limit.");
    const encodedLength = new Uint8Array(8);
    let remaining = length;
    for (let index = encodedLength.length - 1; index >= 0; index -= 1) {
      encodedLength[index] = remaining % 256;
      remaining = Math.floor(remaining / 256);
    }
    const rawBytes = encodeRawStoreValue(rawValue);
    if (rawBytes === null) throw new Error("Import source value encoding failed.");
    chunks.push(new Uint8Array([1]), encodedLength, rawBytes);
  }
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const content = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.length;
  }
  return content;
}

export async function importSourceSha256(storage: EmpireOsBackup["storage"]): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(importSourceContent(storage)).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type StageImportSnapshotVerification =
  | Readonly<{ status: "matches"; sourceSha256: string }>
  | Readonly<{ status: "mismatch"; reason: "fence" | "commit-shape" | "store-values" | "source-fingerprint" }>;

export async function verifyStageImportSnapshot(
  request: StageImportRequest,
  observed: unknown,
): Promise<StageImportSnapshotVerification> {
  const snapshot = validateSnapshot(observed);
  if (snapshot.status !== "valid") return { status: "mismatch", reason: "store-values" };
  const value = snapshot.value;
  if (value.datasetId !== request.fence.datasetId || value.protocolVersion !== request.fence.protocolVersion
    || value.generation !== request.fence.generation || value.authorityRevision !== request.fence.authorityRevision) {
    return { status: "mismatch", reason: "fence" };
  }
  if (value.commitSequence !== 1 || value.values.some((entry) => entry.revision !== 1)) {
    return { status: "mismatch", reason: "commit-shape" };
  }
  const source = Object.fromEntries(value.values.map(({ key, rawValue }) => [key, rawValue]));
  if (request.plan.entries.some((entry) => source[entry.key] !== entry.rawValue)) {
    return { status: "mismatch", reason: "store-values" };
  }
  if (await importSourceSha256(source) !== request.plan.sourceSha256) {
    return { status: "mismatch", reason: "source-fingerprint" };
  }
  return { status: "matches", sourceSha256: request.plan.sourceSha256 };
}

// PostgreSQL text and UTF-8 encoders cannot losslessly represent every localStorage UTF-16 string.
export function encodeRawStoreValue(value: string | null): Uint8Array | null {
  if (value === null) return null;
  const bytes = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    bytes[index * 2] = unit & 255;
    bytes[index * 2 + 1] = unit >>> 8;
  }
  return bytes;
}

export function decodeRawStoreValue(bytes: Uint8Array | null): string | null {
  if (bytes === null) return null;
  if (bytes.length % 2 !== 0) throw new Error("Raw store bytes contain an incomplete UTF-16 code unit.");
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    const units: number[] = [];
    for (let index = offset; index < Math.min(offset + 8192, bytes.length); index += 2) {
      units.push(bytes[index] | (bytes[index + 1] << 8));
    }
    chunks.push(String.fromCharCode(...units));
  }
  return chunks.join("");
}
