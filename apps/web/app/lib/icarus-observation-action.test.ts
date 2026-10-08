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
