export type RecurringProblemMaturity = "missing" | "captured" | "institutionalised";

export type RecurringProblemInput = {
  id: string;
  frequency: string;
  severity: string;
  problemStatus: string;
  problemStatement: string;
  title: string;
  owner: string;
  relatedPillar?: string;
  relatedArea?: string;
  area?: string;
  isUnresolved: boolean;
};

export type RecurringProblemLessonInput = {
  id: string;
  relatedProblem: string;
  relatedSystem?: string;
  status: string;
};

export type RecurringProblemSystemInput = {
  id: string;
  relatedLesson: string;
  status: string;
};

export type RecurringProblemSopInput = {
  relatedLesson: string;
  relatedSystem: string;
  status: string;
};

export type RecurringProblemLearningInput = {
  learningValidity?: ReadonlyMap<string, { validated: boolean; institutionalised: boolean }>;
  problems: readonly RecurringProblemInput[];
  lessons: readonly RecurringProblemLessonInput[];
  systems: readonly RecurringProblemSystemInput[];
  sops: readonly RecurringProblemSopInput[];
};

export type RecurringProblemLearningGap = {
  id: string;
  objectType: "Problem";
  title: string;
  frequency: string;
  severity: string;
  status: string;
  area: string;
  owner: string;
};

export type RecurringProblemLearningResult = {
  unresolvedRecurring: RecurringProblemInput[];
  gaps: RecurringProblemLearningGap[];
  maturityByProblemId: Map<string, RecurringProblemMaturity>;
  capturedNotInstitutionalised: number;
  closedInstitutionalised: number;
};

const recurringFrequencies = ["Recurring", "Persistent"];
const meaningfulLessonStatuses = ["Reviewed", "Implemented"];
const institutionalStatuses = ["Active", "Reviewing"];

export function buildRecurringProblemLearning(
  input: RecurringProblemLearningInput,
): RecurringProblemLearningResult {
  const recurringProblems = input.problems.filter((problem) => recurringFrequencies.includes(problem.frequency));
  const unresolvedRecurring = recurringProblems.filter((problem) => problem.isUnresolved);
  const maturityFor = (problem: RecurringProblemInput): RecurringProblemMaturity => {
    const linkedLessons = input.lessons.filter((lesson) => lesson.relatedProblem === problem.id);
    const meaningfulLessons = linkedLessons.filter((lesson) => input.learningValidity?.has(lesson.id)
      ? input.learningValidity.get(lesson.id)!.validated : meaningfulLessonStatuses.includes(lesson.status));

    if (meaningfulLessons.length === 0) {
      return "missing";
    }

    if (meaningfulLessons.some((lesson) => input.learningValidity?.get(lesson.id)?.institutionalised)) return "institutionalised";
    const legacyLessons = meaningfulLessons.filter((lesson) => !input.learningValidity?.has(lesson.id));
    const meaningfulLessonIds = new Set(legacyLessons.map((lesson) => lesson.id));
    const linkedSystemIdsFromLessons = new Set(legacyLessons.map((lesson) => lesson.relatedSystem).filter(Boolean));
    const activeLinkedSystems = input.systems.filter((system) =>
      institutionalStatuses.includes(system.status) &&
      (meaningfulLessonIds.has(system.relatedLesson) || linkedSystemIdsFromLessons.has(system.id)),
    );
    const activeLinkedSystemIds = new Set(activeLinkedSystems.map((system) => system.id));
    const hasActiveLinkedSop = input.sops.some((sop) =>
      institutionalStatuses.includes(sop.status) &&
      (meaningfulLessonIds.has(sop.relatedLesson) || activeLinkedSystemIds.has(sop.relatedSystem)),
    );

    if (activeLinkedSystems.length > 0 || hasActiveLinkedSop) {
      return "institutionalised";
    }

    return "captured";
  };

  const maturityRecords = recurringProblems.map((problem) => ({
    problem,
    maturity: maturityFor(problem),
  }));
  const maturityByProblemId = new Map(maturityRecords.map(({ problem, maturity }) => [problem.id, maturity]));
  const gaps = maturityRecords
    .filter(({ problem, maturity }) => problem.isUnresolved && maturity === "missing")
    .map(({ problem }) => ({
      id: problem.id,
      objectType: "Problem" as const,
      title: problem.problemStatement || problem.title,
      frequency: problem.frequency,
      severity: problem.severity,
      status: problem.problemStatus,
      area: problem.relatedPillar || problem.relatedArea || problem.area || "Unassigned",
      owner: problem.owner || "Unassigned",
    }));
  const capturedNotInstitutionalised = maturityRecords.filter(({ problem, maturity }) =>
    problem.isUnresolved && maturity === "captured",
  ).length;
  const closedInstitutionalised = maturityRecords.filter(({ problem, maturity }) =>
    !problem.isUnresolved && maturity === "institutionalised",
  ).length;

  return {
    unresolvedRecurring,
    gaps,
    maturityByProblemId,
    capturedNotInstitutionalised,
    closedInstitutionalised,
  };
}