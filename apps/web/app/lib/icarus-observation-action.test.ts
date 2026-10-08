import { describe, expect, it } from "vitest";
import {
  getIcarusTreatmentOutcomeId, getIcarusTreatmentTargetId, parseIcarusAssessments,
  type IcarusAssessmentRecord, type IcarusObservationPlan, type IcarusTreatmentOutcomeRecord,
} from "./icarus";
import { normalizeActionRecord, type ActionRecord } from "./capture-conversions";
import { buildIcarusStrategicIntelligence, type IcarusStrategicIntelligenceInput } from "./icarus-intelligence-pipeline";
import type { IcarusTreatmentExecution } from "./icarus-treatment";
import {
  assertIcarusObservationActionLinks, buildIcarusObservationExecutionIndex,
  createIcarusObservationAction, getIcarusObservationActionOutcome, linkIcarusObservationAction,
  assertIcarusObservationHandoffs, deriveIcarusObservationHandoffs, proposeIcarusObservationHandoff, respondIcarusObservationHandoff,
} from "./icarus-observation-action";
import { buildCommandAttention, type CommandAttentionInput } from "./command-attention";
import { getIcarusCurrentExposureSignals } from "./icarus-strategic-attention";
import { runIcarusStressTest } from "./icarus-stress-testing";
import {
  BACKUP_FORMAT, BACKUP_VERSION, CONVERSION_STORAGE_KEY, buildFullBackup,
  runBackupRestoreTransaction, validateEmpireOsBackup,
} from "./backup";

const targetId = getIcarusTreatmentTargetId("Failure-chain restoration", "restore");
const routedAt = "2026-05-01T10:00:00.000Z";
const completedAt = "2026-05-02T10:00:00.000Z";
const plannedAt = "2026-05-03T10:00:00.000Z";
const linkedMs = Date.parse("2026-05-03T12:00:00.000Z");
const testedAt = "2026-05-04T10:00:00.000Z";
const verifiedAt = "2026-05-05T10:00:00.000Z";
const nowMs = Date.parse("2026-05-06T10:00:00.000Z");
const people = [
  { id: "reviewer", name: "Reviewer", status: "Active", role: "Reviewer", responsibilities: "Review evidence", authority: "Verify observations" },
  { id: "observer", name: "Observer", status: "Active", role: "Observer", responsibilities: "Observe protection", authority: "Collect operating evidence" },
  { id: "delegate", name: "Delegate", status: "Active", role: "Observer", responsibilities: "Observe protection", authority: "Collect operating evidence" },
];
const plan: IcarusObservationPlan = {
  id: "plan", recordedAt: plannedAt, recordedByPersonId: "reviewer", ownerPersonId: "observer",
  protection: "Operating barrier interrupts loss of continuity", controlIds: ["control"],
  evidenceRequirements: "Fresh dated direct observation and a control test",
  acceptanceCriteria: "The barrier interrupts the observed failure condition", firstReviewBy: "2026-05-07",
};

function source(): IcarusStrategicIntelligenceInput {
  const assessment: IcarusAssessmentRecord = {
    id: "risk", outcome: "Operating continuity", status: "Open", createdAt: routedAt, updatedAt: plannedAt,
    linkedRecords: [{ recordType: "Pillar", recordId: "Excavation" }],
    failureModes: [{
      id: "mode", mechanism: "Loss of operating protection", vulnerability: "Barrier unavailable",
      evidence: [{
        id: "evidence", statement: "Observed operating protection", origin: "Direct observation",
        observedAt: testedAt, recordedAt: testedAt, recordedBy: "observer",
        review: "Supports", reviewedAt: testedAt, reviewedBy: "reviewer",
      }],
    }],
    controls: [{
      id: "control", failureModeId: "mode", intervention: "Operating barrier", lifecycle: "Active",
      effectiveness: "Unknown", evidenceIds: ["evidence"], linkedRecords: [], ownerPersonId: "observer", nextReviewAt: "2026-12-01",
      assuranceTests: [{ id: "test", testedAt, testedByPersonId: "observer", result: "Passed", evidenceIds: ["evidence"] }],
    }],
    treatmentTargets: [{
      id: targetId, sourceKind: "Failure-chain restoration", sourceId: "restore", assessmentId: "risk",
      failureModeId: "mode", controlId: "control", treatmentKind: "Restore barrier", reason: "Corrective work",
      basis: [], affectedAssessmentIds: ["risk"], objectiveIds: [], pillarIds: ["Excavation"],
      provenance: { kind: "Failure-chain recommendation", finding: "Restore protection" },
      executionLinks: [{ recordType: "Action", recordId: "corrective", linkedAt: routedAt }],
      promotedAt: routedAt, observationPlans: [{ ...plan, controlIds: [...plan.controlIds] }],
    }],
  };
  return {
    assessments: [assessment], sourceRecords: [{ recordType: "Pillar", recordId: "Excavation", title: "Excavation" }],
    strategicObjectives: [], people, actions: [{ id: "corrective", status: "Completed" }],
    treatmentActions: [{
      recordType: "Action", recordId: "corrective", title: "Restore barrier", status: "Completed",
      completedAt, completionEvidence: "Dated restoration work",
    }], primaryFounderId: "reviewer", founderDependencyActive: false, nowMs,
  };
}

function execution(action: ActionRecord): IcarusTreatmentExecution {
  return {
    recordType: "Action", recordId: action.id, title: action.actionTitle, status: action.status,
    ownerPersonId: action.ownerPersonId, owner: action.owner, dueDate: action.dueDate,
    completedAt: action.completionDate, completionEvidence: action.completionEvidence,
    icarusObservationLinks: action.icarusObservationLinks,
    icarusObservationHandoffs: action.icarusObservationHandoffs,
  };
}

function context(input = source(), actions: readonly IcarusTreatmentExecution[] = [], clock = nowMs) {
  const treatment = buildIcarusStrategicIntelligence({ ...input, nowMs: clock }).treatment;
  return { assessments: input.assessments, treatment, people: input.people, nowMs: clock,
    actions: [...(input.treatmentActions ?? []), ...actions] };
}

function monitoring(input = source()): ActionRecord {
  return createIcarusObservationAction(context(input, [], linkedMs), targetId, "monitor", "reviewer", people);
}

function view(input = source(), actions: readonly ActionRecord[] = [monitoring(input)], clock = nowMs) {
  return buildIcarusObservationExecutionIndex(context(input, actions.map(execution), clock)).byTargetId.get(targetId)!;
}

function withOutcome(input = source()) {
  const verification = buildIcarusStrategicIntelligence(input).treatment.verification.get(targetId)!;
  const option = verification.options.find((entry) => entry.outcome === "Effective");
  if (!option) throw new Error("Fixture requires an admissible Effective observation option");
  const outcome: IcarusTreatmentOutcomeRecord = {
    id: getIcarusTreatmentOutcomeId(targetId, "reviewer", option.evidence, "observed"),
    occurrenceId: "observed", treatmentTargetId: targetId, assessmentId: "risk",
    executionLinks: [...input.assessments[0].treatmentTargets![0].executionLinks],
    outcome: "Effective", verifiedAt, verifiedByPersonId: "reviewer", evidence: [...option.evidence],
    afterState: option.afterState, completionConditions: [...verification.completion!.conditions],
    verificationNote: "Observed protection after corrective completion", observationPlan: plan,
    observationCriteriaResult: "Met", observationCriteriaNote: "Fresh source observation meets the declared criteria",
    nextObservationBy: "2026-05-10",
  };
  return { ...input, assessments: [{ ...input.assessments[0], treatmentOutcomes: [outcome] }] };
}

function command(input: IcarusStrategicIntelligenceInput, actions: ActionRecord[]) {
  const intelligence = buildIcarusStrategicIntelligence({ ...input,
    observationActions: [...(input.treatmentActions ?? []), ...actions.map(execution)],
  });
  const commandInput: CommandAttentionInput = {
    problems: [], actions, outreach: [], projects: [], decisions: [], opportunities: [], lessons: [],
    systems: [], sops: [], handoffs: [], procurementQueue: [], nowMs: input.nowMs,
    icarus: intelligence.strategicSignals, icarusObservationExecution: intelligence.observationExecution,
  };
  return { intelligence, attention: buildCommandAttention(commandInput) };
}

describe("controlled Icarus observation handoffs", () => {
  const propose = (input = source(), action = monitoring(input), clock = nowMs) =>
    proposeIcarusObservationHandoff(context(input, [execution(action)], clock), action, {
      id: "transfer", receivingOwnerPersonId: "delegate", initiatedByPersonId: "reviewer",
      reason: "Transfer ongoing monitoring responsibility", expiresBy: "2026-05-09",
    }, people);
  const respond = (input: IcarusStrategicIntelligenceInput, action: ActionRecord, decision: "Accepted" | "Rejected" = "Accepted", clock = nowMs + 1000) =>
    respondIcarusObservationHandoff(context(input, [execution(action)], clock), action, {
      handoffId: "transfer", decision, respondedByPersonId: "delegate", note: "Receiving Person reviewed scope, evidence requirements and retained deadline",
    }, people);
  const handoffs = (input: IcarusStrategicIntelligenceInput, action: ActionRecord, clock = nowMs) =>
    deriveIcarusObservationHandoffs(context(input, [execution(action)], clock));

  it("keeps the outgoing owner accountable during proposal and transfers only through explicit receiving-person acceptance", () => {
    const input = source();
    const original = monitoring(input);
    const proposed = propose(input, original);
    expect(proposed.ownerPersonId).toBe("observer");
    expect(proposed.icarusObservationLinks).toEqual(original.icarusObservationLinks);
    expect(input.assessments[0].treatmentTargets![0].observationPlans).toHaveLength(1);
    expect(handoffs(input, proposed)[0]).toMatchObject({ state: "Proposed", record: {
      previousOwnerPersonId: "observer", receivingOwnerPersonId: "delegate", initiatedByPersonId: "reviewer", responses: [],
    } });
    const result = respond(input, proposed);
    const acceptedInput = { ...input, assessments: result.assessments };
    const revision = result.assessments[0].treatmentTargets![0].observationPlans!.at(-1)!;
    expect(result.action).toMatchObject({ id: original.id, status: "Open", ownerPersonId: "delegate", dueDate: plan.firstReviewBy });
    expect(revision).toMatchObject({
      ownerPersonId: "delegate", recordedByPersonId: "delegate", protection: plan.protection,
      controlIds: plan.controlIds, evidenceRequirements: plan.evidenceRequirements, acceptanceCriteria: plan.acceptanceCriteria,
      firstReviewBy: plan.firstReviewBy, handoffFromPlanId: plan.id, handoffId: "transfer",
    });
    expect(handoffs(acceptedInput, result.action, nowMs + 1000)[0].state).toBe("Accepted");
    expect(result.action.icarusObservationLinks).toHaveLength(2);
    expect(result.action.icarusObservationLinks![0]).toEqual(original.icarusObservationLinks![0]);
    expect(view(acceptedInput, [result.action], nowMs + 1000).state).toBe("Scheduled");
    expect(buildIcarusStrategicIntelligence(acceptedInput).treatment.verification.get(targetId)?.state).not.toBe("Verified effective");
    expect(proposed.icarusObservationHandoffs![0].responses).toEqual([]);
    expect(input.assessments[0].treatmentTargets![0].observationPlans).toHaveLength(1);
  });

  it("rejects explicitly without changing owner, deadline, scope or Action count", () => {
    const input = source();
    const proposed = propose(input);
    const result = respond(input, proposed, "Rejected");
    expect(result.assessments).toEqual(input.assessments);
    expect(result.action.ownerPersonId).toBe("observer");
    expect(result.action.dueDate).toBe(proposed.dueDate);
    expect(result.action.icarusObservationLinks).toEqual(proposed.icarusObservationLinks);
    expect(handoffs(input, result.action, nowMs + 1000)[0].state).toBe("Rejected");
    const { attention } = command({ ...input, nowMs: nowMs + 1000 }, [result.action]);
    expect(attention.items.filter((item) => item.id === result.action.id)).toHaveLength(1);
    expect(attention.items.find((item) => item.id === result.action.id)?.reason).toContain("Rejected");
  });

  it("expires at the explicit deadline, never transfers automatically, and preserves overdue monitoring", () => {
    const input = source();
    const proposed = propose(input);
    const boundary = Date.parse("2026-05-09T23:59:59.999Z");
    expect(handoffs(input, proposed, boundary)[0].state).toBe("Proposed");
    expect(handoffs(input, proposed, boundary + 1)[0].state).toBe("Expired");
    expect(() => respond(input, proposed, "Accepted", boundary + 1)).toThrow("expired");
    expect(proposed.ownerPersonId).toBe("observer");
    expect(view(input, [proposed], boundary + 1)).toMatchObject({ state: "Overdue", reviewBy: plan.firstReviewBy });
  });

  it("carries an overdue deadline into an accepted ownership revision without inventing fresh assurance", () => {
    const input = source();
    const proposed = propose(input);
    const clock = Date.parse("2026-05-08T10:00:00Z");
    const result = respond(input, proposed, "Accepted", clock);
    const acceptedInput = { ...input, assessments: result.assessments, nowMs: clock };
    expect(view(acceptedInput, [result.action], clock)).toMatchObject({ state: "Overdue", reviewBy: plan.firstReviewBy });
    expect(handoffs(acceptedInput, result.action, clock)[0].state).toBe("Accepted");
    expect(result.action.completionEvidence).toBe("");
    expect(result.action.dueDate).toBe(plan.firstReviewBy);
    expect(buildIcarusStrategicIntelligence(acceptedInput).treatment.verification.get(targetId)?.observation?.issues)
      .not.toContain("First observation deadline is missing, invalid or precedes the plan");
  });

  it("exposes an accountability gap when the outgoing Person becomes unavailable, then permits explicit valid recovery", () => {
    const input = source();
    const proposed = propose(input);
    const unavailable = { ...input, people: people.map((person) => person.id === "observer" ? { ...person, status: "Inactive" } : person) };
    expect(handoffs(unavailable, proposed)[0].state).toBe("Unowned");
    const result = respond(unavailable, proposed);
    expect(handoffs({ ...unavailable, assessments: result.assessments }, result.action, nowMs + 1000)[0].state).toBe("Accepted");
  });

  it.each(["Missing", "Inactive", "Duplicate", "Not ready"])("rejects a %s receiving Person", (kind) => {
    const input = source();
    const updatedPeople = kind === "Missing" ? people.filter((person) => person.id !== "delegate")
      : kind === "Duplicate" ? [...people, people[2]]
        : people.map((person) => person.id !== "delegate" ? person : kind === "Inactive" ? { ...person, status: "Inactive" } : { ...person, authority: "" });
    const action = monitoring(input);
    expect(() => proposeIcarusObservationHandoff(context({ ...input, people: updatedPeople }, [execution(action)]), action, {
      id: "transfer", receivingOwnerPersonId: "delegate", initiatedByPersonId: "reviewer", reason: "Transfer", expiresBy: "2026-05-09",
    }, updatedPeople)).toThrow("delegation-ready");
  });

  it("requires explicit receiver attribution and rechecks receiving-person availability and readiness at acceptance", () => {
    const input = source();
    const proposed = propose(input);
    const request = { handoffId: "transfer", decision: "Accepted" as const, respondedByPersonId: "reviewer", note: "Responded" };
    expect(() => respondIcarusObservationHandoff(context(input, [execution(proposed)], nowMs + 1000), proposed, request, people)).toThrow("receiving Person");
    const inactive = { ...input, people: people.map((person) => person.id === "delegate" ? { ...person, status: "Inactive" } : person) };
    expect(handoffs(inactive, proposed)[0].state).toBe("Invalid");
    expect(() => respond(inactive, proposed)).toThrow();
    expect(() => respondIcarusObservationHandoff(context(input, [execution(proposed)], nowMs + 1000), proposed,
      { ...request, respondedByPersonId: "delegate" }, people.map((person) => person.id === "delegate" ? { ...person, authority: "" } : person))).toThrow("readiness");
  });

  it("never infers plan transfer from Action reassignment and refuses acceptance while owners disagree", () => {
    const input = source();
    const proposed = propose(input);
    const reassigned = { ...proposed, ownerPersonId: "delegate", owner: "Delegate" };
    expect(handoffs(input, reassigned)[0].state).toBe("Unowned");
    expect(view(input, [reassigned]).state).toBe("Unowned");
    expect(() => respond(input, reassigned)).toThrow("owner mismatch");
    expect(input.assessments[0].treatmentTargets![0].observationPlans![0].ownerPersonId).toBe("observer");
  });

  it("prevents duplicate active proposals and duplicate responses and detects imported conflicts", () => {
    const input = source();
    const proposed = propose(input);
    expect(() => propose(input, proposed)).toThrow("identity already exists");
    expect(() => proposeIcarusObservationHandoff(context(input, [execution(proposed)]), proposed, {
      id: "second", receivingOwnerPersonId: "delegate", initiatedByPersonId: "reviewer", reason: "Transfer again", expiresBy: "2026-05-09",
    }, people)).toThrow("active handoff already exists");
    const duplicate = { ...proposed, icarusObservationHandoffs: [...proposed.icarusObservationHandoffs!,
      { ...proposed.icarusObservationHandoffs![0], id: "conflict" }] };
    expect(handoffs(input, duplicate).every((view) => view.state === "Invalid")).toBe(true);
    const accepted = respond(input, proposed);
    expect(() => respond({ ...input, assessments: accepted.assessments }, accepted.action, "Accepted", nowMs + 2000)).toThrow("already answered");
    const record = accepted.action.icarusObservationHandoffs![0];
    const conflicting = { ...accepted.action, icarusObservationHandoffs: [{ ...record, responses: [...record.responses, ...record.responses] }] };
    expect(handoffs({ ...input, assessments: accepted.assessments }, conflicting, nowMs + 1000)[0].state).toBe("Invalid");
  });

  it("does not let changed plan scope, deadlines or intervening reviews silently transfer responsibilities", () => {
    const input = source();
    const proposed = propose(input);
    input.assessments[0].treatmentTargets![0].observationPlans!.push({
      ...plan, id: "replacement", recordedAt: "2026-05-06T10:00:00.500Z", acceptanceCriteria: "Changed criteria", firstReviewBy: "2026-05-20",
    });
    expect(handoffs(input, proposed, nowMs + 1000)[0].state).toBe("Invalid");
    expect(() => respond(input, proposed)).toThrow("invalid handoff");
    expect(proposed.dueDate).toBe(plan.firstReviewBy);
  });

  it("detects interrupted or corrupted accepted transfers and keeps a single Command accountability item", () => {
    const input = source();
    const proposed = propose(input);
    const result = respond(input, proposed);
    expect(handoffs(input, result.action, nowMs + 1000)[0].state).toBe("Invalid");
    const acceptedInput = { ...input, assessments: result.assessments, nowMs: nowMs + 1000 };
    const missingLink = { ...result.action, icarusObservationLinks: proposed.icarusObservationLinks };
    expect(handoffs(acceptedInput, missingLink, nowMs + 1000)[0].state).toBe("Invalid");
    const { attention } = command(input, [proposed]);
    expect(attention.items.filter((item) => item.id === proposed.id)).toHaveLength(1);
    expect(attention.items.find((item) => item.id === proposed.id)?.reason).toContain("Proposed");
    expect(attention.items.some((item) => item.objectType === "Icarus")).toBe(false);
  });

  it("exposes accepted transfer tampering and unavailable receiving ownership without weakening assurance", () => {
    const input = source();
    const accepted = respond(input, propose(input));
    const updated = { ...input, assessments: accepted.assessments };
    const unavailable = { ...updated, people: people.map((person) => person.id === "delegate" ? { ...person, status: "Inactive" } : person) };
    expect(handoffs(unavailable, accepted.action, nowMs + 1000)[0].state).toBe("Unowned");
    const corrupt: ActionRecord = { ...accepted.action, icarusObservationHandoffs: accepted.action.icarusObservationHandoffs!.map((record) => ({
      ...record, responses: record.responses.map((response) => ({
        ...response, acceptedPlan: response.acceptedPlan ? { ...response.acceptedPlan, firstReviewBy: "2026-06-01" } : undefined,
      })),
    })) };
    expect(handoffs(updated, corrupt, nowMs + 1000)[0].state).toBe("Invalid");
    expect(buildIcarusObservationExecutionIndex(context(updated, [execution(corrupt)], nowMs + 1000)).actionAttention
      .some((entry) => entry.reasons.some((reason) => reason.includes("Invalid")))).toBe(true);
  });

  it("retains failed proposal history while allowing a new explicit attempt after expiration", () => {
    const input = source();
    const expired = propose(input);
    const clock = Date.parse("2026-05-10T10:00:00Z");
    const retry = proposeIcarusObservationHandoff(context(input, [execution(expired)], clock), expired, {
      id: "retry", receivingOwnerPersonId: "delegate", initiatedByPersonId: "reviewer",
      reason: "Renew the proposal without postponing monitoring", expiresBy: "2026-05-11",
    }, people);
    expect(handoffs(input, retry, clock).map((view) => view.state)).toEqual(["Expired", "Proposed"]);
    expect(retry.icarusObservationHandoffs![0]).toEqual(expired.icarusObservationHandoffs![0]);
    expect(retry.dueDate).toBe(plan.firstReviewBy);
    const { attention } = command({ ...input, nowMs: clock }, [retry]);
    expect(attention.items.filter((item) => item.id === retry.id)).toHaveLength(1);
  });

  it("preserves append-only transfer and plan history through normalisation and backup, rejecting malformed responses", () => {
    const input = source();
    const result = respond(input, propose(input));
    expect(normalizeActionRecord(JSON.parse(JSON.stringify(result.action))).icarusObservationHandoffs).toEqual(result.action.icarusObservationHandoffs);
    expect(parseIcarusAssessments(JSON.stringify(result.assessments))).toEqual(result.assessments);
    expect(validateEmpireOsBackup({
      format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: verifiedAt,
      storage: { [CONVERSION_STORAGE_KEY]: JSON.stringify([result.action]) },
    }).version).toBe(BACKUP_VERSION);
    expect(() => assertIcarusObservationHandoffs(undefined)).not.toThrow();
    expect(() => assertIcarusObservationHandoffs([{ responses: [] }])).toThrow("malformed");
    expect(() => validateEmpireOsBackup({
      format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: verifiedAt,
      storage: { [CONVERSION_STORAGE_KEY]: JSON.stringify([{ ...result.action, icarusObservationHandoffs: [{}] }]) },
    })).toThrow("malformed");
  });

  it("never treats completed monitoring execution as acceptance or effectiveness", () => {
    const input = source();
    const proposed = propose(input);
    const completed: ActionRecord = { ...proposed, status: "Completed", completionDate: testedAt, completionEvidence: "Monitoring work recorded" };
    expect(handoffs(input, completed)[0].state).toBe("Proposed");
    expect(() => respond(input, completed)).toThrow("execution changed");
    expect(buildIcarusStrategicIntelligence({ ...input, observationActions: [execution(completed)] })
      .treatment.verification.get(targetId)?.state).toBe("Awaiting verification");
  });

  it("retains accepted transfer history through subsequent handoffs without creating another monitoring Action", () => {
    const input = source();
    const accepted = respond(input, propose(input));
    const nextInput = { ...input, assessments: accepted.assessments };
    const proposed = proposeIcarusObservationHandoff(context(nextInput, [execution(accepted.action)], nowMs + 2000),
      accepted.action, { id: "return-transfer", receivingOwnerPersonId: "observer", initiatedByPersonId: "reviewer",
        reason: "Return the responsibility with explicit acceptance", expiresBy: "2026-05-09" }, people);
    const result = respondIcarusObservationHandoff(context(nextInput, [execution(proposed)], nowMs + 3000),
      proposed, { handoffId: "return-transfer", decision: "Accepted", respondedByPersonId: "observer", note: "Accepting continued monitoring" }, people);
    expect(result.action.id).toBe(accepted.action.id);
    expect(result.action.icarusObservationHandoffs).toHaveLength(2);
    expect(result.action.icarusObservationHandoffs![0]).toEqual(accepted.action.icarusObservationHandoffs![0]);
    expect(result.action.icarusObservationLinks).toHaveLength(3);
    expect(result.action.dueDate).toBe(plan.firstReviewBy);
    const updated = { ...nextInput, assessments: result.assessments };
    expect(handoffs(updated, result.action, nowMs + 3000).map((view) => view.state)).toEqual(["Accepted", "Accepted"]);
  });

  it("rejects stale Action inputs instead of overwriting newer handoff history", () => {
    const input = source();
    const original = monitoring(input);
    const proposed = propose(input, original);
    expect(() => respondIcarusObservationHandoff(context(input, [execution(proposed)], nowMs + 1000), original, {
      handoffId: "transfer", decision: "Accepted", respondedByPersonId: "delegate", note: "Accepted",
    }, people)).toThrow("Action changed");
  });
});

describe("Icarus observation responsibility execution through Actions", () => {
  it("creates an ordinary delegated Action with immutable plan, owner, deadline and review-cycle provenance", () => {
    const input = source();
    const action = monitoring(input);
    expect(action).toMatchObject({
      targetType: "Convert to Action", status: "Open", priority: "High", owner: "Observer", ownerPersonId: "observer",
      dueDate: plan.firstReviewBy, completionEvidence: "", completionDate: "", sourceCaptureId: "",
      icarusObservationLinks: [{
        assessmentId: "risk", treatmentTargetId: targetId, plan, reviewBy: plan.firstReviewBy,
        linkedAt: new Date(linkedMs).toISOString(), linkedByPersonId: "reviewer",
      }],
    });
    expect(action.description).toContain(plan.acceptanceCriteria);
    expect(view(input, [action])).toMatchObject({ state: "Scheduled", actionIds: ["monitor"] });
    expect(action.icarusObservationLinks![0].plan).not.toBe(input.assessments[0].treatmentTargets![0].observationPlans![0]);
    expect(input.assessments[0].treatmentTargets![0].executionLinks).toHaveLength(1);
  });

  it("links an existing Action without changing its ownership, content, completion or normalised persisted fields", () => {
    const current = { ...monitoring(), id: "existing", icarusObservationLinks: undefined, description: "Existing execution instructions" };
    const linked = linkIcarusObservationAction(context(source(), [execution(current)], linkedMs), targetId, current, "reviewer");
    expect(linked.description).toBe(current.description);
    expect(linked.ownerPersonId).toBe(current.ownerPersonId);
    expect(linked.icarusObservationLinks).toHaveLength(1);
    expect(current.icarusObservationLinks).toBeUndefined();
    expect(normalizeActionRecord(JSON.parse(JSON.stringify(linked)))).toEqual(linked);
  });
  it("does not repurpose committed customer delivery execution as a protection-monitoring Action", () => {
    const current = { ...monitoring(), id: "delivery", icarusObservationLinks: undefined, deliveryLeadId: "customer-lead" };
    expect(() => linkIcarusObservationAction(context(source(), [execution(current)], linkedMs), targetId, current, "reviewer"))
      .toThrow("Customer delivery Actions");
    expect(current.icarusObservationLinks).toBeUndefined();
    expect(current.deliveryLeadId).toBe("customer-lead");
  });

  it.each([
    ["Inactive", [{ ...people[1], status: "Inactive" }]],
    ["Missing", []],
    ["Ambiguous", [people[1], people[1]]],
  ])("rejects %s observation ownership without inventing a Person", (_label, owners) => {
    const input = { ...source(), people: [people[0], ...owners] };
    expect(() => createIcarusObservationAction(context(input, [], linkedMs), targetId, "monitor", "reviewer", [people[0], ...owners])).toThrow();
  });

  it("uses established delegation readiness instead of equating active identity with authority", () => {
    expect(() => createIcarusObservationAction(context(source(), [], linkedMs), targetId, "monitor", "reviewer",
      people.map((person) => person.id === "observer" ? { ...person, authority: "" } : person))).toThrow("readiness");
    expect(() => createIcarusObservationAction(context(source(), [], linkedMs), targetId, "monitor", "missing", people)).toThrow("unique active Person");
  });

  it("does not accept name-only or mismatched ownership, nor automatically transfer ownership", () => {
    const action = monitoring();
    expect(view(source(), [{ ...action, ownerPersonId: undefined }]).state).toBe("Unowned");
    expect(view(source(), [{ ...action, ownerPersonId: "delegate" }]).state).toBe("Unowned");
    const unlinked = { ...action, icarusObservationLinks: undefined, ownerPersonId: "delegate" };
    expect(() => linkIcarusObservationAction(context(source(), [execution(unlinked)], linkedMs), targetId, unlinked, "reviewer")).toThrow("accountable Person");
  });

  it("prevents duplicate creation and duplicate linkage, and detects imported duplicate cycle claims", () => {
    const action = monitoring();
    const current = context(source(), [execution(action)], linkedMs);
    expect(() => createIcarusObservationAction(current, targetId, "other", "reviewer", people)).toThrow("already exists");
    expect(() => createIcarusObservationAction(current, targetId, action.id, "reviewer", people)).toThrow("identity");
    expect(() => linkIcarusObservationAction(current, targetId, action, "reviewer")).toThrow("already linked");
    const duplicate = { ...action, id: "duplicate" };
    expect(view(source(), [action, duplicate]).issues.join()).toContain("Duplicate Actions");
    expect(view(source(), [{ ...action, icarusObservationLinks: [...action.icarusObservationLinks!, ...action.icarusObservationLinks!] }]).issues.join()).toContain("Duplicate observation-cycle");
    expect(view(source(), [action, action]).issues.join()).toContain("identity is ambiguous");
  });

  it("detects missing and deleted Actions and retains obligations after cancellation", () => {
    expect(view(source(), []).state).toBe("Missing");
    expect(view(source(), [{ ...monitoring(), status: "Cancelled" }])).toMatchObject({
      state: "Missing", actionIds: ["monitor"],
    });
    expect(view(source(), [], Date.parse("2026-05-08")).issues.join()).toContain("overdue");
  });

  it("keeps day-only deadline boundaries explicit and exposes blockers despite a future follow-up", () => {
    const action = monitoring();
    expect(view(source(), [action], Date.parse("2026-05-07T00:00:00Z")).state).toBe("Due");
    expect(view(source(), [action], Date.parse("2026-05-07T23:59:59.999Z")).state).toBe("Due");
    expect(view(source(), [action], Date.parse("2026-05-08T00:00:00Z")).state).toBe("Overdue");
    expect(view(source(), [{ ...action, status: "Blocked", followUpDate: "2026-06-01" }]).state).toBe("Blocked");
    expect(view(source(), [{ ...action, dueDate: "2026-05-08" }]).state).toBe("Invalid");
    expect(view(source(), [{ ...action, dueDate: "2026-02-30" }]).state).toBe("Invalid");
  });

  it.each([
    { completionEvidence: "", completionDate: testedAt },
    { completionEvidence: "Collected observation", completionDate: "" },
    { completionEvidence: "Collected observation", completionDate: routedAt },
    { completionEvidence: "Collected observation", completionDate: "2026-05-20" },
  ])("does not accept invalid Completed Action execution provenance: %j", (fields) => {
    const action: ActionRecord = { ...monitoring(), status: "Completed", ...fields };
    expect(view(source(), [action]).state).toBe("Completed without evidence");
    const { intelligence, attention } = command(source(), [action]);
    expect(attention.items.filter((item) => item.objectType === "Action" && item.id === action.id)).toHaveLength(1);
    expect(attention.items.find((item) => item.id === action.id)?.reason).toContain("Completed without evidence");
    expect(intelligence.treatment.verification.get(targetId)?.state).toBe("Awaiting verification");
  });

  it("keeps execution completion distinct from verified observation and leaves assurance untouched", () => {
    const input = source();
    const action: ActionRecord = { ...monitoring(input), status: "Completed", completionDate: testedAt, completionEvidence: "Collected test evidence" };
    const baseline = buildIcarusStrategicIntelligence(input);
    const { intelligence, attention } = command(input, [action]);
    expect(view(input, [action]).state).toBe("Awaiting verified observation");
    expect(intelligence.assurance).toEqual(baseline.assurance);
    expect(intelligence.treatment.verification).toEqual(baseline.treatment.verification);
    expect(attention.items.filter((item) => item.objectType === "Action" && item.id === action.id)).toHaveLength(1);
    expect(attention.items.some((item) => item.objectType === "Icarus")).toBe(false);
  });

  it("starts a new explicit review cycle only after admissible observation and cannot reuse a completed Action", () => {
    const action: ActionRecord = { ...monitoring(), status: "Completed", completionDate: testedAt, completionEvidence: "Recorded observation work" };
    const input = withOutcome();
    expect(view(input, [action])).toMatchObject({ state: "Missing", actionIds: [], reviewBy: "2026-05-10" });
    expect(getIcarusObservationActionOutcome(action.icarusObservationLinks![0],
      buildIcarusStrategicIntelligence(input).treatment.verification.get(targetId), input.assessments)?.id)
      .toBe(input.assessments[0].treatmentOutcomes![0].id);
    const next = createIcarusObservationAction(context(input, [execution(action)]), targetId, "next", "reviewer", people);
    expect(next.icarusObservationLinks![0].afterOutcomeId).toBe(input.assessments[0].treatmentOutcomes![0].id);
    expect(view(input, [action, next]).state).toBe("Scheduled");
    expect(() => linkIcarusObservationAction(context(input, [execution(action)]), targetId, action, "reviewer")).toThrow("active Action");
    const late = Date.parse("2026-05-11T10:00:00Z");
    expect(buildIcarusStrategicIntelligence({ ...input, nowMs: late }).treatment.verification.get(targetId)?.history[0])
      .toMatchObject({ current: false, observationCompleted: true });
    expect(view(input, [action], late)).toMatchObject({ state: "Missing", actionIds: [] });
    expect(createIcarusObservationAction(context(input, [execution(action)], late), targetId, "late-review", "reviewer", people).dueDate)
      .toBe("2026-05-10");
  });

  it("does not discharge an Action using an invalid or pre-assignment observation", () => {
    const valid = withOutcome();
    const malformed = { ...valid, assessments: [{ ...valid.assessments[0],
      treatmentOutcomes: valid.assessments[0].treatmentOutcomes!.map((record) => ({ ...record, completionConditions: undefined })),
    }] };
    const action = monitoring();
    expect(view(malformed, [action]).actionIds).toContain(action.id);
    const lateLinked: ActionRecord = { ...action, icarusObservationLinks: action.icarusObservationLinks!.map((link) => ({
      ...link, linkedAt: "2026-05-04T12:00:00.000Z",
    })) };
    expect(view(valid, [lateLinked]).actionIds).toContain(action.id);
  });

  it("accepts a valid Inconclusive criteria review as observed execution, never as effective protection", () => {
    const input = withOutcome();
    input.assessments[0].treatmentOutcomes = input.assessments[0].treatmentOutcomes!.map((record) => ({
      ...record, outcome: "Inconclusive", observationCriteriaResult: "Inconclusive",
      observationCriteriaNote: "Observed operation does not yet establish the acceptance criteria",
    }));
    const intelligence = buildIcarusStrategicIntelligence(input);
    expect(intelligence.treatment.verification.get(targetId)?.state).toBe("Verification inconclusive");
    expect(view(input, [monitoring()]).actionIds).toEqual([]);
  });

  it("cannot retrospectively mark an inconsistent effectiveness claim as a completed observation", () => {
    const input = withOutcome();
    input.assessments[0].controls[0].assuranceTests![0].result = "Failed";
    input.assessments[0].treatmentOutcomes = input.assessments[0].treatmentOutcomes!.map((record) => ({
      ...record, evidence: record.evidence.map((entry) => entry.kind === "Control test"
        ? { ...entry, result: "Failed", assuranceStatus: "Failed" } : entry),
    }));
    expect(buildIcarusStrategicIntelligence(input).treatment.verification.get(targetId)?.history[0])
      .toMatchObject({ current: false, observationCompleted: false });
    expect(view(input, [monitoring()]).actionIds).toContain("monitor");
  });

  it("cannot complete the next Action or extend protection by reviewing unchanged evidence again", () => {
    const input = withOutcome();
    const action = createIcarusObservationAction(context(input), targetId, "next", "reviewer", people);
    const original = input.assessments[0].treatmentOutcomes![0];
    input.assessments[0].treatmentOutcomes!.push({
      ...original, id: "reused-review", occurrenceId: "reused-review",
      verifiedAt: "2026-05-06T11:00:00.000Z", nextObservationBy: "2026-05-20",
    });
    const clock = Date.parse("2026-05-06T12:00:00.000Z");
    expect(buildIcarusStrategicIntelligence({ ...input, nowMs: clock }).treatment.verification.get(targetId)?.history[1])
      .toMatchObject({ current: false, observationCompleted: false });
    expect(view(input, [action], clock).actionIds).toContain(action.id);
  });

  it("preserves the overdue responsibility and Action history during owner and plan reassignment", () => {
    const input = source();
    const action = monitoring(input);
    const replacement: IcarusObservationPlan = {
      ...plan, id: "replacement", recordedAt: "2026-05-08T10:00:00.000Z",
      ownerPersonId: "delegate", firstReviewBy: "2026-05-20",
    };
    input.assessments[0].treatmentTargets![0].observationPlans!.push(replacement);
    const clock = Date.parse("2026-05-08T12:00:00.000Z");
    const reassigned: ActionRecord = { ...action, ownerPersonId: "delegate", owner: "Delegate" };
    expect(view(input, [action], clock)).toMatchObject({ state: "Stale", reviewBy: plan.firstReviewBy });
    expect(view(input, [reassigned], clock).state).toBe("Unowned");
    expect(() => createIcarusObservationAction(context(input, [execution(reassigned)], clock), targetId, "duplicate", "reviewer", people)).toThrow("already exists");
    const relinked = linkIcarusObservationAction(context(input, [execution(reassigned)], clock), targetId, reassigned, "reviewer");
    expect(relinked.icarusObservationLinks).toHaveLength(2);
    expect(relinked.icarusObservationLinks![0]).toEqual(action.icarusObservationLinks![0]);
    expect(view(input, [relinked], clock)).toMatchObject({ state: "Overdue", reviewBy: plan.firstReviewBy });
    const restored = parseIcarusAssessments(JSON.stringify(input.assessments));
    expect(restored[0].treatmentTargets![0].observationPlans).toHaveLength(2);
  });

  it("rejects revised protection scope that drops outstanding controls", () => {
    const input = source();
    const action = monitoring(input);
    input.assessments[0].controls.push({ ...input.assessments[0].controls[0], id: "second" });
    input.assessments[0].treatmentTargets![0].controlId = undefined;
    input.assessments[0].treatmentTargets![0].observationPlans!.push({
      ...plan, id: "narrower", recordedAt: "2026-05-06T09:00:00Z", controlIds: ["second"], firstReviewBy: "2026-05-20",
    });
    expect(view(input, [action]).state).toBe("Invalid");
    expect(() => linkIcarusObservationAction(context(input, [execution(action)]), targetId, action, "reviewer")).toThrow("invalid or unowned");
  });

  it("detects changed plan snapshots, orphaned targets and incorrect review-cycle chronology", () => {
    const action = monitoring();
    const altered: ActionRecord = { ...action, icarusObservationLinks: action.icarusObservationLinks!.map((link) => ({
      ...link, plan: { ...link.plan, acceptanceCriteria: "Changed without revision" },
    })) };
    expect(view(source(), [altered]).state).toBe("Invalid");
    const orphan: ActionRecord = { ...action, icarusObservationLinks: action.icarusObservationLinks!.map((link) => ({ ...link, treatmentTargetId: "missing" })) };
    expect(buildIcarusObservationExecutionIndex(context(source(), [execution(orphan)])).actionAttention[0].reasons.join()).toContain("missing or ambiguous");
    const future: ActionRecord = { ...action, icarusObservationLinks: action.icarusObservationLinks!.map((link) => ({
      ...link, linkedAt: "2026-05-20T10:00:00Z", afterOutcomeId: "missing-outcome",
    })) };
    expect(view(source(), [future]).issues.join()).toContain("chronology");
    expect(view(source(), [future]).issues.join()).toContain("review-cycle provenance");
    const withoutPlan = source();
    withoutPlan.assessments[0].treatmentTargets![0].observationPlans = undefined;
    expect(buildIcarusObservationExecutionIndex(context(withoutPlan, [execution(action)])).actionAttention[0].reasons.join())
      .toContain("plan is missing");
  });

  it("keeps live execution unchanged while stress-testing unavailable observers and blocked monitoring Actions", () => {
    const input = source();
    const action = monitoring(input);
    const stressedInput = { ...input, observationActions: [...(input.treatmentActions ?? []), execution(action)] };
    const baseline = buildIcarusStrategicIntelligence(stressedInput);
    const blocked = runIcarusStressTest(stressedInput, [{ type: "Action", actionId: action.id, state: "Blocked" }], baseline);
    expect(blocked.hypothetical.observationExecution?.byTargetId.get(targetId)?.state).toBe("Blocked");
    const unowned = runIcarusStressTest(stressedInput, [{ type: "Person", personId: "observer", state: "Unavailable" }], baseline);
    expect(unowned.hypothetical.observationExecution?.byTargetId.get(targetId)?.state).toBe("Unowned");
    expect(baseline.observationExecution?.byTargetId.get(targetId)?.state).toBe("Scheduled");
    expect(action.status).toBe("Open");
  });

  it("rejects invalid clocks explicitly instead of returning scheduled success-shaped state", () => {
    expect(() => buildIcarusObservationExecutionIndex(context(source(), [], NaN))).toThrow("valid explicit clock");
  });

  it("does not link the corrective treatment Action as its own monitoring execution", () => {
    const action: ActionRecord = { ...monitoring(), id: "corrective", icarusObservationLinks: undefined };
    expect(() => linkIcarusObservationAction(context(source(), [execution(action)], linkedMs), targetId, action, "reviewer")).toThrow("Corrective treatment");
  });

  it("merges overdue monitoring with the existing Action Command item without inventing material exposure", () => {
    const input = withOutcome();
    const action = createIcarusObservationAction(context(input), targetId, "next", "reviewer", people);
    const due = { ...input, nowMs: Date.parse("2026-05-10T12:00:00Z"), assessments: [{ ...input.assessments[0], status: "Closed" as const }] };
    const { intelligence, attention } = command(due, [action]);
    expect(intelligence.observationExecution?.byTargetId.get(targetId)?.state).toBe("Due");
    expect(getIcarusCurrentExposureSignals(intelligence.strategicSignals)).toEqual([]);
    expect(attention.items.filter((item) => item.id === action.id)).toHaveLength(1);
    expect(attention.items.some((item) => item.objectType === "Icarus")).toBe(false);
    const overdue = command({ ...due, nowMs: Date.parse("2026-05-11T00:00:00Z") }, [action]);
    expect(overdue.attention.items.filter((item) => item.id === action.id)).toHaveLength(1);
    expect(overdue.attention.items.find((item) => item.id === action.id)?.reason).toContain("overdue");
  });

  it("retains legacy records without auto-creating Actions or changing existing verification contracts", () => {
    const input = source();
    input.assessments[0].treatmentTargets![0].observationPlans = undefined;
    expect(buildIcarusObservationExecutionIndex(context(input)).byTargetId.size).toBe(0);
    expect(() => assertIcarusObservationActionLinks(undefined)).not.toThrow();
    expect(normalizeActionRecord({ ...monitoring(), icarusObservationLinks: undefined }).icarusObservationLinks).toBeUndefined();
    expect(() => assertIcarusObservationActionLinks([{ assessmentId: "risk" }])).toThrow("malformed");
  });

  it("round-trips linkage through the existing backup transaction and rejects malformed data before writes", () => {
    const action = monitoring();
    const records = JSON.stringify([action]);
    const storage = new Map<string, string>([[CONVERSION_STORAGE_KEY, records]]);
    const target = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    };
    const backup = buildFullBackup(target, verifiedAt);
    storage.set(CONVERSION_STORAGE_KEY, "[]");
    expect(runBackupRestoreTransaction(target, backup)).toEqual({ ok: true });
    expect(normalizeActionRecord(JSON.parse(storage.get(CONVERSION_STORAGE_KEY)!)[0]).icarusObservationLinks)
      .toEqual(action.icarusObservationLinks);
    const malformed = {
      format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: verifiedAt,
      storage: { [CONVERSION_STORAGE_KEY]: JSON.stringify([{ ...action, icarusObservationLinks: [{}] }]) },
    };
    expect(() => validateEmpireOsBackup(malformed)).toThrow("malformed");
    expect(runBackupRestoreTransaction(target, { ...backup, storage: malformed.storage }))
      .toMatchObject({ ok: false, writesStarted: false, rollbackFailures: [] });
    expect(storage.get(CONVERSION_STORAGE_KEY)).toBe(records);
    expect(buildIcarusObservationExecutionIndex(context(source(), [execution(action)])))
      .toEqual(buildIcarusObservationExecutionIndex(context(source(), [execution(action)])));
  });
});
