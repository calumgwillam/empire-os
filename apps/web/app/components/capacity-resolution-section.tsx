"use client";

import { useState } from "react";
import type { DecisionRecord, ActionRecord } from "../lib/capture-conversions";
import type { CapacityPerson } from "../lib/delivery-capacity";
import { capacityResponseOptions, type CapacityAlternative, type CapacityResponse, type CapacityApproval,
  type CapacityEvaluation, type CapacityResolutionView } from "../lib/capacity-resolution";

export type CapacityResolutionRequest =
  | { kind: "Refresh"; personId: string; evidence: string }
  | { kind: "Revise"; alternatives: CapacityAlternative[]; selectedKind: CapacityResponse | ""; milestoneActionIds: string[] }
  | { kind: "Approve"; approval: Pick<CapacityApproval, "personId" | "authorityEvidence" | "evidence" | "selectionRationale" | "capitalEvidence"> }
  | { kind: "Evaluate"; evaluation: Pick<CapacityEvaluation, "personId" | "validUntil" | "outcome" | "evidence" | "comparabilityEvidence" | "attributionEvidence"> };
const field = "mt-1 w-full rounded border border-[#cfc8c1] bg-white p-2 text-[12px]";
const button = "mt-2 rounded border border-[#315b45] px-3 py-2 text-[11px] text-[#315b45]";
function PeopleSelect({ people, value, onChange }: { people: readonly CapacityPerson[]; value: string; onChange: (value: string) => void }) {
  return <select className={field} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">Choose existing Person</option>{people.filter((person) => person.status === "Active").map((person) =>
      <option key={person.id} value={person.id}>{person.name}</option>)}</select>;
}
export function CapacityDiagnosisForm({ people, onCreate }: {
  people: readonly CapacityPerson[]; onCreate: (personId: string, reviewerId: string, evidence: string) => void;
}) {
  const [personId, setPerson] = useState("");
  const [reviewerId, setReviewer] = useState("");
  const [evidence, setEvidence] = useState("");
  return <details className="mt-4 rounded-xl border border-[#cfc8c1] p-3 text-[12px]">
    <summary>Resolve an existing capacity constraint through a Decision</summary>
    <p className="mt-2">Capture the affected Person&apos;s current constraint. This creates a Draft ordinary Decision, not spending,
      a hire, a subcontract or a new customer promise. Compare all six response types; unknown evidence stays unknown.</p>
    <label className="mt-2 block">Affected Person<PeopleSelect people={people} value={personId} onChange={setPerson} /></label>
    <label className="mt-2 block">Diagnosis recorded by<PeopleSelect people={people} value={reviewerId} onChange={setReviewer} /></label>
    <label className="mt-2 block">Constraint evidence, scope, customer/quality risks and why intervention is needed
      <textarea className={field} value={evidence} onChange={(event) => setEvidence(event.target.value)} /></label>
    <button type="button" className={button} onClick={() => onCreate(personId, reviewerId, evidence)}>Create source-backed Draft Decision</button>
  </details>;
}
export function CapacityResolutionSection({ decision, view, people, actions, onRecord, onOpen, onIcarus }: {
  decision: DecisionRecord; view?: CapacityResolutionView; people: readonly CapacityPerson[]; actions: readonly ActionRecord[];
  onRecord: (request: CapacityResolutionRequest) => void; onOpen: (type: string, id: string) => void; onIcarus: () => void;
}) {
  const resolution = decision.capacityResolution!;
  const [alternatives, setAlternatives] = useState(resolution.alternatives);
  const [dependencyTexts, setDependencyTexts] = useState<Record<string, string>>(
    Object.fromEntries(resolution.alternatives.map((option) => [option.kind, option.dependencyActionIds.join(", ")])));
  const [selectedKind, setSelected] = useState<CapacityResponse | "">(resolution.selectedKind);
  const [milestoneIds, setMilestones] = useState(resolution.milestoneActionIds.join(", "));
  const [reviewerId, setReviewer] = useState("");
  const [authority, setAuthority] = useState("");
  const [approvalEvidence, setApprovalEvidence] = useState("");
  const [selectionRationale, setSelectionRationale] = useState("");
  const [capitalEvidence, setCapitalEvidence] = useState("");
  const [outcome, setOutcome] = useState<CapacityEvaluation["outcome"]>("Unknown");
  const [outcomeEvidence, setOutcomeEvidence] = useState("");
  const [comparability, setComparability] = useState("");
  const [attribution, setAttribution] = useState("");
  const [validUntil, setExpiry] = useState("");
  const [diagnosisEvidence, setDiagnosisEvidence] = useState("");
  const update = (kind: CapacityResponse, changes: Partial<CapacityAlternative>) =>
    setAlternatives((current) => current.map((option) => option.kind === kind ? { ...option, ...changes } : option));
  const proposed = alternatives.map((option) => ({ ...option, dependencyActionIds: dependencyTexts[option.kind].split(",").map((id) => id.trim()).filter(Boolean) }));
  const comparisonDirty = JSON.stringify(proposed) !== JSON.stringify(resolution.alternatives) || selectedKind !== resolution.selectedKind
    || JSON.stringify(milestoneIds.split(",").map((id) => id.trim()).filter(Boolean)) !== JSON.stringify(resolution.milestoneActionIds);
  return <section aria-label="Capacity constraint resolution" className="mt-4 rounded-xl border border-[#cfc8c1] p-3 text-[12px]">
    <h4 className="font-semibold">Capacity constraint: comparison / approval / verification</h4>
    <p className="mt-2">Baseline: {resolution.baseline.windowStart || "Unknown"} to {resolution.baseline.windowEnd || "Unknown"};
      covered shortage: {resolution.baseline.shortfallHours === null ? "Unknown" : `${resolution.baseline.shortfallHours} h`}.
      {" "}{resolution.baseline.evidence}</p>
    <button type="button" disabled={comparisonDirty} className={button} onClick={() => onOpen("Person", resolution.baseline.personId)}>Open affected Person availability</button>
    <p className="mt-2">Approval: {view?.approvalCurrent ? "Current" : "Missing / stale"}; implementation: {view?.implementationComplete ? "Evidenced" : "Incomplete / unknown"};
      verified outcome: {view?.outcome || "Unknown"}.</p>
    {view?.reasons.map((reason) => <p key={reason} className="mt-1 text-[#8b3d28]">{reason}</p>)}
    <p className="mt-2">Save the Decision first. Approved scope binds the exact comparison, cost, authority and milestone ownership.
      Existing Finance approval and capital review remain required for positive costs. Nothing here executes spending, hiring,
      reassignment or rescheduling. Use the established operational records and customer/delegation approval workflows.</p>
    <details className="mt-3"><summary>Compare six alternatives and select a proposed response</summary>
      {alternatives.map((option) => <details key={option.kind} className="mt-2 border-t border-[#cfc8c1] pt-2">
        <summary>{option.kind}: {option.feasibility}; cost {option.cost || "Unknown"}; capacity {option.availableHours || "Unknown"} h</summary>
        <label className="block">Feasibility<select className={field} value={option.feasibility}
          onChange={(event) => update(option.kind, { feasibility: event.target.value === "Feasible" ? "Feasible" : event.target.value === "Not feasible" ? "Not feasible" : "Unknown" })}>
          <option>Unknown</option><option>Feasible</option><option>Not feasible</option></select></label>
        <label className="mt-2 block">Comparison rationale / evidence for feasible, rejected or unresolved option
          <textarea className={field} value={option.rationale} onChange={(event) => update(option.kind, { rationale: event.target.value })} /></label>
        {(["cost", "availableHours", "expectedReliefHours", "commitmentId", "validUntil"] as const).map((key) => <label className="mt-2 block" key={key}>
          {{ cost: "Total cost for stated horizon (blank = unknown; explicit zero requires basis)",
            availableHours: "Confirmed available person-hours in the original window",
            expectedReliefHours: "Expected shortage relief hours (estimate, not achieved benefit)",
            commitmentId: "Existing Finance commitment ID (required for positive cost)",
            validUntil: "Evidence valid until" }[key]}
          <input className={field} type={key === "validUntil" ? "date" : "text"} value={option[key]} onChange={(event) => update(option.kind, { [key]: event.target.value })} /></label>)}
        {(["costEvidence", "availabilityEvidence", "impactEvidence", "dependencyEvidence", "authorityEvidence", "assumptions"] as const).map((key) =>
          <label className="mt-2 block" key={key}>{{ costEvidence: "Cost evidence: full cost/horizon, recurring liabilities and shared cost treatment",
            availabilityEvidence: "Availability evidence: dates, skills, resources and confirmed supplier/People capacity",
            impactEvidence: "Expected impact evidence: delivery, quality, profitability, customer commitments and founder independence",
            dependencyEvidence: "Dependencies evidence (explicitly explain none if none)",
            authorityEvidence: "Required authority: spending, recruitment, subcontracting, reassignment and customer schedule consent",
            assumptions: "Assumptions / unknowns / limitations (never treated as evidence)" }[key]}
            <textarea className={field} value={option[key]} onChange={(event) => update(option.kind, { [key]: event.target.value })} /></label>)}
        <label className="mt-2 block">Prerequisite existing Action IDs, comma-separated<input className={field}
          value={dependencyTexts[option.kind]} onChange={(event) => setDependencyTexts((current) => ({ ...current, [option.kind]: event.target.value }))} /></label>
      </details>)}
      <label className="mt-3 block">Proposed response<select className={field} value={selectedKind}
        onChange={(event) => setSelected(capacityResponseOptions.find((kind) => kind === event.target.value) || "")}>
        <option value="">Not selected</option>{capacityResponseOptions.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
      <p className="mt-2">Use the existing Create linked Action button for each implementation milestone. Ownership, due dates and
        scope stay on those Actions; do not create duplicate tasks here. Dependencies use separate existing Actions.</p>
      <label className="mt-2 block">Implementation milestone Action IDs, comma-separated
        <input className={field} value={milestoneIds} onChange={(event) => setMilestones(event.target.value)} /></label>
      <button type="button" className={button} onClick={() => onRecord({ kind: "Revise", alternatives: proposed, selectedKind,
        milestoneActionIds: milestoneIds.split(",").map((id) => id.trim()).filter(Boolean) })}>Save comparison and proposed scope</button>
    </details>
    <div className="mt-3">{actions.filter((action) => resolution.milestoneActionIds.includes(action.id)).map((action) =>
      <p key={action.id}><button type="button" disabled={comparisonDirty} className="underline" onClick={() => onOpen("Action", action.id)}>{action.actionTitle || action.title}</button>
        : {action.status}; owner {action.owner || "Unknown"}; due {action.dueDate || "Unknown"}</p>)}</div>
    <label className="mt-3 block">Approval/outcome reviewer<PeopleSelect people={people} value={reviewerId} onChange={setReviewer} /></label>
    {!resolution.approvals.length ? <details className="mt-3"><summary>Re-review baseline after adding/planning milestone workload (before first approval)</summary>
      <p className="mt-2">Creating Actions adds real demand and may stale coverage. Size that work and review Person availability first,
        then explicitly refresh this diagnosis. Prior diagnoses remain retained; an approved original constraint cannot be replaced.</p>
      <label className="block">Updated diagnosis evidence<textarea className={field} value={diagnosisEvidence} onChange={(event) => setDiagnosisEvidence(event.target.value)} /></label>
      <button type="button" disabled={comparisonDirty} className={button} onClick={() => onRecord({ kind: "Refresh", personId: reviewerId,
        evidence: diagnosisEvidence })}>Record attributed baseline re-review</button>
    </details> : null}
    {comparisonDirty ? <p className="mt-2 text-[#8b3d28]">Save the changed comparison/milestones before approving or evaluating; only saved scope can be reviewed.</p> : null}
    <details className="mt-3"><summary>Record explicit consequential-intervention approval</summary>
      <label className="block">Authority evidence and scope (including all consequential commitments)
        <textarea className={field} value={authority} onChange={(event) => setAuthority(event.target.value)} /></label>
      <label className="block">Selection rationale versus alternatives<textarea className={field} value={selectionRationale} onChange={(event) => setSelectionRationale(event.target.value)} /></label>
      <label className="block">Explicit approval evidence<textarea className={field} value={approvalEvidence} onChange={(event) => setApprovalEvidence(event.target.value)} /></label>
      <label className="block">Capital affordability evidence (existing approved commitment already included; full horizon and protected cash reviewed)
        <textarea className={field} value={capitalEvidence} onChange={(event) => setCapitalEvidence(event.target.value)} /></label>
      <button type="button" disabled={comparisonDirty} className={button} onClick={() => onRecord({ kind: "Approve", approval: { personId: reviewerId,
        authorityEvidence: authority, selectionRationale, evidence: approvalEvidence, capitalEvidence } })}>Record explicit approval of saved scope</button>
    </details>
    <details className="mt-3"><summary>Review original constraint with fresh post-implementation evidence</summary>
      <p className="mt-2">Completion is not success. Re-review remaining work and Person availability after implementation, for the original window.
        Explain scope changes, displaced workload and other causes. A lower evidenced shortage supports improvement, not proven causation.
        Original obligations must remain ready in that window or have supported discharge; delegation also requires fresh covered receiving capacity.
        Unknown baselines cannot yield verified improvement; elapsed windows require a new Decision for a new operating period.</p>
      <label className="block">Outcome<select className={field} value={outcome} onChange={(event) =>
        setOutcome(event.target.value === "Improved" ? "Improved" : event.target.value === "Not improved" ? "Not improved" : "Unknown")}>
        <option>Unknown</option><option>Improved</option><option>Not improved</option></select></label>
      <label className="block">Fresh evidence / observed results<textarea className={field} value={outcomeEvidence} onChange={(event) => setOutcomeEvidence(event.target.value)} /></label>
      <label className="block">Comparability: original scope/window, quality, customer commitments and displaced obligations<textarea className={field} value={comparability} onChange={(event) => setComparability(event.target.value)} /></label>
      <label className="block">Actual adoption / attributable contribution / competing causes<textarea className={field} value={attribution} onChange={(event) => setAttribution(event.target.value)} /></label>
      <label className="block">Outcome review valid until<input type="date" className={field} value={validUntil} onChange={(event) => setExpiry(event.target.value)} /></label>
      <button type="button" disabled={comparisonDirty} className={button} onClick={() => onRecord({ kind: "Evaluate", evaluation: { personId: reviewerId,
        outcome, evidence: outcomeEvidence, comparabilityEvidence: comparability, attributionEvidence: attribution, validUntil } })}>Record evidence-bound outcome review</button>
    </details>
    <details className="mt-3"><summary>Preserved approval and outcome history</summary>
      {resolution.baselineHistory.map((entry, index) => <p key={`baseline:${index}`}>{entry.recordedAt} / {entry.recordedByPersonId}: prior shortage {entry.shortfallHours ?? "Unknown"} h; {entry.evidence}</p>)}
      {resolution.approvals.map((entry, index) => <p key={`approval:${index}`}>{entry.recordedAt} / {entry.personId}: {entry.evidence}; {entry.authorityEvidence}; {entry.selectionRationale}</p>)}
      {resolution.evaluations.map((entry, index) => <p key={`outcome:${index}`}>{entry.recordedAt} / {entry.personId}: {entry.outcome}; {entry.evidence}; {entry.comparabilityEvidence}; {entry.attributionEvidence}</p>)}
    </details>
    <p className="mt-3">Capture reusable findings using this Decision&apos;s existing linked Lesson workflow. Missing/stale capacity outcomes remain
      unknown in organisational learning. Review sustained strategic exposure using the existing Icarus source-backed process.</p>
    <button type="button" disabled={comparisonDirty} className={button} onClick={onIcarus}>Open Icarus for human strategic-risk review</button>
  </section>;
}
