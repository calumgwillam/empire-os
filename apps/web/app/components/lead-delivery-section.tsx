"use client";

import { useState } from "react";
import type { LeadRecord } from "../lib/crm";
import type { ActionRecord } from "../lib/capture-conversions";
import type { AcceptLeadDeliveryRequest, DeliveryPerson, LeadDeliveryView } from "../lib/lead-delivery";

export type LeadDeliveryRequest =
  | ({ kind: "Create" | "Link" } & Omit<AcceptLeadDeliveryRequest, "actionId"> & { actionId?: string })
  | { kind: "Schedule"; leadId: string; date: string; evidence: string; recordedByPersonId: string };

export default function LeadDeliverySection({ lead, view, actions, people, writable, onRecord, onOpenAction, onOpenIncome, onPrepareIncome }: {
  lead: LeadRecord; view?: LeadDeliveryView; actions: readonly ActionRecord[]; people: readonly DeliveryPerson[];
  writable: boolean; onRecord: (request: LeadDeliveryRequest) => void;
  onOpenAction: (id: string) => void; onOpenIncome: (id: string) => void;
  onPrepareIncome: (leadId: string) => void;
}) {
  const [scope, setScope] = useState("");
  const [acceptedAt, setAcceptedAt] = useState("");
  const [acceptanceEvidence, setAcceptanceEvidence] = useState("");
  const [acceptedByPersonId, setAcceptedByPersonId] = useState("");
  const [ownerPersonId, setOwnerPersonId] = useState("");
  const [promisedBy, setPromisedBy] = useState("");
  const [actionId, setActionId] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleEvidence, setScheduleEvidence] = useState("");
  const [schedulerId, setSchedulerId] = useState("");
  if (!view) return null;
  const fieldClass = "mt-1 w-full rounded border border-[#cfc8c1] bg-white px-3 py-2 text-[12px]";
  const buttonClass = "rounded border border-[#315b45] px-3 py-2 text-[11px] text-[#315b45] disabled:opacity-40";
  const personSelect = (value: string, change: (id: string) => void) => (
    <select className={fieldClass} value={value} onChange={(event) => change(event.target.value)}>
      <option value="">Select existing Person</option>
      {people.filter((person) => person.status === "Active").map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
    </select>
  );
  const record = (kind: "Create" | "Link") => onRecord({ kind, leadId: lead.id, scope, acceptedAt, acceptanceEvidence,
    acceptedByPersonId, ownerPersonId, promisedBy, ...(kind === "Link" ? { actionId } : {}) });
  return (
    <section aria-label="Customer delivery accountability" className="mt-4 rounded-xl border border-[#cfc8c1] p-3 text-[12px]">
      <h4 className="font-semibold">Customer delivery accountability</h4>
      <p className="mt-2">Won: {view.won ? "Recorded" : "No"}; commitment accepted: {view.accepted ? "Evidenced" : "Not established"};
        owner assigned: {view.assigned ? "Accountable" : "Gap"}; work scheduled: {view.scheduled ? "Evidenced" : "Not established"};
        work completed: {view.completed ? "Recorded" : "No"}; completion evidence: {view.completionSupported ? "Supported" : "Not established"}.</p>
      <p className="mt-2 text-[11px]">These are separate facts. Won value is not earned, invoiced or received income. Completion does not establish revenue recognition. Finance evidence is recorded attribution, not independent bank or accounting verification.</p>
      {lead.deliveryCommitment ? <p className="mt-2">Accepted scope: {lead.deliveryCommitment.scope}<br />
        Customer deadline: {lead.deliveryCommitment.promisedBy}<br />
        Acceptance: {lead.deliveryCommitment.acceptedAt} — {lead.deliveryCommitment.acceptanceEvidence}<br />
        Latest schedule: {lead.deliveryCommitment.schedules.at(-1)?.date || "Not recorded"}</p> : null}
      {view.reasons.map((reason) => <p key={reason} className="mt-1 text-[11px] text-[#8b3d28]">{reason}</p>)}
      {view.actionId ? <button type="button" className={`${buttonClass} mt-2`} onClick={() => { if (view.actionId) onOpenAction(view.actionId); }}>Open delivery Action</button> : null}
      {view.financial.map((entry) => <div key={entry.incomeId} className="mt-2 rounded border border-[#cfc8c1] p-2">
        Amount: {entry.amount ?? "Unknown"}; Finance status: {entry.status};
        earned: {entry.earned ? "Dated evidence recorded" : "Not established"};
        invoice issued: {entry.invoiced ? "Dated evidence recorded" : "Not established"};
        payment received: {entry.received ? "Dated evidence recorded" : "Not established"}.
        <button type="button" className={`${buttonClass} ml-2`} onClick={() => onOpenIncome(entry.incomeId)}>Open Income</button>
      </div>)}
      {view.accepted && writable ? <button type="button" className={`${buttonClass} mt-2`}
        onClick={() => onPrepareIncome(lead.id)}>Prepare linked Income draft (no amounts or financial outcomes inferred)</button> : null}
      {writable && view.won && !lead.deliveryCommitment ? <details className="mt-3 text-[11px]">
        <summary>Record customer acceptance and accountable delivery</summary>
        <p className="mt-2">Save the Lead first. This creates a separate delivery Action or links a distinct existing Action. No invoice, payment, completion or schedule is inferred.</p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <label className="md:col-span-2">Accepted customer scope<textarea className={fieldClass} value={scope} onChange={(event) => setScope(event.target.value)} /></label>
          <label>Customer accepted on<input type="date" className={fieldClass} value={acceptedAt} onChange={(event) => setAcceptedAt(event.target.value)} /></label>
          <label>Promised delivery by<input type="date" className={fieldClass} value={promisedBy} onChange={(event) => setPromisedBy(event.target.value)} /></label>
          <label className="md:col-span-2">Acceptance evidence / reference<textarea className={fieldClass} value={acceptanceEvidence} onChange={(event) => setAcceptanceEvidence(event.target.value)} /></label>
          <label>Accepted / recorded by{personSelect(acceptedByPersonId, setAcceptedByPersonId)}</label>
          <label>Accountable delivery Person{personSelect(ownerPersonId, setOwnerPersonId)}</label>
          <button type="button" className={buttonClass} onClick={() => record("Create")}>Accept and create delivery Action</button>
          <label>Distinct existing delivery Action<select className={fieldClass} value={actionId} onChange={(event) => setActionId(event.target.value)}>
            <option value="">Select existing Action</option>
            {actions.filter((action) => ["Open", "In Progress", "Blocked", "Waiting"].includes(action.status)
              && !action.relatedLeadId && !action.deliveryLeadId && !action.icarusObservationLinks?.length)
              .map((action) => <option key={action.id} value={action.id}>{action.actionTitle}</option>)}
          </select></label>
          <button type="button" className={buttonClass} disabled={!actionId} onClick={() => record("Link")}>Accept and link existing Action</button>
        </div>
      </details> : null}
      {writable && view.accepted && !view.completed ? <details className="mt-3 text-[11px]">
        <summary>Record an explicit work schedule</summary>
        <p className="mt-2">Schedules are retained in order. Rescheduling cannot extend the customer deadline.</p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <label>Work scheduled for<input type="date" className={fieldClass} value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} /></label>
          <label>Scheduled by{personSelect(schedulerId, setSchedulerId)}</label>
          <label className="md:col-span-2">Scheduling evidence / arrangements<textarea className={fieldClass} value={scheduleEvidence} onChange={(event) => setScheduleEvidence(event.target.value)} /></label>
          <button type="button" className={buttonClass} onClick={() => onRecord({ kind: "Schedule", leadId: lead.id,
            date: scheduleDate, evidence: scheduleEvidence, recordedByPersonId: schedulerId })}>Record schedule</button>
        </div>
      </details> : null}
    </section>
  );
}
