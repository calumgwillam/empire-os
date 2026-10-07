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
  history: readonly {
    record: IcarusTreatmentOutcomeRecord;
    current: boolean;
    evidenceCurrent?: boolean;
    attribution: "Supported" | "Uncertain" | "Not attributable";
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
};

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
  const keys = (links: readonly { recordType: "Action" | "Project"; recordId: string }[]) =>
    [...new Set(links.map((link) => `${link.recordType}:${link.recordId}`))].sort();
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
      const outcome = health.health === "Healthy" && health.basis.includes("on-track-project") ? "Effective"
        : health.health === "Failed" ? "Ineffective" : "Inconclusive";
      options.push({
        outcome,
        evidence: [evidence],
        afterState: { kind: "Dependency health", state: health.health },
        attribution: "Uncertain",
        label: `${outcome} — dependency is ${health.health} (${health.basis.join(", ")})`,
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
  if (mode && !mode.material && target.failureModeId && !protectionImpaired) {
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
  const assessmentsById = new Map(input.assessments.map((assessment) => [assessment.id, assessment] as const));
  const outcomes = input.assessments.flatMap((assessment) => assessment.treatmentOutcomes ?? []);
  const result = new Map<string, IcarusTreatmentOutcomeView>();

  input.targets.forEach((target) => {
    const assessment = assessmentsById.get(target.assessmentId);
    const options = target.state === "Completed — verification required"
      ? verificationOptions(target, assessment, input.assurance, input.dependencyHealth)
      : [];
    const records = outcomes.filter((outcome) => outcome.treatmentTargetId === target.id)
      .slice()
      .sort((left, right) => left.verifiedAt.localeCompare(right.verifiedAt) || left.id.localeCompare(right.id));
    const history = records.map((record, recordIndex) => {
      const currentOption = options.find((option) => option.outcome === record.outcome
        && sameEvidence(option.evidence, record.evidence)
        && sameAfterState(record.afterState, option.afterState)
        && target.state === "Completed — verification required"
        && sameExecutionLinks(record.executionLinks, target.executionLinks));
      return {
        record,
        current: recordIndex === records.length - 1 && Boolean(currentOption),
        evidenceCurrent: Boolean(currentOption),
        attribution: currentOption?.attribution ?? "Not attributable" as const,
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
      history,
      ...(latest ? { latest: latest.record } : {}),
    });
  });
  return result;
}
