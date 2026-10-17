import "server-only";
import { isAuthorityIdentifier } from "./authorization-policy";
import {
  isContributionIdentityRegistry, resolveContributionIdentityBinding,
} from "./contribution-identity-authority";
import { isFounderDecisionSession, recheckClerkFounderDecisionSession } from "./clerk-founder-decision-session";
import { validateDurableAuthorityState } from "./durable-authorization-state";
import {
  consumeFounderEligibilityIntent, isAuthenticatedFounderEligibilityIntent, prepareFounderEligibilityIntent,
  type AuthenticatedFounderEligibilityIntent,
} from "./founder-eligibility-intent";
import {
  isEligibilityDecisionRecord, planCandidateFounderEligibilityDecision,
  storedEligibilityProvenanceProblem, validateCandidateEligibilityDecisionRecord, verifyStoredEligibilityDecision,
} from "./person-eligibility-provenance";
import {
  beginRestrictedTransaction, type AuthorizationPostgresConnection, type AuthorizationPostgresSource,
} from "./postgres-authorization-store";
import { IDENTITY_CONTRACT_SQL } from "./postgres-contribution-identity-store";
import { restrictedSourceBinding } from "./restricted-postgres-provider";
import type { AuthenticatedPrincipal } from "./server-persistence-authority";
import { isCounter, isObject, type PersistenceProblem } from "./server-persistence-contract";
import { isPersonEligibilityEvent } from "./trusted-person-authority-source";

export const LOCK_FOUNDER_ELIGIBILITY_SQL = `SELECT registry,state,policy_revision::text,actor_subject,now_ms::text,
  binding_id,issuer_binding_id,person_id,issuer_person_id,issuer_event,target_event,operation_record,operation_used
  FROM empire_os_identity.lock_founder_eligibility_decision($1::text,$2::text,$3::text,$4::text)`;
export const FOUNDER_ELIGIBILITY_CLOCK_SQL = `SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS now_ms`;
export const FOUNDER_ELIGIBILITY_CONTRACT_SQL = `SELECT
  (SELECT count(*)=1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.oid=to_regprocedure('empire_os_identity.lock_founder_eligibility_decision(text,text,text,text)')
      AND p.proowner=n.nspowner AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog']
      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))
  AND (SELECT count(*)=1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='empire_os_identity' AND c.relname='eligibility_decisions'
      AND c.relowner=n.nspowner AND c.relrowsecurity AND c.relforcerowsecurity)
  AND NOT EXISTS (SELECT 1 FROM (VALUES
    ('trusted_statement'),('immutable_eligibility_decision'),
    ('no_eligibility_decision_truncate'),('serialize_eligibility_decision')) required(name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid=to_regclass('empire_os_identity.eligibility_decisions')
        AND t.tgname=required.name AND t.tgenabled IN ('O','A')))
  AS ready`;

const forbidden = (): PersistenceProblem => ({ status: "unauthorized", reason: "forbidden" });
function unavailable(cleanup = false): PersistenceProblem {
  return {
    status: "unavailable", outcome: cleanup ? "unknown" : "not-submitted",
    message: cleanup
      ? "Founder preflight cleanup could not be confirmed. No decision write was submitted."
      : "Locked founder decision preflight is unavailable. No decision write was submitted.",
  };
}
function counter(value: unknown): number {
  const parsed = typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (!isCounter(parsed)) throw new Error("Invalid founder decision database clock.");
  return parsed;
}

// Stored Person projections below are used ONLY for consistency/planner checks.
// Neither database claims nor a current authenticated intent can pass provenance.
function inspectLocked(
  intent: AuthenticatedFounderEligibilityIntent, row: unknown, nowMs: number, validUntilMs: number,
): PersistenceProblem {
  const input = intent.request;
  const { session } = intent;
  const principal = session.principal;
  if (!isObject(row) || row.actor_subject !== principal.subject
    || !isContributionIdentityRegistry(row.registry) || !isPersonEligibilityEvent(row.issuer_event)
    || !(row.target_event === null || isPersonEligibilityEvent(row.target_event))
    || typeof row.operation_used !== "boolean"
    || nowMs < session.checkedAtMs || nowMs >= validUntilMs) return forbidden();
  const registry = row.registry;
  const loaded = validateDurableAuthorityState(row.state);
  if (loaded.status !== "valid") return forbidden();
  const authority = loaded.value;
  const state = authority.snapshot;
  const issuer = resolveContributionIdentityBinding(registry, principal.subject);
  const target = resolveContributionIdentityBinding(registry, input.subject);
  const issuerEvent = row.issuer_event;
  const targetEvent = row.target_event;
  const issuerMember = state.memberships.find(member => member.subject === principal.subject);
  const targetMember = state.memberships.find(member => member.subject === input.subject);
  const inTenant = (bindingId: string) => registry.events.some(event =>
    (event.kind === "subject-bound" || event.kind === "binding-reassigned")
    && event.bindingId === bindingId && event.tenantId === input.tenantId);
  if (!issuer || !target || !issuerMember || !targetMember
    || !inTenant(issuer.bindingId) || !inTenant(target.bindingId)
    || row.binding_id !== target.bindingId || row.issuer_binding_id !== issuer.bindingId
    || row.person_id !== target.personId || row.issuer_person_id !== issuer.personId
    || issuer.personId === target.personId || target.personId !== input.personId
    || state.tenant.id !== input.tenantId || state.tenant.status !== "active"
    || !state.tenant.ownerSubjects.includes(principal.subject)
    || issuerMember.status !== "active" || (input.decision === "issue" && targetMember.status !== "active")
    || registry.revision !== input.expectedRegistryRevision || registry.bindingRevision !== input.expectedBindingRevision
    || state.revision !== input.expectedPolicyRevision || state.revision !== counter(row.policy_revision)
    || registry.events.some(event => event.recordedAtMs > nowMs || event.operationId === input.operationId)
    || registry.events.some(event => event.kind === "administrator-granted" && event.subject === input.subject)
    || issuerEvent.personId !== issuer.personId || issuerEvent.tenantId !== input.tenantId
    || issuerEvent.kind !== "founder" || issuerEvent.status !== "active" || issuerEvent.recordedAtMs > nowMs
    || issuerEvent.operationId === input.operationId
    || (targetEvent !== null && (targetEvent.personId !== input.personId || targetEvent.tenantId !== input.tenantId
      || targetEvent.kind !== "other" || targetEvent.recordedAtMs > nowMs))) return forbidden();

  if (row.operation_record !== null) {
    const record = row.operation_record;
    if (!row.operation_used || !isEligibilityDecisionRecord(record) || targetEvent === null
      || record.subject !== input.subject || record.bindingId !== target.bindingId
      || record.issuerBindingId !== issuer.bindingId || record.issuerPersonId !== issuer.personId
      || record.issuerPersonRevision !== issuerEvent.revision || record.event.issuerSubject !== principal.subject
      || record.registryRevision !== input.expectedRegistryRevision
      || record.bindingRevision !== input.expectedBindingRevision || record.policyRevision !== input.expectedPolicyRevision
      || record.issuerMembershipRevision !== issuerMember.revision || record.subjectMembershipRevision !== targetMember.revision
      || record.decision !== input.decision || record.event.tenantId !== input.tenantId
      || record.event.personId !== input.personId || record.event.operationId !== input.operationId
      || record.event.revision !== input.expectedPersonRevision + 1
      || record.event.sourceReference !== input.sourceReference || record.event.evidenceSha256 !== input.evidenceSha256
      || validateCandidateEligibilityDecisionRecord(record, { ...record, event: targetEvent }).status !== "consistent") {
      return forbidden();
    }
    // Historical timestamps/references are NEVER refreshed to match a new session.
    // Even an exact database replay cannot become a verified issuance or receipt.
    return verifyStoredEligibilityDecision(record);
  }
  if (row.operation_used || input.expectedPersonRevision === Number.MAX_SAFE_INTEGER) return forbidden();
  if (targetEvent === null) {
    if (input.decision !== "issue" || input.expectedPersonRevision !== 0) return forbidden();
    // Do not invent an active Person for initial issuance from a subject binding.
    return {
      status: "unavailable", outcome: "not-submitted",
      message: "Initial eligibility issuance requires an approved server-owned Person verifier and independent durable issuer.",
    };
  }
  const plan = planCandidateFounderEligibilityDecision(principal, input, {
    registry, authority,
    issuerPerson: {
      tenantId: issuerEvent.tenantId, personId: issuerEvent.personId, kind: issuerEvent.kind, status: issuerEvent.status,
    },
    targetPerson: {
      tenantId: targetEvent.tenantId, personId: targetEvent.personId, kind: targetEvent.kind, status: targetEvent.status,
    },
    issuerEligibility: issuerEvent, latestTargetEvent: targetEvent, usedOperationIds: [],
    authenticatedAtMs: session.authenticatedAtMs, nowMs,
  });
  if (plan.status !== "candidate") return plan;
  return storedEligibilityProvenanceProblem(issuerEvent) ?? unavailable();
}

// Server composition only. No loader, verifier, issuer callback, COMMIT, apply
// function or business repository can be supplied. Every result is a problem,
// never an execution grant, persisted decision, replay receipt or source approval.
export function createPostgresFounderEligibilityDecisionPreflight(dependencies: Readonly<{
  tenantId: string;
  sourceForPrincipal(principal: AuthenticatedPrincipal): AuthorizationPostgresSource;
}>) {
  const { tenantId, sourceForPrincipal } = dependencies;
  if (!isAuthorityIdentifier(tenantId)) throw new Error("Invalid founder preflight tenant.");
  return Object.freeze({
    async inspect(request: Request, input: unknown): Promise<PersistenceProblem> {
      const prepared = await prepareFounderEligibilityIntent(request, input);
      if (!isAuthenticatedFounderEligibilityIntent(prepared)) return prepared;
      const intent = consumeFounderEligibilityIntent(prepared);
      if (!isAuthenticatedFounderEligibilityIntent(intent)) return intent;
      if (intent.request.tenantId !== tenantId) return forbidden();
      const currentSession = await recheckClerkFounderDecisionSession(request, intent.session);
      if (!isFounderDecisionSession(currentSession)) return currentSession;
      const validUntilMs = Math.min(intent.session.validUntilMs, currentSession.validUntilMs);
      let client: AuthorizationPostgresConnection;
      try {
        const source = sourceForPrincipal(intent.session.principal);
        const binding = restrictedSourceBinding(source);
        if (!binding || binding.subject !== intent.session.principal.subject || binding.tenantId !== tenantId) return forbidden();
        client = await source.connect();
      } catch {
        return unavailable();
      }
      let destroy = false;
      let result: PersistenceProblem = unavailable();
      try {
        await beginRestrictedTransaction(client);
        for (const sql of [IDENTITY_CONTRACT_SQL, FOUNDER_ELIGIBILITY_CONTRACT_SQL]) {
          const contract = await client.query<{ ready: unknown }>(sql);
          if (contract.command !== "SELECT" || contract.rows.length !== 1 || contract.rows[0]?.ready !== true) {
            throw new Error("Founder preflight database contract unavailable.");
          }
        }
        const command = intent.request;
        const locked = await client.query(LOCK_FOUNDER_ELIGIBILITY_SQL, [
          tenantId, command.subject, command.personId, command.operationId,
        ]);
        if (locked.command !== "SELECT" || locked.rows.length !== 1) throw new Error("Missing locked founder decision.");
        const row: unknown = locked.rows[0];
        if (!isObject(row)) throw new Error("Invalid locked founder decision.");
        const checkedAt = counter(row.now_ms);
        const initialProblem = inspectLocked(intent, row, checkedAt, validUntilMs);
        // Time and live Clerk revocation are checked again while database locks
        // are held. There is no cross-system atomicity claim and no write.
        const completionSession = await recheckClerkFounderDecisionSession(request, intent.session);
        const clock = await client.query<{ now_ms: unknown }>(FOUNDER_ELIGIBILITY_CLOCK_SQL);
        if (clock.command !== "SELECT" || clock.rows.length !== 1) throw new Error("Missing completion clock.");
        const nowMs = counter(clock.rows[0]?.now_ms);
        if (nowMs < checkedAt) throw new Error("Founder decision clock moved backwards.");
        if (!isFounderDecisionSession(completionSession)) {
          result = completionSession;
        } else {
          const completionEvidenceProblem = inspectLocked(intent, row, nowMs,
            Math.min(validUntilMs, completionSession.validUntilMs));
          // A later clock must not rehabilitate evidence denied at the first read.
          result = initialProblem.status !== "unavailable" ? initialProblem : completionEvidenceProblem;
        }
      } catch (error) {
        destroy = true;
        result = isObject(error) && error.code === "42501" ? forbidden() : unavailable();
      }
      try {
        const rollback = await client.query("ROLLBACK");
        if (rollback.command !== "ROLLBACK") throw new Error("Unconfirmed founder preflight rollback.");
      } catch {
        destroy = true;
        result = unavailable(true);
      }
      try { client.release(destroy); } catch { result = unavailable(true); }
      return result;
    },
  });
}
