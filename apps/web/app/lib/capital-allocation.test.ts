import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCapitalAllocation, type CapitalAllocationInput, type CapitalCommitmentInput, type CapitalOpportunityInput, type CapitalWonLeadInput } from "./capital-allocation";
import { getProcurementQuoteState, type CommitmentRecord } from "./finance";
import type { CommandAttentionInput } from "./command-attention";

const NOW = new Date(2026, 9, 2, 12).getTime();
const day = (offset: number) => {
  const date = new Date(NOW);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const optionalAmount = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[\u00a3$,\s]/g, "");
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};
const commitment = (overrides: Partial<CommitmentRecord> = {}): CapitalCommitmentInput => {
  const record: CommitmentRecord = { id: "purchase", commitmentName: "Purchase", amount: "100", dueDate: day(0), type: "Supplier", status: "Upcoming",
    certainty: "Planned", relatedPillar: "Operations", procurementNeed: "Equipment", supplier: "Supplier", targetPrice: "100", notes: "", dateCreated: day(-10), ...overrides };
  const parsedDate = new Date(`${record.dueDate}T00:00:00`);
  const [year, month, date] = record.dueDate.split("-").map(Number);
  return { commitment: record, amount: optionalAmount(record.amount), originalBudget: optionalAmount(record.originalBudget || ""), targetPrice: optionalAmount(record.targetPrice || ""),
    actualPurchasePrice: optionalAmount(record.actualPurchasePrice || ""), quoteState: getProcurementQuoteState(record),
    dueDateValid: /^\d{4}-\d{2}-\d{2}$/.test(record.dueDate) && parsedDate.getFullYear() === year && parsedDate.getMonth() === month - 1 && parsedDate.getDate() === date };
};
const opportunity = (overrides: Partial<CapitalOpportunityInput["opportunity"]> = {}, upside = 1000): CapitalOpportunityInput => {
  const record: CapitalOpportunityInput["opportunity"] = { id: "opportunity", status: "Evaluating", opportunityTitle: "Opportunity", title: "Fallback", strategicFit: "High",
    relatedPillar: "Operations", relatedArea: "", requiredCapital: "100", requiredTime: "", ...overrides };
  return { opportunity: record, upside, parsedCapital: optionalAmount(record.requiredCapital) };
};
const lead = (area: string, finalValue: number | null, quoteValue: number | null, archived = false): CapitalWonLeadInput => ({
  lead: { status: "Won", relatedPillar: area, archived }, finalValue, quoteValue,
});
const input = (overrides: Partial<CapitalAllocationInput> = {}): CapitalAllocationInput => ({ opportunities: [], commitments: [], leads: [], currentCashAmount: 1000,
  cashAmountsValid: true, reservedTaxAmount: 200, safetyBufferAmount: 100, cashSnapshotFreshness: { label: "Current", tone: "clear" }, cashSnapshotAgeDays: 0, nowMs: NOW, ...overrides });
const item = (overrides: Partial<CommitmentRecord> = {}, facts: Partial<CapitalAllocationInput> = {}) => buildCapitalAllocation(input({ ...facts, commitments: [commitment(overrides)] })).procurementItems[0];

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe("capital cash facts", () => {
  it("protects reserves and buffer, subtracting committed but not planned exposure", () => {
    const result = buildCapitalAllocation(input({ commitments: [commitment({ certainty: "Committed", amount: "150" }), commitment({ id: "plan", amount: "900" })] }));
    expect(result).toMatchObject({ currentCash: 1000, protectedCash: 300, grossDeployableCash: 700, committedCash: 150, plannedOrQuotedExposure: 900, uncommittedDeployableCash: 550 });
  });
  it.each([null, -1])("retains unknown cash for %s", (currentCashAmount) => {
    expect(buildCapitalAllocation(input({ currentCashAmount, cashAmountsValid: false }))).toMatchObject({ currentCash: null, protectedCash: null, grossDeployableCash: null, uncommittedDeployableCash: null, cashConfigured: false });
  });
  it("retains known current cash when protected amounts are invalid", () => {
    expect(buildCapitalAllocation(input({ cashAmountsValid: false }))).toMatchObject({ currentCash: 1000, protectedCash: null, grossDeployableCash: null });
  });
  it("distinguishes valid zero balances and preserves negative deployable cash", () => {
    expect(buildCapitalAllocation(input({ currentCashAmount: 0, reservedTaxAmount: 0, safetyBufferAmount: 0 }))).toMatchObject({ currentCash: 0, protectedCash: 0, uncommittedDeployableCash: 0, cashConfigured: true });
    expect(buildCapitalAllocation(input({ currentCashAmount: 200 }))).toMatchObject({ grossDeployableCash: -100, uncommittedDeployableCash: -100 });
  });
  it.each([[null, "Missing / invalid date", "warn"], [0, "Current", "clear"], [7, "Current", "clear"], [8, "Aging", "neutral"], [30, "Aging", "neutral"], [31, "Stale", "warn"]] as const)("passes through page-owned freshness at age %s", (age, label, tone) => {
    const result = buildCapitalAllocation(input({ cashSnapshotAgeDays: age, cashSnapshotFreshness: { label, tone } }));
    expect(result.cashSnapshotAgeDays).toBe(age);
    expect(result.cashSnapshotFreshness).toEqual({ label, tone });
    expect(result.cashConfigured).toBe(true);
  });
});

describe("commitment classification", () => {
  it("preserves legacy certainty and moves pending validation into planning", () => {
    const result = buildCapitalAllocation(input({ commitments: [commitment({ certainty: undefined }), commitment({ id: "pending", certainty: "Committed", pendingValidationReason: "  Verify supplier  " })] }));
    expect(result.committedCash).toBe(100);
    expect(result.plannedOrQuotedExposure).toBe(100);
    expect(result.procurementItems[1]).toMatchObject({ isCommitted: false, readinessState: "Pending validation", readinessReason: "Verify supplier", projectedDeployableCashAfterPurchase: 500 });
  });
  it("excludes rejected obligations while retaining procurement history and savings", () => {
    const result = buildCapitalAllocation(input({ commitments: [commitment({ approvalStatus: "Rejected", certainty: "Committed", originalBudget: "200" })] }));
    expect(result.validActiveCommitments).toEqual([]);
    expect(result.commitmentsNeedingAttention).toEqual([]);
    expect(result).toMatchObject({ committedCash: 0, plannedOrQuotedExposure: 0, procurementPlannedExposure: 0, procurementExpectedSavings: 100 });
    expect(result.procurementItems[0]).toMatchObject({ isRejected: true, isCommitted: false, readinessState: "Ready to buy", projectedDeployableCashAfterPurchase: 700 });
  });
  it.each(["Paid", "Cancelled", "canceled", "completed"])("does not flag final status %s", (status) => {
    const result = buildCapitalAllocation(input({ commitments: [commitment({ status, amount: "invalid" })] }));
    expect(result.validActiveCommitments).toEqual([]);
    expect(result.commitmentsNeedingAttention).toEqual([]);
  });
  it.each(["", "0", "-1", "qualitative"])("flags active nonpositive/unknown amount %s", (amount) => {
    const result = buildCapitalAllocation(input({ commitments: [commitment({ amount })] }));
    expect(result.commitmentsNeedingAttention).toHaveLength(1);
    expect(result.validActiveCommitments).toHaveLength(0);
  });
  it("normalizes active status but flags unsupported statuses", () => {
    const result = buildCapitalAllocation(input({ commitments: [commitment({ status: " Due ", certainty: "Committed" }), commitment({ id: "bad", status: "Unknown" })] }));
    expect(result.committedCash).toBe(100);
    expect(result.commitmentsNeedingAttention.map((entry) => entry.commitment.id)).toEqual(["bad"]);
  });
  it.each(["", "2026-02-30", "2026-10-02T00:00:00"])("retains commitments with invalid due date %s in totals", (dueDate) => {
    const result = buildCapitalAllocation(input({ commitments: [commitment({ dueDate, certainty: "Committed" })] }));
    expect(result.commitmentsMissingDueDate).toHaveLength(1);
    expect(result.committedCash).toBe(100);
  });
});

describe("procurement readiness and date precedence", () => {
  it.each([{ status: "Paid" }, { actualPurchaseDate: "invalid-but-present" }, { actualPurchasePrice: "0" }, { actualPurchasePrice: "-1" }])("gives purchase evidence precedence: %j", (overrides) => {
    expect(item({ ...overrides, pendingValidationReason: "Pending", quoteExpiryDate: day(-1) }, { cashAmountsValid: false })).toMatchObject({ readinessState: "Purchased", readinessReason: "Actual purchase details have been recorded." });
  });
  it("keeps exact Paid purchase detection distinct from normalized final status", () => {
    expect(item({ status: "paid" }).isPurchased).toBe(false);
    expect(item({ actualPurchasePrice: "invalid" }).isPurchased).toBe(false);
  });
  it("puts pending validation and expired quotes before missing information and cash", () => {
    expect(item({ targetPrice: "", pendingValidationReason: " Pending " })).toMatchObject({ readinessState: "Pending validation", readinessReason: "Pending" });
    expect(item({ targetPrice: "", quoteExpiryDate: day(-1) })).toMatchObject({ readinessState: "Pending validation", readinessReason: `Quoted pricing expired on ${day(-1)}; revalidate or replace the price before committing or purchasing.` });
  });
  it("lists missing information in its original order", () => {
    expect(item({ procurementNeed: "", supplier: " ", targetPrice: "0" }, { cashAmountsValid: false })).toMatchObject({ readinessState: "Researching", readinessReason: "need, supplier, target price missing." });
  });
  it("distinguishes incomplete cash from insufficient cash", () => {
    expect(item({}, { cashAmountsValid: false })).toMatchObject({ readinessState: "Blocked", readinessReason: "Cash snapshot is incomplete, so deployable cash cannot be verified." });
    expect(item({ targetPrice: "701" })).toMatchObject({ readinessState: "Blocked", readinessReason: "Buying now would consume protected cash or leave deployable cash negative." });
    expect(item({ targetPrice: "700" }).readinessState).toBe("Ready to buy");
  });
  it("does not deduct committed funding twice", () => {
    expect(item({ certainty: "Committed", amount: "700", targetPrice: "800" })).toMatchObject({ readinessState: "Ready to buy", projectedDeployableCashAfterPurchase: 0, readinessReason: "Committed funding is already reserved and deployable cash remains non-negative." });
  });
  it("places future timing before quoted certainty and honors expected-date precedence", () => {
    expect(item({ certainty: "Quoted", expectedPurchaseDate: `${day(1)}T18:00:00`, dueDate: day(-1) })).toMatchObject({ readinessState: "Wait", readinessReason: `Expected purchase date is ${day(1)}T18:00:00.` });
    expect(item({ certainty: "Quoted", expectedPurchaseDate: day(0) })).toMatchObject({ readinessState: "Price found", readinessReason: "Supplier and target price are known; founder commitment has not been made." });
    expect(item({ expectedPurchaseDate: "invalid", dueDate: day(1) }).readinessState).toBe("Ready to buy");
    expect(item({ expectedPurchaseDate: "", dueDate: day(1) }).readinessState).toBe("Wait");
  });
  it("uses injected time for local-midnight purchase timing independently of the system clock", () => {
    expect(item({ expectedPurchaseDate: day(1) }, { nowMs: new Date(2026, 9, 3, 0).getTime() }).readinessState).toBe("Ready to buy");
  });
  it.each([[-1, "Expired"], [0, "Expiring soon"], [7, "Expiring soon"], [8, "Current"]] as const)("preserves frozen finance quote boundary %s", (offset, quoteState) => {
    const result = item({ quoteExpiryDate: day(offset) });
    expect(result.quoteState).toBe(quoteState);
    expect(result.readinessState).toBe(offset < 0 ? "Pending validation" : "Ready to buy");
  });
  it("preserves no-context, absent-expiry and invalid-expiry projections", () => {
    expect(item({ targetPrice: "" }).quoteState).toBeNull();
    expect(item().quoteState).toBe("No expiry recorded");
    expect(item({ quoteExpiryDate: "invalid" }).quoteState).toBe("No expiry recorded");
  });
  it.each(["procurementNeed", "originalBudget", "targetPrice", "actualPurchasePrice", "supplier", "quoteCheckedDate", "quoteExpiryDate", "quoteReference", "quoteNotes", "purchaseEvidenceReference", "invoiceOrderReference", "evidenceNotes", "actualSupplier", "pendingValidationReason"] as const)("includes procurement context from %s", (field) => {
    const source = commitment({ type: "Other", procurementNeed: "", supplier: "", targetPrice: "", [field]: "evidence" });
    expect(buildCapitalAllocation(input({ commitments: [source] })).procurementItems).toHaveLength(1);
  });
  it("does not treat dates alone or whitespace context as procurement", () => {
    expect(buildCapitalAllocation(input({ commitments: [commitment({ type: "Other", procurementNeed: " ", supplier: "", targetPrice: "", expectedPurchaseDate: day(1), actualPurchaseDate: day(-1) })] })).procurementItems).toEqual([]);
  });
});

describe("ordering, coverage and commercial evidence", () => {
  it("orders readiness before dates, rejected last", () => {
    const records = [commitment({ id: "research", targetPrice: "" }), commitment({ id: "purchased", status: "Paid" }), commitment({ id: "wait", expectedPurchaseDate: day(1) }),
      commitment({ id: "quoted", certainty: "Quoted" }), commitment({ id: "pending", pendingValidationReason: "Check" }), commitment({ id: "blocked", targetPrice: "900" }),
      commitment({ id: "ready" }), commitment({ id: "rejected", approvalStatus: "Rejected" })];
    expect(buildCapitalAllocation(input({ commitments: records })).procurementQueue.map((entry) => entry.commitment.id)).toEqual(["ready", "blocked", "pending", "quoted", "wait", "research", "purchased", "rejected"]);
  });
  it("uses expected/due/created date, then name, retaining input order on exact ties", () => {
    const records = [commitment({ id: "z", commitmentName: "Z" }), commitment({ id: "first", commitmentName: "A" }), commitment({ id: "second", commitmentName: "A" }),
      commitment({ id: "earlier", expectedPurchaseDate: day(-1) }), commitment({ id: "created", dueDate: "", dateCreated: day(-2) })];
    expect(buildCapitalAllocation(input({ commitments: records })).procurementQueue.map((entry) => entry.commitment.id)).toEqual(["created", "earlier", "first", "second", "z"]);
  });
  it("ranks fit then efficiency then upside, retaining exact ties", () => {
    const records = [opportunity({ id: "tie-first" }), opportunity({ id: "tie-second" }), opportunity({ id: "efficiency", requiredCapital: "50" }),
      opportunity({ id: "fit", strategicFit: "Exceptional", requiredCapital: "10000" }), opportunity({ id: "upside", requiredCapital: "200" }, 2000), opportunity({ id: "excluded", status: "Rejected" })];
    expect(buildCapitalAllocation(input({ opportunities: records })).liveOpportunities.map((entry) => entry.id)).toEqual(["fit", "efficiency", "upside", "tie-first", "tie-second"]);
  });
  it.each(["New", "Evaluating", "On Hold", "Approved"] as const)("includes live status %s", (status) => {
    expect(buildCapitalAllocation(input({ opportunities: [opportunity({ status })] })).liveOpportunities).toHaveLength(1);
  });
  it.each([["", "missing"], ["-1", "missing"], ["staff time", "qualitative"], ["0", "zero"], ["100", "stated"]] as const)("preserves capital state for %s", (requiredCapital, capitalState) => {
    const result = buildCapitalAllocation(input({ opportunities: [opportunity({ requiredCapital })] }));
    expect(result.liveOpportunities[0]).toMatchObject({ capitalState, capital: capitalState === "stated" ? 100 : null });
    expect(result.highFitKnownCapitalRequired).toBe(capitalState === "zero" ? 0 : capitalState === "stated" ? 100 : null);
  });
  it("nulls incomplete high-fit coverage without lower-fit missing data contaminating it", () => {
    expect(buildCapitalAllocation(input()).highFitKnownCapitalRequired).toBeNull();
    const result = buildCapitalAllocation(input({ opportunities: [opportunity(), opportunity({ id: "zero", requiredCapital: "0" }), opportunity({ id: "low", strategicFit: "Low", requiredCapital: "" })] }));
    expect(result).toMatchObject({ highFitKnownCapitalRequired: 100, highFitOpportunityCount: 2, highFitZeroCapitalCount: 1, highFitMissingCapitalCount: 0 });
    const incomplete = buildCapitalAllocation(input({ opportunities: [opportunity(), opportunity({ requiredCapital: "" }), opportunity({ requiredCapital: "qualitative" })] }));
    expect(incomplete).toMatchObject({ highFitKnownCapitalRequired: null, highFitMissingCapitalCount: 1, highFitQualitativeCapitalCount: 1 });
  });
  it("preserves display fallbacks and nonpositive upside", () => {
    expect(buildCapitalAllocation(input({ opportunities: [opportunity({ opportunityTitle: "", relatedPillar: "", relatedArea: "Finance", requiredTime: "  Later  " }, 0)] })).liveOpportunities[0])
      .toMatchObject({ title: "Fallback", area: "Finance", requiredTime: "Later", upside: null, efficiency: null });
  });
  it("retains archived wins, positive final coverage, separate quotes and area ties", () => {
    const result = buildCapitalAllocation(input({ leads: [lead(" B ", 100, 200, true), lead("A", 100, 300), lead(" ", 0, 0), lead("A", null, 50), { ...lead("Ignored", 999, 999), lead: { status: "Lost", relatedPillar: "Ignored" } }] }));
    expect(result.wonCommercialEvidence).toMatchObject({ totalWonLeads: 4, totalKnownFinalValues: 2, totalMissingFinalValues: 2, totalKnownFinalWonValue: 200, archivedWonLeadCount: 1 });
    expect(result.wonCommercialEvidence.byArea.map((entry) => entry.area)).toEqual(["A", "B", "Unassigned"]);
    expect(result.wonCommercialEvidence.byArea[0]).toMatchObject({ wonLeadCount: 2, knownQuotedValue: 350, quotedValueCount: 2 });
  });
});

describe("procurement totals and contracts", () => {
  it("preserves different required/spend fallbacks and all-history savings", () => {
    const result = buildCapitalAllocation(input({ commitments: [commitment({ certainty: "Committed", originalBudget: "200", targetPrice: "80" }),
      commitment({ id: "planned", amount: "150", targetPrice: "120", originalBudget: "200" }),
      commitment({ id: "purchased", status: "Paid", originalBudget: "200", targetPrice: "100", actualPurchasePrice: "90", approvalStatus: "Rejected" }),
      commitment({ id: "cancelled", status: "Cancelled", amount: "40", targetPrice: "30", originalBudget: "100" })] }));
    expect(result).toMatchObject({ committedCash: 100, plannedOrQuotedExposure: 150, procurementCommittedCash: 100, procurementPlannedExposure: 150,
      procurementActualSpend: 90, procurementOriginalBudgetTotal: 700, procurementTargetPriceTotal: 330, procurementExpectedSavings: 370,
      procurementPotentialSaving: 370, procurementSavedAgainstBudget: 110, procurementSavingsPct: 53 });
  });
  it("keeps zero in nullish price fallbacks and clamps savings", () => {
    expect(item({ amount: "0", targetPrice: "", originalBudget: "50" })).toMatchObject({ amountRequired: 0, effectivePrice: 0 });
    expect(item({ amount: "", targetPrice: "", originalBudget: "50" })).toMatchObject({ amountRequired: 50, effectivePrice: 50 });
    expect(item({ amount: "", targetPrice: "", originalBudget: "" })).toMatchObject({ amountRequired: 0, effectivePrice: 0 });
    expect(item({ originalBudget: "50", targetPrice: "100", actualPurchasePrice: "120" })).toMatchObject({ potentialSaving: 0, savedAgainstBudget: 0 });
    expect(buildCapitalAllocation(input()).procurementSavingsPct).toBeNull();
  });
  it("keeps parsed facts paired by position even when record IDs repeat", () => {
    const result = buildCapitalAllocation(input({ commitments: [commitment({ targetPrice: "50" }), commitment({ targetPrice: "150" })] }));
    expect(result.procurementItems.map((entry) => entry.amountRequired)).toEqual([50, 150]);
  });
  it("preserves rejected actual spend and purchased-but-still-committed records", () => {
    const result = buildCapitalAllocation(input({ commitments: [commitment({ certainty: "Committed", actualPurchasePrice: "90" }),
      commitment({ id: "rejected", approvalStatus: "Rejected", actualPurchasePrice: "80" })] }));
    expect(result).toMatchObject({ committedCash: 100, procurementCommittedCash: 100, procurementActualSpend: 170, procurementPlannedExposure: 0 });
    expect(result.procurementItems[0]).toMatchObject({ isPurchased: true, isCommitted: true, readinessState: "Purchased" });
  });
  it("accepts different page parsing facts without substituting the strict editor parser", () => {
    const record = opportunity({ requiredCapital: "+100" }, 1250);
    expect(buildCapitalAllocation(input({ opportunities: [record] })).liveOpportunities[0]).toMatchObject({ upside: 1250, capitalState: "qualitative" });
    expect(optionalAmount("-100")).toBe(-100);
    expect(optionalAmount("\u00a31,000")).toBe(1000);
  });
  it("preserves Command Attention's procurement projection without an adapter", () => {
    const result = buildCapitalAllocation(input({ commitments: [commitment()] }));
    const projection: CommandAttentionInput["procurementQueue"] = result.procurementQueue;
    expect(projection[0]).toMatchObject({ readinessState: "Ready to buy", isCommitted: false, isRejected: false, approvalStatus: "Not reviewed" });
  });
  it("is deterministic and does not mutate frozen inputs or sort input arrays", () => {
    const facts = input({ opportunities: [opportunity({ id: "second" }), opportunity({ id: "first", strategicFit: "Exceptional" })], commitments: [commitment(), commitment({ id: "pending", pendingValidationReason: "Check" })], leads: [lead("Operations", 100, 200)] });
    const before = structuredClone(facts);
    const freeze = (value: unknown): void => {
      if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
    };
    freeze(facts);
    const result = buildCapitalAllocation(facts);
    vi.setSystemTime(new Date(2030, 0, 1));
    expect(buildCapitalAllocation(facts)).toEqual(result);
    expect(facts).toEqual(before);
  });
});