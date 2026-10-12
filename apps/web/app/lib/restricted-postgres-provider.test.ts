import { EventEmitter } from "node:events";
import { parse } from "libpg-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const provisioningRelease = vi.hoisted(() => ({ approved: false }));
vi.mock("./employee-provisioning-release", async importOriginal => {
  const original = await importOriginal<typeof import("./employee-provisioning-release")>();
  return { employeeProvisioningRelease: () => provisioningRelease.approved
    ? { status: "approved", migrationVersion: 5 } : original.employeeProvisioningRelease() };
});
const drivers = vi.hoisted(() => ({ construct: vi.fn(), next: [] as unknown[], pools: [] as Array<{
  connect: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>;
  emit(event: string, ...args: unknown[]): boolean;
}> }));
vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Pool: class extends EventEmitter {
      connect = vi.fn(async () => {
        const next = drivers.next.shift();
        if (next instanceof Error) throw next;
        if (!next) throw new Error("Mock connection not configured.");
        return next;
      });
      end = vi.fn(async () => {});
      constructor(config: unknown) {
        super();
        drivers.construct(config);
        drivers.pools.push(this);
      }
    },
  };
});
import { beginRestrictedTransaction, createPostgresOperationReconciliationStore } from "./postgres-authorization-store";
import { createRestrictedPostgresProvider, RESTRICTED_LEASE_IDENTITY_SQL, RestrictedPostgresError,
  restrictedSourceBinding, restrictedDatabaseIdentity } from "./restricted-postgres-provider";
import { parseServerPostgresConfig, type ServerPostgresConfig } from "./postgres-server-config";
import { createServerPrincipalResolver, isAuthenticatedPrincipal } from "./server-persistence-authority";
import { createPostgresEmployeeProvisioningStore, PROVISIONING_CONTRACT_SQL } from "./postgres-employee-provisioning-store";
import { employeeProvisioningRequest } from "./employee-provisioning-contract";
import { authorityFixture } from "../../database/tests/authorization-fixtures";

const config: ServerPostgresConfig = {
  host: "db.internal", port: 5432, database: "empire_os", user: "actor_login",
  password: "PRIVATE_test_password", ssl: { rejectUnauthorized: true },
};
const subject = "user_founder";
const tenant = "tenant-a";
async function principal(actor = subject) {
  const value = await createServerPrincipalResolver(async () => ({ status: "authenticated", subject: actor }))(
    new Request("https://empire-os.invalid"),
  );
  if (!isAuthenticatedPrincipal(value)) throw new Error("Test principal unavailable.");
  return value;
}
function client(patch: Record<string, unknown> = {}) {
  const raw = new EventEmitter();
  const release = vi.fn();
  const query = vi.fn(async (sql: string, _values?: unknown[]): Promise<{
    command: string; rows: Record<string, unknown>[];
  }> => {
    if (sql === RESTRICTED_LEASE_IDENTITY_SQL) return { command: "SELECT", rows: [{
      database: config.database, login: config.user, effective: config.user, recovery: false,
      tls: true, restricted: true, standalone: true, safe_schema: true, safe_tables: true,
      bindings: [{ tenantId: tenant, subject }], ...patch,
    }] };
    return { command: sql.startsWith("BEGIN") ? "BEGIN" : sql === "COMMIT" || sql === "ROLLBACK" ? sql : "SELECT",
      rows: sql.includes("AS unsafe") ? [{ unsafe: false }] : [] };
  });
  return Object.assign(raw, { query, release });
}
async function harness(patch: Record<string, unknown> = {}) {
  const actor = await principal();
  const provider = createRestrictedPostgresProvider({ config, principal: actor, tenantId: tenant });
  const source = provider.sourceForPrincipal(actor);
  const raw = client(patch);
  drivers.next.push(raw);
  const pending = source.connect();
  const pool = drivers.pools.at(-1);
  if (!pool) throw new Error("Pool not constructed.");
  return { actor, provider, source, raw, pool, pending };
}

beforeEach(() => {
  vi.clearAllMocks();
  drivers.pools.length = 0;
  drivers.next.length = 0;
});
afterEach(() => { provisioningRelease.approved = false; vi.restoreAllMocks(); });

describe("restricted PostgreSQL provider (mocked driver, NO database/TLS handshake)", () => {
  it("parses the lease safety query offline (not execution evidence)", async () => {
    await expect(parse(RESTRICTED_LEASE_IDENTITY_SQL)).resolves.toBeDefined();
  });

  it("checks mutation privileges on views and foreign relations as well as base tables", () => {
    expect(RESTRICTED_LEASE_IDENTITY_SQL).toContain("c.relkind IN ('r','p','v','m','f')");
    expect(RESTRICTED_LEASE_IDENTITY_SQL).toContain("has_any_column_privilege(r.oid,c.oid,'INSERT')");
    expect(RESTRICTED_LEASE_IDENTITY_SQL).toContain("has_any_column_privilege(r.oid,c.oid,'UPDATE')");
    expect(RESTRICTED_LEASE_IDENTITY_SQL).toContain("has_table_privilege(r.oid,c.oid,'DELETE')");
  });
  it("creates no pool until acquisition and exposes no configuration/credentials", async () => {
    const actor = await principal();
    const provider = createRestrictedPostgresProvider({ config, principal: actor, tenantId: tenant });
    expect(drivers.construct).not.toHaveBeenCalled();
    expect(JSON.stringify(provider)).not.toContain("PRIVATE");
    await provider.dispose();
    expect(provider.status).toBe("disposed");
    expect(drivers.construct).not.toHaveBeenCalled();
  });

  it("brands only provider-owned sources with non-secret environment binding", async () => {
    const actor = await principal();
    const provider = createRestrictedPostgresProvider({ config, principal: actor, tenantId: tenant });
    const source = provider.sourceForPrincipal(actor);
    expect(restrictedSourceBinding(source)).toEqual({
      subject, tenantId: tenant, database: config.database, login: config.user,
      databaseIdentitySha256: restrictedDatabaseIdentity(config),
    });
    expect(restrictedSourceBinding({ ...source })).toBeUndefined();
    expect(Object.isFrozen(restrictedSourceBinding(source))).toBe(true);
    expect(provider.sourceForPrincipal(actor)).toBe(source);
    expect(drivers.construct).not.toHaveBeenCalled();
    const rotated = { ...config, password: "changed" };
    expect(restrictedDatabaseIdentity(rotated)).toBe(restrictedDatabaseIdentity(config));
    await provider.dispose();
  });

  it("never falls back to a shared privileged principal or other tenant", async () => {
    const actor = await principal();
    const provider = createRestrictedPostgresProvider({ config, principal: actor, tenantId: tenant });
    expect(() => provider.sourceForPrincipal({ ...actor })).toThrow(RestrictedPostgresError);
    expect(() => provider.sourceForPrincipal(actor, "tenant-b")).toThrow(RestrictedPostgresError);
    expect(() => provider.sourceForPrincipal(actor)).not.toThrow();
    expect(drivers.construct).not.toHaveBeenCalled();
    await provider.dispose();
  });

  it("rejects a different genuinely authenticated actor", async () => {
    const actor = await principal();
    const other = await principal("user_other");
    const provider = createRestrictedPostgresProvider({ config, principal: actor, tenantId: tenant });
    expect(() => provider.sourceForPrincipal(other)).toThrow(RestrictedPostgresError);
    await provider.dispose();
  });

  it("passes explicit private settings, TLS verification and bounded single-use pool policy", async () => {
    const h = await harness();
    const connection = await h.pending;
    const passed = drivers.construct.mock.calls[0][0];
    expect(passed.host).toBe(config.host);
    expect(passed.user).toBe(config.user);
    expect(passed.ssl.rejectUnauthorized).toBe(true);
    expect(passed.ssl.minVersion).toBe("TLSv1.2");
    expect(typeof passed.ssl.checkServerIdentity).toBe("function");
    expect(passed.ssl.checkServerIdentity("ignored", { subject: { CN: "foreign.invalid" } })).toBeInstanceOf(Error);
    expect(await passed.password()).toBe(config.password);
    expect(passed).not.toHaveProperty("connectionString");
    expect(passed.options).toBe("-c search_path=pg_catalog -c row_security=on");
    expect(passed.replication).toBe("false");
    expect(passed.client_encoding).toBe("UTF8");
    expect(passed.max).toBe(2);
    expect(passed.maxUses).toBe(1);
    expect(h.raw.query.mock.calls[0][0]).toBe(RESTRICTED_LEASE_IDENTITY_SQL);
    await beginRestrictedTransaction(connection);
    await connection.query("ROLLBACK");
    connection.release();
    expect(h.raw.release).toHaveBeenCalledExactlyOnceWith(true);
    await h.provider.dispose();
  });

  it.each([
    { database: "other" }, { login: "owner" }, { effective: "owner" }, { recovery: true },
    { tls: false }, { restricted: false }, { standalone: false }, { safe_schema: false }, { safe_tables: false },
    { bindings: [] }, { bindings: [{ tenantId: "tenant-b", subject }] },
    { bindings: [{ tenantId: tenant, subject: "user_other" }] },
    { bindings: [{ tenantId: tenant, subject }, { tenantId: "tenant-b", subject }] },
  ])("rejects wrong/unsafe real lease metadata %j", async patch => {
    const h = await harness(patch);
    await expect(h.pending).rejects.toMatchObject({ reason: "identity" });
    expect(h.raw.release).toHaveBeenCalledExactlyOnceWith(true);
    await h.provider.dispose();
  });

  it("sanitizes connection/TLS handshake failures without preserving driver cause or credentials", async () => {
    const actor = await principal();
    const provider = createRestrictedPostgresProvider({ config, principal: actor, tenantId: tenant });
    drivers.next.push(new Error("TLS error PRIVATE_test_password db.internal"));
    let failure: unknown;
    try { await provider.sourceForPrincipal(actor).connect(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(RestrictedPostgresError);
    expect(String(failure)).toBe("RestrictedPostgresError: Restricted PostgreSQL unavailable failure.");
    expect(JSON.stringify(failure)).not.toContain("PRIVATE");
    expect(failure).not.toHaveProperty("cause");
    await provider.dispose();
  });

  it.each([
    { ...config, host: "postgres://db.internal" },
    { ...config, port: 0 }, { ...config, user: "invalid role" },
    { ...config, password: "" },
    { ...config, ssl: { rejectUnauthorized: true as const, ca: "invalid CA" } },
  ])("rejects configuration before pool construction", async invalid => {
    const actor = await principal();
    expect(() => createRestrictedPostgresProvider({ config: invalid, principal: actor, tenantId: tenant }))
      .toThrow(RestrictedPostgresError);
    expect(drivers.construct).not.toHaveBeenCalled();
  });

  it("sanitizes malformed CA parsing and rejects TLS downgrade at runtime", async () => {
    const actor = await principal();
    const invalidCa = { ...config, ssl: { rejectUnauthorized: true as const,
      ca: "-----BEGIN CERTIFICATE-----\nnot-a-certificate\n-----END CERTIFICATE-----" } };
    expect(() => createRestrictedPostgresProvider({ config: invalidCa, principal: actor, tenantId: tenant }))
      .toThrow(RestrictedPostgresError);
    const ssl = { rejectUnauthorized: true as const };
    Object.defineProperty(ssl, "rejectUnauthorized", { value: false });
    expect(() => createRestrictedPostgresProvider({ config: { ...config, ssl }, principal: actor, tenantId: tenant }))
      .toThrow(RestrictedPostgresError);
    expect(drivers.construct).not.toHaveBeenCalled();
  });

  it("uses no generic/public environment configuration or SSL downgrade variables", () => {
    expect(parseServerPostgresConfig({
      DATABASE_URL: "PRIVATE", PGHOST: "unsafe", PGSSLMODE: "disable", NEXT_PUBLIC_DATABASE_URL: "PRIVATE",
    })).toEqual({ status: "unconfigured" });
  });

  it("requires exclusive transaction ownership and rejects use after release", async () => {
    const h = await harness();
    const connection = await h.pending;
    await expect(connection.query("SELECT 1")).rejects.toMatchObject({ reason: "lifecycle" });
    expect(h.raw.release).toHaveBeenCalledExactlyOnceWith(true);
    await expect(connection.query("BEGIN ISOLATION LEVEL READ COMMITTED")).rejects.toMatchObject({ reason: "lifecycle" });
    connection.release();
    expect(h.raw.release).toHaveBeenCalledTimes(1);
    await h.provider.dispose();
  });

  it.each(["SET ROLE owner", "SELECT 1; SET ROLE owner", "BEGIN", "INSERT INTO anything VALUES (1)"])(
    "discards unsafe or unsupported lease query %s", async sql => {
      const h = await harness();
      const connection = await h.pending;
      await beginRestrictedTransaction(connection);
      await expect(connection.query(sql)).rejects.toMatchObject({ reason: "lifecycle" });
      expect(h.raw.release).toHaveBeenCalledExactlyOnceWith(true);
      expect(h.raw.query.mock.calls.some(call => call[0] === sql)).toBe(false);
      await h.provider.dispose();
    },
  );

  it("preserves only SQLSTATE on query failure and discards after acknowledged rollback", async () => {
    const h = await harness();
    const connection = await h.pending;
    await beginRestrictedTransaction(connection);
    h.raw.query.mockRejectedValueOnce(Object.assign(new Error("PRIVATE SQL TEXT"), { code: "42501", detail: "PRIVATE" }));
    await expect(connection.query("SELECT forbidden()")).rejects.toMatchObject({ reason: "query", code: "42501" });
    await connection.query("ROLLBACK");
    connection.release();
    expect(h.raw.release).toHaveBeenCalledExactlyOnceWith(true);
    await h.provider.dispose();
  });

  it.each(["COMMIT", "ROLLBACK"])("discards a lease following uncertain %s outcome", async command => {
    const h = await harness();
    const connection = await h.pending;
    await beginRestrictedTransaction(connection);
    h.raw.query.mockRejectedValueOnce(new Error("PRIVATE transport loss"));
    await expect(connection.query(command)).rejects.toMatchObject({ reason: "query" });
    connection.release(true);
    expect(h.raw.release).toHaveBeenCalledExactlyOnceWith(true);
    await expect(connection.query("SELECT 1")).rejects.toMatchObject({ reason: "lifecycle" });
    await h.provider.dispose();
  });

  it("requires transaction acknowledgement, not merely a resolved query promise", async () => {
    const h = await harness();
    const connection = await h.pending;
    await beginRestrictedTransaction(connection);
    h.raw.query.mockResolvedValueOnce({ command: "ROLLBACK", rows: [] });
    await expect(connection.query("COMMIT")).rejects.toMatchObject({ reason: "lifecycle" });
    connection.release(true);
    expect(h.raw.release).toHaveBeenCalledExactlyOnceWith(true);
    await h.provider.dispose();
  });

  it("sanitizes lease identity query failures and never lends that physical connection", async () => {
    const actor = await principal();
    const provider = createRestrictedPostgresProvider({ config, principal: actor, tenantId: tenant });
    const raw = client();
    raw.query.mockRejectedValueOnce(new Error("PRIVATE identity details"));
    drivers.next.push(raw);
    await expect(provider.sourceForPrincipal(actor).connect()).rejects.toMatchObject({ reason: "identity" });
    expect(raw.release).toHaveBeenCalledExactlyOnceWith(true);
    await provider.dispose();
  });

  it("discards a connection that completes acquisition after disposal has started", async () => {
    const h = await harness();
    const first = await h.pending;
    first.release();
    const raw = client();
    let finish: (value: unknown) => void = () => { throw new Error("Missing barrier."); };
    h.pool.connect.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = h.source.connect();
    await h.provider.dispose();
    finish(raw);
    await expect(pending).rejects.toMatchObject({ reason: "unavailable" });
    expect(raw.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(raw.query).not.toHaveBeenCalled();
  });

  it("rejects concurrent queries on one transaction lease and invalidates the in-flight result", async () => {
    const h = await harness();
    const connection = await h.pending;
    await beginRestrictedTransaction(connection);
    let finish: (value: { command: string; rows: never[] }) => void = () => { throw new Error("No barrier."); };
    h.raw.query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = connection.query("SELECT 1");
    await expect(connection.query("SELECT 2")).rejects.toMatchObject({ reason: "lifecycle" });
    finish({ command: "SELECT", rows: [] });
    await expect(first).rejects.toMatchObject({ reason: "lifecycle" });
    expect(h.raw.release).toHaveBeenCalledExactlyOnceWith(true);
    await h.provider.dispose();
  });

  it("never reuses clean or dirty physical sessions between leases", async () => {
    const h = await harness();
    const first = await h.pending;
    await beginRestrictedTransaction(first);
    await first.query("COMMIT");
    first.release(false);
    const secondRaw = client();
    drivers.next.push(secondRaw);
    const second = await h.source.connect();
    await beginRestrictedTransaction(second);
    second.release(false); // Unfinished transaction is destroyed even without a discard request.
    expect(h.raw.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(secondRaw.release).toHaveBeenCalledExactlyOnceWith(true);
    await h.provider.dispose();
  });

  it("disposes active transactions, prevents new acquisition, and ends the pool exactly once", async () => {
    const h = await harness();
    const connection = await h.pending;
    await beginRestrictedTransaction(connection);
    const disposal = h.provider.dispose();
    expect(h.provider.dispose()).toBe(disposal);
    await disposal;
    expect(h.provider.status).toBe("disposed");
    expect(h.pool.end).toHaveBeenCalledOnce();
    expect(h.raw.release).toHaveBeenCalledExactlyOnceWith(true);
    await expect(h.source.connect()).rejects.toMatchObject({ reason: "unavailable" });
    await expect(connection.query("COMMIT")).rejects.toMatchObject({ reason: "lifecycle" });
  });

  it("fails closed when a pool error or checked-out client error occurs", async () => {
    for (const poolError of [true, false]) {
      const h = await harness();
      const connection = await h.pending;
      if (poolError) h.pool.emit("error", new Error("PRIVATE idle failure"));
      else h.raw.emit("error", new Error("PRIVATE active failure"));
      await expect(connection.query("BEGIN ISOLATION LEVEL READ COMMITTED")).rejects.toMatchObject({ reason: "lifecycle" });
      expect(h.raw.release).toHaveBeenCalledExactlyOnceWith(true);
      if (poolError) expect(h.provider.status).toBe("failed");
      await h.provider.dispose();
    }
  });

  it("sanitizes disposal failures and leaves the provider unusable", async () => {
    const h = await harness();
    const connection = await h.pending;
    connection.release();
    h.pool.end.mockRejectedValueOnce(new Error("PRIVATE shutdown failure"));
    await expect(h.provider.dispose()).rejects.toMatchObject({ reason: "disposal" });
    expect(h.provider.status).toBe("failed");
    await expect(h.source.connect()).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("sanitizes physical release failures rather than exposing driver details", async () => {
    const h = await harness();
    const connection = await h.pending;
    h.raw.release.mockImplementationOnce(() => { throw new Error("PRIVATE release detail"); });
    expect(() => connection.release()).toThrow("Restricted PostgreSQL lifecycle failure.");
    expect(h.provider.status).toBe("failed");
    await expect(h.source.connect()).rejects.toMatchObject({ reason: "unavailable" });
    await h.provider.dispose();
  });

  it("detaches connection settings from mutable caller objects before lazy acquisition", async () => {
    const actor = await principal();
    const supplied = { ...config, ssl: { ...config.ssl } };
    const provider = createRestrictedPostgresProvider({ config: supplied, principal: actor, tenantId: tenant });
    supplied.host = "changed.invalid";
    supplied.password = "changed";
    drivers.next.push(client());
    const lease = await provider.sourceForPrincipal(actor).connect();
    const passed = drivers.construct.mock.calls[0][0];
    expect(passed.host).toBe("db.internal");
    expect(await passed.password()).toBe(config.password);
    lease.release();
    await provider.dispose();
  });

  it("works through the existing reconciliation store and destroys unconfirmed rollback leases", async () => {
    const actor = await principal();
    const provider = createRestrictedPostgresProvider({ config, principal: actor, tenantId: tenant });
    const raw = client();
    raw.query.mockImplementation(async sql => {
      if (sql === RESTRICTED_LEASE_IDENTITY_SQL) return { command: "SELECT", rows: [{
        database: config.database, login: config.user, effective: config.user, recovery: false, tls: true,
        restricted: true, standalone: true, safe_schema: true, safe_tables: true,
        bindings: [{ tenantId: tenant, subject }],
      }] };
      if (sql === "ROLLBACK") throw new Error("PRIVATE connection gone");
      return { command: sql.startsWith("BEGIN") ? "BEGIN" : "SELECT", rows: [] };
    });
    drivers.next.push(raw);
    const store = createPostgresOperationReconciliationStore(provider.sourceForPrincipal(actor));
    expect(await store.lookupOperation(tenant, "operation-one")).toMatchObject({ status: "unavailable" });
    expect(raw.release).toHaveBeenCalledExactlyOnceWith(true);
    await provider.dispose();
  });

  it("preserves the provisioning adapter's UNKNOWN outcome and destroys its lease after lost COMMIT acknowledgement", async () => {
    provisioningRelease.approved = true; // Vitest substitution only; original release remains disabled.
    const actor = await principal();
    const provider = createRestrictedPostgresProvider({ config, principal: actor, tenantId: tenant });
    const raw = client();
    const defaultQuery = raw.query.getMockImplementation();
    const datasetId = "00000000-0000-4000-8000-000000000001";
    const fixture = authorityFixture(tenant, datasetId);
    const before = { ...fixture, snapshot: {
      ...fixture.snapshot, tenant: { ...fixture.snapshot.tenant, ownerSubjects: [subject] },
      memberships: fixture.snapshot.memberships.map(member => member.subject === "owner" ? { ...member, subject } : member),
    } };
    raw.query.mockImplementation(async (sql, values) => {
      if (sql === PROVISIONING_CONTRACT_SQL) return { command: "SELECT", rows: [{ ready: true }] };
      if (sql.includes("lookup_operation")) return { command: "SELECT", rows: [{
        state: before, revision: "1", actor_subject: subject, authorized: true, records: [],
      }] };
      if (sql.includes("AS now_ms")) return { command: "SELECT", rows: [{ now_ms: "1000" }] };
      if (sql.includes("FROM empire_os_authorization.provision_member")) {
        const request = JSON.parse(String(values?.[0]));
        const evidence = JSON.parse(String(values?.[1]));
        return { command: "SELECT", rows: [{
          actor_subject: subject, revision: "2", audit_evidence: evidence,
          state: { ...before, snapshot: { ...before.snapshot, revision: 2, memberships: [
            ...before.snapshot.memberships, { subject: request.command.subject, tenantId: tenant,
              revision: 1, status: "active", roleIds: request.command.roleIds },
          ] } },
        }] };
      }
      if (sql === "COMMIT") throw new Error("PRIVATE simulated network loss");
      if (!defaultQuery) throw new Error("Missing driver implementation.");
      return defaultQuery(sql, values);
    });
    drivers.next.push(raw);
    const store = createPostgresEmployeeProvisioningStore(provider.sourceForPrincipal(actor));
    expect(await store.execute(actor, employeeProvisioningRequest(tenant, {
      operationId: "provision:one", expectedPolicyRevision: 1, subject: "user_employee", roleIds: ["writer"],
    }))).toMatchObject({ status: "unavailable", outcome: "unknown" });
    expect(raw.query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(true);
    expect(raw.query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(false);
    expect(raw.release).toHaveBeenCalledExactlyOnceWith(true);
    await provider.dispose();
  });
});
