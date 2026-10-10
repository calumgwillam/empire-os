import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERSION_STORAGE_KEY, EMPIRE_OS_BACKUP_STORAGE_KEYS, PROJECT_STORAGE_KEY, STORAGE_KEY } from "./backup";
import { sha256 } from "./independent-backup";
import { prepareServerWrite, prepareWriteCandidate } from "./server-write-preparation";
import { validateWriteBatch, writeBatchContent, type DatasetSnapshot, type WriteBatch } from "./server-persistence-contract";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const fence = { datasetId: "00000000-0000-4000-8000-000000000001", protocolVersion: 1 as const, generation: 1, authorityRevision: 0 };
function batch(): WriteBatch {
  const result = validateWriteBatch({ fence, idempotencyKey: "write:one", reads: [],
    writes: [{ key: STORAGE_KEY, expectedRevision: 0, rawValue: '[{"id":"capture","unknown":true}]' }] });
  if (result.status !== "valid") throw new Error(JSON.stringify(result));
  return result.value;
}
function snapshot(): DatasetSnapshot {
  return { ...fence, commitSequence: 0,
    values: EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => ({ key, rawValue: null, revision: 0 })) };
}

describe("Server write preparation unit tests (no transaction simulator)", () => {
  it("hashes exact immutable requests without persisting them", async () => {
    const result = await prepareServerWrite(batch());
    if (result.status !== "valid") throw new Error(JSON.stringify(result));
    expect(result.value.requestSha256).toBe(await sha256(writeBatchContent(batch())));
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.batch)).toBe(true);
  });
  it("reports invalid requests and missing cryptographic support without success", async () => {
    expect((await prepareServerWrite({})).status).toBe("invalid-request");
    vi.stubGlobal("crypto", undefined);
    expect(await prepareServerWrite(batch())).toMatchObject({ status: "failed", outcome: "not-submitted" });
  });
  it("builds a validated candidate without mutating its observed snapshot", () => {
    const before = snapshot();
    const serialized = JSON.stringify(before);
    const candidate = prepareWriteCandidate(batch(), before);
    if (candidate.status !== "valid") throw new Error(JSON.stringify(candidate));
    expect(candidate.value.values.find(({ key }) => key === STORAGE_KEY)).toEqual({
      key: STORAGE_KEY, rawValue: batch().writes[0].rawValue, revision: 1,
    });
    expect(candidate.value.commitSequence).toBe(1);
    expect(JSON.stringify(before)).toBe(serialized);
  });
  it("null and same-value writes still advance revisions", () => {
    const before = snapshot();
    const request: WriteBatch = { ...batch(), writes: [{ key: STORAGE_KEY, expectedRevision: 0, rawValue: null }] };
    const candidate = prepareWriteCandidate(request, before);
    if (candidate.status !== "valid") throw new Error(JSON.stringify(candidate));
    expect(candidate.value.values.find(({ key }) => key === STORAGE_KEY)).toEqual({ key: STORAGE_KEY, rawValue: null, revision: 1 });
  });
  it("rejects malformed business JSON even though it is a valid raw-string envelope", () => {
    const request: WriteBatch = { ...batch(), writes: [{ ...batch().writes[0], rawValue: "not-json" }] };
    expect(prepareWriteCandidate(request, snapshot()).status).toBe("invalid-request");
  });
  it("checks references against the complete candidate, not only changed stores", () => {
    const request: WriteBatch = { ...batch(), writes: [{
      key: CONVERSION_STORAGE_KEY, expectedRevision: 0,
      rawValue: '[{"id":"action","targetType":"Convert to Action","deliveryLeadId":"missing"}]',
    }] };
    expect(prepareWriteCandidate(request, snapshot()).status).toBe("invalid-request");
  });
  it("rejects a stale read-only dependency before considering the candidate", () => {
    const request: WriteBatch = { ...batch(), reads: [{ key: PROJECT_STORAGE_KEY, expectedRevision: 1 }] };
    expect(prepareWriteCandidate(request, snapshot())).toMatchObject({ status: "conflict", reason: "store-revision" });
  });
  it("does not interpret incomplete observed database rows as empty stores", () => {
    expect(prepareWriteCandidate(batch(), { ...snapshot(), values: snapshot().values.slice(1) }).status).toBe("invalid-request");
  });
  it("revalidates the batch rather than trusting a typed-looking caller envelope", () => {
    expect(prepareWriteCandidate({ ...batch(), writes: [] }, snapshot()).status).toBe("invalid-request");
    expect(prepareWriteCandidate({ ...batch(), writes: [{ key: "unknown-store", rawValue: null, expectedRevision: 0 }] }, snapshot()).status)
      .toBe("invalid-request");
  });
  it("fails explicitly on dataset commit-sequence exhaustion", () => {
    expect(prepareWriteCandidate(batch(), { ...snapshot(), commitSequence: Number.MAX_SAFE_INTEGER }).status).toBe("invalid-request");
  });
  it("checks SQL registry parity only; this is not SQL execution or an integration test", () => {
    const sql = readFileSync(new URL("../../database/migrations/001_isolated_persistence.sql", import.meta.url), "utf8");
    const entries = [...sql.matchAll(/\('([^']+)', (\d+)\)/g)];
    expect(entries.map((entry) => entry[1])).toEqual([...EMPIRE_OS_BACKUP_STORAGE_KEYS]);
    expect(entries.map((entry) => Number(entry[2]))).toEqual(EMPIRE_OS_BACKUP_STORAGE_KEYS.map((_, index) => index + 1));
  });
});
