import { describe, expect, it } from "vitest";
import { DISPOSABLE_MARKER, disposableConfig, verifyDatabaseIdentity } from "./disposable-config";

function environment() {
  return {
    EMPIRE_OS_TEST_PG_HOST: "127.0.0.1", EMPIRE_OS_TEST_PG_PORT: "5432",
    EMPIRE_OS_TEST_PG_DATABASE: "empire_os_test_integration", EMPIRE_OS_TEST_PG_USER: "empire_os_test_owner",
    EMPIRE_OS_TEST_PG_CONFIRM: `empire_os_test_integration:${DISPOSABLE_MARKER}`,
  };
}

describe("Disposable PostgreSQL guard unit tests (no database)", () => {
  it("skips only when all dedicated configuration is absent", () => {
    expect(disposableConfig({})).toMatchObject({ status: "skip", reason: expect.stringContaining("NOT VERIFIED") });
  });
  it("never falls back to a production connection variable", () => {
    expect(disposableConfig({ DATABASE_URL: "redacted", PGDATABASE: "production" }).status).toBe("skip");
  });
  it.each([
    { EMPIRE_OS_TEST_PG_HOST: "localhost" }, { EMPIRE_OS_TEST_PG_HOST: "database.example" },
    { EMPIRE_OS_TEST_PG_DATABASE: "empire_os" }, { EMPIRE_OS_TEST_PG_DATABASE: "postgres" },
    { EMPIRE_OS_TEST_PG_PORT: "" }, { EMPIRE_OS_TEST_PG_PORT: "65536" },
    { EMPIRE_OS_TEST_PG_USER: "owner;drop" }, { EMPIRE_OS_TEST_PG_CONFIRM: "" },
  ])("refuses unsafe configuration without echoing values: %j", (change) => {
    expect(() => disposableConfig({ ...environment(), ...change })).toThrow("Unsafe/incomplete");
  });
  it("refuses partial configuration rather than silently skipping", () => {
    expect(() => disposableConfig({ EMPIRE_OS_TEST_PG_HOST: "127.0.0.1" })).toThrow("Unsafe/incomplete");
  });
  it("accepts explicit disposable intent but requires independent server identity", () => {
    const result = disposableConfig(environment());
    if (result.status !== "configured") throw new Error("Expected configuration.");
    const identity = { database: result.config.database, principal: result.config.user, marker: DISPOSABLE_MARKER, recovery: false };
    expect(() => verifyDatabaseIdentity(result.config, identity)).not.toThrow();
    for (const change of [
      { database: "production" }, { principal: "other" }, { marker: null }, { recovery: true },
    ]) expect(() => verifyDatabaseIdentity(result.config, { ...identity, ...change })).toThrow("verification failed");
  });
});
