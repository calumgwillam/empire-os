import type { ActionRecord, DecisionRecord, OpportunityRecord, ProblemRecord, SystemRecord } from "./capture-conversions";
import type { LeadRecord } from "./crm";
import type { ProjectRecord } from "./projects";
import {
  assessDelegationReadiness,
  isFounderOwned,
  type DelegationPersonInput,
} from "./execution-release";

export type DecisionReviewReasonCategory =
  | "Critical escalation"
  | "Review due"
  | "Under review"
  | "High-risk judgement";

export type FounderReviewCandidate = {
  id: string;
  objectType: "Decision" | "Problem" | "Action";
  kind: "Decision" | "Problem" | "Action";
  title: string;
  pillar: string;
  owner: string;
  reasonCategory: DecisionReviewReasonCategory;
  whatIsChanging: string;
  whyItMatters: string;
  founderIntervention: "Yes";
  delegationAction: string;
};

export type FounderAuthorityCandidate = {
  id: string;
  objectType: "Project" | "Opportunity";
  title: string;
  pillar: string;
  owner: string;
  reasonCategory: "Blocked project decision" | "Strategic opportunity approval";
  whatIsChanging: string;
  whyItMatters: string;
  founderIntervention: "Yes";
  delegationAction: string;
  authorityScore: number;
};

export type FounderAuthorityQueueCandidate = Omit<FounderAuthorityCandidate, "reasonCategory"> & {
  kind: string;
  reasonCategory: "Authority required";
};

export type FounderReviewQueueItem =
  | (Omit<FounderReviewCandidate, "reasonCategory"> & { reasonCategory: string })
  | (Omit<FounderAuthorityQueueCandidate, "reasonCategory"> & { reasonCategory: string });

export type CrossPillarIssue = {
  id: string;
  objectType: "Problem" | "Action" | "Project";
  title: string;
  kind: "Cross-pillar problem" | "Cross-pillar action" | "Cross-pillar project";
  owner: string;
  area: string;
  why: string;
  founderIntervention: "Maybe";
  delegationAction: string;
};

export type DelegateItem = {
  id: string;
  objectType: "Action" | "Project" | "Lead" | "Problem";
  title: string;
  pillar: string;
  owner: string;
  whatIsChanging: string;
  whyItMatters: string;
  founderIntervention: "No";
  delegationAction: string;
};

export type EmpireDecisionQueueResult = {
  founderReviewQueue: FounderReviewQueueItem[];
  crossPillarIssues: CrossPillarIssue[];
  delegateItems: DelegateItem[];
  delegationCapacityNames: string[];
  delegationReadinessGapNames: string[];
  founderAuthorityItems: FounderAuthorityCandidate[];
  founderAuthorityDisplayItems: FounderAuthorityCandidate[];
};

export type EmpireDecisionQueueInput = {
  decisions: readonly Pick<DecisionRecord, "id" | "decisionStatus" | "reviewDate" | "riskLevel" | "decisionTitle" | "title" | "relatedPillar" | "relatedArea" | "decisionMaker" | "decisionStatement" | "relatedOpportunity">[];
  problems: readonly (Pick<ProblemRecord, "id" | "problemStatus" | "severity" | "problemStatement" | "title" | "owner" | "relatedArea" | "relatedPillar"> & { ownerPersonId?: string })[];
  actions: readonly Pick<ActionRecord, "id" | "status" | "priority" | "releaseSourceType" | "releaseSourceId" | "releaseIntent" | "actionTitle" | "title" | "relatedPillar" | "owner" | "ownerPersonId" | "dueDate" | "relatedProblem" | "relatedDecision" | "relatedOpportunity">[];
  projects: readonly (Pick<ProjectRecord, "id" | "status" | "relatedActionIds" | "relatedDecisionIds" | "relatedSystemIds" | "area" | "owner" | "projectName" | "targetCompletionDate"> & { ownerPersonId?: string })[];
  opportunities: readonly Pick<OpportunityRecord, "id" | "status" | "strategicFit" | "relatedPillar" | "relatedArea" | "owner" | "opportunityTitle" | "title">[];
  leads: readonly (Pick<LeadRecord, "id" | "status" | "archived" | "owner" | "followUpDate" | "relatedPillar" | "leadName"> & { ownerPersonId?: string })[];
  activeOwnershipActions: readonly Pick<ActionRecord, "id" | "status" | "priority" | "releaseSourceType" | "releaseSourceId" | "releaseIntent" | "actionTitle" | "title" | "relatedPillar" | "owner" | "ownerPersonId" | "dueDate" | "relatedProblem" | "relatedDecision" | "relatedOpportunity">[];
  activeOwnershipProjects: readonly (Pick<ProjectRecord, "id" | "status" | "relatedActionIds" | "relatedDecisionIds" | "relatedSystemIds" | "area" | "owner" | "projectName" | "targetCompletionDate"> & { ownerPersonId?: string })[];
  activeOwnershipLeads: readonly (Pick<LeadRecord, "id" | "status" | "archived" | "owner" | "followUpDate" | "relatedPillar" | "leadName"> & { ownerPersonId?: string })[];
  activeOwnershipProblems: readonly (Pick<ProblemRecord, "id" | "problemStatus" | "severity" | "problemStatement" | "title" | "owner" | "relatedArea" | "relatedPillar"> & { ownerPersonId?: string })[];
  systems: readonly Pick<SystemRecord, "id" | "area">[];
  orderedPeople: readonly DelegationPersonInput[];
  nowMs?: number;
};

function getAreaText(record: { relatedArea?: string; relatedPillar?: string; area?: string }): string {
  return record.relatedPillar || record.relatedArea || record.area || "";
}

function isActionWaiting(action: Pick<ActionRecord, "status">): boolean {
  return action.status === "Waiting";
}

function isActionActive(action: Pick<ActionRecord, "status">): boolean {
  return ["Open", "In Progress", "Blocked"].includes(action.status) || isActionWaiting(action);
}

function isReleaseInterventionAction(action: Pick<ActionRecord, "releaseSourceType" | "releaseSourceId" | "releaseIntent">): boolean {
  return Boolean(action.releaseSourceType && action.releaseSourceId && action.releaseIntent);
}

function isProblemUnresolved(problem: Pick<ProblemRecord, "problemStatus">): boolean {
  return ["Open", "Investigating", "Action required"].includes(problem.problemStatus);
}

function isDecisionActive(decision: Pick<DecisionRecord, "decisionStatus">): boolean {
  return ["Draft", "Active", "Under Review"].includes(decision.decisionStatus);
}

function isDecisionReviewDue(decision: Pick<DecisionRecord, "decisionStatus" | "reviewDate">, nowMs: number): boolean {
  if (!isDecisionActive(decision) || !decision.reviewDate) return false;
  const reviewTime = new Date(decision.reviewDate).getTime();
  return !Number.isNaN(reviewTime) && reviewTime <= nowMs;
}

function isProjectActive(project: Pick<ProjectRecord, "status">): boolean {
  return !["completed", "closed", "final", "cancelled", "canceled"].includes(project.status.trim().toLowerCase());
}

function distinctAreas(areas: Array<string | undefined>): string[] {
  return Array.from(new Set(areas.map((area) => area?.trim()).filter((area): area is string => Boolean(area))));
}

export function mergeFounderReviewQueue(
  founderReviewCandidates: readonly FounderReviewCandidate[],
  founderAuthorityItems: readonly FounderAuthorityCandidate[],
): FounderReviewQueueItem[] {
  const reasonPriority: Record<string, number> = {
    "Authority required": 5,
    "Critical escalation": 4,
    "Review due": 3,
    "Under review": 2,
    "High-risk judgement": 1,
  };
  const combined: FounderReviewQueueItem[] = [
    ...founderReviewCandidates,
    ...founderAuthorityItems.map((item) => ({
      ...item,
      kind: item.objectType,
      reasonCategory: "Authority required" as const,
    })),
  ];
  return Array.from(
    combined.reduce((items, item) => {
      const key = `${item.objectType}:${item.id}`;
      const existing = items.get(key);
      if (!existing || reasonPriority[item.reasonCategory] > reasonPriority[existing.reasonCategory]) {
        items.set(key, item);
      }
      return items;
    }, new Map<string, FounderReviewQueueItem>()),
  ).map(([, item]) => item);
}

export function buildEmpireDecisionQueue(input: EmpireDecisionQueueInput): EmpireDecisionQueueResult {
  const nowMs = input.nowMs ?? Date.now();
  const readiness = assessDelegationReadiness(input.orderedPeople);
  const founderPerson = readiness.primaryFounder;
  const founderReviewCandidates: FounderReviewCandidate[] = [
    ...input.decisions
      .filter((decision) => isDecisionActive(decision) && (
        isDecisionReviewDue(decision, nowMs)
        || decision.decisionStatus === "Under Review"
        || decision.riskLevel === "High"
        || decision.riskLevel === "Critical"
      ))
      .map((decision) => {
        const reasonCategory: DecisionReviewReasonCategory = decision.riskLevel === "Critical"
          ? "Critical escalation"
          : isDecisionReviewDue(decision, nowMs)
            ? "Review due"
            : decision.decisionStatus === "Under Review"
              ? "Under review"
              : "High-risk judgement";
        return {
          id: decision.id,
          objectType: "Decision" as const,
          kind: "Decision" as const,
          title: decision.decisionTitle,
          pillar: getAreaText(decision) || "Unassigned",
          owner: decision.decisionMaker || "Unassigned",
          reasonCategory,
          whatIsChanging: decision.decisionStatement || "No decision statement recorded.",
          whyItMatters: reasonCategory === "Review due"
            ? "This decision is due or overdue for explicit review, so its assumptions and current path need founder judgement."
            : reasonCategory === "Under review"
              ? "This decision is explicitly under review and needs a clear conclusion."
              : `This decision carries ${decision.riskLevel.toLowerCase()} risk and needs founder judgement.`,
          founderIntervention: "Yes" as const,
          delegationAction: "Founder review required",
        };
      }),
    ...input.problems
      .filter((problem) => isProblemUnresolved(problem) && problem.severity === "Critical")
      .map((problem) => ({
        id: problem.id,
        objectType: "Problem" as const,
        kind: "Problem" as const,
        title: problem.problemStatement,
        pillar: getAreaText(problem) || "Unassigned",
        owner: problem.owner || "Unassigned",
        reasonCategory: "Critical escalation" as const,
        whatIsChanging: `${problem.severity} severity problem still requiring action.`,
        whyItMatters: `This critical issue remains ${problem.problemStatus.toLowerCase()} and requires founder-level escalation.`,
        founderIntervention: "Yes" as const,
        delegationAction: "Escalate to founder and accountable owner",
      })),
    ...input.actions
      .filter((action) => isActionActive(action) && !isActionWaiting(action) && !isReleaseInterventionAction(action) && action.priority === "Critical")
      .map((action) => ({
        id: action.id,
        objectType: "Action" as const,
        kind: "Action" as const,
        title: action.actionTitle,
        pillar: action.relatedPillar || "Unassigned",
        owner: action.owner || "Unassigned",
        reasonCategory: "Critical escalation" as const,
        whatIsChanging: action.status === "Blocked" ? "This dependency is blocked and preventing progress." : "This critical action is still open and needs immediate movement.",
        whyItMatters: action.dueDate && new Date(action.dueDate).getTime() <= nowMs
          ? `The due date of ${action.dueDate} has passed, so momentum is slipping and downstream work is delayed.`
          : "This item is critical to the current operating plan and should not sit unresolved.",
        founderIntervention: "Yes" as const,
        delegationAction: action.status === "Blocked" ? "Escalate and remove dependency" : "Delegate with clear owner follow-up",
      })),
  ];

  const activeActions = input.actions.filter(isActionActive);
  const activeProjects = input.projects.filter(isProjectActive);
  const crossPillarCandidates = [
    ...input.problems
      .filter(isProblemUnresolved)
      .map((problem) => ({
        item: problem,
        areas: distinctAreas([
          getAreaText(problem),
          ...activeActions.filter((action) => action.relatedProblem === problem.id).map((action) => action.relatedPillar),
        ]),
      })),
    ...activeActions.map((action) => ({
      item: action,
      areas: distinctAreas([
        action.relatedPillar,
        input.problems.find((problem) => problem.id === action.relatedProblem && isProblemUnresolved(problem))
          ? getAreaText(input.problems.find((problem) => problem.id === action.relatedProblem)!)
          : undefined,
        input.decisions.find((decision) => decision.id === action.relatedDecision && isDecisionActive(decision))
          ? getAreaText(input.decisions.find((decision) => decision.id === action.relatedDecision)!)
          : undefined,
        input.opportunities.find((opportunity) => opportunity.id === action.relatedOpportunity)?.relatedPillar,
        ...activeProjects.filter((project) => (project.relatedActionIds || []).includes(action.id)).map((project) => project.area),
      ]),
    })),
    ...activeProjects.map((project) => ({
      item: project,
      areas: distinctAreas([
        project.area,
        ...activeActions.filter((action) => (project.relatedActionIds || []).includes(action.id)).map((action) => action.relatedPillar),
        ...input.decisions.filter((decision) => (project.relatedDecisionIds || []).includes(decision.id) && isDecisionActive(decision)).map(getAreaText),
        ...input.systems.filter((system) => (project.relatedSystemIds || []).includes(system.id)).map((system) => system.area),
      ]),
    })),
  ];
  const crossPillarIssues: CrossPillarIssue[] = crossPillarCandidates
    .filter(({ areas }) => areas.length > 1)
    .slice(0, 8)
    .map(({ item, areas }) => {
      const owner = "owner" in item ? item.owner || "Unassigned" : "Unassigned";
      const area = "relatedPillar" in item ? item.relatedPillar || "General" : "area" in item ? item.area : "General";
      return {
        id: item.id,
        objectType: "problemStatement" in item ? "Problem" : "actionTitle" in item ? "Action" : "Project",
        title: "problemStatement" in item ? item.problemStatement : "actionTitle" in item ? item.actionTitle : item.projectName,
        kind: "problemStatement" in item ? "Cross-pillar problem" : "actionTitle" in item ? "Cross-pillar action" : "Cross-pillar project",
        owner,
        area,
        why: `Linked active work connects this record across ${areas.join(" and ")}.`,
        founderIntervention: "Maybe",
        delegationAction: "Delegate to the accountable lead with founder review if it becomes material",
      };
    });

  const daysUntil = (dateValue?: string) => {
    const timestamp = dateValue ? new Date(dateValue).getTime() : 0;
    return timestamp && !Number.isNaN(timestamp) ? (timestamp - nowMs) / (1000 * 60 * 60 * 24) : null;
  };
  const delegateItems = [
    ...input.activeOwnershipActions
      .filter((action) => isFounderOwned(founderPerson, input.orderedPeople, action) && !isActionWaiting(action) && action.status !== "Blocked" && action.priority !== "Critical")
      .map((action) => {
        const dueInDays = daysUntil(action.dueDate);
        const suitability = (action.priority === "Low" ? 0 : action.priority === "Medium" ? 15 : 35)
          + (action.status === "In Progress" ? 10 : 0)
          + (dueInDays === null ? 0 : dueInDays < 0 ? 80 : dueInDays <= 7 ? 55 : dueInDays <= 30 ? 30 : 0);
        return {
          id: action.id,
          objectType: "Action" as const,
          title: action.actionTitle,
          pillar: action.relatedPillar || "Unassigned",
          owner: action.owner || founderPerson?.name || "Founder",
          whatIsChanging: "This active action is still carried by the founder but does not have a critical or blocked authority signal.",
          whyItMatters: "Transferring routine execution creates founder capacity while preserving accountability through a named owner.",
          founderIntervention: "No" as const,
          delegationAction: "Transfer to an active operational owner with a clear outcome and follow-up",
          suitability,
        };
      }),
    ...input.activeOwnershipProjects
      .filter((project) => isFounderOwned(founderPerson, input.orderedPeople, project) && project.status.trim().toLowerCase() !== "blocked")
      .map((project) => {
        const dueInDays = daysUntil(project.targetCompletionDate);
        const suitability = (project.status.trim().toLowerCase() === "in progress" ? 15 : 0)
          + (dueInDays === null ? 0 : dueInDays < 0 ? 80 : dueInDays <= 14 ? 50 : dueInDays <= 30 ? 25 : 0);
        return {
          id: project.id,
          objectType: "Project" as const,
          title: project.projectName,
          pillar: project.area || "Unassigned",
          owner: project.owner || founderPerson?.name || "Founder",
          whatIsChanging: "This active, unblocked project is currently carried by the founder.",
          whyItMatters: "Moving delivery ownership away from the founder improves operating leverage and tests whether the project can run autonomously.",
          founderIntervention: "No" as const,
          delegationAction: "Transfer delivery ownership to an active operational owner",
          suitability,
        };
      }),
    ...input.activeOwnershipLeads
      .filter((lead) => isFounderOwned(founderPerson, input.orderedPeople, lead))
      .map((lead) => {
        const followUpInDays = daysUntil(lead.followUpDate);
        const suitability = (lead.status === "Follow-Up" ? 25 : 0)
          + (followUpInDays === null ? 0 : followUpInDays < 0 ? 60 : followUpInDays <= 7 ? 35 : 0);
        return {
          id: lead.id,
          objectType: "Lead" as const,
          title: lead.leadName,
          pillar: lead.relatedPillar || "Unassigned",
          owner: lead.owner || founderPerson?.name || "Founder",
          whatIsChanging: "This live lead is currently carried by the founder.",
          whyItMatters: "Delegating routine pipeline ownership reduces founder dependency while keeping commercial follow-up accountable.",
          founderIntervention: "No" as const,
          delegationAction: "Transfer pipeline ownership to an active operational owner",
          suitability,
        };
      }),
    ...input.activeOwnershipProblems
      .filter((problem) => isFounderOwned(founderPerson, input.orderedPeople, problem) && problem.severity !== "Critical" && problem.problemStatus !== "Action required")
      .map((problem) => ({
        id: problem.id,
        objectType: "Problem" as const,
        title: problem.problemStatement,
        pillar: getAreaText(problem) || "Unassigned",
        owner: problem.owner || founderPerson?.name || "Founder",
        whatIsChanging: "This unresolved, non-critical problem is currently carried by the founder.",
        whyItMatters: "Assigning investigation and resolution to an operational owner reduces founder dependency without delegating an explicit authority decision.",
        founderIntervention: "No" as const,
        delegationAction: "Transfer investigation and resolution to an active operational owner",
        suitability: problem.severity === "Low" ? 5 : problem.severity === "Medium" ? 20 : 40,
      })),
  ].sort((left, right) => left.suitability - right.suitability || left.title.localeCompare(right.title))
    .slice(0, 6)
    .map(({ suitability: _suitability, ...item }) => item);

  const founderReviewDecisionById = new Map(
    founderReviewCandidates
      .filter((item) => item.objectType === "Decision")
      .map((item) => [item.id, item]),
  );
  const founderAuthorityCandidates = [
    ...activeProjects
      .filter((project) => project.status.trim().toLowerCase() === "blocked" && project.area.trim() !== "")
      .map((project) => {
        const linkedFounderReviewDecisions = (project.relatedDecisionIds || [])
          .map((decisionId) => founderReviewDecisionById.get(decisionId))
          .filter((decision): decision is FounderReviewCandidate => Boolean(decision));
        const targetTime = project.targetCompletionDate ? new Date(`${project.targetCompletionDate}T00:00:00`).getTime() : 0;
        const targetUrgency = targetTime && !Number.isNaN(targetTime)
          ? targetTime < nowMs ? 30 : targetTime <= nowMs + 7 * 24 * 60 * 60 * 1000 ? 15 : 0
          : 0;
        const linkedDecisionStrength = linkedFounderReviewDecisions.some((decision) => decision.reasonCategory === "Critical escalation")
          ? 40
          : linkedFounderReviewDecisions.length > 0 ? 20 : 0;
        return {
          id: project.id,
          objectType: "Project" as const,
          title: project.projectName,
          pillar: project.area,
          owner: project.owner || "Unassigned",
          reasonCategory: "Blocked project decision" as const,
          whatIsChanging: "This active project is blocked and needs a decision on sequencing, resourcing or scope.",
          whyItMatters: linkedFounderReviewDecisions.length > 0
            ? `The blocked project is preventing delivery and is linked to ${linkedFounderReviewDecisions.length} Decision${linkedFounderReviewDecisions.length === 1 ? "" : "s"} that already meet founder-review criteria.`
            : "The blocked project is preventing delivery, revenue timing or plan confidence in its area.",
          founderIntervention: "Yes" as const,
          delegationAction: "Escalate to founder or executive decision on how to unblock",
          authorityScore: 80 + linkedDecisionStrength + targetUrgency,
        };
      }),
    ...input.opportunities
      .filter((opportunity) => {
        const hasSettledDecision = input.decisions.some((decision) => decision.relatedOpportunity === opportunity.id && ["Completed", "Reversed"].includes(decision.decisionStatus));
        return ["Evaluating", "Approved"].includes(opportunity.status)
          && ["High", "Exceptional"].includes(opportunity.strategicFit)
          && !hasSettledDecision;
      })
      .map((opportunity) => {
        const linkedFounderReviewDecision = founderReviewCandidates.find((item) =>
          item.objectType === "Decision" && input.decisions.some((decision) => decision.id === item.id && decision.relatedOpportunity === opportunity.id),
        );
        return {
          id: opportunity.id,
          objectType: "Opportunity" as const,
          title: opportunity.opportunityTitle,
          pillar: opportunity.relatedPillar || opportunity.relatedArea || "Unassigned",
          owner: opportunity.owner || "Unassigned",
          reasonCategory: "Strategic opportunity approval" as const,
          whatIsChanging: `This ${opportunity.strategicFit.toLowerCase()}-fit opportunity remains ${opportunity.status.toLowerCase()} without a settled linked Decision.`,
          whyItMatters: linkedFounderReviewDecision
            ? `The opportunity needs deliberate approval and its linked Decision already meets founder-review criteria: ${linkedFounderReviewDecision.reasonCategory.toLowerCase()}.`
            : "This opportunity could materially change revenue or allocation, so it needs a deliberate strategic decision rather than casual drift.",
          founderIntervention: "Yes" as const,
          delegationAction: "Escalate to founder approval or strategic decision",
          authorityScore: (opportunity.strategicFit === "Exceptional" ? 70 : 50) + (linkedFounderReviewDecision ? 20 : 0),
        };
      }),
  ];
  const founderAuthorityItems = [...founderAuthorityCandidates.reduce((items, item) => {
    const key = `${item.objectType}:${item.id}`;
    const existing = items.get(key);
    if (!existing || item.authorityScore > existing.authorityScore) items.set(key, item);
    return items;
  }, new Map<string, FounderAuthorityCandidate>()).values()]
    .sort((left, right) => right.authorityScore - left.authorityScore || `${left.objectType}:${left.id}`.localeCompare(`${right.objectType}:${right.id}`));
  const founderAuthorityDisplayItems = founderAuthorityItems.slice(0, 8);
  const founderReviewQueue = mergeFounderReviewQueue(founderReviewCandidates, founderAuthorityItems);
  return {
    founderReviewQueue,
    crossPillarIssues,
    delegateItems,
    delegationCapacityNames: readiness.readyPeople.map((person) => person.name),
    delegationReadinessGapNames: readiness.readinessGapPeople.map((person) => person.name),
    founderAuthorityItems,
    founderAuthorityDisplayItems,
  };
}
