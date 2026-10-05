import {
  CORRELATION_CONVERGENCE_MIN_CATEGORIES,
  CORRELATION_CONVERGENCE_MIN_RECORDS,
  type CorrelationStrategicRiskInput,
  type CorrelationStrategicRiskWeight,
} from "./correlation-graph";
import type { IcarusRecordReference } from "./icarus";
import {
  getIcarusAttentionScore,
  getIcarusExposureRank,
  isIcarusMaterialExposure,
  type IcarusExposure,
} from "./icarus-materiality-policy";
import {
  ICARUS_RELATIONSHIP_ORIGINS,
  type IcarusRelationshipKind,
  type IcarusRelationshipOrigin,
} from "./icarus-relationships";
import type { IcarusAttentionReference, IcarusStrategicSignal } from "./icarus-strategic-attention";
import {
  getIcarusEscalationRank,
  type IcarusAssuranceState,
  type IcarusEscalationLevel,
  type IcarusObligationCategory,
} from "./icarus-assurance-policy";

// Governance/assurance failure is carried as a distinct, provenance-only dimension. It never adds a second
// correlation category or weight for the same assessment, so one exposure cannot be counted twice.
export type IcarusCorrelationGovernance = {
  state: IcarusAssuranceState;
  escalation: IcarusEscalationLevel;
  categories: IcarusObligationCategory[];
};

// How an Icarus assessment is legitimately connected to another Empire OS record identity.
// Mirrors the authoritative relationship origins so correlation provenance never diverges from them.
export type IcarusCorrelationVia = IcarusRelationshipOrigin;

export type IcarusCorrelationLink = {
  recordKey: string;
  via: IcarusCorrelationVia;
  // "Direct" links are explicit references; "Expanded" links come from a live linked objective.
  kind: IcarusRelationshipKind;
  objectiveId?: string;
  failureModeId?: string;
  controlId?: string;
  evidenceId?: string;
};

export type IcarusCorrelationSignal = Omit<CorrelationStrategicRiskInput, "links"> & {
  objectType: "Icarus";
  assessmentId: string;
  exposure: IcarusExposure;
  reference: IcarusAttentionReference;
  links: IcarusCorrelationLink[];
  governance?: IcarusCorrelationGovernance;
};

export type IcarusCorrelationInput = {
  // Each signal already carries its authoritative relationship set (see icarus-relationships).
  signals: readonly IcarusStrategicSignal[];
};

export const ICARUS_CORRELATION_CATEGORY: Record<IcarusExposure, string> = {
  "Exposed": "icarus exposed failure mechanism",
  "Failing control": "icarus failing control",
  "Unverified control": "icarus unverified control",
  "Unexamined strategic exposure": "icarus unexamined strategic exposure",
};

// Only evidenced or failing-control exposure can create convergence; weaker exposure corroborates only.
export function getIcarusCorrelationWeight(exposure: IcarusExposure): CorrelationStrategicRiskWeight {
  return isIcarusMaterialExposure(exposure) ? "material" : "corroborating";
}

export function getIcarusCorrelationRecordKey(assessmentId: string): string {
  return `Icarus:${assessmentId}`;
}

const graphRecordTypes = new Set<string>([
  "Capture",
  "Problem",
  "Action",
  "Decision",
  "Opportunity",
  "Project",
  "Lead",
  "Lesson",
  "System",
  "SOP",
]);

// Maps an Icarus record reference onto correlation-graph identities. Person maps to a context identity that only
// participates when a matching context record (e.g. founder dependency) is supplied. Pillar and Outreach have none:
// a shared pillar is too broad to imply the same underlying issue.
export function getIcarusCorrelationTargets(reference: IcarusRecordReference): string[] {
  if (graphRecordTypes.has(reference.recordType)) return [`${reference.recordType}:${reference.recordId}`];
  if (reference.recordType === "Person") return [`Person:${reference.recordId}`];
  if (reference.recordType === "Commitment") return [`Finance:commitment:${reference.recordId}`];
  // The Finance source is the cash position, which drives the cash-buffer and funding-gap signals.
  if (reference.recordType === "Finance") return ["Finance:cash-buffer", "Finance:funding-gap"];
  return [];
}

function linkIdentity(link: IcarusCorrelationLink): string {
  return [link.recordKey, link.kind, link.via, link.objectiveId ?? "", link.failureModeId ?? "", link.controlId ?? "", link.evidenceId ?? ""].join("|");
}

function compareLinks(left: IcarusCorrelationLink, right: IcarusCorrelationLink): number {
  return (left.kind === right.kind ? 0 : left.kind === "Direct" ? -1 : 1)
    || ICARUS_RELATIONSHIP_ORIGINS.indexOf(left.via) - ICARUS_RELATIONSHIP_ORIGINS.indexOf(right.via)
    || left.recordKey.localeCompare(right.recordKey)
    || (left.objectiveId ?? "").localeCompare(right.objectiveId ?? "")
    || (left.failureModeId ?? "").localeCompare(right.failureModeId ?? "")
    || (left.controlId ?? "").localeCompare(right.controlId ?? "")
    || (left.evidenceId ?? "").localeCompare(right.evidenceId ?? "");
}

// Derives one correlation signal per material Icarus strategic signal, linked only through stable record identities.
export function buildIcarusCorrelationSignals(input: IcarusCorrelationInput): IcarusCorrelationSignal[] {
  return input.signals.map((signal) => {
    const links = new Map<string, IcarusCorrelationLink>();
    signal.relationships.forEach((relationship) =>
      getIcarusCorrelationTargets(relationship.reference).forEach((recordKey) => {
        const link: IcarusCorrelationLink = {
          recordKey,
          via: relationship.origin,
          kind: relationship.kind,
          ...(relationship.objectiveId ? { objectiveId: relationship.objectiveId } : {}),
          ...(relationship.failureModeId ? { failureModeId: relationship.failureModeId } : {}),
          ...(relationship.controlId ? { controlId: relationship.controlId } : {}),
          ...(relationship.evidenceId ? { evidenceId: relationship.evidenceId } : {}),
        };
        const identity = linkIdentity(link);
        if (!links.has(identity)) links.set(identity, link);
      }));

    return {
      recordKey: getIcarusCorrelationRecordKey(signal.assessmentId),
      objectType: "Icarus" as const,
      id: signal.assessmentId,
      assessmentId: signal.assessmentId,
      title: signal.outcome,
      area: signal.area,
      signal: ICARUS_CORRELATION_CATEGORY[signal.exposure],
      baseScore: getIcarusAttentionScore(signal.riskScore),
      weight: getIcarusCorrelationWeight(signal.exposure),
      exposure: signal.exposure,
      reference: { ...signal.primaryReference },
      links: [...links.values()].sort(compareLinks),
      ...(signal.assurance ? {
        governance: {
          state: signal.assurance.state,
          escalation: signal.assurance.escalation,
          categories: [...signal.assurance.escalationCategories],
        },
      } : {}),
    };
  });
}

export type IcarusClusterRole = "Completes convergence" | "Strengthens convergence" | "Correlated";

export type IcarusClusterAssessmentContribution = {
  recordKey: string;
  assessmentId: string;
  outcome: string;
  exposure: IcarusExposure;
  weight: CorrelationStrategicRiskWeight;
  reference: IcarusAttentionReference;
  governance?: IcarusCorrelationGovernance;
  // The shared record identities (with Icarus-side provenance) that placed this assessment in the situation.
  sharedRecords: { recordKey: string; links: IcarusCorrelationLink[] }[];
};

export type IcarusClusterContribution = {
  clusterKey: string;
  rootRecordKey: string;
  convergent: boolean;
  role: IcarusClusterRole;
  strongestExposure: IcarusExposure;
  // Strongest assurance escalation among contributing assessments ("None" when absent or not derived).
  strongestEscalation: IcarusEscalationLevel;
  assessments: IcarusClusterAssessmentContribution[];
  otherContributors: { recordKey: string; objectType: string; id: string; title: string; signals: string[] }[];
  // Context identities (e.g. a Person) attached because an Icarus assessment explicitly references them.
  contextContributors: {
    recordKey: string;
    objectType: string;
    id: string;
    title: string;
    signals: string[];
    linkedByAssessmentIds: string[];
    material: boolean;
  }[];
};

export type IcarusClusterGraphInput = {
  clusters: readonly {
    clusterKey: string;
    rootRecordKey: string;
    records: readonly { recordKey: string; objectType: string; id: string; title: string; signals: ReadonlySet<string> }[];
    strategicRiskLinks: readonly { riskRecordKey: string; sharedRecordKey: string }[];
    contextRecords?: readonly {
      recordKey: string;
      objectType: string;
      id: string;
      title: string;
      signals: readonly string[];
      linkedByRiskRecordKeys: readonly string[];
      material: boolean;
    }[];
  }[];
  convergentRisks: readonly { clusterKey: string }[];
};

// Describes, per correlated situation, exactly which Icarus assessments contributed, through which shared identities,
// and which non-Icarus signals they correlated with.
export function buildIcarusClusterContributions(
  graph: IcarusClusterGraphInput,
  signals: readonly IcarusCorrelationSignal[],
): Map<string, IcarusClusterContribution> {
  const signalsByKey = new Map(signals.map((signal) => [signal.recordKey, signal] as const));
  const convergentKeys = new Set(graph.convergentRisks.map((cluster) => cluster.clusterKey));
  const contributions = new Map<string, IcarusClusterContribution>();

  graph.clusters.forEach((cluster) => {
    const icarusRecords = cluster.records.filter((record) => signalsByKey.has(record.recordKey));
    if (icarusRecords.length === 0) return;
    const otherContributors = cluster.records
      .filter((record) => !signalsByKey.has(record.recordKey))
      .map((record) => ({
        recordKey: record.recordKey,
        objectType: record.objectType,
        id: record.id,
        title: record.title,
        signals: [...record.signals],
      }))
      .sort((left, right) => left.recordKey.localeCompare(right.recordKey));
    const contextContributors = (cluster.contextRecords ?? [])
      .map((context) => ({
        recordKey: context.recordKey,
        objectType: context.objectType,
        id: context.id,
        title: context.title,
        signals: [...context.signals],
        linkedByAssessmentIds: context.linkedByRiskRecordKeys
          .map((riskKey) => signalsByKey.get(riskKey)?.assessmentId)
          .filter((assessmentId): assessmentId is string => Boolean(assessmentId))
          .sort(),
        material: context.material,
      }))
      .filter((context) => context.linkedByAssessmentIds.length > 0);
    // Icarus only joins a situation through a shared identity; an isolated assessment is not a correlation.
    if (otherContributors.length === 0 && cluster.strategicRiskLinks.length === 0 && contextContributors.length === 0) return;

    const assessments = icarusRecords
      .map((record) => {
        const signal = signalsByKey.get(record.recordKey)!;
        const sharedKeys = cluster.strategicRiskLinks
          .filter((link) => link.riskRecordKey === record.recordKey)
          .map((link) => link.sharedRecordKey);
        return {
          recordKey: signal.recordKey,
          assessmentId: signal.assessmentId,
          outcome: signal.title,
          exposure: signal.exposure,
          weight: signal.weight,
          reference: { ...signal.reference },
          ...(signal.governance ? { governance: { ...signal.governance, categories: [...signal.governance.categories] } } : {}),
          sharedRecords: [
            ...sharedKeys,
            ...contextContributors
              .filter((context) => context.linkedByAssessmentIds.includes(signal.assessmentId))
              .map((context) => context.recordKey),
          ].map((recordKey) => ({
            recordKey,
            links: signal.links.filter((link) => link.recordKey === recordKey).map((link) => ({ ...link })),
          })),
        };
      })
      .sort((left, right) =>
        getIcarusExposureRank(left.exposure) - getIcarusExposureRank(right.exposure)
        || left.assessmentId.localeCompare(right.assessmentId));

    const convergent = convergentKeys.has(cluster.clusterKey);
    const otherCategories = new Set(otherContributors.flatMap((record) => record.signals));
    const convergentWithoutIcarus = otherCategories.size >= CORRELATION_CONVERGENCE_MIN_CATEGORIES
      && otherContributors.length >= CORRELATION_CONVERGENCE_MIN_RECORDS;
    contributions.set(cluster.clusterKey, {
      clusterKey: cluster.clusterKey,
      rootRecordKey: cluster.rootRecordKey,
      convergent,
      role: !convergent ? "Correlated" : convergentWithoutIcarus ? "Strengthens convergence" : "Completes convergence",
      strongestExposure: assessments[0].exposure,
      strongestEscalation: assessments
        .map((assessment) => assessment.governance?.escalation ?? "None")
        .sort((left, right) => getIcarusEscalationRank(left) - getIcarusEscalationRank(right))[0] ?? "None",
      assessments,
      otherContributors,
      contextContributors,
    });
  });

  return contributions;
}
