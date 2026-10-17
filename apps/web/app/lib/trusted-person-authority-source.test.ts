import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./clerk-session-resolver", () => ({ resolveClerkSession: vi.fn() }));
vi.mock("pg", () => ({
  Pool: vi.fn(function () { throw new Error("Offline authority-source tests cannot open PostgreSQL."); }),
}));

import { Pool } from "pg";
import { EMPIRE_OS_BACKUP_STORAGE_KEYS } from "./backup";
import { resolveClerkSession } from "./clerk-session-resolver";
import {
  isContributionIdentityRegistry, resolveContributionIdentityBinding,
  type ContributionIdentityEvent, type ContributionIdentityRegistry, type IdentityPerson,
} from "./contribution-identity-authority";
import type { DurableAuthorityState } from "./durable-authorization-state";
import { memberAuthorityRelease } from "./member-authority-release";
import { employeeProvisioningRelease } from "./employee-provisioning-release";
import { createServerPrincipalResolver, isAuthenticatedPrincipal } from "./server-persistence-authority";
import { createTrustedMultiUserAuthority } from "./trusted-multi-user-authority";
import {
  PERSON_AUTHORITY_MISSING_DEPENDENCIES, trustedPersonAuthoritySourceProblem,
  validateCandidatePersonAuthorityEvidence,
  type PersonAuthorityCheckpoint, type PersonEligibilityEvent,
} from "./trusted-person-authority-source";

const TENANT = "tenant-a";
const DATASET = "00000000-0000-4000-8000-000000000001";
const SUBJECT = "user_staff";
const FOUNDER = "user_founder";
const NOW = 100_000;
const request = () => new Request("https://empire.invalid/internal");
const denied = { status: "unauthorized", reason: "forbidden" };
function checkpoint(): PersonAuthorityCheckpoint {
  return {
    tenantId: TENANT, datasetId: DATASET, nowMs: NOW, founderSubject: FOUNDER,
    registryRevision: 1, bindingRevision: 1, personRevision: 1, policyRevision: 1, membershipRevision: 1,
  };
}
function evidence(): {
  registry: ContributionIdentityRegistry;
  authority: DurableAuthorityState;
  person: IdentityPerson;
  eligibility: PersonEligibilityEvent;
} {
  return {
    registry: {
      version: 1, revision: 1, bindingRevision: 1, policyRevision: 0,
      events: [{
        sequence: 1, eventId: "bind-event", previousEventId: null, operationId: "bind:staff",
        tenantId: TENANT, actorSubject: FOUNDER, recordedAtMs: NOW - 100,
        kind: "subject-bound", bindingId: "staff-binding", subject: SUBJECT, personId: "person-staff",
        verificationId: "verified-staff", verifiedAtMs: NOW - 100,
      }],
    },
    authority: {
      schemaVersion: 1, revocations: [],
      snapshot: {
        version: 1, revision: 1, tenant: { id: TENANT, status: "active", ownerSubjects: [] },
        datasets: [{ tenantId: TENANT, datasetId: DATASET }],
        memberships: [{ tenantId: TENANT, subject: SUBJECT, revision: 1, status: "active", roleIds: ["staff"] }],
        roles: [{
          id: "staff", tenantId: TENANT, revision: 1, status: "active",
          grants: [{ id: "read", datasetId: DATASET, capability: "read", delegable: false }],
        }],
        delegations: [],
      },
    },
    person: { tenantId: TENANT, personId: "person-staff", status: "active", kind: "other" },
    eligibility: {
      tenantId: TENANT, personId: "person-staff", revision: 1, status: "active", kind: "other",
      operationId: "eligibility:staff", issuerSubject: FOUNDER, sourceReference: "verified-source",
      evidenceSha256: "a".repeat(64), recordedAtMs: NOW - 50,
    },
  };
}
async function principal() {
  const actor = await createServerPrincipalResolver(async () => ({
    status: "authenticated", subject: SUBJECT,
  }))(request());
  if (!isAuthenticatedPrincipal(actor)) throw new Error("Missing synthetic principal.");
  return actor;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveClerkSession).mockResolvedValue({ status: "authenticated", subject: SUBJECT });
});
afterEach(() => expect(Pool).not.toHaveBeenCalled());

describe("dormant Person authority-source consistency contract", () => {
  it("validates synthetic evidence without returning an authorization grant or changing evidence", async () => {
    const input = evidence();
    const original = structuredClone(input);
    const result = validateCandidatePersonAuthorityEvidence(await principal(), checkpoint(), input);
    expect(result).toEqual({
      status: "valid",
      value: {
        subject: SUBJECT, personId: "person-staff", bindingId: "staff-binding",
        registryRevision: 1, bindingRevision: 1, personRevision: 1, tenantId: TENANT,
        policyRevision: 1, membershipRevision: 1,
      },
    });
    expect(input).toEqual(original);
    expect(trustedPersonAuthoritySourceProblem()).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
  });
  it.each([null, { subject: SUBJECT }, { status: "authenticated", subject: SUBJECT }])(
    "rejects unbranded browser or caller identity: %j", actor => {
      expect(validateCandidatePersonAuthorityEvidence(actor, checkpoint(), evidence()))
        .toEqual({ status: "unauthorized", reason: "authentication-required" });
    },
  );
  it.each([undefined, null, {}, { personId: "person-staff", name: "Founder", active: true }])(
    "rejects missing or browser-local People evidence: %j", async person => {
      expect(validateCandidatePersonAuthorityEvidence(await principal(), checkpoint(), { ...evidence(), person })).toEqual(denied);
    },
  );
  it.each([
    { status: "inactive" }, { tenantId: "tenant-b" }, { personId: "person-other" }, { kind: "founder" },
  ])("rejects inactive or inconsistent Person: %j", async change => {
    const input = evidence();
    expect(validateCandidatePersonAuthorityEvidence(await principal(), checkpoint(), {
      ...input, person: { ...input.person, ...change },
    })).toEqual(denied);
  });
  it.each([null, undefined, {}, { ...evidence().person }])("requires an explicit eligibility audit event: %j", async eligibility => {
    expect(validateCandidatePersonAuthorityEvidence(await principal(), checkpoint(), {
      ...evidence(), eligibility,
    })).toEqual(denied);
  });
  it("rejects missing bindings rather than inferring identity from an active Person", async () => {
    expect(validateCandidatePersonAuthorityEvidence(await principal(), checkpoint(), {
      ...evidence(), registry: { version: 1, revision: 0, bindingRevision: 0, policyRevision: 0, events: [] },
    })).toEqual(denied);
  });
  it("rejects future identity events independently of eligibility freshness", async () => {
    const input = evidence();
    input.registry = { ...input.registry, events: input.registry.events.map(event => ({ ...event, recordedAtMs: NOW + 1 })) };
    expect(validateCandidatePersonAuthorityEvidence(await principal(), checkpoint(), input)).toEqual(denied);
  });
  it.each([
    { status: "inactive" }, { tenantId: "tenant-b" }, { personId: "person-other" },
    { revision: 0 }, { revision: 2 }, { revision: "1" }, { issuerSubject: "user_other" },
    { issuerSubject: "" }, { sourceReference: "" }, { evidenceSha256: "invalid" },
    { recordedAtMs: NOW + 1 }, { operationId: "" }, { kind: "founder" }, { approved: true },
  ])("rejects stale, unissued or inconsistent eligibility: %j", async change => {
    const input = evidence();
    expect(validateCandidatePersonAuthorityEvidence(await principal(), checkpoint(), {
      ...input, eligibility: { ...input.eligibility, ...change },
    })).toEqual(denied);
  });
  it.each([
    { registryRevision: 2 }, { bindingRevision: 2 }, { personRevision: 2 },
    { policyRevision: 2 }, { membershipRevision: 2 }, { founderSubject: "user_rotated_founder" },
    { tenantId: "tenant-b" }, { datasetId: "00000000-0000-4000-8000-000000000002" },
    { personRevision: 0 }, { nowMs: -1 }, { approved: true },
  ])("rejects stale checkpoints, issuer rotation or wrong scope: %j", async change => {
    expect(validateCandidatePersonAuthorityEvidence(await principal(), { ...checkpoint(), ...change }, evidence())).toEqual(denied);
  });
  it("rejects a binding originating in another tenant even when Person and membership match", async () => {
    const input = evidence();
    input.registry = { ...input.registry, events: input.registry.events.map(event => ({ ...event, tenantId: "tenant-b" })) };
    expect(validateCandidatePersonAuthorityEvidence(await principal(), checkpoint(), input)).toEqual(denied);
  });
  it("rejects revoked and reassigned identities using the existing registry projection", async () => {
    const input = evidence();
    const base = {
      sequence: 2, eventId: "revoke-event", previousEventId: "bind-event", operationId: "revoke:staff",
      tenantId: TENANT, actorSubject: FOUNDER, recordedAtMs: NOW - 10,
    };
    for (const event of [
      { ...base, kind: "binding-revoked" as const, bindingId: "staff-binding", subject: SUBJECT,
        personId: "person-staff", justification: "Revoked", revokedAdministratorGrantIds: [],
        approvedBySubject: null, approvedAtMs: null, approvedAuthenticatedAtMs: null },
      { ...base, kind: "binding-reassigned" as const, previousBindingId: "staff-binding",
        previousSubject: SUBJECT, previousPersonId: "person-staff", bindingId: "new-binding",
        subject: "user_replacement", personId: "person-staff", verificationId: "replacement-verification",
        verifiedAtMs: NOW - 20, justification: "Reassigned", revokedAdministratorGrantIds: [],
        approvedBySubject: "user_independent", approvedAtMs: NOW - 15, approvedAuthenticatedAtMs: NOW - 20 },
    ]) {
      const registry = { ...input.registry, revision: 2, bindingRevision: 2, events: [...input.registry.events, event] };
      expect(validateCandidatePersonAuthorityEvidence(await principal(), {
        ...checkpoint(), registryRevision: 2, bindingRevision: 2,
      }, { ...input, registry })).toEqual(denied);
    }
  });
  it.each(["binding-revoked", "binding-reassigned"] as const)(
    "uses the new binding event after %s and rebinding, not the original tenant", async kind => {
      const input = evidence();
      const original = input.registry.events[0];
      if (original.kind !== "subject-bound") throw new Error("Expected synthetic binding.");
      const base = {
        sequence: 2, eventId: "transition", previousEventId: original.eventId, operationId: "transition:staff",
        tenantId: "tenant-b", actorSubject: FOUNDER, recordedAtMs: NOW - 20,
      };
      const transition: ContributionIdentityEvent = kind === "binding-revoked"
        ? { ...base, kind, bindingId: original.bindingId, subject: SUBJECT, personId: original.personId,
          justification: "Revoked", revokedAdministratorGrantIds: [],
          approvedBySubject: null, approvedAtMs: null, approvedAuthenticatedAtMs: null }
        : { ...base, kind, previousBindingId: original.bindingId, previousSubject: SUBJECT,
          previousPersonId: original.personId, bindingId: "replacement-binding", subject: "user_replacement",
          personId: "person-replacement", verificationId: "replacement-verification", verifiedAtMs: NOW - 30,
          justification: "Reassigned", revokedAdministratorGrantIds: [], approvedBySubject: "user_independent",
          approvedAtMs: NOW - 25, approvedAuthenticatedAtMs: NOW - 30 };
      const rebound: ContributionIdentityEvent = {
        ...original, sequence: 3, eventId: "rebound", previousEventId: transition.eventId,
        operationId: "rebind:staff", bindingId: "rebound-binding", tenantId: "tenant-b", recordedAtMs: NOW - 10,
      };
      input.registry = {
        ...input.registry, revision: 3, bindingRevision: 3,
        events: [original, transition, rebound],
      };
      expect(isContributionIdentityRegistry(input.registry)).toBe(true);
      expect(resolveContributionIdentityBinding(input.registry, SUBJECT)?.bindingId).toBe("rebound-binding");
      const current = { ...checkpoint(), registryRevision: 3, bindingRevision: 3 };
      // Original event matches tenant-a, but current binding originates in tenant-b.
      expect(validateCandidatePersonAuthorityEvidence(await principal(), current, input)).toEqual(denied);
      input.registry = { ...input.registry, events: [
        original, transition, { ...rebound, tenantId: TENANT },
      ] };
      expect(validateCandidatePersonAuthorityEvidence(await principal(), current, input).status).toBe("valid");
      input.registry = { ...input.registry, events: [
        original, transition, { ...rebound, bindingId: original.bindingId },
      ] };
      expect(isContributionIdentityRegistry(input.registry)).toBe(false);
      expect(resolveContributionIdentityBinding(input.registry, SUBJECT)).toBeNull();
      expect(validateCandidatePersonAuthorityEvidence(await principal(), current, input)).toEqual(denied);
    },
  );
  it("resolves a replacement subject to the reassignment event rather than its previous binding", async () => {
    const input = evidence();
    const original = input.registry.events[0];
    if (original.kind !== "subject-bound") throw new Error("Expected synthetic binding.");
    const replacement: ContributionIdentityEvent = {
      sequence: 2, eventId: "reassign", previousEventId: original.eventId, operationId: "reassign:staff",
      tenantId: "tenant-b", actorSubject: FOUNDER, recordedAtMs: NOW - 10,
      kind: "binding-reassigned", previousBindingId: original.bindingId, previousSubject: SUBJECT,
      previousPersonId: original.personId, bindingId: "replacement-binding", subject: "user_replacement",
      personId: original.personId, verificationId: "replacement-verification", verifiedAtMs: NOW - 30,
      justification: "Reassigned", revokedAdministratorGrantIds: [], approvedBySubject: "user_independent",
      approvedAtMs: NOW - 20, approvedAuthenticatedAtMs: NOW - 30,
    };
    input.registry = { ...input.registry, revision: 2, bindingRevision: 2, events: [original, replacement] };
    input.authority = {
      ...input.authority, snapshot: {
        ...input.authority.snapshot,
        memberships: input.authority.snapshot.memberships.map(member => ({ ...member, subject: "user_replacement" })),
      },
    };
    const actor = await createServerPrincipalResolver(async () => ({
      status: "authenticated", subject: "user_replacement",
    }))(request());
    expect(isContributionIdentityRegistry(input.registry)).toBe(true);
    expect(resolveContributionIdentityBinding(input.registry, SUBJECT)).toBeNull();
    expect(resolveContributionIdentityBinding(input.registry, "user_replacement")?.bindingId).toBe("replacement-binding");
    const current = { ...checkpoint(), registryRevision: 2, bindingRevision: 2 };
    expect(validateCandidatePersonAuthorityEvidence(actor, current, input)).toEqual(denied);
    input.registry = { ...input.registry, events: [original, { ...replacement, tenantId: TENANT }] };
    expect(validateCandidatePersonAuthorityEvidence(actor, current, input).status).toBe("valid");
  });
  it("demonstrates matching founder and issuer claims are consistency only, never authenticated provenance", async () => {
    const input = evidence();
    input.eligibility = { ...input.eligibility, issuerSubject: "user_fabricated_founder" };
    expect(validateCandidatePersonAuthorityEvidence(await principal(), {
      ...checkpoint(), founderSubject: "user_fabricated_founder",
    }, input).status).toBe("valid");
    // Even jointly fabricated matching claims cannot approve the real source.
    expect(trustedPersonAuthoritySourceProblem()).toMatchObject({
      status: "unavailable", outcome: "not-submitted",
    });
    const sourceForPrincipal = vi.fn();
    const repositoryForExecution = vi.fn();
    const authority = createTrustedMultiUserAuthority({ tenantId: TENANT, sourceForPrincipal, repositoryForExecution });
    expect(await authority.readSnapshot(request(), { datasetId: DATASET, protocolVersion: 1 }))
      .toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(sourceForPrincipal).not.toHaveBeenCalled();
    expect(repositoryForExecution).not.toHaveBeenCalled();
  });
  it("requires active membership with retained revocation evidence", async () => {
    const input = evidence();
    input.authority = {
      ...input.authority,
      snapshot: { ...input.authority.snapshot, memberships: input.authority.snapshot.memberships.map(member => ({
        ...member, status: "revoked", revision: 2,
      })) },
      revocations: [{ kind: "membership", id: SUBJECT, operationId: "revoke:member", policyRevision: 1, revokedAt: NOW - 1 }],
    };
    expect(validateCandidatePersonAuthorityEvidence(await principal(), {
      ...checkpoint(), membershipRevision: 2,
    }, input)).toEqual(denied);
  });
  it("rejects missing membership and revoked tenants", async () => {
    const input = evidence();
    for (const snapshot of [
      { ...input.authority.snapshot, memberships: [] },
      { ...input.authority.snapshot, tenant: { ...input.authority.snapshot.tenant, status: "revoked" as const } },
    ]) {
      expect(validateCandidatePersonAuthorityEvidence(await principal(), checkpoint(), {
        ...input, authority: { ...input.authority, snapshot },
      })).toEqual(denied);
    }
  });
  it("does not turn eligibility or founder labels into operation permission", async () => {
    const input = evidence();
    expect(validateCandidatePersonAuthorityEvidence(await principal(), checkpoint(), input, "write")).toEqual(denied);
    input.person = { ...input.person, kind: "founder" };
    input.eligibility = { ...input.eligibility, kind: "founder" };
    expect(validateCandidatePersonAuthorityEvidence(await principal(), checkpoint(), input, "import")).toEqual(denied);
  });
  it.each([null, {}, { ...checkpoint(), founderSubject: undefined }])("fails closed on missing checkpoint: %j", async current => {
    expect(validateCandidatePersonAuthorityEvidence(await principal(), current, evidence())).toEqual(denied);
  });
});

describe("real unresolved-source execution interlock (no source mock)", () => {
  it.each(["readSnapshot", "writeBatch", "lookupCommit"] as const)(
    "blocks %s before selecting a source, connecting or invoking a business repository", async method => {
      const sourceForPrincipal = vi.fn(() => { throw new Error("Unavailable backend must not be reached."); });
      const repositoryForExecution = vi.fn(() => { throw new Error("No business writes permitted."); });
      const authority = createTrustedMultiUserAuthority({ tenantId: TENANT, sourceForPrincipal, repositoryForExecution });
      const input = method === "readSnapshot" ? { datasetId: DATASET, protocolVersion: 1 }
        : method === "lookupCommit" ? { datasetId: DATASET, protocolVersion: 1, generation: 1,
          idempotencyKey: "operation:one", requestSha256: "a".repeat(64) }
          : { fence: { datasetId: DATASET, protocolVersion: 1, generation: 1, authorityRevision: 0 },
            idempotencyKey: "operation:one", reads: [],
            writes: [{ key: EMPIRE_OS_BACKUP_STORAGE_KEYS[0], expectedRevision: 0, rawValue: "[]" }] };
      const result = await authority[method](request(), input);
      expect(result).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
      expect(result).toHaveProperty("message", expect.stringContaining(PERSON_AUTHORITY_MISSING_DEPENDENCIES[0]));
      expect(sourceForPrincipal).not.toHaveBeenCalled();
      expect(repositoryForExecution).not.toHaveBeenCalled();
    },
  );
  it("preserves authentication refusal before reporting source readiness", async () => {
    vi.mocked(resolveClerkSession).mockResolvedValue({ status: "unauthenticated" });
    const sourceForPrincipal = vi.fn();
    const repositoryForExecution = vi.fn();
    const authority = createTrustedMultiUserAuthority({ tenantId: TENANT, sourceForPrincipal, repositoryForExecution });
    expect(await authority.readSnapshot(request(), { datasetId: DATASET, protocolVersion: 1 }))
      .toEqual({ status: "unauthorized", reason: "authentication-required" });
    expect(sourceForPrincipal).not.toHaveBeenCalled();
  });
  it("keeps member and provisioning releases disabled and exports no issuer", () => {
    expect(memberAuthorityRelease().status).toBe("disabled");
    expect(employeeProvisioningRelease().status).toBe("disabled");
    expect(PERSON_AUTHORITY_MISSING_DEPENDENCIES).toHaveLength(3);
    expect(Object.isFrozen(PERSON_AUTHORITY_MISSING_DEPENDENCIES)).toBe(true);
  });
});
