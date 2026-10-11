import {
  validateDurableAuthorityState,
} from "./durable-authorization-state";

export function validateMembershipProvisioningTransition(
  previous: unknown,
  proposed: unknown,
  actorSubject: string,
  nowMs: number,
) {
  const deny = (reason: string) => ({
    status: "inconsistent" as const, reason,
  });

  const before = validateDurableAuthorityState(previous);
  const after = validateDurableAuthorityState(proposed);

  if (before.status !== "valid") return before;
  if (after.status !== "valid") return after;

  const old = before.value.snapshot;
  const next = after.value.snapshot;
  const actor = old.memberships.find(m => m.subject === actorSubject);

  if (!actor || actor.status !== "active" ||
      !old.tenant.ownerSubjects.includes(actorSubject)) {
    return deny("Founder authority required.");
  }

  if (next.memberships.length !== old.memberships.length + 1) {
    return deny("Exactly one new membership is required.");
  }

  const canonical = (value: unknown): string => {
    if (Array.isArray(value))
      return JSON.stringify(value.map(canonical).sort());
    if (value !== null && typeof value === "object")
      return JSON.stringify(Object.keys(value).sort().map(key =>
        [key, canonical((value as Record<string, unknown>)[key])]));
    return JSON.stringify(value);
  };
  const unchanged = (a: unknown, b: unknown) =>
    canonical(a) === canonical(b);

  if (!Number.isSafeInteger(nowMs) || nowMs < 0 ||
      old.revision >= Number.MAX_SAFE_INTEGER ||
      next.revision !== old.revision + 1) {
    return deny("Invalid provisioning revision.");
  }

  if (!unchanged(old.tenant, next.tenant) ||
      !unchanged(old.datasets, next.datasets) ||
      !unchanged(old.roles, next.roles) ||
      !unchanged(old.delegations, next.delegations) ||
      !unchanged(before.value.revocations, after.value.revocations)) {
    return deny("Existing authority cannot change during provisioning.");
  }

  for (const member of old.memberships) {
    const retained = next.memberships.find(m => m.subject === member.subject);
    if (!retained || !unchanged(member, retained)) {
      return deny("Existing membership was modified.");
    }
  }

  const added = next.memberships.filter(m =>
    !old.memberships.some(existing => existing.subject === m.subject));

  if (added.length !== 1 || added[0].status !== "active" ||
      added[0].revision !== 1 ||
      !/^user_[a-zA-Z0-9_]+$/.test(added[0].subject) ||
      !added[0].roleIds.every(id =>
        old.roles.some(role => role.id === id && role.status === "active"))) {
    return deny("Invalid new employee membership.");
  }

  return after;
}
