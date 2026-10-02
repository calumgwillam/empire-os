import { describe, expect, it } from "vitest";
import {
  buildOperationalIndependence,
  type OperationalIndependenceInput,
  type OperationalIndependenceWorkItemInput,
} from "./operational-independence";

function item(
  overrides: Partial<OperationalIndependenceWorkItemInput> = {},
): OperationalIndependenceWorkItemInput {
  return {
    id: "item-1",
    objectType: "Action",
    title: "Work item",
    owner: "Operator",
    ownerPersonId: "person-1",
    pillar: "Garden Maintenance",
    hasImmediateFounderIntervention: false,
    hasValidActiveOwner: true,
    isFounderOwned: false,
    areaHasDelegationReadyPerson: false,
    ownerReadinessMissingFields: [],
    ...overrides,
  };
}

function input(overrides: Partial<OperationalIndependenceInput> = {}): OperationalIndependenceInput {
  return {
    actions: [],
    projects: [],
    leads: [],
    problems: [],
    founderReviewItems: [],
    founderAuthorityItems: [],
    delegationReadyPeopleCount: 0,
    delegationReadinessGapPeopleCount: 0,
    ...overrides,
  };
}

describe("buildOperationalIndependence", () => {
  it("returns null percentage and zero counts when there is no active work", () => {
    expect(buildOperationalIndependence(input())).toEqual({
      totalActiveWork: 0,
      independentCount: 0,
      readyToDelegateCount: 0,
      guardrailGapCount: 0,
      ownershipGapCount: 0,
      founderOnlyCount: 0,
      operationalIndependencePct: null,
      classifiedItems: [],
    });
  });

  it("classifies all five states with their exact reasons and counts", () => {
    const result = buildOperationalIndependence(input({
      actions: [
        item(),
        item({
          id: "ready",
          owner: "Founder",
          ownerPersonId: "founder",
          isFounderOwned: true,
          areaHasDelegationReadyPerson: true,
        }),
        item({ id: "guardrail", ownerReadinessMissingFields: ["role", "authority"] }),
        item({ id: "ownership", hasValidActiveOwner: false }),
        item({ id: "founder-only", hasImmediateFounderIntervention: true, hasValidActiveOwner: false }),
      ],
    }));

    expect(result).toMatchObject({
      totalActiveWork: 5,
      independentCount: 1,
      readyToDelegateCount: 1,
      guardrailGapCount: 1,
      ownershipGapCount: 1,
      founderOnlyCount: 1,
      operationalIndependencePct: 20,
    });
    expect(result.classifiedItems.map(({ state, reason }) => [state, reason])).toEqual([
      ["Independent", "The active non-founder owner has role, responsibilities, and authority defined, with no current Founder-intervention signal."],
      ["Ready to delegate", "This routine Founder-owned work has an active delegation-ready person assigned to Garden Maintenance."],
      ["Guardrail gap", "The assigned active non-founder owner is missing role, authority."],
      ["Ownership gap", "The item does not resolve to a valid active owner, so independent progress cannot be evidenced."],
      ["Founder-only", "The current risk, blocked, or authority state requires Founder judgement or intervention."],
    ]);
  });

  it("gives founder intervention precedence over invalid ownership and founder delegation", () => {
    const result = buildOperationalIndependence(input({
      actions: [
        item({
          id: "blocked",
          hasImmediateFounderIntervention: true,
          hasValidActiveOwner: false,
          isFounderOwned: true,
          areaHasDelegationReadyPerson: true,
        }),
      ],
      founderReviewItems: [{ kind: "Action", id: "review" }],
      founderAuthorityItems: [{ objectType: "Project", id: "authority" }],
      projects: [item({ id: "authority", objectType: "Project" })],
    }));

    expect(result.classifiedItems.map((classified) => [classified.id, classified.state])).toEqual([
      ["blocked", "Founder-only"],
      ["authority", "Founder-only"],
    ]);
    expect(result.classifiedItems[0].requiresFounderIntervention).toBe(true);
    expect(result.classifiedItems[1].requiresFounderIntervention).toBe(true);
  });

  it("matches review authority by kind and id and does not classify unrelated ids", () => {
    const result = buildOperationalIndependence(input({
      actions: [item(), item({ id: "reviewed" }), item({ id: "other" })],
      founderReviewItems: [{ kind: "Action", id: "reviewed" }],
      founderAuthorityItems: [{ objectType: "Opportunity", id: "other" }],
    }));

    expect(result.classifiedItems.map((classified) => classified.state)).toEqual([
      "Independent",
      "Founder-only",
      "Independent",
    ]);
  });

  it("classifies founder-owned work using area readiness before global readiness and readiness gaps", () => {
    const result = buildOperationalIndependence(input({
      actions: [
        item({ id: "assigned", isFounderOwned: true, areaHasDelegationReadyPerson: true }),
        item({ id: "other-area", isFounderOwned: true }),
        item({ id: "gap-people", isFounderOwned: true }),
        item({ id: "no-people", isFounderOwned: true }),
      ],
      delegationReadyPeopleCount: 1,
      delegationReadinessGapPeopleCount: 2,
    }));

    expect(result.classifiedItems.map(({ state, reason }) => [state, reason])).toEqual([
      ["Ready to delegate", "This routine Founder-owned work has an active delegation-ready person assigned to Garden Maintenance."],
      ["Guardrail gap", "Delegation-ready people exist, but none are assigned to Garden Maintenance."],
      ["Guardrail gap", "Delegation-ready people exist, but none are assigned to Garden Maintenance."],
      ["Guardrail gap", "Delegation-ready people exist, but none are assigned to Garden Maintenance."],
    ]);

    const readinessGapsOnly = buildOperationalIndependence(input({
      actions: [item({ isFounderOwned: true })],
      delegationReadinessGapPeopleCount: 1,
    }));
    expect(readinessGapsOnly.classifiedItems[0]).toMatchObject({
      state: "Guardrail gap",
      reason: "Operational delegation is plausible, but available people lack a complete role, responsibilities, or authority definition.",
    });

    const noAvailablePeople = buildOperationalIndependence(input({
      actions: [item({ isFounderOwned: true })],
    }));
    expect(noAvailablePeople.classifiedItems[0]).toMatchObject({
      state: "Ownership gap",
      reason: "This routine Founder-owned work has no active non-founder operational person available.",
    });
  });

  it("preserves missing-readiness field order and ownership-validity branch semantics", () => {
    const result = buildOperationalIndependence(input({
      actions: [
        item({ ownerReadinessMissingFields: ["responsibilities", "role"] }),
        item({ id: "invalid-founder", hasValidActiveOwner: false, isFounderOwned: true }),
      ],
    }));

    expect(result.classifiedItems.map(({ state, reason }) => [state, reason])).toEqual([
      ["Guardrail gap", "The assigned active non-founder owner is missing responsibilities, role."],
      ["Ownership gap", "The item does not resolve to a valid active owner, so independent progress cannot be evidenced."],
    ]);
  });

  it("preserves source-group order and duplicates without deduplicating ids", () => {
    const result = buildOperationalIndependence(input({
      actions: [item({ id: "same", title: "Action" })],
      projects: [item({ id: "same", objectType: "Project", title: "Project" })],
      leads: [item({ id: "lead", objectType: "Lead", title: "Lead" })],
      problems: [item({ id: "problem", objectType: "Problem", title: "Problem" })],
    }));

    expect(result.classifiedItems.map(({ id, objectType, title }) => [id, objectType, title])).toEqual([
      ["same", "Action", "Action"],
      ["same", "Project", "Project"],
      ["lead", "Lead", "Lead"],
      ["problem", "Problem", "Problem"],
    ]);
  });

  it("rounds the independent percentage to the nearest whole percent", () => {
    const result = buildOperationalIndependence(input({
      actions: [item(), item({ id: "second" }), item({ id: "unowned", hasValidActiveOwner: false })],
    }));

    expect(result.operationalIndependencePct).toBe(67);
  });

  it("retains the existing classified-item shape, including the action owner id", () => {
    const result = buildOperationalIndependence(input({
      actions: [item({ ownerPersonId: undefined })],
      projects: [item({ id: "project", objectType: "Project" })],
    }));

    expect(result.classifiedItems[0]).toHaveProperty("ownerPersonId", undefined);
    expect(result.classifiedItems[1]).not.toHaveProperty("ownerPersonId");
    expect(result.classifiedItems[0]).not.toHaveProperty("hasValidActiveOwner");
    expect(result.classifiedItems[0]).not.toHaveProperty("ownerReadinessMissingFields");
  });

  it("does not mutate any input arrays or records", () => {
    const source = input({
      actions: [item({ ownerReadinessMissingFields: ["role"] })],
      founderReviewItems: [{ kind: "Action", id: "other" }],
      founderAuthorityItems: [{ objectType: "Problem", id: "another" }],
    });
    const before = structuredClone(source);

    buildOperationalIndependence(source);

    expect(source).toEqual(before);
  });
});
