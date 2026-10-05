import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";
import {
  buildFounderFocus,
  type FounderFocusClusterInput,
  type FounderFocusInput,
  type FounderFocusLimitationInput,
  type FounderFocusRecordFact,
  type FounderFocusReviewInput,
  type FounderFocusSignalInput,
  type FounderFocusStrategicRiskInput,
} from "./founder-focus";
import { buildFounderOperatingBrief } from "./founder-operating-brief";
import { buildIcarusFounderFocusRisks, type IcarusStrategicSignal } from "./icarus-strategic-attention";

function input(overrides: Partial<FounderFocusInput> = {}): FounderFocusInput {
  return {
    signalledRecords: [],
    founderReviewItems: [],
    limitations: [],
    convergentRisks: [],
    recordFacts: new Map(),
    ...overrides,
  };
}

function signal(overrides: Partial<FounderFocusSignalInput> = {}): FounderFocusSignalInput {
  return {
    recordKey: "Action:a",
    objectType: "Action",
    id: "a",
    title: "Action",
    area: "Operations",
    signals: ["blocked"],
    baseScore: 200,
    ...overrides,
  };
}

function review(overrides: Partial<FounderFocusReviewInput> = {}): FounderFocusReviewInput {
  return {
    objectType: "Action",
    id: "a",
    title: "Reviewed action",
    pillar: "Review area",
    reasonCategory: "Review due",
    whyItMatters: "Review evidence",
    ...overrides,
  };
}

function limitation(overrides: Partial<FounderFocusLimitationInput> = {}): FounderFocusLimitationInput {
  return {
    key: "opportunity-capital",
    severity: "Material",
    label: "Capital requirement missing",
    action: { objectType: "Opportunity", id: "o" },
    ...overrides,
  };
}

function cluster(overrides: Partial<FounderFocusClusterInput> = {}): FounderFocusClusterInput {
  return {
    clusterKey: "cluster:Action:a",
    title: "Systemic situation",
    records: [
      signal(),
      signal({ recordKey: "Project:p", objectType: "Project", id: "p", area: "Project area", baseScore: 100 }),
    ],
    categories: ["blocked", "overdue", "no execution path"],
    recordCount: 2,
    ...overrides,
  };
}

function fact(urgencyTime: number | null = null, isWaitingAction = false): FounderFocusRecordFact {
  return { urgencyTime, isWaitingAction };
}

type PageInputs = {
  actionRecords: { id: string; dueDate?: string; status: string }[];
  projects: { id: string; targetCompletionDate?: string }[];
  decisionRecords: { id: string; reviewDate?: string }[];
  commitmentRecords: { id: string; dueDate?: string }[];
  incomeRecords: { id: string; date?: string }[];
  correlationLayer: {
    signalled: Map<string, Omit<FounderFocusSignalInput, "signals"> & { signals: Set<string> }>;
    convergentRisks: (Omit<FounderFocusClusterInput, "categories"> & { categories: Set<string> })[];
  };
  empireDecisionQueue: {
    founderReviewQueue: (FounderFocusReviewInput & { kind?: string })[];
  };
  strategicDataConfidence: { limitations: FounderFocusLimitationInput[] };
  icarusStrategicSignals?: IcarusStrategicSignal[];
};

// Exercise the actual page adapter and authoritative helpers without importing the client component.
function projectPageInput(overrides: Partial<PageInputs> = {}): FounderFocusInput {
  const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
  const section = (start: string, end: string) => {
    const startIndex = page.indexOf(start);
    const endIndex = page.indexOf(end, startIndex);
    if (startIndex < 0 || endIndex < 0) throw new Error(`Missing Founder Focus adapter boundary: ${start}`);
    return page.slice(startIndex, endIndex);
  };
  const source = [
    section("function isActionWaiting(", "\nconst personStatusOptions"),
    section("  const getDateValue =", "  const isActionActive ="),
    section("  const founderFocusRecordFacts =", "  const founderFocusList ="),
  ].join("\n");
  const { outputText } = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2020, module: ModuleKind.ESNext },
  });
  let projected: FounderFocusInput | undefined;
  runInNewContext(outputText, {
    Map,
    Date,
    actionRecords: [],
    projects: [],
    decisionRecords: [],
    commitmentRecords: [],
    incomeRecords: [],
    correlationLayer: { signalled: new Map(), convergentRisks: [] },
    empireDecisionQueue: { founderReviewQueue: [] },
    strategicDataConfidence: { limitations: [] },
    ...overrides,
    // Mirrors the pipeline contract: founderFocusRisks = buildIcarusFounderFocusRisks(strategicSignals).
    icarusIntelligence: { founderFocusRisks: buildIcarusFounderFocusRisks(overrides.icarusStrategicSignals ?? []) },
    buildFounderFocus: (value: FounderFocusInput) => {
      projected = value;
      return [];
    },
  }, { timeout: 1000 });
  if (!projected) throw new Error("Founder Focus page adapter did not call the builder");
  return projected;
}

describe("Founder Focus signal classification", () => {
  const bands: [string, number][] = [
    ["founder authority", 1],
    ["blocked", 2],
    ["overdue", 2],
    ["review due", 2],
    ["cash buffer pressure", 2],
    ["overdue commitment", 2],
    ["expected income overdue", 2],
    ["no execution path", 4],
    ["learning not captured", 4],
    ["no valid owner", 4],
    ["stale record", 5],
    ["opportunity stalled", 5],
    ["lead stalled", 5],
    ["unrecognised signal", 5],
  ];

  it.each(bands)("classifies %s as band %i", (name, band) => {
    expect(buildFounderFocus(input({ signalledRecords: [signal({ signals: [name] })] }))[0]).toMatchObject({
      band,
      score: 200,
      reason: `Needs attention: ${name}.`,
    });
  });

  it.each([
    { signals: ["no valid owner", "overdue", "founder authority"], band: 1 },
    { signals: ["stale record", "learning not captured", "blocked"], band: 2 },
    { signals: ["lead stalled", "no execution path"], band: 4 },
    { signals: ["stale record", "lead stalled"], band: 5 },
  ])("uses classification precedence independent of signal order: $signals", ({ signals, band }) => {
    expect(buildFounderFocus(input({ signalledRecords: [signal({ signals })] }))[0].band).toBe(band);
  });

  it("scores all supplied signals and retains their order in the exact output shape", () => {
    expect(buildFounderFocus(input({
      signalledRecords: [signal({ signals: ["no valid owner", "blocked", "stale record"], baseScore: 360 })],
      recordFacts: new Map([["Action:a", fact(100)]]),
    }))).toEqual([{
      key: "Action:a",
      objectType: "Action",
      id: "a",
      title: "Action",
      area: "Operations",
      score: 440,
      band: 2,
      urgencyTime: 100,
      reason: "Needs attention for 3 reasons: no valid owner, blocked, stale record.",
    }]);
  });

  it("retains existing empty-signal behaviour rather than inventing an alternative classification", () => {
    expect(buildFounderFocus(input({ signalledRecords: [signal({ signals: [] })] }))[0]).toMatchObject({
      score: 160,
      band: 5,
      reason: "Needs attention: undefined.",
    });
  });
});

describe("Founder Focus candidate replacement", () => {
  it.each([
    { signals: ["founder authority"], baseScore: 1, expectedTitle: "Later", band: 1, score: 1 },
    { signals: ["blocked"], baseScore: 201, expectedTitle: "Later", band: 2, score: 201 },
    { signals: ["blocked"], baseScore: 200, expectedTitle: "Later", band: 2, score: 200 },
    { signals: ["blocked"], baseScore: 199, expectedTitle: "First", band: 2, score: 200 },
    { signals: ["no valid owner"], baseScore: 1000, expectedTitle: "First", band: 2, score: 200 },
  ])("preserves band/score upgrade rules for $signals at $baseScore", ({ signals, baseScore, expectedTitle, band, score }) => {
    const [candidate] = buildFounderFocus(input({
      signalledRecords: [
        signal({ title: "First" }),
        signal({ title: "Later", signals, baseScore }),
      ],
    }));
    expect(candidate).toMatchObject({ title: expectedTitle, band, score });
  });

  it("uses supplied signal keys rather than reconstructing them from the record identity", () => {
    const result = buildFounderFocus(input({
      signalledRecords: [signal({ recordKey: "external-key" })],
      founderReviewItems: [review()],
    }));
    expect(result.map(({ key }) => key)).toEqual(["Action:a", "external-key"]);
  });

  it("keeps identical raw ids distinct across object types", () => {
    const result = buildFounderFocus(input({
      signalledRecords: [
        signal(),
        signal({ recordKey: "Project:a", objectType: "Project" }),
      ],
    }));
    expect(result.map(({ key }) => key)).toEqual(["Action:a", "Project:a"]);
  });
});

describe("Founder Focus founder-review merging", () => {
  const reviewScores: [string, number, number][] = [
    ["Authority required", 400, 1],
    ["Critical escalation", 400, 1],
    ["Review due", 300, 2],
    ["Under review", 290, 2],
    ["High-risk judgement", 280, 2],
    ["Unknown review category", 280, 2],
  ];

  it.each(reviewScores)("scores %s as %i in band %i", (reasonCategory, score, band) => {
    expect(buildFounderFocus(input({ founderReviewItems: [review({ reasonCategory })] }))[0]).toEqual({
      key: "Action:a",
      objectType: "Action",
      id: "a",
      title: "Reviewed action",
      area: "Review area",
      score,
      band,
      urgencyTime: null,
      reason: `${reasonCategory}: Review evidence`,
    });
  });

  it("retains a stronger existing score and better band while replacing metadata and reason on a tie", () => {
    const [candidate] = buildFounderFocus(input({
      signalledRecords: [signal({ signals: ["founder authority"], baseScore: 700 })],
      founderReviewItems: [review({ reasonCategory: "High-risk judgement" })],
      recordFacts: new Map([["Action:a", fact(123)]]),
    }));
    expect(candidate).toMatchObject({
      title: "Reviewed action",
      area: "Review area",
      band: 1,
      score: 700,
      urgencyTime: 123,
      reason: "High-risk judgement: Review evidence",
    });
  });

  it("upgrades a signal's band and score and uses the last equal-strength review reason", () => {
    const [candidate] = buildFounderFocus(input({
      signalledRecords: [signal({ signals: ["no execution path"], baseScore: 250 })],
      founderReviewItems: [
        review({ reasonCategory: "Authority required" }),
        review({ reasonCategory: "Under review", title: "Last review", whyItMatters: "Later evidence" }),
      ],
    }));
    expect(candidate).toMatchObject({
      band: 1,
      score: 400,
      title: "Last review",
      reason: "Under review: Later evidence",
    });
  });

  it("uses objectType, not the page queue's kind, for review identity", () => {
    const projected = projectPageInput({
      empireDecisionQueue: { founderReviewQueue: [{ ...review(), kind: "Decision" }] },
    });
    expect(projected.founderReviewItems).toEqual([review()]);
    expect(buildFounderFocus(projected)[0].key).toBe("Action:a");
  });
});

describe("Founder Focus strategic-confidence limitations", () => {
  it.each([
    { severity: "Blocker" as const, score: 390, band: 1 },
    { severity: "Material" as const, score: 250, band: 3 },
  ])("classifies $severity limitations with exact target, score, band, and reason", ({ severity, score, band }) => {
    expect(buildFounderFocus(input({ limitations: [limitation({ severity })] }))).toEqual([{
      key: "Opportunity:o",
      objectType: "Opportunity",
      id: "o",
      title: "Capital requirement missing",
      area: "Opportunity",
      score,
      band,
      urgencyTime: null,
      reason: `Strategic data confidence ${severity.toLowerCase()} — Capital requirement missing.`,
    }]);
  });

  it("forces ownership limitations to People:unassigned even without or with a conflicting action", () => {
    const result = buildFounderFocus(input({
      limitations: [
        limitation({ key: "ownership", action: undefined, label: "First ownership gap" }),
        limitation({ key: "ownership", label: "Later ownership gap" }),
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      key: "People:unassigned",
      objectType: "People",
      id: "unassigned",
      area: "People",
      title: "Later ownership gap",
    });
  });

  it("excludes warnings and non-ownership limitations without truthy action identities", () => {
    expect(buildFounderFocus(input({
      limitations: [
        limitation({ severity: "Warning" }),
        limitation({ key: "ownership", severity: "Warning" }),
        limitation({ action: undefined }),
        limitation({ action: { objectType: "", id: "o" } }),
        limitation({ action: { objectType: "Opportunity", id: "" } }),
      ],
    }))).toEqual([]);
  });

  it("applies replacement rules rather than unconditionally overriding earlier signals or reviews", () => {
    const result = buildFounderFocus(input({
      signalledRecords: [
        signal({ recordKey: "Opportunity:o", objectType: "Opportunity", id: "o", baseScore: 900 }),
        signal({ recordKey: "People:unassigned", objectType: "People", id: "unassigned", signals: ["no valid owner"], baseScore: 999 }),
      ],
      limitations: [
        limitation(),
        limitation({ key: "ownership", severity: "Blocker", label: "Ownership blocker" }),
      ],
    }));
    expect(result.find(({ key }) => key === "Opportunity:o")).toMatchObject({ title: "Action", band: 2, score: 900 });
    expect(result.find(({ key }) => key === "People:unassigned")).toMatchObject({ title: "Ownership blocker", band: 1, score: 390 });
  });

  it("lets a later equal-score limitation replace an earlier limitation's metadata", () => {
    expect(buildFounderFocus(input({
      limitations: [limitation(), limitation({ label: "Later label" })],
    }))[0].title).toBe("Later label");
  });
});

describe("Founder Focus Finance and waiting-action boundaries", () => {
  it("excludes Finance signals but permits Finance re-entry through limitations and reviews", () => {
    const financeSignal = signal({ recordKey: "Finance:cash-buffer", objectType: "Finance", id: "cash-buffer", baseScore: 999 });
    expect(buildFounderFocus(input({ signalledRecords: [financeSignal] }))).toEqual([]);
    const result = buildFounderFocus(input({
      signalledRecords: [financeSignal],
      limitations: [limitation({ severity: "Blocker", action: { objectType: "Finance", id: "cash-buffer" } })],
      founderReviewItems: [review({ objectType: "Finance", id: "commitment:c" })],
      recordFacts: new Map([["Finance:commitment:c", fact(200)]]),
    }));
    expect(result.map(({ key, score, band, urgencyTime }) => [key, score, band, urgencyTime])).toEqual([
      ["Finance:cash-buffer", 390, 1, null],
      ["Finance:commitment:c", 300, 2, 200],
    ]);
  });

  it("suppresses waiting Actions in each ordinary pass but does not suppress missing Actions or other types", () => {
    const result = buildFounderFocus(input({
      signalledRecords: [
        signal(),
        signal({ recordKey: "Action:missing", id: "missing" }),
        signal({ recordKey: "Project:a", objectType: "Project" }),
      ],
      founderReviewItems: [review()],
      limitations: [limitation({ severity: "Blocker", action: { objectType: "Action", id: "a" } })],
      recordFacts: new Map([["Action:a", fact(10, true)], ["Project:a", fact(20, true)]]),
    }));
    expect(result.map(({ key }) => key)).toEqual(["Project:a", "Action:missing"]);
  });

  it("allows a waiting Action to be a cluster root despite ordinary-pass suppression", () => {
    const projectedCluster = cluster({
      records: [
        signal({ baseScore: 999 }),
        signal({ recordKey: "Project:p", objectType: "Project", id: "p", baseScore: 200 }),
      ],
    });
    const result = buildFounderFocus(input({
      signalledRecords: [
        signal({ baseScore: 999 }),
        signal({ recordKey: "Project:p", objectType: "Project", id: "p" }),
      ],
      convergentRisks: [projectedCluster],
      recordFacts: new Map([["Action:a", fact(5, true)], ["Project:p", fact(100)]]),
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      key: "cluster:Action:a",
      objectType: "Action",
      id: "a",
      score: 452,
      band: 2,
      urgencyTime: 100,
    });
  });

  it("promotes a Finance-only cluster with no ordinary candidates and does not inherit excluded urgency", () => {
    const finance = signal({ recordKey: "Finance:income:i", objectType: "Finance", id: "income:i", baseScore: 1000 });
    const result = buildFounderFocus(input({
      signalledRecords: [finance],
      convergentRisks: [cluster({ records: [finance], recordCount: 7 })],
      recordFacts: new Map([["Finance:income:i", fact(123)]]),
    }));
    expect(result[0]).toMatchObject({
      objectType: "Finance",
      id: "income:i",
      score: 457,
      band: 3,
      urgencyTime: null,
    });
  });
});

describe("Founder Focus convergent-risk promotion", () => {
  it("selects the highest raw baseScore root and retains the first equal-score record, not candidate ranking", () => {
    const records = [
      signal({ recordKey: "Project:p", objectType: "Project", id: "p", baseScore: 200, area: "First root area" }),
      signal({ baseScore: 200 }),
      signal({ recordKey: "Decision:d", objectType: "Decision", id: "d", baseScore: 199 }),
    ];
    const result = buildFounderFocus(input({
      signalledRecords: records,
      founderReviewItems: [review({ objectType: "Decision", id: "d", reasonCategory: "Authority required" })],
      convergentRisks: [cluster({ records })],
    }));
    expect(result[0]).toMatchObject({
      key: "cluster:Action:a",
      objectType: "Project",
      id: "p",
      area: "First root area",
      title: "Systemic situation",
    });
  });

  it("replaces the initial cluster record when a later record has a strictly greater baseScore", () => {
    expect(buildFounderFocus(input({
      convergentRisks: [cluster({
        records: [signal({ baseScore: 10 }), signal({ objectType: "Project", id: "p", baseScore: 11 })],
      })],
    }))[0]).toMatchObject({ objectType: "Project", id: "p" });
  });

  it("inherits strongest merged score, best band and earliest constituent urgency, then removes constituents", () => {
    const records = [
      signal(),
      signal({ recordKey: "Project:p", objectType: "Project", id: "p", signals: ["no execution path"], baseScore: 100 }),
    ];
    const result = buildFounderFocus(input({
      signalledRecords: [...records, signal({ recordKey: "Action:other", id: "other" })],
      founderReviewItems: [review({ reasonCategory: "Authority required" })],
      limitations: [limitation({ severity: "Blocker", action: { objectType: "Project", id: "p" } })],
      convergentRisks: [cluster({ records })],
      recordFacts: new Map([["Action:a", fact(300)], ["Project:p", fact(100)]]),
    }));
    expect(result.map(({ key }) => key)).toEqual(["cluster:Action:a", "Action:other"]);
    expect(result[0]).toMatchObject({
      score: 452,
      band: 1,
      urgencyTime: 100,
      reason: "Convergent risk — one situation is generating 3 kinds of signal (blocked, overdue, no execution path) across 2 linked records, so it is systemic rather than isolated.",
    });
  });

  it.each(["stale record", "no execution path"])("keeps a stronger score and caps weak constituent bands at three for %s", (name) => {
    const records = [signal({ signals: [name], baseScore: 900 })];
    expect(buildFounderFocus(input({
      signalledRecords: records,
      convergentRisks: [cluster({ records, categories: [name], recordCount: 5 })],
    }))[0]).toMatchObject({ score: 900, band: 3, urgencyTime: null });
  });

  it("uses ordered categories and the supplied recordCount, not constituent-array length", () => {
    expect(buildFounderFocus(input({
      convergentRisks: [cluster({ categories: ["z", "a", "m", "b"], recordCount: 8 })],
    }))[0]).toMatchObject({
      score: 468,
      band: 3,
      reason: "Convergent risk — one situation is generating 4 kinds of signal (z, a, m, b) across 8 linked records, so it is systemic rather than isolated.",
    });
  });

  it("processes clusters sequentially against the current candidate Map", () => {
    const records = [signal({ signals: ["founder authority"], baseScore: 900 })];
    const result = buildFounderFocus(input({
      signalledRecords: records,
      convergentRisks: [
        cluster({ clusterKey: "cluster:first", records }),
        cluster({ clusterKey: "cluster:second", records }),
      ],
      recordFacts: new Map([["Action:a", fact(100)]]),
    }));
    expect(result.map(({ key, score, band, urgencyTime }) => [key, score, band, urgencyTime])).toEqual([
      ["cluster:first", 900, 1, 100],
      ["cluster:second", 452, 3, null],
    ]);
  });

  it("inserts clusters directly, replacing an existing cluster identity without the normal upgrade check", () => {
    const result = buildFounderFocus(input({
      convergentRisks: [
        cluster({ categories: ["a", "b", "c", "d"], title: "First" }),
        cluster({ categories: ["a"], title: "Later" }),
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: "Later", score: 432 });
  });
});

describe("Founder Focus final ordering and result boundaries", () => {
  it("sorts by ascending band, descending score, earliest urgency, then locale-compared key", () => {
    const result = buildFounderFocus(input({
      signalledRecords: [
        signal({ recordKey: "Action:undated-z", id: "undated-z" }),
        signal({ recordKey: "Action:later", id: "later" }),
        signal({ recordKey: "Action:undated-a", id: "undated-a" }),
        signal({ recordKey: "Action:early-z", id: "early-z", title: "A title" }),
        signal({ recordKey: "Action:early-a", id: "early-a", title: "Z title" }),
        signal({ recordKey: "Action:high-score", id: "high-score", baseScore: 300 }),
        signal({ recordKey: "Action:best-band", id: "best-band", signals: ["founder authority"], baseScore: 1 }),
      ],
      recordFacts: new Map([
        ["Action:later", fact(20)],
        ["Action:early-z", fact(10)],
        ["Action:early-a", fact(10)],
      ]),
    }));
    expect(result.map(({ id }) => id)).toEqual([
      "best-band", "high-score", "early-a", "early-z", "later", "undated-a", "undated-z",
    ]);
  });

  it("uses localeCompare for otherwise tied keys rather than title or insertion order", () => {
    const ids = ["z", "Z", "a", "A"];
    const result = buildFounderFocus(input({
      signalledRecords: ids.map((id) => signal({ id, recordKey: `Action:${id}` })),
    }));
    expect(result.map(({ key }) => key)).toEqual(ids.map((id) => `Action:${id}`).sort((a, b) => a.localeCompare(b)));
  });

  it("returns empty results for empty input and for entirely filtered ordinary candidates", () => {
    expect(buildFounderFocus(input())).toEqual([]);
    expect(buildFounderFocus(input({
      signalledRecords: [
        signal(),
        signal({ recordKey: "Finance:cash-buffer", objectType: "Finance", id: "cash-buffer" }),
      ],
      founderReviewItems: [review()],
      limitations: [limitation({ severity: "Warning" })],
      recordFacts: new Map([["Action:a", fact(null, true)]]),
    }))).toEqual([]);
  });

  it("returns the full queue without applying the page's top-three slice", () => {
    const result = buildFounderFocus(input({
      signalledRecords: ["1", "2", "3", "4", "5"].map((id) => signal({ id, recordKey: `Action:${id}` })),
    }));
    expect(result).toHaveLength(5);
    const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
    expect(page).toContain("const founderFocusList = founderFocusCandidates.slice(0, 3);");
  });

  it("is deterministic and does not mutate supplied facts, records, arrays, or upstream Maps and Sets", () => {
    const pageInputs: PageInputs = {
      actionRecords: [{ id: "a", dueDate: "2026-10-02", status: "Open" }],
      projects: [],
      decisionRecords: [],
      commitmentRecords: [],
      incomeRecords: [],
      correlationLayer: {
        signalled: new Map([["Action:a", { ...signal(), signals: new Set(["blocked", "overdue"]) }]]),
        convergentRisks: [{ ...cluster(), categories: new Set(["blocked", "overdue", "no execution path"]) }],
      },
      empireDecisionQueue: { founderReviewQueue: [review()] },
      strategicDataConfidence: { limitations: [limitation()] },
    };
    const pageBefore = structuredClone(pageInputs);
    const projected = projectPageInput(pageInputs);
    const before = structuredClone(projected);
    projected.signalledRecords.forEach((record) => {
      Object.freeze(record.signals);
      Object.freeze(record);
    });
    projected.convergentRisks.forEach((item) => {
      item.records.forEach(Object.freeze);
      Object.freeze(item.records);
      Object.freeze(item.categories);
      Object.freeze(item);
    });
    projected.founderReviewItems.forEach(Object.freeze);
    projected.limitations.forEach(Object.freeze);
    projected.recordFacts.forEach(Object.freeze);
    Object.freeze(projected.signalledRecords);
    Object.freeze(projected.convergentRisks);
    Object.freeze(projected.founderReviewItems);
    Object.freeze(projected.limitations);
    Object.freeze(projected);

    const first = buildFounderFocus(projected);
    expect(buildFounderFocus(projected)).toEqual(first);
    expect(projected).toEqual(before);
    expect(pageInputs).toEqual(pageBefore);
    first[0].title = "Changed output";
    expect(buildFounderFocus(projected)).not.toEqual(first);
  });
});

describe("Founder Focus page fact projection", () => {
  it.each([
    { name: "missing", value: undefined, urgencyTime: null },
    { name: "empty", value: "", urgencyTime: null },
    { name: "invalid", value: "not-a-date", urgencyTime: null },
    { name: "epoch zero", value: "1970-01-01T00:00:00.000Z", urgencyTime: null },
    { name: "negative", value: "1969-12-31T23:59:59.999Z", urgencyTime: null },
    { name: "valid positive", value: "1970-01-01T00:00:00.001Z", urgencyTime: 1 },
    { name: "valid timestamp", value: "2026-10-02T12:00:00.000Z", urgencyTime: Date.UTC(2026, 9, 2, 12) },
  ])("preserves $name urgency-date semantics through the actual adapter", ({ value, urgencyTime }) => {
    const projected = projectPageInput({
      actionRecords: [{ id: "a", status: "Open", dueDate: value }],
      correlationLayer: { signalled: new Map([["Action:a", { ...signal(), signals: new Set(["blocked"]) }]]), convergentRisks: [] },
    });
    expect(projected.recordFacts.get("Action:a")).toEqual(fact(urgencyTime));
    expect(buildFounderFocus(projected)[0].urgencyTime).toBe(urgencyTime);
  });

  it("preserves first-match date and waiting facts for duplicate ids, including an invalid first date", () => {
    const projected = projectPageInput({
      actionRecords: [
        { id: "waiting-first", status: "Waiting", dueDate: "not-a-date" },
        { id: "waiting-first", status: "Open", dueDate: "2026-10-03" },
        { id: "open-first", status: "Open", dueDate: "2026-10-01" },
        { id: "open-first", status: "Waiting", dueDate: "2026-10-02" },
      ],
      projects: [
        { id: "p", targetCompletionDate: "" },
        { id: "p", targetCompletionDate: "2026-10-02" },
      ],
      decisionRecords: [{ id: "d" }, { id: "d", reviewDate: "2026-10-02" }],
      commitmentRecords: [{ id: "c", dueDate: "not-a-date" }, { id: "c", dueDate: "2026-10-02" }],
      incomeRecords: [{ id: "i", date: "1970-01-01" }, { id: "i", date: "2026-10-02" }],
      correlationLayer: {
        signalled: new Map([
          ["Action:waiting-first", { ...signal({ id: "waiting-first" }), signals: new Set(["blocked"]) }],
          ["Action:open-first", { ...signal({ id: "open-first" }), signals: new Set(["blocked"]) }],
        ]),
        convergentRisks: [],
      },
    });
    expect(projected.recordFacts.get("Action:waiting-first")).toEqual(fact(null, true));
    expect(projected.recordFacts.get("Action:open-first")).toEqual(fact(new Date("2026-10-01").getTime()));
    for (const key of ["Project:p", "Decision:d", "Finance:commitment:c", "Finance:income:i"]) {
      expect(projected.recordFacts.get(key)).toEqual(fact());
    }
    expect(buildFounderFocus(projected).map(({ id }) => id)).toEqual(["open-first"]);
  });

  it("projects each supported date source and Finance prefix without conflating same raw ids", () => {
    const projected = projectPageInput({
      actionRecords: [{ id: "same", status: "waiting", dueDate: "1970-01-01T00:00:00.001Z" }],
      projects: [{ id: "same", targetCompletionDate: "1970-01-01T00:00:00.002Z" }],
      decisionRecords: [{ id: "same", reviewDate: "1970-01-01T00:00:00.003Z" }],
      commitmentRecords: [{ id: "same", dueDate: "1970-01-01T00:00:00.004Z" }],
      incomeRecords: [{ id: "same", date: "1970-01-01T00:00:00.005Z" }],
      empireDecisionQueue: {
        founderReviewQueue: [
          review({ objectType: "Action", id: "same" }),
          review({ objectType: "Project", id: "same" }),
          review({ objectType: "Decision", id: "same" }),
          review({ objectType: "Finance", id: "commitment:same" }),
          review({ objectType: "Finance", id: "income:same" }),
          review({ objectType: "Finance", id: "same" }),
          review({ objectType: "Opportunity", id: "same" }),
        ],
      },
    });
    expect([...projected.recordFacts.entries()]).toEqual([
      ["Action:same", fact(1)],
      ["Project:same", fact(2)],
      ["Decision:same", fact(3)],
      ["Finance:commitment:same", fact(4)],
      ["Finance:income:same", fact(5)],
    ]);
    const result = buildFounderFocus(projected);
    expect(result.map(({ urgencyTime }) => urgencyTime)).toEqual([1, 2, 3, 4, 5, null, null]);
  });

  it("retains signal Map keys, Set ordering, cluster order and constituent order in narrow DTOs", () => {
    const first = { ...signal({ recordKey: "different-record-key" }), signals: new Set(["stale record", "blocked", "stale record", "no valid owner"]) };
    const second = { ...signal({ recordKey: "Project:p", objectType: "Project", id: "p" }), signals: new Set(["no execution path"]) };
    const projected = projectPageInput({
      correlationLayer: {
        signalled: new Map([["external-key", first], ["Project:p", second]]),
        convergentRisks: [
          { ...cluster({ clusterKey: "cluster:first", records: [second, first] }), categories: new Set(["no execution path", "blocked", "no execution path", "stale record"]) },
          { ...cluster({ clusterKey: "cluster:second", records: [first] }), categories: new Set(["stale record"]) },
        ],
      },
    });
    expect(projected.signalledRecords.map(({ recordKey, signals }) => [recordKey, signals])).toEqual([
      ["external-key", ["stale record", "blocked", "no valid owner"]],
      ["Project:p", ["no execution path"]],
    ]);
    expect(projected.convergentRisks.map(({ clusterKey, records, categories }) => [
      clusterKey, records.map(({ recordKey }) => recordKey), categories,
    ])).toEqual([
      ["cluster:first", ["Project:p", "different-record-key"], ["no execution path", "blocked", "stale record"]],
      ["cluster:second", ["different-record-key"], ["stale record"]],
    ]);
    expect(projected.convergentRisks[0].records[0]).not.toHaveProperty("signals");
  });

  it("preserves review and limitation source order so later equal-strength metadata wins", () => {
    const projected = projectPageInput({
      empireDecisionQueue: {
        founderReviewQueue: [
          review({ title: "First review" }),
          review({ title: "Last review", whyItMatters: "Last evidence" }),
        ],
      },
      strategicDataConfidence: {
        limitations: [
          limitation({ label: "First limitation" }),
          limitation({ label: "Last limitation" }),
        ],
      },
    });
    expect(projected.founderReviewItems.map(({ title }) => title)).toEqual(["First review", "Last review"]);
    expect(projected.limitations.map(({ label }) => label)).toEqual(["First limitation", "Last limitation"]);
    expect(buildFounderFocus(projected).map(({ title, reason }) => [title, reason])).toEqual([
      ["Last review", "Review due: Last evidence"],
      ["Last limitation", "Strategic data confidence material — Last limitation."],
    ]);
  });
});

function strategicRisk(overrides: Partial<FounderFocusStrategicRiskInput> = {}): FounderFocusStrategicRiskInput {
  return {
    key: "Icarus:risk-1",
    objectType: "Icarus",
    id: "risk-1",
    title: "Excavation margin collapses",
    area: "Excavation",
    band: 3,
    score: 320,
    reason: "Icarus strategic risk (pillar linked) — Fuel costs are not repriced.",
    anchorRecordKeys: [],
    referenceKey: "icarus-assessment:risk-1",
    ...overrides,
  };
}

describe("Founder Focus strategic (Icarus) risk integration", () => {
  it("leaves existing output unchanged when strategic risks are absent or empty", () => {
    const source = input({ signalledRecords: [signal(), signal({ recordKey: "Project:p", objectType: "Project", id: "p", signals: ["no execution path"] })] });
    const baseline = buildFounderFocus(source);
    expect(buildFounderFocus({ ...source, strategicRisks: [] })).toEqual(baseline);
    baseline.forEach((candidate) => expect(candidate).not.toHaveProperty("strategicRiskKeys"));
  });

  it("adds an unanchored strategic risk as its own traceable candidate without urgency", () => {
    expect(buildFounderFocus(input({ strategicRisks: [strategicRisk()] }))).toEqual([{
      key: "Icarus:risk-1",
      objectType: "Icarus",
      id: "risk-1",
      title: "Excavation margin collapses",
      area: "Excavation",
      score: 320,
      band: 3,
      urgencyTime: null,
      reason: "Icarus strategic risk (pillar linked) — Fuel costs are not repriced.",
      strategicRiskKeys: ["icarus-assessment:risk-1"],
    }]);
  });

  it("enriches an anchored candidate rather than duplicating it, keeping the stronger band and score", () => {
    const source = input({
      signalledRecords: [signal({ signals: ["blocked"], baseScore: 200 })],
      recordFacts: new Map([["Action:a", fact(5)]]),
    });
    const [original] = buildFounderFocus(source);
    const result = buildFounderFocus({ ...source, strategicRisks: [strategicRisk({ anchorRecordKeys: ["Action:a"] })] });
    expect(result).toEqual([{
      ...original,
      band: 2,
      score: 320,
      reason: `${original.reason} Also: Icarus strategic risk (pillar linked) — Fuel costs are not repriced.`,
      strategicRiskKeys: ["icarus-assessment:risk-1"],
    }]);
  });

  it("raises a structural candidate's band to the risk band when the risk is more material", () => {
    const result = buildFounderFocus(input({
      signalledRecords: [signal({ signals: ["no execution path"], baseScore: 400 })],
      strategicRisks: [strategicRisk({ anchorRecordKeys: ["Action:a"] })],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ key: "Action:a", band: 3, score: 400 });
  });

  it("resolves anchors absorbed into a convergent cluster onto the cluster candidate", () => {
    const result = buildFounderFocus(input({
      convergentRisks: [cluster()],
      strategicRisks: [strategicRisk({ anchorRecordKeys: ["Project:p"] })],
    }));
    expect(result.map((candidate) => candidate.key)).toEqual(["cluster:Action:a"]);
    expect(result[0].strategicRiskKeys).toEqual(["icarus-assessment:risk-1"]);
  });

  it("chooses the strongest anchored candidate when a risk links several records", () => {
    const result = buildFounderFocus(input({
      signalledRecords: [
        signal({ recordKey: "Problem:x", objectType: "Problem", id: "x", signals: ["no execution path"], baseScore: 100 }),
        signal({ signals: ["overdue"], baseScore: 50 }),
      ],
      strategicRisks: [strategicRisk({ anchorRecordKeys: ["Problem:x", "Action:a"] })],
    }));
    expect(result.find((candidate) => candidate.key === "Action:a")?.strategicRiskKeys).toEqual(["icarus-assessment:risk-1"]);
    expect(result.find((candidate) => candidate.key === "Problem:x")?.strategicRiskKeys).toBeUndefined();
  });

  it("suppresses duplicate references while accumulating distinct risks on the same anchor", () => {
    const first = strategicRisk({ anchorRecordKeys: ["Action:a"] });
    const second = strategicRisk({ key: "Icarus:risk-2", id: "risk-2", referenceKey: "icarus-assessment:risk-2", reason: "Second risk.", anchorRecordKeys: ["Action:a"] });
    const result = buildFounderFocus(input({ signalledRecords: [signal()], strategicRisks: [first, first, second] }));
    expect(result).toHaveLength(1);
    expect(result[0].strategicRiskKeys).toEqual(["icarus-assessment:risk-1", "icarus-assessment:risk-2"]);
    expect(result[0].reason.match(/Also:/g)).toHaveLength(2);
    expect(buildFounderFocus(input({ strategicRisks: [strategicRisk(), strategicRisk()] }))).toHaveLength(1);
  });

  it("competes below founder authority and blocked work, above structural gaps, deterministically", () => {
    const source = input({
      signalledRecords: [
        signal({ recordKey: "Decision:d", objectType: "Decision", id: "d", signals: ["founder authority"], baseScore: 100 }),
        signal({ signals: ["blocked"], baseScore: 100 }),
        signal({ recordKey: "Project:p", objectType: "Project", id: "p", signals: ["no execution path"], baseScore: 900 }),
      ],
      strategicRisks: [
        strategicRisk({ key: "Icarus:unverified", id: "unverified", referenceKey: "icarus-assessment:unverified", band: 5, score: 240 }),
        strategicRisk(),
      ],
    });
    const first = buildFounderFocus(source);
    expect(first.map((candidate) => candidate.key)).toEqual(["Decision:d", "Action:a", "Icarus:risk-1", "Project:p", "Icarus:unverified"]);
    expect(buildFounderFocus({ ...source, strategicRisks: [...(source.strategicRisks ?? [])].reverse() })).toEqual(first);
  });

  it("flows into the Founder Operating Brief so strategic risks can reach Do now", () => {
    const candidates = buildFounderFocus(input({ strategicRisks: [strategicRisk()] }));
    const brief = buildFounderOperatingBrief({
      focusCandidates: candidates,
      delegateItems: [],
      reviewItems: [],
      actions: [],
      projects: [],
      activeLeads: [],
      decisions: [],
      opportunities: [],
      nowMs: 0,
      startOfTodayMs: 0,
    });
    expect(brief.doNow).toEqual([{
      id: "risk-1",
      objectType: "Icarus",
      title: "Excavation margin collapses",
      area: "Excavation",
      why: "Icarus strategic risk (pillar linked) — Fuel costs are not repriced.",
    }]);
  });
});

describe("Founder Focus page projection of Icarus strategic risks", () => {
  it("projects the page's Icarus strategic signals through the shared adapter", () => {
    const signal: IcarusStrategicSignal = {
      key: "icarus-assessment:a1",
      assessmentId: "a1",
      outcome: "Outcome",
      status: "Open",
      exposure: "Exposed",
      materialityTier: "Material",
      scope: "Pillar",
      area: "Excavation",
      operatingPillars: [{ id: "excavation", label: "Excavation" }],
      strategicThemes: [],
      strategicLinks: [{ recordType: "Pillar", recordId: "Excavation" }],
      relationships: [],
      anchors: [{ objectType: "Action", id: "a" }],
      materialFailureModes: [],
      weaknesses: [],
      hasOverdueControlReview: false,
      riskScore: 170,
      primaryReference: { identityKey: "icarus-assessment:a1", assessmentId: "a1" },
      summary: "Summary",
    };
    expect(projectPageInput().strategicRisks).toEqual([]);
    expect(projectPageInput({ icarusStrategicSignals: [signal] }).strategicRisks).toEqual(buildIcarusFounderFocusRisks([signal]));
  });
});

describe("Founder Focus correlation-native Icarus risks", () => {
  const icarusRecord = signal({
    recordKey: "Icarus:risk-1",
    objectType: "Icarus",
    id: "risk-1",
    title: "Excavation margin collapses",
    area: "Excavation",
    signals: ["icarus exposed failure mechanism"],
    baseScore: 900,
  });

  it("keeps the graph's operational root even when a higher-scoring Icarus record joins the cluster", () => {
    const withRoot = buildFounderFocus(input({
      convergentRisks: [cluster({ records: [signal(), icarusRecord], rootRecordKey: "Action:a" })],
    }));
    expect(withRoot.map(({ key, objectType, id }) => [key, objectType, id])).toEqual([["cluster:Action:a", "Action", "a"]]);
    const legacy = buildFounderFocus(input({ convergentRisks: [cluster({ records: [signal(), icarusRecord] })] }));
    expect(legacy[0]).toMatchObject({ objectType: "Icarus", id: "risk-1" });
  });

  it("attaches an Icarus risk that is part of a convergent cluster onto that cluster without anchors", () => {
    const result = buildFounderFocus(input({
      signalledRecords: [signal(), icarusRecord],
      convergentRisks: [cluster({ records: [signal(), icarusRecord], rootRecordKey: "Action:a" })],
      strategicRisks: [strategicRisk({ score: 1000 })],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      key: "cluster:Action:a",
      band: 2,
      score: 1000,
      strategicRiskKeys: ["icarus-assessment:risk-1"],
    });
    expect(result[0].reason).toContain("Also: Icarus strategic risk");
  });

  it("replaces the generic signalled candidate for a non-convergent Icarus record with the authoritative risk", () => {
    const result = buildFounderFocus(input({
      signalledRecords: [icarusRecord],
      strategicRisks: [strategicRisk()],
    }));
    expect(result).toEqual(buildFounderFocus(input({ strategicRisks: [strategicRisk()] })));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ key: "Icarus:risk-1", band: 3, strategicRiskKeys: ["icarus-assessment:risk-1"] });
  });

  it("projects the graph root key from the page adapter", () => {
    const projected = projectPageInput({
      correlationLayer: {
        signalled: new Map(),
        convergentRisks: [{ ...cluster({ rootRecordKey: "Project:p" }), categories: new Set(["blocked"]) }],
      },
    });
    expect(projected.convergentRisks[0].rootRecordKey).toBe("Project:p");
  });
});
