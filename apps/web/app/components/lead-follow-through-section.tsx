"use client";

import { useState } from "react";
import type { LeadRecord } from "../lib/crm";
import type { ActionRecord } from "../lib/capture-conversions";
import type { LeadFollowThroughView } from "../lib/lead-follow-through";

type Request =
  | { kind: "Create"; leadId: string; title: string; description: string; dueDate: string; ownerPersonId: string }
  | { kind: "Link"; leadId: string; actionId: string };

export type LeadFollowThroughRequest = Request;

export default function LeadFollowThroughSection({ lead, view, actions, people, writable, onRoute, onOpenAction }: {
  lead: LeadRecord;
  view?: LeadFollowThroughView;
  actions: readonly ActionRecord[];
  people: readonly { id: string; name: string; status: string }[];
  writable: boolean;
  onRoute: (request: Request) => void;
  onOpenAction: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [ownerPersonId, setOwnerPersonId] = useState("");
  const [actionId, setActionId] = useState("");
  const linked = actions.filter((action) => action.relatedLeadId === lead.id);
  const fieldClass = "mt-1 w-full rounded border border-[#cfc8c1] bg-white px-3 py-2 text-[12px]";
  const buttonClass = "rounded border border-[#315b45] px-3 py-2 text-[11px] text-[#315b45] disabled:opacity-40";
  return (
    <section aria-label="Commercial follow-through" className="mt-4 rounded-xl border border-[#cfc8c1] p-3">
      <h4 className="text-[12px] font-semibold">Commercial follow-through</h4>
      <p className="mt-1 text-[12px]">{view ? `${view.state}${view.nextStepBy ? `; next step / review by ${view.nextStepBy}` : ""}`
        : "Terminal or archived Lead: sales follow-through is no longer active."}</p>
      <p className="mt-1 text-[11px]">Completing an Action records work performed, not a sale or customer outcome. Lead status and commercial results require a separate explicit update. On Hold leads still need a dated review.</p>
      {view?.reasons.map((reason) => <p key={reason} className="mt-1 text-[11px] text-[#8b3d28]">{reason}</p>)}
      {linked.map((action) => (
        <button key={action.id} type="button" className={`${buttonClass} mr-2 mt-2`} onClick={() => onOpenAction(action.id)}>
          {action.actionTitle} — {action.status}
        </button>
      ))}
      {view && writable ? (
        <details className="mt-3 text-[11px]">
          <summary>Create or link the next-step Action</summary>
          <p className="mt-2">Save the Lead first. Routing uses persisted ownership and deadlines, not unsaved edits. An existing active next-step Action must be reviewed rather than duplicated.</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <label>Explicit next step<input className={fieldClass} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label>Execution deadline<input type="date" className={fieldClass} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
            <label className="md:col-span-2">Execution instructions<textarea className={fieldClass} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <label>Accountable Person
              <select className={fieldClass} value={ownerPersonId} onChange={(event) => setOwnerPersonId(event.target.value)}>
                <option value="">Select existing Person</option>
                {people.filter((person) => person.status === "Active").map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
            <button type="button" className={buttonClass} disabled={Boolean(view.activeActionIds.length)}
              onClick={() => onRoute({ kind: "Create", leadId: lead.id, title, description, dueDate, ownerPersonId })}>Create next-step Action</button>
            <label>Existing Action
              <select className={fieldClass} value={actionId} onChange={(event) => setActionId(event.target.value)}>
                <option value="">Select active Action</option>
                {actions.filter((action) => ["Open", "In Progress", "Blocked", "Waiting"].includes(action.status)
                  && (!action.relatedLeadId || action.relatedLeadId === lead.id)).map((action) =>
                  <option key={action.id} value={action.id}>{action.actionTitle}</option>)}
              </select>
            </label>
            <button type="button" className={buttonClass} disabled={!actionId}
              onClick={() => onRoute({ kind: "Link", leadId: lead.id, actionId })}>Link existing Action</button>
          </div>
        </details>
      ) : null}
    </section>
  );
}
