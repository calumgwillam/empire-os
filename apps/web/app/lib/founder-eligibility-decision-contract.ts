import { isAuthorityIdentifier } from "./authorization-policy";
import { isCounter, isIdempotencyKey, isObject } from "./server-persistence-contract";

export type FounderEligibilityDecisionRequest = Readonly<{
  tenantId: string;
  subject: string;
  personId: string;
  decision: "issue" | "revoke";
  operationId: string;
  expectedRegistryRevision: number;
  expectedBindingRevision: number;
  expectedPolicyRevision: number;
  expectedPersonRevision: number;
  sourceReference: string;
  evidenceSha256: string;
}>;

export function isExactDataRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return isObject(value) && Reflect.ownKeys(value).length === fields.length && fields.every(field => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
  });
}

export function isFounderEligibilityDecisionRequest(value: unknown): value is FounderEligibilityDecisionRequest {
  return isExactDataRecord(value, [
    "tenantId", "subject", "personId", "decision", "operationId", "expectedRegistryRevision",
    "expectedBindingRevision", "expectedPolicyRevision", "expectedPersonRevision", "sourceReference", "evidenceSha256",
  ]) && isAuthorityIdentifier(value.tenantId) && isAuthorityIdentifier(value.personId)
    && typeof value.subject === "string" && /^user_[A-Za-z0-9_]+$/.test(value.subject) && value.subject.length <= 512
    && (value.decision === "issue" || value.decision === "revoke") && isIdempotencyKey(value.operationId)
    && [value.expectedRegistryRevision, value.expectedBindingRevision,
      value.expectedPolicyRevision, value.expectedPersonRevision].every(isCounter)
    && isAuthorityIdentifier(value.sourceReference)
    && typeof value.evidenceSha256 === "string" && /^[a-f0-9]{64}$/.test(value.evidenceSha256);
}
