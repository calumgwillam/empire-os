import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKUP_FORMAT, BACKUP_VERSION, EMPIRE_OS_BACKUP_STORAGE_KEYS, RECOVERY_SNAPSHOTS_STORAGE_KEY,
} from "./backup";
import { RESTORE_INTERRUPTION_STORAGE_KEY } from "./browser-write-fence";
import {
  assessExceptionalRestoreAuthorization, createExceptionalRestoreConfirmationChallenge,
} from "./exceptional-recovery-authorization";
import { createExceptionalRecoveryEvidence, exportExceptionalRecoveryEvidenceFile } from "./exceptional-recovery-evidence";
import { planExceptionalRecoveryExecution } from "./exceptional-recovery-execution-plan";
import { exceptionalRecoveryFingerprint } from "./exceptional-recovery-fingerprint";
import {
  assessExceptionalRecoveryTransactionGate, createTrustedExceptionalRecoveryNonce,
} from "./exceptional-recovery-transaction-gate";
import {
  buildRecoveryJournal, transitionRecoveryJournal, type RecoveryJournalResult,
} from "./exceptional-recovery-journal";
import {
  createRecoveryCheckpointAuthorityReader, modelRecoveryCheckpointCompareAndSwap,
  proposeRecoveryCheckpointAdvance, reconcileRecoveryCheckpointAttempt,
  RECOVERY_CHECKPOINT_EXECUTION_PREREQUISITES,
  type RecoveryCheckpointCASRequest, type RecoveryCheckpointEvidence, type RecoveryCheckpointIdentity,
  type RecoveryCheckpointLookupResult, type RecoveryCheckpointReadResult,
  type RecoveryCheckpointSnapshot, type TrustedRecoveryCheckpointAuthority,
} from "./exceptional-recovery-checkpoint-coordination";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(Date, "now").mockReturnValue(1_100);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const IDENTITY: RecoveryCheckpointIdentity = Object.freeze({
  authorityId: "a".repeat(64), datasetId: "11111111-1111-4111-8111-111111111111", epoch: "b".repeat(64),
});
let fixtureOrdinal = 0;
function journal(result: RecoveryJournalResult) {
  if (result.status !== "journal") throw new Error(result.message);
  return result;
}
function evidence(result: ReturnType<typeof journal>): RecoveryCheckpointEvidence {
  return {
    serializedJournal: result.serialized, rollbackImageReadback: JSON.stringify(result.journal.rollbackImage),
    checkpoint: result.checkpoint,
  };
}
function deepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(deepFrozen);
}
function inert(value: unknown): void {
  expect(value).toMatchObject({
    executionAllowed: false, resumeAllowed: false, rollbackAllowed: false, clearMarkerAllowed: false,
  });
}
async function fixture() {
  fixtureOrdinal += 1;
  const ordinal = fixtureOrdinal;
  const values: Record<string, string | null> = {
    ...Object.fromEntries(EMPIRE_OS_BACKUP_STORAGE_KEYS.map(key => [key, null])),
    [EMPIRE_OS_BACKUP_STORAGE_KEYS[0]]: "{corrupt}\ud800\u0000",
    [RECOVERY_SNAPSHOTS_STORAGE_KEY]: "",
    [RESTORE_INTERRUPTION_STORAGE_KEY]: "original-interruption\ud801",
  };
  const source = {
    getItem: (key: string) => values[key] ?? null,
    setItem: vi.fn(() => { throw new Error("Business writes are prohibited."); }),
    removeItem: vi.fn(() => { throw new Error("Deletions are prohibited."); }),
  };
  const external = await createExceptionalRecoveryEvidence(source, { allowInterruptedMarker: true });
  const evidenceFileContents = await exportExceptionalRecoveryEvidenceFile(external);
  const backupFileContents = JSON.stringify({
    format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: "2026-10-14T10:00:00.000Z",
    storage: Object.fromEntries(EMPIRE_OS_BACKUP_STORAGE_KEYS.map(key => [key, null])),
    includedStorageKeys: [...EMPIRE_OS_BACKUP_STORAGE_KEYS],
  });
  const nonce = createTrustedExceptionalRecoveryNonce({
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      if (array === null) throw new Error("A nonce buffer is required.");
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      bytes.forEach((_, index) => { bytes[index] = (index * 7 + ordinal) % 256; });
      new DataView(array.buffer, array.byteOffset, array.byteLength).setUint32(0, ordinal);
      return array;
    },
  });
  const base = { backupFileContents, evidenceFileContents, currentSource: source, nonce: nonce.value, nowMs: 1_000 };
  const challenge = await createExceptionalRestoreConfirmationChallenge(base);
  if ("status" in challenge) throw new Error(challenge.message);
  const confirmation = { nonce: nonce.value, operator: "Test operator", confirmedAtMs: 1_000, text: challenge.text };
  const priorAssessment = await assessExceptionalRestoreAuthorization({ ...base, challenge, confirmation });
  if (priorAssessment.status !== "preflight-passed") throw new Error(priorAssessment.message);
  const consumer = { consumeIfUnused: vi.fn(async () => ({ status: "consumed" as const })) };
  const gate = await assessExceptionalRecoveryTransactionGate({
    ...base, nonce, nowMs: 1_100, challenge, confirmation, priorAssessment, consumer,
  });
  if (gate.status !== "transaction-ready") throw new Error(gate.detail);
  const planned = await planExceptionalRecoveryExecution({
    selection: { backupFileContents, evidenceFileContents }, currentValues: values, challenge, confirmation,
    transactionGate: gate, expectedAttemptId: gate.attemptId, nowMs: 1_200,
  });
  if (planned.status !== "planned") throw new Error(planned.message);
  const prepared = journal(await buildRecoveryJournal(planned.plan, 1_300));
  const checked = journal(await transitionRecoveryJournal(prepared.serialized, prepared.checkpoint, {
    state: "rollback-image-checked", rollbackImageReadback: JSON.stringify(prepared.journal.rollbackImage), currentValues: values,
  }, 1_400));
  const competing = journal(await transitionRecoveryJournal(prepared.serialized, prepared.checkpoint, {
    state: "uncertain", reason: "unknown-outcome",
  }, 1_400));
  const initial: RecoveryCheckpointSnapshot = {
    identity: IDENTITY, revision: 41, lastRequestSha256: null, evidence: evidence(prepared),
  };
  return { prepared, checked, competing, initial, source, consumer };
}

// Test-only scheduled model. Installing its result simulates a commit; this is not
// a durable adapter and provides no concurrency/atomicity guarantee of its own.
function harness(initial: RecoveryCheckpointSnapshot) {
  let current = initial;
  const receipts = new Map<string, RecoveryCheckpointLookupResult>();
  const authority = {
    readCurrent: vi.fn(async (): Promise<RecoveryCheckpointReadResult> => ({
      status: "current", durability: "authority-commit-confirmed", snapshot: current,
    })),
    lookup: vi.fn(async (_identity: RecoveryCheckpointIdentity, hash: string): Promise<RecoveryCheckpointLookupResult> =>
      receipts.get(hash) ?? { status: "not-found" }),
    compareAndSwap: vi.fn<TrustedRecoveryCheckpointAuthority["compareAndSwap"]>(async () => {
      throw new Error("Production code must never submit a CAS in this phase.");
    }),
  } satisfies TrustedRecoveryCheckpointAuthority;
  const reader = createRecoveryCheckpointAuthorityReader(authority, IDENTITY);
  return {
    authority, reader, current: () => current,
    replaceForFault: (value: RecoveryCheckpointSnapshot) => { current = value; },
    async installModelOutcome(request: RecoveryCheckpointCASRequest, nowMs = 1_500) {
      const result = await modelRecoveryCheckpointCompareAndSwap(current, request, nowMs);
      if (result.status === "would-advance" || result.status === "already-modelled") {
        current = result.snapshot;
        receipts.set(request.requestSha256, {
          status: "committed", acknowledgement: {
            durability: "authority-commit-confirmed", requestSha256: request.requestSha256, snapshot: current,
          },
        });
      }
      return result;
    },
  };
}
async function observe(h: ReturnType<typeof harness>, nowMs = 1_450) {
  const result = await h.reader.read(nowMs);
  if (result.status !== "observed") throw new Error(result.message);
  inert(result);
  return result.observation;
}
async function propose(h: ReturnType<typeof harness>, next: RecoveryCheckpointEvidence, nowMs = 1_450) {
  const result = await proposeRecoveryCheckpointAdvance(await observe(h, nowMs), next, nowMs);
  if (result.status !== "proposed") throw new Error(result.message);
  inert(result);
  return result.request;
}
async function acknowledge(h: ReturnType<typeof harness>, request: RecoveryCheckpointCASRequest, nowMs = 1_600) {
  const result = await h.reader.lookup(request, nowMs);
  if (result.status !== "acknowledged") throw new Error(result.message);
  inert(result);
  return result.acknowledgement;
}
async function rehash(request: RecoveryCheckpointCASRequest): Promise<RecoveryCheckpointCASRequest> {
  const { requestSha256: discarded, ...body } = request;
  expect(discarded).toMatch(/^[a-f0-9]{64}$/);
  return {
    ...body,
    requestSha256: await exceptionalRecoveryFingerprint("empire-os-recovery-checkpoint-cas-v1", JSON.stringify(body)),
  };
}

describe("trusted checkpoint proposals remain non-executing", () => {
  it("requires injected durable observations, complete evidence and exposes no submission API", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const request = await propose(h, evidence(f.checked));
    expect(request.expected.revision).toBe(41);
    expect(request.next.checkpoint.sequence).toBe(1);
    expect(request.next.rollbackImageReadback).toBe(JSON.stringify(f.checked.journal.rollbackImage));
    deepFrozen(request);
    expect(Object.keys(h.reader)).toEqual(["read", "lookup"]);
    expect(h.authority.compareAndSwap).not.toHaveBeenCalled();
    expect(f.source.setItem).not.toHaveBeenCalled();
    expect(f.source.removeItem).not.toHaveBeenCalled();
    expect(f.consumer.consumeIfUnused).toHaveBeenCalledOnce();
    expect(RECOVERY_CHECKPOINT_EXECUTION_PREREQUISITES).toContain("independent-all-writer-exclusion-at-every-business-write-boundary");
  });

  it("cannot promote caller checkpoints, copied tokens, model results or durability labels to authority", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const observation = await observe(h);
    for (const value of [null, f.initial, f.prepared.checkpoint, { ...observation }, JSON.parse(JSON.stringify(observation))]) {
      const result = await proposeRecoveryCheckpointAdvance(value, evidence(f.checked), 1_450);
      expect(result).toMatchObject({ status: "refused", reason: "trusted-observation-required" });
      inert(result);
    }
    const request = await propose(h, evidence(f.checked));
    const modelled = await modelRecoveryCheckpointCompareAndSwap(f.initial, request, 1_500);
    expect((await proposeRecoveryCheckpointAdvance(modelled, evidence(f.checked), 1_500)).status).toBe("refused");
  });

  it.each(["partial-image", "missing-record", "foreign-image", "noncanonical", "wrong-checkpoint"] as const)(
    "refuses %s evidence before proposing", async fault => {
      const f = await fixture();
      const h = harness(f.initial);
      const other = fault === "foreign-image" ? await fixture() : f;
      const candidate = { ...evidence(f.checked) };
      if (fault === "partial-image") candidate.rollbackImageReadback = "{}";
      if (fault === "foreign-image") candidate.rollbackImageReadback = JSON.stringify(other.prepared.journal.rollbackImage);
      if (fault === "missing-record") candidate.serializedJournal = candidate.serializedJournal.slice(0, -20);
      if (fault === "noncanonical") candidate.serializedJournal += " ";
      if (fault === "wrong-checkpoint") candidate.checkpoint = f.prepared.checkpoint;
      expect((await proposeRecoveryCheckpointAdvance(await observe(h), candidate, 1_450)).status).toBe("refused");
      expect(h.authority.compareAndSwap).not.toHaveBeenCalled();
    },
  );

  it("refuses competing attempts, unchanged heads and valid multi-record skips", async () => {
    const f = await fixture();
    const foreign = await fixture();
    const h = harness(f.initial);
    const skipped = journal(await transitionRecoveryJournal(f.checked.serialized, f.checked.checkpoint, {
      state: "uncertain", reason: "writer-exclusion-lost",
    }, 1_450));
    for (const candidate of [evidence(foreign.checked), evidence(f.prepared), evidence(skipped)]) {
      expect((await proposeRecoveryCheckpointAdvance(await observe(h), candidate, 1_500)).status).toBe("refused");
    }
  });

  it("captures caller evidence before hashing and never invokes its accessors", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const observation = await observe(h);
    const candidate = { ...evidence(f.checked), checkpoint: { ...f.checked.checkpoint } };
    const pending = proposeRecoveryCheckpointAdvance(observation, candidate, 1_450);
    candidate.checkpoint.headSha256 = "0".repeat(64);
    candidate.rollbackImageReadback = "{}";
    const result = await pending;
    expect(result.status).toBe("proposed");
    if (result.status === "proposed") expect(result.request.next).toEqual(evidence(f.checked));
    const getter = vi.fn(() => f.checked.serialized);
    const accessor = Object.defineProperty(evidence(f.checked), "serializedJournal", { get: getter });
    expect((await proposeRecoveryCheckpointAdvance(observation, accessor, 1_450)).status).toBe("refused");
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("deterministic adversarial CAS schedules (pure model, not real atomicity)", () => {
  it.each([[0, 1], [1, 0]])("only the first competing branch wins schedule %j", async (first, second) => {
    const f = await fixture();
    const h = harness(f.initial);
    const observation = await observe(h);
    const proposals = await Promise.all([f.checked, f.competing].map(next =>
      proposeRecoveryCheckpointAdvance(observation, evidence(next), 1_450)));
    const requests = proposals.map(result => {
      if (result.status !== "proposed") throw new Error(result.message);
      return result.request;
    });
    expect((await h.installModelOutcome(requests[first])).status).toBe("would-advance");
    expect(await h.installModelOutcome(requests[second])).toMatchObject({ status: "refused", reason: "cas-conflict" });
    expect(h.current().revision).toBe(42);
    expect(h.current().evidence).toEqual(requests[first].next);
    expect((await h.installModelOutcome(requests[first])).status).toBe("already-modelled");
    expect(h.current().revision).toBe(42);
  });

  it("models duplicate tab submissions as one revision, not repeated advancement", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const left = await propose(h, evidence(f.checked));
    const right = await propose(h, evidence(f.checked));
    expect(left).toEqual(right);
    expect((await h.installModelOutcome(left)).status).toBe("would-advance");
    expect((await h.installModelOutcome(right)).status).toBe("already-modelled");
    expect(h.current().revision).toBe(42);
    inert(await h.installModelOutcome(right));
    expect((await h.installModelOutcome(right, 70_000)).status).toBe("already-modelled");
    expect(h.current().revision).toBe(42);
  });

  it("rejects stale revisions and ABA even when the checkpoint bytes return to the original value", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const request = await propose(h, evidence(f.checked));
    for (const revision of [40, 42, 43]) {
      const returnedToOriginal = { ...f.initial, revision };
      expect(await modelRecoveryCheckpointCompareAndSwap(returnedToOriginal, request, 1_500))
        .toMatchObject({ status: "refused", reason: "cas-conflict" });
    }
    expect((await modelRecoveryCheckpointCompareAndSwap({
      ...f.initial, lastRequestSha256: "c".repeat(64),
    }, request, 1_500)).status).toBe("refused");
  });

  it.each(["authorityId", "datasetId", "epoch"] as const)("refuses changed authority %s without adoption", async key => {
    const f = await fixture();
    const h = harness(f.initial);
    const request = await propose(h, evidence(f.checked));
    const changed = {
      ...f.initial,
      identity: { ...IDENTITY, [key]: key === "datasetId" ? "22222222-2222-4222-8222-222222222222" : "c".repeat(64) },
    };
    expect(await modelRecoveryCheckpointCompareAndSwap(changed, request, 1_500))
      .toMatchObject({ status: "refused", reason: "authority-mismatch" });
    h.replaceForFault(changed);
    expect((await h.reader.read(1_500)).status).toBe("refused");
  });

  it("refuses overflow, zero revisions, tampered requests and a rehashed foreign attempt", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const request = await propose(h, evidence(f.checked));
    for (const revision of [0, -1, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect((await modelRecoveryCheckpointCompareAndSwap({ ...f.initial, revision }, request, 1_500)).status).toBe("refused");
    }
    const exhausted = harness({ ...f.initial, revision: Number.MAX_SAFE_INTEGER });
    expect((await proposeRecoveryCheckpointAdvance(await observe(exhausted), evidence(f.checked), 1_450)).status).toBe("refused");
    expect((await modelRecoveryCheckpointCompareAndSwap(f.initial, { ...request, requestSha256: "0".repeat(64) }, 1_500)).status).toBe("refused");
    const foreign = await fixture();
    const rehashed = await rehash({ ...request, next: evidence(foreign.checked) });
    expect((await modelRecoveryCheckpointCompareAndSwap(f.initial, rehashed, 1_500)).status).toBe("refused");
  });

  it("checks expiry at actual modeled commit; permits failure evidence but never expired preparation", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const request = await propose(h, evidence(f.checked));
    expect((await modelRecoveryCheckpointCompareAndSwap(f.initial, request, 61_000)).status).toBe("refused");
    expect((await proposeRecoveryCheckpointAdvance(await observe(h, 61_000), evidence(f.checked), 61_000)).status).toBe("refused");
    const failureRequest = await propose(h, evidence(f.competing), 70_000);
    expect((await modelRecoveryCheckpointCompareAndSwap(f.initial, failureRequest, 70_000)).status).toBe("would-advance");
  });

  it("does not freeze or mutate caller-owned authority state and snapshots all model inputs", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const request = await propose(h, evidence(f.checked));
    expect(Object.isFrozen(f.initial)).toBe(false);
    const mutable = { ...f.initial, evidence: { ...f.initial.evidence } };
    const original = JSON.stringify(mutable);
    const pending = modelRecoveryCheckpointCompareAndSwap(mutable, request, 1_500);
    mutable.evidence.rollbackImageReadback = "changed after capture";
    const result = await pending;
    expect(result.status).toBe("would-advance");
    expect(JSON.stringify(f.initial)).toBe(original);
    deepFrozen(result);
  });
});

describe("authority failure and crash reconciliation", () => {
  it.each(["missing", "unavailable", "authority-lost", "uncertain"] as const)(
    "fails closed and invalidates old observations on %s", async status => {
      const f = await fixture();
      const h = harness(f.initial);
      const observation = await observe(h);
      h.authority.readCurrent.mockResolvedValueOnce({ status, message: "Injected authority failure." });
      expect(await h.reader.read(1_500)).toMatchObject({ status: "refused", message: expect.stringContaining(status) });
      expect((await proposeRecoveryCheckpointAdvance(observation, evidence(f.checked), 1_500)).status).toBe("refused");
      expect(h.authority.compareAndSwap).not.toHaveBeenCalled();
      expect((await proposeRecoveryCheckpointAdvance(await observe(h, 1_550), evidence(f.checked), 1_550)).status).toBe("proposed");
    },
  );

  it("rejects partial trusted evidence, accessor-backed status and hash failures", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    h.replaceForFault({ ...f.initial, evidence: { ...f.initial.evidence, rollbackImageReadback: "{}" } });
    expect((await h.reader.read(1_450)).status).toBe("refused");
    const getter = vi.fn(() => "current");
    h.authority.readCurrent.mockResolvedValueOnce(Object.defineProperty({
      status: "current" as const, durability: "authority-commit-confirmed" as const, snapshot: f.initial,
    }, "status", { get: getter }));
    expect((await h.reader.read(1_500)).status).toBe("refused");
    expect(getter).not.toHaveBeenCalled();
    h.replaceForFault(f.initial);
    const observation = await observe(h, 1_550);
    vi.stubGlobal("crypto", { subtle: { digest: () => Promise.reject(new Error("hash unavailable")) } });
    expect(await proposeRecoveryCheckpointAdvance(observation, evidence(f.checked), 1_550))
      .toMatchObject({ status: "refused", message: expect.stringContaining("hash unavailable") });
  });

  it("rejects regression and same-revision branch replacement across reads", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const request = await propose(h, evidence(f.checked));
    await h.installModelOutcome(request);
    await observe(h, 1_550);
    h.replaceForFault(f.initial);
    expect((await h.reader.read(1_600)).status).toBe("refused");
    h.replaceForFault({ ...h.current(), revision: 42, evidence: evidence(f.competing) });
    expect((await h.reader.read(1_650)).status).toBe("refused");
  });

  it("refuses higher-revision takeover, same-attempt forks and impossible revision jumps", async () => {
    const f = await fixture();
    const foreign = await fixture();
    for (const changed of [
      { ...f.initial, revision: 42, evidence: evidence(foreign.checked) },
      { ...f.initial, revision: 43, evidence: evidence(f.checked) },
    ]) {
      const h = harness(f.initial);
      await observe(h);
      h.replaceForFault(changed);
      expect((await h.reader.read(1_500)).status).toBe("refused");
    }
    const h = harness(f.initial);
    const request = await propose(h, evidence(f.checked));
    await h.installModelOutcome(request);
    await observe(h, 1_550);
    const fork = journal(await transitionRecoveryJournal(f.competing.serialized, f.competing.checkpoint, {
      state: "refused", reason: "operator-refusal",
    }, 1_600));
    h.replaceForFault({ ...h.current(), revision: 43, evidence: evidence(fork) });
    expect((await h.reader.read(1_650)).status).toBe("refused");
  });

  it("reconciles a lost acknowledgement only through exact durable lookup plus a fresh current read", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const request = await propose(h, evidence(f.checked));
    const before = JSON.stringify(f.source);
    await h.installModelOutcome(request);
    const acknowledgement = await acknowledge(h, request);
    const current = await observe(h, 1_650);
    const result = await reconcileRecoveryCheckpointAttempt({
      request, currentObservation: current, durableAcknowledgement: acknowledgement, localEvidence: evidence(f.checked), nowMs: 70_000,
    });
    expect(result).toMatchObject({ status: "reconciled", disposition: "checkpoint-commit-confirmed-only" });
    inert(result);
    deepFrozen(result);
    expect(JSON.stringify(f.source)).toBe(before);
    expect(f.source.setItem).not.toHaveBeenCalled();
    expect(f.source.removeItem).not.toHaveBeenCalled();
    expect(h.authority.compareAndSwap).not.toHaveBeenCalled();
  });

  it("never treats no receipt, caller assertions or matching current bytes as proof of commit", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const request = await propose(h, evidence(f.checked));
    expect((await h.reader.lookup(request, 1_500)).status).toBe("refused");
    await h.installModelOutcome(request);
    const current = await observe(h, 1_550);
    for (const supplied of [null, h.current(), {
      durability: "authority-commit-confirmed", requestSha256: request.requestSha256, snapshot: h.current(),
    }]) {
      expect((await reconcileRecoveryCheckpointAttempt({
        request, currentObservation: current, durableAcknowledgement: supplied, localEvidence: evidence(f.checked), nowMs: 1_600,
      })).status).toBe("refused");
    }
  });

  it("refuses every interrupted update window without repairing local or authoritative bytes", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const request = await propose(h, evidence(f.checked));
    // Local image/journal advanced, but authority commit never happened.
    expect((await reconcileRecoveryCheckpointAttempt({
      request, currentObservation: await observe(h), durableAcknowledgement: null, localEvidence: evidence(f.checked), nowMs: 1_500,
    })).status).toBe("refused");
    await h.installModelOutcome(request);
    const ack = await acknowledge(h, request);
    const current = await observe(h, 1_650);
    // Authority committed but local journal is old, forked, or its image write was partial.
    for (const local of [evidence(f.prepared), evidence(f.competing), { ...evidence(f.checked), rollbackImageReadback: "{}" }]) {
      const result = await reconcileRecoveryCheckpointAttempt({
        request, currentObservation: current, durableAcknowledgement: ack, localEvidence: local, nowMs: 1_700,
      });
      expect(result.status).toBe("refused");
      inert(result);
    }
    expect(h.current().evidence).toEqual(evidence(f.checked));
    expect(f.source.setItem).not.toHaveBeenCalled();
    expect(f.source.removeItem).not.toHaveBeenCalled();
  });

  it("rejects copied acknowledgements, receipts for another request and old receipts after further advancement", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const request = await propose(h, evidence(f.checked));
    await h.installModelOutcome(request);
    const ack = await acknowledge(h, request);
    const current = await observe(h, 1_650);
    expect((await reconcileRecoveryCheckpointAttempt({
      request, currentObservation: current, durableAcknowledgement: { ...ack }, localEvidence: evidence(f.checked), nowMs: 1_700,
    })).status).toBe("refused");
    const later = journal(await transitionRecoveryJournal(f.checked.serialized, f.checked.checkpoint, {
      state: "uncertain", reason: "crash-interruption",
    }, 1_700));
    const nextRequest = await propose(h, evidence(later), 1_750);
    await h.installModelOutcome(nextRequest, 1_800);
    const newerCurrent = await observe(h, 1_850);
    expect((await reconcileRecoveryCheckpointAttempt({
      request, currentObservation: current, durableAcknowledgement: ack, localEvidence: evidence(f.checked), nowMs: 1_900,
    })).status).toBe("refused");
    expect((await reconcileRecoveryCheckpointAttempt({
      request, currentObservation: newerCurrent, durableAcknowledgement: ack, localEvidence: evidence(f.checked), nowMs: 1_900,
    })).status).toBe("refused");
    expect((await reconcileRecoveryCheckpointAttempt({
      request: nextRequest, currentObservation: newerCurrent, durableAcknowledgement: ack, localEvidence: evidence(later), nowMs: 1_900,
    })).status).toBe("refused");
  });

  it("rejects lookup receipt substitution and invalidates tokens when receipt lookup becomes uncertain", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const request = await propose(h, evidence(f.checked));
    await h.installModelOutcome(request);
    const ack = await acknowledge(h, request);
    const current = await observe(h, 1_650);
    h.authority.lookup.mockResolvedValueOnce({
      status: "committed", acknowledgement: {
        durability: "authority-commit-confirmed", requestSha256: request.requestSha256,
        snapshot: { ...h.current(), revision: 99 },
      },
    });
    expect((await h.reader.lookup(request, 1_700)).status).toBe("refused");
    expect((await reconcileRecoveryCheckpointAttempt({
      request, currentObservation: current, durableAcknowledgement: ack, localEvidence: evidence(f.checked), nowMs: 1_750,
    })).status).toBe("refused");
    h.authority.lookup.mockRejectedValueOnce(new Error("Commit acknowledgement lost."));
    expect(await h.reader.lookup(request, 1_800))
      .toMatchObject({ status: "refused", message: expect.stringContaining("Commit acknowledgement lost") });
  });

  it("refuses backward and invalid clocks without using timeouts as permission to take over", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const observation = await observe(h);
    for (const nowMs of [1_449, -1, NaN, Infinity]) {
      expect((await proposeRecoveryCheckpointAdvance(observation, evidence(f.checked), nowMs)).status).toBe("refused");
    }
    h.authority.readCurrent.mockRejectedValueOnce(new Error("Read timed out."));
    expect((await h.reader.read(70_000)).status).toBe("refused");
    expect(h.authority.compareAndSwap).not.toHaveBeenCalled();
  });

  it("rejects an in-flight read completed after another read reports loss of authority", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    let release: ((result: RecoveryCheckpointReadResult) => void) | undefined;
    h.authority.readCurrent.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = h.reader.read(1_450);
    h.authority.readCurrent.mockResolvedValueOnce({ status: "authority-lost", message: "Authority revoked." });
    expect((await h.reader.read(1_500)).status).toBe("refused");
    if (!release) throw new Error("Scheduled read was not started.");
    release({ status: "current", durability: "authority-commit-confirmed", snapshot: f.initial });
    expect(await pending).toMatchObject({ status: "refused", message: expect.stringContaining("lost during this read") });
  });

  it("invalidates a proposal if authority disappears during asynchronous evidence verification", async () => {
    const f = await fixture();
    const h = harness(f.initial);
    const observation = await observe(h);
    const digest = webcrypto.subtle.digest.bind(webcrypto.subtle);
    let release: (() => void) | undefined;
    let first = true;
    vi.stubGlobal("crypto", {
      subtle: {
        digest(algorithm: AlgorithmIdentifier, bytes: BufferSource) {
          if (!first) return digest(algorithm, bytes);
          first = false;
          return new Promise<ArrayBuffer>((resolve, reject) => {
            release = () => { digest(algorithm, bytes).then(resolve, reject); };
          });
        },
      },
    });
    const pending = proposeRecoveryCheckpointAdvance(observation, evidence(f.checked), 1_450);
    h.authority.readCurrent.mockResolvedValueOnce({ status: "uncertain", message: "Read outcome unknown." });
    expect((await h.reader.read(1_500)).status).toBe("refused");
    if (!release) throw new Error("Scheduled fingerprint was not started.");
    release();
    expect(await pending).toMatchObject({ status: "refused", message: expect.stringContaining("Authority was lost") });
  });
});
