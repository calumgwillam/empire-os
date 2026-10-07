import { describe, expect, it } from "vitest";
import {
  buildFounderOperatingReview,
  type FounderOperatingReviewInput,
  type FounderOperatingReviewSnapshot,
} from "./founder-operating-review";

const today = "2026-10-02";

function snapshot(
  date: string,
  overrides: Partial<FounderOperatingReviewSnapshot> = {},
): FounderOperatingReviewSnapshot {
  return {
    date,
    ownershipGapCount: 0,
    decisionReviewsDue: 0,
    executionGapCount: 0,
    learningGapCount: 0,
    staleRecordCount: 0,
    financeAttentionCount: 0,
    growthStallCount: 0,
    availableOperatingCash: null,
    ...overrides,
  };
}

function input(overrides: Partial<FounderOperatingReviewInput> = {}): FounderOperatingReviewInput {
  return {
    todaySnapshotDate: today,
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

describe("Founder Operating Review policy", () => {
  const lowerMetrics = [
    ["ownershipGapCount", "ownershipGapCount", "Ownership gaps"],
    ["reviewDueCount", "decisionReviewsDue", "Decision reviews due"],
    ["executionGapCount", "executionGapCount", "Execution gaps"],
    ["learningGapCount", "learningGapCount", "Learning gaps"],
    ["staleCount", "staleRecordCount", "Stale records"],
    ["financeCount", "financeAttentionCount", "Finance attention"],
    ["growthStallCount", "growthStallCount", "Growth stalls"],
  ] as const;

  it.each(lowerMetrics)("characterizes both directions and equality for %s", (currentKey, baselineKey, metric) => {
    for (const current of [1, 2, 3]) {
      const result = buildFounderOperatingReview(input({
        snapshots: [snapshot("2026-10-01", { [baselineKey]: 2 })],
        todayBrief: { ...input().todayBrief, [currentKey]: current },
      }));
      expect(result.improved.map((item) => item.metric)).toEqual(current < 2 ? [metric] : []);
      expect(result.deteriorated.map((item) => item.metric)).toEqual(current > 2 ? [metric] : []);
      if (current !== 2) {
        const change = current < 2 ? result.improved[0] : result.deteriorated[0];
        expect(change.changeText).toBe(`2 → ${current} (${current < 2 ? "-" : "+"}1)`);
      }
    }
  });

  it.each([-3, -2, 0, 2, 3])("preserves the strict two-point dependency threshold at %i", (difference) => {
    const result = buildFounderOperatingReview(input({
      snapshots: [snapshot("2026-10-01", { selfSufficiencyPct: 50 })],
      selfSufficiencyPct: 50 + difference,
      delegateItemCount: 1,
    }));
    expect(result.founderDependency.status).toBe(
      difference > 2 ? "Improving" : difference < -2 ? "Worsening" : "Flat",
    );
    expect(result.founderDependency.detail).toBe(
      "Top owner carries 0% of active work. 1 founder-owned item is ready for delegation.",
    );
  });

  it("uses stable source order for same-date history and treats zero as a real comparison value", () => {
    const result = buildFounderOperatingReview(input({
      snapshots: [
        snapshot("2026-10-01", { ownershipGapCount: 1, selfSufficiencyPct: 0 }),
        snapshot("2026-10-01", { ownershipGapCount: 9, selfSufficiencyPct: 99 }),
      ],
      selfSufficiencyPct: 0,
    }));
    expect(result.improved[0].changeText).toBe("1 → 0 (-1)");
    expect(result.founderDependency.status).toBe("Flat");
  });

  it("is deterministic and leaves frozen source collections and returned input facts independent", () => {
    const facts = input({
      snapshots: [snapshot("2026-10-01", { outstandingKeys: [{ key: "Action:a", title: "A", objectType: "Action", category: "blocked" }] })],
      focusCandidates: [{ key: "Action:a", objectType: "Action", id: "a", title: "A", area: "Ops", reason: "Execute" }],
      todayBrief: {
        ...input().todayBrief,
        outstandingKeys: [{ key: "Action:a", title: "A", objectType: "Action", category: "blocked" }],
      },
    });
    const before = structuredClone(facts);
    const freeze = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    };
    freeze(facts);
    const first = buildFounderOperatingReview(facts);
    const second = buildFounderOperatingReview(facts);
    expect(first).toEqual(second);
    expect(facts).toEqual(before);
    first.next7Days[0].title = "Output only";
    first.recurring[0].title = "Output only";
    expect(buildFounderOperatingReview(facts)).toEqual(second);
    expect(facts).toEqual(before);
  });

  it("returns the baseline contract without history and counts all snapshots, including today and future dates", () => {
    const result = buildFounderOperatingReview(input({
      snapshots: [snapshot(today), snapshot("2026-10-03")],
      selfSufficiencyPct: null,
    }));

    expect(result).toEqual({
      headline: "7-Day Operating Trajectory: Baseline established for today — gathering 7-day posture history",
      hasSufficientHistory: false,
      snapshotCount: 2,
      baselineDateLabel: today,
      improved: [],
      deteriorated: [],
      noLongerPresent: [],
      recurring: [],
      founderDependency: {
        status: "Baseline established",
        summary: "Current founder dependency baseline established.",
        detail: "At least 2 daily posture snapshots are required to establish a historical 7-day trend.",
      },
      next7Days: [],
      strategicRiskTrajectory: null,
    });
  });

  it("selects the earliest snapshot among the latest seven eligible dates without mutating inputs", () => {
    const snapshots = [
      snapshot("2026-09-01", { ownershipGapCount: 99 }),
      snapshot("2026-09-09", { ownershipGapCount: 20 }),
      ...Array.from({ length: 7 }, (_, index) =>
        snapshot(`2026-09-${String(index + 10).padStart(2, "0")}`, { ownershipGapCount: index + 1 })).reverse(),
      snapshot(today, { ownershipGapCount: 100 }),
      snapshot("2026-10-03", { ownershipGapCount: 200 }),
    ];
    const original = structuredClone(snapshots);
    const result = buildFounderOperatingReview(input({
      snapshots,
      todayBrief: { ...input().todayBrief, ownershipGapCount: 0 },
    }));

    expect(result.baselineDateLabel).toBe("2026-09-10");
    expect(result.snapshotCount).toBe(11);
    expect(result.improved[0]).toEqual({
      metric: "Ownership gaps",
      changeText: "1 → 0 (-1)",
      explanation: "Fewer unassigned or ghost-owned active work items require founder triage.",
    });
    expect(snapshots).toEqual(original);
  });

  it("compares all metrics in stable order, omits null comparisons, and preserves explanations and units", () => {
    const baseline = snapshot("2026-10-01", {
      ownershipGapCount: 2,
      decisionReviewsDue: 2,
      executionGapCount: 2,
      learningGapCount: 2,
      staleRecordCount: 2,
      financeAttentionCount: 2,
      growthStallCount: 2,
      selfSufficiencyPct: 10,
      delegationQualityPct: 10,
      availableOperatingCash: 10,
    });
    const result = buildFounderOperatingReview(input({
      snapshots: [baseline],
      todayBrief: {
        ...input().todayBrief,
        ownershipGapCount: 1,
        reviewDueCount: 3,
        executionGapCount: 1,
        learningGapCount: 3,
        staleCount: 1,
        financeCount: 3,
        growthStallCount: 1,
      },
      selfSufficiencyPct: 11,
      delegationQualityPct: 9,
      cashIsConfigured: true,
      availableOperatingCash: 9,
    }));

    expect(result.improved.map(({ metric }) => metric)).toEqual([
      "Ownership gaps", "Execution gaps", "Stale records", "Growth stalls",
      "Ownership outside primary Founder",
    ]);
    expect(result.deteriorated.map(({ metric }) => metric)).toEqual([
      "Decision reviews due", "Learning gaps", "Finance attention", "Delegation quality", "Operating cash",
    ]);
    expect(result.improved[result.improved.length - 1]).toEqual({
      metric: "Ownership outside primary Founder",
      changeText: "10% → 11% (+1%)",
      explanation: "Non-founder owners are carrying a larger share of active operational work.",
    });
    expect(result.headline).toBe("7-Day Operating Trajectory: Mixed trajectory — 5 improved, 5 deteriorated");

    const nullResult = buildFounderOperatingReview(input({
      snapshots: [snapshot("2026-10-01")],
      cashIsConfigured: false,
      selfSufficiencyPct: null,
      delegationQualityPct: null,
    }));
    expect(nullResult.improved).toEqual([]);
    expect(nullResult.deteriorated).toEqual([]);
    expect(nullResult.headline).toBe("7-Day Operating Trajectory: Stable posture across recent posture snapshots");

    const positiveResult = buildFounderOperatingReview(input({
      snapshots: [snapshot("2026-10-01", { ownershipGapCount: 1 })],
      todayBrief: { ...input().todayBrief, ownershipGapCount: 0 },
    }));
    expect(positiveResult.headline).toBe("7-Day Operating Trajectory: Positive momentum — 1 area improved");

    const deterioratedResult = buildFounderOperatingReview(input({
      snapshots: [snapshot("2026-10-01")],
      todayBrief: { ...input().todayBrief, ownershipGapCount: 1 },
    }));
    expect(deterioratedResult.headline).toBe("7-Day Operating Trajectory: Operating load increased — 1 area deteriorated");
  });

  it("keeps unresolved recurring problems unbounded, deduplicates source keys, and caps later sources at three", () => {
    const result = buildFounderOperatingReview(input({
      unresolvedRecurring: [
        { id: "p:1", problemStatement: "Named", title: "Fallback", area: "", frequency: "Persistent", severity: "HIGH" },
        { id: "p:1", problemStatement: "Duplicate", title: "Duplicate", area: "X", frequency: "Recurring", severity: "Low" },
        ...["p2", "p3", "p4"].map((id) => ({
          id, problemStatement: "", title: `Title ${id}`, area: "Ops",
          frequency: "Recurring", severity: "Medium",
        })),
      ],
      convergentRisks: [{
        clusterKey: "shared-cluster",
        title: "Cluster title",
        categoryCount: 3,
        recordCount: 5,
        root: { id: "root-first", objectType: "Problem", area: "First root area" },
      }],
    }));

    expect(result.recurring).toHaveLength(4);
    expect(result.recurring.map(({ id }) => id)).toEqual(["p:1", "p2", "p3", "p4"]);
    expect(result.recurring[0]).toMatchObject({
      title: "Named",
      why: "Persistent problem (high severity) — needs captured learning or SOP",
      navigation: { type: "record", objectType: "Problem", id: "p:1" },
    });

    const capped = buildFounderOperatingReview(input({
      convergentRisks: [
        {
          clusterKey: "cluster-one", title: "Risk one", categoryCount: 2, recordCount: 2,
          root: { id: "first", objectType: "Action", area: "North" },
        },
        {
          clusterKey: "cluster-one", title: "Duplicate cluster", categoryCount: 4, recordCount: 9,
          root: { id: "later", objectType: "Action", area: "South" },
        },
        {
          clusterKey: "cluster-two", title: "Risk two", categoryCount: 1, recordCount: 3,
          root: { id: "second", objectType: "Problem", area: "West" },
        },
        {
          clusterKey: "cluster-three", title: "Risk three", categoryCount: 5, recordCount: 6,
          root: { id: "third", objectType: "Lead", area: "East" },
        },
      ],
    }));
    expect(capped.recurring.map(({ id, title }) => [id, title])).toEqual([
      ["first", "Risk one"], ["second", "Risk two"], ["third", "Risk three"],
    ]);
  });

  it("parses persistent keys, deduplicates, and retains colon-containing record IDs", () => {
    const outstanding = [
      { key: "Action:alpha:beta", title: "Persistent", objectType: "", category: "Execution" },
      { key: "Decision:d1", title: "Repeated", objectType: "Decision", category: "Review" },
      { key: "Decision:d1", title: "Duplicate", objectType: "Decision", category: "Review" },
      { key: ":id", title: "Fallback", objectType: "", category: "Other" },
    ];
    const result = buildFounderOperatingReview(input({
      snapshots: [snapshot("2026-10-01", { outstandingKeys: outstanding })],
      todayBrief: { ...input().todayBrief, outstandingKeys: outstanding },
    }));
    expect(result.recurring.map(({ id, objectType, title, navigation }) => ({
      id, objectType, title, navigation,
    }))).toEqual([
      { id: "alpha:beta", objectType: "Action", title: "Persistent", navigation: { type: "record", objectType: "Action", id: "alpha:beta" } },
      { id: "d1", objectType: "Decision", title: "Repeated", navigation: { type: "record", objectType: "Decision", id: "d1" } },
      { id: "id", objectType: "Record", title: "Fallback", navigation: { type: "record", objectType: "Record", id: "id" } },
    ]);
  });

  it("preserves next-seven ordering, claims, unassigned routing, watch source index, and three-item cap", () => {
    const result = buildFounderOperatingReview(input({
      focusCandidates: [
        { key: "alias-for-one", objectType: "Action", id: "one", title: "One", area: "Ops", reason: "urgent" },
        { key: "Action:three", objectType: "Action", id: "three", title: "Three", area: "Ops", reason: "fill" },
      ],
      unassignedCarriedCount: 2,
      founderReviewQueue: [
        { kind: "Action", id: "one", title: "Claimed", pillar: "Ops", reasonCategory: "Review", whyItMatters: "Claimed" },
        { kind: "Decision", id: "decision", title: "Decision", pillar: "Ops", reasonCategory: "Review", whyItMatters: "Important" },
      ],
      watch: [
        { id: "one", objectType: "Action", title: "Duplicate watch", area: "Ops", why: "duplicate", sourceIndex: 4 },
        { id: "watched", objectType: "Project", title: "Watch", area: "Field", why: "soon", sourceIndex: 8 },
      ],
    }));

    expect(result.next7Days.map(({ id, title, why, navigation }) => ({ id, title, why, navigation }))).toEqual([
      {
        id: "one",
        title: "One",
        why: "Top immediate execution priority: urgent",
        navigation: { type: "record", objectType: "Action", id: "one" },
      },
      {
        id: "unassigned",
        title: "2 unassigned active items requiring owner triage",
        why: "Assigning clear active owners prevents dropped execution and founder bottlenecking.",
        navigation: { type: "unassigned" },
      },
      {
        id: "watched",
        title: "Watch",
        why: "Near-term focus: soon",
        navigation: { type: "watch", index: 8 },
      },
    ]);
  });

  it("uses the review queue when unassigned work is already claimed and applies strict dependency thresholds", () => {
    const baseInput = input({
      snapshots: [snapshot("2026-10-01", { selfSufficiencyPct: 50 })],
      selfSufficiencyPct: 52,
      focusCandidates: [
        { key: "People:unassigned", objectType: "People", id: "unassigned", title: "Already handled", area: "People", reason: "first" },
      ],
      unassignedCarriedCount: 2,
      founderReviewQueue: [
        { kind: "Decision", id: "d", title: "Queue", pillar: "Ops", reasonCategory: "Due", whyItMatters: "Review" },
      ],
      topOwnerShare: null,
      delegateItemCount: 2,
    });
    const result = buildFounderOperatingReview(baseInput);
    expect(result.founderDependency).toEqual({
      status: "Flat",
      summary: "Ownership outside the primary Founder remains stable at 52% (baseline: 50%).",
      detail: "Top owner carries 0% of active work. 2 founder-owned items are ready for delegation.",
    });
    expect(result.next7Days[1]).toMatchObject({
      id: "d",
      navigation: { type: "record", objectType: "Decision", id: "d" },
    });

    expect(buildFounderOperatingReview(input({
      snapshots: [snapshot("2026-10-01", { selfSufficiencyPct: 50 })],
      selfSufficiencyPct: 53,
    })).founderDependency.status).toBe("Improving");
    expect(buildFounderOperatingReview(input({
      snapshots: [snapshot("2026-10-01", { selfSufficiencyPct: 50 })],
      selfSufficiencyPct: 47,
    })).founderDependency.status).toBe("Worsening");
    expect(buildFounderOperatingReview(input({
      snapshots: [snapshot("2026-10-01", { selfSufficiencyPct: 50 })],
      selfSufficiencyPct: null,
    })).founderDependency).toEqual({
      status: "Stable",
      summary: "Current non-founder ownership baseline tracked.",
      detail: "Ownership metrics are derived from active Actions, Projects, Leads and Problems.",
    });
    expect(buildFounderOperatingReview(input({
      selfSufficiencyPct: 75,
    })).founderDependency.summary).toBe("75% of active work is non-founder owned.");
    expect(buildFounderOperatingReview(input({
      snapshots: [snapshot("2026-10-01", { selfSufficiencyPct: 50 })],
      selfSufficiencyPct: 50,
    })).founderDependency.detail).toBe(
      "Top owner carries 0% of active work. No routine founder-owned items currently flagged for delegation.",
    );
  });

  it("fills remaining priorities with unique focus candidates up to three", () => {
    const result = buildFounderOperatingReview(input({
      focusCandidates: [
        { key: "Action:a", objectType: "Action", id: "a", title: "A", area: "Ops", reason: "first" },
        { key: "Action:b", objectType: "Action", id: "b", title: "B", area: "Ops", reason: "second" },
        { key: "Action:c", objectType: "Action", id: "c", title: "C", area: "Ops", reason: "third" },
        { key: "Action:d", objectType: "Action", id: "d", title: "D", area: "Ops", reason: "fourth" },
      ],
      founderReviewQueue: [
        { kind: "Decision", id: "decision", title: "Decision", pillar: "Ops", reasonCategory: "Due", whyItMatters: "Review" },
      ],
    }));

    expect(result.next7Days.map(({ id, why }) => [id, why])).toEqual([
      ["a", "Top immediate execution priority: first"],
      ["decision", "Due: Review"],
      ["b", "second"],
    ]);
  });
});
