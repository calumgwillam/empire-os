import { describe, expect, it } from "vitest";
import {
  getIcarusTreatmentOutcomeId,
  parseIcarusAssessments,
  type IcarusAssessmentRecord,
  type IcarusTreatmentOutcomeRecord,
} from "./icarus";
import {
  buildIcarusTreatmentOutcomeIndex,
  type IcarusTreatmentOutcomeIndexInput,
} from "./icarus-treatment-outcome";
import type { IcarusTreatmentTarget } from "./icarus-treatment";

const assessmentId = "risk-1";
const evidenceId = "evidence-1";
const testId = "test-1";
const controlId = "control-1";
const modeId = "mode-1";

function assessment(overrides: Partial<IcarusAssessmentRecord> = {}): IcarusAssessmentRecord {
  return {
    id: assessmentId,
    outcome: "Operating control failure",
    status: "Open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    linkedRecords: [],
    failureModes: [{
      id: modeId,
      mechanism: "The control does not interrupt the failure path.",
      vulnerability: "",
      evidence: [{
        id: evidenceId,
        statement: "Observed control operation.",
        origin: "Direct observation",
        observedAt: "2026-05-01T00:00:00.000Z",
        recordedAt: "2026-05-01T00:00:00.000Z",
        recordedBy: "person-1",
        review: "Supports",
        reviewedAt: "2026-05-02T00:00:00.000Z",
        reviewedBy: "person-2",
      }],
    }],
    controls: [{
      id: controlId,
      failureModeId: modeId,
      intervention: "Test the operating control.",
      lifecycle: "Active",
      effectiveness: "Evidence supports",
      effectivenessReviewedAt: "2026-05-02T00:00:00.000Z",
      effectivenessReviewedBy: "person-2",
      evidenceIds: [evidenceId],
      linkedRecords: [],
      assuranceTests: [{
        id: testId,
        testedAt: "2026-05-03T00:00:00.000Z",
        testedByPersonId: "person-2",
        result: "Passed",
        evidenceIds: [evidenceId],
      }],
    }],
    ...overrides,
  };
}

function target(overrides: Partial<IcarusTreatmentTarget> = {}): IcarusTreatmentTarget {
  return {
    id: "icarus-treatment:Assurance%20obligation:obligation-1",
    sourceKind: "Assurance obligation",
    sourceId: "obligation-1",
    assessmentId,
    failureModeId: modeId,
    controlId,
    treatmentKind: "Restore control",
    reason: "A failed control requires restoration.",
    basis: [],
    affectedAssessmentIds: [assessmentId],
    objectiveIds: [],
    pillarIds: [],
    provenance: { kind: "Assurance obligation", finding: "Current control failure" },
    executionLinks: [{ recordType: "Action", recordId: "action-1", linkedAt: "2026-05-01T00:00:00.000Z" }],
    executions: [{
      recordType: "Action",
      recordId: "action-1",
      title: "Restore the control",
      status: "Completed",
    }],
    state: "Completed — verification required",
    material: true,
    founderOwned: false,
    ...overrides,
  };
}

function indexInput(
  overrides: Partial<IcarusTreatmentOutcomeIndexInput> = {},
): IcarusTreatmentOutcomeIndexInput {
  const currentAssessment = assessment();
  return {
    assessments: [currentAssessment],
    targets: [target()],
    assurance: {
      byAssessmentId: new Map([[assessmentId, {
        assessmentId,
        controls: [{
          controlId,
          failureModeId: modeId,
          status: "Assured",
          evidence: "Current support",
          lastEvent: {
            source: "Control test",
            testId,
            at: "2026-05-03T00:00:00.000Z",
            result: "Passed",
            evidenceIds: [evidenceId],
          },
        }],
        modes: [{ failureModeId: modeId, material: true, assurance: "Assured" }],
        acceptances: [],
      }]]),
    },
    dependencyHealth: new Map(),
    ...overrides,
  };
}

function effectiveOutcome(): IcarusTreatmentOutcomeRecord {
  const input = indexInput();
  const targetRecord = input.targets[0];
  const option = buildIcarusTreatmentOutcomeIndex(input).get(targetRecord.id)?.options[0];
  if (!option) throw new Error("Expected a current control-test verification option");
  return {
    id: getIcarusTreatmentOutcomeId(targetRecord.id, "person-2", option.evidence),
    treatmentTargetId: targetRecord.id,
    assessmentId,
    executionLinks: [{ recordType: "Action", recordId: "action-1", linkedAt: "2026-05-01T00:00:00.000Z" }],
    outcome: option.outcome,
    verifiedAt: "2026-05-04T00:00:00.000Z",
    verifiedByPersonId: "person-2",
    evidence: [...option.evidence],
    afterState: { ...option.afterState },
    verificationNote: "The current control test passed with supporting evidence.",
  };
}

describe("Icarus treatment verification", () => {
  it.each([
    ["Failed", "Ineffective"],
    ["Degraded", "Inconclusive"],
    ["Unknown", "Inconclusive"],
  ] as const)("does not verify passed control protection as Effective with a %s required dependency", (health, category) => {
    const dependency = { recordType: "Project" as const, recordId: "required" };
    const record = assessment();
    record.controls[0].linkedRecords = [dependency];
    const input = indexInput({
      assessments: [record],
      dependencyHealth: new Map([["Project:required", {
        reference: dependency, health, source: "Explicit", basis: ["no-operational-health-evidence"], supportingRecords: [],
      }]]),
    });
    const view = buildIcarusTreatmentOutcomeIndex(input).get(target().id);
    expect(view?.options.map((option) => option.outcome)).toEqual([category]);
    expect(view?.options[0].evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "Control test", result: "Passed", assuranceStatus: "Assured" }),
      expect.objectContaining({ kind: "Dependency health", health }),
    ]));
    expect(view?.options[0].attribution).toBe("Uncertain");
    expect(input.assurance.byAssessmentId.get(assessmentId)?.controls[0].status).toBe("Assured");
    record.treatmentOutcomes = [effectiveOutcome()];
    expect(buildIcarusTreatmentOutcomeIndex(input).get(target().id)?.history[0].current).toBe(false);
  });

  it("retains legacy verification and explicitly records a distinct occurrence against unchanged evidence", () => {
    const legacy = effectiveOutcome();
    const occurrenceId = "verification-occurrence-2";
    const next: IcarusTreatmentOutcomeRecord = {
      ...legacy, occurrenceId,
      interventionReference: { decisionId: "new-context", optionId: "new-option", selectionEventId: "new-selection" },
      id: getIcarusTreatmentOutcomeId(legacy.treatmentTargetId, legacy.verifiedByPersonId, legacy.evidence, occurrenceId),
      verifiedAt: "2026-05-05T00:00:00.000Z", beforeState: legacy.afterState,
    };
    expect(next.id).not.toBe(legacy.id);
    const stored = assessment({ treatmentOutcomes: [legacy, next] });
    const loaded = parseIcarusAssessments(JSON.stringify([stored]));
    expect(loaded?.[0].treatmentOutcomes).toEqual([legacy, next]);
    expect(parseIcarusAssessments(JSON.stringify([assessment({ treatmentOutcomes: [legacy] })]))?.[0].treatmentOutcomes)
      .toEqual([legacy]);
    expect(parseIcarusAssessments(JSON.stringify([assessment({
      treatmentOutcomes: [legacy, { ...next, occurrenceId: "" }],
    })]))[0].treatmentOutcomes).toEqual([legacy]);
    const view = buildIcarusTreatmentOutcomeIndex(indexInput({ assessments: loaded ?? [] })).get(target().id);
    expect(view?.state).toBe("Verified effective");
    expect(view?.history.map(({ record, current }) => [record.id, current])).toEqual([[legacy.id, false], [next.id, true]]);
    expect(view?.history.every((entry) => entry.evidenceCurrent)).toBe(true);
    expect(view?.options.map((option) => option.outcome)).toEqual(["Effective"]);
  });

  it("keeps completed execution awaiting explicit evidence-based verification", () => {
    const result = buildIcarusTreatmentOutcomeIndex(indexInput());
    const view = result.get(target().id);
    expect(view?.state).toBe("Awaiting verification");
    expect(view?.options.map((option) => option.outcome)).toEqual(["Effective"]);
    expect(view?.history).toEqual([]);
  });

  it("does not offer verification before every linked execution is complete", () => {
    const input = indexInput({
      targets: [target({ state: "In progress" })],
    });
    const view = buildIcarusTreatmentOutcomeIndex(input).get(target().id);
    expect(view?.state).toBe("Verification in progress");
    expect(view?.options).toEqual([]);
  });

  it("does not treat a passing test without current supporting evidence as effective", () => {
    const input = indexInput({
      assurance: {
        byAssessmentId: new Map([[assessmentId, {
          assessmentId,
          controls: [{
            controlId,
            failureModeId: modeId,
            status: "Assured",
            evidence: "No current support",
            lastEvent: {
              source: "Control test",
              testId,
              at: "2026-05-03T00:00:00.000Z",
              result: "Passed",
              evidenceIds: [evidenceId],
            },
          }],
          modes: [{ failureModeId: modeId, material: true, assurance: "Assured" }],
          acceptances: [],
        }]]),
      },
    });
    expect(buildIcarusTreatmentOutcomeIndex(input).get(target().id)?.options.map((option) => option.outcome))
      .toEqual(["Inconclusive"]);
  });

  it("recognises an explicitly recorded current outcome and preserves stable evidence provenance", () => {
    const outcome = effectiveOutcome();
    const currentAssessment = assessment({ treatmentOutcomes: [outcome] });
    const view = buildIcarusTreatmentOutcomeIndex(indexInput({ assessments: [currentAssessment] })).get(target().id);
    expect(view?.state).toBe("Verified effective");
    expect(view?.history).toMatchObject([{
      current: true,
      attribution: "Supported",
      record: {
        verifiedByPersonId: "person-2",
        evidence: [{ testId, evidenceIds: [evidenceId], evidenceStatus: "Current support" }],
      },
    }]);
  });

  it("supersedes a verification record when its recorded after-state does not match current evidence", () => {
    const outcome = effectiveOutcome();
    const inconsistentOutcome = {
      ...outcome,
      afterState: { kind: "Control assurance" as const, state: "Failed" as const },
    };
    const view = buildIcarusTreatmentOutcomeIndex(indexInput({
      assessments: [assessment({ treatmentOutcomes: [inconsistentOutcome] })],
    })).get(target().id);
    expect(view?.state).toBe("Superseded");
    expect(view?.history[0]?.current).toBe(false);
  });

  it("marks a formerly verified result superseded when current assurance regresses", () => {
    const outcome = effectiveOutcome();
    const input = indexInput({
      assessments: [assessment({ treatmentOutcomes: [outcome] })],
      assurance: {
        byAssessmentId: new Map([[assessmentId, {
          assessmentId,
          controls: [{
            controlId,
            failureModeId: modeId,
            status: "Failed",
            evidence: "Conflicting",
            lastEvent: {
              source: "Control test",
              testId: "test-2",
              at: "2026-05-05T00:00:00.000Z",
              result: "Failed",
              evidenceIds: [evidenceId],
            },
          }],
          modes: [{ failureModeId: modeId, material: true, assurance: "Failing" }],
          acceptances: [],
        }]]),
      },
    });
    const view = buildIcarusTreatmentOutcomeIndex(input).get(target().id);
    expect(view?.state).toBe("Superseded");
    expect(view?.options.map((option) => option.outcome)).toContain("Ineffective");
    expect(view?.history[0]?.current).toBe(false);
  });

  it.each([
    ["Failed", "Ineffective"],
    ["Inconclusive", "Inconclusive"],
  ] as const)("classifies a current %s control test as %s", (result, outcome) => {
    const input = indexInput({
      assurance: {
        byAssessmentId: new Map([[assessmentId, {
          assessmentId,
          controls: [{
            controlId,
            failureModeId: modeId,
            status: result === "Failed" ? "Failed" : "Inconclusive",
            evidence: result === "Failed" ? "Conflicting" : "No current support",
            lastEvent: {
              source: "Control test",
              testId,
              at: "2026-05-03T00:00:00.000Z",
              result,
              evidenceIds: [evidenceId],
            },
          }],
          modes: [{ failureModeId: modeId, material: true, assurance: "Failing" }],
          acceptances: [],
        }]]),
      },
    });
    expect(buildIcarusTreatmentOutcomeIndex(input).get(target().id)?.options.map((option) => option.outcome))
      .toContain(outcome);
  });

  it("supports a partial outcome only when current tests show mixed assurance", () => {
    const secondControlId = "control-2";
    const firstControl = assessment().controls[0];
    const broadTarget = target();
    delete broadTarget.controlId;
    if (!firstControl) throw new Error("Expected the fixture to contain its primary control");
    const input = indexInput({
      assessments: [assessment({
        controls: [
          firstControl,
          {
            ...firstControl,
            id: secondControlId,
            assuranceTests: [{
              id: "test-2",
              testedAt: "2026-05-03T00:00:00.000Z",
              testedByPersonId: "person-2",
              result: "Failed",
              evidenceIds: [evidenceId],
            }],
          },
        ],
      })],
      targets: [broadTarget],
      assurance: {
        byAssessmentId: new Map([[assessmentId, {
          assessmentId,
          controls: [
            {
              controlId,
              failureModeId: modeId,
              status: "Assured",
              evidence: "Current support",
              lastEvent: {
                source: "Control test",
                testId,
                at: "2026-05-03T00:00:00.000Z",
                result: "Passed",
                evidenceIds: [evidenceId],
              },
            },
            {
              controlId: secondControlId,
              failureModeId: modeId,
              status: "Failed",
              evidence: "Conflicting",
              lastEvent: {
                source: "Control test",
                testId: "test-2",
                at: "2026-05-03T00:00:00.000Z",
                result: "Failed",
                evidenceIds: [evidenceId],
              },
            },
          ],
          modes: [{ failureModeId: modeId, material: true, assurance: "Partially assured" }],
          acceptances: [],
        }]]),
      },
    });
    expect(buildIcarusTreatmentOutcomeIndex(input).get(broadTarget.id)?.options)
      .toContainEqual(expect.objectContaining({
        outcome: "Partially effective",
        evidence: expect.arrayContaining([
          expect.objectContaining({ controlId }),
          expect.objectContaining({ controlId: secondControlId }),
        ]),
      }));
  });

  it("allows no-longer-applicable only when current assurance says the mode is no longer material", () => {
    const input = indexInput({
      assurance: {
        byAssessmentId: new Map([[assessmentId, {
          assessmentId,
          controls: [],
          modes: [{ failureModeId: modeId, material: false, assurance: "Unassured" }],
          acceptances: [],
        }]]),
      },
    });
    expect(buildIcarusTreatmentOutcomeIndex(input).get(target().id)?.options.map((option) => option.outcome))
      .toEqual(["No longer applicable"]);
  });
});
