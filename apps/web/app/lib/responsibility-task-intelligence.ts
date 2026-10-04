import type { ActionRecord, ActionResponsibilityOutcomeEvidence } from "./capture-conversions";
import type {
  FounderIntelligencePerson,
  OperationalOutcomeEvidence,
  ResponsibilityContributionMode,
  ResponsibilityDefinition,
  ResponsibilityFitRecord,
} from "./founder-intelligence";

export type ResponsibilityPersonGovernanceClass = "founder" | "team-member" | "unclassified";

export type RequirementDelegationEvidence = {
  requirementId: string;
  status: "demonstrated" | "unresolved" | "missing";
  actionIds: string[];
  outcomeIds: string[];
};

export type ResponsibilityDelegationEvidenceAssessment = {
  personId: string;
  responsibilityId: string;
  governanceClass: ResponsibilityPersonGovernanceClass;
  status: "evidence-supports-human-delegation-review" | "not-established" | "unresolved";
  requirements: RequirementDelegationEvidence[];
  authorityChanged: false;
};

type GovernancePerson = FounderIntelligencePerson & {
  role?: string;
  accessLevel?: string;
  status?: string;
};

type ResponsibilityExecutionEvidenceContext = {
  people: readonly GovernancePerson[];
  responsibilities: readonly ResponsibilityDefinition[];
  actions: readonly ActionRecord[];
  operationalOutcomeAssertions?: readonly OperationalOutcomeEvidence[];
};

const contributionModes: readonly ResponsibilityContributionMode[] = [
  "owner",
  "lead",
  "executor",
  "contributor",
  "support",
  "reviewer",
];
const outcomeKinds: readonly ActionResponsibilityOutcomeEvidence["outcome"][] = [
  "successful",
  "mixed",
  "unsuccessful",
  "unassessed",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isActionResponsibilityOutcomeEvidence(
  value: unknown,
): value is ActionResponsibilityOutcomeEvidence {
  return isPlainObject(value)
    && typeof value.id === "string" && value.id.trim().length > 0
    && typeof value.responsibilityId === "string" && value.responsibilityId.trim().length > 0
    && typeof value.requirementId === "string" && value.requirementId.trim().length > 0
    && typeof value.personId === "string" && value.personId.trim().length > 0
    && contributionModes.includes(value.contribution as ResponsibilityContributionMode)
    && typeof value.outcomeId === "string" && value.outcomeId.trim().length > 0
    && outcomeKinds.includes(value.outcome as ActionResponsibilityOutcomeEvidence["outcome"])
    && typeof value.observedResult === "string"
    && ["unreviewed", "validated", "unresolved"].includes(value.evidenceStatus as string)
    && (value.reviewedByPersonId === undefined
      || (typeof value.reviewedByPersonId === "string" && value.reviewedByPersonId.trim().length > 0))
    && (value.reviewedAt === undefined || typeof value.reviewedAt === "string");
}

export function assertActionResponsibilityOutcomeEvidenceStructure(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)
    || !value.every(isActionResponsibilityOutcomeEvidence)) {
    throw new Error("An Action contains malformed responsibility outcome evidence.");
  }
}

export function mergeActionResponsibilityOutcomeEvidence(
  existing: unknown,
  incoming: ActionResponsibilityOutcomeEvidence,
): ActionResponsibilityOutcomeEvidence[] {
  assertActionResponsibilityOutcomeEvidenceStructure(existing);
  if (!isActionResponsibilityOutcomeEvidence(incoming)) {
    throw new Error("Incoming Action responsibility outcome evidence is malformed.");
  }
  const records = [...(Array.isArray(existing) ? existing : [])];
  const index = records.findIndex((record) => record.id === incoming.id);
  if (index === -1) return [...records, { ...incoming }];

  const current = records[index];
  const sameAssertion = current.responsibilityId === incoming.responsibilityId
    && current.requirementId === incoming.requirementId
    && current.personId === incoming.personId
    && current.contribution === incoming.contribution
    && current.outcomeId === incoming.outcomeId
    && current.outcome === incoming.outcome
    && current.observedResult === incoming.observedResult;
  const next = records.slice();
  if (!sameAssertion) {
    next[index] = { ...current, evidenceStatus: "unresolved" };
  } else {
    const currentValidated = current.evidenceStatus === "validated";
    const incomingValidated = incoming.evidenceStatus === "validated";
    const conflictingReview = currentValidated && incomingValidated
      && current.reviewedByPersonId !== incoming.reviewedByPersonId;
    next[index] = conflictingReview
      || current.evidenceStatus === "unresolved"
      || incoming.evidenceStatus === "unresolved"
      ? { ...current, evidenceStatus: "unresolved" }
      : currentValidated
        ? current
        : incomingValidated
          ? { ...current, ...incoming }
          : { ...current, ...incoming };
  }
  return next;
}

export function deriveActionOperationalOutcomeEvidence(
  actions: readonly ActionRecord[],
  people: readonly GovernancePerson[],
): OperationalOutcomeEvidence[] {
  const results = new Map<string, OperationalOutcomeEvidence>();
  const conflictingKeys = new Set<string>();
  actions.forEach((action) => {
    const evidenceRecords = action.responsibilityOutcomeEvidence;
    if (!Array.isArray(evidenceRecords)) return;
    evidenceRecords.forEach((evidence) => {
      if (!isActionResponsibilityOutcomeEvidence(evidence)
        || typeof action.id !== "string" || !action.id.trim()
        || action.status !== "Completed"
        || action.reviewOutcome !== "Complete"
        || typeof action.completionEvidence !== "string"
        || !action.completionEvidence.trim()
        || evidence.evidenceStatus !== "validated"
        || !evidence.observedResult.trim()
        || !evidence.reviewedAt
        || Number.isNaN(new Date(evidence.reviewedAt).getTime())
        || !evidence.reviewedByPersonId
        || evidence.reviewedByPersonId === evidence.personId
        || !people.some((person) => person.id === evidence.personId)
        || !people.some((person) => person.id === evidence.reviewedByPersonId)) return;

      const key = JSON.stringify([
        action.id,
        evidence.outcomeId,
        evidence.personId,
        evidence.contribution,
      ]);
      const existing = results.get(key);
      if (existing) {
        if (existing.outcome !== evidence.outcome
          || existing.observedResult !== evidence.observedResult
          || existing.responsibilityId !== evidence.responsibilityId
          || existing.requirementId !== evidence.requirementId) {
          conflictingKeys.add(key);
          results.delete(key);
        }
        return;
      }

      if (conflictingKeys.has(key)) return;
      results.set(key, {
        id: evidence.id,
        personId: evidence.personId,
        recordType: "Action",
        recordId: action.id,
        outcomeId: evidence.outcomeId,
        contribution: evidence.contribution,
        outcome: evidence.outcome,
        observedResult: evidence.observedResult,
        evidenceStatus: "resolved",
        responsibilityId: evidence.responsibilityId,
        requirementId: evidence.requirementId,
      });
    });
  });
  return [...results.values()].filter((evidence) => evidence.outcome === "successful");
}

function getGovernanceClass(person: GovernancePerson): ResponsibilityPersonGovernanceClass {
  if (person.accessLevel === "Founder" || /\bco[- ]?founder\b/i.test(person.role ?? "")) return "founder";
  if (person.accessLevel === "Team Member" || person.role) return "team-member";
  return "unclassified";
}

export function assessResponsibilityDelegationEvidence(
  personId: string,
  responsibilityId: string,
  fits: readonly ResponsibilityFitRecord[],
  context: ResponsibilityExecutionEvidenceContext,
): ResponsibilityDelegationEvidenceAssessment {
  const person = context.people.find((candidate) => candidate.id === personId);
  const responsibility = context.responsibilities.find((candidate) => candidate.id === responsibilityId);
  const base = {
    personId,
    responsibilityId,
    governanceClass: person ? getGovernanceClass(person) : "unclassified" as const,
    authorityChanged: false as const,
  };
  if (!person || !responsibility) {
    return { ...base, status: "unresolved", requirements: [] };
  }
  if (responsibility.requirements.length === 0) {
    return { ...base, status: "not-established", requirements: [] };
  }

  const actionEvidence = deriveActionOperationalOutcomeEvidence(context.actions, context.people);
  const responsibilityAssessments = fits
    .filter((record) => record.responsibilityId === responsibility.id)
    .flatMap((record) => record.assessments)
    .filter((assessment) => assessment.personId === personId);
  const hasOrphanedRequirementAssessment = responsibilityAssessments.some((assessment) =>
    (assessment.fit === "demonstrated-capability"
      || assessment.candidateFit === "demonstrated-capability")
    && assessment.requirementIds?.some((requirementId) =>
      !responsibility.requirements.some((requirement) => requirement.id === requirementId)) === true
    && assessment.claim.evidence.some((reference) =>
      reference.type === "operational-outcome"
      && reference.recordType === "Action"
      && context.actions.some((action) => action.id === reference.recordId)));
  const requirements = responsibility.requirements.map((requirement) => {
    const requirementAssessments = responsibilityAssessments.filter((assessment) =>
      assessment.requirementIds?.includes(requirement.id) === true);
    const relevantAssessments = requirementAssessments.filter((assessment) =>
      assessment.fit === "demonstrated-capability"
      && assessment.claim.status === "evidence-grounded-understanding");
    const linkedActionEvidence = relevantAssessments.flatMap((assessment) => {
      const references = assessment.claim.evidence.filter(
        (reference) => reference.type === "operational-outcome" && reference.personId === personId,
      );
      return references.flatMap((reference) => {
        if (reference.type !== "operational-outcome") return [];
        const action = context.actions.find((candidate) =>
          candidate.id === reference.recordId && reference.recordType === "Action");
        const evidence = actionEvidence.find((candidate) =>
          candidate.recordId === reference.recordId
          && candidate.outcomeId === reference.outcomeId
          && candidate.personId === personId
          && candidate.contribution === assessment.contribution
          && candidate.responsibilityId === responsibility.id
          && candidate.requirementId === requirement.id);
        const assertions = (context.operationalOutcomeAssertions ?? []).filter((assertion) =>
          assertion.personId === personId
          && assertion.recordType === "Action"
          && assertion.recordId === reference.recordId
          && assertion.outcomeId === reference.outcomeId
          && assertion.contribution === assessment.contribution);
        const corroborated = evidence !== undefined
          && assertions.length > 0
          && assertions.every((assertion) =>
            assertion.evidenceStatus === "resolved"
            && assertion.outcome === "successful"
            && assertion.observedResult === evidence.observedResult
            && assertion.responsibilityId === responsibility.id
            && assertion.requirementId === requirement.id);
        return action && evidence && corroborated ? [{ action, evidence }] : [];
      });
    });
    const actionIds = [...new Set(linkedActionEvidence.map(({ action }) => action.id))].sort();
    const outcomeIds = [...new Set(linkedActionEvidence.map(({ evidence }) => evidence.outcomeId))].sort();
    return {
      requirementId: requirement.id,
      status: linkedActionEvidence.length > 0 ? "demonstrated" as const
        : (requirementAssessments.some((assessment) =>
          assessment.candidateFit === "demonstrated-capability"
          || assessment.fit === "demonstrated-capability")
          || hasOrphanedRequirementAssessment)
          ? "unresolved" as const
          : "missing" as const,
      actionIds,
      outcomeIds,
    };
  });

  const status = requirements.every((requirement) => requirement.status === "demonstrated")
    ? "evidence-supports-human-delegation-review"
    : requirements.some((requirement) => requirement.status === "unresolved")
      ? "unresolved"
      : "not-established";
  return { ...base, status, requirements };
}
