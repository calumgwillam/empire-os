import {
  EMPIRE_OS_BACKUP_STORAGE_KEYS,
  validateStandaloneBackup,
  type BackupStorage,
  type EmpireOsBackup,
} from "./backup";
import {
  createExceptionalRecoveryEvidence,
  decodeExceptionalRecoveryEvidence,
  verifyExceptionalRecoveryEvidenceFile,
  type ExceptionalRecoveryEvidence,
  type ExceptionalRecoveryEvidenceFileVerification,
} from "./exceptional-recovery-evidence";
import { decodeRecoverySnapshots } from "./recovery-snapshot-storage";
import { exceptionalRecoveryFingerprint as sha256Utf16 } from "./exceptional-recovery-fingerprint";

export const EXCEPTIONAL_RESTORE_CONFIRMATION_TTL_MS = 60_000;
const CONFIRMATION_PREFIX = "CONFIRM EXCEPTIONAL RECOVERY PREFLIGHT";

export type ExceptionalRecoveryRefusalReason =
  | "backup-invalid"
  | "backup-incomplete"
  | "evidence-invalid"
  | "evidence-unsupported"
  | "evidence-not-current"
  | "source-unavailable"
  | "source-changed"
  | "invalid-clock"
  | "invalid-nonce"
  | "challenge-invalid"
  | "challenge-expired"
  | "challenge-mismatch"
  | "confirmation-missing"
  | "confirmation-invalid";

export type RecoveryStateClassification = Readonly<{
  recoveryHistory: "absent" | "empty" | "valid" | "corrupt";
  interruptionMarker: "absent" | "present-empty" | "present-value";
}>;

export type ExceptionalRestoreBinding = Readonly<{
  backupFileSha256: string;
  backupStorageSha256: string;
  evidenceFileSha256: string;
  evidenceSha256: string;
  currentStateSha256: string;
}>;

export type ExceptionalRestoreConfirmationChallenge = Readonly<{
  version: 1;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
  binding: ExceptionalRestoreBinding;
  text: string;
  challengeSha256: string;
}>;

export type ExceptionalRestoreAuthorizationAssessment =
  | Readonly<{
    status: "refused";
    reason: ExceptionalRecoveryRefusalReason;
    message: string;
  }>
  | Readonly<{
    status: "preflight-passed";
    restoreAuthorized: false;
    assessmentId: string;
    assessedAtMs: number;
    expiresAtMs: number;
    operator: string;
    binding: ExceptionalRestoreBinding;
    recoveryState: RecoveryStateClassification;
    futureTransactionMustRecheck: true;
    notice: "Assessment only; this result is not permission to execute a restore.";
  }>;

export type ExceptionalRestoreInputs = Readonly<{
  backupFileContents: string;
  evidenceFileContents: string;
  currentSource: Pick<BackupStorage, "getItem">;
  nonce: string;
  nowMs: number;
}>;

export type ExceptionalRestoreConfirmation = Readonly<{
  nonce: string;
  operator: string;
  confirmedAtMs: number;
  text: string;
}>;

type PreflightResult =
  | Readonly<{ status: "refused"; reason: ExceptionalRecoveryRefusalReason; message: string }>
  | Readonly<{
    status: "ready";
    binding: ExceptionalRestoreBinding;
    recoveryState: RecoveryStateClassification;
  }>;

function refuse(
  reason: ExceptionalRecoveryRefusalReason,
  message: string,
): PreflightResult & { status: "refused" } {
  return Object.freeze({ status: "refused", reason, message });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameKeySet(storage: Record<string, unknown>): boolean {
  return Object.keys(storage).length === EMPIRE_OS_BACKUP_STORAGE_KEYS.length
    && EMPIRE_OS_BACKUP_STORAGE_KEYS.every((key) => Object.prototype.hasOwnProperty.call(storage, key));
}

function hasUnregisteredKeys(storage: Record<string, unknown>): boolean {
  const registered = new Set<string>(EMPIRE_OS_BACKUP_STORAGE_KEYS);
  return Object.keys(storage).some((key) => !registered.has(key));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isBinding(value: unknown): value is ExceptionalRestoreBinding {
  return isObject(value) && Object.keys(value).length === 5
    && isSha256(value.backupFileSha256)
    && isSha256(value.backupStorageSha256)
    && isSha256(value.evidenceFileSha256)
    && isSha256(value.evidenceSha256)
    && isSha256(value.currentStateSha256);
}

function classifyRecoveryState(evidence: ExceptionalRecoveryEvidence): RecoveryStateClassification {
  const rawHistory = evidence.recoveryHistory.rawValue;
  let recoveryHistory: RecoveryStateClassification["recoveryHistory"];
  if (!evidence.recoveryHistory.present) recoveryHistory = "absent";
  else if (rawHistory === "") recoveryHistory = "empty";
  else {
    try {
      decodeRecoverySnapshots(rawHistory);
      recoveryHistory = "valid";
    } catch {
      recoveryHistory = "corrupt";
    }
  }
  const marker = evidence.interruptionMarker;
  const interruptionMarker = !marker || !marker.present
    ? "absent"
    : marker.rawValue === "" ? "present-empty" : "present-value";
  return Object.freeze({
    recoveryHistory,
    interruptionMarker,
  });
}

function confirmationText(nonce: string, binding: ExceptionalRestoreBinding): string {
  return [
    CONFIRMATION_PREFIX,
    `BACKUP ${binding.backupFileSha256}`,
    `BACKUP-STORES ${binding.backupStorageSha256}`,
    `EVIDENCE-FILE ${binding.evidenceFileSha256}`,
    `EVIDENCE ${binding.evidenceSha256}`,
    `CURRENT-STATE ${binding.currentStateSha256}`,
    `NONCE ${nonce}`,
  ].join("\n");
}

function validChallengeShape(value: unknown): value is ExceptionalRestoreConfirmationChallenge {
  if (!isObject(value) || Object.keys(value).length !== 7
    || value.version !== 1 || typeof value.nonce !== "string"
    || typeof value.issuedAtMs !== "number" || !Number.isSafeInteger(value.issuedAtMs)
    || typeof value.expiresAtMs !== "number" || !Number.isSafeInteger(value.expiresAtMs)
    || !isBinding(value.binding)
    || typeof value.text !== "string" || !isSha256(value.challengeSha256)) return false;
  return value.expiresAtMs === value.issuedAtMs + EXCEPTIONAL_RESTORE_CONFIRMATION_TTL_MS
    && value.text === confirmationText(value.nonce, value.binding);
}

function validConfirmationShape(value: unknown): value is ExceptionalRestoreConfirmation {
  return isObject(value) && Object.keys(value).length === 4
    && typeof value.nonce === "string"
    && typeof value.operator === "string"
    && typeof value.confirmedAtMs === "number"
    && Number.isSafeInteger(value.confirmedAtMs)
    && typeof value.text === "string";
}

async function makeChallenge(
  nonce: string,
  nowMs: number,
  binding: ExceptionalRestoreBinding,
): Promise<ExceptionalRestoreConfirmationChallenge> {
  const expiresAtMs = nowMs + EXCEPTIONAL_RESTORE_CONFIRMATION_TTL_MS;
  const text = confirmationText(nonce, binding);
  const challengeSha256 = await sha256Utf16("empire-os-exceptional-restore-confirmation-v1",
    JSON.stringify([nonce, nowMs, expiresAtMs, binding, text]));
  return Object.freeze({
    version: 1,
    nonce,
    issuedAtMs: nowMs,
    expiresAtMs,
    binding: Object.freeze({ ...binding }),
    text,
    challengeSha256,
  });
}

async function inspectInputs(input: ExceptionalRestoreInputs): Promise<PreflightResult> {
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0
    || input.nowMs > Number.MAX_SAFE_INTEGER - EXCEPTIONAL_RESTORE_CONFIRMATION_TTL_MS) {
    return refuse("invalid-clock", "A valid safe-integer observation clock is required.");
  }
  if (typeof input.nonce !== "string" || input.nonce.length < 16 || input.nonce.length > 256
    || !/^[\x21-\x7e]+$/.test(input.nonce)) {
    return refuse("invalid-nonce", "A fresh printable nonce of 16–256 characters is required.");
  }
  if (typeof input.backupFileContents !== "string") return refuse("backup-invalid", "Selected backup file contents are unreadable.");
  if (typeof input.evidenceFileContents !== "string") return refuse("evidence-invalid", "Selected evidence file contents are unreadable.");

  let parsedBackup: unknown;
  try {
    parsedBackup = JSON.parse(input.backupFileContents);
  } catch {
    return refuse("backup-invalid", "The selected backup is not valid JSON.");
  }
  if (!isObject(parsedBackup) || !isObject(parsedBackup.storage)
    || Object.keys(parsedBackup).some((key) =>
      !["format", "version", "createdAt", "storage", "includedStorageKeys"].includes(key))) {
    return refuse("backup-invalid", "The selected backup does not contain a valid storage object.");
  }
  if (hasUnregisteredKeys(parsedBackup.storage)) {
    return refuse("backup-invalid", "The backup contains an unsupported storage key.");
  }
  if (!sameKeySet(parsedBackup.storage)) {
    return refuse("backup-incomplete", "The backup must contain exactly all 21 registered business stores.");
  }
  let backup: EmpireOsBackup;
  try {
    backup = validateStandaloneBackup(parsedBackup);
  } catch (error) {
    return refuse("backup-invalid", error instanceof Error ? error.message : "The selected backup failed full validation.");
  }

  let selectedEvidence: ExceptionalRecoveryEvidence;
  let evidenceEnvelope: unknown;
  try {
    evidenceEnvelope = JSON.parse(input.evidenceFileContents);
  } catch {
    return refuse("evidence-invalid", "Selected recovery evidence is not valid JSON.");
  }
  if (isObject(evidenceEnvelope) && typeof evidenceEnvelope.version === "number"
    && evidenceEnvelope.version !== 1 && evidenceEnvelope.version !== 2) {
    return refuse("evidence-unsupported", "The selected recovery-evidence version is unsupported.");
  }
  try {
    selectedEvidence = await decodeExceptionalRecoveryEvidence(input.evidenceFileContents);
  } catch (error) {
    return refuse("evidence-invalid", error instanceof Error ? error.message : "Selected recovery evidence is malformed.");
  }
  let currentEvidence: ExceptionalRecoveryEvidence;
  try {
    currentEvidence = await createExceptionalRecoveryEvidence(input.currentSource, { allowInterruptedMarker: true });
  } catch (error) {
    const reason = error instanceof Error && "code" in error && error.code === "source-changed"
      ? "source-changed" : "source-unavailable";
    return refuse(reason, error instanceof Error ? error.message : "Current browser state could not be read consistently.");
  }
  if (currentEvidence.version !== 2) {
    return refuse("evidence-invalid", "Marker-aware current-state evidence could not be established.");
  }

  let verification: ExceptionalRecoveryEvidenceFileVerification;
  try {
    verification = await verifyExceptionalRecoveryEvidenceFile(
      input.evidenceFileContents,
      input.currentSource,
      { allowInterruptedMarker: true },
    );
  } catch (error) {
    return refuse("source-unavailable", error instanceof Error ? error.message : "Evidence could not be reverified against current state.");
  }
  if (verification.status === "source-changed") return refuse("source-changed", verification.message);
  if (verification.status === "source-unavailable") return refuse("source-unavailable", verification.message);
  if (verification.status === "invalid-file") return refuse("evidence-invalid", verification.message);
  if (verification.status === "mismatch") {
    return refuse("evidence-not-current", "Selected evidence does not match current stores, recovery history, or interruption marker.");
  }

  let finalEvidence: ExceptionalRecoveryEvidence;
  try {
    finalEvidence = await createExceptionalRecoveryEvidence(input.currentSource, { allowInterruptedMarker: true });
  } catch (error) {
    const reason = error instanceof Error && "code" in error && error.code === "source-changed"
      ? "source-changed" : "source-unavailable";
    return refuse(reason, error instanceof Error ? error.message : "Final current-state recheck failed.");
  }
  if (finalEvidence.evidenceSha256 !== currentEvidence.evidenceSha256
    || (selectedEvidence.version === 2 && finalEvidence.evidenceSha256 !== selectedEvidence.evidenceSha256)) {
    return refuse("source-changed", "Stores, raw recovery history, or interruption marker changed during authorisation preflight.");
  }

  let backupFileSha256: string;
  let backupStorageSha256: string;
  let evidenceFileSha256: string;
  try {
    [backupFileSha256, backupStorageSha256, evidenceFileSha256] = await Promise.all([
      sha256Utf16("empire-os-selected-backup-file-v1", input.backupFileContents),
      sha256Utf16("empire-os-selected-backup-stores-v1", JSON.stringify(
        EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => [key, backup.storage[key]]),
      )),
      sha256Utf16("empire-os-selected-exceptional-evidence-file-v1", input.evidenceFileContents),
    ]);
  } catch (error) {
    return refuse("source-unavailable", error instanceof Error ? error.message : "Input fingerprints could not be established.");
  }
  const binding = Object.freeze({
    backupFileSha256,
    backupStorageSha256,
    evidenceFileSha256,
    evidenceSha256: selectedEvidence.evidenceSha256,
    currentStateSha256: currentEvidence.evidenceSha256,
  });
  return Object.freeze({
    status: "ready",
    binding,
    recoveryState: classifyRecoveryState(currentEvidence),
  });
}

export async function createExceptionalRestoreConfirmationChallenge(
  input: ExceptionalRestoreInputs,
): Promise<ExceptionalRestoreConfirmationChallenge | Extract<PreflightResult, { status: "refused" }>> {
  const result = await inspectInputs(input);
  if (result.status === "refused") return result;
  try {
    return await makeChallenge(input.nonce, input.nowMs, result.binding);
  } catch (error) {
    return refuse("source-unavailable", error instanceof Error ? error.message : "Confirmation challenge could not be fingerprinted.");
  }
}

export async function assessExceptionalRestoreAuthorization(
  input: ExceptionalRestoreInputs & Readonly<{
    challenge: unknown;
    confirmation: ExceptionalRestoreConfirmation | null;
  }>,
): Promise<ExceptionalRestoreAuthorizationAssessment> {
  const prepared = await inspectInputs(input);
  if (prepared.status === "refused") {
    return Object.freeze({ status: "refused", reason: prepared.reason, message: prepared.message });
  }
  if (!validChallengeShape(input.challenge)) {
    return Object.freeze({
      status: "refused",
      reason: "challenge-invalid",
      message: "A complete, unmodified exceptional-recovery challenge is required.",
    });
  }
  const challenge = input.challenge;
  if (challenge.nonce !== input.nonce) {
    return Object.freeze({ status: "refused", reason: "challenge-mismatch", message: "Challenge nonce does not match this assessment." });
  }
  if (input.nowMs < challenge.issuedAtMs || input.nowMs > challenge.expiresAtMs) {
    return Object.freeze({ status: "refused", reason: "challenge-expired", message: "The observation challenge expired; create a fresh challenge." });
  }
  if (JSON.stringify(challenge.binding) !== JSON.stringify(prepared.binding)) {
    return Object.freeze({
      status: "refused",
      reason: "challenge-mismatch",
      message: "Backup, evidence, or current browser state changed after the confirmation challenge was issued.",
    });
  }
  let expected: ExceptionalRestoreConfirmationChallenge;
  try {
    expected = await makeChallenge(challenge.nonce, challenge.issuedAtMs, challenge.binding);
  } catch (error) {
    return Object.freeze({
      status: "refused",
      reason: "source-unavailable",
      message: error instanceof Error ? error.message : "Challenge fingerprint could not be re-established.",
    });
  }
  if (challenge.challengeSha256 !== expected.challengeSha256 || challenge.text !== expected.text) {
    return Object.freeze({ status: "refused", reason: "challenge-invalid", message: "Challenge integrity check failed." });
  }

  const confirmation: unknown = input.confirmation;
  if (confirmation === null || confirmation === undefined) {
    return Object.freeze({ status: "refused", reason: "confirmation-missing", message: "Explicit operator confirmation is required." });
  }
  if (!validConfirmationShape(confirmation)
    || !confirmation.operator.trim()
    || confirmation.nonce !== challenge.nonce
    || confirmation.confirmedAtMs < challenge.issuedAtMs
    || confirmation.confirmedAtMs > input.nowMs
    || confirmation.confirmedAtMs > challenge.expiresAtMs
    || confirmation.text !== challenge.text) {
    return Object.freeze({
      status: "refused",
      reason: "confirmation-invalid",
      message: "Operator confirmation must reproduce the exact backup/evidence/state challenge before expiry.",
    });
  }

  let assessmentId: string;
  try {
    assessmentId = await sha256Utf16(
      "empire-os-exceptional-restore-assessment-v1",
      JSON.stringify([challenge.challengeSha256, confirmation.operator.trim(), confirmation.confirmedAtMs]),
    );
  } catch (error) {
    return Object.freeze({
      status: "refused",
      reason: "source-unavailable",
      message: error instanceof Error ? error.message : "Assessment identity could not be established.",
    });
  }
  return Object.freeze({
    status: "preflight-passed",
    restoreAuthorized: false,
    assessmentId,
    assessedAtMs: input.nowMs,
    expiresAtMs: challenge.expiresAtMs,
    operator: confirmation.operator.trim(),
    binding: Object.freeze({ ...prepared.binding }),
    recoveryState: Object.freeze({ ...prepared.recoveryState }),
    futureTransactionMustRecheck: true,
    notice: "Assessment only; this result is not permission to execute a restore.",
  });
}
