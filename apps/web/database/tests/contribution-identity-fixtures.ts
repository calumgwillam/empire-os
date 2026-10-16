import {
  IDENTITY_ADMIN_CAPABILITIES, createVerifiedIdentityClaimResolver,
  type ContributionIdentityEvent, type ContributionIdentityRegistry, type IdentityAuthorityObservation,
} from "../../app/lib/contribution-identity-authority";
import { createServerPrincipalResolver, isAuthenticatedPrincipal } from "../../app/lib/server-persistence-authority";

export const IDENTITY_TEST_TENANT = "identity-test-tenant";
export const IDENTITY_TEST_NOW = 90_000_000;
export const IDENTITY_TEST_SUBJECTS = [
  "user_founder", "user_reviewer", "user_old", "user_new", "user_target",
  "user_parallel_a", "user_parallel_b", "user_lost_ack",
];

export async function identityTestPrincipal(subject = "user_founder") {
  const principal = await createServerPrincipalResolver(async () => ({ status: "authenticated", subject }))(
    new Request("https://empire.invalid"),
  );
  if (!isAuthenticatedPrincipal(principal)) throw new Error("Identity fixture principal unavailable.");
  return principal;
}

export function identityTestRegistry(): ContributionIdentityRegistry {
  const events: ContributionIdentityEvent[] = [{
    sequence: 1, eventId: "bootstrap", previousEventId: null, operationId: "bootstrap",
    tenantId: IDENTITY_TEST_TENANT, actorSubject: "system:bootstrap", recordedAtMs: IDENTITY_TEST_NOW - 1000,
    kind: "administrator-granted", grantId: "founder-grant", subject: "user_founder",
    capabilities: [...IDENTITY_ADMIN_CAPABILITIES], source: "bootstrap",
  }];
  for (const subject of ["user_founder", "user_reviewer", "user_old"]) {
    events.push({
      sequence: events.length + 1, eventId: `bind-${subject}`, previousEventId: events.at(-1)?.eventId ?? null,
      operationId: `bind-${subject}`, tenantId: IDENTITY_TEST_TENANT, actorSubject: "user_founder",
      recordedAtMs: IDENTITY_TEST_NOW - 1000, kind: "subject-bound", bindingId: `binding-${subject}`,
      subject, personId: `person-${subject}`, verificationId: `proof-${subject}`, verifiedAtMs: IDENTITY_TEST_NOW - 1000,
    });
  }
  events.push({
    sequence: events.length + 1, eventId: "reviewer-grant-event", previousEventId: events.at(-1)?.eventId ?? null,
    operationId: "reviewer-grant-operation", tenantId: IDENTITY_TEST_TENANT, actorSubject: "user_founder",
    recordedAtMs: IDENTITY_TEST_NOW - 1000, kind: "administrator-granted",
    grantId: "reviewer-grant", subject: "user_reviewer", capabilities: ["approve-reassignment"], source: "delegated",
  });
  return { version: 1, revision: events.length, bindingRevision: 3, policyRevision: 2, events };
}

export function identityTestObservation(nowMs = IDENTITY_TEST_NOW): IdentityAuthorityObservation {
  return {
    tenantId: IDENTITY_TEST_TENANT, tenantStatus: "active", policyRevision: 1,
    tenantPolicyRevisions: [{ tenantId: IDENTITY_TEST_TENANT, revision: 1 }],
    checkedAtMs: nowMs, validUntilMs: nowMs + 60_000, allMembershipsObserved: true,
    memberships: IDENTITY_TEST_SUBJECTS.map(subject => ({
      tenantId: IDENTITY_TEST_TENANT, subject, revision: 1, status: "active",
    })),
    people: IDENTITY_TEST_SUBJECTS.map(subject => ({
      tenantId: IDENTITY_TEST_TENANT, personId: `person-${subject}`, status: "active",
      kind: subject === "user_founder" ? "founder" : "other",
    })),
    recentAuthentications: IDENTITY_TEST_SUBJECTS.map(subject => ({ subject, authenticatedAtMs: nowMs })),
  };
}

export function identityTestRequestBase(operationId = "identity-test-bind", state = identityTestRegistry()) {
  return {
    tenantId: IDENTITY_TEST_TENANT, operationId, eventId: `${operationId}-event`,
    expectedRegistryRevision: state.revision, expectedBindingRevision: state.bindingRevision,
    expectedIdentityPolicyRevision: state.policyRevision, expectedTenantPolicyRevision: 1,
  };
}

export function identityTestRequest(operationId = "identity-test-bind", state = identityTestRegistry()) {
  return { ...identityTestRequestBase(operationId, state), kind: "bind", subject: "user_target", personId: "person-user_target" };
}

export async function identityTestClaim(subject = "user_target", personId = "person-user_target", nowMs = IDENTITY_TEST_NOW) {
  const resolver = createVerifiedIdentityClaimResolver(async (_principal, request) => ({
    ...request, verificationId: `verification-${subject}`, verifiedAtMs: nowMs,
  }));
  return resolver(await identityTestPrincipal(), { tenantId: IDENTITY_TEST_TENANT, subject, personId }, nowMs);
}
