import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  EMPIRE_OS_BACKUP_STORAGE_KEYS,
  RECOVERY_SNAPSHOTS_STORAGE_KEY,
  type EmpireOsBackup,
} from "./backup";
import { RESTORE_INTERRUPTION_STORAGE_KEY } from "./browser-write-fence";
import {
  assessExceptionalRestoreAuthorization,
  createExceptionalRestoreConfirmationChallenge,
  type ExceptionalRestoreAuthorizationAssessment,
  type ExceptionalRestoreConfirmationChallenge,
} from "./exceptional-recovery-authorization";
import { createExceptionalRecoveryEvidence, exportExceptionalRecoveryEvidenceFile } from "./exceptional-recovery-evidence";
import {
  assessExceptionalRecoveryTransactionGate,
  createTrustedExceptionalRecoveryNonce,
  type ExceptionalRecoveryConsumptionRequest,
  type ExceptionalRecoveryConsumptionResult,
  type ExceptionalRecoveryTransactionGateInput,
} from "./exceptional-recovery-transaction-gate";

let freshNowMs = 1_100;
beforeEach(() => {
  freshNowMs = 1_100;
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(Date, "now").mockImplementation(() => freshNowMs);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function backupText(overrides: Partial<EmpireOsBackup["storage"]> = {}): string {
  const storage = Object.fromEntries(EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => [key, null]));
  Object.assign(storage, overrides);
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: "2026-10-14T10:00:00.000Z",
    storage,
    includedStorageKeys: [...EMPIRE_OS_BACKUP_STORAGE_KEYS],
  });
}

function source(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (key: string) => values.get(key) ?? null };
}

function atomicConsumer() {
  const consumed = new Set<string>();
  const requests: ExceptionalRecoveryConsumptionRequest[] = [];
  const consumer = {
    consumeIfUnused: async (request: ExceptionalRecoveryConsumptionRequest): Promise<ExceptionalRecoveryConsumptionResult> => {
      requests.push(request);
      const id = `${request.nonce}:${request.confirmationId}`;
      if (consumed.has(id)) return { status: "already-consumed" };
      consumed.add(id);
      return { status: "consumed" };
    },
  };
  return { consumed, requests, consumer };
}

async function setup() {
  const currentSource = source({
    [RESTORE_INTERRUPTION_STORAGE_KEY]: "interrupted",
    [RECOVERY_SNAPSHOTS_STORAGE_KEY]: "{corrupt history}",
  });
  const evidence = await createExceptionalRecoveryEvidence(currentSource, { allowInterruptedMarker: true });
  const evidenceFileContents = await exportExceptionalRecoveryEvidenceFile(evidence);
  const nonce = createTrustedExceptionalRecoveryNonce();
  const base = {
    backupFileContents: backupText(),
    evidenceFileContents,
    currentSource,
    nonce,
    nowMs: 1_000,
  };
  const phase2Challenge = await createExceptionalRestoreConfirmationChallenge({
    ...base,
    nonce: nonce.value,
  });
  if ("status" in phase2Challenge) throw new Error(`Phase 2 challenge refused: ${phase2Challenge.message}`);
  const challenge: ExceptionalRestoreConfirmationChallenge = phase2Challenge;
  const confirmation = {
    nonce: nonce.value,
    operator: "Founder",
    confirmedAtMs: 1_000,
    text: challenge.text,
  };
  const priorAssessment = await assessExceptionalRestoreAuthorization({
    ...base,
    nonce: nonce.value,
    challenge,
    confirmation,
  });
  if (priorAssessment.status !== "preflight-passed") throw new Error(`Phase 2 assessment refused: ${priorAssessment.message}`);
  const { consumer, requests } = atomicConsumer();
  const input: ExceptionalRecoveryTransactionGateInput = {
    ...base,
    challenge,
    confirmation,
    priorAssessment,
    nowMs: 1_100,
    consumer,
  };
  return { currentSource, nonce, challenge, confirmation, priorAssessment, consumer, requests, input };
}

async function stalePriorAssessment(input: ExceptionalRecoveryTransactionGateInput): Promise<ExceptionalRestoreAuthorizationAssessment> {
  const assessment = input.priorAssessment;
  if (assessment.status !== "preflight-passed") {
    throw new Error(`Cannot make a stale assessment from a refusal: ${assessment.message}`);
  }
  return Object.freeze({
    ...assessment,
    assessmentId: assessment.assessmentId === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64),
  });
}

describe("exceptional recovery transaction safety gate", () => {
  it("revalidates Phase 2 and consumes exact confirmation before returning attempt-scoped readiness", async () => {
    const { input, requests, currentSource } = await setup();
    const before = [...currentSource.values];
    const result = await assessExceptionalRecoveryTransactionGate(input);
    const challenge = input.challenge as ExceptionalRestoreConfirmationChallenge;
    expect(result).toMatchObject({
      status: "transaction-ready",
      transactionExecutionAllowed: false,
      expiresAtMs: challenge.expiresAtMs,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      nonce: input.nonce.value,
      expiresAtMs: challenge.expiresAtMs,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect([...currentSource.values]).toEqual(before);
  });

  it("refuses stale Phase 2 assessments and changed selected backup/evidence", async () => {
    const { input } = await setup();
    expect(await assessExceptionalRecoveryTransactionGate({
      ...input,
      priorAssessment: await stalePriorAssessment(input),
    })).toMatchObject({ status: "refused", reason: "changed-state" });

    expect(await assessExceptionalRecoveryTransactionGate({
      ...input,
      backupFileContents: `${input.backupFileContents}\n`,
    })).toMatchObject({ status: "refused", reason: "changed-state" });

    expect(await assessExceptionalRecoveryTransactionGate({
      ...input,
      evidenceFileContents: `${input.evidenceFileContents}\n`,
    })).toMatchObject({ status: "refused", reason: "changed-state" });
  });

  it.each([
    ["business store", (currentSource: ReturnType<typeof source>) => currentSource.values.set(EMPIRE_OS_BACKUP_STORAGE_KEYS[0], "changed")],
    ["recovery history", (currentSource: ReturnType<typeof source>) => currentSource.values.set(RECOVERY_SNAPSHOTS_STORAGE_KEY, "{changed}")],
    ["interruption marker", (currentSource: ReturnType<typeof source>) => currentSource.values.set(RESTORE_INTERRUPTION_STORAGE_KEY, "changed")],
  ] as const)("refuses transaction readiness after changed %s", async (_, mutate) => {
    const { input, currentSource, requests } = await setup();
    mutate(currentSource);
    expect(await assessExceptionalRecoveryTransactionGate(input))
      .toMatchObject({ status: "refused", reason: "changed-state" });
    expect(requests).toHaveLength(0);
  });

  it("rejects untrusted, malformed and locally reused nonces", async () => {
    const { input } = await setup();
    expect(await assessExceptionalRecoveryTransactionGate({
      ...input,
      nonce: { value: "a".repeat(64) } as unknown as typeof input.nonce,
    })).toMatchObject({ status: "refused", reason: "validation-refused" });

    const first = await assessExceptionalRecoveryTransactionGate(input);
    expect(first.status).toBe("transaction-ready");
    expect(await assessExceptionalRecoveryTransactionGate(input))
      .toMatchObject({ status: "refused", reason: "replay-refused" });
  });

  it("rejects weak or repeated values from a nonce source", () => {
    const weakSource = {
      getRandomValues: <T extends ArrayBufferView>(array: T): T => {
        new Uint8Array(array.buffer as ArrayBuffer, array.byteOffset, array.byteLength).fill(0);
        return array;
      },
    };
    expect(() => createTrustedExceptionalRecoveryNonce(weakSource as unknown as Crypto))
      .toThrow("malformed or previously issued");
  });

  it("distinguishes replay, thrown consumption failure and ambiguous consumer results", async () => {
    const replay = await setup();
    const alreadyConsumed = await assessExceptionalRecoveryTransactionGate({
      ...replay.input,
      consumer: { consumeIfUnused: async () => ({ status: "already-consumed" }) },
    });
    expect(alreadyConsumed).toMatchObject({ status: "refused", reason: "replay-refused" });

    const uncertain = await setup();
    const thrown = await assessExceptionalRecoveryTransactionGate({
      ...uncertain.input,
      consumer: { consumeIfUnused: async () => { throw new Error("Backend acknowledgement lost"); } },
    });
    expect(thrown).toMatchObject({ status: "refused", reason: "consumption-uncertain" });
    expect(await assessExceptionalRecoveryTransactionGate(uncertain.input))
      .toMatchObject({ status: "refused", reason: "replay-refused" });

    const malformed = await setup();
    expect(await assessExceptionalRecoveryTransactionGate({
      ...malformed.input,
      consumer: { consumeIfUnused: async () => ({ status: "consumed", unexpected: true }) as never },
    })).toMatchObject({ status: "refused", reason: "consumption-uncertain" });
  });

  it("refuses expired and malformed preflight inputs before consuming confirmation", async () => {
    const expired = await setup();
    const expiredChallenge = expired.challenge;
    expect(await assessExceptionalRecoveryTransactionGate({
      ...expired.input,
      nowMs: expiredChallenge.expiresAtMs + 1,
    })).toMatchObject({ status: "refused", reason: "validation-refused" });
    expect(expired.requests).toHaveLength(0);

    const malformed = await setup();
    expect(await assessExceptionalRecoveryTransactionGate({
      ...malformed.input,
      challenge: {},
    })).toMatchObject({ status: "refused", reason: "validation-refused" });
    expect(malformed.requests).toHaveLength(0);
  });

  it("refuses readiness when the consumer acknowledgement arrives at or after expiry", async () => {
    const { input, challenge } = await setup();
    const result = await assessExceptionalRecoveryTransactionGate({
      ...input,
      consumer: {
        consumeIfUnused: async () => {
          await Promise.resolve();
          freshNowMs = challenge.expiresAtMs;
          return { status: "consumed" };
        },
      },
    });
    expect(result).toMatchObject({ status: "refused", reason: "validation-refused" });
  });

  it("fails closed when the fresh completion-time clock is invalid", async () => {
    const { input } = await setup();
    const result = await assessExceptionalRecoveryTransactionGate({
      ...input,
      consumer: {
        consumeIfUnused: async () => {
          freshNowMs = Number.NaN;
          return { status: "consumed" };
        },
      },
    });
    expect(result).toMatchObject({ status: "refused", reason: "validation-refused" });
  });

  it("fails closed when the trusted clock moves backwards during acknowledgement", async () => {
    const { input } = await setup();
    const result = await assessExceptionalRecoveryTransactionGate({
      ...input,
      consumer: {
        consumeIfUnused: async () => {
          freshNowMs = input.nowMs - 1;
          return { status: "consumed" };
        },
      },
    });
    expect(result).toMatchObject({ status: "refused", reason: "validation-refused" });
  });

  it("rejects a trusted nonce that does not match the selected challenge", async () => {
    const { input, requests } = await setup();
    const differentNonce = createTrustedExceptionalRecoveryNonce();
    expect(await assessExceptionalRecoveryTransactionGate({
      ...input,
      nonce: differentNonce,
    })).toMatchObject({ status: "refused", reason: "validation-refused" });
    expect(requests).toHaveLength(0);
  });

  it("allows at most one of concurrent requests to consume the same attempt", async () => {
    const { input, requests } = await setup();
    const used = new Set<string>();
    const consumer = {
      consumeIfUnused: async (request: ExceptionalRecoveryConsumptionRequest): Promise<ExceptionalRecoveryConsumptionResult> => {
        requests.push(request);
        const key = `${request.nonce}:${request.confirmationId}`;
        if (used.has(key)) return { status: "already-consumed" };
        used.add(key);
        await Promise.resolve();
        return { status: "consumed" };
      },
    };
    const results = await Promise.all([
      assessExceptionalRecoveryTransactionGate({ ...input, consumer }),
      assessExceptionalRecoveryTransactionGate({ ...input, consumer }),
    ]);
    expect(results.filter((result) => result.status === "transaction-ready")).toHaveLength(1);
    expect(results.filter((result) => result.status === "refused" && result.reason === "replay-refused")).toHaveLength(1);
    expect(requests.length).toBeGreaterThanOrEqual(1);
    expect(requests.length).toBeLessThanOrEqual(2);
  });

  it("rejects confirmation binding changes without consuming the nonce", async () => {
    const { input, requests } = await setup();
    expect(await assessExceptionalRecoveryTransactionGate({
      ...input,
      confirmation: { ...input.confirmation!, text: "confirm something else" },
    })).toMatchObject({ status: "refused", reason: "validation-refused" });
    expect(requests).toHaveLength(0);
  });

  it.each([
    ["conflict", "conflict-refused"],
    ["expired", "validation-refused"],
    ["invalid-input", "validation-refused"],
    ["unavailable", "consumption-unavailable"],
    ["uncertain", "consumption-uncertain"],
  ] as const)("maps durable-consumer %s to %s without readiness", async (status, reason) => {
    const { input } = await setup();
    const consumer = {
      consumeIfUnused: async (): Promise<ExceptionalRecoveryConsumptionResult> => ({ status }),
    };
    expect(await assessExceptionalRecoveryTransactionGate({ ...input, consumer }))
      .toMatchObject({ status: "refused", reason });
  });
});
