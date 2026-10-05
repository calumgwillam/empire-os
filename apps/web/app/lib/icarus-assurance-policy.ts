// The Icarus strategic-assurance contract. It sits beside the materiality policy and never replaces it:
//
//   Materiality (icarus-materiality-policy) answers "does a material failure mechanism exist?"
//   Assurance (this module) answers "is that risk owned, controlled by tested controls, deliberately accepted,
//   and governed?"
//
// Seven concepts are deliberately kept separate and are never collapsed into one status:
//   A. risk ownership        — persisted accountable owner (Person id) on the assessment
//   B. control ownership     — persisted owner (Person id) per control
//   C. assurance obligation  — DERIVED, never persisted; stable id per (assessment, category, source)
//   D. assurance result      — persisted control tests + legacy effectiveness reviews
//   E. evidence quality      — derived from persisted evidence reviews (existing review findings)
//   F. accepted exposure     — persisted, attributable, time-bounded acceptance of named failure modes
//   G. escalation            — DERIVED from obligations; only adjusts placement within Icarus's bounds
//
// No percentage or score is produced. Assessment assurance state is ordinal and conservative.

import type { IcarusMaterialitySource } from "./icarus-materiality-policy";

export const ICARUS_ASSURANCE_CONTRACT = {
  riskOwnership: "Persisted",
  controlOwnership: "Persisted",
  controlTests: "Persisted",
  acceptedExposure: "Persisted",
  assuranceObligations: "Derived from persisted Icarus records",
  controlAssurance: "Derived from persisted Icarus records",
  assessmentAssuranceState: "Derived from persisted Icarus records",
  escalation: "Derived from persisted Icarus records",
  // Founder-ownership concern and review-due obligations depend on live People/objective context.
  founderOwnershipConcern: "Derived from live strategic context",
  riskReviewDue: "Derived from live strategic context",
} as const satisfies Record<string, IcarusMaterialitySource>;

// ── Assessment assurance state ───────────────────────────────────────────────

// Ordered from weakest to strongest assurance.
export const ICARUS_ASSURANCE_STATES = [
  "Weak",
  "Unassured",
  "Partially assured",
  "Accepted exposure",
  "Assured",
] as const;

export type IcarusAssuranceState = (typeof ICARUS_ASSURANCE_STATES)[number];

export function getIcarusAssuranceStateRank(state: IcarusAssuranceState): number {
  return ICARUS_ASSURANCE_STATES.indexOf(state);
}

// Per failure mode. "Failing": a control failed or an evidenced mechanism has no operating control.
export type IcarusModeAssurance = "Failing" | "Unassured" | "Accepted" | "Partially assured" | "Assured";

export type IcarusAssuranceBasis =
  | "no-failure-modes"
  | "failing-control"
  | "evidenced-uncontrolled-mechanism"
  | "untested-control"
  | "uncontrolled-mechanism"
  | "valid-acceptance"
  | "tested-control"
  | "mixed-control-results";

// Conservative aggregation: any failing mode => Weak; Assured only when every mode is assured.
export function aggregateIcarusAssuranceState(modes: readonly IcarusModeAssurance[]): IcarusAssuranceState {
  if (modes.length === 0) return "Unassured";
  if (modes.includes("Failing")) return "Weak";
  if (modes.every((mode) => mode === "Assured")) return "Assured";
  const assuredOrPartial = modes.some((mode) => mode === "Assured" || mode === "Partially assured");
  if (modes.every((mode) => mode === "Assured" || mode === "Accepted")) return assuredOrPartial ? "Partially assured" : "Accepted exposure";
  return assuredOrPartial ? "Partially assured" : "Unassured";
}

// ── Control assurance ────────────────────────────────────────────────────────

export type IcarusControlAssuranceStatus =
  | "Assured"
  | "Failed"
  | "Test overdue"
  | "Evidence insufficient"
  | "Inconclusive"
  | "Untested"
  | "Not operating";

// Depth only counts what the data supports. Independence between controls is never recorded, so it is
// always reported as unknown rather than assumed.
export type IcarusAssuranceDepth = "None" | "Single control" | "Layered";
export type IcarusControlIndependence = "Unknown";

// ── Acceptance ───────────────────────────────────────────────────────────────

export type IcarusAcceptanceValidity = "Active" | "Expired" | "Invalid" | "Revoked";

export type IcarusAcceptanceInvalidReason =
  | "approver-not-active-person"
  | "missing-rationale"
  | "invalid-dates"
  | "review-before-acceptance";

// ── Ownership ────────────────────────────────────────────────────────────────

export type IcarusOwnershipState = "Assigned" | "Unassigned" | "Unknown person" | "Inactive person";

// ── Obligations ──────────────────────────────────────────────────────────────

// Ordered by governance severity; index is the obligation rank.
export const ICARUS_OBLIGATION_CATEGORIES = [
  "failing-control-remediation",
  "acceptance-expired",
  "control-test-overdue",
  "no-control",
  "no-risk-owner",
  "founder-owner-dependency",
  "acceptance-invalid",
  "control-without-owner",
  "control-never-tested",
  "control-evidence-insufficient",
  "mechanism-unexamined",
  "risk-review-due",
  "single-control-dependency",
] as const;

export type IcarusObligationCategory = (typeof ICARUS_OBLIGATION_CATEGORIES)[number];

// "Risk treatment": the failure mechanism itself still needs treating (this is "risk exists").
// "Assurance failure": an assurance mechanism has failed or lapsed.
// "Governance gap": the risk is not properly owned, tested, attributed or reviewed.
export type IcarusObligationKind = "Assurance failure" | "Governance gap" | "Risk treatment";

export const ICARUS_OBLIGATION_KIND: Readonly<Record<IcarusObligationCategory, IcarusObligationKind>> = {
  "failing-control-remediation": "Assurance failure",
  "acceptance-expired": "Assurance failure",
  "control-test-overdue": "Assurance failure",
  "no-control": "Risk treatment",
  "no-risk-owner": "Governance gap",
  "founder-owner-dependency": "Governance gap",
  "acceptance-invalid": "Governance gap",
  "control-without-owner": "Governance gap",
  "control-never-tested": "Governance gap",
  "control-evidence-insufficient": "Governance gap",
  "mechanism-unexamined": "Risk treatment",
  "risk-review-due": "Governance gap",
  "single-control-dependency": "Governance gap",
};

export const ICARUS_OBLIGATION_LABEL: Readonly<Record<IcarusObligationCategory, string>> = {
  "failing-control-remediation": "Failing control needs remediation",
  "acceptance-expired": "Accepted exposure has expired",
  "control-test-overdue": "Control test overdue",
  "no-control": "No operating control",
  "no-risk-owner": "No accountable risk owner",
  "founder-owner-dependency": "Founder owns risk while founder dependency is high",
  "acceptance-invalid": "Acceptance is not validly attributed",
  "control-without-owner": "Control has no owner",
  "control-never-tested": "Control never tested",
  "control-evidence-insufficient": "Control assurance lacks current supporting evidence",
  "mechanism-unexamined": "Failure mechanism unexamined",
  "risk-review-due": "High-consequence risk review due",
  "single-control-dependency": "Critical risk relies on a single tested control",
};

export function getIcarusObligationRank(category: IcarusObligationCategory): number {
  return ICARUS_OBLIGATION_CATEGORIES.indexOf(category);
}

// "Hygiene": belongs to an assessment/mode that is not currently a material strategic exposure.
export type IcarusObligationMateriality = "Material" | "Corroborating" | "Hygiene";

const obligationMaterialityRank: Record<IcarusObligationMateriality, number> = { Material: 0, Corroborating: 1, Hygiene: 2 };

export function getIcarusObligationMaterialityRank(materiality: IcarusObligationMateriality): number {
  return obligationMaterialityRank[materiality];
}

export type IcarusObligationDueState = "Overdue" | "Due" | "Scheduled" | "No date";

// State of an existing Action explicitly linked to an obligation. "None" means no Action is linked.
// Completion of an Action never discharges an obligation; it only reports that remediation work finished.
export type IcarusRemediationState =
  | "None"
  | "In progress"
  | "Blocked"
  | "Overdue"
  | "Completed"
  | "Cancelled"
  | "Missing action";

// Remediation that is absent or not progressing leaves an assurance failure unmitigated.
export function isIcarusRemediationStalled(state: IcarusRemediationState): boolean {
  return state !== "In progress" && state !== "Completed";
}

// ── Escalation ───────────────────────────────────────────────────────────────

export const ICARUS_ESCALATION_LEVELS = ["Assurance failure", "Governance gap", "None"] as const;
export type IcarusEscalationLevel = (typeof ICARUS_ESCALATION_LEVELS)[number];

export function getIcarusEscalationRank(level: IcarusEscalationLevel): number {
  return ICARUS_ESCALATION_LEVELS.indexOf(level);
}

// Compact assurance summary attached to a strategic signal so Command, Founder Focus, correlation and
// history read one interpretation. Optional on signals: absent => pre-assurance behaviour.
export type IcarusSignalAssurance = {
  state: IcarusAssuranceState;
  escalation: IcarusEscalationLevel;
  // Escalating obligation categories (non-hygiene), in obligation-rank order, deduplicated.
  escalationCategories: IcarusObligationCategory[];
  riskOwnerPersonId?: string;
  ownership: IcarusOwnershipState;
  founderOwned: boolean;
  acceptance: "None" | IcarusAcceptanceValidity;
  // True only when every material failure mode is covered by an Active acceptance.
  materialModesAccepted: boolean;
  failedControlIds: string[];
  overdueObligationCount: number;
  obligationCount: number;
  nextObligation?: {
    id: string;
    category: IcarusObligationCategory;
    reason: string;
  };
};

const COMMAND_RANK_FLOOR = 3;
const COMMAND_RANK_CEILING = 7;
const FOCUS_BAND_FLOOR = 3;
const FOCUS_BAND_CEILING = 5;

// An assurance failure raises an Icarus item by one step but never into ranks 1–2 (blocked/overdue execution).
// Governance gaps and accepted exposure never move placement: acceptance cannot silence attention.
export function adjustIcarusCommandRankForAssurance(rank: number, assurance?: IcarusSignalAssurance): number {
  if (!assurance || assurance.escalation !== "Assurance failure") return rank;
  return Math.min(COMMAND_RANK_CEILING, Math.max(COMMAND_RANK_FLOOR, rank - 1));
}

export function adjustIcarusFounderFocusBandForAssurance(band: number, assurance?: IcarusSignalAssurance): number {
  if (!assurance || assurance.escalation !== "Assurance failure") return band;
  return Math.min(FOCUS_BAND_CEILING, Math.max(FOCUS_BAND_FLOOR, band - 1));
}

const commandReasonByCategory: Partial<Record<IcarusObligationCategory, string>> = {
  "failing-control-remediation": "ASSURANCE: FAILING CONTROL UNREMEDIATED",
  "acceptance-expired": "ASSURANCE: ACCEPTANCE EXPIRED",
  "control-test-overdue": "ASSURANCE: CONTROL TEST OVERDUE",
  "no-risk-owner": "GOVERNANCE: NO RISK OWNER",
  "founder-owner-dependency": "GOVERNANCE: FOUNDER-OWNED RISK",
  "acceptance-invalid": "GOVERNANCE: ACCEPTANCE INVALID",
  "control-without-owner": "GOVERNANCE: CONTROL UNOWNED",
  "control-never-tested": "GOVERNANCE: CONTROL NEVER TESTED",
  "control-evidence-insufficient": "GOVERNANCE: CONTROL EVIDENCE INSUFFICIENT",
  "risk-review-due": "GOVERNANCE: RISK REVIEW DUE",
  "single-control-dependency": "GOVERNANCE: SINGLE-CONTROL DEPENDENCY",
};

// At most two assurance reasons so Command items stay readable; the full list stays in Icarus.
export function getIcarusAssuranceCommandReasons(assurance?: IcarusSignalAssurance): string[] {
  if (!assurance) return [];
  const reasons = assurance.escalationCategories
    .map((category) => commandReasonByCategory[category])
    .filter((reason): reason is string => Boolean(reason))
    .slice(0, 2);
  if (assurance.materialModesAccepted && assurance.acceptance === "Active") reasons.push("ACCEPTED EXPOSURE");
  return reasons;
}
