import "server-only";
import { evaluateAuthorization, isAuthorityIdentifier } from "./authorization-policy";
import {
  isContributionIdentityRegistry, isIdentityPerson, resolveContributionIdentityBinding,
  type IdentityPerson,
} from "./contribution-identity-authority";
import { validateDurableAuthorityState } from "./durable-authorization-state";
import { isAuthenticatedPrincipal, type PersistenceCapability } from "./server-persistence-authority";
import { hasOnlyFields, isCounter, isDatasetId, isObject, type PersistenceProblem } from "./server-persistence-contract";
import type { TrustedExecutionIdentity } from "./trusted-multi-user-authority";

export const PERSON_AUTHORITY_MISSING_DEPENDENCIES = Object.freeze([
  "approved-server-owned-person-verifier",
  "approved-founder-controlled-eligibility-issuer",
  "transaction-locked-current-eligibility-and-issuer-provenance",
] as const);

// No environment flag, injected loader or caller assertion can approve a source.
export function trustedPersonAuthoritySourceProblem(): PersistenceProblem | null {
  return {
    status: "unavailable", outcome: "not-submitted",
    message: `Trusted Person authority source is unresolved: ${PERSON_AUTHORITY_MISSING_DEPENDENCIES.join(", ")}.`,
  };
}

// Mirrors the existing person_authority_events candidate, not a writable registry.
// database_transaction remains database-owned and is not accepted as caller proof.
export type PersonEligibilityEvent = IdentityPerson & Readonly<{
  revision: number;
  operationId: string;
  issuerSubject: string;
  sourceReference: string;
  evidenceSha256: string;
  recordedAtMs: number;
}>;

export type PersonAuthorityCheckpoint = Readonly<{
  tenantId: string;
  datasetId: string;
  nowMs: number;
  founderSubject: string;
  registryRevision: number;
  bindingRevision: number;
  personRevision: number;
  policyRevision: number;
  membershipRevision: number;
}>;

function clerkSubject(value: unknown): value is string {
  return typeof value === "string" && /^user_[A-Za-z0-9_]+$/.test(value) && value.length <= 512;
}

function eligibilityEvent(value: unknown): value is PersonEligibilityEvent {
  return isObject(value) && hasOnlyFields(value, [
    "tenantId", "personId", "revision", "status", "kind", "operationId", "issuerSubject",
    "sourceReference", "evidenceSha256", "recordedAtMs",
  ]) && isIdentityPerson({
    tenantId: value.tenantId, personId: value.personId, status: value.status, kind: value.kind,
  }) && isCounter(value.revision) && value.revision > 0
    && typeof value.operationId === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(value.operationId)
    && clerkSubject(value.issuerSubject) && isAuthorityIdentifier(value.sourceReference)
    && typeof value.evidenceSha256 === "string" && /^[a-f0-9]{64}$/.test(value.evidenceSha256)
    && isCounter(value.recordedAtMs);
}

type EvidenceValidation =
  | Readonly<{ status: "valid"; value: Omit<TrustedExecutionIdentity, "status"> & Readonly<{ personRevision: number }> }>
  | PersistenceProblem;

function isCheckpoint(value: unknown): value is PersonAuthorityCheckpoint {
  return isObject(value) && hasOnlyFields(value, [
    "tenantId", "datasetId", "nowMs", "founderSubject", "registryRevision", "bindingRevision",
    "personRevision", "policyRevision", "membershipRevision",
  ]) && isAuthorityIdentifier(value.tenantId) && isDatasetId(value.datasetId)
    && clerkSubject(value.founderSubject) && isCounter(value.nowMs)
    && [value.registryRevision, value.bindingRevision, value.personRevision,
      value.policyRevision, value.membershipRevision].every(entry => isCounter(entry) && entry > 0);
}

// Structural/consistency validation ONLY, never a grant or proof of provenance.
// A future approved source must supply both evidence and checkpoint independently
// of request/browser data under compatible identity -> tenant locks. Locks must
// span execution and completion; this result cannot authorize a later transaction.
export function validateCandidatePersonAuthorityEvidence(
  principal: unknown, checkpoint: unknown, evidence: unknown,
  capability: PersistenceCapability = "read",
): EvidenceValidation {
  if (!isAuthenticatedPrincipal(principal)) return { status: "unauthorized", reason: "authentication-required" };
  const denied = (): PersistenceProblem => ({ status: "unauthorized", reason: "forbidden" });
  if (!isCheckpoint(checkpoint)
    || !isObject(evidence) || !hasOnlyFields(evidence, ["registry", "authority", "person", "eligibility"])
    || !isContributionIdentityRegistry(evidence.registry) || !isIdentityPerson(evidence.person)
    || !eligibilityEvent(evidence.eligibility)) return denied();

  const { registry, person, eligibility } = evidence;
  const authority = validateDurableAuthorityState(evidence.authority);
  if (authority.status !== "valid" || registry.revision !== checkpoint.registryRevision
    || registry.bindingRevision !== checkpoint.bindingRevision
    || registry.events.some(event => event.recordedAtMs > checkpoint.nowMs)) return denied();
  const binding = resolveContributionIdentityBinding(registry, principal.subject);
  const state = authority.value.snapshot;
  const member = state.memberships.find(entry => entry.subject === principal.subject);
  // The binding projection intentionally has no tenant: inspect its original
  // immutable event as well, rather than borrowing a binding from another tenant.
  const bindingEvent = binding && registry.events.find(event =>
    (event.kind === "subject-bound" || event.kind === "binding-reassigned") && event.bindingId === binding.bindingId);
  if (!binding || !bindingEvent || bindingEvent.tenantId !== checkpoint.tenantId
    || state.tenant.id !== checkpoint.tenantId || state.revision !== checkpoint.policyRevision
    || !member || member.tenantId !== checkpoint.tenantId || member.status !== "active"
    || member.revision !== checkpoint.membershipRevision
    || person.tenantId !== checkpoint.tenantId || person.personId !== binding.personId || person.status !== "active"
    || eligibility.tenantId !== person.tenantId || eligibility.personId !== person.personId
    || eligibility.status !== person.status || eligibility.kind !== person.kind
    || eligibility.revision !== checkpoint.personRevision || eligibility.recordedAtMs > checkpoint.nowMs
    || eligibility.issuerSubject !== checkpoint.founderSubject) return denied();
  const decision = evaluateAuthorization(principal, state, {
    operation: "access", tenantId: checkpoint.tenantId, datasetId: checkpoint.datasetId,
    capability, expectedPolicyRevision: checkpoint.policyRevision,
  }, checkpoint.nowMs);
  if (decision.status !== "allowed") return denied();
  return {
    status: "valid",
    value: Object.freeze({
      subject: principal.subject, personId: person.personId, bindingId: binding.bindingId,
      registryRevision: registry.revision, bindingRevision: registry.bindingRevision,
      personRevision: eligibility.revision, tenantId: checkpoint.tenantId,
      policyRevision: state.revision, membershipRevision: member.revision,
    }),
  };
}
