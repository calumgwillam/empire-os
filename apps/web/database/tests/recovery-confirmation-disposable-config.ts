import { basename, isAbsolute, normalize } from "node:path";
import type { DisposableConfig } from "./disposable-config";

export const RECOVERY_CONFIRMATION_DISPOSABLE_MARKER = "empire-os-recovery-confirmation-disposable-only";
const PREFIX = "EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_";
const REQUIRED = [
  "HOST", "PORT", "DATABASE", "USER", "PASSWORD", "CONFIRM", "FIXTURE_ID",
  "CLUSTER_DIRECTORY", "CLUSTER_SYSTEM_IDENTIFIER",
] as const;
const configuredFixtures = new WeakSet<object>();

export type RecoveryConfirmationDisposableConfig = DisposableConfig & Readonly<{
  fixtureId: string;
  clusterDirectory: string;
  clusterSystemIdentifier: string;
}>;

export function requireRecoveryConfirmationConfig(config: RecoveryConfirmationDisposableConfig): void {
  if (!configuredFixtures.has(config)) {
    throw new Error("Recovery fixture requires an unchanged validated dedicated configuration.");
  }
}

export function recoveryConfirmationDisposableConfig(env: Readonly<Record<string, string | undefined>>):
  { status: "skip"; reason: string } | { status: "configured"; config: RecoveryConfirmationDisposableConfig } {
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
  const clusterDirectory = env[`${PREFIX}CLUSTER_DIRECTORY`];
  const clusterSystemIdentifier = env[`${PREFIX}CLUSTER_SYSTEM_IDENTIFIER`];
  const port = Number(env[`${PREFIX}PORT`]);
  if (!host || !["127.0.0.1", "::1"].includes(host)
    || !fixtureId || !/^[a-f0-9]{32}$/.test(fixtureId)
    || database !== `empire_os_test_recovery_${fixtureId}` || database.length > 63
    || !user || !/^[a-z_][a-z0-9_]{0,62}$/.test(user)
    || !password || !Number.isInteger(port) || port < 1 || port > 65535
    || port === 55432 || port === 55439
    || !clusterDirectory || !isAbsolute(clusterDirectory) || normalize(clusterDirectory) !== clusterDirectory
    || basename(clusterDirectory) !== `empire-os-recovery-${fixtureId}`
    || !clusterSystemIdentifier || !/^[1-9][0-9]{0,19}$/.test(clusterSystemIdentifier)
    || BigInt(clusterSystemIdentifier) > BigInt("18446744073709551615")
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
  const config = Object.freeze({
    host, port, database, user, password, fixtureId, clusterDirectory, clusterSystemIdentifier,
    application_name: "empire-os-recovery-confirmation-disposable",
    connectionTimeoutMillis: 5000,
  });
  configuredFixtures.add(config);
  return { status: "configured", config };
}

export type RecoveryConfirmationDatabaseIdentity = {
  database: string; principal: string; login: string; marker: string | null;
  recovery: boolean; superuser: boolean; server_address: string; server_port: number;
  cluster_directory: string; system_identifier: string; version: string;
  isolated_databases: boolean; isolated_roles: boolean; exclusive_session: boolean;
};

export function verifyRecoveryConfirmationDatabaseIdentity(
  config: RecoveryConfirmationDisposableConfig,
  identity: RecoveryConfirmationDatabaseIdentity,
): void {
  requireRecoveryConfirmationConfig(config);
  if (!identity || identity.database !== config.database || identity.principal !== config.user
    || identity.login !== config.user
    || identity.marker !== `${config.database}:${RECOVERY_CONFIRMATION_DISPOSABLE_MARKER}:${config.fixtureId}`
    || identity.recovery !== false || identity.superuser !== true
    || identity.server_address !== config.host || identity.server_port !== config.port
    || identity.cluster_directory !== config.clusterDirectory
    || identity.system_identifier !== config.clusterSystemIdentifier
    || !/^16[0-9]{4}$/.test(identity.version)
    || identity.isolated_databases !== true || identity.isolated_roles !== true
    || identity.exclusive_session !== true) {
    throw new Error("Recovery confirmation disposable database identity check failed; no fixture writes permitted.");
  }
}
