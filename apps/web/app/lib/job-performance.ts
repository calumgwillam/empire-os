import type { LeadRecord } from "./crm";
import { expenseCategoryOptions, jobCostTypeOptions, parseFinanceAmountInput, type ExpenseRecord, type IncomeRecord } from "./finance";
import { getDelegationReadinessMissingFields } from "./execution-release";
import { buildLeadDelivery, getDeliveryIncomeEvidence, type LeadDeliveryInput } from "./lead-delivery";
import { getLeadFollowThroughDate } from "./lead-follow-through";

export type JobPerformanceInput = LeadDeliveryInput & { expenses: readonly ExpenseRecord[] };
export type JobFinancialReview = {
  reviewedAt: string;
  reviewedByPersonId: string;
  evidence: string;
  revenueComplete: boolean;
  directCostsComplete: boolean;
  overheadCostsComplete: boolean;
  financialSnapshot: string;
};
export type JobPerformanceView = {
  leadId: string;
  title: string;
  area: string;
  service: string;
  quotedValue: number | null;
  finalJobValue: number | null;
  earnedSubtotal: number | null;
  receivedSubtotal: number | null;
  directCostSubtotal: number;
  overheadCostSubtotal: number;
  directCostsByCategory: { category: string; amount: number }[];
  incomeIds: string[];
  expenseIds: string[];
  completionSupported: boolean;
  reviewCurrent: boolean;
  knownCostsExceedEarned: boolean;
  contribution: number | null;
  contributionMarginPct: number | null;
  profitAfterAllocatedCosts: number | null;
  reasons: string[];
};
export type ServicePerformanceView = {
  area: string;
  service: string;
  jobCount: number;
  knownContributionCount: number;
  unknownContributionCount: number;
  contribution: number | null;
  profitAfterAllocatedCosts: number | null;
  knownProfitCount: number;
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function assertJobFinancialReview(value: unknown): void {
  if (value === undefined) return;
  if (!object(value) || !["reviewedAt", "reviewedByPersonId", "evidence", "financialSnapshot"]
    .every((field) => typeof value[field] === "string")
    || !["revenueComplete", "directCostsComplete", "overheadCostsComplete"].every((field) => typeof value[field] === "boolean")) {
    throw new Error("Job financial review is malformed; stored evidence must be preserved and reconciled.");
  }
}
export function assertLeadJobFinancialEvidence(value: unknown): void {
  if (!object(value) || (value.deliveryCommitment !== undefined
    && ["id", "leadName", "status", "relatedPillar", "serviceRequested", "quoteValue", "finalJobValue"]
      .some((field) => typeof value[field] !== "string"))) {
    throw new Error("Accepted job financial context is malformed; stored commercial data must be preserved and reconciled.");
  }
  assertJobFinancialReview(value.jobFinancialReview);
}
export function assertExpenseJobEvidence(value: unknown): void {
  if (!object(value) || ["relatedLeadId", "costReference", "incurredDate", "incurredEvidence", "allocationBasis"]
    .some((field) => value[field] !== undefined && typeof value[field] !== "string")
    || ["id", "date", "description", "supplier", "amount", "category", "area", "status", "notes", "dateCreated"]
      .some((field) => (value[field] !== undefined || Boolean(value.relatedLeadId)) && typeof value[field] !== "string")
    || (value.jobCostType !== undefined && !jobCostTypeOptions.some((type) => type === value.jobCostType))) {
    throw new Error("Expense job linkage or cost evidence is malformed; stored data must be preserved and reconciled.");
  }
}
function recordedEvent(value: string, nowMs: number): boolean {
  return Number.isFinite(getLeadFollowThroughDate(value))
    && Date.parse(value) <= (value.length === 10 ? Date.parse(new Date(nowMs).toISOString().slice(0, 10)) : nowMs);
}
function reference(value: string | undefined): string {
  return value?.trim().toLowerCase() || "";
}
function revenueReference(record: IncomeRecord): string {
  return reference(record.earnedReference) || reference(record.invoiceReference);
}
function moneyAmount(value: string): number | null {
  const amount = parseFinanceAmountInput(value);
  if (amount === null || !Number.isSafeInteger(Math.round(amount * 100))
    || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) return null;
  return Math.round(amount * 100) / 100;
}
function sumMoney(amounts: readonly number[]): number {
  return amounts.reduce((sum, amount) => sum + Math.round(amount * 100), 0) / 100;
}

export function getJobExpenseErrors(record: ExpenseRecord, input: JobPerformanceInput): string[] {
  const errors: string[] = [];
  if (!record.relatedLeadId) return errors;
  const leads = input.leads.filter((lead) => lead.id === record.relatedLeadId);
  if (leads.length !== 1 || !leads[0].deliveryCommitment) errors.push("Job cost has no unique accepted customer commitment");
  if (!record.id.trim() || input.expenses.filter((entry) => entry.id === record.id).length !== 1) errors.push("Expense identity is missing or duplicated");
  if (moneyAmount(record.amount) === null) errors.push("Job cost amount must be a valid non-negative amount with at most two decimal places");
  if (!expenseCategoryOptions.some((category) => category === record.category)) errors.push("Job cost category is missing or invalid");
  if (record.status !== "Planned" && record.status !== "Paid") errors.push("Expense cash status is invalid");
  if (!jobCostTypeOptions.some((type) => type === record.jobCostType)) errors.push("Job cost must explicitly identify direct cost or allocated overhead");
  if (!record.incurredEvidence?.trim() || !recordedEvent(record.incurredDate || "", input.nowMs)) errors.push("Job cost lacks valid dated incurred-cost evidence");
  const costReference = reference(record.costReference);
  if (!costReference || input.expenses.filter((entry) => reference(entry.costReference) === costReference).length !== 1) {
    errors.push("Job cost reference is missing or duplicated; do not allocate the same cost twice");
  }
  if (record.jobCostType === "Allocated overhead" && !record.allocationBasis?.trim()) errors.push("Allocated overhead lacks an explicit allocation basis");
  return errors;
}

export function validateJobExpenseSave(record: ExpenseRecord, input: JobPerformanceInput): void {
  if (!Number.isFinite(input.nowMs)) throw new Error("Job financial review requires a valid explicit clock.");
  assertExpenseJobEvidence(record);
  const errors = getJobExpenseErrors(record, {
    ...input, expenses: [...input.expenses.filter((entry) => entry.id !== record.id), record],
  });
  if (input.expenses.filter((entry) => entry.id === record.id).length > 1) errors.push("Expense identity is duplicated");
  if (errors.length) throw new Error(errors.join("; "));
}

function financialSnapshot(lead: LeadRecord, input: JobPerformanceInput): string {
  const sort = <T extends { id: string }>(entries: readonly T[]): T[] =>
    [...entries].sort((first, second) => first.id.localeCompare(second.id));
  return JSON.stringify({
    lead: [lead.id, lead.status, lead.serviceRequested, lead.relatedPillar, lead.quoteValue, lead.finalJobValue, lead.deliveryCommitment],
    actions: sort(input.actions.filter((action) => action.id === lead.deliveryCommitment?.actionId)),
    income: sort(input.income.filter((record) => record.relatedLeadId === lead.id)),
    expenses: sort(input.expenses.filter((record) => record.relatedLeadId === lead.id)),
  });
}

export function buildJobPerformance(input: JobPerformanceInput): JobPerformanceView[] {
  if (!Number.isFinite(input.nowMs)) throw new Error("Job financial review requires a valid explicit clock.");
  input.leads.filter((lead) => lead.deliveryCommitment).forEach(assertLeadJobFinancialEvidence);
  const delivery = buildLeadDelivery(input);
  return input.leads.filter((lead) => lead.deliveryCommitment).map((lead) => {
    const reasons: string[] = [];
    const incomes = input.income.filter((record) => record.relatedLeadId === lead.id);
    const expenses = input.expenses.filter((record) => record.relatedLeadId === lead.id);
    const supportedIncome = incomes.map((record) => {
      const evidence = getDeliveryIncomeEvidence(record, input);
      const recognitionReference = revenueReference(record);
      const uniqueRecognition = Boolean(recognitionReference) && input.income.filter((entry) =>
        revenueReference(entry) === recognitionReference).length === 1;
      const uniqueInvoice = !reference(record.invoiceReference) || input.income.filter((entry) =>
        reference(entry.invoiceReference) === reference(record.invoiceReference)).length === 1;
      const uniqueReceipt = !reference(record.receiptReference) || input.income.filter((entry) =>
        reference(entry.receiptReference) === reference(record.receiptReference)).length === 1;
      const amount = moneyAmount(record.amount);
      if (!evidence.earned || !uniqueRecognition || !uniqueInvoice || !evidence.valid || amount === null) reasons.push("JOB FINANCE: Income needs admissible dated earned evidence, a precise amount and a unique recognition or invoice reference");
      return { record, earned: evidence.earned && uniqueRecognition && uniqueInvoice && evidence.valid && amount !== null,
        received: evidence.received && uniqueReceipt && amount !== null };
    });
    const costErrors = expenses.flatMap((record) => getJobExpenseErrors(record, input));
    const directCostErrors = expenses.filter((record) => record.jobCostType !== "Allocated overhead")
      .flatMap((record) => getJobExpenseErrors(record, input));
    costErrors.forEach((reason) => reasons.push(`JOB FINANCE: ${reason}`));
    const supportedCosts = expenses.filter((record) => getJobExpenseErrors(record, input).length === 0);
    const totalCosts = (type: ExpenseRecord["jobCostType"]) => sumMoney(supportedCosts
      .filter((record) => record.jobCostType === type).map((record) => moneyAmount(record.amount) ?? 0));
    const earned = supportedIncome.filter((entry) => entry.earned);
    const receipts = supportedIncome.filter((entry) => entry.received);
    const earnedSubtotal = earned.length ? sumMoney(earned.map((entry) => moneyAmount(entry.record.amount) ?? 0)) : null;
    const receivedSubtotal = receipts.length ? sumMoney(receipts.map((entry) => moneyAmount(entry.record.amount) ?? 0)) : null;
    const directCostSubtotal = totalCosts("Direct");
    const overheadCostSubtotal = totalCosts("Allocated overhead");
    const completionSupported = delivery.find((entry) => entry.leadId === lead.id)?.completionSupported === true;
    const review = lead.jobFinancialReview;
    const reviewers = input.people.filter((person) => person.id === review?.reviewedByPersonId);
    const financialEvents = [lead.deliveryCommitment?.recordedAt,
      input.actions.find((action) => action.id === lead.deliveryCommitment?.actionId)?.completionDate,
      ...incomes.flatMap((record) => [record.earnedDate, record.invoiceIssuedDate, record.status === "Received" ? record.date : undefined]),
      ...expenses.map((record) => record.incurredDate)].filter((value): value is string => Boolean(value));
    const reviewCurrent = Boolean(review && review.evidence.trim() && review.reviewedAt.length > 10
      && recordedEvent(review.reviewedAt, input.nowMs)
      && financialEvents.every((event) => Date.parse(event) <= Date.parse(review.reviewedAt))
      && reviewers.length === 1 && reviewers[0].status === "Active" && reviewers[0].name.trim()
      && getDelegationReadinessMissingFields(reviewers[0]).length === 0
      && review.financialSnapshot === financialSnapshot(lead, input));
    const revenueSupported = incomes.length > 0 && earned.length === incomes.length;
    const contributionKnown = completionSupported && reviewCurrent && review?.revenueComplete
      && review.directCostsComplete && revenueSupported && directCostErrors.length === 0;
    const contribution = contributionKnown && earnedSubtotal !== null ? sumMoney([earnedSubtotal, -directCostSubtotal]) : null;
    const profitAfterAllocatedCosts = contribution !== null && review?.overheadCostsComplete && costErrors.length === 0
      ? sumMoney([contribution, -overheadCostSubtotal]) : null;
    const knownCostsExceedEarned = completionSupported && earnedSubtotal !== null && directCostSubtotal > earnedSubtotal;
    if (completionSupported) {
      if (!revenueSupported) reasons.push("JOB FINANCE: Completed work lacks complete evidence-supported earned revenue");
      if (!reviewCurrent) reasons.push("JOB FINANCE: Completed job needs a current attributed financial coverage review");
      if (!reviewCurrent || !review?.directCostsComplete) reasons.push("JOB FINANCE: Labour, materials, transport, equipment, subcontracting and other direct-cost coverage is not confirmed");
      if (!reviewCurrent || !review?.overheadCostsComplete) reasons.push("JOB FINANCE: Shared overhead coverage is unknown; do not treat contribution as net profit");
    }
    if (contribution !== null && contribution < 0) reasons.push("JOB FINANCE: Reviewed job contribution is negative; review pricing, scope and execution costs");
    if (contribution === null && knownCostsExceedEarned) reasons.push("JOB FINANCE: Completed job known direct costs exceed currently evidenced earned revenue; reconcile coverage before concluding a loss");
    if (profitAfterAllocatedCosts !== null && profitAfterAllocatedCosts < 0) reasons.push("JOB FINANCE: Reviewed profit after allocated costs is negative; review the service economics");
    return {
      leadId: lead.id, title: lead.leadName, area: lead.relatedPillar, service: lead.serviceRequested.trim(),
      quotedValue: parseFinanceAmountInput(lead.quoteValue), finalJobValue: parseFinanceAmountInput(lead.finalJobValue),
      earnedSubtotal, receivedSubtotal, directCostSubtotal, overheadCostSubtotal,
      directCostsByCategory: expenseCategoryOptions.map((category) => ({ category, amount: sumMoney(supportedCosts
        .filter((record) => record.jobCostType === "Direct" && record.category === category)
        .map((record) => moneyAmount(record.amount) ?? 0)) })),
      incomeIds: incomes.map((record) => record.id), expenseIds: expenses.map((record) => record.id),
      completionSupported, reviewCurrent, knownCostsExceedEarned, contribution,
      contributionMarginPct: contribution !== null && earnedSubtotal !== null && earnedSubtotal > 0
        ? contribution / earnedSubtotal * 100 : null,
      profitAfterAllocatedCosts, reasons: [...new Set(reasons)],
    };
  });
}

export function recordJobFinancialReview(input: JobPerformanceInput, leadId: string,
  request: Omit<JobFinancialReview, "reviewedAt" | "financialSnapshot">): LeadRecord {
  assertJobFinancialReview({ ...request, reviewedAt: "", financialSnapshot: "" });
  const leads = input.leads.filter((lead) => lead.id === leadId);
  const people = input.people.filter((person) => person.id === request.reviewedByPersonId);
  if (leads.length !== 1 || !leads[0].deliveryCommitment) throw new Error("Select a unique accepted job before reviewing financial coverage.");
  if (people.length !== 1 || people[0].status !== "Active" || !people[0].name.trim()
    || getDelegationReadinessMissingFields(people[0]).length) throw new Error("Financial review requires an active delegation-ready Person.");
  if (!request.evidence.trim()) throw new Error("Record the evidence and completeness basis for the financial review, including any genuinely zero costs.");
  const view = buildJobPerformance(input).find((entry) => entry.leadId === leadId);
  if (!view?.completionSupported) throw new Error("Financial coverage review requires evidence-supported delivery completion.");
  return { ...leads[0], jobFinancialReview: { ...request, evidence: request.evidence.trim(),
    reviewedAt: new Date(input.nowMs).toISOString(), financialSnapshot: financialSnapshot(leads[0], input) } };
}

export function buildServicePerformance(jobs: readonly JobPerformanceView[]): ServicePerformanceView[] {
  const groups = new Map<string, ServicePerformanceView>();
  jobs.forEach((job) => {
    const key = JSON.stringify([job.area, job.service.toLowerCase()]);
    const group = groups.get(key) || { area: job.area, service: job.service, jobCount: 0, knownContributionCount: 0,
      unknownContributionCount: 0, contribution: null, profitAfterAllocatedCosts: null, knownProfitCount: 0 };
    group.jobCount++;
    if (job.contribution === null) group.unknownContributionCount++;
    else { group.knownContributionCount++; group.contribution = sumMoney([group.contribution ?? 0, job.contribution]); }
    if (job.profitAfterAllocatedCosts !== null) {
      group.knownProfitCount++;
      group.profitAfterAllocatedCosts = sumMoney([group.profitAfterAllocatedCosts ?? 0, job.profitAfterAllocatedCosts]);
    }
    groups.set(key, group);
  });
  return [...groups.values()].sort((first, second) => first.area.localeCompare(second.area) || first.service.localeCompare(second.service));
}
