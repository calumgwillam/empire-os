import { describe, expect, it } from "vitest";
import type { IcarusAssessmentRecord, IcarusControl, IcarusEvidence, IcarusFailureMode } from "./icarus";
import {
  deriveIcarusRelationships,
  getIcarusRelationshipIdentities,
  type IcarusObjectiveExpansion,
} from "./icarus-relationships";

const timestamp = "2026-10-01T12:00:00.000Z";

function evidence(overrides: Partial<IcarusEvidence> = {}): IcarusEvidence {
  return {
    id: "evidence-1",
    statement: "Observed.",
    origin: "Direct observation",
    recordedAt: timestamp,
    recordedBy: "Founder",
    review: "Supports",
    ...overrides,
  };
}

function mode(overrides: Partial<IcarusFailureMode> = {}): IcarusFailureMode {
  return { id: "mode-1", mechanism: "Mechanism.", vulnerability: "Vulnerability.", evidence: [], ...overrides };
}

function control(overrides: Partial<IcarusControl> = {}): IcarusControl {
  return {
    id: "control-1",
    failureModeId: "mode-1",
    intervention: "Control.",
    lifecycle: "Active",
    effectiveness: "Unknown",
    evidenceIds: [],
    linkedRecords: [],
    ...overrides,
  };
}

function assessment(overrides: Partial<IcarusAssessmentRecord> = {}): IcarusAssessmentRecord {
  return {
    id: "assessment-1",
    outcome: "Outcome.",
    status: "Open",
    createdAt: timestamp,
    updatedAt: timestamp,
    linkedRecords: [],
    failureModes: [mode()],
    controls: [],
    ...overrides,
  };
}

const liveObjective = (overrides: Partial<IcarusObjectiveExpansion> = {}): IcarusObjectiveExpansion => ({
  isLive: true,
  linkedProjectIds: ["project-1"],
  linkedOpportunityIds: ["opportunity-1"],
  linkedDecisionIds: ["decision-1"],
  ...overrides,
});

describe("deriveIcarusRelationships", () => {
  it("records direct assessment links and expands only live objectives, keeping provenance", () => {
    const relationships = deriveIcarusRelationships({
      assessment: assessment({
        linkedRecords: [
          { recordType: "Strategic Objective", recordId: "objective-1" },
          { recordType: "Strategic Objective", recordId: "objective-dormant" },
          { recordType: "Problem", recordId: "problem-1" },
        ],
      }),
      failureModes: [{ failureModeId: "mode-1", supportingEvidenceIds: [] }],
      objectives: new Map([
        ["objective-1", liveObjective()],
        ["objective-dormant", liveObjective({ isLive: false, linkedProjectIds: ["project-dormant"] })],
      ]),
    });
    expect(relationships.filter((entry) => entry.kind === "Direct").map((entry) => entry.identity)).toEqual([
      "Problem:problem-1",
      "Strategic Objective:objective-1",
      "Strategic Objective:objective-dormant",
    ]);
    const expanded = relationships.filter((entry) => entry.kind === "Expanded");
    expect(expanded.map((entry) => entry.identity)).toEqual(["Decision:decision-1", "Opportunity:opportunity-1", "Project:project-1"]);
    expanded.forEach((entry) => {
      expect(entry.origin).toBe("Strategic objective");
      expect(entry.objectiveId).toBe("objective-1");
    });
  });

  it("does not expand objectives when no objective context is supplied", () => {
    const relationships = deriveIcarusRelationships({
      assessment: assessment({ linkedRecords: [{ recordType: "Strategic Objective", recordId: "objective-1" }] }),
      failureModes: [],
    });
    expect(relationships.map((entry) => entry.kind)).toEqual(["Direct"]);
  });

  it("keeps control and evidence links only for the supplied material failure modes and non-retired controls", () => {
    const record = assessment({
      failureModes: [
        mode({ evidence: [evidence({ reference: { recordType: "Action", recordId: "action-1" } }), evidence({ id: "evidence-2", reference: { recordType: "Lesson", recordId: "lesson-ignored" } })] }),
        mode({ id: "mode-2", evidence: [evidence({ id: "evidence-3", reference: { recordType: "Problem", recordId: "problem-immaterial" } })] }),
      ],
      controls: [
        control({ linkedRecords: [{ recordType: "Person", recordId: "person-1" }] }),
        control({ id: "control-retired", lifecycle: "Retired", linkedRecords: [{ recordType: "Person", recordId: "person-retired" }] }),
        control({ id: "control-2", failureModeId: "mode-2", linkedRecords: [{ recordType: "Person", recordId: "person-immaterial" }] }),
      ],
    });
    const relationships = deriveIcarusRelationships({
      assessment: record,
      failureModes: [{ failureModeId: "mode-1", supportingEvidenceIds: ["evidence-1"] }],
    });
    expect(relationships).toEqual([
      {
        identity: "Person:person-1",
        reference: { recordType: "Person", recordId: "person-1" },
        kind: "Direct",
        origin: "Control link",
        failureModeId: "mode-1",
        controlId: "control-1",
      },
      {
        identity: "Action:action-1",
        reference: { recordType: "Action", recordId: "action-1" },
        kind: "Direct",
        origin: "Evidence source",
        failureModeId: "mode-1",
        evidenceId: "evidence-1",
      },
    ]);
  });

  it("dedupes identical paths but keeps distinct provenance for the same identity", () => {
    const person = { recordType: "Person" as const, recordId: "person-1" };
    const relationships = deriveIcarusRelationships({
      assessment: assessment({
        linkedRecords: [person, { ...person }, { recordType: "Problem", recordId: " " }],
        controls: [control({ linkedRecords: [person, person] })],
      }),
      failureModes: [{ failureModeId: "mode-1", supportingEvidenceIds: [] }],
    });
    expect(relationships.map((entry) => `${entry.origin}:${entry.identity}`)).toEqual([
      "Assessment link:Person:person-1",
      "Control link:Person:person-1",
    ]);
    expect(getIcarusRelationshipIdentities(relationships)).toEqual([person]);
  });

  it("is deterministic regardless of input order", () => {
    const links = [
      { recordType: "Project" as const, recordId: "b" },
      { recordType: "Action" as const, recordId: "a" },
      { recordType: "Strategic Objective" as const, recordId: "objective-1" },
    ];
    const objectives = new Map([["objective-1", liveObjective({ linkedProjectIds: ["z", "b"] })]]);
    const forward = deriveIcarusRelationships({ assessment: assessment({ linkedRecords: links }), failureModes: [], objectives });
    const reversed = deriveIcarusRelationships({ assessment: assessment({ linkedRecords: [...links].reverse() }), failureModes: [], objectives });
    expect(reversed).toEqual(forward);
  });

  it("filters identities by kind so direct and expanded links stay distinguishable", () => {
    const relationships = deriveIcarusRelationships({
      assessment: assessment({ linkedRecords: [{ recordType: "Strategic Objective", recordId: "objective-1" }, { recordType: "Project", recordId: "project-1" }] }),
      failureModes: [],
      objectives: new Map([["objective-1", liveObjective({ linkedOpportunityIds: [], linkedDecisionIds: [] })]]),
    });
    expect(getIcarusRelationshipIdentities(relationships, "Direct").map((reference) => reference.recordType)).toEqual(["Project", "Strategic Objective"]);
    expect(getIcarusRelationshipIdentities(relationships, "Expanded")).toEqual([{ recordType: "Project", recordId: "project-1" }]);
    expect(relationships.filter((entry) => entry.identity === "Project:project-1").map((entry) => entry.kind)).toEqual(["Direct", "Expanded"]);
  });

  it("does not mutate the assessment references", () => {
    const record = assessment({ linkedRecords: [{ recordType: "Problem", recordId: "problem-1" }] });
    const snapshot = JSON.stringify(record);
    const [relationship] = deriveIcarusRelationships({ assessment: record, failureModes: [] });
    relationship.reference.recordId = "changed";
    expect(JSON.stringify(record)).toBe(snapshot);
  });
});

describe("deriveIcarusRelationships ownership", () => {
  it("adds explicit risk and control owners as direct Person identities with provenance", () => {
    const relationships = deriveIcarusRelationships({
      assessment: assessment({
        accountableOwnerPersonId: " person-1 ",
        controls: [
          control({ id: "c-material", failureModeId: "mode-1", ownerPersonId: "person-2" }),
          control({ id: "c-retired", failureModeId: "mode-1", lifecycle: "Retired", ownerPersonId: "person-3" }),
          control({ id: "c-other", failureModeId: "mode-2", ownerPersonId: "person-4" }),
        ],
      }),
      failureModes: [{ failureModeId: "mode-1", supportingEvidenceIds: [] }],
    });
    const people = relationships.filter((entry) => entry.reference.recordType === "Person");
    expect(people.map((entry) => [entry.identity, entry.origin, entry.kind, entry.controlId])).toEqual([
      ["Person:person-1", "Risk owner", "Direct", undefined],
      ["Person:person-2", "Control owner", "Direct", "c-material"],
    ]);
  });

  it("adds no Person identity when ownership is absent", () => {
    const relationships = deriveIcarusRelationships({ assessment: assessment(), failureModes: [{ failureModeId: "mode-1", supportingEvidenceIds: [] }] });
    expect(relationships.some((entry) => entry.reference.recordType === "Person")).toBe(false);
  });
});
