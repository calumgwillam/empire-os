import { describe, expect, it } from "vitest";
import { EMPIRE_OS_BACKUP_STORAGE_KEYS, PROJECT_STORAGE_KEY, STORAGE_KEY } from "./backup";
import {
  checkBatchPreconditions, commitRetryPolicy, SERVER_PERSISTENCE_PROTOCOL, UnconfiguredServerPersistenceRepository,
  validateCommitLookup, validateCommitReceipt, validateDatasetFence, validateSnapshot, validateSnapshotRequest, validateWriteBatch, writeBatchContent,
  type CommitReceipt, type DatasetFence, type DatasetSnapshot, type Validation, type WriteBatch,
} from "./server-persistence-contract";

const fence: DatasetFence = {
  datasetId: "00000000-0000-4000-8000-000000000001", protocolVersion: SERVER_PERSISTENCE_PROTOCOL,
  generation: 1, authorityRevision: 0,
};
function batch(): WriteBatch {
  return { fence: { ...fence }, idempotencyKey: "write:one", reads: [{ key: PROJECT_STORAGE_KEY, expectedRevision: 0 }],
    writes: [{ key: STORAGE_KEY, expectedRevision: 0, rawValue: ' [ {"unknown":"\\u0061"} ] ' }] };
}
function snapshot(): DatasetSnapshot {
  return { ...fence, commitSequence: 0,
    values: EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => ({ key, rawValue: null, revision: 0 })) };
}
function valid<T>(result: Validation<T>): T {
  if (result.status !== "valid") throw new Error(JSON.stringify(result));
  return result.value;
}
function receipt(): CommitReceipt {
  return { fence: { ...fence }, idempotencyKey: "write:one", requestSha256: "a".repeat(64),
    transactionId: "00000000-0000-4000-8000-000000000002", commitSequence: 1,
    durability: "database-commit-confirmed", revisions: [{ key: STORAGE_KEY, revision: 1 }] };
}

describe("Server persistence contract unit tests (no database)", () => {
  it("copies and freezes a complete write request before any asynchronous work", () => {
    const request = batch();
    const result = valid(validateWriteBatch(request));
    expect(result).toEqual(request);
    expect(result).not.toBe(request);
    expect(result.fence).not.toBe(request.fence);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.fence)).toBe(true);
    expect(Object.isFrozen(result.reads)).toBe(true);
    expect(Object.isFrozen(result.writes[0])).toBe(true);
  });

  it.each([null, [], {}, "write", { ...batch(), actor: "founder" }, { ...batch(), authorized: true }])(
    "rejects invalid envelopes and client identity claims: %j", (value) => {
      expect(validateWriteBatch(value).status).toBe("invalid-request");
    },
  );
  it.each([0, -1, 2, "1", undefined])("rejects unsupported protocol versions: %s", (protocolVersion) => {
    expect(validateWriteBatch({ ...batch(), fence: { ...fence, protocolVersion } }).status).toBe("unsupported-protocol");
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN])("rejects invalid generations: %s", (generation) => {
    expect(validateDatasetFence({ ...fence, generation }).status).toBe("invalid-request");
  });
  it("rejects malformed dataset IDs and authorization claims within a fence", () => {
    expect(validateDatasetFence({ ...fence, datasetId: "local" }).status).toBe("invalid-request");
    expect(validateDatasetFence({ ...fence, canWrite: true }).status).toBe("invalid-request");
    expect(validateDatasetFence({ ...fence, authorityRevision: -1 }).status).toBe("invalid-request");
  });
  it.each(["", "with space", "\n", "a".repeat(129)])("rejects unsafe idempotency keys: %j", (idempotencyKey) => {
    expect(validateWriteBatch({ ...batch(), idempotencyKey }).status).toBe("invalid-request");
  });
  it("requires at least one write but permits no additional read dependencies", () => {
    expect(validateWriteBatch({ ...batch(), writes: [] }).status).toBe("invalid-request");
    expect(validateWriteBatch({ ...batch(), reads: [] }).status).toBe("valid");
  });
  it("rejects unknown business keys, duplicate reads and duplicate writes", () => {
    const request = batch();
    expect(validateWriteBatch({ ...request, writes: [{ ...request.writes[0], key: "internal-authority" }] }).status).toBe("invalid-request");
    expect(validateWriteBatch({ ...request, reads: [...request.reads, ...request.reads] }).status).toBe("invalid-request");
    expect(validateWriteBatch({ ...request, writes: [...request.writes, ...request.writes] }).status).toBe("invalid-request");
  });
  it.each([-1, 0.5, NaN, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid or exhausted write revisions: %s", (expectedRevision) => {
      expect(validateWriteBatch({ ...batch(), writes: [{ ...batch().writes[0], expectedRevision }] }).status).toBe("invalid-request");
    },
  );
  it("allows the maximum read-only dependency revision without incrementing it", () => {
    expect(validateWriteBatch({ ...batch(), reads: [{ key: PROJECT_STORAGE_KEY, expectedRevision: Number.MAX_SAFE_INTEGER }] }).status).toBe("valid");
  });
  it("rejects contradictory read/write expectations for the same store", () => {
    expect(validateWriteBatch({ ...batch(), reads: [{ key: STORAGE_KEY, expectedRevision: 1 }] }).status).toBe("invalid-request");
    expect(validateWriteBatch({ ...batch(), reads: [{ key: STORAGE_KEY, expectedRevision: 0 }] }).status).toBe("valid");
  });
  it("preserves null, empty strings, unknown JSON and non-JSON strings without coercion", () => {
    for (const rawValue of [null, "", "not-json", '[{"unknown":true}]', "\ud800\u0000"]) {
      expect(valid(validateWriteBatch({ ...batch(), writes: [{ ...batch().writes[0], rawValue }] })).writes[0].rawValue).toBe(rawValue);
    }
    expect(validateWriteBatch({ ...batch(), writes: [{ ...batch().writes[0], rawValue: {} }] }).status).toBe("invalid-request");
  });
  it("canonicalizes equivalent array order without changing raw string content", () => {
    const writes = [...batch().writes, { key: PROJECT_STORAGE_KEY, expectedRevision: 2, rawValue: null }];
    const first = valid(validateWriteBatch({ ...batch(), reads: [], writes }));
    const second = valid(validateWriteBatch({ ...batch(), reads: [], writes: [...writes].reverse() }));
    expect(writeBatchContent(first)).toBe(writeBatchContent(second));
    expect(first.writes[0].rawValue).toBe(batch().writes[0].rawValue);
  });
  it("binds canonical request identity to authority, dependencies, key and exact values", () => {
    const first = writeBatchContent(batch());
    const changes: WriteBatch[] = [
      { ...batch(), idempotencyKey: "write:two" },
      { ...batch(), fence: { ...fence, generation: 2 } },
      { ...batch(), fence: { ...fence, authorityRevision: 1 } },
      { ...batch(), fence: { ...fence, datasetId: "00000000-0000-4000-8000-000000000003" } },
      { ...batch(), reads: [{ key: PROJECT_STORAGE_KEY, expectedRevision: 1 }] },
      { ...batch(), writes: [{ ...batch().writes[0], expectedRevision: 1 }] },
      { ...batch(), writes: [{ ...batch().writes[0], rawValue: null }] },
      { ...batch(), writes: [{ ...batch().writes[0], rawValue: "" }] },
    ];
    expect(changes.every((change) => writeBatchContent(change) !== first)).toBe(true);
  });
  it("validates all 21 snapshot stores without synthesizing absent rows", () => {
    const result = valid(validateSnapshot(snapshot()));
    expect(result.values).toHaveLength(21);
    expect(result.values.every((entry) => entry.rawValue === null && entry.revision === 0)).toBe(true);
    expect(Object.isFrozen(result.values[0])).toBe(true);
    expect(validateSnapshot({ ...snapshot(), values: snapshot().values.slice(1) }).status).toBe("invalid-request");
  });
  it("rejects duplicated snapshot stores even when the row count is 21", () => {
    const values = [...snapshot().values];
    values[1] = values[0];
    expect(validateSnapshot({ ...snapshot(), values }).status).toBe("invalid-request");
  });
  it("distinguishes revisioned null tombstones from invalid non-null revision-zero values", () => {
    const values = snapshot().values.map((entry) => entry.key === STORAGE_KEY ? { ...entry, revision: 2 } : entry);
    expect(validateSnapshot({ ...snapshot(), values }).status).toBe("valid");
    expect(validateSnapshot({ ...snapshot(), values: values.map((entry) => entry.key === STORAGE_KEY
      ? { ...entry, rawValue: "[]", revision: 0 } : entry) }).status).toBe("invalid-request");
  });
  it("rejects malformed snapshot values and unsafe commit sequences", () => {
    expect(validateSnapshot({ ...snapshot(), commitSequence: Number.MAX_SAFE_INTEGER + 1 }).status).toBe("invalid-request");
    expect(validateSnapshot({ ...snapshot(), values: snapshot().values.map((entry) =>
      entry.key === STORAGE_KEY ? { ...entry, revision: -1 } : entry) }).status).toBe("invalid-request");
  });
  it("checks dependencies that are read but not written", () => {
    const current = { ...snapshot(), values: snapshot().values.map((entry) =>
      entry.key === PROJECT_STORAGE_KEY ? { ...entry, revision: 1 } : entry) };
    expect(checkBatchPreconditions(batch(), current)).toEqual({
      status: "conflict", reason: "store-revision",
      conflicts: [{ key: PROJECT_STORAGE_KEY, expectedRevision: 0, actualRevision: 1 }],
    });
  });
  it("reports stale write expectations independently of read-only dependencies", () => {
    const current = { ...snapshot(), values: snapshot().values.map((entry) =>
      entry.key === STORAGE_KEY ? { ...entry, revision: 1 } : entry) };
    expect(checkBatchPreconditions(batch(), current)).toMatchObject({
      status: "conflict", reason: "store-revision", conflicts: [{ key: STORAGE_KEY, actualRevision: 1 }],
    });
  });
  it.each(["generation", "authorityRevision"] as const)("rejects a stale %s fence before checking values", (field) => {
    expect(checkBatchPreconditions(batch(), { ...snapshot(), [field]: snapshot()[field] + 1 })).toMatchObject({
      status: "conflict", reason: "dataset-fence",
    });
  });
  it("accepts matching preconditions without claiming that a transaction ran", () => {
    expect(checkBatchPreconditions(batch(), valid(validateSnapshot(snapshot())))).toBeNull();
  });
  it("validates a synthetic receipt's shape without treating it as database proof", () => {
    expect(valid(validateCommitReceipt(receipt(), batch(), "a".repeat(64)))).toEqual(receipt());
  });
  it("validates snapshot and lookup envelopes without accepting client identity", () => {
    const request = { datasetId: fence.datasetId, protocolVersion: 1 };
    expect(validateSnapshotRequest(request).status).toBe("valid");
    expect(validateSnapshotRequest({ ...request, principalId: "owner" }).status).toBe("invalid-request");
    expect(validateSnapshotRequest({ ...request, protocolVersion: 2 }).status).toBe("unsupported-protocol");
    const lookup = { ...request, generation: 1, idempotencyKey: "write:one", requestSha256: "a".repeat(64) };
    expect(validateCommitLookup(lookup).status).toBe("valid");
    expect(validateCommitLookup({ ...lookup, authorized: true }).status).toBe("invalid-request");
    expect(validateCommitLookup({ ...lookup, generation: 0 }).status).toBe("invalid-request");
    expect(validateCommitLookup({ ...lookup, requestSha256: "fabricated" }).status).toBe("invalid-request");
  });
  it("unknown commits and unresolved lookups may only retry the original request", () => {
    expect(commitRetryPolicy({ status: "unavailable", outcome: "unknown", message: "Response lost." })).toBe("same-request-only");
    expect(commitRetryPolicy({ status: "failed", outcome: "unknown", message: "COMMIT confirmation lost." })).toBe("same-request-only");
    expect(commitRetryPolicy({ status: "unresolved", retry: "same-request-only" })).toBe("same-request-only");
  });
  it("confirmed rollback, conflict and authorization failures never trigger blind retries", () => {
    expect(commitRetryPolicy({ status: "failed", outcome: "rolled-back", message: "Aborted." })).toBe("stop");
    expect(commitRetryPolicy({ status: "conflict", reason: "idempotency-key-reused", message: "Different request." })).toBe("stop");
    expect(commitRetryPolicy({ status: "unauthorized", reason: "forbidden" })).toBe("stop");
    expect(commitRetryPolicy({ status: "committed", receipt: receipt(), replayed: true })).toBe("complete");
  });
  it.each([
    { durability: "queued" }, { durability: "accepted" }, { commitSequence: 0 },
    { requestSha256: "b".repeat(64) }, { idempotencyKey: "other" }, { transactionId: "not-uuid" },
    { revisions: [] }, { revisions: [{ key: STORAGE_KEY, revision: 2 }] },
    { revisions: [{ key: PROJECT_STORAGE_KEY, revision: 1 }] },
    { fence: { ...fence, generation: 2 } },
  ])("rejects incomplete or mismatched receipt fields: %j", (fields) => {
    expect(validateCommitReceipt({ ...receipt(), ...fields }, batch(), "a".repeat(64)).status).toBe("invalid-request");
  });
  it("the unconfigured repository never claims a snapshot, import or commit", async () => {
    const repository = new UnconfiguredServerPersistenceRepository();
    const plan = { version: 1 as const, sourceSha256: "a".repeat(64),
      entries: snapshot().values.map(({ key, rawValue }) => ({ key, rawValue })) };
    const results = await Promise.all([
      repository.readSnapshot({ datasetId: fence.datasetId, protocolVersion: 1 }),
      repository.writeBatch(batch()),
      repository.lookupCommit({ datasetId: fence.datasetId, protocolVersion: 1, generation: 1,
        idempotencyKey: batch().idempotencyKey, requestSha256: "a".repeat(64) }),
      repository.stageImport({ fence, idempotencyKey: "import:one", plan }),
    ]);
    expect(results).toHaveLength(4);
    expect(results).toEqual(Array.from({ length: 4 }, () => ({
      status: "unavailable", outcome: "not-submitted", message: "No authenticated PostgreSQL adapter is configured.",
    })));
  });
  it("rejects duplicate revisions in a multi-store receipt even when the count matches", () => {
    const request: WriteBatch = { ...batch(), reads: [], writes: [
      ...batch().writes, { key: PROJECT_STORAGE_KEY, expectedRevision: 0, rawValue: null },
    ] };
    const duplicate = { ...receipt(), revisions: [{ key: STORAGE_KEY, revision: 1 }, { key: STORAGE_KEY, revision: 1 }] };
    expect(validateCommitReceipt(duplicate, request, "a".repeat(64)).status).toBe("invalid-request");
  });
});
