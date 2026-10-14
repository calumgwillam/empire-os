import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKUP_FORMAT, BACKUP_VERSION, EMPIRE_OS_BACKUP_STORAGE_KEYS,
  RECOVERY_SNAPSHOTS_STORAGE_KEY, STORAGE_KEY, PERSON_STORAGE_KEY, CONVERSION_STORAGE_KEY,
} from "./backup";
import { RESTORE_INTERRUPTION_STORAGE_KEY } from "./browser-write-fence";
import {
  assessExceptionalRestoreAuthorization, createExceptionalRestoreConfirmationChallenge,
} from "./exceptional-recovery-authorization";
import {
  createExceptionalRecoveryEvidence, exportExceptionalRecoveryEvidenceFile,
} from "./exceptional-recovery-evidence";
import {
  assessExceptionalRecoveryTransactionGate, createTrustedExceptionalRecoveryNonce,
  exceptionalRecoveryPlanningReceipt,
} from "./exceptional-recovery-transaction-gate";
import {
  planExceptionalRecoveryExecution, type ExceptionalRecoveryExecutionPlanInput,
} from "./exceptional-recovery-execution-plan";
import { exceptionalRecoveryFingerprint } from "./exceptional-recovery-fingerprint";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(Date, "now").mockReturnValue(1_100);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function backup(overrides: Record<string, string | null> = {}) {
  return JSON.stringify({
    format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: "2026-10-14T10:00:00.000Z",
    storage: { ...Object.fromEntries(EMPIRE_OS_BACKUP_STORAGE_KEYS.map(key => [key, null])), [STORAGE_KEY]: "[]", ...overrides },
    includedStorageKeys: [...EMPIRE_OS_BACKUP_STORAGE_KEYS],
  });
}

async function setup(options: {
  history?: string | null; marker?: string | null; legacyEvidence?: boolean;
  backupFileContents?: string;
} = {}) {
  const currentValues: Record<string, string | null> = {
    ...Object.fromEntries(EMPIRE_OS_BACKUP_STORAGE_KEYS.map(key => [key, null])),
    [STORAGE_KEY]: "{corrupt business bytes}\ud800",
    [PERSON_STORAGE_KEY]: "[]",
    [RECOVERY_SNAPSHOTS_STORAGE_KEY]: options.history === undefined ? "{corrupt history}\ud801" : options.history,
    [RESTORE_INTERRUPTION_STORAGE_KEY]: options.marker === undefined ? "interrupted\ud802" : options.marker,
  };
  const source = {
    getItem: (key: string) => currentValues[key] ?? null,
    setItem: vi.fn(() => { throw new Error("Planning must never write."); }),
    removeItem: vi.fn(() => { throw new Error("Planning must never remove."); }),
  };
  const evidence = await createExceptionalRecoveryEvidence(source, { allowInterruptedMarker: !options.legacyEvidence });
  const evidenceFileContents = await exportExceptionalRecoveryEvidenceFile(evidence);
  const nonce = createTrustedExceptionalRecoveryNonce();
  const selected = { backupFileContents: options.backupFileContents ?? backup(), evidenceFileContents };
  const base = { ...selected, currentSource: source, nonce: nonce.value, nowMs: 1_000 };
  const challenge = await createExceptionalRestoreConfirmationChallenge(base);
  if ("status" in challenge) throw new Error(challenge.message);
  const confirmation = { nonce: nonce.value, operator: "Test operator", confirmedAtMs: 1_000, text: challenge.text };
  const priorAssessment = await assessExceptionalRestoreAuthorization({ ...base, challenge, confirmation });
  if (priorAssessment.status !== "preflight-passed") throw new Error(priorAssessment.message);
  const consumer = { consumeIfUnused: vi.fn(async () => ({ status: "consumed" as const })) };
  const gateInput = { ...base, nonce, nowMs: 1_100, challenge, confirmation, priorAssessment, consumer };
  const transactionGate = await assessExceptionalRecoveryTransactionGate(gateInput);
  if (transactionGate.status !== "transaction-ready") throw new Error(transactionGate.detail);
  const input: ExceptionalRecoveryExecutionPlanInput = {
    selection: selected, currentValues, challenge, confirmation, transactionGate,
    expectedAttemptId: transactionGate.attemptId, nowMs: 1_200,
  };
  return { input, currentValues, source, gateInput, consumer, priorAssessment, evidence };
}

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

describe("exceptional recovery execution planning (no execution)", () => {
  it("produces deterministic deeply immutable output bound to all exact inputs without consuming again", async () => {
    const { input, source, consumer, evidence } = await setup();
    const before = JSON.stringify(input);
    const result = await planExceptionalRecoveryExecution(input);
    if (result.status !== "planned") throw new Error(result.message);
    const { plan } = result;
    expect(plan.executionAllowed).toBe(false);
    expect(plan.entries).toHaveLength(21);
    expect(Object.keys(plan.currentValues)).toHaveLength(23);
    expect(plan.binding).toEqual(input.transactionGate.status === "transaction-ready" ? input.transactionGate.binding : null);
    expect(plan.verification.originalHistorySha256).toBe(evidence.recoveryHistorySha256);
    expect(plan.verification.originalMarkerSha256).toBe(evidence.interruptionMarkerSha256);
    expect(plan.attemptId).toBe(input.expectedAttemptId);
    expect(plan).toMatchObject({ version: 1, acknowledgedAtMs: 1_100, plannedAtMs: 1_200, expiresAtMs: 61_000 });
    expectDeepFrozen(result);
    expect(await planExceptionalRecoveryExecution(input)).toEqual(result);
    expect(JSON.stringify(input)).toBe(before);
    expect(source.setItem).not.toHaveBeenCalled();
    expect(source.removeItem).not.toHaveBeenCalled();
    expect(consumer.consumeIfUnused).toHaveBeenCalledOnce();
    const { planSha256, ...body } = plan;
    expect(planSha256).toBe(await exceptionalRecoveryFingerprint(
      "empire-os-exceptional-recovery-execution-plan-v1", JSON.stringify(body),
    ));
  });

  it("retains exact corrupt rollback bytes and distinguishes removal, setting and unchanged values", async () => {
    const { input, currentValues } = await setup();
    const result = await planExceptionalRecoveryExecution(input);
    if (result.status !== "planned") throw new Error(result.message);
    const { plan } = result;
    expect(plan.entries.find(entry => entry.key === STORAGE_KEY)).toMatchObject({
      before: "{corrupt business bytes}\ud800", target: "[]", change: "set",
    });
    expect(plan.entries.find(entry => entry.key === PERSON_STORAGE_KEY)).toMatchObject({ before: "[]", target: null, change: "remove" });
    expect(plan.entries.find(entry => entry.key === CONVERSION_STORAGE_KEY)).toMatchObject({ before: null, target: null, change: "unchanged" });
    expect(plan.rollback.businessValues[STORAGE_KEY]).toBe(currentValues[STORAGE_KEY]);
    expect(plan.rollback.recoveryHistory).toBe(currentValues[RECOVERY_SNAPSHOTS_STORAGE_KEY]);
    expect(plan.rollback.interruptionMarker).toBe(currentValues[RESTORE_INTERRUPTION_STORAGE_KEY]);
    expect(plan.rollback).toMatchObject({
      validateAsBusinessData: false, clearMarkerAutomatically: false, restoreEveryBusinessKeyAndReadBack: true,
      resumeAfterInterruption: "never-resume-from-plan-alone",
    });
  });

  it("models pre-write safeguards, complete readback and uncertain rollback without automatic fence release", async () => {
    const { input } = await setup();
    const result = await planExceptionalRecoveryExecution(input);
    if (result.status !== "planned") throw new Error(result.message);
    expect(result.plan.stages.map(stage => stage.id)).toEqual([
      "revalidate-and-exclude-writers", "preserve-pre-restore-evidence", "establish-interruption-fence",
      "apply-selected-business-values", "verify-complete-target", "record-outcome-without-clearing-fence",
    ]);
    expect(result.plan.stages[0].requires).toContain("exclusive-cross-tab-writer-control");
    expect(result.plan.stages[1].requires).toContain("durable-pinned-raw-rollback-image");
    expect(result.plan.stages[3].onFailure).toBe("rollback-and-verify");
    expect(result.plan.stages[4].onFailure).toBe("rollback-and-verify");
    expect(result.plan.verification.businessKeys).toEqual(EMPIRE_OS_BACKUP_STORAGE_KEYS);
    expect(result.plan.risks).toContain("write-fence-check-then-write-is-not-cross-tab-mutual-exclusion");
  });

  it.each([null, "", "existing interrupted marker"])("preserves marker presence and bytes (%j)", async marker => {
    const { input } = await setup({ marker });
    const result = await planExceptionalRecoveryExecution(input);
    if (result.status !== "planned") throw new Error(result.message);
    expect(result.plan.rollback.interruptionMarker).toBe(marker);
    expect(result.plan.rollback.clearMarkerAutomatically).toBe(false);
  });

  it.each([null, "", "[]", "{invalid history}"])("preserves raw recovery history without repairing it (%j)", async history => {
    const { input } = await setup({ history });
    const result = await planExceptionalRecoveryExecution(input);
    if (result.status !== "planned") throw new Error(result.message);
    expect(result.plan.rollback.recoveryHistory).toBe(history);
  });

  it.each([...EMPIRE_OS_BACKUP_STORAGE_KEYS, RECOVERY_SNAPSHOTS_STORAGE_KEY, RESTORE_INTERRUPTION_STORAGE_KEY])(
    "rejects stale evidence after a change to %s", async key => {
      const { input } = await setup();
      const currentValues = { ...input.currentValues, [key]: input.currentValues[key] === null ? "" : `${input.currentValues[key]} ` };
      expect(await planExceptionalRecoveryExecution({ ...input, currentValues }))
        .toMatchObject({ status: "refused", reason: "evidence-not-current" });
    },
  );

  it("rejects incomplete, extra, malformed and accessor-backed raw inventories", async () => {
    const { input } = await setup();
    const missing = { ...input.currentValues };
    delete missing[STORAGE_KEY];
    const accessor = Object.defineProperty({ ...input.currentValues }, STORAGE_KEY, {
      get() { throw new Error("Accessor must not run."); }, enumerable: true,
    });
    for (const currentValues of [missing, { ...input.currentValues, extra: null }, accessor]) {
      expect(await planExceptionalRecoveryExecution({ ...input, currentValues }))
        .toMatchObject({ status: "refused", reason: "incomplete-current-state" });
    }
    const malformed = { ...input.currentValues, [STORAGE_KEY]: 7 };
    expect(await planExceptionalRecoveryExecution({ ...input, currentValues: malformed } as unknown as ExceptionalRecoveryExecutionPlanInput))
      .toMatchObject({ status: "refused", reason: "incomplete-current-state" });
  });

  it.each(["backupFileContents", "evidenceFileContents"] as const)("rejects exact selected-file byte changes (%s)", async field => {
    const { input } = await setup();
    expect(await planExceptionalRecoveryExecution({
      ...input, selection: { ...input.selection, [field]: `${input.selection[field]}\n` },
    })).toMatchObject({ status: "refused", reason: "challenge-mismatch" });
  });

  it("rejects malformed evidence, unsupported evidence versions and altered evidence fingerprints", async () => {
    const { input } = await setup();
    const evidence = JSON.parse(input.selection.evidenceFileContents);
    for (const evidenceFileContents of [
      "{broken", JSON.stringify({ ...evidence, version: 99 }),
      JSON.stringify({ ...evidence, storesSha256: "f".repeat(64) }),
    ]) {
      expect(await planExceptionalRecoveryExecution({ ...input, selection: { ...input.selection, evidenceFileContents } }))
        .toMatchObject({ status: "refused", reason: "planning-failed" });
    }
  });

  it("requires marker-aware evidence even if the earlier gate accepted legacy marker-absent evidence", async () => {
    const { input } = await setup({ legacyEvidence: true, marker: null });
    expect(await planExceptionalRecoveryExecution(input))
      .toMatchObject({ status: "refused", reason: "marker-aware-evidence-required" });
  });

  it("rejects incomplete and corrupt target backups rather than using current values as defaults", async () => {
    const { input } = await setup();
    const incomplete = JSON.parse(input.selection.backupFileContents);
    delete incomplete.storage[STORAGE_KEY];
    for (const backupFileContents of ["{broken", JSON.stringify(incomplete), backup({ [STORAGE_KEY]: "{not-an-array}" })]) {
      expect(await planExceptionalRecoveryExecution({ ...input, selection: { ...input.selection, backupFileContents } }))
        .toMatchObject({ status: "refused" });
    }
  });

  it("rejects absent selection, missing confirmation, malformed challenges and attempt IDs", async () => {
    const { input } = await setup();
    expect(await planExceptionalRecoveryExecution({ ...input, selection: null } as unknown as ExceptionalRecoveryExecutionPlanInput))
      .toMatchObject({ status: "refused", reason: "invalid-selection" });
    expect(await planExceptionalRecoveryExecution({ ...input, confirmation: null }))
      .toMatchObject({ status: "refused", reason: "confirmation-missing" });
    expect(await planExceptionalRecoveryExecution({ ...input, challenge: {} }))
      .toMatchObject({ status: "refused", reason: "attempt-mismatch" });
    expect(await planExceptionalRecoveryExecution({ ...input, expectedAttemptId: "not-an-attempt" }))
      .toMatchObject({ status: "refused", reason: "attempt-mismatch" });
  });

  it("does not normalize malformed or accessor-backed confirmation inputs into valid ones", async () => {
    const { input, gateInput } = await setup();
    const challenge = { ...gateInput.challenge, ignored: undefined };
    expect(await planExceptionalRecoveryExecution({ ...input, challenge }))
      .toMatchObject({ status: "refused", reason: "attempt-mismatch" });
    const confirmation = Object.defineProperty({ ...gateInput.confirmation }, "operator", {
      get() { throw new Error("Planner must not invoke confirmation getters."); },
    });
    expect(await planExceptionalRecoveryExecution({ ...input, confirmation }))
      .toMatchObject({ status: "refused", reason: "invalid-confirmation" });
  });

  it("rejects preflight-only, refused, fabricated and copied transaction results", async () => {
    const { input, priorAssessment } = await setup();
    const candidates = [priorAssessment, null, {}, { ...input.transactionGate },
      { status: "refused", reason: "replay-refused", detail: "already submitted" }];
    for (const transactionGate of candidates) {
      expect(await planExceptionalRecoveryExecution({ ...input, transactionGate } as unknown as ExceptionalRecoveryExecutionPlanInput))
        .toMatchObject({ status: "refused", reason: "gate-required" });
      expect(exceptionalRecoveryPlanningReceipt(transactionGate)).toBeUndefined();
    }
  });

  it("rejects another authentic attempt, modified confirmation and swapped challenge", async () => {
    const first = await setup();
    const second = await setup();
    expect(await planExceptionalRecoveryExecution({ ...first.input, expectedAttemptId: second.input.expectedAttemptId }))
      .toMatchObject({ status: "refused", reason: "attempt-mismatch" });
    expect(await planExceptionalRecoveryExecution({
      ...first.input, transactionGate: second.input.transactionGate, expectedAttemptId: second.input.expectedAttemptId,
    })).toMatchObject({ status: "refused", reason: "attempt-mismatch" });
    expect(await planExceptionalRecoveryExecution({ ...first.input, challenge: second.input.challenge }))
      .toMatchObject({ status: "refused", reason: "attempt-mismatch" });
    expect(await planExceptionalRecoveryExecution({
      ...first.input, confirmation: { ...first.gateInput.confirmation, operator: "Different operator" },
    })).toMatchObject({ status: "refused", reason: "attempt-mismatch" });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1_099, 61_000, 61_001, 1_200.5])(
    "rejects expired or invalid planning time %s", async nowMs => {
      const { input } = await setup();
      expect(await planExceptionalRecoveryExecution({ ...input, nowMs }))
        .toMatchObject({ status: "refused", reason: "invalid-or-expired-clock" });
    },
  );

  it("accepts strictly before expiry but never makes a plan usable after expiry", async () => {
    const { input } = await setup();
    expect(await planExceptionalRecoveryExecution({ ...input, nowMs: 60_999 })).toMatchObject({ status: "planned" });
    expect(await planExceptionalRecoveryExecution({ ...input, nowMs: 61_000 })).toMatchObject({ status: "refused" });
  });

  it("does not bypass gate replay protection or consume again while replanning", async () => {
    const { input, gateInput, consumer } = await setup();
    const replay = await assessExceptionalRecoveryTransactionGate(gateInput);
    expect(replay).toMatchObject({ status: "refused", reason: "replay-refused" });
    expect(await planExceptionalRecoveryExecution({ ...input, transactionGate: replay }))
      .toMatchObject({ status: "refused", reason: "gate-required" });
    expect(await planExceptionalRecoveryExecution(input)).toMatchObject({ status: "planned", executionAllowed: false });
    expect(consumer.consumeIfUnused).toHaveBeenCalledOnce();
  });

  it("captures mutable input values before asynchronous hashing and does not retain caller-owned objects", async () => {
    const { input, currentValues, gateInput } = await setup();
    const original = currentValues[STORAGE_KEY];
    const pending = planExceptionalRecoveryExecution(input);
    currentValues[STORAGE_KEY] = "changed after snapshot";
    gateInput.confirmation.operator = "changed after snapshot";
    const result = await pending;
    if (result.status !== "planned") throw new Error(result.message);
    expect(result.plan.currentValues[STORAGE_KEY]).toBe(original);
    expect(result.plan.rollback.businessValues[STORAGE_KEY]).toBe(original);
    expect(result.plan.currentValues).not.toBe(currentValues);
  });

  it("fails explicitly without writes if cryptographic verification is unavailable", async () => {
    const { input, source } = await setup();
    vi.stubGlobal("crypto", { subtle: { digest: async () => { throw new Error("Digest unavailable."); } } });
    expect(await planExceptionalRecoveryExecution(input)).toMatchObject({ status: "refused", reason: "planning-failed" });
    expect(source.setItem).not.toHaveBeenCalled();
    expect(source.removeItem).not.toHaveBeenCalled();
  });
});

describe("shared recovery fingerprint compatibility", () => {
  it.each(["", "plain", "\ud800", "\ud801", "\u0000end"])("retains domain-separated UTF-16 code-unit hashing (%j)", async value => {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(value.length));
    const expected = createHash("sha256").update(Buffer.concat([
      Buffer.from("test-domain\u0000", "utf8"), length, Buffer.from(value, "utf16le"),
    ])).digest("hex");
    expect(await exceptionalRecoveryFingerprint("test-domain", value)).toBe(expected);
    expect(await exceptionalRecoveryFingerprint("other-domain", value)).not.toBe(expected);
  });
});
