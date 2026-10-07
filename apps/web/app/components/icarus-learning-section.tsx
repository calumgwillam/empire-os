"use client";

import { useState } from "react";
import { getIcarusReferenceKey } from "../lib/icarus";
import {
  getIcarusLearningEvidenceOptions, recordIcarusLearningReview, recordIcarusInstitutionalisationReview,
  type IcarusLearningInput, type IcarusLearningIndex, type IcarusLessonLearning,
  type IcarusLearningReview, type IcarusInstitutionalisationReview,
} from "../lib/icarus-learning";

type Props = {
  input: IcarusLearningInput;
  index: IcarusLearningIndex;
  writable: boolean;
  createId: () => string;
  onChange: (lessonId: string, history: IcarusLessonLearning) => void;
  onOpenRecord: (type: string, id: string) => void;
};
const field = "mt-1 block w-full rounded border border-[#d3cbc3] bg-white px-2 py-1 text-[12px]";
const button = "mt-2 rounded border border-[#b9aa98] px-3 py-1 text-[12px] disabled:opacity-40";

function LessonLearning({ lessonId, ...props }: Props & { lessonId: string }) {
  const view = props.index.byLessonId.get(lessonId)!;
  const [actor, setActor] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [outcome, setOutcome] = useState<IcarusLearningReview["outcome"]>("Candidate");
  const [requirement, setRequirement] = useState<IcarusLearningReview["institutionalisation"]>("Required");
  const [priorId, setPriorId] = useState("");
  const [mechanismIds, setMechanismIds] = useState<string[]>([]);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [rationale, setRationale] = useState("");
  const [verificationId, setVerificationId] = useState("");
  const [verificationOutcome, setVerificationOutcome] = useState<IcarusInstitutionalisationReview["outcome"]>("Inconclusive");
  const [nextReviewBy, setNextReviewBy] = useState("");
  const [error, setError] = useState("");
  const options = getIcarusLearningEvidenceOptions(props.input);
  const evidence = options.filter((entry) => evidenceIds.includes(JSON.stringify(entry.reference))).map((entry) => entry.reference);
  const mechanisms = props.input.mechanisms.filter((entry) => mechanismIds.includes(getIcarusReferenceKey(entry)));
  const disabled = !props.writable || props.input.lifecycle.hypothetical || !actor || !rationale.trim();
  function save(operation: () => IcarusLessonLearning) {
    try {
      props.onChange(lessonId, operation());
      setError("");
      setRationale("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to record learning review.");
    }
  }
  function recordLearning() {
    const reviewedAt = new Date().toISOString();
    save(() => recordIcarusLearningReview({ ...props.input, nowMs: Date.parse(reviewedAt) }, lessonId, {
      id: props.createId(), reviewedAt, reviewedByPersonId: actor, outcome, conclusion: conclusion.trim(), evidence,
      institutionalisation: requirement, mechanisms: mechanisms.map(({ recordType, recordId }) => ({ recordType, recordId })),
      ...(priorId ? outcome === "Contradicted" ? { contradictsReviewId: priorId } : { supersedesReviewId: priorId } : {}),
      rationale: rationale.trim(),
    }));
  }
  function recordEmbedding() {
    const reviewedAt = new Date().toISOString();
    const learning = view.reviews.find((entry) => entry.record.id === verificationId);
    save(() => {
      if (!learning) throw new Error("Select the learning review being verified.");
      return recordIcarusInstitutionalisationReview({ ...props.input, nowMs: Date.parse(reviewedAt) }, lessonId, {
        id: props.createId(), learningReviewId: verificationId, reviewedAt, reviewedByPersonId: actor,
        outcome: verificationOutcome, evidence, rationale: rationale.trim(),
        ...(nextReviewBy ? { nextReviewBy } : {}),
        mechanismConditions: learning.record.mechanisms.map((reference) => {
          const source = props.input.mechanisms.find((entry) => getIcarusReferenceKey(entry) === getIcarusReferenceKey(reference));
          if (!source) throw new Error(`Missing mechanism: ${getIcarusReferenceKey(reference)}`);
          return { reference, status: source.status, revision: source.revision };
        }),
      });
    });
  }
  return <details className="mt-3 rounded border border-[#d3cbc3] bg-white p-3 text-[11px]">
    <summary>{view.title} - {view.validity}{view.institutionalisation ? ` / ${view.institutionalisation}` : ""}</summary>
    <button className={button} onClick={() => props.onOpenRecord("Lesson", lessonId)}>Open authoritative Lesson</button>
    {!view.reviews.length ? <p>No explicit Icarus learning provenance recorded. Legacy Lesson authority is unchanged.</p> : null}
    {view.reviews.map((review, index) => <div key={`${review.record.id}:${index}`} className="mt-2 border-t border-[#d3cbc3] pt-2">
      <p>{review.record.id}: human recorded {review.record.outcome}, {review.record.reviewedAt}, Person {review.record.reviewedByPersonId}.
        {" "}Current validity: {review.validity}; embedding: {review.institutionalisation}.</p>
      <p>{review.record.conclusion}</p><p>{review.record.rationale}</p><p>{review.issues.join("; ")}</p>
      <p>Supersedes: {review.record.supersedesReviewId || "None"}. Contradicts: {review.record.contradictsReviewId || "None"}.</p>
      <p>Explicit provenance: {review.record.evidence.map((ref) => JSON.stringify(ref)).join("; ")}</p>
      <p>Mechanisms: {review.record.mechanisms.map(getIcarusReferenceKey).join(", ") || "None declared"}.</p>
      {review.institutionalisationHistory.map((entry, index) => <p key={`${entry.record.id}:${index}`}>
        Embedding review {entry.record.id}: {entry.record.outcome}, {entry.record.reviewedAt}. {entry.record.rationale}
        {" "}Current support: {entry.current ? "Established" : "Not established"}. {entry.issues.join("; ")}
        {" "}Evidence: {entry.record.evidence.map((ref) => JSON.stringify(ref)).join("; ")}.
      </p>)}
    </div>)}
    {view.orphanedInstitutionalisationReviews.map((record, index) => <p key={`${record.id}:${index}`}>
      Historical embedding review {record.id} references missing learning review {record.learningReviewId}; retained for inspection.
    </p>)}
    <p className="mt-2">{view.attentionReasons.join("; ")}</p>
    {view.recurrence.map((entry) => <p key={`${entry.assessmentId}:${entry.regressionId}`}>
      Explicitly linked recurrence: {entry.assessmentId}, {entry.regressionId}, {entry.confirmedAt}.
      {" "}{entry.afterInstitutionalisation ? "After recorded embedding; investigate effectiveness, not automatic mechanism failure." : "After validation."}
      {" "}{entry.requiresReview ? "Current review required." : "Subsequent current embedding verification recorded; history retained."}
    </p>)}
    <div className="mt-3 space-y-2 border-t border-[#d3cbc3] pt-2">
      <p>Human review only. Completion and mechanism existence do not establish effectiveness. No automatic Lesson creation or status changes.</p>
      <label>Reviewer Person<select className={field} value={actor} onChange={(event) => setActor(event.target.value)}>
        <option value="">Select active Person</option>{props.input.people.filter((entry) => entry.status === "Active")
          .map((person) => <option key={person.id} value={person.id}>{person.id}</option>)}
      </select></label>
      <label>Explicit learning conclusion<textarea className={field} value={conclusion} onChange={(event) => setConclusion(event.target.value)} /></label>
      <label>Human conclusion classification<select className={field} value={outcome} onChange={(event) => {
        const value = (["Candidate", "Validated", "Contradicted"] as const).find((value) => value === event.target.value);
        if (value) setOutcome(value);
      }}>{["Candidate", "Validated", "Contradicted"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Prior review (explicit supersession, or contradiction target)<select className={field} value={priorId} onChange={(event) => setPriorId(event.target.value)}>
        <option value="">No prior review</option>{view.reviews.map((entry, index) => <option key={`${entry.record.id}:${index}`}>{entry.record.id}</option>)}
      </select></label>
      <label>Institutionalisation requirement<select className={field} value={requirement} onChange={(event) => {
        if (event.target.value === "Required" || event.target.value === "Not required") setRequirement(event.target.value);
      }}><option>Required</option><option>Not required</option></select></label>
      <details><summary>Explicit evidence / provenance ({evidence.length})</summary>{options.map((entry) => {
        const id = JSON.stringify(entry.reference);
        return <label key={id} className="block"><input type="checkbox" checked={evidenceIds.includes(id)} onChange={(event) =>
          setEvidenceIds((current) => event.target.checked ? [...current, id] : current.filter((value) => value !== id))} /> {entry.label}</label>;
      })}</details>
      <details><summary>Declared embedding mechanisms ({mechanisms.length})</summary>{props.input.mechanisms.map((entry) => {
        const id = getIcarusReferenceKey(entry);
        return <label key={id} className="block"><input type="checkbox" checked={mechanismIds.includes(id)} onChange={(event) =>
          setMechanismIds((current) => event.target.checked ? [...current, id] : current.filter((value) => value !== id))} /> {id}: {entry.title} ({entry.status})</label>;
      })}</details>
      <label>Review rationale<textarea className={field} value={rationale} onChange={(event) => setRationale(event.target.value)}
        placeholder="Explain exactly what the evidence establishes for the stated learning and mechanisms." /></label>
      <button className={button} disabled={disabled || !conclusion.trim()} onClick={recordLearning}>Append learning review</button>
      <label>Validated review to verify embedding<select className={field} value={verificationId} onChange={(event) => setVerificationId(event.target.value)}>
        <option value="">Select learning review</option>{view.reviews.filter((entry) => entry.validity === "Validated")
          .map((entry) => <option key={entry.record.id}>{entry.record.id}</option>)}
      </select></label>
      <label>Embedding result<select className={field} value={verificationOutcome} onChange={(event) => {
        const value = (["Effective", "Ineffective", "Inconclusive"] as const).find((value) => value === event.target.value);
        if (value) setVerificationOutcome(value);
      }}>{["Inconclusive", "Effective", "Ineffective"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Next embedding verification date<input className={field} type="date" value={nextReviewBy} onChange={(event) => setNextReviewBy(event.target.value)} /></label>
      <button className={button} disabled={disabled || !verificationId} onClick={recordEmbedding}>Append institutionalisation review</button>
      {error ? <p role="alert" className="text-[#8b3d28]">{error}</p> : null}
    </div>
  </details>;
}
export default function IcarusLearningSection(props: Props) {
  return <section className="mt-4 rounded-xl border border-[#c9b8a3] bg-[#faf8f5] p-4">
    <h2 className="text-[12px] font-semibold">Learning validity and institutionalisation</h2>
    <p className="mt-1 text-[11px]">Observations are not validated Lessons. Embedding and effectiveness are verified separately; history is never rewritten.</p>
    <p className="text-[11px]">Assessments with historical learning observations: {props.index.observedAssessmentIds.join(", ") || "None"}.
      {" "}A Lesson must be explicitly authored or linked through these reviews.</p>
    {props.input.lessons.map((lesson) => <LessonLearning key={lesson.id} {...props} lessonId={lesson.id} />)}
    {!props.input.lessons.length ? <p className="text-[11px]">No authoritative Lessons available. Create a Lesson through the existing capture/lesson workflow.</p> : null}
  </section>;
}
