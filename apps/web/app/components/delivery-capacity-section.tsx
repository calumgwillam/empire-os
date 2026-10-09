"use client";

import { useState } from "react";
import type { AvailabilityReview, CapacityPerson, CapacityWorkItem, DeliveryCapacityResult,
  PersonCapacityView, WorkloadAssessment, CapacityScenario } from "../lib/delivery-capacity";

export type WorkloadReviewRequest = Omit<WorkloadAssessment, "recordedAt" | "sourceSnapshot">;
export type AvailabilityReviewRequest = Omit<AvailabilityReview, "recordedAt" | "workloadSnapshot">;
const fieldClass = "mt-1 w-full rounded border border-[#cfc8c1] bg-white px-3 py-2 text-[12px]";
const buttonClass = "mt-2 rounded border border-[#315b45] px-3 py-2 text-[11px] text-[#315b45]";
const quantity = (value: number | null) => value === null ? "Unknown" : `${value.toFixed(2)} h`;

function PersonSelect({ people, value, onChange }: {
  people: readonly CapacityPerson[]; value: string; onChange: (id: string) => void;
}) {
  return <select className={fieldClass} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">Select existing Person</option>
    {people.filter((person) => person.status === "Active").map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
  </select>;
}
export function WorkloadCapacitySection({ work, scenario, people, history, onRecord, onOpen }: {
  work?: CapacityWorkItem; scenario?: CapacityScenario; people: readonly CapacityPerson[]; history?: readonly WorkloadAssessment[];
  onRecord: (request: WorkloadReviewRequest) => void; onOpen: (type: string, id: string) => void;
}) {
  const [personId, setPerson] = useState("");
  const [recordedByPersonId, setReviewer] = useState("");
  const [windowStart, setStart] = useState("");
  const [windowEnd, setEnd] = useState("");
  const [remainingHours, setHours] = useState("");
  const [estimateEvidence, setEstimateEvidence] = useState("");
  const [readinessEvidence, setReadinessEvidence] = useState("");
  const [readinessConfirmed, setReadiness] = useState(false);
  const [dependencyIds, setDependencies] = useState("");
  const [validUntil, setExpiry] = useState("");
  return <section aria-label="Remaining workload and delivery readiness" className="mt-4 rounded-xl border border-[#cfc8c1] p-3 text-[12px]">
    <h4 className="font-semibold">Remaining workload / readiness</h4>
    <p className="mt-2 text-[11px]">Use remaining person-hours, not original total effort or money. This is a dated human estimate, not measured productivity.
      One accountable Person&apos;s hours only: crew work must have separate ordinary Actions for other people, without repeating the same hours.
      Proposed ownership does not assign work. Size delivery on its Lead, not again on the delivery Action.
      No automatic approval, hiring or delegation occurs.</p>
    <p className="mt-2 text-[11px]">Review windows start today or later. Once a window start is in the past, re-review remaining work/availability;
      elapsed hours are never treated as still available or automatically deducted.</p>
    {work ? <>
      <p className="mt-2">{work.commitment} workload; remaining hours: {quantity(work.remainingHours)};
        operational readiness: {work.operationallyReady ? "Recorded evidence current" : "Unknown / gaps"}.</p>
      {work.ownerPersonId ? <button type="button" className={buttonClass} onClick={() => onOpen("Person", work.ownerPersonId!)}>Open actual/proposed Person availability</button> : null}
      {work.reasons.map((reason) => <p key={reason} className="mt-1 text-[11px] text-[#8b3d28]">{reason}</p>)}
      {scenario ? <div className="mt-2"><p>Additional-work scenario: {scenario.state}; remaining covered hours after this job: {quantity(scenario.remainingHoursAfter)}.</p>
        {scenario.reasons.filter((reason) => !work.reasons.includes(reason)).map((reason) =>
          <p key={reason} className="mt-1 text-[11px] text-[#8b3d28]">{reason}</p>)}
        <p className="mt-1 text-[11px]">This is one scenario, not a reservation or guarantee. Multiple pipeline jobs cannot each rely on the same spare hours.
          Confirm timing, resources, price/cost assumptions and scope with the human decision-maker before acceptance.</p></div> : null}
      <details className="mt-3"><summary>Record/review remaining work (save source first)</summary>
        <label className="mt-2 block">Actual or proposed delivery Person<PersonSelect people={people} value={personId} onChange={setPerson} /></label>
        <label className="mt-2 block">Review recorded by<PersonSelect people={people} value={recordedByPersonId} onChange={setReviewer} /></label>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <label>Work window starts<input className={fieldClass} type="date" value={windowStart} onChange={(e) => setStart(e.target.value)} /></label>
          <label>Work window ends<input className={fieldClass} type="date" value={windowEnd} onChange={(e) => setEnd(e.target.value)} /></label>
          <label>Remaining person-hours<input className={fieldClass} value={remainingHours} onChange={(e) => setHours(e.target.value)} /></label>
          <label>Review valid until<input className={fieldClass} type="date" value={validUntil} onChange={(e) => setExpiry(e.target.value)} /></label>
        </div>
        <label className="mt-2 block">Estimate evidence, remaining scope and other crew Actions<textarea className={fieldClass} value={estimateEvidence} onChange={(e) => setEstimateEvidence(e.target.value)} /></label>
        <label className="mt-2 block">Prerequisite Action IDs (comma-separated; optional)<input className={fieldClass} value={dependencyIds} onChange={(e) => setDependencies(e.target.value)} /></label>
        <label className="mt-2 block">Readiness evidence: timing, skills, access, materials, equipment, subcontracting, quality and commercial assumptions<textarea className={fieldClass} value={readinessEvidence} onChange={(e) => setReadinessEvidence(e.target.value)} /></label>
        <label className="mt-2 block"><input type="checkbox" checked={readinessConfirmed} onChange={(e) => setReadiness(e.target.checked)} /> Readiness checked and supported for this scope/window</label>
        <button type="button" className={buttonClass} onClick={() => onRecord({ personId, recordedByPersonId, windowStart, windowEnd,
          remainingHours, estimateEvidence, readinessEvidence, readinessConfirmed, validUntil,
          dependencyActionIds: dependencyIds.split(",").map((id) => id.trim()).filter(Boolean) })}>Record attributed workload review</button>
      </details>
    </> : <p className="mt-2 text-[11px]">No unfinished workload represented here. For linked delivery Actions, open the customer Lead to review delivery hours.</p>}
    {history?.length ? <details className="mt-3"><summary>Workload review history</summary>
      {history.map((review, index) => <p key={index} className="mt-2">{review.recordedAt} / {review.recordedByPersonId}:
        {review.remainingHours} h for {review.personId}, {review.windowStart}–{review.windowEnd}; valid until {review.validUntil}.
        {" "}{review.estimateEvidence}; readiness: {review.readinessConfirmed ? "Claim recorded" : "Unknown"}; {review.readinessEvidence}.
        {review.dependencyActionIds.map((id) => <button type="button" key={id} className="ml-2 underline" onClick={() => onOpen("Action", id)}>Dependency {id}</button>)}</p>)}
    </details> : null}
  </section>;
}
export function PersonAvailabilitySection({ person, view, people, onRecord }: {
  person: CapacityPerson; view?: PersonCapacityView; people: readonly CapacityPerson[];
  onRecord: (request: AvailabilityReviewRequest) => void;
}) {
  const [recordedByPersonId, setReviewer] = useState("");
  const [windowStart, setStart] = useState("");
  const [windowEnd, setEnd] = useState("");
  const [availableHours, setHours] = useState("");
  const [evidence, setEvidence] = useState("");
  const [validUntil, setExpiry] = useState("");
  const [workloadCoverageComplete, setCoverage] = useState(false);
  const [coverageEvidence, setCoverageEvidence] = useState("");
  return <section aria-label="Evidence-backed delivery availability" className="mt-4 rounded-xl border border-[#cfc8c1] p-3 text-[12px]">
    <h4 className="font-semibold">Evidence-backed working availability</h4>
    <p className="mt-2 text-[11px]">Save the Person first. Record total workable person-hours in a specific window, supported by confirmed availability,
      absence, other duties and resource constraints. Do not enter generic assumed weekly hours.
      Deduct untracked routine duties from available hours and explain them. Tracked committed work is subtracted separately, not twice.
      Latest review supersedes prior windows; overlapping windows are never added together.</p>
    {view ? <><p className="mt-2">Window: {view.windowStart || "Unknown"}–{view.windowEnd || "Unknown"};
      available: {quantity(view.availableHours)}; known committed hours: {quantity(view.knownCommittedHours)};
      unknown in-window workload: {view.unknownCommittedCount}; covered spare capacity: {quantity(view.remainingCapacityHours)}.</p>
      {view.reasons.map((reason) => <p key={reason} className="mt-1 text-[11px] text-[#8b3d28]">{reason}</p>)}</> : null}
    <details className="mt-3"><summary>Record availability and competing-workload coverage</summary>
      <label className="mt-2 block">Reviewed by<PersonSelect people={people} value={recordedByPersonId} onChange={setReviewer} /></label>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <label>Window starts<input type="date" className={fieldClass} value={windowStart} onChange={(e) => setStart(e.target.value)} /></label>
        <label>Window ends<input type="date" className={fieldClass} value={windowEnd} onChange={(e) => setEnd(e.target.value)} /></label>
        <label>Genuine available person-hours<input className={fieldClass} value={availableHours} onChange={(e) => setHours(e.target.value)} /></label>
        <label>Review valid until<input type="date" className={fieldClass} value={validUntil} onChange={(e) => setExpiry(e.target.value)} /></label>
      </div>
      <label className="mt-2 block">Availability evidence / constraint basis<textarea className={fieldClass} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></label>
      <label className="mt-2 block">Competing-work coverage: all jobs, Actions, project coordination and untracked duties accounted for<textarea className={fieldClass} value={coverageEvidence} onChange={(e) => setCoverageEvidence(e.target.value)} /></label>
      <label className="mt-2 block"><input type="checkbox" checked={workloadCoverageComplete} onChange={(e) => setCoverage(e.target.checked)} /> Workload coverage reviewed and complete</label>
      <button type="button" className={buttonClass} onClick={() => onRecord({ recordedByPersonId, windowStart, windowEnd,
        availableHours, evidence, validUntil, workloadCoverageComplete, coverageEvidence })}>Record availability review</button>
    </details>
    {person.availabilityReviews?.length ? <details className="mt-3"><summary>Availability evidence history</summary>
      {person.availabilityReviews.map((review, index) => <p key={index} className="mt-2">{review.recordedAt} / {review.recordedByPersonId}:
        {review.availableHours} h, {review.windowStart}–{review.windowEnd}; valid until {review.validUntil}.
        {" "}{review.evidence}; coverage {review.workloadCoverageComplete ? "Claim recorded" : "Unknown"}: {review.coverageEvidence}</p>)}
    </details> : null}
  </section>;
}
export function DeliveryCapacityReport({ result, onOpen, onReviewRisk }: {
  result: DeliveryCapacityResult; onOpen: (type: string, id: string) => void; onReviewRisk: () => void;
}) {
  return <section aria-label="Delivery capacity and growth readiness" className="mt-4 rounded-xl border border-[#cfc8c1] bg-[#f9f7f4] p-4 text-[12px]">
    <h2 className="text-[18px] font-medium">Delivery capacity / scalable growth</h2>
    <p className="mt-2">{result.committedCount} committed workload records; {result.potentialCount} potential customer jobs;
      {result.unownedCommittedCount} committed records without delegation-ready ownership.
      Projects roll up execution Actions, not duplicate hours. Counts are not productivity or capacity measurements.</p>
    <p className="mt-2 text-[11px]">Known hours are recorded remaining-effort estimates. Overcommitment means evidenced planned demand exceeds recorded availability,
      not proven actual productivity. Unknown coverage is not spare capacity. Partially overlapping work windows are unknown—hours are never prorated
      or spread across days automatically. Potential jobs are independent scenarios, not reservations or approved work.</p>
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-[12px]">
      <thead><tr><th className="p-2">Person / founder reliance</th><th className="p-2">Window</th><th className="p-2">Available</th>
        <th className="p-2">Known committed</th><th className="p-2">Unknown demand</th><th className="p-2">Covered remaining</th><th className="p-2">Assessment</th></tr></thead>
      <tbody>{result.people.map((person) => <tr key={person.personId} className="border-t border-[#cfc8c1]">
        <td className="p-2"><button type="button" className="underline" onClick={() => onOpen("Person", person.personId)}>{person.name}</button>{person.founder ? " (Founder)" : ""}</td>
        <td className="p-2">{person.windowStart || "Unknown"}–{person.windowEnd || "Unknown"}</td><td className="p-2">{quantity(person.availableHours)}</td>
        <td className="p-2">{quantity(person.knownCommittedHours)}</td><td className="p-2">{person.unknownCommittedCount}</td>
        <td className="p-2">{quantity(person.remainingCapacityHours)}</td><td className="p-2">{person.plannedOvercommitment ? "Planned overcommitment"
          : person.coverageCurrent ? "Covered window (check execution readiness)" : "Unknown / review required"}</td>
      </tr>)}</tbody>
    </table></div>
    <details className="mt-3"><summary>Committed workload and unresolved constraints</summary>
      {result.work.filter((item) => item.commitment === "Committed").map((item) => <div key={`${item.objectType}:${item.id}`} className="mt-2 border-t border-[#cfc8c1] pt-2">
        <button type="button" className="underline" onClick={() => onOpen(item.objectType, item.id)}>{item.objectType}: {item.title}</button>
        <p>{quantity(item.remainingHours)}; owner: {result.people.find((person) => person.personId === item.ownerPersonId)?.name || "Unassigned / unresolved"}.</p>
        {item.reasons.map((reason) => <p key={reason} className="mt-1 text-[11px] text-[#8b3d28]">{reason}</p>)}
      </div>)}
    </details>
    <details className="mt-3"><summary>Potential workload / additional-job scenarios</summary>
      {result.scenarios.map((scenario) => <div key={scenario.leadId} className="mt-2 border-t border-[#cfc8c1] pt-2">
        <button type="button" className="underline" onClick={() => onOpen("Lead", scenario.leadId)}>
          {result.work.find((item) => item.objectType === "Lead" && item.id === scenario.leadId)?.title || scenario.leadId}</button>
        <p>{scenario.state}; covered hours remaining after this single scenario: {quantity(scenario.remainingHoursAfter)}.</p>
        {scenario.reasons.map((reason) => <p key={reason} className="mt-1 text-[11px] text-[#8b3d28]">{reason}</p>)}
      </div>)}
    </details>
    <p className="mt-3 text-[11px]">Use ordinary Actions and Decisions for dependency resolution, delegation, hiring or capacity expansion.
      Compare the evidence window and costs before deciding; availability does not prove skill, authority, profitability or service quality.
      Review material sustained overcommitment/founder reliance in Icarus using the affected Lead, Action, Project or Person as source evidence.
      No strategic-risk score or causal assessment is inferred.</p>
    <button type="button" className={buttonClass} onClick={onReviewRisk}>Open Icarus for human capacity-risk assessment</button>
  </section>;
}
