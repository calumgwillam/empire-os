import "server-only";
import { isAuthorityIdentifier } from "./authorization-policy";
import {
  employeeProvisioningRequest, validateEmployeeProvisioningInput, type EmployeeProvisioningResult,
} from "./employee-provisioning-contract";
import { employeeProvisioningRelease } from "./employee-provisioning-release";
import { createPostgresEmployeeProvisioningStore } from "./postgres-employee-provisioning-store";
import type { AuthorizationPostgresSource } from "./postgres-authorization-store";
import {
  createServerPrincipalResolver, isAuthenticatedPrincipal,
  type AuthenticatedPrincipal, type ServerSessionResolution,
} from "./server-persistence-authority";

export type ServerEmployeeProvisioningDependencies = Readonly<{
  resolveSession(request: Request): Promise<ServerSessionResolution>;
  // The tenant and source are server-owned. No shared/privileged fallback connection.
  tenantId: string;
  sourceForPrincipal(principal: AuthenticatedPrincipal): AuthorizationPostgresSource;
}>;

export function createServerEmployeeProvisioningAuthority(dependencies: ServerEmployeeProvisioningDependencies) {
  const { tenantId, sourceForPrincipal, resolveSession } = dependencies;
  if (!isAuthorityIdentifier(tenantId)) throw new Error("Invalid server provisioning tenant.");
  const resolvePrincipal = createServerPrincipalResolver(resolveSession);

  return Object.freeze({
    // Internal server API only. Not a route, Server Action, Clerk invitation or People writer.
    async provision(request: Request, input: unknown): Promise<EmployeeProvisioningResult> {
      const principal = await resolvePrincipal(request);
      if (!isAuthenticatedPrincipal(principal)) {
        if (principal.status === "unauthorized") return principal;
        return {
          status: "unavailable", outcome: "not-submitted",
          message: "Verified provisioning authentication is unavailable.",
        };
      }
      const validated = validateEmployeeProvisioningInput(input);
      if (validated.status !== "valid") return validated;
      const release = employeeProvisioningRelease();
      if (release.status !== "approved" || release.migrationVersion !== 5) {
        return { status: "disabled", reason: "migration-005-disabled" };
      }

      let source: AuthorizationPostgresSource;
      try {
        source = sourceForPrincipal(principal);
      } catch {
        return {
          status: "unavailable", outcome: "not-submitted",
          message: "Restricted provisioning storage is unavailable.",
        };
      }
      return createPostgresEmployeeProvisioningStore(source).execute(
        principal, employeeProvisioningRequest(tenantId, validated.value),
      );
    },
  });
}
