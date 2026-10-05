import { strategicPillars } from "./strategic-reviews";

// Empire OS has two distinct pillar concepts that must never be conflated:
// - Operating pillars: the core business pillars that carry operational records (projects,
//   actions, problems, leads…) and are stored as display labels in `area`/`relatedPillar`/Icarus
//   "Pillar" references.
// - Strategic themes: the strategic-objective "pillar" field (e.g. "Operating Business"). These
//   classify strategic intent and do not map onto an operating pillar.
// Operational records may also carry a functional area (People, Systems…) that is not a pillar.
// Persisted values are never rewritten; they are resolved here at read time.

export const OPERATING_PILLARS = [
  { id: "garden-maintenance", label: "Garden Maintenance" },
  { id: "hard-landscape-construction", label: "Hard Landscape Construction" },
  { id: "excavation", label: "Excavation" },
] as const;

export type OperatingPillarId = (typeof OPERATING_PILLARS)[number]["id"];
export type OperatingPillarLabel = (typeof OPERATING_PILLARS)[number]["label"];

export const OPERATING_FUNCTIONAL_AREAS = [
  { id: "people", label: "People" },
  { id: "systems", label: "Systems" },
  { id: "finance", label: "Finance" },
  { id: "marketing-growth", label: "Marketing / Growth" },
] as const;

export type OperatingFunctionalAreaId = (typeof OPERATING_FUNCTIONAL_AREAS)[number]["id"];

export type StrategicTheme = (typeof strategicPillars)[number];

export type OperatingPillarIdentity = { id: OperatingPillarId; label: OperatingPillarLabel };

export type OperatingAreaResolution =
  | { kind: "Operating pillar"; pillar: OperatingPillarIdentity }
  | { kind: "Functional area"; areaId: OperatingFunctionalAreaId; label: string }
  // A strategic-objective theme used where an operating area was expected; kept explicit, never coerced.
  | { kind: "Strategic theme"; theme: StrategicTheme }
  | { kind: "Unassigned" }
  | { kind: "Unmapped"; raw: string };

const unassignedValues = new Set(["", "unassigned", "none", "n/a"]);

// Tolerates formatting drift only (case, whitespace, "&" vs "and", spacing around "/");
// no semantic aliases are invented.
export function normalisePillarKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

const pillarByKey = new Map<string, OperatingPillarIdentity>();
OPERATING_PILLARS.forEach((pillar) => {
  pillarByKey.set(normalisePillarKey(pillar.label), { id: pillar.id, label: pillar.label });
  pillarByKey.set(normalisePillarKey(pillar.id.replace(/-/g, " ")), { id: pillar.id, label: pillar.label });
  pillarByKey.set(pillar.id, { id: pillar.id, label: pillar.label });
});
const functionalAreaByKey = new Map<string, (typeof OPERATING_FUNCTIONAL_AREAS)[number]>();
OPERATING_FUNCTIONAL_AREAS.forEach((area) => {
  functionalAreaByKey.set(normalisePillarKey(area.label), area);
  functionalAreaByKey.set(area.id, area);
});
const themeByKey = new Map<string, StrategicTheme>(strategicPillars.map((theme) => [normalisePillarKey(theme), theme]));

export function resolveOperatingPillar(value: string | null | undefined): OperatingPillarIdentity | null {
  if (typeof value !== "string") return null;
  const pillar = pillarByKey.get(normalisePillarKey(value));
  return pillar ? { ...pillar } : null;
}

export function resolveStrategicTheme(value: string | null | undefined): StrategicTheme | null {
  if (typeof value !== "string") return null;
  return themeByKey.get(normalisePillarKey(value)) ?? null;
}

export function resolveOperatingArea(value: string | null | undefined): OperatingAreaResolution {
  if (typeof value !== "string" || unassignedValues.has(normalisePillarKey(value))) return { kind: "Unassigned" };
  const pillar = resolveOperatingPillar(value);
  if (pillar) return { kind: "Operating pillar", pillar };
  const area = functionalAreaByKey.get(normalisePillarKey(value));
  if (area) return { kind: "Functional area", areaId: area.id, label: area.label };
  const theme = resolveStrategicTheme(value);
  if (theme) return { kind: "Strategic theme", theme };
  return { kind: "Unmapped", raw: value.trim() };
}

export function getOperatingPillarRank(id: OperatingPillarId): number {
  return OPERATING_PILLARS.findIndex((pillar) => pillar.id === id);
}

export function compareOperatingPillars(left: OperatingPillarIdentity, right: OperatingPillarIdentity): number {
  return getOperatingPillarRank(left.id) - getOperatingPillarRank(right.id);
}

// Resolves a set of raw values to unique canonical pillars in canonical order; unmappable values are reported, not dropped silently.
export function resolveOperatingPillars(values: readonly string[]): { pillars: OperatingPillarIdentity[]; unresolved: string[] } {
  const pillars = new Map<OperatingPillarId, OperatingPillarIdentity>();
  const unresolved = new Set<string>();
  values.forEach((value) => {
    const pillar = resolveOperatingPillar(value);
    if (pillar) pillars.set(pillar.id, pillar);
    else if (value.trim()) unresolved.add(value.trim());
  });
  return {
    pillars: [...pillars.values()].sort(compareOperatingPillars),
    unresolved: [...unresolved].sort(),
  };
}
