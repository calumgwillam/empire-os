import { isIcarusObservationPlan, type IcarusAssessmentRecord, type IcarusObservationPlan, type IcarusTreatmentOutcomeRecord } from "./icarus";
import { actionStatusOptions, normalizeActionRecord, type ActionRecord } from "./capture-conversions";
import type { IcarusTreatmentExecution, IcarusTreatmentIndex, IcarusTreatmentTarget } from "./icarus-treatment";
import type { IcarusTreatmentOutcomeView } from "./icarus-treatment-outcome";
import { getIcarusObservationDeadline, getIcarusObservationPlanIssues, sameIcarusObservationPlan } from "./icarus-observation-plan";
import { getDelegationReadinessMissingFields } from "./execution-release";

export type IcarusObservationActionLink = {
  assessmentId: string;
  treatmentTargetId: string;
  plan: IcarusObservationPlan;
  reviewBy: string;
  afterOutcomeId?: string;
  linkedAt: string;
  linkedByPersonId: string;
};

export type IcarusObservationExecutionView = {
  targetId: string;
  assessmentId: string;
  state: "Missing" | "Unowned" | "Invalid" | "Stale" | "Scheduled" | "Due" | "Overdue"
    | "Blocked" | "Completed without evidence" | "Awaiting verified observation";
  plan?: IcarusObservationPlan;
  reviewBy?: string;
  afterOutcomeId?: string;
  actionIds: readonly string[];
  issues: readonly string[];
};

export type IcarusObservationActionAttention = {
  actionId: string;
  assessmentId: string;
  targetId: string;
  reasons: readonly string[];
};

export type IcarusObservationExecutionIndex = {
  byTargetId: ReadonlyMap<string, IcarusObservationExecutionView>;
  actionAttention: readonly IcarusObservationActionAttention[];
};

type Person = { id: string; status: string };
type Context = {
  assessments: readonly IcarusAssessmentRecord[];
  treatment: Pick<IcarusTreatmentIndex, "targets" | "verification">;
  actions: readonly IcarusTreatmentExecution[];
  people: readonly Person[];
  nowMs: number;
};

export function isIcarusObservationActionLink(value: unknown): value is IcarusObservationActionLink {
  const isObject = (entry: unknown): entry is Record<string, unknown> =>
    Boolean(entry) && typeof entry === "object" && !Array.isArray(entry);
  return isObject(value)
    && [value.assessmentId, value.treatmentTargetId, value.reviewBy, value.linkedAt, value.linkedByPersonId]
      .every((entry) => typeof entry === "string" && entry.trim().length > 0)
    && isIcarusObservationPlan(value.plan)
    && (value.afterOutcomeId === undefined
      || typeof value.afterOutcomeId === "string" && value.afterOutcomeId.trim().length > 0);
}

export function assertIcarusObservationActionLinks(value: unknown): void {
  if (value !== undefined && (!Array.isArray(value) || !value.every(isIcarusObservationActionLink))) {
    throw new Error("An Action contains malformed Icarus observation linkage; existing data must be preserved.");
  }
}

function sameCycle(left: IcarusObservationActionLink, right: IcarusObservationActionLink): boolean {
  return left.assessmentId === right.assessmentId && left.treatmentTargetId === right.treatmentTargetId
    && sameIcarusObservationPlan(left.plan, right.plan) && left.afterOutcomeId === right.afterOutcomeId;
}

export function getIcarusObservationActionOutcome(
  link: IcarusObservationActionLink,
  verification: IcarusTreatmentOutcomeView | undefined,
  assessments: readonly IcarusAssessmentRecord[],
): IcarusTreatmentOutcomeRecord | undefined {
  const previous = link.afterOutcomeId
    ? verification?.history.find((entry) => entry.record.id === link.afterOutcomeId)?.record : undefined;
  if (link.afterOutcomeId && !previous) return undefined;
  return verification?.history.find(({ record, current, observationCompleted }) => (current || observationCompleted)
    && record.assessmentId === link.assessmentId && record.treatmentTargetId === link.treatmentTargetId
    && record.observationPlan && sameIcarusObservationPlan(record.observationPlan, link.plan)
    && record.id !== link.afterOutcomeId
    && Date.parse(record.verifiedAt) >= Date.parse(link.linkedAt)
    && record.evidence.filter((entry) => entry.kind === "Control test").every((entry) => {
      const assessment = assessments.find((assessment) => assessment.id === entry.assessmentId);
      const test = assessment?.controls.find((control) => control.id === entry.controlId)?.assuranceTests
        ?.find((test) => test.id === entry.testId);
      return test && Date.parse(test.testedAt) >= Date.parse(link.linkedAt)
        && entry.evidenceIds.every((id) => {
          const evidence = assessment?.failureModes.find((mode) => mode.id === entry.failureModeId)?.evidence.find((evidence) => evidence.id === id);
          return evidence?.observedAt && Date.parse(evidence.observedAt) >= Date.parse(link.linkedAt);
        });
    })
    && (!previous || Date.parse(record.verifiedAt) > Date.parse(previous.verifiedAt)))?.record;
}

function linkageIssues(
  link: IcarusObservationActionLink,
  action: IcarusTreatmentExecution,
  target: IcarusTreatmentTarget,
  context: Context,
): string[] {
  const issues: string[] = [];
  const plan = target.observationPlans?.filter((plan) => plan.id === link.plan.id) ?? [];
  if (context.assessments.filter((assessment) => assessment.id === link.assessmentId).length !== 1
    || link.assessmentId !== target.assessmentId || plan.length !== 1
    || !sameIcarusObservationPlan(plan[0], link.plan)) issues.push("Action linkage does not match the assessment and retained plan revision");
  if (target.executionLinks.some((entry) => entry.recordType === "Action" && entry.recordId === action.recordId)) {
    issues.push("Corrective treatment execution cannot also be its protection-observation Action");
  }
  if (context.actions.filter((entry) => entry.recordId === action.recordId && entry.recordType === "Action").length !== 1) {
    issues.push("Observation Action identity is ambiguous");
  }
  if (!actionStatusOptions.some((status) => status === action.status)) issues.push("Observation Action execution status is invalid");
  if (context.people.filter((person) => person.id === action.ownerPersonId && person.status === "Active").length !== 1
    || action.ownerPersonId !== link.plan.ownerPersonId) issues.push("Observation Action has no matching unique active accountable Person");
  if (context.people.filter((person) => person.id === link.linkedByPersonId).length !== 1) issues.push("Observation Action linkage author is missing or ambiguous");
  const linkedAt = getIcarusObservationDeadline(link.linkedAt);
  if (!Number.isFinite(linkedAt) || linkedAt > context.nowMs || linkedAt < Date.parse(link.plan.recordedAt)) {
    issues.push("Observation Action linkage chronology is invalid");
  }
  const deadline = getIcarusObservationDeadline(link.reviewBy);
  const actionDeadline = getIcarusObservationDeadline(action.dueDate ?? "");
  if (!Number.isFinite(deadline) || !Number.isFinite(actionDeadline) || actionDeadline > deadline) {
    issues.push("Observation Action deadline is missing, invalid or later than the retained review deadline");
  }
  const history = context.treatment.verification.get(target.id)?.history ?? [];
  const previous = link.afterOutcomeId ? history.filter((entry) => entry.record.id === link.afterOutcomeId) : [];
  if (link.afterOutcomeId && (previous.length !== 1 || Date.parse(previous[0].record.verifiedAt) > linkedAt)) {
    issues.push("Observation Action review-cycle provenance is missing, ambiguous or precedes its outcome");
  }
  return issues;
}

export function buildIcarusObservationExecutionIndex(context: Context): IcarusObservationExecutionIndex {
  if (!Number.isFinite(context.nowMs)) throw new Error("Observation execution requires a valid explicit clock.");
  const byTargetId = new Map<string, IcarusObservationExecutionView>();
  const actionAttention: IcarusObservationActionAttention[] = [];
  const actions = context.actions.filter((action) => action.recordType === "Action");
  actions.forEach((action) => {
    assertIcarusObservationActionLinks(action.icarusObservationLinks);
    const link = action.icarusObservationLinks?.at(-1);
    if (!link) return;
    const targets = context.treatment.targets.filter((target) => target.id === link.treatmentTargetId);
    if (targets.length !== 1 || targets[0].assessmentId !== link.assessmentId) actionAttention.push({
      actionId: action.recordId, assessmentId: link.assessmentId, targetId: link.treatmentTargetId,
      reasons: ["ICARUS OBSERVATION: linked assessment or treatment is missing or ambiguous"],
    });
    else if (!context.treatment.verification.get(targets[0].id)?.observation?.plan) actionAttention.push({
      actionId: action.recordId, assessmentId: link.assessmentId, targetId: link.treatmentTargetId,
      reasons: ["ICARUS OBSERVATION: linked observation plan is missing"],
    });
    if (action.status === "Completed" && (!action.completionEvidence?.trim()
      || !Number.isFinite(getIcarusObservationDeadline(action.completedAt ?? ""))
      || getIcarusObservationDeadline(action.completedAt ?? "") > context.nowMs
      || getIcarusObservationDeadline(action.completedAt ?? "") < Date.parse(link.linkedAt))) actionAttention.push({
      actionId: action.recordId, assessmentId: link.assessmentId, targetId: link.treatmentTargetId,
      reasons: ["ICARUS OBSERVATION: Completed without evidence — execution completion provenance is invalid"],
    });
  });
  context.treatment.targets.forEach((target) => {
    const verification = context.treatment.verification.get(target.id);
    const observation = verification?.observation;
    const plan = observation?.plan;
    // Historical targets without a plan retain the existing missing-plan attention path.
    if (!plan) return;
    const afterOutcomeId = verification?.latest?.id;
    const related = actions.flatMap((action) => {
      const links = action.icarusObservationLinks ?? [];
      const link = links.at(-1);
      return link?.treatmentTargetId === target.id
        && (!getIcarusObservationActionOutcome(link, verification, context.assessments) || linkageIssues(link, action, target, context).length > 0)
        ? [{ action, link, duplicates: links.filter((entry) => sameCycle(entry, link)).length > 1 }] : [];
    });
    const deadlines = [observation.nextReviewBy ?? plan.firstReviewBy,
      ...related.map(({ link }) => link.reviewBy).filter((value) => Number.isFinite(getIcarusObservationDeadline(value)))];
    const reviewBy = deadlines.sort((left, right) => getIcarusObservationDeadline(left) - getIcarusObservationDeadline(right))[0];
    const expected: IcarusObservationActionLink = {
      assessmentId: target.assessmentId, treatmentTargetId: target.id, plan, reviewBy,
      afterOutcomeId, linkedAt: "", linkedByPersonId: "",
    };
    const candidates = related.filter(({ link }) => sameCycle(link, expected));
    const issues = [...(observation.issues ?? [])];
    if (candidates.length > 1) issues.push("Duplicate Actions claim the same observation review cycle");
    if (related.some(({ link }) => !sameCycle(link, expected))) issues.push("Outstanding Action linkage is stale after a plan revision or outcome review; relink the existing Action");
    related.forEach(({ action, link, duplicates }) => {
      issues.push(...linkageIssues(link, action, target, context));
      if (duplicates) issues.push("Duplicate observation-cycle linkage on an Action");
      if (getIcarusObservationDeadline(link.reviewBy) > getIcarusObservationDeadline(reviewBy)) {
        issues.push("Action linkage postpones an outstanding observation deadline");
      }
    });
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    const action = candidate?.action;
    const accountableOwner = context.people.filter((person) => person.id === plan.ownerPersonId && person.status === "Active");
    const deadline = getIcarusObservationDeadline(reviewBy);
    let state: IcarusObservationExecutionView["state"];
    if (observation.state === "Unowned" || accountableOwner.length !== 1
      || action && action.ownerPersonId !== plan.ownerPersonId
      || issues.some((issue) => issue.includes("accountable Person"))) state = "Unowned";
    else if (observation.state === "Invalid" || issues.some((issue) => !issue.includes("linkage is stale"))) state = "Invalid";
    else if (issues.length) state = "Stale";
    else if (!action) state = "Missing";
    else if (action.status === "Cancelled") {
      state = "Missing";
      issues.push("Cancelled Action does not discharge the observation responsibility");
    } else if (action.status === "Completed") {
      const completedAt = getIcarusObservationDeadline(action.completedAt ?? "");
      if (!action.completionEvidence?.trim() || !Number.isFinite(completedAt)
        || completedAt > context.nowMs || completedAt < Date.parse(candidate?.link.linkedAt ?? "")) {
        state = "Completed without evidence";
        issues.push("Completed Action has no admissible dated execution evidence");
      } else state = "Awaiting verified observation";
      issues.push("Action completion is not a verified observation and cannot renew assurance");
    } else if (action.status === "Blocked" || action.blocked) state = "Blocked";
    else if (deadline < context.nowMs) state = "Overdue";
    else if (deadline - context.nowMs < 86400000) state = "Due";
    else state = "Scheduled";
    if (deadline < context.nowMs) issues.push("Protection-observation execution is overdue");
    const actionIds = [...new Set(related.map(({ action }) => action.recordId))].sort();
    const view: IcarusObservationExecutionView = {
      targetId: target.id, assessmentId: target.assessmentId, state, plan, reviewBy, afterOutcomeId,
      actionIds, issues: [...new Set(issues)].sort(),
    };
    byTargetId.set(target.id, view);
    if (state !== "Scheduled") related.forEach(({ action }) => actionAttention.push({
      actionId: action.recordId, assessmentId: target.assessmentId, targetId: target.id,
      reasons: [`ICARUS OBSERVATION: ${state}`, ...view.issues],
    }));
  });
  return { byTargetId, actionAttention };
}

export function linkIcarusObservationAction(
  context: Context,
  targetId: string,
  action: ActionRecord,
  linkedByPersonId: string,
): ActionRecord {
  const index = buildIcarusObservationExecutionIndex(context);
  const view = index.byTargetId.get(targetId);
  const target = context.treatment.targets.find((target) => target.id === targetId);
  if (!view?.plan || !view.reviewBy || !target) throw new Error("Observation plan or treatment is missing.");
  const observation = context.treatment.verification.get(targetId)?.observation;
  if (getIcarusObservationPlanIssues(target, view.plan, context.assessments, context.people, context.nowMs).length
    || observation?.issues.some((issue) => issue.includes("outstanding monitored controls"))) {
    throw new Error("Resolve invalid or unowned observation planning before linking execution.");
  }
  if (context.people.filter((person) => person.id === linkedByPersonId && person.status === "Active").length !== 1) {
    throw new Error("Select a unique active Person to record observation linkage.");
  }
  if (action.status === "Completed" || action.status === "Cancelled") throw new Error("Link an active Action; reopen or review the existing Action through its execution workflow.");
  if (view.actionIds.some((id) => id !== action.id)) throw new Error("An outstanding observation Action already exists. Review or relink it instead of creating a duplicate.");
  const link: IcarusObservationActionLink = {
    assessmentId: target.assessmentId, treatmentTargetId: target.id,
    plan: { ...view.plan, controlIds: [...view.plan.controlIds] }, reviewBy: view.reviewBy,
    ...(view.afterOutcomeId ? { afterOutcomeId: view.afterOutcomeId } : {}),
    linkedAt: new Date(context.nowMs).toISOString(), linkedByPersonId,
  };
  const existing = action.icarusObservationLinks ?? [];
  if (existing.at(-1) && sameCycle(existing[existing.length - 1], link)) {
    throw new Error("This Action is already linked to that observation review cycle.");
  }
  const last = existing.at(-1);
  if (last && last.treatmentTargetId !== target.id
    && !getIcarusObservationActionOutcome(last, context.treatment.verification.get(last.treatmentTargetId), context.assessments)) {
    throw new Error("Action already carries another outstanding observation responsibility.");
  }
  const execution: IcarusTreatmentExecution = {
    recordType: "Action", recordId: action.id, title: action.actionTitle, status: action.status,
    ownerPersonId: action.ownerPersonId, dueDate: action.dueDate,
  };
  const issues = linkageIssues(link, execution, target, context);
  if (issues.length) throw new Error(issues.join("; "));
  return { ...action, icarusObservationLinks: [...existing, link] };
}

export function createIcarusObservationAction(
  context: Context,
  targetId: string,
  id: string,
  linkedByPersonId: string,
  people: readonly (Person & { name: string; role: string; responsibilities: string; authority: string })[],
): ActionRecord {
  if (!id.trim() || context.actions.some((action) => action.recordId === id)) throw new Error("New Action identity is empty or already exists.");
  const view = buildIcarusObservationExecutionIndex(context).byTargetId.get(targetId);
  const owners = people.filter((person) => person.id === view?.plan?.ownerPersonId && person.status === "Active");
  if (!view?.plan || !view.reviewBy || owners.length !== 1) throw new Error("Observation requires a unique active accountable Person.");
  const owner = owners[0];
  const readiness = getDelegationReadinessMissingFields(owner);
  if (readiness.length) throw new Error(`Observer delegation readiness is incomplete: ${readiness.join(", ")}. Update People before assigning work.`);
  const timestamp = new Date(context.nowMs).toISOString();
  const title = `Observe protection: ${view.plan.protection}`;
  const description = [
    `Assessment: ${view.assessmentId}; treatment: ${targetId}; plan revision: ${view.plan.id}.`,
    `Protection: ${view.plan.protection}`, `Controls: ${view.plan.controlIds.join(", ")}`,
    `Evidence required: ${view.plan.evidenceRequirements}`, `Acceptance criteria: ${view.plan.acceptanceCriteria}`,
    "Record fresh dated source evidence and control tests, then verify the observation in Icarus. Completing this Action does not establish effectiveness.",
  ].join("\n");
  const action = normalizeActionRecord({
    id, sourceCaptureId: "", targetType: "Convert to Action", createdAt: timestamp, createdDate: timestamp,
    title, actionDescription: description, originalRawNote: description, relatedArea: "Icarus",
    importance: "High", priority: "High", status: "Open", owner: owner.name, createdBy: linkedByPersonId,
    dueDate: view.reviewBy,
  });
  const owned = { ...action, ownerPersonId: owner.id };
  return linkIcarusObservationAction({
    ...context, actions: [...context.actions, {
      recordType: "Action", recordId: id, title, status: "Open", ownerPersonId: owner.id, dueDate: view.reviewBy,
    }],
  }, targetId, owned, linkedByPersonId);
}
