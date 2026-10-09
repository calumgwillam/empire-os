import type { StrategicRiskConvergence } from "./strategic-risk-resolution";
import type { IcarusObservationExecutionIndex } from "./icarus-observation-action";
import { buildLeadFollowThrough, type LeadFollowThroughInput } from "./lead-follow-through";
import { buildLeadDelivery, getDeliveryIncomeEvidence, hasSupportedFinanceActionCompletion, type LeadDeliveryInput } from "./lead-delivery";
import { buildJobPerformance, getJobExpenseErrors, type JobPerformanceInput } from "./job-performance";
import { buildCommercialLearning, type CommercialLearningInput } from "./commercial-learning";
import type {
  ActionRecord,
  DecisionRecord,
  LessonRecord,
  OpportunityRecord,
  ProblemRecord,
  SopRecord,
  SystemRecord,
} from "./capture-conversions";
import type { CommitmentCertainty, CommitmentRecord, ProcurementApprovalStatus } from "./finance";
import { isOutreachFollowUpExcluded, type OutreachRecord } from "./crm";
import type { ProjectRecord } from "./projects";
import { buildLearningAttention, type LearningAttentionInput } from "./learning-attention";
import { buildLearningCommandAdapter } from "./learning-command-adapter";
import {
  getIcarusCommandPlacement,
  type IcarusAttentionReference,
  type IcarusStrategicSignal,
} from "./icarus-strategic-attention";
import {
  getActionDependencyBlocker,
  type HandoffObjectType,
  type HandoffReviewState,
} from "./execution-release";
import {
  getEffectiveProjectHealth,
  isProjectReviewDue,
  isProjectReviewFuture,
} from "./projects";

type AttentionObjectType = "Problem" | "Action" | "Decision" | "Opportunity" | "Project" | "Lead" | "Lesson" | "System" | "SOP" | "Outreach" | "Finance" | "Icarus";
type AttentionNavigationMode = "direct" | "record-handler";

type AttentionTarget =
  | { kind: "record"; objectType: "Problem" | "Decision"; id: string }
  | { kind: "accountability"; personId: string };

export type CommandAttentionItem = {
  id: string;
  objectType: AttentionObjectType;
  title: string;
  reason: string;
  reasons: string[];
  statusText: string;
  area: string;
  attentionRank: number;
  tieWeight: number;
  priorityScore: number;
  sortDate: number;
  sortDateAscending: boolean;
  targetCompletionDate?: string;
  navigationMode: AttentionNavigationMode;
  sourceIndex?: number;
  dependencyAction?: {
    label: string;
    target: AttentionTarget;
  };
  strategicRisk?: {
    summary: string;
    references: IcarusAttentionReference[];
    // On a standalone strategic-risk item: the reason a host item carries if the risk is folded into it.
    anchoredReason?: string;
  };
  // The operational priority before any strategic-risk enrichment; correlation uses this so that enrichment
  // cannot change which record roots a situation.
  operationalPriorityScore?: number;
  // Set when a standalone strategic risk was folded into this item because both belong to one convergent situation.
  convergentStrategicRisk?: {
    clusterKey: string;
    rootRecordKey: string;
    riskRecordKeys: string[];
  };
};

export type CommandAttentionHandoffInput = {
  objectType: HandoffObjectType;
  objectId: string;
  title: string;
  newOwner: string;
  newOwnerPersonId: string;
  transferredAt: string;
  reviewDate?: string;
  reviewState: HandoffReviewState;
  reviewReasons: readonly string[];
  area: string;
  targetCompletionDate?: string;
};

type ProcurementReadinessState = "Researching" | "Price found" | "Ready to buy" | "Pending validation" | "Wait" | "Blocked" | "Purchased";

type CommandAttentionProcurementInput = {
  commitment: Pick<CommitmentRecord, "id" | "commitmentName" | "expectedPurchaseDate" | "dueDate" | "dateCreated" | "relatedPillar">;
  effectiveCertainty: CommitmentCertainty;
  approvalStatus: ProcurementApprovalStatus;
  readinessState: ProcurementReadinessState;
  readinessReason: string;
  isRejected: boolean;
  isCommitted: boolean;
};

export type CommandAttentionInput = {
  problems: readonly Pick<ProblemRecord, "id" | "severity" | "frequency" | "problemStatus" | "problemStatement" | "title" | "owner" | "createdAt" | "relatedArea" | "relatedPillar">[];
  actions: readonly (Pick<ActionRecord, "id" | "status" | "priority" | "dueDate" | "followUpDate" | "followUpNote" | "createdDate" | "createdAt" | "actionTitle" | "title" | "relatedPillar" | "relatedArea" | "relatedProblem" | "relatedDecision">
    & Partial<Pick<ActionRecord, "relatedLeadId" | "owner" | "ownerPersonId" | "completionEvidence" | "completionDate">>)[];
  leads?: LeadFollowThroughInput["leads"];
  commercialPeople?: LeadFollowThroughInput["people"];
  delivery?: Omit<LeadDeliveryInput, "nowMs">;
  jobPerformance?: Omit<JobPerformanceInput, "nowMs">;
  commercialLearning?: Omit<CommercialLearningInput, "nowMs">;
  outreach: readonly Pick<OutreachRecord, "id" | "businessName" | "status" | "nextFollowUpDate">[];
  projects: readonly Pick<ProjectRecord, "id" | "projectName" | "area" | "status" | "health" | "nextReviewDate" | "reviewNote" | "targetCompletionDate" | "startDate">[];
  decisions: readonly Pick<DecisionRecord, "id" | "decisionTitle" | "title" | "decisionStatus" | "reviewDate" | "createdAt" | "relatedArea" | "relatedPillar">[];
  opportunities: readonly Pick<OpportunityRecord, "id" | "opportunityTitle" | "title" | "status" | "strategicFit" | "dateIdentified" | "createdAt" | "relatedArea" | "relatedPillar">[];
  lessons: readonly Pick<LessonRecord, "id" | "lessonTitle" | "title" | "status" | "dateLearned" | "createdAt" | "relatedArea" | "relatedPillar">[];
  systems: readonly Pick<SystemRecord, "id" | "systemName" | "title" | "status" | "lastReviewed" | "createdAt" | "relatedArea" | "relatedPillar">[];
  sops: readonly Pick<SopRecord, "id" | "sopTitle" | "title" | "status" | "reviewDate" | "createdAt" | "relatedArea" | "relatedPillar">[];
  handoffs: readonly CommandAttentionHandoffInput[];
  procurementQueue: readonly CommandAttentionProcurementInput[];
  learning?: readonly LearningAttentionInput[];
  icarus?: readonly IcarusStrategicSignal[];
  icarusObservationExecution?: IcarusObservationExecutionIndex;
  nowMs?: number;
};

export type CommandAttentionResult = {
  groups: Record<string, CommandAttentionItem[]>;
  items: CommandAttentionItem[];
};

function getAreaText(record: { relatedArea?: string; relatedPillar?: string; area?: string }): string {
  return record.relatedPillar || record.relatedArea || record.area || "";
}

function getDateValue(value?: string): number {
  if (!value) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatCapturedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function getDaysOverdue(dateValue: string, nowMs: number): number {
  const dueDate = getDateValue(dateValue);
  if (!dueDate || dueDate >= nowMs) return 0;
  return Math.max(1, Math.ceil((nowMs - dueDate) / (1000 * 60 * 60 * 24)));
}

export function getProblemPriorityScore(problem: Pick<ProblemRecord, "severity" | "problemStatus">): number {
  let score = 0;
  if (problem.severity === "Critical") score += 150;
  else if (problem.severity === "High") score += 110;

  if (problem.problemStatus === "Open") score += 35;
  else if (problem.problemStatus === "Action required") score += 30;
  else if (problem.problemStatus === "Investigating") score += 20;
  return score;
}

export function getActionPriorityScore(action: Pick<ActionRecord, "status" | "priority" | "dueDate">, nowMs = Date.now()): number {
  let score = 0;
  if (action.status === "Blocked") score += 140;

  if (action.priority === "Critical") score += 120;
  else if (action.priority === "High") score += 90;

  if (action.dueDate) {
    const dueDate = getDateValue(action.dueDate);
    const daysUntilDue = (dueDate - nowMs) / (1000 * 60 * 60 * 24);
    if (dueDate && daysUntilDue < 0) score += 180;
    else if (daysUntilDue <= 7) score += 60;
  }

  if (action.status === "In Progress") score += 20;
  return score;
}

export function getDecisionPriorityScore(decision: Pick<DecisionRecord, "decisionStatus" | "reviewDate">, nowMs = Date.now()): number {
  let score = 0;
  if (decision.decisionStatus === "Under Review") score += 40;

  if (decision.reviewDate) {
    const reviewDate = getDateValue(decision.reviewDate);
    if (reviewDate && reviewDate <= nowMs) score += 150;
    else score += 60;
  }
  return score;
}

export function getOpportunityPriorityScore(opportunity: Pick<OpportunityRecord, "status" | "strategicFit">): number {
  let score = 0;
  if (opportunity.status === "Evaluating") score += 35;
  if (opportunity.strategicFit === "Exceptional") score += 110;
  else if (opportunity.strategicFit === "High") score += 90;
  return score;
}

export function getLessonPriorityScore(lesson: Pick<LessonRecord, "status">): number {
  return lesson.status === "Change Required" ? 80 : 0;
}

export function getSystemPriorityScore(system: Pick<SystemRecord, "status">): number {
  return system.status === "Reviewing" ? 65 : 0;
}

export function getSopPriorityScore(sop: Pick<SopRecord, "reviewDate">, nowMs = Date.now()): number {
  if (!sop.reviewDate) return 0;
  const reviewDate = getDateValue(sop.reviewDate);
  return reviewDate <= nowMs ? 150 : 60;
}

export function compareAttentionItems(left: CommandAttentionItem, right: CommandAttentionItem): number {
  if (left.attentionRank !== right.attentionRank) return left.attentionRank - right.attentionRank;
  if (left.tieWeight !== right.tieWeight) return right.tieWeight - left.tieWeight;
  if (left.sortDate !== right.sortDate) {
    return left.sortDateAscending ? left.sortDate - right.sortDate : right.sortDate - left.sortDate;
  }
  const titleOrder = left.title.localeCompare(right.title);
  return titleOrder || left.id.localeCompare(right.id);
}

export function orderAttentionReasons(reasons: readonly string[]): string[] {
  const getReasonRank = (reason: string) => {
    if (reason === "BLOCKED") return 1;
    if (reason.startsWith("PROCUREMENT BLOCKED")) return 1;
    if (reason.startsWith("OVERDUE BY ")) return 2;
    if (reason.includes("SEVERITY")) return 3;
    if (reason.startsWith("ICARUS")) return 3;
    if (reason.startsWith("REVIEW ")) return 4;
    if (reason.startsWith("PROCUREMENT READY")) return 4;
    if (reason === "CRITICAL PRIORITY" || reason === "HIGH PRIORITY") return 5;
    if (reason.startsWith("STRATEGIC FIT:")) return 6;
    return 7;
  };

  return [...reasons].sort((left, right) => {
    const rankDifference = getReasonRank(left) - getReasonRank(right);
    return rankDifference || left.localeCompare(right);
  });
}

function isActionActive(action: Pick<ActionRecord, "status">): boolean {
  return ["Open", "In Progress", "Blocked"].includes(action.status) || action.status === "Waiting";
}

function isProblemUnresolved(problem: Pick<ProblemRecord, "problemStatus">): boolean {
  return ["Open", "Investigating", "Action required"].includes(problem.problemStatus);
}

function isDecisionActive(decision: Pick<DecisionRecord, "decisionStatus">): boolean {
  return ["Draft", "Active", "Under Review"].includes(decision.decisionStatus);
}

function isProjectActive(project: Pick<ProjectRecord, "status">): boolean {
  return !["completed", "closed", "final", "cancelled", "canceled"].includes(project.status.trim().toLowerCase());
}

function isActionFollowUpFuture(action: Pick<ActionRecord, "followUpDate">, nowMs: number): boolean {
  if (!action.followUpDate) return false;
  const followUpMs = new Date(`${action.followUpDate.slice(0, 10)}T00:00:00`).getTime();
  return !Number.isNaN(followUpMs) && followUpMs > new Date(nowMs).setHours(0, 0, 0, 0);
}

function isActionFollowUpDue(action: Pick<ActionRecord, "followUpDate">, nowMs: number): boolean {
  if (!action.followUpDate) return false;
  const followUpMs = new Date(`${action.followUpDate.slice(0, 10)}T00:00:00`).getTime();
  return !Number.isNaN(followUpMs) && followUpMs <= new Date(nowMs).setHours(0, 0, 0, 0);
}

function classifyOutreachFollowUp(
  contact: Pick<OutreachRecord, "status" | "nextFollowUpDate">,
  startOfTodayMs: number,
): "Overdue" | "Due today" | "Upcoming" | "No follow-up scheduled" | null {
  if (isOutreachFollowUpExcluded(contact.status)) return null;
  if ((contact.status === "Future Phone Follow-Up" || contact.status === "Not Contacted") && !contact.nextFollowUpDate) return null;
  if (!contact.nextFollowUpDate) return "No follow-up scheduled";
  const dueMs = new Date(`${contact.nextFollowUpDate.slice(0, 10)}T00:00:00`).getTime();
  if (Number.isNaN(dueMs)) return "No follow-up scheduled";
  if (dueMs < startOfTodayMs) return "Overdue";
  if (dueMs === startOfTodayMs) return "Due today";
  return "Upcoming";
}

export function buildCommandAttention(input: CommandAttentionInput): CommandAttentionResult {
  const now = input.nowMs ?? Date.now();
  const groups: Record<string, CommandAttentionItem[]> = {};
  const uniqueByKey = new Map<string, CommandAttentionItem>();

  const addAttentionItem = (
    groupName: string,
    item: Omit<CommandAttentionItem, "navigationMode"> & { navigationMode?: AttentionNavigationMode },
  ) => {
    const policyItem: CommandAttentionItem = {
      ...item,
      navigationMode: item.navigationMode ?? (item.objectType === "Outreach" || item.objectType === "Finance" ? "record-handler" : "direct"),
    };
    const key = `${policyItem.objectType}:${policyItem.id}`;
    const existing = uniqueByKey.get(key);
    if (existing) {
      const mergedReasons = orderAttentionReasons(Array.from(new Set([...existing.reasons, ...policyItem.reasons])));
      existing.reasons = mergedReasons;
      existing.reason = mergedReasons.join(" • ");
      if (!groups[groupName]) groups[groupName] = [];
      const currentIndex = groups[groupName].findIndex((entry) => entry.id === policyItem.id && entry.objectType === policyItem.objectType);
      if (currentIndex === -1) groups[groupName].push(existing);
      return;
    }

    policyItem.reasons = orderAttentionReasons(policyItem.reasons);
    policyItem.reason = policyItem.reasons.join(" • ");
    uniqueByKey.set(key, policyItem);
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(policyItem);
  };

  input.problems.forEach((problem, sourceIndex) => {
    const reasons: string[] = [];
    const unresolved = isProblemUnresolved(problem);
    const recurring = problem.frequency === "Recurring" || problem.frequency === "Persistent";
    if (unresolved && recurring) {
      reasons.push("RECURRING PROBLEM");
      reasons.push(problem.frequency.toUpperCase());
    }
    if (unresolved && ["Critical", "High"].includes(problem.severity)) {
      reasons.push(`${problem.severity.toUpperCase()} SEVERITY`);
      reasons.push(problem.problemStatus.toUpperCase());
    }

    if (reasons.length > 0) {
      addAttentionItem(reasons[0], {
        id: problem.id,
        objectType: "Problem",
        title: problem.problemStatement || problem.title,
        reason: reasons.join(" • "),
        reasons,
        statusText: `${problem.severity} / ${problem.frequency} / ${problem.problemStatus}`,
        area: getAreaText(problem),
        attentionRank: recurring ? 2 : problem.severity === "Critical" ? 3 : 4,
        tieWeight: recurring ? 3 : problem.severity === "Critical" ? 2 : 1,
        priorityScore: getProblemPriorityScore(problem) + (recurring ? 120 : 0),
        sortDate: getDateValue(problem.createdAt),
        sortDateAscending: false,
        sourceIndex,
      });
    }
  });

  input.actions.forEach((action, sourceIndex) => {
    const reasons: string[] = [];
    const dependencyBlocker = getActionDependencyBlocker(action, input.problems, input.decisions);
    if (!isActionActive(action)) return;

    const dueDateValue = getDateValue(action.dueDate);
    const isOverdue = dueDateValue > 0 && dueDateValue < now;
    const followUpIsFuture = isActionFollowUpFuture(action, now);
    const followUpIsDue = isActionFollowUpDue(action, now);
    const suppressUntilFollowUp = followUpIsFuture && !isOverdue && action.priority !== "Critical";
    if (suppressUntilFollowUp) return;

    if (followUpIsDue) reasons.push(action.status === "Waiting" ? "WAITING FOLLOW-UP DUE" : "FOLLOW-UP REVIEW DUE");
    if (["Critical", "High"].includes(action.priority)) {
      reasons.push(`${action.priority.toUpperCase()} PRIORITY`);
      reasons.push(action.status.toUpperCase());
    }
    if (action.status === "Blocked" && (followUpIsDue || !action.followUpDate || ["High", "Critical"].includes(action.priority))) {
      if (!reasons.includes("BLOCKED")) reasons.push("BLOCKED");
      if (action.followUpNote?.trim()) reasons.push(`BLOCKER: ${action.followUpNote.trim()}`);
    }
    if (dependencyBlocker && (action.status !== "Waiting" || followUpIsDue || isOverdue || action.priority === "Critical")) {
      reasons.push(dependencyBlocker.reason);
    }

    if (action.dueDate) {
      const dueDate = new Date(action.dueDate);
      if (!Number.isNaN(dueDate.getTime())) {
        const daysUntilDue = (dueDate.getTime() - now) / (1000 * 60 * 60 * 24);
        if (daysUntilDue < 0) reasons.push(`OVERDUE BY ${getDaysOverdue(action.dueDate, now)} DAY${getDaysOverdue(action.dueDate, now) === 1 ? "" : "S"}`);
        else if (daysUntilDue <= 7) reasons.push("DUE WITHIN 7 DAYS");
      }
    }

    const alreadyFlagged = reasons.length > 0;
    if (!alreadyFlagged && action.status === "In Progress" && !followUpIsFuture) {
      const referenceTime = getDateValue(action.dueDate) || getDateValue(action.createdDate || action.createdAt);
      if (referenceTime > 0) {
        const daysSinceReference = Math.floor((now - referenceTime) / (1000 * 60 * 60 * 24));
        if (daysSinceReference >= 14) reasons.push("STALE IN-PROGRESS ACTION");
      }
    }

    if (reasons.length > 0) {
      addAttentionItem(reasons[0], {
        id: action.id,
        objectType: "Action",
        title: action.actionTitle || action.title,
        reason: reasons.join(" • "),
        reasons,
        statusText: `${action.status} / ${action.priority} / ${action.dueDate ? formatCapturedAt(action.dueDate) : "No due date"}${action.followUpDate ? ` / Follow-up ${action.followUpDate}` : ""}`,
        area: getAreaText(action),
        attentionRank: action.status === "Blocked" || Boolean(dependencyBlocker) ? 1 : action.dueDate && getDateValue(action.dueDate) < now ? 2 : ["Critical", "High"].includes(action.priority) ? 6 : reasons[0] === "STALE IN-PROGRESS ACTION" ? 7 : 8,
        tieWeight: action.priority === "Critical" ? 2 : action.priority === "High" ? 1 : 0,
        priorityScore: reasons[0] === "STALE IN-PROGRESS ACTION" ? 65 : getActionPriorityScore(action, now),
        sortDate: getDateValue(action.dueDate || action.createdAt),
        sortDateAscending: Boolean(action.dueDate),
        sourceIndex,
        dependencyAction: dependencyBlocker ? {
          label: dependencyBlocker.label,
          target: { kind: "record", objectType: dependencyBlocker.objectType, id: dependencyBlocker.id },
        } : undefined,
      });
    }
  });

  if (input.leads) {
    const commercial = buildLeadFollowThrough({
      leads: input.leads, actions: input.actions, people: input.commercialPeople ?? [], nowMs: now,
    });
    commercial.filter((view) => view.reasons.length).forEach((view) => {
      const lead = input.leads?.find((record) => record.id === view.leadId);
      if (!lead) return;
      const linked = [...view.activeActionIds, ...view.completedActionIds]
        .map((id) => uniqueByKey.get(`Action:${id}`))
        .filter((item): item is CommandAttentionItem => Boolean(item)).sort(compareAttentionItems)[0];
      const nextStepAction = input.actions.find((action) => view.activeActionIds.includes(action.id));
      const rank = view.state === "Blocked" ? 1 : view.overdue ? 2 : 4;
      if (linked) {
        addAttentionItem("COMMERCIAL FOLLOW-THROUGH", { ...linked, reasons: [...view.reasons], reason: view.reasons.join(" • ") });
        linked.attentionRank = Math.min(linked.attentionRank, rank);
      } else if (nextStepAction) {
        addAttentionItem("COMMERCIAL FOLLOW-THROUGH", {
          id: nextStepAction.id, objectType: "Action", title: nextStepAction.actionTitle || nextStepAction.title,
          reasons: [...view.reasons], reason: view.reasons.join(" • "),
          statusText: `${nextStepAction.status} / ${view.state}`, area: getAreaText(nextStepAction),
          attentionRank: rank, tieWeight: 0, priorityScore: getActionPriorityScore(nextStepAction, now),
          sortDate: getDateValue(view.nextStepBy), sortDateAscending: true,
          sourceIndex: input.actions.indexOf(nextStepAction),
        });
      } else {
        addAttentionItem("COMMERCIAL FOLLOW-THROUGH", {
          id: lead.id, objectType: "Lead", title: lead.leadName,
          reasons: [...view.reasons], reason: view.reasons.join(" • "),
          statusText: `${lead.status} / ${view.state} / ${lead.owner || "Unassigned"}`,
          area: lead.relatedPillar, attentionRank: rank, tieWeight: 0, priorityScore: 100,
          sortDate: getDateValue(view.nextStepBy || lead.dateReceived || lead.dateCreated),
          sortDateAscending: true, navigationMode: "record-handler",
        });
      }
    });
    input.actions.filter((action) => {
      if (!action.relatedLeadId) return false;
      const leads = input.leads?.filter((lead) => lead.id === action.relatedLeadId) ?? [];
      return leads.length !== 1 || (Boolean(leads[0].archived || ["Won", "Lost"].includes(leads[0].status))
        && ["Open", "In Progress", "Blocked", "Waiting"].includes(action.status));
    }).forEach((action) => {
      const related = input.leads?.filter((lead) => lead.id === action.relatedLeadId) ?? [];
      const reason = related.length !== 1 ? "COMMERCIAL: Linked Lead is missing or ambiguous"
        : "COMMERCIAL: Sales scope is closed or archived; review the outstanding next-step Action";
      addAttentionItem("COMMERCIAL LINKAGE REVIEW", {
        id: action.id, objectType: "Action", title: action.actionTitle || action.title,
        reason, reasons: [reason],
        statusText: `${action.status} / Commercial linkage review`, area: getAreaText(action),
        attentionRank: 4, tieWeight: 0, priorityScore: 100, sortDate: 0, sortDateAscending: false,
        sourceIndex: input.actions.indexOf(action),
      });
    });
  }

  if (input.delivery) {
    const delivery = { ...input.delivery, nowMs: now };
    const addDeliveryAttention = (id: string, objectType: "Lead" | "Action" | "Finance", title: string,
      area: string, reasons: string[], rank: number) => {
      const existing = uniqueByKey.get(`${objectType}:${id}`);
      addAttentionItem("CUSTOMER DELIVERY", existing ? { ...existing, reasons } : {
        id, objectType, title, area, reasons, reason: reasons.join(" • "), statusText: "Delivery accountability review",
        attentionRank: rank, tieWeight: 0, priorityScore: 100, sortDate: 0, sortDateAscending: false,
        navigationMode: "record-handler",
      });
      if (existing) existing.attentionRank = Math.min(existing.attentionRank, rank);
    };
    const deliveryViews = buildLeadDelivery(delivery);
    deliveryViews.map((view) => ({
      ...view,
      reasons: view.reasons.filter((reason) => !reason.startsWith("DELIVERY FINANCE:")
        || reason.includes("no linked financial record")),
    })).filter((view) => view.reasons.length).forEach((view) => {
      const lead = delivery.leads.find((entry) => entry.id === view.leadId);
      if (!lead) return;
      const action = delivery.actions.filter((entry) => entry.id === view.actionId);
      const host = view.executionLinked && action.length === 1 ? action[0] : undefined;
      addDeliveryAttention(host?.id || lead.id, host ? "Action" : "Lead", host?.title || lead.leadName,
        lead.relatedPillar, view.reasons, view.blocked ? 1 : view.overdue || view.financial.some((record) => record.overdue) ? 2 : 4);
    });
    delivery.actions.filter((action) => action.deliveryLeadId).forEach((action) => {
      const leads = delivery.leads.filter((lead) => lead.id === action.deliveryLeadId
        && lead.deliveryCommitment?.actionId === action.id);
      if (leads.length !== 1) addDeliveryAttention(action.id, "Action", action.title, "", [
        "DELIVERY: Action customer commitment is missing, ambiguous or mismatched",
      ], 4);
    });
    delivery.actions.filter((action) => action.financeIncomeId).forEach((action) => {
      const incomes = delivery.income.filter((record) => record.id === action.financeIncomeId);
      const reference = action.financeIncomeRole === "Billing" ? incomes[0]?.billingActionId
        : action.financeIncomeRole === "Collection" ? incomes[0]?.collectionActionId : undefined;
      const completedHistory = hasSupportedFinanceActionCompletion(action, delivery);
      if (incomes.length !== 1 || (reference !== action.id && !completedHistory)) addDeliveryAttention(action.id, "Action", action.title, "", [
        "DELIVERY FINANCE: Action Income linkage is missing, ambiguous or mismatched",
      ], 4);
    });
    delivery.income.forEach((record) => {
      const finance = getDeliveryIncomeEvidence(record, delivery);
      const leads = delivery.leads.filter((lead) => lead.id === record.relatedLeadId);
      const reasons = [...finance.reasons];
      if (deliveryViews.some((view) => view.leadId === record.relatedLeadId && view.completionSupported) && !finance.invoiced) {
        reasons.push("DELIVERY FINANCE: Completed delivery has no evidenced invoice; review billing responsibility");
        if (!finance.billingOwnerAssigned) reasons.push("DELIVERY FINANCE: Completed delivery has no billing owner");
        if (!finance.billingActionTracked) reasons.push("DELIVERY FINANCE: Completed delivery has no tracked billing Action");
      }
      if (record.relatedLeadId && (leads.length !== 1 || !leads[0].deliveryCommitment)) {
        reasons.push("DELIVERY FINANCE: Linked customer commitment is missing or ambiguous");
      }
      if (reasons.length) addDeliveryAttention(`income:${record.id}`, "Finance",
        record.description, record.area, reasons,
        finance.workflowReasons.some((reason) => reason.toLowerCase().includes("blocked")) ? 1
          : finance.overdue || finance.collectionStatus === "Disputed" ? 2 : 4);
    });
  }

  if (input.jobPerformance) {
    buildJobPerformance({ ...input.jobPerformance, nowMs: now }).filter((job) => job.reasons.length).forEach((job) => {
      const rank = job.knownCostsExceedEarned || (job.contribution !== null && job.contribution < 0)
        || (job.profitAfterAllocatedCosts !== null && job.profitAfterAllocatedCosts < 0) ? 2 : 4;
      const existing = uniqueByKey.get(`Lead:${job.leadId}`);
      addAttentionItem("JOB FINANCIAL PERFORMANCE", {
        id: job.leadId, objectType: "Lead", title: job.title, area: job.area,
        reasons: job.reasons, reason: job.reasons.join(" • "), statusText: "Job financial review",
        attentionRank: rank,
        tieWeight: 0, priorityScore: 100, sortDate: 0, sortDateAscending: false, navigationMode: "record-handler",
      });
      if (existing) existing.attentionRank = Math.min(existing.attentionRank, rank);
    });
    const jobInput = { ...input.jobPerformance, nowMs: now };
    jobInput.expenses.filter((expense) => expense.relatedLeadId && jobInput.leads.filter((lead) =>
      lead.id === expense.relatedLeadId && lead.deliveryCommitment).length !== 1).forEach((expense) => {
      const reasons = getJobExpenseErrors(expense, jobInput).map((reason) => `JOB FINANCE: ${reason}`);
      addAttentionItem("JOB FINANCIAL PERFORMANCE", {
        id: `expense:${expense.id}`, objectType: "Finance", title: expense.description, area: expense.area,
        reasons, reason: reasons.join(" • "), statusText: "Job cost attribution review",
        attentionRank: 4, tieWeight: 0, priorityScore: 100, sortDate: 0, sortDateAscending: false, navigationMode: "record-handler",
      });
    });
  }

  if (input.commercialLearning) {
    const context = { ...input.commercialLearning, nowMs: now };
    buildCommercialLearning(context).filter((view) => view.reasons.length).forEach((view) => {
      const lesson = context.lessons.find((entry) => entry.id === view.lessonId);
      if (lesson?.status === "Archived") return;
      const rank = view.baseline?.knownCostsExceedEarned || (view.evaluationCurrent && view.outcome === "Not improved") ? 2 : 4;
      const existing = uniqueByKey.get(`Lesson:${view.lessonId}`);
      addAttentionItem("COMMERCIAL LEARNING", {
        id: view.lessonId, objectType: "Lesson", title: view.title, area: view.area, reasons: view.reasons,
        reason: view.reasons.join(" • "), statusText: "Commercial corrective review", attentionRank: rank,
        tieWeight: 0, priorityScore: 100, sortDate: 0, sortDateAscending: false, navigationMode: "record-handler",
      });
      if (existing) existing.attentionRank = Math.min(existing.attentionRank, rank);
    });
  }
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfEightDaysFromNow = new Date(startOfToday);
  startOfEightDaysFromNow.setDate(startOfEightDaysFromNow.getDate() + 8);

  input.outreach.forEach((contact) => {
    const classification = classifyOutreachFollowUp(contact, startOfToday.getTime());
    if (classification !== "Overdue" && classification !== "Due today") return;

    const reasons: string[] = [];
    if (classification === "Overdue") {
      const days = getDaysOverdue(contact.nextFollowUpDate, now);
      reasons.push(`OVERDUE BY ${days} DAY${days === 1 ? "" : "S"}`);
    } else {
      reasons.push("OUTREACH FOLLOW-UP DUE TODAY");
    }
    addAttentionItem(reasons[0], {
      id: contact.id,
      objectType: "Outreach",
      title: contact.businessName,
      reason: reasons.join(" • "),
      reasons,
      statusText: `${contact.status} / Follow-up ${contact.nextFollowUpDate ? formatCapturedAt(contact.nextFollowUpDate) : "not set"}`,
      area: "Marketing / Growth",
      attentionRank: classification === "Overdue" ? 2 : 6,
      tieWeight: classification === "Overdue" ? 1 : 0,
      priorityScore: classification === "Overdue" ? 150 : 90,
      sortDate: getDateValue(contact.nextFollowUpDate),
      sortDateAscending: true,
    });
  });

  input.projects.forEach((project, sourceIndex) => {
    if (!isProjectActive(project)) return;
    const status = project.status.trim().toLowerCase();
    const health = getEffectiveProjectHealth(project);
    const reviewIsFuture = isProjectReviewFuture(project, now);
    const reviewIsDue = isProjectReviewDue(project, now);
    const blocked = status === "blocked" || health === "Blocked";
    const inProgress = status === "in progress";
    const open = status === "open";
    const reasons: string[] = [];
    const targetCompletionDate = project.targetCompletionDate ? new Date(`${project.targetCompletionDate}T00:00:00`) : null;
    const hasTargetCompletionDate = targetCompletionDate && !Number.isNaN(targetCompletionDate.getTime());
    const startDate = project.startDate ? new Date(`${project.startDate}T00:00:00`) : null;
    const hasStartDate = startDate && !Number.isNaN(startDate.getTime());
    const overdue = Boolean(inProgress && hasTargetCompletionDate && targetCompletionDate < startOfToday);
    const dueSoon = Boolean(inProgress && hasTargetCompletionDate && targetCompletionDate >= startOfToday && targetCompletionDate < startOfEightDaysFromNow);
    const pastStartNotStarted = Boolean(open && hasStartDate && startDate < startOfToday);
    const daysOverdue = overdue && targetCompletionDate
      ? Math.max(1, Math.floor((startOfToday.getTime() - targetCompletionDate.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;
    const referenceDate = getDateValue(project.targetCompletionDate || project.startDate);
    const daysSinceReference = referenceDate ? Math.floor((now - referenceDate) / (1000 * 60 * 60 * 24)) : 0;
    const staleActive = Boolean((open || inProgress) && !blocked && !overdue && referenceDate > 0 && daysSinceReference >= 21);
    const staleApproaching = Boolean(staleActive && inProgress && hasTargetCompletionDate && targetCompletionDate && targetCompletionDate >= startOfToday
      && (targetCompletionDate.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24) <= 14);
    const suppressRoutineAttention = reviewIsFuture && (health === "On track" || health === "Waiting") && !overdue && !blocked;

    if (blocked) {
      reasons.push("BLOCKED PROJECT");
      if (project.reviewNote?.trim()) reasons.push(`BLOCKER: ${project.reviewNote.trim()}`);
    }
    if (overdue) {
      reasons.push("OVERDUE PROJECT");
      reasons.push(`${daysOverdue} DAY${daysOverdue === 1 ? "" : "S"} OVERDUE`);
    }
    if (reviewIsDue) reasons.push(health === "At risk" ? "AT-RISK PROJECT REVIEW DUE" : health === "Waiting" ? "WAITING PROJECT REVIEW DUE" : "PROJECT REVIEW DUE");
    if (dueSoon && !suppressRoutineAttention) reasons.push("DUE WITHIN 7 DAYS");
    if (pastStartNotStarted && !suppressRoutineAttention) reasons.push("PAST START DATE • NOT STARTED");
    if (staleActive && !suppressRoutineAttention) reasons.push(staleApproaching ? "STALE PROJECT • TARGET APPROACHING" : "STALE PROJECT");

    if (reasons.length > 0) {
      addAttentionItem(reasons[0], {
        id: project.id,
        objectType: "Project",
        title: project.projectName,
        reason: reasons.join(" • "),
        reasons,
        statusText: `${project.status || "No status"} / ${health}${project.nextReviewDate ? ` / Review ${project.nextReviewDate}` : ""} / ${project.targetCompletionDate ? formatCapturedAt(project.targetCompletionDate) : "No target completion date"}`,
        area: project.area,
        attentionRank: blocked ? 1 : overdue ? 2 : dueSoon ? 3 : staleActive ? 5 : 4,
        tieWeight: 0,
        priorityScore: overdue ? 180 : dueSoon ? 120 : staleActive ? 70 : 60,
        sortDate: getDateValue(project.targetCompletionDate || project.startDate),
        sortDateAscending: Boolean(project.targetCompletionDate),
        targetCompletionDate: project.targetCompletionDate,
        sourceIndex,
      });
    }
  });

  input.decisions.forEach((decision, sourceIndex) => {
    const reasons: string[] = [];
    if (isDecisionActive(decision) && decision.decisionStatus === "Under Review") reasons.push("Under review");
    if (isDecisionActive(decision) && decision.reviewDate) {
      const reviewDate = new Date(decision.reviewDate);
      if (!Number.isNaN(reviewDate.getTime()) && reviewDate.getTime() <= now) reasons.push("REVIEW DUE");
    }
    if (reasons.length > 0) {
      addAttentionItem(reasons[0], {
        id: decision.id,
        objectType: "Decision",
        title: decision.decisionTitle || decision.title,
        reason: reasons.join(" • "),
        reasons,
        statusText: `${decision.decisionStatus} / ${decision.reviewDate ? formatCapturedAt(decision.reviewDate) : "No review date"}`,
        area: getAreaText(decision),
        attentionRank: 5,
        tieWeight: decision.decisionStatus === "Under Review" ? 1 : 0,
        priorityScore: getDecisionPriorityScore(decision, now),
        sortDate: getDateValue(decision.reviewDate || decision.createdAt),
        sortDateAscending: Boolean(decision.reviewDate),
        sourceIndex,
      });
    }
  });

  input.opportunities.forEach((opportunity, sourceIndex) => {
    const reasons: string[] = [];
    if (opportunity.status === "Evaluating" && ["High", "Exceptional"].includes(opportunity.strategicFit)) {
      reasons.push(`STRATEGIC FIT: ${opportunity.strategicFit.toUpperCase()}`);
      reasons.push("EVALUATING");
    }
    if (reasons.length > 0) {
      addAttentionItem(reasons[0], {
        id: opportunity.id,
        objectType: "Opportunity",
        title: opportunity.opportunityTitle || opportunity.title,
        reason: reasons.join(" • "),
        reasons,
        statusText: `${opportunity.status} / ${opportunity.strategicFit}`,
        area: getAreaText(opportunity),
        attentionRank: 7,
        tieWeight: opportunity.strategicFit === "Exceptional" ? 2 : 1,
        priorityScore: getOpportunityPriorityScore(opportunity),
        sortDate: getDateValue(opportunity.dateIdentified || opportunity.createdAt),
        sortDateAscending: false,
        sourceIndex,
      });
    }
  });

  input.lessons.forEach((lesson, sourceIndex) => {
    if (lesson.status !== "Change Required") return;
    addAttentionItem("Status: Change required", {
      id: lesson.id,
      objectType: "Lesson",
      title: lesson.lessonTitle || lesson.title,
      reason: "Status: Change required",
      reasons: ["Status: Change required"],
      statusText: lesson.status,
      area: getAreaText(lesson),
      attentionRank: 8,
      tieWeight: 0,
      priorityScore: getLessonPriorityScore(lesson),
      sortDate: getDateValue(lesson.dateLearned || lesson.createdAt),
      sortDateAscending: false,
      sourceIndex,
    });
  });

  input.systems.forEach((system, sourceIndex) => {
    if (system.status !== "Reviewing") return;
    addAttentionItem("Status: Reviewing", {
      id: system.id,
      objectType: "System",
      title: system.systemName || system.title,
      reason: "Status: Reviewing",
      reasons: ["Status: Reviewing"],
      statusText: system.status,
      area: getAreaText(system),
      attentionRank: 8,
      tieWeight: 0,
      priorityScore: getSystemPriorityScore(system),
      sortDate: getDateValue(system.lastReviewed || system.createdAt),
      sortDateAscending: false,
      sourceIndex,
    });
  });

  input.sops.forEach((sop, sourceIndex) => {
    if (sop.reviewDate) {
      const reviewDate = new Date(sop.reviewDate);
      if (!Number.isNaN(reviewDate.getTime()) && reviewDate.getTime() <= now) {
        addAttentionItem("Review date due or overdue", {
          id: sop.id,
          objectType: "SOP",
          title: sop.sopTitle || sop.title,
          reason: "Review date due or overdue",
          reasons: ["Review date due or overdue"],
          statusText: `${sop.status} / ${formatCapturedAt(sop.reviewDate)}`,
          area: getAreaText(sop),
          attentionRank: 8,
          tieWeight: 0,
          priorityScore: getSopPriorityScore(sop, now),
          sortDate: getDateValue(sop.reviewDate || sop.createdAt),
          sortDateAscending: Boolean(sop.reviewDate),
          sourceIndex,
        });
      }
    }
  });

  input.handoffs.forEach((handoff) => {
    if (handoff.reviewState === "Healthy" || handoff.reviewState === "Completed" || handoff.reviewState === "Cancelled") return;
    const primaryReason = handoff.reviewState === "Intervention required"
      ? `DELEGATION INTERVENTION REQUIRED: ${handoff.reviewReasons[0] || "Delegated delivery needs founder escalation."}`
      : handoff.reviewState === "At risk"
        ? `DELEGATION AT RISK: ${handoff.reviewReasons[0] || "Delegated delivery needs review."}`
        : `DELEGATION REVIEW DUE: ${handoff.reviewReasons[0] || "Scheduled handoff review is due."}`;
    const reasons = [primaryReason, ...handoff.reviewReasons.filter((reason) => reason !== handoff.reviewReasons[0])];
    const reviewDateValue = getDateValue(handoff.reviewDate || handoff.transferredAt);
    addAttentionItem(primaryReason, {
      id: handoff.objectId,
      objectType: handoff.objectType,
      title: handoff.title,
      reason: reasons.join(" • "),
      reasons,
      statusText: `${handoff.reviewState} / ${handoff.newOwner}${handoff.reviewDate ? ` / Review ${handoff.reviewDate}` : ""}`,
      area: handoff.area,
      attentionRank: handoff.reviewState === "Intervention required" ? 1 : handoff.reviewState === "At risk" ? 4 : 5,
      tieWeight: handoff.reviewState === "Intervention required" ? 3 : handoff.reviewState === "At risk" ? 1 : 0,
      priorityScore: handoff.reviewState === "Intervention required" ? 190 : handoff.reviewState === "At risk" ? 120 : 90,
      sortDate: reviewDateValue || getDateValue(handoff.transferredAt),
      sortDateAscending: true,
      targetCompletionDate: handoff.objectType === "Project" ? handoff.targetCompletionDate : undefined,
      dependencyAction: {
        label: "Review handoff",
        target: { kind: "accountability", personId: handoff.newOwnerPersonId },
      },
      navigationMode: "record-handler",
    });
  });

  input.procurementQueue.forEach((item) => {
    const purchaseDateValue = getDateValue(item.commitment.expectedPurchaseDate || item.commitment.dueDate);
    const timeSensitive = purchaseDateValue > 0 && purchaseDateValue <= now + (7 * 24 * 60 * 60 * 1000);
    const important = item.effectiveCertainty === "Committed";
    const approvedDependency = item.approvalStatus === "Approved"
      && (item.readinessState === "Blocked" || item.readinessState === "Pending validation")
      && (timeSensitive || important);
    const unreviewedReadyPurchase = item.approvalStatus === "Not reviewed"
      && item.readinessState === "Ready to buy"
      && (timeSensitive || important);
    const approvedReadyPurchase = item.approvalStatus === "Approved"
      && item.readinessState === "Ready to buy"
      && !item.isCommitted;
    if (item.isRejected || (!approvedDependency && !unreviewedReadyPurchase && !approvedReadyPurchase)) return;
    if (item.readinessState === "Ready to buy" && item.isCommitted && item.approvalStatus === "Approved") return;

    const reason = unreviewedReadyPurchase
      ? `PROCUREMENT APPROVAL REQUIRED: ${item.commitment.commitmentName} is operationally ready but has not been reviewed.`
      : item.readinessState === "Blocked"
        ? `APPROVED PROCUREMENT BLOCKED: ${item.readinessReason}`
        : item.readinessState === "Pending validation"
          ? `APPROVED PROCUREMENT VALIDATION REQUIRED: ${item.readinessReason}`
          : `APPROVED PROCUREMENT READY: ${item.commitment.commitmentName} can be committed without consuming protected cash.`;
    addAttentionItem(reason, {
      id: `commitment:${item.commitment.id}`,
      objectType: "Finance",
      title: item.commitment.commitmentName,
      reason,
      reasons: [reason],
      statusText: `${item.readinessState} / ${item.approvalStatus} / ${item.effectiveCertainty} / ${item.commitment.expectedPurchaseDate || item.commitment.dueDate || "No date"}`,
      area: item.commitment.relatedPillar,
      attentionRank: item.readinessState === "Blocked" ? 1 : item.readinessState === "Pending validation" ? 4 : 5,
      tieWeight: item.readinessState === "Blocked" ? 2 : 1,
      priorityScore: item.readinessState === "Blocked" ? 170 : item.readinessState === "Pending validation" ? 125 : 110,
      sortDate: getDateValue(item.commitment.expectedPurchaseDate || item.commitment.dueDate || item.commitment.dateCreated),
      sortDateAscending: true,
    });
  });

  if (input.learning) {
    const augmentations = buildLearningCommandAdapter(
      buildLearningAttention(input.learning).filter((candidate) => !candidate.identityKey),
      [...uniqueByKey.values()].map(({ objectType, id }) => ({ objectType, id })),
    );
    augmentations.forEach((augmentation) => {
      if (augmentation.targetResolution !== "Augment existing target") return;
      const existing = uniqueByKey.get(`${augmentation.target.objectType}:${augmentation.target.id}`);
      if (!existing) return;
      addAttentionItem(augmentation.reason, { ...existing, reason: augmentation.reason, reasons: [augmentation.reason] });
    });
  }

  input.icarusObservationExecution?.actionAttention.forEach((attention) => {
    const action = input.actions.find((record) => record.id === attention.actionId);
    if (!action) return;
    const existing = uniqueByKey.get(`Action:${action.id}`);
    addAttentionItem("ICARUS OBSERVATION EXECUTION", {
      ...(existing ?? {
        id: action.id, objectType: "Action" as const, title: action.actionTitle || action.title,
        statusText: `${action.status} / Observation verification required`, area: getAreaText(action),
        attentionRank: 3, tieWeight: 0, priorityScore: getActionPriorityScore(action, now),
        sortDate: getDateValue(action.dueDate), sortDateAscending: true,
        sourceIndex: input.actions.indexOf(action),
      }),
      reason: attention.reasons.join(" • "), reasons: [...attention.reasons],
    });
    const merged = uniqueByKey.get(`Action:${action.id}`);
    if (merged) merged.attentionRank = Math.min(3, merged.attentionRank);
  });

  if (input.icarus) {
    // Signals arrive in deterministic materiality order; anchor resolution uses the current Command order.
    input.icarus.forEach((signal) => {
      const placement = getIcarusCommandPlacement(signal);
      const treatmentReasons = signal.treatment?.attentionReasons ?? [];
      const treatmentAnnotation = treatmentReasons.length > 0
        ? ` Treatment routing: ${treatmentReasons.join("; ")}.`
        : "";
      const treatmentRank = treatmentReasons.length > 0
        ? Math.max(3, placement.attentionRank - 1)
        : placement.attentionRank;
      const monitoringOnly = signal.materialFailureModes.every((mode) => mode.lifecycleOnly)
        && signal.lifecycle?.attentionReasons.every((reason) =>
          reason.startsWith("Observation responsibility") || reason.startsWith("Observation execution")
          || reason.startsWith("Observation handoff") || reason.startsWith("Accountability gap")
          || input.icarusObservationExecution?.actionAttention.some((entry) =>
            entry.assessmentId === signal.assessmentId && entry.reasons.includes(reason)));
      const monitoringAnchors = monitoringOnly
        ? [...(input.icarusObservationExecution?.byTargetId.values() ?? [])]
          .filter((view) => view.assessmentId === signal.assessmentId)
          .flatMap((view) => view.actionIds.map((id) => ({ objectType: "Action" as const, id })))
        : [];
      const anchored = [...monitoringAnchors, ...signal.anchors]
        .map((anchor) => uniqueByKey.get(`${anchor.objectType}:${anchor.id}`))
        .filter((item): item is CommandAttentionItem => Boolean(item))
        .sort(compareAttentionItems)[0];

      if (anchored) {
        // Same underlying issue already in Command: enrich it instead of adding a duplicate item.
        addAttentionItem(placement.anchoredReason, {
          ...anchored,
          reason: `${placement.anchoredReason}${treatmentAnnotation}`,
          reasons: [`${placement.anchoredReason}${treatmentAnnotation}`],
        });
        anchored.attentionRank = Math.min(anchored.attentionRank, treatmentRank);
        anchored.tieWeight = Math.max(anchored.tieWeight, placement.tieWeight);
        if (anchored.operationalPriorityScore === undefined) anchored.operationalPriorityScore = anchored.priorityScore;
        anchored.priorityScore = Math.max(anchored.priorityScore, placement.priorityScore);
        const references = anchored.strategicRisk?.references ?? [];
        anchored.strategicRisk = {
          summary: anchored.strategicRisk?.summary ?? signal.summary,
          references: references.some((reference) => reference.identityKey === signal.key)
            ? references
            : [...references, { ...signal.primaryReference }],
        };
        return;
      }

      const placementReasons = [...placement.reasons, ...treatmentReasons];
      addAttentionItem(placement.reasons[0], {
        id: signal.assessmentId,
        objectType: "Icarus",
        title: signal.outcome,
        reason: placementReasons.join(" • "),
        reasons: placementReasons,
        statusText: placement.statusText,
        area: signal.area,
        attentionRank: treatmentRank,
        tieWeight: placement.tieWeight,
        priorityScore: placement.priorityScore,
        sortDate: 0,
        sortDateAscending: false,
        navigationMode: "record-handler",
        strategicRisk: {
          summary: signal.summary,
          references: [{ ...signal.primaryReference }],
          anchoredReason: placement.anchoredReason,
        },
      });
    });
  }

  if (input.learning) {
    const candidates = buildLearningAttention(input.learning);
    candidates.filter((candidate) => candidate.identityKey && candidate.target.objectType === "Icarus").forEach((candidate) => {
      const existing = uniqueByKey.get(`Icarus:${candidate.target.id}`)
        ?? [...uniqueByKey.values()].find((item) => item.strategicRisk?.references.some((ref) => ref.identityKey === candidate.identityKey));
      const reason = `Icarus learning: ${candidate.sourceTitle}: ${candidate.reasons?.join("; ")}`;
      if (existing) {
        addAttentionItem(reason, { ...existing, reason, reasons: [reason] });
      } else {
        addAttentionItem(reason, {
          id: candidate.target.id, objectType: "Icarus", title: candidate.sourceTitle, reason, reasons: [reason],
          statusText: "Learning review reminder / not a new strategic exposure",
          area: "Icarus", attentionRank: 5, tieWeight: 0, priorityScore: 0, sortDate: 0,
          sortDateAscending: false, navigationMode: "record-handler",
        });
      }
    });
  }
  const sortedGroups = Object.fromEntries(Object.entries(groups).map(([reason, items]) => [reason, [...items].sort(compareAttentionItems)]));
  const items = Array.from(new Map(
    Object.values(sortedGroups).flat().map((item) => [`${item.objectType}:${item.id}`, item]),
  ).values()).sort(compareAttentionItems);
  return { groups, items };
}

// Folds standalone strategic-risk items (e.g. Icarus) into an operational host already in Command when both belong
// to the same convergent situation (see strategic-risk-resolution). The risk stays navigable through the host's
// strategicRisk references. Risks with no eligible host in Command, or no convergent situation, remain standalone.
// Pure: returns new items and never mutates the input.
export function resolveCommandStrategicRiskConvergence(
  items: readonly CommandAttentionItem[],
  convergence: ReadonlyMap<string, StrategicRiskConvergence>,
  options: { isEligibleHost?: (item: CommandAttentionItem) => boolean } = {},
): CommandAttentionItem[] {
  const keyOf = (item: CommandAttentionItem) => `${item.objectType}:${item.id}`;
  const byKey = new Map(items.map((item) => [keyOf(item), item] as const));
  const merged = new Map<string, CommandAttentionItem>();
  const removed = new Set<string>();
  const isEligibleHost = options.isEligibleHost ?? (() => true);

  items
    .filter((item) => item.strategicRisk && convergence.has(keyOf(item)))
    .sort(compareAttentionItems)
    .forEach((riskItem) => {
      const riskKey = keyOf(riskItem);
      const resolution = convergence.get(riskKey)!;
      const host = resolution.hostRecordKeys
        .map((recordKey) => merged.get(recordKey) ?? byKey.get(recordKey))
        .filter((candidate): candidate is CommandAttentionItem =>
          Boolean(candidate) && !removed.has(keyOf(candidate!)) && !convergence.has(keyOf(candidate!)) && isEligibleHost(candidate!))
        .sort(compareAttentionItems)[0];
      if (!host) return;

      const riskReferences = riskItem.strategicRisk!.references;
      const hostReferences = host.strategicRisk?.references ?? [];
      const references = [
        ...hostReferences,
        ...riskReferences.filter((reference) => !hostReferences.some((existing) => existing.identityKey === reference.identityKey)),
      ];
      const anchoredReason = riskItem.strategicRisk!.anchoredReason;
      const reasons = anchoredReason ? orderAttentionReasons([...new Set([...host.reasons, anchoredReason])]) : [...host.reasons];
      const riskRecordKeys = [...new Set([...(host.convergentStrategicRisk?.riskRecordKeys ?? []), riskKey])].sort();
      merged.set(keyOf(host), {
        ...host,
        reasons,
        reason: reasons.join(" • "),
        attentionRank: Math.min(host.attentionRank, riskItem.attentionRank),
        tieWeight: Math.max(host.tieWeight, riskItem.tieWeight),
        priorityScore: Math.max(host.priorityScore, riskItem.priorityScore),
        operationalPriorityScore: host.operationalPriorityScore ?? host.priorityScore,
        strategicRisk: { summary: host.strategicRisk?.summary ?? riskItem.strategicRisk!.summary, references },
        convergentStrategicRisk: { clusterKey: resolution.clusterKey, rootRecordKey: resolution.rootRecordKey, riskRecordKeys },
      });
      removed.add(riskKey);
    });

  return items
    .filter((item) => !removed.has(keyOf(item)))
    .map((item) => merged.get(keyOf(item)) ?? item)
    .sort(compareAttentionItems);
}
