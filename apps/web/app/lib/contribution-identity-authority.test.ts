import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import {
  createServerPrincipalResolver,
  isAuthenticatedPrincipal,
  type AuthenticatedPrincipal,
} from "./server-persistence-authority";
import {
  createVerifiedIdentityClaimResolver,
  IDENTITY_REAUTHENTICATION_WINDOW_MS,
  isContributionIdentityRegistry,
  previewContributionIdentityOperation,
  type ContributionIdentityEvent,
  type ContributionIdentityRegistry,
  type IdentityAuthorityObservation,
  type IdentityMembership,
  type VerifiedIdentityClaim,
} from "./contribution-identity-authority";

const NOW = 90_000_000;
const ORG = "org-a";
const OTHER_ORG = "org-b";
const FOUNDER_CAPABILITIES = [
  "bind", "revoke", "reassign", "delegate", "approve-reassignment", "recover-founder",
] as const;
const OPERATOR_CAPABILITIES = ["bind", "revoke", "reassign", "delegate", "recover-founder"] as const;
const APPROVER_CAPABILITIES = ["approve-reassignment"] as const;

async function principal(subject: string): Promise<AuthenticatedPrincipal> {
  const resolved = await createServerPrincipalResolver(async () => ({ status: "authenticated", subject }))(
    new Request("https://empire.invalid"),
  );
  if (!isAuthenticatedPrincipal(resolved)) throw new Error("Test identity was not server-minted.");
  return resolved;
}

type FixtureEventDetails = {
  [Kind in ContributionIdentityEvent["kind"]]: Omit<
    Extract<ContributionIdentityEvent, { kind: Kind }>,
    "sequence" | "previousEventId" | "eventId" | "operationId" | "tenantId" | "actorSubject" | "recordedAtMs"
  >;
}[ContributionIdentityEvent["kind"]];
type FixtureEventInput = FixtureEventDetails & Partial<Pick<
  ContributionIdentityEvent, "eventId" | "operationId" | "tenantId" | "actorSubject" | "recordedAtMs"
>>;

function event(sequence: number, previousEventId: string | null, values: FixtureEventInput): ContributionIdentityEvent {
  return {
    sequence,
    eventId: `event-${sequence}`,
    previousEventId,
    operationId: `operation-${sequence}`,
    tenantId: ORG,
    actorSubject: "user_founder",
    recordedAtMs: NOW - 10_000,
    ...values,
  };
}

function registry(options: Readonly<{
  operatorInOtherOrg?: boolean;
  approverInOtherOrg?: boolean;
}> = {}): ContributionIdentityRegistry {
  const events: ContributionIdentityEvent[] = [];
  const append = (values: FixtureEventInput) => events.push(event(events.length + 1, events.at(-1)?.eventId ?? null, values));

  append({
    eventId: "bootstrap-founder-org", operationId: "bootstrap-founder-org", tenantId: ORG,
    actorSubject: "system:bootstrap", kind: "administrator-granted", grantId: "founder-admin-org",
    subject: "user_founder", capabilities: [...FOUNDER_CAPABILITIES], source: "bootstrap",
  });
  append({
    eventId: "bootstrap-founder-other-org", operationId: "bootstrap-founder-other-org", tenantId: OTHER_ORG,
    actorSubject: "system:bootstrap", kind: "administrator-granted", grantId: "founder-admin-other-org",
    subject: "user_founder", capabilities: [...FOUNDER_CAPABILITIES], source: "bootstrap",
  });
  append({
    eventId: "bind-founder", operationId: "bind-founder", kind: "subject-bound", bindingId: "binding-founder",
    subject: "user_founder", personId: "person-founder", verificationId: "verified-founder", verifiedAtMs: NOW - 10_000,
  });
  append({
    eventId: "bind-operator", operationId: "bind-operator", kind: "subject-bound", bindingId: "binding-operator",
    subject: "user_ops", personId: "person-ops", verificationId: "verified-operator", verifiedAtMs: NOW - 10_000,
  });
  append({
    eventId: "bind-reviewer", operationId: "bind-reviewer", kind: "subject-bound", bindingId: "binding-reviewer",
    subject: "user_reviewer", personId: "person-reviewer", verificationId: "verified-reviewer", verifiedAtMs: NOW - 10_000,
  });
  append({
    eventId: "bind-old-account", operationId: "bind-old-account", kind: "subject-bound", bindingId: "binding-old-account",
    subject: "user_old", personId: "person-staff", verificationId: "verified-old-account", verifiedAtMs: NOW - 10_000,
  });
  append({
    eventId: "delegate-operator-org", operationId: "delegate-operator-org", tenantId: ORG,
    kind: "administrator-granted", grantId: "operator-admin-org", subject: "user_ops",
    capabilities: [...OPERATOR_CAPABILITIES], source: "delegated",
  });
  if (options.operatorInOtherOrg !== false) {
    append({
      eventId: "delegate-operator-other-org", operationId: "delegate-operator-other-org", tenantId: OTHER_ORG,
      kind: "administrator-granted", grantId: "operator-admin-other-org", subject: "user_ops",
      capabilities: [...OPERATOR_CAPABILITIES], source: "delegated",
    });
  }
  append({
    eventId: "delegate-approver-org", operationId: "delegate-approver-org", tenantId: ORG,
    kind: "administrator-granted", grantId: "approver-admin-org", subject: "user_reviewer",
    capabilities: [...APPROVER_CAPABILITIES], source: "delegated",
  });
  if (options.approverInOtherOrg !== false) {
    append({
      eventId: "delegate-approver-other-org", operationId: "delegate-approver-other-org", tenantId: OTHER_ORG,
      kind: "administrator-granted", grantId: "approver-admin-other-org", subject: "user_reviewer",
      capabilities: [...APPROVER_CAPABILITIES], source: "delegated",
    });
  }

  const policyRevision = events.filter((item) => item.kind === "administrator-granted").length;
  const bindingRevision = events.filter((item) =>
    item.kind === "subject-bound" || item.kind === "binding-reassigned" || item.kind === "binding-revoked").length;
  return { version: 1, revision: events.length, bindingRevision, policyRevision, events };
}

function membership(tenantId: string, subject: string, status: IdentityMembership["status"] = "active"): IdentityMembership {
  return { tenantId, subject, revision: 3, status };
}

function observation(): IdentityAuthorityObservation {
  const subjects = ["user_founder", "user_ops", "user_reviewer", "user_old", "user_new", "user_target"];
  return {
    tenantId: ORG,
    tenantStatus: "active",
    policyRevision: 10,
    tenantPolicyRevisions: [{ tenantId: ORG, revision: 10 }, { tenantId: OTHER_ORG, revision: 20 }],
    checkedAtMs: NOW,
    validUntilMs: NOW + 60_000,
    allMembershipsObserved: true,
    memberships: [
      ...subjects.flatMap((subject) => [membership(ORG, subject), membership(OTHER_ORG, subject)]),
    ],
    people: [
      { tenantId: ORG, personId: "person-founder", status: "active", kind: "founder" },
      { tenantId: ORG, personId: "person-ops", status: "active", kind: "other" },
      { tenantId: ORG, personId: "person-reviewer", status: "active", kind: "other" },
      { tenantId: ORG, personId: "person-staff", status: "active", kind: "other" },
      { tenantId: ORG, personId: "person-target", status: "active", kind: "other" },
      { tenantId: OTHER_ORG, personId: "person-founder", status: "active", kind: "founder" },
      { tenantId: OTHER_ORG, personId: "person-ops", status: "active", kind: "other" },
      { tenantId: OTHER_ORG, personId: "person-reviewer", status: "active", kind: "other" },
      { tenantId: OTHER_ORG, personId: "person-staff", status: "active", kind: "other" },
    ],
    recentAuthentications: subjects.map((subject) => ({ subject, authenticatedAtMs: NOW - 1_000 })),
  };
}

function requestBase(value: ContributionIdentityRegistry) {
  return {
    operationId: "new-operation",
    eventId: "new-event",
    tenantId: ORG,
    expectedRegistryRevision: value.revision,
    expectedBindingRevision: value.bindingRevision,
    expectedIdentityPolicyRevision: value.policyRevision,
    expectedTenantPolicyRevision: 10,
  };
}

async function verifiedClaim(subject: string, personId: string, tenantId = ORG, verifiedAtMs = NOW) {
  const resolver = createVerifiedIdentityClaimResolver(async (_actor, request) => ({
    ...request, verificationId: `verification-${subject}-${personId}`, verifiedAtMs,
  }));
  return resolver(await principal("user_ops"), { tenantId, subject, personId }, verifiedAtMs);
}

function bindRequest(value: ContributionIdentityRegistry, subject = "user_target", personId = "person-target") {
  return { ...requestBase(value), kind: "bind", subject, personId };
}

function reassignRequest(value: ContributionIdentityRegistry, changes: Record<string, unknown> = {}) {
  return {
    ...requestBase(value), kind: "reassign", previousSubject: "user_old", previousPersonId: "person-staff",
    subject: "user_new", personId: "person-staff", justification: "Verified replacement account.",
    ...changes,
  };
}

function appendEvent(value: ContributionIdentityRegistry, next: ContributionIdentityEvent): ContributionIdentityRegistry {
  return {
    ...value,
    revision: value.revision + 1,
    bindingRevision: value.bindingRevision + (["subject-bound", "binding-revoked", "binding-reassigned"].includes(next.kind) ? 1 : 0),
    policyRevision: value.policyRevision + (next.kind === "administrator-granted" || next.kind === "administrator-revoked"
      ? 1 : next.kind === "binding-revoked" || next.kind === "binding-reassigned"
        ? next.revokedAdministratorGrantIds.length : 0),
    events: [...value.events, next],
  };
}

describe("contribution identity authority foundation", () => {
  it("validates a complete registry without changing its historical events", () => {
    const state = registry();
    const before = JSON.stringify(state);
    expect(isContributionIdentityRegistry(state)).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });

  it.each([
    {},
    { operatorInOtherOrg: false },
    { approverInOtherOrg: false },
    { operatorInOtherOrg: false, approverInOtherOrg: false },
  ])("links fixture history to actual event IDs with scope options %j", options => {
    const state = registry(options);
    expect(state.events[0].previousEventId).toBeNull();
    state.events.slice(1).forEach((entry, index) => {
      expect(entry.previousEventId).toBe(state.events[index].eventId);
      expect(entry.sequence).toBe(index + 2);
    });
    expect(isContributionIdentityRegistry(state)).toBe(true);
  });

  it("rejects a fabricated predecessor before evaluating an otherwise authorised request", async () => {
    const state = registry();
    const broken = {
      ...state,
      events: state.events.map((entry, index) => index === 1 ? { ...entry, previousEventId: "event-1" } : entry),
    };
    expect(isContributionIdentityRegistry(state)).toBe(true);
    expect(isContributionIdentityRegistry(broken)).toBe(false);
    expect(previewContributionIdentityOperation(
      await principal("user_ops"), null, broken, observation(), bindRequest(state),
      await verifiedClaim("user_target", "person-target"), NOW,
    )).toEqual({ status: "denied", reason: "invalid-authority" });
  });

  it("rejects malformed authority observations even with a valid registry and verified claim", async () => {
    const state = registry();
    const observed = observation();
    const actor = await principal("user_ops");
    const claim = await verifiedClaim("user_target", "person-target");
    expect(isContributionIdentityRegistry(state)).toBe(true);
    expect(previewContributionIdentityOperation(actor, null, state, observed, bindRequest(state), claim, NOW).status)
      .toBe("preview");
    const malformed = [
      { ...observed, policyRevision: -1 },
      { ...observed, tenantPolicyRevisions: [{ tenantId: ORG, revision: 11 }] },
      { ...observed, tenantPolicyRevisions: [...observed.tenantPolicyRevisions, observed.tenantPolicyRevisions[0]] },
      { ...observed, memberships: [...observed.memberships, observed.memberships[0]] },
      { ...observed, people: [...observed.people, observed.people[0]] },
      { ...observed, recentAuthentications: [...observed.recentAuthentications, observed.recentAuthentications[0]] },
      { ...observed, memberships: observed.memberships.map(entry => ({ ...entry, status: "fabricated" })) },
      { ...observed, people: observed.people.map(entry => ({ ...entry, kind: "fabricated" })) },
      { ...observed, recentAuthentications: [{ subject: "user_ops", authenticatedAtMs: NaN }] },
    ];
    for (const invalid of malformed) {
      expect(previewContributionIdentityOperation(actor, null, state, invalid, bindRequest(state), claim, NOW))
        .toEqual({ status: "denied", reason: "invalid-authority" });
    }
  });

  it.each(["revision", "bindingRevision", "policyRevision"] as const)("rejects invalid %s counters", field => {
    const state = registry();
    for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null, undefined]) {
      expect(isContributionIdentityRegistry({ ...state, [field]: invalid })).toBe(false);
    }
    expect(isContributionIdentityRegistry({ ...state, [field]: state[field] + 1 })).toBe(false);
  });

  it("rejects missing or unexpected registry fields and malformed event arrays", () => {
    const state = registry();
    const { policyRevision: omitted, ...missingField } = state;
    expect(omitted).toBeGreaterThan(0);
    expect(isContributionIdentityRegistry(missingField)).toBe(false);
    expect(isContributionIdentityRegistry({ ...state, version: 2 })).toBe(false);
    expect(isContributionIdentityRegistry({ ...state, actorSubject: "user_founder" })).toBe(false);
    expect(isContributionIdentityRegistry({ ...state, events: null })).toBe(false);
    expect(isContributionIdentityRegistry({ ...state, events: new Array(state.events.length) })).toBe(false);
  });

  it.each([
    ["subject-bound", { subject: "forged_subject" }],
    ["subject-bound", { personId: "" }],
    ["subject-bound", { verificationId: undefined }],
    ["subject-bound", { verifiedAtMs: NOW + 1 }],
    ["subject-bound", { role: "Founder" }],
    ["administrator-granted", { capabilities: ["superuser"] }],
    ["administrator-granted", { capabilities: ["bind", "bind"] }],
    ["administrator-granted", { capabilities: [] }],
    ["administrator-granted", { source: "client" }],
    ["administrator-granted", { actorSubject: "user_attacker" }],
    ["administrator-granted", { sequence: 0 }],
    ["administrator-granted", { previousEventId: "fabricated-event" }],
  ])("rejects malformed %s history with %j", (kind, changes) => {
    const state = registry();
    const index = state.events.findIndex(entry => entry.kind === kind);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(isContributionIdentityRegistry({
      ...state,
      events: state.events.map((entry, position) => position === index ? { ...entry, ...changes } : entry),
    })).toBe(false);
  });

  it("accepts only a separately verified claim and creates an immutable binding preview", async () => {
    const state = registry();
    const before = JSON.stringify(state);
    const actor = await principal("user_ops");
    const claim = await verifiedClaim("user_target", "person-target");
    const result = previewContributionIdentityOperation(
      actor, null, state, observation(), bindRequest(state), claim, NOW,
    );
    expect(result).toMatchObject({
      status: "preview",
      plan: {
        actorSubject: "user_ops", historicalContributionAttribution: "unchanged",
        transfersExistingRoleGrants: false, requiresLockedRevalidation: true,
        durable: false, effect: "identity-preview-only",
        event: {
          kind: "subject-bound", subject: "user_target", personId: "person-target",
          verificationId: "verification-user_target-person-target",
        },
      },
    });
    expect(JSON.stringify(state)).toBe(before);
    if (result.status !== "preview") throw new Error("Expected an identity preview.");
    expect(Object.isFrozen(result.plan.event)).toBe(true);
  });

  it("rejects forged, mismatched, stale and cross-organisation identity proof", async () => {
    const state = registry();
    const actor = await principal("user_ops");
    const input = bindRequest(state);
    const forged = {
      tenantId: ORG, subject: "user_target", personId: "person-target",
      verificationId: "client-asserted", verifiedAtMs: NOW,
    } as VerifiedIdentityClaim;
    expect(previewContributionIdentityOperation(actor, null, state, observation(), input, forged, NOW))
      .toMatchObject({ status: "denied", reason: "independently-verified-target-required" });
    const mismatchResolver = createVerifiedIdentityClaimResolver(async (_principal, request) => ({
      ...request, subject: "user_someone-else", verificationId: "mismatch", verifiedAtMs: NOW,
    }));
    await expect(mismatchResolver(actor, { tenantId: ORG, subject: "user_target", personId: "person-target" }, NOW))
      .rejects.toThrow("Independent verification");
    const staleResolver = createVerifiedIdentityClaimResolver(async (_principal, request) => ({
      ...request, verificationId: "expired-proof", verifiedAtMs: NOW - IDENTITY_REAUTHENTICATION_WINDOW_MS - 1,
    }));
    await expect(staleResolver(actor, { tenantId: ORG, subject: "user_target", personId: "person-target" }, NOW))
      .rejects.toThrow("Independent verification");
    const staleClaim = await verifiedClaim("user_target", "person-target", ORG, NOW - IDENTITY_REAUTHENTICATION_WINDOW_MS - 1);
    expect(previewContributionIdentityOperation(actor, null, state, observation(), input, staleClaim, NOW))
      .toMatchObject({ status: "denied", reason: "independently-verified-target-required" });
    const otherTenantClaim = await verifiedClaim("user_target", "person-target", OTHER_ORG);
    expect(previewContributionIdentityOperation(actor, null, state, observation(), input, otherTenantClaim, NOW))
      .toMatchObject({ status: "denied", reason: "independently-verified-target-required" });
  });

  it("does not infer identity-administration privilege from founder or employee role labels", async () => {
    const founderOnly = {
      version: 1 as const,
      revision: 1,
      bindingRevision: 1,
      policyRevision: 0,
      events: [{
        sequence: 1, eventId: "founder-person-binding", previousEventId: null,
        operationId: "founder-person-binding", tenantId: ORG, actorSubject: "user_founder",
        recordedAtMs: NOW - 10_000, kind: "subject-bound", bindingId: "binding-founder",
        subject: "user_founder", personId: "person-founder", verificationId: "verified", verifiedAtMs: NOW - 10_000,
      } as ContributionIdentityEvent],
    };
    expect(isContributionIdentityRegistry(founderOnly)).toBe(true);
    const result = previewContributionIdentityOperation(
      await principal("user_founder"), null, founderOnly, observation(), bindRequest(founderOnly), // role labels are not grants
      await verifiedClaim("user_target", "person-target"), NOW,
    );
    expect(result).toMatchObject({ status: "denied", reason: "identity-admin-permission-required" });

    const state = registry();
    const clientClaim = { ...bindRequest(state), role: "Founder", actorSubject: "user_founder" };
    expect(previewContributionIdentityOperation(
      await principal("user_ops"), null, state, observation(), clientClaim,
      await verifiedClaim("user_target", "person-target"), NOW,
    )).toMatchObject({ status: "denied", reason: "invalid-request" });
  });

  it("enforces global one-to-one active bindings and organisation-scoped person references", async () => {
    const state = registry();
    const actor = await principal("user_ops");
    expect(previewContributionIdentityOperation(actor, null, state, observation(),
      bindRequest(state, "user_old", "person-target"), await verifiedClaim("user_old", "person-target"), NOW))
      .toMatchObject({ status: "denied", reason: "active-identity-binding-conflict" });
    expect(previewContributionIdentityOperation(actor, null, state, observation(),
      bindRequest(state, "user_target", "person-staff"), await verifiedClaim("user_target", "person-staff"), NOW))
      .toMatchObject({ status: "denied", reason: "active-identity-binding-conflict" });
    const otherOrgOnlyPerson = {
      ...observation(),
      people: observation().people.filter((person) => person.personId !== "person-target"),
    };
    const request = bindRequest(state, "user_target", "person-target");
    expect(previewContributionIdentityOperation(actor, null, state, otherOrgOnlyPerson, request,
      await verifiedClaim("user_target", "person-target"), NOW))
      .toMatchObject({ status: "denied", reason: "person-not-active-in-organisation" });
  });

  it("rejects delegated grants recorded before a subject has a verified active identity binding", () => {
    const state = registry();
    const unboundGrant = event(state.revision + 1, state.events.at(-1)?.eventId ?? null, {
      kind: "administrator-granted", grantId: "orphan-grant", subject: "user_target",
      capabilities: ["bind"], source: "delegated",
    });
    const laterBinding = event(state.revision + 2, unboundGrant.eventId, {
      kind: "subject-bound", bindingId: "later-binding", subject: "user_target",
      personId: "person-target", verificationId: "verified-target", verifiedAtMs: NOW - 10_000,
    });
    expect(isContributionIdentityRegistry({
      ...state,
      revision: state.revision + 2,
      bindingRevision: state.bindingRevision + 1,
      policyRevision: state.policyRevision + 1,
      events: [...state.events, unboundGrant, laterBinding],
    })).toBe(false);
    const boundFirst = { ...laterBinding, sequence: state.revision + 1, previousEventId: state.events.at(-1)?.eventId ?? null };
    const grantAfterBinding = { ...unboundGrant, sequence: state.revision + 2, previousEventId: boundFirst.eventId };
    expect(isContributionIdentityRegistry({
      ...state,
      revision: state.revision + 2,
      bindingRevision: state.bindingRevision + 1,
      policyRevision: state.policyRevision + 1,
      events: [...state.events, boundFirst, grantAfterBinding],
    })).toBe(true);
  });

  it("requires active scoped memberships, complete cross-organisation membership data and fresh authentication", async () => {
    const state = registry();
    const actor = await principal("user_ops");
    const claim = await verifiedClaim("user_target", "person-target");
    const staleActor = {
      ...observation(),
      recentAuthentications: observation().recentAuthentications.map((entry) => entry.subject === "user_ops"
        ? { ...entry, authenticatedAtMs: NOW - IDENTITY_REAUTHENTICATION_WINDOW_MS - 1 } : entry),
    };
    expect(previewContributionIdentityOperation(actor, null, state, staleActor, bindRequest(state), claim, NOW))
      .toMatchObject({ status: "denied", reason: "fresh-authentication-required" });
    expect(previewContributionIdentityOperation(actor, null, state, {
      ...observation(), allMembershipsObserved: false,
    }, bindRequest(state), claim, NOW)).toMatchObject({ status: "denied", reason: "stale-or-incomplete-authority" });
    expect(previewContributionIdentityOperation(actor, null, state, {
      ...observation(), memberships: observation().memberships.map((member) =>
        member.subject === "user_ops" && member.tenantId === ORG ? { ...member, status: "revoked" as const } : member),
    }, bindRequest(state), claim, NOW)).toMatchObject({ status: "denied", reason: "active-admin-membership-required" });
  });

  it("requires scoped identity-admin grants in every organisation affected by a binding", async () => {
    const state = registry({ operatorInOtherOrg: false });
    const result = previewContributionIdentityOperation(
      await principal("user_ops"), await principal("user_reviewer"), state, observation(),
      reassignRequest(state), await verifiedClaim("user_new", "person-staff"), NOW,
    );
    expect(result).toMatchObject({ status: "denied", reason: "identity-admin-permission-required" });
  });

  it("requires justification, verified replacement identity and an independent fresh second authoriser", async () => {
    const state = registry();
    const actor = await principal("user_ops");
    const approver = await principal("user_reviewer");
    const request = reassignRequest(state);
    const claim = await verifiedClaim("user_new", "person-staff");
    expect(previewContributionIdentityOperation(actor, null, state, observation(), request, claim, NOW))
      .toMatchObject({ status: "denied", reason: "independent-fresh-approval-required" });
    expect(previewContributionIdentityOperation(actor, actor, state, observation(), request, claim, NOW))
      .toMatchObject({ status: "denied", reason: "independent-fresh-approval-required" });
    expect(previewContributionIdentityOperation(actor, approver, state, {
      ...observation(),
      recentAuthentications: observation().recentAuthentications.map((entry) => entry.subject === "user_reviewer"
        ? { ...entry, authenticatedAtMs: NOW - IDENTITY_REAUTHENTICATION_WINDOW_MS - 1 } : entry),
    }, request, claim, NOW)).toMatchObject({ status: "denied", reason: "independent-fresh-approval-required" });
    expect(previewContributionIdentityOperation(actor, approver, registry({ approverInOtherOrg: false }),
      observation(), reassignRequest(registry({ approverInOtherOrg: false })),
      await verifiedClaim("user_new", "person-staff"), NOW))
      .toMatchObject({ status: "denied", reason: "independent-fresh-approval-required" });
    expect(previewContributionIdentityOperation(actor, approver, state, observation(),
      reassignRequest(state, { justification: " " }), claim, NOW))
      .toMatchObject({ status: "denied", reason: "invalid-request" });
    expect(previewContributionIdentityOperation(actor, approver, state, observation(), request, claim, NOW))
      .toMatchObject({
        status: "preview",
        plan: {
          membershipRevocations: [
            { tenantId: ORG, subject: "user_old", expectedMembershipRevision: 3 },
            { tenantId: OTHER_ORG, subject: "user_old", expectedMembershipRevision: 3 },
          ],
        },
      });
  });

  it("requires founder-recovery authority for founder or administrator identity reassignment", async () => {
    const state = registry();
    const actor = await principal("user_ops");
    const approver = await principal("user_reviewer");
    const founderRequest = reassignRequest(state, {
      previousSubject: "user_founder", previousPersonId: "person-founder",
      subject: "user_new", personId: "person-founder",
    });
    const claim = await verifiedClaim("user_new", "person-founder");
    const noRecoveryGrant = {
      ...state,
      events: state.events.map((entry) => entry.kind === "administrator-granted" && entry.grantId === "operator-admin-org"
        ? { ...entry, capabilities: ["bind", "revoke", "reassign", "delegate"] as const } : entry),
    };
    expect(isContributionIdentityRegistry(noRecoveryGrant)).toBe(true);
    expect(previewContributionIdentityOperation(actor, approver, noRecoveryGrant, observation(),
      reassignRequest(noRecoveryGrant, {
        previousSubject: "user_founder", previousPersonId: "person-founder",
        subject: "user_new", personId: "person-founder",
      }), claim, NOW)).toMatchObject({ status: "denied", reason: "independent-fresh-approval-required" });
    const approved = previewContributionIdentityOperation(actor, approver, state, observation(), founderRequest, claim, NOW);
    expect(approved).toMatchObject({
      status: "preview",
      plan: {
        event: {
          kind: "binding-reassigned", previousSubject: "user_founder", subject: "user_new",
          approvedBySubject: "user_reviewer", justification: "Verified replacement account.",
        },
        requiresSessionRevocation: true,
      },
    });
  });

  it("revokes obsolete memberships and administrator grants without transferring roles or history", async () => {
    const state = registry();
    const result = previewContributionIdentityOperation(
      await principal("user_ops"), null, state, observation(),
      { ...requestBase(state), kind: "revoke", subject: "user_old", justification: "Access ended." }, null, NOW,
    );
    expect(result).toMatchObject({
      status: "preview",
      plan: {
        requiresSessionRevocation: true,
        transfersExistingRoleGrants: false,
        historicalContributionAttribution: "unchanged",
        membershipRevocations: [
          { tenantId: ORG, subject: "user_old", expectedMembershipRevision: 3 },
          { tenantId: OTHER_ORG, subject: "user_old", expectedMembershipRevision: 3 },
        ],
        event: { kind: "binding-revoked", subject: "user_old", personId: "person-staff" },
      },
    });
    if (result.status !== "preview") throw new Error("Expected a revocation preview.");
    expect(result.plan.event.kind === "binding-revoked" && result.plan.event.revokedAdministratorGrantIds).toEqual([]);
    expect(state.events.some((entry) => entry.kind === "subject-bound" && entry.subject === "user_old")).toBe(true);
  });

  it("requires two-person approval and recovery permission to revoke founder identity", async () => {
    const state = registry();
    const input = { ...requestBase(state), kind: "revoke", subject: "user_founder", justification: "Recovery review." };
    const actor = await principal("user_ops");
    expect(previewContributionIdentityOperation(actor, null, state, observation(), input, null, NOW))
      .toMatchObject({ status: "denied", reason: "independent-fresh-approval-required" });
    const approved = previewContributionIdentityOperation(
      actor, await principal("user_reviewer"), state, observation(), input, null, NOW,
    );
    expect(approved).toMatchObject({
      status: "preview",
      plan: { event: { kind: "binding-revoked", approvedBySubject: "user_reviewer" } },
    });
  });

  it("delegates only explicit subsets of organisation-scoped identity authority", async () => {
    const state = registry();
    const actor = await principal("user_ops");
    const base = requestBase(state);
    const grant = {
      ...base, kind: "grant-administrator", grantId: "new-admin-grant", subject: "user_old", capabilities: ["bind"],
    };
    expect(previewContributionIdentityOperation(actor, null, state, observation(), grant, null, NOW))
      .toMatchObject({
        status: "preview",
        plan: { event: { kind: "administrator-granted", subject: "user_old", source: "delegated", capabilities: ["bind"] } },
      });
    expect(previewContributionIdentityOperation(actor, null, state, observation(), {
      ...grant, capabilities: ["approve-reassignment"],
    }, null, NOW)).toMatchObject({ status: "denied", reason: "delegation-exceeds-authority" });
    expect(previewContributionIdentityOperation(actor, null, state, observation(), {
      ...grant, subject: "user_ops",
    }, null, NOW)).toMatchObject({ status: "denied", reason: "self-escalation" });
  });

  it("prevents administrator revocation from resurrecting after identity reassignment", async () => {
    const state = registry();
    const request = reassignRequest(state, {
      previousSubject: "user_ops", previousPersonId: "person-ops",
      subject: "user_new", personId: "person-ops",
    });
    const result = previewContributionIdentityOperation(
      await principal("user_founder"), await principal("user_reviewer"), state, observation(), request,
      await verifiedClaim("user_new", "person-ops"), NOW,
    );
    expect(result).toMatchObject({
      status: "preview",
      plan: {
        event: { kind: "binding-reassigned", revokedAdministratorGrantIds: ["operator-admin-org", "operator-admin-other-org"] },
      },
    });
    if (result.status !== "preview") throw new Error("Expected an administrator reassignment preview.");
    const committedModel = appendEvent(state, result.plan.event);
    expect(isContributionIdentityRegistry(committedModel)).toBe(true);
    expect(previewContributionIdentityOperation(
      await principal("user_new"), null, committedModel, observation(),
      {
        ...requestBase(committedModel), operationId: "post-reassignment-escalation", eventId: "post-reassignment-escalation-event",
        kind: "grant-administrator", grantId: "escalate", subject: "user_old", capabilities: ["bind"],
      },
      null, NOW,
    )).toMatchObject({ status: "denied", reason: "identity-admin-permission-required" });
  });

  it("blocks stale revisions and concurrent reuse instead of rebasing", async () => {
    const state = registry();
    const actor = await principal("user_ops");
    const input = bindRequest(state);
    const claim = await verifiedClaim("user_target", "person-target");
    const first = previewContributionIdentityOperation(actor, null, state, observation(), input, claim, NOW);
    expect(first.status).toBe("preview");
    if (first.status !== "preview") throw new Error("Expected first preview.");
    const afterCommitModel = appendEvent(state, first.plan.event);
    expect(previewContributionIdentityOperation(actor, null, afterCommitModel, observation(), input, claim, NOW))
      .toMatchObject({ status: "denied", reason: "stale-authority" });
    const currentRequest = { ...input, ...requestBase(afterCommitModel) };
    expect(previewContributionIdentityOperation(actor, null, afterCommitModel, observation(), {
      ...currentRequest, eventId: "fresh-event-for-reused-operation",
    }, claim, NOW)).toMatchObject({ status: "denied", reason: "identity-operation-reused" });
    expect(previewContributionIdentityOperation(actor, null, afterCommitModel, observation(), {
      ...currentRequest, operationId: "fresh-operation-for-reused-event",
    }, claim, NOW)).toMatchObject({ status: "denied", reason: "identity-operation-reused" });
    expect(previewContributionIdentityOperation(actor, null, state, {
      ...observation(), policyRevision: 11,
      tenantPolicyRevisions: [{ tenantId: ORG, revision: 11 }, { tenantId: OTHER_ORG, revision: 20 }],
    }, input, claim, NOW)).toMatchObject({ status: "denied", reason: "stale-authority" });
  });

  it("rejects revoked or missing tenant access and never accepts a forged second approver", async () => {
    const state = registry();
    const input = reassignRequest(state);
    const claim = await verifiedClaim("user_new", "person-staff");
    const actor = await principal("user_ops");
    const approver = await principal("user_reviewer");
    const revoked = {
      ...observation(),
      memberships: observation().memberships.map((entry) => entry.subject === "user_ops" && entry.tenantId === OTHER_ORG
        ? { ...entry, status: "revoked" as const } : entry),
    };
    expect(previewContributionIdentityOperation(actor, approver, state, revoked, input, claim, NOW))
      .toMatchObject({ status: "denied", reason: "identity-admin-permission-required" });
    expect(previewContributionIdentityOperation(actor, { subject: "user_reviewer" } as AuthenticatedPrincipal,
      state, observation(), input, claim, NOW)).toMatchObject({ status: "denied", reason: "independent-fresh-approval-required" });
  });
});
