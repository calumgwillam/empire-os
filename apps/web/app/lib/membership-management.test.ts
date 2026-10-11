import { describe, expect, it } from "vitest";
import type { AuthorizationSnapshot } from "./authorization-contract";
import { evaluateMembershipChange as change } from "./membership-management";

const founder = "user_founder123";
const worker = "user_worker123";
const datasetId = "00000000-0000-4000-8000-000000000001";

function policy(): AuthorizationSnapshot {
  return {
    version: 1, revision: 5,
    tenant: { id: "tenant-a", status: "active", ownerSubjects: [founder] },
    datasets: [{ datasetId, tenantId: "tenant-a" }],
    memberships: [
      { subject: founder, tenantId: "tenant-a", revision: 1, status: "active", roleIds: [] },
      { subject: worker, tenantId: "tenant-a", revision: 2, status: "active", roleIds: ["worker-role"] },
    ],
    roles: [{
      id: "worker-role", tenantId: "tenant-a", revision: 1, status: "active",
      grants: [{ id: "worker-read", datasetId, capability: "read", delegable: false }],
    }],
    delegations: [],
  };
}

describe("Founder-controlled memberships", () => {
  it("allows founder to grant a scoped role", () => {
    const result = change(policy(), founder, 5, {
      operation: "grant", subject: "user_newworker", roleIds: ["worker-role"],
    });
    expect(result.status).toBe("applied");
    if (result.status === "applied") {
      expect(result.snapshot.memberships.find(m => m.subject === "user_newworker"))
        .toMatchObject({ status: "active", roleIds: ["worker-role"] });
      expect(result.snapshot.revision).toBe(6);
    }
  });

  it("allows founder to revoke employee access", () => {
    const result = change(policy(), founder, 5, {
      operation: "revoke", subject: worker,
    });
    expect(result.status).toBe("applied");
    if (result.status === "applied") {
      expect(result.snapshot.memberships.find(m => m.subject === worker))
        .toMatchObject({ status: "revoked", roleIds: [], revision: 3 });
    }
  });

  it("denies employees changing memberships", () => {
    expect(change(policy(), worker, 5, {
      operation: "grant", subject: "user_other", roleIds: ["worker-role"],
    })).toMatchObject({ status: "denied", reason: "owner-required" });
  });

  it("protects founder membership from changes", () => {
    expect(change(policy(), founder, 5, {
      operation: "revoke", subject: founder,
    })).toMatchObject({ status: "denied", reason: "self-modification" });
  });

  it("rejects stale revisions", () => {
    expect(change(policy(), founder, 4, {
      operation: "revoke", subject: worker,
    })).toMatchObject({ status: "denied", reason: "stale-policy" });
  });

  it("rejects unknown roles", () => {
    expect(change(policy(), founder, 5, {
      operation: "grant", subject: "user_newworker", roleIds: ["admin"],
    })).toMatchObject({ status: "denied", reason: "invalid-roles" });
  });

  it("rejects revoked founders", () => {
    const revoked = {
      ...policy(),
      memberships: policy().memberships.map(m =>
        m.subject === founder ? { ...m, status: "revoked" as const } : m),
    };
    expect(change(revoked, founder, 5, {
      operation: "revoke", subject: worker,
    })).toMatchObject({ status: "denied", reason: "owner-required" });
  });
});

describe("Membership revocation lifecycle", () => {
  it("increments revision across revoke and reactivation", () => {
    const revoked = change(policy(), founder, 5, {
      operation: "revoke", subject: worker,
    });
    expect(revoked.status).toBe("applied");
    if (revoked.status !== "applied") return;

    const restored = change(revoked.snapshot, founder, 6, {
      operation: "grant", subject: worker, roleIds: ["worker-role"],
    });
    expect(restored.status).toBe("applied");
    if (restored.status !== "applied") return;

    expect(restored.snapshot.memberships.find(m => m.subject === worker))
      .toMatchObject({ status: "active", revision: 4 });
  });
});

it("invalidates old delegation revisions after reactivation", () => {
  const initial = policy();
  const oldRevision = initial.memberships.find(m => m.subject === worker)!.revision;

  const revoked = change(initial, founder, 5, {
    operation: "revoke", subject: worker,
  });
  expect(revoked.status).toBe("applied");
  if (revoked.status !== "applied") return;

  const restored = change(revoked.snapshot, founder, 6, {
    operation: "grant", subject: worker, roleIds: ["worker-role"],
  });
  expect(restored.status).toBe("applied");
  if (restored.status !== "applied") return;

  const currentRevision = restored.snapshot.memberships
    .find(m => m.subject === worker)!.revision;

  expect(currentRevision).toBeGreaterThan(oldRevision);
  expect(currentRevision).not.toBe(oldRevision);
});

describe("Strict membership request validation", () => {
  it("rejects hidden privilege-escalation fields", () => {
    const request = {
      operation: "grant" as const,
      subject: "user_newworker",
      roleIds: ["worker-role"],
      owner: true,
    };
    expect(change(policy(), founder, 5, request))
      .toMatchObject({ status: "denied", reason: "invalid-request" });
  });

  it("rejects extra fields on revocation", () => {
    const request = {
      operation: "revoke" as const,
      subject: worker,
      roleIds: ["worker-role"],
    };
    expect(change(policy(), founder, 5, request))
      .toMatchObject({ status: "denied", reason: "invalid-request" });
  });
});
