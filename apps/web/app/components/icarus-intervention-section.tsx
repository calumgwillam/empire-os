"use client";

import { useState } from "react";
import {
  ICARUS_INTERVENTION_CHARACTERS,
  ICARUS_INTERVENTION_EFFECTS,
  ICARUS_INTERVENTION_INTENTS,
  ICARUS_INTERVENTION_RELATIONSHIPS,
  ICARUS_INTERVENTION_SCOPES,
  getIcarusReferenceKey,
  type IcarusAssessmentRecord,
  type IcarusInterventionDecisionRecord,
  type IcarusInterventionEffect,
  type IcarusInterventionOption,
  type IcarusInterventionScope,
  type IcarusSourceRecord,
} from "../lib/icarus";
import {
  emptyIcarusInterventionScope,
  selectIcarusInterventionOption,
  type IcarusInterventionIndex,
  type IcarusInterventionDecisionView,
} from "../lib/icarus-intervention-decision";
import { persistIcarusTreatmentTarget, type IcarusTreatmentIndex } from "../lib/icarus-treatment";
import type { IcarusAssurancePersonOption } from "./icarus-assurance-section";

type Props = {
  assessments: readonly IcarusAssessmentRecord[];
  sources: readonly IcarusSourceRecord[];
  treatment: IcarusTreatmentIndex;
  index: IcarusInterventionIndex;
  people: readonly IcarusAssurancePersonOption[];
  writable: boolean;
  createId: () => string;
  onChange: (assessments: IcarusAssessmentRecord[]) => void;
  onOpenRecord: (type: string, id: string) => void;
};

const field = "mt-1 w-full rounded border border-[#cfc8c1] bg-white px-2 py-1 text-[12px] text-[#171717]";
const button = "rounded border border-[#315b45] px-2 py-1 text-[11px] text-[#315b45] disabled:opacity-40";

function Choices({
  label, items, selected, disabled, onChange,
}: {
  label: string;
  items: readonly { id: string; title: string }[];
  selected: readonly string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const missing = selected.filter((id) => !items.some((item) => item.id === id));
  return (
    <details className="mt-2 text-[11px]">
      <summary>{label} ({selected.length})</summary>
      {[...items, ...missing.map((id) => ({ id, title: `Missing: ${id}` }))].map((item) => (
        <label key={item.id} className="mt-1 block">
          <input type="checkbox" disabled={disabled} checked={selected.includes(item.id)}
            onChange={(event) => onChange(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} />
          {" "}{item.title}
        </label>
      ))}
    </details>
  );
}

function Scope({
  value, assessments, sources, disabled, onChange,
}: {
  value: IcarusInterventionScope;
  assessments: Props["assessments"];
  sources: Props["sources"];
  disabled: boolean;
  onChange: (value: IcarusInterventionScope) => void;
}) {
  const modes = assessments.flatMap((assessment) => assessment.failureModes.map((mode) => ({
    id: JSON.stringify([assessment.id, mode.id]), title: `${assessment.outcome}: ${mode.mechanism}`,
    reference: { assessmentId: assessment.id, failureModeId: mode.id },
  })));
  const modeReferences = new Map([
    ...modes.map((mode) => [mode.id, mode.reference] as const),
    ...value.failureModes.map((ref) => [JSON.stringify([ref.assessmentId, ref.failureModeId]), ref] as const),
  ]);
  const dependencyReferences = new Map([
    ...sources.map(({ recordType, recordId }) => [getIcarusReferenceKey({ recordType, recordId }), { recordType, recordId }] as const),
    ...value.dependencyReferences.map((ref) => [getIcarusReferenceKey(ref), ref] as const),
  ]);
  return (
    <div>
      <Choices label="Affected assessments" items={assessments.map((entry) => ({ id: entry.id, title: entry.outcome }))}
        selected={value.assessmentIds} disabled={disabled} onChange={(assessmentIds) => onChange({ ...value, assessmentIds })} />
      <Choices label="Failure modes" items={modes} selected={value.failureModes.map((ref) => JSON.stringify([ref.assessmentId, ref.failureModeId]))}
        disabled={disabled} onChange={(ids) => onChange({
          ...value, failureModes: ids.flatMap((id) => {
            const reference = modeReferences.get(id);
            return reference ? [reference] : [];
          }),
        })} />
      <Choices label="Dependencies (explicit structural targets)" items={sources.map((entry) => ({
        id: getIcarusReferenceKey(entry), title: `${entry.recordType}: ${entry.title}`,
      }))} selected={value.dependencyReferences.map(getIcarusReferenceKey)} disabled={disabled}
        onChange={(ids) => onChange({
          ...value, dependencyReferences: ids.flatMap((id) => {
            const reference = dependencyReferences.get(id);
            return reference ? [reference] : [];
          }),
        })} />
      <Choices label="Strategic objectives" items={sources.filter((entry) => entry.recordType === "Strategic Objective")
        .map((entry) => ({ id: entry.recordId, title: entry.title }))} selected={value.objectiveIds}
        disabled={disabled} onChange={(objectiveIds) => onChange({ ...value, objectiveIds })} />
      <Choices label="Pillars" items={sources.filter((entry) => entry.recordType === "Pillar")
        .map((entry) => ({ id: entry.recordId, title: entry.title }))} selected={value.pillarIds}
        disabled={disabled} onChange={(pillarIds) => onChange({ ...value, pillarIds })} />
    </div>
  );
}

function DecisionEditor({
  view, props, actor, update, fail, linkTarget,
}: {
  view: IcarusInterventionDecisionView;
  props: Props;
  actor: string;
  update: (record: IcarusInterventionDecisionRecord) => void;
  fail: (message: string) => void;
  linkTarget: (optionId: string, targetId: string) => void;
}) {
  const { record } = view;
  const [optionName, setOptionName] = useState("");
  const [rationale, setRationale] = useState("");
  const [relationFrom, setRelationFrom] = useState("");
  const [relationTo, setRelationTo] = useState("");
  const [relationKind, setRelationKind] = useState<(typeof ICARUS_INTERVENTION_RELATIONSHIPS)[number]>("prerequisite-of");
  const [effectOption, setEffectOption] = useState("");
  const [effectTarget, setEffectTarget] = useState("");
  const [effectDirection, setEffectDirection] = useState<(typeof ICARUS_INTERVENTION_EFFECTS)[number]>("Unknown");
  const [effectEvidence, setEffectEvidence] = useState<string[]>([]);
  const [targetId, setTargetId] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [outcomeId, setOutcomeId] = useState("");
  const [lessonCauses, setLessonCauses] = useState<string[]>([]);
  const appendOnlyDisabled = !props.writable || !actor
    || view.conflicts.some((conflict) => conflict.startsWith("Duplicate intervention decision identity:")
      || conflict.startsWith("Duplicate option identity:"));
  const disabled = appendOnlyDisabled || record.status === "Superseded";
  const structured = disabled || record.selectionHistory.length > 0;
  const allOptions = props.index.decisions.flatMap((decision) => decision.record.options);
  const evidence = props.assessments.flatMap((assessment) => assessment.failureModes.flatMap((mode) =>
    mode.evidence.map((entry) => ({
      id: entry.id, title: entry.statement, assessmentId: assessment.id, failureModeId: mode.id,
    }))));
  const effectTargets: { key: string; title: string; target: IcarusInterventionEffect["target"] }[] = [
    ...props.assessments.map((assessment) => ({
      key: `Assessment:${assessment.id}`, title: `Assessment: ${assessment.outcome}`,
      target: { kind: "Assessment" as const, id: assessment.id },
    })),
    ...props.index.causes.map((cause) => ({
      key: `Cause:${cause.id}`, title: `Cause: ${cause.title}`, target: { kind: "Cause" as const, id: cause.id },
    })),
    ...props.sources.map((source) => ({
      key: `Dependency:${getIcarusReferenceKey(source)}`, title: `Dependency: ${source.title}`,
      target: { kind: "Dependency" as const, reference: { recordType: source.recordType, recordId: source.recordId } },
    })),
    ...props.sources.filter((source) => source.recordType === "Strategic Objective" || source.recordType === "Pillar")
      .map((source) => ({
        key: `${source.recordType}:${source.recordId}`, title: `${source.recordType}: ${source.title}`,
        target: source.recordType === "Pillar" ? { kind: "Pillar" as const, id: source.recordId }
          : { kind: "Strategic Objective" as const, id: source.recordId },
      })),
  ];
  const optionUpdate = (option: IcarusInterventionOption) => update({
    ...record, options: record.options.map((entry) => entry.id === option.id ? option : entry),
  });
  const select = (option: IcarusInterventionOption) => {
    if (!rationale.trim()) { fail("Enter a selection rationale before choosing an intervention."); return; }
    const at = new Date().toISOString();
    const eventId = props.createId();
    if (Date.parse(record.createdAt) > Date.parse(at)
      || record.selectionHistory.some((event) => Date.parse(event.selectedAt) > Date.parse(at))) {
      fail("This context has future-dated provenance. Review its dates before recording another selection."); return;
    }
    if (!eventId.trim() || record.selectionHistory.some((event) => event.id === eventId)) {
      fail("A unique selection-event identity could not be created."); return;
    }
    const incompatible = props.index.decisions.some((decision) => decision.record.status !== "Superseded"
      && decision.record.id !== record.id && decision.selectedOption
      && props.index.decisions.filter((entry) => entry.record.status !== "Superseded")
        .flatMap((entry) => entry.record.relationships).some((relation) =>
        relation.kind === "mutually-exclusive-with" && (
          (relation.fromOptionId === option.id && relation.toOptionId === decision.selectedOption?.id)
          || (relation.toOptionId === option.id && relation.fromOptionId === decision.selectedOption?.id))));
    if (incompatible) { fail("This option is mutually exclusive with another active selection. Supersede that context first."); return; }
    update(selectIcarusInterventionOption(record, option.id, rationale, actor, at, eventId));
  };
  return (
    <details className="mt-3 rounded border border-[#d3cbc3] bg-white p-3" open>
      <summary className="text-[12px] font-medium">{record.title} - {view.readiness}</summary>
      <p className="mt-1 text-[11px]">Selected means chosen, not superior. Outcome available does not mean successful or resolved.</p>
      {[...view.issues, ...view.conflicts, ...view.unmetPrerequisites].map((issue) =>
        <p key={issue} className="mt-1 text-[11px] text-[#8b3d28]">{view.warnings.includes(issue) ? "Warning (does not invalidate prerequisite protection): " : ""}{issue}</p>)}
      <label className="mt-2 block text-[11px]">Authoritative Decision
        <select className={field} disabled={disabled} value={record.decisionRecordId ?? ""}
          onChange={(event) => update({ ...record, decisionRecordId: event.target.value || undefined })}>
          <option value="">No organisational Decision linked</option>
          {props.sources.filter((source) => source.recordType === "Decision").map((source) =>
            <option key={source.recordId} value={source.recordId}>{source.title} ({source.status})</option>)}
        </select>
      </label>
      {record.decisionRecordId ? <button className={button} onClick={() => props.onOpenRecord("Decision", record.decisionRecordId ?? "")}>Open Decision</button> : null}
      <label className="mt-2 block text-[11px]">Next review by
        <input type="date" className={field} disabled={disabled} value={record.nextReviewBy ?? ""}
          onChange={(event) => update({ ...record, nextReviewBy: event.target.value || undefined })} />
      </label>
      <Choices label="Explicit causes" items={props.index.causes.map((cause) => ({ id: cause.id, title: `${cause.title} (${cause.id})` }))}
        selected={record.causeIds} disabled={structured} onChange={(causeIds) => update({ ...record, causeIds })} />
      <Scope value={record} assessments={props.assessments} sources={props.sources} disabled={structured}
        onChange={(scope) => update({ ...record, ...scope })} />
      <label className="mt-2 block text-[11px]">Selection / rejection / relationship rationale
        <textarea className={field} disabled={disabled} value={rationale} onChange={(event) => setRationale(event.target.value)} />
      </label>
      <p className="text-[11px]">Recorded selection rationale: {record.rationale || "Not recorded"}</p>
      <input className={field} aria-label="New intervention option name" disabled={disabled} value={optionName}
        onChange={(event) => setOptionName(event.target.value)} />
      <button className={button} disabled={disabled || !optionName.trim()} onClick={() => {
        const option: IcarusInterventionOption = {
          ...emptyIcarusInterventionScope(),
          assessmentIds: [...record.assessmentIds], failureModes: [...record.failureModes],
          dependencyReferences: [...record.dependencyReferences], objectiveIds: [...record.objectiveIds], pillarIds: [...record.pillarIds],
          id: props.createId(), name: optionName.trim(), description: "", causeIds: [...record.causeIds],
          status: "Candidate",
          rationale: "", treatmentLinks: [], priorOptionIds: [],
        };
        update({ ...record, options: [...record.options, option] }); setOptionName("");
      }}>Add candidate option (classify before selection)</button>
      {record.options.map((option) => {
        const historical = record.selectionHistory.some((event) => event.optionId === option.id);
        return (
          <div key={option.id} className="mt-3 rounded border border-[#d3cbc3] p-2 text-[11px]">
            <p className="font-medium">{option.name} - {view.selectedOption?.id === option.id ? "Selected" : option.status} ({option.id})</p>
            <textarea className={field} aria-label={`Description for ${option.name}`} disabled={disabled || historical}
              value={option.description} onChange={(event) => optionUpdate({ ...option, description: event.target.value })} />
            <label>Intent<select className={field} disabled={disabled || historical} value={option.intent ?? ""}
              onChange={(event) => {
                const intent = ICARUS_INTERVENTION_INTENTS.find((value) => value === event.target.value);
                if (intent) optionUpdate({ ...option, intent });
              }}><option value="">Not classified</option>{ICARUS_INTERVENTION_INTENTS.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Scope<select className={field} disabled={disabled || historical} value={option.scope ?? ""}
              onChange={(event) => {
                const scope = ICARUS_INTERVENTION_SCOPES.find((value) => value === event.target.value);
                if (scope) optionUpdate({ ...option, scope });
              }}><option value="">Not classified</option>{ICARUS_INTERVENTION_SCOPES.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Character<select className={field} disabled={disabled || historical} value={option.character ?? ""}
              onChange={(event) => {
                const character = ICARUS_INTERVENTION_CHARACTERS.find((value) => value === event.target.value);
                if (character) optionUpdate({ ...option, character });
              }}><option value="">Not classified</option>{ICARUS_INTERVENTION_CHARACTERS.map((value) => <option key={value}>{value}</option>)}</select></label>
            <Choices label="Target causes" items={props.index.causes.filter((cause) => record.causeIds.includes(cause.id))
              .map((cause) => ({ id: cause.id, title: cause.title }))} selected={option.causeIds} disabled={disabled || historical}
              onChange={(causeIds) => optionUpdate({ ...option, causeIds })} />
            <Scope value={option} assessments={props.assessments} sources={props.sources} disabled={disabled || historical}
              onChange={(scope) => optionUpdate({ ...option, ...scope })} />
            <Choices label="Explicitly reuses prior intervention" items={allOptions.filter((entry) =>
              entry.id !== option.id && !record.options.some((own) => own.id === entry.id))
              .map((entry) => ({ id: entry.id, title: `${entry.name} (${entry.id})` }))}
              selected={option.priorOptionIds} disabled={disabled || historical}
              onChange={(priorOptionIds) => optionUpdate({ ...option, priorOptionIds })} />
            <p>{option.rationale}</p>
            {option.status === "Candidate" && record.selectedOptionId !== option.id ? <>
              <button className={button} disabled={disabled || !rationale.trim() || !option.description.trim()
                || !option.intent || !option.scope || !option.character || !option.causeIds.length}
                onClick={() => select(option)}>Select explicitly</button>{" "}
              <button className={button} disabled={disabled || !rationale.trim()} onClick={() =>
                optionUpdate({ ...option, status: "Rejected", rationale: rationale.trim() })}>Reject with rationale</button>
            </> : null}
            {option.treatmentLinks.map((link) => <p key={link.targetId}>
              Treatment: {link.targetId} - {props.treatment.targets.find((target) => target.id === link.targetId)?.state ?? "Missing target"}
            </p>)}
          </div>
        );
      })}
      {view.selectedOption ? <div className="mt-2 text-[11px]">
        <label>Link selected option to existing treatment target
          <select className={field} disabled={disabled} value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            <option value="">Choose treatment target</option>
            {props.treatment.targets.map((target) => <option key={target.id} value={target.id}>{target.treatmentKind} - {target.state}</option>)}
          </select>
        </label>
        <button className={button} disabled={disabled || !targetId}
          onClick={() => linkTarget(view.selectedOption?.id ?? "", targetId)}>Link target (route execution below)</button>
      </div> : null}
      <details className="mt-2 text-[11px]"><summary>Relationships and declared risk transfers</summary>
        <label>From option<select className={field} value={relationFrom} disabled={disabled} onChange={(event) => setRelationFrom(event.target.value)}>
          <option value="">Choose source</option>{record.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select></label>
        <label>Relationship<select className={field} value={relationKind} disabled={disabled} onChange={(event) => {
          const kind = ICARUS_INTERVENTION_RELATIONSHIPS.find((entry) => entry === event.target.value);
          if (kind) setRelationKind(kind);
        }}>{ICARUS_INTERVENTION_RELATIONSHIPS.map((kind) => <option key={kind} value={kind}>
          {kind === "blocks" ? "blocks — selected blocker releases after effective verification" : kind}
        </option>)}</select></label>
        <p>Prerequisite-of requires current verified effective protection. Must-precede additionally requires verification before the successor is selected. Blocks applies only while its source is selected and not verified effective. Mutual exclusion is a selection conflict; complements is non-blocking context.</p>
        <label>To option<select className={field} value={relationTo} disabled={disabled} onChange={(event) => setRelationTo(event.target.value)}>
          <option value="">Choose destination</option>{allOptions.map((option) => <option key={option.id} value={option.id}>{option.name} ({option.id})</option>)}
        </select></label>
        <button className={button} disabled={disabled || !relationFrom || !relationTo || !rationale.trim()} onClick={() =>
          update({ ...record, relationships: [...record.relationships, {
            id: props.createId(), fromOptionId: relationFrom, toOptionId: relationTo, kind: relationKind,
            rationale: rationale.trim(), recordedAt: new Date().toISOString(), recordedByPersonId: actor,
          }] })}>Record relationship</button>
        {record.relationships.map((relation) => <p key={relation.id}>{relation.fromOptionId} {relation.kind} {relation.toOptionId}: {relation.rationale}</p>)}
        <label>Effect source<select className={field} value={effectOption} disabled={disabled} onChange={(event) => setEffectOption(event.target.value)}>
          <option value="">Choose option</option>{record.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select></label>
        <label>Affected target<select className={field} value={effectTarget} disabled={disabled} onChange={(event) => setEffectTarget(event.target.value)}>
          <option value="">Choose affected target</option>{effectTargets.map((target) => <option key={target.key} value={target.key}>{target.title}</option>)}
        </select></label>
        <label>Declared direction<select className={field} value={effectDirection} disabled={disabled} onChange={(event) => {
          const direction = ICARUS_INTERVENTION_EFFECTS.find((entry) => entry === event.target.value);
          if (direction) setEffectDirection(direction);
        }}>{ICARUS_INTERVENTION_EFFECTS.map((direction) => <option key={direction}>{direction}</option>)}</select></label>
        <Choices label="Evidence references (if available)" items={evidence} selected={effectEvidence} disabled={disabled}
          onChange={setEffectEvidence} />
        <button className={button} disabled={disabled || !effectOption || !effectTarget || !rationale.trim()} onClick={() => {
          const target = effectTargets.find((entry) => entry.key === effectTarget);
          if (!target) { fail("The affected target no longer exists."); return; }
          update({ ...record, effects: [...record.effects, {
            id: props.createId(), optionId: effectOption, target: target.target, direction: effectDirection,
            rationale: rationale.trim(), evidence: evidence.filter((entry) => effectEvidence.includes(entry.id))
              .map((entry) => ({ assessmentId: entry.assessmentId, failureModeId: entry.failureModeId, evidenceId: entry.id })),
            recordedAt: new Date().toISOString(), recordedByPersonId: actor,
          }] });
        }}>Record consideration (does not change live exposure)</button>
        {record.effects.map((effect) => <p key={effect.id}>{effect.optionId}: {effect.direction} - {JSON.stringify(effect.target)}. {effect.rationale}</p>)}
      </details>
      <details className="mt-2 text-[11px]"><summary>Selection history, outcomes and prior same-cause context</summary>
        {view.learningConclusions.map((learning) => <p key={learning.lessonId}>
          Explicit Lesson {learning.lessonId}: {learning.validity}; embedding {learning.institutionalisation || "Not recorded"}.
          {" "}{learning.attentionReasons.join("; ")}
        </p>)}
        {view.lifecycleHistory.map((history) => <div key={history.assessmentId} className="mb-2">
          <p>Explicit lifecycle history for assessment {history.assessmentId}. Shared wording does not establish shared cause.</p>
          {history.reviews.map((review) => <p key={review.record.id}>
            {review.record.reviewedAt}: {review.record.outcome} ({review.record.scope.kind}) - now {review.validity}.
            {" "}{review.reasons.join("; ")} Human review: {review.record.rationale}
          </p>)}
          {history.regressions.map((regression) => <p key={regression.record.id}>
            Confirmed {regression.record.confirmedAt}: {regression.record.id} - human-recorded explanation {regression.record.explanation};
            {" "}explicit cause IDs {regression.record.causeIds.join(", ") || "none"}.
            {" "}{regression.valid ? "Valid history" : regression.issues.join("; ")}
            {regression.reResolutionReviewId ? `; re-resolution ${regression.reResolutionReviewId}` : ""}
          </p>)}
        </div>)}
        {record.selectionHistory.map((event) => <p key={event.id}>{event.selectedAt} - {event.optionId} - {event.rationale} (Person {event.selectedByPersonId})</p>)}
        {[...view.outcomes, ...view.priorOutcomes].map((outcome) => <p key={`${outcome.decisionId}:${outcome.optionId}:${outcome.record.id}`}>
          {outcome.decisionId === record.id ? "This intervention" : "Prior explicitly shared cause"}: {outcome.record.outcome}
          {" "}- option {outcome.optionId}
          {" "}- {outcome.treatmentCurrent ? "Current treatment evidence" : "Historical / superseded treatment evidence"}
          {" "}- {outcome.current ? "Current intervention context, not causal proof" : "Not current intervention evidence"}
          {!outcome.postSelectionEvidence ? " (predates or does not match this selection and target linkage)" : ""}
          {" "}- treatment attribution {outcome.treatmentAttribution}; intervention causation {outcome.causalAttribution}.
          {" "}Target {outcome.record.treatmentTargetId}; outcome {outcome.record.id}; {outcome.record.verificationNote}
          {" "}- verified {outcome.record.verifiedAt} by Person {outcome.record.verifiedByPersonId};
          {" "}after-state {outcome.record.afterState.state}; {outcome.record.evidence.length} evidence references.
        </p>)}
        {!view.priorOutcomes.length ? <p>No relevant prior verified evidence for this explicit cause.</p> : null}
        {view.priorEffects.map((effect) => <p key={effect.id}>Prior declared consideration, not an observed outcome: {effect.direction} - {effect.rationale}</p>)}
      </details>
      <details className="mt-2 text-[11px]"><summary>Link existing Lesson to reviewed outcome context</summary>
        <label>Lesson<select className={field} disabled={appendOnlyDisabled} value={lessonId} onChange={(event) => setLessonId(event.target.value)}>
          <option value="">Choose existing Lesson</option>{props.sources.filter((source) => source.recordType === "Lesson")
            .map((source) => <option key={source.recordId} value={source.recordId}>{source.title} ({source.status})</option>)}
        </select></label>
        <label>Outcome evidence<select className={field} disabled={appendOnlyDisabled} value={outcomeId} onChange={(event) => setOutcomeId(event.target.value)}>
          <option value="">Choose recorded outcome</option>{props.index.learningInput.filter((entry) =>
            entry.interventionContext?.decisionIds.includes(record.id)).map((entry) =>
            <option key={entry.record.id} value={entry.record.id}>{entry.record.outcome}: {entry.record.id}</option>)}
        </select></label>
        <Choices label="Explicit reusable cause scope (empty means local only)"
          items={props.index.causes.filter((cause) => record.causeIds.includes(cause.id)).map((cause) => ({ id: cause.id, title: cause.title }))}
          selected={lessonCauses} disabled={appendOnlyDisabled} onChange={setLessonCauses} />
        {record.status === "Superseded" ? <label>Historical learning-link rationale
          <textarea className={field} disabled={appendOnlyDisabled} value={rationale}
            onChange={(event) => setRationale(event.target.value)} />
        </label> : null}
        <button className={button} disabled={appendOnlyDisabled || !lessonId || !outcomeId || !rationale.trim()} onClick={() =>
          update({ ...record, lessonLinks: [...record.lessonLinks, {
            id: props.createId(), lessonId, outcomeIds: [outcomeId], causeIds: lessonCauses,
            rationale: rationale.trim(), linkedAt: new Date().toISOString(), linkedByPersonId: actor,
          }] })}>Record explicit learning link</button>
        {view.learning.map((entry) => <p key={`${entry.decisionId}:${entry.lessonId}:${entry.outcomeIds.join(",")}`}>
          <button className="underline" onClick={() => props.onOpenRecord("Lesson", entry.lessonId)}>Lesson {entry.lessonId}</button>
          {" "}- {entry.reviewed ? "Reviewed reusable context" : "Local / unreviewed context"}
          {" "}- {entry.currentEvidence ? "Current supporting treatment evidence" : "Evidence historical / superseded; review contradictions"}
          {" "}- {entry.rationale}
        </p>)}
      </details>
      <button className={`${button} mt-2`} disabled={disabled || record.status === "Superseded" || !rationale.trim()} onClick={() =>
        update({ ...record, status: "Superseded", rationale: `${record.rationale}\nContext superseded: ${rationale.trim()}` })}>
        Supersede context without deleting treatments or history
      </button>
    </details>
  );
}

export default function IcarusInterventionSection(props: Props) {
  const [actor, setActor] = useState("");
  const [assessmentId, setAssessmentId] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const disabled = !props.writable || !props.people.some((person) => person.id === actor && person.status === "Active");
  const now = () => new Date().toISOString();
  const commit = (next: IcarusAssessmentRecord[]) => {
    if (disabled) { setError("Choose an active Person and wait for writable Icarus storage."); return; }
    setError("");
    props.onChange(next.map((assessment, index) => assessment === props.assessments[index]
      ? assessment : { ...assessment, updatedAt: now() }));
  };
  const updateDecision = (record: IcarusInterventionDecisionRecord) => commit(props.assessments.map((assessment) =>
    (assessment.interventionDecisions ?? []).some((entry) => entry.id === record.id)
      ? { ...assessment, interventionDecisions: assessment.interventionDecisions?.map((entry) => entry.id === record.id
        ? { ...record, updatedAt: now(), updatedByPersonId: actor } : entry) } : assessment));
  return (
    <section className="mt-4 rounded-xl border border-[#c9b8a3] bg-[#f5efe6] p-4" aria-label="Causal intervention decisions">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em]">Causal intervention decisions</h2>
      <p className="mt-1 text-[12px]">Explicit human-confirmed cause identity; no text matching, automatic selection or causal success inference.</p>
      {error ? <p role="alert" className="mt-2 text-[12px] text-[#8b3d28]">{error}</p> : null}
      <label className="mt-2 block text-[11px]">Context author (Person identity, not authority)
        <select className={field} disabled={!props.writable} value={actor} onChange={(event) => setActor(event.target.value)}>
          <option value="">Choose active Person</option>{props.people.filter((person) => person.status === "Active").map((person) =>
            <option key={person.id} value={person.id}>{person.name}</option>)}
        </select>
      </label>
      <label className="mt-2 block text-[11px]">Home assessment for new context
        <select className={field} value={assessmentId} disabled={disabled} onChange={(event) => setAssessmentId(event.target.value)}>
          <option value="">Choose assessment</option>{props.assessments.map((assessment) =>
            <option key={assessment.id} value={assessment.id}>{assessment.outcome}</option>)}
        </select>
      </label>
      <input className={field} aria-label="New cause or intervention decision title" value={title} disabled={disabled}
        onChange={(event) => setTitle(event.target.value)} />
      <div className="mt-2 flex gap-2">
        <button className={button} disabled={disabled || !assessmentId || !title.trim()} onClick={() => {
          const at = now();
          commit(props.assessments.map((assessment) => assessment.id !== assessmentId ? assessment : ({
            ...assessment, causes: [...(assessment.causes ?? []), {
              ...emptyIcarusInterventionScope(assessmentId), id: props.createId(), title: title.trim(), description: "",
              createdAt: at, updatedAt: at, createdByPersonId: actor, updatedByPersonId: actor,
            }],
          }))); setTitle("");
        }}>Create explicit cause</button>
        <button className={button} disabled={disabled || !assessmentId || !title.trim()} onClick={() => {
          const at = now();
          commit(props.assessments.map((assessment) => assessment.id !== assessmentId ? assessment : ({
            ...assessment, interventionDecisions: [...(assessment.interventionDecisions ?? []), {
              ...emptyIcarusInterventionScope(assessmentId), id: props.createId(), title: title.trim(),
              createdAt: at, updatedAt: at, createdByPersonId: actor, updatedByPersonId: actor,
              causeIds: [], status: "Draft", rationale: "", options: [], selectionHistory: [], relationships: [], effects: [], lessonLinks: [],
            }],
          }))); setTitle("");
        }}>Structure intervention decision</button>
      </div>
      <details className="mt-3 text-[11px]"><summary>Explicit causes (share by ID, never by title)</summary>
        {props.index.causes.map((cause) => {
          const update = (scope: IcarusInterventionScope, description: string) => commit(props.assessments.map((assessment) =>
            (assessment.causes ?? []).some((entry) => entry.id === cause.id)
              ? { ...assessment, causes: assessment.causes?.map((entry) => entry.id === cause.id
                ? { ...entry, ...scope, description, updatedAt: now(), updatedByPersonId: actor } : entry) } : assessment));
          return <div key={cause.id} className="mt-2 rounded border border-[#d3cbc3] bg-white p-2">
            <p>{cause.title} ({cause.id})</p>
            <textarea className={field} aria-label={`Mechanism for ${cause.title}`} disabled={disabled} value={cause.description}
              onChange={(event) => update(cause, event.target.value)} />
            <Scope value={cause} assessments={props.assessments} sources={props.sources} disabled={disabled}
              onChange={(scope) => update(scope, cause.description)} />
          </div>;
        })}
      </details>
      {props.index.decisions.map((view) => <DecisionEditor key={view.record.id} view={view} props={props}
        actor={disabled ? "" : actor} fail={setError} update={updateDecision} linkTarget={(optionId, targetId) => {
          const target = props.treatment.targets.find((entry) => entry.id === targetId);
          if (!target || !props.assessments.some((assessment) => assessment.id === target.assessmentId)) {
            setError("The treatment target or home assessment is missing."); return;
          }
          const at = now();
          commit(props.assessments.map((assessment) => {
            let next = assessment;
            if (assessment.id === target.assessmentId && !(assessment.treatmentTargets ?? []).some((entry) => entry.id === targetId)) {
              next = { ...next, treatmentTargets: [...(assessment.treatmentTargets ?? []), {
                ...persistIcarusTreatmentTarget(target, at),
                executionLinks: target.executionLinks.map((link) => ({
                  recordType: link.recordType, recordId: link.recordId, linkedAt: link.linkedAt ?? at,
                })),
              }] };
            }
            if ((assessment.interventionDecisions ?? []).some((entry) => entry.id === view.record.id)) {
              next = { ...next, interventionDecisions: assessment.interventionDecisions?.map((entry) =>
                entry.id !== view.record.id ? entry : {
                  ...entry, updatedAt: at, updatedByPersonId: actor, options: entry.options.map((option) =>
                    option.id !== optionId || option.treatmentLinks.some((link) => link.targetId === targetId) ? option : {
                      ...option, treatmentLinks: [...option.treatmentLinks, { targetId, linkedAt: at, linkedByPersonId: actor }],
                    }),
                }) };
            }
            return next;
          }));
        }} />)}
    </section>
  );
}
