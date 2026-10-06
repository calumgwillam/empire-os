"use client";

import { useState } from "react";
import type { IcarusAssessmentRecord, IcarusTreatmentTargetRecord } from "../lib/icarus";
import {
  createIcarusBarrierRestorationTreatmentTarget,
  createIcarusResilienceTreatmentTarget,
  getIcarusBarrierRestorationTreatmentTargetId,
  getIcarusResilienceTreatmentTargetId,
  type IcarusTreatmentExecution,
  type IcarusTreatmentIndex,
  type IcarusTreatmentTarget,
} from "../lib/icarus-treatment";
import type { IcarusResilienceIntervention } from "../lib/icarus-dependency-resilience";

type Props = {
  assessments: readonly IcarusAssessmentRecord[];
  index: IcarusTreatmentIndex;
  actions: readonly IcarusTreatmentExecution[];
  projects: readonly IcarusTreatmentExecution[];
  writable: boolean;
  onChange: (assessments: IcarusAssessmentRecord[]) => void;
  onOpenRecord: (recordType: string, recordId: string) => void;
};

const sectionClass = "mt-4 rounded-xl border border-[#c9b8a3] bg-[#f5efe6] p-4";
const itemClass = "text-[12px] leading-5 text-[#4d4944]";
const buttonClass = "rounded border border-[#315b45] px-2 py-1 text-[10px] font-medium text-[#315b45] disabled:opacity-40";
const selectClass = "mt-1 rounded border border-[#cfc8c1] bg-white px-2 py-1 text-[11px] text-[#171717]";

function toPersistedTarget(target: IcarusTreatmentTarget): IcarusTreatmentTargetRecord {
  return {
    id: target.id,
    sourceKind: target.sourceKind,
    sourceId: target.sourceId,
    assessmentId: target.assessmentId,
    ...(target.failureModeId ? { failureModeId: target.failureModeId } : {}),
    ...(target.controlId ? { controlId: target.controlId } : {}),
    ...(target.dependencyReference ? { dependencyReference: { ...target.dependencyReference } } : {}),
    treatmentKind: target.treatmentKind,
    reason: target.reason,
    basis: [...target.basis],
    affectedAssessmentIds: [...target.affectedAssessmentIds],
    objectiveIds: [...target.objectiveIds],
    pillarIds: [...target.pillarIds],
    provenance: { kind: target.provenance.kind, finding: target.provenance.finding },
    executionLinks: [],
    promotedAt: new Date().toISOString(),
  };
}

function changeStoredTarget(
  assessments: readonly IcarusAssessmentRecord[],
  target: IcarusTreatmentTarget,
  update: (record: IcarusTreatmentTargetRecord) => IcarusTreatmentTargetRecord,
): IcarusAssessmentRecord[] {
  return assessments.map((assessment) => {
    if (assessment.id !== target.assessmentId) return assessment;
    const stored = assessment.treatmentTargets ?? [];
    const current = stored.find((entry) => entry.id === target.id) ?? toPersistedTarget(target);
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
  actions,
  projects,
  writable,
  onChange,
  onOpenRecord,
}: Props) {
  const [selectedExecution, setSelectedExecution] = useState<Record<string, string>>({});
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
