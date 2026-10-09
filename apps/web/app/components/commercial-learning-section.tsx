"use client";

import { useState } from "react";
import type { LeadRecord } from "../lib/crm";
import type { LessonRecord } from "../lib/capture-conversions";
import { commercialCauseOptions, commercialOutcomeOptions, type CommercialDiagnosis,
  type CommercialLearningInput, type CommercialLearningView, type CommercialApproval, type CommercialEvaluation } from "../lib/commercial-learning";
import type { JobPerformanceView } from "../lib/job-performance";

export type CommercialDiagnosisRequest = Pick<CommercialDiagnosis, "cause" | "attribution" | "evidence" | "expectedDirectCost" | "estimateEvidence" | "changeKind">
  & { ownerPersonId: string; recommendedChange: string };
export type CommercialLessonCommand =
  | { kind: "Approve"; request: Pick<CommercialApproval, "personId" | "authorityEvidence" | "evidence"> }
  | { kind: "Evaluate"; request: Pick<CommercialEvaluation, "personId" | "leadId" | "comparabilityEvidence" | "adoptionEvidence" | "evidence" | "outcome"> }
  | { kind: "Implement"; ownerPersonId: string; dueDate: string }
  | { kind: "PrepareDecision" }
  | { kind: "AssignOwner"; personId: string };
const fieldClass = "mt-1 w-full rounded border border-[#cfc8c1] bg-white px-3 py-2 text-[12px]";
const buttonClass = "mt-2 rounded border border-[#315b45] px-3 py-2 text-[11px] text-[#315b45]";
const money = (value: number | null | undefined) => value === null || value === undefined ? "Unknown" : `GBP ${value.toFixed(2)}`;

export function LeadCommercialLearningSection({ lead, job, views, people, onDiagnose, onOpenLesson }: {
  lead: LeadRecord; job?: JobPerformanceView; views: readonly CommercialLearningView[];
  people: CommercialLearningInput["people"]; onDiagnose: (request: CommercialDiagnosisRequest) => void;
  onOpenLesson: (id: string) => void;
}) {
  const [ownerPersonId, setOwner] = useState("");
  const [cause, setCause] = useState<CommercialDiagnosis["cause"]>("Labour estimation");
  const [attribution, setAttribution] = useState<CommercialDiagnosis["attribution"]>("Hypothesis");
  const [changeKind, setKind] = useState<CommercialDiagnosis["changeKind"]>("Operating");
  const [evidence, setEvidence] = useState("");
  const [expectedDirectCost, setExpected] = useState("");
  const [estimateEvidence, setEstimateEvidence] = useState("");
  const [recommendedChange, setChange] = useState("");
  const relevant = views.filter((view) => view.leadId === lead.id || (!view.archived && lead.serviceRequested.trim()
    && view.area === lead.relatedPillar && view.service.toLowerCase() === lead.serviceRequested.trim().toLowerCase()));
  return <section className="mt-4 rounded-xl border border-[#cfc8c1] p-3 text-[12px]" aria-label="Commercial learning for this job and service">
    <h4 className="font-semibold">Commercial learning / future quote review</h4>
    <p className="mt-2 text-[11px]">Review matching service Lessons before quoting or scheduling. Matching service names suggest relevance,
      not identical scope or proven causation. Proposals never automatically change quotes. Formal approval must be explicitly evidenced
      against a linked Decision and its authority/scope. Check that scope applies to this quote.</p>
    {relevant.length ? relevant.map((view) => <div key={view.lessonId} className="mt-2 border-t border-[#cfc8c1] pt-2">
      <button type="button" className="underline" onClick={() => onOpenLesson(view.lessonId)}>{view.title}</button>
      <p>Diagnosis: {view.diagnosisCurrent ? "Current" : "Stale / unsupported"}; policy approval: {view.approvalCurrent
        ? "Current explicit approval (check scope)" : "Proposal / no current approval"}; outcome: {view.outcome}.</p>
    </div>) : <p className="mt-2 text-[11px]">No matching commercial Lessons. This does not establish that pricing or execution is sound.</p>}
    {job?.reviewCurrent && job.contribution !== null ? <details className="mt-3">
      <summary>Capture evidence-linked diagnosis as an ordinary Lesson</summary>
      <p className="mt-2 text-[11px]">Save the Lead first. Diagnosis preserves this reviewed financial baseline. Expected direct costs
        remain unknown unless you have a genuine original estimate; do not reconstruct an expectation from actuals.
        Supported contribution requires operational evidence explaining the cause, not just a financial correlation.</p>
      <label className="mt-2 block">Diagnosing Person / corrective owner<select className={fieldClass} value={ownerPersonId} onChange={(e) => setOwner(e.target.value)}>
        <option value="">Select Person</option>{people.filter((person) => person.status === "Active").map((person) =>
          <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label className="mt-2 block">Cause category<select className={fieldClass} value={cause}
        onChange={(e) => { const value = commercialCauseOptions.find((option) => option === e.target.value); if (value) setCause(value); }}>
        {commercialCauseOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
      <label className="mt-2 block">Attribution<select className={fieldClass} value={attribution}
        onChange={(e) => setAttribution(e.target.value === "Supported contribution" ? "Supported contribution" : "Hypothesis")}>
        <option>Hypothesis</option><option>Supported contribution</option></select></label>
      <label className="mt-2 block">Diagnosis evidence / causal basis<textarea className={fieldClass} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></label>
      <label className="mt-2 block">Original expected total direct cost (optional)<input className={fieldClass} value={expectedDirectCost} onChange={(e) => setExpected(e.target.value)} /></label>
      <label className="mt-2 block">Original estimate evidence / scope<input className={fieldClass} value={estimateEvidence} onChange={(e) => setEstimateEvidence(e.target.value)} /></label>
      <label className="mt-2 block">Change kind<select className={fieldClass} value={changeKind}
        onChange={(e) => setKind(e.target.value === "Pricing" ? "Pricing" : "Operating")}><option>Operating</option><option>Pricing</option></select></label>
      <label className="mt-2 block">Proposed corrective change / applicability<textarea className={fieldClass} value={recommendedChange} onChange={(e) => setChange(e.target.value)} /></label>
      <button type="button" className={buttonClass} onClick={() => onDiagnose({ ownerPersonId, cause, attribution, evidence,
        expectedDirectCost, estimateEvidence, changeKind, recommendedChange })}>Record commercial Lesson</button>
    </details> : <p className="mt-2 text-[11px]">New supported diagnosis needs evidenced completion and current reviewed contribution. Reconcile unknown economics first.</p>}
  </section>;
}

export function CommercialLessonSection({ lesson, view, input, onCommand, onOpen }: {
  lesson: LessonRecord; view?: CommercialLearningView; input: CommercialLearningInput;
  onCommand: (command: CommercialLessonCommand) => void; onOpen: (type: string, id: string) => void;
}) {
  const [personId, setPerson] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [authorityEvidence, setAuthority] = useState("");
  const [approvalEvidence, setApprovalEvidence] = useState("");
  const [leadId, setLead] = useState("");
  const [comparabilityEvidence, setComparability] = useState("");
  const [adoptionEvidence, setAdoption] = useState("");
  const [evidence, setEvidence] = useState("");
  const [outcome, setOutcome] = useState<CommercialEvaluation["outcome"]>("Unknown");
  const learning = lesson.commercialLearning;
  if (!learning || !view) return null;
  const diagnosis = learning.diagnosis;
  return <section className="mt-4 rounded-xl border border-[#cfc8c1] p-3 text-[12px]" aria-label="Commercial Lesson evidence and outcome">
    <h4 className="font-semibold">Commercial diagnosis → corrective change → observed outcome</h4>
    <button type="button" className="mt-2 underline" onClick={() => onOpen("Lead", diagnosis.leadId)}>Open source customer job</button>
    <p className="mt-2">{diagnosis.area} / {diagnosis.service || "Service unspecified"}; {diagnosis.cause}; {diagnosis.attribution}.
      Recorded {diagnosis.recordedAt} by {diagnosis.recordedByPersonId}.</p>
    <p className="mt-2">{diagnosis.evidence}</p>
    <p className="mt-2">Original expected direct cost: {money(view.expectedDirectCost)}; current supported actual: {money(view.actualDirectCost)};
      variance: {money(view.variance)}. Estimate basis: {diagnosis.estimateEvidence || "Unknown"}.</p>
    <p className="mt-2">Baseline reviewed contribution: {money(view.baseline?.contribution)};
      margin: {view.baseline?.contributionMarginPct?.toFixed(1) ?? "Unknown"}%.
      Diagnosis {view.diagnosisCurrent ? "current" : "stale / unsupported"}.</p>
    <p className="mt-2 font-semibold">{diagnosis.changeKind} change: {view.approvalCurrent ? "Explicit approval current; check recorded scope" : "Proposed / no current approval"}.
      Implementation: {view.implementationComplete ? "Evidence-supported completion" : "Incomplete / unknown"}.
      Observed comparative outcome: {view.outcome}.</p>
    <p className="mt-2 text-[11px]">Save the Lesson before these steps. Link a Decision in the existing Lesson editor and preserve its reasoning,
      evidence, alternatives and assumptions. Decision status alone is not pricing approval. Neither completion nor an Implemented status
      proves adoption or effectiveness. Pricing is never changed automatically.</p>
    {view.reasons.map((reason) => <p key={reason} className="mt-1 text-[11px] text-[#8b3d28]">{reason}</p>)}
    {lesson.relatedDecision ? <button type="button" className={buttonClass} onClick={() => onOpen("Decision", lesson.relatedDecision)}>Open linked Decision</button> : null}
    {!lesson.relatedDecision ? <button type="button" className={buttonClass} onClick={() => onCommand({ kind: "PrepareDecision" })}>Prepare linked Draft Decision (not approval)</button> : null}
    {view.actionIds.map((id) => <button key={id} type="button" className={buttonClass} onClick={() => onOpen("Action", id)}>Open implementation Action {id}</button>)}
    <label className="mt-2 block">Responsible Person for the next step<select className={fieldClass} value={personId} onChange={(e) => setPerson(e.target.value)}>
      <option value="">Select Person</option>{input.people.filter((person) => person.status === "Active").map((person) =>
        <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
    <button type="button" className={buttonClass} onClick={() => onCommand({ kind: "AssignOwner", personId })}>Assign corrective Lesson responsibility to selected Person</button>
    <details className="mt-3"><summary>Create ordinary corrective Action</summary>
      <p className="mt-2 text-[11px]">Prepare/link the Decision before implementation. This creates an explicitly owned Action bound to this exact Lesson proposal;
        changing its required scope means it must be reassessed, not assumed implemented. For pricing, use it to prepare/review a proposal;
        it does not authorize applying a pricing policy.</p>
      <label className="mt-2 block">Implementation deadline<input type="date" className={fieldClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
      <button type="button" className={buttonClass} onClick={() => onCommand({ kind: "Implement", ownerPersonId: personId, dueDate })}>Create linked implementation Action</button>
    </details>
    <details className="mt-3"><summary>Explicit proposal approval against linked Decision</summary>
      <label className="mt-2 block">Authority and applicability / policy scope<textarea className={fieldClass} value={authorityEvidence} onChange={(e) => setAuthority(e.target.value)} /></label>
      <label className="mt-2 block">Approval evidence<textarea className={fieldClass} value={approvalEvidence} onChange={(e) => setApprovalEvidence(e.target.value)} /></label>
      <button type="button" className={buttonClass} onClick={() => onCommand({ kind: "Approve",
        request: { personId, authorityEvidence, evidence: approvalEvidence } })}>Record explicit approval</button>
    </details>
    <details className="mt-3"><summary>Evaluate a subsequent comparable completed job</summary>
      <p className="mt-2 text-[11px]">The job must have the same recorded service/pillar, reviewed contribution and acceptance after corrective implementation
        (and pricing approval where relevant). Explain differences in scale, scope, conditions and cost completeness.
        &quot;Improved&quot; requires a higher reviewed direct contribution margin; this is an observed association, not proof the correction caused it.</p>
      <label className="mt-2 block">Subsequent job<select className={fieldClass} value={leadId} onChange={(e) => setLead(e.target.value)}>
        <option value="">Select job</option>{input.leads.filter((lead) => lead.id !== diagnosis.leadId && lead.deliveryCommitment).map((lead) =>
          <option key={lead.id} value={lead.id}>{lead.leadName}</option>)}</select></label>
      <label className="mt-2 block">Scope / scale comparability and confounders<textarea className={fieldClass} value={comparabilityEvidence} onChange={(e) => setComparability(e.target.value)} /></label>
      <label className="mt-2 block">Actual adoption of corrective change<textarea className={fieldClass} value={adoptionEvidence} onChange={(e) => setAdoption(e.target.value)} /></label>
      <label className="mt-2 block">Observed outcome evidence<textarea className={fieldClass} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></label>
      <label className="mt-2 block">Comparative assessment<select className={fieldClass} value={outcome}
        onChange={(e) => { const value = commercialOutcomeOptions.find((option) => option === e.target.value); if (value) setOutcome(value); }}>
        {commercialOutcomeOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
      <button type="button" className={buttonClass} onClick={() => onCommand({ kind: "Evaluate", request: {
        personId, leadId, comparabilityEvidence, adoptionEvidence, evidence, outcome } })}>Record attributed outcome review</button>
    </details>
    <details className="mt-3"><summary>Approval and evaluation history (retained when stale)</summary>
      {learning.approvals.map((approval, index) => <p key={`approval:${index}`} className="mt-2">
        Approval {approval.recordedAt} / {approval.personId}: {approval.authorityEvidence}; {approval.evidence}</p>)}
      {learning.evaluations.map((evaluation, index) => <p key={`evaluation:${index}`} className="mt-2">
        <button type="button" className="underline" onClick={() => onOpen("Lead", evaluation.leadId)}>Job {evaluation.leadId}</button>
        {" "}{evaluation.recordedAt} / {evaluation.personId}: {evaluation.outcome}; {evaluation.comparabilityEvidence};
        adoption: {evaluation.adoptionEvidence}; {evaluation.evidence}</p>)}
      {!learning.approvals.length && !learning.evaluations.length ? <p className="mt-2">No approvals or outcomes recorded.</p> : null}
    </details>
    {view.subsequent ? <p className="mt-2">Last comparative job: contribution {money(view.subsequent.contribution)};
      margin {view.subsequent.contributionMarginPct?.toFixed(1) ?? "Unknown"}%. {view.evaluationCurrent ? "Current evaluation" : "Historical / unsupported evaluation"}.</p> : null}
  </section>;
}
