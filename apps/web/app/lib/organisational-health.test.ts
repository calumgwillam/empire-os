import { describe, expect, it } from "vitest";
import { buildOrganisationalHealth, type OrganisationalHealthInput } from "./organisational-health";

const nowMs = Date.UTC(2026, 0, 10, 12);

function input(overrides: Partial<OrganisationalHealthInput> = {}): OrganisationalHealthInput {
  return {
    workItems: [],
    founderOwnerKey: "founder",
    healthyHandoffCount: 0,
    atRiskHandoffCount: 0,
    decisions: [],
    nowMs,
    ...overrides,
  };
}

describe("buildOrganisationalHealth", () => {
  it("returns null work metrics and the no-work quality when there is no work", () => {
    expect(buildOrganisationalHealth(input())).toEqual({
      totalWork: 0,
      validOwned: 0,
      nonFounderOwned: 0,
      pctValidOwner: null,
      pctNonFounder: null,
      pctDelegatedStalled: null,
      topOwnerShare: null,
      delegationQuality: { label: "No active work", tone: "clear" },
      delegationScore: null,
      openDecisionCount: 0,
      activeDecisionCount: 0,
      underReviewDecisionCount: 0,
      openDecisionAgeSampleCount: 0,
      avgOpenDecisionDays: null,
      medianOpenDecisionDays: null,
      oldestOpenDecisionDays: null,
      selfSufficiencyPct: null,
    });
  });

  it("counts every supplied work item but only truthy resolved owner keys as valid", () => {
    const result = buildOrganisationalHealth(input({
      workItems: [
        { ownerKey: "founder" },
        { ownerKey: "operator" },
        { ownerKey: null },
        { ownerKey: "" },
      ],
    }));

    expect(result).toMatchObject({
      totalWork: 4,
      validOwned: 2,
      nonFounderOwned: 1,
      pctValidOwner: 50,
      pctNonFounder: 50,
      selfSufficiencyPct: 50,
    });
  });

  it("treats all validly owned work as non-Founder work when no founder key exists", () => {
    const result = buildOrganisationalHealth(input({
      founderOwnerKey: null,
      workItems: [{ ownerKey: "operator-a" }, { ownerKey: "operator-b" }],
    }));

    expect(result.nonFounderOwned).toBe(2);
    expect(result.pctNonFounder).toBe(100);
    expect(result.topOwnerShare).toBe(50);
  });

  it("calculates owner concentration over validly owned work", () => {
    const result = buildOrganisationalHealth(input({
      workItems: [
        { ownerKey: "founder" },
        { ownerKey: "operator" },
        { ownerKey: "operator" },
        { ownerKey: null },
      ],
    }));

    expect(result.validOwned).toBe(3);
    expect(result.topOwnerShare).toBe(67);
  });

  it("uses only healthy plus at-risk handoffs as denominator and at-risk as numerator", () => {
    const result = buildOrganisationalHealth(input({
      workItems: [{ ownerKey: "founder" }],
      healthyHandoffCount: 3,
      atRiskHandoffCount: 1,
    }));

    expect(result.pctDelegatedStalled).toBe(25);
  });

  it("returns null delegated stalled percentage when there are no healthy or at-risk handoffs", () => {
    const result = buildOrganisationalHealth(input({
      workItems: [{ ownerKey: "founder" }],
      healthyHandoffCount: 0,
      atRiskHandoffCount: 0,
    }));

    expect(result.pctDelegatedStalled).toBeNull();
  });

  it("applies the 30/35/25/10 score weights to rounded ownership facts", () => {
    const result = buildOrganisationalHealth(input({
      workItems: [
        { ownerKey: "founder" },
        { ownerKey: "operator" },
        { ownerKey: "operator" },
        { ownerKey: null },
      ],
      healthyHandoffCount: 3,
      atRiskHandoffCount: 1,
    }));

    expect(result).toMatchObject({
      pctValidOwner: 75,
      pctNonFounder: 67,
      topOwnerShare: 67,
      pctDelegatedStalled: 25,
      delegationScore: 62,
    });
  });

  it("renormalizes to 90 percent when there is no delegation denominator", () => {
    const result = buildOrganisationalHealth(input({
      workItems: [
        { ownerKey: "founder" },
        { ownerKey: "operator" },
        { ownerKey: "operator" },
        { ownerKey: null },
      ],
    }));

    expect(result.pctDelegatedStalled).toBeNull();
    expect(result.delegationScore).toBe(60);
  });

  it("preserves Strong, Adequate, Needs attention, and zero-valid-owner quality bands", () => {
    const strong = buildOrganisationalHealth(input({
      workItems: [{ ownerKey: "operator-a" }, { ownerKey: "operator-b" }],
    }));
    expect(strong).toMatchObject({ delegationScore: 86, delegationQuality: { label: "Strong", tone: "clear" } });

    const adequate = buildOrganisationalHealth(input({
      workItems: [
        { ownerKey: "founder" },
        { ownerKey: "operator" },
        { ownerKey: "operator" },
        { ownerKey: null },
      ],
    }));
    expect(adequate).toMatchObject({ delegationScore: 60, delegationQuality: { label: "Adequate", tone: "neutral" } });

    const needsAttention = buildOrganisationalHealth(input({ workItems: [{ ownerKey: "founder" }] }));
    expect(needsAttention).toMatchObject({ delegationScore: 33, delegationQuality: { label: "Needs attention", tone: "warn" } });

    const noneOwned = buildOrganisationalHealth(input({ workItems: [{ ownerKey: null }, { ownerKey: "" }] }));
    expect(noneOwned).toMatchObject({ delegationScore: 0, delegationQuality: { label: "Needs attention", tone: "warn" } });
  });

  it("selects only Active and Under Review decisions and counts each status", () => {
    const result = buildOrganisationalHealth(input({
      decisions: [
        { status: "Active", startDate: "2026-01-09T12:00:00.000Z" },
        { status: "Under Review", startDate: "2026-01-08T12:00:00.000Z" },
        { status: "Draft", startDate: "2026-01-01T12:00:00.000Z" },
        { status: "Completed", startDate: "2026-01-01T12:00:00.000Z" },
      ],
    }));

    expect(result).toMatchObject({ openDecisionCount: 2, activeDecisionCount: 1, underReviewDecisionCount: 1 });
  });

  it("excludes invalid, empty, epoch-zero, and future decision dates from age samples", () => {
    const result = buildOrganisationalHealth(input({
      decisions: [
        { status: "Active", startDate: "not a date" },
        { status: "Active", startDate: "" },
        { status: "Under Review", startDate: "1970-01-01T00:00:00.000Z" },
        { status: "Active", startDate: "2026-01-11T12:00:00.000Z" },
      ],
    }));

    expect(result.openDecisionCount).toBe(4);
    expect(result.openDecisionAgeSampleCount).toBe(0);
    expect(result.avgOpenDecisionDays).toBeNull();
    expect(result.medianOpenDecisionDays).toBeNull();
    expect(result.oldestOpenDecisionDays).toBeNull();
  });

  it("uses whole-day flooring, rounded average/even median, and the oldest valid age", () => {
    const result = buildOrganisationalHealth(input({
      decisions: [
        { status: "Active", startDate: "2026-01-09T13:00:00.000Z" },
        { status: "Active", startDate: "2026-01-08T12:00:00.000Z" },
        { status: "Under Review", startDate: "2026-01-07T12:00:00.000Z" },
        { status: "Active", startDate: "2026-01-06T12:00:00.000Z" },
      ],
    }));

    expect(result).toMatchObject({
      openDecisionAgeSampleCount: 4,
      avgOpenDecisionDays: 2,
      medianOpenDecisionDays: 3,
      oldestOpenDecisionDays: 4,
    });
  });

  it("rounds odd-sized median to its middle age and keeps the selected date input explicit", () => {
    const result = buildOrganisationalHealth(input({
      decisions: [
        { status: "Active", startDate: "2026-01-09T12:00:00.000Z" },
        { status: "Active", startDate: "2026-01-07T12:00:00.000Z" },
        { status: "Under Review", startDate: "2026-01-05T12:00:00.000Z" },
      ],
    }));

    expect(result).toMatchObject({ avgOpenDecisionDays: 3, medianOpenDecisionDays: 3, oldestOpenDecisionDays: 5 });
  });

  it("does not mutate inputs and is deterministic with the same nowMs", () => {
    const facts = input({
      workItems: [{ ownerKey: "founder" }, { ownerKey: "operator" }, { ownerKey: null }],
      healthyHandoffCount: 2,
      atRiskHandoffCount: 1,
      decisions: [
        { status: "Active", startDate: "2026-01-08T12:00:00.000Z" },
        { status: "Draft", startDate: "2026-01-01T12:00:00.000Z" },
      ],
    });
    const before = structuredClone(facts);
    const first = buildOrganisationalHealth(facts);
    const second = buildOrganisationalHealth(facts);

    expect(facts).toEqual(before);
    expect(first).toEqual(second);
  });
});