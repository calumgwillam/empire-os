import "server-only";
import { resolveClerkSession } from "./clerk-session-resolver";
import type { ServerEmployeeProvisioningDependencies } from "./server-employee-provisioning";
import { createServerEmployeeProvisioningReconciliation } from "./server-employee-provisioning-reconciliation";

export function createClerkEmployeeProvisioningReconciliation(
  infrastructure: Omit<ServerEmployeeProvisioningDependencies, "resolveSession">,
) {
  return createServerEmployeeProvisioningReconciliation({ ...infrastructure, resolveSession: resolveClerkSession });
}
