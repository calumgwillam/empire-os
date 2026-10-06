// Composition root for Icarus intelligence. Orchestrates the existing pure Icarus adapters in one explicit order;
// it owns sequencing only — every derivation rule stays in its own module.
//
// The pipeline is staged because the Empire correlation graph is a generic, Empire-wide system that sits between
// Icarus stages and also consumes Command Attention:
//
//   Stage A  buildIcarusStrategicIntelligence
//            dependency health -> reviews -> exposure signals (materiality) -> assurance -> assured signals
//              -> failure chains (dependency graph, barriers, SPOFs, cut points) -> chain-annotated signals
//              -> correlation signals / Founder Focus risks / exposure+assurance snapshot / assurance rollup
//   (caller) Command Attention base items  <- Stage A strategicSignals
//   (caller) generic correlation graph     <- Command base items (operational priority) + Stage A correlationSignals
//   Stage B  buildIcarusCorrelationIntelligence
//            graph (verified against Stage A) -> cluster contributions -> systemic exposure
//              -> strategic-risk convergence resolution
//   (caller) final Command presentation    <- resolveCommandStrategicRiskConvergence(base items, Stage B convergence)
//
// There is no cycle: Command's *base* items feed the graph and only the graph's convergence feeds Command's *final*
// presentation. Stage B refuses a graph that was not built from Stage A's correlation signals, so no downstream stage
// can be computed from stale upstream data.
import {
  buildIcarusReview,
  getIcarusReferenceKey,
  type IcarusAssessmentRecord,
  type IcarusAssessmentStatus,
  type IcarusReview,
  type IcarusReviewFinding,
  type IcarusSourceRecord,
} from "./icarus";
import {
  buildIcarusFounderFocusRisks,
  buildIcarusStrategicAttention,
  type IcarusFounderFocusRisk,
  type IcarusStrategicObjectiveContext,
  type IcarusStrategicSignal,
} from "./icarus-strategic-attention";
import {
  attachIcarusAssuranceToSignals,
  buildIcarusAssurance,
  type IcarusAssuranceAction,
  type IcarusAssurancePerson,
  type IcarusAssuranceResult,
} from "./icarus-assurance";
import { buildIcarusAssuranceRollup, type IcarusAssuranceRollup } from "./icarus-assurance-rollup";
import {
  attachIcarusFailureChainToSignals,
  buildIcarusFailureChainIntelligence,
  type IcarusFailureChainIntelligence,
  type IcarusHealthTriggeredChain,
} from "./icarus-failure-chain-analysis";
import {
  buildIcarusClusterContributions,
  buildIcarusCorrelationSignals,
  type IcarusClusterContribution,
  type IcarusClusterGraphInput,
  type IcarusCorrelationSignal,
} from "./icarus-correlation";
import { buildIcarusSystemicExposure, type IcarusSystemicExposure } from "./icarus-systemic-exposure";
import {
  buildIcarusExposureSnapshot,
  type IcarusDependencyHealthSnapshot,
  type IcarusExposureSnapshotEntry,
} from "./icarus-exposure-history";
import type { IcarusObjectiveImportance } from "./icarus-materiality-policy";
import type { IcarusControlAssuranceStatus } from "./icarus-assurance-policy";
import {
  buildIcarusDependencyHealthRegistry,
  type IcarusDependencyHealth,
  type IcarusDependencyHealthRegistry,
} from "./icarus-dependency-health";
import {
  buildIcarusDependencyResilience,
  buildIcarusResilienceInterventions,
  type IcarusDependencyResilience,
  type IcarusResilienceIntervention,
} from "./icarus-dependency-resilience";
import {
  resolveStrategicRiskConvergence,
  type ConvergentSituationInput,
  type StrategicRiskConvergence,
} from "./strategic-risk-resolution";

// Only live objectives confer strategic consequence (see IcarusStrategicObjectiveContext.isLive).
const LIVE_OBJECTIVE_STATUSES: ReadonlySet<string> = new Set(["Active", "Watching"]);

export type IcarusPipelineObjective = {
  id: string;
  // Stored objective pillar value (operating pillar or strategic theme; resolved downstream, never coerced).
  pillar: string;
  importance: IcarusObjectiveImportance;
  status: string;
  linkedProjectIds?: readonly string[];
  linkedOpportunityIds?: readonly string[];
  linkedDecisionIds?: readonly string[];
};

export type IcarusStrategicIntelligenceInput = {
  assessments: readonly IcarusAssessmentRecord[];
  // Every Empire record an Icarus reference may legitimately resolve to.
  sourceRecords: readonly IcarusSourceRecord[];
  strategicObjectives: readonly IcarusPipelineObjective[];
  people: readonly IcarusAssurancePerson[];
  actions: readonly IcarusAssuranceAction[];
  primaryFounderId: string | null;
  // True when existing People intelligence shows active founder-dependent work.
  founderDependencyActive: boolean;
  // One clock for every time-dependent stage. Defaults to the current time.
  nowMs?: number;
  // Transient hooks used only by the isolated Icarus stress-test engine.
  dependencyHealthOverrides?: ReadonlyMap<string, IcarusDependencyHealth>;
  controlAssuranceOverrides?: ReadonlyMap<string, IcarusControlAssuranceStatus>;
  includeExposureSnapshot?: boolean;
};

export type IcarusStrategicIntelligence = {
  nowMs: number;
  // One review per assessment, aligned to stored assessment order (a per-record projection for display).
  reviews: IcarusReview[];
  // Findings on assessments that are not Closed.
  unresolvedFindings: IcarusReviewFinding[];
  unresolvedFindingAssessmentCount: number;
  // Stored status per assessment id (first record wins for a duplicated id).
  assessmentStatuses: ReadonlyMap<string, IcarusAssessmentStatus>;
  assurance: IcarusAssuranceResult;
  assuranceRollup: IcarusAssuranceRollup;
  dependencyHealth: IcarusDependencyHealthRegistry;
  dependencyResilience: IcarusDependencyResilience[];
  resilienceInterventions: IcarusResilienceIntervention[];
  criticalDependencies: IcarusDependencyHealth[];
  unhealthyCriticalDependencies: IcarusDependencyHealth[];
  unknownCriticalDependencies: IcarusDependencyHealth[];
  // Failure-chain / dependency intelligence derived from the same signals and final assurance state.
  failureChains: IcarusFailureChainIntelligence;
  healthTriggeredChains: IcarusHealthTriggeredChain[];
  // Authoritative material strategic signals with assurance attached: the single input for Command, Founder Focus,
  // correlation, systemic exposure and history.
  strategicSignals: IcarusStrategicSignal[];
  // Material exposures in administratively Closed records remain visible for governance, but do not re-enter active intelligence.
  closedAssessmentWarnings: IcarusStrategicSignal[];
  correlationSignals: IcarusCorrelationSignal[];
  founderFocusRisks: IcarusFounderFocusRisk[];
  exposureSnapshot: IcarusExposureSnapshotEntry[];
};

export function buildIcarusObjectiveContext(
  objectives: readonly IcarusPipelineObjective[],
): Map<string, IcarusStrategicObjectiveContext> {
  return new Map(objectives.map((objective): [string, IcarusStrategicObjectiveContext] => [objective.id, {
    area: objective.pillar,
    importance: objective.importance,
    isLive: LIVE_OBJECTIVE_STATUSES.has(objective.status),
    linkedProjectIds: objective.linkedProjectIds,
    linkedOpportunityIds: objective.linkedOpportunityIds,
    linkedDecisionIds: objective.linkedDecisionIds,
  }]));
}

export function buildIcarusStrategicIntelligence(input: IcarusStrategicIntelligenceInput): IcarusStrategicIntelligence {
  const nowMs = input.nowMs ?? Date.now();
  const derivedDependencyHealth = buildIcarusDependencyHealthRegistry({
    sourceRecords: input.sourceRecords,
    people: input.people,
    actions: input.actions,
    nowMs,
  });
  const dependencyHealth = new Map(derivedDependencyHealth);
  input.dependencyHealthOverrides?.forEach((health, key) => dependencyHealth.set(key, health));
  const assessmentStatuses = new Map<string, IcarusAssessmentStatus>();
  input.assessments.forEach((assessment) => {
    if (!assessmentStatuses.has(assessment.id)) assessmentStatuses.set(assessment.id, assessment.status);
  });

  const reviews = buildIcarusReview(input.assessments, input.sourceRecords, nowMs);
  const unresolvedFindings = reviews
    .filter((review) => assessmentStatuses.get(review.assessmentId) !== "Closed")
    .flatMap((review) => review.findings);
  const strategicObjectives = buildIcarusObjectiveContext(input.strategicObjectives);
  const closedAssessmentWarnings = buildIcarusStrategicAttention({
    assessments: input.assessments.filter((assessment) => assessment.status === "Closed"),
    reviews,
    strategicObjectives,
    includeClosedAssessments: true,
  });

  // Materiality is decided here, before (and independently of) assurance.
  const exposureSignals = buildIcarusStrategicAttention({
    assessments: input.assessments,
    reviews,
    strategicObjectives,
  });
  const assurance = buildIcarusAssurance({
    assessments: input.assessments,
    reviews,
    signals: exposureSignals,
    people: input.people,
    actions: input.actions,
    primaryFounderId: input.primaryFounderId,
    founderDependencyActive: input.founderDependencyActive,
    strategicObjectives,
    nowMs,
  });
  // Assurance only annotates signals (placement within bounds + reasons); exposure and materiality are unchanged.
  const assuredSignals = attachIcarusAssuranceToSignals(exposureSignals, assurance);
  // Failure chains need final assurance (barrier state) but not the correlation graph, so they belong in Stage A;
  // they annotate signals before any consumer (Command, Focus, correlation, snapshot) reads them.
  const failureChains = buildIcarusFailureChainIntelligence({
    assessments: input.assessments,
    signals: assuredSignals,
    assurance,
    strategicObjectives,
    primaryFounderId: input.primaryFounderId,
    founderDependencyActive: input.founderDependencyActive,
    dependencyHealth,
    controlAssuranceOverrides: input.controlAssuranceOverrides,
  });
  const dependencyResilience = buildIcarusDependencyResilience(failureChains.dependencyGraph);
  const resilienceInterventions = buildIcarusResilienceInterventions(dependencyResilience);
  const strategicSignals = attachIcarusFailureChainToSignals(assuredSignals, failureChains);
  const criticalAssessmentIds = new Set(failureChains.dependencyGraph.assessments
    .filter((assessment) => assessment.material || assessment.objectiveImportance === "Critical")
    .map((assessment) => assessment.assessmentId));
  const criticalDependencyKeys = new Set(failureChains.dependencyGraph.controls
    .filter((control) => criticalAssessmentIds.has(control.assessmentId))
    .flatMap((control) => control.dependencyNodeIds));
  const criticalDependencyHealth = new Map<string, IcarusDependencyHealth>();
  failureChains.dependencyGraph.controls
    .filter((control) => criticalAssessmentIds.has(control.assessmentId))
    .forEach((control) => control.dependencyHealth.forEach((health) => {
      const key = getIcarusReferenceKey(health.reference);
      if (criticalDependencyKeys.has(key)) criticalDependencyHealth.set(key, health);
    }));
  const unhealthyCriticalDependencies = [...criticalDependencyHealth.values()]
    .filter((health) => health.health === "Failed" || health.health === "Degraded" || health.health === "Unknown" || health.health === "Watch")
    .sort((left, right) => `${left.reference.recordType}:${left.reference.recordId}`.localeCompare(`${right.reference.recordType}:${right.reference.recordId}`));
  const criticalDependencies = [...criticalDependencyHealth.values()]
    .sort((left, right) => getIcarusReferenceKey(left.reference).localeCompare(getIcarusReferenceKey(right.reference)));
  const unknownCriticalDependencies = unhealthyCriticalDependencies.filter((health) => health.health === "Unknown");
  const dependencyResilienceByKey = new Map(dependencyResilience.map((entry) =>
    [getIcarusReferenceKey(entry.reference), entry] as const));
  const dependencyHistoryByAssessment = new Map<string, Map<string, IcarusDependencyHealthSnapshot>>();
  failureChains.dependencyGraph.controls.forEach((control) => {
    control.dependencyHealth.forEach((health) => {
      const dependencyKey = getIcarusReferenceKey(health.reference);
      const resilience = dependencyResilienceByKey.get(dependencyKey)?.resilience ?? "Unknown";
      const perAssessment = dependencyHistoryByAssessment.get(control.assessmentId) ?? new Map();
      perAssessment.set(dependencyKey, { dependencyKey, health: health.health, resilience });
      dependencyHistoryByAssessment.set(control.assessmentId, perAssessment);
    });
  });
  const dependencyHistorySnapshots = new Map(
    [...dependencyHistoryByAssessment].map(([assessmentId, dependencies]) =>
      [assessmentId, [...dependencies.values()].sort((left, right) => left.dependencyKey.localeCompare(right.dependencyKey))] as const),
  );

  return {
    nowMs,
    reviews,
    unresolvedFindings,
    unresolvedFindingAssessmentCount: new Set(unresolvedFindings.map((finding) => finding.assessmentId)).size,
    assessmentStatuses,
    assurance,
    assuranceRollup: buildIcarusAssuranceRollup(assurance.assessments),
    dependencyHealth,
    dependencyResilience,
    resilienceInterventions,
    criticalDependencies,
    unhealthyCriticalDependencies,
    unknownCriticalDependencies,
    failureChains,
    healthTriggeredChains: failureChains.healthTriggeredChains,
    strategicSignals,
    closedAssessmentWarnings,
    correlationSignals: buildIcarusCorrelationSignals({ signals: strategicSignals }),
    founderFocusRisks: buildIcarusFounderFocusRisks(strategicSignals),
    exposureSnapshot: input.includeExposureSnapshot === false
      ? []
      : buildIcarusExposureSnapshot(strategicSignals, dependencyHistorySnapshots),
  };
}

// Structural view of the generic correlation graph result that Stage B needs (satisfied by CorrelationGraphResult).
export type IcarusCorrelationGraphView = Omit<IcarusClusterGraphInput, "convergentRisks"> & {
  convergentRisks: readonly ConvergentSituationInput[];
  signalled: ReadonlyMap<string, { recordKey: string; objectType: string; area: string; signals: ReadonlySet<string> }>;
};

export type IcarusRecordPillar = { objectType: string; id: string; pillar: string };

export type IcarusCorrelationIntelligenceInput = {
  // Must be built with Stage A's correlationSignals as its strategic risks.
  graph: IcarusCorrelationGraphView;
  // Operating pillars to roll up (defaults to every operating pillar).
  pillars?: readonly string[];
  // Stored pillar/area of Empire records an assessment may link instead of a pillar.
  recordPillars?: readonly IcarusRecordPillar[];
};

export type IcarusCorrelationIntelligence = {
  clusterContributions: ReadonlyMap<string, IcarusClusterContribution>;
  systemicExposure: IcarusSystemicExposure;
  // Strategic risks already represented by a convergent situation; consumed by final Command presentation.
  strategicRiskConvergence: ReadonlyMap<string, StrategicRiskConvergence>;
};

const ICARUS_GRAPH_OBJECT_TYPE = "Icarus";

// Record keys that differ between the graph's Icarus records and Stage A's correlation signals. Empty => consistent.
export function findIcarusCorrelationGraphMismatch(
  graph: Pick<IcarusCorrelationGraphView, "signalled">,
  intelligence: Pick<IcarusStrategicIntelligence, "correlationSignals">,
): string[] {
  const expected = new Set(intelligence.correlationSignals.map((signal) => signal.recordKey));
  const present = new Set(
    [...graph.signalled.values()]
      .filter((record) => record.objectType === ICARUS_GRAPH_OBJECT_TYPE)
      .map((record) => record.recordKey),
  );
  return [...new Set([...expected, ...present])]
    .filter((recordKey) => expected.has(recordKey) !== present.has(recordKey))
    .sort();
}

export function buildIcarusCorrelationIntelligence(
  intelligence: IcarusStrategicIntelligence,
  input: IcarusCorrelationIntelligenceInput,
): IcarusCorrelationIntelligence {
  const mismatch = findIcarusCorrelationGraphMismatch(input.graph, intelligence);
  if (mismatch.length > 0) {
    throw new Error(`Icarus correlation graph is out of sequence with strategic intelligence: ${mismatch.join(", ")}`);
  }

  const clusterContributions = buildIcarusClusterContributions(input.graph, intelligence.correlationSignals);
  const recordPillars = new Map<string, string>();
  (input.recordPillars ?? []).forEach(({ objectType, id, pillar }) => {
    if (pillar) recordPillars.set(`${objectType}:${id}`, pillar);
  });
  const systemicExposure = buildIcarusSystemicExposure({
    signals: intelligence.strategicSignals,
    ...(input.pillars ? { pillars: input.pillars } : {}),
    recordPillars,
    otherSignals: [...input.graph.signalled.values()]
      .filter((record) => record.objectType !== ICARUS_GRAPH_OBJECT_TYPE)
      .map(({ recordKey, area, signals }) => ({ recordKey, area, signals: [...signals] })),
    clusters: [...clusterContributions.values()].map((contribution) => ({
      clusterKey: contribution.clusterKey,
      convergent: contribution.convergent,
      assessmentIds: contribution.assessments.map((assessment) => assessment.assessmentId),
    })),
  });
  const strategicRiskConvergence = resolveStrategicRiskConvergence(
    input.graph.convergentRisks,
    intelligence.correlationSignals.map((signal) => signal.recordKey),
  );

  return { clusterContributions, systemicExposure, strategicRiskConvergence };
}
