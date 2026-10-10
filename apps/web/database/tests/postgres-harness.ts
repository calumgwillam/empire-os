import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { verifyDatabaseIdentity, type DisposableConfig } from "./disposable-config";

const verifiedConnections = new WeakSet<Client>();

function requireVerifiedConnection(client: Client): void {
  if (!verifiedConnections.has(client)) throw new Error("Unverified connection cannot execute PostgreSQL test setup.");
}

export async function connectDisposable(config: DisposableConfig): Promise<Client> {
  // Dedicated explicit configuration prevents pg from falling back to PGHOST/DATABASE_URL.
  const client = new Client({
    ...config, password: async () => config.password, ssl: false, statement_timeout: 10000, lock_timeout: 5000,
    idle_in_transaction_session_timeout: 15000,
  });
  try {
    await client.connect();
    const identity = await client.query<{
      database: string; principal: string; marker: string | null; recovery: boolean;
    }>(`SELECT current_database() AS database, current_user AS principal,
      shobj_description(oid, 'pg_database') AS marker, pg_is_in_recovery() AS recovery
      FROM pg_database WHERE datname = current_database()`);
    if (identity.rows.length !== 1) throw new Error("Disposable database identity missing.");
    verifyDatabaseIdentity(config, identity.rows[0]);
    verifiedConnections.add(client);
    return client;
  } catch {
    await client.end();
    throw new Error("Disposable PostgreSQL connection/identity verification failed. No database writes were authorized.");
  }
}

export async function migrateEmptyDisposable(client: Client): Promise<void> {
  requireVerifiedConnection(client);
  // Held until this connection closes: concurrent harness runs cannot reset or race this schema.
  const lock = await client.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock(172914, 1) AS acquired",
  );
  if (!lock.rows[0].acquired) throw new Error("Another integration harness owns this disposable database.");
  const objects = await client.query<{ count: string }>(`SELECT count(*)::text AS count
    FROM pg_namespace WHERE nspname NOT IN ('public', 'information_schema')
    AND nspname NOT LIKE 'pg_%'`);
  const relations = await client.query<{ count: string }>(`SELECT count(*)::text AS count
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')`);
  if (objects.rows[0].count !== "0" || relations.rows[0].count !== "0") {
    throw new Error("Test database is not empty. Refusing reset, overwrite or migration. Use a fresh disposable database.");
  }
  const sql = await readFile(new URL("../migrations/001_isolated_persistence.sql", import.meta.url), "utf8");
  try {
    await client.query(sql);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function transaction<T>(client: Client, work: () => Promise<T>): Promise<T> {
  requireVerifiedConnection(client);
  await client.query("BEGIN");
  try {
    return await work();
  } finally {
    await client.query("ROLLBACK");
  }
}

export async function migrateEmptyAuthorizationDisposable(client: Client): Promise<void> {
  // Reuse every original connection, advisory-lock and empty-database guard unchanged.
  await migrateEmptyDisposable(client);
  const sql = await readFile(new URL("../migrations/002_isolated_authorization.sql", import.meta.url), "utf8");
  try {
    await client.query(sql);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function seedDataset(client: Client, id: string): Promise<void> {
  requireVerifiedConnection(client);
  await client.query(`INSERT INTO empire_os_preparation.datasets(dataset_id,generation) VALUES ($1,1)`, [id]);
  await client.query(`INSERT INTO empire_os_preparation.generations(dataset_id,generation) VALUES ($1,1)`, [id]);
  await client.query(`INSERT INTO empire_os_preparation.store_values(dataset_id,generation,store_key)
    SELECT $1,1,store_key FROM empire_os_preparation.store_registry`, [id]);
}
