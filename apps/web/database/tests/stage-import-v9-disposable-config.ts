import type { DisposableConfig } from "./disposable-config";

export const STAGE_IMPORT_V9_DATABASE = "empire_os_test_stage_v9_20261013_1754";
export const STAGE_IMPORT_V9_MARKER = "empire-os-stage-import-v9-disposable-only";

const PREFIX = "EMPIRE_OS_STAGE_V9_TEST_PG_";
const REQUIRED = ["HOST", "PORT", "DATABASE", "USER", "PASSWORD", "CONFIRM"] as const;

export function stageImportV9DisposableConfig(env: Readonly<Record<string, string | undefined>>):
  { status: "skip"; reason: string } | { status: "configured"; config: DisposableConfig } {
  const values = REQUIRED.map((key) => env[`${PREFIX}${key}`]);
  if (values.every((value) => value === undefined)) {
    return { status: "skip", reason: "Stage-import PostgreSQL v9 integration NOT VERIFIED: dedicated database configuration absent." };
  }

  const host = env[`${PREFIX}HOST`];
  const database = env[`${PREFIX}DATABASE`];
  const user = env[`${PREFIX}USER`];
  const port = Number(env[`${PREFIX}PORT`]);
  if (!host || !["127.0.0.1", "::1"].includes(host)
    || database !== STAGE_IMPORT_V9_DATABASE
    || !user || !/^[a-z_][a-z0-9_]{0,62}$/.test(user)
    || !Number.isInteger(port) || port < 1 || port > 65535
    || !env[`${PREFIX}PASSWORD`]
    || env[`${PREFIX}CONFIRM`] !== `${STAGE_IMPORT_V9_DATABASE}:${STAGE_IMPORT_V9_MARKER}`) {
    throw new Error("Unsafe/incomplete stage-import v9 PostgreSQL configuration. Require the fixed v9 database, "
      + "loopback host, explicit owner/port, password and exact disposable marker. No values are logged.");
  }

  const otherDatabaseVariables = [
    "EMPIRE_OS_TEST_PG_DATABASE", "EMPIRE_OS_AUTH_TEST_PG_DATABASE",
    "EMPIRE_OS_PROVISION_TEST_PG_DATABASE", "EMPIRE_OS_PROVISION_ADAPTER_TEST_PG_DATABASE",
  ];
  if (otherDatabaseVariables.some((key) => env[key] === database)) {
    throw new Error("Stage-import v9 requires a database not configured for any earlier integration suite.");
  }

  return { status: "configured", config: Object.freeze({
    host, port, database, user, password: env[`${PREFIX}PASSWORD`]!,
    application_name: "empire-os-stage-import-v9-integration", connectionTimeoutMillis: 5000,
  }) };
}
