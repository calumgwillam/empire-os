import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresAuthorizationStore } from "../../app/lib/postgres-authorization-store";
import { createTransactionalAuthorizationExecutor } from "../../app/lib/authorization-transaction";
import type { TransactionalAuthorizationStore } from "../../app/lib/authorization-transaction-contract";
import { authorityFixture, membershipRevocation, preparationWrite, testPrincipal } from "./authorization-fixtures";
import { authorizationDisposableConfig } from "./authorization-disposable-config";
import { connectDisposable, migrateEmptyAuthorizationDisposable, seedDataset } from "./postgres-harness";

const configuration = authorizationDisposableConfig(process.env);
// Dedicated variables only. Never fall back to the populated persistence test database.
describe.skipIf(configuration.status === "skip")("REAL NEW disposable PostgreSQL authorization", () => {
  let admin: Client;
  const connections: Client[] = [];
  let role: string;
  let otherRole: string;
  beforeAll(async () => {
    if (configuration.status !== "configured") throw new Error("New authorization database is not configured.");
    admin = await connectDisposable(configuration.config);
    const identity = await admin.query<{ superuser: boolean }>("SELECT rolsuper AS superuser FROM pg_roles WHERE rolname=current_user");
    if (!identity.rows[0]?.superuser) throw new Error("Disposable fixture provisioning requires a test-instance superuser.");
    // Both migrations are protected by the existing empty-database identity and lock checks.
    await migrateEmptyAuthorizationDisposable(admin);
    role = `empire_os_auth_test_${randomUUID().replaceAll("-", "")}`;
    otherRole = `empire_os_auth_test_${randomUUID().replaceAll("-", "")}`;
    for (const name of [role, otherRole]) {
      await admin.query(`CREATE ROLE "${name}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`);
      await admin.query(`GRANT USAGE ON SCHEMA empire_os_authorization TO "${name}"`);
      await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA empire_os_authorization TO "${name}"`);
      await admin.query(`GRANT UPDATE ON empire_os_authorization.tenants TO "${name}"`);
      await admin.query(`GRANT INSERT ON empire_os_authorization.audit,empire_os_authorization.preparation_writes TO "${name}"`);
    }
  }, 30000);
  afterAll(async () => {
    for (const client of connections) await client.end();
    if (admin) await admin.end();
    // No reset, down migration, role deletion or evidence cleanup.
  });
  async function fixture() {
    const tenantId = randomUUID();
    const datasetId = randomUUID();
    await admin.query("BEGIN");
    try {
      await seedDataset(admin, datasetId);
      await admin.query("INSERT INTO empire_os_authorization.tenants(tenant_id,revision,state) VALUES ($1,1,$2::jsonb)",
        [tenantId, JSON.stringify(authorityFixture(tenantId, datasetId))]);
      await admin.query("INSERT INTO empire_os_authorization.datasets(tenant_id,dataset_id) VALUES ($1,$2)", [tenantId, datasetId]);
      await admin.query("INSERT INTO empire_os_authorization.role_tenants(database_role,tenant_id) VALUES ($1,$2)", [role, tenantId]);
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
    return { tenantId, datasetId };
  }
  async function runtime(name = role) {
    if (configuration.status !== "configured") throw new Error("Missing configuration.");
    const client = await connectDisposable(configuration.config);
    connections.push(client);
    await client.query(`SET ROLE "${name}"`);
    // Test-only SET ROLE on verified admin sessions. Production must use a dedicated
    // restricted login without privilege to RESET ROLE into a superuser.
    const store = createPostgresAuthorizationStore({ connect: async () => ({
      query: client.query.bind(client), release: () => {},
    }) });
    return { client, store, executor: createTransactionalAuthorizationExecutor(store) };
  }
  it("retains original default-denied RLS and refuses setup reruns", async () => {
    expect((await admin.query("SELECT * FROM pg_policies WHERE schemaname='empire_os_preparation'")).rows).toHaveLength(0);
    await expect(migrateEmptyAuthorizationDisposable(admin)).rejects.toThrow("not empty");
    const tables = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='empire_os_authorization' AND c.relkind='r'`,
    );
    expect(tables.rows).toHaveLength(5);
    expect(tables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });
  it("persists an isolated write and matching audit atomically", async () => {
    const { tenantId, datasetId } = await fixture();
    const { executor } = await runtime();
    const result = await executor.execute(await testPrincipal("issuer", datasetId), preparationWrite(tenantId, datasetId, "write"));
    expect(result).toMatchObject({ status: "executed", durability: "transaction-commit-confirmed" });
    expect((await admin.query("SELECT * FROM empire_os_authorization.preparation_writes WHERE tenant_id=$1", [tenantId])).rows).toHaveLength(1);
    expect((await admin.query("SELECT * FROM empire_os_authorization.audit WHERE tenant_id=$1", [tenantId])).rows).toHaveLength(1);
    expect((await admin.query("SELECT revision::text FROM empire_os_preparation.store_values WHERE dataset_id=$1", [datasetId]))
      .rows.every((row) => row.revision === "0")).toBe(true);
  });
  it("RLS prevents unfiltered cross-tenant reads and forged tenant settings", async () => {
    const { tenantId } = await fixture();
    const { client } = await runtime(otherRole);
    await client.query("SELECT set_config('empire_os.tenant_id',$1,false)", [tenantId]);
    expect((await client.query("SELECT * FROM empire_os_authorization.tenants")).rows).toHaveLength(0);
    expect((await client.query("SELECT * FROM empire_os_authorization.datasets")).rows).toHaveLength(0);
    await expect(client.query("UPDATE empire_os_authorization.tenants SET revision=revision+1")).resolves.toMatchObject({ rowCount: 0 });
  });
  it("RLS rejects cross-tenant effect insertion even with table grants", async () => {
    const { tenantId, datasetId } = await fixture();
    const { client } = await runtime(otherRole);
    await expect(client.query(`INSERT INTO empire_os_authorization.preparation_writes
      (tenant_id,dataset_id,transaction_id,store_key,revision) VALUES ($1,$2,$3,'empire-os-captures',1)`,
    [tenantId, datasetId, randomUUID()])).rejects.toMatchObject({ code: "42501" });
  });
  it("a deferred audit failure rolls back the authority revision", async () => {
    const { tenantId } = await fixture();
    const { client } = await runtime();
    await client.query("BEGIN");
    await client.query(`UPDATE empire_os_authorization.tenants SET revision=2,
      state=jsonb_set(state,'{snapshot,revision}','2') WHERE tenant_id=$1`, [tenantId]);
    await expect(client.query("COMMIT")).rejects.toMatchObject({ code: "23514" });
    await client.query("ROLLBACK");
    expect((await admin.query("SELECT revision::text FROM empire_os_authorization.tenants WHERE tenant_id=$1", [tenantId])).rows[0].revision).toBe("1");
  });
  it("rejects duplicate successful operation IDs without a second write", async () => {
    const { tenantId, datasetId } = await fixture();
    const { executor } = await runtime();
    const identity = await testPrincipal("issuer", datasetId);
    expect(await executor.execute(identity, preparationWrite(tenantId, datasetId, "same-id"))).toMatchObject({ status: "executed" });
    expect(await executor.execute(identity, preparationWrite(tenantId, datasetId, "same-id", 1, 1)))
      .toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect((await admin.query("SELECT * FROM empire_os_authorization.preparation_writes WHERE tenant_id=$1", [tenantId])).rows).toHaveLength(1);
  });
  it.each(["write-first", "revoke-first"] as const)("serializes independent connections: %s", async (ordering) => {
    const { tenantId, datasetId } = await fixture();
    const first = await runtime();
    const second = await runtime();
    let resume: () => void = () => {};
    let announce: () => void = () => {};
    const held = new Promise<void>((resolve) => { announce = resolve; });
    const pause = new Promise<void>((resolve) => { resume = resolve; });
    const paused: TransactionalAuthorizationStore = {
      runLocked: (tenant, operation) => first.store.runLocked(tenant, async (tx) => operation({
        ...tx,
        stagePersistence: async (command) => { await tx.stagePersistence(command); announce(); await pause; },
        stageAuthority: async (state) => { await tx.stageAuthority(state); announce(); await pause; },
      })),
    };
    const issuer = await testPrincipal("issuer", datasetId);
    const owner = await testPrincipal("owner", datasetId);
    const firstExecutor = createTransactionalAuthorizationExecutor(paused);
    const firstResult = ordering === "write-first"
      ? firstExecutor.execute(issuer, preparationWrite(tenantId, datasetId, "first-write"))
      : firstExecutor.execute(owner, membershipRevocation(tenantId, datasetId));
    await held;
    const secondResult = ordering === "write-first"
      ? second.executor.execute(owner, membershipRevocation(tenantId, datasetId))
      : second.executor.execute(issuer, preparationWrite(tenantId, datasetId, "queued-write"));
    // First holds the tenant row lock until released, independent of second's arrival.
    resume();
    expect(await firstResult).toMatchObject({ status: "executed" });
    expect(await secondResult).toMatchObject(ordering === "write-first"
      ? { status: "executed" } : { status: "denied", decision: { reason: "stale-policy" } });
    expect(await second.executor.execute(issuer, preparationWrite(tenantId, datasetId, "late-write", 2, ordering === "write-first" ? 1 : 0)))
      .toMatchObject({ status: "denied", decision: { reason: "membership-revoked" } });
  }, 20000);
  it("rejects globally duplicated dataset mappings", async () => {
    const first = await fixture();
    const second = await fixture();
    await expect(admin.query("INSERT INTO empire_os_authorization.datasets(tenant_id,dataset_id) VALUES ($1,$2)",
      [second.tenantId, first.datasetId])).rejects.toMatchObject({ code: "23505" });
  });
  it("rejects writes without an atomic allowed audit at COMMIT", async () => {
    const { tenantId, datasetId } = await fixture();
    const { client } = await runtime();
    await client.query("BEGIN");
    await client.query(`INSERT INTO empire_os_authorization.preparation_writes
      (tenant_id,dataset_id,transaction_id,store_key,revision) VALUES ($1,$2,$3,'empire-os-captures',1)`,
    [tenantId, datasetId, randomUUID()]);
    await expect(client.query("COMMIT")).rejects.toBeDefined();
    await client.query("ROLLBACK");
    expect((await admin.query("SELECT * FROM empire_os_authorization.preparation_writes WHERE tenant_id=$1", [tenantId])).rows).toHaveLength(0);
  });
  it("rolls back delegated writes when database expiry crosses the deferred audit boundary", async () => {
    const issuedAt = Date.now() - 1000;
    const expiresAt = Date.now() + 5000;
    // Fixture-only initial provisioning, not a runtime authority mutation.
    await admin.query("BEGIN");
    const extraTenant = randomUUID();
    const extraDataset = randomUUID();
    await seedDataset(admin, extraDataset);
    const initial = authorityFixture(extraTenant, extraDataset);
    const state = { ...initial, snapshot: { ...initial.snapshot, delegations: [{
      id: "expiring", tenantId: extraTenant, datasetId: extraDataset,
      issuerSubject: "issuer", recipientSubject: "recipient", capability: "write",
      sourceRoleId: "writer", sourceGrantId: "write", sourceRoleRevision: 1,
      issuerMembershipRevision: 1, recipientMembershipRevision: 1, issuedAt, expiresAt, status: "active",
    }] } };
    await admin.query("INSERT INTO empire_os_authorization.tenants(tenant_id,revision,state) VALUES ($1,1,$2::jsonb)",
      [extraTenant, JSON.stringify(state)]);
    await admin.query("INSERT INTO empire_os_authorization.datasets(tenant_id,dataset_id) VALUES ($1,$2)", [extraTenant, extraDataset]);
    await admin.query("INSERT INTO empire_os_authorization.role_tenants(database_role,tenant_id) VALUES ($1,$2)", [role, extraTenant]);
    await admin.query("COMMIT");
    const runtimeStore = await runtime();
    const delayed: TransactionalAuthorizationStore = {
      runLocked: (tenant, operation) => runtimeStore.store.runLocked(tenant, async (tx) => operation({
        ...tx, appendAudit: async (audit) => {
          await tx.appendAudit(audit);
          // Force database time past expiry while preserving the same tenant row lock.
          await runtimeStore.client.query("SELECT pg_sleep(6)");
        },
      })),
    };
    const result = await createTransactionalAuthorizationExecutor(delayed).execute(await testPrincipal("recipient", extraDataset),
      preparationWrite(extraTenant, extraDataset, "expires"));
    expect(result.status).not.toBe("executed");
    expect((await admin.query("SELECT * FROM empire_os_authorization.preparation_writes WHERE tenant_id=$1", [extraTenant])).rows).toHaveLength(0);
    expect((await admin.query("SELECT * FROM empire_os_authorization.audit WHERE tenant_id=$1", [extraTenant])).rows).toHaveLength(0);
  }, 15000);
  it("refuses privileged application connections", async () => {
    const store = createPostgresAuthorizationStore({ connect: async () => ({ query: admin.query.bind(admin), release: () => {} }) });
    const { tenantId, datasetId } = await fixture();
    expect(await createTransactionalAuthorizationExecutor(store).execute(await testPrincipal("owner", datasetId),
      preparationWrite(tenantId, datasetId, "unsafe"))).toMatchObject({ status: "failed", outcome: "rolled-back" });
  });
});
