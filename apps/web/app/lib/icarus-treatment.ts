import { getIcarusReferenceKey, getIcarusTreatmentTargetId } from "./icarus";
import type {
  IcarusAssessmentRecord,
  IcarusRecordReference,
  IcarusTreatmentTargetRecord,
  IcarusTreatmentCompletionReview,
  IcarusObservationPlan,
} from "./icarus";
import type { IcarusDependencyHealthRegistry } from "./icarus-dependency-health";
import type { IcarusObservationActionLink, IcarusObservationHandoff } from "./icarus-observation-action";
import { getIcarusEffectiveProtection } from "./icarus-effective-protection";
import type {
  IcarusAcceptanceAssurance,
  IcarusAssessmentAssurance,
  IcarusAssuranceObligation,
  IcarusControlAssurance,
  IcarusFailureModeAssurance,
} from "./icarus-assurance";
import type { IcarusDependencyResilience, IcarusResilienceIntervention } from "./icarus-dependency-resilience";
import type { IcarusBarrierRestoration } from "./icarus-failure-chain-analysis";
import {
  buildIcarusTreatmentOutcomeIndex,
  type IcarusTreatmentOutcomeView,
} from "./icarus-treatment-outcome";

export { getIcarusTreatmentTargetId } from "./icarus";

export type IcarusTreatmentExecution = {
  recordType: "Action" | "Project";
  recordId: string;
  title: string;
  status: string;
  owner?: string;
  ownerPersonId?: string;
  dueDate?: string;
  priority?: string;
  blocked?: boolean;
  context?: string;
  completedAt?: string;
  completionEvidence?: string;
  icarusObservationLinks?: readonly IcarusObservationActionLink[];
  icarusObservationHandoffs?: readonly IcarusObservationHandoff[];
};

export type IcarusTreatmentRouteState =
  | "Unrouted"
  | "Routed"
  | "Unowned"
  | "Scheduled"
  | "In progress"
  | "Blocked"
  | "Overdue"
  | "Completed — verification required"
  | "Missing execution record";

export type IcarusTreatmentTarget = {
  id: string;
  sourceKind: IcarusTreatmentTargetRecord["sourceKind"];
  sourceId: string;
  assessmentId: string;
  failureModeId?: string;
  controlId?: string;
  dependencyReference?: IcarusRecordReference;
  treatmentKind: string;
  reason: string;
  basis: readonly string[];
  affectedAssessmentIds: readonly string[];
  objectiveIds: readonly string[];
  pillarIds: readonly string[];
  provenance: IcarusTreatmentTargetRecord["provenance"];
  executionLinks: readonly {
    recordType: "Action" | "Project";
    recordId: string;
    linkedAt?: string;
  }[];
  executions: readonly IcarusTreatmentExecution[];
  state: IcarusTreatmentRouteState;
  material: boolean;
  founderOwned: boolean;
  completionReviews?: readonly IcarusTreatmentCompletionReview[];
  observationPlans?: readonly IcarusObservationPlan[];
};

export type IcarusTreatmentAssessmentSummary = {
  assessmentId: string;
  materialTargetCount: number;
  unroutedCount: number;
  unownedCount: number;
  blockedCount: number;
  overdueCount: number;
  missingExecutionCount: number;
  awaitingVerificationCount: number;
  verifiedIneffectiveCount: number;
  partiallyEffectiveCount: number;
  verificationInconclusiveCount: number;
  founderOwnedCount: number;
  delegatedCount: number;
  unpromotedInterventionCount: number;
  resolutionEligibility: "Eligible" | "Not eligible" | "Unknown";
  attentionReasons: readonly string[];
};

export type IcarusTreatmentIndex = {
  targets: readonly IcarusTreatmentTarget[];
  summaries: ReadonlyMap<string, IcarusTreatmentAssessmentSummary>;
  recommendations: readonly IcarusResilienceIntervention[];
  barrierRestorations: readonly IcarusBarrierRestoration[];
  verification: ReadonlyMap<string, IcarusTreatmentOutcomeView>;
};

type IcarusTreatmentAssuranceAssessment = Pick<
  IcarusAssessmentAssurance,
  "assessmentId" | "objectiveImportance"
> & {
  objectiveIds: readonly IcarusAssessmentAssurance["objectiveIds"][number][];
  operatingPillarIds: readonly IcarusAssessmentAssurance["operatingPillarIds"][number][];
  acceptances: readonly Pick<IcarusAcceptanceAssurance, "current" | "validity">[];
  modes: readonly Pick<IcarusFailureModeAssurance, "failureModeId" | "material" | "assurance">[];
  controls: readonly Pick<
    IcarusControlAssurance,
    "controlId" | "failureModeId" | "status" | "evidence" | "lastEvent"
  >[];
};

export type IcarusTreatmentIndexInput = {
  assessments: readonly IcarusAssessmentRecord[];
  assurance: {
    byAssessmentId: ReadonlyMap<string, IcarusTreatmentAssuranceAssessment>;
    obligations: readonly IcarusAssuranceObligation[];
  };
  resilience: readonly IcarusDependencyResilience[];
  recommendations: readonly IcarusResilienceIntervention[];
  barrierRestorations: readonly IcarusBarrierRestoration[];
  dependencyHealth: IcarusDependencyHealthRegistry;
  actions: readonly IcarusTreatmentExecution[];
  projects: readonly IcarusTreatmentExecution[];
  founderPersonId: string | null;
  nowMs?: number;
  people?: readonly { id: string; status: string }[];
};

export function getIcarusAssuranceTreatmentTargetId(obligationId: string): string {
  return getIcarusTreatmentTargetId("Assurance obligation", obligationId);
}

export function getIcarusResilienceTreatmentTargetId(intervention: IcarusResilienceIntervention): string {
  return getIcarusTreatmentTargetId(
    "Dependency / resilience intervention",
    `${getIcarusReferenceKey(intervention.reference)}:${intervention.kind}`,
  );
}

export function getIcarusBarrierRestorationTreatmentTargetId(restoration: IcarusBarrierRestoration): string {
  return getIcarusTreatmentTargetId(
    "Failure-chain restoration",
    `${restoration.assessmentId}:${restoration.failureModeId}:${restoration.controlId}`,
  );
}

export function persistIcarusTreatmentTarget(
  target: IcarusTreatmentTarget,
  promotedAt: string,
): IcarusTreatmentTargetRecord {
  return {
    id: target.id, sourceKind: target.sourceKind, sourceId: target.sourceId,
    assessmentId: target.assessmentId,
    ...(target.failureModeId ? { failureModeId: target.failureModeId } : {}),
    ...(target.controlId ? { controlId: target.controlId } : {}),
    ...(target.dependencyReference ? { dependencyReference: { ...target.dependencyReference } } : {}),
    treatmentKind: target.treatmentKind, reason: target.reason,
    basis: [...target.basis], affectedAssessmentIds: [...target.affectedAssessmentIds],
    objectiveIds: [...target.objectiveIds], pillarIds: [...target.pillarIds],
    provenance: { ...target.provenance }, executionLinks: [], promotedAt,
    ...(target.completionReviews ? { completionReviews: [...target.completionReviews] } : {}),
    ...(target.observationPlans ? { observationPlans: [...target.observationPlans] } : {}),
  };
}

function uniqueLinks<T extends { recordType: "Action" | "Project"; recordId: string }>(links: readonly T[]): T[] {
  const found = new Map<string, T>();
  links.forEach((link) => {
    const key = `${link.recordType}:${link.recordId}`;
    if (!found.has(key)) found.set(key, link);
  });
  return [...found.values()].sort((left, right) =>
    `${left.recordType}:${left.recordId}`.localeCompare(`${right.recordType}:${right.recordId}`));
}

function parseDueDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T23:59:59.999Z`)
    : Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function routeState(
  executions: readonly IcarusTreatmentExecution[],
  links: readonly { recordType: "Action" | "Project"; recordId: string }[],
  founderPersonId: string | null,
  nowMs: number,
): { state: IcarusTreatmentRouteState; founderOwned: boolean; delegated: boolean } {
  if (links.length === 0) return { state: "Unrouted", founderOwned: false, delegated: false };
  if (executions.length === 0) return { state: "Missing execution record", founderOwned: false, delegated: false };
  if (executions.length !== links.length) return { state: "Missing execution record", founderOwned: false, delegated: false };
  if (executions.every((execution) => execution.status === "Cancelled")) {
    return { state: "Unrouted", founderOwned: false, delegated: false };
  }
  const founderOwned = founderPersonId !== null && executions.some((execution) => execution.ownerPersonId === founderPersonId);
  const delegated = executions.some((execution) => Boolean(execution.ownerPersonId?.trim())
    && execution.ownerPersonId !== founderPersonId);
  if (executions.every((execution) => execution.status === "Completed")) {
    return { state: "Completed — verification required", founderOwned, delegated };
  }
  const blocked = executions.some((execution) => execution.status === "Blocked" || execution.blocked === true);
  const overdue = executions.some((execution) => {
    const due = parseDueDate(execution.dueDate);
    return due !== undefined && due < nowMs && execution.status !== "Completed" && execution.status !== "Cancelled";
  });
  const ownerless = executions.some((execution) => !execution.owner?.trim());
  if (blocked) return { state: "Blocked", founderOwned, delegated };
  if (overdue) return { state: "Overdue", founderOwned, delegated };
  if (ownerless) return { state: "Unowned", founderOwned, delegated };
  if (executions.some((execution) => execution.status === "In Progress")) {
    return { state: "In progress", founderOwned, delegated };
  }
  if (executions.some((execution) => execution.status === "Open" || execution.status === "Waiting")) {
    return { state: "Scheduled", founderOwned, delegated };
  }
  return { state: "Routed", founderOwned, delegated };
}

function materialObligation(obligation: IcarusAssuranceObligation): boolean {
  return obligation.escalates || ["Critical", "High", "Material"].includes(obligation.materiality);
}

function createObligationTarget(
  obligation: IcarusAssuranceObligation,
  assessment: IcarusAssessmentRecord,
  assuranceAssessment: IcarusTreatmentAssuranceAssessment | undefined,
  actionMap: ReadonlyMap<string, IcarusTreatmentExecution>,
  founderPersonId: string | null,
  nowMs: number,
): IcarusTreatmentTarget {
  const legacyLinks = (assessment.assuranceActionLinks ?? [])
    .filter((link) => link.obligationId === obligation.id)
    .map((link) => ({ recordType: "Action" as const, recordId: link.actionId, linkedAt: link.linkedAt }));
  const links = uniqueLinks([
    ...legacyLinks,
    ...obligation.actionIds.map((actionId) => ({ recordType: "Action" as const, recordId: actionId })),
  ]);
  const executions = links.flatMap((link) => {
    const action = actionMap.get(link.recordId);
    return action ? [action] : [];
  });
  const route = routeState(executions, links, founderPersonId, nowMs);
  return {
    id: getIcarusAssuranceTreatmentTargetId(obligation.id),
    sourceKind: "Assurance obligation",
    sourceId: obligation.id,
    assessmentId: obligation.assessmentId,
    ...(obligation.failureModeId ? { failureModeId: obligation.failureModeId } : {}),
    ...(obligation.controlId ? { controlId: obligation.controlId } : {}),
    treatmentKind: obligation.label,
    reason: obligation.reason,
    basis: [
      obligation.kind,
      obligation.materiality,
      ...(assuranceAssessment?.objectiveImportance ? [`objective-${assuranceAssessment.objectiveImportance.toLowerCase()}`] : []),
      ...obligation.evidenceIds,
    ],
    affectedAssessmentIds: [obligation.assessmentId],
    objectiveIds: [...(assuranceAssessment?.objectiveIds ?? [])].sort(),
    pillarIds: [...(assuranceAssessment?.operatingPillarIds ?? [])].sort(),
    provenance: { kind: "Assurance obligation", finding: obligation.reason },
    executionLinks: links,
    executions,
    state: route.state,
    material: materialObligation(obligation),
    founderOwned: route.founderOwned,
  };
}

function createPersistedTarget(
  target: IcarusTreatmentTargetRecord,
  executionsByKey: ReadonlyMap<string, IcarusTreatmentExecution>,
  founderPersonId: string | null,
  nowMs: number,
): IcarusTreatmentTarget {
  const links = uniqueLinks(target.executionLinks);
  const executions = links.flatMap((link) => {
    const execution = executionsByKey.get(`${link.recordType}:${link.recordId}`);
    return execution ? [execution] : [];
  });
  const route = routeState(executions, links, founderPersonId, nowMs);
  return {
    ...target,
    basis: [...target.basis],
    affectedAssessmentIds: [...target.affectedAssessmentIds],
    objectiveIds: [...target.objectiveIds],
    pillarIds: [...target.pillarIds],
    executionLinks: links,
    executions,
    state: route.state,
    material: true,
    founderOwned: route.founderOwned,
  };
}

function buildSummary(
  assessmentId: string,
  targets: readonly IcarusTreatmentTarget[],
  recommendations: readonly IcarusResilienceIntervention[],
  barrierRestorations: readonly IcarusBarrierRestoration[],
  verification: ReadonlyMap<string, IcarusTreatmentOutcomeView>,
  assessment: IcarusAssessmentRecord,
  assuranceAssessment: IcarusTreatmentAssuranceAssessment | undefined,
  dependencyHealth: IcarusDependencyHealthRegistry,
): IcarusTreatmentAssessmentSummary {
  const materialTargets = targets.filter((target) => target.material
    && (target.assessmentId === assessmentId || target.affectedAssessmentIds.includes(assessmentId)));
  const count = (state: IcarusTreatmentRouteState) => materialTargets.filter((target) => target.state === state).length;
  const unroutedCount = count("Unrouted");
  const unownedCount = count("Unowned");
  const blockedCount = count("Blocked");
  const overdueCount = count("Overdue");
  const missingExecutionCount = count("Missing execution record");
  const materialForAssessment = targets.filter((target) => target.material
    && (target.assessmentId === assessmentId || target.affectedAssessmentIds.includes(assessmentId)));
  const awaitingVerificationCount = materialForAssessment.filter((target) =>
    target.state === "Completed — verification required"
      && ["Awaiting verification", "Superseded"].includes(verification.get(target.id)?.state ?? "Awaiting verification")).length;
  const verifiedIneffectiveCount = materialForAssessment.filter((target) =>
    verification.get(target.id)?.state === "Verified ineffective").length;
  const partiallyEffectiveCount = materialForAssessment.filter((target) =>
    verification.get(target.id)?.state === "Partially effective").length;
  const verificationInconclusiveCount = materialForAssessment.filter((target) =>
    verification.get(target.id)?.state === "Verification inconclusive"
      || verification.get(target.id)?.state === "Superseded").length;
  const founderOwnedCount = materialTargets.filter((target) => target.founderOwned).length;
  const delegatedCount = materialTargets.filter((target) => target.executions.some((execution) =>
    Boolean(execution.ownerPersonId?.trim())) && !target.founderOwned).length;
  const promotedIds = new Set(targets.map((target) => target.id));
  const unpromotedInterventionCount = recommendations.filter((recommendation) =>
    recommendation.assessmentIds.includes(assessmentId)
      && !promotedIds.has(getIcarusResilienceTreatmentTargetId(recommendation))).length
    + barrierRestorations.filter((restoration) => restoration.assessmentId === assessmentId
      && !promotedIds.has(getIcarusBarrierRestorationTreatmentTargetId(restoration))).length;
  const currentAcceptedExposure = assuranceAssessment?.acceptances.some((acceptance) =>
    acceptance.current && acceptance.validity === "Active") ?? false;
  const unresolvedMaterialModes = assuranceAssessment?.modes.some((mode) => mode.material) ?? false;
  const impairedProtection = assessment.failureModes.some((mode) => {
    const controls = assessment.controls.filter((control) => control.failureModeId === mode.id);
    const passed = controls.filter((control) => assuranceAssessment?.controls
      .some((entry) => entry.controlId === control.id && entry.status === "Assured"));
    return passed.length > 0 && !passed.some((control) =>
      getIcarusEffectiveProtection(control, "Assured", dependencyHealth).barrier === "Active");
  });
  const treatmentVerificationPending = materialForAssessment.some((target) => {
    const state = verification.get(target.id)?.state;
    return state !== "Verified effective" && state !== "No longer applicable";
  });
  const resolutionEligibility = assessment.status === "Closed" || !assuranceAssessment
    ? "Unknown"
    : currentAcceptedExposure || unresolvedMaterialModes || impairedProtection || treatmentVerificationPending || unpromotedInterventionCount > 0
      ? "Not eligible"
      : "Eligible";
  const attentionReasons = [
    unroutedCount > 0 ? `${unroutedCount} material treatment target${unroutedCount === 1 ? " is" : "s are"} unrouted` : "",
    unownedCount > 0 ? `${unownedCount} treatment${unownedCount === 1 ? " is" : "s are"} unowned` : "",
    blockedCount > 0 ? `${blockedCount} treatment${blockedCount === 1 ? " is" : "s are"} blocked` : "",
    overdueCount > 0 ? `${overdueCount} treatment${overdueCount === 1 ? " is" : "s are"} overdue` : "",
    missingExecutionCount > 0 ? `${missingExecutionCount} execution link${missingExecutionCount === 1 ? " is" : "s are"} missing` : "",
    awaitingVerificationCount > 0 ? `${awaitingVerificationCount} completed treatment${awaitingVerificationCount === 1 ? " still requires" : "s still require"} strategic verification` : "",
    verifiedIneffectiveCount > 0 ? `${verifiedIneffectiveCount} treatment${verifiedIneffectiveCount === 1 ? " is" : "s are"} verified ineffective` : "",
    partiallyEffectiveCount > 0 ? `${partiallyEffectiveCount} treatment${partiallyEffectiveCount === 1 ? " is" : "s are"} only partially effective` : "",
    verificationInconclusiveCount > 0 ? `${verificationInconclusiveCount} treatment verification${verificationInconclusiveCount === 1 ? " is" : "s are"} inconclusive or superseded` : "",
    ...materialForAssessment.filter((target) => target.state === "Completed — verification required")
      .flatMap((target) => verification.get(target.id)?.issues?.map((issue) =>
        `Treatment verification evidence gap (${target.id}): ${issue}`) ?? []),
    ...materialForAssessment.flatMap((target) => {
      const view = verification.get(target.id);
      return view?.protection === "Protection deteriorated" || view?.protection === "Observation due" || view?.protection === "Protection unknown"
        ? [`Treatment protection requires review (${target.id}): ${view.protection}`]
        : view?.state === "Verified effective" && !view.latest?.nextObservationBy
          ? [`Effective treatment has no scheduled follow-up observation (${target.id})`] : [];
    }),
    ...materialForAssessment.flatMap((target) => {
      const observation = verification.get(target.id)?.observation;
      if (!observation || !["Missing", "Unowned", "Invalid", "Due", "Overdue"].includes(observation.state)) return [];
      if (observation.state === "Missing" && target.state !== "Completed — verification required") return [];
      return [`Observation responsibility (${target.id}): ${observation.state}${observation.plan
        ? `; owner Person:${observation.plan.ownerPersonId}; ${observation.plan.protection}` : ""}${observation.nextReviewBy
        ? `; review by ${observation.nextReviewBy}` : ""}${observation.issues.length ? `; ${observation.issues.join("; ")}` : ""}`];
    }),
    unpromotedInterventionCount > 0
      ? `${unpromotedInterventionCount} resilience/restoration intervention${unpromotedInterventionCount === 1 ? " remains" : "s remain"} a recommendation`
      : "",
  ].filter(Boolean);
  return {
    assessmentId,
    materialTargetCount: materialTargets.length,
    unroutedCount,
    unownedCount,
    blockedCount,
    overdueCount,
    missingExecutionCount,
    awaitingVerificationCount,
    verifiedIneffectiveCount,
    partiallyEffectiveCount,
    verificationInconclusiveCount,
    founderOwnedCount,
    delegatedCount,
    unpromotedInterventionCount,
    resolutionEligibility,
    attentionReasons,
  };
}

export function buildIcarusTreatmentIndex(input: IcarusTreatmentIndexInput): IcarusTreatmentIndex {
  const nowMs = input.nowMs ?? Date.now();
  const assessmentById = new Map(input.assessments.map((assessment) => [assessment.id, assessment] as const));
  const actions = new Map(input.actions.map((action) => [action.recordId, action] as const));
  const executionsByKey = new Map([...input.actions, ...input.projects].map((record) =>
    [`${record.recordType}:${record.recordId}`, record] as const));
  const targets: IcarusTreatmentTarget[] = [];

  input.assurance.obligations.forEach((obligation) => {
    const assessment = assessmentById.get(obligation.assessmentId);
    if (!assessment) return;
    targets.push(createObligationTarget(
      obligation,
      assessment,
      input.assurance.byAssessmentId.get(obligation.assessmentId),
      actions,
      input.founderPersonId,
      nowMs,
    ));
  });

  input.assessments.forEach((assessment) => {
    (assessment.treatmentTargets ?? []).forEach((target) => {
      targets.push(createPersistedTarget(target, executionsByKey, input.founderPersonId, nowMs));
    });
  });

  const uniqueById = new Map<string, IcarusTreatmentTarget>();
  targets.forEach((target) => {
    const previous = uniqueById.get(target.id);
    if (!previous) {
      uniqueById.set(target.id, target);
      return;
    }
    const links = uniqueLinks([...previous.executionLinks, ...target.executionLinks]);
    const executions = links.flatMap((link) => {
      const execution = executionsByKey.get(`${link.recordType}:${link.recordId}`);
      return execution ? [execution] : [];
    });
    const route = routeState(executions, links, input.founderPersonId, nowMs);
    uniqueById.set(target.id, {
      ...previous,
      completionReviews: [...(previous.completionReviews ?? []), ...(target.completionReviews ?? [])],
      observationPlans: [...(previous.observationPlans ?? []), ...(target.observationPlans ?? [])],
      executionLinks: links,
      executions,
      state: route.state,
      founderOwned: route.founderOwned,
    });
  });
  const uniqueTargets = [...uniqueById.values()].sort((left, right) => left.id.localeCompare(right.id));
  const verification = buildIcarusTreatmentOutcomeIndex({
    assessments: input.assessments,
    targets: uniqueTargets,
    assurance: { byAssessmentId: input.assurance.byAssessmentId },
    dependencyHealth: input.dependencyHealth,
    nowMs,
    people: input.people,
  });
  const knownDependencies = new Set(input.resilience.map((entry) => getIcarusReferenceKey(entry.reference)));
  const recommendations = input.recommendations.filter((recommendation) =>
    knownDependencies.has(getIcarusReferenceKey(recommendation.reference)))
    .slice()
    .sort((left, right) => getIcarusReferenceKey(left.reference).localeCompare(getIcarusReferenceKey(right.reference))
      || left.kind.localeCompare(right.kind));
  const barrierRestorations = input.barrierRestorations.slice().sort((left, right) =>
    left.assessmentId.localeCompare(right.assessmentId)
      || left.failureModeId.localeCompare(right.failureModeId)
      || left.controlId.localeCompare(right.controlId));
  const assessmentIds = new Set(input.assessments.map((assessment) => assessment.id));
  const summaries = new Map([...assessmentIds].sort().flatMap((assessmentId) => {
    const assessment = assessmentById.get(assessmentId);
    return assessment ? [[assessmentId, buildSummary(
      assessmentId,
      uniqueTargets,
      recommendations,
      barrierRestorations,
      verification,
      assessment,
      input.assurance.byAssessmentId.get(assessmentId),
      input.dependencyHealth,
    )] as const] : [];
  }));
  return { targets: uniqueTargets, summaries, recommendations, barrierRestorations, verification };
}

export function createIcarusResilienceTreatmentTarget(
  intervention: IcarusResilienceIntervention,
  promotedAt: string,
): IcarusTreatmentTargetRecord | null {
  const assessmentId = intervention.assessmentIds.slice().sort()[0];
  if (!assessmentId) return null;
  const referenceKey = getIcarusReferenceKey(intervention.reference);
  const sourceId = `${referenceKey}:${intervention.kind}`;
  return {
    id: getIcarusResilienceTreatmentTargetId(intervention),
    sourceKind: "Dependency / resilience intervention",
    sourceId,
    assessmentId,
    dependencyReference: { ...intervention.reference },
    treatmentKind: intervention.kind,
    reason: `${intervention.kind} for a ${intervention.resilience.toLowerCase()}, ${intervention.concentration.toLowerCase()} dependency; protects ${intervention.assessmentIds.length} linked risk${intervention.assessmentIds.length === 1 ? "" : "s"}, ${intervention.objectiveIds.length} objective${intervention.objectiveIds.length === 1 ? "" : "s"}, and ${intervention.pillarIds.length} pillar${intervention.pillarIds.length === 1 ? "" : "s"}.`,
    basis: [...intervention.basis],
    affectedAssessmentIds: [...intervention.assessmentIds].sort(),
    objectiveIds: [...intervention.objectiveIds].sort(),
    pillarIds: [...intervention.pillarIds].sort(),
    provenance: {
      kind: "Dependency / resilience recommendation",
      finding: `${intervention.kind}: ${referenceKey}`,
    },
    executionLinks: [],
    promotedAt,
  };
}

export function createIcarusStressTreatmentTarget(
  assessmentId: string,
  finding: string,
  affectedAssessmentIds: readonly string[],
  failureModeIds: readonly string[],
  promotedAt: string,
): IcarusTreatmentTargetRecord {
  const sortedFailureModeIds = [...new Set(failureModeIds)].sort();
  const sourceId = `${assessmentId}:newly-exposed:${sortedFailureModeIds.join(",")}`;
  const affected = [...new Set([assessmentId, ...affectedAssessmentIds])].sort();
  return {
    id: getIcarusTreatmentTargetId("Stress discovery", sourceId),
    sourceKind: "Stress discovery",
    sourceId,
    assessmentId,
    ...(sortedFailureModeIds.length === 1 ? { failureModeId: sortedFailureModeIds[0] } : {}),
    treatmentKind: "Investigate stress-test discovery",
    reason: finding,
    basis: ["stress-discovery", ...sortedFailureModeIds],
    affectedAssessmentIds: affected,
    objectiveIds: [],
    pillarIds: [],
    provenance: { kind: "Stress discovery", finding },
    executionLinks: [],
    promotedAt,
  };
}

export function createIcarusBarrierRestorationTreatmentTarget(
  restoration: IcarusBarrierRestoration,
  promotedAt: string,
): IcarusTreatmentTargetRecord {
  const sourceId = `${restoration.assessmentId}:${restoration.failureModeId}:${restoration.controlId}`;
  return {
    id: getIcarusBarrierRestorationTreatmentTargetId(restoration),
    sourceKind: "Failure-chain restoration",
    sourceId,
    assessmentId: restoration.assessmentId,
    failureModeId: restoration.failureModeId,
    controlId: restoration.controlId,
    treatmentKind: "Restore barrier",
    reason: `${restoration.intervention} Protects ${restoration.interrupts.assessmentIds.length} linked risk${restoration.interrupts.assessmentIds.length === 1 ? "" : "s"}, ${restoration.interrupts.objectiveIds.length} objective${restoration.interrupts.objectiveIds.length === 1 ? "" : "s"}, and ${restoration.interrupts.pillarIds.length} pillar${restoration.interrupts.pillarIds.length === 1 ? "" : "s"}.`,
    basis: [restoration.state, restoration.chainPriority],
    affectedAssessmentIds: [...new Set([restoration.assessmentId, ...restoration.interrupts.assessmentIds])].sort(),
    objectiveIds: [...restoration.interrupts.objectiveIds].sort(),
    pillarIds: [...restoration.interrupts.pillarIds].sort(),
    provenance: {
      kind: "Failure-chain recommendation",
      finding: `Restoring this barrier would interrupt a ${restoration.chainPriority.toLowerCase()} failure chain.`,
    },
    executionLinks: [],
    promotedAt,
  };
}
