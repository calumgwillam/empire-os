import type { AuthorizationDecision, AuthorizationRequest } from "./authorization-contract";
import type { DurableAuthorityState, RevocationTarget } from "./durable-authorization-state";
import type { StageImportRequest, WriteBatch } from "./server-persistence-contract";

export type SensitivePersistenceCommand =
  | Readonly<{ kind: "write"; request: WriteBatch }>
  | Readonly<{ kind: "stage-import"; request: StageImportRequest }>;
export type TransactionAuthorizationCommand = SensitivePersistenceCommand
  | Readonly<{ kind: "assign-role"; request: Extract<AuthorizationRequest, { operation: "assign-role" }> }>
  | Readonly<{ kind: "delegate"; request: Extract<AuthorizationRequest, { operation: "delegate" }> }>
  | Readonly<{ kind: "revoke"; datasetId: string; target: RevocationTarget }>;
export type TransactionAuthorizationRequest = Readonly<{
  operationId: string;
  tenantId: string;
  expectedPolicyRevision: number;
  command: TransactionAuthorizationCommand;
}>;
export type AuthorizationAuditEvidence = Readonly<{
  version: 1;
  operationId: string;
  decisionId: string;
  transactionId: string;
  requestSha256: string;
  actorSubject: string;
  tenantId: string;
  datasetId: string;
  operation: TransactionAuthorizationCommand["kind"];
  authorityChange?: Exclude<TransactionAuthorizationCommand, SensitivePersistenceCommand>;
  decision: AuthorizationDecision;
  checkedAt: number;
  completedAt: number;
  resultingPolicyRevision: number;
}>;

// All methods use ONE connection/transaction and a tenant-wide lock acquired before reads.
// No method may commit, release locks, write externally or retain this context after return.
export interface LockedAuthorizationTransaction {
  readonly transactionId: string;
  loadAuthority(): Promise<unknown>;
  nowMs(): number;
  stagePersistence(command: SensitivePersistenceCommand): Promise<void>;
  stageAuthority(state: DurableAuthorityState): Promise<void>;
  appendAudit(evidence: AuthorizationAuditEvidence): Promise<void>;
  // Invoke synchronously after staging/audit checks, immediately before committing.
  // Failure must roll back all staged effects. No intervening asynchronous test-model work.
  beforeCommit(check: () => void): void;
}

export type AuthorizationTransactionValue = Readonly<{
  decision: AuthorizationDecision;
  audit: AuthorizationAuditEvidence;
}>;
export type AuthorizationStoreResult =
  | Readonly<{
    status: "committed";
    durability: "test-model-only" | "transaction-commit-confirmed";
    transactionId: string;
    auditDecisionId: string;
    value: AuthorizationTransactionValue;
  }>
  | Readonly<{ status: "failed"; outcome: "rolled-back"; message: string }>
  | Readonly<{ status: "unavailable"; outcome: "not-submitted" | "unknown"; message: string }>;

export interface TransactionalAuthorizationStore {
  // stagePersistence must validate generation/store fences and idempotency, not just access.
  // Dataset authorityRevision is a separate fence, NOT the tenant policy revision.
  // Every authority writer, including provisioning/recovery/revocation, must take this
  // same lock. Enforce globally unique dataset-to-tenant ownership, including provisioning.
  // Commit only after exactly one matching audit and all staged effects.
  // Callback errors require rollback; lost COMMIT acknowledgement requires "unknown".
  // Reject reused successful operation IDs; replay/lookup needs fresh authorization and
  // is intentionally not supplied here. Never auto-retry callbacks or return "committed"
  // before confirmed atomic COMMIT. Decision IDs are unique per transaction attempt.
  // Database adapters require the full request to bind independently authorized effects.
  runLocked(
    tenantId: string,
    operation: (transaction: LockedAuthorizationTransaction) => Promise<AuthorizationTransactionValue>,
    request?: TransactionAuthorizationRequest,
  ): Promise<AuthorizationStoreResult>;
}

// Read-only reconciliation of an operation whose outcome was unknown or whose retry failed.
export type OperationLookupStoreResult =
  | Readonly<{
    status: "observed";
    source: "test-model-only" | "committed-database-read";
    // Untrusted until validated by the reconciler.
    authority: unknown;
    actorSubject: unknown;
    authorized: unknown;
    records: unknown;
  }>
  | Readonly<{ status: "unavailable"; message: string }>;

export interface OperationReconciliationStore {
  // Acquire the SAME tenant-wide lock as runLocked BEFORE reading, so any in-flight transaction
  // for this tenant (including one whose COMMIT acknowledgement was lost) has finished.
  // Read only committed state; never stage, commit or write any effect.
  // actorSubject is bound independently by the store (e.g. database role), never by the caller.
  // records contain ONLY this actor's audits for this tenant and operation ID, and MUST be empty
  // unless the store independently authorized reconciliation against the locked current state.
  lookupOperation(tenantId: string, operationId: string): Promise<OperationLookupStoreResult>;
}

export type OperationReconciliationResult =
  | Readonly<{
    // An allowed audit for this exact request committed: its effect exists exactly once.
    status: "executed";
    operationId: string;
    transactionId: string;
    decisionId: string;
    decision: AuthorizationDecision;
    resultingPolicyRevision: number;
    source: "test-model-only" | "committed-database-read";
  }>
  | Readonly<{
    // No allowed audit had committed when the tenant lock was held. Only the exact same
    // request with the same operation ID may be retried; never generate a new operation ID.
    status: "not-executed";
    operationId: string;
    observedPolicyRevision: number;
    source: "test-model-only" | "committed-database-read";
  }>
  | Readonly<{
    status: "conflict"; operationId: string; message: string;
    // Present only when a well-formed allowed WRITE for this dataset committed under this operation
    // ID: the policy revision that request was authorized against. A hint for exact-replay checks,
    // never proof that the effect matches; re-reconcile the exact request at that revision.
    executedPolicyRevision?: number;
  }>
  | Readonly<{ status: "unauthorized"; reason: "authentication-required" | "forbidden" }>
  | Readonly<{ status: "invalid-request"; message: string }>
  | Readonly<{ status: "unavailable"; outcome: "not-submitted"; message: string }>;

export type TransactionAuthorizationResult =
  | Readonly<{
    status: "executed" | "denied";
    decision: AuthorizationDecision;
    operationId: string;
    decisionId: string;
    transactionId: string;
    durability: "test-model-only" | "transaction-commit-confirmed";
  }>
  | Readonly<{ status: "unauthorized"; reason: "authentication-required" }>
  | Readonly<{ status: "invalid-request"; message: string }>
  | Extract<AuthorizationStoreResult, { status: "failed" | "unavailable" }>;
