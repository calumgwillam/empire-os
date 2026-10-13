import { EMPIRE_OS_BACKUP_STORAGE_KEYS, RECOVERY_SNAPSHOTS_STORAGE_KEY, type BackupStorage } from "./backup";
import { assertBrowserBusinessWritesAllowed, BrowserWriteFenceError, setBrowserBusinessItem } from "./browser-write-fence";
import { encodeRawStoreValue, importSourceSha256 } from "./server-import-preparation";

export const EXCEPTIONAL_RECOVERY_EVIDENCE_FORMAT = "empire-os-exceptional-recovery-evidence";
export const EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION = 1;
export const EXCEPTIONAL_RECOVERY_EVIDENCE_PURPOSE =
  "preserve-readable-corrupt-recovery-history-and-pre-restore-business-state";
export const EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY = "empire-os-exceptional-recovery-evidence-v1";

type ExceptionalRecoveryEvidenceFields = Readonly<{
  format: typeof EXCEPTIONAL_RECOVERY_EVIDENCE_FORMAT;
  version: typeof EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION;
  purpose: typeof EXCEPTIONAL_RECOVERY_EVIDENCE_PURPOSE;
  recoveryHistory: Readonly<{ present: boolean; rawValue: string | null }>;
  recoveryHistorySha256: string;
  stores: Readonly<Record<string, string | null>>;
  storesSha256: string;
}>;

export type ExceptionalRecoveryEvidence = ExceptionalRecoveryEvidenceFields & Readonly<{
  evidenceSha256: string;
}>;

export type ExceptionalRecoveryEvidenceStorage = Pick<BackupStorage, "getItem" | "setItem">;

export type ExceptionalRecoveryEvidenceErrorCode =
  | "marker-present"
  | "storage-unavailable"
  | "slot-occupied"
  | "source-changed"
  | "write-failed"
  | "readback-failed"
  | "invalid-evidence";

export class ExceptionalRecoveryEvidenceError extends Error {
  constructor(
    readonly code: ExceptionalRecoveryEvidenceErrorCode,
    message: string,
    readonly evidenceMayExist: boolean,
    cause?: unknown,
  ) {
    super(message);
    this.name = "ExceptionalRecoveryEvidenceError";
    if (cause !== undefined) Object.defineProperty(this, "cause", { value: cause });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function historyContent(history: { present: boolean; rawValue: string | null }): Uint8Array {
  const header = new TextEncoder().encode("empire-os-exceptional-recovery-history-v1\u0000");
  const rawBytes = encodeRawStoreValue(history.rawValue);
  if (history.present !== (rawBytes !== null)) throw new Error("Recovery-history presence does not match its raw value.");
  const length = rawBytes?.length ?? 0;
  const encodedLength = new Uint8Array(8);
  let remaining = length / 2;
  for (let index = encodedLength.length - 1; index >= 0; index -= 1) {
    encodedLength[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  const output = new Uint8Array(header.length + 1 + (history.present ? encodedLength.length + length : 0));
  output.set(header);
  output[header.length] = history.present ? 1 : 0;
  if (history.present) {
    output.set(encodedLength, header.length + 1);
    output.set(rawBytes!, header.length + 1 + encodedLength.length);
  }
  return output;
}

function evidenceContent(value: ExceptionalRecoveryEvidenceFields): string {
  return JSON.stringify([
    value.format,
    value.version,
    value.purpose,
    value.recoveryHistory.present,
    value.recoveryHistory.rawValue,
    value.recoveryHistorySha256,
    value.storesSha256,
  ]);
}

async function readStableSource(
  source: Pick<BackupStorage, "getItem">,
): Promise<{ recoveryHistory: { present: boolean; rawValue: string | null }; stores: Record<string, string | null> }> {
  try {
    assertBrowserBusinessWritesAllowed(source);
    const readOnce = () => {
      const stores: Record<string, string | null> = {};
      for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) stores[key] = source.getItem(key);
      const rawValue = source.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY);
      return { stores, recoveryHistory: { present: rawValue !== null, rawValue } };
    };
    const first = readOnce();
    const second = readOnce();
    if (EMPIRE_OS_BACKUP_STORAGE_KEYS.some((key) => first.stores[key] !== second.stores[key])
      || first.recoveryHistory.present !== second.recoveryHistory.present
      || first.recoveryHistory.rawValue !== second.recoveryHistory.rawValue) {
      throw new ExceptionalRecoveryEvidenceError("source-changed",
        "Business stores or recovery history changed during evidence capture; no evidence was prepared.", false);
    }
    return first;
  } catch (error) {
    if (error instanceof ExceptionalRecoveryEvidenceError) throw error;
    if (error instanceof BrowserWriteFenceError && error.reason === "interrupted") {
      throw new ExceptionalRecoveryEvidenceError("marker-present",
        "Exceptional recovery evidence preparation is blocked while the restore-interruption marker exists.", false, error);
    }
    throw new ExceptionalRecoveryEvidenceError("storage-unavailable",
      "Browser restore-interruption state or source storage could not be read; evidence capture is blocked.", false, error);
  }
}

async function buildEvidence(
  values: Awaited<ReturnType<typeof readStableSource>>,
): Promise<ExceptionalRecoveryEvidence> {
  const recoveryHistorySha256 = await sha256(historyContent(values.recoveryHistory));
  const storesSha256 = await importSourceSha256(values.stores);
  const fields: ExceptionalRecoveryEvidenceFields = {
    format: EXCEPTIONAL_RECOVERY_EVIDENCE_FORMAT,
    version: EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION,
    purpose: EXCEPTIONAL_RECOVERY_EVIDENCE_PURPOSE,
    recoveryHistory: Object.freeze({ ...values.recoveryHistory }),
    recoveryHistorySha256,
    stores: Object.freeze(Object.fromEntries(EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => [key, values.stores[key]]))),
    storesSha256,
  };
  return Object.freeze({ ...fields, evidenceSha256: await sha256(evidenceContent(fields)) });
}

export async function createExceptionalRecoveryEvidence(
  source: Pick<BackupStorage, "getItem">,
): Promise<ExceptionalRecoveryEvidence> {
  return buildEvidence(await readStableSource(source));
}

export async function validateExceptionalRecoveryEvidence(value: unknown): Promise<ExceptionalRecoveryEvidence> {
  if (!isObject(value)) {
    throw new ExceptionalRecoveryEvidenceError("invalid-evidence",
      "Exceptional recovery evidence has an unsupported format, incomplete store inventory, or malformed value.", false);
  }
  const storesValue = value.stores;
  if (!isObject(storesValue)) {
    throw new ExceptionalRecoveryEvidenceError("invalid-evidence",
      "Exceptional recovery evidence has an unsupported format, incomplete store inventory, or malformed value.", false);
  }
  if (!hasExactFields(value, [
    "format", "version", "purpose", "recoveryHistory", "recoveryHistorySha256", "stores", "storesSha256", "evidenceSha256",
  ]) || value.format !== EXCEPTIONAL_RECOVERY_EVIDENCE_FORMAT
    || value.version !== EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION
    || value.purpose !== EXCEPTIONAL_RECOVERY_EVIDENCE_PURPOSE
    || !isObject(value.recoveryHistory)
    || !hasExactFields(value.recoveryHistory, ["present", "rawValue"])
    || typeof value.recoveryHistory.present !== "boolean"
    || (value.recoveryHistory.rawValue !== null && typeof value.recoveryHistory.rawValue !== "string")
    || value.recoveryHistory.present !== (value.recoveryHistory.rawValue !== null)
    || Object.keys(storesValue).length !== EMPIRE_OS_BACKUP_STORAGE_KEYS.length
    || EMPIRE_OS_BACKUP_STORAGE_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(storesValue, key)
      || (storesValue[key] !== null && typeof storesValue[key] !== "string"))
    || !isSha256(value.recoveryHistorySha256) || !isSha256(value.storesSha256) || !isSha256(value.evidenceSha256)) {
    throw new ExceptionalRecoveryEvidenceError("invalid-evidence",
      "Exceptional recovery evidence has an unsupported format, incomplete store inventory, or malformed value.", false);
  }

  const history = { present: value.recoveryHistory.present, rawValue: value.recoveryHistory.rawValue };
  const stores: Record<string, string | null> = {};
  for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) {
    const rawValue = storesValue[key];
    if (rawValue !== null && typeof rawValue !== "string") {
      throw new ExceptionalRecoveryEvidenceError("invalid-evidence",
        `Exceptional recovery evidence contains a malformed value for ${key}.`, false);
    }
    stores[key] = rawValue;
  }
  const fields: ExceptionalRecoveryEvidenceFields = {
    format: EXCEPTIONAL_RECOVERY_EVIDENCE_FORMAT,
    version: EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION,
    purpose: EXCEPTIONAL_RECOVERY_EVIDENCE_PURPOSE,
    recoveryHistory: history,
    recoveryHistorySha256: value.recoveryHistorySha256,
    stores,
    storesSha256: value.storesSha256,
  };
  if (await sha256(historyContent(history)) !== value.recoveryHistorySha256
    || await importSourceSha256(stores) !== value.storesSha256
    || await sha256(evidenceContent(fields)) !== value.evidenceSha256) {
    throw new ExceptionalRecoveryEvidenceError("invalid-evidence",
      "Exceptional recovery evidence fingerprints do not match the exact retained values.", false);
  }
  return Object.freeze({
    ...fields,
    recoveryHistory: Object.freeze(history),
    stores: Object.freeze(stores),
    evidenceSha256: value.evidenceSha256,
  });
}

export async function encodeExceptionalRecoveryEvidence(value: unknown): Promise<string> {
  const validated = await validateExceptionalRecoveryEvidence(value);
  const serialized = JSON.stringify(validated);
  const roundTripped = await decodeExceptionalRecoveryEvidence(serialized);
  if (JSON.stringify(roundTripped) !== serialized) {
    throw new ExceptionalRecoveryEvidenceError("invalid-evidence",
      "Exceptional recovery evidence failed exact serialization round-trip verification.", false);
  }
  return serialized;
}

export async function decodeExceptionalRecoveryEvidence(raw: string): Promise<ExceptionalRecoveryEvidence> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ExceptionalRecoveryEvidenceError("invalid-evidence",
      "Exceptional recovery evidence is not valid JSON.", false, error);
  }
  return validateExceptionalRecoveryEvidence(parsed);
}

export async function prepareExceptionalRecoveryEvidence(
  source: Pick<BackupStorage, "getItem">,
  target: ExceptionalRecoveryEvidenceStorage,
): Promise<ExceptionalRecoveryEvidence> {
  let occupied: string | null;
  try {
    assertBrowserBusinessWritesAllowed(target);
    occupied = target.getItem(EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY);
  } catch (error) {
    if (error instanceof BrowserWriteFenceError && error.reason === "interrupted") {
      throw new ExceptionalRecoveryEvidenceError("marker-present",
        "Exceptional recovery evidence preparation is blocked while the restore-interruption marker exists.", false, error);
    }
    throw new ExceptionalRecoveryEvidenceError("storage-unavailable",
      "Restore-interruption state or the exceptional evidence slot could not be read; evidence preparation is blocked and slot occupancy is uncertain.", true, error);
  }
  if (occupied !== null) {
    throw new ExceptionalRecoveryEvidenceError("slot-occupied",
      "The exceptional recovery evidence slot is already occupied; it was not overwritten.", true);
  }

  const evidence = await createExceptionalRecoveryEvidence(source);
  const serialized = await encodeExceptionalRecoveryEvidence(evidence);
  const unchanged = await createExceptionalRecoveryEvidence(source);
  if (unchanged.evidenceSha256 !== evidence.evidenceSha256) {
    throw new ExceptionalRecoveryEvidenceError("source-changed",
      "Business stores or recovery history changed before evidence was written; no evidence was written.", false);
  }

  try {
    assertBrowserBusinessWritesAllowed(target);
    if (target.getItem(EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY) !== null) {
      throw new ExceptionalRecoveryEvidenceError("slot-occupied",
        "The exceptional recovery evidence slot became occupied; it was not overwritten.", true);
    }
    setBrowserBusinessItem(target, EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY, serialized);
  } catch (error) {
    if (error instanceof ExceptionalRecoveryEvidenceError) throw error;
    if (error instanceof BrowserWriteFenceError && error.reason === "interrupted") {
      throw new ExceptionalRecoveryEvidenceError("marker-present",
        "Restore-interruption state appeared before evidence write; no evidence write was attempted.", false, error);
    }
    let evidenceMayExist = true;
    try {
      evidenceMayExist = target.getItem(EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY) !== null;
    } catch {
      evidenceMayExist = true;
    }
    throw new ExceptionalRecoveryEvidenceError("write-failed",
      evidenceMayExist
        ? "Exceptional recovery evidence write failed and the slot may contain uncertain data; preserve it and inspect before retrying."
        : "Exceptional recovery evidence write failed; a follow-up read confirmed the slot remains absent.",
      evidenceMayExist, error);
  }

  let readback: string | null;
  try {
    readback = target.getItem(EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY);
    if (readback !== serialized) {
      throw new ExceptionalRecoveryEvidenceError("readback-failed",
        "Exceptional recovery evidence read-back differs from the intended bytes. The slot was retained untouched.", true);
    }
    const decoded = await decodeExceptionalRecoveryEvidence(readback);
    if (decoded.evidenceSha256 !== evidence.evidenceSha256) {
      throw new ExceptionalRecoveryEvidenceError("readback-failed",
        "Exceptional recovery evidence fingerprint failed read-back verification. The slot was retained untouched.", true);
    }
  } catch (error) {
    if (error instanceof ExceptionalRecoveryEvidenceError) throw error;
    throw new ExceptionalRecoveryEvidenceError("readback-failed",
      "Exceptional recovery evidence read-back could not be verified. The slot was retained untouched.", true, error);
  }

  let finalSource: ExceptionalRecoveryEvidence;
  try {
    finalSource = await createExceptionalRecoveryEvidence(source);
  } catch (error) {
    if (error instanceof ExceptionalRecoveryEvidenceError) {
      throw new ExceptionalRecoveryEvidenceError(error.code,
        `Evidence was written and verified, but the final source check failed: ${error.message}`, true, error);
    }
    throw error;
  }
  if (finalSource.evidenceSha256 !== evidence.evidenceSha256) {
    throw new ExceptionalRecoveryEvidenceError("source-changed",
      "Source data changed during evidence-slot preparation. The verified evidence remains retained, but preparation is not authorized for restoration.", true);
  }
  try {
    if (target.getItem(EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY) !== serialized) {
      throw new ExceptionalRecoveryEvidenceError("readback-failed",
        "Exceptional recovery evidence changed after verification. The slot was left untouched.", true);
    }
  } catch (error) {
    if (error instanceof ExceptionalRecoveryEvidenceError) throw error;
    throw new ExceptionalRecoveryEvidenceError("readback-failed",
      "Exceptional recovery evidence could not be rechecked after source verification; slot state is uncertain.", true, error);
  }
  return evidence;
}
