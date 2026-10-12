import "server-only";
import { createHash } from "node:crypto";
import { auditDecisionId } from "./authorization-transaction";
import { reconciliationPermitted } from "./authorization-reconciliation";
import { isAuthorityIdentifier } from "./authorization-policy";
import type { OperationReconciliationStore } from "./authorization-transaction-contract";
import { validateDurableAuthorityState } from "./durable-authorization-state";
import {
  employeeProvisioningRequest, validateEmployeeProvisioningInput, type EmployeeProvisioningInput,
} from "./employee-provisioning-contract";
import { employeeProvisioningRelease } from "./employee-provisioning-release";
import { isAuthenticatedPrincipal } from "./server-persistence-authority";
import { hasOnlyFields, isCounter, isDatasetId, isObject, isSha256 } from "./server-persistence-contract";

export type EmployeeProvisioningReconciliationInput = Readonly<{
  original: EmployeeProvisioningInput;
  requestSha256: string;
  transactionId?: string;
}>;

export type EmployeeProvisioningReconciliationResult =
  | Readonly<{
    status: "verified-committed"; source: "committed-database-read";
    operationId: string; requestSha256: string; transactionId: string; decisionId: string;
    resultingPolicyRevision: number; observedPolicyRevision: number;
  }>
  | Readonly<{
    status: "verified-not-committed"; source: "committed-database-read";
    reason: "original-revision-permanently-fenced"; operationId: string; requestSha256: string;
    observedPolicyRevision: number;
  }>
  | Readonly<{ status: "unknown"; reason: "authentication-unavailable" | "database-visibility-unavailable" | "absence-without-revision-fence" }>
  | Readonly<{ status: "integrity-conflict"; reason: "request-fingerprint" | "identity-binding" | "authority" | "audit" }>
  | Readonly<{ status: "disabled"; reason: "migration-005-disabled" }>
  | Readonly<{ status: "unauthorized"; reason: "authentication-required" | "forbidden" }>
  | Readonly<{ status: "invalid-request"; message: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECORD_FIELDS = ["transactionId", "decisionId", "requestSha256", "allowed", "resultingPolicyRevision", "evidence"];
const EVIDENCE_FIELDS = ["version", "transactionId", "decisionId", "requestSha256", "operationId",
  "actorSubject", "tenantId", "datasetId", "operation", "authorityChange", "decision",
  "checkedAt", "completedAt", "resultingPolicyRevision"];

function exactFields(value: Record<string, unknown>, fields: readonly string[]) {
  return Object.keys(value).length === fields.length && hasOnlyFields(value, fields);
}

export function validateProvisioningReconciliationInput(value: unknown):
  | Readonly<{ status: "valid"; value: EmployeeProvisioningReconciliationInput }>
  | Extract<EmployeeProvisioningReconciliationResult, { status: "invalid-request" }> {
  const invalid = { status: "invalid-request" as const, message: "Invalid original provisioning reconciliation request." };
  if (!isObject(value) || !hasOnlyFields(value, ["original", "requestSha256", "transactionId"])
    || !isSha256(value.requestSha256)
    || (Object.hasOwn(value, "transactionId")
      && (typeof value.transactionId !== "string" || !UUID.test(value.transactionId)))) return invalid;
  const original = validateEmployeeProvisioningInput(value.original);
  if (original.status !== "valid") return invalid;
  return { status: "valid", value: Object.freeze({
    original: original.value, requestSha256: value.requestSha256,
    ...(typeof value.transactionId === "string" ? { transactionId: value.transactionId } : {}),
  }) };
}

export function createEmployeeProvisioningReconciler(store: OperationReconciliationStore, tenantId: string) {
  if (!isAuthorityIdentifier(tenantId)) throw new Error("Invalid server reconciliation tenant.");
  return Object.freeze({
    async reconcile(principal: unknown, input: unknown): Promise<EmployeeProvisioningReconciliationResult> {
      if (!isAuthenticatedPrincipal(principal)) return { status: "unauthorized", reason: "authentication-required" };
      const parsed = validateProvisioningReconciliationInput(input);
      if (parsed.status !== "valid") return parsed;
      const { original, requestSha256, transactionId } = parsed.value;
      const bound = employeeProvisioningRequest(tenantId, original);
      const hash = createHash("sha256").update(JSON.stringify(bound)).digest("hex");
      if (requestSha256 !== hash) return { status: "integrity-conflict", reason: "request-fingerprint" };
      const release = employeeProvisioningRelease();
      if (release.status !== "approved" || release.migrationVersion !== 5) {
        return { status: "disabled", reason: "migration-005-disabled" };
      }
      let observed: Awaited<ReturnType<OperationReconciliationStore["lookupOperation"]>>;
      try {
        observed = await store.lookupOperation(tenantId, original.operationId);
      } catch {
        return { status: "unknown", reason: "database-visibility-unavailable" };
      }
      if (!isObject(observed) || observed.status !== "observed" || observed.source !== "committed-database-read") {
        return { status: "unknown", reason: "database-visibility-unavailable" };
      }
      const loaded = validateDurableAuthorityState(observed.authority);
      if (loaded.status !== "valid" || loaded.value.snapshot.tenant.id !== tenantId
        || typeof observed.authorized !== "boolean" || !Array.isArray(observed.records)) {
        return { status: "integrity-conflict", reason: "authority" };
      }
      if (observed.actorSubject !== principal.subject) return { status: "integrity-conflict", reason: "identity-binding" };
      const state = loaded.value;
      if (!observed.authorized || !reconciliationPermitted(state, principal.subject)
        || !state.snapshot.tenant.ownerSubjects.includes(principal.subject)) {
        return { status: "unauthorized", reason: "forbidden" };
      }
      const revision = state.snapshot.revision;
      // lookup_operation waits on the writer's tenant lock and returns ALL this actor's
      // records. Absence alone cannot exclude delayed/queued dispatch of the original.
      if (observed.records.length === 0) {
        if (revision > original.expectedPolicyRevision) {
          return {
            status: "verified-not-committed", source: "committed-database-read",
            reason: "original-revision-permanently-fenced", operationId: original.operationId,
            requestSha256, observedPolicyRevision: revision,
          };
        }
        return { status: "unknown", reason: "absence-without-revision-fence" };
      }
      // Provisioning has exactly one allowed audit and never emits denial evidence.
      if (observed.records.length !== 1) return { status: "integrity-conflict", reason: "audit" };
      const record: unknown = observed.records[0];
      if (!isObject(record) || !exactFields(record, RECORD_FIELDS)
        || typeof record.transactionId !== "string" || !UUID.test(record.transactionId)
        || !isSha256(record.decisionId) || record.requestSha256 !== hash || record.allowed !== true
        || !isCounter(record.resultingPolicyRevision)
        || record.resultingPolicyRevision !== original.expectedPolicyRevision + 1
        || record.resultingPolicyRevision > revision
        || (transactionId !== undefined && transactionId !== record.transactionId)
        || record.decisionId !== auditDecisionId(record.transactionId, original.operationId)
        || !isObject(record.evidence) || !exactFields(record.evidence, EVIDENCE_FIELDS)) {
        return { status: "integrity-conflict", reason: "audit" };
      }
      const evidence = record.evidence;
      const decision = evidence.decision;
      const effects = evidence.authorityChange;
      if (evidence.version !== 1 || evidence.transactionId !== record.transactionId
        || evidence.decisionId !== record.decisionId || evidence.requestSha256 !== hash
        || evidence.operationId !== original.operationId || evidence.actorSubject !== principal.subject
        || evidence.tenantId !== tenantId || evidence.operation !== "provision-member"
        || evidence.resultingPolicyRevision !== record.resultingPolicyRevision
        || !isDatasetId(evidence.datasetId)
        || evidence.datasetId !== state.snapshot.datasets.map(dataset => dataset.datasetId).sort()[0]
        || !isCounter(evidence.checkedAt) || !isCounter(evidence.completedAt)
        || evidence.completedAt < evidence.checkedAt
        || !isObject(decision) || !exactFields(decision, ["status", "reason", "policyVersion", "observedPolicyRevision"])
        || decision.status !== "allowed" || decision.reason !== "owner-authority" || decision.policyVersion !== 1
        || decision.observedPolicyRevision !== original.expectedPolicyRevision
        || !isObject(effects) || !exactFields(effects, ["kind", "subject", "roleIds"])
        || effects.kind !== "provision-member" || effects.subject !== original.subject
        || !Array.isArray(effects.roleIds) || effects.roleIds.length !== original.roleIds.length
        || !effects.roleIds.every((role, index) => role === original.roleIds[index])) {
        return { status: "integrity-conflict", reason: "audit" };
      }
      const member = state.snapshot.memberships.find(entry => entry.subject === original.subject);
      // Later legitimate authority operations may revoke or reassign the employee.
      // At the original revision, however, the exact new membership must still match.
      if (!member || (revision === record.resultingPolicyRevision
        && (member.status !== "active" || member.revision !== 1
          || member.roleIds.length !== original.roleIds.length
          || !member.roleIds.every((role, index) => role === original.roleIds[index])))) {
        return { status: "integrity-conflict", reason: "authority" };
      }
      return {
        status: "verified-committed", source: "committed-database-read",
        operationId: original.operationId, requestSha256: hash,
        transactionId: record.transactionId, decisionId: record.decisionId,
        resultingPolicyRevision: record.resultingPolicyRevision, observedPolicyRevision: revision,
      };
    },
  });
}
