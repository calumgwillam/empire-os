import { describe, expect, it } from "vitest";
import { DISPOSABLE_MARKER } from "./disposable-config";
import { provisioningAdapterDisposableConfig } from "./provisioning-adapter-disposable-config";

function environment(database = "empire_os_test_provision_adapter_fresh") {
  return {
    EMPIRE_OS_PROVISION_ADAPTER_TEST_PG_HOST: "127.0.0.1",
    EMPIRE_OS_PROVISION_ADAPTER_TEST_PG_PORT: "55432",
    EMPIRE_OS_PROVISION_ADAPTER_TEST_PG_DATABASE: database,
    EMPIRE_OS_PROVISION_ADAPTER_TEST_PG_USER: "test_owner",
    EMPIRE_OS_PROVISION_ADAPTER_TEST_PG_PASSWORD: "test-only",
    EMPIRE_OS_PROVISION_ADAPTER_TEST_PG_CONFIRM: `${database}:${DISPOSABLE_MARKER}`,
  };
}

describe("NEW provisioning adapter database configuration (offline)", () => {
  it("skips without dedicated configuration and never uses other database credentials", () => {
    expect(provisioningAdapterDisposableConfig({
      PGDATABASE: "populated", DATABASE_URL: "postgres://unused.invalid/populated",
      EMPIRE_OS_PROVISION_TEST_PG_DATABASE: "empire_os_test_provisioning_v5_20261012",
    }).status).toBe("skip");
    expect(provisioningAdapterDisposableConfig(environment()).status).toBe("configured");
  });

  it.each([
    "empire_os_test_provisioning_v1_20261012", "empire_os_test_provisioning_v5_20261012",
    ...[1, 2, 3, 4, 5].map(version => `empire_os_test_provision_adapter_v${version}_fresh`),
  ])("rejects protected or non-adapter database %s before connecting", database => {
    expect(() => provisioningAdapterDisposableConfig(environment(database))).toThrow("NEW disposable");
  });

  it.each(["EMPIRE_OS_TEST_PG_DATABASE", "EMPIRE_OS_AUTH_TEST_PG_DATABASE",
    "EMPIRE_OS_PROVISION_TEST_PG_DATABASE"])("rejects shared database configuration %s", key => {
    const env = environment();
    expect(() => provisioningAdapterDisposableConfig({
      ...env, [key]: env.EMPIRE_OS_PROVISION_ADAPTER_TEST_PG_DATABASE,
    })).toThrow("NEW disposable");
  });

  it.each([
    { EMPIRE_OS_PROVISION_ADAPTER_TEST_PG_CONFIRM: "" },
    { EMPIRE_OS_PROVISION_ADAPTER_TEST_PG_HOST: "db.example.invalid" },
    { EMPIRE_OS_PROVISION_ADAPTER_TEST_PG_PORT: undefined },
  ])("fails closed on partial/unsafe configuration %j", invalid => {
    expect(() => provisioningAdapterDisposableConfig({ ...environment(), ...invalid })).toThrow("Unsafe/incomplete");
  });
});
