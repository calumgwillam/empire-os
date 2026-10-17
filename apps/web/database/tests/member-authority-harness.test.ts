import { endianness } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "libpg-query";
import { DISPOSABLE_MARKER } from "./disposable-config";
import { MEMBER_CONSUMED_MARKER, memberAuthorityDisposableConfig } from "./member-authority-disposable-config";

const fake = vi.hoisted(() => ({
  readFile: vi.fn(),
  realpath: vi.fn(),
  connect: vi.fn(),
  migrate: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  kill: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ readFile: fake.readFile, realpath: fake.realpath }));
vi.mock("node:process", () => ({ kill: fake.kill }));
vi.mock("./postgres-harness", () => ({
  connectDisposable: fake.connect,
  migrateEmptyAuthorizationDisposable: fake.migrate,
}));
vi.mock("pg", () => ({
  Client: vi.fn(function () { throw new Error("Offline harness tests cannot open clients."); }),
}));
import { Client } from "pg";
import { createMemberAuthorityHarness, MEMBER_BLOCKING_SQL, MEMBER_CLUSTER_IDENTITY_SQL, waitForMemberBlock } from "./member-authority-harness";

const runId = "b".repeat(32);
const database = `empire_os_test_member_${runId}`;
const admin = { query: fake.query, end: fake.end };
function config() {
  const result = memberAuthorityDisposableConfig({
    EMPIRE_OS_MEMBER_TEST_PG_HOST: "127.0.0.1", EMPIRE_OS_MEMBER_TEST_PG_PORT: "6543",
    EMPIRE_OS_MEMBER_TEST_PG_DATABASE: database, EMPIRE_OS_MEMBER_TEST_PG_USER: "test_owner",
    EMPIRE_OS_MEMBER_TEST_PG_CONFIRM: `${database}:${DISPOSABLE_MARKER}`,
    EMPIRE_OS_MEMBER_TEST_PG_IDENTITY_MANIFEST_FILE: "/independent/identity.json",
  });
  if (result.status !== "configured") throw new Error("Expected offline configuration.");
  return result.config;
}
const startedAt = Math.floor(Date.now() / 1000) - 2;
function manifest(change: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1, purpose: "empire-os-member-authority-pg16", runId, host: "127.0.0.1", port: 6543, database,
    databaseOid: "16384", owner: "test_owner", systemIdentifier: "123456789",
    dataDirectory: "/independent/pgdata", postmasterPid: 1234, postmasterStartedAtSeconds: startedAt,
    clusterCreatedAtMs: startedAt * 1000 - 1000, databaseCreatedAtMs: startedAt * 1000 + 1000,
    isolatedNewCluster: true, neverPreviouslyAttempted: true,
    ...change,
  });
}
function liveIdentity(change: Record<string, unknown> = {}) {
  return {
    database, database_oid: "16384", owner: "test_owner", principal: "test_owner", session_principal: "test_owner",
    system_identifier: "123456789", version: "160006", recovery: false, read_only: "off",
    superuser: true, clean_cluster: true, marker: DISPOSABLE_MARKER,
    data_directory: "/independent/pgdata", server_port: 6543, server_address: "127.0.0.1",
    postmaster_started_at: String(startedAt),
    ...change,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  fake.end.mockResolvedValue(undefined);
  fake.kill.mockReturnValue(true);
  fake.realpath.mockImplementation(async (path: string) => path);
  fake.connect.mockResolvedValue(admin);
  fake.query.mockImplementation(async (sql: string) => sql === MEMBER_CLUSTER_IDENTITY_SQL
    ? { rows: [liveIdentity()], command: "SELECT" } : { rows: [], command: "COMMENT" });
  fake.readFile.mockImplementation(async (path: string | URL) => {
    if (path === "/independent/identity.json") return manifest();
    if (path === "/independent/pgdata/PG_VERSION") return "16\n";
    if (path === "/independent/pgdata/postmaster.pid") return `1234\n/independent/pgdata\n${startedAt}\n6543\n/tmp\n127.0.0.1\n0 0\nready\n`;
    if (path === "/independent/pgdata/global/pg_control") {
      const control = Buffer.alloc(8192);
      if (endianness() === "LE") control.writeBigUInt64LE(BigInt(123456789));
      else control.writeBigUInt64BE(BigInt(123456789));
      return control;
    }
    if (path instanceof URL && path.pathname.endsWith("contribution-identity-persistence-candidate.sql")) return "identity candidate";
    if (path instanceof URL && path.pathname.endsWith("member-authority-candidate.sql")) return "member candidate";
    throw new Error("Unexpected offline file read.");
  });
  fake.migrate.mockImplementation(async (client: typeof admin, consume: (client: typeof admin) => Promise<void>) => {
    await consume(client);
    await client.query("001-through-004");
  });
});

describe("member harness sequencing (offline substituted I/O, not a PostgreSQL verification)", () => {
  it("parses fixed preflight and blocking SQL offline", async () => {
    await expect(parse(MEMBER_CLUSTER_IDENTITY_SQL)).resolves.toBeDefined();
    await expect(parse(MEMBER_BLOCKING_SQL)).resolves.toBeDefined();
  });
  it("selects a bare server host rather than inet-to-text network notation", () => {
    expect(MEMBER_CLUSTER_IDENTITY_SQL).toContain("host(inet_server_addr()) AS server_address");
    expect(MEMBER_CLUSTER_IDENTITY_SQL).not.toContain("inet_server_addr()::text");
  });
  it("reproduces rejection of the old inet-to-text result before migrations", async () => {
    fake.query.mockResolvedValue({
      rows: [liveIdentity({ version: "160011", server_address: "127.0.0.1/32" })], command: "SELECT",
    });
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow("identity verification failed");
    expect(fake.migrate).not.toHaveBeenCalled();
    expect(fake.query.mock.calls.every(([sql]) => sql === MEMBER_CLUSTER_IDENTITY_SQL)).toBe(true);
  });
  it("accepts PostgreSQL 16.11 with a bare host from the corrected SELECT", async () => {
    fake.query.mockResolvedValue({ rows: [liveIdentity({ version: "160011" })], command: "SELECT" });
    const h = await createMemberAuthorityHarness(config());
    expect(fake.migrate).toHaveBeenCalledTimes(1);
    await h.close();
    expect(Client).not.toHaveBeenCalled();
  });
  it("requires both the exact blocking PID edge and an ungranted database lock", async () => {
    fake.query.mockResolvedValueOnce({ rows: [{ blocked: true, waiting: false }] })
      .mockResolvedValueOnce({ rows: [{ blocked: false, waiting: true }] })
      .mockResolvedValueOnce({ rows: [{ blocked: true, waiting: true }] });
    await waitForMemberBlock(admin, 101, 202);
    expect(fake.query.mock.calls).toEqual([
      [MEMBER_BLOCKING_SQL, [101, 202]], [MEMBER_BLOCKING_SQL, [101, 202]], [MEMBER_BLOCKING_SQL, [101, 202]],
    ]);
  });
  it("rejects missing independent verification before connecting", async () => {
    fake.readFile.mockRejectedValue(new Error("Missing manifest."));
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow();
    expect(fake.connect).not.toHaveBeenCalled();
    expect(fake.query).not.toHaveBeenCalled();
  });
  it("rejects invalid manifests before connecting", async () => {
    fake.readFile.mockResolvedValue("{}");
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow();
    expect(fake.connect).not.toHaveBeenCalled();
  });
  it("accepts an independently recorded restart before the first migration attempt", async () => {
    const original = fake.readFile.getMockImplementation();
    fake.readFile.mockImplementation(async (path: string | URL) => path === "/independent/identity.json"
      ? manifest({ clusterCreatedAtMs: (startedAt - 20) * 1000, databaseCreatedAtMs: (startedAt - 10) * 1000 })
      : original?.(path));
    const h = await createMemberAuthorityHarness(config());
    expect(fake.kill.mock.calls).toEqual([[1234, 0], [1234, 0]]);
    expect(fake.migrate).toHaveBeenCalledTimes(1);
    await h.close();
    expect(Client).not.toHaveBeenCalled();
  });
  it.each([
    { systemIdentifier: "987654321" }, { dataDirectory: "/forged/pgdata" },
    { postmasterPid: 5678 }, { postmasterStartedAtSeconds: startedAt + 1 },
    { clusterCreatedAtMs: (startedAt + 1) * 1000 }, { databaseCreatedAtMs: Date.now() + 60000 },
    { neverPreviouslyAttempted: false },
  ])("rejects forged manifests independently of SQL: %j", async change => {
    const original = fake.readFile.getMockImplementation();
    fake.readFile.mockImplementation(async (path: string | URL) => path === "/independent/identity.json"
      ? manifest(change) : original?.(path));
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow();
    expect(fake.connect).not.toHaveBeenCalled();
    expect(fake.query).not.toHaveBeenCalled();
    expect(fake.migrate).not.toHaveBeenCalled();
  });
  it.each(["ESRCH", "EPERM"])("fails closed on a stale or inaccessible live PID: %s", async code => {
    fake.kill.mockImplementation(() => { throw Object.assign(new Error("PID verification failed."), { code }); });
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow("PID verification failed.");
    expect(fake.kill).toHaveBeenCalledWith(1234, 0);
    expect(fake.connect).not.toHaveBeenCalled();
  });
  it.each(["PG_VERSION", "postmaster.pid", "global/pg_control"])("fails closed on missing local %s", async file => {
    const original = fake.readFile.getMockImplementation();
    fake.readFile.mockImplementation(async (path: string | URL) => {
      if (path === `/independent/pgdata/${file}`) throw new Error("Missing local identity.");
      return original?.(path);
    });
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow();
    expect(fake.connect).not.toHaveBeenCalled();
  });
  it.each([
    ["PG_VERSION", "15\n"],
    ["postmaster.pid", `999\n/independent/pgdata\n${startedAt}\n6543\n/tmp\n127.0.0.1\n0 0\nready\n`],
    ["postmaster.pid", `1234\n/other/pgdata\n${startedAt}\n6543\n/tmp\n127.0.0.1\n0 0\nready\n`],
    ["postmaster.pid", `1234\n/independent/pgdata\n${startedAt + 1}\n6543\n/tmp\n127.0.0.1\n0 0\nready\n`],
    ["postmaster.pid", `1234\n/independent/pgdata\n${startedAt}\n5432\n/tmp\n127.0.0.1\n0 0\nready\n`],
    ["postmaster.pid", `1234\n/independent/pgdata\n${startedAt}\n6543\n/tmp\n127.0.0.1\n0 0\nstarting\n`],
    ["global/pg_control", Buffer.alloc(8192)],
    ["global/pg_control", Buffer.alloc(0)],
  ])("rejects mismatched local %s before connecting", async (file, content) => {
    const original = fake.readFile.getMockImplementation();
    fake.readFile.mockImplementation(async (path: string | URL) => path === `/independent/pgdata/${file}` ? content : original?.(path));
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow();
    expect(fake.connect).not.toHaveBeenCalled();
  });
  it("rejects symlinked or noncanonical directories before connecting", async () => {
    fake.realpath.mockResolvedValue("/existing/data");
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow();
    expect(fake.connect).not.toHaveBeenCalled();
  });
  it.each([
    { database_oid: "16385" }, { owner: "other" }, { system_identifier: "999" }, { version: "150006" },
    { recovery: true }, { clean_cluster: false }, { marker: MEMBER_CONSUMED_MARKER },
    { data_directory: "/other/data" }, { server_port: 5432 }, { postmaster_started_at: String(startedAt + 1) },
  ])("refuses mismatched/occupied cluster before migrations: %j", async change => {
    fake.query.mockResolvedValue({ rows: [liveIdentity(change)], command: "SELECT" });
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow();
    expect(fake.migrate).not.toHaveBeenCalled();
    expect(fake.query.mock.calls.every(([sql]) => sql === MEMBER_CLUSTER_IDENTITY_SQL)).toBe(true);
    expect(fake.end).toHaveBeenCalledTimes(1);
  });
  it("retains existing empty-database guards and does not consume an occupied database", async () => {
    fake.migrate.mockRejectedValue(new Error("Test database is not empty."));
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow("not empty");
    expect(fake.query.mock.calls.some(([sql]) => sql.startsWith("COMMENT"))).toBe(false);
    expect(fake.end).toHaveBeenCalledTimes(1);
  });
  it("rechecks the identity inside the existing empty-guard callback", async () => {
    fake.query.mockResolvedValueOnce({ rows: [liveIdentity()], command: "SELECT" })
      .mockResolvedValueOnce({ rows: [liveIdentity({ owner: "changed" })], command: "SELECT" });
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow();
    expect(fake.query.mock.calls.some(([sql]) => sql.startsWith("COMMENT"))).toBe(false);
  });
  it("does not consume if the postmaster exits between preflight and migration", async () => {
    fake.kill.mockReturnValueOnce(true).mockImplementationOnce(() => { throw new Error("Postmaster exited."); });
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow("Postmaster exited.");
    expect(fake.query.mock.calls.some(([sql]) => sql.startsWith("COMMENT"))).toBe(false);
    expect(fake.end).toHaveBeenCalledTimes(1);
  });
  it("does not use a SQL startup timestamp to repair a mismatched independent identity", async () => {
    fake.query.mockResolvedValue({ rows: [liveIdentity({ postmaster_started_at: String(startedAt + 1) })], command: "SELECT" });
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow();
    expect(fake.migrate).not.toHaveBeenCalled();
    expect(fake.query.mock.calls.some(([sql]) => sql.startsWith("COMMENT"))).toBe(false);
  });
  it("rejects a consumed database after restart even with an unconsumed manifest", async () => {
    const original = fake.readFile.getMockImplementation();
    fake.readFile.mockImplementation(async (path: string | URL) => path === "/independent/identity.json"
      ? manifest({ databaseCreatedAtMs: (startedAt - 1) * 1000, clusterCreatedAtMs: (startedAt - 2) * 1000 })
      : original?.(path));
    fake.query.mockResolvedValue({ rows: [liveIdentity({ marker: MEMBER_CONSUMED_MARKER })], command: "SELECT" });
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow();
    expect(fake.migrate).not.toHaveBeenCalled();
    expect(fake.query.mock.calls.every(([sql]) => sql === MEMBER_CLUSTER_IDENTITY_SQL)).toBe(true);
  });
  it("records consumption before migrations and applies exactly the candidate chain", async () => {
    const h = await createMemberAuthorityHarness(config());
    const sql = fake.query.mock.calls.map(([text]) => text);
    expect(sql).toEqual([
      MEMBER_CLUSTER_IDENTITY_SQL, MEMBER_CLUSTER_IDENTITY_SQL,
      `COMMENT ON DATABASE "${database}" IS '${MEMBER_CONSUMED_MARKER}'`,
      "001-through-004", "identity candidate", "member candidate",
    ]);
    expect(fake.connect).toHaveBeenCalledTimes(1);
    await h.close();
    expect(fake.end).toHaveBeenCalledTimes(1);
    expect(Client).not.toHaveBeenCalled();
  });
  it("preserves consumption after a first migration failure, without reset or repair", async () => {
    fake.migrate.mockImplementation(async (client: typeof admin, consume: (client: typeof admin) => Promise<void>) => {
      await consume(client);
      throw new Error("First migration failed.");
    });
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow("First migration failed.");
    expect(fake.query.mock.calls.some(([sql]) => sql.includes(MEMBER_CONSUMED_MARKER))).toBe(true);
    expect(fake.query.mock.calls.some(([sql]) => /\bDROP\b|CREATE DATABASE|TRUNCATE/.test(sql))).toBe(false);
    expect(fake.migrate).toHaveBeenCalledTimes(1);
  });
  it("rolls back failed candidate application and closes every owned connection", async () => {
    fake.query.mockImplementation(async (sql: string) => {
      if (sql === "member candidate") throw new Error("Candidate failed.");
      return sql === MEMBER_CLUSTER_IDENTITY_SQL
        ? { rows: [liveIdentity()], command: "SELECT" } : { rows: [], command: "ROLLBACK" };
    });
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow("Candidate failed.");
    expect(fake.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(fake.end).toHaveBeenCalledTimes(1);
  });
  it("surfaces cleanup failures instead of reporting success", async () => {
    fake.end.mockRejectedValue(new Error("Disposal failed."));
    const h = await createMemberAuthorityHarness(config());
    await expect(h.close()).rejects.toThrow("cleanup failed");
  });
});
