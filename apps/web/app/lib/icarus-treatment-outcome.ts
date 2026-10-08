import { getIcarusReferenceKey, getIcarusTreatmentOutcomeEvidenceKey } from "./icarus";
import type {
  IcarusAssessmentRecord,
  IcarusTreatmentOutcomeCategory,
  IcarusTreatmentOutcomeEvidence,
  IcarusTreatmentOutcomeRecord,
  IcarusTreatmentOutcomeStateFact,
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
    attribution: "Supported" | "Uncertain" | "Not attributable";
    issues?: readonly string[];
  }[];
  latest?: IcarusTreatmentOutcomeRecord;
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
};

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
    if (!Number.isFinite(testedAt) || testedAt > verifiedAtMs) {
      issues.push(`Source control test postdates verification or has an invalid date: ${entry.testId}`);
    }
    if (testedAt < routedAt) issues.push(`Source control test predates treatment routing or intervention selection: ${entry.testId}`);
    entry.evidenceIds.forEach((id) => {
      const modes = matches[0]?.failureModes.filter((mode) => mode.id === entry.failureModeId) ?? [];
      const sources = modes.flatMap((mode) => mode.evidence).filter((source) => source.id === id);
      if (modes.length !== 1 || sources.length !== 1) {
        issues.push(`Missing or ambiguous supporting evidence: ${id}`);
        return;
      }
      const source = sources[0];
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
  const hasReferencedControlTest = Boolean(target.controlId) && controlRecords.some((control) => controlAssurance.some((entry) =>
    entry.controlId === control.id && entry.lastEvent?.source === "Control test"));
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
    const assessment = assessmentsById.get(target.assessmentId);
    const candidates = target.state === "Completed — verification required"
      ? verificationOptions(target, assessment, input.assurance, input.dependencyHealth)
      : [];
    const evaluated = candidates.map((option) => ({
      option, issues: getIcarusTreatmentVerificationIssues(target, option.evidence, input.assessments, nowMs, nowMs),
    }));
    const issues = [...new Set([
      ...(target.state === "Completed — verification required"
        ? getIcarusTreatmentVerificationIssues(target, [], input.assessments, nowMs, nowMs) : []),
      ...evaluated.flatMap((entry) => entry.issues),
    ])].sort();
    const options = evaluated.filter((entry) => !entry.issues.length).map((entry) => entry.option);
    const records = outcomes.filter((outcome) => outcome.treatmentTargetId === target.id)
      .slice()
      .sort((left, right) => left.verifiedAt.localeCompare(right.verifiedAt) || left.id.localeCompare(right.id));
    const history = records.map((record, recordIndex) => {
      const recordIssues = getIcarusTreatmentVerificationIssues(
        target, record.evidence, input.assessments, Date.parse(record.verifiedAt), nowMs,
      );
      if (record.assessmentId !== target.assessmentId) recordIssues.push("Outcome belongs to a different assessment");
      if (outcomes.filter((outcome) => outcome.id === record.id).length !== 1) recordIssues.push("Ambiguous treatment outcome identity");
      if (!sameExecutionLinks(record.executionLinks, target.executionLinks)) recordIssues.push("Execution linkage provenance has changed");
      const currentOption = options.find((option) => option.outcome === record.outcome
        && sameEvidence(option.evidence, record.evidence)
        && sameAfterState(record.afterState, option.afterState)
        && target.state === "Completed — verification required"
        && recordIssues.length === 0);
      if (!currentOption && !recordIssues.length) recordIssues.push("Recorded outcome no longer matches current source evidence or execution state");
      return {
        record,
        current: recordIndex === records.length - 1 && Boolean(currentOption),
        evidenceCurrent: Boolean(currentOption),
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
    result.set(target.id, {
      state,
      options,
      issues,
      history,
      ...(latest ? { latest: latest.record } : {}),
    });
  });
  return result;
}
