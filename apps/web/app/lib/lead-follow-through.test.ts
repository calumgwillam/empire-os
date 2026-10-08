import { describe, expect, it } from "vitest";
import { defaultLeadForm, leadStatusOptions, type LeadRecord } from "./crm";
import { assertActionLeadLink, normalizeActionRecord, type ActionRecord } from "./capture-conversions";
import { buildCommandAttention, type CommandAttentionInput } from "./command-attention";
import {
  buildLeadFollowThrough, createLeadFollowThroughAction, getLeadFollowThroughDate, linkLeadFollowThroughAction,
  type LeadFollowThroughInput,
} from "./lead-follow-through";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const person = { id: "person-1", name: "Commercial Owner", status: "Active", role: "Commercial execution",
  responsibilities: "Own lead follow-through", authority: "Arrange follow-up within agreed limits" };
const lead = (overrides: Partial<LeadRecord> = {}): LeadRecord => ({
  ...defaultLeadForm, id: "lead-1", leadName: "Customer enquiry", owner: person.name,
  status: "Contacted", dateCreated: "2026-09-28T12:00:00Z", ...overrides,
});
const action = (overrides: Partial<ActionRecord> = {}): ActionRecord => ({
  ...normalizeActionRecord({
    id: "action-1", sourceCaptureId: "", targetType: "Convert to Action", createdAt: "2026-09-30T12:00:00Z",
    title: "Confirm customer requirements", originalRawNote: "Record customer requirements", status: "Open",
    relatedArea: "Garden Maintenance", importance: "Low", priority: "Low", owner: person.name,
    dueDate: "2026-10-03",
  }), ownerPersonId: person.id, relatedLeadId: "lead-1", ...overrides,
});
const context = (overrides: Partial<LeadFollowThroughInput> = {}): LeadFollowThroughInput => ({
  leads: [lead()], actions: [], people: [person], nowMs: NOW, ...overrides,
});
const command = (overrides: Partial<CommandAttentionInput> = {}): CommandAttentionInput => ({
  problems: [], actions: [], outreach: [], projects: [], decisions: [], opportunities: [], lessons: [],
  systems: [], sops: [], handoffs: [], procurementQueue: [], nowMs: NOW, ...overrides,
});
const request = { leadId: "lead-1", id: "action-new", title: "Confirm site visit", description: "Agree a time with the customer and record their response.",
  dueDate: "2026-10-02", ownerPersonId: person.id };

describe("Accountable commercial follow-through", () => {
  it.each(leadStatusOptions.filter((status) => status !== "Won" && status !== "Lost"))(
    "requires a dated next step or review for %s, including On Hold", (status) => {
      expect(buildLeadFollowThrough(context({ leads: [lead({ status })] }))[0].state).toBe("Missing next step");
    },
  );
  it("excludes terminal and archived Leads without deleting their history", () => {
    expect(buildLeadFollowThrough(context({ leads: [lead({ status: "Won" }), lead({ status: "Lost" }), lead({ archived: true })] }))).toEqual([]);
  });
  it("supports legacy name-based ownership and scheduled follow-up without inventing an Action", () => {
    const view = buildLeadFollowThrough(context({ leads: [lead({ owner: " commercial owner ", followUpDate: "2026-10-03" })] }))[0];
    expect(view).toMatchObject({ state: "Scheduled", ownerPersonId: person.id, activeActionIds: [], reasons: [] });
  });
  it.each(["", "not-a-date", "2026-02-30", "2026-10-03 arbitrary", "2026-10-01T24:00:00Z"])(
    "rejects missing or invalid next-step dates: %s", (dueDate) => {
      expect(Number.isNaN(getLeadFollowThroughDate(dueDate))).toBe(true);
      expect(buildLeadFollowThrough(context({ actions: [action({ dueDate })] }))[0].state).toBe("Invalid");
    },
  );
  it("keeps date-only obligations due through end-of-day UTC and overdue only afterward", () => {
    const input = context({ leads: [lead({ followUpDate: "2026-10-01" })] });
    expect(buildLeadFollowThrough(input)[0].state).toBe("Due");
    expect(buildLeadFollowThrough({ ...input, nowMs: Date.parse("2026-10-01T23:59:59.999Z") })[0].state).toBe("Due");
    expect(buildLeadFollowThrough({ ...input, nowMs: Date.parse("2026-10-02T00:00:00Z") })[0].state).toBe("Overdue");
  });
  it("uses the earliest obligation rather than extending a Lead deadline through Action edits", () => {
    const view = buildLeadFollowThrough(context({ leads: [lead({ followUpDate: "2026-09-30" })], actions: [action()] }))[0];
    expect(view).toMatchObject({ nextStepBy: "2026-09-30", state: "Overdue" });
  });
  it("retains overdue attention alongside an ownership failure", () => {
    const input = context({ leads: [lead({ owner: "", followUpDate: "2026-09-30" })] });
    expect(buildLeadFollowThrough(input)[0]).toMatchObject({ state: "Unowned" });
    expect(buildLeadFollowThrough(input)[0].reasons.join(" ")).toContain("overdue");
  });
  it("rejects ambiguous names, inactive People and broken authoritative Action identities", () => {
    expect(buildLeadFollowThrough(context({ people: [person, { ...person, id: "person-2" }] }))[0].state).toBe("Unowned");
    expect(buildLeadFollowThrough(context({ people: [{ ...person, status: "Inactive" }] }))[0].state).toBe("Unowned");
    expect(buildLeadFollowThrough(context({ actions: [action({ ownerPersonId: "missing" })] }))[0].state).toBe("Unowned");
  });
  it("detects Action reassignment without silently changing Lead responsibility", () => {
    const other = { ...person, id: "person-2", name: "Other owner" };
    const input = context({ actions: [action({ owner: other.name, ownerPersonId: other.id })], people: [person, other] });
    expect(buildLeadFollowThrough(input)[0].reasons.join(" ")).toContain("owners disagree");
    expect(input.leads[0].owner).toBe(person.name);
  });
  it("surfaces blockers and imported duplicates without selecting one as valid execution", () => {
    expect(buildLeadFollowThrough(context({ actions: [action({ status: "Blocked" })] }))[0].state).toBe("Blocked");
    const view = buildLeadFollowThrough(context({ actions: [action(), action({ id: "action-2" })] }))[0];
    expect(view.state).toBe("Invalid");
    expect(view.activeActionIds).toHaveLength(2);
  });
  it("retains completed execution history but never infers a sale or a new next step", () => {
    const input = context({ actions: [action({ status: "Completed", completionDate: "2026-10-01T11:00:00Z", completionEvidence: "Customer confirmed requirements" })] });
    const before = JSON.stringify(input);
    expect(buildLeadFollowThrough(input)[0]).toMatchObject({ state: "Missing next step", completedActionIds: ["action-1"], activeActionIds: [] });
    expect(input.leads[0]).toMatchObject({ status: "Contacted", outcome: "", finalJobValue: "" });
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each([
    { completionDate: "", completionEvidence: "" },
    { completionDate: "2026-10-04T11:00:00Z", completionEvidence: "Future work" },
    { completionDate: "2026-02-30", completionEvidence: "Invalid day" },
  ])("does not mistake unsupported completion for reliable execution history", (completion) => {
    expect(buildLeadFollowThrough(context({ actions: [action({ status: "Completed", ...completion })] }))[0].state).toBe("Invalid");
  });
  it("creates an ordinary Action from explicit user instructions without modifying the Lead", () => {
    const input = context();
    const before = JSON.stringify(input);
    const created = createLeadFollowThroughAction(input, request, [person]);
    expect(created).toMatchObject({ id: request.id, relatedLeadId: "lead-1", description: request.description,
      dueDate: request.dueDate, ownerPersonId: person.id, status: "Open", createdAt: new Date(NOW).toISOString() });
    expect(JSON.stringify(input)).toBe(before);
    expect(normalizeActionRecord(JSON.parse(JSON.stringify(created)))).toEqual(created);
  });
  it("requires explicit instructions, identity and delegation readiness", () => {
    expect(() => createLeadFollowThroughAction(context(), { ...request, description: "" }, [person])).toThrow("execution instructions");
    expect(() => createLeadFollowThroughAction(context({ actions: [action({ id: request.id })] }), request, [person])).toThrow("unique identity");
    expect(() => createLeadFollowThroughAction(context(), request, [{ ...person, authority: "" }])).toThrow("delegation-ready");
    expect(() => createLeadFollowThroughAction(context(), { ...request, ownerPersonId: "missing" }, [person])).toThrow("delegation-ready");
  });
  it("links immutably, permits an idempotent link and refuses active duplicates", () => {
    const candidate = action({ relatedLeadId: undefined });
    const linked = linkLeadFollowThroughAction(context({ actions: [candidate] }), "lead-1", candidate);
    expect(candidate.relatedLeadId).toBeUndefined();
    expect(linked.relatedLeadId).toBe("lead-1");
    expect(linkLeadFollowThroughAction(context({ actions: [linked] }), "lead-1", linked)).toEqual(linked);
    expect(() => createLeadFollowThroughAction(context({ actions: [linked] }), request, [person])).toThrow("already exists");
  });
  it("refuses terminal scope, missing Actions, stale snapshots and deadline postponement", () => {
    const candidate = action({ relatedLeadId: undefined });
    expect(() => linkLeadFollowThroughAction(context({ leads: [lead({ status: "Won" })], actions: [candidate] }), "lead-1", candidate)).toThrow("terminal");
    expect(() => linkLeadFollowThroughAction(context(), "lead-1", candidate)).toThrow("missing or ambiguous");
    expect(() => linkLeadFollowThroughAction(context({ actions: [candidate] }), "lead-1", { ...candidate, ownerPersonId: "other" })).toThrow("changed");
    expect(() => linkLeadFollowThroughAction(context({ leads: [lead({ followUpDate: "2026-10-02" })], actions: [candidate] }), "lead-1", candidate)).toThrow("postpone");
  });
  it("refuses completed, cross-Lead and mismatched-owner Actions", () => {
    const completed = action({ status: "Completed" });
    expect(() => linkLeadFollowThroughAction(context({ actions: [completed] }), "lead-1", completed)).toThrow("active");
    const crossLead = action({ relatedLeadId: "other-lead" });
    expect(() => linkLeadFollowThroughAction(context({ actions: [crossLead] }), "lead-1", crossLead)).toThrow("different Lead");
    const unowned = action({ ownerPersonId: "missing" });
    expect(() => linkLeadFollowThroughAction(context({ actions: [unowned] }), "lead-1", unowned)).toThrow("accountable Person");
  });
  it("rejects invalid clocks explicitly", () => {
    expect(() => buildLeadFollowThrough(context({ nowMs: NaN }))).toThrow("clock");
    expect(() => createLeadFollowThroughAction(context({ nowMs: Infinity }), request, [person])).toThrow("clock");
  });
  it("preserves optional persisted linkage, rejects malformed values and does not add a field to legacy Actions", () => {
    expect(() => assertActionLeadLink(undefined)).not.toThrow();
    expect(() => assertActionLeadLink("")).not.toThrow();
    expect(() => assertActionLeadLink(null)).toThrow("optional string");
    expect(() => assertActionLeadLink(42)).toThrow("optional string");
    expect(normalizeActionRecord(action({ relatedLeadId: " lead-1 " })).relatedLeadId).toBe("lead-1");
    expect(normalizeActionRecord(action({ relatedLeadId: undefined })).relatedLeadId).toBeUndefined();
  });
});

describe("Commercial Command integration", () => {
  it("surfaces forgotten active stages using existing Lead navigation", () => {
    const result = buildCommandAttention(command({ leads: [lead()], commercialPeople: [person] }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ objectType: "Lead", id: "lead-1", navigationMode: "record-handler" });
  });
  it("merges monitoring issues into the existing Action item, not a duplicate Lead item", () => {
    const result = buildCommandAttention(command({ leads: [lead({ followUpDate: "2026-09-30" })],
      commercialPeople: [person], actions: [action({ priority: "High" })] }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ objectType: "Action", id: "action-1", attentionRank: 2 });
    expect(result.items[0].reasons.join(" ")).toContain("COMMERCIAL");
  });
  it("anchors newly detected responsibility gaps to low-priority linked Actions too", () => {
    const result = buildCommandAttention(command({ leads: [lead({ owner: "" })], commercialPeople: [person], actions: [action()] }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0].objectType).toBe("Action");
  });
  it("surfaces orphaned linkage and keeps old callers unchanged", () => {
    const source = command({ actions: [action()] });
    const baseline = buildCommandAttention(source).items;
    expect(baseline).toHaveLength(1);
    expect(baseline[0]).toMatchObject({ objectType: "Action", id: "action-1", reasons: ["DUE WITHIN 7 DAYS"] });
    expect(baseline).toEqual(buildCommandAttention(command({ actions: [action({ relatedLeadId: undefined })] })).items);
    expect(buildCommandAttention({ ...source, leads: [lead()], commercialPeople: [person] }).items).toEqual(baseline);

    const orphaned = buildCommandAttention({ ...source, leads: [], commercialPeople: [person] }).items;
    expect(orphaned).toHaveLength(1);
    const { reason: baselineReason, reasons: baselineReasons, ...baselineMetadata } = baseline[0];
    const { reason: orphanedReason, reasons: orphanedReasons, ...orphanedMetadata } = orphaned[0];
    expect(orphanedMetadata).toEqual(baselineMetadata);
    expect(orphanedReasons).toHaveLength(baselineReasons.length + 1);
    expect(orphanedReasons).toEqual(expect.arrayContaining([
      ...baselineReasons, "COMMERCIAL: Linked Lead is missing or ambiguous",
    ]));
    expect(orphanedReason).toContain(baselineReason);
    expect(orphanedReason).toBe(orphanedReasons.join(" • "));
    expect(buildCommandAttention(command({ leads: [lead({ followUpDate: "2026-10-03" })], commercialPeople: [person] })).items).toEqual([]);
  });
  it("retains overdue urgency even when the primary state is an ownership gap", () => {
    const result = buildCommandAttention(command({ leads: [lead({ owner: "", followUpDate: "2026-09-30" })], commercialPeople: [person] }));
    expect(result.items[0].attentionRank).toBe(2);
    expect(result.items[0].reasons.join(" ")).toContain("accountable Person");
  });
  it("requires review of outstanding sales work on terminal Leads without reopening them", () => {
    const won = lead({ status: "Won", finalJobValue: "500" });
    const result = buildCommandAttention(command({ leads: [won], commercialPeople: [person], actions: [action()] }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0].reason).toContain("closed or archived");
    expect(won.status).toBe("Won");
    expect(buildCommandAttention(command({ leads: [won], commercialPeople: [person],
      actions: [action({ status: "Completed" })] })).items).toEqual([]);
  });
});
