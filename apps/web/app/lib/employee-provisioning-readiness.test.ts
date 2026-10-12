import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { parse } from "libpg-query";
import type { QueryResult, QueryResultRow } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const overrides = vi.hoisted(() => ({ approved: false, binding: true }));
vi.mock("./employee-provisioning-release", async importOriginal => {
  const original = await importOriginal<typeof import("./employee-provisioning-release")>();
  return { employeeProvisioningRelease: () => overrides.approved
    ? { status: "approved", migrationVersion: 5 } : original.employeeProvisioningRelease() };
});
vi.mock("./restricted-postgres-provider", async importOriginal => {
  const original = await importOriginal<typeof import("./restricted-postgres-provider")>();
  return { ...original, restrictedSourceBinding: (source: unknown) => overrides.binding && source
    ? { subject: "user_founder", tenantId: "tenant-a", database: "prod", login: "actor_login",
      databaseIdentitySha256: "b".repeat(64) } : undefined };
});
import {
  createEmployeeProvisioningReadinessGate, PROVISIONING_CATALOG_SQL, PROVISIONING_READINESS_CONTROLS,
  type ProvisioningReadinessTarget, REQUIRED_READINESS_CHECKS,
} from "./employee-provisioning-readiness";
import { PROVISIONING_CONTRACT_SQL } from "./postgres-employee-provisioning-store";
import { RESTRICTED_LEASE_IDENTITY_SQL } from "./restricted-postgres-provider";
import type { AuthorizationPostgresConnection } from "./postgres-authorization-store";
import { authorityFixture } from "../../database/tests/authorization-fixtures";

const keys = generateKeyPairSync("ed25519");
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const target: ProvisioningReadinessTarget = {
  environment: "production", environmentId: "prod-eu", deploymentId: "release-reviewed",
  artifactSha256: "a".repeat(64), databaseIdentitySha256: "b".repeat(64), tenantId: "tenant-a",
};
const catalog = '[["test-reviewed-catalog"]]';
const catalogSha256 = createHash("sha256").update(catalog).digest("hex");
const methods = [
  "real-postgresql-16-reviewed-artifact", "production-verified-tls-restricted-login",
  "production-stop-dispatch-preserve-data-reconcile-inflight", "production-restore-verified-audit-and-authority",
];
function payload(index: number) {
  return {
    version: 1, control: PROVISIONING_READINESS_CONTROLS[index], target, actorSubject: "user_founder",
    observedAt: 1000, expiresAt: 3000, catalogSha256, result: "passed", method: methods[index],
    evidenceSha256: createHash("sha256").update(report(index)).digest("hex"),
  };
}
function report(index: number) {
  const control = PROVISIONING_READINESS_CONTROLS[index];
  return JSON.stringify({
    version: 1, control, target, actorSubject: "user_founder", observedAt: 1000, catalogSha256,
    execution: index === 0 ? "real-postgresql-16" : "production",
    checks: REQUIRED_READINESS_CHECKS[control], failedChecks: 0,
  });
}
function signed(value: unknown, privateKey = keys.privateKey) {
  const text = JSON.stringify(value);
  return { keyId: "review-verifier", payload: text, signature: sign(null, Buffer.from(text), privateKey).toString("base64") };
}
function evidence() { return PROVISIONING_READINESS_CONTROLS.map((_, index) => signed(payload(index))); }
function harness(options: {
  evidence?: unknown; identity?: Record<string, unknown>; ready?: boolean; catalog?: string;
  actor?: string; revision?: string; fail?: string; rollback?: string; now?: () => number;
  report?: unknown;
  authenticated?: boolean; sourceFails?: boolean; sessionFails?: boolean;
} = {}) {
  const statements: string[] = [];
  const release = vi.fn();
  const fixture = authorityFixture("tenant-a", "00000000-0000-4000-8000-000000000001");
  const state = { ...fixture, snapshot: { ...fixture.snapshot,
    tenant: { ...fixture.snapshot.tenant, ownerSubjects: ["user_founder"] },
    memberships: fixture.snapshot.memberships.map(m => m.subject === "owner" ? { ...m, subject: "user_founder" } : m),
  } };
  async function query<R extends QueryResultRow>(sql: string): Promise<QueryResult<R>> {
    statements.push(sql);
    if (options.fail && sql.includes(options.fail)) throw new Error("PRIVATE credential/driver detail");
    let rows: QueryResultRow[] = [];
    if (sql.includes("AS unsafe")) rows = [{ unsafe: false }];
    if (sql === RESTRICTED_LEASE_IDENTITY_SQL) rows = [{
      database: "prod", login: "actor_login", effective: "actor_login", recovery: false, tls: true, restricted: true,
      standalone: true, safe_schema: true, safe_tables: true,
      bindings: [{ tenantId: "tenant-a", subject: "user_founder" }], ...options.identity,
    }];
    if (sql.includes("lookup_operation")) rows = [{
      state, revision: options.revision ?? "1", actor_subject: options.actor ?? "user_founder", authorized: true, records: [],
    }];
    if (sql === PROVISIONING_CONTRACT_SQL) rows = [{ ready: options.ready ?? true }];
    if (sql === PROVISIONING_CATALOG_SQL) rows = [{ catalog: options.catalog ?? catalog }];
    return { command: sql.startsWith("BEGIN") ? "BEGIN" : sql === "ROLLBACK" ? options.rollback ?? "ROLLBACK" : "SELECT",
      rows: rows as R[], fields: [], oid: 0, rowCount: rows.length };
  }
  const connect = vi.fn(async (): Promise<AuthorizationPostgresConnection> => ({
    query: query as AuthorizationPostgresConnection["query"], release,
  }));
  const sourceForPrincipal = vi.fn(() => {
    if (options.sourceFails) throw new Error("PRIVATE credentials");
    return { connect };
  });
  const read = vi.fn(async () => Object.hasOwn(options, "evidence") ? options.evidence : evidence());
  const gate = createEmployeeProvisioningReadinessGate({
    target, trustKeys: [{ keyId: "review-verifier", publicKeyPem, controls: PROVISIONING_READINESS_CONTROLS }],
    maxEvidenceAgeMs: 2000, nowMs: options.now ?? (() => 2000),
    resolveSession: async () => {
      if (options.sessionFails) throw new Error("PRIVATE auth");
      return options.authenticated === false ? { status: "unauthenticated" } : { status: "authenticated", subject: "user_founder" };
    },
    sourceForPrincipal, attestations: {
      read,
      readReport: async digest => Object.hasOwn(options, "report") ? options.report
        : PROVISIONING_READINESS_CONTROLS.map((_, i) => report(i))
          .find(text => createHash("sha256").update(text).digest("hex") === digest),
    },
  });
  return { gate, statements, release, connect, sourceForPrincipal, read };
}
const request = () => new Request("https://empire-os.invalid/internal");
afterEach(() => { overrides.approved = false; overrides.binding = true; });

describe("deployment readiness assurance (OFFLINE fixtures/signatures, NOT production verification)", () => {
  it("parses the catalog query offline", async () => {
    await expect(parse(PROVISIONING_CATALOG_SQL)).resolves.toBeDefined();
  });

  it("cannot activate despite all signed evidence and simulated live checks", async () => {
    const h = harness();
    const result = await h.gate.assess(request());
    expect(result.activation).toBe("blocked");
    expect(result.assurance).toBe("unverified");
    expect(result.findings).toContainEqual({ control: "migration-approval", status: "blocked", reason: "migration-005-disabled" });
    expect(result.findings.find(f => f.control === "schema-audit")?.status).toBe("verified");
    expect(h.statements.at(-1)).toBe("ROLLBACK");
    expect(h.statements.some(sql => sql === "COMMIT" || sql.includes("FROM empire_os_authorization.provision_member"))).toBe(false);
  });

  it("distinguishes verified assurance from activation even with TEST-ONLY release approval", async () => {
    overrides.approved = true;
    const result = await harness().gate.assess(request());
    expect(result).toMatchObject({ activation: "blocked", assurance: "verified" });
  });

  it.each([{}, { ready: true }, { production: true, approved: true }])("rejects manual claims %j without any source read", async claims => {
    const h = harness();
    expect((await h.gate.assess(request(), claims)).assurance).toBe("failed");
    expect(h.read).not.toHaveBeenCalled();
    expect(h.sourceForPrincipal).not.toHaveBeenCalled();
  });

  it.each([{ authenticated: false }, { sessionFails: true }])("fails closed before evidence on rejected authentication %j", async options => {
    const h = harness(options);
    expect((await h.gate.assess(request())).assurance).toBe("unverified");
    expect(h.read).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("does not trust unsigned results or a signature by an unpinned key", async () => {
    const foreign = generateKeyPairSync("ed25519");
    for (const value of [PROVISIONING_READINESS_CONTROLS.map((_, i) => payload(i)),
      PROVISIONING_READINESS_CONTROLS.map((_, i) => signed(payload(i), foreign.privateKey))]) {
      expect((await harness({ evidence: value }).gate.assess(request())).assurance).toBe("failed");
    }
  });

  it("rejects tampering of signed content", async () => {
    const value = evidence();
    value[0] = { ...value[0], payload: value[0].payload.replace("passed", "forged") };
    expect((await harness({ evidence: value }).gate.assess(request())).assurance).toBe("failed");
  });

  it("rejects unknown signing authority and another actor's signed provenance", async () => {
    const unknown = evidence();
    unknown[0] = { ...unknown[0], keyId: "untrusted-verifier" };
    const other = evidence();
    other[0] = signed({ ...payload(0), actorSubject: "user_other" });
    for (const value of [unknown, other]) {
      expect((await harness({ evidence: value }).gate.assess(request())).assurance).toBe("failed");
    }
  });

  it.each([
    { environment: "disposable" }, { environmentId: "local" }, { deploymentId: "old-release" },
    { artifactSha256: "d".repeat(64) }, { databaseIdentitySha256: "d".repeat(64) }, { tenantId: "tenant-b" },
  ])("rejects signed evidence for another environment/artifact %j", async patch => {
    const value = evidence();
    value[0] = signed({ ...payload(0), target: { ...target, ...patch } });
    expect((await harness({ evidence: value }).gate.assess(request())).assurance).toBe("failed");
  });

  it.each([
    { observedAt: 2001 }, { observedAt: 0, expiresAt: 1999 }, { expiresAt: 2000 },
    { observedAt: 1000, expiresAt: 4000 },
  ])("rejects signed stale/future/overlong evidence %j", async patch => {
    overrides.approved = true;
    const value = evidence();
    value[0] = signed({ ...payload(0), ...patch });
    const result = await harness({ evidence: value }).gate.assess(request());
    expect(result.assurance).toBe("unverified");
    expect(result.findings.some(f => f.reason === "stale-or-future-evidence")).toBe(true);
  });

  it.each([
    { result: "failed" }, { method: "mocked-driver" }, { method: "local-disposable-only" },
  ])("cannot substitute mocked/disposable results for production assurance %j", async patch => {
    const value = evidence();
    value[1] = signed({ ...payload(1), ...patch });
    expect((await harness({ evidence: value }).gate.assess(request())).assurance).toBe("failed");
  });

  it("does not accept dropping/resetting SQL as a safe rollback strategy", async () => {
    const value = evidence();
    value[2] = signed({ ...payload(2), method: "drop-schema-and-reapply" });
    expect((await harness({ evidence: value }).gate.assess(request())).assurance).toBe("failed");
  });

  it("requires all controls and does not conflate missing evidence with passed controls", async () => {
    overrides.approved = true;
    for (const value of [undefined, [], evidence().slice(0, 3)]) {
      expect((await harness({ evidence: value }).gate.assess(request())).assurance).toBe("unverified");
    }
  });

  it("rejects duplicates and contradictory reviewed catalog digests", async () => {
    const duplicated = [...evidence(), signed(payload(0))];
    const contradictory = evidence();
    contradictory[1] = signed({ ...payload(1), catalogSha256: "d".repeat(64) });
    for (const value of [duplicated, contradictory]) {
      expect((await harness({ evidence: value }).gate.assess(request())).assurance).toBe("failed");
    }
  });

  it("requires the actual signed report, not just a summary signature", async () => {
    overrides.approved = true;
    const absent = await harness({ report: undefined }).gate.assess(request());
    expect(absent.assurance).toBe("unverified");
    expect(absent.findings.some(f => f.reason === "signed-report-unavailable")).toBe(true);
    expect((await harness({ report: "tampered unsigned report" }).gate.assess(request())).assurance).toBe("failed");
  });

  it.each([
    { execution: "mocked-driver" }, { execution: "local-disposable" }, { failedChecks: 1 },
    { checks: ["certificate-chain"] }, { checks: ["certificate-chain", "certificate-chain"] },
  ])("rejects a signed report with inadequate/unsafe production verification %j", async patch => {
    const text = JSON.stringify({ ...JSON.parse(report(1)), ...patch });
    const attestation = signed({
      ...payload(1), evidenceSha256: createHash("sha256").update(text).digest("hex"),
    });
    expect((await harness({ evidence: [attestation], report: text }).gate.assess(request())).assurance).toBe("failed");
  });

  it("rejects attestation authority outside its pinned control scope", async () => {
    const h = harness();
    const gate = createEmployeeProvisioningReadinessGate({
      target, trustKeys: [{ keyId: "review-verifier", publicKeyPem, controls: ["postgres-integration"] }],
      maxEvidenceAgeMs: 2000, nowMs: () => 2000,
      resolveSession: async () => ({ status: "authenticated", subject: "user_founder" }),
      sourceForPrincipal: h.sourceForPrincipal,
      attestations: { read: async () => evidence(), readReport: async () => report(0) },
    });
    expect((await gate.assess(request())).assurance).toBe("failed");
  });

  it.each([
    { ready: false }, { catalog: "changed schema definitions" }, { actor: "user_other" },
    { revision: "9" }, { identity: { tls: false } }, { identity: { standalone: false } },
    { identity: { safe_tables: false } },
    { identity: { database: "foreign" } }, { identity: { login: "owner" } },
  ])("rejects live database/actor/audit verification failure %j", async options => {
    expect((await harness(options).gate.assess(request())).assurance).toBe("failed");
  });

  it("rejects sources not minted by the restricted lifecycle provider", async () => {
    overrides.binding = false;
    const h = harness();
    expect((await h.gate.assess(request())).assurance).toBe("failed");
    expect(h.connect).not.toHaveBeenCalled();
  });

  it.each([
    { sourceFails: true }, { fail: "lookup_operation" }, { fail: "AS ready" },
    { fail: "ROLLBACK" }, { rollback: "COMMIT" },
  ])("remains unverified when required DB visibility/rollback is unavailable %j", async options => {
    overrides.approved = true;
    const h = harness(options);
    const result = await h.gate.assess(request());
    expect(result.assurance).toBe("unverified");
    if (options.fail === "ROLLBACK" || options.rollback) {
      expect(h.release).toHaveBeenCalledWith(true);
      expect(result.findings.some(f => f.reason === "live-contract-and-signed-catalog-match")).toBe(false);
    }
  });

  it("revalidates freshness after asynchronous database work", async () => {
    overrides.approved = true;
    let calls = 0;
    const result = await harness({ now: () => ++calls === 1 ? 2000 : 3000 }).gate.assess(request());
    expect(result.assurance).toBe("unverified");
    expect(result.findings.some(f => f.reason === "evidence-expired-during-assessment")).toBe(true);
  });

  it("rejects backwards/unavailable clocks and changed release authority", async () => {
    overrides.approved = true;
    let calls = 0;
    const backwards = await harness({ now: () => ++calls === 1 ? 2000 : 1999 }).gate.assess(request());
    expect(backwards.assurance).toBe("unverified");
    const missing = harness({ now: () => { throw new Error("PRIVATE time service"); } });
    expect((await missing.gate.assess(request())).assurance).toBe("unverified");
    expect(missing.connect).not.toHaveBeenCalled();
    calls = 0;
    const changed = await harness({ now: () => {
      if (++calls > 1) overrides.approved = false;
      return 2000;
    } }).gate.assess(request());
    expect(changed.assurance).toBe("failed");
    expect(changed.findings.some(f => f.reason === "release-authority-changed")).toBe(true);
  });

  it("does not turn connection or cleanup failures into verified readiness", async () => {
    overrides.approved = true;
    const connection = harness();
    connection.connect.mockRejectedValue(new Error("PRIVATE TLS handshake"));
    expect((await connection.gate.assess(request())).assurance).toBe("unverified");
    const cleanup = harness();
    cleanup.release.mockImplementation(() => { throw new Error("PRIVATE cleanup failure"); });
    expect((await cleanup.gate.assess(request())).assurance).toBe("unverified");
  });

  it("returns no credentials, raw evidence, endpoints or driver errors", async () => {
    const result = await harness({ fail: "lookup_operation" }).gate.assess(request());
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(JSON.stringify(result)).not.toContain("payload");
    expect(JSON.stringify(result)).not.toContain("signature");
  });

  it("requires an explicitly pinned verification authority and freshness policy", () => {
    const h = harness();
    const base = {
      target, maxEvidenceAgeMs: 2000, nowMs: () => 2000,
      resolveSession: async () => ({ status: "authenticated" as const, subject: "user_founder" }),
      sourceForPrincipal: h.sourceForPrincipal,
      attestations: { read: async () => evidence(), readReport: async () => undefined },
    };
    expect(() => createEmployeeProvisioningReadinessGate({ ...base, trustKeys: [] })).toThrow("trust configuration");
    expect(() => createEmployeeProvisioningReadinessGate({ ...base, maxEvidenceAgeMs: 0,
      trustKeys: [{ keyId: "verifier", publicKeyPem, controls: PROVISIONING_READINESS_CONTROLS }] })).toThrow("trust configuration");
    expect(() => createEmployeeProvisioningReadinessGate({ ...base,
      trustKeys: [{ keyId: "verifier", publicKeyPem: "PRIVATE malformed", controls: PROVISIONING_READINESS_CONTROLS }] }))
      .toThrow("Invalid readiness public verification key.");
  });
});
