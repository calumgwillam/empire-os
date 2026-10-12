import "server-only";

export type EmployeeProvisioningRelease =
  | Readonly<{ status: "disabled"; reason: "migration-005-disabled" }>
  | Readonly<{ status: "approved"; migrationVersion: 5 }>;

// Deliberate release interlock, not database readiness. Installing candidate functions
// or supplying an environment/request flag must never activate disabled migration 005.
export function employeeProvisioningRelease(): EmployeeProvisioningRelease {
  return Object.freeze({ status: "disabled", reason: "migration-005-disabled" });
}
