import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import {
  createPostgresAuthorizationStore, createPostgresOperationReconciliationStore, type AuthorizationPostgresConnection,
} from "./postgres-authorization-store";
import { createOperationReconciler } from "./authorization-reconciliation";
import { createTransactionalAuthorizationExecutor } from "./authorization-transaction";
import { authorityFixture, membershipRevocation, preparationWrite, testPrincipal } from "../../database/tests/authorization-fixtures";

const tenantId = "tenant-a";
const datasetId = "00000000-0000-4000-8000-000000000001";
function mockConnection(fail?: string | readonly string[], unsafe = false, missing = false) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const release = vi.fn();
  const state = authorityFixture(tenantId, datasetId);
  async function query<R extends QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<R>> {
    sql.push(text); params.push(values);
    const failures = typeof fail === "string" ? [fail] : fail ?? [];
    if (failures.some((statement) => statement === "COMMIT" || statement === "ROLLBACK"
      || statement.startsWith("BEGIN") ? text === statement : text.startsWith(statement))) {
      throw new Error("Private database failure.");
    }
    const rows: QueryResultRow[] = text.includes("AS unsafe") ? [{ unsafe }]
      : text.includes("lock_authority") ? missing ? [] : [{ state, revision: "1" }]
      : text.includes("SELECT dataset_id::text") ? [{ dataset_id: datasetId }]
      : text.includes("AS now_ms") ? [{ now_ms: "1000" }]
      : text.includes("SELECT generation::text") ? [{ generation: "1", authority_revision: "0", authority_mode: "preparation-only" }]
      : [];
    // A driver response fixture, not a cast of production authority data.
    return { rows: rows as R[], rowCount: text.startsWith("UPDATE") ? 1 : rows.length,
      command: text.startsWith("BEGIN") ? "BEGIN" : text === "COMMIT" || text === "ROLLBACK" ? text : "SELECT", oid: 0, fields: [] };
  }
  const client: AuthorizationPostgresConnection = { query: query as AuthorizationPostgresConnection["query"], release };
  const store = createPostgresAuthorizationStore({ connect: async () => client });
  return { store, sql, params, release };
}
describe("isolated PostgreSQL authorization adapter contract", () => {
  it("locks authority before fresh reads, stages effects and audit on the same connection, then commits", async () => {
    const mock = mockConnection();
    const result = await createTransactionalAuthorizationExecutor(mock.store)
      .execute(await testPrincipal("issuer", datasetId), preparationWrite(tenantId, datasetId, "write-one"));
    expect(result).toMatchObject({ status: "executed", durability: "transaction-commit-confirmed" });
    expect(mock.sql[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED");
    const locked = mock.sql.findIndex((sql) => sql.includes("lock_authority"));
    const applied = mock.sql.findIndex((sql) => sql.includes("apply_operation"));
    expect(locked).toBeGreaterThan(0);
    expect(applied).toBeGreaterThan(locked);
    expect(mock.sql.filter((sql) => sql.includes("apply_operation"))).toHaveLength(1);
    expect(mock.sql.some((sql) => /\b(INSERT|UPDATE|FOR UPDATE)\b/.test(sql.replaceAll("'INSERT'", "").replaceAll("'UPDATE'", "")))).toBe(false);
    const bound = JSON.parse(String(mock.params[applied][0]));
    expect(bound.command.request.writes[0]).toEqual({
      key: "empire-os-captures", expectedRevision: 0, rawValueHex: "5b005d00",
    });
    expect(mock.sql.at(-1)).toBe("COMMIT");
    expect(mock.release).toHaveBeenCalledWith(false);
    expect(mock.sql.some((sql) => sql.includes("SET ROLE") || sql.includes("set_config"))).toBe(false);
    expect(mock.sql.find((sql) => sql.includes("AS unsafe"))).toContain("r.rolreplication");
  });
  it.each(["unsafe-role", "missing-state"] as const)("fails closed on %s", async (mode) => {
    const mock = mockConnection(undefined, mode === "unsafe-role", mode === "missing-state");
    expect(await createTransactionalAuthorizationExecutor(mock.store)
      .execute(await testPrincipal("owner", datasetId), preparationWrite(tenantId, datasetId, "write-one")))
      .toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(mock.sql.at(-1)).toBe("ROLLBACK");
    expect(mock.sql.some((sql) => /^\s*(INSERT|UPDATE)\b/.test(sql) || sql.includes("apply_operation"))).toBe(false);
  });
  it.each(["SELECT empire_os_authorization.apply_operation"] as const)(
    "rolls back %s failures without leaking database details", async (failure) => {
      const mock = mockConnection(failure);
      const result = await createTransactionalAuthorizationExecutor(mock.store)
        .execute(await testPrincipal("issuer", datasetId), preparationWrite(tenantId, datasetId, "write-one"));
      expect(result).toMatchObject({ status: "failed", outcome: "rolled-back" });
      expect(JSON.stringify(result)).not.toContain("Private");
      expect(mock.sql.at(-1)).toBe("ROLLBACK");
    },
  );
  it("reports COMMIT errors as unknown and destroys the connection without pretending rollback", async () => {
    const mock = mockConnection("COMMIT");
    expect(await createTransactionalAuthorizationExecutor(mock.store)
      .execute(await testPrincipal("issuer", datasetId), preparationWrite(tenantId, datasetId, "write-one")))
      .toMatchObject({ status: "unavailable", outcome: "unknown" });
    expect(mock.sql.at(-1)).toBe("COMMIT");
    expect(mock.sql.some((sql) => sql.includes("apply_operation"))).toBe(true);
    expect(mock.sql).not.toContain("ROLLBACK");
    expect(mock.release).toHaveBeenCalledWith(true);
  });
  it("confirms rollback after a failed BEGIN acknowledgement rather than reusing uncertain state", async () => {
    const mock = mockConnection("BEGIN ISOLATION LEVEL READ COMMITTED");
    expect(await createTransactionalAuthorizationExecutor(mock.store)
      .execute(await testPrincipal("issuer", datasetId), preparationWrite(tenantId, datasetId, "write")))
      .toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(mock.sql).toEqual(["BEGIN ISOLATION LEVEL READ COMMITTED", "ROLLBACK"]);
  });
  it("discards the connection when BEGIN and rollback acknowledgements are both unavailable", async () => {
    const mock = mockConnection(["BEGIN ISOLATION LEVEL READ COMMITTED", "ROLLBACK"]);
    expect(await createTransactionalAuthorizationExecutor(mock.store)
      .execute(await testPrincipal("issuer", datasetId), preparationWrite(tenantId, datasetId, "write")))
      .toMatchObject({ status: "unavailable", outcome: "unknown" });
    expect(mock.release).toHaveBeenCalledWith(true);
  });
  it("does not confirm rollback when rollback itself fails after staging", async () => {
    const mock = mockConnection(["SELECT empire_os_authorization.apply_operation", "ROLLBACK"]);
    expect(await createTransactionalAuthorizationExecutor(mock.store)
      .execute(await testPrincipal("issuer", datasetId), preparationWrite(tenantId, datasetId, "write")))
      .toMatchObject({ status: "unavailable", outcome: "unknown" });
    expect(mock.release).toHaveBeenCalledWith(true);
  });
  it("submits the bound authority command and exact proposed state to the database API", async () => {
    const mock = mockConnection();
    expect(await createTransactionalAuthorizationExecutor(mock.store)
      .execute(await testPrincipal("owner", datasetId), membershipRevocation(tenantId, datasetId)))
      .toMatchObject({ status: "executed" });
    const index = mock.sql.findIndex((sql) => sql.includes("apply_operation"));
    expect(JSON.parse(String(mock.params[index][0]))).toEqual(membershipRevocation(tenantId, datasetId));
    expect(JSON.parse(String(mock.params[index][2])).revocations).toHaveLength(1);
    expect(JSON.parse(String(mock.params[index][2])).snapshot.revision).toBe(2);
  });
  it("audits denials without staging effects", async () => {
    const mock = mockConnection();
    expect(await createTransactionalAuthorizationExecutor(mock.store)
      .execute(await testPrincipal("recipient", datasetId), preparationWrite(tenantId, datasetId, "denied")))
      .toMatchObject({ status: "denied" });
    const index = mock.sql.findIndex((sql) => sql.includes("apply_operation"));
    expect(index).toBeGreaterThan(0);
    expect(JSON.parse(String(mock.params[index][1])).decision.status).toBe("denied");
    expect(mock.params[index][2]).toBeNull();
  });
  it("submits cross-tenant dataset denials without a dataset read or lock", async () => {
    const mock = mockConnection();
    const requestedDataset = "00000000-0000-4000-8000-000000000002";
    expect(await createTransactionalAuthorizationExecutor(mock.store)
      .execute(await testPrincipal("issuer", datasetId), preparationWrite(tenantId, requestedDataset, "cross-tenant")))
      .toMatchObject({ status: "denied", decision: { reason: "dataset-not-authorized" } });
    const index = mock.sql.findIndex((sql) => sql.includes("apply_operation"));
    expect(JSON.parse(String(mock.params[index][1])).datasetId).toBe(requestedDataset);
    expect(mock.params[index][2]).toBeNull();
    expect(mock.sql.some((sql) => sql.includes("SELECT generation"))).toBe(false);
  });
  it.each(["\u0000\ud800x\udfff\ud83d\ude00", "", null])("binds exact UTF-16 values and the submitted request fingerprint: %j", async (rawValue) => {
    const mock = mockConnection();
    const input = preparationWrite(tenantId, datasetId, "exact-bytes");
    if (input.command.kind !== "write") throw new Error("Invalid fixture.");
    expect(await createTransactionalAuthorizationExecutor(mock.store).execute(await testPrincipal("issuer", datasetId), {
      ...input, command: { ...input.command, request: { ...input.command.request,
        writes: input.command.request.writes.map((entry) => ({ ...entry, rawValue })),
      } },
    })).toMatchObject({ status: "executed" });
    const index = mock.sql.findIndex((sql) => sql.includes("apply_operation"));
    const content = String(mock.params[index][0]);
    const wire = JSON.parse(content);
    const audit = JSON.parse(String(mock.params[index][1]));
    expect(wire.command.request.writes[0].rawValueHex).toBe(rawValue === null ? null : Buffer.from(rawValue, "utf16le").toString("hex"));
    expect(audit.requestSha256).toBe(createHash("sha256").update(content).digest("hex"));
  });
  it("fails closed when the pool cannot connect", async () => {
    const store = createPostgresAuthorizationStore({ connect: async () => { throw new Error("Private credentials"); } });
    expect(await createTransactionalAuthorizationExecutor(store)
      .execute(await testPrincipal("issuer", datasetId), preparationWrite(tenantId, datasetId, "write")))
      .toMatchObject({ status: "unavailable", outcome: "not-submitted" });
  });
  it("rejects distinct operation and write idempotency identities", async () => {
    const mock = mockConnection();
    const input = preparationWrite(tenantId, datasetId, "write");
    if (input.command.kind !== "write") throw new Error("Invalid fixture.");
    const result = await createTransactionalAuthorizationExecutor(mock.store).execute(await testPrincipal("issuer", datasetId), {
      ...input, command: { ...input.command, request: { ...input.command.request, idempotencyKey: "different" } },
    });
    expect(result).toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(mock.sql.at(-1)).toBe("ROLLBACK");
  });
});

function lookupConnection(options: { fail?: string; unsafe?: boolean; rows?: readonly QueryResultRow[]; revision?: string; rollbackCommand?: string } = {}) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const release = vi.fn();
  const state = authorityFixture(tenantId, datasetId);
  async function query<R extends QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<R>> {
    sql.push(text); params.push(values);
    if (options.fail && (options.fail === "ROLLBACK" || options.fail.startsWith("BEGIN") ? text === options.fail : text.includes(options.fail))) {
      throw new Error("Private database failure.");
    }
    const rows: readonly QueryResultRow[] = text.includes("AS unsafe") ? [{ unsafe: options.unsafe ?? false }]
      : text.includes("lookup_operation") ? options.rows ?? [{ state, revision: options.revision ?? "1", actor_subject: "issuer",
        authorized: true, records: [] }]
      : [];
    return { rows: rows as R[], rowCount: rows.length, oid: 0, fields: [],
      command: text.startsWith("BEGIN") ? "BEGIN" : text === "ROLLBACK" ? options.rollbackCommand ?? "ROLLBACK" : "SELECT" };
  }
  const client: AuthorizationPostgresConnection = { query: query as AuthorizationPostgresConnection["query"], release };
  return { store: createPostgresOperationReconciliationStore({ connect: async () => client }), sql, params, release };
}
describe("isolated PostgreSQL operation reconciliation adapter", () => {
  it("checks the runtime identity, calls the locking lookup API once, and always rolls back", async () => {
    const mock = lookupConnection();
    const result = await mock.store.lookupOperation(tenantId, "write-one");
    expect(result).toMatchObject({ status: "observed", source: "committed-database-read", actorSubject: "issuer", authorized: true, records: [] });
    expect(mock.sql[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED");
    const role = mock.sql.findIndex((sql) => sql.includes("AS unsafe"));
    const lookup = mock.sql.findIndex((sql) => sql.includes("lookup_operation"));
    expect(role).toBeGreaterThan(0);
    expect(lookup).toBeGreaterThan(role);
    expect(mock.params[lookup]).toEqual([tenantId, "write-one"]);
    expect(mock.sql.at(-1)).toBe("ROLLBACK");
    expect(mock.sql).not.toContain("COMMIT");
    expect(mock.sql.some((sql) => /\b(INSERT|UPDATE|DELETE|apply_operation|SET ROLE|set_config)\b/
      .test(sql.replaceAll("'INSERT'", "").replaceAll("'UPDATE'", "").replaceAll("'DELETE'", "")))).toBe(false);
    expect(mock.release).toHaveBeenCalledWith(false);
  });
  it("feeds the reconciler a not-executed outcome from committed database evidence", async () => {
    const mock = lookupConnection();
    expect(await createOperationReconciler(mock.store).reconcile(await testPrincipal("issuer", datasetId),
      preparationWrite(tenantId, datasetId, "write-one"))).toEqual({
      status: "not-executed", operationId: "write-one", observedPolicyRevision: 1, source: "committed-database-read",
    });
  });
  it.each([
    ["invalid identifiers", { }, " bad", "write-one"],
    ["invalid operation IDs", { }, tenantId, "bad id"],
    ["an unsafe identity", { unsafe: true }, tenantId, "write-one"],
    ["a missing tenant", { rows: [] }, tenantId, "write-one"],
    ["duplicate rows", { rows: [{}, {}] }, tenantId, "write-one"],
    ["a revision mismatch", { revision: "2" }, tenantId, "write-one"],
    ["malformed state", { rows: [{ state: { schemaVersion: 9 }, revision: "1", actor_subject: "issuer", authorized: true, records: [] }] }, tenantId, "write-one"],
    ["a lookup error", { fail: "lookup_operation" }, tenantId, "write-one"],
    ["a BEGIN error", { fail: "BEGIN ISOLATION LEVEL READ COMMITTED" }, tenantId, "write-one"],
  ] as const)("fails closed on %s", async (_name, options, tenant, operationId) => {
    const mock = lookupConnection(options);
    const result = await mock.store.lookupOperation(tenant, operationId);
    expect(result).toEqual({ status: "unavailable", message: "Operation reconciliation storage is unavailable." });
    expect(JSON.stringify(result)).not.toContain("Private");
    if (mock.sql.length > 0) expect(mock.sql.at(-1)).toBe("ROLLBACK");
    expect(mock.sql).not.toContain("COMMIT");
  });
  it.each([["a failed rollback", { fail: "ROLLBACK" }], ["an unconfirmed rollback", { rollbackCommand: "SELECT" }]] as const)(
    "discards the observation and destroys the connection after %s", async (_name, options) => {
      const mock = lookupConnection(options);
      expect(await mock.store.lookupOperation(tenantId, "write-one")).toMatchObject({ status: "unavailable" });
      expect(mock.release).toHaveBeenCalledWith(true);
    });
  it("reports connection failures as unavailable without a connection to release", async () => {
    const store = createPostgresOperationReconciliationStore({ connect: async () => { throw new Error("Private connect failure."); } });
    expect(await store.lookupOperation(tenantId, "write-one")).toEqual({ status: "unavailable", message: "Operation reconciliation storage is unavailable." });
  });
});
