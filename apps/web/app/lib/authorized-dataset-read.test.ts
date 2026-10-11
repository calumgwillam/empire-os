import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { decodeDatasetSnapshotRow, READ_DATASET_SNAPSHOT_SQL } from "./authorized-dataset-read";
import { createTransactionalAuthorizationExecutor } from "./authorization-transaction";
import { EMPIRE_OS_BACKUP_STORAGE_KEYS, STORAGE_KEY } from "./backup";
import {
  createPostgresAuthorizationStore, createPostgresDatasetSnapshotReader, type AuthorizationPostgresConnection,
} from "./postgres-authorization-store";
import { encodeRawStoreValue } from "./server-import-preparation";
import { authorityFixture, preparationWrite, testPrincipal } from "../../database/tests/authorization-fixtures";

const tenantId = "tenant-a";
const datasetId = "00000000-0000-4000-8000-000000000001";
const hex = (value: string | null) => { const bytes = encodeRawStoreValue(value); return bytes ? Buffer.from(bytes).toString("hex") : null; };

function allowedRow(overrides: Record<string, unknown> = {}, values: Record<string, { revision: number; raw: string | null }> = {}) {
  return {
    state: authorityFixture(tenantId, datasetId), revision: "1", actor_subject: "owner",
    decision: { status: "allowed", reason: "owner-authority", policyVersion: 1, observedPolicyRevision: 1 },
    checked_at: "1000", generation: "1", authority_revision: "0",
    commit_sequence: String(Object.values(values).some((entry) => entry.revision > 0) ? 1 : 0),
    store_values: EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => ({
      key, revision: values[key]?.revision ?? 0, rawValueHex: hex(values[key]?.raw ?? null),
    })),
    ...overrides,
  };
}
function deniedRow(overrides: Record<string, unknown> = {}) {
  return { ...allowedRow(), actor_subject: "issuer",
    decision: { status: "denied", reason: "capability-not-granted", policyVersion: 1, observedPolicyRevision: 1 },
    generation: null, authority_revision: null, commit_sequence: null, store_values: [], ...overrides };
}

describe("authorized dataset snapshot row decoding", () => {
  it("decodes every store losslessly from UTF-16LE hex, including astral and lone surrogate units", () => {
    const raw = '[{"id":"ü😀\ud800","unknown":true}]';
    const observation = decodeDatasetSnapshotRow(allowedRow({}, { [STORAGE_KEY]: { revision: 1, raw } }), tenantId, datasetId);
    expect(observation).toMatchObject({ source: "committed-database-read", actorSubject: "owner", checkedAt: 1000,
      readDecision: { status: "allowed", reason: "owner-authority" }, snapshot: { commitSequence: 1, generation: 1 } });
    expect(observation.snapshot?.values.find((entry) => entry.key === STORAGE_KEY)).toEqual({ key: STORAGE_KEY, rawValue: raw, revision: 1 });
    expect(observation.snapshot?.values.map((entry) => entry.key)).toEqual([...EMPIRE_OS_BACKUP_STORAGE_KEYS]);
  });
  it("accepts a denial only when it discloses no business data or counters", () => {
    expect(decodeDatasetSnapshotRow(deniedRow(), tenantId, datasetId)).toMatchObject({ snapshot: null, readDecision: { status: "denied" } });
    for (const leak of [{ generation: "1" }, { commit_sequence: "0" }, { store_values: allowedRow().store_values }]) {
      expect(() => decodeDatasetSnapshotRow(deniedRow(leak), tenantId, datasetId)).toThrow();
    }
  });
  it.each([
    ["foreign tenant state", { state: authorityFixture("tenant-b", datasetId) }],
    ["revision mismatch", { revision: "2" }],
    ["unsafe counter", { generation: "1.5" }],
    ["invalid actor", { actor_subject: " owner" }],
    ["decision for another revision", { decision: { status: "allowed", reason: "owner-authority", policyVersion: 1, observedPolicyRevision: 2 } }],
    ["unknown decision status", { decision: { status: "maybe", reason: "x", policyVersion: 1, observedPolicyRevision: 1 } }],
    ["missing store", { store_values: allowedRow().store_values.slice(1) }],
    ["duplicate store", { store_values: [...allowedRow().store_values.slice(1), allowedRow().store_values[1]] }],
    ["extra field", { store_values: allowedRow().store_values.map((entry, index) => index ? entry : { ...entry, extra: 1 }) }],
    ["odd hex", { store_values: allowedRow().store_values.map((entry, index) => index ? entry : { ...entry, revision: 1, rawValueHex: "5b0" }) }],
    ["uppercase hex", { store_values: allowedRow().store_values.map((entry, index) => index ? entry : { ...entry, revision: 1, rawValueHex: "5B005D00" }) }],
    ["value without revision", { store_values: allowedRow().store_values.map((entry, index) => index ? entry : { ...entry, rawValueHex: "5b005d00" }) }],
    ["commit sequence below revisions", { store_values: allowedRow().store_values.map((entry, index) => index ? entry : { ...entry, revision: 2, rawValueHex: "5b005d00" }), commit_sequence: "1" }],
    ["commit sequence without revisions", { commit_sequence: "1" }],
  ])("fails closed on %s", (_name, overrides) => {
    expect(() => decodeDatasetSnapshotRow(allowedRow(overrides), tenantId, datasetId)).toThrow();
  });
  it("refuses a dataset outside the locked tenant's authority", () => {
    expect(() => decodeDatasetSnapshotRow(allowedRow(), tenantId, "00000000-0000-4000-8000-000000000009")).toThrow();
  });
});

function mockConnection(options: { fail?: string; unsafe?: boolean; row?: unknown; noRow?: boolean } = {}) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const release = vi.fn();
  const state = authorityFixture(tenantId, datasetId);
  async function query<R extends QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<R>> {
    sql.push(text); params.push(values);
    if (options.fail && (text === options.fail || (options.fail !== "ROLLBACK" && text.startsWith(options.fail)))) {
      throw new Error("Private database failure.");
    }
    const rows: QueryResultRow[] = text.includes("AS unsafe") ? [{ unsafe: options.unsafe ?? false }]
      : text === READ_DATASET_SNAPSHOT_SQL ? options.noRow ? [] : [(options.row ?? allowedRow()) as QueryResultRow]
      : text.includes("lock_authority") ? [{ state, revision: "1" }]
      : text.includes("SELECT dataset_id::text") ? [{ dataset_id: datasetId }]
      : text.includes("AS now_ms") ? [{ now_ms: "1000" }]
      : text.includes("SELECT generation::text") ? [{ generation: "1", authority_revision: "0", authority_mode: "preparation-only" }]
      : [];
    return { rows: rows as R[], rowCount: rows.length,
      command: text.startsWith("BEGIN") ? "BEGIN" : text === "COMMIT" || text === "ROLLBACK" ? text : "SELECT", oid: 0, fields: [] };
  }
  const client: AuthorizationPostgresConnection = { query: query as AuthorizationPostgresConnection["query"], release };
  return { source: { connect: async () => client }, sql, params, release };
}

describe("PostgreSQL authorized dataset reader", () => {
  it("reads under the restricted identity with bound parameters and always rolls back", async () => {
    const mock = mockConnection();
    const result = await createPostgresDatasetSnapshotReader(mock.source).readDataset(tenantId, datasetId);
    expect(result).toMatchObject({ status: "observed", observation: { actorSubject: "owner", snapshot: { datasetId } } });
    expect(mock.sql[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED");
    expect(mock.sql.some((text) => text.includes("AS unsafe"))).toBe(true);
    const read = mock.sql.indexOf(READ_DATASET_SNAPSHOT_SQL);
    expect(read).toBeGreaterThan(mock.sql.findIndex((text) => text.includes("AS unsafe")));
    expect(mock.params[read]).toEqual([tenantId, datasetId]);
    expect(mock.sql.at(-1)).toBe("ROLLBACK");
    expect(mock.sql).not.toContain("COMMIT");
    expect(mock.sql.some((text) => /\b(INSERT|UPDATE|DELETE|FOR UPDATE|SET ROLE)\b/.test(text.replace(/'[^']*'/g, "''")))).toBe(false);
    expect(mock.release).toHaveBeenCalledWith(false);
  });
  it.each([
    ["unsafe identity", { unsafe: true }],
    ["missing tenant", { noRow: true }],
    ["malformed row", { row: allowedRow({ revision: "2" }) }],
    ["query failure", { fail: READ_DATASET_SNAPSHOT_SQL }],
  ])("returns unavailable without data on %s", async (_name, options) => {
    const mock = mockConnection(options);
    const result = await createPostgresDatasetSnapshotReader(mock.source).readDataset(tenantId, datasetId);
    expect(result).toEqual({ status: "unavailable", message: "Dataset snapshot storage is unavailable." });
    expect(mock.sql.at(-1)).toBe("ROLLBACK");
    expect(mock.release).toHaveBeenCalledWith(false);
  });
  it("discards the connection and returns nothing when rollback is not confirmed", async () => {
    const mock = mockConnection({ fail: "ROLLBACK" });
    expect(await createPostgresDatasetSnapshotReader(mock.source).readDataset(tenantId, datasetId)).toMatchObject({ status: "unavailable" });
    expect(mock.release).toHaveBeenCalledWith(true);
  });
  it("rejects invalid scope without connecting", async () => {
    const connect = vi.fn();
    const reader = createPostgresDatasetSnapshotReader({ connect });
    expect(await reader.readDataset(" tenant", datasetId)).toMatchObject({ status: "unavailable" });
    expect(await reader.readDataset(tenantId, "not-a-uuid")).toMatchObject({ status: "unavailable" });
    expect(connect).not.toHaveBeenCalled();
  });
});

describe("PostgreSQL locked full-candidate write hook", () => {
  it("is not issued unless explicitly configured, preserving existing write behaviour", async () => {
    const mock = mockConnection();
    expect(await createTransactionalAuthorizationExecutor(createPostgresAuthorizationStore(mock.source))
      .execute(await testPrincipal("owner", datasetId), preparationWrite(tenantId, datasetId, "write-one")))
      .toMatchObject({ status: "executed" });
    expect(mock.sql).not.toContain(READ_DATASET_SNAPSHOT_SQL);
  });
  it("re-reads the dataset inside the locked transaction and validates before apply_operation", async () => {
    const mock = mockConnection();
    const hook = vi.fn();
    expect(await createTransactionalAuthorizationExecutor(createPostgresAuthorizationStore(mock.source, { lockedWriteCandidate: hook }))
      .execute(await testPrincipal("owner", datasetId), preparationWrite(tenantId, datasetId, "write-one")))
      .toMatchObject({ status: "executed" });
    const locked = mock.sql.findIndex((text) => text.includes("lock_authority"));
    const read = mock.sql.indexOf(READ_DATASET_SNAPSHOT_SQL);
    const applied = mock.sql.findIndex((text) => text.includes("apply_operation"));
    expect(locked).toBeGreaterThan(0);
    expect(read).toBeGreaterThan(locked);
    expect(applied).toBeGreaterThan(read);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0][0]).toMatchObject({ idempotencyKey: "write-one" });
    expect(hook.mock.calls[0][1]).toMatchObject({ datasetId, commitSequence: 0 });
    expect(mock.sql.at(-1)).toBe("COMMIT");
  });
  it.each([
    ["the hook rejects the candidate", {}, (): void => { throw new Error("invalid candidate"); }],
    ["the locked read is denied", { row: deniedRow({ actor_subject: "owner", decision: {
      status: "denied", reason: "capability-not-granted", policyVersion: 1, observedPolicyRevision: 1 } }) }, (): void => undefined],
    ["locked revisions disagree", { row: allowedRow({}, { [STORAGE_KEY]: { revision: 1, raw: "[]" } }) }, (): void => undefined],
    ["the locked read is missing", { noRow: true }, (): void => undefined],
  ] as const)("rolls back with no apply_operation when %s", async (_name, options, hook) => {
    const mock = mockConnection(options);
    expect(await createTransactionalAuthorizationExecutor(createPostgresAuthorizationStore(mock.source, { lockedWriteCandidate: hook }))
      .execute(await testPrincipal("owner", datasetId), preparationWrite(tenantId, datasetId, "write-one")))
      .toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(mock.sql.some((text) => text.includes("apply_operation"))).toBe(false);
    expect(mock.sql.at(-1)).toBe("ROLLBACK");
  });
});
