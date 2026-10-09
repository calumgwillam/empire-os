"use client";

import { useState } from "react";
import type { LeadRecord } from "../lib/crm";
import type { DeliveryPerson } from "../lib/lead-delivery";
import type { JobFinancialReview, JobPerformanceView } from "../lib/job-performance";

export default function JobPerformanceSection({ lead, view, people, writable, onReview, onOpenIncome, onOpenExpense, onPrepareExpense }: {
  lead: LeadRecord;
  view?: JobPerformanceView;
  people: readonly DeliveryPerson[];
  writable: boolean;
  onReview: (request: Omit<JobFinancialReview, "reviewedAt" | "financialSnapshot">) => void;
  onOpenIncome: (id: string) => void;
  onOpenExpense: (id: string) => void;
  onPrepareExpense: (leadId: string) => void;
}) {
  const [reviewedByPersonId, setReviewer] = useState("");
  const [evidence, setEvidence] = useState("");
  const [revenueComplete, setRevenueComplete] = useState(false);
  const [directCostsComplete, setDirectCostsComplete] = useState(false);
  const [overheadCostsComplete, setOverheadCostsComplete] = useState(false);
  if (!view) return null;
  const money = (value: number | null) => value === null ? "Unknown" : `GBP ${value.toFixed(2)}`;
  const fieldClass = "mt-1 w-full rounded border border-[#cfc8c1] bg-white px-3 py-2 text-[12px]";
  const buttonClass = "mt-2 rounded border border-[#315b45] px-3 py-2 text-[11px] text-[#315b45] disabled:opacity-40";
  return <section aria-label="Job financial performance" className="mt-4 rounded-xl border border-[#cfc8c1] p-3 text-[12px]">
    <h4 className="font-semibold">Job financial performance</h4>
    <p className="mt-2">Quote: {money(view.quotedValue)}; recorded final job value (not earned revenue): {money(view.finalJobValue)}.</p>
    <p className="mt-2">Evidence-supported earned subtotal: {money(view.earnedSubtotal)}; receipts: {money(view.receivedSubtotal)}.</p>
    <p className="mt-2">Known direct costs: {money(view.directCostSubtotal)}; known allocated overhead: {money(view.overheadCostSubtotal)}.</p>
    <p className="mt-2 font-semibold">Reviewed contribution before overheads: {money(view.contribution)};
      margin: {view.contributionMarginPct === null ? "Unknown" : `${view.contributionMarginPct.toFixed(1)}%`};
      profit after allocated costs: {money(view.profitAfterAllocatedCosts)}.</p>
    <p className="mt-2 text-[11px]">These are recorded-evidence calculations, not audited accounts or tax profit.
      Paid does not establish an incurred job cost; receipts do not establish earned revenue.
      Missing costs are not zero. A zero subtotal alone does not confirm complete cost coverage.
      Only a current attributed review can establish coverage, including genuine zero-cost categories.</p>
    {view.directCostsByCategory.filter((entry) => entry.amount !== 0).map((entry) =>
      <p key={entry.category} className="mt-1">{entry.category}: {money(entry.amount)}</p>)}
    {view.reasons.map((reason) => <p key={reason} className="mt-1 text-[11px] text-[#8b3d28]">{reason}</p>)}
    <p className="mt-2">Coverage review: {view.reviewCurrent ? "Current" : lead.jobFinancialReview ? "Stale / unsupported" : "Not recorded"}.</p>
    {lead.jobFinancialReview ? <p className="mt-1 text-[11px]">{lead.jobFinancialReview.reviewedAt}: {lead.jobFinancialReview.evidence}</p> : null}
    <div className="mt-2 flex flex-wrap gap-2">
      {view.incomeIds.map((id) => <button key={id} type="button" className={buttonClass} onClick={() => onOpenIncome(id)}>Open Income {id}</button>)}
      {view.expenseIds.map((id) => <button key={id} type="button" className={buttonClass} onClick={() => onOpenExpense(id)}>Open Expense {id}</button>)}
      {writable ? <button type="button" className={buttonClass} onClick={() => onPrepareExpense(lead.id)}>Prepare linked Expense draft</button> : null}
    </div>
    {writable && view.completionSupported ? <details className="mt-3">
      <summary>Review financial coverage</summary>
      <p className="mt-2 text-[11px]">Save the Lead first. Review all revenue and costs, including labour, materials and consumables,
        fuel/transport, equipment and subcontracting. Record the basis for any categories with no costs.
        Changes to linked records invalidate this review. Review is a completeness assertion, not substitute financial evidence.</p>
      <label className="mt-2 block">Reviewed by<select className={fieldClass} value={reviewedByPersonId} onChange={(event) => setReviewer(event.target.value)}>
        <option value="">Select existing Person</option>
        {people.filter((person) => person.status === "Active").map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>
      <label className="mt-2 block">Coverage evidence / basis<textarea className={fieldClass} value={evidence} onChange={(event) => setEvidence(event.target.value)} /></label>
      <label className="mt-2 block"><input type="checkbox" checked={revenueComplete} onChange={(event) => setRevenueComplete(event.target.checked)} /> All earned job revenue is represented</label>
      <label className="mt-2 block"><input type="checkbox" checked={directCostsComplete} onChange={(event) => setDirectCostsComplete(event.target.checked)} /> All direct-cost categories reviewed and complete</label>
      <label className="mt-2 block"><input type="checkbox" checked={overheadCostsComplete} onChange={(event) => setOverheadCostsComplete(event.target.checked)} /> All appropriate shared overheads allocated with a recorded basis</label>
      <button type="button" className={buttonClass} onClick={() => onReview({ reviewedByPersonId, evidence,
        revenueComplete, directCostsComplete, overheadCostsComplete })}>Record coverage review</button>
    </details> : null}
    <p className="mt-2 text-[11px]">Use ordinary Actions and Decisions to investigate loss-making work, revise pricing or improve execution; do not infer service profitability from incomplete jobs.</p>
  </section>;
}
