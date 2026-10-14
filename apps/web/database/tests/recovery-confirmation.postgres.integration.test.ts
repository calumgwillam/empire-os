import { randomBytes, randomUUID } from "node:crypto";
import { Pool, type Client, type PoolConfig } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPostgresExceptionalRecoveryConfirmationConsumer } from "../../app/lib/postgres-exceptional-recovery-confirmation-consumer";
import type { ExceptionalRecoveryConsumptionRequest } from "../../app/lib/exceptional-recovery-transaction-gate";
import { recoveryConfirmationDisposableConfig } from "./recovery-confirmation-disposable-config";
import { prepareRecoveryConfirmationFixture } from "./recovery-confirmation-harness";

const configuration = recoveryConfirmationDisposableConfig(process.env);

describe.skipIf(configuration.status === "skip")("REAL new disposable PostgreSQL recovery confirmation", {
  concurrent: false, shuffle: false, retry: 0, repeats: 0,
}, () => {
  let admin: Client;
  let runtimePool: Pool;
  let consumer: ReturnType<typeof createPostgresExceptionalRecoveryConfirmationConsumer>;

  beforeAll(async () => {
    if (configuration.status !== "configured") throw new Error("A separately marked recovery confirmation database is required.");
    const config = configuration.config;
    admin = await prepareRecoveryConfirmationFixture(config);

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

    const runtimeOptions: PoolConfig & { replication: string } = {
      host: config.host, port: config.port, database: config.database,
      user: runtimeLogin, password: runtimePassword, ssl: false,
      max: 2, connectionTimeoutMillis: config.connectionTimeoutMillis,
      statement_timeout: 10000, query_timeout: 12000, lock_timeout: 5000,
      idle_in_transaction_session_timeout: 15000,
      options: "-c search_path=pg_catalog -c row_security=on",
      replication: "false",
      application_name: "empire-os-recovery-confirmation-integration",
    };
    runtimePool = new Pool(runtimeOptions);
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
    try {
      if (runtimePool) await runtimePool.end();
    } finally {
      if (admin) await admin.end();
    }
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
