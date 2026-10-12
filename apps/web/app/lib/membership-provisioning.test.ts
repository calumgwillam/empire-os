import { describe, expect, it } from "vitest";
import type { DurableAuthorityState } from "./durable-authorization-state";
import { validateMembershipProvisioningTransition as validate } from "./membership-provisioning";

const founder = "user_founder123";
const worker = "user_worker123";
const datasetId = "00000000-0000-4000-8000-000000000001";

function initial(): DurableAuthorityState {
  return {
    schemaVersion: 1,
    snapshot: {
      version: 1, revision: 5,
      tenant: { id: "tenant-a", status: "active", ownerSubjects: [founder] },
      datasets: [{ datasetId, tenantId: "tenant-a" }],
      memberships: [
        { subject: founder, tenantId: "tenant-a", revision: 1, status: "active", roleIds: [] },
      ],
      roles: [{
        id: "worker-role", tenantId: "tenant-a", revision: 1, status: "active",
        grants: [{ id: "worker-read", datasetId, capability: "read", delegable: false }],
      }],
      delegations: [],
    },
    revocations: [],
  };
}

function provision(before = initial()): DurableAuthorityState {
  return {
    ...before,
    snapshot: {
      ...before.snapshot,
      revision: before.snapshot.revision + 1,
      memberships: [...before.snapshot.memberships, {
        subject: worker, tenantId: "tenant-a", revision: 1,
        status: "active" as const, roleIds: ["worker-role"],
      }],
    },
  };
}

describe("Founder-controlled employee provisioning", () => {
  it("accepts one new employee with an existing role", () => {
    expect(validate(initial(), provision(), founder, 1000).status)
      .toBe("valid");
  });

  it("rejects provisioning by a non-founder", () => {
    expect(validate(initial(), provision(), worker, 1000))
      .toMatchObject({
        status: "inconsistent",
        reason: "Founder authority required.",
      });
  });

  it("rejects an unchanged policy revision", () => {
    const next = provision();
    const stale = {
      ...next,
      snapshot: { ...next.snapshot, revision: 5 },
    };
    expect(validate(initial(), stale, founder, 1000).status)
      .toBe("inconsistent");
  });
});

describe("Provisioning security boundaries", () => {
  it("rejects changes to founder membership", () => {
    const next = provision();
    const tampered = {
      ...next,
      snapshot: {
        ...next.snapshot,
        memberships: next.snapshot.memberships.map(m =>
          m.subject === founder ? { ...m, revision: 2 } : m),
      },
    };
    expect(validate(initial(), tampered, founder, 1000).status)
      .toBe("inconsistent");
  });

  it("rejects changes to role permissions", () => {
    const next = provision();
    const tampered = {
      ...next,
      snapshot: { ...next.snapshot, roles: [] },
    };
    expect(validate(initial(), tampered, founder, 1000).status)
      .toBe("inconsistent");
  });

  it("rejects ownership changes", () => {
    const next = provision();
    const tampered = {
      ...next,
      snapshot: {
        ...next.snapshot,
        tenant: { ...next.snapshot.tenant, ownerSubjects: [founder, worker] },
      },
    };
    expect(validate(initial(), tampered, founder, 1000).status)
      .toBe("inconsistent");
  });
});

describe("Provisioning identity and evidence integrity", () => {
  it("rejects unknown employee roles", () => {
    const next = provision();
    const tampered = structuredClone(next);
    const invalid = { ...tampered, snapshot: { ...tampered.snapshot,
      memberships: tampered.snapshot.memberships.map((m, i) =>
        i === 1 ? { ...m, roleIds: ["unknown-role"] } : m) } };
    expect(validate(initial(), invalid, founder, 1000).status)
      .toBe("inconsistent");
  });

  it("rejects a role that has since been revoked", () => {
    const before = initial();
    const revoked: DurableAuthorityState = {
      ...before,
      snapshot: {
        ...before.snapshot,
        roles: before.snapshot.roles.map(role => ({ ...role, status: "revoked" as const })),
      },
      revocations: [{
        kind: "role",
        id: "worker-role",
        operationId: "revoke-worker-role",
        policyRevision: 4,
        revokedAt: 1000,
      }],
    };
    expect(validate(revoked, provision(revoked), founder, 1000).status)
      .toBe("inconsistent");
  });

  it("rejects duplicate role assignments", () => {
    const next = provision();
    const duplicateRoles = {
      ...next,
      snapshot: {
        ...next.snapshot,
        memberships: next.snapshot.memberships.map((member, index) =>
          index === 1 ? { ...member, roleIds: ["worker-role", "worker-role"] } : member),
      },
    };
    expect(validate(initial(), duplicateRoles, founder, 1000).status)
      .toBe("inconsistent");
  });

  it("rejects malformed employee identities", () => {
    const next = provision();
    const invalid = {
      ...next,
      snapshot: {
        ...next.snapshot,
        memberships: next.snapshot.memberships.map((member, index) =>
          index === 1 ? { ...member, subject: "not-a-clerk-identity" } : member),
      },
    };
    expect(validate(initial(), invalid, founder, 1000).status)
      .toBe("inconsistent");
  });

  it("rejects duplicate employee identities", () => {
    const next = provision();
    const tampered = structuredClone(next);
    const invalid = { ...tampered, snapshot: { ...tampered.snapshot,
      memberships: [...tampered.snapshot.memberships,
        tampered.snapshot.memberships[1]] } };
    expect(validate(initial(), invalid, founder, 1000).status)
      .toBe("inconsistent");
  });

  it("rejects identities retained as revoked tombstones", () => {
    const before = initial();
    const removed: DurableAuthorityState = {
      ...before,
      snapshot: {
        ...before.snapshot,
        revision: 6,
        memberships: [...before.snapshot.memberships, {
          subject: worker,
          tenantId: "tenant-a",
          revision: 2,
          status: "revoked",
          roleIds: [],
        }],
      },
      revocations: [{
        kind: "membership",
        id: worker,
        operationId: "remove-worker",
        policyRevision: 6,
        revokedAt: 1000,
      }],
    };
    expect(validate(removed, provision(removed), founder, 2000).status)
      .toBe("inconsistent");
  });

  it("rejects unexpected revocation evidence", () => {
    const next = provision();
    const tampered = {
      ...next,
      revocations: [{
        kind: "membership" as const,
        id: worker,
        operationId: "fake-revocation",
        policyRevision: 6,
        revokedAt: 1000,
      }],
    };
    expect(validate(initial(), tampered, founder, 1000).status)
      .toBe("inconsistent");
  });
});
