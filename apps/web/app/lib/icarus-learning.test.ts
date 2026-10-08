import { describe, expect, it } from "vitest";
import { normalizeLessonRecord, applyLessonEditorChanges, type CaptureConversionRecord, type LessonRecord } from "./capture-conversions";
import { buildIcarusStrategicIntelligence } from "./icarus-intelligence-pipeline";
import {
  deriveIcarusRegressionEvidence, deriveIcarusResolutionEligibility, recordIcarusResolutionReview,
  recordIcarusConfirmedRegression,
} from "./icarus-strategic-lifecycle";
import {
  buildIcarusLearningIndex, normaliseIcarusLessonLearning, recordIcarusLearningReview,
  recordIcarusInstitutionalisationReview,
  getIcarusLearningMechanismRevision,
  type IcarusLearningInput, type IcarusLearningReview, type IcarusInstitutionalisationReview,
  type IcarusLearningEvidenceReference, type IcarusLearningMechanism,
} from "./icarus-learning";
import { getIcarusTreatmentOutcomeId, getIcarusTreatmentTargetId, type IcarusAssessmentRecord, type IcarusResolutionScope } from "./icarus";
import { buildIcarusTreatmentIndex } from "./icarus-treatment";
import { buildOrganisationalLearning } from "./organisational-learning";
import { buildLearningAttention } from "./learning-attention";
import { buildCommandAttention, type CommandAttentionInput } from "./command-attention";
import { buildFounderFocus } from "./founder-focus";
import { buildIcarusInterventionIndex, emptyIcarusInterventionScope } from "./icarus-intervention-decision";

const createdAt = "2026-10-01T10:00:00.000Z";
const testedAt = "2026-10-02T10:00:00.000Z";
const learnedAt = "2026-10-03T10:00:00.000Z";
const embeddedAt = "2026-10-04T10:00:00.000Z";
const recurrenceAt = "2026-10-05T10:00:00.000Z";
const scope: IcarusResolutionScope = { kind: "Whole assessment", failureModeIds: ["mode"] };
const evidence: IcarusLearningEvidenceReference = { kind: "Evidence", assessmentId: "risk", failureModeId: "mode", evidenceId: "evidence" };
const mechanism: IcarusLearningMechanism = { recordType: "System", recordId: "system" };
function risk(): IcarusAssessmentRecord {
  return {
    id: "risk", outcome: "Continuity", status: "Open", createdAt, updatedAt: createdAt,
    linkedRecords: [{ recordType: "Pillar", recordId: "Excavation" }], accountableOwnerPersonId: "reviewer",
    failureModes: [{
      id: "mode", mechanism: "Operating dependency fails", vulnerability: "Loss of protection",
      evidence: [{
        id: "evidence", statement: "Direct observation", origin: "Direct observation", recordedAt: createdAt,
        observedAt: createdAt, recordedBy: "reviewer", review: "Supports", reviewedAt: createdAt, reviewedBy: "reviewer",
      }],
    }],
    controls: [{
      id: "control", failureModeId: "mode", intervention: "Operating protection", lifecycle: "Active", effectiveness: "Unknown",
      evidenceIds: ["evidence"], linkedRecords: [{ recordType: "Person", recordId: "operator" }], ownerPersonId: "reviewer",
      nextReviewAt: "2026-12-01", assuranceTests: [{
        id: "test", testedAt, testedByPersonId: "reviewer", result: "Passed", evidenceIds: ["evidence"],
      }],
    }],
  };
}
function lesson(id = "lesson"): LessonRecord {
  return normalizeLessonRecord({
    id, targetType: "Convert to Lesson", sourceCaptureId: "capture", createdAt, title: "Operating dependency learning",
    originalRawNote: "Human-authored Lesson", relatedArea: "Excavation", importance: "High", status: "Reviewed",
    recommendedChange: "Embed operating checks",
  });
}
function input(records = [risk()], lessons = [lesson()], at = learnedAt, operator = "Active"): IcarusLearningInput {
  const people = [{ id: "reviewer", status: "Active" }, { id: "operator", status: operator }];
  const intelligence = buildIcarusStrategicIntelligence({
    assessments: records, people, actions: [], strategicObjectives: [], primaryFounderId: "reviewer", founderDependencyActive: false,
    sourceRecords: [{ recordType: "Pillar", recordId: "Excavation", title: "Excavation" },
      { recordType: "Person", recordId: "operator", title: "Operator" }],
    nowMs: Date.parse(at),
  });
  return {
    assessments: records, lessons, assurance: intelligence.assurance, treatment: intelligence.treatment,
    dependencyHealth: intelligence.dependencyHealth, lifecycle: intelligence.lifecycle, people, nowMs: Date.parse(at),
    mechanisms: [{ ...mechanism, title: "Continuity system", status: "Active", revision: "v1" }],
  };
}
function learning(overrides: Partial<IcarusLearningReview> = {}): IcarusLearningReview {
  return {
    id: "learning", reviewedAt: learnedAt, reviewedByPersonId: "reviewer", conclusion: "Protection requires explicit operating checks",
    outcome: "Validated", evidence: [evidence], institutionalisation: "Required", mechanisms: [mechanism],
    rationale: "Human reviewed the stated learning against explicit provenance.", ...overrides,
  };
}
function addLearning(source = input(), record = learning()) {
  const history = recordIcarusLearningReview(source, "lesson", record);
  return { ...source, lessons: source.lessons.map((lesson) => lesson.id === "lesson" ? { ...lesson, icarusLearning: history } : lesson) };
}
function proof(source: IcarusLearningInput): IcarusInstitutionalisationReview {
  const condition = source.mechanisms[0];
  return {
    id: "embedding", learningReviewId: "learning", reviewedAt: embeddedAt, reviewedByPersonId: "reviewer",
    outcome: "Effective", evidence: [{ kind: "Control test", assessmentId: "risk", controlId: "control", testId: "embedding-test" }],
    mechanismConditions: [{ reference: mechanism, status: condition.status, revision: condition.revision }],
    rationale: "Human confirms the declared organisational mechanism is embedded and the subsequent protection test establishes effectiveness.",
  };
}
function embedding(source = addLearning()) {
  const records = source.assessments.map((entry) => ({
    ...entry, controls: entry.controls.map((control) => ({ ...control, assuranceTests: [...control.assuranceTests!, {
      id: "embedding-test", testedAt: embeddedAt, testedByPersonId: "reviewer", result: "Passed" as const, evidenceIds: ["evidence"],
    }] })),
  }));
  const current = { ...input(records, source.lessons.map((entry) => ({ ...lesson(entry.id), ...entry })), embeddedAt), mechanisms: source.mechanisms };
  const history = recordIcarusInstitutionalisationReview(current, "lesson", proof(current));
  return { ...current, lessons: current.lessons.map((lesson) => lesson.id === "lesson" ? { ...lesson, icarusLearning: history } : lesson) };
}
function signals(source: IcarusLearningInput) {
  return buildOrganisationalLearning({
    actions: [], projects: [], decisions: [], lessons: source.lessons.map((entry) => ({ ...lesson(entry.id), ...entry })),
    problems: [], systems: [], sops: [], icarusLifecycle: source.lifecycle, icarusLearning: buildIcarusLearningIndex(source),
  });
}
function command(source: IcarusLearningInput, includeRisk = false) {
  const intelligence = buildIcarusStrategicIntelligence({
    assessments: source.assessments, people: source.people, actions: [], strategicObjectives: [], sourceRecords: [],
    primaryFounderId: null, founderDependencyActive: false, nowMs: source.nowMs,
  });
  return buildCommandAttention({
    actions: [], projects: [], decisions: [], opportunities: [], lessons: [], problems: [], systems: [], sops: [], outreach: [], handoffs: [], procurementQueue: [],
    learning: signals(source).map((signal) => ({ signal })), icarus: includeRisk ? intelligence.strategicSignals : [],
    nowMs: source.nowMs,
  });
}
function resolution(source: IcarusLearningInput, id = "resolution", supersedesReviewId?: string, resolvesRegressionId?: string) {
  const eligibility = deriveIcarusResolutionEligibility({ ...source, signals: [] }, "risk", scope);
  return recordIcarusResolutionReview({ ...source, signals: [] }, {
    id, assessmentId: "risk", reviewedAt: new Date(source.nowMs).toISOString(), reviewedByPersonId: "reviewer",
    outcome: "Verified resolved", scope, controlConditions: [...eligibility.controlConditions], treatmentOutcomeIds: [],
    causeIds: [], rationale: "Human verifies effective scoped protection.",
    ...(supersedesReviewId ? { supersedesReviewId } : {}), ...(resolvesRegressionId ? { resolvesRegressionId } : {}),
  });
}
function confirmed(source: IcarusLearningInput, id = "regression", resolutionReviewId = "resolution") {
  const observation = deriveIcarusRegressionEvidence({
    ...source, signals: buildIcarusStrategicIntelligence({
      assessments: source.assessments, people: source.people, actions: [], sourceRecords: [], strategicObjectives: [],
      primaryFounderId: null, founderDependencyActive: false, nowMs: source.nowMs,
    }).strategicSignals,
  }, "risk", scope);
  const intelligence = buildIcarusStrategicIntelligence({
    assessments: source.assessments, people: source.people, actions: [], sourceRecords: [], strategicObjectives: [],
    primaryFounderId: null, founderDependencyActive: false, nowMs: source.nowMs,
  });
  return recordIcarusConfirmedRegression({ ...source, signals: intelligence.strategicSignals }, {
    id, assessmentId: "risk", resolutionReviewId, confirmedAt: new Date(source.nowMs).toISOString(),
    confirmedByPersonId: "reviewer", scope, evidenceKeys: [...observation.observationKeys],
    causeIds: [], explanation: "Unknown", rationale: "Human confirms material scope has returned.",
  });
}

describe("Icarus learning validity", () => {
  it("legacy Lessons have no explicit Icarus learning and remain readable without invented history", () => {
    const source = input();
    expect(source.lessons[0].icarusLearning).toBeUndefined();
    const view = buildIcarusLearningIndex(source).lessons[0];
    expect(view.validity).toBe("No explicit learning");
    expect(view.reviews).toEqual([]);
    expect(view.attentionReasons).toEqual([]);
    expect(normalizeLessonRecord(JSON.parse(JSON.stringify(lesson())))).toEqual(lesson());
  });

  it("treatment outcome alone is an observation, never a validated Lesson", () => {
    const record = risk();
    record.treatmentOutcomes = [{
      id: "outcome", assessmentId: "risk", treatmentTargetId: "target", outcome: "Effective", executionLinks: [],
      verifiedAt: testedAt, verifiedByPersonId: "reviewer", evidence: [],
      afterState: { kind: "Control assurance", state: "Assured" }, verificationNote: "Historical observation",
    }];
    const source = input([record]);
    expect(buildIcarusLearningIndex(source).observedAssessmentIds).toEqual(["risk"]);
    expect(buildIcarusLearningIndex(source).lessons[0].validity).toBe("No explicit learning");
    expect(record.strategicResolutionReviews).toBeUndefined();
  });

  it("confirmed lifecycle regression alone supplies observation, not validated learning or autonomous Lesson creation", () => {
    const records = resolution(input([risk()], [lesson()], testedAt));
    const failed = input(records, [lesson()], recurrenceAt, "Inactive");
    const source = input(confirmed(failed), [], recurrenceAt, "Inactive");
    const before = JSON.stringify(source.assessments);
    const index = buildIcarusLearningIndex(source);
    expect(index.lessons).toEqual([]);
    expect(index.observedAssessmentIds).toEqual(["risk"]);
    expect(signals(source)).toContainEqual(expect.objectContaining({ sourceType: "Icarus Lifecycle", icarusObservation: "Observed", outcomeState: "Unknown" }));
    expect(JSON.stringify(source.assessments)).toBe(before);
    expect(source.lessons).toEqual([]);
  });

  it.each(["Candidate", "Validated"] as const)("requires an explicit human Lesson review for %s learning", (outcome) => {
    const source = addLearning(input(), learning({ outcome }));
    const view = buildIcarusLearningIndex(source).lessons[0];
    expect(view.validity).toBe(outcome === "Candidate" ? "Candidate learning" : "Validated");
    expect(view.reviews[0].record.outcome).toBe(outcome);
    expect(source.lessons[0].status).toBe("Reviewed");
  });

  it("missing provenance or missing authoritative Lesson cannot be validated or silently linked", () => {
    expect(() => addLearning(input(), learning({ evidence: [] }))).toThrow();
    expect(() => recordIcarusLearningReview({ ...input(), lessons: [] }, "lesson", learning())).toThrow();
    const source = input();
    source.lessons = [{ ...lesson(), icarusLearning: { reviews: [learning({ evidence: [] })], institutionalisationReviews: [] } }];
    expect(buildIcarusLearningIndex(source).lessons[0].validity).toBe("Invalid / insufficient evidence");
  });

  it("stale evidence weakens current validity without becoming contradiction or rewriting a historical validation", () => {
    const source = addLearning();
    const record = source.assessments[0];
    const expired = { ...record, failureModes: record.failureModes.map((mode) => ({
      ...mode, evidence: mode.evidence.map((entry) => ({ ...entry, validUntil: "2026-10-03" })),
    })) };
    const later = input([expired], source.lessons.map((entry) => ({ ...lesson(), ...entry })), embeddedAt);
    const view = buildIcarusLearningIndex(later).lessons[0];
    expect(view.validity).toBe("Invalid / insufficient evidence");
    expect(view.reviews[0].record).toEqual(learning());
    expect(view.reviews[0].record.outcome).toBe("Validated");
    expect(view.reviews[0].issues.join()).toContain("not contradiction");
  });

  it("explicit contradiction affects current guidance without deleting validation history", () => {
    const source = addLearning();
    const at = { ...source, nowMs: Date.parse(embeddedAt) };
    const contradicted = addLearning(at, learning({
      id: "contradiction", reviewedAt: embeddedAt, outcome: "Contradicted", contradictsReviewId: "learning",
      conclusion: "Human rejects the prior conclusion using explicit evidence.",
    }));
    const view = buildIcarusLearningIndex(contradicted).lessons[0];
    expect(view.validity).toBe("Contradicted");
    expect(view.reviews[0].record).toEqual(learning());
    expect(view.reviews).toHaveLength(2);
    expect(view.attentionReasons.join()).toContain("Contradiction");
    expect(contradicted.lessons[0].status).toBe("Reviewed");
    const later = { ...contradicted, nowMs: Date.parse(recurrenceAt) };
    expect(() => addLearning(later, learning({ id: "unlinked", reviewedAt: recurrenceAt }))).toThrow();
    expect(() => addLearning(later, learning({
      id: "candidate", reviewedAt: recurrenceAt, outcome: "Candidate", supersedesReviewId: "contradiction",
    }))).toThrow();
    const readopted = addLearning(later, learning({
      id: "readopted", reviewedAt: recurrenceAt, supersedesReviewId: "contradiction",
    }));
    expect(buildIcarusLearningIndex(readopted).lessons[0].validity).toBe("Validated");
    expect(readopted.lessons[0].icarusLearning?.reviews).toHaveLength(3);
  });

  it("explicit supersession preserves historical validation and institutionalisation reviews", () => {
    const source = embedding();
    const current = addLearning({ ...source, nowMs: Date.parse(recurrenceAt) }, learning({
      id: "replacement", reviewedAt: recurrenceAt, supersedesReviewId: "learning", institutionalisation: "Not required", mechanisms: [],
    }));
    const view = buildIcarusLearningIndex(current).lessons[0];
    expect(view.validity).toBe("Validated");
    expect(view.reviews[0]).toMatchObject({ validity: "Superseded", institutionalisation: "Superseded", record: learning() });
    expect(view.reviews[0].institutionalisationHistory[0].record).toEqual(proof(source));
    expect(current.lessons[0].icarusLearning?.institutionalisationReviews).toHaveLength(1);
  });

  it("broken references stay inspectable and duplicate review IDs are not silently normalised", () => {
    const history = normaliseIcarusLessonLearning({
      reviews: [learning(), learning(), learning({ id: "broken", evidence: [{ ...evidence, evidenceId: "missing" }] })],
      institutionalisationReviews: [],
    })!;
    const source = { ...input(), lessons: [{ ...lesson(), icarusLearning: history }] };
    const view = buildIcarusLearningIndex(source).lessons[0];
    expect(view.reviews).toHaveLength(3);
    expect(view.reviews.every((entry) => entry.validity === "Invalid / insufficient evidence")).toBe(true);
    expect(view.reviews.find((entry) => entry.record.id === "broken")?.issues.join()).toContain("Missing");
  });

  it("malformed optional learning fields are dropped defensively without changing base Lesson authority", () => {
    const raw = JSON.parse(JSON.stringify(lesson()));
    raw.icarusLearning = { reviews: [learning(), { id: "malformed" }], institutionalisationReviews: [{ id: "bad" }] };
    const parsed = normalizeLessonRecord(raw);
    expect(parsed.icarusLearning).toEqual({ reviews: [learning()], institutionalisationReviews: [] });
    expect(parsed.status).toBe(lesson().status);
    expect(parsed.description).toBe(lesson().description);
    expect(parsed.recommendedChange).toBe(lesson().recommendedChange);
    raw.icarusLearning = "malformed";
    expect(normalizeLessonRecord(raw).icarusLearning).toBeUndefined();
  });

  it("rejects hypothetical reviews, future evidence and ambiguous reviewer identities", () => {
    const source = input();
    expect(() => addLearning({ ...source, lifecycle: { ...source.lifecycle, hypothetical: true } })).toThrow();
    expect(() => addLearning({ ...source, nowMs: Date.parse(testedAt) })).toThrow();
    expect(() => addLearning({ ...source, people: [...source.people, { id: "reviewer", status: "Inactive" }] })).toThrow();
    const unknown = { ...risk(), failureModes: risk().failureModes.map((mode) => ({
      ...mode, evidence: mode.evidence.map((entry) => ({ ...entry, review: "Unresolved" as const })),
    })) };
    expect(() => addLearning(input([unknown]))).toThrow();
  });
});

describe("institutionalisation is separate from Lesson status and execution authority", () => {
  it.each(["Reviewed", "Implemented"] as const)("%s Lesson alone does not prove embedding", (status) => {
    const source = input([risk()], [{ ...lesson(), status }]);
    expect(buildIcarusLearningIndex(source).lessons[0].institutionalisation).toBeUndefined();
    expect(buildIcarusLearningIndex(addLearning(source)).lessons[0].institutionalisation).toBe("Verification due");
  });

  it.each([
    ["Action", "Completed"], ["Project", "Completed"], ["Decision", "Completed"], ["Decision", "Active"], ["System", "Active"], ["SOP", "Active"],
  ] as const)("%s %s with explicit implementation linkage still needs separate effectiveness verification", (recordType, status) => {
    const source = { ...input(), mechanisms: [{ recordType, recordId: "mechanism", title: "Embed", status, revision: "v1" }] };
    const linked = addLearning(source, learning({ mechanisms: [{ recordType, recordId: "mechanism" }] }));
    const view = buildIcarusLearningIndex(linked).lessons[0];
    expect(view.validity).toBe("Validated");
    expect(view.institutionalisation).toBe("Verification due");
    expect(view.reviews[0].record.mechanisms).toEqual([{ recordType, recordId: "mechanism" }]);
  });

  it.each([
    ["Open", "Planned"], ["In Progress", "In progress"], ["Blocked", "Ineffective / incomplete"],
  ] as const)("respects Action authority %s as %s, without assuming health", (status, expected) => {
    const source = { ...input(), mechanisms: [{ recordType: "Action" as const, recordId: "action", title: "Embed", status, revision: "v1" }] };
    const linked = addLearning(source, learning({ mechanisms: [{ recordType: "Action", recordId: "action" }] }));
    expect(buildIcarusLearningIndex(linked).lessons[0].institutionalisation).toBe(expected);
  });

  it("no mechanism is Required, not required is explicit, and unrelated existing mechanisms are not auto-linked", () => {
    expect(buildIcarusLearningIndex(addLearning(input(), learning({ mechanisms: [] }))).lessons[0].institutionalisation).toBe("Required");
    const exempt = addLearning(input(), learning({ mechanisms: [], institutionalisation: "Not required" }));
    expect(buildIcarusLearningIndex(exempt).lessons[0].institutionalisation).toBe("Not required");
    expect(buildIcarusLearningIndex(exempt).attention).toEqual([]);
  });

  it("explicit human effectiveness verification plus subsequent current protection can establish embedding", () => {
    const source = embedding();
    const index = buildIcarusLearningIndex(source);
    expect(index.lessons[0].validity).toBe("Validated");
    expect(index.lessons[0].institutionalisation).toBe("Institutionalised");
    expect(index.lessons[0].reviews[0].institutionalisationHistory[0].current).toBe(true);
    expect(index.attention).toEqual([]);
    expect(source.lessons[0].status).toBe("Reviewed");
  });

  it("execution status, old tests, or an observation note alone cannot prove institutional effectiveness", () => {
    const source = addLearning();
    expect(() => recordIcarusInstitutionalisationReview({ ...source, nowMs: Date.parse(embeddedAt) }, "lesson", {
      ...proof(source), evidence: [evidence],
    })).toThrow();
    expect(() => recordIcarusInstitutionalisationReview({ ...source, nowMs: Date.parse(embeddedAt) }, "lesson", {
      ...proof(source), evidence: [{ kind: "Control test", assessmentId: "risk", controlId: "control", testId: "test" }],
    })).toThrow();
    expect(() => recordIcarusInstitutionalisationReview({ ...source, nowMs: Date.parse(embeddedAt) }, "lesson", {
      ...proof(source), evidence: [],
    })).toThrow();
  });

  it("positive evidence for another failure mode cannot establish embedding of the declared learning scope", () => {
    const source = embedding();
    const record = source.assessments[0];
    const otherMode = {
      ...record.failureModes[0], id: "other-mode", evidence: record.failureModes[0].evidence.map((entry) => ({ ...entry, id: "other-evidence" })),
    };
    const otherControl = {
      ...record.controls[0], id: "other-control", failureModeId: "other-mode", evidenceIds: ["other-evidence"],
      assuranceTests: [{
        id: "other-test", testedAt: embeddedAt, testedByPersonId: "reviewer", result: "Passed" as const, evidenceIds: ["other-evidence"],
      }],
    };
    const current = input([{ ...record, failureModes: [...record.failureModes, otherMode], controls: [...record.controls, otherControl] }],
      source.lessons.map((entry) => ({ ...lesson(), ...entry })), embeddedAt);
    expect(() => recordIcarusInstitutionalisationReview(current, "lesson", {
      ...proof(current), id: "unrelated", evidence: [{ kind: "Control test", assessmentId: "risk", controlId: "other-control", testId: "other-test" }],
    })).toThrow("Effectiveness evidence must match");
  });

  it("revision changes and review due weaken current embedding while preserving historical proof", () => {
    const source = embedding();
    const changed = { ...source, mechanisms: source.mechanisms.map((entry) => ({ ...entry, revision: "v2" })) };
    expect(buildIcarusLearningIndex(changed).lessons[0].institutionalisation).toBe("Verification due");
    expect(changed.lessons[0].icarusLearning?.institutionalisationReviews).toEqual(source.lessons[0].icarusLearning?.institutionalisationReviews);
    const dated = {
      ...source, nowMs: Date.parse(recurrenceAt), lessons: source.lessons.map((entry) => ({
        ...entry, icarusLearning: { ...entry.icarusLearning!, institutionalisationReviews: [{ ...proof(source), nextReviewBy: "2026-10-04" }] },
      })),
    };
    expect(buildIcarusLearningIndex(dated).lessons[0].institutionalisation).toBe("Verification due");
    expect(getIcarusLearningMechanismRevision(["v1", "Operating standard"]))
      .toBe(getIcarusLearningMechanismRevision(["v1", "Operating standard"]));
    expect(getIcarusLearningMechanismRevision(["v1", "Changed standard"]))
      .not.toBe(getIcarusLearningMechanismRevision(["v1", "Operating standard"]));
    expect(getIcarusLearningMechanismRevision(["v1", "Operating standard"])).not.toContain("Operating standard");
  });

  it.each(["Action", "Project"] as const)("repeated %s completion never establishes learning effectiveness", (recordType) => {
    const source = { ...input(), mechanisms: [{ recordType, recordId: "execution", title: "Embed", status: "Completed", revision: "first" }] };
    const linked = addLearning(source, learning({ mechanisms: [{ recordType, recordId: "execution" }] }));
    const completedAgain = { ...linked, mechanisms: linked.mechanisms.map((entry) => ({ ...entry, revision: "second" })) };
    expect(buildIcarusLearningIndex(linked).lessons[0].institutionalisation).toBe("Verification due");
    expect(buildIcarusLearningIndex(completedAgain).lessons[0].institutionalisation).toBe("Verification due");
  });
});

describe("explicit recurrence and downstream projection", () => {
  it("confirmed recurrence requires explicit shared Lesson provenance, never assessment title matching", () => {
    const source = embedding();
    const resolved = resolution({ ...source, nowMs: Date.parse(embeddedAt) });
    const failed = input(resolved, source.lessons.map((entry) => ({ ...lesson(entry.id), ...entry })), recurrenceAt, "Inactive");
    const records = confirmed(failed);
    const recurrent = input(records, source.lessons.map((entry) => ({ ...lesson(entry.id), ...entry })), recurrenceAt, "Inactive");
    expect(buildIcarusLearningIndex(recurrent).lessons[0].recurrence).toEqual([]);
    const explicit = addLearning(recurrent, learning({
      id: "observed-recurrence", reviewedAt: recurrenceAt, outcome: "Candidate",
      evidence: [{ kind: "Confirmed regression", assessmentId: "risk", regressionId: "regression" }],
      mechanisms: [],
    }));
    const index = buildIcarusLearningIndex(explicit);
    expect(index.lessons[0].recurrence).toEqual([{ assessmentId: "risk", regressionId: "regression", confirmedAt: recurrenceAt, afterInstitutionalisation: true, requiresReview: true }]);
    expect(index.lessons[0].attentionReasons.join()).toContain("Confirmed recurrence after");
    const unrelated = { ...explicit, lessons: [...explicit.lessons, lesson("unrelated")] };
    expect(buildIcarusLearningIndex(unrelated).byLessonId.get("unrelated")?.validity).toBe("No explicit learning");
    expect(buildIcarusLearningIndex(unrelated).byLessonId.get("unrelated")?.recurrence).toEqual([]);
    expect(records[0].confirmedRegressions?.[0].causeIds).toEqual([]);
    const superseded = addLearning({ ...explicit, nowMs: Date.parse("2026-10-06T10:00:00.000Z") }, learning({
      id: "replacement", reviewedAt: "2026-10-06T10:00:00.000Z", supersedesReviewId: "learning",
      institutionalisation: "Not required", mechanisms: [],
    }));
    expect(buildIcarusLearningIndex(superseded).lessons[0].recurrence).toEqual(index.lessons[0].recurrence);
  });

  it("later explicit embedding verification clears the current reminder without erasing the historical recurrence", () => {
    const source = embedding();
    const resolved = resolution({ ...source, nowMs: Date.parse(embeddedAt) });
    const failed = input(resolved, source.lessons.map((entry) => ({ ...lesson(), ...entry })), recurrenceAt, "Inactive");
    const regression = confirmed(failed);
    const linked = addLearning(input(regression, source.lessons.map((entry) => ({ ...lesson(), ...entry })), recurrenceAt, "Inactive"), learning({
      id: "observed-recurrence", reviewedAt: recurrenceAt, outcome: "Candidate", mechanisms: [],
      evidence: [{ kind: "Confirmed regression", assessmentId: "risk", regressionId: "regression" }],
    }));
    const recoveredAt = "2026-10-06T10:00:00.000Z";
    const restored = linked.assessments.map((record) => ({ ...record, controls: record.controls.map((control) => ({
      ...control, assuranceTests: [...control.assuranceTests!, {
        id: "recovery-test", testedAt: recoveredAt, testedByPersonId: "reviewer", result: "Passed" as const, evidenceIds: ["evidence"],
      }],
    })) }));
    const current = input(restored, linked.lessons.map((entry) => ({ ...lesson(), ...entry })), recoveredAt);
    const history = recordIcarusInstitutionalisationReview(current, "lesson", {
      ...proof(current), id: "reverification", reviewedAt: recoveredAt,
      evidence: [{ kind: "Control test", assessmentId: "risk", controlId: "control", testId: "recovery-test" }],
    });
    const reviewed = { ...current, lessons: current.lessons.map((entry) => ({ ...entry, icarusLearning: history })) };
    const view = buildIcarusLearningIndex(reviewed).lessons[0];
    expect(view.recurrence).toEqual([{ assessmentId: "risk", regressionId: "regression", confirmedAt: recurrenceAt,
      afterInstitutionalisation: true, requiresReview: false }]);
    expect(view.institutionalisation).toBe("Institutionalised");
    expect(view.attentionReasons).toEqual([]);
    expect(history.institutionalisationReviews).toHaveLength(2);
    expect(reviewed.assessments[0].confirmedRegressions).toEqual(regression[0].confirmedRegressions);
  });

  it("saving an older Lesson editor preserves newly appended authoritative review history", () => {
    const olderEditor = lesson();
    const current = embedding().lessons[0];
    const edited = { ...olderEditor, description: "Human edited Lesson description", status: "Implemented" as const };
    const saved = applyLessonEditorChanges({ ...lesson(), ...current }, edited);
    expect(saved.description).toBe(edited.description);
    expect(saved.status).toBe("Implemented");
    expect(saved.icarusLearning).toEqual(current.icarusLearning);
    expect(normalizeLessonRecord(JSON.parse(JSON.stringify(saved)) as CaptureConversionRecord).icarusLearning).toEqual(current.icarusLearning);
    expect(applyLessonEditorChanges(olderEditor, { ...edited, icarusLearning: current.icarusLearning }).icarusLearning).toBeUndefined();
  });

  it("withdraws validated learning when its treatment review predates the cited test without deleting the Lesson", () => {
    const record = risk();
    const targetId = getIcarusTreatmentTargetId("Failure-chain restoration", "recovery");
    record.treatmentTargets = [{
      id: targetId, sourceKind: "Failure-chain restoration", sourceId: "recovery", assessmentId: record.id,
      failureModeId: "mode", controlId: "control", treatmentKind: "Restore protection", reason: "Corrective action",
      basis: [], affectedAssessmentIds: [record.id], objectiveIds: [], pillarIds: [],
      provenance: { kind: "Failure-chain recommendation", finding: "Restore protection" },
      executionLinks: [{ recordType: "Action", recordId: "recovery", linkedAt: createdAt }], promotedAt: createdAt,
    }];
    const source = input([record]);
    const deriveTreatment = (records: IcarusAssessmentRecord[]) => buildIcarusTreatmentIndex({
      assessments: records, assurance: source.assurance, dependencyHealth: source.dependencyHealth,
      resilience: [], recommendations: [], barrierRestorations: [],
      actions: [{ recordType: "Action", recordId: "recovery", title: "Recovery", status: "Completed",
        completedAt: createdAt, completionEvidence: "Recovery work complete" }],
      projects: [], founderPersonId: null, nowMs: source.nowMs,
    });
    const option = deriveTreatment([record]).verification.get(targetId)!.options.find((entry) => entry.outcome === "Effective")!;
    expect(option).toBeDefined();
    record.treatmentOutcomes = [{
      id: getIcarusTreatmentOutcomeId(targetId, "reviewer", option.evidence),
      treatmentTargetId: targetId, assessmentId: record.id, executionLinks: record.treatmentTargets[0].executionLinks,
      outcome: "Effective", verifiedAt: testedAt, verifiedByPersonId: "reviewer",
      evidence: [...option.evidence], afterState: option.afterState, verificationNote: "Observed protection",
      completionConditions: deriveTreatment([record]).verification.get(targetId)!.completion!.conditions.slice(),
    }];
    source.treatment = deriveTreatment([record]);
    const linked = addLearning(source, learning({
      evidence: [{ kind: "Treatment outcome", assessmentId: record.id, outcomeId: record.treatmentOutcomes[0].id }],
    }));
    expect(buildIcarusLearningIndex(linked).lessons[0].validity).toBe("Validated");
    const changed = { ...record, treatmentOutcomes: [{ ...record.treatmentOutcomes[0], verifiedAt: createdAt }] };
    const stale = { ...linked, assessments: [changed], treatment: deriveTreatment([changed]) };
    const view = buildIcarusLearningIndex(stale).lessons[0];
    expect(view.validity).toBe("Invalid / insufficient evidence");
    expect(view.reviews[0].issues).toContain("Supporting evidence is stale, unknown or no longer current; this is not contradiction");
    expect(buildIcarusLearningIndex(stale).attention).not.toEqual([]);
    expect(stale.lessons[0].icarusLearning).toEqual(linked.lessons[0].icarusLearning);
    expect(changed.treatmentOutcomes).toHaveLength(1);
  });

  it("imported supersession branches stay observable and cannot establish current validated guidance", () => {
    const source = input();
    const history = { reviews: [
      learning(),
      learning({ id: "branch-a", reviewedAt: embeddedAt, supersedesReviewId: "learning" }),
      learning({ id: "branch-b", reviewedAt: embeddedAt, supersedesReviewId: "learning" }),
    ], institutionalisationReviews: [] };
    const imported = { ...source, nowMs: Date.parse(embeddedAt), lessons: [{ ...lesson(), icarusLearning: history }] };
    const view = buildIcarusLearningIndex(imported).lessons[0];
    expect(view.validity).toBe("Invalid / insufficient evidence");
    expect(view.reviews).toHaveLength(3);
    expect(view.reviews.filter((entry) => entry.issues.includes("Ambiguous learning supersession branches"))).toHaveLength(2);
    expect(imported.lessons[0].icarusLearning.reviews).toEqual(history.reviews);
  });

  it("repeated explicit regression/re-resolution chronology retains distinct episodes for the same linked Lesson", () => {
    const source = embedding();
    const resolved = resolution({ ...source, nowMs: Date.parse(embeddedAt) });
    const firstFailure = input(resolved, source.lessons.map((entry) => ({ ...lesson(), ...entry })), recurrenceAt, "Inactive");
    const first = confirmed(firstFailure);
    const recoveredAt = "2026-10-06T10:00:00.000Z";
    const repeatedAt = "2026-10-07T10:00:00.000Z";
    const restored = first.map((record) => ({ ...record, controls: record.controls.map((control) => ({
      ...control, assuranceTests: [...control.assuranceTests!, {
        id: "recovery-test", testedAt: recoveredAt, testedByPersonId: "reviewer", result: "Passed" as const, evidenceIds: ["evidence"],
      }],
    })) }));
    const rereviewed = resolution(input(restored, source.lessons.map((entry) => ({ ...lesson(), ...entry })), recoveredAt),
      "re-resolution", "resolution", "regression");
    const secondFailure = input(rereviewed, source.lessons.map((entry) => ({ ...lesson(), ...entry })), repeatedAt, "Inactive");
    const second = confirmed(secondFailure, "second-regression", "re-resolution");
    const current = input(second, source.lessons.map((entry) => ({ ...lesson(), ...entry })), repeatedAt, "Inactive");
    const explicit = addLearning(current, learning({
      id: "repeat-observation", reviewedAt: repeatedAt, outcome: "Candidate", mechanisms: [],
      evidence: [
        { kind: "Confirmed regression", assessmentId: "risk", regressionId: "regression" },
        { kind: "Confirmed regression", assessmentId: "risk", regressionId: "second-regression" },
      ],
    }));
    const view = buildIcarusLearningIndex(explicit).lessons[0];
    expect(view.recurrence.map((entry) => entry.regressionId)).toEqual(["regression", "second-regression"]);
    expect(view.recurrence.every((entry) => entry.afterInstitutionalisation)).toBe(true);
    expect(second[0].strategicResolutionReviews).toHaveLength(2);
    expect(second[0].confirmedRegressions).toHaveLength(2);
    expect(explicit.lessons[0].status).toBe("Reviewed");
    expect(explicit.mechanisms[0].status).toBe("Active");
  });

  it("Icarus-linked recurring-problem maturity uses explicit validity rather than legacy System existence shortcuts", () => {
    const source = addLearning();
    const authoritative = {
      actions: [], projects: [], decisions: [],
      lessons: [{ ...lesson(), ...source.lessons[0], relatedProblem: "problem", relatedSystem: "system" }],
      problems: [{ id: "problem", title: "Recurrence", problemStatement: "", frequency: "Recurring", severity: "High",
        problemStatus: "Open", owner: "", isUnresolved: true }],
      systems: [{ id: "system", relatedLesson: "lesson", status: "Active" }], sops: [],
    };
    const projected = buildOrganisationalLearning({ ...authoritative, icarusLearning: buildIcarusLearningIndex(source) });
    expect(projected.find((entry) => entry.sourceType === "Problem")?.recurrenceState).toBe("Recorded recurrence");
    const embedded = embedding(source);
    const protectedProjection = buildOrganisationalLearning({ ...authoritative, icarusLearning: buildIcarusLearningIndex(embedded) });
    expect(protectedProjection.find((entry) => entry.sourceType === "Problem")?.recurrenceState).toBe("Institutionalised");
    const candidate = addLearning(input(), learning({ outcome: "Candidate" }));
    const candidateProjection = buildOrganisationalLearning({ ...authoritative, icarusLearning: buildIcarusLearningIndex(candidate) });
    expect(candidateProjection.find((entry) => entry.sourceType === "Problem")?.learningState).toBe("Lesson available");
    expect(candidateProjection.find((entry) => entry.sourceType === "Problem")?.recurrenceState).not.toBe("Institutionalised");
  });

  it("new validity does not suppress an authoritative Lesson Change Required status", () => {
    const source = embedding();
    const required = { ...source, lessons: source.lessons.map((entry) => ({ ...entry, status: "Change Required" as const })) };
    const attention = buildLearningAttention(signals(required).map((signal) => ({ signal })));
    expect(attention).toContainEqual(expect.objectContaining({ attentionKind: "Change required", target: { objectType: "Lesson", id: "lesson" } }));
    expect(required.lessons[0].status).toBe("Change Required");
  });

  it("missing assessment references remain inspectable without fabricating navigation or risk identities", () => {
    const source = addLearning();
    const missing = { ...source, assessments: [], lifecycle: { ...source.lifecycle, byAssessmentId: new Map() } };
    const index = buildIcarusLearningIndex(missing);
    expect(index.lessons[0].assessmentIds).toEqual(["risk"]);
    expect(index.lessons[0].validity).toBe("Invalid / insufficient evidence");
    expect(index.lessons[0].attentionAssessmentIds).toEqual([]);
    expect(index.attention).toEqual([]);
    expect(command(missing).items).toEqual([]);
  });

  it("learning reminders reuse the existing risk identity, do not inflate exposure, and deduplicate Command and Founder", () => {
    const source = addLearning();
    const index = buildIcarusLearningIndex(source);
    const before = JSON.stringify(source);
    const projection = signals(source);
    expect(projection.filter((entry) => entry.sourceType === "Lesson")).toHaveLength(1);
    const attention = buildLearningAttention(projection.map((signal) => ({ signal })));
    expect(attention[0]).toMatchObject({ target: { objectType: "Icarus", id: "risk" }, identityKey: "icarus-assessment:risk" });
    const items = command(source).items;
    expect(items.filter((item) => item.objectType === "Icarus" && item.id === "risk")).toHaveLength(1);
    expect(items[0].statusText).toContain("not a new strategic exposure");
    expect(items[0].attentionRank).toBe(5);
    const exposed = {
      ...source, assessments: source.assessments.map((record) => ({ ...record, controls: [] })),
    };
    expect(command(exposed, true).items.filter((item) => item.objectType === "Icarus" && item.id === "risk")).toHaveLength(1);
    const focus = buildFounderFocus({
      signalledRecords: [], founderReviewItems: [], limitations: [], convergentRisks: [], recordFacts: new Map(),
      icarusLearning: index.attention,
      strategicRisks: [{
        key: "Icarus:risk", objectType: "Icarus", id: "risk", title: "Continuity", area: "Excavation",
        band: 3, score: 100, reason: "Actual risk", anchorRecordKeys: [], referenceKey: "icarus-assessment:risk",
      }],
    });
    expect(focus).toHaveLength(1);
    expect(focus[0]).toMatchObject({ id: "risk", band: 3, score: 100 });
    expect(focus[0].reason).toContain("Icarus learning");
    const intelligence = buildIcarusStrategicIntelligence({
      assessments: source.assessments, people: source.people, actions: [], sourceRecords: [], strategicObjectives: [],
      primaryFounderId: null, founderDependencyActive: false, nowMs: source.nowMs,
    });
    expect(intelligence.exposureSnapshot).toEqual([]);
    expect(intelligence.correlationSignals).toEqual([]);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("linked intervention history distinguishes authoritative Lesson status from validity and embedding", () => {
    const source = addLearning();
    const record = {
      ...emptyIcarusInterventionScope("risk"), id: "decision", title: "Intervention", causeIds: [], status: "Draft" as const,
      createdAt, updatedAt: learnedAt, createdByPersonId: "reviewer", updatedByPersonId: "reviewer",
      rationale: "", options: [], selectionHistory: [], relationships: [], effects: [],
      lessonLinks: [{ id: "link", lessonId: "lesson", outcomeIds: [], causeIds: [], rationale: "Explicit Lesson",
        linkedAt: learnedAt, linkedByPersonId: "reviewer" }],
    };
    const index = buildIcarusInterventionIndex({
      assessments: [{ ...source.assessments[0], interventionDecisions: [record] }], treatment: source.treatment,
      sources: [], signals: [], decisions: [], lessons: source.lessons, people: source.people, nowMs: source.nowMs,
      lifecycle: source.lifecycle, learningValidity: buildIcarusLearningIndex(source),
    });
    expect(index.decisions[0].learningConclusions[0]).toMatchObject({ lessonId: "lesson", validity: "Validated", institutionalisation: "Verification due" });
  });

  it("learning augments an already anchored Command risk without adding an assessment reminder or raising priority", () => {
    const learned = addLearning();
    const source = { ...learned, assessments: learned.assessments.map((record) => ({
      ...record, controls: [], linkedRecords: [...record.linkedRecords, { recordType: "Action" as const, recordId: "anchor" }],
    })) };
    const action = {
      id: "anchor", status: "Blocked", priority: "Low", dueDate: "", followUpDate: "", followUpNote: "",
      createdDate: createdAt, createdAt, actionTitle: "Linked execution", title: "Linked execution",
      relatedPillar: "Excavation", relatedArea: "", relatedProblem: "", relatedDecision: "",
    } satisfies CommandAttentionInput["actions"][number];
    const intelligence = buildIcarusStrategicIntelligence({
      assessments: source.assessments, people: source.people, actions: [action], strategicObjectives: [],
      sourceRecords: [{ recordType: "Pillar", recordId: "Excavation", title: "Excavation" },
        { recordType: "Action", recordId: "anchor", title: action.title }],
      primaryFounderId: null, founderDependencyActive: false, nowMs: source.nowMs,
    });
    expect(intelligence.strategicSignals).toHaveLength(1);
    const base = {
      actions: [action], projects: [], decisions: [], opportunities: [], lessons: [], problems: [], systems: [], sops: [],
      outreach: [], handoffs: [], procurementQueue: [], icarus: intelligence.strategicSignals, nowMs: source.nowMs,
    };
    const before = buildCommandAttention(base).items;
    const after = buildCommandAttention({ ...base, learning: signals(source).map((signal) => ({ signal })) }).items;
    expect(after.map((item) => [item.objectType, item.id])).toEqual(before.map((item) => [item.objectType, item.id]));
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ objectType: "Action", id: "anchor",
      attentionRank: before[0].attentionRank, priorityScore: before[0].priorityScore });
    expect(after[0].reason).toContain("Icarus learning");
    expect(after[0].strategicRisk?.references.map((reference) => reference.identityKey)).toEqual(["icarus-assessment:risk"]);
  });

  it("derivation is deterministic, does not persist derived truth, and never mutates authority records", () => {
    const source = embedding();
    const before = JSON.stringify(source);
    expect(buildIcarusLearningIndex(source)).toEqual(buildIcarusLearningIndex(source));
    expect(JSON.stringify(source)).toBe(before);
    const stored = JSON.parse(JSON.stringify(source.lessons[0])) as CaptureConversionRecord;
    expect(normalizeLessonRecord(stored).icarusLearning).toEqual(source.lessons[0].icarusLearning);
    expect(Object.keys(stored.icarusLearning!)).toEqual(["reviews", "institutionalisationReviews"]);
    expect(buildLearningAttention(signals(source).map((signal) => ({ signal })))).toEqual([]);
  });
});
