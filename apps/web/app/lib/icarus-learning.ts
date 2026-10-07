import type { LessonRecord } from "./capture-conversions";
import {
  classifyIcarusEvidenceFreshness, getIcarusIdentityKey, getIcarusReferenceKey,
  getIcarusControlTestDueAt,
  type IcarusAssessmentRecord,
} from "./icarus";
import type { IcarusAssuranceResult } from "./icarus-assurance";
import type { IcarusTreatmentIndex } from "./icarus-treatment";
import type { IcarusStrategicLifecycleIndex } from "./icarus-strategic-lifecycle";
import { getIcarusEffectiveProtection } from "./icarus-effective-protection";
import type { IcarusDependencyHealthRegistry } from "./icarus-dependency-health";
import { isValidCalendarDateInput } from "./dates";

export type IcarusLearningEvidenceReference =
  | { kind: "Evidence"; assessmentId: string; failureModeId: string; evidenceId: string }
  | { kind: "Control test"; assessmentId: string; controlId: string; testId: string }
  | { kind: "Treatment outcome"; assessmentId: string; outcomeId: string }
  | { kind: "Resolution review"; assessmentId: string; reviewId: string }
  | { kind: "Confirmed regression"; assessmentId: string; regressionId: string };
export type IcarusLearningMechanism = {
  recordType: "System" | "SOP" | "Decision" | "Action" | "Project";
  recordId: string;
};
export type IcarusLearningReview = {
  id: string;
  reviewedAt: string;
  reviewedByPersonId: string;
  conclusion: string;
  outcome: "Candidate" | "Validated" | "Contradicted";
  evidence: IcarusLearningEvidenceReference[];
  supersedesReviewId?: string;
  contradictsReviewId?: string;
  institutionalisation: "Required" | "Not required";
  mechanisms: IcarusLearningMechanism[];
  rationale: string;
};
export type IcarusInstitutionalisationReview = {
  id: string;
  learningReviewId: string;
  reviewedAt: string;
  reviewedByPersonId: string;
  outcome: "Effective" | "Ineffective" | "Inconclusive";
  evidence: IcarusLearningEvidenceReference[];
  mechanismConditions: { reference: IcarusLearningMechanism; status: string; revision: string }[];
  nextReviewBy?: string;
  rationale: string;
};
export type IcarusLessonLearning = {
  reviews: IcarusLearningReview[];
  institutionalisationReviews: IcarusInstitutionalisationReview[];
};
export type IcarusLearningValidity = "No explicit learning" | "Observed" | "Candidate learning" | "Validated"
  | "Contradicted" | "Superseded" | "Invalid / insufficient evidence";
export type IcarusInstitutionalisationState = "Not required" | "Required" | "Planned" | "In progress"
  | "Institutionalised" | "Verification due" | "Ineffective / incomplete" | "Superseded";
export type IcarusLearningMechanismRecord = IcarusLearningMechanism & { title: string; status: string; revision: string };
export type IcarusLearningInput = {
  lessons: readonly Pick<LessonRecord, "id" | "lessonTitle" | "title" | "status" | "icarusLearning">[];
  assessments: readonly IcarusAssessmentRecord[];
  assurance: IcarusAssuranceResult;
  dependencyHealth: IcarusDependencyHealthRegistry;
  treatment: IcarusTreatmentIndex;
  lifecycle: IcarusStrategicLifecycleIndex;
  mechanisms: readonly IcarusLearningMechanismRecord[];
  people: readonly { id: string; status: string }[];
  nowMs: number;
};
export type IcarusLearningReviewView = {
  record: IcarusLearningReview;
  validity: IcarusLearningValidity;
  issues: readonly string[];
  institutionalisation: IcarusInstitutionalisationState;
  institutionalisationHistory: readonly { record: IcarusInstitutionalisationReview; issues: readonly string[]; current: boolean }[];
};
export type IcarusLessonLearningView = {
  lessonId: string;
  title: string;
  validity: IcarusLearningValidity;
  institutionalisation?: IcarusInstitutionalisationState;
  reviews: readonly IcarusLearningReviewView[];
  assessmentIds: readonly string[];
  recurrence: readonly { assessmentId: string; regressionId: string; confirmedAt: string; afterInstitutionalisation: boolean; requiresReview: boolean }[];
  attentionReasons: readonly string[];
  attentionAssessmentIds: readonly string[];
  orphanedInstitutionalisationReviews: readonly IcarusInstitutionalisationReview[];
};
export type IcarusLearningAttention = {
  assessmentId: string;
  title: string;
  identityKey: string;
  reasons: readonly string[];
};
export type IcarusLearningIndex = {
  lessons: readonly IcarusLessonLearningView[];
  byLessonId: ReadonlyMap<string, IcarusLessonLearningView>;
  observedAssessmentIds: readonly string[];
  attention: readonly IcarusLearningAttention[];
  maturityByLessonId: ReadonlyMap<string, { validated: boolean; institutionalised: boolean }>;
};

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const date = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value))
  && (!value.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/) || isValidCalendarDateInput(value.slice(0, 10)));
const deadline = (value: string) => Date.parse(value.length === 10 ? `${value}T23:59:59.999Z` : value);
const optionalId = (value: unknown) => value === undefined || text(value);
const unique = (values: readonly string[]) => [...new Set(values)].sort();
const key = (reference: IcarusLearningEvidenceReference) => JSON.stringify(reference);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
// Change detection only, never evidence of effectiveness. Keep source content out of durable review records.
export function getIcarusLearningMechanismRevision(values: readonly unknown[]): string {
  const content = JSON.stringify(values);
  let left = 2166136261;
  let right = 2246822507;
  for (let index = 0; index < content.length; index++) {
    const code = content.charCodeAt(index);
    left = Math.imul(left ^ code, 16777619);
    right = Math.imul(right ^ code, 3266489909);
  }
  return `${content.length}:${(left >>> 0).toString(16)}:${(right >>> 0).toString(16)}`;
}
function one<T>(values: readonly T[], predicate: (value: T) => boolean): T | undefined {
  const found = values.filter(predicate);
  return found.length === 1 ? found[0] : undefined;
}
function evidenceReference(value: unknown): value is IcarusLearningEvidenceReference {
  if (!object(value) || !text(value.assessmentId)) return false;
  switch (value.kind) {
    case "Evidence": return text(value.failureModeId) && text(value.evidenceId);
    case "Control test": return text(value.controlId) && text(value.testId);
    case "Treatment outcome": return text(value.outcomeId);
    case "Resolution review": return text(value.reviewId);
    case "Confirmed regression": return text(value.regressionId);
    default: return false;
  }
}
function mechanism(value: unknown): value is IcarusLearningMechanism {
  return object(value) && ["System", "SOP", "Decision", "Action", "Project"].includes(String(value.recordType)) && text(value.recordId);
}
function review(value: unknown): value is IcarusLearningReview {
  return object(value) && text(value.id) && date(value.reviewedAt) && text(value.reviewedByPersonId)
    && text(value.conclusion) && ["Candidate", "Validated", "Contradicted"].includes(String(value.outcome))
    && Array.isArray(value.evidence) && value.evidence.every(evidenceReference)
    && optionalId(value.supersedesReviewId) && optionalId(value.contradictsReviewId)
    && ["Required", "Not required"].includes(String(value.institutionalisation))
    && Array.isArray(value.mechanisms) && value.mechanisms.every(mechanism) && text(value.rationale);
}
function institutionalReview(value: unknown): value is IcarusInstitutionalisationReview {
  return object(value) && text(value.id) && text(value.learningReviewId) && date(value.reviewedAt) && text(value.reviewedByPersonId)
    && ["Effective", "Ineffective", "Inconclusive"].includes(String(value.outcome))
    && Array.isArray(value.evidence) && value.evidence.every(evidenceReference)
    && Array.isArray(value.mechanismConditions) && value.mechanismConditions.every((entry: unknown) =>
      object(entry) && mechanism(entry.reference) && text(entry.status) && typeof entry.revision === "string")
    && (value.nextReviewBy === undefined || date(value.nextReviewBy)) && text(value.rationale);
}

// Optional history follows existing defensive parsing: retain valid entries, including ambiguous IDs.
export function normaliseIcarusLessonLearning(value: unknown): IcarusLessonLearning | undefined {
  if (!object(value)) return undefined;
  return {
    reviews: Array.isArray(value.reviews) ? value.reviews.filter(review) : [],
    institutionalisationReviews: Array.isArray(value.institutionalisationReviews)
      ? value.institutionalisationReviews.filter(institutionalReview) : [],
  };
}

export function getIcarusLearningEvidenceOptions(input: IcarusLearningInput): { reference: IcarusLearningEvidenceReference; label: string }[] {
  return input.assessments.flatMap((assessment) => [
    ...assessment.failureModes.flatMap((mode) => mode.evidence.map((evidence) => ({
      reference: { kind: "Evidence" as const, assessmentId: assessment.id, failureModeId: mode.id, evidenceId: evidence.id },
      label: `${assessment.outcome}: evidence ${evidence.id} (${evidence.review})`,
    }))),
    ...assessment.controls.flatMap((control) => (control.assuranceTests ?? []).map((test) => ({
      reference: { kind: "Control test" as const, assessmentId: assessment.id, controlId: control.id, testId: test.id },
      label: `${assessment.outcome}: control ${control.id}, test ${test.id} (${test.result})`,
    }))),
    ...(assessment.treatmentOutcomes ?? []).map((outcome) => ({
      reference: { kind: "Treatment outcome" as const, assessmentId: assessment.id, outcomeId: outcome.id },
      label: `${assessment.outcome}: treatment occurrence ${outcome.id} (${outcome.outcome})`,
    })),
    ...(assessment.strategicResolutionReviews ?? []).map((review) => ({
      reference: { kind: "Resolution review" as const, assessmentId: assessment.id, reviewId: review.id },
      label: `${assessment.outcome}: resolution ${review.id} (${review.outcome})`,
    })),
    ...(assessment.confirmedRegressions ?? []).map((regression) => ({
      reference: { kind: "Confirmed regression" as const, assessmentId: assessment.id, regressionId: regression.id },
      label: `${assessment.outcome}: confirmed regression ${regression.id}`,
    })),
  ]);
}

type EvidenceState = { valid: boolean; current: boolean; at?: string; effectiveness: boolean; contradicts?: boolean; reason?: string };
function evidenceState(input: IcarusLearningInput, reference: IcarusLearningEvidenceReference): EvidenceState {
  const assessment = one(input.assessments, (entry) => entry.id === reference.assessmentId);
  const missing: EvidenceState = { valid: false, current: false, effectiveness: false, reason: `Missing or ambiguous ${reference.kind} reference: ${key(reference)}` };
  if (!assessment) return missing;
  switch (reference.kind) {
    case "Evidence": {
      const mode = one(assessment.failureModes, (entry) => entry.id === reference.failureModeId);
      const evidence = one(mode?.evidence ?? [], (entry) => entry.id === reference.evidenceId);
      if (!evidence) return missing;
      const at = evidence.reviewedAt ?? evidence.recordedAt;
      const current = (evidence.review === "Supports" || evidence.review === "Contradicts") && Date.parse(at) <= input.nowMs
        && Date.parse(evidence.recordedAt) <= input.nowMs && (!evidence.observedAt || Date.parse(evidence.observedAt) <= input.nowMs)
        && !["Stale", "Invalid"].includes(classifyIcarusEvidenceFreshness(evidence, input.nowMs));
      return { valid: true, current, at, effectiveness: false, contradicts: evidence.review === "Contradicts" };
    }
    case "Control test": {
      const control = one(assessment.controls, (entry) => entry.id === reference.controlId);
      const test = one(control?.assuranceTests ?? [], (entry) => entry.id === reference.testId);
      if (!control || !test) return missing;
      const assurance = input.assurance.byAssessmentId.get(assessment.id)?.controls.find((entry) => entry.controlId === control.id);
      const current = assurance?.lastEvent?.testId === test.id && assurance.evidence === "Current support"
        && !["Test overdue", "Evidence insufficient", "Not operating"].includes(assurance.status) && Date.parse(test.testedAt) <= input.nowMs
        && (!control.nextReviewAt || Date.parse(control.nextReviewAt.length === 10 ? `${control.nextReviewAt}T23:59:59.999Z` : control.nextReviewAt) >= input.nowMs)
        && (getIcarusControlTestDueAt(control) === undefined || getIcarusControlTestDueAt(control)! >= input.nowMs)
        && test.evidenceIds.length > 0 && test.evidenceIds.every((id) => {
          const mode = assessment.failureModes.find((mode) => mode.id === control.failureModeId);
          const evidence = one(mode?.evidence ?? [], (entry) => entry.id === id);
          return evidence && evidence.review === "Supports" && Date.parse(evidence.recordedAt) <= input.nowMs
            && (!evidence.reviewedAt || Date.parse(evidence.reviewedAt) <= input.nowMs)
            && (!evidence.observedAt || Date.parse(evidence.observedAt) <= input.nowMs)
            && !["Stale", "Invalid"].includes(classifyIcarusEvidenceFreshness(evidence, input.nowMs));
        });
      const effectiveness = Boolean(current && test.result === "Passed" && assurance
        && getIcarusEffectiveProtection(control, assurance.status, input.dependencyHealth).barrier === "Active");
      return { valid: true, current, at: test.testedAt, effectiveness };
    }
    case "Treatment outcome": {
      const outcome = one(assessment.treatmentOutcomes ?? [], (entry) => entry.id === reference.outcomeId);
      if (!outcome) return missing;
      const currency = one([...input.treatment.verification.values()].flatMap((entry) => entry.history), (entry) => entry.record.id === outcome.id);
      const current = Boolean(currency?.evidenceCurrent ?? currency?.current) && Date.parse(outcome.verifiedAt) <= input.nowMs
        && outcome.evidence.every((entry) => entry.kind !== "Control test" || evidenceState(input, {
          kind: "Control test", assessmentId: entry.assessmentId, controlId: entry.controlId, testId: entry.testId,
        }).current);
      return { valid: true, current, at: outcome.verifiedAt, effectiveness: current && outcome.outcome === "Effective" };
    }
    case "Resolution review": {
      const resolution = one(input.lifecycle.byAssessmentId.get(assessment.id)?.reviews ?? [], (entry) => entry.record.id === reference.reviewId);
      if (!resolution) return missing;
      const valid = resolution.validity !== "Invalid" && resolution.record.outcome === "Verified resolved";
      return { valid, current: valid && resolution.validity === "Current", at: resolution.record.reviewedAt,
        effectiveness: valid && resolution.validity === "Current" };
    }
    case "Confirmed regression": {
      const regression = one(input.lifecycle.byAssessmentId.get(assessment.id)?.regressions ?? [], (entry) => entry.record.id === reference.regressionId);
      return regression ? { valid: regression.valid, current: regression.valid, at: regression.record.confirmedAt, effectiveness: false } : missing;
    }
  }
}
function reviewIssues(input: IcarusLearningInput, lessonId: string, record: IcarusLearningReview) {
  const lesson = one(input.lessons, (entry) => entry.id === lessonId);
  const history = lesson?.icarusLearning?.reviews ?? [];
  const states = record.evidence.map((reference) => evidenceState(input, reference));
  const target = record.contradictsReviewId ?? record.supersedesReviewId;
  const prior = target ? one(history, (entry) => entry.id === target) : undefined;
  return unique([
    ...(!lesson ? ["Missing or ambiguous authoritative Lesson"] : []),
    ...(!one(input.lessons.flatMap((entry) => entry.icarusLearning?.reviews ?? []), (entry) => entry.id === record.id)
      && history.some((entry) => entry.id === record.id) ? ["Ambiguous learning review identity"] : []),
    ...(!record.evidence.length ? ["No explicit Icarus provenance recorded"] : []),
    ...states.filter((state) => !state.valid).map((state) => state.reason ?? "Invalid evidence reference"),
    ...(states.some((state) => state.at && Date.parse(state.at) > Date.parse(record.reviewedAt)) ? ["Evidence postdates the learning review"] : []),
    ...(record.outcome !== "Contradicted" && states.some((state) => state.current && state.contradicts)
      ? ["Current contradictory evidence cannot validate this conclusion"] : []),
    ...(Date.parse(record.reviewedAt) > input.nowMs ? ["Learning review is in the future"] : []),
    ...(target && (!prior || Date.parse(prior.reviewedAt) >= Date.parse(record.reviewedAt)) ? ["Broken or non-chronological prior learning reference"] : []),
    ...(record.supersedesReviewId && prior?.outcome === "Contradicted" && record.outcome !== "Validated"
      ? ["Re-adoption after contradiction requires a new explicit validation"] : []),
    ...(record.supersedesReviewId && history.filter((entry) => entry.supersedesReviewId === record.supersedesReviewId).length > 1
      ? ["Ambiguous learning supersession branches"] : []),
    ...(record.outcome === "Contradicted" && !record.contradictsReviewId ? ["Contradiction must identify the affected review"] : []),
    ...(record.outcome !== "Contradicted" && record.contradictsReviewId ? ["Only a contradiction may identify a contradicted review"] : []),
    ...(record.contradictsReviewId && record.supersedesReviewId ? ["Choose contradiction or supersession, not both"] : []),
    ...(new Set(record.mechanisms.map(getIcarusReferenceKey)).size !== record.mechanisms.length ? ["Ambiguous mechanism references"] : []),
    ...record.mechanisms.filter((reference) => !one(input.mechanisms, (source) => getIcarusReferenceKey(source) === getIcarusReferenceKey(reference)))
      .map((reference) => `Missing or ambiguous institutional mechanism: ${getIcarusReferenceKey(reference)}`),
    ...(record.outcome === "Validated" && history.some((entry) => entry.outcome === "Contradicted"
      && Date.parse(entry.reviewedAt) < Date.parse(record.reviewedAt) && entry.contradictsReviewId
      && entry.evidence.length && entry.evidence.every((ref) => evidenceState(input, ref).valid)
      && !history.some((successor) => successor.supersedesReviewId === entry.id && successor.outcome === "Validated"
        && Date.parse(successor.reviewedAt) <= Date.parse(record.reviewedAt))
      && record.supersedesReviewId !== entry.id) ? ["Outstanding explicit contradiction requires traceable re-adoption"] : []),
  ]);
}
function implemented(record: IcarusLearningMechanismRecord) {
  return record.recordType === "Action" || record.recordType === "Project" ? record.status === "Completed"
    : record.recordType === "Decision" ? ["Active", "Under Review", "Completed"].includes(record.status)
      : ["Active", "Reviewing"].includes(record.status);
}
function evidenceModes(input: IcarusLearningInput, reference: IcarusLearningEvidenceReference): string[] {
  const assessment = one(input.assessments, (entry) => entry.id === reference.assessmentId);
  if (!assessment) return [];
  switch (reference.kind) {
    case "Evidence": return [reference.failureModeId];
    case "Control test": return assessment.controls.filter((entry) => entry.id === reference.controlId).map((entry) => entry.failureModeId);
    case "Resolution review": return assessment.strategicResolutionReviews?.find((entry) => entry.id === reference.reviewId)?.scope.failureModeIds ?? [];
    case "Confirmed regression": return assessment.confirmedRegressions?.find((entry) => entry.id === reference.regressionId)?.scope.failureModeIds ?? [];
    case "Treatment outcome": {
      const outcome = assessment.treatmentOutcomes?.find((entry) => entry.id === reference.outcomeId);
      const target = input.treatment.targets.find((entry) => entry.id === outcome?.treatmentTargetId);
      return target?.failureModeId ? [target.failureModeId]
        : outcome?.evidence.flatMap((entry) => entry.kind === "Control test" || entry.kind === "Failure mode materiality" ? [entry.failureModeId] : []) ?? [];
    }
  }
}
function institutionalIssues(input: IcarusLearningInput, learning: IcarusLearningReview, record: IcarusInstitutionalisationReview) {
  const states = record.evidence.map((reference) => evidenceState(input, reference));
  return unique([
    ...(record.learningReviewId !== learning.id ? ["Verification belongs to another learning review"] : []),
    ...(Date.parse(record.reviewedAt) < Date.parse(learning.reviewedAt) || Date.parse(record.reviewedAt) > input.nowMs ? ["Invalid verification chronology"] : []),
    ...states.filter((state) => !state.valid).map((state) => state.reason ?? "Invalid verification evidence reference"),
    ...(states.some((state) => state.at && Date.parse(state.at) > Date.parse(record.reviewedAt)) ? ["Evidence postdates verification"] : []),
    ...(!learning.mechanisms.length || !same(unique(learning.mechanisms.map(getIcarusReferenceKey)),
      unique(record.mechanismConditions.map((entry) => getIcarusReferenceKey(entry.reference)))) ? ["Verification must name the declared mechanisms"] : []),
    ...(new Set(record.mechanismConditions.map((entry) => getIcarusReferenceKey(entry.reference))).size !== record.mechanismConditions.length
      ? ["Ambiguous repeated mechanism condition"] : []),
    ...(record.evidence.some((ref) => !learning.evidence.some((origin) => origin.assessmentId === ref.assessmentId))
      ? ["Effectiveness evidence is outside the learning assessment scope"] : []),
    ...(record.outcome === "Effective" && record.evidence.some((ref) => {
      const modes = evidenceModes(input, ref);
      const scope = learning.evidence.filter((origin) => origin.assessmentId === ref.assessmentId).flatMap((origin) => evidenceModes(input, origin));
      return !modes.some((id) => scope.includes(id));
    }) ? ["Effectiveness evidence must match the explicitly learned failure-mode scope"] : []),
    ...(record.nextReviewBy && deadline(record.nextReviewBy) < Date.parse(record.reviewedAt) ? ["Verification deadline precedes review"] : []),
  ]);
}

export function buildIcarusLearningIndex(input: IcarusLearningInput): IcarusLearningIndex {
  const lessons = [...input.lessons].sort((a, b) => a.id.localeCompare(b.id)).map((lesson): IcarusLessonLearningView => {
    const records = [...(lesson.icarusLearning?.reviews ?? [])].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || a.id.localeCompare(b.id));
    const problems = new Map(records.map((record) => [record.id, reviewIssues(input, lesson.id, record)]));
    const reviews = records.map((record): IcarusLearningReviewView => {
      const issues = [...(problems.get(record.id) ?? [])];
      const superseded = records.some((entry) => entry.supersedesReviewId === record.id && !problems.get(entry.id)?.length);
      const contradicted = records.some((entry) => entry.contradictsReviewId === record.id && !problems.get(entry.id)?.length && !records.some((later) =>
        later.supersedesReviewId === entry.id && !problems.get(later.id)?.length));
      const supported = record.evidence.length > 0 && record.evidence.every((reference) => evidenceState(input, reference).current);
      const validity: IcarusLearningValidity = issues.length ? "Invalid / insufficient evidence"
        : superseded ? "Superseded" : contradicted || record.outcome === "Contradicted" ? "Contradicted"
          : !supported || input.lifecycle.hypothetical ? "Invalid / insufficient evidence"
            : record.outcome === "Validated" ? "Validated" : "Candidate learning";
      if (!supported && !issues.length) issues.push("Supporting evidence is stale, unknown or no longer current; this is not contradiction");
      const institutionalisationHistory = [...(lesson.icarusLearning?.institutionalisationReviews ?? [])]
        .filter((entry) => entry.learningReviewId === record.id)
        .sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || a.id.localeCompare(b.id))
        .map((entry) => {
          const issues = institutionalIssues(input, record, entry);
          if (input.lessons.flatMap((lesson) => lesson.icarusLearning?.institutionalisationReviews ?? []).filter((other) => other.id === entry.id).length !== 1) {
            issues.push("Ambiguous institutionalisation review identity");
          }
          const current = !issues.length && !input.lifecycle.hypothetical && entry.evidence.length > 0
            && entry.evidence.every((ref) => evidenceState(input, ref).current)
            && (entry.outcome !== "Effective" || entry.evidence.some((ref) => {
              const state = evidenceState(input, ref);
              return state.effectiveness && state.at && Date.parse(state.at) >= Date.parse(record.reviewedAt);
            }))
            && entry.mechanismConditions.every((condition) => {
              const mechanism = one(input.mechanisms, (source) => getIcarusReferenceKey(source) === getIcarusReferenceKey(condition.reference));
              return mechanism && implemented(mechanism) && mechanism.status === condition.status && mechanism.revision === condition.revision;
            })
            && (!entry.nextReviewBy || Date.parse(entry.nextReviewBy.length === 10 ? `${entry.nextReviewBy}T23:59:59.999Z` : entry.nextReviewBy) >= input.nowMs);
          return { record: entry, issues, current };
        });
      const mechanisms = record.mechanisms.map((ref) => one(input.mechanisms, (source) => getIcarusReferenceKey(source) === getIcarusReferenceKey(ref)));
      const latest = institutionalisationHistory.at(-1);
      const institutionalisation: IcarusInstitutionalisationState = validity === "Superseded" ? "Superseded"
        : record.institutionalisation === "Not required" ? "Not required"
          : !record.mechanisms.length ? "Required"
            : mechanisms.some((source) => !source || ["Cancelled", "Deprecated", "Archived", "Blocked", "Reversed"].includes(source.status)) ? "Ineffective / incomplete"
              : mechanisms.some((source) => source && !implemented(source)) ? mechanisms.some((source) => source?.status === "In Progress") ? "In progress" : "Planned"
                : latest?.record.outcome === "Ineffective" && latest.current ? "Ineffective / incomplete"
                  : validity === "Validated" && latest?.record.outcome === "Effective" && latest.current ? "Institutionalised" : "Verification due";
      return { record, validity, issues, institutionalisation, institutionalisationHistory };
    });
    const available = reviews.filter((view) => view.validity !== "Superseded" && view.record.outcome !== "Contradicted");
    const active = available.filter((view) => view.record.outcome === "Validated").at(-1) ?? available.at(-1) ?? reviews.at(-1);
    const linkedRegressions = records.filter((record) => !problems.get(record.id)?.length)
      .flatMap((record) => record.evidence.filter((ref) => ref.kind === "Confirmed regression"));
    const currentEmbedding = active?.validity === "Validated" && active.institutionalisation === "Institutionalised"
      ? active.institutionalisationHistory.filter((entry) => entry.current && entry.record.outcome === "Effective") : [];
    const recurrence = linkedRegressions.flatMap((ref) => {
      const history = input.lifecycle.byAssessmentId.get(ref.assessmentId);
      const regression = history?.regressions.find((entry) => entry.record.id === ref.regressionId && entry.valid);
      const origin = regression ? reviews.filter((view) => view.record.outcome === "Validated"
        && !problems.get(view.record.id)?.length && Date.parse(view.record.reviewedAt) < Date.parse(regression.record.confirmedAt)
        && view.record.evidence.some((evidence) => evidence.assessmentId === ref.assessmentId)).at(-1) : undefined;
      const embeddingHistory = origin?.institutionalisationHistory.filter((entry) => !entry.issues.length && entry.record.outcome === "Effective") ?? [];
      return regression && origin
        ? [{ assessmentId: ref.assessmentId, regressionId: regression.record.id, confirmedAt: regression.record.confirmedAt,
          afterInstitutionalisation: embeddingHistory.some((entry) => Date.parse(regression.record.confirmedAt) > Date.parse(entry.record.reviewedAt)),
          requiresReview: !currentEmbedding.some((entry) => Date.parse(entry.record.reviewedAt) > Date.parse(regression.record.confirmedAt)) }] : [];
    });
    const uniqueRecurrence = [...new Map(recurrence.map((entry) => [`${entry.assessmentId}:${entry.regressionId}`, entry])).values()]
      .sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt) || a.regressionId.localeCompare(b.regressionId));
    const attentionReasons = unique([
      ...(active?.validity === "Contradicted" ? ["Contradiction affects current strategic learning guidance"] : []),
      ...(active?.validity === "Invalid / insufficient evidence" ? ["Learning conclusion has insufficient current evidence or broken references"] : []),
      ...(active?.validity === "Validated" && active.institutionalisation !== "Not required" && active.institutionalisation !== "Institutionalised"
        ? [`Validated learning: institutionalisation ${active.institutionalisation.toLowerCase()}`] : []),
      ...(uniqueRecurrence.some((entry) => entry.afterInstitutionalisation && entry.requiresReview) ? ["Confirmed recurrence after recorded institutionalisation; effectiveness requires review"] : []),
      ...(uniqueRecurrence.some((entry) => !entry.afterInstitutionalisation && entry.requiresReview) ? ["Explicitly linked learning has confirmed recurrence after validation"] : []),
    ]);
    const institutionalisation = uniqueRecurrence.some((entry) => entry.afterInstitutionalisation && entry.requiresReview)
      && active?.institutionalisation === "Institutionalised" ? "Verification due" : active?.institutionalisation;
    return {
      lessonId: lesson.id, title: lesson.lessonTitle || lesson.title, validity: active?.validity ?? "No explicit learning",
      institutionalisation, reviews, recurrence: uniqueRecurrence,
      assessmentIds: unique(records.flatMap((record) => record.evidence.map((ref) => ref.assessmentId))),
      attentionAssessmentIds: unique(records.flatMap((record) => record.evidence.map((ref) => ref.assessmentId)))
        .filter((id) => Boolean(one(input.assessments, (assessment) => assessment.id === id))),
      attentionReasons: input.lifecycle.hypothetical ? [] : attentionReasons,
      orphanedInstitutionalisationReviews: (lesson.icarusLearning?.institutionalisationReviews ?? [])
        .filter((record) => !records.some((entry) => entry.id === record.learningReviewId)),
    };
  });
  const attentionById = new Map<string, string[]>();
  lessons.forEach((lesson) => lesson.attentionAssessmentIds.forEach((id) => {
    if (lesson.attentionReasons.length && input.assessments.some((assessment) => assessment.id === id)) {
      attentionById.set(id, [...(attentionById.get(id) ?? []), ...lesson.attentionReasons.map((reason) => `${lesson.title}: ${reason}`)]);
    }
  }));
  const observedAssessmentIds = unique(input.assessments.filter((assessment) =>
    assessment.treatmentOutcomes?.length || input.lifecycle.byAssessmentId.get(assessment.id)?.regressions.some((entry) => entry.valid)).map((entry) => entry.id));
  return {
    lessons, byLessonId: new Map(lessons.map((entry) => [entry.lessonId, entry])), observedAssessmentIds,
    maturityByLessonId: new Map(lessons.filter((entry) => entry.reviews.length).map((entry) => [entry.lessonId, {
      validated: entry.validity === "Validated", institutionalised: entry.validity === "Validated" && entry.institutionalisation === "Institutionalised",
    }])),
    attention: [...attentionById].sort(([a], [b]) => a.localeCompare(b)).map(([id, reasons]) => ({
      assessmentId: id, title: input.assessments.find((entry) => entry.id === id)!.outcome,
      identityKey: getIcarusIdentityKey(id), reasons: unique(reasons),
    })),
  };
}

function requireWriter(input: IcarusLearningInput, lessonId: string, at: string, actor: string) {
  if (!one(input.lessons, (entry) => entry.id === lessonId)) throw new Error("Select an existing, unambiguous authoritative Lesson.");
  if (input.lifecycle.hypothetical) throw new Error("Hypothetical evidence cannot record organisational learning.");
  if (one(input.people, (entry) => entry.id === actor)?.status !== "Active") throw new Error("Select an unambiguous active reviewer Person.");
  if (Date.parse(at) !== input.nowMs) throw new Error("Use the current review clock; historical evidence must not be backdated.");
}
export function recordIcarusLearningReview(input: IcarusLearningInput, lessonId: string, record: IcarusLearningReview): IcarusLessonLearning {
  requireWriter(input, lessonId, record.reviewedAt, record.reviewedByPersonId);
  if (!review(record)) throw new Error("Learning review requires explicit conclusion, provenance, rationale and valid fields.");
  if (input.lessons.some((lesson) => lesson.icarusLearning?.reviews.some((entry) => entry.id === record.id))) throw new Error("Learning review identity already exists.");
  const issues = reviewIssues(input, lessonId, record);
  if (issues.length) throw new Error(issues.join("; "));
  const current = buildIcarusLearningIndex(input).byLessonId.get(lessonId);
  if (record.outcome === "Validated" && current?.reviews.some((view) =>
    view.record.outcome === "Contradicted" && view.validity === "Contradicted" && view.record.id !== record.supersedesReviewId)) {
    throw new Error("Re-adoption must explicitly supersede the outstanding contradiction review.");
  }
  if (record.supersedesReviewId && current?.reviews.find((view) => view.record.id === record.supersedesReviewId)?.validity === "Superseded") {
    throw new Error("Supersede the current learning episode, not an already superseded review.");
  }
  if (!record.evidence.every((ref) => evidenceState(input, ref).current)) throw new Error("Learning review requires current, authoritative supporting evidence.");
  const history = input.lessons.find((entry) => entry.id === lessonId)!.icarusLearning;
  return { reviews: [...(history?.reviews ?? []), record], institutionalisationReviews: [...(history?.institutionalisationReviews ?? [])] };
}
export function recordIcarusInstitutionalisationReview(input: IcarusLearningInput, lessonId: string, record: IcarusInstitutionalisationReview): IcarusLessonLearning {
  requireWriter(input, lessonId, record.reviewedAt, record.reviewedByPersonId);
  if (!institutionalReview(record)) throw new Error("Institutionalisation review requires valid identity, evidence, mechanism conditions and rationale.");
  if (input.lessons.some((lesson) => lesson.icarusLearning?.institutionalisationReviews.some((entry) => entry.id === record.id))) throw new Error("Institutionalisation review identity already exists.");
  const learning = buildIcarusLearningIndex(input).byLessonId.get(lessonId)?.reviews.find((view) => view.record.id === record.learningReviewId);
  if (learning?.validity !== "Validated" || learning.record.institutionalisation !== "Required") throw new Error("Verify institutionalisation only for current validated learning requiring it.");
  const issues = institutionalIssues(input, learning.record, record);
  if (issues.length) throw new Error(issues.join("; "));
  if (!record.evidence.length || !record.evidence.every((ref) => evidenceState(input, ref).current)) throw new Error("Verification requires explicit current evidence.");
  if (record.outcome === "Effective" && (!record.evidence.some((ref) => {
    const state = evidenceState(input, ref);
    return state.effectiveness && state.at && Date.parse(state.at) >= Date.parse(learning.record.reviewedAt);
  }) || record.mechanismConditions.some((condition) => {
    const source = one(input.mechanisms, (entry) => getIcarusReferenceKey(entry) === getIcarusReferenceKey(condition.reference));
    return !source || !implemented(source) || source.status !== condition.status || source.revision !== condition.revision;
  }))) throw new Error("Effective embedding requires implemented mechanisms and subsequent current protection/treatment evidence.");
  const history = input.lessons.find((entry) => entry.id === lessonId)!.icarusLearning!;
  return { reviews: [...history.reviews], institutionalisationReviews: [...history.institutionalisationReviews, record] };
}
