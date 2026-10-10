export const DISPOSABLE_MARKER = "empire-os-disposable-integration-test-only";
export type DisposableConfig = Readonly<{
  host: string; port: number; database: string; user: string; password: string;
  application_name: string; connectionTimeoutMillis: number;
}>;
const VARIABLES = [
  "EMPIRE_OS_TEST_PG_HOST", "EMPIRE_OS_TEST_PG_PORT", "EMPIRE_OS_TEST_PG_DATABASE",
  "EMPIRE_OS_TEST_PG_USER", "EMPIRE_OS_TEST_PG_PASSWORD", "EMPIRE_OS_TEST_PG_CONFIRM",
] as const;

export function disposableConfig(env: Readonly<Record<string, string | undefined>>):
  { status: "skip"; reason: string } | { status: "configured"; config: DisposableConfig } {
  if (VARIABLES.every((key) => env[key] === undefined)) {
    return { status: "skip", reason: "PostgreSQL integration NOT VERIFIED: no disposable test database configured." };
  }
  const host = env.EMPIRE_OS_TEST_PG_HOST;
  const database = env.EMPIRE_OS_TEST_PG_DATABASE;
  const user = env.EMPIRE_OS_TEST_PG_USER;
  const port = Number(env.EMPIRE_OS_TEST_PG_PORT);
  if (!host || !["127.0.0.1", "::1"].includes(host) || !database || !/^empire_os_test_[a-z0-9_]+$/.test(database)
    || database.length > 63 || !user || !/^[a-z_][a-z0-9_]{0,62}$/.test(user)
    || !Number.isInteger(port) || port < 1 || port > 65535
    || env.EMPIRE_OS_TEST_PG_CONFIRM !== `${database}:${DISPOSABLE_MARKER}`) {
    throw new Error("Unsafe/incomplete PostgreSQL test configuration. Require literal loopback host, explicit port/user, "
      + "empire_os_test_ database and matching disposable confirmation. Configuration values are not logged.");
  }
  return { status: "configured", config: Object.freeze({
    host, database, user, port, password: env.EMPIRE_OS_TEST_PG_PASSWORD ?? "",
    application_name: "empire-os-disposable-integration", connectionTimeoutMillis: 5000,
  }) };
}

export function verifyDatabaseIdentity(
  config: DisposableConfig,
  identity: { database: string; principal: string; marker: string | null; recovery: boolean },
): void {
  if (identity.database !== config.database || identity.principal !== config.user
    || identity.marker !== DISPOSABLE_MARKER || identity.recovery) {
    throw new Error("PostgreSQL disposable identity/marker verification failed; no migration or fixture writes permitted.");
  }
}
