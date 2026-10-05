"use client";

import type { IcarusRecordReference } from "../lib/icarus";
import type {
  IcarusBlastRadiusSummary,
  IcarusFailureChainIntelligence,
} from "../lib/icarus-failure-chain-analysis";

// Thin presentation of derived failure-chain intelligence. Every derivation lives in icarus-failure-chain-analysis;
// this component only formats it and links back to the originating assessment / failure mode / control anchors.

type Props = {
  intelligence?: IcarusFailureChainIntelligence;
  referenceTitle: (reference: IcarusRecordReference) => string;
};

const sectionClass = "mt-4 rounded-xl border border-[#c9b8a3] bg-[#f5efe6] p-4";
const headingClass = "text-[11px] font-semibold uppercase tracking-[0.16em] text-[#51483e]";
const subheadingClass = "mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5e5953]";
const itemClass = "text-[12px] leading-5 text-[#4d4944]";
const CHAIN_LIMIT = 8;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function describeBlast(blast: IcarusBlastRadiusSummary): string {
  const parts = [
    blast.objectiveIds.length > 0 ? plural(blast.objectiveIds.length, "objective") : "",
    blast.pillarIds.length > 0 ? plural(blast.pillarIds.length, "pillar") : "",
    blast.assessmentIds.length > 1 ? plural(blast.assessmentIds.length, "assessment") : "",
  ].filter(Boolean);
  return `${blast.radius}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}${blast.founderCritical ? "; founder-critical" : ""}`;
}

export default function IcarusFailureChainSection({ intelligence, referenceTitle }: Props) {
  if (!intelligence) return null;
  const {
    dependencyGraph: graph, failureChains, singlePointsOfFailure, sharedDependencies, barrierWeaknesses,
    criticalCutPoints, twoPointFragilities, pillarChainExposure, founderSynthesis,
  } = intelligence;
  const exposedPillars = pillarChainExposure.filter((pillar) => pillar.state !== "No chain exposure");
  const hasContent = failureChains.length > 0 || singlePointsOfFailure.length > 0 || criticalCutPoints.length > 0
    || twoPointFragilities.length > 0;
  if (!hasContent) return null;

  const nodeLabel = (nodeId: string): string => {
    const node = graph.nodeById.get(nodeId);
    if (!node) return nodeId;
    return node.reference ? referenceTitle(node.reference) : node.label;
  };
  const modeLink = (nodeId: string) => {
    const mode = graph.modeById.get(nodeId);
    if (!mode) return <span>{nodeLabel(nodeId)}</span>;
    return <a href={`#icarus-failure-mode-${mode.failureModeId}`} className="underline">{nodeLabel(nodeId)}</a>;
  };
  const controlLink = (nodeId: string) => {
    const control = graph.controlById.get(nodeId);
    if (!control) return <span>{nodeLabel(nodeId)}</span>;
    return <a href={`#icarus-control-${control.controlId}`} className="underline">{nodeLabel(nodeId)}</a>;
  };
  const dependencyLink = (nodeId: string) => (graph.controlById.has(nodeId) ? controlLink(nodeId) : <span>{nodeLabel(nodeId)}</span>);

  const cutPoint = criticalCutPoints.find((entry) => entry.key === founderSynthesis.mostDamagingCutPointKey);
  const heaviest = singlePointsOfFailure.find((entry) => entry.key === founderSynthesis.heaviestSpofKey);
  const restoration = barrierWeaknesses.find((entry) => entry.key === founderSynthesis.bestRestorationKey);
  const connected = sharedDependencies.filter((entry) => founderSynthesis.connectedOutcomeKeys.includes(entry.key));
  const founderSpofs = singlePointsOfFailure.filter((entry) => founderSynthesis.founderSpofKeys.includes(entry.key));

  return (
    <section aria-label="Failure chains" className={sectionClass}>
      <h2 className={headingClass}>Failure chains · dependency intelligence</h2>

      <ul className="mt-2 space-y-1.5">
        <li className={itemClass}>
          <span className="font-medium text-[#171717]">What single failure could hurt us most? </span>
          {cutPoint
            ? <>{dependencyLink(cutPoint.nodeId)}{` — would leave ${plural(cutPoint.exposedModeNodeIds.length, "failure mode")} without a working barrier; ${describeBlast(cutPoint.blast)}.`}</>
            : "No critical cut point is derived."}
        </li>
        <li className={itemClass}>
          <span className="font-medium text-[#171717]">What dependency is carrying too much weight? </span>
          {heaviest
            ? <>{dependencyLink(heaviest.nodeId)}{` — ${heaviest.kind.toLowerCase()} single point of failure (${heaviest.assurance.toLowerCase()} assurance) for ${plural(heaviest.dependentAssessmentIds.length, "assessment")}.`}</>
            : "No causal single point of failure is derived."}
        </li>
        <li className={itemClass}>
          <span className="font-medium text-[#171717]">Which control restoration creates the greatest resilience gain? </span>
          {restoration
            ? <><a href={`#icarus-control-${restoration.controlId}`} className="underline">{restoration.intervention}</a>{` (${restoration.state.toLowerCase()} barrier) — assuring it interrupts a ${restoration.chainPriority.toLowerCase()} chain reaching ${describeBlast(restoration.interrupts)}.`}</>
            : "No weak or failed barrier on a live chain."}
        </li>
        <li className={itemClass}>
          <span className="font-medium text-[#171717]">Which outcomes are connected through the same fragility? </span>
          {connected.length > 0
            ? connected.map((entry) => `${nodeLabel(entry.nodeId)} (${entry.kind.toLowerCase()}, ${plural(entry.materialAssessmentIds.length, "material assessment")})`).join("; ")
            : "None derived."}
        </li>
        <li className={itemClass}>
          <span className="font-medium text-[#171717]">Where is founder dependency a systemic single point of failure? </span>
          {founderSpofs.length > 0
            ? founderSpofs.map((entry) => `${entry.kind.toLowerCase()} via ${nodeLabel(entry.nodeId)} (${plural(entry.dependentMaterialAssessmentIds.length, "material assessment")})`).join("; ")
            : "Not derived from current records."}
        </li>
      </ul>

      {failureChains.length > 0 ? (
        <>
          <h3 className={subheadingClass}>Live chains</h3>
          <ul className="mt-1 space-y-2">
            {failureChains.slice(0, CHAIN_LIMIT).map((chain) => {
              const reached = chain.propagation.filter((step) => step.state !== "Unknown dependency");
              const contextOnly = chain.propagation.filter((step) => step.state === "Unknown dependency");
              return (
                <li key={chain.key} className={itemClass}>
                  <span className="font-medium text-[#171717]">{chain.priority} · {chain.status}{chain.accepted ? " · accepted" : ""}: </span>
                  <a href={`#icarus-assessment-${chain.assessmentId}`} className="underline">{chain.outcome}</a>
                  {" — "}
                  <a href={`#icarus-failure-mode-${chain.failureModeId}`} className="underline">{chain.mechanism}</a>
                  {`. Blast radius: ${describeBlast(chain.blast)}.`}
                  {chain.barriers.length > 0 ? (
                    <>
                      {" Barriers: "}
                      {chain.barriers.map((barrier, index) => (
                        <span key={barrier.nodeId}>
                          {index > 0 ? ", " : ""}
                          <a href={`#icarus-control-${barrier.controlId}`} className="underline">{barrier.intervention}</a>
                          {` (${barrier.state.toLowerCase()})`}
                        </span>
                      ))}
                      .
                    </>
                  ) : " No barrier."}
                  {reached.length > 0 ? ` Reaches: ${reached.map((step) => `${nodeLabel(step.nodeId)} [${step.state.toLowerCase()}]`).join("; ")}.` : ""}
                  {contextOnly.length > 0 ? ` Context only (no declared dependency): ${contextOnly.map((step) => nodeLabel(step.nodeId)).join("; ")}.` : ""}
                </li>
              );
            })}
          </ul>
          {failureChains.length > CHAIN_LIMIT ? <p className={`mt-1 ${itemClass}`}>{`${failureChains.length - CHAIN_LIMIT} lower-priority chains not shown.`}</p> : null}
        </>
      ) : null}

      {singlePointsOfFailure.length > 0 ? (
        <>
          <h3 className={subheadingClass}>Single points of failure</h3>
          <ul className="mt-1 space-y-1.5">
            {singlePointsOfFailure.map((spof) => (
              <li key={spof.key} className={itemClass}>
                <span className="font-medium text-[#171717]">{spof.kind}{spof.causal ? "" : " (governance, not causal)"}{spof.founderDependency ? " · founder" : ""}: </span>
                {dependencyLink(spof.nodeId)}
                {` — ${spof.assurance.toLowerCase()} assurance; ${plural(spof.dependentAssessmentIds.length, "assessment")} depend on it; ${describeBlast(spof.blast)}.`}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {sharedDependencies.length > 0 ? (
        <>
          <h3 className={subheadingClass}>Shared dependencies</h3>
          <ul className="mt-1 space-y-1.5">
            {sharedDependencies.map((entry) => (
              <li key={entry.key} className={itemClass}>
                <span className="font-medium text-[#171717]">{entry.kind}{entry.causal ? " (common cause)" : " (correlation, not causal)"}: </span>
                {`${nodeLabel(entry.nodeId)} — ${plural(entry.assessmentIds.length, "assessment")}, ${entry.materialAssessmentIds.length} material.`}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {criticalCutPoints.length > 0 || twoPointFragilities.length > 0 ? (
        <>
          <h3 className={subheadingClass}>Cut points and fragility</h3>
          <ul className="mt-1 space-y-1.5">
            {criticalCutPoints.map((cut) => (
              <li key={cut.key} className={itemClass}>
                <span className="font-medium text-[#171717]">Cut point ({cut.kind.toLowerCase()}): </span>
                {dependencyLink(cut.nodeId)}
                {` — failure exposes ${plural(cut.exposedModeNodeIds.length, "failure mode")}${cut.newlyExposedModeNodeIds.length > 0 ? `, ${cut.newlyExposedModeNodeIds.length} currently held by an assured barrier` : ""}; ${describeBlast(cut.blast)}.`}
              </li>
            ))}
            {twoPointFragilities.map((entry) => (
              <li key={entry.key} className={itemClass}>
                <span className="font-medium text-[#171717]">Two-point fragility: </span>
                {modeLink(entry.modeNodeId)}
                {" is held only by "}
                {controlLink(entry.controlNodeIds[0])}
                {" and "}
                {controlLink(entry.controlNodeIds[1])}
                {entry.independence === "Shared dependency"
                  ? ` — both rely on ${entry.sharedDependencyNodeIds.map(nodeLabel).join(", ")}.`
                  : " — independence not recorded."}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {exposedPillars.length > 0 ? (
        <>
          <h3 className={subheadingClass}>Pillar chain exposure</h3>
          <ul className="mt-1 space-y-1.5">
            {exposedPillars.map((pillar) => (
              <li key={pillar.pillarId} className={itemClass}>
                <span className="font-medium text-[#171717]">{pillar.label}: {pillar.state}</span>
                {` — ${plural(pillar.chainKeys.length, "chain")}${pillar.crossPillarChainKeys.length > 0 ? `, ${pillar.crossPillarChainKeys.length} cross-pillar` : ""}${pillar.spofKeys.length > 0 ? `, ${plural(pillar.spofKeys.length, "single point")} of failure` : ""}${pillar.weakBarrierControlNodeIds.length > 0 ? `, ${plural(pillar.weakBarrierControlNodeIds.length, "weak barrier")}` : ""}.`}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
