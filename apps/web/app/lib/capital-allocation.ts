import type { OpportunityRecord } from "./capture-conversions";
import type { LeadRecord } from "./crm";
import {
  getEffectiveCommitmentCertainty,
  getEffectiveProcurementApprovalStatus,
  hasPendingProcurementValidation,
  type CommitmentCertainty,
  type CommitmentRecord,
  type ProcurementApprovalStatus,
  type ProcurementQuoteState,
} from "./finance";

export type ProcurementReadinessState = "Researching" | "Price found" | "Ready to buy" | "Pending validation" | "Wait" | "Blocked" | "Purchased";
export type CashSnapshotFreshness = {
  label: "Missing / invalid date" | "Current" | "Aging" | "Stale";
  tone: "warn" | "clear" | "neutral";
};
export type CapitalOpportunityInput = {
  opportunity: Pick<OpportunityRecord, "id" | "status" | "opportunityTitle" | "title" | "strategicFit" | "relatedPillar" | "relatedArea" | "requiredCapital" | "requiredTime">;
  upside: number;
  parsedCapital: number | null;
};
export type CapitalCommitmentInput = {
  commitment: CommitmentRecord;
  amount: number | null;
  originalBudget: number | null;
  targetPrice: number | null;
  actualPurchasePrice: number | null;
  dueDateValid: boolean;
  quoteState: ProcurementQuoteState | null;
};
export type CapitalWonLeadInput = {
  lead: Pick<LeadRecord, "status" | "relatedPillar" | "archived">;
  finalValue: number | null;
  quoteValue: number | null;
};
export type CapitalAllocationInput = {
  opportunities: readonly CapitalOpportunityInput[];
  commitments: readonly CapitalCommitmentInput[];
  leads: readonly CapitalWonLeadInput[];
  currentCashAmount: number | null;
  cashAmountsValid: boolean;
  reservedTaxAmount: number;
  safetyBufferAmount: number;
  cashSnapshotFreshness: CashSnapshotFreshness;
  cashSnapshotAgeDays: number | null;
  nowMs: number;
};
export type CapitalOpportunity = {
  id: string;
  title: string;
  status: OpportunityRecord["status"];
  strategicFit: OpportunityRecord["strategicFit"];
  fitRank: number;
  area: string;
  upside: number | null;
  capital: number | null;
  capitalState: "missing" | "qualitative" | "zero" | "stated";
  capitalLabel: string;
  requiredTime: string;
  efficiency: number | null;
};
export type CapitalCommitment = {
  commitment: CommitmentRecord;
  amount: number | null;
  isFinal: boolean;
  isValidActive: boolean;
  needsAttention: boolean;
  missingOrInvalidDueDate: boolean;
  effectiveCertainty: CommitmentCertainty;
  pendingValidation: boolean;
  approvalStatus: ProcurementApprovalStatus;
  isRejected: boolean;
};
export type ProcurementItem = {
  commitment: CommitmentRecord;
  amount: number | null;
  originalBudget: number | null;
  targetPrice: number | null;
  actualPurchasePrice: number | null;
  amountRequired: number;
  effectivePrice: number;
  savedAgainstBudget: number;
  potentialSaving: number;
  projectedDeployableCashAfterPurchase: number | null;
  readinessState: ProcurementReadinessState;
  readinessReason: string;
  isPurchased: boolean;
  isCommitted: boolean;
  effectiveCertainty: CommitmentCertainty;
  approvalStatus: ProcurementApprovalStatus;
  isRejected: boolean;
  quoteState: ProcurementQuoteState | null;
};
export type WonValueByArea = {
  area: string;
  wonLeadCount: number;
  knownFinalValueCount: number;
  missingFinalValueCount: number;
  knownFinalWonValue: number;
  quotedValueCount: number;
  knownQuotedValue: number;
};
export type CapitalAllocationResult = {
  liveOpportunities: CapitalOpportunity[];
  currentCash: number | null;
  protectedCash: number | null;
  validActiveCommitments: CapitalCommitment[];
  commitmentsNeedingAttention: CapitalCommitment[];
  commitmentsMissingDueDate: CapitalCommitment[];
  committedCash: number;
  plannedOrQuotedExposure: number;
  validActivePlannedOrQuotedCommitments: CapitalCommitment[];
  procurementItems: ProcurementItem[];
  procurementQueue: ProcurementItem[];
  procurementCommittedCash: number;
  procurementPlannedExposure: number;
  procurementActualSpend: number;
  procurementOriginalBudgetTotal: number;
  procurementTargetPriceTotal: number;
  procurementExpectedSavings: number;
  procurementSavedAgainstBudget: number;
  procurementPotentialSaving: number;
  procurementSavingsPct: number | null;
  grossDeployableCash: number | null;
  uncommittedDeployableCash: number | null;
  cashConfigured: boolean;
  cashSnapshotFreshness: CashSnapshotFreshness;
  cashSnapshotAgeDays: number | null;
  highFitKnownCapitalRequired: number | null;
  highFitOpportunityCount: number;
  highFitMissingCapitalCount: number;
  highFitQualitativeCapitalCount: number;
  highFitZeroCapitalCount: number;
  wonCommercialEvidence: {
    byArea: WonValueByArea[];
    totalWonLeads: number;
    totalKnownFinalValues: number;
    totalMissingFinalValues: number;
    totalKnownFinalWonValue: number;
    archivedWonLeadCount: number;
  };
};

export function buildCapitalAllocation(input: CapitalAllocationInput): CapitalAllocationResult {
  const liveStatuses = ["New", "Evaluating", "On Hold", "Approved"];
  const liveOpportunities = input.opportunities
    .filter(({ opportunity }) => liveStatuses.includes(opportunity.status))
    .map(({ opportunity, upside, parsedCapital }): CapitalOpportunity => {
      const rawCapital = opportunity.requiredCapital.trim();
      const capitalState = !rawCapital ? "missing" : parsedCapital === null ? "qualitative" : parsedCapital < 0 ? "missing" : parsedCapital === 0 ? "zero" : "stated";
      const capital = capitalState === "stated" ? parsedCapital : null;
      const hasUpside = upside > 0;
      const efficiency = hasUpside && capital !== null ? upside / capital : null;
      const fitRank = opportunity.strategicFit === "Exceptional" ? 4 : opportunity.strategicFit === "High" ? 3 : opportunity.strategicFit === "Medium" ? 2 : 1;
      return {
        id: opportunity.id,
        title: opportunity.opportunityTitle || opportunity.title,
        status: opportunity.status,
        strategicFit: opportunity.strategicFit,
        fitRank,
        area: opportunity.relatedPillar || opportunity.relatedArea || "Unassigned",
        upside: hasUpside ? upside : null,
        capital,
        capitalState,
        capitalLabel: rawCapital,
        requiredTime: opportunity.requiredTime?.trim() || "",
        efficiency,
      };
    })
    .sort((left, right) => right.fitRank - left.fitRank || (right.efficiency ?? -1) - (left.efficiency ?? -1) || (right.upside ?? 0) - (left.upside ?? 0));

  const currentCash = input.currentCashAmount !== null && input.currentCashAmount >= 0 ? input.currentCashAmount : null;
  const cashConfigured = input.cashAmountsValid;
  const protectedCash = cashConfigured ? input.reservedTaxAmount + input.safetyBufferAmount : null;
  const activeCommitmentStatuses = new Set(["upcoming", "due", "overdue"]);
  const finalCommitmentStatuses = new Set(["paid", "cancelled", "canceled", "completed"]);
  const commitmentReadModel = input.commitments.map(({ commitment, amount, dueDateValid }): CapitalCommitment => {
    const status = commitment.status.trim().toLowerCase();
    const hasSupportedActiveStatus = activeCommitmentStatuses.has(status);
    const isFinal = finalCommitmentStatuses.has(status);
    const hasValidPositiveAmount = amount !== null && amount > 0;
    const effectiveCertainty = getEffectiveCommitmentCertainty(commitment);
    const pendingValidation = hasPendingProcurementValidation(commitment);
    const approvalStatus = getEffectiveProcurementApprovalStatus(commitment);
    const isRejected = approvalStatus === "Rejected";
    const needsAttention = !isRejected && !isFinal && (!hasSupportedActiveStatus || !hasValidPositiveAmount);
    return { commitment, amount, isFinal, isValidActive: hasSupportedActiveStatus && hasValidPositiveAmount && !isRejected, needsAttention,
      missingOrInvalidDueDate: hasSupportedActiveStatus && !dueDateValid, effectiveCertainty, pendingValidation, approvalStatus, isRejected };
  });
  const validActiveCommitments = commitmentReadModel.filter((item) => item.isValidActive);
  const commitmentsNeedingAttention = commitmentReadModel.filter((item) => item.needsAttention);
  const commitmentsMissingDueDate = commitmentReadModel.filter((item) => item.isValidActive && item.missingOrInvalidDueDate);
  const validActiveCommittedCommitments = validActiveCommitments.filter((item) => item.effectiveCertainty === "Committed" && !item.pendingValidation && !item.isRejected);
  const validActivePlannedOrQuotedCommitments = validActiveCommitments.filter((item) => item.effectiveCertainty !== "Committed" || item.pendingValidation);
  const committedCash = validActiveCommittedCommitments.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  const plannedOrQuotedExposure = validActivePlannedOrQuotedCommitments.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  const grossDeployableCash = cashConfigured && currentCash !== null && protectedCash !== null ? currentCash - protectedCash : null;
  const uncommittedDeployableCash = grossDeployableCash === null ? null : grossDeployableCash - committedCash;
  const startOfTodayMs = new Date(input.nowMs).setHours(0, 0, 0, 0);
  const procurementItems = input.commitments
    .map((source, index) => ({ source, item: commitmentReadModel[index] }))
    .filter(({ item }) => item.commitment.type === "Supplier" || Boolean(item.commitment.procurementNeed?.trim()) || Boolean(item.commitment.originalBudget?.trim()) || Boolean(item.commitment.targetPrice?.trim()) || Boolean(item.commitment.actualPurchasePrice?.trim()) || Boolean(item.commitment.supplier?.trim()) || Boolean(item.commitment.quoteCheckedDate?.trim()) || Boolean(item.commitment.quoteExpiryDate?.trim()) || Boolean(item.commitment.quoteReference?.trim()) || Boolean(item.commitment.quoteNotes?.trim()) || Boolean(item.commitment.purchaseEvidenceReference?.trim()) || Boolean(item.commitment.invoiceOrderReference?.trim()) || Boolean(item.commitment.evidenceNotes?.trim()) || Boolean(item.commitment.actualSupplier?.trim()) || item.pendingValidation)
    .map(({ item, source }): ProcurementItem => {
      const { originalBudget, targetPrice, actualPurchasePrice, quoteState } = source;
      const amountRequired = targetPrice ?? item.amount ?? originalBudget ?? 0;
      const effectivePrice = actualPurchasePrice ?? item.amount ?? targetPrice ?? originalBudget ?? 0;
      const savedAgainstBudget = originalBudget !== null && actualPurchasePrice !== null ? Math.max(0, originalBudget - actualPurchasePrice) : 0;
      const potentialSaving = originalBudget !== null && targetPrice !== null ? Math.max(0, originalBudget - targetPrice) : 0;
      const expectedPurchaseDate = item.commitment.expectedPurchaseDate || item.commitment.dueDate;
      const expectedPurchaseTime = expectedPurchaseDate ? new Date(`${expectedPurchaseDate.slice(0, 10)}T00:00:00`).getTime() : 0;
      const isFuturePurchase = expectedPurchaseTime > startOfTodayMs;
      const isPurchased = item.commitment.status === "Paid" || Boolean(item.commitment.actualPurchaseDate) || actualPurchasePrice !== null;
      const isCommitted = item.isValidActive && item.effectiveCertainty === "Committed" && !item.pendingValidation;
      const projectedDeployableCashAfterPurchase = uncommittedDeployableCash === null ? null
        : isPurchased || isCommitted || item.isRejected ? uncommittedDeployableCash : uncommittedDeployableCash - amountRequired;
      const hasSupplier = Boolean(item.commitment.supplier?.trim());
      const hasNeed = Boolean(item.commitment.procurementNeed?.trim());
      const hasTargetPrice = targetPrice !== null && targetPrice > 0;
      const hasRequiredInfo = hasSupplier && hasNeed && hasTargetPrice;
      const cashAvailable = projectedDeployableCashAfterPurchase !== null && projectedDeployableCashAfterPurchase >= 0;
      let readinessState: ProcurementReadinessState = "Researching";
      let readinessReason = "Supplier, need or target price is still incomplete.";
      if (isPurchased) {
        readinessState = "Purchased";
        readinessReason = "Actual purchase details have been recorded.";
      } else if (item.pendingValidation) {
        readinessState = "Pending validation";
        readinessReason = item.commitment.pendingValidationReason?.trim() || "External validation is still required.";
      } else if (quoteState === "Expired") {
        readinessState = "Pending validation";
        readinessReason = `Quoted pricing expired on ${item.commitment.quoteExpiryDate}; revalidate or replace the price before committing or purchasing.`;
      } else if (!hasRequiredInfo) {
        readinessState = "Researching";
        readinessReason = [hasNeed ? null : "need", hasSupplier ? null : "supplier", hasTargetPrice ? null : "target price"].filter(Boolean).join(", ") + " missing.";
      } else if (uncommittedDeployableCash === null) {
        readinessState = "Blocked";
        readinessReason = "Cash snapshot is incomplete, so deployable cash cannot be verified.";
      } else if (!cashAvailable) {
        readinessState = "Blocked";
        readinessReason = "Buying now would consume protected cash or leave deployable cash negative.";
      } else if (isFuturePurchase) {
        readinessState = "Wait";
        readinessReason = `Expected purchase date is ${expectedPurchaseDate}.`;
      } else if (item.effectiveCertainty === "Quoted") {
        readinessState = "Price found";
        readinessReason = "Supplier and target price are known; founder commitment has not been made.";
      } else {
        readinessState = "Ready to buy";
        readinessReason = isCommitted ? "Committed funding is already reserved and deployable cash remains non-negative."
          : "Supplier, target price and timing are ready, and deployable cash remains non-negative after purchase.";
      }
      return { commitment: item.commitment, amount: item.amount, originalBudget, targetPrice, actualPurchasePrice, amountRequired, effectivePrice,
        savedAgainstBudget, potentialSaving, projectedDeployableCashAfterPurchase, readinessState, readinessReason, isPurchased, isCommitted,
        effectiveCertainty: item.effectiveCertainty, approvalStatus: item.approvalStatus, isRejected: item.isRejected, quoteState };
    });
  const procurementReadinessRank: Record<ProcurementReadinessState, number> = { "Ready to buy": 1, Blocked: 2, "Pending validation": 3, "Price found": 4, Wait: 5, Researching: 6, Purchased: 7 };
  const procurementQueue = [...procurementItems].sort((left, right) => Number(left.isRejected) - Number(right.isRejected)
    || procurementReadinessRank[left.readinessState] - procurementReadinessRank[right.readinessState]
    || (left.commitment.expectedPurchaseDate || left.commitment.dueDate || left.commitment.dateCreated).localeCompare(right.commitment.expectedPurchaseDate || right.commitment.dueDate || right.commitment.dateCreated)
    || left.commitment.commitmentName.localeCompare(right.commitment.commitmentName));
  const procurementCommittedCash = procurementItems.filter((item) => item.isCommitted).reduce((sum, item) => sum + (item.amount ?? item.effectivePrice), 0);
  const procurementPlannedExposure = procurementItems.filter((item) => !item.isCommitted && !item.isPurchased && !item.isRejected).reduce((sum, item) => sum + item.amountRequired, 0);
  const procurementActualSpend = procurementItems.filter((item) => item.isPurchased).reduce((sum, item) => sum + item.effectivePrice, 0);
  const procurementOriginalBudgetTotal = procurementItems.reduce((sum, item) => sum + (item.originalBudget ?? 0), 0);
  const procurementTargetPriceTotal = procurementItems.reduce((sum, item) => sum + (item.targetPrice ?? 0), 0);
  const procurementExpectedSavings = procurementItems.reduce((sum, item) => sum + item.potentialSaving, 0);
  const procurementSavedAgainstBudget = procurementItems.reduce((sum, item) => sum + item.savedAgainstBudget, 0);
  const procurementPotentialSaving = procurementExpectedSavings;
  const procurementSavingsPct = procurementOriginalBudgetTotal > 0 ? Math.round((procurementExpectedSavings / procurementOriginalBudgetTotal) * 100) : null;
  const highFitWithCapital = liveOpportunities.filter((opportunity) => opportunity.fitRank >= 3 && opportunity.capital !== null);
  const highFitOpportunities = liveOpportunities.filter((opportunity) => opportunity.fitRank >= 3);
  const highFitOpportunityCount = highFitOpportunities.length;
  const highFitMissingCapitalCount = highFitOpportunities.filter((opportunity) => opportunity.capitalState === "missing").length;
  const highFitQualitativeCapitalCount = highFitOpportunities.filter((opportunity) => opportunity.capitalState === "qualitative").length;
  const highFitZeroCapitalCount = highFitOpportunities.filter((opportunity) => opportunity.capitalState === "zero").length;
  const highFitKnownCapitalRequired = highFitOpportunityCount === 0 || highFitMissingCapitalCount > 0 || highFitQualitativeCapitalCount > 0
    ? null : highFitWithCapital.reduce((sum, opportunity) => sum + (opportunity.capital ?? 0), 0);
  const wonLeads = input.leads.filter(({ lead }) => lead.status === "Won");
  const wonValueByAreaMap = new Map<string, WonValueByArea>();
  wonLeads.forEach(({ lead, finalValue, quoteValue }) => {
    const area = lead.relatedPillar.trim() || "Unassigned";
    const current = wonValueByAreaMap.get(area) || { area, wonLeadCount: 0, knownFinalValueCount: 0, missingFinalValueCount: 0, knownFinalWonValue: 0, quotedValueCount: 0, knownQuotedValue: 0 };
    current.wonLeadCount += 1;
    if (finalValue !== null && finalValue > 0) {
      current.knownFinalValueCount += 1;
      current.knownFinalWonValue += finalValue;
    } else {
      current.missingFinalValueCount += 1;
    }
    if (quoteValue !== null && quoteValue > 0) {
      current.quotedValueCount += 1;
      current.knownQuotedValue += quoteValue;
    }
    wonValueByAreaMap.set(area, current);
  });
  const wonValueByArea = [...wonValueByAreaMap.values()].sort((left, right) => right.knownFinalWonValue - left.knownFinalWonValue || left.area.localeCompare(right.area));
  const wonCommercialEvidence = {
    byArea: wonValueByArea,
    totalWonLeads: wonLeads.length,
    totalKnownFinalValues: wonValueByArea.reduce((sum, area) => sum + area.knownFinalValueCount, 0),
    totalMissingFinalValues: wonValueByArea.reduce((sum, area) => sum + area.missingFinalValueCount, 0),
    totalKnownFinalWonValue: wonValueByArea.reduce((sum, area) => sum + area.knownFinalWonValue, 0),
    archivedWonLeadCount: wonLeads.filter(({ lead }) => lead.archived).length,
  };
  return {
    liveOpportunities, currentCash, protectedCash, validActiveCommitments, commitmentsNeedingAttention, commitmentsMissingDueDate, committedCash,
    plannedOrQuotedExposure, validActivePlannedOrQuotedCommitments, procurementItems, procurementQueue, procurementCommittedCash, procurementPlannedExposure,
    procurementActualSpend, procurementOriginalBudgetTotal, procurementTargetPriceTotal, procurementExpectedSavings, procurementSavedAgainstBudget,
    procurementPotentialSaving, procurementSavingsPct, grossDeployableCash, uncommittedDeployableCash, cashConfigured,
    cashSnapshotFreshness: { ...input.cashSnapshotFreshness }, cashSnapshotAgeDays: input.cashSnapshotAgeDays,
    highFitKnownCapitalRequired, highFitOpportunityCount, highFitMissingCapitalCount, highFitQualitativeCapitalCount, highFitZeroCapitalCount, wonCommercialEvidence,
  };
}