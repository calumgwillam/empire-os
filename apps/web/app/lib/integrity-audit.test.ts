import { describe, expect, it } from "vitest";
import {
  CASH_POSITION_STORAGE_KEY,
  CHANGE_HISTORY_STORAGE_KEY,
  EMPIRE_OS_BACKUP_STORAGE_KEYS,
  STORAGE_KEY,
} from "./backup";
import type { ActionRecord, CaptureConversionRecord, DecisionRecord, LessonRecord, OpportunityRecord, ProblemRecord, SopRecord, SystemRecord } from "./capture-conversions";
import type { LeadRecord, OutreachRecord } from "./crm";
import type { CommitmentRecord } from "./finance";
import { isValidChangeEvent } from "./backup";
import type { ProjectRecord } from "./projects";
import type { StrategicObjective, StrategicReview } from "./strategic-reviews";
import {
  runIntegrityAudit,
  type IntegrityAuditInput,
  type IntegrityAuditPerson,
} from "./integrity-audit";

const sharedAreaOptions = ["Garden Maintenance", "Marketing / Growth"];
const commitmentTypeOptions = ["Loan", "Lease", "Subscription", "Tax", "Supplier", "Insurance", "Other"] as const;
const commitmentStatusOptions = ["Upcoming", "Due", "Paid", "Overdue", "Cancelled"] as const;

function makeInput(overrides: Partial<IntegrityAuditInput> = {}): IntegrityAuditInput {
  return {
    captures: [],
    conversions: [],
    actions: [],
    projects: [],
    problems: [],
    opportunities: [],
    decisions: [],
    lessons: [],
    systems: [],
    sops: [],
    people: [],
    leads: [],
    commitments: [],
    outreach: [],
    handoffs: [],
    strategicObjectives: [],
    strategicReviews: [],
    storage: Object.fromEntries(EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => [key, null])),
    sharedAreaOptions,
    commitmentTypeOptions,
    commitmentStatusOptions,
    nowIso: () => "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

function makeAction(overrides: Partial<ActionRecord> = {}): ActionRecord {
  return {
    id: "action-1",
    sourceCaptureId: "",
    targetType: "Convert to Action",
    createdAt: "2026-10-01T10:00:00.000Z",
    title: "Action title",
    originalRawNote: "",
    relatedArea: "Garden Maintenance",
    importance: "Medium",
    status: "Open",
    actionTitle: "Action title",
    description: "",
    owner: "",
    createdBy: "",
    createdDate: "2026-10-01T10:00:00.000Z",
    dueDate: "",
    priority: "Medium",
    relatedProblem: "",
    relatedDecision: "",
    relatedCapture: "",
    relatedPillar: "Garden Maintenance",
    completionEvidence: "",
    completionDate: "",
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "project-1",
    projectName: "Project title",
    owner: "",
    area: "Garden Maintenance",
    startDate: "",
    targetCompletionDate: "",
    status: "In Progress",
    relatedActionIds: [],
    relatedDecisionIds: [],
    relatedSystemIds: [],
    relatedSopIds: [],
    ...overrides,
  } as ProjectRecord;
}

function makeProblem(overrides: Partial<ProblemRecord> = {}): ProblemRecord {
  return {
    id: "problem-1",
    sourceCaptureId: "",
    targetType: "Convert to Problem",
    createdAt: "2026-10-01T10:00:00.000Z",
    title: "Problem title",
    originalRawNote: "",
    relatedArea: "Garden Maintenance",
    importance: "Medium",
    status: "Open",
    problemStatement: "Problem title",
    severity: "Medium",
    frequency: "Occasional",
    impact: "",
    rootCauseStatus: "Not investigated",
    rootCause: "",
    owner: "",
    resolution: "",
    problemStatus: "Open",
    ...overrides,
  };
}

function makeObjective(overrides: Partial<StrategicObjective> = {}): StrategicObjective {
  return {
    id: "objective-1",
    title: "Objective title",
    pillar: "Operating Business",
    horizon: "Now",
    importance: "High",
    status: "Active",
    founderAllocation: "Monitor",
    owner: "",
    whyItMatters: "",
    successCondition: "",
    linkedProjectIds: [],
    linkedOpportunityIds: [],
    linkedDecisionIds: [],
    createdAt: "2026-10-01T10:00:00.000Z",
    overrides: [],
    ...overrides,
  };
}

function makeReview(overrides: Partial<StrategicReview> = {}): StrategicReview {
  return {
    id: "review-1",
    status: "Draft",
    stage: 0,
    reviewDate: "2026-10-01",
    trigger: "Founder initiated",
    reviewPeriodStart: "2026-10-01",
    nextReviewDate: "2026-10-08",
    realitySummary: "",
    evidenceSnapshot: null,
    constraints: [],
    opportunities: [],
    assumptions: [],
    blankSheetCandidates: [],
    objectiveJudgements: [],
    projectJudgements: [],
    strategicGaps: [],
    founderAllocation: [],
    notPrioritising: [],
    contradictions: [],
    founderNotes: "",
    createdAt: "2026-10-01T10:00:00.000Z",
    appliedAt: null,
    supersededAt: null,
    ...overrides,
  };
}

function makeCommitment(overrides: Partial<CommitmentRecord> = {}): CommitmentRecord {
  return {
    id: "commitment-1",
    commitmentName: "Materials",
    amount: "100",
    dueDate: "",
    type: "Supplier",
    status: "Upcoming",
    certainty: "Planned",
    relatedPillar: "Garden Maintenance",
    procurementNeed: "",
    originalBudget: "",
    targetPrice: "",
    actualPurchasePrice: "",
    supplier: "",
    expectedPurchaseDate: "",
    actualPurchaseDate: "",
    quoteCheckedDate: "",
    quoteExpiryDate: "",
    quoteReference: "",
    quoteNotes: "",
    purchaseEvidenceReference: "",
    invoiceOrderReference: "",
    evidenceNotes: "",
    actualSupplier: "",
    pendingValidationReason: "",
    approvalStatus: "Not reviewed",
    approvedRejectedBy: "",
    approvalDate: "",
    approvalRationale: "",
    capitalDecisionDeferredUntil: "",
    notes: "",
    dateCreated: "2026-10-01T10:00:00.000Z",
    ...overrides,
  } as CommitmentRecord;
}

function issueSummaries(input: IntegrityAuditInput) {
  return runIntegrityAudit(input).issues.map(({ id, severity, category, recordType, recordId, reason, nextStep }) => ({
    id,
    severity,
    category,
    recordType,
    recordId,
    reason,
    nextStep,
  }));
}

describe("runIntegrityAudit", () => {
  it("audits broken commercial Action-to-Lead relationships without altering legacy Actions", () => {
    const issues = runIntegrityAudit(makeInput({ actions: [makeAction({ relatedLeadId: "missing-lead" })] })).issues;
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({
      category: "Broken relationships", recordType: "Action", recordId: "action-1",
      reason: "Related Lead references missing ID missing-lead.",
    })]));
    expect(runIntegrityAudit(makeInput({ actions: [makeAction()] })).issues.some((issue) => issue.reason.includes("Related Lead"))).toBe(false);
  });
  it("returns a healthy report for empty records and null stores", () => {
    expect(runIntegrityAudit(makeInput())).toEqual({
      auditedAt: "2026-10-01T12:00:00.000Z",
      status: "Healthy",
      issues: [],
      severityCounts: { Critical: 0, Material: 0, Warning: 0 },
      categoryCounts: [],
    });
  });

  it("keeps deterministic issue IDs, ordering, severity and category", () => {
    const input = makeInput({
      actions: [makeAction({ id: "duplicate" }), makeAction({ id: "duplicate" })],
      projects: [makeProject({ id: "duplicate" })],
    });

    expect(issueSummaries(input)).toEqual([
      {
        id: "integrity-1",
        severity: "Critical",
        category: "Duplicate IDs",
        recordType: "Action",
        recordId: "duplicate",
        reason: "2 action records share the same ID, making references ambiguous.",
        nextStep: "Review the duplicate records manually before changing any IDs or references.",
      },
      {
        id: "integrity-2",
        severity: "Material",
        category: "Ambiguous IDs",
        recordType: "Multiple record types",
        recordId: "duplicate",
        reason: "The same ID is used by: Action, Project.",
        nextStep: "Inspect all affected records and their relationships before making a manual correction.",
      },
    ]);
  });

  it("checks valid and broken Action, Project, People and handoff references", () => {
    const activePerson: IntegrityAuditPerson = { id: "person-1", name: "Alex", status: "Active" };
    const input = makeInput({
      people: [activePerson],
      problems: [makeProblem()],
      actions: [makeAction({
        owner: "Alex",
        relatedProblem: "missing-problem",
        relatedDecision: "missing-decision",
        ownerPersonId: "missing-person",
      })],
      projects: [makeProject({ reviewOwnerPersonId: "missing-reviewer", relatedActionIds: ["missing-action"] })],
      handoffs: [{ id: "handoff-1", objectType: "Action", objectId: "missing-action", title: "Handoff", newOwnerPersonId: "missing-person" }],
    });

    const issues = runIntegrityAudit(input).issues;
    expect(issues.filter((issue) => issue.category === "People references").map((issue) => issue.reason)).toEqual([
      "Owner person references missing ID missing-person.",
      "Review owner person references missing ID missing-reviewer.",
      "New owner person references missing ID missing-person.",
    ]);
    expect(issues.filter((issue) => issue.category === "Broken relationships").map((issue) => issue.reason)).toEqual([
      "Related Problem references missing ID missing-problem.",
      "Related Decision references missing ID missing-decision.",
      "Related Action references missing ID missing-action.",
    ]);
    expect(issues.find((issue) => issue.category === "Delegation references")).toMatchObject({ severity: "Warning", reason: "Action references missing ID missing-action." });
  });

  it("reports strategic objective and review integrity issues", () => {
    const input = makeInput({
      strategicObjectives: [makeObjective({ linkedProjectIds: ["missing-project"] })],
      strategicReviews: [makeReview({ nextReviewDate: "not-a-date" })],
    });

    expect(runIntegrityAudit(input).issues.map(({ category, reason }) => ({ category, reason }))).toEqual([
      { category: "Strategic objectives", reason: "A linked Project ID does not exist in the operating records." },
      { category: "Strategic reviews", reason: "Next review date is missing or invalid." },
    ]);
  });

  it("classifies shared missing Capture roots as legacy and isolated roots as material", () => {
    const input = makeInput({
      actions: [makeAction({ sourceCaptureId: "legacy-capture" })],
      projects: [makeProject({ id: "project-2", sourceCaptureId: "legacy-capture" })],
      problems: [makeProblem({ sourceCaptureId: "isolated-capture" })],
    });

    expect(runIntegrityAudit(input).issues.filter((issue) => issue.recordType === "Capture lineage").map((issue) => ({
      id: issue.id,
      severity: issue.severity,
      category: issue.category,
      recordId: issue.recordId,
    }))).toEqual([
      { id: "integrity-1", severity: "Material", category: "Capture conversion", recordId: "isolated-capture" },
      { id: "integrity-2", severity: "Warning", category: "Legacy lineage", recordId: "legacy-capture" },
    ]);
  });

  it("excludes Capture conversion IDs from cross-type collision checks", () => {
    const conversion: CaptureConversionRecord = {
      id: "shared-id",
      sourceCaptureId: "capture-1",
      targetType: "Convert to Action",
      createdAt: "2026-10-01T10:00:00.000Z",
      title: "Converted action",
      originalRawNote: "",
      relatedArea: "Garden Maintenance",
      importance: "Medium",
      status: "Converted",
    };
    const result = runIntegrityAudit(makeInput({
      conversions: [conversion],
      actions: [makeAction({ id: "shared-id" })],
    }));

    expect(result.issues.some((issue) => issue.category === "Ambiguous IDs")).toBe(false);
  });

  it("reports malformed JSON, wrong storage shapes, and invalid change-history entries", () => {
    const storage = {
      ...makeInput().storage,
      [STORAGE_KEY]: "{",
      [CASH_POSITION_STORAGE_KEY]: "[]",
      [CHANGE_HISTORY_STORAGE_KEY]: JSON.stringify([{}]),
    };
    const issues = runIntegrityAudit(makeInput({ storage })).issues;

    expect(issues.filter((issue) => issue.category === "Local storage").map((issue) => issue.recordId)).toEqual([
      STORAGE_KEY,
      CASH_POSITION_STORAGE_KEY,
    ]);
    expect(issues.find((issue) => issue.category === "Change history")).toMatchObject({
      severity: "Material",
      recordTitle: "Event 1",
      reason: "Audit event has missing or invalid identity, timestamp, or field changes.",
    });
    expect(isValidChangeEvent({})).toBe(false);
  });

  it("distinguishes missing storage keys from explicitly null stores", () => {
    const storage = { ...makeInput().storage };
    delete storage[STORAGE_KEY];

    expect(runIntegrityAudit(makeInput({ storage })).issues[0]).toMatchObject({
      id: "integrity-1",
      severity: "Critical",
      category: "Local storage",
      recordId: STORAGE_KEY,
    });
    expect(runIntegrityAudit(makeInput()).issues).toEqual([]);
  });

  it("reports malformed financial commitments and their reference structure", () => {
    const input = makeInput({
      commitments: [makeCommitment({
        amount: "not numeric",
        type: "Unsupported",
        status: "Unsupported",
        actualPurchaseDate: "2026-10-01",
        actualPurchasePrice: "",
        relatedPillar: "Unknown area",
      })],
    });

    expect(runIntegrityAudit(input).issues.map(({ category, severity, reason }) => ({ category, severity, reason }))).toEqual([
      { category: "Finance structure", severity: "Material", reason: "Required amount is blank or not numeric." },
      { category: "Finance structure", severity: "Material", reason: "Status “Unsupported” is not a supported commitment status." },
      { category: "Finance structure", severity: "Warning", reason: "Type “Unsupported” is not a supported commitment type." },
      { category: "Finance structure", severity: "Material", reason: "Actual purchase date is recorded without an actual purchase price." },
      { category: "Finance structure", severity: "Warning", reason: "Related pillar “Unknown area” is outside the supported area list." },
    ]);
  });

  it("accepts valid cross-domain references without reporting relationship issues", () => {
    const person: IntegrityAuditPerson = { id: "person-1", name: "Alex", status: "Active" };
    const problem = makeProblem();
    const project = makeProject({ relatedActionIds: ["action-1"] });
    const action = makeAction({ owner: "Alex", ownerPersonId: person.id, relatedProblem: problem.id });

    const result = runIntegrityAudit(makeInput({ people: [person], problems: [problem], projects: [project], actions: [action] }));

    expect(result.issues).toEqual([]);
  });

  it("does not mutate records or the storage snapshot", () => {
    const input = makeInput({
      people: [{ id: "person-1", name: "Alex", status: "Active" }],
      captures: [{ id: "capture-1", title: "Capture", status: "Converted", reviewOutcome: "Convert to Action" }],
      actions: [makeAction({ sourceCaptureId: "missing-capture" })],
    });
    const { nowIso, ...dataBeforeAudit } = input;
    const before = structuredClone(dataBeforeAudit);

    runIntegrityAudit(input);

    const { nowIso: currentNowIso, ...dataAfterAudit } = input;
    expect(dataAfterAudit).toEqual(before);
    expect(currentNowIso).toBe(nowIso);
  });

  it("uses an injected timestamp deterministically", () => {
    const result = runIntegrityAudit(makeInput({ nowIso: () => "2001-02-03T04:05:06.000Z" }));

    expect(result.auditedAt).toBe("2001-02-03T04:05:06.000Z");
  });
});
