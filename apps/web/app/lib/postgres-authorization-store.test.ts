import { describe, expect, it, vi } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { createPostgresAuthorizationStore, type AuthorizationPostgresConnection } from "./postgres-authorization-store";
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
      : text.includes("SELECT state,revision") ? missing ? [] : [{ state, revision: "1" }]
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
    const locked = mock.sql.findIndex((sql) => sql.includes("SELECT state,revision"));
    const staged = mock.sql.findIndex((sql) => sql.includes("INSERT INTO empire_os_authorization.preparation_writes"));
    const audited = mock.sql.findIndex((sql) => sql.includes("INSERT INTO empire_os_authorization.audit"));
    expect(locked).toBeLessThan(staged);
    expect(staged).toBeLessThan(audited);
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
    expect(mock.sql.some((sql) => sql.includes("INSERT"))).toBe(false);
  });
  it.each(["INSERT INTO empire_os_authorization.preparation_writes", "INSERT INTO empire_os_authorization.audit"] as const)(
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
    expect(mock.sql.some((sql) => sql.includes("INSERT INTO empire_os_authorization.audit"))).toBe(true);
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
    const mock = mockConnection(["INSERT INTO empire_os_authorization.audit", "ROLLBACK"]);
    expect(await createTransactionalAuthorizationExecutor(mock.store)
      .execute(await testPrincipal("issuer", datasetId), preparationWrite(tenantId, datasetId, "write")))
      .toMatchObject({ status: "unavailable", outcome: "unknown" });
    expect(mock.release).toHaveBeenCalledWith(true);
  });
  it("persists authority mutations by revision compare-and-swap with atomic audit", async () => {
    const mock = mockConnection();
    expect(await createTransactionalAuthorizationExecutor(mock.store)
      .execute(await testPrincipal("owner", datasetId), membershipRevocation(tenantId, datasetId)))
      .toMatchObject({ status: "executed" });
    const index = mock.sql.findIndex((sql) => sql.startsWith("UPDATE"));
    expect(mock.params[index].slice(1)).toEqual([2, tenantId, 1]);
    expect(JSON.parse(String(mock.params[index][0])).revocations).toHaveLength(1);
  });
  it("audits denials without staging effects", async () => {
    const mock = mockConnection();
    expect(await createTransactionalAuthorizationExecutor(mock.store)
      .execute(await testPrincipal("recipient", datasetId), preparationWrite(tenantId, datasetId, "denied")))
      .toMatchObject({ status: "denied" });
    expect(mock.sql.some((sql) => sql.includes("preparation_writes"))).toBe(false);
    expect(mock.sql.some((sql) => sql.includes("INSERT INTO empire_os_authorization.audit"))).toBe(true);
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
