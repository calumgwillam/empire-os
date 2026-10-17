import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./clerk-session-resolver", () => ({ resolveClerkSession: vi.fn() }));
vi.mock("pg", () => ({
  Pool: vi.fn(function () { throw new Error("Offline boundary tests must never construct a database pool."); }),
}));

import { Pool } from "pg";
import { resolveClerkSession } from "./clerk-session-resolver";
import type { AuthorizationSnapshot } from "./authorization-contract";
import {
  isContributionIdentityRegistry, resolveContributionIdentityBinding,
  type ContributionIdentityEvent, type ContributionIdentityRegistry, type IdentityPerson,
} from "./contribution-identity-authority";
import type { AuthorityRevocation } from "./durable-authorization-state";
import type { AuthorizationPostgresSource } from "./postgres-authorization-store";
import { createRestrictedPostgresProvider } from "./restricted-postgres-provider";
import { createServerPrincipalResolver, isAuthenticatedPrincipal } from "./server-persistence-authority";
import { EMPIRE_OS_BACKUP_STORAGE_KEYS } from "./backup";
import {
  type CommitResult, type DatasetSnapshot, type PersistenceProblem, type WriteBatch,
} from "./server-persistence-contract";
import {
  createTrustedMultiUserAuthority,
  type TrustedExecutionIdentity, type TrustedMultiUserAuthorityDependencies,
  type TrustedMultiUserRepository, type TrustedMultiUserTransaction,
} from "./trusted-multi-user-authority";

const TENANT = "tenant-a";
const SUBJECT = "user_staff";
const DATASET = "00000000-0000-4000-8000-000000000001";
const OTHER_DATASET = "00000000-0000-4000-8000-000000000002";
const NOW = 100_000;
const denied = { status: "unauthorized", reason: "forbidden" };
const request = (headers?: HeadersInit) => new Request("https://empire.invalid/internal", { method: "POST", headers });
const readInput = () => ({ datasetId: DATASET, protocolVersion: 1 });
const lookupInput = () => ({
  ...readInput(), generation: 1, idempotencyKey: "write:one", requestSha256: "a".repeat(64),
});
const fence = { datasetId: DATASET, protocolVersion: 1, generation: 1, authorityRevision: 0 } as const;
function writeInput(): WriteBatch {
  return { fence, idempotencyKey: "write:one", reads: [],
    writes: [{ key: EMPIRE_OS_BACKUP_STORAGE_KEYS[0], expectedRevision: 0, rawValue: "[]" }] };
}
function snapshot(): DatasetSnapshot {
  return { ...fence, commitSequence: 0,
    values: EMPIRE_OS_BACKUP_STORAGE_KEYS.map(key => ({ key, revision: 0, rawValue: null })) };
}
function registry(): ContributionIdentityRegistry {
  return {
    version: 1, revision: 1, bindingRevision: 1, policyRevision: 0,
    events: [{
      sequence: 1, eventId: "binding-event", previousEventId: null, operationId: "bind:staff",
      tenantId: TENANT, actorSubject: "user_admin", recordedAtMs: NOW - 100,
      kind: "subject-bound", bindingId: "staff-binding", subject: SUBJECT, personId: "person-staff",
      verificationId: "staff-verification", verifiedAtMs: NOW - 100,
    }],
  };
}
type MutableAuthorityFixture = {
  schemaVersion: 1;
  revocations: AuthorityRevocation[];
  snapshot: { -readonly [Key in keyof AuthorizationSnapshot]: AuthorizationSnapshot[Key] };
};
function state(): MutableAuthorityFixture {
  return {
    schemaVersion: 1, revocations: [],
    snapshot: {
      version: 1, revision: 1, tenant: { id: TENANT, status: "active", ownerSubjects: [] },
      datasets: [{ tenantId: TENANT, datasetId: DATASET }],
      memberships: [{ tenantId: TENANT, subject: SUBJECT, revision: 1, status: "active", roleIds: ["staff-role"] }],
      roles: [{
        id: "staff-role", tenantId: TENANT, revision: 1, status: "active",
        grants: [
          { id: "read-grant", datasetId: DATASET, capability: "read", delegable: true },
          { id: "write-grant", datasetId: DATASET, capability: "write", delegable: true },
        ],
      }],
      delegations: [],
    },
  };
}
function restrictedSource(principal: Parameters<TrustedMultiUserAuthorityDependencies["sourceForPrincipal"]>[0],
  tenantId = TENANT): AuthorizationPostgresSource {
  return createRestrictedPostgresProvider({
    principal, tenantId,
    config: {
      host: "offline.invalid", port: 5432, database: "offline_boundary_fixture", user: "staff_login",
      password: "offline-fixture-not-a-credential", ssl: { rejectUnauthorized: true },
    },
  }).sourceForPrincipal(principal);
}
async function principal(subject: string) {
  const value = await createServerPrincipalResolver(async () => ({ status: "authenticated", subject }))(request());
  if (!isAuthenticatedPrincipal(value)) throw new Error("Test principal unavailable.");
  return value;
}

function harness() {
  const current = {
    registry: registry() as unknown,
    authority: state(),
    people: [{ tenantId: TENANT, personId: "person-staff", status: "active", kind: "other" }] as IdentityPerson[],
    actor: SUBJECT,
    transactionTenant: TENANT,
    transactionDataset: undefined as string | undefined,
    clock: NOW,
    skipAuthorization: false,
    skipCompletion: false,
    loaderFailure: false,
    factoryFailure: false,
    throwDuringOperation: false,
    lostCommit: false,
    outcome: undefined as PersistenceProblem | undefined,
    beforeCompletion: undefined as (() => void) | undefined,
  };
  const identities: TrustedExecutionIdentity[] = [];
  const effects: string[] = [];
  const inputs: unknown[] = [];
  const transactions: TrustedMultiUserTransaction[] = [];
  const loadIdentityRegistry = vi.fn(async () => {
    if (current.loaderFailure) throw new Error("Private backend details");
    return current.registry;
  });
  const loadAuthority = vi.fn(async () => current.authority);
  const loadPeople = vi.fn(async () => current.people);
  const sourceForPrincipal = vi.fn<TrustedMultiUserAuthorityDependencies["sourceForPrincipal"]>(actor => restrictedSource(actor));
  const repositoryForExecution = vi.fn<TrustedMultiUserAuthorityDependencies["repositoryForExecution"]>(options => {
    if (current.factoryFailure) throw new Error("Private adapter details");
    async function run<Result>(input: unknown, result: Result, write = false): Promise<Result | PersistenceProblem> {
      inputs.push(input);
      if (current.throwDuringOperation) throw new Error("Private operation details");
      if (current.skipAuthorization) return result;
      const guards: (() => void)[] = [];
      const transaction: TrustedMultiUserTransaction = {
        actorSubject: current.actor, tenantId: current.transactionTenant,
        datasetId: current.transactionDataset ?? options.datasetId, loadIdentityRegistry, loadAuthority, loadPeople,
        nowMs: () => current.clock, beforeCommit: guard => { guards.push(guard); },
      };
      transactions.push(transaction);
      const authorized = await options.authorize(transaction);
      if (authorized.status !== "authorized") return authorized;
      identities.push(authorized);
      if (current.outcome) return current.outcome;
      current.beforeCompletion?.();
      if (!current.skipCompletion) {
        try { guards.forEach(guard => guard()); } catch {
          return { status: "failed", outcome: "rolled-back", message: "Mock transaction rolled back." };
        }
      }
      if (write) effects.push("atomic-write-and-audit");
      if (current.lostCommit) {
        return { status: "unavailable", outcome: "unknown", message: "Mock lost COMMIT acknowledgement." };
      }
      return result;
    }
    const repository: TrustedMultiUserRepository = {
      readSnapshot: input => run(input, { status: "snapshot", snapshot: snapshot() } as const),
      writeBatch: input => {
        const result: CommitResult = {
          status: "committed", replayed: false,
          receipt: { fence: input.fence, idempotencyKey: input.idempotencyKey, requestSha256: "a".repeat(64),
            transactionId: "test-transaction", commitSequence: 1, durability: "database-commit-confirmed",
            revisions: input.writes.map(entry => ({ key: entry.key, revision: entry.expectedRevision + 1 })) },
        };
        return run(input, result, true);
      },
      lookupCommit: input => run(input, { status: "unresolved", retry: "same-request-only" } as const),
    };
    return repository;
  });
  const authority = createTrustedMultiUserAuthority({ tenantId: TENANT, sourceForPrincipal, repositoryForExecution });
  return { authority, current, identities, effects, inputs, transactions,
    sourceForPrincipal, repositoryForExecution, loadIdentityRegistry, loadAuthority, loadPeople };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveClerkSession).mockResolvedValue({ status: "authenticated", subject: SUBJECT });
});
afterEach(() => { expect(Pool).not.toHaveBeenCalled(); });

describe("trusted multi-user authority (offline transaction model, no database)", () => {
  it.each(["readSnapshot", "writeBatch", "lookupCommit"] as const)("requires Clerk authentication for %s", async method => {
    const h = harness();
    vi.mocked(resolveClerkSession).mockResolvedValue({ status: "unauthenticated" });
    expect(await h.authority[method](request({ "x-user-id": SUBJECT, "x-role": "owner" }), {}))
      .toEqual({ status: "unauthorized", reason: "authentication-required" });
    expect(h.sourceForPrincipal).not.toHaveBeenCalled();
    expect(h.repositoryForExecution).not.toHaveBeenCalled();
  });

  it("does not consult injected authority when Clerk is unavailable", async () => {
    const h = harness();
    vi.mocked(resolveClerkSession).mockRejectedValue(new Error("Private Clerk failure"));
    expect(await h.authority.readSnapshot(request(), readInput())).toMatchObject({
      status: "unavailable", outcome: "not-submitted",
    });
    expect(h.sourceForPrincipal).not.toHaveBeenCalled();
  });

  it("rejects a malformed session subject before selecting storage", async () => {
    const h = harness();
    vi.mocked(resolveClerkSession).mockResolvedValue({ status: "authenticated", subject: " " });
    expect(await h.authority.readSnapshot(request(), readInput()))
      .toEqual({ status: "unauthorized", reason: "authentication-required" });
    expect(h.sourceForPrincipal).not.toHaveBeenCalled();
  });

  it("binds the verified principal, registry Person, tenant and existing policy revisions", async () => {
    const h = harness();
    expect(await h.authority.readSnapshot(request(), readInput())).toMatchObject({ status: "snapshot" });
    expect(h.identities).toEqual([{
      status: "authorized", subject: SUBJECT, personId: "person-staff", bindingId: "staff-binding",
      registryRevision: 1, bindingRevision: 1, tenantId: TENANT, policyRevision: 1, membershipRevision: 1,
    }]);
    expect(isAuthenticatedPrincipal(h.sourceForPrincipal.mock.calls[0][0])).toBe(true);
    expect(Pool).not.toHaveBeenCalled();
  });

  it("ignores spoofed identity, tenant and role headers", async () => {
    const h = harness();
    expect(await h.authority.readSnapshot(request({
      "x-user-id": "user_admin", "x-tenant-id": "tenant-b", "x-role": "owner",
    }), readInput())).toMatchObject({ status: "snapshot" });
    expect(h.identities[0].subject).toBe(SUBJECT);
    expect(h.identities[0].tenantId).toBe(TENANT);
  });

  it.each([
    { actorSubject: "user_admin" }, { tenantId: "tenant-b" }, { role: "owner" },
    { personId: "person-admin" }, { authorized: true },
  ])("rejects authority claims in request data: %j", async claims => {
    const h = harness();
    expect(await h.authority.readSnapshot(request(), { ...readInput(), ...claims }))
      .toMatchObject({ status: "invalid-request" });
    expect(h.sourceForPrincipal).not.toHaveBeenCalled();
  });

  it("rejects actor claims nested inside a write fence", async () => {
    const h = harness();
    expect(await h.authority.writeBatch(request(), {
      ...writeInput(), fence: { ...fence, actor: "user_admin" },
    })).toMatchObject({ status: "invalid-request" });
    expect(h.effects).toEqual([]);
  });

  it("denies an unknown subject without identifying which binding was missing", async () => {
    const h = harness();
    vi.mocked(resolveClerkSession).mockResolvedValue({ status: "authenticated", subject: "user_unknown" });
    h.current.actor = "user_unknown";
    expect(await h.authority.readSnapshot(request(), readInput())).toEqual(denied);
    expect(h.effects).toEqual([]);
  });

  it("replays revocation history instead of trusting an old bound event", async () => {
    const h = harness();
    expect(await h.authority.readSnapshot(request(), readInput())).toMatchObject({ status: "snapshot" });
    const original = registry();
    const revoked: ContributionIdentityEvent = {
      sequence: 2, eventId: "revoke-event", previousEventId: "binding-event", operationId: "revoke:staff",
      tenantId: TENANT, actorSubject: "user_admin", recordedAtMs: NOW - 10, kind: "binding-revoked",
      bindingId: "staff-binding", subject: SUBJECT, personId: "person-staff", justification: "Explicit revocation",
      revokedAdministratorGrantIds: [], approvedBySubject: null, approvedAtMs: null, approvedAuthenticatedAtMs: null,
    };
    h.current.registry = { ...original, revision: 2, bindingRevision: 2, events: [...original.events, revoked] };
    expect(isContributionIdentityRegistry(h.current.registry)).toBe(true);
    expect(resolveContributionIdentityBinding(h.current.registry, SUBJECT)).toBeNull();
    expect(await h.authority.writeBatch(request(), writeInput())).toEqual(denied);
    expect(h.effects).toEqual([]);
  });

  it.each(["duplicate-subject", "duplicate-person", "broken-history", "future-event"] as const)(
    "rejects an ambiguous or invalid identity registry: %s", async corruption => {
      const h = harness();
      const original = registry();
      const first = original.events[0];
      if (first.kind !== "subject-bound") throw new Error("Invalid test fixture.");
      const second = { ...first, sequence: 2, eventId: "another-event", previousEventId: first.eventId,
        operationId: "another-operation", bindingId: "another-binding",
        subject: corruption === "duplicate-person" ? "user_other" : SUBJECT };
      h.current.registry = corruption === "future-event"
        ? { ...original, events: [{ ...first, recordedAtMs: NOW + 1 }] }
        : corruption === "broken-history"
          ? { ...original, revision: 9 }
          : { ...original, revision: 2, bindingRevision: 2, events: [first, second] };
      expect(await h.authority.readSnapshot(request(), readInput())).toEqual(denied);
    },
  );

  it.each(["missing", "inactive", "duplicate", "wrong-tenant"] as const)(
    "requires an unambiguous authoritative Person: %s", async kind => {
      const h = harness();
      if (kind === "missing") h.current.people = [];
      if (kind === "inactive") h.current.people = [{ ...h.current.people[0], status: "inactive" }];
      if (kind === "duplicate") h.current.people.push({ ...h.current.people[0] });
      if (kind === "wrong-tenant") h.current.people = [{ ...h.current.people[0], tenantId: "tenant-b" }];
      expect(await h.authority.readSnapshot(request(), readInput())).toEqual(denied);
    },
  );

  it("denies cross-tenant policy state", async () => {
    const h = harness();
    h.current.authority.snapshot = { ...state().snapshot,
      tenant: { id: "tenant-b", status: "active", ownerSubjects: [] },
      datasets: [{ tenantId: "tenant-b", datasetId: DATASET }],
      memberships: [{ tenantId: "tenant-b", subject: SUBJECT, revision: 1, status: "active", roleIds: [] }],
      roles: [],
    };
    expect(await h.authority.readSnapshot(request(), readInput())).toEqual(denied);
  });

  it("does not distinguish an unmapped dataset from missing permission", async () => {
    const h = harness();
    expect(await h.authority.readSnapshot(request(), { ...readInput(), datasetId: OTHER_DATASET })).toEqual(denied);
    h.current.authority.snapshot.roles = [];
    h.current.authority.snapshot.memberships = [
      { tenantId: TENANT, subject: SUBJECT, revision: 1, status: "active", roleIds: [] },
    ];
    expect(await h.authority.readSnapshot(request(), readInput())).toEqual(denied);
  });

  it("checks current membership even for an owner", async () => {
    const h = harness();
    h.current.authority.snapshot.tenant = { id: TENANT, status: "active", ownerSubjects: [SUBJECT] };
    h.current.authority.snapshot.memberships = [
      { tenantId: TENANT, subject: SUBJECT, revision: 2, status: "revoked", roleIds: ["staff-role"] },
    ];
    h.current.authority.snapshot.revision = 2;
    h.current.authority.revocations = [
      { kind: "membership", id: SUBJECT, operationId: "revoke:member", policyRevision: 2, revokedAt: NOW - 1 },
    ];
    expect(await h.authority.readSnapshot(request(), readInput())).toEqual(denied);
  });

  it.each(["missing-membership", "revoked-tenant"] as const)("denies %s", async kind => {
    const h = harness();
    if (kind === "missing-membership") h.current.authority.snapshot.memberships = [];
    if (kind === "revoked-tenant") {
      h.current.authority.snapshot.tenant = { id: TENANT, status: "revoked", ownerSubjects: [] };
    }
    expect(await h.authority.readSnapshot(request(), readInput())).toEqual(denied);
    expect(h.effects).toEqual([]);
  });

  it("does not infer identity from founder ownership", async () => {
    const h = harness();
    h.current.registry = { version: 1, revision: 0, bindingRevision: 0, policyRevision: 0, events: [] };
    h.current.authority.snapshot.tenant = { id: TENANT, status: "active", ownerSubjects: [SUBJECT] };
    expect(await h.authority.readSnapshot(request(), readInput())).toEqual(denied);
  });

  it("rechecks permission changes on every successive transaction", async () => {
    const h = harness();
    expect(await h.authority.writeBatch(request(), writeInput())).toMatchObject({ status: "committed" });
    h.current.authority.snapshot.revision = 2;
    h.current.authority.snapshot.roles = h.current.authority.snapshot.roles.map(role => ({
      ...role, revision: 2, grants: role.grants.filter(grant => grant.capability === "read"),
    }));
    expect(await h.authority.writeBatch(request(), writeInput())).toEqual(denied);
    expect(await h.authority.readSnapshot(request(), readInput())).toMatchObject({ status: "snapshot" });
    expect(h.loadIdentityRegistry).toHaveBeenCalledTimes(3);
    expect(h.loadAuthority).toHaveBeenCalledTimes(3);
    expect(h.effects).toEqual(["atomic-write-and-audit"]);
  });

  it("requires read permission as well as write for full-candidate validation", async () => {
    const h = harness();
    h.current.authority.snapshot.roles = h.current.authority.snapshot.roles.map(role => ({
      ...role, grants: role.grants.filter(grant => grant.capability === "write"),
    }));
    expect(await h.authority.writeBatch(request(), writeInput())).toEqual(denied);
    expect(h.effects).toEqual([]);
  });

  it("preserves the exact idempotency key, input and committed receipt", async () => {
    const h = harness();
    const input = writeInput();
    const result = await h.authority.writeBatch(request(), input);
    expect(result).toMatchObject({
      status: "committed", replayed: false,
      receipt: { idempotencyKey: input.idempotencyKey, durability: "database-commit-confirmed" },
    });
    expect(h.inputs).toEqual([input]);
    expect(h.effects).toEqual(["atomic-write-and-audit"]);
  });

  it("re-authorizes reconciliation and keeps an unresolved lookup unresolved", async () => {
    const h = harness();
    expect(await h.authority.lookupCommit(request(), lookupInput()))
      .toEqual({ status: "unresolved", retry: "same-request-only" });
    h.current.authority.snapshot.roles = h.current.authority.snapshot.roles.map(role => ({
      ...role, revision: 2, grants: role.grants.filter(grant => grant.capability === "read"),
    }));
    expect(await h.authority.lookupCommit(request(), lookupInput())).toEqual(denied);
    expect(h.effects).toEqual([]);
  });

  it("does not add a read-capability requirement to a write-authorized lookup", async () => {
    const h = harness();
    h.current.authority.snapshot.roles = h.current.authority.snapshot.roles.map(role => ({
      ...role, grants: role.grants.filter(grant => grant.capability === "write"),
    }));
    expect(await h.authority.lookupCommit(request(), lookupInput()))
      .toEqual({ status: "unresolved", retry: "same-request-only" });
    expect(h.effects).toEqual([]);
  });

  it.each(["unbranded", "wrong-tenant", "wrong-subject"] as const)(
    "rejects a source not bound to this principal and tenant: %s", async kind => {
      const h = harness();
      if (kind === "unbranded") h.sourceForPrincipal.mockReturnValue({ connect: vi.fn() });
      if (kind === "wrong-tenant") h.sourceForPrincipal.mockImplementation(actor => restrictedSource(actor, "tenant-b"));
      if (kind === "wrong-subject") {
        const other = await principal("user_other");
        h.sourceForPrincipal.mockReturnValue(restrictedSource(other));
      }
      expect(await h.authority.readSnapshot(request(), readInput())).toEqual(denied);
      expect(h.repositoryForExecution).not.toHaveBeenCalled();
    },
  );

  it("rejects a mismatched transaction actor even with a branded source", async () => {
    const h = harness();
    h.current.actor = "user_admin";
    expect(await h.authority.readSnapshot(request(), readInput())).toEqual(denied);
    expect(h.loadIdentityRegistry).not.toHaveBeenCalled();
  });

  it.each(["tenant", "dataset"] as const)("rejects a transaction bound to another %s", async scope => {
    const h = harness();
    if (scope === "tenant") h.current.transactionTenant = "tenant-b";
    if (scope === "dataset") h.current.transactionDataset = OTHER_DATASET;
    expect(await h.authority.readSnapshot(request(), readInput())).toEqual(denied);
    expect(h.loadIdentityRegistry).not.toHaveBeenCalled();
  });

  it.each(["source", "factory", "identity-loader"] as const)("fails closed on %s failure", async stage => {
    const h = harness();
    if (stage === "source") h.sourceForPrincipal.mockImplementation(() => { throw new Error("Private configuration"); });
    if (stage === "factory") h.current.factoryFailure = true;
    if (stage === "identity-loader") h.current.loaderFailure = true;
    expect(await h.authority.readSnapshot(request(), readInput())).toEqual({
      status: "unavailable", outcome: "not-submitted", message: "Trusted execution authority is unavailable.",
    });
    expect(h.effects).toEqual([]);
    expect(Pool).not.toHaveBeenCalled();
  });

  it.each(["policy", "People"] as const)("fails closed when the %s loader throws", async kind => {
    const h = harness();
    if (kind === "policy") h.loadAuthority.mockRejectedValue(new Error("Private policy backend error"));
    if (kind === "People") h.loadPeople.mockRejectedValue(new Error("Private People backend error"));
    expect(await h.authority.writeBatch(request(), writeInput())).toEqual({
      status: "unavailable", outcome: "not-submitted", message: "Trusted execution authority is unavailable.",
    });
    expect(h.effects).toEqual([]);
  });

  it.each([false, true])("does not claim rollback for a thrown operation (write=%s)", async write => {
    const h = harness();
    h.current.throwDuringOperation = true;
    const result = write ? await h.authority.writeBatch(request(), writeInput())
      : await h.authority.readSnapshot(request(), readInput());
    expect(result).toMatchObject({ status: "unavailable", outcome: write ? "unknown" : "not-submitted" });
  });

  it("preserves an unknown COMMIT outcome and never resubmits", async () => {
    const h = harness();
    h.current.lostCommit = true;
    expect(await h.authority.writeBatch(request(), writeInput())).toEqual({
      status: "unavailable", outcome: "unknown", message: "Mock lost COMMIT acknowledgement.",
    });
    expect(h.effects).toEqual(["atomic-write-and-audit"]);
    expect(h.inputs).toHaveLength(1);
  });

  it("preserves a confirmed rollback without creating a receipt", async () => {
    const h = harness();
    h.current.outcome = { status: "failed", outcome: "rolled-back", message: "Mock atomic rollback." };
    expect(await h.authority.writeBatch(request(), writeInput())).toEqual(h.current.outcome);
    expect(h.effects).toEqual([]);
  });

  it.each(["readSnapshot", "writeBatch"] as const)("suppresses results from an unguarded adapter: %s", async method => {
    const h = harness();
    h.current.skipAuthorization = true;
    const result = method === "readSnapshot" ? await h.authority.readSnapshot(request(), readInput())
      : await h.authority.writeBatch(request(), writeInput());
    expect(result).toMatchObject({ status: "unavailable",
      outcome: method === "writeBatch" ? "unknown" : "not-submitted" });
  });

  it("requires the completion guard before disclosing data", async () => {
    const h = harness();
    h.current.skipCompletion = true;
    expect(await h.authority.readSnapshot(request(), readInput()))
      .toMatchObject({ status: "unavailable", outcome: "not-submitted" });
  });

  it("does not let retained transaction callbacks authorize a later execution", async () => {
    const h = harness();
    expect(await h.authority.readSnapshot(request(), readInput())).toMatchObject({ status: "snapshot" });
    const installed = h.repositoryForExecution.mock.calls[0][0];
    const loads = h.loadIdentityRegistry.mock.calls.length;
    expect(await installed.authorize(h.transactions[0])).toEqual(denied);
    expect(h.loadIdentityRegistry).toHaveBeenCalledTimes(loads);
  });

  it("rejects reusing one transaction object for another authorization check", async () => {
    const h = harness();
    h.current.beforeCompletion = () => {
      const installed = h.repositoryForExecution.mock.calls[0][0];
      void installed.authorize(h.transactions[0]);
    };
    expect(await h.authority.readSnapshot(request(), readInput())).toEqual(denied);
    expect(h.loadIdentityRegistry).toHaveBeenCalledTimes(1);
  });

  it("rechecks delegated expiry at the adapter completion boundary", async () => {
    const h = harness();
    const policy = h.current.authority.snapshot;
    policy.memberships = [
      { ...policy.memberships[0], roleIds: [] },
      { tenantId: TENANT, subject: "user_manager", revision: 1, status: "active", roleIds: ["staff-role"] },
    ];
    policy.delegations = [{
      id: "read-delegation", tenantId: TENANT, datasetId: DATASET, issuerSubject: "user_manager",
      recipientSubject: SUBJECT, capability: "read", sourceRoleId: "staff-role", sourceGrantId: "read-grant",
      sourceRoleRevision: 1, issuerMembershipRevision: 1, recipientMembershipRevision: 1,
      issuedAt: NOW - 10, expiresAt: NOW + 1, status: "active",
    }];
    h.current.beforeCompletion = () => { h.current.clock = NOW + 1; };
    expect(await h.authority.readSnapshot(request(), readInput())).toEqual(denied);
    expect(h.effects).toEqual([]);
  });

  it("rejects a backwards completion clock", async () => {
    const h = harness();
    h.current.beforeCompletion = () => { h.current.clock = NOW - 1; };
    expect(await h.authority.writeBatch(request(), writeInput())).toEqual(denied);
    expect(h.effects).toEqual([]);
  });

  it("rejects invalid configured tenant scope synchronously", () => {
    const h = harness();
    expect(() => createTrustedMultiUserAuthority({
      tenantId: " ", sourceForPrincipal: h.sourceForPrincipal, repositoryForExecution: h.repositoryForExecution,
    })).toThrow("Invalid trusted execution tenant.");
  });
});
