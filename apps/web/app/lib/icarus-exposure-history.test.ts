import { describe, expect, it } from "vitest";
import { buildFounderOperatingReview, type FounderOperatingReviewInput } from "./founder-operating-review";
import type { IcarusAssessmentStatus } from "./icarus";
import {
  buildIcarusExposureSnapshot,
  compareIcarusExposure,
  normaliseIcarusExposureSnapshot,
  type IcarusExposureSnapshotEntry,
} from "./icarus-exposure-history";
import type { IcarusExposure, IcarusStrategicSignal } from "./icarus-strategic-attention";

function entry(id: string, overrides: Partial<IcarusExposureSnapshotEntry> = {}): IcarusExposureSnapshotEntry {
  return {
    key: `Icarus:${id}`,
    assessmentId: id,
    outcome: `Outcome ${id}`,
    exposure: "Exposed",
    failureModeIds: ["mode-1"],
    riskScore: 500,
    ...overrides,
  };
}

function signal(id: string, exposure: IcarusExposure, modeIds: string[], riskScore: number): IcarusStrategicSignal {
  return {
    key: `Icarus:${id}`,
    assessmentId: id,
    outcome: `Outcome ${id}`,
    exposure,
    materialFailureModes: modeIds.map((failureModeId) => ({ failureModeId })),
    riskScore,
  } as unknown as IcarusStrategicSignal;
}

describe("Icarus exposure snapshot", () => {
  it("captures a compact, sorted representation of material exposure", () => {
    expect(buildIcarusExposureSnapshot([
      signal("b", "Unverified control", ["m2", "m1"], 300),
      signal("a", "Exposed", ["m1"], 700),
    ])).toEqual([
      entry("a", { failureModeIds: ["m1"], riskScore: 700 }),
      entry("b", { exposure: "Unverified control", failureModeIds: ["m1", "m2"], riskScore: 300 }),
    ]);
  });

  it("treats legacy or malformed history as no baseline and repairs partial entries", () => {
    expect(normaliseIcarusExposureSnapshot(undefined)).toBeUndefined();
    expect(normaliseIcarusExposureSnapshot("bad")).toBeUndefined();
    expect(normaliseIcarusExposureSnapshot([])).toEqual([]);
    expect(normaliseIcarusExposureSnapshot([
      null,
      { key: "Icarus:x", assessmentId: "x", exposure: "Unknown tier" },
      { key: "Icarus:b", assessmentId: "b", exposure: "Exposed", failureModeIds: ["m2", 4, "m1", "m1"], riskScore: "high" },
      { key: "Icarus:a", assessmentId: "a", outcome: "A", exposure: "Failing control", failureModeIds: [], riskScore: 10 },
      { key: "Icarus:a", assessmentId: "a", outcome: "Duplicate", exposure: "Exposed", riskScore: 999 },
    ])).toEqual([
      { key: "Icarus:a", assessmentId: "a", outcome: "A", exposure: "Failing control", failureModeIds: [], riskScore: 10 },
      { key: "Icarus:b", assessmentId: "b", outcome: "b", exposure: "Exposed", failureModeIds: ["m1", "m2"], riskScore: 0 },
    ]);
  });
});

describe("Icarus exposure comparison", () => {
  it("reports no baseline when no earlier Icarus snapshot exists", () => {
    const result = compareIcarusExposure({ previous: undefined, current: [entry("a")] });
    expect(result).toMatchObject({
      hasBaseline: false,
      changes: [],
      counts: { New: 0, Worsened: 0, Persistent: 0, Improved: 0, Resolved: 0 },
      hasAssuranceBaseline: false,
      assuranceChanges: [],
    });
    expect(Object.values(result.assuranceCounts).every((count) => count === 0)).toBe(true);
  });

  it("distinguishes new, persistent, worsened, improved and resolved exposure", () => {
    const statuses = new Map<string, IcarusAssessmentStatus>([["closed", "Closed"], ["still-open", "Open"]]);
    const result = compareIcarusExposure({
      previous: [
        entry("same"),
        entry("tier-worse", { exposure: "Unverified control" }),
        entry("new-mode"),
        entry("score-up", { riskScore: 400 }),
        entry("tier-better"),
        entry("closed"),
        entry("still-open"),
        entry("deleted"),
      ],
      current: [
        entry("same"),
        entry("tier-worse", { exposure: "Exposed" }),
        entry("new-mode", { failureModeIds: ["mode-1", "mode-2"] }),
        entry("score-up", { riskScore: 450 }),
        entry("tier-better", { exposure: "Unverified control" }),
        entry("fresh"),
      ],
      assessmentStatuses: statuses,
    });
    expect(result.hasBaseline).toBe(true);
    expect(result.changes.map((change) => [change.assessmentId, change.change, change.resolution])).toEqual([
      ["new-mode", "Worsened", undefined],
      ["score-up", "Worsened", undefined],
      ["tier-worse", "Worsened", undefined],
      ["fresh", "New", undefined],
      ["same", "Persistent", undefined],
      ["tier-better", "Improved", undefined],
      ["closed", "Resolved", "Closed"],
      ["deleted", "Resolved", "Removed"],
      ["still-open", "Resolved", "No longer material"],
    ]);
    expect(result.counts).toEqual({ New: 1, Worsened: 3, Persistent: 1, Improved: 1, Resolved: 3 });
    expect(result.changes[0].addedFailureModeIds).toEqual(["mode-2"]);
    expect(result.changes.find((change) => change.assessmentId === "tier-worse")).toMatchObject({
      previousExposure: "Unverified control",
      exposure: "Exposed",
    });
  });

  it("treats losing a failure mode at the same tier as improvement and a new mode as worsening even if another closed", () => {
    const result = compareIcarusExposure({
      previous: [entry("lost", { failureModeIds: ["m1", "m2"] }), entry("swapped", { failureModeIds: ["m1"] })],
      current: [entry("lost", { failureModeIds: ["m1"] }), entry("swapped", { failureModeIds: ["m2"] })],
    });
    expect(result.changes.map((change) => [change.assessmentId, change.change])).toEqual([
      ["swapped", "Worsened"],
      ["lost", "Improved"],
    ]);
    expect(result.changes[1].removedFailureModeIds).toEqual(["m2"]);
  });
});

function reviewInput(overrides: Partial<FounderOperatingReviewInput> = {}): FounderOperatingReviewInput {
  return {
    todaySnapshotDate: "2026-10-08",
    snapshots: [],
    todayBrief: {
      ownershipGapCount: 0,
      reviewDueCount: 0,
      executionGapCount: 0,
      learningGapCount: 0,
      staleCount: 0,
      financeCount: 0,
      growthStallCount: 0,
      outstandingKeys: [],
    },
    selfSufficiencyPct: null,
    delegationQualityPct: null,
    cashIsConfigured: false,
    availableOperatingCash: null,
    topOwnerShare: null,
    delegateItemCount: 0,
    unresolvedRecurring: [],
    convergentRisks: [],
    focusCandidates: [],
    unassignedCarriedCount: 0,
    founderReviewQueue: [],
    watch: [],
    ...overrides,
  };
}

const baseSnapshot = {
  ownershipGapCount: 0,
  decisionReviewsDue: 0,
  executionGapCount: 0,
  learningGapCount: 0,
  staleRecordCount: 0,
  financeAttentionCount: 0,
  growthStallCount: 0,
  availableOperatingCash: null,
};

describe("Founder Operating Review strategic-risk trajectory", () => {
  it("is absent when Icarus input is not supplied, preserving existing behaviour", () => {
    const result = buildFounderOperatingReview(reviewInput({
      snapshots: [{ date: "2026-10-01", ...baseSnapshot, icarusExposure: [entry("a")] }],
    }));
    expect(result.strategicRiskTrajectory).toBeNull();
    expect(result.improved).toEqual([]);
    expect(result.deteriorated).toEqual([]);
  });

  it("does not fabricate change against a legacy baseline without Icarus history", () => {
    const result = buildFounderOperatingReview(reviewInput({
      snapshots: [{ date: "2026-10-01", ...baseSnapshot }],
      icarusExposure: { current: [entry("a")], assessmentStatuses: new Map() },
    }));
    expect(result.strategicRiskTrajectory?.hasBaseline).toBe(false);
    expect(result.deteriorated).toEqual([]);
  });

  it("surfaces new, worsened and resolved strategic exposure against the 7-day baseline without hiding churn", () => {
    const result = buildFounderOperatingReview(reviewInput({
      snapshots: [{
        date: "2026-10-01",
        ...baseSnapshot,
        icarusExposure: [entry("closed"), entry("worse", { exposure: "Unverified control" })],
      }],
      icarusExposure: {
        current: [entry("fresh"), entry("worse")],
        assessmentStatuses: new Map<string, IcarusAssessmentStatus>([["closed", "Closed"]]),
      },
    }));
    expect(result.strategicRiskTrajectory?.counts).toEqual({ New: 1, Worsened: 1, Persistent: 0, Improved: 0, Resolved: 1 });
    expect(result.deteriorated.map((item) => [item.metric, item.changeText])).toEqual([
      ["New strategic risks", "+1 material Icarus exposure"],
      ["Strategic risk severity", "1 worsened"],
    ]);
    expect(result.deteriorated[0].explanation).toContain("Outcome fresh");
    expect(result.improved.map((item) => [item.metric, item.changeText])).toEqual([
      ["Resolved strategic risks", "-1 material Icarus exposure"],
    ]);
    expect(result.headline).toContain("Mixed trajectory");
  });

  it("names the Icarus contribution in the convergent recurring item", () => {
    const result = buildFounderOperatingReview(reviewInput({
      convergentRisks: [{
        clusterKey: "cluster:Action:a",
        title: "Blocked action",
        categoryCount: 3,
        recordCount: 3,
        root: { id: "a", objectType: "Action", area: "Excavation" },
        strategicRisks: [{ assessmentId: "x", outcome: "Margin holds", exposure: "Exposed" }],
      }],
    }));
    const item = result.recurring.find((entry) => entry.title === "Blocked action")!;
    expect(item.why).toBe('Convergent risk generating 3 signal categories across 3 linked records; Icarus: exposed in "Margin holds"');
  });
});

describe("Icarus assurance history", () => {
  const assured = (overrides: Partial<NonNullable<IcarusExposureSnapshotEntry["assurance"]>> = {}) => ({
    state: "Weak" as const, escalation: "None" as const, acceptance: "None" as const, failedControlIds: [], ...overrides,
  });

  describe("Icarus dependency health history", () => {
    const dependency = (
      assessmentId: string,
      health: "Healthy" | "Failed" | "Degraded" | "Unknown",
      resilience: "Adequate" | "Fragile" | "Critical dependency" | "Unknown",
    ) => ({ dependencyKey: `Project:${assessmentId}`, health, resilience });
    const healthyDependency = dependency("a", "Healthy", "Adequate");

    it("persists compact dependency categories and drops malformed optional health state", () => {
      const [stored] = normaliseIcarusExposureSnapshot([
        { ...entry("a"), dependencyHealth: [healthyDependency] },
        { ...entry("b"), dependencyHealth: [{ dependencyKey: "Person:p2", health: "Impossible", resilience: "Unknown" }] },
      ])!;
      expect(stored.dependencyHealth).toEqual([healthyDependency]);
      expect(stored).not.toHaveProperty("failureChain");
      const malformed = normaliseIcarusExposureSnapshot([
        { ...entry("a"), dependencyHealth: [{ dependencyKey: "Project:p1", health: "Impossible", resilience: "Fragile" }] },
      ])!;
      expect(malformed[0]).not.toHaveProperty("dependencyHealth");
    });

    it("compares deterioration, failure, unknown transitions, recovery, and resilience changes", () => {
      const previous = [
        entry("degraded", { dependencyHealth: [dependency("degraded", "Healthy", "Adequate")] }),
        entry("failed", { dependencyHealth: [dependency("failed", "Healthy", "Adequate")] }),
        entry("unknown", { dependencyHealth: [dependency("unknown", "Healthy", "Adequate")] }),
        entry("recovered", { dependencyHealth: [dependency("recovered", "Failed", "Critical dependency")] }),
      ];
      const current = [
        entry("degraded", { dependencyHealth: [dependency("degraded", "Degraded", "Fragile")] }),
        entry("failed", { dependencyHealth: [dependency("failed", "Failed", "Critical dependency")] }),
        entry("unknown", { dependencyHealth: [dependency("unknown", "Unknown", "Unknown")] }),
        entry("recovered", { dependencyHealth: [dependency("recovered", "Healthy", "Adequate")] }),
      ];
      const result = compareIcarusExposure({ previous, current });

      expect(result.hasStructuralBaseline).toBe(true);
      expect(result.structuralChanges.map((change) => [change.change, change.assessmentIds])).toEqual([
        ["Dependency health failed", ["failed"]],
        ["Dependency health degraded", ["degraded"]],
        ["Dependency health became unknown", ["unknown"]],
        ["Resilience deteriorated", ["degraded"]],
        ["Resilience deteriorated", ["failed"]],
        ["Dependency recovered", ["recovered"]],
        ["Resilience improved", ["recovered"]],
      ]);
    });
  });

  it("captures assurance on snapshots only when the signal carries it", () => {
    const withAssurance = {
      ...signal("a", "Exposed", ["m1"], 500),
      assurance: { state: "Weak", escalation: "Assurance failure", riskOwnerPersonId: "p1", acceptance: "None", failedControlIds: ["c2", "c1"] },
    } as unknown as IcarusStrategicSignal;
    const [entryA, entryB] = buildIcarusExposureSnapshot([withAssurance, signal("b", "Exposed", ["m1"], 400)]);
    expect(entryA.assurance).toEqual({ state: "Weak", escalation: "Assurance failure", riskOwnerPersonId: "p1", acceptance: "None", failedControlIds: ["c1", "c2"] });
    expect(entryB).not.toHaveProperty("assurance");
  });

  it("keeps the exposure entry but drops malformed assurance", () => {
    const [kept, repaired] = normaliseIcarusExposureSnapshot([
      { ...entry("a"), assurance: { state: "Superb", escalation: "None" } },
      { ...entry("b"), assurance: { state: "Weak", escalation: "None", riskOwnerPersonId: " ", acceptance: "Maybe", failedControlIds: ["c", 3, "c"] } },
    ])!;
    expect(kept).toEqual(entry("a"));
    expect(repaired.assurance).toEqual({ state: "Weak", escalation: "None", acceptance: "None", failedControlIds: ["c"] });
  });

  it("reports no assurance baseline when earlier snapshots predate assurance", () => {
    const result = compareIcarusExposure({ previous: [entry("a")], current: [entry("a", { assurance: assured() })] });
    expect(result.hasBaseline).toBe(true);
    expect(result.hasAssuranceBaseline).toBe(false);
    expect(result.assuranceChanges).toEqual([]);
  });

  it("detects every assurance change kind in a deterministic order", () => {
    const result = compareIcarusExposure({
      previous: [
        entry("worse", { assurance: assured({ state: "Partially assured", riskOwnerPersonId: "p" }) }),
        entry("better", { assurance: assured({ state: "Weak", failedControlIds: ["c1", "c2"] }) }),
        entry("expired", { assurance: assured({ state: "Accepted exposure", acceptance: "Active", riskOwnerPersonId: "p" }) }),
        entry("accepted", { assurance: assured({ state: "Unassured", riskOwnerPersonId: "p" }) }),
      ],
      current: [
        entry("worse", { assurance: assured({ state: "Weak" }) }),
        entry("better", { assurance: assured({ state: "Partially assured", riskOwnerPersonId: "q", failedControlIds: ["c2"] }) }),
        entry("expired", { assurance: assured({ state: "Weak", acceptance: "Expired", riskOwnerPersonId: "p" }) }),
        entry("accepted", { assurance: assured({ state: "Accepted exposure", acceptance: "Active", riskOwnerPersonId: "p" }) }),
      ],
    });
    expect(result.hasAssuranceBaseline).toBe(true);
    expect(result.assuranceChanges.map((change) => [change.change, change.assessmentId])).toEqual([
      ["Assurance deteriorated", "expired"],
      ["Assurance deteriorated", "worse"],
      ["Acceptance expired", "expired"],
      ["Owner removed", "worse"],
      ["Owner assigned", "better"],
      ["Acceptance created", "accepted"],
      ["Failed control remediated", "better"],
      ["Assurance improved", "accepted"],
      ["Assurance improved", "better"],
    ]);
    expect(result.assuranceChanges.find((change) => change.change === "Failed control remediated")?.controlIds).toEqual(["c1"]);
    expect(result.assuranceCounts["Assurance deteriorated"]).toBe(2);
  });

  it("does not report assurance change for new or resolved exposure", () => {
    const result = compareIcarusExposure({
      previous: [entry("gone", { assurance: assured() })],
      current: [entry("fresh", { assurance: assured({ state: "Assured" }) })],
    });
    expect(result.assuranceChanges).toEqual([]);
  });

  it("feeds assurance changes into the Founder Operating Review separately from exposure change", () => {
    const result = buildFounderOperatingReview(reviewInput({
      snapshots: [{
        date: "2026-10-01",
        ...baseSnapshot,
        icarusExposure: [
          entry("a", { assurance: assured({ state: "Partially assured", riskOwnerPersonId: "p" }) }),
          entry("b", { assurance: assured({ failedControlIds: ["c1"] }) }),
        ],
      }],
      icarusExposure: {
        current: [
          entry("a", { assurance: assured({ state: "Weak" }) }),
          entry("b", { assurance: assured({ riskOwnerPersonId: "p" }) }),
        ],
        assessmentStatuses: new Map(),
      },
    }));
    expect(result.strategicRiskTrajectory?.counts.Persistent).toBe(2);
    expect(result.deteriorated.map((item) => [item.metric, item.changeText])).toEqual([
      ["Strategic risk assurance", "1 weaker"],
      ["Strategic risk ownership", "1 owner removed"],
    ]);
    expect(result.deteriorated[0].explanation).toContain("Outcome a");
    expect(result.improved.map((item) => [item.metric, item.changeText])).toEqual([
      ["Failed controls remediated", "1 remediated"],
      ["Strategic risk ownership", "1 owner assigned"],
    ]);
  });
});
