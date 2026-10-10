import type { DurableAuthorityState } from "../../app/lib/durable-authorization-state";
import type { TransactionAuthorizationRequest } from "../../app/lib/authorization-transaction-contract";
import { createServerPersistenceAuthority, type AuthenticatedPrincipal } from "../../app/lib/server-persistence-authority";
import { UnconfiguredServerPersistenceRepository } from "../../app/lib/server-persistence-contract";

export function authorityFixture(tenantId: string, datasetId: string): DurableAuthorityState {
  return { schemaVersion: 1, revocations: [], snapshot: {
    version: 1, revision: 1, tenant: { id: tenantId, status: "active", ownerSubjects: ["owner"] },
    datasets: [{ tenantId, datasetId }],
    memberships: [
      { subject: "owner", tenantId, revision: 1, status: "active", roleIds: [] },
      { subject: "issuer", tenantId, revision: 1, status: "active", roleIds: ["writer"] },
      { subject: "recipient", tenantId, revision: 1, status: "active", roleIds: [] },
    ],
    roles: [{ id: "writer", tenantId, revision: 1, status: "active",
      grants: [{ id: "write", datasetId, capability: "write", delegable: true }] }],
    delegations: [],
  } };
}
export async function testPrincipal(subject: string, datasetId: string): Promise<AuthenticatedPrincipal> {
  let identity: AuthenticatedPrincipal | undefined;
  const boundary = createServerPersistenceAuthority({
    resolveSession: async () => ({ status: "authenticated", subject }),
    authorize: async (principal) => { identity = principal; return false; },
    repositoryForPrincipal: () => new UnconfiguredServerPersistenceRepository(),
  });
  await boundary.readSnapshot(new Request("https://empire-os.invalid"), { datasetId, protocolVersion: 1 });
  if (!identity) throw new Error("Test identity unavailable.");
  return identity;
}
export function preparationWrite(tenantId: string, datasetId: string, operationId: string, policyRevision = 1,
  storeRevision = 0): TransactionAuthorizationRequest {
  return { tenantId, operationId, expectedPolicyRevision: policyRevision, command: { kind: "write", request: {
    fence: { datasetId, generation: 1, authorityRevision: 0, protocolVersion: 1 },
    idempotencyKey: operationId, reads: [],
    writes: [{ key: "empire-os-captures", expectedRevision: storeRevision, rawValue: "[]" }],
  } } };
}
export function membershipRevocation(tenantId: string, datasetId: string): TransactionAuthorizationRequest {
  return { tenantId, operationId: "revoke-issuer", expectedPolicyRevision: 1,
    command: { kind: "revoke", datasetId, target: { kind: "membership", id: "issuer" } } };
}
