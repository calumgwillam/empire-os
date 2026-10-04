"use client";

import { useState } from "react";
import {
  createFounderRelationshipRecord,
  deriveFounderRelationshipUnderstanding,
  type FounderIntelligence,
  type FounderIntelligenceContext,
  type FounderIntelligenceEvidenceReference,
  type PairIntelligenceObservation,
} from "../lib/founder-intelligence";
import {
  founderRelationshipKinds,
  getFounderRelationshipEvidenceOptions,
  reviewFounderRelationshipEvidence,
  type FounderRelationshipDraft,
} from "../lib/founder-relationship-workflow";

type Props = {
  personId: string;
  intelligence: FounderIntelligence;
  context: FounderIntelligenceContext;
  writable: boolean;
  personName: (id: string) => string;
  evidenceDetails: (reference: FounderIntelligenceEvidenceReference, intelligence: FounderIntelligence) => string[];
  onRecord: (draft: FounderRelationshipDraft) => { status: string };
  onReview: () => void;
  newObservationKey: () => string;
};

const fieldClass = "rounded-lg border border-[#beb3aa] bg-white px-3 py-2 text-[12px] text-[#171717]";
const buttonClass = "rounded-lg border border-[#171717] bg-white px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[#171717] disabled:opacity-40";

export default function FounderRelationshipPanel({
  personId, intelligence, context, writable, personName, evidenceDetails, onRecord, onReview, newObservationKey,
}: Props) {
  const [partnerId, setPartnerId] = useState("");
  const [kind, setKind] = useState<FounderRelationshipDraft["kind"]>("source-grounded-understanding");
  const [dimension, setDimension] = useState("");
  const [statement, setStatement] = useState("");
  const [fromPersonId, setFromPersonId] = useState("");
  const [evidenceKeys, setEvidenceKeys] = useState<string[]>([]);
  const [keepUnresolved, setKeepUnresolved] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const founders = context.people.filter((person) => person.accessLevel === "Founder"
    && context.people.filter((candidate) => candidate.id === person.id).length === 1);
  if (!founders.some((person) => person.id === personId)) return null;
  const partner = founders.find((person) => person.id === partnerId && person.id !== personId);
  const scaffold = partner ? createFounderRelationshipRecord([personId, partner.id], context) : null;
  const pair = scaffold
    ? intelligence.pairRecords.find((record) => record.id === scaffold.id) ?? scaffold : null;
  const reviewIntelligence = reviewFounderRelationshipEvidence(intelligence, context);
  const review = pair ? deriveFounderRelationshipUnderstanding(pair, context) : null;
  const options = pair ? getFounderRelationshipEvidenceOptions(pair, kind, context) : [];
  const selectedOptions = options.filter((option) => evidenceKeys.includes(option.key));
  const details = (reference: FounderIntelligenceEvidenceReference, visited = new Set<string>()): string[] => {
    const key = JSON.stringify(reference);
    if (visited.has(key)) return ["Circular evidence reference; unresolved."];
    visited.add(key);
    if (reference.type === "pair-observation") {
      const cited = reviewIntelligence.pairRecords.find((record) => record.id === reference.pairId)
        ?.observations.find((observation) => observation.id === reference.observationId);
      if (cited) return [
        `Pair evidence / ${cited.claim.status}: ${cited.claim.statement}`,
        ...cited.claim.evidence.flatMap((evidence) => details(evidence, new Set(visited))),
      ];
    }
    if (reference.type === "operational-outcome") {
      const outcomes = context.operationalEvidence?.filter((outcome) =>
        outcome.personId === reference.personId && outcome.recordType === reference.recordType
        && outcome.recordId === reference.recordId && outcome.outcomeId === reference.outcomeId) ?? [];
      if (outcomes.length) return outcomes.map((outcome) =>
        `Independent execution evidence - ${personName(outcome.personId)} / ${outcome.recordType} ${outcome.recordId} / ${outcome.contribution}: ${outcome.outcome}. ${outcome.observedResult ?? "Result unavailable"}`);
    }
    return evidenceDetails(reference, reviewIntelligence);
  };

  const showObservation = (observation: PairIntelligenceObservation) => (
    <div key={observation.id} className="rounded border border-[#d3cbc3] bg-white p-3">
      <div className="text-[10px] text-[#4d4944]">
        {observation.dimension} / {observation.claim.status}
        {observation.integrityStatus === "conflicting" ? " / CONFLICTING - remains unresolved" : ""}
        {observation.direction
          ? ` / ${personName(observation.direction.fromPersonId)} to ${personName(observation.direction.toPersonId)}` : ""}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[12px] text-[#171717]">{observation.claim.statement}</p>
      <div className="mt-1 break-all text-[10px] text-[#4d4944]">Observation: {observation.id}</div>
      {observation.claim.candidateStatus ? (
        <p className="mt-1 text-[10px] text-[#4d4944]">
          Candidate: {observation.claim.candidateStatus}. This is not a resolved conclusion.
        </p>
      ) : null}
      {observation.claim.evidence.length === 0 ? (
        <p className="mt-1 text-[11px] text-[#4d4944]">No evidence recorded; unresolved.</p>
      ) : observation.claim.evidence.map((reference, index) => (
        <details key={`${JSON.stringify(reference)}-${index}`} className="mt-2 text-[11px] text-[#4d4944]">
          <summary className="cursor-pointer">{reference.type} / evidence {index + 1}</summary>
          <p className="mt-1 break-all">{JSON.stringify(reference)}</p>
          {details(reference).map((detail, detailIndex) => (
            <p key={detailIndex} className="mt-1 whitespace-pre-wrap leading-5">{detail}</p>
          ))}
        </details>
      ))}
    </div>
  );

  return (
    <section aria-label="Founder relationship authoring and review" className="rounded-lg border border-[#d3cbc3] bg-[#f9f7f4] p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#171717]">Founder relationship intelligence</h3>
      <p className="mt-1 text-[11px] leading-5 text-[#4d4944]">
        Human-authored evidence and interpretation only. Founder eligibility uses saved People Founder access.
        Evidence coverage is not agreement, capability, responsibility allocation or a grant of authority.
        Existing working relationships remain separate.
      </p>
      {!writable ? (
        <p role="alert" className="mt-2 text-[11px] text-[#7a352b]">Authoring is blocked until People, execution and Founder Intelligence storage have loaded safely.</p>
      ) : null}
      <label className="mt-3 block text-[11px] text-[#4d4944]">
        Founder partner
        <select aria-label="Founder relationship partner" value={partnerId} className={`${fieldClass} mt-1 w-full`}
          onChange={(event) => {
            setPartnerId(event.target.value);
            setEvidenceKeys([]);
            setFromPersonId("");
            setFeedback(null);
          }}>
          <option value="">Select another founder</option>
          {founders.filter((person) => person.id !== personId).map((person) => (
            <option key={person.id} value={person.id}>{personName(person.id)}</option>
          ))}
        </select>
      </label>
      {pair && review ? (
        <>
          <div className="mt-3 text-[11px] leading-5 text-[#4d4944]">
            <p>Saved founder access: {review.founderStatus} / source coverage: {review.sourceCoverage}</p>
            <p>Compatibility: {review.compatibilityStatus} / authority unchanged</p>
          </div>
          <form className="mt-3 space-y-3" onSubmit={(event) => {
            event.preventDefault();
            if (!writable) {
              setFeedback({ error: true, message: "Storage is not writable; nothing was recorded." });
              return;
            }
            try {
              const result = onRecord({
                observationKey: newObservationKey(), personIds: [personId, partnerId],
                kind, dimension, statement, evidenceKeys, keepUnresolved,
                ...(fromPersonId ? { fromPersonId } : {}),
              });
              setStatement("");
              setEvidenceKeys([]);
              setFeedback({ error: false, message: `Recorded as ${result.status}. No authority or allocation changed.` });
            } catch (error) {
              setFeedback({ error: true, message: error instanceof Error ? error.message : "Relationship evidence could not be recorded." });
            }
          }}>
            <label className="block text-[11px] text-[#4d4944]">
              Evidence kind
              <select aria-label="Founder relationship evidence kind" value={kind} className={`${fieldClass} mt-1 w-full`}
                onChange={(event) => {
                  const selected = founderRelationshipKinds.find((entry) => entry.value === event.target.value);
                  if (!selected) return;
                  setKind(selected.value);
                  setEvidenceKeys([]);
                  setFromPersonId("");
                  setFeedback(null);
                }}>
                {founderRelationshipKinds.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
              </select>
            </label>
            <label className="block text-[11px] text-[#4d4944]">
              Relationship dimension
              <input aria-label="Founder relationship dimension" required value={dimension}
                onChange={(event) => setDimension(event.target.value)} className={`${fieldClass} mt-1 w-full`}
                placeholder="For example: disagreement and conflict" />
            </label>
            {kind === "source-grounded-understanding" ? (
              <label className="block text-[11px] text-[#4d4944]">
                Direction (optional; identifies whose source understanding is recorded)
                <select aria-label="Founder understanding direction" value={fromPersonId}
                  onChange={(event) => { setFromPersonId(event.target.value); setEvidenceKeys([]); }}
                  className={`${fieldClass} mt-1 w-full`}>
                  <option value="">Undirected understanding</option>
                  {pair.personIds.map((id) => <option key={id} value={id}>{personName(id)} toward {personName(pair.personIds.find((other) => other !== id) || "")}</option>)}
                </select>
              </label>
            ) : null}
            <fieldset className="rounded border border-[#d3cbc3] p-2">
              <legend className="text-[11px] text-[#4d4944]">Select supporting evidence</legend>
              <p className="mb-2 text-[10px] leading-5 text-[#4d4944]">
                {kind === "operating-observation"
                  ? "Only independent context evidence is offered; persisted assertions and Action assignment are not proof."
                  : kind === "compatibility-interpretation"
                    ? "Support must cover both founders. Other interpretations cannot validate this interpretation."
                    : "Source evidence describes a person's account, not demonstrated operating behaviour."}
              </p>
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {options.filter((option) => !fromPersonId
                  || (option.reference.type !== "pair-observation" && option.reference.personId === fromPersonId))
                  .map((option) => (
                    <label key={option.key} className="flex gap-2 text-[11px] text-[#4d4944]">
                      <input type="checkbox" checked={evidenceKeys.includes(option.key)} onChange={(event) =>
                        setEvidenceKeys((current) => event.target.checked
                          ? [...current, option.key] : current.filter((key) => key !== option.key))} />
                      <span>{option.label}</span>
                    </label>
                  ))}
              </div>
              {options.length === 0 ? <p className="text-[11px] text-[#4d4944]">No available evidence for this kind. Record an explicitly unresolved item or gather evidence first.</p> : null}
              {selectedOptions.map((option) => (
                <details key={option.key} className="mt-2 text-[11px] text-[#4d4944]">
                  <summary className="cursor-pointer">Review selected provenance</summary>
                  {details(option.reference).map((detail, index) =>
                    <p key={index} className="mt-1 whitespace-pre-wrap leading-5">{detail}</p>)}
                </details>
              ))}
            </fieldset>
            <label className="block text-[11px] text-[#4d4944]">
              Human-authored statement
              <textarea aria-label="Founder relationship statement" required rows={3} value={statement}
                onChange={(event) => setStatement(event.target.value)} className={`${fieldClass} mt-1 w-full`} />
            </label>
            <label className="flex gap-2 text-[11px] text-[#4d4944]">
              <input type="checkbox" checked={keepUnresolved} onChange={(event) => setKeepUnresolved(event.target.checked)} />
              Keep explicitly unresolved; do not request an evidence-supported conclusion
            </label>
            <button type="submit" disabled={!writable || !dimension.trim() || !statement.trim()
              || (!keepUnresolved && evidenceKeys.length === 0)} className={buttonClass}>
              Record relationship evidence
            </button>
            {feedback ? <p role={feedback.error ? "alert" : "status"} className="text-[11px] text-[#4d4944]">{feedback.message}</p> : null}
          </form>
          <div className="mt-4 border-t border-[#d3cbc3] pt-3">
            <button type="button" disabled={!writable} className={buttonClass} onClick={() => {
              try {
                onReview();
                setFeedback({ error: false, message: "Evidence rechecked against current records. Conflicts remain unresolved; nothing was approved automatically." });
              } catch (error) {
                setFeedback({ error: true, message: error instanceof Error ? error.message : "Relationship evidence could not be reviewed." });
              }
            }}>Recheck recorded evidence</button>
            {[
              { label: "Source-grounded understanding", observations: review.sourceUnderstandings },
              { label: "Independent operating observations", observations: review.operatingObservations },
              { label: "Compatibility interpretations", observations: review.compatibilityInterpretations },
            ].map((group) => (
              <div key={group.label} className="mt-3 space-y-2">
                <h4 className="text-[11px] font-semibold text-[#171717]">{group.label}</h4>
                {group.observations.length ? group.observations.map(showObservation)
                  : <p className="text-[11px] text-[#4d4944]">Nothing recorded. No conclusion inferred.</p>}
              </div>
            ))}
            <p className="mt-3 text-[10px] leading-5 text-[#4d4944]">
              Records are retained for traceability. New entries do not overwrite or silently resolve earlier conflicting accounts.
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}
