import { randomUUID, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthorizationAuditEvidence, AuthorizationStoreResult, AuthorizationTransactionValue, LockedAuthorizationTransaction,
  OperationReconciliationStore, TransactionalAuthorizationStore,
} from "./authorization-transaction-contract";
import { evaluateAuthorization } from "./authorization-policy";
import { reconciliationPermitted } from "./authorization-reconciliation";
import type { AuthorizedDatasetReader, DatasetReadObservation } from "./authorized-dataset-read";
import {
  CONVERSION_STORAGE_KEY, DEFAULT_SAVED_VIEW_STORAGE_KEY, EMPIRE_OS_BACKUP_STORAGE_KEYS, STORAGE_KEY,
} from "./backup";
import type { DurableAuthorityState } from "./durable-authorization-state";
import { createDurableDatasetRepository } from "./durable-dataset-repository";
import { sha256 } from "./independent-backup";
import type { AuthenticatedPrincipal } from "./server-persistence-authority";
import { assertDatasetContent } from "./server-write-preparation";
import { prepareServerImport } from "./server-import-preparation";
import {
  commitRetryPolicy, writeBatchContent, type DatasetSnapshot, type ServerPersistenceRepository, type WriteBatch,
} from "./server-persistence-contract";
import { authorityFixture, testPrincipal } from "../../database/tests/authorization-fixtures";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); });

const DATASET_A = "00000000-0000-4000-8000-00000000000a";
const DATASET_B = "00000000-0000-4000-8000-00000000000b";
const fence = (datasetId = DATASET_A) => ({ datasetId, protocolVersion: 1 as const, generation: 1, authorityRevision: 0 });
function batch(key: string, rawValue: string | null, expectedRevision = 0, datasetId = DATASET_A): WriteBatch {
  return { fence: fence(datasetId), idempotencyKey: key, reads: [],
    writes: [{ key: STORAGE_KEY, expectedRevision, rawValue }] } as WriteBatch;
}
function barrier() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
type Row = { tenantId: string; datasetId: string; key: string; revision: number; rawValue: string | null; transactionId: string };

// Test-only model of the PostgreSQL adapter: one tenant lock, database-bound actor, fence/revision
// checks and the locked candidate hook inside the write transaction, allowed-audit uniqueness,
// committed denial audits, and atomic commit of audit + rows.
class DatasetDatabase {
  states = new Map<string, DurableAuthorityState>([
    ["tenant-a", authorityFixture("tenant-a", DATASET_A)], ["tenant-b", authorityFixture("tenant-b", DATASET_B)],
  ]);
  rows: Row[] = [];
  audits: AuthorizationAuditEvidence[] = [];
  commitMode: "confirm" | "lost-ack" | "fail" = "confirm";
  beforeLockedCheck: (() => void) | undefined;
  readTamper: ((observation: DatasetReadObservation) => DatasetReadObservation) | undefined;
  failImportAfterStore = false;
  clock = 1000;
  private tails = new Map<string, Promise<void>>();

  private async locked<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    const predecessor = this.tails.get(tenantId) ?? Promise.resolve();
    const lock = barrier();
    this.tails.set(tenantId, lock.promise);
    await predecessor;
    try { return await work(); } finally { lock.release(); }
  }
  private snapshotOf(tenantId: string, datasetId: string): DatasetSnapshot {
    const rows = this.rows.filter((row) => row.tenantId === tenantId && row.datasetId === datasetId);
    return { ...fence(datasetId), commitSequence: new Set(rows.map((row) => row.transactionId)).size,
      values: EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => {
        const latest = rows.filter((row) => row.key === key).sort((a, b) => b.revision - a.revision)[0];
        return { key, rawValue: latest?.rawValue ?? null, revision: latest?.revision ?? 0 };
      }) };
  }
  private decide(actor: AuthenticatedPrincipal, tenantId: string, datasetId: string) {
    const authority = this.states.get(tenantId);
    if (!authority) throw new Error("Missing tenant.");
    return { authority, decision: evaluateAuthorization(actor, authority.snapshot, {
      tenantId, datasetId, expectedPolicyRevision: authority.snapshot.revision, operation: "access", capability: "read",
    }, this.clock) };
  }

  reader(actor: AuthenticatedPrincipal): AuthorizedDatasetReader {
    return { readDataset: (tenantId, datasetId) => this.locked(tenantId, async () => {
      if (!this.states.has(tenantId)) return { status: "unavailable", message: "Missing tenant." };
      const { authority, decision } = this.decide(actor, tenantId, datasetId);
      const observation: DatasetReadObservation = {
        source: "committed-database-read", authority: structuredClone(authority), actorSubject: actor.subject,
        readDecision: { status: decision.status, reason: decision.reason }, checkedAt: this.clock,
        snapshot: decision.status === "allowed" ? this.snapshotOf(tenantId, datasetId) : null,
      };
      return { status: "observed", observation: this.readTamper ? this.readTamper(observation) : observation };
    }) };
  }

  transactionStore(actor: AuthenticatedPrincipal) {
    return (lockedWriteCandidate: (batch: WriteBatch, locked: DatasetSnapshot) => void): TransactionalAuthorizationStore => ({
      runLocked: (tenantId, operation, authorizationRequest) => this.locked(tenantId, async (): Promise<AuthorizationStoreResult> => {
        const transactionId = randomUUID();
        const staged: Row[] = [];
        const audits: AuthorizationAuditEvidence[] = [];
        const guards: (() => void)[] = [];
        let value: AuthorizationTransactionValue;
        try {
          const transaction: LockedAuthorizationTransaction = {
            transactionId,
            loadAuthority: async () => structuredClone(this.states.get(tenantId)),
            nowMs: () => this.clock,
            stageAuthority: async () => { throw new Error("Not modelled."); },
            stagePersistence: async (command) => {
              this.beforeLockedCheck?.();
              if (command.kind === "write") {
                const request = command.request;
                const current = this.snapshotOf(tenantId, request.fence.datasetId);
                if (!this.states.get(tenantId)?.snapshot.datasets.some((entry) => entry.datasetId === request.fence.datasetId)
                  || request.fence.generation !== 1 || request.fence.authorityRevision !== 0) throw new Error("Fence mismatch.");
                for (const entry of [...request.reads, ...request.writes]) {
                  if (current.values.find((value) => value.key === entry.key)?.revision !== entry.expectedRevision) {
                    throw new Error("Revision conflict.");
                  }
                }
                lockedWriteCandidate(request, current);
                staged.push(...request.writes.map((entry) => ({ tenantId, datasetId: request.fence.datasetId, key: entry.key,
                  revision: entry.expectedRevision + 1, rawValue: entry.rawValue, transactionId })));
              } else {
                const request = command.request;
                const current = this.snapshotOf(tenantId, request.fence.datasetId);
                if (!this.states.get(tenantId)?.snapshot.datasets.some((entry) => entry.datasetId === request.fence.datasetId)
                  || request.fence.generation !== 1 || request.fence.authorityRevision !== 0
                  || current.commitSequence !== 0 || current.values.some((value) => value.revision !== 0 || value.rawValue !== null)
                  || request.idempotencyKey !== authorizationRequest?.operationId) throw new Error("Import target is not pristine.");
                request.plan.entries.forEach(({ key, rawValue }, index) => {
                  staged.push({ tenantId, datasetId: request.fence.datasetId, key, revision: 1, rawValue, transactionId });
                  if (this.failImportAfterStore && index === 9) throw new Error("Injected mid-import failure.");
                });
              }
            },
            appendAudit: async (audit) => { audits.push(structuredClone(audit)); },
            beforeCommit: (guard) => { guards.push(guard); },
          };
          value = await operation(transaction);
          const audit = audits[0];
          // The database binds the actor from its role; the audit cannot claim another subject.
          if (audits.length !== 1 || guards.length !== 1 || audit.actorSubject !== actor.subject
            || (audit.decision.status === "allowed" && this.audits.some((entry) => entry.decision.status === "allowed"
              && entry.tenantId === tenantId && entry.actorSubject === audit.actorSubject && entry.operationId === audit.operationId))) {
            throw new Error("Audit constraint violated.");
          }
          guards[0]();
          if (this.commitMode === "fail") throw new Error("Commit failed.");
        } catch {
          return { status: "failed", outcome: "rolled-back", message: "Rolled back." };
        }
        this.rows.push(...staged);
        this.audits.push(...audits);
        if (this.commitMode === "lost-ack") return { status: "unavailable", outcome: "unknown", message: "Acknowledgement lost." };
        return { status: "committed", durability: "transaction-commit-confirmed", transactionId,
          auditDecisionId: audits[0].decisionId, value };
      }),
    });
  }

  reconciliationStore(actor: AuthenticatedPrincipal): OperationReconciliationStore {
    return { lookupOperation: (tenantId, operationId) => this.locked(tenantId, async () => {
      const authority = structuredClone(this.states.get(tenantId));
      if (!authority) return { status: "unavailable", message: "Missing tenant." };
      const authorized = reconciliationPermitted(authority, actor.subject);
      const records = authorized ? this.audits.filter((audit) => audit.tenantId === tenantId
        && audit.actorSubject === actor.subject && audit.operationId === operationId).map((audit) => ({
        transactionId: audit.transactionId, decisionId: audit.decisionId, requestSha256: audit.requestSha256,
        allowed: audit.decision.status === "allowed", resultingPolicyRevision: audit.resultingPolicyRevision,
        evidence: structuredClone(audit),
      })) : [];
      return { status: "observed", source: "committed-database-read", authority, actorSubject: actor.subject, authorized, records };
    }) };
  }

  repository(actor: AuthenticatedPrincipal, tenantId = "tenant-a"): ServerPersistenceRepository {
    return createDurableDatasetRepository({ principal: actor, tenantId, reader: this.reader(actor),
      transactionStore: this.transactionStore(actor), reconciliationStore: this.reconciliationStore(actor) });
  }
  // Raise the tenant policy revision without changing anyone's capabilities.
  bumpPolicy(tenantId = "tenant-a") {
    const state = structuredClone(this.states.get(tenantId)!);
    this.states.set(tenantId, { ...state, snapshot: { ...state.snapshot, revision: state.snapshot.revision + 1 } });
  }
  fingerprint(): string { return JSON.stringify([this.rows, this.audits.map((audit) => audit.transactionId)]); }
}

async function owner(datasetId = DATASET_A) { return testPrincipal("owner", datasetId); }

describe("durable dataset repository", () => {
  it("commits an authorised write atomically and reads it back as a recoverable snapshot", async () => {
    const db = new DatasetDatabase();
    const repository = db.repository(await owner());
    const initial = await repository.readSnapshot({ datasetId: DATASET_A, protocolVersion: 1 });
    expect(initial).toMatchObject({ status: "snapshot", snapshot: { commitSequence: 0 } });

    const raw = '[{"id":"capture-ü-😀","unknown":true}]';
    const request = batch("write-1", raw);
    const result = await repository.writeBatch(request);
    if (result.status !== "committed") throw new Error(JSON.stringify(result));
    expect(result.replayed).toBe(false);
    expect(result.receipt).toMatchObject({ durability: "database-commit-confirmed", commitSequence: 1,
      requestSha256: await sha256(writeBatchContent(request)), revisions: [{ key: STORAGE_KEY, revision: 1 }] });
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]).toMatchObject({ actorSubject: "owner", operationId: "write-1", decision: { status: "allowed" } });
    expect(result.receipt.transactionId).toBe(db.audits[0].transactionId);
    expect(commitRetryPolicy(result)).toBe("complete");

    const read = await repository.readSnapshot({ datasetId: DATASET_A, protocolVersion: 1 });
    if (read.status !== "snapshot") throw new Error(JSON.stringify(read));
    expect(read.snapshot.commitSequence).toBe(1);
    expect(read.snapshot.values.find((entry) => entry.key === STORAGE_KEY)).toEqual({ key: STORAGE_KEY, rawValue: raw, revision: 1 });
    expect(() => assertDatasetContent(read.snapshot)).not.toThrow();
  });

  it("chains writes on returned revisions and reports stale revisions as conflicts without effect", async () => {
    const db = new DatasetDatabase();
    const repository = db.repository(await owner());
    expect((await repository.writeBatch(batch("write-1", "[]"))).status).toBe("committed");
    const second = await repository.writeBatch(batch("write-2", '[{"id":"two","unknown":true}]', 1));
    expect(second).toMatchObject({ status: "committed", receipt: { commitSequence: 2, revisions: [{ revision: 2 }] } });
    const before = db.fingerprint();
    expect(await repository.writeBatch(batch("write-3", "[]", 1))).toMatchObject({ status: "conflict", reason: "store-revision" });
    expect(db.fingerprint()).toBe(before);
  });

  it("forbids reads and writes to actors without read authority, committing only a denial audit", async () => {
    const db = new DatasetDatabase();
    // issuer holds a write grant but no read grant; recipient holds nothing.
    for (const subject of ["issuer", "recipient"]) {
      const repository = db.repository(await testPrincipal(subject, DATASET_A));
      expect(await repository.readSnapshot({ datasetId: DATASET_A, protocolVersion: 1 }))
        .toEqual({ status: "unauthorized", reason: "forbidden" });
      expect(await repository.writeBatch(batch(`write-${subject}`, "[]"))).toEqual({ status: "unauthorized", reason: "forbidden" });
    }
    expect(db.rows).toEqual([]);
    expect(db.audits).toEqual([]);
  });

  it("isolates tenants: another tenant's dataset or membership never grants access", async () => {
    const db = new DatasetDatabase();
    const actor = await owner();
    await db.repository(actor, "tenant-b").writeBatch(batch("seed-b", "[]", 0, DATASET_B));
    const seeded = db.fingerprint();
    // owner of tenant-a cannot reach tenant-b's dataset through its own tenant scope.
    const crossDataset = db.repository(actor);
    expect(await crossDataset.readSnapshot({ datasetId: DATASET_B, protocolVersion: 1 }))
      .toEqual({ status: "unauthorized", reason: "forbidden" });
    expect(await crossDataset.writeBatch(batch("cross", "[]", 1, DATASET_B))).toEqual({ status: "unauthorized", reason: "forbidden" });
    // A non-member of tenant-b is refused when scoped to tenant-b.
    const outsider = db.repository(await testPrincipal("stranger", DATASET_B), "tenant-b");
    expect(await outsider.readSnapshot({ datasetId: DATASET_B, protocolVersion: 1 }))
      .toEqual({ status: "unauthorized", reason: "forbidden" });
    expect(await outsider.writeBatch(batch("stranger", "[]", 1, DATASET_B))).toEqual({ status: "unauthorized", reason: "forbidden" });
    expect(db.fingerprint()).toBe(seeded);
  });

  it("rejects an invalid business candidate and broken cross-store references with no effect", async () => {
    const db = new DatasetDatabase();
    const repository = db.repository(await owner());
    expect(await repository.writeBatch(batch("bad-json", "not-json"))).toMatchObject({ status: "invalid-request" });
    expect(await repository.writeBatch({ ...batch("bad-ref", null), writes: [{ key: CONVERSION_STORAGE_KEY, expectedRevision: 0,
      rawValue: '[{"id":"action","targetType":"Convert to Action","deliveryLeadId":"missing"}]' }] } as WriteBatch))
      .toMatchObject({ status: "invalid-request" });
    expect(db.rows).toEqual([]);
    expect(db.audits).toEqual([]);
  });

  it("re-validates the full candidate under the lock and rolls back a concurrent change", async () => {
    const db = new DatasetDatabase();
    const repository = db.repository(await owner());
    // Between the preflight read and the lock, another committed write makes the batch stale.
    db.beforeLockedCheck = () => {
      db.beforeLockedCheck = undefined;
      db.rows.push({ tenantId: "tenant-a", datasetId: DATASET_A, key: CONVERSION_STORAGE_KEY, revision: 1,
        rawValue: '[{"id":"action","targetType":"Convert to Action","deliveryLeadId":"missing"}]', transactionId: randomUUID() });
    };
    const before = db.audits.length;
    expect(await repository.writeBatch(batch("raced", "[]"))).toMatchObject({ status: "invalid-request" });
    expect(db.rows.filter((row) => row.key === STORAGE_KEY)).toEqual([]);
    expect(db.audits).toHaveLength(before);
  });

  it("returns the original receipt for an exact replay, even after the policy revision moved", async () => {
    const db = new DatasetDatabase();
    const repository = db.repository(await owner());
    const request = batch("write-1", "[]");
    const first = await repository.writeBatch(request);
    if (first.status !== "committed") throw new Error(JSON.stringify(first));
    const committed = db.fingerprint();
    const replay = await repository.writeBatch(request);
    expect(replay).toMatchObject({ status: "committed", replayed: true,
      receipt: { transactionId: first.receipt.transactionId, requestSha256: first.receipt.requestSha256 } });
    db.bumpPolicy();
    const later = await repository.writeBatch(request);
    expect(later).toMatchObject({ status: "committed", replayed: true, receipt: { transactionId: first.receipt.transactionId } });
    expect(db.fingerprint()).toBe(committed);
  });

  it("refuses to reuse an idempotency key for a different batch, before and after a policy change", async () => {
    const db = new DatasetDatabase();
    const repository = db.repository(await owner());
    expect((await repository.writeBatch(batch("write-1", "[]"))).status).toBe("committed");
    const committed = db.fingerprint();
    const different = batch("write-1", '[{"id":"other","unknown":true}]');
    expect(await repository.writeBatch(different)).toMatchObject({ status: "conflict", reason: "idempotency-key-reused" });
    db.bumpPolicy();
    expect(await repository.writeBatch(different)).toMatchObject({ status: "conflict", reason: "idempotency-key-reused" });
    // Same key, next revision: the stale batch matches nothing committed, so the key is still reused.
    expect(await repository.writeBatch(batch("write-1", "[]", 1))).toMatchObject({ status: "conflict", reason: "idempotency-key-reused" });
    expect(db.fingerprint()).toBe(committed);
  });

  it("recovers a lost commit acknowledgement as exactly one committed effect", async () => {
    const db = new DatasetDatabase();
    const repository = db.repository(await owner());
    db.commitMode = "lost-ack";
    const request = batch("write-1", "[]");
    const result = await repository.writeBatch(request);
    expect(result).toMatchObject({ status: "committed", replayed: true, receipt: { commitSequence: 1 } });
    if (result.status !== "committed") throw new Error("unreachable");
    expect(result.receipt.transactionId).toBe(db.audits[0].transactionId);
    db.commitMode = "confirm";
    expect(await repository.writeBatch(request)).toMatchObject({ status: "committed", replayed: true,
      receipt: { transactionId: result.receipt.transactionId } });
    expect(db.rows).toHaveLength(1);
  });

  it("reports a rolled-back commit as failed with no effect, and a later exact retry commits once", async () => {
    const db = new DatasetDatabase();
    const repository = db.repository(await owner());
    db.commitMode = "fail";
    const request = batch("write-1", "[]");
    const failed = await repository.writeBatch(request);
    expect(failed).toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(commitRetryPolicy(failed)).toBe("stop");
    expect(db.rows).toEqual([]);
    db.commitMode = "confirm";
    expect(await repository.writeBatch(request)).toMatchObject({ status: "committed", replayed: false });
    expect(db.rows).toHaveLength(1);
  });

  it("asks for an exact retry when authority changes between the preflight read and the lock", async () => {
    const db = new DatasetDatabase();
    const repository = db.repository(await owner());
    db.beforeLockedCheck = undefined;
    const reader = db.reader(await owner());
    const original = reader.readDataset.bind(reader);
    let raced = false;
    const racing = createDurableDatasetRepository({ principal: await owner(), tenantId: "tenant-a",
      reader: { readDataset: async (tenantId, datasetId) => {
        const result = await original(tenantId, datasetId);
        if (!raced) { raced = true; db.bumpPolicy(); }
        return result;
      } },
      transactionStore: db.transactionStore(await owner()), reconciliationStore: db.reconciliationStore(await owner()) });
    const request = batch("write-1", "[]");
    const stale = await racing.writeBatch(request);
    expect(stale).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(commitRetryPolicy(stale)).toBe("same-request-only");
    expect(db.rows).toEqual([]);
    expect(db.audits).toMatchObject([{ decision: { status: "denied", reason: "stale-policy" } }]);
    // The exact retry is authorised at the fresh revision despite the earlier committed denial.
    expect(await repository.writeBatch(request)).toMatchObject({ status: "committed", replayed: false });
  });

  it("fails closed when the store's actor, decision or stored content cannot be trusted", async () => {
    const db = new DatasetDatabase();
    const repository = db.repository(await owner());
    expect((await repository.writeBatch(batch("write-1", "[]"))).status).toBe("committed");
    const request = { datasetId: DATASET_A, protocolVersion: 1 as const };
    db.readTamper = (observation) => ({ ...observation, actorSubject: "issuer" });
    expect(await repository.readSnapshot(request)).toMatchObject({ status: "unavailable" });
    db.readTamper = (observation) => ({ ...observation, readDecision: { status: "allowed", reason: "direct-grant" } });
    expect(await repository.readSnapshot(request)).toMatchObject({ status: "unavailable" });
    db.readTamper = (observation) => ({ ...observation, source: "test-model-only" });
    expect(await repository.readSnapshot(request)).toMatchObject({ status: "unavailable" });
    db.readTamper = (observation) => ({ ...observation, snapshot: observation.snapshot && { ...observation.snapshot,
      values: observation.snapshot.values.map((entry) => entry.key === STORAGE_KEY ? { ...entry, rawValue: "not-json" } : entry) } });
    expect(await repository.readSnapshot(request)).toMatchObject({ status: "unavailable" });
    db.readTamper = undefined;
    // A denied store decision paired with data is inconsistent, never served.
    const issuer = await testPrincipal("issuer", DATASET_A);
    const leaking = createDurableDatasetRepository({ principal: issuer, tenantId: "tenant-a",
      reader: { readDataset: async (tenantId, datasetId) => {
        const result = await db.reader(issuer).readDataset(tenantId, datasetId);
        if (result.status !== "observed") return result;
        const full = await db.reader(await owner()).readDataset(tenantId, datasetId);
        return { status: "observed", observation: { ...result.observation,
          snapshot: full.status === "observed" ? full.observation.snapshot : null } };
      } },
      transactionStore: db.transactionStore(issuer), reconciliationStore: db.reconciliationStore(issuer) });
    expect(await leaking.readSnapshot(request)).toMatchObject({ status: "unavailable" });
  });

  it("never claims a commit when the reader is unavailable and leaves fingerprint lookup unresolved", async () => {
    const db = new DatasetDatabase();
    const actor = await owner();
    const broken = createDurableDatasetRepository({ principal: actor, tenantId: "tenant-a",
      reader: { readDataset: async () => { throw new Error("down"); } },
      transactionStore: db.transactionStore(actor), reconciliationStore: db.reconciliationStore(actor) });
    expect(await broken.writeBatch(batch("write-1", "[]"))).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(db.audits).toEqual([]);
    const repository = db.repository(actor);
    expect(await repository.lookupCommit({ datasetId: DATASET_A, protocolVersion: 1, generation: 1, idempotencyKey: "write-1",
      requestSha256: "0".repeat(64) })).toEqual({ status: "unresolved", retry: "same-request-only" });
    expect(await repository.stageImport({} as never)).toMatchObject({ status: "invalid-request" });
    expect(await repository.writeBatch({} as never)).toMatchObject({ status: "invalid-request" });
  });

  async function importRequest(idempotencyKey = "import-one", source: Record<string, string | null> = {
    [STORAGE_KEY]: ' [ {"id":"source","unknown":"\\u0061"} ] ',
    [DEFAULT_SAVED_VIEW_STORAGE_KEY]: "view\u0000\ud800\udfff\ud83d\ude00",
  }) {
    const prepared = await prepareServerImport({ getItem: (key) => source[key] ?? null });
    if (prepared.status !== "prepared") throw new Error(JSON.stringify(prepared));
    return { fence: fence(), idempotencyKey, plan: prepared.plan };
  }

  it("atomically stages all registered values losslessly, confirms COMMIT, and reads back an exact match", async () => {
    const db = new DatasetDatabase();
    const repository = db.repository(await owner());
    const request = await importRequest();
    const result = await repository.stageImport(request);
    expect(result).toMatchObject({
      status: "staged", replayed: false, receipt: { idempotencyKey: "import-one", commitSequence: 1,
        durability: "database-commit-confirmed", sourceSha256: request.plan.sourceSha256 },
    });
    expect(db.rows).toHaveLength(EMPIRE_OS_BACKUP_STORAGE_KEYS.length);
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]).toMatchObject({ operation: "stage-import", operationId: "import-one", decision: { status: "allowed" } });
    const read = await repository.readSnapshot({ datasetId: DATASET_A, protocolVersion: 1 });
    if (read.status !== "snapshot") throw new Error(JSON.stringify(read));
    expect(read.snapshot.values).toEqual(request.plan.entries.map(({ key, rawValue }) => ({ key, rawValue, revision: 1 })));
    expect(read.snapshot.values.find((entry) => entry.key === DEFAULT_SAVED_VIEW_STORAGE_KEY)?.rawValue)
      .toBe("view\u0000\ud800\udfff\ud83d\ude00");
  });

  it("does not report staged success when authorized post-COMMIT read-back differs", async () => {
    const db = new DatasetDatabase();
    db.readTamper = (observation) => {
      if (db.audits.length === 0 || observation.snapshot === null) return observation;
      return { ...observation, snapshot: {
        ...observation.snapshot,
        values: observation.snapshot.values.map((entry) => entry.key === DEFAULT_SAVED_VIEW_STORAGE_KEY
          ? { ...entry, rawValue: "tampered" } : entry),
      } };
    };
    const result = await db.repository(await owner()).stageImport(await importRequest());
    expect(result).toMatchObject({ status: "unavailable", outcome: "unknown" });
    expect(db.rows).toHaveLength(EMPIRE_OS_BACKUP_STORAGE_KEYS.length);
    expect(db.audits).toHaveLength(1);

    const uncertain = new DatasetDatabase();
    uncertain.commitMode = "lost-ack";
    uncertain.readTamper = (observation) => uncertain.audits.length > 0 && observation.snapshot ? {
      ...observation, snapshot: {
        ...observation.snapshot,
        values: observation.snapshot.values.map((entry) => entry.key === DEFAULT_SAVED_VIEW_STORAGE_KEY
          ? { ...entry, rawValue: "unreconciled database value" } : entry),
      },
    } : observation;
    const retryRepository = uncertain.repository(await owner());
    const retryRequest = await importRequest("lost-ack-readback");
    expect(await retryRepository.stageImport(retryRequest)).toMatchObject({ status: "unavailable", outcome: "unknown" });
    expect(uncertain.rows).toHaveLength(EMPIRE_OS_BACKUP_STORAGE_KEYS.length);
    expect(uncertain.audits).toHaveLength(1);
    uncertain.readTamper = undefined;
    expect(await retryRepository.stageImport(retryRequest)).toMatchObject({ status: "staged", replayed: true });
    expect(uncertain.rows).toHaveLength(EMPIRE_OS_BACKUP_STORAGE_KEYS.length);
    expect(uncertain.audits).toHaveLength(1);
  });

  it("rejects occupied targets and conflicting idempotency replay without changing committed rows", async () => {
    const db = new DatasetDatabase();
    const repository = db.repository(await owner());
    const first = await importRequest();
    expect((await repository.stageImport(first)).status).toBe("staged");
    const committed = db.fingerprint();
    expect(await repository.stageImport(await importRequest("import-two"))).toMatchObject({
      status: "conflict", reason: "import-source",
    });
    expect(db.fingerprint()).toBe(committed);
    const changed = await importRequest("import-one", {
      [STORAGE_KEY]: '[{"id":"different"}]',
      [DEFAULT_SAVED_VIEW_STORAGE_KEY]: "changed\u0000",
    });
    expect(await repository.stageImport(changed)).toMatchObject({ status: "conflict", reason: "idempotency-key-reused" });
    expect(db.fingerprint()).toBe(committed);
  });

  it("reconciles a lost COMMIT acknowledgement and exact replay only after fresh authenticated read-back", async () => {
    const db = new DatasetDatabase();
    const repository = db.repository(await owner());
    const request = await importRequest();
    const first = await repository.stageImport(request);
    expect(first).toMatchObject({ status: "staged", replayed: false });
    if (first.status !== "staged") throw new Error(JSON.stringify(first));

    db.readTamper = (observation) => observation.snapshot ? { ...observation, snapshot: {
      ...observation.snapshot,
      values: observation.snapshot.values.map((entry) => entry.key === DEFAULT_SAVED_VIEW_STORAGE_KEY
        ? { ...entry, rawValue: "database value differs" } : entry),
    } } : observation;
    expect(await repository.stageImport(request)).toMatchObject({ status: "unavailable", outcome: "unknown" });
    db.readTamper = undefined;

    db.bumpPolicy();
    expect(await repository.stageImport(request)).toMatchObject({ status: "staged", replayed: true,
      receipt: { requestSha256: first.receipt.requestSha256, transactionId: first.receipt.transactionId } });
    expect(db.rows).toHaveLength(EMPIRE_OS_BACKUP_STORAGE_KEYS.length);
    expect(db.audits).toHaveLength(1);

    const uncertain = new DatasetDatabase();
    uncertain.commitMode = "lost-ack";
    expect(await uncertain.repository(await owner()).stageImport(await importRequest("lost-ack")))
      .toMatchObject({ status: "staged", replayed: true, receipt: { durability: "database-commit-confirmed" } });
    expect(uncertain.rows).toHaveLength(EMPIRE_OS_BACKUP_STORAGE_KEYS.length);
    expect(uncertain.audits).toHaveLength(1);
  });

  it("rolls back the entire import after a mid-batch failure and never exposes partial stores", async () => {
    const db = new DatasetDatabase();
    db.failImportAfterStore = true;
    const result = await db.repository(await owner()).stageImport(await importRequest());
    expect(result).toMatchObject({ status: "failed", outcome: "rolled-back" });
    expect(db.rows).toEqual([]);
    expect(db.audits).toEqual([]);
  });

  it("fails closed for actor mismatch, unauthorized import, and incomplete source plans", async () => {
    const db = new DatasetDatabase();
    const request = await importRequest();
    const mismatched = createDurableDatasetRepository({
      principal: await testPrincipal("owner", DATASET_A), tenantId: "tenant-a",
      reader: db.reader(await testPrincipal("recipient", DATASET_A)),
      transactionStore: db.transactionStore(await testPrincipal("owner", DATASET_A)),
      reconciliationStore: db.reconciliationStore(await testPrincipal("owner", DATASET_A)),
    });
    expect(await mismatched.stageImport(request)).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    const tenantMismatchActor = await testPrincipal("owner", DATASET_A);
    const wrongTenant = createDurableDatasetRepository({ principal: tenantMismatchActor, tenantId: "tenant-b",
      reader: db.reader(tenantMismatchActor), transactionStore: db.transactionStore(tenantMismatchActor),
      reconciliationStore: db.reconciliationStore(tenantMismatchActor) });
    expect(await wrongTenant.stageImport(request)).toMatchObject({ status: "unauthorized", reason: "forbidden" });
    expect(await db.repository(await testPrincipal("recipient", DATASET_A)).stageImport(request))
      .toMatchObject({ status: "unauthorized", reason: "forbidden" });
    expect(await db.repository(await owner()).stageImport({
      ...request, plan: { ...request.plan, entries: request.plan.entries.slice(1) },
    })).toMatchObject({ status: "invalid-request" });
    expect(db.rows).toEqual([]);
    expect(db.audits).toEqual([]);
  });
});
