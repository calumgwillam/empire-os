import { describe, expect, it, vi } from "vitest";
import {
  createServerPersistenceAuthority, type AuthenticatedPrincipal,
} from "./server-persistence-authority";
import { UnconfiguredServerPersistenceRepository } from "./server-persistence-contract";
import type { AuthorizationRequest, AuthorizationSnapshot, AuthorityDelegation } from "./authorization-contract";
import { evaluateAuthorization } from "./authorization-policy";

const datasetId = "00000000-0000-4000-8000-000000000001";
const otherDatasetId = "00000000-0000-4000-8000-000000000002";
const now = 1000;

function policy(): AuthorizationSnapshot {
  return {
    version: 1, revision: 5,
    tenant: { id: "tenant-a", status: "active", ownerSubjects: ["owner"] },
    datasets: [{ datasetId, tenantId: "tenant-a" }, { datasetId: otherDatasetId, tenantId: "tenant-a" }],
    memberships: [
      { subject: "owner", tenantId: "tenant-a", revision: 1, status: "active", roleIds: [] },
      { subject: "issuer", tenantId: "tenant-a", revision: 2, status: "active", roleIds: ["operator"] },
      { subject: "recipient", tenantId: "tenant-a", revision: 3, status: "active", roleIds: [] },
      { subject: "third", tenantId: "tenant-a", revision: 1, status: "active", roleIds: [] },
    ],
    roles: [{
      id: "operator", tenantId: "tenant-a", revision: 4, status: "active",
      grants: [{ id: "write-grant", datasetId, capability: "write", delegable: true },
        { id: "read-grant", datasetId, capability: "read", delegable: false }],
    }],
    delegations: [],
  };
}
function delegation(): AuthorityDelegation {
  return {
    id: "delegation-a", tenantId: "tenant-a", datasetId, issuerSubject: "issuer", recipientSubject: "recipient",
    capability: "write", sourceRoleId: "operator", sourceGrantId: "write-grant", sourceRoleRevision: 4,
    issuerMembershipRevision: 2, recipientMembershipRevision: 3, issuedAt: 500, expiresAt: 2000, status: "active",
  };
}
function access(): AuthorizationRequest {
  return { operation: "access", tenantId: "tenant-a", datasetId, expectedPolicyRevision: 5, capability: "write" };
}
function delegate(): AuthorizationRequest {
  return { operation: "delegate", tenantId: "tenant-a", datasetId, expectedPolicyRevision: 5,
    capability: "write", recipientSubject: "recipient", sourceRoleId: "operator", sourceGrantId: "write-grant", expiresAt: 2000 };
}
function assignRole(): AuthorizationRequest {
  return { operation: "assign-role", tenantId: "tenant-a", datasetId, expectedPolicyRevision: 5,
    recipientSubject: "recipient", roleId: "operator" };
}
// Test identities are minted through the real boundary using a test-only resolver, not type assertions.
async function principal(subject: string): Promise<AuthenticatedPrincipal> {
  let resolved: AuthenticatedPrincipal | undefined;
  const authority = createServerPersistenceAuthority({
    resolveSession: async () => ({ status: "authenticated", subject }),
    authorize: async (identity) => { resolved = identity; return false; },
    repositoryForPrincipal: () => new UnconfiguredServerPersistenceRepository(),
  });
  await authority.readSnapshot(new Request("https://empire-os.invalid"), { datasetId, protocolVersion: 1 });
  if (!resolved) throw new Error("Test principal was not resolved.");
  return resolved;
}

describe("default-deny identity, tenancy and delegated authorization", () => {
  it.each([null, {}, { subject: "owner" }, { id: "owner", accessLevel: "Founder", role: "founder" }])(
    "rejects spoofed identities and People records: %j", (identity) => {
      expect(evaluateAuthorization(identity, policy(), access(), now).reason).toBe("authentication-required");
    },
  );
  it("rejects copied principals even with copied symbol properties", async () => {
    const identity = await principal("owner");
    expect(evaluateAuthorization({ ...identity }, policy(), access(), now).reason).toBe("authentication-required");
  });
  it("allows explicitly server-provisioned owner authority only inside its tenant and datasets", async () => {
    const identity = await principal("owner");
    expect(evaluateAuthorization(identity, policy(), access(), now)).toMatchObject({ status: "allowed", reason: "owner-authority" });
    expect(evaluateAuthorization(identity, policy(), { ...access(), tenantId: "tenant-b" }, now).reason).toBe("tenant-mismatch");
    expect(evaluateAuthorization(identity, policy(), { ...access(), datasetId: "00000000-0000-4000-8000-000000000003" }, now).reason)
      .toBe("dataset-not-authorized");
  });
  it("does not infer authority from a name or organizational role label", async () => {
    expect(evaluateAuthorization(await principal("Founder"), policy(), access(), now).reason).toBe("membership-required");
    expect(evaluateAuthorization(await principal("recipient"), policy(), access(), now).reason).toBe("capability-not-granted");
  });
  it("requires active membership even for an owner", async () => {
    const identity = await principal("owner");
    expect(evaluateAuthorization(identity, { ...policy(), memberships: policy().memberships.slice(1) }, access(), now).reason)
      .toBe("membership-required");
    const revoked = policy().memberships.map((entry) => entry.subject === "owner" ? { ...entry, status: "revoked" as const } : entry);
    expect(evaluateAuthorization(identity, { ...policy(), memberships: revoked }, access(), now).reason).toBe("membership-revoked");
  });
  it("allows only explicit direct capabilities for the selected dataset", async () => {
    const identity = await principal("issuer");
    expect(evaluateAuthorization(identity, policy(), access(), now)).toMatchObject({ status: "allowed", reason: "direct-grant", evidenceId: "write-grant" });
    expect(evaluateAuthorization(identity, policy(), { ...access(), capability: "import" }, now).reason).toBe("capability-not-granted");
    expect(evaluateAuthorization(identity, policy(), { ...access(), datasetId: otherDatasetId }, now).reason).toBe("capability-not-granted");
  });
  it("denies stale policy evidence and revoked tenants", async () => {
    const identity = await principal("owner");
    expect(evaluateAuthorization(identity, policy(), { ...access(), expectedPolicyRevision: 4 }, now).reason).toBe("stale-policy");
    expect(evaluateAuthorization(identity, { ...policy(), tenant: { ...policy().tenant, status: "revoked" } }, access(), now).reason)
      .toBe("tenant-revoked");
  });
  it("requires fresh transaction policy evidence and denies reduced authority even after refreshing the revision", async () => {
    const identity = await principal("issuer");
    expect(evaluateAuthorization(identity, policy(), access(), now).status).toBe("allowed");
    const reduced = { ...policy(), revision: 6,
      roles: policy().roles.map((entry) => ({ ...entry, revision: 5, grants: [] })) };
    expect(evaluateAuthorization(identity, reduced, access(), now).reason).toBe("stale-policy");
    expect(evaluateAuthorization(identity, reduced, { ...access(), expectedPolicyRevision: 6 }, now).reason)
      .toBe("capability-not-granted");
  });
  it("reevaluates delegation expiry even when the policy revision is unchanged", async () => {
    const identity = await principal("recipient");
    const observed = { ...policy(), delegations: [delegation()] };
    expect(evaluateAuthorization(identity, observed, access(), now).status).toBe("allowed");
    expect(evaluateAuthorization(identity, observed, access(), 2000).status).toBe("denied");
  });
  it.each([null, {}, { ...policy(), revision: -1 }, { ...policy(), version: 2 },
    { ...policy(), tenant: { ...policy().tenant, ownerSubjects: ["owner", "owner"] } },
    { ...policy(), memberships: [...policy().memberships, policy().memberships[0]] },
    { ...policy(), roles: [...policy().roles, policy().roles[0]] },
    { ...policy(), roles: [...policy().roles, { ...policy().roles[0], id: "duplicate-grants-role" }] },
    { ...policy(), datasets: [...policy().datasets, policy().datasets[0]] },
    { ...policy(), roles: [{ ...policy().roles[0], grants: [{ ...policy().roles[0].grants[0], capability: "role:assign" }] }] },
  ])("fails closed on malformed or ambiguous server policy %j", async (observed) => {
    expect(evaluateAuthorization(await principal("owner"), observed, access(), now).reason).toBe("invalid-policy");
  });
  it.each(["datasets", "memberships", "roles", "delegations"] as const)(
    "fails closed on sparse %s arrays without throwing", async (field) => {
      const observed = { ...policy(), [field]: new Array(1) };
      expect(evaluateAuthorization(await principal("owner"), observed, access(), now)).toEqual({
        status: "denied", reason: "invalid-policy", policyVersion: 1, observedPolicyRevision: null,
      });
    },
  );
  it.each([
    { ...policy(), tenant: { ...policy().tenant, ownerSubjects: new Array(1) } },
    { ...policy(), memberships: policy().memberships.map((entry) => ({ ...entry, roleIds: new Array(1) })) },
    { ...policy(), roles: policy().roles.map((entry) => ({ ...entry, grants: new Array(1) })) },
    { ...policy(), memberships: policy().memberships.map((entry) => ({ ...entry, roleIds: ["missing-role"] })) },
    { ...policy(), delegations: [delegation(), delegation()] },
    { ...policy(), delegations: [{ ...delegation(), expiresAt: delegation().issuedAt }] },
  ])("rejects malformed nested collections and delegation records", async (observed) => {
    expect(evaluateAuthorization(await principal("owner"), observed, access(), now).reason).toBe("invalid-policy");
  });
  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid server time and policy/request counters: %s", async (counter) => {
      const identity = await principal("owner");
      expect(evaluateAuthorization(identity, policy(), access(), counter).reason).toBe("invalid-policy");
      expect(evaluateAuthorization(identity, { ...policy(), revision: counter }, access(), now).reason).toBe("invalid-policy");
      expect(evaluateAuthorization(identity, policy(), { ...access(), expectedPolicyRevision: counter }, now).reason).toBe("invalid-request");
    },
  );
  it.each(["memberships", "roles", "delegations", "datasets"] as const)("rejects cross-tenant %s records", async (field) => {
    const observed = { ...policy(), delegations: [delegation()] };
    const crossed = observed[field].map((entry) => ({ ...entry, tenantId: "tenant-b" }));
    expect(evaluateAuthorization(await principal("owner"), { ...observed, [field]: crossed }, access(), now).reason).toBe("invalid-policy");
  });
  it.each([{ ...access(), subject: "owner" }, { ...access(), authorized: true }, { ...access(), capability: "ownership:transfer" },
    { ...access(), expectedPolicyRevision: undefined }, { ...access(), operation: "transfer-ownership" }])(
    "rejects authority-bearing or unsupported requests %j", async (input) => {
      expect(evaluateAuthorization(await principal("owner"), policy(), input, now).reason).toBe("invalid-request");
    },
  );
  it("only permits an owner to assign a known active role to another active member", async () => {
    expect(evaluateAuthorization(await principal("owner"), policy(), assignRole(), now).reason).toBe("role-assignment-authorized");
    expect(evaluateAuthorization(await principal("issuer"), policy(), assignRole(), now).reason).toBe("owner-required");
    expect(evaluateAuthorization(await principal("owner"), policy(), { ...assignRole(), recipientSubject: "owner" }, now).reason).toBe("self-escalation");
    expect(evaluateAuthorization(await principal("owner"), policy(), { ...assignRole(), recipientSubject: "outside" }, now).reason).toBe("recipient-not-active");
    expect(evaluateAuthorization(await principal("owner"), policy(), { ...assignRole(), roleId: "owner" }, now).reason).toBe("role-not-active");
    const roles = policy().roles.map((entry) => ({ ...entry, status: "revoked" as const }));
    expect(evaluateAuthorization(await principal("owner"), { ...policy(), roles }, assignRole(), now).reason).toBe("role-not-active");
  });
  it("permits only a current explicitly delegable direct source grant", async () => {
    const identity = await principal("issuer");
    expect(evaluateAuthorization(identity, policy(), delegate(), now).reason).toBe("delegation-authorized");
    expect(evaluateAuthorization(identity, policy(), { ...delegate(), sourceGrantId: "read-grant", capability: "read" }, now).reason).toBe("source-not-delegable");
    expect(evaluateAuthorization(identity, policy(), { ...delegate(), datasetId: otherDatasetId }, now).reason).toBe("source-not-delegable");
    expect(evaluateAuthorization(identity, policy(), { ...delegate(), capability: "import" }, now).reason).toBe("source-not-delegable");
    expect(evaluateAuthorization(identity, policy(), { ...delegate(), recipientSubject: "issuer" }, now).reason).toBe("self-escalation");
    expect(evaluateAuthorization(identity, policy(), { ...delegate(), sourceGrantId: "forged" }, now).reason).toBe("source-not-delegable");
    expect(evaluateAuthorization(await principal("owner"), policy(), delegate(), now).reason).toBe("source-not-delegable");
  });
  it.each(["ownership:assign", "role:assign", "capability:delegate"])(
    "cannot delegate reserved capability %s through a forged request or record", async (capability) => {
      const identity = await principal("issuer");
      expect(evaluateAuthorization(identity, policy(), { ...delegate(), capability }, now).reason).toBe("invalid-request");
      expect(evaluateAuthorization(await principal("recipient"),
        { ...policy(), delegations: [{ ...delegation(), capability }] }, access(), now).reason).toBe("invalid-policy");
    },
  );
  it.each([now, now - 1, -1, NaN, Infinity])("rejects invalid delegation expiry %s", async (expiresAt) => {
    expect(evaluateAuthorization(await principal("issuer"), policy(), { ...delegate(), expiresAt }, now).status).toBe("denied");
  });
  it("honors an active one-hop delegation but prohibits redelegation and role management", async () => {
    const observed = { ...policy(), delegations: [delegation()] };
    const identity = await principal("recipient");
    expect(evaluateAuthorization(identity, observed, access(), now)).toMatchObject({ status: "allowed", reason: "delegated-grant" });
    expect(evaluateAuthorization(identity, observed, { ...delegate(), recipientSubject: "third" }, now).reason).toBe("source-not-delegable");
    expect(evaluateAuthorization(identity, observed, assignRole(), now).status).toBe("denied");
    expect(evaluateAuthorization(identity, observed, { ...access(), datasetId: otherDatasetId }, now).status).toBe("denied");
  });
  it.each([
    { status: "revoked" as const }, { expiresAt: now }, { issuedAt: now + 1 },
    { sourceRoleRevision: 3 }, { issuerMembershipRevision: 1 }, { recipientMembershipRevision: 2 },
    { sourceGrantId: "forged" }, { sourceRoleId: "forged" }, { issuerSubject: "third" },
  ])("denies revoked, stale or forged delegation %j", async (change) => {
    const observed = { ...policy(), delegations: [{ ...delegation(), ...change }] };
    expect(evaluateAuthorization(await principal("recipient"), observed, access(), now).status).toBe("denied");
  });
  it.each(["revoked-member", "restored-member", "missing-member", "removed-role", "role-revision", "revoked-role", "removed-grant", "reduced-grant", "not-delegable"] as const)(
    "invalidates delegation after upstream change: %s", async (change) => {
      const initial = policy();
      const memberships = initial.memberships.filter((entry) => change !== "missing-member" || entry.subject !== "issuer")
        .map((entry) => entry.subject !== "issuer" ? entry
        : change === "revoked-member" ? { ...entry, status: "revoked" as const }
        : change === "restored-member" ? { ...entry, revision: 3 }
        : change === "removed-role" ? { ...entry, roleIds: [], revision: 3 } : entry);
      const roles = initial.roles.map((entry) => change === "role-revision" ? { ...entry, revision: 5 }
        : change === "revoked-role" ? { ...entry, status: "revoked" as const }
        : change === "removed-grant" ? { ...entry, grants: [] }
        : change === "reduced-grant" ? { ...entry, grants: entry.grants.map((item) => ({ ...item, capability: "read" as const })) }
        : change === "not-delegable" ? { ...entry, grants: entry.grants.map((item) => ({ ...item, delegable: false })) } : entry);
      expect(evaluateAuthorization(await principal("recipient"), { ...initial, memberships, roles, delegations: [delegation()] }, access(), now).status)
        .toBe("denied");
    },
  );
  it("prevents old delegation resurrection after recipient membership is restored at a new revision", async () => {
    const memberships = policy().memberships.map((entry) => entry.subject === "recipient" ? { ...entry, revision: 4 } : entry);
    expect(evaluateAuthorization(await principal("recipient"), { ...policy(), memberships, delegations: [delegation()] }, access(), now).status).toBe("denied");
  });
  it("uses inclusive issuance and exclusive expiry boundaries", async () => {
    const identity = await principal("recipient");
    const observed = { ...policy(), delegations: [delegation()] };
    expect(evaluateAuthorization(identity, observed, access(), 499).status).toBe("denied");
    expect(evaluateAuthorization(identity, observed, access(), 500).status).toBe("allowed");
    expect(evaluateAuthorization(identity, observed, access(), 1999).status).toBe("allowed");
    expect(evaluateAuthorization(identity, observed, access(), 2000).status).toBe("denied");
  });
  it("selects direct evidence deterministically and ahead of delegated evidence", async () => {
    const initial = policy();
    const observed = { ...initial,
      memberships: initial.memberships.map((entry) => entry.subject === "recipient" ? { ...entry, roleIds: ["operator"] } : entry),
      roles: initial.roles.map((entry) => ({ ...entry, grants: [...entry.grants, { ...entry.grants[0], id: "a-write-grant" }] })),
      delegations: [delegation()],
    };
    const identity = await principal("recipient");
    const decision = evaluateAuthorization(identity, observed, access(), now);
    expect(decision).toEqual({
      status: "allowed", reason: "direct-grant", policyVersion: 1, observedPolicyRevision: 5, evidenceId: "a-write-grant",
    });
    expect(evaluateAuthorization(identity, { ...observed,
      roles: observed.roles.map((entry) => ({ ...entry, grants: [...entry.grants].reverse() })),
    }, access(), now)).toEqual(decision);
  });
  it("produces deterministic minimal audit evidence independent of input order without mutation", async () => {
    const observed = { ...policy(), delegations: [delegation(), { ...delegation(), id: "delegation-b" }] };
    const before = JSON.stringify(observed);
    const identity = await principal("recipient");
    const decision = evaluateAuthorization(identity, observed, access(), now);
    expect(decision).toEqual({ status: "allowed", reason: "delegated-grant", policyVersion: 1, observedPolicyRevision: 5, evidenceId: "delegation-a" });
    expect(evaluateAuthorization(identity, { ...observed, memberships: [...observed.memberships].reverse(),
      delegations: [...observed.delegations].reverse() }, access(), now)).toEqual(decision);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(JSON.stringify(observed)).toBe(before);
    expect(JSON.stringify(decision)).not.toContain("recipient");
  });
  it("can compose with the existing boundary without trusting browser tenant or identity headers", async () => {
    const repositoryForPrincipal = vi.fn(() => new UnconfiguredServerPersistenceRepository());
    const authority = createServerPersistenceAuthority({
      resolveSession: async () => ({ status: "authenticated", subject: "recipient" }),
      authorize: async (identity, requestedDatasetId, requestedCapability) =>
        evaluateAuthorization(identity, policy(), { ...access(), datasetId: requestedDatasetId, capability: requestedCapability }, now).status === "allowed",
      repositoryForPrincipal,
    });
    expect(await authority.readSnapshot(new Request("https://empire-os.invalid", {
      headers: { "x-tenant": "tenant-a", "x-principal": "owner", "x-authorized": "true" },
    }), { datasetId, protocolVersion: 1 })).toEqual({ status: "unauthorized", reason: "forbidden" });
    expect(repositoryForPrincipal).not.toHaveBeenCalled();
  });
});
