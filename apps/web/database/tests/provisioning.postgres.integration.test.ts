import { createHash, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

      founderRole = `empire_os_provision_test_${randomUUID().replaceAll("-", "")}`;
      employeeRole = `empire_os_provision_test_${randomUUID().replaceAll("-", "")}`;
      for (const name of [founderRole, employeeRole]) {
        await admin.query(
          `CREATE ROLE "${name}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`,
        );
        await admin.query(`GRANT USAGE ON SCHEMA empire_os_authorization TO "${name}"`);
        await admin.query(
          `GRANT SELECT ON empire_os_authorization.tenants,
             empire_os_authorization.datasets,empire_os_authorization.role_tenants TO "${name}"`,
        );
      }
      // Test-only founder grant. The candidate itself grants no execution to PUBLIC or
      // runtime roles; the employee role intentionally receives no provisioning EXECUTE.
      await admin.query(
        `GRANT EXECUTE ON FUNCTION empire_os_authorization.provision_member(text,jsonb) TO "${founderRole}"`,
      );
    }, 30000);

    afterAll(async () => {
      for (const client of connections) await client.end();
      if (admin) await admin.end();
    });

    async function fixture(options: {
      existingEmployee?: boolean;
      removedSubject?: string;
      revokedRole?: boolean;
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
      const state = {
        schemaVersion: 1,
        snapshot: {
          version: 1,
          revision,
          tenant: { id: tenantId, status: "active", ownerSubjects: [founderSubject] },
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

    async function runtime(role: string): Promise<Client> {
      if (configuration.status !== "configured") {
        throw new Error("Provisioning database is not configured.");
      }
      const client = await connectDisposable(configuration.config);
      connections.push(client);
      await client.query(`SET ROLE "${role}"`);
      return client;
    }

    async function invoke(
      client: Client,
      request: ProvisioningRequest,
      commit = true,
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
        const dataset = await client.query<{ dataset_id: string }>(
          `SELECT dataset_id::text FROM empire_os_authorization.datasets
           WHERE tenant_id=$1 ORDER BY dataset_id LIMIT 1`,
          [request.tenantId],
        );
        const evidence = {
          version: 1,
          operationId: request.operationId,
          decisionId,
          transactionId,
          requestSha256: createHash("sha256").update(requestText).digest("hex"),
          actorSubject: founderSubject,
          tenantId: request.tenantId,
          datasetId: dataset.rows[0].dataset_id,
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
      const result = await invoke(await runtime(founderRole), request);
      const members = (result.state as { snapshot: { memberships: unknown[] } }).snapshot.memberships;
      expect(result).toMatchObject({ revision: "2", actor_subject: founderSubject });
      expect(members).toHaveLength(2);
      expect(members[1]).toMatchObject({
        subject: employeeSubject,
        status: "active",
        revision: 1,
        roleIds: ["role_active"],
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
