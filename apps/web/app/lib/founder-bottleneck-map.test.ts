import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  buildFounderBottleneckMap,
  isFounderBottleneckBlockedAction,
  isFounderBottleneckExecutionProject,
  type FounderBottleneckMapInput as Input,
  type FounderBottleneckMapResult as Result,
} from "./founder-bottleneck-map";
import {
  getActionDependencyBlocker as getActionDependencyBlockerRule,
  getDelegationReadinessMissingFields,
  isFounderOwned as isFounderOwnedRule,
  rankDelegationPeopleForArea,
  type DelegationPersonInput,
  type DependencyDecisionInput,
  type DependencyProblemInput,
} from "./execution-release";
import { getEffectiveProjectHealth, isProjectReviewDue, isProjectReviewFuture, type ProjectRecord } from "./projects";

function input(overrides: Partial<Input> = {}): Input {
  return {
    reviewItems: [], retainedProjects: [], opportunities: [], decisionsWithoutExecution: [],
    blockedActions: [], overdueActions: [], executionProjects: [], convergentRisks: [],
    learningGaps: [], routineDelegateItems: [], activeOperationalPeopleCount: 1,
    delegationReadyPeopleCount: 1, teamReadinessGaps: [], cofounderReadinessGaps: [],
    delegationReadinessGaps: [], ...overrides,
  };
}
function record(id: string, title = id) { return { id, title, area: "Garden", owner: "Founder" }; }
function review(id: string, overrides: Partial<Input["reviewItems"][number]> = {}): Input["reviewItems"][number] {
  return { id, title: id, kind: "Decision", pillar: "Garden", owner: "Founder", reasonCategory: "Review due", whyItMatters: "Evidence", ...overrides };
}
function blocked(id: string, overrides: Partial<Input["blockedActions"][number]> = {}): Input["blockedActions"][number] {
  return { ...record(id), isBlocked: true, isFounderOwned: true, dependencyReason: null, ...overrides };
}
function project(id: string, overrides: Partial<Input["executionProjects"][number]> = {}): Input["executionProjects"][number] {
  return { ...record(id), health: "Blocked", reviewDue: false, reviewFuture: false, ...overrides };
}
function delegate(id: string, overrides: Partial<Input["routineDelegateItems"][number]> = {}): Input["routineDelegateItems"][number] {
  return { id, title: id, objectType: "Action", pillar: "Garden", owner: "Founder", capacityRankedNames: [], ...overrides };
}
function cluster(key: string, id: string, overrides: Partial<Input["convergentRisks"][number]> = {}): Input["convergentRisks"][number] {
  return { clusterKey: key, title: key, root: { id, objectType: "Problem", area: "Garden" }, categoryCount: 3, recordCount: 4, ...overrides };
}
function gap(id: string, overrides: Partial<Input["learningGaps"][number]> = {}): Input["learningGaps"][number] {
  return { ...record(id), severity: "High", frequency: "Recurring", ...overrides };
}

describe("Founder Bottleneck Map authority and execution policy", () => {
  it("retains the empty summary and callback-free consumer data", () => {
    expect(buildFounderBottleneckMap(input())).toEqual({
      summary: {
        headline: "No structural founder bottlenecks are currently detected.",
        totalCount: 0, criticalCount: 0, materialCount: 0, emergingCount: 0, topCategoryText: "None",
      },
      bottlenecks: [],
    });
  });

  it.each([
    ["Critical escalation", "Critical", "Issue formal founder decision or strategic approval to establish baseline."],
    ["Authority required", "Critical", "Issue formal founder decision or strategic approval to establish baseline."],
    ["Blocked project decision", "Critical", "Provide explicit founder decision or scope approval to unblock project delivery."],
    ["Review due", "Material", "Complete formal decision review, record actual outcome and rating."],
    ["Under review", "Material", "Issue formal founder decision or strategic approval to establish baseline."],
    ["Unrecognised reason", "Material", "Issue formal founder decision or strategic approval to establish baseline."],
  ])("preserves authority reason %s", (reasonCategory, severity, releasePath) => {
    expect(buildFounderBottleneckMap(input({ reviewItems: [review("d", { reasonCategory })] })).bottlenecks).toEqual([{
      ...record("d"), category: "Authority", objectType: "Decision", severity,
      why: `${reasonCategory}: Evidence`, releasePath,
    }]);
  });

  it("uses the projected first founder objective, with raw project owner and title", () => {
    const result = buildFounderBottleneckMap(input({
      retainedProjects: [{ ...record("p", ""), owner: "", founderObjectiveTitle: "First objective" }],
    }));
    expect(result.bottlenecks[0]).toEqual({
      ...record("p", "Founder-retained project: "), owner: "", category: "Authority", objectType: "Project", severity: "Material",
      why: "Linked to active Strategic Objective 'First objective', explicitly allocated to founder attention.",
      releasePath: "Retain under founder authority while this Strategic Objective requires founder attention.",
    });
  });

  it("only admits evaluating High/Exceptional opportunities without any settled decision", () => {
    const opportunities: Input["opportunities"] = [
      { ...record("high"), status: "Evaluating", strategicFit: "High", hasSettledDecision: false, owner: "" },
      { ...record("exceptional"), status: "Evaluating", strategicFit: "Exceptional", hasSettledDecision: false, owner: " " },
      { ...record("settled"), status: "Evaluating", strategicFit: "Exceptional", hasSettledDecision: true },
      { ...record("approved"), status: "Approved", strategicFit: "High", hasSettledDecision: false },
      { ...record("low"), status: "Evaluating", strategicFit: "Low", hasSettledDecision: false },
    ];
    const items = buildFounderBottleneckMap(input({ opportunities })).bottlenecks;
    expect(items.map(({ id, severity, owner }) => [id, severity, owner])).toEqual([
      ["exceptional", "Critical", " "], ["high", "Material", "Unassigned"],
    ]);
    expect(items[1].why).toBe("High strategic-fit opportunity ('high') remains evaluating without a settled founder decision.");
    expect(items[1].releasePath).toBe("Review strategic alignment and issue formal founder approval decision.");
  });

  it("preserves execution-path wording and does not invent owner or area values", () => {
    expect(buildFounderBottleneckMap(input({ decisionsWithoutExecution: [{ id: "d", title: "", area: "", owner: "" }] })).bottlenecks[0]).toEqual({
      id: "d", title: "", area: "", owner: "", objectType: "Decision", category: "Execution", severity: "Material",
      why: "Active decision '' has no direct or project-mediated execution path, stalling implementation.",
      releasePath: "Create or link an active Action or Project to establish an executable path.",
    });
  });

  it.each([
    [true, true, null, true],
    [false, true, null, false],
    [true, false, null, false],
    [false, false, "WAITING ON DECISION: Scope", true],
    [false, false, "BLOCKED BY PROBLEM: Root", false],
    [false, true, "BLOCKED BY PROBLEM: Root", true],
    [true, false, " WAITING ON DECISION: Scope", false],
    [false, true, "", true],
  ] as const)("preserves blocker eligibility (%s, %s, %s)", (isBlocked, isFounderOwned, dependencyReason, expected) => {
    const action = blocked("a", { isBlocked, isFounderOwned, dependencyReason });
    expect(isFounderBottleneckBlockedAction(action)).toBe(expected);
    expect(buildFounderBottleneckMap(input({ blockedActions: [action] })).bottlenecks).toHaveLength(expected ? 1 : 0);
  });

  it("uses dependency wording ahead of explicit Blocked status, replacing each prefix only once", () => {
    const items = buildFounderBottleneckMap(input({
      blockedActions: [
        blocked("a", { dependencyReason: "BLOCKED BY PROBLEM: Root WAITING ON DECISION: Scope BLOCKED BY PROBLEM: tail" }),
        blocked("b"),
      ],
    })).bottlenecks;
    expect(items[0].why).toBe("Action 'a' is blocked by an upstream dependency (Root Scope BLOCKED BY PROBLEM: tail).");
    expect(items[0].releasePath).toBe("Resolve the upstream dependency to clear the execution blocker.");
    expect(items[1].why).toBe("Action 'b' is blocked, preventing downstream operational progress.");
    expect(items[1].releasePath).toBe("Remove operational blocker or re-sequence work.");
  });

  it("honours the sampled overdue fact rather than reparsing dates or reading a clock", () => {
    const items = buildFounderBottleneckMap(input({
      overdueActions: [
        { ...record("a"), dueDate: "2026-10-01T23:00:00-04:00", isOverdue: true },
        { ...record("invalid"), dueDate: "not-a-date", isOverdue: false },
        { ...record("future"), dueDate: "2999-01-01", isOverdue: true },
        { ...record("equal"), dueDate: "2026-10-02", isOverdue: false },
      ],
    })).bottlenecks;
    expect(items.map(({ id }) => id)).toEqual(["a", "future"]);
    expect(items[0].why).toBe("Founder-owned action 'a' is overdue (due 2026-10-01), creating execution drag.");
    expect(items[0].releasePath).toBe("Complete execution or reassign to an operational owner in People.");
  });

  it.each([
    ["Waiting", true, true, false],
    ["Waiting", true, false, true],
    ["Waiting", false, false, false],
    ["Blocked", false, true, true],
    ["On track", true, true, true],
    ["On track", false, false, false],
  ])("honours project health/review facts (%s, %s, %s)", (health, reviewDue, reviewFuture, expected) => {
    const value = project("p", { health: health as string, reviewDue: reviewDue as boolean, reviewFuture: reviewFuture as boolean });
    expect(isFounderBottleneckExecutionProject(value)).toBe(expected);
    expect(buildFounderBottleneckMap(input({ executionProjects: [value] })).bottlenecks).toHaveLength(expected ? 1 : 0);
  });

  it("preserves blocked project punctuation, review date text and owner fallback", () => {
    const items = buildFounderBottleneckMap(input({ executionProjects: [
      project("a", { reviewNote: "", owner: "" }),
      project("b", { reviewNote: " ", owner: " " }),
      project("c", { health: "At risk", reviewDue: true, nextReviewDate: "2026-10-02T08:00:00Z" }),
      project("d", { health: "On track", reviewDue: true }),
    ] })).bottlenecks;
    expect(items.map(({ severity, owner, why }) => [severity, owner, why])).toEqual([
      ["Critical", "Unassigned", "Project 'a' is blocked."],
      ["Critical", " ", "Project 'b' is blocked: " + " "],
      ["Material", "Founder", "Project 'c' has reached its review date (2026-10-02T08:00:00Z) without resolution."],
      ["Material", "Founder", "Project 'd' has reached its review date (undefined) without resolution."],
    ]);
    expect(items[2].releasePath).toBe("Complete the project review and set the next intervention point.");
    expect(items[0].releasePath).toBe("Remove the blocker or correct the project course.");
  });
});

describe("Founder Bottleneck Map recurrence, capability and ownership", () => {
  it("uses cluster root metadata and projected category size, without copying owner or claiming the root", () => {
    const items = buildFounderBottleneckMap(input({
      convergentRisks: [cluster("cluster:one", "p")], learningGaps: [gap("p", { severity: "Critical" })],
    })).bottlenecks;
    expect(items).toHaveLength(2);
    expect(items.find(({ title }) => title === "cluster:one")).toEqual({
      id: "p", title: "cluster:one", objectType: "Problem", area: "Garden", category: "Recurrence", severity: "Critical",
      why: "Convergent risk — one situation generates 3 signal categories across 4 linked records, requiring repeated founder intervention.",
      releasePath: "Address root cause across linked records to resolve systemic recurrence.",
    });
    expect(items.find(({ title }) => title === "p")?.why).toBe("Unresolved recurring problem 'p' (Recurring) occurs repeatedly without an active SOP or system.");
  });

  it("maps only exact Critical recurring severity to Critical", () => {
    expect(buildFounderBottleneckMap(input({ learningGaps: [gap("a", { severity: "Critical" }), gap("b", { severity: "critical" }), gap("c", { severity: "Low" })] }))
      .bottlenecks.map(({ id, severity }) => [id, severity])).toEqual([["a", "Critical"], ["b", "Material"], ["c", "Material"]]);
  });

  it("counts all routine inputs including claimed and duplicate records for no-team capability", () => {
    const result = buildFounderBottleneckMap(input({
      reviewItems: [review("a", { kind: "Action" })],
      routineDelegateItems: [delegate("a"), delegate("a"), delegate("b")],
      activeOperationalPeopleCount: 0, delegationReadyPeopleCount: 0,
      teamReadinessGaps: [{ name: "Ignored", missingFields: ["role"] }],
    }));
    const capability = result.bottlenecks.find(({ category }) => category === "Capability");
    expect(capability).toEqual({
      id: "unassigned", category: "Capability", title: "No active non-founder team members available", objectType: "People",
      area: "People", severity: "Critical",
      why: "3 routine founder-owned item(s) sit with the founder because no active non-founder team member exists.",
      releasePath: "Onboard or activate team members in People to absorb operational load.", openPeopleView: true,
    });
    expect(result.bottlenecks.filter(({ category }) => category === "Ownership").map(({ id }) => id)).toEqual(["b"]);
  });

  it("preserves readiness field/name order, punctuation and co-founder singular/plural", () => {
    const gaps = [{ name: "Zed", missingFields: ["role", "authority"] }, { name: "Amy", missingFields: ["responsibilities"] }];
    const result = buildFounderBottleneckMap(input({
      routineDelegateItems: [delegate("a")], delegationReadyPeopleCount: 0,
      teamReadinessGaps: gaps, cofounderReadinessGaps: gaps, delegationReadinessGaps: gaps,
    }));
    const team = result.bottlenecks.find(({ title }) => title === "Team delegation readiness gap");
    expect(team?.why).toBe("1 founder-owned routine item(s) are ready for delegation, but readiness gaps remain: Zed (role, authority); Amy (responsibilities).");
    expect(team?.releasePath).toBe("Complete delegation readiness in People: Zed — role, authority; Amy — responsibilities.");
    const cofounder = result.bottlenecks.find(({ id }) => id === "cofounder-readiness-gap");
    expect(cofounder?.why).toBe("Zed (role, authority); Amy (responsibilities) have incomplete Co-founder delegation readiness in People.");
    expect(cofounder?.releasePath).toBe("Complete Co-founder delegation readiness in People: Zed — role, authority; Amy — responsibilities.");
    expect(cofounder?.severity).toBe("Emerging");
    const singular = buildFounderBottleneckMap(input({ cofounderReadinessGaps: [gaps[0]] })).bottlenecks[0];
    expect(singular.why).toBe("Zed (role, authority) has incomplete Co-founder delegation readiness in People.");
    expect(singular.openPeopleView).toBe(true);
  });

  it("needs routine work for team capability but not for co-founder capability", () => {
    const readiness = [{ name: "Team", missingFields: ["role"] }];
    expect(buildFounderBottleneckMap(input({
      activeOperationalPeopleCount: 0, delegationReadyPeopleCount: 0, teamReadinessGaps: readiness,
    })).bottlenecks).toEqual([]);
    expect(buildFounderBottleneckMap(input({
      routineDelegateItems: [delegate("a")], delegationReadyPeopleCount: 1, teamReadinessGaps: readiness,
    })).bottlenecks.map(({ category }) => category)).toEqual(["Ownership"]);
    expect(buildFounderBottleneckMap(input({
      routineDelegateItems: [delegate("a")], delegationReadyPeopleCount: 0,
    })).bottlenecks.map(({ category }) => category)).toEqual(["Ownership"]);
  });

  it("preserves all three ownership release branches and capacity-ranked names without resorting", () => {
    const ranked = buildFounderBottleneckMap(input({
      routineDelegateItems: [delegate("a", { capacityRankedNames: ["Zed", "Amy"], owner: "" })],
    })).bottlenecks[0];
    expect(ranked).toEqual({
      id: "a", title: "Routine founder-owned action: a", objectType: "Action", area: "Garden", owner: "",
      category: "Ownership", severity: "Material",
      why: "Founder carries routine action execution ('a') that is suitable for delegation.",
      releasePath: "Delegate ownership to an active team member for Garden (Zed, Amy).",
    });
    expect(buildFounderBottleneckMap(input({ routineDelegateItems: [delegate("a")] })).bottlenecks[0].releasePath)
      .toBe("Assign a delegation-ready Person to Garden before transferring ownership.");
    expect(buildFounderBottleneckMap(input({
      routineDelegateItems: [delegate("a")], delegationReadyPeopleCount: 0,
      delegationReadinessGaps: [{ name: "Operator", missingFields: ["role", "authority"] }],
    })).bottlenecks[0].releasePath).toBe("Complete delegation readiness in People: Operator — role, authority, then transfer ownership.");
    expect(buildFounderBottleneckMap(input({
      routineDelegateItems: [delegate("a")], delegationReadyPeopleCount: 0,
    })).bottlenecks[0].releasePath).toBe("Complete delegation readiness in People: , then transfer ownership.");
  });
});

describe("Founder Bottleneck Map source precedence, sorting and summary", () => {
  it("claims first accepted kind:id across source families before severity/title ranking", () => {
    const result = buildFounderBottleneckMap(input({
      reviewItems: [review("a", { kind: "Action", title: "Z first", reasonCategory: "Under review" }), review("a", { kind: "Action", title: "A later", reasonCategory: "Critical escalation" })],
      retainedProjects: [{ ...record("p", "Retained"), founderObjectiveTitle: "Objective" }],
      opportunities: [{ ...record("o"), status: "Evaluating", strategicFit: "High", hasSettledDecision: false }],
      decisionsWithoutExecution: [record("d")],
      blockedActions: [blocked("a"), blocked("b")],
      overdueActions: [{ ...record("b"), dueDate: "2020-01-01", isOverdue: true }],
      executionProjects: [project("p")],
      convergentRisks: [cluster("Action:a", "ignored"), cluster("cluster", "r"), cluster("cluster", "later")],
      learningGaps: [gap("r"), gap("r", { title: "Later", severity: "Critical" })],
      routineDelegateItems: [delegate("a"), delegate("b"), delegate("d", { objectType: "Decision" }), delegate("r", { objectType: "Problem" }), delegate("o", { objectType: "Opportunity" }), delegate("p", { objectType: "Project" })],
    }));
    expect(result.bottlenecks.map(({ category, title }) => [category, title])).toEqual([
      ["Execution", "b"], ["Recurrence", "cluster"],
      ["Authority", "Founder-retained project: Retained"], ["Authority", "o"], ["Authority", "Z first"],
      ["Execution", "d"], ["Recurrence", "r"],
    ]);
    expect(result.summary.totalCount).toBe(7);
  });

  it("does not let rejected first duplicates claim keys and keeps exact ties stable across sources", () => {
    const result = buildFounderBottleneckMap(input({
      blockedActions: [blocked("a", { isFounderOwned: false }), blocked("a", { title: "Same" }), blocked("b", { title: "Same" })],
      executionProjects: [project("p", { health: "Waiting", reviewFuture: true }), project("p", { title: "Same" })],
      convergentRisks: [cluster("c", "root", { title: "Same" })],
      learningGaps: [gap("root", { title: "Same", severity: "Critical" })],
    }));
    expect(result.bottlenecks.map(({ id }) => id)).toEqual(["a", "b", "p", "root", "root"]);
  });

  it("uses literal shared key collisions including People capability keys, not root identity", () => {
    const result = buildFounderBottleneckMap(input({
      convergentRisks: [
        cluster("People:no-nonfounder", "root"),
        cluster("People:cofounder-readiness-gap", "root"),
        cluster("Problem:gap", "different-root"),
      ],
      learningGaps: [gap("gap")], routineDelegateItems: [delegate("unassigned", { objectType: "People" })],
      activeOperationalPeopleCount: 0, delegationReadyPeopleCount: 0,
      cofounderReadinessGaps: [{ name: "Co", missingFields: ["role"] }],
    }));
    expect(result.bottlenecks.filter(({ category }) => category === "Capability")).toEqual([]);
    expect(result.bottlenecks.filter(({ category }) => category === "Ownership")).toHaveLength(1);
    expect(result.bottlenecks.filter(({ id }) => id === "gap")).toEqual([]);
    expect(result.bottlenecks.filter(({ id }) => id === "root")).toHaveLength(2);
  });

  it("sorts severity then category then localeCompare title and never truncates at six", () => {
    const titles = ["z", "Z", "a", "A"];
    const result = buildFounderBottleneckMap(input({
      reviewItems: titles.map((title) => review(title, { title })),
      blockedActions: [blocked("critical")], learningGaps: [gap("recurrence")],
      routineDelegateItems: [delegate("ownership")],
      cofounderReadinessGaps: [{ name: "Co", missingFields: ["authority"] }],
    }));
    expect(result.bottlenecks.map(({ id }) => id)).toEqual([
      "critical", ...[...titles].sort((a, b) => a.localeCompare(b)), "recurrence", "ownership", "cofounder-readiness-gap",
    ]);
    expect(result.summary).toMatchObject({ totalCount: 8, criticalCount: 1, materialCount: 6, emergingCount: 1 });
  });

  it("uses category insertion order for equal counts, not severity or item insertion order", () => {
    const result = buildFounderBottleneckMap(input({
      decisionsWithoutExecution: [record("d")], learningGaps: [gap("p", { severity: "Critical" })],
      cofounderReadinessGaps: [{ name: "Co", missingFields: ["role"] }],
      routineDelegateItems: [delegate("a")],
    }));
    expect(result.summary.topCategoryText).toBe("Execution blockers & Systemic recurrence");
    expect(result.summary.headline).toBe("Founder dependency is currently concentrated in execution blockers and systemic recurrence.");
  });

  it("ranks all five material categories and favours Authority/Execution on a five-way count tie", () => {
    const result = buildFounderBottleneckMap(input({
      reviewItems: [review("authority", { title: "Z authority" })],
      decisionsWithoutExecution: [record("execution", "Y execution")],
      learningGaps: [gap("recurrence", { title: "X recurrence" })],
      routineDelegateItems: [delegate("ownership", { title: "A ownership" })],
      delegationReadyPeopleCount: 0,
      teamReadinessGaps: [{ name: "Team", missingFields: ["authority"] }],
    }));
    expect(result.bottlenecks.map(({ category }) => category)).toEqual([
      "Authority", "Execution", "Recurrence", "Capability", "Ownership",
    ]);
    expect(result.summary).toEqual({
      totalCount: 5, criticalCount: 0, materialCount: 5, emergingCount: 0,
      topCategoryText: "Authority decisions & Execution blockers",
      headline: "Founder dependency is currently concentrated in authority decisions and execution blockers.",
    });
  });

  it.each([
    ["Execution blockers", input({ decisionsWithoutExecution: [record("d")] })],
    ["Systemic recurrence", input({ learningGaps: [gap("p")] })],
    ["Delegation capacity", input({ cofounderReadinessGaps: [{ name: "Co", missingFields: ["role"] }] })],
    ["Ownership load", input({ routineDelegateItems: [delegate("a")] })],
  ] as const)("retains the single-category display name %s", (name, source) => {
    const result = buildFounderBottleneckMap(source);
    expect(result.summary.topCategoryText).toBe(name);
    expect(result.summary.headline).toBe(`Founder dependency is currently concentrated in ${name.toLowerCase()}.`);
  });

  it("honours a readiness-gap key claimed by a cluster without claiming People:unassigned", () => {
    const result = buildFounderBottleneckMap(input({
      convergentRisks: [cluster("People:readiness-gap", "root")],
      routineDelegateItems: [delegate("unassigned", { objectType: "People" })],
      delegationReadyPeopleCount: 0,
      teamReadinessGaps: [{ name: "Team", missingFields: ["role"] }],
    }));
    expect(result.bottlenecks.map(({ category }) => category)).toEqual(["Recurrence", "Ownership"]);
  });

  it.each([
    [1, 0, "Authority decisions", "authority decisions"],
    [3, 1, "Authority decisions", "authority decisions"],
    [3, 2, "Authority decisions & Execution blockers", "authority decisions and execution blockers"],
    [2, 3, "Execution blockers & Authority decisions", "execution blockers and authority decisions"],
  ])("preserves headline concentration threshold (%s vs %s)", (authorityCount, executionCount, text, headlinePart) => {
    const result = buildFounderBottleneckMap(input({
      reviewItems: Array.from({ length: authorityCount }, (_, i) => review(`r${i}`)),
      decisionsWithoutExecution: Array.from({ length: executionCount }, (_, i) => record(`e${i}`)),
    }));
    expect(result.summary.topCategoryText).toBe(text);
    expect(result.summary.headline).toBe(`Founder dependency is currently concentrated in ${headlinePart}.`);
  });

  it("does not mutate frozen input arrays, nested fields, records or ranked names", () => {
    const source = input({
      reviewItems: [review("r")], blockedActions: [blocked("a")],
      routineDelegateItems: [delegate("d", { capacityRankedNames: ["Z", "A"] })],
      convergentRisks: [cluster("cluster", "root")],
      cofounderReadinessGaps: [{ name: "Co", missingFields: ["role", "authority"] }],
    });
    const before = JSON.stringify(source);
    function freeze(value: unknown): void {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    }
    freeze(source);
    const first = buildFounderBottleneckMap(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(buildFounderBottleneckMap(source)).toEqual(first);
    expect(first.bottlenecks.every((item) => !Object.values(item).some((value) => typeof value === "function"))).toBe(true);
    first.bottlenecks[0].title = "Changed result";
    expect(JSON.stringify(source)).toBe(before);
  });
});

type PageAction = {
  id: string; title: string; status: string; owner: string; ownerPersonId?: string;
  actionTitle?: string; dueDate?: string; relatedPillar?: string; relatedArea?: string; area?: string;
  relatedProblem?: string; relatedDecision?: string;
  releaseSourceType?: string; releaseSourceId?: string; releaseIntent?: string;
};
type PageProject = Pick<ProjectRecord, "id" | "projectName" | "status" | "owner" | "area" | "health" | "nextReviewDate" | "reviewNote"> & { ownerPersonId?: string };
type PageOpportunity = {
  id: string; title: string; opportunityTitle?: string; status: string; strategicFit: string;
  owner?: string; relatedPillar?: string; relatedArea?: string; area?: string;
};
type PageObjective = { title: string; status: string; founderAllocation: string; linkedProjectIds: string[] };
type PageOverrides = {
  actionRecords?: PageAction[]; projects?: PageProject[]; opportunityRecords?: PageOpportunity[];
  decisionRecords?: (DependencyDecisionInput & { relatedOpportunity?: string })[];
  problemRecords?: DependencyProblemInput[]; strategicObjectives?: PageObjective[];
  people?: DelegationPersonInput[]; orderedPeople?: DelegationPersonInput[]; founderPerson?: DelegationPersonInput | null;
  empireDecisionQueue?: { founderReviewQueue: Input["reviewItems"]; delegateItems: Omit<Input["routineDelegateItems"][number], "capacityRankedNames">[] };
  decisionsWithoutExecution?: Input["decisionsWithoutExecution"];
  correlationLayer?: { convergentRisks: { clusterKey: string; title: string; records: { id: string; objectType: string; area: string }[]; categories: Set<string>; recordCount: number }[] };
  recurringProblemLearning?: { gaps: Input["learningGaps"] };
  activeOperationalDelegationPeople?: DelegationPersonInput[]; delegationReadyPeople?: DelegationPersonInput[];
  teamDelegationReadinessGapPeople?: DelegationPersonInput[]; cofounderReadinessGapPeople?: DelegationPersonInput[];
  delegationReadinessGapPeople?: DelegationPersonInput[];
  personAccountabilitySummaries?: { person: DelegationPersonInput; carriedCount: number; attentionCount: number }[];
};
const nowMs = new Date(2026, 9, 2, 12).getTime();
function person(id: string, overrides: Partial<DelegationPersonInput> = {}): DelegationPersonInput {
  return { id, name: id, status: "Active", role: "Operator", responsibilities: "Delivery", authority: "Routine", pillar: "Garden", ...overrides };
}
const founder = person("founder", { name: "Founder", role: "Founder", accessLevel: "Founder" });
function pageAction(id: string, overrides: Partial<PageAction> = {}): PageAction {
  return { id, title: id, status: "Open", owner: "Founder", ...overrides };
}
function pageProject(id: string, overrides: Partial<PageProject> = {}): PageProject {
  return { id, projectName: id, status: "Open", owner: "Founder", area: "Garden", ...overrides };
}

function pageMap(overrides: PageOverrides = {}, samples: number[] = []) {
  const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
  const section = (start: string, end: string) => {
    const first = page.indexOf(start);
    const last = page.indexOf(end, first);
    if (first < 0 || last < 0) throw new Error(`Missing Founder Bottleneck Map boundary: ${start}`);
    return page.slice(first, last);
  };
  const source = [
    section("function isActionWaiting(", "\nconst personStatusOptions"),
    section("function getActionOwnerDisplay(", "function getActionOwnerValue("),
    section("  const getAreaText =", "  const getDateValue ="),
    section("  const isActionActive =", "  const isProblemUnresolved ="),
    section("  const isProjectActive =", "  const delegationReadiness ="),
    section("  const isFounderOwned =", "  const activeOwnershipActions ="),
    section("  const getActionDependencyBlocker =", "  const executableAction ="),
    section("  const getCapacityRankedDelegationPeopleForArea =", "  const organisationalHealthWorkItems ="),
    section("  const getFounderAttentionObjectiveForProject =", "  const founderExecutionReleaseSystem ="),
    "result = founderBottleneckMap;",
  ].join("\n");
  const { outputText } = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2020, module: ModuleKind.ESNext },
  });
  let sampleIndex = 0;
  const clock = vi.fn(() => samples[Math.min(sampleIndex++, samples.length - 1)] ?? nowMs);
  class Clock extends Date { static now() { return clock(); } }
  const onOpen = vi.fn();
  const navigate = vi.fn();
  const capacity = vi.fn(rankDelegationPeopleForArea);
  const ownership = vi.fn(isFounderOwnedRule);
  const dependency = vi.fn(getActionDependencyBlockerRule);
  const health = vi.fn((value: PageProject) => getEffectiveProjectHealth(value));
  let projected: Input | undefined;
  const context: { result?: { summary: Result["summary"]; bottlenecks: (Omit<Result["bottlenecks"][number], "openPeopleView"> & { onOpen: () => void })[] } } = {};
  runInNewContext(outputText, Object.assign(context, {
    Map, Set, Date: Clock,
    people: [founder], orderedPeople: [founder], founderPerson: founder,
    actionRecords: [], projects: [], opportunityRecords: [], problemRecords: [], decisionRecords: [], strategicObjectives: [],
    empireDecisionQueue: { founderReviewQueue: [], delegateItems: [] }, decisionsWithoutExecution: [],
    correlationLayer: { convergentRisks: [] }, recurringProblemLearning: { gaps: [] },
    activeOperationalDelegationPeople: [], delegationReadyPeople: [], teamDelegationReadinessGapPeople: [],
    cofounderReadinessGapPeople: [], delegationReadinessGapPeople: [], personAccountabilitySummaries: [],
    ...overrides,
    isFounderOwnedRule: ownership, getActionDependencyBlockerRule: dependency,
    getEffectiveProjectHealth: health,
    isProjectReviewDue: (value: PageProject) => isProjectReviewDue(value, Clock.now()),
    isProjectReviewFuture: (value: PageProject) => isProjectReviewFuture(value, Clock.now()),
    getDelegationReadinessMissingFields, rankDelegationPeopleForArea: capacity,
    isFounderBottleneckBlockedAction, isFounderBottleneckExecutionProject,
    buildFounderBottleneckMap: (value: Input) => { projected = value; return buildFounderBottleneckMap(value); },
    handleOpenAttentionRecord: onOpen, setActiveView: navigate,
    setSelectedProblemId: vi.fn(), setProblemEditor: vi.fn(), setSelectedDecisionId: vi.fn(), setDecisionEditor: vi.fn(),
  }), { timeout: 1000 });
  if (!context.result || !projected) throw new Error("Founder Bottleneck Map adapter produced no result");
  return { result: context.result, projected, onOpen, navigate, capacity, ownership, dependency, health, clock };
}

describe("Founder Bottleneck Map page-owned fact projection and navigation", () => {
  it("restores record navigation by review kind/root and People-view navigation only for capability", () => {
    const reviewWithDifferentObjectType = { ...review("d", { kind: "Decision" }), objectType: "Project" };
    const page = pageMap({
      empireDecisionQueue: { founderReviewQueue: [reviewWithDifferentObjectType], delegateItems: [delegate("a")] },
      correlationLayer: { convergentRisks: [{ clusterKey: "cluster", title: "Signal", records: [{ id: "root", objectType: "People", area: "People" }], categories: new Set(["one", "two"]), recordCount: 2 }] },
      cofounderReadinessGapPeople: [person("Co", { authority: "" })],
    });
    page.result.bottlenecks.forEach((item) => item.onOpen());
    expect(page.onOpen.mock.calls).toEqual([["People", "root"], ["Decision", "d"], ["Action", "a"]]);
    expect(page.navigate.mock.calls).toEqual([["People"], ["People"]]);
    expect(page.result.bottlenecks.every((item) => !("openPeopleView" in item))).toBe(true);
    expect(page.projected.convergentRisks[0].categoryCount).toBe(2);
    expect(page.projected.convergentRisks[0].root).toEqual({ id: "root", objectType: "People", area: "People" });
  });

  it("excludes inactive, waiting and full release interventions but not partial release metadata", () => {
    const actions = [
      pageAction("closed", { status: "Completed", dueDate: "2000-01-01" }),
      pageAction("waiting", { status: "Waiting", dueDate: "2000-01-01" }),
      pageAction("release", { status: "Blocked", releaseSourceType: "Action", releaseSourceId: "source", releaseIntent: "Unblock First" }),
      pageAction("partial", { status: "Blocked", releaseSourceType: "Action", releaseSourceId: "source" }),
    ];
    const page = pageMap({ actionRecords: actions });
    expect(page.result.bottlenecks.map(({ id }) => id)).toEqual(["partial"]);
    expect(page.dependency.mock.calls.map(([action]) => action)).toEqual([actions[3]]);
    expect(page.clock).not.toHaveBeenCalled();
  });

  it("resolves action ownership by first active person ID, with stale-ID text fallback and owner-display trimming", () => {
    const people = [
      person("f", { name: "Inactive", status: "Inactive" }), person("f", { name: "  Founder  " }),
      person("f", { name: "Later duplicate" }), person("operator", { name: "Operator" }),
    ];
    const page = pageMap({
      people, orderedPeople: people,
      actionRecords: [
        pageAction("id", { owner: "Operator", ownerPersonId: "f", status: "Blocked", actionTitle: "Preferred", relatedPillar: "Pillar", relatedArea: "Area", area: "Fallback" }),
        pageAction("text", { owner: "  Founder  ", ownerPersonId: "missing", status: "Blocked", actionTitle: "", relatedArea: "Area" }),
        pageAction("nonfounder", { ownerPersonId: "operator", status: "Blocked" }),
      ],
    });
    expect(page.projected.blockedActions.map(({ id, title, area, owner }) => [id, title, area, owner])).toEqual([
      ["id", "Preferred", "Pillar", "  Founder  "], ["text", "text", "Area", "Founder"],
    ]);
    expect(page.result.bottlenecks.map(({ id }) => id)).toEqual(["id", "text"]);
  });

  it("preserves first problem/decision lookups and problem-before-decision dependency precedence", () => {
    const page = pageMap({
      problemRecords: [
        { id: "p", title: "Resolved first", problemStatus: "Resolved" },
        { id: "p", title: "Open later", problemStatus: "Open" },
        { id: "open", title: "Problem title", problemStatement: "Problem statement", problemStatus: "Open" },
      ],
      decisionRecords: [
        { id: "d", title: "First decision", decisionTitle: "Scope", decisionStatus: "Draft" },
        { id: "d", title: "Later decision", decisionStatus: "Completed" },
        { id: "settled", title: "Settled first", decisionStatus: "Active" },
        { id: "settled", title: "Draft later", decisionStatus: "Draft" },
      ],
      actionRecords: [
        pageAction("decision", { owner: "Operator", relatedProblem: "p", relatedDecision: "d" }),
        pageAction("problem", { owner: "Operator", relatedProblem: "open", relatedDecision: "d" }),
        pageAction("founder", { relatedProblem: "open", relatedDecision: "d" }),
        pageAction("notblocked", { owner: "Operator", relatedDecision: "settled" }),
      ],
    });
    expect(page.projected.blockedActions.map(({ id, dependencyReason }) => [id, dependencyReason])).toEqual([
      ["decision", "WAITING ON DECISION: Scope"], ["founder", "BLOCKED BY PROBLEM: Problem statement"],
    ]);
  });

  it("retains the first active founder-attention objective and removes its project from routine counts", () => {
    const page = pageMap({
      strategicObjectives: [
        { title: "Inactive", status: "Completed", founderAllocation: "Founder attention now", linkedProjectIds: ["p"] },
        { title: "Other allocation", status: "Active", founderAllocation: "Delegate", linkedProjectIds: ["p"] },
        { title: "First active", status: "Active", founderAllocation: "Founder attention now", linkedProjectIds: ["p"] },
        { title: "Later active", status: "Active", founderAllocation: "Founder attention now", linkedProjectIds: ["p"] },
      ],
      projects: [pageProject("p"), pageProject("p", { projectName: "Later duplicate" }), pageProject("closed", { status: " CANCELLED " })],
      empireDecisionQueue: { founderReviewQueue: [], delegateItems: [delegate("p", { objectType: "Project" })] },
    });
    expect(page.projected.retainedProjects).toEqual([{ id: "p", title: "p", area: "Garden", owner: "Founder", founderObjectiveTitle: "First active" }]);
    expect(page.projected.routineDelegateItems).toEqual([]);
    expect(page.result.summary.totalCount).toBe(1);
    expect(page.health).not.toHaveBeenCalled();
    // Projects intentionally use owner text, not an Action's ownerPersonId route.
    const textOnly = pageMap({
      projects: [pageProject("p", { owner: "Unknown", ownerPersonId: "founder", health: "Blocked" })],
      strategicObjectives: [{ title: "Objective", status: "Active", founderAllocation: "Founder attention now", linkedProjectIds: ["p"] }],
    });
    expect(textOnly.projected.retainedProjects).toEqual([]);
    expect(textOnly.result.bottlenecks[0].category).toBe("Execution");
  });

  it("settles opportunities by any Completed/Reversed decision, with title/area fallback unchanged", () => {
    const opportunity = (id: string): PageOpportunity => ({ id, title: id, status: "Evaluating", strategicFit: "High", owner: "" });
    const page = pageMap({
      opportunityRecords: [
        { ...opportunity("open"), opportunityTitle: "", relatedPillar: "Pillar", relatedArea: "Area" },
        opportunity("completed"), opportunity("reversed"), { ...opportunity("wrong"), status: "Approved" },
        { ...opportunity("open"), opportunityTitle: "Later" },
      ],
      decisionRecords: [
        { id: "a", title: "Draft first", decisionStatus: "Draft", relatedOpportunity: "completed" },
        { id: "b", title: "Completed later", decisionStatus: "Completed", relatedOpportunity: "completed" },
        { id: "c", title: "Reversed", decisionStatus: "Reversed", relatedOpportunity: "reversed" },
      ],
    });
    expect(page.projected.opportunities).toEqual([{ id: "open", title: "open", area: "Pillar", owner: "", status: "Evaluating", strategicFit: "High", hasSettledDecision: false }]);
    expect(page.result.bottlenecks[0].owner).toBe("Unassigned");
  });

  it("preserves one Date.now sample per unclaimed founder action with a nonempty due date, including invalid dates", () => {
    const due = new Date(nowMs).toISOString();
    const actions = [
      pageAction("authority", { dueDate: "2000-01-01" }),
      pageAction("blocked", { status: "Blocked", dueDate: "2000-01-01" }),
      pageAction("operator", { owner: "Operator", dueDate: due }),
      pageAction("empty", { dueDate: "" }),
      pageAction("invalid", { dueDate: "invalid" }),
      pageAction("duplicate", { dueDate: due }),
      pageAction("duplicate", { dueDate: due, title: "Second accepted" }),
      pageAction("duplicate", { dueDate: due, title: "Never sampled" }),
      pageAction("last", { dueDate: due }),
    ];
    const page = pageMap({
      actionRecords: actions,
      empireDecisionQueue: { founderReviewQueue: [review("authority", { kind: "Action" })], delegateItems: [] },
    }, [nowMs - 1, nowMs, nowMs + 1, nowMs + 2]);
    expect(page.clock).toHaveBeenCalledTimes(4);
    expect(page.projected.overdueActions.map(({ id, title }) => [id, title])).toEqual([
      ["duplicate", "Second accepted"], ["last", "last"],
    ]);
    expect(page.result.bottlenecks.find(({ id }) => id === "duplicate")?.title).toBe("Second accepted");
  });

  it("keeps strict overdue equality, native epoch/negative/offset parsing and literal due-date labels", () => {
    const page = pageMap({ actionRecords: [
      pageAction("equal", { dueDate: new Date(nowMs).toISOString() }),
      pageAction("epoch", { dueDate: "1970-01-01T00:00:00Z" }),
      pageAction("negative", { dueDate: "1969-12-31T23:59:59Z" }),
      pageAction("offset", { dueDate: "2026-10-02T00:00:00+14:00" }),
      pageAction("future", { dueDate: new Date(nowMs + 1).toISOString() }),
    ] });
    expect(page.clock).toHaveBeenCalledTimes(5);
    expect(page.projected.overdueActions.map(({ id }) => id)).toEqual(["epoch", "negative", "offset"]);
    expect(page.result.bottlenecks.find(({ id }) => id === "offset")?.why).toContain("(due 2026-10-02)");
  });

  it("runs project health/due/future helpers after action samples and skips already claimed project IDs", () => {
    const page = pageMap({
      actionRecords: [pageAction("a", { dueDate: new Date(nowMs).toISOString() })],
      empireDecisionQueue: { founderReviewQueue: [review("claimed", { kind: "Project" })], delegateItems: [] },
      projects: [
        pageProject("claimed", { health: "Blocked" }),
        pageProject("future", { health: "Waiting", nextReviewDate: "2026-10-03" }),
        pageProject("legacy", { status: " blocked ", health: undefined, reviewNote: "Legacy status" }),
        pageProject("legacy", { health: "Blocked", projectName: "Later duplicate" }),
        pageProject("review", { health: "On track", nextReviewDate: "2026-10-02" }),
        pageProject("invalid", { health: "Waiting", nextReviewDate: "invalid" }),
      ],
    });
    expect(page.clock).toHaveBeenCalledTimes(9);
    expect(page.health.mock.calls.map(([value]) => value.id)).toEqual(["future", "legacy", "review", "invalid"]);
    expect(page.projected.executionProjects.map(({ id, health, reviewDue, reviewFuture }) => [id, health, reviewDue, reviewFuture])).toEqual([
      ["legacy", "Blocked", false, false], ["review", "On track", true, false],
    ]);
    expect(page.projected.overdueActions).toEqual([]);
  });

  it("looks up capacity only for first accepted routine IDs in source order, preserving helper ranking and first ID lookup", () => {
    const zed = person("duplicate", { name: "Zed" });
    const amy = person("amy", { name: "Amy" });
    const later = person("duplicate", { name: "Later", pillar: "Other" });
    const page = pageMap({
      empireDecisionQueue: {
        founderReviewQueue: [review("claimed", { kind: "Action" })],
        delegateItems: [delegate("claimed"), delegate("z"), delegate("z", { pillar: "Other" }), delegate("a", { pillar: "Unassigned" })],
      },
      activeOperationalDelegationPeople: [zed, amy, later], delegationReadyPeople: [zed, amy, later],
      personAccountabilitySummaries: [
        { person: zed, carriedCount: 1, attentionCount: 0 },
        { person: zed, carriedCount: 99, attentionCount: 99 },
        { person: amy, carriedCount: 0, attentionCount: 1 },
      ],
    });
    expect(page.capacity.mock.calls.map(([area]) => area)).toEqual(["Garden", "Unassigned"]);
    expect(page.projected.routineDelegateItems.map(({ id, capacityRankedNames }) => [id, capacityRankedNames])).toEqual([
      ["claimed", []], ["z", ["Zed", "Amy"]], ["z", []], ["a", []],
    ]);
    expect(page.result.bottlenecks.find(({ id }) => id === "z")?.releasePath).toContain("(Zed, Amy)");
    const duplicateLookup = pageMap({
      empireDecisionQueue: { founderReviewQueue: [], delegateItems: [delegate("other", { pillar: "Other" })] },
      delegationReadyPeople: [zed, later], activeOperationalDelegationPeople: [zed, later],
    });
    expect(duplicateLookup.projected.routineDelegateItems[0].capacityRankedNames).toEqual(["Zed"]);
  });

  it("projects missing fields from the authoritative helper in original field and person order", () => {
    const team = [person("Zed", { role: "", responsibilities: "", authority: "" }), person("Amy", { responsibilities: "" })];
    const co = person("Co", { role: "Co-founder", authority: "" });
    const page = pageMap({
      empireDecisionQueue: { founderReviewQueue: [], delegateItems: [delegate("a")] },
      activeOperationalDelegationPeople: team, teamDelegationReadinessGapPeople: team,
      cofounderReadinessGapPeople: [co], delegationReadinessGapPeople: [...team, co],
    });
    expect(page.projected.teamReadinessGaps).toEqual([
      { name: "Zed", missingFields: ["role", "responsibilities", "authority"] },
      { name: "Amy", missingFields: ["responsibilities"] },
    ]);
    expect(page.projected.cofounderReadinessGaps).toEqual([{ name: "Co", missingFields: ["authority"] }]);
    expect(page.projected.delegationReadinessGaps.map(({ name }) => name)).toEqual(["Zed", "Amy", "Co"]);
    expect(page.result.bottlenecks.find(({ category }) => category === "Ownership")?.releasePath)
      .toBe("Complete delegation readiness in People: Zed — role, responsibilities, authority; Amy — responsibilities; Co — authority, then transfer ownership.");
  });

  it("does not treat unresolved ownership as founder-owned when no founder is available", () => {
    const page = pageMap({
      founderPerson: null,
      actionRecords: [pageAction("a", { status: "Blocked", dueDate: "2000-01-01" })],
      projects: [pageProject("p")],
      strategicObjectives: [{ title: "Objective", status: "Active", founderAllocation: "Founder attention now", linkedProjectIds: ["p"] }],
    });
    expect(page.projected.retainedProjects).toEqual([]);
    expect(page.projected.blockedActions).toEqual([]);
    expect(page.projected.overdueActions).toEqual([]);
    expect(page.clock).toHaveBeenCalledTimes(2);
    expect(page.result.bottlenecks).toEqual([]);
  });

  it("leaves page records, people, objectives, cluster sets and source order untouched", () => {
    const source: PageOverrides = {
      actionRecords: [pageAction("z", { status: "Blocked" }), pageAction("a", { dueDate: "2000-01-01" })],
      projects: [pageProject("p")],
      strategicObjectives: [{ title: "Objective", status: "Active", founderAllocation: "Founder attention now", linkedProjectIds: ["p"] }],
      empireDecisionQueue: { founderReviewQueue: [], delegateItems: [delegate("p", { objectType: "Project" }), delegate("routine")] },
      correlationLayer: { convergentRisks: [{ clusterKey: "cluster", title: "Signal", records: [{ id: "root", objectType: "Problem", area: "Garden" }], categories: new Set(["second", "first"]), recordCount: 2 }] },
      people: [founder], orderedPeople: [founder],
    };
    const before = JSON.stringify(source);
    const result = pageMap(source);
    expect(result.result.summary.totalCount).toBe(6);
    expect(JSON.stringify(source)).toBe(before);
    expect([...source.correlationLayer!.convergentRisks[0].categories]).toEqual(["second", "first"]);
    expect(source.actionRecords!.map(({ id }) => id)).toEqual(["z", "a"]);
    expect(source.empireDecisionQueue!.delegateItems.map(({ id }) => id)).toEqual(["p", "routine"]);
  });
});
