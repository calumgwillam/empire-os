import { createHash } from "node:crypto";
import { versions } from "node:process";
import type { AuthorizationDecision, AuthorizationReason } from "./authorization-contract";
import { isAuthorityIdentifier } from "./authorization-policy";
import {
  auditDecisionId, authorizationRequestContent, policyRequest, validateTransactionAuthorizationInput,
} from "./authorization-transaction";
import type {
  OperationReconciliationResult, OperationReconciliationStore, TransactionAuthorizationRequest,
} from "./authorization-transaction-contract";
import { validateDurableAuthorityState, type DurableAuthorityState } from "./durable-authorization-state";
import { isAuthenticatedPrincipal } from "./server-persistence-authority";
import { hasOnlyFields, isCounter, isObject, isSha256 } from "./server-persistence-contract";

if (!versions.node) throw new Error("Authorization reconciliation requires the Node.js runtime.");

const ALLOWED_REASONS = [
  "owner-authority", "direct-grant", "delegated-grant", "role-assignment-authorized", "delegation-authorized",
] as const satisfies readonly AuthorizationReason[];
const RECORD_FIELDS = ["transactionId", "decisionId", "requestSha256", "allowed", "resultingPolicyRevision", "evidence"];

type ObservedRecord = Readonly<{
  transactionId: string;
  decisionId: string;
  requestSha256: string;
  allowed: boolean;
  resultingPolicyRevision: number;
  operation: unknown;
  datasetId: unknown;
  decision: unknown;
}>;

function unavailable(message: string): OperationReconciliationResult {
  return { status: "unavailable", outcome: "not-submitted", message };
}

// Reconciliation discloses only the caller's own audit metadata, so it requires current
// active tenant membership rather than the original (possibly since-expired) capability.
export function reconciliationPermitted(state: DurableAuthorityState, subject: string): boolean {
  return state.snapshot.tenant.status === "active"
    && state.snapshot.memberships.some((member) => member.subject === subject && member.status === "active");
}

function observedRecord(value: unknown, tenantId: string, operationId: string, actor: string): ObservedRecord | null {
  if (!isObject(value) || !hasOnlyFields(value, RECORD_FIELDS) || Object.keys(value).length !== RECORD_FIELDS.length) return null;
  const { transactionId, decisionId, requestSha256, allowed, resultingPolicyRevision, evidence } = value;
  if (!isAuthorityIdentifier(transactionId) || !isSha256(decisionId) || !isSha256(requestSha256)
    || typeof allowed !== "boolean" || !isCounter(resultingPolicyRevision) || !isObject(evidence)
    || !isObject(evidence.decision)) return null;
  // Every field must agree with the immutable evidence and the executor's decision-ID derivation.
  if (evidence.version !== 1 || evidence.transactionId !== transactionId || evidence.decisionId !== decisionId
    || evidence.requestSha256 !== requestSha256 || evidence.actorSubject !== actor || evidence.tenantId !== tenantId
    || evidence.operationId !== operationId || evidence.resultingPolicyRevision !== resultingPolicyRevision
    || (evidence.decision.status !== "allowed" && evidence.decision.status !== "denied")
    || (evidence.decision.status === "allowed") !== allowed
    || decisionId !== auditDecisionId(transactionId, operationId)) return null;
  return {
    transactionId, decisionId, requestSha256, allowed, resultingPolicyRevision,
    operation: evidence.operation, datasetId: evidence.datasetId, decision: evidence.decision,
  };
}

function allowedDecision(value: unknown, revision: number): AuthorizationDecision | null {
  if (!isObject(value) || !hasOnlyFields(value, ["status", "reason", "policyVersion", "observedPolicyRevision", "evidenceId"])) return null;
  const reason = ALLOWED_REASONS.find((entry) => entry === value.reason);
  if (value.status !== "allowed" || !reason || value.policyVersion !== 1 || !isCounter(value.observedPolicyRevision)
    || value.observedPolicyRevision > revision
    || (value.evidenceId !== undefined && !isAuthorityIdentifier(value.evidenceId))) return null;
  return Object.freeze({
    status: "allowed", reason, policyVersion: 1, observedPolicyRevision: value.observedPolicyRevision,
    ...(typeof value.evidenceId === "string" ? { evidenceId: value.evidenceId } : {}),
  });
}

export function createOperationReconciler(store: OperationReconciliationStore) {
  return Object.freeze({
    // Trusted server code supplies the server-minted principal and the EXACT original request.
    // The request fingerprint is recomputed here; a caller-supplied hash is never accepted.
    async reconcile(principal: unknown, input: unknown): Promise<OperationReconciliationResult> {
      if (!isAuthenticatedPrincipal(principal)) return { status: "unauthorized", reason: "authentication-required" };
      let copy: unknown;
      try {
        copy = structuredClone(input);
      } catch {
        return { status: "invalid-request", message: "Operation must be a cloneable authorization request." };
      }
      let request: TransactionAuthorizationRequest | null;
      try {
        request = await validateTransactionAuthorizationInput(copy);
      } catch {
        return unavailable("Authorization request validation is unavailable.");
      }
      if (!request) return { status: "invalid-request", message: "Invalid transaction authorization request." };
      const requestSha256 = createHash("sha256").update(authorizationRequestContent(request)).digest("hex");
      const datasetId = policyRequest(request).datasetId;

      let observed: Awaited<ReturnType<OperationReconciliationStore["lookupOperation"]>>;
      try {
        observed = await store.lookupOperation(request.tenantId, request.operationId);
      } catch {
        return unavailable("Operation reconciliation storage is unavailable.");
      }
      if (!isObject(observed) || observed.status !== "observed") return unavailable("Operation reconciliation storage is unavailable.");
      const source = observed.source;
      if (source !== "test-model-only" && source !== "committed-database-read") return unavailable("Unverified reconciliation source.");
      const authority = validateDurableAuthorityState(observed.authority);
      if (authority.status !== "valid" || authority.value.snapshot.tenant.id !== request.tenantId
        || typeof observed.authorized !== "boolean" || !Array.isArray(observed.records)) {
        return unavailable("Authoritative tenant state is unavailable or inconsistent.");
      }
      // The store's independently bound actor must be this principal; never reveal another actor's outcome.
      if (observed.actorSubject !== principal.subject) return { status: "unauthorized", reason: "forbidden" };
      const permitted = reconciliationPermitted(authority.value, principal.subject);
      if (!permitted || !observed.authorized) {
        if (observed.records.length !== 0 || (permitted && !observed.authorized)) {
          return unavailable("Reconciliation authorization is inconsistent.");
        }
        return { status: "unauthorized", reason: "forbidden" };
      }

      const records: ObservedRecord[] = [];
      for (let index = 0; index < observed.records.length; index += 1) {
        const record = Object.prototype.hasOwnProperty.call(observed.records, index)
          ? observedRecord(observed.records[index], request.tenantId, request.operationId, principal.subject) : null;
        if (!record) return unavailable("Committed audit evidence is malformed.");
        records.push(record);
      }
      const revision = authority.value.snapshot.revision;
      const allowed = records.filter((record) => record.allowed);
      if (new Set(records.map((record) => record.transactionId)).size !== records.length || allowed.length > 1
        || records.some((record) => record.resultingPolicyRevision > revision)) {
        return unavailable("Committed audit evidence is inconsistent.");
      }

      const executed = allowed[0];
      if (executed) {
        if (executed.requestSha256 !== requestSha256 || executed.operation !== request.command.kind
          || executed.datasetId !== datasetId) {
          return { status: "conflict", operationId: request.operationId, message: "Operation ID was used for a different request." };
        }
        const decision = allowedDecision(executed.decision, revision);
        if (!decision) return unavailable("Committed audit decision is malformed.");
        return {
          status: "executed", operationId: request.operationId, transactionId: executed.transactionId,
          decisionId: executed.decisionId, decision, resultingPolicyRevision: executed.resultingPolicyRevision, source,
        };
      }
      if (records.some((record) => record.requestSha256 !== requestSha256)) {
        return { status: "conflict", operationId: request.operationId, message: "Operation ID was used for a different request." };
      }
      return { status: "not-executed", operationId: request.operationId, observedPolicyRevision: revision, source };
    },
  });
}
