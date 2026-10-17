import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { parse } from "libpg-query";

vi.mock("server-only", () => ({}));
vi.mock("./clerk-session-resolver", () => ({ resolveClerkSession: vi.fn() }));
vi.mock("./member-authority-release", () => ({ memberAuthorityRelease: vi.fn() }));
vi.mock("./restricted-postgres-provider", () => ({ restrictedSourceBinding: vi.fn() }));
vi.mock("./person-eligibility-provenance", async importOriginal => ({
  ...await importOriginal<typeof import("./person-eligibility-provenance")>(),
  storedEligibilityProvenanceProblem: vi.fn(),
}));
vi.mock("pg", () => ({
  Pool: vi.fn(function () { throw new Error("Offline tests cannot connect to PostgreSQL."); }),
}));

import { Pool } from "pg";
import { resolveClerkSession } from "./clerk-session-resolver";
import { memberAuthorityRelease } from "./member-authority-release";
import { restrictedSourceBinding } from "./restricted-postgres-provider";
import { storedEligibilityProvenanceProblem } from "./person-eligibility-provenance";
import type { AuthorizationPostgresConnection } from "./postgres-authorization-store";
import { IDENTITY_CONTRACT_SQL } from "./postgres-contribution-identity-store";
import {
  createPostgresMemberAuthority, LOCK_MEMBER_AUTHORITY_SQL, MEMBER_AUTHORITY_CLOCK_SQL,
} from "./postgres-member-authority";
import type { AuthorizationSnapshot } from "./authorization-contract";
import { isAuthenticatedPrincipal, type AuthenticatedPrincipal } from "./server-persistence-authority";

const SUBJECT = "user_member";
const TENANT = "tenant-a";
const DATASET = "00000000-0000-4000-8000-000000000001";
const BEGIN = "BEGIN ISOLATION LEVEL READ COMMITTED";
const request = () => new Request("https://empire.invalid/internal", {
  method: "POST",
  headers: { "x-actor": "user_founder", "x-tenant": "tenant-b", "x-role": "owner" },
  body: JSON.stringify({ subject: "user_founder", personId: "other", tenantId: "tenant-b", role: "owner" }),
});

function policy(): AuthorizationSnapshot {
  return {
    version: 1, revision: 3, tenant: { id: TENANT, status: "active", ownerSubjects: [] },
    datasets: [{ datasetId: DATASET, tenantId: TENANT }],
    memberships: [{ subject: SUBJECT, tenantId: TENANT, status: "active", revision: 2, roleIds: ["reader"] }],
    roles: [{ id: "reader", tenantId: TENANT, revision: 1, status: "active",
      grants: [{ id: "read", datasetId: DATASET, capability: "read", delegable: false }] }],
    delegations: [],
  };
}
function lockedRow(): QueryResultRow {
  return {
    actor_subject: SUBJECT, binding_id: "binding-member", person_id: "person-member",
    registry_revision: "5", binding_revision: "4", person_revision: "1", person_status: "active", person_kind: "other",
    state: { schemaVersion: 1, snapshot: policy(), revocations: [] }, revision: "3", checked_at: "1000",
    decision: { status: "allowed", reason: "direct-grant", policyVersion: 1, observedPolicyRevision: 3, evidenceId: "read" },
    eligibility_event: {
      tenantId: TENANT, personId: "person-member", revision: 1, status: "active", kind: "other",
      operationId: "eligibility:member:1", issuerSubject: "user_founder",
      sourceReference: "source:member:1", evidenceSha256: "a".repeat(64), recordedAtMs: 900,
    },
  };
}

function harness() {
  const queries: string[] = [];
  const parameters: unknown[][] = [];
  const control = {
    rows: [lockedRow()],
    ready: true as unknown,
    clock: "1100" as unknown,
    fail: new Map<string, unknown>(),
    command: new Map<string, string>(),
    unsafe: false,
    releaseFailure: false,
  };
  const release = vi.fn((_destroy?: boolean) => {
    if (control.releaseFailure) throw new Error("Private disposal failure.");
  });
  async function query<Row extends QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    queries.push(text);
    parameters.push(values);
    if (control.fail.has(text)) throw control.fail.get(text);
    const rows: QueryResultRow[] = text.includes("AS unsafe") ? [{ unsafe: control.unsafe }]
      : text === IDENTITY_CONTRACT_SQL ? [{ ready: control.ready }]
      : text === LOCK_MEMBER_AUTHORITY_SQL ? structuredClone(control.rows)
      : text === MEMBER_AUTHORITY_CLOCK_SQL ? [{ now_ms: control.clock }] : [];
    return {
      rows: rows as Row[], rowCount: rows.length, fields: [], oid: 0,
      command: control.command.get(text) ?? (text === BEGIN ? "BEGIN" : text === "ROLLBACK" ? "ROLLBACK"
        : text.startsWith("SET LOCAL") ? "SET" : "SELECT"),
    };
  }
  const client: AuthorizationPostgresConnection = {
    query: query as AuthorizationPostgresConnection["query"], release,
  };
  const source = { connect: vi.fn(async () => client) };
  const sourceForPrincipal = vi.fn((_principal: AuthenticatedPrincipal) => source);
  const authority = createPostgresMemberAuthority({ tenantId: TENANT, datasetId: DATASET, sourceForPrincipal });
  return { authority, control, queries, parameters, release, source, sourceForPrincipal };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveClerkSession).mockResolvedValue({ status: "authenticated", subject: SUBJECT });
  // Deliberate test-only bypass of the hard-coded release interlock. All SQL
  // responses and the provider brand are synthetic, not evidence of real locks.
  vi.mocked(memberAuthorityRelease).mockReturnValue({ status: "approved" });
  // Hypothetical post-provenance sequencing only. Separate cases below restore
  // the real verifier, which MUST refuse even when this release is bypassed.
  vi.mocked(storedEligibilityProvenanceProblem).mockReturnValue(null);
  vi.mocked(restrictedSourceBinding).mockReturnValue({
    subject: SUBJECT, tenantId: TENANT, database: "offline-only", login: "member_login",
    databaseIdentitySha256: "a".repeat(64),
  });
});
afterEach(() => expect(Pool).not.toHaveBeenCalled());

describe("transaction-owned member authority (offline only)", () => {
  it("remains disabled in the real release module without an environment override", async () => {
    const actual = await vi.importActual<typeof import("./member-authority-release")>("./member-authority-release");
    expect(actual.memberAuthorityRelease()).toEqual({ status: "disabled" });
    vi.mocked(memberAuthorityRelease).mockReturnValue(actual.memberAuthorityRelease());
    const h = harness();
    expect(await h.authority.observe(request())).toEqual({ status: "disabled" });
    expect(h.sourceForPrincipal).not.toHaveBeenCalled();
    expect(h.queries).toEqual([]);
  });

  it("parses fixed SQL offline", async () => {
    await expect(parse(LOCK_MEMBER_AUTHORITY_SQL)).resolves.toBeDefined();
    await expect(parse(MEMBER_AUTHORITY_CLOCK_SQL)).resolves.toBeDefined();
  });

  it("owns one bounded transaction, rechecks the database clock and returns only a historical observation after rollback", async () => {
    const h = harness();
    expect(await h.authority.observe(request())).toEqual({
      status: "observed", source: "committed-database-read", subject: SUBJECT,
      tenantId: TENANT, datasetId: DATASET, personId: "person-member", bindingId: "binding-member",
      registryRevision: 5, bindingRevision: 4, personRevision: 1, policyRevision: 3,
      membershipRevision: 2, checkedAt: 1100,
    });
    expect(h.queries.slice(0, 4)).toEqual([
      BEGIN, "SET LOCAL lock_timeout = '5s'", "SET LOCAL statement_timeout = '10s'",
      "SET LOCAL idle_in_transaction_session_timeout = '15s'",
    ]);
    expect(h.queries[4]).toContain("AS unsafe");
    expect(h.queries.slice(5)).toEqual([
      IDENTITY_CONTRACT_SQL, LOCK_MEMBER_AUTHORITY_SQL, MEMBER_AUTHORITY_CLOCK_SQL, "ROLLBACK",
    ]);
    expect(h.parameters[h.queries.indexOf(LOCK_MEMBER_AUTHORITY_SQL)]).toEqual([TENANT, DATASET]);
    expect(h.source.connect).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(isAuthenticatedPrincipal(h.sourceForPrincipal.mock.calls[0]?.[0])).toBe(true);
    expect(h.queries).not.toContain("COMMIT");
    expect(Object.keys(h.authority)).toEqual(["observe"]);
    expect(storedEligibilityProvenanceProblem).toHaveBeenCalledExactlyOnceWith(lockedRow().eligibility_event);
  });

  it("real provenance refusal prevents an observation even if the member release alone is bypassed", async () => {
    const actual = await vi.importActual<typeof import("./person-eligibility-provenance")>("./person-eligibility-provenance");
    const h = harness();
    vi.mocked(storedEligibilityProvenanceProblem).mockImplementation(event => {
      // The real verifier is reached before rollback/release, on the same lease.
      expect(h.queries.at(-1)).toBe(MEMBER_AUTHORITY_CLOCK_SQL);
      expect(h.release).not.toHaveBeenCalled();
      return actual.storedEligibilityProvenanceProblem(event);
    });
    const result = await h.authority.observe(request());
    expect(result).toMatchObject({
      status: "unavailable", outcome: "not-submitted",
      message: expect.stringContaining("approved-independent-issuer-authority-and-revocation-source"),
    });
    expect(result).not.toHaveProperty("personId");
    expect(result).not.toHaveProperty("eligibility_event");
    expect(h.source.connect).toHaveBeenCalledTimes(1);
    expect(h.queries.at(-1)).toBe("ROLLBACK");
    expect(h.queries).not.toContain("COMMIT");
    expect(h.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it.each([
    { tenantId: "tenant-b" }, { personId: "other-person" }, { revision: 2 }, { revision: "1" },
    { status: "inactive" }, { kind: "founder" }, { recordedAtMs: 1001 },
    { issuerSubject: "" }, { sourceReference: "" }, { evidenceSha256: "bad" }, { approved: true },
  ])("rejects inconsistent locked eligibility before provenance verification: %j", async change => {
    const h = harness();
    h.control.rows = [{
      ...lockedRow(), eligibility_event: { ...lockedRow().eligibility_event, ...change },
    }];
    expect(await h.authority.observe(request())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(storedEligibilityProvenanceProblem).not.toHaveBeenCalled();
    expect(h.queries.at(-1)).toBe("ROLLBACK");
  });

  it.each([null, undefined, {}])("rejects absent legacy eligibility audit fields: %j", async event => {
    const h = harness();
    h.control.rows = [{ ...lockedRow(), eligibility_event: event }];
    expect(await h.authority.observe(request())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(storedEligibilityProvenanceProblem).not.toHaveBeenCalled();
  });

  it("propagates a provenance denial without disclosing an observation", async () => {
    const h = harness();
    vi.mocked(storedEligibilityProvenanceProblem).mockReturnValue({ status: "unauthorized", reason: "forbidden" });
    expect(await h.authority.observe(request())).toEqual({ status: "unauthorized", reason: "forbidden" });
    expect(h.queries.at(-1)).toBe("ROLLBACK");
    expect(h.source.connect).toHaveBeenCalledTimes(1);
  });

  it("does not preserve a provenance refusal result if transaction cleanup is uncertain", async () => {
    const actual = await vi.importActual<typeof import("./person-eligibility-provenance")>("./person-eligibility-provenance");
    vi.mocked(storedEligibilityProvenanceProblem).mockImplementation(actual.storedEligibilityProvenanceProblem);
    const h = harness();
    h.control.fail.set("ROLLBACK", new Error("Unconfirmed rollback."));
    expect(await h.authority.observe(request())).toMatchObject({ status: "unavailable", outcome: "unknown" });
    expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("does not acquire a source for an unauthenticated request", async () => {
    const h = harness();
    vi.mocked(resolveClerkSession).mockResolvedValue({ status: "unauthenticated" });
    expect(await h.authority.observe(request())).toEqual({ status: "unauthorized", reason: "authentication-required" });
    expect(h.sourceForPrincipal).not.toHaveBeenCalled();
  });

  it("fails closed on session-provider failure", async () => {
    const h = harness();
    vi.mocked(resolveClerkSession).mockRejectedValue(new Error("Private Clerk error."));
    expect(await h.authority.observe(request())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(h.sourceForPrincipal).not.toHaveBeenCalled();
  });

  it.each(["absent", "subject", "tenant"] as const)("rejects a %s restricted binding before connecting", async failure => {
    const h = harness();
    const binding = {
      subject: failure === "subject" ? "user_else" : SUBJECT,
      tenantId: failure === "tenant" ? "tenant-b" : TENANT,
      database: "offline-only", login: "member_login", databaseIdentitySha256: "a".repeat(64),
    };
    vi.mocked(restrictedSourceBinding).mockReturnValue(failure === "absent" ? undefined : binding);
    expect(await h.authority.observe(request())).toEqual({ status: "unauthorized", reason: "forbidden" });
    expect(h.source.connect).not.toHaveBeenCalled();
  });

  it("maps SQL authority denials to one non-disclosing response, without leaking the cause", async () => {
    const h = harness();
    h.control.fail.set(LOCK_MEMBER_AUTHORITY_SQL, Object.assign(new Error("Private rejection detail."), { code: "42501" }));
    expect(await h.authority.observe(request())).toEqual({ status: "unauthorized", reason: "forbidden" });
    expect(h.queries.at(-1)).toBe("ROLLBACK");
    expect(h.source.connect).toHaveBeenCalledTimes(1);
  });

  it.each([
    { actor_subject: "user_else" }, { binding_id: "" }, { person_id: "" }, { person_status: "inactive" },
    { person_kind: "client-founder" }, { person_revision: "0" }, { binding_revision: "0" },
    { registry_revision: "3" }, { registry_revision: "9007199254740992" },
    { revision: "4" }, { checked_at: "-1" }, { decision: { status: "allowed", reason: "owner-authority" } },
    { state: null },
  ])("rejects inconsistent authoritative rows: %j", async change => {
    const h = harness();
    h.control.rows = [{ ...lockedRow(), ...change }];
    expect(await h.authority.observe(request())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(h.queries).not.toContain(MEMBER_AUTHORITY_CLOCK_SQL);
    expect(h.queries.at(-1)).toBe("ROLLBACK");
  });

  it.each(["cross-tenant", "no-membership", "no-permission"] as const)(
    "independently refuses %s even when SQL claims allowed", async failure => {
      const h = harness();
      const observed = policy();
      const changed = failure === "cross-tenant" ? { ...observed, tenant: { ...observed.tenant, id: "tenant-b" } }
        : failure === "no-membership" ? { ...observed, memberships: [] }
        : { ...observed, roles: observed.roles.map(role => ({ ...role, grants: [] })) };
      h.control.rows = [{ ...lockedRow(), state: { schemaVersion: 1, snapshot: changed, revocations: [] } }];
      expect(await h.authority.observe(request())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
      expect(h.queries.at(-1)).toBe("ROLLBACK");
    },
  );

  it("reloads permission state after a revocation between successive transactions (not a real concurrency test)", async () => {
    const h = harness();
    expect(await h.authority.observe(request())).toMatchObject({ status: "observed" });
    h.control.fail.set(LOCK_MEMBER_AUTHORITY_SQL, Object.assign(new Error("revoked"), { code: "42501" }));
    expect(await h.authority.observe(request())).toEqual({ status: "unauthorized", reason: "forbidden" });
    expect(h.source.connect).toHaveBeenCalledTimes(2);
    expect(h.queries.filter(sql => sql === LOCK_MEMBER_AUTHORITY_SQL)).toHaveLength(2);
    expect(h.queries.filter(sql => sql === "ROLLBACK")).toHaveLength(2);
  });

  it("does not cache a previous allowed decision when current permissions change", async () => {
    const h = harness();
    expect(await h.authority.observe(request())).toMatchObject({ status: "observed", policyRevision: 3 });
    const previous = policy();
    const changed = { ...previous, revision: 4, roles: previous.roles.map(role => ({ ...role, revision: 2, grants: [] })) };
    // Deliberately inconsistent SQL 'allowed' evidence: the real policy evaluator
    // must still reject the freshly loaded state, not reuse the earlier allowance.
    h.control.rows = [{
      ...lockedRow(), revision: "4", state: { schemaVersion: 1, snapshot: changed, revocations: [] },
      decision: { status: "allowed", reason: "direct-grant", policyVersion: 1, observedPolicyRevision: 4, evidenceId: "read" },
    }];
    expect(await h.authority.observe(request())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(h.source.connect).toHaveBeenCalledTimes(2);
    expect(h.queries.filter(sql => sql === LOCK_MEMBER_AUTHORITY_SQL)).toHaveLength(2);
  });

  it("discards a delegation that expires while the transaction is open", async () => {
    const h = harness();
    const base = policy();
    const delegated: AuthorizationSnapshot = {
      ...base,
      memberships: [
        { ...base.memberships[0], roleIds: [] },
        { subject: "user_issuer", tenantId: TENANT, status: "active", revision: 1, roleIds: ["reader"] },
      ],
      roles: base.roles.map(role => ({ ...role, grants: role.grants.map(grant => ({ ...grant, delegable: true })) })),
      delegations: [{
        id: "delegated", tenantId: TENANT, datasetId: DATASET, issuerSubject: "user_issuer", recipientSubject: SUBJECT,
        capability: "read", sourceRoleId: "reader", sourceGrantId: "read", sourceRoleRevision: 1,
        issuerMembershipRevision: 1, recipientMembershipRevision: 2, issuedAt: 900, expiresAt: 1100, status: "active",
      }],
    };
    h.control.rows = [{
      ...lockedRow(), state: { schemaVersion: 1, snapshot: delegated, revocations: [] },
      decision: { status: "allowed", reason: "delegated-grant", policyVersion: 1, observedPolicyRevision: 3, evidenceId: "delegated" },
    }];
    expect(await h.authority.observe(request())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(h.queries.at(-1)).toBe("ROLLBACK");
  });

  it.each(["999", "-1", "not-time"])("rejects a backwards or malformed completion clock %s", async clock => {
    const h = harness();
    h.control.clock = clock;
    expect(await h.authority.observe(request())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
  });

  it.each<{ rows: QueryResultRow[] }>([
    { rows: [] },
    { rows: [lockedRow(), lockedRow()] },
  ])("refuses missing or ambiguous rows", async ({ rows }) => {
    const h = harness();
    h.control.rows = rows;
    expect(await h.authority.observe(request())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
  });

  it("does not call the lock API when the existing identity contract is absent", async () => {
    const h = harness();
    h.control.ready = false;
    expect(await h.authority.observe(request())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(h.queries).not.toContain(LOCK_MEMBER_AUTHORITY_SQL);
  });

  it.each([BEGIN, IDENTITY_CONTRACT_SQL, LOCK_MEMBER_AUTHORITY_SQL, MEMBER_AUTHORITY_CLOCK_SQL])(
    "rolls back backend failure at %s without retrying", async sql => {
      const h = harness();
      h.control.fail.set(sql, new Error("Private backend failure."));
      expect(await h.authority.observe(request())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
      expect(h.queries.at(-1)).toBe("ROLLBACK");
      expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
      expect(h.source.connect).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects unsafe database roles before reading identity", async () => {
    const h = harness();
    h.control.unsafe = true;
    expect(await h.authority.observe(request())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(h.queries).not.toContain(LOCK_MEMBER_AUTHORITY_SQL);
  });

  it.each(["failed-rollback", "unconfirmed-rollback", "disposal"] as const)(
    "discards all observations on uncertain cleanup: %s", async failure => {
      const h = harness();
      if (failure === "failed-rollback") h.control.fail.set("ROLLBACK", new Error("Private rollback failure."));
      if (failure === "unconfirmed-rollback") h.control.command.set("ROLLBACK", "SELECT");
      if (failure === "disposal") h.control.releaseFailure = true;
      expect(await h.authority.observe(request())).toMatchObject({ status: "unavailable", outcome: "unknown" });
      expect(h.queries).not.toContain("COMMIT");
      expect(h.source.connect).toHaveBeenCalledTimes(1);
    },
  );

  it("fails closed without SQL when connecting fails", async () => {
    const h = harness();
    h.source.connect.mockRejectedValue(new Error("Private connection failure."));
    expect(await h.authority.observe(request())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(h.queries).toEqual([]);
    expect(h.release).not.toHaveBeenCalled();
  });
});
