import "server-only";
import { isAuthorityIdentifier } from "./authorization-policy";
import { beginRestrictedTransaction, type AuthorizationPostgresConnection } from "./postgres-authorization-store";
import { IDENTITY_CONTRACT_SQL } from "./postgres-contribution-identity-store";
import { restrictedSourceBinding } from "./restricted-postgres-provider";
import { isAuthenticatedPrincipal } from "./server-persistence-authority";
import {
  isDatasetId, validateCommitLookup, validateSnapshotRequest, validateWriteBatch,
  type PersistenceProblem,
} from "./server-persistence-contract";
import type {
  TrustedMultiUserAuthorityDependencies, TrustedMultiUserRepository,
} from "./trusted-multi-user-authority";

type ExecutionOptions = Parameters<TrustedMultiUserAuthorityDependencies["repositoryForExecution"]>[0];

export const TRUSTED_POSTGRES_MISSING_DEPENDENCIES = Object.freeze([
  "ordinary-member-identity-lock-and-minimised-binding-read",
  "authoritative-people-read-with-transactional-eligibility-lock",
  "identity-aware-atomic-persistence-and-reconciliation",
] as const);

export type TrustedPostgresReadiness = Readonly<{
  status: "blocked";
  missingDependencies: typeof TRUSTED_POSTGRES_MISSING_DEPENDENCIES;
  // Catalog checks describe the old APIs only, never permission to execute them.
  existingApis: Readonly<{
    datasetSnapshot: boolean;
    atomicOperation: boolean;
    operationLookup: boolean;
    identityAdministration: boolean;
  }>;
}>;

export const TRUSTED_POSTGRES_EXISTING_APIS_SQL = `SELECT
  coalesce(has_function_privilege(current_user,
    to_regprocedure('empire_os_authorization.read_dataset_snapshot(text,uuid)'), 'EXECUTE'),false) AS dataset_snapshot,
  coalesce(has_function_privilege(current_user,
    to_regprocedure('empire_os_authorization.apply_operation(text,jsonb,jsonb)'), 'EXECUTE'),false) AS atomic_operation,
  coalesce(has_function_privilege(current_user,
    to_regprocedure('empire_os_authorization.lookup_operation(text,text)'), 'EXECUTE'),false) AS operation_lookup`;

function unavailable(outcome: "not-submitted" | "unknown"): Extract<PersistenceProblem, { status: "unavailable" }> {
  return {
    status: "unavailable", outcome,
    message: outcome === "unknown"
      ? "PostgreSQL readiness transaction cleanup could not be confirmed; no business operation was submitted."
      : "Trusted PostgreSQL execution is unavailable: identity locking, authoritative People and identity-aware persistence are not installed.",
  };
}

// Dormant foundation only. lock_operation is an approved ADMINISTRATION API, not
// an ordinary-member binding reader. Direct identity-table reads violate the
// restricted role contract. Until reviewed identity/People APIs exist, no business
// query, authorization callback, write, audit, replay or COMMIT is permitted here.
// In particular, an injected authorize callback returning "authorized" cannot
// enable execution, and catalog presence cannot release this interlock.
export function createPostgresTrustedMultiUserAdapter(
  options: ExecutionOptions,
): TrustedMultiUserRepository & Readonly<{
  inspectReadiness(): Promise<TrustedPostgresReadiness | PersistenceProblem>;
}> {
  const { principal, tenantId, datasetId, source } = options;

  function identityProblem(): PersistenceProblem | null {
    if (!isAuthenticatedPrincipal(principal)) return { status: "unauthorized", reason: "authentication-required" };
    const binding = restrictedSourceBinding(source);
    if (!isAuthorityIdentifier(tenantId) || !isDatasetId(datasetId)
      || !binding || binding.subject !== principal.subject || binding.tenantId !== tenantId) {
      return { status: "unauthorized", reason: "forbidden" };
    }
    return null;
  }

  function blocked(requestDataset: string): PersistenceProblem {
    return requestDataset !== datasetId ? { status: "unauthorized", reason: "forbidden" } : unavailable("not-submitted");
  }

  return Object.freeze({
    async readSnapshot(input) {
      const problem = identityProblem();
      if (problem) return problem;
      const validated = validateSnapshotRequest(input);
      return validated.status !== "valid" ? validated : blocked(validated.value.datasetId);
    },
    async writeBatch(input) {
      const problem = identityProblem();
      if (problem) return problem;
      const validated = validateWriteBatch(input);
      return validated.status !== "valid" ? validated : blocked(validated.value.fence.datasetId);
    },
    async lookupCommit(input) {
      const problem = identityProblem();
      if (problem) return problem;
      const validated = validateCommitLookup(input);
      // An unavailable lookup is not proof that an earlier request did not commit.
      return validated.status !== "valid" ? validated : blocked(validated.value.datasetId);
    },

    async inspectReadiness(): Promise<TrustedPostgresReadiness | PersistenceProblem> {
      const problem = identityProblem();
      if (problem) return problem;
      let client: AuthorizationPostgresConnection;
      try {
        client = await source.connect();
      } catch {
        return unavailable("not-submitted");
      }

      let destroy = false;
      let result: TrustedPostgresReadiness | PersistenceProblem = unavailable("not-submitted");
      try {
        // Own one bounded transaction on the branded lease. There is no injected
        // query/transaction callback and no borrowed repository/second connection.
        await beginRestrictedTransaction(client);
        const catalog = await client.query<{
          dataset_snapshot: unknown; atomic_operation: unknown; operation_lookup: unknown;
        }>(TRUSTED_POSTGRES_EXISTING_APIS_SQL);
        const identity = await client.query<{ ready: unknown }>(IDENTITY_CONTRACT_SQL);
        const row = catalog.rows[0];
        if (catalog.command !== "SELECT" || catalog.rows.length !== 1
          || !row || typeof row.dataset_snapshot !== "boolean" || typeof row.atomic_operation !== "boolean"
          || typeof row.operation_lookup !== "boolean" || identity.command !== "SELECT"
          || identity.rows.length !== 1 || typeof identity.rows[0]?.ready !== "boolean") {
          throw new Error("Invalid PostgreSQL readiness response.");
        }
        result = Object.freeze({
          status: "blocked",
          missingDependencies: TRUSTED_POSTGRES_MISSING_DEPENDENCIES,
          existingApis: Object.freeze({
            datasetSnapshot: row.dataset_snapshot, atomicOperation: row.atomic_operation,
            operationLookup: row.operation_lookup, identityAdministration: identity.rows[0].ready,
          }),
        });
      } catch {
        destroy = true;
        result = unavailable("not-submitted");
      }

      // Also attempt ROLLBACK after an unacknowledged BEGIN. Do not return even
      // catalog observations unless both cleanup and lease disposal are confirmed.
      try {
        const rollback = await client.query("ROLLBACK");
        if (rollback.command !== "ROLLBACK") throw new Error("PostgreSQL did not confirm ROLLBACK.");
      } catch {
        destroy = true;
        result = unavailable("unknown");
      }
      try {
        client.release(destroy);
      } catch {
        result = unavailable("unknown");
      }
      return result;
    },
  });
}
