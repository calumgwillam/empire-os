import type { IcarusAssessmentRecord, IcarusObservationPlan, IcarusTreatmentOutcomeEvidence, IcarusTreatmentOutcomeRecord } from "./icarus";
import type { IcarusTreatmentTarget } from "./icarus-treatment";
import { isValidCalendarDateInput } from "./dates";

export type IcarusObservationResponsibility = {
  state: "Missing" | "Unowned" | "Invalid" | "Scheduled" | "Due" | "Overdue" | "Completed";
  plan?: IcarusObservationPlan;
  nextReviewBy?: string;
  lastOutcomeId?: string;
  issues: readonly string[];
};

export function getIcarusObservationDeadline(value: string): number {
  return isValidCalendarDateInput(value.slice(0, 10))
    ? Date.parse(value.length === 10 ? `${value}T23:59:59.999Z` : value) : NaN;
}

export function getIcarusCurrentObservationPlan(target: IcarusTreatmentTarget): IcarusObservationPlan | undefined {
  return [...(target.observationPlans ?? [])].sort((a, b) =>
    a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id)).at(-1);
}

export function sameIcarusObservationPlan(left: IcarusObservationPlan, right: IcarusObservationPlan): boolean {
  const values = (plan: IcarusObservationPlan) => [
    plan.id, plan.recordedAt, plan.recordedByPersonId, plan.ownerPersonId, plan.protection,
    [...plan.controlIds].sort(), plan.evidenceRequirements, plan.acceptanceCriteria, plan.firstReviewBy,
    plan.handoffFromPlanId, plan.handoffId,
  ];
  return JSON.stringify(values(left)) === JSON.stringify(values(right));
}

export function getIcarusObservationPlanIssues(
  target: IcarusTreatmentTarget,
  plan: IcarusObservationPlan,
  assessments: readonly IcarusAssessmentRecord[],
  people: readonly { id: string; status: string }[],
  nowMs: number,
): string[] {
  const issues: string[] = [];
  const records = assessments.filter((record) => record.id === target.assessmentId);
  if (records.length !== 1) issues.push("Observation assessment is missing or ambiguous");
  if (!Number.isFinite(Date.parse(plan.recordedAt)) || !isValidCalendarDateInput(plan.recordedAt.slice(0, 10))
    || Date.parse(plan.recordedAt) > nowMs) issues.push("Observation plan chronology is invalid");
  if (!plan.id.trim() || (target.observationPlans ?? []).filter((entry) => entry.id === plan.id).length !== 1
    || (target.observationPlans ?? []).filter((entry) => entry.recordedAt === plan.recordedAt).length !== 1) {
    issues.push("Observation plan identity or revision chronology is ambiguous");
  }
  if (!plan.recordedByPersonId.trim() || people.filter((person) => person.id === plan.recordedByPersonId).length !== 1) {
    issues.push("Observation plan author is missing or ambiguous");
  }
  const owners = people.filter((person) => person.id === plan.ownerPersonId);
  if (owners.length !== 1 || owners[0].status !== "Active") issues.push("Observation has no unique active accountable Person");
  if (!plan.protection.trim() || !plan.evidenceRequirements.trim() || !plan.acceptanceCriteria.trim()) {
    issues.push("Protection, acceptable evidence and acceptance criteria must be explicit");
  }
  if (!plan.controlIds.length || new Set(plan.controlIds).size !== plan.controlIds.length) issues.push("Observation control scope is empty or ambiguous");
  plan.controlIds.forEach((id) => {
    const controls = records[0]?.controls.filter((control) => control.id === id) ?? [];
    if (controls.length !== 1 || (target.failureModeId && controls[0].failureModeId !== target.failureModeId)
      || (target.controlId && id !== target.controlId)) issues.push(`Observation control is missing, ambiguous or outside treatment scope: ${id}`);
  });
  const predecessors = (target.observationPlans ?? []).filter((entry) => entry.id === plan.handoffFromPlanId);
  const previous = predecessors[0];
  const carriedDeadline = Boolean(plan.handoffId && predecessors.length === 1 && previous
    && Date.parse(previous.recordedAt) < Date.parse(plan.recordedAt)
    && previous.protection === plan.protection && previous.evidenceRequirements === plan.evidenceRequirements
    && previous.acceptanceCriteria === plan.acceptanceCriteria
    && JSON.stringify([...previous.controlIds].sort()) === JSON.stringify([...plan.controlIds].sort()));
  if ((plan.handoffId || plan.handoffFromPlanId) && !carriedDeadline) issues.push("Observation handoff revision does not preserve its predecessor scope and evidence obligations");
  if (!Number.isFinite(getIcarusObservationDeadline(plan.firstReviewBy))
    || !carriedDeadline && getIcarusObservationDeadline(plan.firstReviewBy) < Date.parse(plan.recordedAt)) {
    issues.push("First observation deadline is missing, invalid or precedes the plan");
  }
  return [...new Set(issues)].sort();
}

export function getIcarusPlannedObservationIssues(
  target: IcarusTreatmentTarget,
  plan: IcarusObservationPlan,
  record: IcarusTreatmentOutcomeRecord,
  previous: IcarusTreatmentOutcomeRecord | undefined,
  assessments: readonly IcarusAssessmentRecord[],
  people: readonly { id: string; status: string }[],
  nowMs: number,
): string[] {
  const issues = getIcarusObservationPlanIssues(target, plan, assessments, people, nowMs);
  if (!record.observationPlan || !sameIcarusObservationPlan(record.observationPlan, plan)) issues.push("Verification does not retain the current observation plan");
  if (Date.parse(record.verifiedAt) < Date.parse(plan.recordedAt)) issues.push("Observation verification precedes its plan");
  if (people.filter((person) => person.id === record.verifiedByPersonId && person.status === "Active").length !== 1) {
    issues.push("Observation verifier is not a unique active Person");
  }
  if (!record.observationCriteriaNote?.trim() || !record.observationCriteriaResult) issues.push("Observation criteria review is missing");
  if (record.outcome === "Effective" && record.observationCriteriaResult !== "Met") issues.push("Effectiveness requires evidence-supported acceptance criteria");
  if (!Number.isFinite(Date.parse(record.verifiedAt)) || Date.parse(record.verifiedAt) > nowMs) {
    issues.push("Observation verification date is invalid or in the future");
  }
  if (!record.nextObservationBy || !Number.isFinite(getIcarusObservationDeadline(record.nextObservationBy))
    || getIcarusObservationDeadline(record.nextObservationBy) < Date.parse(record.verifiedAt)) {
    issues.push("Planned observation requires a valid next review date");
  }
  issues.push(...getIcarusObservationEvidenceIssues(target, plan, record.evidence, previous, assessments));
  return [...new Set(issues)].sort();
}

export function getIcarusObservationEvidenceIssues(
  target: IcarusTreatmentTarget,
  plan: IcarusObservationPlan,
  evidence: readonly IcarusTreatmentOutcomeEvidence[],
  previous: IcarusTreatmentOutcomeRecord | undefined,
  assessments: readonly IcarusAssessmentRecord[],
): string[] {
  const issues: string[] = [];
  const tests = evidence.filter((entry) => entry.kind === "Control test");
  if (tests.some((test) => !plan.controlIds.includes(test.controlId) || test.assessmentId !== target.assessmentId)
    || plan.controlIds.some((id) => tests.filter((test) => test.controlId === id).length !== 1)) {
    issues.push("Observation must cite exactly one test for every planned control");
  }
  const lowerBound = Math.max(Date.parse(plan.recordedAt), previous ? Date.parse(previous.verifiedAt) + 1 : -Infinity);
  tests.forEach((entry) => {
    const assessment = assessments.find((assessment) => assessment.id === entry.assessmentId);
    const control = assessment?.controls.find((control) => control.id === entry.controlId);
    const test = control?.assuranceTests?.find((test) => test.id === entry.testId);
    if (!test || !Number.isFinite(Date.parse(test.testedAt)) || Date.parse(test.testedAt) < lowerBound) {
      issues.push(`Planned observation requires a fresh post-plan control test: ${entry.controlId}`);
    }
    if (!entry.evidenceIds.length) issues.push(`Planned observation requires traceable source evidence: ${entry.controlId}`);
    entry.evidenceIds.forEach((id) => {
      const source = assessment?.failureModes.find((mode) => mode.id === entry.failureModeId)?.evidence.find((evidence) => evidence.id === id);
      if (!source?.observedAt || !Number.isFinite(Date.parse(source.observedAt)) || Date.parse(source.observedAt) < lowerBound
        || Date.parse(source.observedAt) > Date.parse(test?.testedAt ?? "")
        || Date.parse(source.recordedAt) < Date.parse(source.observedAt)
        || source.reviewedAt && Date.parse(source.reviewedAt) < Date.parse(source.recordedAt)) {
        issues.push(`Planned observation requires dated fresh source evidence: ${id}`);
      }
    });
  });
  return [...new Set(issues)].sort();
}

export function deriveIcarusObservationResponsibility(
  target: IcarusTreatmentTarget,
  assessments: readonly IcarusAssessmentRecord[],
  people: readonly { id: string; status: string }[],
  history: readonly { record: IcarusTreatmentOutcomeRecord; current: boolean; issues?: readonly string[] }[],
  nowMs: number,
): IcarusObservationResponsibility {
  const plan = getIcarusCurrentObservationPlan(target);
  if (!plan) return { state: "Missing", issues: ["Continued protection has no accountable observation plan"] };
  const issues = getIcarusObservationPlanIssues(target, plan, assessments, people, nowMs);
  if (issues.length) return { state: issues.some((issue) => issue.includes("accountable Person")) ? "Unowned" : "Invalid", plan, issues };
  const latest = history.at(-1);
  const completed = latest?.current && latest.record.observationPlan?.id === plan.id;
  const reviewed = latest?.record.observationPlan?.id === plan.id
    && !getIcarusPlannedObservationIssues(
      target, plan, latest.record, history.at(-2)?.record, assessments, people, nowMs,
    ).length;
  // Replanning is not an observation and cannot erase an outstanding earlier deadline.
  const outstanding = (target.observationPlans ?? []).filter((entry) =>
    !(completed && entry.controlIds.every((id) => plan.controlIds.includes(id))
      && Date.parse(entry.recordedAt) <= Date.parse(plan.recordedAt))
    && !history.some((review) => review.record.observationPlan?.id === entry.id
      && !getIcarusPlannedObservationIssues(target, entry, review.record, undefined, assessments, people, nowMs).length));
  const uncovered = outstanding.filter((entry) => entry.controlIds.some((id) => !plan.controlIds.includes(id)));
  if (uncovered.length) return {
    state: "Invalid", plan,
    issues: ["Replacement plan leaves outstanding monitored controls without accountable observation coverage"],
  };
  const candidates = [reviewed ? latest.record.nextObservationBy ?? plan.firstReviewBy : plan.firstReviewBy,
    ...outstanding.map((entry) => entry.firstReviewBy),
    ...(latest?.record.nextObservationBy ? [latest.record.nextObservationBy] : [])];
  const nextReviewBy = candidates.sort((a, b) => getIcarusObservationDeadline(a) - getIcarusObservationDeadline(b))[0];
  const deadline = getIcarusObservationDeadline(nextReviewBy);
  const state = deadline < nowMs ? "Overdue" : deadline - nowMs < 86400000 ? "Due"
    : completed ? "Completed" : latest?.record.observationPlan?.id === plan.id ? "Invalid" : "Scheduled";
  return {
    state, plan, nextReviewBy, ...(completed ? { lastOutcomeId: latest.record.id } : {}),
    issues: state === "Invalid" ? latest?.issues ?? ["Latest planned observation is invalid"] : [],
  };
}
