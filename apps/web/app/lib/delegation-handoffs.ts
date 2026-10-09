import type { HandoffObjectType, HandoffReviewDecision, HandoffStatus } from "./execution-release";

export type DelegationHandoffRecord = {
  id: string; objectType: HandoffObjectType; objectId: string; title: string; area: string;
  previousOwner: string; previousOwnerPersonId?: string; newOwner: string; newOwnerPersonId: string;
  delegatedBy?: string; delegatedByPersonId?: string; transferredAt: string; handoffContext: string;
  handoffReason?: string; reviewDate?: string; status?: HandoffStatus; outcomeLesson?: string;
  reviewNote?: string; lastReviewDecision?: HandoffReviewDecision; lastReviewedAt?: string;
};

export function assertDelegationHandoffs(value: unknown): asserts value is DelegationHandoffRecord[] {
  if (!Array.isArray(value) || !value.every((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    return ["id", "objectId", "title", "area", "previousOwner", "newOwner", "newOwnerPersonId", "transferredAt", "handoffContext"]
      .every((field) => typeof record[field] === "string")
      && ["Action", "Project", "Lead", "Problem"].includes(String(record.objectType))
      && ["previousOwnerPersonId", "delegatedBy", "delegatedByPersonId", "handoffReason", "reviewDate", "outcomeLesson", "reviewNote", "lastReviewedAt"]
        .every((field) => record[field] === undefined || typeof record[field] === "string")
      && (record.status === undefined || ["Healthy", "At risk", "Completed", "Cancelled"].includes(String(record.status)))
      && (record.lastReviewDecision === undefined || ["Continue", "Support / adjust", "Escalate", "Complete", "Cancel"].includes(String(record.lastReviewDecision)));
  })) throw new Error("Delegation handoff storage is malformed; existing ownership history must be preserved and reconciled.");
}
