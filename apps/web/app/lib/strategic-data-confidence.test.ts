import { describe, expect, it } from "vitest";
import { buildStrategicDataConfidence, type StrategicDataConfidenceInput } from "./strategic-data-confidence";

function input(overrides: Partial<StrategicDataConfidenceInput> = {}): StrategicDataConfidenceInput {
  return {
    cashConfigured: true,
    cashSnapshotFreshnessLabel: "Current",
    commitmentsNeedingAttention: [],
    highFitMissingCapitalCount: 0,
    highFitQualitativeCapitalCount: 0,
    liveOpportunities: [],
    totalWork: 0,
    validOwned: 0,
    closedButUnrated: [],
    totalWonLeads: 0,
    totalMissingFinalValues: 0,
    wonLeads: [],
    ...overrides,
  };
}

describe("buildStrategicDataConfidence", () => {
  it("returns the existing Strong shape when no limitations apply", () => {
    expect(buildStrategicDataConfidence(input())).toEqual({
      state: "Strong",
      limitations: [],
      blockerCount: 0,
      materialCount: 0,
      warningCount: 0,
    });
  });

  it("marks unconfigured or invalid-dated cash as a blocker and stale cash as material", () => {
    expect(buildStrategicDataConfidence(input({ cashConfigured: false })).limitations[0]).toEqual({
      key: "cash-position",
      label: "Cash position incomplete",
      severity: "Blocker",
      action: { label: "Update cash snapshot", objectType: "Finance", id: "cash-buffer" },
    });
    expect(buildStrategicDataConfidence(input({ cashSnapshotFreshnessLabel: "Missing / invalid date" })).limitations[0].severity).toBe("Blocker");
    expect(buildStrategicDataConfidence(input({ cashSnapshotFreshnessLabel: "Stale" })).limitations[0]).toMatchObject({
      key: "cash-position",
      label: "Cash snapshot is stale",
      severity: "Material",
    });
    expect(buildStrategicDataConfidence(input({ cashSnapshotFreshnessLabel: "Aging" })).limitations).toEqual([]);
  });

  it("uses the first commitment and preserves singular/plural wording", () => {
    const single = buildStrategicDataConfidence(input({ commitmentsNeedingAttention: [{ id: "first" }] }));
    expect(single.limitations[0]).toMatchObject({
      key: "commitments",
      label: "1 commitment record need attention",
      action: { label: "Review commitments", objectType: "Finance", id: "commitment:first" },
    });

    const multiple = buildStrategicDataConfidence(input({ commitmentsNeedingAttention: [{ id: "first" }, { id: "second" }] }));
    expect(multiple.limitations[0].label).toBe("2 commitment records need attention");
    expect(multiple.limitations[0].action?.id).toBe("commitment:first");
  });

  it("selects the first high-fit missing-capital opportunity and allows no action when none matches", () => {
    const result = buildStrategicDataConfidence(input({
      highFitMissingCapitalCount: 2,
      liveOpportunities: [
        { id: "low-fit", fitRank: 2, capitalState: "missing" },
        { id: "qualitative", fitRank: 3, capitalState: "qualitative" },
        { id: "first-match", fitRank: 3, capitalState: "missing" },
        { id: "second-match", fitRank: 4, capitalState: "missing" },
      ],
    }));
    expect(result.limitations[0]).toEqual({
      key: "opportunity-capital",
      label: "2 high-fit opportunities are missing a capital requirement",
      severity: "Material",
      action: { label: "Add capital requirement", objectType: "Opportunity", id: "first-match" },
    });

    const withoutMatch = buildStrategicDataConfidence(input({ highFitMissingCapitalCount: 1 }));
    expect(withoutMatch.limitations[0]).toEqual({
      key: "opportunity-capital",
      label: "1 high-fit opportunity is missing a capital requirement",
      severity: "Material",
      action: undefined,
    });
  });

  it("selects the first high-fit qualitative opportunity and preserves warning wording", () => {
    const result = buildStrategicDataConfidence(input({
      highFitQualitativeCapitalCount: 2,
      liveOpportunities: [
        { id: "low-fit", fitRank: 2, capitalState: "qualitative" },
        { id: "first-match", fitRank: 3, capitalState: "qualitative" },
        { id: "second-match", fitRank: 4, capitalState: "qualitative" },
      ],
    }));
    expect(result.limitations[0]).toEqual({
      key: "opportunity-capital-qualitative",
      label: "2 high-fit opportunities have a qualitative rather than numeric capital requirement",
      severity: "Warning",
      action: { label: "Quantify capital requirement", objectType: "Opportunity", id: "first-match" },
    });
  });

  it("reports ownership gaps only when total work exceeds validly owned work", () => {
    expect(buildStrategicDataConfidence(input({ totalWork: 3, validOwned: 1 })).limitations[0]).toEqual({
      key: "ownership",
      label: "2 active operational records have invalid or missing ownership",
      severity: "Material",
    });
    expect(buildStrategicDataConfidence(input({ totalWork: 1, validOwned: 1 })).limitations).toEqual([]);
  });

  it("uses the first closed-unrated decision and exact singular/plural labels", () => {
    const single = buildStrategicDataConfidence(input({ closedButUnrated: [{ id: "first" }] }));
    expect(single.limitations[0]).toEqual({
      key: "decision-outcomes",
      label: "1 closed Decision is still unrated",
      severity: "Warning",
      action: { label: "Rate Decision", objectType: "Decision", id: "first" },
    });
    expect(buildStrategicDataConfidence(input({ closedButUnrated: [{ id: "first" }, { id: "second" }] })).limitations[0].label)
      .toBe("2 closed Decisions are still unrated");
  });

  it("selects the first source-ordered nonpositive final-value Won lead", () => {
    const result = buildStrategicDataConfidence(input({
      totalWonLeads: 4,
      totalMissingFinalValues: 2,
      wonLeads: [
        { id: "known", parsedFinalValue: 250 },
        { id: "missing", parsedFinalValue: null },
        { id: "zero", parsedFinalValue: 0 },
      ],
    }));
    expect(result.limitations[0]).toEqual({
      key: "commercial-evidence",
      label: "2 Won Leads are missing a valid final job value",
      severity: "Warning",
      action: { label: "Add final job value", objectType: "Lead", id: "missing" },
    });
  });

  it("emits commercial evidence without an action when no lead matches the aggregate fact", () => {
    const result = buildStrategicDataConfidence(input({
      totalWonLeads: 1,
      totalMissingFinalValues: 1,
      wonLeads: [{ id: "known", parsedFinalValue: 200 }],
    }));
    expect(result.limitations[0].action).toBeUndefined();
  });

  it("sorts by severity while retaining insertion order for equal severities", () => {
    const result = buildStrategicDataConfidence(input({
      cashConfigured: false,
      commitmentsNeedingAttention: [{ id: "c" }],
      highFitMissingCapitalCount: 1,
      highFitQualitativeCapitalCount: 1,
      liveOpportunities: [
        { id: "missing", fitRank: 3, capitalState: "missing" },
        { id: "qualitative", fitRank: 3, capitalState: "qualitative" },
      ],
      totalWork: 1,
      validOwned: 0,
      closedButUnrated: [{ id: "d" }],
    }));
    expect(result.limitations.map(({ key }) => key)).toEqual([
      "cash-position",
      "commitments",
      "opportunity-capital",
      "ownership",
      "opportunity-capital-qualitative",
      "decision-outcomes",
    ]);
    expect(result).toMatchObject({ state: "Limited", blockerCount: 1, materialCount: 3, warningCount: 2 });
  });

  it("applies the existing state thresholds", () => {
    expect(buildStrategicDataConfidence(input({ totalWork: 1, validOwned: 0 })).state).toBe("Usable");
    expect(buildStrategicDataConfidence(input({ highFitQualitativeCapitalCount: 1 })).state).toBe("Usable");
    expect(buildStrategicDataConfidence(input({ totalWork: 2, validOwned: 0, commitmentsNeedingAttention: [{ id: "c" }] })).state).toBe("Limited");
    expect(buildStrategicDataConfidence(input({ cashConfigured: false })).state).toBe("Limited");
  });

  it("does not mutate supplied arrays or entries", () => {
    const facts = input({
      commitmentsNeedingAttention: [{ id: "second" }, { id: "first" }],
      liveOpportunities: [{ id: "opportunity", fitRank: 3, capitalState: "missing" }],
      closedButUnrated: [{ id: "decision" }],
      wonLeads: [{ id: "lead", parsedFinalValue: null }],
      totalWork: 2,
      validOwned: 0,
      highFitMissingCapitalCount: 1,
      totalWonLeads: 1,
      totalMissingFinalValues: 1,
    });
    const before = structuredClone(facts);

    buildStrategicDataConfidence(facts);

    expect(facts).toEqual(before);
  });
});