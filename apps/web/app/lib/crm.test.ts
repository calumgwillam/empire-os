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

describe("sanitizeOutreachRecord", () => {
  it("trims editable fields and applies deterministic defaults", async () => {
    const { sanitizeOutreachRecord } = await import("./crm");

    const result = sanitizeOutreachRecord(
      {
        ...makeOutreach(),
        id: "",
        businessName: "  Example Estates  ",
        contactName: "  Alex Smith  ",
        email: "  alex@example.com  ",
        phone: "  07123456789  ",
        relationshipStatus: "  Warm  ",
        notes: "  Follow up next week  ",
        owner: "  Calum  ",
        dateCreated: "",
      },
      {
        generateId: () => "outreach-2",
        nowIso: () => "2026-10-01T12:00:00.000Z",
      },
    );

    expect(result.id).toBe("outreach-2");
    expect(result.businessName).toBe("Example Estates");
    expect(result.contactName).toBe("Alex Smith");
    expect(result.email).toBe("alex@example.com");
    expect(result.phone).toBe("07123456789");
    expect(result.relationshipStatus).toBe("Warm");
    expect(result.notes).toBe("Follow up next week");
    expect(result.owner).toBe("Calum");
    expect(result.dateCreated).toBe("2026-10-01T12:00:00.000Z");
  });

  it("falls back safely for invalid contact type and status values", async () => {
    const { sanitizeOutreachRecord } = await import("./crm");

    const record = {
      ...makeOutreach(),
      contactType: "Invalid type",
      status: "Invalid status",
    } as unknown as OutreachRecord;

    const result = sanitizeOutreachRecord(record, {
      generateId: () => "unused",
      nowIso: () => "2026-10-01T12:00:00.000Z",
    });

    expect(result.contactType).toBe("Other");
    expect(result.status).toBe("Not Contacted");
  });
});

describe("convertOutreachToLead", () => {
  it("creates a deterministic Lead and links the Outreach record", async () => {
    const { convertOutreachToLead } = await import("./crm");

    const contact = makeOutreach({
      businessName: "Example Estates",
      contactName: "Alex Smith",
      phone: "07123456789",
      email: "alex@example.com",
      owner: "Calum",
      notes: "Interested in garden maintenance.",
    });

    const result = convertOutreachToLead(contact, {
      generateLeadId: () => "lead-1",
      today: () => "2026-10-01",
      nowIso: () => "2026-10-01T12:00:00.000Z",
    });

    expect(result.lead.id).toBe("lead-1");
    expect(result.lead.leadName).toBe("Example Estates");
    expect(result.lead.sourceChannel).toBe("Estate Agent / Property Manager");
    expect(result.lead.sourceDetail).toBe("Example Estates");
    expect(result.lead.dateReceived).toBe("2026-10-01");
    expect(result.lead.owner).toBe("Calum");
    expect(result.lead.relatedPillar).toBe("Marketing / Growth");
    expect(result.lead.notes).toContain("Interested in garden maintenance.");
    expect(result.lead.dateCreated).toBe("2026-10-01T12:00:00.000Z");

    expect(result.outreach.status).toBe("Converted to Lead");
    expect(result.outreach.linkedLeadId).toBe("lead-1");
  });
});

describe("linkOutreachToLead", () => {
  it("links to an existing Lead without altering unrelated Outreach data", async () => {
    const { linkOutreachToLead } = await import("./crm");

    const contact = makeOutreach({
      businessName: "Example Estates",
      notes: "Keep this note",
    });

    const result = linkOutreachToLead(contact, "existing-lead-1");

    expect(result.status).toBe("Converted to Lead");
    expect(result.linkedLeadId).toBe("existing-lead-1");
    expect(result.businessName).toBe("Example Estates");
    expect(result.notes).toBe("Keep this note");
  });
});

describe("sanitizeLeadRecord", () => {
  it("trims editable fields and applies deterministic defaults", async () => {
    const { sanitizeLeadRecord } = await import("./crm");

    const result = sanitizeLeadRecord(
      {
        id: "",
        leadName: "  Garden enquiry  ",
        contactName: "  Alex Smith  ",
        phone: "  07123456789  ",
        email: "  alex@example.com  ",
        location: "  Sidcup  ",
        serviceRequested: "  Hedge cutting  ",
        sourceChannel: "Referral",
        sourceDetail: "  Existing customer  ",
        dateReceived: "2026-09-30",
        status: "Contacted",
        quoteValue: " 350 ",
        quoteSentDate: "2026-09-30",
        followUpDate: "2026-10-03",
        outcome: "  Won  ",
        finalJobValue: " 325 ",
        notes: "  Call Friday  ",
        owner: "  Lewis  ",
        relatedPillar: "Marketing / Growth",
        dateCreated: "",
      },
      {
        generateId: () => "lead-2",
        nowIso: () => "2026-10-01T12:00:00.000Z",
        resolvedOwnerName: "Lewis",
        isAllowedPillar: (value) => value === "Marketing / Growth",
      },
    );

    expect(result.id).toBe("lead-2");
    expect(result.leadName).toBe("Garden enquiry");
    expect(result.contactName).toBe("Alex Smith");
    expect(result.phone).toBe("07123456789");
    expect(result.email).toBe("alex@example.com");
    expect(result.location).toBe("Sidcup");
    expect(result.serviceRequested).toBe("Hedge cutting");
    expect(result.sourceDetail).toBe("Existing customer");
    expect(result.quoteValue).toBe("350");
    expect(result.outcome).toBe("Won");
    expect(result.finalJobValue).toBe("325");
    expect(result.notes).toBe("Call Friday");
    expect(result.owner).toBe("Lewis");
    expect(result.relatedPillar).toBe("Marketing / Growth");
    expect(result.dateCreated).toBe("2026-10-01T12:00:00.000Z");
  });

  it("falls back safely for invalid source, status and pillar values", async () => {
    const { sanitizeLeadRecord } = await import("./crm");

    const record = {
      id: "lead-1",
      leadName: "Lead",
      contactName: "",
      phone: "",
      email: "",
      location: "",
      serviceRequested: "",
      sourceChannel: "Invalid source",
      sourceDetail: "",
      dateReceived: "",
      status: "Invalid status",
      quoteValue: "",
      quoteSentDate: "",
      followUpDate: "",
      outcome: "",
      finalJobValue: "",
      notes: "",
      owner: "  Unknown Owner  ",
      relatedPillar: "Invalid pillar",
      dateCreated: "2026-09-30T12:00:00.000Z",
    } as unknown as import("./crm").LeadRecord;

    const result = sanitizeLeadRecord(record, {
      generateId: () => "unused",
      nowIso: () => "unused",
      resolvedOwnerName: null,
      isAllowedPillar: () => false,
    });

    expect(result.sourceChannel).toBe("Other");
    expect(result.status).toBe("New");
    expect(result.owner).toBe("Unknown Owner");
    expect(result.relatedPillar).toBe("Garden Maintenance");
  });
});
