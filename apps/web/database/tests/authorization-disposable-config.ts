import { disposableConfig } from "./disposable-config";

export function authorizationDisposableConfig(env: Readonly<Record<string, string | undefined>>) {
  const prefix = "EMPIRE_OS_AUTH_TEST_PG_";
  const keys = ["HOST", "PORT", "DATABASE", "USER", "PASSWORD", "CONFIRM"];
  const isolated: Record<string, string | undefined> = {};
  for (const key of keys) isolated[`EMPIRE_OS_TEST_PG_${key}`] = env[`${prefix}${key}`];
  const configured = disposableConfig(isolated);
  if (configured.status === "configured" && configured.config.database === env.EMPIRE_OS_TEST_PG_DATABASE) {
    throw new Error("Authorization integration requires a different fresh disposable database.");
  }
  return configured;
}
