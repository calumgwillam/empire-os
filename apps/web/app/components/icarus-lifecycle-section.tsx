"use client";

import { useState } from "react";
import type { IcarusAssessmentRecord, IcarusConfirmedRegression, IcarusResolutionScope, IcarusStrategicResolutionReview } from "../lib/icarus";
import {
  deriveIcarusRegressionEvidence,
  deriveIcarusResolutionEligibility,
  recordIcarusConfirmedRegression,
  recordIcarusResolutionReview,
  type IcarusLifecycleAssessmentView,
  type IcarusStrategicLifecycleIndex,
  type IcarusStrategicLifecycleInput,
} from "../lib/icarus-strategic-lifecycle";
import type { IcarusAssurancePersonOption } from "./icarus-assurance-section";

type Props = {
  input: IcarusStrategicLifecycleInput;
  index: IcarusStrategicLifecycleIndex;
  people: readonly IcarusAssurancePersonOption[];
  writable: boolean;
  createId: () => string;
  onChange: (assessments: IcarusAssessmentRecord[]) => void;
};

const field = "mt-1 block w-full rounded border border-[#d3cbc3] bg-white px-2 py-1 text-[12px]";
const button = "mt-2 rounded border border-[#b9aa98] px-3 py-1 text-[12px] disabled:opacity-40";

function LifecycleAssessment({ assessment, view, ...props }: Props & {
  assessment: IcarusAssessmentRecord;
  view: IcarusLifecycleAssessmentView;
}) {
  const [actor, setActor] = useState("");
  const [kind, setKind] = useState<IcarusResolutionScope["kind"]>("Whole assessment");
  const [modeIds, setModeIds] = useState<string[]>([]);
  const [excludedControls, setExcludedControls] = useState<string[]>([]);
  const [rationale, setRationale] = useState("");
  const [nextReviewBy, setNextReviewBy] = useState("");
  const [supersedes, setSupersedes] = useState("");
  const [regressionId, setRegressionId] = useState("");
  const [causeIds, setCauseIds] = useState<string[]>([]);
  const [explanation, setExplanation] = useState<IcarusConfirmedRegression["explanation"]>("Unknown");
  const [error, setError] = useState("");
  const scope: IcarusResolutionScope = {
    kind, failureModeIds: kind === "Whole assessment" ? assessment.failureModes.map((mode) => mode.id).sort() : [...modeIds].sort(),
  };
  const eligibility = deriveIcarusResolutionEligibility(props.input, assessment.id, scope);
  const activePeople = props.people.filter((person) => person.status === "Active");
  const disabled = !props.writable || props.index.hypothetical || !actor || !rationale.trim();
  function commit(operation: () => IcarusAssessmentRecord[]) {
    try {
      const next = operation();
      props.onChange(next);
      setError("");
      setRationale("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to record lifecycle review.");
    }
  }
  function recordReview(outcome: IcarusStrategicResolutionReview["outcome"]) {
    const reviewedAt = new Date().toISOString();
    const input = { ...props.input, nowMs: Date.parse(reviewedAt) };
    const current = deriveIcarusResolutionEligibility(input, assessment.id, scope);
    const record: IcarusStrategicResolutionReview = {
      id: props.createId(), assessmentId: assessment.id, reviewedAt, reviewedByPersonId: actor,
      outcome, scope, rationale: rationale.trim(),
      controlConditions: outcome === "Verified resolved" ? current.controlConditions
        .filter((condition) => !excludedControls.includes(condition.controlId)).map((condition) => ({
          ...condition, evidenceIds: [...condition.evidenceIds],
          requiredDependencies: condition.requiredDependencies.map((reference) => ({ ...reference })),
        })) : [],
      treatmentOutcomeIds: outcome === "Verified resolved" ? [...current.treatmentOutcomeIds] : [],
      causeIds: [...causeIds],
      ...(nextReviewBy ? { nextReviewBy } : {}),
      ...(supersedes ? { supersedesReviewId: supersedes } : {}),
      ...(regressionId ? { resolvesRegressionId: regressionId } : {}),
    };
    commit(() => recordIcarusResolutionReview(input, record));
  }
  function confirm(reviewId: string, ids: readonly string[]) {
    const confirmedAt = new Date().toISOString();
    const input = { ...props.input, nowMs: Date.parse(confirmedAt) };
    const affectedScope: IcarusResolutionScope = { kind: "Failure modes", failureModeIds: [...ids] };
    commit(() => recordIcarusConfirmedRegression(input, {
      id: props.createId(), assessmentId: assessment.id, resolutionReviewId: reviewId,
      confirmedAt, confirmedByPersonId: actor, scope: affectedScope,
      evidenceKeys: [...deriveIcarusRegressionEvidence(input, assessment.id, affectedScope).observationKeys],
      causeIds: [...causeIds], explanation, rationale: rationale.trim(),
    }));
  }
  return <details className="mt-3 rounded border border-[#d3cbc3] bg-white p-3">
    <summary className="text-[12px] font-medium">{assessment.outcome} - administrative status: {assessment.status}</summary>
    <p className="mt-2 text-[11px]">{view.recordedResolution ? "Explicit verified-resolution history recorded; inspect current validity below."
      : view.reviews.some((review) => review.record.outcome === "Verified resolved")
        ? "A recorded verified-resolution claim has invalid references. History is retained; inspect the issues below."
        : "No recorded verified strategic resolution. This does not imply failure or absence of treatment."}</p>
    {view.reviews.map((review) => <div key={review.record.id} className="mt-2 border-t border-[#d3cbc3] pt-2 text-[11px]">
      <p>{review.record.reviewedAt} - {review.record.outcome}; {review.record.scope.kind}: {review.record.scope.failureModeIds.join(", ")}</p>
      <p>Review {review.record.id}; Person {review.record.reviewedByPersonId}. Current validity: {review.validity}.</p>
      <p>{review.record.rationale}</p>
      <p>{review.reasons.join("; ")}</p>
      <p>Next review: {review.record.nextReviewBy || "Not specified"}. Explicit causes (context, not elimination proof): {review.record.causeIds.join(", ") || "None"}.</p>
      {review.record.controlConditions.map((condition) => <p key={`${condition.failureModeId}:${condition.controlId}`}>
        Mode {condition.failureModeId}: control {condition.controlId}, test {condition.testId}, evidence {condition.evidenceIds.join(", ")}.
        {" "}Required dependencies: {condition.requiredDependencies.map((ref) => `${ref.recordType}:${ref.recordId}`).join(", ") || "None declared"}.
      </p>)}
      <p>Treatment occurrences: {review.record.treatmentOutcomeIds.join(", ") || "None required"}.
        {review.record.supersedesReviewId ? ` Supersedes review ${review.record.supersedesReviewId}.` : ""}
        {review.record.resolvesRegressionId ? ` Re-resolves regression ${review.record.resolvesRegressionId}.` : ""}
      </p>
      {review.validity === "Material regression suspected" && review.materialFailureModeIds.length ? <>
        <p>Current material scope: {review.materialFailureModeIds.join(", ")}. Detection is not durable confirmation.</p>
        <button className={button} disabled={disabled} onClick={() => confirm(review.record.id, review.materialFailureModeIds)}>
          Confirm material regression explicitly
        </button>
      </> : null}
    </div>)}
    {view.regressions.map((regression) => <div key={regression.record.id} className="mt-2 text-[11px]">
      <p>Human-confirmed regression {regression.record.id}, {regression.record.confirmedAt}, Person {regression.record.confirmedByPersonId}.
        {" "}Origin: {regression.record.resolutionReviewId}; modes: {regression.record.scope.failureModeIds.join(", ")}.</p>
      <p>Human-recorded explanation: {regression.record.explanation}. {regression.record.rationale}</p>
      <p>{regression.valid ? "Historical confirmation retained." : regression.issues.join("; ")}
        {regression.reResolutionReviewId ? ` Re-resolution review: ${regression.reResolutionReviewId}` : ""}</p>
      <details><summary>Recorded evidence observation references</summary>{regression.record.evidenceKeys.map((key) => <p key={key}>{key}</p>)}</details>
    </div>)}
    <div className="mt-3 space-y-2 border-t border-[#d3cbc3] pt-2 text-[11px]">
      <p>Explicit recording controls. A Person identifies the reviewer, not an authenticated authority role.</p>
      <label>Reviewer / confirmer<select className={field} value={actor} onChange={(event) => setActor(event.target.value)}>
        <option value="">Select active Person</option>{activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>
      <label>Resolution scope<select className={field} value={kind} onChange={(event) => {
        if (event.target.value === "Whole assessment" || event.target.value === "Failure modes") setKind(event.target.value);
      }}><option>Whole assessment</option><option>Failure modes</option></select></label>
      {kind === "Failure modes" ? assessment.failureModes.map((mode) => <label key={mode.id} className="block">
        <input type="checkbox" checked={modeIds.includes(mode.id)} onChange={(event) => setModeIds((current) =>
          event.target.checked ? [...current, mode.id] : current.filter((id) => id !== mode.id))} /> {mode.mechanism} ({mode.id})
      </label>) : null}
      <p>{eligibility.state}. {eligibility.reasons.join("; ")}</p>
      <p>Choose the explicit protection alternatives reviewed for each mode; at least one current effective alternative per mode is required.</p>
      {eligibility.controlConditions.map((condition) => <label key={condition.controlId} className="block">
        <input type="checkbox" checked={!excludedControls.includes(condition.controlId)} onChange={(event) => setExcludedControls((current) =>
          event.target.checked ? current.filter((id) => id !== condition.controlId) : [...current, condition.controlId])} />
        {" "}Mode {condition.failureModeId}: control {condition.controlId}, passed test {condition.testId}
      </label>)}
      <p>Supporting current treatment occurrences: {eligibility.treatmentOutcomeIds.join(", ") || "None required"}.</p>
      <label>Explicitly supersedes review<select className={field} value={supersedes} onChange={(event) => setSupersedes(event.target.value)}>
        <option value="">No supersession</option>{view.reviews.filter((review) => review.record.outcome === "Verified resolved")
          .map((review) => <option key={review.record.id} value={review.record.id}>{review.record.id} - {review.record.scope.kind}</option>)}
      </select></label>
      <label>Explicitly re-resolves regression<select className={field} value={regressionId} onChange={(event) => setRegressionId(event.target.value)}>
        <option value="">Not a re-resolution</option>{view.regressions.filter((regression) => regression.valid && !regression.reResolutionReviewId)
          .map((regression) => <option key={regression.record.id} value={regression.record.id}>{regression.record.id}</option>)}
      </select></label>
      <p>Re-resolution must explicitly supersede its originating review and cover that review&apos;s scope.</p>
      <label>Next strategic resolution review date<input className={field} type="date" value={nextReviewBy} onChange={(event) => setNextReviewBy(event.target.value)} /></label>
      {(assessment.causes ?? []).map((cause) => <label key={cause.id} className="block">
        <input type="checkbox" checked={causeIds.includes(cause.id)} onChange={(event) => setCauseIds((current) =>
          event.target.checked ? [...current, cause.id] : current.filter((id) => id !== cause.id))} /> Explicit cause context: {cause.title} ({cause.id})
      </label>)}
      <label>Regression explanation (human-recorded, never inferred)<select className={field} value={explanation} onChange={(event) => {
        const choice = (["Dependency invalidation", "Barrier failure", "Treatment ineffective", "Cause changed", "Unknown"] as const)
          .find((value) => value === event.target.value);
        if (choice) setExplanation(choice);
      }}>{["Unknown", "Dependency invalidation", "Barrier failure", "Treatment ineffective", "Cause changed"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Review / confirmation rationale<textarea className={field} value={rationale} onChange={(event) => setRationale(event.target.value)}
        placeholder="State what the scoped evidence establishes and the continuing conditions." /></label>
      {error ? <p role="alert" className="text-[#8b3d28]">{error}</p> : null}
      <button className={button} disabled={disabled || eligibility.state !== "Eligible for human review"}
        onClick={() => recordReview("Verified resolved")}>Record human-verified scoped resolution</button>{" "}
      <button className={button} disabled={disabled || !scope.failureModeIds.length}
        onClick={() => recordReview("Not verified")}>Record review - not verified</button>
    </div>
  </details>;
}

export default function IcarusLifecycleSection(props: Props) {
  return <section className="mt-4 rounded-xl border border-[#c9b8a3] bg-[#faf8f5] p-4" aria-label="Verified strategic lifecycle">
    <h2 className="text-[12px] font-semibold">Verified strategic lifecycle and surveillance</h2>
    <p className="mt-1 text-[11px]">Closed is administrative. Verified resolution is an explicit scoped human review, not permanent immunity.
      Surveillance never confirms regression, changes status, or infers cause.</p>
    {props.input.assessments.map((assessment) => {
      const view = props.index.byAssessmentId.get(assessment.id);
      return view ? <LifecycleAssessment key={assessment.id} {...props} assessment={assessment} view={view} /> : null;
    })}
  </section>;
}
