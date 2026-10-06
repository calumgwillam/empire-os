import type { IcarusControlAssuranceStatus } from "./icarus-assurance-policy";
import type { IcarusDependencyHealthState } from "./icarus-dependency-health";

// Shared vocabulary for Icarus failure-chain intelligence. Every state here is categorical/ordinal and derived
// from persisted Icarus records plus live strategic context; nothing is a probability or an expected loss.

// ── Barriers ──
// A control is only a barrier to the extent Strategic Assurance has verified it. Accepted exposure is never a
// barrier, and several barriers on one mode are never assumed to be independent layers.
export const ICARUS_BARRIER_STATES = ["Active", "Weak", "Unknown", "Failed", "None"] as const;
export type IcarusBarrierState = (typeof ICARUS_BARRIER_STATES)[number];

export function getIcarusBarrierState(status: IcarusControlAssuranceStatus): IcarusBarrierState {
  switch (status) {
    case "Assured": return "Active";
    case "Failed": return "Failed";
    case "Test overdue":
    case "Evidence insufficient":
    case "Inconclusive": return "Weak";
    case "Untested": return "Unknown";
    case "Not operating": return "Failed";
  }
}

export function getIcarusEffectiveBarrierState(
  status: IcarusControlAssuranceStatus,
  requiredDependencyHealth: readonly IcarusDependencyHealthState[],
): IcarusBarrierState {
  const controlBarrier = getIcarusBarrierState(status);
  if (controlBarrier === "Failed") return "Failed";
  if (requiredDependencyHealth.includes("Failed")) return "Failed";

  if (controlBarrier === "Active") {
    if (requiredDependencyHealth.includes("Unknown")) return "Unknown";
    if (requiredDependencyHealth.includes("Degraded")) return "Weak";
    return "Active";
  }
  if (controlBarrier === "Weak" && requiredDependencyHealth.includes("Unknown")) return "Unknown";
  return controlBarrier;
}

// Strongest-first; used to describe the best barrier a failure mode currently has.
export function getIcarusBarrierStrengthRank(state: IcarusBarrierState): number {
  return ICARUS_BARRIER_STATES.indexOf(state);
}

// Whether a barrier could still interrupt a chain if it works (operating and not recorded as failing).
export function isIcarusBarrierCapable(state: IcarusBarrierState): boolean {
  return state === "Active" || state === "Weak" || state === "Unknown";
}

// ── Propagation ──
export const ICARUS_PROPAGATION_STATES = [
  "Direct consequence",
  "Downstream exposure",
  "Potential propagation",
  "Unknown dependency",
] as const;
export type IcarusPropagationState = (typeof ICARUS_PROPAGATION_STATES)[number];

export function getIcarusPropagationStateRank(state: IcarusPropagationState): number {
  return ICARUS_PROPAGATION_STATES.indexOf(state);
}

// ── Blast radius ──
// "Cross-assessment" replaces a project tier: Icarus records do not model a failure flowing into a project, so
// the next structural unit above one assessment is several assessments sharing a dependency.
export const ICARUS_BLAST_RADII = ["Local", "Cross-assessment", "Cross-objective", "Cross-pillar", "Empire-wide"] as const;
export type IcarusBlastRadius = (typeof ICARUS_BLAST_RADII)[number];

export type IcarusBlastRadiusBasis =
  | "single-assessment"
  | "reaches-multiple-assessments"
  | "reaches-objective"
  | "reaches-multiple-objectives"
  | "reaches-critical-objective"
  | "reaches-pillar"
  | "reaches-multiple-pillars"
  | "reaches-all-operating-pillars"
  | "founder-dependency";

export function getIcarusBlastRadiusRank(radius: IcarusBlastRadius): number {
  return ICARUS_BLAST_RADII.indexOf(radius);
}

export function classifyIcarusBlastRadius(input: {
  assessmentCount: number;
  objectiveCount: number;
  pillarCount: number;
  operatingPillarTotal: number;
}): IcarusBlastRadius {
  if (input.operatingPillarTotal > 1 && input.pillarCount >= input.operatingPillarTotal) return "Empire-wide";
  if (input.pillarCount >= 2) return "Cross-pillar";
  if (input.objectiveCount >= 2) return "Cross-objective";
  if (input.assessmentCount >= 2) return "Cross-assessment";
  return "Local";
}

// ── Chain priority ──
export const ICARUS_CHAIN_PRIORITIES = ["Critical", "High", "Elevated", "Contained"] as const;
export type IcarusChainPriority = (typeof ICARUS_CHAIN_PRIORITIES)[number];

export type IcarusChainPriorityBasis =
  | "material-origin"
  | "failed-barrier"
  | "potential-only"
  | "critical-objective"
  | "cross-objective"
  | "cross-pillar"
  | "empire-wide"
  | "spof"
  | "founder-spof"
  | "common-cause"
  | "accepted-exposure"
  | "interrupted";

export function getIcarusChainPriorityRank(priority: IcarusChainPriority): number {
  return ICARUS_CHAIN_PRIORITIES.indexOf(priority);
}

// Systemic = the chain reaches beyond one objective, shares a causal single point / common cause with others, or
// rests on the founder as a single point of failure. Critical additionally requires a material origin plus a failed
// barrier, a critical objective, or founder dependency compounding another systemic structure.
export function classifyIcarusChainPriority(basis: ReadonlySet<IcarusChainPriorityBasis>): IcarusChainPriority {
  const structural = basis.has("cross-objective") || basis.has("cross-pillar") || basis.has("empire-wide")
    || basis.has("spof") || basis.has("common-cause");
  // Founder dependency carrying several material risks is systemic in its own right (founder-dependency principle),
  // and compounds any other systemic structure.
  const systemic = structural || basis.has("founder-spof");
  const material = basis.has("material-origin");
  if (material && systemic && (basis.has("failed-barrier") || basis.has("critical-objective") || (structural && basis.has("founder-spof")))) {
    return "Critical";
  }
  if (material && systemic) return "High";
  if (material || systemic) return "Elevated";
  return "Contained";
}

// ── Single points of failure / shared dependencies ──
export type IcarusSpofKind = "Control" | "Dependency" | "Ownership concentration" | "Enabling project";
export type IcarusSpofAssurance = "Strong" | "Weak" | "Failed" | "Unknown" | "Not applicable";
export type IcarusSpofBasis =
  | "sole-barrier"
  | "sole-barrier-dependency"
  | "owns-multiple-material-risks"
  | "sole-enabling-project"
  | "multiple-assessments"
  | "multiple-objectives"
  | "multiple-pillars"
  | "critical-objective"
  | "founder-dependency";

export type IcarusSharedDependencyKind =
  | "Common control mechanism"
  | "Shared dependency"
  | "Common owner"
  | "Common remediation"
  | "Common strategic target";

// Only dependency relationships are causal common cause; owners, remediation and targets are concentration.
export function isIcarusSharedDependencyCausal(kind: IcarusSharedDependencyKind): boolean {
  return kind === "Common control mechanism" || kind === "Shared dependency";
}

// ── Signal annotation (Command / Founder Focus) ──
// Attached to a strategic signal after assurance. Absent => pre-failure-chain behaviour.
export type IcarusSignalFailureChain = {
  priority: IcarusChainPriority;
  blastRadius: IcarusBlastRadius;
  basis: IcarusChainPriorityBasis[];
  // Systemic SPOF / common-cause keys involving this signal's chains.
  spofKeys: string[];
  sharedDependencyKeys: string[];
  // Failed / weak / unknown barrier control ids on this signal's live chains (restoration candidates).
  weakBarrierControlIds: string[];
  // Present only on the one signal chosen to carry a systemic chain issue, or on a material cross-objective chain.
  // Uppercase Command reason and sentence-case Founder Focus text describe the same issue.
  commandReason?: string;
  focusReason?: string;
  dependencyHealthLift?: boolean;
};

const COMMAND_RANK_FLOOR = 3;
const FOCUS_BAND_FLOOR = 3;

// A critical chain or strategically material dependency-health issue may lift a signal once, never into execution
// ranks 1–2, and never on top of an assurance lift.
export function adjustIcarusCommandRankForFailureChain(
  rank: number,
  unliftedRank: number,
  failureChain?: IcarusSignalFailureChain,
): number {
  if (!failureChain || (failureChain.priority !== "Critical" && !failureChain.dependencyHealthLift) || !failureChain.commandReason) return rank;
  if (rank < unliftedRank) return rank;
  return Math.max(COMMAND_RANK_FLOOR, rank - 1);
}

export function adjustIcarusFounderFocusBandForFailureChain(
  band: number,
  unliftedBand: number,
  failureChain?: IcarusSignalFailureChain,
): number {
  if (!failureChain || (failureChain.priority !== "Critical" && !failureChain.dependencyHealthLift) || !failureChain.focusReason) return band;
  if (band < unliftedBand) return band;
  return Math.max(FOCUS_BAND_FLOOR, band - 1);
}
