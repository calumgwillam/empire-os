import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import type { AuthorizationDecision, AuthorizationRequest, AuthorizationSnapshot } from "./authorization-contract";
import {
  evaluateAuthorization, isAuthorizationRequest, isAuthorityIdentifier,
} from "./authorization-policy";
import type {
  AuthorizationAuditEvidence, AuthorizationTransactionValue, TransactionAuthorizationCommand,
  TransactionAuthorizationRequest, TransactionAuthorizationResult, TransactionalAuthorizationStore,
} from "./authorization-transaction-contract";
import {
  isRevocationTarget, validateAuthorityTransition, validateDurableAuthorityState,
  type DurableAuthorityState,
} from "./durable-authorization-state";
import { isAuthenticatedPrincipal, type AuthenticatedPrincipal } from "./server-persistence-authority";
import {
  hasOnlyFields, isCounter, isDatasetId, isIdempotencyKey, isObject,
  validateWriteBatch,
} from "./server-persistence-contract";
import { encodeRawStoreValue, validateStageImportRequest } from "./server-import-preparation";

async function validateInput(value: unknown): Promise<TransactionAuthorizationRequest | null> {
  if (!isObject(value) || !hasOnlyFields(value, ["operationId", "tenantId", "expectedPolicyRevision", "command"])
    || !isIdempotencyKey(value.operationId) || !isAuthorityIdentifier(value.tenantId) || !isCounter(value.expectedPolicyRevision)
    || !isObject(value.command)) return null;
  const command = value.command;
  let validated: TransactionAuthorizationCommand;
  if (command.kind === "revoke") {
    if (!hasOnlyFields(command, ["kind", "datasetId", "target"]) || !isDatasetId(command.datasetId)
      || !isRevocationTarget(command.target)) return null;
    validated = { kind: "revoke", datasetId: command.datasetId, target: command.target };
  } else {
    if (!hasOnlyFields(command, ["kind", "request"])) return null;
    switch (command.kind) {
      case "write": {
        const batch = validateWriteBatch(command.request);
        if (batch.status !== "valid") return null;
        validated = { kind: "write", request: batch.value };
        break;
      }
      case "stage-import": {
        const staged = await validateStageImportRequest(command.request);
        if (staged.status === "failed") throw new Error("Import fingerprint validation is unavailable.");
        if (staged.status !== "valid") return null;
        validated = { kind: "stage-import", request: staged.value };
        break;
      }
      case "assign-role":
      case "delegate":
        if (!isAuthorizationRequest(command.request) || command.request.operation !== command.kind
          || command.request.tenantId !== value.tenantId
          || command.request.expectedPolicyRevision !== value.expectedPolicyRevision) return null;
        if (command.request.operation === "assign-role") validated = { kind: "assign-role", request: command.request };
        else validated = { kind: "delegate", request: command.request };
        break;
      default: return null;
    }
  }
  return { operationId: value.operationId, tenantId: value.tenantId, expectedPolicyRevision: value.expectedPolicyRevision, command: validated };
}

function policyRequest(input: TransactionAuthorizationRequest): AuthorizationRequest {
  const base = { tenantId: input.tenantId, expectedPolicyRevision: input.expectedPolicyRevision };
  const command = input.command;
  switch (command.kind) {
    case "assign-role":
    case "delegate": return command.request;
    case "revoke": return { ...base, operation: "access", datasetId: command.datasetId, capability: "read" };
    case "write": return { ...base, operation: "access", datasetId: command.request.fence.datasetId, capability: "write" };
    case "stage-import": return { ...base, operation: "access", datasetId: command.request.fence.datasetId, capability: "import" };
  }
}

function decisionFor(principal: AuthenticatedPrincipal, state: AuthorizationSnapshot,
  input: TransactionAuthorizationRequest, nowMs: number): AuthorizationDecision {
  const decision = evaluateAuthorization(principal, state, policyRequest(input), nowMs);
  if (input.command.kind !== "revoke" || decision.status === "denied") return decision;
  if (decision.reason !== "owner-authority") return Object.freeze({
    status: "denied", reason: "owner-required", policyVersion: 1, observedPolicyRevision: state.revision,
  });
  const { target } = input.command;
  const exists = target.kind === "membership" ? state.memberships.some((entry) => entry.subject === target.id && entry.status === "active")
    : target.kind === "role" ? state.roles.some((entry) => entry.id === target.id && entry.status === "active")
    : state.delegations.some((entry) => entry.id === target.id && entry.status === "active");
  if (!exists || (target.kind === "membership" && state.tenant.ownerSubjects.includes(target.id))) return Object.freeze({
    status: "denied", reason: "invalid-request", policyVersion: 1, observedPolicyRevision: state.revision,
  });
  return decision;
}

function authorityMutation(state: DurableAuthorityState, principal: AuthenticatedPrincipal,
  input: TransactionAuthorizationRequest, nowMs: number): DurableAuthorityState {
  const snapshot = state.snapshot;
  const command = input.command;
  let next = { ...snapshot, revision: snapshot.revision + 1 };
  let revocations = state.revocations;
  switch (command.kind) {
    case "assign-role": {
      const request = command.request;
      next = { ...next, memberships: snapshot.memberships.map((member) => member.subject === request.recipientSubject
        ? { ...member, revision: member.revision + 1, roleIds: [...new Set([...member.roleIds, request.roleId])] } : member) };
      break;
    }
    case "delegate": {
      const request = command.request;
      const issuer = snapshot.memberships.find((member) => member.subject === principal.subject);
      const recipient = snapshot.memberships.find((member) => member.subject === request.recipientSubject);
      const role = snapshot.roles.find((entry) => entry.id === request.sourceRoleId);
      if (!issuer || !recipient || !role) throw new Error("Authorized delegation source disappeared.");
      next = { ...next, delegations: [...snapshot.delegations, {
        id: input.operationId, tenantId: input.tenantId, datasetId: request.datasetId,
        issuerSubject: principal.subject, recipientSubject: request.recipientSubject, capability: request.capability,
        sourceRoleId: role.id, sourceGrantId: request.sourceGrantId, sourceRoleRevision: role.revision,
        issuerMembershipRevision: issuer.revision, recipientMembershipRevision: recipient.revision,
        issuedAt: nowMs, expiresAt: request.expiresAt, status: "active",
      }] };
      break;
    }
    case "revoke": {
      const target = command.target;
      if (target.kind === "membership") next = { ...next, memberships: snapshot.memberships.map((entry) =>
        entry.subject === target.id ? { ...entry, revision: entry.revision + 1, status: "revoked" } : entry) };
      if (target.kind === "role") next = { ...next, roles: snapshot.roles.map((entry) =>
        entry.id === target.id ? { ...entry, revision: entry.revision + 1, status: "revoked" } : entry) };
      if (target.kind === "delegation") next = { ...next, delegations: snapshot.delegations.map((entry) =>
        entry.id === target.id ? { ...entry, status: "revoked" } : entry) };
      revocations = [...revocations, { ...target, operationId: input.operationId, policyRevision: next.revision, revokedAt: nowMs }];
      break;
    }
    default: throw new Error("Persistence commands cannot mutate authority.");
  }
  const proposed = { schemaVersion: 1 as const, snapshot: next, revocations };
  const validated = validateAuthorityTransition(state, proposed, nowMs);
  if (validated.status !== "valid") throw new Error("Authority transition violated durable invariants.");
  return validated.value;
}

// Hex preserves every UTF-16 code unit, including values PostgreSQL JSONB cannot represent.
export function authorizationRequestContent(input: TransactionAuthorizationRequest): string {
  const command = input.command;
  return JSON.stringify(command.kind === "write" ? {
    ...input, command: { kind: "write", request: {
      ...command.request,
      writes: command.request.writes.map(({ rawValue, ...entry }) => {
        const bytes = encodeRawStoreValue(rawValue);
        return { ...entry, rawValueHex: bytes === null ? null : Buffer.from(bytes).toString("hex") };
      }),
    } },
  } : input);
}

export function createTransactionalAuthorizationExecutor(store: TransactionalAuthorizationStore) {
  return Object.freeze({
    // The caller is trusted server code; this is not an endpoint or an authentication resolver.
    async execute(principal: unknown, input: unknown): Promise<TransactionAuthorizationResult> {
      if (!isAuthenticatedPrincipal(principal)) return { status: "unauthorized", reason: "authentication-required" };
      let copy: unknown;
      try {
        copy = structuredClone(input);
      } catch {
        return { status: "invalid-request", message: "Operation must be a cloneable authorization request." };
      }
      let request: TransactionAuthorizationRequest | null;
      try {
        request = await validateInput(copy);
      } catch {
        return { status: "unavailable", outcome: "not-submitted", message: "Authorization request validation is unavailable." };
      }
      if (!request) return { status: "invalid-request", message: "Invalid transaction authorization request." };
      const requestSha256 = createHash("sha256").update(authorizationRequestContent(request)).digest("hex");
      let expected: AuthorizationTransactionValue | undefined;
      let inconsistent = false;
      try {
        const result = await store.runLocked(request.tenantId, async (transaction) => {
          if (!isAuthorityIdentifier(transaction.transactionId)) throw new Error("Invalid transaction identifier.");
          const observed = validateDurableAuthorityState(await transaction.loadAuthority());
          if (observed.status !== "valid" || observed.value.snapshot.tenant.id !== request.tenantId) {
            inconsistent = true;
            throw new Error("Authoritative tenant state is unavailable or inconsistent.");
          }
          // Detach the authoritative read so staged adapter writes cannot mutate this evidence.
          const state = structuredClone(observed.value);
          const checkedAt = transaction.nowMs();
          if (!isCounter(checkedAt)) throw new Error("Invalid transaction clock.");
          const decision = decisionFor(principal, state.snapshot, request, checkedAt);
          let resultingPolicyRevision = state.snapshot.revision;
          if (decision.status === "allowed") {
            if (request.command.kind === "write" || request.command.kind === "stage-import") {
              await transaction.stagePersistence(request.command);
            } else {
              const next = authorityMutation(state, principal, request, checkedAt);
              await transaction.stageAuthority(next);
              resultingPolicyRevision = next.snapshot.revision;
            }
          }
          const completedAt = transaction.nowMs();
          if (!isCounter(completedAt) || completedAt < checkedAt) throw new Error("Transaction clock moved backwards.");
          // The lock excludes concurrent authority changes; expiry still changes without a revision.
          const finalDecision = decisionFor(principal, state.snapshot, request, completedAt);
          if (decision.status === "allowed" && finalDecision.status !== "allowed") {
            throw new Error("Authorization expired before the transaction completion boundary.");
          }
          const audit: AuthorizationAuditEvidence = Object.freeze({
            version: 1, operationId: request.operationId,
            decisionId: createHash("sha256").update(JSON.stringify([transaction.transactionId, request.operationId, "decision", 1])).digest("hex"),
            transactionId: transaction.transactionId, requestSha256, actorSubject: principal.subject,
            tenantId: request.tenantId, datasetId: policyRequest(request).datasetId, operation: request.command.kind,
            ...(request.command.kind === "write" || request.command.kind === "stage-import"
              ? {} : { authorityChange: structuredClone(request.command) }),
            decision: finalDecision, checkedAt, completedAt, resultingPolicyRevision,
          });
          await transaction.appendAudit(audit);
          transaction.beforeCommit(() => {
            const commitTime = transaction.nowMs();
            if (!isCounter(commitTime) || commitTime < completedAt
              || (decision.status === "allowed" && decisionFor(principal, state.snapshot, request, commitTime).status !== "allowed")) {
              throw new Error("Authorization is no longer valid at the commit boundary.");
            }
          });
          expected = { decision: finalDecision, audit };
          return expected;
        }, request);
        if (result.status !== "committed") {
          if (inconsistent && result.status === "failed" && result.outcome === "rolled-back") return {
            status: "unavailable", outcome: "not-submitted", message: "Authoritative tenant state is unavailable or inconsistent.",
          };
          return result;
        }
        if (!expected || result.transactionId !== expected.audit.transactionId
          || result.auditDecisionId !== expected.audit.decisionId || JSON.stringify(result.value) !== JSON.stringify(expected)
          || (result.durability !== "test-model-only" && result.durability !== "transaction-commit-confirmed")) return {
          status: "unavailable", outcome: "unknown", message: "Atomic authorization and audit commit could not be confirmed.",
        };
        return {
          status: expected.decision.status === "allowed" ? "executed" : "denied",
          decision: expected.decision, operationId: request.operationId, decisionId: expected.audit.decisionId,
          transactionId: result.transactionId, durability: result.durability,
        };
      } catch {
        return { status: "unavailable", outcome: "unknown", message: "Authorization transaction outcome could not be confirmed." };
      }
    },
  });
}
