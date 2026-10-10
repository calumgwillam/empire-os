import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { EMPIRE_OS_BACKUP_STORAGE_KEYS, PROJECT_STORAGE_KEY, STORAGE_KEY } from "../../app/lib/backup";
import { decodeRawStoreValue, encodeRawStoreValue } from "../../app/lib/server-import-preparation";
import { disposableConfig } from "./disposable-config";

const configuration = disposableConfig(process.env);
if (configuration.status === "skip") console.warn(configuration.reason);

// The driver/harness loads only when explicitly configured. Skips are not database verification.
describe.skipIf(configuration.status === "skip")("REAL disposable PostgreSQL schema integration", () => {
  let admin: Client;
  let harness: typeof import("./postgres-harness");
  beforeAll(async () => {
    if (configuration.status !== "configured") throw new Error("Disposable database is not configured.");
    harness = await import("./postgres-harness");
    admin = await harness.connectDisposable(configuration.config);
    const role = await admin.query<{ superuser: boolean }>("SELECT rolsuper AS superuser FROM pg_roles WHERE rolname = current_user");
    if (!role.rows[0]?.superuser) {
      throw new Error("The isolated schema tests require a disposable-instance superuser for forced-RLS seeding and transactional test roles.");
    }
    await harness.migrateEmptyDisposable(admin);
  }, 15000);
  afterAll(async () => { if (admin) await admin.end(); });

  it("executes the migration and verifies every required table and registry key", async () => {
    const tables = await admin.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='empire_os_preparation' ORDER BY tablename",
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      "dataset_access", "datasets", "generations", "idempotency_results", "import_source_values",
      "import_sources", "store_registry", "store_values", "transaction_reads", "transaction_stores", "transactions",
    ]);
    const keys = await admin.query<{ store_key: string }>(
      "SELECT store_key FROM empire_os_preparation.store_registry ORDER BY registry_position",
    );
    expect(keys.rows.map((row) => row.store_key)).toEqual([...EMPIRE_OS_BACKUP_STORAGE_KEYS]);
    const constraints = await admin.query<{ contype: string; condeferrable: boolean; condeferred: boolean; conname: string }>(
      `SELECT c.contype,c.condeferrable,c.condeferred,c.conname FROM pg_constraint c
       JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='empire_os_preparation'`,
    );
    expect(constraints.rows.some((row) => row.contype === "c")).toBe(true);
    expect(constraints.rows.some((row) => row.contype === "f")).toBe(true);
    expect(constraints.rows.filter((row) => row.contype === "p")).toHaveLength(11);
    expect(constraints.rows.find((row) => row.conname === "dataset_generation"))
      .toMatchObject({ condeferrable: true, condeferred: true });
  });

  it("forces default-denied RLS without runtime policies on all data tables", async () => {
    const rows = await admin.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='empire_os_preparation'
       AND c.relkind='r' AND c.relname<>'store_registry'`,
    );
    expect(rows.rows).toHaveLength(10);
    expect(rows.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const policies = await admin.query("SELECT * FROM pg_policies WHERE schemaname='empire_os_preparation'");
    expect(policies.rows).toHaveLength(0);
  });

  it("refuses migration reruns on a nonempty database instead of destroying evidence", async () => {
    await expect(harness.migrateEmptyDisposable(admin)).rejects.toThrow("not empty");
    expect((await admin.query("SELECT count(*)::text AS count FROM empire_os_preparation.store_registry")).rows[0].count).toBe("21");
  });

  it("rolls back transactional DDL after migration-style execution failure", async () => {
    await expect(admin.query(`BEGIN;
      CREATE TABLE empire_os_preparation.failed_migration_probe(id integer);
      SELECT 1/0;
      COMMIT;`)).rejects.toMatchObject({ code: "22012" });
    await admin.query("ROLLBACK");
    const probe = await admin.query<{ relation: string | null }>(
      "SELECT to_regclass('empire_os_preparation.failed_migration_probe')::text AS relation",
    );
    expect(probe.rows[0].relation).toBeNull();
  });

  it("denies two independent principals, even after explicit test-only SELECT grants", async () => {
    await harness.transaction(admin, async () => {
      const id = randomUUID();
      await harness.seedDataset(admin, id);
      for (let index = 0; index < 2; index++) {
        const name = `empire_os_test_role_${randomUUID().replaceAll("-", "")}`;
        await admin.query(`CREATE ROLE "${name}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);
        await admin.query(`SAVEPOINT principal_check`);
        await admin.query(`SET LOCAL ROLE "${name}"`);
        await expect(admin.query("SELECT * FROM empire_os_preparation.store_values")).rejects.toMatchObject({ code: "42501" });
        await admin.query("ROLLBACK TO SAVEPOINT principal_check");
        await admin.query(`GRANT USAGE ON SCHEMA empire_os_preparation TO "${name}"`);
        await admin.query(`GRANT SELECT ON empire_os_preparation.store_values TO "${name}"`);
        await admin.query(`SET LOCAL ROLE "${name}"`);
        const result = await admin.query("SELECT * FROM empire_os_preparation.store_values");
        expect(result.rows).toHaveLength(0);
        await admin.query("RESET ROLE");
      }
    });
  });

  it.each([null, "", "ascii", "\u0000", "\ud800", "\udfff", "\ud83d\ude00", "e\u0301", ' [{"unknown":"\\u0061"}] '])(
    "round-trips exact bytea values through PostgreSQL: %j", async (raw) => {
      await harness.transaction(admin, async () => {
        const id = randomUUID();
        await harness.seedDataset(admin, id);
        await admin.query(`UPDATE empire_os_preparation.store_values SET raw_value=$1,revision=revision+1
          WHERE dataset_id=$2 AND store_key=$3`, [encodeRawStoreValue(raw), id, STORAGE_KEY]);
        const result = await admin.query<{ raw_value: Buffer | null; revision: string }>(
          "SELECT raw_value,revision FROM empire_os_preparation.store_values WHERE dataset_id=$1 AND store_key=$2", [id, STORAGE_KEY],
        );
        expect(result.rows).toHaveLength(1);
        expect(decodeRawStoreValue(result.rows[0].raw_value)).toBe(raw);
        expect(result.rows[0].revision).toBe("1");
      });
    },
  );

  it("rejects unknown keys, malformed bytea, unsafe revisions and production authority", async () => {
    await harness.transaction(admin, async () => {
      const id = randomUUID();
      await harness.seedDataset(admin, id);
      const cases = [
        { sql: "UPDATE empire_os_preparation.store_values SET raw_value=$1,revision=1 WHERE dataset_id=$2 AND store_key=$3",
          params: [Buffer.from([1]), id, STORAGE_KEY], code: "23514" },
        { sql: "UPDATE empire_os_preparation.store_values SET revision=9007199254740992 WHERE dataset_id=$1", params: [id], code: "23514" },
        { sql: "UPDATE empire_os_preparation.datasets SET authority_mode='active' WHERE dataset_id=$1", params: [id], code: "23514" },
        { sql: "UPDATE empire_os_preparation.datasets SET authority_revision=-1 WHERE dataset_id=$1", params: [id], code: "23514" },
        { sql: "UPDATE empire_os_preparation.datasets SET protocol_version=2 WHERE dataset_id=$1", params: [id], code: "23514" },
        { sql: "INSERT INTO empire_os_preparation.store_values(dataset_id,generation,store_key) VALUES ($1,1,'unknown')",
          params: [id], code: "23503" },
      ];
      for (const entry of cases) {
        await admin.query("SAVEPOINT constraint_check");
        await expect(admin.query(entry.sql, entry.params)).rejects.toMatchObject({ code: entry.code });
        await admin.query("ROLLBACK TO SAVEPOINT constraint_check");
      }
    });
  });

  it("rejects revision skipping, row deletion and source-evidence mutation", async () => {
    await harness.transaction(admin, async () => {
      const id = randomUUID();
      await harness.seedDataset(admin, id);
      await admin.query(`INSERT INTO empire_os_preparation.import_sources(dataset_id,source_sha256,canonical_source)
        VALUES ($1,$2,$3)`, [id, "a".repeat(64), Buffer.from("synthetic")]);
      const operations = [
        "UPDATE empire_os_preparation.store_values SET revision=2 WHERE dataset_id=$1",
        "DELETE FROM empire_os_preparation.store_values WHERE dataset_id=$1",
        "UPDATE empire_os_preparation.import_sources SET canonical_source=''::bytea WHERE dataset_id=$1",
        "DELETE FROM empire_os_preparation.import_sources WHERE dataset_id=$1",
      ];
      for (const sql of operations) {
        await admin.query("SAVEPOINT evidence_check");
        await expect(admin.query(sql, [id])).rejects.toMatchObject({ code: "23514" });
        await admin.query("ROLLBACK TO SAVEPOINT evidence_check");
      }
    });
  });

  it("rolls back an earlier multi-store write after a later constraint failure", async () => {
    const id = randomUUID();
    await harness.transaction(admin, async () => {
      await harness.seedDataset(admin, id);
      await admin.query("SAVEPOINT batch");
      await admin.query(`UPDATE empire_os_preparation.store_values SET revision=1,raw_value=$1
        WHERE dataset_id=$2 AND store_key=$3`, [encodeRawStoreValue("first"), id, STORAGE_KEY]);
      await expect(admin.query(`UPDATE empire_os_preparation.store_values SET revision=1,raw_value=$1
        WHERE dataset_id=$2 AND store_key=$3`, [Buffer.from([1]), id, PROJECT_STORAGE_KEY])).rejects.toMatchObject({ code: "23514" });
      await admin.query("ROLLBACK TO SAVEPOINT batch");
      const result = await admin.query<{ revision: string; raw_value: Buffer | null }>(
        "SELECT revision,raw_value FROM empire_os_preparation.store_values WHERE dataset_id=$1", [id],
      );
      expect(result.rows).toHaveLength(21);
      expect(result.rows.every((row) => row.revision === "0" && row.raw_value === null)).toBe(true);
    });
    expect((await admin.query("SELECT dataset_id FROM empire_os_preparation.datasets WHERE dataset_id=$1", [id])).rows).toHaveLength(0);
  });

  it("scopes idempotency keys by principal and rejects duplicate reuse within one scope", async () => {
    await harness.transaction(admin, async () => {
      const id = randomUUID();
      const transactionId = randomUUID();
      await harness.seedDataset(admin, id);
      await admin.query(`INSERT INTO empire_os_preparation.transactions
        (transaction_id,dataset_id,generation,authority_revision,protocol_version,commit_sequence,principal_id,operation,request_sha256)
        VALUES ($1,$2,1,0,1,1,'principal-a','write',$3)`, [transactionId, id, "a".repeat(64)]);
      const sql = `INSERT INTO empire_os_preparation.idempotency_results
        (dataset_id,request_generation,principal_id,idempotency_key,operation,request_sha256,transaction_id,result)
        VALUES ($1,1,$2,'same-key','write',$3,$4,'{}')`;
      await admin.query(sql, [id, "principal-a", "a".repeat(64), transactionId]);
      await admin.query(sql, [id, "principal-b", "a".repeat(64), transactionId]);
      const keys = await admin.query<{ principal_id: string }>(
        "SELECT principal_id FROM empire_os_preparation.idempotency_results WHERE dataset_id=$1 ORDER BY principal_id", [id],
      );
      expect(keys.rows.map((row) => row.principal_id)).toEqual(["principal-a", "principal-b"]);
      await admin.query("SAVEPOINT duplicate");
      await expect(admin.query(sql, [id, "principal-a", "b".repeat(64), transactionId])).rejects.toMatchObject({ code: "23505" });
      await admin.query("ROLLBACK TO SAVEPOINT duplicate");
      for (const sql of [
        "UPDATE empire_os_preparation.idempotency_results SET result='{}' WHERE dataset_id=$1",
        "DELETE FROM empire_os_preparation.idempotency_results WHERE dataset_id=$1",
        "DELETE FROM empire_os_preparation.transactions WHERE dataset_id=$1",
      ]) {
        await admin.query("SAVEPOINT immutable_receipt");
        await expect(admin.query(sql, [id])).rejects.toMatchObject({ code: "23514" });
        await admin.query("ROLLBACK TO SAVEPOINT immutable_receipt");
      }
    });
  });

  it("serializes concurrent row updates and rejects the waiting stale revision", async () => {
    if (configuration.status !== "configured") throw new Error("Missing disposable configuration.");
    const id = randomUUID();
    await admin.query("BEGIN");
    await harness.seedDataset(admin, id);
    await admin.query("COMMIT");
    const first = await harness.connectDisposable(configuration.config);
    let second: Client | undefined;
    try {
      second = await harness.connectDisposable(configuration.config);
      await first.query("BEGIN");
      await second.query("BEGIN");
      const pid = await second.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const sql = `UPDATE empire_os_preparation.store_values SET revision=revision+1,raw_value=$1
        WHERE dataset_id=$2 AND store_key=$3 AND revision=0 RETURNING revision`;
      expect((await first.query(sql, [encodeRawStoreValue("winner"), id, STORAGE_KEY])).rowCount).toBe(1);
      const pending = second.query(sql, [encodeRawStoreValue("stale"), id, STORAGE_KEY])
        .then((result) => ({ result }), (error: unknown) => ({ error }));
      const deadline = Date.now() + 3000;
      let blocked = false;
      while (!blocked && Date.now() < deadline) {
        const blockers = await admin.query<{ blocked: boolean }>(
          "SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked", [pid.rows[0].pid],
        );
        blocked = blockers.rows[0].blocked;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await first.query("COMMIT");
      const outcome = await pending;
      if ("error" in outcome) throw outcome.error;
      expect(outcome.result.rowCount).toBe(0);
      await second.query("COMMIT");
      const persisted = await admin.query<{ raw_value: Buffer }>(
        "SELECT raw_value FROM empire_os_preparation.store_values WHERE dataset_id=$1 AND store_key=$2", [id, STORAGE_KEY],
      );
      expect(decodeRawStoreValue(persisted.rows[0].raw_value)).toBe("winner");
    } finally {
      try {
        try { await first.query("ROLLBACK"); } finally { await first.end(); }
      } finally {
        if (second) {
          try { await second.query("ROLLBACK"); } finally { await second.end(); }
        }
      }
    }
  }, 15000);

  it("keeps repeatable-read snapshots consistent across a concurrent commit", async () => {
    if (configuration.status !== "configured") throw new Error("Missing disposable configuration.");
    const id = randomUUID();
    await admin.query("BEGIN");
    await harness.seedDataset(admin, id);
    await admin.query("COMMIT");
    const reader = await harness.connectDisposable(configuration.config);
    try {
      await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const sql = "SELECT revision FROM empire_os_preparation.store_values WHERE dataset_id=$1 AND store_key=$2";
      expect((await reader.query<{ revision: string }>(sql, [id, STORAGE_KEY])).rows[0].revision).toBe("0");
      await admin.query("UPDATE empire_os_preparation.store_values SET revision=1 WHERE dataset_id=$1 AND store_key=$2", [id, STORAGE_KEY]);
      expect((await reader.query<{ revision: string }>(sql, [id, STORAGE_KEY])).rows[0].revision).toBe("0");
      await reader.query("COMMIT");
      expect((await reader.query<{ revision: string }>(sql, [id, STORAGE_KEY])).rows[0].revision).toBe("1");
    } finally {
      try { await reader.query("ROLLBACK"); } finally { await reader.end(); }
    }
  });
});
