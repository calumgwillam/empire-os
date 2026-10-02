export type StrategicDataConfidenceSeverity = "Blocker" | "Material" | "Warning";
export type StrategicDataConfidenceState = "Strong" | "Usable" | "Limited";

export type StrategicDataConfidenceLimitation = {
  key:
    | "cash-position"
    | "commitments"
    | "opportunity-capital"
    | "opportunity-capital-qualitative"
    | "ownership"
    | "decision-outcomes"
    | "commercial-evidence";
  label: string;
  severity: StrategicDataConfidenceSeverity;
  action?: { label: string; objectType: string; id: string };
};

export type StrategicDataConfidenceInput = {
  cashConfigured: boolean;
  cashSnapshotFreshnessLabel: "Missing / invalid date" | "Current" | "Aging" | "Stale";
  commitmentsNeedingAttention: readonly { id: string }[];
  highFitMissingCapitalCount: number;
  highFitQualitativeCapitalCount: number;
  liveOpportunities: readonly { id: string; fitRank: number; capitalState: "missing" | "qualitative" | "zero" | "stated" }[];
  totalWork: number;
  validOwned: number;
  closedButUnrated: readonly { id: string }[];
  totalWonLeads: number;
  totalMissingFinalValues: number;
  wonLeads: readonly { id: string; parsedFinalValue: number | null }[];
};

export type StrategicDataConfidenceResult = {
  state: StrategicDataConfidenceState;
  limitations: StrategicDataConfidenceLimitation[];
  blockerCount: number;
  materialCount: number;
  warningCount: number;
};

export function buildStrategicDataConfidence(
  input: StrategicDataConfidenceInput,
): StrategicDataConfidenceResult {
  const limitations: StrategicDataConfidenceLimitation[] = [];
  const cashPositionBlocksAllocation = !input.cashConfigured;

  if (
    cashPositionBlocksAllocation ||
    input.cashSnapshotFreshnessLabel === "Missing / invalid date"
  ) {
    limitations.push({
      key: "cash-position",
      label: "Cash position incomplete",
      severity: "Blocker",
      action: { label: "Update cash snapshot", objectType: "Finance", id: "cash-buffer" },
    });
  } else if (input.cashSnapshotFreshnessLabel === "Stale") {
    limitations.push({
      key: "cash-position",
      label: "Cash snapshot is stale",
      severity: "Material",
      action: { label: "Update cash snapshot", objectType: "Finance", id: "cash-buffer" },
    });
  }

  if (input.commitmentsNeedingAttention.length > 0) {
    const firstCommitment = input.commitmentsNeedingAttention[0];

    limitations.push({
      key: "commitments",
      label: `${input.commitmentsNeedingAttention.length} commitment record${input.commitmentsNeedingAttention.length === 1 ? "" : "s"} need attention`,
      severity: "Material",
      action: {
        label: "Review commitments",
        objectType: "Finance",
        id: `commitment:${firstCommitment.id}`,
      },
    });
  }

  if (input.highFitMissingCapitalCount > 0) {
    const firstOpportunity = input.liveOpportunities.find(
      (opportunity) => opportunity.fitRank >= 3 && opportunity.capitalState === "missing",
    );

    limitations.push({
      key: "opportunity-capital",
      label: `${input.highFitMissingCapitalCount} high-fit opportunit${input.highFitMissingCapitalCount === 1 ? "y is" : "ies are"} missing a capital requirement`,
      severity: "Material",
      action: firstOpportunity
        ? {
            label: "Add capital requirement",
            objectType: "Opportunity",
            id: firstOpportunity.id,
          }
        : undefined,
    });
  }

  if (input.highFitQualitativeCapitalCount > 0) {
    const firstOpportunity = input.liveOpportunities.find(
      (opportunity) => opportunity.fitRank >= 3 && opportunity.capitalState === "qualitative",
    );

    limitations.push({
      key: "opportunity-capital-qualitative",
      label: `${input.highFitQualitativeCapitalCount} high-fit opportunit${input.highFitQualitativeCapitalCount === 1 ? "y has" : "ies have"} a qualitative rather than numeric capital requirement`,
      severity: "Warning",
      action: firstOpportunity
        ? {
            label: "Quantify capital requirement",
            objectType: "Opportunity",
            id: firstOpportunity.id,
          }
        : undefined,
    });
  }

  const ownershipGapCount = input.totalWork - input.validOwned;

  if (ownershipGapCount > 0) {
    limitations.push({
      key: "ownership",
      label: `${ownershipGapCount} active operational record${ownershipGapCount === 1 ? " has" : "s have"} invalid or missing ownership`,
      severity: "Material",
    });
  }

  if (input.closedButUnrated.length > 0) {
    const firstDecision = input.closedButUnrated[0];

    limitations.push({
      key: "decision-outcomes",
      label: `${input.closedButUnrated.length} closed Decision${input.closedButUnrated.length === 1 ? " is" : "s are"} still unrated`,
      severity: "Warning",
      action: {
        label: "Rate Decision",
        objectType: "Decision",
        id: firstDecision.id,
      },
    });
  }

  if (input.totalWonLeads > 0 && input.totalMissingFinalValues > 0) {
    const firstLead = input.wonLeads.find(
      (lead) => (lead.parsedFinalValue ?? 0) <= 0,
    );

    limitations.push({
      key: "commercial-evidence",
      label: `${input.totalMissingFinalValues} Won Lead${input.totalMissingFinalValues === 1 ? " is" : "s are"} missing a valid final job value`,
      severity: "Warning",
      action: firstLead
        ? {
            label: "Add final job value",
            objectType: "Lead",
            id: firstLead.id,
          }
        : undefined,
    });
  }

  const severityRank: Record<StrategicDataConfidenceSeverity, number> = {
    Blocker: 3,
    Material: 2,
    Warning: 1,
  };

  limitations.sort(
    (left, right) => severityRank[right.severity] - severityRank[left.severity],
  );

  const blockerCount = limitations.filter(
    (limitation) => limitation.severity === "Blocker",
  ).length;
  const materialCount = limitations.filter(
    (limitation) => limitation.severity === "Material",
  ).length;
  const warningCount = limitations.filter(
    (limitation) => limitation.severity === "Warning",
  ).length;

  const state =
    blockerCount > 0 || materialCount >= 2
      ? "Limited"
      : limitations.length > 0
        ? "Usable"
        : "Strong";

  return { state, limitations, blockerCount, materialCount, warningCount };
}