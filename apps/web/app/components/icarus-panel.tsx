"use client";

import { useEffect, useState } from "react";
import {
  getIcarusReferenceKey,
  type IcarusAssessmentRecord,
  type IcarusAssessmentStatus,
  type IcarusControl,
  type IcarusControlEffectiveness,
  type IcarusControlLifecycle,
  type IcarusEvidence,
  type IcarusEvidenceReview,
  type IcarusFailureMode,
  type IcarusRecordReference,
  type IcarusReview,
  type IcarusReviewFinding,
  type IcarusSourceRecord,
} from "../lib/icarus";
import type { IcarusAttentionReference } from "../lib/icarus-strategic-attention";
import type { IcarusSystemicExposure } from "../lib/icarus-systemic-exposure";
import type { IcarusAssuranceResult } from "../lib/icarus-assurance";
import type { IcarusAssuranceRollup } from "../lib/icarus-assurance-rollup";
import IcarusAssuranceSection, {
  IcarusAssuranceRollupSection,
  type IcarusAssurancePersonOption,
} from "./icarus-assurance-section";
import IcarusFailureChainSection from "./icarus-failure-chain-section";
import type {
  IcarusFailureChainIntelligence,
  IcarusHealthTriggeredChain,
} from "../lib/icarus-failure-chain-analysis";
import type { IcarusDependencyHealth } from "../lib/icarus-dependency-health";
import type {
  IcarusDependencyResilience,
  IcarusResilienceIntervention,
} from "../lib/icarus-dependency-resilience";
import type { IcarusStrategicIntelligence } from "../lib/icarus-intelligence-pipeline";
import type { IcarusStrategicSignal } from "../lib/icarus-strategic-attention";
import type { IcarusStressTestingInput } from "../lib/icarus-stress-testing";
import IcarusStressLab from "./icarus-stress-lab";
import IcarusTreatmentSection from "./icarus-treatment-section";
import IcarusInterventionSection from "./icarus-intervention-section";
import type { IcarusInterventionIndex } from "../lib/icarus-intervention-decision";
import {
  createIcarusStressTreatmentTarget,
  type IcarusTreatmentExecution,
  type IcarusTreatmentIndex,
} from "../lib/icarus-treatment";

type IcarusPanelProps = {
  assessments: readonly IcarusAssessmentRecord[];
  sources: readonly IcarusSourceRecord[];
  loaded: boolean;
  writable: boolean;
  onChange: (assessments: IcarusAssessmentRecord[]) => void;
  createId: () => string;
  // Derived once by the Icarus intelligence pipeline; the panel never re-derives reviews.
  reviews: readonly IcarusReview[];
  unresolvedFindings: readonly IcarusReviewFinding[];
  focusTarget?: (IcarusAttentionReference & { requestId: number }) | null;
  systemicExposure?: IcarusSystemicExposure;
  assurance?: IcarusAssuranceResult;
  assuranceRollup?: IcarusAssuranceRollup;
  failureChains?: IcarusFailureChainIntelligence;
  healthTriggeredChains?: readonly IcarusHealthTriggeredChain[];
  criticalDependencies?: readonly IcarusDependencyHealth[];
  dependencyResilience?: readonly IcarusDependencyResilience[];
  resilienceInterventions?: readonly IcarusResilienceIntervention[];
  stressTestingInput?: IcarusStressTestingInput;
  stressBaseline?: IcarusStrategicIntelligence;
  treatmentIndex?: IcarusTreatmentIndex;
  interventionIndex?: IcarusInterventionIndex;
  closedAssessmentWarnings?: readonly IcarusStrategicSignal[];
  people?: readonly IcarusAssurancePersonOption[];
  actions?: readonly IcarusTreatmentExecution[];
  projects?: readonly IcarusTreatmentExecution[];
  onOpenRecord?: (recordType: string, recordId: string) => void;
};

const focusRingClass = " ring-2 ring-[#755520] ring-offset-2";

const assessmentStatuses: readonly IcarusAssessmentStatus[] = ["Open", "Monitoring", "Closed"];
const evidenceReviews: readonly IcarusEvidenceReview[] = ["Unreviewed", "Supports", "Contradicts", "Unresolved"];
const controlLifecycles: readonly IcarusControlLifecycle[] = ["Planned", "Active", "Monitoring", "Ineffective", "Retired"];
const controlEffectiveness: readonly IcarusControlEffectiveness[] = ["Unknown", "Untested", "Evidence supports", "Evidence contradicts", "Unresolved"];
const inputClass = "mt-1 w-full rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[12px] text-[#171717]";
const labelClass = "block text-[10px] font-medium uppercase tracking-[0.14em] text-[#5e5953]";

function referenceTitle(reference: IcarusRecordReference, sources: readonly IcarusSourceRecord[]): string {
  const source = sources.find((candidate) => getIcarusReferenceKey(candidate) === getIcarusReferenceKey(reference));
  return source
    ? `${source.recordType}: ${source.title} (${source.recordId})`
    : `${reference.recordType}: ${reference.recordId} (source missing)`;
}

function SourceSelect({
  sources,
  value,
  onChange,
  label,
}: {
  sources: readonly IcarusSourceRecord[];
  value: string;
  onChange: (reference: IcarusRecordReference | null) => void;
  label: string;
}) {
  return (
    <label className={labelClass}>
      {label}
      <select
        className={inputClass}
        value={value}
        onChange={(event) => onChange(sources.find((source) => getIcarusReferenceKey(source) === event.target.value) || null)}
      >
        <option value="">Select an existing record</option>
        {sources.map((source) => (
          <option key={getIcarusReferenceKey(source)} value={getIcarusReferenceKey(source)}>
            {source.recordType}: {source.title} · {source.recordId}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function IcarusPanel({
  assessments,
  sources,
  loaded,
  writable,
  onChange,
  createId,
  reviews,
  unresolvedFindings: openFindings,
  focusTarget = null,
  systemicExposure,
  assurance,
  assuranceRollup,
  failureChains,
  healthTriggeredChains = [],
  criticalDependencies = [],
  dependencyResilience = [],
  resilienceInterventions = [],
  stressTestingInput,
  stressBaseline,
  treatmentIndex,
  interventionIndex,
  closedAssessmentWarnings = [],
  people = [],
  actions = [],
  projects = [],
  onOpenRecord = () => undefined,
}: IcarusPanelProps) {
  useEffect(() => {
    if (!focusTarget || typeof document === "undefined") return;
    const elementIds = [
      focusTarget.controlId ? `icarus-control-${focusTarget.controlId}` : null,
      focusTarget.failureModeId ? `icarus-failure-mode-${focusTarget.failureModeId}` : null,
      `icarus-assessment-${focusTarget.assessmentId}`,
    ];
    const element = elementIds
      .map((id) => (id ? document.getElementById(id) : null))
      .find((candidate): candidate is HTMLElement => Boolean(candidate));
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusTarget]);

  const [outcomeDraft, setOutcomeDraft] = useState("");
  const [modeDrafts, setModeDrafts] = useState<Record<string, { mechanism: string; vulnerability: string }>>({});
  const [evidenceDrafts, setEvidenceDrafts] = useState<Record<string, {
    statement: string;
    origin: "Source record" | "Direct observation";
    referenceKey: string;
    recordedBy: string;
    observedAt: string;
    validUntil: string;
  }>>({});
  const [evidenceReviewers, setEvidenceReviewers] = useState<Record<string, string>>({});
  const [controlDrafts, setControlDrafts] = useState<Record<string, string>>({});
  const [controlReferences, setControlReferences] = useState<Record<string, string>>({});
  const [controlReviewers, setControlReviewers] = useState<Record<string, string>>({});

  const updateAssessment = (id: string, update: (assessment: IcarusAssessmentRecord) => IcarusAssessmentRecord) => {
    onChange(assessments.map((assessment) => assessment.id === id
      ? { ...update(assessment), updatedAt: new Date().toISOString() }
      : assessment));
  };

  const promoteStressFinding = (
    assessmentId: string,
    finding: string,
    affectedAssessmentIds: readonly string[],
    failureModeIds: readonly string[],
  ) => {
    const target = createIcarusStressTreatmentTarget(
      assessmentId,
      finding,
      affectedAssessmentIds,
      failureModeIds,
      new Date().toISOString(),
    );
    if (assessments.some((assessment) => assessment.treatmentTargets?.some((entry) => entry.id === target.id))) return;
    updateAssessment(assessmentId, (current) => ({
      ...current,
      treatmentTargets: [...(current.treatmentTargets ?? []), target],
    }));
  };

  const addAssessment = () => {
    const outcome = outcomeDraft.trim();
    if (!outcome) return;
    const now = new Date().toISOString();
    onChange([{
      id: createId(),
      outcome,
      status: "Open",
      createdAt: now,
      updatedAt: now,
      linkedRecords: [],
      failureModes: [],
      controls: [],
    }, ...assessments]);
    setOutcomeDraft("");
  };

  const updateModeDraft = (key: string, field: "mechanism" | "vulnerability", value: string) => {
    setModeDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? { mechanism: "", vulnerability: "" }), [field]: value },
    }));
  };

  const addFailureMode = (assessment: IcarusAssessmentRecord) => {
    const draft = modeDrafts[assessment.id];
    if (!draft?.mechanism.trim() || !draft.vulnerability.trim()) return;
    const mode: IcarusFailureMode = {
      id: createId(),
      mechanism: draft.mechanism.trim(),
      vulnerability: draft.vulnerability.trim(),
      evidence: [],
    };
    updateAssessment(assessment.id, (current) => ({ ...current, failureModes: [...current.failureModes, mode] }));
    setModeDrafts((current) => ({ ...current, [assessment.id]: { mechanism: "", vulnerability: "" } }));
  };

  const evidenceDraft = (key: string) => evidenceDrafts[key] || {
    statement: "",
    origin: "Source record" as const,
    referenceKey: "",
    recordedBy: "",
    observedAt: "",
    validUntil: "",
  };

  const updateEvidenceDraft = (key: string, update: Partial<ReturnType<typeof evidenceDraft>>) => {
    setEvidenceDrafts((current) => ({ ...current, [key]: { ...evidenceDraft(key), ...update } }));
  };

  const addEvidence = (assessment: IcarusAssessmentRecord, mode: IcarusFailureMode) => {
    const key = `${assessment.id}:${mode.id}`;
    const draft = evidenceDraft(key);
    const reference = sources.find((source) => getIcarusReferenceKey(source) === draft.referenceKey);
    if (!draft.statement.trim() || !draft.recordedBy.trim()) return;
    if (draft.origin === "Source record" && !reference) return;
    if (draft.origin === "Direct observation" && !draft.observedAt) return;

    const evidence: IcarusEvidence = {
      id: createId(),
      statement: draft.statement.trim(),
      origin: draft.origin,
      ...(draft.origin === "Source record" && reference
        ? { reference: { recordType: reference.recordType, recordId: reference.recordId } }
        : {}),
      ...(draft.origin === "Direct observation" ? { observedAt: draft.observedAt } : {}),
      recordedAt: new Date().toISOString(),
      recordedBy: draft.recordedBy.trim(),
      review: "Unreviewed",
      ...(draft.validUntil ? { validUntil: draft.validUntil } : {}),
    };
    updateAssessment(assessment.id, (current) => ({
      ...current,
      failureModes: current.failureModes.map((currentMode) => currentMode.id === mode.id
        ? { ...currentMode, evidence: [...currentMode.evidence, evidence] }
        : currentMode),
    }));
    setEvidenceDrafts((current) => ({
      ...current,
      [key]: { ...draft, statement: "", referenceKey: "", observedAt: "", validUntil: "" },
    }));
  };

  const addControl = (assessment: IcarusAssessmentRecord, mode: IcarusFailureMode) => {
    const key = `${assessment.id}:${mode.id}`;
    const intervention = controlDrafts[key]?.trim();
    if (!intervention) return;
    const control: IcarusControl = {
      id: createId(),
      failureModeId: mode.id,
      intervention,
      lifecycle: "Planned",
      effectiveness: "Unknown",
      evidenceIds: [],
      linkedRecords: [],
    };
    updateAssessment(assessment.id, (current) => ({ ...current, controls: [...current.controls, control] }));
    setControlDrafts((current) => ({ ...current, [key]: "" }));
  };

  const addReference = (
    assessment: IcarusAssessmentRecord,
    key: string,
    target: "assessment" | string,
  ) => {
    const reference = sources.find((source) => getIcarusReferenceKey(source) === key);
    if (!reference) return;
    const nextReference = { recordType: reference.recordType, recordId: reference.recordId };
    updateAssessment(assessment.id, (current) => target === "assessment"
      ? current.linkedRecords.some((entry) => getIcarusReferenceKey(entry) === key)
        ? current
        : { ...current, linkedRecords: [...current.linkedRecords, nextReference] }
      : {
        ...current,
        controls: current.controls.map((control) => control.id === target
          && !control.linkedRecords.some((entry) => getIcarusReferenceKey(entry) === key)
          ? { ...control, linkedRecords: [...control.linkedRecords, nextReference] }
          : control),
      });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="border-b border-[#cfc8c1] pb-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#5e5953]">Failure intelligence & resilience</p>
        <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.06em] text-[#171717]">Icarus</h1>
        <p className="mt-2 max-w-3xl text-[13px] leading-6 text-[#4d4944]">
          Work backwards from important failure outcomes. Record mechanisms, vulnerabilities, evidence and controls;
          keep unknowns visible and link operational records without changing them.
        </p>
      </div>

      {!writable ? (
        <div role="alert" className="mt-5 rounded-xl border border-[#d4b4a7] bg-[#f8efeb] p-3 text-[12px] text-[#5d342b]">
          {loaded
            ? "Icarus storage could not be validated. Existing data is preserved and editing is disabled until a valid backup is restored."
            : "Loading Icarus records…"}
        </div>
      ) : (
        <form className="mt-6 rounded-xl border border-[#d3cbc3] bg-[#f9f7f4] p-4" onSubmit={(event) => { event.preventDefault(); addAssessment(); }}>
          <label className={labelClass} htmlFor="icarus-outcome">Important failure outcome</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="icarus-outcome"
              className="min-w-0 flex-1 rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[13px]"
              value={outcomeDraft}
              onChange={(event) => setOutcomeDraft(event.target.value)}
              placeholder="What important outcome must not fail?"
              required
            />
            <button type="submit" className="rounded-lg bg-[#315b45] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white">Start assessment</button>
          </div>
        </form>
      )}

      <section aria-label="Founder attention" className="mt-6 rounded-xl border border-[#c9b8a3] bg-[#f5efe6] p-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#51483e]">Founder attention · unresolved signals</h2>
        {openFindings.length === 0 ? (
          <p className="mt-2 text-[12px] text-[#4d4944]">No open assessment gaps are currently derived from the recorded information.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {openFindings.map((finding, index) => (
              <li key={`${finding.assessmentId}:${finding.code}:${finding.failureModeId || ""}:${finding.controlId || ""}:${finding.evidenceId || ""}:${index}`} className="text-[12px] leading-5 text-[#4d4944]">
                <span className="font-medium text-[#171717]">{assessments.find((assessment) => assessment.id === finding.assessmentId)?.outcome || "Assessment"}:</span> {finding.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      {systemicExposure && (systemicExposure.pillars.some((pillar) => pillar.state !== "No material exposure") || systemicExposure.objectives.some((objective) => objective.concentrated)) ? (
        <section aria-label="Systemic exposure" className="mt-4 rounded-xl border border-[#c9b8a3] bg-[#f5efe6] p-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#51483e]">Systemic exposure · pillars and objectives</h2>
          <ul className="mt-2 space-y-1.5">
            {systemicExposure.pillars.filter((pillar) => pillar.state !== "No material exposure").map((pillar) => (
              <li key={pillar.pillar} className="text-[12px] leading-5 text-[#4d4944]">
                <span className="font-medium text-[#171717]">{pillar.pillar}: {pillar.state}</span>
                {` — ${pillar.assessmentCount} material assessment${pillar.assessmentCount === 1 ? "" : "s"}, ${pillar.exposedFailureModeCount} exposed mechanism${pillar.exposedFailureModeCount === 1 ? "" : "s"}, ${pillar.failingControlCount} failing / ${pillar.unverifiedControlCount} unverified control${pillar.unverifiedControlCount === 1 ? "" : "s"}, ${pillar.unexaminedFailureModeCount} unexamined`}
                {pillar.pattern === "Multi-signal" ? `; corroborated by ${pillar.otherSignalCategories.length > 0 ? pillar.otherSignalCategories.join(", ") : "a convergent situation"}` : "; isolated to Icarus"}
                {pillar.highest ? (
                  <>
                    {". Highest: "}
                    <a href={`#icarus-assessment-${pillar.highest.assessmentId}`} className="underline">{pillar.highest.outcome}</a>
                  </>
                ) : null}
              </li>
            ))}
            {systemicExposure.objectives.filter((objective) => objective.concentrated).map((objective) => (
              <li key={objective.objectiveId} className="text-[12px] leading-5 text-[#4d4944]">
                <span className="font-medium text-[#171717]">{referenceTitle({ recordType: "Strategic Objective", recordId: objective.objectiveId }, sources)}:</span>
                {` ${objective.materialFailureModeCount} material failure modes across ${objective.assessmentIds.length} assessment${objective.assessmentIds.length === 1 ? "" : "s"} threaten this objective (strongest: ${objective.strongestExposure.toLowerCase()}).`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <IcarusFailureChainSection
        intelligence={failureChains}
        healthTriggeredChains={healthTriggeredChains}
        criticalDependencies={criticalDependencies}
        dependencyResilience={dependencyResilience}
        resilienceInterventions={resilienceInterventions}
        referenceTitle={(reference) => referenceTitle(reference, sources)}
      />
      {loaded && treatmentIndex && interventionIndex ? (
        <IcarusInterventionSection
          assessments={assessments}
          sources={sources}
          treatment={treatmentIndex}
          index={interventionIndex}
          people={people}
          writable={writable}
          createId={createId}
          onChange={onChange}
          onOpenRecord={onOpenRecord}
        />
      ) : null}
      {loaded && treatmentIndex ? (
        <IcarusTreatmentSection
          assessments={assessments}
          index={treatmentIndex}
          actions={actions}
          projects={projects}
          people={people ?? []}
          writable={writable}
          onChange={onChange}
          onOpenRecord={onOpenRecord}
        />
      ) : null}
      {closedAssessmentWarnings.length > 0 ? (
        <section className="mt-4 rounded-xl border border-[#b96b55] bg-[#fff7f3] p-4" aria-label="Closed assessments with material exposure">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8b3d28]">Closed assessments with material exposure</h2>
          <p className="mt-1 text-[12px] leading-5 text-[#4d4944]">Administrative closure is not evidence of strategic resolution. These material exposures remain visible for review.</p>
          <ul className="mt-2 space-y-1">
            {closedAssessmentWarnings.map((signal) => (
              <li key={signal.key} className="text-[12px] leading-5 text-[#4d4944]">
                <a className="font-medium underline" href={`#icarus-assessment-${signal.assessmentId}`}>{signal.outcome}</a>
                {` · ${signal.exposure} · ${signal.materialFailureModes.length} material failure mode${signal.materialFailureModes.length === 1 ? "" : "s"}`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {stressTestingInput && stressBaseline ? (
        <IcarusStressLab input={stressTestingInput} baseline={stressBaseline} onPromote={promoteStressFinding} />
      ) : null}

      <IcarusAssuranceRollupSection
        rollup={assuranceRollup}
        objectiveTitle={(objectiveId) => referenceTitle({ recordType: "Strategic Objective", recordId: objectiveId }, sources)}
      />

      <div className="mt-6 space-y-4">
        {assessments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#cfc8c1] p-6 text-center text-[12px] text-[#6a625d]">No failure assessments recorded.</div>
        ) : assessments.map((assessment) => {
          const assessmentLinks = assessment.linkedRecords.map((reference) => ({
            reference,
            title: referenceTitle(reference, sources),
          }));
          const assessmentFindings = reviews.find((review) => review.assessmentId === assessment.id)?.findings || [];
          return (
            <article
              key={assessment.id}
              id={`icarus-assessment-${assessment.id}`}
              className={`rounded-xl border border-[#d3cbc3] bg-[#f9f7f4] p-4${focusTarget?.assessmentId === assessment.id && !focusTarget.failureModeId ? focusRingClass : ""}`}
            >
              {assessment.status === "Closed" && assessmentFindings.length > 0 ? (
                <p className="mb-3 rounded-md border border-[#c9b8a3] bg-[#f5efe6] px-3 py-2 text-[11px] leading-5 text-[#51483e]">
                  Closed assessments retain unresolved findings; closure does not imply that a control worked or uncertainty was resolved:
                  {" "}{assessmentFindings.map((finding) => finding.message).join(" ")}
                </p>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <label className={labelClass} htmlFor={`icarus-outcome-${assessment.id}`}>Failure outcome</label>
                  <input
                    id={`icarus-outcome-${assessment.id}`}
                    className={inputClass}
                    value={assessment.outcome}
                    disabled={!writable}
                    onChange={(event) => updateAssessment(assessment.id, (current) => ({ ...current, outcome: event.target.value }))}
                  />
                </div>
                <label className={`${labelClass} sm:w-40`}>
                  Assessment state
                  <select
                    className={inputClass}
                    value={assessment.status}
                    disabled={!writable}
                    onChange={(event) => updateAssessment(assessment.id, (current) => ({ ...current, status: event.target.value as IcarusAssessmentStatus }))}
                  >
                    {assessmentStatuses.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </label>
              </div>

              <div className="mt-4">
                <SourceSelect
                  sources={sources}
                  value=""
                  label="Link an existing source record"
                  onChange={(reference) => {
                    if (!reference) return;
                    const key = getIcarusReferenceKey(reference);
                    updateAssessment(assessment.id, (current) => current.linkedRecords.some((entry) => getIcarusReferenceKey(entry) === key)
                      ? current
                      : { ...current, linkedRecords: [...current.linkedRecords, reference] });
                  }}
                />
                {assessmentLinks.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {assessmentLinks.map(({ reference, title }) => (
                      <li key={getIcarusReferenceKey(reference)} className="rounded-md border border-[#d3cbc3] bg-white px-2 py-1 text-[10px] text-[#4d4944]">
                        {title}
                        {writable ? <button type="button" className="ml-2 font-medium text-[#6a3328]" aria-label={`Remove link ${title}`} onClick={() => updateAssessment(assessment.id, (current) => ({ ...current, linkedRecords: current.linkedRecords.filter((entry) => getIcarusReferenceKey(entry) !== getIcarusReferenceKey(reference)) }))}>Remove</button> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <IcarusAssuranceSection
                assessment={assessment}
                assurance={assurance?.byAssessmentId.get(assessment.id)}
                people={people}
                actions={actions.map(({ recordId: id, title, status }) => ({ id, title, status }))}
                writable={writable}
                createId={createId}
                onUpdate={(update) => updateAssessment(assessment.id, update)}
              />

              <div className="mt-5 border-t border-[#d3cbc3] pt-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#4d4944]">Failure mechanisms & vulnerabilities</h3>
                {assessment.failureModes.map((mode) => {
                  const draftKey = `${assessment.id}:${mode.id}`;
                  const evidenceInput = evidenceDraft(draftKey);
                  const controls = assessment.controls.filter((control) => control.failureModeId === mode.id);
                  return (
                    <section
                      key={mode.id}
                      id={`icarus-failure-mode-${mode.id}`}
                      className={`mt-3 rounded-lg border border-[#d3cbc3] bg-white p-3${focusTarget?.failureModeId === mode.id ? focusRingClass : ""}`}
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className={labelClass}>Failure mechanism
                          <textarea rows={2} className={inputClass} value={mode.mechanism} disabled={!writable} onChange={(event) => updateAssessment(assessment.id, (current) => ({ ...current, failureModes: current.failureModes.map((entry) => entry.id === mode.id ? { ...entry, mechanism: event.target.value } : entry) }))} />
                        </label>
                        <label className={labelClass}>Current vulnerability
                          <textarea rows={2} className={inputClass} value={mode.vulnerability} disabled={!writable} onChange={(event) => updateAssessment(assessment.id, (current) => ({ ...current, failureModes: current.failureModes.map((entry) => entry.id === mode.id ? { ...entry, vulnerability: event.target.value } : entry) }))} />
                        </label>
                      </div>

                      <div className="mt-4 border-t border-[#e3ddd7] pt-3">
                        <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5e5953]">Evidence & provenance</h4>
                        {mode.evidence.length > 0 ? (
                          <div className="mt-2 space-y-2">
                            {mode.evidence.map((evidence) => (
                              <div key={evidence.id} className="rounded-md bg-[#f7f4f1] p-2">
                                <p className="text-[11px] leading-5 text-[#2f2b28]">{evidence.statement}</p>
                                <p className="mt-1 text-[10px] text-[#6a625d]">
                                  {evidence.origin === "Source record" && evidence.reference ? referenceTitle(evidence.reference, sources) : `Observed ${evidence.observedAt}`}
                                  {" · "}Recorded by {evidence.recordedBy} at {evidence.recordedAt}
                                  {evidence.validUntil ? ` · Valid until ${evidence.validUntil}` : ""}
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <label className={labelClass}>Evidence review
                                    <select
                                      className="mt-1 rounded-md border border-[#cfc8c1] bg-white px-2 py-1 text-[11px]"
                                      value={evidence.review}
                                      disabled={!writable || !evidenceReviewers[evidence.id]?.trim()}
                                      onChange={(event) => {
                                        const review = event.target.value as IcarusEvidenceReview;
                                        const reviewer = evidenceReviewers[evidence.id]?.trim() || "";
                                        if (review !== "Unreviewed" && !reviewer) return;
                                        updateAssessment(assessment.id, (current) => ({
                                          ...current,
                                          failureModes: current.failureModes.map((entry) => entry.id !== mode.id ? entry : {
                                            ...entry,
                                            evidence: entry.evidence.map((item) => item.id !== evidence.id ? item : {
                                              ...item,
                                              review,
                                              ...(review === "Unreviewed" ? { reviewedAt: undefined, reviewedBy: undefined } : {
                                                reviewedAt: new Date().toISOString(),
                                                reviewedBy: reviewer,
                                              }),
                                            }),
                                          }),
                                        }));
                                      }}
                                    >
                                      {evidenceReviews.map((review) => <option key={review}>{review}</option>)}
                                    </select>
                                  </label>
                                  {writable ? <span className="text-[10px] text-[#6a625d]">Enter the reviewer name below before changing this assessment.</span> : null}
                                  {writable && evidence.review !== "Unreviewed" ? <span className="text-[10px] text-[#6a625d]">Reviewed by {evidence.reviewedBy || "unrecorded"} at {evidence.reviewedAt || "unrecorded"}</span> : null}
                                </div>
                                {writable ? (
                                  <label className={`${labelClass} mt-2 max-w-xs`}>Reviewer name
                                  <input className={inputClass} value={evidenceReviewers[evidence.id] || ""} onChange={(event) => setEvidenceReviewers((current) => ({ ...current, [evidence.id]: event.target.value }))} />
                                  </label>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : <p className="mt-2 text-[11px] text-[#6a625d]">No evidence captured yet; the mechanism remains unresolved.</p>}
                        {writable ? (
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <label className={labelClass}>Evidence statement
                              <textarea rows={2} className={inputClass} value={evidenceInput.statement} onChange={(event) => updateEvidenceDraft(draftKey, { statement: event.target.value })} />
                            </label>
                            <div className="space-y-2">
                              <label className={labelClass}>Evidence origin
                                <select className={inputClass} value={evidenceInput.origin} onChange={(event) => updateEvidenceDraft(draftKey, { origin: event.target.value as "Source record" | "Direct observation", referenceKey: "" })}>
                                  <option>Source record</option><option>Direct observation</option>
                                </select>
                              </label>
                              {evidenceInput.origin === "Source record" ? (
                                <SourceSelect sources={sources} value={evidenceInput.referenceKey} label="Source" onChange={(reference) => updateEvidenceDraft(draftKey, { referenceKey: reference ? getIcarusReferenceKey(reference) : "" })} />
                              ) : (
                                <label className={labelClass}>Observed at
                                  <input type="date" className={inputClass} value={evidenceInput.observedAt} onChange={(event) => updateEvidenceDraft(draftKey, { observedAt: event.target.value })} />
                                </label>
                              )}
                            </div>
                            <label className={labelClass}>Recorded by
                              <input className={inputClass} value={evidenceInput.recordedBy} onChange={(event) => updateEvidenceDraft(draftKey, { recordedBy: event.target.value })} />
                            </label>
                            <label className={labelClass}>Valid until (optional)
                              <input type="date" className={inputClass} value={evidenceInput.validUntil} onChange={(event) => updateEvidenceDraft(draftKey, { validUntil: event.target.value })} />
                            </label>
                            <button type="button" className="w-fit rounded-md border border-[#315b45] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[#315b45] disabled:opacity-40" disabled={!evidenceInput.statement.trim() || !evidenceInput.recordedBy.trim() || (evidenceInput.origin === "Source record" ? !evidenceInput.referenceKey : !evidenceInput.observedAt)} onClick={() => addEvidence(assessment, mode)}>Record evidence as unreviewed</button>
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-4 border-t border-[#e3ddd7] pt-3">
                        <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5e5953]">Controls & interventions</h4>
                        {controls.map((control) => (
                          <div key={control.id} id={`icarus-control-${control.id}`} className="mt-2 rounded-md bg-[#f7f4f1] p-2">
                            <p className="text-[11px] font-medium text-[#171717]">{control.intervention}</p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <label className={labelClass}>Lifecycle
                                <select className={inputClass} value={control.lifecycle} disabled={!writable} onChange={(event) => updateAssessment(assessment.id, (current) => ({ ...current, controls: current.controls.map((entry) => entry.id === control.id ? { ...entry, lifecycle: event.target.value as IcarusControlLifecycle } : entry) }))}>
                                  {controlLifecycles.map((status) => <option key={status}>{status}</option>)}
                                </select>
                              </label>
                              <label className={labelClass}>Effectiveness assessment
                                <select className={inputClass} value={control.effectiveness} disabled={!writable} onChange={(event) => {
                                  const effectiveness = event.target.value as IcarusControlEffectiveness;
                                  const requiresNamedReview = effectiveness !== "Unknown";
                                  const reviewer = controlReviewers[control.id]?.trim() || "";
                                  if (requiresNamedReview && !reviewer) return;
                                  updateAssessment(assessment.id, (current) => ({
                                    ...current,
                                    controls: current.controls.map((entry) => entry.id !== control.id ? entry : {
                                      ...entry,
                                      effectiveness,
                                      ...(requiresNamedReview ? {
                                        effectivenessReviewedBy: reviewer,
                                        effectivenessReviewedAt: new Date().toISOString(),
                                      } : {
                                        effectivenessReviewedBy: undefined,
                                        effectivenessReviewedAt: undefined,
                                      }),
                                    }),
                                  }));
                                }}>
                                  {controlEffectiveness.map((effectiveness) => <option key={effectiveness}>{effectiveness}</option>)}
                                </select>
                              </label>
                              <label className={labelClass}>Next control review
                                <input type="date" className={inputClass} value={control.nextReviewAt || ""} disabled={!writable} onChange={(event) => updateAssessment(assessment.id, (current) => ({ ...current, controls: current.controls.map((entry) => entry.id === control.id ? { ...entry, nextReviewAt: event.target.value || undefined } : entry) }))} />
                              </label>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {control.effectivenessReviewedBy ? <span className="text-[10px] text-[#6a625d]">Assessed by {control.effectivenessReviewedBy} at {control.effectivenessReviewedAt}</span> : null}
                              {writable ? (
                                <label className={`${labelClass} max-w-xs`}>Reviewer for next effectiveness assessment
                                  <input className={inputClass} value={controlReviewers[control.id] || ""} onChange={(event) => setControlReviewers((current) => ({ ...current, [control.id]: event.target.value }))} />
                                </label>
                              ) : null}
                            </div>
                            <p className="mt-1 text-[10px] text-[#6a625d]">Effectiveness is a human assessment, not inferred from control status or completion. Enter a reviewer before selecting any state other than Unknown.</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {control.evidenceIds.map((id) => {
                                const evidence = mode.evidence.find((item) => item.id === id);
                                return <span key={id} className="rounded border border-[#d3cbc3] bg-white px-2 py-1 text-[10px]">{evidence?.statement || `Missing evidence ${id}`}</span>;
                              })}
                              {control.linkedRecords.map((reference) => <span key={getIcarusReferenceKey(reference)} className="rounded border border-[#d3cbc3] bg-white px-2 py-1 text-[10px]">{referenceTitle(reference, sources)}</span>)}
                            </div>
                            {writable ? (
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                <label className={labelClass}>Evidence linked to this control
                                  <select multiple className={`${inputClass} min-h-16`} value={control.evidenceIds} onChange={(event) => {
                                    const evidenceIds = Array.from(event.target.selectedOptions, (option) => option.value);
                                    updateAssessment(assessment.id, (current) => ({ ...current, controls: current.controls.map((entry) => entry.id === control.id ? { ...entry, evidenceIds } : entry) }));
                                  }}>
                                    {mode.evidence.map((evidence) => <option key={evidence.id} value={evidence.id}>{evidence.statement}</option>)}
                                  </select>
                                </label>
                                <SourceSelect
                                  sources={sources}
                                  value={controlReferences[control.id] || ""}
                                  label="Link an authoritative Action, System, SOP or other record"
                                  onChange={(reference) => {
                                    if (!reference) return;
                                    const key = getIcarusReferenceKey(reference);
                                    addReference(assessment, key, control.id);
                                    setControlReferences((current) => ({ ...current, [control.id]: "" }));
                                  }}
                                />
                              </div>
                            ) : null}
                          </div>
                        ))}
                        {controls.length === 0 ? <p className="mt-2 text-[11px] text-[#6a625d]">No control is linked to this mechanism yet.</p> : null}
                        {writable ? (
                          <div className="mt-3 flex gap-2">
                            <input className="min-w-0 flex-1 rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[12px]" value={controlDrafts[draftKey] || ""} onChange={(event) => setControlDrafts((current) => ({ ...current, [draftKey]: event.target.value }))} placeholder="Proposed control or intervention" />
                            <button type="button" className="rounded-md border border-[#315b45] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[#315b45] disabled:opacity-40" disabled={!controlDrafts[draftKey]?.trim()} onClick={() => addControl(assessment, mode)}>Add control</button>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  );
                })}

                {assessment.failureModes.length === 0 ? <p className="mt-2 text-[11px] text-[#6a625d]">No failure mechanisms recorded.</p> : null}
                {writable ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className={labelClass}>How could the outcome fail?
                      <textarea rows={2} className={inputClass} value={modeDrafts[assessment.id]?.mechanism || ""} onChange={(event) => updateModeDraft(assessment.id, "mechanism", event.target.value)} />
                    </label>
                    <label className={labelClass}>What vulnerability enables it?
                      <textarea rows={2} className={inputClass} value={modeDrafts[assessment.id]?.vulnerability || ""} onChange={(event) => updateModeDraft(assessment.id, "vulnerability", event.target.value)} />
                    </label>
                    <button type="button" className="w-fit rounded-md border border-[#315b45] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[#315b45] disabled:opacity-40" disabled={!modeDrafts[assessment.id]?.mechanism.trim() || !modeDrafts[assessment.id]?.vulnerability.trim()} onClick={() => addFailureMode(assessment)}>Add failure mechanism</button>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
