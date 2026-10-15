import {
  validateRecoveryJournal, type RecoveryJournalCheckpoint, type RecoveryJournalResult,
} from "./exceptional-recovery-journal";
import { exceptionalRecoveryFingerprint } from "./exceptional-recovery-fingerprint";
import { isCounter, isDatasetId, isObject, isSha256 } from "./server-persistence-contract";

export const RECOVERY_CHECKPOINT_COORDINATION_VERSION = 1;
const SAFETY = Object.freeze({
  executionAllowed: false as const, resumeAllowed: false as const,
  rollbackAllowed: false as const, clearMarkerAllowed: false as const,
});
export const RECOVERY_CHECKPOINT_EXECUTION_PREREQUISITES = Object.freeze([
  "real-durable-linearizable-authority-and-atomic-evidence-storage",
  "authenticated-scope-and-nonreusable-authority-epoch",
  "durable-single-use-confirmation-and-exclusive-attempt-enrollment",
  "independent-all-writer-exclusion-at-every-business-write-boundary",
  "trusted-clock-and-live-state-revalidation-at-commit",
  "crash-tested-forward-rollback-and-separate-fence-release-protocols",
] as const);

export type RecoveryCheckpointIdentity = Readonly<{
  authorityId: string;
  datasetId: string;
  epoch: string;
}>;
export type RecoveryCheckpointEvidence = Readonly<{
  serializedJournal: string;
  rollbackImageReadback: string;
  checkpoint: RecoveryJournalCheckpoint;
}>;
export type RecoveryCheckpointSnapshot = Readonly<{
  identity: RecoveryCheckpointIdentity;
  revision: number;
  lastRequestSha256: string | null;
  evidence: RecoveryCheckpointEvidence;
}>;
export type RecoveryCheckpointCASRequest = Readonly<{
  version: typeof RECOVERY_CHECKPOINT_COORDINATION_VERSION;
  expected: RecoveryCheckpointSnapshot;
  next: RecoveryCheckpointEvidence;
  requestSha256: string;
}>;
export type RecoveryCheckpointDurableAcknowledgement = Readonly<{
  durability: "authority-commit-confirmed";
  requestSha256: string;
  snapshot: RecoveryCheckpointSnapshot;
}>;
type AuthorityProblem = Readonly<{
  status: "missing" | "unavailable" | "authority-lost" | "uncertain";
  message: string;
}>;
export type RecoveryCheckpointReadResult =
  | Readonly<{ status: "current"; durability: "authority-commit-confirmed"; snapshot: RecoveryCheckpointSnapshot }>
  | AuthorityProblem;
export type RecoveryCheckpointLookupResult =
  | Readonly<{ status: "committed"; acknowledgement: RecoveryCheckpointDurableAcknowledgement }>
  | Readonly<{ status: "not-found" }>
  | AuthorityProblem;
export type RecoveryCheckpointCASResult =
  | Readonly<{ status: "committed"; acknowledgement: RecoveryCheckpointDurableAcknowledgement }>
  | AuthorityProblem
  | Readonly<{ status: "conflict"; message: string }>;

/**
 * Trusted composition dependency, not a browser-supplied repository.
 * The backend must atomically validate scope/session/epoch, full expected state,
 * attempt identity, expiry and evidence; pin the complete next journal/image;
 * increment the global scope revision; and retain an immutable request receipt.
 * Reads/lookup must be linearizable and authenticated. Missing state is not revision
 * zero. Re-enrollment, reset, transfer, deletion and fence release are absent.
 */
export interface TrustedRecoveryCheckpointAuthority {
  readCurrent(identity: RecoveryCheckpointIdentity): Promise<RecoveryCheckpointReadResult>;
  compareAndSwap(request: RecoveryCheckpointCASRequest): Promise<RecoveryCheckpointCASResult>;
  lookup(identity: RecoveryCheckpointIdentity, requestSha256: string): Promise<RecoveryCheckpointLookupResult>;
}

const observationBrand: unique symbol = Symbol("recovery-checkpoint-observation");
export type TrustedRecoveryCheckpointObservation = Readonly<{
  readonly [observationBrand]: true;
}>;
const acknowledgementBrand: unique symbol = Symbol("recovery-checkpoint-acknowledgement");
export type TrustedRecoveryCheckpointAcknowledgement = Readonly<{
  readonly [acknowledgementBrand]: true;
}>;
type ReaderSession = { generation: object; highWater?: RecoveryCheckpointSnapshot };
type Provenance = Readonly<{ session: ReaderSession; generation: object; atMs: number }>;
const observations = new WeakMap<object, Provenance & Readonly<{ snapshot: RecoveryCheckpointSnapshot }>>();
const acknowledgements = new WeakMap<object, Readonly<{
  acknowledgement: RecoveryCheckpointDurableAcknowledgement;
}> & Provenance>();

function refused(reason: string, message: string) {
  return Object.freeze({ status: "refused" as const, ...SAFETY, reason, message });
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function requireAuthorityResult(value: unknown, success: string): void {
  if (!isObject(value)) throw new Error("Authority returned no verifiable result.");
  const descriptor = Object.getOwnPropertyDescriptor(value, "status");
  if (!descriptor || !("value" in descriptor)) throw new Error("Authority status must be an own data field.");
  if (descriptor.value === success) return;
  if (descriptor.value === "not-found") {
    data(value, ["status"]);
    throw new Error("Receipt not found; absence does not prove no commit. Retain evidence and fence.");
  }
  const problem = data(value, ["status", "message"]);
  if (typeof problem.status !== "string"
    || !["missing", "unavailable", "authority-lost", "uncertain", "conflict"].includes(problem.status)
    || typeof problem.message !== "string") throw new Error("Authority returned an unsupported outcome.");
  throw new Error(`${problem.status}: ${problem.message}; retain evidence and fence, never rebuild authority from caller bytes.`);
}
function isCurrentProvenance(value: Provenance): boolean {
  return value.generation === value.session.generation;
}
function isCurrentObservation(value: Provenance & Readonly<{ snapshot: RecoveryCheckpointSnapshot }>): boolean {
  return isCurrentProvenance(value) && same(value.snapshot, value.session.highWater);
}
function data(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isObject(value) || Reflect.ownKeys(value).length !== keys.length) throw new Error("Incomplete or unsupported data shape.");
  const captured: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new Error("Only own data fields are supported; accessors are not observations.");
    captured[key] = descriptor.value;
  }
  return captured;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function identity(value: unknown): RecoveryCheckpointIdentity {
  const item = data(value, ["authorityId", "datasetId", "epoch"]);
  if (!isSha256(item.authorityId) || !isDatasetId(item.datasetId) || !isSha256(item.epoch)) {
    throw new Error("An independently pinned authority, dataset and nonreusable epoch are required.");
  }
  return Object.freeze({ authorityId: item.authorityId, datasetId: item.datasetId, epoch: item.epoch });
}
function checkpoint(value: unknown): RecoveryJournalCheckpoint {
  const item = data(value, ["attemptId", "planSha256", "bindingSha256", "rollbackImageSha256", "sequence", "headSha256"]);
  if (!isSha256(item.attemptId) || !isSha256(item.planSha256) || !isSha256(item.bindingSha256)
    || !isSha256(item.rollbackImageSha256) || !isCounter(item.sequence) || !isSha256(item.headSha256)) {
    throw new Error("A complete checkpoint with strict attempt identity is required.");
  }
  return Object.freeze({
    attemptId: item.attemptId, planSha256: item.planSha256, bindingSha256: item.bindingSha256,
    rollbackImageSha256: item.rollbackImageSha256, sequence: item.sequence, headSha256: item.headSha256,
  });
}
function evidence(value: unknown): RecoveryCheckpointEvidence {
  const item = data(value, ["serializedJournal", "rollbackImageReadback", "checkpoint"]);
  if (typeof item.serializedJournal !== "string" || typeof item.rollbackImageReadback !== "string") {
    throw new Error("Complete canonical journal and rollback-image bytes are required.");
  }
  return Object.freeze({
    serializedJournal: item.serializedJournal, rollbackImageReadback: item.rollbackImageReadback,
    checkpoint: checkpoint(item.checkpoint),
  });
}
function snapshot(value: unknown): RecoveryCheckpointSnapshot {
  const item = data(value, ["identity", "revision", "lastRequestSha256", "evidence"]);
  if (!isCounter(item.revision) || item.revision === 0
    || (item.lastRequestSha256 !== null && !isSha256(item.lastRequestSha256))) {
    throw new Error("A provisioned, monotonic safe revision and complete receipt reference are required.");
  }
  return freeze({
    identity: identity(item.identity), revision: item.revision,
    lastRequestSha256: item.lastRequestSha256, evidence: evidence(item.evidence),
  });
}
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function requireClock(nowMs: unknown): asserts nowMs is number {
  if (!isCounter(nowMs)) throw new Error("A safe nonnegative observation clock is required.");
}
async function validateEvidence(value: RecoveryCheckpointEvidence, nowMs: number) {
  const checked = await validateRecoveryJournal(value.serializedJournal, value.checkpoint, nowMs);
  if (checked.status !== "journal") throw new Error(checked.message);
  if (value.rollbackImageReadback !== JSON.stringify(checked.journal.rollbackImage)) {
    throw new Error("Rollback image is missing, partial or not the exact validated 23-value image.");
  }
  return checked;
}
type ValidJournal = Extract<RecoveryJournalResult, { status: "journal" }>;
function requireExtension(
  before: ValidJournal, after: ValidJournal, nowMs: number, purpose: "advance" | "historical",
): void {
  const left = before.journal;
  const right = after.journal;
  if (!same(left.binding, right.binding) || left.bindingSha256 !== right.bindingSha256
    || left.rollbackImageSha256 !== right.rollbackImageSha256 || !same(left.rollbackImage, right.rollbackImage)) {
    throw new Error("Attempt, plan, confirmation, binding and rollback image are immutable; competing attempts cannot take over.");
  }
  if (right.records.length !== left.records.length + 1
    || !same(left.records, right.records.slice(0, -1))) {
    throw new Error("Only one exact journal successor is allowed; replay, truncation, skips and forks are refused.");
  }
  const head = right.records[right.records.length - 1];
  if (purpose === "advance"
    && (head.state === "prepared" || head.state === "rollback-image-checked" || head.state === "fence-observed")
    && nowMs >= right.binding.expiresAtMs) {
    throw new Error("Preparation cannot advance after expiry; failure evidence may still be retained.");
  }
}
async function requestHash(body: Omit<RecoveryCheckpointCASRequest, "requestSha256">) {
  return exceptionalRecoveryFingerprint("empire-os-recovery-checkpoint-cas-v1", JSON.stringify(body));
}
function captureRequest(value: unknown): RecoveryCheckpointCASRequest {
  const item = data(value, ["version", "expected", "next", "requestSha256"]);
  if (item.version !== RECOVERY_CHECKPOINT_COORDINATION_VERSION || !isSha256(item.requestSha256)) {
    throw new Error("Unsupported coordination version or malformed request fingerprint.");
  }
  return freeze({
    version: RECOVERY_CHECKPOINT_COORDINATION_VERSION,
    expected: snapshot(item.expected), next: evidence(item.next), requestSha256: item.requestSha256,
  });
}
async function validateRequest(
  request: RecoveryCheckpointCASRequest, nowMs: number, purpose: "advance" | "historical",
) {
  requireClock(nowMs);
  if (request.expected.revision === Number.MAX_SAFE_INTEGER) throw new Error("Authority revision is exhausted; never wrap or reset.");
  const before = await validateEvidence(request.expected.evidence, nowMs);
  const after = await validateEvidence(request.next, nowMs);
  requireExtension(before, after, nowMs, purpose);
  const hash = await requestHash({ version: request.version, expected: request.expected, next: request.next });
  if (hash !== request.requestSha256) throw new Error("CAS request integrity failed.");
  return { before, after };
}
function nextSnapshot(request: RecoveryCheckpointCASRequest): RecoveryCheckpointSnapshot {
  return freeze({
    identity: request.expected.identity, revision: request.expected.revision + 1,
    lastRequestSha256: request.requestSha256, evidence: request.next,
  });
}

/**
 * Read/lookup only. No method here invokes compareAndSwap. The injected dependency
 * is the trust boundary; local brands prevent copying observations into authority,
 * but cannot make a dishonest or non-durable implementation trustworthy.
 */
export function createRecoveryCheckpointAuthorityReader(
  authority: TrustedRecoveryCheckpointAuthority, pinnedIdentity: RecoveryCheckpointIdentity,
) {
  const pinned = identity(pinnedIdentity);
  const readCurrent = authority.readCurrent.bind(authority);
  const lookup = authority.lookup.bind(authority);
  const session: ReaderSession = { generation: {} };
  let highWaterJournal: ValidJournal | undefined;
  let observedAtMs = 0;
  return Object.freeze({
    async read(nowMs: number) {
      try {
        requireClock(nowMs);
        const generation = session.generation;
        const raw = await readCurrent(pinned);
        requireAuthorityResult(raw, "current");
        const result = data(raw, ["status", "durability", "snapshot"]);
        if (result.durability !== "authority-commit-confirmed") throw new Error("A caller observation or queued update is not a durable authority acknowledgement.");
        const current = snapshot(result.snapshot);
        if (!same(current.identity, pinned)) throw new Error("Authority identity, dataset or epoch changed.");
        const checked = await validateEvidence(current.evidence, nowMs);
        if (generation !== session.generation) throw new Error("Authority was lost during this read; obtain a new observation.");
        const highWater = session.highWater;
        if (nowMs < observedAtMs || (highWater && (current.revision < highWater.revision
          || (current.revision === highWater.revision && !same(current, highWater))))) {
          throw new Error("Authority revision/clock regressed or the same revision changed contents.");
        }
        if (highWater && highWaterJournal && current.revision > highWater.revision) {
          const before = highWaterJournal.journal;
          const after = checked.journal;
          if (!same(before.binding, after.binding) || !same(before.rollbackImage, after.rollbackImage)
            || current.revision - highWater.revision !== after.records.length - before.records.length
            || !same(before.records, after.records.slice(0, before.records.length))) {
            throw new Error("Authority advanced to a competing attempt, fork or impossible revision history.");
          }
        }
        session.highWater = current;
        highWaterJournal = checked;
        observedAtMs = nowMs;
        const observation: TrustedRecoveryCheckpointObservation = Object.freeze({ [observationBrand]: true as const });
        observations.set(observation, Object.freeze({
          snapshot: current, atMs: nowMs, session, generation: session.generation,
        }));
        return Object.freeze({ status: "observed" as const, ...SAFETY, observation });
      } catch (error) {
        session.generation = {};
        return refused("authority-read-refused", `Trusted checkpoint read failed: ${message(error)}`);
      }
    },
    async lookup(requestValue: RecoveryCheckpointCASRequest, nowMs: number) {
      try {
        const generation = session.generation;
        const request = captureRequest(requestValue);
        // Historical receipts remain useful after expiry; expiry is checked when proposing/committing.
        await validateRequest(request, nowMs, "historical");
        if (!same(request.expected.identity, pinned)) {
          throw new Error("Lookup must use the exact original scope-bound request.");
        }
        const raw = await lookup(pinned, request.requestSha256);
        requireAuthorityResult(raw, "committed");
        const result = data(raw, ["status", "acknowledgement"]);
        const ack = data(result.acknowledgement, ["durability", "requestSha256", "snapshot"]);
        const committed = snapshot(ack.snapshot);
        if (ack.durability !== "authority-commit-confirmed" || ack.requestSha256 !== request.requestSha256
          || !same(committed, nextSnapshot(request))) throw new Error("Durable receipt does not bind the exact request and successor revision.");
        await validateEvidence(committed.evidence, nowMs);
        if (generation !== session.generation) throw new Error("Authority was lost during receipt verification; reconcile with fresh reads.");
        const acknowledgement: TrustedRecoveryCheckpointAcknowledgement = Object.freeze({ [acknowledgementBrand]: true as const });
        acknowledgements.set(acknowledgement, Object.freeze({
          acknowledgement: freeze({
            durability: "authority-commit-confirmed" as const, requestSha256: request.requestSha256, snapshot: committed,
          }),
          atMs: nowMs, session, generation: session.generation,
        }));
        return Object.freeze({ status: "acknowledged" as const, ...SAFETY, acknowledgement });
      } catch (error) {
        session.generation = {};
        return refused("receipt-refused", `Checkpoint receipt lookup failed: ${message(error)}`);
      }
    },
  });
}

export async function proposeRecoveryCheckpointAdvance(
  observation: unknown, candidate: RecoveryCheckpointEvidence, nowMs: number,
) {
  try {
    const trusted = isObject(observation) ? observations.get(observation) : undefined;
    if (!trusted || !isCurrentObservation(trusted)) {
      return refused("trusted-observation-required", "Copied, missing or invalidated observations cannot establish authority.");
    }
    requireClock(nowMs);
    if (nowMs < trusted.atMs) throw new Error("Proposal clock precedes authority observation.");
    const next = evidence(candidate);
    const expected = trusted.snapshot;
    if (expected.revision === Number.MAX_SAFE_INTEGER) throw new Error("Authority revision is exhausted; never wrap or reset.");
    const before = await validateEvidence(expected.evidence, nowMs);
    const after = await validateEvidence(next, nowMs);
    requireExtension(before, after, nowMs, "advance");
    const body: Omit<RecoveryCheckpointCASRequest, "requestSha256"> = {
      version: RECOVERY_CHECKPOINT_COORDINATION_VERSION, expected, next,
    };
    const request = freeze({ ...body, requestSha256: await requestHash(body) });
    if (!isCurrentObservation(trusted)) throw new Error("Authority was lost or advanced while proposing; discard this proposal.");
    return Object.freeze({
      status: "proposed" as const, ...SAFETY, request, submitted: false as const,
      prerequisites: RECOVERY_CHECKPOINT_EXECUTION_PREREQUISITES,
    });
  } catch (error) {
    return refused("proposal-refused", `Checkpoint advancement refused without writes: ${message(error)}`);
  }
}

// Reference state transition only, not a storage adapter or atomic operation.
export async function modelRecoveryCheckpointCompareAndSwap(
  currentValue: RecoveryCheckpointSnapshot, requestValue: RecoveryCheckpointCASRequest, nowMs: number,
) {
  try {
    const current = snapshot(currentValue);
    const request = captureRequest(requestValue);
    requireClock(nowMs);
    await validateEvidence(current.evidence, nowMs);
    const checked = await validateRequest(request, nowMs, "historical");
    if (!same(current.identity, request.expected.identity)) {
      return refused("authority-mismatch", "Authority, scope or epoch changed; automatic adoption is prohibited.");
    }
    if (same(current, nextSnapshot(request))) {
      return Object.freeze({ status: "already-modelled" as const, ...SAFETY, modelOnly: true as const, snapshot: current });
    }
    if (!same(current, request.expected)) {
      return refused("cas-conflict", "Revision or full expected checkpoint changed; do not rebase or retry automatically.");
    }
    requireExtension(checked.before, checked.after, nowMs, "advance");
    return Object.freeze({
      status: "would-advance" as const, ...SAFETY, modelOnly: true as const, snapshot: nextSnapshot(request),
    });
  } catch (error) {
    return refused("cas-model-refused", `Checkpoint CAS model refused: ${message(error)}`);
  }
}

export async function reconcileRecoveryCheckpointAttempt(
  input: Readonly<{
    request: RecoveryCheckpointCASRequest;
    currentObservation: unknown;
    durableAcknowledgement: unknown;
    localEvidence: RecoveryCheckpointEvidence;
    nowMs: number;
  }>,
) {
  try {
    const captured = data(input, ["request", "currentObservation", "durableAcknowledgement", "localEvidence", "nowMs"]);
    const request = captureRequest(captured.request);
    const local = evidence(captured.localEvidence);
    const current = isObject(captured.currentObservation) ? observations.get(captured.currentObservation) : undefined;
    const ack = isObject(captured.durableAcknowledgement) ? acknowledgements.get(captured.durableAcknowledgement) : undefined;
    const nowMs = captured.nowMs;
    requireClock(nowMs);
    if (!current || !ack || !isCurrentObservation(current) || !isCurrentProvenance(ack)) {
      return refused("reconciliation-uncertain", "Both a new trusted current read and an exact durable receipt are required; retain all evidence and fences.");
    }
    if (nowMs < current.atMs || nowMs < ack.atMs) throw new Error("Reconciliation clock moved backwards.");
    // An old receipt is not current authority, and matching local bytes cannot replace it.
    if (ack.acknowledgement.requestSha256 !== request.requestSha256
      || !same(ack.acknowledgement.snapshot, nextSnapshot(request))
      || !same(current.snapshot, ack.acknowledgement.snapshot)) {
      return refused("reconciliation-conflict", "Receipt and current authority do not agree on this exact request; no automatic repair, retry or takeover.");
    }
    await validateRequest(request, nowMs, "historical");
    await validateEvidence(local, nowMs);
    if (!same(local, request.next)) return refused("local-evidence-mismatch", "Local journal/image is behind, ahead or forked; preserve it without repair.");
    if (!isCurrentObservation(current) || !isCurrentProvenance(ack)) throw new Error("Authority was lost or advanced during reconciliation.");
    return Object.freeze({
      status: "reconciled" as const, ...SAFETY,
      disposition: "checkpoint-commit-confirmed-only" as const,
      obligation: "retain-evidence-and-fence-no-automatic-resume-or-rollback" as const,
      prerequisites: RECOVERY_CHECKPOINT_EXECUTION_PREREQUISITES,
    });
  } catch (error) {
    return refused("reconciliation-refused", `Read-only checkpoint reconciliation failed: ${message(error)}`);
  }
}
