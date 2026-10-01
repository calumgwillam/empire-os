import { describe, expect, it } from "vitest";
import {
  assessDelegationReadiness,
  buildExecutionReleasePlan,
  deriveDelegationHandoffFollowThrough,
  getActionDependencyBlocker,
  getDelegationReadinessMissingFields,
  getDelegationReadyPeopleForArea,
  getProjectExecutionReleaseStatus,
  isFounderClassPerson,
  isFounderOwned,
  rankDelegationPeopleForArea,
  resolveActiveOwnerKey,
  selectLatestHandoffIdByObject,
  selectPrimaryFounder,
  type CapacityFacts,
  type DelegationPersonInput,
  type HandoffInput,
  type HandoffSourceInput,
  type ReleaseActionHistoryInput,
  type ReleaseCandidateInput,
} from "./execution-release";

function person(overrides: Partial<DelegationPersonInput> = {}): DelegationPersonInput {
  return {
    id: "person-1",
    name: "Alex",
    role: "Team Member",
    accessLevel: "Team Member",
    status: "Active",
    responsibilities: "Own assigned work",
    authority: "Routine decisions",
    pillar: "Garden Maintenance",
    ...overrides,
  };
}

function handoff(overrides: Partial<HandoffInput> = {}): HandoffInput {
  return {
    id: "handoff-1",
    objectType: "Action",
    objectId: "action-1",
    title: "Handoff title",
    newOwner: "Alex",
    newOwnerPersonId: "person-2",
    transferredAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

function candidate(overrides: Partial<ReleaseCandidateInput> = {}): ReleaseCandidateInput {
  const readyPerson = { id: "person-2", name: "Alex", pillar: "Garden Maintenance" };
  return {
    id: "action-1",
    objectType: "Action",
    title: "Routine work",
    area: "Garden Maintenance",
    owner: "Founder",
    status: "Open",
    isBlocked: false,
    requiresAuthority: false,
    areaDelegationReadyPeople: [readyPerson],
    capacityRankedDelegationPeople: [readyPerson],
    activeOperationalDelegationPeopleCount: 1,
    delegationReadyPeopleCount: 1,
    delegationReadinessGapPeople: [],
    releaseActions: [],
    hasFounderAttentionObjective: false,
    ...overrides,
  };
}

function actionSource(overrides: Partial<Extract<HandoffSourceInput, { objectType: "Action" }>> = {}): Extract<HandoffSourceInput, { objectType: "Action" }> {
  return {
    objectType: "Action",
    id: "action-1",
    owner: "Alex",
    ownerPersonId: "person-2",
    status: "Open",
    ...overrides,
  };
}

const noPeople: DelegationPersonInput[] = [];
const todayNoon = new Date(2026, 9, 1, 12, 0, 0).getTime();

describe("delegation readiness and ownership", () => {
  it("selects the exact Founder role ahead of earlier Founder-access co-founders", () => {
    const cofounder = person({ id: "cofounder", name: "Casey", role: "Co-founder", accessLevel: "Founder" });
    const founder = person({ id: "founder", name: "Morgan", role: " Founder ", accessLevel: "Founder" });

    expect(selectPrimaryFounder([cofounder, founder])).toBe(founder);
  });

  it("falls back to the first active Founder-access person in the supplied order", () => {
    const first = person({ id: "first", role: "Co-founder", accessLevel: "Founder" });
    const second = person({ id: "second", name: "Sam", role: "Executive", accessLevel: "Founder" });

    expect(selectPrimaryFounder([first, second])).toBe(first);
    expect(selectPrimaryFounder([person({ status: "Inactive", accessLevel: "Founder" })])).toBeNull();
  });

  it("classifies Founder access and co-founder roles as founder-class", () => {
    expect(isFounderClassPerson(person({ accessLevel: "Founder", role: "Founder" }))).toBe(true);
    expect(isFounderClassPerson(person({ role: "Co-Founder", accessLevel: "Team Member" }))).toBe(true);
    expect(isFounderClassPerson(person({ role: "co founder" }))).toBe(true);
    expect(isFounderClassPerson(person({ role: "Manager" }))).toBe(false);
  });

  it("resolves an active owner ID before conflicting owner text", () => {
    const people = [person({ id: "person-1", name: "Alex" }), person({ id: "person-2", name: "Jordan" })];

    expect(resolveActiveOwnerKey(people, "Alex", "person-2")).toBe("jordan");
  });

  it("falls back from an inactive or missing owner ID to an active name match", () => {
    const people = [person({ id: "person-1", name: "Alex" }), person({ id: "inactive", name: "Jordan", status: "Inactive" })];

    expect(resolveActiveOwnerKey(people, "  aLeX  ", "inactive")).toBe("alex");
    expect(resolveActiveOwnerKey(people, "Jordan", "missing")).toBeNull();
    expect(resolveActiveOwnerKey(people, "Unassigned")).toBeNull();
    expect(resolveActiveOwnerKey(people, "  ")).toBeNull();
  });

  it("recognizes Founder ownership only through a valid active owner", () => {
    const founder = person({ id: "founder", name: "Morgan", role: "Founder", accessLevel: "Founder" });
    const people = [founder, person({ id: "member", name: "Alex" })];

    expect(isFounderOwned(founder, people, { owner: "Morgan" })).toBe(true);
    expect(isFounderOwned(founder, people, { owner: "Morgan", ownerPersonId: "member" })).toBe(false);
    expect(isFounderOwned(founder, people, { owner: "Morgan", ownerPersonId: "inactive" })).toBe(true);
    expect(isFounderOwned(null, people, { owner: "Morgan" })).toBe(false);
  });

  it("reports missing readiness fields in role, responsibilities, authority order", () => {
    expect(getDelegationReadinessMissingFields(person({ role: " ", responsibilities: "", authority: "  " }))).toEqual([
      "role",
      "responsibilities",
      "authority",
    ]);
    expect(getDelegationReadinessMissingFields(person())).toEqual([]);
  });

  it("keeps co-founder readiness gaps distinct from operational team gaps", () => {
    const founder = person({ id: "founder", role: "Founder", accessLevel: "Founder" });
    const cofounder = person({ id: "cofounder", name: "Casey", role: "Co-founder", accessLevel: "Founder", authority: "" });
    const teamMember = person({ id: "team", name: "Taylor", authority: "" });
    const ready = person({ id: "ready", name: "Jamie" });
    const result = assessDelegationReadiness([founder, cofounder, teamMember, ready]);

    expect(result.primaryFounder).toBe(founder);
    expect(result.activeOperationalPeople.map(({ id }) => id)).toEqual(["cofounder", "team", "ready"]);
    expect(result.readyPeople.map(({ id }) => id)).toEqual(["ready"]);
    expect(result.teamReadinessGapPeople.map(({ id }) => id)).toEqual(["team"]);
    expect(result.cofounderReadinessGapPeople.map(({ id }) => id)).toEqual(["cofounder"]);
  });

  it("returns no area-qualified people for blank or unassigned areas", () => {
    const ready = [person({ id: "ready", pillar: "Garden Maintenance" })];
    expect(getDelegationReadyPeopleForArea("", ready)).toEqual([]);
    expect(getDelegationReadyPeopleForArea(" Unassigned ", ready)).toEqual([]);
    expect(getDelegationReadyPeopleForArea(" garden maintenance ", ready)).toEqual(ready);
  });

  it("ranks area-qualified capacity by attention, carried load, then name", () => {
    const people = [
      { id: "z", name: "Zoe", pillar: "Garden Maintenance" },
      { id: "b", name: "Bea", pillar: "Garden Maintenance" },
      { id: "a", name: "Ari", pillar: "Garden Maintenance" },
      { id: "other", name: "Other", pillar: "Excavation" },
    ];
    const facts: CapacityFacts[] = [
      { personId: "z", attentionCount: 0, carriedCount: 2 },
      { personId: "b", attentionCount: 0, carriedCount: 2 },
      { personId: "a", attentionCount: 0, carriedCount: 2 },
    ];

    expect(rankDelegationPeopleForArea("Garden Maintenance", people, facts).map(({ id }) => id)).toEqual(["a", "b", "z"]);
    expect(rankDelegationPeopleForArea("Garden Maintenance", people, [
      { personId: "z", attentionCount: 0, carriedCount: 2 },
      { personId: "b", attentionCount: 0, carriedCount: 2 },
      { personId: "a", attentionCount: 1, carriedCount: 0 },
    ]).map(({ id }) => id)).toEqual(["b", "z", "a"]);
    expect(rankDelegationPeopleForArea("Garden Maintenance", people, [
      { personId: "z", attentionCount: 0, carriedCount: 2 },
      { personId: "b", attentionCount: 0, carriedCount: 2 },
      { personId: "a", attentionCount: 0, carriedCount: 1 },
    ]).map(({ id }) => id)).toEqual(["a", "b", "z"]);
  });
});

describe("action dependency decisions", () => {
  it("prefers an unresolved Problem over a not-yet-actionable Decision", () => {
    expect(getActionDependencyBlocker(
      { relatedProblem: "problem-1", relatedDecision: "decision-1" },
      [{ id: "problem-1", title: "Gate", problemStatus: "Investigating" }],
      [{ id: "decision-1", title: "Supplier", decisionStatus: "Draft" }],
    )).toEqual({
      objectType: "Problem",
      id: "problem-1",
      reason: "BLOCKED BY PROBLEM: Gate",
      label: "Open blocker",
    });
  });

  it("returns a callback-free Decision blocker only when the decision is not actionable", () => {
    const blocker = getActionDependencyBlocker(
      { relatedDecision: "decision-1" },
      [],
      [{ id: "decision-1", title: "Fallback", decisionTitle: "", decisionStatus: "Under Review" }],
    );

    expect(blocker).toEqual({ objectType: "Decision", id: "decision-1", reason: "WAITING ON DECISION: Fallback", label: "Open decision" });
    expect(blocker).not.toHaveProperty("onOpen");
    expect(getActionDependencyBlocker({ relatedDecision: "active" }, [], [{ id: "active", title: "Active", decisionStatus: "Active" }])).toBeNull();
  });
});

describe("handoff decisions", () => {
  it("selects the newest handoff per object and preserves distinct objects with duplicate IDs", () => {
    const handoffs = [
      handoff({ id: "same", objectId: "action-1", transferredAt: "2026-09-01T00:00:00.000Z" }),
      handoff({ id: "same", objectId: "action-2", transferredAt: "2026-10-01T00:00:00.000Z" }),
      handoff({ id: "new", objectId: "action-1", transferredAt: "2026-10-02T00:00:00.000Z" }),
    ];

    expect([...selectLatestHandoffIdByObject(handoffs)]).toEqual([
      ["Action:action-1", "new"],
      ["Action:action-2", "same"],
    ]);
    const sameObject = deriveDelegationHandoffFollowThrough(
      [handoff({ id: "older", transferredAt: "2026-09-01T00:00:00.000Z" }), handoff({ id: "newer", transferredAt: "2026-10-02T00:00:00.000Z" })],
      [actionSource()],
      [],
      null,
      todayNoon,
    );
    expect(sameObject.items.map(({ id, state }) => [id, state])).toEqual([
      ["newer", "Healthy"],
      ["older", "Ownership changed"],
    ]);
  });

  it("marks a handoff with no matching source as missing and requiring intervention", () => {
    const result = deriveDelegationHandoffFollowThrough([handoff()], [], [], null, todayNoon);

    expect(result.items[0]).toMatchObject({
      state: "Source missing",
      reviewState: "Intervention required",
      reviewReasons: ["Linked work record is missing"],
      needsFounderIntervention: true,
    });
    expect(result.sourceMissing).toBe(1);
  });

  it("distinguishes work returned to Founder from transferred to another owner", () => {
    const founder = person({ id: "founder", name: "Morgan", role: "Founder", accessLevel: "Founder" });
    const people = [founder, person({ id: "person-2", name: "Alex" }), person({ id: "person-3", name: "Jordan" })];
    const returned = deriveDelegationHandoffFollowThrough(
      [handoff()],
      [actionSource({ owner: "Morgan", ownerPersonId: "founder" })],
      people,
      founder,
      todayNoon,
    );
    const changed = deriveDelegationHandoffFollowThrough(
      [handoff()],
      [actionSource({ owner: "Jordan", ownerPersonId: "person-3" })],
      people,
      founder,
      todayNoon,
    );

    expect(returned.items[0].state).toBe("Returned to Founder");
    expect(changed.items[0].state).toBe("Ownership changed");
  });

  it("applies explicit cancelled/completed status before source completion", () => {
    const completedSource: HandoffSourceInput = { objectType: "Action", id: "action-1", owner: "Alex", status: "Completed" };

    expect(deriveDelegationHandoffFollowThrough([handoff({ status: "Cancelled" })], [completedSource], [], null, todayNoon).items[0].state).toBe("Cancelled");
    expect(deriveDelegationHandoffFollowThrough([handoff()], [completedSource], [], null, todayNoon).items[0].state).toBe("Completed");
    expect(deriveDelegationHandoffFollowThrough([handoff({ objectType: "Project" })], [{ objectType: "Project", id: "action-1", owner: "Alex", status: "Cancelled" }], [], null, todayNoon).items[0].state).toBe("Cancelled");
  });

  it("marks an inactive recipient as requiring intervention", () => {
    const result = deriveDelegationHandoffFollowThrough(
      [handoff()],
      [actionSource()],
      [person({ id: "person-2", status: "Inactive" })],
      null,
      todayNoon,
    );

    expect(result.items[0].reviewState).toBe("Intervention required");
    expect(result.items[0].reviewReasons).toContain("Alex is inactive");
  });

  it("reports overdue and blocked source risks in deterministic reason order", () => {
    const result = deriveDelegationHandoffFollowThrough(
      [handoff()],
      [actionSource({ status: "Blocked", dueDate: "2026-09-30" })],
      [person({ id: "person-2" })],
      null,
      todayNoon,
    );

    expect(result.items[0].reviewState).toBe("Intervention required");
    expect(result.items[0].reviewReasons).toEqual(["Linked work is blocked", "Linked work is overdue"]);
  });

  it("classifies blocked Projects and high-severity Problems from minimal source facts", () => {
    const blockedProject = deriveDelegationHandoffFollowThrough(
      [handoff({ objectType: "Project", objectId: "project-1" })],
      [{ objectType: "Project", id: "project-1", owner: "Alex", status: "Blocked" }],
      [],
      null,
      todayNoon,
    ).items[0];
    const criticalProblem = deriveDelegationHandoffFollowThrough(
      [handoff({ objectType: "Problem", objectId: "problem-1" })],
      [{ objectType: "Problem", id: "problem-1", owner: "Alex", problemStatus: "Open", severity: "Critical" }],
      [],
      null,
      todayNoon,
    ).items[0];

    expect(blockedProject).toMatchObject({ state: "At risk", reviewState: "Intervention required", reviewReasons: ["Linked work is blocked"] });
    expect(criticalProblem).toMatchObject({ state: "At risk", reviewState: "Healthy", reviewReasons: [] });
  });

  it("preserves Lead follow-up risk and review-state distinction", () => {
    const result = deriveDelegationHandoffFollowThrough(
      [handoff({ objectType: "Lead", objectId: "lead-1" })],
      [{ objectType: "Lead", id: "lead-1", owner: "Alex", status: "Quote Sent" }],
      [],
      null,
      todayNoon,
    );

    expect(result.items[0]).toMatchObject({ state: "At risk", reviewState: "Healthy", reviewReasons: [] });
  });

  it("treats review dates before today as stale and today as due but not stale", () => {
    const source = [actionSource()];
    const yesterday = deriveDelegationHandoffFollowThrough([handoff({ reviewDate: "2026-09-30" })], source, [], null, todayNoon).items[0];
    const today = deriveDelegationHandoffFollowThrough([handoff({ reviewDate: "2026-10-01" })], source, [], null, todayNoon).items[0];
    const tomorrow = deriveDelegationHandoffFollowThrough([handoff({ reviewDate: "2026-10-02" })], source, [], null, todayNoon).items[0];

    expect(yesterday.state).toBe("At risk");
    expect(yesterday.reviewState).toBe("Review due");
    expect(today.state).toBe("Healthy");
    expect(today.reviewState).toBe("Review due");
    expect(tomorrow.reviewState).toBe("Healthy");
  });

  it("sorts output newest-first and aggregates every state count", () => {
    const result = deriveDelegationHandoffFollowThrough(
      [handoff({ id: "older", transferredAt: "2026-09-01T00:00:00.000Z" }), handoff({ id: "newer", transferredAt: "2026-10-01T00:00:00.000Z", objectId: "action-2" })],
      [actionSource({ id: "action-1" })],
      [],
      null,
      todayNoon,
    );

    expect(result.items.map(({ id }) => id)).toEqual(["newer", "older"]);
    expect(result).toMatchObject({ sourceMissing: 1, healthy: 1, atRisk: 0, completed: 0, cancelled: 0, reviewDue: 0, interventionRequired: 1, returnedToFounder: 0, ownershipChanged: 0 });
  });

  it("does not mutate handoff, source, or People inputs", () => {
    const handoffs = [handoff()];
    const sources = [actionSource()];
    const people = [person({ id: "person-2" })];
    const before = structuredClone({ handoffs, sources, people });

    deriveDelegationHandoffFollowThrough(handoffs, sources, people, null, todayNoon);

    expect({ handoffs, sources, people }).toEqual(before);
  });
});

describe("Project release status", () => {
  it("preserves the existing release-state mapping", () => {
    expect(getProjectExecutionReleaseStatus(null, null)).toBe("Not assessed");
    expect(getProjectExecutionReleaseStatus(null, { state: "Healthy" })).toBe("Released");
    expect(getProjectExecutionReleaseStatus(null, { state: "Returned to Founder" })).toBe("Not assessed");
    expect(getProjectExecutionReleaseStatus({ releaseAction: "Delegate Now", releaseClosureState: "Not started" }, null)).toBe("Ready to delegate");
    expect(getProjectExecutionReleaseStatus({ releaseAction: "Monitor / Retain Temporarily", releaseClosureState: "In progress" }, null)).toBe("In progress");
    expect(getProjectExecutionReleaseStatus({ releaseAction: "Prepare to Delegate", releaseClosureState: "Not started" }, null)).toBe("Blocked");
    expect(getProjectExecutionReleaseStatus(null, { state: "Completed" })).toBe("Released");
    expect(getProjectExecutionReleaseStatus(null, { state: "Cancelled" })).toBe("Released");
    expect(getProjectExecutionReleaseStatus({ releaseAction: "Complete Personally", releaseClosureState: "Resolved" }, null)).toBe("Not assessed");
  });
});

describe("execution release decisions", () => {
  it("applies Unblock First before authority and urgency, except founder-attention Projects", () => {
    expect(buildExecutionReleasePlan([candidate({ isBlocked: true, requiresAuthority: true, priorityOrSeverity: "Critical", dueDate: "2026-09-30" })], todayNoon).items[0].releaseAction).toBe("Unblock First");
    expect(buildExecutionReleasePlan([candidate({ objectType: "Project", isBlocked: true, requiresAuthority: true, hasFounderAttentionObjective: true, founderAttentionObjectiveTitle: "Founder objective" })], todayNoon).items[0].releaseAction).toBe("Retain — Founder Authority Required");
    expect(buildExecutionReleasePlan([candidate({ objectType: "Project", isBlocked: true, requiresAuthority: true, hasFounderAttentionObjective: true, founderAttentionObjectiveTitle: "" })], todayNoon).items[0].releaseAction).toBe("Retain — Founder Authority Required");
  });

  it("applies authority before overdue personal completion", () => {
    expect(buildExecutionReleasePlan([candidate({ requiresAuthority: true, dueDate: "2026-09-30", priorityOrSeverity: "High" })], todayNoon).items[0].releaseAction).toBe("Retain — Founder Authority Required");
  });

  it("classifies urgent high-priority work as complete personally before delegation", () => {
    expect(buildExecutionReleasePlan([candidate({ dueDate: "2026-10-04", priorityOrSeverity: "High" })], todayNoon).items[0].releaseAction).toBe("Complete Personally");
    expect(buildExecutionReleasePlan([candidate({ dueDate: "2026-09-30", priorityOrSeverity: "Low" })], todayNoon).items[0].releaseAction).toBe("Complete Personally");
  });

  it("chooses Delegate Now for area-qualified capacity and Prepare to Delegate otherwise", () => {
    expect(buildExecutionReleasePlan([candidate()], todayNoon).items[0].releaseAction).toBe("Delegate Now");
    expect(buildExecutionReleasePlan([candidate({ areaDelegationReadyPeople: [], capacityRankedDelegationPeople: [], delegationReadyPeopleCount: 0 })], todayNoon).items[0].releaseAction).toBe("Prepare to Delegate");
  });

  it("suppresses future follow-up waiting work unless an exception applies", () => {
    const waiting = candidate({ status: "Waiting", followUpDate: "2026-10-02" });
    expect(buildExecutionReleasePlan([waiting], todayNoon).items).toEqual([]);
    expect(buildExecutionReleasePlan([candidate({ ...waiting, isBlocked: true })], todayNoon).items[0].releaseAction).toBe("Unblock First");
    expect(buildExecutionReleasePlan([candidate({ ...waiting, priorityOrSeverity: "Critical", dueDate: "2026-10-04" })], todayNoon).items[0].releaseAction).toBe("Complete Personally");
    expect(buildExecutionReleasePlan([candidate({ ...waiting, requiresAuthority: true })], todayNoon).items[0].releaseAction).toBe("Retain — Founder Authority Required");
  });

  it("suppresses future-start work unless blocked, dependent, authority-bound, overdue, or critical", () => {
    const futureStart = candidate({ earliestExecutableDate: "2026-10-02", dueDate: "2026-10-10" });
    expect(buildExecutionReleasePlan([futureStart], todayNoon).items).toEqual([]);
    expect(buildExecutionReleasePlan([candidate({ ...futureStart, isBlocked: true })], todayNoon).items[0].releaseAction).toBe("Unblock First");
    expect(buildExecutionReleasePlan([candidate({ ...futureStart, dependencyBlockerReason: "Problem" })], todayNoon).items[0].releaseAction).toBe("Unblock First");
    expect(buildExecutionReleasePlan([candidate({ ...futureStart, requiresAuthority: true })], todayNoon).items[0].releaseAction).toBe("Retain — Founder Authority Required");
    expect(buildExecutionReleasePlan([candidate({ ...futureStart, dueDate: "2026-09-30" })], todayNoon).items[0].releaseAction).toBe("Complete Personally");
    expect(buildExecutionReleasePlan([candidate({ ...futureStart, priorityOrSeverity: "Critical" })], todayNoon).items[0].releaseAction).toBe("Delegate Now");
  });

  it("uses local calendar dates for urgency text and due boundaries", () => {
    expect(buildExecutionReleasePlan([candidate({ dueDate: "2026-10-01" })], todayNoon).items[0].urgencyText).toBe("Due today");
    expect(buildExecutionReleasePlan([candidate({ dueDate: "2026-10-08" })], todayNoon).items[0].urgencyText).toBe("Due in 7 days");
    expect(buildExecutionReleasePlan([candidate({ dueDate: "2026-10-09" })], todayNoon).items[0].urgencyText).toBe("Due in 8 days");
    expect(buildExecutionReleasePlan([candidate({ dueDate: "2026-09-30" })], todayNoon).items[0].urgencyText).toBe("Overdue by 1 day");
  });

  it("adds existing score weights for overdue, due-soon, and critical priority", () => {
    const overdue = buildExecutionReleasePlan([candidate({ isBlocked: true, dueDate: "2026-09-30", priorityOrSeverity: "Critical" })], todayNoon).items[0];
    const dueSoon = buildExecutionReleasePlan([candidate({ isBlocked: true, dueDate: "2026-10-04", priorityOrSeverity: "Critical" })], todayNoon).items[0];
    expect(overdue.priorityScore).toBe(350 + 150 + 100);
    expect(dueSoon.priorityScore).toBe(350 + 80 + 100);
  });

  it("uses the first matching release Action and retains the first historical match", () => {
    const releaseActions: ReleaseActionHistoryInput[] = [
      { id: "first", releaseSourceType: "Action", releaseSourceId: "action-1", releaseIntent: "Prepare to Delegate", status: "Cancelled" },
      { id: "second", releaseSourceType: "Action", releaseSourceId: "action-1", releaseIntent: "Prepare to Delegate", status: "Completed" },
    ];
    const activeRelease = buildExecutionReleasePlan([candidate({ areaDelegationReadyPeople: [], releaseActions })], todayNoon).items[0];
    expect(activeRelease.releaseActionId).toBe("first");
    expect(activeRelease.releaseClosureActionId).toBe("first");
    expect(activeRelease.releaseClosureState).toBe("Cancelled");

    const historical = buildExecutionReleasePlan([candidate({ releaseActions })], todayNoon).items[0];
    expect(historical.releaseClosureActionId).toBe("first");
  });

  it("sorts by score, breaks ties by title, and preserves input order for equal titles", () => {
    const result = buildExecutionReleasePlan([
      candidate({ id: "z", title: "Same title", isBlocked: true }),
      candidate({ id: "b", title: "Alpha", isBlocked: true }),
      candidate({ id: "a", title: "Same title", isBlocked: true }),
    ], todayNoon);

    expect(result.items.map(({ id }) => id)).toEqual(["b", "z", "a"]);
  });

  it("deduplicates by object and ID and reports complete summary counts and headline", () => {
    const result = buildExecutionReleasePlan([
      candidate({ id: "delegate" }),
      candidate({ id: "delegate", title: "duplicate" }),
      candidate({ id: "block", title: "Blocked", isBlocked: true }),
      candidate({ id: "prepare", title: "Prepare", areaDelegationReadyPeople: [], capacityRankedDelegationPeople: [], delegationReadyPeopleCount: 0 }),
      candidate({ id: "authority", title: "Authority", requiresAuthority: true }),
    ], todayNoon);

    expect(result.summary).toEqual({
      headline: "1 founder-owned item is intentionally retained for founder authority; 1 awaits delegation readiness.",
      totalFounderOwned: 4,
      delegateNowCount: 1,
      prepareToDelegateCount: 1,
      retainAuthorityCount: 1,
      unblockFirstCount: 1,
      completePersonallyCount: 0,
      monitorCount: 0,
      releasableCount: 2,
      releasablePct: 50,
    });
  });

  it("uses the broad releasable headline when every item is classified Prepare to Delegate", () => {
    const result = buildExecutionReleasePlan([candidate({
      areaDelegationReadyPeople: [],
      capacityRankedDelegationPeople: [],
      delegationReadyPeopleCount: 0,
    })], todayNoon);

    expect(result.summary.headline).toBe("Founder execution load is broadly releasable.");
  });

  it("uses deterministic injected time and leaves candidates unchanged", () => {
    const input = [candidate({ dueDate: "2026-10-01" })];
    const before = structuredClone(input);

    const result = buildExecutionReleasePlan(input, todayNoon);

    expect(result.items[0].urgencyText).toBe("Due today");
    expect(input).toEqual(before);
  });
});
