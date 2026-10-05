import { describe, expect, it } from "vitest";
import {
  OPERATING_PILLARS,
  normalisePillarKey,
  resolveOperatingArea,
  resolveOperatingPillar,
  resolveOperatingPillars,
  resolveStrategicTheme,
} from "./pillar-identity";
import { strategicPillars } from "./strategic-reviews";

describe("pillar identity", () => {
  it("resolves every current stored operating-pillar label to a canonical identity", () => {
    OPERATING_PILLARS.forEach((pillar) => {
      expect(resolveOperatingPillar(pillar.label)).toEqual({ id: pillar.id, label: pillar.label });
      expect(resolveOperatingPillar(pillar.id)).toEqual({ id: pillar.id, label: pillar.label });
    });
  });

  it("tolerates formatting drift in legacy values without inventing aliases", () => {
    expect(resolveOperatingPillar("  garden   maintenance ")?.id).toBe("garden-maintenance");
    expect(resolveOperatingPillar("HARD LANDSCAPE CONSTRUCTION")?.id).toBe("hard-landscape-construction");
    expect(resolveOperatingPillar("Hard Landscaping")).toBeNull();
    expect(resolveOperatingPillar("Groundworks")).toBeNull();
    expect(resolveOperatingPillar(undefined)).toBeNull();
    expect(normalisePillarKey("Marketing/Growth")).toBe(normalisePillarKey("Marketing / Growth"));
    expect(normalisePillarKey("Capital and Resilience")).toBe(normalisePillarKey("Capital & Resilience"));
  });

  it("keeps strategic themes distinct from operating pillars", () => {
    strategicPillars.forEach((theme) => {
      expect(resolveOperatingPillar(theme)).toBeNull();
      expect(resolveStrategicTheme(theme)).toBe(theme);
      expect(resolveOperatingArea(theme)).toEqual({ kind: "Strategic theme", theme });
    });
    expect(resolveStrategicTheme("Garden Maintenance")).toBeNull();
  });

  it("classifies functional areas, unassigned and unmapped values explicitly", () => {
    expect(resolveOperatingArea("Systems")).toEqual({ kind: "Functional area", areaId: "systems", label: "Systems" });
    expect(resolveOperatingArea("marketing/growth")).toMatchObject({ kind: "Functional area", areaId: "marketing-growth" });
    expect(resolveOperatingArea("")).toEqual({ kind: "Unassigned" });
    expect(resolveOperatingArea("Unassigned")).toEqual({ kind: "Unassigned" });
    expect(resolveOperatingArea(undefined)).toEqual({ kind: "Unassigned" });
    expect(resolveOperatingArea(" Icarus ")).toEqual({ kind: "Unmapped", raw: "Icarus" });
    expect(resolveOperatingArea("excavation")).toEqual({ kind: "Operating pillar", pillar: { id: "excavation", label: "Excavation" } });
  });

  it("dedupes differently-written values of one pillar and orders canonically", () => {
    const result = resolveOperatingPillars(["Excavation", "excavation ", "Garden Maintenance", "Operating Business", ""]);
    expect(result.pillars.map((pillar) => pillar.id)).toEqual(["garden-maintenance", "excavation"]);
    expect(result.unresolved).toEqual(["Operating Business"]);
  });
});
