import "server-only";
import { resolveClerkSession } from "./clerk-session-resolver";
import { isAuthorizedFounder } from "./founder-access";
import { isAuthorityIdentifier } from "./authorization-policy";
import {
  IDENTITY_REAUTHENTICATION_WINDOW_MS, isContributionIdentityRegistry, isIdentityPerson,
  resolveContributionIdentityBinding, type ContributionIdentityRegistry, type IdentityPerson,
} from "./contribution-identity-authority";
import { validateDurableAuthorityState, type DurableAuthorityState } from "./durable-authorization-state";
import {
  isExactDataRecord as exactData, isFounderEligibilityDecisionRequest as decisionRequest,
  type FounderEligibilityDecisionRequest,
} from "./founder-eligibility-decision-contract";
import { createServerPrincipalResolver, isAuthenticatedPrincipal } from "./server-persistence-authority";
import { hasOnlyFields, isCounter, isIdempotencyKey, isObject, type PersistenceProblem } from "./server-persistence-contract";
import { isPersonEligibilityEvent, type PersonEligibilityEvent } from "./trusted-person-authority-source";

export const ELIGIBILITY_PROVENANCE_MISSING_DEPENDENCIES = Object.freeze([
  "approved-independent-issuer-authority-and-revocation-source",
  "verified-person-source-reference-and-evidence-digest",
  "locked-latest-eligibility-event-and-exact-event-reconciliation",
] as const);

export type EligibilityProvenanceCheckpoint = Readonly<{
  tenantId: string;
  personId: string;
  personRevision: number;
  issuerRevision: number;
  nowMs: number;
}>;

// A read envelope for the existing immutable event, not another event registry.
// Only a future independently approved source may establish issuer status/revision,
// verify the referenced evidence, and return this envelope under compatible locks.
export type CandidateEligibilityProvenance = Readonly<{
  event: PersonEligibilityEvent;
  issuer: Readonly<{ subject: string; revision: number; status: "active" | "revoked" }>;
  verifiedAtMs: number;
}>;

function forbidden(): PersistenceProblem {
  return { status: "unauthorized", reason: "forbidden" };
}
function founderProblem(principal: unknown): PersistenceProblem | null {
  if (!isAuthenticatedPrincipal(principal)) return { status: "unauthorized", reason: "authentication-required" };
  return isAuthorizedFounder(principal.subject, process.env.EMPIRE_OS_FOUNDER_CLERK_USER_ID) ? null : forbidden();
}

function missingProvenance(): PersistenceProblem {
  return {
    status: "unavailable", outcome: "not-submitted",
    message: `Eligibility provenance is unresolved: ${ELIGIBILITY_PROVENANCE_MISSING_DEPENDENCIES.join(", ")}.`,
  };
}

// Invoked while the existing member transaction still holds its locks. Database
// ownership, issuer_subject, source_reference, digest and xid are not independent
// proof that an authenticated authorized issuer approved this historical event.
// No caller envelope, current founder session or candidate validator can release it.
export function storedEligibilityProvenanceProblem(event: unknown): PersistenceProblem | null {
  if (!isPersonEligibilityEvent(event)) return forbidden();
  return missingProvenance();
}

// Authentication establishes the CURRENT founder, never historical event issuance.
// No injectable verifier, source fallback, environment approval or success branch.
export async function inspectEligibilityProvenanceReadiness(request: Request): Promise<PersistenceProblem> {
  const principal = await createServerPrincipalResolver(resolveClerkSession)(request);
  if (!isAuthenticatedPrincipal(principal)) return principal;
  const problem = founderProblem(principal);
  if (problem) return problem;
  return missingProvenance();
}

// Consistency only. Even with an authenticated founder, caller-supplied provenance
// and matching checkpoints cannot establish independent issuer/source authenticity.
// The result is not a grant, verified provenance, a COMMIT receipt or source approval.
export function validateCandidateEligibilityProvenance(
  issuerPrincipal: unknown, checkpoint: unknown, event: unknown, provenance: unknown,
): Readonly<{ status: "valid"; event: PersonEligibilityEvent }> | PersistenceProblem {
  const problem = founderProblem(issuerPrincipal);
  if (problem) return problem;
  if (!isAuthenticatedPrincipal(issuerPrincipal)) return forbidden();
  if (!isObject(checkpoint) || !hasOnlyFields(checkpoint, [
    "tenantId", "personId", "personRevision", "issuerRevision", "nowMs",
  ]) || !isAuthorityIdentifier(checkpoint.tenantId) || !isAuthorityIdentifier(checkpoint.personId)
    || !isCounter(checkpoint.personRevision) || checkpoint.personRevision === 0
    || !isCounter(checkpoint.issuerRevision) || checkpoint.issuerRevision === 0 || !isCounter(checkpoint.nowMs)
    || !isPersonEligibilityEvent(event)
    || !isObject(provenance) || !hasOnlyFields(provenance, ["event", "issuer", "verifiedAtMs"])
    || !isPersonEligibilityEvent(provenance.event)
    || !isObject(provenance.issuer) || !hasOnlyFields(provenance.issuer, ["subject", "revision", "status"])
    || provenance.issuer.status !== "active" || provenance.issuer.subject !== issuerPrincipal.subject
    || provenance.issuer.revision !== checkpoint.issuerRevision
    || !isCounter(provenance.verifiedAtMs) || provenance.verifiedAtMs > checkpoint.nowMs
    || provenance.verifiedAtMs < event.recordedAtMs
    || event.recordedAtMs > checkpoint.nowMs || event.issuerSubject !== issuerPrincipal.subject
    || event.tenantId !== checkpoint.tenantId || event.personId !== checkpoint.personId
    || event.revision !== checkpoint.personRevision) return forbidden();

  // All validated event fields must match, not just operation ID, revision or hash.
  // Exact comparison preserves uncertain-COMMIT reconciliation without resubmission.
  const fields = Object.keys(event) as (keyof PersonEligibilityEvent)[];
  const observed = provenance.event;
  if (fields.some(field => event[field] !== observed[field])) return forbidden();
  return { status: "valid", event: Object.freeze({ ...event }) };
}

export type { FounderEligibilityDecisionRequest };

// Hypothetical locked reads only. No loader exists; none of these caller-shaped
// fields establish provenance, verified reauthentication or authoritative People.
export type CandidateFounderEligibilityObservation = Readonly<{
  registry: ContributionIdentityRegistry;
  authority: DurableAuthorityState;
  issuerPerson: IdentityPerson;
  targetPerson: IdentityPerson;
  issuerEligibility: PersonEligibilityEvent;
  latestTargetEvent: PersonEligibilityEvent | null;
  usedOperationIds: readonly string[];
  authenticatedAtMs: number;
  nowMs: number;
}>;

// Preparatory policy model, NOT an issuer authorization or executable plan.
// Future installation must independently verify the reads/source, keep registry ->
// tenant locks through append, resample time and reconcile exact events on unknown
// COMMIT. This function cannot authenticate the observation or prove those locks.
export function planCandidateFounderEligibilityDecision(
  principal: unknown, input: unknown, observation: unknown,
): Readonly<{
  status: "candidate";
  subject: string;
  bindingId: string;
  issuerBindingId: string;
  expectedRegistryRevision: number;
  expectedBindingRevision: number;
  expectedPolicyRevision: number;
  expectedPersonRevision: number;
  issuerPersonRevision: number;
  validUntilMs: number;
  event: PersonEligibilityEvent;
}> | PersistenceProblem {
  const problem = founderProblem(principal);
  if (problem) return problem;
  if (!isAuthenticatedPrincipal(principal) || !decisionRequest(input)
    || !exactData(observation, [
      "registry", "authority", "issuerPerson", "targetPerson", "issuerEligibility",
      "latestTargetEvent", "usedOperationIds", "authenticatedAtMs", "nowMs",
    ]) || !isContributionIdentityRegistry(observation.registry)
    || !isIdentityPerson(observation.issuerPerson) || !isIdentityPerson(observation.targetPerson)
    || !isPersonEligibilityEvent(observation.issuerEligibility)
    || !(observation.latestTargetEvent === null || isPersonEligibilityEvent(observation.latestTargetEvent))
    || !Array.isArray(observation.usedOperationIds)
    || Array.from(observation.usedOperationIds).some(id => !isIdempotencyKey(id))
    || new Set(observation.usedOperationIds).size !== observation.usedOperationIds.length
    || !isCounter(observation.nowMs) || !isCounter(observation.authenticatedAtMs)) return forbidden();
  const { registry, issuerPerson, targetPerson, issuerEligibility, latestTargetEvent, nowMs, authenticatedAtMs } = observation;
  const validUntilMs = authenticatedAtMs + IDENTITY_REAUTHENTICATION_WINDOW_MS;
  const authority = validateDurableAuthorityState(observation.authority);
  if (authority.status !== "valid" || !isCounter(validUntilMs) || authenticatedAtMs > nowMs || nowMs >= validUntilMs
    || registry.revision !== input.expectedRegistryRevision || registry.bindingRevision !== input.expectedBindingRevision
    || registry.events.some(event => event.recordedAtMs > nowMs || event.operationId === input.operationId)
    || observation.usedOperationIds.includes(input.operationId)
    || issuerEligibility.operationId === input.operationId || latestTargetEvent?.operationId === input.operationId
    || input.expectedPersonRevision === Number.MAX_SAFE_INTEGER) return forbidden();
  const state = authority.value.snapshot;
  const issuer = resolveContributionIdentityBinding(registry, principal.subject);
  const target = resolveContributionIdentityBinding(registry, input.subject);
  const inTenant = (bindingId: string) => registry.events.some(event =>
    (event.kind === "subject-bound" || event.kind === "binding-reassigned")
    && event.bindingId === bindingId && event.tenantId === input.tenantId);
  const member = state.memberships.find(entry => entry.subject === input.subject);
  if (!issuer || !target || !inTenant(issuer.bindingId) || !inTenant(target.bindingId)
    || principal.subject === input.subject || issuer.personId === target.personId
    || state.tenant.id !== input.tenantId || state.tenant.status !== "active"
    || state.revision !== input.expectedPolicyRevision || !state.tenant.ownerSubjects.includes(principal.subject)
    || !state.memberships.some(entry => entry.subject === principal.subject && entry.status === "active")
    || !member || (input.decision === "issue" && member.status !== "active")
    || issuerPerson.tenantId !== input.tenantId || issuerPerson.personId !== issuer.personId
    || issuerPerson.status !== "active" || issuerPerson.kind !== "founder"
    || targetPerson.tenantId !== input.tenantId || targetPerson.personId !== input.personId
    || target.personId !== input.personId || targetPerson.kind !== "other"
    || (input.decision === "issue" && targetPerson.status !== "active")
    || issuerEligibility.tenantId !== input.tenantId || issuerEligibility.personId !== issuerPerson.personId
    || issuerEligibility.status !== "active" || issuerEligibility.kind !== "founder"
    || issuerEligibility.recordedAtMs > nowMs
    // Any administrative history is protected until the existing independent
    // recovery/approval path is integrated; ordinary issuance cannot downgrade it.
    || registry.events.some(event => event.kind === "administrator-granted" && event.subject === input.subject)) return forbidden();
  if (latestTargetEvent === null ? input.expectedPersonRevision !== 0 || input.decision === "revoke"
    : latestTargetEvent.tenantId !== input.tenantId || latestTargetEvent.personId !== input.personId
      || latestTargetEvent.revision !== input.expectedPersonRevision || latestTargetEvent.recordedAtMs > nowMs
      || latestTargetEvent.kind !== targetPerson.kind
      // Re-activation is recovery, not ordinary initial issuance.
      || latestTargetEvent.status !== "active" || input.decision !== "revoke") return forbidden();
  const event: PersonEligibilityEvent = Object.freeze({
    tenantId: input.tenantId, personId: input.personId, revision: input.expectedPersonRevision + 1,
    status: input.decision === "issue" ? "active" : "inactive", kind: targetPerson.kind,
    operationId: input.operationId, issuerSubject: principal.subject, recordedAtMs: nowMs,
    sourceReference: input.sourceReference, evidenceSha256: input.evidenceSha256,
  });
  return Object.freeze({
    status: "candidate", subject: input.subject, bindingId: target.bindingId, issuerBindingId: issuer.bindingId,
    expectedRegistryRevision: registry.revision, expectedBindingRevision: registry.bindingRevision,
    expectedPolicyRevision: state.revision, issuerPersonRevision: issuerEligibility.revision,
    expectedPersonRevision: input.expectedPersonRevision, validUntilMs, event,
  });
}

// Fresh first-factor and live session verification bind one exact current command.
// This cannot authenticate historical issuance or install a durable issuer.
// No source/repository callback or persistence capability is accepted.
export async function submitFounderEligibilityDecision(request: Request, input: unknown): Promise<PersistenceProblem> {
  const {
    consumeFounderEligibilityIntent, isAuthenticatedFounderEligibilityIntent, prepareFounderEligibilityIntent,
  } = await import("./founder-eligibility-intent");
  const prepared = await prepareFounderEligibilityIntent(request, input);
  if (!isAuthenticatedFounderEligibilityIntent(prepared)) return prepared;
  const intent = consumeFounderEligibilityIntent(prepared);
  if (!isAuthenticatedFounderEligibilityIntent(intent)) return intent;
  return missingProvenance();
}

// Serialized decision evidence for the existing Person event, not a new People
// registry. References are opaque identifiers, never credentials/session tokens.
// Format validation cannot establish that the referenced server evidence exists.
export type EligibilityDecisionRecord = Readonly<{
  version: 1;
  subject: string;
  bindingId: string;
  issuerBindingId: string;
  issuerPersonId: string;
  issuerPersonRevision: number;
  registryRevision: number;
  bindingRevision: number;
  policyRevision: number;
  issuerMembershipRevision: number;
  subjectMembershipRevision: number;
  authenticatedAtMs: number;
  validUntilMs: number;
  authenticationReference: string;
  issuerAuthorityReference: string;
  decision: "issue" | "revoke";
  event: PersonEligibilityEvent;
}>;

export function isEligibilityDecisionRecord(value: unknown): value is EligibilityDecisionRecord {
  if (!exactData(value, [
    "version", "subject", "bindingId", "issuerBindingId", "issuerPersonId", "issuerPersonRevision",
    "registryRevision", "bindingRevision", "policyRevision", "issuerMembershipRevision", "subjectMembershipRevision",
    "authenticatedAtMs", "validUntilMs", "authenticationReference", "issuerAuthorityReference", "decision", "event",
  ]) || value.version !== 1 || !isPersonEligibilityEvent(value.event)
    || typeof value.subject !== "string" || !/^user_[A-Za-z0-9_]+$/.test(value.subject) || value.subject.length > 512
    || ![value.bindingId, value.issuerBindingId, value.issuerPersonId,
      value.authenticationReference, value.issuerAuthorityReference].every(isAuthorityIdentifier)
    || !isCounter(value.registryRevision) || !isCounter(value.bindingRevision)
    || ![value.issuerPersonRevision, value.registryRevision, value.bindingRevision, value.policyRevision,
      value.issuerMembershipRevision, value.subjectMembershipRevision].every(entry => isCounter(entry) && entry > 0)
    || !isCounter(value.authenticatedAtMs) || !isCounter(value.validUntilMs)
    || (value.decision !== "issue" && value.decision !== "revoke")) return false;
  const event = value.event;
  return value.subject !== event.issuerSubject && value.issuerPersonId !== event.personId
    && value.bindingId !== value.issuerBindingId && event.kind === "other"
    && value.registryRevision >= value.bindingRevision
    && value.authenticatedAtMs <= event.recordedAtMs && event.recordedAtMs < value.validUntilMs
    && value.validUntilMs === value.authenticatedAtMs + IDENTITY_REAUTHENTICATION_WINDOW_MS
    && (value.decision === "issue" ? event.status === "active" && event.revision === 1
      : event.status === "inactive" && event.revision > 1);
}

// Historical reconciliation compares EVERY scalar and event field; never refresh
// timestamps, overwrite evidence or infer success from an operation-ID match.
export function validateCandidateEligibilityDecisionRecord(
  expected: unknown, stored: unknown,
): Readonly<{ status: "consistent" }> | PersistenceProblem {
  if (!isEligibilityDecisionRecord(expected) || !isEligibilityDecisionRecord(stored)) return forbidden();
  const scalarFields = Object.keys(expected).filter(field => field !== "event") as Exclude<keyof EligibilityDecisionRecord, "event">[];
  const eventFields = Object.keys(expected.event) as (keyof PersonEligibilityEvent)[];
  if (scalarFields.some(field => expected[field] !== stored[field])
    || eventFields.some(field => expected.event[field] !== stored.event[field])) return forbidden();
  return Object.freeze({ status: "consistent" });
}

// No approved storage reader or independent historical authentication verifier
// exists. Even an exact record (or one received from SQL) is not issuance proof.
// No caller-supplied issuer status, signature, digest or current founder can help.
export function verifyStoredEligibilityDecision(record: unknown): PersistenceProblem {
  if (!isEligibilityDecisionRecord(record)) return forbidden();
  return missingProvenance();
}
