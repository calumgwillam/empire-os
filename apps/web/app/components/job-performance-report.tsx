"use client";

import { buildServicePerformance, type JobPerformanceView } from "../lib/job-performance";

export default function JobPerformanceReport({ jobs, unallocatedExpenseCount, onOpenLead }: {
  jobs: readonly JobPerformanceView[];
  unallocatedExpenseCount: number;
  onOpenLead: (id: string) => void;
}) {
  const services = buildServicePerformance(jobs);
  const money = (value: number | null) => value === null ? "Unknown" : `GBP ${value.toFixed(2)}`;
  return <section className="mt-5 rounded-xl border border-[#d3cbc3] bg-[#f9f7f4] p-4" aria-label="Job and service economics">
    <h2 className="text-[18px] font-medium">Job and service economics</h2>
    <p className="mt-2 text-[12px] text-[#5d584f]">Accepted customer jobs only. Quote and final job value are commercial records, not earned revenue.
      Known costs are evidence-supported subtotals, not declarations of completeness. Profitability is unknown until evidenced delivery
      and a current attributed revenue/cost coverage review. Receipts remain separate from contribution.</p>
    <p className="mt-2 text-[12px]">{unallocatedExpenseCount} Expense records have no customer-job attribution.
      They may be shared overhead or unrelated expenses; review them without automatically assigning them to jobs.</p>
    {jobs.length === 0 ? <p className="mt-3 text-[12px]">No accepted customer jobs recorded. No profitability can be inferred.</p> : <>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead><tr><th className="p-2">Customer job</th><th className="p-2">Earned subtotal</th><th className="p-2">Received subtotal</th>
            <th className="p-2">Known direct costs</th><th className="p-2">Reviewed contribution</th><th className="p-2">Profit after allocated costs</th><th className="p-2">Review</th></tr></thead>
          <tbody>{jobs.map((job) => <tr key={job.leadId} className="border-t border-[#d3cbc3]">
            <td className="p-2"><button type="button" className="underline" onClick={() => onOpenLead(job.leadId)}>{job.title}</button></td>
            <td className="p-2">{money(job.earnedSubtotal)}</td><td className="p-2">{money(job.receivedSubtotal)}</td>
            <td className="p-2">{money(job.directCostSubtotal)}</td><td className="p-2">{money(job.contribution)}</td>
            <td className="p-2">{money(job.profitAfterAllocatedCosts)}</td><td className="p-2">{job.reviewCurrent ? "Current" : "Not current"}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <h3 className="mt-4 text-[14px] font-medium">Service economics — reviewed samples, not whole-service profit</h3>
      {services.map((service) => <div key={JSON.stringify([service.area, service.service])} className="mt-2 border-t border-[#d3cbc3] pt-2 text-[12px]">
        <p className="font-medium">{service.area} / {service.service || "Service not recorded"}</p>
        <p>{service.jobCount} jobs; {service.knownContributionCount} known-contribution jobs; {service.unknownContributionCount} unknown.
          Reviewed contribution subtotal: {money(service.contribution)}.
          Profit after allocated costs subtotal: {money(service.profitAfterAllocatedCosts)} ({service.knownProfitCount} reviewed jobs).</p>
      </div>)}
      <p className="mt-3 text-[11px]">Open a job to inspect cost categories, coverage evidence and linked financial records.
        Use existing Actions / Decisions to investigate losses or improve pricing. Do not extrapolate incomplete samples or add contribution to available cash.</p>
    </>}
  </section>;
}
