import { disposableConfig } from "./disposable-config";

export function provisioningAdapterDisposableConfig(
  env: Readonly<Record<string, string | undefined>>,
) {
  const isolated: Record<string, string | undefined> = {};
  for (const key of ["HOST", "PORT", "DATABASE", "USER", "PASSWORD", "CONFIRM"]) {
    isolated[`EMPIRE_OS_TEST_PG_${key}`] = env[`EMPIRE_OS_PROVISION_ADAPTER_TEST_PG_${key}`];
  }
  const result = disposableConfig(isolated);
  if (result.status === "configured") {
    const database = result.config.database;
    if (!/^empire_os_test_provision_adapter_[a-z0-9_]+$/.test(database)
      || /(?:^|_)v[1-5](?:_|$)/.test(database)
      || ["EMPIRE_OS_TEST_PG_DATABASE", "EMPIRE_OS_AUTH_TEST_PG_DATABASE",
        "EMPIRE_OS_PROVISION_TEST_PG_DATABASE"].some(key => env[key] === database)) {
      throw new Error("Provisioning adapter requires its own NEW disposable database, never databases v1-v5.");
    }
  }
  return result;
}
