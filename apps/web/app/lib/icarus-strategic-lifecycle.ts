import {
  classifyIcarusEvidenceFreshness,
  getIcarusControlTestDueAt,
  getIcarusReferenceKey,
  isIcarusConfirmedRegression,
  isIcarusStrategicResolutionReview,
  type IcarusAssessmentRecord,
  type IcarusConfirmedRegression,
  type IcarusResolutionControlCondition,
  type IcarusResolutionScope,
  type IcarusStrategicResolutionReview,
} from "./icarus";
import type { IcarusAssuranceResult } from "./icarus-assurance";
import type { IcarusDependencyHealthRegistry } from "./icarus-dependency-health";
import { getIcarusEffectiveProtection, getIcarusRequiredDependencies } from "./icarus-effective-protection";
import type { IcarusTreatmentIndex } from "./icarus-treatment";
import type { IcarusStrategicSignal } from "./icarus-strategic-attention";

export type IcarusResolutionValidity = "Current" | "Review due" | "Assurance weakened" | "Not verified"
  | "Material regression suspected" | "Material regression confirmed" | "Superseded" | "Invalid";
export type IcarusResolutionEligibility = {
  state: "Eligible for human review" | "Insufficient evidence" | "Blocked";
  scope: IcarusResolutionScope;
  reasons: readonly string[];
  controlConditions: readonly IcarusResolutionControlCondition[];
  treatmentOutcomeIds: readonly string[];
};
export type IcarusResolutionReviewView = {
  record: IcarusStrategicResolutionReview;
  validity: IcarusResolutionValidity;
  reasons: readonly string[];
  materialFailureModeIds: readonly string[];
  observationKeys: readonly string[];
};
export type IcarusRegressionView = {
  record: IcarusConfirmedRegression;
  valid: boolean;
  issues: readonly string[];
  reResolutionReviewId?: string;
};
export type IcarusLifecycleAssessmentView = {
  assessmentId: string;
  recordedResolution: boolean;
  reviews: readonly IcarusResolutionReviewView[];
  regressions: readonly IcarusRegressionView[];
  eligibility: IcarusResolutionEligibility;
  attentionReasons: readonly string[];
};
export type IcarusStrategicLifecycleIndex = {
  byAssessmentId: ReadonlyMap<string, IcarusLifecycleAssessmentView>;
  hypothetical: boolean;
};
export type IcarusStrategicLifecycleInput = {
  assessments: readonly IcarusAssessmentRecord[];
  assurance: IcarusAssuranceResult;
  dependencyHealth: IcarusDependencyHealthRegistry;
  treatment: IcarusTreatmentIndex;
  signals: readonly IcarusStrategicSignal[];
  people: readonly { id: string; status: string }[];
  nowMs: number;
  hypothetical?: boolean;
  significantAssessmentIds?: ReadonlySet<string>;
};

const sorted = (values: readonly string[]) => [...new Set(values)].sort();
const same = (a: readonly string[], b: readonly string[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const within = (scope: IcarusResolutionScope, modeId: string) => scope.kind === "Whole assessment" || scope.failureModeIds.includes(modeId);
function duplicateIds(records: readonly { id: string }[]) {
  return new Set(records.filter((record, index) => records.findIndex((other) => other.id === record.id) !== index).map((record) => record.id));
}
function dateDue(value: string | undefined, nowMs: number) {
  return Boolean(value && Date.parse(value.length === 10 ? `${value}T23:59:59.999Z` : value) < nowMs);
}
function hypothetical(input: IcarusStrategicLifecycleInput) {
  return Boolean(input.hypothetical || [...input.dependencyHealth.values()].some((entry) => entry.source === "Scenario override"));
}
function scopeIssues(assessment: IcarusAssessmentRecord, scope: IcarusResolutionScope): string[] {
  return [
    ...(!scope.failureModeIds.length ? ["Resolution scope is empty"] : []),
    ...(new Set(scope.failureModeIds).size !== scope.failureModeIds.length ? ["Ambiguous repeated scope identity"] : []),
    ...(duplicateIds(assessment.failureModes).size ? ["Ambiguous failure-mode identities"] : []),
    ...(duplicateIds(assessment.controls).size ? ["Ambiguous control identities"] : []),
    ...scope.failureModeIds.filter((id) => !assessment.failureModes.some((mode) => mode.id === id))
      .map((id) => `Missing scoped failure mode: ${id}`),
  ];
}
function currentTreatment(input: IcarusStrategicLifecycleInput, id: string) {
  const matches = [...input.treatment.verification.values()].flatMap((view) => view.history)
    .filter((entry) => entry.record.id === id);
  return matches.length === 1 ? matches[0] : undefined;
}
function conditionCurrent(
  assessment: IcarusAssessmentRecord,
  condition: IcarusResolutionControlCondition,
  input: IcarusStrategicLifecycleInput,
): boolean {
  const control = assessment.controls.find((entry) => entry.id === condition.controlId && entry.failureModeId === condition.failureModeId);
  const assurance = input.assurance.byAssessmentId.get(assessment.id)?.controls.find((entry) => entry.controlId === condition.controlId);
  const event = assurance?.lastEvent;
  const mode = assessment.failureModes.find((entry) => entry.id === condition.failureModeId);
  const cited = mode?.evidence.filter((evidence) => condition.evidenceIds.includes(evidence.id)) ?? [];
  return Boolean(control && assurance?.status === "Assured" && assurance.evidence === "Current support"
    && event?.source === "Control test" && event.testId === condition.testId && event.result === "Passed"
    && same(event.evidenceIds, condition.evidenceIds)
    && Date.parse(event.at) <= input.nowMs && !dateDue(control.nextReviewAt, input.nowMs)
    && (getIcarusControlTestDueAt(control) === undefined || getIcarusControlTestDueAt(control)! >= input.nowMs)
    && !duplicateIds(control.assuranceTests ?? []).has(condition.testId)
    && !duplicateIds(mode?.evidence ?? []).size
    && cited.length === condition.evidenceIds.length && cited.some((evidence) => evidence.review === "Supports")
    && cited.every((evidence) => Date.parse(evidence.recordedAt) <= input.nowMs
      && (!evidence.observedAt || Date.parse(evidence.observedAt) <= input.nowMs)
      && (!evidence.reviewedAt || Date.parse(evidence.reviewedAt) <= input.nowMs))
    && !cited.some((evidence) => evidence.review === "Contradicts" || ["Stale", "Invalid"].includes(classifyIcarusEvidenceFreshness(evidence, input.nowMs)))
    && same(getIcarusRequiredDependencies(control).map(getIcarusReferenceKey), condition.requiredDependencies.map(getIcarusReferenceKey))
    && getIcarusEffectiveProtection(control, assurance.status, input.dependencyHealth).barrier === "Active");
}

// Eligibility requires positive, current protection for every explicit mode. No category alone resolves a risk.
export function deriveIcarusResolutionEligibility(
  input: IcarusStrategicLifecycleInput,
  assessmentId: string,
  scope: IcarusResolutionScope,
): IcarusResolutionEligibility {
  const assessment = input.assessments.find((entry) => entry.id === assessmentId);
  if (!assessment) return { state: "Insufficient evidence", scope, reasons: ["Assessment is missing"], controlConditions: [], treatmentOutcomeIds: [] };
  const assurance = input.assurance.byAssessmentId.get(assessmentId);
  const modes = assessment.failureModes.filter((mode) => within(scope, mode.id));
  const reasons = scopeIssues(assessment, scope);
  if (duplicateIds(input.assessments).has(assessmentId)) reasons.push("Ambiguous assessment identity");
  if (scope.kind === "Whole assessment" && !same(scope.failureModeIds, assessment.failureModes.map((mode) => mode.id))) {
    reasons.push("Whole-assessment scope must name every current failure mode");
  }
  if (hypothetical(input)) reasons.push("Hypothetical evidence cannot establish a real resolution");
  const materialModes = input.signals.filter((signal) => signal.assessmentId === assessmentId)
    .flatMap((signal) => signal.materialFailureModes.filter((mode) =>
      within(scope, mode.failureModeId) && (mode.exposure === "Exposed" || mode.exposure === "Failing control")));
  const accepted = assurance?.acceptances.some((acceptance) => acceptance.current && acceptance.validity === "Active"
    && acceptance.failureModeIds.some((id) => within(scope, id)));
  const contradictory = modes.some((mode) => mode.evidence.some((evidence) => evidence.review === "Contradicts"
    && !["Stale", "Invalid"].includes(classifyIcarusEvidenceFreshness(evidence, input.nowMs))));
  const blocked = materialModes.length > 0 || Boolean(accepted) || contradictory;
  if (materialModes.length) reasons.push("Current material exposure remains inside the resolution scope");
  if (accepted) reasons.push("Accepted exposure is tolerated risk, not verified resolution");
  if (contradictory) reasons.push("Current contradictory evidence requires review before resolution");
  const controlConditions: IcarusResolutionControlCondition[] = [];
  modes.forEach((mode) => {
    assessment.controls.filter((control) => control.failureModeId === mode.id).forEach((control) => {
      const status = assurance?.controls.find((entry) => entry.controlId === control.id);
      const event = status?.lastEvent;
      if (status?.status !== "Assured" || status.evidence !== "Current support" || event?.source !== "Control test"
        || event.result !== "Passed" || !event.testId || Date.parse(event.at) > input.nowMs
        || !event.evidenceIds.length || getIcarusEffectiveProtection(control, status.status, input.dependencyHealth).barrier !== "Active") return;
      const condition: IcarusResolutionControlCondition = {
        failureModeId: mode.id, controlId: control.id, testId: event.testId,
        evidenceIds: sorted(event.evidenceIds), requiredDependencies: getIcarusRequiredDependencies(control),
      };
      if (conditionCurrent(assessment, condition, input)) controlConditions.push(condition);
    });
    if (!controlConditions.some((condition) => condition.failureModeId === mode.id)) {
      reasons.push(`No positive current effective protection for failure mode: ${mode.id}`);
    }
  });
  const relevantTargets = input.treatment.targets.filter((target) => target.assessmentId === assessmentId
    && (!target.failureModeId || within(scope, target.failureModeId)));
  const treatmentOutcomeIds: string[] = [];
  relevantTargets.forEach((target) => {
    const verification = input.treatment.verification.get(target.id);
    const current = verification?.history.find((entry) => entry.current && entry.record.outcome === "Effective"
      && entry.record.assessmentId === assessmentId && Date.parse(entry.record.verifiedAt) <= input.nowMs
      && currentTreatment(input, entry.record.id)?.current);
    if (current) treatmentOutcomeIds.push(current.record.id);
    else if (target.executionLinks.length || target.material) reasons.push(`Treatment is not currently verified effective: ${target.id}`);
  });
  return {
    state: blocked ? "Blocked" : reasons.length ? "Insufficient evidence" : "Eligible for human review",
    scope, reasons: sorted(reasons),
    controlConditions: controlConditions.sort((a, b) => a.controlId.localeCompare(b.controlId)),
    treatmentOutcomeIds: sorted(treatmentOutcomeIds),
  };
}

function reviewIssues(assessment: IcarusAssessmentRecord, record: IcarusStrategicResolutionReview, input: IcarusStrategicLifecycleInput) {
  const reviews = assessment.strategicResolutionReviews ?? [];
  const regression = assessment.confirmedRegressions?.find((entry) => entry.id === record.resolvesRegressionId);
  const predecessor = reviews.find((entry) => entry.id === record.supersedesReviewId);
  const issues = [
    ...scopeIssues(assessment, record.scope),
    ...(duplicateIds(input.assessments).has(assessment.id) ? ["Ambiguous assessment identity"] : []),
    ...(record.assessmentId !== assessment.id ? ["Review belongs to a different assessment"] : []),
    ...(duplicateIds(input.assessments.flatMap((entry) => entry.strategicResolutionReviews ?? [])).has(record.id)
      ? ["Ambiguous resolution review identity"] : []),
    ...(Date.parse(record.reviewedAt) < Date.parse(assessment.createdAt) || Date.parse(record.reviewedAt) > input.nowMs
      ? ["Invalid resolution review chronology"] : []),
    ...(record.nextReviewBy && Date.parse(record.nextReviewBy.length === 10 ? `${record.nextReviewBy}T23:59:59.999Z` : record.nextReviewBy)
      < Date.parse(record.reviewedAt) ? ["Review deadline precedes review"] : []),
    ...(record.supersedesReviewId && (!predecessor || predecessor.id === record.id
      || Date.parse(predecessor.reviewedAt) >= Date.parse(record.reviewedAt)
      || (predecessor.scope.kind === "Whole assessment" && record.scope.kind !== "Whole assessment")
      || predecessor.scope.failureModeIds.some((id) => !record.scope.failureModeIds.includes(id)))
      ? ["Invalid superseded review reference or scope"] : []),
    ...(record.resolvesRegressionId && (!regression || Date.parse(regression.confirmedAt) >= Date.parse(record.reviewedAt)
      || record.supersedesReviewId !== regression.resolutionReviewId
      || regression.scope.failureModeIds.some((id) => !within(record.scope, id)))
      ? ["Re-resolution must explicitly supersede its originating review and cover the regression scope"] : []),
    ...record.causeIds.filter((id) => assessment.causes?.filter((cause) => cause.id === id).length !== 1).map((id) => `Missing or ambiguous explicit cause: ${id}`),
  ];
  if (record.outcome === "Verified resolved") {
    record.scope.failureModeIds.forEach((modeId) => {
      if (!record.controlConditions.some((condition) => condition.failureModeId === modeId)) issues.push(`No reviewed protection condition for: ${modeId}`);
    });
    record.controlConditions.forEach((condition) => {
      const control = assessment.controls.find((entry) => entry.id === condition.controlId && entry.failureModeId === condition.failureModeId);
      const test = control?.assuranceTests?.find((entry) => entry.id === condition.testId);
      if (!control || !test || duplicateIds(control.assuranceTests ?? []).has(condition.testId)
        || test.result !== "Passed" || Date.parse(test.testedAt) > Date.parse(record.reviewedAt)
        || !same(test.evidenceIds, condition.evidenceIds) || !record.scope.failureModeIds.includes(condition.failureModeId)) {
        issues.push(`Broken historical control-test reference: ${condition.controlId}/${condition.testId}`);
      }
    });
    record.treatmentOutcomeIds.forEach((id) => {
      const outcome = assessment.treatmentOutcomes?.find((entry) => entry.id === id);
      if (!outcome || outcome.assessmentId !== assessment.id || duplicateIds(assessment.treatmentOutcomes ?? []).has(id)
        || outcome.outcome !== "Effective" || Date.parse(outcome.verifiedAt) > Date.parse(record.reviewedAt)) {
        issues.push(`Broken historical treatment outcome reference: ${id}`);
      }
    });
  }
  return sorted(issues);
}

function observations(assessment: IcarusAssessmentRecord, scope: IcarusResolutionScope, input: IcarusStrategicLifecycleInput) {
  const assurance = input.assurance.byAssessmentId.get(assessment.id);
  const modes = input.signals.filter((signal) => signal.assessmentId === assessment.id)
    .flatMap((signal) => signal.materialFailureModes.filter((mode) => within(scope, mode.failureModeId)));
  let materialFailureModeIds = sorted(modes.filter((mode) =>
    mode.exposure === "Exposed" || mode.exposure === "Failing control").map((mode) => mode.failureModeId));
  const degradedModeIds: string[] = [];
  const observationKeys: string[] = [];
  assessment.failureModes.filter((mode) => within(scope, mode.id)).forEach((mode) => {
    const controls = assessment.controls.filter((control) => control.failureModeId === mode.id);
    const protection = controls.map((control) => {
      const status = assurance?.controls.find((entry) => entry.controlId === control.id);
      return { control, status, protection: getIcarusEffectiveProtection(control, status?.status ?? "Untested", input.dependencyHealth) };
    });
    const held = protection.some((entry) => entry.protection.barrier === "Active");
    if (held) materialFailureModeIds = materialFailureModeIds.filter((id) => id !== mode.id);
    if (!held && protection.some((entry) => entry.protection.dependencies.some((dependency) => dependency.health === "Degraded"))) {
      degradedModeIds.push(mode.id);
    }

    if (!held && (materialFailureModeIds.includes(mode.id) || degradedModeIds.includes(mode.id))) {
      observationKeys.push(JSON.stringify(["Failure mode", assessment.id, mode.id, modes.find((entry) => entry.failureModeId === mode.id)?.exposure ?? "Protection impaired"]));
      mode.evidence.filter((evidence) => evidence.review === "Supports"
        && !["Stale", "Invalid"].includes(classifyIcarusEvidenceFreshness(evidence, input.nowMs)))
        .forEach((evidence) => observationKeys.push(JSON.stringify(["Evidence", assessment.id, mode.id, evidence.id, evidence.reviewedAt])));
      protection.forEach(({ control, status, protection: effective }) => {
        observationKeys.push(JSON.stringify(["Control", assessment.id, mode.id, control.id, status?.lastEvent?.testId,
          status?.lastEvent?.at, status?.status, effective.barrier]));
        effective.dependencies.forEach((dependency) => observationKeys.push(JSON.stringify(["Dependency",
          getIcarusReferenceKey(dependency.reference), dependency.health, dependency.source, sorted(dependency.basis)])));
      });
    }
  });
  return { materialFailureModeIds, degradedModeIds: sorted(degradedModeIds), observationKeys: sorted(observationKeys) };
}

export function deriveIcarusRegressionEvidence(input: IcarusStrategicLifecycleInput, assessmentId: string, scope: IcarusResolutionScope) {
  const assessment = input.assessments.find((entry) => entry.id === assessmentId);
  if (!assessment) throw new Error("Regression assessment is missing.");
  return observations(assessment, scope, input);
}

export function buildIcarusStrategicLifecycleIndex(input: IcarusStrategicLifecycleInput): IcarusStrategicLifecycleIndex {
  const byAssessmentId = new Map<string, IcarusLifecycleAssessmentView>();
  const simulated = hypothetical(input);
  input.assessments.forEach((assessment) => {
    const records = [...(assessment.strategicResolutionReviews ?? [])]
      .sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || a.id.localeCompare(b.id));
    const reviewProblems = new Map(records.map((record) => [record.id, reviewIssues(assessment, record, input)]));
    const regressions: IcarusRegressionView[] = [...(assessment.confirmedRegressions ?? [])]
      .sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt) || a.id.localeCompare(b.id))
      .map((record) => {
        const review = records.find((entry) => entry.id === record.resolutionReviewId && entry.outcome === "Verified resolved");
        const issues = [
          ...scopeIssues(assessment, record.scope),
          ...(record.assessmentId !== assessment.id ? ["Regression belongs to a different assessment"] : []),
          ...(!review || reviewProblems.get(review.id)?.length ? ["Originating verified resolution is missing or structurally invalid"] : []),
          ...(duplicateIds(input.assessments.flatMap((entry) => entry.confirmedRegressions ?? [])).has(record.id)
            ? ["Ambiguous regression identity"] : []),
          ...((assessment.confirmedRegressions ?? []).some((other) => other.id !== record.id
            && other.resolutionReviewId === record.resolutionReviewId && same(other.evidenceKeys, record.evidenceKeys))
            ? ["Repeated confirmation of the same observation"] : []),
          ...(!review || Date.parse(record.confirmedAt) <= Date.parse(review.reviewedAt) || Date.parse(record.confirmedAt) > input.nowMs
            ? ["Invalid regression chronology"] : []),
          ...(review && record.scope.failureModeIds.some((id) => !within(review.scope, id)) ? ["Regression is outside reviewed scope"] : []),
          ...record.causeIds.filter((id) => !assessment.causes?.some((cause) => cause.id === id)).map((id) => `Missing explicit cause: ${id}`),
        ];
        const reResolution = records.find((entry) => entry.resolvesRegressionId === record.id
          && entry.outcome === "Verified resolved" && !reviewProblems.get(entry.id)?.length);
        return { record, valid: !issues.length, issues: sorted(issues), ...(reResolution ? { reResolutionReviewId: reResolution.id } : {}) };
      });
    const reviews: IcarusResolutionReviewView[] = records.map((record) => {
      const reasons = [...(reviewProblems.get(record.id) ?? [])];
      const currentObservation = observations(assessment, record.scope, input);
      let validity: IcarusResolutionValidity = "Current";
      if (reasons.length) validity = "Invalid";
      else if (record.outcome !== "Verified resolved") validity = "Not verified";
      else if (records.some((entry) => entry.supersedesReviewId === record.id && entry.outcome === "Verified resolved"
        && !reviewProblems.get(entry.id)?.length)) validity = "Superseded";
      else {
        const confirmed = regressions.some((entry) => entry.valid && entry.record.resolutionReviewId === record.id && !entry.reResolutionReviewId);
        const conditionModes = record.scope.kind === "Whole assessment" ? assessment.failureModes.map((mode) => mode.id) : record.scope.failureModeIds;
        conditionModes.forEach((id) => {
          if (!record.controlConditions.some((condition) => condition.failureModeId === id && conditionCurrent(assessment, condition, input))) {
            reasons.push(`Reviewed effective protection is no longer established: ${id}`);
          }
        });
        record.treatmentOutcomeIds.forEach((id) => {
          const outcome = currentTreatment(input, id);
          if (!(outcome?.evidenceCurrent ?? outcome?.current)) reasons.push(`Supporting treatment evidence is no longer current: ${id}`);
        });
        const accepted = input.assurance.byAssessmentId.get(assessment.id)?.acceptances.some((entry) =>
          entry.current && entry.validity === "Active" && entry.failureModeIds.some((id) => within(record.scope, id)));
        if (accepted) reasons.push("Scope now includes accepted exposure, not verified protection");
        if (assessment.failureModes.filter((mode) => within(record.scope, mode.id)).some((mode) => mode.evidence.some((evidence) =>
          evidence.review === "Contradicts" && !["Stale", "Invalid"].includes(classifyIcarusEvidenceFreshness(evidence, input.nowMs))))) {
          reasons.push("Current contradictory evidence requires scoped review");
        }
        if (simulated) {
          reasons.push("Hypothetical surveillance is not authoritative lifecycle evidence");
          validity = "Assurance weakened";
        } else if (confirmed) validity = "Material regression confirmed";
        else if (currentObservation.materialFailureModeIds.length || currentObservation.degradedModeIds.length) {
          validity = "Material regression suspected";
          reasons.push("Current exposure or uncontained degradation requires human review; no causal conclusion");
        } else if (reasons.length) validity = "Assurance weakened";
        else if (dateDue(record.nextReviewBy, input.nowMs)) {
          validity = "Review due";
          reasons.push("Explicit strategic resolution review deadline is overdue");
        }
      }
      return { record, validity, reasons: sorted(reasons),
        materialFailureModeIds: simulated ? [] : currentObservation.materialFailureModeIds,
        observationKeys: simulated ? [] : currentObservation.observationKeys };
    });
    const significant = input.significantAssessmentIds?.has(assessment.id) || input.signals.some((signal) => signal.assessmentId === assessment.id
      && (signal.materialityTier === "Material" || signal.objectiveImportance === "Critical"));
    const attentionReasons = simulated ? [] : reviews.flatMap((view) => {
      if (view.validity === "Material regression confirmed") return [`Confirmed material regression of verified resolution ${view.record.id}`];
      if (view.validity === "Material regression suspected" && (view.materialFailureModeIds.length || significant)) {
        return [`Suspected material regression of verified resolution ${view.record.id}; human review required`];
      }
      if (significant && (view.validity === "Assurance weakened" || view.validity === "Review due")) {
        return [`Verified resolution ${view.record.id}: ${view.validity.toLowerCase()}`];
      }
      if (significant && view.validity === "Invalid" && view.record.outcome === "Verified resolved") {
        return [`Recorded resolution ${view.record.id} has invalid references; current assurance requires review`];
      }
      return [];
    });
    byAssessmentId.set(assessment.id, {
      assessmentId: assessment.id,
      recordedResolution: records.some((record) => record.outcome === "Verified resolved" && !reviewProblems.get(record.id)?.length),
      reviews, regressions,
      eligibility: deriveIcarusResolutionEligibility(input, assessment.id, { kind: "Whole assessment", failureModeIds: assessment.failureModes.map((mode) => mode.id) }),
      attentionReasons: sorted(attentionReasons),
    });
  });
  return { byAssessmentId, hypothetical: simulated };
}

function requireActor(input: IcarusStrategicLifecycleInput, personId: string, at: string) {
  const actors = input.people.filter((person) => person.id === personId);
  if (actors.length !== 1 || actors[0].status !== "Active") throw new Error("Select one unambiguous active Person to record lifecycle verification.");
  if (!Number.isFinite(Date.parse(at)) || Date.parse(at) !== input.nowMs) throw new Error("New lifecycle verification must use the current review clock, not backdated or future evidence.");
  if (hypothetical(input)) throw new Error("Hypothetical evidence cannot be persisted as a real lifecycle event.");
}

// Explicit write boundaries return new assessment arrays. Derivation never calls these helpers.
export function recordIcarusResolutionReview(
  input: IcarusStrategicLifecycleInput,
  record: IcarusStrategicResolutionReview,
): IcarusAssessmentRecord[] {
  requireActor(input, record.reviewedByPersonId, record.reviewedAt);
  if (!isIcarusStrategicResolutionReview(record)) throw new Error("Resolution review requires valid identity, scope, evidence and rationale.");
  const assessment = input.assessments.find((entry) => entry.id === record.assessmentId);
  if (!assessment) throw new Error("Resolution assessment is missing.");
  if (input.assessments.some((entry) => entry.strategicResolutionReviews?.some((review) => review.id === record.id))) throw new Error("Resolution review identity already exists.");
  const issues = reviewIssues(assessment, record, input);
  if (issues.length) throw new Error(issues.join("; "));
  if (record.outcome === "Verified resolved") {
    const previousView = record.supersedesReviewId
      ? buildIcarusStrategicLifecycleIndex(input).byAssessmentId.get(record.assessmentId)?.reviews
        .find((entry) => entry.record.id === record.supersedesReviewId) : undefined;
    if (previousView?.validity === "Superseded") throw new Error("Supersede the current episode, not an already superseded review.");
    const eligibility = deriveIcarusResolutionEligibility(input, record.assessmentId, record.scope);
    if (eligibility.state !== "Eligible for human review") throw new Error(eligibility.reasons.join("; "));
    if (!record.scope.failureModeIds.every((id) => record.controlConditions.some((condition) => condition.failureModeId === id
      && conditionCurrent(assessment, condition, input)))) throw new Error("Every scoped failure mode requires explicit current evidence-backed protection.");
    if (record.controlConditions.some((condition) => !conditionCurrent(assessment, condition, input))
      || record.treatmentOutcomeIds.some((id) => !currentTreatment(input, id)?.current)) throw new Error("Review references non-current evidence.");
    if (!same(record.treatmentOutcomeIds, eligibility.treatmentOutcomeIds)) throw new Error("Review must retain the relevant current treatment occurrence references.");
    if (record.resolvesRegressionId) {
      const regression = buildIcarusStrategicLifecycleIndex(input).byAssessmentId.get(record.assessmentId)?.regressions
        .find((entry) => entry.record.id === record.resolvesRegressionId);
      if (!regression?.valid || regression.reResolutionReviewId) throw new Error("Re-resolution must reference an unresolved valid confirmed regression.");
    }
  }
  return input.assessments.map((entry) => entry.id !== record.assessmentId ? entry : {
    ...entry, updatedAt: record.reviewedAt, strategicResolutionReviews: [...(entry.strategicResolutionReviews ?? []), record],
  });
}

export function recordIcarusConfirmedRegression(
  input: IcarusStrategicLifecycleInput,
  record: IcarusConfirmedRegression,
): IcarusAssessmentRecord[] {
  requireActor(input, record.confirmedByPersonId, record.confirmedAt);
  if (!isIcarusConfirmedRegression(record)) throw new Error("Confirmed regression requires explicit scope, current evidence and rationale.");
  const assessment = input.assessments.find((entry) => entry.id === record.assessmentId);
  const index = buildIcarusStrategicLifecycleIndex(input);
  const view = index.byAssessmentId.get(record.assessmentId)?.reviews.find((entry) => entry.record.id === record.resolutionReviewId);
  if (!assessment || !view || view.validity !== "Material regression suspected") throw new Error("Confirm only a current, scoped material regression concern.");
  if (Date.parse(record.confirmedAt) <= Date.parse(view.record.reviewedAt)) throw new Error("Regression confirmation must follow its originating resolution.");
  const currentObservation = observations(assessment, record.scope, input);
  if (scopeIssues(assessment, record.scope).length || (record.scope.kind === "Whole assessment"
    && !same(record.scope.failureModeIds, assessment.failureModes.map((mode) => mode.id)))
    || record.scope.failureModeIds.some((id) => !view.materialFailureModeIds.includes(id))
    || !same(record.evidenceKeys, currentObservation.observationKeys)) throw new Error("Confirmation must reference current material exposure inside the reviewed scope.");
  if (record.causeIds.some((id) => !assessment.causes?.some((cause) => cause.id === id))) throw new Error("Cause identity must be explicitly recorded, never inferred.");
  if (input.assessments.some((entry) => entry.confirmedRegressions?.some((regression) => regression.id === record.id
    || (regression.resolutionReviewId === record.resolutionReviewId && same(regression.evidenceKeys, record.evidenceKeys))))) {
    throw new Error("This regression identity or observation has already been confirmed.");
  }
  return input.assessments.map((entry) => entry.id !== record.assessmentId ? entry : {
    ...entry, updatedAt: record.confirmedAt, confirmedRegressions: [...(entry.confirmedRegressions ?? []), record],
  });
}
