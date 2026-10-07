import {
  classifyIcarusEvidenceFreshness,
  getIcarusReferenceKey,
  type IcarusAssessmentRecord,
  type IcarusCauseRecord,
  type IcarusInterventionDecisionRecord,
  type IcarusInterventionEffect,
  type IcarusInterventionOption,
  type IcarusInterventionRelation,
  type IcarusInterventionScope,
  type IcarusSourceRecord,
  type IcarusTreatmentOutcomeRecord,
} from "./icarus";
import type { DecisionRecord, LessonRecord } from "./capture-conversions";
import type { IcarusTreatmentIndex, IcarusTreatmentTarget } from "./icarus-treatment";
import type { IcarusStrategicSignal } from "./icarus-strategic-attention";
import type { OrganisationalLearningInput } from "./organisational-learning";
import type { IcarusLifecycleAssessmentView, IcarusStrategicLifecycleIndex } from "./icarus-strategic-lifecycle";

export type IcarusInterventionReadiness =
  | "Not structured" | "Alternatives incomplete" | "Conflict" | "Prerequisites unmet"
  | "Ready for decision" | "Selected — unrouted" | "Executing"
  | "Awaiting verification" | "Outcome available" | "Superseded";

export type IcarusInterventionOutcome = {
  decisionId: string;
  optionId: string;
  causeIds: readonly string[];
  record: IcarusTreatmentOutcomeRecord;
  current: boolean;
  treatmentCurrent: boolean;
  postSelectionEvidence: boolean;
  treatmentAttribution: "Supported" | "Uncertain" | "Not attributable";
  // A treatment's control test supports that control, not causal success of the whole intervention.
  causalAttribution: "Uncertain" | "Not attributable";
};

export type IcarusInterventionLearning = {
  decisionId: string;
  lessonId: string;
  outcomeIds: readonly string[];
  causeIds: readonly string[];
  rationale: string;
  reviewed: boolean;
  currentEvidence: boolean;
  validLink: boolean;
};

export type IcarusInterventionDecisionView = {
  record: IcarusInterventionDecisionRecord;
  selectedOption?: IcarusInterventionOption;
  readiness: IcarusInterventionReadiness;
  issues: readonly string[];
  warnings: readonly string[];
  conflicts: readonly string[];
  unmetPrerequisites: readonly string[];
  targets: readonly IcarusTreatmentTarget[];
  outcomes: readonly IcarusInterventionOutcome[];
  priorOutcomes: readonly IcarusInterventionOutcome[];
  priorEffects: readonly IcarusInterventionEffect[];
  learning: readonly IcarusInterventionLearning[];
  lifecycleHistory: readonly IcarusLifecycleAssessmentView[];
};

export type IcarusInterventionIndex = {
  causes: readonly IcarusCauseRecord[];
  decisions: readonly IcarusInterventionDecisionView[];
  byAssessmentId: ReadonlyMap<string, readonly IcarusInterventionDecisionView[]>;
  byCauseId: ReadonlyMap<string, readonly IcarusInterventionDecisionView[]>;
  attentionByAssessmentId: ReadonlyMap<string, readonly string[]>;
  learningInput: NonNullable<OrganisationalLearningInput["icarusTreatmentOutcomes"]>;
  lifecycle?: IcarusStrategicLifecycleIndex;
};

export type IcarusInterventionIndexInput = {
  assessments: readonly IcarusAssessmentRecord[];
  treatment: IcarusTreatmentIndex;
  signals: readonly IcarusStrategicSignal[];
  sources: readonly IcarusSourceRecord[];
  decisions: readonly Pick<DecisionRecord, "id" | "decisionStatus">[];
  lessons: readonly Pick<LessonRecord, "id" | "status">[];
  people: readonly { id: string; status: string }[];
  nowMs: number;
  lifecycle?: IcarusStrategicLifecycleIndex;
};

export function emptyIcarusInterventionScope(assessmentId?: string): IcarusInterventionScope {
  return {
    assessmentIds: assessmentId ? [assessmentId] : [],
    failureModes: [], dependencyReferences: [], objectiveIds: [], pillarIds: [],
  };
}

export function selectIcarusInterventionOption(
  decision: IcarusInterventionDecisionRecord,
  optionId: string,
  rationale: string,
  personId: string,
  at: string,
  eventId: string,
): IcarusInterventionDecisionRecord {
  const option = decision.options.find((entry) => entry.id === optionId);
  if (decision.status === "Superseded" || decision.options.filter((entry) => entry.id === optionId).length !== 1
    || !option || option.status !== "Candidate"
    || !option.intent || !option.scope || !option.character || !option.causeIds.length
    || !option.description.trim() || !rationale.trim() || !personId.trim() || !eventId.trim()
    || decision.selectionHistory.some((event) => event.id === eventId)
    || Number.isNaN(Date.parse(at)) || Date.parse(at) < Date.parse(decision.createdAt)
    || decision.selectionHistory.some((event) => Date.parse(event.selectedAt) > Date.parse(at))) {
    throw new Error("Selecting an intervention requires a described, classified candidate, rationale, Person identity and valid date.");
  }
  return {
    ...decision,
    selectedOptionId: optionId,
    status: "Recorded",
    rationale: rationale.trim(),
    updatedAt: at,
    updatedByPersonId: personId,
    options: decision.options.map((entry) => entry.id === decision.selectedOptionId && entry.id !== optionId
      ? { ...entry, status: "Superseded", rationale: `Selection replaced: ${rationale.trim()}` }
      : entry),
    selectionHistory: [...decision.selectionHistory, {
      id: eventId, optionId, rationale: rationale.trim(), selectedAt: at, selectedByPersonId: personId,
    }],
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function duplicateIds(entries: readonly { id: string }[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  entries.forEach(({ id }) => { if (seen.has(id)) duplicates.add(id); seen.add(id); });
  return duplicates;
}

export function buildIcarusInterventionIndex(input: IcarusInterventionIndexInput): IcarusInterventionIndex {
  const causes = input.assessments.flatMap((assessment) => assessment.causes ?? [])
    .slice().sort((a, b) => a.id.localeCompare(b.id));
  const records = input.assessments.flatMap((assessment) => assessment.interventionDecisions ?? [])
    .slice().sort((a, b) => a.id.localeCompare(b.id));
  const causeDuplicates = duplicateIds(causes);
  const decisionDuplicates = duplicateIds(records);
  const options = records.flatMap((decision) => decision.options);
  const optionDuplicates = duplicateIds(options);
  const causesById = new Map(causes.filter((cause) => !causeDuplicates.has(cause.id)).map((cause) => [cause.id, cause]));
  const optionsById = new Map(options.filter((option) => !optionDuplicates.has(option.id)).map((option) => [option.id, option]));
  const assessmentsById = new Map(input.assessments.map((assessment) => [assessment.id, assessment]));
  const targetsById = new Map(input.treatment.targets.map((target) => [target.id, target]));
  const sources = new Set(input.sources.map(getIcarusReferenceKey));
  const people = new Set(input.people.filter((person) => person.status === "Active").map((person) => person.id));
  const authoritativeDecisions = new Map(input.decisions.map((decision) => [decision.id, decision]));
  const lessons = new Map(input.lessons.map((lesson) => [lesson.id, lesson]));
  const materialIds = new Set(input.signals.filter((signal) => signal.materialityTier === "Material")
    .map((signal) => signal.assessmentId));
  const selectedIds = new Set(records.filter((decision) => decision.status !== "Superseded")
    .flatMap((decision) => decision.selectedOptionId ? [decision.selectedOptionId] : []));
  const relationships = records.filter((decision) => decision.status !== "Superseded")
    .flatMap((decision) => decision.relationships).sort((a, b) => a.id.localeCompare(b.id));
  const outcomes = input.assessments.flatMap((assessment) => assessment.treatmentOutcomes ?? []);

  function scopeIssues(scope: IcarusInterventionScope): string[] {
    return [
      ...scope.assessmentIds.filter((id) => !assessmentsById.has(id)).map((id) => `Missing assessment: ${id}`),
      ...scope.failureModes.filter((ref) => !assessmentsById.get(ref.assessmentId)?.failureModes
        .some((mode) => mode.id === ref.failureModeId))
        .map((ref) => `Missing failure mode: ${ref.assessmentId}/${ref.failureModeId}`),
      ...scope.dependencyReferences.filter((ref) => !sources.has(getIcarusReferenceKey(ref)))
        .map((ref) => `Missing dependency: ${getIcarusReferenceKey(ref)}`),
      ...scope.objectiveIds.filter((id) => !sources.has(`Strategic Objective:${id}`)).map((id) => `Missing objective: ${id}`),
      ...scope.pillarIds.filter((id) => !sources.has(`Pillar:${id}`)).map((id) => `Missing pillar: ${id}`),
    ];
  }

  function postSelectionEvidence(
    record: IcarusTreatmentOutcomeRecord,
    decision: IcarusInterventionDecisionRecord,
    option: IcarusInterventionOption,
  ): boolean {
    const selection = decision.selectionHistory.filter((event) => event.optionId === option.id).at(-1);
    const link = option.treatmentLinks.find((entry) => entry.targetId === record.treatmentTargetId);
    const reference = record.interventionReference;
    const occurrenceMatches = !record.occurrenceId || (reference?.decisionId === decision.id
      && reference.optionId === option.id && reference.selectionEventId === selection?.id);
    return Boolean(selection && link && occurrenceMatches
      && Date.parse(record.verifiedAt) >= Date.parse(selection.selectedAt)
      && Date.parse(record.verifiedAt) >= Date.parse(link.linkedAt));
  }

  function optionOutcomes(decision: IcarusInterventionDecisionRecord, option: IcarusInterventionOption): IcarusInterventionOutcome[] {
    // Merely linking a target is not evidence that this option was ever selected.
    if (!decision.selectionHistory.some((event) => event.optionId === option.id)) return [];
    const targetIds = new Set(option.treatmentLinks.map((link) => link.targetId));
    return outcomes.filter((record) => targetIds.has(record.treatmentTargetId)).map((record): IcarusInterventionOutcome => {
      const historical = input.treatment.verification.get(record.treatmentTargetId)?.history
        .find((entry) => entry.record.id === record.id);
      const postSelection = postSelectionEvidence(record, decision, option);
      const validity = decisionValidity(decision);
      const current = Boolean(historical?.current) && postSelection
        && decision.status === "Recorded" && decision.selectedOptionId === option.id && option.status === "Candidate"
        && validity.blockingIssues.length === 0 && validity.conflicts.length === 0
        && requiredPredecessors(option.id).every((relation) => predecessorSatisfied(relation, new Set([option.id])));
      return {
        decisionId: decision.id, optionId: option.id, causeIds: uniqueSorted(option.causeIds),
        record, current, treatmentCurrent: Boolean(historical?.current), postSelectionEvidence: postSelection,
        treatmentAttribution: historical?.attribution ?? "Not attributable",
        causalAttribution: current && record.outcome !== "No longer applicable" ? "Uncertain" : "Not attributable",
      };
    }).sort((a, b) => a.record.verifiedAt.localeCompare(b.record.verifiedAt) || a.record.id.localeCompare(b.record.id));
  }

  // prerequisite-of requires current verified protection. must-precede additionally requires verification
  // before the successor's selection. A selected blocks option releases its successor after verification.
  // Unselected blockers and complements impose no prerequisite; mutual exclusions are conflicts.
  function requiredPredecessors(optionId: string) {
    return relationships.filter((relation) => relation.toOptionId === optionId
      && (relation.kind === "prerequisite-of" || relation.kind === "must-precede"
        || (relation.kind === "blocks" && selectedIds.has(relation.fromOptionId))));
  }
  function predecessorSatisfied(relation: IcarusInterventionRelation, visited = new Set<string>()): boolean {
    if (!prerequisiteSatisfied(relation.fromOptionId, visited)) return false;
    if (relation.kind !== "must-precede") return true;
    const successor = records.find((record) => record.selectedOptionId === relation.toOptionId && record.status === "Recorded");
    const selection = successor?.selectionHistory.at(-1);
    if (!selection) return true;
    const predecessor = optionsById.get(relation.fromOptionId);
    const owner = records.find((record) => record.selectedOptionId === relation.fromOptionId && record.status === "Recorded");
    return Boolean(predecessor && owner && predecessor.treatmentLinks.every((link) =>
      input.treatment.verification.get(link.targetId)?.history.some((entry) =>
        (entry.evidenceCurrent ?? entry.current) && entry.record.outcome === "Effective"
        && postSelectionEvidence(entry.record, owner, predecessor)
        && Date.parse(entry.record.verifiedAt) <= Date.parse(selection.selectedAt))));
  }
  function prerequisiteSatisfied(optionId: string, visited = new Set<string>()): boolean {
    if (visited.has(optionId)) return false;
    const nextVisited = new Set(visited).add(optionId);
    const option = optionsById.get(optionId);
    const owner = records.find((decision) => decision.selectedOptionId === optionId && decision.status === "Recorded");
    const validity = owner ? decisionValidity(owner) : undefined;
    return Boolean(option && owner && validity && validity.blockingIssues.length === 0 && validity.conflicts.length === 0
      && selectedIds.has(optionId) && option.status === "Candidate"
      && option.treatmentLinks.length > 0 && option.treatmentLinks.every((link) =>
        targetsById.get(link.targetId)?.state === "Completed — verification required"
        && input.treatment.verification.get(link.targetId)?.state === "Verified effective"
        && input.treatment.verification.get(link.targetId)?.history.some((entry) => entry.current
          && entry.record.outcome === "Effective" && postSelectionEvidence(entry.record, owner, option)))
      && requiredPredecessors(optionId)
        .every((relation) => predecessorSatisfied(relation, nextVisited)));
  }

  const preceding = relationships.filter((relation) => relation.kind === "prerequisite-of" || relation.kind === "must-precede");
  const adjacency = new Map<string, string[]>();
  preceding.forEach((relation) => adjacency.set(relation.fromOptionId,
    [...(adjacency.get(relation.fromOptionId) ?? []), relation.toOptionId]));
  function reaches(from: string, to: string, visited = new Set<string>()): boolean {
    if (from === to) return true;
    if (visited.has(from)) return false;
    visited.add(from);
    return (adjacency.get(from) ?? []).some((next) => reaches(next, to, visited));
  }
  const cyclicIds = new Set(preceding.filter((relation) => reaches(relation.toOptionId, relation.fromOptionId))
    .flatMap((relation) => [relation.fromOptionId, relation.toOptionId]));
  const selectionDuplicates = duplicateIds(records.flatMap((record) => record.selectionHistory));
  const allOutcomes = records.flatMap((decision) => decision.options.flatMap((option) => optionOutcomes(decision, option)));

  function effectMaterial(effect: IcarusInterventionEffect): boolean {
    const target = effect.target;
    if (target.kind === "Assessment") return materialIds.has(target.id);
    if (target.kind === "Cause") return causesById.get(target.id)?.assessmentIds.some((id) => materialIds.has(id)) ?? false;
    return input.signals.some((signal) => signal.materialityTier === "Material"
      && [...signal.strategicLinks, ...signal.relationships.filter((relation) => relation.kind === "Direct")
        .map((relation) => relation.reference)].some((ref) => target.kind === "Dependency"
        ? getIcarusReferenceKey(ref) === getIcarusReferenceKey(target.reference)
        : ref.recordType === target.kind && ref.recordId === target.id));
  }

  const learning: IcarusInterventionLearning[] = records.flatMap((decision) => decision.lessonLinks.map((link) => {
    const linkedOutcomes = allOutcomes.filter((outcome) => outcome.decisionId === decision.id
      && link.outcomeIds.includes(outcome.record.id));
    const validScope = link.causeIds.every((id) => causesById.has(id) && linkedOutcomes.some((outcome) => outcome.causeIds.includes(id)));
    const validLink = validScope && lessons.has(link.lessonId)
      && link.outcomeIds.every((id) => linkedOutcomes.some((outcome) => outcome.record.id === id));
    return {
      decisionId: decision.id, lessonId: link.lessonId, outcomeIds: [...link.outcomeIds],
      causeIds: validScope ? [...link.causeIds] : [], rationale: link.rationale,
      validLink,
      reviewed: validLink && ["Reviewed", "Implemented"].includes(lessons.get(link.lessonId)?.status ?? ""),
      currentEvidence: validLink && link.outcomeIds.every((id) =>
        linkedOutcomes.some((outcome) => outcome.record.id === id && outcome.current)),
    };
  }));

  function decisionValidity(record: IcarusInterventionDecisionRecord) {
    const selectedOption = record.options.find((option) => option.id === record.selectedOptionId && option.status === "Candidate");
    const issues = [
      ...scopeIssues(record),
      ...(!record.assessmentIds.length ? ["Decision has no assessment scope"] : []),
      ...(record.causeIds.length === 0 ? ["No explicit cause linked"] : []),
      ...record.causeIds.filter((id) => !causesById.has(id)).map((id) => `Missing or ambiguous cause: ${id}`),
      ...record.causeIds.flatMap((id) => {
        const cause = causesById.get(id);
        return cause ? [
          ...scopeIssues(cause),
          ...(!cause.assessmentIds.length ? [`Cause has no assessment scope: ${id}`] : []),
        ] : [];
      }),
      ...(!people.has(record.updatedByPersonId) ? [`Inactive or missing context author: ${record.updatedByPersonId}`] : []),
      ...(record.decisionRecordId && !authoritativeDecisions.has(record.decisionRecordId)
        ? [`Missing authoritative Decision: ${record.decisionRecordId}`] : []),
      ...(record.decisionRecordId && ["Draft", "Reversed"].includes(authoritativeDecisions.get(record.decisionRecordId)?.decisionStatus ?? "")
        ? ["Authoritative Decision is draft or reversed"] : []),
      ...(record.selectedOptionId && (!selectedOption || selectedOption.status !== "Candidate")
        ? ["Selected option is missing, rejected or superseded"] : []),
      ...(record.selectedOptionId && !record.rationale.trim() ? ["Selection rationale is missing"] : []),
      ...(record.selectedOptionId && !record.selectionHistory.some((event) => event.optionId === record.selectedOptionId)
        ? ["Selection has no recorded provenance"] : []),
      ...(record.selectedOptionId && record.selectionHistory.length > 0
        && record.selectionHistory[record.selectionHistory.length - 1].optionId !== record.selectedOptionId
        ? ["Selected option conflicts with latest selection history"] : []),
      ...record.lessonLinks.filter((link) => !lessons.has(link.lessonId)).map((link) => `Missing Lesson: ${link.lessonId}`),
      ...record.effects.flatMap((effect) => effect.evidence.filter((ref) => !assessmentsById.get(ref.assessmentId)
        ?.failureModes.find((mode) => mode.id === ref.failureModeId)?.evidence.some((entry) => entry.id === ref.evidenceId))
        .map((ref) => `Missing side-effect evidence: ${ref.evidenceId}`)),
      ...record.effects.filter((effect) => !record.options.some((option) => option.id === effect.optionId))
        .map((effect) => `Side effect has missing source option: ${effect.id}`),
      ...record.effects.flatMap((effect) => {
        const target = effect.target;
        const missing = target.kind === "Cause" ? !causesById.has(target.id)
          : target.kind === "Assessment" ? !assessmentsById.has(target.id)
            : target.kind === "Dependency" ? !sources.has(getIcarusReferenceKey(target.reference))
              : !sources.has(`${target.kind}:${target.id}`);
        return missing ? [`Missing side-effect target: ${effect.id}`] : [];
      }),
      ...record.effects.flatMap((effect) => effect.evidence.flatMap((ref) => {
        const evidence = assessmentsById.get(ref.assessmentId)?.failureModes.find((mode) => mode.id === ref.failureModeId)
          ?.evidence.find((entry) => entry.id === ref.evidenceId);
        return evidence && (evidence.review !== "Supports"
          || ["Stale", "Invalid"].includes(classifyIcarusEvidenceFreshness(evidence, input.nowMs))
          || (evidence.origin === "Source record" && (!evidence.reference || !sources.has(getIcarusReferenceKey(evidence.reference)))))
          ? [`Side-effect evidence is not current support: ${ref.evidenceId}`] : [];
      })),
      ...record.options.flatMap((option) => [
        ...scopeIssues(option),
        ...option.causeIds.filter((id) => !causesById.has(id) || !record.causeIds.includes(id))
          .map((id) => `Option cause is missing or outside decision scope: ${id}`),
        ...(!option.causeIds.length ? [`Option has no explicit target cause: ${option.id}`] : []),
      ]),
    ];
    if (selectedOption) issues.push(
      ...scopeIssues(selectedOption),
      ...selectedOption.causeIds.filter((id) => !causesById.has(id) || !record.causeIds.includes(id))
        .map((id) => `Option cause is missing or outside decision scope: ${id}`),
      ...(selectedOption.causeIds.length === 0 ? ["Selected option has no explicit target cause"] : []),
      ...(!selectedOption.intent || !selectedOption.scope || !selectedOption.character || !selectedOption.description.trim()
        ? ["Selected option classification or description is incomplete"] : []),
      ...selectedOption.treatmentLinks.filter((link) => !targetsById.has(link.targetId))
        .map((link) => `Missing treatment target: ${link.targetId}`),
      ...selectedOption.priorOptionIds.filter((id) => !optionsById.has(id))
        .map((id) => `Missing prior intervention option: ${id}`),
    );
    const relatedRelations = relationships.filter((relation) =>
      record.options.some((option) => option.id === relation.fromOptionId || option.id === relation.toOptionId));
    const conflicts = [
      ...(decisionDuplicates.has(record.id) ? [`Duplicate intervention decision identity: ${record.id}`] : []),
      ...record.options.filter((option) => optionDuplicates.has(option.id)).map((option) => `Duplicate option identity: ${option.id}`),
      ...record.selectionHistory.filter((event) => selectionDuplicates.has(event.id)).map((event) => `Duplicate selection event identity: ${event.id}`),
      ...record.selectionHistory.filter((event, index) =>
        !record.options.some((option) => option.id === event.optionId) || !event.rationale.trim()
        || !event.selectedByPersonId.trim() || !Number.isFinite(Date.parse(event.selectedAt))
        || Date.parse(event.selectedAt) < Date.parse(record.createdAt)
        || (index > 0 && Date.parse(event.selectedAt) < Date.parse(record.selectionHistory[index - 1].selectedAt)))
        .map((event) => `Invalid selection provenance or chronology: ${event.id}`),
      ...(record.selectedOptionId && record.status !== "Recorded" && record.status !== "Superseded"
        ? ["Selected option requires a recorded decision context"] : []),
      ...[...duplicateIds(record.relationships)].map((id) => `Duplicate relationship identity: ${id}`),
      ...[...duplicateIds(record.effects)].map((id) => `Duplicate side-effect identity: ${id}`),
      ...[...duplicateIds(record.lessonLinks)].map((id) => `Duplicate Lesson-link identity: ${id}`),
      ...relatedRelations.filter((relation) => !optionsById.has(relation.fromOptionId) || !optionsById.has(relation.toOptionId))
        .map((relation) => `Relationship has missing or ambiguous option: ${relation.id}`),
      ...relatedRelations.filter((relation) => relation.kind === "mutually-exclusive-with"
        && selectedIds.has(relation.fromOptionId) && selectedIds.has(relation.toOptionId))
        .map((relation) => `Mutually exclusive selections: ${relation.fromOptionId} / ${relation.toOptionId}`),
      ...record.options.filter((option) => cyclicIds.has(option.id)).map((option) => `Prerequisite/sequence cycle: ${option.id}`),
    ];
    const warnings = issues.filter((issue) => issue.startsWith("Inactive or missing context author:")
      || issue.startsWith("Missing Lesson:") || issue.startsWith("Side-effect evidence is not current support:"));
    const blockingIssues = issues.filter((issue) => !warnings.includes(issue));
    return { selectedOption, issues, conflicts, blockingIssues, warnings, relatedRelations };
  }

  const views: IcarusInterventionDecisionView[] = records.map((record) => {
    const validity = decisionValidity(record);
    const { selectedOption, conflicts, relatedRelations, warnings } = validity;
    const issues = [...validity.issues, ...learning.filter((entry) => entry.decisionId === record.id && !entry.validLink)
      .map((entry) => `Lesson link has missing outcome or invalid cause scope: ${entry.lessonId}`)];
    const unmetPrerequisites = selectedOption ? relatedRelations.filter((relation) =>
      relation.toOptionId === selectedOption.id && (
        ((relation.kind === "prerequisite-of" || relation.kind === "must-precede") && !predecessorSatisfied(relation))
        || (relation.kind === "blocks" && selectedIds.has(relation.fromOptionId) && !predecessorSatisfied(relation))
      )).map((relation) => `${relation.kind}: ${relation.fromOptionId} -> ${relation.toOptionId}`) : [];
    const targets = selectedOption?.treatmentLinks.flatMap((link) => {
      const target = targetsById.get(link.targetId);
      return target ? [target] : [];
    }) ?? [];
    const currentOutcomes = allOutcomes.filter((outcome) => outcome.decisionId === record.id);
    const priorOutcomes = allOutcomes.filter((outcome) => {
      const prior = records.find((entry) => entry.id === outcome.decisionId);
      return outcome.postSelectionEvidence && !optionDuplicates.has(outcome.optionId)
        && !decisionDuplicates.has(outcome.decisionId) && outcome.decisionId !== record.id && prior !== undefined
        && Date.parse(prior.createdAt) <= Date.parse(record.createdAt)
        && outcome.causeIds.some((id) => causesById.has(id) && record.causeIds.includes(id));
    });
    const priorOptionIds = new Set(records.filter((decision) => decision.id !== record.id && !decisionDuplicates.has(decision.id)
      && Date.parse(decision.createdAt) <= Date.parse(record.createdAt))
      .flatMap((decision) => decision.options.filter((option) => !optionDuplicates.has(option.id)
        && decision.selectionHistory.some((event) => event.optionId === option.id)
        && option.causeIds.some((id) => causesById.has(id) && record.causeIds.includes(id))).map((option) => option.id)));
    const priorEffects = records.flatMap((decision) => decision.effects.filter((effect) => priorOptionIds.has(effect.optionId)));
    let readiness: IcarusInterventionReadiness;
    if (record.status === "Superseded") readiness = "Superseded";
    else if (conflicts.length > 0) readiness = "Conflict";
    else if (issues.length > 0 || !record.assessmentIds.length) readiness = "Not structured";
    else if (unmetPrerequisites.length > 0) readiness = "Prerequisites unmet";
    else if (record.options.length < 2 || record.options.some((option) => !option.description.trim()
      || !option.intent || !option.scope || !option.character
      || ((option.status !== "Candidate") && !option.rationale.trim()))) readiness = "Alternatives incomplete";
    else if (!selectedOption || record.status !== "Recorded" || !record.rationale.trim()) readiness = "Ready for decision";
    else if (!targets.length || targets.some((target) => ["Unrouted", "Missing execution record"].includes(target.state)))
      readiness = "Selected — unrouted";
    else if (targets.every((target) => target.state === "Completed — verification required")) {
      readiness = targets.every((target) => {
        const state = input.treatment.verification.get(target.id)?.state;
        return state && !["Awaiting verification", "Verification in progress", "Superseded"].includes(state)
          && currentOutcomes.some((outcome) => outcome.optionId === selectedOption.id
            && outcome.record.treatmentTargetId === target.id && outcome.current);
      }) ? "Outcome available" : "Awaiting verification";
    } else readiness = "Executing";
    return {
      record, selectedOption, readiness,
      issues: uniqueSorted(issues), warnings: uniqueSorted(warnings), conflicts: uniqueSorted(conflicts), unmetPrerequisites: uniqueSorted(unmetPrerequisites),
      targets, outcomes: currentOutcomes, priorOutcomes, priorEffects,
      lifecycleHistory: record.assessmentIds.flatMap((id) => {
        const history = input.lifecycle?.byAssessmentId.get(id);
        return history ? [history] : [];
      }),
      learning: learning.filter((entry) => entry.decisionId === record.id
        || (entry.reviewed && entry.causeIds.some((id) => record.causeIds.includes(id)))),
    };
  });
  const byAssessmentId = new Map<string, IcarusInterventionDecisionView[]>();
  const byCauseId = new Map<string, IcarusInterventionDecisionView[]>();
  views.forEach((view) => {
    view.record.assessmentIds.forEach((id) => byAssessmentId.set(id, [...(byAssessmentId.get(id) ?? []), view]));
    view.record.causeIds.forEach((id) => byCauseId.set(id, [...(byCauseId.get(id) ?? []), view]));
  });
  const attentionByAssessmentId = new Map<string, readonly string[]>();
  input.signals.filter((signal) => signal.materialityTier === "Material").forEach((signal) => {
    const relevant = (byAssessmentId.get(signal.assessmentId) ?? []).filter((view) => view.record.status !== "Superseded");
    const reasons: string[] = relevant.length ? [] : ["Material exposure has no structured intervention decision"];
    relevant.forEach((view) => {
      if (["Not structured", "Alternatives incomplete", "Conflict", "Prerequisites unmet"].includes(view.readiness)) {
        reasons.push(`${view.record.title}: ${view.readiness}`);
      }
      if (view.selectedOption?.intent === "Symptom treatment" && view.selectedOption.causeIds.length) {
        reasons.push(`${view.record.title}: symptom treatment only; review whether the explicit cause needs structural treatment`);
      }
      if (view.priorOutcomes.some((outcome) => outcome.record.outcome === "Ineffective"
        && view.selectedOption?.priorOptionIds.includes(outcome.optionId)
        && outcome.causeIds.some((id) => view.selectedOption?.causeIds.includes(id)))) {
        reasons.push(`${view.record.title}: explicitly reused intervention has a prior ineffective outcome for this cause`);
      }
      if (view.record.effects.some((effect) => effect.optionId === view.selectedOption?.id
        && ["Potentially worsens", "Creates dependency"].includes(effect.direction) && effectMaterial(effect))) {
        reasons.push(`${view.record.title}: declared risk transfer affects material exposure`);
      }
      if (view.record.nextReviewBy && Date.parse(`${view.record.nextReviewBy.slice(0, 10)}T23:59:59.999Z`) < input.nowMs) {
        reasons.push(`${view.record.title}: intervention decision review overdue`);
      }
    });
    attentionByAssessmentId.set(signal.assessmentId, uniqueSorted(reasons));
  });

  const learningInput = outcomes.map((record) => {
    const contexts = allOutcomes.filter((entry) => entry.record.id === record.id);
    const currentContexts = contexts.filter((entry) => entry.current);
    const learningContexts = currentContexts.length ? currentContexts : contexts;
    const treatmentEvidence = input.treatment.verification.get(record.treatmentTargetId)?.history
      .find((entry) => entry.record.id === record.id);
    return {
      record,
      targetTitle: targetsById.get(record.treatmentTargetId)?.treatmentKind ?? "Icarus treatment",
      treatmentEvidence: {
        current: Boolean(treatmentEvidence?.current),
        attribution: treatmentEvidence?.attribution ?? "Not attributable",
      },
      ...(contexts.length ? {
        interventionContext: {
          decisionIds: uniqueSorted(learningContexts.map((entry) => entry.decisionId)),
          optionIds: uniqueSorted(learningContexts.map((entry) => entry.optionId)),
          causeIds: uniqueSorted(learningContexts.flatMap((entry) => [...entry.causeIds].filter((id) => causesById.has(id)))),
          lessonIds: uniqueSorted(learning.filter((entry) => entry.validLink && entry.outcomeIds.includes(record.id))
            .map((entry) => entry.lessonId)),
          current: contexts.some((entry) => entry.current),
        },
      } : {}),
    };
  });
  return { causes, decisions: views, byAssessmentId, byCauseId, attentionByAssessmentId, learningInput, lifecycle: input.lifecycle };
}
