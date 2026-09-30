import { describe, expect, it } from "vitest";
import {
  classifyOutreachFollowUp,
  getOutreachBucket,
  isOutreachFollowUpExcluded,
  isReadyForInitialOutreach,
  type OutreachRecord,
} from "./crm";

function makeOutreach(overrides: Partial<OutreachRecord> = {}): OutreachRecord {
  return {
    id: "outreach-1",
    businessName: "Example Estates",
    contactName: "",
    email: "",
    phone: "",
    contactType: "Estate Agent",
    firstContactDate: "",
    lastContactDate: "",
    nextFollowUpDate: "",
    status: "Not Contacted",
    relationshipStatus: "",
    notes: "",
    owner: "",
    linkedLeadId: "",
    dateCreated: "2026-09-30T12:00:00.000Z",
    ...overrides,
  };
}

describe("getOutreachBucket", () => {
  it("groups statuses into the expected pipeline buckets", () => {
    expect(getOutreachBucket("Not Contacted")).toBe("Active prospects");
    expect(getOutreachBucket("Positive Interest")).toBe("Replies / positive interest");
    expect(getOutreachBucket("Closed Supplier Network")).toBe("Closed supplier networks");
    expect(getOutreachBucket("No Response")).toBe("No response");
    expect(getOutreachBucket("Future Phone Follow-Up")).toBe("Future phone-only targets");
    expect(getOutreachBucket("Converted to Lead")).toBe("Converted to Lead");
    expect(getOutreachBucket("Closed / Not Pursuing")).toBe("Closed / Not Pursuing");
  });
});

describe("isOutreachFollowUpExcluded", () => {
  it("excludes converted and closed outreach records", () => {
    expect(isOutreachFollowUpExcluded("Converted to Lead")).toBe(true);
    expect(isOutreachFollowUpExcluded("Closed / Not Pursuing")).toBe(true);
    expect(isOutreachFollowUpExcluded("Closed Supplier Network")).toBe(true);
    expect(isOutreachFollowUpExcluded("Follow-Up Due")).toBe(false);
  });
});

describe("classifyOutreachFollowUp", () => {
  const todayMs = new Date("2026-09-30T00:00:00").getTime();

  it("classifies overdue, due-today and upcoming follow-ups", () => {
    expect(
      classifyOutreachFollowUp(
        makeOutreach({ status: "Follow-Up Due", nextFollowUpDate: "2026-09-29" }),
        todayMs,
      ),
    ).toBe("Overdue");

    expect(
      classifyOutreachFollowUp(
        makeOutreach({ status: "Follow-Up Due", nextFollowUpDate: "2026-09-30" }),
        todayMs,
      ),
    ).toBe("Due today");

    expect(
      classifyOutreachFollowUp(
        makeOutreach({ status: "Follow-Up Due", nextFollowUpDate: "2026-10-01" }),
        todayMs,
      ),
    ).toBe("Upcoming");
  });

  it("returns null for records outside the normal follow-up funnel", () => {
    expect(
      classifyOutreachFollowUp(
        makeOutreach({ status: "Converted to Lead" }),
        todayMs,
      ),
    ).toBeNull();

    expect(
      classifyOutreachFollowUp(
        makeOutreach({ status: "Future Phone Follow-Up", nextFollowUpDate: "" }),
        todayMs,
      ),
    ).toBeNull();

    expect(
      classifyOutreachFollowUp(
        makeOutreach({ status: "Not Contacted", nextFollowUpDate: "" }),
        todayMs,
      ),
    ).toBeNull();
  });

  it("returns no-follow-up-scheduled when an active record lacks a usable date", () => {
    expect(
      classifyOutreachFollowUp(
        makeOutreach({ status: "Followed Up", nextFollowUpDate: "" }),
        todayMs,
      ),
    ).toBe("No follow-up scheduled");
  });
});

describe("isReadyForInitialOutreach", () => {
  const todayMs = new Date("2026-09-30T00:00:00").getTime();

  it("accepts fresh not-contacted prospects with a business name", () => {
    expect(isReadyForInitialOutreach(makeOutreach(), todayMs)).toBe(true);
  });

  it("rejects non-ready prospects", () => {
    expect(
      isReadyForInitialOutreach(
        makeOutreach({ status: "Initial Outreach Sent" }),
        todayMs,
      ),
    ).toBe(false);

    expect(
      isReadyForInitialOutreach(
        makeOutreach({ businessName: "   " }),
        todayMs,
      ),
    ).toBe(false);

    expect(
      isReadyForInitialOutreach(
        makeOutreach({ nextFollowUpDate: "2026-10-01" }),
        todayMs,
      ),
    ).toBe(false);
  });
});
