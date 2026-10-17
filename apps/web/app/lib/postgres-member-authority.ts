import "server-only";
import { evaluateAuthorization, isAuthorityIdentifier } from "./authorization-policy";
import { resolveClerkSession } from "./clerk-session-resolver";
import { isIdentityPerson } from "./contribution-identity-authority";
import { validateDurableAuthorityState } from "./durable-authorization-state";
import { memberAuthorityRelease } from "./member-authority-release";
import { storedEligibilityProvenanceProblem } from "./person-eligibility-provenance";
import { beginRestrictedTransaction, type AuthorizationPostgresConnection } from "./postgres-authorization-store";
import { IDENTITY_CONTRACT_SQL } from "./postgres-contribution-identity-store";
import { restrictedSourceBinding } from "./restricted-postgres-provider";
import {
  createServerPrincipalResolver, isAuthenticatedPrincipal, type AuthenticatedPrincipal,
} from "./server-persistence-authority";
import { isCounter, isDatasetId, isObject, type PersistenceProblem } from "./server-persistence-contract";
import type { TrustedMultiUserAuthorityDependencies } from "./trusted-multi-user-authority";
import { isPersonEligibilityEvent } from "./trusted-person-authority-source";

export const LOCK_MEMBER_AUTHORITY_SQL = `SELECT actor_subject,binding_id,person_id,
  registry_revision::text,binding_revision::text,person_revision::text,person_status,person_kind,
  state,revision::text,decision,checked_at::text,eligibility_event
  FROM empire_os_identity.lock_member_authority($1::text,$2::uuid)`;
export const MEMBER_AUTHORITY_CLOCK_SQL = `SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS now_ms`;

export type MemberAuthorityObservation = Readonly<{
  // Historical evidence only: locks are released before returning. This is NOT
  // an execution grant, a bearer token or authorization for a later transaction.
  status: "observed";
  source: "committed-database-read";
  subject: string;
  tenantId: string;
  datasetId: string;
  personId: string;
  bindingId: string;
  registryRevision: number;
  bindingRevision: number;
  personRevision: number;
  policyRevision: number;
  membershipRevision: number;
  checkedAt: number;
}>;
type Result = MemberAuthorityObservation | PersistenceProblem | Readonly<{ status: "disabled" }>;

function unavailable(unknownCleanup = false): PersistenceProblem {
  return {
    status: "unavailable", outcome: unknownCleanup ? "unknown" : "not-submitted",
    message: unknownCleanup
      ? "Authority observation discarded: transaction cleanup could not be confirmed. No business operation was submitted."
      : "Authoritative identity, Person eligibility or locked tenant authority is unavailable.",
  };
}
function forbidden(): PersistenceProblem {
  return { status: "unauthorized", reason: "forbidden" };
}
function counter(value: unknown): number {
  const parsed = typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (!isCounter(parsed)) throw new Error("Invalid authority counter.");
  return parsed;
}

// No repository/authorization/transaction callback is accepted. Only the existing
// branded restricted source is injected. There are no business methods or COMMIT.
export function createPostgresMemberAuthority(
  dependencies: Pick<TrustedMultiUserAuthorityDependencies, "tenantId" | "sourceForPrincipal"> & Readonly<{ datasetId: string }>,
) {
  const { tenantId, datasetId, sourceForPrincipal } = dependencies;
  if (!isAuthorityIdentifier(tenantId) || !isDatasetId(datasetId)) throw new Error("Invalid member authority scope.");
  const resolvePrincipal = createServerPrincipalResolver(resolveClerkSession);

  return Object.freeze({
    async observe(request: Request): Promise<Result> {
      const principal = await resolvePrincipal(request);
      if (!isAuthenticatedPrincipal(principal)) return principal;
      if (memberAuthorityRelease().status !== "approved") return { status: "disabled" };

      let client: AuthorizationPostgresConnection;
      try {
        const source = sourceForPrincipal(principal);
        const binding = restrictedSourceBinding(source);
        if (!binding || binding.subject !== principal.subject || binding.tenantId !== tenantId) return forbidden();
        client = await source.connect();
      } catch {
        return unavailable();
      }
      let destroy = false;
      let result: Result = unavailable();
      try {
        await beginRestrictedTransaction(client);
        const contract = await client.query<{ ready: unknown }>(IDENTITY_CONTRACT_SQL);
        if (contract.command !== "SELECT" || contract.rows.length !== 1 || contract.rows[0]?.ready !== true) {
          throw new Error("Identity persistence contract unavailable.");
        }
        const locked = await client.query(LOCK_MEMBER_AUTHORITY_SQL, [tenantId, datasetId]);
        if (locked.command !== "SELECT" || locked.rows.length !== 1) throw new Error("Missing member authority.");
        const row: unknown = locked.rows[0];
        const observation = decode(row, principal, tenantId, datasetId);
        const clock = await client.query<{ now_ms: unknown }>(MEMBER_AUTHORITY_CLOCK_SQL);
        if (clock.command !== "SELECT" || clock.rows.length !== 1) throw new Error("Missing completion clock.");
        const nowMs = counter(clock.rows[0]?.now_ms);
        // Lock-compatible writes cannot change the rows. Time-based delegation
        // expiry still needs the existing evaluator with a refreshed database clock.
        if (nowMs < observation.checkedAt) throw new Error("Authority clock moved backwards.");
        decode(row, principal, tenantId, datasetId, nowMs);
        // Reached only with current binding, eligibility and policy held in ONE
        // transaction. Do not mistake stored issuer claims for verified provenance.
        if (!isObject(row)) throw new Error("Missing locked eligibility evidence.");
        const provenanceProblem = storedEligibilityProvenanceProblem(row.eligibility_event);
        result = provenanceProblem ?? Object.freeze({ ...observation, checkedAt: nowMs });
      } catch (error) {
        destroy = true;
        result = isObject(error) && error.code === "42501" ? forbidden() : unavailable();
      }
      try {
        const rollback = await client.query("ROLLBACK");
        if (rollback.command !== "ROLLBACK") throw new Error("Unconfirmed authority rollback.");
      } catch {
        destroy = true;
        result = unavailable(true);
      }
      try { client.release(destroy); } catch { result = unavailable(true); }
      return result;
    },
  });
}

function decode(
  row: unknown, principal: AuthenticatedPrincipal, tenantId: string, datasetId: string, completionMs?: number,
): MemberAuthorityObservation {
  if (!isObject(row) || row.actor_subject !== principal.subject || !isAuthorityIdentifier(row.binding_id)
    || !isIdentityPerson({ tenantId, personId: row.person_id, status: row.person_status, kind: row.person_kind })
    || row.person_status !== "active") throw new Error("Invalid authoritative Person binding.");
  const personId = row.person_id;
  if (!isAuthorityIdentifier(personId)) throw new Error("Invalid authoritative Person identifier.");
  const loaded = validateDurableAuthorityState(row.state);
  if (loaded.status !== "valid" || loaded.value.snapshot.tenant.id !== tenantId
    || loaded.value.snapshot.revision !== counter(row.revision)) throw new Error("Invalid tenant authority.");
  const checkedAt = counter(row.checked_at);
  const policy = loaded.value.snapshot;
  const decision = evaluateAuthorization(principal, policy, {
    operation: "access", tenantId, datasetId, capability: "read", expectedPolicyRevision: policy.revision,
  }, completionMs ?? checkedAt);
  if (decision.status !== "allowed" || !isObject(row.decision) || row.decision.status !== "allowed"
    || row.decision.reason !== decision.reason || row.decision.policyVersion !== decision.policyVersion
    || row.decision.observedPolicyRevision !== policy.revision || row.decision.evidenceId !== decision.evidenceId) {
    throw new Error("Member read authority denied or inconsistent.");
  }
  const member = policy.memberships.find(entry => entry.subject === principal.subject && entry.status === "active");
  const registryRevision = counter(row.registry_revision);
  const bindingRevision = counter(row.binding_revision);
  const personRevision = counter(row.person_revision);
  if (!member || registryRevision < bindingRevision || bindingRevision === 0 || personRevision === 0) {
    throw new Error("Missing binding or membership evidence.");
  }
  const event = row.eligibility_event;
  if (!isPersonEligibilityEvent(event) || event.tenantId !== tenantId || event.personId !== personId
    || event.revision !== personRevision || event.status !== row.person_status || event.kind !== row.person_kind
    || event.recordedAtMs > checkedAt) {
    throw new Error("Missing or inconsistent locked eligibility event.");
  }
  return {
    status: "observed", source: "committed-database-read", subject: principal.subject, tenantId, datasetId,
    personId, bindingId: row.binding_id, registryRevision, bindingRevision, personRevision,
    policyRevision: policy.revision, membershipRevision: member.revision, checkedAt,
  };
}
