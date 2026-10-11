import { randomUUID, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthorizationAuditEvidence, AuthorizationStoreResult, AuthorizationTransactionValue, LockedAuthorizationTransaction,
  OperationLookupStoreResult, OperationReconciliationStore, SensitivePersistenceCommand,
  TransactionAuthorizationRequest, TransactionalAuthorizationStore,
} from "./authorization-transaction-contract";
import { createOperationReconciler, reconciliationPermitted } from "./authorization-reconciliation";
import { createTransactionalAuthorizationExecutor } from "./authorization-transaction";
import { validateDurableAuthorityState, type DurableAuthorityState } from "./durable-authorization-state";
import { createServerPersistenceAuthority, type AuthenticatedPrincipal } from "./server-persistence-authority";
import { UnconfiguredServerPersistenceRepository } from "./server-persistence-contract";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); });

const datasetId = "00000000-0000-4000-8000-000000000001";
function state(tenantId = "tenant-a"): DurableAuthorityState {
  return {
    schemaVersion: 1, revocations: [],
    snapshot: {
      version: 1, revision: 1, tenant: { id: tenantId, status: "active", ownerSubjects: ["owner"] },
      datasets: [{ tenantId, datasetId }],
      memberships: [
        { subject: "owner", tenantId, revision: 1, status: "active", roleIds: [] },
        { subject: "issuer", tenantId, revision: 1, status: "active", roleIds: ["operator"] },
      ],
      roles: [{ id: "operator", tenantId, revision: 1, status: "active",
        grants: [{ id: "write-grant", datasetId, capability: "write", delegable: true }] }],
      delegations: [],
    },
  };
}
function write(operationId = "write-one", policyRevision = 1, storeRevision = 0): TransactionAuthorizationRequest {
  return {
    operationId, tenantId: "tenant-a", expectedPolicyRevision: policyRevision,
    command: { kind: "write", request: {
      fence: { datasetId, protocolVersion: 1, generation: 1, authorityRevision: 0 },
      idempotencyKey: operationId, reads: [],
      writes: [{ key: "empire-os-captures", rawValue: "[]", expectedRevision: storeRevision }],
    } },
  };
}
function revokeIssuer(): TransactionAuthorizationRequest {
  return { operationId: "revoke-issuer", tenantId: "tenant-a", expectedPolicyRevision: 1,
    command: { kind: "revoke", datasetId, target: { kind: "membership", id: "issuer" } } };
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
type Observed = Extract<OperationLookupStoreResult, { status: "observed" }>;

// Test-only model of one tenant lock shared by transactions and reconciliation lookups.
// Mirrors the database's at-most-one allowed audit per (tenant, actor, operation ID).
class ReconciliationModel implements TransactionalAuthorizationStore {
  states = new Map<string, DurableAuthorityState>([["tenant-a", state()]]);
  audits: AuthorizationAuditEvidence[] = [];
  effects: SensitivePersistenceCommand[] = [];
  commitMode: "confirm" | "lost-ack" | "fail" = "confirm";
  holdBeforeCommit: (() => Promise<void>) | undefined;
  private tails = new Map<string, Promise<void>>();

  private async locked<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    const predecessor = this.tails.get(tenantId) ?? Promise.resolve();
    const lock = barrier();
    this.tails.set(tenantId, lock.promise);
    await predecessor;
    try {
      return await work();
    } finally {
      lock.release();
    }
  }

  runLocked(tenantId: string, operation: (transaction: LockedAuthorizationTransaction) => Promise<AuthorizationTransactionValue>): Promise<AuthorizationStoreResult> {
    return this.locked(tenantId, async () => {
      let staged = structuredClone(this.states.get(tenantId));
      const effects: SensitivePersistenceCommand[] = [];
      const audits: AuthorizationAuditEvidence[] = [];
      const guards: (() => void)[] = [];
      const transactionId = randomUUID();
      try {
        const result = await operation({
          transactionId,
          loadAuthority: async () => structuredClone(staged),
          nowMs: () => 1000,
          stagePersistence: async (command) => { effects.push(structuredClone(command)); },
          stageAuthority: async (next) => { staged = structuredClone(next); },
          appendAudit: async (audit) => { audits.push(structuredClone(audit)); },
          beforeCommit: (guard) => { guards.push(guard); },
        });
        const audit = audits[0];
        if (audits.length !== 1 || guards.length !== 1 || (audit.decision.status === "allowed" && this.audits.some((entry) =>
          entry.decision.status === "allowed" && entry.tenantId === tenantId
          && entry.actorSubject === audit.actorSubject && entry.operationId === audit.operationId))) {
          throw new Error("Unique allowed operation violated.");
        }
        guards[0]();
        if (this.holdBeforeCommit) await this.holdBeforeCommit();
        if (this.commitMode === "fail") throw new Error("Commit failed.");
        if (staged) this.states.set(tenantId, staged);
        this.effects.push(...effects);
        this.audits.push(...audits);
        if (this.commitMode === "lost-ack") return { status: "unavailable", outcome: "unknown", message: "Acknowledgement lost." };
        return { status: "committed", durability: "test-model-only", transactionId, auditDecisionId: audit.decisionId, value: result };
      } catch {
        return { status: "failed", outcome: "rolled-back", message: "Rolled back." };
      }
    });
  }

  // The actor is bound by the store (like the database role binding), not by the reconciler caller.
  reconciliationStore(actor: string, tamper?: (observed: Observed) => unknown): OperationReconciliationStore {
    return {
      lookupOperation: (tenantId, operationId) => this.locked(tenantId, async () => {
        const authority = structuredClone(this.states.get(tenantId));
        if (!authority) return { status: "unavailable", message: "Missing tenant." };
        const authorized = reconciliationPermitted(authority, actor);
        const records = authorized ? this.audits
          .filter((audit) => audit.tenantId === tenantId && audit.actorSubject === actor && audit.operationId === operationId)
          .map((audit) => ({
            transactionId: audit.transactionId, decisionId: audit.decisionId, requestSha256: audit.requestSha256,
            allowed: audit.decision.status === "allowed", resultingPolicyRevision: audit.resultingPolicyRevision,
            evidence: structuredClone(audit),
          })) : [];
        const observed: Observed = { status: "observed", source: "test-model-only", authority, actorSubject: actor, authorized, records };
        return (tamper ? tamper(observed) : observed) as OperationLookupStoreResult;
      }),
    };
  }

  snapshot(): string { return JSON.stringify([[...this.states], this.audits, this.effects]); }
}

describe("authorized operation reconciliation", () => {
  it("resolves a lost commit acknowledgement to the single committed effect, and a failed retry does not mislead", async () => {
    const model = new ReconciliationModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    const reconciler = createOperationReconciler(model.reconciliationStore("issuer"));
    const issuer = await principal("issuer");
    model.commitMode = "lost-ack";
    expect(await executor.execute(issuer, write())).toMatchObject({ status: "unavailable", outcome: "unknown" });
    const [audit] = model.audits;
    const expected = {
      status: "executed", operationId: "write-one", transactionId: audit.transactionId, decisionId: audit.decisionId,
      decision: audit.decision, resultingPolicyRevision: 1, source: "test-model-only",
    };
    expect(await reconciler.reconcile(issuer, write())).toEqual(expected);
    model.commitMode = "confirm";
    // A blind retry is rejected, which on its own would wrongly suggest the operation never happened.
    expect(await executor.execute(issuer, write())).toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(model.effects).toHaveLength(1);
    expect(await reconciler.reconcile(issuer, write())).toEqual(expected);
  });

  it("reports a rolled-back operation as not executed, after which the same request executes exactly once", async () => {
    const model = new ReconciliationModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    const reconciler = createOperationReconciler(model.reconciliationStore("issuer"));
    const issuer = await principal("issuer");
    model.commitMode = "fail";
    expect(await executor.execute(issuer, write())).toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(await reconciler.reconcile(issuer, write())).toEqual({
      status: "not-executed", operationId: "write-one", observedPolicyRevision: 1, source: "test-model-only",
    });
    model.commitMode = "confirm";
    const executed = await executor.execute(issuer, write());
    expect(executed).toMatchObject({ status: "executed" });
    expect(await reconciler.reconcile(issuer, write())).toMatchObject({
      status: "executed", transactionId: executed.status === "executed" ? executed.transactionId : "missing",
    });
    expect(model.effects).toHaveLength(1);
  });

  it("detects operation ID reuse for a different request instead of reporting the original outcome", async () => {
    const model = new ReconciliationModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    const reconciler = createOperationReconciler(model.reconciliationStore("issuer"));
    const issuer = await principal("issuer");
    expect(await executor.execute(issuer, write())).toMatchObject({ status: "executed" });
    expect(await reconciler.reconcile(issuer, write("write-one", 1, 1)))
      .toMatchObject({ status: "conflict", operationId: "write-one" });
  });

  it("treats denied-only history as not executed, but a differing denied request as a conflict", async () => {
    const model = new ReconciliationModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    const reconciler = createOperationReconciler(model.reconciliationStore("issuer"));
    const issuer = await principal("issuer");
    expect(await executor.execute(issuer, write("stale", 2))).toMatchObject({ status: "denied" });
    expect(model.audits).toHaveLength(1);
    expect(await reconciler.reconcile(issuer, write("stale", 2))).toMatchObject({ status: "not-executed" });
    expect(await reconciler.reconcile(issuer, write("stale", 1))).toMatchObject({ status: "conflict" });
  });

  it("withholds outcomes after membership revocation and from any principal other than the bound actor", async () => {
    const model = new ReconciliationModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    const issuer = await principal("issuer");
    expect(await executor.execute(issuer, write())).toMatchObject({ status: "executed" });
    expect(await createOperationReconciler(model.reconciliationStore("owner")).reconcile(issuer, write()))
      .toEqual({ status: "unauthorized", reason: "forbidden" });
    expect(await createOperationReconciler(model.reconciliationStore("owner")).reconcile(await principal("owner"), write()))
      .toMatchObject({ status: "not-executed" });
    expect(await executor.execute(await principal("owner"), revokeIssuer())).toMatchObject({ status: "executed" });
    expect(await createOperationReconciler(model.reconciliationStore("issuer")).reconcile(issuer, write()))
      .toEqual({ status: "unauthorized", reason: "forbidden" });
  });

  it("waits for an in-flight tenant transaction before answering", async () => {
    const model = new ReconciliationModel();
    const executor = createTransactionalAuthorizationExecutor(model);
    const reconciler = createOperationReconciler(model.reconciliationStore("issuer"));
    const issuer = await principal("issuer");
    const held = barrier();
    const entered = barrier();
    model.holdBeforeCommit = async () => { entered.release(); await held.promise; };
    const pending = executor.execute(issuer, write());
    await entered.promise;
    let settled = false;
    const lookup = reconciler.reconcile(issuer, write()).then((result) => { settled = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    held.release();
    expect(await pending).toMatchObject({ status: "executed" });
    expect(await lookup).toMatchObject({ status: "executed" });
  });

  it("is read-only and never stages, audits or publishes", async () => {
    const model = new ReconciliationModel();
    const issuer = await principal("issuer");
    expect(await createTransactionalAuthorizationExecutor(model).execute(issuer, write())).toMatchObject({ status: "executed" });
    const before = model.snapshot();
    await createOperationReconciler(model.reconciliationStore("issuer")).reconcile(issuer, write());
    await createOperationReconciler(model.reconciliationStore("issuer")).reconcile(issuer, write("other"));
    expect(model.snapshot()).toBe(before);
  });

  it("rejects unauthenticated principals, invalid requests and failed storage without contacting or trusting it", async () => {
    const lookup = vi.fn(async (): Promise<OperationLookupStoreResult> => { throw new Error("Private database detail."); });
    const reconciler = createOperationReconciler({ lookupOperation: lookup });
    expect(await reconciler.reconcile({ subject: "issuer" }, write())).toEqual({ status: "unauthorized", reason: "authentication-required" });
    expect(await reconciler.reconcile(await principal("issuer"), { ...write(), operationId: "bad id" }))
      .toMatchObject({ status: "invalid-request" });
    expect(lookup).not.toHaveBeenCalled();
    const failed = await reconciler.reconcile(await principal("issuer"), write());
    expect(failed).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(JSON.stringify(failed)).not.toContain("Private");
    expect(await createOperationReconciler({ lookupOperation: async () => ({ status: "unavailable", message: "down" }) })
      .reconcile(await principal("issuer"), write())).toMatchObject({ status: "unavailable" });
  });

  type Tamper = (observed: Observed) => unknown;
  const recordAt = (observed: Observed, index = 0) => (observed.records as Record<string, unknown>[])[index];
  const evidenceAt = (observed: Observed) => recordAt(observed).evidence as Record<string, unknown>;
  it.each<[string, Tamper]>([
    ["an unverified source", (o) => ({ ...o, source: "client-cache" })],
    ["malformed authority state", (o) => ({ ...o, authority: { ...(o.authority as object), schemaVersion: 9 } })],
    ["another tenant's authority", (o) => ({ ...o, authority: state("tenant-b") })],
    ["non-boolean authorization", (o) => ({ ...o, authorized: "yes" })],
    ["non-array records", (o) => ({ ...o, records: { 0: recordAt(o) } })],
    ["sparse records", (o) => ({ ...o, records: new Array(1) })],
    ["store denial while policy permits", (o) => ({ ...o, authorized: false, records: [] })],
    ["records disclosed despite store denial", (o) => ({ ...o, authorized: false })],
    ["an extra record field", (o) => ({ ...o, records: [{ ...recordAt(o), appliedRequest: "{}" }] })],
    ["a missing record field", (o) => { const { evidence: _evidence, ...rest } = recordAt(o); return { ...o, records: [rest] }; }],
    ["a forged decision ID", (o) => {
      const forged = "f".repeat(64);
      return { ...o, records: [{ ...recordAt(o), decisionId: forged, evidence: { ...evidenceAt(o), decisionId: forged } }] };
    }],
    ["a request hash disagreeing with evidence", (o) => ({ ...o, records: [{ ...recordAt(o), requestSha256: "0".repeat(64) }] })],
    ["allowed flag disagreeing with the decision", (o) => ({ ...o, records: [{ ...recordAt(o), allowed: false }] })],
    ["another actor's record", (o) => ({ ...o, records: [{ ...recordAt(o), evidence: { ...evidenceAt(o), actorSubject: "owner" } }] })],
    ["another operation's record", (o) => ({ ...o, records: [{ ...recordAt(o), evidence: { ...evidenceAt(o), operationId: "other" } }] })],
    ["a duplicated transaction", (o) => ({ ...o, records: [recordAt(o), recordAt(o)] })],
    ["a revision beyond current authority", (o) => ({ ...o, records: [{ ...recordAt(o), resultingPolicyRevision: 2,
      evidence: { ...evidenceAt(o), resultingPolicyRevision: 2 } }] })],
    ["an unknown allowed reason", (o) => ({ ...o, records: [{ ...recordAt(o), evidence: { ...evidenceAt(o),
      decision: { ...(evidenceAt(o).decision as object), reason: "superuser" } } }] })],
  ])("refuses to report an outcome from %s", async (_name, tamper) => {
    const model = new ReconciliationModel();
    const issuer = await principal("issuer");
    expect(await createTransactionalAuthorizationExecutor(model).execute(issuer, write())).toMatchObject({ status: "executed" });
    expect(await createOperationReconciler(model.reconciliationStore("issuer", tamper)).reconcile(issuer, write()))
      .toMatchObject({ status: "unavailable", outcome: "not-submitted" });
  });

  it("only permits reconciliation for active members of an active tenant", () => {
    const active = state();
    expect(reconciliationPermitted(active, "issuer")).toBe(true);
    expect(reconciliationPermitted(active, "stranger")).toBe(false);
    const suspended = structuredClone(active);
    (suspended.snapshot.tenant as { status: string }).status = "suspended";
    const validated = validateDurableAuthorityState(suspended);
    if (validated.status === "valid") expect(reconciliationPermitted(validated.value, "issuer")).toBe(false);
  });
});
