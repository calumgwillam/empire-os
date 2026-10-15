import { describe, expect, it, vi } from "vitest";
import {
  CONTRIBUTION_SAFETY, previewContributionAppend, projectContributionLedger,
  type ContributionAllocation, type ContributionAuditEvent, type ContributionEntity,
  type ContributionExpectation, type ContributionLedger, type ContributionMeasure,
  type ContributionRecord, type SharedContributionResult,
} from "./individual-contribution";
import {
  buildContributionPeriodReport, compareContributionPeriods,
  type ContributionReferenceSnapshot, type ContributionReportInput,
} from "./individual-contribution-reporting";
import { CONTRIBUTION_DURABLE_PREREQUISITES } from "./individual-contribution-persistence-contract";

const MINUTE = 60_000;
const NOW = 1_000 * MINUTE;
const PERIOD = { startMs: 100 * MINUTE, endMs: 300 * MINUTE };
const SCOPE = { tenantId: "tenant-test", datasetId: "dataset-test" };
const SELF = { id: "evidence-self", revision: 1, sha256: "a".repeat(64) };
const INDEPENDENT = { id: "evidence-independent", revision: 1, sha256: "b".repeat(64) };
const FINANCIAL = { id: "evidence-financial", revision: 1, sha256: "c".repeat(64) };

function record(
  id = "contribution-a", personId = "person-a",
  measure: ContributionMeasure = { kind: "hours", reportedMinutes: 60 },
): ContributionRecord {
  return {
    kind: "contribution", id, personId, businessId: "business-a", roleId: "role-a", departmentId: "department-a",
    projectId: "project-a", actionId: "action-a", pillarId: "garden-maintenance", category: "delivery",
    participation: "contributor", period: { startMs: 120 * MINUTE, endMs: 180 * MINUTE }, measure, evidence: [SELF],
  };
}
function sharedResult(
  id = "result-a", resultKind: SharedContributionResult["resultKind"] = "outcome",
): SharedContributionResult {
  return {
    kind: "shared-result", id, businessId: "business-a", resultKind,
    origin: { type: "Action", id: "action-a", resultKey: id },
    occurredAtMs: 180 * MINUTE, description: "Synthetic organisational result.", evidence: [resultKind === "financial" ? FINANCIAL : INDEPENDENT],
    money: resultKind === "financial" ? {
      currency: "GBP", minorUnitScale: 2, amountMinor: 101, financialKind: "revenue", basis: "recorded",
    } : null,
  };
}
function allocation(
  shares: ContributionAllocation["shares"] = [
    { personId: "person-a", basisPoints: 6_000 }, { personId: "person-b", basisPoints: 2_500 },
  ],
): ContributionAllocation {
  return {
    kind: "allocation", id: "allocation-a", resultId: "result-a", resultVersion: 1,
    participationVersions: [{ entityId: "participation-a", version: 1 }, { entityId: "participation-b", version: 1 }],
    shares, rationale: "Explicit evidence-based attribution proposal, not a reward.", evidence: [INDEPENDENT],
  };
}
function expectation(): ContributionExpectation {
  return {
    kind: "expectation", id: "expectation-a", businessId: "business-a", roleId: "role-a", departmentId: "department-a",
    period: PERIOD, evidence: [INDEPENDENT],
    criteria: [
      { id: "effort", dimension: "reported-minutes", statement: "Recorded effort for context, not enterprise value.", minimum: 45 },
      { id: "supported-effort", dimension: "corroborated-minutes", statement: "Independent evidence of time invested.", minimum: 45 },
      { id: "quality", dimension: "quality", statement: "Review actual work against the stated standard.", minimum: null },
    ],
  };
}
function ledger(): ContributionLedger { return { version: 1, scope: SCOPE, revision: 0, events: [] }; }
function append(
  history: ContributionLedger, body: ContributionAuditEvent["body"], actorPersonId = "recorder",
  recordedAtMs = Math.max(200 * MINUTE, (history.events.at(-1)?.recordedAtMs ?? 0) + 1),
): ContributionLedger {
  const previous = history.events.at(-1);
  const event: ContributionAuditEvent = {
    id: `event-${history.events.length + 1}`, sequence: history.events.length + 1,
    previousEventId: previous?.id ?? null, actorPersonId, recordedAtMs, body,
  };
  return { ...history, revision: history.revision + 1, events: [...history.events, event] };
}
function create(
  history: ContributionLedger, entity: ContributionEntity, actor = "recorder", atMs?: number,
) { return append(history, { type: "created", entity }, actor, atMs); }
function review(history: ContributionLedger, entityId: string, actor = "reviewer", expectedVersion = 1) {
  return append(history, {
    type: "reviewed", entityId, expectedVersion, decision: "approved", reason: "Independent review of the stated evidence.",
    evidence: [INDEPENDENT],
  }, actor);
}
function corroborate(history: ContributionLedger, minutes = 60, actor = "reviewer", expectedVersion = 1) {
  return append(history, {
    type: "hours-corroborated", entityId: "contribution-a", expectedVersion, minutes, evidence: [INDEPENDENT],
  }, actor);
}
function correct(history: ContributionLedger, replacement: ContributionEntity, expectedVersion = 1, actor = "recorder") {
  return append(history, {
    type: "corrected", entityId: replacement.id, expectedVersion, replacement,
    reason: "Explicit correction retaining the previous version.", evidence: [INDEPENDENT],
  }, actor);
}
function dispute(history: ContributionLedger, entityId: string, disputeId = "dispute-a", expectedVersion = 1) {
  return append(history, {
    type: "disputed", entityId, expectedVersion, disputeId, reason: "The assertion is contested.", evidence: [],
  }, "challenger");
}
function resolve(
  history: ContributionLedger, entityId: string, finding: "supported" | "not-supported" = "supported",
  expectedVersion = 1, actor = "resolver",
) {
  return append(history, {
    type: "dispute-resolved", entityId, expectedVersion, disputeId: "dispute-a", finding,
    reason: "Independent reasoned finding; no history is deleted.", evidence: [INDEPENDENT],
  }, actor);
}
function references(asOfMs = NOW): ContributionReferenceSnapshot {
  return {
    scope: SCOPE, asOfMs,
    people: [
      { id: "person-a", kind: "founder" }, { id: "person-b", kind: "contractor" }, { id: "reviewer", kind: "department-head" },
      { id: "observer", kind: "employee" }, { id: "recorder", kind: "employee" }, { id: "resolver", kind: "partner" },
      { id: "challenger", kind: "unclassified" }, { id: "reviewer-2", kind: "employee" },
    ],
    businessIds: ["business-a", "business-b"],
    roles: ["role-a", "role-b"].map(id => ({ id, businessId: "business-a" })),
    departments: ["department-a", "department-b"].map(id => ({ id, businessId: "business-a" })),
    projects: [{ id: "project-a", businessId: "business-a" }],
    actions: [{ id: "action-a", businessId: "business-a" }],
    financialRecords: [{ id: "financial-source-a", businessId: "business-a" }],
    evidence: [
      { ...SELF, recordedAtMs: 0, source: "self-report", custodianPersonId: "person-a", availability: "available" },
      { ...INDEPENDENT, recordedAtMs: 0, source: "independent-observation", custodianPersonId: "observer", availability: "available" },
      { ...FINANCIAL, recordedAtMs: 0, source: "financial-record", custodianPersonId: "observer", availability: "available" },
    ],
  };
}
function projection(history: ContributionLedger, asOfMs = NOW) {
  const result = projectContributionLedger(history, NOW, asOfMs);
  if (result.status !== "projected") throw new Error(result.message);
  return result.projection;
}
function report(history: ContributionLedger, refs = references(), period = PERIOD, asOfMs = NOW) {
  const result = buildContributionPeriodReport(history, refs, period, NOW, asOfMs);
  if (result.status !== "reported") throw new Error(result.message);
  return result.report;
}
function collaboration(kind: SharedContributionResult["resultKind"] = "outcome") {
  let history = create(ledger(), sharedResult("result-a", kind));
  history = create(history, record("participation-a", "person-a", { kind, resultId: "result-a" }), "person-a");
  history = create(history, record("participation-b", "person-b", { kind, resultId: "result-a" }), "person-b");
  history = review(history, "result-a");
  history = create(history, allocation());
  return review(history, "allocation-a");
}
function deepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(deepFrozen);
}
function refused(value: unknown) {
  expect(value).toMatchObject({ status: "refused", ...CONTRIBUTION_SAFETY, message: expect.any(String) });
}

describe("person-linked contribution identities and non-executing append-only foundation", () => {
  it("preserves all explicit work context and returns immutable detached projections", () => {
    const history = create(ledger(), record());
    const before = JSON.stringify(history);
    const result = projection(history);
    expect(result.entities[0]).toMatchObject({
      entity: record(), version: 1, createdByPersonId: "recorder", createdAtMs: 200 * MINUTE,
      authorPersonIds: ["recorder"], interestedPersonIds: ["person-a"], withdrawnAtMs: null,
    });
    deepFrozen(result);
    expect(JSON.stringify(history)).toBe(before);
    expect(Object.isFrozen(history)).toBe(false);
  });

  it("does not equate founders/contractors/partners or organisational labels with server authority", () => {
    const result = report(collaboration());
    expect(result).toMatchObject({ ...CONTRIBUTION_SAFETY, valueJudgement: "not-calculated", coverage: "not-established" });
    expect(result.people.map(person => person.personId)).toEqual(["person-a", "person-b"]);
    expect(CONTRIBUTION_DURABLE_PREREQUISITES).toContain("server-resolved-session-and-explicit-subject-to-person-binding");
    expect(CONTRIBUTION_DURABLE_PREREQUISITES).toContain("independent-allocation-review-even-for-founders-and-department-heads");
  });

  it.each(["id", "personId", "businessId"] as const)("rejects blank %s without inventing a name/identity", field => {
    refused(projectContributionLedger(create(ledger(), { ...record(), [field]: " " }), NOW));
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("refuses invalid integer minutes %s", reportedMinutes => {
    refused(projectContributionLedger(create(ledger(), record("contribution-a", "person-a", { kind: "hours", reportedMinutes })), NOW));
  });

  it("keeps actual zero distinct from missing time observations", () => {
    const zero = report(create(ledger(), record("contribution-a", "person-a", { kind: "hours", reportedMinutes: 0 })));
    expect(zero.people[0].reportedMinutes).toBe(0);
    expect(zero.people[0].corroboratedMinutes).toBeNull();
    const qualitative = report(create(ledger(), record("initiative-a", "person-a", { kind: "initiative", description: "Proposed a documented improvement." })));
    expect(qualitative.people[0].reportedMinutes).toBeNull();
    expect(qualitative.people[0].initiativeRecordIds).toEqual(["initiative-a"]);
    expect(report(ledger()).peopleWithNoIncludedRecords).toContain("person-a");
  });

  it("does not silently coerce unknown pillars, categories, measures or authority claims", () => {
    for (const candidate of [
      { ...record(), pillarId: "operating-business" }, { ...record(), category: "productivity-score" },
      { ...record(), measure: { kind: "equity", percentage: 20 } }, { ...record(), changesAuthority: true },
    ]) {
      const raw = { ...ledger(), revision: 1, events: [{ ...append(ledger(), { type: "created", entity: record() }).events[0], body: { type: "created", entity: candidate } }] };
      refused(projectContributionLedger(raw, NOW));
    }
  });

  it("rejects sparse arrays, accessors, extra fields and inherited record identity without invoking getters", () => {
    const getter = vi.fn(() => "person-a");
    const accessor = Object.defineProperty(record(), "personId", { get: getter });
    refused(projectContributionLedger(create(ledger(), accessor), NOW));
    expect(getter).not.toHaveBeenCalled();
    const sparse = new Array(1);
    refused(projectContributionLedger({ ...ledger(), revision: 1, events: sparse }, NOW));
    const inherited = Object.create(record());
    refused(projectContributionLedger(create(ledger(), inherited), NOW));
    refused(projectContributionLedger({ ...ledger(), source: "trusted" }, NOW));
  });

  it("rejects future observations and invalid half-open intervals", () => {
    for (const period of [
      { startMs: 0, endMs: 0 }, { startMs: 100, endMs: 0 }, { startMs: -1, endMs: 100 },
      { startMs: 200 * MINUTE, endMs: 260 * MINUTE },
    ]) refused(projectContributionLedger(create(ledger(), { ...record(), period }), NOW));
    refused(projectContributionLedger(create(ledger(), record(), "recorder", NOW + 1), NOW));
    refused(projectContributionLedger(ledger(), NOW, NOW + 1));
    refused(projectContributionLedger(ledger(), NaN));
  });

  it("rejects repeated entities/events, broken order, backward clocks and truncated revision claims", () => {
    const first = create(ledger(), record());
    refused(projectContributionLedger(create(first, record()), NOW));
    const next = create(first, record("record-b", "person-b"));
    for (const events of [
      [next.events[0], { ...next.events[1], id: next.events[0].id }],
      [next.events[0], { ...next.events[1], previousEventId: "wrong-head" }],
      [next.events[0], { ...next.events[1], sequence: 3 }],
      [next.events[0], { ...next.events[1], recordedAtMs: next.events[0].recordedAtMs - 1 }],
    ]) refused(projectContributionLedger({ ...next, events }, NOW));
    refused(projectContributionLedger({ ...next, events: [next.events[0]] }, NOW));
  });

  it("models competing appends against exact revision/head without pretending to commit or exclude writers", () => {
    const initial = create(ledger(), record());
    const left = correct(initial, { ...record(), roleId: "role-b" });
    const right = dispute(initial, "contribution-a");
    const a = previewContributionAppend(initial, left.events[1], 1, NOW);
    const b = previewContributionAppend(initial, right.events[1], 1, NOW);
    expect(a).toMatchObject({ status: "preview", durable: false, ...CONTRIBUTION_SAFETY });
    expect(b).toMatchObject({ status: "preview", durable: false });
    if (a.status !== "preview" || b.status !== "preview") throw new Error("Expected independent non-durable previews.");
    refused(previewContributionAppend(a.ledger, right.events[1], 1, NOW));
    refused(previewContributionAppend(b.ledger, left.events[1], 1, NOW));
    expect(initial.revision).toBe(1);
    expect(initial.events).toHaveLength(1);
  });
});

describe("historical corrections, disputes, withdrawal and independent review", () => {
  it("retains old evidence/context and invalidates corroboration when a record is corrected", () => {
    let history = corroborate(create(ledger(), record()));
    const beforeCorrection = history.events.at(-1)!.recordedAtMs;
    history = correct(history, { ...record(), roleId: "role-b", departmentId: "department-b", measure: { kind: "hours", reportedMinutes: 40 } });
    const historical = projection(history, beforeCorrection);
    const current = projection(history);
    expect(historical.entities[0].entity).toEqual(record());
    expect(historical.entities[0].corroborations).toHaveLength(1);
    expect(current.entities[0]).toMatchObject({ version: 2, reviews: [], corroborations: [] });
    expect(current.audit).toHaveLength(3);
    expect(report(history).people[0]).toMatchObject({ reportedMinutes: 40, corroboratedMinutes: null });
    expect(report(history, references(beforeCorrection), PERIOD, beforeCorrection).people[0].corroboratedMinutes).toBe(60);
    refused(projectContributionLedger(corroborate(history, 40, "reviewer", 1), NOW));
  });

  it.each(["personId", "businessId"] as const)("cannot transfer %s through a correction", field => {
    const history = create(ledger(), record());
    refused(projectContributionLedger(correct(history, { ...record(), [field]: "different" }), NOW));
  });

  it("cannot turn a time record into a different measurement or silently replace a result origin", () => {
    refused(projectContributionLedger(correct(create(ledger(), record()), record("contribution-a", "person-a", { kind: "initiative", description: "Different dimension." })), NOW));
    const value = sharedResult();
    refused(projectContributionLedger(correct(create(ledger(), value), { ...value, origin: { ...value.origin, id: "other-source" } }), NOW));
  });

  it("keeps open disputes through corrections; a correction is not dispute resolution", () => {
    let history = dispute(corroborate(create(ledger(), record())), "contribution-a");
    history = correct(history, { ...record(), measure: { kind: "hours", reportedMinutes: 30 } });
    history = corroborate(history, 30, "reviewer", 2);
    expect(projection(history).entities[0].disputes[0].resolution).toBeNull();
    expect(report(history).people[0].corroboratedMinutes).toBeNull();
    history = resolve(history, "contribution-a", "supported", 2);
    expect(report(history).people[0].corroboratedMinutes).toBe(30);
  });

  it.each(["person-a", "recorder", "challenger"])("does not let %s resolve its own interested dispute", actor => {
    const history = dispute(create(ledger(), record()), "contribution-a");
    refused(projectContributionLedger(resolve(history, "contribution-a", "supported", 1, actor), NOW));
  });

  it("preserves adverse findings, blocks quantitative support, and permits evidence-backed corrected versions", () => {
    let history = resolve(dispute(corroborate(create(ledger(), record())), "contribution-a"), "contribution-a", "not-supported");
    expect(report(history).people[0].corroboratedMinutes).toBeNull();
    refused(projectContributionLedger(resolve(history, "contribution-a"), NOW));
    history = correct(history, { ...record(), measure: { kind: "hours", reportedMinutes: 20 } });
    history = corroborate(history, 20, "reviewer", 2);
    expect(report(history).people[0].corroboratedMinutes).toBe(20);
    expect(projection(history).entities[0].disputes[0].resolution?.finding).toBe("not-supported");
  });

  it("withdraws erroneous records without deletion, replay, revival or loss of historical evidence", () => {
    const original = create(ledger(), record());
    const history = append(original, {
      type: "withdrawn", entityId: "contribution-a", expectedVersion: 1, reason: "Erroneous record; preserve it in history.", evidence: [INDEPENDENT],
    });
    expect(report(history).people).toEqual([]);
    expect(projection(history).audit).toHaveLength(2);
    expect(projection(history, original.events[0].recordedAtMs).entities[0].withdrawnAtMs).toBeNull();
    refused(projectContributionLedger(correct(history, record()), NOW));
    refused(projectContributionLedger(append(history, history.events[1].body), NOW));
  });

  it("prevents self-review by creators, beneficiaries and correction authors, including founders", () => {
    const value = sharedResult();
    refused(projectContributionLedger(review(create(ledger(), value), value.id, "recorder"), NOW));
    const history = create(collaboration(), { ...sharedResult("result-b"), origin: { type: "Manual", id: "source-b", resultKey: "outcome" } });
    const changed = correct(history, { ...sharedResult("result-b"), description: "Corrected description.", origin: { type: "Manual", id: "source-b", resultKey: "outcome" } }, 1, "resolver");
    refused(projectContributionLedger(review(changed, "result-b", "resolver", 2), NOW));
    const allocationDraft = collaboration().events.slice(0, -1);
    const draft = { ...ledger(), revision: allocationDraft.length, events: allocationDraft };
    refused(projectContributionLedger(review(draft, "allocation-a", "person-a"), NOW));
  });

  it("does not permit a prior allocation beneficiary to self-review after shares are removed", () => {
    const history = correct(collaboration(), allocation([{ personId: "person-b", basisPoints: 1_000 }]));
    refused(projectContributionLedger(review(history, "allocation-a", "person-a", 2), NOW));
  });

  it("detects result reviewer participation added later rather than certifying self-interested outcomes", () => {
    let history = create(ledger(), sharedResult());
    history = review(history, "result-a", "person-a");
    history = create(history, record("participation-a", "person-a", { kind: "outcome", resultId: "result-a" }), "person-a");
    const result = report(history);
    expect(result.results[0].independentlyReviewed).toBe(false);
    expect(result.issues).toContainEqual({ entityId: "result-a", code: "reviewer-conflict-of-interest" });
  });
});

describe("effort, corroboration, quality, initiative and evidence uncertainty", () => {
  it("reports time separately, corroborates only independently, and never adds duplicate corroborations", () => {
    const once = corroborate(create(ledger(), record()), 45);
    const twice = corroborate(once, 45, "reviewer-2");
    expect(report(twice).people[0]).toMatchObject({
      reportedMinutes: 60, corroboratedMinutes: 45, corroboratedSubsetMinutes: 45, uncorroboratedRecordIds: [],
      reportedMinutesWithoutCorroboration: 15, partiallyCorroboratedRecordIds: ["contribution-a"],
    });
    refused(projectContributionLedger(corroborate(once, 45), NOW));
  });

  it.each(["person-a", "recorder"])("rejects self/interested hours corroboration by %s", actor => {
    refused(projectContributionLedger(corroborate(create(ledger(), record()), 60, actor), NOW));
  });

  it("does not choose the highest, lowest or average of conflicting corroborations", () => {
    const history = corroborate(corroborate(create(ledger(), record()), 45), 60, "reviewer-2");
    const result = report(history);
    expect(result.people[0]).toMatchObject({ reportedMinutes: 60, corroboratedMinutes: null, corroboratedSubsetMinutes: 0 });
    expect(result.issues).toContainEqual({ entityId: "contribution-a", code: "conflicting-hours-corroborations" });
  });

  it("rejects excessive corroboration and reports missing/forged evidence rather than certifying time", () => {
    const history = create(ledger(), record());
    refused(projectContributionLedger(corroborate(history, 61), NOW));
    const corroborated = corroborate(history);
    for (const refs of [
      { ...references(), evidence: [] },
      { ...references(), evidence: references().evidence.map(entry => ({ ...entry, sha256: "c".repeat(64) })) },
      { ...references(), evidence: references().evidence.map(entry => ({ ...entry, source: "self-report" as const })) },
      { ...references(), evidence: references().evidence.map(entry => ({ ...entry, custodianPersonId: "person-a" })) },
    ]) expect(report(corroborated, refs).people[0].corroboratedMinutes).toBeNull();
  });

  it.each(["missing", "restricted"] as const)("does not treat %s evidence as independently inspectable", availability => {
    const refs = { ...references(), evidence: references().evidence.map(entry => ({ ...entry, availability })) };
    const result = report(corroborate(create(ledger(), record())), refs);
    expect(result.people[0].corroboratedMinutes).toBeNull();
    expect(result.issues.some(entry => entry.code === "evidence-not-available")).toBe(true);
  });

  it("rejects ambiguous evidence registries and does not use evidence created after the assertion", () => {
    const history = corroborate(create(ledger(), record()));
    refused(buildContributionPeriodReport(history, { ...references(), evidence: [...references().evidence, references().evidence[0]] }, PERIOD, NOW));
    const refs = {
      ...references(), evidence: references().evidence.map(entry => ({ ...entry, recordedAtMs: 500 * MINUTE })),
    };
    expect(report(history, refs).people[0].corroboratedMinutes).toBeNull();
    expect(report(history, refs).issues.some(entry => entry.code === "evidence-postdates-assertion")).toBe(true);
  });

  it("never corroborates overlapping time twice, including cross-business claims", () => {
    let history = corroborate(create(ledger(), record()));
    history = create(history, { ...record("hours-b"), businessId: "business-b" });
    history = append(history, {
      type: "hours-corroborated", entityId: "hours-b", expectedVersion: 1, minutes: 60, evidence: [INDEPENDENT],
    }, "reviewer");
    const result = report(history);
    expect(result.people).toHaveLength(2);
    expect(result.people.every(person => person.reportedMinutes === 60 && person.corroboratedMinutes === null)).toBe(true);
    expect(result.issues.filter(entry => entry.code === "overlapping-time-claims")).toHaveLength(2);
  });

  it("treats adjacent time intervals as nonoverlapping and refuses implicit boundary proration", () => {
    let history = corroborate(create(ledger(), record()));
    history = create(history, { ...record("hours-b"), period: { startMs: 180 * MINUTE, endMs: 240 * MINUTE } }, "recorder", 250 * MINUTE);
    history = append(history, {
      type: "hours-corroborated", entityId: "hours-b", expectedVersion: 1, minutes: 60, evidence: [INDEPENDENT],
    }, "reviewer");
    expect(report(history).people[0].reportedMinutes).toBe(120);
    expect(report(history).people[0].corroboratedMinutes).toBe(120);
    const narrow = report(history, references(), { startMs: 130 * MINUTE, endMs: 170 * MINUTE });
    expect(narrow.people).toEqual([]);
    expect(narrow.issues).toContainEqual({ entityId: "contribution-a", code: "cross-period-record-not-prorated" });
  });

  it("keeps quality/initiative and responsibility distinct from time and enterprise value", () => {
    let history = create(ledger(), record("quality-a", "person-a", {
      kind: "quality", criteria: "Documented delivery standard.", assessment: "needs-improvement",
    }));
    history = create(history, record("initiative-a", "person-a", { kind: "initiative", description: "Proposed a documented system improvement." }));
    const result = report(history);
    expect(result.people[0]).toMatchObject({
      reportedMinutes: null, qualityRecordIds: ["quality-a"], initiativeRecordIds: ["initiative-a"],
      outcomeIds: [], financialResultIds: [],
    });
    expect(result.valueJudgement).toBe("not-calculated");
    expect(projection(history).entities[0].entity).toMatchObject({ participation: "contributor", measure: { assessment: "needs-improvement" } });
  });

  it("reports unknown or ambiguous Person/context IDs explicitly, never resolving by name", () => {
    const history = corroborate(create(ledger(), { ...record(), personId: "missing-person", roleId: null, departmentId: null }));
    const result = report(history);
    expect(result.people[0].personId).toBe("missing-person");
    expect(result.people[0].corroboratedMinutes).toBeNull();
    expect(result.people[0].issueCodes).toEqual(expect.arrayContaining(["unknown-person", "missing-or-unknown-role", "missing-or-unknown-department"]));
    refused(buildContributionPeriodReport(history, { ...references(), people: [...references().people, references().people[0]] }, PERIOD, NOW));
  });

  it("does not resolve work/department/role IDs from another business as valid local context", () => {
    const history = corroborate(create(ledger(), record()));
    const refs = references();
    const mismatched = {
      ...refs,
      roles: refs.roles.map(entry => ({ ...entry, businessId: "business-b" })),
      departments: refs.departments.map(entry => ({ ...entry, businessId: "business-b" })),
      projects: refs.projects.map(entry => ({ ...entry, businessId: "business-b" })),
      actions: refs.actions.map(entry => ({ ...entry, businessId: "business-b" })),
    };
    const result = report(history, mismatched);
    expect(result.people[0].corroboratedMinutes).toBeNull();
    expect(result.people[0].issueCodes).toEqual(expect.arrayContaining([
      "missing-or-unknown-role", "missing-or-unknown-department", "unknown-project", "unknown-action",
    ]));
  });

  it("checks overlap against a straddling claim even though that claim is not prorated into the report", () => {
    let history = corroborate(create(ledger(), record()));
    history = create(history, {
      ...record("straddling-hours"), period: { startMs: 90 * MINUTE, endMs: 150 * MINUTE },
    });
    const result = report(history);
    expect(result.people[0].recordIds).toEqual(["contribution-a"]);
    expect(result.people[0].corroboratedMinutes).toBeNull();
    expect(result.people[0].issueCodes).toContain("cross-period-record-not-prorated");
    expect(result.issues).toContainEqual({ entityId: "contribution-a", code: "overlapping-time-claims" });
  });

  it("preserves partial supported coverage without representing unsupported records as zero actual work", () => {
    let history = corroborate(create(ledger(), record()), 45);
    history = create(history, {
      ...record("uncorroborated-hours"), period: { startMs: 180 * MINUTE, endMs: 240 * MINUTE },
    }, "recorder", 250 * MINUTE);
    const result = report(history).people[0];
    expect(result).toMatchObject({
      reportedMinutes: 120, corroboratedMinutes: null, corroboratedSubsetMinutes: 45,
      reportedMinutesWithoutCorroboration: 75, uncorroboratedRecordIds: ["uncorroborated-hours"],
    });
  });
});

describe("unique organisational outcomes and reviewed shared attribution", () => {
  it("counts a shared outcome once while recording separate participation and unequal explicit shares", () => {
    const result = report(collaboration());
    expect(result.uniqueResultCounts.outcome).toBe(1);
    expect(result.people.map(person => person.outcomeIds)).toEqual([["result-a"], ["result-a"]]);
    expect(result.results[0]).toMatchObject({
      participantIds: ["person-a", "person-b"], independentlyReviewed: true, attributionStatus: "reviewed",
      allocatedBasisPoints: 8_500, unallocatedBasisPoints: 1_500,
      effectiveShares: [
        { personId: "person-a", basisPoints: 6_000, money: null },
        { personId: "person-b", basisPoints: 2_500, money: null },
      ],
    });
  });

  it("does not count the same result twice for multiple records from the same person", () => {
    const history = create(collaboration(), record("participation-a-2", "person-a", { kind: "outcome", resultId: "result-a" }));
    const result = report(history);
    expect(result.uniqueResultCounts.outcome).toBe(1);
    expect(result.people.find(person => person.personId === "person-a")?.outcomeIds).toEqual(["result-a"]);
  });

  it.each([
    [{ personId: "person-a", basisPoints: 10_001 }],
    [{ personId: "person-a", basisPoints: 7_500 }, { personId: "person-b", basisPoints: 3_000 }],
    [{ personId: "person-a", basisPoints: 5_000 }, { personId: "person-a", basisPoints: 5_000 }],
    [{ personId: "person-a", basisPoints: -1 }],
    [{ personId: "person-a", basisPoints: 0.5 }],
  ].map(shares => ({ shares })))("refuses invalid/overallocated shares $shares", ({ shares }) => {
    const history = collaboration();
    refused(projectContributionLedger(correct(history, allocation(shares)), NOW));
  });

  it("accepts exactly 100% and explicitly retains 100% unallocated when no shares are approved", () => {
    const history = review(correct(collaboration(), allocation([{ personId: "person-a", basisPoints: 10_000 }])), "allocation-a", "reviewer", 2);
    expect(report(history).results[0]).toMatchObject({ allocatedBasisPoints: 10_000, unallocatedBasisPoints: 0 });
    const unreviewed = correct(history, allocation([]), 2);
    expect(report(unreviewed).results[0]).toMatchObject({ attributionStatus: "blocked", allocatedBasisPoints: 0, unallocatedBasisPoints: 10_000, effectiveShares: [] });
  });

  it("never fills unallocated shares equally, by time, by role, or by ownership labels", () => {
    let history = create(ledger(), sharedResult());
    history = create(history, { ...record("participation-a", "person-a", { kind: "outcome", resultId: "result-a" }), participation: "owner" });
    history = create(history, record("participation-b", "person-b", { kind: "outcome", resultId: "result-a" }));
    history = review(history, "result-a");
    expect(report(history).results[0]).toMatchObject({
      attributionStatus: "unallocated", allocatedBasisPoints: 0, unallocatedBasisPoints: 10_000, effectiveShares: [],
    });
  });

  it("refuses duplicate outcome origins, stacked allocation identities, foreign business links and unsupported beneficiaries", () => {
    const original = sharedResult();
    refused(projectContributionLedger(create(create(ledger(), original), { ...original, id: "duplicate-result" }), NOW));
    refused(projectContributionLedger(create(create(ledger(), original), {
      ...original, id: "duplicate-in-another-business", businessId: "business-b",
    }), NOW));
    refused(projectContributionLedger(create(collaboration(), { ...allocation(), id: "allocation-b" }), NOW));
    const foreign = { ...record("participation-a", "person-a", { kind: "outcome", resultId: "result-a" }), businessId: "business-b" };
    refused(projectContributionLedger(create(create(ledger(), original), foreign), NOW));
    refused(projectContributionLedger(create(create(ledger(), original), allocation([{ personId: "person-a", basisPoints: 1_000 }])), NOW));
  });

  it("invalidates allocations on result correction and requires a new reviewed allocation version", () => {
    let history = correct(collaboration(), { ...sharedResult(), description: "Corrected organisational result." });
    let result = report(history);
    expect(result.results[0]).toMatchObject({ attributionStatus: "blocked", unallocatedBasisPoints: 10_000 });
    expect(result.issues).toContainEqual({ entityId: "allocation-a", code: "allocation-binds-old-result-version" });
    history = review(history, "result-a", "reviewer", 2);
    history = correct(history, { ...allocation(), resultVersion: 2 });
    history = review(history, "allocation-a", "reviewer", 2);
    result = report(history);
    expect(result.results[0].attributionStatus).toBe("reviewed");
  });

  it("binds participation versions so changed responsibilities/evidence require a new allocation review", () => {
    let history = correct(collaboration(), {
      ...record("participation-a", "person-a", { kind: "outcome", resultId: "result-a" }),
      participation: "lead", roleId: "role-b",
    });
    expect(report(history).results[0]).toMatchObject({ attributionStatus: "blocked", unallocatedBasisPoints: 10_000 });
    expect(report(history).issues).toContainEqual({ entityId: "allocation-a", code: "allocation-binds-old-participation-version" });
    const rebound = {
      ...allocation(),
      participationVersions: [{ entityId: "participation-a", version: 2 }, { entityId: "participation-b", version: 1 }],
    };
    history = correct(history, rebound);
    expect(report(history).results[0].attributionStatus).toBe("blocked");
    history = review(history, "allocation-a", "reviewer", 2);
    expect(report(history).results[0].attributionStatus).toBe("reviewed");
  });

  it("refuses stale, duplicated and foreign participation-version bindings before allocation creation", () => {
    const draft = collaboration();
    for (const participationVersions of [
      [{ entityId: "participation-a", version: 2 }],
      [{ entityId: "participation-a", version: 1 }, { entityId: "participation-a", version: 1 }],
      [{ entityId: "result-a", version: 1 }],
      [],
    ]) refused(projectContributionLedger(correct(draft, { ...allocation(), participationVersions }), NOW));
  });

  it.each(["allocation-a", "result-a", "participation-a", "participation-b"])("blocks effective numerical attribution on disputed %s", id => {
    const result = report(dispute(collaboration(), id));
    expect(result.results[0]).toMatchObject({ allocatedBasisPoints: 0, unallocatedBasisPoints: 10_000, effectiveShares: [] });
    expect(result.results[0].attributionStatus).toBe("blocked");
  });

  it("restores support only after explicit independent resolution; rejected review is not silently outvoted", () => {
    let history = resolve(dispute(collaboration(), "allocation-a"), "allocation-a");
    expect(report(history).results[0].attributionStatus).toBe("reviewed");
    history = append(history, {
      type: "reviewed", entityId: "allocation-a", expectedVersion: 1, decision: "rejected",
      reason: "Allocation remains contested.", evidence: [INDEPENDENT],
    }, "reviewer-2");
    expect(report(history).results[0].attributionStatus).toBe("blocked");
    expect(report(history).issues).toContainEqual({ entityId: "allocation-a", code: "review-rejected-or-conflicting" });
  });

  it("preserves independently auditable allocation versions and history after disputes and corrections", () => {
    const old = collaboration();
    const oldAsOf = old.events.at(-1)!.recordedAtMs;
    let next = correct(dispute(old, "allocation-a"), allocation([{ personId: "person-a", basisPoints: 3_000 }]));
    next = resolve(next, "allocation-a", "supported", 2);
    next = review(next, "allocation-a", "reviewer", 2);
    expect(report(next).results[0].allocatedBasisPoints).toBe(3_000);
    expect(report(next, references(oldAsOf), PERIOD, oldAsOf).results[0].allocatedBasisPoints).toBe(8_500);
    expect(projection(next).audit.slice(0, old.events.length)).toEqual(old.events);
  });

  it("does not permit resolving one dispute to close a different still-open dispute", () => {
    let history = dispute(collaboration(), "allocation-a");
    history = dispute(history, "allocation-a", "dispute-b");
    history = resolve(history, "allocation-a");
    expect(report(history).results[0].attributionStatus).toBe("blocked");
    expect(projection(history).entities.find(state => state.entity.id === "allocation-a")?.disputes)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: "dispute-b", resolution: null })]));
  });

  it("blocks review support when a result dispute resolver is also a historical participant", () => {
    let history = dispute(collaboration(), "result-a");
    history = resolve(history, "result-a", "supported", 1, "person-a");
    const result = report(history);
    expect(result.results[0].independentlyReviewed).toBe(false);
    expect(result.results[0].attributionStatus).toBe("blocked");
    expect(result.issues).toContainEqual({ entityId: "result-a", code: "resolver-conflict-of-interest" });
  });
});

describe("financial attribution without double counting, rounding drift or false precision", () => {
  it("counts money once organisationally and represents fractional minor-unit shares exactly", () => {
    const result = report(collaboration("financial"));
    expect(result.uniqueResultCounts.financial).toBe(1);
    expect(result.financialBuckets).toEqual([{
      businessId: "business-a", currency: "GBP", minorUnitScale: 2, financialKind: "revenue", basis: "recorded",
      reportedAmountMinor: 101, independentlyReviewedAmountMinor: 101, resultIds: ["result-a"],
    }]);
    expect(result.results[0].effectiveShares.map(share => share.money)).toEqual([
      { wholeMinorUnits: 60, remainderNumerator: 6_000, denominator: 10_000 },
      { wholeMinorUnits: 25, remainderNumerator: 2_500, denominator: 10_000 },
    ]);
    expect(result.results[0].unallocatedMoney).toEqual({ wholeMinorUnits: 15, remainderNumerator: 1_500, denominator: 10_000 });
    expect(result.people.map(person => person.financialResultIds)).toEqual([["result-a"], ["result-a"]]);
  });

  it("keeps currencies, minor-unit scales, businesses, financial categories and estimates separate", () => {
    let history = collaboration("financial");
    const variants = [
      { currency: "USD" }, { minorUnitScale: 0 }, { financialKind: "capital-contributed" as const },
      { basis: "estimated" as const },
    ];
    for (const [index, variant] of variants.entries()) {
      const value = sharedResult(`result-${index}`, "financial");
      if (!value.money) throw new Error("Expected money fixture.");
      history = create(history, { ...value, money: { ...value.money, ...variant } });
    }
    const otherBusiness = sharedResult("result-business-b", "financial");
    history = create(history, { ...otherBusiness, businessId: "business-b" });
    const result = report(history);
    expect(result.financialBuckets).toHaveLength(6);
    expect(result.financialBuckets.filter(bucket => bucket.independentlyReviewedAmountMinor === 101)).toHaveLength(1);
    expect(result.financialBuckets.every(bucket => bucket.reportedAmountMinor === 101)).toBe(true);
  });

  it("does not silently claim that a reported/estimated amount is realised or audited cash", () => {
    const value = sharedResult("result-a", "financial");
    if (!value.money) throw new Error("Expected money.");
    const result = report(create(ledger(), { ...value, money: { ...value.money, basis: "estimated", financialKind: "loss-avoided" } }));
    expect(result.financialBuckets[0]).toMatchObject({
      basis: "estimated", financialKind: "loss-avoided", independentlyReviewedAmountMinor: 0, reportedAmountMinor: 101,
    });
    expect(result.results[0]).toMatchObject({ independentlyReviewed: false, allocatedBasisPoints: 0 });
  });

  it("requires financial-record evidence and matching business-scoped financial origins", () => {
    const value = sharedResult("result-a", "financial");
    const unsupported = review(create(ledger(), { ...value, evidence: [INDEPENDENT] }), "result-a");
    expect(report(unsupported).results[0].independentlyReviewed).toBe(false);
    expect(report(unsupported).issues).toContainEqual({ entityId: "result-a", code: "financial-record-evidence-required" });
    const foreign = review(create(ledger(), {
      ...value, origin: { type: "Finance", id: "financial-source-a", resultKey: "revenue-a" }, businessId: "business-b",
    }), "result-a");
    expect(report(foreign).results[0].independentlyReviewed).toBe(false);
    expect(report(foreign).issues).toContainEqual({ entityId: "result-a", code: "unknown-origin-financial-record" });
  });

  it("uses exact safe integers and refuses overflowing totals instead of rounding", () => {
    const value = sharedResult("maximum-a", "financial");
    if (!value.money) throw new Error("Expected money.");
    let history = create(ledger(), { ...value, money: { ...value.money, amountMinor: Number.MAX_SAFE_INTEGER } });
    const second = sharedResult("maximum-b", "financial");
    history = create(history, second);
    refused(buildContributionPeriodReport(history, references(), PERIOD, NOW));
  });

  it("preserves exact fractional shares even when multiplying a maximum-safe financial amount", () => {
    const value = sharedResult("result-a", "financial");
    if (!value.money) throw new Error("Expected money.");
    let history = correct(collaboration("financial"), {
      ...value, money: { ...value.money, amountMinor: Number.MAX_SAFE_INTEGER },
    });
    history = review(history, "result-a", "reviewer", 2);
    history = correct(history, { ...allocation(), resultVersion: 2 });
    history = review(history, "allocation-a", "reviewer", 2);
    const result = report(history).results[0];
    expect(result.attributionStatus).toBe("reviewed");
    const portions = [...result.effectiveShares.map(share => share.money), result.unallocatedMoney];
    const numerator = portions.reduce((total, portion) => {
      if (!portion) throw new Error("Expected an exact financial share.");
      return total + BigInt(portion.wholeMinorUnits) * BigInt(10_000) + BigInt(portion.remainderNumerator);
    }, BigInt(0));
    expect(numerator).toBe(BigInt(Number.MAX_SAFE_INTEGER) * BigInt(10_000));
    expect(result.effectiveShares.reduce((total, share) => total + share.basisPoints, result.unallocatedBasisPoints)).toBe(10_000);
  });

  it.each(["GBP ", "", "usd"])("rejects implicit or malformed currency %j", currency => {
    const value = sharedResult("result-a", "financial");
    if (!value.money) throw new Error("Expected money.");
    refused(projectContributionLedger(create(ledger(), { ...value, money: { ...value.money, currency } }), NOW));
  });

  it("does not count a withdrawn financial outcome or automatically reassign its shares", () => {
    const history = append(collaboration("financial"), {
      type: "withdrawn", entityId: "result-a", expectedVersion: 1, reason: "Source amount was erroneous.", evidence: [INDEPENDENT],
    });
    const result = report(history);
    expect(result.uniqueResultCounts.financial).toBe(0);
    expect(result.financialBuckets).toEqual([]);
    expect(result.results).toEqual([]);
    expect(projection(history).entities.find(state => state.entity.id === "allocation-a")).toBeDefined();
  });
});

describe("role-specific expectations and cautious period comparisons", () => {
  function expectedHours() {
    let history = create(ledger(), expectation(), "recorder", MINUTE);
    history = append(history, {
      type: "reviewed", entityId: "expectation-a", expectedVersion: 1, decision: "approved",
      reason: "Expectations reviewed before the period.", evidence: [INDEPENDENT],
    }, "reviewer", 2 * MINUTE);
    return corroborate(create(history, record()));
  }
  function reportInput(history: ContributionLedger, period = PERIOD, refs = references()): ContributionReportInput {
    return { ledger: history, references: refs, period, asOfMs: NOW };
  }

  it("compares observed dimensions to prospective role criteria without treating them as a value score", () => {
    const result = report(expectedHours());
    expect(result.expectations.find(entry => entry.criterionId === "effort")).toMatchObject({
      personId: "person-a", observed: 60, minimum: 45, recordedMinimumComparison: "at-or-above", status: "human-review-required",
      reasons: ["coverage-not-established"],
    });
    expect(result.expectations.find(entry => entry.criterionId === "supported-effort")).toMatchObject({ observed: 60, recordedMinimumComparison: "at-or-above" });
    expect(result.expectations.find(entry => entry.criterionId === "quality")?.recordedMinimumComparison).toBeNull();
    expect(result.valueJudgement).toBe("not-calculated");
  });

  it("reports an observed shortfall without converting it into a person judgement or contractual change", () => {
    let history = expectedHours();
    history = correct(history, { ...record(), measure: { kind: "hours", reportedMinutes: 30 } });
    history = corroborate(history, 30, "reviewer", 2);
    const result = report(history);
    expect(result.expectations.find(entry => entry.criterionId === "effort")).toMatchObject({
      observed: 30, minimum: 45, recordedMinimumComparison: "below", status: "human-review-required",
    });
    expect(result).toMatchObject(CONTRIBUTION_SAFETY);
  });

  it("does not apply retrospective, overlapping or mismatched period expectations as settled standards", () => {
    const retrospective = review(create(create(ledger(), record()), expectation()), "expectation-a");
    expect(report(retrospective).expectations.every(entry => entry.status === "not-comparable")).toBe(true);
    const other = { ...expectation(), id: "expectation-b" };
    const overlapping = create(expectedHours(), other);
    expect(report(overlapping).expectations.some(entry => entry.reasons.includes("overlapping-expectations"))).toBe(true);
    expect(report(expectedHours(), references(), { startMs: 100 * MINUTE, endMs: 250 * MINUTE })
      .expectations.every(entry => entry.reasons.includes("expectation-period-mismatch-no-proration"))).toBe(true);
  });

  it("does not infer zero contribution or role assignment for people without observations", () => {
    const history = review(create(ledger(), expectation()), "expectation-a");
    const result = report(history);
    expect(result.people).toEqual([]);
    expect(result.expectations.every(entry => entry.personId === null && entry.observed === null)).toBe(true);
    expect(result.peopleWithNoIncludedRecords).toContain("person-a");
  });

  it("preserves role context changes without silently applying the old role's expectation to new work", () => {
    const changed = correct(expectedHours(), { ...record(), roleId: "role-b", departmentId: "department-b" });
    const result = report(changed);
    expect(result.people[0].roleContexts).toEqual([{ roleId: "role-b", departmentId: "department-b" }]);
    expect(result.expectations.every(entry => entry.personId === null)).toBe(true);
  });

  it("refuses scalar quality/financial targets and preserves explicit human judgement", () => {
    for (const dimension of ["quality", "financial"] as const) {
      const value = { ...expectation(), criteria: [{ id: "bad-score", dimension, minimum: 10, statement: "Not a permissible scalar." }] };
      refused(projectContributionLedger(create(ledger(), value), NOW));
    }
  });

  it("compares separate equal-length periods only for the same explicit person/business context", () => {
    const left = corroborate(create(ledger(), record()));
    const laterPeriod = { startMs: 300 * MINUTE, endMs: 500 * MINUTE };
    const laterRecord = { ...record(), period: { startMs: 320 * MINUTE, endMs: 380 * MINUTE }, measure: { kind: "hours" as const, reportedMinutes: 45 } };
    let right = create(ledger(), laterRecord, "recorder", 400 * MINUTE);
    right = corroborate(right, 45);
    const comparison = compareContributionPeriods(reportInput(left), reportInput(right, laterPeriod), "person-a", "business-a", NOW);
    expect(comparison).toMatchObject({
      status: "compared", comparableRecordedObservations: true, reportedMinutesDelta: -15, corroboratedMinutesDelta: -15,
      interpretation: "recorded-observations-only-not-a-person-ranking-or-value-score", ...CONTRIBUTION_SAFETY,
    });
  });

  it("refuses to manufacture person rankings from scope, role, evidence or period mismatches", () => {
    const history = corroborate(create(ledger(), record()));
    const left = reportInput(history);
    const changedRole = correct(history, { ...record(), roleId: "role-b" });
    const comparisons = [
      compareContributionPeriods(left, left, "person-a", "business-a", NOW),
      compareContributionPeriods(left, reportInput(changedRole), "person-a", "business-a", NOW),
      compareContributionPeriods(left, left, "missing-person", "business-a", NOW),
    ];
    for (const result of comparisons) expect(result).toMatchObject({
      status: "compared", comparableRecordedObservations: false, reportedMinutesDelta: null, corroboratedMinutesDelta: null,
    });
    const foreign = { ...references(), scope: { ...SCOPE, tenantId: "foreign" } };
    refused(compareContributionPeriods(left, reportInput(history, PERIOD, foreign), "person-a", "business-a", NOW));
  });

  it("does not compare caller-crafted report totals instead of recomputing validated evidence/history", () => {
    const input = reportInput(create(ledger(), record()));
    const forged = { ...input, reportedMinutes: 1_000_000 };
    refused(compareContributionPeriods(forged, input, "person-a", "business-a", NOW));
    const accessor = vi.fn(() => input.ledger);
    const getterInput = Object.defineProperty({ ...input }, "ledger", { get: accessor });
    refused(compareContributionPeriods(getterInput, input, "person-a", "business-a", NOW));
    expect(accessor).not.toHaveBeenCalled();
  });

  it("reports incomplete periods and mismatched evidence snapshot times without fabricating completeness", () => {
    const history = create(ledger(), record());
    expect(report(history, references(), { startMs: PERIOD.startMs, endMs: NOW + MINUTE }).issues)
      .toContainEqual({ entityId: null, code: "period-not-complete" });
    refused(buildContributionPeriodReport(history, references(NOW - 1), PERIOD, NOW));
    expect(report(history).issues).toContainEqual({ entityId: null, code: "coverage-not-established" });
  });

  it("returns deterministic, deeply frozen summaries without mutating references or exposing evidence payloads", () => {
    const history = collaboration("financial");
    const refs = references();
    const beforeHistory = JSON.stringify(history);
    const beforeRefs = JSON.stringify(refs);
    const left = report(history, refs);
    const right = report(history, refs);
    expect(left).toEqual(right);
    deepFrozen(left);
    expect(JSON.stringify(history)).toBe(beforeHistory);
    expect(JSON.stringify(refs)).toBe(beforeRefs);
    expect(Object.isFrozen(refs)).toBe(false);
    expect(JSON.stringify(left)).not.toContain("Synthetic organisational result.");
    expect(JSON.stringify(left)).not.toContain(INDEPENDENT.sha256);
  });
});
