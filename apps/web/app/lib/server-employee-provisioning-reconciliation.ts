import "server-only";
import {
  createEmployeeProvisioningReconciler, validateProvisioningReconciliationInput,
  type EmployeeProvisioningReconciliationResult,
} from "./employee-provisioning-reconciliation";
import { employeeProvisioningRelease } from "./employee-provisioning-release";
import { createPostgresOperationReconciliationStore } from "./postgres-authorization-store";
import { PROVISIONING_CONTRACT_SQL } from "./postgres-employee-provisioning-store";
import type { ServerEmployeeProvisioningDependencies } from "./server-employee-provisioning";
import { createServerPrincipalResolver, isAuthenticatedPrincipal } from "./server-persistence-authority";
import { isAuthorityIdentifier } from "./authorization-policy";

export function createServerEmployeeProvisioningReconciliation(dependencies: ServerEmployeeProvisioningDependencies) {
  const { tenantId, resolveSession, sourceForPrincipal } = dependencies;
  if (!isAuthorityIdentifier(tenantId)) throw new Error("Invalid server reconciliation tenant.");
  const resolvePrincipal = createServerPrincipalResolver(resolveSession);
  return Object.freeze({
    async reconcile(request: Request, input: unknown): Promise<EmployeeProvisioningReconciliationResult> {
      const principal = await resolvePrincipal(request);
      if (!isAuthenticatedPrincipal(principal)) {
        if (principal.status === "unauthorized") return principal;
        return { status: "unknown", reason: "authentication-unavailable" };
      }
      const parsed = validateProvisioningReconciliationInput(input);
      if (parsed.status !== "valid") return parsed;
      const release = employeeProvisioningRelease();
      if (release.status !== "approved" || release.migrationVersion !== 5) {
        return { status: "disabled", reason: "migration-005-disabled" };
      }
      let source: ReturnType<ServerEmployeeProvisioningDependencies["sourceForPrincipal"]>;
      try {
        source = sourceForPrincipal(principal);
      } catch {
        return { status: "unknown", reason: "database-visibility-unavailable" };
      }
      return createEmployeeProvisioningReconciler(createPostgresOperationReconciliationStore(source, {
        requiredContractSql: PROVISIONING_CONTRACT_SQL,
      }), tenantId).reconcile(principal, parsed.value);
    },
  });
}
