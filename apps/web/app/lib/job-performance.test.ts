import { describe, expect, it } from "vitest";
import { defaultLeadForm, type LeadRecord } from "./crm";
import { normalizeActionRecord } from "./capture-conversions";
import { sanitizeExpenseRecord, sanitizeIncomeRecord, type ExpenseRecord, type IncomeRecord } from "./finance";
import { acceptLeadDelivery, validateDeliveryIncomeSave } from "./lead-delivery";
import { assertExpenseJobEvidence, assertJobFinancialReview, buildJobPerformance, buildServicePerformance,
  getJobExpenseErrors, recordJobFinancialReview, validateJobExpenseSave, type JobPerformanceInput } from "./job-performance";
import { buildCommandAttention, type CommandAttentionInput } from "./command-attention";
import { BACKUP_FORMAT, BACKUP_VERSION, EXPENSE_STORAGE_KEY, INCOME_STORAGE_KEY, LEAD_STORAGE_KEY, validateEmpireOsBackup } from "./backup";
import { persistJsonArraysTransaction } from "./persistence";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const person = { id: "reviewer-1", name: "Commercial owner", status: "Active", role: "Commercial operations",
  responsibilities: "Review job financial evidence", authority: "Review job costs and revenue" };
const job = (overrides: Partial<LeadRecord> = {}): LeadRecord => ({ ...defaultLeadForm, id: "lead-1",
  leadName: "Accepted customer job", serviceRequested: "Maintenance", status: "Won", quoteValue: "1200",
  finalJobValue: "1000", dateCreated: "2026-10-01T10:00:00Z", ...overrides });
const income = (overrides: Partial<IncomeRecord> = {}): IncomeRecord => ({
  id: "income-1", relatedLeadId: "lead-1", date: "2026-10-10", description: "Earned customer scope",
  customerSource: "Customer", amount: "1000", area: "Garden Maintenance", status: "Expected", notes: "",
  dateCreated: "2026-10-08T11:00:00Z", earnedDate: "2026-10-08", earnedEvidence: "Accepted scope delivered",
  earnedReference: "revenue-1", ...overrides,
});
const expense = (overrides: Partial<ExpenseRecord> = {}): ExpenseRecord => ({
  id: "expense-1", date: "2026-10-08", description: "Direct job labour", supplier: "Labour provider", amount: "300",
  category: "Labour", area: "Garden Maintenance", status: "Planned", notes: "", dateCreated: "2026-10-08T11:00:00Z",
  relatedLeadId: "lead-1", jobCostType: "Direct", costReference: "cost-1", incurredDate: "2026-10-08",
  incurredEvidence: "Approved time record and genuine labour cost basis", ...overrides,
});
function input(overrides: Partial<JobPerformanceInput> = {}): JobPerformanceInput {
  const accepted = acceptLeadDelivery({ leads: [job()], actions: [], people: [person], income: [], nowMs: NOW - 86400000 }, {
    leadId: "lead-1", actionId: "delivery-1", scope: "Customer accepted scope", acceptedAt: "2026-10-02",
    acceptedByPersonId: person.id, acceptanceEvidence: "Customer signed scope", ownerPersonId: person.id, promisedBy: "2026-10-08",
  });
  return { leads: [accepted.lead], actions: [{ ...accepted.action, status: "Completed",
    completionDate: "2026-10-08T10:00:00Z", completionEvidence: "Delivery evidence and customer acknowledgement" }],
    people: [person], income: [income()], expenses: [expense()], nowMs: NOW, ...overrides };
}
function reviewed(source: JobPerformanceInput, overrides: Partial<Parameters<typeof recordJobFinancialReview>[2]> = {}): JobPerformanceInput {
  const nextLead = recordJobFinancialReview(source, source.leads[0].id, { reviewedByPersonId: person.id,
    evidence: "All earned revenue and direct-cost categories reviewed against source records; remaining categories have no costs. Overheads not yet complete.",
    revenueComplete: true, directCostsComplete: true, overheadCostsComplete: false, ...overrides });
  return { ...source, leads: source.leads.map((lead) => lead.id === nextLead.id ? nextLead : lead) };
}
const command = (overrides: Partial<CommandAttentionInput> = {}): CommandAttentionInput => ({
  problems: [], actions: [], outreach: [], projects: [], decisions: [], opportunities: [], lessons: [], systems: [],
  sops: [], handoffs: [], procurementQueue: [], nowMs: NOW, ...overrides,
});

describe("Evidence-aware job performance", () => {
  it("does not infer earned revenue, receipts or profit from quote/final job value or missing costs", () => {
    const view = buildJobPerformance(input({ income: [], expenses: [] }))[0];
    expect(view).toMatchObject({ quotedValue: 1200, finalJobValue: 1000, earnedSubtotal: null, receivedSubtotal: null,
      directCostSubtotal: 0, contribution: null, contributionMarginPct: null, profitAfterAllocatedCosts: null });
    expect(view.reasons.join(" ")).toContain("coverage is not confirmed");
    expect(view.reasons.join(" ")).toContain("earned revenue");
  });
  it("never creates a job from an unaccepted Won Lead or silently infers contracted price", () => {
    expect(buildJobPerformance(input({ leads: [job()] }))).toEqual([]);
  });
  it("keeps earned revenue, receipts, incurred costs and cash statuses independent", () => {
    const source = input();
    expect(buildJobPerformance(source)[0]).toMatchObject({ earnedSubtotal: 1000, receivedSubtotal: null,
      directCostSubtotal: 300, contribution: null });
    const paidButUnsupported = input({ expenses: [expense({ status: "Paid", incurredEvidence: "", incurredDate: "" })] });
    expect(buildJobPerformance(reviewed(paidButUnsupported))[0]).toMatchObject({ directCostSubtotal: 0, contribution: null });
    const receivedUnearned = income({ earnedDate: undefined, earnedEvidence: undefined, date: "2026-10-08",
      status: "Received", receiptReference: "receipt-1", receiptEvidence: "Dated customer payment confirmation" });
    expect(buildJobPerformance(reviewed(input({ income: [receivedUnearned] })))[0]).toMatchObject({
      earnedSubtotal: null, receivedSubtotal: 1000, contribution: null,
    });
  });
  it("requires current explicit revenue/direct-cost coverage and keeps overhead-dependent profit unknown", () => {
    const source = reviewed(input());
    expect(buildJobPerformance(source)[0]).toMatchObject({ completionSupported: true, reviewCurrent: true,
      earnedSubtotal: 1000, contribution: 700, contributionMarginPct: 70, profitAfterAllocatedCosts: null });
    expect(buildJobPerformance(reviewed(input(), { directCostsComplete: false }))[0].contribution).toBeNull();
    expect(buildJobPerformance(reviewed(input(), { revenueComplete: false }))[0].contribution).toBeNull();
  });
  it("distinguishes an evidenced zero direct-cost job from an unreviewed empty cost store", () => {
    const source = input({ expenses: [] });
    expect(buildJobPerformance(source)[0].contribution).toBeNull();
    expect(buildJobPerformance(reviewed(source, { overheadCostsComplete: true,
      evidence: "All categories reviewed; no direct or allocable overhead costs were incurred for this recorded scope." }))[0])
      .toMatchObject({ contribution: 1000, profitAfterAllocatedCosts: 1000 });
    expect(buildJobPerformance(reviewed(input({ expenses: [], income: [] }), { overheadCostsComplete: true }))[0].contribution).toBeNull();
  });
  it("reports cost categories and avoids treating overhead as direct cost or contribution as net profit", () => {
    const costs = ["Labour", "Materials", "Fuel", "Equipment", "Subcontractor", "Vehicle", "Other"].map((category, index) =>
      expense({ id: `expense-${index}`, costReference: `cost-${index}`, category, amount: "100" }));
    costs.push(expense({ id: "overhead", costReference: "shared-1", jobCostType: "Allocated overhead",
      category: "Insurance", amount: "50", allocationBasis: "Whole genuine dedicated policy charge belongs to this job" }));
    const view = buildJobPerformance(reviewed(input({ expenses: costs }), { overheadCostsComplete: true }))[0];
    expect(view).toMatchObject({ directCostSubtotal: 700, overheadCostSubtotal: 50, contribution: 300,
      profitAfterAllocatedCosts: 250 });
    for (const category of ["Labour", "Materials", "Fuel", "Equipment", "Subcontractor", "Vehicle", "Other"]) {
      expect(view.directCostsByCategory.find((entry) => entry.category === category)?.amount).toBe(100);
    }
    expect(view.directCostsByCategory.find((entry) => entry.category === "Insurance")?.amount).toBe(0);
  });
  it("keeps evidenced direct contribution independent of unresolved overhead allocation", () => {
    const source = reviewed(input({ expenses: [expense(), expense({ id: "overhead", costReference: "overhead-1",
      amount: "50", jobCostType: "Allocated overhead", allocationBasis: "" })] }), { overheadCostsComplete: true });
    const view = buildJobPerformance(source)[0];
    expect(view).toMatchObject({ contribution: 700, overheadCostSubtotal: 0, profitAfterAllocatedCosts: null });
    expect(view.reasons.join(" ")).toContain("allocation basis");
  });
  it("uses exact pence for genuine zero margins and does not create floating-point losses", () => {
    const view = buildJobPerformance(reviewed(input({ income: [income({ amount: "0.30" })],
      expenses: [expense({ amount: "0.10" }), expense({ id: "expense-2", costReference: "cost-2", amount: "0.20" })] }),
    { overheadCostsComplete: true }))[0];
    expect(view).toMatchObject({ earnedSubtotal: 0.3, directCostSubtotal: 0.3, contribution: 0,
      contributionMarginPct: 0, profitAfterAllocatedCosts: 0 });
    expect(view.reasons.some((reason) => reason.includes("negative"))).toBe(false);
    expect(buildJobPerformance(reviewed(input({ income: [income({ amount: "0" })], expenses: [] })))[0])
      .toMatchObject({ contribution: 0, contributionMarginPct: null });
  });
  it("does not silently round imprecise or invalid financial evidence into profit", () => {
    expect(buildJobPerformance(reviewed(input({ income: [income({ amount: "1.001" })] })))[0].contribution).toBeNull();
    for (const amount of ["", "-1", "garbage", "1.001"]) {
      expect(() => validateJobExpenseSave(expense({ amount }), input())).toThrow("amount");
    }
  });
  it("surfaces negative contribution and post-allocation losses through existing Lead navigation", () => {
    const source = reviewed(input({ expenses: [expense({ amount: "1100" })] }), { overheadCostsComplete: true });
    const view = buildJobPerformance(source)[0];
    expect(view).toMatchObject({ contribution: -100, contributionMarginPct: -10, profitAfterAllocatedCosts: -100 });
    const items = buildCommandAttention(command({ jobPerformance: source })).items;
    expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ id: "lead-1", objectType: "Lead",
      attentionRank: 2, navigationMode: "record-handler", reasons: expect.arrayContaining(view.reasons) })]));
    const overheadLoss = reviewed(input({ expenses: [expense(), expense({ id: "overhead", costReference: "overhead-1",
      amount: "800", jobCostType: "Allocated overhead", allocationBasis: "Whole dedicated charge attributable to this job" })] }),
    { overheadCostsComplete: true });
    expect(buildJobPerformance(overheadLoss)[0]).toMatchObject({ contribution: 700, profitAfterAllocatedCosts: -100 });
    expect(buildCommandAttention(command({ jobPerformance: overheadLoss })).items[0].attentionRank).toBe(2);
  });
  it("surfaces incomplete completed job costs but does not add job attention when omitted", () => {
    const view = buildJobPerformance(input())[0];
    expect(buildCommandAttention(command()).items).toEqual([]);
    expect(buildCommandAttention(command({ jobPerformance: input() })).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: "Lead", id: "lead-1", reasons: expect.arrayContaining(view.reasons) }),
    ]));
  });
  it("prompts investigation of a known-cost exposure without presenting an unreviewed job as a confirmed loss", () => {
    const source = input({ expenses: [expense({ amount: "1100" })] });
    const view = buildJobPerformance(source)[0];
    expect(view).toMatchObject({ knownCostsExceedEarned: true, contribution: null, profitAfterAllocatedCosts: null });
    expect(view.reasons.join(" ")).toContain("before concluding a loss");
    expect(buildCommandAttention(command({ jobPerformance: source })).items[0].attentionRank).toBe(2);
  });
  it("does not weaken urgent ordinary Actions while adding job financial attention", () => {
    const source = input();
    const action = normalizeActionRecord({ id: "ordinary-1", sourceCaptureId: "", targetType: "Convert to Action",
      title: "Urgent ordinary work", originalRawNote: "", createdAt: "2026-10-01T10:00:00Z",
      status: "Blocked", priority: "Critical", importance: "High", relatedArea: "Garden Maintenance", dueDate: "2026-10-07" });
    const baseline = buildCommandAttention(command({ actions: [action] })).items.find((item) => item.id === action.id);
    const enriched = buildCommandAttention(command({ actions: [action], jobPerformance: source })).items.find((item) => item.id === action.id);
    expect(enriched).toEqual(baseline);
  });
  it("invalidates coverage after income/cost additions, edits, deletions, delivery changes or commercial context changes", () => {
    const source = reviewed(input(), { overheadCostsComplete: true });
    const changed: JobPerformanceInput[] = [
      { ...source, expenses: [] },
      { ...source, expenses: [expense({ amount: "301" })] },
      { ...source, expenses: [...source.expenses, expense({ id: "expense-2", costReference: "cost-2" })] },
      { ...source, income: [] },
      { ...source, income: [income({ amount: "999" })] },
      { ...source, income: [...source.income, income({ id: "income-2", earnedReference: "revenue-2" })] },
      { ...source, actions: source.actions.map((action) => ({ ...action, completionEvidence: "Revised completion evidence" })) },
      { ...source, leads: source.leads.map((lead) => ({ ...lead, finalJobValue: "1200" })) },
      { ...source, leads: source.leads.map((lead) => ({ ...lead, serviceRequested: "Different scope" })) },
    ];
    for (const current of changed) expect(buildJobPerformance(current)[0]).toMatchObject({
      reviewCurrent: false, contribution: null, profitAfterAllocatedCosts: null,
    });
    expect(buildJobPerformance({ ...source, nowMs: NOW + 86400000 })[0].reviewCurrent).toBe(true);
  });
  it("cannot rely on a review timestamp that predates the underlying financial or completion events", () => {
    const source = reviewed(input());
    const leads = source.leads.map((lead) => ({ ...lead, jobFinancialReview: lead.jobFinancialReview
      ? { ...lead.jobFinancialReview, reviewedAt: "2026-10-07T12:00:00Z" } : undefined }));
    expect(buildJobPerformance({ ...source, leads })[0]).toMatchObject({ reviewCurrent: false, contribution: null });
  });
  it("preserves reviews across input record reordering without mutating records", () => {
    const source = input({ expenses: [expense(), expense({ id: "expense-2", costReference: "cost-2" })] });
    const before = JSON.stringify(source);
    const reviewedSource = reviewed(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(buildJobPerformance({ ...reviewedSource, expenses: [...reviewedSource.expenses].reverse() })[0].reviewCurrent).toBe(true);
  });
  it("does not let inactive, ambiguous or unready reviewers establish known profitability", () => {
    const source = reviewed(input());
    for (const people of [[], [{ ...person, status: "Inactive" }], [person, person], [{ ...person, authority: "" }]]) {
      expect(buildJobPerformance({ ...source, people })[0].contribution).toBeNull();
      expect(() => reviewed(input({ people }))).toThrow("Person");
    }
    expect(() => reviewed(input(), { evidence: " " })).toThrow("evidence");
    expect(() => reviewed(input({ actions: input().actions.map((action) => ({ ...action, completionDate: "2026-10-06" })) })))
      .toThrow("completion");
    expect(() => buildJobPerformance(input({ nowMs: NaN }))).toThrow("clock");
  });
  it("requires whole-record job attribution, actual incurred evidence and an overhead allocation basis", () => {
    for (const partial of [
      { relatedLeadId: "missing" }, { jobCostType: undefined }, { incurredEvidence: "" },
      { incurredDate: "2026-02-30" }, { incurredDate: "2026-10-09" }, { costReference: "" },
      { jobCostType: "Allocated overhead" as const, allocationBasis: "" },
    ]) expect(() => validateJobExpenseSave(expense(partial), input())).toThrow();
    expect(() => validateJobExpenseSave(expense({ status: "Planned" }), input())).not.toThrow();
    expect(() => validateJobExpenseSave(expense({ incurredDate: "2026-10-08" }), input())).not.toThrow();
    const legacy = expense({ relatedLeadId: undefined, jobCostType: undefined, incurredDate: undefined,
      incurredEvidence: undefined, costReference: undefined });
    expect(() => validateJobExpenseSave(legacy, input())).not.toThrow();
  });
  it("rejects duplicate expense identities and globally repeated source-cost references", () => {
    const duplicateId = input({ expenses: [expense(), expense()] });
    expect(buildJobPerformance(reviewed(duplicateId))[0].contribution).toBeNull();
    expect(() => validateJobExpenseSave(expense(), duplicateId)).toThrow("identity");
    const crossJobDuplicate = input({ expenses: [expense(), expense({ id: "expense-2", relatedLeadId: "another-job", costReference: " COST-1 " })] });
    expect(getJobExpenseErrors(expense(), crossJobDuplicate).join(" ")).toContain("duplicated");
    expect(buildJobPerformance(reviewed(crossJobDuplicate))[0].contribution).toBeNull();
    expect(() => validateJobExpenseSave(expense(), crossJobDuplicate)).toThrow("same cost twice");
  });
  it("requires unique recognised revenue and does not duplicate receipts or ignore contradictory income", () => {
    const duplicates = input({ income: [income(), income({ id: "income-2", relatedLeadId: "another-job", earnedReference: " REVENUE-1 " })] });
    expect(buildJobPerformance(reviewed(duplicates))[0]).toMatchObject({ earnedSubtotal: null, contribution: null });
    expect(() => validateDeliveryIncomeSave(duplicates.income[0], duplicates)).toThrow("recognition reference");
    const duplicateId = input({ income: [income(), income()] });
    expect(buildJobPerformance(reviewed(duplicateId))[0].contribution).toBeNull();
    const legacyEvidence = input({ income: [income({ earnedReference: undefined })] });
    expect(buildJobPerformance(reviewed(legacyEvidence))[0].contribution).toBeNull();
    const contradicted = income({ receiptReference: "receipt-1", receiptEvidence: "Receipt claim but still Expected" });
    expect(buildJobPerformance(reviewed(input({ income: [contradicted] })))[0].contribution).toBeNull();
    const receipt = income({ status: "Received", date: "2026-10-08", receiptReference: "receipt-1", receiptEvidence: "Payment confirmation" });
    expect(buildJobPerformance(input({ income: [receipt, { ...receipt, id: "income-2", earnedReference: "revenue-2" }] }))[0].receivedSubtotal).toBeNull();
  });
  it("can reuse an existing unique evidenced invoice as recognition identity without turning collection gaps into profit blockers", () => {
    const record = income({ earnedReference: " ", invoiceReference: "invoice-1", invoiceIssuedDate: "2026-10-08",
      invoiceEvidence: "Genuine invoice issued for this earned scope" });
    expect(buildJobPerformance(reviewed(input({ income: [record] })))[0]).toMatchObject({ contribution: 700, receivedSubtotal: null });
    const duplicates = input({ income: [record, { ...record, id: "income-2", earnedReference: "another-earn",
      invoiceReference: " INVOICE-1 " }] });
    expect(buildJobPerformance(reviewed(duplicates))[0].contribution).toBeNull();
  });
  it("routes orphaned job cost attribution to the existing Expense editor", () => {
    const source = input({ leads: [], expenses: [expense({ relatedLeadId: "missing" })] });
    expect(buildCommandAttention(command({ jobPerformance: source })).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "expense:expense-1", objectType: "Finance", navigationMode: "record-handler" }),
    ]));
  });
  it("does not turn missing profitability controls into billing/collection save failures", () => {
    const record = income();
    expect(buildJobPerformance(input())[0].contribution).toBeNull();
    expect(() => validateDeliveryIncomeSave(record, input())).not.toThrow();
  });
  it("reports service samples with unknown counts rather than zero profit or inflated whole-service margins", () => {
    const known = buildJobPerformance(reviewed(input(), { overheadCostsComplete: true }))[0];
    const unknown = { ...buildJobPerformance(input())[0], leadId: "lead-2", service: "maintenance" };
    expect(buildServicePerformance([known, unknown])[0]).toMatchObject({ jobCount: 2, knownContributionCount: 1,
      unknownContributionCount: 1, contribution: 700, knownProfitCount: 1, profitAfterAllocatedCosts: 700 });
    expect(buildServicePerformance([unknown])[0]).toMatchObject({ contribution: null, profitAfterAllocatedCosts: null });
    expect(buildServicePerformance([known, { ...unknown, area: "Excavation" }])).toHaveLength(2);
  });
  it("preserves legacy absence and genuine optional evidence through sanitisation", () => {
    const deps = { generateId: () => "generated", nowIso: () => new Date(NOW).toISOString() };
    const legacy: ExpenseRecord = { id: "legacy", date: "2026-10-08", description: " Legacy ", supplier: "",
      amount: " 10 ", category: "Other", area: "Garden Maintenance", status: "Paid", notes: "", dateCreated: "" };
    const cleaned = sanitizeExpenseRecord(legacy, deps);
    expect(cleaned).not.toHaveProperty("relatedLeadId");
    expect(cleaned).not.toHaveProperty("incurredEvidence");
    expect(sanitizeExpenseRecord(expense({ costReference: " cost-1 ", incurredEvidence: " evidence ",
      allocationBasis: " dedicated cost " }), deps)).toMatchObject({ costReference: "cost-1", incurredEvidence: "evidence",
      allocationBasis: "dedicated cost", jobCostType: "Direct" });
    expect(sanitizeIncomeRecord(income({ earnedReference: " revenue-1 " }), deps).earnedReference).toBe("revenue-1");
    const legacyIncome = { ...income() };
    delete legacyIncome.earnedReference;
    expect(sanitizeIncomeRecord(legacyIncome, deps)).not.toHaveProperty("earnedReference");
  });
});

describe("Job financial backup and integrity boundaries", () => {
  const backup = (storage: Record<string, string>) => ({ format: BACKUP_FORMAT, version: BACKUP_VERSION,
    createdAt: new Date(NOW).toISOString(), storage });
  it("preserves optional job evidence and coverage review in version-one backups", () => {
    const source = reviewed(input());
    const storage = { [LEAD_STORAGE_KEY]: JSON.stringify(source.leads), [EXPENSE_STORAGE_KEY]: JSON.stringify(source.expenses),
      [INCOME_STORAGE_KEY]: JSON.stringify(source.income) };
    expect(validateEmpireOsBackup(backup(storage)).storage).toEqual(storage);
    expect(() => assertExpenseJobEvidence({ id: "legacy" })).not.toThrow();
    expect(() => assertJobFinancialReview(undefined)).not.toThrow();
  });
  it("rejects malformed optional job fields and review payloads before restoration", () => {
    for (const field of ["relatedLeadId", "costReference", "incurredDate", "incurredEvidence", "allocationBasis", "jobCostType"]) {
      expect(() => validateEmpireOsBackup(backup({ [EXPENSE_STORAGE_KEY]: JSON.stringify([{ ...expense(), [field]: 1 }]) }))).toThrow("malformed");
    }
    for (const jobFinancialReview of [null, {}, { reviewedByPersonId: 1 }, { ...reviewed(input()).leads[0].jobFinancialReview, directCostsComplete: "yes" }]) {
      expect(() => validateEmpireOsBackup(backup({ [LEAD_STORAGE_KEY]: JSON.stringify([{ ...job(), jobFinancialReview }]) }))).toThrow("malformed");
    }
    expect(() => validateEmpireOsBackup(backup({ [INCOME_STORAGE_KEY]: JSON.stringify([{ ...income(), earnedReference: 1 }]) }))).toThrow("malformed");
    expect(() => assertExpenseJobEvidence({ ...expense(), amount: 1 })).toThrow("malformed");
    expect(() => assertExpenseJobEvidence({ relatedLeadId: "lead-1" })).toThrow("malformed");
  });
  it("uses existing transactional rollback to preserve costs and review on a failed write", () => {
    const source = reviewed(input());
    const priorLead = JSON.stringify(source.leads);
    const priorCosts = JSON.stringify(source.expenses);
    const stored = new Map([[LEAD_STORAGE_KEY, priorLead], [EXPENSE_STORAGE_KEY, priorCosts]]);
    let fail = true;
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      removeItem: (key: string) => { stored.delete(key); },
      setItem: (key: string, value: string) => {
        stored.set(key, value);
        if (key === EXPENSE_STORAGE_KEY && fail) { fail = false; throw new Error("Write failed"); }
      },
    };
    expect(() => persistJsonArraysTransaction(storage, [
      { key: LEAD_STORAGE_KEY, records: [job()] }, { key: EXPENSE_STORAGE_KEY, records: [expense({ amount: "999" })] },
    ])).toThrow("Write failed");
    expect(stored.get(LEAD_STORAGE_KEY)).toBe(priorLead);
    expect(stored.get(EXPENSE_STORAGE_KEY)).toBe(priorCosts);
  });
});
