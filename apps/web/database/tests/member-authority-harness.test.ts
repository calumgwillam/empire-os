import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "libpg-query";
import { DISPOSABLE_MARKER } from "./disposable-config";
import { MEMBER_CONSUMED_MARKER, memberAuthorityDisposableConfig } from "./member-authority-disposable-config";

const fake = vi.hoisted(() => ({
  readFile: vi.fn(),
  connect: vi.fn(),
  migrate: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ readFile: fake.readFile }));
vi.mock("./postgres-harness", () => ({
  connectDisposable: fake.connect,
  migrateEmptyAuthorizationDisposable: fake.migrate,
}));
vi.mock("pg", () => ({
  Client: vi.fn(function () { throw new Error("Offline harness tests cannot open clients."); }),
}));
import { Client } from "pg";
import { createMemberAuthorityHarness, MEMBER_BLOCKING_SQL, MEMBER_CLUSTER_IDENTITY_SQL, waitForMemberBlock } from "./member-authority-harness";

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
const runId = "b".repeat(32);
const database = `empire_os_test_member_${runId}`;
const admin = { query: fake.query, end: fake.end };
function config() {
  const result = memberAuthorityDisposableConfig({
    EMPIRE_OS_MEMBER_TEST_PG_HOST: "127.0.0.1", EMPIRE_OS_MEMBER_TEST_PG_PORT: "6543",
    EMPIRE_OS_MEMBER_TEST_PG_DATABASE: database, EMPIRE_OS_MEMBER_TEST_PG_USER: "test_owner",
    EMPIRE_OS_MEMBER_TEST_PG_CONFIRM: `${database}:${DISPOSABLE_MARKER}`,
    EMPIRE_OS_MEMBER_TEST_PG_ATTESTATION_FILE: "/independent/receipt.json",
    EMPIRE_OS_MEMBER_TEST_PG_ATTESTOR_PUBLIC_KEY_FILE: "/reviewer/public-key.pem",
  });
  if (result.status !== "configured") throw new Error("Expected offline configuration.");
  return result.config;
}
function envelope() {
  const payload = JSON.stringify({
    version: 1, purpose: "empire-os-member-authority-pg16", runId, host: "127.0.0.1", port: 6543, database,
    databaseOid: "16384", owner: "test_owner", systemIdentifier: "123456789",
    clusterCreatedAtMs: Date.now() - 2000, databaseCreatedAtMs: Date.now() - 1000,
    isolatedNewCluster: true, neverPreviouslyAttempted: true,
  });
  return JSON.stringify({ payload, signature: sign(null, Buffer.from(payload), keys.privateKey).toString("base64") });
}
function liveIdentity(change: Record<string, unknown> = {}) {
  return {
    database, database_oid: "16384", owner: "test_owner", principal: "test_owner", session_principal: "test_owner",
    system_identifier: "123456789", version: "160006", recovery: false, read_only: "off",
    superuser: true, clean_cluster: true, marker: DISPOSABLE_MARKER, ...change,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  fake.end.mockResolvedValue(undefined);
  fake.connect.mockResolvedValue(admin);
  fake.query.mockImplementation(async (sql: string) => sql === MEMBER_CLUSTER_IDENTITY_SQL
    ? { rows: [liveIdentity()], command: "SELECT" } : { rows: [], command: "COMMENT" });
  fake.readFile.mockImplementation(async (path: string | URL) => {
    if (path === "/independent/receipt.json") return envelope();
    if (path === "/reviewer/public-key.pem") return publicKey;
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
    fake.readFile.mockRejectedValue(new Error("Missing receipt."));
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow();
    expect(fake.connect).not.toHaveBeenCalled();
    expect(fake.query).not.toHaveBeenCalled();
  });
  it("rejects invalid signatures before connecting", async () => {
    fake.readFile.mockImplementation(async (path: string) => path.endsWith(".json")
      ? JSON.stringify({ payload: "{}", signature: "a".repeat(86) + "==" }) : publicKey);
    await expect(createMemberAuthorityHarness(config())).rejects.toThrow();
    expect(fake.connect).not.toHaveBeenCalled();
  });
  it.each([
    { owner: "other" }, { system_identifier: "999" }, { version: "150006" },
    { recovery: true }, { clean_cluster: false }, { marker: MEMBER_CONSUMED_MARKER },
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
