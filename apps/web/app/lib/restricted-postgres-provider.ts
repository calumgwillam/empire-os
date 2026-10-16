import "server-only";
import { createHash, X509Certificate } from "node:crypto";
import { checkServerIdentity, createSecureContext } from "node:tls";
import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";
import { isAuthorityIdentifier } from "./authorization-policy";
import type { AuthorizationPostgresConnection, AuthorizationPostgresSource } from "./postgres-authorization-store";
import { parseServerPostgresConfig, SERVER_POSTGRES_ENV, type ServerPostgresConfig } from "./postgres-server-config";
import { isAuthenticatedPrincipal, type AuthenticatedPrincipal } from "./server-persistence-authority";
import { hasOnlyFields, isObject } from "./server-persistence-contract";

export type RestrictedSourceBinding = Readonly<{
  subject: string; tenantId: string; databaseIdentitySha256: string; database: string; login: string;
}>;
const restrictedSources = new WeakMap<AuthorizationPostgresSource, RestrictedSourceBinding>();

export function restrictedSourceBinding(source: AuthorizationPostgresSource): RestrictedSourceBinding | undefined {
  return restrictedSources.get(source);
}

export function restrictedDatabaseIdentity(config: Pick<ServerPostgresConfig, "host" | "port" | "database" | "user">): string {
  return createHash("sha256").update(JSON.stringify([config.host, config.port, config.database, config.user])).digest("hex");
}

export class RestrictedPostgresError extends Error {
  constructor(readonly reason: "configuration" | "identity" | "unavailable" | "lifecycle" | "query" | "disposal",
    readonly code?: string) {
    super(`Restricted PostgreSQL ${reason} failure.`);
    this.name = "RestrictedPostgresError";
  }
}

// Does not invoke provisioning helpers or require migration 005. A dedicated LOGIN
// must have exactly one visible tenant binding and no reachable role memberships.
export const RESTRICTED_LEASE_IDENTITY_SQL = `SELECT
  current_database() AS database,session_user AS login,current_user AS effective,
  pg_is_in_recovery() AS recovery,
  EXISTS (SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls,
  r.rolcanlogin AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb
    OR r.rolcreaterole OR r.rolreplication) AS restricted,
  NOT EXISTS (SELECT 1 FROM pg_roles reachable
    WHERE reachable.oid<>r.oid AND pg_has_role(r.oid,reachable.oid,'MEMBER')) AS standalone,
  NOT EXISTS (SELECT 1 FROM pg_namespace n
    WHERE n.nspname IN ('empire_os_authorization','empire_os_preparation','empire_os_identity')
      AND (n.nspowner=r.oid OR has_schema_privilege(r.oid,n.oid,'CREATE'))) AS safe_schema,
  NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('empire_os_authorization','empire_os_preparation','empire_os_identity')
      AND (c.relowner=r.oid OR (c.relkind IN ('r','p','v','m','f') AND (
        has_any_column_privilege(r.oid,c.oid,'SELECT')
        OR has_any_column_privilege(r.oid,c.oid,'REFERENCES')
        OR has_any_column_privilege(r.oid,c.oid,'INSERT')
        OR has_any_column_privilege(r.oid,c.oid,'UPDATE')
        OR has_table_privilege(r.oid,c.oid,'DELETE')
        OR has_table_privilege(r.oid,c.oid,'TRUNCATE'))))) AS safe_tables,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('tenantId',tenant_id,'subject',actor_subject)),'[]'::jsonb)
    FROM empire_os_authorization.role_tenants WHERE database_role=session_user) AS bindings
  FROM pg_roles r WHERE r.rolname=session_user`;

function checkedConfig(value: ServerPostgresConfig): ServerPostgresConfig {
  if (!isObject(value) || !hasOnlyFields(value, ["host", "port", "database", "user", "password", "ssl"])
    || typeof value.host !== "string" || typeof value.database !== "string"
    || typeof value.user !== "string" || typeof value.password !== "string"
    || typeof value.port !== "number" || !Number.isInteger(value.port)
    || !isObject(value.ssl) || !hasOnlyFields(value.ssl, ["rejectUnauthorized", "ca"])
    || value.ssl.rejectUnauthorized !== true
    || (value.ssl.ca !== undefined && typeof value.ssl.ca !== "string")) {
    throw new RestrictedPostgresError("configuration");
  }
  const parsed = parseServerPostgresConfig({
    [SERVER_POSTGRES_ENV.host]: value.host,
    [SERVER_POSTGRES_ENV.port]: String(value.port),
    [SERVER_POSTGRES_ENV.database]: value.database,
    [SERVER_POSTGRES_ENV.user]: value.user,
    [SERVER_POSTGRES_ENV.password]: value.password,
    [SERVER_POSTGRES_ENV.tlsCa]: value.ssl.ca,
  });
  if (parsed.status !== "configured" || !/^[a-z_][a-z0-9_]{0,62}$/.test(parsed.config.user)
    || /[\s/\\@?#]/.test(parsed.config.host) || parsed.config.host.length > 253) {
    throw new RestrictedPostgresError("configuration");
  }
  try {
    if (parsed.config.ssl.ca) {
      const certificates = parsed.config.ssl.ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
      if (!certificates?.length || parsed.config.ssl.ca.replace(
        /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, "",
      ).trim()) throw new Error("Invalid CA bundle.");
      for (const certificate of certificates) new X509Certificate(certificate);
    }
    createSecureContext(parsed.config.ssl.ca ? { ca: parsed.config.ssl.ca } : {});
  } catch {
    throw new RestrictedPostgresError("configuration");
  }
  return parsed.config;
}

export function createRestrictedPostgresProvider(options: Readonly<{
  principal: AuthenticatedPrincipal;
  tenantId: string;
  config: ServerPostgresConfig;
}>) {
  if (!isAuthenticatedPrincipal(options.principal) || !isAuthorityIdentifier(options.tenantId)) {
    throw new RestrictedPostgresError("identity");
  }
  const subject = options.principal.subject;
  const tenantId = options.tenantId;
  const config = checkedConfig(options.config);
  let pool: Pool | undefined;
  let status: "open" | "failed" | "disposing" | "disposed" = "open";
  let disposal: Promise<void> | undefined;
  const leases = new Map<PoolClient, () => void>();

  function getPool(): Pool {
    if (status !== "open") throw new RestrictedPostgresError("unavailable");
    if (!pool) {
      try {
        const poolConfig: PoolConfig & { replication: string } = {
          host: config.host, port: config.port, database: config.database, user: config.user,
          password: () => config.password, ssl: {
            ...config.ssl, minVersion: "TLSv1.2",
            checkServerIdentity: (_hostname, certificate) => checkServerIdentity(config.host, certificate),
          },
          // pg falls back to PGOPTIONS/PGREPLICATION for falsy values. Explicit
          // startup values prevent ambient environment from altering the session.
          options: "-c search_path=pg_catalog -c row_security=on",
          replication: "false", client_encoding: "UTF8",
          max: 2, min: 0, maxUses: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
          statement_timeout: 10000, query_timeout: 12000, lock_timeout: 5000,
          idle_in_transaction_session_timeout: 15000,
          application_name: "empire-os-restricted-server",
        };
        pool = new Pool(poolConfig);
        pool.on("error", () => {
          if (status === "open") status = "failed";
          for (const discard of leases.values()) discard();
        });
      } catch {
        status = "failed";
        throw new RestrictedPostgresError("unavailable");
      }
    }
    return pool;
  }

  const source: AuthorizationPostgresSource = Object.freeze({
    async connect(): Promise<AuthorizationPostgresConnection> {
      let client: PoolClient;
      try {
        client = await getPool().connect();
      } catch {
        throw new RestrictedPostgresError("unavailable");
      }
      let released = false;
      let busy = false;
      let phase: "fresh" | "active" | "finished" | "poisoned" = "fresh";
      function discard() {
        if (released) return;
        released = true;
        leases.delete(client);
        // All leases are single-use, including clean ones. Session state never leaks.
        try {
          client.release(true);
        } catch {
          status = "failed";
          throw new RestrictedPostgresError("lifecycle");
        }
      }
      leases.set(client, discard);
      client.on("error", () => { phase = "poisoned"; discard(); });
      try {
        if (status !== "open") throw new RestrictedPostgresError("unavailable");
        const result = await client.query(RESTRICTED_LEASE_IDENTITY_SQL);
        const row: unknown = result.rows[0];
        if (result.rows.length !== 1 || !isObject(row) || row.database !== config.database
          || row.login !== config.user || row.effective !== config.user || row.recovery !== false
          || row.tls !== true || row.restricted !== true || row.standalone !== true
          || row.safe_schema !== true || row.safe_tables !== true || !Array.isArray(row.bindings)
          || row.bindings.length !== 1 || !isObject(row.bindings[0])
          || row.bindings[0].tenantId !== tenantId || row.bindings[0].subject !== subject) {
          throw new RestrictedPostgresError("identity");
        }
        if (status !== "open" || released) throw new RestrictedPostgresError("unavailable");
      } catch (error) {
        discard();
        if (error instanceof RestrictedPostgresError) throw error;
        throw new RestrictedPostgresError("identity");
      }

      async function query<R extends QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<R>> {
        // Text/values promise overload only, matching the existing authorization stores.
        const permittedSetting = ["SET LOCAL lock_timeout = '5s'", "SET LOCAL statement_timeout = '10s'",
          "SET LOCAL idle_in_transaction_session_timeout = '15s'"].includes(sql);
        if (released || status !== "open" || busy || typeof sql !== "string" || /[;\u0000]/.test(sql)
          || phase === "finished" || (phase === "fresh" && sql !== "BEGIN ISOLATION LEVEL READ COMMITTED")
          || (phase === "active" && !/^\s*SELECT\b/i.test(sql) && !permittedSetting && sql !== "COMMIT" && sql !== "ROLLBACK")
          || (phase === "poisoned" && sql !== "ROLLBACK")) {
          phase = "poisoned";
          discard();
          throw new RestrictedPostgresError("lifecycle");
        }
        busy = true;
        try {
          const result = await client.query<R>(sql, values);
          if (released || status !== "open") throw new RestrictedPostgresError("lifecycle");
          if (sql === "BEGIN ISOLATION LEVEL READ COMMITTED") {
            if (result.command !== "BEGIN") throw new RestrictedPostgresError("lifecycle");
            phase = "active";
          } else if (sql === "COMMIT" || sql === "ROLLBACK") {
            if (result.command !== sql) throw new RestrictedPostgresError("lifecycle");
            phase = "finished";
          }
          return result;
        } catch (error) {
          phase = "poisoned";
          if (error instanceof RestrictedPostgresError) throw error;
          const code = isObject(error) && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)
            ? error.code : undefined;
          // Preserve SQLSTATE for existing stores, never driver text/detail/cause.
          throw new RestrictedPostgresError("query", code);
        } finally {
          busy = false;
        }
      }
      return Object.freeze({
        query: query as AuthorizationPostgresConnection["query"],
        release: () => discard(),
      });
    },
  });
  restrictedSources.set(source, Object.freeze({
    subject, tenantId, database: config.database, login: config.user,
    databaseIdentitySha256: restrictedDatabaseIdentity(config),
  }));

  return Object.freeze({
    sourceForPrincipal(principal: AuthenticatedPrincipal, requestedTenant = tenantId): AuthorizationPostgresSource {
      if (status !== "open" || !isAuthenticatedPrincipal(principal)
        || principal.subject !== subject || requestedTenant !== tenantId) throw new RestrictedPostgresError("identity");
      return source;
    },
    get status() { return status; },
    dispose(): Promise<void> {
      if (disposal) return disposal;
      status = "disposing";
      disposal = (async () => {
        try {
          for (const discard of leases.values()) discard();
          if (pool) await pool.end();
          status = "disposed";
        } catch {
          status = "failed";
          throw new RestrictedPostgresError("disposal");
        }
      })();
      return disposal;
    },
  });
}
