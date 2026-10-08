import { describe, expect, it } from "vitest";
import {
  getIcarusTreatmentOutcomeId, getIcarusTreatmentTargetId, parseIcarusAssessments,
  type IcarusAssessmentRecord, type IcarusObservationPlan, type IcarusTreatmentOutcomeRecord,
} from "./icarus";
import { buildIcarusStrategicIntelligence, type IcarusStrategicIntelligenceInput } from "./icarus-intelligence-pipeline";
import { getIcarusCurrentExposureSignals } from "./icarus-strategic-attention";
import { buildCommandAttention } from "./command-attention";
import { buildOrganisationalLearning } from "./organisational-learning";
import { buildIcarusInterventionIndex } from "./icarus-intervention-decision";

const routedAt = "2026-05-01T10:00:00.000Z";
const completedAt = "2026-05-02T10:00:00.000Z";
const plannedAt = "2026-05-03T10:00:00.000Z";
const testedAt = "2026-05-04T10:00:00.000Z";
const verifiedAt = "2026-05-05T10:00:00.000Z";
const nowMs = Date.parse("2026-05-06T10:00:00.000Z");
const targetId = getIcarusTreatmentTargetId("Failure-chain restoration", "restore");

function plan(overrides: Partial<IcarusObservationPlan> = {}): IcarusObservationPlan {
  return {
    id: "plan", recordedAt: plannedAt, recordedByPersonId: "reviewer", ownerPersonId: "observer",
    protection: "Operating control interrupts the declared failure path", controlIds: ["control"],
    evidenceRequirements: "Dated direct observation and a control test for the monitored operation",
    acceptanceCriteria: "Control operates successfully under the observed failure condition",
    firstReviewBy: "2026-05-07", ...overrides,
  };
}

function input(): IcarusStrategicIntelligenceInput {
  const assessment: IcarusAssessmentRecord = {
    id: "risk", outcome: "Operating continuity", status: "Open", createdAt: routedAt, updatedAt: routedAt,
    linkedRecords: [{ recordType: "Pillar", recordId: "Excavation" }],
    failureModes: [{
      id: "mode", mechanism: "Loss of operating protection", vulnerability: "Control unavailable",
      evidence: [{
        id: "evidence", statement: "Observed operating protection", origin: "Direct observation",
        observedAt: testedAt, recordedAt: testedAt, recordedBy: "observer",
        review: "Supports", reviewedAt: testedAt, reviewedBy: "reviewer",
      }],
    }],
    controls: [{
      id: "control", failureModeId: "mode", intervention: "Operating barrier", lifecycle: "Active",
      effectiveness: "Unknown", evidenceIds: ["evidence"], linkedRecords: [],
      ownerPersonId: "observer", nextReviewAt: "2026-12-01",
      assuranceTests: [{ id: "test", testedAt, testedByPersonId: "observer", result: "Passed", evidenceIds: ["evidence"] }],
    }],
    treatmentTargets: [{
      id: targetId, sourceKind: "Failure-chain restoration", sourceId: "restore", assessmentId: "risk",
      failureModeId: "mode", controlId: "control", treatmentKind: "Restore barrier", reason: "Corrective action",
      basis: [], affectedAssessmentIds: ["risk"], objectiveIds: [], pillarIds: ["Excavation"],
      provenance: { kind: "Failure-chain recommendation", finding: "Restore protection" },
      executionLinks: [{ recordType: "Action", recordId: "action", linkedAt: routedAt }],
      promotedAt: routedAt, observationPlans: [plan()],
    }],
  };
  return {
    assessments: [assessment], sourceRecords: [{ recordType: "Pillar", recordId: "Excavation", title: "Excavation" }],
    strategicObjectives: [], people: [{ id: "reviewer", status: "Active" }, { id: "observer", status: "Active" }],
    actions: [{ id: "action", status: "Completed" }],
    treatmentActions: [{
      recordType: "Action", recordId: "action", title: "Restore barrier", status: "Completed",
      completedAt, completionEvidence: "Recorded restoration completion",
    }],
    primaryFounderId: "reviewer", founderDependencyActive: false, nowMs,
  };
}

function withOutcome(source = input()) {
  const view = buildIcarusStrategicIntelligence(source).treatment.verification.get(targetId)!;
  const option = view.options.find((entry) => entry.outcome === "Effective");
  if (!option) throw new Error("Fixture needs a current effective observation option");
  const outcome: IcarusTreatmentOutcomeRecord = {
    id: getIcarusTreatmentOutcomeId(targetId, "reviewer", option.evidence, "observation"),
    occurrenceId: "observation", treatmentTargetId: targetId, assessmentId: "risk",
    executionLinks: source.assessments[0].treatmentTargets![0].executionLinks,
    outcome: "Effective", verifiedAt, verifiedByPersonId: "reviewer", evidence: [...option.evidence],
    afterState: option.afterState, completionConditions: [...view.completion!.conditions],
    verificationNote: "Protection observed after completed work", observationPlan: plan(),
    observationCriteriaResult: "Met", observationCriteriaNote: "The cited operation and test meet the declared criteria",
    nextObservationBy: "2026-05-10",
  };
  return { source: { ...source, assessments: [{ ...source.assessments[0], treatmentOutcomes: [outcome] }] }, outcome };
}

const view = (source: IcarusStrategicIntelligenceInput) => buildIcarusStrategicIntelligence(source).treatment.verification.get(targetId)!;

describe("accountable Icarus observation planning", () => {
  it("schedules exact protection and preserves assignment, criteria, completion and outcome history across persistence", () => {
    const source = input();
    expect(view(source).observation).toMatchObject({ state: "Scheduled", plan: plan(), nextReviewBy: "2026-05-07" });
    const completed = withOutcome();
    expect(view(completed.source).observation).toMatchObject({
      state: "Completed", lastOutcomeId: completed.outcome.id, nextReviewBy: "2026-05-10",
    });
    expect(view(completed.source).state).toBe("Verified effective");
    const loaded = parseIcarusAssessments(JSON.stringify(completed.source.assessments));
    expect(loaded).toEqual(completed.source.assessments);
    expect(view({ ...completed.source, assessments: loaded }).observation?.state).toBe("Completed");
    expect(buildIcarusStrategicIntelligence(completed.source)).toEqual(buildIcarusStrategicIntelligence(completed.source));
  });

  it("distinguishes missing, unowned and invalid responsibilities without inventing People or evidence", () => {
    const source = input();
    source.assessments[0].treatmentTargets![0].observationPlans = undefined;
    expect(view(source).observation?.state).toBe("Missing");
    source.assessments[0].treatmentTargets![0].observationPlans = [plan({ ownerPersonId: "missing" })];
    expect(view(source).observation?.state).toBe("Unowned");
    source.assessments[0].treatmentTargets![0].observationPlans = [plan({ acceptanceCriteria: "" })];
    expect(view(source).observation?.state).toBe("Invalid");
    source.assessments[0].treatmentTargets![0].observationPlans = [plan({ controlIds: ["different"] })];
    expect(view(source).observation?.issues.join()).toContain("outside treatment scope");
    source.assessments[0].treatmentTargets![0].observationPlans = [plan({ firstReviewBy: "2026-02-30" })];
    expect(view(source).observation?.state).toBe("Invalid");
  });

  it.each(["Inactive", "Missing", "Duplicated"])("cannot maintain verified observation with a %s accountable Person", (state) => {
    const { source } = withOutcome();
    source.people = state === "Missing" ? source.people.filter((person) => person.id !== "observer")
      : state === "Duplicated" ? [...source.people, { id: "observer", status: "Active" }]
        : source.people.map((person) => person.id === "observer" ? { ...person, status: "Inactive" } : person);
    expect(view(source).observation?.state).toBe("Unowned");
    expect(view(source).history[0].evidenceCurrent).toBe(false);
  });

  it("supports a delegated observer and a separate reviewer; completion is not founder-owned execution", () => {
    const { source } = withOutcome();
    const intelligence = buildIcarusStrategicIntelligence(source);
    expect(view(source).observation?.plan?.ownerPersonId).toBe("observer");
    expect(view(source).latest?.verifiedByPersonId).toBe("reviewer");
    expect(intelligence.treatment.targets[0].founderOwned).toBe(false);
  });

  it.each([
    { observationCriteriaResult: undefined },
    { observationCriteriaResult: "Not met" as const },
    { observationCriteriaNote: "" },
    { nextObservationBy: undefined },
    { observationPlan: undefined },
  ])("cannot claim Effective with incomplete plan verification: %j", (change) => {
    const { source, outcome } = withOutcome();
    source.assessments[0].treatmentOutcomes = [{ ...outcome, ...change }];
    expect(view(source).state).toBe("Superseded");
    expect(view(source).history[0].current).toBe(false);
  });

  it("requires fresh dated source observations, not only a passing test or a newer review timestamp", () => {
    const { source, outcome } = withOutcome();
    source.assessments[0].failureModes[0].evidence[0].observedAt = completedAt;
    expect(view(source).history[0].issues?.join()).toContain("dated fresh source evidence");
    source.assessments[0].failureModes[0].evidence[0].observedAt = testedAt;
    const repeated = {
      ...outcome, occurrenceId: "repeat", verifiedAt: "2026-05-06T10:00:00.000Z",
      id: getIcarusTreatmentOutcomeId(targetId, "reviewer", outcome.evidence, "repeat"), nextObservationBy: "2026-06-01",
    };
    source.assessments[0].treatmentOutcomes = [outcome, repeated];
    expect(view(source).history[1].issues?.join()).toContain("fresh post-plan control test");
    expect(view(source).history[1].current).toBe(false);
  });

  it("distinguishes Due and Overdue at the exact deadline without inventing fresh assurance", () => {
    const { source } = withOutcome();
    source.nowMs = Date.parse("2026-05-10T23:59:59.999Z");
    expect(view(source).observation?.state).toBe("Due");
    expect(view(source).history[0].current).toBe(true);
    source.nowMs++;
    expect(view(source).observation?.state).toBe("Overdue");
    expect(view(source).history[0].current).toBe(false);
  });

  it("replanning retains earlier overdue responsibilities and cannot reuse old evidence under the new criteria", () => {
    const source = input();
    const replacement = plan({
      id: "replacement", recordedAt: "2026-05-09T10:00:00.000Z", firstReviewBy: "2026-06-01",
      acceptanceCriteria: "A stronger revised operating criterion",
    });
    source.assessments[0].treatmentTargets![0].observationPlans!.push(replacement);
    source.nowMs = Date.parse(replacement.recordedAt);
    expect(view(source).observation).toMatchObject({ state: "Overdue", nextReviewBy: "2026-05-07" });
    const { source: reviewed } = withOutcome();
    reviewed.assessments[0].treatmentTargets![0].observationPlans!.push(replacement);
    reviewed.nowMs = source.nowMs;
    expect(view(reviewed).history[0].issues?.join()).toContain("current observation plan");
    expect(view(reviewed).history[0].evidenceCurrent).toBe(false);
  });

  it("surfaces observation responsibility in Command even for a Closed, currently protected risk without inflating exposure history", () => {
    const source = input();
    source.assessments[0].status = "Closed";
    source.nowMs = Date.parse("2026-05-08T10:00:00.000Z");
    const intelligence = buildIcarusStrategicIntelligence(source);
    expect(intelligence.strategicSignals).toHaveLength(1);
    expect(intelligence.strategicSignals[0].lifecycle?.attentionReasons.join()).toContain("Overdue");
    expect(getIcarusCurrentExposureSignals(intelligence.strategicSignals)).toEqual([]);
    expect(intelligence.exposureSnapshot).toEqual([]);
    const command = buildCommandAttention({
      actions: [], projects: [], decisions: [], opportunities: [], lessons: [], problems: [], systems: [], sops: [],
      outreach: [], handoffs: [], procurementQueue: [], icarus: intelligence.strategicSignals, nowMs: source.nowMs,
    });
    expect(command.items.find((item) => item.objectType === "Icarus")?.reasons.join()).toContain("Observation responsibility");
    expect(command.items.find((item) => item.objectType === "Icarus")?.attentionRank).toBeGreaterThanOrEqual(3);
  });

  it("withdraws Worked organisational learning when its planned observation is overdue", () => {
    const { source } = withOutcome();
    const learning = (now: number) => {
      const intelligence = buildIcarusStrategicIntelligence({ ...source, nowMs: now });
      const interventions = buildIcarusInterventionIndex({
        assessments: source.assessments, treatment: intelligence.treatment, signals: intelligence.strategicSignals,
        sources: [], decisions: [], lessons: [], people: source.people, nowMs: now,
      });
      return buildOrganisationalLearning({
        actions: [], projects: [], decisions: [], lessons: [], problems: [], systems: [], sops: [],
        icarusTreatmentOutcomes: interventions.learningInput,
      }).find((signal) => signal.sourceType === "Icarus Treatment");
    };
    expect(learning(nowMs)?.outcomeState).toBe("Worked");
    expect(learning(Date.parse("2026-05-11T10:00:00.000Z"))?.outcomeState).toBe("Unknown");
    expect(learning(nowMs)?.evidence).toContainEqual(expect.objectContaining({
      field: "observationOwnerPersonId", value: "observer",
    }));
  });

  it("accepts a genuinely new scoped observation and schedules its next responsibility rather than retaining the initial deadline", () => {
    const { source, outcome } = withOutcome();
    const assessed = source.assessments[0];
    const later = "2026-05-11T10:00:00.000Z";
    assessed.failureModes[0].evidence.push({
      ...assessed.failureModes[0].evidence[0], id: "new-evidence", observedAt: later, recordedAt: later, reviewedAt: later,
    });
    assessed.controls[0].assuranceTests!.push({
      id: "new-test", testedAt: later, testedByPersonId: "observer", result: "Passed", evidenceIds: ["new-evidence"],
    });
    source.nowMs = Date.parse(later);
    const current = view(source);
    const option = current.options.find((option) => option.outcome === "Effective")!;
    expect(option).toBeDefined();
    const next: IcarusTreatmentOutcomeRecord = {
      ...outcome, id: getIcarusTreatmentOutcomeId(targetId, "reviewer", option.evidence, "new-observation"),
      occurrenceId: "new-observation", verifiedAt: later, evidence: [...option.evidence],
      nextObservationBy: "2026-05-20",
    };
    assessed.treatmentOutcomes!.push(next);
    expect(view(source).observation).toMatchObject({ state: "Completed", nextReviewBy: "2026-05-20", lastOutcomeId: next.id });
    expect(view(source).history.at(-1)?.current).toBe(true);
    expect(view(source).options).toEqual([]);
  });

  it("preserves an explicit inconclusive criteria review without upgrading passed tests to treatment effectiveness", () => {
    const { source, outcome } = withOutcome();
    source.assessments[0].treatmentOutcomes = [{
      ...outcome, outcome: "Inconclusive", observationCriteriaResult: "Inconclusive",
      observationCriteriaNote: "The observed sample does not establish the declared acceptance criterion",
    }];
    expect(view(source).state).toBe("Verification inconclusive");
    expect(view(source).observation?.state).toBe("Completed");
  });

  it("requires every control in a broad plan and does not accept a single passing barrier as verification of the whole scope", () => {
    const source = input();
    const assessed = source.assessments[0];
    assessed.controls.push({
      ...assessed.controls[0], id: "second-control",
      assuranceTests: [{ id: "second-test", testedAt, testedByPersonId: "observer", result: "Passed", evidenceIds: ["evidence"] }],
    });
    assessed.treatmentTargets![0].controlId = undefined;
    const broad = plan({ controlIds: ["control", "second-control"] });
    assessed.treatmentTargets![0].observationPlans = [broad];
    const initial = view(source);
    expect(buildIcarusStrategicIntelligence(source).assurance.byAssessmentId.get("risk")?.modes[0].material).toBe(false);
    expect(initial.issues).toEqual([]);
    const option = initial.options.find((option) => option.outcome === "Effective")!;
    expect(option).toBeDefined();
    expect(option.evidence.filter((entry) => entry.kind === "Control test")).toHaveLength(2);
    const record: IcarusTreatmentOutcomeRecord = {
      id: getIcarusTreatmentOutcomeId(targetId, "reviewer", option.evidence, "broad"),
      occurrenceId: "broad", treatmentTargetId: targetId, assessmentId: "risk",
      executionLinks: assessed.treatmentTargets![0].executionLinks, evidence: [...option.evidence],
      outcome: "Effective", verifiedAt, verifiedByPersonId: "reviewer", verificationNote: "Both controls tested",
      afterState: option.afterState, completionConditions: [...initial.completion!.conditions],
      observationPlan: broad, observationCriteriaResult: "Met", observationCriteriaNote: "Both tests meet the declared criteria",
      nextObservationBy: "2026-05-10",
    };
    assessed.treatmentOutcomes = [record];
    expect(view(source).state).toBe("Verified effective");
    assessed.treatmentOutcomes = [{ ...record, evidence: record.evidence.filter((entry) =>
      entry.kind !== "Control test" || entry.controlId !== "second-control") }];
    expect(view(source).history[0].issues?.join()).toContain("every planned control");
    expect(view(source).history[0].current).toBe(false);
    assessed.treatmentOutcomes = [];
    assessed.controls[1].assuranceTests = [];
    expect(view(source).options).toEqual([]);
    assessed.controls[1].assuranceTests = [{
      id: "second-test", testedAt: completedAt, testedByPersonId: "observer", result: "Passed", evidenceIds: ["evidence"],
    }];
    expect(view(source).options).toEqual([]);
    expect(view(source).issues?.join()).toContain("fresh post-plan control test");
  });

  it("retains duplicate plan revisions as invalid rather than silently choosing an owner", () => {
    const source = input();
    source.assessments[0].treatmentTargets![0].observationPlans!.push({ ...plan() });
    const loaded = parseIcarusAssessments(JSON.stringify(source.assessments));
    expect(loaded[0].treatmentTargets![0].observationPlans).toHaveLength(2);
    expect(view({ ...source, assessments: loaded }).observation?.state).toBe("Invalid");
  });

  it("does not erase uncovered outstanding controls by narrowing a replacement plan", () => {
    const source = input();
    const assessed = source.assessments[0];
    assessed.controls.push({ ...assessed.controls[0], id: "other-control" });
    assessed.treatmentTargets![0].controlId = undefined;
    assessed.treatmentTargets![0].observationPlans = [
      plan({ controlIds: ["control", "other-control"] }),
      plan({ id: "narrow", recordedAt: "2026-05-06T09:00:00.000Z", firstReviewBy: "2026-06-01" }),
    ];
    expect(view(source).observation).toMatchObject({
      state: "Invalid", issues: ["Replacement plan leaves outstanding monitored controls without accountable observation coverage"],
    });
  });

  it("keeps legacy verification intact while explicitly surfacing its missing accountable plan", () => {
    const { source, outcome } = withOutcome();
    const { observationPlan, observationCriteriaResult, observationCriteriaNote, ...legacy } = outcome;
    expect(observationPlan).toBeDefined();
    expect(observationCriteriaResult).toBe("Met");
    expect(observationCriteriaNote).toBeTruthy();
    source.assessments[0].treatmentTargets![0].observationPlans = undefined;
    source.assessments[0].treatmentOutcomes = [legacy];
    const projected = view(source);
    expect(projected.state).toBe("Verified effective");
    expect(projected.observation?.state).toBe("Missing");
    expect(buildIcarusStrategicIntelligence(source).treatment.summaries.get("risk")?.attentionReasons.join())
      .toContain("Observation responsibility");
    expect(parseIcarusAssessments(JSON.stringify(source.assessments))[0].treatmentOutcomes).toEqual([legacy]);
  });
});
