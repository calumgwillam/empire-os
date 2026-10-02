import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  buildFounderOperatingBrief,
  type FounderOperatingBriefInput,
  type FounderOperatingBriefResult,
  type OperatingBriefDomainItem,
  type OperatingBriefRecordInput,
} from "./founder-operating-brief";

const dayMs = 86400000;
const startOfTodayMs = new Date(2026, 9, 2).getTime();
const nowMs = new Date(2026, 9, 2, 12).getTime();

function calendarDate(days: number): string {
  const date = new Date(2026, 9, 2 + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function instant(days: number): string {
  return new Date(nowMs + days * dayMs).toISOString();
}

function input(overrides: Partial<FounderOperatingBriefInput> = {}): FounderOperatingBriefInput {
  return {
    focusCandidates: [],
    delegateItems: [],
    reviewItems: [],
    actions: [],
    projects: [],
    activeLeads: [],
    decisions: [],
    opportunities: [],
    nowMs,
    startOfTodayMs,
    ...overrides,
  };
}

function record(id = "a", overrides: Partial<OperatingBriefRecordInput> = {}): OperatingBriefRecordInput {
  return { id, title: `Work ${id}`, area: "Operations", owner: "Operator", ...overrides };
}

function focus(id: string, overrides: Partial<FounderOperatingBriefInput["focusCandidates"][number]> = {}) {
  return { ...record(id), key: `Action:${id}`, objectType: "Action", reason: `Focus ${id}`, ...overrides };
}

function delegate(id: string, overrides: Partial<FounderOperatingBriefInput["delegateItems"][number]> = {}) {
  return {
    id, objectType: "Action" as const, title: `Delegate ${id}`, pillar: "Operations",
    owner: "Founder", whatIsChanging: "Routine work", whyItMatters: "Fallback reason", ...overrides,
  };
}

function review(id: string, overrides: Partial<FounderOperatingBriefInput["reviewItems"][number]> = {}) {
  return {
    id, kind: "Decision", title: `Review ${id}`, pillar: "Operations",
    owner: "Founder", reasonCategory: "Review due", whyItMatters: "Evidence", ...overrides,
  };
}

function action(id = "a", overrides: Partial<FounderOperatingBriefInput["actions"][number]> = {}) {
  return { ...record(id), isActive: true, isWaiting: false, dueDate: calendarDate(1), ...overrides };
}

function project(id = "p", overrides: Partial<FounderOperatingBriefInput["projects"][number]> = {}) {
  return { ...record(id), isActive: true, status: "Open", targetCompletionDate: calendarDate(1), ...overrides };
}

function lead(id = "l", overrides: Partial<FounderOperatingBriefInput["activeLeads"][number]> = {}) {
  return { ...record(id), status: "New", followUpDate: instant(1), ...overrides };
}

function decision(id = "d", overrides: Partial<FounderOperatingBriefInput["decisions"][number]> = {}) {
  return { ...record(id), isActive: true, reviewDate: instant(1), ...overrides };
}

function opportunity(id = "o", overrides: Partial<FounderOperatingBriefInput["opportunities"][number]> = {}) {
  return { ...record(id), status: "Evaluating", strategicFit: "High", ...overrides };
}

describe("Founder Operating Brief section allocation", () => {
  it("returns the existing four-section empty contract", () => {
    expect(buildFounderOperatingBrief(input())).toEqual({ doNow: [], delegate: [], decide: [], watch: [] });
  });

  it("retains source order and takes three accepted items in each intervention section", () => {
    const result = buildFounderOperatingBrief(input({
      focusCandidates: ["z", "y", "x", "w"].map((id) => focus(id)),
      delegateItems: ["d", "d", "c", "b", "a"].map((id) => delegate(id)),
      reviewItems: ["r4", "r3", "r2", "r1"].map((id) => review(id)),
    }));
    expect(result.doNow.map(({ id }) => id)).toEqual(["z", "y", "x"]);
    expect(result.delegate.map(({ id }) => id)).toEqual(["d", "c", "b"]);
    expect(result.decide.map(({ id }) => id)).toEqual(["r4", "r3", "r2"]);
    expect(result.doNow[0]).toEqual({
      id: "z", objectType: "Action", title: "Work z", area: "Operations", why: "Focus z",
    });
    expect(result.delegate[0]).toEqual({
      id: "d", objectType: "Action", title: "Delegate d", area: "Operations", owner: "Founder", why: "Routine work",
    });
    expect(result.decide[0]).toEqual({
      id: "r4", objectType: "Decision", title: "Review r4", area: "Operations", owner: "Founder", why: "Review due: Evidence",
    });
  });

  it("claims both cluster identity and root record identity without conflating them", () => {
    const result = buildFounderOperatingBrief(input({
      focusCandidates: [
        focus("root", { key: "cluster:one" }),
        focus("root", { key: "cluster:two" }),
        focus("different", { key: "cluster:one" }),
        focus("other"),
      ],
      delegateItems: [delegate("root"), delegate("available")],
      reviewItems: [review("root", { kind: "Action" }), review("remaining")],
    }));
    expect(result.doNow.map(({ id }) => id)).toEqual(["root", "other"]);
    expect(result.delegate.map(({ id }) => id)).toEqual(["available"]);
    expect(result.decide.map(({ id }) => id)).toEqual(["remaining"]);
  });

  it("uses Do Now then Delegate then Decide precedence, but does not claim omitted fourth items", () => {
    const result = buildFounderOperatingBrief(input({
      focusCandidates: ["1", "2", "3", "4"].map((id) => focus(id)),
      delegateItems: [delegate("1"), delegate("4"), delegate("5"), delegate("6"), delegate("7")],
      reviewItems: [
        review("4", { kind: "Action" }),
        review("7", { kind: "Action" }),
        review("1"), review("8"),
      ],
    }));
    expect(result.delegate.map(({ id }) => id)).toEqual(["4", "5", "6"]);
    expect(result.decide.map(({ id, objectType }) => [id, objectType])).toEqual([
      ["7", "Action"], ["1", "Decision"], ["8", "Decision"],
    ]);
  });

  it("deduplicates review records by kind and preserves the first accepted reason", () => {
    const result = buildFounderOperatingBrief(input({
      reviewItems: [review("same"), review("same", { title: "Later", reasonCategory: "Authority required" }), review("same", { kind: "Project" })],
    }));
    expect(result.decide.map(({ title, objectType }) => [title, objectType])).toEqual([
      ["Review same", "Decision"], ["Review same", "Project"],
    ]);
    expect(result.decide[0].why).toBe("Review due: Evidence");
  });

  it("uses the existing truthy delegation-reason fallback without trimming", () => {
    const result = buildFounderOperatingBrief(input({
      delegateItems: [
        delegate("a", { whatIsChanging: "" }),
        delegate("b", { whatIsChanging: " " }),
        delegate("c", { whatIsChanging: "", whyItMatters: "" }),
      ],
    }));
    expect(result.delegate.map(({ why }) => why)).toEqual(["Fallback reason", " ", ""]);
  });

  it("does not impose ownership, founder-authority, or delegation-capacity eligibility beyond upstream queues", () => {
    const result = buildFounderOperatingBrief(input({
      delegateItems: [
        delegate("a", { owner: "" }),
        delegate("p", { objectType: "Project", owner: "Inactive owner" }),
        delegate("l", { objectType: "Lead", owner: "Operator" }),
      ],
      reviewItems: [review("x", { owner: "" })],
    }));
    expect(result.delegate).toHaveLength(3);
    expect(result.delegate.map(({ owner }) => owner)).toEqual(["", "Inactive owner", "Operator"]);
    expect(result.decide[0].owner).toBe("");
  });
});

describe("Founder Operating Brief Watch filtering and claims", () => {
  it("allows Actions to appear in Watch despite earlier claims, while suppressing other claimed record types", () => {
    const result = buildFounderOperatingBrief(input({
      focusCandidates: [focus("a"), focus("p", { objectType: "Project", key: "Project:p" }), focus("o", { objectType: "Opportunity", key: "Opportunity:o" })],
      delegateItems: [delegate("l", { objectType: "Lead" })],
      reviewItems: [review("d")],
      actions: [action()],
      projects: [project()],
      activeLeads: [lead()],
      decisions: [decision()],
      opportunities: [opportunity()],
    }));
    expect(result.watch.map(({ id, objectType }) => [id, objectType])).toEqual([["a", "Action"]]);
  });

  it("trusts authoritative projected active/waiting facts and preserves release-action inclusion", () => {
    const result = buildFounderOperatingBrief(input({
      actions: [action("inactive", { isActive: false }), action("waiting", { isWaiting: true }), action("eligible")],
      projects: [project("inactive", { isActive: false }), project("blocked", { status: " BLOCKED " })],
      decisions: [decision("inactive", { isActive: false })],
    }));
    expect(result.watch.map(({ id }) => id)).toEqual(["eligible"]);
  });

  it.each(["Won", "Lost"])("excludes exact %s leads even with an upcoming date", (status) => {
    expect(buildFounderOperatingBrief(input({ activeLeads: [lead("l", { status })] })).watch).toEqual([]);
  });

  it.each(["New", "Contacted", "Quote Needed", "Quote Sent", "Follow-Up", "On Hold", "won"])("permits %s pipeline leads with upcoming follow-ups", (status) => {
    expect(buildFounderOperatingBrief(input({ activeLeads: [lead("l", { status })] })).watch[0].id).toBe("l");
  });

  const opportunityCases: [string, string, boolean][] = [
    ["Evaluating", "High", true], ["Evaluating", "Exceptional", true],
    ["On Hold", "High", true], ["On Hold", "Exceptional", true],
    ["New", "High", false], ["Approved", "Exceptional", false],
    ["Completed", "High", false], ["Rejected", "High", false],
    ["Evaluating", "Medium", false], ["Evaluating", "Low", false],
    ["evaluating", "High", false], ["Evaluating", "high", false],
  ];
  it.each(opportunityCases)("preserves opportunity status %s / fit %s eligibility", (status, strategicFit, included) => {
    expect(buildFounderOperatingBrief(input({ opportunities: [opportunity("o", { status, strategicFit })] })).watch).toHaveLength(included ? 1 : 0);
  });

  it("does not deduplicate Watch internally, including repeated records and same-type ids", () => {
    const shared = action();
    const result = buildFounderOperatingBrief(input({
      actions: [shared, shared, action("a", { title: "Z later duplicate" })],
    }));
    expect(result.watch.map(({ id }) => id)).toEqual(["a", "a", "a"]);
    expect(result.watch.map(({ title }) => title)).toEqual(["Work a", "Work a", "Z later duplicate"]);
  });

  it("returns an empty brief when all supplied Watch records are filtered", () => {
    expect(buildFounderOperatingBrief(input({
      actions: [action("a", { isWaiting: true })],
      projects: [project("p", { status: "blocked" })],
      activeLeads: [lead("l", { status: "Won" })],
      decisions: [decision("d", { isActive: false })],
      opportunities: [opportunity("o", { strategicFit: "Low" })],
    }))).toEqual({ doNow: [], delegate: [], decide: [], watch: [] });
  });
});

describe("Founder Operating Brief date semantics and reason strings", () => {
  it.each([
    { days: -1, included: false }, { days: 0, included: true },
    { days: 1, included: true }, { days: 14, included: true }, { days: 15, included: false },
  ])("uses local calendar midnight for Actions at day $days", ({ days, included }) => {
    const result = buildFounderOperatingBrief(input({ actions: [action("a", { dueDate: `${calendarDate(days)}T23:59:59Z` })] }));
    expect(result.watch).toHaveLength(included ? 1 : 0);
    if (included) expect(result.watch[0].why).toBe(days === 0
      ? "Due today — review execution momentum"
      : `Due in ${days} day${days === 1 ? "" : "s"} (${calendarDate(days)})`);
  });

  it.each([
    { days: -1, included: false }, { days: 0, included: true },
    { days: 1, included: true }, { days: 21, included: true }, { days: 22, included: false },
  ])("preserves project rounding from current timestamp at day $days", ({ days, included }) => {
    const date = calendarDate(days);
    const result = buildFounderOperatingBrief(input({ projects: [project("p", { targetCompletionDate: date })] }));
    const rounded = Math.round((new Date(`${date}T00:00:00`).getTime() - nowMs) / dayMs);
    expect(result.watch).toHaveLength(included ? 1 : 0);
    if (included) expect(result.watch[0].why).toBe(rounded === 0
      ? "Target completion date is today"
      : `Target completion in ${rounded} day${rounded === 1 ? "" : "s"} (${date})`);
  });

  it("preserves the project's half-day cutoff rather than converting it to action calendar-day rules", () => {
    const date = calendarDate(0);
    const before = buildFounderOperatingBrief(input({ nowMs: startOfTodayMs + dayMs / 2, projects: [project("p", { targetCompletionDate: date })] }));
    const after = buildFounderOperatingBrief(input({ nowMs: startOfTodayMs + dayMs / 2 + 1, projects: [project("p", { targetCompletionDate: date })] }));
    expect(before.watch[0].why).toBe("Target completion date is today");
    expect(after.watch).toEqual([]);
  });

  it.each([
    { days: -0.5, included: true }, { days: -0.500001, included: false },
    { days: 0, included: true }, { days: 1, included: true },
    { days: 14.499, included: true }, { days: 14.5, included: false },
  ])("preserves rounded Lead day-window at offset $days", ({ days, included }) => {
    const date = instant(days);
    const result = buildFounderOperatingBrief(input({ activeLeads: [lead("l", { followUpDate: date })] }));
    expect(result.watch).toHaveLength(included ? 1 : 0);
    const rounded = Math.round(days);
    if (included) expect(result.watch[0].why).toBe(rounded === 0
      ? "Commercial follow-up date is today"
      : `Commercial follow-up in ${rounded} day${rounded === 1 ? "" : "s"} (${date})`);
  });

  it.each([
    { days: -1, included: false }, { days: 0, included: false },
    { days: 0.499, included: false }, { days: 0.5, included: true },
    { days: 1, included: true }, { days: 21.499, included: true }, { days: 21.5, included: false },
  ])("requires rounded Decision days strictly greater than zero at offset $days", ({ days, included }) => {
    const date = instant(days);
    const result = buildFounderOperatingBrief(input({ decisions: [decision("d", { reviewDate: date })] }));
    expect(result.watch).toHaveLength(included ? 1 : 0);
    const rounded = Math.round(days);
    if (included) expect(result.watch[0].why).toBe(`Review date approaching in ${rounded} day${rounded === 1 ? "" : "s"} (${date.slice(0, 10)})`);
  });

  it.each(["", "invalid", "1970-01-01T00:00:00.000Z", "1969-12-31T23:59:59.999Z"])("excludes missing, invalid or out-of-window date %s", (date) => {
    expect(buildFounderOperatingBrief(input({
      actions: [action("a", { dueDate: date })],
      projects: [project("p", { targetCompletionDate: date })],
      activeLeads: [lead("l", { followUpDate: date })],
      decisions: [decision("d", { reviewDate: date })],
    })).watch).toEqual([]);
  });

  it("retains the project full-date append behaviour while Actions slice timestamp dates", () => {
    const timestamp = `${calendarDate(1)}T10:00:00Z`;
    const result = buildFounderOperatingBrief(input({
      actions: [action("a", { dueDate: timestamp })],
      projects: [project("p", { targetCompletionDate: timestamp })],
    }));
    expect(result.watch.map(({ objectType }) => objectType)).toEqual(["Action"]);
  });

  it("uses raw timestamps including offsets for Leads and Decisions", () => {
    const date = "2026-10-03T13:00:00+01:00";
    const fixedNow = Date.UTC(2026, 9, 2, 12);
    const result = buildFounderOperatingBrief(input({
      nowMs: fixedNow,
      activeLeads: [lead("l", { followUpDate: date })],
      decisions: [decision("d", { reviewDate: date })],
    }));
    expect(result.watch.map(({ why }) => why)).toEqual([
      "Review date approaching in 1 day (2026-10-03)",
      `Commercial follow-up in 1 day (${date})`,
    ]);
  });

  it("accepts valid epoch-zero and negative timestamps when they are inside the supplied clock's window", () => {
    for (const timestamp of [0, -dayMs]) {
      const date = new Date(timestamp).toISOString();
      const result = buildFounderOperatingBrief(input({
        nowMs: timestamp - dayMs,
        activeLeads: [lead("l", { followUpDate: date })],
        decisions: [decision("d", { reviewDate: date })],
      }));
      expect(result.watch.map(({ objectType }) => objectType)).toEqual(["Decision", "Lead"]);
      expect(result.watch[0].why).toBe(`Review date approaching in 1 day (${date.slice(0, 10)})`);
      expect(result.watch[1].why).toBe(`Commercial follow-up in 1 day (${date})`);
    }
  });

  it("honours separate explicit clock samples and retains elapsed-millisecond day rounding around DST", () => {
    const result = buildFounderOperatingBrief(input({
      nowMs: startOfTodayMs + 2 * dayMs,
      startOfTodayMs: startOfTodayMs + 60 * 60 * 1000,
      actions: [action("a", { dueDate: calendarDate(1) })],
      activeLeads: [lead("l", { followUpDate: new Date(startOfTodayMs + dayMs).toISOString() })],
    }));
    expect(result.watch.map(({ id }) => id)).toEqual(["a"]);
    expect(result.watch[0].why).toBe(`Due in 1 day (${calendarDate(1)})`);
  });

  it("preserves opportunity wording and truthy owner defaults without trimming", () => {
    const result = buildFounderOperatingBrief(input({
      opportunities: [
        opportunity("e", { owner: "", status: "On Hold", strategicFit: "Exceptional" }),
        opportunity("h", { owner: " " }),
      ],
    }));
    expect(result.watch).toEqual([
      { ...record("e"), objectType: "Opportunity", owner: "Unassigned", why: "Exceptional strategic-fit opportunity currently on hold — watch for timing trigger" },
      { ...record("h"), objectType: "Opportunity", owner: " ", why: "High strategic-fit opportunity currently evaluating — watch for timing trigger" },
    ]);
  });
});

describe("Founder Operating Brief Watch ordering", () => {
  it("ranks urgency before title and opportunity fit urgency is exactly five or ten days", () => {
    const result = buildFounderOperatingBrief(input({
      actions: [action("later", { title: "A later", dueDate: calendarDate(11) })],
      activeLeads: [lead("soon", { title: "Z soon", followUpDate: instant(1) })],
      opportunities: [opportunity("high", { title: "A high" }), opportunity("exceptional", { title: "Z exceptional", strategicFit: "Exceptional" })],
    }));
    expect(result.watch.map(({ id }) => id)).toEqual(["soon", "exceptional", "high"]);
  });

  it("uses localeCompare title ties and preserves source-family order for exact ties", () => {
    const result = buildFounderOperatingBrief(input({
      actions: [action("a", { title: "Same", dueDate: calendarDate(0) })],
      projects: [project("p", { title: "Same", targetCompletionDate: calendarDate(0) })],
      activeLeads: [lead("l", { title: "Same", followUpDate: instant(0) })],
    }));
    expect(result.watch.map(({ objectType }) => objectType)).toEqual(["Action", "Project", "Lead"]);
    const titles = ["z", "Z", "a", "A"];
    const sorted = buildFounderOperatingBrief(input({
      actions: titles.map((title) => action(title, { title })),
    }));
    expect(sorted.watch.map(({ title }) => title)).toEqual([...titles].sort((a, b) => a.localeCompare(b)).slice(0, 3));
  });

  it("preserves lead-before-decision-before-opportunity insertion on equal urgency and title", () => {
    const result = buildFounderOperatingBrief(input({
      activeLeads: [lead("l", { title: "Same", followUpDate: instant(5) })],
      decisions: [decision("d", { title: "Same", reviewDate: instant(5) })],
      opportunities: [opportunity("o", { title: "Same", strategicFit: "Exceptional" })],
    }));
    expect(result.watch.map(({ objectType }) => objectType)).toEqual(["Lead", "Decision", "Opportunity"]);
  });

  it("only earlier sections claim identities; Watch leaves repeated Projects and Opportunities intact", () => {
    const result = buildFounderOperatingBrief(input({
      projects: [project("p"), project("p")],
      opportunities: [opportunity("o", { strategicFit: "Exceptional" }), opportunity("o", { strategicFit: "Exceptional" })],
    }));
    expect(result.watch.map(({ id }) => id)).toEqual(["p", "p", "o"]);
  });

  it("preserves blank watch titles, areas, and action owners without inventing data", () => {
    const result = buildFounderOperatingBrief(input({ actions: [action("a", { title: "", area: "", owner: "" })] }));
    expect(result.watch[0]).toMatchObject({ title: "", area: "", owner: "" });
  });
});

type PageWatchRecord = {
  id: string;
  title?: string;
  actionTitle?: string;
  projectName?: string;
  leadName?: string;
  decisionTitle?: string;
  opportunityTitle?: string;
  owner?: string;
  ownerPersonId?: string;
  decisionMaker?: string;
  status?: string;
  decisionStatus?: string;
  strategicFit?: string;
  dueDate?: string;
  targetCompletionDate?: string;
  followUpDate?: string;
  reviewDate?: string;
  relatedPillar?: string;
  relatedArea?: string;
  area?: string;
};
type BriefUiItem = OperatingBriefDomainItem & {
  onOpen: () => void;
  delegateAction?: (personId: string) => void;
  eligibleDelegationPeople?: { id: string; name: string }[];
};
type BriefUiResult = { doNow: BriefUiItem[]; delegate: BriefUiItem[]; decide: BriefUiItem[]; watch: BriefUiItem[] };

function pageBrief(overrides: {
  founderFocusCandidates?: FounderOperatingBriefInput["focusCandidates"];
  empireDecisionQueue?: {
    delegateItems: FounderOperatingBriefInput["delegateItems"];
    founderReviewQueue: (FounderOperatingBriefInput["reviewItems"][number] & { objectType?: string })[];
  };
  actionRecords?: PageWatchRecord[];
  projects?: PageWatchRecord[];
  activeLeads?: PageWatchRecord[];
  decisionRecords?: PageWatchRecord[];
  opportunityRecords?: PageWatchRecord[];
  people?: { id: string; name: string; status: string }[];
} = {}) {
  const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
  const section = (start: string, end: string) => {
    const first = page.indexOf(start);
    const last = page.indexOf(end, first);
    if (first < 0 || last < 0) throw new Error(`Missing operating brief adapter boundary: ${start}`);
    return page.slice(first, last);
  };
  const source = [
    section("function isActionWaiting(", "\nconst personStatusOptions"),
    section("function getActionOwnerDisplay(", "function getActionOwnerValue("),
    section("  const getAreaText =", "  const getDateValue ="),
    section("  const isActionActive =", "  const isReleaseInterventionAction ="),
    section("  const isDecisionActive =", "  const isDecisionReviewDue ="),
    section("  const isProjectActive =", "  const delegationReadiness ="),
    section("  const founderOperatingBrief =", "  const todayBrief ="),
    "result = founderOperatingBrief;",
  ].join("\n");
  const { outputText } = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2020, module: ModuleKind.ESNext },
  });
  class BriefDate extends Date {
    constructor(value?: string | number) {
      super(value === undefined ? nowMs : value);
    }
    static now() { return nowMs; }
  }
  const onOpen = vi.fn();
  const onDelegate = vi.fn();
  const capacity = [{ id: "operator", name: "Operator" }];
  const rankCapacity = vi.fn(() => capacity);
  let projected: FounderOperatingBriefInput | undefined;
  const context: { result: BriefUiResult | undefined } = { result: undefined };
  runInNewContext(outputText, Object.assign(context, {
    Date: BriefDate,
    founderFocusCandidates: [],
    empireDecisionQueue: { delegateItems: [], founderReviewQueue: [] },
    actionRecords: [],
    projects: [],
    activeLeads: [],
    decisionRecords: [],
    opportunityRecords: [],
    people: [],
    ...overrides,
    buildFounderOperatingBrief: (value: FounderOperatingBriefInput) => {
      projected = value;
      return buildFounderOperatingBrief(value);
    },
    handleOpenAttentionRecord: onOpen,
    handleDelegateItem: onDelegate,
    getCapacityRankedDelegationPeopleForArea: rankCapacity,
  }), { timeout: 1000 });
  if (!context.result || !projected) throw new Error("Operating brief adapter did not produce a brief");
  return { result: context.result, projected, onOpen, onDelegate, rankCapacity, capacity };
}

describe("Founder Operating Brief page adapter", () => {
  it("attaches navigation and delegation callbacks only in the page, preserving root and review-kind targets", () => {
    const page = pageBrief({
      founderFocusCandidates: [focus("root", { key: "cluster:Action:root" })],
      empireDecisionQueue: {
        delegateItems: [delegate("p", { objectType: "Project", pillar: "Garden" })],
        founderReviewQueue: [{ ...review("d"), kind: "Decision", objectType: "Project" }],
      },
      actionRecords: [{ id: "a", status: "Open", actionTitle: "Watch action", dueDate: calendarDate(1) }],
    });
    page.result.doNow[0].onOpen();
    page.result.delegate[0].onOpen();
    page.result.delegate[0].delegateAction?.("operator");
    page.result.decide[0].onOpen();
    page.result.watch[0].onOpen();
    expect(page.onOpen.mock.calls).toEqual([["Action", "root"], ["Project", "p"], ["Decision", "d"], ["Action", "a"]]);
    expect(page.onDelegate).toHaveBeenCalledWith("Project", "p", "operator");
    expect(page.rankCapacity.mock.calls).toEqual([["Garden"]]);
    expect(page.result.delegate[0].eligibleDelegationPeople).toBe(page.capacity);
    expect(page.result.doNow[0]).not.toHaveProperty("delegateAction");
    expect(page.result.watch[0]).not.toHaveProperty("eligibleDelegationPeople");
    expect(page.projected.nowMs).toBe(nowMs);
    expect(page.projected.startOfTodayMs).toBe(startOfTodayMs);
  });

  it("performs capacity lookup only for the three accepted delegation items", () => {
    const page = pageBrief({
      founderFocusCandidates: [focus("claimed")],
      empireDecisionQueue: {
        delegateItems: [delegate("claimed"), delegate("1"), delegate("1"), delegate("2"), delegate("3"), delegate("4")],
        founderReviewQueue: [],
      },
    });
    expect(page.result.delegate.map(({ id }) => id)).toEqual(["1", "2", "3"]);
    expect(page.rankCapacity).toHaveBeenCalledTimes(3);
  });

  it("projects authoritative action owner display, active/waiting filters, title fallback and area precedence", () => {
    const page = pageBrief({
      people: [
        { id: "active", name: "Resolved name", status: "Active" },
        { id: "inactive", name: "Former name", status: "Inactive" },
      ],
      actionRecords: [
        { id: "a", status: "Open", owner: "Stale text", ownerPersonId: "active", title: "Fallback", relatedPillar: "Pillar", relatedArea: "Area", dueDate: calendarDate(1) },
        { id: "b", status: "Waiting", owner: "  Legacy  ", ownerPersonId: "inactive", actionTitle: "Waiting", dueDate: calendarDate(1) },
        { id: "c", status: "Completed", owner: "", title: "Completed", dueDate: calendarDate(1) },
      ],
    });
    expect(page.projected.actions.map(({ title, owner, isActive, isWaiting, area }) => [title, owner, isActive, isWaiting, area])).toEqual([
      ["Fallback", "Resolved name", true, false, "Pillar"],
      ["Waiting", "Legacy", true, true, ""],
      ["Completed", "Unassigned", false, false, ""],
    ]);
    expect(page.result.watch.map(({ id }) => id)).toEqual(["a"]);
    expect(page.projected.actions[0]).not.toHaveProperty("ownerPersonId");
  });

  it("keeps project and decision active rules upstream and preserves the supplied activeLeads order", () => {
    const page = pageBrief({
      projects: [
        { id: "p", status: "Completed", projectName: "Closed", owner: "", area: "", targetCompletionDate: calendarDate(1) },
        { id: "unknown", status: "Unknown", projectName: "Legacy", owner: "", area: "", targetCompletionDate: calendarDate(1) },
      ],
      activeLeads: [
        { id: "l2", leadName: "Z lead", owner: "", status: "New", relatedPillar: "", followUpDate: instant(1) },
        { id: "l1", leadName: "A lead", owner: "", status: "Won", relatedPillar: "", followUpDate: instant(1) },
      ],
      decisionRecords: [
        { id: "d", decisionStatus: "Completed", title: "Closed", reviewDate: instant(1) },
        { id: "draft", decisionStatus: "Draft", title: "Draft fallback", decisionMaker: "", relatedArea: "Area", reviewDate: instant(1) },
      ],
    });
    expect(page.projected.projects.map(({ isActive }) => isActive)).toEqual([false, true]);
    expect(page.projected.decisions.map(({ isActive }) => isActive)).toEqual([false, true]);
    expect(page.projected.activeLeads.map(({ id }) => id)).toEqual(["l2", "l1"]);
    expect(page.result.watch.map(({ id }) => id)).toEqual(["draft", "unknown", "l2"]);
    expect(page.result.watch.map(({ owner }) => owner)).toEqual(["Unassigned", "Unassigned", "Unassigned"]);
  });

  it("projects opportunity title fallback, blank area, and review kind without UI data", () => {
    const page = pageBrief({
      opportunityRecords: [{ id: "o", opportunityTitle: "", title: "Fallback opportunity", owner: "", status: "On Hold", strategicFit: "Exceptional" }],
    });
    expect(page.projected.opportunities[0]).toEqual({
      id: "o", title: "Fallback opportunity", area: "", owner: "", status: "On Hold", strategicFit: "Exceptional",
    });
    expect(page.result.watch[0]).toMatchObject({ title: "Fallback opportunity", area: "", owner: "Unassigned" });
  });

  it("retains first active owner-id matching and ordered duplicate source records", () => {
    const page = pageBrief({
      people: [
        { id: "p", name: "Inactive duplicate", status: "Inactive" },
        { id: "p", name: "First active duplicate", status: "Active" },
        { id: "p", name: "Later active duplicate", status: "Active" },
      ],
      actionRecords: [
        { id: "same", status: "Open", ownerPersonId: "p", actionTitle: "Same", dueDate: calendarDate(1) },
        { id: "same", status: "Open", owner: " Legacy ", actionTitle: "Same", dueDate: calendarDate(1) },
      ],
    });
    expect(page.projected.actions.map(({ owner }) => owner)).toEqual(["First active duplicate", "Legacy"]);
    expect(page.result.watch.map(({ id, owner }) => [id, owner])).toEqual([
      ["same", "First active duplicate"], ["same", "Legacy"],
    ]);
  });

  it("retains supplied collection order and does not mutate upstream records during projection", () => {
    const source = {
      founderFocusCandidates: [focus("b"), focus("a")],
      empireDecisionQueue: { delegateItems: [delegate("d")], founderReviewQueue: [review("r")] },
      actionRecords: [{ id: "w", actionTitle: "Watch", owner: " Operator ", status: "Open", dueDate: calendarDate(1) }],
    };
    const before = structuredClone(source);
    const page = pageBrief(source);
    expect(page.projected.focusCandidates.map(({ id }) => id)).toEqual(["b", "a"]);
    expect(page.result.doNow.map(({ id }) => id)).toEqual(["b", "a"]);
    expect(source).toEqual(before);
    expect(page.onOpen).not.toHaveBeenCalled();
    expect(page.onDelegate).not.toHaveBeenCalled();
  });
});

describe("Founder Operating Brief determinism and non-mutation", () => {
  it("does not mutate any input collection or record and returns detached, callback-free result items", () => {
    const source = input({
      focusCandidates: [focus("focus")],
      delegateItems: [delegate("delegate")],
      reviewItems: [review("review")],
      actions: [action()],
      projects: [project()],
      activeLeads: [lead()],
      decisions: [decision()],
      opportunities: [opportunity()],
    });
    const before = structuredClone(source);
    for (const records of [
      source.focusCandidates, source.delegateItems, source.reviewItems, source.actions,
      source.projects, source.activeLeads, source.decisions, source.opportunities,
    ]) {
      records.forEach(Object.freeze);
      Object.freeze(records);
    }
    Object.freeze(source);
    const first: FounderOperatingBriefResult = buildFounderOperatingBrief(source);
    expect(buildFounderOperatingBrief(source)).toEqual(first);
    expect(source).toEqual(before);
    for (const items of Object.values(first)) {
      items.forEach((item) => {
        expect(item).not.toHaveProperty("onOpen");
        expect(item).not.toHaveProperty("delegateAction");
        expect(item).not.toHaveProperty("eligibleDelegationPeople");
      });
    }
    first.doNow[0].title = "Changed result";
    first.watch.reverse();
    expect(buildFounderOperatingBrief(source).doNow[0].title).toBe("Work focus");
    expect(source).toEqual(before);
  });
});
