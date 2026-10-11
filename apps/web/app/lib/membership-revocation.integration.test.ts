import { describe, expect, it } from "vitest";
import type { AuthorizationSnapshot } from "./authorization-contract";
import { evaluateAuthorization } from "./authorization-policy";
import { evaluateMembershipChange } from "./membership-management";
import { createServerPersistenceAuthority } from "./server-persistence-authority";
import { UnconfiguredServerPersistenceRepository } from "./server-persistence-contract";

const datasetId = "00000000-0000-4000-8000-000000000001";
const founder = "user_founder123";
const worker = "user_worker123";
const issuer = "user_issuer123";

describe("Revoked delegation enforcement", () => {
  it("rejects an old delegation after employee reactivation", async () => {
    let principal: Parameters<typeof evaluateAuthorization>[0];

    const authority = createServerPersistenceAuthority({
      resolveSession: async () => ({ status: "authenticated", subject: worker }),
      authorize: async identity => { principal = identity; return false; },
      repositoryForPrincipal: () => new UnconfiguredServerPersistenceRepository(),
    });
    await authority.readSnapshot(new Request("https://empire.invalid"), {
      datasetId, protocolVersion: 1,
    });
    expect(principal).toBeDefined();

    const snapshot: AuthorizationSnapshot = {
      version: 1, revision: 5,
      tenant: { id: "tenant-a", status: "active", ownerSubjects: [founder] },
      datasets: [{ datasetId, tenantId: "tenant-a" }],
      memberships: [
        { subject: founder, tenantId: "tenant-a", revision: 1, status: "active", roleIds: [] },
        { subject: issuer, tenantId: "tenant-a", revision: 1, status: "active", roleIds: ["delegator"] },
        { subject: worker, tenantId: "tenant-a", revision: 2, status: "active", roleIds: [] },
      ],
      roles: [{
        id: "delegator", tenantId: "tenant-a", revision: 1, status: "active",
        grants: [{ id: "grant-1", datasetId, capability: "read", delegable: true }],
      }],
      delegations: [{
        id: "old-delegation", tenantId: "tenant-a", datasetId,
        issuerSubject: issuer, recipientSubject: worker,
        capability: "read", sourceRoleId: "delegator", sourceGrantId: "grant-1",
        sourceRoleRevision: 1, issuerMembershipRevision: 1,
        recipientMembershipRevision: 2, issuedAt: 100, expiresAt: 10000,
        status: "active",
      }],
    };

    const request = (revision: number) => ({
      operation: "access" as const, tenantId: "tenant-a",
      datasetId, capability: "read" as const,
      expectedPolicyRevision: revision,
    });

    expect(evaluateAuthorization(principal, snapshot, request(5), 1000).status)
      .toBe("allowed");

    const revoked = evaluateMembershipChange(snapshot, founder, 5, {
      operation: "revoke", subject: worker,
    });
    expect(revoked.status).toBe("applied");
    if (revoked.status !== "applied") return;

    expect(evaluateAuthorization(principal, revoked.snapshot, request(6), 1000).reason)
      .toBe("membership-revoked");

    const restored = evaluateMembershipChange(revoked.snapshot, founder, 6, {
      operation: "grant", subject: worker, roleIds: [],
    });
    expect(restored).toMatchObject({
      status: "denied", reason: "revoked-membership",
    });

    expect(evaluateAuthorization(principal, revoked.snapshot, request(6), 1000).reason)
      .toBe("membership-revoked");
  });
});
