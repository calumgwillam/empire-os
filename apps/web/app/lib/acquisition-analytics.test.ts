import { describe, expect, it } from "vitest";
import {
  buildAcquisitionAnalytics,
  getAcquisitionEvidenceLabel,
  getWonLeadValue,
  isLeadQuoted,
  isLeadWon,
} from "./acquisition-analytics";
import type { LeadRecord } from "./crm";

function makeLead(overrides: Partial<LeadRecord> = {}): LeadRecord {
  return {
    id: "lead-1",
    leadName: "Example lead",
    contactName: "",
    phone: "",
    email: "",
    location: "",
    serviceRequested: "",
    sourceChannel: "Referral",
    sourceDetail: "",
    dateReceived: "2026-09-30",
    status: "New",
    quoteValue: "",
    quoteSentDate: "",
    followUpDate: "",
    outcome: "",
    finalJobValue: "",
    notes: "",
    owner: "",
    relatedPillar: "Garden Maintenance",
    dateCreated: "2026-09-30T12:00:00.000Z",
    ...overrides,
  };
}

const parseAmount = (value: string) => {
  const parsed = parseFloat(value.replace(/[^0-9.\-]/g, ""));
  return Number.isNaN(parsed) ? 0 : parsed;
};

describe("getWonLeadValue", () => {
  it("prefers final job value and falls back to quote value", () => {
    expect(
      getWonLeadValue(
        makeLead({ finalJobValue: "£450", quoteValue: "£500" }),
        parseAmount,
      ),
    ).toBe(450);

    expect(
      getWonLeadValue(
        makeLead({ finalJobValue: "", quoteValue: "£500" }),
        parseAmount,
      ),
    ).toBe(500);
  });
});

describe("lead acquisition helpers", () => {
  it("detects quoted and won leads", () => {
    expect(isLeadQuoted(makeLead({ status: "Quote Sent" }))).toBe(true);
    expect(isLeadQuoted(makeLead({ status: "Follow-Up" }))).toBe(true);
    expect(isLeadQuoted(makeLead({ quoteSentDate: "2026-09-30" }))).toBe(true);
    expect(isLeadQuoted(makeLead({ status: "New" }))).toBe(false);

    expect(isLeadWon(makeLead({ status: "Won" }))).toBe(true);
    expect(isLeadWon(makeLead({ status: "Lost" }))).toBe(false);
  });

  it("labels acquisition evidence by sample size only", () => {
    expect(getAcquisitionEvidenceLabel(0)).toBe("");
    expect(getAcquisitionEvidenceLabel(1)).toBe("Early signal");
    expect(getAcquisitionEvidenceLabel(3)).toBe("Emerging evidence");
    expect(getAcquisitionEvidenceLabel(6)).toBe("Stronger evidence");
  });
});

describe("buildAcquisitionAnalytics", () => {
  it("calculates headline metrics and channel performance", () => {
    const leads = [
      makeLead({
        id: "lead-1",
        sourceChannel: "Referral",
        sourceDetail: "Customer A",
        status: "Won",
        quoteValue: "£500",
        finalJobValue: "£450",
      }),
      makeLead({
        id: "lead-2",
        sourceChannel: "Referral",
        sourceDetail: "Customer A",
        status: "Quote Sent",
        quoteValue: "£300",
      }),
      makeLead({
        id: "lead-3",
        sourceChannel: "Website",
        sourceDetail: "Homepage form",
        status: "Lost",
      }),
    ];

    const result = buildAcquisitionAnalytics(leads, parseAmount);

    expect(result.metricsLeadsGenerated).toBe(3);
    expect(result.metricsJobsWon).toBe(1);
    expect(result.metricsQuotesSent).toBe(2);
    expect(result.metricsLeadToJobConversion).toBeCloseTo(100 / 3);
    expect(result.metricsRevenueFromWonLeads).toBe(450);
    expect(result.metricsAverageJobValue).toBe(450);

    const referral = result.acquisitionChannelPerformance.find(
      (entry) => entry.channel === "Referral",
    );

    expect(referral).toMatchObject({
      leadCount: 2,
      quotesSent: 2,
      jobsWon: 1,
      conversionRate: 50,
      revenue: 450,
      averageWonJobValue: 450,
      evidenceLabel: "Early signal",
    });
  });

  it("groups source-detail performance within each source channel", () => {
    const leads = [
      makeLead({
        id: "lead-1",
        sourceChannel: "Referral",
        sourceDetail: "Partner",
        status: "Won",
        finalJobValue: "200",
      }),
      makeLead({
        id: "lead-2",
        sourceChannel: "Referral",
        sourceDetail: "partner",
        status: "Lost",
      }),
      makeLead({
        id: "lead-3",
        sourceChannel: "Website",
        sourceDetail: "Partner",
        status: "Won",
        finalJobValue: "300",
      }),
    ];

    const result = buildAcquisitionAnalytics(leads, parseAmount);

    expect(result.acquisitionSourceDetailPerformance).toHaveLength(2);

    expect(result.acquisitionSourceDetailPerformance[0]).toMatchObject({
      sourceDetail: "Partner",
      sourceChannel: "Referral",
      leadCount: 2,
      jobsWon: 1,
      conversionRate: 50,
      revenue: 200,
    });

    expect(result.acquisitionSourceDetailPerformance[1]).toMatchObject({
      sourceDetail: "Partner",
      sourceChannel: "Website",
      leadCount: 1,
      jobsWon: 1,
      conversionRate: 100,
      revenue: 300,
    });
  });
});
