import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./clerk-session-resolver", () => ({ resolveClerkSession: vi.fn() }));
vi.mock("pg", () => ({
  Pool: vi.fn(function () { throw new Error("Offline decisions must not open PostgreSQL."); }),
}));
import { Pool } from "pg";
import { resolveClerkSession } from "./clerk-session-resolver";
import { createServerPrincipalResolver, isAuthenticatedPrincipal } from "./server-persistence-authority";
import {
  planCandidateFounderEligibilityDecision, submitFounderEligibilityDecision, storedEligibilityProvenanceProblem,
  type FounderEligibilityDecisionRequest, type CandidateFounderEligibilityObservation,
} from "./person-eligibility-provenance";
import { memberAuthorityRelease } from "./member-authority-release";
import { employeeProvisioningRelease } from "./employee-provisioning-release";
import { trustedPersonAuthoritySourceProblem } from "./trusted-person-authority-source";

const FOUNDER = "user_founder123456789";
const STAFF = "user_staff";
const TENANT = "tenant-a";
const NOW = 1_000_000;
const denied = { status: "unauthorized", reason: "forbidden" };
const request = () => new Request("https://empire.invalid/internal", {
  headers: { "x-user-id": FOUNDER, "x-role": "founder" },
});
function input(): FounderEligibilityDecisionRequest {
  return {
    tenantId: TENANT, subject: STAFF, personId: "person-staff", decision: "issue",
    operationId: "eligibility:staff:1", expectedRegistryRevision: 2, expectedBindingRevision: 2,
    expectedPolicyRevision: 1, expectedPersonRevision: 0, sourceReference: "source:staff",
    evidenceSha256: "a".repeat(64),
  };
}
function observation(): { -readonly [Key in keyof CandidateFounderEligibilityObservation]: CandidateFounderEligibilityObservation[Key] } {
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
    latestTargetEvent: null, usedOperationIds: [], authenticatedAtMs: NOW - 10, nowMs: NOW,
  };
}
async function principal(subject = FOUNDER) {
  const actor = await createServerPrincipalResolver(async () => ({ status: "authenticated", subject }))(request());
  if (!isAuthenticatedPrincipal(actor)) throw new Error("Missing offline principal.");
  return actor;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EMPIRE_OS_FOUNDER_CLERK_USER_ID", FOUNDER);
  vi.mocked(resolveClerkSession).mockResolvedValue({ status: "authenticated", subject: FOUNDER });
});
afterEach(() => {
  vi.unstubAllEnvs();
  expect(Pool).not.toHaveBeenCalled();
});

describe("candidate founder eligibility decision policy (not source authentication)", () => {
  it("constructs only a frozen candidate for the existing append-only event shape", async () => {
    const current = observation();
    const original = structuredClone(current);
    const result = planCandidateFounderEligibilityDecision(await principal(), input(), current);
    expect(result).toMatchObject({
      status: "candidate", subject: STAFF, bindingId: "binding-1", issuerBindingId: "binding-0",
      expectedPersonRevision: 0, validUntilMs: NOW - 10 + 300_000,
      event: {
        tenantId: TENANT, personId: "person-staff", revision: 1, status: "active",
        operationId: input().operationId, issuerSubject: FOUNDER, recordedAtMs: NOW,
        sourceReference: input().sourceReference, evidenceSha256: input().evidenceSha256,
      },
    });
    expect(current).toEqual(original);
    if (result.status === "candidate") {
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.event)).toBe(true);
      expect(storedEligibilityProvenanceProblem(result.event)).toMatchObject({
        status: "unavailable", outcome: "not-submitted",
      });
    }
  });
  it("plans revocation as a new inactive event, never mutation or deletion", async () => {
    const actor = await principal();
    const issued = planCandidateFounderEligibilityDecision(actor, input(), observation());
    if (issued.status !== "candidate") throw new Error("Missing synthetic event.");
    const revoked = planCandidateFounderEligibilityDecision(actor, {
      ...input(), decision: "revoke", expectedPersonRevision: 1, operationId: "revoke:staff:2",
    }, { ...observation(), latestTargetEvent: issued.event, usedOperationIds: [input().operationId] });
    expect(revoked).toMatchObject({ status: "candidate", event: { status: "inactive", revision: 2 } });
    expect(issued.event.status).toBe("active");
  });
  it.each([null, { subject: FOUNDER }, { role: "founder", subject: FOUNDER }])(
    "rejects unbranded issuer identity: %j", actor => {
      expect(planCandidateFounderEligibilityDecision(actor, input(), observation()))
        .toEqual({ status: "unauthorized", reason: "authentication-required" });
    },
  );
  it("rejects authenticated staff even when every supplied founder claim matches", async () => {
    expect(planCandidateFounderEligibilityDecision(await principal(STAFF), input(), observation())).toEqual(denied);
  });
  it.each([
    { tenantId: "tenant-b" }, { subject: "user_other" }, { personId: "person-other" },
    { subject: FOUNDER, personId: "person-founder" }, { expectedRegistryRevision: 1 },
    { expectedBindingRevision: 1 }, { expectedPolicyRevision: 2 }, { expectedPersonRevision: 1 },
    { expectedPersonRevision: Number.MAX_SAFE_INTEGER }, { issuerSubject: FOUNDER },
    { authenticatedAtMs: NOW }, { decision: "recover-founder" }, { sourceReference: "" },
    { evidenceSha256: "not-a-digest" }, { operationId: "bind:1" },
    { operationId: "eligibility:founder:1" },
  ])("rejects substitution, stale fences and request authority claims: %j", async change => {
    expect(planCandidateFounderEligibilityDecision(await principal(), { ...input(), ...change }, observation())).toEqual(denied);
  });
  it.each([
    { authenticatedAtMs: NOW + 1 }, { authenticatedAtMs: NOW - 300_000 },
    { authenticatedAtMs: NOW - 300_001 }, { authenticatedAtMs: -1 },
    { nowMs: -1 }, { usedOperationIds: [input().operationId] },
    { usedOperationIds: ["same", "same"] }, { usedOperationIds: [undefined] },
  ])("denies expired authentication, time errors and operation reuse: %j", async change => {
    expect(planCandidateFounderEligibilityDecision(await principal(), input(), { ...observation(), ...change })).toEqual(denied);
  });
  it.each(["issuerPerson", "targetPerson", "issuerEligibility"] as const)(
    "denies inactive and cross-tenant %s", async key => {
      const current = observation();
      for (const change of [{ status: "inactive" }, { tenantId: "tenant-b" }, { personId: "person-other" }]) {
        expect(planCandidateFounderEligibilityDecision(await principal(), input(), {
          ...current, [key]: { ...current[key], ...change },
        })).toEqual(denied);
      }
    },
  );
  it("does not allow protected Person recovery, label upgrades, or administrative target history", async () => {
    const actor = await principal();
    for (const kind of ["founder", "system-owner"]) {
      expect(planCandidateFounderEligibilityDecision(actor, input(), {
        ...observation(), targetPerson: { ...observation().targetPerson, kind },
      })).toEqual(denied);
    }
    const current = observation();
    current.registry = {
      ...current.registry, revision: 3, policyRevision: 1,
      events: [...current.registry.events, {
        sequence: 3, eventId: "admin-grant", previousEventId: "binding-1", operationId: "admin:staff",
        tenantId: TENANT, actorSubject: FOUNDER, recordedAtMs: NOW - 10,
        kind: "administrator-granted", grantId: "staff-admin", subject: STAFF, capabilities: ["bind"], source: "delegated",
      }],
    };
    expect(planCandidateFounderEligibilityDecision(actor, { ...input(), expectedRegistryRevision: 3 }, current)).toEqual(denied);
  });
  it("rejects a revoked binding and never borrows a binding from another tenant", async () => {
    const current = observation();
    const cross = {
      ...current, registry: { ...current.registry,
        events: current.registry.events.map(event => ({ ...event, tenantId: "tenant-b" })) },
    };
    expect(planCandidateFounderEligibilityDecision(await principal(), input(), cross)).toEqual(denied);
    current.registry = {
      ...current.registry, revision: 3, bindingRevision: 3,
      events: [...current.registry.events, {
        sequence: 3, eventId: "revoked", previousEventId: "binding-1", operationId: "revoke:binding",
        tenantId: TENANT, actorSubject: FOUNDER, recordedAtMs: NOW - 1,
        kind: "binding-revoked", bindingId: "binding-1", subject: STAFF, personId: "person-staff",
        justification: "Revoked", revokedAdministratorGrantIds: [],
        approvedBySubject: null, approvedAtMs: null, approvedAuthenticatedAtMs: null,
      }],
    };
    expect(planCandidateFounderEligibilityDecision(await principal(), {
      ...input(), expectedRegistryRevision: 3, expectedBindingRevision: 3,
    }, current)).toEqual(denied);
  });
  it("requires founder ownership and membership in the same active tenant", async () => {
    const current = observation();
    for (const snapshot of [
      { ...current.authority.snapshot, tenant: { id: TENANT, status: "active" as const, ownerSubjects: [] } },
      { ...current.authority.snapshot, tenant: { ...current.authority.snapshot.tenant, status: "revoked" as const } },
      { ...current.authority.snapshot, memberships: [] },
    ]) {
      expect(planCandidateFounderEligibilityDecision(await principal(), input(), {
        ...current, authority: { ...current.authority, snapshot },
      })).toEqual(denied);
    }
  });
  it("rejects absent revocation targets, stale history, repeat issuance and automatic reactivation", async () => {
    const actor = await principal();
    expect(planCandidateFounderEligibilityDecision(actor, { ...input(), decision: "revoke" }, observation())).toEqual(denied);
    const issued = planCandidateFounderEligibilityDecision(actor, input(), observation());
    if (issued.status !== "candidate") throw new Error("Missing synthetic event.");
    expect(planCandidateFounderEligibilityDecision(actor, { ...input(), expectedPersonRevision: 1 }, {
      ...observation(), latestTargetEvent: issued.event,
    })).toEqual(denied);
    for (const change of [
      { status: "inactive" as const }, { tenantId: "tenant-b" }, { personId: "other" },
      { revision: 2 }, { kind: "founder" as const }, { recordedAtMs: NOW + 1 },
    ]) {
      expect(planCandidateFounderEligibilityDecision(actor, {
        ...input(), decision: "revoke", expectedPersonRevision: 1, operationId: "revoke:new",
      }, { ...observation(), latestTargetEvent: { ...issued.event, ...change } })).toEqual(denied);
    }
  });
  it("rejects malformed data objects without invoking request getters", async () => {
    const getter = vi.fn(() => FOUNDER);
    const malicious = Object.defineProperty(input(), "subject", { enumerable: true, get: getter });
    expect(planCandidateFounderEligibilityDecision(await principal(), malicious, observation())).toEqual(denied);
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("operational founder issuance remains disabled", () => {
  it("refuses even a valid candidate and verified founder without connecting or submitting", async () => {
    expect(planCandidateFounderEligibilityDecision(await principal(), input(), observation()).status).toBe("candidate");
    expect(await submitFounderEligibilityDecision(request(), input())).toMatchObject({
      status: "unavailable", outcome: "not-submitted",
      message: expect.stringContaining("approved-independent-issuer-authority-and-revocation-source"),
    });
    expect(memberAuthorityRelease().status).toBe("disabled");
    expect(employeeProvisioningRelease().status).toBe("disabled");
    expect(trustedPersonAuthoritySourceProblem()).toMatchObject({ status: "unavailable" });
  });
  it("rejects unsigned authority claims and refuses non-founder or unauthenticated requests", async () => {
    expect(await submitFounderEligibilityDecision(request(), { ...input(), issuerSubject: FOUNDER }))
      .toMatchObject({ status: "invalid-request" });
    vi.mocked(resolveClerkSession).mockResolvedValue({ status: "authenticated", subject: STAFF });
    expect(await submitFounderEligibilityDecision(request(), input())).toEqual(denied);
    vi.mocked(resolveClerkSession).mockResolvedValue({ status: "unauthenticated" });
    expect(await submitFounderEligibilityDecision(request(), input()))
      .toEqual({ status: "unauthorized", reason: "authentication-required" });
  });
  it("fails closed on authentication failure, missing founder configuration and rotation", async () => {
    vi.mocked(resolveClerkSession).mockRejectedValueOnce(new Error("Private authentication details"));
    expect(await submitFounderEligibilityDecision(request(), input()))
      .toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    for (const founder of [undefined, "user_new_founder123456"]) {
      vi.stubEnv("EMPIRE_OS_FOUNDER_CLERK_USER_ID", founder);
      expect(await submitFounderEligibilityDecision(request(), input())).toEqual(denied);
    }
  });
});
