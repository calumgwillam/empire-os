"use client";

import { useState } from "react";
import {
  ICARUS_CONTROL_TEST_RESULTS,
  ICARUS_MAX_TEST_CADENCE_DAYS,
  type IcarusAssessmentRecord,
  type IcarusControlTestResult,
} from "../lib/icarus";
import type { IcarusAssessmentAssurance } from "../lib/icarus-assurance";
import type { IcarusAssuranceRollup } from "../lib/icarus-assurance-rollup";

export type IcarusAssurancePersonOption = { id: string; name: string; status: string };
export type IcarusAssuranceActionOption = { id: string; title: string; status: string };

const inputClass = "mt-1 w-full rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[12px] text-[#171717]";
const labelClass = "block text-[10px] font-medium uppercase tracking-[0.14em] text-[#5e5953]";
const buttonClass = "w-fit rounded-md border border-[#315b45] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[#315b45] disabled:opacity-40";

function personName(people: readonly IcarusAssurancePersonOption[], id: string | undefined): string {
  if (!id) return "Unassigned";
  const person = people.find((candidate) => candidate.id === id);
  return person ? `${person.name}${person.status === "Active" ? "" : ` (${person.status})`}` : `Unknown person (${id})`;
}

// Ownership is always a Person id. Inactive/unknown current values stay selectable so they are never silently lost.
function PersonSelect({
  label,
  people,
  value,
  disabled,
  allowEmpty = true,
  onChange,
}: {
  label: string;
  people: readonly IcarusAssurancePersonOption[];
  value: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  onChange: (personId: string) => void;
}) {
  const options = people.filter((person) => person.status === "Active" || person.id === value);
  return (
    <label className={labelClass}>
      {label}
      <select className={inputClass} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allowEmpty ? "Unassigned" : "Select a person"}</option>
        {value && !options.some((person) => person.id === value) ? <option value={value}>Unknown person ({value})</option> : null}
        {options.map((person) => (
          <option key={person.id} value={person.id}>{person.name}{person.status === "Active" ? "" : ` (${person.status})`}</option>
        ))}
      </select>
    </label>
  );
}

export function IcarusAssuranceRollupSection({
  rollup,
  objectiveTitle,
}: {
  rollup?: IcarusAssuranceRollup;
  objectiveTitle: (objectiveId: string) => string;
}) {
  if (!rollup) return null;
  const pillars = rollup.pillars.filter((pillar) => pillar.posture !== "No material exposure");
  if (pillars.length === 0 && rollup.objectives.length === 0 && rollup.unattributedMaterialAssessmentIds.length === 0) return null;
  return (
    <section aria-label="Strategic assurance" className="mt-4 rounded-xl border border-[#c9b8a3] bg-[#f5efe6] p-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#51483e]">Strategic assurance · pillars and objectives</h2>
      <ul className="mt-2 space-y-1.5">
        {pillars.map((pillar) => (
          <li key={pillar.pillarId} className="text-[12px] leading-5 text-[#4d4944]">
            <span className="font-medium text-[#171717]">{pillar.pillarId}: {pillar.posture}</span>
            {` — ${pillar.materialAssessmentIds.length} material risk${pillar.materialAssessmentIds.length === 1 ? "" : "s"}`}
            {`; ${pillar.unownedMaterialAssessmentIds.length} without an active owner`}
            {`; ${pillar.failedControlCount} failing control${pillar.failedControlCount === 1 ? "" : "s"}`}
            {`; ${pillar.overdueObligationCount} overdue obligation${pillar.overdueObligationCount === 1 ? "" : "s"}`}
            {pillar.activeAcceptanceCount + pillar.expiredAcceptanceCount > 0
              ? `; acceptances ${pillar.activeAcceptanceCount} active / ${pillar.expiredAcceptanceCount} expired`
              : ""}
          </li>
        ))}
        {rollup.objectives.map((objective) => (
          <li key={objective.objectiveId} className="text-[12px] leading-5 text-[#4d4944]">
            <span className="font-medium text-[#171717]">{objectiveTitle(objective.objectiveId)}: {objective.protection}</span>
            {" — weakest: "}
            <a href={`#icarus-assessment-${objective.weakestAssessmentId}`} className="underline">{objective.weakestAssessmentId}</a>
            {objective.escalation !== "None" ? ` (${objective.escalation.toLowerCase()})` : ""}
          </li>
        ))}
        {rollup.unattributedMaterialAssessmentIds.length > 0 ? (
          <li className="text-[12px] leading-5 text-[#4d4944]">
            {rollup.unattributedMaterialAssessmentIds.length} material risk{rollup.unattributedMaterialAssessmentIds.length === 1 ? " has" : "s have"} no operating pillar link.
          </li>
        ) : null}
      </ul>
    </section>
  );
}

export default function IcarusAssuranceSection({
  assessment,
  assurance,
  people,
  actions,
  writable,
  createId,
  onUpdate,
}: {
  assessment: IcarusAssessmentRecord;
  assurance?: IcarusAssessmentAssurance;
  people: readonly IcarusAssurancePersonOption[];
  actions: readonly IcarusAssuranceActionOption[];
  writable: boolean;
  createId: () => string;
  onUpdate: (update: (assessment: IcarusAssessmentRecord) => IcarusAssessmentRecord) => void;
}) {
  const [reviewerId, setReviewerId] = useState("");
  const [testDrafts, setTestDrafts] = useState<Record<string, { personId: string; result: IcarusControlTestResult; evidenceIds: string[]; note: string }>>({});
  const [acceptanceDraft, setAcceptanceDraft] = useState({ failureModeIds: [] as string[], personId: "", rationale: "", reviewBy: "", conditions: "" });

  if (!assurance) return null;
  const testDraft = (controlId: string) => testDrafts[controlId] ?? { personId: "", result: "Passed" as IcarusControlTestResult, evidenceIds: [], note: "" };
  const updateTestDraft = (controlId: string, update: Partial<ReturnType<typeof testDraft>>) =>
    setTestDrafts((current) => ({ ...current, [controlId]: { ...testDraft(controlId), ...update } }));
  const updateControl = (controlId: string, update: (control: IcarusAssessmentRecord["controls"][number]) => IcarusAssessmentRecord["controls"][number]) =>
    onUpdate((current) => ({ ...current, controls: current.controls.map((control) => control.id === controlId ? update(control) : control) }));

  const recordTest = (controlId: string) => {
    const draft = testDraft(controlId);
    if (!draft.personId) return;
    updateControl(controlId, (control) => ({
      ...control,
      assuranceTests: [...(control.assuranceTests ?? []), {
        id: createId(),
        testedAt: new Date().toISOString(),
        testedByPersonId: draft.personId,
        result: draft.result,
        evidenceIds: draft.evidenceIds,
        ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      }],
    }));
    setTestDrafts((current) => ({ ...current, [controlId]: { ...draft, evidenceIds: [], note: "" } }));
  };

  const recordAcceptance = () => {
    const draft = acceptanceDraft;
    if (draft.failureModeIds.length === 0 || !draft.personId || !draft.rationale.trim() || !draft.reviewBy) return;
    onUpdate((current) => ({
      ...current,
      acceptances: [...(current.acceptances ?? []), {
        id: createId(),
        failureModeIds: draft.failureModeIds,
        acceptedByPersonId: draft.personId,
        rationale: draft.rationale.trim(),
        acceptedAt: new Date().toISOString(),
        reviewBy: draft.reviewBy,
        ...(draft.conditions.trim() ? { conditions: draft.conditions.trim() } : {}),
      }],
    }));
    setAcceptanceDraft({ failureModeIds: [], personId: "", rationale: "", reviewBy: "", conditions: "" });
  };

  const actionTitle = (id: string) => {
    const action = actions.find((candidate) => candidate.id === id);
    return action ? `${action.title} (${action.status})` : `Missing action ${id}`;
  };
  const nextObligation = assurance.obligations[0];
  const modeById = new Map(assessment.failureModes.map((mode) => [mode.id, mode] as const));

  return (
    <div className="mt-5 border-t border-[#d3cbc3] pt-4" aria-label="Assurance">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#4d4944]">Assurance</h3>
      <p className="mt-1 text-[12px] leading-5 text-[#4d4944]">
        <span className="font-medium text-[#171717]">{assurance.state}</span>
        {assurance.escalation !== "None" ? ` · ${assurance.escalation}` : ""}
        {` · Risk owner: ${personName(people, assurance.riskOwnerPersonId)}`}
        {assurance.founderOwnershipConcern ? " · founder-owned while founder dependency is active" : ""}
        {` · Control independence: unknown`}
      </p>
      {nextObligation ? (
        <p className="mt-1 text-[12px] leading-5 text-[#4d4944]">Next weakness to address: {nextObligation.label} — {nextObligation.reason}</p>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <PersonSelect
          label="Accountable risk owner"
          people={people}
          value={assessment.accountableOwnerPersonId ?? ""}
          disabled={!writable}
          onChange={(personId) => onUpdate((current) => ({ ...current, accountableOwnerPersonId: personId || undefined }))}
        />
        <label className={labelClass}>Next risk review by
          <input type="date" className={inputClass} value={assessment.nextReviewBy ?? ""} disabled={!writable} onChange={(event) => onUpdate((current) => ({ ...current, nextReviewBy: event.target.value || undefined }))} />
        </label>
        {writable ? (
          <div>
            <PersonSelect label="Record risk review by" people={people} value={reviewerId} allowEmpty={false} onChange={setReviewerId} />
            <button type="button" className={`${buttonClass} mt-1`} disabled={!reviewerId} onClick={() => {
              onUpdate((current) => ({ ...current, reviewedAt: new Date().toISOString(), reviewedByPersonId: reviewerId }));
              setReviewerId("");
            }}>Record review</button>
          </div>
        ) : null}
      </div>
      {assessment.reviewedAt ? (
        <p className="mt-1 text-[10px] text-[#6a625d]">Last reviewed {assessment.reviewedAt} by {personName(people, assessment.reviewedByPersonId)}</p>
      ) : null}

      {assurance.obligations.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5e5953]">Assurance obligations</h4>
          <ul className="mt-1 space-y-2">
            {assurance.obligations.map((obligation) => (
              <li key={obligation.id} className="rounded-md bg-[#f7f4f1] p-2 text-[11px] leading-5 text-[#2f2b28]">
                <span className="font-medium">{obligation.label}</span>
                {` · ${obligation.kind} · ${obligation.materiality} · ${obligation.dueState}${obligation.dueAt ? ` (${obligation.dueAt.slice(0, 10)})` : ""}`}
                {` · ${obligation.ownerSource === "None" ? "No owner" : `${obligation.ownerSource}: ${personName(people, obligation.ownerPersonId)}`}`}
                {` · Remediation: ${obligation.remediation}`}
                {obligation.escalates ? " · escalates" : ""}
                <div>{obligation.reason}</div>
                {obligation.actionIds.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {obligation.actionIds.map((actionId) => (
                      <span key={actionId} className="rounded border border-[#d3cbc3] bg-white px-2 py-0.5 text-[10px]">
                        {actionTitle(actionId)}
                      </span>
                    ))}
                  </div>
                ) : null}
                <a className="mt-1 inline-block text-[10px] underline" href="#icarus-treatment-routing">Route or update execution in Treatment status</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {assurance.controls.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5e5953]">Control assurance</h4>
          {assurance.controls.map((controlAssurance) => {
            const control = assessment.controls.find((entry) => entry.id === controlAssurance.controlId);
            if (!control) return null;
            const mode = modeById.get(control.failureModeId);
            const draft = testDraft(control.id);
            return (
              <div key={control.id} className="mt-2 rounded-md bg-[#f7f4f1] p-2">
                <p className="text-[11px] text-[#171717]">
                  <span className="font-medium">{control.intervention}</span>
                  {` · ${controlAssurance.status} · Evidence: ${controlAssurance.evidence}`}
                  {controlAssurance.lastEvent ? ` · Last: ${controlAssurance.lastEvent.result} (${controlAssurance.lastEvent.source}) ${controlAssurance.lastEvent.at.slice(0, 10)}` : " · Never tested"}
                  {controlAssurance.nextDueAt ? ` · Next test due ${controlAssurance.nextDueAt.slice(0, 10)}` : ""}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <PersonSelect label="Control owner" people={people} value={control.ownerPersonId ?? ""} disabled={!writable} onChange={(personId) => updateControl(control.id, (entry) => ({ ...entry, ownerPersonId: personId || undefined }))} />
                  <label className={labelClass}>Test cadence (days)
                    <input type="number" min={1} max={ICARUS_MAX_TEST_CADENCE_DAYS} className={inputClass} value={control.testCadenceDays ?? ""} disabled={!writable} onChange={(event) => {
                      const days = Number(event.target.value);
                      updateControl(control.id, (entry) => ({
                        ...entry,
                        testCadenceDays: Number.isInteger(days) && days >= 1 && days <= ICARUS_MAX_TEST_CADENCE_DAYS ? days : undefined,
                      }));
                    }} />
                  </label>
                </div>
                {writable ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <PersonSelect label="Tested by" people={people} value={draft.personId} allowEmpty={false} onChange={(personId) => updateTestDraft(control.id, { personId })} />
                    <label className={labelClass}>Test result
                      <select className={inputClass} value={draft.result} onChange={(event) => updateTestDraft(control.id, { result: event.target.value as IcarusControlTestResult })}>
                        {ICARUS_CONTROL_TEST_RESULTS.map((result) => <option key={result}>{result}</option>)}
                      </select>
                    </label>
                    <label className={labelClass}>Test evidence
                      <select multiple className={`${inputClass} min-h-16`} value={draft.evidenceIds} onChange={(event) => updateTestDraft(control.id, { evidenceIds: Array.from(event.target.selectedOptions, (option) => option.value) })}>
                        {(mode?.evidence ?? []).map((evidence) => <option key={evidence.id} value={evidence.id}>{evidence.statement}</option>)}
                      </select>
                    </label>
                    <label className={labelClass}>Note (optional)
                      <input className={inputClass} value={draft.note} onChange={(event) => updateTestDraft(control.id, { note: event.target.value })} />
                    </label>
                    <button type="button" className={buttonClass} disabled={!draft.personId} onClick={() => recordTest(control.id)}>Record control test</button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mt-3">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5e5953]">Accepted exposure</h4>
        <p className="mt-1 text-[10px] text-[#6a625d]">Acceptance records who decided to tolerate a failure mode until a review date. It never removes the risk from Command or Founder Focus.</p>
        {assurance.acceptances.map((acceptance) => (
          <div key={acceptance.acceptanceId} className="mt-2 rounded-md bg-[#f7f4f1] p-2 text-[11px] leading-5 text-[#2f2b28]">
            <span className="font-medium">{acceptance.validity}{acceptance.current ? "" : " (superseded)"}</span>
            {` · ${acceptance.failureModeIds.map((id) => modeById.get(id)?.mechanism || id).join("; ")}`}
            {` · Approved by ${personName(people, acceptance.acceptedByPersonId)} · Review by ${acceptance.reviewBy}`}
            {acceptance.invalidReasons.length > 0 ? ` · ${acceptance.invalidReasons.join(", ")}` : ""}
            <div>{acceptance.rationale}{acceptance.conditions ? ` — Conditions: ${acceptance.conditions}` : ""}</div>
            {writable && acceptance.validity !== "Revoked" ? (
              <button type="button" className="mt-1 text-[10px] font-medium text-[#6a3328]" onClick={() => onUpdate((current) => ({
                ...current,
                acceptances: (current.acceptances ?? []).map((entry) => entry.id === acceptance.acceptanceId ? { ...entry, revokedAt: new Date().toISOString() } : entry),
              }))}>Revoke acceptance</button>
            ) : null}
          </div>
        ))}
        {writable && assessment.failureModes.length > 0 ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className={labelClass}>Failure modes to accept
              <select multiple className={`${inputClass} min-h-16`} value={acceptanceDraft.failureModeIds} onChange={(event) => setAcceptanceDraft((current) => ({ ...current, failureModeIds: Array.from(event.target.selectedOptions, (option) => option.value) }))}>
                {assessment.failureModes.map((mode) => <option key={mode.id} value={mode.id}>{mode.mechanism}</option>)}
              </select>
            </label>
            <PersonSelect label="Accepted by" people={people} value={acceptanceDraft.personId} allowEmpty={false} onChange={(personId) => setAcceptanceDraft((current) => ({ ...current, personId }))} />
            <label className={labelClass}>Rationale
              <textarea rows={2} className={inputClass} value={acceptanceDraft.rationale} onChange={(event) => setAcceptanceDraft((current) => ({ ...current, rationale: event.target.value }))} />
            </label>
            <label className={labelClass}>Review by
              <input type="date" className={inputClass} value={acceptanceDraft.reviewBy} onChange={(event) => setAcceptanceDraft((current) => ({ ...current, reviewBy: event.target.value }))} />
            </label>
            <label className={labelClass}>Conditions (optional)
              <input className={inputClass} value={acceptanceDraft.conditions} onChange={(event) => setAcceptanceDraft((current) => ({ ...current, conditions: event.target.value }))} />
            </label>
            <button type="button" className={buttonClass} disabled={acceptanceDraft.failureModeIds.length === 0 || !acceptanceDraft.personId || !acceptanceDraft.rationale.trim() || !acceptanceDraft.reviewBy} onClick={recordAcceptance}>Record accepted exposure</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
