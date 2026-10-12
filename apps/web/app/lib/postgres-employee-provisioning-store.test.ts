import { createHash } from "node:crypto";
import type { QueryResult, QueryResultRow } from "pg";
import { parse } from "libpg-query";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const release = vi.hoisted(() => ({ approved: false }));
vi.mock("./employee-provisioning-release", async importOriginal => {
  const original = await importOriginal<typeof import("./employee-provisioning-release")>();
  return {
    employeeProvisioningRelease: () => release.approved
      ? { status: "approved", migrationVersion: 5 } : original.employeeProvisioningRelease(),
  };
});
import { authorityFixture } from "../../database/tests/authorization-fixtures";
import {
  createServerPrincipalResolver, isAuthenticatedPrincipal, type AuthenticatedPrincipal,
} from "./server-persistence-authority";
import { createServerEmployeeProvisioningAuthority } from "./server-employee-provisioning";
import { employeeProvisioningRequest } from "./employee-provisioning-contract";
import { auditDecisionId } from "./authorization-transaction";
import { createPostgresEmployeeProvisioningStore, PROVISIONING_CONTRACT_SQL } from "./postgres-employee-provisioning-store";
import type { AuthorizationPostgresConnection } from "./postgres-authorization-store";

const founder = "user_founder";
const datasetId = "00000000-0000-4000-8000-000000000001";
const input = {
  operationId: "provision:one", expectedPolicyRevision: 1, subject: "user_employee", roleIds: ["writer"],
};
const request = employeeProvisioningRequest("tenant-a", input);
async function principal(subject = founder) {
  const result = await createServerPrincipalResolver(async () => ({ status: "authenticated", subject }))(
    new Request("https://empire-os.invalid"),
  );
  if (!isAuthenticatedPrincipal(result)) throw new Error("Fixture principal was not minted.");
  return result;
}

function harness(options: {
  ready?: boolean; actor?: string; authorized?: boolean; revision?: number;
  authorityTenant?: string;
  records?: unknown[]; missingAuthority?: boolean; invalidAuthority?: boolean;
  fail?: readonly string[]; code?: string; corruptResult?: "state" | "audit" | "actor" | "subject" | "roles";
  commitCommand?: string; unsafe?: boolean;
} = {}) {
  const state = authorityFixture(options.authorityTenant ?? "tenant-a", datasetId);
  const before = {
    ...state,
    snapshot: {
      ...state.snapshot, revision: options.revision ?? 1,
      tenant: { ...state.snapshot.tenant, ownerSubjects: [founder] },
      memberships: state.snapshot.memberships.map(member =>
        member.subject === "owner" ? { ...member, subject: founder } : member),
    },
  };
  const statements: string[] = [];
  const parameters: unknown[][] = [];
  const releaseClient = vi.fn();
  async function query<R extends QueryResultRow>(sql: string, values: unknown[] = []): Promise<QueryResult<R>> {
    statements.push(sql); parameters.push(values);
    if (options.fail?.some(prefix => sql.startsWith(prefix))) {
      throw Object.assign(new Error("PRIVATE DATABASE DETAILS"), { code: options.code });
    }
    let rows: QueryResultRow[] = [];
    if (sql.includes("AS unsafe")) rows = [{ unsafe: options.unsafe ?? false }];
    else if (sql === PROVISIONING_CONTRACT_SQL) rows = [{ ready: options.ready ?? true }];
    else if (sql.includes("lookup_operation")) rows = options.missingAuthority ? [] : [{
      state: options.invalidAuthority ? {} : before, revision: String(before.snapshot.revision),
      actor_subject: options.actor ?? founder, authorized: options.authorized ?? true,
      records: options.records ?? [],
    }];
    else if (sql.includes("AS now_ms")) rows = [{ now_ms: "1000" }];
    else if (sql.includes("FROM empire_os_authorization.provision_member")) {
      const evidence = JSON.parse(String(values[1]));
      const bound = JSON.parse(String(values[0]));
      const after = {
        ...before,
        snapshot: {
          ...before.snapshot, revision: before.snapshot.revision + 1,
          memberships: [...before.snapshot.memberships, {
            subject: options.corruptResult === "subject" ? "user_different" : bound.command.subject,
            tenantId: "tenant-a", revision: 1, status: "active",
            roleIds: options.corruptResult === "roles" ? [] : bound.command.roleIds,
          }],
        },
      };
      rows = [{
        state: options.corruptResult === "state" ? before : after,
        revision: String(after.snapshot.revision),
        actor_subject: options.corruptResult === "actor" ? "user_wrong" : founder,
        audit_evidence: options.corruptResult === "audit" ? { ...evidence, requestSha256: "0".repeat(64) }
          : Object.fromEntries(Object.entries(evidence).reverse()),
      }];
    }
    // Typed driver response fixture, following the existing PostgreSQL adapter mocks.
    return {
      rows: rows as R[], rowCount: rows.length, oid: 0, fields: [],
      command: sql.startsWith("BEGIN") ? "BEGIN" : sql === "COMMIT" ? options.commitCommand ?? "COMMIT"
        : sql === "ROLLBACK" ? "ROLLBACK" : "SELECT",
    };
  }
  const client: AuthorizationPostgresConnection = {
    query: query as AuthorizationPostgresConnection["query"], release: releaseClient,
  };
  const connect = vi.fn(async () => client);
  return {
    source: { connect }, store: createPostgresEmployeeProvisioningStore({ connect }),
    connect, statements, parameters, releaseClient,
  };
}
afterEach(() => { release.approved = false; });

describe("employee provisioning PostgreSQL adapter (offline driver mocks, NOT SQL execution)", () => {
  it("parses the structural-readiness query offline", async () => {
    await expect(parse(PROVISIONING_CONTRACT_SQL)).resolves.toBeDefined();
  });

  it("cannot connect or execute even when candidate objects exist while migration 005 is disabled", async () => {
    const h = harness({ ready: true });
    expect(await h.store.execute(await principal(), request))
      .toEqual({ status: "disabled", reason: "migration-005-disabled" });
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("rejects a forged unbranded principal before acquiring any connection", async () => {
    release.approved = true;
    const h = harness();
    expect(await h.store.execute({ subject: founder }, request)).toEqual({
      status: "unauthorized", reason: "authentication-required",
    });
    expect(h.connect).not.toHaveBeenCalled();
  });

  // Only this offline test module mocks release approval to exercise the dormant
  // transaction path. There is no production approval flag or caller override.
  it("reuses one restricted transaction, database-bound actor and audit conventions before confirmed COMMIT", async () => {
    release.approved = true;
    const h = harness();
    const result = await h.store.execute(await principal(), request);
    expect(result).toMatchObject({
      status: "executed", durability: "transaction-commit-confirmed", resultingPolicyRevision: 2,
    });
    const applied = h.statements.findIndex(sql => sql.includes("FROM empire_os_authorization.provision_member"));
    const lookup = h.statements.findIndex(sql => sql.includes("lookup_operation"));
    expect(applied).toBeGreaterThan(lookup);
    expect(h.statements.filter(sql => sql.includes("FROM empire_os_authorization.provision_member"))).toHaveLength(1);
    const requestText = String(h.parameters[applied][0]);
    const evidence = JSON.parse(String(h.parameters[applied][1]));
    expect(JSON.parse(requestText)).toEqual(request);
    expect(evidence.actorSubject).toBe(founder);
    expect(evidence.decisionId).toBe(auditDecisionId(evidence.transactionId, input.operationId));
    expect(evidence.requestSha256).toBe(createHash("sha256").update(requestText).digest("hex"));
    expect(h.statements[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED");
    expect(h.statements.at(-1)).toBe("COMMIT");
    expect(h.releaseClient).toHaveBeenCalledWith(false);
    expect(h.statements.join("\n")).not.toMatch(/\bSET ROLE\b|\bINSERT INTO\b|\bUPDATE empire\b/);
    expect(result).not.toHaveProperty("state");
    expect(result).not.toHaveProperty("audit_evidence");
  });

  it.each([
    { ready: false }, { missingAuthority: true }, { invalidAuthority: true },
    { actor: "user_someone_else" }, { authorityTenant: "tenant-b" }, { unsafe: true },
  ])("rolls back without mutation when readiness, authority or identity is invalid: %j", async options => {
    release.approved = true;
    const h = harness(options);
    const result = await h.store.execute(await principal(), request);
    expect(["unavailable", "failed"]).toContain(result.status);
    expect(h.statements.at(-1)).toBe("ROLLBACK");
    expect(h.statements.some(sql => sql.includes("FROM empire_os_authorization.provision_member"))).toBe(false);
  });

  it("rejects ordinary employees without treating dataset grants as founder authority", async () => {
    release.approved = true;
    const h = harness({ actor: "issuer" });
    expect(await h.store.execute(await principal("issuer"), request))
      .toEqual({ status: "unauthorized", reason: "forbidden" });
    expect(h.statements.at(-1)).toBe("ROLLBACK");
  });

  it("does not let an owner snapshot override a database authorization denial", async () => {
    release.approved = true;
    const h = harness({ authorized: false });
    expect(await h.store.execute(await principal(), request))
      .toEqual({ status: "unauthorized", reason: "forbidden" });
    expect(h.statements.at(-1)).toBe("ROLLBACK");
    expect(h.statements.some(sql => sql.includes("FROM empire_os_authorization.provision_member"))).toBe(false);
  });

  it.each([
    { revision: 2, expected: "stale-authority" },
    { records: [{}], expected: "operation-conflict" },
  ])("rejects fenced revisions and replay under the tenant lock: %j", async ({ expected, ...options }) => {
    release.approved = true;
    const h = harness(options);
    expect(await h.store.execute(await principal(), request)).toMatchObject({ status: "conflict", reason: expected });
    expect(h.statements.at(-1)).toBe("ROLLBACK");
    expect(h.statements.some(sql => sql.includes("FROM empire_os_authorization.provision_member"))).toBe(false);
  });

  it.each(["state", "audit", "actor", "subject", "roles"] as const)(
    "rejects inconsistent returned %s and never commits it", async corruptResult => {
      release.approved = true;
      const h = harness({ corruptResult });
      expect(await h.store.execute(await principal(), request)).toMatchObject({ status: "failed", outcome: "rolled-back" });
      expect(h.statements.at(-1)).toBe("ROLLBACK");
      expect(h.statements).not.toContain("COMMIT");
    },
  );

  it.each([
    { code: "42501", expected: "unauthorized" }, { code: "40001", expected: "conflict" },
    { code: "23505", expected: "conflict" }, { code: "23514", expected: "failed" },
    { code: "08006", expected: "failed" },
  ])("rolls back database operation failure $code without leaking details", async ({ code, expected }) => {
    release.approved = true;
    const h = harness({ fail: ["SELECT state,revision::text AS revision,actor_subject,audit_evidence"], code });
    const result = await h.store.execute(await principal(), request);
    expect(result.status).toBe(expected);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(h.statements.at(-1)).toBe("ROLLBACK");
  });

  it.each([{ fail: ["COMMIT"] }, { commitCommand: "ROLLBACK" }])(
    "reports unconfirmed COMMIT as unknown and discards the connection: %j", async options => {
      release.approved = true;
      const h = harness(options);
      expect(await h.store.execute(await principal(), request)).toMatchObject({ status: "unavailable", outcome: "unknown" });
      expect(h.statements.at(-1)).toBe("COMMIT");
      expect(h.statements).not.toContain("ROLLBACK");
      expect(h.releaseClient).toHaveBeenCalledWith(true);
    },
  );

  it("discards a connection if BEGIN and rollback cannot be confirmed", async () => {
    release.approved = true;
    const h = harness({ fail: ["BEGIN", "ROLLBACK"] });
    expect(await h.store.execute(await principal(), request)).toMatchObject({ status: "unavailable", outcome: "unknown" });
    expect(h.releaseClient).toHaveBeenCalledWith(true);
  });

  it("acknowledges rollback after failed transaction setup without calling provisioning", async () => {
    release.approved = true;
    const h = harness({ fail: ["BEGIN"] });
    expect(await h.store.execute(await principal(), request))
      .toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(h.statements).toEqual(["BEGIN ISOLATION LEVEL READ COMMITTED", "ROLLBACK"]);
    expect(h.releaseClient).toHaveBeenCalledWith(false);
  });

  it("reports unknown rather than claiming rollback when mutation output fails validation and rollback fails", async () => {
    release.approved = true;
    const h = harness({ corruptResult: "audit", fail: ["ROLLBACK"] });
    expect(await h.store.execute(await principal(), request))
      .toMatchObject({ status: "unavailable", outcome: "unknown" });
    expect(h.statements.some(sql => sql.includes("FROM empire_os_authorization.provision_member"))).toBe(true);
    expect(h.statements).not.toContain("COMMIT");
    expect(h.releaseClient).toHaveBeenCalledWith(true);
  });

  it("reports a connection failure as not submitted", async () => {
    release.approved = true;
    const h = harness();
    h.connect.mockRejectedValue(new Error("PRIVATE DATABASE DETAILS"));
    expect(await h.store.execute(await principal(), request)).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(h.statements).toEqual([]);
  });

  it("binds the authenticated server principal and configured tenant through the full boundary", async () => {
    release.approved = true;
    const h = harness();
    const sourceForPrincipal = vi.fn((_principal: AuthenticatedPrincipal) => h.source);
    const authority = createServerEmployeeProvisioningAuthority({
      tenantId: "tenant-a", sourceForPrincipal,
      resolveSession: async () => ({ status: "authenticated", subject: founder }),
    });
    expect(await authority.provision(new Request("https://empire-os.invalid", {
      headers: { "x-actor-subject": "user_forged", "x-tenant-id": "foreign" },
    }), input)).toMatchObject({ status: "executed" });
    const resolved = sourceForPrincipal.mock.calls[0];
    expect(resolved[0].subject).toBe(founder);
    expect(isAuthenticatedPrincipal(resolved[0])).toBe(true);
    expect(h.parameters.find((_values, index) => h.statements[index].includes("lookup_operation")))
      .toEqual(["tenant-a", input.operationId]);
  });

  it("returns not-submitted when the server cannot resolve a restricted per-principal source", async () => {
    release.approved = true;
    const authority = createServerEmployeeProvisioningAuthority({
      tenantId: "tenant-a", resolveSession: async () => ({ status: "authenticated", subject: founder }),
      sourceForPrincipal: () => { throw new Error("PRIVATE DATABASE CREDENTIALS"); },
    });
    const result = await authority.provision(new Request("https://empire-os.invalid"), input);
    expect(result).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it("does not drop forged fields when the adapter is called directly by another server module", async () => {
    release.approved = true;
    const h = harness();
    const forged = { ...request, actorSubject: founder };
    expect(await h.store.execute(await principal(), forged)).toMatchObject({ status: "invalid-request" });
    expect(h.connect).not.toHaveBeenCalled();
  });
});
