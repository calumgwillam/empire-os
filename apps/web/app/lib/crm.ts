export const leadStatusOptions = ["New", "Contacted", "Quote Needed", "Quote Sent", "Follow-Up", "Won", "Lost", "On Hold"] as const;
export type LeadStatus = (typeof leadStatusOptions)[number];

export const leadSourceOptions = ["Nextdoor", "Facebook Group", "Referral", "Community Page", "Direct Outreach", "Website", "Google Business Profile", "Instagram", "Estate Agent / Property Manager", "Repeat Customer", "Other"] as const;
export type LeadSource = (typeof leadSourceOptions)[number];

export const leadOutcomeOptions = ["", "Won", "Lost", "No Response", "Cancelled"] as const;

export type LeadRecord = {
  id: string;
  leadName: string;
  contactName: string;
  phone: string;
  email: string;
  location: string;
  serviceRequested: string;
  sourceChannel: LeadSource;
  sourceDetail: string;
  dateReceived: string;
  status: LeadStatus;
  quoteValue: string;
  quoteSentDate: string;
  followUpDate: string;
  outcome: string;
  finalJobValue: string;
  notes: string;
  owner: string;
  relatedPillar: string;
  dateCreated: string;
  archived?: boolean;
  deliveryCommitment?: import("./lead-delivery").LeadDeliveryCommitment;
};

export type LeadFormValues = Omit<LeadRecord, "id" | "dateCreated">;

export const defaultLeadForm: LeadFormValues = {
  leadName: "",
  contactName: "",
  phone: "",
  email: "",
  location: "",
  serviceRequested: "",
  sourceChannel: "Other",
  sourceDetail: "",
  dateReceived: "",
  status: "New",
  quoteValue: "",
  quoteSentDate: "",
  followUpDate: "",
  outcome: "",
  finalJobValue: "",
  notes: "",
  owner: "",
  relatedPillar: "Garden Maintenance",
};

export const outreachContactTypeOptions = ["Estate Agent", "Lettings Agent", "Property Manager", "Other"] as const;
export type OutreachContactType = (typeof outreachContactTypeOptions)[number];

export const outreachStatusOptions = [
  "Not Contacted",
  "Initial Outreach Sent",
  "Follow-Up Due",
  "Followed Up",
  "Replied",
  "Positive Interest",
  "Closed Supplier Network",
  "No Response",
  "Future Phone Follow-Up",
  "Converted to Lead",
  "Closed / Not Pursuing",
] as const;

export type OutreachStatus = (typeof outreachStatusOptions)[number];

export type OutreachRecord = {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  contactType: OutreachContactType;
  firstContactDate: string;
  lastContactDate: string;
  nextFollowUpDate: string;
  status: OutreachStatus;
  relationshipStatus: string;
  notes: string;
  owner: string;
  linkedLeadId: string;
  dateCreated: string;
};

export type OutreachFormValues = Omit<OutreachRecord, "id" | "dateCreated">;

export const defaultOutreachForm: OutreachFormValues = {
  businessName: "",
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
};

export function getOutreachBucket(status: OutreachStatus) {
  switch (status) {
    case "Not Contacted":
    case "Initial Outreach Sent":
    case "Follow-Up Due":
    case "Followed Up":
      return "Active prospects";
    case "Replied":
    case "Positive Interest":
      return "Replies / positive interest";
    case "Closed Supplier Network":
      return "Closed supplier networks";
    case "No Response":
      return "No response";
    case "Future Phone Follow-Up":
      return "Future phone-only targets";
    case "Converted to Lead":
      return "Converted to Lead";
    case "Closed / Not Pursuing":
      return "Closed / Not Pursuing";
    default:
      return "Active prospects";
  }
}

const outreachFollowUpExcludedStatuses = new Set<OutreachStatus>([
  "Converted to Lead",
  "Closed / Not Pursuing",
  "Closed Supplier Network",
]);

export function isOutreachFollowUpExcluded(status: OutreachStatus): boolean {
  return outreachFollowUpExcludedStatuses.has(status);
}

export function classifyOutreachFollowUp(
  contact: OutreachRecord,
  startOfTodayMs: number,
): "Overdue" | "Due today" | "Upcoming" | "No follow-up scheduled" | null {
  if (outreachFollowUpExcludedStatuses.has(contact.status)) {
    return null;
  }

  if (contact.status === "Future Phone Follow-Up" && !contact.nextFollowUpDate) {
    return null;
  }

  if (contact.status === "Not Contacted" && !contact.nextFollowUpDate) {
    return null;
  }

  if (!contact.nextFollowUpDate) {
    return "No follow-up scheduled";
  }

  const dueMs = new Date(`${contact.nextFollowUpDate.slice(0, 10)}T00:00:00`).getTime();

  if (Number.isNaN(dueMs)) {
    return "No follow-up scheduled";
  }

  if (dueMs < startOfTodayMs) return "Overdue";
  if (dueMs === startOfTodayMs) return "Due today";
  return "Upcoming";
}

export const READY_FOR_INITIAL_OUTREACH_FILTER = "Ready for Initial Outreach";

export function isReadyForInitialOutreach(
  contact: OutreachRecord,
  startOfTodayMs: number,
): boolean {
  if (contact.status !== "Not Contacted") {
    return false;
  }

  if (!contact.businessName.trim()) {
    return false;
  }

  if (contact.nextFollowUpDate) {
    const constraintMs = new Date(`${contact.nextFollowUpDate.slice(0, 10)}T00:00:00`).getTime();

    if (!Number.isNaN(constraintMs) && constraintMs > startOfTodayMs) {
      return false;
    }
  }

  return true;
}

type OutreachSanitizerDeps = {
  generateId: () => string;
  nowIso: () => string;
};

export function sanitizeOutreachRecord(
  record: OutreachRecord,
  deps: OutreachSanitizerDeps,
): OutreachRecord {
  const selectedContactType = record.contactType.trim();
  const selectedStatus = record.status.trim();

  return {
    ...record,
    id: record.id || deps.generateId(),
    businessName: record.businessName.trim(),
    contactName: record.contactName.trim(),
    email: record.email.trim(),
    phone: record.phone.trim(),
    contactType: outreachContactTypeOptions.includes(selectedContactType as OutreachContactType)
      ? (selectedContactType as OutreachContactType)
      : "Other",
    status: outreachStatusOptions.includes(selectedStatus as OutreachStatus)
      ? (selectedStatus as OutreachStatus)
      : "Not Contacted",
    relationshipStatus: record.relationshipStatus.trim(),
    notes: record.notes.trim(),
    owner: record.owner.trim(),
    dateCreated: record.dateCreated || deps.nowIso(),
  };
}

type OutreachConversionDeps = {
  generateLeadId: () => string;
  today: () => string;
  nowIso: () => string;
};

export function convertOutreachToLead(
  contact: OutreachRecord,
  deps: OutreachConversionDeps,
): { lead: LeadRecord; outreach: OutreachRecord } {
  const lead: LeadRecord = {
    ...defaultLeadForm,
    id: deps.generateLeadId(),
    leadName: contact.businessName,
    contactName: contact.contactName,
    phone: contact.phone,
    email: contact.email,
    sourceChannel: "Estate Agent / Property Manager",
    sourceDetail: contact.businessName,
    dateReceived: deps.today(),
    owner: contact.owner,
    relatedPillar: "Marketing / Growth",
    notes: `Converted from outreach contact "${contact.businessName}".${contact.notes ? ` Outreach notes: ${contact.notes}` : ""}`,
    dateCreated: deps.nowIso(),
  };

  return {
    lead,
    outreach: {
      ...contact,
      status: "Converted to Lead",
      linkedLeadId: lead.id,
    },
  };
}

export function linkOutreachToLead(
  contact: OutreachRecord,
  leadId: string,
): OutreachRecord {
  return {
    ...contact,
    status: "Converted to Lead",
    linkedLeadId: leadId,
  };
}

type LeadSanitizerDeps = {
  generateId: () => string;
  nowIso: () => string;
  resolvedOwnerName: string | null;
  isAllowedPillar: (value: string) => boolean;
};

export function sanitizeLeadRecord(
  record: LeadRecord,
  deps: LeadSanitizerDeps,
): LeadRecord {
  const leadName = record.leadName.trim();
  const selectedStatus = record.status.trim();
  const selectedSource = record.sourceChannel.trim();
  const selectedPillar = record.relatedPillar.trim();

  return {
    ...record,
    id: record.id || deps.generateId(),
    leadName,
    contactName: record.contactName.trim(),
    phone: record.phone.trim(),
    email: record.email.trim(),
    location: record.location.trim(),
    serviceRequested: record.serviceRequested.trim(),
    sourceChannel: leadSourceOptions.includes(selectedSource as LeadSource)
      ? (selectedSource as LeadSource)
      : "Other",
    sourceDetail: record.sourceDetail.trim(),
    dateReceived: record.dateReceived,
    status: leadStatusOptions.includes(selectedStatus as LeadStatus)
      ? (selectedStatus as LeadStatus)
      : "New",
    quoteValue: record.quoteValue.trim(),
    quoteSentDate: record.quoteSentDate,
    followUpDate: record.followUpDate,
    outcome: record.outcome.trim(),
    finalJobValue: record.finalJobValue.trim(),
    notes: record.notes.trim(),
    owner: deps.resolvedOwnerName ?? record.owner.trim(),
    relatedPillar: deps.isAllowedPillar(selectedPillar)
      ? selectedPillar
      : "Garden Maintenance",
    dateCreated: record.dateCreated || deps.nowIso(),
  };
}
