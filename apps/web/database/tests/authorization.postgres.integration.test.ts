import { createHash, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresAuthorizationStore, createPostgresOperationReconciliationStore } from "../../app/lib/postgres-authorization-store";
import { createPostgresDurableDatasetRepository } from "../../app/lib/durable-dataset-repository";
import { READ_DATASET_SNAPSHOT_SQL } from "../../app/lib/authorized-dataset-read";
import type { WriteBatch } from "../../app/lib/server-persistence-contract";
import { createOperationReconciler } from "../../app/lib/authorization-reconciliation";
import { authorizationRequestContent, createTransactionalAuthorizationExecutor } from "../../app/lib/authorization-transaction";
import type { AuthorizationAuditEvidence } from "../../app/lib/authorization-transaction-contract";
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
  let ownerRole: string;
  let recipientRole: string;
  beforeAll(async () => {
    if (configuration.status !== "configured") throw new Error("New authorization database is not configured.");
    admin = await connectDisposable(configuration.config);
    const identity = await admin.query<{ superuser: boolean }>("SELECT rolsuper AS superuser FROM pg_roles WHERE rolname=current_user");
    if (!identity.rows[0]?.superuser) throw new Error("Disposable fixture provisioning requires a test-instance superuser.");
    // Both migrations are protected by the existing empty-database identity and lock checks.
    await migrateEmptyAuthorizationDisposable(admin);
    role = `empire_os_auth_test_${randomUUID().replaceAll("-", "")}`;
    otherRole = `empire_os_auth_test_${randomUUID().replaceAll("-", "")}`;
    ownerRole = `empire_os_auth_test_${randomUUID().replaceAll("-", "")}`;
    recipientRole = `empire_os_auth_test_${randomUUID().replaceAll("-", "")}`;
    for (const name of [role, otherRole, ownerRole, recipientRole]) {
      await admin.query(`CREATE ROLE "${name}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`);
      await admin.query(`GRANT USAGE ON SCHEMA empire_os_authorization TO "${name}"`);
      await admin.query(`GRANT SELECT ON empire_os_authorization.tenants,
        empire_os_authorization.datasets,empire_os_authorization.role_tenants TO "${name}"`);
      await admin.query(`GRANT SELECT(tenant_id,dataset_id,store_key,revision)
        ON empire_os_authorization.preparation_writes TO "${name}"`);
      await admin.query(`GRANT EXECUTE ON FUNCTION empire_os_authorization.lock_authority(text),
        empire_os_authorization.apply_operation(text,jsonb,jsonb),
        empire_os_authorization.lookup_operation(text,text),
        empire_os_authorization.read_dataset_snapshot(text,uuid) TO "${name}"`);
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
      for (const [name, actor] of [[role, "issuer"], [ownerRole, "owner"], [recipientRole, "recipient"]]) {
        await admin.query("INSERT INTO empire_os_authorization.role_tenants(database_role,tenant_id,actor_subject) VALUES ($1,$2,$3)",
          [name, tenantId, actor]);
      }
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
    const source = { connect: async () => ({ query: client.query.bind(client), release: () => {} }) };
    const store = createPostgresAuthorizationStore(source);
    return { client, store, executor: createTransactionalAuthorizationExecutor(store),
      reconciler: createOperationReconciler(createPostgresOperationReconciliationStore(source)) };
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
  it("binds the actor to the database role, not the server-supplied audit subject", async () => {
    const { tenantId, datasetId } = await fixture();
    const { executor } = await runtime();
    expect(await executor.execute(await testPrincipal("owner", datasetId), membershipRevocation(tenantId, datasetId)))
      .toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect((await admin.query("SELECT revision::text FROM empire_os_authorization.tenants WHERE tenant_id=$1", [tenantId])).rows[0].revision).toBe("1");
    expect((await admin.query("SELECT * FROM empire_os_authorization.audit WHERE tenant_id=$1", [tenantId])).rows).toHaveLength(0);
  });
  it("does not expose audit request contents or raw business values to runtime SQL", async () => {
    const { client } = await runtime();
    await expect(client.query("SELECT * FROM empire_os_authorization.audit")).rejects.toMatchObject({ code: "42501" });
    await expect(client.query("SELECT raw_value FROM empire_os_authorization.preparation_writes"))
      .rejects.toMatchObject({ code: "42501" });
  });
  it("rejects caller-selected stale transaction snapshots", async () => {
    const { tenantId } = await fixture();
    const { client } = await runtime();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await expect(client.query("SELECT * FROM empire_os_authorization.lock_authority($1)", [tenantId]))
      .rejects.toMatchObject({ code: "42501" });
    await client.query("ROLLBACK");
  });
  it.each(["assign-role", "delegate"] as const)("derives the exact %s transition and subsequent recipient access", async (kind) => {
    const { tenantId, datasetId } = await fixture();
    const issuer = await runtime(kind === "assign-role" ? ownerRole : role);
    const recipient = await runtime(recipientRole);
    const request = kind === "assign-role"
      ? { operation: kind, tenantId, datasetId, expectedPolicyRevision: 1, recipientSubject: "recipient", roleId: "writer" }
      : { operation: kind, tenantId, datasetId, expectedPolicyRevision: 1, recipientSubject: "recipient",
        capability: "write" as const, sourceRoleId: "writer", sourceGrantId: "write", expiresAt: Date.now() + 60000 };
    const command = { kind, request };
    expect(await issuer.executor.execute(await testPrincipal(kind === "assign-role" ? "owner" : "issuer", datasetId),
      { tenantId, operationId: `${kind}-recipient`, expectedPolicyRevision: 1, command })).toMatchObject({ status: "executed" });
    expect(await recipient.executor.execute(await testPrincipal("recipient", datasetId),
      preparationWrite(tenantId, datasetId, "recipient-write", 2)))
      .toMatchObject({ status: "executed", decision: { reason: kind === "assign-role" ? "direct-grant" : "delegated-grant" } });
  });
  it("records foreign and nonexistent dataset denials without weakening allowed-effect references", async () => {
    const { tenantId, datasetId } = await fixture();
    const foreign = await fixture();
    const { executor } = await runtime();
    for (const requestedDataset of [foreign.datasetId, randomUUID()]) {
      expect(await executor.execute(await testPrincipal("issuer", datasetId),
        preparationWrite(tenantId, requestedDataset, `denied-${requestedDataset}`)))
        .toMatchObject({ status: "denied", decision: { reason: "dataset-not-authorized" } });
    }
    const audits = await admin.query("SELECT dataset_id,mapped_dataset_id,allowed FROM empire_os_authorization.audit WHERE tenant_id=$1", [tenantId]);
    expect(audits.rows).toHaveLength(2);
    expect(audits.rows.every((row) => row.allowed === false && row.mapped_dataset_id === null)).toBe(true);
    expect((await admin.query("SELECT * FROM empire_os_authorization.preparation_writes WHERE tenant_id=$1", [tenantId])).rows).toHaveLength(0);
  });
  it("rejects committed audit reuse and repackaged allowed evidence after revocation", async () => {
    const { tenantId, datasetId } = await fixture();
    const writer = await runtime();
    const owner = await runtime(ownerRole);
    expect(await writer.executor.execute(await testPrincipal("issuer", datasetId),
      preparationWrite(tenantId, datasetId, "original"))).toMatchObject({ status: "executed" });
    const stored = (await admin.query<{ evidence: AuthorizationAuditEvidence }>(
      "SELECT evidence FROM empire_os_authorization.audit WHERE tenant_id=$1", [tenantId])).rows[0].evidence;
    expect(await owner.executor.execute(await testPrincipal("owner", datasetId),
      membershipRevocation(tenantId, datasetId))).toMatchObject({ status: "executed" });
    // Even a trusted provisioning connection cannot reuse evidence from a prior DB transaction.
    await admin.query("BEGIN");
    await admin.query(`INSERT INTO empire_os_authorization.preparation_writes
      (tenant_id,dataset_id,transaction_id,store_key,revision) VALUES ($1,$2,$3,'empire-os-captures',2)`,
    [tenantId, datasetId, stored.transactionId]);
    await expect(admin.query("COMMIT")).rejects.toMatchObject({ code: "23514" });
    await admin.query("ROLLBACK");
    const content = authorizationRequestContent(preparationWrite(tenantId, datasetId, "repackaged", 2, 1));
    await writer.client.query("BEGIN");
    const time = (await writer.client.query<{ now_ms: string }>(
      "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS now_ms")).rows[0].now_ms;
    const forged = { ...stored, transactionId: randomUUID(), operationId: "repackaged", decisionId: "f".repeat(64),
      requestSha256: createHash("sha256").update(content).digest("hex"), checkedAt: Number(time), completedAt: Number(time),
      resultingPolicyRevision: 2, decision: { ...stored.decision, observedPolicyRevision: 2 } };
    await expect(writer.client.query("SELECT empire_os_authorization.apply_operation($1,$2::jsonb,NULL)",
      [content, JSON.stringify(forged)])).rejects.toMatchObject({ code: "42501" });
    await writer.client.query("ROLLBACK");
    expect((await admin.query("SELECT * FROM empire_os_authorization.preparation_writes WHERE tenant_id=$1", [tenantId])).rows).toHaveLength(1);
  });
  it("rejects nested authority changes outside the independently computed owner operation", async () => {
    const { tenantId, datasetId } = await fixture();
    const owner = await runtime(ownerRole);
    const request = membershipRevocation(tenantId, datasetId);
    const content = authorizationRequestContent(request);
    await owner.client.query("BEGIN");
    const time = Number((await owner.client.query<{ now_ms: string }>(
      "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS now_ms")).rows[0].now_ms);
    const evidence = { version: 1, operationId: request.operationId, decisionId: "a".repeat(64),
      transactionId: randomUUID(), requestSha256: createHash("sha256").update(content).digest("hex"),
      actorSubject: "owner", tenantId, datasetId, operation: "revoke", authorityChange: request.command,
      decision: { status: "allowed", reason: "owner-authority", policyVersion: 1, observedPolicyRevision: 1 },
      checkedAt: time, completedAt: time, resultingPolicyRevision: 2 };
    const initial = authorityFixture(tenantId, datasetId);
    const proposed = { ...initial, snapshot: { ...initial.snapshot, revision: 2,
      memberships: initial.snapshot.memberships.map((member) => member.subject === "issuer"
        ? { ...member, status: "revoked", revision: 2 }
        : member.subject === "recipient" ? { ...member, roleIds: ["writer"], revision: 2 } : member),
    }, revocations: [{ kind: "membership", id: "issuer", operationId: request.operationId, policyRevision: 2, revokedAt: time }] };
    await expect(owner.client.query("SELECT empire_os_authorization.apply_operation($1,$2::jsonb,$3::jsonb)",
      [content, JSON.stringify(evidence), JSON.stringify(proposed)])).rejects.toMatchObject({ code: "42501" });
    await owner.client.query("ROLLBACK");
    expect((await admin.query("SELECT revision::text FROM empire_os_authorization.tenants WHERE tenant_id=$1", [tenantId])).rows[0].revision).toBe("1");
  });
  it("rejects direct authority, audit and effect DML even after accidental table grants", async () => {
    const { tenantId, datasetId } = await fixture();
    const foreign = await fixture();
    const tenantIds = [tenantId, foreign.tenantId];
    const unsafeRole = `empire_os_auth_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE ROLE "${unsafeRole}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`);
    await admin.query(`GRANT USAGE ON SCHEMA empire_os_authorization TO "${unsafeRole}"`);
    await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA empire_os_authorization TO "${unsafeRole}"`);
    await admin.query(`GRANT UPDATE, DELETE ON empire_os_authorization.tenants,
      empire_os_authorization.role_tenants, empire_os_authorization.datasets TO "${unsafeRole}"`);
    await admin.query(`GRANT INSERT ON empire_os_authorization.role_tenants, empire_os_authorization.audit,
      empire_os_authorization.preparation_writes TO "${unsafeRole}"`);
    await admin.query("INSERT INTO empire_os_authorization.role_tenants(database_role,tenant_id,actor_subject) VALUES ($1,$2,'issuer')",
      [unsafeRole, tenantId]);
    // Trusted reads of every protected row, so silently filtered DML cannot pass as a rejection.
    const protectedState = async () => ({
      tenants: (await admin.query(`SELECT tenant_id,revision::text AS revision,state FROM empire_os_authorization.tenants
        WHERE tenant_id = ANY($1) ORDER BY tenant_id`, [tenantIds])).rows,
      bindings: (await admin.query(`SELECT database_role::text AS database_role,tenant_id,actor_subject
        FROM empire_os_authorization.role_tenants WHERE tenant_id = ANY($1) ORDER BY tenant_id,database_role`, [tenantIds])).rows,
      datasets: (await admin.query(`SELECT tenant_id,dataset_id,generation::text AS generation,
        authority_revision::text AS authority_revision FROM empire_os_authorization.datasets
        WHERE tenant_id = ANY($1) ORDER BY tenant_id`, [tenantIds])).rows,
      audit: (await admin.query("SELECT count(*)::text AS count FROM empire_os_authorization.audit WHERE tenant_id = ANY($1)",
        [tenantIds])).rows[0].count,
      writes: (await admin.query("SELECT count(*)::text AS count FROM empire_os_authorization.preparation_writes WHERE tenant_id = ANY($1)",
        [tenantIds])).rows[0].count,
    });
    const before = await protectedState();
    expect(before.bindings).toHaveLength(7);
    expect(before.audit).toBe("0");
    const { client, executor } = await runtime(unsafeRole);
    // Each attempt must fail loudly via the trusted-mutation guard, whether or not RLS exposes the target rows.
    const attempts: Array<[string, unknown[]]> = [
      ["UPDATE empire_os_authorization.tenants SET revision=revision+1 WHERE tenant_id=$1", [tenantId]],
      ["UPDATE empire_os_authorization.tenants SET revision=revision+1 WHERE tenant_id=$1", [foreign.tenantId]],
      ["DELETE FROM empire_os_authorization.tenants WHERE tenant_id=$1", [tenantId]],
      ["UPDATE empire_os_authorization.role_tenants SET actor_subject='owner' WHERE tenant_id=$1", [tenantId]],
      ["UPDATE empire_os_authorization.role_tenants SET actor_subject='owner' WHERE database_role=current_user", []],
      ["UPDATE empire_os_authorization.role_tenants SET database_role=current_user WHERE database_role=$1", [ownerRole]],
      ["UPDATE empire_os_authorization.role_tenants SET tenant_id=$1 WHERE database_role=current_user", [foreign.tenantId]],
      ["DELETE FROM empire_os_authorization.role_tenants WHERE tenant_id=$1", [tenantId]],
      [`INSERT INTO empire_os_authorization.role_tenants(database_role,tenant_id,actor_subject)
        VALUES (current_user,$1,'owner')`, [foreign.tenantId]],
      ["UPDATE empire_os_authorization.datasets SET generation=generation+1 WHERE tenant_id=$1", [tenantId]],
      ["DELETE FROM empire_os_authorization.datasets WHERE tenant_id=$1", [foreign.tenantId]],
      ["INSERT INTO empire_os_authorization.audit(transaction_id) VALUES ($1)", [randomUUID()]],
      [`INSERT INTO empire_os_authorization.preparation_writes
        (tenant_id,dataset_id,transaction_id,store_key,revision) VALUES ($1,$2,$3,'empire-os-captures',1)`,
      [tenantId, datasetId, randomUUID()]],
    ];
    for (const [statement, values] of attempts) {
      await expect(client.query(statement, values), statement)
        .rejects.toMatchObject({ code: "42501", message: "Use the authenticated authorization API" });
    }
    expect(await protectedState()).toEqual(before);
    expect(await executor.execute(await testPrincipal("issuer", datasetId), preparationWrite(tenantId, datasetId, "unsafe")))
      .toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(await protectedState()).toEqual(before);
  });
  it("RLS prevents unfiltered cross-tenant reads and forged tenant settings", async () => {
    const { tenantId } = await fixture();
    const { client } = await runtime(otherRole);
    await client.query("SELECT set_config('empire_os.tenant_id',$1,false)", [tenantId]);
    expect((await client.query("SELECT * FROM empire_os_authorization.tenants")).rows).toHaveLength(0);
    expect((await client.query("SELECT * FROM empire_os_authorization.datasets")).rows).toHaveLength(0);
    await expect(client.query("UPDATE empire_os_authorization.tenants SET revision=revision+1"))
      .rejects.toMatchObject({ code: "42501" });
  });
  it("least privilege rejects direct cross-tenant effect insertion", async () => {
    const { tenantId, datasetId } = await fixture();
    const { client } = await runtime(otherRole);
    await expect(client.query(`INSERT INTO empire_os_authorization.preparation_writes
      (tenant_id,dataset_id,transaction_id,store_key,revision) VALUES ($1,$2,$3,'empire-os-captures',1)`,
    [tenantId, datasetId, randomUUID()])).rejects.toMatchObject({ code: "42501" });
  });
  it("a deferred audit failure rolls back the authority revision", async () => {
    const { tenantId } = await fixture();
    await admin.query("BEGIN");
    await admin.query(`UPDATE empire_os_authorization.tenants SET revision=2,
      state=jsonb_set(state,'{snapshot,revision}','2') WHERE tenant_id=$1`, [tenantId]);
    await expect(admin.query("COMMIT")).rejects.toMatchObject({ code: "23514" });
    await admin.query("ROLLBACK");
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
  it("reconciles a committed operation, and a rejected retry, to the single original effect", async () => {
    const { tenantId, datasetId } = await fixture();
    const { executor, reconciler } = await runtime();
    const identity = await testPrincipal("issuer", datasetId);
    const request = preparationWrite(tenantId, datasetId, "reconcile-me");
    const executed = await executor.execute(identity, request);
    expect(executed).toMatchObject({ status: "executed" });
    if (executed.status !== "executed") throw new Error("Expected execution.");
    // The same request after commit is what a client with a lost COMMIT acknowledgement retries.
    expect((await executor.execute(identity, request)).status).not.toBe("executed");
    expect(await reconciler.reconcile(identity, request)).toEqual({
      status: "executed", operationId: "reconcile-me", transactionId: executed.transactionId,
      decisionId: executed.decisionId, decision: executed.decision, resultingPolicyRevision: 1,
      source: "committed-database-read",
    });
    expect((await admin.query("SELECT * FROM empire_os_authorization.preparation_writes WHERE tenant_id=$1", [tenantId])).rows).toHaveLength(1);
    expect(await reconciler.reconcile(identity, preparationWrite(tenantId, datasetId, "reconcile-me", 1, 1)))
      .toMatchObject({ status: "conflict", operationId: "reconcile-me" });
  });
  it("reports not-executed definitively, then allows the original request to execute once", async () => {
    const { tenantId, datasetId } = await fixture();
    const { executor, reconciler } = await runtime();
    const identity = await testPrincipal("issuer", datasetId);
    const request = preparationWrite(tenantId, datasetId, "never-sent");
    expect(await reconciler.reconcile(identity, request)).toEqual({
      status: "not-executed", operationId: "never-sent", observedPolicyRevision: 1, source: "committed-database-read",
    });
    expect(await executor.execute(identity, request)).toMatchObject({ status: "executed" });
    expect(await reconciler.reconcile(identity, request)).toMatchObject({ status: "executed" });
  });
  it("reconciliation is actor-bound, membership-gated, read-only and never returns request contents", async () => {
    const { tenantId, datasetId } = await fixture();
    const issuer = await runtime();
    const owner = await runtime(ownerRole);
    const request = preparationWrite(tenantId, datasetId, "private-op");
    expect(await issuer.executor.execute(await testPrincipal("issuer", datasetId), request)).toMatchObject({ status: "executed" });
    // Another member using the same operation ID sees only its own (absent) history.
    expect(await owner.reconciler.reconcile(await testPrincipal("owner", datasetId), request))
      .toMatchObject({ status: "not-executed" });
    // A principal that differs from the database-bound actor learns nothing.
    expect(await owner.reconciler.reconcile(await testPrincipal("issuer", datasetId), request))
      .toEqual({ status: "unauthorized", reason: "forbidden" });
    const raw = await issuer.client.query("SELECT * FROM empire_os_authorization.lookup_operation($1,$2)", [tenantId, "private-op"]);
    expect(raw.rows).toHaveLength(1);
    expect(JSON.stringify(raw.rows[0].records)).not.toContain("applied_request\"");
    expect(Object.keys(raw.rows[0].records[0]).sort()).toEqual(
      ["allowed", "decisionId", "evidence", "requestSha256", "resultingPolicyRevision", "transactionId"]);
    expect(JSON.stringify(raw.rows[0].records)).not.toContain("rawValue");
    expect(await owner.executor.execute(await testPrincipal("owner", datasetId), membershipRevocation(tenantId, datasetId)))
      .toMatchObject({ status: "executed" });
    const revoked = await runtime();
    expect(await revoked.reconciler.reconcile(await testPrincipal("issuer", datasetId), request))
      .toEqual({ status: "unauthorized", reason: "forbidden" });
    const hidden = await revoked.client.query("SELECT authorized,records FROM empire_os_authorization.lookup_operation($1,$2)",
      [tenantId, "private-op"]);
    expect(hidden.rows).toEqual([{ authorized: false, records: [] }]);
    const before = (await admin.query("SELECT count(*)::int AS n FROM empire_os_authorization.audit WHERE tenant_id=$1", [tenantId])).rows[0].n;
    await revoked.client.query("BEGIN");
    await revoked.client.query("SELECT * FROM empire_os_authorization.lookup_operation($1,$2)", [tenantId, "private-op"]);
    await revoked.client.query("ROLLBACK");
    expect((await admin.query("SELECT count(*)::int AS n FROM empire_os_authorization.audit WHERE tenant_id=$1", [tenantId])).rows[0].n)
      .toBe(before);
  });
  it("reconciliation waits for an in-flight tenant transaction before answering", async () => {
    const { tenantId, datasetId } = await fixture();
    const writer = await runtime();
    const observer = await runtime();
    let resume: () => void = () => {};
    let announce: () => void = () => {};
    const held = new Promise<void>((resolve) => { announce = resolve; });
    const pause = new Promise<void>((resolve) => { resume = resolve; });
    const paused: TransactionalAuthorizationStore = {
      runLocked: (tenant, operation, request) => writer.store.runLocked(tenant, async (tx) => operation({
        ...tx, appendAudit: async (audit) => { await tx.appendAudit(audit); announce(); await pause; },
      }), request),
    };
    const identity = await testPrincipal("issuer", datasetId);
    const request = preparationWrite(tenantId, datasetId, "in-flight");
    const pending = createTransactionalAuthorizationExecutor(paused).execute(identity, request);
    await held;
    let settled = false;
    const lookup = observer.reconciler.reconcile(identity, request).then((result) => { settled = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    resume();
    expect(await pending).toMatchObject({ status: "executed" });
    expect(await lookup).toMatchObject({ status: "executed", operationId: "in-flight" });
  }, 20000);
  it("lookup_operation refuses stale snapshots and invalid identifiers", async () => {
    const { tenantId } = await fixture();
    const { client } = await runtime();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await expect(client.query("SELECT * FROM empire_os_authorization.lookup_operation($1,'x')", [tenantId]))
      .rejects.toBeDefined();
    await client.query("ROLLBACK");
    await expect(client.query("SELECT * FROM empire_os_authorization.lookup_operation($1,'bad id')", [tenantId]))
      .rejects.toMatchObject({ code: "22023" });
  });
  it.each(["write-first", "revoke-first"] as const)("serializes independent connections: %s", async (ordering) => {
    const { tenantId, datasetId } = await fixture();
    const first = await runtime(ordering === "write-first" ? role : ownerRole);
    const second = await runtime(ordering === "write-first" ? ownerRole : role);
    let resume: () => void = () => {};
    let announce: () => void = () => {};
    const held = new Promise<void>((resolve) => { announce = resolve; });
    const pause = new Promise<void>((resolve) => { resume = resolve; });
    const paused: TransactionalAuthorizationStore = {
      runLocked: (tenant, operation, request) => first.store.runLocked(tenant, async (tx) => operation({
        ...tx,
        stagePersistence: async (command) => { await tx.stagePersistence(command); announce(); await pause; },
        stageAuthority: async (state) => { await tx.stageAuthority(state); announce(); await pause; },
      }), request),
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
    const issuerRuntime = await runtime();
    expect(await issuerRuntime.executor.execute(issuer, preparationWrite(tenantId, datasetId, "late-write", 2, ordering === "write-first" ? 1 : 0)))
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
    await admin.query("BEGIN");
    await admin.query(`INSERT INTO empire_os_authorization.preparation_writes
      (tenant_id,dataset_id,transaction_id,store_key,revision) VALUES ($1,$2,$3,'empire-os-captures',1)`,
    [tenantId, datasetId, randomUUID()]);
    await expect(admin.query("COMMIT")).rejects.toBeDefined();
    await admin.query("ROLLBACK");
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
    await admin.query("INSERT INTO empire_os_authorization.role_tenants(database_role,tenant_id,actor_subject) VALUES ($1,$2,'recipient')",
      [recipientRole, extraTenant]);
    await admin.query("COMMIT");
    const runtimeStore = await runtime(recipientRole);
    const delayed: TransactionalAuthorizationStore = {
      runLocked: (tenant, operation, request) => runtimeStore.store.runLocked(tenant, async (tx) => operation({
        ...tx, appendAudit: async (audit) => {
          await tx.appendAudit(audit);
          // Force database time past expiry while preserving the same tenant row lock.
          await runtimeStore.client.query("SELECT pg_sleep(6)");
        },
      }), request),
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
  async function durable(name: string, subject: string, tenantId: string, datasetId: string) {
    const { client } = await runtime(name);
    const source = { connect: async () => ({ query: client.query.bind(client), release: () => {} }) };
    return { client, repository: createPostgresDurableDatasetRepository(await testPrincipal(subject, datasetId), tenantId, source) };
  }
  const captures = (datasetId: string, key: string, rawValue: string | null, expectedRevision = 0): WriteBatch => ({
    fence: { datasetId, protocolVersion: 1, generation: 1, authorityRevision: 0 }, idempotencyKey: key, reads: [],
    writes: [{ key: "empire-os-captures", expectedRevision, rawValue }],
  });
  it("durably writes a validated business dataset with atomic audit and reads it back losslessly", async () => {
    const { tenantId, datasetId } = await fixture();
    const { repository } = await durable(ownerRole, "owner", tenantId, datasetId);
    expect(await repository.readSnapshot({ datasetId, protocolVersion: 1 }))
      .toMatchObject({ status: "snapshot", snapshot: { commitSequence: 0, generation: 1, authorityRevision: 0 } });
    const raw = '[{"id":"capture-ü-😀","unknown":true}]';
    const result = await repository.writeBatch(captures(datasetId, "durable-1", raw));
    expect(result).toMatchObject({ status: "committed", replayed: false,
      receipt: { commitSequence: 1, durability: "database-commit-confirmed", revisions: [{ key: "empire-os-captures", revision: 1 }] } });
    const audit = await admin.query("SELECT transaction_id::text AS id,allowed FROM empire_os_authorization.audit WHERE tenant_id=$1", [tenantId]);
    expect(audit.rows).toEqual([{ id: result.status === "committed" ? result.receipt.transactionId : "", allowed: true }]);
    const read = await repository.readSnapshot({ datasetId, protocolVersion: 1 });
    if (read.status !== "snapshot") throw new Error(JSON.stringify(read));
    expect(read.snapshot.values.find((entry) => entry.key === "empire-os-captures")).toEqual({ key: "empire-os-captures", rawValue: raw, revision: 1 });
    expect(read.snapshot.commitSequence).toBe(1);
  });
  it("durable replay returns the original receipt; key reuse, stale revisions and invalid data change nothing", async () => {
    const { tenantId, datasetId } = await fixture();
    const { repository } = await durable(ownerRole, "owner", tenantId, datasetId);
    const first = await repository.writeBatch(captures(datasetId, "durable-1", "[]"));
    if (first.status !== "committed") throw new Error(JSON.stringify(first));
    const count = async () => (await admin.query("SELECT count(*)::int AS n FROM empire_os_authorization.preparation_writes WHERE tenant_id=$1",
      [tenantId])).rows[0].n;
    expect(await repository.writeBatch(captures(datasetId, "durable-1", "[]")))
      .toMatchObject({ status: "committed", replayed: true, receipt: { transactionId: first.receipt.transactionId } });
    expect(await repository.writeBatch(captures(datasetId, "durable-1", '[{"id":"x","unknown":true}]')))
      .toMatchObject({ status: "conflict", reason: "idempotency-key-reused" });
    expect(await repository.writeBatch(captures(datasetId, "durable-2", "[]"))).toMatchObject({ status: "conflict", reason: "store-revision" });
    expect(await repository.writeBatch(captures(datasetId, "durable-3", "not-json", 1))).toMatchObject({ status: "invalid-request" });
    expect(await count()).toBe(1);
  });
  it("durable reads and writes are denied without read authority and across tenants, disclosing nothing", async () => {
    const { tenantId, datasetId } = await fixture();
    const other = await fixture();
    for (const [name, subject] of [[role, "issuer"], [recipientRole, "recipient"]] as const) {
      const { repository, client } = await durable(name, subject, tenantId, datasetId);
      expect(await repository.readSnapshot({ datasetId, protocolVersion: 1 })).toEqual({ status: "unauthorized", reason: "forbidden" });
      expect(await repository.writeBatch(captures(datasetId, `denied-${subject}`, "[]")))
        .toEqual({ status: "unauthorized", reason: "forbidden" });
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const raw = await client.query(READ_DATASET_SNAPSHOT_SQL, [tenantId, datasetId]);
      expect(raw.rows[0]).toMatchObject({ generation: null, commit_sequence: null, store_values: [] });
      await client.query("ROLLBACK");
    }
    const { repository } = await durable(ownerRole, "owner", tenantId, other.datasetId);
    expect(await repository.readSnapshot({ datasetId: other.datasetId, protocolVersion: 1 }))
      .toEqual({ status: "unauthorized", reason: "forbidden" });
    // A role mapped only to its own tenant cannot read another tenant at all.
    const { client } = await runtime(otherRole);
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await expect(client.query(READ_DATASET_SNAPSHOT_SQL, [tenantId, datasetId])).rejects.toMatchObject({ code: "42501" });
    await client.query("ROLLBACK");
    expect((await admin.query("SELECT count(*)::int AS n FROM empire_os_authorization.preparation_writes WHERE tenant_id=$1",
      [tenantId])).rows[0].n).toBe(0);
  });
  it("read_dataset_snapshot waits for the tenant lock and refuses stale snapshots", async () => {
    const { tenantId, datasetId } = await fixture();
    const writer = await runtime(ownerRole);
    const { client } = await runtime(ownerRole);
    await writer.client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await writer.client.query("SELECT * FROM empire_os_authorization.lock_authority($1)", [tenantId]);
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    let settled = false;
    const pending = client.query(READ_DATASET_SNAPSHOT_SQL, [tenantId, datasetId]).finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    await writer.client.query("ROLLBACK");
    expect((await pending).rows).toHaveLength(1);
    await client.query("ROLLBACK");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await expect(client.query(READ_DATASET_SNAPSHOT_SQL, [tenantId, datasetId])).rejects.toMatchObject({ code: "42501" });
    await client.query("ROLLBACK");
  }, 15000);
});
