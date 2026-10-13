import { versions } from "node:process";
import { evaluateAuthorization } from "./authorization-policy";
import { createOperationReconciler } from "./authorization-reconciliation";
import { authorizationRequestContent, createTransactionalAuthorizationExecutor } from "./authorization-transaction";
import type {
  OperationReconciliationStore, TransactionAuthorizationRequest, TransactionalAuthorizationStore,
} from "./authorization-transaction-contract";
import type { AuthorizedDatasetReader } from "./authorized-dataset-read";
import { validateDurableAuthorityState, type DurableAuthorityState } from "./durable-authorization-state";
import {
  createPostgresAuthorizationStore, createPostgresDatasetSnapshotReader, createPostgresOperationReconciliationStore,
  type AuthorizationPostgresSource,
} from "./postgres-authorization-store";
import {
  createServerPersistenceAuthority, type AuthenticatedPrincipal, type PersistenceCapability, type ServerSessionResolution,
} from "./server-persistence-authority";
import {
  validateCommitLookup, validateCommitReceipt, validateSnapshot, validateSnapshotRequest, writeBatchContent,
  type BatchConflict, type CommitResult, type DatasetSnapshot, type PersistenceProblem, type ServerPersistenceRepository,
  type StageImportResult, type WriteBatch,
} from "./server-persistence-contract";
import { assertDatasetContent, prepareServerWrite, prepareWriteCandidate, type PreparedWrite } from "./server-write-preparation";
import { verifyStageImportSnapshot, validateStageImportRequest } from "./server-import-preparation";
import { sha256 } from "./independent-backup";

if (!versions.node) throw new Error("Durable dataset persistence requires the Node.js runtime.");

export type DurableDatasetRepositoryDependencies = Readonly<{
  // Server-minted principal; every store below must independently bind the SAME actor (e.g. its database role).
  principal: AuthenticatedPrincipal;
  // Server-owned tenant scope, never a request field.
  tenantId: string;
  reader: AuthorizedDatasetReader;
  // A fresh store per write. It must invoke lockedWriteCandidate synchronously under the tenant lock,
  // inside the write transaction, with the committed dataset; a throw must roll everything back.
  transactionStore(lockedWriteCandidate: (batch: WriteBatch, locked: DatasetSnapshot) => void): TransactionalAuthorizationStore;
  reconciliationStore: OperationReconciliationStore;
}>;

type Observed = Readonly<{ authority: DurableAuthorityState; snapshot: DatasetSnapshot; checkedAt: number }>;
type Resolution =
  | Readonly<{ kind: "executed"; transactionId: string; requestSha256: string }>
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "reused" }>
  | Readonly<{ kind: "problem"; problem: Extract<PersistenceProblem, { status: "unauthorized" }> | "unavailable" }>;

function unavailable(outcome: "not-submitted" | "unknown", message: string): PersistenceProblem {
  return { status: "unavailable", outcome, message };
}
const CONFIRMATION_LOST = "The write outcome could not be confirmed; retry only the exact original request.";
const IMPORT_CONFIRMATION_LOST = "The import outcome could not be confirmed; retry only the exact original request.";

// Commit receipts are issued ONLY from database-confirmed COMMIT or committed audit evidence.
// commitSequence is the dataset's committed write count observed when the receipt was confirmed:
// exact for a direct commit, and at least the original value for a recovered (replayed) receipt.
export function createDurableDatasetRepository(dependencies: DurableDatasetRepositoryDependencies): ServerPersistenceRepository {
  const { principal, tenantId, reader } = dependencies;
  const reconciler = createOperationReconciler(dependencies.reconciliationStore);

  async function observe(datasetId: string): Promise<Observed | PersistenceProblem> {
    let result: Awaited<ReturnType<AuthorizedDatasetReader["readDataset"]>>;
    try {
      result = await reader.readDataset(tenantId, datasetId);
    } catch {
      return unavailable("not-submitted", "Dataset storage is unavailable.");
    }
    if (result?.status !== "observed") return unavailable("not-submitted", "Dataset storage is unavailable.");
    const observation = result.observation;
    if (observation.source !== "committed-database-read") return unavailable("not-submitted", "Unverified dataset source.");
    const authority = validateDurableAuthorityState(observation.authority);
    if (authority.status !== "valid" || authority.value.snapshot.tenant.id !== tenantId) {
      return unavailable("not-submitted", "Authoritative tenant state is unavailable or inconsistent.");
    }
    // The store's independently bound identity must be this principal; never serve another actor's view.
    if (observation.actorSubject !== principal.subject) return unavailable("not-submitted", "Dataset identity binding is inconsistent.");
    const revision = authority.value.snapshot.revision;
    const decision = evaluateAuthorization(principal, authority.value.snapshot, {
      tenantId, datasetId, expectedPolicyRevision: revision, operation: "access", capability: "read",
    }, observation.checkedAt);
    // Defence in depth: the store's decision and this independent evaluation must agree exactly.
    if (decision.status !== observation.readDecision.status || decision.reason !== observation.readDecision.reason) {
      return unavailable("not-submitted", "Dataset read authorization is inconsistent.");
    }
    if (decision.status !== "allowed") {
      return observation.snapshot === null ? { status: "unauthorized", reason: "forbidden" }
        : unavailable("not-submitted", "Dataset read authorization is inconsistent.");
    }
    const snapshot = validateSnapshot(observation.snapshot);
    if (snapshot.status !== "valid" || snapshot.value.datasetId !== datasetId) {
      return unavailable("not-submitted", "Stored dataset snapshot is malformed.");
    }
    try {
      assertDatasetContent(snapshot.value);
    } catch {
      // Fail closed: never serve stored business data that would not hydrate or recover.
      return unavailable("not-submitted", "Stored dataset failed integrity validation.");
    }
    return { authority: authority.value, snapshot: snapshot.value, checkedAt: observation.checkedAt };
  }

  function receipt(prepared: PreparedWrite, transactionId: string, commitSequence: number, replayed: boolean): CommitResult {
    const { batch, requestSha256 } = prepared;
    const validated = validateCommitReceipt({
      fence: batch.fence, idempotencyKey: batch.idempotencyKey, requestSha256, transactionId, commitSequence,
      durability: "database-commit-confirmed",
      revisions: batch.writes.map((entry) => ({ key: entry.key, revision: entry.expectedRevision + 1 })),
    }, batch, requestSha256);
    if (validated.status !== "valid") return unavailable("unknown", CONFIRMATION_LOST);
    return { status: "committed", receipt: validated.value, replayed };
  }

  async function reconcileOnce(request: TransactionAuthorizationRequest) {
    try {
      return await reconciler.reconcile(principal, request);
    } catch {
      return null;
    }
  }

  // Did THIS exact batch commit under this operation ID? The executed request may have been
  // authorized at an earlier policy revision; its audit fingerprint must still match exactly.
  async function resolve(request: TransactionAuthorizationRequest): Promise<Resolution> {
    const first = await reconcileOnce(request);
    let result = first;
    let reconciledRequest = request;
    if (first?.status === "conflict" && first.executedPolicyRevision !== undefined
      && first.executedPolicyRevision !== request.expectedPolicyRevision) {
      reconciledRequest = { ...request, expectedPolicyRevision: first.executedPolicyRevision };
      result = await reconcileOnce(reconciledRequest);
      if (result?.status === "not-executed" || result?.status === "conflict") return { kind: "reused" };
    }
    if (!result) return { kind: "problem", problem: "unavailable" };
    switch (result.status) {
      case "executed":
        if (result.source !== "committed-database-read") return { kind: "problem", problem: "unavailable" };
        try {
          return { kind: "executed", transactionId: result.transactionId,
            requestSha256: await sha256(authorizationRequestContent(reconciledRequest)) };
        } catch {
          return { kind: "problem", problem: "unavailable" };
        }
      case "not-executed": return { kind: "absent" };
      // A different allowed write holds this key. Without that hint only denied attempts (or a
      // non-write) used it, so THIS batch has no committed effect.
      case "conflict": return result.executedPolicyRevision !== undefined ? { kind: "reused" } : { kind: "absent" };
      case "unauthorized": return { kind: "problem", problem: { status: "unauthorized", reason: result.reason } };
      default: return { kind: "problem", problem: "unavailable" };
    }
  }

  async function recovered(prepared: PreparedWrite, transactionId: string, outcome: "not-submitted" | "unknown"): Promise<CommitResult> {
    const current = await observe(prepared.batch.fence.datasetId);
    if (!("snapshot" in current)) return unavailable(outcome, CONFIRMATION_LOST);
    return receipt(prepared, transactionId, current.snapshot.commitSequence, true);
  }

  async function afterUncertain(prepared: PreparedWrite, request: TransactionAuthorizationRequest,
    outcome: "rolled-back" | "unknown"): Promise<CommitResult> {
    const resolution = await resolve(request);
    switch (resolution.kind) {
      case "executed": return recovered(prepared, resolution.transactionId, "unknown");
      case "reused": return { status: "conflict", reason: "idempotency-key-reused", message: "Idempotency key was used for a different write." };
      case "problem":
        return resolution.problem === "unavailable" ? unavailable(outcome === "unknown" ? "unknown" : "not-submitted", CONFIRMATION_LOST)
          : resolution.problem;
      case "absent": break;
    }
    if (outcome === "unknown") return unavailable("not-submitted", "The write did not commit; retry only the exact original request.");
    // Report a concurrent precondition change as a conflict the client can rebase on.
    const current = await observe(prepared.batch.fence.datasetId);
    if ("snapshot" in current) {
      const candidate = prepareWriteCandidate(prepared.batch, current.snapshot);
      if (candidate.status === "conflict") return candidate;
    }
    return { status: "failed", outcome: "rolled-back", message: "The write was rolled back; no effect was committed." };
  }

  return Object.freeze({
    async readSnapshot(input: unknown) {
      const request = validateSnapshotRequest(input);
      if (request.status !== "valid") return request;
      const observed = await observe(request.value.datasetId);
      return "snapshot" in observed ? { status: "snapshot" as const, snapshot: observed.snapshot } : observed;
    },

    async writeBatch(input: unknown): Promise<CommitResult> {
      const prepared = await prepareServerWrite(input);
      if (prepared.status !== "valid") return prepared;
      const { batch } = prepared.value;
      // Writes require read capability: full-candidate validation needs the committed dataset.
      const before = await observe(batch.fence.datasetId);
      if (!("snapshot" in before)) return before;
      // The policy revision always comes from the server read, never from the client.
      const request: TransactionAuthorizationRequest = {
        operationId: batch.idempotencyKey, tenantId, expectedPolicyRevision: before.authority.snapshot.revision,
        command: { kind: "write", request: batch },
      };
      const preflight = prepareWriteCandidate(batch, before.snapshot);
      if (preflight.status === "conflict") {
        // A committed exact replay advances the stores it wrote, so it surfaces here as a conflict.
        const resolution = await resolve(request);
        if (resolution.kind === "executed") return receipt(prepared.value, resolution.transactionId, before.snapshot.commitSequence, true);
        if (resolution.kind === "reused") return { status: "conflict", reason: "idempotency-key-reused", message: "Idempotency key was used for a different write." };
        if (resolution.kind === "problem") {
          return resolution.problem === "unavailable" ? unavailable("not-submitted", "Write replay could not be verified.") : resolution.problem;
        }
        return preflight;
      }
      if (preflight.status !== "valid") return preflight;

      const content = writeBatchContent(batch);
      let locked: Readonly<{ status: "valid"; commitSequence: number }> | BatchConflict | PersistenceProblem | undefined;
      const store = dependencies.transactionStore((stagedBatch, lockedSnapshot) => {
        if (writeBatchContent(stagedBatch) !== content) {
          locked = { status: "invalid-request", message: "Staged write differs from the prepared request." };
          throw new Error("Staged write differs from the prepared request.");
        }
        const candidate = prepareWriteCandidate(stagedBatch, lockedSnapshot);
        if (candidate.status !== "valid") {
          locked = candidate;
          throw new Error("Locked write candidate was rejected.");
        }
        locked = { status: "valid", commitSequence: candidate.value.commitSequence };
      });
      let executed: Awaited<ReturnType<ReturnType<typeof createTransactionalAuthorizationExecutor>["execute"]>>;
      try {
        executed = await createTransactionalAuthorizationExecutor(store).execute(principal, request);
      } catch {
        executed = { status: "unavailable", outcome: "unknown", message: CONFIRMATION_LOST };
      }
      const lockedResult = locked as typeof locked;
      switch (executed.status) {
        case "executed":
          if (executed.durability !== "transaction-commit-confirmed" || lockedResult?.status !== "valid") {
            return unavailable("unknown", CONFIRMATION_LOST);
          }
          return receipt(prepared.value, executed.transactionId, lockedResult.commitSequence, false);
        case "denied":
          // Nothing executed; a fresh server read supplies the new policy revision on retry.
          if (executed.decision.reason === "stale-policy") {
            return unavailable("not-submitted", "Authorization changed during the write; retry the exact original request.");
          }
          return { status: "unauthorized", reason: "forbidden" };
        case "unauthorized": return { status: "unauthorized", reason: "authentication-required" };
        case "invalid-request": return { status: "invalid-request", message: executed.message };
        case "failed":
          // The locked candidate check threw: confirmed rollback with a definite reason.
          if (lockedResult && lockedResult.status !== "valid") return lockedResult;
          return afterUncertain(prepared.value, request, "rolled-back");
        case "unavailable":
          if (executed.outcome === "not-submitted") return unavailable("not-submitted", executed.message);
          return afterUncertain(prepared.value, request, "unknown");
      }
    },

    // CommitLookup carries only a fingerprint, not the batch, so it cannot be reconciled against the
    // audited request. Retrying the exact same batch is safe and returns the committed receipt.
    async lookupCommit(input: unknown) {
      const request = validateCommitLookup(input);
      if (request.status !== "valid") return request;
      return { status: "unresolved" as const, retry: "same-request-only" as const };
    },

    async stageImport(input: unknown): Promise<StageImportResult> {
      const validated = await validateStageImportRequest(input);
      if (validated.status !== "valid") return validated.status === "source-invalid" || validated.status === "source-changed"
        ? { status: "invalid-request", message: validated.message } : validated;
      const stage = validated.value;

      // Import requires both import authority and read authority: the existing committed snapshot
      // is the occupancy guard, and a first commit must be independently read back before success.
      const before = await observe(stage.fence.datasetId);
      if (!("snapshot" in before)) return before;
      const importDecision = evaluateAuthorization(principal, before.authority.snapshot, {
        tenantId, datasetId: stage.fence.datasetId, expectedPolicyRevision: before.authority.snapshot.revision,
        operation: "access", capability: "import",
      }, before.checkedAt);
      if (importDecision.status !== "allowed") return { status: "unauthorized", reason: "forbidden" };

      const request: TransactionAuthorizationRequest = {
        operationId: stage.idempotencyKey, tenantId,
        expectedPolicyRevision: before.authority.snapshot.revision,
        command: { kind: "stage-import", request: stage },
      };
      let requestSha256: string;
      try {
        requestSha256 = await sha256(authorizationRequestContent(request));
      } catch {
        return unavailable("not-submitted", "Import request fingerprint could not be established.");
      }
      const toResult = (transactionId: string, committedRequestSha256: string, replayed: boolean): StageImportResult => ({
        status: "staged", replayed, receipt: Object.freeze({
          fence: stage.fence, generation: stage.fence.generation, sourceSha256: stage.plan.sourceSha256,
          transactionId, idempotencyKey: stage.idempotencyKey, requestSha256: committedRequestSha256, commitSequence: 1,
          durability: "database-commit-confirmed",
        }),
      });
      const confirmCommittedImport = async (
        transactionId: string, committedRequestSha256: string, replayed: boolean,
      ): Promise<StageImportResult> => {
        const after = await observe(stage.fence.datasetId);
        if (!("snapshot" in after)) return unavailable("unknown",
          "Import COMMIT was confirmed, but authorized read-back could not be completed; retry only the exact original request.");
        let verification: Awaited<ReturnType<typeof verifyStageImportSnapshot>>;
        try {
          verification = await verifyStageImportSnapshot(stage, after.snapshot);
        } catch {
          return unavailable("unknown",
            "Import COMMIT was confirmed, but exact source-to-database verification could not be completed; preserve the database state for investigation.");
        }
        if (verification.status !== "matches") return unavailable("unknown",
          "Import COMMIT was confirmed, but exact source-to-database verification failed; preserve the database state for investigation.");
        return toResult(transactionId, committedRequestSha256, replayed);
      };
      const resolution = await resolve(request);
      if (resolution.kind === "executed") {
        return confirmCommittedImport(resolution.transactionId, resolution.requestSha256, true);
      }
      if (resolution.kind === "reused") {
        return { status: "conflict", reason: "idempotency-key-reused", message: "Import idempotency key was used for different content." };
      }
      if (resolution.kind === "problem") {
        return resolution.problem === "unavailable"
          ? unavailable("not-submitted", "Import replay could not be verified.") : resolution.problem;
      }

      const isEmpty = before.snapshot.commitSequence === 0
        && before.snapshot.values.every((value) => value.revision === 0 && value.rawValue === null);
      if (!isEmpty) return {
        status: "conflict", reason: "import-source",
        message: "Import target is already initialized; no stored values were changed.",
      };

      let executed: Awaited<ReturnType<ReturnType<typeof createTransactionalAuthorizationExecutor>["execute"]>>;
      try {
        executed = await createTransactionalAuthorizationExecutor(
          dependencies.transactionStore(() => undefined),
        ).execute(principal, request);
      } catch {
        executed = { status: "unavailable", outcome: "unknown", message: IMPORT_CONFIRMATION_LOST };
      }

      if (executed.status === "executed") {
        if (executed.durability !== "transaction-commit-confirmed") return unavailable("unknown", IMPORT_CONFIRMATION_LOST);
        return confirmCommittedImport(executed.transactionId, requestSha256, false);
      }

      if (executed.status === "unauthorized") return executed;
      if (executed.status === "invalid-request") return executed;
      if (executed.status === "unavailable" && executed.outcome === "not-submitted") return executed;
      if (executed.status === "denied") {
        return executed.decision.reason === "stale-policy"
          ? unavailable("not-submitted", "Authorization changed during import; retry the exact original request.")
          : { status: "unauthorized", reason: "forbidden" };
      }

      const resolved = await resolve(request);
      if (resolved.kind === "executed") {
        return confirmCommittedImport(resolved.transactionId, resolved.requestSha256, true);
      }
      if (resolved.kind === "reused") {
        return { status: "conflict", reason: "idempotency-key-reused", message: "Import idempotency key was used for different content." };
      }
      if (resolved.kind === "problem") {
        return resolved.problem === "unavailable"
          ? unavailable(executed.status === "unavailable" && executed.outcome === "unknown" ? "unknown" : "not-submitted",
            IMPORT_CONFIRMATION_LOST)
          : resolved.problem;
      }
      if (executed.status === "failed" && executed.outcome === "rolled-back") {
        const current = await observe(stage.fence.datasetId);
        if ("snapshot" in current && (current.snapshot.commitSequence !== 0
          || current.snapshot.values.some((value) => value.revision !== 0 || value.rawValue !== null))) {
          return { status: "conflict", reason: "import-source",
            message: "Import target became initialized; no stored values were overwritten." };
        }
        return executed;
      }
      return unavailable("not-submitted", "The import did not commit; retry only the exact original request.");
    },
  }) as ServerPersistenceRepository;
}

// Every connection from source MUST authenticate as the restricted database role provisioned
// for exactly this principal; the database derives the actor from that role, never from here.
export function createPostgresDurableDatasetRepository(
  principal: AuthenticatedPrincipal, tenantId: string, source: AuthorizationPostgresSource,
): ServerPersistenceRepository {
  return createDurableDatasetRepository({
    principal, tenantId, reader: createPostgresDatasetSnapshotReader(source),
    transactionStore: (lockedWriteCandidate) => createPostgresAuthorizationStore(source, { lockedWriteCandidate }),
    reconciliationStore: createPostgresOperationReconciliationStore(source),
  });
}

export type DurableServerPersistenceDependencies = Readonly<{
  resolveSession(request: Request): Promise<ServerSessionResolution>;
  // Server-owned tenant for this deployment; never derived from the request.
  tenantId: string;
  // Must return the per-principal restricted source, or throw. There is deliberately no shared default.
  sourceForPrincipal(principal: AuthenticatedPrincipal): AuthorizationPostgresSource;
}>;

// Not routed or activated. Coarse capability checks use committed authority read under the tenant
// lock; the repository and the database each re-enforce authority for the actual operation.
export function createDurableServerPersistenceAuthority(dependencies: DurableServerPersistenceDependencies) {
  const { tenantId } = dependencies;
  return createServerPersistenceAuthority({
    resolveSession: (request) => dependencies.resolveSession(request),
    async authorize(principal: AuthenticatedPrincipal, datasetId: string, capability: PersistenceCapability) {
      const read = await createPostgresDatasetSnapshotReader(dependencies.sourceForPrincipal(principal)).readDataset(tenantId, datasetId);
      if (read.status !== "observed" || read.observation.actorSubject !== principal.subject) {
        throw new Error("Authorization state is unavailable.");
      }
      const { authority, checkedAt } = read.observation;
      const allowed = (requestedCapability: PersistenceCapability) => evaluateAuthorization(principal, authority.snapshot, {
        tenantId, datasetId, expectedPolicyRevision: authority.snapshot.revision,
        operation: "access", capability: requestedCapability,
      }, checkedAt).status === "allowed";
      if (!allowed(capability)) return false;
      // The repository requires read authorization to guard occupancy and verify exact read-back.
      return capability !== "import" || allowed("read");
    },
    repositoryForPrincipal: (principal) => createPostgresDurableDatasetRepository(
      principal, tenantId, dependencies.sourceForPrincipal(principal)),
  });
}
