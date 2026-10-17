import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { endianness } from "node:os";
import { join } from "node:path";
import { kill } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { Client, type ClientConfig } from "pg";
import {
  MEMBER_CONSUMED_MARKER, verifyMemberProvisioningIdentity, verifyMemberDatabaseIdentity,
  type MemberDatabaseIdentity, type MemberDisposableConfig, type MemberProvisioningIdentity,
} from "./member-authority-disposable-config";
import { connectDisposable, migrateEmptyAuthorizationDisposable } from "./postgres-harness";

// host(inet) omits the /32 or /128 suffix emitted by inet::text, matching
// the independently recorded literal loopback host without weakening comparison.
export const MEMBER_CLUSTER_IDENTITY_SQL = `SELECT
  current_database() AS database,d.oid::text AS database_oid,pg_get_userbyid(d.datdba) AS owner,
  current_user AS principal,session_user AS session_principal,
  (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
  current_setting('server_version_num') AS version,pg_is_in_recovery() AS recovery,
  current_setting('transaction_read_only') AS read_only,
  current_setting('data_directory') AS data_directory,
  inet_server_port() AS server_port,host(inet_server_addr()) AS server_address,
  floor(extract(epoch FROM pg_postmaster_start_time()))::text AS postmaster_started_at,
  (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,
  shobj_description(d.oid,'pg_database') AS marker,
  (NOT EXISTS (SELECT 1 FROM pg_database
      WHERE datname NOT IN ('template0','template1','postgres',current_database())
        OR datdba<>d.datdba)
    AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname<>current_user AND rolname !~ '^pg_')
    AND NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND backend_type='client backend')
    AND NOT EXISTS (SELECT 1 FROM pg_prepared_xacts)
    AND NOT EXISTS (SELECT 1 FROM pg_replication_slots)
    AND NOT EXISTS (SELECT 1 FROM pg_stat_replication)) AS clean_cluster
  FROM pg_database d WHERE d.datname=current_database()`;

// Waiting queries are submitted ONCE. Polling reads PostgreSQL's lock graph; it
// never resubmits a mutation. All client/server waits are bounded.
export const MEMBER_BLOCKING_SQL = `SELECT
  $1::int=ANY(pg_blocking_pids($2::int)) AS blocked,
  EXISTS (SELECT 1 FROM pg_locks WHERE pid=$2::int AND NOT granted) AS waiting`;

export async function waitForMemberBlock(observer: Pick<Client, "query">, blockerPid: number, waiterPid: number): Promise<void> {
  const deadline = performance.now() + 2500;
  while (performance.now() < deadline) {
    const result = await observer.query<{ blocked: boolean; waiting: boolean }>(MEMBER_BLOCKING_SQL, [blockerPid, waiterPid]);
    if (result.rows.length === 1 && result.rows[0].blocked === true && result.rows[0].waiting === true) return;
    await delay(20);
  }
  throw new Error("Expected PostgreSQL blocking relationship was not observed before the deadline.");
}

export async function memberBackendPid(client: Client): Promise<number> {
  const result = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  if (result.rows.length !== 1 || !Number.isInteger(result.rows[0].pid)) throw new Error("Missing test backend identity.");
  return result.rows[0].pid;
}

async function verifyLocalInstance(proof: MemberProvisioningIdentity): Promise<void> {
  if (await realpath(proof.dataDirectory) !== proof.dataDirectory) throw new Error("Expected canonical disposable data directory.");
  const [version, pidFile, control] = await Promise.all([
    readFile(join(proof.dataDirectory, "PG_VERSION"), "utf8"),
    readFile(join(proof.dataDirectory, "postmaster.pid"), "utf8"),
    readFile(join(proof.dataDirectory, "global/pg_control")),
  ]);
  const lines = pidFile.trimEnd().split("\n");
  // PostgreSQL 16 ControlFileData begins with the native-endian uint64 system
  // identifier. No credentials or configuration files are read.
  if (control.length < 8) throw new Error("Missing local PostgreSQL control identity.");
  const systemIdentifier = (endianness() === "LE" ? control.readBigUInt64LE(0) : control.readBigUInt64BE(0)).toString();
  if (version.trim() !== "16" || systemIdentifier !== proof.systemIdentifier
    || lines[0] !== String(proof.postmasterPid) || lines[1] !== proof.dataDirectory
    || lines[2] !== String(proof.postmasterStartedAtSeconds) || lines[3] !== String(proof.port)
    || lines[7]?.trim() !== "ready") throw new Error("Local disposable PostgreSQL running-instance identity mismatch.");
  // Signal zero checks existence/permission without signalling the postmaster.
  kill(proof.postmasterPid, 0);
}

export async function createMemberAuthorityHarness(config: MemberDisposableConfig) {
  // Independent expected identity is never populated from the SQL connection.
  // Missing/unreadable manifest or local control/PID files abort BEFORE connecting.
  const text = await readFile(config.identityManifestFile, "utf8");
  if (text.length > 8192) throw new Error("Oversized local provisioning manifest.");
  const manifest: unknown = JSON.parse(text);
  const proof = verifyMemberProvisioningIdentity(config, manifest, Date.now());
  await verifyLocalInstance(proof);
  const clients: Client[] = [];
  const runtimeLogins = new Map<string, string>();
  let active = true;
  const admin = await connectDisposable(config.database);
  clients.push(admin);

  async function close(): Promise<void> {
    active = false;
    const results = await Promise.allSettled(clients.map(client => client.end()));
    const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, "Member test connection cleanup failed.");
  }

  try {
    const identity = await admin.query<MemberDatabaseIdentity>(MEMBER_CLUSTER_IDENTITY_SQL);
    if (identity.rows.length !== 1) throw new Error("Missing member test database identity.");
    verifyMemberDatabaseIdentity(proof, identity.rows[0]);
    await migrateEmptyAuthorizationDisposable(admin, async verified => {
      // Existing advisory/zero-object guards run BEFORE the consumed marker.
      // This comment commits before migration 001, including when 001 later fails.
      await verifyLocalInstance(proof);
      const fresh = await verified.query<MemberDatabaseIdentity>(MEMBER_CLUSTER_IDENTITY_SQL);
      if (fresh.rows.length !== 1) throw new Error("Missing member pre-migration identity.");
      verifyMemberDatabaseIdentity(proof, fresh.rows[0]);
      await verified.query(`COMMENT ON DATABASE "${proof.database}" IS '${MEMBER_CONSUMED_MARKER}'`);
    });
    for (const name of ["contribution-identity-persistence-candidate.sql", "member-authority-candidate.sql"]) {
      const sql = await readFile(new URL(`../design/sql/${name}`, import.meta.url), "utf8");
      try { await admin.query(sql); } catch (error) {
        try { await admin.query("ROLLBACK"); } catch (cleanup) {
          throw new AggregateError([error, cleanup], "Candidate application and rollback failed.");
        }
        throw error;
      }
    }
  } catch (error) {
    try { await close(); } catch (cleanup) {
      throw new AggregateError([error, cleanup], "Member harness setup and disposal failed.");
    }
    throw error;
  }

  function clientFor(user: string, password: string): Client {
    if (!active) throw new Error("Member harness is closed.");
    const connection: ClientConfig & { replication: string } = {
      ...config.database, user, password: async () => password, ssl: false,
      options: "-c search_path=pg_catalog -c row_security=on", replication: "false",
      statement_timeout: 8000, query_timeout: 10000, lock_timeout: 5000,
      idle_in_transaction_session_timeout: 15000,
    };
    const client = new Client(connection);
    clients.push(client);
    return client;
  }

  return Object.freeze({
    admin,
    async owner(): Promise<Client> {
      const client = clientFor(config.database.user, config.database.password);
      await verifyLocalInstance(proof);
      await client.connect();
      const identity = await client.query<MemberDatabaseIdentity>(MEMBER_CLUSTER_IDENTITY_SQL);
      if (identity.rows.length !== 1) throw new Error("Missing owner connection identity.");
      verifyMemberDatabaseIdentity(proof, identity.rows[0], "consumed");
      return client;
    },
    async createMemberLogin(subject: string, tenantId: string): Promise<string> {
      if (!active) throw new Error("Member harness is closed.");
      const role = `empire_member_${randomUUID().replaceAll("-", "")}`;
      const password = randomUUID() + randomUUID();
      await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'
        NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`);
      await admin.query(`GRANT CONNECT ON DATABASE "${proof.database}" TO "${role}"`);
      await admin.query(`GRANT USAGE ON SCHEMA empire_os_identity TO "${role}"`);
      await admin.query(`GRANT EXECUTE ON FUNCTION empire_os_identity.lock_member_authority(text,uuid) TO "${role}"`);
      await admin.query("INSERT INTO empire_os_authorization.role_tenants VALUES($1,$2,$3)", [role, subject, tenantId]);
      runtimeLogins.set(role, password);
      return role;
    },
    async member(role: string): Promise<Client> {
      const password = runtimeLogins.get(role);
      if (!password) throw new Error("Unknown member fixture login.");
      const client = clientFor(role, password);
      await verifyLocalInstance(proof);
      await client.connect();
      const identity = await client.query(`SELECT current_database() AS database,d.oid::text AS oid,
        pg_get_userbyid(d.datdba) AS owner,current_user AS principal,session_user AS session_principal,
        inet_server_port() AS server_port,host(inet_server_addr()) AS server_address,
        floor(extract(epoch FROM pg_postmaster_start_time()))::text AS postmaster_started_at,
        shobj_description(d.oid,'pg_database') AS marker,pg_is_in_recovery() AS recovery
        FROM pg_database d WHERE datname=current_database()`);
      const row = identity.rows[0];
      if (identity.rows.length !== 1 || row.database !== proof.database || row.oid !== proof.databaseOid
        || row.owner !== proof.owner || row.principal !== role || row.session_principal !== role
        || row.server_port !== proof.port || row.server_address !== proof.host
        || row.postmaster_started_at !== String(proof.postmasterStartedAtSeconds)
        || row.marker !== MEMBER_CONSUMED_MARKER || row.recovery !== false) {
        throw new Error("Member fixture login identity mismatch.");
      }
      return client;
    },
    close,
  });
}
