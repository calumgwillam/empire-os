import { assertBackupRecoveryReferences, EMPIRE_OS_BACKUP_STORAGE_KEYS, type BackupStorage } from "./backup";
import { backupStorageContent, sha256 } from "./independent-backup";
import { readStartupStorage } from "./startup-hydration";
import {
  hasOnlyFields, isBusinessKey, isIdempotencyKey, isObject, isSha256, validateDatasetFence,
  type ImportPlan, type PersistenceProblem, type StageImportRequest, type Validation,
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
    version: 1, sourceSha256,
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
    fingerprint = await sha256(backupStorageContent(storage));
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
  if (!isObject(value) || !hasOnlyFields(value, ["version", "sourceSha256", "entries"]) || value.version !== 1
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
    readStartupStorage({ getItem: (key) => storage[key] });
    assertBackupRecoveryReferences(storage);
  } catch (error) {
    return { status: "source-invalid", message: message(error) };
  }
  let fingerprint: string;
  try {
    fingerprint = await sha256(backupStorageContent(storage));
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
