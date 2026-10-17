import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { parse } from "libpg-query";

const sdk = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<unknown>>(),
  getSession: vi.fn<(id: string) => Promise<unknown>>(),
  client: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: sdk.auth, clerkClient: sdk.client,
}));
vi.mock("./restricted-postgres-provider", () => ({ restrictedSourceBinding: vi.fn() }));
vi.mock("pg", () => ({
  Pool: vi.fn(function () { throw new Error("Offline founder tests cannot open PostgreSQL."); }),
}));

import { Pool } from "pg";
import {
  isFounderDecisionSession, recheckClerkFounderDecisionSession, resolveClerkFounderDecisionSession,
} from "./clerk-founder-decision-session";
import {
  consumeFounderEligibilityIntent, isAuthenticatedFounderEligibilityIntent, prepareFounderEligibilityIntent,
} from "./founder-eligibility-intent";
import type { FounderEligibilityDecisionRequest } from "./founder-eligibility-decision-contract";
import {
  isEligibilityDecisionRecord, storedEligibilityProvenanceProblem, verifyStoredEligibilityDecision,
  type CandidateFounderEligibilityObservation, type EligibilityDecisionRecord,
} from "./person-eligibility-provenance";
import {
  createPostgresFounderEligibilityDecisionPreflight, FOUNDER_ELIGIBILITY_CLOCK_SQL,
  FOUNDER_ELIGIBILITY_CONTRACT_SQL, LOCK_FOUNDER_ELIGIBILITY_SQL,
} from "./postgres-founder-eligibility-decision";
import type { AuthorizationPostgresConnection } from "./postgres-authorization-store";
import { IDENTITY_CONTRACT_SQL } from "./postgres-contribution-identity-store";
import { restrictedSourceBinding } from "./restricted-postgres-provider";
import { isAuthenticatedPrincipal, type AuthenticatedPrincipal } from "./server-persistence-authority";
import { memberAuthorityRelease } from "./member-authority-release";
import { employeeProvisioningRelease } from "./employee-provisioning-release";
import { trustedPersonAuthoritySourceProblem } from "./trusted-person-authority-source";
import { POST } from "../api/founder/eligibility-decisions/route";

const FOUNDER = "user_founder123456789";
const STAFF = "user_staff";
const TENANT = "tenant-a";
const NOW = 1_000_000;
const SESSION = "sess_founder";
const denied = { status: "unauthorized", reason: "forbidden" };
const BEGIN = "BEGIN ISOLATION LEVEL READ COMMITTED";
const request = () => new Request("https://empire.invalid/api/founder/eligibility-decisions", {
  method: "POST",
  headers: { origin: "https://empire.invalid", "content-type": "application/json",
    "x-user-id": FOUNDER, "x-role": "founder", "x-authenticated-at": String(NOW) },
  body: JSON.stringify(input()),
});
function input(): FounderEligibilityDecisionRequest {
  return {
    tenantId: TENANT, subject: STAFF, personId: "person-staff", decision: "revoke",
    operationId: "eligibility:staff:2", expectedRegistryRevision: 2, expectedBindingRevision: 2,
    expectedPolicyRevision: 1, expectedPersonRevision: 1,
    sourceReference: "source:staff", evidenceSha256: "a".repeat(64),
  };
}
function context() {
  return {
    userId: FOUNDER, sessionId: SESSION, sessionStatus: "active", actor: undefined,
    sessionClaims: { iss: "https://clerk.invalid", sub: FOUNDER, sid: SESSION, iat: 1000, nbf: 999, exp: 1060 },
    factorVerificationAge: [0, -1],
  };
}
function liveSession() {
  return { id: SESSION, userId: FOUNDER, status: "active", actor: null, expireAt: NOW + 600_000, abandonAt: NOW + 600_000 };
}
function observation(): CandidateFounderEligibilityObservation {
  return {
    registry: {
      version: 1, revision: 2, bindingRevision: 2, policyRevision: 0,
      events: [FOUNDER, STAFF].map((subject, index) => ({
        sequence: index + 1, eventId: `binding-${index}`, previousEventId: index === 0 ? null : "binding-0",
        operationId: `bind:${index}`, tenantId: TENANT, actorSubject: FOUNDER, recordedAtMs: NOW - 100,
        kind: "subject-bound", bindingId: `binding-${index}`, subject,
        personId: index === 0 ? "person-founder" : "person-staff",
        verificationId: `verification-${index}`, verifiedAtMs: NOW - 100,
      })),
    },
    authority: {
      schemaVersion: 1, revocations: [],
      snapshot: {
        version: 1, revision: 1, tenant: { id: TENANT, status: "active", ownerSubjects: [FOUNDER] },
        datasets: [], roles: [], delegations: [],
        memberships: [FOUNDER, STAFF].map(subject => ({
          subject, tenantId: TENANT, revision: 1, status: "active", roleIds: [],
        })),
      },
    },
    issuerPerson: { tenantId: TENANT, personId: "person-founder", status: "active", kind: "founder" },
    targetPerson: { tenantId: TENANT, personId: "person-staff", status: "active", kind: "other" },
    issuerEligibility: {
      tenantId: TENANT, personId: "person-founder", revision: 1, status: "active", kind: "founder",
      operationId: "eligibility:founder:1", issuerSubject: FOUNDER, sourceReference: "source:founder",
      evidenceSha256: "b".repeat(64), recordedAtMs: NOW - 100,
    },
    latestTargetEvent: {
      tenantId: TENANT, personId: "person-staff", revision: 1, status: "active", kind: "other",
      operationId: "eligibility:staff:1", issuerSubject: FOUNDER, sourceReference: "source:staff",
      evidenceSha256: "a".repeat(64), recordedAtMs: NOW - 100,
    },
    usedOperationIds: [], authenticatedAtMs: NOW - 60_000, nowMs: NOW,
  };
}
function row(): QueryResultRow {
  const current = observation();
  return {
    registry: current.registry, state: current.authority, policy_revision: "1", actor_subject: FOUNDER, now_ms: String(NOW),
    binding_id: "binding-1", issuer_binding_id: "binding-0", person_id: "person-staff", issuer_person_id: "person-founder",
    issuer_event: current.issuerEligibility, target_event: current.latestTargetEvent,
    operation_record: null, operation_used: false,
  };
}
function record(): EligibilityDecisionRecord {
  return {
    version: 1, subject: STAFF, bindingId: "binding-1", issuerBindingId: "binding-0",
    issuerPersonId: "person-founder", issuerPersonRevision: 1, registryRevision: 2,
    bindingRevision: 2, policyRevision: 1, issuerMembershipRevision: 1, subjectMembershipRevision: 1,
    authenticatedAtMs: NOW - 120_000, validUntilMs: NOW + 180_000,
    authenticationReference: "authentication:historical", issuerAuthorityReference: "issuer:historical",
    decision: "revoke",
    event: {
      ...observation().latestTargetEvent!, revision: 2, status: "inactive", operationId: input().operationId,
      recordedAtMs: NOW - 10,
    },
  };
}
function harness() {
  const queries: string[] = [];
  const parameters: unknown[][] = [];
  const control = {
    rows: [row()], ready: true as unknown, clock: String(NOW + 10) as unknown,
    unsafe: false, fail: new Map<string, unknown>(), commands: new Map<string, string>(),
    releaseFailure: false, completion: () => {},
  };
  const release = vi.fn<(destroy?: boolean) => void>(() => {
    if (control.releaseFailure) throw new Error("Private release failure.");
  });
  async function query<Row extends QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    queries.push(text);
    parameters.push(values);
    if (control.fail.has(text)) throw control.fail.get(text);
    if (text === LOCK_FOUNDER_ELIGIBILITY_SQL) control.completion();
    const rows: QueryResultRow[] = text.includes("AS unsafe") ? [{ unsafe: control.unsafe }]
      : text === IDENTITY_CONTRACT_SQL || text === FOUNDER_ELIGIBILITY_CONTRACT_SQL ? [{ ready: control.ready }]
      : text === LOCK_FOUNDER_ELIGIBILITY_SQL ? structuredClone(control.rows)
      : text === FOUNDER_ELIGIBILITY_CLOCK_SQL ? [{ now_ms: control.clock }] : [];
    return {
      rows: rows as Row[], rowCount: rows.length, fields: [], oid: 0,
      command: control.commands.get(text) ?? (text === BEGIN ? "BEGIN" : text === "ROLLBACK" ? "ROLLBACK"
        : text.startsWith("SET LOCAL") ? "SET" : "SELECT"),
    };
  }
  const client: AuthorizationPostgresConnection = { query: query as AuthorizationPostgresConnection["query"], release };
  const source = { connect: vi.fn(async () => client) };
  const sourceForPrincipal = vi.fn<(principal: AuthenticatedPrincipal) => typeof source>(() => source);
  const preflight = createPostgresFounderEligibilityDecisionPreflight({ tenantId: TENANT, sourceForPrincipal });
  return { preflight, control, queries, parameters, source, sourceForPrincipal, release };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("EMPIRE_OS_FOUNDER_CLERK_USER_ID", FOUNDER);
  sdk.auth.mockResolvedValue(context());
  sdk.client.mockResolvedValue({ sessions: { getSession: sdk.getSession } });
  sdk.getSession.mockResolvedValue(liveSession());
  vi.mocked(restrictedSourceBinding).mockReturnValue({
    subject: FOUNDER, tenantId: TENANT, database: "offline-only", login: "founder_login",
    databaseIdentitySha256: "c".repeat(64),
  });
});
afterEach(() => {
  expect(Pool).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Clerk-owned fresh founder decision boundary", () => {
  it("binds an immutable exact command to the verified live session, not request identity headers", async () => {
    const command = { ...input() };
    const pending = prepareFounderEligibilityIntent(request(), command);
    command.personId = "mutated-after-call";
    const intent = await pending;
    expect(isAuthenticatedFounderEligibilityIntent(intent)).toBe(true);
    if (!isAuthenticatedFounderEligibilityIntent(intent)) throw new Error("Missing intent.");
    expect(intent.request.personId).toBe("person-staff");
    expect(intent.session).toMatchObject({
      sessionId: SESSION, authenticatedAtMs: NOW - 60_000, checkedAtMs: NOW, validUntilMs: NOW + 60_000,
    });
    expect(isAuthenticatedPrincipal(intent.session.principal)).toBe(true);
    expect(intent.session.principal.subject).toBe(FOUNDER);
    expect(Object.isFrozen(intent)).toBe(true);
    expect(Object.isFrozen(intent.request)).toBe(true);
    expect(intent.requestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(sdk.getSession).toHaveBeenCalledExactlyOnceWith(SESSION);
  });
  it("burns intents synchronously and rejects copies, JSON transport and repeat/concurrent consumption", async () => {
    const intent = await prepareFounderEligibilityIntent(request(), input());
    expect(consumeFounderEligibilityIntent({ ...intent })).toEqual(denied);
    expect(consumeFounderEligibilityIntent(JSON.parse(JSON.stringify(intent)))).toEqual(denied);
    expect(consumeFounderEligibilityIntent(intent)).toBe(intent);
    expect(consumeFounderEligibilityIntent(intent)).toEqual(denied);
  });
  it("allows only one contender to consume the same process-local intent", async () => {
    const intent = await prepareFounderEligibilityIntent(request(), input());
    const results = await Promise.all(Array.from({ length: 8 }, async () => consumeFounderEligibilityIntent(intent)));
    expect(results.filter(isAuthenticatedFounderEligibilityIntent)).toHaveLength(1);
    expect(results.filter(result => !isAuthenticatedFounderEligibilityIntent(result))).toEqual(Array(7).fill(denied));
  });
  it("burns expired intents and refuses configured founder rotation at consumption", async () => {
    const intent = await prepareFounderEligibilityIntent(request(), input());
    vi.setSystemTime(NOW + 60_000);
    expect(consumeFounderEligibilityIntent(intent)).toEqual(denied);
    vi.setSystemTime(NOW);
    expect(consumeFounderEligibilityIntent(intent)).toEqual(denied);
    const fresh = await prepareFounderEligibilityIntent(request(), input());
    vi.stubEnv("EMPIRE_OS_FOUNDER_CLERK_USER_ID", "user_rotated_founder");
    expect(consumeFounderEligibilityIntent(fresh)).toEqual(denied);
  });
  it("allows only the strictly bounded conservative first-factor freshness window", async () => {
    sdk.auth.mockResolvedValue({ ...context(), factorVerificationAge: [3, -1] });
    const intent = await prepareFounderEligibilityIntent(request(), input());
    expect(isAuthenticatedFounderEligibilityIntent(intent)).toBe(true);
    vi.setSystemTime(NOW + 60_000);
    expect(await prepareFounderEligibilityIntent(request(), input())).toEqual(denied);
  });
  it.each([
    { tenantId: "tenant-b" }, { personId: "other" }, { subject: "user_other" }, { decision: "issue" },
    { operationId: "new-operation" }, { expectedRegistryRevision: 3 }, { expectedBindingRevision: 1 },
    { expectedPolicyRevision: 2 }, { expectedPersonRevision: 2 }, { sourceReference: "new-source" },
    { evidenceSha256: "d".repeat(64) },
  ])("binds every request field into server-owned integrity metadata: %j", async change => {
    const first = await prepareFounderEligibilityIntent(request(), input());
    const second = await prepareFounderEligibilityIntent(request(), { ...input(), ...change });
    if (!isAuthenticatedFounderEligibilityIntent(first) || !isAuthenticatedFounderEligibilityIntent(second)) {
      throw new Error("Missing synthetic intents.");
    }
    expect(first.requestSha256).not.toBe(second.requestSha256);
  });
  it.each([
    { factorVerificationAge: null }, { factorVerificationAge: [-1, -1] },
    { factorVerificationAge: [4, -1] }, { factorVerificationAge: [0.1, -1] },
    { userId: STAFF }, { userId: null }, { actor: { sub: "user_support" } },
    { sessionId: "caller-session" }, { sessionStatus: "pending" },
  ])("refuses stale/missing first-factor verification, impersonation and wrong identity: %j", async change => {
    sdk.auth.mockResolvedValue({ ...context(), ...change });
    const result = await prepareFounderEligibilityIntent(request(), input());
    expect(isAuthenticatedFounderEligibilityIntent(result)).toBe(false);
    expect(result).toMatchObject({ status: "unauthorized" });
  });
  it.each([
    { sub: STAFF }, { sid: "sess_other" }, { act: { sub: "user_support" } },
    { iat: 1001 }, { iat: 700 }, { iat: Number.MAX_SAFE_INTEGER },
    { nbf: 1001 }, { exp: 1000 }, { exp: "1060" }, { iss: "" }, { iss: "http://clerk.invalid" },
  ])("fails closed on signed claim inconsistencies and boundary timestamps: %j", async change => {
    sdk.auth.mockResolvedValue({ ...context(), sessionClaims: { ...context().sessionClaims, ...change } });
    expect(await prepareFounderEligibilityIntent(request(), input())).toEqual(denied);
  });
  it.each([
    { id: "sess_other" }, { userId: STAFF }, { status: "revoked" }, { status: "ended" },
    { expireAt: NOW }, { abandonAt: NOW }, { actor: { sub: "user_support" } }, { actor: undefined },
  ])("checks live Backend API state, not last-active or caller freshness: %j", async change => {
    sdk.getSession.mockResolvedValue({ ...liveSession(), ...change, lastActiveAt: NOW });
    expect(await prepareFounderEligibilityIntent(request(), input())).toEqual(denied);
  });
  it("rejects caller-supplied authentication, timestamp, signature and hash authority", async () => {
    for (const extra of [{ issuerSubject: FOUNDER }, { authenticatedAtMs: NOW },
      { requestSha256: "a".repeat(64) }, { signature: "caller-proof" }, { approved: true }]) {
      expect(await prepareFounderEligibilityIntent(request(), { ...input(), ...extra })).toMatchObject({ status: "invalid-request" });
    }
    const getter = vi.fn(() => FOUNDER);
    expect(await prepareFounderEligibilityIntent(request(),
      Object.defineProperty({ ...input() }, "subject", { enumerable: true, get: getter })))
      .toMatchObject({ status: "invalid-request" });
    expect(getter).not.toHaveBeenCalled();
  });
  it("does not extend an intent after token renewal, and detects founder rotation, revocation and clock rollback", async () => {
    const session = await resolveClerkFounderDecisionSession(request());
    if (!isFounderDecisionSession(session)) throw new Error("Missing session.");
    vi.setSystemTime(NOW + 60_000);
    sdk.auth.mockResolvedValue({ ...context(), sessionClaims: { ...context().sessionClaims, iat: 1060, exp: 1120 } });
    expect(await recheckClerkFounderDecisionSession(request(), session)).toEqual(denied);
    vi.setSystemTime(NOW - 1);
    expect(await recheckClerkFounderDecisionSession(request(), session)).toEqual(denied);
    vi.setSystemTime(NOW);
    sdk.auth.mockResolvedValue(context());
    vi.stubEnv("EMPIRE_OS_FOUNDER_CLERK_USER_ID", "user_rotated_founder");
    expect(await recheckClerkFounderDecisionSession(request(), session)).toEqual(denied);
    vi.stubEnv("EMPIRE_OS_FOUNDER_CLERK_USER_ID", FOUNDER);
    sdk.getSession.mockResolvedValue({ ...liveSession(), status: "revoked" });
    expect(await recheckClerkFounderDecisionSession(request(), session)).toEqual(denied);
    expect(await recheckClerkFounderDecisionSession(request(), { ...session })).toEqual(denied);
  });
  it("returns explicit unavailability without leaking authentication service errors", async () => {
    sdk.getSession.mockRejectedValue(new Error("Private credentials and service details."));
    const result = await prepareFounderEligibilityIntent(request(), input());
    expect(result).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(JSON.stringify(result)).not.toContain("Private");
  });
  it("rejects a different independently active session even for the same founder", async () => {
    const session = await resolveClerkFounderDecisionSession(request());
    if (!isFounderDecisionSession(session)) throw new Error("Missing session.");
    sdk.auth.mockResolvedValue({
      ...context(), sessionId: "sess_replacement", sessionClaims: { ...context().sessionClaims, sid: "sess_replacement" },
    });
    sdk.getSession.mockResolvedValue({ ...liveSession(), id: "sess_replacement" });
    expect(await recheckClerkFounderDecisionSession(request(), session)).toEqual(denied);
  });
  it("rechecks configured founder authority after the Backend API round trip", async () => {
    sdk.getSession.mockImplementation(async () => {
      vi.stubEnv("EMPIRE_OS_FOUNDER_CLERK_USER_ID", "user_rotated_founder");
      return liveSession();
    });
    expect(await prepareFounderEligibilityIntent(request(), input())).toEqual(denied);
  });
  it("binds rechecks to the original verified identity issuer as well as subject and session", async () => {
    const session = await resolveClerkFounderDecisionSession(request());
    if (!isFounderDecisionSession(session)) throw new Error("Missing session.");
    sdk.auth.mockResolvedValue({ ...context(), sessionClaims: { ...context().sessionClaims, iss: "https://other-clerk.invalid" } });
    expect(await recheckClerkFounderDecisionSession(request(), session)).toEqual(denied);
  });
});

describe("one transaction, exact founder decision preflight, no issuance", () => {
  it("reuses the eligibility planner under locks and discards the observation after confirmed rollback", async () => {
    const h = harness();
    expect(await h.preflight.inspect(request(), input())).toMatchObject({
      status: "unavailable", outcome: "not-submitted",
      message: expect.stringContaining("approved-independent-issuer-authority-and-revocation-source"),
    });
    expect(h.queries.slice(0, 4)).toEqual([
      BEGIN, "SET LOCAL lock_timeout = '5s'", "SET LOCAL statement_timeout = '10s'",
      "SET LOCAL idle_in_transaction_session_timeout = '15s'",
    ]);
    expect(h.queries.slice(5)).toEqual([
      IDENTITY_CONTRACT_SQL, FOUNDER_ELIGIBILITY_CONTRACT_SQL, LOCK_FOUNDER_ELIGIBILITY_SQL,
      FOUNDER_ELIGIBILITY_CLOCK_SQL, "ROLLBACK",
    ]);
    expect(h.parameters[h.queries.indexOf(LOCK_FOUNDER_ELIGIBILITY_SQL)]).toEqual([
      TENANT, STAFF, "person-staff", input().operationId,
    ]);
    expect(sdk.getSession).toHaveBeenCalledTimes(3);
    expect(isAuthenticatedPrincipal(h.sourceForPrincipal.mock.calls[0]?.[0])).toBe(true);
    expect(h.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(h.queries).not.toContain("COMMIT");
    for (const sql of h.queries) expect(sql).toMatch(/^(BEGIN|SET LOCAL|SELECT|ROLLBACK)\b/);
    expect(h.queries.some(sql => /^\s*(INSERT|UPDATE|DELETE|COMMIT)\b/.test(sql))).toBe(false);
    expect(Object.keys(h.preflight)).toEqual(["inspect"]);
  });
  it("does not invent a Person to make first issuance pass", async () => {
    const h = harness();
    h.control.rows[0].target_event = null;
    expect(await h.preflight.inspect(request(), { ...input(), decision: "issue", expectedPersonRevision: 0 }))
      .toMatchObject({ status: "unavailable", message: expect.stringContaining("approved server-owned Person verifier") });
    expect(h.queries.at(-1)).toBe("ROLLBACK");
  });
  it.each([
    { tenantId: "tenant-b" }, { personId: "other" }, { subject: "user_other" },
    { expectedRegistryRevision: 1 }, { expectedBindingRevision: 1 }, { expectedPolicyRevision: 2 },
    { expectedPersonRevision: 0 }, { decision: "issue" },
  ])("refuses substitution and stale revision fences: %j", async change => {
    const h = harness();
    expect(await h.preflight.inspect(request(), { ...input(), ...change })).toEqual(denied);
    expect(h.queries).not.toContain("COMMIT");
  });
  it.each([
    { actor_subject: STAFF }, { issuer_event: null }, { target_event: null }, { operation_used: true },
    { operation_record: {} }, { now_ms: String(NOW - 1) }, { operation_used: "false" }, { policy_revision: "2" },
    { binding_id: "new-binding" }, { issuer_binding_id: "new-issuer-binding" },
    { person_id: "new-person" }, { issuer_person_id: "new-issuer-person" },
  ])("fails closed on missing, substituted or already consumed locked evidence: %j", async change => {
    const h = harness();
    Object.assign(h.control.rows[0], change);
    expect(await h.preflight.inspect(request(), input())).toEqual(denied);
    expect(h.queries.at(-1)).toBe("ROLLBACK");
  });
  it.each(["issuer_event", "target_event"] as const)("rejects revoked, cross-tenant and stale %s", async key => {
    for (const change of [{ status: "inactive" }, { tenantId: "tenant-b" },
      { personId: "other" }, { revision: 2 }, { recordedAtMs: NOW + 1 }]) {
      const h = harness();
      const event = key === "issuer_event" ? observation().issuerEligibility : observation().latestTargetEvent;
      h.control.rows[0][key] = { ...event, ...change };
      const result = await h.preflight.inspect(request(), input());
      // A current issuer's higher revision alone is consistent but never proves provenance.
      if (key === "issuer_event" && "revision" in change) expect(result).toMatchObject({ status: "unavailable" });
      else expect(result).toEqual(denied);
    }
  });
  it("checks request/record consistency and the exact latest event, but never authenticates matching database claims", async () => {
    const h = harness();
    const stored = record();
    expect(isEligibilityDecisionRecord(stored)).toBe(true);
    h.control.rows[0] = { ...row(), operation_record: stored, operation_used: true, target_event: stored.event };
    const result = await h.preflight.inspect(request(), input());
    expect(result).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(verifyStoredEligibilityDecision(stored)).toMatchObject({ status: "unavailable" });
    expect(storedEligibilityProvenanceProblem(stored.event)).toMatchObject({ status: "unavailable" });
    expect(stored.authenticatedAtMs).toBe(NOW - 120_000);
    expect(h.queries.at(-1)).toBe("ROLLBACK");
  });
  it.each([
    { subject: "user_other" }, { bindingId: "other" }, { issuerBindingId: "other" },
    { issuerPersonId: "other" }, { issuerPersonRevision: 2 }, { registryRevision: 3 },
    { bindingRevision: 1 }, { policyRevision: 2 }, { issuerMembershipRevision: 2 }, { subjectMembershipRevision: 2 },
  ])("rejects same-operation historical record substitution: %j", async change => {
    const h = harness();
    const stored = record();
    h.control.rows[0] = { ...row(), operation_record: { ...stored, ...change }, operation_used: true, target_event: stored.event };
    expect(await h.preflight.inspect(request(), input())).toEqual(denied);
  });
  it.each([
    { sourceReference: "other" }, { evidenceSha256: "e".repeat(64) }, { operationId: "other" },
    { recordedAtMs: NOW - 9 }, { issuerSubject: "user_other" },
  ])("rejects partial exact-event reconciliation: %j", async change => {
    const h = harness();
    const stored = record();
    h.control.rows[0] = { ...row(), operation_record: stored, operation_used: true, target_event: { ...stored.event, ...change } };
    expect(await h.preflight.inspect(request(), input())).toEqual(denied);
  });
  it("rechecks live Clerk revocation, session swaps, founder rotation and expiry before releasing locks", async () => {
    for (const completion of [
      () => sdk.getSession.mockResolvedValue({ ...liveSession(), status: "revoked" }),
      () => sdk.auth.mockResolvedValue({ ...context(), sessionId: "sess_other",
        sessionClaims: { ...context().sessionClaims, sid: "sess_other" } }),
      () => vi.stubEnv("EMPIRE_OS_FOUNDER_CLERK_USER_ID", "user_new_founder123456"),
      () => vi.setSystemTime(NOW + 60_000),
    ]) {
      sdk.auth.mockResolvedValue(context());
      sdk.getSession.mockResolvedValue(liveSession());
      vi.stubEnv("EMPIRE_OS_FOUNDER_CLERK_USER_ID", FOUNDER);
      vi.setSystemTime(NOW);
      const h = harness();
      h.control.completion = completion;
      expect(await h.preflight.inspect(request(), input())).toEqual(denied);
      expect(h.queries.at(-1)).toBe("ROLLBACK");
    }
  });
  it("checks fresh database time as well as Clerk time", async () => {
    const h = harness();
    h.control.clock = String(NOW + 60_000);
    expect(await h.preflight.inspect(request(), input())).toEqual(denied);
    h.control.clock = String(NOW - 1);
    expect(await h.preflight.inspect(request(), input())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
  });
  it("uses a shortened live session deadline at completion, never just the original token expiry", async () => {
    const h = harness();
    h.control.completion = () => sdk.getSession.mockResolvedValue({ ...liveSession(), expireAt: NOW + 5 });
    expect(await h.preflight.inspect(request(), input())).toEqual(denied);
    expect(h.queries.at(-1)).toBe("ROLLBACK");
  });
  it.each([undefined, { subject: STAFF, tenantId: TENANT }, { subject: FOUNDER, tenantId: "tenant-b" }])(
    "never connects an unbranded or wrong-scope source: %j", binding => {
      vi.mocked(restrictedSourceBinding).mockReturnValue(binding && {
        ...binding, database: "offline", login: "offline", databaseIdentitySha256: "a".repeat(64),
      });
      const h = harness();
      return h.preflight.inspect(request(), input()).then(result => {
        expect(result).toEqual(denied);
        expect(h.source.connect).not.toHaveBeenCalled();
      });
    },
  );
  it.each([BEGIN, IDENTITY_CONTRACT_SQL, FOUNDER_ELIGIBILITY_CONTRACT_SQL,
    LOCK_FOUNDER_ELIGIBILITY_SQL, FOUNDER_ELIGIBILITY_CLOCK_SQL])(
    "never retries after a query/lock/connection failure at %s", async sql => {
      const h = harness();
      h.control.fail.set(sql, { code: "40001", message: "Private failure" });
      expect(await h.preflight.inspect(request(), input())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
      expect(h.queries.at(-1)).toBe("ROLLBACK");
      expect(h.source.connect).toHaveBeenCalledTimes(1);
      expect(h.release).toHaveBeenCalledWith(true);
    },
  );
  it("discards evidence on unconfirmed rollback or release and never claims submission", async () => {
    for (const failure of ["rollback", "release"] as const) {
      const h = harness();
      if (failure === "rollback") h.control.commands.set("ROLLBACK", "SELECT");
      else h.control.releaseFailure = true;
      expect(await h.preflight.inspect(request(), input())).toMatchObject({
        status: "unavailable", outcome: "unknown", message: expect.stringContaining("No decision write was submitted"),
      });
      expect(h.queries).not.toContain("COMMIT");
    }
  });
  it("rejects unsafe roles, absent rows, malformed clocks and false database readiness", async () => {
    for (const change of [{ unsafe: true }, { rows: [] }, { ready: false }, { ready: "true" }, { clock: "1e6" }]) {
      const h = harness();
      Object.assign(h.control, change);
      expect(await h.preflight.inspect(request(), input())).toMatchObject({ status: "unavailable" });
      expect(h.queries.at(-1)).toBe("ROLLBACK");
    }
  });
  it("parses fixed SQL offline without treating it as transaction/concurrency proof", async () => {
    for (const sql of [LOCK_FOUNDER_ELIGIBILITY_SQL, FOUNDER_ELIGIBILITY_CONTRACT_SQL, FOUNDER_ELIGIBILITY_CLOCK_SQL]) {
      await expect(parse(sql)).resolves.toBeDefined();
    }
  });
});

describe("founder-only HTTP intake remains explicitly blocked, never accepted/queued", () => {
  it("runs the real session-to-command boundary and returns no-store 503 without opening a database", async () => {
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(sdk.getSession).toHaveBeenCalledWith(SESSION);
    expect(memberAuthorityRelease()).toEqual({ status: "disabled" });
    expect(employeeProvisioningRelease().status).toBe("disabled");
    expect(trustedPersonAuthoritySourceProblem()).toMatchObject({ status: "unavailable" });
  });
  it("rejects cross-origin, missing origin, wrong media type, invalid JSON and oversized bodies", async () => {
    for (const [headers, body, status] of [
      [{ origin: "https://attacker.invalid", "content-type": "application/json" }, "{}", 403],
      [{ "content-type": "application/json" }, "{}", 403],
      [{ origin: "https://empire.invalid", "content-type": "text/plain" }, "{}", 415],
      [{ origin: "https://empire.invalid", "content-type": "application/json" }, "{broken", 400],
      [{ origin: "https://empire.invalid", "content-type": "application/json" }, "x".repeat(8193), 413],
    ] as const) {
      const response = await POST(new Request(request().url, { method: "POST", headers, body }));
      expect(response.status).toBe(status);
    }
    expect(sdk.auth).not.toHaveBeenCalled();
  });
  it("enforces the actual 8192-byte limit, not a caller's content-length assertion", async () => {
    const body = JSON.stringify(input()).padEnd(8192, " ");
    const headers = { ...Object.fromEntries(request().headers), "content-length": "1" };
    expect((await POST(new Request(request().url, { method: "POST", headers, body }))).status).toBe(503);
    expect((await POST(new Request(request().url, { method: "POST", headers, body: `${body} ` }))).status).toBe(413);
  });
  it("maps unauthenticated, wrong-founder and forged authority commands to explicit denials", async () => {
    sdk.auth.mockResolvedValue({ userId: null });
    expect((await POST(request())).status).toBe(401);
    sdk.auth.mockResolvedValue({ ...context(), userId: STAFF });
    expect((await POST(request())).status).toBe(403);
    sdk.auth.mockResolvedValue(context());
    expect((await POST(new Request(request().url, {
      method: "POST", headers: request().headers, body: JSON.stringify({ ...input(), issuerSubject: FOUNDER }),
    }))).status).toBe(400);
  });
});
