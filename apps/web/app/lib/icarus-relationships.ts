import type { IcarusAssessmentRecord, IcarusRecordReference } from "./icarus";

// The authoritative set of stable record identities an Icarus assessment is connected to.
// Every downstream adapter (attention anchors, correlation links, pillar attribution) maps from
// this list rather than re-walking the assessment, so all systems agree on WHY a record relates.
//
// "Direct": the record is explicitly referenced by the assessment, a control or an evidence item.
// "Expanded": the record is reached through a live Strategic Objective's own linked records. It is
// legitimate context for correlation but is never treated as the same underlying issue.

export type IcarusRelationshipKind = "Direct" | "Expanded";

export type IcarusRelationshipOrigin =
  | "Assessment link"
  | "Strategic objective"
  | "Control link"
  | "Evidence source"
  // Explicit Phase 3 ownership: the assessment's accountable owner / a material control's owner (Person id).
  | "Risk owner"
  | "Control owner";

export type IcarusRelationship = {
  identity: string;
  reference: IcarusRecordReference;
  kind: IcarusRelationshipKind;
  origin: IcarusRelationshipOrigin;
  objectiveId?: string;
  failureModeId?: string;
  controlId?: string;
  evidenceId?: string;
};

export type IcarusObjectiveExpansion = {
  isLive: boolean;
  linkedProjectIds?: readonly string[];
  linkedOpportunityIds?: readonly string[];
  linkedDecisionIds?: readonly string[];
};

export type IcarusRelationshipModeScope = {
  failureModeId: string;
  supportingEvidenceIds: readonly string[];
};

export type IcarusRelationshipInput = {
  assessment: IcarusAssessmentRecord;
  // Only control/evidence links of these (material) failure modes describe the current risk.
  failureModes: readonly IcarusRelationshipModeScope[];
  objectives?: ReadonlyMap<string, IcarusObjectiveExpansion>;
};

const kindOrder: readonly IcarusRelationshipKind[] = ["Direct", "Expanded"];
export const ICARUS_RELATIONSHIP_ORIGINS: readonly IcarusRelationshipOrigin[] = ["Assessment link", "Strategic objective", "Control link", "Evidence source", "Risk owner", "Control owner"];

export function getIcarusRelationshipIdentity(reference: IcarusRecordReference): string {
  return `${reference.recordType}:${reference.recordId}`;
}

function relationshipKey(relationship: IcarusRelationship): string {
  return [
    relationship.identity,
    relationship.kind,
    relationship.origin,
    relationship.objectiveId ?? "",
    relationship.failureModeId ?? "",
    relationship.controlId ?? "",
    relationship.evidenceId ?? "",
  ].join("|");
}

export function compareIcarusRelationships(left: IcarusRelationship, right: IcarusRelationship): number {
  return kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind)
    || ICARUS_RELATIONSHIP_ORIGINS.indexOf(left.origin) - ICARUS_RELATIONSHIP_ORIGINS.indexOf(right.origin)
    || left.identity.localeCompare(right.identity)
    || (left.objectiveId ?? "").localeCompare(right.objectiveId ?? "")
    || (left.failureModeId ?? "").localeCompare(right.failureModeId ?? "")
    || (left.controlId ?? "").localeCompare(right.controlId ?? "")
    || (left.evidenceId ?? "").localeCompare(right.evidenceId ?? "");
}

export function deriveIcarusRelationships(input: IcarusRelationshipInput): IcarusRelationship[] {
  const relationships = new Map<string, IcarusRelationship>();
  const add = (relationship: IcarusRelationship) => {
    if (!relationship.reference.recordId.trim()) return;
    const key = relationshipKey(relationship);
    if (!relationships.has(key)) relationships.set(key, relationship);
  };
  const { assessment } = input;

  assessment.linkedRecords.forEach((reference) => {
    add({ identity: getIcarusRelationshipIdentity(reference), reference: { ...reference }, kind: "Direct", origin: "Assessment link" });
    if (reference.recordType !== "Strategic Objective") return;
    const objective = input.objectives?.get(reference.recordId);
    if (!objective?.isLive) return;
    const objectiveId = reference.recordId;
    const expand = (recordType: "Project" | "Opportunity" | "Decision", ids: readonly string[] | undefined) =>
      (ids ?? []).forEach((recordId) => add({
        identity: `${recordType}:${recordId}`,
        reference: { recordType, recordId },
        kind: "Expanded",
        origin: "Strategic objective",
        objectiveId,
      }));
    expand("Project", objective.linkedProjectIds);
    expand("Opportunity", objective.linkedOpportunityIds);
    expand("Decision", objective.linkedDecisionIds);
  });

  const riskOwnerId = assessment.accountableOwnerPersonId?.trim();
  if (riskOwnerId) {
    add({ identity: `Person:${riskOwnerId}`, reference: { recordType: "Person", recordId: riskOwnerId }, kind: "Direct", origin: "Risk owner" });
  }

  input.failureModes.forEach((mode) => {
    assessment.controls
      .filter((control) => control.failureModeId === mode.failureModeId && control.lifecycle !== "Retired")
      .forEach((control) => {
        control.linkedRecords.forEach((reference) => add({
          identity: getIcarusRelationshipIdentity(reference),
          reference: { ...reference },
          kind: "Direct",
          origin: "Control link",
          failureModeId: mode.failureModeId,
          controlId: control.id,
        }));
        const controlOwnerId = control.ownerPersonId?.trim();
        if (controlOwnerId) {
          add({
            identity: `Person:${controlOwnerId}`,
            reference: { recordType: "Person", recordId: controlOwnerId },
            kind: "Direct",
            origin: "Control owner",
            failureModeId: mode.failureModeId,
            controlId: control.id,
          });
        }
      });
    const failureMode = assessment.failureModes.find((entry) => entry.id === mode.failureModeId);
    mode.supportingEvidenceIds.forEach((evidenceId) => {
      const reference = failureMode?.evidence.find((evidence) => evidence.id === evidenceId)?.reference;
      if (!reference) return;
      add({
        identity: getIcarusRelationshipIdentity(reference),
        reference: { ...reference },
        kind: "Direct",
        origin: "Evidence source",
        failureModeId: mode.failureModeId,
        evidenceId,
      });
    });
  });

  return [...relationships.values()].sort(compareIcarusRelationships);
}

// Unique referenced identities in relationship order (first occurrence wins).
export function getIcarusRelationshipIdentities(
  relationships: readonly IcarusRelationship[],
  kind?: IcarusRelationshipKind,
): IcarusRecordReference[] {
  const seen = new Set<string>();
  const references: IcarusRecordReference[] = [];
  relationships.forEach((relationship) => {
    if (kind && relationship.kind !== kind) return;
    if (seen.has(relationship.identity)) return;
    seen.add(relationship.identity);
    references.push({ ...relationship.reference });
  });
  return references;
}
