export const commitmentCertaintyOptions = ["Committed", "Quoted", "Planned"] as const;
export type CommitmentCertainty = (typeof commitmentCertaintyOptions)[number];
export const procurementApprovalStatusOptions = ["Not reviewed", "Approved", "Rejected"] as const;
export type ProcurementApprovalStatus = (typeof procurementApprovalStatusOptions)[number];
export type ProcurementQuoteState = "Current" | "Expiring soon" | "Expired" | "No expiry recorded";
export const quoteRevalidationOutcomeOptions = ["Price confirmed", "Price changed", "Quote no longer available"] as const;
export type QuoteRevalidationOutcome = (typeof quoteRevalidationOutcomeOptions)[number];
export const QUOTE_UNAVAILABLE_VALIDATION_REASON = "Quoted price is no longer available; further price research is required.";
export const capitalDecisionOutcomeOptions = ["Approve", "Reject", "Defer", "Mark Pending validation"] as const;
export type CapitalDecisionOutcome = (typeof capitalDecisionOutcomeOptions)[number];

export type CommitmentRecord = {
  id: string;
  commitmentName: string;
  amount: string;
  dueDate: string;
  type: string;
  status: string;
  certainty?: CommitmentCertainty;
  relatedPillar: string;
  procurementNeed?: string;
  originalBudget?: string;
  targetPrice?: string;
  actualPurchasePrice?: string;
  supplier?: string;
  expectedPurchaseDate?: string;
  actualPurchaseDate?: string;
  quoteCheckedDate?: string;
  quoteExpiryDate?: string;
  quoteReference?: string;
  quoteNotes?: string;
  quoteRevalidationOutcome?: QuoteRevalidationOutcome;
  quoteRevalidatedBy?: string;
  quoteRevalidationDate?: string;
  quotePreviousPrice?: string;
  quoteConfirmedPrice?: string;
  quoteRevalidationNotes?: string;
  purchaseEvidenceReference?: string;
  invoiceOrderReference?: string;
  evidenceNotes?: string;
  actualSupplier?: string;
  pendingValidationReason?: string;
  approvalStatus?: ProcurementApprovalStatus;
  approvedRejectedBy?: string;
  approvalDate?: string;
  approvalRationale?: string;
  capitalDecisionOutcome?: CapitalDecisionOutcome;
  capitalDecisionDeferredUntil?: string;
  notes: string;
  dateCreated: string;
};

// Zero is a valid entry, so emptiness is tested explicitly rather than by truthiness.
export function parseFinanceAmountInput(value: string) {
  const normalised = value.replace(/[£$,\s]/g, "");

  if (normalised === "" || !/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalised)) {
    return null;
  }

  const parsed = Number(normalised);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

// Legacy records with no stored certainty behave exactly as before (i.e. as a genuine commitment).
export function getEffectiveCommitmentCertainty(commitment: { certainty?: string }): CommitmentCertainty {
  return commitmentCertaintyOptions.includes(commitment.certainty as CommitmentCertainty)
    ? (commitment.certainty as CommitmentCertainty)
    : "Committed";
}

export function hasPendingProcurementValidation(commitment: { pendingValidationReason?: string }): boolean {
  return Boolean(commitment.pendingValidationReason?.trim());
}

export function getEffectiveProcurementApprovalStatus(commitment: { approvalStatus?: string }): ProcurementApprovalStatus {
  return procurementApprovalStatusOptions.includes(commitment.approvalStatus as ProcurementApprovalStatus)
    ? (commitment.approvalStatus as ProcurementApprovalStatus)
    : "Not reviewed";
}

export function getProcurementQuoteState(commitment: {
  targetPrice?: string;
  quoteCheckedDate?: string;
  quoteExpiryDate?: string;
  quoteReference?: string;
  quoteNotes?: string;
}): ProcurementQuoteState | null {
  const hasQuoteContext = Boolean(
    commitment.targetPrice?.trim()
    || commitment.quoteCheckedDate?.trim()
    || commitment.quoteExpiryDate?.trim()
    || commitment.quoteReference?.trim()
    || commitment.quoteNotes?.trim(),
  );
  if (!hasQuoteContext) return null;
  if (!commitment.quoteExpiryDate?.trim()) return "No expiry recorded";

  const todayMs = new Date().setHours(0, 0, 0, 0);
  const expiryMs = new Date(`${commitment.quoteExpiryDate.slice(0, 10)}T00:00:00`).getTime();
  if (Number.isNaN(expiryMs)) return "No expiry recorded";
  if (expiryMs < todayMs) return "Expired";
  if (expiryMs <= todayMs + (7 * 24 * 60 * 60 * 1000)) return "Expiring soon";
  return "Current";
}

export function hasExecutableProcurementApproval(commitment: Parameters<typeof getProcurementQuoteState>[0] & { approvalStatus?: string; pendingValidationReason?: string }): boolean {
  return getEffectiveProcurementApprovalStatus(commitment) === "Approved"
    && !hasPendingProcurementValidation(commitment)
    && getProcurementQuoteState(commitment) !== "Expired";
}

export type ProcurementApprovalBlock = "quote-expired" | "pending-validation" | "approval-required";

export function getProcurementApprovalBlock(commitment: CommitmentRecord): ProcurementApprovalBlock | null {
  if (hasExecutableProcurementApproval(commitment)) return null;
  return getProcurementQuoteState(commitment) === "Expired"
    ? "quote-expired"
    : hasPendingProcurementValidation(commitment) ? "pending-validation" : "approval-required";
}

export function sanitizeCommitmentFromEditor(
  editorSnapshot: CommitmentRecord,
  deps: { generateId: () => string; nowIso: () => string },
): CommitmentRecord {
  return {
    ...editorSnapshot,
    id: editorSnapshot.id || deps.generateId(),
    commitmentName: editorSnapshot.commitmentName.trim(),
    amount: (editorSnapshot.actualPurchasePrice || editorSnapshot.amount).trim(),
    dueDate: (editorSnapshot.actualPurchaseDate || editorSnapshot.expectedPurchaseDate || editorSnapshot.dueDate).trim(),
    procurementNeed: (editorSnapshot.procurementNeed || "").trim(),
    originalBudget: (editorSnapshot.originalBudget || "").trim(),
    targetPrice: (editorSnapshot.targetPrice || "").trim(),
    actualPurchasePrice: (editorSnapshot.actualPurchasePrice || "").trim(),
    supplier: (editorSnapshot.supplier || "").trim(),
    expectedPurchaseDate: (editorSnapshot.expectedPurchaseDate || "").trim(),
    actualPurchaseDate: (editorSnapshot.actualPurchaseDate || "").trim(),
    quoteCheckedDate: (editorSnapshot.quoteCheckedDate || "").trim(),
    quoteExpiryDate: (editorSnapshot.quoteExpiryDate || "").trim(),
    quoteReference: (editorSnapshot.quoteReference || "").trim(),
    quoteNotes: (editorSnapshot.quoteNotes || "").trim(),
    purchaseEvidenceReference: (editorSnapshot.purchaseEvidenceReference || "").trim(),
    invoiceOrderReference: (editorSnapshot.invoiceOrderReference || "").trim(),
    evidenceNotes: (editorSnapshot.evidenceNotes || "").trim(),
    actualSupplier: (editorSnapshot.actualSupplier || "").trim(),
    pendingValidationReason: (editorSnapshot.pendingValidationReason || "").trim(),
    approvalStatus: getEffectiveProcurementApprovalStatus(editorSnapshot),
    approvedRejectedBy: (editorSnapshot.approvedRejectedBy || "").trim(),
    approvalDate: (editorSnapshot.approvalDate || "").trim(),
    approvalRationale: (editorSnapshot.approvalRationale || "").trim(),
    notes: editorSnapshot.notes.trim(),
    dateCreated: editorSnapshot.dateCreated || deps.nowIso(),
  };
}

const isPurchasedCommitment = (commitment: CommitmentRecord) =>
  commitment.status === "Paid" || Boolean(commitment.actualPurchaseDate) || parseFinanceAmountInput(commitment.actualPurchasePrice || "") !== null;

// Gates only a newly entered Committed or Purchased state on save.
export function validateCommitmentSave(
  previousCommitment: CommitmentRecord | undefined,
  nextCommitment: CommitmentRecord,
): ProcurementApprovalBlock | "missing-purchase-details" | null {
  const wasCommitted = previousCommitment ? getEffectiveCommitmentCertainty(previousCommitment) === "Committed" : false;
  const wasPurchased = previousCommitment ? isPurchasedCommitment(previousCommitment) : false;
  const willBeCommitted = getEffectiveCommitmentCertainty(nextCommitment) === "Committed";
  const willBePurchased = isPurchasedCommitment(nextCommitment);

  if ((!wasCommitted && willBeCommitted) || (!wasPurchased && willBePurchased)) {
    const approvalBlock = getProcurementApprovalBlock(nextCommitment);
    if (approvalBlock) return approvalBlock;
  }
  if (!wasPurchased && willBePurchased && (parseFinanceAmountInput(nextCommitment.actualPurchasePrice || "") === null || !nextCommitment.actualPurchaseDate)) {
    return "missing-purchase-details";
  }
  return null;
}

export type CommitmentTransitionResult<Block extends string> =
  | { ok: true; commitment: CommitmentRecord }
  | { ok: false; block: Block };

export function markCommitmentCommitted(commitment: CommitmentRecord, today: string): CommitmentTransitionResult<ProcurementApprovalBlock> {
  const approvalBlock = getProcurementApprovalBlock(commitment);
  if (approvalBlock) return { ok: false, block: approvalBlock };

  return {
    ok: true,
    commitment: {
      ...commitment,
      certainty: "Committed",
      status: commitment.status === "Cancelled" || commitment.status === "Paid" ? commitment.status : "Upcoming",
      amount: (commitment.actualPurchasePrice || commitment.targetPrice || commitment.amount || commitment.originalBudget || "").trim(),
      dueDate: (commitment.expectedPurchaseDate || commitment.dueDate || today).trim(),
    },
  };
}

export function markCommitmentPurchased(
  commitment: CommitmentRecord,
): CommitmentTransitionResult<ProcurementApprovalBlock | "missing-actual-purchase-price" | "missing-actual-purchase-date"> {
  const approvalBlock = getProcurementApprovalBlock(commitment);
  if (approvalBlock) return { ok: false, block: approvalBlock };

  const actualPurchasePrice = parseFinanceAmountInput(commitment.actualPurchasePrice || "");
  if (actualPurchasePrice === null) return { ok: false, block: "missing-actual-purchase-price" };
  if (!commitment.actualPurchaseDate) return { ok: false, block: "missing-actual-purchase-date" };

  const actualPurchaseDate = commitment.actualPurchaseDate;
  return {
    ok: true,
    commitment: {
      ...commitment,
      certainty: "Committed",
      status: "Paid",
      amount: String(actualPurchasePrice),
      dueDate: actualPurchaseDate,
      actualPurchaseDate,
    },
  };
}

export type QuoteRevalidationInput = {
  outcome: QuoteRevalidationOutcome;
  revalidatedBy: string;
  revalidationDate: string;
  confirmedPrice: string;
  quoteExpiryDate: string;
  quoteReference: string;
  notes: string;
};

export function applyQuoteRevalidation(commitment: CommitmentRecord, result: QuoteRevalidationInput): CommitmentRecord {
  const quoteIsAvailable = result.outcome !== "Quote no longer available";
  return {
    ...commitment,
    targetPrice: quoteIsAvailable ? result.confirmedPrice : commitment.targetPrice,
    quoteCheckedDate: result.revalidationDate,
    quoteExpiryDate: quoteIsAvailable ? result.quoteExpiryDate : "",
    quoteReference: result.quoteReference,
    quoteNotes: result.notes,
    quoteRevalidationOutcome: result.outcome,
    quoteRevalidatedBy: result.revalidatedBy,
    quoteRevalidationDate: result.revalidationDate,
    quotePreviousPrice: commitment.targetPrice || "",
    quoteConfirmedPrice: quoteIsAvailable ? result.confirmedPrice : "",
    quoteRevalidationNotes: result.notes,
    pendingValidationReason: quoteIsAvailable
      ? commitment.pendingValidationReason?.trim() === QUOTE_UNAVAILABLE_VALIDATION_REASON ? "" : commitment.pendingValidationReason
      : commitment.pendingValidationReason?.trim() || QUOTE_UNAVAILABLE_VALIDATION_REASON,
  };
}

export type CapitalDecisionInput = {
  outcome: CapitalDecisionOutcome;
  rationale: string;
  decisionMaker: string;
  decisionDate: string;
  deferredUntil: string;
  pendingValidationReason: string;
};

export function applyCapitalDecision(commitment: CommitmentRecord, decision: CapitalDecisionInput): CommitmentRecord {
  return {
    ...commitment,
    approvalStatus: decision.outcome === "Approve" ? "Approved" : decision.outcome === "Reject" ? "Rejected" : getEffectiveProcurementApprovalStatus(commitment),
    approvedRejectedBy: decision.decisionMaker,
    approvalDate: decision.decisionDate,
    approvalRationale: decision.rationale,
    capitalDecisionOutcome: decision.outcome,
    capitalDecisionDeferredUntil: decision.outcome === "Defer" ? decision.deferredUntil : "",
    pendingValidationReason: decision.outcome === "Mark Pending validation" ? decision.pendingValidationReason : commitment.pendingValidationReason,
  };
}

export const incomeStatusOptions = ["Expected", "Received"] as const;
export type IncomeStatus = (typeof incomeStatusOptions)[number];
export const incomeCollectionStatusOptions = ["Open", "Disputed", "Blocked"] as const;
export type IncomeCollectionStatus = (typeof incomeCollectionStatusOptions)[number];

export type IncomeRecord = {
  id: string;
  date: string;
  description: string;
  customerSource: string;
  amount: string;
  area: string;
  status: IncomeStatus;
  notes: string;
  dateCreated: string;
  relatedLeadId?: string;
  earnedDate?: string;
  earnedEvidence?: string;
  invoiceIssuedDate?: string;
  invoiceReference?: string;
  invoiceEvidence?: string;
  receiptReference?: string;
  receiptEvidence?: string;
  billingOwnerPersonId?: string;
  billingActionId?: string;
  paymentDueDate?: string;
  collectionOwnerPersonId?: string;
  collectionActionId?: string;
  collectionStatus?: IncomeCollectionStatus;
  collectionStatusEvidence?: string;
};

export const expenseStatusOptions = ["Planned", "Paid"] as const;
export type ExpenseStatus = (typeof expenseStatusOptions)[number];

export type ExpenseRecord = {
  id: string;
  date: string;
  description: string;
  supplier: string;
  amount: string;
  category: string;
  area: string;
  status: ExpenseStatus;
  notes: string;
  dateCreated: string;
};

export const taxPaymentStatusOptions = ["Expected", "Received"] as const;
export type TaxPaymentStatus = (typeof taxPaymentStatusOptions)[number];

export type TaxPaymentRecord = {
  id: string;
  payPeriod: string;
  date: string;
  description: string;
  grossAmount: string;
  status: TaxPaymentStatus;
  reserveSetAside: boolean;
  setAsideDate: string;
  notes: string;
  dateCreated: string;
};

type FinanceRecordSanitizerDeps = {
  generateId: () => string;
  nowIso: () => string;
};

export function sanitizeIncomeRecord(
  record: IncomeRecord,
  deps: FinanceRecordSanitizerDeps,
): IncomeRecord {
  return {
    ...record,
    id: record.id || deps.generateId(),
    description: record.description.trim(),
    customerSource: record.customerSource.trim(),
    amount: record.amount.trim(),
    status: incomeStatusOptions.includes(record.status as IncomeStatus) ? record.status : "Expected",
    notes: record.notes.trim(),
    dateCreated: record.dateCreated || deps.nowIso(),
    ...(record.relatedLeadId !== undefined ? { relatedLeadId: record.relatedLeadId.trim() } : {}),
    ...(record.earnedDate !== undefined ? { earnedDate: record.earnedDate.trim() } : {}),
    ...(record.earnedEvidence !== undefined ? { earnedEvidence: record.earnedEvidence.trim() } : {}),
    ...(record.invoiceIssuedDate !== undefined ? { invoiceIssuedDate: record.invoiceIssuedDate.trim() } : {}),
    ...(record.invoiceReference !== undefined ? { invoiceReference: record.invoiceReference.trim() } : {}),
    ...(record.invoiceEvidence !== undefined ? { invoiceEvidence: record.invoiceEvidence.trim() } : {}),
    ...(record.receiptReference !== undefined ? { receiptReference: record.receiptReference.trim() } : {}),
    ...(record.receiptEvidence !== undefined ? { receiptEvidence: record.receiptEvidence.trim() } : {}),
    ...(record.billingOwnerPersonId !== undefined ? { billingOwnerPersonId: record.billingOwnerPersonId.trim() } : {}),
    ...(record.billingActionId !== undefined ? { billingActionId: record.billingActionId.trim() } : {}),
    ...(record.paymentDueDate !== undefined ? { paymentDueDate: record.paymentDueDate.trim() } : {}),
    ...(record.collectionOwnerPersonId !== undefined ? { collectionOwnerPersonId: record.collectionOwnerPersonId.trim() } : {}),
    ...(record.collectionActionId !== undefined ? { collectionActionId: record.collectionActionId.trim() } : {}),
    ...(record.collectionStatusEvidence !== undefined ? { collectionStatusEvidence: record.collectionStatusEvidence.trim() } : {}),
  };
}

export function sanitizeExpenseRecord(
  record: ExpenseRecord,
  deps: FinanceRecordSanitizerDeps,
): ExpenseRecord {
  return {
    ...record,
    id: record.id || deps.generateId(),
    description: record.description.trim(),
    supplier: record.supplier.trim(),
    amount: record.amount.trim(),
    status: expenseStatusOptions.includes(record.status as ExpenseStatus) ? record.status : "Planned",
    notes: record.notes.trim(),
    dateCreated: record.dateCreated || deps.nowIso(),
  };
}

export function sanitizeTaxPaymentRecord(
  record: TaxPaymentRecord,
  deps: FinanceRecordSanitizerDeps,
): TaxPaymentRecord {
  return {
    ...record,
    id: record.id || deps.generateId(),
    description: record.description.trim(),
    payPeriod: record.payPeriod.trim(),
    grossAmount: record.grossAmount.trim(),
    status: taxPaymentStatusOptions.includes(record.status as TaxPaymentStatus) ? record.status : "Expected",
    notes: record.notes.trim(),
    dateCreated: record.dateCreated || deps.nowIso(),
  };
}

export type CashPositionRecord = {
  currentCash: string;
  reservedTax: string;
  safetyBuffer: string;
  lastUpdated: string;
};

// Editor validation parser: zero is valid; empty or negative values are invalid.
export function parseCashPositionAmount(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalised = value.replace(/[£$,\s]/g, "");

  if (normalised === "") {
    return null;
  }

  if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalised)) {
    return null;
  }

  const parsed = Number(normalised);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function markTaxReserveSetAside(
  payment: TaxPaymentRecord,
  today: string,
): TaxPaymentRecord {
  return {
    ...payment,
    reserveSetAside: true,
    setAsideDate: payment.setAsideDate || today,
  };
}
