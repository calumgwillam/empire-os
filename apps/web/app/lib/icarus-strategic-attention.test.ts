import { describe, expect, it } from "vitest";
import {
  buildIcarusReview,
  getIcarusIdentityKey,
  getIcarusReferenceKey,
  type IcarusAssessmentRecord,
  type IcarusControl,
  type IcarusEvidence,
  type IcarusFailureMode,
  type IcarusRecordReference,
  type IcarusSourceRecord,
} from "./icarus";
import {
  buildIcarusFounderFocusRisks,
  buildIcarusStrategicAttention,
  getIcarusAttentionTarget,
  getIcarusCommandPlacement,
  type IcarusStrategicObjectiveContext,
  type IcarusStrategicSignal,
} from "./icarus-strategic-attention";

const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const timestamp = "2026-10-01T12:00:00.000Z";
const futureDate = "2026-12-31";
const pastDate = "2026-09-01";

function evidence(overrides: Partial<IcarusEvidence> = {}): IcarusEvidence {
  return {
    id: "evidence-1",
    statement: "The weekly close was missed twice.",
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
  return {
    id: "mode-1",
    mechanism: "Required records are not collected before close.",
    vulnerability: "No accountable owner exists.",
    evidence: [evidence()],
    ...overrides,
  };
}

function control(overrides: Partial<IcarusControl> = {}): IcarusControl {
  return {
    id: "control-1",
    failureModeId: "mode-1",
    intervention: "Owned close checklist.",
    lifecycle: "Active",
    effectiveness: "Unknown",
    evidenceIds: [],
    linkedRecords: [],
    nextReviewAt: futureDate,
    ...overrides,
  };
}

function verifiedControl(overrides: Partial<IcarusControl> = {}): IcarusControl {
  return control({
    effectiveness: "Evidence supports",
    effectivenessReviewedAt: timestamp,
    effectivenessReviewedBy: "Founder",
    evidenceIds: ["control-evidence-1"],
    ...overrides,
  });
}

function assessment(overrides: Partial<IcarusAssessmentRecord> = {}): IcarusAssessmentRecord {
  return {
    id: "assessment-1",
    outcome: "Monthly reporting is completed on time.",
    status: "Open",
    createdAt: timestamp,
    updatedAt: timestamp,
    linkedRecords: [],
    failureModes: [mode()],
    controls: [],
    ...overrides,
  };
}

const pillar: IcarusRecordReference = { recordType: "Pillar", recordId: "Excavation" };
const objective: IcarusRecordReference = { recordType: "Strategic Objective", recordId: "objective-1" };

function sourcesFor(assessments: readonly IcarusAssessmentRecord[]): IcarusSourceRecord[] {
  const references = assessments.flatMap((entry) => [
    ...entry.linkedRecords,
    ...entry.controls.flatMap((item) => item.linkedRecords),
    ...entry.failureModes.flatMap((item) => item.evidence.flatMap((record) => record.reference ? [record.reference] : [])),
  ]);
  const unique = new Map(references.map((reference) => [getIcarusReferenceKey(reference), reference] as const));
  return [...unique.values()].map((reference) => ({ ...reference, title: reference.recordId }));
}

function derive(
  assessments: readonly IcarusAssessmentRecord[],
  strategicObjectives?: ReadonlyMap<string, IcarusStrategicObjectiveContext>,
): IcarusStrategicSignal[] {
  return buildIcarusStrategicAttention({
    assessments,
    reviews: buildIcarusReview(assessments, sourcesFor(assessments), NOW),
    ...(strategicObjectives ? { strategicObjectives } : {}),
  });
}

function single(record: IcarusAssessmentRecord, objectives?: ReadonlyMap<string, IcarusStrategicObjectiveContext>) {
  const signals = derive([record], objectives);
  expect(signals).toHaveLength(1);
  return signals[0];
}

describe("Icarus strategic attention materiality", () => {
  it("surfaces an evidenced failure mechanism with no operating control as Exposed", () => {
    const signal = single(assessment());
    expect(signal.exposure).toBe("Exposed");
    expect(signal.materialFailureModes[0]).toMatchObject({ controlGap: "Uncontrolled", evidence: "Supported" });
    expect(signal.weaknesses).toContain("No operating control");
    expect(signal.scope).toBe("Operational");
  });

  it("drops a failure mode out once an operating control is verified by current supporting evidence", () => {
    const record = assessment({
      failureModes: [mode({ evidence: [evidence(), evidence({ id: "control-evidence-1" })] })],
      controls: [verifiedControl()],
    });
    expect(buildIcarusReview([record], sourcesFor([record]), NOW)[0].findings).toEqual([]);
    expect(derive([record])).toEqual([]);
  });

  it("keeps a mode material when a supposedly verified control has an overdue review", () => {
    const record = assessment({
      failureModes: [mode({ evidence: [evidence(), evidence({ id: "control-evidence-1" })] })],
      controls: [verifiedControl({ nextReviewAt: pastDate })],
    });
    const signal = single(record);
    expect(signal.exposure).toBe("Unverified control");
    expect(signal.hasOverdueControlReview).toBe(true);
    expect(signal.weaknesses).toContain("Control review overdue");
    expect(signal.primaryReference.controlId).toBe("control-1");
  });

  it("classifies an evidenced mechanism relying on an untested control as Unverified control", () => {
    const signal = single(assessment({ controls: [control()] }));
    expect(signal.exposure).toBe("Unverified control");
    expect(signal.hasOverdueControlReview).toBe(false);
    expect(signal.materialFailureModes[0].controlGap).toBe("Unverified");
  });

  it("treats an ineffective control over evidenced failure as Exposed and points at the failing control", () => {
    const signal = single(assessment({ controls: [control({ id: "control-x", lifecycle: "Ineffective" })] }));
    expect(signal.exposure).toBe("Exposed");
    expect(signal.materialFailureModes[0].controlGap).toBe("Failing");
    expect(signal.weaknesses).toContain("Failing control");
    expect(signal.primaryReference).toEqual({
      identityKey: getIcarusIdentityKey("assessment-1"),
      assessmentId: "assessment-1",
      failureModeId: "mode-1",
      controlId: "control-x",
      evidenceId: "evidence-1",
    });
  });

  it("surfaces a failing control even when the mechanism is not yet evidenced", () => {
    const signal = single(assessment({
      failureModes: [mode({ evidence: [evidence({ review: "Unreviewed", reviewedAt: undefined, reviewedBy: undefined })] })],
      controls: [control({ effectiveness: "Weak" })],
    }));
    expect(signal.exposure).toBe("Failing control");
    expect(signal.weaknesses).toEqual(expect.arrayContaining(["Failing control", "Weak evidence"]));
    expect(signal.primaryReference.evidenceId).toBeUndefined();
  });

  it("does not surface a mechanism whose current reviewed evidence only contradicts it", () => {
    expect(derive([assessment({
      linkedRecords: [pillar],
      failureModes: [mode({ evidence: [evidence({ review: "Contradicts" })] })],
    })])).toEqual([]);
  });

  it("treats contested evidence as still evidenced", () => {
    const signal = single(assessment({
      failureModes: [mode({ evidence: [evidence(), evidence({ id: "evidence-2", review: "Contradicts" })] })],
    }));
    expect(signal.exposure).toBe("Exposed");
    expect(signal.materialFailureModes[0].evidence).toBe("Contested");
    expect(signal.weaknesses).toContain("Conflicting evidence");
  });

  it("ignores stale, invalid and missing-source evidence when judging whether a mechanism is evidenced", () => {
    const staleOnly = assessment({ failureModes: [mode({ evidence: [evidence({ validUntil: pastDate })] })] });
    expect(derive([staleOnly])).toEqual([]);
    const missingSource = assessment({
      failureModes: [mode({ evidence: [evidence({ origin: "Source record", reference: { recordType: "Problem", recordId: "gone" } })] })],
    });
    expect(buildIcarusStrategicAttention({
      assessments: [missingSource],
      reviews: buildIcarusReview([missingSource], [], NOW),
    })).toEqual([]);
  });

  it("keeps unevidenced uncontrolled operational hygiene inside Icarus", () => {
    expect(derive([assessment({ failureModes: [mode({ evidence: [] })] })])).toEqual([]);
  });

  it("surfaces unevidenced uncontrolled exposure only when the assessment is strategically linked", () => {
    const signal = single(assessment({ linkedRecords: [pillar], failureModes: [mode({ evidence: [] })] }));
    expect(signal.exposure).toBe("Unexamined strategic exposure");
    expect(signal.scope).toBe("Pillar");
    expect(signal.area).toBe("Excavation");
  });

  it("excludes Closed assessments and assessments without a stated outcome", () => {
    expect(derive([
      assessment({ id: "closed", status: "Closed" }),
      assessment({ id: "blank", outcome: "   " }),
    ])).toEqual([]);
  });

  it("includes Monitoring assessments and preserves their status", () => {
    expect(single(assessment({ status: "Monitoring" })).status).toBe("Monitoring");
  });

  it("drops out entirely when every failure mode becomes controlled", () => {
    const exposed = assessment({
      failureModes: [mode(), mode({ id: "mode-2", evidence: [evidence({ id: "evidence-2" })] })],
    });
    expect(single(exposed).materialFailureModes).toHaveLength(2);
    const controlled = assessment({
      failureModes: [
        mode({ evidence: [evidence(), evidence({ id: "control-evidence-1" })] }),
        mode({ id: "mode-2", evidence: [evidence({ id: "evidence-2" }), evidence({ id: "control-evidence-2" })] }),
      ],
      controls: [
        verifiedControl(),
        verifiedControl({ id: "control-2", failureModeId: "mode-2", evidenceIds: ["control-evidence-2"] }),
      ],
    });
    expect(derive([controlled])).toEqual([]);
    const partlyControlled = { ...controlled, controls: [controlled.controls[0]] };
    const remaining = single(partlyControlled);
    expect(remaining.materialFailureModes.map((entry) => entry.failureModeId)).toEqual(["mode-2"]);
  });
});

describe("Icarus strategic scope and objective context", () => {
  const objectives = (context: Partial<IcarusStrategicObjectiveContext>) =>
    new Map([["objective-1", { area: "Hard Landscape Construction", importance: "Critical", isLive: true, ...context } satisfies IcarusStrategicObjectiveContext]]);

  it("treats a live linked objective as strategic and inherits its importance and area", () => {
    const signal = single(assessment({ linkedRecords: [objective] }), objectives({}));
    expect(signal.scope).toBe("Strategic objective");
    expect(signal.objectiveImportance).toBe("Critical");
    expect(signal.area).toBe("Hard Landscape Construction");
    expect(signal.strategicLinks).toEqual([objective]);
  });

  it("ignores non-live or unknown objectives when an objective map is supplied", () => {
    expect(single(assessment({ linkedRecords: [objective] }), objectives({ isLive: false })).scope).toBe("Operational");
    expect(single(assessment({ linkedRecords: [objective] }), new Map()).scope).toBe("Operational");
  });

  it("accepts objective links without importance when no objective map is supplied", () => {
    const signal = single(assessment({ linkedRecords: [objective] }));
    expect(signal.scope).toBe("Strategic objective");
    expect(signal.objectiveImportance).toBeUndefined();
  });

  it("prefers the pillar link for area when both pillar and objective are linked", () => {
    expect(single(assessment({ linkedRecords: [objective, pillar] }), objectives({})).area).toBe("Excavation");
  });

  it("does not let a non-live objective make unexamined operational exposure material", () => {
    expect(derive([assessment({ linkedRecords: [objective], failureModes: [mode({ evidence: [] })] })], objectives({ isLive: false }))).toEqual([]);
  });
});

describe("Icarus strategic risk scoring and ordering", () => {
  it("scores exposure, scope, importance, concentration, weaknesses and overdue review deterministically", () => {
    const base = single(assessment());
    expect(base.riskScore).toBe(150);
    expect(single(assessment({ linkedRecords: [pillar] })).riskScore).toBe(170);
    const critical = single(
      assessment({ linkedRecords: [objective] }),
      new Map([["objective-1", { area: "", importance: "Critical", isLive: true } satisfies IcarusStrategicObjectiveContext]]),
    );
    expect(critical.riskScore).toBe(195);
    const concentrated = single(assessment({
      failureModes: [mode(), mode({ id: "mode-2", evidence: [evidence({ id: "evidence-2" })] })],
    }));
    expect(concentrated.riskScore).toBe(160);
    expect(concentrated.summary).toContain("2 failure modes are materially exposed");
  });

  it("orders by exposure before scope and score so weaker exposures never outrank stronger ones", () => {
    const unverifiedStrategic = assessment({ id: "a-unverified", outcome: "A", linkedRecords: [objective], controls: [control()] });
    const exposedOperational = assessment({ id: "b-exposed", outcome: "B" });
    const exposedPillar = assessment({ id: "c-exposed-pillar", outcome: "C", linkedRecords: [pillar] });
    const records = [unverifiedStrategic, exposedOperational, exposedPillar];
    const ordered = derive(records).map((signal) => signal.assessmentId);
    expect(ordered).toEqual(["c-exposed-pillar", "b-exposed", "a-unverified"]);
    expect(derive([...records].reverse()).map((signal) => signal.assessmentId)).toEqual(ordered);
  });

  it("breaks full ties by outcome then assessment id", () => {
    const records = [
      assessment({ id: "z", outcome: "Same" }),
      assessment({ id: "a", outcome: "Same" }),
      assessment({ id: "m", outcome: "Earlier" }),
    ];
    expect(derive(records).map((signal) => signal.assessmentId)).toEqual(["m", "a", "z"]);
  });

  it("selects the worst failure mode as the primary traceable reference", () => {
    const signal = single(assessment({
      failureModes: [mode(), mode({ id: "mode-2", evidence: [evidence({ id: "evidence-2" })] })],
      controls: [control({ id: "control-1" })],
    }));
    expect(signal.materialFailureModes.map((entry) => entry.failureModeId)).toEqual(["mode-2", "mode-1"]);
    expect(signal.primaryReference).toEqual({
      identityKey: getIcarusIdentityKey("assessment-1"),
      assessmentId: "assessment-1",
      failureModeId: "mode-2",
      evidenceId: "evidence-2",
    });
  });

  it("emits at most one signal per assessment with a stable identity key", () => {
    const signals = derive([assessment({
      failureModes: [mode(), mode({ id: "mode-2" }), mode({ id: "mode-3" })],
    })]);
    expect(signals).toHaveLength(1);
    expect(signals[0].key).toBe("icarus-assessment:assessment-1");
  });

  it("does not mutate its inputs", () => {
    const records = [assessment({ linkedRecords: [pillar], controls: [control()] })];
    const snapshot = JSON.stringify(records);
    derive(records);
    expect(JSON.stringify(records)).toBe(snapshot);
  });
});

describe("Icarus attention anchors", () => {
  it("maps assessment links onto Command/Founder identities, deduplicating and skipping non-attention types", () => {
    const signal = single(assessment({
      linkedRecords: [
        { recordType: "Problem", recordId: "problem-1" },
        { recordType: "Problem", recordId: "problem-1" },
        { recordType: "Commitment", recordId: "commit-1" },
        { recordType: "Person", recordId: "person-1" },
        { recordType: "Capture", recordId: "capture-1" },
        pillar,
      ],
    }));
    // Deterministic identity order, independent of authoring order.
    expect(signal.anchors).toEqual([
      { objectType: "Finance", id: "commitment:commit-1" },
      { objectType: "Problem", id: "problem-1" },
    ]);
  });

  it("uses only assessment-level links as anchors, not control links", () => {
    const signal = single(assessment({
      controls: [control({ lifecycle: "Ineffective", linkedRecords: [{ recordType: "Action", recordId: "action-1" }] })],
    }));
    expect(signal.anchors).toEqual([]);
  });

  it("returns null targets for record types without a Command identity", () => {
    expect(getIcarusAttentionTarget({ recordType: "Finance", recordId: "x" })).toBeNull();
    expect(getIcarusAttentionTarget({ recordType: "Strategic Objective", recordId: "x" })).toBeNull();
    expect(getIcarusAttentionTarget({ recordType: "SOP", recordId: "x" })).toEqual({ objectType: "SOP", id: "x" });
  });
});

describe("Icarus Command placement and Founder Focus projection", () => {
  it("never places Icarus above blocked or overdue execution ranks", () => {
    const exposed = getIcarusCommandPlacement(single(assessment({ linkedRecords: [pillar] })));
    expect(exposed.attentionRank).toBe(3);
    expect(exposed.reasons).toEqual(["ICARUS: EXPOSED FAILURE MODE", "PILLAR LINKED"]);
    expect(exposed.tieWeight).toBe(1);
    expect(getIcarusCommandPlacement(single(assessment({ controls: [control()] }))).attentionRank).toBe(6);
    const overdue = getIcarusCommandPlacement(single(assessment({
      failureModes: [mode({ evidence: [evidence(), evidence({ id: "control-evidence-1" })] })],
      controls: [verifiedControl({ nextReviewAt: pastDate })],
    })));
    expect(overdue.attentionRank).toBe(5);
    expect(overdue.reasons).toContain("CONTROL REVIEW OVERDUE");
    const unexamined = getIcarusCommandPlacement(single(assessment({ linkedRecords: [pillar], failureModes: [mode({ evidence: [] })] })));
    expect(unexamined.attentionRank).toBe(7);
    expect(unexamined.reasons).toContain("EVIDENCE WEAK");
  });

  it("does not emit reason text that triggers existing overdue/severity/review heuristics", () => {
    const placement = getIcarusCommandPlacement(single(assessment({
      linkedRecords: [pillar],
      failureModes: [mode({ evidence: [evidence(), evidence({ id: "control-evidence-1" })] })],
      controls: [verifiedControl({ nextReviewAt: pastDate })],
    })));
    placement.reasons.forEach((reason) => {
      expect(reason.startsWith("OVERDUE")).toBe(false);
      expect(reason.startsWith("REVIEW ")).toBe(false);
      expect(reason.includes("SEVERITY")).toBe(false);
    });
  });

  it("projects signals into Founder Focus risks with bands below authority and blocked work", () => {
    const signals = derive([
      assessment({ id: "exposed", outcome: "Exposed outcome", linkedRecords: [pillar, { recordType: "Action", recordId: "action-1" }] }),
      assessment({ id: "unverified", outcome: "Unverified outcome", controls: [control()] }),
      assessment({ id: "failing", outcome: "Failing outcome", failureModes: [mode({ evidence: [] })], controls: [control({ lifecycle: "Ineffective" })] }),
    ]);
    const risks = buildIcarusFounderFocusRisks(signals);
    expect(risks.map((risk) => [risk.id, risk.band])).toEqual([["exposed", 3], ["failing", 4], ["unverified", 5]]);
    expect(risks[0]).toMatchObject({
      key: "Icarus:exposed",
      objectType: "Icarus",
      area: "Excavation",
      score: signals[0].riskScore + 150,
      anchorRecordKeys: ["Action:action-1"],
      referenceKey: "icarus-assessment:exposed",
    });
    expect(risks[0].reason).toMatch(/^Icarus strategic risk \(pillar linked\) — /);
  });
});

describe("Icarus strategic signal identity and context", () => {
  it("never treats a strategic-theme objective area as an operating pillar", () => {
    const signal = single(assessment({ linkedRecords: [objective] }), new Map([["objective-1", { area: "Operating Business", importance: "High", isLive: true }]]));
    expect(signal.area).toBe("Icarus");
    expect(signal.operatingPillars).toEqual([]);
    expect(signal.strategicThemes).toEqual(["Operating Business"]);
    expect(signal.scope).toBe("Strategic objective");
  });

  it("uses a canonical operating pillar label as area for legacy pillar forms", () => {
    const signal = single(assessment({ linkedRecords: [{ recordType: "Pillar", recordId: " excavation " }] }));
    expect(signal.area).toBe("Excavation");
    expect(signal.operatingPillars).toEqual([{ id: "excavation", label: "Excavation" }]);
    expect(signal.scope).toBe("Pillar");
  });

  it("confers no Pillar scope for an unresolvable pillar link", () => {
    const signal = single(assessment({ linkedRecords: [{ recordType: "Pillar", recordId: "Operating Business" }] }));
    expect(signal.scope).toBe("Operational");
    expect(signal.operatingPillars).toEqual([]);
  });

  it("populates relationships with direct and expanded provenance while anchors stay direct assessment links", () => {
    const problemLink: IcarusRecordReference = { recordType: "Problem", recordId: "problem-1" };
    const signal = single(
      assessment({
        linkedRecords: [objective, problemLink],
        controls: [control({ linkedRecords: [{ recordType: "Person", recordId: "person-1" }] })],
      }),
      new Map([["objective-1", { area: "Excavation", importance: "Critical", isLive: true, linkedProjectIds: ["project-1"] }]]),
    );
    expect(signal.relationships.map((entry) => [entry.kind, entry.origin, entry.identity])).toEqual([
      ["Direct", "Assessment link", "Problem:problem-1"],
      ["Direct", "Assessment link", "Strategic Objective:objective-1"],
      ["Direct", "Control link", "Person:person-1"],
      ["Expanded", "Strategic objective", "Project:project-1"],
    ]);
    expect(signal.anchors.map((anchor) => `${anchor.objectType}:${anchor.id}`)).toEqual(["Problem:problem-1"]);
    expect(signal.area).toBe("Excavation");
    // An untested active control leaves the evidenced mechanism unverified: corroborating, not material.
    expect(signal.exposure).toBe("Unverified control");
    expect(signal.materialityTier).toBe("Corroborating");
  });
});
