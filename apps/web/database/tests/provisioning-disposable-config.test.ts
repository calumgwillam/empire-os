import { describe, expect, it } from "vitest";
import { provisioningDisposableConfig } from "./provisioning-disposable-config";
import { DISPOSABLE_MARKER } from "./disposable-config";

function configuredEnvironment() {
  const database = "empire_os_test_provisioning_fresh";
  return {
    EMPIRE_OS_PROVISION_TEST_PG_HOST: "127.0.0.1",
    EMPIRE_OS_PROVISION_TEST_PG_PORT: "55432",
    EMPIRE_OS_PROVISION_TEST_PG_DATABASE: database,
    EMPIRE_OS_PROVISION_TEST_PG_USER: "test_owner",
    EMPIRE_OS_PROVISION_TEST_PG_PASSWORD: "test-only",
    EMPIRE_OS_PROVISION_TEST_PG_CONFIRM: `${database}:${DISPOSABLE_MARKER}`,
  };
}

describe("Provisioning database isolation", () => {
  it("skips when no dedicated configuration exists", () => {
    expect(provisioningDisposableConfig({}).status).toBe("skip");
  });

  it("rejects reuse of the authorization database", () => {
    const env = configuredEnvironment();
    expect(() => provisioningDisposableConfig({
      ...env, EMPIRE_OS_AUTH_TEST_PG_DATABASE: env.EMPIRE_OS_PROVISION_TEST_PG_DATABASE,
    })).toThrow("Provisioning requires its own fresh disposable database.");
  });

  it("rejects reuse of the persistence database after validating the marker", () => {
    const env = configuredEnvironment();
    expect(() => provisioningDisposableConfig({
      ...env, EMPIRE_OS_TEST_PG_DATABASE: env.EMPIRE_OS_PROVISION_TEST_PG_DATABASE,
    })).toThrow("Provisioning requires its own fresh disposable database.");
  });

  it("requires dedicated variables and never falls back to general PostgreSQL credentials", () => {
    expect(provisioningDisposableConfig({
      DATABASE_URL: "postgres://unused.invalid/populated",
      PGDATABASE: "empire_os_test_populated",
      EMPIRE_OS_AUTH_TEST_PG_DATABASE: "empire_os_test_populated",
    }).status).toBe("skip");
    expect(provisioningDisposableConfig(configuredEnvironment()).status).toBe("configured");
  });
});
