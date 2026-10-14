import {
  assessExceptionalRestoreAuthorization,
  type ExceptionalRestoreAuthorizationAssessment,
  type ExceptionalRestoreBinding,
  type ExceptionalRestoreConfirmation,
  type ExceptionalRestoreConfirmationChallenge,
  type ExceptionalRestoreInputs,
} from "./exceptional-recovery-authorization";
import { exceptionalRecoveryFingerprint } from "./exceptional-recovery-fingerprint";

const nonceTokenBrand: unique symbol = Symbol("trusted-exceptional-recovery-nonce");
const issuedNonceTokens = new WeakSet<object>();
const issuedNonceValues = new Set<string>();
const consumedNonceValues = new Set<string>();
const planningReceipts = new WeakMap<object, ExceptionalRecoveryPlanningReceipt>();

export type ExceptionalRecoveryPlanningReceipt = Readonly<{
  nonce: string;
  challengeSha256: string;
  assessmentId: string;
  acknowledgedAtMs: number;
}>;

export function exceptionalRecoveryPlanningReceipt(value: unknown): ExceptionalRecoveryPlanningReceipt | undefined {
  return value !== null && typeof value === "object" ? planningReceipts.get(value) : undefined;
}

export type TrustedExceptionalRecoveryNonce = Readonly<{
  value: string;
  readonly [nonceTokenBrand]: true;
}>;

export type ExceptionalRecoveryNonceSource = Pick<Crypto, "getRandomValues">;

export type ExceptionalRecoveryConsumptionRequest = Readonly<{
  challengeSha256: string;
  nonce: string;
  confirmationId: string;
  attemptId: string;
  expiresAtMs: number;
}>;

export type ExceptionalRecoveryConsumptionResult = Readonly<{
  status: "consumed" | "already-consumed" | "conflict" | "expired" | "invalid-input" | "unavailable" | "uncertain";
  message?: string;
}>;

export interface ExceptionalRecoveryConfirmationConsumer {
  // Implementations atomically bind the challenge, nonce, confirmation, attempt and expiry.
  // Process-local or browser storage is not cross-tab atomic.
  consumeIfUnused(request: ExceptionalRecoveryConsumptionRequest): Promise<ExceptionalRecoveryConsumptionResult>;
}

export type ExceptionalRecoveryTransactionGateInput = Readonly<{
  backupFileContents: string;
  evidenceFileContents: string;
  currentSource: ExceptionalRestoreInputs["currentSource"];
  challenge: unknown;
  confirmation: ExceptionalRestoreConfirmation | null;
  priorAssessment: ExceptionalRestoreAuthorizationAssessment;
  nonce: TrustedExceptionalRecoveryNonce;
  nowMs: number;
  consumer: ExceptionalRecoveryConfirmationConsumer;
}>;

export type ExceptionalRecoveryTransactionReadiness =
  | Readonly<{
    status: "transaction-ready";
    transactionExecutionAllowed: false;
    attemptId: string;
    expiresAtMs: number;
    consumedConfirmationId: string;
    binding: ExceptionalRestoreBinding;
    notice: "Attempt-scoped safety gate only; no restoration was executed or authorized.";
  }>
  | Readonly<{
    status: "refused";
    reason: "validation-refused" | "changed-state" | "replay-refused" | "conflict-refused"
      | "consumption-unavailable" | "consumption-uncertain";
    detail: string;
  }>;

function refused(
  reason: Extract<ExceptionalRecoveryTransactionReadiness, { status: "refused" }>["reason"],
  detail: string,
): ExceptionalRecoveryTransactionReadiness {
  return Object.freeze({ status: "refused", reason, detail });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHexNonce(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

export function createTrustedExceptionalRecoveryNonce(
  randomSource: ExceptionalRecoveryNonceSource = globalThis.crypto,
): TrustedExceptionalRecoveryNonce {
  const bytes = new Uint8Array(32);
  try {
    randomSource.getRandomValues(bytes);
  } catch (error) {
    throw new Error(`Cryptographically secure nonce generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!isHexNonce(value) || new Set(bytes).size < 8 || issuedNonceValues.has(value)) {
    throw new Error("Nonce source returned a malformed or previously issued value.");
  }
  issuedNonceValues.add(value);
  const token = Object.freeze({ value, [nonceTokenBrand]: true as const });
  issuedNonceTokens.add(token);
  return token;
}

function isTrustedNonce(value: unknown): value is TrustedExceptionalRecoveryNonce {
  return isObject(value) && issuedNonceTokens.has(value)
    && typeof value.value === "string" && isHexNonce(value.value);
}

function sameBinding(left: unknown, right: unknown): boolean {
  if (!isObject(left) || !isObject(right)) return false;
  const keys = ["backupFileSha256", "backupStorageSha256", "evidenceFileSha256", "evidenceSha256", "currentStateSha256"];
  return keys.every((key) => left[key] === right[key]);
}

function isPassedAssessment(value: unknown): value is Extract<ExceptionalRestoreAuthorizationAssessment, { status: "preflight-passed" }> {
  return isObject(value) && value.status === "preflight-passed"
    && value.restoreAuthorized === false
    && typeof value.assessmentId === "string" && /^[a-f0-9]{64}$/.test(value.assessmentId)
    && typeof value.assessedAtMs === "number"
    && Number.isSafeInteger(value.assessedAtMs)
    && typeof value.expiresAtMs === "number"
    && Number.isSafeInteger(value.expiresAtMs)
    && typeof value.operator === "string"
    && isObject(value.binding)
    && value.futureTransactionMustRecheck === true;
}

function isChallenge(value: unknown): value is ExceptionalRestoreConfirmationChallenge {
  return isObject(value) && value.version === 1
    && typeof value.nonce === "string"
    && typeof value.issuedAtMs === "number"
    && Number.isSafeInteger(value.issuedAtMs)
    && typeof value.expiresAtMs === "number"
    && Number.isSafeInteger(value.expiresAtMs)
    && isObject(value.binding)
    && typeof value.challengeSha256 === "string";
}

function isConsumptionResult(value: unknown): value is ExceptionalRecoveryConsumptionResult {
  if (!isObject(value) || typeof value.status !== "string") return false;
  return ["consumed", "already-consumed", "conflict", "expired", "invalid-input", "unavailable", "uncertain"]
    .includes(value.status)
    && Object.keys(value).every((key) => key === "status" || key === "message")
    && (value.message === undefined || typeof value.message === "string");
}

async function sha256Identity(domain: string, value: unknown): Promise<string> {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") throw new Error("Identity value could not be serialized.");
  return exceptionalRecoveryFingerprint(domain, serialized);
}

async function assess(
  input: ExceptionalRecoveryTransactionGateInput,
  nowMs: number,
): Promise<ExceptionalRestoreAuthorizationAssessment> {
  try {
    return await assessExceptionalRestoreAuthorization({
      backupFileContents: input.backupFileContents,
      evidenceFileContents: input.evidenceFileContents,
      currentSource: input.currentSource,
      nonce: input.nonce.value,
      nowMs,
      challenge: input.challenge,
      confirmation: input.confirmation,
    });
  } catch (error) {
    return Object.freeze({
      status: "refused",
      reason: "source-unavailable",
      message: error instanceof Error ? error.message : "Phase 2 reassessment could not be completed.",
    });
  }
}

export async function assessExceptionalRecoveryTransactionGate(
  input: ExceptionalRecoveryTransactionGateInput,
): Promise<ExceptionalRecoveryTransactionReadiness> {
  if (!isTrustedNonce(input.nonce)) {
    return refused("validation-refused", "A nonce generated by the trusted cryptographic nonce factory is required.");
  }
  if (!isChallenge(input.challenge) || input.challenge.nonce !== input.nonce.value) {
    return refused("validation-refused", "Challenge is malformed or is not bound to this trusted nonce.");
  }
  const challenge = input.challenge;
  if (!isPassedAssessment(input.priorAssessment)) {
    return refused("validation-refused", "A successful Phase 2 preflight assessment is required.");
  }
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
    return refused("validation-refused", "A valid transaction-time observation clock is required.");
  }
  if (input.priorAssessment.assessedAtMs > input.nowMs
    || input.priorAssessment.expiresAtMs !== challenge.expiresAtMs) {
    return refused("validation-refused", "Phase 2 assessment time or expiry does not match this challenge.");
  }
  if (input.nowMs > challenge.expiresAtMs || input.nowMs > input.priorAssessment.expiresAtMs) {
    return refused("validation-refused", "The challenge or Phase 2 assessment has expired; obtain fresh confirmation.");
  }
  if (consumedNonceValues.has(input.nonce.value)) {
    return refused("replay-refused", "This trusted nonce has already been submitted to the transaction safety gate.");
  }

  const firstAssessment = await assess(input, input.nowMs);
  if (firstAssessment.status !== "preflight-passed") {
    return refused(firstAssessment.reason === "challenge-mismatch" || firstAssessment.reason === "evidence-not-current"
      || firstAssessment.reason === "source-changed" ? "changed-state" : "validation-refused", firstAssessment.message);
  }
  if (!sameBinding(firstAssessment.binding, input.priorAssessment.binding)
    || !sameBinding(firstAssessment.binding, challenge.binding)
    || firstAssessment.assessmentId !== input.priorAssessment.assessmentId) {
    return refused("changed-state", "Fresh transaction-time bindings differ from the earlier assessment or challenge.");
  }

  const finalAssessment = await assess(input, input.nowMs);
  if (finalAssessment.status !== "preflight-passed") {
    return refused(finalAssessment.reason === "challenge-mismatch" || finalAssessment.reason === "evidence-not-current"
      || finalAssessment.reason === "source-changed" ? "changed-state" : "validation-refused", finalAssessment.message);
  }
  if (!sameBinding(firstAssessment.binding, finalAssessment.binding)
    || !sameBinding(finalAssessment.binding, input.priorAssessment.binding)
    || finalAssessment.assessmentId !== input.priorAssessment.assessmentId
    || finalAssessment.expiresAtMs !== input.priorAssessment.expiresAtMs
    || finalAssessment.operator !== input.priorAssessment.operator) {
    return refused("changed-state", "Selected files or current stores/history/marker changed during final transaction-time validation.");
  }

  const confirmation = input.confirmation;
  if (!confirmation || confirmation.nonce !== input.nonce.value) {
    return refused("validation-refused", "Confirmation does not match the trusted nonce.");
  }
  let confirmationId: string;
  let attemptId: string;
  try {
    confirmationId = await sha256Identity("empire-os-exceptional-recovery-confirmation-consume-v1", [
      challenge.challengeSha256,
      confirmation.nonce,
      confirmation.operator.trim(),
      confirmation.confirmedAtMs,
      confirmation.text,
      finalAssessment.binding,
    ]);
    attemptId = await sha256Identity("empire-os-exceptional-recovery-attempt-v1", [
      input.nonce.value,
      confirmationId,
      input.nowMs,
    ]);
  } catch (error) {
    return refused("validation-refused",
      `Confirmation identity could not be established; no consumption was attempted. ${error instanceof Error ? error.message : String(error)}`);
  }

  const consumptionAssessment = await assess(input, input.nowMs);
  if (consumptionAssessment.status !== "preflight-passed") {
    return refused(consumptionAssessment.reason === "challenge-mismatch" || consumptionAssessment.reason === "evidence-not-current"
      || consumptionAssessment.reason === "source-changed" ? "changed-state" : "validation-refused", consumptionAssessment.message);
  }
  if (!sameBinding(finalAssessment.binding, consumptionAssessment.binding)
    || consumptionAssessment.assessmentId !== input.priorAssessment.assessmentId
    || consumptionAssessment.expiresAtMs !== challenge.expiresAtMs
    || consumptionAssessment.operator !== input.priorAssessment.operator) {
    return refused("changed-state", "Selected files or current stores/history/marker changed immediately before confirmation consumption.");
  }

  let consumptionStartedAtMs: number;
  try {
    consumptionStartedAtMs = Date.now();
  } catch {
    return refused("validation-refused", "A trusted pre-consumption clock reading was unavailable; transaction readiness denied.");
  }
  if (!Number.isSafeInteger(consumptionStartedAtMs) || consumptionStartedAtMs < input.nowMs) {
    return refused("validation-refused", "A trusted pre-consumption clock reading was invalid or moved backwards; transaction readiness denied.");
  }
  if (consumptionStartedAtMs >= challenge.expiresAtMs) {
    return refused("validation-refused", "The challenge expired before confirmation consumption; obtain fresh confirmation.");
  }

  consumedNonceValues.add(input.nonce.value);
  let consumed: ExceptionalRecoveryConsumptionResult;
  try {
    consumed = await input.consumer.consumeIfUnused(Object.freeze({
      challengeSha256: challenge.challengeSha256,
      nonce: input.nonce.value,
      confirmationId,
      attemptId,
      expiresAtMs: challenge.expiresAtMs,
    }));
  } catch (error) {
    return refused("consumption-uncertain",
      `Atomic confirmation consumption outcome is unknown; transaction readiness denied. ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isConsumptionResult(consumed)) {
    return refused("consumption-uncertain", "Confirmation consumption returned an invalid or ambiguous result; transaction readiness denied.");
  }
  if (consumed.status === "already-consumed") {
    return refused("replay-refused", "Confirmation or nonce has already been consumed by an attempt.");
  }
  if (consumed.status === "conflict") {
    return refused("conflict-refused", consumed.message || "Confirmation identifiers conflict with an existing attempt.");
  }
  if (consumed.status === "expired" || consumed.status === "invalid-input") {
    return refused("validation-refused", consumed.message || "The confirmation request was invalid or expired.");
  }
  if (consumed.status === "unavailable") {
    return refused("consumption-unavailable", consumed.message || "Durable confirmation storage is unavailable.");
  }
  if (consumed.status !== "consumed") {
    return refused("consumption-uncertain", consumed.message || "Atomic confirmation consumption could not be established.");
  }

  let completionNowMs: number;
  try {
    completionNowMs = Date.now();
  } catch {
    return refused("validation-refused", "A trusted completion-time clock reading was unavailable; transaction readiness denied.");
  }
  if (!Number.isSafeInteger(completionNowMs) || completionNowMs < consumptionStartedAtMs) {
    return refused("validation-refused", "A trusted completion-time clock reading was invalid or moved backwards; transaction readiness denied.");
  }
  if (completionNowMs >= challenge.expiresAtMs) {
    return refused("validation-refused", "The challenge expired before confirmation consumption was acknowledged; obtain fresh confirmation.");
  }

  const readiness: ExceptionalRecoveryTransactionReadiness = Object.freeze({
    status: "transaction-ready",
    transactionExecutionAllowed: false,
    attemptId,
    expiresAtMs: challenge.expiresAtMs,
    consumedConfirmationId: confirmationId,
    binding: Object.freeze({ ...finalAssessment.binding }),
    notice: "Attempt-scoped safety gate only; no restoration was executed or authorized.",
  });
  planningReceipts.set(readiness, Object.freeze({
    nonce: input.nonce.value,
    challengeSha256: challenge.challengeSha256,
    assessmentId: finalAssessment.assessmentId,
    acknowledgedAtMs: completionNowMs,
  }));
  return readiness;
}
