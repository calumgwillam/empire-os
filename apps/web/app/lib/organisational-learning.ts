import type { ActionRecord, DecisionRecord, LessonRecord } from "./capture-conversions";
import { getIcarusTreatmentOutcomeEvidenceKey, type IcarusTreatmentOutcomeRecord } from "./icarus";
import type { ProjectRecord } from "./projects";
import type { IcarusStrategicLifecycleIndex } from "./icarus-strategic-lifecycle";
import type { IcarusLearningIndex, IcarusLessonLearningView } from "./icarus-learning";
import {
  buildRecurringProblemLearning,
  type RecurringProblemLearningInput,
} from "./recurring-problem-learning";

export type LearningSourceType = "Action" | "Project" | "Decision" | "Lesson" | "Problem" | "Icarus Treatment" | "Icarus Lifecycle";
export type LearningOutcomeState = "Missing evidence" | "Unknown" | "Worked" | "Partially worked" | "Failed";
export type LearningState =
  | "Unknown"
  | "No meaningful learning recorded"
  | "Learning identified"
  | "Lesson available"
  | "Meaningful learning captured";
export type LearningRecurrenceState = "Unknown" | "Recorded recurrence" | "Institutionalised";
export type LearningExecutionState =
  | "Unknown"
  | "No execution path"
  | "Active execution"
  | "Blocked execution"
  | "Completed execution"
  | "Cancelled execution";
export type LearningNextTransition =
  | "No learning required"
  | "Review learning"
  | "Create/link Lesson"
  | "Review existing Lesson"
  | "Consider System/SOP change"
  | "Investigate recurrence";

export type LearningEvidenceField =
  | "status" | "completionEvidence" | "lastReviewedDate" | "reviewOutcome"
  | "followUpDate" | "followUpOwnerPersonId" | "followUpNote"
  | "lastReviewOutcome" | "reviewOwnerPersonId" | "reviewNote" | "nextReviewDate"
  | "decisionStatus" | "executionState" | "actualOutcome" | "outcomeRating" | "lessons"
  | "description" | "recommendedChange" | "relatedProblem" | "relatedProject"
  | "relatedDecision" | "relatedSystem" | "frequency" | "problemStatus" | "isUnresolved"
  | "treatmentTargetId" | "treatmentOutcome" | "verifiedAt" | "verifiedByPersonId"
  | "evidenceReference" | "verificationNote"
  | "interventionDecisionId" | "interventionOptionId" | "causeId" | "verificationCurrency"
  | "interventionAttribution" | "treatmentAttribution"
  | "assessmentId" | "resolutionReviewId" | "regressionId" | "lifecycleValidity" | "humanExplanation";

export type LearningEvidence = {
  sourceType: LearningSourceType;
  sourceId: string;
  field: LearningEvidenceField;
  value: string;
};

export type LearningSignal = {
  sourceType: LearningSourceType;
  sourceId: string;
  sourceTitle: string;
  executionState: LearningExecutionState;
  outcomeState: LearningOutcomeState;
  learningState: LearningState;
  recurrenceState: LearningRecurrenceState;
  evidence: LearningEvidence[];
  linkedLessonIds: string[];
  recommendedNextTransition: LearningNextTransition;
  icarusLearning?: IcarusLessonLearningView;
  icarusObservation?: "Observed";
};

export type LearningActionInput = Pick<ActionRecord,
  "id" | "title" | "actionTitle" | "status" | "completionEvidence"
  | "lastReviewedDate" | "reviewOutcome" | "followUpDate"
  | "followUpOwnerPersonId" | "followUpNote">;
export type LearningProjectInput = Pick<ProjectRecord,
  "id" | "projectName" | "status" | "lastReviewedDate" | "lastReviewOutcome"
  | "reviewOwnerPersonId" | "reviewNote" | "nextReviewDate">;
export type LearningDecisionInput = Pick<DecisionRecord,
  "id" | "title" | "decisionTitle" | "decisionStatus" | "actualOutcome" | "outcomeRating" | "lessons">
  & { executionState?: Exclude<LearningExecutionState, "Unknown" | "Cancelled execution"> };
export type LearningLessonInput = Pick<LessonRecord,
  "id" | "title" | "lessonTitle" | "description" | "status" | "recommendedChange"
  | "relatedProblem" | "relatedProject" | "relatedDecision" | "relatedSystem">;

export type OrganisationalLearningInput = {
  icarusLifecycle?: IcarusStrategicLifecycleIndex;
  icarusLearning?: IcarusLearningIndex;
  actions: readonly LearningActionInput[];
  projects: readonly LearningProjectInput[];
  decisions: readonly LearningDecisionInput[];
  lessons: readonly LearningLessonInput[];
  problems: RecurringProblemLearningInput["problems"];
  systems: RecurringProblemLearningInput["systems"];
  sops: RecurringProblemLearningInput["sops"];
  icarusTreatmentOutcomes?: readonly {
    targetTitle: string;
    record: IcarusTreatmentOutcomeRecord;
    treatmentEvidence?: {
      current: boolean;
      attribution: "Supported" | "Uncertain" | "Not attributable";
    };
    interventionContext?: {
      decisionIds: readonly string[];
      optionIds: readonly string[];
      causeIds: readonly string[];
      lessonIds: readonly string[];
      current: boolean;
    };
  }[];
};

function executionState(status: string, isProject = false): LearningExecutionState {
  const value = isProject ? status.trim().toLowerCase() : status;
  if ((isProject ? ["completed", "closed", "final"] : ["Completed"]).includes(value)) return "Completed execution";
  if ((isProject ? ["cancelled", "canceled"] : ["Cancelled"]).includes(value)) return "Cancelled execution";
  if (value === (isProject ? "blocked" : "Blocked")) return "Blocked execution";
  if ((isProject ? ["open", "in progress", "waiting"] : ["Open", "In Progress", "Waiting"]).includes(value)) return "Active execution";
  return "Unknown";
}

function meaningfulLesson(lesson: LearningLessonInput): boolean {
  return lesson.status === "Reviewed" || lesson.status === "Implemented";
}

function decisionOutcome(decision: LearningDecisionInput): LearningOutcomeState {
  if (!decision.actualOutcome.trim()) return "Missing evidence";
  switch (decision.outcomeRating) {
    case "Worked":
    case "Partially worked":
    case "Failed":
      return decision.outcomeRating;
    default:
      return "Unknown";
  }
}

// Reviews and completion evidence do not, on their own, establish outcome quality.
export function buildOrganisationalLearning(input: OrganisationalLearningInput): LearningSignal[] {
  const recurrence = buildRecurringProblemLearning({ ...input, learningValidity: input.icarusLearning?.maturityByLessonId });
  const meaningful = (lesson: LearningLessonInput) => input.icarusLearning?.maturityByLessonId.has(lesson.id)
    ? input.icarusLearning.maturityByLessonId.get(lesson.id)!.validated : meaningfulLesson(lesson);
  const signals: LearningSignal[] = [];

  function signal(
    sourceType: LearningSourceType,
    sourceId: string,
    sourceTitle: string,
    execution: LearningExecutionState,
    fields: readonly (readonly [LearningEvidenceField, string | undefined])[],
    lessons: readonly LearningLessonInput[] = [],
  ): LearningSignal {
    const evidence = fields
      .filter((entry): entry is readonly [LearningEvidenceField, string] => typeof entry[1] === "string" && entry[1].trim() !== "")
      .map(([field, value]) => ({ sourceType, sourceId, field, value }));
    lessons.forEach((lesson) => {
      evidence.push({ sourceType: "Lesson", sourceId: lesson.id, field: "status", value: lesson.status });
    });
    return {
      sourceType, sourceId, sourceTitle, executionState: execution,
      outcomeState: "Missing evidence",
      learningState: lessons.some(meaningful)
        ? "Meaningful learning captured"
        : lessons.length > 0 ? "Lesson available" : "Unknown",
      recurrenceState: "Unknown",
      evidence,
      linkedLessonIds: lessons.map(({ id }) => id),
      recommendedNextTransition: lessons.length > 0 ? "Review existing Lesson" : "Review learning",
    };
  }

  input.actions.forEach((action) => {
    signals.push(signal("Action", action.id, action.actionTitle || action.title, executionState(action.status), [
      ["status", action.status], ["completionEvidence", action.completionEvidence],
      ["lastReviewedDate", action.lastReviewedDate], ["reviewOutcome", action.reviewOutcome],
      ["followUpDate", action.followUpDate], ["followUpOwnerPersonId", action.followUpOwnerPersonId],
      ["followUpNote", action.followUpNote],
    ]));
  });

  input.projects.forEach((project) => {
    signals.push(signal("Project", project.id, project.projectName, executionState(project.status, true), [
      ["status", project.status], ["lastReviewedDate", project.lastReviewedDate],
      ["lastReviewOutcome", project.lastReviewOutcome], ["reviewOwnerPersonId", project.reviewOwnerPersonId],
      ["reviewNote", project.reviewNote], ["nextReviewDate", project.nextReviewDate],
    ], input.lessons.filter((lesson) => lesson.relatedProject === project.id)));
  });

  input.decisions.forEach((decision) => {
    const item = signal("Decision", decision.id, decision.decisionTitle || decision.title,
      decision.executionState ?? "Unknown", [
        ["decisionStatus", decision.decisionStatus], ["executionState", decision.executionState],
        ["actualOutcome", decision.actualOutcome], ["outcomeRating", decision.outcomeRating],
        ["lessons", decision.lessons],
      ], input.lessons.filter((lesson) => lesson.relatedDecision === decision.id));
    item.outcomeState = decisionOutcome(decision);
    if (item.linkedLessonIds.length === 0) {
      if (decision.lessons.trim()) {
        item.learningState = "Learning identified";
        item.recommendedNextTransition = "Create/link Lesson";
      }
    }
    signals.push(item);
  });

  input.lessons.forEach((lesson) => {
    const item = signal("Lesson", lesson.id, lesson.lessonTitle || lesson.title, "Unknown", [
      ["status", lesson.status], ["description", lesson.description],
      ["recommendedChange", lesson.recommendedChange], ["relatedProblem", lesson.relatedProblem],
      ["relatedProject", lesson.relatedProject], ["relatedDecision", lesson.relatedDecision],
      ["relatedSystem", lesson.relatedSystem],
    ], [lesson]);
    const learning = input.icarusLearning?.byLessonId.get(lesson.id);
    if (learning?.reviews.length) item.icarusLearning = learning;
    signals.push(item);
  });

  (input.icarusTreatmentOutcomes ?? []).forEach(({ targetTitle, record, treatmentEvidence, interventionContext }) => {
    const recordedOutcome: LearningOutcomeState = record.outcome === "Effective" ? "Worked"
      : record.outcome === "Partially effective" ? "Partially worked"
        : record.outcome === "Ineffective" ? "Failed" : "Unknown";
    const outcomeState = treatmentEvidence?.current ? recordedOutcome : "Unknown";
    const sourceType: LearningSourceType = "Icarus Treatment";
    const linkedLessons = input.lessons.filter((lesson) => interventionContext?.lessonIds.includes(lesson.id));
    signals.push({
      sourceType,
      sourceId: record.id,
      sourceTitle: targetTitle,
      executionState: "Completed execution",
      outcomeState,
      learningState: linkedLessons.some(meaningful) ? "Meaningful learning captured"
        : linkedLessons.length ? "Lesson available" : "Learning identified",
      recurrenceState: "Unknown",
      evidence: [
        { sourceType, sourceId: record.id, field: "treatmentTargetId", value: record.treatmentTargetId },
        { sourceType, sourceId: record.id, field: "treatmentOutcome", value: record.outcome },
        { sourceType, sourceId: record.id, field: "verifiedAt", value: record.verifiedAt },
        { sourceType, sourceId: record.id, field: "verifiedByPersonId", value: record.verifiedByPersonId },
        { sourceType, sourceId: record.id, field: "verificationNote", value: record.verificationNote },
        { sourceType, sourceId: record.id, field: "verificationCurrency",
          value: treatmentEvidence?.current ? "Current" : "Historical / superseded or currency unknown" },
        { sourceType, sourceId: record.id, field: "treatmentAttribution",
          value: treatmentEvidence?.attribution ?? "Not attributable" },
        { sourceType, sourceId: record.id, field: "interventionAttribution",
          value: interventionContext?.current ? "Uncertain — current intervention context" : "Not attributable — historical or no intervention context" },
        ...record.evidence.map((entry) => ({
          sourceType,
          sourceId: record.id,
          field: "evidenceReference" as const,
          value: getIcarusTreatmentOutcomeEvidenceKey(entry),
        })),
        ...(interventionContext ? [
          ...interventionContext.decisionIds.map((value): LearningEvidence =>
            ({ sourceType, sourceId: record.id, field: "interventionDecisionId", value })),
          ...interventionContext.optionIds.map((value): LearningEvidence =>
            ({ sourceType, sourceId: record.id, field: "interventionOptionId", value })),
          ...interventionContext.causeIds.map((value): LearningEvidence =>
            ({ sourceType, sourceId: record.id, field: "causeId", value })),
        ] : []),
        ...linkedLessons.map((lesson): LearningEvidence =>
          ({ sourceType: "Lesson", sourceId: lesson.id, field: "status", value: lesson.status })),
      ],
      linkedLessonIds: linkedLessons.map((lesson) => lesson.id),
      recommendedNextTransition: linkedLessons.length ? "Review existing Lesson" : "Review learning",
      icarusObservation: "Observed",
    });
  });

  if (input.icarusLifecycle && !input.icarusLifecycle.hypothetical) {
    input.icarusLifecycle.byAssessmentId.forEach((history) => {
      history.regressions.forEach((regression) => {
        const sourceType: LearningSourceType = "Icarus Lifecycle";
        const origin = history.reviews.find((review) => review.record.id === regression.record.resolutionReviewId);
        signals.push({
          sourceType, sourceId: regression.record.id,
          sourceTitle: regression.valid ? "Human-confirmed regression after verified strategic resolution"
            : "Recorded regression observation with invalid references",
          executionState: "Unknown", outcomeState: "Unknown", learningState: "Learning identified",
          recurrenceState: regression.valid ? "Recorded recurrence" : "Unknown",
          evidence: [
            { sourceType, sourceId: regression.record.id, field: "assessmentId", value: history.assessmentId },
            { sourceType, sourceId: regression.record.id, field: "resolutionReviewId", value: regression.record.resolutionReviewId },
            { sourceType, sourceId: regression.record.id, field: "regressionId", value: regression.record.id },
            { sourceType, sourceId: regression.record.id, field: "verifiedAt", value: regression.record.confirmedAt },
            { sourceType, sourceId: regression.record.id, field: "lifecycleValidity",
              value: regression.valid ? origin?.validity ?? "Historical" : `Invalid references: ${regression.issues.join("; ")}` },
            { sourceType, sourceId: regression.record.id, field: "humanExplanation", value: regression.record.explanation },
            { sourceType, sourceId: regression.record.id, field: "verificationNote", value: regression.record.rationale },
            ...regression.record.causeIds.map((value): LearningEvidence =>
              ({ sourceType, sourceId: regression.record.id, field: "causeId", value })),
            ...regression.record.evidenceKeys.map((value): LearningEvidence =>
              ({ sourceType, sourceId: regression.record.id, field: "evidenceReference", value })),
            ...(regression.reResolutionReviewId ? [{ sourceType, sourceId: regression.record.id,
              field: "resolutionReviewId" as const, value: regression.reResolutionReviewId }] : []),
          ],
          linkedLessonIds: [],
          recommendedNextTransition: "Review learning",
          icarusObservation: "Observed",
        });
      });
    });
  }

  input.problems.forEach((problem) => {
    const item = signal("Problem", problem.id, problem.problemStatement || problem.title, "Unknown", [
      ["frequency", problem.frequency], ["problemStatus", problem.problemStatus],
      ["isUnresolved", String(problem.isUnresolved)],
    ], input.lessons.filter((lesson) => lesson.relatedProblem === problem.id));
    const maturity = recurrence.maturityByProblemId.get(problem.id);
    if (maturity !== undefined) {
      item.recurrenceState = maturity === "institutionalised" ? "Institutionalised" : "Recorded recurrence";
      if (problem.isUnresolved) {
        item.recommendedNextTransition = maturity === "captured"
          ? "Consider System/SOP change" : "Investigate recurrence";
      } else if (maturity === "institutionalised") {
        item.recommendedNextTransition = "Review learning";
      }
    }
    signals.push(item);
  });

  return signals;
}
