import type { PersistenceCapability } from "./server-persistence-authority";

// These are server authority records, never People records or browser access labels.
export type IdentitySubject = string;
export type TenantId = string;
export type RoleId = string;
export type AuthorizationCapability = PersistenceCapability | "role:assign" | "capability:delegate";
export type AuthorityStatus = "active" | "revoked";

export type TenantAuthority = Readonly<{
  id: TenantId;
  status: AuthorityStatus;
  ownerSubjects: readonly IdentitySubject[];
}>;
export type TenantMembership = Readonly<{
  subject: IdentitySubject;
  tenantId: TenantId;
  revision: number;
  status: AuthorityStatus;
  roleIds: readonly RoleId[];
}>;
export type DatasetCapabilityGrant = Readonly<{
  id: string;
  datasetId: string;
  capability: PersistenceCapability;
  delegable: boolean;
}>;
export type AuthorizationRole = Readonly<{
  id: RoleId;
  tenantId: TenantId;
  revision: number;
  status: AuthorityStatus;
  grants: readonly DatasetCapabilityGrant[];
}>;
export type AuthorityDelegation = Readonly<{
  id: string;
  tenantId: TenantId;
  datasetId: string;
  issuerSubject: IdentitySubject;
  recipientSubject: IdentitySubject;
  capability: PersistenceCapability;
  sourceRoleId: RoleId;
  sourceGrantId: string;
  sourceRoleRevision: number;
  issuerMembershipRevision: number;
  recipientMembershipRevision: number;
  issuedAt: number;
  expiresAt: number;
  status: AuthorityStatus;
}>;
export type AuthorizationSnapshot = Readonly<{
  version: 1;
  revision: number;
  tenant: TenantAuthority;
  datasets: readonly Readonly<{ datasetId: string; tenantId: TenantId }>[];
  memberships: readonly TenantMembership[];
  roles: readonly AuthorizationRole[];
  delegations: readonly AuthorityDelegation[];
}>;

type AuthorizationTarget = Readonly<{ tenantId: TenantId; datasetId: string; expectedPolicyRevision: number }>;
export type AuthorizationRequest = AuthorizationTarget & (
  | Readonly<{ operation: "access"; capability: PersistenceCapability }>
  | Readonly<{ operation: "assign-role"; recipientSubject: IdentitySubject; roleId: RoleId }>
  | Readonly<{
    operation: "delegate";
    recipientSubject: IdentitySubject;
    capability: PersistenceCapability;
    sourceRoleId: RoleId;
    sourceGrantId: string;
    expiresAt: number;
  }>
);

export type AuthorizationReason =
  | "authentication-required" | "invalid-policy" | "invalid-request" | "tenant-mismatch"
  | "tenant-revoked" | "dataset-not-authorized" | "stale-policy" | "membership-required"
  | "membership-revoked" | "capability-not-granted" | "owner-required" | "self-escalation"
  | "recipient-not-active" | "role-not-active" | "source-not-delegable" | "invalid-expiry"
  | "owner-authority" | "direct-grant" | "delegated-grant" | "role-assignment-authorized"
  | "delegation-authorized";
export type AuthorizationDecision = Readonly<{
  status: "allowed" | "denied";
  reason: AuthorizationReason;
  policyVersion: 1;
  observedPolicyRevision: number | null;
  evidenceId?: string;
  // Point-in-time evidence only, never a bearer token or a substitute for transaction checks.
}>;
