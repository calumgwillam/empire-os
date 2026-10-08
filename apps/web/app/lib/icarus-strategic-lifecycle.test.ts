import { describe, expect, it } from "vitest";
import {
  getIcarusIdentityKey,
  getIcarusTreatmentOutcomeId,
  getIcarusTreatmentTargetId,
  parseIcarusAssessments,
  type IcarusAssessmentRecord,
  type IcarusConfirmedRegression,
  type IcarusControl,
  type IcarusResolutionScope,
  type IcarusStrategicResolutionReview,
  type IcarusTreatmentOutcomeRecord,
} from "./icarus";
import { buildIcarusStrategicIntelligence, type IcarusStrategicIntelligenceInput } from "./icarus-intelligence-pipeline";
import {
  buildIcarusStrategicLifecycleIndex,
  deriveIcarusRegressionEvidence,
  deriveIcarusResolutionEligibility,
  recordIcarusConfirmedRegression,
  recordIcarusResolutionReview,
  type IcarusStrategicLifecycleInput,
} from "./icarus-strategic-lifecycle";
import { buildCommandAttention, type CommandAttentionInput } from "./command-attention";
import { buildIcarusInterventionIndex, emptyIcarusInterventionScope } from "./icarus-intervention-decision";
import { buildOrganisationalLearning, type OrganisationalLearningInput } from "./organisational-learning";
import { buildLearningAttention } from "./learning-attention";
import { buildFounderFocus } from "./founder-focus";

const createdAt = "2026-10-01T10:00:00.000Z";
const reviewedAt = "2026-10-02T10:00:00.000Z";
const later = "2026-10-03T10:00:00.000Z";
const recoveredAt = "2026-10-04T10:00:00.000Z";
const scope: IcarusResolutionScope = { kind: "Whole assessment", failureModeIds: ["mode"] };

function control(id = "control", dependencies = true): IcarusControl {
  return {
    id, failureModeId: "mode", intervention: "Tested operating protection", lifecycle: "Active",
    effectiveness: "Unknown", evidenceIds: ["evidence"], ownerPersonId: "reviewer",
    linkedRecords: dependencies ? [{ recordType: "Person", recordId: "operator" }] : [],
    nextReviewAt: "2026-12-01",
    assuranceTests: [{ id: `${id}-test`, testedAt: createdAt, testedByPersonId: "reviewer", result: "Passed", evidenceIds: ["evidence"] }],
  };
}
function assessment(overrides: Partial<IcarusAssessmentRecord> = {}): IcarusAssessmentRecord {
  return {
    id: "risk", outcome: "Service continuity", status: "Open", createdAt, updatedAt: createdAt,
    accountableOwnerPersonId: "reviewer", nextReviewBy: "2026-12-01",
    linkedRecords: [{ recordType: "Pillar", recordId: "Excavation" }],
    failureModes: [{
      id: "mode", mechanism: "Required protection does not operate", vulnerability: "Operating dependency",
      evidence: [{
        id: "evidence", statement: "Observed mechanism and operating protection", origin: "Direct observation",
        observedAt: createdAt, recordedAt: createdAt, recordedBy: "reviewer", review: "Supports", reviewedAt: createdAt, reviewedBy: "reviewer",
      }],
    }],
    controls: [control()],
    ...overrides,
  };
}
function pipelineInput(records: IcarusAssessmentRecord[], overrides: Partial<IcarusStrategicIntelligenceInput> = {}): IcarusStrategicIntelligenceInput {
  return {
    assessments: records,
    sourceRecords: [
      { recordType: "Pillar", recordId: "Excavation", title: "Excavation" },
      { recordType: "Person", recordId: "operator", title: "Operator" },
    ],
    people: [{ id: "reviewer", status: "Active" }, { id: "operator", status: "Active" }],
    strategicObjectives: [], actions: [], primaryFounderId: "reviewer", founderDependencyActive: false,
    nowMs: Date.parse(reviewedAt), ...overrides,
  };
}
function derive(records: IcarusAssessmentRecord[], overrides: Partial<IcarusStrategicIntelligenceInput> = {}) {
  const source = pipelineInput(records, overrides);
  const intelligence = buildIcarusStrategicIntelligence(source);
  const input: IcarusStrategicLifecycleInput = {
    assessments: records, assurance: intelligence.assurance, dependencyHealth: intelligence.dependencyHealth,
    treatment: intelligence.treatment, signals: intelligence.strategicSignals, people: source.people,
    nowMs: intelligence.nowMs, hypothetical: source.hypothetical,
  };
  return { intelligence, input, view: intelligence.lifecycle.byAssessmentId.get("risk")! };
}
function verified(records = [assessment()], overrides: Partial<IcarusStrategicIntelligenceInput> = {}) {
  const { input } = derive(records, overrides);
  const eligibility = deriveIcarusResolutionEligibility(input, "risk", scope);
  expect(eligibility.state).toBe("Eligible for human review");
  const record: IcarusStrategicResolutionReview = {
    id: "resolution", assessmentId: "risk", reviewedAt, reviewedByPersonId: "reviewer",
    outcome: "Verified resolved", scope, controlConditions: [...eligibility.controlConditions],
    treatmentOutcomeIds: [...eligibility.treatmentOutcomeIds], causeIds: [], rationale: "Human reviewed this explicit protection scope.",
    nextReviewBy: "2026-12-01",
  };
  return { records: recordIcarusResolutionReview(input, record), record };
}
function failed(records: IcarusAssessmentRecord[]) {
  return derive(records, {
    nowMs: Date.parse(later), people: [{ id: "reviewer", status: "Active" }, { id: "operator", status: "Inactive" }],
  });
}
function regression(input: IcarusStrategicLifecycleInput, reviewId = "resolution"): IcarusConfirmedRegression {
  const affectedScope: IcarusResolutionScope = { kind: "Failure modes", failureModeIds: ["mode"] };
  return {
    id: "regression", assessmentId: "risk", resolutionReviewId: reviewId,
    confirmedAt: later, confirmedByPersonId: "reviewer", scope: affectedScope,
    evidenceKeys: [...deriveIcarusRegressionEvidence(input, "risk", affectedScope).observationKeys],
    causeIds: [], explanation: "Unknown", rationale: "Human confirms that material exposure has returned in this scope.",
  };
}
function command(signals: CommandAttentionInput["icarus"]) {
  return buildCommandAttention({
    problems: [], actions: [], outreach: [], projects: [], decisions: [], opportunities: [], lessons: [],
    systems: [], sops: [], handoffs: [], procurementQueue: [], icarus: signals, nowMs: Date.parse(later),
  });
}

describe("durable Icarus strategic lifecycle", () => {
  it.each(["Open", "Monitoring", "Closed"] as const)("does not infer verified resolution from %s, passed tests or disappearance", (status) => {
    const { view } = derive([assessment({ status })]);
    expect(view.recordedResolution).toBe(false);
    expect(view.reviews).toEqual([]);
    expect(view.regressions).toEqual([]);
  });

  it("requires explicit scope, positive current evidence and an explicit human record", () => {
    const { input, view } = derive([assessment()]);
    expect(view.eligibility.state).toBe("Eligible for human review");
    expect(view.recordedResolution).toBe(false);
    expect(deriveIcarusResolutionEligibility(input, "risk", { kind: "Failure modes", failureModeIds: [] }).state).toBe("Insufficient evidence");
    const { record } = verified();
    expect(() => recordIcarusResolutionReview(input, { ...record, controlConditions: [] })).toThrow();
    expect(() => recordIcarusResolutionReview(input, { ...record, reviewedByPersonId: "missing" })).toThrow();
    expect(() => recordIcarusResolutionReview(input, { ...record, rationale: "" })).toThrow();
    const unknown = derive([assessment({ controls: [{ ...control(), assuranceTests: [] }] })]);
    expect(unknown.view.eligibility.state).not.toBe("Eligible for human review");
    expect(unknown.view.recordedResolution).toBe(false);
  });

  it("retains a human-verified review when administration later closes the assessment", () => {
    const { records, record } = verified();
    const closed = records.map((entry) => ({ ...entry, status: "Closed" as const }));
    const { intelligence, view } = derive(closed, { nowMs: Date.parse(later) });
    expect(view.recordedResolution).toBe(true);
    expect(view.reviews[0].validity).toBe("Current");
    expect(view.reviews[0].record).toEqual(record);
    expect(closed[0].status).toBe("Closed");
    expect(intelligence.strategicSignals).toEqual([]);
    const hydrated = parseIcarusAssessments(JSON.stringify(closed));
    expect(hydrated).toEqual(closed);
    expect(hydrated[0].strategicResolutionReviews).toEqual([record]);
    expect(derive(hydrated, { nowMs: Date.parse(later) }).view.reviews[0]).toMatchObject({ record, validity: "Current" });
  });

  it("does not turn accepted exposure into a verified resolution review", () => {
    const accepted = assessment({
      controls: [],
      acceptances: [{
        id: "acceptance", failureModeIds: ["mode"], acceptedAt: createdAt, acceptedByPersonId: "reviewer",
        reviewBy: "2026-12-01", rationale: "Explicit tolerated exposure",
      }],
    });
    const { view } = derive([accepted]);
    expect(view.recordedResolution).toBe(false);
    expect(view.eligibility.state).toBe("Blocked");
    expect(view.eligibility.reasons).toContain("Accepted exposure is tolerated risk, not verified resolution");
  });

  it("failed required dependency restores scoped material concern without rewriting history or confirming regression", () => {
    const { records, record } = verified();
    const before = JSON.stringify(records);
    const { input, intelligence, view } = failed(records);
    expect(view.reviews[0].validity).toBe("Material regression suspected");
    expect(view.reviews[0].materialFailureModeIds).toEqual(["mode"]);
    expect(view.reviews[0].reasons).toContain("Reviewed effective protection is no longer established: mode");
    expect(view.regressions).toEqual([]);
    expect(intelligence.assurance.byAssessmentId.get("risk")?.controls[0].status).toBe("Assured");
    expect(intelligence.failureChains.dependencyGraph.controls[0].barrier).toBe("Failed");
    expect(intelligence.strategicSignals[0].lifecycle?.attentionReasons.join()).toContain("Suspected material regression");
    expect(buildIcarusStrategicLifecycleIndex(input)).toEqual(buildIcarusStrategicLifecycleIndex(input));
    expect(records[0].strategicResolutionReviews).toEqual([record]);
    expect(JSON.stringify(records)).toBe(before);
  });

  it("independent effective protection contains failed dependency and avoids false regression", () => {
    const { records } = verified([assessment({ controls: [control(), control("backup", false)] })]);
    const { view, intelligence } = failed(records);
    expect(view.reviews[0].validity).toBe("Current");
    expect(view.reviews[0].materialFailureModeIds).toEqual([]);
    expect(view.regressions).toEqual([]);
    expect(intelligence.strategicSignals).toEqual([]);
    expect(intelligence.failureChains.healthTriggeredChains).toEqual([]);
  });

  it("a later independent backup prevents material regression but does not rewrite the reviewed basis", () => {
    const { records } = verified();
    const withBackup = records.map((entry) => ({ ...entry, controls: [...entry.controls, control("backup", false)] }));
    const { view } = failed(withBackup);
    expect(view.reviews[0].validity).toBe("Assurance weakened");
    expect(view.reviews[0].materialFailureModeIds).toEqual([]);
  });

  it("Unknown dependency weakens historical assurance, never becoming Failed or confirmed regression", () => {
    const { records } = verified();
    const { view, intelligence, input } = derive(records, { nowMs: Date.parse(later), people: [{ id: "reviewer", status: "Active" }] });
    expect(intelligence.dependencyHealth.get("Person:operator")?.health).toBe("Unknown");
    expect(view.reviews[0].validity).toBe("Assurance weakened");
    expect(view.reviews[0].materialFailureModeIds).toEqual([]);
    expect(() => recordIcarusConfirmedRegression(input, regression(input))).toThrow();
  });

  it("uncontained degraded dependency is a suspected concern, not authority to confirm material regression", () => {
    const base = assessment();
    base.controls[0].linkedRecords = [{ recordType: "Project", recordId: "dependency" }];
    const sources: IcarusStrategicIntelligenceInput["sourceRecords"] = [
      { recordType: "Pillar", recordId: "Excavation", title: "Excavation" },
      { recordType: "Project", recordId: "dependency", title: "Dependency", status: "In Progress", health: "On track" },
    ];
    const { records } = verified([base], { sourceRecords: sources });
    const { view, input } = derive(records, {
      nowMs: Date.parse(later), sourceRecords: sources.map((record) => record.recordType === "Project" ? { ...record, health: "Blocked" } : record),
    });
    expect(view.reviews[0].validity).toBe("Material regression suspected");
    expect(view.reviews[0].materialFailureModeIds).toEqual([]);
    expect(() => recordIcarusConfirmedRegression(input, regression(input))).toThrow();
  });

  it("stale supporting evidence weakens assurance without proving regression", () => {
    const { records, record } = verified();
    const expired = records.map((entry) => ({
      ...entry, failureModes: entry.failureModes.map((mode) => ({
        ...mode, evidence: mode.evidence.map((evidence) => ({ ...evidence, validUntil: "2026-10-02" })),
      })),
    }));
    const { view } = derive(expired, { nowMs: Date.parse(later) });
    expect(view.reviews[0].validity).toBe("Assurance weakened");
    expect(view.reviews[0].materialFailureModeIds).toEqual([]);
    expect(view.regressions).toEqual([]);
    expect(expired[0].strategicResolutionReviews).toEqual([record]);
  });

  it("overdue explicit review is Review due, not assurance loss or regression", () => {
    const { records } = verified();
    records[0].strategicResolutionReviews![0] = { ...records[0].strategicResolutionReviews![0], nextReviewBy: "2026-10-02" };
    const { view } = derive(records, { nowMs: Date.parse(later) });
    expect(view.reviews[0].validity).toBe("Review due");
    expect(view.reviews[0].materialFailureModeIds).toEqual([]);
    expect(view.regressions).toEqual([]);
    expect(view.attentionReasons).toEqual([]);
  });

  it("surfaces high-consequence overdue reviews without pretending tested controls have failed", () => {
    const base = assessment({ linkedRecords: [{ recordType: "Strategic Objective", recordId: "objective" }] });
    const objectives = [{ id: "objective", pillar: "Excavation", importance: "Critical" as const, status: "Active" }];
    const sourceRecords = [{ recordType: "Strategic Objective" as const, recordId: "objective", title: "Continuity" },
      { recordType: "Person" as const, recordId: "operator", title: "Operator" }];
    const { records } = verified([base], { strategicObjectives: objectives, sourceRecords });
    records[0].strategicResolutionReviews![0] = { ...records[0].strategicResolutionReviews![0], nextReviewBy: "2026-10-02" };
    const { intelligence, view } = derive(records.map((record) => ({ ...record, status: "Closed" })), {
      nowMs: Date.parse(later), strategicObjectives: objectives, sourceRecords,
    });
    expect(view.reviews[0].validity).toBe("Review due");
    expect(intelligence.strategicSignals).toHaveLength(1);
    expect(intelligence.strategicSignals[0]).toMatchObject({ assessmentId: "risk", status: "Closed", materialityTier: "Corroborating" });
    expect(intelligence.strategicSignals[0].summary).toContain("effective protection remains established");
    const reminders = command(intelligence.strategicSignals).items.filter((item) => item.objectType === "Icarus");
    expect(reminders).toHaveLength(1);
    expect(reminders[0].reasons).toContain("ICARUS: STRATEGIC LIFECYCLE REVIEW");
    expect(reminders[0].reasons).not.toContain("ICARUS: CONTROL UNVERIFIED");
    expect(intelligence.exposureSnapshot).toEqual([]);
    expect(intelligence.correlationSignals).toEqual([]);
  });

  it("requires explicit durable human confirmation and resurfaces Closed identity exactly once", () => {
    const { records, record } = verified();
    const closed = records.map((entry) => ({ ...entry, status: "Closed" as const }));
    const { input, intelligence } = failed(closed);
    expect(intelligence.strategicSignals).toHaveLength(1);
    const identityKey = getIcarusIdentityKey("risk");
    expect(identityKey).toBe("icarus-assessment:risk");
    expect(intelligence.strategicSignals[0]).toMatchObject({
      key: identityKey, assessmentId: "risk", status: "Closed", primaryReference: { identityKey, assessmentId: "risk" },
    });
    const confirmation = regression(input);
    const confirmed = recordIcarusConfirmedRegression(input, confirmation);
    const current = failed(confirmed);
    expect(current.view.reviews[0].validity).toBe("Material regression confirmed");
    expect(current.view.regressions[0]).toMatchObject({ valid: true, record: confirmation });
    const items = command(current.intelligence.strategicSignals).items.filter((item) => item.objectType === "Icarus");
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("risk");
    expect(items[0].strategicRisk?.references).toEqual([expect.objectContaining({ identityKey, assessmentId: "risk" })]);
    expect(current.intelligence.correlationSignals).toHaveLength(1);
    expect(current.intelligence.correlationSignals[0].recordKey).toBe("Icarus:risk");
    expect(items[0].reasons.join()).toContain("Confirmed material regression");
    expect(items[0].attentionRank).toBeGreaterThanOrEqual(3);
    expect(current.intelligence.founderFocusRisks).toHaveLength(1);
    expect(current.intelligence.founderFocusRisks[0].reason).toContain("Confirmed material regression");
    const focus = buildFounderFocus({
      signalledRecords: [], founderReviewItems: [], limitations: [], convergentRisks: [],
      recordFacts: new Map(), strategicRisks: current.intelligence.founderFocusRisks,
    });
    expect(focus.filter((item) => item.objectType === "Icarus" && item.id === "risk")).toHaveLength(1);
    expect(confirmed[0].status).toBe("Closed");
    expect(confirmed[0].strategicResolutionReviews).toEqual([record]);
    expect(() => recordIcarusConfirmedRegression(current.input, { ...confirmation, id: "duplicate-observation" })).toThrow();
    expect(() => recordIcarusConfirmedRegression(input, { ...confirmation, evidenceKeys: ["unrelated"] })).toThrow();
    expect(() => recordIcarusConfirmedRegression(input, { ...confirmation, confirmedAt: reviewedAt })).toThrow();
  });

  it("re-resolution appends a new episode and preserves the original resolution and confirmed regression", () => {
    const { records, record } = verified();
    const deterioration = failed(records);
    const confirmed = recordIcarusConfirmedRegression(deterioration.input, regression(deterioration.input));
    const restored = confirmed.map((entry) => ({ ...entry, controls: entry.controls.map((control) => ({
      ...control, assuranceTests: [...(control.assuranceTests ?? []), {
        id: "re-test", testedAt: recoveredAt, testedByPersonId: "reviewer", result: "Passed" as const, evidenceIds: ["evidence"],
      }],
    })) }));
    const recoveryTargetId = getIcarusTreatmentTargetId("Failure-chain restoration", "recovery");
    restored[0].treatmentTargets = [{
      id: recoveryTargetId, sourceKind: "Failure-chain restoration", sourceId: "recovery", assessmentId: "risk",
      failureModeId: "mode", controlId: "control", treatmentKind: "Restore control", reason: "Confirmed regression recovery",
      basis: [], affectedAssessmentIds: ["risk"], objectiveIds: [], pillarIds: [],
      provenance: { kind: "Failure-chain recommendation", finding: "Operating dependency restored" },
      executionLinks: [{ recordType: "Action", recordId: "recovery-action", linkedAt: later }], promotedAt: later,
    }];
    const recoveryInput: Partial<IcarusStrategicIntelligenceInput> = {
      nowMs: Date.parse(recoveredAt), actions: [{ id: "recovery-action", status: "Completed" }],
      treatmentActions: [{ recordType: "Action", recordId: "recovery-action", title: "Restore protection", status: "Completed",
        completedAt: recoveredAt, completionEvidence: "Recovery work complete" }],
    };
    const beforeVerification = derive(restored, recoveryInput);
    expect(beforeVerification.view.eligibility.state).toBe("Insufficient evidence");
    const recoveryOption = beforeVerification.intelligence.treatment.verification.get(recoveryTargetId)!.options
      .find((option) => option.outcome === "Effective")!;
    expect(recoveryOption).toBeDefined();
    restored[0].treatmentOutcomes = [{
      id: "recovery-outcome", occurrenceId: "recovery-verification", assessmentId: "risk", treatmentTargetId: recoveryTargetId,
      verifiedAt: recoveredAt, verifiedByPersonId: "reviewer", executionLinks: restored[0].treatmentTargets[0].executionLinks,
      outcome: "Effective", evidence: [...recoveryOption.evidence], afterState: recoveryOption.afterState,
      verificationNote: "Treatment-only verification; not intervention attribution.",
      completionConditions: beforeVerification.intelligence.treatment.verification.get(recoveryTargetId)!.completion!.conditions.slice(),
    }];
    const { input } = derive(restored, recoveryInput);
    const eligibility = deriveIcarusResolutionEligibility(input, "risk", scope);
    expect(eligibility.state).toBe("Eligible for human review");
    const second: IcarusStrategicResolutionReview = {
      ...record, id: "re-resolution", reviewedAt: recoveredAt, controlConditions: [...eligibility.controlConditions],
      treatmentOutcomeIds: [...eligibility.treatmentOutcomeIds],
      supersedesReviewId: record.id, resolvesRegressionId: "regression", rationale: "Human explicitly re-verifies this scope after recovery.",
    };
    const rereviewed = recordIcarusResolutionReview(input, second);
    const current = derive(rereviewed, recoveryInput);
    expect(current.view.reviews.map((review) => [review.record.id, review.validity]))
      .toEqual([["resolution", "Superseded"], ["re-resolution", "Current"]]);
    expect(current.view.regressions[0]).toMatchObject({ record: confirmed[0].confirmedRegressions![0], reResolutionReviewId: second.id });
    expect(rereviewed[0].strategicResolutionReviews).toEqual([record, second]);
    expect(rereviewed[0].confirmedRegressions).toEqual(confirmed[0].confirmedRegressions);
    expect(rereviewed[0].controls[0].assuranceTests).toHaveLength(2);
    const oldEpisodeInput = { ...current.input, nowMs: Date.parse(recoveredAt) + 1 };
    expect(() => recordIcarusResolutionReview(oldEpisodeInput, {
      ...second, id: "branch", reviewedAt: new Date(oldEpisodeInput.nowMs).toISOString(),
    })).toThrow();
    expect(() => recordIcarusResolutionReview(input, { ...second, id: "unlinked", supersedesReviewId: undefined })).toThrow();
  });

  it("a single mode review cannot claim whole-risk resolution or inherit unrelated exposure", () => {
    const base = assessment();
    base.failureModes.push({ ...base.failureModes[0], id: "other-mode", evidence: [{ ...base.failureModes[0].evidence[0], id: "other-evidence" }] });
    const { input } = derive([base]);
    const partialScope: IcarusResolutionScope = { kind: "Failure modes", failureModeIds: ["mode"] };
    const eligible = deriveIcarusResolutionEligibility(input, "risk", partialScope);
    expect(eligible.state).toBe("Eligible for human review");
    expect(deriveIcarusResolutionEligibility(input, "risk", { kind: "Whole assessment", failureModeIds: ["mode"] }).state).toBe("Blocked");
    const partial: IcarusStrategicResolutionReview = {
      id: "partial", assessmentId: "risk", reviewedAt, reviewedByPersonId: "reviewer", outcome: "Verified resolved",
      scope: partialScope, controlConditions: [...eligible.controlConditions], treatmentOutcomeIds: [],
      causeIds: [], rationale: "Only this explicit failure mode is reviewed.",
    };
    const recorded = recordIcarusResolutionReview(input, partial);
    const { view } = derive(recorded);
    expect(view.reviews[0].validity).toBe("Current");
    expect(view.reviews[0].materialFailureModeIds).toEqual([]);
    expect(view.eligibility.state).toBe("Blocked");
  });

  it("hypothetical stress cannot record resolution, detect real regression, or persist confirmation", () => {
    const { records, record } = verified();
    const hypothetical = failed(records);
    const input = { ...hypothetical.input, hypothetical: true };
    const index = buildIcarusStrategicLifecycleIndex(input);
    expect(index.hypothetical).toBe(true);
    expect(index.byAssessmentId.get("risk")?.reviews[0].validity).toBe("Assurance weakened");
    expect(index.byAssessmentId.get("risk")?.reviews[0].materialFailureModeIds).toEqual([]);
    expect(index.byAssessmentId.get("risk")?.attentionReasons).toEqual([]);
    expect(() => recordIcarusResolutionReview(input, { ...record, id: "simulated" })).toThrow();
    expect(() => recordIcarusConfirmedRegression(input, regression(hypothetical.input))).toThrow();
    expect(records[0].confirmedRegressions).toBeUndefined();
  });

  it("keeps pre-routing protection tests from resolving a completed treatment and surfaces its evidence gap", () => {
    const base = assessment();
    const targetId = getIcarusTreatmentTargetId("Failure-chain restoration", "late-routing");
    base.treatmentTargets = [{
      id: targetId, sourceKind: "Failure-chain restoration", sourceId: "late-routing", assessmentId: base.id,
      failureModeId: "mode", controlId: "control", treatmentKind: "Restore protection", reason: "Corrective action",
      basis: [], affectedAssessmentIds: [base.id], objectiveIds: [], pillarIds: [],
      provenance: { kind: "Failure-chain recommendation", finding: "Restore barrier" },
      executionLinks: [{ recordType: "Action", recordId: "recovery", linkedAt: reviewedAt }], promotedAt: reviewedAt,
    }];
    const result = derive([base], {
      actions: [{ id: "recovery", status: "Completed" }],
      treatmentActions: [{ recordType: "Action", recordId: "recovery", title: "Recovery", status: "Completed",
        completedAt: reviewedAt, completionEvidence: "Recovery work complete" }],
    });
    expect(result.intelligence.assurance.byAssessmentId.get(base.id)?.controls[0].status).toBe("Assured");
    expect(result.intelligence.treatment.verification.get(targetId)?.options).toEqual([]);
    expect(result.view.eligibility.state).toBe("Insufficient evidence");
    expect(result.view.eligibility.reasons).toContain(`Treatment is not currently verified effective: ${targetId}`);
    expect(result.intelligence.treatment.summaries.get(base.id)?.attentionReasons.join("; "))
      .toContain("Source control test predates treatment routing");
    expect(base.treatmentOutcomes).toBeUndefined();
  });

  it("legacy parsing never invents lifecycle and malformed optional entries do not destroy assessment data", () => {
    const legacy = assessment({ status: "Closed" });
    const parsed = parseIcarusAssessments(JSON.stringify([legacy]));
    expect(parsed).toEqual([legacy]);
    expect(parsed[0].strategicResolutionReviews).toBeUndefined();
    expect(parsed[0].confirmedRegressions).toBeUndefined();
    const { record } = verified();
    const damaged = parseIcarusAssessments(JSON.stringify([{
      ...legacy, strategicResolutionReviews: [record, { ...record, id: "bad", scope: { kind: "Whole assessment", failureModeIds: [] } }],
      confirmedRegressions: [{ id: "broken" }],
    }]));
    expect(damaged[0].strategicResolutionReviews).toEqual([record]);
    expect(damaged[0].confirmedRegressions).toEqual([]);
    expect(damaged[0].failureModes).toEqual(legacy.failureModes);
    expect(damaged[0].controls).toEqual(legacy.controls);
    expect(parseIcarusAssessments(JSON.stringify([{
      ...legacy, strategicResolutionReviews: { invalid: true }, confirmedRegressions: "invalid",
    }]))).toEqual([legacy]);
    const missingObservation = {
      ...legacy,
      failureModes: legacy.failureModes.map((mode) => ({
        ...mode, evidence: mode.evidence.map((evidence) => ({ ...evidence, observedAt: undefined })),
      })),
      strategicResolutionReviews: [{ id: "broken" }],
    };
    expect(() => parseIcarusAssessments(JSON.stringify([missingObservation])))
      .toThrow("Icarus data must be an array of valid assessment records.");
  });

  it("retains duplicate lifecycle identities for explicit invalidity instead of normalising ambiguity away", () => {
    const { records, record } = verified();
    const duplicated = parseIcarusAssessments(JSON.stringify([{ ...records[0], strategicResolutionReviews: [record, { ...record }] }]));
    const { view } = derive(duplicated);
    expect(duplicated[0].strategicResolutionReviews).toEqual([record, record]);
    expect(view.reviews).toHaveLength(2);
    expect(view.reviews.every((review) => review.validity === "Invalid")).toBe(true);
    expect(view.recordedResolution).toBe(false);
  });

  it("retains structurally broken historical references without treating them as current protection", () => {
    const { records } = verified();
    const broken = records.map((entry) => ({ ...entry, controls: [] }));
    const { view } = derive(broken);
    expect(view.reviews[0].validity).toBe("Invalid");
    expect(view.reviews[0].reasons).toContain("Broken historical control-test reference: control/control-test");
    expect(view.regressions).toEqual([]);
  });

  it("records Not verified as a review observation, not resolution or regression", () => {
    const { input } = derive([assessment({ controls: [] })]);
    const { record } = verified();
    const records = recordIcarusResolutionReview(input, {
      ...record, outcome: "Not verified", controlConditions: [], treatmentOutcomeIds: [],
    });
    const { view } = derive(records);
    expect(view.recordedResolution).toBe(false);
    expect(view.reviews[0].validity).toBe("Not verified");
    expect(view.regressions).toEqual([]);
  });

  it("current contradictory evidence blocks review and future supporting evidence cannot establish positive eligibility", () => {
    const contradicted = assessment();
    contradicted.failureModes[0].evidence.push({ ...contradicted.failureModes[0].evidence[0], id: "contradiction", review: "Contradicts" });
    expect(derive([contradicted]).view.eligibility.state).toBe("Blocked");
    const future = assessment();
    future.failureModes[0].evidence[0] = { ...future.failureModes[0].evidence[0], reviewedAt: recoveredAt };
    expect(derive([future]).view.eligibility.state).toBe("Insufficient evidence");
  });

  it("lifecycle context does not increase the count or ranking of genuine current exposure", () => {
    const base = assessment();
    base.failureModes.push({ ...base.failureModes[0], id: "other-mode", evidence: [{ ...base.failureModes[0].evidence[0], id: "other-evidence" }] });
    base.controls.push({
      ...control("other-control", false), failureModeId: "other-mode", evidenceIds: ["other-evidence"],
      assuranceTests: [{
        id: "other-test", testedAt: createdAt, testedByPersonId: "reviewer", result: "Passed", evidenceIds: ["other-evidence"],
      }],
    });
    const whole: IcarusResolutionScope = { kind: "Whole assessment", failureModeIds: ["mode", "other-mode"] };
    const { input } = derive([base]);
    const eligibility = deriveIcarusResolutionEligibility(input, "risk", whole);
    expect(eligibility.state).toBe("Eligible for human review");
    const records = recordIcarusResolutionReview(input, {
      ...verified().record, scope: whole, controlConditions: [...eligibility.controlConditions],
    });
    const deteriorated = records.map((entry) => ({ ...entry, controls: entry.controls.map((control) => control.id === "other-control"
      ? { ...control, assuranceTests: [...control.assuranceTests!, {
        id: "failed-test", testedAt: later, testedByPersonId: "reviewer", result: "Failed" as const, evidenceIds: ["other-evidence"],
      }] } : control) }));
    const current = derive(deteriorated, { nowMs: Date.parse(later) });
    const baseline = derive(deteriorated.map((entry) => ({ ...entry, strategicResolutionReviews: undefined })), { nowMs: Date.parse(later) });
    expect(current.view.reviews[0].materialFailureModeIds).toEqual(["other-mode"]);
    expect(current.intelligence.strategicSignals[0].riskScore).toBe(baseline.intelligence.strategicSignals[0].riskScore);
    expect(current.intelligence.exposureSnapshot[0].failureModeIds).toEqual(["other-mode"]);
    const item = command(current.intelligence.strategicSignals).items.find((entry) => entry.objectType === "Icarus")!;
    expect(item.reasons).not.toContain("2 MATERIAL FAILURE MODES");
    expect(item.statusText).toContain("1 material failure mode");
  });
});

describe("treatment, intervention and learning lifecycle integration", () => {
  it.each(["Action", "Project"] as const)("completed %s and current Effective treatment need a separate explicit whole-risk review", (recordType) => {
    const base = assessment();
    const targetId = getIcarusTreatmentTargetId("Failure-chain restoration", "restore");
    base.treatmentTargets = [{
      id: targetId, sourceKind: "Failure-chain restoration", sourceId: "restore", assessmentId: "risk",
      failureModeId: "mode", controlId: "control", treatmentKind: "Restore protection", reason: "Prior failing protection",
      basis: [], affectedAssessmentIds: ["risk"], objectiveIds: [], pillarIds: [],
      provenance: { kind: "Failure-chain recommendation", finding: "Prior barrier failure" },
      executionLinks: [{ recordType, recordId: "execution", linkedAt: createdAt }], promotedAt: createdAt,
    }];
    const overrides: Partial<IcarusStrategicIntelligenceInput> = {
      actions: recordType === "Action" ? [{ id: "execution", status: "Completed" }] : [],
      treatmentActions: recordType === "Action" ? [{ recordType, recordId: "execution", title: "Restore", status: "Completed",
        completedAt: createdAt, completionEvidence: "Recorded work completion" }] : [],
      treatmentProjects: recordType === "Project" ? [{ recordType, recordId: "execution", title: "Restore", status: "Completed",
        completedAt: createdAt, completionEvidence: "Recorded work completion" }] : [],
    };
    const initial = derive([{ ...base, controls: base.controls.map((control) => ({
      ...control, assuranceTests: control.assuranceTests!.map((test) => ({ ...test, result: "Failed" as const })),
    })) }], overrides);
    expect(initial.intelligence.strategicSignals[0].materialityTier).toBe("Material");
    expect(initial.view.recordedResolution).toBe(false);
    expect(initial.view.eligibility.state).toBe("Blocked");
    const first = derive([base], overrides);
    expect(first.view.recordedResolution).toBe(false);
    expect(first.view.eligibility.state).toBe("Insufficient evidence");
    const option = first.intelligence.treatment.verification.get(targetId)!.options.find((option) => option.outcome === "Effective")!;
    expect(option).toBeDefined();
    const outcome: IcarusTreatmentOutcomeRecord = {
      id: getIcarusTreatmentOutcomeId(targetId, "reviewer", option.evidence), assessmentId: "risk", treatmentTargetId: targetId,
      verifiedAt: createdAt, verifiedByPersonId: "reviewer", executionLinks: base.treatmentTargets[0].executionLinks,
      outcome: "Effective", evidence: [...option.evidence], afterState: option.afterState, verificationNote: "Explicit current treatment observation.",
      completionConditions: first.intelligence.treatment.verification.get(targetId)!.completion!.conditions.slice(),
    };
    base.treatmentOutcomes = [outcome];
    const current = derive([base], overrides);
    expect(current.intelligence.treatment.verification.get(targetId)?.state).toBe("Verified effective");
    expect(current.view.recordedResolution).toBe(false);
    const { records } = verified([base], overrides);
    expect(records[0].strategicResolutionReviews?.[0].treatmentOutcomeIds).toEqual([outcome.id]);
    expect(base.strategicResolutionReviews).toBeUndefined();
    expect(base.treatmentOutcomes).toEqual([outcome]);
    const closed = derive(records.map((record) => ({ ...record, status: "Closed" })), { ...overrides, nowMs: Date.parse(later) });
    expect(closed.view.reviews[0].validity).toBe("Current");
    expect(closed.intelligence.strategicSignals).toEqual([]);
  });

  it("feeds exact assessment lifecycle history into intervention context and learning without inferred cause or duplicate Command records", () => {
    const cause = {
      ...emptyIcarusInterventionScope("risk"), id: "cause", title: "Operating interruption", description: "Human recorded mechanism",
      createdAt, updatedAt: createdAt, createdByPersonId: "reviewer", updatedByPersonId: "reviewer",
    };
    const { records } = verified([assessment({ causes: [cause] })]);
    const deterioration = failed(records);
    const confirmed = recordIcarusConfirmedRegression(deterioration.input, regression(deterioration.input));
    const current = failed(confirmed);
    const decision = {
      ...emptyIcarusInterventionScope("risk"), id: "decision", title: "New intervention",
      createdAt: later, updatedAt: later, createdByPersonId: "reviewer", updatedByPersonId: "reviewer",
      causeIds: [], status: "Draft" as const, rationale: "", options: [], selectionHistory: [], relationships: [], effects: [], lessonLinks: [],
    };
    const otherDecision = { ...decision, ...emptyIcarusInterventionScope("other"), id: "other-decision", causeIds: ["other-cause"] };
    const other = assessment({
      id: "other", outcome: "Service continuity", failureModes: [], controls: [], linkedRecords: [],
      causes: [{ ...cause, ...emptyIcarusInterventionScope("other"), id: "other-cause" }],
      interventionDecisions: [otherDecision],
    });
    const before = JSON.stringify(confirmed);
    const interventions = buildIcarusInterventionIndex({
      assessments: [{ ...confirmed[0], interventionDecisions: [decision] }, other],
      treatment: current.intelligence.treatment, signals: current.intelligence.strategicSignals,
      sources: [], decisions: [], lessons: [], people: current.input.people, nowMs: current.input.nowMs,
      lifecycle: current.intelligence.lifecycle,
    });
    const context = interventions.decisions.find((view) => view.record.id === "decision")!.lifecycleHistory;
    expect(context).toHaveLength(1);
    expect(context[0].assessmentId).toBe("risk");
    expect(context[0].regressions[0].record.causeIds).toEqual([]);
    expect(context[0].regressions[0].record.explanation).toBe("Unknown");
    expect(interventions.decisions.find((view) => view.record.id === "other-decision")!.lifecycleHistory).toEqual([]);
    const learning = buildOrganisationalLearning({
      actions: [], projects: [], decisions: [], lessons: [], problems: [], systems: [], sops: [],
      icarusLifecycle: interventions.lifecycle,
    });
    expect(learning).toHaveLength(1);
    expect(learning[0]).toMatchObject({
      sourceType: "Icarus Lifecycle", sourceId: "regression", outcomeState: "Unknown",
      recurrenceState: "Recorded recurrence", linkedLessonIds: [],
    });
    expect(learning[0].evidence).toContainEqual(expect.objectContaining({ field: "humanExplanation", value: "Unknown" }));
    expect(learning[0].evidence.some((entry) => entry.field === "causeId")).toBe(false);
    expect(buildLearningAttention(learning.map((signal) => ({ signal })))).toEqual([]);
    const authoritative: OrganisationalLearningInput = {
      actions: [{ id: "action", title: "Restore", actionTitle: "", status: "Completed", completionEvidence: "Completion recorded" }],
      projects: [{ id: "project", projectName: "Restore service", status: "Completed" }],
      decisions: [{
        id: "authority", title: "Decision", decisionTitle: "", decisionStatus: "Completed",
        executionState: "Completed execution", actualOutcome: "Reviewed result", outcomeRating: "Worked", lessons: "",
      }],
      lessons: [{
        id: "lesson", title: "Lesson", lessonTitle: "", description: "Human-authoritative standard",
        status: "Reviewed", recommendedChange: "Update standard", relatedProblem: "", relatedProject: "",
        relatedDecision: "", relatedSystem: "",
      }],
      problems: [], systems: [], sops: [],
    };
    const baseline = buildOrganisationalLearning(authoritative);
    const withLifecycle = buildOrganisationalLearning({ ...authoritative, icarusLifecycle: interventions.lifecycle });
    expect(withLifecycle.filter((signal) => signal.sourceType !== "Icarus Lifecycle")).toEqual(baseline);
    expect(buildOrganisationalLearning({
      ...authoritative, icarusLifecycle: { ...current.intelligence.lifecycle, hypothetical: true },
    })).toEqual(baseline);
    expect(JSON.stringify(confirmed)).toBe(before);
  });
});
