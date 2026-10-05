import { describe, expect, it } from "vitest";
import {
  assertIcarusDataStructure,
  buildIcarusReview,
  classifyIcarusEvidenceFreshness,
  getIcarusIdentityKey,
  getIcarusReferenceKey,
  isIcarusAssessmentRecord,
  ICARUS_STORAGE_KEY,
  parseIcarusAssessments,
  type IcarusAssessmentRecord,
  type IcarusEvidence,
} from "./icarus";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  buildFullBackup,
  runBackupRestoreTransaction,
  STORAGE_KEY,
  validateEmpireOsBackup,
  type BackupStorage,
  type EmpireOsBackup,
} from "./backup";
import { persistJsonArray } from "./persistence";

const timestamp = "2026-10-04T12:00:00.000Z";

function makeEvidence(overrides: Partial<IcarusEvidence> = {}): IcarusEvidence {
  return {
    id: "evidence-1",
    statement: "The weekly close was missed twice.",
    origin: "Source record",
    reference: { recordType: "Problem", recordId: "problem-1" },
    recordedAt: timestamp,
    recordedBy: "Founder",
    review: "Supports",
    reviewedAt: timestamp,
    reviewedBy: "Founder",
    ...overrides,
  };
}

function makeAssessment(overrides: Partial<IcarusAssessmentRecord> = {}): IcarusAssessmentRecord {
  return {
    id: "assessment-1",
    outcome: "Monthly reporting is completed on time.",
    status: "Open",
    createdAt: timestamp,
    updatedAt: timestamp,
    linkedRecords: [],
    failureModes: [{
      id: "mode-1",
      mechanism: "Required records are not collected before close.",
      vulnerability: "No accountable owner or deadline exists.",
      evidence: [makeEvidence()],
    }],
    controls: [{
      id: "control-1",
      failureModeId: "mode-1",
      intervention: "Introduce an owned close checklist.",
      lifecycle: "Active",
      effectiveness: "Unknown",
      evidenceIds: [],
      linkedRecords: [{ recordType: "Action", recordId: "action-1" }],
    }],
    ...overrides,
  };
}

function makeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: BackupStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
  return { data, storage };
}

describe("Icarus identity and data integrity", () => {
  it("uses deterministic, type-qualified identity for assessments and source references", () => {
    expect(getIcarusIdentityKey("case-1")).toBe("icarus-assessment:case-1");
    expect(getIcarusIdentityKey("case-1")).toBe(getIcarusIdentityKey("case-1"));
    expect(getIcarusReferenceKey({ recordType: "Problem", recordId: "same-id" })).toBe("Problem:same-id");
    expect(getIcarusReferenceKey({ recordType: "Action", recordId: "same-id" })).toBe("Action:same-id");
  });

  it("rejects malformed data and duplicate identity", () => {
    expect(isIcarusAssessmentRecord(null)).toBe(false);
    expect(isIcarusAssessmentRecord({ id: "missing-fields" })).toBe(false);
    expect(() => assertIcarusDataStructure([makeAssessment(), makeAssessment()])).toThrow("duplicate assessment ID");
    expect(() => assertIcarusDataStructure([makeAssessment({
      controls: [{ ...makeAssessment().controls[0], failureModeId: "missing-mode" }],
    })])).toThrow("references missing failure mode");
  });

  it("preserves evidence provenance and requires named review provenance for reviewed claims", () => {
    const evidence = makeEvidence();
    expect(isIcarusAssessmentRecord(makeAssessment())).toBe(true);
    expect(isIcarusAssessmentRecord(makeAssessment({
      failureModes: [{ ...makeAssessment().failureModes[0], evidence: [{ ...evidence, reviewedBy: "" }] }],
    }))).toBe(false);
    expect(isIcarusAssessmentRecord(makeAssessment({
      failureModes: [{ ...makeAssessment().failureModes[0], evidence: [{ ...evidence, origin: "Direct observation", reference: evidence.reference }] }],
    }))).toBe(false);
  });

  it("rejects dangling internal relationships without mutating the assessment", () => {
    const assessment = makeAssessment();
    const before = structuredClone(assessment);
    expect(() => assertIcarusDataStructure([{
      ...assessment,
      controls: [{ ...assessment.controls[0], evidenceIds: ["missing-evidence"] }],
    }])).toThrow("references evidence outside its failure mode");
    expect(assessment).toEqual(before);
  });
});

describe("Icarus review derivation", () => {
  it("does not invent failure modes from linked operational records", () => {
    const assessment = makeAssessment({ failureModes: [] });
    const review = buildIcarusReview([assessment], [], Date.parse(timestamp))[0];
    expect(review.findings.map(({ code }) => code)).toEqual(["no-failure-modes"]);
  });

  it("surfaces missing source records without rejecting the assessment or changing source data", () => {
    const assessment = makeAssessment({
      linkedRecords: [{ recordType: "Problem", recordId: "problem-1" }],
    });
    const sources = [
      { recordType: "Problem" as const, recordId: "problem-1", title: "Late reporting" },
      { recordType: "Action" as const, recordId: "action-1", title: "Close checklist" },
    ];
    const before = structuredClone(sources);
    const linkedReview = buildIcarusReview([assessment], sources, Date.parse(timestamp))[0];
    expect(linkedReview.findings.some(({ code }) => code === "missing-source")).toBe(false);
    const missingReview = buildIcarusReview([assessment], [], Date.parse(timestamp))[0];
    const missingSourceFindings = missingReview.findings.filter(({ code }) => code === "missing-source");
    expect(missingSourceFindings).toHaveLength(3);
    expect(missingSourceFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        recordReference: { recordType: "Problem", recordId: "problem-1" },
        failureModeId: "mode-1",
        evidenceId: "evidence-1",
      }),
      expect.objectContaining({
        recordReference: { recordType: "Action", recordId: "action-1" },
        failureModeId: "mode-1",
        controlId: "control-1",
      }),
      expect.objectContaining({
        recordReference: { recordType: "Problem", recordId: "problem-1" },
        message: "Assessment link to Problem problem-1 is unresolved.",
      }),
    ]));
    expect(sources).toEqual(before);
  });

  it("keeps unresolved and unreviewed evidence distinct from supporting evidence", () => {
    const unresolved = makeEvidence({ review: "Unresolved", reviewedAt: timestamp, reviewedBy: "Reviewer" });
    const assessment = makeAssessment({
      failureModes: [{ ...makeAssessment().failureModes[0], evidence: [unresolved] }],
    });
    const codes = buildIcarusReview([assessment], [{ recordType: "Problem", recordId: "problem-1", title: "Problem" }], Date.parse(timestamp))[0].findings.map(({ code }) => code);
    expect(codes).toContain("unresolved-evidence");
    expect(codes).toContain("no-evidence");

    const unreviewed = makeAssessment({
      failureModes: [{ ...makeAssessment().failureModes[0], evidence: [makeEvidence({ review: "Unreviewed", reviewedAt: undefined, reviewedBy: undefined })] }],
    });
    expect(buildIcarusReview([unreviewed], [{ recordType: "Problem", recordId: "problem-1", title: "Problem" }], Date.parse(timestamp))[0].findings.map(({ code }) => code)).toContain("unreviewed-evidence");
  });

  it("preserves conflicting evidence rather than choosing a winning interpretation", () => {
    const assessment = makeAssessment({
      failureModes: [{
        ...makeAssessment().failureModes[0],
        evidence: [
          makeEvidence({ id: "supporting", review: "Supports" }),
          makeEvidence({ id: "contrary", review: "Contradicts", statement: "The required records were present." }),
        ],
      }],
    });
    const review = buildIcarusReview([assessment], [{ recordType: "Problem", recordId: "problem-1", title: "Problem" }], Date.parse(timestamp))[0];
    expect(review.findings.filter(({ code }) => code === "conflicting-evidence")).toHaveLength(1);
  });

  it("classifies stale and invalid evidence dates explicitly", () => {
    expect(classifyIcarusEvidenceFreshness({
      recordedAt: timestamp,
      validUntil: "2026-10-03T00:00:00.000Z",
    }, Date.parse(timestamp))).toBe("Stale");
    expect(classifyIcarusEvidenceFreshness({
      recordedAt: "not-a-date",
    }, Date.parse(timestamp))).toBe("Invalid");
    expect(classifyIcarusEvidenceFreshness({
      recordedAt: timestamp,
      validUntil: "2026-10-04",
    }, Date.parse(timestamp))).toBe("Current");
    const assessment = makeAssessment({
      failureModes: [{
        ...makeAssessment().failureModes[0],
        evidence: [
          makeEvidence({ id: "stale", validUntil: "2026-10-03T00:00:00.000Z" }),
          makeEvidence({ id: "invalid", recordedAt: "invalid-date" }),
        ],
      }],
    });
    const codes = buildIcarusReview([assessment], [{ recordType: "Problem", recordId: "problem-1", title: "Problem" }], Date.parse(timestamp))[0].findings.map(({ code }) => code);
    expect(codes).toContain("stale-evidence");
    expect(codes).toContain("invalid-evidence");
  });

  it("surfaces missing, planned, untested and ineffective controls without scoring them", () => {
    const mode = makeAssessment().failureModes[0];
    const assessment = makeAssessment({
      failureModes: [{
        ...mode,
        evidence: [
          ...mode.evidence,
          makeEvidence({ id: "contradiction", review: "Contradicts", statement: "The records were present." }),
        ],
      }],
      controls: [
        { ...makeAssessment().controls[0], id: "planned", lifecycle: "Planned" },
        { ...makeAssessment().controls[0], id: "ineffective", lifecycle: "Ineffective", effectiveness: "Evidence contradicts", effectivenessReviewedAt: timestamp, effectivenessReviewedBy: "Reviewer", evidenceIds: ["contradiction"] },
      ],
    });
    const codes = buildIcarusReview([assessment], [{ recordType: "Problem", recordId: "problem-1", title: "Problem" }], Date.parse(timestamp))[0].findings.map(({ code }) => code);
    expect(codes).toContain("planned-control");
    expect(codes).toContain("ineffective-control");
    expect(codes).toContain("contradicted-control");

    const missing = makeAssessment({ controls: [] });
    expect(buildIcarusReview([missing], [], Date.parse(timestamp))[0].findings.map(({ code }) => code)).toContain("missing-control");
  });

  it("does not infer control effectiveness from lifecycle or completion", () => {
    const assessment = makeAssessment({
      controls: [{ ...makeAssessment().controls[0], lifecycle: "Active", effectiveness: "Unknown" }],
    });
    expect(buildIcarusReview([assessment], [{ recordType: "Problem", recordId: "problem-1", title: "Problem" }], Date.parse(timestamp))[0].findings.map(({ code }) => code)).toContain("untested-control");
  });

  it("requires a named human assessment to identify a weak control", () => {
    const control = makeAssessment().controls[0];
    const assessment = makeAssessment({
      controls: [{
        ...control,
        effectiveness: "Weak",
        effectivenessReviewedAt: timestamp,
        effectivenessReviewedBy: "Reviewer",
      }],
    });
    expect(buildIcarusReview([assessment], [{ recordType: "Problem", recordId: "problem-1", title: "Problem" }], Date.parse(timestamp))[0].findings.map(({ code }) => code)).toContain("weak-control");
    expect(isIcarusAssessmentRecord(makeAssessment({ controls: [{ ...control, effectiveness: "Weak" }] }))).toBe(false);
  });

  it("surfaces invalid and overdue control review dates", () => {
    const controls = makeAssessment().controls[0];
    const assessment = makeAssessment({
      controls: [
        { ...controls, id: "overdue-review", nextReviewAt: "2026-10-03" },
        { ...controls, id: "invalid-review", nextReviewAt: "2026-02-31" },
      ],
    });
    const codes = buildIcarusReview([assessment], [{ recordType: "Problem", recordId: "problem-1", title: "Problem" }], Date.parse(timestamp))[0].findings.map(({ code }) => code);
    expect(codes).toContain("stale-control-review");
    expect(codes).toContain("invalid-control-review");
  });

  it("retains unresolved findings on closed assessments without treating closure as resolution", () => {
    const assessment = makeAssessment({ status: "Closed", failureModes: [], controls: [] });
    expect(buildIcarusReview([assessment], [], Date.parse(timestamp))[0].findings.map(({ code }) => code)).toContain("no-failure-modes");
  });
});

describe("Icarus persistence and backup", () => {
  it("rehydrates persisted data without changing its nested source references", () => {
    const storage = new Map<string, string>();
    const persistence = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    };
    const assessment = makeAssessment();
    const before = structuredClone(assessment);
    persistJsonArray(persistence, ICARUS_STORAGE_KEY, [assessment]);
    expect(parseIcarusAssessments(persistence.getItem(ICARUS_STORAGE_KEY))).toEqual([assessment]);
    expect(assessment).toEqual(before);
    expect(parseIcarusAssessments(null)).toEqual([]);
  });

  it("rejects malformed persisted data without altering the stored value", () => {
    const invalid = JSON.stringify([{ id: "broken" }]);
    const storage = new Map([[ICARUS_STORAGE_KEY, invalid]]);
    expect(() => parseIcarusAssessments(storage.get(ICARUS_STORAGE_KEY) || null)).toThrow("valid assessment records");
    expect(storage.get(ICARUS_STORAGE_KEY)).toBe(invalid);
    expect(() => parseIcarusAssessments("not-json")).toThrow();
  });

  it("includes Icarus in full backup and restores the data exactly", () => {
    const assessment = makeAssessment();
    const original = makeStorage({ [ICARUS_STORAGE_KEY]: JSON.stringify([assessment]) });
    const backup = buildFullBackup(original.storage, timestamp);
    expect(validateEmpireOsBackup(backup).storage[ICARUS_STORAGE_KEY]).toBe(JSON.stringify([assessment]));
    const target = makeStorage({ [ICARUS_STORAGE_KEY]: "[]" });
    expect(runBackupRestoreTransaction(target.storage, backup).ok).toBe(true);
    expect(target.storage.getItem(ICARUS_STORAGE_KEY)).toBe(JSON.stringify([assessment]));
  });

  it("preserves Icarus data when restoring a pre-Icarus full backup", () => {
    const existingAssessments = JSON.stringify([makeAssessment()]);
    const target = makeStorage({ [ICARUS_STORAGE_KEY]: existingAssessments });
    const legacyBackup: EmpireOsBackup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: timestamp,
      storage: { [STORAGE_KEY]: "[]" },
    };

    expect(runBackupRestoreTransaction(target.storage, legacyBackup).ok).toBe(true);
    expect(target.storage.getItem(ICARUS_STORAGE_KEY)).toBe(existingAssessments);
  });

  it("blocks malformed Icarus data in a backup before restore", () => {
    const backup: EmpireOsBackup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: timestamp,
      storage: { [ICARUS_STORAGE_KEY]: JSON.stringify([{ id: "broken" }]) },
    };
    expect(() => validateEmpireOsBackup(backup)).toThrow("invalid Icarus data");
    const target = makeStorage({ [ICARUS_STORAGE_KEY]: "existing-data" });
    expect(runBackupRestoreTransaction(target.storage, backup).ok).toBe(false);
    expect(target.storage.getItem(ICARUS_STORAGE_KEY)).toBe("existing-data");
  });

  it("rolls back Icarus data if a restore write fails", () => {
    const assessment = makeAssessment();
    const backup = buildFullBackup(makeStorage({
      [ICARUS_STORAGE_KEY]: JSON.stringify([assessment]),
    }).storage, timestamp);
    const previous = JSON.stringify([{ ...assessment, outcome: "Prior state" }]);
    const target = makeStorage({ [ICARUS_STORAGE_KEY]: previous });
    const setItem = target.storage.setItem.bind(target.storage);
    let failOnce = true;
    target.storage.setItem = (key, value) => {
      if (key === ICARUS_STORAGE_KEY && value === JSON.stringify([assessment]) && failOnce) {
        failOnce = false;
        throw new Error("simulated write failure");
      }
      setItem(key, value);
    };

    const result = runBackupRestoreTransaction(target.storage, backup);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.rollbackFailures).toEqual([]);
    expect(target.storage.getItem(ICARUS_STORAGE_KEY)).toBe(previous);
  });
});

describe("Icarus Phase 3 assurance schema", () => {
  const nowMs = Date.parse(timestamp);
  const day = 24 * 60 * 60 * 1000;
  const iso = (offsetDays: number) => new Date(nowMs + offsetDays * day).toISOString();

  function withControl(overrides: Partial<IcarusAssessmentRecord["controls"][number]>): IcarusAssessmentRecord {
    const base = makeAssessment();
    return { ...base, controls: [{ ...base.controls[0], ...overrides }] };
  }

  function codesFor(assessment: IcarusAssessmentRecord) {
    const sources = [
      { recordType: "Problem" as const, recordId: "problem-1", title: "Missed close" },
      { recordType: "Action" as const, recordId: "action-1", title: "Close checklist" },
    ];
    return buildIcarusReview([assessment], sources, nowMs)[0].findings.map((finding) => finding.code);
  }

  it("reads legacy assessments without assurance fields unchanged", () => {
    const legacy = makeAssessment();
    const stored = JSON.stringify([legacy]);
    expect(parseIcarusAssessments(stored)).toEqual([legacy]);
    expect(JSON.stringify(parseIcarusAssessments(stored))).toBe(stored);
  });

  it("round-trips every Phase 3 field through persistence", () => {
    const assessment: IcarusAssessmentRecord = {
      ...withControl({
        ownerPersonId: "person-2",
        testCadenceDays: 30,
        assuranceTests: [{ id: "test-1", testedAt: iso(-1), testedByPersonId: "person-2", result: "Passed", evidenceIds: ["evidence-1"], note: "Checked" }],
      }),
      accountableOwnerPersonId: "person-1",
      reviewedAt: iso(-2),
      reviewedByPersonId: "person-1",
      nextReviewBy: iso(60),
      acceptances: [{ id: "acc-1", failureModeIds: ["mode-1"], acceptedByPersonId: "person-1", rationale: "Tolerable", acceptedAt: iso(-3), reviewBy: iso(30), conditions: "Revisit after season" }],
      assuranceActionLinks: [{ obligationId: "assessment-1:no-risk-owner", actionId: "action-9", linkedAt: iso(-1) }],
    };
    const stored = JSON.stringify([assessment]);
    const parsed = parseIcarusAssessments(stored);
    expect(parsed).toEqual([assessment]);
    expect(JSON.stringify(parsed)).toBe(stored);
  });

  it("drops invalid optional assurance fields without discarding the assessment", () => {
    const stored = JSON.stringify([{
      ...makeAssessment(),
      accountableOwnerPersonId: "",
      nextReviewBy: "not-a-date",
      // A review without its reviewer is dropped as a pair.
      reviewedAt: iso(-1),
      acceptances: [
        { id: "acc-1", failureModeIds: ["mode-1", "mode-unknown", "mode-1"], acceptedByPersonId: "p", rationale: "r", acceptedAt: iso(-1), reviewBy: iso(10), revokedAt: "bad" },
        { id: "acc-1", failureModeIds: ["mode-1"], acceptedByPersonId: "p", rationale: "dup", acceptedAt: iso(-1), reviewBy: iso(10) },
        { id: "broken" },
      ],
      assuranceActionLinks: "nope",
      controls: [{
        ...makeAssessment().controls[0],
        ownerPersonId: 4,
        testCadenceDays: -3,
        assuranceTests: [
          { id: "t1", testedAt: iso(-1), testedByPersonId: "p", result: "Passed", evidenceIds: ["evidence-1", "foreign-evidence"] },
          { id: "t2", testedAt: "bad", testedByPersonId: "p", result: "Passed", evidenceIds: [] },
          { id: "t3", testedAt: iso(-1), testedByPersonId: "p", result: "Maybe", evidenceIds: [] },
        ],
      }],
    }]);
    const [assessment] = parseIcarusAssessments(stored);
    expect(assessment.accountableOwnerPersonId).toBeUndefined();
    expect(assessment.nextReviewBy).toBeUndefined();
    expect(assessment.reviewedAt).toBeUndefined();
    expect(assessment.reviewedByPersonId).toBeUndefined();
    expect(assessment.assuranceActionLinks).toBeUndefined();
    expect(assessment.acceptances).toEqual([
      { id: "acc-1", failureModeIds: ["mode-1"], acceptedByPersonId: "p", rationale: "r", acceptedAt: iso(-1), reviewBy: iso(10) },
    ]);
    const [control] = assessment.controls;
    expect(control.ownerPersonId).toBeUndefined();
    expect(control.testCadenceDays).toBeUndefined();
    expect(control.assuranceTests).toEqual([
      { id: "t1", testedAt: iso(-1), testedByPersonId: "p", result: "Passed", evidenceIds: ["evidence-1"] },
    ]);
  });

  it("still rejects structurally broken core records", () => {
    expect(() => parseIcarusAssessments(JSON.stringify([{ ...makeAssessment(), acceptances: [{ id: "x" }], status: "Bogus" }]))).toThrow("valid assessment records");
  });

  it("validates Phase 3 data in full backups using the same normaliser and keeps the raw value", () => {
    const raw = JSON.stringify([{ ...makeAssessment(), nextReviewBy: "not-a-date" }]);
    const backup: EmpireOsBackup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: timestamp, storage: { [ICARUS_STORAGE_KEY]: raw } };
    expect(validateEmpireOsBackup(backup).storage[ICARUS_STORAGE_KEY]).toBe(raw);
    const target = makeStorage({ [ICARUS_STORAGE_KEY]: "[]" });
    expect(runBackupRestoreTransaction(target.storage, backup).ok).toBe(true);
    expect(parseIcarusAssessments(target.storage.getItem(ICARUS_STORAGE_KEY))[0].nextReviewBy).toBeUndefined();
  });

  it("classifies the latest control test", () => {
    const test = (result: "Passed" | "Failed" | "Inconclusive", evidenceIds: string[] = ["evidence-1"]) =>
      withControl({ assuranceTests: [{ id: "t", testedAt: iso(-1), testedByPersonId: "p", result, evidenceIds }] });
    expect(codesFor(test("Failed"))).toContain("failed-control-test");
    expect(codesFor(test("Inconclusive"))).toContain("inconclusive-control-test");
    expect(codesFor(test("Passed", []))).toContain("unsupported-control-test");
    const supported = codesFor(test("Passed"));
    expect(supported).not.toContain("unsupported-control-test");
    expect(supported).not.toContain("untested-control");
  });

  it("flags lapsed test cadence for operating controls only", () => {
    const lapsed = withControl({ testCadenceDays: 7, assuranceTests: [{ id: "t", testedAt: iso(-10), testedByPersonId: "p", result: "Passed", evidenceIds: ["evidence-1"] }] });
    expect(codesFor(lapsed)).toContain("overdue-control-test");
    expect(codesFor({ ...lapsed, controls: [{ ...lapsed.controls[0], lifecycle: "Retired" }] })).not.toContain("overdue-control-test");
    const current = withControl({ testCadenceDays: 30, assuranceTests: [{ id: "t", testedAt: iso(-10), testedByPersonId: "p", result: "Passed", evidenceIds: ["evidence-1"] }] });
    expect(codesFor(current)).not.toContain("overdue-control-test");
  });

  it("leaves legacy control review findings unchanged when no test exists", () => {
    expect(codesFor(makeAssessment())).toContain("untested-control");
    expect(codesFor(withControl({ effectiveness: "Weak", effectivenessReviewedAt: timestamp, effectivenessReviewedBy: "Founder" }))).toContain("weak-control");
  });
});
