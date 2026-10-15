import { describe, expect, it, vi } from "vitest";
import {
  CONTRIBUTION_SAFETY, type ContributionAuditEvent, type ContributionEntity,
  type ContributionExpectation, type ContributionLedger, type ContributionPeriod, type ContributionRecord,
  type SharedContributionResult,
} from "./individual-contribution";
import { buildContributionPeriodReport, type ContributionReferenceSnapshot } from "./individual-contribution-reporting";
import {
  analyseContributionIntelligence, type ContributionCommitmentAgreement, type ContributionDeliveryObservation,
  type ContributionIntelligenceInput,
} from "./contribution-intelligence";

const MINUTE = 60_000;
const NOW = 1_000 * MINUTE;
const SCOPE = { tenantId: "tenant", datasetId: "dataset" };
const SELF = { id: "self", revision: 1, sha256: "a".repeat(64) };
const PROOF = { id: "proof", revision: 1, sha256: "b".repeat(64) };
const MONEY = { id: "money", revision: 1, sha256: "c".repeat(64) };
const PEOPLE = ["a", "b", "reviewer", "observer", "recorder", "resolver", "challenger", "other-reviewer"];
function append(
  ledger: ContributionLedger, body: ContributionAuditEvent["body"], atMs: number, actorPersonId = "recorder",
): ContributionLedger {
  const previous = ledger.events.at(-1);
  if (previous && atMs < previous.recordedAtMs) throw new Error("Test schedule moved backwards.");
  const sequence = ledger.events.length + 1;
  return {
    ...ledger, revision: sequence,
    events: [...ledger.events, { id: `event-${sequence}`, sequence, previousEventId: previous?.id ?? null, actorPersonId, recordedAtMs: atMs, body }],
  };
}
function create(ledger: ContributionLedger, entity: ContributionEntity, atMs: number, actor = "recorder") {
  return append(ledger, { type: "created", entity }, atMs, actor);
}
function review(ledger: ContributionLedger, entityId: string, atMs: number, version = 1, actor = "reviewer") {
  return append(ledger, { type: "reviewed", entityId, expectedVersion: version, decision: "approved", reason: "Independent synthetic review.", evidence: [PROOF] }, atMs, actor);
}
function correct(ledger: ContributionLedger, replacement: ContributionEntity, atMs = NOW - 100, version = 1) {
  return append(ledger, { type: "corrected", entityId: replacement.id, expectedVersion: version, replacement, reason: "Retained historical correction.", evidence: [PROOF] }, atMs);
}
function dispute(ledger: ContributionLedger, entityId: string, atMs = NOW - 50, version = 1) {
  return append(ledger, { type: "disputed", entityId, expectedVersion: version, disputeId: `dispute-${entityId}`, reason: "Explicit unresolved dispute.", evidence: [] }, atMs, "challenger");
}
function references(asOfMs = NOW): ContributionReferenceSnapshot {
  return {
    scope: SCOPE, asOfMs,
    people: PEOPLE.map(id => ({ id, kind: id === "a" ? "founder" : id === "b" ? "contractor" : "employee" })),
    businessIds: ["business", "other-business"],
    roles: [{ id: "role", businessId: "business" }, { id: "other-role", businessId: "business" }],
    departments: [{ id: "department", businessId: "business" }],
    projects: [{ id: "project", businessId: "business" }],
    actions: [{ id: "action", businessId: "business" }],
    financialRecords: [{ id: "finance", businessId: "business" }],
    evidence: [
      { ...SELF, source: "self-report", recordedAtMs: 0, custodianPersonId: "a", availability: "available" },
      { ...PROOF, source: "independent-observation", recordedAtMs: 0, custodianPersonId: "observer", availability: "available" },
      { ...MONEY, source: "financial-record", recordedAtMs: 0, custodianPersonId: "observer", availability: "available" },
    ],
  };
}
function work(
  period: ContributionPeriod, personId: string, id: string, reportedMinutes: number,
): ContributionRecord {
  return {
    kind: "contribution", id, personId, businessId: "business", roleId: "role", departmentId: "department",
    projectId: "project", actionId: "action", pillarId: "garden-maintenance", category: "delivery",
    participation: "contributor", period, measure: { kind: "hours", reportedMinutes }, evidence: [SELF],
  };
}
function expectation(period: ContributionPeriod, id: string): ContributionExpectation {
  return {
    kind: "expectation", id, businessId: "business", roleId: "role", departmentId: "department", period,
    evidence: [PROOF], criteria: [{ id: "time", dimension: "corroborated-minutes", statement: "Explicit agreed time invested, not value.", minimum: 60 }],
  };
}
function agreement(period: ContributionPeriod, personId: string, periodId: string, agreedMinutes = 60): ContributionCommitmentAgreement {
  return {
    id: `agreement-${personId}-${periodId}`, personId, businessId: "business", roleId: "role", departmentId: "department",
    period, expectationId: `expectation-${periodId}`, expectationVersion: 1, criterionId: "time", agreedMinutes,
    responsibilityIds: ["delivery"], acceptedAtMs: MINUTE, reviewedByPersonId: "reviewer", reviewedAtMs: 2 * MINUTE, evidence: [PROOF],
  };
}
function fixture(
  observations: readonly (readonly [number | null, number | null])[] = [[60, 60], [60, 60], [60, 60]],
  commitments: readonly (readonly [number, number])[] = observations.map(() => [60, 60]),
): ContributionIntelligenceInput {
  const periods = observations.map((_, index) => ({
    id: `p${index}`, period: { startMs: (100 + index * 120) * MINUTE, endMs: (220 + index * 120) * MINUTE },
  }));
  let ledger: ContributionLedger = { version: 1, scope: SCOPE, revision: 0, events: [] };
  for (const [index, item] of periods.entries()) {
    ledger = create(ledger, expectation(item.period, `expectation-${item.id}`), 10 + index * 2);
    ledger = review(ledger, `expectation-${item.id}`, 11 + index * 2);
  }
  for (const [index, item] of periods.entries()) {
    for (const [personIndex, personId] of ["a", "b"].entries()) {
      const minutes = observations[index][personIndex];
      if (minutes === null) continue;
      const id = `work-${personId}-${item.id}`;
      ledger = create(ledger, work(item.period, personId, id, minutes), item.period.endMs, personId);
      ledger = append(ledger, {
        type: "hours-corroborated", entityId: id, expectedVersion: 1, minutes, evidence: [PROOF],
      }, item.period.endMs, "reviewer");
    }
  }
  return {
    ledger, references: references(), personIds: ["a", "b"], periods,
    agreements: periods.flatMap((item, index) => ["a", "b"].map((personId, personIndex) =>
      agreement(item.period, personId, item.id, commitments[index][personIndex]))),
    deliveries: [], asOfMs: NOW, nowMs: NOW, trendPolicy: { minimumConsecutivePeriods: 3, minimumGapBasisPoints: 2_500 },
  };
}
function ledgerOf(input: ContributionIntelligenceInput): ContributionLedger {
  const ledger = input.ledger;
  if (ledger === null || typeof ledger !== "object" || !("events" in ledger)) throw new Error("Invalid fixture ledger.");
  return ledger as ContributionLedger;
}
function analyse(input = fixture()) {
  const result = analyseContributionIntelligence(input);
  if (result.status !== "analysed") throw new Error(result.message);
  return result.intelligence;
}
function refused(result: unknown) { expect(result).toMatchObject({ status: "refused", ...CONTRIBUTION_SAFETY, message: expect.any(String) }); }
function frozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen);
}
function collaboration(financial = false): ContributionIntelligenceInput {
  const input = fixture([[60, 60]]);
  const period = input.periods[0].period;
  let ledger = ledgerOf(input);
  const result: SharedContributionResult = {
    kind: "shared-result", id: "result", businessId: "business", resultKind: financial ? "financial" : "outcome",
    origin: { type: "Action", id: "action", resultKey: "canonical-outcome" },
    occurredAtMs: period.endMs - 1, description: "Synthetic shared result.", evidence: [financial ? MONEY : PROOF],
    money: financial ? { currency: "GBP", minorUnitScale: 2, amountMinor: 101, financialKind: "revenue", basis: "recorded" } : null,
  };
  ledger = create(ledger, result, period.endMs);
  for (const personId of ["a", "b"]) {
    ledger = create(ledger, {
      ...work(period, personId, `participation-${personId}`, 0),
      measure: { kind: financial ? "financial" : "outcome", resultId: "result" },
    }, period.endMs, personId);
  }
  ledger = review(ledger, "result", period.endMs);
  ledger = create(ledger, {
    kind: "allocation", id: "allocation", resultId: "result", resultVersion: 1,
    participationVersions: [{ entityId: "participation-a", version: 1 }, { entityId: "participation-b", version: 1 }],
    shares: [{ personId: "a", basisPoints: 5_000 }, { personId: "b", basisPoints: 2_500 }],
    rationale: "Explicit reviewed unequal allocation, not pay.", evidence: [PROOF],
  }, period.endMs);
  ledger = review(ledger, "allocation", period.endMs);
  return { ...input, ledger };
}
function deliveryObservation(input: ContributionIntelligenceInput, dueAtMs?: number): ContributionDeliveryObservation {
  return {
    id: "delivery", agreementId: input.agreements[0].id, responsibilityId: "delivery",
    resultId: "result", resultVersion: 1, dueAtMs: dueAtMs ?? input.periods[0].period.endMs - 2,
    acceptedAtMs: 4 * MINUTE, reviewedByPersonId: "reviewer", reviewedAtMs: 5 * MINUTE, evidence: [PROOF],
  };
}

describe("deterministic explicit person/period analytical boundary", () => {
  it("recomputes Phase 1 reports, keeps exact hours and returns detached immutable non-executing data", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const result = analyse(input);
    expect(result.people).toHaveLength(6);
    expect(result.people[0].hours).toMatchObject({
      reportedMinutes: 60, corroboratedMinutes: 60, reportedHours: { numerator: 60, denominator: 60 },
    });
    expect(result).toMatchObject(CONTRIBUTION_SAFETY);
    expect(analyse(input)).toEqual(result);
    frozen(result); expect(JSON.stringify(input)).toBe(before); expect(Object.isFrozen(input)).toBe(false);
    expect(JSON.stringify(result)).not.toContain("Synthetic shared result.");
  });

  it("has one row for every selected ID per period, including unknown and absent people without fabricated zeroes", () => {
    const result = analyse({ ...fixture([[null, 0]]), personIds: ["unknown", "reviewer", "b", "a"] });
    expect(result.personIds).toEqual(["a", "b", "reviewer", "unknown"]);
    expect(result.people.find(row => row.personId === "a")?.hours.reportedMinutes).toBeNull();
    expect(result.people.find(row => row.personId === "b")?.hours.reportedMinutes).toBe(0);
    expect(result.people.find(row => row.personId === "reviewer")?.hours.corroboratedMinutes).toBeNull();
    expect(result.people.find(row => row.personId === "unknown")).toMatchObject({ identityStatus: "unknown", hours: { reportedMinutes: null } });
  });

  it("allows an empty selection without converting a selected subset into organisational totals", () => {
    const result = analyse({ ...collaboration(), personIds: [] });
    expect(result.people).toEqual([]); expect(result.comparisons).toEqual([]);
    expect(result.periods[0].uniqueResultCounts.outcome).toBe(1);
  });

  it("sorts caller period/person order deterministically and refuses duplicates, overlaps and malformed fields", () => {
    const input = fixture();
    expect(analyse({ ...input, periods: [...input.periods].reverse(), personIds: ["b", "a"] })).toEqual(analyse(input));
    refused(analyseContributionIntelligence({ ...input, personIds: ["a", "a"] }));
    refused(analyseContributionIntelligence({ ...input, periods: [input.periods[0], { ...input.periods[0], id: "duplicate" }] }));
    refused(analyseContributionIntelligence({ ...input, periods: [] }));
    refused(analyseContributionIntelligence({ ...input, asOfMs: NOW + 1 }));
    refused(analyseContributionIntelligence({ ...input, nowMs: NaN }));
    const getter = vi.fn(() => input.ledger);
    refused(analyseContributionIntelligence(Object.defineProperty({ ...input }, "ledger", { get: getter })));
    expect(getter).not.toHaveBeenCalled();
  });

  it("refuses sparse lists, duplicate responsibilities, unsafe counters and authority-shaped extra fields", () => {
    const input = fixture([[60, 60]]);
    const sparse: string[] = [];
    sparse.length = 1;
    refused(analyseContributionIntelligence({ ...input, personIds: sparse }));
    refused(analyseContributionIntelligence({
      ...input, agreements: [{ ...input.agreements[0], responsibilityIds: ["delivery", "delivery"] }],
    }));
    refused(analyseContributionIntelligence({
      ...input, agreements: [{ ...input.agreements[0], agreedMinutes: Number.MAX_SAFE_INTEGER + 1 }],
    }));
    refused(analyseContributionIntelligence({ ...input, asOfMs: Number.MAX_SAFE_INTEGER }));
    refused(analyseContributionIntelligence(Object.assign({}, input, { authorised: true })));
  });

  it.each([0, 1, -1, 1.5, NaN])("refuses invalid sustained-period policy %s", minimumConsecutivePeriods => {
    refused(analyseContributionIntelligence({ ...fixture(), trendPolicy: { minimumConsecutivePeriods, minimumGapBasisPoints: 1 } }));
  });
  it.each([0, -1, 10_001, 0.1, Infinity])("refuses invalid materiality threshold %s", minimumGapBasisPoints => {
    refused(analyseContributionIntelligence({ ...fixture(), trendPolicy: { minimumConsecutivePeriods: 2, minimumGapBasisPoints } }));
  });

  it("does not infer personal commitments from reviewed role standards or ownership labels", () => {
    const result = analyse({ ...fixture(), agreements: [] });
    expect(result.people.every(row => row.commitments.length === 0)).toBe(true);
    expect(result.trends).toEqual([]); expect(result.sustainedImbalances).toEqual([]);
    expect(result.comparisons.every(row => !row.comparable)).toBe(true);
  });
});

describe("transparent commitment measurements and unequal working commitments", () => {
  it("normalises against explicit individual agreements, not a full-time default or another person's hours", () => {
    const result = analyse(fixture([[120, 60]], [[120, 60]]));
    const [a, b] = result.people;
    expect(a.commitments[0]).toMatchObject({ expectedMinutes: 120, roleMinimumMinutes: 60, recordedFulfilment: { numerator: 120, denominator: 120 } });
    expect(b.commitments[0]).toMatchObject({ expectedMinutes: 60, recordedFulfilment: { numerator: 60, denominator: 60 } });
    expect(result.comparisons[0]).toMatchObject({ comparable: true, higherRecordedFulfilmentPersonId: null, gapMeetsPolicy: false });
  });

  it("distinguishes a supported recorded shortfall from missing time, and never declares actual underperformance", () => {
    const known = analyse(fixture([[30, null]], [[60, 60]]));
    expect(known.people[0].commitments[0]).toMatchObject({
      status: "recorded-shortfall", shortfallMinutes: 30, recordedFulfilment: { numerator: 30, denominator: 60 },
    });
    expect(known.people[1].commitments[0]).toMatchObject({ status: "insufficient-evidence", recordedMinutes: null, shortfallMinutes: null });
    expect(known.people.every(row => row.actualUnderperformance === "not-established-requires-complete-evidence-and-human-context")).toBe(true);
  });

  it("keeps zero commitment distinct from zero observed time and refuses to divide by zero", () => {
    const result = analyse(fixture([[0, 0]], [[0, 60]]));
    expect(result.people[0].commitments[0]).toMatchObject({ recordedFulfilment: null, expectedMinutes: 0, status: "different-or-unsettled-expectations" });
    expect(result.people[1].commitments[0]).toMatchObject({ recordedFulfilment: { numerator: 0, denominator: 60 }, shortfallMinutes: 60 });
  });

  it.each(["self-review", "late-acceptance", "wrong-version", "no-responsibilities", "missing-evidence", "wrong-criterion"] as const)(
    "does not create commitment ratings from %s", fault => {
      const input = fixture([[60, 60]]);
      const item = input.agreements[0];
      const changed: ContributionCommitmentAgreement = {
        ...item,
        ...(fault === "self-review" ? { reviewedByPersonId: "a" }
          : fault === "late-acceptance" ? { acceptedAtMs: item.period.startMs + 1 }
            : fault === "wrong-version" ? { expectationVersion: 2 }
              : fault === "no-responsibilities" ? { responsibilityIds: [] }
                : fault === "missing-evidence" ? { evidence: [] } : { criterionId: "unknown" }),
      };
      const result = analyse({ ...input, agreements: [changed, input.agreements[1]] });
      expect(result.people[0].commitments[0].comparable).toBe(false);
      expect(result.people[0].commitments[0].recordedFulfilment).toBeNull();
      expect(result.comparisons[0].comparable).toBe(false);
    },
  );

  it("does not compare different responsibilities or criterion meanings as interchangeable performance", () => {
    const input = fixture([[60, 60]]);
    const result = analyse({ ...input, agreements: [input.agreements[0], { ...input.agreements[1], responsibilityIds: ["supervision"] }] });
    expect(result.comparisons[0]).toMatchObject({ comparable: false, reasons: expect.arrayContaining(["different-roles-responsibilities-or-measurement-basis"]) });
  });

  it("keeps independently valid different roles visible without cross-role fulfilment ranking", () => {
    const input = fixture([[60, 60]]);
    const history = ledgerOf(input);
    let ledger: ContributionLedger = { version: 1, scope: SCOPE, revision: 0, events: [] };
    for (const event of history.events.slice(0, 2)) ledger = append(ledger, event.body, event.recordedAtMs, event.actorPersonId);
    ledger = create(ledger, { ...expectation(input.periods[0].period, "other-expectation"), roleId: "other-role" }, 12);
    ledger = review(ledger, "other-expectation", 13);
    for (const event of history.events.slice(2)) {
      const body = event.body.type === "created" && event.body.entity.kind === "contribution" && event.body.entity.personId === "b"
        ? { ...event.body, entity: { ...event.body.entity, roleId: "other-role" } } : event.body;
      ledger = append(ledger, body, event.recordedAtMs, event.actorPersonId);
    }
    const result = analyse({
      ...input, ledger,
      agreements: [input.agreements[0], { ...input.agreements[1], roleId: "other-role", expectationId: "other-expectation" }],
    });
    expect(result.people.every(row => row.commitments[0].comparable)).toBe(true);
    expect(result.comparisons[0]).toMatchObject({ comparable: false, higherRecordedFulfilmentPersonId: null });
  });

  it("requires the exact expectation version to exist when the person accepts the agreement", () => {
    const input = fixture([[60, 60]]);
    const result = analyse({ ...input, agreements: [{ ...input.agreements[0], acceptedAtMs: 0 }, input.agreements[1]] });
    expect(result.people[0].commitments[0]).toMatchObject({
      comparable: false, reasons: expect.arrayContaining(["expectation-not-known-at-acceptance"]),
    });
  });

  it("flags role changes rather than normalising all work against the old role", () => {
    const input = fixture([[60, 60]]);
    const original = ledgerOf(input).events.find(event => event.body.type === "created" && event.body.entity.id === "work-a-p0");
    if (original?.body.type !== "created" || original.body.entity.kind !== "contribution") throw new Error("Missing work fixture.");
    const ledger = correct(ledgerOf(input), { ...original.body.entity, roleId: "other-role" });
    const result = analyse({ ...input, ledger });
    expect(result.people[0].commitments[0]).toMatchObject({ comparable: false, reasons: expect.arrayContaining(["role-or-responsibility-context-changed"]) });
  });

  it("does not silently choose among contradictory overlapping personal agreements", () => {
    const input = fixture([[60, 60]]);
    const result = analyse({ ...input, agreements: [...input.agreements, { ...input.agreements[0], id: "contradictory", agreedMinutes: 90 }] });
    expect(result.people[0].commitments.every(item => !item.comparable)).toBe(true);
    expect(result.trends).toEqual([]);
  });

  it("keeps uncorroborated reported-time comparisons explicitly descriptive rather than promoting them to supported time", () => {
    const input = fixture([[30, 60]]);
    const original = expectation(input.periods[0].period, "expectation-p0");
    const ledger: ContributionLedger = {
      ...ledgerOf(input),
      events: ledgerOf(input).events.map<ContributionAuditEvent>(event => event.body.type === "created" && event.body.entity.id === original.id
        ? { ...event, body: { type: "created", entity: { ...original, criteria: [{ ...original.criteria[0], dimension: "reported-minutes" }] } } }
        : event).filter(event => event.body.type !== "hours-corroborated").map((event, index, array) => ({
          ...event, sequence: index + 1, previousEventId: index === 0 ? null : array[index - 1].id,
        })),
      revision: 4,
    };
    const result = analyse({ ...input, ledger });
    expect(result.people[0].commitments[0]).toMatchObject({
      comparable: true, dimension: "reported-minutes", status: "recorded-shortfall",
      reasons: expect.arrayContaining(["reported-time-is-not-independent-corroboration"]),
    });
    expect(result.people[0].hours.corroboratedMinutes).toBeNull();
  });
});

describe("missing evidence, contradictions and supported contributions", () => {
  it.each(["missing", "restricted"] as const)("does not convert %s evidence into poor commitment", availability => {
    const input = fixture();
    const refs = references();
    const result = analyse({ ...input, references: { ...refs, evidence: refs.evidence.map(entry => ({ ...entry, availability })) } });
    expect(result.people.every(row => row.hours.corroboratedMinutes === null)).toBe(true);
    expect(result.people.every(row => row.commitments.every(item => !item.comparable))).toBe(true);
    expect(result.people[0].evidenceCompleteness.usableEvidenceCount).toBe(0);
    expect(result.trends).toEqual([]); expect(result.sustainedImbalances).toEqual([]);
  });

  it("rejects ambiguous evidence identity and wrong tenant/as-of snapshots before comparison", () => {
    const input = fixture();
    const refs = references();
    refused(analyseContributionIntelligence({ ...input, references: { ...refs, evidence: [...refs.evidence, refs.evidence[0]] } }));
    refused(analyseContributionIntelligence({ ...input, references: { ...refs, scope: { ...SCOPE, tenantId: "other" } } }));
    refused(analyseContributionIntelligence({ ...input, references: references(NOW - 1) }));
  });

  it("counts evidence references from corroboration, agreement and audit rather than only the subject's self-report", () => {
    const result = analyse(fixture([[60, 60]]));
    expect(result.people[0].evidenceCompleteness).toMatchObject({
      includedRecordCount: 1, supportedRecordCount: 1, referencedEvidenceCount: 2, usableEvidenceCount: 2,
      reportingCoverage: "not-established",
    });
    expect(result.people[0].contributions).toMatchObject({
      evidenceSupportedIds: ["work-a-p0"], independentlyCorroboratedTimeIds: ["work-a-p0"], reviewedAttributedParticipationIds: [],
    });
  });

  it("does not choose a favourable corroboration when independent reports contradict each other", () => {
    const input = fixture([[60, 60]]);
    const ledger = append(ledgerOf(input), {
      type: "hours-corroborated", entityId: "work-a-p0", expectedVersion: 1, minutes: 30, evidence: [PROOF],
    }, NOW - 1, "other-reviewer");
    const result = analyse({ ...input, ledger });
    expect(result.people[0].hours).toMatchObject({ reportedMinutes: 60, corroboratedMinutes: null });
    expect(result.people[0].commitments[0].comparable).toBe(false);
    expect(result.people[0].uncertainty.issues).toContainEqual({ entityId: "work-a-p0", code: "conflicting-hours-corroborations" });
  });

  it("shows partial corroboration separately and never promotes a supported subset to complete observed time", () => {
    const input = fixture([[60, 60]]);
    const history = ledgerOf(input);
    const period = input.periods[0].period;
    const midpoint = period.startMs + 60 * MINUTE;
    let ledger: ContributionLedger = {
      ...history, events: history.events.map<ContributionAuditEvent>(event => event.body.type === "created" && event.body.entity.id === "work-a-p0"
        ? { ...event, body: { ...event.body, entity: { ...event.body.entity, period: { startMs: period.startMs, endMs: midpoint } } } } : event),
    };
    ledger = create(ledger, work({ startMs: midpoint, endMs: period.endMs }, "a", "additional-time", 30), NOW - 1, "a");
    const result = analyse({ ...input, ledger });
    expect(result.people[0].hours).toMatchObject({ reportedMinutes: 90, corroboratedMinutes: null, corroboratedSubsetMinutes: 60 });
    expect(result.people[0].commitments[0].recordedFulfilment).toBeNull();
  });

  it("does not double count overlapping time or prorate period-boundary assertions", () => {
    const input = fixture([[60, 60]]);
    const period = input.periods[0].period;
    const ledger = create(ledgerOf(input), work({ startMs: period.startMs - MINUTE, endMs: period.endMs }, "a", "overlap", 60), NOW - 1, "a");
    const result = analyse({ ...input, ledger });
    expect(result.people[0].hours.reportedMinutes).toBe(60);
    expect(result.people[0].hours.corroboratedMinutes).toBeNull();
    expect(result.people[0].uncertainty.excludedBoundaryRecordIds).toEqual(["overlap"]);
    expect(result.people[0].commitments[0].recordedFulfilment).toBeNull();
  });
});

describe("canonical collaborative outcomes and bounded reward inputs", () => {
  it("retains one organisational outcome and separate unequal reviewed person allocations", () => {
    const result = analyse(collaboration());
    expect(result.periods[0].uniqueResultCounts.outcome).toBe(1);
    expect(result.periods[0].organisationalResults).toHaveLength(1);
    expect(result.people.map(row => row.results[0].allocatedBasisPointsForPerson)).toEqual([5_000, 2_500]);
    expect(result.periods[0].organisationalResults[0].unallocatedBasisPoints).toBe(2_500);
    expect(result.people[0].contributions.reviewedAttributedParticipationIds).toEqual(["participation-a"]);
    expect(result.people[0].rewardDecisionSupport).toMatchObject({
      status: "human-review-inputs-only", reviewedAllocationResultIds: ["result"],
      determinesPay: false, determinesBonus: false, determinesProfitShare: false, determinesEquity: false,
    });
  });

  it("keeps exact financial shares separate from organisational totals and never treats attribution as pay", () => {
    const result = analyse(collaboration(true));
    expect(result.periods[0].financialBuckets[0].reportedAmountMinor).toBe(101);
    expect(result.people[0].results[0].financialShare).toEqual({ wholeMinorUnits: 50, remainderNumerator: 5_000, denominator: 10_000 });
    expect(result.people[1].results[0].financialShare).toEqual({ wholeMinorUnits: 25, remainderNumerator: 2_500, denominator: 10_000 });
    expect(result.people[0].rewardDecisionSupport.unresolvedReasons).toContain("human-legal-contractual-and-budget-review-required");
  });

  it.each(["allocation", "result", "participation-b"])("preserves uncertainty when %s is disputed, including another participant not selected", id => {
    const input = collaboration();
    const result = analyse({ ...input, personIds: ["a"], ledger: dispute(ledgerOf(input), id) });
    expect(result.people[0].results[0].allocatedBasisPointsForPerson).toBeNull();
    expect(result.people[0].uncertainty.blockedAllocationResultIds).toEqual(["result"]);
    expect(result.people[0].uncertainty.openDisputes).toContainEqual({ entityId: id, disputeId: `dispute-${id}`, version: 1 });
    expect(result.people[0].contributions.reviewedAttributedParticipationIds).toEqual([]);
  });

  it("retains a participation dispute through correction and only restores attribution after explicit resolution and repinning", () => {
    const input = collaboration();
    let ledger = dispute(ledgerOf(input), "participation-b", NOW - 100);
    const entity = ledger.events.find(event => event.body.type === "created" && event.body.entity.id === "participation-b");
    const allocation = ledger.events.find(event => event.body.type === "created" && event.body.entity.id === "allocation");
    if (entity?.body.type !== "created" || entity.body.entity.kind !== "contribution"
      || allocation?.body.type !== "created" || allocation.body.entity.kind !== "allocation") throw new Error("Missing collaboration fixture.");
    ledger = correct(ledger, { ...entity.body.entity, evidence: [PROOF] }, NOW - 90);
    expect(analyse({ ...input, ledger }).people[0].uncertainty.openDisputes).toContainEqual({
      entityId: "participation-b", disputeId: "dispute-participation-b", version: 1,
    });
    ledger = append(ledger, {
      type: "dispute-resolved", entityId: "participation-b", expectedVersion: 2, disputeId: "dispute-participation-b",
      finding: "supported", reason: "Independent evidence reviewed.", evidence: [PROOF],
    }, NOW - 80, "resolver");
    expect(analyse({ ...input, ledger }).people[0].results[0].allocatedBasisPointsForPerson).toBeNull();
    ledger = correct(ledger, {
      ...allocation.body.entity, participationVersions: [{ entityId: "participation-a", version: 1 }, { entityId: "participation-b", version: 2 }],
    }, NOW - 70);
    ledger = review(ledger, "allocation", NOW - 60, 2);
    const restored = analyse({ ...input, ledger });
    expect(restored.people[0].results[0].allocatedBasisPointsForPerson).toBe(5_000);
    expect(restored.people[0].uncertainty.openDisputes).toEqual([]);
  });

  it("retains an independently reviewed corrected result but refuses stale numerical allocation and delivery pins", () => {
    const input = collaboration();
    const original = ledgerOf(input).events.find(event => event.body.type === "created" && event.body.entity.id === "result");
    if (original?.body.type !== "created" || original.body.entity.kind !== "shared-result") throw new Error("Missing result fixture.");
    let ledger = correct(ledgerOf(input), { ...original.body.entity, description: "Corrected with retained audit." }, NOW - 100);
    ledger = review(ledger, "result", NOW - 90, 2);
    const result = analyse({ ...input, ledger, deliveries: [deliveryObservation(input)] });
    expect(result.periods[0].uniqueResultCounts.outcome).toBe(1);
    expect(result.people[0].results[0]).toMatchObject({ independentlyReviewed: true, allocatedBasisPointsForPerson: null });
    expect(result.people[0].reliability.observations[0].status).toBe("uncertain");
  });

  it("does not promote quality and initiative assertions into independent outcome verification", () => {
    const input = fixture([[60, 60]]);
    const period = input.periods[0].period;
    let ledger = create(ledgerOf(input), { ...work(period, "a", "quality", 0), measure: { kind: "quality", criteria: "Explicit standard.", assessment: "exceeds" } }, NOW - 2);
    ledger = create(ledger, { ...work(period, "a", "initiative", 0), measure: { kind: "initiative", description: "A proposed improvement." } }, NOW - 1);
    const result = analyse({ ...input, ledger });
    expect(result.people[0].contributions.qualitativeAssertionIds).toEqual(["initiative", "quality"]);
    expect(result.people[0].contributions.reviewedAttributedParticipationIds).toEqual([]);
    expect(result.people[0].results).toEqual([]);
  });

  it("refuses forged overallocations rather than reducing or equalising them in intelligence", () => {
    const input = collaboration();
    const ledger = ledgerOf(input);
    const events = ledger.events.map<ContributionAuditEvent>(event => event.body.type === "created" && event.body.entity.kind === "allocation"
      ? { ...event, body: { ...event.body, entity: { ...event.body.entity, shares: [{ personId: "a", basisPoints: 10_001 }] } } } : event);
    refused(analyseContributionIntelligence({ ...input, ledger: { ...ledger, events } }));
  });
});

describe("explicit delivery reliability, not inferred attendance or fault", () => {
  it("reports independently evidenced late and on-time deliveries only for explicit agreed observations", () => {
    const input = collaboration();
    const late = analyse({ ...input, deliveries: [deliveryObservation(input)] });
    expect(late.people[0].reliability).toMatchObject({ evidencedLate: 1, evidencedOnTime: 0, unresolvedDue: 0 });
    expect(late.people[1].reliability.observations).toEqual([]);
    const onTime = analyse({ ...input, deliveries: [deliveryObservation(input, input.periods[0].period.endMs - 1)] });
    expect(onTime.people[0].reliability.evidencedOnTime).toBe(1);
    expect(onTime.people[0].reliability.observations[0].reasons).toContain("delivery-timing-does-not-establish-personal-fault-or-quality");
  });

  it("does not equate a missing completion record with an actual missed obligation", () => {
    const input = fixture([[60, 60]]);
    const result = analyse({ ...input, deliveries: [deliveryObservation(input)] });
    expect(result.people[0].reliability.observations[0].status).toBe("completion-not-evidenced");
    expect(result.people[0].reliability.evidencedLate).toBe(0);
    expect(result.people[0].actualUnderperformance).toBe("not-established-requires-complete-evidence-and-human-context");
  });

  it("does not hide result/participation disputes behind a Completed-like result occurrence", () => {
    const input = collaboration();
    for (const entityId of ["result", "participation-a"]) {
      const result = analyse({ ...input, ledger: dispute(ledgerOf(input), entityId), deliveries: [deliveryObservation(input)] });
      expect(result.people[0].reliability.observations[0].status).toBe("uncertain");
    }
  });

  it("refuses duplicate/conflicting delivery identities instead of multiplying reliability counts", () => {
    const input = collaboration();
    const observation = deliveryObservation(input);
    refused(analyseContributionIntelligence({ ...input, deliveries: [observation, observation] }));
    refused(analyseContributionIntelligence({ ...input, deliveries: [observation, { ...observation, id: "other", dueAtMs: observation.dueAtMs - 1 }] }));
    refused(analyseContributionIntelligence({ ...input, deliveries: [{ ...observation, agreementId: "missing" }] }));
  });

  it("marks retrospective deadlines, self-reviewed delivery and stale outcome versions uncertain", () => {
    const input = collaboration();
    const observation = deliveryObservation(input);
    for (const changed of [
      { ...observation, reviewedByPersonId: "a" },
      { ...observation, resultVersion: 2 },
      { ...observation, acceptedAtMs: observation.dueAtMs + 1 },
      { ...observation, responsibilityId: "not-agreed" },
      { ...observation, dueAtMs: input.periods[0].period.endMs + 1 },
      { ...observation, reviewedByPersonId: "b" },
    ]) expect(analyse({ ...input, deliveries: [changed] }).people[0].reliability.observations[0].status).toBe("uncertain");
  });

  it("exposes missing agreement and delivery evidence explicitly, not just as an empty referenced-evidence denominator", () => {
    const input = collaboration();
    const observation = { ...deliveryObservation(input), evidence: [] };
    const result = analyse({ ...input, agreements: [{ ...input.agreements[0], evidence: [] }, input.agreements[1]], deliveries: [observation] });
    expect(result.people[0].evidenceCompleteness).toMatchObject({
      missingEvidenceAgreementIds: ["agreement-a-p0"], missingEvidenceDeliveryIds: ["delivery"],
    });
    expect(result.people[0].reliability.observations[0].status).toBe("uncertain");
  });

  it("keeps future deadlines pending and already-due missing completions unknown at the same historical cutoff", () => {
    const input = fixture([[null, null]]);
    const asOfMs = 150 * MINUTE;
    const result = analyse({
      ...input, asOfMs, references: references(asOfMs),
      deliveries: [
        { ...deliveryObservation(input, 200 * MINUTE), resultId: "future-result" },
        { ...deliveryObservation(input, 140 * MINUTE), id: "due", resultId: "due-result" },
      ],
    });
    expect(result.people[0].reliability).toMatchObject({ notYetDue: 1, unresolvedDue: 1, evidencedLate: 0 });
    expect(result.people[0].commitments[0].recordedFulfilment).toBeNull();
  });

  it("finds a late result in a later outcome period without moving the original effort or counting the result twice", () => {
    const input = collaboration();
    const end = input.periods[0].period.endMs;
    const history = ledgerOf(input);
    const shifted: ContributionLedger = {
      ...history, events: history.events.map<ContributionAuditEvent>(event => event.body.type === "created" && event.body.entity.kind === "shared-result"
        ? { ...event, recordedAtMs: end + MINUTE, body: { ...event.body, entity: { ...event.body.entity, occurredAtMs: end + MINUTE } } }
        : event.sequence > 6 ? { ...event, recordedAtMs: end + MINUTE } : event),
    };
    const result = analyse({
      ...input, ledger: shifted, deliveries: [deliveryObservation(input)],
      periods: [...input.periods, { id: "later", period: { startMs: end, endMs: end + 120 * MINUTE } }],
    });
    expect(result.periods.map(period => period.uniqueResultCounts.outcome)).toEqual([0, 1]);
    expect(result.people.find(row => row.personId === "a" && row.periodId === "p0")?.reliability.evidencedLate).toBe(1);
    expect(result.people.find(row => row.personId === "a" && row.periodId === "later")?.hours.reportedMinutes).toBeNull();
  });

  it("includes delivery-only result dependencies in uncertainty even when participation has no period overlap", () => {
    const input = collaboration();
    const history = ledgerOf(input);
    const shifted: ContributionLedger = {
      ...history, events: history.events.map<ContributionAuditEvent>(event => event.body.type === "created" && event.body.entity.kind === "contribution"
        && "resultId" in event.body.entity.measure
        ? { ...event, body: { ...event.body, entity: { ...event.body.entity, period: { startMs: 1, endMs: 2 } } } }
        : event.body.type === "created" && event.body.entity.kind === "shared-result"
          ? { ...event, body: { ...event.body, entity: { ...event.body.entity, occurredAtMs: 50 * MINUTE } } } : event),
    };
    const ledger = dispute(shifted, "participation-b");
    const result = analyse({ ...input, ledger, deliveries: [deliveryObservation(input)] });
    expect(result.people[0].uncertainty.openDisputes).toContainEqual({
      entityId: "participation-b", disputeId: "dispute-participation-b", version: 1,
    });
  });
});

describe("explainable historical trends and sustained recorded imbalances", () => {
  it("identifies sustained normalised gaps with exact supporting agreements and no person-value score", () => {
    const result = analyse(fixture([[60, 30], [60, 30], [60, 30]]));
    expect(result.sustainedImbalances).toHaveLength(1);
    expect(result.sustainedImbalances[0]).toMatchObject({
      personIds: ["a", "b"], higherRecordedFulfilmentPersonId: "a", periodIds: ["p0", "p1", "p2"],
      agreementPairs: [["agreement-a-p0", "agreement-b-p0"], ["agreement-a-p1", "agreement-b-p1"], ["agreement-a-p2", "agreement-b-p2"]],
    });
    expect(result.trends.find(trend => trend.personId === "b")).toMatchObject({ sustainedRecordedShortfall: true, consecutiveRecordedShortfalls: 3 });
    expect(result.people.every(row => !row.rewardDecisionSupport.determinesPay)).toBe(true);
  });

  it("does not call unequal hours an imbalance when each person's agreed commitment is fulfilled", () => {
    const result = analyse(fixture([[120, 60], [120, 60], [120, 60]], [[120, 60], [120, 60], [120, 60]]));
    expect(result.sustainedImbalances).toEqual([]);
    expect(result.trends.every(trend => trend.direction === "unchanged")).toBe(true);
  });

  it("separates recorded trend direction from an explicitly configured meaningful gap threshold", () => {
    const result = analyse(fixture([[30, 60], [31, 60], [32, 60]]));
    expect(result.trends.find(trend => trend.personId === "a")).toMatchObject({
      direction: "increasing-recorded-fulfilment", netChangeMeetsGapPolicy: false,
    });
    const meaningful = analyse(fixture([[15, 60], [30, 60], [60, 60]]));
    expect(meaningful.trends.find(trend => trend.personId === "a")).toMatchObject({ netChangeMeetsGapPolicy: true });
  });

  it("breaks sustained runs at missing evidence, temporal gaps, direction reversal or insufficient history", () => {
    expect(analyse(fixture([[60, 30], [null, 30], [60, 30]])).sustainedImbalances).toEqual([]);
    expect(analyse(fixture([[60, 30], [30, 60], [60, 30]])).sustainedImbalances).toEqual([]);
    expect(analyse(fixture([[60, 30], [60, 30]])).sustainedImbalances).toEqual([]);
    const input = fixture([[60, 30], [60, 30], [60, 30]]);
    const gapped = { ...input, periods: input.periods.filter(item => item.id !== "p1"), trendPolicy: { ...input.trendPolicy, minimumConsecutivePeriods: 2 } };
    expect(analyse(gapped).sustainedImbalances).toEqual([]);
  });

  it("normalises changing agreed targets transparently rather than labelling reduced hours as deteriorating commitment", () => {
    const result = analyse(fixture([[120, 60], [90, 60], [60, 60]], [[120, 60], [90, 60], [60, 60]]));
    const trend = result.trends.find(entry => entry.personId === "a");
    expect(trend?.direction).toBe("unchanged");
    expect(trend?.fulfilment).toEqual([{ numerator: 120, denominator: 120 }, { numerator: 90, denominator: 90 }, { numerator: 60, denominator: 60 }]);
  });

  it("breaks otherwise valid runs at unequal period durations instead of manufacturing consistent history", () => {
    const input = fixture([[60, 30], [60, 30], [60, 30]]);
    const changedPeriod = { ...input.periods[2].period, endMs: input.periods[2].period.startMs + 60 * MINUTE };
    const history = ledgerOf(input);
    const ledger: ContributionLedger = {
      ...history, events: history.events.map<ContributionAuditEvent>(event =>
        event.body.type === "created" && (event.body.entity.kind === "expectation" || event.body.entity.kind === "contribution")
          && event.body.entity.period.startMs === changedPeriod.startMs
          ? { ...event, body: { ...event.body, entity: { ...event.body.entity, period: changedPeriod } } } : event),
    };
    const result = analyse({
      ...input, ledger, periods: input.periods.map(item => item.id === "p2" ? { ...item, period: changedPeriod } : item),
      agreements: input.agreements.map(item => item.period.startMs === changedPeriod.startMs ? { ...item, period: changedPeriod } : item),
    });
    expect(result.people.every(row => row.commitments[0].comparable)).toBe(true);
    expect(result.trends).toEqual([]); expect(result.sustainedImbalances).toEqual([]);
  });

  it("applies configured sustained-period and materiality thresholds exactly, not a hidden default rating", () => {
    const input = fixture([[60, 45], [60, 45], [60, 45]]);
    expect(analyse(input).sustainedImbalances).toHaveLength(1);
    expect(analyse({ ...input, trendPolicy: { ...input.trendPolicy, minimumGapBasisPoints: 2_501 } }).sustainedImbalances).toEqual([]);
    expect(analyse({ ...input, trendPolicy: { ...input.trendPolicy, minimumConsecutivePeriods: 4 } }).sustainedImbalances).toEqual([]);
  });

  it("does not duplicate unrelated business delivery counts in a commitment-context trend", () => {
    const input = fixture();
    const additional = { ...input.agreements[0], id: "other-business-agreement", businessId: "other-business" };
    const result = analyse({
      ...input, agreements: [...input.agreements, additional],
      deliveries: [{ ...deliveryObservation(input), agreementId: additional.id }],
    });
    expect(result.people.find(row => row.personId === "a" && row.periodId === "p0")?.reliability.unresolvedDue).toBe(1);
    expect(result.trends.find(trend => trend.personId === "a")?.reliability.unresolvedDue).toBe(0);
  });

  it("keeps corrections and historical as-of analysis distinct, without retaining stale corroboration", () => {
    const input = fixture();
    const history = ledgerOf(input);
    const lastAt = history.events.at(-1)!.recordedAtMs;
    const workEvent = history.events.find(event => event.body.type === "created" && event.body.entity.id === "work-b-p1");
    if (workEvent?.body.type !== "created" || workEvent.body.entity.kind !== "contribution") throw new Error("Missing work fixture.");
    const ledger = correct(history, { ...workEvent.body.entity, measure: { kind: "hours", reportedMinutes: 30 } });
    const before = analyse({ ...input, ledger, asOfMs: lastAt, references: references(lastAt) });
    const current = analyse({ ...input, ledger });
    expect(before.people.find(row => row.personId === "b" && row.periodId === "p1")?.hours.corroboratedMinutes).toBe(60);
    expect(current.people.find(row => row.personId === "b" && row.periodId === "p1")?.hours.corroboratedMinutes).toBeNull();
    expect(current.trends.filter(trend => trend.personId === "b")).toEqual([]);
    expect(before.sourceRevision).toBe(current.sourceRevision);
    expect(before.observedRevision).toBeLessThan(current.observedRevision);
  });
});

describe("Phase 1 analytical reuse remains additive and non-persistent", () => {
  it("exposes per-record assessment without changing Phase 1 accounting or asserting durable verification", () => {
    const input = collaboration();
    const result = buildContributionPeriodReport(input.ledger, input.references, input.periods[0].period, NOW);
    if (result.status !== "reported") throw new Error(result.message);
    expect(result.report.uniqueResultCounts.outcome).toBe(1);
    expect(result.report.recordAssessments.find(entry => entry.recordId === "work-a-p0")).toMatchObject({
      version: 1, evidenceAndContextSupported: true, corroboratedMinutes: 60, issueCodes: [],
    });
    frozen(result);
  });
});
