import {
  getIcarusAssuranceStateRank,
  getIcarusEscalationRank,
  type IcarusAssuranceState,
  type IcarusEscalationLevel,
} from "./icarus-assurance-policy";
import type { IcarusAssessmentAssurance } from "./icarus-assurance";

// Categorical, evidence-derived rollups. No percentages or scores: every posture is explained by counts of
// real assurance facts on material assessments.

export const ICARUS_PILLAR_ASSURANCE_POSTURES = [
  "Assurance failure",
  "Governance gaps",
  "Partially assured",
  "Governed exposure",
  "Assured",
  "No material exposure",
] as const;
export type IcarusPillarAssurancePosture = (typeof ICARUS_PILLAR_ASSURANCE_POSTURES)[number];

export type IcarusAssuranceStateCounts = Record<IcarusAssuranceState, number>;

export type IcarusPillarAssuranceRollup = {
  pillarId: string;
  posture: IcarusPillarAssurancePosture;
  materialAssessmentIds: string[];
  stateCounts: IcarusAssuranceStateCounts;
  unownedMaterialAssessmentIds: string[];
  failedControlCount: number;
  overdueObligationCount: number;
  activeAcceptanceCount: number;
  expiredAcceptanceCount: number;
  escalatingAssessmentIds: string[];
};

// How strongly an objective's material risks are actually protected.
export const ICARUS_OBJECTIVE_PROTECTION_LEVELS = [
  "Exposed",
  "Assumed protection",
  "Partially tested",
  "Accepted exposure",
  "Tested controls",
] as const;
export type IcarusObjectiveProtection = (typeof ICARUS_OBJECTIVE_PROTECTION_LEVELS)[number];

const protectionByState: Readonly<Record<IcarusAssuranceState, IcarusObjectiveProtection>> = {
  Weak: "Exposed",
  Unassured: "Assumed protection",
  "Partially assured": "Partially tested",
  "Accepted exposure": "Accepted exposure",
  Assured: "Tested controls",
};

export type IcarusObjectiveAssuranceRollup = {
  objectiveId: string;
  protection: IcarusObjectiveProtection;
  // Weakest material assessment (deterministic) explaining the protection level.
  weakestAssessmentId: string;
  materialAssessmentIds: string[];
  stateCounts: IcarusAssuranceStateCounts;
  escalation: IcarusEscalationLevel;
};

export type IcarusAssuranceRollup = {
  pillars: IcarusPillarAssuranceRollup[];
  objectives: IcarusObjectiveAssuranceRollup[];
  // Material assessments with no attributable operating pillar stay explicit rather than forced into one.
  unattributedMaterialAssessmentIds: string[];
};

function emptyCounts(): IcarusAssuranceStateCounts {
  return { Weak: 0, Unassured: 0, "Partially assured": 0, "Accepted exposure": 0, Assured: 0 };
}

function countStates(entries: readonly IcarusAssessmentAssurance[]): IcarusAssuranceStateCounts {
  const counts = emptyCounts();
  entries.forEach((entry) => { counts[entry.state] += 1; });
  return counts;
}

function strongestEscalation(entries: readonly IcarusAssessmentAssurance[]): IcarusEscalationLevel {
  return entries
    .map((entry) => entry.escalation)
    .sort((left, right) => getIcarusEscalationRank(left) - getIcarusEscalationRank(right))[0] ?? "None";
}

function getPillarPosture(entries: readonly IcarusAssessmentAssurance[]): IcarusPillarAssurancePosture {
  if (entries.length === 0) return "No material exposure";
  const escalation = strongestEscalation(entries);
  if (escalation === "Assurance failure") return "Assurance failure";
  if (escalation === "Governance gap") return "Governance gaps";
  if (entries.every((entry) => entry.state === "Assured")) return "Assured";
  return entries.every((entry) => entry.state === "Assured" || entry.state === "Accepted exposure")
    ? "Governed exposure" : "Partially assured";
}

function groupBy(entries: readonly IcarusAssessmentAssurance[], keys: (entry: IcarusAssessmentAssurance) => readonly string[]) {
  const groups = new Map<string, IcarusAssessmentAssurance[]>();
  entries.forEach((entry) => {
    // Each assessment counts once per group even if it reaches the group through several links.
    new Set(keys(entry)).forEach((key) => {
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    });
  });
  return groups;
}

const byPostureThenId = (left: IcarusPillarAssuranceRollup, right: IcarusPillarAssuranceRollup) =>
  ICARUS_PILLAR_ASSURANCE_POSTURES.indexOf(left.posture) - ICARUS_PILLAR_ASSURANCE_POSTURES.indexOf(right.posture)
  || left.pillarId.localeCompare(right.pillarId);

export function buildIcarusAssuranceRollup(assessments: readonly IcarusAssessmentAssurance[]): IcarusAssuranceRollup {
  const material = assessments.filter((entry) => entry.material);

  const pillarGroups = groupBy(assessments, (entry) => entry.operatingPillarIds);
  const pillars = [...pillarGroups.entries()].map(([pillarId, entries]): IcarusPillarAssuranceRollup => {
    const materialEntries = entries.filter((entry) => entry.material);
    const sortedIds = (list: readonly IcarusAssessmentAssurance[]) => list.map((entry) => entry.assessmentId).sort();
    const currentAcceptances = materialEntries.flatMap((entry) => entry.acceptances.filter((acceptance) => acceptance.current));
    return {
      pillarId,
      posture: getPillarPosture(materialEntries),
      materialAssessmentIds: sortedIds(materialEntries),
      stateCounts: countStates(materialEntries),
      unownedMaterialAssessmentIds: sortedIds(materialEntries.filter((entry) => entry.ownership !== "Assigned")),
      failedControlCount: new Set(materialEntries.flatMap((entry) =>
        entry.signal.failedControlIds.map((controlId) => `${entry.assessmentId}:${controlId}`))).size,
      overdueObligationCount: materialEntries.reduce((total, entry) => total + entry.signal.overdueObligationCount, 0),
      activeAcceptanceCount: currentAcceptances.filter((acceptance) => acceptance.validity === "Active").length,
      expiredAcceptanceCount: currentAcceptances.filter((acceptance) => acceptance.validity === "Expired").length,
      escalatingAssessmentIds: sortedIds(materialEntries.filter((entry) => entry.escalation !== "None")),
    };
  }).sort(byPostureThenId);

  const objectiveGroups = groupBy(material, (entry) => entry.objectiveIds);
  const objectives = [...objectiveGroups.entries()].map(([objectiveId, entries]): IcarusObjectiveAssuranceRollup => {
    const weakest = [...entries].sort((left, right) =>
      getIcarusAssuranceStateRank(left.state) - getIcarusAssuranceStateRank(right.state)
      || getIcarusEscalationRank(left.escalation) - getIcarusEscalationRank(right.escalation)
      || left.assessmentId.localeCompare(right.assessmentId))[0];
    return {
      objectiveId,
      protection: protectionByState[weakest.state],
      weakestAssessmentId: weakest.assessmentId,
      materialAssessmentIds: entries.map((entry) => entry.assessmentId).sort(),
      stateCounts: countStates(entries),
      escalation: strongestEscalation(entries),
    };
  }).sort((left, right) =>
    ICARUS_OBJECTIVE_PROTECTION_LEVELS.indexOf(left.protection) - ICARUS_OBJECTIVE_PROTECTION_LEVELS.indexOf(right.protection)
    || left.objectiveId.localeCompare(right.objectiveId));

  return {
    pillars,
    objectives,
    unattributedMaterialAssessmentIds: material
      .filter((entry) => entry.operatingPillarIds.length === 0)
      .map((entry) => entry.assessmentId)
      .sort(),
  };
}
