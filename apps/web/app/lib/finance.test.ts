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
