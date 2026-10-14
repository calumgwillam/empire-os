import { EMPIRE_OS_BACKUP_STORAGE_KEYS, RECOVERY_SNAPSHOTS_STORAGE_KEY, type BackupStorage } from "./backup";
import {
  assertBrowserBusinessWritesAllowed,
  BrowserWriteFenceError,
  RESTORE_INTERRUPTION_STORAGE_KEY,
  setBrowserBusinessItem,
} from "./browser-write-fence";
import { encodeRawStoreValue, importSourceSha256 } from "./server-import-preparation";

export const EXCEPTIONAL_RECOVERY_EVIDENCE_FORMAT = "empire-os-exceptional-recovery-evidence";
export const EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION = 2;
const LEGACY_EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION = 1;
export const EXCEPTIONAL_RECOVERY_EVIDENCE_PURPOSE =
  "preserve-readable-corrupt-recovery-history-and-pre-restore-business-state";
export const EXCEPTIONAL_RECOVERY_EVIDENCE_STORAGE_KEY = "empire-os-exceptional-recovery-evidence-v1";

type ExceptionalRecoveryEvidenceFields = Readonly<{
  format: typeof EXCEPTIONAL_RECOVERY_EVIDENCE_FORMAT;
  version: typeof LEGACY_EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION | typeof EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION;
  purpose: typeof EXCEPTIONAL_RECOVERY_EVIDENCE_PURPOSE;
  recoveryHistory: Readonly<{ present: boolean; rawValue: string | null }>;
  interruptionMarker?: Readonly<{ present: boolean; rawValue: string | null }>;
  interruptionMarkerSha256?: string;
  recoveryHistorySha256: string;
  stores: Readonly<Record<string, string | null>>;
  storesSha256: string;
}>;

export type ExceptionalRecoveryEvidence = ExceptionalRecoveryEvidenceFields & Readonly<{
  evidenceSha256: string;
}>;

export type ExceptionalRecoveryEvidenceStorage = Pick<BackupStorage, "getItem" | "setItem">;

export type ExceptionalRecoveryEvidenceFileVerification =
  | Readonly<{
    status: "matches-current-state";
    evidenceSha256: string;
    storesSha256: string;
    recoveryHistorySha256: string;
    storeCount: number;
    interruptionMarkerPresent?: boolean;
  }>
  | Readonly<{ status: "mismatch"; changedStores: readonly string[]; recoveryHistoryChanged: boolean;
    interruptionMarkerChanged?: boolean }>
  | Readonly<{ status: "invalid-file"; message: string }>
  | Readonly<{ status: "source-changed"; message: string }>
  | Readonly<{ status: "source-unavailable"; message: string }>;

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

export type ExceptionalRecoveryEvidenceOptions = Readonly<{
  allowInterruptedMarker?: boolean;
}>;

type StableSourceValues = {
  recoveryHistory: { present: boolean; rawValue: string | null };
  interruptionMarker: { present: boolean; rawValue: string | null };
  stores: Record<string, string | null>;
};

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

function isRawPresence(value: unknown): value is { present: boolean; rawValue: string | null } {
  return isObject(value) && hasExactFields(value, ["present", "rawValue"])
    && typeof value.present === "boolean"
    && (value.rawValue === null || typeof value.rawValue === "string")
    && value.present === (value.rawValue !== null);
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

function markerContent(marker: { present: boolean; rawValue: string | null }): Uint8Array {
  const header = new TextEncoder().encode("empire-os-exceptional-recovery-marker-v2\u0000");
  const rawBytes = encodeRawStoreValue(marker.rawValue);
  if (marker.present !== (rawBytes !== null)) throw new Error("Interruption-marker presence does not match its raw value.");
  const length = rawBytes?.length ?? 0;
  const encodedLength = new Uint8Array(8);
  let remaining = length / 2;
  for (let index = encodedLength.length - 1; index >= 0; index -= 1) {
    encodedLength[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  const output = new Uint8Array(header.length + 1 + (marker.present ? encodedLength.length + length : 0));
  output.set(header);
  output[header.length] = marker.present ? 1 : 0;
  if (marker.present) {
    output.set(encodedLength, header.length + 1);
    output.set(rawBytes!, header.length + 1 + encodedLength.length);
  }
  return output;
}

function evidenceContent(value: ExceptionalRecoveryEvidenceFields): string {
  if (value.version === LEGACY_EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION) {
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
  return JSON.stringify([
    value.format,
    value.version,
    value.purpose,
    value.interruptionMarker?.present,
    value.interruptionMarkerSha256,
    value.recoveryHistory.present,
    value.recoveryHistory.rawValue,
    value.recoveryHistorySha256,
    value.storesSha256,
  ]);
}

function sameRawValue(
  left: { present: boolean; rawValue: string | null },
  right: { present: boolean; rawValue: string | null },
): boolean {
  return left.present === right.present && left.rawValue === right.rawValue;
}

function sameSourceValues(left: StableSourceValues, right: StableSourceValues): boolean {
  return sameRawValue(left.interruptionMarker, right.interruptionMarker)
    && sameRawValue(left.recoveryHistory, right.recoveryHistory)
    && EMPIRE_OS_BACKUP_STORAGE_KEYS.every((key) => left.stores[key] === right.stores[key]);
}

function readMarker(source: Pick<BackupStorage, "getItem">): { present: boolean; rawValue: string | null } {
  let rawValue: string | null;
  try {
    rawValue = source.getItem(RESTORE_INTERRUPTION_STORAGE_KEY);
  } catch (error) {
    throw new ExceptionalRecoveryEvidenceError("storage-unavailable",
      "Browser restore-interruption state could not be read; evidence capture is blocked.", false, error);
  }
  if (rawValue !== null && typeof rawValue !== "string") {
    throw new ExceptionalRecoveryEvidenceError("storage-unavailable",
      "Browser restore-interruption state is malformed; evidence capture is blocked.", false);
  }
  return { present: rawValue !== null, rawValue };
}

function assertMarkerMatches(
  actual: { present: boolean; rawValue: string | null },
  expected: { present: boolean; rawValue: string | null },
): void {
  if (!sameRawValue(actual, expected)) {
    throw new ExceptionalRecoveryEvidenceError("source-changed",
      "Restore-interruption marker changed during evidence capture; no stable evidence was established.", false);
  }
}

function readSourcePass(
  source: Pick<BackupStorage, "getItem">,
  marker: { present: boolean; rawValue: string | null },
): StableSourceValues {
  const stores: Record<string, string | null> = {};
  for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) {
    const value = source.getItem(key);
    if (value !== null && typeof value !== "string") {
      throw new ExceptionalRecoveryEvidenceError("storage-unavailable",
        `Browser storage returned a malformed value for ${key}; evidence capture is blocked.`, false);
    }
    stores[key] = value;
  }
  const rawValue = source.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY);
  if (rawValue !== null && typeof rawValue !== "string") {
    throw new ExceptionalRecoveryEvidenceError("storage-unavailable",
      "Browser storage returned a malformed recovery-history value; evidence capture is blocked.", false);
  }
  const interruptionMarker = readMarker(source);
  assertMarkerMatches(interruptionMarker, marker);
  return {
    stores,
    recoveryHistory: { present: rawValue !== null, rawValue },
    interruptionMarker,
  };
}

function readStableSource(
  source: Pick<BackupStorage, "getItem">,
  options: ExceptionalRecoveryEvidenceOptions,
  expectedMarker?: { present: boolean; rawValue: string | null },
): StableSourceValues {
  try {
    const marker = readMarker(source);
    if (expectedMarker) assertMarkerMatches(marker, expectedMarker);
    if (marker.present && options.allowInterruptedMarker !== true) {
      throw new BrowserWriteFenceError("interrupted");
    }
    const first = readSourcePass(source, marker);
    const second = readSourcePass(source, marker);
    const finalMarker = readMarker(source);
    assertMarkerMatches(finalMarker, marker);
    if (!sameSourceValues(first, second)) {
      throw new ExceptionalRecoveryEvidenceError("source-changed",
        "Business stores, recovery history, or restore-interruption marker changed during evidence capture; no stable evidence was established.", false);
    }
    return first;
  } catch (error) {
    if (error instanceof ExceptionalRecoveryEvidenceError) throw error;
    if (error instanceof BrowserWriteFenceError && error.reason === "interrupted") {
      throw new ExceptionalRecoveryEvidenceError("marker-present",
        "Ordinary exceptional evidence capture is blocked while the restore-interruption marker exists; explicitly enable marker-aware capture to preserve it.", false, error);
    }
    throw new ExceptionalRecoveryEvidenceError("storage-unavailable",
      "Browser restore-interruption state or source storage could not be read; evidence capture is blocked.", false, error);
  }
}

async function buildEvidence(
  values: StableSourceValues,
  exceptional: boolean,
): Promise<ExceptionalRecoveryEvidence> {
  const recoveryHistorySha256 = await sha256(historyContent(values.recoveryHistory));
  const storesSha256 = await importSourceSha256(values.stores);
  const interruptionMarkerSha256 = exceptional ? await sha256(markerContent(values.interruptionMarker)) : undefined;
  const fields: ExceptionalRecoveryEvidenceFields = {
    format: EXCEPTIONAL_RECOVERY_EVIDENCE_FORMAT,
    version: exceptional ? EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION : LEGACY_EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION,
    purpose: EXCEPTIONAL_RECOVERY_EVIDENCE_PURPOSE,
    recoveryHistory: Object.freeze({ ...values.recoveryHistory }),
    ...(exceptional ? { interruptionMarker: Object.freeze({ ...values.interruptionMarker }) } : {}),
    ...(exceptional && interruptionMarkerSha256 ? { interruptionMarkerSha256 } : {}),
    recoveryHistorySha256,
    stores: Object.freeze(Object.fromEntries(EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => [key, values.stores[key]]))),
    storesSha256,
  };
  return Object.freeze({ ...fields, evidenceSha256: await sha256(evidenceContent(fields)) });
}

export async function createExceptionalRecoveryEvidence(
  source: Pick<BackupStorage, "getItem">,
  options: ExceptionalRecoveryEvidenceOptions = {},
): Promise<ExceptionalRecoveryEvidence> {
  return createEvidenceAtMarker(source, options);
}

async function createEvidenceAtMarker(
  source: Pick<BackupStorage, "getItem">,
  options: ExceptionalRecoveryEvidenceOptions,
  expectedMarker?: { present: boolean; rawValue: string | null },
): Promise<ExceptionalRecoveryEvidence> {
  const first = readStableSource(source, options, expectedMarker);
  const evidence = await buildEvidence(first, options.allowInterruptedMarker === true);
  const final = readStableSource(source, options, first.interruptionMarker);
  if (!sameSourceValues(first, final)) {
    throw new ExceptionalRecoveryEvidenceError("source-changed",
      "Business stores, recovery history, or restore-interruption marker changed while evidence fingerprints were being calculated.", false);
  }
  return evidence;
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
  const legacy = value.version === LEGACY_EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION;
  const current = value.version === EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION;
  const markerValue = value.interruptionMarker;
  if (!hasExactFields(value, [
    "format", "version", "purpose", "recoveryHistory", "recoveryHistorySha256", "stores", "storesSha256", "evidenceSha256",
    ...(current ? ["interruptionMarker", "interruptionMarkerSha256"] : []),
  ]) || (!legacy && !current)
    || value.format !== EXCEPTIONAL_RECOVERY_EVIDENCE_FORMAT
    || value.purpose !== EXCEPTIONAL_RECOVERY_EVIDENCE_PURPOSE
    || (current && !isRawPresence(markerValue))
    || (current && !isSha256(value.interruptionMarkerSha256))
    || !isObject(value.recoveryHistory)
    || !isRawPresence(value.recoveryHistory)
    || Object.keys(storesValue).length !== EMPIRE_OS_BACKUP_STORAGE_KEYS.length
    || EMPIRE_OS_BACKUP_STORAGE_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(storesValue, key)
      || (storesValue[key] !== null && typeof storesValue[key] !== "string"))
    || !isSha256(value.recoveryHistorySha256) || !isSha256(value.storesSha256) || !isSha256(value.evidenceSha256)) {
    throw new ExceptionalRecoveryEvidenceError("invalid-evidence",
      "Exceptional recovery evidence has an unsupported format, incomplete store inventory, or malformed value.", false);
  }

  const history = { present: value.recoveryHistory.present, rawValue: value.recoveryHistory.rawValue };
  const interruptionMarker = current && isRawPresence(markerValue) ? markerValue : undefined;
  const interruptionMarkerSha256 = current && isSha256(value.interruptionMarkerSha256)
    ? value.interruptionMarkerSha256 : undefined;
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
    version: legacy ? LEGACY_EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION : EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION,
    purpose: EXCEPTIONAL_RECOVERY_EVIDENCE_PURPOSE,
    recoveryHistory: history,
    ...(interruptionMarker ? { interruptionMarker: { ...interruptionMarker } } : {}),
    ...(interruptionMarkerSha256 ? { interruptionMarkerSha256 } : {}),
    recoveryHistorySha256: value.recoveryHistorySha256,
    stores,
    storesSha256: value.storesSha256,
  };
  if (await sha256(historyContent(history)) !== value.recoveryHistorySha256
    || (interruptionMarker && interruptionMarkerSha256
      && await sha256(markerContent(interruptionMarker)) !== interruptionMarkerSha256)
    || await importSourceSha256(stores) !== value.storesSha256
    || await sha256(evidenceContent(fields)) !== value.evidenceSha256) {
    throw new ExceptionalRecoveryEvidenceError("invalid-evidence",
      "Exceptional recovery evidence fingerprints do not match the exact retained values.", false);
  }
  return Object.freeze({
    ...fields,
    recoveryHistory: Object.freeze(history),
    ...(fields.interruptionMarker ? { interruptionMarker: Object.freeze(fields.interruptionMarker) } : {}),
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

export async function exportExceptionalRecoveryEvidenceFile(value: unknown): Promise<string> {
  return encodeExceptionalRecoveryEvidence(value);
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

export async function verifyExceptionalRecoveryEvidenceFile(
  fileContents: string,
  currentSource: Pick<BackupStorage, "getItem">,
  options: ExceptionalRecoveryEvidenceOptions = {},
): Promise<ExceptionalRecoveryEvidenceFileVerification> {
  let initialMarker: { present: boolean; rawValue: string | null };
  try {
    initialMarker = readMarker(currentSource);
    if (initialMarker.present && options.allowInterruptedMarker !== true) {
      return { status: "source-unavailable", message: "Current browser state has an interruption marker; explicitly enable marker-aware verification." };
    }
  } catch (error) {
    return {
      status: "source-unavailable",
      message: error instanceof Error ? error.message : "Current browser interruption state could not be read safely.",
    };
  }

  let selected: ExceptionalRecoveryEvidence;
  try {
    selected = await decodeExceptionalRecoveryEvidence(fileContents);
  } catch (error) {
    try {
      if (!sameRawValue(readMarker(currentSource), initialMarker)) {
        return { status: "source-changed", message: "Restore-interruption marker changed during file verification." };
      }
    } catch (markerError) {
      return {
        status: "source-unavailable",
        message: markerError instanceof Error ? markerError.message : "Current browser interruption state could not be rechecked.",
      };
    }
    return {
      status: "invalid-file",
      message: error instanceof Error ? error.message : "Selected evidence file is invalid.",
    };
  }

  let current: ExceptionalRecoveryEvidence;
  try {
    const captureOptions = {
      allowInterruptedMarker: options.allowInterruptedMarker === true
        || selected.version === EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION,
    };
    current = await createEvidenceAtMarker(currentSource, captureOptions, initialMarker);
  } catch (error) {
    if (error instanceof ExceptionalRecoveryEvidenceError && error.code === "source-changed") {
      return { status: "source-changed", message: error.message };
    }
    return {
      status: "source-unavailable",
      message: error instanceof Error ? error.message : "Current browser evidence could not be read safely.",
    };
  }

  const changedStores = EMPIRE_OS_BACKUP_STORAGE_KEYS.filter((key) => selected.stores[key] !== current.stores[key]);
  const recoveryHistoryChanged = selected.recoveryHistory.present !== current.recoveryHistory.present
    || selected.recoveryHistory.rawValue !== current.recoveryHistory.rawValue;
  const interruptionMarkerChanged = selected.version === EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION
    && (!selected.interruptionMarker || !current.interruptionMarker
      || !sameRawValue(selected.interruptionMarker, current.interruptionMarker));
  let finalMarker: { present: boolean; rawValue: string | null };
  try {
    finalMarker = readMarker(currentSource);
  } catch (error) {
    return {
      status: "source-unavailable",
      message: error instanceof Error ? error.message : "Current browser interruption state could not be rechecked.",
    };
  }
  if (!sameRawValue(finalMarker, initialMarker)) {
    return { status: "source-changed", message: "Restore-interruption marker changed during file verification." };
  }
  if (initialMarker.present && selected.version === LEGACY_EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION) {
    return {
      status: "invalid-file",
      message: "This version-1 evidence file does not bind the interruption marker and cannot verify marker-present state.",
    };
  }
  if (changedStores.length || recoveryHistoryChanged || interruptionMarkerChanged) {
    return Object.freeze({
      status: "mismatch",
      changedStores: Object.freeze(changedStores),
      recoveryHistoryChanged,
      ...(selected.version === EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION ? { interruptionMarkerChanged } : {}),
    });
  }
  return Object.freeze({
    status: "matches-current-state",
    evidenceSha256: selected.evidenceSha256,
    storesSha256: selected.storesSha256,
    recoveryHistorySha256: selected.recoveryHistorySha256,
    storeCount: EMPIRE_OS_BACKUP_STORAGE_KEYS.length,
    ...(selected.version === EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION
      ? { interruptionMarkerPresent: selected.interruptionMarker?.present === true } : {}),
  });
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
