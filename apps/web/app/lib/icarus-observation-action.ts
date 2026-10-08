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

export type IcarusObservationHandoff = {
  id: string;
  actionId: string;
  link: IcarusObservationActionLink;
  previousOwnerPersonId: string;
  receivingOwnerPersonId: string;
  reason: string;
  initiatedAt: string;
  initiatedByPersonId: string;
  expiresBy: string;
  responses: {
    decision: "Accepted" | "Rejected";
    respondedAt: string;
    respondedByPersonId: string;
    note: string;
    acceptedPlan?: IcarusObservationPlan;
  }[];
};

export type IcarusObservationHandoffView = {
  record: IcarusObservationHandoff;
  state: "Proposed" | "Accepted" | "Rejected" | "Expired" | "Invalid" | "Unowned";
  issues: readonly string[];
};

export type IcarusObservationHandoffCommand =
  | { kind: "Propose"; actionId: string; receivingOwnerPersonId: string; initiatedByPersonId: string; reason: string; expiresBy: string }
  | { kind: "Respond"; actionId: string; handoffId: string; decision: "Accepted" | "Rejected"; respondedByPersonId: string; note: string };

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
  handoffs?: readonly IcarusObservationHandoffView[];
};

type Person = { id: string; status: string };
export type IcarusObservationExecutionContext = {
  assessments: readonly IcarusAssessmentRecord[];
  treatment: Pick<IcarusTreatmentIndex, "targets" | "verification">;
  actions: readonly IcarusTreatmentExecution[];
  people: readonly Person[];
  nowMs: number;
};
type Context = IcarusObservationExecutionContext;

function assertCurrentHandoffAction(context: Context, action: ActionRecord): void {
  const records = context.actions.filter((entry) => entry.recordType === "Action" && entry.recordId === action.id);
  const current = records[0];
  if (records.length !== 1 || !current || current.ownerPersonId !== action.ownerPersonId
    || current.status !== action.status || current.dueDate !== action.dueDate
    || JSON.stringify(current.icarusObservationLinks ?? []) !== JSON.stringify(action.icarusObservationLinks ?? [])
    || JSON.stringify(current.icarusObservationHandoffs ?? []) !== JSON.stringify(action.icarusObservationHandoffs ?? [])) {
    throw new Error("Monitoring Action changed or is missing or ambiguous; reload its current handoff provenance.");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isIcarusObservationActionLink(value: unknown): value is IcarusObservationActionLink {
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

export function assertIcarusObservationHandoffs(value: unknown): asserts value is IcarusObservationHandoff[] | undefined {
    if (value === undefined) return;
    const nonempty = (entry: unknown) => typeof entry === "string" && entry.trim().length > 0;
    if (!Array.isArray(value) || !value.every((entry: unknown) => isObject(entry)
      && [entry.id, entry.actionId, entry.previousOwnerPersonId, entry.receivingOwnerPersonId, entry.reason,
        entry.initiatedAt, entry.initiatedByPersonId, entry.expiresBy].every(nonempty)
      && isIcarusObservationActionLink(entry.link)
      && Array.isArray(entry.responses) && entry.responses.every((response: unknown) => isObject(response)
        && ["Accepted", "Rejected"].includes(String(response.decision))
        && [response.respondedAt, response.respondedByPersonId, response.note].every(nonempty)
        && (response.acceptedPlan === undefined || isIcarusObservationPlan(response.acceptedPlan))))) {
      throw new Error("An Action contains malformed Icarus observation handoff provenance; existing data must be preserved.");
    }
  }

export function deriveIcarusObservationHandoffs(context: Context): IcarusObservationHandoffView[] {
    if (!Number.isFinite(context.nowMs)) throw new Error("Observation handoffs require a valid explicit clock.");
    const records = context.actions.flatMap((action) => {
      assertIcarusObservationHandoffs(action.icarusObservationHandoffs);
      return (action.icarusObservationHandoffs ?? []).map((record) => ({ action, record }));
    });
    return records.map(({ action, record }) => {
      const issues: string[] = [];
      const target = context.treatment.targets.find((target) => target.id === record.link.treatmentTargetId);
      const plans = target?.observationPlans ?? [];
      const sourcePlan = plans.filter((plan) => plan.id === record.link.plan.id);
      const identity = (id: string) => context.people.filter((person) => person.id === id);
      const uniqueActive = (id: string) => identity(id).length === 1 && identity(id)[0].status === "Active";
      const initiatedAt = getIcarusObservationDeadline(record.initiatedAt);
      const expiresAt = getIcarusObservationDeadline(record.expiresBy);
      if (records.filter((entry) => entry.record.id === record.id).length !== 1
        || record.actionId !== action.recordId
        || context.actions.filter((entry) => entry.recordId === record.actionId).length !== 1) issues.push("Handoff or Action identity is ambiguous");
      if (!target || target.assessmentId !== record.link.assessmentId
        || sourcePlan.length !== 1 || !sameIcarusObservationPlan(sourcePlan[0], record.link.plan)
        || record.previousOwnerPersonId !== record.link.plan.ownerPersonId
        || record.previousOwnerPersonId === record.receivingOwnerPersonId) issues.push("Handoff does not match its retained observation responsibility");
      const sourceLinks = action.icarusObservationLinks?.filter((link) => sameCycle(link, record.link)
        && link.linkedAt === record.link.linkedAt && link.linkedByPersonId === record.link.linkedByPersonId) ?? [];
      if (sourceLinks.length !== 1) issues.push("Handoff source Action linkage is missing or ambiguous");
      if (identity(record.initiatedByPersonId).length !== 1) issues.push("Handoff initiation author is missing or ambiguous");
      if (!Number.isFinite(initiatedAt) || initiatedAt > context.nowMs || initiatedAt < Date.parse(record.link.linkedAt)
        || !Number.isFinite(expiresAt) || expiresAt <= initiatedAt) issues.push("Handoff initiation or expiration chronology is invalid");
      const response = record.responses[0];
      if (record.responses.length > 1) issues.push("Conflicting or duplicate handoff responses");
      if (response && (response.respondedByPersonId !== record.receivingOwnerPersonId
        || identity(response.respondedByPersonId).length !== 1
        || !Number.isFinite(Date.parse(response.respondedAt))
        || Date.parse(response.respondedAt) < initiatedAt || Date.parse(response.respondedAt) > expiresAt
        || Date.parse(response.respondedAt) > context.nowMs)) issues.push("Handoff response is not attributable to the receiver or has invalid chronology");
      if (response?.decision === "Rejected" && response.acceptedPlan) issues.push("Rejected handoff cannot establish a transferred plan");
      if (response?.decision === "Accepted") {
        const accepted = response.acceptedPlan;
        const retained = plans.filter((plan) => plan.id === accepted?.id);
        if (!accepted || retained.length !== 1 || !sameIcarusObservationPlan(retained[0], accepted)
          || accepted.ownerPersonId !== record.receivingOwnerPersonId
          || accepted.recordedByPersonId !== record.receivingOwnerPersonId
          || accepted.recordedAt !== response.respondedAt
          || accepted.handoffId !== record.id || accepted.handoffFromPlanId !== record.link.plan.id
          || accepted.protection !== record.link.plan.protection
          || accepted.evidenceRequirements !== record.link.plan.evidenceRequirements
          || accepted.acceptanceCriteria !== record.link.plan.acceptanceCriteria
          || JSON.stringify([...accepted.controlIds].sort()) !== JSON.stringify([...record.link.plan.controlIds].sort())
          || getIcarusObservationDeadline(accepted.firstReviewBy) > getIcarusObservationDeadline(record.link.reviewBy)) {
          issues.push("Accepted handoff plan is missing or changes the retained scope, evidence obligations or deadline");
        }
        const acceptedLinks = action.icarusObservationLinks?.filter((link) => accepted
          && sameIcarusObservationPlan(link.plan, accepted)
          && link.assessmentId === record.link.assessmentId && link.treatmentTargetId === record.link.treatmentTargetId
          && link.afterOutcomeId === record.link.afterOutcomeId && link.linkedByPersonId === record.receivingOwnerPersonId
          && link.linkedAt === response.respondedAt && link.reviewBy === accepted.firstReviewBy) ?? [];
        if (acceptedLinks.length !== 1) issues.push("Accepted handoff is not matched by unique Action linkage");
      } else if (!response && action.icarusObservationHandoffs?.at(-1)?.id === record.id) {
        const current = context.treatment.verification.get(record.link.treatmentTargetId)?.observation?.plan;
        const lastLink = action.icarusObservationLinks?.at(-1);
        if (!current || !sameIcarusObservationPlan(current, record.link.plan) || !lastLink
          || !sameCycle(lastLink, record.link)) issues.push("Observation plan or review cycle changed before handoff acceptance");
      }
      const pending = records.filter((entry) => entry.record.link.treatmentTargetId === record.link.treatmentTargetId
        && entry.record.link.assessmentId === record.link.assessmentId && !entry.record.responses.length
        && getIcarusObservationDeadline(entry.record.expiresBy) >= context.nowMs);
      if (!response && pending.length > 1) issues.push("Conflicting active transfers claim the same observation responsibility");
      const currentPlan = context.treatment.verification.get(record.link.treatmentTargetId)?.observation?.plan;
      const accountable = response?.decision === "Accepted" ? record.receivingOwnerPersonId : record.previousOwnerPersonId;
      const latest = action.icarusObservationHandoffs?.at(-1)?.id === record.id;
      const ownerGap = latest && (!uniqueActive(accountable)
        || currentPlan?.ownerPersonId !== accountable || action.ownerPersonId !== accountable);
      if (ownerGap) issues.push("Accountability gap: the active Person, observation plan and Action owner do not agree");
      if (!response && !uniqueActive(record.receivingOwnerPersonId)) issues.push("Receiving Person is unavailable, missing or ambiguous");
      const state: IcarusObservationHandoffView["state"] = issues.some((issue) => !issue.startsWith("Accountability gap"))
        ? "Invalid" : ownerGap ? "Unowned" : response?.decision ?? (expiresAt < context.nowMs ? "Expired" : "Proposed");
      return { record, state, issues: [...new Set(issues)].sort() };
    });
  }

  type HandoffPerson = Person & { name: string; role: string; responsibilities: string; authority: string };

export function proposeIcarusObservationHandoff(
    context: Context, action: ActionRecord,
    request: { id: string; receivingOwnerPersonId: string; initiatedByPersonId: string; reason: string; expiresBy: string },
    people: readonly HandoffPerson[],
  ): ActionRecord {
      assertCurrentHandoffAction(context, action);
    const link = action.icarusObservationLinks?.at(-1);
    if (!link) throw new Error("Select an Action with a current observation responsibility.");
    const view = buildIcarusObservationExecutionIndex(context).byTargetId.get(link.treatmentTargetId);
    if (!view?.plan || !view.actionIds.includes(action.id) || view.actionIds.length !== 1
      || ["Invalid", "Unowned", "Stale", "Missing", "Completed without evidence", "Awaiting verified observation"].includes(view.state)
      || !sameIcarusObservationPlan(view.plan, link.plan)) throw new Error("Resolve observation execution linkage and ownership before proposing a handoff.");
    const receiving = people.filter((person) => person.id === request.receivingOwnerPersonId && person.status === "Active");
    if (receiving.length !== 1 || receiving[0].id === link.plan.ownerPersonId
      || context.people.filter((person) => person.id === request.receivingOwnerPersonId && person.status === "Active").length !== 1
      || getDelegationReadinessMissingFields(receiving[0]).length) throw new Error("Select a different unique active delegation-ready receiving Person.");
    if (context.people.filter((person) => person.id === request.initiatedByPersonId && person.status === "Active").length !== 1) {
      throw new Error("Handoff initiation requires a unique active Person.");
    }
    if (!request.id.trim() || !request.reason.trim()
      || getIcarusObservationDeadline(request.expiresBy) <= context.nowMs
      || !Number.isFinite(getIcarusObservationDeadline(request.expiresBy))) throw new Error("Handoff requires an identity, reason and future acceptance deadline.");
    const existing = deriveIcarusObservationHandoffs(context);
    if (existing.some(({ record }) => record.id === request.id)) throw new Error("Handoff identity already exists.");
    if (existing.some(({ record }) => record.link.treatmentTargetId === link.treatmentTargetId
      && !record.responses.length && getIcarusObservationDeadline(record.expiresBy) >= context.nowMs)) {
      throw new Error("An active handoff already exists for this observation responsibility.");
    }
    const record: IcarusObservationHandoff = {
      ...request, actionId: action.id, previousOwnerPersonId: link.plan.ownerPersonId,
      link: { ...link, reviewBy: view.reviewBy ?? link.reviewBy,
        plan: { ...link.plan, controlIds: [...link.plan.controlIds] } },
      initiatedAt: new Date(context.nowMs).toISOString(), responses: [],
    };
    return { ...action, icarusObservationHandoffs: [...(action.icarusObservationHandoffs ?? []), record] };
  }

export function respondIcarusObservationHandoff(
    context: Context, action: ActionRecord,
    request: { handoffId: string; decision: "Accepted" | "Rejected"; respondedByPersonId: string; note: string },
    people: readonly HandoffPerson[],
  ): { action: ActionRecord; assessments: IcarusAssessmentRecord[] } {
      assertCurrentHandoffAction(context, action);
    const handoff = deriveIcarusObservationHandoffs(context).find((view) => view.record.id === request.handoffId);
    if (!handoff || handoff.record.actionId !== action.id || handoff.record.responses.length
      || Date.parse(handoff.record.initiatedAt) > context.nowMs
      || getIcarusObservationDeadline(handoff.record.expiresBy) < context.nowMs) throw new Error("Handoff is missing, already answered or expired.");
    const record = handoff.record;
    const receiver = people.filter((person) => person.id === request.respondedByPersonId && person.status === "Active");
    if (request.respondedByPersonId !== record.receivingOwnerPersonId || receiver.length !== 1
      || context.people.filter((person) => person.id === request.respondedByPersonId && person.status === "Active").length !== 1
      || !request.note.trim()) {
      throw new Error("Only the unique active receiving Person can explicitly accept or reject, with a recorded response note.");
    }
    const respondedAt = new Date(context.nowMs).toISOString();
    if (request.decision === "Rejected") return {
      assessments: [...context.assessments],
      action: { ...action, icarusObservationHandoffs: (action.icarusObservationHandoffs ?? []).map((entry) =>
        entry.id === record.id ? { ...entry, responses: [{
          decision: "Rejected", respondedAt, respondedByPersonId: request.respondedByPersonId, note: request.note,
        }] } : entry) },
    };
    if (!["Proposed", "Unowned"].includes(handoff.state)
      || action.ownerPersonId !== record.previousOwnerPersonId
      || getDelegationReadinessMissingFields(receiver[0]).length) {
      throw new Error("Resolve invalid handoff, owner mismatch or receiving-person readiness before acceptance.");
    }
    const target = context.treatment.targets.find((entry) => entry.id === record.link.treatmentTargetId);
    const execution = buildIcarusObservationExecutionIndex(context).byTargetId.get(record.link.treatmentTargetId);
    if (!target || !execution?.plan || execution.actionIds.length !== 1 || execution.actionIds[0] !== action.id
      || ["Completed", "Cancelled"].includes(action.status)
      || ["Invalid", "Stale", "Missing", "Completed without evidence", "Awaiting verified observation"].includes(execution.state)
      || !sameIcarusObservationPlan(execution.plan, record.link.plan)) throw new Error("Observation execution changed before acceptance.");
    const firstReviewBy = [record.link.reviewBy, execution.reviewBy ?? record.link.reviewBy, action.dueDate]
      .sort((a, b) => getIcarusObservationDeadline(a) - getIcarusObservationDeadline(b))[0];
    const acceptedPlan: IcarusObservationPlan = {
      ...record.link.plan, controlIds: [...record.link.plan.controlIds], id: `handoff:${record.id}:plan`,
      ownerPersonId: receiver[0].id, recordedAt: respondedAt, recordedByPersonId: receiver[0].id, firstReviewBy,
      handoffId: record.id, handoffFromPlanId: record.link.plan.id,
    };
    if (target.observationPlans?.some((plan) => plan.id === acceptedPlan.id || plan.recordedAt === respondedAt)
      || Date.parse(respondedAt) <= Date.parse(record.link.plan.recordedAt)) throw new Error("Accepted plan revision identity or chronology conflicts with existing history.");
    // Only ownership and revision provenance change; scope, evidence criteria and outstanding deadlines are retained.
    const assessments = context.assessments.map((assessment) => assessment.id !== target.assessmentId ? assessment : {
      ...assessment, updatedAt: respondedAt,
      treatmentTargets: (assessment.treatmentTargets ?? []).map((stored) => stored.id !== target.id ? stored : {
        ...stored, observationPlans: [...(stored.observationPlans ?? []), acceptedPlan],
      }),
    });
    if (!assessments.some((assessment) => assessment.treatmentTargets?.some((stored) =>
      stored.observationPlans?.some((plan) => plan.id === acceptedPlan.id)))) throw new Error("Authoritative persisted treatment target is missing.");
    const nextLink: IcarusObservationActionLink = {
      ...record.link, plan: acceptedPlan, reviewBy: firstReviewBy, linkedAt: respondedAt, linkedByPersonId: receiver[0].id,
    };
    return {
      assessments,
      action: { ...action, owner: receiver[0].name, ownerPersonId: receiver[0].id, dueDate: firstReviewBy,
        icarusObservationLinks: [...(action.icarusObservationLinks ?? []), nextLink],
        icarusObservationHandoffs: (action.icarusObservationHandoffs ?? []).map((entry) => entry.id !== record.id ? entry : {
          ...entry, responses: [{ decision: "Accepted", respondedAt, respondedByPersonId: receiver[0].id, note: request.note, acceptedPlan }],
        }),
      },
    };
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
  const handoffs = deriveIcarusObservationHandoffs(context);
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
  handoffs.forEach((view) => {
    const latest = actions.find((action) => action.recordId === view.record.actionId)?.icarusObservationHandoffs?.at(-1);
    const unresolvedActive = !view.record.responses.length && getIcarusObservationDeadline(view.record.expiresBy) >= context.nowMs;
    if (latest?.id !== view.record.id && !unresolvedActive || view.state === "Accepted") return;
    actionAttention.push({
      actionId: view.record.actionId, assessmentId: view.record.link.assessmentId, targetId: view.record.link.treatmentTargetId,
      reasons: [`Observation handoff: ${view.state}; outgoing Person:${view.record.previousOwnerPersonId}; receiving Person:${view.record.receivingOwnerPersonId}`,
        ...view.issues],
    });
  });
  return { byTargetId, actionAttention, ...(handoffs.length ? { handoffs } : {}) };
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
