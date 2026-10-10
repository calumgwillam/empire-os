import { randomUUID, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { AuthorizationSnapshot } from "./authorization-contract";
import type {
  AuthorizationAuditEvidence, AuthorizationStoreResult, AuthorizationTransactionValue, LockedAuthorizationTransaction,
  SensitivePersistenceCommand, TransactionAuthorizationRequest, TransactionalAuthorizationStore,
} from "./authorization-transaction-contract";
import { createTransactionalAuthorizationExecutor } from "./authorization-transaction";
import {
  validateAuthorityTransition, validateDurableAuthorityState, type DurableAuthorityState,
} from "./durable-authorization-state";
import {
  createServerPersistenceAuthority, type AuthenticatedPrincipal,
} from "./server-persistence-authority";
import { UnconfiguredServerPersistenceRepository } from "./server-persistence-contract";
import { prepareServerImport } from "./server-import-preparation";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); });

const datasetId = "00000000-0000-4000-8000-000000000001";
const otherDatasetId = "00000000-0000-4000-8000-000000000002";
function state(tenantId = "tenant-a", dataset = datasetId): DurableAuthorityState {
  return {
    schemaVersion: 1, revocations: [],
    snapshot: {
      version: 1, revision: 1, tenant: { id: tenantId, status: "active", ownerSubjects: ["owner"] },
      datasets: [{ tenantId, datasetId: dataset }],
      memberships: [
        { subject: "owner", tenantId, revision: 1, status: "active", roleIds: [] },
        { subject: "issuer", tenantId, revision: 1, status: "active", roleIds: ["operator"] },
        { subject: "recipient", tenantId, revision: 1, status: "active", roleIds: [] },
      ],
      roles: [{
        id: "operator", tenantId, revision: 1, status: "active",
        grants: [{ id: "write-grant", datasetId: dataset, capability: "write", delegable: true }],
      }],
      delegations: [],
    },
  };
}
function write(operationId = "write-one", revision = 1): TransactionAuthorizationRequest {
  return {
    operationId, tenantId: "tenant-a", expectedPolicyRevision: revision,
    command: { kind: "write", request: {
      fence: { datasetId, protocolVersion: 1, generation: 1, authorityRevision: 0 },
      idempotencyKey: operationId, reads: [],
      writes: [{ key: "empire-os-captures", rawValue: "[]", expectedRevision: 0 }],
    } },
  };
}
function revoke(kind: "membership" | "role" | "delegation" = "membership", id = "issuer", revision = 1): TransactionAuthorizationRequest {
  return {
    operationId: `revoke-${kind}`, tenantId: "tenant-a", expectedPolicyRevision: revision,
    command: { kind: "revoke", datasetId, target: { kind, id } },
  };
}
function delegate(revision = 1): TransactionAuthorizationRequest {
  return {
    operationId: "delegation-one", tenantId: "tenant-a", expectedPolicyRevision: revision,
    command: { kind: "delegate", request: {
      operation: "delegate", tenantId: "tenant-a", datasetId, expectedPolicyRevision: revision,
      recipientSubject: "recipient", capability: "write", sourceRoleId: "operator", sourceGrantId: "write-grant", expiresAt: 2000,
    } },
  };
}
async function principal(subject: string): Promise<AuthenticatedPrincipal> {
  let identity: AuthenticatedPrincipal | undefined;
  const boundary = createServerPersistenceAuthority({
    resolveSession: async () => ({ status: "authenticated", subject }),
    authorize: async (resolved) => { identity = resolved; return false; },
    repositoryForPrincipal: () => new UnconfiguredServerPersistenceRepository(),
  });
  await boundary.readSnapshot(new Request("https://empire-os.invalid"), { datasetId, protocolVersion: 1 });
  if (!identity) throw new Error("Missing test principal.");
  return identity;
}
function barrier() {
  let release: () => void = () => { throw new Error("Barrier not initialized."); };
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

// Test-only copy-on-write transactions. No database connection or durability claim.
class TransactionModel implements TransactionalAuthorizationStore {
  states = new Map<string, unknown>([["tenant-a", state()], ["tenant-b", state("tenant-b", otherDatasetId)]]);
  effects: SensitivePersistenceCommand[] = [];
  audits: AuthorizationAuditEvidence[] = [];
  private tails = new Map<string, Promise<void>>();
  now = 1000;
  failure: "audit" | "missing-audit" | "operation" | "commit" | "unknown" | "bad-ack" | null = null;
  stageHook: (() => Promise<void>) | undefined;
  auditHook: (() => Promise<void>) | undefined;
  entered: string[] = [];

  async runLocked(tenantId: string, operation: (transaction: LockedAuthorizationTransaction) => Promise<AuthorizationTransactionValue>): Promise<AuthorizationStoreResult> {
    const predecessor = this.tails.get(tenantId) ?? Promise.resolve();
    const lock = barrier();
    this.tails.set(tenantId, lock.promise);
    await predecessor;
    this.entered.push(tenantId);
    let active = true;
    const assertActive = () => { if (!active) throw new Error("Transaction context has expired."); };
    let stagedState = structuredClone(this.states.get(tenantId));
    const effects: SensitivePersistenceCommand[] = [];
    const audits: AuthorizationAuditEvidence[] = [];
    const guards: (() => void)[] = [];
    let authorityWrites = 0;
    const transactionId = randomUUID();
    try {
      const result = await operation({
        transactionId,
        loadAuthority: async () => { assertActive(); return structuredClone(stagedState); },
        nowMs: () => { assertActive(); return this.now; },
        stagePersistence: async (command) => {
          assertActive();
          if (this.failure === "operation") throw new Error("Staging failed.");
          const validated = validateDurableAuthorityState(stagedState);
          if (validated.status !== "valid" || !validated.value.snapshot.datasets.some((entry) => entry.datasetId === command.request.fence.datasetId)
            || command.request.fence.generation !== 1 || command.request.fence.authorityRevision !== 0) {
            throw new Error("Dataset fence or isolation failure.");
          }
          if (this.stageHook) await this.stageHook();
          effects.push(structuredClone(command));
        },
        stageAuthority: async (next) => {
          assertActive();
          if (validateAuthorityTransition(stagedState, next, this.now).status !== "valid") throw new Error("Invalid authority transition.");
          if (this.stageHook) await this.stageHook();
          stagedState = structuredClone(next);
          authorityWrites += 1;
        },
        appendAudit: async (audit) => {
          assertActive();
          if (this.failure === "audit") throw new Error("Audit unavailable.");
          if (this.auditHook) await this.auditHook();
          if (this.failure !== "missing-audit") audits.push(structuredClone(audit));
        },
        beforeCommit: (guard) => { assertActive(); guards.push(guard); },
      });
      if (audits.length !== 1 || guards.length !== 1 || JSON.stringify(audits[0]) !== JSON.stringify(result.audit)
        || audits[0].transactionId !== transactionId || audits[0].tenantId !== tenantId
        || JSON.stringify(result.decision) !== JSON.stringify(audits[0].decision)
        || (result.decision.status === "denied" && (effects.length !== 0 || authorityWrites !== 0))
        || (result.decision.status === "allowed" && effects.length + authorityWrites !== 1)
        || (result.decision.status === "allowed" && this.audits.some((entry) => entry.decision.status === "allowed"
          && entry.tenantId === tenantId && entry.actorSubject === result.audit.actorSubject && entry.operationId === result.audit.operationId))) {
        throw new Error("Atomic audit or operation identity requirement failed.");
      }
      guards[0]();
      if (this.failure === "commit") throw new Error("Commit failed before publication.");
      // No await between the guard and atomic publication in this test model.
      this.states.set(tenantId, stagedState);
      this.effects.push(...effects);
      this.audits.push(...audits);
      if (this.failure === "unknown") return { status: "unavailable", outcome: "unknown", message: "Commit acknowledgement lost." };
      return {
        status: "committed", durability: "test-model-only", transactionId,
        auditDecisionId: this.failure === "bad-ack" ? "wrong" : result.audit.decisionId, value: result,
      };
    } catch {
      return { status: "failed", outcome: "rolled-back", message: "Test-model transaction rolled back." };
    } finally {
      active = false;
      lock.release();
    }
  }
  current(tenantId = "tenant-a"): DurableAuthorityState {
    const validated = validateDurableAuthorityState(this.states.get(tenantId));
    if (validated.status !== "valid") throw new Error("Invalid test state.");
    return validated.value;
  }
}

describe("durable authority invariants", () => {
  it("validates the versioned envelope without converting existing business data", () => {
    expect(validateDurableAuthorityState(state()).status).toBe("valid");
  });
  it.each([
    { ...state(), schemaVersion: 2 }, { ...state(), revocations: new Array(1) },
    { ...state(), snapshot: { ...state().snapshot, revision: -1 } },
    { ...state(), snapshot: { ...state().snapshot, memberships: [] } },
    { ...state(), snapshot: { ...state().snapshot, roles: [{ ...state().snapshot.roles[0], tenantId: "tenant-b" }] } },
    { ...state(), revocations: [{ kind: "role", id: "operator", operationId: "revoke", policyRevision: 1, revokedAt: 1000 }] },
    { ...state(), snapshot: { ...state().snapshot, roles: [{ ...state().snapshot.roles[0], status: "revoked" }] } },
  ])("rejects invalid, ambiguous or unaudited durable state", (observed) => {
    expect(validateDurableAuthorityState(observed).status).toBe("inconsistent");
  });
  it.each([
    (snapshot: AuthorizationSnapshot) => ({ ...snapshot, revision: 1 }),
    (snapshot: AuthorizationSnapshot) => ({ ...snapshot, revision: 3 }),
    (snapshot: AuthorizationSnapshot) => ({ ...snapshot, tenant: { ...snapshot.tenant, ownerSubjects: ["recipient"] } }),
    (snapshot: AuthorizationSnapshot) => ({ ...snapshot, datasets: [] }),
    (snapshot: AuthorizationSnapshot) => ({ ...snapshot, memberships: snapshot.memberships.slice(1) }),
    (snapshot: AuthorizationSnapshot) => ({ ...snapshot, roles: [{ ...snapshot.roles[0], grants: [] }] }),
    (snapshot: AuthorizationSnapshot) => ({ ...snapshot, memberships: snapshot.memberships.map((entry) =>
      entry.subject === "recipient" ? { ...entry, roleIds: ["operator"] } : entry) }),
  ])("refuses stale revisions, ownership escalation, remapping, deletion and unversioned grants", (change) => {
    const initial = state();
    expect(validateAuthorityTransition(initial, { ...initial, snapshot: change({ ...initial.snapshot, revision: 2 }) }, 1000).status)
      .toBe("inconsistent");
  });
});

describe("transaction-scoped authorization using a test-only transactional store", () => {
  it("commits a write with one matching audit and explicitly test-only durability", async () => {
    const model = new TransactionModel();
    const result = await createTransactionalAuthorizationExecutor(model).execute(await principal("issuer"), write());
    expect(result).toMatchObject({ status: "executed", durability: "test-model-only", operationId: "write-one" });
    expect(model.effects).toHaveLength(1);
    expect(model.audits).toHaveLength(1);
    expect(model.audits[0]).toMatchObject({
      actorSubject: "issuer", tenantId: "tenant-a", datasetId, operation: "write",
      decision: { status: "allowed", reason: "direct-grant", observedPolicyRevision: 1, evidenceId: "write-grant" },
      resultingPolicyRevision: 1,
    });
    expect(model.audits[0].requestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(model.audits[0].decisionId).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(model.audits)).not.toContain('"rawValue"');
  });
  it("rejects forged identity before entering a transaction", async () => {
    const model = new TransactionModel();
    expect(await createTransactionalAuthorizationExecutor(model).execute({ subject: "owner" }, write()))
      .toEqual({ status: "unauthorized", reason: "authentication-required" });
    expect(model.entered).toHaveLength(0);
  });
  it("rejects invalid or authority-bearing payloads before entering a transaction", async () => {
    const model = new TransactionModel();
    expect(await createTransactionalAuthorizationExecutor(model).execute(await principal("issuer"), { ...write(), authorized: true }))
      .toMatchObject({ status: "invalid-request" });
    expect(model.entered).toHaveLength(0);
  });
  it("rejects mismatched nested role request targets", async () => {
    const model = new TransactionModel();
    const input = delegate();
    if (input.command.kind !== "delegate") throw new Error("Wrong fixture.");
    expect(await createTransactionalAuthorizationExecutor(model).execute(await principal("issuer"),
      { ...input, command: { ...input.command, request: { ...input.command.request, tenantId: "tenant-b" } } }))
      .toMatchObject({ status: "invalid-request" });
    expect(model.entered).toHaveLength(0);
  });
  it.each([null, {}, { ...state(), snapshot: { ...state().snapshot, tenant: { ...state().snapshot.tenant, id: "tenant-b" } } }])(
    "fails closed on unavailable or inconsistent authoritative reads", async (observed) => {
      const model = new TransactionModel();
      model.states.set("tenant-a", observed);
      expect(await createTransactionalAuthorizationExecutor(model).execute(await principal("issuer"), write()))
        .toMatchObject({ status: "unavailable", outcome: "not-submitted" });
      expect(model.effects).toHaveLength(0);
      expect(model.audits).toHaveLength(0);
    },
  );
  it("reevaluates current state after a revocation; refreshing a revision cannot restore permission", async () => {
    const model = new TransactionModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    const issuer = await principal("issuer");
    expect(await executor.execute(await principal("owner"), revoke())).toMatchObject({ status: "executed" });
    expect(await executor.execute(issuer, write())).toMatchObject({ status: "denied", decision: { reason: "stale-policy" } });
    expect(await executor.execute(issuer, write("write-fresh", 2))).toMatchObject({ status: "denied", decision: { reason: "membership-revoked" } });
    expect(model.effects).toHaveLength(0);
    expect(model.current().revocations).toHaveLength(1);
  });
  it("serializes write-first revocation and permits no post-revocation write", async () => {
    const model = new TransactionModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    const staged = barrier();
    const resume = barrier();
    const issuer = await principal("issuer");
    const owner = await principal("owner");
    model.stageHook = async () => { staged.release(); await resume.promise; };
    const writing = executor.execute(issuer, write());
    await staged.promise;
    const revoking = executor.execute(owner, revoke());
    await Promise.resolve();
    expect(model.entered).toHaveLength(1);
    model.stageHook = undefined;
    resume.release();
    expect(await writing).toMatchObject({ status: "executed" });
    expect(await revoking).toMatchObject({ status: "executed" });
    expect(model.audits.map((entry) => entry.operation)).toEqual(["write", "revoke"]);
    expect(await executor.execute(issuer, write("late-write", 2))).toMatchObject({ status: "denied" });
    expect(model.effects).toHaveLength(1);
  });
  it("serializes revocation-first and prevents a queued sensitive write from using preflight permission", async () => {
    const model = new TransactionModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    const staged = barrier();
    const resume = barrier();
    const owner = await principal("owner");
    const issuer = await principal("issuer");
    model.stageHook = async () => { staged.release(); await resume.promise; };
    const revoking = executor.execute(owner, revoke());
    await staged.promise;
    const writing = executor.execute(issuer, write());
    model.stageHook = undefined;
    resume.release();
    expect(await revoking).toMatchObject({ status: "executed" });
    expect(await writing).toMatchObject({ status: "denied", decision: { reason: "stale-policy" } });
    expect(model.effects).toHaveLength(0);
  });
  it("isolates tenants even when the subject and role identifiers are the same", async () => {
    const model = new TransactionModel();
    const result = await createTransactionalAuthorizationExecutor(model).execute(await principal("owner"), { ...write(), tenantId: "tenant-b" });
    expect(result).toMatchObject({ status: "denied", decision: { reason: "dataset-not-authorized" } });
    expect(model.effects).toHaveLength(0);
    expect(model.current("tenant-b").snapshot.revision).toBe(1);
  });
  it("does not block an unrelated tenant behind another tenant's lock", async () => {
    const model = new TransactionModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    const staged = barrier();
    const resume = barrier();
    const issuer = await principal("issuer");
    const owner = await principal("owner");
    model.stageHook = async () => { staged.release(); await resume.promise; };
    const writing = executor.execute(issuer, write());
    await staged.promise;
    // Denied tenant-b access needs no staging hook and must acquire its own lock.
    expect(await executor.execute(owner, { ...write("tenant-b-attempt"), tenantId: "tenant-b" }))
      .toMatchObject({ status: "denied" });
    resume.release();
    expect(await writing).toMatchObject({ status: "executed" });
  });
  it.each(["audit", "missing-audit", "operation", "commit"] as const)(
    "rolls back all writes and audit evidence after %s failure", async (failure) => {
      const model = new TransactionModel();
      model.failure = failure;
      expect(await createTransactionalAuthorizationExecutor(model).execute(await principal("issuer"), write()))
        .toMatchObject({ status: "failed", outcome: "rolled-back" });
      expect(model.effects).toHaveLength(0);
      expect(model.audits).toHaveLength(0);
    },
  );
  it("rolls back an authority mutation if audit insertion fails", async () => {
    const model = new TransactionModel();
    model.failure = "audit";
    expect(await createTransactionalAuthorizationExecutor(model).execute(await principal("owner"), revoke()))
      .toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(model.current()).toEqual(state());
  });
  it.each(["unknown", "bad-ack"] as const)("never turns %s commit evidence into confirmed success or rollback", async (failure) => {
    const model = new TransactionModel();
    model.failure = failure;
    expect(await createTransactionalAuthorizationExecutor(model).execute(await principal("issuer"), write()))
      .toMatchObject({ status: "unavailable", outcome: "unknown" });
    expect(model.effects).toHaveLength(1);
    expect(model.audits).toHaveLength(1);
  });
  it("refuses reused successful operation IDs without a second effect", async () => {
    const model = new TransactionModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    const issuer = await principal("issuer");
    expect(await executor.execute(issuer, write())).toMatchObject({ status: "executed" });
    expect(await executor.execute(issuer, write())).toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(model.effects).toHaveLength(1);
  });
  it("binds delegation revisions from locked authority and prohibits laundering and role management", async () => {
    const model = new TransactionModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    expect(await executor.execute(await principal("issuer"), delegate())).toMatchObject({ status: "executed" });
    const current = model.current();
    expect(current.snapshot.delegations[0]).toMatchObject({
      id: "delegation-one", issuerMembershipRevision: 1, recipientMembershipRevision: 1, sourceRoleRevision: 1, issuedAt: 1000,
    });
    const recipient = await principal("recipient");
    expect(await executor.execute(recipient, write("delegated-write", 2))).toMatchObject({ status: "executed", decision: { reason: "delegated-grant" } });
    expect(await executor.execute(recipient, delegate(2))).toMatchObject({ status: "denied", decision: { reason: "self-escalation" } });
    const redelegate = delegate(2);
    if (redelegate.command.kind !== "delegate") throw new Error("Wrong fixture.");
    expect(await executor.execute(recipient, { ...redelegate, command: { ...redelegate.command,
      request: { ...redelegate.command.request, recipientSubject: "owner" } } }))
      .toMatchObject({ status: "denied", decision: { reason: "source-not-delegable" } });
    expect(await executor.execute(recipient, revoke("role", "operator", 2)))
      .toMatchObject({ status: "denied" });
    expect(await executor.execute(await principal("owner"), revoke("role", "operator", 2))).toMatchObject({ status: "executed" });
    expect(await executor.execute(recipient, write("revoked-source", 3))).toMatchObject({ status: "denied" });
  });
  it.each(["source", "capability", "membership-revision", "role-revision", "dataset", "reserved", "non-delegable"] as const)(
    "rejects invalid delegation authority: %s", async (change) => {
      const model = new TransactionModel();
      const executor = createTransactionalAuthorizationExecutor(model);
      const issuer = await principal("issuer");
      await executor.execute(issuer, delegate());
      const observed = model.current();
      const entry = observed.snapshot.delegations[0];
      const changed = change === "source" ? { ...entry, sourceGrantId: "forged" }
        : change === "capability" ? { ...entry, capability: "import" as const }
        : change === "membership-revision" ? { ...entry, issuerMembershipRevision: 2 }
        : change === "role-revision" ? { ...entry, sourceRoleRevision: 2 }
        : change === "dataset" ? { ...entry, datasetId: otherDatasetId }
        : change === "reserved" ? { ...entry, capability: "role:assign" } : entry;
      const snapshot = { ...observed.snapshot, delegations: [changed],
        roles: change === "non-delegable" ? observed.snapshot.roles.map((role) => ({
          ...role, grants: role.grants.map((grant) => ({ ...grant, delegable: false })),
        })) : observed.snapshot.roles };
      model.states.set("tenant-a", { ...observed, snapshot });
      const result = await executor.execute(await principal("recipient"), write("invalid-delegation", 2));
      expect(result.status).not.toBe("executed");
      expect(model.effects).toHaveLength(0);
    },
  );
  it("refuses rewriting delegation provenance or deleting revocation tombstones", async () => {
    const model = new TransactionModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    await executor.execute(await principal("issuer"), delegate());
    const delegated = model.current();
    expect(validateAuthorityTransition(delegated, { ...delegated, snapshot: {
      ...delegated.snapshot, revision: 3,
      delegations: delegated.snapshot.delegations.map((entry) => ({ ...entry, issuerSubject: "recipient" })),
    } }, 1000).status).toBe("inconsistent");
    await executor.execute(await principal("owner"), revoke("delegation", "delegation-one", 2));
    const revoked = model.current();
    expect(validateAuthorityTransition(revoked, { ...revoked, revocations: [], snapshot: {
      ...revoked.snapshot, revision: 4, delegations: [],
    } }, 1000).status).toBe("inconsistent");
    expect(validateAuthorityTransition(revoked, { ...revoked, snapshot: {
      ...revoked.snapshot, revision: 4,
      delegations: revoked.snapshot.delegations.map((entry) => ({ ...entry, status: "active" })),
    } }, 1000).status).toBe("inconsistent");
  });
  it("does not mutate or trust earlier caller-owned request objects", async () => {
    const model = new TransactionModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    const input = write();
    const before = JSON.stringify(input);
    model.stageHook = async () => {
      if (input.command.kind !== "write") throw new Error("Wrong fixture.");
      Object.assign(input.command.request.fence, { datasetId: otherDatasetId });
    };
    expect(await executor.execute(await principal("issuer"), input)).toMatchObject({ status: "executed" });
    expect(model.effects[0].request.fence.datasetId).toBe(datasetId);
    expect(JSON.stringify(input)).not.toBe(before);
  });
  it("reports a throwing transaction store as unknown, not a confirmed rollback", async () => {
    const store: TransactionalAuthorizationStore = {
      runLocked: async () => { throw new Error("Private database detail."); },
    };
    const result = await createTransactionalAuthorizationExecutor(store).execute(await principal("issuer"), write());
    expect(result).toEqual({
      status: "unavailable", outcome: "unknown", message: "Authorization transaction outcome could not be confirmed.",
    });
  });
  it("rejects backwards server time after staging", async () => {
    const model = new TransactionModel();
    model.stageHook = async () => { model.now = 999; };
    expect(await createTransactionalAuthorizationExecutor(model).execute(await principal("issuer"), write()))
      .toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(model.effects).toHaveLength(0);
    expect(model.audits).toHaveLength(0);
  });
  it.each(["stage", "audit"] as const)("rolls back a delegated write when expiry crosses the %s boundary", async (boundary) => {
    const model = new TransactionModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    await executor.execute(await principal("issuer"), delegate());
    const expire = async () => { model.now = 2000; };
    if (boundary === "stage") model.stageHook = expire;
    else model.auditHook = expire;
    expect(await executor.execute(await principal("recipient"), write("expiring", 2))).toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(model.effects).toHaveLength(0);
    expect(model.audits).toHaveLength(1);
  });
  it("denies owner membership revocation through the ordinary mutation path", async () => {
    const model = new TransactionModel();
    expect(await createTransactionalAuthorizationExecutor(model).execute(await principal("owner"), revoke("membership", "owner")))
      .toMatchObject({ status: "denied", decision: { reason: "invalid-request" } });
    expect(model.current().snapshot.tenant.ownerSubjects).toEqual(["owner"]);
  });
  it("assigns existing roles with a membership and tenant revision increment", async () => {
    const model = new TransactionModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    const input: TransactionAuthorizationRequest = {
      operationId: "assignment", tenantId: "tenant-a", expectedPolicyRevision: 1,
      command: { kind: "assign-role", request: {
        operation: "assign-role", tenantId: "tenant-a", datasetId, expectedPolicyRevision: 1,
        recipientSubject: "recipient", roleId: "operator",
      } },
    };
    expect(await executor.execute(await principal("issuer"), input)).toMatchObject({ status: "denied", decision: { reason: "owner-required" } });
    expect(await executor.execute(await principal("owner"), input)).toMatchObject({ status: "executed" });
    expect(model.current().snapshot.memberships.find((entry) => entry.subject === "recipient")).toMatchObject({ revision: 2, roleIds: ["operator"] });
    expect(model.current().snapshot.revision).toBe(2);
    expect(model.audits.at(-1)?.authorityChange).toEqual(input.command);
  });
  it("refuses counter exhaustion without changing authority", async () => {
    const model = new TransactionModel();
    const exhausted = { ...state(), snapshot: { ...state().snapshot, revision: Number.MAX_SAFE_INTEGER } };
    model.states.set("tenant-a", exhausted);
    expect(await createTransactionalAuthorizationExecutor(model).execute(await principal("owner"), revoke("membership", "issuer", Number.MAX_SAFE_INTEGER)))
      .toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(model.current()).toEqual(exhausted);
  });
  it("preserves generation fences separately from the tenant authorization revision", async () => {
    const model = new TransactionModel();
    const input = write();
    if (input.command.kind !== "write") throw new Error("Wrong fixture.");
    expect(await createTransactionalAuthorizationExecutor(model).execute(await principal("issuer"), { ...input, command: {
      ...input.command, request: { ...input.command.request, fence: { ...input.command.request.fence, generation: 2 } },
    } })).toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(model.effects).toHaveLength(0);
  });
  it("authorizes imports distinctly and stages only a validated plan", async () => {
    const model = new TransactionModel();
    const prepared = await prepareServerImport({ getItem: () => null });
    if (prepared.status !== "prepared") throw new Error("Invalid fixture import.");
    const input: TransactionAuthorizationRequest = {
      operationId: "import-one", tenantId: "tenant-a", expectedPolicyRevision: 1,
      command: { kind: "stage-import", request: {
        fence: { datasetId, generation: 1, authorityRevision: 0, protocolVersion: 1 }, idempotencyKey: "import-one", plan: prepared.plan,
      } },
    };
    const executor = createTransactionalAuthorizationExecutor(model);
    expect(await executor.execute(await principal("issuer"), input)).toMatchObject({ status: "denied" });
    expect(await executor.execute(await principal("owner"), input)).toMatchObject({ status: "executed" });
    expect(model.effects[0].kind).toBe("stage-import");
  });
});
