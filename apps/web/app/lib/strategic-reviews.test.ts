import { describe, expect, it } from "vitest";
import type { ProjectRecord } from "./projects";
import { isValidCalendarDateInput } from "./dates";
import { buildOrganisationalLearning, type OrganisationalLearningInput } from "./organisational-learning";
import { buildLearningAttention } from "./learning-attention";
import {
  applyStrategicReviewTransition,
  buildStrategicReviewLiveEvidence,
  isStrategicObjectiveRecord,
  isStrategicReview,
  reviewContradictions,
  reviewGapCandidates,
  reviewShapeIssues,
  validateStrategicReviewApplication,
  type ReviewEvidence,
  type StrategicAssessment,
  type StrategicObjective,
  type StrategicReview,
} from "./strategic-reviews";

function makeObjective(overrides: Partial<StrategicObjective> = {}): StrategicObjective {
  return {
    id: "objective-1",
    title: "Improve delivery reliability",
    pillar: "Operating Business",
    horizon: "Now",
    importance: "High",
    status: "Active",
    founderAllocation: "Founder attention now",
    owner: "",
    whyItMatters: "",
    successCondition: "",
    linkedProjectIds: [],
    linkedOpportunityIds: [],
    linkedDecisionIds: [],
    createdAt: "2026-10-01T12:00:00.000Z",
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
    realitySummary: "Reality checked",
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
    createdAt: "2026-10-01T12:00:00.000Z",
    appliedAt: null,
    supersededAt: null,
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "project-1",
    projectName: "Improve handover",
    owner: "Founder",
    area: "Operating Business",
    startDate: "2026-10-01",
    targetCompletionDate: "2026-10-15",
    status: "In Progress",
    ...overrides,
  };
}

function makeAssessment(objective: StrategicObjective): StrategicAssessment {
  return {
    objective,
    linkedProjects: [],
    linkedOpportunities: [],
    linkedDecisions: [],
    gaps: [],
    hasExecutablePath: false,
  };
}

function makeEvidence(): ReviewEvidence {
  return {
    capturedAt: "2026-10-01T12:00:00.000Z",
    objectives: [],
    projects: [],
    opportunities: [],
    problems: [],
    founderDependency: "",
    finance: "",
    execution: "",
  };
}

function learningRecords(overrides: Partial<OrganisationalLearningInput> = {}): OrganisationalLearningInput {
  return {
    actions: [], projects: [], decisions: [], lessons: [], problems: [], systems: [], sops: [],
    ...overrides,
  };
}

function learningLesson(status: "New" | "Reviewed" | "Implemented" | "Change Required" = "Reviewed") {
  return {
    id: "lesson-1", title: "Recorded lesson", lessonTitle: "", status,
    description: "  Original learning evidence.\nRetain wording.  ",
    recommendedChange: "Historical recommendation", relatedProblem: "",
    relatedProject: "", relatedDecision: "", relatedSystem: "",
  };
}

function learningProblem(frequency = "Recurring", isUnresolved = true) {
  return {
    id: "problem-1", title: "Recorded problem", problemStatement: "", frequency,
    severity: "High", problemStatus: isUnresolved ? "Open" : "Resolved", owner: "", isUnresolved,
  };
}

describe("Strategic Review live learning evidence", () => {
  it("preserves existing evidence and review gaps when learning is absent, empty or non-qualifying", () => {
    const evidence = makeEvidence();
    const signals = buildOrganisationalLearning(learningRecords({
      lessons: [learningLesson("New")],
      actions: [{
        id: "action-1", title: "Action", actionTitle: "", status: "Completed", completionEvidence: "Done",
      }],
    }));
    expect(buildStrategicReviewLiveEvidence(evidence)).toEqual(evidence);
    expect(buildStrategicReviewLiveEvidence(evidence, [])).toEqual(evidence);
    expect(buildStrategicReviewLiveEvidence(evidence, signals)).toEqual(evidence);
    expect(buildStrategicReviewLiveEvidence(evidence, signals)).not.toHaveProperty("learning");
    const review = makeReview();
    const assessments = [makeAssessment(makeObjective())];
    const gaps = reviewGapCandidates(review, assessments, [], [], [], () => false);
    const before = structuredClone(review);
    buildStrategicReviewLiveEvidence(evidence, signals);
    expect(reviewGapCandidates(review, assessments, [], [], [], () => false)).toEqual(gaps);
    expect(review).toEqual(before);
  });

  it("does not promote identified narrative learning to captured learning or operational attention", () => {
    const signals = buildOrganisationalLearning(learningRecords({
      decisions: [{
        id: "decision-1", title: "Decision", decisionTitle: "", decisionStatus: "Completed",
        actualOutcome: "Recorded outcome", outcomeRating: "Failed",
        lessons: "Possible recurring root cause; change the system",
      }],
    }));
    expect(signals[0].learningState).toBe("Learning identified");
    expect(buildStrategicReviewLiveEvidence(makeEvidence(), signals)).not.toHaveProperty("learning");
  });

  it.each(["Reviewed", "Implemented"] as const)(
    "preserves meaningful %s learning without interpreting historical recommendations as outstanding work",
    (status) => {
      const signals = buildOrganisationalLearning(learningRecords({ lessons: [learningLesson(status)] }));
      const result = buildStrategicReviewLiveEvidence(makeEvidence(), signals);
      expect(result.learning).toEqual(signals);
      expect(result.learning?.[0]).toMatchObject({
        sourceType: "Lesson", sourceId: "lesson-1", sourceTitle: "Recorded lesson",
        learningState: "Meaningful learning captured", outcomeState: "Missing evidence",
        recurrenceState: "Unknown", linkedLessonIds: ["lesson-1"],
        recommendedNextTransition: "Review existing Lesson",
      });
      expect(buildLearningAttention(signals.map((signal) => ({ signal })))).toEqual([]);
      expect(result.learning?.[0].evidence).toContainEqual({
        sourceType: "Lesson", sourceId: "lesson-1", field: "description",
        value: "  Original learning evidence.\nRetain wording.  ",
      });
    },
  );

  it.each(["Worked", "Partially worked", "Failed"])(
    "does not turn %s outcome-only evidence into strategic learning",
    (outcomeRating) => {
      const signals = buildOrganisationalLearning(learningRecords({
        decisions: [{
          id: "decision-1", title: "Recurring root cause", decisionTitle: "",
          decisionStatus: "Completed", actualOutcome: "Institutionalised successfully",
          outcomeRating, lessons: "",
        }],
      }));
      expect(buildStrategicReviewLiveEvidence(makeEvidence(), signals)).toEqual(makeEvidence());
    },
  );

  it("uses the existing attention gate for authoritative unresolved recurrence rather than classifying wording", () => {
    const signals = buildOrganisationalLearning(learningRecords({
      problems: [
        learningProblem(), { ...learningProblem("Persistent"), id: "persistent" },
        { ...learningProblem("recurring"), id: "lowercase", title: "Persistent root cause" },
        { ...learningProblem("One-off"), id: "one-off" },
        { ...learningProblem("Recurring", false), id: "resolved" },
      ],
    }));
    const qualifying = buildLearningAttention(signals.map((signal) => ({ signal })));
    const result = buildStrategicReviewLiveEvidence(makeEvidence(), signals);
    expect(result.learning?.map(({ sourceId }) => sourceId)).toEqual(qualifying.map(({ sourceId }) => sourceId));
    expect(result.learning?.map(({ sourceId }) => sourceId)).toEqual(["problem-1", "persistent"]);
    expect(result.learning).toEqual(signals.slice(0, 2));
    const unknown = { ...signals[0], recurrenceState: "Unknown" as const };
    expect(buildStrategicReviewLiveEvidence(makeEvidence(), [unknown])).not.toHaveProperty("learning");
  });

  it.each(["Draft", "Active"] as const)(
    "preserves only the producer-established institutionalisation state with a %s linked System",
    (status) => {
      const signals = buildOrganisationalLearning(learningRecords({
        problems: [learningProblem()],
        lessons: [{ ...learningLesson("Implemented"), relatedProblem: "problem-1" }],
        systems: [{ id: "system-1", relatedLesson: "lesson-1", status }],
      }));
      const result = buildStrategicReviewLiveEvidence(makeEvidence(), signals);
      expect(result.learning).toEqual(signals);
      expect(result.learning?.find(({ sourceType }) => sourceType === "Problem")).toMatchObject({
        recurrenceState: status === "Active" ? "Institutionalised" : "Recorded recurrence",
        recommendedNextTransition: status === "Active" ? "Investigate recurrence" : "Consider System/SOP change",
        linkedLessonIds: ["lesson-1"],
      });
    },
  );

  it("includes explicit Change Required evidence through the gate without redefining meaningful Lesson statuses", () => {
    const signals = buildOrganisationalLearning(learningRecords({ lessons: [learningLesson("Change Required")] }));
    expect(signals[0].learningState).toBe("Lesson available");
    expect(buildStrategicReviewLiveEvidence(makeEvidence(), signals).learning).toEqual(signals);
  });

  it("preserves linked source identity, outcome, ordering and transitions deterministically without mutating frozen inputs", () => {
    const signals = buildOrganisationalLearning(learningRecords({
      decisions: [{
        id: "decision-1", title: "Decision", decisionTitle: "",
        decisionStatus: "Completed", actualOutcome: "Source outcome", outcomeRating: "Worked", lessons: "",
      }],
      lessons: [{ ...learningLesson(), relatedDecision: "decision-1" }],
    }));
    const evidence = makeEvidence();
    const before = structuredClone({ evidence, signals });
    function freeze(value: unknown): void {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    }
    freeze(evidence);
    freeze(signals);
    const first = buildStrategicReviewLiveEvidence(evidence, signals);
    expect(buildStrategicReviewLiveEvidence(evidence, signals)).toEqual(first);
    expect(first.learning).toEqual(signals);
    expect(first.learning?.[0]).toMatchObject({
      sourceType: "Decision", sourceId: "decision-1", sourceTitle: "Decision",
      outcomeState: "Worked", learningState: "Meaningful learning captured",
      linkedLessonIds: ["lesson-1"], recommendedNextTransition: "Review existing Lesson",
    });
    expect(first.learning?.[0]).not.toBe(signals[0]);
    expect(first.learning?.[0].evidence[0]).not.toBe(signals[0].evidence[0]);
    expect(first.learning?.[0].linkedLessonIds).not.toBe(signals[0].linkedLessonIds);
    expect(Object.keys(first.learning?.[0] ?? {}).sort()).toEqual(Object.keys(signals[0]).sort());
    for (const field of ["priorityScore", "attentionRank", "tieWeight", "strategicPriority", "probability"]) {
      expect(first.learning?.[0]).not.toHaveProperty(field);
    }
    expect({ evidence, signals }).toEqual(before);
    expect(evidence).not.toHaveProperty("learning");
    expect(isStrategicReview(makeReview({ evidenceSnapshot: evidence }))).toBe(true);
  });
});

describe("strategic stored-record validation", () => {
  it("accepts valid objective and legacy-shaped draft records without rewriting them", () => {
    const objective = makeObjective();
    const legacyDraft = JSON.parse(JSON.stringify(makeReview())) as unknown;

    expect(isStrategicObjectiveRecord(objective)).toBe(true);
    expect(isStrategicReview(legacyDraft)).toBe(true);
    expect(reviewShapeIssues(legacyDraft)).toEqual([]);
    expect(isStrategicReview({ ...(legacyDraft as object), legacyNote: "retained" })).toBe(true);
  });

  it("reports invalid review dates and malformed stored sections", () => {
    const issues = reviewShapeIssues(
      makeReview({ reviewDate: "2026-02-30", constraints: null as unknown as StrategicReview["constraints"] }),
    );

    expect(issues).toContain("Invalid reviewDate.");
    expect(issues).toContain("Malformed constraints.");
    expect(isStrategicReview(makeReview({ stage: 12 }))).toBe(false);
  });
});

describe("calendar date input validation", () => {
  it("accepts valid leap dates and surrounding whitespace", () => {
    expect(isValidCalendarDateInput("2024-02-29")).toBe(true);
    expect(isValidCalendarDateInput(" 2026-10-01 ")).toBe(true);
  });

  it("rejects impossible dates and unsupported formats", () => {
    expect(isValidCalendarDateInput("2026-02-29")).toBe(false);
    expect(isValidCalendarDateInput("2026-13-01")).toBe(false);
    expect(isValidCalendarDateInput("2026-1-01")).toBe(false);
  });
});

describe("review gap inference", () => {
  it("identifies missing execution and founder outcomes while preserving prior dispositions", () => {
    const objective = makeObjective();
    const review = makeReview({
      strategicGaps: [{
        id: "execution:objective-1",
        type: "Execution Gap",
        description: "Prior description",
        evidence: "Prior evidence",
        objectiveIds: [objective.id],
        proposedResponse: "Prior response",
        disposition: "Monitor",
        rationale: "Revisit next week",
      }],
    });

    const gaps = reviewGapCandidates(review, [makeAssessment(objective)], [], [], [], () => false);

    expect(gaps.map((gap) => gap.id)).toEqual(["execution:objective-1", "founder:objective-1"]);
    expect(gaps[0]).toMatchObject({ disposition: "Monitor", rationale: "Revisit next week" });
    expect(gaps[1]).toMatchObject({ type: "Decision Gap", disposition: "", objectiveIds: [objective.id] });
  });
});

describe("review contradiction inference", () => {
  it("reports capacity and acceleration conflicts while retaining founder overrides", () => {
    const project = makeProject();
    const review = makeReview({
      projectJudgements: [{
        projectId: project.id,
        objectiveIds: [],
        evidence: "",
        recommendation: "",
        counterfactual: "No — not now",
        disposition: "Accelerate",
        rationale: "",
        justification: "",
      }],
      founderAllocation: ["one", "two"].map((id) => ({
        id,
        outcome: `Outcome ${id}`,
        objectiveIds: [],
        whyNow: "Now",
        whyFounder: "Founder decision",
        costOfDelay: "",
        dependencyUnlocked: "",
        uncertainty: "",
        allocation: "Primary" as const,
      })),
      contradictions: [{
        id: `project:${project.id}:path`,
        description: "Existing note",
        blocking: true,
        overrideRationale: "Founder accepted the risk",
      }],
    });

    const contradictions = reviewContradictions(
      review,
      [],
      [project],
      [],
      [{
        id: `accelerate:${project.id}`,
        type: "Execution Gap",
        description: "No linked action",
        evidence: "",
        objectiveIds: [],
        proposedResponse: "",
        disposition: "",
        rationale: "",
      }],
      () => false,
    );

    expect(contradictions.map((entry) => entry.id)).toContain("allocation:capacity");
    expect(contradictions.map((entry) => entry.id)).toContain(`project:${project.id}:counterfactual`);
    expect(contradictions.map((entry) => entry.id)).toContain(`project:${project.id}:alignment`);
    expect(contradictions.find((entry) => entry.id === `project:${project.id}:path`)?.overrideRationale).toBe("Founder accepted the risk");
  });
});

describe("review application preflight", () => {
  it("preserves the ordered validation messages", () => {
    const draft = makeReview({
      realitySummary: "",
      nextReviewDate: "2026-10-01",
      constraints: [{ id: "constraint-1", description: "", evidence: "", objectiveIds: [], recommendation: "", decision: "", founderRationale: "", response: "" }],
      opportunities: [{ id: "opportunity-1", opportunityId: "", title: "", relevance: "", evidence: "", recommendation: "", decision: "", founderRationale: "" }],
      assumptions: [{ id: "assumption-1", statement: "", confidence: "Low", supportingEvidence: "", contraryEvidence: "", invalidationCondition: "", needsTesting: true, founderNote: "" }],
      projectJudgements: [{ projectId: "project-1", objectiveIds: [], evidence: "", recommendation: "", counterfactual: "", disposition: "", rationale: "", justification: "" }],
      founderAllocation: ["primary-1", "primary-2"].map((id) => ({ id, outcome: "Outcome", objectiveIds: [], whyNow: "Now", whyFounder: "Founder", costOfDelay: "", dependencyUnlocked: "", uncertainty: "", allocation: "Primary" as const })),
      notPrioritising: [{ id: "exclude-1", item: "", whyNotNow: "", reconsiderWhen: "" }],
    });
    const appliedReview = makeReview({ id: "applied-1", status: "Applied" });
    const secondAppliedReview = makeReview({ id: "applied-2", status: "Applied" });
    const objective = makeObjective();
    const project = makeProject();

    const result = validateStrategicReviewApplication({
      draft,
      assessments: [],
      objectives: [objective],
      reviews: [appliedReview, secondAppliedReview],
      projects: [project],
      activeProjects: [project],
      opportunities: [],
      actions: [],
      executableAction: () => false,
    });

    expect(result.errors).toEqual([
      "Save this Draft before applying.",
      "Record what changed in reality.",
      "Choose a future next review date after the review period starts.",
      "Multiple current Applied reviews must be reconciled first.",
      "Review each constraint and record its evidence.",
      "Disposition every strategic Opportunity.",
      "Complete assumptions and testing conditions.",
      "Complete the blank-sheet reconstruction and compare each candidate to existing work.",
      "Confirm every Active or Watching objective with a rationale.",
      "Answer the counterfactual and disposition every active Project.",
      "Describe, evidence, disposition and explain every strategic gap.",
      "Set one Primary, at most two Secondary and one Reserve outcome with founder rationale.",
      "Complete all recorded exclusions.",
      "Resolve blocking contradictions or record an explicit founder override rationale.",
    ]);
  });
});

describe("review application transitions", () => {
  it("applies objective decisions and supersedes the previous applied review", () => {
    const draft = makeReview({
      objectiveJudgements: [
        { objectiveId: "pause", evidence: "", recommendation: "", decision: "Pause", horizon: "Now", importance: "High", founderAllocation: "Monitor", rationale: "" },
        { objectiveId: "achieve", evidence: "", recommendation: "", decision: "Achieve", horizon: "Now", importance: "High", founderAllocation: "Monitor", rationale: "" },
        { objectiveId: "modify", evidence: "", recommendation: "", decision: "Modify", horizon: "Next", importance: "Critical", founderAllocation: "Founder attention now", rationale: "" },
        { objectiveId: "keep", evidence: "", recommendation: "", decision: "Keep", horizon: "Now", importance: "High", founderAllocation: "Monitor", rationale: "" },
      ],
    });
    const existingApplied = makeReview({ id: "previous", status: "Applied", appliedAt: "2026-09-01T00:00:00.000Z" });
    const otherDraft = makeReview({ id: "other-draft" });
    const objectives = [
      makeObjective({ id: "pause" }),
      makeObjective({ id: "achieve" }),
      makeObjective({ id: "modify" }),
      makeObjective({ id: "keep" }),
      makeObjective({ id: "untouched" }),
    ];
    const evidenceSnapshot = makeEvidence();

    const result = applyStrategicReviewTransition({
      draft,
      reviews: [draft, existingApplied, otherDraft],
      objectives,
      reviewedGaps: [],
      contradictions: [],
      evidenceSnapshot,
      appliedAt: "2026-10-01T15:00:00.000Z",
    });

    expect(result.nextObjectives.map(({ id, status, horizon, importance, founderAllocation }) => ({ id, status, horizon, importance, founderAllocation }))).toEqual([
      { id: "pause", status: "Paused", horizon: "Now", importance: "High", founderAllocation: "Founder attention now" },
      { id: "achieve", status: "Achieved", horizon: "Now", importance: "High", founderAllocation: "Founder attention now" },
      { id: "modify", status: "Active", horizon: "Next", importance: "Critical", founderAllocation: "Founder attention now" },
      { id: "keep", status: "Active", horizon: "Now", importance: "High", founderAllocation: "Founder attention now" },
      { id: "untouched", status: "Active", horizon: "Now", importance: "High", founderAllocation: "Founder attention now" },
    ]);
    expect(result.appliedReview).toMatchObject({ status: "Applied", evidenceSnapshot, appliedAt: "2026-10-01T15:00:00.000Z" });
    expect(result.nextReviews.map(({ id, status, supersededAt }) => ({ id, status, supersededAt }))).toEqual([
      { id: "review-1", status: "Applied", supersededAt: null },
      { id: "previous", status: "Superseded", supersededAt: "2026-10-01T15:00:00.000Z" },
      { id: "other-draft", status: "Draft", supersededAt: null },
    ]);
  });
});
