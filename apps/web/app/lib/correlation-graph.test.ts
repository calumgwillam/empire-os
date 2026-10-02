import { describe, expect, it } from "vitest";
import { buildCorrelationGraph, type CorrelationGraphInput } from "./correlation-graph";

function makeInput(overrides: Partial<CorrelationGraphInput> = {}): CorrelationGraphInput {
  return {
    founderAuthorityItems: [],
    commandAttentionItems: [],
    decisionReviewsDue: [],
    decisionsWithoutExecution: [],
    learningGaps: [],
    staleUnownedWork: [],
    staleRecords: [],
    stalledOpportunities: [],
    stalledLeads: [],
    cashBuffer: null,
    fundingGap: null,
    overdueCommitments: [],
    overdueExpectedIncome: [],
    captures: [],
    problems: [],
    actions: [],
    decisions: [],
    opportunities: [],
    lessons: [],
    systems: [],
    sops: [],
    projects: [],
    leads: [],
    ...overrides,
  };
}

function getSignalled(input: CorrelationGraphInput, key: string) {
  const record = buildCorrelationGraph(input).signalled.get(key);
  if (!record) throw new Error(`Expected signalled record ${key}`);
  return record;
}

describe("correlation graph signals", () => {
  const signalCases: Array<{
    name: string;
    input: Partial<CorrelationGraphInput>;
    key: string;
    signal: string;
    score: number;
  }> = [
    {
      name: "founder authority",
      input: { founderAuthorityItems: [{ objectType: "Action", id: "a", title: "Action", pillar: "Ops" }] },
      key: "Action:a",
      signal: "founder authority",
      score: 400,
    },
    {
      name: "blocked attention",
      input: { commandAttentionItems: [{ objectType: "Action", id: "a", title: "Action", area: "Ops", reasons: ["BLOCKED"], priorityScore: 17 }] },
      key: "Action:a",
      signal: "blocked",
      score: 377,
    },
    {
      name: "overdue attention",
      input: { commandAttentionItems: [{ objectType: "Action", id: "a", title: "Action", area: "Ops", reasons: ["OVERDUE BY 3 DAYS"], priorityScore: 17 }] },
      key: "Action:a",
      signal: "overdue",
      score: 217,
    },
    {
      name: "review due",
      input: { decisionReviewsDue: [{ id: "d", decisionTitle: "Decision", title: "Fallback", relatedPillar: "Ops" }] },
      key: "Decision:d",
      signal: "review due",
      score: 300,
    },
    {
      name: "no execution path",
      input: { decisionsWithoutExecution: [{ id: "d", title: "Decision", area: "Ops" }] },
      key: "Decision:d",
      signal: "no execution path",
      score: 280,
    },
    {
      name: "learning not captured",
      input: { learningGaps: [{ id: "p", title: "Problem", area: "Ops" }] },
      key: "Problem:p",
      signal: "learning not captured",
      score: 240,
    },
    {
      name: "no valid owner",
      input: { staleUnownedWork: [{ key: "Action:a", objectType: "Action", id: "a", title: "Action", area: "Ops", score: 337 }] },
      key: "Action:a",
      signal: "no valid owner",
      score: 337,
    },
    {
      name: "stale record",
      input: { staleRecords: [{ objectType: "Project", id: "p", title: "Project", area: "Ops" }] },
      key: "Project:p",
      signal: "stale record",
      score: 230,
    },
    {
      name: "exceptional opportunity stalled",
      input: { stalledOpportunities: [{ id: "o", title: "Opportunity", area: "Ops", strategicFit: "Exceptional" }] },
      key: "Opportunity:o",
      signal: "opportunity stalled",
      score: 290,
    },
    {
      name: "other opportunity stalled",
      input: { stalledOpportunities: [{ id: "o", title: "Opportunity", area: "Ops", strategicFit: "High" }] },
      key: "Opportunity:o",
      signal: "opportunity stalled",
      score: 250,
    },
    {
      name: "lead quote at threshold",
      input: { stalledLeads: [{ id: "l", title: "Lead", area: "Ops", quoteValue: 1000 }] },
      key: "Lead:l",
      signal: "lead stalled",
      score: 240,
    },
    {
      name: "lead quote below threshold",
      input: { stalledLeads: [{ id: "l", title: "Lead", area: "Ops", quoteValue: 999 }] },
      key: "Lead:l",
      signal: "lead stalled",
      score: 180,
    },
    {
      name: "critical cash buffer",
      input: { cashBuffer: { title: "Cash", severity: "critical" } },
      key: "Finance:cash-buffer",
      signal: "cash buffer pressure",
      score: 380,
    },
    {
      name: "noncritical cash buffer",
      input: { cashBuffer: { title: "Cash", severity: "high" } },
      key: "Finance:cash-buffer",
      signal: "cash buffer pressure",
      score: 300,
    },
    {
      name: "funding gap",
      input: { fundingGap: { title: "Funding gap" } },
      key: "Finance:funding-gap",
      signal: "committed obligations exceed available cash",
      score: 360,
    },
    {
      name: "overdue commitment",
      input: { overdueCommitments: [{ id: "c", title: "Commitment" }] },
      key: "Finance:commitment:c",
      signal: "overdue commitment",
      score: 310,
    },
    {
      name: "overdue expected income",
      input: { overdueExpectedIncome: [{ id: "i", title: "Income" }] },
      key: "Finance:income:i",
      signal: "expected income overdue",
      score: 260,
    },
  ];

  it.each(signalCases)("preserves $name label and score", ({ input, key, signal, score }) => {
    const record = getSignalled(makeInput(input), key);
    expect(record.signals).toEqual(new Set([signal]));
    expect(record.baseScore).toBe(score);
  });

  it("accumulates unique signals in policy insertion order and retains the maximum score", () => {
    const result = buildCorrelationGraph(makeInput({
      founderAuthorityItems: [
        { objectType: "Action", id: "a", title: "First title", pillar: "First area" },
        { objectType: "Action", id: "a", title: "Later title", pillar: "Later area" },
      ],
      commandAttentionItems: [
        { objectType: "Action", id: "a", title: "Attention title", area: "Attention area", reasons: ["BLOCKED", "OVERDUE BY 1 DAY"], priorityScore: 20 },
        { objectType: "Action", id: "a", title: "Duplicate blocked", area: "Other", reasons: ["BLOCKED PROJECT"], priorityScore: 80 },
      ],
    }));
    const record = result.signalled.get("Action:a")!;

    expect([...record.signals]).toEqual(["founder authority", "blocked", "overdue"]);
    expect(record.baseScore).toBe(440);
    expect(record.title).toBe("First title");
    expect(record.area).toBe("First area");
    expect(result.signalled.size).toBe(1);
  });
});

describe("correlation graph identity and relationships", () => {
  type Collection = "captures" | "problems" | "actions" | "decisions" | "opportunities" | "lessons" | "systems" | "sops" | "projects" | "leads";
  type Node = { collection: Collection; objectType: string; id: string; fields?: Record<string, unknown> };
  const relationshipCases: Array<{ name: string; source: Node; target: Node }> = [
    { name: "action to problem", source: { collection: "actions", objectType: "Action", id: "a", fields: { relatedProblem: "p" } }, target: { collection: "problems", objectType: "Problem", id: "p" } },
    { name: "action to decision", source: { collection: "actions", objectType: "Action", id: "a", fields: { relatedDecision: "d" } }, target: { collection: "decisions", objectType: "Decision", id: "d" } },
    { name: "action to opportunity", source: { collection: "actions", objectType: "Action", id: "a", fields: { relatedOpportunity: "o" } }, target: { collection: "opportunities", objectType: "Opportunity", id: "o" } },
    { name: "action to related capture", source: { collection: "actions", objectType: "Action", id: "a", fields: { relatedCapture: "c" } }, target: { collection: "captures", objectType: "Capture", id: "c" } },
    { name: "decision to opportunity", source: { collection: "decisions", objectType: "Decision", id: "d", fields: { relatedOpportunity: "o" } }, target: { collection: "opportunities", objectType: "Opportunity", id: "o" } },
    { name: "decision to capture", source: { collection: "decisions", objectType: "Decision", id: "d", fields: { relatedCapture: "c" } }, target: { collection: "captures", objectType: "Capture", id: "c" } },
    { name: "problem to capture", source: { collection: "problems", objectType: "Problem", id: "p", fields: { relatedCapture: "c" } }, target: { collection: "captures", objectType: "Capture", id: "c" } },
    { name: "opportunity to capture", source: { collection: "opportunities", objectType: "Opportunity", id: "o", fields: { relatedCapture: "c" } }, target: { collection: "captures", objectType: "Capture", id: "c" } },
    { name: "lesson to problem", source: { collection: "lessons", objectType: "Lesson", id: "l", fields: { relatedProblem: "p" } }, target: { collection: "problems", objectType: "Problem", id: "p" } },
    { name: "lesson to decision", source: { collection: "lessons", objectType: "Lesson", id: "l", fields: { relatedDecision: "d" } }, target: { collection: "decisions", objectType: "Decision", id: "d" } },
    { name: "lesson to project", source: { collection: "lessons", objectType: "Lesson", id: "l", fields: { relatedProject: "pr" } }, target: { collection: "projects", objectType: "Project", id: "pr" } },
    { name: "lesson to system", source: { collection: "lessons", objectType: "Lesson", id: "l", fields: { relatedSystem: "s" } }, target: { collection: "systems", objectType: "System", id: "s" } },
    { name: "lesson to capture", source: { collection: "lessons", objectType: "Lesson", id: "l", fields: { relatedCapture: "c" } }, target: { collection: "captures", objectType: "Capture", id: "c" } },
    { name: "system to lesson", source: { collection: "systems", objectType: "System", id: "s", fields: { relatedLesson: "l" } }, target: { collection: "lessons", objectType: "Lesson", id: "l" } },
    { name: "system to capture", source: { collection: "systems", objectType: "System", id: "s", fields: { relatedCapture: "c" } }, target: { collection: "captures", objectType: "Capture", id: "c" } },
    { name: "SOP to system", source: { collection: "sops", objectType: "SOP", id: "sp", fields: { relatedSystem: "s" } }, target: { collection: "systems", objectType: "System", id: "s" } },
    { name: "SOP to lesson", source: { collection: "sops", objectType: "SOP", id: "sp", fields: { relatedLesson: "l" } }, target: { collection: "lessons", objectType: "Lesson", id: "l" } },
    { name: "SOP to capture", source: { collection: "sops", objectType: "SOP", id: "sp", fields: { relatedCapture: "c" } }, target: { collection: "captures", objectType: "Capture", id: "c" } },
    { name: "project to action", source: { collection: "projects", objectType: "Project", id: "pr", fields: { relatedActionIds: ["a"] } }, target: { collection: "actions", objectType: "Action", id: "a" } },
    { name: "project to decision", source: { collection: "projects", objectType: "Project", id: "pr", fields: { relatedDecisionIds: ["d"] } }, target: { collection: "decisions", objectType: "Decision", id: "d" } },
    { name: "project to system", source: { collection: "projects", objectType: "Project", id: "pr", fields: { relatedSystemIds: ["s"] } }, target: { collection: "systems", objectType: "System", id: "s" } },
    { name: "project to SOP", source: { collection: "projects", objectType: "Project", id: "pr", fields: { relatedSopIds: ["sp"] } }, target: { collection: "sops", objectType: "SOP", id: "sp" } },
    { name: "project to capture", source: { collection: "projects", objectType: "Project", id: "pr", fields: { sourceCaptureId: "c" } }, target: { collection: "captures", objectType: "Capture", id: "c" } },
  ];

  it.each(relationshipCases)("preserves the $name edge", ({ source, target }) => {
    const nodes = [source, target];
    const collections: Record<string, unknown[]> = {};
    nodes.forEach((node) => {
      collections[node.collection] ||= [];
      collections[node.collection].push({ id: node.id, ...node.fields });
    });
    const input = makeInput({
      ...collections,
      founderAuthorityItems: nodes.map(({ objectType, id }) => ({ objectType, id, title: id, pillar: "Ops" })),
    } as Partial<CorrelationGraphInput>);
    const result = buildCorrelationGraph(input);
    const left = result.clusterByRecordKey.get(`${source.objectType}:${source.id}`);
    const right = result.clusterByRecordKey.get(`${target.objectType}:${target.id}`);

    expect(left).toBeDefined();
    expect(left).toBe(right);
  });

  it("uses source capture when related capture is empty and prefers a nonempty related capture", () => {
    const fallback = buildCorrelationGraph(makeInput({
      captures: [{ id: "source" }],
      actions: [{ id: "a", sourceCaptureId: "source", relatedCapture: "" }],
      founderAuthorityItems: [{ objectType: "Action", id: "a", title: "Action", pillar: "Ops" }, { objectType: "Capture", id: "source", title: "Source", pillar: "Ops" }],
    }));
    expect(fallback.clusterByRecordKey.get("Action:a")).toBe(fallback.clusterByRecordKey.get("Capture:source"));

    const preferred = buildCorrelationGraph(makeInput({
      captures: [{ id: "source" }, { id: "related" }],
      actions: [{ id: "a", sourceCaptureId: "source", relatedCapture: "related" }],
      founderAuthorityItems: [
        { objectType: "Action", id: "a", title: "Action", pillar: "Ops" },
        { objectType: "Capture", id: "source", title: "Source", pillar: "Ops" },
        { objectType: "Capture", id: "related", title: "Related", pillar: "Ops" },
      ],
    }));
    expect(preferred.clusterByRecordKey.get("Action:a")).toBe(preferred.clusterByRecordKey.get("Capture:related"));
    expect(preferred.clusterByRecordKey.get("Action:a")).not.toBe(preferred.clusterByRecordKey.get("Capture:source"));
  });

  it("links source captures for each supported record family", () => {
    const input = makeInput({
      captures: ["action-capture", "decision-capture", "problem-capture", "opportunity-capture", "lesson-capture", "system-capture", "sop-capture", "project-capture"].map((id) => ({ id })),
      actions: [
        { id: "a", sourceCaptureId: "action-capture" },
        { id: "bridge-action", relatedCapture: "action-capture" },
        { id: "bridge-decision", relatedCapture: "decision-capture" },
        { id: "bridge-problem", relatedCapture: "problem-capture" },
        { id: "bridge-opportunity", relatedCapture: "opportunity-capture" },
        { id: "bridge-lesson", relatedCapture: "lesson-capture" },
        { id: "bridge-system", relatedCapture: "system-capture" },
        { id: "bridge-sop", relatedCapture: "sop-capture" },
        { id: "bridge-project", relatedCapture: "project-capture" },
      ],
      decisions: [{ id: "d", sourceCaptureId: "decision-capture" }],
      problems: [{ id: "p", sourceCaptureId: "problem-capture" }],
      opportunities: [{ id: "o", sourceCaptureId: "opportunity-capture" }],
      lessons: [{ id: "l", sourceCaptureId: "lesson-capture" }],
      systems: [{ id: "s", sourceCaptureId: "system-capture" }],
      sops: [{ id: "sp", sourceCaptureId: "sop-capture" }],
      projects: [{ id: "pr", sourceCaptureId: "project-capture" }],
      founderAuthorityItems: [
        { objectType: "Action", id: "a", title: "Action", pillar: "Ops" },
        { objectType: "Decision", id: "d", title: "Decision", pillar: "Ops" },
        { objectType: "Problem", id: "p", title: "Problem", pillar: "Ops" },
        { objectType: "Opportunity", id: "o", title: "Opportunity", pillar: "Ops" },
        { objectType: "Lesson", id: "l", title: "Lesson", pillar: "Ops" },
        { objectType: "System", id: "s", title: "System", pillar: "Ops" },
        { objectType: "SOP", id: "sp", title: "SOP", pillar: "Ops" },
        { objectType: "Project", id: "pr", title: "Project", pillar: "Ops" },
        { objectType: "Action", id: "bridge-action", title: "Action bridge", pillar: "Ops" },
        { objectType: "Action", id: "bridge-decision", title: "Decision bridge", pillar: "Ops" },
        { objectType: "Action", id: "bridge-problem", title: "Problem bridge", pillar: "Ops" },
        { objectType: "Action", id: "bridge-opportunity", title: "Opportunity bridge", pillar: "Ops" },
        { objectType: "Action", id: "bridge-lesson", title: "Lesson bridge", pillar: "Ops" },
        { objectType: "Action", id: "bridge-system", title: "System bridge", pillar: "Ops" },
        { objectType: "Action", id: "bridge-sop", title: "SOP bridge", pillar: "Ops" },
        { objectType: "Action", id: "bridge-project", title: "Project bridge", pillar: "Ops" },
      ],
    });
    const result = buildCorrelationGraph(input);

    [
      ["Action:a", "Action:bridge-action"],
      ["Decision:d", "Action:bridge-decision"],
      ["Problem:p", "Action:bridge-problem"],
      ["Opportunity:o", "Action:bridge-opportunity"],
      ["Lesson:l", "Action:bridge-lesson"],
      ["System:s", "Action:bridge-system"],
      ["SOP:sp", "Action:bridge-sop"],
      ["Project:pr", "Action:bridge-project"],
    ].forEach(([recordKey, captureKey]) => {
      expect(result.clusterByRecordKey.get(recordKey)).toBe(result.clusterByRecordKey.get(captureKey));
    });
  });

  it("deduplicates repeated undirected relationship references", () => {
    const result = buildCorrelationGraph(makeInput({
      actions: [{ id: "a" }],
      projects: [{ id: "p", relatedActionIds: ["a", "a"] }],
      founderAuthorityItems: [
        { objectType: "Project", id: "p", title: "Project", pillar: "Ops" },
        { objectType: "Action", id: "a", title: "Action", pillar: "Ops" },
      ],
    }));

    expect(result.clusterByRecordKey.get("Project:p")?.records.map((record) => record.recordKey)).toEqual(["Project:p", "Action:a"]);
    expect(result.clusterByRecordKey.get("Project:p")?.recordCount).toBe(2);
  });

  it("ignores dangling relationships and allows unsignalled records to bridge signalled records", () => {
    const result = buildCorrelationGraph(makeInput({
      actions: [{ id: "a", relatedProblem: "missing" }],
      problems: [{ id: "p" }],
      projects: [{ id: "bridge", relatedActionIds: ["a"], relatedDecisionIds: ["d"] }],
      decisions: [{ id: "d" }],
      founderAuthorityItems: [
        { objectType: "Action", id: "a", title: "Action", pillar: "Ops" },
        { objectType: "Decision", id: "d", title: "Decision", pillar: "Ops" },
      ],
    }));
    const cluster = result.clusterByRecordKey.get("Action:a");

    expect(cluster).toBe(result.clusterByRecordKey.get("Decision:d"));
    expect(cluster?.records.map((record) => record.recordKey)).toEqual(["Action:a", "Decision:d"]);
    expect(cluster?.recordCount).toBe(2);
    expect(cluster?.contributingRecordCount).toBe(2);
    expect(result.signalled.has("Problem:p")).toBe(false);
  });

  it("collapses duplicate same-type IDs but preserves first signalled metadata", () => {
    const result = buildCorrelationGraph(makeInput({
      actions: [{ id: "a" }, { id: "a", relatedProblem: "p" }],
      founderAuthorityItems: [
        { objectType: "Action", id: "a", title: "First", pillar: "First area" },
        { objectType: "Action", id: "a", title: "Second", pillar: "Second area" },
      ],
    }));
    const record = result.signalled.get("Action:a")!;

    expect(result.signalled.size).toBe(1);
    expect(result.clusters[0].records).toHaveLength(1);
    expect(record.title).toBe("First");
    expect(record.area).toBe("First area");
  });

  it("keeps identical raw IDs distinct across object types", () => {
    const result = buildCorrelationGraph(makeInput({
      actions: [{ id: "same" }],
      problems: [{ id: "same" }],
      founderAuthorityItems: [
        { objectType: "Action", id: "same", title: "Action", pillar: "Ops" },
        { objectType: "Problem", id: "same", title: "Problem", pillar: "Ops" },
      ],
    }));

    expect(result.signalled.size).toBe(2);
    expect(result.clusterByRecordKey.get("Action:same")).not.toBe(result.clusterByRecordKey.get("Problem:same"));
  });
});

describe("correlation graph clusters", () => {
  it("retains singleton clusters and applies convergent-risk threshold boundaries", () => {
    const singleton = buildCorrelationGraph(makeInput({
      founderAuthorityItems: [{ objectType: "Action", id: "single", title: "Single", pillar: "Ops" }],
    }));
    expect(singleton.clusters).toHaveLength(1);
    expect(singleton.convergentRisks).toHaveLength(0);

    const twoCategories = buildCorrelationGraph(makeInput({
      actions: [{ id: "a", relatedProblem: "p" }],
      problems: [{ id: "p" }],
      founderAuthorityItems: [
        { objectType: "Action", id: "a", title: "Action", pillar: "Ops" },
        { objectType: "Problem", id: "p", title: "Problem", pillar: "Ops" },
      ],
      commandAttentionItems: [{ objectType: "Action", id: "a", title: "Action", area: "Ops", reasons: ["BLOCKED"], priorityScore: 0 }],
    }));
    expect(twoCategories.clusters[0].categories.size).toBe(2);
    expect(twoCategories.convergentRisks).toHaveLength(0);

    const oneRecordThreeCategories = buildCorrelationGraph(makeInput({
      founderAuthorityItems: [{ objectType: "Action", id: "a", title: "Action", pillar: "Ops" }],
      commandAttentionItems: [{ objectType: "Action", id: "a", title: "Action", area: "Ops", reasons: ["BLOCKED", "OVERDUE"], priorityScore: 0 }],
    }));
    expect(oneRecordThreeCategories.clusters[0].categories.size).toBe(3);
    expect(oneRecordThreeCategories.convergentRisks).toHaveLength(0);

    const valid = buildCorrelationGraph(makeInput({
      actions: [{ id: "a", relatedProblem: "p" }],
      problems: [{ id: "p" }],
      founderAuthorityItems: [
        { objectType: "Action", id: "a", title: "Action", pillar: "Ops" },
        { objectType: "Problem", id: "p", title: "Problem", pillar: "Ops" },
      ],
      commandAttentionItems: [{ objectType: "Action", id: "a", title: "Action", area: "Ops", reasons: ["BLOCKED", "OVERDUE"], priorityScore: 0 }],
    }));
    expect(valid.convergentRisks).toHaveLength(1);
    expect(valid.convergentRisks[0].recordCount).toBe(2);
    expect(valid.convergentRisks[0].contributingRecordCount).toBe(2);
  });

  it("uses the first encountered equal-score component record as the root", () => {
    const result = buildCorrelationGraph(makeInput({
      actions: [{ id: "a", relatedProblem: "p" }],
      problems: [{ id: "p" }],
      founderAuthorityItems: [
        { objectType: "Problem", id: "p", title: "Problem first", pillar: "Ops" },
        { objectType: "Action", id: "a", title: "Action second", pillar: "Ops" },
      ],
    }));

    expect(result.clusters[0].clusterKey).toBe("cluster:Problem:p");
    expect(result.clusters[0].title).toBe("Problem first");
  });

  it("orders convergent clusters by category count, record count, then top score with stable ties", () => {
    const groups = [
      { name: "first", count: 2, categories: 3, score: 400 },
      { name: "more-records", count: 3, categories: 3, score: 400 },
      { name: "more-categories", count: 2, categories: 4, score: 400 },
      { name: "higher-score", count: 2, categories: 3, score: 500 },
    ];
    const actions: Array<{ id: string; relatedProblem: string }> = [];
    const problems: Array<{ id: string }> = [];
    const founderAuthorityItems: CorrelationGraphInput["founderAuthorityItems"][number][] = [];
    const commandAttentionItems: CorrelationGraphInput["commandAttentionItems"][number][] = [];
    const learningGaps: CorrelationGraphInput["learningGaps"][number][] = [];

    groups.forEach(({ name, count, categories, score }) => {
      const problemId = `${name}-problem`;
      problems.push({ id: problemId });
      founderAuthorityItems.push({ objectType: "Problem", id: problemId, title: problemId, pillar: "Ops" });
      for (let index = 0; index < count - 1; index += 1) {
        const actionId = `${name}-action-${index}`;
        actions.push({ id: actionId, relatedProblem: problemId });
        founderAuthorityItems.push({ objectType: "Action", id: actionId, title: actionId, pillar: "Ops" });
        commandAttentionItems.push({
          objectType: "Action",
          id: actionId,
          title: actionId,
          area: "Ops",
          reasons: ["BLOCKED", "OVERDUE"],
          priorityScore: score - 360,
        });
      }
      if (categories === 4) learningGaps.push({ id: problemId, title: problemId, area: "Ops" });
    });

    const result = buildCorrelationGraph(makeInput({ actions, problems, founderAuthorityItems, commandAttentionItems, learningGaps }));
    expect(result.convergentRisks.map((cluster) => cluster.clusterKey)).toEqual([
      "cluster:Problem:more-categories-problem",
      "cluster:Problem:more-records-problem",
      "cluster:Action:higher-score-action-0",
      "cluster:Problem:first-problem",
    ]);
  });

  it("returns Map and Set structures and indexes every signalled record by its cluster", () => {
    const result = buildCorrelationGraph(makeInput({
      actions: [{ id: "a", relatedProblem: "p" }],
      problems: [{ id: "p" }],
      founderAuthorityItems: [
        { objectType: "Action", id: "a", title: "Action", pillar: "Ops" },
        { objectType: "Problem", id: "p", title: "Problem", pillar: "Ops" },
      ],
    }));
    const cluster = result.clusterByRecordKey.get("Action:a");

    expect(result.signalled).toBeInstanceOf(Map);
    expect(result.clusterByRecordKey).toBeInstanceOf(Map);
    expect(result.clusters[0].categories).toBeInstanceOf(Set);
    expect(result.signalled.get("Action:a")?.signals).toBeInstanceOf(Set);
    expect(cluster).toBe(result.clusterByRecordKey.get("Problem:p"));
    expect(result.clusters[0].clusterKey).toBe("cluster:Action:a");
  });

  it("does not mutate inputs and returns deterministic output for repeated execution", () => {
    const input = makeInput({
      actions: [{ id: "a", relatedProblem: "p", relatedCapture: "c" }],
      problems: [{ id: "p" }],
      captures: [{ id: "c" }],
      founderAuthorityItems: [
        { objectType: "Action", id: "a", title: "Action", pillar: "Ops" },
        { objectType: "Problem", id: "p", title: "Problem", pillar: "Ops" },
      ],
      commandAttentionItems: [{ objectType: "Action", id: "a", title: "Action", area: "Ops", reasons: ["BLOCKED"], priorityScore: 4 }],
    });
    const before = structuredClone(input);
    const first = buildCorrelationGraph(input);
    const second = buildCorrelationGraph(input);
    const snapshot = (result: ReturnType<typeof buildCorrelationGraph>) => ({
      signalled: [...result.signalled].map(([key, record]) => [key, record.title, record.area, [...record.signals], record.baseScore]),
      clusters: result.clusters.map((cluster) => [cluster.clusterKey, cluster.title, cluster.records.map((record) => record.recordKey), [...cluster.categories], cluster.recordCount, cluster.contributingRecordCount, cluster.topScore]),
      convergentRisks: result.convergentRisks.map((cluster) => cluster.clusterKey),
      clusterByRecordKey: [...result.clusterByRecordKey].map(([key, cluster]) => [key, cluster.clusterKey]),
    });

    expect(input).toEqual(before);
    expect(snapshot(first)).toEqual(snapshot(second));
  });
});