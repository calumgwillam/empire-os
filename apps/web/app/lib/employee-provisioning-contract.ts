import { isAuthorityIdentifier } from "./authorization-policy";
import { hasOnlyFields, isCounter, isIdempotencyKey, isObject } from "./server-persistence-contract";

export type EmployeeProvisioningInput = Readonly<{
  operationId: string;
  expectedPolicyRevision: number;
  subject: string;
  roleIds: readonly string[];
}>;

export type EmployeeProvisioningRequest = Readonly<{
  operationId: string;
  tenantId: string;
  expectedPolicyRevision: number;
  command: Readonly<{ kind: "provision-member"; subject: string; roleIds: readonly string[] }>;
}>;

export type EmployeeProvisioningResult =
  | Readonly<{
    status: "executed";
    durability: "transaction-commit-confirmed";
    operationId: string;
    transactionId: string;
    decisionId: string;
    requestSha256: string;
    resultingPolicyRevision: number;
  }>
  | Readonly<{ status: "disabled"; reason: "migration-005-disabled" }>
  | Readonly<{ status: "unauthorized"; reason: "authentication-required" | "forbidden" }>
  | Readonly<{ status: "invalid-request"; message: string }>
  | Readonly<{
    status: "conflict";
    reason: "stale-authority" | "operation-conflict";
    observedPolicyRevision?: number;
  }>
  | Readonly<{ status: "failed"; outcome: "rolled-back"; message: string }>
  | Readonly<{ status: "unavailable"; outcome: "not-submitted" | "unknown"; message: string }>;

export function validateEmployeeProvisioningInput(value: unknown):
  | Readonly<{ status: "valid"; value: EmployeeProvisioningInput }>
  | Extract<EmployeeProvisioningResult, { status: "invalid-request" }> {
  const invalid = () => ({
    status: "invalid-request" as const,
    message: "Invalid employee provisioning request or unsupported authority claims.",
  });
  if (!isObject(value)
    || !hasOnlyFields(value, ["operationId", "expectedPolicyRevision", "subject", "roleIds"])
    || !isIdempotencyKey(value.operationId) || !isCounter(value.expectedPolicyRevision)
    || !isAuthorityIdentifier(value.subject) || !/^user_[A-Za-z0-9_]+$/.test(value.subject)
    || !Array.isArray(value.roleIds)) return invalid();
  const roleIds: string[] = [];
  for (const role of value.roleIds) {
    if (!isAuthorityIdentifier(role) || roleIds.includes(role)) return invalid();
    roleIds.push(role);
  }
  return { status: "valid", value: Object.freeze({
    operationId: value.operationId, expectedPolicyRevision: value.expectedPolicyRevision,
    subject: value.subject, roleIds: Object.freeze(roleIds),
  }) };
}

export function employeeProvisioningRequest(
  tenantId: string,
  input: EmployeeProvisioningInput,
): EmployeeProvisioningRequest {
  return Object.freeze({
    operationId: input.operationId, tenantId, expectedPolicyRevision: input.expectedPolicyRevision,
    command: Object.freeze({
      kind: "provision-member", subject: input.subject, roleIds: Object.freeze([...input.roleIds]),
    }),
  });
}
