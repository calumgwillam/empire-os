import { readFileSync } from "node:fs";
import { parse, parsePlPgSQL } from "libpg-query";
import { describe, expect, it } from "vitest";
import { identityPersistenceDisposableConfig } from "./identity-persistence-disposable-config";
import { DISPOSABLE_MARKER } from "./disposable-config";

const sql = readFileSync(new URL("../design/sql/contribution-identity-persistence-candidate.sql", import.meta.url), "utf8");
describe("identity persistence candidate (offline only)", () => {
  it("parses SQL and PL/pgSQL without any database connection", async () => {
    await expect(parse(sql)).resolves.toBeDefined();
    await expect(parsePlPgSQL(sql)).resolves.toBeDefined();
  });
  it("has no grants or production activation and retains row security", () => {
    expect(sql).not.toMatch(/^\s*GRANT\b/im);
    expect(sql).toContain("DESIGN CANDIDATE ONLY");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON ALL FUNCTIONS");
    expect(sql).toContain("trusted_statement");
  });
  it("fences membership discovery, identity uniqueness, evidence reuse and COMMIT expiry", () => {
    expect(sql).toContain("SHARE ROW EXCLUSIVE MODE");
    expect(sql).toContain("subject text NOT NULL UNIQUE");
    expect(sql).toContain("person_id text NOT NULL UNIQUE");
    expect(sql).toContain("one_use_per_identity_verification");
    expect(sql).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(sql).toContain("approved.plan IS DISTINCT FROM p_plan");
    expect(sql).toContain("Incomplete identity membership fence");
    expect(sql).toContain("Global identity history requires explicit authority in every represented tenant");
  });
  it("skips without dedicated configuration and rejects partial, old or reused database names", () => {
    expect(identityPersistenceDisposableConfig({}).status).toBe("skip");
    expect(() => identityPersistenceDisposableConfig({ EMPIRE_OS_IDENTITY_TEST_PG_HOST: "127.0.0.1" })).toThrow();
    const database = "empire_os_test_identity_fresh_random_suffix";
    const env = {
      EMPIRE_OS_IDENTITY_TEST_PG_HOST: "127.0.0.1", EMPIRE_OS_IDENTITY_TEST_PG_PORT: "5432",
      EMPIRE_OS_IDENTITY_TEST_PG_DATABASE: database, EMPIRE_OS_IDENTITY_TEST_PG_USER: "test_owner",
      EMPIRE_OS_IDENTITY_TEST_PG_CONFIRM: `${database}:${DISPOSABLE_MARKER}`,
    };
    expect(identityPersistenceDisposableConfig(env).status).toBe("configured");
    expect(() => identityPersistenceDisposableConfig({ ...env, EMPIRE_OS_AUTH_TEST_PG_DATABASE: database })).toThrow();
    const old = "empire_os_test_identity_v1_old";
    expect(() => identityPersistenceDisposableConfig({ ...env, EMPIRE_OS_IDENTITY_TEST_PG_DATABASE: old,
      EMPIRE_OS_IDENTITY_TEST_PG_CONFIRM: `${old}:${DISPOSABLE_MARKER}` })).toThrow();
  });
});
