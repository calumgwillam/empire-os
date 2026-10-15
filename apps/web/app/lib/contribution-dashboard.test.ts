import { describe, expect, it, vi } from "vitest";
import {
  CONTRIBUTION_SAFETY, type ContributionAuditEvent, type ContributionEntity, type ContributionLedger,
  type ContributionPeriod, type ContributionRecord, type SharedContributionResult,
} from "./individual-contribution";
import { type ContributionReferenceSnapshot } from "./individual-contribution-reporting";
import { analyseContributionIntelligence, type ContributionIntelligenceInput } from "./contribution-intelligence";
import {
  buildContributionPrivatePersonView, buildFounderContributionDashboard, prepareContributionDashboardSource,
  type ContributionDashboardSource, type ContributionDimensionSelection,
} from "./contribution-dashboard";

const M = 60_000;
const NOW = 1_000 * M;
const SELF = { id: "self", revision: 1, sha256: "a".repeat(64) };
const PROOF = { id: "proof", revision: 1, sha256: "b".repeat(64) };
const PEOPLE = ["founder", "head", "employee", "contractor", "partner"];
const ALL: ContributionDimensionSelection = {
  personIds: null, periodIds: null, organisationIds: null, departments: null, operatingPillarIds: null, projects: null,
};
const PERIODS = [0, 1, 2].map(index => ({
  id: `p${index}`, period: { startMs: (100 + index * 120) * M, endMs: (220 + index * 120) * M },
}));
function append(ledger: ContributionLedger, body: ContributionAuditEvent["body"], atMs: number, actorPersonId = "recorder"): ContributionLedger {
  const sequence = ledger.events.length + 1;
  if ((ledger.events.at(-1)?.recordedAtMs ?? 0) > atMs) throw new Error("Invalid synthetic schedule.");
  return {
    ...ledger, revision: sequence, events: [...ledger.events, {
      id: `event-${sequence}`, sequence, previousEventId: ledger.events.at(-1)?.id ?? null, actorPersonId, recordedAtMs: atMs, body,
    }],
  };
}
function create(ledger: ContributionLedger, entity: ContributionEntity, atMs: number, actor = "recorder") {
  return append(ledger, { type: "created", entity }, atMs, actor);
}
function review(ledger: ContributionLedger, id: string, atMs: number, version = 1) {
  return append(ledger, {
    type: "reviewed", entityId: id, expectedVersion: version, decision: "approved", reason: "Independent synthetic review.", evidence: [PROOF],
  }, atMs, "reviewer");
}
function refs(): ContributionReferenceSnapshot {
  return {
    scope: { tenantId: "tenant", datasetId: "dataset" }, asOfMs: NOW,
    people: [
      { id: "founder", kind: "founder" }, { id: "head", kind: "department-head" },
      { id: "employee", kind: "employee" }, { id: "contractor", kind: "contractor" }, { id: "partner", kind: "partner" },
      ...["reviewer", "recorder", "observer", "challenger", "resolver"].map(id => ({ id, kind: "unclassified" as const })),
    ],
    businessIds: ["org", "second-org"],
    roles: [{ id: "role", businessId: "org" }],
    departments: [{ id: "department", businessId: "org" }, { id: "second-department", businessId: "org" }, { id: "department", businessId: "second-org" }],
    projects: [{ id: "project", businessId: "org" }, { id: "second-project", businessId: "org" }],
    actions: [{ id: "action", businessId: "org" }], financialRecords: [],
    evidence: [
      { ...SELF, recordedAtMs: 0, source: "self-report", custodianPersonId: "founder", availability: "available" },
      { ...PROOF, recordedAtMs: 0, source: "independent-observation", custodianPersonId: "observer", availability: "available" },
    ],
  };
}
function work(id: string, personId: string, period: ContributionPeriod, minutes: number): ContributionRecord {
  return {
    kind: "contribution", id, personId, businessId: "org", roleId: "role", departmentId: "department",
    projectId: "project", actionId: "action", pillarId: "garden-maintenance", category: "delivery",
    participation: "contributor", period, measure: { kind: "hours", reportedMinutes: minutes }, evidence: [SELF],
  };
}
function fixture(): ContributionIntelligenceInput {
  let ledger: ContributionLedger = { version: 1, scope: refs().scope, revision: 0, events: [] };
  for (const [index, item] of PERIODS.entries()) {
    ledger = create(ledger, {
      kind: "expectation", id: `expectation-${item.id}`, businessId: "org", roleId: "role", departmentId: "department",
      period: item.period, evidence: [PROOF],
      criteria: [{ id: "time", dimension: "corroborated-minutes", statement: "Explicit time, not value.", minimum: 60 }],
    }, 10 + index * 2);
    ledger = review(ledger, `expectation-${item.id}`, 11 + index * 2);
  }
  for (const item of PERIODS) for (const personId of PEOPLE) {
    const id = `work-${personId}-${item.id}`;
    const minutes = personId === "head" ? 30 : 60;
    ledger = create(ledger, work(id, personId, item.period, minutes), item.period.endMs, personId);
    ledger = append(ledger, { type: "hours-corroborated", entityId: id, expectedVersion: 1, minutes, evidence: [PROOF] }, item.period.endMs, "reviewer");
  }
  return {
    ledger, references: refs(), personIds: [...PEOPLE, "unknown"], periods: PERIODS,
    agreements: PERIODS.flatMap(item => PEOPLE.map(personId => ({
      id: `agreement-${personId}-${item.id}`, personId, businessId: "org", roleId: "role", departmentId: "department",
      period: item.period, expectationId: `expectation-${item.id}`, expectationVersion: 1, criterionId: "time",
      agreedMinutes: 60, responsibilityIds: ["delivery"], acceptedAtMs: M, reviewedAtMs: 2 * M, reviewedByPersonId: "reviewer", evidence: [PROOF],
    }))),
    deliveries: [], asOfMs: NOW, nowMs: NOW,
    trendPolicy: { minimumConsecutivePeriods: 3, minimumGapBasisPoints: 2_500 },
  };
}
function ledger(input: ContributionIntelligenceInput): ContributionLedger {
  return input.ledger as ContributionLedger;
}
function prepared(input = fixture()) {
  const result = prepareContributionDashboardSource(input);
  if (result.status !== "prepared") throw new Error(result.message);
  return result.source;
}
function dashboard(source = prepared(), selection = ALL) {
  const result = buildFounderContributionDashboard(source, selection);
  if (result.status !== "projected") throw new Error(result.message);
  return result.dashboard;
}
function refused(value: unknown) { expect(value).toMatchObject({ status: "refused", message: expect.any(String), ...CONTRIBUTION_SAFETY }); }
function assertFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(assertFrozen);
}
function collaboration(input = fixture()): ContributionIntelligenceInput {
  const period = PERIODS[0].period;
  let history = ledger(input);
  const result: SharedContributionResult = {
    kind: "shared-result", id: "shared", businessId: "org", resultKind: "outcome",
    origin: { type: "Action", id: "action", resultKey: "one-result" },
    occurredAtMs: period.endMs - 1, description: "Private business narrative.", evidence: [PROOF], money: null,
  };
  history = create(history, result, NOW - 100);
  for (const personId of ["founder", "head"]) history = create(history, {
    ...work(`participation-${personId}`, personId, period, 0),
    departmentId: personId === "head" ? "second-department" : "department",
    pillarId: personId === "head" ? "excavation" : "garden-maintenance",
    projectId: personId === "head" ? "second-project" : "project",
    measure: { kind: "outcome", resultId: "shared" },
  }, NOW - 99, personId);
  history = review(history, "shared", NOW - 98);
  history = create(history, {
    kind: "allocation", id: "allocation", resultId: "shared", resultVersion: 1,
    participationVersions: [{ entityId: "participation-founder", version: 1 }, { entityId: "participation-head", version: 1 }],
    shares: [{ personId: "founder", basisPoints: 6_000 }, { personId: "head", basisPoints: 2_500 }],
    rationale: "Reviewed contribution shares, not reward.", evidence: [PROOF],
  }, NOW - 97);
  history = review(history, "allocation", NOW - 96);
  return { ...input, ledger: history };
}

describe("validated read-only dashboard source", () => {
  it("reuses validated Phase 2 outputs unchanged and does not mutate or freeze caller input", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const phase2 = analyseContributionIntelligence(input);
    if (phase2.status !== "analysed") throw new Error(phase2.message);
    const source = prepared(input);
    const result = dashboard(source);
    expect(result.people.map(row => row.personWide)).toEqual(phase2.intelligence.people);
    expect(result.personWideAnalysis).toMatchObject({
      comparisons: phase2.intelligence.comparisons, trends: phase2.intelligence.trends,
      sustainedImbalances: phase2.intelligence.sustainedImbalances,
    });
    expect(result).toMatchObject(CONTRIBUTION_SAFETY);
    expect(dashboard(source)).toEqual(result);
    assertFrozen(result);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(input)).toBe(false);
  });

  it("rejects raw intelligence and forged/copied handles even when they look validated", () => {
    refused(buildFounderContributionDashboard({} as ContributionDashboardSource, ALL));
    refused(buildFounderContributionDashboard({ ...prepared() }, ALL));
    refused(buildFounderContributionDashboard(JSON.parse("{}"), ALL));
    refused(prepareContributionDashboardSource({ ...fixture(), ledger: { version: 1 } }));
  });

  it("does not invoke input getters or accept unsupported authority fields", () => {
    const input = fixture();
    const getter = vi.fn(() => input.ledger);
    refused(prepareContributionDashboardSource(Object.defineProperty({ ...input }, "ledger", { get: getter })));
    expect(getter).not.toHaveBeenCalled();
    refused(prepareContributionDashboardSource(Object.assign({}, input, { authorised: true })));
  });

  it("supports every supplied person kind without assigning founder or head privilege", () => {
    const rows = dashboard().people.filter(row => row.periodId === "p0");
    expect(rows.map(row => row.personKind).sort()).toEqual(["contractor", "department-head", "employee", "founder", "partner", "unknown"].sort());
    expect(rows.find(row => row.personId === "unknown")).toMatchObject({
      personWide: { hours: { reportedMinutes: null }, identityStatus: "unknown" },
      dimension: { metrics: { reportedMinutes: null } },
    });
  });

  it("keeps a prepared source detached from later input edits", () => {
    const input = fixture();
    const source = prepared(input);
    const before = dashboard(source);
    Object.assign(input, { ledger: null, references: null, personIds: [] });
    expect(dashboard(source)).toEqual(before);
  });
});

describe("explicit dimension selection without person-wide proration", () => {
  it("sums separately evidenced dimension records, not percentages of a person-wide total", () => {
    const input = fixture();
    const history = ledger(input);
    const period = PERIODS[0].period;
    const midpoint = period.startMs + 60 * M;
    let split: ContributionLedger = {
      ...history, events: history.events.map<ContributionAuditEvent>(event => {
        const body = event.body;
        if (body.type === "created" && body.entity.id === "work-founder-p0" && body.entity.kind === "contribution") return {
          ...event, body: { ...body, entity: { ...body.entity, period: { startMs: period.startMs, endMs: midpoint }, measure: { kind: "hours", reportedMinutes: 20 } } },
        };
        return body.type === "hours-corroborated" && body.entityId === "work-founder-p0"
          ? { ...event, body: { ...body, minutes: 20 } } : event;
      }),
    };
    split = create(split, {
      ...work("second-dimension-time", "founder", { startMs: midpoint, endMs: period.endMs }, 40),
      departmentId: "second-department", projectId: "second-project", pillarId: "excavation",
    }, NOW - 2, "founder");
    split = append(split, { type: "hours-corroborated", entityId: "second-dimension-time", expectedVersion: 1, minutes: 35, evidence: [PROOF] }, NOW - 1, "reviewer");
    const source = prepared({ ...input, ledger: split });
    const result = dashboard(source, { ...ALL, personIds: ["founder"], periodIds: ["p0"], operatingPillarIds: ["excavation"] });
    expect(result.people[0].personWide.hours).toMatchObject({ reportedMinutes: 60, corroboratedMinutes: 55 });
    expect(result.people[0].dimension.metrics).toMatchObject({
      reportedMinutes: 40, corroboratedMinutes: 35, reportedHours: { numerator: 40, denominator: 60 },
      corroboratedHours: { numerator: 35, denominator: 60 },
    });
    expect(result.people[0].dimension.records.map(record => record.recordId)).toEqual(["second-dimension-time"]);
  });

  it("uses individual record associations and keeps person-wide totals unchanged", () => {
    const input = fixture();
    const history = ledger(input);
    const split: ContributionLedger = {
      ...history, events: history.events.map<ContributionAuditEvent>(event =>
        event.body.type === "created" && event.body.entity.id === "work-founder-p0"
          ? { ...event, body: { ...event.body, entity: { ...event.body.entity, departmentId: "second-department", pillarId: "excavation", projectId: "second-project" } } } : event),
    };
    const source = prepared({ ...input, ledger: split });
    const filtered = dashboard(source, { ...ALL, departments: [{ businessId: "org", id: "second-department" }], periodIds: ["p0"] });
    expect(filtered.people.find(row => row.personId === "founder")?.dimension.metrics.reportedMinutes).toBe(60);
    expect(filtered.people.find(row => row.personId === "head")?.dimension.metrics.reportedMinutes).toBeNull();
    expect(filtered.people.find(row => row.personId === "head")?.personWide.hours.reportedMinutes).toBe(30);
    expect(filtered.people.find(row => row.personId === "head")?.personWide.commitments[0].shortfallMinutes).toBe(30);
    expect(filtered.notices.find(notice => notice.kind === "recorded-shortfall")?.basis).toBe("person-wide");
    expect(filtered.personWideAnalysis.trends).toEqual([]);
  });

  it.each([
    { organisationIds: ["second-org"] },
    { departments: [{ businessId: "second-org", id: "department" }] },
    { operatingPillarIds: ["excavation"] },
    { projects: [{ businessId: "org", id: "second-project" }] },
  ] as const)("does not invent associations for a valid but nonmatching filter %j", patch => {
    const result = dashboard(prepared(), { ...ALL, ...patch });
    expect(result.people.every(row => row.dimension.metrics.reportedMinutes === null)).toBe(true);
    expect(result.people.find(row => row.personId === "founder")?.personWide.hours.reportedMinutes).toBe(60);
  });

  it("uses OR inside an axis and AND across axes, including business-scoped repeated IDs", () => {
    const source = prepared(collaboration());
    const result = dashboard(source, {
      ...ALL, periodIds: ["p0"], operatingPillarIds: ["garden-maintenance", "excavation"],
      departments: [{ businessId: "org", id: "second-department" }], projects: [{ businessId: "org", id: "second-project" }],
    });
    expect(result.dimensionResults[0].results[0].matchingParticipationIds).toEqual(["participation-head"]);
    expect(result.people.find(row => row.personId === "founder")?.dimension.metrics.recordCount).toBe(0);
  });

  it("supports explicit null/unallocated filters without treating null as all or inferring from People", () => {
    const input = fixture();
    const history = ledger(input);
    const changed: ContributionLedger = {
      ...history, events: history.events.map<ContributionAuditEvent>(event => event.body.type === "created" && event.body.entity.id === "work-founder-p0"
        ? { ...event, body: { ...event.body, entity: { ...event.body.entity, departmentId: null, pillarId: null, projectId: null } } } : event),
    };
    const result = dashboard(prepared({ ...input, ledger: changed }), {
      ...ALL, periodIds: ["p0"], departments: [{ businessId: "org", id: null }], operatingPillarIds: [null], projects: [{ businessId: "org", id: null }],
    });
    const record = result.people.find(row => row.personId === "founder")?.dimension.records[0];
    expect(record?.attribution).toMatchObject({
      classification: "unallocated", unallocatedDimensions: ["departmentId", "pillarId", "projectId"],
    });
    expect(record?.reportedMinutes).toBe(60);
    expect(record?.corroboratedMinutes).toBeNull();
  });

  it("lists invalid associations separately and does not coerce them to a known department", () => {
    const input = fixture();
    const history = ledger(input);
    const changed: ContributionLedger = {
      ...history, events: history.events.map<ContributionAuditEvent>(event => event.body.type === "created" && event.body.entity.id === "work-founder-p0"
        ? { ...event, body: { ...event.body, entity: { ...event.body.entity, departmentId: "unknown-department" } } } : event),
    };
    const source = prepared({ ...input, ledger: changed });
    const result = dashboard(source, { ...ALL, periodIds: ["p0"], departments: [{ businessId: "org", id: "department" }] });
    const row = result.people.find(row => row.personId === "founder");
    expect(row?.dimension.records).toEqual([]);
    expect(row?.dimension.unresolvedAssociationRecordIds).toEqual(["work-founder-p0"]);
    const all = dashboard(source, { ...ALL, periodIds: ["p0"] });
    expect(all.people.find(row => row.personId === "founder")?.dimension.records[0].attribution.classification).toBe("ambiguous-or-disputed");
  });

  it.each([
    { personIds: ["not-in-source"] }, { periodIds: ["unknown"] }, { organisationIds: ["unknown"] },
    { departments: [{ businessId: "second-org", id: "second-department" }] },
    { operatingPillarIds: ["Operating Business"] }, { projects: [{ businessId: "second-org", id: "project" }] },
    { personIds: ["founder", "founder"] }, { operatingPillarIds: [null, null] },
  ])("refuses unknown, duplicate or cross-business selections %j", patch => {
    refused(buildFounderContributionDashboard(prepared(), Object.assign({}, ALL, patch)));
  });

  it("preserves empty selection semantics and refuses sparse/accessor selection fields", () => {
    const source = prepared();
    expect(dashboard(source, { ...ALL, personIds: [] }).people).toEqual([]);
    expect(dashboard(source, { ...ALL, periodIds: [] }).people).toEqual([]);
    expect(dashboard(source, { ...ALL, organisationIds: [] }).people.every(row => row.dimension.metrics.recordCount === 0)).toBe(true);
    const getter = vi.fn(() => null);
    refused(buildFounderContributionDashboard(source, Object.defineProperty({ ...ALL }, "projects", { get: getter })));
    expect(getter).not.toHaveBeenCalled();
    const sparse: string[] = []; sparse.length = 1;
    refused(buildFounderContributionDashboard(source, { ...ALL, personIds: sparse }));
  });

  it("keeps explicit zero distinct from no matching evidence", () => {
    const input = fixture();
    const history = ledger(input);
    const zero: ContributionLedger = {
      ...history, events: history.events.map<ContributionAuditEvent>(event => {
        const body = event.body;
        if (body.type === "created" && body.entity.id === "work-founder-p0" && body.entity.kind === "contribution") return {
          ...event, body: { ...body, entity: { ...body.entity, measure: { kind: "hours", reportedMinutes: 0 } } },
        };
        return body.type === "hours-corroborated" && body.entityId === "work-founder-p0"
          ? { ...event, body: { ...body, minutes: 0 } } : event;
      }),
    };
    const result = dashboard(prepared({ ...input, ledger: zero }), { ...ALL, periodIds: ["p0"] });
    expect(result.people.find(row => row.personId === "founder")?.dimension.metrics).toMatchObject({ reportedMinutes: 0, corroboratedMinutes: 0 });
    expect(result.people.find(row => row.personId === "unknown")?.dimension.metrics).toMatchObject({ reportedMinutes: null, corroboratedMinutes: null });
  });

  it("cannot launder overlapping time by filtering away another organisation's claim", () => {
    const input = fixture();
    const references = refs();
    const history = create(ledger(input), {
      ...work("cross-organisation-overlap", "founder", PERIODS[0].period, 60),
      businessId: "second-org", departmentId: "department", projectId: null, actionId: null, pillarId: "excavation",
    }, NOW - 1, "founder");
    const source = prepared({
      ...input, ledger: history,
      references: { ...references, roles: [...references.roles, { id: "role", businessId: "second-org" }] },
    });
    const result = dashboard(source, { ...ALL, personIds: ["founder"], periodIds: ["p0"], organisationIds: ["org"] });
    expect(result.people[0].dimension.metrics).toMatchObject({ reportedMinutes: 60, corroboratedMinutes: null });
    expect(result.people[0].dimension.records[0].issues).toContain("overlapping-time-claims");
    expect(result.people[0].personWide.hours.reportedMinutes).toBe(120);
  });

  it("canonicalises unordered filters deterministically", () => {
    const source = prepared();
    const first = { ...ALL, personIds: ["head", "founder"], periodIds: ["p2", "p0"], operatingPillarIds: ["excavation", "garden-maintenance"] as const };
    expect(dashboard(source, first)).toEqual(dashboard(source, {
      ...first, personIds: ["founder", "head"], periodIds: ["p0", "p2"], operatingPillarIds: ["garden-maintenance", "excavation"],
    }));
  });
});

describe("shared outcomes, disputes and evidence drilldown", () => {
  it("counts one linked result per period/selection and shows cross-dimension provenance instead of allocating its value", () => {
    const result = dashboard(prepared(collaboration()), { ...ALL, periodIds: ["p0"] });
    expect(result.dimensionResults[0].results).toHaveLength(1);
    const shared = result.dimensionResults[0].results[0];
    expect(shared.attribution).toMatchObject({
      classification: "spanning-dimensions", spanningDimensions: ["departmentId", "pillarId", "projectId"],
    });
    expect(shared.matchingParticipationIds).toEqual(["participation-founder", "participation-head"]);
    expect(shared).not.toHaveProperty("financialShare");
    expect(shared).not.toHaveProperty("dimensionValue");
    expect(result.people.find(row => row.personId === "founder")?.personWide.results[0].allocatedBasisPointsForPerson).toBe(6_000);
  });

  it("preserves spanning context and another person's dispute even with one person and one dimension selected", () => {
    const input = collaboration();
    const history = append(ledger(input), {
      type: "disputed", entityId: "participation-head", expectedVersion: 1, disputeId: "collaborator-dispute",
      reason: "Contested attribution.", evidence: [],
    }, NOW - 90, "challenger");
    const result = dashboard(prepared({ ...input, ledger: history }), {
      ...ALL, personIds: ["founder"], operatingPillarIds: ["garden-maintenance"], periodIds: ["p0"],
    });
    const shared = result.dimensionResults[0].results[0];
    expect(shared.matchingParticipationIds).toEqual(["participation-founder"]);
    expect(shared.attribution).toMatchObject({ classification: "ambiguous-or-disputed", spanningDimensions: ["departmentId", "pillarId", "projectId"] });
    expect(shared.trace.entities.map(entity => entity.id)).toContain("participation-head");
    expect(result.people[0].personWide.results[0].allocatedBasisPointsForPerson).toBeNull();
    expect(result.notices.some(notice => notice.kind === "unresolved-disputes")).toBe(true);
  });

  it("does not turn one person's participation across two projects into two organisational outcomes or dimension shares", () => {
    const input = collaboration();
    const history = create(ledger(input), {
      ...work("second-founder-participation", "founder", PERIODS[0].period, 0),
      projectId: "second-project", measure: { kind: "outcome", resultId: "shared" },
    }, NOW - 90, "founder");
    const source = prepared({ ...input, ledger: history });
    const all = dashboard(source, { ...ALL, personIds: ["founder"], periodIds: ["p0"] });
    expect(all.dimensionResults[0].results).toHaveLength(1);
    expect(all.dimensionResults[0].results[0].matchingParticipationIds).toEqual(["participation-founder", "second-founder-participation"]);
    const narrow = dashboard(source, { ...ALL, personIds: ["founder"], periodIds: ["p0"], projects: [{ businessId: "org", id: "second-project" }] });
    expect(narrow.dimensionResults[0].results[0].attribution.classification).toBe("spanning-dimensions");
    expect(narrow.dimensionResults[0].results[0]).not.toHaveProperty("allocatedBasisPoints");
    expect(narrow.people[0].dimension.metrics.reviewedAttributedParticipationIds).not.toContain("second-founder-participation");
  });

  it("traces commitments to exact expectations, time records, review/corroboration events and evidence versions", () => {
    const result = dashboard(prepared(), { ...ALL, personIds: ["founder"], periodIds: ["p0"] });
    const assessment = result.people[0].assessmentTraces[0];
    expect(assessment).toMatchObject({
      kind: "commitment", id: "agreement-founder-p0", expectationId: "expectation-p0", expectationVersion: 1, criterionId: "time",
    });
    expect(assessment.trace.entities.map(entity => entity.id)).toEqual(["expectation-p0", "work-founder-p0"]);
    expect(assessment.trace.entities.every(entity => entity.eventIds.length === 2)).toBe(true);
    expect(assessment.trace.evidence).toEqual([PROOF, SELF]);
    expect(JSON.stringify(result)).not.toContain("Independent synthetic review.");
  });

  it("retains period boundary records as excluded without prorating their minutes", () => {
    const input = fixture();
    const history = create(ledger(input), work("boundary", "founder", { startMs: PERIODS[0].period.startMs - M, endMs: PERIODS[0].period.endMs }, 10), NOW - 1, "founder");
    const result = dashboard(prepared({ ...input, ledger: history }), { ...ALL, personIds: ["founder"], periodIds: ["p0"] });
    expect(result.people[0].dimension.metrics).toMatchObject({ reportedMinutes: 60, corroboratedMinutes: null });
    expect(result.people[0].dimension.excludedBoundaryRecordIds).toEqual(["boundary"]);
  });

  it("does not label unavailable evidence as corroborated contribution or a genuine shortfall", () => {
    const input = fixture();
    const references = refs();
    const result = dashboard(prepared({
      ...input, references: { ...references, evidence: references.evidence.map(item => ({ ...item, availability: "restricted" })) },
    }), { ...ALL, personIds: ["head"], periodIds: ["p0"] });
    expect(result.people[0].dimension.metrics).toMatchObject({ reportedMinutes: 30, corroboratedMinutes: null, evidenceSupportedRecordCount: 0 });
    expect(result.notices.some(notice => notice.kind === "recorded-shortfall")).toBe(false);
    expect(result.people[0].personWide.evidenceCompleteness.missingOrUnusableEvidence.length).toBeGreaterThan(0);
  });

  it("separates disputed direct records from corroboration and retains trace evidence", () => {
    const input = fixture();
    const history = append(ledger(input), {
      type: "disputed", entityId: "work-founder-p0", expectedVersion: 1, disputeId: "own-dispute", reason: "Contested time.", evidence: [PROOF],
    }, NOW - 1, "challenger");
    const result = dashboard(prepared({ ...input, ledger: history }), { ...ALL, personIds: ["founder"], periodIds: ["p0"] });
    expect(result.people[0].dimension.records[0]).toMatchObject({
      corroboratedMinutes: null, evidenceAndContextSupported: false, attribution: { classification: "ambiguous-or-disputed" },
    });
    expect(result.people[0].dimension.records[0].trace.entities[0].eventIds).toHaveLength(3);
  });

  it("shows results with no dimension-bearing participation as unplaced, not attributed to the active filter", () => {
    const input = fixture();
    const history = create(ledger(input), {
      kind: "shared-result", id: "unplaced", businessId: "org", resultKind: "deliverable",
      origin: { type: "Action", id: "action", resultKey: "unplaced" }, occurredAtMs: PERIODS[0].period.endMs - 1,
      description: "No supported dimensional participation.", evidence: [PROOF], money: null,
    }, NOW - 1);
    const result = dashboard(prepared({ ...input, ledger: history }), { ...ALL, periodIds: ["p0"], operatingPillarIds: ["excavation"] });
    expect(result.dimensionResults[0]).toMatchObject({ results: [], unscopedResultIds: ["unplaced"] });
  });

  it("projects corrected record associations at the explicit audit cutoff without retaining stale support", () => {
    const input = fixture();
    const history = ledger(input);
    const original = history.events.find(event => event.body.type === "created" && event.body.entity.id === "work-founder-p0");
    if (original?.body.type !== "created" || original.body.entity.kind !== "contribution") throw new Error("Missing fixture.");
    const changed = append(history, {
      type: "corrected", entityId: "work-founder-p0", expectedVersion: 1,
      replacement: { ...original.body.entity, pillarId: "excavation" }, reason: "Explicit association correction.", evidence: [PROOF],
    }, NOW - 1);
    const current = dashboard(prepared({ ...input, ledger: changed }), { ...ALL, periodIds: ["p0"], personIds: ["founder"], operatingPillarIds: ["excavation"] });
    expect(current.people[0].dimension.metrics).toMatchObject({ reportedMinutes: 60, corroboratedMinutes: null });
    const asOfMs = history.events.at(-1)!.recordedAtMs;
    const historical = dashboard(prepared({ ...input, ledger: changed, asOfMs, references: { ...refs(), asOfMs } }), {
      ...ALL, periodIds: ["p0"], personIds: ["founder"], operatingPillarIds: ["garden-maintenance"],
    });
    expect(historical.people[0].dimension.metrics).toMatchObject({ reportedMinutes: 60, corroboratedMinutes: 60 });
    expect(historical.source.observedRevision).toBeLessThan(current.source.observedRevision);
  });

  it("traces explicit delivery timing to the agreement, canonical outcome and collaborative dependency history", () => {
    const input = collaboration();
    const result = dashboard(prepared({
      ...input, deliveries: [{
        id: "delivery-observation", agreementId: "agreement-founder-p0", responsibilityId: "delivery",
        resultId: "shared", resultVersion: 1, dueAtMs: PERIODS[0].period.endMs - 1,
        acceptedAtMs: 3 * M, reviewedAtMs: 4 * M, reviewedByPersonId: "reviewer", evidence: [PROOF],
      }],
    }), { ...ALL, personIds: ["founder"], periodIds: ["p0"] });
    const observation = result.people[0].assessmentTraces.find(item => item.kind === "delivery");
    expect(observation?.trace.entities.map(entity => entity.id)).toEqual(["allocation", "expectation-p0", "participation-founder", "participation-head", "shared"]);
    expect(result.people[0].personWide.reliability.evidencedOnTime).toBe(1);
  });

  it("keeps outcomes in occurrence periods while deriving dimension membership from participation outside that work period", () => {
    const input = collaboration();
    const history = ledger(input);
    const moved: ContributionLedger = {
      ...history, events: history.events.map<ContributionAuditEvent>(event =>
        event.body.type === "created" && event.body.entity.kind === "shared-result"
          ? { ...event, body: { ...event.body, entity: { ...event.body.entity, occurredAtMs: PERIODS[1].period.startMs + M } } } : event),
    };
    const result = dashboard(prepared({ ...input, ledger: moved }), {
      ...ALL, personIds: ["founder"], periodIds: ["p1"], operatingPillarIds: ["garden-maintenance"],
    });
    expect(result.dimensionResults[0].results.map(result => result.resultId)).toEqual(["shared"]);
    expect(result.people[0].dimension.resultIdsByOccurrence).toEqual(["shared"]);
    expect(result.people[0].dimension.records.map(record => record.recordId)).not.toContain("participation-founder");
  });
});

describe("explainable summaries and minimised person views", () => {
  it("summarises sustained person-wide recorded imbalance without inventing a dimension trend or personnel verdict", () => {
    const result = dashboard();
    expect(result.personWideAnalysis.sustainedImbalances.length).toBeGreaterThan(0);
    expect(result.notices.some(notice => notice.kind === "sustained-person-wide-imbalance" && notice.basis === "person-wide")).toBe(true);
    expect(result.people.every(row => row.personWide.actualUnderperformance === "not-established-requires-complete-evidence-and-human-context")).toBe(true);
    expect(result).not.toHaveProperty("score");
    expect(result.futureScenarios).toMatchObject({ status: "design-only-no-scenario-calculation", calculatesPay: false, allocatesProfit: false, allocatesOwnership: false });
  });

  it("does not clip trends or imbalances into a different selected historical claim", () => {
    const result = dashboard(prepared(), { ...ALL, periodIds: ["p0", "p2"] });
    expect(result.personWideAnalysis.trends).toEqual([]);
    expect(result.personWideAnalysis.sustainedImbalances).toEqual([]);
    expect(result.personWideAnalysis.comparisons.every(item => item.periodId !== "p1")).toBe(true);
  });

  it("preserves exact source trend direction and references when meaningful change is summarised", () => {
    const input = fixture();
    const history = ledger(input);
    const changed: ContributionLedger = {
      ...history, events: history.events.map<ContributionAuditEvent>(event => {
        const body = event.body;
        const id = body.type === "created" ? body.entity.id : body.entityId;
        const index = ["work-founder-p0", "work-founder-p1", "work-founder-p2"].indexOf(id);
        if (index === -1) return event;
        const minutes = [15, 30, 60][index];
        if (body.type === "created" && body.entity.kind === "contribution") return {
          ...event, body: { ...body, entity: { ...body.entity, measure: { kind: "hours", reportedMinutes: minutes } } },
        };
        return body.type === "hours-corroborated" ? { ...event, body: { ...body, minutes } } : event;
      }),
    };
    const result = dashboard(prepared({ ...input, ledger: changed }), { ...ALL, personIds: ["founder"] });
    const trend = result.personWideAnalysis.trends[0];
    expect(trend).toMatchObject({ direction: "increasing-recorded-fulfilment", netChangeMeetsGapPolicy: true });
    const notice = result.notices.find(notice => notice.kind === "meaningful-person-wide-change");
    expect(notice?.assessmentIds).toEqual(["agreement-founder-p0", "agreement-founder-p1", "agreement-founder-p2"]);
    expect(result.people.every(row => row.dimension.metrics.commitmentReliabilityAndTrends === "person-wide-only-not-dimension-prorated")).toBe(true);
  });

  it("does not disclose peer rows, source facets, evidence hashes, allocations or shared dispute details in private output", () => {
    const input = collaboration();
    const history = append(ledger(input), {
      type: "disputed", entityId: "participation-head", expectedVersion: 1, disputeId: "peer-private-dispute",
      reason: "Sensitive peer statement.", evidence: [],
    }, NOW - 90, "challenger");
    const source = prepared({ ...input, ledger: history });
    const result = buildContributionPrivatePersonView(source, "founder", { ...ALL, periodIds: ["p0"] });
    if (result.status !== "projected") throw new Error(result.message);
    const json = JSON.stringify(result);
    for (const secret of ["peer-private-dispute", "participation-head", "Private business narrative.", PROOF.sha256, '"financialShare":', '"comparisons":', '"options":', '"shared"']) {
      expect(json).not.toContain(secret);
    }
    expect(result.view.periods[0].ownOpenDisputeCount).toBe(0);
    expect(result.view.disclosure).toBe("minimised-design-only-not-server-authorisation");
    assertFrozen(result);
    refused(buildContributionPrivatePersonView(source, "founder", { ...ALL, personIds: ["head"] }));
    refused(buildContributionPrivatePersonView(source, "not-in-source", ALL));
    refused(buildContributionPrivatePersonView(source, "unknown", ALL));
  });
});
