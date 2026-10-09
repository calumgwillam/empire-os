import type { LeadRecord } from "./crm";
import { normalizeActionRecord, type ActionRecord } from "./capture-conversions";
import { incomeCollectionStatusOptions, parseFinanceAmountInput, type IncomeRecord } from "./finance";
import { getDelegationReadinessMissingFields } from "./execution-release";
import { getLeadFollowThroughDate } from "./lead-follow-through";

export type DeliveryPerson = {
  id: string; name: string; status: string; role: string; responsibilities: string; authority: string;
};
export type DeliverySchedule = {
  date: string; evidence: string; recordedAt: string; recordedByPersonId: string;
};
export type LeadDeliveryCommitment = {
  actionId: string;
  scope: string;
  acceptedAt: string;
  acceptedByPersonId: string;
  acceptanceEvidence: string;
  assignedPersonId: string;
  promisedBy: string;
  recordedAt: string;
  schedules: DeliverySchedule[];
};
export type DeliveryAction = Pick<ActionRecord, "id" | "status" | "title" | "dueDate">
  & Partial<Pick<ActionRecord, "deliveryLeadId" | "relatedLeadId" | "financeIncomeId" | "financeIncomeRole"
    | "owner" | "ownerPersonId" | "completionDate" | "completionEvidence" | "icarusObservationLinks">>;
export type LeadDeliveryInput = {
  leads: readonly LeadRecord[];
  actions: readonly DeliveryAction[];
  people: readonly DeliveryPerson[];
  income: readonly IncomeRecord[];
  nowMs: number;
};
export type DeliveryFinanceView = {
  incomeId: string;
  amount: number | null;
  status: IncomeRecord["status"];
  earned: boolean;
  invoiced: boolean;
  received: boolean;
  billingOwnerAssigned: boolean;
  billingActionTracked: boolean;
  collectionOwnerAssigned: boolean;
  collectionActionTracked: boolean;
  collectionStatus: "Open" | "Disputed" | "Blocked";
  validationErrors: string[];
  workflowReasons: string[];
  overdue: boolean;
  valid: boolean;
  reasons: string[];
};
export type LeadDeliveryView = {
  leadId: string;
  actionId?: string;
  won: boolean;
  accepted: boolean;
  executionLinked: boolean;
  assigned: boolean;
  scheduled: boolean;
  completed: boolean;
  completionSupported: boolean;
  blocked: boolean;
  overdue: boolean;
  due: boolean;
  financial: DeliveryFinanceView[];
  reasons: string[];
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function assertLeadDeliveryCommitment(value: unknown): asserts value is LeadDeliveryCommitment | undefined {
  if (value === undefined) return;
  if (!object(value) || !["actionId", "scope", "acceptedAt", "acceptedByPersonId", "acceptanceEvidence",
    "assignedPersonId", "promisedBy", "recordedAt"].every((field) => typeof value[field] === "string")
    || !Array.isArray(value.schedules) || !value.schedules.every((entry: unknown) => object(entry)
      && ["date", "evidence", "recordedAt", "recordedByPersonId"].every((field) => typeof entry[field] === "string"))) {
    throw new Error("Lead delivery commitment is malformed; stored delivery accountability must be preserved and reconciled.");
  }
}
const incomeEvidenceFields = ["relatedLeadId", "earnedDate", "earnedEvidence", "invoiceIssuedDate",
  "invoiceReference", "invoiceEvidence", "receiptReference", "receiptEvidence", "billingOwnerPersonId",
  "billingActionId", "paymentDueDate", "collectionOwnerPersonId", "collectionActionId",
  "collectionStatusEvidence"] as const;
export function assertIncomeCommercialEvidence(value: unknown): void {
  if (!object(value) || incomeEvidenceFields.some((field) => value[field] !== undefined && typeof value[field] !== "string")) {
    throw new Error("Income commercial linkage or evidence is malformed; restore was not applied.");
  }
  if (value.collectionStatus !== undefined && !incomeCollectionStatusOptions.some((status) => status === value.collectionStatus)) {
    throw new Error("Income collection status is malformed; restore was not applied.");
  }
}
function requireClock(nowMs: number): void {
  if (!Number.isFinite(nowMs)) throw new Error("Delivery accountability requires a valid explicit clock.");
}
function validEvent(value: string, nowMs: number, after?: string): boolean {
  if (!Number.isFinite(getLeadFollowThroughDate(value))) return false;
  const dateOnly = value.length === 10;
  const event = Date.parse(value);
  const now = dateOnly ? Date.parse(new Date(nowMs).toISOString().slice(0, 10)) : nowMs;
  const start = after ? Date.parse(dateOnly ? after.slice(0, 10) : after) : -Infinity;
  return event <= now && event >= start;
}
function readyOwner(input: LeadDeliveryInput, id: string | undefined): DeliveryPerson | undefined {
  if (!id?.trim()) return undefined;
  const matches = input.people.filter((person) => person.id === id);
  return matches.length === 1 && matches[0].name.trim() && matches[0].status === "Active"
    && getDelegationReadinessMissingFields(matches[0]).length === 0 ? matches[0] : undefined;
}
function knownPerson(input: LeadDeliveryInput, id: string): boolean {
  return Boolean(id.trim()) && input.people.filter((person) => person.id === id).length === 1;
}
export function hasSupportedFinanceActionCompletion(action: DeliveryAction, input: LeadDeliveryInput): boolean {
  return action.status === "Completed" && Boolean(action.completionEvidence?.trim())
    && validEvent(action.completionDate || "", input.nowMs);
}

export function getDeliveryIncomeEvidence(record: IncomeRecord, input: LeadDeliveryInput): DeliveryFinanceView {
  requireClock(input.nowMs);
  const reasons: string[] = [];
  const workflowReasons: string[] = [];
  const amount = parseFinanceAmountInput(record.amount);
  const unique = Boolean(record.id.trim()) && input.income.filter((entry) => entry.id === record.id).length === 1;
  if (!unique) reasons.push("DELIVERY FINANCE: Income identity is missing or duplicated");
  if (amount === null) reasons.push("DELIVERY FINANCE: Income amount is missing or invalid");
  if (record.status !== "Expected" && record.status !== "Received") reasons.push("DELIVERY FINANCE: Income status is invalid");
  const dateValid = Number.isFinite(getLeadFollowThroughDate(record.date));
  if (!dateValid) reasons.push("DELIVERY FINANCE: Income expected or received date is missing or invalid");
  const earned = unique && amount !== null && Boolean(record.earnedEvidence?.trim()) && validEvent(record.earnedDate || "", input.nowMs);
  const invoiceUnique = !record.invoiceReference?.trim() || input.income.filter((entry) =>
    entry.invoiceReference?.trim() === record.invoiceReference?.trim()).length === 1;
  const receiptUnique = !record.receiptReference?.trim() || input.income.filter((entry) =>
    entry.receiptReference?.trim() === record.receiptReference?.trim()).length === 1;
  const invoiced = unique && amount !== null && invoiceUnique && Boolean(record.invoiceReference?.trim()
    && record.invoiceEvidence?.trim()) && validEvent(record.invoiceIssuedDate || "", input.nowMs);
  const received = unique && amount !== null && receiptUnique && record.status === "Received"
    && Boolean(record.receiptReference?.trim() && record.receiptEvidence?.trim()) && validEvent(record.date, input.nowMs);
  const billingPerson = readyOwner(input, record.billingOwnerPersonId);
  const billingOwnerAssigned = Boolean(billingPerson);
  const billingActionMatches = record.billingActionId
    ? input.actions.filter((action) => action.id === record.billingActionId && action.financeIncomeId === record.id
      && action.financeIncomeRole === "Billing")
    : [];
  const billingAction = billingActionMatches.length === 1 ? billingActionMatches[0] : undefined;
  const billingHistoryValid = input.actions.filter((action) => action.financeIncomeId === record.id
    && action.financeIncomeRole === "Billing" && action.id !== record.billingActionId)
    .every((action) => hasSupportedFinanceActionCompletion(action, input));
  const billingActionTracked = Boolean(billingAction && billingPerson
    && billingAction.ownerPersonId === billingPerson.id && !billingAction.relatedLeadId
    && !billingAction.deliveryLeadId && !billingAction.icarusObservationLinks?.length
    && Number.isFinite(getLeadFollowThroughDate(billingAction.dueDate))
    && billingHistoryValid);
  const collectionPerson = readyOwner(input, record.collectionOwnerPersonId);
  const collectionOwnerAssigned = Boolean(collectionPerson);
  const collectionActionMatches = record.collectionActionId
    ? input.actions.filter((action) => action.id === record.collectionActionId && action.financeIncomeId === record.id
      && action.financeIncomeRole === "Collection")
    : [];
  const collectionAction = collectionActionMatches.length === 1 ? collectionActionMatches[0] : undefined;
  const collectionHistoryValid = input.actions.filter((action) => action.financeIncomeId === record.id
    && action.financeIncomeRole === "Collection" && action.id !== record.collectionActionId)
    .every((action) => hasSupportedFinanceActionCompletion(action, input));
  const collectionActionTracked = Boolean(collectionAction && collectionPerson
    && collectionAction.ownerPersonId === collectionPerson.id && !collectionAction.relatedLeadId
    && !collectionAction.deliveryLeadId && !collectionAction.icarusObservationLinks?.length
    && Number.isFinite(getLeadFollowThroughDate(collectionAction.dueDate))
    && collectionHistoryValid);
  const collectionStatus = record.collectionStatus || "Open";
  if ((record.earnedDate || record.earnedEvidence) && !earned) reasons.push("DELIVERY FINANCE: Earned-income claim lacks valid dated evidence");
  if ((record.invoiceIssuedDate || record.invoiceReference || record.invoiceEvidence) && !invoiced) reasons.push("DELIVERY FINANCE: Invoice claim is incomplete, invalid or duplicated");
  if (record.status === "Received" && !received) reasons.push("DELIVERY FINANCE: Recorded receipt lacks unique dated payment evidence");
  if (!receiptUnique) reasons.push("DELIVERY FINANCE: Payment reference is duplicated");
  if (record.status === "Expected" && (record.receiptReference || record.receiptEvidence)) reasons.push("DELIVERY FINANCE: Payment evidence conflicts with Expected status");
  if (record.collectionStatus !== undefined && !incomeCollectionStatusOptions.includes(record.collectionStatus)) {
    reasons.push("DELIVERY FINANCE: Collection status is invalid");
  }
  if (record.billingActionId && !billingActionTracked) reasons.push("DELIVERY FINANCE: Billing Action is missing, duplicated, mismatched or not owned by the billing Person");
  if (record.collectionActionId && !collectionActionTracked) reasons.push("DELIVERY FINANCE: Collection Action is missing, duplicated, mismatched or not owned by the collection Person");
  if (invoiced) {
    if (!billingOwnerAssigned) workflowReasons.push("DELIVERY FINANCE: Invoice has no active delegation-ready billing Person");
    if (!billingActionTracked) workflowReasons.push("DELIVERY FINANCE: Invoice has no uniquely linked billing Action");
    if (billingAction?.status === "Blocked") workflowReasons.push("DELIVERY FINANCE: Billing Action is blocked");
    if (billingAction?.status === "Cancelled") workflowReasons.push("DELIVERY FINANCE: Billing Action was cancelled");
    else if (billingAction && billingAction.status !== "Completed") {
      workflowReasons.push("DELIVERY FINANCE: Billing Action remains open after invoice issue");
    }
    if (billingAction?.status === "Completed"
      && (!billingAction.completionEvidence?.trim() || !validEvent(billingAction.completionDate || "", input.nowMs))) {
      workflowReasons.push("DELIVERY FINANCE: Completed billing Action lacks dated completion evidence");
    }
  }
  const collectionOpen = invoiced && !received;
  if (collectionOpen) {
    if (!Number.isFinite(getLeadFollowThroughDate(record.paymentDueDate || ""))) {
      workflowReasons.push("DELIVERY FINANCE: Invoiced balance has no valid payment deadline");
    }
    if (!collectionOwnerAssigned) workflowReasons.push("DELIVERY FINANCE: Invoiced balance has no active delegation-ready collection owner");
    if (!collectionActionTracked) workflowReasons.push("DELIVERY FINANCE: Invoiced balance has no uniquely linked collection follow-up Action");
    if (collectionStatus === "Disputed" && !record.collectionStatusEvidence?.trim()) {
      workflowReasons.push("DELIVERY FINANCE: Disputed balance has no supporting evidence");
    }
    if (collectionStatus === "Blocked" && !record.collectionStatusEvidence?.trim()) {
      workflowReasons.push("DELIVERY FINANCE: Blocked collection has no supporting evidence");
    }
    if (collectionStatus === "Blocked" && collectionAction?.status !== "Blocked") {
      workflowReasons.push("DELIVERY FINANCE: Blocked collection has no Blocked follow-up Action");
    }
    if (collectionAction?.status === "Blocked" && collectionStatus !== "Blocked") {
      workflowReasons.push("DELIVERY FINANCE: Collection follow-up Action is blocked");
    }
    if (collectionAction?.status === "Cancelled") workflowReasons.push("DELIVERY FINANCE: Collection follow-up Action was cancelled");
    if (collectionStatus === "Disputed") workflowReasons.push("DELIVERY FINANCE: Customer payment is disputed; resolve and evidence the next step");
    else if (collectionStatus === "Blocked") workflowReasons.push("DELIVERY FINANCE: Customer collection is blocked; resolve and evidence the next step");
    else workflowReasons.push("DELIVERY FINANCE: Invoiced customer balance remains unpaid");
  }
  if (collectionOpen && collectionAction?.status === "Completed") {
    workflowReasons.push("DELIVERY FINANCE: Collection Action is complete but payment receipt is not evidenced");
  }
  if (received && collectionAction && collectionAction.status !== "Completed") {
    workflowReasons.push("DELIVERY FINANCE: Close the collection Action with receipt evidence");
  }
  const valid = reasons.length === 0;
  const paymentDeadline = invoiced ? record.paymentDueDate ?? "" : record.date;
  const overdue = (record.status === "Expected" || collectionOpen) && Number.isFinite(getLeadFollowThroughDate(paymentDeadline))
    && getLeadFollowThroughDate(paymentDeadline) < input.nowMs;
  if (overdue) workflowReasons.push("DELIVERY FINANCE: Customer payment is overdue; payment receipt is not established with evidence");
  if (overdue && invoiced) workflowReasons.push("DELIVERY FINANCE: Customer payment deadline is overdue; payment receipt is not established");
  return { incomeId: record.id, amount, status: record.status, earned, invoiced, received,
    billingOwnerAssigned, billingActionTracked, collectionOwnerAssigned, collectionActionTracked, collectionStatus,
    validationErrors: reasons, workflowReasons, overdue, valid, reasons: [...reasons, ...workflowReasons] };
}

export function buildLeadDelivery(input: LeadDeliveryInput): LeadDeliveryView[] {
  requireClock(input.nowMs);
  return input.leads.filter((lead) => lead.status === "Won" || lead.deliveryCommitment).map((lead) => {
    const reasons: string[] = [];
    const commitment = lead.deliveryCommitment;
    const matches = commitment ? input.actions.filter((action) => action.id === commitment.actionId) : [];
    const action = matches.length === 1 ? matches[0] : undefined;
    const identityValid = Boolean(lead.id.trim()) && input.leads.filter((entry) => entry.id === lead.id).length === 1;
    if (!identityValid) reasons.push("DELIVERY: Lead identity is missing or duplicated");
    if (!commitment) reasons.push("DELIVERY: Won Lead has no explicitly accepted delivery commitment");
    const accepted = Boolean(identityValid && commitment && commitment.actionId.trim() && commitment.scope.trim() && commitment.acceptanceEvidence.trim()
      && knownPerson(input, commitment.acceptedByPersonId) && knownPerson(input, commitment.assignedPersonId)
      && validEvent(commitment.acceptedAt, input.nowMs) && validEvent(commitment.recordedAt, input.nowMs, commitment.acceptedAt));
    if (commitment && !accepted) reasons.push("DELIVERY: Acceptance provenance is invalid or incomplete");
    const linked = Boolean(action && action.deliveryLeadId === lead.id && !action.relatedLeadId && !action.icarusObservationLinks?.length
      && input.actions.filter((entry) => entry.deliveryLeadId === lead.id).length === 1
      && input.leads.filter((entry) => entry.deliveryCommitment?.actionId === action.id).length === 1);
    if (commitment && !linked) reasons.push("DELIVERY: Execution linkage is missing, duplicated or conflicting");
    if (action?.relatedLeadId) reasons.push("DELIVERY: Sales follow-through Action conflicts with delivery execution");
    if (action?.icarusObservationLinks?.length) reasons.push("DELIVERY: Protection-monitoring Action conflicts with customer execution");
    if (lead.status !== "Won") reasons.push("DELIVERY: Customer acceptance history conflicts with changed Lead stage; reconcile rather than discard it");
    const owner = action ? readyOwner(input, action.ownerPersonId) : undefined;
    const assigned = Boolean(linked && owner);
    if (commitment && !assigned) reasons.push("DELIVERY: No unique active delegation-ready delivery owner");
    const schedule = commitment?.schedules.at(-1);
    const scheduleHistoryValid = commitment?.schedules.every((entry, index, history) =>
      entry.evidence.trim() && knownPerson(input, entry.recordedByPersonId)
      && validEvent(entry.recordedAt, input.nowMs, index ? history[index - 1].recordedAt : commitment.recordedAt)
      && Number.isFinite(getLeadFollowThroughDate(entry.date))
      && getLeadFollowThroughDate(entry.date) >= Date.parse(commitment.acceptedAt)
      && getLeadFollowThroughDate(entry.date) <= getLeadFollowThroughDate(commitment.promisedBy));
    const scheduleValid = Boolean(schedule && schedule.evidence.trim() && knownPerson(input, schedule.recordedByPersonId)
      && commitment && validEvent(schedule.recordedAt, input.nowMs, commitment.recordedAt)
      && Number.isFinite(getLeadFollowThroughDate(schedule.date))
      && scheduleHistoryValid
      && getLeadFollowThroughDate(schedule.date) <= getLeadFollowThroughDate(commitment.promisedBy));
    const scheduled = Boolean(accepted && linked && scheduleValid);
    if (schedule && !scheduleValid) reasons.push("DELIVERY: Latest recorded schedule is invalid or unsupported");
    const completed = Boolean(linked && action?.status === "Completed");
    const completionSupported = Boolean(accepted && linked && completed && action?.completionEvidence?.trim()
      && commitment && validEvent(action.completionDate || "", input.nowMs, commitment.recordedAt));
    const deadline = commitment ? getLeadFollowThroughDate(commitment.promisedBy) : NaN;
    if (commitment && !Number.isFinite(deadline)) reasons.push("DELIVERY: Customer delivery deadline is missing or invalid");
    if (commitment && Number.isFinite(deadline) && deadline < Date.parse(commitment.acceptedAt)) reasons.push("DELIVERY: Customer deadline precedes acceptance; reconcile the commitment");
    if (action && commitment && (!Number.isFinite(getLeadFollowThroughDate(action.dueDate))
      || getLeadFollowThroughDate(action.dueDate) > deadline)) reasons.push("DELIVERY: Execution deadline is invalid or postpones the customer commitment");
    if (commitment && !scheduled && !completionSupported) reasons.push("DELIVERY: Accepted work has no evidenced schedule");
    if (action?.status === "Completed" && !completionSupported) reasons.push("DELIVERY: Completed Action lacks admissible linked delivery completion evidence");
    if (action?.status === "Cancelled") reasons.push("DELIVERY: Execution cancelled; customer commitment has not been discharged");
    const blocked = Boolean(linked && action?.status === "Blocked");
    if (blocked) reasons.push("DELIVERY: Accountable execution is blocked");
    if (schedule && scheduled && !completionSupported && getLeadFollowThroughDate(schedule.date) < input.nowMs) {
      reasons.push("DELIVERY: Scheduled work date passed without evidenced completion; review execution");
    }
    const overdue = !completionSupported && Number.isFinite(deadline) && deadline < input.nowMs;
    const due = !completionSupported && Number.isFinite(deadline) && deadline >= input.nowMs && deadline - input.nowMs < 86400000;
    if (overdue) reasons.push("DELIVERY: Customer delivery commitment is overdue");
    else if (due) reasons.push("DELIVERY: Customer delivery commitment is due");
    const financial = input.income.filter((record) => record.relatedLeadId === lead.id)
      .map((record) => getDeliveryIncomeEvidence(record, input));
    financial.forEach((record) => reasons.push(...record.reasons));
    if (completionSupported && !financial.length) reasons.push("DELIVERY FINANCE: Completed delivery has no linked financial record; review billing responsibility");
    else if (completionSupported && !financial.some((record) => record.invoiced)) {
      reasons.push("DELIVERY FINANCE: Completed delivery has no evidenced invoice; review billing responsibility");
      if (!financial.some((record) => record.billingOwnerAssigned)) reasons.push("DELIVERY FINANCE: Completed delivery has no billing owner");
      if (!financial.some((record) => record.billingActionTracked)) reasons.push("DELIVERY FINANCE: Completed delivery has no tracked billing Action");
    }
    return { leadId: lead.id, ...(commitment ? { actionId: commitment.actionId } : {}), won: lead.status === "Won",
      accepted, executionLinked: linked, assigned, scheduled, completed, completionSupported, blocked, overdue, due, financial, reasons: [...new Set(reasons)] };
  });
}

export type AcceptLeadDeliveryRequest = {
  leadId: string; actionId: string; scope: string; acceptedAt: string; acceptedByPersonId: string;
  acceptanceEvidence: string; ownerPersonId: string; promisedBy: string;
};
export function acceptLeadDelivery(input: LeadDeliveryInput, request: AcceptLeadDeliveryRequest): { lead: LeadRecord; action: ActionRecord } {
  requireClock(input.nowMs);
  const leads = input.leads.filter((lead) => lead.id === request.leadId);
  if (leads.length !== 1 || leads[0].status !== "Won") throw new Error("Select a unique persisted Won Lead before accepting delivery.");
  if (leads[0].deliveryCommitment || input.actions.some((action) => action.deliveryLeadId === request.leadId)) throw new Error("Delivery responsibility already exists; review its execution rather than duplicate or replace it.");
  const owner = readyOwner(input, request.ownerPersonId);
  if (!owner || !readyOwner(input, request.acceptedByPersonId)) throw new Error("Acceptance attribution and delivery ownership require unique active delegation-ready People.");
  if (!request.scope.trim() || !request.acceptanceEvidence.trim() || !validEvent(request.acceptedAt, input.nowMs)) {
    throw new Error("Record explicit customer scope, acceptance evidence and a valid non-future acceptance date.");
  }
  const deadline = getLeadFollowThroughDate(request.promisedBy);
  if (!Number.isFinite(deadline) || deadline < Date.parse(request.acceptedAt)) throw new Error("Record a valid customer deadline on or after acceptance. Overdue accepted work must remain visible.");
  if (!request.actionId.trim()) throw new Error("Delivery Action identity is required.");
  const matches = input.actions.filter((action) => action.id === request.actionId);
  const timestamp = new Date(input.nowMs).toISOString();
  if (matches.length) throw new Error("Delivery Action identity already exists.");
  const action: ActionRecord = { ...normalizeActionRecord({
    id: request.actionId, sourceCaptureId: "", targetType: "Convert to Action", createdAt: timestamp,
    title: `Delivery: ${leads[0].leadName}`, originalRawNote: request.scope.trim(), actionDescription: request.scope.trim(),
    relatedArea: leads[0].relatedPillar, relatedPillar: leads[0].relatedPillar, importance: "Medium", priority: "Medium",
    status: "Open", owner: owner.name, dueDate: request.promisedBy,
  }), ownerPersonId: owner.id };
  const commitment: LeadDeliveryCommitment = {
    actionId: action.id, scope: request.scope.trim(), acceptedAt: request.acceptedAt,
    acceptedByPersonId: request.acceptedByPersonId, acceptanceEvidence: request.acceptanceEvidence.trim(),
    assignedPersonId: owner.id, promisedBy: request.promisedBy, recordedAt: timestamp, schedules: [],
  };
  return { lead: { ...leads[0], deliveryCommitment: commitment }, action: { ...action, deliveryLeadId: request.leadId } };
}

export function linkLeadDelivery(input: LeadDeliveryInput, request: AcceptLeadDeliveryRequest, action: ActionRecord): { lead: LeadRecord; action: ActionRecord } {
  const matches = input.actions.filter((entry) => entry.id === action.id);
  if (action.id !== request.actionId || matches.length !== 1 || matches[0] !== action) throw new Error("Selected delivery Action is missing, ambiguous or stale.");
  if (!["Open", "In Progress", "Blocked", "Waiting"].includes(action.status) || action.relatedLeadId
    || action.deliveryLeadId || action.icarusObservationLinks?.length) throw new Error("Link a distinct active delivery Action, not sales, monitoring or already committed execution.");
  if (action.ownerPersonId !== request.ownerPersonId) throw new Error("Existing Action owner must match the explicitly selected delivery Person; use established Action delegation first.");
  if (!Number.isFinite(getLeadFollowThroughDate(action.dueDate))
    || getLeadFollowThroughDate(action.dueDate) > getLeadFollowThroughDate(request.promisedBy)) throw new Error("Existing Action deadline cannot postpone the customer commitment.");
  const result = acceptLeadDelivery({ ...input, actions: input.actions.filter((entry) => entry.id !== action.id) }, request);
  return { lead: result.lead, action: { ...action, deliveryLeadId: request.leadId } };
}

export function scheduleLeadDelivery(input: LeadDeliveryInput, leadId: string, schedule: Omit<DeliverySchedule, "recordedAt">): LeadRecord {
  requireClock(input.nowMs);
  const leads = input.leads.filter((lead) => lead.id === leadId);
  const commitment = leads.length === 1 ? leads[0].deliveryCommitment : undefined;
  if (!commitment || !readyOwner(input, schedule.recordedByPersonId) || !schedule.evidence.trim()
    || !Number.isFinite(getLeadFollowThroughDate(schedule.date))
    || getLeadFollowThroughDate(schedule.date) < Date.parse(commitment.acceptedAt)
    || getLeadFollowThroughDate(schedule.date) > getLeadFollowThroughDate(commitment.promisedBy)) throw new Error("Record a valid delivery schedule, evidence and accountable scheduler without extending the customer deadline.");
  const view = buildLeadDelivery(input).find((entry) => entry.leadId === leadId);
  if (!view?.accepted || !view.assigned || view.completed
    || input.actions.find((action) => action.id === commitment.actionId)?.status === "Cancelled") throw new Error("Reconcile acceptance, execution and ownership before recording a schedule for unfinished work.");
  return { ...leads[0], deliveryCommitment: { ...commitment, schedules: [...commitment.schedules,
    { date: schedule.date, recordedByPersonId: schedule.recordedByPersonId,
      evidence: schedule.evidence.trim(), recordedAt: new Date(input.nowMs).toISOString() }] } };
}

export type CreateIncomeWorkflowActionRequest = {
  incomeId: string;
  actionId: string;
  role: "Billing" | "Collection";
  ownerPersonId: string;
  dueDate: string;
  paymentDueDate?: string;
};

export function createIncomeWorkflowAction(
  input: LeadDeliveryInput,
  request: CreateIncomeWorkflowActionRequest,
): { income: IncomeRecord; action: ActionRecord } {
  requireClock(input.nowMs);
  const records = input.income.filter((entry) => entry.id === request.incomeId);
  if (records.length !== 1) throw new Error("Select a unique persisted Income record before routing billing or collection.");
  const income = records[0];
  if (input.actions.some((action) => action.id === request.actionId)) throw new Error("Finance Action identity already exists.");
  const referencedActionId = income[request.role === "Billing" ? "billingActionId" : "collectionActionId"];
  const roleActions = input.actions.filter((action) => action.financeIncomeId === income.id && action.financeIncomeRole === request.role);
  const referencedActions = referencedActionId ? input.actions.filter((action) => action.id === referencedActionId) : [];
  if (referencedActions.length > 1 || referencedActions.some((action) => action.financeIncomeId !== income.id
    || action.financeIncomeRole !== request.role)) {
    throw new Error(`${request.role} Action reference is ambiguous or conflicting; reconcile it before routing another step.`);
  }
  if (roleActions.some((action) => action.id !== referencedActionId && !hasSupportedFinanceActionCompletion(action, input))
    || referencedActions.some((action) => !hasSupportedFinanceActionCompletion(action, input))) {
    throw new Error(`${request.role} Action is still active or lacks completion evidence; finish or reconcile it before routing the next step.`);
  }
  const owner = readyOwner(input, request.ownerPersonId);
  if (!owner) throw new Error(`${request.role} responsibility requires an active delegation-ready Person.`);
  if (!request.actionId.trim() || !Number.isFinite(getLeadFollowThroughDate(request.dueDate))) {
    throw new Error(`Record a valid due date and identity for the ${request.role.toLowerCase()} Action.`);
  }
  if (request.role === "Billing" && getDeliveryIncomeEvidence(income, input).invoiced) {
    throw new Error("Invoice issuance is already evidenced; use collection follow-up rather than creating another billing Action.");
  }
  if (request.role === "Collection") {
    const evidence = getDeliveryIncomeEvidence(income, input);
    if (!evidence.invoiced || evidence.received) {
      throw new Error("Create collection follow-up only for a uniquely evidenced unpaid invoice.");
    }
    if (!Number.isFinite(getLeadFollowThroughDate(request.paymentDueDate || ""))
      || getLeadFollowThroughDate(request.paymentDueDate || "") < getLeadFollowThroughDate(income.invoiceIssuedDate || "")) {
      throw new Error("Record a valid payment deadline on or after invoice issue.");
    }
  }
  const title = request.role === "Billing"
    ? `Prepare and issue invoice: ${income.description}`
    : `Collect customer payment: ${income.description}`;
  const action = {
    ...normalizeActionRecord({
      id: request.actionId,
      sourceCaptureId: "",
      targetType: "Convert to Action",
      createdAt: new Date(input.nowMs).toISOString(),
      title,
      originalRawNote: title,
      actionDescription: title,
      relatedArea: income.area,
      relatedPillar: income.area,
      importance: "Medium",
      priority: "Medium",
      status: "Open",
      owner: owner.name,
      dueDate: request.dueDate,
      financeIncomeId: income.id,
      financeIncomeRole: request.role,
    }),
    ownerPersonId: owner.id,
  };
  const updatedIncome = request.role === "Billing"
    ? { ...income, billingOwnerPersonId: owner.id, billingActionId: action.id }
    : { ...income, collectionOwnerPersonId: owner.id, collectionActionId: action.id,
      paymentDueDate: request.paymentDueDate, collectionStatus: income.collectionStatus || "Open" as const };
  return { income: updatedIncome, action };
}

export function validateDeliveryIncomeSave(record: IncomeRecord, input: LeadDeliveryInput): void {
  requireClock(input.nowMs);
  assertIncomeCommercialEvidence(record);
  if (record.relatedLeadId) {
    const leads = input.leads.filter((lead) => lead.id === record.relatedLeadId);
    if (leads.length !== 1 || !leads[0].deliveryCommitment) throw new Error("Select a unique Lead with an explicit delivery commitment for financial traceability.");
  }
  if (input.income.filter((entry) => entry.id === record.id).length > 1) throw new Error("Income identity is duplicated; reconcile before attaching financial evidence.");
  const view = getDeliveryIncomeEvidence(record, { ...input, income: [...input.income.filter((entry) => entry.id !== record.id), record] });
  const previous = input.income.find((entry) => entry.id === record.id);
  const legacyReceiptUnknown = !record.relatedLeadId && previous?.status === "Received" && record.status === "Received"
    && !previous.receiptReference && !previous.receiptEvidence && !record.receiptReference && !record.receiptEvidence;
  const invalidReasons = view.validationErrors.filter((reason) => !(legacyReceiptUnknown
    && reason === "DELIVERY FINANCE: Recorded receipt lacks unique dated payment evidence"));
  if (invalidReasons.length) throw new Error(invalidReasons.join("; "));
  const previouslyInvoiced = Boolean(previous?.invoiceIssuedDate || previous?.invoiceReference || previous?.invoiceEvidence);
  if (view.invoiced && !previouslyInvoiced
    && (!view.billingOwnerAssigned || !view.billingActionTracked)) {
    throw new Error("Assign an active delegation-ready billing Person and create its linked Action before recording a new invoice.");
  }
}
