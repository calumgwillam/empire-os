import { open, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Client, type ClientConfig } from "pg";
import {
  RECOVERY_CONFIRMATION_DISPOSABLE_MARKER,
  requireRecoveryConfirmationConfig,
  verifyRecoveryConfirmationDatabaseIdentity,
  type RecoveryConfirmationDatabaseIdentity,
  type RecoveryConfirmationDisposableConfig,
} from "./recovery-confirmation-disposable-config";

const IDENTITY_SQL = `SELECT
  current_database() AS database, current_user AS principal, session_user AS login,
  shobj_description(d.oid,'pg_database') AS marker, pg_is_in_recovery() AS recovery,
  (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,
  inet_server_addr()::text AS server_address, inet_server_port() AS server_port,
  current_setting('data_directory') AS cluster_directory,
  (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
  current_setting('server_version_num') AS version,
  NOT EXISTS (SELECT 1 FROM pg_database
    WHERE datname NOT IN ('postgres','template0','template1',current_database())) AS isolated_databases,
  NOT EXISTS (SELECT 1 FROM pg_roles
    WHERE rolname<>current_user AND rolname !~ '^pg_') AS isolated_roles,
  NOT EXISTS (SELECT 1 FROM pg_stat_activity
    WHERE pid<>pg_backend_pid() AND backend_type='client backend') AS exclusive_session
  FROM pg_database d WHERE d.datname=current_database()`;

const EMPTY_SQL = `SELECT
  (SELECT count(*)::text FROM pg_namespace
    WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_') AS schemas,
  (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' OR c.oid>=16384) AS relations,
  (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' OR p.oid>=16384) AS functions,
  (SELECT count(*)::text FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public' OR t.oid>=16384) AS types,
  (SELECT count(*)::text FROM pg_depend d
    WHERE d.refclassid='pg_namespace'::regclass
      AND (d.refobjid='public'::regnamespace OR d.objid>=16384)) AS schema_objects,
  (SELECT count(*)::text FROM pg_extension WHERE extname<>'plpgsql') AS extensions,
  (SELECT count(*)::text FROM pg_largeobject_metadata) AS large_objects,
  (SELECT count(*)::text FROM pg_publication) AS publications,
  (SELECT count(*)::text FROM pg_subscription) AS subscriptions,
  (SELECT count(*)::text FROM pg_event_trigger) AS event_triggers,
  (SELECT count(*)::text FROM pg_foreign_data_wrapper) AS foreign_wrappers,
  (SELECT count(*)::text FROM pg_foreign_server) AS foreign_servers,
  (SELECT count(*)::text FROM pg_replication_origin) AS replication_origins,
  (SELECT count(*)::text FROM pg_language
    WHERE lanname NOT IN ('internal','c','sql','plpgsql')) AS languages,
  (SELECT count(*)::text FROM pg_default_acl) AS default_acls,
  (SELECT count(*)::text FROM pg_db_role_setting) AS role_settings,
  (SELECT count(*)::text FROM pg_cast WHERE oid>=16384) AS casts,
  (SELECT count(*)::text FROM pg_transform) AS transforms,
  (SELECT count(*)::text FROM pg_am WHERE oid>=16384) AS access_methods,
  (SELECT count(*)::text FROM pg_parameter_acl) AS parameter_acls,
  (SELECT count(*)::text FROM pg_replication_slots) AS replication_slots,
  (SELECT count(*)::text FROM pg_prepared_xacts) AS prepared_transactions`;

const EMPTY_FIELDS = [
  "schemas", "relations", "functions", "types", "schema_objects", "extensions",
  "large_objects", "publications", "subscriptions", "event_triggers", "foreign_wrappers",
  "foreign_servers", "replication_origins", "languages", "default_acls", "role_settings",
  "casts", "transforms", "access_methods", "parameter_acls", "replication_slots", "prepared_transactions",
] as const;

async function spendLocalFixture(config: RecoveryConfirmationDisposableConfig): Promise<void> {
  if (await realpath(config.clusterDirectory) !== config.clusterDirectory
    || (await readFile(join(config.clusterDirectory, "PG_VERSION"), "utf8")).trim() !== "16") {
    throw new Error("Recovery fixture requires a canonical, non-symlink PostgreSQL 16 cluster directory.");
  }
  // Exclusive creation survives connection failure and prevents reuse even before SQL can claim the marker.
  const file = await open(join(config.clusterDirectory, ".recovery-confirmation-spent"), "wx", 0o600);
  try {
    await file.writeFile(`${config.database}:${config.fixtureId}:${config.clusterSystemIdentifier}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  const directory = await open(config.clusterDirectory, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function prepareRecoveryConfirmationFixture(
  config: RecoveryConfirmationDisposableConfig,
): Promise<Client> {
  requireRecoveryConfirmationConfig(config);
  await spendLocalFixture(config);
  const connectionOptions: ClientConfig & { replication: string } = {
    host: config.host, port: config.port, database: config.database, user: config.user,
    password: async () => config.password, ssl: false, replication: "false",
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    statement_timeout: 10000, query_timeout: 12000, lock_timeout: 5000,
    idle_in_transaction_session_timeout: 15000,
    options: "-c search_path=pg_catalog -c row_security=on -c synchronous_commit=on",
    application_name: config.application_name,
  };
  const client = new Client(connectionOptions);
  try {
    await client.connect();
    const verifyIdentity = async () => {
      const identity = await client.query<RecoveryConfirmationDatabaseIdentity>(IDENTITY_SQL);
      if (identity.rows.length !== 1) throw new Error("Recovery fixture identity is unavailable.");
      verifyRecoveryConfirmationDatabaseIdentity(config, identity.rows[0]);
    };
    await verifyIdentity();
    // Session lock remains held through all five tests, until this admin connection ends.
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(172914, 30) AS acquired",
    );
    if (lock.rows.length !== 1 || lock.rows[0]?.acquired !== true) {
      throw new Error("Another recovery integration runner owns this fixture.");
    }
    await verifyIdentity();
    const claimed = await client.query(
      `COMMENT ON DATABASE "${config.database}" IS '${config.database}:${RECOVERY_CONFIRMATION_DISPOSABLE_MARKER}:${config.fixtureId}:spent'`,
    );
    if (claimed.command !== "COMMENT") throw new Error("Recovery fixture spent-marker acknowledgement is uncertain.");

    const empty = await client.query<Record<string, unknown>>(EMPTY_SQL);
    if (empty.rows.length !== 1 || EMPTY_FIELDS.some((field) => empty.rows[0]?.[field] !== "0")) {
      throw new Error("Recovery fixture is not empty; refusing candidate setup.");
    }
    const sql = await readFile(
      new URL("../design/sql/exceptional-recovery-confirmation-candidate.sql", import.meta.url), "utf8",
    );
    if (!sql.startsWith("-- INACTIVE CANDIDATE ONLY")
      || sql.match(/^BEGIN;$/gm)?.length !== 1 || sql.match(/^COMMIT;$/gm)?.length !== 1
      || /^\s*GRANT\b/m.test(sql)) {
      throw new Error("Recovery candidate lost its inactive, transaction-bound, no-grants contract.");
    }
    const applied = await client.query(sql);
    if (!Array.isArray(applied) || applied.at(-1)?.command !== "COMMIT") {
      throw new Error("Recovery candidate COMMIT acknowledgement is uncertain.");
    }
    return client;
  } catch (error) {
    try {
      await client.end();
    } catch {
      throw new Error("Recovery fixture setup and connection disposal failed; fixture is spent. Do not retry or clean it.");
    }
    throw new Error("Recovery fixture setup failed; fixture is spent. Do not retry, reset or clean it.", { cause: error });
  }
}
