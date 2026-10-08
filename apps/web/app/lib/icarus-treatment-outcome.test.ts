import { describe, expect, it } from "vitest";
import {
  getIcarusTreatmentOutcomeId,
  parseIcarusAssessments,
  type IcarusAssessmentRecord,
  type IcarusTreatmentOutcomeRecord,
} from "./icarus";
import {
  buildIcarusTreatmentOutcomeIndex,
  getIcarusTreatmentVerificationIssues,
  getIcarusTreatmentCompletion,
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
      completedAt: "2026-05-01T00:00:00.000Z",
      completionEvidence: "Restoration work recorded as complete",
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
    nowMs: Date.parse("2026-05-20T12:00:00.000Z"),
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
    completionConditions: getIcarusTreatmentCompletion(targetRecord, input.nowMs!).conditions,
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
    const regressed = assessment({ treatmentOutcomes: [outcome] });
    regressed.controls[0].assuranceTests!.push({
      id: "test-2", testedAt: "2026-05-05T00:00:00.000Z",
      testedByPersonId: "person-2", result: "Failed", evidenceIds: [evidenceId],
    });
    const input = indexInput({
      assessments: [regressed],
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
    const record = assessment();
    record.controls[0].assuranceTests![0].result = result;
    const input = indexInput({
      assessments: [record],
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

  it("preserves a directly verified treatment observation when restored protection removes mode materiality", () => {
    const input = indexInput({ assessments: [assessment({ treatmentOutcomes: [effectiveOutcome()] })] });
    const current = input.assurance.byAssessmentId.get(assessmentId)!;
    const restored = {
      ...input,
      assurance: { byAssessmentId: new Map([[assessmentId, {
        ...current, modes: [{ failureModeId: modeId, material: false, assurance: "Assured" as const }],
      }]]) },
    };
    const view = buildIcarusTreatmentOutcomeIndex(restored).get(target().id)!;
    expect(view.options.map((option) => option.outcome)).toEqual(["Effective"]);
    expect(view.state).toBe("Verified effective");
    expect(view.history[0].current).toBe(true);
    expect(view.history[0].evidenceCurrent).toBe(true);
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

  it.each([
    [undefined, "Execution linkage date is missing or invalid"],
    ["not-a-date", "Execution linkage date is missing or invalid"],
    ["2026-05-04T00:00:00.000Z", "Source control test predates treatment routing or intervention selection: test-1"],
    ["2026-05-21T00:00:00.000Z", "Verification precedes execution linkage"],
  ])("rejects inadmissible execution linkage %s without discarding history", (linkedAt, reason) => {
    const recorded = effectiveOutcome();
    const source = indexInput({
      assessments: [assessment({ treatmentOutcomes: [recorded] })],
      targets: [target({ executionLinks: [{ recordType: "Action", recordId: "action-1", linkedAt }] })],
    });
    const view = buildIcarusTreatmentOutcomeIndex(source).get(target().id)!;
    expect(view.options).toEqual([]);
    expect(view.issues).toContain(reason);
    expect(view.state).toBe("Superseded");
    expect(view.history[0]).toMatchObject({ current: false, evidenceCurrent: false, record: recorded });
  });

  it("accepts the exact routing/test/review boundary and is deterministic without mutating records", () => {
    const source = indexInput();
    const recorded = { ...effectiveOutcome(), verifiedAt: "2026-05-03T00:00:00.000Z" };
    source.targets = [target({ executionLinks: [{ ...target().executionLinks[0], linkedAt: recorded.verifiedAt }] })];
    source.targets = source.targets.map((entry) => ({
      ...entry,
      executions: entry.executions.map((execution) => ({
        ...execution, completedAt: recorded.verifiedAt,
      })),
    }));
    recorded.completionConditions = getIcarusTreatmentCompletion(source.targets[0], source.nowMs ?? Date.parse(recorded.verifiedAt)).conditions;
    recorded.executionLinks = [{ recordType: "Action", recordId: "action-1", linkedAt: recorded.verifiedAt }];
    source.assessments = [assessment({ treatmentOutcomes: [recorded] })];
    source.nowMs = Date.parse(recorded.verifiedAt);
    const before = JSON.stringify(source.assessments);
    const result = buildIcarusTreatmentOutcomeIndex(source);
    expect(result.get(target().id)?.state).toBe("Verified effective");
    expect(result).toEqual(buildIcarusTreatmentOutcomeIndex(source));
    expect(JSON.stringify(source.assessments)).toBe(before);
  });

  it.each([
    ["2026-05-02T00:00:00.000Z", "Source control test postdates verification or has an invalid date: test-1"],
    ["2026-05-21T00:00:00.000Z", "Verification date is invalid or in the future"],
  ])("rejects invalid review chronology %s", (verifiedAt, issue) => {
    const recorded = { ...effectiveOutcome(), verifiedAt };
    const view = buildIcarusTreatmentOutcomeIndex(indexInput({
      assessments: [assessment({ treatmentOutcomes: [recorded] })],
    })).get(target().id)!;
    expect(view.state).toBe("Superseded");
    expect(view.history[0].issues).toContain(issue);
    expect(view.history[0].evidenceCurrent).toBe(false);
  });

  it("rejects future source tests and supporting evidence independently of a claimed Assured status", () => {
    const source = indexInput({ nowMs: Date.parse("2026-05-02T00:00:00.000Z") });
    expect(buildIcarusTreatmentOutcomeIndex(source).get(target().id)?.options).toEqual([]);
    const recorded = effectiveOutcome();
    const changed = assessment({ treatmentOutcomes: [recorded] });
    changed.failureModes[0].evidence[0].reviewedAt = "2026-05-05T00:00:00.000Z";
    const view = buildIcarusTreatmentOutcomeIndex(indexInput({ assessments: [changed] })).get(target().id)!;
    expect(view.history[0].issues).toContain(`Supporting evidence postdates verification or has an invalid date: ${evidenceId}`);
    expect(view.history[0].current).toBe(false);
  });

  it("invalidates relinked execution even when its identity and evidence are unchanged", () => {
    const view = buildIcarusTreatmentOutcomeIndex(indexInput({
      assessments: [assessment({ treatmentOutcomes: [effectiveOutcome()] })],
      targets: [target({ executionLinks: [{ ...target().executionLinks[0], linkedAt: "2026-05-02T00:00:00.000Z" }] })],
    })).get(target().id)!;
    expect(view.options).toEqual([]);
    expect(view.issues).toContain("Completion chronology is invalid: Action:action-1");
    expect(view.history[0].issues).toContain("Execution linkage provenance has changed");
    expect(view.state).toBe("Superseded");
  });

  it("does not verify treatment effectiveness from Healthy / on-track project status", () => {
    const reference = { recordType: "Project" as const, recordId: "dependency" };
    const currentTarget = target({ dependencyReference: reference });
    const source = indexInput({
      targets: [currentTarget],
      dependencyHealth: new Map([["Project:dependency", {
        reference, health: "Healthy", source: "Derived", basis: ["on-track-project"], supportingRecords: [reference],
      }]]),
    });
    const option = buildIcarusTreatmentOutcomeIndex(source).get(currentTarget.id)!.options[0];
    expect(option.outcome).toBe("Inconclusive");
    const old = { ...effectiveOutcome(), outcome: "Effective" as const, evidence: [...option.evidence], afterState: option.afterState };
    source.assessments = [assessment({ treatmentOutcomes: [old] })];
    expect(buildIcarusTreatmentOutcomeIndex(source).get(currentTarget.id)?.state).toBe("Superseded");
  });

  it("rejects ambiguous outcome identities and mismatched assessment provenance", () => {
    const recorded = effectiveOutcome();
    const source = indexInput({ assessments: [assessment({ treatmentOutcomes: [recorded, { ...recorded }] })] });
    expect(buildIcarusTreatmentOutcomeIndex(source).get(target().id)?.history.every((entry) =>
      !entry.current && !entry.evidenceCurrent && entry.issues?.includes("Ambiguous treatment outcome identity"))).toBe(true);
    const wrong = { ...recorded, assessmentId: "different" };
    source.assessments = [assessment({ treatmentOutcomes: [wrong] })];
    expect(buildIcarusTreatmentOutcomeIndex(source).get(target().id)?.history[0].issues)
      .toContain("Outcome belongs to a different assessment");
  });

  it.each(["Missing", "Duplicated"] as const)("rejects %s source control tests despite a claimed current assurance event", (state) => {
    const record = assessment();
    record.controls[0].assuranceTests = state === "Missing" ? [] : [
      ...record.controls[0].assuranceTests!, { ...record.controls[0].assuranceTests![0] },
    ];
    const source = indexInput({ assessments: [record] });
    const view = buildIcarusTreatmentOutcomeIndex(source).get(target().id)!;
    expect(view.options).toEqual([]);
    expect(view.issues).toContain(`Missing or ambiguous source control test: ${controlId}/${testId}`);
  });

  it("does not turn an old test into post-selection evidence by recording a fresh review", () => {
    const source = indexInput();
    const issues = getIcarusTreatmentVerificationIssues(
      source.targets[0], effectiveOutcome().evidence, source.assessments,
      Date.parse("2026-05-05T00:00:00.000Z"), source.nowMs!,
      Date.parse("2026-05-04T00:00:00.000Z"),
    );
    expect(issues).toContain(`Source control test predates treatment routing or intervention selection: ${testId}`);
  });

  it("keeps legacy outcomes readable but cannot infer their missing completion provenance", () => {
    const recorded = effectiveOutcome();
    delete recorded.completionConditions;
    const loaded = parseIcarusAssessments(JSON.stringify([assessment({ treatmentOutcomes: [recorded] })]));
    expect(loaded[0].treatmentOutcomes).toEqual([recorded]);
    const view = buildIcarusTreatmentOutcomeIndex(indexInput({ assessments: loaded })).get(target().id)!;
    expect(view.state).toBe("Superseded");
    expect(view.history[0].issues).toContain("Recorded verification has no completion provenance");
    expect(view.protection).toBe("Protection unknown");
  });

  it("preserves an outcome with damaged optional completion data without granting assurance", () => {
    const recorded = effectiveOutcome();
    const loaded = parseIcarusAssessments(JSON.stringify([assessment({
      treatmentOutcomes: [{ ...recorded, completionConditions: [] }],
    })]));
    expect(loaded[0].treatmentOutcomes?.[0]).toMatchObject({
      id: recorded.id, verificationNote: recorded.verificationNote, completionConditions: [],
    });
    expect(buildIcarusTreatmentOutcomeIndex(indexInput({ assessments: loaded })).get(target().id)?.history[0].current).toBe(false);
    const damaged = JSON.parse(JSON.stringify(assessment({ treatmentOutcomes: [recorded] })));
    damaged.treatmentOutcomes[0].completionConditions = [{ invalid: true }];
    const repaired = parseIcarusAssessments(JSON.stringify([damaged]));
    expect(repaired[0].treatmentOutcomes?.[0].id).toBe(recorded.id);
    expect(repaired[0].treatmentOutcomes?.[0].completionConditions).toEqual([]);
  });

  it.each([
    { completedAt: undefined, completionEvidence: undefined },
    { completedAt: "2026-05-01T00:00:00.000Z", completionEvidence: "" },
    { completedAt: "2026-02-30T00:00:00.000Z", completionEvidence: "Claimed completion" },
    { completedAt: "2026-05-21T00:00:00.000Z", completionEvidence: "Claimed completion" },
  ])("never infers completion provenance from Completed status: %j", (completion) => {
    const routed = target();
    const view = buildIcarusTreatmentOutcomeIndex(indexInput({
      targets: [{ ...routed, executions: routed.executions.map((execution) => ({ ...execution, ...completion })) }],
    })).get(routed.id)!;
    expect(view.options).toEqual([]);
    expect(view.state).toBe("Awaiting verification");
    expect(view.completion?.issues.length).toBeGreaterThan(0);
    expect(view.protection).toBe("Not observed");
  });

  it("requires observations to follow the last of all linked execution completions", () => {
    const routed = target();
    const linked = {
      ...routed,
      executionLinks: [...routed.executionLinks, { recordType: "Project" as const, recordId: "project", linkedAt: "2026-05-01T00:00:00.000Z" }],
      executions: [...routed.executions, {
        recordType: "Project" as const, recordId: "project", title: "Project", status: "Completed",
        completedAt: "2026-05-04T00:00:00.000Z", completionEvidence: "Completion recorded",
      }],
    };
    const view = buildIcarusTreatmentOutcomeIndex(indexInput({ targets: [linked] })).get(routed.id)!;
    expect(view.options).toEqual([]);
    expect(view.issues).toContain(`Source control test predates execution completion: ${testId}`);
    expect(view.completion?.conditions).toHaveLength(2);
  });

  it("records explicit completion review provenance for a Project without inventing operating fields", () => {
    const link = { recordType: "Project" as const, recordId: "project", linkedAt: "2026-05-01T00:00:00.000Z" };
    const review = {
      id: "completion-review", completedAt: "2026-05-02T00:00:00.000Z",
      recordedAt: "2026-05-02T10:00:00.000Z", recordedByPersonId: "person-2",
      executionLinks: [link], note: "Reviewed completed delivery",
    };
    const routed = target({
      executionLinks: [link],
      executions: [{ recordType: "Project", recordId: "project", title: "Project", status: "Completed" }],
      completionReviews: [review],
    });
    const view = buildIcarusTreatmentOutcomeIndex(indexInput({ targets: [routed] })).get(routed.id)!;
    expect(view.options.map((option) => option.outcome)).toEqual(["Effective"]);
    expect(view.state).toBe("Awaiting verification");
    expect(view.protection).toBe("Observed — review required");
    expect(view.completion?.conditions[0]).toMatchObject({
      source: "Completion review", completionReviewId: review.id, completedAt: review.completedAt, basis: review.note,
    });
    expect(routed.executions[0].completedAt).toBeUndefined();
    const stored = assessment({
      treatmentTargets: [{
        ...routed, basis: [], affectedAssessmentIds: [assessmentId], objectiveIds: [], pillarIds: [],
        executionLinks: [link], promotedAt: link.linkedAt, completionReviews: [review],
        observationPlans: routed.observationPlans ? [...routed.observationPlans] : undefined,
      }],
    });
    expect(parseIcarusAssessments(JSON.stringify([stored]))[0].treatmentTargets?.[0].completionReviews).toEqual([review]);
    const changed = { ...routed, executionLinks: [{ ...link, linkedAt: "2026-05-02T00:00:00.000Z" }] };
    expect(getIcarusTreatmentCompletion(changed, indexInput().nowMs!).issues)
      .toContain("Completion review provenance is invalid or no longer matches execution linkage");
  });

  it("invalidates a verification snapshot when completion evidence changes or execution reopens", () => {
    const routed = target();
    const source = indexInput({ assessments: [assessment({ treatmentOutcomes: [effectiveOutcome()] })] });
    source.targets = [{ ...routed, executions: routed.executions.map((execution) => ({
      ...execution, completionEvidence: "Changed completion basis",
    })) }];
    const changed = buildIcarusTreatmentOutcomeIndex(source).get(routed.id)!;
    expect(changed.history[0].current).toBe(false);
    expect(changed.history[0].issues).toContain("Execution completion provenance has changed");
    source.targets = [{ ...routed, state: "In progress", executions: routed.executions.map((execution) => ({
      ...execution, status: "In Progress",
    })) }];
    expect(buildIcarusTreatmentOutcomeIndex(source).get(routed.id)?.protection).toBe("Protection unknown");
  });

  it("expires follow-up assurance at the deadline boundary and cannot renew it with the same observation", () => {
    const recorded = { ...effectiveOutcome(), nextObservationBy: "2026-05-05" };
    const source = indexInput({ assessments: [assessment({ treatmentOutcomes: [recorded] })],
      nowMs: Date.parse("2026-05-05T23:59:59.999Z") });
    expect(buildIcarusTreatmentOutcomeIndex(source).get(target().id)?.state).toBe("Verified effective");
    source.nowMs!++;
    const due = buildIcarusTreatmentOutcomeIndex(source).get(target().id)!;
    expect(due.history[0].evidenceCurrent).toBe(false);
    expect(due.protection).toBe("Observation due");
    const next = {
      ...recorded, occurrenceId: "renewal",
      id: getIcarusTreatmentOutcomeId(recorded.treatmentTargetId, recorded.verifiedByPersonId, recorded.evidence, "renewal"),
      verifiedAt: "2026-05-06T00:00:00.000Z", nextObservationBy: "2026-05-10",
    };
    source.assessments = [assessment({ treatmentOutcomes: [recorded, next] })];
    expect(buildIcarusTreatmentOutcomeIndex(source).get(target().id)?.history[1].issues)
      .toContain("Follow-up requires a new source observation, not another review of the same evidence");
  });

  it("distinguishes distinct repeat tests, reused tests, intervening failure and current deterioration", () => {
    const first = effectiveOutcome();
    const source = indexInput();
    const record = assessment({ treatmentOutcomes: [first] });
    const current = source.assurance.byAssessmentId.get(assessmentId)!;
    record.controls[0].assuranceTests!.push({
      id: "repeat-test", testedAt: "2026-05-06T00:00:00.000Z",
      testedByPersonId: "person-2", result: "Passed", evidenceIds: [evidenceId],
    });
    source.assessments = [record];
    source.assurance = { byAssessmentId: new Map([[assessmentId, {
      ...current, controls: current.controls.map((control) => ({
        ...control, lastEvent: { ...control.lastEvent!, testId: "repeat-test", at: "2026-05-06T00:00:00.000Z" },
      })),
    }]]) };
    const option = buildIcarusTreatmentOutcomeIndex(source).get(target().id)!.options[0];
    const second = {
      ...first, occurrenceId: "repeat", verifiedAt: "2026-05-07T00:00:00.000Z",
      id: getIcarusTreatmentOutcomeId(first.treatmentTargetId, first.verifiedByPersonId, option.evidence, "repeat"),
      evidence: [...option.evidence], nextObservationBy: "2026-06-01",
    };
    record.treatmentOutcomes = [first, second];
    expect(buildIcarusTreatmentOutcomeIndex(source).get(target().id)?.protection).toBe("Repeated protection observed");
    record.controls[0].assuranceTests!.push({
      id: "intervening-failure", testedAt: "2026-05-05T00:00:00.000Z",
      testedByPersonId: "person-2", result: "Failed", evidenceIds: [evidenceId],
    });
    expect(buildIcarusTreatmentOutcomeIndex(source).get(target().id)?.protection).toBe("Evidence-supported effectiveness");
    const duplicate = { ...second, occurrenceId: "same-observation",
      id: getIcarusTreatmentOutcomeId(first.treatmentTargetId, first.verifiedByPersonId, second.evidence, "same-observation") };
    record.treatmentOutcomes = [second, duplicate];
    expect(buildIcarusTreatmentOutcomeIndex(source).get(target().id)?.protection).toBe("Evidence-supported effectiveness");
    record.controls[0].assuranceTests!.push({
      id: "latest-failure", testedAt: "2026-05-08T00:00:00.000Z",
      testedByPersonId: "person-2", result: "Failed", evidenceIds: [evidenceId],
    });
    source.assurance = { byAssessmentId: new Map([[assessmentId, {
      ...current, controls: current.controls.map((control) => ({
        ...control, status: "Failed" as const, evidence: "Conflicting" as const,
        lastEvent: { ...control.lastEvent!, result: "Failed" as const, testId: "latest-failure", at: "2026-05-08T00:00:00.000Z" },
      })),
    }]]) };
    expect(buildIcarusTreatmentOutcomeIndex(source).get(target().id)?.protection).toBe("Protection deteriorated");
  });
});
