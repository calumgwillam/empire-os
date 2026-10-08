import type { LeadRecord } from "./crm";
import { normalizeActionRecord, type ActionRecord } from "./capture-conversions";
import { isValidCalendarDateInput } from "./dates";
import { getDelegationReadinessMissingFields } from "./execution-release";

type Person = { id: string; name: string; status: string };
export type LeadFollowThroughAction = Pick<ActionRecord,
  "id" | "title" | "actionTitle" | "status" | "dueDate" | "relatedLeadId">
  & Partial<Pick<ActionRecord, "owner" | "ownerPersonId" | "completionDate" | "completionEvidence">>;
export type LeadFollowThroughInput = {
  leads: readonly LeadRecord[];
  actions: readonly LeadFollowThroughAction[];
  people: readonly Person[];
  nowMs: number;
};
export type LeadFollowThroughView = {
  leadId: string;
  state: "Invalid" | "Unowned" | "Blocked" | "Overdue" | "Due" | "Missing next step" | "Scheduled";
  nextStepBy?: string;
  activeActionIds: readonly string[];
  completedActionIds: readonly string[];
  ownerPersonId?: string;
  overdue: boolean;
  reasons: readonly string[];
};
const activeStatuses: ReadonlySet<string> = new Set(["Open", "In Progress", "Blocked", "Waiting"]);

export function getLeadFollowThroughDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return NaN;
  if (!isValidCalendarDateInput(value.slice(0, 10))) return NaN;
  return Date.parse(value.length === 10 ? `${value}T23:59:59.999Z` : value);
}

function resolveOwner(owner: string | undefined, ownerPersonId: string | undefined, people: readonly Person[]): Person | undefined {
  if (!ownerPersonId && !owner?.trim()) return undefined;
  const matches = ownerPersonId
    ? people.filter((person) => person.id === ownerPersonId)
    : people.filter((person) => person.name.trim().toLowerCase() === owner?.trim().toLowerCase());
  return matches.length === 1 && matches[0].status === "Active" && matches[0].name.trim() ? matches[0] : undefined;
}

export function buildLeadFollowThrough(input: LeadFollowThroughInput): LeadFollowThroughView[] {
  if (!Number.isFinite(input.nowMs)) throw new Error("Commercial follow-through requires a valid explicit clock.");
  return input.leads.filter((lead) => !lead.archived && !["Won", "Lost"].includes(lead.status)).map((lead) => {
    const reasons: string[] = [];
    const linked = input.actions.filter((action) => action.relatedLeadId === lead.id);
    const active = linked.filter((action) => activeStatuses.has(action.status));
    const completed = linked.filter((action) => action.status === "Completed");
    const owner = resolveOwner(lead.owner, undefined, input.people);
    let invalid = input.leads.filter((entry) => entry.id === lead.id).length !== 1;
    let unowned = !owner;
    if (invalid) reasons.push("COMMERCIAL: Lead identity is ambiguous");
    if (!owner) reasons.push("COMMERCIAL: Lead has no unique active accountable Person");
    if (active.length > 1) {
      invalid = true;
      reasons.push("COMMERCIAL: Multiple active Actions claim the same next step; consolidate or explicitly review them");
    }
    linked.forEach((action) => {
      if (input.actions.filter((entry) => entry.id === action.id).length !== 1) {
        invalid = true;
        reasons.push("COMMERCIAL: Linked Action identity is ambiguous");
      }
      if (activeStatuses.has(action.status)) {
        const actionOwner = resolveOwner(action.owner, action.ownerPersonId, input.people);
        if (!actionOwner) {
          unowned = true;
          reasons.push("COMMERCIAL: Next-step Action has no unique active accountable Person");
        } else if (owner && actionOwner.id !== owner.id) {
          unowned = true;
          reasons.push("COMMERCIAL: Lead and next-step Action owners disagree; review responsibility explicitly");
        }
        if (!Number.isFinite(getLeadFollowThroughDate(action.dueDate))) {
          invalid = true;
          reasons.push("COMMERCIAL: Next-step Action deadline is missing or invalid");
        }
      }
      if (action.status === "Completed" && (!action.completionEvidence?.trim()
        || !Number.isFinite(getLeadFollowThroughDate(action.completionDate ?? ""))
        || getLeadFollowThroughDate(action.completionDate ?? "") > input.nowMs)) {
        invalid = true;
        reasons.push("COMMERCIAL: Completed follow-through Action lacks dated execution evidence");
      }
    });
    const dates = [...(lead.followUpDate ? [lead.followUpDate] : []), ...active.map((action) => action.dueDate)];
    if (lead.followUpDate && !Number.isFinite(getLeadFollowThroughDate(lead.followUpDate))) {
      invalid = true;
      reasons.push("COMMERCIAL: Lead follow-up date is invalid");
    }
    const nextStepBy = dates.filter((date) => Number.isFinite(getLeadFollowThroughDate(date)))
      .sort((a, b) => getLeadFollowThroughDate(a) - getLeadFollowThroughDate(b))[0];
    const blocked = active.some((action) => action.status === "Blocked");
    const deadline = nextStepBy ? getLeadFollowThroughDate(nextStepBy) : NaN;
    if (blocked) reasons.push("COMMERCIAL: Next-step execution is blocked");
    if (!nextStepBy) reasons.push("COMMERCIAL: No dated next step or follow-up review");
    else if (deadline < input.nowMs) reasons.push("COMMERCIAL: Next step or follow-up review is overdue");
    else if (deadline - input.nowMs < 86400000) reasons.push("COMMERCIAL: Next step or follow-up review is due");
    return {
      leadId: lead.id, state: invalid ? "Invalid" : unowned ? "Unowned" : blocked ? "Blocked"
        : !nextStepBy ? "Missing next step" : deadline < input.nowMs ? "Overdue"
          : deadline - input.nowMs < 86400000 ? "Due" : "Scheduled",
      ...(nextStepBy ? { nextStepBy } : {}), ...(owner ? { ownerPersonId: owner.id } : {}),
      activeActionIds: active.map((action) => action.id), completedActionIds: completed.map((action) => action.id),
      overdue: Number.isFinite(deadline) && deadline < input.nowMs,
      reasons: [...new Set(reasons)],
    };
  });
}

export function linkLeadFollowThroughAction(input: LeadFollowThroughInput, leadId: string, action: ActionRecord): ActionRecord {
  if (!Number.isFinite(input.nowMs)) throw new Error("Commercial follow-through requires a valid explicit clock.");
  const leads = input.leads.filter((lead) => lead.id === leadId);
  if (leads.length !== 1 || leads[0].archived || ["Won", "Lost"].includes(leads[0].status)) {
    throw new Error("Select a unique active pipeline Lead; terminal or archived Leads require a separate delivery workflow.");
  }
  if (!activeStatuses.has(action.status)) throw new Error("Link an active follow-through Action, not completed or cancelled execution.");
  const existing = input.actions.filter((entry) => entry.id === action.id);
  if (existing.length !== 1) throw new Error("Selected Action is missing or ambiguous.");
  if (existing[0].status !== action.status || existing[0].relatedLeadId !== action.relatedLeadId
    || existing[0].ownerPersonId !== action.ownerPersonId || existing[0].owner !== action.owner
    || existing[0].dueDate !== action.dueDate) throw new Error("Selected Action changed; reload before linking commercial responsibility.");
  if (action.icarusObservationLinks?.length) throw new Error("Protection-monitoring Actions cannot be repurposed as commercial next-step execution.");
  if (action.deliveryLeadId) throw new Error("Customer delivery Actions cannot be repurposed as sales follow-through.");
  if (action.relatedLeadId && action.relatedLeadId !== leadId) throw new Error("Action is already linked to a different Lead.");
  if (input.actions.some((entry) => entry.relatedLeadId === leadId && entry.id !== action.id && activeStatuses.has(entry.status))) {
    throw new Error("An active next-step Action already exists. Open or review it instead of creating a duplicate.");
  }
  const leadOwner = resolveOwner(leads[0].owner, undefined, input.people);
  const actionOwner = resolveOwner(action.owner, action.ownerPersonId, input.people);
  if (!leadOwner || !actionOwner || leadOwner.id !== actionOwner.id) throw new Error("Lead and Action must resolve to the same unique active accountable Person. Reassign through existing delegation workflows.");
  const due = getLeadFollowThroughDate(action.dueDate);
  if (!Number.isFinite(due)) throw new Error("Record a valid next-step Action deadline.");
  if (leads[0].followUpDate && (!Number.isFinite(getLeadFollowThroughDate(leads[0].followUpDate))
    || due > getLeadFollowThroughDate(leads[0].followUpDate))) throw new Error("Action deadline cannot postpone an existing Lead follow-up obligation.");
  return { ...action, relatedLeadId: leadId };
}

export function createLeadFollowThroughAction(
  input: LeadFollowThroughInput,
  request: { leadId: string; id: string; title: string; description: string; dueDate: string; ownerPersonId: string },
  people: readonly (Person & { role: string; responsibilities: string; authority: string })[],
): ActionRecord {
  if (!Number.isFinite(input.nowMs)) throw new Error("Commercial follow-through requires a valid explicit clock.");
  if (!request.id.trim() || input.actions.some((action) => action.id === request.id)
    || !request.title.trim() || !request.description.trim()) throw new Error("Next-step Action requires a unique identity, explicit title and execution instructions.");
  const owners = people.filter((person) => person.id === request.ownerPersonId && person.status === "Active");
  if (owners.length !== 1 || getDelegationReadinessMissingFields(owners[0]).length) {
    throw new Error("Select a unique active delegation-ready Person; complete their People role, responsibilities and authority first.");
  }
  const leads = input.leads.filter((lead) => lead.id === request.leadId);
  if (leads.length !== 1) throw new Error("Commercial Lead is missing or ambiguous.");
  const timestamp = new Date(input.nowMs).toISOString();
  const action = { ...normalizeActionRecord({
    id: request.id, sourceCaptureId: "", targetType: "Convert to Action", createdAt: timestamp, createdDate: timestamp,
    title: request.title.trim(), originalRawNote: request.description.trim(), actionDescription: request.description.trim(),
    relatedArea: leads[0].relatedPillar, relatedPillar: leads[0].relatedPillar, importance: "Medium", priority: "Medium",
    status: "Open", owner: owners[0].name, dueDate: request.dueDate,
  }), ownerPersonId: owners[0].id };
  return linkLeadFollowThroughAction({ ...input, actions: [...input.actions, action] }, request.leadId, action);
}
