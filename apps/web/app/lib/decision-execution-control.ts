export type DecisionExecutionControlStatus =
  | "No execution path"
  | "Delivery slipping"
  | "Ownership gap"
  | "Review due"
  | "Learning incomplete"
  | "On track";

export type DecisionExecutionControlSeverity = "Critical" | "Material" | "Healthy";

export type DecisionExecutionControlDecisionInput = {
  id: string;
  title: string;
  decisionTitle?: string;
  status: string;
  riskLevel: string;
  reviewDate?: string;
  reviewDue: boolean;
  outcomeRating: string;
  actualOutcome: string;
  decisionMaker: string;
  area: string;
};

export type DecisionExecutionControlActionInput = {
  id: string;
  relatedDecision: string;
  status: string;
  dueDate?: string;
  title: string;
  actionTitle?: string;
  hasValidOwner: boolean;
};

export type DecisionExecutionControlProjectInput = {
  id: string;
  status: string;
  relatedDecisionIds?: readonly string[];
  relatedActionIds?: readonly string[];
  targetCompletionDate?: string;
  projectName: string;
  hasValidOwner: boolean;
};

export type DecisionExecutionControlDelegationCandidate = {
  objectType: string;
  id: string;
};

export type DecisionExecutionControlInput = {
  decisions: readonly DecisionExecutionControlDecisionInput[];
  actions: readonly DecisionExecutionControlActionInput[];
  projects: readonly DecisionExecutionControlProjectInput[];
  delegateItems: readonly DecisionExecutionControlDelegationCandidate[];
  nowMs: number;
};

export type DecisionExecutionControlItem = {
  id: string;
  title: string;
  decisionStatus: string;
  controlStatus: DecisionExecutionControlStatus;
  severity: DecisionExecutionControlSeverity;
  area: string;
  owner: string;
  directActiveActionCount: number;
  linkedActiveProjectCount: number;
  why: string;
  controlAction: string;
  linkedActionsPreview: Array<{ id: string; title: string; status: string }>;
  linkedProjectsPreview: Array<{ id: string; name: string; status: string }>;
};

export type DecisionExecutionControlSummary = {
  headline: string;
  activeTrackedCount: number;
  hasPathCount: number;
  noPathCount: number;
  slippingCount: number;
  onTrackCount: number;
  learningIncompleteCount: number;
};

export type DecisionExecutionControlResult = {
  summary: DecisionExecutionControlSummary;
  items: DecisionExecutionControlItem[];
  onTrackItems: DecisionExecutionControlItem[];
  learningIncompleteItems: DecisionExecutionControlItem[];
};

const activeDecisionStatuses = ["Draft", "Active", "Under Review"];
const closedDecisionStatuses = ["Completed", "Reversed"];
const activeActionStatuses = ["Open", "In Progress", "Blocked", "Waiting"];
const validOutcomeRatings = ["Worked", "Partially worked", "Failed"];
const overdueCriticalThresholdMs = 7 * 24 * 60 * 60 * 1000;

function isProjectActive(project: DecisionExecutionControlProjectInput): boolean {
  return !["completed", "closed", "final", "cancelled", "canceled"].includes(project.status.trim().toLowerCase());
}

export function buildDecisionExecutionControl(
  input: DecisionExecutionControlInput,
): DecisionExecutionControlResult {
  const items: DecisionExecutionControlItem[] = [];
  const onTrackItems: DecisionExecutionControlItem[] = [];
  const learningIncompleteItems: DecisionExecutionControlItem[] = [];

  let activeTrackedCount = 0;
  let hasPathCount = 0;
  let noPathCount = 0;
  let slippingCount = 0;
  let onTrackCount = 0;

  input.decisions.forEach((decision) => {
    const isActive = activeDecisionStatuses.includes(decision.status);
    const isClosed = closedDecisionStatuses.includes(decision.status);

    if (!isActive && !isClosed) return;

    const directActiveActions = input.actions.filter(
      (action) => action.relatedDecision === decision.id && activeActionStatuses.includes(action.status),
    );

    const linkedActiveProjects = input.projects.filter(
      (project) => (project.relatedDecisionIds || []).includes(decision.id) && isProjectActive(project),
    );

    const projectActionIds = new Set(
      linkedActiveProjects.flatMap((project) => project.relatedActionIds || []),
    );

    const implementationActiveActions = Array.from(
      new Map<string, DecisionExecutionControlActionInput>(
        [
          ...directActiveActions,
          ...input.actions.filter(
            (action) => projectActionIds.has(action.id) && activeActionStatuses.includes(action.status),
          ),
        ].map((action) => [action.id, action] as const),
      ).values(),
    );

    const directActiveActionCount = directActiveActions.length;
    const linkedActiveProjectCount = linkedActiveProjects.length;
    const totalActiveExecutionCount = implementationActiveActions.length + linkedActiveProjectCount;
    const hasExecutionPath = totalActiveExecutionCount > 0;
    const reviewDue = isActive && decision.reviewDue;

    const blockedActions = implementationActiveActions.filter((action) => action.status === "Blocked");
    const overdueActions = implementationActiveActions.filter(
      (action) => action.status !== "Waiting" && Boolean(action.dueDate) && new Date(action.dueDate!).getTime() < input.nowMs,
    );
    const blockedProjects = linkedActiveProjects.filter(
      (project) => project.status.trim().toLowerCase() === "blocked",
    );
    const overdueProjects = linkedActiveProjects.filter(
      (project) => project.targetCompletionDate && new Date(`${project.targetCompletionDate}T00:00:00`).getTime() < input.nowMs,
    );

    const isDeliverySlipping =
      blockedActions.length > 0 ||
      overdueActions.length > 0 ||
      blockedProjects.length > 0 ||
      overdueProjects.length > 0;

    const allLinkedExecutionOwnersValid = [
      ...implementationActiveActions.map((action) => action.hasValidOwner),
      ...linkedActiveProjects.map((project) => project.hasValidOwner),
    ].every(Boolean);

    const hasDelegationSuitableFounderOwnedExecution =
      implementationActiveActions.some((action) =>
        input.delegateItems.some((item) => item.objectType === "Action" && item.id === action.id),
      ) ||
      linkedActiveProjects.some((project) =>
        input.delegateItems.some((item) => item.objectType === "Project" && item.id === project.id),
      );

    const isOwnershipGap =
      hasExecutionPath &&
      (!allLinkedExecutionOwnersValid || hasDelegationSuitableFounderOwnedExecution);

    const isClosedLearningIncomplete =
      isClosed &&
      (!validOutcomeRatings.includes(decision.outcomeRating) || !decision.actualOutcome.trim());

    if (isActive) {
      activeTrackedCount++;
      if (hasExecutionPath) {
        hasPathCount++;
      } else {
        noPathCount++;
      }
      if (isDeliverySlipping) {
        slippingCount++;
      }
    }

    let controlStatus: DecisionExecutionControlStatus = "On track";
    let severity: DecisionExecutionControlSeverity = "Healthy";
    let why = "";
    let controlAction = "";

    if (isActive) {
      if (!hasExecutionPath) {
        controlStatus = "No execution path";
        const isHighRisk = decision.riskLevel === "Critical" || decision.riskLevel === "High";

        severity = isHighRisk ? "Critical" : "Material";
        why = `Active decision '${decision.decisionTitle || decision.title}' has no direct linked actions or projects, leaving implementation stalled.`;
        if (reviewDue) {
          why += ` Note: Decision review date is also due (${decision.reviewDate?.slice(0, 10)}).`;
        }
        controlAction = "Create or link an Action or Project to establish an executable path.";
      } else if (isDeliverySlipping) {
        controlStatus = "Delivery slipping";
        const hasCriticalSlippage =
          blockedActions.length > 0 ||
          blockedProjects.length > 0 ||
          overdueActions.some((action) => input.nowMs - new Date(action.dueDate!).getTime() > overdueCriticalThresholdMs);
        severity = hasCriticalSlippage ? "Critical" : "Material";

        const slippageDetails: string[] = [];
        if (blockedActions.length > 0) {
          slippageDetails.push(`${blockedActions.length} blocked action${blockedActions.length === 1 ? "" : "s"}`);
        }
        if (overdueActions.length > 0) {
          slippageDetails.push(`${overdueActions.length} overdue action${overdueActions.length === 1 ? "" : "s"}`);
        }
        if (blockedProjects.length > 0) {
          slippageDetails.push(`${blockedProjects.length} blocked project${blockedProjects.length === 1 ? "" : "s"}`);
        }
        if (overdueProjects.length > 0) {
          slippageDetails.push(`${overdueProjects.length} overdue project${overdueProjects.length === 1 ? "" : "s"}`);
        }

        why = `Delivery is slipping on execution path for '${decision.decisionTitle || decision.title}' (${slippageDetails.join(", ")}).`;
        if (reviewDue) {
          why += ` Scheduled review date (${decision.reviewDate?.slice(0, 10)}) is also due.`;
        }
        controlAction = "Resolve blocker or update target dates on linked execution items.";
      } else if (isOwnershipGap) {
        controlStatus = "Ownership gap";
        severity = "Material";
        why = `Linked execution path exists for '${decision.decisionTitle || decision.title}', but execution items lack a valid active owner in People.`;
        if (reviewDue) {
          why += ` Scheduled review date (${decision.reviewDate?.slice(0, 10)}) is also due.`;
        }
        controlAction = "Assign a valid active execution owner in People.";
      } else if (reviewDue) {
        controlStatus = "Review due";
        severity = "Material";
        why = `Scheduled review date (${decision.reviewDate?.slice(0, 10)}) for '${decision.decisionTitle || decision.title}' has been reached.`;
        controlAction = "Complete scheduled Decision review, record actual outcome and rating.";
      } else {
        controlStatus = "On track";
        severity = "Healthy";
        why = `Execution path is active (${directActiveActionCount} action${directActiveActionCount === 1 ? "" : "s"}, ${linkedActiveProjectCount} project${linkedActiveProjectCount === 1 ? "" : "s"}), validly owned, and progressing without delivery warnings.`;
        controlAction = "No intervention required — execution path is active and owned.";
        onTrackCount++;
      }
    } else if (isClosed) {
      if (isClosedLearningIncomplete) {
        controlStatus = "Learning incomplete";
        severity = "Material";
        why = `Decision '${decision.decisionTitle || decision.title}' is ${decision.status.toLowerCase()} but lacks formal outcome rating or recorded actual outcome.`;
        controlAction = "Capture actual outcome notes and formal outcome rating.";
      } else {
        controlStatus = "On track";
        severity = "Healthy";
        why = `Decision '${decision.decisionTitle || decision.title}' is ${decision.status.toLowerCase()} with complete outcome rating (${decision.outcomeRating}).`;
        controlAction = "No intervention required — decision learning is complete.";
      }
    }

    const item: DecisionExecutionControlItem = {
      id: decision.id,
      title: decision.decisionTitle || decision.title,
      decisionStatus: decision.status,
      controlStatus,
      severity,
      area: decision.area || "Unassigned",
      owner: decision.decisionMaker || "Unassigned",
      directActiveActionCount,
      linkedActiveProjectCount,
      why,
      controlAction,
      linkedActionsPreview: directActiveActions.slice(0, 3).map((action) => ({
        id: action.id,
        title: action.actionTitle || action.title,
        status: action.status,
      })),
      linkedProjectsPreview: linkedActiveProjects.slice(0, 3).map((project) => ({
        id: project.id,
        name: project.projectName,
        status: project.status,
      })),
    };

    if (controlStatus === "On track") {
      onTrackItems.push(item);
    } else if (controlStatus === "Learning incomplete") {
      learningIncompleteItems.push(item);
      items.push(item);
    } else {
      items.push(item);
    }
  });

  const learningIncompleteCount = learningIncompleteItems.length;

  const severityRank: Record<DecisionExecutionControlSeverity, number> = { Critical: 3, Material: 2, Healthy: 1 };
  const statusRank: Record<DecisionExecutionControlStatus, number> = {
    "No execution path": 6,
    "Delivery slipping": 5,
    "Ownership gap": 4,
    "Review due": 3,
    "Learning incomplete": 2,
    "On track": 1,
  };

  items.sort((left, right) => {
    const severityDifference = severityRank[right.severity] - severityRank[left.severity];
    if (severityDifference !== 0) return severityDifference;
    const statusDifference = statusRank[right.controlStatus] - statusRank[left.controlStatus];
    if (statusDifference !== 0) return statusDifference;
    return left.title.localeCompare(right.title);
  });

  let headline = "";
  if (noPathCount > 0) {
    headline = `Decision execution is constrained by ${noPathCount} missing execution path${noPathCount === 1 ? "." : "s."}`;
  } else if (slippingCount > 0) {
    headline = `Decision delivery is slipping on ${slippingCount} decision${slippingCount === 1 ? "." : "s."}`;
  } else if (activeTrackedCount > 0 && onTrackCount === activeTrackedCount) {
    headline = "Decision delivery is on track across all active decisions.";
  } else if (items.length > 0 && items.some((item) => item.controlStatus === "Review due")) {
    const reviewDueGaps = items.filter((item) => item.controlStatus === "Review due").length;
    headline = `Decision delivery is broadly on track; ${reviewDueGaps} review control gap${reviewDueGaps === 1 ? " remains." : "s remain."}`;
  } else if (learningIncompleteCount > 0) {
    headline = activeTrackedCount > 0
      ? `Active decision delivery is on track; ${learningIncompleteCount} closed decision${learningIncompleteCount === 1 ? " needs" : "s need"} outcome rating.`
      : `${learningIncompleteCount} closed decision${learningIncompleteCount === 1 ? " needs" : "s need"} outcome rating; no active decisions are currently being tracked.`;
  } else {
    headline = "No active decision-execution control gaps detected.";
  }

  return {
    summary: {
      headline,
      activeTrackedCount,
      hasPathCount,
      noPathCount,
      slippingCount,
      onTrackCount,
      learningIncompleteCount,
    },
    items,
    onTrackItems,
    learningIncompleteItems,
  };
}