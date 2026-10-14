import type { DisposableConfig } from "./disposable-config";

export const RECOVERY_CONFIRMATION_DISPOSABLE_MARKER = "empire-os-recovery-confirmation-disposable-only";
const PREFIX = "EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_";
const REQUIRED = ["HOST", "PORT", "DATABASE", "USER", "PASSWORD", "CONFIRM", "FIXTURE_ID"] as const;

export function recoveryConfirmationDisposableConfig(env: Readonly<Record<string, string | undefined>>):
  { status: "skip"; reason: string } | { status: "configured"; config: DisposableConfig & { fixtureId: string } } {
  const values = REQUIRED.map((key) => env[`${PREFIX}${key}`]);
  if (values.every((value) => value === undefined)) {
    return {
      status: "skip",
      reason: "Recovery confirmation PostgreSQL integration NOT VERIFIED: dedicated fresh fixture is not configured.",
    };
  }

  const host = env[`${PREFIX}HOST`];
  const database = env[`${PREFIX}DATABASE`];
  const user = env[`${PREFIX}USER`];
  const password = env[`${PREFIX}PASSWORD`];
  const fixtureId = env[`${PREFIX}FIXTURE_ID`];
  const port = Number(env[`${PREFIX}PORT`]);
  if (!host || !["127.0.0.1", "::1"].includes(host)
    || !fixtureId || !/^[a-f0-9]{32}$/.test(fixtureId)
    || database !== `empire_os_test_recovery_${fixtureId}` || database.length > 63
    || !user || !/^[a-z_][a-z0-9_]{0,62}$/.test(user)
    || !password || !Number.isInteger(port) || port < 1 || port > 65535
    || env[`${PREFIX}CONFIRM`] !== `${database}:${RECOVERY_CONFIRMATION_DISPOSABLE_MARKER}:${fixtureId}`) {
    throw new Error("Unsafe/incomplete recovery confirmation PostgreSQL test configuration; no values are logged.");
  }
  const configuredDatabases = [
    "EMPIRE_OS_TEST_PG_DATABASE", "EMPIRE_OS_AUTH_TEST_PG_DATABASE",
    "EMPIRE_OS_PROVISION_TEST_PG_DATABASE", "EMPIRE_OS_PROVISION_ADAPTER_TEST_PG_DATABASE",
    "EMPIRE_OS_STAGE_V9_TEST_PG_DATABASE",
  ];
  if (configuredDatabases.some((key) => env[key] === database)
    || database === "empire_os_test_stage_v9_20261013_1754") {
    throw new Error("Recovery confirmation integration requires its own fresh database, separate from all previous fixtures.");
  }
  return {
    status: "configured",
    config: Object.freeze({
      host, port, database, user, password,
      fixtureId,
      application_name: "empire-os-recovery-confirmation-disposable",
      connectionTimeoutMillis: 5000,
    }),
  };
}

export function verifyRecoveryConfirmationDatabaseIdentity(
  config: DisposableConfig & { fixtureId: string },
  identity: { database: string; principal: string; marker: string | null; recovery: boolean },
): void {
  if (identity.database !== config.database || identity.principal !== config.user
    || identity.marker !== `${config.database}:${RECOVERY_CONFIRMATION_DISPOSABLE_MARKER}:${config.fixtureId}`
    || identity.recovery) {
    throw new Error("Recovery confirmation disposable database identity check failed; no fixture writes permitted.");
  }
}
