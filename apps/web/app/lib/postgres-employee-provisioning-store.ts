import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { evaluateAuthorization, isAuthorityIdentifier } from "./authorization-policy";
import { auditDecisionId } from "./authorization-transaction";
import { validateDurableAuthorityState } from "./durable-authorization-state";
import {
  employeeProvisioningRequest, validateEmployeeProvisioningInput,
  type EmployeeProvisioningRequest, type EmployeeProvisioningResult,
} from "./employee-provisioning-contract";
import { employeeProvisioningRelease } from "./employee-provisioning-release";
import { validateMembershipProvisioningTransition } from "./membership-provisioning";
import {
  beginRestrictedTransaction, type AuthorizationPostgresConnection, type AuthorizationPostgresSource,
} from "./postgres-authorization-store";
import { isAuthenticatedPrincipal } from "./server-persistence-authority";
import { hasOnlyFields, isCounter, isObject } from "./server-persistence-contract";

// Structural verification is not release approval. Candidate installation alone can
// never lift employeeProvisioningRelease's migration-005-disabled interlock.
export const PROVISIONING_CONTRACT_SQL = `SELECT
  (SELECT count(*) = 2 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.oid IN (
      to_regprocedure('empire_os_authorization.provision_member(text,jsonb)'),
      to_regprocedure('empire_os_authorization.provisioning_subject(text)'))
      AND p.proowner=n.nspowner AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=pg_catalog']
      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))
  AND (SELECT count(*) = 2 FROM pg_constraint c
    WHERE c.conrelid=to_regclass('empire_os_authorization.audit') AND c.convalidated
      AND c.conname IN ('audit_provisioning_operation_check','audit_provisioning_evidence_check'))
  AND (SELECT count(*) = 2 FROM pg_index i JOIN pg_class ix ON ix.oid=i.indexrelid
    WHERE i.indrelid=to_regclass('empire_os_authorization.audit')
      AND i.indisvalid AND i.indisunique
      AND ix.relname IN ('successful_operation_once','authority_revision_once'))
  AND NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('tenants','authority_audit'),('tenants','authority_step'),
      ('tenants','a_only_trusted_statement'),('audit','immutable_audit'),
      ('audit','a_only_trusted_statement'),('audit','current_audit_revision'),
      ('audit','serialize_audit'),('role_tenants','serialize_binding')
    ) required(table_name,trigger_name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid=to_regclass('empire_os_authorization.' || required.table_name)
        AND t.tgname=required.trigger_name AND t.tgenabled IN ('O','A')
        AND (required.trigger_name <> 'authority_audit'
          OR (t.tgdeferrable AND t.tginitdeferred))))
  AND (SELECT count(*) = 5 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='empire_os_authorization'
      AND c.relname IN ('tenants','datasets','role_tenants','audit','preparation_writes')
      AND c.relrowsecurity AND c.relforcerowsecurity)
  AS ready`;

function counter(value: unknown): number {
  const parsed = typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (!isCounter(parsed)) throw new Error("Invalid provisioning database counter.");
  return parsed;
}

function failureFor(error: unknown): EmployeeProvisioningResult {
  if (isObject(error) && error.code === "42501") return { status: "unauthorized", reason: "forbidden" };
  if (isObject(error) && error.code === "40001") return { status: "conflict", reason: "stale-authority" };
  if (isObject(error) && error.code === "23505") return { status: "conflict", reason: "operation-conflict" };
  return { status: "failed", outcome: "rolled-back", message: "Employee provisioning was rolled back." };
}

export function createPostgresEmployeeProvisioningStore(source: AuthorizationPostgresSource) {
  return Object.freeze({
    async execute(principal: unknown, request: EmployeeProvisioningRequest):
      Promise<EmployeeProvisioningResult> {
      if (!isAuthenticatedPrincipal(principal)) return { status: "unauthorized", reason: "authentication-required" };
      if (!isObject(request)
        || !hasOnlyFields(request, ["operationId", "tenantId", "expectedPolicyRevision", "command"])
        || !isAuthorityIdentifier(request.tenantId) || !isObject(request.command)
        || !hasOnlyFields(request.command, ["kind", "subject", "roleIds"])
        || request.command.kind !== "provision-member") {
        return { status: "invalid-request", message: "Invalid bound provisioning request." };
      }
      const input = validateEmployeeProvisioningInput({
        operationId: request.operationId, expectedPolicyRevision: request.expectedPolicyRevision,
        subject: request.command.subject, roleIds: request.command.roleIds,
      });
      if (input.status !== "valid") return input;
      const bound = employeeProvisioningRequest(request.tenantId, input.value);
      const release = employeeProvisioningRelease();
      if (release.status !== "approved" || release.migrationVersion !== 5) {
        return { status: "disabled", reason: "migration-005-disabled" };
      }

      let client: AuthorizationPostgresConnection;
      try {
        client = await source.connect();
      } catch {
        return {
          status: "unavailable", outcome: "not-submitted",
          message: "Restricted provisioning storage is unavailable.",
        };
      }
      let destroy = false;
      let commitSent = false;
      try {
        let result: EmployeeProvisioningResult;
        try {
          await beginRestrictedTransaction(client);
          const readiness = await client.query<{ ready: unknown }>(PROVISIONING_CONTRACT_SQL);
          if (readiness.rows.length !== 1 || readiness.rows[0].ready !== true) {
            result = {
              status: "unavailable", outcome: "not-submitted",
              message: "Provisioning database contract is unavailable.",
            };
          } else {
            const observed = await client.query<{
              state: unknown; revision: unknown; actor_subject: unknown; authorized: unknown; records: unknown;
            }>(
              `SELECT state,revision::text AS revision,actor_subject,authorized,records
               FROM empire_os_authorization.lookup_operation($1,$2)`,
              [bound.tenantId, bound.operationId],
            );
            if (observed.rows.length !== 1) throw new Error("Locked provisioning authority unavailable.");
            const row = observed.rows[0];
            const loaded = validateDurableAuthorityState(row.state);
            if (loaded.status !== "valid" || loaded.value.snapshot.tenant.id !== bound.tenantId
              || loaded.value.snapshot.revision !== counter(row.revision)
              || row.actor_subject !== principal.subject || typeof row.authorized !== "boolean"
              || !Array.isArray(row.records)) throw new Error("Inconsistent provisioning authority or actor binding.");
            const before = structuredClone(loaded.value);
            const clock = await client.query<{ now_ms: unknown }>(
              "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS now_ms",
            );
            if (clock.rows.length !== 1) throw new Error("Provisioning clock unavailable.");
            const checkedAt = counter(clock.rows[0].now_ms);
            const datasetId = before.snapshot.datasets.map(dataset => dataset.datasetId).sort()[0];
            if (!datasetId) throw new Error("Provisioning audit dataset unavailable.");
            // Reuse the owner decision; ordinary direct/delegated grants cannot provision.
            const decision = evaluateAuthorization(principal, before.snapshot, {
              tenantId: bound.tenantId, datasetId, expectedPolicyRevision: before.snapshot.revision,
              operation: "access", capability: "read",
            }, checkedAt);
            if (!row.authorized || decision.status !== "allowed" || decision.reason !== "owner-authority") {
              result = { status: "unauthorized", reason: "forbidden" };
            } else if (row.records.length !== 0) {
              result = { status: "conflict", reason: "operation-conflict" };
            } else if (bound.expectedPolicyRevision !== before.snapshot.revision) {
              result = {
                status: "conflict", reason: "stale-authority",
                observedPolicyRevision: before.snapshot.revision,
              };
            } else {
              const transactionId = randomUUID();
              const requestText = JSON.stringify(bound);
              const requestSha256 = createHash("sha256").update(requestText).digest("hex");
              const decisionId = auditDecisionId(transactionId, bound.operationId);
              const evidence = {
                version: 1, transactionId, decisionId, requestSha256,
                operationId: bound.operationId, actorSubject: principal.subject,
                tenantId: bound.tenantId, datasetId, operation: "provision-member",
                authorityChange: bound.command, decision, checkedAt, completedAt: checkedAt,
                resultingPolicyRevision: before.snapshot.revision + 1,
              };
              const applied = await client.query<{
                state: unknown; revision: unknown; actor_subject: unknown; audit_evidence: unknown;
              }>(
                `SELECT state,revision::text AS revision,actor_subject,audit_evidence
                 FROM empire_os_authorization.provision_member($1,$2::jsonb)`,
                [requestText, JSON.stringify(evidence)],
              );
              if (applied.rows.length !== 1) throw new Error("Provisioning result missing.");
              const row = applied.rows[0];
              const transition = validateMembershipProvisioningTransition(before, row.state, principal.subject, checkedAt);
              if (transition.status !== "valid" || row.actor_subject !== principal.subject
                || counter(row.revision) !== evidence.resultingPolicyRevision
                || !sameJson(row.audit_evidence, evidence)) throw new Error("Inconsistent provisioning result or audit.");
              const added = transition.value.snapshot.memberships.find(member => member.subject === bound.command.subject);
              if (!added || !sameJson(added.roleIds, bound.command.roleIds)) throw new Error("Provisioned employee differs from request.");
              commitSent = true;
              const committed = await client.query("COMMIT");
              if (committed.command !== "COMMIT") throw new Error("Provisioning COMMIT not confirmed.");
              return {
                status: "executed", durability: "transaction-commit-confirmed",
                operationId: bound.operationId, transactionId, decisionId, requestSha256,
                resultingPolicyRevision: evidence.resultingPolicyRevision,
              };
            }
          }
        } catch (error) {
          if (commitSent) {
            destroy = true;
            return {
              status: "unavailable", outcome: "unknown",
              message: "Provisioning COMMIT outcome is unknown; do not submit a replacement operation.",
            };
          }
          result = failureFor(error);
        }
        try {
          const rollback = await client.query("ROLLBACK");
          if (rollback.command !== "ROLLBACK") throw new Error("Provisioning rollback not confirmed.");
        } catch {
          destroy = true;
          return {
            status: "unavailable", outcome: "unknown",
            message: "Provisioning rollback could not be confirmed.",
          };
        }
        return result;
      } finally {
        client.release(destroy);
      }
    },
  });
}

function sameJson(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameJson(value, right[index]));
  }
  if (isObject(left) && isObject(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
      && keys.every(key => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
  }
  return left === right;
}
