import "server-only";
import { resolveClerkSession } from "./clerk-session-resolver";
import { isAuthorizedFounder } from "./founder-access";
import { isAuthorityIdentifier } from "./authorization-policy";
import { createServerPrincipalResolver, isAuthenticatedPrincipal } from "./server-persistence-authority";
import { hasOnlyFields, isCounter, isObject, type PersistenceProblem } from "./server-persistence-contract";
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
