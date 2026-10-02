import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  buildOperatingPosture,
  type OperatingPostureInput,
  type OperatingPostureResult,
} from "./operating-posture";

function input(overrides: Partial<OperatingPostureInput> = {}): OperatingPostureInput {
  return {
    focusCandidates: [],
    authorityItems: [],
    reviewsDue: [],
    unassigned: {
      ownedActions: [], activeProjects: [], pipelineLeads: [], unresolvedProblems: [], carriedCount: 0,
    },
    learningGaps: [],
    decisionsWithoutExecution: [],
    confidenceLimitations: [],
    personAttentionCounts: [],
    health: { delegationQualityLabel: "Strong", selfSufficiencyPct: null, topOwnerShare: null },
    operationalIndependencePct: null,
    delegation: { candidateCount: 0, capacityCount: 0, readinessGapCount: 0 },
    staleRecords: [],
    capitalAttention: [],
    growth: {
      stalledOpportunities: [], stalledLeads: [], stalledQuoteValue: 0, formattedStalledQuoteValue: "", count: 0,
    },
    clusters: [],
    signalled: new Map(),
    ...overrides,
  };
}

function focus(id: string, overrides: Partial<OperatingPostureInput["focusCandidates"][number]> = {}) {
  return { objectType: "Action", id, title: `Work ${id}`, reason: `Reason ${id}`, ...overrides };
}

function attentionInput(count: number): OperatingPostureInput {
  const ids = Array.from({ length: count }, () => ({ id: "duplicate" }));
  return input({
    focusCandidates: ids.map(({ id }) => focus(id)),
    authorityItems: ids.map(({ id }) => ({ objectType: "Action", id })),
    reviewsDue: ids,
    unassigned: { ...input().unassigned, ownedActions: ids, carriedCount: count },
    learningGaps: ids,
    decisionsWithoutExecution: ids,
    confidenceLimitations: ids.map(() => ({ severity: "Material" })),
    capitalAttention: ids.map(() => ({ key: "Finance:buffer" })),
  });
}

describe("Operating Posture classifications and counts", () => {
  it("retains the complete empty consumer contract and exact clear wording", () => {
    expect(buildOperatingPosture(input())).toEqual({
      posture: "Nothing needs founder authority, review, ownership triage, learning capture or cash attention right now.",
      postureIsClear: true,
      steps: [
        { label: "Clear founder focus", count: 0, hint: "Work the ranked top items first." },
        { label: "Fix ownership gaps", count: 0, hint: "Assign a valid active owner to dropped or ghost-owned work." },
        { label: "Complete decision reviews", count: 0, hint: "Record outcomes and ratings so decisions stop drifting." },
        { label: "Restore execution paths", count: 0, hint: "Give each active decision an open linked action." },
        { label: "Close recurring-learning gaps", count: 0, hint: "Turn repeat problems into a lesson, system or SOP." },
        { label: "Clear cash attention", count: 0, hint: "Address cash buffer pressure, overdue commitments and overdue expected income." },
      ],
      ownership: "Every active work item has a valid active owner.",
      ownershipIsClear: true,
      founderDependency: null,
      freshness: "The operating picture looks current — no stale active records detected.",
      freshnessIsClear: true,
      growth: "Growth pipeline is moving — no stalled high-fit opportunities or leads.",
      growthIsClear: true,
      outstandingCount: 0,
      outstandingSituationCount: 0,
      outstandingKeys: [],
      authorityCount: 0,
      reviewDueCount: 0,
      ownershipGapCount: 0,
      learningGapCount: 0,
      executionGapCount: 0,
      staleCount: 0,
      financeCount: 0,
      growthStallCount: 0,
    });
  });

  it.each([
    [1, [
      "1 needs your authority", "1 decision review overdue", "1 ownership gap",
      "1 recurring problem not yet captured as learning", "1 decision without an execution path",
      "1 strategic data confidence issue needs attention", "1 capital attention item needs founder review",
    ]],
    [2, [
      "2 need your authority", "2 decision reviews overdue", "2 ownership gaps",
      "2 recurring problems not yet captured as learning", "2 decisions without an execution path",
      "2 strategic data confidence issues need attention", "2 capital attention items need founder review",
    ]],
  ] as const)("retains exact posture order and grammar for %i records", (count, parts) => {
    const result = buildOperatingPosture(attentionInput(count));
    expect(result.posture).toBe(parts.join(" • "));
    expect(result.postureIsClear).toBe(false);
    expect(result.steps.map(({ count: value }) => value)).toEqual(Array(6).fill(count));
    expect([
      result.authorityCount, result.reviewDueCount, result.ownershipGapCount,
      result.learningGapCount, result.executionGapCount, result.financeCount,
    ]).toEqual(Array(6).fill(count));
    // Source counts include duplicate records; outstanding identity counts do not.
    expect(result.outstandingCount).toBe(4);
  });

  it.each([
    ["Blocker", false], ["Material", false], ["Warning", true],
    ["blocker", true], [" Material ", true], ["", true],
  ] as const)("classifies confidence severity %s exactly without adding record identities", (severity, clear) => {
    const result = buildOperatingPosture(input({ confidenceLimitations: [{ severity }] }));
    expect(result.postureIsClear).toBe(clear);
    expect(result.outstandingKeys).toEqual([]);
    expect(result.outstandingSituationCount).toBe(0);
    expect(result.steps.every(({ count }) => count === 0)).toBe(true);
  });

  it("counts Blocker and Material together, without deduplicating limitations", () => {
    const result = buildOperatingPosture(input({
      confidenceLimitations: [
        { severity: "Blocker" }, { severity: "Warning" },
        { severity: "Material" }, { severity: "Blocker" },
      ],
    }));
    expect(result.posture).toBe("3 strategic data confidence issues need attention");
  });

  const isolatedPostureCases: {
    label: string;
    facts: Partial<OperatingPostureInput>;
    text: string;
  }[] = [
    {
      label: "authority",
      facts: { authorityItems: [{ objectType: "Opportunity", id: "a" }] },
      text: "1 needs your authority",
    },
    {
      label: "reviews",
      facts: { reviewsDue: [{ id: "r" }] },
      text: "1 decision review overdue",
    },
    {
      label: "ownership",
      facts: { unassigned: { ...input().unassigned, unresolvedProblems: [{ id: "p" }] } },
      text: "1 ownership gap",
    },
    {
      label: "learning",
      facts: { learningGaps: [{ id: "p" }] },
      text: "1 recurring problem not yet captured as learning",
    },
    {
      label: "execution",
      facts: { decisionsWithoutExecution: [{ id: "d" }] },
      text: "1 decision without an execution path",
    },
    {
      label: "finance",
      facts: { capitalAttention: [{ key: "Finance:buffer" }] },
      text: "1 capital attention item needs founder review",
    },
  ];
  it.each(isolatedPostureCases)("classifies $label independently of other posture categories", ({ facts, text }) => {
    const result = buildOperatingPosture(input(facts));
    expect(result.posture).toBe(text);
    expect(result.postureIsClear).toBe(false);
    expect(result.outstandingCount).toBe(1);
  });

  it("keeps focus, stale and growth attention independent of postureIsClear", () => {
    const result = buildOperatingPosture(input({
      focusCandidates: [focus("focus")],
      staleRecords: [{ objectType: "Project", id: "stale" }],
      growth: { ...input().growth, stalledLeads: [{ id: "lead" }], count: 1 },
    }));
    expect(result.postureIsClear).toBe(true);
    expect(result.outstandingCount).toBe(3);
    expect(result.steps[0].count).toBe(1);
    expect(result.freshnessIsClear).toBe(false);
    expect(result.growthIsClear).toBe(false);
  });

  it("keeps work ownership gaps distinct from carriedCount, which can include decisions", () => {
    const result = buildOperatingPosture(input({
      unassigned: {
        ownedActions: [{ id: "a" }, { id: "a" }], activeProjects: [{ id: "p" }],
        pipelineLeads: [{ id: "l" }], unresolvedProblems: [{ id: "q" }], carriedCount: 7,
      },
      personAttentionCounts: [0, -1, 2, 5, Number.NaN],
    }));
    expect(result.ownershipGapCount).toBe(5);
    expect(result.steps[1].count).toBe(7);
    expect(result.ownership).toBe("7 active items lack a valid active owner. 2 people are carrying attention items.");
    expect(result.outstandingCount).toBe(4);
  });

  it.each([
    [[], "0 people are"], [[1], "1 person is"], [[1, 1], "2 people are"],
  ] as const)("preserves owner-triage wording for attention counts %j", (counts, peopleText) => {
    const result = buildOperatingPosture(input({
      unassigned: { ...input().unassigned, carriedCount: 1 },
      personAttentionCounts: counts,
    }));
    expect(result.ownership).toBe(`1 active item lacks a valid active owner. ${peopleText} carrying attention items.`);
    expect(result.ownershipIsClear).toBe(false);
    expect(result.ownershipGapCount).toBe(0);
    expect(result.outstandingCount).toBe(0);
    expect(result.postureIsClear).toBe(true);
  });

  it("does not infer ownership hygiene from work arrays or person attention", () => {
    const result = buildOperatingPosture(input({
      unassigned: { ...input().unassigned, ownedActions: [{ id: "a" }] },
      personAttentionCounts: [9],
    }));
    expect(result.ownershipIsClear).toBe(true);
    expect(result.ownershipGapCount).toBe(1);
    expect(result.steps[1].count).toBe(0);
  });

  it.each([
    [1, "1 active record may be stale — the operating picture needs review."],
    [2, "2 active records may be stale — the operating picture needs review."],
  ] as const)("preserves stale record counts before deduplication (%i)", (count, text) => {
    const result = buildOperatingPosture(input({
      staleRecords: Array.from({ length: count }, () => ({ objectType: "Action", id: "a" })),
    }));
    expect(result.freshness).toBe(text);
    expect(result.freshnessIsClear).toBe(false);
    expect(result.staleCount).toBe(count);
    expect(result.outstandingCount).toBe(1);
  });
});

describe("Operating Posture founder dependency and delegation facts", () => {
  const prefix = "40% of validly owned active work is owned outside the primary Founder; 25% can run without routine Founder intervention; the top owner carries 60%";

  function dependency(
    delegation: OperatingPostureInput["delegation"],
    overrides: Partial<OperatingPostureInput> = {},
  ) {
    return buildOperatingPosture(input({
      health: { delegationQualityLabel: "Needs attention", selfSufficiencyPct: 40, topOwnerShare: 60 },
      operationalIndependencePct: 25,
      delegation,
      ...overrides,
    })).founderDependency;
  }

  it.each([
    ["Strong", 40], ["Needs Attention", 40], ["Needs attention ", 40], ["Needs attention", null],
  ] as const)("requires the exact quality label and non-null ownership share (%s, %s)", (label, pct) => {
    expect(dependency(input().delegation, {
      health: { delegationQualityLabel: label, selfSufficiencyPct: pct, topOwnerShare: 60 },
    })).toBeNull();
  });

  it("treats zero ownership as a real value and null independence/top-owner facts as zero", () => {
    expect(dependency(input().delegation, {
      health: { delegationQualityLabel: "Needs attention", selfSufficiencyPct: 0, topOwnerShare: null },
      operationalIndependencePct: null,
    })).toBe("0% of validly owned active work is owned outside the primary Founder; 0% can run without routine Founder intervention; the top owner carries 0%.");
  });

  it("preserves explicit zero independence and top-owner facts", () => {
    expect(dependency(input().delegation, {
      health: { delegationQualityLabel: "Needs attention", selfSufficiencyPct: 40, topOwnerShare: 0 },
      operationalIndependencePct: 0,
    })).toBe("40% of validly owned active work is owned outside the primary Founder; 0% can run without routine Founder intervention; the top owner carries 0%.");
  });

  it("omits capacity/readiness commentary when there are no delegation candidates", () => {
    expect(dependency({ candidateCount: 0, capacityCount: 0, readinessGapCount: 5 })).toBe(`${prefix}.`);
  });

  it.each([
    [1, "1 founder-owned item is"], [2, "2 founder-owned items are"],
  ] as const)("uses supplied capacity to suppress readiness commentary for %i candidates", (count, text) => {
    expect(dependency({ candidateCount: count, capacityCount: 1, readinessGapCount: 9 }))
      .toBe(`${prefix}, and ${text} suitable for delegation.`);
  });

  it("reports absence of active operational delegation people when both supplied counts are zero", () => {
    expect(dependency({ candidateCount: 1, capacityCount: 0, readinessGapCount: 0 }))
      .toBe(`${prefix}, and 1 founder-owned item is suitable for delegation, but no active operational delegation person is available.`);
  });

  it.each([
    [1, "1 active operational delegation person is"],
    [2, "2 active operational delegation persons are"],
  ] as const)("reports supplied readiness gaps with exact legacy grammar (%i)", (count, text) => {
    expect(dependency({ candidateCount: 2, capacityCount: 0, readinessGapCount: count }))
      .toBe(`${prefix}, and 2 founder-owned items are suitable for delegation, but ${text} not yet delegation-ready.`);
  });
});

describe("Operating Posture growth facts", () => {
  it("includes an opportunity-only stall without requiring leads or quoted value", () => {
    const result = buildOperatingPosture(input({
      growth: { ...input().growth, stalledOpportunities: [{ id: "o" }] },
    }));
    expect(result.growth).toBe("1 high-fit opportunity idle");
    expect(result.growthIsClear).toBe(false);
    expect(result.growthStallCount).toBe(0);
  });

  it.each([
    [1, "1 high-fit opportunity idle • 1 lead stalled"],
    [2, "2 high-fit opportunities idle • 2 leads stalled"],
  ] as const)("preserves growth part order, singular/plural and independent aggregate count (%i)", (count, text) => {
    const records = Array.from({ length: count }, () => ({ id: "duplicate" }));
    const result = buildOperatingPosture(input({
      growth: {
        stalledOpportunities: records, stalledLeads: records,
        stalledQuoteValue: 1234.5, formattedStalledQuoteValue: "EXACT currency text", count: 91,
      },
    }));
    expect(result.growth).toBe(`${text} • EXACT currency text in quotes awaiting movement`);
    expect(result.growthStallCount).toBe(91);
    expect(result.outstandingCount).toBe(2);
    expect(result.growthIsClear).toBe(false);
  });

  it.each([0, -1, Number.NaN])("does not include non-positive quote value %s", (value) => {
    const result = buildOperatingPosture(input({
      growth: { ...input().growth, stalledQuoteValue: value, formattedStalledQuoteValue: "Must not appear", count: 4 },
    }));
    expect(result.growthIsClear).toBe(true);
    expect(result.growthStallCount).toBe(4);
    expect(result.growth).toBe("Growth pipeline is moving — no stalled high-fit opportunities or leads.");
  });

  it("accepts any strictly positive quote value and keeps currency formatting upstream", () => {
    const result = buildOperatingPosture(input({
      growth: { ...input().growth, stalledQuoteValue: 0.001, formattedStalledQuoteValue: "rounded zero" },
    }));
    expect(result.growth).toBe("rounded zero in quotes awaiting movement");
    expect(result.growthIsClear).toBe(false);
    expect(result.outstandingCount).toBe(0);
  });
});

describe("Operating Posture outstanding identities and metadata", () => {
  it("preserves all thirteen source families in insertion order without sorting", () => {
    const result = buildOperatingPosture(input({
      focusCandidates: [focus("z")],
      authorityItems: [{ objectType: "Opportunity", id: "authority" }],
      reviewsDue: [{ id: "review" }],
      unassigned: {
        ownedActions: [{ id: "a" }], activeProjects: [{ id: "p" }],
        pipelineLeads: [{ id: "l" }], unresolvedProblems: [{ id: "q" }], carriedCount: 4,
      },
      decisionsWithoutExecution: [{ id: "execution" }],
      learningGaps: [{ id: "learning" }],
      staleRecords: [{ objectType: "Action", id: "stale" }],
      capitalAttention: [{ key: "Finance:income:with:colons" }],
      growth: {
        ...input().growth, stalledOpportunities: [{ id: "growth" }], stalledLeads: [{ id: "commercial" }],
      },
    }));
    expect(result.outstandingKeys.map(({ key }) => key)).toEqual([
      "Action:z", "Opportunity:authority", "Decision:review", "Action:a", "Project:p",
      "Lead:l", "Problem:q", "Decision:execution", "Problem:learning", "Action:stale",
      "Finance:income:with:colons", "Opportunity:growth", "Lead:commercial",
    ]);
    expect(result.outstandingCount).toBe(13);
    expect(result.outstandingSituationCount).toBe(13);
    expect(result.outstandingKeys[10]).toEqual({
      key: "Finance:income:with:colons", title: "Finance:income:with:colons", objectType: "Finance", category: "attention",
    });
  });

  it("deduplicates across source families but preserves same IDs across different exact object types", () => {
    const result = buildOperatingPosture(input({
      focusCandidates: [focus("same")],
      authorityItems: [{ objectType: "Action", id: "same" }, { objectType: "action", id: "same" }],
      reviewsDue: [{ id: "same" }],
      unassigned: { ...input().unassigned, ownedActions: [{ id: "same" }], pipelineLeads: [{ id: "same" }] },
      decisionsWithoutExecution: [{ id: "same" }],
      staleRecords: [{ objectType: "Action", id: "same" }],
      capitalAttention: [{ key: "Action:same" }, { key: "Finance:buffer" }, { key: "Finance:buffer" }],
      growth: { ...input().growth, stalledLeads: [{ id: "same" }] },
    }));
    expect(result.outstandingKeys.map(({ key }) => key)).toEqual([
      "Action:same", "action:same", "Decision:same", "Lead:same", "Finance:buffer",
    ]);
    expect(result.financeCount).toBe(3);
    expect(result.reviewDueCount).toBe(1);
    expect(result.executionGapCount).toBe(1);
  });

  it("keeps first insertion order while duplicate focus metadata uses the last matching record", () => {
    const result = buildOperatingPosture(input({
      focusCandidates: [
        focus("a", { title: "First", reason: "First reason" }),
        focus("b"),
        focus("a", { title: "Last", reason: "Last reason" }),
      ],
    }));
    expect(result.outstandingKeys).toEqual([
      { key: "Action:a", title: "Last", objectType: "Action", category: "Last reason" },
      { key: "Action:b", title: "Work b", objectType: "Action", category: "Reason b" },
    ]);
    expect(result.steps[0].count).toBe(3);
  });

  it("prefers signalled metadata and preserves signal iteration order, not alphabetical order", () => {
    const result = buildOperatingPosture(input({
      focusCandidates: [focus("a")],
      signalled: new Map([["Action:a", {
        title: "Signal title", objectType: "Signal type", signals: ["stale", "founder authority", "blocked"],
      }]]),
    }));
    expect(result.outstandingKeys).toEqual([{
      key: "Action:a", title: "Signal title", objectType: "Signal type", category: "stale, founder authority, blocked",
    }]);
  });

  it("falls back independently for empty signalled title/type but not for empty signal collections", () => {
    const result = buildOperatingPosture(input({
      focusCandidates: [focus("a")],
      signalled: new Map([["Action:a", { title: "", objectType: "", signals: [] }]]),
    }));
    expect(result.outstandingKeys).toEqual([{
      key: "Action:a", title: "Work a", objectType: "Action", category: "",
    }]);
  });

  it("preserves truthy whitespace and raw keys, including missing/leading/multiple separators", () => {
    const result = buildOperatingPosture(input({
      focusCandidates: [focus("a", { title: "", reason: "" }), focus("b", { title: " ", reason: " " })],
      capitalAttention: [{ key: "opaque" }, { key: ":leading" }, { key: "" }, { key: "Finance:a:b" }],
      signalled: new Map([["Action:b", { title: " ", objectType: " ", signals: [" ", ""] }]]),
    }));
    expect(result.outstandingKeys).toEqual([
      { key: "Action:a", title: "Action:a", objectType: "Action", category: "attention" },
      { key: "Action:b", title: " ", objectType: " ", category: " , " },
      { key: "opaque", title: "opaque", objectType: "opaque", category: "attention" },
      { key: ":leading", title: ":leading", objectType: "", category: "attention" },
      { key: "", title: "", objectType: "", category: "attention" },
      { key: "Finance:a:b", title: "Finance:a:b", objectType: "Finance", category: "attention" },
    ]);
  });

  it("ignores signalled-only records and has no result-length cap", () => {
    const records = Array.from({ length: 30 }, (_, index) => focus(String(index)));
    const result = buildOperatingPosture(input({
      focusCandidates: records,
      signalled: new Map([["Action:unselected", { title: "Not selected", objectType: "Action", signals: ["blocked"] }]]),
    }));
    expect(result.outstandingKeys).toHaveLength(30);
    expect(result.outstandingCount).toBe(30);
    expect(result.outstandingSituationCount).toBe(30);
    expect(result.outstandingKeys.map(({ key }) => key)).toEqual(records.map(({ id }) => `Action:${id}`));
  });
});

describe("Operating Posture situation accounting", () => {
  it("counts one situation per matching cluster plus each unclustered outstanding record", () => {
    const result = buildOperatingPosture(input({
      focusCandidates: ["a", "b", "c", "d", "e"].map((id) => focus(id)),
      clusters: [
        { recordKeys: [] },
        { recordKeys: ["Action:not-outstanding"] },
        { recordKeys: ["Action:a", "Action:b", "Action:non-attention", "Action:a"] },
        { recordKeys: ["Action:c"] },
      ],
    }));
    expect(result.outstandingCount).toBe(5);
    expect(result.outstandingSituationCount).toBe(4);
    expect(result.outstandingKeys).toHaveLength(5);
  });

  it("preserves independent counting of overlapping and duplicate clusters", () => {
    const result = buildOperatingPosture(input({
      focusCandidates: [focus("a"), focus("b")],
      clusters: [
        { recordKeys: ["Action:a", "Action:b"] },
        { recordKeys: ["Action:a"] },
        { recordKeys: ["Action:a"] },
      ],
    }));
    expect(result.outstandingCount).toBe(2);
    expect(result.outstandingSituationCount).toBe(3);
  });

  it("does not manufacture outstanding attention from clusters alone", () => {
    const result = buildOperatingPosture(input({
      clusters: [{ recordKeys: ["Action:a", "Project:p"] }],
    }));
    expect(result.outstandingCount).toBe(0);
    expect(result.outstandingSituationCount).toBe(0);
    expect(result.outstandingKeys).toEqual([]);
  });

  it("matches exact raw record keys, not root IDs, key prefixes or normalized forms", () => {
    const result = buildOperatingPosture(input({
      focusCandidates: [focus("a")],
      capitalAttention: [{ key: "Finance:income:a" }],
      clusters: [
        { recordKeys: ["a", "action:a", " Action:a", "Finance:income"] },
        { recordKeys: ["Finance:income:a"] },
      ],
    }));
    expect(result.outstandingSituationCount).toBe(2);
  });
});

function pageContext() {
  return {
    founderFocusCandidates: [
      { ...focus("a", { title: "First" }), key: "cluster:first", area: "Operations", score: 900 },
      { ...focus("a", { title: "Last", reason: "Last reason" }), key: "cluster:second", area: "Operations", score: 500 },
    ],
    empireDecisionQueue: {
      founderAuthorityItems: [{ objectType: "Action", id: "a", title: "Authority", onOpen: vi.fn() }],
      delegateItems: [{ id: "delegate" }],
      delegationCapacityNames: [],
      delegationReadinessGapNames: ["Not ready"],
    },
    decisionTrackRecord: { reviewsDue: [{ id: "review", title: "Review" }] },
    unassignedAccountability: {
      ownedActions: [{ id: "a", owner: "Ghost" }],
      activeProjects: [{ id: "p", projectName: "Project" }],
      pipelineLeads: [{ id: "l", leadName: "Lead" }],
      unresolvedProblems: [{ id: "q", problemStatement: "Problem" }],
      carriedCount: 6,
    },
    recurringProblemLearning: { gaps: [{ id: "q", title: "Gap" }] },
    decisionsWithoutExecution: [{ id: "execution", title: "Execution" }],
    strategicDataConfidence: { limitations: [{ severity: "Blocker", key: "cash" }, { severity: "Warning", key: "other" }] },
    personAccountabilitySummaries: [{ attentionCount: 3, person: { id: "person" } }, { attentionCount: 0 }],
    organisationalHealth: {
      delegationQuality: { label: "Needs attention" }, selfSufficiencyPct: 40, topOwnerShare: 60,
    },
    operationalIndependence: { operationalIndependencePct: 25 },
    staleRecords: [{ objectType: "Action", id: "a", title: "Stale" }],
    founderCapitalAttention: [{ key: "Finance:income:a", title: "Income", onOpen: vi.fn() }],
    growthAttention: {
      stalledOpportunities: [{ id: "o", title: "Opportunity" }],
      stalledLeads: [{ id: "l", title: "Lead" }],
      stalledQuoteValue: 12.5,
      count: 8,
    },
    correlationLayer: {
      clusters: [
        { clusterKey: "not-convergent", records: [{ recordKey: "Action:a" }, { recordKey: "Project:p" }] },
        { clusterKey: "non-attention", records: [{ recordKey: "Action:other" }] },
      ],
      convergentRisks: [],
      signalled: new Map([
        ["Action:a", { title: "Signal title", objectType: "Action", signals: new Set(["stale", "authority"]), baseScore: 999 }],
        ["Project:p", { title: "Project title", objectType: "Project", signals: new Set<string>(), baseScore: 1 }],
      ]),
    },
    formatFinanceAmount: vi.fn((value: number) => `Formatted(${value})`),
  };
}

function evaluateAdapter(context: ReturnType<typeof pageContext>) {
  const source = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
  const start = source.indexOf("  const todayBrief = buildOperatingPosture({");
  const end = source.indexOf("  const deskIsClear =", start);
  if (start < 0 || end < 0) throw new Error("Operating Posture adapter boundary not found");
  const code = transpileModule(`${source.slice(start, end)}\ntodayBrief;`, {
    compilerOptions: { target: ScriptTarget.ES2017, module: ModuleKind.None },
  }).outputText;
  let projected: OperatingPostureInput | undefined;
  let result: OperatingPostureResult | undefined;
  runInNewContext(code, {
    ...context,
    Map,
    buildOperatingPosture: (value: OperatingPostureInput) => {
      projected = value;
      result = buildOperatingPosture(value);
      return result;
    },
  });
  if (!projected || !result) throw new Error("Operating Posture adapter did not call the builder");
  return { projected, result };
}

describe("Operating Posture actual page adapter", () => {
  it("projects narrow helper-owned facts without recomputing ownership/delegation or leaking callbacks", () => {
    const context = pageContext();
    const { projected, result } = evaluateAdapter(context);
    expect(projected.signalled.constructor).toBe(Map);
    expect(projected).toEqual(input({
      focusCandidates: [
        focus("a", { title: "First" }), focus("a", { title: "Last", reason: "Last reason" }),
      ],
      authorityItems: [{ objectType: "Action", id: "a" }],
      reviewsDue: [{ id: "review" }],
      unassigned: {
        ownedActions: [{ id: "a" }], activeProjects: [{ id: "p" }],
        pipelineLeads: [{ id: "l" }], unresolvedProblems: [{ id: "q" }], carriedCount: 6,
      },
      learningGaps: [{ id: "q" }],
      decisionsWithoutExecution: [{ id: "execution" }],
      confidenceLimitations: [{ severity: "Blocker" }, { severity: "Warning" }],
      personAttentionCounts: [3, 0],
      health: { delegationQualityLabel: "Needs attention", selfSufficiencyPct: 40, topOwnerShare: 60 },
      operationalIndependencePct: 25,
      delegation: { candidateCount: 1, capacityCount: 0, readinessGapCount: 1 },
      staleRecords: [{ objectType: "Action", id: "a" }],
      capitalAttention: [{ key: "Finance:income:a" }],
      growth: {
        stalledOpportunities: [{ id: "o" }], stalledLeads: [{ id: "l" }],
        stalledQuoteValue: 12.5, formattedStalledQuoteValue: "Formatted(12.5)", count: 8,
      },
      clusters: [{ recordKeys: ["Action:a", "Project:p"] }, { recordKeys: ["Action:other"] }],
      signalled: new Map([
        ["Action:a", { title: "Signal title", objectType: "Action", signals: ["stale", "authority"] }],
        ["Project:p", { title: "Project title", objectType: "Project", signals: [] }],
      ]),
    }));
    expect(result.outstandingKeys.map(({ key }) => key)).toEqual([
      "Action:a", "Decision:review", "Project:p", "Lead:l", "Problem:q",
      "Decision:execution", "Finance:income:a", "Opportunity:o",
    ]);
    expect(result.outstandingCount).toBe(8);
    expect(result.outstandingSituationCount).toBe(7);
    expect(result.ownershipGapCount).toBe(4);
    expect(result.steps[1].count).toBe(6);
    expect(result.growthStallCount).toBe(8);
    expect(result.outstandingKeys[0].category).toBe("stale, authority");
    expect(result.outstandingKeys[2].category).toBe("");
    expect(context.formatFinanceAmount).toHaveBeenCalledExactlyOnceWith(12.5);
    expect(context.empireDecisionQueue.founderAuthorityItems[0].onOpen).not.toHaveBeenCalled();
    expect(context.founderCapitalAttention[0].onOpen).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN])("does not call the page currency helper for quote value %s", (value) => {
    const context = pageContext();
    context.growthAttention.stalledQuoteValue = value;
    const { projected, result } = evaluateAdapter(context);
    expect(context.formatFinanceAmount).not.toHaveBeenCalled();
    expect(projected.growth.formattedStalledQuoteValue).toBe("");
    expect(result.growth).not.toContain("quotes awaiting movement");
  });

  it("preserves duplicate focus last-match metadata and root identities rather than cluster identities", () => {
    const context = pageContext();
    context.correlationLayer.signalled.clear();
    const { result } = evaluateAdapter(context);
    expect(result.outstandingKeys[0]).toEqual({
      key: "Action:a", title: "Last", objectType: "Action", category: "Last reason",
    });
    expect(result.outstandingKeys.some(({ key }) => key.startsWith("cluster:"))).toBe(false);
    expect(result.steps[0].count).toBe(2);
  });

  it("leaves page collections, ordered signals, clusters, and callbacks unmodified", () => {
    const context = pageContext();
    const before = JSON.stringify(context, (_, value) => {
      if (value instanceof Map) return [...value];
      if (value instanceof Set) return [...value];
      return value;
    });
    const focusReference = context.founderFocusCandidates[0];
    const signalReference = context.correlationLayer.signalled.get("Action:a");
    const { projected } = evaluateAdapter(context);
    const after = JSON.stringify(context, (_, value) => {
      if (value instanceof Map) return [...value];
      if (value instanceof Set) return [...value];
      return value;
    });
    expect(after).toBe(before);
    expect(context.founderFocusCandidates[0]).toBe(focusReference);
    expect(context.correlationLayer.signalled.get("Action:a")).toBe(signalReference);
    expect(projected.focusCandidates[0]).not.toBe(focusReference);
    expect(projected.signalled.get("Action:a")).not.toBe(signalReference);
  });
});

function freezeDeep(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (value instanceof Map) {
    value.forEach((entry) => freezeDeep(entry));
  } else {
    Object.values(value).forEach(freezeDeep);
  }
  Object.freeze(value);
}

describe("Operating Posture determinism and non-mutation", () => {
  it("is repeatable without consulting the clock and does not mutate frozen DTOs or Map entries", () => {
    const facts = input({
      ...attentionInput(2),
      focusCandidates: [focus("a"), focus("a", { title: "Last" }), focus("b")],
      clusters: [{ recordKeys: ["Action:a", "Action:b"] }],
      signalled: new Map([["Action:a", { title: "Signal", objectType: "Action", signals: ["blocked", "stale"] }]]),
    });
    const before = JSON.stringify(facts, (_, value) => value instanceof Map ? [...value] : value);
    freezeDeep(facts);
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Operating Posture must not read the clock");
    });
    try {
      const first = buildOperatingPosture(facts);
      const second = buildOperatingPosture(facts);
      expect(second).toEqual(first);
      expect(second).not.toBe(first);
      expect(JSON.stringify(facts, (_, value) => value instanceof Map ? [...value] : value)).toBe(before);
      expect(clock).not.toHaveBeenCalled();
      first.outstandingKeys[0].title = "Changed output";
      first.steps[0].count = 999;
      expect(buildOperatingPosture(facts)).toEqual(second);
    } finally {
      clock.mockRestore();
    }
  });
});
