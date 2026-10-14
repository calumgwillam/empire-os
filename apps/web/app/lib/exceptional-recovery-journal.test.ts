import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKUP_FORMAT, BACKUP_VERSION, EMPIRE_OS_BACKUP_STORAGE_KEYS,
  RECOVERY_SNAPSHOTS_STORAGE_KEY, STORAGE_KEY, PERSON_STORAGE_KEY,
} from "./backup";
import { RESTORE_INTERRUPTION_STORAGE_KEY } from "./browser-write-fence";
import {
  assessExceptionalRestoreAuthorization, createExceptionalRestoreConfirmationChallenge,
} from "./exceptional-recovery-authorization";
import { createExceptionalRecoveryEvidence, exportExceptionalRecoveryEvidenceFile } from "./exceptional-recovery-evidence";
import { assessExceptionalRecoveryTransactionGate, createTrustedExceptionalRecoveryNonce } from "./exceptional-recovery-transaction-gate";
import {
  isOriginalExceptionalRecoveryExecutionPlan, planExceptionalRecoveryExecution,
} from "./exceptional-recovery-execution-plan";
import {
  assessRecoveryJournalReconciliation, buildRecoveryJournal, RECOVERY_JOURNAL_RAW_KEYS,
  transitionRecoveryJournal, validateRecoveryJournal,
  type RecoveryJournalResult, type RecoveryJournalTransition,
} from "./exceptional-recovery-journal";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(Date, "now").mockReturnValue(1_100);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function requireJournal(result: RecoveryJournalResult) {
  if (result.status !== "journal") throw new Error(result.message);
  return result;
}
function deepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(deepFrozen);
}
async function setup(options: { history?: string | null; marker?: string | null } = {}) {
  const currentValues: Record<string, string | null> = {
    ...Object.fromEntries(EMPIRE_OS_BACKUP_STORAGE_KEYS.map(key => [key, null])),
    [STORAGE_KEY]: "{corrupt}\ud800\u0000",
    [PERSON_STORAGE_KEY]: "",
    [RECOVERY_SNAPSHOTS_STORAGE_KEY]: options.history === undefined ? "{history}\ud801" : options.history,
    [RESTORE_INTERRUPTION_STORAGE_KEY]: options.marker === undefined ? "interrupted\ud802" : options.marker,
  };
  const source = {
    getItem: (key: string) => currentValues[key] ?? null,
    setItem: vi.fn(() => { throw new Error("No writes permitted."); }),
    removeItem: vi.fn(() => { throw new Error("No removals permitted."); }),
  };
  const evidence = await createExceptionalRecoveryEvidence(source, { allowInterruptedMarker: true });
  const evidenceFileContents = await exportExceptionalRecoveryEvidenceFile(evidence);
  const backupFileContents = JSON.stringify({
    format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: "2026-10-14T10:00:00.000Z",
    storage: Object.fromEntries(EMPIRE_OS_BACKUP_STORAGE_KEYS.map(key => [key, null])),
    includedStorageKeys: [...EMPIRE_OS_BACKUP_STORAGE_KEYS],
  });
  const nonce = createTrustedExceptionalRecoveryNonce();
  const base = { backupFileContents, evidenceFileContents, currentSource: source, nonce: nonce.value, nowMs: 1_000 };
  const challenge = await createExceptionalRestoreConfirmationChallenge(base);
  if ("status" in challenge) throw new Error(challenge.message);
  const confirmation = { nonce: nonce.value, operator: "Test operator", confirmedAtMs: 1_000, text: challenge.text };
  const priorAssessment = await assessExceptionalRestoreAuthorization({ ...base, challenge, confirmation });
  if (priorAssessment.status !== "preflight-passed") throw new Error(priorAssessment.message);
  const consumer = { consumeIfUnused: vi.fn(async () => ({ status: "consumed" as const })) };
  const transactionGate = await assessExceptionalRecoveryTransactionGate({
    ...base, nonce, nowMs: 1_100, challenge, confirmation, priorAssessment, consumer,
  });
  if (transactionGate.status !== "transaction-ready") throw new Error(transactionGate.detail);
  const planned = await planExceptionalRecoveryExecution({
    selection: { backupFileContents, evidenceFileContents }, currentValues, challenge, confirmation,
    transactionGate, expectedAttemptId: transactionGate.attemptId, nowMs: 1_200,
  });
  if (planned.status !== "planned") throw new Error(planned.message);
  const result = requireJournal(await buildRecoveryJournal(planned.plan, 1_300));
  return { result, plan: planned.plan, currentValues, source, consumer };
}
function imageReadback(result: ReturnType<typeof requireJournal>) {
  return JSON.stringify(result.journal.rollbackImage);
}
async function imageChecked(result: ReturnType<typeof requireJournal>, currentValues: Record<string, string | null>) {
  return requireJournal(await transitionRecoveryJournal(result.serialized, result.checkpoint, {
    state: "rollback-image-checked", rollbackImageReadback: imageReadback(result), currentValues,
  }, 1_400));
}
function expectedFence(result: ReturnType<typeof requireJournal>) {
  return JSON.stringify({
    format: "empire-os-recovery-journal-fence", version: 1, attemptId: result.journal.binding.attemptId,
    planSha256: result.journal.binding.planSha256, rollbackImageSha256: result.journal.rollbackImageSha256,
  });
}
function independentFingerprint(kind: string, value: unknown) {
  const raw = JSON.stringify(value);
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(raw.length));
  return createHash("sha256")
    .update(Buffer.from(`empire-os-recovery-journal-${kind}-v1\0`, "utf8"))
    .update(length).update(Buffer.from(raw, "utf16le")).digest("hex");
}
function reconciliationInput(result: ReturnType<typeof requireJournal>, currentValues: Record<string, string | null>) {
  return {
    serialized: result.serialized, checkpoint: result.checkpoint,
    currentValues, rollbackImageReadback: imageReadback(result), nowMs: 1_600,
  };
}

describe("pure recovery journal preparation and complete rollback image", () => {
  it("binds the exact authentic plan, inputs, versions and expiry with no further consumption or storage access", async () => {
    const { result, plan, source, consumer } = await setup();
    expect(isOriginalExceptionalRecoveryExecutionPlan(plan)).toBe(true);
    expect(result.journal.binding).toMatchObject({
      planVersion: plan.version, planSha256: plan.planSha256, attemptId: plan.attemptId,
      consumedConfirmationId: plan.consumedConfirmationId, challengeSha256: plan.challengeSha256,
      assessmentId: plan.assessmentId, ...plan.binding,
      plannedAtMs: 1_200, acknowledgedAtMs: 1_100, expiresAtMs: 61_000,
    });
    expect(result.executionAllowed).toBe(false);
    deepFrozen(result);
    expect(await buildRecoveryJournal(plan, 1_300)).toEqual(result);
    expect(await validateRecoveryJournal(result.serialized, result.checkpoint, 1_400)).toEqual(result);
    expect(source.setItem).not.toHaveBeenCalled();
    expect(source.removeItem).not.toHaveBeenCalled();
    expect(consumer.consumeIfUnused).toHaveBeenCalledOnce();
  });

  it("preserves all 23 raw values, null, empty, NUL and unpaired UTF-16 code units exactly", async () => {
    const { result, currentValues } = await setup();
    expect(result.journal.rollbackImage.entries.map(entry => entry.key)).toEqual(RECOVERY_JOURNAL_RAW_KEYS);
    expect(result.journal.rollbackImage.entries).toHaveLength(23);
    expect(Object.fromEntries(result.journal.rollbackImage.entries.map(entry => [entry.key, entry.rawValue]))).toEqual(currentValues);
    const roundTrip = requireJournal(await validateRecoveryJournal(result.serialized, result.checkpoint, 1_400));
    expect(roundTrip.journal.rollbackImage).toEqual(result.journal.rollbackImage);
    const bytes = imageReadback(result);
    const header = Buffer.from("empire-os-recovery-journal-rollback-image-v1\0", "utf8");
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    const expected = createHash("sha256").update(header).update(length).update(Buffer.from(bytes, "utf16le")).digest("hex");
    expect(result.journal.rollbackImageSha256).toBe(expected);
  });

  it.each([null, ""])("preserves history/marker presence %s independently", async raw => {
    const { result } = await setup({ history: raw, marker: raw });
    expect(result.journal.rollbackImage.entries.slice(-2).map(entry => entry.rawValue)).toEqual([raw, raw]);
    expect((await validateRecoveryJournal(result.serialized, result.checkpoint, 1_400)).status).toBe("journal");
  });

  it("rejects copied or serialized plans even with valid recomputable plan fingerprints", async () => {
    const { plan } = await setup();
    expect(isOriginalExceptionalRecoveryExecutionPlan({ ...plan })).toBe(false);
    expect((await buildRecoveryJournal({ ...plan }, 1_300)).status).toBe("refused");
    expect((await buildRecoveryJournal(JSON.parse(JSON.stringify(plan)), 1_300)).status).toBe("refused");
  });

  it.each([NaN, Infinity, -1, 1.5, 1_199, 61_000, 61_001])("rejects unsafe preparation clock %s", async now => {
    const { plan } = await setup();
    expect((await buildRecoveryJournal(plan, now)).status).toBe("refused");
  });

  it("returns explicit failure when integrity hashing is unavailable", async () => {
    const { result, plan } = await setup();
    vi.stubGlobal("crypto", { subtle: { digest: () => Promise.reject(new Error("hash unavailable")) } });
    expect(await buildRecoveryJournal(plan, 1_300)).toMatchObject({ status: "refused", executionAllowed: false, message: expect.stringContaining("hash unavailable") });
    expect((await validateRecoveryJournal(result.serialized, result.checkpoint, 1_400)).status).toBe("refused");
  });
});

describe("strict monotonic journal history", () => {
  it("checks the complete image before observing the exact attempt fence; never produces execution readiness", async () => {
    const { result, currentValues } = await setup();
    const checked = await imageChecked(result, currentValues);
    const fenced = requireJournal(await transitionRecoveryJournal(checked.serialized, checked.checkpoint, {
      state: "fence-observed", rollbackImageReadback: imageReadback(checked),
      currentValues: { ...currentValues, [RESTORE_INTERRUPTION_STORAGE_KEY]: expectedFence(checked) },
    }, 1_500));
    expect(fenced.journal.records.map(item => item.state)).toEqual(["prepared", "rollback-image-checked", "fence-observed"]);
    expect(fenced.executionAllowed).toBe(false);
    expect(fenced.journal.records[2].previousSha256).toBe(checked.checkpoint.headSha256);
    expect((await validateRecoveryJournal(fenced.serialized, fenced.checkpoint, 1_600)).status).toBe("journal");
    deepFrozen(fenced);
    expect((await transitionRecoveryJournal(fenced.serialized, fenced.checkpoint, {
      state: "fence-observed", rollbackImageReadback: imageReadback(fenced), currentValues,
    }, 1_600)).status).toBe("refused");
  });

  it.each(RECOVERY_JOURNAL_RAW_KEYS)("rejects stale readback at %s", async key => {
    const { result, currentValues } = await setup();
    expect((await transitionRecoveryJournal(result.serialized, result.checkpoint, {
      state: "rollback-image-checked", rollbackImageReadback: imageReadback(result),
      currentValues: { ...currentValues, [key]: `${currentValues[key] ?? ""}changed` },
    }, 1_400)).status).toBe("refused");
  });

  it("rejects skipped preparation, partial readback, missing raw values, and getter-backed snapshots", async () => {
    const { result, currentValues } = await setup();
    const transition = { state: "rollback-image-checked" as const, rollbackImageReadback: imageReadback(result), currentValues };
    expect((await transitionRecoveryJournal(result.serialized, result.checkpoint, { ...transition, state: "fence-observed" }, 1_400)).status).toBe("refused");
    expect((await transitionRecoveryJournal(result.serialized, result.checkpoint, { ...transition, rollbackImageReadback: transition.rollbackImageReadback.slice(0, -1) }, 1_400)).status).toBe("refused");
    const partial = { ...currentValues };
    delete partial[STORAGE_KEY];
    expect((await transitionRecoveryJournal(result.serialized, result.checkpoint, { ...transition, currentValues: partial }, 1_400)).status).toBe("refused");
    const getter = vi.fn(() => "invented");
    const accessor = Object.defineProperty({ ...currentValues }, STORAGE_KEY, { get: getter });
    expect((await transitionRecoveryJournal(result.serialized, result.checkpoint, { ...transition, currentValues: accessor }, 1_400)).status).toBe("refused");
    expect(getter).not.toHaveBeenCalled();
  });

  it("checks fencing against all original bytes and exact marker, not just marker presence", async () => {
    const { result, currentValues } = await setup();
    const checked = await imageChecked(result, currentValues);
    for (const marker of [null, "", currentValues[RESTORE_INTERRUPTION_STORAGE_KEY], "wrong-attempt"]) {
      expect((await transitionRecoveryJournal(checked.serialized, checked.checkpoint, {
        state: "fence-observed", rollbackImageReadback: imageReadback(checked),
        currentValues: { ...currentValues, [RESTORE_INTERRUPTION_STORAGE_KEY]: marker },
      }, 1_500)).status).toBe("refused");
    }
  });

  it("allows evidence retention after expiry but forbids renewed preparation or backward time", async () => {
    const { result, currentValues } = await setup();
    expect((await transitionRecoveryJournal(result.serialized, result.checkpoint, {
      state: "rollback-image-checked", rollbackImageReadback: imageReadback(result), currentValues,
    }, 61_000)).status).toBe("refused");
    expect((await transitionRecoveryJournal(result.serialized, result.checkpoint, {
      state: "interrupted", reason: "crash-interruption",
    }, 1_299)).status).toBe("refused");
    const interrupted = requireJournal(await transitionRecoveryJournal(result.serialized, result.checkpoint, {
      state: "interrupted", reason: "crash-interruption",
    }, 70_000));
    expect((await validateRecoveryJournal(interrupted.serialized, interrupted.checkpoint, 70_001)).status).toBe("journal");
    expect((await transitionRecoveryJournal(interrupted.serialized, interrupted.checkpoint, {
      state: "rollback-image-checked", rollbackImageReadback: imageReadback(interrupted), currentValues,
    }, 70_001)).status).toBe("refused");
  });

  it("models uncertainty, lost writer control, and terminal refusal without retry or rollback", async () => {
    const { result } = await setup();
    const interrupted = requireJournal(await transitionRecoveryJournal(result.serialized, result.checkpoint, { state: "interrupted", reason: "storage-failure" }, 1_400));
    const uncertain = requireJournal(await transitionRecoveryJournal(interrupted.serialized, interrupted.checkpoint, { state: "uncertain", reason: "writer-exclusion-lost" }, 1_500));
    const terminal = requireJournal(await transitionRecoveryJournal(uncertain.serialized, uncertain.checkpoint, { state: "refused", reason: "unknown-outcome" }, 1_600));
    for (const state of ["interrupted", "uncertain", "refused"] as const) {
      expect((await transitionRecoveryJournal(terminal.serialized, terminal.checkpoint, { state, reason: "operator-refusal" }, 1_700)).status).toBe("refused");
    }
    expect(terminal.journal.records.map(item => item.state)).toEqual(["prepared", "interrupted", "uncertain", "refused"]);
  });

  it("rejects accessor-backed failure reasons without invoking them", async () => {
    const { result } = await setup();
    const getter = vi.fn(() => "unknown-outcome");
    const transition = Object.defineProperty({
      state: "uncertain" as const, reason: "unknown-outcome" as const,
    }, "reason", { get: getter });
    expect((await transitionRecoveryJournal(result.serialized, result.checkpoint, transition, 1_400)).status).toBe("refused");
    expect(getter).not.toHaveBeenCalled();
  });

  it("snapshots raw transition inputs before asynchronous fingerprint verification", async () => {
    const { result, currentValues } = await setup();
    const values = { ...currentValues };
    const transition = { state: "rollback-image-checked" as const, rollbackImageReadback: imageReadback(result), currentValues: values };
    const pending = transitionRecoveryJournal(result.serialized, result.checkpoint, transition, 1_400);
    values[STORAGE_KEY] = "later mutation";
    transition.rollbackImageReadback = "later mutation";
    expect((await pending).status).toBe("journal");
  });
});

describe("untrusted records, replay and crash reconciliation", () => {
  it.each([
    "version", "executionAllowed", "binding", "image-byte", "partial-image", "duplicate-key",
    "sequence", "previous", "proof", "reason", "forged-success", "extra-field",
  ])("rejects journal corruption: %s", async kind => {
    const { result } = await setup();
    const value = JSON.parse(result.serialized);
    switch (kind) {
      case "version": value.version = 2; break;
      case "executionAllowed": value.executionAllowed = true; break;
      case "binding": value.binding.expiresAtMs++; break;
      case "image-byte": value.rollbackImage.entries[0].rawValue = "altered"; break;
      case "partial-image": value.rollbackImage.entries.pop(); break;
      case "duplicate-key": value.rollbackImage.entries[1].key = value.rollbackImage.entries[0].key; break;
      case "sequence": value.records[0].sequence = 1; break;
      case "previous": value.records[0].previousSha256 = "0".repeat(64); break;
      case "proof": value.records[0].proof = { complete: true }; break;
      case "reason": value.records[0].reason = "unknown"; break;
      case "forged-success": value.records[0].state = "restored"; break;
      case "extra-field": value.success = true; break;
    }
    expect((await validateRecoveryJournal(JSON.stringify(value), result.checkpoint, 1_400)).status).toBe("refused");
  });

  it("rejects truncated/partial/duplicate-field JSON, empty records and untrusted checkpoints", async () => {
    const { result } = await setup();
    for (const raw of ["", "null", "{}", result.serialized.slice(0, -1), `${result.serialized} `, result.serialized.replace('"version":1', '"version":1,"version":1')]) {
      expect((await validateRecoveryJournal(raw, result.checkpoint, 1_400)).status).toBe("refused");
    }
    const value = JSON.parse(result.serialized);
    value.records = [];
    expect((await validateRecoveryJournal(JSON.stringify(value), result.checkpoint, 1_400)).status).toBe("refused");
    expect((await validateRecoveryJournal(result.serialized, { ...result.checkpoint, headSha256: "0".repeat(64) }, 1_400)).status).toBe("refused");
  });

  it("rejects old heads, changed attempts, foreign images, and competing branches", async () => {
    const { result, currentValues } = await setup();
    const checked = await imageChecked(result, currentValues);
    expect((await validateRecoveryJournal(result.serialized, checked.checkpoint, 1_500)).status).toBe("refused");
    expect((await validateRecoveryJournal(checked.serialized, result.checkpoint, 1_500)).status).toBe("refused");
    for (const field of ["attemptId", "planSha256", "bindingSha256", "rollbackImageSha256"] as const) {
      expect((await validateRecoveryJournal(result.serialized, { ...result.checkpoint, [field]: "0".repeat(64) }, 1_500)).status).toBe("refused");
    }
    const branch = requireJournal(await transitionRecoveryJournal(result.serialized, result.checkpoint, { state: "uncertain", reason: "unknown-outcome" }, 1_400));
    expect((await validateRecoveryJournal(branch.serialized, checked.checkpoint, 1_500)).status).toBe("refused");
  });

  it("rejects rehashed impossible history even when supplied its new head checkpoint", async () => {
    const { result } = await setup();
    for (const change of ["success", "skip", "expired", "backward", "proof", "reason"] as const) {
      const value = JSON.parse(result.serialized);
      const item = value.records[0];
      if (change === "success") item.state = "restored";
      if (change === "skip") item.state = "fence-observed";
      if (change === "expired") item.atMs = 61_000;
      if (change === "backward") item.atMs = 1_199;
      if (change === "proof") item.proof = { imageSha256: value.rollbackImageSha256, stateSha256: value.binding.currentStateSha256, marker: null };
      if (change === "reason") item.reason = "operator-refusal";
      const { recordSha256: discarded, ...body } = item;
      expect(discarded).toBe(result.checkpoint.headSha256);
      item.recordSha256 = independentFingerprint("record", [value.bindingSha256, value.rollbackImageSha256, body]);
      expect((await validateRecoveryJournal(JSON.stringify(value), {
        ...result.checkpoint, headSha256: item.recordSha256,
      }, 70_000)).status).toBe("refused");
    }
  });

  it("rejects a rehashed rollback image that no longer matches the planned evidence", async () => {
    const { result } = await setup();
    const value = JSON.parse(result.serialized);
    value.rollbackImage.entries[0].rawValue = "modified\ud800";
    value.rollbackImageSha256 = independentFingerprint("rollback-image", value.rollbackImage);
    const { recordSha256: discarded, ...body } = value.records[0];
    expect(discarded).toBe(result.checkpoint.headSha256);
    value.records[0].recordSha256 = independentFingerprint("record", [value.bindingSha256, value.rollbackImageSha256, body]);
    expect(await validateRecoveryJournal(JSON.stringify(value), {
      ...result.checkpoint, rollbackImageSha256: value.rollbackImageSha256, headSha256: value.records[0].recordSha256,
    }, 1_400)).toMatchObject({ status: "refused", message: expect.stringContaining("planned source state") });
  });

  it("captures checkpoints before hashing and reports transition fingerprint failures explicitly", async () => {
    const { result, currentValues } = await setup();
    const checkpoint = { ...result.checkpoint };
    const validating = validateRecoveryJournal(result.serialized, checkpoint, 1_400);
    checkpoint.headSha256 = "0".repeat(64);
    expect((await validating).status).toBe("journal");
    vi.stubGlobal("crypto", { subtle: { digest: () => Promise.reject(new Error("readback hash failed")) } });
    expect(await transitionRecoveryJournal(result.serialized, result.checkpoint, {
      state: "rollback-image-checked", rollbackImageReadback: imageReadback(result), currentValues,
    }, 1_400)).toMatchObject({ status: "refused", message: expect.stringContaining("readback hash failed") });
  });

  it("never infers success, automatic resume, rollback authority or marker clearance from unchanged state", async () => {
    const { result, currentValues } = await setup();
    const assessment = await assessRecoveryJournalReconciliation(reconciliationInput(result, currentValues));
    expect(assessment).toMatchObject({
      status: "assessed", changedBusinessKeys: [], historyMatches: true, markerState: "original",
      executionAllowed: false, resumeAllowed: false, rollbackAllowed: false, clearMarkerAllowed: false,
      disposition: "before-image-observed-not-proof-of-no-writes",
    });
    deepFrozen(assessment);
  });

  it("reports mixed business bytes, altered history and an unattributed marker without overwriting them", async () => {
    const { result, currentValues } = await setup();
    const observed = { ...currentValues, [STORAGE_KEY]: "[]", [RECOVERY_SNAPSHOTS_STORAGE_KEY]: "", [RESTORE_INTERRUPTION_STORAGE_KEY]: "" };
    const before = JSON.stringify(observed);
    expect(await assessRecoveryJournalReconciliation(reconciliationInput(result, observed))).toMatchObject({
      status: "assessed", changedBusinessKeys: [STORAGE_KEY], historyMatches: false, markerState: "unexpected",
      disposition: "interruption-or-concurrency-requires-investigation", rollbackAllowed: false,
    });
    expect(JSON.stringify(observed)).toBe(before);
  });

  it("recognizes only the exact bound attempt fence and retains expired rollback obligations", async () => {
    const { result, currentValues } = await setup();
    const interrupted = requireJournal(await transitionRecoveryJournal(result.serialized, result.checkpoint, { state: "interrupted", reason: "crash-interruption" }, 1_400));
    expect(await assessRecoveryJournalReconciliation({
      ...reconciliationInput(interrupted, { ...currentValues, [RESTORE_INTERRUPTION_STORAGE_KEY]: expectedFence(interrupted) }),
      nowMs: 70_000,
    })).toMatchObject({
      status: "assessed", journalState: "interrupted", expired: true, markerState: "attempt-fence",
      obligation: "retain-evidence-and-fence-no-automatic-resume-or-rollback",
    });
  });

  it("blocks missing/partial images, uncertain clock, missing current values and replay during reconciliation", async () => {
    const { result, currentValues } = await setup();
    const input = reconciliationInput(result, currentValues);
    const checked = await imageChecked(result, currentValues);
    for (const override of [
      { rollbackImageReadback: null }, { rollbackImageReadback: "{}" }, { serialized: "" },
      { nowMs: NaN }, { nowMs: 1_299 }, { currentValues: {} }, { checkpoint: checked.checkpoint },
    ]) {
      expect(await assessRecoveryJournalReconciliation({ ...input, ...override })).toMatchObject({
        status: "blocked", executionAllowed: false, resumeAllowed: false, rollbackAllowed: false, clearMarkerAllowed: false,
      });
    }
  });

  it("rejects arbitrary unsupported transition shapes at the runtime boundary", async () => {
    const { result } = await setup();
    const malformed: unknown[] = [
      { state: "restored" }, { state: "uncertain", reason: "invented" },
      { state: "prepared", reason: "operator-refusal" },
      { state: "refused", reason: "operator-refusal", executionAllowed: true },
    ];
    for (const value of malformed) {
      // Deliberately exercise the untyped JSON caller boundary.
      expect((await transitionRecoveryJournal(result.serialized, result.checkpoint, value as RecoveryJournalTransition, 1_400)).status).toBe("refused");
    }
  });
});
