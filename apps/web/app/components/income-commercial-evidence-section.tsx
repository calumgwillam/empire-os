"use client";

import type { LeadRecord } from "../lib/crm";
import type { IncomeRecord } from "../lib/finance";

export default function IncomeCommercialEvidenceSection({ income, leads, onChange, onOpenLead }: {
  income: IncomeRecord; leads: readonly LeadRecord[];
  onChange: (field: keyof IncomeRecord, value: string) => void; onOpenLead: (id: string) => void;
}) {
  const fieldClass = "mt-1 w-full rounded border border-[#cfc8c1] bg-white px-3 py-2 text-[12px]";
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
  </section>;
}
