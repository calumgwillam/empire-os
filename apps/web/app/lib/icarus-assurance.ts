import {
  getIcarusControlTestDueAt,
  getIcarusIdentityKey,
  getIcarusLatestControlAssuranceEvent,
  type IcarusAssessmentRecord,
  type IcarusAssessmentStatus,
  type IcarusControl,
  type IcarusControlAssuranceEvent,
  type IcarusExposureAcceptance,
  type IcarusReview,
  type IcarusReviewFindingCode,
} from "./icarus";
import {
  ICARUS_OBLIGATION_KIND,
  ICARUS_OBLIGATION_LABEL,
  aggregateIcarusAssuranceState,
  getIcarusObligationMaterialityRank,
  getIcarusObligationRank,
  isIcarusRemediationStalled,
  type IcarusAcceptanceInvalidReason,
  type IcarusAcceptanceValidity,
  type IcarusAssuranceBasis,
  type IcarusAssuranceDepth,
  type IcarusAssuranceState,
  type IcarusControlAssuranceStatus,
  type IcarusControlIndependence,
  type IcarusEscalationLevel,
  type IcarusModeAssurance,
  type IcarusObligationCategory,
  type IcarusObligationDueState,
  type IcarusObligationKind,
  type IcarusObligationMateriality,
  type IcarusOwnershipState,
  type IcarusRemediationState,
  type IcarusSignalAssurance,
} from "./icarus-assurance-policy";
import { getIcarusMaterialityTier, type IcarusExposure, type IcarusObjectiveImportance } from "./icarus-materiality-policy";
import type {
  IcarusAttentionReference,
  IcarusStrategicObjectiveContext,
  IcarusStrategicSignal,
} from "./icarus-strategic-attention";
import { resolveOperatingPillar } from "./pillar-identity";

// Derives Icarus strategic assurance from persisted Icarus records plus explicit People/Action identities.
// Pure: no persistence, no Action creation, no inference from names or free text.

export const ICARUS_RISK_REVIEW_INTERVAL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type IcarusAssurancePerson = { id: string; status: string };
export type IcarusAssuranceAction = { id: string; status: string; dueDate?: string };

export type IcarusAssuranceInput = {
  assessments: readonly IcarusAssessmentRecord[];
  reviews: readonly IcarusReview[];
  // Material strategic signals (buildIcarusStrategicAttention); defines which risks/modes are material.
  signals: readonly IcarusStrategicSignal[];
  people: readonly IcarusAssurancePerson[];
  actions: readonly IcarusAssuranceAction[];
  // The resolved primary founder Person id (delegation readiness), when known.
  primaryFounderId: string | null;
  // True when existing People intelligence shows active founder-dependent work.
  founderDependencyActive: boolean;
  strategicObjectives?: ReadonlyMap<string, IcarusStrategicObjectiveContext>;
  // Defaults to the current time, matching buildIcarusReview.
  nowMs?: number;
};

export type IcarusControlEvidenceQuality = "Current support" | "No current support" | "Conflicting" | "Not applicable";

export type IcarusControlAssurance = {
  controlId: string;
  failureModeId: string;
  intervention: string;
  status: IcarusControlAssuranceStatus;
  ownerPersonId?: string;
  ownership: IcarusOwnershipState;
  everTested: boolean;
  lastEvent?: IcarusControlAssuranceEvent;
  testCadenceDays?: number;
  nextDueAt?: string;
  evidence: IcarusControlEvidenceQuality;
  findingCodes: IcarusReviewFindingCode[];
};

export type IcarusFailureModeAssurance = {
  failureModeId: string;
  mechanism: string;
  material: boolean;
  exposure?: IcarusExposure;
  assurance: IcarusModeAssurance;
  depth: IcarusAssuranceDepth;
  independence: IcarusControlIndependence;
  operatingControlIds: string[];
  assuredControlIds: string[];
  failedControlIds: string[];
  acceptanceId?: string;
};

export type IcarusAcceptanceAssurance = {
  acceptanceId: string;
  validity: IcarusAcceptanceValidity;
  invalidReasons: IcarusAcceptanceInvalidReason[];
  failureModeIds: string[];
  acceptedByPersonId: string;
  acceptedAt: string;
  reviewBy: string;
  rationale: string;
  conditions?: string;
  // False when a newer acceptance covers every one of its failure modes.
  current: boolean;
};

export type IcarusAssuranceObligation = {
  id: string;
  category: IcarusObligationCategory;
  kind: IcarusObligationKind;
  label: string;
  assessmentId: string;
  failureModeId?: string;
  controlId?: string;
  acceptanceId?: string;
  evidenceIds: string[];
  reason: string;
  materiality: IcarusObligationMateriality;
  dueState: IcarusObligationDueState;
  dueAt?: string;
  ownerPersonId?: string;
  ownerSource: "Control owner" | "Risk owner" | "Approver" | "None";
  remediation: IcarusRemediationState;
  actionIds: string[];
  escalates: boolean;
  reference: IcarusAttentionReference;
};

export type IcarusAssessmentAssurance = {
  assessmentId: string;
  outcome: string;
  status: IcarusAssessmentStatus;
  material: boolean;
  state: IcarusAssuranceState;
  basis: IcarusAssuranceBasis[];
  ownership: IcarusOwnershipState;
  riskOwnerPersonId?: string;
  founderOwned: boolean;
  founderOwnershipConcern: boolean;
  lastReviewedAt?: string;
  modes: IcarusFailureModeAssurance[];
  controls: IcarusControlAssurance[];
  acceptances: IcarusAcceptanceAssurance[];
  obligations: IcarusAssuranceObligation[];
  escalation: IcarusEscalationLevel;
  evidenceWeaknessCodes: IcarusReviewFindingCode[];
  operatingPillarIds: string[];
  objectiveIds: string[];
  objectiveImportance?: IcarusObjectiveImportance;
  signal: IcarusSignalAssurance;
};

export type IcarusAssuranceResult = {
  assessments: IcarusAssessmentAssurance[];
  byAssessmentId: ReadonlyMap<string, IcarusAssessmentAssurance>;
  obligations: IcarusAssuranceObligation[];
};

const failedCodes: readonly IcarusReviewFindingCode[] = ["ineffective-control", "weak-control", "contradicted-control", "failed-control-test"];
const overdueCodes: readonly IcarusReviewFindingCode[] = ["overdue-control-test", "stale-control-review"];
const insufficientCodes: readonly IcarusReviewFindingCode[] = [
  "unsupported-control-test",
  "untested-control",
  "conflicting-evidence",
  "invalid-control-assessment",
  "invalid-control-review",
];
const unusableEvidenceCodes: readonly IcarusReviewFindingCode[] = ["invalid-evidence", "stale-evidence", "missing-source"];
const evidenceWeaknessCodeSet: readonly IcarusReviewFindingCode[] = [
  "no-evidence",
  "unreviewed-evidence",
  "unresolved-evidence",
  "stale-evidence",
  "invalid-evidence",
  "conflicting-evidence",
];

function parseDeadline(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T23:59:59.999Z`) : Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function toIso(ms: number | undefined): string | undefined {
  return ms === undefined || !Number.isFinite(ms) ? undefined : new Date(ms).toISOString();
}

function dueStateOf(dueAtMs: number | undefined, nowMs: number, fallback: IcarusObligationDueState = "No date"): IcarusObligationDueState {
  if (dueAtMs === undefined) return fallback;
  return dueAtMs < nowMs ? "Overdue" : "Scheduled";
}

function resolveOwnership(personId: string | undefined, people: ReadonlyMap<string, IcarusAssurancePerson>): IcarusOwnershipState {
  const id = personId?.trim();
  if (!id) return "Unassigned";
  const person = people.get(id);
  if (!person) return "Unknown person";
  return person.status === "Active" ? "Assigned" : "Inactive person";
}

const ownershipReason: Record<Exclude<IcarusOwnershipState, "Assigned">, string> = {
  "Unassigned": "no owner is recorded",
  "Unknown person": "the recorded owner is not a known Person",
  "Inactive person": "the recorded owner is no longer an active Person",
};

function deriveRemediation(
  actionIds: readonly string[],
  actions: ReadonlyMap<string, IcarusAssuranceAction>,
  nowMs: number,
): IcarusRemediationState {
  if (actionIds.length === 0) return "None";
  const states = actionIds.map((actionId): IcarusRemediationState => {
    const action = actions.get(actionId);
    if (!action) return "Missing action";
    if (action.status === "Completed") return "Completed";
    if (action.status === "Cancelled") return "Cancelled";
    if (action.status === "Blocked") return "Blocked";
    const due = parseDeadline(action.dueDate);
    return due !== undefined && due < nowMs ? "Overdue" : "In progress";
  });
  // Active remediation is reported at its weakest point; finished/abandoned links only when nothing is active.
  const order: readonly IcarusRemediationState[] = ["Blocked", "Overdue", "In progress", "Completed", "Cancelled", "Missing action"];
  return order.find((state) => states.includes(state)) ?? "None";
}

function classifyControl(
  control: IcarusControl,
  codes: readonly IcarusReviewFindingCode[],
  latest: IcarusControlAssuranceEvent | undefined,
): IcarusControlAssuranceStatus {
  if (control.lifecycle === "Retired" || control.lifecycle === "Planned") return "Not operating";
  if (codes.some((code) => failedCodes.includes(code))) return "Failed";
  if (!latest) return "Untested";
  if (codes.some((code) => overdueCodes.includes(code))) return "Test overdue";
  if (latest.result === "Inconclusive" || codes.includes("inconclusive-control-test")) return "Inconclusive";
  if (codes.some((code) => insufficientCodes.includes(code))) return "Evidence insufficient";
  return latest.result === "Passed" ? "Assured" : "Untested";
}

function evaluateAcceptance(
  acceptance: IcarusExposureAcceptance,
  people: ReadonlyMap<string, IcarusAssurancePerson>,
  nowMs: number,
): Pick<IcarusAcceptanceAssurance, "validity" | "invalidReasons"> {
  if (acceptance.revokedAt) return { validity: "Revoked", invalidReasons: [] };
  const invalidReasons: IcarusAcceptanceInvalidReason[] = [];
  if (people.get(acceptance.acceptedByPersonId)?.status !== "Active") invalidReasons.push("approver-not-active-person");
  if (!acceptance.rationale.trim()) invalidReasons.push("missing-rationale");
  const acceptedAt = parseDeadline(acceptance.acceptedAt);
  const reviewBy = parseDeadline(acceptance.reviewBy);
  if (acceptedAt === undefined || reviewBy === undefined) invalidReasons.push("invalid-dates");
  else if (reviewBy < acceptedAt) invalidReasons.push("review-before-acceptance");
  if (invalidReasons.length > 0) return { validity: "Invalid", invalidReasons };
  return { validity: reviewBy! < nowMs ? "Expired" : "Active", invalidReasons: [] };
}

function compareAcceptanceRecency(left: IcarusExposureAcceptance, right: IcarusExposureAcceptance): number {
  return (parseDeadline(right.acceptedAt) ?? Number.NEGATIVE_INFINITY) - (parseDeadline(left.acceptedAt) ?? Number.NEGATIVE_INFINITY)
    || right.id.localeCompare(left.id);
}

function buildAssessmentAssurance(
  assessment: IcarusAssessmentRecord,
  input: IcarusAssuranceInput & { nowMs: number },
  context: {
    reviewCodes: (controlId: string) => IcarusReviewFindingCode[];
    allFindings: IcarusReview["findings"];
    signal?: IcarusStrategicSignal;
    people: ReadonlyMap<string, IcarusAssurancePerson>;
    actions: ReadonlyMap<string, IcarusAssuranceAction>;
  },
): IcarusAssessmentAssurance {
  const { signal, people, actions } = context;
  const { nowMs } = input;
  const assessmentKey = getIcarusIdentityKey(assessment.id);
  const materialModes = new Map((signal?.materialFailureModes ?? []).map((mode) => [mode.failureModeId, mode] as const));

  // ── Ownership (A) ──
  const riskOwnerPersonId = assessment.accountableOwnerPersonId?.trim() || undefined;
  const ownership = resolveOwnership(riskOwnerPersonId, people);
  const founderOwned = ownership === "Assigned" && input.primaryFounderId !== null && riskOwnerPersonId === input.primaryFounderId;
  const founderOwnershipConcern = founderOwned && input.founderDependencyActive;

  // ── Acceptance (F) ──
  const ordered = [...(assessment.acceptances ?? [])].sort(compareAcceptanceRecency);
  const currentAcceptanceByMode = new Map<string, IcarusExposureAcceptance>();
  ordered.filter((acceptance) => !acceptance.revokedAt).forEach((acceptance) =>
    acceptance.failureModeIds.forEach((id) => {
      if (!currentAcceptanceByMode.has(id)) currentAcceptanceByMode.set(id, acceptance);
    }));
  const currentAcceptanceIds = new Set([...currentAcceptanceByMode.values()].map((acceptance) => acceptance.id));
  const acceptances: IcarusAcceptanceAssurance[] = ordered.map((acceptance) => ({
    acceptanceId: acceptance.id,
    ...evaluateAcceptance(acceptance, people, nowMs),
    failureModeIds: [...acceptance.failureModeIds],
    acceptedByPersonId: acceptance.acceptedByPersonId,
    acceptedAt: acceptance.acceptedAt,
    reviewBy: acceptance.reviewBy,
    rationale: acceptance.rationale,
    ...(acceptance.conditions ? { conditions: acceptance.conditions } : {}),
    current: currentAcceptanceIds.has(acceptance.id),
  }));
  const acceptanceById = new Map(acceptances.map((acceptance) => [acceptance.acceptanceId, acceptance] as const));
  const activeAcceptanceFor = (failureModeId: string) => {
    const acceptance = currentAcceptanceByMode.get(failureModeId);
    return acceptance && acceptanceById.get(acceptance.id)?.validity === "Active" ? acceptance : undefined;
  };

  // ── Control assurance (B, D, E) ──
  const controls: IcarusControlAssurance[] = assessment.controls.map((control) => {
    const codes = context.reviewCodes(control.id);
    const latest = getIcarusLatestControlAssuranceEvent(control);
    const status = classifyControl(control, codes, latest);
    const cadenceDue = status === "Not operating" ? undefined : getIcarusControlTestDueAt(control);
    const reviewDue = status === "Not operating" ? undefined : parseDeadline(control.nextReviewAt);
    const nextDue = [cadenceDue, reviewDue].filter((value): value is number => value !== undefined).sort((a, b) => a - b)[0];
    const mode = assessment.failureModes.find((entry) => entry.id === control.failureModeId);
    let evidence: IcarusControlEvidenceQuality = "Not applicable";
    if (latest) {
      const unusable = new Set(context.allFindings
        .filter((finding) => finding.evidenceId && unusableEvidenceCodes.includes(finding.code))
        .map((finding) => finding.evidenceId!));
      const cited = (mode?.evidence ?? []).filter((entry) => latest.evidenceIds.includes(entry.id) && !unusable.has(entry.id));
      const supports = cited.some((entry) => entry.review === "Supports");
      const contradicts = cited.some((entry) => entry.review === "Contradicts");
      evidence = supports && contradicts ? "Conflicting" : supports ? "Current support" : "No current support";
    }
    const ownerPersonId = control.ownerPersonId?.trim() || undefined;
    return {
      controlId: control.id,
      failureModeId: control.failureModeId,
      intervention: control.intervention,
      status,
      ...(ownerPersonId ? { ownerPersonId } : {}),
      ownership: resolveOwnership(ownerPersonId, people),
      everTested: latest !== undefined,
      ...(latest ? { lastEvent: latest } : {}),
      ...(control.testCadenceDays ? { testCadenceDays: control.testCadenceDays } : {}),
      ...(toIso(nextDue) ? { nextDueAt: toIso(nextDue) } : {}),
      evidence,
      findingCodes: [...new Set(codes)].sort(),
    };
  });

  // ── Failure-mode assurance + depth ──
  const basis = new Set<IcarusAssuranceBasis>();
  const modes: IcarusFailureModeAssurance[] = assessment.failureModes.map((mode) => {
    const modeControls = controls.filter((control) => control.failureModeId === mode.id);
    const operatingControlIds = modeControls.filter((control) => control.status !== "Not operating").map((control) => control.controlId);
    const assuredControlIds = modeControls.filter((control) => control.status === "Assured").map((control) => control.controlId);
    const failedControlIds = modeControls.filter((control) => control.status === "Failed").map((control) => control.controlId);
    const material = materialModes.get(mode.id);
    const acceptance = activeAcceptanceFor(mode.id);
    let assurance: IcarusModeAssurance;
    if (assuredControlIds.length > 0) {
      assurance = failedControlIds.length > 0 ? "Partially assured" : "Assured";
      basis.add(failedControlIds.length > 0 ? "mixed-control-results" : "tested-control");
    } else if (acceptance) {
      assurance = "Accepted";
      basis.add("valid-acceptance");
    } else if (failedControlIds.length > 0) {
      assurance = "Failing";
      basis.add("failing-control");
    } else if (material?.exposure === "Exposed") {
      assurance = "Failing";
      basis.add("evidenced-uncontrolled-mechanism");
    } else {
      assurance = "Unassured";
      basis.add(operatingControlIds.length > 0 ? "untested-control" : "uncontrolled-mechanism");
    }
    return {
      failureModeId: mode.id,
      mechanism: mode.mechanism.trim() || mode.vulnerability.trim() || "Unstated failure mechanism",
      material: Boolean(material),
      ...(material ? { exposure: material.exposure } : {}),
      assurance,
      depth: assuredControlIds.length === 0 ? "None" : assuredControlIds.length === 1 ? "Single control" : "Layered",
      independence: "Unknown",
      operatingControlIds,
      assuredControlIds,
      failedControlIds,
      ...(acceptance ? { acceptanceId: acceptance.id } : {}),
    };
  });
  if (modes.length === 0) basis.add("no-failure-modes");
  const state = aggregateIcarusAssuranceState(modes.map((mode) => mode.assurance));

  // ── Strategic context for review/depth obligations ──
  const objectiveIds = assessment.linkedRecords
    .filter((reference) => reference.recordType === "Strategic Objective")
    .filter((reference) => !input.strategicObjectives || input.strategicObjectives.get(reference.recordId)?.isLive === true)
    .map((reference) => reference.recordId);
  const importanceOrder: readonly IcarusObjectiveImportance[] = ["Critical", "High", "Medium"];
  const objectiveImportance = objectiveIds
    .map((id) => input.strategicObjectives?.get(id)?.importance)
    .filter((importance): importance is IcarusObjectiveImportance => Boolean(importance))
    .sort((left, right) => importanceOrder.indexOf(left) - importanceOrder.indexOf(right))[0];
  const pillarIds = new Set<string>();
  assessment.linkedRecords.forEach((reference) => {
    if (reference.recordType === "Pillar") {
      const pillar = resolveOperatingPillar(reference.recordId);
      if (pillar) pillarIds.add(pillar.id);
    }
  });
  objectiveIds.forEach((id) => {
    const area = input.strategicObjectives?.get(id)?.area;
    const pillar = area ? resolveOperatingPillar(area) : null;
    if (pillar) pillarIds.add(pillar.id);
  });

  // ── Obligations (C) ──
  const actionLinks = assessment.assuranceActionLinks ?? [];
  const obligations: IcarusAssuranceObligation[] = [];
  const assessmentMateriality: IcarusObligationMateriality = signal ? signal.materialityTier : "Hygiene";
  const modeMateriality = (failureModeId: string): IcarusObligationMateriality => {
    const mode = materialModes.get(failureModeId);
    return mode ? getIcarusMaterialityTier(mode.exposure) : "Hygiene";
  };
  const add = (
    category: IcarusObligationCategory,
    sourceId: string,
    details: {
      reason: string;
      materiality: IcarusObligationMateriality;
      failureModeId?: string;
      controlId?: string;
      acceptanceId?: string;
      evidenceIds?: string[];
      dueAtMs?: number;
      dueFallback?: IcarusObligationDueState;
      ownerPersonId?: string;
      ownerSource: IcarusAssuranceObligation["ownerSource"];
      escalatesWhenStalled?: boolean;
      suppressEscalation?: boolean;
    },
  ) => {
    const id = `icarus-obligation:${assessment.id}:${category}:${sourceId}`;
    const actionIds = [...new Set(actionLinks.filter((link) => link.obligationId === id).map((link) => link.actionId))].sort();
    const remediation = deriveRemediation(actionIds, actions, nowMs);
    const kind = ICARUS_OBLIGATION_KIND[category];
    const escalates = !details.suppressEscalation && details.materiality !== "Hygiene" && (
      kind === "Governance gap"
      || (kind === "Assurance failure" && (!details.escalatesWhenStalled || isIcarusRemediationStalled(remediation))));
    const remediationDue = category === "failing-control-remediation" && actionIds.length > 0
      ? actionIds.map((actionId) => parseDeadline(actions.get(actionId)?.dueDate)).filter((value): value is number => value !== undefined).sort((a, b) => a - b)[0]
      : undefined;
    const dueAtMs = details.dueAtMs ?? remediationDue;
    obligations.push({
      id,
      category,
      kind,
      label: ICARUS_OBLIGATION_LABEL[category],
      assessmentId: assessment.id,
      ...(details.failureModeId ? { failureModeId: details.failureModeId } : {}),
      ...(details.controlId ? { controlId: details.controlId } : {}),
      ...(details.acceptanceId ? { acceptanceId: details.acceptanceId } : {}),
      evidenceIds: [...(details.evidenceIds ?? [])].sort(),
      reason: details.reason,
      materiality: details.materiality,
      dueState: dueStateOf(dueAtMs, nowMs, details.dueFallback),
      ...(toIso(dueAtMs) ? { dueAt: toIso(dueAtMs) } : {}),
      ...(details.ownerPersonId ? { ownerPersonId: details.ownerPersonId } : {}),
      ownerSource: details.ownerPersonId ? details.ownerSource : "None",
      remediation,
      actionIds,
      escalates,
      reference: {
        identityKey: assessmentKey,
        assessmentId: assessment.id,
        ...(details.failureModeId ? { failureModeId: details.failureModeId } : {}),
        ...(details.controlId ? { controlId: details.controlId } : {}),
        ...(details.evidenceIds?.[0] ? { evidenceId: [...details.evidenceIds].sort()[0] } : {}),
      },
    });
  };
  const riskOwnerForObligation = ownership === "Assigned" ? riskOwnerPersonId : undefined;

  if (ownership !== "Assigned") {
    add("no-risk-owner", "assessment", {
      reason: `Risk ownership gap: ${ownershipReason[ownership]}.`,
      materiality: assessmentMateriality,
      dueFallback: "Due",
      ownerSource: "None",
    });
  }
  if (founderOwnershipConcern && signal) {
    add("founder-owner-dependency", "assessment", {
      reason: "The founder is the accountable owner of a material risk while founder-dependent work is active.",
      materiality: assessmentMateriality,
      ownerPersonId: riskOwnerForObligation,
      ownerSource: "Risk owner",
    });
  }

  modes.forEach((mode) => {
    const material = materialModes.get(mode.failureModeId);
    const accepted = Boolean(mode.acceptanceId);
    if (material && !accepted && mode.operatingControlIds.length === 0) {
      if (material.exposure === "Exposed") {
        add("no-control", mode.failureModeId, {
          reason: `An evidenced failure mechanism has no operating control: ${mode.mechanism}.`,
          materiality: modeMateriality(mode.failureModeId),
          failureModeId: mode.failureModeId,
          evidenceIds: material.supportingEvidenceIds,
          ownerPersonId: riskOwnerForObligation,
          ownerSource: "Risk owner",
        });
      } else if (material.exposure === "Unexamined strategic exposure") {
        add("mechanism-unexamined", mode.failureModeId, {
          reason: `A strategically linked failure mechanism has neither reviewed evidence nor a control: ${mode.mechanism}.`,
          materiality: modeMateriality(mode.failureModeId),
          failureModeId: mode.failureModeId,
          ownerPersonId: riskOwnerForObligation,
          ownerSource: "Risk owner",
        });
      }
    }
    if (mode.depth === "Single control" && objectiveImportance === "Critical") {
      add("single-control-dependency", mode.failureModeId, {
        reason: `A Critical-objective failure mechanism relies on one tested control; control independence is not recorded.`,
        materiality: modeMateriality(mode.failureModeId),
        failureModeId: mode.failureModeId,
        controlId: mode.assuredControlIds[0],
        ownerPersonId: riskOwnerForObligation,
        ownerSource: "Risk owner",
      });
    }
  });

  controls.forEach((control) => {
    if (control.status === "Not operating") return;
    const materiality = modeMateriality(control.failureModeId);
    const accepted = Boolean(modes.find((mode) => mode.failureModeId === control.failureModeId)?.acceptanceId);
    const ownerPersonId = control.ownership === "Assigned" ? control.ownerPersonId : riskOwnerForObligation;
    const ownerSource = control.ownership === "Assigned" ? "Control owner" as const : "Risk owner" as const;
    const base = { failureModeId: control.failureModeId, controlId: control.controlId, ownerPersonId, ownerSource, materiality };
    if (control.status === "Failed") {
      add("failing-control-remediation", control.controlId, {
        ...base,
        reason: `Control "${control.intervention}" is failing; remediation must be tracked until a passing test is recorded.`,
        dueFallback: "Due",
        escalatesWhenStalled: true,
        // Explicitly accepted exposure is tolerated, but the failing control remains visible.
        suppressEscalation: accepted,
      });
    }
    if (control.status === "Test overdue") {
      add("control-test-overdue", control.controlId, {
        ...base,
        reason: `Control "${control.intervention}" has passed its test/review date.`,
        dueAtMs: parseDeadline(control.nextDueAt),
      });
    }
    if (control.ownership !== "Assigned") {
      add("control-without-owner", control.controlId, {
        ...base,
        reason: `Control "${control.intervention}": ${ownershipReason[control.ownership]}.`,
      });
    }
    if (control.status === "Untested") {
      add("control-never-tested", control.controlId, {
        ...base,
        reason: `Control "${control.intervention}" is operating but has never been tested or assessed.`,
        dueFallback: control.testCadenceDays ? "Due" : "No date",
      });
    }
    if (control.status === "Evidence insufficient" || control.status === "Inconclusive") {
      add("control-evidence-insufficient", control.controlId, {
        ...base,
        reason: control.status === "Inconclusive"
          ? `The latest assurance of control "${control.intervention}" was inconclusive.`
          : `The latest assurance of control "${control.intervention}" lacks current, reviewed supporting evidence.`,
        evidenceIds: control.lastEvent?.evidenceIds ?? [],
      });
    }
  });

  acceptances.filter((acceptance) => acceptance.current).forEach((acceptance) => {
    const materiality = acceptance.failureModeIds
      .map(modeMateriality)
      .sort((left, right) => getIcarusObligationMaterialityRank(left) - getIcarusObligationMaterialityRank(right))[0] ?? "Hygiene";
    const firstMode = [...acceptance.failureModeIds].sort()[0];
    if (acceptance.validity === "Expired") {
      add("acceptance-expired", acceptance.acceptanceId, {
        reason: `Accepted exposure passed its review date (${acceptance.reviewBy}); the failure mechanism was never removed.`,
        materiality,
        failureModeId: firstMode,
        acceptanceId: acceptance.acceptanceId,
        dueAtMs: parseDeadline(acceptance.reviewBy),
        ownerPersonId: acceptance.acceptedByPersonId,
        ownerSource: "Approver",
      });
    } else if (acceptance.validity === "Invalid") {
      add("acceptance-invalid", acceptance.acceptanceId, {
        reason: `Accepted exposure is not valid (${acceptance.invalidReasons.join(", ")}); it does not count as acceptance.`,
        materiality,
        failureModeId: firstMode,
        acceptanceId: acceptance.acceptanceId,
        ownerPersonId: riskOwnerForObligation,
        ownerSource: "Risk owner",
      });
    }
  });

  if (objectiveImportance === "Critical" || objectiveImportance === "High") {
    const reviewedAt = parseDeadline(assessment.reviewedAt);
    const nextReviewBy = parseDeadline(assessment.nextReviewBy);
    const dueAtMs = nextReviewBy ?? (reviewedAt !== undefined ? reviewedAt + ICARUS_RISK_REVIEW_INTERVAL_DAYS * DAY_MS : undefined);
    if (dueAtMs === undefined || dueAtMs < nowMs) {
      add("risk-review-due", "assessment", {
        reason: reviewedAt === undefined
          ? `This ${objectiveImportance}-objective risk has no recorded risk review.`
          : `This ${objectiveImportance}-objective risk is past its review date.`,
        materiality: assessmentMateriality,
        dueAtMs,
        dueFallback: "Due",
        ownerPersonId: riskOwnerForObligation,
        ownerSource: "Risk owner",
      });
    }
  }

  const modeOrder = new Map(assessment.failureModes.map((mode, index) => [mode.id, index] as const));
  obligations.sort((left, right) =>
    Number(right.escalates) - Number(left.escalates)
    || getIcarusObligationMaterialityRank(left.materiality) - getIcarusObligationMaterialityRank(right.materiality)
    || getIcarusObligationRank(left.category) - getIcarusObligationRank(right.category)
    || (left.dueState === "Overdue" ? 0 : 1) - (right.dueState === "Overdue" ? 0 : 1)
    || (modeOrder.get(left.failureModeId ?? "") ?? -1) - (modeOrder.get(right.failureModeId ?? "") ?? -1)
    || left.id.localeCompare(right.id));

  // ── Escalation (G) ──
  const escalating = obligations.filter((obligation) => obligation.escalates);
  const escalation: IcarusEscalationLevel = escalating.some((obligation) => obligation.kind === "Assurance failure")
    ? "Assurance failure"
    : escalating.length > 0 ? "Governance gap" : "None";
  const escalationCategories = [...new Set(escalating.map((obligation) => obligation.category))]
    .sort((left, right) => getIcarusObligationRank(left) - getIcarusObligationRank(right));

  const currentValidities = acceptances.filter((acceptance) => acceptance.current).map((acceptance) => acceptance.validity);
  const acceptanceSummary: IcarusSignalAssurance["acceptance"] = currentValidities.includes("Expired") ? "Expired"
    : currentValidities.includes("Invalid") ? "Invalid"
      : currentValidities.includes("Active") ? "Active"
        : acceptances.length > 0 ? "Revoked" : "None";
  const materialModeAssurance = modes.filter((mode) => mode.material);
  const nextObligation = obligations[0];
  const evidenceWeaknessCodes = [...new Set(context.allFindings
    .map((finding) => finding.code)
    .filter((code) => evidenceWeaknessCodeSet.includes(code)))].sort();

  return {
    assessmentId: assessment.id,
    outcome: assessment.outcome.trim(),
    status: assessment.status,
    material: Boolean(signal),
    state,
    basis: [...basis].sort(),
    ownership,
    ...(riskOwnerPersonId ? { riskOwnerPersonId } : {}),
    founderOwned,
    founderOwnershipConcern,
    ...(assessment.reviewedAt ? { lastReviewedAt: assessment.reviewedAt } : {}),
    modes,
    controls,
    acceptances,
    obligations,
    escalation,
    evidenceWeaknessCodes,
    operatingPillarIds: [...pillarIds].sort(),
    objectiveIds: [...new Set(objectiveIds)].sort(),
    ...(objectiveImportance ? { objectiveImportance } : {}),
    signal: {
      state,
      escalation,
      escalationCategories,
      ...(riskOwnerPersonId ? { riskOwnerPersonId } : {}),
      ownership,
      founderOwned,
      acceptance: acceptanceSummary,
      materialModesAccepted: materialModeAssurance.length > 0 && materialModeAssurance.every((mode) => Boolean(mode.acceptanceId)),
      failedControlIds: modes.flatMap((mode) => mode.failedControlIds).sort(),
      overdueObligationCount: obligations.filter((obligation) => obligation.dueState === "Overdue").length,
      obligationCount: obligations.length,
      ...(nextObligation ? { nextObligation: { id: nextObligation.id, category: nextObligation.category, reason: nextObligation.reason } } : {}),
    },
  };
}

// One assurance record per non-Closed assessment, in assessment order (materiality ordering stays with signals).
export function buildIcarusAssurance(rawInput: IcarusAssuranceInput): IcarusAssuranceResult {
  const input = { ...rawInput, nowMs: rawInput.nowMs ?? Date.now() };
  const people = new Map(input.people.filter((person) => person.id.trim()).map((person) => [person.id, person] as const));
  const actions = new Map(input.actions.map((action) => [action.id, action] as const));
  const reviewsById = new Map(input.reviews.map((review) => [review.assessmentId, review] as const));
  const signalsById = new Map(input.signals.map((signal) => [signal.assessmentId, signal] as const));

  const assessments = input.assessments
    .filter((assessment) => assessment.status !== "Closed")
    .map((assessment) => {
      const findings = reviewsById.get(assessment.id)?.findings ?? [];
      return buildAssessmentAssurance(assessment, input, {
        reviewCodes: (controlId) => findings.filter((finding) => finding.controlId === controlId).map((finding) => finding.code),
        allFindings: findings,
        signal: signalsById.get(assessment.id),
        people,
        actions,
      });
    })
    .sort((left, right) => left.assessmentId.localeCompare(right.assessmentId));
  const byAssessmentId = new Map(assessments.map((assessment) => [assessment.assessmentId, assessment] as const));
  const obligations = assessments.flatMap((assessment) => assessment.obligations);
  return { assessments, byAssessmentId, obligations };
}

// Attaches the assurance summary to each strategic signal. Signals stay otherwise identical: assurance never
// changes exposure, materiality or ranking score — only placement within Icarus's bounds and reasons.
export function attachIcarusAssuranceToSignals(
  signals: readonly IcarusStrategicSignal[],
  assurance: IcarusAssuranceResult,
): IcarusStrategicSignal[] {
  return signals.map((signal) => {
    const entry = assurance.byAssessmentId.get(signal.assessmentId);
    return entry ? { ...signal, assurance: entry.signal } : signal;
  });
}

// The most important next weakness for an assessment, for UI "what do I do next" display.
export function getIcarusNextAssuranceObligation(entry: IcarusAssessmentAssurance): IcarusAssuranceObligation | undefined {
  return entry.obligations[0];
}
