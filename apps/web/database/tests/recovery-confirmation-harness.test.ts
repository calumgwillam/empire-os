import { readFileSync } from "node:fs";
import { parse, parsePlPgSQL } from "libpg-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RECOVERY_CONFIRMATION_DISPOSABLE_MARKER,
  recoveryConfirmationDisposableConfig,
  type RecoveryConfirmationDisposableConfig,
} from "./recovery-confirmation-disposable-config";
import { prepareRecoveryConfirmationFixture } from "./recovery-confirmation-harness";

const mocks = vi.hoisted(() => ({
  construct: vi.fn(), connect: vi.fn(), query: vi.fn(), end: vi.fn(),
  realpath: vi.fn(), readFile: vi.fn(), open: vi.fn(),
  writeFile: vi.fn(), sync: vi.fn(), close: vi.fn(),
  directorySync: vi.fn(), directoryClose: vi.fn(),
  spent: false,
}));
vi.mock("pg", () => ({
  Client: class {
    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
    constructor(options: unknown) { mocks.construct(options); }
  },
}));
vi.mock("node:fs/promises", () => ({
  realpath: mocks.realpath, readFile: mocks.readFile, open: mocks.open,
}));

const candidate = readFileSync(
  new URL("../design/sql/exceptional-recovery-confirmation-candidate.sql", import.meta.url), "utf8",
);

function config(): RecoveryConfirmationDisposableConfig {
  const fixtureId = "0123456789abcdef0123456789abcdef";
  const database = `empire_os_test_recovery_${fixtureId}`;
  const configured = recoveryConfirmationDisposableConfig({
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_HOST: "127.0.0.1",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_PORT: "55440",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_DATABASE: database,
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_USER: "empire_os_recovery_fixture_owner",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_PASSWORD: "offline-only",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_FIXTURE_ID: fixtureId,
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_CLUSTER_DIRECTORY: `/private/tmp/empire-os-recovery-${fixtureId}`,
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_CLUSTER_SYSTEM_IDENTIFIER: "7560000000000000001",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_CONFIRM:
      `${database}:${RECOVERY_CONFIRMATION_DISPOSABLE_MARKER}:${fixtureId}`,
  });
  if (configured.status !== "configured") throw new Error("Offline fixture config missing.");
  return configured.config;
}

function identity(value = config()) {
  return {
    database: value.database, principal: value.user, login: value.user,
    marker: `${value.database}:${RECOVERY_CONFIRMATION_DISPOSABLE_MARKER}:${value.fixtureId}`,
    recovery: false, superuser: true, server_address: value.host, server_port: value.port,
    cluster_directory: value.clusterDirectory, system_identifier: value.clusterSystemIdentifier,
    version: "160013", isolated_databases: true, isolated_roles: true, exclusive_session: true,
  };
}

const emptyCounts = {
  schemas: "0", relations: "0", functions: "0", types: "0", schema_objects: "0",
  extensions: "0", large_objects: "0", publications: "0", subscriptions: "0", event_triggers: "0",
  foreign_wrappers: "0", foreign_servers: "0", replication_origins: "0", languages: "0",
  default_acls: "0", role_settings: "0",
  casts: "0", transforms: "0", access_methods: "0", parameter_acls: "0",
  replication_slots: "0", prepared_transactions: "0",
};

function statements(): string[] {
  return mocks.query.mock.calls.map(([sql]) => String(sql));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.spent = false;
  mocks.realpath.mockImplementation(async (path: string) => path);
  mocks.readFile.mockImplementation(async (path: string | URL) =>
    String(path).endsWith("PG_VERSION") ? "16\n" : candidate);
  mocks.open.mockImplementation(async (_path: string, flags: string) => {
    if (flags === "wx") {
      if (mocks.spent) throw Object.assign(new Error("Spent file already exists."), { code: "EEXIST" });
      mocks.spent = true;
      return { writeFile: mocks.writeFile, sync: mocks.sync, close: mocks.close };
    }
    if (flags !== "r") throw new Error("Unexpected filesystem access.");
    return { sync: mocks.directorySync, close: mocks.directoryClose };
  });
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("pg_control_system()")) return { command: "SELECT", rows: [identity()] };
    if (sql.includes("pg_try_advisory_lock")) return { command: "SELECT", rows: [{ acquired: true }] };
    if (sql.startsWith("COMMENT ON DATABASE")) return { command: "COMMENT", rows: [] };
    if (sql.includes("AS schema_objects")) return { command: "SELECT", rows: [{ ...emptyCounts }] };
    if (sql === candidate) return [{ command: "BEGIN" }, { command: "COMMIT" }];
    throw new Error("Unexpected query; offline mock refuses execution.");
  });
});

describe("Recovery fixture harness (mocked filesystem and driver; no PostgreSQL execution)", () => {
  it("claims the durable local guard, verifies identity around the session lock, and spends before candidate setup", async () => {
    const value = config();
    const admin = await prepareRecoveryConfirmationFixture(value);
    expect(mocks.open).toHaveBeenCalledWith(`${value.clusterDirectory}/.recovery-confirmation-spent`, "wx", 0o600);
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.directorySync).toHaveBeenCalledOnce();
    expect(mocks.directorySync.mock.invocationCallOrder[0]).toBeLessThan(mocks.connect.mock.invocationCallOrder[0]);
    const sql = statements();
    expect(sql[0]).toContain("pg_control_system()");
    expect(sql[1]).toBe("SELECT pg_try_advisory_lock(172914, 30) AS acquired");
    expect(sql[2]).toBe(sql[0]);
    expect(sql[3]).toContain(`${value.fixtureId}:spent'`);
    expect(sql[4]).toContain("AS schema_objects");
    expect(sql[5]).toBe(candidate);
    expect(mocks.end).not.toHaveBeenCalled();
    expect(sql.join("\n")).not.toContain("pg_advisory_unlock");
    await admin.end();
  });

  it("pins credentials, startup options and all setup timeouts without environment fallback", async () => {
    const value = config();
    const admin = await prepareRecoveryConfirmationFixture(value);
    const options = mocks.construct.mock.calls[0][0];
    expect(options).toMatchObject({
      host: "127.0.0.1", port: 55440, database: value.database, user: value.user,
      ssl: false, replication: "false", connectionTimeoutMillis: 5000,
      statement_timeout: 10000, query_timeout: 12000, lock_timeout: 5000,
      idle_in_transaction_session_timeout: 15000,
      options: "-c search_path=pg_catalog -c row_security=on -c synchronous_commit=on",
    });
    expect(await options.password()).toBe(value.password);
    expect(options).not.toHaveProperty("connectionString");
    await admin.end();
  });

  it("refuses forged configurations, symlinked directories and wrong local cluster versions before connecting", async () => {
    const value = config();
    await expect(prepareRecoveryConfirmationFixture({ ...value })).rejects.toThrow("unchanged validated");
    mocks.realpath.mockResolvedValueOnce("/private/tmp/historical-cluster");
    await expect(prepareRecoveryConfirmationFixture(value)).rejects.toThrow("canonical");
    mocks.readFile.mockResolvedValueOnce("17\n");
    await expect(prepareRecoveryConfirmationFixture(value)).rejects.toThrow("PostgreSQL 16");
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.construct).not.toHaveBeenCalled();
  });

  it("never connects if recording or syncing the spent guard fails", async () => {
    mocks.sync.mockRejectedValueOnce(new Error("Unable to persist spent guard."));
    await expect(prepareRecoveryConfirmationFixture(config())).rejects.toThrow("persist spent guard");
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.construct).not.toHaveBeenCalled();
    await expect(prepareRecoveryConfirmationFixture(config())).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("keeps a connection failure spent and refuses another attempt before contacting PostgreSQL", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("Connection outcome unknown."));
    await expect(prepareRecoveryConfirmationFixture(config())).rejects.toThrow("fixture is spent");
    await expect(prepareRecoveryConfirmationFixture(config())).rejects.toMatchObject({ code: "EEXIST" });
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("allows only one competing local runner to reach setup and never reuses a successful fixture", async () => {
    const results = await Promise.allSettled([
      prepareRecoveryConfirmationFixture(config()),
      prepareRecoveryConfirmationFixture(config()),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(statements().filter(sql => sql === candidate)).toHaveLength(1);
    for (const result of results) if (result.status === "fulfilled") await result.value.end();
    await expect(prepareRecoveryConfirmationFixture(config())).rejects.toMatchObject({ code: "EEXIST" });
    expect(mocks.connect).toHaveBeenCalledOnce();
  });

  it("fails closed before connecting when syncing the spent directory is uncertain", async () => {
    mocks.directorySync.mockRejectedValueOnce(new Error("Directory sync uncertain."));
    await expect(prepareRecoveryConfirmationFixture(config())).rejects.toThrow("Directory sync uncertain");
    expect(mocks.spent).toBe(true);
    expect(mocks.directoryClose).toHaveBeenCalledOnce();
    expect(mocks.construct).not.toHaveBeenCalled();
  });

  it.each([
    { acquired: false }, { acquired: "true" }, {},
  ])("refuses unavailable or ambiguous advisory-lock acknowledgement: %j", async (row) => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_control_system()")) return { rows: [identity()] };
      if (sql.includes("pg_try_advisory_lock")) return { rows: [row] };
      throw new Error("No setup writes allowed.");
    });
    await expect(prepareRecoveryConfirmationFixture(config())).rejects.toThrow("fixture is spent");
    expect(statements().some(sql => sql.startsWith("COMMENT"))).toBe(false);
    expect(statements()).not.toContain(candidate);
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("rechecks the fresh database marker after acquiring the lock", async () => {
    let checks = 0;
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_control_system()")) {
        checks += 1;
        const row = identity();
        return { rows: [{ ...row, marker: checks === 1 ? row.marker : `${row.marker}:spent` }] };
      }
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      throw new Error("No setup writes allowed.");
    });
    await expect(prepareRecoveryConfirmationFixture(config())).rejects.toThrow("fixture is spent");
    expect(checks).toBe(2);
    expect(statements().some(sql => sql.startsWith("COMMENT"))).toBe(false);
  });

  it.each(Object.keys(emptyCounts))("refuses unexpected objects/settings (%s) before candidate SQL", async (field) => {
    const original = mocks.query.getMockImplementation();
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("AS schema_objects")) return { rows: [{ ...emptyCounts, [field]: "1" }] };
      if (!original) throw new Error("Offline query mock missing.");
      return original(sql);
    });
    await expect(prepareRecoveryConfirmationFixture(config())).rejects.toThrow("fixture is spent");
    expect(statements().some(sql => sql.includes(":spent'"))).toBe(true);
    expect(statements()).not.toContain(candidate);
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it.each([
    { rows: [] }, { rows: [{}] }, { rows: [{ ...emptyCounts }, { ...emptyCounts }] },
  ])(
    "refuses missing or ambiguous catalog results", async ({ rows }) => {
      const original = mocks.query.getMockImplementation();
      mocks.query.mockImplementation(async (sql: string) => {
        if (sql.includes("AS schema_objects")) return { rows };
        if (!original) throw new Error("Offline query mock missing.");
        return original(sql);
      });
      await expect(prepareRecoveryConfirmationFixture(config())).rejects.toThrow("fixture is spent");
      expect(statements()).not.toContain(candidate);
    },
  );

  it("parses catalog, lock and claim SQL offline and retains broad catalog coverage", async () => {
    const admin = await prepareRecoveryConfirmationFixture(config());
    for (const sql of statements()) await expect(parse(sql)).resolves.toBeDefined();
    await expect(parsePlPgSQL(candidate)).resolves.toBeDefined();
    const inventory = statements().find(sql => sql.includes("AS schema_objects"));
    for (const catalog of [
      "pg_class", "pg_proc", "pg_type", "pg_depend", "pg_extension", "pg_largeobject_metadata",
      "pg_publication", "pg_subscription", "pg_event_trigger", "pg_foreign_data_wrapper",
      "pg_foreign_server", "pg_replication_origin", "pg_language", "pg_default_acl", "pg_db_role_setting",
      "pg_cast", "pg_transform", "pg_am", "pg_parameter_acl", "pg_replication_slots", "pg_prepared_xacts",
    ]) expect(inventory).toContain(catalog);
    expect(inventory).toContain("c.oid>=16384");
    await admin.end();
  });

  it.each(["claim", "candidate"])("retains spent state after a lost %s acknowledgement", async (stage) => {
    const original = mocks.query.getMockImplementation();
    mocks.query.mockImplementation(async (sql: string) => {
      if ((stage === "claim" && sql.startsWith("COMMENT")) || (stage === "candidate" && sql === candidate)) {
        throw new Error("Acknowledgement lost.");
      }
      if (!original) throw new Error("Offline query mock missing.");
      return original(sql);
    });
    await expect(prepareRecoveryConfirmationFixture(config())).rejects.toThrow("fixture is spent");
    expect(mocks.end).toHaveBeenCalledOnce();
    await expect(prepareRecoveryConfirmationFixture(config())).rejects.toMatchObject({ code: "EEXIST" });
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(statements().some(sql => /^(?:DROP|DELETE|ROLLBACK|CREATE DATABASE)/.test(sql))).toBe(false);
  });

  it.each(["claim", "candidate"])("rejects a resolved but invalid %s acknowledgement", async (stage) => {
    const original = mocks.query.getMockImplementation();
    mocks.query.mockImplementation(async (sql: string) => {
      if (stage === "claim" && sql.startsWith("COMMENT")) return { command: "SELECT", rows: [] };
      if (stage === "candidate" && sql === candidate) return [{ command: "BEGIN" }, { command: "ROLLBACK" }];
      if (!original) throw new Error("Offline query mock missing.");
      return original(sql);
    });
    await expect(prepareRecoveryConfirmationFixture(config())).rejects.toThrow("fixture is spent");
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(mocks.spent).toBe(true);
  });

  it("stops before locking or writes when the connected server is a different cluster", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ ...identity(), system_identifier: "7560000000000000002" }] });
    await expect(prepareRecoveryConfirmationFixture(config())).rejects.toThrow("fixture is spent");
    expect(statements()).toHaveLength(1);
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("reports uncertain connection disposal without attempting cleanup", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("Connection lost."));
    mocks.end.mockRejectedValueOnce(new Error("Disposal uncertain."));
    await expect(prepareRecoveryConfirmationFixture(config())).rejects.toThrow("setup and connection disposal failed");
    expect(mocks.spent).toBe(true);
    expect(statements()).toEqual([]);
  });
});
