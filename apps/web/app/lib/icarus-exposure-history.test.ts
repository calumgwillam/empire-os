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
    expect(compareIcarusExposure({ previous: undefined, current: [entry("a")] })).toEqual({
      hasBaseline: false,
      changes: [],
      counts: { New: 0, Worsened: 0, Persistent: 0, Improved: 0, Resolved: 0 },
    });
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
