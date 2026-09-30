export const projectExecutionAuthorityOptions = [
  "Normal",
  "Founder Authority Required",
  "Delegable",
] as const;

export type ProjectExecutionAuthority =
  (typeof projectExecutionAuthorityOptions)[number];

export const projectHealthOptions = [
  "On track",
  "At risk",
  "Blocked",
  "Waiting",
] as const;

export type ProjectHealth = (typeof projectHealthOptions)[number];

export const projectReviewOutcomeOptions = [
  "Continue",
  "Correct course",
  "Waiting on dependency",
  "Blocked",
  "Reassign",
  "Complete",
  "Cancel",
] as const;

export type ProjectReviewOutcome =
  (typeof projectReviewOutcomeOptions)[number];

export const projectStatusOptions = [
  "Open",
  "In Progress",
  "Blocked",
  "Completed",
  "Cancelled",
] as const;

export type ProjectRecord = {
  id: string;
  projectName: string;
  owner: string;
  area: string;
  startDate: string;
  targetCompletionDate: string;
  status: string;
  health?: ProjectHealth;
  nextReviewDate?: string;
  lastReviewedDate?: string;
  reviewOwner?: string;
  reviewOwnerPersonId?: string;
  reviewNote?: string;
  lastReviewOutcome?: ProjectReviewOutcome;
  relatedActionIds?: string[];
  relatedDecisionIds?: string[];
  relatedSystemIds?: string[];
  relatedSopIds?: string[];
  sourceCaptureId?: string;
  title?: string;
  originalRawNote?: string;
  createdAt?: string;
  executionAuthority?: ProjectExecutionAuthority;
};

export type ProjectConversionDraft = Pick<
  ProjectRecord,
  "projectName" | "owner" | "area" | "targetCompletionDate" | "status"
>;

export function getEffectiveProjectHealth(
  project: Pick<ProjectRecord, "health" | "status">,
): ProjectHealth {
  if (projectHealthOptions.includes(project.health as ProjectHealth)) {
    return project.health as ProjectHealth;
  }

  return project.status.trim().toLowerCase() === "blocked"
    ? "Blocked"
    : "On track";
}

export function isProjectReviewFuture(
  project: Pick<ProjectRecord, "nextReviewDate">,
  nowMs = Date.now(),
): boolean {
  if (!project.nextReviewDate) {
    return false;
  }

  const reviewMs = new Date(
    `${project.nextReviewDate.slice(0, 10)}T00:00:00`,
  ).getTime();

  return (
    !Number.isNaN(reviewMs)
    && reviewMs > new Date(nowMs).setHours(0, 0, 0, 0)
  );
}

export function isProjectReviewDue(
  project: Pick<ProjectRecord, "nextReviewDate">,
  nowMs = Date.now(),
): boolean {
  if (!project.nextReviewDate) {
    return false;
  }

  const reviewMs = new Date(
    `${project.nextReviewDate.slice(0, 10)}T00:00:00`,
  ).getTime();

  return (
    !Number.isNaN(reviewMs)
    && reviewMs <= new Date(nowMs).setHours(0, 0, 0, 0)
  );
}
