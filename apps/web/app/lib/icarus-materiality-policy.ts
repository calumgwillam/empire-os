// The single derived-severity contract for Icarus. Icarus stores no severity field; every
// consumer (strategic attention, Command, Founder Focus, correlation, pillar exposure,
// trajectory) must interpret materiality through this module so interpretations cannot drift.
//
// Three independent inputs, combined in a fixed order:
//   1. Evidence strength  — derived from persisted evidence reviews on a failure mode.
//   2. Effective protection — control lifecycle/effectiveness + review findings, capped by required dependency health.
//   3. Strategic consequence — derived at read time from LIVE strategic context (linked objective
//      importance, operating-pillar link). Never persisted on the assessment.
// Evidence × control => exposure tier (ordinal). Exposure tier => materiality tier (Material vs
// Corroborating). Exposure + consequence + concentration => a ranking score that only orders
// items; it is not a measurement and must not be displayed as one.

export type IcarusMaterialitySource = "Persisted" | "Derived from persisted Icarus records" | "Derived from live strategic context"
  | "Derived from Icarus records and required dependency health";

export const ICARUS_MATERIALITY_CONTRACT = {
  evidenceStrength: "Derived from persisted Icarus records",
  controlState: "Derived from persisted Icarus records",
  exposure: "Derived from Icarus records and required dependency health",
  materialityTier: "Derived from Icarus records and required dependency health",
  strategicConsequence: "Derived from live strategic context",
  rankingScore: "Derived from live strategic context",
  assessmentStatus: "Persisted",
} as const satisfies Record<string, IcarusMaterialitySource>;

// ── 1. Evidence strength ─────────────────────────────────────────────────────

export type IcarusMechanismEvidence = "Supported" | "Contested" | "Contradicted" | "Unevidenced";

export function classifyIcarusMechanismEvidence(input: { supportingCount: number; contradictingCount: number }): IcarusMechanismEvidence {
  if (input.supportingCount > 0) return input.contradictingCount > 0 ? "Contested" : "Supported";
  return input.contradictingCount > 0 ? "Contradicted" : "Unevidenced";
}

export function isIcarusMechanismEvidenced(evidence: IcarusMechanismEvidence): boolean {
  return evidence === "Supported" || evidence === "Contested";
}

// ── 2. Control state ─────────────────────────────────────────────────────────

export type IcarusControlGap = "Failing" | "Uncontrolled" | "Unverified";

export function classifyIcarusControlGap(input: { failingControlCount: number; operatingControlCount: number }): IcarusControlGap {
  if (input.failingControlCount > 0) return "Failing";
  return input.operatingControlCount === 0 ? "Uncontrolled" : "Unverified";
}

// ── Evidence × control => exposure ───────────────────────────────────────────

// Ordered from most to least material. Index is the exposure rank.
export const ICARUS_EXPOSURES = [
  "Exposed",
  "Failing control",
  "Unverified control",
  "Unexamined strategic exposure",
] as const;

export type IcarusExposure = (typeof ICARUS_EXPOSURES)[number];

export function getIcarusExposureRank(exposure: IcarusExposure): number {
  return ICARUS_EXPOSURES.indexOf(exposure);
}

// Returns null when the failure mode is not a current strategic exposure (e.g. contradicted
// mechanism, or unevidenced+uncontrolled with no strategic link).
export function classifyIcarusExposure(input: {
  evidence: IcarusMechanismEvidence;
  controlGap: IcarusControlGap;
  strategicallyLinked: boolean;
}): IcarusExposure | null {
  if (input.evidence === "Contradicted") return null;
  const evidenced = isIcarusMechanismEvidenced(input.evidence);
  if (evidenced && input.controlGap !== "Unverified") return "Exposed";
  if (input.controlGap === "Failing") return "Failing control";
  if (evidenced) return "Unverified control";
  if (input.controlGap === "Uncontrolled" && input.strategicallyLinked) return "Unexamined strategic exposure";
  return null;
}

// ── Exposure => materiality tier ─────────────────────────────────────────────

// "Material": evidenced or failing-control exposure; may create convergence and material pillar exposure.
// "Corroborating": unverified/unexamined exposure; may strengthen but never create convergence.
export type IcarusMaterialityTier = "Material" | "Corroborating";

export function getIcarusMaterialityTier(exposure: IcarusExposure): IcarusMaterialityTier {
  return exposure === "Exposed" || exposure === "Failing control" ? "Material" : "Corroborating";
}

export function isIcarusMaterialExposure(exposure: IcarusExposure): boolean {
  return getIcarusMaterialityTier(exposure) === "Material";
}

// ── 3. Strategic consequence (live context, not persisted) ──────────────────

export type IcarusStrategicScope = "Strategic objective" | "Pillar" | "Operational";
export type IcarusObjectiveImportance = "Critical" | "High" | "Medium";

const scopeRank: Record<IcarusStrategicScope, number> = { "Strategic objective": 0, "Pillar": 1, "Operational": 2 };
const importanceRank: Record<IcarusObjectiveImportance, number> = { Critical: 0, High: 1, Medium: 2 };

export function getIcarusScopeRank(scope: IcarusStrategicScope): number {
  return scopeRank[scope];
}

export function getIcarusObjectiveImportanceRank(importance: IcarusObjectiveImportance): number {
  return importanceRank[importance];
}

export function deriveIcarusStrategicScope(input: { liveObjectiveLinked: boolean; operatingPillarLinked: boolean }): IcarusStrategicScope {
  if (input.liveObjectiveLinked) return "Strategic objective";
  return input.operatingPillarLinked ? "Pillar" : "Operational";
}

// ── Combination: ranking score (ordering only) ──────────────────────────────

export const ICARUS_EXPOSURE_RANKING_BASE: Readonly<Record<IcarusExposure, number>> = {
  "Exposed": 150,
  "Failing control": 120,
  "Unverified control": 90,
  "Unexamined strategic exposure": 70,
};

// Offset placing Icarus on the same scale as Founder Focus / correlation base scores.
export const ICARUS_ATTENTION_SCORE_OFFSET = 150;

export type IcarusRankingInput = {
  exposure: IcarusExposure;
  scope: IcarusStrategicScope;
  objectiveImportance?: IcarusObjectiveImportance;
  materialFailureModeCount: number;
  weaknessCount: number;
  hasOverdueControlReview: boolean;
};

export function composeIcarusRankingScore(input: IcarusRankingInput): number {
  return ICARUS_EXPOSURE_RANKING_BASE[input.exposure]
    + (input.scope === "Strategic objective" ? 30 : input.scope === "Pillar" ? 20 : 0)
    + (input.objectiveImportance === "Critical" ? 15 : input.objectiveImportance === "High" ? 5 : 0)
    + Math.min(30, Math.max(0, input.materialFailureModeCount - 1) * 10)
    + Math.min(20, Math.max(0, input.weaknessCount - 1) * 5)
    + (input.hasOverdueControlReview ? 15 : 0);
}

export function getIcarusAttentionScore(rankingScore: number): number {
  return rankingScore + ICARUS_ATTENTION_SCORE_OFFSET;
}

// Command ranks 1–2 are reserved for blocked/overdue execution; Icarus never outranks them.
export function getIcarusCommandRank(exposure: IcarusExposure, hasOverdueControlReview: boolean): number {
  if (exposure === "Exposed") return 3;
  if (exposure === "Failing control") return 4;
  if (exposure === "Unverified control") return hasOverdueControlReview ? 5 : 6;
  return 7;
}

// Founder Focus bands: 1 authority, 2 blocked/overdue/review due, 3 material, 4–5 structural.
export function getIcarusFounderFocusBand(exposure: IcarusExposure, hasOverdueControlReview: boolean): number {
  if (exposure === "Exposed") return 3;
  if (exposure === "Failing control" || (exposure === "Unverified control" && hasOverdueControlReview)) return 4;
  return 5;
}

// ── Trajectory ───────────────────────────────────────────────────────────────

export type IcarusSeverityDirection = "Worsened" | "Improved" | "Persistent";

// A more severe tier or a newly exposed mechanism is worsening even if another mechanism was controlled.
export function compareIcarusSeverity(
  previous: { exposure: IcarusExposure; riskScore: number; failureModeIds: readonly string[] },
  current: { exposure: IcarusExposure; riskScore: number; failureModeIds: readonly string[] },
): IcarusSeverityDirection {
  const previousModes = new Set(previous.failureModeIds);
  const currentModes = new Set(current.failureModeIds);
  const added = current.failureModeIds.some((id) => !previousModes.has(id));
  const removed = previous.failureModeIds.some((id) => !currentModes.has(id));
  const rankDelta = getIcarusExposureRank(current.exposure) - getIcarusExposureRank(previous.exposure);
  if (rankDelta < 0 || (rankDelta === 0 && added)) return "Worsened";
  if (rankDelta > 0 || removed) return "Improved";
  if (current.riskScore > previous.riskScore) return "Worsened";
  if (current.riskScore < previous.riskScore) return "Improved";
  return "Persistent";
}
