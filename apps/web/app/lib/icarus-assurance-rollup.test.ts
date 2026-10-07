import { describe, expect, it } from "vitest";
import type { IcarusAssessmentAssurance } from "./icarus-assurance";
import { buildIcarusAssuranceRollup } from "./icarus-assurance-rollup";

function entry(id: string, overrides: Partial<IcarusAssessmentAssurance> = {}): IcarusAssessmentAssurance {
  const state = overrides.state ?? "Weak";
  const escalation = overrides.escalation ?? "None";
  return {
    assessmentId: id,
    outcome: `Outcome ${id}`,
    status: "Open",
    material: true,
    state,
    basis: [],
    ownership: "Assigned",
    founderOwned: false,
    founderOwnershipConcern: false,
    modes: [],
    controls: [],
    acceptances: [],
    obligations: [],
    escalation,
    evidenceWeaknessCodes: [],
    operatingPillarIds: ["excavation"],
    objectiveIds: [],
    signal: {
      state, escalation, escalationCategories: [], ownership: "Assigned", founderOwned: false, acceptance: "None",
      materialModesAccepted: false, failedControlIds: [], overdueObligationCount: 0, obligationCount: 0,
    },
    ...overrides,
  };
}

describe("pillar assurance rollup", () => {
  it("returns empty rollups without assessments", () => {
    expect(buildIcarusAssuranceRollup([])).toEqual({ pillars: [], objectives: [], unattributedMaterialAssessmentIds: [] });
  });

  it("reports non-material pillars as having no material exposure", () => {
    const { pillars } = buildIcarusAssuranceRollup([entry("a", { material: false, state: "Assured" })]);
    expect(pillars).toEqual([expect.objectContaining({ pillarId: "excavation", posture: "No material exposure", materialAssessmentIds: [] })]);
  });

  it("derives categorical postures from escalation and state", () => {
    const { pillars } = buildIcarusAssuranceRollup([
      entry("f", { operatingPillarIds: ["failure"], escalation: "Assurance failure" }),
      entry("g", { operatingPillarIds: ["gap"], escalation: "Governance gap" }),
      entry("p", { operatingPillarIds: ["partial"], state: "Unassured" }),
      entry("s", { operatingPillarIds: ["sound"], state: "Assured" }),
      entry("t", { operatingPillarIds: ["sound"], state: "Accepted exposure" }),
    ]);
    expect(pillars.map((pillar) => [pillar.pillarId, pillar.posture])).toEqual([
      ["failure", "Assurance failure"],
      ["gap", "Governance gaps"],
      ["partial", "Partially assured"],
      ["sound", "Governed exposure"],
    ]);
  });

  it("keeps tested protection distinct from accepted exposure with stable counts and ordering", () => {
    const entries = [
      entry("protected", { operatingPillarIds: ["protected"], state: "Assured" }),
      entry("accepted", { operatingPillarIds: ["accepted"], state: "Accepted exposure" }),
      entry("mixed-protected", { operatingPillarIds: ["mixed"], state: "Assured" }),
      entry("mixed-accepted", { operatingPillarIds: ["mixed"], state: "Accepted exposure" }),
      entry("weak", { operatingPillarIds: ["weak"], state: "Weak", escalation: "Assurance failure" }),
      entry("weak-accepted", { operatingPillarIds: ["weak"], state: "Accepted exposure" }),
    ];
    const rollup = buildIcarusAssuranceRollup(entries);
    expect(rollup).toEqual(buildIcarusAssuranceRollup([...entries].reverse()));
    expect(rollup.pillars.map(({ pillarId, posture }) => [pillarId, posture])).toEqual([
      ["weak", "Assurance failure"], ["accepted", "Governed exposure"],
      ["mixed", "Governed exposure"], ["protected", "Assured"],
    ]);
    expect(rollup.pillars.find((pillar) => pillar.pillarId === "mixed")?.stateCounts)
      .toEqual({ Assured: 1, "Accepted exposure": 1, "Partially assured": 0, Weak: 0, Unassured: 0 });
    expect(rollup.pillars.find((pillar) => pillar.pillarId === "accepted")?.stateCounts.Assured).toBe(0);
  });

  it("counts unowned risks, failed controls, overdue obligations and acceptances per pillar", () => {
    const [pillar] = buildIcarusAssuranceRollup([
      entry("a", {
        ownership: "Unassigned",
        escalation: "Assurance failure",
        signal: { ...entry("a").signal, failedControlIds: ["c1", "c2"], overdueObligationCount: 2 },
        acceptances: [
          { acceptanceId: "x1", validity: "Active", invalidReasons: [], failureModeIds: ["m"], acceptedByPersonId: "p", acceptedAt: "", reviewBy: "", rationale: "r", current: true },
          { acceptanceId: "x0", validity: "Expired", invalidReasons: [], failureModeIds: ["m"], acceptedByPersonId: "p", acceptedAt: "", reviewBy: "", rationale: "r", current: false },
        ],
      }),
      entry("b", {
        signal: { ...entry("b").signal, failedControlIds: ["c1"], overdueObligationCount: 1 },
        acceptances: [
          { acceptanceId: "x2", validity: "Expired", invalidReasons: [], failureModeIds: ["m"], acceptedByPersonId: "p", acceptedAt: "", reviewBy: "", rationale: "r", current: true },
        ],
      }),
      entry("c", { material: false, ownership: "Unassigned" }),
    ]).pillars;
    expect(pillar).toMatchObject({
      posture: "Assurance failure",
      materialAssessmentIds: ["a", "b"],
      unownedMaterialAssessmentIds: ["a"],
      // Control ids are scoped per assessment: "c1" in two assessments is two controls.
      failedControlCount: 3,
      overdueObligationCount: 3,
      activeAcceptanceCount: 1,
      // Superseded acceptances are history, not current exposure.
      expiredAcceptanceCount: 1,
      escalatingAssessmentIds: ["a"],
      stateCounts: { Weak: 2, Unassured: 0, "Partially assured": 0, "Accepted exposure": 0, Assured: 0 },
    });
  });

  it("counts an assessment once per pillar and keeps unattributed risks explicit", () => {
    const rollup = buildIcarusAssuranceRollup([
      entry("a", { operatingPillarIds: ["excavation", "excavation"] }),
      entry("b", { operatingPillarIds: [] }),
      entry("c", { operatingPillarIds: [], material: false }),
    ]);
    expect(rollup.pillars[0].materialAssessmentIds).toEqual(["a"]);
    expect(rollup.unattributedMaterialAssessmentIds).toEqual(["b"]);
  });
});

describe("objective assurance rollup", () => {
  it("reports protection by the weakest material assessment", () => {
    const { objectives } = buildIcarusAssuranceRollup([
      entry("a", { objectiveIds: ["obj-1"], state: "Assured" }),
      entry("b", { objectiveIds: ["obj-1"], state: "Unassured", escalation: "Governance gap" }),
      entry("c", { objectiveIds: ["obj-2"], state: "Assured" }),
      entry("d", { objectiveIds: ["obj-3"], state: "Accepted exposure" }),
      entry("e", { objectiveIds: ["obj-4"], state: "Weak" }),
      entry("f", { objectiveIds: ["obj-5"], state: "Weak", material: false }),
    ]);
    expect(objectives.map((objective) => [objective.objectiveId, objective.protection, objective.weakestAssessmentId, objective.escalation])).toEqual([
      ["obj-4", "Exposed", "e", "None"],
      ["obj-1", "Assumed protection", "b", "Governance gap"],
      ["obj-3", "Accepted exposure", "d", "None"],
      ["obj-2", "Tested controls", "c", "None"],
    ]);
  });

  it("is deterministic regardless of input order", () => {
    const entries = [
      entry("b", { objectiveIds: ["obj-1"], operatingPillarIds: ["landscaping"] }),
      entry("a", { objectiveIds: ["obj-1"], operatingPillarIds: ["excavation"] }),
    ];
    expect(buildIcarusAssuranceRollup([...entries].reverse())).toEqual(buildIcarusAssuranceRollup(entries));
    expect(buildIcarusAssuranceRollup(entries).objectives[0].weakestAssessmentId).toBe("a");
  });
});
