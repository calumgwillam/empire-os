import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  EMPIRE_OS_BACKUP_STORAGE_KEYS,
  RECOVERY_SNAPSHOTS_STORAGE_KEY,
  CONVERSION_STORAGE_KEY,
  type EmpireOsBackup,
} from "./backup";
import { RESTORE_INTERRUPTION_STORAGE_KEY } from "./browser-write-fence";
import {
  assessExceptionalRestoreAuthorization,
  createExceptionalRestoreConfirmationChallenge,
  EXCEPTIONAL_RESTORE_CONFIRMATION_TTL_MS,
  type ExceptionalRestoreConfirmationChallenge,
  type ExceptionalRestoreInputs,
} from "./exceptional-recovery-authorization";
import {
  createExceptionalRecoveryEvidence,
  exportExceptionalRecoveryEvidenceFile,
} from "./exceptional-recovery-evidence";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function backupText(overrides: Partial<EmpireOsBackup["storage"]> = {}, createdAt = "2026-10-14T10:00:00.000Z"): string {
  const storage = Object.fromEntries(EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => [key, null]));
  Object.assign(storage, overrides);
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    storage,
    includedStorageKeys: [...EMPIRE_OS_BACKUP_STORAGE_KEYS],
  });
}

function source(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (key: string) => values.get(key) ?? null };
}

async function validInputs(history = "{corrupt recovery history}") {
  const currentSource = source({
    [RESTORE_INTERRUPTION_STORAGE_KEY]: "interrupted marker",
    [RECOVERY_SNAPSHOTS_STORAGE_KEY]: history,
  });
  const evidence = await createExceptionalRecoveryEvidence(currentSource, { allowInterruptedMarker: true });
  const evidenceFileContents = await exportExceptionalRecoveryEvidenceFile(evidence);
  return {
    currentSource,
    evidenceFileContents,
    input: {
      backupFileContents: backupText(),
      evidenceFileContents,
      currentSource,
      nonce: "fresh-nonce-for-test-0001",
      nowMs: 1_000,
    } satisfies ExceptionalRestoreInputs,
  };
}

async function challengeFor(input: ExceptionalRestoreInputs): Promise<ExceptionalRestoreConfirmationChallenge> {
  const result = await createExceptionalRestoreConfirmationChallenge(input);
  if ("status" in result) throw new Error(`Expected challenge, received refusal: ${result.reason}`);
  return result;
}

describe("exceptional recovery authorization preflight", () => {
  it("requires a complete validated backup, current evidence and exact operator confirmation", async () => {
    const { input, currentSource } = await validInputs();
    const before = [...currentSource.values];
    const challenge = await challengeFor(input);
    expect(Object.isFrozen(challenge)).toBe(true);
    expect(Object.isFrozen(challenge.binding)).toBe(true);
    expect(challenge.binding.backupFileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(challenge.binding.backupStorageSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(challenge.binding.evidenceFileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(challenge.binding.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(challenge.binding.currentStateSha256).toMatch(/^[a-f0-9]{64}$/);

    const assessment = await assessExceptionalRestoreAuthorization({
      ...input,
      nowMs: 1_100,
      challenge,
      confirmation: {
        nonce: challenge.nonce,
        operator: "Founder",
        confirmedAtMs: 1_050,
        text: challenge.text,
      },
    });
    expect(assessment).toMatchObject({
      status: "preflight-passed",
      restoreAuthorized: false,
      operator: "Founder",
      futureTransactionMustRecheck: true,
      recoveryState: {
        recoveryHistory: "corrupt",
        interruptionMarker: "present-value",
      },
    });
    if (assessment.status === "preflight-passed") {
      expect(Object.isFrozen(assessment)).toBe(true);
      expect(Object.isFrozen(assessment.binding)).toBe(true);
    }
    expect([...currentSource.values]).toEqual(before);
  });

  it("distinguishes absent, empty, valid and corrupt history and exact marker presence", async () => {
    const markerAbsentSource = source();
    const absentEvidence = await createExceptionalRecoveryEvidence(markerAbsentSource, { allowInterruptedMarker: true });
    const absentInput = {
      backupFileContents: backupText(),
      evidenceFileContents: await exportExceptionalRecoveryEvidenceFile(absentEvidence),
      currentSource: markerAbsentSource,
      nonce: "fresh-nonce-for-test-0002",
      nowMs: 2_000,
    };
    const absentChallenge = await challengeFor(absentInput);
    const absentAssessment = await assessExceptionalRestoreAuthorization({
      ...absentInput,
      challenge: absentChallenge,
      confirmation: {
        nonce: absentChallenge.nonce, operator: "Operator", confirmedAtMs: 2_000, text: absentChallenge.text,
      },
    });
    expect(absentAssessment).toMatchObject({
      status: "preflight-passed",
      recoveryState: { recoveryHistory: "absent", interruptionMarker: "absent" },
    });

    for (const [raw, expected] of [["", "empty"], ["[]", "valid"]] as const) {
      const { input } = await validInputs(raw);
      const challenge = await challengeFor(input);
      const result = await assessExceptionalRestoreAuthorization({
        ...input,
        challenge,
        confirmation: { nonce: challenge.nonce, operator: "Operator", confirmedAtMs: input.nowMs, text: challenge.text },
      });
      expect(result).toMatchObject({ status: "preflight-passed", recoveryState: { recoveryHistory: expected } });
    }

    const emptyMarkerSource = source({ [RESTORE_INTERRUPTION_STORAGE_KEY]: "" });
    const emptyMarkerEvidence = await createExceptionalRecoveryEvidence(emptyMarkerSource, { allowInterruptedMarker: true });
    const emptyMarkerInput = {
      backupFileContents: backupText(),
      evidenceFileContents: await exportExceptionalRecoveryEvidenceFile(emptyMarkerEvidence),
      currentSource: emptyMarkerSource,
      nonce: "fresh-nonce-for-empty-marker",
      nowMs: 2_500,
    };
    const emptyMarkerChallenge = await challengeFor(emptyMarkerInput);
    expect(await assessExceptionalRestoreAuthorization({
      ...emptyMarkerInput,
      challenge: emptyMarkerChallenge,
      confirmation: {
        nonce: emptyMarkerChallenge.nonce,
        operator: "Operator",
        confirmedAtMs: emptyMarkerInput.nowMs,
        text: emptyMarkerChallenge.text,
      },
    })).toMatchObject({ status: "preflight-passed", recoveryState: { interruptionMarker: "present-empty" } });
  });

  it("accepts valid version-1 evidence only for marker-absent state", async () => {
    const currentSource = source();
    const legacyEvidence = await createExceptionalRecoveryEvidence(currentSource);
    expect(legacyEvidence.version).toBe(1);
    const input = {
      backupFileContents: backupText(),
      evidenceFileContents: await exportExceptionalRecoveryEvidenceFile(legacyEvidence),
      currentSource,
      nonce: "fresh-nonce-for-legacy-00001",
      nowMs: 3_000,
    };
    expect(await createExceptionalRestoreConfirmationChallenge(input))
      .not.toMatchObject({ status: "refused" });

    currentSource.values.set(RESTORE_INTERRUPTION_STORAGE_KEY, "interrupted");
    expect(await createExceptionalRestoreConfirmationChallenge(input))
      .toMatchObject({ status: "refused", reason: "evidence-invalid" });
  });

  it("rejects malformed, tampered, incomplete, extra-key and reference-inconsistent backups", async () => {
    const { input } = await validInputs();
    const incomplete = JSON.parse(input.backupFileContents);
    delete incomplete.storage[EMPIRE_OS_BACKUP_STORAGE_KEYS[0]];
    const extra = JSON.parse(input.backupFileContents);
    extra.storage.unregistered = "value";
    const inconsistent = backupText({
      [CONVERSION_STORAGE_KEY]: JSON.stringify([{ id: "action-1", targetType: "Convert to Action", relatedLeadId: "missing" }]),
    });
    const candidates = [
      ["{broken", "backup-invalid"],
      [JSON.stringify(incomplete), "backup-incomplete"],
      [JSON.stringify(extra), "backup-invalid"],
      [inconsistent, "backup-invalid"],
    ] as const;
    for (const [backupFileContents, reason] of candidates) {
      const result = await createExceptionalRestoreConfirmationChallenge({ ...input, backupFileContents });
      expect(result).toMatchObject({ status: "refused", reason });
    }
  });

  it("rejects malformed evidence, forged fingerprints and evidence missing a business store", async () => {
    const { input } = await validInputs();
    const parsed = JSON.parse(input.evidenceFileContents);
    const omittedStore = { ...parsed, stores: Object.fromEntries(Object.entries(parsed.stores).slice(1)) };
    const forged = { ...parsed, storesSha256: "0".repeat(64) };
    for (const evidenceFileContents of ["{broken", JSON.stringify(omittedStore), JSON.stringify(forged)]) {
      const result = await createExceptionalRestoreConfirmationChallenge({ ...input, evidenceFileContents });
      expect(result).toMatchObject({ status: "refused", reason: "evidence-invalid" });
    }
  });

  it("refuses stale evidence and detects changed stores, raw history and marker", async () => {
    const { input, currentSource } = await validInputs();
    const challenge = await challengeFor(input);
    currentSource.values.set(EMPIRE_OS_BACKUP_STORAGE_KEYS[0], "");
    const changedStore = await assessExceptionalRestoreAuthorization({
      ...input,
      challenge,
      confirmation: { nonce: challenge.nonce, operator: "Operator", confirmedAtMs: input.nowMs, text: challenge.text },
    });
    expect(changedStore).toMatchObject({ status: "refused", reason: "evidence-not-current" });

    currentSource.values.delete(EMPIRE_OS_BACKUP_STORAGE_KEYS[0]);
    currentSource.values.set(RECOVERY_SNAPSHOTS_STORAGE_KEY, "{different recovery history}");
    expect(await createExceptionalRestoreConfirmationChallenge(input))
      .toMatchObject({ status: "refused", reason: "evidence-not-current" });

    currentSource.values.set(RECOVERY_SNAPSHOTS_STORAGE_KEY, "{corrupt recovery history}");
    currentSource.values.set(RESTORE_INTERRUPTION_STORAGE_KEY, "different interruption marker");
    expect(await createExceptionalRestoreConfirmationChallenge(input))
      .toMatchObject({ status: "refused", reason: "evidence-not-current" });
  });

  it("binds confirmation to selected backup, selected evidence, state, nonce and challenge lifetime", async () => {
    const { input } = await validInputs();
    const challenge = await challengeFor(input);
    const confirmation = {
      nonce: challenge.nonce,
      operator: "Operator",
      confirmedAtMs: input.nowMs,
      text: challenge.text,
    };

    expect(await assessExceptionalRestoreAuthorization({
      ...input,
      backupFileContents: backupText({}, "2026-10-13T10:00:00.000Z"),
      challenge,
      confirmation,
    })).toMatchObject({ status: "refused", reason: "challenge-mismatch" });
    expect(await assessExceptionalRestoreAuthorization({
      ...input,
      evidenceFileContents: `${input.evidenceFileContents}\n`,
      challenge,
      confirmation,
    })).toMatchObject({ status: "refused", reason: "challenge-mismatch" });
    const { currentSource } = await validInputs();
    currentSource.values.set(EMPIRE_OS_BACKUP_STORAGE_KEYS[0], "new but valid source value");
    const freshEvidence = await exportExceptionalRecoveryEvidenceFile(
      await createExceptionalRecoveryEvidence(currentSource, { allowInterruptedMarker: true }),
    );
    expect(await assessExceptionalRestoreAuthorization({
      ...input,
      evidenceFileContents: freshEvidence,
      currentSource,
      challenge,
      confirmation,
    })).toMatchObject({ status: "refused", reason: "challenge-mismatch" });
    expect(await assessExceptionalRestoreAuthorization({
      ...input,
      nonce: "another-fresh-nonce-for-test",
      challenge,
      confirmation,
    })).toMatchObject({ status: "refused", reason: "challenge-mismatch" });
    expect(await assessExceptionalRestoreAuthorization({
      ...input,
      nowMs: challenge.expiresAtMs + 1,
      challenge,
      confirmation: { ...confirmation, confirmedAtMs: challenge.expiresAtMs + 1 },
    })).toMatchObject({ status: "refused", reason: "challenge-expired" });
    expect(await assessExceptionalRestoreAuthorization({
      ...input,
      challenge,
      confirmation: { ...confirmation, text: "yes" },
    })).toMatchObject({ status: "refused", reason: "confirmation-invalid" });
    expect(await assessExceptionalRestoreAuthorization({
      ...input,
      challenge,
      confirmation: true as unknown as null,
    })).toMatchObject({ status: "refused", reason: "confirmation-invalid" });
    expect(await assessExceptionalRestoreAuthorization({
      ...input,
      challenge: {
        ...challenge,
        issuedAtMs: challenge.issuedAtMs - 10_000,
        expiresAtMs: challenge.expiresAtMs - 10_000,
      },
      confirmation,
    })).toMatchObject({ status: "refused", reason: "challenge-invalid" });
    expect(EXCEPTIONAL_RESTORE_CONFIRMATION_TTL_MS).toBe(60_000);
  });

  it("rejects altered/replayed challenges and absent operator confirmation", async () => {
    const { input } = await validInputs();
    const challenge = await challengeFor(input);
    expect(await assessExceptionalRestoreAuthorization({
      ...input,
      challenge: { ...challenge, nonce: "replayed-with-other-nonce" },
      confirmation: null,
    })).toMatchObject({ status: "refused", reason: "challenge-invalid" });
    expect(await assessExceptionalRestoreAuthorization({
      ...input,
      challenge,
      confirmation: null,
    })).toMatchObject({ status: "refused", reason: "confirmation-missing" });

    const anotherChallenge = await challengeFor({ ...input, nonce: "fresh-nonce-for-replay-0002" });
    expect(await assessExceptionalRestoreAuthorization({
      ...input,
      challenge: anotherChallenge,
      confirmation: {
        nonce: challenge.nonce,
        operator: "Operator",
        confirmedAtMs: input.nowMs,
        text: challenge.text,
      },
    })).toMatchObject({ status: "refused", reason: "challenge-mismatch" });
  });

  it("fails closed on unreadable source and invalid clocks or nonces", async () => {
    const { input } = await validInputs();
    expect(await createExceptionalRestoreConfirmationChallenge({ ...input, nowMs: Number.NaN }))
      .toMatchObject({ status: "refused", reason: "invalid-clock" });
    expect(await createExceptionalRestoreConfirmationChallenge({ ...input, nonce: "short" }))
      .toMatchObject({ status: "refused", reason: "invalid-nonce" });
    expect(await createExceptionalRestoreConfirmationChallenge({
      ...input,
      currentSource: { getItem: () => { throw new Error("Storage unavailable"); } },
    })).toMatchObject({ status: "refused", reason: "source-unavailable" });
  });
});
