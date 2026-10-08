import { getIcarusReferenceKey, getIcarusTreatmentOutcomeEvidenceKey, classifyIcarusEvidenceFreshness } from "./icarus";
import type {
  IcarusAssessmentRecord,
  IcarusTreatmentOutcomeCategory,
  IcarusTreatmentOutcomeEvidence,
  IcarusTreatmentOutcomeRecord,
  IcarusTreatmentOutcomeStateFact,
  IcarusTreatmentCompletionCondition,
} from "./icarus";
import type {
  IcarusAcceptanceAssurance,
  IcarusAssessmentAssurance,
  IcarusControlAssurance,
  IcarusFailureModeAssurance,
} from "./icarus-assurance";
import type { IcarusDependencyHealthRegistry } from "./icarus-dependency-health";
import type { IcarusTreatmentTarget } from "./icarus-treatment";
import { getIcarusEffectiveProtection } from "./icarus-effective-protection";
import { isValidCalendarDateInput } from "./dates";
import {
  deriveIcarusObservationResponsibility, getIcarusCurrentObservationPlan, getIcarusObservationPlanIssues,
  getIcarusPlannedObservationIssues, getIcarusObservationEvidenceIssues, type IcarusObservationResponsibility,
} from "./icarus-observation-plan";

export type IcarusTreatmentVerificationOption = {
  outcome: IcarusTreatmentOutcomeCategory;
  evidence: readonly IcarusTreatmentOutcomeEvidence[];
  afterState: IcarusTreatmentOutcomeStateFact;
  attribution: "Supported" | "Uncertain" | "Not attributable";
  label: string;
};

export type IcarusTreatmentOutcomeView = {
  state: "Awaiting verification" | "Verification in progress" | "Verified effective"
    | "Partially effective" | "Verified ineffective" | "Verification inconclusive"
    | "No longer applicable" | "Superseded";
  options: readonly IcarusTreatmentVerificationOption[];
  issues?: readonly string[];
  history: readonly {
    record: IcarusTreatmentOutcomeRecord;
    current: boolean;
    evidenceCurrent?: boolean;
    observationCompleted?: boolean;
    attribution: "Supported" | "Uncertain" | "Not attributable";
    issues?: readonly string[];
  }[];
  latest?: IcarusTreatmentOutcomeRecord;
  completion?: { conditions: readonly IcarusTreatmentCompletionCondition[]; issues: readonly string[] };
  protection?: "Not observed" | "Observed — review required" | "Evidence-supported effectiveness"
    | "Repeated protection observed" | "Observation due" | "Protection deteriorated" | "Protection unknown";
  observation?: IcarusObservationResponsibility;
};

type VerificationAssurance = {
  byAssessmentId: ReadonlyMap<string, Pick<IcarusAssessmentAssurance, "assessmentId"> & {
    controls: readonly Pick<IcarusControlAssurance, "controlId" | "failureModeId" | "status" | "evidence" | "lastEvent">[];
    modes: readonly Pick<IcarusFailureModeAssurance, "failureModeId" | "material" | "assurance">[];
    acceptances: readonly Pick<IcarusAcceptanceAssurance, "current" | "validity">[];
  }>;
};

export type IcarusTreatmentOutcomeIndexInput = {
  assessments: readonly IcarusAssessmentRecord[];
  targets: readonly IcarusTreatmentTarget[];
  assurance: VerificationAssurance;
  dependencyHealth: IcarusDependencyHealthRegistry;
  nowMs?: number;
  people?: readonly { id: string; status: string }[];
};

export function getIcarusTreatmentCompletion(
  target: IcarusTreatmentTarget,
  nowMs: number,
): { conditions: IcarusTreatmentCompletionCondition[]; issues: string[] } {
  const issues: string[] = [];
  const conditions: IcarusTreatmentCompletionCondition[] = [];
  const reviews = [...(target.completionReviews ?? [])].sort((a, b) =>
    Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.id.localeCompare(b.id));
  const review = reviews.at(-1);
  if (!target.executionLinks.length) issues.push("Completion has no linked execution");
  if (review && (reviews.filter((entry) => entry.id === review.id).length !== 1
    || reviews.filter((entry) => entry.recordedAt === review.recordedAt).length !== 1
    || !sameExecutionLinks(review.executionLinks, target.executionLinks)
    || !review.recordedByPersonId.trim() || !review.note.trim()
    || !Number.isFinite(Date.parse(review.recordedAt)) || Date.parse(review.recordedAt) > nowMs
    || !isValidCalendarDateInput(review.recordedAt.slice(0, 10))
    || Date.parse(review.completedAt) > Date.parse(review.recordedAt))) {
    issues.push("Completion review provenance is invalid or no longer matches execution linkage");
  }
  target.executionLinks.forEach((link) => {
    const executions = target.executions.filter((execution) =>
      execution.recordType === link.recordType && execution.recordId === link.recordId);
    const execution = executions[0];
    const key = `${link.recordType}:${link.recordId}`;
    if (executions.length !== 1 || execution.status !== "Completed") {
      issues.push(`Execution is missing, ambiguous or not completed: ${key}`);
      return;
    }
    const operating = Boolean(execution.completedAt?.trim() || execution.completionEvidence?.trim());
    const completedAt = operating ? execution.completedAt ?? "" : review?.completedAt ?? "";
    const basis = operating ? execution.completionEvidence ?? "" : review?.note ?? "";
    const at = Date.parse(completedAt);
    if (!Number.isFinite(at) || !isValidCalendarDateInput(completedAt.slice(0, 10)) || !basis.trim()) {
      issues.push(`Completion date or completion evidence is missing or invalid: ${key}`);
      return;
    }
    if (at > nowMs || !Number.isFinite(Date.parse(link.linkedAt ?? "")) || at < Date.parse(link.linkedAt ?? "")) {
      issues.push(`Completion chronology is invalid: ${key}`);
    }
    conditions.push({
      recordType: link.recordType, recordId: link.recordId, completedAt, basis,
      source: operating ? "Operating record" : "Completion review",
      ...(!operating && review ? { completionReviewId: review.id } : {}),
    });
  });
  return { conditions, issues: [...new Set(issues)].sort() };
}

function sameCompletion(
  left: readonly IcarusTreatmentCompletionCondition[],
  right: readonly IcarusTreatmentCompletionCondition[],
) {
  const keys = (values: readonly IcarusTreatmentCompletionCondition[]) =>
    values.map((entry) => JSON.stringify([
      entry.recordType, entry.recordId, entry.completedAt, entry.source, entry.basis, entry.completionReviewId,
    ])).sort();
  return JSON.stringify(keys(left)) === JSON.stringify(keys(right));
}

// A new review cannot make a pre-treatment observation into treatment evidence.
export function getIcarusTreatmentVerificationIssues(
  target: IcarusTreatmentTarget,
  evidence: readonly IcarusTreatmentOutcomeEvidence[],
  assessments: readonly IcarusAssessmentRecord[],
  verifiedAtMs: number,
  nowMs: number,
  evidenceNotBeforeMs = -Infinity,
): string[] {
  const issues: string[] = [];
  if (!Number.isFinite(nowMs) || Number.isNaN(evidenceNotBeforeMs)) issues.push("Verification evidence clock is invalid");
  const matches = assessments.filter((assessment) => assessment.id === target.assessmentId);
  if (matches.length !== 1) issues.push("Missing or ambiguous treatment assessment");
  if (!Number.isFinite(verifiedAtMs) || verifiedAtMs > nowMs) issues.push("Verification date is invalid or in the future");
  if (!target.executionLinks.length) issues.push("No dated execution linkage");
  const linkedDates = target.executionLinks.map((link) => Date.parse(link.linkedAt ?? ""));
  if (linkedDates.some((at) => !Number.isFinite(at))) issues.push("Execution linkage date is missing or invalid");
  if (linkedDates.some((at) => at > verifiedAtMs)) issues.push("Verification precedes execution linkage");
  const completion = getIcarusTreatmentCompletion(target, verifiedAtMs);
  issues.push(...completion.issues);
  const completedAt = Math.max(...completion.conditions.map((condition) => Date.parse(condition.completedAt)));
  const routedAt = Math.max(...linkedDates, evidenceNotBeforeMs);
  evidence.forEach((entry) => {
    if (entry.kind !== "Control test") return;
    const controls = matches[0]?.controls.filter((control) =>
      control.id === entry.controlId && control.failureModeId === entry.failureModeId) ?? [];
    const tests = controls.flatMap((control) => control.assuranceTests ?? []).filter((test) => test.id === entry.testId);
    if (entry.assessmentId !== target.assessmentId || controls.length !== 1 || tests.length !== 1) {
      issues.push(`Missing or ambiguous source control test: ${entry.controlId}/${entry.testId}`);
      return;
    }
    const testedAt = Date.parse(tests[0].testedAt);
    if (tests[0].result !== entry.result || JSON.stringify([...tests[0].evidenceIds].sort())
      !== JSON.stringify([...entry.evidenceIds].sort())) {
      issues.push(`Source control test no longer matches recorded observation: ${entry.testId}`);
    }
    if (entry.result === "Passed" && entry.assuranceStatus === "Assured" && entry.evidenceStatus === "Current support"
      && entry.evidenceIds.length === 0) issues.push(`Passing test has no supporting evidence: ${entry.testId}`);
    if (!Number.isFinite(testedAt) || testedAt > verifiedAtMs) {
      issues.push(`Source control test postdates verification or has an invalid date: ${entry.testId}`);
    }
    if (testedAt < routedAt) issues.push(`Source control test predates treatment routing or intervention selection: ${entry.testId}`);
    if (testedAt < completedAt) issues.push(`Source control test predates execution completion: ${entry.testId}`);
    entry.evidenceIds.forEach((id) => {
      const modes = matches[0]?.failureModes.filter((mode) => mode.id === entry.failureModeId) ?? [];
      const sources = modes.flatMap((mode) => mode.evidence).filter((source) => source.id === id);
      if (modes.length !== 1 || sources.length !== 1) {
        issues.push(`Missing or ambiguous supporting evidence: ${id}`);
        return;
      }
      const source = sources[0];
      if (entry.result === "Passed" && entry.assuranceStatus === "Assured" && entry.evidenceStatus === "Current support"
        && (source.review !== "Supports"
        || ["Stale", "Invalid"].includes(classifyIcarusEvidenceFreshness(source, nowMs)))) {
        issues.push(`Supporting evidence is missing support, contradictory or stale: ${id}`);
      }
      if ([source.recordedAt, source.observedAt, source.reviewedAt].filter((at) => at !== undefined)
        .some((at) => !Number.isFinite(Date.parse(at)) || Date.parse(at) > verifiedAtMs)) {
        issues.push(`Supporting evidence postdates verification or has an invalid date: ${id}`);
      }
    });
  });
  return [...new Set(issues)].sort();
}

function sameEvidence(
  left: readonly IcarusTreatmentOutcomeEvidence[],
  right: readonly IcarusTreatmentOutcomeEvidence[],
): boolean {
  const keys = (evidence: readonly IcarusTreatmentOutcomeEvidence[]) =>
    [...new Set(evidence.map(getIcarusTreatmentOutcomeEvidenceKey))].sort();
  return JSON.stringify(keys(left)) === JSON.stringify(keys(right));
}

function sameExecutionLinks(
  left: IcarusTreatmentOutcomeRecord["executionLinks"],
  right: IcarusTreatmentTarget["executionLinks"],
): boolean {
  const keys = (links: IcarusTreatmentTarget["executionLinks"]) =>
    [...new Set(links.map((link) => JSON.stringify([link.recordType, link.recordId, link.linkedAt])))].sort();
  return JSON.stringify(keys(left)) === JSON.stringify(keys(right));
}

function sameAfterState(
  left: IcarusTreatmentOutcomeRecord["afterState"],
  right: IcarusTreatmentOutcomeStateFact,
): boolean {
  return left.kind === right.kind && left.state === right.state;
}

export function getIcarusTreatmentFollowUpIssues(
  record: IcarusTreatmentOutcomeRecord,
  previous: IcarusTreatmentOutcomeRecord | undefined,
  assessments: readonly IcarusAssessmentRecord[],
): string[] {
  if (!previous?.nextObservationBy || record.outcome !== "Effective") return [];
  const deadline = (value: string) => Date.parse(value.length === 10 ? `${value}T23:59:59.999Z` : value);
  const extending = !record.nextObservationBy || deadline(record.nextObservationBy) > deadline(previous.nextObservationBy);
  if (!extending && deadline(previous.nextObservationBy) >= Date.parse(record.verifiedAt)) return [];
  const tests = record.evidence.filter((entry) => entry.kind === "Control test");
  const fresh = tests.length > 0 && tests.every((entry) => {
    const source = assessments.filter((assessment) => assessment.id === entry.assessmentId)
      .flatMap((assessment) => assessment.controls.filter((control) => control.id === entry.controlId))
      .flatMap((control) => control.assuranceTests ?? []).filter((test) => test.id === entry.testId);
    return source.length === 1 && Date.parse(source[0].testedAt) > Date.parse(previous.verifiedAt);
  });
  return fresh ? [] : ["Follow-up requires a new source observation, not another review of the same evidence"];
}

function attributionFor(
  target: IcarusTreatmentTarget,
  evidence: readonly IcarusTreatmentOutcomeEvidence[],
): "Supported" | "Uncertain" | "Not attributable" {
  if (evidence.some((entry) => entry.kind === "Control test"
    && entry.assessmentId === target.assessmentId
    && entry.failureModeId === target.failureModeId
    && entry.controlId === target.controlId)) return "Supported";
  if (evidence.some((entry) => entry.kind === "Dependency health"
    && target.dependencyReference
    && getIcarusReferenceKey(entry.dependencyReference) === getIcarusReferenceKey(target.dependencyReference))) {
    return "Uncertain";
  }
  if (evidence.some((entry) => entry.kind === "Failure mode materiality"
    && entry.assessmentId === target.assessmentId
    && entry.failureModeId === target.failureModeId)) return "Not attributable";
  return "Not attributable";
}

function verificationOptions(
  target: IcarusTreatmentTarget,
  assessment: IcarusAssessmentRecord | undefined,
  assurance: VerificationAssurance,
  dependencyHealth: IcarusDependencyHealthRegistry,
): IcarusTreatmentVerificationOption[] {
  const options: IcarusTreatmentVerificationOption[] = [];
  if (target.dependencyReference) {
    const health = dependencyHealth.get(getIcarusReferenceKey(target.dependencyReference));
    if (health && health.source !== "Scenario override") {
      const evidence: IcarusTreatmentOutcomeEvidence = {
        kind: "Dependency health",
        dependencyReference: { ...health.reference },
        health: health.health,
        source: health.source,
        basis: [...health.basis].sort(),
      };
      // Operational status is context, not observed evidence of a treatment's effectiveness.
      const outcome = health.health === "Failed" ? "Ineffective" : "Inconclusive";
      options.push({
        outcome,
        evidence: [evidence],
        afterState: { kind: "Dependency health", state: health.health },
        attribution: "Uncertain",
        label: `${outcome} — dependency is ${health.health} (${health.basis.join(", ")}); operational status alone is not effectiveness evidence`,
      });
      return options;
    }
  }

  const assuranceAssessment = assurance.byAssessmentId.get(target.assessmentId);
  const modeId = target.failureModeId;
  const mode = assuranceAssessment?.modes.find((entry) => entry.failureModeId === modeId);
  const controlRecords = (assessment?.controls ?? []).filter((control) =>
    control.failureModeId === modeId && (!target.controlId || control.id === target.controlId));
  const controlAssurance = assuranceAssessment?.controls ?? [];
  const protectionImpaired = controlRecords.some((control) => {
    const status = controlAssurance.find((entry) => entry.controlId === control.id)?.status;
    return status && getIcarusEffectiveProtection(control, status, dependencyHealth).barrier !== "Active";
  });
  const observationControlIds = getIcarusCurrentObservationPlan(target)?.controlIds ?? [];
  const hasReferencedControlTest = controlRecords.some((control) =>
    (Boolean(target.controlId) || observationControlIds.includes(control.id))
    && controlAssurance.some((entry) => entry.controlId === control.id && entry.lastEvent?.source === "Control test"));
  // Loss of mode materiality does not replace a directly verifiable control-treatment observation.
  if (mode && !mode.material && target.failureModeId && !protectionImpaired && !hasReferencedControlTest) {
    const evidence: IcarusTreatmentOutcomeEvidence = {
      kind: "Failure mode materiality",
      assessmentId: target.assessmentId,
      failureModeId: mode.failureModeId,
      material: false,
    };
    return [{
      outcome: "No longer applicable",
      evidence: [evidence],
      afterState: { kind: "Failure mode materiality", state: "Not material" },
      attribution: "Not attributable",
      label: "No longer applicable — failure mode is not currently material",
    }];
  }
  const currentTests = controlRecords.flatMap((control) => {
    const controlStatus = controlAssurance.find((entry) => entry.controlId === control.id);
    const test = controlStatus?.lastEvent;
    if (!controlStatus || test?.source !== "Control test" || !test.testId) return [];
    const protection = getIcarusEffectiveProtection(control, controlStatus.status, dependencyHealth);
    // Hypothetical dependencies cannot support a real verification occurrence.
    if (protection.dependencies.some((dependency) => dependency.source === "Scenario override")) return [];
    const dependencies: IcarusTreatmentOutcomeEvidence[] = protection.dependencies.map((dependency) => ({
      kind: "Dependency health", dependencyReference: { ...dependency.reference },
      health: dependency.health, source: dependency.source === "Explicit" ? "Explicit" : "Derived",
      basis: [...dependency.basis].sort(),
    }));
    return [{
      evidence: {
        kind: "Control test" as const,
        assessmentId: target.assessmentId,
        failureModeId: control.failureModeId,
        controlId: control.id,
        testId: test.testId,
        result: test.result,
        assuranceStatus: controlStatus.status,
        evidenceStatus: controlStatus.evidence,
        evidenceIds: [...test.evidenceIds].sort(),
      },
      status: controlStatus.status,
      evidenceStatus: controlStatus.evidence,
      protection: protection.barrier,
      dependencies,
    }];
  });

  currentTests.forEach(({ evidence, status, protection, dependencies }) => {
    const outcome: IcarusTreatmentOutcomeCategory = evidence.result === "Passed"
      && status === "Assured" && evidence.evidenceStatus === "Current support" && protection === "Active"
      ? "Effective"
      : evidence.result === "Failed" || status === "Failed" || protection === "Failed" ? "Ineffective" : "Inconclusive";
    const attribution = dependencies.length > 0 ? "Uncertain" : attributionFor(target, [evidence]);
    options.push({
      outcome,
      evidence: [evidence, ...dependencies],
      afterState: { kind: "Control assurance", state: status ?? "Untested" },
      attribution,
      label: `${outcome} — ${evidence.controlId} test ${evidence.testId}: ${evidence.result.toLowerCase()}; effective protection ${protection.toLowerCase()}${evidence.evidenceIds.length > 0 ? `; evidence ${evidence.evidenceIds.join(", ")}` : ""}`,
    });
  });

  if (mode?.assurance === "Partially assured") {
    const modeTests = currentTests.filter(({ evidence }) => evidence.failureModeId === mode.failureModeId);
    if (modeTests.some(({ status, evidenceStatus, protection }) => status === "Assured" && evidenceStatus === "Current support" && protection === "Active")
      && modeTests.some(({ status }) => status === "Failed")) {
      const evidence = modeTests.flatMap(({ evidence: entry, dependencies }) => [entry, ...dependencies]);
      options.push({
        outcome: "Partially effective",
        evidence,
        afterState: { kind: "Control assurance", state: "Partially assured" },
        attribution: attributionFor(target, evidence),
        label: "Partially effective — mixed current control-test results",
      });
    }
  }

  return options.sort((left, right) => left.outcome.localeCompare(right.outcome)
    || left.label.localeCompare(right.label));
}

function verifiedState(outcome: IcarusTreatmentOutcomeCategory): IcarusTreatmentOutcomeView["state"] {
  switch (outcome) {
    case "Effective": return "Verified effective";
    case "Partially effective": return "Partially effective";
    case "Ineffective": return "Verified ineffective";
    case "Inconclusive": return "Verification inconclusive";
    case "No longer applicable": return "No longer applicable";
  }
}

export function buildIcarusTreatmentOutcomeIndex(
  input: IcarusTreatmentOutcomeIndexInput,
): ReadonlyMap<string, IcarusTreatmentOutcomeView> {
  const nowMs = input.nowMs ?? Date.now();
  const assessmentsById = new Map(input.assessments.map((assessment) => [assessment.id, assessment] as const));
  const outcomes = input.assessments.flatMap((assessment) => assessment.treatmentOutcomes ?? []);
  const result = new Map<string, IcarusTreatmentOutcomeView>();

  input.targets.forEach((target) => {
    const plan = getIcarusCurrentObservationPlan(target);
    const people = input.people ?? [];
    const records = outcomes.filter((outcome) => outcome.treatmentTargetId === target.id)
      .slice()
      .sort((left, right) => left.verifiedAt.localeCompare(right.verifiedAt) || left.id.localeCompare(right.id));
    const completion = getIcarusTreatmentCompletion(target, nowMs);
    const assessment = assessmentsById.get(target.assessmentId);
    let candidates = target.state === "Completed — verification required"
      ? verificationOptions(target, assessment, input.assurance, input.dependencyHealth)
      : [];
    if (plan) {
      const scoped = plan.controlIds.flatMap((controlId) => candidates.filter((option) =>
        option.evidence.some((entry) => entry.kind === "Control test" && entry.controlId === controlId)
        && option.evidence.filter((entry) => entry.kind === "Control test").length === 1));
      candidates = scoped.length === plan.controlIds.length && scoped.length > 0 ? [{
        outcome: scoped.every((option) => option.outcome === "Effective") ? "Effective"
          : scoped.some((option) => option.outcome === "Ineffective") ? "Ineffective" : "Inconclusive",
        evidence: scoped.flatMap((option) => [...option.evidence]),
        afterState: scoped.length === 1 ? scoped[0].afterState
          : { kind: "Control assurance", state: scoped.every((option) => option.outcome === "Effective") ? "Assured" : "Inconclusive" },
        attribution: scoped.every((option) => option.attribution === "Supported") ? "Supported" : "Uncertain",
        label: `Planned observation: ${plan.protection} — ${scoped.map((option) => option.label).join("; ")}`,
      }] : [];
      if (candidates[0]?.outcome === "Effective") candidates.push({
        ...candidates[0], outcome: "Inconclusive",
        label: "Inconclusive — operating tests passed but the declared acceptance criteria are not established",
      });
    }
    const evaluated = candidates.map((option) => ({
      option, issues: [
        ...getIcarusTreatmentVerificationIssues(target, option.evidence, input.assessments, nowMs, nowMs),
        ...(plan ? getIcarusObservationEvidenceIssues(target, plan, option.evidence, records.at(-1), input.assessments) : []),
      ],
    }));
    const planIssues = plan ? getIcarusObservationPlanIssues(target, plan, input.assessments, people, nowMs) : [];
    const issues = [...new Set([
      ...(target.state === "Completed — verification required"
        ? getIcarusTreatmentVerificationIssues(target, [], input.assessments, nowMs, nowMs) : []),
      ...evaluated.flatMap((entry) => entry.issues),
      ...planIssues,
    ])].sort();
    const options = evaluated.filter((entry) => !entry.issues.length && !planIssues.length).map((entry) => entry.option);
    const history = records.map((record, recordIndex) => {
      const recordIssues = getIcarusTreatmentVerificationIssues(
        target, record.evidence, input.assessments, Date.parse(record.verifiedAt), nowMs,
      );
      if (record.assessmentId !== target.assessmentId) recordIssues.push("Outcome belongs to a different assessment");
      if (outcomes.filter((outcome) => outcome.id === record.id).length !== 1) recordIssues.push("Ambiguous treatment outcome identity");
      if (!sameExecutionLinks(record.executionLinks, target.executionLinks)) recordIssues.push("Execution linkage provenance has changed");
      if (!record.completionConditions?.length) recordIssues.push("Recorded verification has no completion provenance");
      else if (!sameCompletion(record.completionConditions, completion.conditions)) recordIssues.push("Execution completion provenance has changed");
      if (record.nextObservationBy && Date.parse(record.nextObservationBy.length === 10
        ? `${record.nextObservationBy}T23:59:59.999Z` : record.nextObservationBy) < Date.parse(record.verifiedAt)) {
        recordIssues.push("Observation deadline precedes verification");
      }
      if (record.nextObservationBy !== undefined && (!Number.isFinite(Date.parse(record.nextObservationBy))
        || !isValidCalendarDateInput(record.nextObservationBy.slice(0, 10)))) {
        recordIssues.push("Observation deadline is invalid");
      }
      recordIssues.push(...getIcarusTreatmentFollowUpIssues(record, records[recordIndex - 1], input.assessments));
      if (plan) recordIssues.push(...getIcarusPlannedObservationIssues(
        target, plan, record, records[recordIndex - 1], input.assessments, people, nowMs,
      ));
      else if (record.observationPlan) recordIssues.push("Recorded observation plan is no longer attached to the treatment");
      if (record.nextObservationBy && Date.parse(record.nextObservationBy.length === 10
        ? `${record.nextObservationBy}T23:59:59.999Z` : record.nextObservationBy) < nowMs) {
        recordIssues.push("Follow-up effectiveness observation is due");
      }
      const currentOption = evaluated.filter((entry) => !planIssues.length
        && !getIcarusTreatmentVerificationIssues(target, entry.option.evidence, input.assessments, nowMs, nowMs).length)
        .map((entry) => entry.option).find((option) => option.outcome === record.outcome
        && sameEvidence(option.evidence, record.evidence)
        && sameAfterState(record.afterState, option.afterState)
        && target.state === "Completed — verification required"
        && recordIssues.length === 0);
      if (!currentOption && !recordIssues.length) recordIssues.push("Recorded outcome no longer matches current source evidence or execution state");
      const retainedPlan = target.observationPlans?.find((entry) => entry.id === record.observationPlan?.id);
      const recordedTests = record.evidence.filter((entry) => entry.kind === "Control test");
      const historicalOutcomeConsistent = Boolean(currentOption)
        || record.outcome === "Inconclusive"
        || record.outcome === "Effective" && recordedTests.length > 0
          && recordedTests.every((test) => test.result === "Passed" && test.assuranceStatus === "Assured"
            && test.evidenceStatus === "Current support")
          && record.afterState.kind === "Control assurance" && record.afterState.state === "Assured"
        || record.outcome === "Ineffective" && recordedTests.some((test) => test.result === "Failed")
          && record.afterState.kind === "Control assurance" && record.afterState.state === "Failed"
        || record.outcome === "Partially effective"
          && recordedTests.some((test) => test.result === "Passed" && test.assuranceStatus === "Assured" && test.evidenceStatus === "Current support")
          && recordedTests.some((test) => test.result === "Failed")
          && record.afterState.kind === "Control assurance" && record.afterState.state === "Partially assured";
      // Historical observation completion is not current assurance. Evaluate its evidence at the review time.
      const observationCompleted = Boolean(retainedPlan && record.observationPlan
        && historicalOutcomeConsistent
        && record.assessmentId === target.assessmentId
        && outcomes.filter((outcome) => outcome.id === record.id).length === 1
        && record.completionConditions?.length && sameCompletion(record.completionConditions, completion.conditions)
        && sameExecutionLinks(record.executionLinks, target.executionLinks)
        && Date.parse(record.verifiedAt) <= nowMs
        && !getIcarusTreatmentVerificationIssues(
          target, record.evidence, input.assessments, Date.parse(record.verifiedAt), Date.parse(record.verifiedAt),
        ).length
        && !getIcarusTreatmentFollowUpIssues(record, records[recordIndex - 1], input.assessments).length
        && !getIcarusPlannedObservationIssues(
          target, retainedPlan, record, records[recordIndex - 1], input.assessments, people, Date.parse(record.verifiedAt),
        ).length);
      return {
        record,
        current: recordIndex === records.length - 1 && Boolean(currentOption),
        evidenceCurrent: Boolean(currentOption),
        ...(record.observationPlan ? { observationCompleted } : {}),
        attribution: currentOption?.attribution ?? "Not attributable" as const,
        issues: recordIssues,
      };
    });
    const latest = history[history.length - 1];
    const state = !latest
      ? target.state === "Completed — verification required" ? "Awaiting verification" : "Verification in progress"
      : latest.current
        ? verifiedState(latest.record.outcome)
        : "Superseded";
    const effective = latest?.current && latest.record.outcome === "Effective";
    const deadline = latest?.record.nextObservationBy;
    const due = deadline && Date.parse(deadline.length === 10 ? `${deadline}T23:59:59.999Z` : deadline) < nowMs;
    const repeated = effective && history.slice(0, -1).some((entry) => {
      const prior = entry.record;
      if (prior.outcome !== "Effective" || !prior.completionConditions
        || !sameCompletion(prior.completionConditions, completion.conditions)
        || !sameExecutionLinks(prior.executionLinks, target.executionLinks)
        || prior.assessmentId !== target.assessmentId
        || outcomes.filter((record) => record.id === prior.id).length !== 1
        || getIcarusTreatmentVerificationIssues(target, prior.evidence, input.assessments, Date.parse(prior.verifiedAt), nowMs).length
        || sameEvidence(prior.evidence, latest.record.evidence)) return false;
      const currentTests = latest.record.evidence.filter((evidence) => evidence.kind === "Control test");
      const priorTests = prior.evidence.filter((evidence) => evidence.kind === "Control test");
      return currentTests.length > 0 && currentTests.every((current) => {
        const previous = priorTests.find((evidence) => evidence.controlId === current.controlId);
        const control = assessment?.controls.find((entry) => entry.id === current.controlId);
        const before = control?.assuranceTests?.find((test) => test.id === previous?.testId);
        const after = control?.assuranceTests?.find((test) => test.id === current.testId);
        return previous && before && after && previous.result === "Passed"
          && Date.parse(after.testedAt) > Date.parse(before.testedAt)
          && !control?.assuranceTests?.some((test) => Date.parse(test.testedAt) > Date.parse(before.testedAt)
            && Date.parse(test.testedAt) <= Date.parse(after.testedAt) && test.result !== "Passed");
      });
    });
    const hadEffective = records.some((record) => record.outcome === "Effective");
    const deteriorated = hadEffective && candidates.some((option) => option.outcome === "Ineffective");
    const protection: NonNullable<IcarusTreatmentOutcomeView["protection"]> = deteriorated ? "Protection deteriorated"
      : due && latest?.record.outcome === "Effective" ? "Observation due"
      : effective ? repeated ? "Repeated protection observed" : "Evidence-supported effectiveness"
      : hadEffective ? "Protection unknown"
        : options.length ? "Observed — review required" : "Not observed";
    result.set(target.id, {
      state,
      options,
      issues,
      history,
      completion,
      protection,
      observation: deriveIcarusObservationResponsibility(target, input.assessments, people, history, nowMs),
      ...(latest ? { latest: latest.record } : {}),
    });
  });
  return result;
}
