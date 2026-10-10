import { versions } from "node:process";
import { isAuthenticatedPrincipal } from "./server-persistence-authority";
import { hasOnlyFields, isCounter, isDatasetId, isObject } from "./server-persistence-contract";
import type {
  AuthorityDelegation, AuthorizationDecision, AuthorizationReason, AuthorizationRequest,
  AuthorizationRole, AuthorizationSnapshot, DatasetCapabilityGrant, TenantMembership,
} from "./authorization-contract";
import type { PersistenceCapability } from "./server-persistence-authority";

if (!versions.node) throw new Error("Authorization requires the Node.js runtime.");

export function isAuthorityIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
const identifier = isAuthorityIdentifier;
function capability(value: unknown): value is PersistenceCapability {
  return value === "read" || value === "write" || value === "import";
}
function status(value: unknown): boolean { return value === "active" || value === "revoked"; }
function unique(values: readonly string[]): boolean { return new Set(values).size === values.length; }
function records<T>(value: unknown, validate: (entry: unknown) => entry is T): value is T[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index) || !validate(value[index])) return false;
  }
  return true;
}
function dataset(value: unknown): value is AuthorizationSnapshot["datasets"][number] {
  return isObject(value) && hasOnlyFields(value, ["datasetId", "tenantId"])
    && isDatasetId(value.datasetId) && identifier(value.tenantId);
}
function membership(value: unknown): value is TenantMembership {
  return isObject(value) && hasOnlyFields(value, ["subject", "tenantId", "revision", "status", "roleIds"])
    && identifier(value.subject) && identifier(value.tenantId) && isCounter(value.revision) && status(value.status)
    && records(value.roleIds, identifier) && unique(value.roleIds);
}
function grant(value: unknown): value is DatasetCapabilityGrant {
  return isObject(value) && hasOnlyFields(value, ["id", "datasetId", "capability", "delegable"])
    && identifier(value.id) && isDatasetId(value.datasetId) && capability(value.capability) && typeof value.delegable === "boolean";
}
function role(value: unknown): value is AuthorizationRole {
  return isObject(value) && hasOnlyFields(value, ["id", "tenantId", "revision", "status", "grants"])
    && identifier(value.id) && identifier(value.tenantId) && isCounter(value.revision) && status(value.status)
    && records(value.grants, grant) && unique(value.grants.map((entry) => entry.id));
}
function delegation(value: unknown): value is AuthorityDelegation {
  return isObject(value) && hasOnlyFields(value, [
    "id", "tenantId", "datasetId", "issuerSubject", "recipientSubject", "capability",
    "sourceRoleId", "sourceGrantId", "sourceRoleRevision", "issuerMembershipRevision", "recipientMembershipRevision",
    "issuedAt", "expiresAt", "status",
  ]) && identifier(value.id) && identifier(value.tenantId) && isDatasetId(value.datasetId)
    && identifier(value.issuerSubject) && identifier(value.recipientSubject) && value.issuerSubject !== value.recipientSubject
    && capability(value.capability) && identifier(value.sourceRoleId) && identifier(value.sourceGrantId)
    && isCounter(value.sourceRoleRevision) && isCounter(value.issuerMembershipRevision) && isCounter(value.recipientMembershipRevision)
    && isCounter(value.issuedAt) && isCounter(value.expiresAt) && value.expiresAt > value.issuedAt && status(value.status);
}
export function isAuthorizationSnapshot(value: unknown): value is AuthorizationSnapshot {
  if (!isObject(value) || !hasOnlyFields(value, ["version", "revision", "tenant", "datasets", "memberships", "roles", "delegations"])
    || value.version !== 1 || !isCounter(value.revision) || !isObject(value.tenant)
    || !hasOnlyFields(value.tenant, ["id", "status", "ownerSubjects"]) || !identifier(value.tenant.id) || !status(value.tenant.status)
    || !records(value.tenant.ownerSubjects, identifier) || !unique(value.tenant.ownerSubjects)
    || !records(value.datasets, dataset)
    || !unique(value.datasets.map((entry) => entry.datasetId))
    || !records(value.memberships, membership)
    || !unique(value.memberships.map((entry) => entry.subject))
    || !records(value.roles, role) || !unique(value.roles.map((entry) => entry.id))
    || !unique(value.roles.flatMap((entry) => entry.grants.map((item) => item.id)))
    || !records(value.delegations, delegation) || !unique(value.delegations.map((entry) => entry.id))) return false;
  const tenantId = value.tenant.id;
  const datasets = new Set(value.datasets.map((entry) => entry.datasetId));
  const roles = new Set(value.roles.map((entry) => entry.id));
  return value.datasets.every((entry) => entry.tenantId === tenantId)
    && value.memberships.every((entry) => entry.tenantId === tenantId && entry.roleIds.every((id) => roles.has(id)))
    && value.roles.every((entry) => entry.tenantId === tenantId && entry.grants.every((item) => datasets.has(item.datasetId)))
    && value.delegations.every((entry) => entry.tenantId === tenantId && datasets.has(entry.datasetId));
}
export function isAuthorizationRequest(value: unknown): value is AuthorizationRequest {
  if (!isObject(value) || !identifier(value.tenantId) || !isDatasetId(value.datasetId) || !isCounter(value.expectedPolicyRevision)) return false;
  const fields = ["tenantId", "datasetId", "expectedPolicyRevision", "operation"];
  switch (value.operation) {
    case "access": return hasOnlyFields(value, [...fields, "capability"]) && capability(value.capability);
    case "assign-role": return hasOnlyFields(value, [...fields, "recipientSubject", "roleId"])
      && identifier(value.recipientSubject) && identifier(value.roleId);
    case "delegate": return hasOnlyFields(value, [...fields, "recipientSubject", "capability", "sourceRoleId", "sourceGrantId", "expiresAt"])
      && identifier(value.recipientSubject) && capability(value.capability)
      && identifier(value.sourceRoleId) && identifier(value.sourceGrantId) && isCounter(value.expiresAt);
    default: return false;
  }
}

function sourceGrant(snapshot: AuthorizationSnapshot, issuer: TenantMembership, roleId: string, grantId: string,
  datasetId: string, requestedCapability: PersistenceCapability) {
  const sourceRole = snapshot.roles.find((entry) => entry.id === roleId && entry.status === "active");
  if (!sourceRole || issuer.status !== "active" || !issuer.roleIds.includes(roleId)) return null;
  const source = sourceRole.grants.find((entry) => entry.id === grantId && entry.datasetId === datasetId
    && entry.capability === requestedCapability && entry.delegable);
  return source ? { role: sourceRole, grant: source } : null;
}

// Snapshot and time MUST come from trusted server reads, never request JSON or browser storage.
export function evaluateAuthorization(principal: unknown, observed: unknown, input: unknown, nowMs: number): AuthorizationDecision {
  let revision: number | null = null;
  const decide = (allowed: boolean, reason: AuthorizationReason, evidenceId?: string): AuthorizationDecision =>
    Object.freeze({ status: allowed ? "allowed" : "denied", reason, policyVersion: 1,
      observedPolicyRevision: revision, ...(evidenceId === undefined ? {} : { evidenceId }) });
  if (!isAuthenticatedPrincipal(principal)) return decide(false, "authentication-required");
  if (!isAuthorizationSnapshot(observed) || !isCounter(nowMs)) return decide(false, "invalid-policy");
  revision = observed.revision;
  if (!isAuthorizationRequest(input)) return decide(false, "invalid-request");
  if (input.tenantId !== observed.tenant.id) return decide(false, "tenant-mismatch");
  if (observed.tenant.status !== "active") return decide(false, "tenant-revoked");
  if (!observed.datasets.some((entry) => entry.datasetId === input.datasetId)) return decide(false, "dataset-not-authorized");
  if (input.expectedPolicyRevision !== revision) return decide(false, "stale-policy");
  const member = observed.memberships.find((entry) => entry.subject === principal.subject);
  if (!member) return decide(false, "membership-required");
  if (member.status !== "active") return decide(false, "membership-revoked");
  const owner = observed.tenant.ownerSubjects.includes(principal.subject);

  if (input.operation !== "access") {
    if (input.recipientSubject === principal.subject) return decide(false, "self-escalation");
    const recipient = observed.memberships.find((entry) => entry.subject === input.recipientSubject && entry.status === "active");
    if (!recipient) return decide(false, "recipient-not-active");
    if (input.operation === "assign-role") {
      if (!owner) return decide(false, "owner-required");
      if (!observed.roles.some((entry) => entry.id === input.roleId && entry.status === "active")) return decide(false, "role-not-active");
      return decide(true, "role-assignment-authorized", input.roleId);
    }
    if (input.expiresAt <= nowMs) return decide(false, "invalid-expiry");
    const source = sourceGrant(observed, member, input.sourceRoleId, input.sourceGrantId, input.datasetId, input.capability);
    return source ? decide(true, "delegation-authorized", source.grant.id) : decide(false, "source-not-delegable");
  }

  if (owner) return decide(true, "owner-authority");
  const direct = observed.roles.filter((entry) => entry.status === "active" && member.roleIds.includes(entry.id))
    .flatMap((entry) => entry.grants).filter((entry) => entry.datasetId === input.datasetId && entry.capability === input.capability)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0];
  if (direct) return decide(true, "direct-grant", direct.id);
  const delegated = observed.delegations.filter((entry) => {
    if (entry.status !== "active" || entry.recipientSubject !== principal.subject || entry.datasetId !== input.datasetId
      || entry.capability !== input.capability || entry.issuedAt > nowMs || entry.expiresAt <= nowMs
      || entry.recipientMembershipRevision !== member.revision) return false;
    const issuer = observed.memberships.find((item) => item.subject === entry.issuerSubject);
    if (!issuer || issuer.revision !== entry.issuerMembershipRevision) return false;
    const source = sourceGrant(observed, issuer, entry.sourceRoleId, entry.sourceGrantId, entry.datasetId, entry.capability);
    return source !== null && source.role.revision === entry.sourceRoleRevision;
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0];
  return delegated ? decide(true, "delegated-grant", delegated.id) : decide(false, "capability-not-granted");
}
