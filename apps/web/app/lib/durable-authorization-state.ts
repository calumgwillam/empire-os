import type { AuthorizationSnapshot, AuthorityDelegation } from "./authorization-contract";
import { isAuthorizationSnapshot, isAuthorityIdentifier } from "./authorization-policy";
import { hasOnlyFields, isCounter, isObject } from "./server-persistence-contract";

export type RevocationTarget = Readonly<{
  kind: "membership" | "role" | "delegation";
  id: string;
}>;
export type AuthorityRevocation = RevocationTarget & Readonly<{
  operationId: string;
  policyRevision: number;
  revokedAt: number;
}>;
export type DurableAuthorityState = Readonly<{
  schemaVersion: 1;
  snapshot: AuthorizationSnapshot;
  revocations: readonly AuthorityRevocation[];
}>;
export type AuthorityStateValidation =
  | Readonly<{ status: "valid"; value: DurableAuthorityState }>
  | Readonly<{ status: "inconsistent"; reason: string }>;

export function isRevocationTarget(value: unknown): value is RevocationTarget {
  return isObject(value) && hasOnlyFields(value, ["kind", "id"]) && isAuthorityIdentifier(value.id)
    && (value.kind === "membership" || value.kind === "role" || value.kind === "delegation");
}

function targetStatus(snapshot: AuthorizationSnapshot, target: RevocationTarget) {
  switch (target.kind) {
    case "membership": return snapshot.memberships.find((entry) => entry.subject === target.id)?.status;
    case "role": return snapshot.roles.find((entry) => entry.id === target.id)?.status;
    case "delegation": return snapshot.delegations.find((entry) => entry.id === target.id)?.status;
  }
}

export function validateDurableAuthorityState(value: unknown): AuthorityStateValidation {
  const invalid = (reason: string): AuthorityStateValidation => ({ status: "inconsistent", reason });
  if (!isObject(value) || !hasOnlyFields(value, ["schemaVersion", "snapshot", "revocations"])
    || value.schemaVersion !== 1 || !isAuthorizationSnapshot(value.snapshot) || !Array.isArray(value.revocations)) {
    return invalid("Invalid durable authority envelope.");
  }
  const revocations: AuthorityRevocation[] = [];
  for (let index = 0; index < value.revocations.length; index += 1) {
    const entry: unknown = value.revocations[index];
    if (!Object.prototype.hasOwnProperty.call(value.revocations, index) || !isObject(entry)
      || !hasOnlyFields(entry, ["kind", "id", "operationId", "policyRevision", "revokedAt"])
      || !isRevocationTarget({ kind: entry.kind, id: entry.id })
      || !isAuthorityIdentifier(entry.operationId) || !isCounter(entry.policyRevision)
      || entry.policyRevision === 0 || entry.policyRevision > value.snapshot.revision || !isCounter(entry.revokedAt)) {
      return invalid("Invalid revocation evidence.");
    }
    // Revalidate the narrowed fields rather than asserting an untrusted record's type.
    const target = { kind: entry.kind, id: entry.id };
    if (!isRevocationTarget(target) || targetStatus(value.snapshot, target) !== "revoked"
      || revocations.some((previous) => previous.kind === target.kind && previous.id === target.id)
      || revocations.some((previous) => previous.operationId === entry.operationId)) {
      return invalid("Ambiguous or dangling revocation evidence.");
    }
    revocations.push({ ...target, operationId: entry.operationId, policyRevision: entry.policyRevision, revokedAt: entry.revokedAt });
  }
  const snapshot = value.snapshot;
  if (snapshot.tenant.ownerSubjects.some((subject) => !snapshot.memberships.some((member) => member.subject === subject))) {
    return invalid("Ownership requires a retained membership.");
  }
  for (const target of [
    ...snapshot.memberships.map((entry) => ({ kind: "membership" as const, id: entry.subject, status: entry.status })),
    ...snapshot.roles.map((entry) => ({ kind: "role" as const, id: entry.id, status: entry.status })),
    ...snapshot.delegations.map((entry) => ({ kind: "delegation" as const, id: entry.id, status: entry.status })),
  ]) {
    if (target.status === "revoked" && !revocations.some((entry) => entry.kind === target.kind && entry.id === target.id)) {
      return invalid("Revoked authority requires retained evidence.");
    }
  }
  for (const entry of snapshot.delegations) {
    const issuer = snapshot.memberships.find((member) => member.subject === entry.issuerSubject);
    const recipient = snapshot.memberships.find((member) => member.subject === entry.recipientSubject);
    const role = snapshot.roles.find((item) => item.id === entry.sourceRoleId);
    const grant = role?.grants.find((item) => item.id === entry.sourceGrantId);
    if (!issuer || !recipient || !role || !grant || grant.datasetId !== entry.datasetId || grant.capability !== entry.capability
      || entry.issuerMembershipRevision > issuer.revision || entry.recipientMembershipRevision > recipient.revision
      || entry.sourceRoleRevision > role.revision) {
      return invalid("Delegation has invalid source references or revisions.");
    }
  }
  return { status: "valid", value: { schemaVersion: 1, snapshot, revocations } };
}

// Canonical comparison is insensitive to record ordering, but preserves every field.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical).sort());
  if (isObject(value)) return JSON.stringify(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return JSON.stringify(value);
}

function sameDelegation(left: AuthorityDelegation, right: AuthorityDelegation): boolean {
  return canonical({ ...left, status: "active" }) === canonical({ ...right, status: "active" });
}

export function validateAuthorityTransition(previous: unknown, proposed: unknown, nowMs: number): AuthorityStateValidation {
  const before = validateDurableAuthorityState(previous);
  const after = validateDurableAuthorityState(proposed);
  const invalid = (reason: string): AuthorityStateValidation => ({ status: "inconsistent", reason });
  if (before.status !== "valid") return before;
  if (after.status !== "valid") return after;
  const old = before.value.snapshot;
  const next = after.value.snapshot;
  if (!isCounter(nowMs) || old.revision === Number.MAX_SAFE_INTEGER || next.revision !== old.revision + 1
    || canonical(old.tenant) !== canonical(next.tenant) || canonical(old.datasets) !== canonical(next.datasets)) {
    return invalid("Revision exhaustion, ownership change or dataset remapping is not permitted.");
  }
  // This ordinary mutation path cannot provision roles, redefine grants or erase tombstones.
  if (old.roles.length !== next.roles.length || old.memberships.length !== next.memberships.length) {
    return invalid("Provisioning and deletion require a separate trusted process.");
  }
  for (const member of old.memberships) {
    const replacement = next.memberships.find((entry) => entry.subject === member.subject);
    if (!replacement || (member.status === "revoked" && replacement.status !== "revoked")
      || replacement.revision !== member.revision + (canonical(member) === canonical(replacement) ? 0 : 1)) {
      return invalid("Membership identity, tombstone or revision was violated.");
    }
  }
  for (const role of old.roles) {
    const replacement = next.roles.find((entry) => entry.id === role.id);
    if (!replacement || canonical(role.grants) !== canonical(replacement.grants)
      || (role.status === "revoked" && replacement.status !== "revoked")
      || replacement.revision !== role.revision + (canonical(role) === canonical(replacement) ? 0 : 1)) {
      return invalid("Role definitions, tombstones or revisions were violated.");
    }
  }
  for (const entry of old.delegations) {
    const replacement = next.delegations.find((item) => item.id === entry.id);
    if (!replacement || !sameDelegation(entry, replacement) || (entry.status === "revoked" && replacement.status !== "revoked")) {
      return invalid("Delegation evidence is immutable and cannot be laundered or resurrected.");
    }
  }
  for (const entry of next.delegations.filter((item) => !old.delegations.some((prior) => prior.id === item.id))) {
    const issuer = old.memberships.find((member) => member.subject === entry.issuerSubject);
    const recipient = old.memberships.find((member) => member.subject === entry.recipientSubject);
    const role = old.roles.find((item) => item.id === entry.sourceRoleId);
    const grant = role?.grants.find((item) => item.id === entry.sourceGrantId);
    if (entry.status !== "active" || entry.issuedAt !== nowMs || entry.expiresAt <= nowMs
      || issuer?.status !== "active" || recipient?.status !== "active" || role?.status !== "active"
      || !issuer.roleIds.includes(role.id) || !grant?.delegable
      || entry.issuerMembershipRevision !== issuer.revision || entry.recipientMembershipRevision !== recipient.revision
      || entry.sourceRoleRevision !== role.revision) {
      return invalid("New delegation must bind the issuer's current direct authority.");
    }
  }
  if (before.value.revocations.some((entry) => !after.value.revocations.some((item) => canonical(item) === canonical(entry)))) {
    return invalid("Revocation evidence cannot be erased or edited.");
  }
  for (const entry of after.value.revocations.filter((item) => !before.value.revocations.some((prior) => prior.operationId === item.operationId))) {
    if (targetStatus(old, entry) !== "active" || targetStatus(next, entry) !== "revoked"
      || entry.policyRevision !== next.revision || entry.revokedAt !== nowMs) {
      return invalid("New revocation evidence must match this authority transition.");
    }
  }
  return after;
}
