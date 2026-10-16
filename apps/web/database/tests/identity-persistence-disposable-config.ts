import { disposableConfig } from "./disposable-config";

export function identityPersistenceDisposableConfig(env: Readonly<Record<string, string | undefined>>) {
  const isolated: Record<string, string | undefined> = {};
  for (const key of ["HOST", "PORT", "DATABASE", "USER", "PASSWORD", "CONFIRM"]) {
    isolated[`EMPIRE_OS_TEST_PG_${key}`] = env[`EMPIRE_OS_IDENTITY_TEST_PG_${key}`];
  }
  const result = disposableConfig(isolated);
  if (result.status === "configured") {
    const database = result.config.database;
    if (!/^empire_os_test_identity_[a-z0-9_]+$/.test(database) || /(?:^|_)v[1-5](?:_|$)/.test(database)
      || Object.entries(env).some(([key, value]) => key !== "EMPIRE_OS_IDENTITY_TEST_PG_DATABASE"
        && key.endsWith("_DATABASE") && value === database)) {
      throw new Error("Identity integration requires its own NEW, never previously attempted disposable database.");
    }
  }
  return result;
}
