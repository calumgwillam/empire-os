import {
  getIcarusIdentityKey,
  getIcarusLatestControlAssuranceEvent,
  type IcarusAssessmentRecord,
  type IcarusAssessmentStatus,
  type IcarusRecordReference,
  type IcarusReview,
  type IcarusReviewFinding,
  type IcarusReviewFindingCode,
  type IcarusSourceType,
} from "./icarus";
import {
  classifyIcarusControlGap,
  classifyIcarusExposure,
  classifyIcarusMechanismEvidence,
  composeIcarusRankingScore,
  deriveIcarusStrategicScope,
  getIcarusAttentionScore,
  getIcarusCommandRank,
  getIcarusExposureRank,
  getIcarusFounderFocusBand,
  getIcarusMaterialityTier,
  getIcarusObjectiveImportanceRank,
  getIcarusScopeRank,
  type IcarusControlGap,
  type IcarusExposure,
  type IcarusMaterialityTier,
  type IcarusMechanismEvidence,
  type IcarusObjectiveImportance,
  type IcarusStrategicScope,
} from "./icarus-materiality-policy";
import {
  adjustIcarusCommandRankForAssurance,
  adjustIcarusFounderFocusBandForAssurance,
  getIcarusAssuranceCommandReasons,
  ICARUS_OBLIGATION_LABEL,
  type IcarusSignalAssurance,
} from "./icarus-assurance-policy";
import { deriveIcarusRelationships, type IcarusRelationship } from "./icarus-relationships";
import {
  adjustIcarusCommandRankForFailureChain,
  adjustIcarusFounderFocusBandForFailureChain,
  type IcarusSignalFailureChain,
} from "./icarus-failure-chain-policy";
import {
  compareOperatingPillars,
  resolveOperatingPillar,
  resolveStrategicTheme,
  type OperatingPillarIdentity,
  type StrategicTheme,
} from "./pillar-identity";

// Re-exported so existing consumers keep a stable import surface; the policy module is authoritative.
export {
  ICARUS_EXPOSURES,
  getIcarusExposureRank,
  type IcarusControlGap,
  type IcarusExposure,
  type IcarusMechanismEvidence,
  type IcarusObjectiveImportance,
  type IcarusStrategicScope,
} from "./icarus-materiality-policy";

export type IcarusStrategicObjectiveContext = {
  // Legacy field: the objective's pillar value. Resolved explicitly as an operating pillar or a
  // strategic theme; a strategic theme is never treated as an operating pillar.
  area: string;
  importance: IcarusObjectiveImportance;
  // Only live (e.g. Active/Watching) objectives confer strategic consequence.
  isLive: boolean;
  // Live objective record links, used for Expanded relationships (correlation context only).
  linkedProjectIds?: readonly string[];
  linkedOpportunityIds?: readonly string[];
  linkedDecisionIds?: readonly string[];
};

export type IcarusWeakness =
  | "No operating control"
  | "Failing control"
  | "Unverified control"
  | "Control review overdue"
  | "Weak evidence"
  | "Conflicting evidence"
  | "Incomplete mechanism";

export type IcarusAttentionReference = {
  identityKey: string;
  assessmentId: string;
  failureModeId?: string;
  controlId?: string;
  evidenceId?: string;
};

export type IcarusMaterialFailureMode = {
  failureModeId: string;
  mechanism: string;
  exposure: IcarusExposure;
  controlGap: IcarusControlGap;
  evidence: IcarusMechanismEvidence;
  weaknesses: IcarusWeakness[];
  findingCodes: IcarusReviewFindingCode[];
  weakControlIds: string[];
  overdueControlIds: string[];
  supportingEvidenceIds: string[];
};

export type IcarusAttentionTarget = {
  objectType: "Problem" | "Action" | "Decision" | "Opportunity" | "Project" | "Lead" | "Lesson" | "System" | "SOP" | "Outreach" | "Finance";
  id: string;
};

export type IcarusStrategicSignal = {
  key: string;
  assessmentId: string;
  outcome: string;
  status: IcarusAssessmentStatus;
  exposure: IcarusExposure;
  materialityTier: IcarusMaterialityTier;
  scope: IcarusStrategicScope;
  objectiveImportance?: IcarusObjectiveImportance;
  // Display area: the canonical operating-pillar label when attributable, otherwise "Icarus".
  area: string;
  // Canonical operating pillars explicitly linked (assessment, control or evidence Pillar links).
  operatingPillars: OperatingPillarIdentity[];
  // Strategic themes of live linked objectives; deliberately separate from operating pillars.
  strategicThemes: StrategicTheme[];
  strategicLinks: IcarusRecordReference[];
  // Authoritative relationship set (direct + expanded) with provenance.
  relationships: IcarusRelationship[];
  // Attention identities of direct assessment links only: the same underlying issue elsewhere in Command/Focus.
  anchors: IcarusAttentionTarget[];
  materialFailureModes: IcarusMaterialFailureMode[];
  weaknesses: IcarusWeakness[];
  hasOverdueControlReview: boolean;
  riskScore: number;
  primaryReference: IcarusAttentionReference;
  summary: string;
  // Attached by attachIcarusAssuranceToSignals (icarus-assurance). Absent => pre-assurance behaviour.
  assurance?: IcarusSignalAssurance;
  // Attached by attachIcarusFailureChainToSignals (icarus-failure-chain-analysis). Absent => pre-failure-chain behaviour.
  failureChain?: IcarusSignalFailureChain;
  treatment?: {
    attentionReasons: readonly string[];
    founderOwnedCount: number;
    delegatedCount: number;
  };
};

export type IcarusStrategicAttentionInput = {
  assessments: readonly IcarusAssessmentRecord[];
  reviews: readonly IcarusReview[];
  includeClosedAssessments?: boolean;
  // When supplied, objective links only count if the objective exists and is live.
  strategicObjectives?: ReadonlyMap<string, IcarusStrategicObjectiveContext>;
};

const weaknessOrder: readonly IcarusWeakness[] = [
  "No operating control",
  "Failing control",
  "Unverified control",
  "Control review overdue",
  "Weak evidence",
  "Conflicting evidence",
  "Incomplete mechanism",
];

const weaknessByCode: Partial<Record<IcarusReviewFindingCode, IcarusWeakness>> = {
  "missing-control": "No operating control",
  "ineffective-control": "Failing control",
  "contradicted-control": "Failing control",
  "weak-control": "Failing control",
  "planned-control": "Unverified control",
  "untested-control": "Unverified control",
  "missing-control-review": "Unverified control",
  "invalid-control-assessment": "Unverified control",
  "invalid-control-review": "Unverified control",
  "stale-control-review": "Control review overdue",
  "failed-control-test": "Failing control",
  "inconclusive-control-test": "Unverified control",
  "unsupported-control-test": "Unverified control",
  "overdue-control-test": "Control review overdue",
  "no-evidence": "Weak evidence",
  "unreviewed-evidence": "Weak evidence",
  "unresolved-evidence": "Weak evidence",
  "stale-evidence": "Weak evidence",
  "invalid-evidence": "Weak evidence",
  "conflicting-evidence": "Conflicting evidence",
  "incomplete-failure-mode": "Incomplete mechanism",
};

const failingControlCodes: readonly IcarusReviewFindingCode[] = ["ineffective-control", "contradicted-control", "weak-control", "failed-control-test"];
const overdueControlCodes: readonly IcarusReviewFindingCode[] = ["stale-control-review", "overdue-control-test"];
// Findings that mean an operating control cannot currently be relied on as the verified control.
const controlVerificationBlockers: readonly IcarusReviewFindingCode[] = [
  "untested-control",
  "weak-control",
  "ineffective-control",
  "contradicted-control",
  "stale-control-review",
  "invalid-control-review",
  "invalid-control-assessment",
  "conflicting-evidence",
  "failed-control-test",
  "inconclusive-control-test",
  "unsupported-control-test",
  "overdue-control-test",
];
const unusableEvidenceCodes: readonly IcarusReviewFindingCode[] = ["invalid-evidence", "stale-evidence", "missing-source"];

const directTargetTypes: readonly IcarusSourceType[] = [
  "Problem",
  "Action",
  "Decision",
  "Opportunity",
  "Project",
  "Lead",
  "Lesson",
  "System",
  "SOP",
  "Outreach",
];

// Maps an Icarus linked record onto the identity used by Command/Founder attention, when one exists.
export function getIcarusAttentionTarget(reference: IcarusRecordReference): IcarusAttentionTarget | null {
  if (directTargetTypes.includes(reference.recordType)) {
    return { objectType: reference.recordType as IcarusAttentionTarget["objectType"], id: reference.recordId };
  }
  if (reference.recordType === "Commitment") return { objectType: "Finance", id: `commitment:${reference.recordId}` };
  return null;
}

function classifyFailureMode(
  assessment: IcarusAssessmentRecord,
  modeIndex: number,
  findings: readonly IcarusReviewFinding[],
  strategic: boolean,
): IcarusMaterialFailureMode | null {
  const mode = assessment.failureModes[modeIndex];
  const modeFindings = findings.filter((finding) => finding.failureModeId === mode.id);
  const controls = assessment.controls.filter((control) => control.failureModeId === mode.id);
  const controlFindingCodes = (controlId: string) =>
    modeFindings.filter((finding) => finding.controlId === controlId).map((finding) => finding.code);

  const verifiedControl = controls.some((control) =>
    (control.lifecycle === "Active" || control.lifecycle === "Monitoring")
    // The latest assurance event (explicit test, or the legacy effectiveness review) must be a pass.
    && getIcarusLatestControlAssuranceEvent(control)?.result === "Passed"
    && !controlFindingCodes(control.id).some((code) => controlVerificationBlockers.includes(code)));
  if (verifiedControl) return null;

  const currentEvidence = mode.evidence.filter((evidence) => !modeFindings.some((finding) =>
    finding.evidenceId === evidence.id && unusableEvidenceCodes.includes(finding.code)));
  const supportingEvidenceIds = currentEvidence.filter((evidence) => evidence.review === "Supports").map((evidence) => evidence.id);
  const evidence: IcarusMechanismEvidence = classifyIcarusMechanismEvidence({
    supportingCount: supportingEvidenceIds.length,
    contradictingCount: currentEvidence.filter((evidence) => evidence.review === "Contradicts").length,
  });

  const weakControlIds = controls
    .filter((control) => controlFindingCodes(control.id).some((code) => failingControlCodes.includes(code)))
    .map((control) => control.id);
  const operatingControls = controls.filter((control) => control.lifecycle === "Active" || control.lifecycle === "Monitoring");
  const controlGap: IcarusControlGap = classifyIcarusControlGap({
    failingControlCount: weakControlIds.length,
    operatingControlCount: operatingControls.length,
  });

  // Contradicted mechanisms and unexamined non-strategic modes are not current strategic exposures.
  const exposure = classifyIcarusExposure({ evidence, controlGap, strategicallyLinked: strategic });
  if (!exposure) return null;

  const findingCodes = Array.from(new Set(modeFindings.map((finding) => finding.code))).sort();
  const weaknessSet = new Set<IcarusWeakness>();
  findingCodes.forEach((code) => {
    const weakness = weaknessByCode[code];
    if (weakness) weaknessSet.add(weakness);
  });
  if (controlGap === "Uncontrolled") weaknessSet.add("No operating control");
  const overdueControlIds = controls
    .filter((control) => controlFindingCodes(control.id).some((code) => overdueControlCodes.includes(code)))
    .map((control) => control.id);

  return {
    failureModeId: mode.id,
    mechanism: mode.mechanism.trim() || mode.vulnerability.trim() || "Unstated failure mechanism",
    exposure,
    controlGap,
    evidence,
    weaknesses: weaknessOrder.filter((weakness) => weaknessSet.has(weakness)),
    findingCodes,
    weakControlIds: weakControlIds.length > 0
      ? weakControlIds
      : controls
        .filter((control) => control.lifecycle !== "Retired" && controlFindingCodes(control.id).some((code) => controlVerificationBlockers.includes(code) || code === "planned-control"))
        .map((control) => control.id),
    overdueControlIds,
    supportingEvidenceIds,
  };
}

function describeExposure(mode: IcarusMaterialFailureMode): string {
  if (mode.exposure === "Exposed") {
    return mode.controlGap === "Failing"
      ? "evidenced failure mechanism whose control is recorded as ineffective, weak or contradicted"
      : "evidenced failure mechanism with no operating control";
  }
  if (mode.exposure === "Failing control") return "control recorded as ineffective, weak or contradicted";
  if (mode.exposure === "Unverified control") {
    return mode.overdueControlIds.length > 0
      ? "evidenced failure mechanism relies on a control whose review is overdue"
      : "evidenced failure mechanism relies on an unverified control";
  }
  return "strategically linked failure mechanism has no control and no reviewed evidence";
}

// Derives at most one strategic attention signal per non-Closed assessment; hygiene-only findings stay in Icarus.
export function buildIcarusStrategicAttention(input: IcarusStrategicAttentionInput): IcarusStrategicSignal[] {
  const reviewsById = new Map(input.reviews.map((review) => [review.assessmentId, review] as const));
  const signals: IcarusStrategicSignal[] = [];

  input.assessments.forEach((assessment) => {
    if ((assessment.status === "Closed" && !input.includeClosedAssessments) || !assessment.outcome.trim()) return;
    const findings = reviewsById.get(assessment.id)?.findings ?? [];
    // Pillar links only confer strategic scope when they resolve to a canonical operating pillar.
    const strategicLinks = assessment.linkedRecords.filter((reference) => {
      if (reference.recordType === "Pillar") return resolveOperatingPillar(reference.recordId) !== null;
      if (reference.recordType !== "Strategic Objective") return false;
      if (!input.strategicObjectives) return true;
      return input.strategicObjectives.get(reference.recordId)?.isLive === true;
    });
    const objectiveContexts = strategicLinks
      .filter((reference) => reference.recordType === "Strategic Objective")
      .map((reference) => input.strategicObjectives?.get(reference.recordId))
      .filter((context): context is IcarusStrategicObjectiveContext => Boolean(context))
      .sort((left, right) => getIcarusObjectiveImportanceRank(left.importance) - getIcarusObjectiveImportanceRank(right.importance));
    const objectiveImportance = objectiveContexts[0]?.importance;
    const scope: IcarusStrategicScope = deriveIcarusStrategicScope({
      liveObjectiveLinked: strategicLinks.some((reference) => reference.recordType === "Strategic Objective"),
      operatingPillarLinked: strategicLinks.some((reference) => reference.recordType === "Pillar"),
    });

    const materialFailureModes = assessment.failureModes
      .map((_, index) => classifyFailureMode(assessment, index, findings, scope !== "Operational"))
      .filter((mode): mode is IcarusMaterialFailureMode => mode !== null);
    if (materialFailureModes.length === 0) return;

    const orderedModes = materialFailureModes
      .map((mode, index) => ({ mode, index }))
      .sort((left, right) =>
        getIcarusExposureRank(left.mode.exposure) - getIcarusExposureRank(right.mode.exposure)
        || right.mode.weaknesses.length - left.mode.weaknesses.length
        || left.index - right.index)
      .map(({ mode }) => mode);
    const primary = orderedModes[0];
    const weaknessSet = new Set(orderedModes.flatMap((mode) => mode.weaknesses));
    const weaknesses = weaknessOrder.filter((weakness) => weaknessSet.has(weakness));
    const hasOverdueControlReview = orderedModes.some((mode) => mode.overdueControlIds.length > 0);

    const riskScore = composeIcarusRankingScore({
      exposure: primary.exposure,
      scope,
      objectiveImportance,
      materialFailureModeCount: orderedModes.length,
      weaknessCount: weaknesses.length,
      hasOverdueControlReview,
    });

    const relationships = deriveIcarusRelationships({
      assessment,
      failureModes: orderedModes,
      ...(input.strategicObjectives ? { objectives: input.strategicObjectives } : {}),
    });
    const operatingPillarsById = new Map<string, OperatingPillarIdentity>();
    relationships
      .filter((relationship) => relationship.kind === "Direct" && relationship.reference.recordType === "Pillar")
      .forEach((relationship) => {
        const pillar = resolveOperatingPillar(relationship.reference.recordId);
        if (pillar) operatingPillarsById.set(pillar.id, pillar);
      });
    const operatingPillars = [...operatingPillarsById.values()].sort(compareOperatingPillars);
    const assessmentPillar = strategicLinks
      .map((reference) => reference.recordType === "Pillar" ? resolveOperatingPillar(reference.recordId) : null)
      .find((pillar): pillar is OperatingPillarIdentity => pillar !== null);
    const objectivePillar = objectiveContexts
      .map((context) => resolveOperatingPillar(context.area))
      .find((pillar): pillar is OperatingPillarIdentity => pillar !== null);
    const strategicThemes = [...new Set(objectiveContexts
      .map((context) => resolveStrategicTheme(context.area))
      .filter((theme): theme is StrategicTheme => theme !== null))].sort();
    const anchorKeys = new Set<string>();
    const anchors: IcarusAttentionTarget[] = [];
    // Only the assessment's own direct links identify "the same issue". Control/evidence links point at the
    // mechanism used to manage or observe the risk, so folding the risk into them would hide it.
    relationships
      .filter((relationship) => relationship.kind === "Direct" && relationship.origin === "Assessment link")
      .forEach((relationship) => {
        const target = getIcarusAttentionTarget(relationship.reference);
        if (!target || anchorKeys.has(`${target.objectType}:${target.id}`)) return;
        anchorKeys.add(`${target.objectType}:${target.id}`);
        anchors.push(target);
      });

    const concentration = orderedModes.length > 1
      ? ` ${orderedModes.length} failure modes are materially exposed.`
      : "";
    signals.push({
      key: getIcarusIdentityKey(assessment.id),
      assessmentId: assessment.id,
      outcome: assessment.outcome.trim(),
      status: assessment.status,
      exposure: primary.exposure,
      materialityTier: getIcarusMaterialityTier(primary.exposure),
      scope,
      ...(objectiveImportance ? { objectiveImportance } : {}),
      area: (assessmentPillar ?? objectivePillar ?? operatingPillars[0])?.label ?? "Icarus",
      operatingPillars,
      strategicThemes,
      strategicLinks: strategicLinks.map((reference) => ({ ...reference })),
      relationships,
      anchors,
      materialFailureModes: orderedModes,
      weaknesses,
      hasOverdueControlReview,
      riskScore,
      primaryReference: {
        identityKey: getIcarusIdentityKey(assessment.id),
        assessmentId: assessment.id,
        failureModeId: primary.failureModeId,
        ...(primary.weakControlIds[0] ? { controlId: primary.weakControlIds[0] } : {}),
        ...(primary.supportingEvidenceIds[0] ? { evidenceId: primary.supportingEvidenceIds[0] } : {}),
      },
      summary: `${primary.mechanism} — ${describeExposure(primary)}.${concentration}`,
    });
  });

  return signals.sort((left, right) =>
    getIcarusExposureRank(left.exposure) - getIcarusExposureRank(right.exposure)
    || getIcarusScopeRank(left.scope) - getIcarusScopeRank(right.scope)
    || right.riskScore - left.riskScore
    || left.outcome.localeCompare(right.outcome)
    || left.assessmentId.localeCompare(right.assessmentId));
}

const commandExposureReason: Record<IcarusExposure, string> = {
  "Exposed": "ICARUS: EXPOSED FAILURE MODE",
  "Failing control": "ICARUS: CONTROL FAILING",
  "Unverified control": "ICARUS: CONTROL UNVERIFIED",
  "Unexamined strategic exposure": "ICARUS: UNEXAMINED STRATEGIC RISK",
};

export type IcarusCommandPlacement = {
  attentionRank: number;
  tieWeight: number;
  priorityScore: number;
  reasons: string[];
  anchoredReason: string;
  statusText: string;
};

// Command placement deliberately sits below blocked/overdue execution (ranks 1–2).
export function getIcarusCommandPlacement(signal: IcarusStrategicSignal): IcarusCommandPlacement {
  // Assurance may lift an Icarus item by one step (assurance failure) but never into execution ranks 1–2.
  const baseRank = getIcarusCommandRank(signal.exposure, signal.hasOverdueControlReview);
  // A Critical systemic failure chain may lift one step, but never on top of an assurance lift.
  const attentionRank = adjustIcarusCommandRankForFailureChain(
    adjustIcarusCommandRankForAssurance(baseRank, signal.assurance),
    baseRank,
    signal.failureChain,
  );
  const reasons = [commandExposureReason[signal.exposure]];
  if (signal.scope === "Strategic objective") {
    reasons.push(signal.objectiveImportance ? `${signal.objectiveImportance.toUpperCase()} OBJECTIVE LINKED` : "STRATEGIC OBJECTIVE LINKED");
  }
  else if (signal.scope === "Pillar") reasons.push("PILLAR LINKED");
  if (signal.hasOverdueControlReview) reasons.push("CONTROL REVIEW OVERDUE");
  if (signal.materialFailureModes.length > 1) reasons.push(`${signal.materialFailureModes.length} MATERIAL FAILURE MODES`);
  if (signal.weaknesses.includes("Weak evidence")) reasons.push("EVIDENCE WEAK");
  reasons.push(...getIcarusAssuranceCommandReasons(signal.assurance));
  if (signal.failureChain?.commandReason) reasons.push(signal.failureChain.commandReason);
  const modeCount = signal.materialFailureModes.length;
  return {
    attentionRank,
    tieWeight: signal.scope === "Strategic objective" ? 2 : signal.scope === "Pillar" ? 1 : 0,
    priorityScore: signal.riskScore,
    reasons,
    anchoredReason: `ICARUS RISK: ${signal.outcome} (${signal.exposure.toLowerCase()})`,
    statusText: `${signal.status} assessment / ${signal.exposure} / ${modeCount} material failure mode${modeCount === 1 ? "" : "s"} / ${signal.scope}${signal.assurance ? ` / Assurance: ${signal.assurance.state}` : ""}`,
  };
}

export type IcarusFounderFocusRisk = {
  key: string;
  objectType: "Icarus";
  id: string;
  title: string;
  area: string;
  band: number;
  score: number;
  reason: string;
  anchorRecordKeys: string[];
  referenceKey: string;
};

// Founder Focus distinguishes "a material risk exists" from "the assurance/governance around it has failed".
function describeFounderFocusReason(signal: IcarusStrategicSignal, scopeText: string): string {
  const assurance = signal.assurance;
  const gaps = (assurance?.escalationCategories ?? []).map((category) => ICARUS_OBLIGATION_LABEL[category].toLowerCase());
  const chain = signal.failureChain?.focusReason ? ` ${signal.failureChain.focusReason}` : "";
  if (assurance?.escalation === "Assurance failure") {
    return `Icarus assurance failure${scopeText} — ${gaps.join("; ")}. Underlying risk: ${signal.summary}${chain}`;
  }
  const base = `Icarus strategic risk${scopeText} — ${signal.summary}`;
  const governance = assurance?.escalation === "Governance gap" ? ` Governance gap: ${gaps.join("; ")}.` : "";
  const accepted = assurance?.materialModesAccepted && assurance.acceptance === "Active" ? " Exposure is formally accepted and under review." : "";
  return `${base}${governance}${accepted}${chain}`;
}

// Founder Focus bands: 1 authority, 2 blocked/overdue/review due, 3 material, 4–5 structural.
export function buildIcarusFounderFocusRisks(signals: readonly IcarusStrategicSignal[]): IcarusFounderFocusRisk[] {
  return signals.map((signal) => {
    const baseBand = getIcarusFounderFocusBand(signal.exposure, signal.hasOverdueControlReview);
    const band = adjustIcarusFounderFocusBandForFailureChain(
      adjustIcarusFounderFocusBandForAssurance(baseBand, signal.assurance),
      baseBand,
      signal.failureChain,
    );
    const scopeText = signal.scope === "Operational"
      ? ""
      : ` (${signal.objectiveImportance ? `${signal.objectiveImportance.toLowerCase()} ` : ""}${signal.scope.toLowerCase()} linked)`;
    return {
      key: `Icarus:${signal.assessmentId}`,
      objectType: "Icarus",
      id: signal.assessmentId,
      title: signal.outcome,
      area: signal.area,
      band,
      score: getIcarusAttentionScore(signal.riskScore),
      reason: describeFounderFocusReason(signal, scopeText),
      anchorRecordKeys: signal.anchors.map((anchor) => `${anchor.objectType}:${anchor.id}`),
      referenceKey: signal.key,
    };
  });
}
