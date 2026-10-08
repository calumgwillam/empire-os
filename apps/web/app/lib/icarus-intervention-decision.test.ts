import { describe, expect, it } from "vitest";
import {
  getIcarusTreatmentOutcomeId,
  getIcarusTreatmentTargetId,
  parseIcarusAssessments,
  type IcarusAssessmentRecord,
  type IcarusCauseRecord,
  type IcarusInterventionDecisionRecord,
  type IcarusInterventionEffect,
  type IcarusInterventionOption,
  type IcarusInterventionRelation,
  type IcarusTreatmentOutcomeRecord,
} from "./icarus";
import {
  buildIcarusInterventionIndex,
  emptyIcarusInterventionScope,
  selectIcarusInterventionOption,
  type IcarusInterventionIndexInput,
} from "./icarus-intervention-decision";
import { buildIcarusTreatmentIndex, persistIcarusTreatmentTarget, type IcarusTreatmentIndex, type IcarusTreatmentTarget } from "./icarus-treatment";
import type { IcarusTreatmentOutcomeView } from "./icarus-treatment-outcome";
import type { IcarusStrategicSignal } from "./icarus-strategic-attention";
import { buildOrganisationalLearning } from "./organisational-learning";
import { buildCommandAttention } from "./command-attention";
import { buildFounderFocus } from "./founder-focus";

const at = "2026-10-01T10:00:00.000Z";
const later = "2026-10-02T10:00:00.000Z";
const provenance = { createdAt: at, updatedAt: at, createdByPersonId: "person", updatedByPersonId: "person" };

function cause(id = "cause", overrides: Partial<IcarusCauseRecord> = {}): IcarusCauseRecord {
  return { ...emptyIcarusInterventionScope("risk"), ...provenance, id, title: "Same title", description: "Declared mechanism", ...overrides };
}

function option(id = "option", overrides: Partial<IcarusInterventionOption> = {}): IcarusInterventionOption {
  return {
    ...emptyIcarusInterventionScope("risk"), id, name: id, description: "Human-authored alternative",
    causeIds: ["cause"], intent: "Root-cause treatment", scope: "Local", character: "Structural",
    status: "Candidate", rationale: "", priorOptionIds: [], treatmentLinks: [], ...overrides,
  };
}

function decision(id = "decision", overrides: Partial<IcarusInterventionDecisionRecord> = {}): IcarusInterventionDecisionRecord {
  return {
    ...emptyIcarusInterventionScope("risk"), ...provenance, id, title: id, causeIds: ["cause"],
    status: "Draft", rationale: "", options: [option(`${id}-a`), option(`${id}-b`)],
    selectionHistory: [], relationships: [], effects: [], lessonLinks: [], ...overrides,
  };
}

function selected(id = "decision", chosen = option(), overrides: Partial<IcarusInterventionDecisionRecord> = {}) {
  return selectIcarusInterventionOption(
    decision(id, { options: [chosen, option(`${id}-alternative`, { causeIds: overrides.causeIds ?? chosen.causeIds })], ...overrides }),
    chosen.id, "Explicit choice, not superiority", "person", overrides.createdAt ?? at, `${id}-selection`,
  );
}

function assessment(overrides: Partial<IcarusAssessmentRecord> = {}): IcarusAssessmentRecord {
  return {
    id: "risk", outcome: "Outcome", status: "Open", createdAt: at, updatedAt: at, linkedRecords: [], controls: [],
    failureModes: [{ id: "mode", mechanism: "Mechanism", vulnerability: "Vulnerability", evidence: [] }],
    ...overrides,
  };
}

function target(id = "target", overrides: Partial<IcarusTreatmentTarget> = {}): IcarusTreatmentTarget {
  return {
    id, sourceKind: "Failure-chain restoration", sourceId: "source", assessmentId: "risk",
    failureModeId: "mode", controlId: "control", treatmentKind: "Restore barrier", reason: "Declared target",
    basis: [], affectedAssessmentIds: ["risk"], objectiveIds: [], pillarIds: [],
    provenance: { kind: "Failure-chain recommendation", finding: "Declared barrier" },
    executionLinks: [{ recordType: "Action", recordId: "action", linkedAt: at }],
    executions: [{ recordType: "Action", recordId: "action", title: "Action", status: "Completed" }],
    state: "Completed — verification required", material: true, founderOwned: false, ...overrides,
  };
}

function outcome(id = "target", value: IcarusTreatmentOutcomeRecord["outcome"] = "Effective"): IcarusTreatmentOutcomeRecord {
  const evidence: IcarusTreatmentOutcomeRecord["evidence"] = [{
    kind: "Dependency health", dependencyReference: { recordType: "Project", recordId: "project" },
    health: "Healthy", source: "Derived", basis: ["on-track-project"],
  }];
  return {
    id: getIcarusTreatmentOutcomeId(id, "person", evidence), treatmentTargetId: id, assessmentId: "risk",
    executionLinks: [{ recordType: "Action", recordId: "action", linkedAt: at }],
    outcome: value, verifiedAt: later, verifiedByPersonId: "person", evidence,
    afterState: { kind: "Dependency health", state: "Healthy" }, verificationNote: "Observed state, causation uncertain",
  };
}

function treatment(targets: IcarusTreatmentTarget[] = [], records: IcarusTreatmentOutcomeRecord[] = [], current = true): IcarusTreatmentIndex {
  const verification = new Map<string, IcarusTreatmentOutcomeView>();
  targets.forEach((entry) => {
    const related = records.filter((record) => record.treatmentTargetId === entry.id);
    const latest = related[related.length - 1];
    const state: IcarusTreatmentOutcomeView["state"] = !latest ? "Awaiting verification" : !current ? "Superseded"
      : latest.outcome === "Effective" ? "Verified effective"
        : latest.outcome === "Ineffective" ? "Verified ineffective"
          : latest.outcome === "Partially effective" ? "Partially effective"
            : latest.outcome === "No longer applicable" ? "No longer applicable" : "Verification inconclusive";
    verification.set(entry.id, {
      state, options: [], history: related.map((record) => ({ record, current, attribution: "Uncertain" })),
      ...(latest ? { latest } : {}),
    });
  });
  return { targets, verification, summaries: new Map(), recommendations: [], barrierRestorations: [] };
}

function signal(overrides: Partial<IcarusStrategicSignal> = {}): IcarusStrategicSignal {
  return {
    key: "Icarus:risk", assessmentId: "risk", outcome: "Outcome", status: "Open", exposure: "Exposed",
    materialityTier: "Material", scope: "Operational", area: "Icarus", operatingPillars: [], strategicThemes: [],
    strategicLinks: [], relationships: [], anchors: [], materialFailureModes: [], weaknesses: [],
    hasOverdueControlReview: false, riskScore: 500,
    primaryReference: { identityKey: "Icarus:risk", assessmentId: "risk" }, summary: "Evidence-backed exposure",
    ...overrides,
  };
}

function input(records: IcarusInterventionDecisionRecord[] = [], overrides: Partial<IcarusInterventionIndexInput> = {}): IcarusInterventionIndexInput {
  return {
    assessments: [assessment({ causes: [cause()], interventionDecisions: records })],
    treatment: treatment(), signals: [signal()], sources: [], decisions: [], lessons: [],
    people: [{ id: "person", status: "Active" }], nowMs: Date.parse(later), ...overrides,
  };
}

function relation(from: string, to: string, kind: IcarusInterventionRelation["kind"] = "prerequisite-of"): IcarusInterventionRelation {
  return { id: `${from}:${kind}:${to}`, fromOptionId: from, toOptionId: to, kind, rationale: "Explicit relation",
    recordedAt: at, recordedByPersonId: "person" };
}

function effect(direction: IcarusInterventionEffect["direction"], id = "effect"): IcarusInterventionEffect {
  return { id, optionId: "option", target: { kind: "Assessment", id: "other" }, direction,
    rationale: "Declared trade-off, not prediction", evidence: [], recordedAt: at, recordedByPersonId: "person" };
}

describe("explicit Icarus cause identity and legacy persistence", () => {
  it("does not merge causes with identical text and shares only exact cause identity", () => {
    const shared = cause("cause", { assessmentIds: ["risk", "other"] });
    const result = buildIcarusInterventionIndex(input([decision()], {
      assessments: [
        assessment({ causes: [shared, cause("different")], interventionDecisions: [decision()] }),
        assessment({ id: "other", failureModes: [], interventionDecisions: [decision("other-decision", { assessmentIds: ["other"] })] }),
      ],
    }));
    expect(result.causes.map((entry) => entry.id)).toEqual(["cause", "different"]);
    expect(result.byCauseId.get("cause")).toHaveLength(2);
    expect(result.byCauseId.has("different")).toBe(false);
    expect(result.byAssessmentId.get("other")?.[0].record.id).toBe("other-decision");
  });

  it("round-trips legacy records without constructing causes, decisions or classifications", () => {
    const legacy = assessment();
    expect(parseIcarusAssessments(JSON.stringify([legacy]))).toEqual([legacy]);
    const result = buildIcarusInterventionIndex(input([], { assessments: [legacy] }));
    expect(result.causes).toEqual([]);
    expect(result.decisions).toEqual([]);
  });

  it("normalizes malformed optional records without losing valid core data or valid new records", () => {
    const saved = assessment({ causes: [cause()], interventionDecisions: [decision()] });
    const parsed = parseIcarusAssessments(JSON.stringify([{
      ...saved, causes: [cause(), { ...cause("invalid"), assessmentIds: [null] }],
      interventionDecisions: [decision(), { ...decision("invalid"), options: [null] }],
    }]));
    expect(parsed).toEqual([saved]);
    expect(parseIcarusAssessments(JSON.stringify([{
      ...saved, interventionDecisions: [{ ...decision(), status: { toString: null, valueOf: null } }],
    }]))).toEqual([{ ...saved, interventionDecisions: [] }]);
  });

  it("round-trips explicit selection history, option links and legacy treatment records", () => {
    const first = selected("decision", option("first", {
      treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }],
    }));
    const next = selectIcarusInterventionOption(first, "decision-alternative", "Reconsidered", "person", later, "next-event");
    const persistedTarget = persistIcarusTreatmentTarget(
      target(getIcarusTreatmentTargetId("Failure-chain restoration", "source")), at,
    );
    const saved = assessment({ causes: [cause()], interventionDecisions: [next], treatmentTargets: [persistedTarget] });
    expect(parseIcarusAssessments(JSON.stringify([saved]))).toEqual([saved]);
  });

  it("keeps dangling cause links visible as a structure gap rather than guessing identity", () => {
    const result = buildIcarusInterventionIndex(input([decision("decision", { causeIds: ["missing"] })]));
    expect(result.decisions[0].readiness).toBe("Not structured");
    expect(result.decisions[0].issues).toContain("Missing or ambiguous cause: missing");
  });

  it("does not grant readiness for duplicate global cause or option identities", () => {
    const result = buildIcarusInterventionIndex(input([decision()], {
      assessments: [assessment({ causes: [cause(), cause()], interventionDecisions: [decision()] })],
    }));
    expect(result.decisions[0].readiness).toBe("Not structured");
    expect(result.decisions[0].issues).toContain("Missing or ambiguous cause: cause");
    const duplicate = buildIcarusInterventionIndex(input([decision("decision", { options: [option(), option()] })]));
    expect(duplicate.decisions[0].readiness).toBe("Conflict");
  });
});

describe("intervention alternatives and selection history", () => {
  it("does not select candidates or rejected options implicitly", () => {
    const draft = decision("decision", { options: [option("candidate"), option("rejected", { status: "Rejected", rationale: "Rejected explicitly" })] });
    const result = buildIcarusInterventionIndex(input([draft])).decisions[0];
    expect(result.selectedOption).toBeUndefined();
    expect(result.readiness).toBe("Ready for decision");
    expect(() => selectIcarusInterventionOption(draft, "rejected", "Why", "person", at, "event")).toThrow();
  });

  it("leaves unclassified alternatives incomplete rather than inventing intent", () => {
    const draft = decision("decision", { options: [option("a", { intent: undefined }), option("b")] });
    expect(buildIcarusInterventionIndex(input([draft])).decisions[0].readiness).toBe("Alternatives incomplete");
    expect(() => selectIcarusInterventionOption(draft, "a", "Why", "person", at, "event")).toThrow();
  });

  it("preserves prior option links and selection events when changing explicit selection", () => {
    const first = selected("decision", option("first", { treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }] }));
    const next = selectIcarusInterventionOption(first, "decision-alternative", "New evidence", "person", later, "second-event");
    expect(next.selectionHistory.map((entry) => entry.optionId)).toEqual(["first", "decision-alternative"]);
    expect(next.options[0].status).toBe("Superseded");
    expect(next.options[0].treatmentLinks).toEqual(first.options[0].treatmentLinks);
    expect(first.options[0].status).toBe("Candidate");
  });

  it("does not allow a persisted selection without provenance to become ready", () => {
    const invalid = decision("decision", { selectedOptionId: "decision-a", status: "Recorded", rationale: "Claimed selection" });
    expect(buildIcarusInterventionIndex(input([invalid])).decisions[0].issues).toContain("Selection has no recorded provenance");
  });

  it("does not treat a rejected persisted selection as selected or allow superseded contexts to be reselected", () => {
    const rejected = selected("decision", option());
    rejected.options[0].status = "Rejected";
    rejected.options[0].rationale = "Rejected";
    const view = buildIcarusInterventionIndex(input([rejected])).decisions[0];
    expect(view.selectedOption).toBeUndefined();
    expect(view.readiness).toBe("Not structured");
    expect(() => selectIcarusInterventionOption(
      { ...decision(), status: "Superseded" }, "decision-a", "Why", "person", later, "event",
    )).toThrow();
  });

  it("rejects duplicate or backdated selection events and surfaces missing authors and scopes", () => {
    const record = selected();
    expect(() => selectIcarusInterventionOption(
      record, "decision-alternative", "Why", "person", later, "decision-selection",
    )).toThrow();
    expect(() => selectIcarusInterventionOption(
      { ...decision(), createdAt: later }, "decision-a", "Why", "person", at, "event",
    )).toThrow();
    const invalid = decision("decision", {
      options: [option("a", { failureModes: [{ assessmentId: "risk", failureModeId: "missing" }] }), option("b")],
    });
    const view = buildIcarusInterventionIndex(input([invalid], { people: [] })).decisions[0];
    expect(view.issues).toContain("Inactive or missing context author: person");
    expect(view.issues).toContain("Missing failure mode: risk/missing");
    expect(view.readiness).toBe("Not structured");
  });

  it("uses linked organisational Decision state without changing it", () => {
    const record = selected("decision", option(), { decisionRecordId: "org-decision" });
    const source = { id: "org-decision", decisionStatus: "Reversed" as const };
    const result = buildIcarusInterventionIndex(input([record], { decisions: [source] })).decisions[0];
    expect(result.issues).toContain("Authoritative Decision is draft or reversed");
    expect(source.decisionStatus).toBe("Reversed");
  });
});

describe("intervention prerequisites, sequence and conflicts", () => {
  it("uses the same duplicate-selection conflict to invalidate predecessor proof and successor readiness", () => {
    const first = selected("first", option("predecessor", {
      treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }],
    }));
    first.selectionHistory.push({ ...first.selectionHistory[0] });
    const second = selected("second", option("successor"), { relationships: [relation("predecessor", "successor")] });
    const entry = outcome();
    const result = buildIcarusInterventionIndex(input([first, second], {
      assessments: [assessment({ causes: [cause()], interventionDecisions: [first, second], treatmentOutcomes: [entry] })],
      treatment: treatment([target()], [entry]),
    }));
    const predecessor = result.decisions.find((view) => view.record.id === "first");
    expect(predecessor?.readiness).toBe("Conflict");
    expect(predecessor?.conflicts).toContain("Duplicate selection event identity: first-selection");
    expect(predecessor?.outcomes[0]).toMatchObject({ current: false, treatmentCurrent: true });
    expect(result.decisions.find((view) => view.record.id === "second")?.unmetPrerequisites)
      .toEqual(["prerequisite-of: predecessor -> successor"]);
  });

  it("does not erase verified predecessor protection because its historical editor is now inactive", () => {
    const first = selected("first", option("predecessor", {
      treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }],
    }));
    first.updatedByPersonId = "former-editor";
    const second = selected("second", option("successor"), { relationships: [relation("predecessor", "successor")] });
    const result = buildIcarusInterventionIndex(input([first, second], { treatment: treatment([target()], [outcome()]) }));
    expect(result.decisions.find((view) => view.record.id === "first")?.warnings)
      .toContain("Inactive or missing context author: former-editor");
    expect(result.decisions.find((view) => view.record.id === "second")?.unmetPrerequisites).toEqual([]);
  });

  it("requires must-precede verification before successor selection, unlike a live protection prerequisite", () => {
    const first = selected("first", option("predecessor", {
      treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }],
    }));
    const build = (kind: IcarusInterventionRelation["kind"], selectedAt: string) => {
      const second = selected("second", option("successor"), {
        createdAt: selectedAt, relationships: [relation("predecessor", "successor", kind)],
      });
      return buildIcarusInterventionIndex(input([first, second], { treatment: treatment([target()], [outcome()]) }))
        .decisions.find((view) => view.record.id === "second");
    };
    expect(build("prerequisite-of", at)?.unmetPrerequisites).toEqual([]);
    expect(build("must-precede", at)?.unmetPrerequisites).toEqual(["must-precede: predecessor -> successor"]);
    expect(build("must-precede", "2026-10-03T10:00:00.000Z")?.unmetPrerequisites).toEqual([]);
    expect(build("blocks", at)?.unmetPrerequisites).toEqual([]);
  });

  it("does not undo a valid must-precede milestone merely because a newer verification occurrence was recorded", () => {
    const first = selected("first", option("predecessor", {
      treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }],
    }));
    const second = selected("second", option("successor"), {
      createdAt: "2026-10-03T10:00:00.000Z", relationships: [relation("predecessor", "successor", "must-precede")],
    });
    const old = outcome();
    const next: IcarusTreatmentOutcomeRecord = {
      ...old, occurrenceId: "new-review",
      id: getIcarusTreatmentOutcomeId(old.treatmentTargetId, old.verifiedByPersonId, old.evidence, "new-review"),
      verifiedAt: "2026-10-04T10:00:00.000Z",
      interventionReference: { decisionId: first.id, optionId: "predecessor", selectionEventId: first.selectionHistory[0].id },
    };
    const facts = treatment([target()], [old, next]);
    const view = facts.verification.get("target")!;
    const verification = new Map([["target", { ...view, history: [
      { record: old, current: false, evidenceCurrent: true, attribution: "Uncertain" as const },
      { record: next, current: true, evidenceCurrent: true, attribution: "Uncertain" as const },
    ] }]]);
    const result = buildIcarusInterventionIndex(input([first, second], {
      treatment: { ...facts, verification }, nowMs: Date.parse(next.verifiedAt),
    }));
    expect(result.decisions.find((entry) => entry.record.id === "second")?.unmetPrerequisites).toEqual([]);
    verification.set("target", { ...view, history: [
      { record: old, current: false, evidenceCurrent: false, attribution: "Uncertain" },
      { record: next, current: true, evidenceCurrent: true, attribution: "Uncertain" },
    ] });
    expect(buildIcarusInterventionIndex(input([first, second], {
      treatment: { ...facts, verification }, nowMs: Date.parse(next.verifiedAt),
    }))
      .decisions.find((entry) => entry.record.id === "second")?.unmetPrerequisites)
      .toEqual(["must-precede: predecessor -> successor"]);
  });

  it("does not count completion as prerequisite satisfaction; current effective verification clears it", () => {
    const prerequisite = option("prerequisite", { treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }] });
    const first = selected("first", prerequisite);
    const second = selected("second", option("second-option"), {
      relationships: [relation("prerequisite", "second-option")],
    });
    expect(buildIcarusInterventionIndex(input([first, second], { treatment: treatment([target()]) }))
      .decisions.find((entry) => entry.record.id === "second")?.readiness).toBe("Prerequisites unmet");
    const complete = buildIcarusInterventionIndex(input([first, second], { treatment: treatment([target()], [outcome()]) }));
    expect(complete.decisions.find((entry) => entry.record.id === "second")?.unmetPrerequisites).toEqual([]);
    expect(complete.decisions.find((entry) => entry.record.id === "second")?.readiness).toBe("Selected — unrouted");
  });

  it.each(["prerequisite-of", "must-precede"] as const)("surfaces %s cycles deterministically without recursion failure", (kind) => {
    const record = selected("decision", option(), {
      relationships: [relation("option", "decision-alternative", kind), relation("decision-alternative", "option", kind)],
    });
    const result = buildIcarusInterventionIndex(input([record])).decisions[0];
    expect(result.readiness).toBe("Conflict");
    expect(result.conflicts).toEqual(["Prerequisite/sequence cycle: decision-alternative", "Prerequisite/sequence cycle: option"]);
  });

  it("surfaces mutually exclusive selections across decision contexts rather than showing them ready", () => {
    const first = selected("first", option("first-option"), {
      relationships: [relation("first-option", "second-option", "mutually-exclusive-with")],
    });
    const second = selected("second", option("second-option"));
    const result = buildIcarusInterventionIndex(input([first, second]));
    expect(result.decisions.map((entry) => entry.readiness)).toEqual(["Conflict", "Conflict"]);
  });

  it("keeps complements non-blocking and missing relation endpoints visible", () => {
    const valid = decision("decision", { relationships: [relation("decision-a", "decision-b", "complements")] });
    expect(buildIcarusInterventionIndex(input([valid])).decisions[0].readiness).toBe("Ready for decision");
    const missing = decision("decision", { relationships: [relation("missing", "decision-a")] });
    expect(buildIcarusInterventionIndex(input([missing])).decisions[0].readiness).toBe("Conflict");
  });

  it("does not let a verified middle intervention hide an unmet upstream prerequisite", () => {
    const first = selected("first", option("upstream"));
    const middle = selected("middle", option("middle-option", {
      treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }],
    }), { relationships: [relation("upstream", "middle-option")] });
    const last = selected("last", option("last-option"), {
      relationships: [relation("middle-option", "last-option")],
    });
    const result = buildIcarusInterventionIndex(input([first, middle, last], {
      treatment: treatment([target()], [outcome()]),
    }));
    expect(result.decisions.find((entry) => entry.record.id === "middle")?.readiness).toBe("Prerequisites unmet");
    expect(result.decisions.find((entry) => entry.record.id === "last")?.readiness).toBe("Prerequisites unmet");
  });

  it("handles blocking relationships without accepting no-longer-applicable or superseded verification", () => {
    const first = selected("first", option("blocker", {
      treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }],
    }));
    const second = selected("second", option("second-option"), {
      relationships: [relation("blocker", "second-option", "blocks")],
    });
    for (const facts of [
      treatment([target()]), treatment([target()], [outcome("target", "No longer applicable")]),
      treatment([target()], [outcome()], false),
    ]) {
      expect(buildIcarusInterventionIndex(input([first, second], { treatment: facts }))
        .decisions.find((entry) => entry.record.id === "second")?.readiness).toBe("Prerequisites unmet");
    }
    expect(buildIcarusInterventionIndex(input([first, second], { treatment: treatment([target()], [outcome()]) }))
      .decisions.find((entry) => entry.record.id === "second")?.unmetPrerequisites).toEqual([]);
  });

  it("does not use a conflicted verified predecessor as proof of prerequisite satisfaction", () => {
    const first = selected("first", option("first-option", {
      treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }],
    }), { relationships: [relation("first-option", "exclusive", "mutually-exclusive-with")] });
    const exclusive = selected("exclusive-decision", option("exclusive"));
    const next = selected("next", option("next-option"), {
      relationships: [relation("first-option", "next-option")],
    });
    expect(buildIcarusInterventionIndex(input([first, exclusive, next], { treatment: treatment([target()], [outcome()]) }))
      .decisions.find((entry) => entry.record.id === "next")?.readiness).toBe("Prerequisites unmet");
  });
});

describe("treatment routing and conservative intervention outcomes", () => {
  it("keeps treatment-only verification current without inventing intervention attribution or altering Lessons", () => {
    const entry = outcome();
    const facts = input([], {
      assessments: [assessment({ treatmentOutcomes: [entry] })],
      treatment: treatment([target()], [entry]),
    });
    const before = JSON.stringify(facts);
    const result = buildIcarusInterventionIndex(facts);
    expect(result.learningInput[0].interventionContext).toBeUndefined();
    expect(result.learningInput[0].treatmentEvidence).toEqual({ current: true, attribution: "Uncertain" });
    const learning = buildOrganisationalLearning({
      actions: [], projects: [], decisions: [], lessons: [], problems: [], systems: [], sops: [],
      icarusTreatmentOutcomes: result.learningInput,
    });
    expect(learning[0].outcomeState).toBe("Worked");
    expect(learning[0].evidence).toContainEqual(expect.objectContaining({
      field: "interventionAttribution", value: "Not attributable — historical or no intervention context",
    }));
    expect(learning[0].evidence.some((evidence) => evidence.field === "interventionDecisionId")).toBe(false);
    expect(JSON.stringify(facts)).toBe(before);
  });

  it.each(["Rejected", "Superseded"] as const)("retains a %s option's observation without current intervention proof", (status) => {
    const chosen = option("chosen", { treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }] });
    const record = selected("decision", chosen);
    record.options = record.options.map((option) => option.id === chosen.id ? { ...option, status, rationale: "No longer chosen" } : option);
    const entry = outcome();
    const result = buildIcarusInterventionIndex(input([record], {
      assessments: [assessment({ causes: [cause()], interventionDecisions: [record], treatmentOutcomes: [entry] })],
      treatment: treatment([target()], [entry]),
    }));
    expect(result.decisions[0].outcomes).toHaveLength(1);
    expect(result.decisions[0].outcomes[0]).toMatchObject({
      current: false, treatmentCurrent: true, record: entry, causalAttribution: "Not attributable",
    });
    expect(result.learningInput[0].interventionContext?.current).toBe(false);
    expect(result.learningInput[0].treatmentEvidence?.current).toBe(true);
  });

  it("keeps reused verification historical until a new explicit occurrence identifies the selected intervention", () => {
    const linkedAt = "2026-10-03T10:00:00.000Z";
    const chosen = option("chosen", { treatmentLinks: [{ targetId: "target", linkedAt, linkedByPersonId: "person" }] });
    const record = selected("decision", chosen, { createdAt: linkedAt });
    const legacy = outcome();
    const build = (entries: IcarusTreatmentOutcomeRecord[]) => buildIcarusInterventionIndex(input([record], {
      assessments: [assessment({ causes: [cause()], interventionDecisions: [record], treatmentOutcomes: entries })],
      treatment: treatment([target()], entries),
      nowMs: Date.parse("2026-10-04T10:00:00.000Z"),
    }));
    const before = build([legacy]);
    expect(before.decisions[0].readiness).toBe("Awaiting verification");
    expect(before.decisions[0].outcomes[0]).toMatchObject({ current: false, treatmentCurrent: true, postSelectionEvidence: false });
    const occurrenceId = "new-occurrence";
    const next: IcarusTreatmentOutcomeRecord = {
      ...legacy, occurrenceId,
      id: getIcarusTreatmentOutcomeId(legacy.treatmentTargetId, legacy.verifiedByPersonId, legacy.evidence, occurrenceId),
      verifiedAt: "2026-10-04T10:00:00.000Z", beforeState: legacy.afterState,
      interventionReference: { decisionId: record.id, optionId: chosen.id, selectionEventId: record.selectionHistory[0].id },
    };
    const after = build([legacy, next]);
    expect(next.id).not.toBe(legacy.id);
    expect(after.decisions[0].readiness).toBe("Outcome available");
    expect(after.decisions[0].outcomes.map(({ record, current }) => [record.id, current]))
      .toEqual([[legacy.id, false], [next.id, true]]);
    expect(parseIcarusAssessments(JSON.stringify([
      assessment({ causes: [cause()], interventionDecisions: [record], treatmentOutcomes: [legacy, next] }),
    ]))[0].treatmentOutcomes).toEqual([legacy, next]);
    const unrelated = { ...next, interventionReference: { ...next.interventionReference!, decisionId: "unrelated" } };
    expect(build([unrelated]).decisions[0].outcomes[0]).toMatchObject({ current: false, postSelectionEvidence: false, treatmentCurrent: true });
    const unscoped = { ...next, interventionReference: undefined };
    expect(build([unscoped]).decisions[0].outcomes[0].current).toBe(false);
  });
  it("cannot reuse a pre-selection control test through a newly dated verification occurrence", () => {
    const selectedAt = "2026-10-03T10:00:00.000Z";
    const reviewedAt = "2026-10-04T10:00:00.000Z";
    const chosen = option("chosen", { treatmentLinks: [{ targetId: "target", linkedAt: selectedAt, linkedByPersonId: "person" }] });
    const record = selected("decision", chosen, { createdAt: selectedAt });
    const evidence: IcarusTreatmentOutcomeRecord["evidence"] = [{
      kind: "Control test", assessmentId: "risk", failureModeId: "mode", controlId: "control", testId: "test",
      result: "Passed", assuranceStatus: "Assured", evidenceStatus: "Current support", evidenceIds: [],
    }];
    const entry: IcarusTreatmentOutcomeRecord = {
      ...outcome(), occurrenceId: "new-review", verifiedAt: reviewedAt, evidence,
      id: getIcarusTreatmentOutcomeId("target", "person", evidence, "new-review"),
      interventionReference: { decisionId: record.id, optionId: chosen.id, selectionEventId: record.selectionHistory[0].id },
      afterState: { kind: "Control assurance", state: "Assured" },
    };
    const source = assessment({
      causes: [cause()], interventionDecisions: [record], treatmentOutcomes: [entry],
      controls: [{
        id: "control", failureModeId: "mode", intervention: "Control", lifecycle: "Active", effectiveness: "Unknown",
        evidenceIds: [], linkedRecords: [],
        assuranceTests: [{ id: "test", testedAt: later, testedByPersonId: "person", result: "Passed", evidenceIds: [] }],
      }],
    });
    const result = buildIcarusInterventionIndex(input([record], {
      assessments: [source], treatment: treatment([target()], [entry]), nowMs: Date.parse(reviewedAt),
    }));
    expect(result.decisions[0].outcomes[0]).toMatchObject({
      treatmentCurrent: true, current: false, postSelectionEvidence: false, causalAttribution: "Not attributable",
    });
    expect(result.decisions[0].readiness).toBe("Awaiting verification");
  });
  it.each([
    ["Missing execution record", "Selected — unrouted"],
    ["Unrouted", "Selected — unrouted"],
    ["Blocked", "Executing"],
    ["Overdue", "Executing"],
    ["Completed — verification required", "Awaiting verification"],
  ] as const)("preserves %s routing context", (state, readiness) => {
    const record = selected("decision", option("option", {
      treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }],
    }));
    const result = buildIcarusInterventionIndex(input([record], { treatment: treatment([target("target", { state })]) }));
    expect(result.decisions[0].readiness).toBe(readiness);
    expect(result.decisions[0].targets[0].state).toBe(state);
  });

  it("retains missing targets and their historical evidence without granting current proof", () => {
    const recordedOutcome = outcome();
    const record = selected("decision", option("option", {
      treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }],
    }));
    const result = buildIcarusInterventionIndex(input([record], {
      assessments: [assessment({ causes: [cause()], interventionDecisions: [record], treatmentOutcomes: [recordedOutcome] })],
    }));
    expect(result.decisions[0].issues).toContain("Missing treatment target: target");
    expect(result.decisions[0].outcomes[0]).toMatchObject({ current: false, causalAttribution: "Not attributable" });
  });

  it("uses actual treatment routing for deleted Actions and completed-but-unverified execution", () => {
    const targetId = getIcarusTreatmentTargetId("Failure-chain restoration", "source");
    const stored = assessment({ treatmentTargets: [persistIcarusTreatmentTarget(target(targetId), at)] });
    stored.treatmentTargets![0].executionLinks = [{ recordType: "Action", recordId: "action", linkedAt: at }];
    const base = {
      assessments: [stored], assurance: { byAssessmentId: new Map(), obligations: [] },
      resilience: [], recommendations: [], barrierRestorations: [], dependencyHealth: new Map(),
      projects: [], founderPersonId: null, nowMs: Date.parse(later),
    };
    const missing = buildIcarusTreatmentIndex({ ...base, actions: [] });
    expect(missing.targets[0].state).toBe("Missing execution record");
    const complete = buildIcarusTreatmentIndex({
      ...base, actions: [{ recordType: "Action", recordId: "action", title: "Completed Action", status: "Completed" }],
    });
    expect(complete.targets[0].state).toBe("Completed — verification required");
    expect(complete.verification.get(targetId)?.state).toBe("Awaiting verification");
  });

  it("keeps mixed verified outcomes separate and never equates effective outcome with causal support", () => {
    const records = [outcome("one"), outcome("two", "Ineffective"), outcome("three", "Inconclusive")];
    const record = selected("decision", option("option", {
      treatmentLinks: records.map((entry) => ({ targetId: entry.treatmentTargetId, linkedAt: at, linkedByPersonId: "person" })),
    }));
    const result = buildIcarusInterventionIndex(input([record], {
      assessments: [assessment({ causes: [cause()], interventionDecisions: [record], treatmentOutcomes: records })],
      treatment: treatment(records.map((entry) => target(entry.treatmentTargetId)), records),
    }));
    expect(result.decisions[0].readiness).toBe("Outcome available");
    expect(result.decisions[0].outcomes.map((entry) => entry.record.outcome)).toEqual(["Effective", "Inconclusive", "Ineffective"]);
    expect(result.decisions[0].outcomes.every((entry) => entry.causalAttribution === "Uncertain")).toBe(true);
  });

  it.each(["Effective", "Partially effective", "Ineffective", "Inconclusive", "No longer applicable"] as const)(
    "preserves the distinct %s outcome without calling an intervention successful or resolved", (category) => {
      const entry = outcome("target", category);
      const record = selected("decision", option("option", {
        treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }],
      }));
      const view = buildIcarusInterventionIndex(input([record], {
        assessments: [assessment({ causes: [cause()], interventionDecisions: [record], treatmentOutcomes: [entry] })],
        treatment: treatment([target()], [entry]),
      })).decisions[0];
      expect(view.readiness).toBe("Outcome available");
      expect(view.outcomes[0].record.outcome).toBe(category);
      expect(view.outcomes[0].causalAttribution).toBe(category === "No longer applicable" ? "Not attributable" : "Uncertain");
    },
  );

  it("keeps superseded outcomes historical and does not satisfy prerequisites with them", () => {
    const entry = outcome();
    const record = selected("decision", option("option", {
      treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }],
    }));
    const result = buildIcarusInterventionIndex(input([record], {
      assessments: [assessment({ causes: [cause()], interventionDecisions: [record], treatmentOutcomes: [entry] })],
      treatment: treatment([target()], [entry], false),
    }));
    expect(result.decisions[0].readiness).toBe("Awaiting verification");
    expect(result.decisions[0].outcomes[0].current).toBe(false);
    expect(result.decisions[0].outcomes[0].causalAttribution).toBe("Not attributable");
  });

  it("preserves replaced selections' outcomes as history rather than current proof", () => {
    const first = selected("decision", option("first", {
      treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }],
    }));
    const next = selectIcarusInterventionOption(first, "decision-alternative", "Changed selection", "person", later, "replacement");
    const entry = outcome();
    const result = buildIcarusInterventionIndex(input([next], {
      assessments: [assessment({ causes: [cause()], interventionDecisions: [next], treatmentOutcomes: [entry] })],
      treatment: treatment([target()], [entry]),
    })).decisions[0];
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({ optionId: "first", current: false, causalAttribution: "Not attributable" });
    expect(result.readiness).toBe("Selected — unrouted");
  });

  it("does not reuse verification from before a selection's target link as its current outcome", () => {
    const record = selected("prior", option("prior-option", {
      treatmentLinks: [{ targetId: "target", linkedAt: "2026-10-03T10:00:00.000Z", linkedByPersonId: "person" }],
    }));
    const future = decision("future", { createdAt: "2026-10-04T10:00:00.000Z" });
    const entry = outcome();
    const result = buildIcarusInterventionIndex(input([record, future], {
      assessments: [assessment({ causes: [cause()], interventionDecisions: [record, future], treatmentOutcomes: [entry] })],
      treatment: treatment([target()], [entry]),
    }));
    expect(result.decisions.find((view) => view.record.id === "prior")?.readiness).toBe("Awaiting verification");
    expect(result.decisions.find((view) => view.record.id === "prior")?.outcomes[0])
      .toMatchObject({ current: false, postSelectionEvidence: false });
    expect(result.decisions.find((view) => view.record.id === "future")?.priorOutcomes).toEqual([]);
  });
});

describe("explicit prior outcomes, risk transfers and reusable Lessons", () => {
  function historicalFixture(otherCause = "cause") {
    const failed = outcome("target", "Ineffective");
    const prior = selected("prior", option("prior-option", {
      treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }],
    }));
    const future = selected("future", option("future-option", { causeIds: [otherCause], priorOptionIds: ["prior-option"] }), {
      createdAt: later, causeIds: [otherCause],
    });
    return { failed, prior, future, facts: input([prior, future], {
      assessments: [assessment({ causes: [cause(), cause("unrelated")], interventionDecisions: [prior, future], treatmentOutcomes: [failed] })],
      treatment: treatment([target()], [failed]),
    }) };
  }

  it("shows prior ineffective evidence for an explicit shared cause and warns only on explicit option reuse", () => {
    const { facts } = historicalFixture();
    const result = buildIcarusInterventionIndex(facts);
    expect(result.decisions.find((entry) => entry.record.id === "future")?.priorOutcomes[0].record.outcome).toBe("Ineffective");
    expect(result.attentionByAssessmentId.get("risk")).toContain(
      "future: explicitly reused intervention has a prior ineffective outcome for this cause",
    );
    const future = facts.assessments[0].interventionDecisions!.find((entry) => entry.id === "future")!;
    future.options[0].priorOptionIds = [];
    expect(buildIcarusInterventionIndex(facts).attentionByAssessmentId.get("risk")
      ?.some((reason) => reason.includes("reused intervention"))).toBe(false);
  });

  it("does not inherit prior history by similar cause title or option name", () => {
    const { facts, prior, failed } = historicalFixture("unrelated");
    prior.lessonLinks = [{
      id: "link", lessonId: "lesson", outcomeIds: [failed.id], causeIds: ["cause"], rationale: "Reviewed cause scope",
      linkedAt: later, linkedByPersonId: "person",
    }];
    facts.lessons = [{ id: "lesson", status: "Reviewed" }];
    const result = buildIcarusInterventionIndex(facts);
    expect(result.decisions.find((entry) => entry.record.id === "future")?.priorOutcomes).toEqual([]);
    expect(result.decisions.find((entry) => entry.record.id === "future")?.learning).toEqual([]);
    expect(result.attentionByAssessmentId.get("risk")?.some((reason) => reason.includes("ineffective"))).toBe(false);
  });

  it("keeps improvements and worsening side effects declared, visible and non-mutating", () => {
    const record = selected("decision", option(), { effects: [effect("Potentially improves", "good"), effect("Potentially worsens", "bad")] });
    const facts = input([record], {
      assessments: [
        assessment({ causes: [cause()], interventionDecisions: [record] }),
        assessment({ id: "other", failureModes: [] }),
      ],
      signals: [signal(), signal({ assessmentId: "other", key: "Icarus:other" })],
    });
    const before = structuredClone(facts.assessments);
    const result = buildIcarusInterventionIndex(facts);
    expect(result.decisions[0].record.effects.map((entry) => entry.direction)).toEqual(["Potentially improves", "Potentially worsens"]);
    expect(result.attentionByAssessmentId.get("risk")).toContain("decision: declared risk transfer affects material exposure");
    expect(facts.assessments).toEqual(before);
  });

  it("uses direct material dependency relationships for risk transfer, not expanded correlation", () => {
    const reference = { recordType: "Project" as const, recordId: "project" };
    const record = selected("decision", option(), {
      effects: [{ ...effect("Creates dependency"), target: { kind: "Dependency", reference } }],
    });
    const facts = input([record], {
      sources: [{ ...reference, title: "Dependency", status: "Active" }],
      signals: [signal({ relationships: [{
        identity: "Project:project", reference, kind: "Direct", origin: "Assessment link",
      }] })],
    });
    expect(buildIcarusInterventionIndex(facts).attentionByAssessmentId.get("risk"))
      .toContain("decision: declared risk transfer affects material exposure");
    facts.signals = [signal({ relationships: [{
      identity: "Project:project", reference, kind: "Expanded", origin: "Strategic objective", objectiveId: "objective",
    }] })];
    expect(buildIcarusInterventionIndex(facts).attentionByAssessmentId.get("risk")
      ?.some((reason) => reason.includes("risk transfer"))).toBe(false);
  });

  it("surfaces reviewed Lessons only through explicit cause scope and preserves stale evidence warnings", () => {
    const { failed, prior, future, facts } = historicalFixture();
    prior.lessonLinks = [{
      id: "link", lessonId: "lesson", outcomeIds: [failed.id], causeIds: ["cause"], rationale: "Confirmed reusable scope",
      linkedAt: later, linkedByPersonId: "person",
    }];
    facts.lessons = [{ id: "lesson", status: "Reviewed" }];
    const result = buildIcarusInterventionIndex(facts);
    const next = result.decisions.find((entry) => entry.record.id === future.id)!;
    expect(next.learning[0]).toMatchObject({ lessonId: "lesson", reviewed: true, currentEvidence: true });
    facts.treatment = treatment([target()], [failed], false);
    expect(buildIcarusInterventionIndex(facts).decisions.find((entry) => entry.record.id === future.id)?.learning[0])
      .toMatchObject({ reviewed: true, currentEvidence: false });
    facts.treatment = treatment([target()], [failed]);
    prior.status = "Superseded";
    const superseded = buildIcarusInterventionIndex(facts);
    expect(superseded.decisions.find((entry) => entry.record.id === future.id)?.priorOutcomes[0])
      .toMatchObject({ current: false, causalAttribution: "Not attributable" });
    expect(superseded.decisions.find((entry) => entry.record.id === future.id)?.learning[0])
      .toMatchObject({ reviewed: true, currentEvidence: false });
    prior.lessonLinks[0].causeIds = [];
    expect(buildIcarusInterventionIndex(facts).decisions.find((entry) => entry.record.id === future.id)?.learning).toEqual([]);
  });

  it("does not reuse unreviewed Lessons or invalid cause/outcome links", () => {
    const { failed, prior, future, facts } = historicalFixture();
    prior.lessonLinks = [{
      id: "link", lessonId: "lesson", outcomeIds: [failed.id], causeIds: ["cause"], rationale: "Explicit scope",
      linkedAt: later, linkedByPersonId: "person",
    }];
    facts.lessons = [{ id: "lesson", status: "New" }];
    expect(buildIcarusInterventionIndex(facts).decisions.find((entry) => entry.record.id === future.id)?.learning).toEqual([]);
    facts.lessons = [{ id: "lesson", status: "Reviewed" }];
    prior.lessonLinks[0].causeIds = ["unrelated"];
    const invalid = buildIcarusInterventionIndex(facts);
    expect(invalid.decisions.find((entry) => entry.record.id === future.id)?.learning).toEqual([]);
    expect(invalid.learningInput[0].interventionContext?.lessonIds).toEqual([]);
    expect(invalid.decisions.find((entry) => entry.record.id === prior.id)?.issues)
      .toContain("Lesson link has missing outcome or invalid cause scope: lesson");
  });

  it("retains prior declared effects without inventing an observed outcome", () => {
    const prior = selected("prior", option("prior-option"), {
      effects: [{ ...effect("Creates dependency"), optionId: "prior-option" }],
    });
    const future = decision("future", { createdAt: later });
    const result = buildIcarusInterventionIndex(input([prior, future])).decisions.find((entry) => entry.record.id === "future")!;
    expect(result.priorOutcomes).toEqual([]);
    expect(result.priorEffects).toEqual(prior.effects);
  });

  it.each(["stale", "contradictory", "missing source"] as const)("surfaces %s side-effect evidence rather than treating it as support", (condition) => {
    const record = selected("decision", option(), {
      effects: [{ ...effect("Potentially worsens"), target: { kind: "Assessment", id: "risk" },
        evidence: [{ assessmentId: "risk", failureModeId: "mode", evidenceId: "evidence" }] }],
    });
    const result = buildIcarusInterventionIndex(input([record], {
      assessments: [assessment({
        causes: [cause()], interventionDecisions: [record],
        failureModes: [{ id: "mode", mechanism: "Mechanism", vulnerability: "Vulnerability", evidence: [{
          id: "evidence", statement: "Recorded observation", origin: condition === "missing source" ? "Source record" : "Direct observation",
          recordedAt: at, recordedBy: "person", review: condition === "contradictory" ? "Contradicts" : "Supports",
          reviewedAt: at, reviewedBy: "person",
          ...(condition === "stale" ? { validUntil: "2026-09-30" } : {}),
          ...(condition === "missing source" ? { reference: { recordType: "Project" as const, recordId: "missing" } } : {}),
        }] }],
      })],
    }));
    expect(result.decisions[0].issues).toContain("Side-effect evidence is not current support: evidence");
    expect(result.decisions[0].readiness).toBe("Not structured");
  });

  it("produces traceable learning inputs while inconclusive and superseded outcomes stay Unknown", () => {
    const record = selected("decision", option("option", {
      treatmentLinks: [{ targetId: "target", linkedAt: at, linkedByPersonId: "person" }],
    }));
    const entry = outcome("target", "Inconclusive");
    const result = buildIcarusInterventionIndex(input([record], {
      assessments: [assessment({ causes: [cause()], interventionDecisions: [record], treatmentOutcomes: [entry] })],
      treatment: treatment([target()], [entry]),
    }));
    const learning = buildOrganisationalLearning({
      actions: [], projects: [], decisions: [], lessons: [], problems: [], systems: [], sops: [],
      icarusTreatmentOutcomes: result.learningInput,
    });
    expect(learning[0].outcomeState).toBe("Unknown");
    expect(learning[0].evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "causeId", value: "cause" }),
      expect.objectContaining({ field: "interventionDecisionId", value: "decision" }),
      expect.objectContaining({ field: "treatmentTargetId", value: "target" }),
      expect.objectContaining({ field: "evidenceReference" }),
    ]));
    const effective = outcome();
    const historical = buildIcarusInterventionIndex(input([record], {
      assessments: [assessment({ causes: [cause()], interventionDecisions: [record], treatmentOutcomes: [effective] })],
      treatment: treatment([target()], [effective], false),
    }));
    expect(buildOrganisationalLearning({
      actions: [], projects: [], decisions: [], lessons: [], problems: [], systems: [], sops: [],
      icarusTreatmentOutcomes: historical.learningInput,
    })[0].outcomeState).toBe("Unknown");
  });
});

describe("bounded strategic attention and determinism", () => {
  it("gates decision gaps on existing materiality rather than flooding attention", () => {
    expect(buildIcarusInterventionIndex(input()).attentionByAssessmentId.get("risk"))
      .toEqual(["Material exposure has no structured intervention decision"]);
    expect(buildIcarusInterventionIndex(input([], { signals: [signal({ materialityTier: "Corroborating" })] }))
      .attentionByAssessmentId.size).toBe(0);
  });

  it("enriches the existing Command and Founder risk without creating new identities or scores", () => {
    const facts = input();
    const index = buildIcarusInterventionIndex(facts);
    const reasons = index.attentionByAssessmentId.get("risk") ?? [];
    const enriched = signal({ treatment: { attentionReasons: reasons, founderOwnedCount: 0, delegatedCount: 0 } });
    const command = buildCommandAttention({
      problems: [], actions: [], outreach: [], projects: [], decisions: [], opportunities: [], lessons: [],
      systems: [], sops: [], handoffs: [], procurementQueue: [], icarus: [enriched], nowMs: Date.parse(later),
    });
    expect(command.items).toHaveLength(1);
    expect(command.items[0].id).toBe("risk");
    expect(command.items[0].reasons).toContain(reasons[0]);
    const founder = buildFounderFocus({
      signalledRecords: [], founderReviewItems: [], limitations: [], convergentRisks: [], recordFacts: new Map(),
      strategicRisks: [{
        key: "Icarus:risk", objectType: "Icarus", id: "risk", title: "Outcome", area: "Icarus",
        band: 3, score: 500, reason: "Material exposure", anchorRecordKeys: [], referenceKey: "Icarus:risk",
        treatmentReasons: reasons,
      }],
    });
    expect(founder).toHaveLength(1);
    expect(founder[0].score).toBe(500);
    expect(founder[0].reason).toContain(reasons[0]);
  });

  it("is deterministic and does not mutate frozen persisted facts", () => {
    const facts = input([decision()]);
    const before = structuredClone(facts.assessments);
    function freeze(value: unknown): void {
      if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
    }
    freeze(facts.assessments);
    const first = buildIcarusInterventionIndex(facts);
    expect(buildIcarusInterventionIndex(facts)).toEqual(first);
    expect(facts.assessments).toEqual(before);
  });
});
