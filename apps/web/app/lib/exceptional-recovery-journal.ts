import { EMPIRE_OS_BACKUP_STORAGE_KEYS, RECOVERY_SNAPSHOTS_STORAGE_KEY } from "./backup";
import { RESTORE_INTERRUPTION_STORAGE_KEY } from "./browser-write-fence";
import {
  isOriginalExceptionalRecoveryExecutionPlan, type ExceptionalRecoveryExecutionPlan,
} from "./exceptional-recovery-execution-plan";
import { createExceptionalRecoveryEvidence } from "./exceptional-recovery-evidence";
import { exceptionalRecoveryFingerprint } from "./exceptional-recovery-fingerprint";
import { isObject, isSha256 } from "./server-persistence-contract";

export const RECOVERY_JOURNAL_FORMAT = "empire-os-exceptional-recovery-journal";
export const RECOVERY_JOURNAL_VERSION = 1;
export const RECOVERY_JOURNAL_RAW_KEYS = Object.freeze([
  ...EMPIRE_OS_BACKUP_STORAGE_KEYS, RECOVERY_SNAPSHOTS_STORAGE_KEY, RESTORE_INTERRUPTION_STORAGE_KEY,
]);

export type RecoveryJournalState =
  | "prepared" | "rollback-image-checked" | "fence-observed" | "interrupted" | "uncertain" | "refused";
type FailureState = Extract<RecoveryJournalState, "interrupted" | "uncertain" | "refused">;
export type RecoveryJournalFailureReason =
  | "operator-refusal" | "expired" | "storage-failure" | "crash-interruption"
  | "readback-mismatch" | "writer-exclusion-lost" | "unknown-outcome";

type RawEntry = Readonly<{ key: string; rawValue: string | null }>;
export type RecoveryRollbackImage = Readonly<{
  format: "empire-os-recovery-rollback-image";
  version: 1;
  attemptId: string;
  planSha256: string;
  entries: readonly RawEntry[];
}>;
type JournalBinding = Readonly<{
  planVersion: number;
  planSha256: string;
  attemptId: string;
  consumedConfirmationId: string;
  challengeSha256: string;
  assessmentId: string;
  backupFileSha256: string;
  backupStorageSha256: string;
  evidenceFileSha256: string;
  evidenceSha256: string;
  currentStateSha256: string;
  historySha256: string;
  markerSha256: string;
  acknowledgedAtMs: number;
  plannedAtMs: number;
  expiresAtMs: number;
}>;
type JournalProof = Readonly<{ imageSha256: string; stateSha256: string; marker: string | null }>;
export type RecoveryJournalRecord = Readonly<{
  sequence: number;
  state: RecoveryJournalState;
  atMs: number;
  previousSha256: string | null;
  proof: JournalProof | null;
  reason: RecoveryJournalFailureReason | null;
  recordSha256: string;
}>;
export type RecoveryJournal = Readonly<{
  format: typeof RECOVERY_JOURNAL_FORMAT;
  version: typeof RECOVERY_JOURNAL_VERSION;
  executionAllowed: false;
  binding: JournalBinding;
  bindingSha256: string;
  rollbackImage: RecoveryRollbackImage;
  rollbackImageSha256: string;
  records: readonly RecoveryJournalRecord[];
}>;

// Must come from independent trusted state, never from the record currently being checked.
export type RecoveryJournalCheckpoint = Readonly<{
  attemptId: string;
  planSha256: string;
  bindingSha256: string;
  rollbackImageSha256: string;
  sequence: number;
  headSha256: string;
}>;
type JournalReady = Readonly<{
  status: "journal";
  executionAllowed: false;
  journal: RecoveryJournal;
  serialized: string;
  checkpoint: RecoveryJournalCheckpoint;
}>;
type JournalRefused = Readonly<{ status: "refused"; executionAllowed: false; message: string }>;
export type RecoveryJournalResult = JournalReady | JournalRefused;
export type RecoveryJournalTransition =
  | Readonly<{
    state: "rollback-image-checked" | "fence-observed";
    rollbackImageReadback: string;
    currentValues: Readonly<Record<string, string | null>>;
  }>
  | Readonly<{ state: FailureState; reason: RecoveryJournalFailureReason }>;

const NEXT: Readonly<Record<RecoveryJournalState, readonly RecoveryJournalState[]>> = Object.freeze({
  prepared: Object.freeze(["rollback-image-checked", "interrupted", "uncertain", "refused"] as const),
  "rollback-image-checked": Object.freeze(["fence-observed", "interrupted", "uncertain", "refused"] as const),
  "fence-observed": Object.freeze(["interrupted", "uncertain", "refused"] as const),
  interrupted: Object.freeze(["uncertain", "refused"] as const),
  uncertain: Object.freeze(["refused"] as const),
  refused: Object.freeze([]),
});
const REASONS: readonly RecoveryJournalFailureReason[] = Object.freeze([
  "operator-refusal", "expired", "storage-failure", "crash-interruption",
  "readback-mismatch", "writer-exclusion-lost", "unknown-outcome",
]);
const BINDING_FIELDS = [
  "planVersion", "planSha256", "attemptId", "consumedConfirmationId", "challengeSha256", "assessmentId",
  "backupFileSha256", "backupStorageSha256", "evidenceFileSha256", "evidenceSha256",
  "currentStateSha256", "historySha256", "markerSha256", "acknowledgedAtMs", "plannedAtMs", "expiresAtMs",
] as const;

function refused(message: string): JournalRefused {
  return Object.freeze({ status: "refused", executionAllowed: false, message });
}
function fields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isObject(value) && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && "value" in descriptor;
    });
}
function clock(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function state(value: unknown): value is RecoveryJournalState {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(NEXT, value);
}
function failure(value: RecoveryJournalState): value is FailureState {
  return value === "interrupted" || value === "uncertain" || value === "refused";
}
function failureReason(value: unknown): value is RecoveryJournalFailureReason {
  return REASONS.some(reason => reason === value);
}
function validBinding(value: unknown): value is JournalBinding {
  return fields(value, BINDING_FIELDS) && value.planVersion === 1
    && BINDING_FIELDS.filter(key => key.endsWith("Sha256") || key.endsWith("Id")).every(key => isSha256(value[key]))
    && clock(value.acknowledgedAtMs) && clock(value.plannedAtMs) && clock(value.expiresAtMs)
    && value.acknowledgedAtMs <= value.plannedAtMs && value.plannedAtMs < value.expiresAtMs;
}
async function fingerprint(kind: string, value: unknown): Promise<string> {
  return exceptionalRecoveryFingerprint(`empire-os-recovery-journal-${kind}-v1`, JSON.stringify(value));
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function ready(journal: RecoveryJournal): JournalReady {
  const head = journal.records[journal.records.length - 1];
  return freeze({
    status: "journal", executionAllowed: false, journal, serialized: JSON.stringify(journal),
    checkpoint: {
      attemptId: journal.binding.attemptId, planSha256: journal.binding.planSha256,
      bindingSha256: journal.bindingSha256, rollbackImageSha256: journal.rollbackImageSha256,
      sequence: head.sequence, headSha256: head.recordSha256,
    },
  });
}
function rawValues(value: unknown): Readonly<Record<string, string | null>> {
  if (!fields(value, RECOVERY_JOURNAL_RAW_KEYS)) throw new Error("A complete data-only 23-value raw image is required.");
  const entries = RECOVERY_JOURNAL_RAW_KEYS.map(key => {
    const rawValue = value[key];
    if (rawValue !== null && typeof rawValue !== "string") throw new Error("Raw image values must be exact strings or null.");
    return [key, rawValue] as const;
  });
  return Object.freeze(Object.fromEntries(entries));
}
function imageValues(image: RecoveryRollbackImage): Readonly<Record<string, string | null>> {
  return rawValues(Object.fromEntries(image.entries.map(entry => [entry.key, entry.rawValue])));
}
function fenceBytes(binding: JournalBinding, rollbackImageSha256: string): string {
  return JSON.stringify({
    format: "empire-os-recovery-journal-fence", version: 1, attemptId: binding.attemptId,
    planSha256: binding.planSha256, rollbackImageSha256,
  });
}
async function evidenceFor(values: Readonly<Record<string, string | null>>) {
  return createExceptionalRecoveryEvidence({
    getItem(key) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) throw new Error("Unregistered journal image read.");
      return values[key];
    },
  }, { allowInterruptedMarker: true });
}
async function proofFor(journal: RecoveryJournal, next: "rollback-image-checked" | "fence-observed"): Promise<JournalProof> {
  const values = imageValues(journal.rollbackImage);
  const marker = next === "fence-observed"
    ? fenceBytes(journal.binding, journal.rollbackImageSha256) : values[RESTORE_INTERRUPTION_STORAGE_KEY];
  const observed = { ...values, [RESTORE_INTERRUPTION_STORAGE_KEY]: marker };
  return Object.freeze({
    imageSha256: journal.rollbackImageSha256,
    stateSha256: (await evidenceFor(observed)).evidenceSha256, marker,
  });
}
async function record(
  journal: Pick<RecoveryJournal, "bindingSha256" | "rollbackImageSha256">,
  body: Omit<RecoveryJournalRecord, "recordSha256">,
): Promise<RecoveryJournalRecord> {
  return Object.freeze({
    ...body,
    recordSha256: await fingerprint("record", [journal.bindingSha256, journal.rollbackImageSha256, body]),
  });
}

export async function buildRecoveryJournal(plan: ExceptionalRecoveryExecutionPlan, nowMs: number): Promise<RecoveryJournalResult> {
  if (!isOriginalExceptionalRecoveryExecutionPlan(plan)) return refused("An original Phase 4A plan is required; copies are not authority.");
  if (!clock(nowMs) || nowMs < plan.plannedAtMs || nowMs >= plan.expiresAtMs) return refused("Journal preparation time is invalid or expired.");
  try {
    const markerSha256 = plan.verification.originalMarkerSha256;
    if (!isSha256(markerSha256)) return refused("Marker-aware plan evidence is required.");
    const binding: JournalBinding = Object.freeze({
      planVersion: plan.version, planSha256: plan.planSha256, attemptId: plan.attemptId,
      consumedConfirmationId: plan.consumedConfirmationId, challengeSha256: plan.challengeSha256,
      assessmentId: plan.assessmentId, ...plan.binding,
      historySha256: plan.verification.originalHistorySha256, markerSha256,
      acknowledgedAtMs: plan.acknowledgedAtMs, plannedAtMs: plan.plannedAtMs, expiresAtMs: plan.expiresAtMs,
    });
    const values = rawValues(plan.currentValues);
    const rollbackImage: RecoveryRollbackImage = freeze({
      format: "empire-os-recovery-rollback-image", version: 1,
      attemptId: binding.attemptId, planSha256: binding.planSha256,
      entries: RECOVERY_JOURNAL_RAW_KEYS.map(key => ({ key, rawValue: values[key] })),
    });
    const base: Omit<RecoveryJournal, "records"> = {
      format: RECOVERY_JOURNAL_FORMAT, version: RECOVERY_JOURNAL_VERSION, executionAllowed: false as const,
      binding, bindingSha256: await fingerprint("binding", binding),
      rollbackImage, rollbackImageSha256: await fingerprint("rollback-image", rollbackImage),
    };
    const initial = await record(base, {
      sequence: 0, state: "prepared", atMs: nowMs, previousSha256: null, proof: null, reason: null,
    });
    return ready({ ...base, records: [initial] });
  } catch (error) {
    return refused(`Journal preparation failed without writes: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function validateRecoveryJournal(
  serialized: string, checkpoint: RecoveryJournalCheckpoint, nowMs: number,
): Promise<RecoveryJournalResult> {
  try {
    if (typeof serialized !== "string" || !clock(nowMs)) throw new Error("Journal bytes and a trusted observation clock are required.");
    if (!fields(checkpoint, ["attemptId", "planSha256", "bindingSha256", "rollbackImageSha256", "sequence", "headSha256"])
      || !clock(checkpoint.sequence)
      || !(["attemptId", "planSha256", "bindingSha256", "rollbackImageSha256", "headSha256"] as const).every(key => isSha256(checkpoint[key]))) {
      throw new Error("An independent complete journal checkpoint is required.");
    }
    // Capture the external checkpoint before hashing; do not retain caller-owned objects.
    const expected = { ...checkpoint };
    const parsed: unknown = JSON.parse(serialized);
    if (!fields(parsed, ["format", "version", "executionAllowed", "binding", "bindingSha256", "rollbackImage", "rollbackImageSha256", "records"])
      || parsed.format !== RECOVERY_JOURNAL_FORMAT || parsed.version !== RECOVERY_JOURNAL_VERSION
      || parsed.executionAllowed !== false || JSON.stringify(parsed) !== serialized) {
      throw new Error("Journal is malformed, noncanonical, partial or incompatible.");
    }
    const binding = parsed.binding;
    if (!validBinding(binding) || await fingerprint("binding", binding) !== parsed.bindingSha256) throw new Error("Journal binding integrity failed.");
    const image = parsed.rollbackImage;
    if (!fields(image, ["format", "version", "attemptId", "planSha256", "entries"])
      || image.format !== "empire-os-recovery-rollback-image" || image.version !== 1
      || image.attemptId !== binding.attemptId || image.planSha256 !== binding.planSha256
      || !Array.isArray(image.entries) || image.entries.length !== RECOVERY_JOURNAL_RAW_KEYS.length) {
      throw new Error("Rollback image is incomplete or belongs to a different plan/attempt.");
    }
    const entries: RawEntry[] = [];
    for (const [index, entry] of image.entries.entries()) {
      if (!fields(entry, ["key", "rawValue"]) || entry.key !== RECOVERY_JOURNAL_RAW_KEYS[index]
        || (entry.rawValue !== null && typeof entry.rawValue !== "string")) throw new Error("Rollback image inventory is incomplete, duplicated or malformed.");
      entries.push({ key: entry.key, rawValue: entry.rawValue });
    }
    const rollbackImage: RecoveryRollbackImage = {
      format: image.format, version: image.version, attemptId: image.attemptId, planSha256: image.planSha256, entries,
    };
    if (await fingerprint("rollback-image", rollbackImage) !== parsed.rollbackImageSha256) throw new Error("Rollback image integrity failed.");
    const evidence = await evidenceFor(imageValues(rollbackImage));
    if (evidence.evidenceSha256 !== binding.currentStateSha256 || evidence.evidenceSha256 !== binding.evidenceSha256
      || evidence.recoveryHistorySha256 !== binding.historySha256
      || evidence.interruptionMarkerSha256 !== binding.markerSha256) throw new Error("Rollback image does not match the planned source state.");
    if (!Array.isArray(parsed.records) || parsed.records.length === 0 || parsed.records.length > 6) throw new Error("Journal history is missing or exceeds its monotonic state bound.");
    if (!isSha256(parsed.bindingSha256) || !isSha256(parsed.rollbackImageSha256)) throw new Error("Journal fingerprints are malformed.");
    const journalBase = { bindingSha256: parsed.bindingSha256, rollbackImageSha256: parsed.rollbackImageSha256 };
    const proofJournal: RecoveryJournal = {
      format: RECOVERY_JOURNAL_FORMAT, version: 1, executionAllowed: false,
      binding, bindingSha256: journalBase.bindingSha256, rollbackImage,
      rollbackImageSha256: journalBase.rollbackImageSha256, records: [],
    };
    const records: RecoveryJournalRecord[] = [];
    for (const [index, item] of parsed.records.entries()) {
      if (!fields(item, ["sequence", "state", "atMs", "previousSha256", "proof", "reason", "recordSha256"])
        || item.sequence !== index || !state(item.state) || !clock(item.atMs) || !isSha256(item.recordSha256)) throw new Error("Journal record is malformed.");
      const previous = records[index - 1];
      if (index === 0
        ? item.state !== "prepared" || item.previousSha256 !== null || item.atMs < binding.plannedAtMs
        : !previous || !NEXT[previous.state].includes(item.state) || item.previousSha256 !== previous.recordSha256 || item.atMs < previous.atMs) {
        throw new Error("Journal transition, sequence or previous-head integrity failed.");
      }
      if (!failure(item.state) && item.atMs >= binding.expiresAtMs) throw new Error("Expired journal cannot advance preparation.");
      let proof: JournalProof | null = null;
      let reason: RecoveryJournalFailureReason | null = null;
      if (failure(item.state)) {
        if (item.proof !== null || !failureReason(item.reason)) throw new Error("Failure records require an explicit reason and no success proof.");
        reason = item.reason;
      } else if (item.state === "prepared") {
        if (item.proof !== null || item.reason !== null) throw new Error("Preparation cannot claim readback or success.");
      } else {
        const expectedProof = await proofFor(proofJournal, item.state);
        if (item.reason !== null || JSON.stringify(item.proof) !== JSON.stringify(expectedProof)) throw new Error("Readback proof does not match the complete image and expected fence.");
        proof = expectedProof;
      }
      const body = {
        sequence: index, state: item.state, atMs: item.atMs,
        previousSha256: previous?.recordSha256 ?? null,
        proof, reason,
      };
      const checked = await record(journalBase, body);
      if (checked.recordSha256 !== item.recordSha256) throw new Error("Journal record fingerprint failed.");
      records.push(checked);
    }
    const head = records[records.length - 1];
    if (nowMs < head.atMs) throw new Error("Observation clock precedes the journal head.");
    if (binding.attemptId !== expected.attemptId || binding.planSha256 !== expected.planSha256
      || parsed.bindingSha256 !== expected.bindingSha256 || parsed.rollbackImageSha256 !== expected.rollbackImageSha256
      || head.sequence !== expected.sequence || head.recordSha256 !== expected.headSha256) {
      throw new Error("Journal is replayed, truncated, forked or mismatched against the trusted checkpoint.");
    }
    return ready({ ...proofJournal, records });
  } catch (error) {
    return refused(`Journal validation refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function transitionRecoveryJournal(
  serialized: string, checkpoint: RecoveryJournalCheckpoint, transition: RecoveryJournalTransition, nowMs: number,
): Promise<RecoveryJournalResult> {
  try {
    let captured: RecoveryJournalTransition;
    if (fields(transition, ["state", "reason"]) && "reason" in transition
      && state(transition.state) && failure(transition.state)
      && failureReason(transition.reason)) {
      captured = { state: transition.state, reason: transition.reason };
    } else if (fields(transition, ["state", "rollbackImageReadback", "currentValues"])
      && (transition.state === "rollback-image-checked" || transition.state === "fence-observed")
      && typeof transition.rollbackImageReadback === "string") {
      captured = { state: transition.state, rollbackImageReadback: transition.rollbackImageReadback, currentValues: rawValues(transition.currentValues) };
    } else return refused("Unsupported journal transition or proof shape.");
    const checked = await validateRecoveryJournal(serialized, checkpoint, nowMs);
    if (checked.status !== "journal") return checked;
    const { journal } = checked;
    const previous = journal.records[journal.records.length - 1];
    if (!NEXT[previous.state].includes(captured.state)) return refused("Invalid or replayed journal transition; terminal/failure states cannot resume preparation.");
    let proof: JournalProof | null = null;
    let reason: RecoveryJournalFailureReason | null = null;
    if ("reason" in captured) reason = captured.reason;
    else {
      if (nowMs >= journal.binding.expiresAtMs) return refused("Expired attempts cannot advance preparation or fencing.");
      if (captured.rollbackImageReadback !== JSON.stringify(journal.rollbackImage)) return refused("Rollback-image readback is not the exact complete canonical image.");
      const expected = imageValues(journal.rollbackImage);
      const marker = captured.state === "fence-observed"
        ? fenceBytes(journal.binding, journal.rollbackImageSha256) : expected[RESTORE_INTERRUPTION_STORAGE_KEY];
      if (RECOVERY_JOURNAL_RAW_KEYS.some(key => captured.currentValues[key] !== (key === RESTORE_INTERRUPTION_STORAGE_KEY ? marker : expected[key]))) {
        return refused("Observed state is stale, incomplete or does not match the exact expected fence and rollback bytes.");
      }
      proof = await proofFor(journal, captured.state);
    }
    const next = await record(journal, {
      sequence: previous.sequence + 1, state: captured.state, atMs: nowMs,
      previousSha256: previous.recordSha256, proof, reason,
    });
    return ready({ ...journal, records: [...journal.records, next] });
  } catch (error) {
    return refused(`Journal transition refused without writes: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function assessRecoveryJournalReconciliation(
  input: Readonly<{
    serialized: string;
    checkpoint: RecoveryJournalCheckpoint;
    currentValues: Readonly<Record<string, string | null>>;
    rollbackImageReadback: string | null;
    nowMs: number;
  }>,
) {
  const stop = (message: string) => Object.freeze({
    status: "blocked" as const, executionAllowed: false as const, resumeAllowed: false as const,
    clearMarkerAllowed: false as const, rollbackAllowed: false as const, message,
  });
  try {
    const values = rawValues(input.currentValues);
    const { serialized, checkpoint, rollbackImageReadback, nowMs } = input;
    const checked = await validateRecoveryJournal(serialized, checkpoint, nowMs);
    if (checked.status !== "journal") return stop(checked.message);
    const { journal } = checked;
    if (rollbackImageReadback !== JSON.stringify(journal.rollbackImage)) return stop("Rollback image is missing, partial or mismatched; preserve all evidence.");
    const before = imageValues(journal.rollbackImage);
    const changedBusinessKeys = Object.freeze(EMPIRE_OS_BACKUP_STORAGE_KEYS.filter(key => values[key] !== before[key]));
    const historyMatches = values[RECOVERY_SNAPSHOTS_STORAGE_KEY] === before[RECOVERY_SNAPSHOTS_STORAGE_KEY];
    const marker = values[RESTORE_INTERRUPTION_STORAGE_KEY];
    const markerState = marker === fenceBytes(journal.binding, journal.rollbackImageSha256) ? "attempt-fence"
      : marker === before[RESTORE_INTERRUPTION_STORAGE_KEY] ? "original" : "unexpected";
    return freeze({
      status: "assessed" as const, executionAllowed: false as const, resumeAllowed: false as const,
      clearMarkerAllowed: false as const,
      journalState: journal.records[journal.records.length - 1].state,
      expired: nowMs >= journal.binding.expiresAtMs,
      changedBusinessKeys, historyMatches, markerState,
      disposition: changedBusinessKeys.length === 0 && historyMatches && markerState === "original"
        ? "before-image-observed-not-proof-of-no-writes" as const : "interruption-or-concurrency-requires-investigation" as const,
      rollbackAllowed: false as const,
      obligation: "retain-evidence-and-fence-no-automatic-resume-or-rollback" as const,
      unresolvedPrerequisite: "durable-checkpoint-CAS-and-cross-tab-writer-exclusion" as const,
    });
  } catch (error) {
    return stop(`Read-only reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
