import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Client, QueryResult, QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const release = vi.hoisted(() => ({ approved: false }));
vi.mock("../../app/lib/employee-provisioning-release", async importOriginal => {
  const original = await importOriginal<typeof import("../../app/lib/employee-provisioning-release")>();
  return {
    employeeProvisioningRelease: () => release.approved
      ? { status: "approved", migrationVersion: 5 } : original.employeeProvisioningRelease(),
  };
});

import { auditDecisionId } from "../../app/lib/authorization-transaction";
import { validateDurableAuthorityState } from "../../app/lib/durable-authorization-state";
import { employeeProvisioningRequest, type EmployeeProvisioningInput } from "../../app/lib/employee-provisioning-contract";
import { validateMembershipProvisioningTransition } from "../../app/lib/membership-provisioning";
import type { AuthorizationPostgresConnection, AuthorizationPostgresSource } from "../../app/lib/postgres-authorization-store";
import { createPostgresEmployeeProvisioningStore, PROVISIONING_CONTRACT_SQL } from "../../app/lib/postgres-employee-provisioning-store";
import { createServerEmployeeProvisioningAuthority } from "../../app/lib/server-employee-provisioning";
import { createServerPrincipalResolver, isAuthenticatedPrincipal } from "../../app/lib/server-persistence-authority";
import { connectDisposable, migrateEmptyProvisioningDisposable, seedDataset } from "./postgres-harness";
import { provisioningAdapterDisposableConfig } from "./provisioning-adapter-disposable-config";

const configuration = provisioningAdapterDisposableConfig(process.env);
const founder = "user_founder";
const employee = "user_existing_employee";
type Fixture = Readonly<{ tenantId: string; datasetIds: string[]; revision: number; before: unknown }>;
type Login = Readonly<{ role: string; password: string }>;
type Fault = "tamper-evidence" | "corrupt-result" | "sql-after-mutation"
  | "lost-commit-ack" | "commit-not-sent" | "lost-rollback-ack" | "duplicate-audit-transaction";

describe.skipIf(configuration.status === "skip")(
  "REAL PostgreSQL 16 provisioning SERVER ADAPTER on a NEW disposable database",
  () => {
    let admin: Client;
    let founderLogin: Login;
    let employeeLogin: Login;
    const clients: Client[] = [];
    const endings: Promise<void>[] = [];

    beforeAll(async () => {
      if (configuration.status !== "configured") throw new Error("NEW adapter disposable configuration required.");
      admin = await connectDisposable(configuration.config);
      const identity = await admin.query<{ superuser: boolean; version: string }>(
        "SELECT rolsuper AS superuser,current_setting('server_version_num') AS version FROM pg_roles WHERE rolname=current_user",
      );
      expect(identity.rows).toHaveLength(1);
      if (!identity.rows[0].superuser || Math.floor(Number(identity.rows[0].version) / 10000) !== 16) {
        throw new Error("Adapter fixtures require PostgreSQL 16 on a verified disposable-instance superuser.");
      }
      // Retains the identity marker, advisory lock, and zero-object checks. Never runs 005.
      await migrateEmptyProvisioningDisposable(admin);
      founderLogin = await login(true);
      employeeLogin = await login(false);
      // Vitest module-local substitution only, AFTER verified fresh database setup.
      release.approved = true;
    }, 30000);

    afterAll(async () => {
      release.approved = false;
      await Promise.all(endings);
      for (const client of clients) await client.end();
      if (admin) await admin.end();
    });

    async function login(provision: boolean): Promise<Login> {
      if (configuration.status !== "configured") throw new Error("Missing disposable configuration.");
      const role = `empire_os_adapter_test_${randomUUID().replaceAll("-", "")}`;
      const password = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
      await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'
        NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`);
      await admin.query(`GRANT CONNECT ON DATABASE "${configuration.config.database}" TO "${role}"`);
      await admin.query(`GRANT USAGE ON SCHEMA empire_os_authorization TO "${role}"`);
      await admin.query(`GRANT SELECT ON empire_os_authorization.tenants,
        empire_os_authorization.datasets,empire_os_authorization.role_tenants TO "${role}"`);
      await admin.query(`GRANT EXECUTE ON FUNCTION empire_os_authorization.lookup_operation(text,text) TO "${role}"`);
      if (provision) {
        await admin.query(`GRANT EXECUTE ON FUNCTION empire_os_authorization.provision_member(text,jsonb) TO "${role}"`);
      }
      return { role, password };
    }

    async function fixture(options: {
      revokedEmployee?: boolean; revokedRole?: boolean; revokedTenant?: boolean;
    } = {}): Promise<Fixture> {
      const tenantId = `tenant-${randomUUID()}`;
      const datasetIds = [randomUUID(), randomUUID()].sort();
      const revision = options.revokedEmployee || options.revokedRole ? 2 : 1;
      const before = {
        schemaVersion: 1,
        snapshot: {
          version: 1, revision,
          tenant: { id: tenantId, status: options.revokedTenant ? "revoked" : "active", ownerSubjects: [founder] },
          datasets: datasetIds.map(datasetId => ({ tenantId, datasetId })),
          memberships: [
            { subject: founder, tenantId, revision: 1, status: "active", roleIds: [] },
            { subject: employee, tenantId, revision: 1, status: options.revokedEmployee ? "revoked" : "active",
              roleIds: options.revokedEmployee ? [] : ["role_active"] },
          ],
          roles: [{
            id: "role_active", tenantId, revision: 1, status: "active",
            grants: [{ id: "grant_read", datasetId: datasetIds[0], capability: "read", delegable: false }],
          }, ...(options.revokedRole ? [{
            id: "role_revoked", tenantId, revision: 1, status: "revoked", grants: [],
          }] : [])],
          delegations: [],
        },
        revocations: [
          ...(options.revokedEmployee ? [{
            kind: "membership", id: employee, operationId: "fixture-revoke-member",
            policyRevision: revision, revokedAt: 1,
          }] : []),
          ...(options.revokedRole ? [{
            kind: "role", id: "role_revoked", operationId: "fixture-revoke-role",
            policyRevision: revision, revokedAt: 1,
          }] : []),
        ],
      };
      expect(validateDurableAuthorityState(before).status).toBe("valid");
      await admin.query("BEGIN");
      try {
        for (const datasetId of datasetIds) await seedDataset(admin, datasetId);
        await admin.query("INSERT INTO empire_os_authorization.tenants(tenant_id,revision,state) VALUES ($1,$2,$3::jsonb)",
          [tenantId, revision, JSON.stringify(before)]);
        for (const datasetId of datasetIds) {
          await admin.query("INSERT INTO empire_os_authorization.datasets(tenant_id,dataset_id) VALUES ($1,$2)",
            [tenantId, datasetId]);
        }
        await admin.query(`INSERT INTO empire_os_authorization.role_tenants(database_role,tenant_id,actor_subject)
          VALUES ($1,$3,$4),($2,$3,$5)`, [founderLogin.role, employeeLogin.role, tenantId, founder, employee]);
        await admin.query("COMMIT");
      } catch (error) {
        await admin.query("ROLLBACK");
        throw error;
      }
      return { tenantId, datasetIds, revision, before };
    }

    function input(overrides: Partial<EmployeeProvisioningInput> = {}): EmployeeProvisioningInput {
      return { operationId: `adapter:${randomUUID()}`, expectedPolicyRevision: 1,
        subject: `user_new_${randomUUID().replaceAll("-", "")}`, roleIds: ["role_active"], ...overrides };
    }

    async function principal(subject: string) {
      const value = await createServerPrincipalResolver(async () => ({ status: "authenticated", subject }))(
        new Request("https://empire-os.invalid"),
      );
      if (!isAuthenticatedPrincipal(value)) throw new Error("Test principal not minted.");
      return value;
    }

    function source(identity: Login = founderLogin, fault?: Fault, reusedTransactionId?: string) {
      const statements: string[] = [];
      const codes: string[] = [];
      const releases: boolean[] = [];
      const acknowledgements: string[] = [];
      const pids: number[] = [];
      const pgSource: AuthorizationPostgresSource = {
        async connect() {
          if (configuration.status !== "configured") throw new Error("Missing disposable configuration.");
          const client = await connectDisposable({
            ...configuration.config, user: identity.role, password: identity.password,
          });
          clients.push(client);
          const observed = await client.query<{ session: string; effective: string; unsafe: boolean; pid: number }>(
            `SELECT session_user AS session,current_user AS effective,
              (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication) AS unsafe,
              pg_backend_pid() AS pid FROM pg_roles WHERE rolname=session_user`,
          );
          expect(observed.rows[0]).toMatchObject({ session: identity.role, effective: identity.role, unsafe: false });
          pids.push(observed.rows[0].pid);
          async function query<R extends QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<R>> {
            statements.push(sql);
            if (sql === "COMMIT" && fault === "commit-not-sent") {
              // SIMULATED transport failure before dispatch; release(true) closes the real open transaction.
              throw new Error("SIMULATED COMMIT dispatch failure");
            }
            const args = values ? [...values] : undefined;
            if (sql.includes("FROM empire_os_authorization.provision_member") && fault === "tamper-evidence" && args) {
              const evidence = JSON.parse(String(args[1]));
              args[1] = JSON.stringify({ ...evidence, actorSubject: employee });
            }
            if (sql.includes("FROM empire_os_authorization.provision_member") && fault === "duplicate-audit-transaction" && args) {
              if (!reusedTransactionId) throw new Error("Missing committed fixture transaction.");
              const evidence = JSON.parse(String(args[1]));
              args[1] = JSON.stringify({ ...evidence, transactionId: reusedTransactionId,
                decisionId: auditDecisionId(reusedTransactionId, evidence.operationId) });
            }
            let result: QueryResult<R>;
            try {
              result = await client.query<R>(sql, args);
              if (sql.includes("FROM empire_os_authorization.provision_member") && fault === "sql-after-mutation") {
                // Genuine PostgreSQL error AFTER both candidate writes, before COMMIT.
                await client.query("SELECT 1/0");
              }
            } catch (error) {
              if (error !== null && typeof error === "object" && "code" in error && typeof error.code === "string") {
                codes.push(error.code);
              }
              throw error;
            }
            acknowledgements.push(result.command);
            if (sql === "COMMIT" && fault === "lost-commit-ack") {
              // Real COMMIT completed; only acknowledgement delivery is simulated.
              throw new Error("SIMULATED lost COMMIT acknowledgement");
            }
            if (sql === "ROLLBACK" && fault === "lost-rollback-ack") {
              throw new Error("SIMULATED lost ROLLBACK acknowledgement");
            }
            if (sql.includes("FROM empire_os_authorization.provision_member") && fault === "corrupt-result") {
              const row = result.rows[0];
              result.rows[0] = { ...row, audit_evidence: {} };
            }
            return result;
          }
          return {
            // Adapter consumes the text/values overload; pg's other overloads are never used here.
            query: query as AuthorizationPostgresConnection["query"],
            release(destroy?: boolean) {
              releases.push(destroy === true);
              if (destroy) {
                clients.splice(clients.indexOf(client), 1);
                endings.push(client.end());
              }
            },
          };
        },
      };
      return { pgSource, statements, codes, releases, acknowledgements, pids };
    }

    async function state(test: Fixture) {
      const result = await admin.query<{ state: unknown; revision: string }>(
        "SELECT state,revision::text FROM empire_os_authorization.tenants WHERE tenant_id=$1 FOR UPDATE", [test.tenantId],
      );
      expect(result.rows).toHaveLength(1);
      const audits = await admin.query<{
        evidence: Record<string, unknown>; applied_request: string; applied_request_sha256: string;
        transaction_id: string; decision_id: string; actor_subject: string; resulting_revision: string;
      }>(`SELECT evidence,applied_request,applied_request_sha256,transaction_id::text,
        decision_id,actor_subject,resulting_revision::text FROM empire_os_authorization.audit WHERE tenant_id=$1`,
      [test.tenantId]);
      return { ...result.rows[0], audits: audits.rows };
    }

    async function unchanged(test: Fixture) {
      expect(await state(test)).toEqual({ state: test.before, revision: String(test.revision), audits: [] });
    }

    async function execute(test: Fixture, request = input(), runtime = source(), subject = founder) {
      const store = createPostgresEmployeeProvisioningStore(runtime.pgSource);
      return store.execute(await principal(subject), employeeProvisioningRequest(test.tenantId, request));
    }

    it("keeps the real application release disabled despite the Vitest-only substitution", async () => {
      const original = await vi.importActual<typeof import("../../app/lib/employee-provisioning-release")>(
        "../../app/lib/employee-provisioning-release",
      );
      expect(original.employeeProvisioningRelease()).toEqual({ status: "disabled", reason: "migration-005-disabled" });
      const test = await fixture();
      const runtime = source();
      release.approved = false;
      try {
        expect(await execute(test, input(), runtime)).toEqual({ status: "disabled", reason: "migration-005-disabled" });
        expect(runtime.pids).toEqual([]);
        await unchanged(test);
      } finally {
        release.approved = true;
      }
    });

    it("verifies catalog readiness under the real restricted LOGIN", async () => {
      const runtime = source();
      const connection = await runtime.pgSource.connect();
      try {
        expect((await connection.query(PROVISIONING_CONTRACT_SQL)).rows).toEqual([{ ready: true }]);
        const privileges = await connection.query(`SELECT
          has_function_privilege(current_user,'empire_os_authorization.provisioning_subject(text)','EXECUTE') AS helper,
          has_table_privilege(current_user,'empire_os_authorization.audit','INSERT') AS audit_write`);
        expect(privileges.rows).toEqual([{ helper: false, audit_write: false }]);
      } finally {
        connection.release();
      }
    });

    it("commits the full server boundary, exactly one member/revision and matching immutable audit", async () => {
      const test = await fixture();
      const request = input();
      const runtime = source();
      const authority = createServerEmployeeProvisioningAuthority({
        tenantId: test.tenantId,
        resolveSession: async () => ({ status: "authenticated", subject: founder }),
        sourceForPrincipal: verified => {
          expect(isAuthenticatedPrincipal(verified)).toBe(true);
          expect(verified.subject).toBe(founder);
          return runtime.pgSource;
        },
      });
      const result = await authority.provision(new Request("https://empire-os.invalid", {
        headers: { "x-actor": employee, "x-tenant": "foreign", "x-role": "owner" },
      }), request);
      expect(result.status).toBe("executed");
      if (result.status !== "executed") throw new Error("Real provisioning did not commit.");
      expect(runtime.statements.at(-1)).toBe("COMMIT");
      expect(runtime.acknowledgements.at(-1)).toBe("COMMIT");
      expect(runtime.releases).toEqual([false]);
      const committed = await state(test);
      const expected = validateDurableAuthorityState(test.before);
      if (expected.status !== "valid") throw new Error("Invalid test authority.");
      expect(committed.state).toEqual({
        ...expected.value,
        snapshot: { ...expected.value.snapshot, revision: 2, memberships: [
          ...expected.value.snapshot.memberships,
          { subject: request.subject, tenantId: test.tenantId, revision: 1, status: "active", roleIds: request.roleIds },
        ] },
      });
      expect(committed.revision).toBe("2");
      expect(committed.audits).toHaveLength(1);
      const audit = committed.audits[0];
      const text = JSON.stringify(employeeProvisioningRequest(test.tenantId, request));
      expect(audit).toMatchObject({
        applied_request: text, applied_request_sha256: createHash("sha256").update(text).digest("hex"),
        transaction_id: result.transactionId, decision_id: result.decisionId,
        actor_subject: founder, resulting_revision: "2",
        evidence: { actorSubject: founder, datasetId: test.datasetIds[0], operationId: request.operationId,
          authorityChange: { kind: "provision-member", subject: request.subject, roleIds: request.roleIds },
          decision: { status: "allowed", reason: "owner-authority", observedPolicyRevision: 1 } },
      });
      expect(result.requestSha256).toBe(audit.applied_request_sha256);
      expect(result.decisionId).toBe(auditDecisionId(result.transactionId, request.operationId));
      expect(validateMembershipProvisioningTransition(test.before, committed.state, founder,
        Number(audit.evidence.checkedAt)).status).toBe("valid");
      for (const sql of [
        "UPDATE empire_os_authorization.audit SET evidence=evidence WHERE transaction_id=$1",
        "DELETE FROM empire_os_authorization.audit WHERE transaction_id=$1",
      ]) {
        await expect(admin.query(sql, [result.transactionId])).rejects.toMatchObject({ code: "23514" });
      }
      expect((await state(test)).audits).toEqual(committed.audits);
    });

    it("rejects submitted actor claims before establishing any LOGIN", async () => {
      const test = await fixture();
      const runtime = source();
      const authority = createServerEmployeeProvisioningAuthority({
        tenantId: test.tenantId, sourceForPrincipal: () => runtime.pgSource,
        resolveSession: async () => ({ status: "authenticated", subject: founder }),
      });
      expect(await authority.provision(new Request("https://empire-os.invalid"),
        { ...input(), actorSubject: founder })).toMatchObject({ status: "invalid-request" });
      expect(runtime.pids).toEqual([]);
      await unchanged(test);
    });

    it("denies active employees even with valid dataset read grants and no provisioning EXECUTE", async () => {
      const test = await fixture();
      const runtime = source(employeeLogin);
      expect(await execute(test, input(), runtime, employee)).toEqual({ status: "unauthorized", reason: "forbidden" });
      expect(runtime.statements.at(-1)).toBe("ROLLBACK");
      expect(runtime.statements.some(sql => sql.includes("FROM empire_os_authorization.provision_member"))).toBe(false);
      expect((await admin.query(`SELECT has_function_privilege($1,
        'empire_os_authorization.provision_member(text,jsonb)','EXECUTE') AS allowed`, [employeeLogin.role])).rows)
        .toEqual([{ allowed: false }]);
      await unchanged(test);
    });

    it("fails closed at the real SQL privilege boundary if a founder LOGIN lacks provisioning EXECUTE", async () => {
      const test = await fixture();
      const restrictedFounder = await login(false);
      await admin.query(`INSERT INTO empire_os_authorization.role_tenants(database_role,tenant_id,actor_subject)
        VALUES ($1,$2,$3)`, [restrictedFounder.role, test.tenantId, founder]);
      const runtime = source(restrictedFounder);
      expect(await execute(test, input(), runtime)).toMatchObject({ status: "unauthorized", reason: "forbidden" });
      expect(runtime.statements.some(sql => sql.includes("FROM empire_os_authorization.provision_member"))).toBe(true);
      expect(runtime.codes).toContain("42501");
      expect(runtime.acknowledgements.at(-1)).toBe("ROLLBACK");
      await unchanged(test);
    });

    it.each(["founder-session-employee-login", "employee-session-founder-login"] as const)(
      "rejects verified authentication/database binding mismatch %s", async mismatch => {
        const test = await fixture();
        const runtime = source(mismatch === "founder-session-employee-login" ? employeeLogin : founderLogin);
        const subject = mismatch === "founder-session-employee-login" ? founder : employee;
        expect(await execute(test, input(), runtime, subject)).toMatchObject({ status: "failed", outcome: "rolled-back" });
        expect(runtime.statements.at(-1)).toBe("ROLLBACK");
        expect(runtime.statements.some(sql => sql.includes("FROM empire_os_authorization.provision_member"))).toBe(false);
        await unchanged(test);
      },
    );

    it("rejects a tenant without a binding for this real LOGIN", async () => {
      const ownTenant = await fixture();
      const test = await fixture();
      await admin.query("DELETE FROM empire_os_authorization.role_tenants WHERE database_role=$1 AND tenant_id=$2",
        [founderLogin.role, test.tenantId]);
      const runtime = source();
      expect(await execute(test, input(), runtime)).toMatchObject({ status: "unauthorized" });
      expect(runtime.codes).toContain("42501");
      await unchanged(test);
      await unchanged(ownTenant);
    });

    it("fences stale revisions and replay without extra state or audit", async () => {
      const test = await fixture();
      const request = input();
      expect(await execute(test, request)).toMatchObject({ status: "executed" });
      const committed = await state(test);
      expect(await execute(test, request)).toMatchObject({ status: "conflict", reason: "operation-conflict" });
      expect(await execute(test, input())).toMatchObject({ status: "conflict", reason: "stale-authority",
        observedPolicyRevision: 2 });
      expect(await state(test)).toEqual(committed);
    });

    it.each([
      { roleIds: ["role_missing"] }, { subject: employee },
    ])("rolls back real candidate SQL rejection for %j", async overrides => {
      const test = await fixture();
      const runtime = source();
      expect(await execute(test, input(overrides), runtime)).toMatchObject({ status: "failed", outcome: "rolled-back" });
      expect(runtime.codes).toContain("23514");
      expect(runtime.acknowledgements.at(-1)).toBe("ROLLBACK");
      await unchanged(test);
    });

    it.each(["revokedEmployee", "revokedRole"] as const)(
      "preserves retained revocations and rejects %s in real SQL", async kind => {
        const test = await fixture({ [kind]: true });
        const runtime = source();
        const request = input({
          expectedPolicyRevision: test.revision,
          ...(kind === "revokedEmployee" ? { subject: employee } : { roleIds: ["role_revoked"] }),
        });
        expect(await execute(test, request, runtime)).toMatchObject({ status: "failed", outcome: "rolled-back" });
        expect(runtime.codes).toContain("23514");
        await unchanged(test);
      },
    );

    it("does not let founder ownership override a revoked tenant", async () => {
      const test = await fixture({ revokedTenant: true });
      const runtime = source();
      expect(await execute(test, input(), runtime)).toMatchObject({ status: "unauthorized", reason: "forbidden" });
      expect(runtime.statements.some(sql => sql.includes("FROM empire_os_authorization.provision_member"))).toBe(false);
      await unchanged(test);
    });

    it("rejects tampered audit actor evidence in PostgreSQL, not merely in the adapter", async () => {
      const test = await fixture();
      const runtime = source(founderLogin, "tamper-evidence");
      expect(await execute(test, input(), runtime)).toMatchObject({ status: "unauthorized", reason: "forbidden" });
      expect(runtime.codes).toContain("42501");
      await unchanged(test);
    });

    it("rolls back the candidate membership UPDATE when the subsequent audit INSERT violates transaction uniqueness", async () => {
      const test = await fixture();
      const first = await execute(test);
      if (first.status !== "executed") throw new Error("Committed audit fixture required.");
      const before = await state(test);
      const runtime = source(founderLogin, "duplicate-audit-transaction", first.transactionId);
      expect(await execute(test, input({ expectedPolicyRevision: 2 }), runtime))
        .toMatchObject({ status: "conflict", reason: "operation-conflict" });
      expect(runtime.codes).toContain("23505");
      expect(runtime.acknowledgements.at(-1)).toBe("ROLLBACK");
      expect(runtime.statements).not.toContain("COMMIT");
      expect(await state(test)).toEqual(before);
    });

    it.each(["corrupt-result", "sql-after-mutation"] as const)(
      "rolls back BOTH actual membership and audit writes after %s", async fault => {
        const test = await fixture();
        const runtime = source(founderLogin, fault);
        expect(await execute(test, input(), runtime)).toMatchObject({ status: "failed", outcome: "rolled-back" });
        if (fault === "sql-after-mutation") expect(runtime.codes).toContain("22012");
        expect(runtime.statements.at(-1)).toBe("ROLLBACK");
        expect(runtime.statements).not.toContain("COMMIT");
        await unchanged(test);
      },
    );

    it("returns not-submitted for a real PostgreSQL connection rejection (nonexistent random LOGIN)", async () => {
      const test = await fixture();
      const runtime = source({ role: `absent_${randomUUID().replaceAll("-", "")}`, password: randomUUID() });
      expect(await execute(test, input(), runtime)).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
      expect(runtime.statements).toEqual([]);
      await unchanged(test);
    });

    it.each(["lost-commit-ack", "commit-not-sent"] as const)(
      "reports unknown for SIMULATED %s while independently proving the real database outcome", async fault => {
        const test = await fixture();
        const runtime = source(founderLogin, fault);
        expect(await execute(test, input(), runtime)).toMatchObject({ status: "unavailable", outcome: "unknown" });
        expect(runtime.releases).toEqual([true]);
        expect(runtime.statements).not.toContain("ROLLBACK");
        expect(runtime.statements.filter(sql => sql === "COMMIT")).toHaveLength(1);
        expect(runtime.statements.filter(sql => sql.includes("FROM empire_os_authorization.provision_member"))).toHaveLength(1);
        await Promise.all(endings);
        const observed = await state(test);
        if (fault === "lost-commit-ack") {
          expect(runtime.acknowledgements.at(-1)).toBe("COMMIT");
          expect(observed.revision).toBe("2");
          expect(observed.audits).toHaveLength(1);
        } else {
          await unchanged(test);
        }
      },
    );

    it("reports unknown for SIMULATED lost rollback acknowledgement despite real confirmed server rollback", async () => {
      const test = await fixture();
      const runtime = source(founderLogin, "lost-rollback-ack");
      expect(await execute(test, input({ expectedPolicyRevision: 0 }), runtime))
        .toMatchObject({ status: "unavailable", outcome: "unknown" });
      expect(runtime.acknowledgements.at(-1)).toBe("ROLLBACK");
      expect(runtime.releases).toEqual([true]);
      await Promise.all(endings);
      await unchanged(test);
    });

    it("serializes simultaneous adapter transactions: exactly one success and one fenced revision", async () => {
      const test = await fixture();
      const first = source();
      const second = source();
      const results = await Promise.all([execute(test, input(), first), execute(test, input(), second)]);
      expect(results.filter(result => result.status === "executed")).toHaveLength(1);
      expect(results.filter(result => result.status === "conflict" && result.reason === "stale-authority")).toHaveLength(1);
      const observed = await state(test);
      expect(observed.revision).toBe("2");
      expect(observed.audits).toHaveLength(1);
    });

    it("revalidates a removed binding AFTER the adapter is demonstrably queued on the tenant lock", async () => {
      const test = await fixture();
      const runtime = source();
      await admin.query("BEGIN");
      await admin.query("SELECT 1 FROM empire_os_authorization.tenants WHERE tenant_id=$1 FOR UPDATE", [test.tenantId]);
      const pending = execute(test, input(), runtime);
      try {
        const deadline = Date.now() + 3000;
        let blocked = false;
        while (Date.now() < deadline) {
          if (runtime.pids[0]) {
            const wait = await admin.query<{ blocked: boolean }>(
              "SELECT pg_backend_pid() = ANY(pg_blocking_pids($1)) AS blocked", [runtime.pids[0]],
            );
            if (wait.rows[0].blocked) { blocked = true; break; }
          }
          await delay(10);
        }
        expect(blocked).toBe(true);
        expect((await admin.query(
          "DELETE FROM empire_os_authorization.role_tenants WHERE database_role=$1 AND tenant_id=$2",
          [founderLogin.role, test.tenantId],
        )).rowCount).toBe(1);
        await admin.query("COMMIT");
        expect(await pending).toMatchObject({ status: "unauthorized", reason: "forbidden" });
        expect(runtime.codes).toContain("42501");
        await unchanged(test);
      } finally {
        await admin.query("ROLLBACK");
        await pending;
      }
    }, 15000);
  },
);
