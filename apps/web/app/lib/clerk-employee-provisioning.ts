import "server-only";
import { resolveClerkSession } from "./clerk-session-resolver";
import {
  createServerEmployeeProvisioningAuthority, type ServerEmployeeProvisioningDependencies,
} from "./server-employee-provisioning";

export function createClerkEmployeeProvisioningAuthority(
  infrastructure: Omit<ServerEmployeeProvisioningDependencies, "resolveSession">,
) {
  return createServerEmployeeProvisioningAuthority({
    ...infrastructure, resolveSession: resolveClerkSession,
  });
}
