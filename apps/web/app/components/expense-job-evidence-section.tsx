"use client";

import type { LeadRecord } from "../lib/crm";
import { jobCostTypeOptions, type ExpenseRecord } from "../lib/finance";

export default function ExpenseJobEvidenceSection({ expense, leads, onChange, onOpenLead }: {
  expense: ExpenseRecord;
  leads: readonly LeadRecord[];
  onChange: (field: keyof ExpenseRecord, value: string) => void;
  onOpenLead: (id: string) => void;
}) {
  const fieldClass = "mt-1 w-full rounded border border-[#cfc8c1] bg-white px-3 py-2 text-[12px]";
  return <section aria-label="Job cost evidence" className="mt-4 rounded-xl border border-[#cfc8c1] p-3 text-[12px]">
    <h4 className="font-semibold">Job cost evidence</h4>
    <p className="mt-2 text-[11px]">Attribute this existing Expense once to an accepted job. The full Expense amount belongs to that job.
      Do not duplicate or split a shared expense into copied records. Partial multi-job allocation is not supported.
      Direct incurred costs and allocated overhead are separate; Planned/Paid are cash states, not proof of consumption.</p>
    <label className="mt-2 block">Customer job<select className={fieldClass} value={expense.relatedLeadId || ""}
      onChange={(event) => onChange("relatedLeadId", event.target.value)}>
      <option value="">Not allocated (legacy / shared / other expense)</option>
      {expense.relatedLeadId && !leads.some((lead) => lead.id === expense.relatedLeadId && lead.deliveryCommitment)
        ? <option value={expense.relatedLeadId}>Missing job: {expense.relatedLeadId}</option> : null}
      {leads.filter((lead) => lead.deliveryCommitment).map((lead) => <option key={lead.id} value={lead.id}>{lead.leadName}</option>)}
    </select></label>
    {expense.relatedLeadId ? <>
      <button type="button" className="mt-2 underline" onClick={() => { if (expense.relatedLeadId) onOpenLead(expense.relatedLeadId); }}>Open customer job</button>
      <label className="mt-2 block">Cost treatment<select className={fieldClass} value={expense.jobCostType || ""}
        onChange={(event) => onChange("jobCostType", event.target.value)}>
        <option value="">Not established</option>
        {jobCostTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
      </select></label>
      {([
        ["costReference", "Unique cost / source transaction reference", "text"],
        ["incurredDate", "Cost incurred on", "date"],
        ["incurredEvidence", "Incurred-cost evidence / basis (e.g. labour costing or materials consumed)", "text"],
        ["allocationBasis", "Shared overhead allocation basis (required for allocated overhead)", "text"],
      ] as const).map(([field, label, type]) => <label key={field} className="mt-2 block">{label}<input className={fieldClass}
        type={type} value={expense[field] || ""} onChange={(event) => onChange(field, event.target.value)} /></label>)}
    </> : null}
  </section>;
}
