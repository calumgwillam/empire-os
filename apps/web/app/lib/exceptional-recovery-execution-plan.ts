import {
  BACKUP_FORMAT, BACKUP_VERSION, EMPIRE_OS_BACKUP_STORAGE_KEYS, RECOVERY_SNAPSHOTS_STORAGE_KEY,
  validateStandaloneBackup,
} from "./backup";
import { RESTORE_INTERRUPTION_STORAGE_KEY } from "./browser-write-fence";
import {
  assessExceptionalRestoreAuthorization,
  type ExceptionalRestoreConfirmation,
} from "./exceptional-recovery-authorization";
import {
  decodeExceptionalRecoveryEvidence, EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION,
} from "./exceptional-recovery-evidence";
import { exceptionalRecoveryFingerprint } from "./exceptional-recovery-fingerprint";
import {
  exceptionalRecoveryPlanningReceipt, type ExceptionalRecoveryTransactionReadiness,
} from "./exceptional-recovery-transaction-gate";
import { isObject, isSha256 } from "./server-persistence-contract";

export const EXCEPTIONAL_RECOVERY_PLAN_VERSION = 1;
const RAW_KEYS = [...EMPIRE_OS_BACKUP_STORAGE_KEYS, RECOVERY_SNAPSHOTS_STORAGE_KEY, RESTORE_INTERRUPTION_STORAGE_KEY];

export type ExceptionalRecoveryExecutionPlanInput = Readonly<{
  selection: Readonly<{ backupFileContents: string; evidenceFileContents: string }>;
  currentValues: Readonly<Record<string, string | null>>;
  challenge: unknown;
  confirmation: ExceptionalRestoreConfirmation | null;
  transactionGate: ExceptionalRecoveryTransactionReadiness;
  expectedAttemptId: string;
  nowMs: number;
}>;

export type RecoveryPlanStage = Readonly<{
  id: string;
  requires: readonly string[];
  readBack: readonly string[];
  onFailure: "stop-without-business-writes" | "retain-fence-and-reconcile" | "rollback-and-verify";
}>;

const stages: readonly RecoveryPlanStage[] = Object.freeze([
  Object.freeze({
    id: "revalidate-and-exclude-writers",
    requires: Object.freeze(["fresh-attempt-and-expiry", "exact-files-and-all-23-live-values", "exclusive-cross-tab-writer-control"]),
    readBack: Object.freeze(["all-23-values-still-match-plan"]),
    onFailure: "stop-without-business-writes",
  }),
  Object.freeze({
    id: "preserve-pre-restore-evidence",
    requires: Object.freeze(["externally-retained-verified-evidence", "durable-pinned-raw-rollback-image", "capacity-and-readback-proof"]),
    readBack: Object.freeze(["all-21-rollback-values", "original-history-bytes", "original-marker-bytes"]),
    onFailure: "stop-without-business-writes",
  }),
  Object.freeze({
    id: "establish-interruption-fence",
    requires: Object.freeze(["attempt-bound-durable-journal", "preserve-existing-marker-provenance", "all-writers-honor-fence"]),
    readBack: Object.freeze(["active-attempt-fence", "journal-and-rollback-image"]),
    onFailure: "retain-fence-and-reconcile",
  }),
  Object.freeze({
    id: "apply-selected-business-values",
    requires: Object.freeze(["fresh-boundary-revalidation", "exclusive-writer-control-still-held", "verified-fence-and-rollback-image"]),
    readBack: Object.freeze(["each-key-exact-string-or-absence-after-write"]),
    onFailure: "rollback-and-verify",
  }),
  Object.freeze({
    id: "verify-complete-target",
    requires: Object.freeze(["all-21-keys-compared", "standalone-backup-validation-and-reference-checks"]),
    readBack: Object.freeze(["all-21-target-values", "history-evidence-preserved", "attempt-journal"]),
    onFailure: "rollback-and-verify",
  }),
  Object.freeze({
    id: "record-outcome-without-clearing-fence",
    requires: Object.freeze(["durable-attempt-outcome", "separately-reviewed-fence-release-protocol"]),
    readBack: Object.freeze(["outcome-journal", "retained-evidence-and-fence"]),
    onFailure: "retain-fence-and-reconcile",
  }),
]);

function refuse(reason: string, message: string) {
  return Object.freeze({ status: "refused" as const, executionAllowed: false as const, reason, message });
}

function captureFields(value: unknown, fields: readonly string[]): Record<string, unknown> | null {
  if (!isObject(value) || Reflect.ownKeys(value).length !== fields.length) return null;
  const result: Record<string, unknown> = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function rawSnapshot(value: unknown): Readonly<Record<string, string | null>> | null {
  if (!isObject(value) || Reflect.ownKeys(value).length !== RAW_KEYS.length) return null;
  const result: Record<string, string | null> = {};
  for (const key of RAW_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)
      || (descriptor.value !== null && typeof descriptor.value !== "string")) return null;
    result[key] = descriptor.value;
  }
  return Object.freeze(result);
}

export async function planExceptionalRecoveryExecution(input: ExceptionalRecoveryExecutionPlanInput) {
  if (!isObject(input)) return refuse("invalid-input", "Recovery execution planning inputs must be an object.");
  const selection = captureFields(input.selection, ["backupFileContents", "evidenceFileContents"]);
  if (!selection || typeof selection.backupFileContents !== "string" || typeof selection.evidenceFileContents !== "string") {
    return refuse("invalid-selection", "Explicitly selected backup and external evidence file contents are required.");
  }
  const { backupFileContents, evidenceFileContents } = selection;
  const receipt = exceptionalRecoveryPlanningReceipt(input.transactionGate);
  const gate = input.transactionGate;
  if (!receipt || gate.status !== "transaction-ready") {
    return refuse("gate-required", "An original successful transaction-gate result is required; preflight or copied results are not sufficient.");
  }
  if (!isSha256(input.expectedAttemptId) || input.expectedAttemptId !== gate.attemptId) {
    return refuse("attempt-mismatch", "The explicitly selected attempt does not match the consumed confirmation attempt.");
  }
  const nowMs = input.nowMs;
  if (!Number.isSafeInteger(nowMs) || nowMs < receipt.acknowledgedAtMs || nowMs >= gate.expiresAtMs) {
    return refuse("invalid-or-expired-clock", "Planning time must be at or after acknowledgement and strictly before attempt expiry.");
  }
  const current = rawSnapshot(input.currentValues);
  if (!current) return refuse("incomplete-current-state", "Exactly all 21 stores plus raw history and marker values are required, without accessors.");
  const challenge = captureFields(input.challenge, [
    "version", "nonce", "issuedAtMs", "expiresAtMs", "binding", "text", "challengeSha256",
  ]);
  const binding = challenge && captureFields(challenge.binding, [
    "backupFileSha256", "backupStorageSha256", "evidenceFileSha256", "evidenceSha256", "currentStateSha256",
  ]);
  if (!challenge || !binding || challenge.challengeSha256 !== receipt.challengeSha256) {
    return refuse("attempt-mismatch", "The selected challenge does not belong to this transaction-gate attempt.");
  }
  challenge.binding = Object.freeze(binding);
  let confirmation: ExceptionalRestoreConfirmation | null = null;
  if (input.confirmation !== null) {
    const captured = captureFields(input.confirmation, ["nonce", "operator", "confirmedAtMs", "text"]);
    if (!captured || typeof captured.nonce !== "string" || typeof captured.operator !== "string"
      || typeof captured.confirmedAtMs !== "number" || typeof captured.text !== "string") {
      return refuse("invalid-confirmation", "A complete data-only confirmation is required.");
    }
    confirmation = Object.freeze({
      nonce: captured.nonce, operator: captured.operator, confirmedAtMs: captured.confirmedAtMs, text: captured.text,
    });
  }
  try {
    const evidence = await decodeExceptionalRecoveryEvidence(evidenceFileContents);
    if (evidence.version !== EXCEPTIONAL_RECOVERY_EVIDENCE_VERSION) {
      return refuse("marker-aware-evidence-required", "Execution planning requires version-2 evidence binding exact interruption-marker bytes.");
    }
    const source = Object.freeze({
      getItem(key: string): string | null {
        if (!Object.prototype.hasOwnProperty.call(current, key)) throw new Error("Unregistered recovery planning read.");
        return current[key];
      },
    });
    const assessment = await assessExceptionalRestoreAuthorization({
      backupFileContents, evidenceFileContents, currentSource: source, nonce: receipt.nonce,
      nowMs, challenge, confirmation,
    });
    if (assessment.status !== "preflight-passed") return refuse(assessment.reason, assessment.message);
    if (assessment.assessmentId !== receipt.assessmentId
      || assessment.expiresAtMs !== gate.expiresAtMs
      || JSON.stringify(assessment.binding) !== JSON.stringify(gate.binding)) {
      return refuse("attempt-mismatch", "Reverified inputs or confirmation do not match the transaction-gate receipt.");
    }
    const backup = validateStandaloneBackup(JSON.parse(backupFileContents));
    const entries = Object.freeze(EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => Object.freeze({
      key, before: current[key], target: backup.storage[key],
      change: current[key] === backup.storage[key] ? "unchanged" as const
        : backup.storage[key] === null ? "remove" as const : "set" as const,
    })));
    const body = Object.freeze({
      format: "empire-os-exceptional-recovery-execution-plan" as const,
      version: EXCEPTIONAL_RECOVERY_PLAN_VERSION,
      executionAllowed: false as const,
      attemptId: gate.attemptId,
      consumedConfirmationId: gate.consumedConfirmationId,
      challengeSha256: receipt.challengeSha256,
      assessmentId: receipt.assessmentId,
      acknowledgedAtMs: receipt.acknowledgedAtMs,
      plannedAtMs: nowMs,
      expiresAtMs: gate.expiresAtMs,
      versions: Object.freeze({
        backupFormat: BACKUP_FORMAT, backup: BACKUP_VERSION, evidence: evidence.version,
        challenge: 1, transactionGate: 1, writeFence: 1, recoverySnapshotFormat: 1,
        rawEncoding: "utf-16-code-units-v1",
        businessStoreKeys: Object.freeze([...EMPIRE_OS_BACKUP_STORAGE_KEYS]),
      }),
      binding: Object.freeze({ ...assessment.binding }),
      currentValues: current,
      recoveryState: assessment.recoveryState,
      entries,
      verification: Object.freeze({
        comparison: "exact-raw-string-or-null" as const,
        businessKeys: Object.freeze([...EMPIRE_OS_BACKUP_STORAGE_KEYS]),
        targetStorageSha256: assessment.binding.backupStorageSha256,
        originalHistorySha256: evidence.recoveryHistorySha256,
        originalMarkerSha256: evidence.interruptionMarkerSha256,
      }),
      stages,
      rollback: Object.freeze({
        businessValues: Object.freeze(Object.fromEntries(entries.map(entry => [entry.key, entry.before]))),
        recoveryHistory: current[RECOVERY_SNAPSHOTS_STORAGE_KEY],
        interruptionMarker: current[RESTORE_INTERRUPTION_STORAGE_KEY],
        validateAsBusinessData: false as const,
        restoreEveryBusinessKeyAndReadBack: true as const,
        preserveOriginalHistoryAndMarkerEvidence: true as const,
        clearMarkerAutomatically: false as const,
        requiresExclusiveWriterControl: true as const,
        expiryDoesNotRemoveRollbackObligation: true as const,
        onLostWriterControl: "retain-fence-do-not-overwrite-unattributed-writes" as const,
        onUncertainOutcome: "retain-fence-and-journal-stop-for-reconciliation" as const,
        resumeAfterInterruption: "never-resume-from-plan-alone" as const,
      }),
      risks: Object.freeze([
        "localStorage-has-no-multi-key-atomic-commit-or-rollback",
        "sequential-snapshots-and-readbacks-do-not-exclude-other-tabs-or-ABA-changes",
        "write-fence-check-then-write-is-not-cross-tab-mutual-exclusion",
        "quota-IO-and-process-termination-can-interrupt-forward-writes-or-rollback",
        "a-hash-or-gate-receipt-is-not-durable-execution-authority",
      ]),
      notice: "Planning only. No writes, marker clearing, restoration or execution authorization." as const,
    });
    const planSha256 = await exceptionalRecoveryFingerprint(
      "empire-os-exceptional-recovery-execution-plan-v1", JSON.stringify(body),
    );
    return Object.freeze({ status: "planned" as const, executionAllowed: false as const, plan: Object.freeze({ ...body, planSha256 }) });
  } catch (error) {
    return refuse("planning-failed", `Recovery planning failed without writes: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export type ExceptionalRecoveryExecutionPlanResult = Awaited<ReturnType<typeof planExceptionalRecoveryExecution>>;
export type ExceptionalRecoveryExecutionPlan = Extract<ExceptionalRecoveryExecutionPlanResult, { status: "planned" }>["plan"];
