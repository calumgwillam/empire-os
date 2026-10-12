import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { authorityFixture } from "../../database/tests/authorization-fixtures";
import {
  createPostgresOperationReconciliationStore, type AuthorizationPostgresConnection,
} from "./postgres-authorization-store";
import { PROVISIONING_CONTRACT_SQL } from "./postgres-employee-provisioning-store";

const tenant = "tenant-a";
const dataset = "00000000-0000-4000-8000-000000000001";
function harness(options: {
  ready?: boolean; fail?: string; rollbackCommand?: string; missing?: boolean; inconsistent?: boolean;
} = {}) {
  const statements: string[] = [];
  const release = vi.fn();
  async function query<R extends QueryResultRow>(sql: string): Promise<QueryResult<R>> {
    statements.push(sql);
    if (options.fail && sql.includes(options.fail)) throw new Error("private database details");
    let rows: QueryResultRow[] = [];
    if (sql.includes("AS unsafe")) rows = [{ unsafe: false }];
    if (sql === PROVISIONING_CONTRACT_SQL) rows = [{ ready: options.ready ?? true }];
    if (sql.includes("lookup_operation")) rows = options.missing ? [] : [{
      state: authorityFixture(tenant, dataset), revision: options.inconsistent ? "999" : "1",
      actor_subject: "owner", authorized: true, records: [],
    }];
    return {
      rows: rows as R[], fields: [], oid: 0, rowCount: rows.length,
      command: sql.startsWith("BEGIN") ? "BEGIN"
        : sql === "ROLLBACK" ? options.rollbackCommand ?? "ROLLBACK" : "SELECT",
    };
  }
  const connection: AuthorizationPostgresConnection = {
    query: query as AuthorizationPostgresConnection["query"], release,
  };
  const connect = vi.fn(async () => connection);
  return {
    connect, statements, release,
    store: createPostgresOperationReconciliationStore({ connect }, { requiredContractSql: PROVISIONING_CONTRACT_SQL }),
  };
}

describe("provisioning catalog-fenced reconciliation driver (OFFLINE, no database)", () => {
  it("checks the candidate inside the restricted transaction, then locked lookup, then confirmed rollback", async () => {
    const h = harness();
    expect(await h.store.lookupOperation(tenant, "provision:one"))
      .toMatchObject({ status: "observed", source: "committed-database-read", records: [] });
    expect(h.statements[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED");
    const contract = h.statements.indexOf(PROVISIONING_CONTRACT_SQL);
    const lookup = h.statements.findIndex(sql => sql.includes("lookup_operation"));
    expect(contract).toBeGreaterThan(0);
    expect(lookup).toBeGreaterThan(contract);
    expect(h.statements.at(-1)).toBe("ROLLBACK");
    expect(h.release).toHaveBeenCalledWith(false);
    expect(h.statements.some(sql => /^\s*(COMMIT|INSERT|UPDATE|DELETE)\b/.test(sql)
      || sql.includes("FROM empire_os_authorization.provision_member"))).toBe(false);
  });

  it.each([
    { ready: false }, { fail: "lookup_operation" }, { missing: true }, { inconsistent: true },
    { fail: "AS ready" },
  ])("discards observation on unavailable/incomplete database visibility %j", async options => {
    const h = harness(options);
    expect(await h.store.lookupOperation(tenant, "provision:one")).toMatchObject({ status: "unavailable" });
    expect(h.statements.at(-1)).toBe("ROLLBACK");
    if (options.ready === false) expect(h.statements.some(sql => sql.includes("lookup_operation"))).toBe(false);
  });

  it.each([{ fail: "ROLLBACK" }, { rollbackCommand: "COMMIT" }])(
    "cannot assert any observed outcome without rollback acknowledgement: %j", async options => {
      const h = harness(options);
      expect(await h.store.lookupOperation(tenant, "provision:one")).toMatchObject({ status: "unavailable" });
      expect(h.release).toHaveBeenCalledWith(true);
    },
  );

  it("fails closed before any query on connection failure", async () => {
    const h = harness();
    h.connect.mockRejectedValue(new Error("private credentials"));
    expect(await h.store.lookupOperation(tenant, "provision:one")).toMatchObject({ status: "unavailable" });
    expect(h.statements).toEqual([]);
  });
});
