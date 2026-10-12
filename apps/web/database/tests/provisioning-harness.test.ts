import { beforeEach, describe, expect, it, vi } from "vitest";
import { DISPOSABLE_MARKER, type DisposableConfig } from "./disposable-config";
import { connectDisposable, migrateEmptyProvisioningDisposable } from "./postgres-harness";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
}));
vi.mock("pg", () => ({
  Client: class {
    query = mocks.query;
    connect = mocks.connect;
    end = mocks.end;
  },
}));

const config: DisposableConfig = {
  host: "127.0.0.1", port: 55432, database: "empire_os_test_harness_offline",
  user: "test_owner", password: "offline-only",
  application_name: "empire-os-disposable-integration", connectionTimeoutMillis: 5000,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("shobj_description")) return { rows: [{
      database: config.database, principal: config.user, marker: DISPOSABLE_MARKER, recovery: false,
    }] };
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
    if (sql.includes("AS count")) return { rows: [{ count: "0" }] };
    return { rows: [], command: "OK" };
  });
});

describe("Provisioning disposable harness (offline mocks, no PostgreSQL execution)", () => {
  it("refuses any candidate setup when public functions, types or extensions make the database non-empty", async () => {
    const client = await connectDisposable(config);
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (sql.includes("FROM pg_namespace WHERE")) return { rows: [{ count: "0" }] };
      if (sql.includes("FROM pg_proc")) return { rows: [{ count: "1" }] };
      throw new Error("A migration must never be submitted.");
    });
    await expect(migrateEmptyProvisioningDisposable(client)).rejects.toThrow("not empty");
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("CREATE SCHEMA"))).toBe(false);
  });

  it("installs the two candidate halves in one transaction, without migration 005", async () => {
    const client = await connectDisposable(config);
    await migrateEmptyProvisioningDisposable(client);
    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    const start = statements.indexOf("BEGIN");
    expect(start).toBeGreaterThan(-1);
    expect(statements[start + 1]).toContain("audit_provisioning_evidence_check");
    expect(statements[start + 2]).toContain("CREATE FUNCTION empire_os_authorization.provision_member(");
    expect(statements[start + 1]).not.toMatch(/^COMMIT;$/m);
    expect(statements[start + 2]).not.toMatch(/^BEGIN;$/m);
    expect(statements[start + 3]).toBe("COMMIT");
    expect(statements.join("\n")).not.toContain("Employee provisioning migration is incomplete and disabled");
  });

  it("rolls back a failed operation definition instead of committing a partial audit upgrade", async () => {
    const client = await connectDisposable(config);
    const defaultQuery = mocks.query.getMockImplementation();
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("CREATE FUNCTION empire_os_authorization.provision_member(")) {
        throw new Error("Candidate definition rejected.");
      }
      if (!defaultQuery) throw new Error("Offline query mock missing.");
      return defaultQuery(sql);
    });
    await expect(migrateEmptyProvisioningDisposable(client)).rejects.toThrow("Candidate definition rejected.");
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
});
