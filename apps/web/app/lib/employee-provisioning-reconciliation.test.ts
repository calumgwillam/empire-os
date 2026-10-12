import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./clerk-session-resolver", () => ({ resolveClerkSession: vi.fn() }));
const release = vi.hoisted(() => ({ approved: false }));
vi.mock("./employee-provisioning-release", async importOriginal => {
  const original = await importOriginal<typeof import("./employee-provisioning-release")>();
  return { employeeProvisioningRelease: () => release.approved
    ? { status: "approved", migrationVersion: 5 } : original.employeeProvisioningRelease() };
});
import { auditDecisionId } from "./authorization-transaction";
import type { OperationLookupStoreResult, OperationReconciliationStore } from "./authorization-transaction-contract";
import type { DurableAuthorityState } from "./durable-authorization-state";
import { employeeProvisioningRequest } from "./employee-provisioning-contract";
import { createEmployeeProvisioningReconciler } from "./employee-provisioning-reconciliation";
import { createServerPrincipalResolver, isAuthenticatedPrincipal } from "./server-persistence-authority";
import { createServerEmployeeProvisioningReconciliation } from "./server-employee-provisioning-reconciliation";
import { createClerkEmployeeProvisioningReconciliation } from "./clerk-employee-provisioning-reconciliation";
import { resolveClerkSession } from "./clerk-session-resolver";

const actor = "user_founder";
const tenant = "tenant-a";
const dataset = "00000000-0000-4000-8000-000000000001";
const transaction = "00000000-0000-4000-8000-000000000002";
const original = { operationId: "provision:one", expectedPolicyRevision: 1, subject: "user_employee", roleIds: ["operator"] };
const hash = createHash("sha256").update(JSON.stringify(employeeProvisioningRequest(tenant, original))).digest("hex");
const input = { original, requestSha256: hash };
const decisionId = auditDecisionId(transaction, original.operationId);

function authority(revision = 2): DurableAuthorityState {
  return {
    schemaVersion: 1, revocations: [],
    snapshot: {
      version: 1, revision, tenant: { id: tenant, status: "active", ownerSubjects: [actor] },
      datasets: [{ tenantId: tenant, datasetId: dataset }],
      memberships: [
        { subject: actor, tenantId: tenant, revision: 1, status: "active", roleIds: [] },
        { subject: original.subject, tenantId: tenant, revision: 1, status: "active", roleIds: original.roleIds },
      ],
      roles: [{ id: "operator", tenantId: tenant, revision: 1, status: "active", grants: [] }],
      delegations: [],
    },
  };
}
function audit() {
  return {
    transactionId: transaction, decisionId, requestSha256: hash, allowed: true, resultingPolicyRevision: 2,
    evidence: {
      version: 1, transactionId: transaction, decisionId, requestSha256: hash,
      operationId: original.operationId, actorSubject: actor, tenantId: tenant, datasetId: dataset,
      operation: "provision-member", authorityChange: { kind: "provision-member", subject: original.subject, roleIds: original.roleIds },
      decision: { status: "allowed", reason: "owner-authority", policyVersion: 1, observedPolicyRevision: 1 },
      checkedAt: 1000, completedAt: 1001, resultingPolicyRevision: 2,
    },
  };
}
function observed(records: unknown[] = [audit()], state: unknown = authority()): Extract<OperationLookupStoreResult, { status: "observed" }> {
  return { status: "observed", source: "committed-database-read", actorSubject: actor,
    authorized: true, authority: state, records };
}
function harness(value = observed()) {
  const lookupOperation = vi.fn(async () => value);
  return { lookupOperation, reconciler: createEmployeeProvisioningReconciler({ lookupOperation }, tenant) };
}
async function principal(subject = actor) {
  const value = await createServerPrincipalResolver(async () => ({ status: "authenticated", subject }))(
    new Request("https://empire-os.invalid"),
  );
  if (!isAuthenticatedPrincipal(value)) throw new Error("Test principal unavailable.");
  return value;
}
afterEach(() => { release.approved = false; vi.clearAllMocks(); });

describe("provisioning reconciliation (OFFLINE observations, not PostgreSQL verification)", () => {
  it("keeps original release disabled and never performs a lookup", async () => {
    const h = harness();
    expect(await h.reconciler.reconcile(await principal(), input))
      .toEqual({ status: "disabled", reason: "migration-005-disabled" });
    expect(h.lookupOperation).not.toHaveBeenCalled();
  });

  it("verifies an exact immutable audit, not a membership-based inference", async () => {
    release.approved = true;
    const h = harness();
    expect(await h.reconciler.reconcile(await principal(), { ...input, transactionId: transaction })).toEqual({
      status: "verified-committed", source: "committed-database-read", operationId: original.operationId,
      requestSha256: hash, transactionId: transaction, decisionId,
      resultingPolicyRevision: 2, observedPolicyRevision: 2,
    });
    expect(h.lookupOperation).toHaveBeenCalledExactlyOnceWith(tenant, original.operationId);
  });

  it.each([0, 1])("keeps absence unknown without a permanent revision fence (revision %s)", async revision => {
    release.approved = true;
    // Even an existing matching membership is NOT proof of this operation's commit.
    expect(await harness(observed([], authority(revision))).reconciler.reconcile(await principal(), input))
      .toEqual({ status: "unknown", reason: "absence-without-revision-fence" });
  });

  it("verifies non-commit only when absent audit AND monotonic revision fence exclude future original execution", async () => {
    release.approved = true;
    expect(await harness(observed([], authority(3))).reconciler.reconcile(await principal(), input)).toMatchObject({
      status: "verified-not-committed", reason: "original-revision-permanently-fenced",
      observedPolicyRevision: 3, operationId: original.operationId, requestSha256: hash,
    });
  });

  it("keeps future expected revisions unknown rather than interpreting missing evidence as failure", async () => {
    release.approved = true;
    const future = { ...original, expectedPolicyRevision: 3 };
    const requestSha256 = createHash("sha256").update(JSON.stringify(employeeProvisioningRequest(tenant, future))).digest("hex");
    expect(await harness(observed([], authority(2))).reconciler.reconcile(await principal(), {
      original: future, requestSha256,
    })).toEqual({ status: "unknown", reason: "absence-without-revision-fence" });
  });

  it("verifies historical commit after legitimate later revocation without asserting current employee access", async () => {
    release.approved = true;
    const state = authority(3);
    const later: DurableAuthorityState = {
      ...state, snapshot: { ...state.snapshot, memberships: state.snapshot.memberships.map(member =>
        member.subject === original.subject ? { ...member, status: "revoked", revision: 2 } : member) },
      revocations: [{ kind: "membership", id: original.subject, operationId: "revoke:later", policyRevision: 3, revokedAt: 2000 }],
    };
    expect(await harness(observed([audit()], later)).reconciler.reconcile(await principal(), input))
      .toMatchObject({ status: "verified-committed", resultingPolicyRevision: 2, observedPolicyRevision: 3 });
  });

  it("rejects plain or transported principals without storage access", async () => {
    const h = harness();
    expect(await h.reconciler.reconcile({ subject: actor }, input))
      .toMatchObject({ status: "unauthorized", reason: "authentication-required" });
    expect(h.lookupOperation).not.toHaveBeenCalled();
  });

  it.each(["actorSubject", "tenantId", "authorized", "ready", "migrationVersion"])(
    "rejects caller authority claim %s", async key => {
      const h = harness();
      expect(await h.reconciler.reconcile(await principal(), { ...input, [key]: "forged" }))
        .toMatchObject({ status: "invalid-request" });
      expect(h.lookupOperation).not.toHaveBeenCalled();
    },
  );

  it("rejects original-request tampering against the preserved hash before looking up evidence", async () => {
    release.approved = true;
    const h = harness();
    expect(await h.reconciler.reconcile(await principal(), {
      ...input, original: { ...original, subject: "user_different" },
    })).toEqual({ status: "integrity-conflict", reason: "request-fingerprint" });
    expect(h.lookupOperation).not.toHaveBeenCalled();
  });

  it.each([
    { original }, { ...input, requestSha256: "invalid" }, { ...input, transactionId: "invalid" },
    { ...input, original: { ...original, actorSubject: actor } },
    { ...input, original: { ...original, roleIds: ["operator", "operator"] } },
  ])("rejects malformed original correlation input %j", async malformed => {
    const h = harness();
    expect(await h.reconciler.reconcile(await principal(), malformed)).toMatchObject({ status: "invalid-request" });
    expect(h.lookupOperation).not.toHaveBeenCalled();
  });

  it.each([
    { requestSha256: "0".repeat(64) }, { allowed: false }, { resultingPolicyRevision: 3 },
    { decisionId: "0".repeat(64) }, { transactionId: "invalid" }, { extra: true },
  ])("rejects audit metadata mismatch %j", async patch => {
    release.approved = true;
    expect(await harness(observed([{ ...audit(), ...patch }])).reconciler.reconcile(await principal(), input))
      .toEqual({ status: "integrity-conflict", reason: "audit" });
  });

  it.each([
    { actorSubject: "user_other" }, { tenantId: "tenant-b" }, { operationId: "provision:other" },
    { requestSha256: "0".repeat(64) }, { transactionId: "00000000-0000-4000-8000-000000000009" },
    { operation: "assign-role" }, { datasetId: "00000000-0000-4000-8000-000000000009" },
    { authorityChange: { kind: "provision-member", subject: original.subject, roleIds: [] } },
    { decision: { status: "allowed", reason: "direct-grant", policyVersion: 1, observedPolicyRevision: 1 } },
    { checkedAt: "1000" }, { completedAt: 999 }, { resultingPolicyRevision: 3 }, { extra: true },
  ])("rejects exact immutable evidence mismatch %j", async patch => {
    release.approved = true;
    const record = audit();
    expect(await harness(observed([{ ...record, evidence: { ...record.evidence, ...patch } }]))
      .reconciler.reconcile(await principal(), input)).toEqual({ status: "integrity-conflict", reason: "audit" });
  });

  it("rejects a different known transaction ID even if the operation/hash match", async () => {
    release.approved = true;
    expect(await harness().reconciler.reconcile(await principal(), {
      ...input, transactionId: "00000000-0000-4000-8000-000000000009",
    })).toMatchObject({ status: "integrity-conflict", reason: "audit" });
  });

  it("rejects duplicate evidence and a committed revision ahead of the locked authority", async () => {
    release.approved = true;
    for (const value of [observed([audit(), audit()]), observed([audit()], authority(1))]) {
      expect(await harness(value).reconciler.reconcile(await principal(), input))
        .toMatchObject({ status: "integrity-conflict", reason: "audit" });
    }
  });

  it("rejects incomplete evidence, rather than substituting current membership or inferred effects", async () => {
    release.approved = true;
    const { checkedAt, ...incomplete } = audit().evidence;
    expect(checkedAt).toBe(1000);
    expect(await harness(observed([{ ...audit(), evidence: incomplete }]))
      .reconciler.reconcile(await principal(), input)).toMatchObject({ status: "integrity-conflict", reason: "audit" });
  });

  it("rejects mismatched database actor and tenant", async () => {
    release.approved = true;
    const other = authority();
    const foreign = { ...other, snapshot: { ...other.snapshot, tenant: { ...other.snapshot.tenant, id: "tenant-b" } } };
    for (const value of [
      { ...observed(), actorSubject: "user_other" }, observed([audit()], foreign),
    ]) {
      expect(await harness(value).reconciler.reconcile(await principal(), input))
        .toMatchObject({ status: "integrity-conflict" });
    }
  });

  it("denies non-founder or currently unauthorized sessions without exposing an outcome", async () => {
    release.approved = true;
    expect(await harness({ ...observed(), actorSubject: original.subject }).reconciler.reconcile(
      await principal(original.subject), input,
    )).toMatchObject({ status: "unauthorized", reason: "forbidden" });
    expect(await harness({ ...observed(), authorized: false }).reconciler.reconcile(await principal(), input))
      .toMatchObject({ status: "unauthorized", reason: "forbidden" });
  });

  it("does not establish non-commit from evidence hidden by current tenant revocation", async () => {
    release.approved = true;
    const state = authority(3);
    const revoked: DurableAuthorityState = { ...state, snapshot: {
      ...state.snapshot, tenant: { ...state.snapshot.tenant, status: "revoked" },
    } };
    expect(await harness({ ...observed([], revoked), authorized: false }).reconciler.reconcile(await principal(), input))
      .toMatchObject({ status: "unauthorized", reason: "forbidden" });
  });

  it("rejects inconsistent current effects at the original resulting revision", async () => {
    release.approved = true;
    const state = authority();
    const changed = { ...state, snapshot: { ...state.snapshot, memberships: state.snapshot.memberships.map(member =>
      member.subject === original.subject ? { ...member, revision: 2, roleIds: [] } : member) } };
    expect(await harness(observed([audit()], changed)).reconciler.reconcile(await principal(), input))
      .toMatchObject({ status: "integrity-conflict", reason: "authority" });
  });

  it("keeps unavailable, thrown and test-model-only visibility unknown", async () => {
    release.approved = true;
    const stores: OperationReconciliationStore[] = [
      { lookupOperation: async () => ({ status: "unavailable", message: "private" }) },
      { lookupOperation: async () => { throw new Error("private"); } },
      { lookupOperation: async () => ({ ...observed(), status: "observed", source: "test-model-only",
        authority: authority(), actorSubject: actor, authorized: true, records: [] }) },
    ];
    for (const store of stores) {
      expect(await createEmployeeProvisioningReconciler(store, tenant).reconcile(await principal(), input))
        .toEqual({ status: "unknown", reason: "database-visibility-unavailable" });
    }
  });

  it("awaits the store's serialization boundary rather than interpreting an unfinished lookup", async () => {
    release.approved = true;
    let resolve: (value: OperationLookupStoreResult) => void = () => { throw new Error("Uninitialized barrier."); };
    const waiting = new Promise<OperationLookupStoreResult>(done => { resolve = done; });
    const reconciler = createEmployeeProvisioningReconciler({ lookupOperation: () => waiting }, tenant);
    let finished = false;
    const pending = reconciler.reconcile(await principal(), input).then(result => { finished = true; return result; });
    await Promise.resolve();
    expect(finished).toBe(false);
    resolve(observed());
    expect(await pending).toMatchObject({ status: "verified-committed" });
  });
});

describe("server reconciliation authentication/release composition", () => {
  it("does not construct a source with disabled migration or unauthenticated session", async () => {
    const sourceForPrincipal = vi.fn(() => { throw new Error("must not connect"); });
    for (const authenticated of [true, false]) {
      const boundary = createServerEmployeeProvisioningReconciliation({
        tenantId: tenant, sourceForPrincipal,
        resolveSession: async () => authenticated ? { status: "authenticated", subject: actor } : { status: "unauthenticated" },
      });
      expect((await boundary.reconcile(new Request("https://empire-os.invalid"), input)).status)
        .toBe(authenticated ? "disabled" : "unauthorized");
    }
    expect(sourceForPrincipal).not.toHaveBeenCalled();
  });

  it("handles authentication and per-principal source failures conservatively", async () => {
    release.approved = true;
    for (const authenticationFails of [true, false]) {
      const boundary = createServerEmployeeProvisioningReconciliation({
        tenantId: tenant,
        resolveSession: async () => {
          if (authenticationFails) throw new Error("private authentication");
          return { status: "authenticated", subject: actor };
        },
        sourceForPrincipal: () => { throw new Error("private credentials"); },
      });
      expect((await boundary.reconcile(new Request("https://empire-os.invalid"), input)).status).toBe("unknown");
    }
  });

  it("prevents runtime infrastructure from overriding the Clerk resolver", async () => {
    vi.mocked(resolveClerkSession).mockResolvedValue({ status: "unauthenticated" });
    const infrastructure = {
      tenantId: tenant, sourceForPrincipal: vi.fn(() => { throw new Error("must not connect"); }),
      resolveSession: vi.fn(async () => ({ status: "authenticated" as const, subject: actor })),
    };
    const boundary = createClerkEmployeeProvisioningReconciliation(infrastructure);
    expect(await boundary.reconcile(new Request("https://empire-os.invalid"), input))
      .toMatchObject({ status: "unauthorized" });
    expect(infrastructure.resolveSession).not.toHaveBeenCalled();
    expect(resolveClerkSession).toHaveBeenCalledOnce();
  });
});
