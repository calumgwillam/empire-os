"use client";

import { useState } from "react";
import { getIcarusReferenceKey, type IcarusRecordReference } from "../lib/icarus";
import type { IcarusStrategicIntelligence } from "../lib/icarus-intelligence-pipeline";
import {
  buildIcarusRecommendedStressScenarios,
  runIcarusStressTest,
  type IcarusStressOverride,
  type IcarusStressResult,
  type IcarusStressTestingInput,
} from "../lib/icarus-stress-testing";

type Target =
  | { key: string; label: string; type: "Dependency"; reference: IcarusRecordReference }
  | { key: string; label: string; type: "Control"; assessmentId: string; controlId: string }
  | { key: string; label: string; type: "Person"; personId: string }
  | { key: string; label: string; type: "Action"; actionId: string }
  | { key: string; label: string; type: "Project"; projectId: string };

type Props = {
  input: IcarusStressTestingInput;
  baseline: IcarusStrategicIntelligence;
  onPromote?: (
    assessmentId: string,
    finding: string,
    affectedAssessmentIds: readonly string[],
    failureModeIds: readonly string[],
  ) => void;
};

const sectionClass = "mt-4 rounded-xl border border-[#9b896d] bg-[#f8f4ed] p-4";
const itemClass = "text-[12px] leading-5 text-[#4d4944]";
const labelClass = "block text-[10px] font-medium uppercase tracking-[0.14em] text-[#5e5953]";
const selectClass = "mt-1 w-full rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[12px] text-[#171717]";

function dependencyLabel(reference: IcarusRecordReference, input: IcarusStressTestingInput): string {
  const source = input.sourceRecords.find((entry) => getIcarusReferenceKey(entry) === getIcarusReferenceKey(reference));
  return source ? `${reference.recordType}: ${source.title} · ${reference.recordId}` : `${reference.recordType}: ${reference.recordId}`;
}

function buildTargets(input: IcarusStressTestingInput, baseline: IcarusStrategicIntelligence): Target[] {
  const graph = baseline.failureChains.dependencyGraph;
  const dependencies = new Map<string, IcarusRecordReference>();
  graph.controls.forEach((control) => control.dependencyNodeIds.forEach((nodeId) => {
    const reference = graph.nodeById.get(nodeId)?.reference;
    if (reference && reference.recordType !== "Pillar" && reference.recordType !== "Strategic Objective") {
      dependencies.set(getIcarusReferenceKey(reference), reference);
    }
  }));
  const targets: Target[] = [...dependencies.values()].map((reference) => {
    const key = getIcarusReferenceKey(reference);
    if (reference.recordType === "Person") return { key: `person:${key}`, label: dependencyLabel(reference, input), type: "Person", personId: reference.recordId };
    if (reference.recordType === "Action") return { key: `action:${key}`, label: dependencyLabel(reference, input), type: "Action", actionId: reference.recordId };
    if (reference.recordType === "Project") return { key: `project:${key}`, label: dependencyLabel(reference, input), type: "Project", projectId: reference.recordId };
    return { key: `dependency:${key}`, label: dependencyLabel(reference, input), type: "Dependency", reference };
  });
  graph.controls.forEach((control) => targets.push({
    key: `control:${control.nodeId}`,
    label: `Control: ${control.intervention} · ${control.assessmentId}`,
    type: "Control",
    assessmentId: control.assessmentId,
    controlId: control.controlId,
  }));
  return targets.sort((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
}

function statesFor(target: Target): readonly string[] {
  switch (target.type) {
    case "Dependency": return ["Failed", "Degraded", "Watch", "Unknown", "Healthy"];
    case "Control": return ["Failed", "Weak", "Assured"];
    case "Person": return ["Unavailable", "Available"];
    case "Action": return ["Blocked", "Failed", "Available"];
    case "Project": return ["Blocked", "Failed", "Operating"];
  }
}

function defaultState(target: Target): string {
  switch (target.type) {
    case "Dependency": return "Failed";
    case "Control": return "Failed";
    case "Person": return "Unavailable";
    case "Action": return "Blocked";
    case "Project": return "Blocked";
  }
}

function createOverride(target: Target, state: string): IcarusStressOverride | null {
  switch (target.type) {
    case "Dependency":
      return ["Healthy", "Watch", "Degraded", "Failed", "Unknown"].includes(state)
        ? { type: "Dependency", reference: target.reference, state: state as "Healthy" | "Watch" | "Degraded" | "Failed" | "Unknown" }
        : null;
    case "Control":
      return ["Assured", "Weak", "Failed"].includes(state)
        ? { type: "Control", assessmentId: target.assessmentId, controlId: target.controlId, state: state as "Assured" | "Weak" | "Failed" }
        : null;
    case "Person":
      return state === "Available" || state === "Unavailable"
        ? { type: "Person", personId: target.personId, state }
        : null;
    case "Action":
      return state === "Available" || state === "Blocked" || state === "Failed"
        ? { type: "Action", actionId: target.actionId, state }
        : null;
    case "Project":
      return state === "Operating" || state === "Blocked" || state === "Failed"
        ? { type: "Project", projectId: target.projectId, state }
        : null;
  }
}

function overrideLabel(override: IcarusStressOverride): string {
  switch (override.type) {
    case "Dependency": return `${override.reference.recordType} ${override.reference.recordId} → ${override.state}`;
    case "Control": return `Control ${override.controlId} → ${override.state}`;
    case "Person": return `Person ${override.personId} → ${override.state}`;
    case "Action": return `Action ${override.actionId} → ${override.state}`;
    case "Project": return `Project ${override.projectId} → ${override.state}`;
  }
}

function displayLabel(key: string, input: IcarusStressTestingInput): string {
  const source = input.sourceRecords.find((entry) => getIcarusReferenceKey(entry) === key);
  return source ? `${source.recordType}: ${source.title} · ${source.recordId}` : key;
}

export default function IcarusStressLab({ input, baseline, onPromote }: Props) {
  const targets = buildTargets(input, baseline);
  const recommendations = buildIcarusRecommendedStressScenarios(input, baseline);
  const [firstTargetKey, setFirstTargetKey] = useState("");
  const [firstState, setFirstState] = useState("");
  const [useSecond, setUseSecond] = useState(false);
  const [secondTargetKey, setSecondTargetKey] = useState("");
  const [secondState, setSecondState] = useState("");
  const [result, setResult] = useState<IcarusStressResult | null>(null);
  const selectedFirst = targets.find((target) => target.key === firstTargetKey) ?? targets[0];
  const secondTargetOptions = targets.filter((target) => target.key !== selectedFirst?.key);
  const selectedSecond = secondTargetOptions.find((target) => target.key === secondTargetKey) ?? secondTargetOptions[0];

  const runScenario = (overrides: readonly IcarusStressOverride[]) => {
    setResult(runIcarusStressTest(input, overrides, baseline));
  };
  const formOverrides = [
    selectedFirst ? createOverride(selectedFirst, firstState || defaultState(selectedFirst)) : null,
    useSecond && selectedSecond ? createOverride(selectedSecond, secondState || defaultState(selectedSecond)) : null,
  ].filter((override): override is IcarusStressOverride => override !== null);

  return (
    <section aria-label="Icarus Stress Lab" className={sectionClass}>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#51483e]">Icarus · Stress tests</h2>
      <p className={`${itemClass} mt-1`}>
        Explore deterministic one- or two-node counterfactuals using explicit causal links. Scenario states stay hypothetical; only a structural finding can enter treatment after explicit promotion.
      </p>

      {recommendations.length > 0 ? (
        <>
          <h3 className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5e5953]">Recommended stress tests</h3>
          <ul className="mt-1 space-y-1">
            {recommendations.map((recommendation) => (
              <li key={recommendation.key} className={itemClass}>
                <button
                  type="button"
                  className="text-left underline"
                  onClick={() => runScenario(recommendation.overrides)}
                >
                  {recommendation.title}
                </button>
                {` · ${recommendation.category}: ${recommendation.reason}`}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5e5953]">Run a stress test</h3>
      {targets.length > 0 ? (
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <label className={labelClass}>
            First stressor
            <select
              className={selectClass}
              value={selectedFirst?.key ?? ""}
              onChange={(event) => {
                const target = targets.find((candidate) => candidate.key === event.target.value);
                setFirstTargetKey(event.target.value);
                setFirstState(target ? defaultState(target) : "");
                setResult(null);
              }}
            >
              {targets.map((target) => <option key={target.key} value={target.key}>{target.label}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Hypothetical state
            <select className={selectClass} value={firstState || (selectedFirst ? defaultState(selectedFirst) : "")}
              onChange={(event) => { setFirstState(event.target.value); setResult(null); }}>
              {selectedFirst ? statesFor(selectedFirst).map((state) => <option key={state}>{state}</option>) : null}
            </select>
          </label>
          <label className={`${labelClass} flex items-center gap-2`}>
            <input type="checkbox" checked={useSecond} onChange={(event) => { setUseSecond(event.target.checked); setResult(null); }} />
            Add a second target override
          </label>
          {useSecond ? (
            <>
              <label className={labelClass}>
                Second stressor
                <select
                  className={selectClass}
                  value={selectedSecond?.key ?? ""}
                  onChange={(event) => {
                    const target = targets.find((candidate) => candidate.key === event.target.value);
                    setSecondTargetKey(event.target.value);
                    setSecondState(target ? defaultState(target) : "");
                    setResult(null);
                  }}
                >
                  {secondTargetOptions.map((target) => <option key={target.key} value={target.key}>{target.label}</option>)}
                </select>
              </label>
              <label className={labelClass}>
                Second hypothetical state
                <select className={selectClass} value={secondState || (selectedSecond ? defaultState(selectedSecond) : "")}
                  onChange={(event) => { setSecondState(event.target.value); setResult(null); }}>
                  {selectedSecond ? statesFor(selectedSecond).map((state) => <option key={state}>{state}</option>) : null}
                </select>
              </label>
            </>
          ) : null}
          <button
            type="button"
            className="w-fit rounded-lg border border-[#755520] bg-white px-3 py-2 text-[11px] font-semibold text-[#51483e] disabled:opacity-50"
            disabled={formOverrides.length !== (useSecond ? 2 : 1)}
            onClick={() => runScenario(formOverrides)}
          >
            Run hypothetical test
          </button>
        </div>
      ) : (
        <p className={`${itemClass} mt-2`}>No causal dependency or control targets are available to stress.</p>
      )}

      {input.primaryFounderId ? (
        <div className="mt-3 border-t border-[#d8cbb8] pt-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5e5953]">Founder resilience</h3>
          <button
            type="button"
            className="mt-1 text-left text-[12px] leading-5 underline"
            onClick={() => runScenario([{ type: "Person", personId: input.primaryFounderId!, state: "Unavailable" }])}
          >
            Test founder unavailable for 30 days
          </button>
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-lg border border-[#c4ad89] bg-white p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#704e17]">
            HYPOTHETICAL — does not change Empire OS records.
          </p>
          <p className="mt-1 text-[12px] font-semibold text-[#171717]">
            {result.outcome} · {result.overrides.map(overrideLabel).join(" + ")}
          </p>
          {result.delta.newlyExposedAssessments.length > 0 ? (
            <>
              <h4 className="mt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5e5953]">Newly exposed risks</h4>
              <ul className="mt-1 space-y-1">
                {result.delta.newlyExposedAssessments.map((assessment) => (
                  <li key={assessment.assessmentId} className={itemClass}>
                    <a className="underline" href={`#icarus-assessment-${assessment.assessmentId}`}>{assessment.outcome}</a>
                    {` · failure modes ${assessment.failureModeIds.join(", ")}`}
                    {onPromote ? (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => onPromote(
                            assessment.assessmentId,
                            `Stress testing identified new exposure for ${assessment.outcome}; failure modes: ${assessment.failureModeIds.join(", ")}.`,
                            result.delta.newlyExposedAssessments.map((entry) => entry.assessmentId),
                            assessment.failureModeIds,
                          )}
                        >
                          Promote finding to treatment
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : <p className={`${itemClass} mt-2`}>No additional baseline-contained material risk became exposed.</p>}

          {result.delta.barrierChanges.length > 0 ? (
            <>
              <h4 className="mt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5e5953]">Barrier changes</h4>
              <ul className="mt-1 space-y-1">
                {result.delta.barrierChanges.map((change) => {
                  const control = result.hypothetical.failureChains.dependencyGraph.controlById.get(change.controlNodeId);
                  return (
                    <li key={change.controlNodeId} className={itemClass}>
                      <a className="underline" href={`#icarus-control-${change.controlId}`}>
                        {control?.intervention ?? change.controlId}
                      </a>
                      {` · ${change.previous} → ${change.current}${change.worsened ? " (weakened)" : ""}`}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          {result.delta.newlyExposedObjectiveIds.length > 0 || result.delta.newlyAffectedPillarIds.length > 0 ? (
            <p className={`${itemClass} mt-2`}>
              {`New objectives: ${result.delta.newlyExposedObjectiveIds.map((id) => displayLabel(`Strategic Objective:${id}`, input)).join(", ") || "none"}. Affected pillars: ${result.delta.newlyAffectedPillarIds.join(", ") || "none"}.`}
            </p>
          ) : null}

          {result.hiddenSharedDependencies.length > 0 ? (
            <>
              <h4 className="mt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8b3d28]">Hidden shared dependency</h4>
              <ul className="mt-1 space-y-1">
                {result.hiddenSharedDependencies.map((hidden) => (
                  <li key={hidden.dependencyKey} className={itemClass}>
                    {`${displayLabel(hidden.dependencyKey, input)} causes ${hidden.controlIds.length} controls to fail together: ${hidden.controlIds.join(", ")}.`}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {result.containment.length > 0 ? (
            <p className={`${itemClass} mt-2`}>{result.containment.join(" ")}</p>
          ) : null}

          {result.restorationPriorities.length > 0 ? (
            <>
              <h4 className="mt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5e5953]">Restoration under stress</h4>
              <ul className="mt-1 space-y-1">
                {result.restorationPriorities.map((priority) => (
                  <li key={priority.proposal} className={itemClass}>
                    {`${priority.proposal} · would relieve ${priority.relievedAssessmentIds.length} assessment${priority.relievedAssessmentIds.length === 1 ? "" : "s"} and protect ${priority.protectedObjectiveIds.length} objective${priority.protectedObjectiveIds.length === 1 ? "" : "s"}.`}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {result.founderOnlyWorkAtRisk.length > 0 ? (
            <p className={`${itemClass} mt-2`}>
              {`Founder-only work identified by the existing operating-independence model: ${result.founderOnlyWorkAtRisk.map((work) => work.title || `${work.objectType} ${work.id}`).join(", ")}. Ownership alone is not treated as a causal failure.`}
            </p>
          ) : null}
          {result.transferableWork.length > 0 ? (
            <p className={`${itemClass} mt-2`}>
              {`Routine work already classified as ready to delegate (no authority is changed by this test): ${result.transferableWork.map((work) => `${work.title || `${work.objectType} ${work.id}`}${work.pillar ? ` · ${work.pillar}` : ""}`).join(", ")}.`}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
