import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPostgresExceptionalRecoveryConfirmationConsumer } from "../../app/lib/postgres-exceptional-recovery-confirmation-consumer";
import type { ExceptionalRecoveryConsumptionRequest } from "../../app/lib/exceptional-recovery-transaction-gate";
import {
  recoveryConfirmationDisposableConfig,
  RECOVERY_CONFIRMATION_DISPOSABLE_MARKER,
  verifyRecoveryConfirmationDatabaseIdentity,
} from "./recovery-confirmation-disposable-config";

const configuration = recoveryConfirmationDisposableConfig(process.env);
const CANDIDATE_URL = new URL("../design/sql/exceptional-recovery-confirmation-candidate.sql", import.meta.url);

describe.skipIf(configuration.status === "skip")("REAL new disposable PostgreSQL recovery confirmation", () => {
  let admin: Client;
  let runtimePool: Pool;
  let consumer: ReturnType<typeof createPostgresExceptionalRecoveryConfirmationConsumer>;

  beforeAll(async () => {
    if (configuration.status !== "configured") throw new Error("A separately marked recovery confirmation database is required.");
    const config = configuration.config;
    admin = new Client({
      host: config.host, port: config.port, database: config.database, user: config.user,
      password: config.password, ssl: false, connectionTimeoutMillis: config.connectionTimeoutMillis,
      application_name: config.application_name,
    });
    await admin.connect();
    const identity = await admin.query<{
      database: string; principal: string; marker: string | null; recovery: boolean; superuser: boolean;
    }>(`SELECT current_database() AS database,current_user AS principal,
        shobj_description(oid,'pg_database') AS marker,pg_is_in_recovery() AS recovery,
        (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser
      FROM pg_database WHERE datname=current_database()`);
    if (identity.rows.length !== 1) throw new Error("Recovery fixture database identity is unavailable.");
    verifyRecoveryConfirmationDatabaseIdentity(config, identity.rows[0]);
    if (identity.rows[0].superuser !== true) throw new Error("Fresh recovery fixture setup requires its disposable instance owner.");

    const empty = await admin.query<{ schemas: string; public_relations: string; extensions: string }>(`SELECT
      (SELECT count(*)::text FROM pg_namespace
        WHERE nspname NOT IN ('public','information_schema') AND nspname NOT LIKE 'pg_%') AS schemas,
      (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public') AS public_relations,
      (SELECT count(*)::text FROM pg_extension WHERE extname <> 'plpgsql') AS extensions`);
    if (empty.rows[0].schemas !== "0" || empty.rows[0].public_relations !== "0" || empty.rows[0].extensions !== "0") {
      throw new Error("Recovery fixture is not a fresh empty database; refusing migration or overwrite.");
    }
    await admin.query(await readFile(CANDIDATE_URL, "utf8"));

    // Empty test-only schema probes prove the consumer role cannot reach business authorities.
    await admin.query("CREATE SCHEMA empire_os_preparation");
    await admin.query("CREATE TABLE empire_os_preparation.store_values (store_key text PRIMARY KEY, raw_value bytea)");
    await admin.query("CREATE SCHEMA empire_os_authorization");
    await admin.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");

    const runtimeLogin = `empire_os_recovery_test_${randomUUID().replaceAll("-", "")}`;
    const runtimePassword = randomBytes(32).toString("hex");
    await admin.query(`CREATE ROLE "${runtimeLogin}" LOGIN PASSWORD '${runtimePassword}'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`);
    await admin.query(`GRANT USAGE ON SCHEMA empire_os_recovery TO "${runtimeLogin}"`);
    await admin.query(`GRANT SELECT,INSERT ON empire_os_recovery.confirmations TO "${runtimeLogin}"`);

    runtimePool = new Pool({
      host: config.host, port: config.port, database: config.database,
      user: runtimeLogin, password: runtimePassword, ssl: false,
      max: 2, connectionTimeoutMillis: config.connectionTimeoutMillis,
      statement_timeout: 10000, query_timeout: 12000, lock_timeout: 5000,
      idle_in_transaction_session_timeout: 15000,
      options: "-c search_path=pg_catalog -c row_security=on",
      application_name: "empire-os-recovery-confirmation-integration",
    });
    consumer = createPostgresExceptionalRecoveryConfirmationConsumer({
      database: config.database,
      login: runtimeLogin,
      connectionMode: "disposable-loopback",
      async connect() {
        const client = await runtimePool.connect();
        return {
          async query(sql, values) {
            const result = await client.query(sql, values);
            return { command: result.command, rowCount: result.rowCount, rows: result.rows };
          },
          release(destroy) { client.release(destroy); },
        };
      },
    });
  }, 30000);

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (admin) await admin.end();
    // No schema, role, evidence or fixture cleanup. Each run requires a new marked database.
  });

  function confirmation(suffix: string): ExceptionalRecoveryConsumptionRequest {
    const expiresAtMs = Date.now() + 60_000;
    return Object.freeze({
      challengeSha256: suffix.repeat(64).slice(0, 64),
      nonce: "a".repeat(62) + suffix.repeat(2),
      confirmationId: "b".repeat(62) + suffix.repeat(2),
      attemptId: "c".repeat(62) + suffix.repeat(2),
      expiresAtMs,
    });
  }

  it("serializes concurrent attempts and distinguishes exact replay from conflicting reuse", async () => {
    const selected = confirmation("1");
    const concurrent = await Promise.all([
      consumer.consumeIfUnused(selected),
      consumer.consumeIfUnused(selected),
    ]);
    expect(concurrent.map((result) => result.status).sort()).toEqual(["already-consumed", "consumed"]);

    const conflict = await consumer.consumeIfUnused({
      ...selected,
      confirmationId: "d".repeat(64),
      attemptId: "e".repeat(64),
    });
    expect(conflict).toMatchObject({ status: "conflict" });

    const count = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM empire_os_recovery.confirmations WHERE nonce=$1",
      [selected.nonce],
    );
    expect(count.rows[0].count).toBe("1");
  });

  it("rejects expired and malformed attempts without recording them", async () => {
    expect(await consumer.consumeIfUnused(confirmation("2")))
      .toMatchObject({ status: "consumed" });
    const expired = await consumer.consumeIfUnused({
      ...confirmation("3"),
      expiresAtMs: Date.now() - 1,
    });
    expect(expired).toMatchObject({ status: "expired" });
    expect(await consumer.consumeIfUnused({ ...confirmation("4"), nonce: "malformed" }))
      .toMatchObject({ status: "invalid-input" });
  });

  it("enforces uniqueness and denies mutation privileges to the consumer role", async () => {
    const selected = confirmation("5");
    expect(await consumer.consumeIfUnused(selected)).toMatchObject({ status: "consumed" });
    const runtime = await runtimePool.connect();
    try {
      const duplicateCandidates = [
        { nonce: selected.nonce, confirmationId: "f".repeat(64), attemptId: "9".repeat(64) },
        { nonce: "7".repeat(64), confirmationId: selected.confirmationId, attemptId: "8".repeat(64) },
        { nonce: "6".repeat(64), confirmationId: "5".repeat(64), attemptId: selected.attemptId },
      ];
      for (const duplicate of duplicateCandidates) {
        await expect(runtime.query(
          `INSERT INTO empire_os_recovery.confirmations
            (challenge_sha256,nonce,confirmation_id,attempt_id,expires_at_ms)
            VALUES ($1,$2,$3,$4,$5)`,
          [selected.challengeSha256, duplicate.nonce, duplicate.confirmationId, duplicate.attemptId, selected.expiresAtMs],
        )).rejects.toMatchObject({ code: "23505" });
      }
      await expect(runtime.query("DELETE FROM empire_os_recovery.confirmations WHERE nonce=$1", [selected.nonce]))
        .rejects.toMatchObject({ code: "42501" });
      await expect(runtime.query("UPDATE empire_os_recovery.confirmations SET attempt_id=$1 WHERE nonce=$2", ["8".repeat(64), selected.nonce]))
        .rejects.toMatchObject({ code: "42501" });
      await expect(runtime.query("TRUNCATE empire_os_recovery.confirmations"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(runtime.query("ALTER TABLE empire_os_recovery.confirmations DROP CONSTRAINT confirmations_pkey"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(runtime.query("SELECT * FROM empire_os_preparation.store_values"))
        .rejects.toMatchObject({ code: "42501" });
    } finally {
      runtime.release();
    }
  });

  it("proves a rolled-back PostgreSQL insert does not consume the exact attempt", async () => {
    const selected = confirmation("6");
    await admin.query("BEGIN");
    try {
      await admin.query(
        `INSERT INTO empire_os_recovery.confirmations
          (challenge_sha256,nonce,confirmation_id,attempt_id,expires_at_ms)
          VALUES ($1,$2,$3,$4,$5)`,
        [selected.challengeSha256, selected.nonce, selected.confirmationId, selected.attemptId, selected.expiresAtMs],
      );
      await admin.query("ROLLBACK");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
    expect(await consumer.consumeIfUnused(selected)).toMatchObject({ status: "consumed" });
  });

  it("rechecks expiry at commit and does not retain a transaction that crosses its deadline", async () => {
    const selected = { ...confirmation("7"), expiresAtMs: Date.now() + 200 };
    await admin.query("BEGIN");
    await admin.query(
      `INSERT INTO empire_os_recovery.confirmations
        (challenge_sha256,nonce,confirmation_id,attempt_id,expires_at_ms)
        VALUES ($1,$2,$3,$4,$5)`,
      [selected.challengeSha256, selected.nonce, selected.confirmationId, selected.attemptId, selected.expiresAtMs],
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    await expect(admin.query("COMMIT")).rejects.toMatchObject({ code: "22023" });
    await admin.query("ROLLBACK");
    expect(await consumer.consumeIfUnused(selected)).toMatchObject({ status: "expired" });
  });
});
