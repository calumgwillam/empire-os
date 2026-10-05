import { describe, expect, it } from "vitest";
import {
  buildIcarusReview,
  getIcarusReferenceKey,
  type IcarusAssessmentRecord,
  type IcarusControl,
  type IcarusEvidence,
  type IcarusFailureMode,
  type IcarusRecordReference,
  type IcarusSourceRecord,
} from "./icarus";
import { buildIcarusStrategicAttention, type IcarusStrategicObjectiveContext } from "./icarus-strategic-attention";
import {
  buildIcarusSystemicExposure,
  getIcarusPillarExposureStateRank,
  type IcarusSystemicExposureInput,
} from "./icarus-systemic-exposure";

const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const timestamp = "2026-10-01T12:00:00.000Z";
const pillars = ["Garden Maintenance", "Hard Landscape Construction", "Excavation"] as const;

function evidence(overrides: Partial<IcarusEvidence> = {}): IcarusEvidence {
  return {
    id: "evidence-1",
    statement: "Observed failure.",
    origin: "Direct observation",
    recordedAt: timestamp,
    recordedBy: "Founder",
    review: "Supports",
    reviewedAt: timestamp,
    reviewedBy: "Founder",
    ...overrides,
  };
}

function mode(overrides: Partial<IcarusFailureMode> = {}): IcarusFailureMode {
  return { id: "mode-1", mechanism: "Mechanism.", vulnerability: "Vulnerability.", evidence: [evidence()], ...overrides };
}

function control(overrides: Partial<IcarusControl> = {}): IcarusControl {
  return {
    id: "control-1",
    failureModeId: "mode-1",
    intervention: "Control.",
    lifecycle: "Active",
    effectiveness: "Unknown",
    evidenceIds: [],
    linkedRecords: [],
    nextReviewAt: "2026-12-31",
    ...overrides,
  };
}

function assessment(id: string, overrides: Partial<IcarusAssessmentRecord> = {}): IcarusAssessmentRecord {
  return {
    id,
    outcome: `Outcome ${id}`,
    status: "Open",
    createdAt: timestamp,
    updatedAt: timestamp,
    linkedRecords: [],
    failureModes: [mode()],
    controls: [],
    ...overrides,
  };
}

const pillarRef = (pillar: string): IcarusRecordReference => ({ recordType: "Pillar", recordId: pillar });
const excavation = pillarRef("Excavation");
const objectiveRef: IcarusRecordReference = { recordType: "Strategic Objective", recordId: "objective-1" };

const exposed = (id: string, linkedRecords: IcarusRecordReference[] = [excavation]) => assessment(id, { linkedRecords });
const unverified = (id: string) => assessment(id, { linkedRecords: [excavation], controls: [control()] });
const unexamined = (id: string) => assessment(id, { linkedRecords: [excavation], failureModes: [mode({ evidence: [] })] });

function sourcesFor(assessments: readonly IcarusAssessmentRecord[]): IcarusSourceRecord[] {
  const references = assessments.flatMap((entry) => [
    ...entry.linkedRecords,
    ...entry.controls.flatMap((item) => item.linkedRecords),
    ...entry.failureModes.flatMap((item) => item.evidence.flatMap((record) => record.reference ? [record.reference] : [])),
  ]);
  const unique = new Map(references.map((reference) => [getIcarusReferenceKey(reference), reference] as const));
  return [...unique.values()].map((reference) => ({ ...reference, title: reference.recordId }));
}

const objectives = new Map<string, IcarusStrategicObjectiveContext>([
  ["objective-1", { area: "Operating Business", importance: "High", isLive: true }],
]);

function exposure(assessments: readonly IcarusAssessmentRecord[], extra: Omit<Partial<IcarusSystemicExposureInput>, "signals"> = {}) {
  const signals = buildIcarusStrategicAttention({
    assessments,
    reviews: buildIcarusReview(assessments, sourcesFor(assessments), NOW),
    strategicObjectives: objectives,
  });
  return buildIcarusSystemicExposure({ signals, pillars, ...extra });
}

const pillarOf = (result: ReturnType<typeof exposure>, pillar = "Excavation") =>
  result.pillars.find((entry) => entry.pillar === pillar)!;

describe("Icarus pillar exposure rollup", () => {
  it("reports no material exposure for every configured pillar when Icarus has no material signals", () => {
    const result = exposure([]);
    expect(result.pillars.map((entry) => [entry.pillar, entry.state, entry.pattern, entry.highest])).toEqual(
      pillars.map((pillar) => [pillar, "No material exposure", "None", null]),
    );
    expect(result.objectives).toEqual([]);
    expect(result.unattributedAssessmentIds).toEqual([]);
  });

  it("puts a single unexamined or unverified exposure on watch only", () => {
    for (const record of [unexamined("u"), unverified("v")]) {
      const pillar = pillarOf(exposure([record]));
      expect(pillar.state).toBe("Watch");
      expect(pillar.basis).toEqual(["unverified-or-unexamined-only"]);
      expect(pillar.pattern).toBe("Isolated");
    }
  });

  it("treats several weak assessments in one pillar as material, but not systemic", () => {
    const pillar = pillarOf(exposure([unexamined("u"), unverified("v")]));
    expect(pillar.state).toBe("Material exposure");
    expect(pillar.basis).toEqual(["multiple-material-assessments", "unverified-or-unexamined-only"]);
    expect(pillar).toMatchObject({ unexaminedFailureModeCount: 1, unverifiedControlCount: 1, failingControlCount: 0 });
  });

  it("treats one evidenced exposed mechanism as isolated material exposure", () => {
    const pillar = pillarOf(exposure([exposed("e")]));
    expect(pillar).toMatchObject({
      state: "Material exposure",
      pattern: "Isolated",
      basis: ["evidenced-or-failing-exposure"],
      assessmentCount: 1,
      evidencedOrFailingAssessmentCount: 1,
      exposedFailureModeCount: 1,
    });
    expect(pillar.highest).toMatchObject({ assessmentId: "e", exposure: "Exposed" });
    expect(pillar.highest!.reference.assessmentId).toBe("e");
  });

  it("escalates to systemic exposure when several evidenced assessments concentrate in one pillar", () => {
    const pillar = pillarOf(exposure([exposed("b"), exposed("a"), unverified("c")]));
    expect(pillar.state).toBe("Systemic exposure");
    expect(pillar.basis).toContain("multiple-evidenced-or-failing-assessments");
    expect(pillar.assessments.map((entry) => entry.assessmentId)).toEqual(["a", "b", "c"]);
  });

  it("does not double count several failure modes or repeated attribution within one assessment", () => {
    const record = assessment("multi", {
      linkedRecords: [excavation, { recordType: "Project", recordId: "p" }],
      failureModes: [mode({ id: "mode-1" }), mode({ id: "mode-2" })],
      controls: [
        control({ id: "c1", failureModeId: "mode-1", lifecycle: "Ineffective" }),
        control({ id: "c2", failureModeId: "mode-2", effectiveness: "Weak" }),
      ],
    });
    const pillar = pillarOf(exposure([record], { recordPillars: new Map([["Project:p", "Excavation"]]) }));
    expect(pillar.state).toBe("Material exposure");
    expect(pillar).toMatchObject({
      assessmentCount: 1,
      evidencedOrFailingAssessmentCount: 1,
      materialFailureModeCount: 2,
      exposedFailureModeCount: 2,
      failingControlCount: 2,
    });
    expect(pillar.assessments[0].attribution).toEqual(["Pillar link", "Linked record"]);
  });

  it("attributes through linked records' pillars and ignores pillars outside the configured set", () => {
    const viaRecord = exposed("record", [{ recordType: "Project", recordId: "p" }]);
    const unknownPillar = exposed("unknown", [pillarRef("Not a pillar")]);
    const result = exposure([viaRecord, unknownPillar], { recordPillars: new Map([["Project:p", "Garden Maintenance"]]) });
    expect(pillarOf(result, "Garden Maintenance")).toMatchObject({ state: "Material exposure", assessmentCount: 1 });
    expect(pillarOf(result, "Garden Maintenance").assessments[0].attribution).toEqual(["Linked record"]);
    expect(pillarOf(result).state).toBe("No material exposure");
    expect(result.unattributedAssessmentIds).toEqual(["unknown"]);
  });

  it("recognises systemic exposure when evidenced Icarus exposure coincides with distinct non-Icarus signals", () => {
    const one = pillarOf(exposure([exposed("e")], {
      otherSignals: [{ recordKey: "Action:a", area: "Excavation", signals: ["blocked"] }],
    }));
    expect(one).toMatchObject({ state: "Material exposure", pattern: "Multi-signal", otherSignalCategories: ["blocked"] });

    // Duplicate representations of the same record and the same category are not separate evidence.
    const repeated = pillarOf(exposure([exposed("e")], {
      otherSignals: [
        { recordKey: "Action:a", area: "Excavation", signals: ["blocked"] },
        { recordKey: "Action:a", area: "Excavation", signals: ["blocked"] },
        { recordKey: "Action:b", area: "Excavation", signals: ["blocked"] },
      ],
    }));
    expect(repeated.state).toBe("Material exposure");
    expect(repeated.otherSignalRecordKeys).toEqual(["Action:a", "Action:b"]);

    const systemic = pillarOf(exposure([exposed("e")], {
      otherSignals: [
        { recordKey: "Action:a", area: "Excavation", signals: ["blocked"] },
        { recordKey: "Project:p", area: "Excavation", signals: ["stale record"] },
        { recordKey: "Action:z", area: "Garden Maintenance", signals: ["overdue"] },
      ],
    }));
    expect(systemic.state).toBe("Systemic exposure");
    expect(systemic.basis).toContain("cross-system-signals");
    expect(systemic.otherSignalCategories).toEqual(["blocked", "stale record"]);
  });

  it("recognises systemic exposure when an evidenced assessment participates in a convergent situation", () => {
    const pillar = pillarOf(exposure([exposed("e")], {
      clusters: [
        { clusterKey: "cluster:Action:a", convergent: true, assessmentIds: ["e"] },
        { clusterKey: "cluster:Action:b", convergent: false, assessmentIds: ["e"] },
      ],
    }));
    expect(pillar.state).toBe("Systemic exposure");
    expect(pillar.pattern).toBe("Multi-signal");
    expect(pillar.convergentClusterKeys).toEqual(["cluster:Action:a"]);
  });

  it("never escalates weak-only exposure to systemic even alongside other signals", () => {
    const pillar = pillarOf(exposure([unverified("v")], {
      otherSignals: [
        { recordKey: "Action:a", area: "Excavation", signals: ["blocked"] },
        { recordKey: "Project:p", area: "Excavation", signals: ["stale record"] },
      ],
      clusters: [{ clusterKey: "cluster:Action:a", convergent: true, assessmentIds: ["v"] }],
    }));
    expect(pillar.state).toBe("Watch");
    expect(pillar.pattern).toBe("Multi-signal");
  });

  it("drops a pillar back to no material exposure once its assessment is closed", () => {
    expect(pillarOf(exposure([exposed("e")])).state).toBe("Material exposure");
    expect(pillarOf(exposure([assessment("e", { linkedRecords: [excavation], status: "Closed" })])).state)
      .toBe("No material exposure");
  });

  it("orders states by severity", () => {
    expect(["Systemic exposure", "Watch", "Material exposure", "No material exposure"]
      .map((state) => getIcarusPillarExposureStateRank(state as never)))
      .toEqual([3, 1, 2, 0]);
  });

  it("is deterministic regardless of input order", () => {
    const records = [exposed("b"), unverified("c"), exposed("a", [excavation, objectiveRef])];
    expect(exposure(records)).toEqual(exposure([...records].reverse()));
  });
});

describe("Icarus objective concentration", () => {
  it("flags several failure modes threatening one objective as concentrated, even within one assessment", () => {
    const single = exposure([exposed("one", [objectiveRef])]);
    expect(single.objectives).toEqual([expect.objectContaining({ objectiveId: "objective-1", concentrated: false, materialFailureModeCount: 1 })]);

    const twoModes = exposure([assessment("two", {
      linkedRecords: [objectiveRef],
      failureModes: [mode({ id: "mode-1" }), mode({ id: "mode-2" })],
    })]);
    expect(twoModes.objectives[0]).toMatchObject({ concentrated: true, materialFailureModeCount: 2, assessmentIds: ["two"] });

    const twoAssessments = exposure([exposed("x", [objectiveRef]), unverified("y")].map((record, index) =>
      index === 1 ? { ...record, linkedRecords: [objectiveRef] } : record));
    expect(twoAssessments.objectives[0]).toMatchObject({
      concentrated: true,
      strongestExposure: "Exposed",
      assessmentIds: ["x", "y"],
    });
    expect(twoAssessments.objectives[0].references.map((reference) => reference.assessmentId)).toEqual(["x", "y"]);
  });
});

describe("Icarus pillar exposure canonical identity", () => {
  it("exposes the canonical pillar id alongside the display label in canonical order", () => {
    const result = exposure([exposed("e")]);
    expect(result.pillars.map((entry) => [entry.pillarId, entry.pillar])).toEqual([
      ["garden-maintenance", "Garden Maintenance"],
      ["hard-landscape-construction", "Hard Landscape Construction"],
      ["excavation", "Excavation"],
    ]);
  });

  it("reads legacy case/spacing forms of a pillar link as the same canonical pillar", () => {
    const canonical = pillarOf(exposure([exposed("e")]));
    const legacy = pillarOf(exposure([exposed("e", [pillarRef("  excavation ")])]));
    expect(legacy).toEqual(canonical);
  });

  it("collapses duplicate pillar representations into one rollup entry", () => {
    const result = exposure([exposed("e", [excavation, pillarRef("EXCAVATION")])], { pillars: ["Excavation", "excavation", "Hard Landscape Construction"] });
    expect(result.pillars.map((entry) => entry.pillarId)).toEqual(["hard-landscape-construction", "excavation"]);
    expect(pillarOf(result).assessmentCount).toBe(1);
  });

  it("ignores strategic themes rather than coercing them into an operating pillar", () => {
    const result = exposure([exposed("t", [pillarRef("Operating Business")])], { pillars: [...pillars, "Operating Business"] });
    expect(result.pillars.map((entry) => entry.pillar)).toEqual([...pillars]);
    expect(result.pillars.every((entry) => entry.assessmentCount === 0)).toBe(true);
    expect(result.unattributedAssessmentIds).toEqual(["t"]);
  });

  it("defaults to every operating pillar when no pillar list is supplied", () => {
    const signals = buildIcarusStrategicAttention({ assessments: [exposed("e")], reviews: buildIcarusReview([exposed("e")], sourcesFor([exposed("e")]), NOW) });
    expect(buildIcarusSystemicExposure({ signals }).pillars.map((entry) => entry.pillar)).toEqual([...pillars]);
  });

  it("attributes via a linked record's stored pillar value resolved canonically", () => {
    const record = assessment("p", { linkedRecords: [{ recordType: "Project", recordId: "project-1" }] });
    const result = exposure([record], { recordPillars: new Map([["Project:project-1", "hard landscape construction"]]) });
    expect(pillarOf(result, "Hard Landscape Construction").assessmentCount).toBe(1);
  });
});
