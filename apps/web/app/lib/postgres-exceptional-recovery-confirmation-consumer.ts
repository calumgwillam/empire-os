import "server-only";

import type { ExceptionalRecoveryConfirmationConsumer, ExceptionalRecoveryConsumptionRequest, ExceptionalRecoveryConsumptionResult } from "./exceptional-recovery-transaction-gate";

type RecoveryQueryResult = Readonly<{
  command?: string;
  rowCount: number | null;
  rows: readonly Record<string, unknown>[];
}>;

export interface ExceptionalRecoveryPostgresConnection {
  query(sql: string, values?: unknown[]): Promise<RecoveryQueryResult>;
  release(destroy?: boolean): void;
}

export interface ExceptionalRecoveryPostgresSource {
  readonly database: string;
  readonly login: string;
  readonly connectionMode: "verified-tls" | "disposable-loopback";
  // Returns a fresh, bounded, identity-verified lease with search_path fixed to pg_catalog.
  connect(): Promise<ExceptionalRecoveryPostgresConnection>;
}

const HEX_SHA256 = /^[a-f0-9]{64}$/;
const MAX_DATE_MS = 8_640_000_000_000_000;

const CONNECTION_IDENTITY_SQL = `SELECT
  current_database() AS database, session_user AS login, current_user AS effective,
  pg_is_in_recovery() AS recovery,
  inet_client_addr()::text AS client_address,
  EXISTS (SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls,
  current_setting('fsync') = 'on' AS fsync,
  current_setting('full_page_writes') = 'on' AS full_page_writes,
  current_setting('search_path') = 'pg_catalog' AS safe_search_path,
  r.rolcanlogin AS login_enabled,
  r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication AS elevated,
  NOT EXISTS (SELECT 1 FROM pg_roles parent
    WHERE parent.oid<>r.oid AND pg_has_role(r.oid,parent.oid,'MEMBER')) AS standalone,
  NOT has_database_privilege(r.oid,
    (SELECT d.oid FROM pg_database d WHERE d.datname=current_database()),'CREATE') AS no_database_create,
  NOT EXISTS (SELECT 1 FROM pg_namespace n
    WHERE n.nspname IN ('empire_os_preparation','empire_os_authorization')
      AND (has_schema_privilege(r.oid,n.oid,'USAGE') OR has_schema_privilege(r.oid,n.oid,'CREATE'))) AS no_business_schema_access,
  NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','empire_os_recovery')
      AND n.nspname !~ '^pg_'
      AND c.relkind IN ('r','p','v','m','f')
      AND (has_table_privilege(r.oid,c.oid,'SELECT') OR has_table_privilege(r.oid,c.oid,'INSERT')
        OR has_table_privilege(r.oid,c.oid,'UPDATE') OR has_table_privilege(r.oid,c.oid,'DELETE')
        OR has_table_privilege(r.oid,c.oid,'TRUNCATE') OR has_table_privilege(r.oid,c.oid,'REFERENCES')
        OR has_table_privilege(r.oid,c.oid,'TRIGGER'))) AS no_other_table_access,
  NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','empire_os_recovery')
      AND n.nspname !~ '^pg_' AND c.relkind='S'
      AND (has_sequence_privilege(r.oid,c.oid,'USAGE') OR has_sequence_privilege(r.oid,c.oid,'SELECT')
        OR has_sequence_privilege(r.oid,c.oid,'UPDATE'))) AS no_other_sequence_access,
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','empire_os_recovery')
      AND n.nspname !~ '^pg_' AND has_function_privilege(r.oid,p.oid,'EXECUTE')) AS no_other_function_access,
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='empire_os_recovery' AND has_function_privilege(r.oid,p.oid,'EXECUTE'))
      AS no_recovery_function_access,
  NOT EXISTS (SELECT 1 FROM pg_namespace n
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','empire_os_recovery')
      AND n.nspname !~ '^pg_' AND has_schema_privilege(r.oid,n.oid,'CREATE')) AS no_other_schema_create,
  has_schema_privilege(r.oid,'empire_os_recovery','USAGE')
    AND NOT has_schema_privilege(r.oid,'empire_os_recovery','CREATE') AS recovery_schema_access,
  has_table_privilege(r.oid,'empire_os_recovery.confirmations','SELECT')
    AND has_table_privilege(r.oid,'empire_os_recovery.confirmations','INSERT')
    AND NOT has_table_privilege(r.oid,'empire_os_recovery.confirmations','UPDATE')
    AND NOT has_table_privilege(r.oid,'empire_os_recovery.confirmations','DELETE')
    AND NOT has_table_privilege(r.oid,'empire_os_recovery.confirmations','TRUNCATE')
    AND NOT has_table_privilege(r.oid,'empire_os_recovery.confirmations','REFERENCES')
    AND NOT has_table_privilege(r.oid,'empire_os_recovery.confirmations','TRIGGER') AS recovery_table_access,
  NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='empire_os_recovery' AND c.relname='confirmations'
      AND (c.relowner=r.oid OR c.relkind NOT IN ('r','p'))) AS not_recovery_owner
  FROM pg_roles r WHERE r.rolname=session_user`;

const SCHEMA_CONTRACT_SQL = `SELECT
  to_regclass('empire_os_recovery.confirmations') IS NOT NULL AS table_exists,
  (SELECT c.relkind='r' AND c.relpersistence='p'
    FROM pg_class c WHERE c.oid=to_regclass('empire_os_recovery.confirmations')) AS permanent_table,
  (SELECT array_agg(a.attname || ':' || format_type(a.atttypid,a.atttypmod) || ':' || a.attnotnull::text
      ORDER BY a.attnum)
    FROM pg_attribute a
    WHERE a.attrelid=to_regclass('empire_os_recovery.confirmations')
      AND a.attnum>0 AND NOT a.attisdropped)
    = ARRAY[
      'challenge_sha256:text:true','nonce:text:true','confirmation_id:text:true',
      'attempt_id:text:true','expires_at_ms:bigint:true','consumed_at:timestamp with time zone:true'
    ]::text[] AS exact_columns,
  (SELECT count(*)=1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='nonce'
    JOIN pg_index i ON i.indexrelid=c.conindid AND i.indisunique AND i.indisvalid AND i.indisready
    WHERE c.conrelid=to_regclass('empire_os_recovery.confirmations')
      AND c.contype IN ('p','u') AND c.conkey=ARRAY[a.attnum]::smallint[]
      AND c.convalidated AND NOT c.condeferrable) AS nonce_unique,
  (SELECT count(*)=1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='confirmation_id'
    JOIN pg_index i ON i.indexrelid=c.conindid AND i.indisunique AND i.indisvalid AND i.indisready
    WHERE c.conrelid=to_regclass('empire_os_recovery.confirmations')
      AND c.contype IN ('p','u') AND c.conkey=ARRAY[a.attnum]::smallint[]
      AND c.convalidated AND NOT c.condeferrable) AS confirmation_unique,
  (SELECT count(*)=1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='attempt_id'
    JOIN pg_index i ON i.indexrelid=c.conindid AND i.indisunique AND i.indisvalid AND i.indisready
    WHERE c.conrelid=to_regclass('empire_os_recovery.confirmations')
      AND c.contype IN ('p','u') AND c.conkey=ARRAY[a.attnum]::smallint[]
      AND c.convalidated AND NOT c.condeferrable) AS attempt_unique,
  (SELECT count(*)=1 FROM pg_trigger t
    JOIN pg_proc p ON p.oid=t.tgfoid
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE t.tgrelid=to_regclass('empire_os_recovery.confirmations')
      AND NOT t.tgisinternal AND (t.tgtype & 4)<>0
      AND t.tgname='unexpired_confirmation_at_commit'
      AND t.tgdeferrable AND t.tginitdeferred AND t.tgconstraint<>0
      AND n.nspname='empire_os_recovery' AND p.proname='reject_expired_confirmation'
      AND NOT p.prosecdef)
    AND NOT EXISTS (SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid=to_regclass('empire_os_recovery.confirmations')
        AND NOT t.tgisinternal AND (t.tgtype & 4)<>0
        AND t.tgname<>'unexpired_confirmation_at_commit') AS deferred_expiry_trigger,
  NOT EXISTS (SELECT 1 FROM pg_rewrite r
    WHERE r.ev_class=to_regclass('empire_os_recovery.confirmations')
      AND r.rulename<>'_RETURN') AS no_mutating_rules`;

const INSERT_CONFIRMATION_SQL = `INSERT INTO empire_os_recovery.confirmations
  (challenge_sha256,nonce,confirmation_id,attempt_id,expires_at_ms)
  SELECT $1,$2,$3,$4,$5
  WHERE $5::bigint > floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
  ON CONFLICT DO NOTHING`;

const FIND_CONFLICT_SQL = `SELECT challenge_sha256,nonce,confirmation_id,attempt_id,expires_at_ms
  FROM empire_os_recovery.confirmations
  WHERE nonce=$1 OR confirmation_id=$2 OR attempt_id=$3`;

const SERVER_TIME_SQL = "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text AS now_ms";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validRequest(value: unknown): value is ExceptionalRecoveryConsumptionRequest {
  if (!isObject(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 5
    && keys.join(",") === "attemptId,challengeSha256,confirmationId,expiresAtMs,nonce"
    && typeof value.challengeSha256 === "string" && HEX_SHA256.test(value.challengeSha256)
    && typeof value.nonce === "string" && HEX_SHA256.test(value.nonce)
    && typeof value.confirmationId === "string" && HEX_SHA256.test(value.confirmationId)
    && typeof value.attemptId === "string" && HEX_SHA256.test(value.attemptId)
    && typeof value.expiresAtMs === "number" && Number.isSafeInteger(value.expiresAtMs)
    && value.expiresAtMs > 0 && value.expiresAtMs <= MAX_DATE_MS;
}

function validConnectionIdentity(
  value: unknown,
  expected: ExceptionalRecoveryPostgresSource,
): boolean {
  if (!isObject(value)) return false;
  return value.database === expected.database
    && value.login === expected.login
    && value.effective === expected.login
    && value.recovery === false
    && (expected.connectionMode === "verified-tls"
      ? value.tls === true
      : value.tls === false && ["127.0.0.1", "::1"].includes(String(value.client_address)))
    && value.fsync === true
    && value.full_page_writes === true
    && value.safe_search_path === true
    && value.login_enabled === true
    && value.elevated === false
    && value.standalone === true
    && value.no_database_create === true
    && value.no_business_schema_access === true
    && value.no_other_table_access === true
    && value.no_other_sequence_access === true
    && value.no_other_function_access === true
    && value.no_recovery_function_access === true
    && value.no_other_schema_create === true
    && value.recovery_schema_access === true
    && value.recovery_table_access === true
    && value.not_recovery_owner === true;
}

function result(
  status: ExceptionalRecoveryConsumptionResult["status"],
  message?: string,
): ExceptionalRecoveryConsumptionResult {
  return Object.freeze({ status, ...(message === undefined ? {} : { message }) });
}

function exactExistingRow(row: Record<string, unknown>, request: ExceptionalRecoveryConsumptionRequest): boolean {
  return row.challenge_sha256 === request.challengeSha256
    && row.nonce === request.nonce
    && row.confirmation_id === request.confirmationId
    && row.attempt_id === request.attemptId
    && String(row.expires_at_ms) === String(request.expiresAtMs);
}

async function rollback(connection: ExceptionalRecoveryPostgresConnection): Promise<boolean> {
  try {
    return (await connection.query("ROLLBACK")).command === "ROLLBACK";
  } catch {
    return false;
  }
}

export function createPostgresExceptionalRecoveryConfirmationConsumer(
  source: ExceptionalRecoveryPostgresSource,
): ExceptionalRecoveryConfirmationConsumer {
  if (!source.database || !/^[a-z_][a-z0-9_]{0,62}$/.test(source.login)
    || (source.connectionMode === "disposable-loopback"
      && (!/^empire_os_test_recovery_[a-z0-9_]+$/.test(source.database)
        || !/^empire_os_recovery_test_[a-z0-9_]+$/.test(source.login)))
    || !["verified-tls", "disposable-loopback"].includes(source.connectionMode)) {
    throw new Error("Exceptional recovery confirmation source identity is invalid.");
  }

  return Object.freeze({
    async consumeIfUnused(value: ExceptionalRecoveryConsumptionRequest): Promise<ExceptionalRecoveryConsumptionResult> {
      if (!validRequest(value)) return result("invalid-input", "Malformed confirmation-consumption request.");

      let connection: ExceptionalRecoveryPostgresConnection;
      try {
        connection = await source.connect();
      } catch {
        return result("unavailable", "Dedicated confirmation storage could not be reached; request was not submitted.");
      }

      let outcome: ExceptionalRecoveryConsumptionResult = result("uncertain", "Confirmation outcome could not be established.");
      let transactionStarted = false;
      let commitAttempted = false;
      try {
        const identity = await connection.query(CONNECTION_IDENTITY_SQL);
        if (identity.rows.length !== 1 || !validConnectionIdentity(identity.rows[0], source)) {
          outcome = result("unavailable", "Database role, TLS, durability settings, or schema isolation checks failed.");
        } else {
          const contract = await connection.query(SCHEMA_CONTRACT_SQL);
          const contractRow = contract.rows[0];
          if (contract.rows.length !== 1 || !isObject(contractRow)
            || contractRow.table_exists !== true || contractRow.permanent_table !== true
            || contractRow.exact_columns !== true
            || contractRow.nonce_unique !== true || contractRow.confirmation_unique !== true
            || contractRow.attempt_unique !== true || contractRow.deferred_expiry_trigger !== true
            || contractRow.no_mutating_rules !== true) {
            outcome = result("unavailable", "Durable confirmation schema contract or uniqueness constraints are invalid.");
          } else {
            transactionStarted = true;
            const begin = await connection.query("BEGIN ISOLATION LEVEL READ COMMITTED");
            if (begin.command !== "BEGIN") throw new Error("BEGIN was not confirmed.");
            for (const setting of [
              "SET LOCAL search_path = pg_catalog",
              "SET LOCAL lock_timeout = '5s'",
              "SET LOCAL statement_timeout = '10s'",
              "SET LOCAL idle_in_transaction_session_timeout = '15s'",
              "SET LOCAL synchronous_commit = 'on'",
            ]) {
              await connection.query(setting);
            }
            const durability = await connection.query("SHOW synchronous_commit");
            if (durability.rows.length !== 1 || durability.rows[0].synchronous_commit !== "on") {
              throw new Error("Synchronous commit could not be established.");
            }

            const inserted = await connection.query(INSERT_CONFIRMATION_SQL, [
              value.challengeSha256, value.nonce, value.confirmationId, value.attemptId, value.expiresAtMs,
            ]);
            if (inserted.rowCount === 1) {
              commitAttempted = true;
              const commit = await connection.query("COMMIT");
              if (commit.command !== "COMMIT") {
                outcome = result("uncertain", "COMMIT acknowledgement was not conclusive; transaction readiness denied.");
              } else {
                outcome = result("consumed");
              }
            } else if (inserted.rowCount === 0) {
              const serverTime = await connection.query(SERVER_TIME_SQL);
              const rawServerNow = serverTime.rows.length === 1 ? serverTime.rows[0].now_ms : undefined;
              const serverNow = typeof rawServerNow === "string" && /^[0-9]+$/.test(rawServerNow)
                ? Number(rawServerNow)
                : Number.NaN;
              if (!Number.isSafeInteger(serverNow)) {
                throw new Error("Database server time was unavailable.");
              }
              if (value.expiresAtMs <= serverNow) {
                outcome = await rollback(connection)
                  ? result("expired", "Challenge or confirmation expired before durable consumption.")
                  : result("uncertain", "Expiry was observed but transaction rollback was not confirmed.");
                transactionStarted = false;
              } else {
                const conflicts = await connection.query(FIND_CONFLICT_SQL, [
                  value.nonce, value.confirmationId, value.attemptId,
                ]);
                if (conflicts.rows.length === 1 && exactExistingRow(conflicts.rows[0], value)) {
                  outcome = await rollback(connection)
                    ? result("already-consumed", "This exact challenge, confirmation and attempt were already consumed.")
                    : result("uncertain", "Replay was observed but transaction rollback was not confirmed.");
                } else if (conflicts.rows.length > 0) {
                  outcome = await rollback(connection)
                    ? result("conflict", "A nonce, confirmation or attempt identity is already bound to different values.")
                    : result("uncertain", "A conflicting identity was observed but transaction rollback was not confirmed.");
                } else {
                  outcome = await rollback(connection)
                    ? result("unavailable", "No durable row explains the insert conflict; refusing consumption.")
                    : result("uncertain", "Insert conflict was unexplained and rollback was not confirmed.");
                }
                transactionStarted = false;
              }
            } else {
              throw new Error("Insert returned an invalid row count.");
            }
          }
        }
      } catch {
        if (commitAttempted) {
          outcome = result("uncertain", "Database commit outcome is ambiguous; transaction readiness denied.");
        } else if (transactionStarted) {
          outcome = await rollback(connection)
            ? result("unavailable", "Confirmation transaction failed and rollback was confirmed.")
            : result("uncertain", "Confirmation transaction failed and rollback could not be confirmed.");
        } else {
          outcome = result("unavailable", "Confirmation storage validation failed before submission.");
        }
      }

      try {
        connection.release(outcome.status === "uncertain");
      } catch {
        return result("uncertain", "Database connection disposal failed; transaction readiness denied.");
      }
      return outcome;
    },
  });
}
