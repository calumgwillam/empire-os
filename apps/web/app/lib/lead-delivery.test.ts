import { describe, expect, it } from "vitest";
import { defaultLeadForm, type LeadRecord } from "./crm";
import { assertActionFinanceLink, normalizeActionRecord, type ActionRecord } from "./capture-conversions";
import { sanitizeIncomeRecord, type IncomeRecord } from "./finance";
import {
  acceptLeadDelivery, assertIncomeCommercialEvidence, assertLeadDeliveryCommitment, buildLeadDelivery,
  createIncomeWorkflowAction, getDeliveryIncomeEvidence, linkLeadDelivery, scheduleLeadDelivery,
  validateDeliveryIncomeSave, type AcceptLeadDeliveryRequest, type DeliveryAction, type LeadDeliveryInput,
} from "./lead-delivery";
import { buildCommandAttention, type CommandAttentionInput } from "./command-attention";
import { linkLeadFollowThroughAction } from "./lead-follow-through";
import { BACKUP_FORMAT, BACKUP_VERSION, CONVERSION_STORAGE_KEY, INCOME_STORAGE_KEY, LEAD_STORAGE_KEY,
  validateEmpireOsBackup } from "./backup";
import { persistJsonArraysTransaction } from "./persistence";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const person = { id: "person-1", name: "Delivery Owner", status: "Active", role: "Delivery",
  responsibilities: "Deliver agreed customer scope", authority: "Schedule resources within agreed limits" };
const lead = (overrides: Partial<LeadRecord> = {}): LeadRecord => ({
  ...defaultLeadForm, id: "lead-1", leadName: "Customer job", status: "Won", owner: "Legacy sales owner",
  finalJobValue: "800", dateCreated: "2026-10-01T12:00:00Z", ...overrides,
});
const input = (overrides: Partial<LeadDeliveryInput> = {}): LeadDeliveryInput => ({
  leads: [lead()], actions: [], people: [person], income: [], nowMs: NOW, ...overrides,
});
const request: AcceptLeadDeliveryRequest = { leadId: "lead-1", actionId: "delivery-1", scope: "Deliver the scope in accepted customer proposal",
  acceptedAt: "2026-10-02", acceptedByPersonId: person.id, acceptanceEvidence: "Customer written acceptance reference",
  ownerPersonId: person.id, promisedBy: "2026-10-12" };
const accepted = (): LeadDeliveryInput => {
  const result = acceptLeadDelivery(input(), request);
  return input({ leads: [result.lead], actions: [result.action] });
};
const persistedAction = (overrides: Partial<ActionRecord> = {}): ActionRecord => ({
  ...normalizeActionRecord({ id: "existing-1", sourceCaptureId: "", targetType: "Convert to Action",
    title: "Deliver agreed work", originalRawNote: "Agreed scope", createdAt: "2026-10-01T10:00:00Z",
    status: "Open", owner: person.name, dueDate: "2026-10-11", priority: "Low", importance: "Low",
    relatedArea: "Garden Maintenance" }), ownerPersonId: person.id, ...overrides,
});
const income = (overrides: Partial<IncomeRecord> = {}): IncomeRecord => ({
  id: "income-1", relatedLeadId: "lead-1", date: "2026-10-08", description: "Customer payment",
  customerSource: "Customer job", amount: "800", area: "Garden Maintenance", status: "Expected", notes: "",
  dateCreated: "2026-10-08T10:00:00Z", ...overrides,
});
const withIncome = (record: IncomeRecord): LeadDeliveryInput => ({ ...accepted(), income: [record] });
const withBilling = (record: IncomeRecord, status: ActionRecord["status"] = "Completed"): { record: IncomeRecord; input: LeadDeliveryInput } => {
  const actionId = `billing-${record.id}`;
  const linked = { ...record, billingOwnerPersonId: person.id, billingActionId: actionId };
  const action = persistedAction({ id: actionId, financeIncomeId: record.id, financeIncomeRole: "Billing", status,
    ...(status === "Completed" ? { completionDate: "2026-10-08T11:00:00Z", completionEvidence: "Invoice issuance recorded" } : {}) });
  return { record: linked, input: { ...accepted(), income: [linked], actions: [...accepted().actions, action] } };
};
const command = (overrides: Partial<CommandAttentionInput> = {}): CommandAttentionInput => ({
  problems: [], actions: [], outreach: [], projects: [], decisions: [], opportunities: [], lessons: [],
  systems: [], sops: [], handoffs: [], procurementQueue: [], nowMs: NOW, ...overrides,
});

describe("Accepted customer delivery accountability", () => {
  it("never infers acceptance, delivery or finance from a Won Lead or final job value", () => {
    const view = buildLeadDelivery(input())[0];
    expect(view).toMatchObject({ won: true, accepted: false, assigned: false, scheduled: false,
      completed: false, completionSupported: false, financial: [] });
    expect(view.reasons).toContain("DELIVERY: Won Lead has no explicitly accepted delivery commitment");
  });
  it("creates dedicated ordinary execution immutably, preserving legacy sales ownership and all unknown stages", () => {
    const source = input();
    const before = JSON.stringify(source);
    const result = acceptLeadDelivery(source, request);
    expect(result.lead).toMatchObject({ status: "Won", owner: "Legacy sales owner", finalJobValue: "800" });
    expect(result.action).toMatchObject({ deliveryLeadId: "lead-1", ownerPersonId: person.id, description: request.scope,
      status: "Open", dueDate: request.promisedBy });
    expect(result.action.relatedLeadId).toBeUndefined();
    expect(result.lead.deliveryCommitment).toMatchObject({ acceptedAt: request.acceptedAt, assignedPersonId: person.id,
      acceptedByPersonId: person.id, schedules: [] });
    expect(JSON.stringify(source)).toBe(before);
    expect(buildLeadDelivery(input({ leads: [result.lead], actions: [result.action] }))[0])
      .toMatchObject({ accepted: true, assigned: true, scheduled: false, completed: false, completionSupported: false, financial: [] });
  });
  it.each(["New", "Lost"] as const)("requires Won status before accepting delivery (%s)", (status) => {
    expect(() => acceptLeadDelivery(input({ leads: [lead({ status })] }), request)).toThrow("Won Lead");
  });
  it("requires explicit acceptance provenance and a valid deadline, while retaining genuinely overdue work", () => {
    expect(() => acceptLeadDelivery(input(), { ...request, scope: "" })).toThrow("explicit customer scope");
    expect(() => acceptLeadDelivery(input(), { ...request, acceptanceEvidence: "" })).toThrow("acceptance evidence");
    expect(() => acceptLeadDelivery(input(), { ...request, acceptedAt: "2026-10-09" })).toThrow("non-future");
    expect(() => acceptLeadDelivery(input(), { ...request, promisedBy: "2026-02-30" })).toThrow("deadline");
    expect(() => acceptLeadDelivery(input(), { ...request, promisedBy: "2026-10-01" })).toThrow("deadline");
    const result = acceptLeadDelivery(input(), { ...request, promisedBy: "2026-10-03" });
    expect(buildLeadDelivery(input({ leads: [result.lead], actions: [result.action] }))[0].overdue).toBe(true);
  });
  it.each([
    { ...person, status: "Inactive" }, { ...person, role: "" }, { ...person, responsibilities: "" }, { ...person, authority: "" },
  ])("requires active delegation readiness rather than a name alone", (owner) => {
    expect(() => acceptLeadDelivery(input({ people: [owner] }), request)).toThrow("delegation-ready");
  });
  it("refuses duplicated identities and duplicate commitments", () => {
    expect(() => acceptLeadDelivery(input({ leads: [lead(), lead()] }), request)).toThrow("unique persisted");
    expect(() => acceptLeadDelivery(input({ people: [person, person] }), request)).toThrow("unique active");
    expect(() => acceptLeadDelivery(accepted(), request)).toThrow("already exists");
    expect(() => acceptLeadDelivery(input({ actions: [persistedAction({ id: request.actionId })] }), request)).toThrow("identity already exists");
    expect(() => acceptLeadDelivery(input({ actions: [persistedAction({ deliveryLeadId: "lead-1" })] }), request)).toThrow("already exists");
  });
  it("links a distinct persisted Action without rewriting its execution data or creating a duplicate", () => {
    const action = persistedAction();
    const source = input({ actions: [action] });
    const result = linkLeadDelivery(source, { ...request, actionId: action.id }, action);
    expect(result.action).toEqual({ ...action, deliveryLeadId: "lead-1" });
    expect(action.deliveryLeadId).toBeUndefined();
    expect(result.lead.deliveryCommitment?.actionId).toBe(action.id);
  });
  it("refuses sales, cancelled, completed, stale or differently owned execution and deadline postponement", () => {
    for (const action of [
      persistedAction({ relatedLeadId: "lead-1" }), persistedAction({ deliveryLeadId: "other-lead" }),
      persistedAction({ status: "Completed" }), persistedAction({ status: "Cancelled" }),
      persistedAction({ ownerPersonId: "other" }), persistedAction({ dueDate: "2026-10-13" }),
    ]) {
      expect(() => linkLeadDelivery(input({ actions: [action] }), { ...request, actionId: action.id }, action)).toThrow();
    }
    const action = persistedAction();
    expect(() => linkLeadDelivery(input({ actions: [action] }), { ...request, actionId: action.id }, { ...action })).toThrow("stale");
  });
  it("does not let customer delivery execution be reused as sales follow-through", () => {
    const action = persistedAction({ deliveryLeadId: "other-lead" });
    expect(() => linkLeadFollowThroughAction({ leads: [lead({ status: "Contacted", owner: person.name })],
      actions: [action], people: [person], nowMs: NOW }, "lead-1", action)).toThrow("Customer delivery");
  });
  it("keeps explicitly accepted obligations visible after archiving or changing sales status", () => {
    const source = accepted();
    const view = buildLeadDelivery({ ...source, leads: [{ ...source.leads[0], archived: true, status: "Lost" }] })[0];
    expect(view.accepted).toBe(true);
    expect(view.won).toBe(false);
    expect(view.reasons.join(" ")).toContain("changed Lead stage");
    expect(buildLeadDelivery(input({ leads: [lead({ archived: true })] }))[0].accepted).toBe(false);
  });
  it("detects missing, ambiguous and one-sided linkage without confirming completion", () => {
    const source = accepted();
    expect(buildLeadDelivery({ ...source, actions: [] })[0].assigned).toBe(false);
    expect(buildLeadDelivery({ ...source, actions: [...source.actions, ...source.actions] })[0].reasons.join(" ")).toContain("duplicated or conflicting");
    expect(buildLeadDelivery({ ...source, actions: source.actions.map((action) => ({ ...action, deliveryLeadId: "other" })) })[0].assigned).toBe(false);
    const secondLead = { ...source.leads[0], id: "lead-2" };
    expect(buildLeadDelivery({ ...source, leads: [...source.leads, secondLead] })[0].assigned).toBe(false);
    const conflicting = buildLeadDelivery({ ...source, actions: source.actions.map((action): DeliveryAction => ({
      ...action, deliveryLeadId: "other", status: "Completed", completionDate: "2026-10-08T12:00:00Z",
      completionEvidence: "Unrelated completion",
    })) })[0];
    expect(conflicting).toMatchObject({ executionLinked: false, completed: false, completionSupported: false });
  });
  it("uses current authoritative Action ownership without silently falling back to name or sales ownership", () => {
    const source = accepted();
    const other = { ...person, id: "person-2", name: "Delegated owner" };
    expect(buildLeadDelivery({ ...source, people: [person, other],
      actions: source.actions.map((action) => ({ ...action, ownerPersonId: other.id, owner: other.name })) })[0].assigned).toBe(true);
    expect(source.leads[0].deliveryCommitment?.assignedPersonId).toBe(person.id);
    expect(buildLeadDelivery({ ...source, actions: source.actions.map((action) => ({ ...action, ownerPersonId: "missing" })) })[0].assigned).toBe(false);
  });
  it("records an explicit schedule separately and retains prior arrangements without changing acceptance or deadlines", () => {
    const source = accepted();
    const before = JSON.stringify(source);
    const scheduled = scheduleLeadDelivery(source, "lead-1", { date: "2026-10-10", evidence: "Customer and crew arrangements confirmed",
      recordedByPersonId: person.id });
    const second = scheduleLeadDelivery({ ...source, leads: [scheduled] }, "lead-1", { date: "2026-10-11",
      evidence: "Revised arrangements confirmed", recordedByPersonId: person.id });
    expect(second.deliveryCommitment?.schedules).toHaveLength(2);
    expect(second.deliveryCommitment?.promisedBy).toBe(request.promisedBy);
    expect(second.deliveryCommitment?.acceptanceEvidence).toBe(request.acceptanceEvidence);
    expect(buildLeadDelivery({ ...source, leads: [second] })[0]).toMatchObject({ scheduled: true, completed: false });
    expect(JSON.stringify(source)).toBe(before);
    expect(() => scheduleLeadDelivery(source, "lead-1", { date: "2026-10-13", evidence: "Later", recordedByPersonId: person.id })).toThrow("without extending");
    expect(() => scheduleLeadDelivery(source, "lead-1", { date: "2026-10-01", evidence: "Before acceptance", recordedByPersonId: person.id })).toThrow();
  });
  it("never treats an ordinary Completed flag as sufficient evidence or financial realisation", () => {
    const source = accepted();
    const actions = source.actions.map((action): DeliveryAction => ({ ...action, status: "Completed" }));
    const view = buildLeadDelivery({ ...source, actions })[0];
    expect(view).toMatchObject({ completed: true, completionSupported: false, financial: [] });
    expect(view.reasons.join(" ")).toContain("completion evidence");
    const valid = actions.map((action) => ({ ...action, completionDate: "2026-10-08T12:00:00Z", completionEvidence: "Customer completion confirmation" }));
    const completed = buildLeadDelivery({ ...source, actions: valid })[0];
    expect(completed.completionSupported).toBe(true);
    expect(completed.financial).toEqual([]);
    expect(completed.reasons.join(" ")).toContain("review billing responsibility");
  });
  it("surfaces a missed schedule and never hides corrupted prior scheduling history behind a later review", () => {
    const source = accepted();
    const scheduled = scheduleLeadDelivery(source, "lead-1", { date: "2026-10-09", evidence: "Crew scheduled", recordedByPersonId: person.id });
    const next = { ...source, leads: [scheduled], nowMs: Date.parse("2026-10-10T12:00:00Z") };
    expect(buildLeadDelivery(next)[0].reasons.join(" ")).toContain("Scheduled work date passed");
    const revised = scheduleLeadDelivery(next, "lead-1", { date: "2026-10-11", evidence: "Customer-approved reschedule", recordedByPersonId: person.id });
    const commitment = revised.deliveryCommitment;
    if (!commitment) throw new Error("Fixture requires accepted delivery.");
    const corrupted: LeadRecord = { ...revised, deliveryCommitment: { ...commitment,
      schedules: commitment.schedules.map((entry, index) => index === 0 ? { ...entry, evidence: "" } : entry) } };
    expect(buildLeadDelivery({ ...next, leads: [corrupted] })[0].scheduled).toBe(false);
  });
  it.each(["2026-10-07T12:00:00Z", "2026-10-08T11:00:00Z", "2026-10-09", "2026-02-30"])(
    "rejects pre-link, future or invalid completion evidence (%s)", (completionDate) => {
      const source = accepted();
      expect(buildLeadDelivery({ ...source, actions: source.actions.map((action): DeliveryAction => ({
        ...action, status: "Completed", completionDate, completionEvidence: "Claimed completion",
      })) })[0].completionSupported).toBe(false);
    },
  );
  it("preserves the original customer deadline even if execution is extended or cancelled", () => {
    const source = accepted();
    const view = buildLeadDelivery({ ...source, nowMs: Date.parse("2026-10-13T00:00:00Z"),
      actions: source.actions.map((action): DeliveryAction => ({ ...action, dueDate: "2026-10-20", status: "Cancelled" })) })[0];
    expect(view.overdue).toBe(true);
    expect(view.reasons.join(" ")).toContain("postpones");
    expect(view.reasons.join(" ")).toContain("not been discharged");
  });
  it("uses end-of-day UTC deadline boundaries and rejects invalid clocks explicitly", () => {
    const source = accepted();
    expect(buildLeadDelivery({ ...source, nowMs: Date.parse("2026-10-12T23:59:59.999Z") })[0]).toMatchObject({ due: true, overdue: false });
    expect(buildLeadDelivery({ ...source, nowMs: Date.parse("2026-10-13T00:00:00Z") })[0].overdue).toBe(true);
    expect(() => buildLeadDelivery({ ...source, nowMs: NaN })).toThrow("clock");
    expect(() => acceptLeadDelivery(input({ nowMs: Infinity }), request)).toThrow("clock");
  });
});

describe("Commercial financial evidence, not an accounting engine", () => {
  it("keeps Expected income distinct from earned, invoiced and received evidence", () => {
    const record = income();
    expect(getDeliveryIncomeEvidence(record, withIncome(record))).toMatchObject({ amount: 800,
      status: "Expected", earned: false, invoiced: false, received: false, reasons: [] });
    expect(buildLeadDelivery(withIncome(record))[0].completionSupported).toBe(false);
  });
  it("requires separate evidence for every financial state, without implying operational completion", () => {
    const sourceRecord = income({ earnedDate: "2026-10-08", earnedEvidence: "Explicit recognition basis",
      invoiceIssuedDate: "2026-10-08", invoiceReference: "INV-1", invoiceEvidence: "Invoice sent reference",
      status: "Received", receiptReference: "BANK-1", receiptEvidence: "Bank receipt reference" });
    const { record, input: source } = withBilling(sourceRecord);
    const receivedRecord = { ...record, status: "Received" as const, receiptReference: "BANK-1", receiptEvidence: "Bank receipt reference" };
    const withReceipt = { ...source, income: [receivedRecord] };
    expect(getDeliveryIncomeEvidence(receivedRecord, withReceipt)).toMatchObject({ earned: true, invoiced: true, received: true, reasons: [] });
    expect(buildLeadDelivery(withReceipt)[0]).toMatchObject({ scheduled: false, completed: false, completionSupported: false });
    expect(() => validateDeliveryIncomeSave(receivedRecord, withReceipt)).not.toThrow();
  });
  it("supports advance payment without inferring earned income or invoicing", () => {
    const record = income({ status: "Received", receiptReference: "BANK-1", receiptEvidence: "Deposit received" });
    expect(getDeliveryIncomeEvidence(record, withIncome(record))).toMatchObject({ received: true, earned: false, invoiced: false });
  });
  it("leaves legacy Received records unchanged but explicitly marks their receipt evidence unknown", () => {
    const record = income({ status: "Received" });
    const before = JSON.stringify(record);
    const view = getDeliveryIncomeEvidence(record, withIncome(record));
    expect(view.received).toBe(false);
    expect(view.reasons.join(" ")).toContain("lacks unique dated payment evidence");
    expect(JSON.stringify(record)).toBe(before);
    expect(() => validateDeliveryIncomeSave(record, withIncome(record))).toThrow("payment evidence");
    expect(() => validateDeliveryIncomeSave({ ...record, relatedLeadId: undefined }, withIncome(record))).not.toThrow();
  });
  it.each(["", "bad", "-1"])("does not convert missing or invalid amounts into confirmed finance (%s)", (amount) => {
    const record = income({ amount, status: "Received", receiptReference: "BANK-1", receiptEvidence: "Claimed receipt" });
    expect(getDeliveryIncomeEvidence(record, withIncome(record)).received).toBe(false);
    expect(() => validateDeliveryIncomeSave(record, withIncome(record))).toThrow("amount");
  });
  it("keeps zero valid, rejects future receipts and refuses incomplete or duplicated financial references", () => {
    const record = income({ amount: "0", status: "Received", receiptReference: "BANK-1", receiptEvidence: "Zero settlement recorded" });
    expect(getDeliveryIncomeEvidence(record, withIncome(record)).received).toBe(true);
    expect(getDeliveryIncomeEvidence({ ...record, date: "2026-10-09" }, withIncome(record)).received).toBe(false);
    const source = withIncome(record);
    expect(getDeliveryIncomeEvidence(record, { ...source, income: [record, { ...record, id: "income-2" }] }).received).toBe(false);
    const invoice = income({ invoiceReference: "INV-1", invoiceIssuedDate: "2026-10-08", invoiceEvidence: "Sent" });
    expect(getDeliveryIncomeEvidence(invoice, { ...source, income: [invoice, { ...invoice, id: "income-2" }] }).invoiced).toBe(false);
    expect(() => validateDeliveryIncomeSave(record, { ...source, income: [record, record] })).toThrow("duplicated");
    expect(getDeliveryIncomeEvidence(income({ invoiceReference: "INV-1" }), withIncome(income())).invoiced).toBe(false);
  });
  it("rejects missing customer linkage and Expected status with claimed payment evidence", () => {
    const record = income({ receiptReference: "BANK-1", receiptEvidence: "Claimed receipt" });
    expect(() => validateDeliveryIncomeSave(record, withIncome(record))).toThrow("conflicts with Expected");
    expect(() => validateDeliveryIncomeSave(income(), input())).toThrow("explicit delivery commitment");
    expect(() => validateDeliveryIncomeSave(income({ relatedLeadId: "missing" }), accepted())).toThrow("unique Lead");
  });
  it("surfaces overdue expected customer income without treating it as earned, invoiced or received", () => {
    const record = income({ date: "2026-10-07" });
    const source = withIncome(record);
    const view = getDeliveryIncomeEvidence(record, source);
    expect(view).toMatchObject({ overdue: true, earned: false, invoiced: false, received: false,
      valid: true, validationErrors: [] });
    expect(view.reasons.join(" ")).toContain("payment receipt is not established");
    expect(view.workflowReasons.join(" ")).toContain("payment receipt is not established");
    expect(() => validateDeliveryIncomeSave(record, source)).not.toThrow();
    expect(buildCommandAttention(command({ delivery: source })).items[0].attentionRank).toBe(2);
  });
  it("creates a linked, explicitly owned billing Action and requires it before a new invoice", () => {
    const record = income();
    const source = withIncome(record);
    const invoiceWithoutOwner = { ...record, invoiceIssuedDate: "2026-10-08", invoiceReference: "INV-1", invoiceEvidence: "Sent" };
    expect(() => validateDeliveryIncomeSave(invoiceWithoutOwner, source)).toThrow("billing Person");
    expect(() => createIncomeWorkflowAction({ ...source, people: [{ ...person, status: "Inactive" }] }, {
      incomeId: record.id, actionId: "billing-inactive", role: "Billing", ownerPersonId: person.id, dueDate: "2026-10-10",
    })).toThrow("delegation-ready");
    const routed = createIncomeWorkflowAction(source, { incomeId: record.id, actionId: "billing-1", role: "Billing",
      ownerPersonId: person.id, dueDate: "2026-10-10" });
    expect(routed.income).toMatchObject({ billingOwnerPersonId: person.id, billingActionId: "billing-1" });
    expect(routed.action).toMatchObject({ financeIncomeId: record.id, financeIncomeRole: "Billing",
      ownerPersonId: person.id, status: "Open", dueDate: "2026-10-10" });
    const issued = { ...routed.income, invoiceIssuedDate: "2026-10-08", invoiceReference: "INV-1", invoiceEvidence: "Sent" };
    const issuing = { ...source, income: [routed.income], actions: [routed.action] };
    expect(() => validateDeliveryIncomeSave(issued, issuing)).not.toThrow();
    const issuedSource = { ...issuing, income: [issued] };
    const issuedView = getDeliveryIncomeEvidence(issued, issuedSource);
    expect(issuedView).toMatchObject({ invoiced: true, received: false, valid: true, validationErrors: [] });
    expect(issuedView.workflowReasons).toEqual(expect.arrayContaining([
      "DELIVERY FINANCE: Billing Action remains open after invoice issue",
      "DELIVERY FINANCE: Invoiced balance has no valid payment deadline",
      "DELIVERY FINANCE: Invoiced balance has no active delegation-ready collection owner",
      "DELIVERY FINANCE: Invoiced balance has no uniquely linked collection follow-up Action",
      "DELIVERY FINANCE: Invoiced customer balance remains unpaid",
    ]));
    expect(buildCommandAttention(command({ delivery: issuedSource })).items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ objectType: "Finance", id: "income:income-1",
        reasons: expect.arrayContaining(issuedView.workflowReasons) })]));
    expect(() => createIncomeWorkflowAction({ ...source, income: [routed.income], actions: [routed.action] },
      { incomeId: record.id, actionId: "billing-2", role: "Billing", ownerPersonId: person.id, dueDate: "2026-10-10" }))
      .toThrow("still active");
  });
  it("tracks payment deadlines and raises unpaid, disputed, blocked, and unowned collection obligations", () => {
    const invoice = income({ invoiceIssuedDate: "2026-10-07", invoiceReference: "INV-1", invoiceEvidence: "Sent" });
    const { record, input: billed } = withBilling(invoice);
    const collection = createIncomeWorkflowAction(billed, { incomeId: record.id, actionId: "collection-1", role: "Collection",
      ownerPersonId: person.id, dueDate: "2026-10-09", paymentDueDate: "2026-10-10" });
    const complete = { ...billed, income: [collection.income], actions: [...billed.actions, collection.action] };
    expect(getDeliveryIncomeEvidence(collection.income, complete).workflowReasons)
      .toContain("DELIVERY FINANCE: Invoiced customer balance remains unpaid");
    expect(buildCommandAttention(command({ delivery: complete })).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: "Finance", id: "income:income-1" }),
    ]));
    const overdue = { ...collection.income, paymentDueDate: "2026-10-07" };
    expect(getDeliveryIncomeEvidence(overdue, { ...complete, income: [overdue] }).overdue).toBe(true);
    expect(() => validateDeliveryIncomeSave(overdue, complete)).not.toThrow();
    const disputed = { ...collection.income, collectionStatus: "Disputed" as const, collectionStatusEvidence: "Customer queried scope" };
    expect(getDeliveryIncomeEvidence(disputed, { ...complete, income: [disputed] }).workflowReasons)
      .toContain("DELIVERY FINANCE: Customer payment is disputed; resolve and evidence the next step");
    expect(() => validateDeliveryIncomeSave(disputed, complete)).not.toThrow();
    const blocked = { ...collection.income, collectionStatus: "Blocked" as const, collectionStatusEvidence: "Awaiting account reconciliation" };
    const blockedAction = { ...collection.action, status: "Blocked" as const };
    expect(getDeliveryIncomeEvidence(blocked, { ...complete, income: [blocked],
      actions: [...billed.actions, blockedAction] }).workflowReasons)
      .toContain("DELIVERY FINANCE: Customer collection is blocked; resolve and evidence the next step");
    expect(() => validateDeliveryIncomeSave(blocked, { ...complete,
      actions: [...billed.actions, blockedAction] })).not.toThrow();
    const unowned = { ...collection.income, collectionOwnerPersonId: undefined, collectionActionId: undefined };
    expect(getDeliveryIncomeEvidence(unowned, { ...complete, income: [unowned] }).workflowReasons)
      .toContain("DELIVERY FINANCE: Invoiced balance has no active delegation-ready collection owner");
    expect(() => validateDeliveryIncomeSave(unowned, complete)).not.toThrow();
    const completedFollowUp = { ...collection.action, status: "Completed" as const,
      completionDate: "2026-10-08T11:30:00Z", completionEvidence: "Customer contacted; awaiting response" };
    const nextStep = createIncomeWorkflowAction({ ...complete,
      actions: [...billed.actions, completedFollowUp] }, { incomeId: record.id, actionId: "collection-2",
      role: "Collection", ownerPersonId: person.id, dueDate: "2026-10-12", paymentDueDate: "2026-10-10" });
    expect(nextStep.income.collectionActionId).toBe("collection-2");
    expect(getDeliveryIncomeEvidence(nextStep.income, { ...complete,
      income: [nextStep.income], actions: [...billed.actions, completedFollowUp, nextStep.action] }).collectionActionTracked).toBe(true);
  });
  it.each([
    { invoiceReference: "" },
    { invoiceIssuedDate: "2026-10-09" },
    { receiptReference: "BANK-1", receiptEvidence: "Claimed payment while Expected" },
    { billingActionId: "missing-billing-action" },
    { collectionActionId: "missing-collection-action" },
  ])("still rejects hard evidence errors alongside collection attention (%j)", (overrides) => {
    const invoice = income({ invoiceIssuedDate: "2026-10-08", invoiceReference: "INV-1", invoiceEvidence: "Sent" });
    const { record, input: source } = withBilling(invoice);
    const invalid = { ...record, ...overrides };
    const view = getDeliveryIncomeEvidence(invalid, { ...source, income: [invalid] });
    expect(view.valid).toBe(false);
    expect(view.validationErrors.length).toBeGreaterThan(0);
    expect(() => validateDeliveryIncomeSave(invalid, source)).toThrow(view.validationErrors.join("; "));
  });
  it("routes evidence-supported completed delivery into explicit billing accountability", () => {
    const source = accepted();
    const scheduled = scheduleLeadDelivery(source, "lead-1", { date: "2026-10-08",
      evidence: "Customer and crew schedule confirmed", recordedByPersonId: person.id });
    const finished = persistedAction({ id: "delivery-1", deliveryLeadId: "lead-1", dueDate: request.promisedBy,
      status: "Completed", completionDate: new Date(NOW).toISOString(), completionEvidence: "Customer completion evidence" });
    const record = income();
    const completed = { ...source, leads: [scheduled], actions: [finished], income: [record] };
    expect(buildLeadDelivery(completed)[0].completionSupported).toBe(true);
    expect(buildLeadDelivery(completed)[0].reasons).toEqual(expect.arrayContaining([
      "DELIVERY FINANCE: Completed delivery has no evidenced invoice; review billing responsibility",
      "DELIVERY FINANCE: Completed delivery has no billing owner",
      "DELIVERY FINANCE: Completed delivery has no tracked billing Action",
    ]));
    expect(buildCommandAttention(command({ actions: [finished], delivery: completed })).items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ objectType: "Finance", id: "income:income-1" })]));
  });
  it("preserves optional evidence through existing sanitisation without manufacturing fields for legacy income", () => {
    const legacy = income({ relatedLeadId: undefined });
    const deps = { generateId: () => "unused", nowIso: () => new Date(NOW).toISOString() };
    expect(sanitizeIncomeRecord(legacy, deps)).toEqual(legacy);
    expect(sanitizeIncomeRecord(income({ invoiceEvidence: " sent ", receiptReference: " BANK-1 " }), deps))
      .toMatchObject({ invoiceEvidence: "sent", receiptReference: "BANK-1" });
  });
});

describe("Delivery Command integration and persistence", () => {
  it("keeps ordinary Action attention unchanged when delivery inputs are absent or non-qualifying", () => {
    const action = persistedAction();
    const source = command({ actions: [action] });
    const baseline = buildCommandAttention(source);
    expect(baseline.items[0].reasons).toContain("DUE WITHIN 7 DAYS");
    expect(buildCommandAttention({ ...source, delivery: input({ leads: [lead({ status: "New" })], actions: [action] }) })).toEqual(baseline);
  });
  it("does not create unresolved-delivery alerts after supported completion and financial evidence, or infer earned income", () => {
    const source = accepted();
    const scheduled = scheduleLeadDelivery(source, "lead-1", { date: "2026-10-08",
      evidence: "Crew and customer schedule confirmed", recordedByPersonId: person.id });
    const finished = persistedAction({ id: "delivery-1", deliveryLeadId: "lead-1", dueDate: request.promisedBy,
      status: "Completed", completionDate: "2026-10-08T12:00:00Z", completionEvidence: "Customer completion evidence" });
    const record = income({ status: "Received", invoiceIssuedDate: "2026-10-08", invoiceReference: "INV-1",
      invoiceEvidence: "Invoice sent", receiptReference: "BANK-1", receiptEvidence: "Payment received" });
    const { record: billedRecord, input: billed } = withBilling(record);
    const completed = { ...source, leads: [{ ...scheduled, archived: true }], actions: [finished, billed.actions.at(-1)!],
      income: [billedRecord] };
    const view = buildLeadDelivery(completed)[0];
    expect(view).toMatchObject({ accepted: true, assigned: true, scheduled: true, completed: true,
      completionSupported: true, overdue: false, reasons: [] });
    expect(view.financial[0]).toMatchObject({ invoiced: true, received: true, earned: false });
    expect(buildCommandAttention(command({ actions: [finished], delivery: completed })).items).toEqual([]);
  });
  it("surfaces missing acceptance on the Won Lead and merges delivery gaps into an existing Action without duplication", () => {
    expect(buildCommandAttention(command({ delivery: input() })).items[0]).toMatchObject({ objectType: "Lead", id: "lead-1" });
    const source = accepted();
    const action = persistedAction({ id: "delivery-1", deliveryLeadId: "lead-1", dueDate: request.promisedBy });
    const result = buildCommandAttention(command({ actions: [action], delivery: { ...source, actions: [action] } }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ objectType: "Action", id: "delivery-1" });
    expect(result.items[0].reasons.join(" ")).toContain("no evidenced schedule");
    expect(result.items[0].reasons).toContain("DUE WITHIN 7 DAYS");
  });
  it("does not weaken urgent ordinary execution when enriching commercial context", () => {
    const source = accepted();
    const action = persistedAction({ id: "delivery-1", deliveryLeadId: "lead-1", status: "Blocked" });
    const baseline = buildCommandAttention(command({ actions: [action] })).items[0];
    const enriched = buildCommandAttention(command({ actions: [action], delivery: { ...source, actions: [action] } })).items[0];
    expect(enriched.attentionRank).toBe(baseline.attentionRank);
    expect(enriched.priorityScore).toBe(baseline.priorityScore);
    expect(enriched.reasons).toEqual(expect.arrayContaining(baseline.reasons));
  });
  it("keeps ambiguous customer attribution on Leads rather than reprioritising an unrelated Action", () => {
    const source = accepted();
    const commitment = source.leads[0].deliveryCommitment;
    if (!commitment) throw new Error("Fixture requires accepted delivery.");
    const action = persistedAction({ deliveryLeadId: "lead-2" });
    const leads = [source.leads[0], { ...source.leads[0], id: "lead-2" }].map((record) => ({
      ...record, deliveryCommitment: { ...commitment, actionId: action.id },
    }));
    const baseline = buildCommandAttention(command({ actions: [action] })).items[0];
    const enriched = buildCommandAttention(command({ actions: [action], delivery: { ...source, leads, actions: [action] } }));
    expect(enriched.items.find((item) => item.objectType === "Action" && item.id === action.id)).toEqual(baseline);
    expect(enriched.items.filter((item) => item.objectType === "Lead")).toHaveLength(2);
  });
  it("detects orphaned Action and Income references using existing navigation", () => {
    const source = input({ leads: [], actions: [persistedAction({ deliveryLeadId: "missing" })],
      income: [income({ relatedLeadId: "missing" })] });
    const result = buildCommandAttention(command({ delivery: source }));
    expect(result.items).toHaveLength(2);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: "Action", navigationMode: "record-handler" }),
      expect.objectContaining({ objectType: "Finance", id: "income:income-1", navigationMode: "record-handler" }),
    ]));
  });
  it("preserves legacy backups and round-trips commitments and evidence in the existing stores", () => {
    const source = accepted();
    const backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date(NOW).toISOString(),
      storage: { [LEAD_STORAGE_KEY]: JSON.stringify(source.leads), [CONVERSION_STORAGE_KEY]: JSON.stringify(source.actions),
        [INCOME_STORAGE_KEY]: JSON.stringify([income({ invoiceReference: "INV-1", invoiceEvidence: "Sent", invoiceIssuedDate: "2026-10-08" })]) } };
    expect(validateEmpireOsBackup(backup).storage).toEqual(backup.storage);
    expect(() => validateEmpireOsBackup({ ...backup, storage: { [LEAD_STORAGE_KEY]: JSON.stringify([lead()]) } })).not.toThrow();
    expect(() => validateEmpireOsBackup({ ...backup, storage: { [LEAD_STORAGE_KEY]: JSON.stringify([lead({ deliveryCommitment: undefined })]) } })).not.toThrow();
  });
  it("rejects malformed nested commitment or financial evidence before restore instead of silently stripping it", () => {
    expect(() => assertLeadDeliveryCommitment(undefined)).not.toThrow();
    expect(() => assertLeadDeliveryCommitment(null)).toThrow("malformed");
    const source = accepted();
    expect(() => assertLeadDeliveryCommitment({ ...source.leads[0].deliveryCommitment, schedules: [{}] })).toThrow("malformed");
    expect(() => assertIncomeCommercialEvidence({ ...income(), receiptEvidence: 42 })).toThrow("malformed");
    expect(() => assertIncomeCommercialEvidence({ ...income(), collectionStatus: "Paid" })).toThrow("collection status");
    expect(() => assertActionFinanceLink(undefined, "Billing")).toThrow("recorded together");
    const backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date(NOW).toISOString(),
      storage: { [LEAD_STORAGE_KEY]: JSON.stringify([{ ...lead(), deliveryCommitment: {} }]) } };
    expect(() => validateEmpireOsBackup(backup)).toThrow("malformed");
    expect(() => validateEmpireOsBackup({ ...backup, storage: {
      [INCOME_STORAGE_KEY]: JSON.stringify([{ ...income(), invoiceReference: [] }]),
    } })).toThrow("malformed");
    expect(() => validateEmpireOsBackup({ ...backup, storage: {
      [CONVERSION_STORAGE_KEY]: JSON.stringify([{ ...persistedAction(), deliveryLeadId: 42 }]),
    } })).toThrow("optional string");
    expect(() => validateEmpireOsBackup({ ...backup, storage: {
      [CONVERSION_STORAGE_KEY]: JSON.stringify([{ ...persistedAction(), financeIncomeId: "income-1" }]),
    } })).toThrow("recorded together");
  });
  it("restores both previous stores if persisting the delivery Action fails after the Lead write", () => {
    const source = accepted();
    const values = new Map([[LEAD_STORAGE_KEY, JSON.stringify([lead()])], [CONVERSION_STORAGE_KEY, "[]"]]);
    const before = [...values.entries()];
    let fail = true;
    const storage = { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); },
      setItem: (key: string, value: string) => {
        if (key === CONVERSION_STORAGE_KEY && fail) { fail = false; throw new Error("Action write failed"); }
        values.set(key, value);
      } };
    expect(() => persistJsonArraysTransaction(storage, [
      { key: LEAD_STORAGE_KEY, records: source.leads }, { key: CONVERSION_STORAGE_KEY, records: source.actions },
    ])).toThrow("Previous storage restored");
    expect([...values.entries()]).toEqual(before);
    persistJsonArraysTransaction(storage, [
      { key: LEAD_STORAGE_KEY, records: source.leads }, { key: CONVERSION_STORAGE_KEY, records: source.actions },
    ]);
    expect(JSON.parse(storage.getItem(LEAD_STORAGE_KEY) || "[]")).toEqual(source.leads);
    expect(JSON.parse(storage.getItem(CONVERSION_STORAGE_KEY) || "[]")).toEqual(source.actions);
  });
});
