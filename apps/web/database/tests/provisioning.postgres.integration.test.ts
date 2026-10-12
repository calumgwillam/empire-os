import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateDurableAuthorityState } from "../../app/lib/durable-authorization-state";
import { provisioningDisposableConfig } from "./provisioning-disposable-config";
import {
  connectDisposable,
  migrateEmptyProvisioningDisposable,
  seedDataset,
} from "./postgres-harness";

const configuration = provisioningDisposableConfig(process.env);
const founderSubject = "user_founder";
const employeeSubject = "user_employee";

type Fixture = Readonly<{
  tenantId: string;
  datasetId: string;
  revision: number;
}>;
type ProvisioningRequest = Readonly<{
  operationId: string;
  tenantId: string;
  expectedPolicyRevision: number;
  command: Readonly<{
    kind: "provision-member";
    subject: string;
    roleIds: readonly string[];
  }>;
}>;

describe.skipIf(configuration.status === "skip")(
  "REAL NEW disposable PostgreSQL employee provisioning candidate",
  () => {
    let admin: Client;
    const connections: Client[] = [];
    let founderRole: string;
    let employeeRole: string;
    const passwords = new Map<string, string>();
    const datasets = new Map<string, string>();

    async function restrictedLogin(canProvision: boolean): Promise<string> {
      if (configuration.status !== "configured") throw new Error("Missing disposable configuration.");
      const name = `empire_os_provision_test_${randomUUID().replaceAll("-", "")}`;
      const password = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
      passwords.set(name, password);
      await admin.query(
        `CREATE ROLE "${name}" LOGIN PASSWORD '${password}'
         NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`,
      );
      await admin.query(`GRANT CONNECT ON DATABASE "${configuration.config.database}" TO "${name}"`);
      await admin.query(`GRANT USAGE ON SCHEMA empire_os_authorization TO "${name}"`);
      await admin.query(
        `GRANT SELECT ON empire_os_authorization.tenants,
          empire_os_authorization.datasets,empire_os_authorization.role_tenants TO "${name}"`,
      );
      if (canProvision) {
        await admin.query(
          `GRANT EXECUTE ON FUNCTION empire_os_authorization.provision_member(text,jsonb) TO "${name}"`,
        );
      }
      return name;
    }

    beforeAll(async () => {
      if (configuration.status !== "configured") {
        throw new Error("A separately configured fresh provisioning database is required.");
      }
      admin = await connectDisposable(configuration.config);
      const identity = await admin.query<{ superuser: boolean }>(
        "SELECT rolsuper AS superuser FROM pg_roles WHERE rolname=current_user",
      );
      if (!identity.rows[0]?.superuser) {
        throw new Error("Provisioning fixture setup requires a disposable-instance superuser.");
      }

      // This helper refuses unmarked or non-empty databases and applies only to this
      // explicitly configured disposable database. Migration 005 is never applied.
      await migrateEmptyProvisioningDisposable(admin);

      founderRole = await restrictedLogin(true);
      employeeRole = await restrictedLogin(false);
    }, 30000);

    afterAll(async () => {
      for (const client of connections) await client.end();
      if (admin) await admin.end();
    });

    async function fixture(options: {
      existingEmployee?: boolean;
      removedSubject?: string;
      revokedRole?: boolean;
      duplicateRole?: boolean;
      revokedTenant?: boolean;
    } = {}): Promise<Fixture> {
      const tenantId = `tenant-${randomUUID()}`;
      const datasetId = randomUUID();
      const revision = options.removedSubject || options.revokedRole ? 2 : 1;
      const memberships: Array<{
        subject: string;
        tenantId: string;
        revision: number;
        status: "active" | "revoked";
        roleIds: string[];
      }> = [{
        subject: founderSubject,
        tenantId,
        revision: 1,
        status: "active",
        roleIds: [],
      }];
      if (options.existingEmployee) {
        memberships.push({
          subject: employeeSubject,
          tenantId,
          revision: 1,
          status: "active",
          roleIds: [],
        });
      }
      if (options.removedSubject) {
        memberships.push({
          subject: options.removedSubject,
          tenantId,
          revision: 1,
          status: "revoked",
          roleIds: [],
        });
      }
      const roles = [{
        id: "role_active",
        tenantId,
        revision: 1,
        status: "active",
        grants: [{
          id: "grant_read",
          datasetId,
          capability: "read",
          delegable: false,
        }],
      }];
      const revocations: Array<{
        kind: "membership" | "role";
        id: string;
        operationId: string;
        policyRevision: number;
        revokedAt: number;
      }> = [];
      if (options.removedSubject) {
        revocations.push({
          kind: "membership",
          id: options.removedSubject,
          operationId: "remove-employee",
          policyRevision: revision,
          revokedAt: 1,
        });
      }
      if (options.revokedRole) {
        roles.push({
          id: "role_revoked",
          tenantId,
          revision: 1,
          status: "revoked",
          grants: [],
        });
        revocations.push({
          kind: "role",
          id: "role_revoked",
          operationId: "revoke-role",
          policyRevision: revision,
          revokedAt: 1,
        });
      }
      if (options.duplicateRole) {
        roles.push({ ...roles[0], grants: roles[0].grants.map(grant => ({
          ...grant, capability: "write",
        })) });
      }
      const state = {
        schemaVersion: 1,
        snapshot: {
          version: 1,
          revision,
          tenant: {
            id: tenantId, status: options.revokedTenant ? "revoked" : "active",
            ownerSubjects: [founderSubject],
          },
          datasets: [{ tenantId, datasetId }],
          memberships,
          roles,
          delegations: [],
        },
        revocations,
      };

      await admin.query("BEGIN");
      try {
        await seedDataset(admin, datasetId);
        await admin.query(
          "INSERT INTO empire_os_authorization.tenants(tenant_id,revision,state) VALUES ($1,$2,$3::jsonb)",
          [tenantId, revision, JSON.stringify(state)],
        );
        await admin.query(
          "INSERT INTO empire_os_authorization.datasets(tenant_id,dataset_id) VALUES ($1,$2)",
          [tenantId, datasetId],
        );
        await admin.query(
          `INSERT INTO empire_os_authorization.role_tenants(database_role,tenant_id,actor_subject)
           VALUES ($1,$3,$4),($2,$3,$5)`,
          [founderRole, employeeRole, tenantId, founderSubject, employeeSubject],
        );
        await admin.query("COMMIT");
      } catch (error) {
        await admin.query("ROLLBACK");
        throw error;
      }
      datasets.set(tenantId, datasetId);
      return { tenantId, datasetId, revision };
    }

    function requestFor(
      test: Fixture,
      values: Partial<{
        operationId: string;
        subject: string;
        roleIds: string[];
        expectedPolicyRevision: number;
      }> = {},
    ): ProvisioningRequest {
      return {
        operationId: values.operationId ?? `provision:${randomUUID()}`,
        tenantId: test.tenantId,
        expectedPolicyRevision: values.expectedPolicyRevision ?? test.revision,
        command: {
          kind: "provision-member",
          subject: values.subject ?? employeeSubject,
          roleIds: values.roleIds ?? ["role_active"],
        },
      };
    }

    async function assertUnchanged(test: Fixture): Promise<void> {
      const observed = await admin.query<{ revision: string; audits: string }>(
        `SELECT t.revision::text,
          (SELECT count(*)::text FROM empire_os_authorization.audit a
           WHERE a.tenant_id=t.tenant_id) AS audits
         FROM empire_os_authorization.tenants t WHERE t.tenant_id=$1`,
        [test.tenantId],
      );
      expect(observed.rows[0]).toEqual({ revision: String(test.revision), audits: "0" });
    }

    async function runtime(role: string): Promise<Client> {
      if (configuration.status !== "configured") {
        throw new Error("Provisioning database is not configured.");
      }
      const password = passwords.get(role);
      if (!password) throw new Error("Restricted runtime login was not provisioned.");
      const client = await connectDisposable({ ...configuration.config, user: role, password });
      connections.push(client);
      const identity = await client.query<{ principal: string; effective: string; superuser: boolean }>(
        `SELECT session_user AS principal,current_user AS effective,r.rolsuper AS superuser
         FROM pg_roles r WHERE r.rolname=session_user`,
      );
      expect(identity.rows[0]).toEqual({ principal: role, effective: role, superuser: false });
      return client;
    }

    async function invoke(
      client: Client,
      request: ProvisioningRequest,
      commit = true,
      tamper?: (evidence: Record<string, unknown>) => void,
    ): Promise<{ state: unknown; revision: string; actor_subject: string; audit_evidence: unknown }> {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      try {
        const checked = await client.query<{ milliseconds: string }>(
          "SELECT floor(extract(epoch FROM transaction_timestamp())*1000)::text AS milliseconds",
        );
        const checkedAt = Number(checked.rows[0].milliseconds);
        const transactionId = randomUUID();
        const requestText = JSON.stringify(request);
        const decisionId = createHash("sha256")
          .update(JSON.stringify([transactionId, request.operationId, "decision", 1]))
          .digest("hex");
        const datasetId = datasets.get(request.tenantId);
        if (!datasetId) throw new Error("Fixture dataset was not registered.");
        const evidence: Record<string, unknown> = {
          version: 1,
          operationId: request.operationId,
          decisionId,
          transactionId,
          requestSha256: createHash("sha256").update(requestText).digest("hex"),
          actorSubject: founderSubject,
          tenantId: request.tenantId,
          datasetId,
          operation: "provision-member",
          authorityChange: request.command,
          decision: {
            status: "allowed",
            reason: "owner-authority",
            policyVersion: 1,
            observedPolicyRevision: request.expectedPolicyRevision,
          },
          checkedAt,
          completedAt: checkedAt,
          resultingPolicyRevision: request.expectedPolicyRevision + 1,
        };
        tamper?.(evidence);
        const result = await client.query<{
          state: unknown;
          revision: string;
          actor_subject: string;
          audit_evidence: unknown;
        }>(
          `SELECT state,revision::text AS revision,actor_subject,audit_evidence
           FROM empire_os_authorization.provision_member($1,$2::jsonb)`,
          [requestText, JSON.stringify(evidence)],
        );
        if (result.rows.length !== 1) throw new Error("Provisioning API returned no result.");
        if (commit) {
          await client.query("COMMIT");
        } else {
          await client.query("ROLLBACK");
        }
        return result.rows[0];
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    it("allows a founder to atomically add one member and one immutable audit", async () => {
      const test = await fixture();
      const request = requestFor(test);
      const beforeRow = await admin.query<{ state: unknown }>(
        "SELECT state FROM empire_os_authorization.tenants WHERE tenant_id=$1", [test.tenantId],
      );
      const before = validateDurableAuthorityState(beforeRow.rows[0].state);
      if (before.status !== "valid") throw new Error("Invalid provisioning fixture.");
      const result = await invoke(await runtime(founderRole), request);
      const loaded = validateDurableAuthorityState(result.state);
      expect(loaded.status).toBe("valid");
      if (loaded.status !== "valid") throw new Error("Provisioning returned inconsistent authority.");
      const members = loaded.value.snapshot.memberships;
      expect(result).toMatchObject({ revision: "2", actor_subject: founderSubject });
      expect(members).toHaveLength(2);
      expect(members[1]).toMatchObject({
        subject: employeeSubject,
        status: "active",
        revision: 1,
        roleIds: ["role_active"],
      });
      expect(loaded.value).toEqual({
        ...before.value,
        snapshot: { ...before.value.snapshot, revision: 2, memberships: [
          ...before.value.snapshot.memberships,
          { subject: employeeSubject, tenantId: test.tenantId, revision: 1,
            status: "active", roleIds: ["role_active"] },
        ] },
      });
      const audit = await admin.query<{
        operation: string;
        allowed: boolean;
        resulting_revision: string;
        applied_request_sha256: string;
        evidence: { operation: string; actorSubject: string };
      }>(
        `SELECT evidence->>'operation' AS operation,allowed,resulting_revision::text,
                applied_request_sha256,evidence
         FROM empire_os_authorization.audit WHERE tenant_id=$1`,
        [test.tenantId],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        operation: "provision-member",
        allowed: true,
        resulting_revision: "2",
        applied_request_sha256: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
        evidence: { operation: "provision-member", actorSubject: founderSubject },
      });
    });

    it("denies an employee role and does not grant it provisioning execution", async () => {
      const test = await fixture();
      const privilege = await admin.query<{ can_execute: boolean }>(
        "SELECT has_function_privilege($1,'empire_os_authorization.provision_member(text,jsonb)','EXECUTE') AS can_execute",
        [employeeRole],
      );
      expect(privilege.rows[0].can_execute).toBe(false);
      await expect(invoke(await runtime(employeeRole), requestFor(test)))
        .rejects.toMatchObject({ code: "42501" });
      const state = await admin.query<{ revision: string }>(
        "SELECT revision::text FROM empire_os_authorization.tenants WHERE tenant_id=$1",
        [test.tenantId],
      );
      expect(state.rows[0].revision).toBe("1");
      expect((await admin.query(
        "SELECT 1 FROM empire_os_authorization.audit WHERE tenant_id=$1",
        [test.tenantId],
      )).rows).toHaveLength(0);
    });

    it("rejects a non-founder even if provisioning EXECUTE was mistakenly granted", async () => {
      const test = await fixture({ existingEmployee: true });
      const mistakenRole = await restrictedLogin(true);
      await admin.query(
        `INSERT INTO empire_os_authorization.role_tenants(database_role,tenant_id,actor_subject)
         VALUES ($1,$2,$3)`,
        [mistakenRole, test.tenantId, employeeSubject],
      );
      await expect(invoke(await runtime(mistakenRole), requestFor(test, { subject: "user_new" })))
        .rejects.toMatchObject({ code: "42501" });
      await assertUnchanged(test);
    });

    it("rejects a privileged session hidden behind a restricted effective role", async () => {
      const test = await fixture();
      if (configuration.status !== "configured") throw new Error("Missing configuration.");
      const disguised = await connectDisposable(configuration.config);
      connections.push(disguised);
      await disguised.query(`SET ROLE "${founderRole}"`);
      await expect(invoke(disguised, requestFor(test)))
        .rejects.toMatchObject({ code: "42501" });
      await assertUnchanged(test);
    });

    it("rejects NOINHERIT membership in another identity and a role with protected DML", async () => {
      const test = await fixture();
      const client = await runtime(founderRole);
      await admin.query(`GRANT "${employeeRole}" TO "${founderRole}"`);
      try {
        await expect(invoke(client, requestFor(test))).rejects.toMatchObject({ code: "42501" });
      } finally {
        await admin.query(`REVOKE "${employeeRole}" FROM "${founderRole}"`);
      }
      const unsafeRole = await restrictedLogin(false);
      await admin.query(`GRANT UPDATE(state) ON empire_os_authorization.tenants TO "${unsafeRole}"`);
      await admin.query(`GRANT "${unsafeRole}" TO "${founderRole}"`);
      try {
        await expect(invoke(client, requestFor(test))).rejects.toMatchObject({ code: "42501" });
      } finally {
        await admin.query(`REVOKE "${unsafeRole}" FROM "${founderRole}"`);
      }
      await assertUnchanged(test);
    });

    it("rejects schema CREATE privileges and keeps internal identity helpers inaccessible", async () => {
      const test = await fixture();
      const client = await runtime(founderRole);
      await expect(client.query("SELECT empire_os_authorization.provisioning_subject($1)", [test.tenantId]))
        .rejects.toMatchObject({ code: "42501" });
      await admin.query(`GRANT CREATE ON SCHEMA empire_os_authorization TO "${founderRole}"`);
      try {
        await expect(invoke(client, requestFor(test))).rejects.toMatchObject({ code: "42501" });
      } finally {
        await admin.query(`REVOKE CREATE ON SCHEMA empire_os_authorization FROM "${founderRole}"`);
      }
      await assertUnchanged(test);
    });

    it("rejects missing and invalid bindings and does not accept actor GUC spoofing", async () => {
      const test = await fixture();
      const unboundRole = await restrictedLogin(true);
      const client = await runtime(unboundRole);
      await client.query("SELECT set_config('empire.actor_subject',$1,false)", [founderSubject]);
      await expect(invoke(client, requestFor(test))).rejects.toMatchObject({ code: "42501" });
      await admin.query(
        `INSERT INTO empire_os_authorization.role_tenants(database_role,tenant_id,actor_subject)
         VALUES ($1,$2,'user_not_a_member')`,
        [unboundRole, test.tenantId],
      );
      await expect(invoke(client, requestFor(test))).rejects.toMatchObject({ code: "42501" });
      await assertUnchanged(test);
    });

    it("denies an unbound tenant and rejects a foreign tenant's audit dataset", async () => {
      const own = await fixture();
      const foreign = await fixture();
      const scopedRole = await restrictedLogin(true);
      await admin.query(
        `INSERT INTO empire_os_authorization.role_tenants(database_role,tenant_id,actor_subject)
         VALUES ($1,$2,$3)`,
        [scopedRole, own.tenantId, founderSubject],
      );
      const client = await runtime(scopedRole);
      expect((await client.query(
        "SELECT 1 FROM empire_os_authorization.tenants WHERE tenant_id=$1", [foreign.tenantId],
      )).rows).toHaveLength(0);
      await expect(invoke(client, requestFor(foreign))).rejects.toMatchObject({ code: "42501" });
      await expect(invoke(client, requestFor(own), true, evidence => {
        evidence.datasetId = foreign.datasetId;
      })).rejects.toMatchObject({ code: "42501" });
      await assertUnchanged(own);
      await assertUnchanged(foreign);
    });

    it("rejects actor claims and unexpected grants in the request itself", async () => {
      const test = await fixture();
      const client = await runtime(founderRole);
      const forgedActor = { ...requestFor(test), actorSubject: founderSubject };
      await expect(invoke(client, forgedActor)).rejects.toMatchObject({ code: "23514" });
      const request = requestFor(test);
      const injectedGrants = {
        ...request,
        command: { ...request.command, grants: [{ capability: "write", delegable: true }] },
      };
      await expect(invoke(client, injectedGrants)).rejects.toMatchObject({ code: "23514" });
      await assertUnchanged(test);
    });

    it("fails closed on ambiguous role definitions and a revoked tenant", async () => {
      // These deliberately inconsistent trusted seeds exercise SQL validation rather
      // than relying on the application's durable-state validator.
      const ambiguous = await fixture({ duplicateRole: true });
      await expect(invoke(await runtime(founderRole), requestFor(ambiguous)))
        .rejects.toMatchObject({ code: "23514" });
      const revoked = await fixture({ revokedTenant: true });
      await expect(invoke(await runtime(founderRole), requestFor(revoked)))
        .rejects.toMatchObject({ code: "42501" });
      await assertUnchanged(ambiguous);
      await assertUnchanged(revoked);
    });

    it.each([
      ["actor", (e: Record<string, unknown>) => { e.actorSubject = employeeSubject; }, "42501"],
      ["request hash", (e: Record<string, unknown>) => { e.requestSha256 = "0".repeat(64); }, "42501"],
      ["decision ID", (e: Record<string, unknown>) => { e.decisionId = "0".repeat(64); }, "42501"],
      ["decision", (e: Record<string, unknown>) => { e.decision = { status: "allowed" }; }, "42501"],
      ["membership effects", (e: Record<string, unknown>) => {
        e.authorityChange = { kind: "provision-member", subject: "user_changed", roleIds: [] };
      }, "42501"],
      ["missing audit field", (e: Record<string, unknown>) => { delete e.decisionId; }, "23514"],
      ["extra audit field", (e: Record<string, unknown>) => { e.grants = ["write"]; }, "23514"],
      ["string clock", (e: Record<string, unknown>) => { e.checkedAt = "1"; }, "23514"],
      ["future clock", (e: Record<string, unknown>) => { e.completedAt = Number.MAX_SAFE_INTEGER; }, "42501"],
      ["revision", (e: Record<string, unknown>) => { e.resultingPolicyRevision = 99; }, "42501"],
    ] as const)("rolls back tampered %s evidence", async (_label, tamper, code) => {
      const test = await fixture();
      await expect(invoke(await runtime(founderRole), requestFor(test), true, tamper))
        .rejects.toMatchObject({ code });
      await assertUnchanged(test);
    });

    it("rolls back an otherwise valid membership when audit insertion fails after the update", async () => {
      const test = await fixture();
      const client = await runtime(founderRole);
      await invoke(client, requestFor(test));
      const previous = await admin.query<{ transaction_id: string; state: unknown }>(
        `SELECT a.transaction_id::text,t.state FROM empire_os_authorization.audit a
         JOIN empire_os_authorization.tenants t USING (tenant_id) WHERE a.tenant_id=$1`,
        [test.tenantId],
      );
      const second = requestFor(test, {
        expectedPolicyRevision: 2, subject: "user_second", operationId: "provision:reused-transaction",
      });
      await expect(invoke(client, second, true, evidence => {
        evidence.transactionId = previous.rows[0].transaction_id;
        evidence.decisionId = createHash("sha256").update(JSON.stringify([
          evidence.transactionId, second.operationId, "decision", 1,
        ])).digest("hex");
      })).rejects.toMatchObject({ code: "23505" });
      const after = await admin.query<{ state: unknown }>(
        "SELECT state FROM empire_os_authorization.tenants WHERE tenant_id=$1", [test.tenantId],
      );
      expect(after.rows[0].state).toEqual(previous.rows[0].state);
      expect((await admin.query(
        "SELECT 1 FROM empire_os_authorization.audit WHERE tenant_id=$1", [test.tenantId],
      )).rows).toHaveLength(1);
    });

    it("keeps committed audit rows immutable even to the fixture administrator", async () => {
      const test = await fixture();
      const request = requestFor(test);
      await invoke(await runtime(founderRole), request);
      const committed = await admin.query<{
        transaction_id: string;
        actor_subject: string;
        evidence: unknown;
      }>(
        `SELECT transaction_id::text,actor_subject,evidence
         FROM empire_os_authorization.audit WHERE tenant_id=$1 AND operation_id=$2`,
        [test.tenantId, request.operationId],
      );
      expect(committed.rowCount).toBe(1);
      expect(committed.rows[0].actor_subject).toBe(founderSubject);
      const transactionId = committed.rows[0].transaction_id;
      await expect(admin.query(
        "UPDATE empire_os_authorization.audit SET actor_subject=$2 WHERE transaction_id=$1 RETURNING transaction_id",
        [transactionId, employeeSubject],
      )).rejects.toMatchObject({
        code: "23514", message: "Authorization evidence and mappings are immutable",
      });
      const afterUpdate = await admin.query(
        `SELECT transaction_id::text,actor_subject,evidence
         FROM empire_os_authorization.audit WHERE transaction_id=$1`,
        [transactionId],
      );
      expect(afterUpdate.rowCount).toBe(1);
      expect(afterUpdate.rows).toEqual(committed.rows);
      await expect(admin.query(
        "DELETE FROM empire_os_authorization.audit WHERE transaction_id=$1 RETURNING transaction_id",
        [transactionId],
      )).rejects.toMatchObject({
        code: "23514", message: "Authorization evidence and mappings are immutable",
      });
      const afterDelete = await admin.query(
        `SELECT transaction_id::text,actor_subject,evidence
         FROM empire_os_authorization.audit WHERE transaction_id=$1`,
        [transactionId],
      );
      expect(afterDelete.rowCount).toBe(1);
      expect(afterDelete.rows).toEqual(committed.rows);
    });

    it("does not let a matching provisioning audit conceal role-grant changes", async () => {
      const test = await fixture();
      const request = requestFor(test);
      const requestText = JSON.stringify(request);
      await admin.query("BEGIN");
      try {
        const clock = await admin.query<{ milliseconds: string }>(
          "SELECT floor(extract(epoch FROM transaction_timestamp())*1000)::text AS milliseconds",
        );
        const transactionId = randomUUID();
        const evidence = {
          version: 1, operationId: request.operationId, transactionId,
          decisionId: createHash("sha256").update(JSON.stringify([
            transactionId, request.operationId, "decision", 1,
          ])).digest("hex"),
          requestSha256: createHash("sha256").update(requestText).digest("hex"),
          actorSubject: founderSubject, tenantId: test.tenantId, datasetId: test.datasetId,
          operation: "provision-member", authorityChange: request.command,
          decision: {
            status: "allowed", reason: "owner-authority", policyVersion: 1, observedPolicyRevision: 1,
          },
          checkedAt: Number(clock.rows[0].milliseconds),
          completedAt: Number(clock.rows[0].milliseconds), resultingPolicyRevision: 2,
        };
        await admin.query(
          `UPDATE empire_os_authorization.tenants
           SET revision=2, state=jsonb_set(jsonb_set(jsonb_set(state,
             '{snapshot,revision}','2'::jsonb),
             '{snapshot,memberships}',(state #> '{snapshot,memberships}') || $2::jsonb),
             '{snapshot,roles,0,grants,0,capability}','"write"'::jsonb)
           WHERE tenant_id=$1`,
          [test.tenantId, JSON.stringify([{
            subject: employeeSubject, tenantId: test.tenantId, revision: 1,
            status: "active", roleIds: ["role_active"],
          }])],
        );
        await admin.query(
          `INSERT INTO empire_os_authorization.audit(
            tenant_id,dataset_id,mapped_dataset_id,transaction_id,operation_id,decision_id,
            actor_subject,allowed,resulting_revision,evidence,applied_request,applied_request_sha256)
           VALUES($1,$2,$2,$3,$4,$5,$6,true,2,$7::jsonb,$8,$9)`,
          [test.tenantId, test.datasetId, transactionId, request.operationId, evidence.decisionId,
            founderSubject, JSON.stringify(evidence), requestText, evidence.requestSha256],
        );
        await expect(admin.query("COMMIT")).rejects.toMatchObject({ code: "23514" });
      } finally {
        await admin.query("ROLLBACK");
      }
      await assertUnchanged(test);
    });

    it("rejects invalid roles, malformed identities and duplicate active memberships", async () => {
      const invalidRoleFixture = await fixture();
      await expect(invoke(
        await runtime(founderRole),
        requestFor(invalidRoleFixture, { roleIds: ["role_missing"] }),
      )).rejects.toMatchObject({ code: "23514" });

      const duplicateRoleFixture = await fixture();
      await expect(invoke(
        await runtime(founderRole),
        requestFor(duplicateRoleFixture, { roleIds: ["role_active", "role_active"] }),
      )).rejects.toMatchObject({ code: "23514" });

      const malformedIdentityFixture = await fixture();
      await expect(invoke(
        await runtime(founderRole),
        requestFor(malformedIdentityFixture, { subject: "not_a_clerk_subject" }),
      )).rejects.toMatchObject({ code: "23514" });

      const duplicateFixture = await fixture({ existingEmployee: true });
      await expect(invoke(await runtime(founderRole), requestFor(duplicateFixture)))
        .rejects.toMatchObject({ code: "23514" });
      for (const test of [
        invalidRoleFixture,
        duplicateRoleFixture,
        malformedIdentityFixture,
        duplicateFixture,
      ]) {
        expect((await admin.query(
          "SELECT revision::text FROM empire_os_authorization.tenants WHERE tenant_id=$1",
          [test.tenantId],
        )).rows[0].revision).toBe("1");
        expect((await admin.query(
          "SELECT 1 FROM empire_os_authorization.audit WHERE tenant_id=$1",
          [test.tenantId],
        )).rows).toHaveLength(0);
      }

      const revokedRoleFixture = await fixture({ revokedRole: true });
      await expect(invoke(
        await runtime(founderRole),
        requestFor(revokedRoleFixture, { roleIds: ["role_revoked"] }),
      )).rejects.toMatchObject({ code: "23514" });
      expect((await admin.query(
        "SELECT revision::text FROM empire_os_authorization.tenants WHERE tenant_id=$1",
        [revokedRoleFixture.tenantId],
      )).rows[0].revision).toBe("2");
      expect((await admin.query(
        "SELECT 1 FROM empire_os_authorization.audit WHERE tenant_id=$1",
        [revokedRoleFixture.tenantId],
      )).rows).toHaveLength(0);
    });

    it("rejects identities present in retained membership revocation evidence", async () => {
      const removedSubject = "user_previously_removed";
      const test = await fixture({ removedSubject });
      await expect(invoke(
        await runtime(founderRole),
        requestFor(test, { subject: removedSubject }),
      )).rejects.toMatchObject({ code: "23514" });
    });

    it("rejects stale expected authority revisions", async () => {
      const test = await fixture();
      await expect(invoke(
        await runtime(founderRole),
        requestFor(test, { expectedPolicyRevision: 0 }),
      )).rejects.toMatchObject({ code: "40001" });
      expect((await admin.query(
        "SELECT revision::text FROM empire_os_authorization.tenants WHERE tenant_id=$1",
        [test.tenantId],
      )).rows[0].revision).toBe("1");
    });

    it("rejects operation replay even when a retry carries a stale revision", async () => {
      const test = await fixture();
      const request = requestFor(test, { operationId: "provision:single-use" });
      await invoke(await runtime(founderRole), request);
      await expect(invoke(await runtime(founderRole), request))
        .rejects.toMatchObject({ code: "23505" });
      expect((await admin.query(
        "SELECT 1 FROM empire_os_authorization.audit WHERE tenant_id=$1",
        [test.tenantId],
      )).rows).toHaveLength(1);
    });

    it("serializes concurrent mutations and lets only one expected-revision writer commit", async () => {
      const test = await fixture();
      const [first, second] = await Promise.all([
        runtime(founderRole),
        runtime(founderRole),
      ]);
      const results = await Promise.allSettled([
        invoke(first, requestFor(test, {
          operationId: "provision:concurrent-a",
          subject: "user_concurrent_a",
        })),
        invoke(second, requestFor(test, {
          operationId: "provision:concurrent-b",
          subject: "user_concurrent_b",
        })),
      ]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      const failure = results.find(result => result.status === "rejected");
      expect(failure).toMatchObject({ reason: { code: "40001" } });
      expect((await admin.query(
        "SELECT revision::text FROM empire_os_authorization.tenants WHERE tenant_id=$1",
        [test.tenantId],
      )).rows[0].revision).toBe("2");
      expect((await admin.query(
        "SELECT 1 FROM empire_os_authorization.audit WHERE tenant_id=$1",
        [test.tenantId],
      )).rows).toHaveLength(1);
    });

    it.each([
      {
        name: "revalidates a binding removed while provisioning waits on the tenant lock",
        commitRemoval: true,
      },
      {
        name: "allows queued provisioning when the locked binding removal is rolled back",
        commitRemoval: false,
      },
    ])("$name", async ({ commitRemoval }) => {
      const test = await fixture();
      const client = await runtime(founderRole);
      const identity = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const blocker = await admin.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const binding = await client.query(
        `SELECT actor_subject FROM empire_os_authorization.role_tenants
         WHERE tenant_id=$1 AND database_role=current_user`,
        [test.tenantId],
      );
      expect(binding.rows).toEqual([{ actor_subject: founderSubject }]);
      await admin.query("BEGIN");
      try {
        const locked = await admin.query<{ tenant_id: string; state: unknown }>(
          "SELECT tenant_id,state FROM empire_os_authorization.tenants WHERE tenant_id=$1 FOR UPDATE",
          [test.tenantId],
        );
        expect(locked.rowCount).toBe(1);
        let settled = false;
        const pending = Promise.allSettled([invoke(client, requestFor(test))]).then(results => {
          settled = true;
          return results;
        });
        try {
          let waiting = false;
          for (let attempt = 0; attempt < 200; attempt += 1) {
            await admin.query("SELECT pg_stat_clear_snapshot()");
            const activity = await admin.query<{ waiting: boolean }>(
              `SELECT state='active' AND wait_event_type='Lock'
                 AND $2::integer = ANY(pg_blocking_pids(pid))
                 AND query LIKE '%FROM empire_os_authorization.provision_member(%' AS waiting
               FROM pg_stat_activity WHERE pid=$1`,
              [identity.rows[0].pid, blocker.rows[0].pid],
            );
            if (activity.rows[0]?.waiting) {
              waiting = true;
              break;
            }
            if (settled) {
              throw new Error("Provisioning finished before reaching the held tenant lock.");
            }
            await delay(10);
          }
          expect(waiting).toBe(true);
          expect(settled).toBe(false);
          const removed = await admin.query(
            `DELETE FROM empire_os_authorization.role_tenants
             WHERE tenant_id=$1 AND database_role=$2 RETURNING actor_subject`,
            [test.tenantId, founderRole],
          );
          expect(removed.rowCount).toBe(1);
          expect(removed.rows).toEqual([{ actor_subject: founderSubject }]);
          expect((await admin.query(
            `SELECT 1 FROM empire_os_authorization.role_tenants
             WHERE tenant_id=$1 AND database_role=$2`,
            [test.tenantId, founderRole],
          )).rows).toHaveLength(0);
          await admin.query(commitRemoval ? "COMMIT" : "ROLLBACK");
        } finally {
          try {
            await admin.query("ROLLBACK");
          } finally {
            await pending;
          }
        }
        const outcomes = await pending;
        if (commitRemoval) {
          expect(outcomes).toMatchObject([{
            status: "rejected", reason: { code: "42501", message: "No authenticated tenant binding" },
          }]);
          await assertUnchanged(test);
          const unchanged = await admin.query<{ state: unknown }>(
            "SELECT state FROM empire_os_authorization.tenants WHERE tenant_id=$1",
            [test.tenantId],
          );
          expect(unchanged.rows[0].state).toEqual(locked.rows[0].state);
        } else {
          expect(outcomes).toMatchObject([{
            status: "fulfilled", value: { revision: "2", actor_subject: founderSubject },
          }]);
          expect((await admin.query(
            "SELECT 1 FROM empire_os_authorization.audit WHERE tenant_id=$1",
            [test.tenantId],
          )).rows).toHaveLength(1);
        }
        const retained = await admin.query(
          `SELECT actor_subject FROM empire_os_authorization.role_tenants
           WHERE tenant_id=$1 AND database_role=$2`,
          [test.tenantId, founderRole],
        );
        expect(retained.rows).toEqual(commitRemoval ? [] : [{ actor_subject: founderSubject }]);
      } finally {
        await admin.query("ROLLBACK");
      }
    }, 15000);

    it("cannot create the same identity twice through concurrent distinct operation IDs", async () => {
      const test = await fixture();
      const [first, second] = await Promise.all([runtime(founderRole), runtime(founderRole)]);
      const outcomes = await Promise.allSettled([
        invoke(first, requestFor(test, { operationId: "duplicate:a" })),
        invoke(second, requestFor(test, { operationId: "duplicate:b" })),
      ]);
      expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.find(result => result.status === "rejected"))
        .toMatchObject({ reason: { code: "40001" } });
      await expect(invoke(first, requestFor(test, {
        operationId: "duplicate:after-lock", expectedPolicyRevision: 2,
      }))).rejects.toMatchObject({ code: "23514" });
      const observed = await admin.query<{ members: string; audits: string }>(
        `SELECT (SELECT count(*)::text FROM jsonb_array_elements(t.state #> '{snapshot,memberships}') m
          WHERE m->>'subject'=$2) AS members,
          (SELECT count(*)::text FROM empire_os_authorization.audit a WHERE a.tenant_id=t.tenant_id) AS audits
         FROM empire_os_authorization.tenants t WHERE t.tenant_id=$1`,
        [test.tenantId, employeeSubject],
      );
      expect(observed.rows[0]).toEqual({ members: "1", audits: "1" });
    });

    it("rolls back membership and audit together when the caller rolls back", async () => {
      const test = await fixture();
      await invoke(await runtime(founderRole), requestFor(test), false);
      const observed = await admin.query<{ revision: string; state: { snapshot: { memberships: unknown[] } } }>(
        "SELECT revision::text,state FROM empire_os_authorization.tenants WHERE tenant_id=$1",
        [test.tenantId],
      );
      expect(observed.rows[0].revision).toBe("1");
      expect(observed.rows[0].state.snapshot.memberships).toHaveLength(1);
      expect((await admin.query(
        "SELECT 1 FROM empire_os_authorization.audit WHERE tenant_id=$1",
        [test.tenantId],
      )).rows).toHaveLength(0);
    });

    it("rejects a changed authority state at commit when its matching audit is missing", async () => {
      const test = await fixture();
      await admin.query("BEGIN");
      await admin.query(
        `UPDATE empire_os_authorization.tenants
         SET revision=revision+1,
             state=jsonb_set(state,'{snapshot,revision}',to_jsonb(revision+1))
         WHERE tenant_id=$1`,
        [test.tenantId],
      );
      await expect(admin.query("COMMIT")).rejects.toMatchObject({ code: "23514" });
      await admin.query("ROLLBACK");
      expect((await admin.query(
        "SELECT revision::text FROM empire_os_authorization.tenants WHERE tenant_id=$1",
        [test.tenantId],
      )).rows[0].revision).toBe("1");
    });
  },
);
