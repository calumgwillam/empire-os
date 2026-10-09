import {
  CASH_POSITION_STORAGE_KEY,
  CHANGE_HISTORY_STORAGE_KEY,
  COMMITMENT_STORAGE_KEY,
  CONVERSION_STORAGE_KEY,
  DAILY_POSTURE_SNAPSHOTS_STORAGE_KEY,
  DEFAULT_SAVED_VIEW_STORAGE_KEY,
  DELEGATION_HANDOFF_STORAGE_KEY,
  EMPIRE_OS_BACKUP_STORAGE_KEYS,
  EXPENSE_STORAGE_KEY,
  FOUNDER_INTELLIGENCE_STORAGE_KEY,
  INCOME_STORAGE_KEY,
  isPlainObject,
  isValidChangeEvent,
  LEAD_STORAGE_KEY,
  OUTREACH_STORAGE_KEY,
  PERSON_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
  SAVED_VIEWS_STORAGE_KEY,
  STORAGE_KEY,
  STRATEGIC_OBJECTIVES_STORAGE_KEY,
  STRATEGIC_REVIEWS_STORAGE_KEY,
  TAX_PAYMENT_STORAGE_KEY,
  WORKING_RELATIONSHIP_STORAGE_KEY,
} from "./backup";
import type { ActionRecord, CaptureConversionRecord, DecisionRecord, LessonRecord, OpportunityRecord, ProblemRecord, SopRecord, SystemRecord } from "./capture-conversions";
import type { LeadRecord, OutreachRecord } from "./crm";
import {
  findCrossTypeIdCollisions,
  findDuplicateIds,
  groupMissingCaptureLineage,
  summarizeIntegrityIssues,
  type CaptureLineageReference,
  type IntegritySeverity,
  type IntegrityStatus,
} from "./integrity-core";
import {
  commitmentCertaintyOptions,
  procurementApprovalStatusOptions,
  type CommitmentCertainty,
  type CommitmentRecord,
  type ProcurementApprovalStatus,
} from "./finance";
import type { ProjectRecord } from "./projects";
import {
  founderAllocations,
  isStrategicObjectiveRecord,
  reviewShapeIssues,
  strategicHorizons,
  strategicImportances,
  strategicPillars,
  strategicStatuses,
  type StrategicObjective,
  type StrategicReview,
} from "./strategic-reviews";
import type { ReviewOutcome } from "./capture-conversions";
import type { IncomeRecord } from "./finance";
import type { ExpenseRecord } from "./finance";
import { buildJobPerformance, getJobExpenseErrors } from "./job-performance";
import { buildLeadDelivery, getDeliveryIncomeEvidence, hasSupportedFinanceActionCompletion, type LeadDeliveryInput } from "./lead-delivery";

export type IntegrityIssue = {
  id: string;
  severity: IntegritySeverity;
  category: string;
  recordType: string;
  recordTitle: string;
  recordId?: string;
  reason: string;
  nextStep: string;
  openObjectType?: string;
  openId?: string;
};

export type IntegrityAuditResult = {
  auditedAt: string;
  status: IntegrityStatus;
  issues: IntegrityIssue[];
  severityCounts: Record<IntegritySeverity, number>;
  categoryCounts: Array<{ category: string; count: number }>;
};

export type IntegrityAuditCapture = {
  id: string;
  title: string;
  status: string;
  reviewOutcome?: ReviewOutcome | null;
};

export type IntegrityAuditPerson = {
  id: string;
  name: string;
  status: string;
  role?: string;
  responsibilities?: string;
  authority?: string;
};

export type IntegrityAuditHandoff = {
  id: string;
  objectType: "Action" | "Project" | "Lead" | "Problem";
  objectId: string;
  title: string;
  previousOwnerPersonId?: string;
  newOwnerPersonId: string;
  delegatedByPersonId?: string;
};

export type IntegrityAuditInput = {
  captures: IntegrityAuditCapture[];
  conversions: CaptureConversionRecord[];
  actions: ActionRecord[];
  projects: ProjectRecord[];
  problems: ProblemRecord[];
  opportunities: OpportunityRecord[];
  decisions: DecisionRecord[];
  lessons: LessonRecord[];
  systems: SystemRecord[];
  sops: SopRecord[];
  people: IntegrityAuditPerson[];
  leads: LeadRecord[];
  income?: IncomeRecord[];
  expenses?: ExpenseRecord[];
  commitments: CommitmentRecord[];
  outreach: OutreachRecord[];
  handoffs: IntegrityAuditHandoff[];
  strategicObjectives: StrategicObjective[];
  strategicReviews: StrategicReview[];
  storage: Record<string, string | null>;
  sharedAreaOptions: readonly string[];
  commitmentTypeOptions: readonly string[];
  commitmentStatusOptions: readonly string[];
  nowIso?: () => string;
};

export function runIntegrityAudit(input: IntegrityAuditInput): IntegrityAuditResult {
  const auditedAt = input.nowIso ? input.nowIso() : new Date().toISOString();
  const issues: IntegrityIssue[] = [];
  let issueSequence = 0;
  const addIssue = (issue: Omit<IntegrityIssue, "id">) => {
    issueSequence += 1;
    issues.push({ ...issue, id: `integrity-${issueSequence}` });
  };
  const idSet = <T extends { id: string }>(records: T[]) => new Set(records.map((record) => record.id).filter(Boolean));
  const captureIds = idSet(input.captures);
  const actionIds = idSet(input.actions);
  const projectIds = idSet(input.projects);
  const problemIds = idSet(input.problems);
  const opportunityIds = idSet(input.opportunities);
  const decisionIds = idSet(input.decisions);
  const lessonIds = idSet(input.lessons);
  const systemIds = idSet(input.systems);
  const sopIds = idSet(input.sops);
  const personIds = idSet(input.people);
  const leadIds = idSet(input.leads);
  const activePeopleByName = new Map(input.people.filter((person) => person.status === "Active").map((person) => [person.name.trim().toLowerCase(), person]));

  const objectiveIds = new Set<string>();
  for (const objective of input.strategicObjectives) {
    const addObjectiveIssue = (reason: string) => addIssue({ severity: "Material", category: "Strategic objectives", recordType: "Strategic Objective", recordId: objective.id, recordTitle: objective.title || "Untitled objective", reason, nextStep: "Review the objective and correct its stored fields or links." });
    if (!objective.id.trim() || objectiveIds.has(objective.id)) addObjectiveIssue("Objective ID is missing or duplicated.");
    objectiveIds.add(objective.id);
    if (!objective.title.trim() || !strategicPillars.includes(objective.pillar)) addObjectiveIssue("Title or strategic pillar is missing or unsupported.");
    if (!strategicHorizons.includes(objective.horizon) || !strategicImportances.includes(objective.importance) || !strategicStatuses.includes(objective.status) || !founderAllocations.includes(objective.founderAllocation)) addObjectiveIssue("An objective state, horizon, importance, or allocation value is unsupported.");
    for (const [ids, existing, label] of [[objective.linkedProjectIds, projectIds, "Project"], [objective.linkedOpportunityIds, opportunityIds, "Opportunity"], [objective.linkedDecisionIds, decisionIds, "Decision"]] as const) {
      if (ids.some((id) => !existing.has(id))) addObjectiveIssue(`A linked ${label} ID does not exist in the operating records.`);
    }
  }

  const reviewIds = new Set<string>();
  for (const review of input.strategicReviews) {
    const report = (reason: string) => addIssue({ severity: "Material", category: "Strategic reviews", recordType: "Strategic Review", recordId: review.id, recordTitle: review.reviewDate, reason, nextStep: "Inspect the review and its source records before making corrections." });
    if (reviewIds.has(review.id)) report("Duplicate Strategic Review ID.");
    reviewIds.add(review.id);
    if (!review.nextReviewDate || !/^\d{4}-\d{2}-\d{2}$/.test(review.nextReviewDate)) report("Next review date is missing or invalid.");
    if (review.founderAllocation.filter((entry) => entry.allocation === "Primary").length > 1 || review.founderAllocation.filter((entry) => entry.allocation === "Secondary").length > 2 || review.founderAllocation.filter((entry) => entry.allocation === "Reserve").length > 1) report("Founder allocation exceeds the review period capacity.");
    const knownObjectiveIds = review.status === "Draft" ? new Set(input.strategicObjectives.map((objective) => objective.id)) : new Set(review.evidenceSnapshot?.objectives.map((objective) => objective.id) || []);
    const knownProjectIds = review.status === "Draft" ? projectIds : new Set(review.evidenceSnapshot?.projects.map((project) => project.id) || []);
    const referencedObjectives = [...review.constraints.flatMap((entry) => entry.objectiveIds), ...review.blankSheetCandidates.flatMap((entry) => entry.objectiveIds), ...review.objectiveJudgements.map((entry) => entry.objectiveId), ...review.projectJudgements.flatMap((entry) => entry.objectiveIds), ...review.strategicGaps.flatMap((entry) => entry.objectiveIds), ...review.founderAllocation.flatMap((entry) => entry.objectiveIds)];
    if (referencedObjectives.some((id) => !knownObjectiveIds.has(id))) report("An objective reference is not present in the review evidence or current Draft data.");
    if ([...review.projectJudgements.map((entry) => entry.projectId), ...review.blankSheetCandidates.flatMap((entry) => entry.matchingProjectIds)].some((id) => !knownProjectIds.has(id))) report("A Project reference is not present in the review evidence or current Draft data.");
  }
  if (input.strategicReviews.filter((review) => review.status === "Applied").length > 1) addIssue({ severity: "Critical", category: "Strategic reviews", recordType: "Strategic Review", recordTitle: "Current review", reason: "More than one Applied Strategic Review exists.", nextStep: "Inspect review history and confirm the intended current review before changing it." });

  const captureLineageReferences: CaptureLineageReference[] = [];
  const trackMissingCaptureLineage = (captureId: string | undefined, recordType: string, recordTitle: string, recordId: string) => {
    captureLineageReferences.push({ captureId, recordType, recordTitle, recordId });
  };

  for (const problem of input.problems) {
    trackMissingCaptureLineage(problem.sourceCaptureId, "Problem", problem.problemStatement || problem.title, problem.id);
    trackMissingCaptureLineage(problem.relatedCapture, "Problem", problem.problemStatement || problem.title, problem.id);
  }
  for (const action of input.actions) {
    trackMissingCaptureLineage(action.sourceCaptureId, "Action", action.actionTitle || action.title, action.id);
    trackMissingCaptureLineage(action.relatedCapture, "Action", action.actionTitle || action.title, action.id);
  }
  for (const opportunity of input.opportunities) {
    trackMissingCaptureLineage(opportunity.sourceCaptureId, "Opportunity", opportunity.opportunityTitle || opportunity.title, opportunity.id);
    trackMissingCaptureLineage(opportunity.relatedCapture, "Opportunity", opportunity.opportunityTitle || opportunity.title, opportunity.id);
  }
  for (const decision of input.decisions) {
    trackMissingCaptureLineage(decision.sourceCaptureId, "Decision", decision.decisionTitle || decision.title, decision.id);
    trackMissingCaptureLineage(decision.relatedCapture, "Decision", decision.decisionTitle || decision.title, decision.id);
  }
  for (const lesson of input.lessons) {
    trackMissingCaptureLineage(lesson.sourceCaptureId, "Lesson", lesson.lessonTitle || lesson.title, lesson.id);
    trackMissingCaptureLineage(lesson.relatedCapture, "Lesson", lesson.lessonTitle || lesson.title, lesson.id);
  }
  for (const system of input.systems) {
    trackMissingCaptureLineage(system.sourceCaptureId, "System", system.systemName || system.title, system.id);
    trackMissingCaptureLineage(system.relatedCapture, "System", system.systemName || system.title, system.id);
  }
  for (const sop of input.sops) {
    trackMissingCaptureLineage(sop.sourceCaptureId, "SOP", sop.sopTitle || sop.title, sop.id);
    trackMissingCaptureLineage(sop.relatedCapture, "SOP", sop.sopTitle || sop.title, sop.id);
  }
  for (const project of input.projects) trackMissingCaptureLineage(project.sourceCaptureId, "Project", project.projectName, project.id);
  const missingCaptureLineageRoots = groupMissingCaptureLineage(captureIds, captureLineageReferences);

  const collectionDefinitions: Array<{ type: string; records: Array<{ id: string }>; openObjectType?: string }> = [
    { type: "Capture", records: input.captures },
    { type: "Capture conversion", records: input.conversions },
    { type: "Action", records: input.actions, openObjectType: "Action" },
    { type: "Project", records: input.projects, openObjectType: "Project" },
    { type: "Problem", records: input.problems, openObjectType: "Problem" },
    { type: "Opportunity", records: input.opportunities, openObjectType: "Opportunity" },
    { type: "Decision", records: input.decisions, openObjectType: "Decision" },
    { type: "Lesson", records: input.lessons, openObjectType: "Lesson" },
    { type: "System", records: input.systems, openObjectType: "System" },
    { type: "SOP", records: input.sops, openObjectType: "SOP" },
    { type: "Person", records: input.people, openObjectType: "Person" },
    { type: "Lead", records: input.leads, openObjectType: "Lead" },
    { type: "Financial commitment", records: input.commitments, openObjectType: "Finance" },
    { type: "Outreach", records: input.outreach, openObjectType: "Outreach" },
  ];

  for (const collection of collectionDefinitions) {
    for (const [recordId, count] of findDuplicateIds(collection.records)) {
      addIssue({
        severity: "Critical",
        category: "Duplicate IDs",
        recordType: collection.type,
        recordTitle: `${collection.type} ID collision`,
        recordId,
        reason: `${count} ${collection.type.toLowerCase()} records share the same ID, making references ambiguous.`,
        nextStep: "Review the duplicate records manually before changing any IDs or references.",
        openObjectType: collection.openObjectType,
        openId: collection.type === "Financial commitment" ? `commitment:${recordId}` : recordId,
      });
    }
  }

  for (const [recordId, types] of findCrossTypeIdCollisions(collectionDefinitions)) {
    addIssue({
      severity: "Material",
      category: "Ambiguous IDs",
      recordType: "Multiple record types",
      recordTitle: "Cross-record ID collision",
      recordId,
      reason: `The same ID is used by: ${types.join(", ")}.`,
      nextStep: "Inspect all affected records and their relationships before making a manual correction.",
    });
  }

  const checkReference = (config: {
    value?: string;
    validIds: Set<string>;
    category?: string;
    recordType: string;
    recordTitle: string;
    recordId: string;
    fieldLabel: string;
    openObjectType?: string;
    openId?: string;
    severity?: IntegritySeverity;
  }) => {
    const value = config.value?.trim();
    if (!value || config.validIds.has(value)) return;
    addIssue({
      severity: config.severity || "Material",
      category: config.category || "Broken relationships",
      recordType: config.recordType,
      recordTitle: config.recordTitle,
      recordId: config.recordId,
      reason: `${config.fieldLabel} references missing ID ${value}.`,
      nextStep: "Open the record and verify or remove the broken relationship manually.",
      openObjectType: config.openObjectType,
      openId: config.openId || config.recordId,
    });
  };

  const checkPersonId = (recordType: string, recordTitle: string, recordId: string, fieldLabel: string, value?: string, openObjectType?: string, openId?: string) => {
    checkReference({ value, validIds: personIds, category: "People references", recordType, recordTitle, recordId, fieldLabel, openObjectType, openId });
  };
  const checkNamedOwner = (recordType: string, recordTitle: string, recordId: string, owner: string | undefined, isOperational: boolean, openObjectType: string, openId?: string) => {
    const ownerName = owner?.trim();
    if (!isOperational || !ownerName || ownerName.toLowerCase() === "unassigned" || activePeopleByName.has(ownerName.toLowerCase())) return;
    addIssue({
      severity: "Warning",
      category: "People references",
      recordType,
      recordTitle,
      recordId,
      reason: `Named owner “${ownerName}” does not match an active People record.`,
      nextStep: "Confirm whether the owner should be reassigned or the matching Person record reactivated.",
      openObjectType,
      openId: openId || recordId,
    });
  };

  for (const action of input.actions) {
    const title = action.actionTitle || action.title;
    checkPersonId("Action", title, action.id, "Owner person", action.ownerPersonId, "Action");
    checkPersonId("Action", title, action.id, "Follow-up owner person", action.followUpOwnerPersonId, "Action");
    checkNamedOwner("Action", title, action.id, action.owner, !["Completed", "Cancelled"].includes(action.status), "Action");
    checkReference({ value: action.relatedProblem, validIds: problemIds, recordType: "Action", recordTitle: title, recordId: action.id, fieldLabel: "Related Problem", openObjectType: "Action" });
    checkReference({ value: action.relatedDecision, validIds: decisionIds, recordType: "Action", recordTitle: title, recordId: action.id, fieldLabel: "Related Decision", openObjectType: "Action" });
    checkReference({ value: action.relatedLeadId, validIds: leadIds, recordType: "Action", recordTitle: title, recordId: action.id, fieldLabel: "Related Lead", openObjectType: "Action" });
    checkReference({ value: action.deliveryLeadId, validIds: leadIds, recordType: "Action", recordTitle: title, recordId: action.id, fieldLabel: "Delivery Lead", openObjectType: "Action" });
    checkReference({ value: action.relatedOpportunity, validIds: opportunityIds, recordType: "Action", recordTitle: title, recordId: action.id, fieldLabel: "Related Opportunity", openObjectType: "Action" });
    if (action.releaseSourceType && action.releaseSourceId) {
      const releaseIds = action.releaseSourceType === "Action" ? actionIds : action.releaseSourceType === "Project" ? projectIds : action.releaseSourceType === "Lead" ? leadIds : problemIds;
      checkReference({ value: action.releaseSourceId, validIds: releaseIds, recordType: "Action", recordTitle: title, recordId: action.id, fieldLabel: `${action.releaseSourceType} release source`, openObjectType: "Action" });
    }
  }

  for (const project of input.projects) {
    checkPersonId("Project", project.projectName, project.id, "Review owner person", project.reviewOwnerPersonId, "Project");
    checkNamedOwner("Project", project.projectName, project.id, project.owner, !["Completed", "Cancelled"].includes(project.status), "Project");
    for (const id of project.relatedActionIds || []) checkReference({ value: id, validIds: actionIds, recordType: "Project", recordTitle: project.projectName, recordId: project.id, fieldLabel: "Related Action", openObjectType: "Project" });
    for (const id of project.relatedDecisionIds || []) checkReference({ value: id, validIds: decisionIds, recordType: "Project", recordTitle: project.projectName, recordId: project.id, fieldLabel: "Related Decision", openObjectType: "Project" });
    for (const id of project.relatedSystemIds || []) checkReference({ value: id, validIds: systemIds, recordType: "Project", recordTitle: project.projectName, recordId: project.id, fieldLabel: "Related System", openObjectType: "Project" });
    for (const id of project.relatedSopIds || []) checkReference({ value: id, validIds: sopIds, recordType: "Project", recordTitle: project.projectName, recordId: project.id, fieldLabel: "Related SOP", openObjectType: "Project" });
    if (project.sourceCaptureId) {
      const sourceCapture = input.captures.find((capture) => capture.id === project.sourceCaptureId);
      if (sourceCapture && sourceCapture.reviewOutcome !== "Convert to Project") {
        addIssue({ severity: "Material", category: "Project lineage", recordType: "Project", recordTitle: project.projectName, recordId: project.id, reason: `Source Capture outcome is ${sourceCapture.reviewOutcome || "not converted"}, not Convert to Project.`, nextStep: "Review the Capture and Project lineage manually.", openObjectType: "Project", openId: project.id });
      }
    }
  }

  for (const problem of input.problems) checkNamedOwner("Problem", problem.problemStatement || problem.title, problem.id, problem.owner, !["Resolved", "Closed"].includes(problem.problemStatus), "Problem");
  for (const opportunity of input.opportunities) checkNamedOwner("Opportunity", opportunity.opportunityTitle || opportunity.title, opportunity.id, opportunity.owner, !["Rejected", "Completed"].includes(opportunity.status), "Opportunity");
  for (const lead of input.leads) checkNamedOwner("Lead", lead.leadName, lead.id, lead.owner, !lead.archived && !["Won", "Lost"].includes(lead.status), "Lead");
  const deliveryInput: LeadDeliveryInput = {
    leads: input.leads, actions: input.actions, income: input.income ?? [], nowMs: Date.parse(auditedAt),
    people: input.people.map((person) => ({ ...person, role: person.role ?? "",
      responsibilities: person.responsibilities ?? "", authority: person.authority ?? "" })),
  };
  const deliveryViews = buildLeadDelivery(deliveryInput);
  for (const view of deliveryViews) {
    const lead = input.leads.find((record) => record.id === view.leadId);
    if (!lead) continue;
    const structural = view.reasons.filter((reason) => !reason.includes("is due") && !reason.includes("is overdue"));
    if (structural.length) addIssue({ severity: "Material", category: "Customer delivery", recordType: "Lead",
      recordTitle: lead.leadName, recordId: lead.id, reason: structural.join("; "),
      nextStep: "Reconcile accepted customer scope, delivery execution, ownership and financial evidence; do not infer outcomes.",
      openObjectType: "Lead", openId: lead.id });
    if (lead.deliveryCommitment) {
      checkPersonId("Lead", lead.leadName, lead.id, "Delivery acceptance Person", lead.deliveryCommitment.acceptedByPersonId, "Lead");
      checkPersonId("Lead", lead.leadName, lead.id, "Initial delivery Person", lead.deliveryCommitment.assignedPersonId, "Lead");
      checkReference({ value: lead.deliveryCommitment.actionId, validIds: actionIds, recordType: "Lead",
        recordTitle: lead.leadName, recordId: lead.id, fieldLabel: "Delivery Action", openObjectType: "Lead" });
    }
  }
  for (const action of input.actions.filter((record) => record.deliveryLeadId)) {
    if (input.leads.filter((lead) => lead.id === action.deliveryLeadId
      && lead.deliveryCommitment?.actionId === action.id).length !== 1) addIssue({
      severity: "Material", category: "Customer delivery", recordType: "Action", recordTitle: action.actionTitle,
      recordId: action.id, reason: "Delivery Action has no unique matching customer commitment.",
      nextStep: "Reconcile both sides of the customer delivery relationship.", openObjectType: "Action", openId: action.id,
    });
  }
  for (const action of input.actions.filter((record) => record.financeIncomeId || record.financeIncomeRole)) {
    const records = (input.income ?? []).filter((record) => record.id === action.financeIncomeId);
    const reference = action.financeIncomeRole === "Billing" ? records[0]?.billingActionId
      : action.financeIncomeRole === "Collection" ? records[0]?.collectionActionId : undefined;
    const completedHistory = hasSupportedFinanceActionCompletion(action, deliveryInput);
    if (records.length !== 1 || (reference !== action.id && !completedHistory)) addIssue({
      severity: "Material", category: "Customer finance", recordType: "Action", recordTitle: action.actionTitle,
      recordId: action.id, reason: "Finance Action has no unique matching Income responsibility.",
      nextStep: "Reconcile both sides of the billing or collection Action relationship.", openObjectType: "Action", openId: action.id,
    });
  }
  for (const record of input.income ?? []) {
    checkReference({ value: record.relatedLeadId, validIds: leadIds, recordType: "Income", recordTitle: record.description,
      recordId: record.id, fieldLabel: "Delivery Lead", openObjectType: "Finance", openId: `income:${record.id}` });
    checkPersonId("Income", record.description, record.id, "Billing owner", record.billingOwnerPersonId, "Finance", `income:${record.id}`);
    checkPersonId("Income", record.description, record.id, "Collection owner", record.collectionOwnerPersonId, "Finance", `income:${record.id}`);
    checkReference({ value: record.billingActionId, validIds: actionIds, recordType: "Income", recordTitle: record.description,
      recordId: record.id, fieldLabel: "Billing Action", openObjectType: "Finance", openId: `income:${record.id}` });
    checkReference({ value: record.collectionActionId, validIds: actionIds, recordType: "Income", recordTitle: record.description,
      recordId: record.id, fieldLabel: "Collection Action", openObjectType: "Finance", openId: `income:${record.id}` });
    const finance = getDeliveryIncomeEvidence(record, deliveryInput);
    const financeStructural = finance.reasons.filter((reason) => !reason.includes("is due") && !reason.includes("is overdue"));
    if (financeStructural.length) addIssue({ severity: "Material", category: "Customer finance", recordType: "Income",
      recordTitle: record.description, recordId: record.id, reason: [...new Set(financeStructural)].join("; "),
      nextStep: "Reconcile billing ownership, invoice evidence, collection follow-up and receipt evidence without inferring financial outcomes.",
      openObjectType: "Finance", openId: `income:${record.id}` });
    if (record.relatedLeadId && input.leads.filter((lead) => lead.id === record.relatedLeadId
      && lead.deliveryCommitment).length !== 1) addIssue({
      severity: "Material", category: "Customer delivery", recordType: "Income", recordTitle: record.description,
      recordId: record.id, reason: "Income has no unique accepted customer commitment.",
      nextStep: "Reconcile the Income-to-Lead delivery relationship without inferring payment or completion.",
      openObjectType: "Finance", openId: `income:${record.id}`,
    });
  }
  const jobInput = { ...deliveryInput, expenses: input.expenses ?? [] };
  for (const record of input.expenses ?? []) {
    const errors = getJobExpenseErrors(record, jobInput);
    if (errors.length) addIssue({ severity: "Material", category: "Job financial evidence", recordType: "Expense",
      recordTitle: record.description, recordId: record.id, reason: errors.join("; "),
      nextStep: "Reconcile the job attribution and dated incurred-cost evidence without estimating missing costs.",
      openObjectType: "Finance", openId: `expense:${record.id}` });
  }
  for (const job of buildJobPerformance(jobInput)) {
    const lead = input.leads.find((record) => record.id === job.leadId);
    if (lead?.jobFinancialReview && !job.reviewCurrent) addIssue({
      severity: "Material", category: "Job financial evidence", recordType: "Lead",
      recordTitle: job.title, recordId: job.leadId, reason: "Job financial coverage review is stale or improperly attributed.",
      nextStep: "Review current financial records and completion evidence before relying on contribution or profit.",
      openObjectType: "Lead", openId: job.leadId,
    });
  }
  for (const contact of input.outreach) {
    checkNamedOwner("Outreach", contact.businessName, contact.id, contact.owner, !["Converted to Lead", "Closed / Not Pursuing", "Closed Supplier Network"].includes(contact.status), "Outreach");
    checkReference({ value: contact.linkedLeadId, validIds: leadIds, recordType: "Outreach", recordTitle: contact.businessName, recordId: contact.id, fieldLabel: "Linked Lead", openObjectType: "Outreach" });
  }

  for (const decision of input.decisions) checkReference({ value: decision.relatedOpportunity, validIds: opportunityIds, recordType: "Decision", recordTitle: decision.decisionTitle || decision.title, recordId: decision.id, fieldLabel: "Related Opportunity", openObjectType: "Decision" });
  for (const lesson of input.lessons) {
    const title = lesson.lessonTitle || lesson.title;
    checkNamedOwner("Lesson", title, lesson.id, lesson.owner, lesson.status !== "Archived", "Lesson");
    checkReference({ value: lesson.relatedProblem, validIds: problemIds, recordType: "Lesson", recordTitle: title, recordId: lesson.id, fieldLabel: "Related Problem", openObjectType: "Lesson" });
    checkReference({ value: lesson.relatedProject, validIds: projectIds, recordType: "Lesson", recordTitle: title, recordId: lesson.id, fieldLabel: "Related Project", openObjectType: "Lesson" });
    checkReference({ value: lesson.relatedDecision, validIds: decisionIds, recordType: "Lesson", recordTitle: title, recordId: lesson.id, fieldLabel: "Related Decision", openObjectType: "Lesson" });
    checkReference({ value: lesson.relatedSystem, validIds: systemIds, recordType: "Lesson", recordTitle: title, recordId: lesson.id, fieldLabel: "Related System", openObjectType: "Lesson" });
  }
  for (const system of input.systems) {
    const title = system.systemName || system.title;
    checkNamedOwner("System", title, system.id, system.owner, system.status !== "Deprecated", "System");
    checkReference({ value: system.relatedLesson, validIds: lessonIds, recordType: "System", recordTitle: title, recordId: system.id, fieldLabel: "Related Lesson", openObjectType: "System" });
  }
  for (const sop of input.sops) {
    const title = sop.sopTitle || sop.title;
    checkNamedOwner("SOP", title, sop.id, sop.owner, !["Deprecated", "Archived"].includes(sop.status), "SOP");
    checkReference({ value: sop.relatedSystem, validIds: systemIds, recordType: "SOP", recordTitle: title, recordId: sop.id, fieldLabel: "Related System", openObjectType: "SOP" });
    checkReference({ value: sop.relatedLesson, validIds: lessonIds, recordType: "SOP", recordTitle: title, recordId: sop.id, fieldLabel: "Related Lesson", openObjectType: "SOP" });
  }

  for (const handoff of input.handoffs) {
    const targetIds = handoff.objectType === "Action" ? actionIds : handoff.objectType === "Project" ? projectIds : handoff.objectType === "Lead" ? leadIds : problemIds;
    checkReference({ value: handoff.objectId, validIds: targetIds, category: "Delegation references", recordType: "Delegation handoff", recordTitle: handoff.title, recordId: handoff.id, fieldLabel: handoff.objectType, severity: "Warning" });
    checkPersonId("Delegation handoff", handoff.title, handoff.id, "Previous owner person", handoff.previousOwnerPersonId);
    checkPersonId("Delegation handoff", handoff.title, handoff.id, "New owner person", handoff.newOwnerPersonId);
    checkPersonId("Delegation handoff", handoff.title, handoff.id, "Delegated-by person", handoff.delegatedByPersonId);
  }

  for (const [missingCaptureId, root] of missingCaptureLineageRoots) {
    const affectedRecords = Array.from(root.records.values());
    const affectedTypes = Array.from(root.recordTypes).sort();
    const looksLegacy = affectedRecords.length >= 2 && affectedTypes.length >= 2;
    addIssue({
      severity: looksLegacy ? "Warning" : "Material",
      category: looksLegacy ? "Legacy lineage" : "Capture conversion",
      recordType: "Capture lineage",
      recordTitle: "Missing source Capture",
      recordId: missingCaptureId,
      reason: `${affectedRecords.length} downstream record${affectedRecords.length === 1 ? "" : "s"} across ${affectedTypes.join(", ")} reference this missing Capture ID.${looksLegacy ? " The shared multi-type root appears to be historical or migration lineage rather than confirmed active corruption." : " There is not enough shared historical lineage to classify this as a legacy root."}`,
      nextStep: looksLegacy
        ? "Inspect backup history only if lineage repair is desired; do not relink records without confirming the historical source."
        : "Inspect the affected record and backup history to confirm whether the missing lineage is current or historical.",
    });
  }

  const destinationRecords = new Map<ReviewOutcome, Array<{ id: string; sourceCaptureId?: string; title: string }>>([
    ["Convert to Problem", input.problems.map((record) => ({ id: record.id, sourceCaptureId: record.sourceCaptureId, title: record.problemStatement || record.title }))],
    ["Convert to Opportunity", input.opportunities.map((record) => ({ id: record.id, sourceCaptureId: record.sourceCaptureId, title: record.opportunityTitle || record.title }))],
    ["Convert to Action", input.actions.map((record) => ({ id: record.id, sourceCaptureId: record.sourceCaptureId, title: record.actionTitle || record.title }))],
    ["Convert to Decision", input.decisions.map((record) => ({ id: record.id, sourceCaptureId: record.sourceCaptureId, title: record.decisionTitle || record.title }))],
    ["Convert to Lesson", input.lessons.map((record) => ({ id: record.id, sourceCaptureId: record.sourceCaptureId, title: record.lessonTitle || record.title }))],
    ["Convert to Project", input.projects.map((record) => ({ id: record.id, sourceCaptureId: record.sourceCaptureId, title: record.projectName }))],
    ["Convert to System", input.systems.map((record) => ({ id: record.id, sourceCaptureId: record.sourceCaptureId, title: record.systemName || record.title }))],
    ["Convert to SOP", input.sops.map((record) => ({ id: record.id, sourceCaptureId: record.sourceCaptureId, title: record.sopTitle || record.title }))],
  ]);
  for (const capture of input.captures) {
    const outcome = capture.reviewOutcome;
    if (capture.status === "Converted" && !outcome) {
      addIssue({ severity: "Warning", category: "Capture conversion", recordType: "Capture", recordTitle: capture.title, recordId: capture.id, reason: "Capture status is Converted but no conversion outcome is recorded.", nextStep: "Review legacy history and downstream records before changing the Capture." });
      continue;
    }
    if (!outcome?.startsWith("Convert to ")) continue;
    if (capture.status !== "Converted") {
      addIssue({ severity: "Warning", category: "Capture conversion", recordType: "Capture", recordTitle: capture.title, recordId: capture.id, reason: `${outcome} is recorded but Capture status is “${capture.status}”.`, nextStep: "Review the Capture state and downstream lineage manually." });
    }
    const expected = destinationRecords.get(outcome) || [];
    if (!expected.some((record) => record.sourceCaptureId === capture.id)) {
      addIssue({ severity: "Material", category: "Capture conversion", recordType: "Capture", recordTitle: capture.title, recordId: capture.id, reason: `${outcome} is recorded but no compatible downstream record links back to this Capture.`, nextStep: "Review the Capture and destination collection; do not recreate anything until lineage is confirmed." });
    }
    const linkedTypes = Array.from(destinationRecords.entries()).filter(([, records]) => records.some((record) => record.sourceCaptureId === capture.id)).map(([type]) => type);
    if (linkedTypes.some((type) => type !== outcome)) {
      addIssue({ severity: "Material", category: "Capture conversion", recordType: "Capture", recordTitle: capture.title, recordId: capture.id, reason: `Downstream lineage includes ${linkedTypes.join(", ")} while the Capture records ${outcome}.`, nextStep: "Inspect the Capture and downstream records to identify the intended conversion type." });
    }
    if (linkedTypes.length > 1 || expected.filter((record) => record.sourceCaptureId === capture.id).length > 1) {
      addIssue({ severity: "Warning", category: "Capture conversion", recordType: "Capture", recordTitle: capture.title, recordId: capture.id, reason: "More than one downstream conversion record links to this Capture.", nextStep: "Review the downstream records for duplicate or conflicting conversion history." });
    }
  }
  for (const [outcome, records] of destinationRecords) {
    for (const record of records) {
      if (!record.sourceCaptureId) continue;
      if (outcome === "Convert to Project") continue;
      const capture = input.captures.find((item) => item.id === record.sourceCaptureId);
      if (capture && capture.reviewOutcome && capture.reviewOutcome !== outcome) {
        addIssue({ severity: "Material", category: "Capture conversion", recordType: outcome.replace("Convert to ", ""), recordTitle: record.title, recordId: record.id, reason: `Source Capture records ${capture.reviewOutcome}, but this record represents ${outcome}.`, nextStep: "Compare both records and manually confirm the intended conversion." });
      }
    }
  }
  const conversionTypesByCapture = new Map<string, Set<ReviewOutcome>>();
  for (const conversion of input.conversions) {
    if (!conversion.sourceCaptureId) {
      continue;
    }
    if (conversion.relatedCapture && conversion.relatedCapture !== conversion.sourceCaptureId) {
      addIssue({ severity: "Material", category: "Capture conversion", recordType: "Capture conversion", recordTitle: conversion.title, recordId: conversion.id, reason: `relatedCapture (${conversion.relatedCapture}) does not match sourceCaptureId (${conversion.sourceCaptureId}).`, nextStep: "Open the destination record and compare both lineage references with the source Capture." });
    }
    if (!conversionTypesByCapture.has(conversion.sourceCaptureId)) conversionTypesByCapture.set(conversion.sourceCaptureId, new Set());
    conversionTypesByCapture.get(conversion.sourceCaptureId)!.add(conversion.targetType);
  }
  for (const [captureId, types] of conversionTypesByCapture) {
    if (types.size < 2) continue;
    const capture = input.captures.find((record) => record.id === captureId);
    if (!capture) continue;
    addIssue({ severity: "Material", category: "Capture conversion", recordType: "Capture", recordTitle: capture?.title || "Missing Capture", recordId: captureId, reason: `Conflicting conversion types exist: ${Array.from(types).join(", ")}.`, nextStep: "Review all downstream records and establish the intended conversion manually." });
  }

  const isMalformedNumber = (value: string | undefined, required = false) => {
    const trimmed = value?.trim() || "";
    if (!trimmed) return required;
    const numericValue = Number(trimmed.replace(/[,£$]/g, ""));
    return !Number.isFinite(numericValue);
  };
  for (const commitment of input.commitments) {
    const title = commitment.commitmentName || "Unnamed commitment";
    const financeOpenId = `commitment:${commitment.id}`;
    const addFinanceIssue = (severity: IntegritySeverity, reason: string, nextStep: string) => addIssue({ severity, category: "Finance structure", recordType: "Financial commitment", recordTitle: title, recordId: commitment.id, reason, nextStep, openObjectType: "Finance", openId: financeOpenId });
    if (isMalformedNumber(commitment.amount, true)) addFinanceIssue("Material", "Required amount is blank or not numeric.", "Open the commitment and verify the stored amount.");
    for (const [label, value] of [["Original budget", commitment.originalBudget], ["Target price", commitment.targetPrice], ["Actual purchase price", commitment.actualPurchasePrice], ["Previous quote price", commitment.quotePreviousPrice], ["Confirmed quote price", commitment.quoteConfirmedPrice]] as const) {
      if (isMalformedNumber(value)) addFinanceIssue("Warning", `${label} is present but not numeric.`, `Open the commitment and verify ${label.toLowerCase()}.`);
    }
    if (!input.commitmentStatusOptions.includes(commitment.status)) addFinanceIssue("Material", `Status “${commitment.status}” is not a supported commitment status.`, "Select a supported status after confirming the intended state.");
    if (!input.commitmentTypeOptions.includes(commitment.type)) addFinanceIssue("Warning", `Type “${commitment.type}” is not a supported commitment type.`, "Review the commitment type against the current options.");
    if (commitment.certainty && !commitmentCertaintyOptions.includes(commitment.certainty as CommitmentCertainty)) addFinanceIssue("Warning", `Certainty “${commitment.certainty}” is not supported.`, "Review the commitment certainty; blank legacy certainty remains valid.");
    if (commitment.approvalStatus && !procurementApprovalStatusOptions.includes(commitment.approvalStatus as ProcurementApprovalStatus)) addFinanceIssue("Warning", `Approval status “${commitment.approvalStatus}” is not supported.`, "Review the stored approval status manually.");
    if (commitment.actualPurchaseDate && !commitment.actualPurchasePrice?.trim()) addFinanceIssue("Material", "Actual purchase date is recorded without an actual purchase price.", "Verify the purchase completion fields and add only evidence-backed information.");
    if (commitment.actualPurchasePrice?.trim() && !commitment.actualPurchaseDate) addFinanceIssue("Warning", "Actual purchase price is recorded without an actual purchase date.", "Verify whether the purchase completed and record the supported date if known.");
    if (commitment.relatedPillar && !input.sharedAreaOptions.includes(commitment.relatedPillar)) addFinanceIssue("Warning", `Related pillar “${commitment.relatedPillar}” is outside the supported area list.`, "Review the related pillar against the current operating areas.");
  }

  const arrayStoreKeys = new Set<string>([
    STORAGE_KEY, CONVERSION_STORAGE_KEY, PERSON_STORAGE_KEY, PROJECT_STORAGE_KEY, LEAD_STORAGE_KEY, OUTREACH_STORAGE_KEY,
    DELEGATION_HANDOFF_STORAGE_KEY, INCOME_STORAGE_KEY, EXPENSE_STORAGE_KEY, COMMITMENT_STORAGE_KEY, TAX_PAYMENT_STORAGE_KEY,
    SAVED_VIEWS_STORAGE_KEY, DAILY_POSTURE_SNAPSHOTS_STORAGE_KEY, CHANGE_HISTORY_STORAGE_KEY, STRATEGIC_OBJECTIVES_STORAGE_KEY, STRATEGIC_REVIEWS_STORAGE_KEY,
    WORKING_RELATIONSHIP_STORAGE_KEY,
  ]);
  const objectStoreKeys = new Set<string>([
    CASH_POSITION_STORAGE_KEY,
    FOUNDER_INTELLIGENCE_STORAGE_KEY,
  ]);
  for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) {
    const raw = input.storage[key];
    if (raw === null) continue;
    if (key === DEFAULT_SAVED_VIEW_STORAGE_KEY) continue;
    try {
      const parsed = JSON.parse(raw);
      const validShape = objectStoreKeys.has(key)
        ? isPlainObject(parsed)
        : !arrayStoreKeys.has(key) || Array.isArray(parsed);
      if (!validShape) throw new Error();
      if (key === CHANGE_HISTORY_STORAGE_KEY && Array.isArray(parsed)) {
        parsed.forEach((event, index) => {
          if (!isValidChangeEvent(event)) addIssue({ severity: "Material", category: "Change history", recordType: "Audit event", recordTitle: `Event ${index + 1}`, reason: "Audit event has missing or invalid identity, timestamp, or field changes.", nextStep: "Inspect the audit history in a safety backup before making changes to browser storage." });
        });
      }
      if (key === STRATEGIC_OBJECTIVES_STORAGE_KEY && Array.isArray(parsed) && parsed.some((entry) => !isStrategicObjectiveRecord(entry))) throw new Error();
      if (key === STRATEGIC_REVIEWS_STORAGE_KEY && Array.isArray(parsed)) {
        parsed.forEach((review: unknown, index: number) => reviewShapeIssues(review).forEach((reason) => addIssue({ severity: "Material", category: "Strategic reviews", recordType: "Strategic Review", recordTitle: `Stored review ${index + 1}`, reason, nextStep: "Inspect the stored review in a safety backup before changing browser storage." })));
      }
    } catch {
      addIssue({ severity: "Critical", category: "Local storage", recordType: "Storage", recordTitle: key, recordId: key, reason: `Store ${key} contains malformed JSON or the wrong structural type.`, nextStep: "Download a safety backup and inspect recovery options before editing browser storage." });
    }
  }

  const { status, severityCounts, categoryCounts } = summarizeIntegrityIssues(issues);
  return {
    auditedAt,
    status,
    issues,
    severityCounts,
    categoryCounts,
  };
}
