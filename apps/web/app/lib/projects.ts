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

type ProjectSanitizerDeps = {
  generateId: () => string;
  resolvedOwnerName: string | null;
  isAllowedArea: (value: string) => boolean;
};

export function normalizeProjectDate(value: string): string {
  const dateValue = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return "";
  }

  const parsedDate = new Date(`${dateValue}T00:00:00`);
  const [year, month, day] = dateValue.split("-").map(Number);

  return (
    !Number.isNaN(parsedDate.getTime())
    && parsedDate.getFullYear() === year
    && parsedDate.getMonth() === month - 1
    && parsedDate.getDate() === day
  )
    ? dateValue
    : "";
}

export function sanitizeProjectRecord(
  project: ProjectRecord,
  deps: ProjectSanitizerDeps,
): ProjectRecord | null {
  const projectName = project.projectName.trim();
  const startDate = normalizeProjectDate(project.startDate);
  const targetCompletionDate = normalizeProjectDate(project.targetCompletionDate);
  const nextReviewDate = normalizeProjectDate(project.nextReviewDate || "");

  if (
    !projectName
    || (
      startDate
      && targetCompletionDate
      && targetCompletionDate < startDate
    )
  ) {
    return null;
  }

  const selectedArea = project.area.trim();
  const selectedStatus = project.status.trim();

  return {
    ...project,
    id: project.id || deps.generateId(),
    projectName,
    owner: deps.resolvedOwnerName ?? "",
    area: deps.isAllowedArea(selectedArea)
      ? selectedArea
      : "Garden Maintenance",
    startDate,
    targetCompletionDate,
    status: projectStatusOptions.includes(
      selectedStatus as (typeof projectStatusOptions)[number],
    )
      ? selectedStatus
      : "Open",
    health: getEffectiveProjectHealth(project),
    nextReviewDate,
    lastReviewedDate: normalizeProjectDate(project.lastReviewedDate || ""),
    reviewOwner: (project.reviewOwner || "").trim(),
    reviewOwnerPersonId: (project.reviewOwnerPersonId || "").trim(),
    reviewNote: (project.reviewNote || "").trim(),
    lastReviewOutcome: projectReviewOutcomeOptions.includes(
      project.lastReviewOutcome as ProjectReviewOutcome,
    )
      ? project.lastReviewOutcome
      : undefined,
    relatedActionIds: project.relatedActionIds ?? [],
    relatedDecisionIds: project.relatedDecisionIds ?? [],
    relatedSystemIds: project.relatedSystemIds ?? [],
    relatedSopIds: project.relatedSopIds ?? [],
  };
}
