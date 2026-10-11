import type { AuthorizationSnapshot } from "./authorization-contract";
import { isAuthorizationSnapshot, isAuthorityIdentifier } from "./authorization-policy";

export type MembershipChange =
  | { operation: "grant"; subject: string; roleIds: readonly string[] }
  | { operation: "revoke"; subject: string };

export type MembershipResult =
  | { status: "denied"; reason: string }
  | { status: "applied"; snapshot: AuthorizationSnapshot };

export function evaluateMembershipChange(
  snapshot: AuthorizationSnapshot,
  actorSubject: string,
  expectedRevision: number,
  change: MembershipChange,
): MembershipResult {
  const deny = (reason: string): MembershipResult => ({ status: "denied", reason });

  if (!isAuthorizationSnapshot(snapshot)) return deny("invalid-policy");
  if (snapshot.tenant.status !== "active") return deny("tenant-revoked");
  if (snapshot.revision !== expectedRevision) return deny("stale-policy");

  const actor = snapshot.memberships.find(m => m.subject === actorSubject);
  if (!actor || actor.status !== "active" ||
      !snapshot.tenant.ownerSubjects.includes(actorSubject)) return deny("owner-required");

  if (!change || !isAuthorityIdentifier(change.subject) ||
      !change.subject.startsWith("user_")) return deny("invalid-subject");

  if (change.subject === actorSubject) return deny("self-modification");
  if (snapshot.tenant.ownerSubjects.includes(change.subject)) return deny("owner-protected");

  const fields = Object.keys(change);
  const expected = change.operation === "grant"
    ? ["operation", "subject", "roleIds"]
    : change.operation === "revoke"
      ? ["operation", "subject"]
      : [];

  if (expected.length === 0 ||
      fields.length !== expected.length ||
      !fields.every(field => expected.includes(field))) {
    return deny("invalid-request");
  }

  const previous = snapshot.memberships.find(m => m.subject === change.subject);

  if (change.operation === "grant") {
    if (previous?.status === "revoked") {
      return deny("revoked-membership");
    }
    if (!Array.isArray(change.roleIds) ||
        new Set(change.roleIds).size !== change.roleIds.length ||
        !change.roleIds.every(id => typeof id === "string" &&
          snapshot.roles.some(r => r.id === id && r.status === "active"))) {
      return deny("invalid-roles");
    }

    const updated = {
      subject: change.subject,
      tenantId: snapshot.tenant.id,
      revision: (previous?.revision ?? 0) + 1,
      status: "active" as const,
      roleIds: [...change.roleIds],
    };

    return {
      status: "applied",
      snapshot: {
        ...snapshot,
        revision: snapshot.revision + 1,
        memberships: [...snapshot.memberships.filter(m => m.subject !== change.subject), updated],
      },
    };
  }

  if (change.operation !== "revoke") return deny("invalid-operation");
  if (!previous || previous.status !== "active") return deny("membership-not-active");

  const updated = {
    ...previous,
    revision: previous.revision + 1,
    status: "revoked" as const,
    roleIds: [],
  };

  return {
    status: "applied",
    snapshot: {
      ...snapshot,
      revision: snapshot.revision + 1,
      memberships: [...snapshot.memberships.filter(m => m.subject !== change.subject), updated],
    },
  };
}
