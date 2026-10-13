import { readFile } from "node:fs/promises";
import { Client } from "pg";
import {
  STAGE_IMPORT_V9_DATABASE, STAGE_IMPORT_V9_MARKER,
} from "./stage-import-v9-disposable-config";
import type { DisposableConfig } from "./disposable-config";

const verified = new WeakSet<Client>();
const ADVISORY_LOCK_NAMESPACE = 172914;
const ADVISORY_LOCK_ID = 9;

function requireVerified(client: Client): void {
  if (!verified.has(client)) throw new Error("Unverified stage-import v9 connection cannot execute setup.");
}

export async function connectStageImportV9Disposable(config: DisposableConfig): Promise<Client> {
  if (config.database !== STAGE_IMPORT_V9_DATABASE || !["127.0.0.1", "::1"].includes(config.host)) {
    throw new Error("Stage-import harness accepts only its fixed v9 database on literal loopback.");
  }
  const client = new Client({
    host: config.host, port: config.port, database: config.database, user: config.user,
    password: async () => config.password, ssl: false, application_name: config.application_name,
    connectionTimeoutMillis: config.connectionTimeoutMillis, statement_timeout: 10000, lock_timeout: 5000,
    idle_in_transaction_session_timeout: 15000,
  });
  try {
    await client.connect();
    const identity = await client.query<{
      database: string; principal: string; marker: string | null; recovery: boolean; version: string;
    }>(`SELECT current_database() AS database, current_user AS principal,
      shobj_description(oid, 'pg_database') AS marker, pg_is_in_recovery() AS recovery,
      current_setting('server_version_num') AS version
      FROM pg_database WHERE datname=current_database()`);
    const row = identity.rows[0];
    if (identity.rows.length !== 1 || !row || row.database !== STAGE_IMPORT_V9_DATABASE
      || row.principal !== config.user || row.marker !== STAGE_IMPORT_V9_MARKER
      || row.recovery || Math.floor(Number(row.version) / 10000) !== 16) {
      throw new Error("Stage-import v9 database identity, marker, primary status or PostgreSQL version is invalid.");
    }
    verified.add(client);
    return client;
  } catch {
    await client.end();
    throw new Error("Stage-import v9 disposable identity verification failed. No migration or fixture writes were authorized.");
  }
}

async function assertEmpty(client: Client): Promise<void> {
  const schemas = await client.query<{ count: string }>(`SELECT count(*)::text AS count
    FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname NOT LIKE 'pg_%'`);
  const publicObjects = await client.query<{ count: string }>(`SELECT (
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
    + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
    + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public')
    + (SELECT count(*) FROM pg_extension WHERE extname<>'plpgsql')
  )::text AS count`);
  const largeObjects = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM pg_largeobject_metadata",
  );
  if (schemas.rows[0]?.count !== "0" || publicObjects.rows[0]?.count !== "0"
    || largeObjects.rows[0]?.count !== "0") {
    throw new Error("Stage-import v9 database is not empty. Refusing migration or fixture changes; provision a new marked database.");
  }
}

export async function migrateEmptyStageImportV9(client: Client): Promise<void> {
  requireVerified(client);
  const lock = await client.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock($1,$2) AS acquired", [ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_ID],
  );
  if (lock.rows[0]?.acquired !== true) throw new Error("Another stage-import v9 test harness owns this database.");
  await assertEmpty(client);

  for (const migration of [
    "../migrations/001_isolated_persistence.sql",
    "../migrations/002_isolated_authorization.sql",
    "../migrations/003_authorization_reconciliation.sql",
    "../migrations/004_authorized_dataset_snapshot.sql",
    "../design/sql/006_stage_import_candidate.sql",
  ]) {
    const sql = await readFile(new URL(migration, import.meta.url), "utf8");
    if (migration.includes("006_stage_import_candidate")
      && (!sql.startsWith("-- INACTIVE CANDIDATE ONLY") || /^\s*GRANT\b/m.test(sql))) {
      throw new Error("Candidate 006 lost its inactive/no-runtime-grant guard.");
    }
    try {
      await client.query(sql);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* The next run still must pass the empty-database guard. */ }
      throw error;
    }
  }

  const candidate = await client.query<{ present: boolean; owner: string; execute_public: boolean }>(`
    SELECT p.oid IS NOT NULL AS present, owner.rolname AS owner,
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS execute_public
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_roles owner ON owner.oid=p.proowner
    WHERE n.nspname='empire_os_authorization' AND p.proname='stage_import'`);
  const owner = await configOwner(client);
  const installed = candidate.rows[0];
  if (candidate.rows.length !== 1 || !installed || installed.present !== true
    || installed.owner !== owner || installed.execute_public !== false) {
    throw new Error("Candidate 006 was not installed by the migration owner with PUBLIC execution revoked.");
  }
}

async function configOwner(client: Client): Promise<string> {
  const result = await client.query<{ owner: string }>(`
    SELECT r.rolname AS owner FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner
    WHERE n.nspname='empire_os_authorization'`);
  if (result.rows.length !== 1) throw new Error("Authorization schema owner could not be verified.");
  return result.rows[0].owner;
}

export async function seedEmptyDataset(client: Client, datasetId: string): Promise<void> {
  requireVerified(client);
  await client.query("INSERT INTO empire_os_preparation.datasets(dataset_id,generation) VALUES ($1,1)", [datasetId]);
  await client.query("INSERT INTO empire_os_preparation.generations(dataset_id,generation) VALUES ($1,1)", [datasetId]);
  await client.query(`INSERT INTO empire_os_preparation.store_values(dataset_id,generation,store_key)
    SELECT $1,1,store_key FROM empire_os_preparation.store_registry`, [datasetId]);
}
