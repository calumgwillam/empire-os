"use client";

import { useState } from "react";
import type { LeadRecord } from "../lib/crm";
import { incomeCollectionStatusOptions, type IncomeRecord } from "../lib/finance";
import type { ActionRecord } from "../lib/capture-conversions";
import type { DeliveryFinanceView, DeliveryPerson } from "../lib/lead-delivery";

export default function IncomeCommercialEvidenceSection({ income, leads, people, actions, evidence, onChange, onOpenLead, onOpenAction, onCreateAction }: {
  income: IncomeRecord; leads: readonly LeadRecord[];
  people: readonly DeliveryPerson[]; actions: readonly ActionRecord[];
  evidence?: DeliveryFinanceView;
  onChange: (field: keyof IncomeRecord, value: string) => void; onOpenLead: (id: string) => void;
  onOpenAction: (id: string) => void;
  onCreateAction: (request: { role: "Billing" | "Collection"; ownerPersonId: string; dueDate: string; paymentDueDate?: string }) => void;
}) {
  const [billingDueDate, setBillingDueDate] = useState("");
  const [collectionActionDueDate, setCollectionActionDueDate] = useState("");
  const fieldClass = "mt-1 w-full rounded border border-[#cfc8c1] bg-white px-3 py-2 text-[12px]";
  const buttonClass = "mt-2 rounded border border-[#315b45] px-3 py-2 text-[11px] text-[#315b45]";
  const personSelect = (value: string, field: "billingOwnerPersonId" | "collectionOwnerPersonId", label: string) => (
    <label>{label}<select className={fieldClass} value={value} onChange={(event) => onChange(field, event.target.value)}>
      <option value="">Unassigned</option>
      {value && !people.some((person) => person.id === value && person.status === "Active")
        ? <option value={value}>Unresolved / inactive Person ({value})</option> : null}
      {people.filter((person) => person.status === "Active").map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
    </select></label>
  );
  const billingAction = actions.find((action) => action.id === income.billingActionId)
    || actions.find((action) => action.financeIncomeId === income.id && action.financeIncomeRole === "Billing");
  const collectionAction = actions.find((action) => action.id === income.collectionActionId)
    || actions.find((action) => action.financeIncomeId === income.id && action.financeIncomeRole === "Collection");
  const fields = [
    ["earnedDate", "Earned on (explicit recognition date)", "date"],
    ["earnedEvidence", "Earned-income evidence / recognition basis", "text"],
    ["invoiceIssuedDate", "Invoice issued on", "date"],
    ["invoiceReference", "Unique invoice reference", "text"],
    ["invoiceEvidence", "Invoice issue evidence", "text"],
    ["receiptReference", "Unique payment receipt / bank reference", "text"],
    ["receiptEvidence", "Payment receipt evidence", "text"],
  ] as const;
  return <section aria-label="Commercial financial evidence" className="mt-4 rounded-xl border border-[#cfc8c1] p-3 text-[12px]">
    <h4 className="font-semibold">Commercial financial evidence</h4>
    <p className="mt-2 text-[11px]">Link existing Income to an accepted customer commitment. Expected, earned, invoiced and received are independent. For Received income, the main Date is the actual receipt date. Do not use a quotation or completed Action as payment evidence. Leave unknown stages blank. This is evidence traceability, not an invoice or accounting ledger.</p>
    <p className="mt-2 text-[11px]">Recorded status: {income.status}; earned: {evidence?.earned ? "evidence recorded" : "not established"};
      invoice: {evidence?.invoiced ? "evidence recorded" : "not established"};
      receipt: {evidence?.received ? "evidence recorded" : "not established"}.
      Collection: {evidence?.received ? "closed by dated receipt evidence" : evidence?.invoiced
        ? income.collectionStatus || "Open" : "not yet invoiced"}.
      {evidence?.overdue ? " Payment deadline is overdue." : ""}
    </p>
    {evidence?.reasons.map((reason) => <p key={reason} className="mt-1 text-[11px] text-[#8b3d28]">{reason}</p>)}
    <label className="mt-2 block">Customer delivery Lead<select className={fieldClass} value={income.relatedLeadId || ""}
      onChange={(event) => onChange("relatedLeadId", event.target.value)}>
      <option value="">Not linked (legacy / other income)</option>
      {income.relatedLeadId && !leads.some((lead) => lead.id === income.relatedLeadId && lead.deliveryCommitment)
        ? <option value={income.relatedLeadId}>Missing commitment: {income.relatedLeadId}</option> : null}
      {leads.filter((lead) => lead.deliveryCommitment).map((lead) => <option key={lead.id} value={lead.id}>{lead.leadName}</option>)}
    </select></label>
    {income.relatedLeadId ? <button type="button" className="mt-2 underline" onClick={() => { if (income.relatedLeadId) onOpenLead(income.relatedLeadId); }}>Open delivery Lead</button> : null}
    <div className="mt-2 grid gap-2 md:grid-cols-2">
      {fields.map(([field, label, type]) => <label key={field}>{label}<input className={fieldClass} type={type}
        value={income[field] || ""} onChange={(event) => onChange(field, event.target.value)} /></label>)}
    </div>
    <div className="mt-4 grid gap-2 md:grid-cols-2">
      <h5 className="font-semibold md:col-span-2">Billing responsibility</h5>
      {personSelect(income.billingOwnerPersonId || "", "billingOwnerPersonId", "Accountable billing Person")}
      <div>
        <span>Invoice preparation Action</span>
        {billingAction ? <button type="button" className="mt-1 block underline" onClick={() => onOpenAction(billingAction.id)}>
          {billingAction.actionTitle} ({billingAction.status})
        </button> : <p className="mt-1">No linked billing Action</p>}
        {billingAction && income.billingActionId !== billingAction.id ? <button type="button" className="mt-1 underline"
          onClick={() => onChange("billingActionId", billingAction.id)}>Link this existing Action</button> : null}
        <label className="mt-2 block">Action due date<input type="date" className={fieldClass} value={billingDueDate} onChange={(event) => setBillingDueDate(event.target.value)} /></label>
        <button type="button" className={buttonClass} disabled={!income.billingOwnerPersonId
          || Boolean(billingAction && billingAction.status !== "Completed") || Boolean(evidence?.invoiced)}
          onClick={() => onCreateAction({ role: "Billing", ownerPersonId: income.billingOwnerPersonId || "", dueDate: billingDueDate })}>
          Create billing Action
        </button>
      </div>
      <h5 className="font-semibold md:col-span-2">Collection accountability</h5>
      <label>Payment deadline<input type="date" className={fieldClass} value={income.paymentDueDate || ""}
        onChange={(event) => onChange("paymentDueDate", event.target.value)} /></label>
      {personSelect(income.collectionOwnerPersonId || "", "collectionOwnerPersonId", "Accountable collection Person")}
      <label>Collection status<select className={fieldClass} value={income.collectionStatus || "Open"}
        onChange={(event) => onChange("collectionStatus", event.target.value)}>
        {incomeCollectionStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
      </select></label>
      <label>Dispute / blockage evidence<textarea className={fieldClass} value={income.collectionStatusEvidence || ""}
        onChange={(event) => onChange("collectionStatusEvidence", event.target.value)} /></label>
      <div className="md:col-span-2">
        {collectionAction ? <button type="button" className="underline" onClick={() => onOpenAction(collectionAction.id)}>
          Open collection Action: {collectionAction.actionTitle} ({collectionAction.status})
        </button> : <p>No linked collection follow-up Action</p>}
        {collectionAction && income.collectionActionId !== collectionAction.id ? <button type="button" className="mt-1 block underline"
          onClick={() => onChange("collectionActionId", collectionAction.id)}>Link this existing Action</button> : null}
        <label className="mt-2 block">Next follow-up Action due<input type="date" className={fieldClass} value={collectionActionDueDate}
          onChange={(event) => setCollectionActionDueDate(event.target.value)} /></label>
        <button type="button" className={buttonClass} disabled={!income.collectionOwnerPersonId
          || Boolean(collectionAction && collectionAction.status !== "Completed") || Boolean(evidence?.received)}
          onClick={() => onCreateAction({ role: "Collection", ownerPersonId: income.collectionOwnerPersonId || "",
            dueDate: collectionActionDueDate, paymentDueDate: income.paymentDueDate })}>
          Create collection follow-up Action
        </button>
      </div>
      <p className="text-[11px] md:col-span-2">Save Income before routing a tracked Action. Collection status and references are recorded evidence, not external accounting or bank verification. A Received status closes collection only when dated receipt evidence is present.</p>
    </div>
  </section>;
}
