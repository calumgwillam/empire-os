import { describe, expect, it } from "vitest";
import {
  QUOTE_UNAVAILABLE_VALIDATION_REASON,
  applyCapitalDecision,
  applyQuoteRevalidation,
  markCommitmentCommitted,
  markCommitmentPurchased,
  sanitizeCommitmentFromEditor,
  validateCommitmentSave,
  type CommitmentRecord,
} from "./finance";

function commitment(overrides: Partial<CommitmentRecord> = {}): CommitmentRecord {
  return {
    id: "commitment-1",
    commitmentName: "Test commitment",
    amount: "100",
    dueDate: "2026-10-10",
    type: "Equipment",
    status: "Upcoming",
    relatedPillar: "Garden Maintenance",
    notes: "",
    dateCreated: "2026-09-30T12:00:00.000Z",
    ...overrides,
  };
}

describe("sanitizeCommitmentFromEditor", () => {
  it("preserves current trimming and deterministic default behaviour", () => {
    const result = sanitizeCommitmentFromEditor(
      commitment({
        id: "",
        commitmentName: "  Mower  ",
        amount: " 100 ",
        dueDate: " 2026-10-10 ",
        procurementNeed: "  Needed for work  ",
        targetPrice: " 950 ",
        supplier: "  Supplier Ltd  ",
        notes: "  note  ",
        dateCreated: "",
      }),
      {
        generateId: () => "generated-id",
        nowIso: () => "2026-09-30T18:00:00.000Z",
      },
    );

    expect(result.id).toBe("generated-id");
    expect(result.commitmentName).toBe("Mower");
    expect(result.amount).toBe("100");
    expect(result.dueDate).toBe("2026-10-10");
    expect(result.procurementNeed).toBe("Needed for work");
    expect(result.targetPrice).toBe("950");
    expect(result.supplier).toBe("Supplier Ltd");
    expect(result.notes).toBe("note");
    expect(result.dateCreated).toBe("2026-09-30T18:00:00.000Z");
  });
});

describe("commitment save validation", () => {
  it("blocks a newly committed purchase without approval", () => {
    const previous = commitment({ certainty: "Planned" });
    const next = commitment({ certainty: "Committed" });

    expect(validateCommitmentSave(previous, next)).toBe("approval-required");
  });

  it("blocks a newly committed purchase with an expired quote", () => {
    const previous = commitment({ certainty: "Planned" });
    const next = commitment({
      certainty: "Committed",
      approvalStatus: "Approved",
      targetPrice: "100",
      quoteExpiryDate: "2000-01-01",
    });

    expect(validateCommitmentSave(previous, next)).toBe("quote-expired");
  });

  it("blocks a newly committed purchase with pending validation", () => {
    const previous = commitment({ certainty: "Planned" });
    const next = commitment({
      certainty: "Committed",
      approvalStatus: "Approved",
      pendingValidationReason: "Supplier confirmation required",
    });

    expect(validateCommitmentSave(previous, next)).toBe("pending-validation");
  });
});

describe("markCommitmentCommitted", () => {
  it("transitions an approved commitment to Committed", () => {
    const result = markCommitmentCommitted(
      commitment({ certainty: "Planned", approvalStatus: "Approved" }),
      "2026-10-01",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.commitment.certainty).toBe("Committed");
    expect(result.commitment.status).toBe("Upcoming");
  });

  it("preserves Cancelled status", () => {
    const result = markCommitmentCommitted(
      commitment({ status: "Cancelled", approvalStatus: "Approved" }),
      "2026-10-01",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.commitment.status).toBe("Cancelled");
  });

  it("preserves Paid status", () => {
    const result = markCommitmentCommitted(
      commitment({ status: "Paid", approvalStatus: "Approved" }),
      "2026-10-01",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.commitment.status).toBe("Paid");
  });

  it("uses amount fallback priority actualPurchasePrice then targetPrice then amount then originalBudget", () => {
    const result = markCommitmentCommitted(
      commitment({
        approvalStatus: "Approved",
        actualPurchasePrice: " 800 ",
        targetPrice: "900",
        amount: "1000",
        originalBudget: "1100",
      }),
      "2026-10-01",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.commitment.amount).toBe("800");
  });

  it("uses expectedPurchaseDate then dueDate then supplied today for due date", () => {
    const expected = markCommitmentCommitted(
      commitment({
        approvalStatus: "Approved",
        expectedPurchaseDate: "2026-10-15",
        dueDate: "2026-10-20",
      }),
      "2026-10-25",
    );

    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(expected.commitment.dueDate).toBe("2026-10-15");

    const today = markCommitmentCommitted(
      commitment({
        approvalStatus: "Approved",
        expectedPurchaseDate: "",
        dueDate: "",
      }),
      "2026-10-25",
    );

    expect(today.ok).toBe(true);
    if (!today.ok) return;
    expect(today.commitment.dueDate).toBe("2026-10-25");
  });
});

describe("markCommitmentPurchased", () => {
  it("blocks purchase without an actual purchase price", () => {
    const result = markCommitmentPurchased(
      commitment({
        approvalStatus: "Approved",
        actualPurchasePrice: "",
        actualPurchaseDate: "2026-10-01",
      }),
    );

    expect(result).toEqual({ ok: false, block: "missing-actual-purchase-price" });
  });

  it("blocks purchase without an actual purchase date", () => {
    const result = markCommitmentPurchased(
      commitment({
        approvalStatus: "Approved",
        actualPurchasePrice: "950",
        actualPurchaseDate: "",
      }),
    );

    expect(result).toEqual({ ok: false, block: "missing-actual-purchase-date" });
  });

  it("transitions a valid purchase to Paid", () => {
    const result = markCommitmentPurchased(
      commitment({
        approvalStatus: "Approved",
        actualPurchasePrice: "950",
        actualPurchaseDate: "2026-10-01",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.commitment.certainty).toBe("Committed");
    expect(result.commitment.status).toBe("Paid");
    expect(result.commitment.amount).toBe("950");
    expect(result.commitment.dueDate).toBe("2026-10-01");
  });
});

describe("applyQuoteRevalidation", () => {
  it("updates all quote fields when the quote remains available", () => {
    const result = applyQuoteRevalidation(
      commitment({
        targetPrice: "900",
        pendingValidationReason: QUOTE_UNAVAILABLE_VALIDATION_REASON,
      }),
      {
        outcome: "Price confirmed",
        revalidatedBy: "Calum",
        revalidationDate: "2026-10-01",
        confirmedPrice: "950",
        quoteExpiryDate: "2026-10-31",
        quoteReference: "Q-123",
        notes: "Confirmed",
      },
    );

    expect(result.targetPrice).toBe("950");
    expect(result.quoteCheckedDate).toBe("2026-10-01");
    expect(result.quoteExpiryDate).toBe("2026-10-31");
    expect(result.quoteReference).toBe("Q-123");
    expect(result.quoteNotes).toBe("Confirmed");
    expect(result.quotePreviousPrice).toBe("900");
    expect(result.quoteConfirmedPrice).toBe("950");
    expect(result.quoteRevalidatedBy).toBe("Calum");
    expect(result.pendingValidationReason).toBe("");
  });

  it("clears confirmed price and expiry when the quote is unavailable", () => {
    const result = applyQuoteRevalidation(
      commitment({ targetPrice: "900" }),
      {
        outcome: "Quote no longer available",
        revalidatedBy: "Calum",
        revalidationDate: "2026-10-01",
        confirmedPrice: "950",
        quoteExpiryDate: "2026-10-31",
        quoteReference: "Q-123",
        notes: "Unavailable",
      },
    );

    expect(result.targetPrice).toBe("900");
    expect(result.quoteExpiryDate).toBe("");
    expect(result.quoteConfirmedPrice).toBe("");
    expect(result.pendingValidationReason).toBe(QUOTE_UNAVAILABLE_VALIDATION_REASON);
  });
});

describe("applyCapitalDecision", () => {
  it.each([
    ["Approve", "Approved", ""],
    ["Reject", "Rejected", ""],
    ["Defer", "Not reviewed", "2026-11-01"],
    ["Mark Pending validation", "Not reviewed", ""],
  ] as const)("applies %s correctly", (outcome, approvalStatus, deferredUntil) => {
    const result = applyCapitalDecision(
      commitment({ approvalStatus: "Not reviewed" }),
      {
        outcome,
        rationale: "Reason",
        decisionMaker: "Calum",
        decisionDate: "2026-10-01",
        deferredUntil: "2026-11-01",
        pendingValidationReason: "Need validation",
      },
    );

    expect(result.approvalStatus).toBe(approvalStatus);
    expect(result.capitalDecisionOutcome).toBe(outcome);
    expect(result.capitalDecisionDeferredUntil).toBe(deferredUntil);
    expect(result.approvedRejectedBy).toBe("Calum");
    expect(result.approvalDate).toBe("2026-10-01");
    expect(result.approvalRationale).toBe("Reason");

    if (outcome === "Mark Pending validation") {
      expect(result.pendingValidationReason).toBe("Need validation");
    }
  });
});

describe("sanitizeIncomeRecord", () => {
  it("trims fields and applies deterministic defaults", async () => {
    const { sanitizeIncomeRecord } = await import("./finance");

    const result = sanitizeIncomeRecord(
      {
        id: "",
        date: "2026-10-01",
        description: "  Garden job  ",
        customerSource: "  Referral  ",
        amount: " 250 ",
        area: "Garden Maintenance",
        status: "Received",
        notes: "  paid  ",
        dateCreated: "",
      },
      {
        generateId: () => "income-1",
        nowIso: () => "2026-10-01T12:00:00.000Z",
      },
    );

    expect(result.id).toBe("income-1");
    expect(result.description).toBe("Garden job");
    expect(result.customerSource).toBe("Referral");
    expect(result.amount).toBe("250");
    expect(result.status).toBe("Received");
    expect(result.notes).toBe("paid");
    expect(result.dateCreated).toBe("2026-10-01T12:00:00.000Z");
  });
});

describe("sanitizeExpenseRecord", () => {
  it("trims fields and applies deterministic defaults", async () => {
    const { sanitizeExpenseRecord } = await import("./finance");

    const result = sanitizeExpenseRecord(
      {
        id: "",
        date: "2026-10-01",
        description: "  Fuel  ",
        supplier: "  Shell  ",
        amount: " 80 ",
        category: "Fuel",
        area: "Garden Maintenance",
        status: "Paid",
        notes: "  van fuel  ",
        dateCreated: "",
      },
      {
        generateId: () => "expense-1",
        nowIso: () => "2026-10-01T12:00:00.000Z",
      },
    );

    expect(result.id).toBe("expense-1");
    expect(result.description).toBe("Fuel");
    expect(result.supplier).toBe("Shell");
    expect(result.amount).toBe("80");
    expect(result.status).toBe("Paid");
    expect(result.notes).toBe("van fuel");
    expect(result.dateCreated).toBe("2026-10-01T12:00:00.000Z");
  });
});

describe("sanitizeTaxPaymentRecord", () => {
  it("trims fields and applies deterministic defaults", async () => {
    const { sanitizeTaxPaymentRecord } = await import("./finance");

    const result = sanitizeTaxPaymentRecord(
      {
        id: "",
        payPeriod: " 2026-09 ",
        date: "2026-09-30",
        description: "  September self-employed pay  ",
        grossAmount: " 1605 ",
        status: "Received",
        reserveSetAside: false,
        setAsideDate: "",
        notes: "  received  ",
        dateCreated: "",
      },
      {
        generateId: () => "tax-payment-1",
        nowIso: () => "2026-10-01T12:00:00.000Z",
      },
    );

    expect(result.id).toBe("tax-payment-1");
    expect(result.payPeriod).toBe("2026-09");
    expect(result.description).toBe("September self-employed pay");
    expect(result.grossAmount).toBe("1605");
    expect(result.status).toBe("Received");
    expect(result.notes).toBe("received");
    expect(result.dateCreated).toBe("2026-10-01T12:00:00.000Z");
  });
});

describe("parseCashPositionAmount", () => {
  it("accepts valid non-negative money values", async () => {
    const { parseCashPositionAmount } = await import("./finance");

    expect(parseCashPositionAmount("0")).toBe(0);
    expect(parseCashPositionAmount("£1,250.50")).toBe(1250.5);
    expect(parseCashPositionAmount("+75")).toBe(75);
    expect(parseCashPositionAmount(42)).toBe(42);
  });

  it("rejects empty, negative and malformed values", async () => {
    const { parseCashPositionAmount } = await import("./finance");

    expect(parseCashPositionAmount("")).toBeNull();
    expect(parseCashPositionAmount("   ")).toBeNull();
    expect(parseCashPositionAmount("-1")).toBeNull();
    expect(parseCashPositionAmount("12abc")).toBeNull();
    expect(parseCashPositionAmount(Number.NaN)).toBeNull();
  });
});

describe("markTaxReserveSetAside", () => {
  it("marks the reserve as set aside and adds today's date when missing", async () => {
    const { markTaxReserveSetAside } = await import("./finance");

    const result = markTaxReserveSetAside(
      {
        id: "tax-1",
        payPeriod: "2026-09",
        date: "2026-09-30",
        description: "September pay",
        grossAmount: "1605",
        status: "Received",
        reserveSetAside: false,
        setAsideDate: "",
        notes: "",
        dateCreated: "2026-09-30T12:00:00.000Z",
      },
      "2026-10-01",
    );

    expect(result.reserveSetAside).toBe(true);
    expect(result.setAsideDate).toBe("2026-10-01");
  });

  it("preserves an existing set-aside date", async () => {
    const { markTaxReserveSetAside } = await import("./finance");

    const result = markTaxReserveSetAside(
      {
        id: "tax-1",
        payPeriod: "2026-09",
        date: "2026-09-30",
        description: "September pay",
        grossAmount: "1605",
        status: "Received",
        reserveSetAside: false,
        setAsideDate: "2026-09-30",
        notes: "",
        dateCreated: "2026-09-30T12:00:00.000Z",
      },
      "2026-10-01",
    );

    expect(result.reserveSetAside).toBe(true);
    expect(result.setAsideDate).toBe("2026-09-30");
  });
});
