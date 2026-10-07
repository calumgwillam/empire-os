import { getIcarusReferenceKey, type IcarusControl } from "./icarus";
import type { IcarusControlAssuranceStatus } from "./icarus-assurance-policy";
import {
  getIcarusDependencyHealth,
  type IcarusDependencyHealthRegistry,
} from "./icarus-dependency-health";
import { getIcarusEffectiveBarrierState } from "./icarus-failure-chain-policy";

// Objective/pillar links describe consequence, not implementation dependencies.
export function getIcarusRequiredDependencies(control: Pick<IcarusControl, "lifecycle" | "linkedRecords">) {
  const references = control.lifecycle === "Retired" ? [] : control.linkedRecords
    .filter((reference) => reference.recordType !== "Pillar" && reference.recordType !== "Strategic Objective");
  return [...new Map(references.map((reference) => [getIcarusReferenceKey(reference), reference])).values()]
    .sort((a, b) => getIcarusReferenceKey(a).localeCompare(getIcarusReferenceKey(b)));
}

export function getIcarusEffectiveProtection(
  control: Pick<IcarusControl, "lifecycle" | "linkedRecords">,
  assurance: IcarusControlAssuranceStatus,
  registry: IcarusDependencyHealthRegistry,
) {
  const dependencies = getIcarusRequiredDependencies(control)
    .map((reference) => getIcarusDependencyHealth(registry, reference));
  return {
    assurance,
    dependencies,
    barrier: getIcarusEffectiveBarrierState(assurance, dependencies.map((dependency) => dependency.health)),
  };
}
