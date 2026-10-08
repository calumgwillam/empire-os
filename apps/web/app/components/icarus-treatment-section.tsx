"use client";

import { useState } from "react";
import {
  getIcarusTreatmentOutcomeId,
  type IcarusAssessmentRecord,
  type IcarusTreatmentOutcomeRecord,
  type IcarusTreatmentTargetRecord,
} from "../lib/icarus";
import {
  createIcarusBarrierRestorationTreatmentTarget,
  createIcarusResilienceTreatmentTarget,
  getIcarusBarrierRestorationTreatmentTargetId,
  getIcarusResilienceTreatmentTargetId,
  persistIcarusTreatmentTarget,
  type IcarusTreatmentExecution,
  type IcarusTreatmentIndex,
  type IcarusTreatmentTarget,
} from "../lib/icarus-treatment";
import type { IcarusAssurancePersonOption } from "./icarus-assurance-section";
import type { IcarusResilienceIntervention } from "../lib/icarus-dependency-resilience";
import type { IcarusInterventionIndex } from "../lib/icarus-intervention-decision";
import { getIcarusTreatmentCompletion, getIcarusTreatmentFollowUpIssues, getIcarusTreatmentVerificationIssues } from "../lib/icarus-treatment-outcome";

type Props = {
  assessments: readonly IcarusAssessmentRecord[];
  index: IcarusTreatmentIndex;
  interventionIndex?: IcarusInterventionIndex;
  createId: () => string;
  actions: readonly IcarusTreatmentExecution[];
  projects: readonly IcarusTreatmentExecution[];
  people: readonly IcarusAssurancePersonOption[];
  writable: boolean;
  onChange: (assessments: IcarusAssessmentRecord[]) => void;
  onOpenRecord: (recordType: string, recordId: string) => void;
};

const sectionClass = "mt-4 rounded-xl border border-[#c9b8a3] bg-[#f5efe6] p-4";
const itemClass = "text-[12px] leading-5 text-[#4d4944]";
const buttonClass = "rounded border border-[#315b45] px-2 py-1 text-[10px] font-medium text-[#315b45] disabled:opacity-40";
const selectClass = "mt-1 rounded border border-[#cfc8c1] bg-white px-2 py-1 text-[11px] text-[#171717]";

function changeStoredTarget(
  assessments: readonly IcarusAssessmentRecord[],
  target: IcarusTreatmentTarget,
  update: (record: IcarusTreatmentTargetRecord) => IcarusTreatmentTargetRecord,
): IcarusAssessmentRecord[] {
  return assessments.map((assessment) => {
    if (assessment.id !== target.assessmentId) return assessment;
    const stored = assessment.treatmentTargets ?? [];
    const current = stored.find((entry) => entry.id === target.id) ?? persistIcarusTreatmentTarget(target, new Date().toISOString());
    const next = update(current);
    return {
      ...assessment,
      treatmentTargets: stored.some((entry) => entry.id === target.id)
        ? stored.map((entry) => entry.id === target.id ? next : entry)
        : [...stored, next],
    };
  });
}

function stateTone(state: IcarusTreatmentTarget["state"]): string {
  return state === "Blocked" || state === "Overdue" || state === "Missing execution record"
    ? "text-[#8b3d28]"
    : state === "Completed — verification required"
      ? "text-[#755520]"
      : "text-[#315b45]";
}

export default function IcarusTreatmentSection({
  assessments,
  index,
  interventionIndex,
  createId,
  actions,
  projects,
  people,
  writable,
  onChange,
  onOpenRecord,
}: Props) {
  const [selectedExecution, setSelectedExecution] = useState<Record<string, string>>({});
  const [selectedVerification, setSelectedVerification] = useState<Record<string, string>>({});
  const [verificationBy, setVerificationBy] = useState<Record<string, string>>({});
  const [verificationNote, setVerificationNote] = useState<Record<string, string>>({});
  const [verificationContext, setVerificationContext] = useState<Record<string, string>>({});
  const [verificationError, setVerificationError] = useState<Record<string, string>>({});
  const [completionAt, setCompletionAt] = useState<Record<string, string>>({});
  const [completionBy, setCompletionBy] = useState<Record<string, string>>({});
  const [completionNote, setCompletionNote] = useState<Record<string, string>>({});
  const [nextObservationBy, setNextObservationBy] = useState<Record<string, string>>({});
  const verificationContexts = (targetId: string) => (interventionIndex?.decisions ?? []).filter((view) =>
    view.record.status === "Recorded" && view.selectedOption?.treatmentLinks.some((link) => link.targetId === targetId)
    && !["Not structured", "Conflict", "Prerequisites unmet"].includes(view.readiness));
  const executions = [...actions, ...projects].sort((left, right) =>
    left.title.localeCompare(right.title) || left.recordType.localeCompare(right.recordType) || left.recordId.localeCompare(right.recordId));
  const promotedIds = new Set(index.targets.map((target) => target.id));
  const commitAssessments = (nextAssessments: IcarusAssessmentRecord[]) => {
    const now = new Date().toISOString();
    onChange(nextAssessments.map((assessment, index) => assessment === assessments[index]
      ? assessment
      : { ...assessment, updatedAt: now }));
  };
  const recommendations = index.recommendations.flatMap((intervention) => {
    const targetId = getIcarusResilienceTreatmentTargetId(intervention);
    return intervention.assessmentIds.length > 0 && !promotedIds.has(targetId)
      ? [{ intervention, targetId }]
      : [];
  });
  const barrierRestorations = index.barrierRestorations.filter((restoration) =>
    !promotedIds.has(getIcarusBarrierRestorationTreatmentTargetId(restoration)));
  const displayTargets = index.targets.filter((target) => target.material || target.executionLinks.length > 0);
  const resolutionEligible = assessments.filter((assessment) =>
    index.summaries.get(assessment.id)?.resolutionEligibility === "Eligible");
  const closedAssessments = assessments.filter((assessment) => assessment.status === "Closed");
  const activePeople = people.filter((person) => person.status === "Active")
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

  const recordCompletion = (target: IcarusTreatmentTarget) => {
    const recordedAt = new Date().toISOString();
    const at = Date.parse(completionAt[target.id] ?? "");
    const personId = completionBy[target.id] ?? "";
    const note = completionNote[target.id]?.trim() ?? "";
    const fail = (message: string) => setVerificationError((current) => ({ ...current, [target.id]: message }));
    if (!writable || target.state !== "Completed — verification required" || !Number.isFinite(at)
      || !activePeople.some((person) => person.id === personId) || !note) {
      fail("Record an explicit completion time, active reviewer and completion basis for completed execution.");
      return;
    }
    const links = target.executionLinks.flatMap((link) => link.linkedAt
      ? [{ recordType: link.recordType, recordId: link.recordId, linkedAt: link.linkedAt }] : []);
    if (!links.length || links.length !== target.executionLinks.length) {
      fail("Dated execution linkage is required before recording completion.");
      return;
    }
    const review = {
      id: createId(), completedAt: new Date(at).toISOString(), recordedAt, recordedByPersonId: personId,
      executionLinks: links, note,
    };
    if ((target.completionReviews ?? []).some((entry) => entry.id === review.id)) {
      fail("Completion review identity already exists.");
      return;
    }
    const next = { ...target, completionReviews: [...(target.completionReviews ?? []), review] };
    const issues = getIcarusTreatmentCompletion(next, Date.parse(recordedAt)).issues;
    if (issues.length) {
      fail(issues.join("; "));
      return;
    }
    commitAssessments(changeStoredTarget(assessments, target, (stored) => ({
      ...stored, completionReviews: [...(stored.completionReviews ?? []), review],
    })));
    setVerificationError((current) => ({ ...current, [target.id]: "" }));
    setCompletionNote((current) => ({ ...current, [target.id]: "" }));
  };

  const recordVerification = (target: IcarusTreatmentTarget) => {
    const view = index.verification.get(target.id);
    const selectedValue = selectedVerification[target.id] ?? "";
    const selected = Number(selectedValue);
    const option = selectedValue !== "" && Number.isInteger(selected) ? view?.options[selected] : undefined;
    const verifierId = verificationBy[target.id] ?? "";
    const note = verificationNote[target.id]?.trim() ?? "";
    const fail = (message: string) => setVerificationError((current) => ({ ...current, [target.id]: message }));
    if (!option || !activePeople.some((person) => person.id === verifierId) || !note
      || target.state !== "Completed — verification required") {
      fail("Select current evidence, an active verifier and a verification note for completed execution.");
      return;
    }
    if (!assessments.some((assessment) => assessment.id === target.assessmentId)) {
      fail("The treatment target's assessment no longer exists. Restore its assessment before recording verification.");
      return;
    }
    const executionLinks = target.executionLinks.flatMap((link) => link.linkedAt
      ? [{ recordType: link.recordType, recordId: link.recordId, linkedAt: link.linkedAt }]
      : []);
    if (executionLinks.length !== target.executionLinks.length || executionLinks.length === 0) {
      fail("Execution linkage provenance is missing. Restore the dated execution links before verification.");
      return;
    }
    const verifiedAt = new Date().toISOString();
    const deadline = nextObservationBy[target.id]?.trim();
    if (deadline && (!Number.isFinite(Date.parse(deadline))
      || Date.parse(`${deadline}T23:59:59.999Z`) < Date.parse(verifiedAt))) {
      fail("The next observation date must be today or later.");
      return;
    }
    const issues = getIcarusTreatmentVerificationIssues(
      target, option.evidence, assessments, Date.parse(verifiedAt), Date.parse(verifiedAt),
    );
    if (issues.length) {
      fail(issues.join("; "));
      return;
    }
    const contextId = verificationContext[target.id] ?? "";
    const context = verificationContexts(target.id).find((view) => view.record.id === contextId);
    const selection = context?.record.selectionHistory[context.record.selectionHistory.length - 1];
    if (contextId && (!context || !selection || selection.optionId !== context.selectedOption?.id)) {
      fail("The intervention selection is no longer valid. Select a current intervention or treatment-only verification.");
      return;
    }
    const contextLink = context?.selectedOption?.treatmentLinks.find((link) => link.targetId === target.id);
    if (context && (!selection || !contextLink || Date.parse(selection.selectedAt) > Date.parse(verifiedAt)
      || Date.parse(contextLink.linkedAt) > Date.parse(verifiedAt))) {
      fail("Verification cannot precede the intervention selection or treatment linkage. Correct future-dated provenance first.");
      return;
    }
    if (selection && contextLink) {
      const contextIssues = getIcarusTreatmentVerificationIssues(
        target, option.evidence, assessments, Date.parse(verifiedAt), Date.parse(verifiedAt),
        Math.max(Date.parse(selection.selectedAt), Date.parse(contextLink.linkedAt)),
      );
      if (contextIssues.length) {
        fail(contextIssues.join("; "));
        return;
      }
    }
    const occurrenceId = createId();
    const record: IcarusTreatmentOutcomeRecord = {
      id: getIcarusTreatmentOutcomeId(target.id, verifierId, option.evidence, occurrenceId),
      occurrenceId,
      ...(context && selection ? { interventionReference: {
        decisionId: context.record.id, optionId: selection.optionId, selectionEventId: selection.id,
      } } : {}),
      treatmentTargetId: target.id,
      assessmentId: target.assessmentId,
      executionLinks,
      completionConditions: getIcarusTreatmentCompletion(target, Date.parse(verifiedAt)).conditions,
      ...(deadline ? { nextObservationBy: deadline } : {}),
      outcome: option.outcome,
      verifiedAt,
      verifiedByPersonId: verifierId,
      evidence: option.evidence.map((entry) => ({ ...entry })),
      ...(view?.latest ? { beforeState: { ...view.latest.afterState } } : {}),
      afterState: { ...option.afterState },
      verificationNote: note,
    };
    if (assessments.some((assessment) => assessment.treatmentOutcomes?.some((entry) => entry.id === record.id))) {
      fail("Verification occurrence identity already exists. Record a new occurrence.");
      return;
    }
    const followUpIssues = getIcarusTreatmentFollowUpIssues(record, view?.latest, assessments);
    if (followUpIssues.length) {
      fail(followUpIssues.join("; "));
      return;
    }
    commitAssessments(assessments.map((assessment) => assessment.id !== target.assessmentId
      ? assessment
      : { ...assessment, treatmentOutcomes: [...(assessment.treatmentOutcomes ?? []), record] }));
    setVerificationError((current) => ({ ...current, [target.id]: "" }));
    setSelectedVerification((current) => ({ ...current, [target.id]: "" }));
    setVerificationNote((current) => ({ ...current, [target.id]: "" }));
  };

  const addExecution = (target: IcarusTreatmentTarget) => {
    const selection = selectedExecution[target.id] ?? "";
    const separator = selection.indexOf(":");
    const recordType = separator < 0 ? "" : selection.slice(0, separator);
    const recordId = separator < 0 ? "" : selection.slice(separator + 1);
    if ((recordType !== "Action" && recordType !== "Project") || !recordId) return;
    if (target.sourceKind === "Assurance obligation" && recordType === "Action") {
      commitAssessments(assessments.map((assessment) => {
        if (assessment.id !== target.assessmentId) return assessment;
        const exists = (assessment.assuranceActionLinks ?? []).some((link) =>
          link.obligationId === target.sourceId && link.actionId === recordId);
        return exists ? assessment : {
          ...assessment,
          assuranceActionLinks: [
            ...(assessment.assuranceActionLinks ?? []),
            { obligationId: target.sourceId, actionId: recordId, linkedAt: new Date().toISOString() },
          ],
        };
      }));
      return;
    }
    commitAssessments(changeStoredTarget(assessments, target, (stored) => ({
      ...stored,
      executionLinks: stored.executionLinks.some((link) => link.recordType === recordType && link.recordId === recordId)
        ? stored.executionLinks
        : [...stored.executionLinks, { recordType, recordId, linkedAt: new Date().toISOString() }],
    })));
  };

  const removeExecution = (target: IcarusTreatmentTarget, recordType: "Action" | "Project", recordId: string) => {
    if (target.sourceKind === "Assurance obligation" && recordType === "Action") {
      commitAssessments(assessments.map((assessment) => assessment.id !== target.assessmentId ? assessment : ({
        ...assessment,
        assuranceActionLinks: (assessment.assuranceActionLinks ?? []).filter((link) =>
          !(link.obligationId === target.sourceId && link.actionId === recordId)),
      })));
      return;
    }
    if (target.sourceKind === "Assurance obligation") {
      commitAssessments(assessments.map((assessment) => assessment.id !== target.assessmentId ? assessment : ({
        ...assessment,
        treatmentTargets: (assessment.treatmentTargets ?? []).flatMap((stored) => {
          if (stored.id !== target.id) return [stored];
          const executionLinks = stored.executionLinks.filter((link) =>
            !(link.recordType === recordType && link.recordId === recordId));
          return executionLinks.length > 0 ? [{ ...stored, executionLinks }] : [];
        }),
      })));
      return;
    }
    commitAssessments(changeStoredTarget(assessments, target, (stored) => ({
      ...stored,
      executionLinks: stored.executionLinks.filter((link) =>
        !(link.recordType === recordType && link.recordId === recordId)),
    })));
  };

  const promote = (intervention: IcarusResilienceIntervention) => {
    const target = createIcarusResilienceTreatmentTarget(intervention, new Date().toISOString());
    if (!target || assessments.some((assessment) => assessment.treatmentTargets?.some((entry) => entry.id === target.id))) return;
    commitAssessments(assessments.map((assessment) => assessment.id !== target.assessmentId
      ? assessment
      : { ...assessment, treatmentTargets: [...(assessment.treatmentTargets ?? []), target] }));
  };

  const promoteBarrierRestoration = (restoration: IcarusTreatmentIndex["barrierRestorations"][number]) => {
    const target = createIcarusBarrierRestorationTreatmentTarget(restoration, new Date().toISOString());
    if (index.targets.some((entry) => entry.id === target.id)) return;
    commitAssessments(assessments.map((assessment) => assessment.id !== target.assessmentId
      ? assessment
      : { ...assessment, treatmentTargets: [...(assessment.treatmentTargets ?? []), target] }));
  };

  return (
    <section id="icarus-treatment-routing" aria-label="Strategic treatment routing" className={sectionClass}>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#51483e]">Treatment status · accountable execution</h2>
      <p className={`${itemClass} mt-1`}>Actions and Projects remain the execution records. Completion requires separate strategic verification and never resolves a risk automatically.</p>
      <p className={`${itemClass} mt-1`}>
        {resolutionEligible.length > 0
          ? `${resolutionEligible.length} assessment${resolutionEligible.length === 1 ? " passes" : "s pass"} the preliminary treatment checks. Positive strategic resolution eligibility and explicit reviews are shown separately.`
          : "No assessment currently passes the preliminary treatment checks."}
        {closedAssessments.length > 0
          ? ` ${closedAssessments.length} administratively closed assessment${closedAssessments.length === 1 ? "" : "s"}; closure alone never establishes verified resolution.`
          : ""}
      </p>
      {displayTargets.length === 0 ? (
        <p className={`${itemClass} mt-2`}>No material assurance treatment targets are currently derived or promoted.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {displayTargets.map((target) => {
            const assessment = assessments.find((entry) => entry.id === target.assessmentId);
            const dependencyReference = target.dependencyReference;
            const linkedKeys = new Set(target.executionLinks.map((link) => `${link.recordType}:${link.recordId}`));
            const available = executions.filter((execution) => !linkedKeys.has(`${execution.recordType}:${execution.recordId}`));
            const routeKey = target.id;
            return (
              <li key={target.id} className="rounded-md bg-white p-2">
                <div className="flex flex-wrap items-center gap-x-2">
                  <a className="font-medium underline" href={`#icarus-assessment-${target.assessmentId}`}>
                    {assessment?.outcome || target.assessmentId}
                  </a>
                  {target.failureModeId ? <a className="underline" href={`#icarus-failure-mode-${target.failureModeId}`}>Failure mode</a> : null}
                  {target.controlId ? <a className="underline" href={`#icarus-control-${target.controlId}`}>Control</a> : null}
                  {dependencyReference ? (
                    <button type="button" className="underline" onClick={() => onOpenRecord(dependencyReference.recordType, dependencyReference.recordId)}>
                      {dependencyReference.recordType} dependency
                    </button>
                  ) : null}
                </div>
                <p className={itemClass}>{target.treatmentKind} — {target.reason}</p>
                <p className="text-[10px] text-[#6a625d]">Source: {target.provenance.kind}</p>
                <p className={`font-medium ${stateTone(target.state)}`}>{target.state}</p>
                {index.verification.get(target.id) ? (
                  <div className="mt-2 rounded border border-[#d9d1c8] bg-[#faf8f5] p-2">
                    <p className="text-[11px] font-medium text-[#4d4944]">
                      Verification: {index.verification.get(target.id)?.state}
                    </p>
                    <p className={itemClass}>Protection: {index.verification.get(target.id)?.protection ?? "Unknown"}</p>
                    <p className="text-[10px] text-[#6a625d]">Repeated observations are not proof of uninterrupted protection. Completion alone never proves effectiveness.</p>
                    {index.verification.get(target.id)?.completion?.conditions.map((condition) => (
                      <p key={`${condition.recordType}:${condition.recordId}`} className="text-[10px] text-[#6a625d]">
                        {`${condition.recordType} ${condition.recordId}: completed ${condition.completedAt}; ${condition.source}${condition.completionReviewId ? ` ${condition.completionReviewId}` : ""} — ${condition.basis}`}
                      </p>
                    ))}
                    {writable && target.state === "Completed — verification required"
                      && Boolean(index.verification.get(target.id)?.completion?.issues.length) ? (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <p className="w-full text-[10px] text-[#6a625d]">Record when all linked execution was complete. Existing Action completion fields remain authoritative; correct partial or invalid Action provenance in the Action record. This review supplies missing provenance, not effectiveness evidence.</p>
                          <label className="text-[10px]">Execution completed at
                            <input type="datetime-local" className={selectClass} value={completionAt[target.id] ?? ""}
                              onChange={(event) => setCompletionAt((current) => ({ ...current, [target.id]: event.target.value }))} />
                          </label>
                          <label className="text-[10px]">Completion reviewed by
                            <select className={selectClass} value={completionBy[target.id] ?? ""}
                              onChange={(event) => setCompletionBy((current) => ({ ...current, [target.id]: event.target.value }))}>
                              <option value="">Select active Person</option>
                              {activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                            </select>
                          </label>
                          <label className="text-[10px]">Completion basis
                            <input className={selectClass} value={completionNote[target.id] ?? ""}
                              onChange={(event) => setCompletionNote((current) => ({ ...current, [target.id]: event.target.value }))} />
                          </label>
                          <button type="button" className={buttonClass} onClick={() => recordCompletion(target)}>Record completion review</button>
                        </div>
                      ) : null}
                    {index.verification.get(target.id)?.issues?.map((issue) => (
                      <p key={issue} className="mt-1 text-[10px] text-[#8b3d28]">{issue}</p>
                    ))}
                    {index.verification.get(target.id)?.history.map(({ record, current, evidenceCurrent, attribution, issues }) => (
                      <p key={record.id} className="mt-1 text-[10px] leading-4 text-[#6a625d]">
                        {`${record.outcome} · ${record.verifiedAt} · verifier ${record.verifiedByPersonId} · ${record.afterState.kind}: ${record.afterState.state} · attribution ${attribution}${current ? " · current treatment occurrence" : evidenceCurrent ? " · historical occurrence; source evidence still matches" : " · historical occurrence; support no longer current"}${record.interventionReference ? ` · recorded for intervention ${record.interventionReference.decisionId}` : " · no explicit intervention attribution"}`}
                        {record.verificationNote ? ` — ${record.verificationNote}` : ""}
                        {issues?.length ? ` — verification gap: ${issues.join("; ")}` : ""}
                        {record.nextObservationBy ? ` — next observation by ${record.nextObservationBy}` : " — no follow-up observation scheduled"}
                      </p>
                    ))}
                    {verificationError[target.id] ? <p role="alert" className="text-[11px] text-[#8b3d28]">{verificationError[target.id]}</p> : null}
                    {writable && target.state === "Completed — verification required"
                      ? index.verification.get(target.id)?.options.length ? (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <label className="text-[10px] text-[#5e5953]">
                            Verification scope
                            <select className={selectClass} value={verificationContext[target.id] ?? ""}
                              onChange={(event) => setVerificationContext((current) => ({ ...current, [target.id]: event.target.value }))}>
                              <option value="">Treatment only — no intervention proof</option>
                              {verificationContexts(target.id).map((view) => (
                                <option key={view.record.id} value={view.record.id}>{view.record.title} — {view.selectedOption?.name}</option>
                              ))}
                            </select>
                          </label>
                          <p className="w-full text-[10px] text-[#6a625d]">Control tests must follow completion of all linked work and any intervention selection, and precede this review. Operational status alone cannot verify effectiveness. A new review does not create fresh observations or establish causation.</p>
                          <label className="text-[10px] text-[#5e5953]">
                            Evidence-supported outcome
                            <select
                              className={selectClass}
                              value={selectedVerification[target.id] ?? ""}
                              onChange={(event) => setSelectedVerification((current) => ({ ...current, [target.id]: event.target.value }))}
                            >
                              <option value="">Select current evidence</option>
                              {index.verification.get(target.id)?.options.map((option, optionIndex) => (
                                <option key={`${option.outcome}:${optionIndex}`} value={optionIndex}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-[10px] text-[#5e5953]">
                            Verified by
                            <select
                              className={selectClass}
                              value={verificationBy[target.id] ?? ""}
                              onChange={(event) => setVerificationBy((current) => ({ ...current, [target.id]: event.target.value }))}
                            >
                              <option value="">Select active Person</option>
                              {activePeople.map((person) => (
                                <option key={person.id} value={person.id}>{person.name}</option>
                              ))}
                            </select>
                          </label>
                          <label className="min-w-[220px] flex-1 text-[10px] text-[#5e5953]">
                            Verification note
                            <input
                              className={selectClass}
                              value={verificationNote[target.id] ?? ""}
                              onChange={(event) => setVerificationNote((current) => ({ ...current, [target.id]: event.target.value }))}
                              placeholder="Record what the evidence establishes"
                            />
                          </label>
                          <label className="text-[10px] text-[#5e5953]">
                            Next effectiveness observation by
                            <input type="date" className={selectClass} value={nextObservationBy[target.id] ?? ""}
                              onChange={(event) => setNextObservationBy((current) => ({ ...current, [target.id]: event.target.value }))} />
                          </label>
                          <button
                            type="button"
                            className={buttonClass}
                            disabled={!(selectedVerification[target.id] ?? "") || !verificationBy[target.id] || !verificationNote[target.id]?.trim()}
                            onClick={() => recordVerification(target)}
                          >
                            Record new verification occurrence
                          </button>
                        </div>
                      ) : <p className={`${itemClass} mt-1`}>No current source evidence supports a verification outcome. The treatment remains unverified.</p>
                      : null}
                  </div>
                ) : null}
                {target.executions.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {target.executions.map((execution) => {
                      return (
                        <li key={`${execution.recordType}:${execution.recordId}`} className={itemClass}>
                          {`${execution.recordType}: `}
                          <button type="button" className="underline" onClick={() => onOpenRecord(execution.recordType, execution.recordId)}>{execution.title}</button>
                          {` · ${execution.status} · ${execution.owner || "No stable owner"}${execution.dueDate ? ` · due ${execution.dueDate}` : ""}`}
                          {execution.priority ? ` · ${execution.priority}` : ""}
                          {execution.context ? ` · ${execution.context}` : ""}
                          {writable ? <button type="button" className="ml-2 underline" onClick={() => removeExecution(target, execution.recordType, execution.recordId)}>Unlink</button> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {target.executionLinks.filter((link) => !target.executions.some((execution) =>
                  execution.recordType === link.recordType && execution.recordId === link.recordId)).map((link) => (
                  <p key={`${link.recordType}:${link.recordId}`} className="mt-1 text-[11px] text-[#8b3d28]">
                    {`Missing ${link.recordType} ${link.recordId}. `}
                    {writable ? <button type="button" className="underline" onClick={() => removeExecution(target, link.recordType, link.recordId)}>Remove stale link</button> : "Stale execution link retained."}
                  </p>
                ))}
                {target.founderOwned ? <p className={itemClass}>Execution is owned by the primary founder.</p> : null}
                {writable ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="text-[10px] text-[#5e5953]">
                      Link existing Action or Project
                      <select
                        className={selectClass}
                        value={selectedExecution[routeKey] ?? ""}
                        onChange={(event) => setSelectedExecution((current) => ({ ...current, [routeKey]: event.target.value }))}
                      >
                        <option value="">Select record</option>
                        {available.map((execution) => (
                          <option key={`${execution.recordType}:${execution.recordId}`} value={`${execution.recordType}:${execution.recordId}`}>
                            {execution.recordType}: {execution.title} ({execution.status})
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className={buttonClass} disabled={!selectedExecution[routeKey]} onClick={() => addExecution(target)}>Link execution</button>
                  </div>
                ) : null}
                {target.objectiveIds.length > 0 ? <p className={itemClass}>Strategic objectives: {target.objectiveIds.join(", ")}</p> : null}
                {target.pillarIds.length > 0 ? <p className={itemClass}>Operating pillars: {target.pillarIds.join(", ")}</p> : null}
              </li>
            );
          })}
        </ul>
      )}

      {recommendations.length > 0 || barrierRestorations.length > 0 ? (
        <div className="mt-3 border-t border-[#d3cbc3] pt-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5e5953]">Recommended interventions · not yet accepted for execution</h3>
          <ul className="mt-1 space-y-1">
            {recommendations.map(({ intervention, targetId }) => (
              <li key={targetId} className={itemClass}>
                <a className="underline" href={`#icarus-assessment-${intervention.assessmentIds.slice().sort()[0] || ""}`}>{intervention.kind}</a>
                {` · ${intervention.reference.recordType} ${intervention.reference.recordId} · ${intervention.resilience} · ${intervention.concentration}. `}
                {writable ? <button type="button" className="underline" onClick={() => promote(intervention)}>Promote to treatment</button> : "Recommendation only"}
              </li>
            ))}
            {barrierRestorations.map((restoration) => (
              <li key={getIcarusBarrierRestorationTreatmentTargetId(restoration)} className={itemClass}>
                <a className="underline" href={`#icarus-failure-mode-${restoration.failureModeId}`}>Restore barrier</a>
                {` · ${restoration.intervention} · ${restoration.chainPriority} chain. `}
                {writable ? <button type="button" className="underline" onClick={() => promoteBarrierRestoration(restoration)}>Promote to treatment</button> : "Recommendation only"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {index.targets.some((target) => target.sourceKind === "Stress discovery") ? (
        <p className={`${itemClass} mt-2`}>Stress-test discoveries shown above were explicitly promoted. Unpromoted scenarios remain hypothetical and are not stored.</p>
      ) : null}
    </section>
  );
}
