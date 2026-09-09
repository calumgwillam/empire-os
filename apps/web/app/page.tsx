"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

const navigation = [
  "Empire OS",
  "Command",
  "Empire",
  "Capture",
  "Problems",
  "Opportunities",
  "Actions",
  "Decisions",
  "Lessons",
  "Projects",
  "Systems",
  "SOPs",
  "Metrics",
  "Leads",
  "Finance",
  "People",
  "Pillars",
];

const STORAGE_KEY = "empire-os-captures";
const CONVERSION_STORAGE_KEY = "empire-os-capture-conversions";
const PERSON_STORAGE_KEY = "empire-os-people";
const PROJECT_STORAGE_KEY = "empire-os-projects";
const LEAD_STORAGE_KEY = "empire-os-leads";
const CASH_POSITION_STORAGE_KEY = "empire-os-cash-position";
const INCOME_STORAGE_KEY = "empire-os-income-records";
const EXPENSE_STORAGE_KEY = "empire-os-expense-records";
const COMMITMENT_STORAGE_KEY = "empire-os-financial-commitments";
const SAVED_VIEWS_STORAGE_KEY = "empire-os-records-in-motion-views";
const DEFAULT_SAVED_VIEW_STORAGE_KEY = "empire-os-records-in-motion-default-view";
const DAILY_POSTURE_SNAPSHOTS_STORAGE_KEY = "empire-os-daily-posture-snapshots";

const sharedAreaOptions = [
  "Garden Maintenance",
  "Hard Landscape Construction",
  "Excavation",
  "People",
  "Systems",
  "Finance",
  "Marketing / Growth",
] as const;

const opportunityAreaOptions = [...sharedAreaOptions] as const;

const reviewOutcomes = [
  "Keep as Capture",
  "Convert to Problem",
  "Convert to Opportunity",
  "Convert to Action",
  "Convert to Decision",
  "Convert to Lesson",
  "Convert to System",
  "Convert to SOP",
  "Close",
] as const;

type ReviewOutcome = (typeof reviewOutcomes)[number];

type CaptureFormValues = {
  title: string;
  rawNote: string;
  initialType: string;
  relatedArea: string;
  importance: string;
};

type CaptureRecord = CaptureFormValues & {
  id: string;
  status: string;
  capturedAt: string;
  reviewOutcome?: ReviewOutcome | null;
  reviewedAt?: string | null;
};

type CaptureConversionRecord = {
  id: string;
  sourceCaptureId: string;
  targetType: ReviewOutcome;
  createdAt: string;
  title: string;
  originalRawNote: string;
  relatedArea: string;
  importance: string;
  status: string;
  problemStatement?: string;
  severity?: string;
  frequency?: string;
  impact?: string;
  rootCauseStatus?: string;
  rootCause?: string;
  owner?: string;
  resolution?: string;
  problemStatus?: string;
  actionTitle?: string;
  actionDescription?: string;
  createdBy?: string;
  createdDate?: string;
  dueDate?: string;
  priority?: string;
  relatedProblem?: string;
  relatedDecision?: string;
  relatedOpportunity?: string;
  relatedCapture?: string;
  relatedPillar?: string;
  completionEvidence?: string;
  completionDate?: string;
  decisionTitle?: string;
  decisionStatement?: string;
  decisionMaker?: string;
  decisionDate?: string;
  context?: string;
  reasoning?: string;
  evidenceConsidered?: string;
  alternativesConsidered?: string;
  assumptions?: string;
  expectedOutcome?: string;
  riskLevel?: string;
  reviewDate?: string;
  actualOutcome?: string;
  outcomeRating?: string;
  lessons?: string;
  decisionStatus?: string;
  opportunityTitle?: string;
  source?: string;
  dateIdentified?: string;
  strategicFit?: string;
  estimatedUpside?: string;
  requiredCapital?: string;
  requiredTime?: string;
  requiredCapability?: string;
  risks?: string;
  opportunityCost?: string;
  evidence?: string;
  decision?: string;
  outcome?: string;
  opportunityStatus?: string;
  opportunityDescription?: string;
  lessonTitle?: string;
  lessonDescription?: string;
  sourceEvent?: string;
  dateLearned?: string;
  whyItMatters?: string;
  recommendedChange?: string;
  relatedProject?: string;
  relatedSystem?: string;
  lessonStatus?: string;
  systemName?: string;
  purpose?: string;
  area?: string;
  inputs?: string;
  process?: string;
  outputs?: string;
  standards?: string;
  failurePoints?: string;
  version?: string;
  lastReviewed?: string;
  systemStatus?: string;
  relatedLesson?: string;
  sopTitle?: string;
  sopPurpose?: string;
  applicableRoles?: string;
  procedure?: string;
  requiredTools?: string;
  safetyConsiderations?: string;
  qualityStandard?: string;
  effectiveDate?: string;
  sopStatus?: string;
};

const problemSeverityOptions = ["Low", "Medium", "High", "Critical"] as const;
const problemFrequencyOptions = ["One-off", "Occasional", "Recurring", "Persistent"] as const;
const problemRootCauseStatusOptions = ["Not investigated", "Investigating", "Identified"] as const;
const problemStatusOptions = ["Open", "Investigating", "Action required", "Resolved", "Closed"] as const;

type ProblemSeverity = (typeof problemSeverityOptions)[number];
type ProblemFrequency = (typeof problemFrequencyOptions)[number];
type RootCauseStatus = (typeof problemRootCauseStatusOptions)[number];
type ProblemStatus = (typeof problemStatusOptions)[number];

type ProblemRecord = CaptureConversionRecord & {
  problemStatement: string;
  severity: ProblemSeverity;
  frequency: ProblemFrequency;
  impact: string;
  rootCauseStatus: RootCauseStatus;
  rootCause: string;
  owner: string;
  resolution: string;
  problemStatus: ProblemStatus;
};

const actionPriorityOptions = ["Low", "Medium", "High", "Critical"] as const;
const actionStatusOptions = ["Open", "In Progress", "Blocked", "Completed", "Cancelled"] as const;

type ActionPriority = (typeof actionPriorityOptions)[number];
type ActionStatus = (typeof actionStatusOptions)[number];

type ActionRecord = CaptureConversionRecord & {
  actionTitle: string;
  description: string;
  owner: string;
  ownerPersonId?: string;
  createdBy: string;
  createdDate: string;
  dueDate: string;
  priority: ActionPriority;
  status: ActionStatus;
  relatedProblem: string;
  relatedDecision: string;
  relatedCapture: string;
  relatedPillar: string;
  completionEvidence: string;
  completionDate: string;
};

const decisionRiskOptions = ["Low", "Medium", "High", "Critical"] as const;
const decisionStatusOptions = ["Draft", "Active", "Under Review", "Completed", "Reversed"] as const;
const decisionOutcomeRatingOptions = ["", "Worked", "Partially worked", "Failed"] as const;

type DecisionRiskLevel = (typeof decisionRiskOptions)[number];
type DecisionStatus = (typeof decisionStatusOptions)[number];

type DecisionRecord = CaptureConversionRecord & {
  decisionTitle: string;
  decisionStatement: string;
  decisionMaker: string;
  decisionDate: string;
  context: string;
  reasoning: string;
  evidenceConsidered: string;
  alternativesConsidered: string;
  assumptions: string;
  expectedOutcome: string;
  riskLevel: DecisionRiskLevel;
  reviewDate: string;
  actualOutcome: string;
  outcomeRating: string;
  lessons: string;
  decisionStatus: DecisionStatus;
  relatedOpportunity: string;
};

const opportunityStrategicFitOptions = ["Low", "Medium", "High", "Exceptional"] as const;
const opportunityStatusOptions = ["New", "Evaluating", "On Hold", "Approved", "Rejected", "Completed"] as const;

type OpportunityStrategicFit = (typeof opportunityStrategicFitOptions)[number];
type OpportunityStatus = (typeof opportunityStatusOptions)[number];

type OpportunityRecord = CaptureConversionRecord & {
  opportunityTitle: string;
  description: string;
  source: string;
  dateIdentified: string;
  relatedPillar: string;
  strategicFit: OpportunityStrategicFit;
  estimatedUpside: string;
  requiredCapital: string;
  requiredTime: string;
  requiredCapability: string;
  risks: string;
  opportunityCost: string;
  evidence: string;
  owner: string;
  status: OpportunityStatus;
  decision: string;
  outcome: string;
};

const lessonStatusOptions = ["New", "Reviewed", "Change Required", "Implemented", "Archived"] as const;

type LessonStatus = (typeof lessonStatusOptions)[number];

type LessonRecord = CaptureConversionRecord & {
  lessonTitle: string;
  description: string;
  sourceEvent: string;
  dateLearned: string;
  relatedPillar: string;
  whyItMatters: string;
  recommendedChange: string;
  relatedProblem: string;
  relatedProject: string;
  relatedDecision: string;
  relatedSystem: string;
  owner: string;
  status: LessonStatus;
};

const systemStatusOptions = ["Draft", "Active", "Reviewing", "Deprecated"] as const;
type SystemStatus = (typeof systemStatusOptions)[number];

type SystemRecord = CaptureConversionRecord & {
  systemName: string;
  purpose: string;
  owner: string;
  area: string;
  inputs: string;
  process: string;
  outputs: string;
  standards: string;
  failurePoints: string;
  version: string;
  lastReviewed: string;
  status: SystemStatus;
  relatedLesson: string;
};

const sopStatusOptions = ["Draft", "Active", "Reviewing", "Deprecated", "Archived"] as const;
type SopStatus = (typeof sopStatusOptions)[number];

type SopRecord = CaptureConversionRecord & {
  sopTitle: string;
  purpose: string;
  owner: string;
  relatedSystem: string;
  applicableRoles: string;
  procedure: string;
  requiredTools: string;
  safetyConsiderations: string;
  qualityStandard: string;
  completionEvidence: string;
  version: string;
  effectiveDate: string;
  reviewDate: string;
  status: SopStatus;
  relatedLesson: string;
};

const personStatusOptions = ["Active", "Inactive", "Candidate", "Former"] as const;
const personAccessLevelOptions = ["Founder", "Executive", "Manager", "Team Member", "Limited"] as const;

type PersonStatus = (typeof personStatusOptions)[number];
type PersonAccessLevel = (typeof personAccessLevelOptions)[number];

type PersonRecord = {
  id: string;
  name: string;
  role: string;
  responsibilities: string;
  authority: string;
  manager: string;
  pillar: string;
  skills: string;
  developmentAreas: string;
  performanceIndicators: string;
  accessLevel: PersonAccessLevel;
  status: PersonStatus;
  dateCreated: string;
};

type PersonFormValues = Omit<PersonRecord, "id" | "dateCreated">;

type ProjectRecord = {
  id: string;
  projectName: string;
  owner: string;
  area: string;
  startDate: string;
  targetCompletionDate: string;
  status: string;
  relatedActionIds?: string[];
  relatedDecisionIds?: string[];
  relatedSystemIds?: string[];
  relatedSopIds?: string[];
};

const projectStatusOptions = ["Open", "In Progress", "Blocked", "Completed", "Cancelled"] as const;

const leadStatusOptions = ["New", "Contacted", "Quote Needed", "Quote Sent", "Follow-Up", "Won", "Lost", "On Hold"] as const;
type LeadStatus = (typeof leadStatusOptions)[number];

const leadSourceOptions = ["Nextdoor", "Facebook Group", "Referral", "Community Page", "Direct Outreach", "Website", "Repeat Customer", "Other"] as const;
type LeadSource = (typeof leadSourceOptions)[number];

const leadOutcomeOptions = ["", "Won", "Lost", "No Response", "Cancelled"] as const;

type LeadRecord = {
  id: string;
  leadName: string;
  contactName: string;
  phone: string;
  email: string;
  location: string;
  serviceRequested: string;
  sourceChannel: LeadSource;
  dateReceived: string;
  status: LeadStatus;
  quoteValue: string;
  quoteSentDate: string;
  followUpDate: string;
  outcome: string;
  finalJobValue: string;
  notes: string;
  owner: string;
  relatedPillar: string;
  dateCreated: string;
  archived?: boolean;
};

type LeadFormValues = Omit<LeadRecord, "id" | "dateCreated">;

const defaultLeadForm: LeadFormValues = {
  leadName: "",
  contactName: "",
  phone: "",
  email: "",
  location: "",
  serviceRequested: "",
  sourceChannel: "Other",
  dateReceived: "",
  status: "New",
  quoteValue: "",
  quoteSentDate: "",
  followUpDate: "",
  outcome: "",
  finalJobValue: "",
  notes: "",
  owner: "",
  relatedPillar: "Garden Maintenance",
};

const incomeStatusOptions = ["Expected", "Received"] as const;
type IncomeStatus = (typeof incomeStatusOptions)[number];

const expenseStatusOptions = ["Planned", "Paid"] as const;
type ExpenseStatus = (typeof expenseStatusOptions)[number];

const expenseCategoryOptions = ["Materials", "Equipment", "Fuel", "Labour", "Subcontractor", "Insurance", "Marketing", "Software", "Vehicle", "Other"] as const;

const commitmentTypeOptions = ["Loan", "Lease", "Subscription", "Tax", "Supplier", "Insurance", "Other"] as const;
const commitmentStatusOptions = ["Upcoming", "Due", "Paid", "Overdue", "Cancelled"] as const;

type CashPositionRecord = {
  currentCash: string;
  reservedTax: string;
  safetyBuffer: string;
  lastUpdated: string;
};

type DailyPostureSnapshot = {
  date: string;
  focusCount: number;
  ownershipGapCount: number;
  decisionReviewsDue: number;
  executionGapCount: number;
  learningGapCount: number;
  staleRecordCount: number;
  financeAttentionCount: number;
  growthStallCount: number;
  outstandingCount: number;
  availableOperatingCash: number | null;
  delegationQualityPct?: number | null;
  avgOpenDecisionDays?: number | null;
  selfSufficiencyPct?: number | null;
  outstandingKeys?: Array<{ key: string; title: string; objectType: string; category: string }>;
};

type IncomeRecord = {
  id: string;
  date: string;
  description: string;
  customerSource: string;
  amount: string;
  area: string;
  status: IncomeStatus;
  notes: string;
  dateCreated: string;
};

type ExpenseRecord = {
  id: string;
  date: string;
  description: string;
  supplier: string;
  amount: string;
  category: string;
  area: string;
  status: ExpenseStatus;
  notes: string;
  dateCreated: string;
};

type CommitmentRecord = {
  id: string;
  commitmentName: string;
  amount: string;
  dueDate: string;
  type: string;
  status: string;
  relatedPillar: string;
  notes: string;
  dateCreated: string;
};

const defaultCashPosition: CashPositionRecord = {
  currentCash: "",
  reservedTax: "",
  safetyBuffer: "",
  lastUpdated: "",
};

const defaultIncomeForm: Omit<IncomeRecord, "id" | "dateCreated"> = {
  date: "",
  description: "",
  customerSource: "",
  amount: "",
  area: "Garden Maintenance",
  status: "Expected",
  notes: "",
};

const defaultExpenseForm: Omit<ExpenseRecord, "id" | "dateCreated"> = {
  date: "",
  description: "",
  supplier: "",
  amount: "",
  category: "Materials",
  area: "Garden Maintenance",
  status: "Planned",
  notes: "",
};

const defaultCommitmentForm: Omit<CommitmentRecord, "id" | "dateCreated"> = {
  commitmentName: "",
  amount: "",
  dueDate: "",
  type: "Other",
  status: "Upcoming",
  relatedPillar: "Garden Maintenance",
  notes: "",
};

const defaultProjectForm: Omit<ProjectRecord, "id"> = {
  projectName: "",
  owner: "",
  area: "Garden Maintenance",
  startDate: "",
  targetCompletionDate: "",
  status: "Open",
  relatedActionIds: [],
  relatedDecisionIds: [],
  relatedSystemIds: [],
  relatedSopIds: [],
};

const defaultPersonForm: PersonFormValues = {
  name: "",
  role: "",
  responsibilities: "",
  authority: "",
  manager: "",
  pillar: "Garden Maintenance",
  skills: "",
  developmentAreas: "",
  performanceIndicators: "",
  accessLevel: "Team Member",
  status: "Active",
};

const defaultProblemForm: Omit<ProblemRecord, "id" | "sourceCaptureId" | "targetType" | "createdAt" | "title" | "originalRawNote" | "relatedArea" | "importance" | "status"> = {
  problemStatement: "",
  severity: "Medium",
  frequency: "Occasional",
  impact: "",
  rootCauseStatus: "Not investigated",
  rootCause: "",
  owner: "",
  resolution: "",
  problemStatus: "Open",
};

const defaultFormValues: CaptureFormValues = {
  title: "",
  rawNote: "",
  initialType: "Idea",
  relatedArea: "Garden Maintenance",
  importance: "Medium",
};

function generateCaptureId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `capture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function generateConversionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `conversion-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function generatePersonId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `person-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function generateProjectId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function generateLeadId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `lead-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function generateFinanceRecordId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatCapturedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatSavedViewUpdatedAt(value?: string) {
  if (!value) {
    return "Updated date unavailable";
  }

  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) {
    return "Updated date unavailable";
  }

  const now = new Date();
  const elapsedMinutes = Math.floor((now.getTime() - updatedAt.getTime()) / (1000 * 60));
  if (elapsedMinutes < 1) {
    return "Updated just now";
  }

  if (elapsedMinutes < 60) {
    return `Updated ${elapsedMinutes} minutes ago`;
  }

  if (updatedAt.toDateString() === now.toDateString()) {
    return "Updated today";
  }

  return `Updated ${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(updatedAt)}`;
}

function getStatusFromOutcome(outcome: ReviewOutcome) {
  if (outcome === "Close") {
    return "Closed";
  }

  if (outcome === "Keep as Capture") {
    return "Reviewed";
  }

  return "Converted";
}

function formatReviewOutcome(outcome: ReviewOutcome | null | undefined) {
  if (!outcome) {
    return null;
  }

  if (outcome === "Keep as Capture") {
    return "Capture";
  }

  return outcome.replace("Convert to ", "");
}

function getActionOwnerDisplay(action: ActionRecord, people: PersonRecord[]) {
  const activePerson = action.ownerPersonId
    ? people.find((person) => person.id === action.ownerPersonId && person.status === "Active")
    : null;

  if (activePerson) {
    return activePerson.name;
  }

  if (action.owner && action.owner.trim()) {
    return action.owner.trim();
  }

  return "Unassigned";
}

function getActionOwnerValue(action: ActionRecord, people: PersonRecord[]) {
  if (action.ownerPersonId) {
    const activeOwner = people.find((person) => person.id === action.ownerPersonId && person.status === "Active");
    if (activeOwner) {
      return activeOwner.id;
    }
  }

  const matchingActivePerson = people.find((person) =>
    person.status === "Active" && person.name.trim().toLowerCase() === (action.owner || "").trim().toLowerCase(),
  );

  return matchingActivePerson ? matchingActivePerson.id : "unassigned";
}

function normalizeProblemRecord(record: CaptureConversionRecord): ProblemRecord {
  const problemStatus =
    (record.problemStatus as ProblemStatus | undefined) ??
    ((record.status === "Open" || record.status === "Investigating" || record.status === "Action required" || record.status === "Resolved" || record.status === "Closed")
      ? (record.status as ProblemStatus)
      : "Open");

  return {
    ...record,
    problemStatement: record.problemStatement?.trim() || record.title,
    severity: (record.severity as ProblemSeverity | undefined) ?? "Medium",
    frequency: (record.frequency as ProblemFrequency | undefined) ?? "Occasional",
    impact: record.impact?.trim() || "",
    rootCauseStatus: (record.rootCauseStatus as RootCauseStatus | undefined) ?? "Not investigated",
    rootCause: record.rootCause?.trim() || "",
    owner: record.owner?.trim() || "",
    resolution: record.resolution?.trim() || "",
    status: problemStatus,
    problemStatus,
  };
}

function normalizeActionRecord(record: CaptureConversionRecord): ActionRecord {
  const actionStatus =
    (record.status as ActionStatus | undefined) ??
    ((record.status === "Open" || record.status === "In Progress" || record.status === "Blocked" || record.status === "Completed" || record.status === "Cancelled")
      ? (record.status as ActionStatus)
      : "Open");

  return {
    ...record,
    actionTitle: record.title?.trim() || "Untitled action",
    description: record.actionDescription?.trim() || record.originalRawNote?.trim() || "",
    owner: record.owner?.trim() || "",
    createdBy: record.createdBy?.trim() || "",
    createdDate: record.createdDate || record.createdAt || new Date().toISOString(),
    dueDate: record.dueDate?.trim() || "",
    priority: (record.priority as ActionPriority | undefined) ?? "Medium",
    status: actionStatus,
    relatedProblem: record.relatedProblem?.trim() || "",
    relatedDecision: record.relatedDecision?.trim() || "",
    relatedCapture: record.relatedCapture?.trim() || record.sourceCaptureId,
    relatedPillar: record.relatedPillar?.trim() || record.relatedArea,
    completionEvidence: record.completionEvidence?.trim() || "",
    completionDate: record.completionDate?.trim() || "",
  };
}

function normalizeDecisionRecord(record: CaptureConversionRecord): DecisionRecord {
  const decisionStatus =
    (record.decisionStatus as DecisionStatus | undefined) ??
    ((record.status === "Draft" || record.status === "Active" || record.status === "Under Review" || record.status === "Completed" || record.status === "Reversed")
      ? (record.status as DecisionStatus)
      : "Draft");

  return {
    ...record,
    decisionTitle: record.decisionTitle?.trim() || record.title,
    decisionStatement: record.decisionStatement?.trim() || record.title,
    decisionMaker: record.decisionMaker?.trim() || "",
    decisionDate: record.decisionDate || record.createdAt || new Date().toISOString(),
    context: record.context?.trim() || "",
    reasoning: record.reasoning?.trim() || "",
    evidenceConsidered: record.evidenceConsidered?.trim() || "",
    alternativesConsidered: record.alternativesConsidered?.trim() || "",
    assumptions: record.assumptions?.trim() || "",
    expectedOutcome: record.expectedOutcome?.trim() || "",
    riskLevel: (record.riskLevel as DecisionRiskLevel | undefined) ?? "Medium",
    reviewDate: record.reviewDate?.trim() || "",
    actualOutcome: record.actualOutcome?.trim() || "",
    outcomeRating: record.outcomeRating?.trim() || "",
    lessons: record.lessons?.trim() || "",
    status: decisionStatus,
    decisionStatus,
    relatedOpportunity: record.relatedOpportunity?.trim() || "",
  };
}

function normalizeOpportunityRecord(record: CaptureConversionRecord): OpportunityRecord {
  const opportunityStatus =
    (record.opportunityStatus as OpportunityStatus | undefined) ??
    ((record.status === "New" || record.status === "Evaluating" || record.status === "On Hold" || record.status === "Approved" || record.status === "Rejected" || record.status === "Completed")
      ? (record.status as OpportunityStatus)
      : "New");

  return {
    ...record,
    opportunityTitle: record.opportunityTitle?.trim() || record.title || "Untitled opportunity",
    description: record.opportunityDescription?.trim() || record.originalRawNote?.trim() || "",
    source: record.source?.trim() || "Unknown",
    dateIdentified: record.dateIdentified || record.createdAt || new Date().toISOString(),
    relatedPillar: record.relatedPillar?.trim() || record.relatedArea || "",
    strategicFit: (record.strategicFit as OpportunityStrategicFit | undefined) ?? "Medium",
    estimatedUpside: record.estimatedUpside?.trim() || "",
    requiredCapital: record.requiredCapital?.trim() || "",
    requiredTime: record.requiredTime?.trim() || "",
    requiredCapability: record.requiredCapability?.trim() || "",
    risks: record.risks?.trim() || "",
    opportunityCost: record.opportunityCost?.trim() || "",
    evidence: record.evidence?.trim() || "",
    owner: record.owner?.trim() || "",
    status: opportunityStatus,
    decision: record.decision?.trim() || "",
    outcome: record.outcome?.trim() || "",
  };
}

function normalizeLessonRecord(record: CaptureConversionRecord): LessonRecord {
  const lessonStatus =
    (record.lessonStatus as LessonStatus | undefined) ??
    ((record.status === "New" || record.status === "Reviewed" || record.status === "Change Required" || record.status === "Implemented" || record.status === "Archived")
      ? (record.status as LessonStatus)
      : "New");

  return {
    ...record,
    lessonTitle: record.lessonTitle?.trim() || record.title || "Untitled lesson",
    description: record.lessonDescription?.trim() || record.originalRawNote?.trim() || "",
    sourceEvent: record.sourceEvent?.trim() || "",
    dateLearned: record.dateLearned || record.createdAt || new Date().toISOString(),
    relatedPillar: record.relatedPillar?.trim() || record.relatedArea || "",
    whyItMatters: record.whyItMatters?.trim() || "",
    recommendedChange: record.recommendedChange?.trim() || "",
    relatedProblem: record.relatedProblem?.trim() || "",
    relatedProject: record.relatedProject?.trim() || "",
    relatedDecision: record.relatedDecision?.trim() || "",
    relatedSystem: record.relatedSystem?.trim() || "",
    owner: record.owner?.trim() || "",
    status: lessonStatus,
  };
}

function normalizeSystemRecord(record: CaptureConversionRecord): SystemRecord {
  const systemStatus =
    (record.systemStatus as SystemStatus | undefined) ??
    ((record.status === "Draft" || record.status === "Active" || record.status === "Reviewing" || record.status === "Deprecated")
      ? (record.status as SystemStatus)
      : "Draft");

  return {
    ...record,
    systemName: record.systemName?.trim() || record.title || "Untitled system",
    purpose: record.purpose?.trim() || record.originalRawNote?.trim() || "",
    owner: record.owner?.trim() || "",
    area: record.area?.trim() || record.relatedPillar?.trim() || record.relatedArea || "",
    inputs: record.inputs?.trim() || "",
    process: record.process?.trim() || record.purpose?.trim() || "",
    outputs: record.outputs?.trim() || "",
    standards: record.standards?.trim() || "",
    failurePoints: record.failurePoints?.trim() || "",
    version: record.version?.trim() || "v1",
    lastReviewed: record.lastReviewed || record.createdAt || new Date().toISOString(),
    status: systemStatus,
    relatedLesson: record.relatedLesson?.trim() || "",
    relatedCapture: record.relatedCapture?.trim() || record.sourceCaptureId,
  };
}

function normalizeSopRecord(record: CaptureConversionRecord): SopRecord {
  const sopStatus =
    (record.sopStatus as SopStatus | undefined) ??
    ((record.status === "Draft" || record.status === "Active" || record.status === "Reviewing" || record.status === "Deprecated" || record.status === "Archived")
      ? (record.status as SopStatus)
      : "Draft");

  return {
    ...record,
    sopTitle: record.sopTitle?.trim() || record.title || "Untitled SOP",
    purpose: record.sopPurpose?.trim() || record.purpose?.trim() || record.originalRawNote?.trim() || "",
    owner: record.owner?.trim() || "",
    relatedSystem: record.relatedSystem?.trim() || "",
    applicableRoles: record.applicableRoles?.trim() || "",
    procedure: record.procedure?.trim() || record.process?.trim() || record.originalRawNote?.trim() || "",
    requiredTools: record.requiredTools?.trim() || "",
    safetyConsiderations: record.safetyConsiderations?.trim() || "",
    qualityStandard: record.qualityStandard?.trim() || record.standards?.trim() || "",
    completionEvidence: record.completionEvidence?.trim() || "",
    version: record.version?.trim() || "v1",
    effectiveDate: record.effectiveDate || record.createdAt || new Date().toISOString(),
    reviewDate: record.reviewDate?.trim() || "",
    status: sopStatus,
    relatedLesson: record.relatedLesson?.trim() || "",
    relatedCapture: record.relatedCapture?.trim() || record.sourceCaptureId,
  };
}

const LEGACY_DUPLICATE_SYSTEM_CLEANUP_KEY = "empire-os-cleanup-lesson-test-systems-v1";

function cleanupLegacyDuplicateLessonTestSystems(records: CaptureConversionRecord[]) {
  const groupedByLesson = new Map<string, CaptureConversionRecord[]>();

  for (const record of records) {
    if (record.targetType !== "Convert to System") {
      continue;
    }

    if (!record.systemName || record.systemName.trim() !== "Lesson test") {
      continue;
    }

    const lessonId = (record.relatedLesson || record.sourceCaptureId || record.id || "").trim();
    if (!lessonId) {
      continue;
    }

    const key = `${lessonId}|${record.systemName.trim()}`;
    const group = groupedByLesson.get(key) ?? [];
    group.push(record);
    groupedByLesson.set(key, group);
  }

  const idsToRemove = new Set<string>();

  for (const group of groupedByLesson.values()) {
    if (group.length < 2) {
      continue;
    }

    const ordered = [...group].sort(
      (first, second) => new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime(),
    );

    ordered.slice(1).forEach((record) => idsToRemove.add(record.id));
  }

  return records.filter((record) => !idsToRemove.has(record.id));
}

const destinationDefinitions = [
  {
    key: "Problems",
    title: "Problems",
    targetType: "Convert to Problem",
    description:
      "Problem records created from Capture entries are listed here to preserve the original intake while making the operational issue visible in its own destination.",
  },
  {
    key: "Opportunities",
    title: "Opportunities",
    targetType: "Convert to Opportunity",
    description:
      "Opportunity records created from Capture entries are listed here to preserve the original intake and maintain a dedicated destination for emerging upside.",
  },
  {
    key: "Actions",
    title: "Actions",
    targetType: "Convert to Action",
    description:
      "Action records created from Capture entries are listed here to preserve the original intake and keep work items in a clear operational destination.",
  },
  {
    key: "Decisions",
    title: "Decisions",
    targetType: "Convert to Decision",
    description:
      "Decision records created from Capture entries are listed here to preserve the original intake and keep strategic or operational choices visible in one place.",
  },
  {
    key: "Lessons",
    title: "Lessons",
    targetType: "Convert to Lesson",
    description:
      "Lesson records created from Capture entries are listed here to preserve the original intake and keep learning visible for future operational use.",
  },
  {
    key: "Systems",
    title: "Systems",
    targetType: "Convert to System",
    description:
      "System records created from lessons or captures are listed here to keep repeatable operational improvements visible and traceable.",
  },
  {
    key: "SOPs",
    title: "SOPs",
    targetType: "Convert to SOP",
    description:
      "SOP records created from approved systems are listed here to turn repeatable process into a practical operating procedure.",
  },
] as const;

type DestinationKey = "Command" | "Empire" | "Capture" | "People" | "Projects" | "Leads" | "Finance" | "Metrics" | "Pillars" | (typeof destinationDefinitions)[number]["key"];

type RelatedRecordItem = {
  label: string;
  title: string;
  id: string;
  onClick?: () => void;
};

type RelatedRecordsPanelProps = {
  upstream: RelatedRecordItem[];
  downstream: RelatedRecordItem[];
};

type CommandRecordItem = {
  id: string;
  objectType: CommandRecordType;
  title: string;
  searchText: string;
  createdAt: string;
  startDate?: string;
  operationalDate: string;
  owner: string;
  status: string;
  area: string;
  sourceCaptureId: string;
  onOpen: () => void;
};

type AttentionObjectType = "Problem" | "Action" | "Decision" | "Opportunity" | "Lesson" | "System" | "SOP";
type CommandRecordType = AttentionObjectType | "Project";

type CommandRecordGroup = {
  label: string;
  records: CommandRecordItem[];
};

function isObviousTestTitle(title: string) {
  const recordKinds = "capture|action|decision|opportunity|project|lesson|problem|system|sop|record|item";
  const directTestTitle = new RegExp(`^(?:(?:test|demo)(?:\\s+(?:${recordKinds}))?|(?:${recordKinds})\\s+(?:test|demo))$`, "i");
  const derivativePrefix = new RegExp(`^(?:(?:from\\s+(?:${recordKinds}))|review):\\s*(.+)$`, "i");
  let candidate = title.trim();

  while (candidate) {
    if (directTestTitle.test(candidate)) {
      return true;
    }

    const derivativeMatch = candidate.match(derivativePrefix);
    if (!derivativeMatch) {
      return false;
    }
    candidate = derivativeMatch[1].trim();
  }

  return false;
}

type RecordControls = {
  searchQuery: string;
  selectedType: string;
  selectedStatus: string;
  selectedArea: string;
  selectedOwner: string;
  selectedCreatedDate: string;
  selectedOperationalDate: string;
  sortOrder: string;
  attentionOnly: boolean;
};

type SavedRecordView = {
  id: string;
  name: string;
  controls: RecordControls;
  updatedAt?: string;
  pinned?: boolean;
};

function CommandRecordRegister({ groups, attentionRecordKeys, testSourceCaptureIds }: { groups: CommandRecordGroup[]; attentionRecordKeys: string[]; testSourceCaptureIds: string[] }) {
  const allTypeValue = "All";
  const getDefaultRecordControls = (): RecordControls => ({
    searchQuery: "",
    selectedType: allTypeValue,
    selectedStatus: "All statuses",
    selectedArea: "All areas",
    selectedOwner: "All owners",
    selectedCreatedDate: "All dates",
    selectedOperationalDate: "All due dates",
    sortOrder: "Default",
    attentionOnly: false,
  });
  const [recordControls, setRecordControls] = useState<RecordControls>(getDefaultRecordControls);
  const [savedViews, setSavedViews] = useState<SavedRecordView[]>([]);
  const [savedViewName, setSavedViewName] = useState("");
  const [selectedSavedViewId, setSelectedSavedViewId] = useState("");
  const [renameViewName, setRenameViewName] = useState("");
  const [updatedSavedViewId, setUpdatedSavedViewId] = useState("");
  const [defaultSavedViewId, setDefaultSavedViewId] = useState("");
  const [savedViewsLoaded, setSavedViewsLoaded] = useState(false);
  const [defaultSavedViewLoaded, setDefaultSavedViewLoaded] = useState(false);
  const [hideTestRecords, setHideTestRecords] = useState(true);
  const { searchQuery, selectedType, selectedStatus, selectedArea, selectedOwner, selectedCreatedDate, selectedOperationalDate, sortOrder, attentionOnly } = recordControls;
  const updateRecordControls = (updates: Partial<RecordControls>) =>
    setRecordControls((current) => ({ ...current, ...updates }));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const storedViews = window.localStorage.getItem(SAVED_VIEWS_STORAGE_KEY);
      const storedDefaultViewId = window.localStorage.getItem(DEFAULT_SAVED_VIEW_STORAGE_KEY);
      if (storedViews) {
        const parsedViews = JSON.parse(storedViews);
        if (Array.isArray(parsedViews)) {
          setSavedViews(parsedViews);
          const defaultView = parsedViews.find((view) => view.id === storedDefaultViewId);
          if (defaultView) {
            setDefaultSavedViewId(defaultView.id);
            setSelectedSavedViewId(defaultView.id);
            setRenameViewName(defaultView.name);
            setRecordControls({ ...defaultView.controls });
          }
        }
      }
    } catch {
      setSavedViews([]);
    } finally {
      setSavedViewsLoaded(true);
      setDefaultSavedViewLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!savedViewsLoaded) {
      return;
    }

    if (savedViews.length === 0) {
      window.localStorage.removeItem(SAVED_VIEWS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(savedViews));
    }
  }, [savedViews, savedViewsLoaded]);

  useEffect(() => {
    if (!defaultSavedViewLoaded) {
      return;
    }

    if (defaultSavedViewId) {
      window.localStorage.setItem(DEFAULT_SAVED_VIEW_STORAGE_KEY, defaultSavedViewId);
    } else {
      window.localStorage.removeItem(DEFAULT_SAVED_VIEW_STORAGE_KEY);
    }
  }, [defaultSavedViewId, defaultSavedViewLoaded]);
  const typeOptions: Array<{ label: string; value: CommandRecordType }> = [
    { label: "Problems", value: "Problem" },
    { label: "Actions", value: "Action" },
    { label: "Decisions", value: "Decision" },
    { label: "Opportunities", value: "Opportunity" },
    { label: "Projects", value: "Project" },
    { label: "Lessons", value: "Lesson" },
    { label: "Systems", value: "System" },
    { label: "SOPs", value: "SOP" },
  ];
  const statusOptions = Array.from(new Set(groups.flatMap((group) => group.records.map((record) => record.status)))).sort();
  const areaOptions = Array.from(new Set(groups.flatMap((group) => group.records.map((record) => record.area).filter(Boolean)))).sort();
  const ownerOptions = Array.from(new Set(groups.flatMap((group) => group.records.map((record) => record.owner || "Unassigned")))).sort();
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const attentionKeySet = new Set(attentionRecordKeys);
  const getCreatedTime = (record: CommandRecordItem) => {
    const timestamp = new Date(record.createdAt).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  };
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const nextSevenDays = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  const matchesCreatedDate = (record: CommandRecordItem) => {
    if (selectedCreatedDate === "All dates") return true;
    if (record.objectType === "Project") return true;
    const createdTime = getCreatedTime(record);
    if (createdTime === null) return false;
    if (selectedCreatedDate === "Today") return createdTime >= startOfToday;
    if (selectedCreatedDate === "Last 7 days") return createdTime >= sevenDaysAgo;
    if (selectedCreatedDate === "Last 30 days") return createdTime >= thirtyDaysAgo;
    return createdTime < thirtyDaysAgo;
  };
  const matchesOperationalDate = (record: CommandRecordItem) => {
    if (selectedOperationalDate === "All due dates") return true;
    const operationalTime = record.operationalDate ? new Date(record.operationalDate).getTime() : null;
    const hasDate = operationalTime !== null && !Number.isNaN(operationalTime);
    if (selectedOperationalDate === "No due/review date") return !hasDate;
    if (!hasDate) return false;
    if (selectedOperationalDate === "Overdue") return operationalTime < startOfToday;
    if (selectedOperationalDate === "Due today") return operationalTime >= startOfToday && operationalTime < startOfTomorrow;
    if (selectedOperationalDate === "Due in next 7 days") return operationalTime >= startOfTomorrow && operationalTime <= nextSevenDays;
    return operationalTime > nextSevenDays;
  };
  const applyQuickView = (view: string) => {
    switch (view) {
      case "Attention":
        setRecordControls({ ...getDefaultRecordControls(), attentionOnly: true });
        return;
      case "Open actions":
        setRecordControls({ ...getDefaultRecordControls(), selectedType: "Action", selectedStatus: "Open" });
        return;
      case "Overdue":
        setRecordControls({ ...getDefaultRecordControls(), selectedOperationalDate: "Overdue" });
        return;
      case "Unassigned":
        setRecordControls({ ...getDefaultRecordControls(), selectedOwner: "Unassigned" });
        return;
      case "Recent":
        setRecordControls({ ...getDefaultRecordControls(), selectedCreatedDate: "Last 7 days" });
        return;
      default:
        setSelectedSavedViewId("");
        setRenameViewName("");
        setUpdatedSavedViewId("");
        setRecordControls(getDefaultRecordControls());
    }
  };
  const saveCurrentView = () => {
    const name = savedViewName.trim();
    if (!name) {
      return;
    }

    setSavedViews((current) => [
      ...current.filter((view) => view.name.toLowerCase() !== name.toLowerCase()),
      { id: `${Date.now()}-${name}`, name, controls: { ...recordControls }, updatedAt: new Date().toISOString(), pinned: false },
    ]);
    setSelectedSavedViewId("");
    setSavedViewName("");
  };
  const renameSelectedView = () => {
    const name = renameViewName.trim();
    if (!name || !selectedSavedViewId) {
      return;
    }

    setSavedViews((current) => current.map((view) =>
      view.id === selectedSavedViewId ? { ...view, name, updatedAt: new Date().toISOString() } : view,
    ));
    setRenameViewName(name);
  };
  const duplicateSelectedView = () => {
    if (!selectedSavedViewId) {
      return;
    }

    setSavedViews((current) => {
      const selectedView = current.find((view) => view.id === selectedSavedViewId);
      if (!selectedView) {
        return current;
      }

      return [
        ...current,
        {
          id: `${Date.now()}-${selectedView.id}`,
          name: `${selectedView.name} copy`,
          controls: { ...selectedView.controls },
          updatedAt: new Date().toISOString(),
          pinned: false,
        },
      ];
    });
  };
  const updateSelectedView = () => {
    if (!selectedSavedViewId) {
      return;
    }

    setSavedViews((current) => current.map((view) =>
      view.id === selectedSavedViewId
        ? { ...view, controls: { ...recordControls }, updatedAt: new Date().toISOString() }
        : view,
    ));
    setUpdatedSavedViewId(selectedSavedViewId);
  };
  const deleteSavedView = (viewId: string) => {
    setSavedViews((current) => current.filter((view) => view.id !== viewId));
    if (viewId === defaultSavedViewId) {
      setDefaultSavedViewId("");
    }
    if (viewId === selectedSavedViewId) {
      setSelectedSavedViewId("");
      setRenameViewName("");
      setUpdatedSavedViewId("");
    }
  };
  const toggleSelectedViewPin = () => {
    if (!selectedSavedViewId) {
      return;
    }

    setSavedViews((current) => current.map((view) =>
      view.id === selectedSavedViewId ? { ...view, pinned: !view.pinned } : view,
    ));
  };
  const compareRecords = (left: CommandRecordItem, right: CommandRecordItem) => {
    if (sortOrder === "Title A-Z" || sortOrder === "Title Z-A") {
      const titleOrder = left.title.localeCompare(right.title);
      return (sortOrder === "Title Z-A" ? -1 : 1) * (titleOrder || left.id.localeCompare(right.id));
    }

    if (sortOrder === "Status A-Z") {
      return left.status.localeCompare(right.status) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
    }

    if (sortOrder === "Newest first" || sortOrder === "Oldest first") {
      const leftTime = getCreatedTime(left);
      const rightTime = getCreatedTime(right);

      if (leftTime !== null || rightTime !== null) {
        if (leftTime === null) return 1;
        if (rightTime === null) return -1;
        if (leftTime !== rightTime) return sortOrder === "Newest first" ? rightTime - leftTime : leftTime - rightTime;
      }
    }

    return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
  };
  const obviousTestSourceIds = new Set([
    ...testSourceCaptureIds,
    ...groups.flatMap((group) => group.records
      .filter((record) => record.sourceCaptureId && isObviousTestTitle(record.title))
      .map((record) => record.sourceCaptureId)),
  ]);
  const isObviousTestRecord = (record: CommandRecordItem) =>
    isObviousTestTitle(record.title) || Boolean(record.sourceCaptureId && obviousTestSourceIds.has(record.sourceCaptureId));
  const filteredGroups = groups
    .map((group) => ({
      ...group,
      records: group.records.filter((record) => {
        const matchesSearch = !normalizedQuery || record.searchText.toLowerCase().includes(normalizedQuery);
        const matchesType = selectedType === allTypeValue || record.objectType === selectedType;
        const matchesStatus = selectedStatus === "All statuses" || record.status === selectedStatus;
        const matchesArea = selectedArea === "All areas" || record.area === selectedArea;
        const matchesOwner = selectedOwner === "All owners" || (record.owner || "Unassigned") === selectedOwner;
        const matchesDate = matchesCreatedDate(record);
        const matchesOperational = matchesOperationalDate(record);
        const matchesAttention = !attentionOnly || attentionKeySet.has(`${record.objectType}:${record.id}`);
        const matchesTestVisibility = !hideTestRecords || !isObviousTestRecord(record);
        return matchesSearch && matchesType && matchesStatus && matchesArea && matchesOwner && matchesDate && matchesOperational && matchesAttention && matchesTestVisibility;
      }).sort((left, right) => sortOrder === "Default" ? 0 : compareRecords(left, right)),
    }))
    .filter((group) => group.records.length > 0);
  const totalRecordCount = groups.reduce((total, group) => total + group.records.length, 0);
  const hiddenTestRecordCount = hideTestRecords
    ? groups.reduce((total, group) => total + group.records.filter(isObviousTestRecord).length, 0)
    : 0;
  const visibleRecordCount = filteredGroups.reduce((total, group) => total + group.records.length, 0);
  const hasActiveFilters = Boolean(normalizedQuery) || selectedType !== allTypeValue || selectedStatus !== "All statuses" || selectedArea !== "All areas" || selectedOwner !== "All owners" || selectedCreatedDate !== "All dates" || selectedOperationalDate !== "All due dates" || sortOrder !== "Default" || attentionOnly;
  const getProjectLifecycleDescriptor = (status: string) => ({
    Open: "Open project",
    "In Progress": "Project in progress",
    Blocked: "Blocked project",
    Completed: "Completed project",
    Cancelled: "Cancelled project",
  }[status] ?? null);
  const getProjectTimingDescriptor = (record: CommandRecordItem) => {
    if (record.objectType !== "Project") {
      return null;
    }

    const parseCalendarDate = (value?: string) => {
      if (!value) return null;
      const date = new Date(`${value}T00:00:00`);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = parseCalendarDate(record.operationalDate);
    const startDate = parseCalendarDate(record.startDate);
    const isFinal = ["completed", "cancelled"].includes(record.status.trim().toLowerCase());

    if (targetDate && !isFinal) {
      const daysUntilTarget = Math.round((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntilTarget < 0) return `Overdue by ${Math.abs(daysUntilTarget)} day${daysUntilTarget === -1 ? "" : "s"}`;
      if (daysUntilTarget === 0) return "Due today";
      return `Due in ${daysUntilTarget} day${daysUntilTarget === 1 ? "" : "s"}`;
    }

    if (startDate) {
      const daysFromStart = Math.round((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (daysFromStart === 0) return "Starts today";
      if (daysFromStart > 0) return `Starts in ${daysFromStart} day${daysFromStart === 1 ? "" : "s"}`;
      return `Started ${Math.abs(daysFromStart)} day${daysFromStart === -1 ? "" : "s"} ago`;
    }

    return null;
  };
  const selectedSavedView = savedViews.find((view) => view.id === selectedSavedViewId);
  const orderedSavedViews = [
    ...savedViews.filter((view) => view.pinned),
    ...savedViews.filter((view) => !view.pinned),
  ];

  return (
    <section className="mt-6 border-t border-[#d7d1ca] pt-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#4d4944]">Operating picture</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[24px] font-semibold tracking-[-0.05em] text-[#171717]">Records in motion</h2>
            <span className="text-[11px] text-[#6a625d]">
              {visibleRecordCount} {visibleRecordCount === 1 ? "record" : "records"}{hasActiveFilters || hiddenTestRecordCount > 0 ? ` shown of ${totalRecordCount}` : ""}
            </span>
          </div>
        </div>
        <p className="text-right text-[11px] leading-5 text-[#5e5953]">Stored records remain visible here, whether urgent or not.</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[10px] uppercase tracking-[0.14em] text-[#6a625d]">Quick views</span>
        <button type="button" onClick={() => applyQuickView("All records")} className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-2.5 py-1.5 text-[11px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]">All records</button>
        <button type="button" onClick={() => applyQuickView("Attention")} className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-2.5 py-1.5 text-[11px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]">Attention</button>
        <button type="button" onClick={() => applyQuickView("Open actions")} className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-2.5 py-1.5 text-[11px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]">Open actions</button>
        <button type="button" onClick={() => applyQuickView("Overdue")} className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-2.5 py-1.5 text-[11px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]">Overdue</button>
        <button type="button" onClick={() => applyQuickView("Unassigned")} className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-2.5 py-1.5 text-[11px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]">Unassigned</button>
        <button type="button" onClick={() => applyQuickView("Recent")} className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-2.5 py-1.5 text-[11px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]">Recent</button>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <div className="flex min-w-0 flex-1 gap-2">
          <input
            value={savedViewName}
            onChange={(event) => setSavedViewName(event.target.value)}
            placeholder="Save current view"
            aria-label="Saved view name"
            className="min-w-0 flex-1 rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[12px] text-[#171717] outline-none placeholder:text-[#7a726b] focus:border-[#171717]"
          />
          <button
            type="button"
            onClick={saveCurrentView}
            disabled={!savedViewName.trim()}
            className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-3 py-2 text-[12px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717] disabled:cursor-not-allowed disabled:opacity-45"
          >
            Save view
          </button>
        </div>
        {savedViews.length > 0 ? (
          <select
            value={selectedSavedViewId}
            onChange={(event) => {
              const viewId = event.target.value;
              setSelectedSavedViewId(viewId);
              setUpdatedSavedViewId("");
              const selectedView = savedViews.find((view) => view.id === viewId);
              if (selectedView) {
                setRecordControls({ ...selectedView.controls });
                setRenameViewName(selectedView.name);
              } else {
                setRenameViewName("");
              }
            }}
            aria-label="Apply saved view"
            className="rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[12px] text-[#171717] outline-none focus:border-[#171717]"
          >
            <option value="">Saved views</option>
            {orderedSavedViews.map((view) => <option key={view.id} value={view.id}>{view.pinned ? "Pinned: " : ""}{view.name}{view.id === defaultSavedViewId ? " (Default)" : ""}</option>)}
          </select>
        ) : null}
        {selectedSavedViewId ? (
          <div className="flex min-w-0 gap-2">
            <input
              value={renameViewName}
              onChange={(event) => setRenameViewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  renameSelectedView();
                }
              }}
              placeholder="Rename selected view"
              aria-label="New saved view name"
              className="min-w-0 w-40 rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[12px] text-[#171717] outline-none placeholder:text-[#7a726b] focus:border-[#171717]"
            />
            <button
              type="button"
              onClick={renameSelectedView}
              disabled={!renameViewName.trim()}
              className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-3 py-2 text-[12px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={duplicateSelectedView}
              className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-3 py-2 text-[12px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]"
            >
              Duplicate
            </button>
            <button
              type="button"
              onClick={updateSelectedView}
              className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-3 py-2 text-[12px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]"
            >
              Update
            </button>
            <button
              type="button"
              onClick={() => setDefaultSavedViewId(selectedSavedViewId)}
              disabled={selectedSavedViewId === defaultSavedViewId}
              className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-3 py-2 text-[12px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717] disabled:cursor-default disabled:opacity-45"
            >
              Set as default
            </button>
            {defaultSavedViewId ? (
              <button
                type="button"
                onClick={() => setDefaultSavedViewId("")}
                className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-3 py-2 text-[12px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]"
              >
                Clear default
              </button>
            ) : null}
              <button
                type="button"
                onClick={toggleSelectedViewPin}
                className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-3 py-2 text-[12px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]"
              >
                {selectedSavedView?.pinned ? "Unpin" : "Pin"}
              </button>
            {updatedSavedViewId === selectedSavedViewId ? (
              <span aria-live="polite" className="self-center text-[10px] text-[#6a625d]">Updated</span>
            ) : null}
            {selectedSavedView ? (
              <span className="self-center text-[10px] text-[#7a726b]">{formatSavedViewUpdatedAt(selectedSavedView.updatedAt)}</span>
            ) : null}
          </div>
        ) : null}
        {savedViews.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {orderedSavedViews.map((view) => (
              <button
                key={view.id}
                type="button"
                onClick={() => deleteSavedView(view.id)}
                aria-label={`Delete saved view ${view.name}`}
                className="rounded-lg border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1 text-[10px] text-[#6a625d] hover:border-[#171717] hover:text-[#171717]"
              >
                Delete {view.pinned ? "Pinned: " : ""}{view.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={searchQuery}
          onChange={(event) => updateRecordControls({ searchQuery: event.target.value })}
          placeholder="Search records"
          aria-label="Search Records in Motion"
          className="min-w-0 flex-1 rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[12px] text-[#171717] outline-none placeholder:text-[#7a726b] focus:border-[#171717]"
        />
        <select
          value={selectedType}
          onChange={(event) => updateRecordControls({ selectedType: event.target.value })}
          aria-label="Filter Records in Motion by type"
          className="rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[12px] text-[#171717] outline-none focus:border-[#171717]"
        >
          <option value={allTypeValue}>All types</option>
          {typeOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {searchQuery ? (
          <button
            type="button"
            onClick={() => updateRecordControls({ searchQuery: "" })}
            className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-3 py-2 text-[12px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]"
          >
            Clear search
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={attentionOnly}
          onClick={() => updateRecordControls({ attentionOnly: !attentionOnly })}
          className={[
            "rounded-lg border px-3 py-2 text-[12px] transition",
            attentionOnly
              ? "border-[#171717] bg-[#171717] text-[#f9f7f4]"
              : "border-[#cfc8c1] bg-white text-[#171717] hover:border-[#171717]",
          ].join(" ")}
        >
          Attention only
        </button>
        <button
          type="button"
          aria-pressed={hideTestRecords}
          onClick={() => setHideTestRecords((current) => !current)}
          className={[
            "rounded-lg border px-3 py-2 text-[12px] transition",
            hideTestRecords
              ? "border-[#171717] bg-[#171717] text-[#f9f7f4]"
              : "border-[#cfc8c1] bg-white text-[#171717] hover:border-[#171717]",
          ].join(" ")}
        >
          Hide test records
          {hiddenTestRecordCount > 0 ? ` (${hiddenTestRecordCount})` : ""}
        </button>
        <select
          value={selectedStatus}
          onChange={(event) => updateRecordControls({ selectedStatus: event.target.value })}
          aria-label="Filter Records in Motion by status"
          className="rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[12px] text-[#171717] outline-none focus:border-[#171717]"
        >
          <option value="All statuses">All statuses</option>
          {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <select
          value={selectedArea}
          onChange={(event) => updateRecordControls({ selectedArea: event.target.value })}
          aria-label="Filter Records in Motion by area"
          className="rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[12px] text-[#171717] outline-none focus:border-[#171717]"
        >
          <option value="All areas">All areas</option>
          {areaOptions.map((area) => <option key={area} value={area}>{area}</option>)}
        </select>
        <select
          value={selectedOwner}
          onChange={(event) => updateRecordControls({ selectedOwner: event.target.value })}
          aria-label="Filter Records in Motion by owner"
          className="rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[12px] text-[#171717] outline-none focus:border-[#171717]"
        >
          <option value="All owners">All owners</option>
          {ownerOptions.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
        </select>
        <select
          value={selectedCreatedDate}
          onChange={(event) => updateRecordControls({ selectedCreatedDate: event.target.value })}
          aria-label="Filter Records in Motion by created date"
          className="rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[12px] text-[#171717] outline-none focus:border-[#171717]"
        >
          <option>All dates</option>
          <option>Today</option>
          <option>Last 7 days</option>
          <option>Last 30 days</option>
          <option>Older than 30 days</option>
        </select>
        <select
          value={selectedOperationalDate}
          onChange={(event) => updateRecordControls({ selectedOperationalDate: event.target.value })}
          aria-label="Filter Records in Motion by due or review date"
          className="rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[12px] text-[#171717] outline-none focus:border-[#171717]"
        >
          <option>All due dates</option>
          <option>Overdue</option>
          <option>Due today</option>
          <option>Due in next 7 days</option>
          <option>Due later</option>
          <option>No due/review date</option>
        </select>
        {selectedType !== allTypeValue || selectedStatus !== "All statuses" || selectedArea !== "All areas" || selectedOwner !== "All owners" || selectedCreatedDate !== "All dates" || selectedOperationalDate !== "All due dates" ? (
          <button
            type="button"
            onClick={() => {
              updateRecordControls({ selectedType: allTypeValue, selectedStatus: "All statuses", selectedArea: "All areas", selectedOwner: "All owners", selectedCreatedDate: "All dates", selectedOperationalDate: "All due dates" });
            }}
            className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-3 py-2 text-[12px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]"
          >
            Clear filters
          </button>
        ) : null}
        <select
          value={sortOrder}
          onChange={(event) => updateRecordControls({ sortOrder: event.target.value })}
          aria-label="Sort Records in Motion"
          className="rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[12px] text-[#171717] outline-none focus:border-[#171717]"
        >
          <option>Default</option>
          <option>Newest first</option>
          <option>Oldest first</option>
          <option>Title A-Z</option>
          <option>Title Z-A</option>
          <option>Status A-Z</option>
        </select>
        {sortOrder !== "Default" ? (
          <button
            type="button"
            onClick={() => updateRecordControls({ sortOrder: "Default" })}
            className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-3 py-2 text-[12px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]"
          >
            Clear sort
          </button>
        ) : null}
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={() => {
              setRecordControls(getDefaultRecordControls());
            }}
            className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-3 py-2 text-[12px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]"
          >
            Reset
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setCollapsedGroups((current) => new Set([...current, ...filteredGroups.map((group) => group.label)]))}
          className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-3 py-2 text-[12px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]"
        >
          Collapse all
        </button>
        <button
          type="button"
          onClick={() => setCollapsedGroups((current) => {
            const next = new Set(current);
            filteredGroups.forEach((group) => next.delete(group.label));
            return next;
          })}
          className="rounded-lg border border-[#cfc8c1] bg-[#f9f7f4] px-3 py-2 text-[12px] text-[#4d4944] transition hover:border-[#171717] hover:text-[#171717]"
        >
          Expand all
        </button>
      </div>

      {hasActiveFilters ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-[0.12em] text-[#6a625d]" aria-label="Active Records in Motion controls">
          {searchQuery ? (
            <button type="button" onClick={() => updateRecordControls({ searchQuery: "" })} className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1 hover:border-[#171717]">
              Search: {searchQuery} <span aria-hidden="true">×</span>
            </button>
          ) : null}
          {selectedType !== allTypeValue ? (
            <button type="button" onClick={() => updateRecordControls({ selectedType: allTypeValue })} className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1 hover:border-[#171717]">
              Type: {typeOptions.find((option) => option.value === selectedType)?.label} <span aria-hidden="true">×</span>
            </button>
          ) : null}
          {selectedStatus !== "All statuses" ? (
            <button type="button" onClick={(event) => { event.stopPropagation(); updateRecordControls({ selectedStatus: "All statuses" }); }} className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1 hover:border-[#171717]">
              Status: {selectedStatus} <span aria-hidden="true">×</span>
            </button>
          ) : null}
          {selectedArea !== "All areas" ? (
            <button type="button" onClick={() => updateRecordControls({ selectedArea: "All areas" })} className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1 hover:border-[#171717]">
              Area: {selectedArea} <span aria-hidden="true">×</span>
            </button>
          ) : null}
          {selectedOwner !== "All owners" ? (
            <button type="button" onClick={() => updateRecordControls({ selectedOwner: "All owners" })} className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1 hover:border-[#171717]">
              Owner: {selectedOwner} <span aria-hidden="true">×</span>
            </button>
          ) : null}
          {selectedCreatedDate !== "All dates" ? (
            <button type="button" onClick={() => updateRecordControls({ selectedCreatedDate: "All dates" })} className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1 hover:border-[#171717]">
              Created: {selectedCreatedDate} <span aria-hidden="true">×</span>
            </button>
          ) : null}
          {selectedOperationalDate !== "All due dates" ? (
            <button type="button" onClick={() => updateRecordControls({ selectedOperationalDate: "All due dates" })} className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1 hover:border-[#171717]">
              Due/review: {selectedOperationalDate} <span aria-hidden="true">×</span>
            </button>
          ) : null}
          {sortOrder !== "Default" ? (
            <button type="button" onClick={() => updateRecordControls({ sortOrder: "Default" })} className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1 hover:border-[#171717]">
              Sort: {sortOrder} <span aria-hidden="true">×</span>
            </button>
          ) : null}
          {attentionOnly ? (
            <button type="button" onClick={() => updateRecordControls({ attentionOnly: false })} className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1 hover:border-[#171717]">
              Attention only <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {filteredGroups.length === 0 ? (
        <div className="mt-4 rounded-xl border border-[#c9b8a3] bg-[#f5efe6] px-3 py-4 text-[12px] text-[#4d4944]" aria-live="polite">
          {totalRecordCount > 0 && (hasActiveFilters || hiddenTestRecordCount > 0) ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium text-[#171717]">
                  {hiddenTestRecordCount === totalRecordCount
                    ? `All ${totalRecordCount} stored records are currently hidden as obvious test/demo records.`
                    : selectedSavedView
                      ? `Saved view “${selectedSavedView.name}” is hiding all ${totalRecordCount} stored records.`
                      : `The current filters are hiding all ${totalRecordCount} stored records.`}
                </div>
                <div className="mt-1 text-[11px] text-[#6a625d]">
                  {hiddenTestRecordCount === totalRecordCount
                    ? "Turn off Hide test records to reveal them for development."
                    : "Showing all records will clear the active controls without changing or deleting the saved view."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => hiddenTestRecordCount === totalRecordCount ? setHideTestRecords(false) : applyQuickView("All records")}
                className="shrink-0 rounded-lg border border-[#171717] bg-[#171717] px-3 py-2 text-[11px] font-medium text-[#f9f7f4] transition hover:bg-[#35312e]"
              >
                {hiddenTestRecordCount === totalRecordCount ? "Show test records" : "Show all records"}
              </button>
            </div>
          ) : (
            "No records stored."
          )}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {filteredGroups.map((group) => (
          <section key={group.label} className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4">
            <button
              type="button"
              onClick={() => setCollapsedGroups((current) => {
                const next = new Set(current);
                if (next.has(group.label)) {
                  next.delete(group.label);
                } else {
                  next.add(group.label);
                }
                return next;
              })}
              className="flex w-full items-center justify-between gap-3 border-b border-[#e0dad4] pb-3 text-left"
              aria-expanded={!collapsedGroups.has(group.label)}
            >
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">{group.label}</h3>
              <span className="flex items-center gap-2 text-[11px] tabular-nums text-[#5e5953]">
                {group.records.length} {group.records.length === 1 ? "record" : "records"}
                <span aria-hidden="true" className="text-[14px]">{collapsedGroups.has(group.label) ? "+" : "−"}</span>
              </span>
            </button>

            {!collapsedGroups.has(group.label) ? (
              group.records.length === 0 ? (
                <p className="pt-3 text-[12px] text-[#6a625d]">No records stored.</p>
              ) : (
                <div className="divide-y divide-[#e0dad4]">
                  {group.records.map((record) => (
                    <button
                      key={record.id}
                      type="button"
                      onClick={record.onOpen}
                      className="block w-full py-3 text-left transition first:pt-3 last:pb-0 hover:text-[#6a3328]"
                      aria-label={`Open ${record.objectType}: ${record.title}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0 truncate text-[14px] font-medium text-[#171717]">{record.title}</span>
                        <div className="shrink-0 text-right">
                          <span className="block text-[9px] uppercase tracking-[0.14em] text-[#5e5953]">{record.status}</span>
                          {record.objectType === "Project" && getProjectLifecycleDescriptor(record.status) ? (
                            <span className="mt-0.5 block text-[9px] text-[#7a726b]">{getProjectLifecycleDescriptor(record.status)}</span>
                          ) : null}
                          {getProjectTimingDescriptor(record) ? (
                            <span className="mt-0.5 block text-[9px] text-[#7a726b]">{getProjectTimingDescriptor(record)}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-[0.12em] text-[#6a625d]">
                        {record.area ? <span>{record.area}</span> : null}
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : null}
          </section>
        ))}
        </div>
      )}
    </section>
  );
}

type ProjectLinkOption = { id: string; title: string };

type ProjectLinkSectionKey = "relatedActionIds" | "relatedDecisionIds" | "relatedSystemIds" | "relatedSopIds";

function ProjectDetailPanel({ project, people, actions, decisions, systems, sops, onClose, onChange, onSave, onAddLink, onRemoveLink, onOpenRecord }: {
  project: ProjectRecord;
  people: PersonRecord[];
  actions: ActionRecord[];
  decisions: DecisionRecord[];
  systems: SystemRecord[];
  sops: SopRecord[];
  onClose: () => void;
  onChange: (field: keyof ProjectRecord, value: string) => void;
  onSave: () => void;
  onAddLink: (field: ProjectLinkSectionKey, id: string) => void;
  onRemoveLink: (field: ProjectLinkSectionKey, id: string) => void;
  onOpenRecord: (objectType: "Action" | "Decision" | "System" | "SOP", id: string) => void;
}) {
  const hasInvalidProjectName = !project.projectName.trim();
  const hasInvalidDateOrder = Boolean(
    project.startDate && project.targetCompletionDate && project.targetCompletionDate < project.startDate,
  );
  const [hasSaved, setHasSaved] = useState(false);

  useEffect(() => {
    if (!hasSaved) {
      return;
    }

    const timeoutId = window.setTimeout(() => setHasSaved(false), 1500);
    return () => window.clearTimeout(timeoutId);
  }, [hasSaved]);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#171717]/20 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#cfc8c1] bg-[#f9f7f4] p-5 shadow-[0_18px_40px_rgba(23,23,23,0.08)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#d3cbc3] pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Project detail</p>
            <h3 className="mt-1 text-[20px] font-medium tracking-[-0.05em] text-[#171717]">{project.projectName || "New project"}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-[12px] uppercase tracking-[0.16em] text-[#4d4944]">Close</button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Project name</label>
            <input value={project.projectName} onChange={(event) => onChange("projectName", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
          {hasInvalidProjectName ? (
            <p role="alert" className="md:col-span-2 rounded-lg border border-[#d4b4a7] bg-[#f8efeb] px-3 py-2 text-[12px] font-medium text-[#6a3328]">Project name is required.</p>
          ) : null}
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Owner</label>
            <select value={project.owner} onChange={(event) => onChange("owner", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6">
              <option value="">Unassigned</option>
              {people.filter((person) => person.status === "Active").map((person) => <option key={person.id} value={person.name}>{person.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Pillar / area</label>
            <select value={project.area} onChange={(event) => onChange("area", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6">
              {sharedAreaOptions.map((area) => <option key={area} value={area}>{area}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Start date</label>
            <input type="date" value={project.startDate} onChange={(event) => onChange("startDate", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Target completion date</label>
            <input type="date" value={project.targetCompletionDate} onChange={(event) => onChange("targetCompletionDate", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
          {hasInvalidDateOrder ? (
            <p role="alert" className="md:col-span-2 rounded-lg border border-[#d4b4a7] bg-[#f8efeb] px-3 py-2 text-[12px] font-medium text-[#6a3328]">Target completion date must not be before the start date.</p>
          ) : null}
          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Status</label>
            <select value={project.status} onChange={(event) => onChange("status", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6">
              {!projectStatusOptions.includes(project.status as (typeof projectStatusOptions)[number]) && project.status ? <option value={project.status}>{project.status}</option> : null}
              {projectStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
        </div>

        <ProjectLinkSection
          title="Related Actions"
          objectType="Action"
          sectionKey="relatedActionIds"
          options={actions.map((action) => ({ id: action.id, title: action.actionTitle || action.title }))}
          linkedIds={project.relatedActionIds ?? []}
          onAddLink={onAddLink}
          onRemoveLink={onRemoveLink}
          onOpenRecord={onOpenRecord}
        />
        <ProjectLinkSection
          title="Related Decisions"
          objectType="Decision"
          sectionKey="relatedDecisionIds"
          options={decisions.map((decision) => ({ id: decision.id, title: decision.decisionTitle || decision.title }))}
          linkedIds={project.relatedDecisionIds ?? []}
          onAddLink={onAddLink}
          onRemoveLink={onRemoveLink}
          onOpenRecord={onOpenRecord}
        />
        <ProjectLinkSection
          title="Related Systems"
          objectType="System"
          sectionKey="relatedSystemIds"
          options={systems.map((system) => ({ id: system.id, title: system.systemName || system.title }))}
          linkedIds={project.relatedSystemIds ?? []}
          onAddLink={onAddLink}
          onRemoveLink={onRemoveLink}
          onOpenRecord={onOpenRecord}
        />
        <ProjectLinkSection
          title="Related SOPs"
          objectType="SOP"
          sectionKey="relatedSopIds"
          options={sops.map((sop) => ({ id: sop.id, title: sop.sopTitle || sop.title }))}
          linkedIds={project.relatedSopIds ?? []}
          onAddLink={onAddLink}
          onRemoveLink={onRemoveLink}
          onOpenRecord={onOpenRecord}
        />

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]">Cancel</button>
          <button type="button" onClick={() => { onSave(); setHasSaved(true); }} disabled={hasInvalidProjectName || hasInvalidDateOrder} className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45">{hasSaved ? "Saved" : "Save project"}</button>
        </div>
      </div>
    </div>
  );
}

function ProjectLinkSection({ title, objectType, sectionKey, options, linkedIds, onAddLink, onRemoveLink, onOpenRecord }: {
  title: string;
  objectType: "Action" | "Decision" | "System" | "SOP";
  sectionKey: ProjectLinkSectionKey;
  options: ProjectLinkOption[];
  linkedIds: string[];
  onAddLink: (field: ProjectLinkSectionKey, id: string) => void;
  onRemoveLink: (field: ProjectLinkSectionKey, id: string) => void;
  onOpenRecord: (objectType: "Action" | "Decision" | "System" | "SOP", id: string) => void;
}) {
  const [pendingId, setPendingId] = useState("");
  const linkedSet = new Set(linkedIds);
  const linkedOptions = options.filter((option) => linkedSet.has(option.id));
  const availableOptions = options.filter((option) => !linkedSet.has(option.id));

  return (
    <div className="mt-6 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">{title}</div>
      <div className="mt-3 space-y-2">
        {linkedOptions.length === 0 ? (
          <div className="text-[12px] text-[#4d4944]">No linked {objectType.toLowerCase()}s yet.</div>
        ) : (
          linkedOptions.map((option) => (
            <div key={option.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#d3cbc3] bg-white px-3 py-2">
              <button
                type="button"
                onClick={() => onOpenRecord(objectType, option.id)}
                className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-[#171717] hover:underline"
              >
                {option.title}
              </button>
              <button
                type="button"
                onClick={() => onRemoveLink(sectionKey, option.id)}
                aria-label={`Remove linked ${objectType}: ${option.title}`}
                className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-[#4d4944] hover:text-[#6a3328]"
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <select
          value={pendingId}
          onChange={(event) => setPendingId(event.target.value)}
          className="w-full rounded-lg border border-[#beb3aa] bg-white px-3 py-2 text-[12px] text-[#171717] outline-none transition focus:border-[#171717]"
        >
          <option value="">Select {objectType.toLowerCase()} to link</option>
          {availableOptions.map((option) => (
            <option key={option.id} value={option.id}>{option.title}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            if (!pendingId) {
              return;
            }
            onAddLink(sectionKey, pendingId);
            setPendingId("");
          }}
          disabled={!pendingId}
          className="shrink-0 rounded-lg border border-[#171717] bg-white px-3 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#171717] disabled:cursor-not-allowed disabled:opacity-45"
        >
          Link
        </button>
      </div>
    </div>
  );
}

function LeadDetailPanel({ lead, people, onClose, onChange, onSave, onArchiveToggle }: {
  lead: LeadRecord;
  people: PersonRecord[];
  onClose: () => void;
  onChange: (field: keyof LeadRecord, value: string) => void;
  onSave: () => void;
  onArchiveToggle: (lead: LeadRecord, archived: boolean) => void;
}) {
  const hasInvalidLeadName = !lead.leadName.trim();
  const [hasSaved, setHasSaved] = useState(false);

  useEffect(() => {
    if (!hasSaved) {
      return;
    }

    const timeoutId = window.setTimeout(() => setHasSaved(false), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [hasSaved]);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#171717]/20 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#cfc8c1] bg-[#f9f7f4] p-5 shadow-[0_18px_40px_rgba(23,23,23,0.08)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#d3cbc3] pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Lead detail</p>
            <h3 className="mt-1 text-[20px] font-medium tracking-[-0.05em] text-[#171717]">{lead.leadName || "New lead"}</h3>
            {lead.archived ? (
              <span className="mt-2 inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">Archived</span>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="text-[12px] uppercase tracking-[0.16em] text-[#4d4944]">Close</button>
        </div>

        {hasSaved ? (
          <div aria-live="polite" className="mt-4 rounded-xl border border-[#cfc8c1] bg-[#f2efe9] px-3 py-2 text-[12px] font-medium text-[#2f2b28]">
            Lead details saved.
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Lead name</label>
            <input value={lead.leadName} onChange={(event) => onChange("leadName", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
          {hasInvalidLeadName ? (
            <p role="alert" className="md:col-span-2 rounded-lg border border-[#d4b4a7] bg-[#f8efeb] px-3 py-2 text-[12px] font-medium text-[#6a3328]">Lead name is required.</p>
          ) : null}
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Contact name</label>
            <input value={lead.contactName} onChange={(event) => onChange("contactName", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Phone</label>
            <input value={lead.phone} onChange={(event) => onChange("phone", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Email</label>
            <input type="email" value={lead.email} onChange={(event) => onChange("email", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Location</label>
            <input value={lead.location} onChange={(event) => onChange("location", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Service requested</label>
            <input value={lead.serviceRequested} onChange={(event) => onChange("serviceRequested", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Source channel</label>
            <select value={lead.sourceChannel} onChange={(event) => onChange("sourceChannel", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6">
              {!leadSourceOptions.includes(lead.sourceChannel as LeadSource) && lead.sourceChannel ? <option value={lead.sourceChannel}>{lead.sourceChannel}</option> : null}
              {leadSourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Date received</label>
            <input type="date" value={lead.dateReceived} onChange={(event) => onChange("dateReceived", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Status</label>
            <select value={lead.status} onChange={(event) => onChange("status", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6">
              {!leadStatusOptions.includes(lead.status as LeadStatus) && lead.status ? <option value={lead.status}>{lead.status}</option> : null}
              {leadStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Quote value</label>
            <input value={lead.quoteValue} onChange={(event) => onChange("quoteValue", event.target.value)} placeholder="e.g. 450" className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Quote sent date</label>
            <input type="date" value={lead.quoteSentDate} onChange={(event) => onChange("quoteSentDate", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Follow-up date</label>
            <input type="date" value={lead.followUpDate} onChange={(event) => onChange("followUpDate", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Outcome</label>
            <select value={lead.outcome} onChange={(event) => onChange("outcome", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6">
              {leadOutcomeOptions.map((outcome) => <option key={outcome || "none"} value={outcome}>{outcome || "Not set"}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Final job value</label>
            <input value={lead.finalJobValue} onChange={(event) => onChange("finalJobValue", event.target.value)} placeholder="e.g. 450" className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Owner</label>
            <select value={lead.owner} onChange={(event) => onChange("owner", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6">
              <option value="">Unassigned</option>
              {people.filter((person) => person.status === "Active").map((person) => <option key={person.id} value={person.name}>{person.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Related pillar / area</label>
            <select value={lead.relatedPillar} onChange={(event) => onChange("relatedPillar", event.target.value)} className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6">
              {sharedAreaOptions.map((area) => <option key={area} value={area}>{area}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">Notes</label>
            <textarea rows={3} value={lead.notes} onChange={(event) => onChange("notes", event.target.value)} className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <div>
            {lead.id ? (
              <button
                type="button"
                onClick={() => onArchiveToggle(lead, !lead.archived)}
                className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28] hover:border-[#171717]"
              >
                {lead.archived ? "Restore lead" : "Archive lead"}
              </button>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]">Cancel</button>
            <button type="button" onClick={() => { onSave(); setHasSaved(true); }} disabled={hasInvalidLeadName} className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45">{hasSaved ? "Saved" : "Save lead"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function useFinanceSavedFeedback(): [boolean, () => void] {
  const [hasSaved, setHasSaved] = useState(false);

  useEffect(() => {
    if (!hasSaved) {
      return;
    }

    const timeoutId = window.setTimeout(() => setHasSaved(false), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [hasSaved]);

  return [hasSaved, () => setHasSaved(true)];
}

const financeFieldClass = "w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6";
const financeLabelClass = "mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]";

function CashPositionPanel({ value, onClose, onChange, onSave }: {
  value: CashPositionRecord;
  onClose: () => void;
  onChange: (field: keyof CashPositionRecord, value: string) => void;
  onSave: () => void;
}) {
  const [hasSaved, markSaved] = useFinanceSavedFeedback();

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#171717]/20 px-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[#cfc8c1] bg-[#f9f7f4] p-5 shadow-[0_18px_40px_rgba(23,23,23,0.08)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#d3cbc3] pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Finance</p>
            <h3 className="mt-1 text-[20px] font-medium tracking-[-0.05em] text-[#171717]">Cash position</h3>
          </div>
          <button type="button" onClick={onClose} className="text-[12px] uppercase tracking-[0.16em] text-[#4d4944]">Close</button>
        </div>

        {hasSaved ? (
          <div aria-live="polite" className="mt-4 rounded-xl border border-[#cfc8c1] bg-[#f2efe9] px-3 py-2 text-[12px] font-medium text-[#2f2b28]">Cash position saved.</div>
        ) : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className={financeLabelClass}>Current business cash</label>
            <input value={value.currentCash} onChange={(event) => onChange("currentCash", event.target.value)} placeholder="e.g. 12500" className={financeFieldClass} />
          </div>
          <div>
            <label className={financeLabelClass}>Reserved tax</label>
            <input value={value.reservedTax} onChange={(event) => onChange("reservedTax", event.target.value)} placeholder="e.g. 2500" className={financeFieldClass} />
          </div>
          <div>
            <label className={financeLabelClass}>Emergency / safety buffer</label>
            <input value={value.safetyBuffer} onChange={(event) => onChange("safetyBuffer", event.target.value)} placeholder="e.g. 3000" className={financeFieldClass} />
          </div>
          <div>
            <label className={financeLabelClass}>Last updated date</label>
            <input type="date" value={value.lastUpdated} onChange={(event) => onChange("lastUpdated", event.target.value)} className={financeFieldClass} />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]">Cancel</button>
          <button type="button" onClick={() => { onSave(); markSaved(); }} className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition active:scale-[0.98]">{hasSaved ? "Saved" : "Save cash position"}</button>
        </div>
      </div>
    </div>
  );
}

function IncomeDetailPanel({ income, onClose, onChange, onSave }: {
  income: IncomeRecord;
  onClose: () => void;
  onChange: (field: keyof IncomeRecord, value: string) => void;
  onSave: () => void;
}) {
  const hasInvalidDescription = !income.description.trim();
  const [hasSaved, markSaved] = useFinanceSavedFeedback();

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#171717]/20 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#cfc8c1] bg-[#f9f7f4] p-5 shadow-[0_18px_40px_rgba(23,23,23,0.08)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#d3cbc3] pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Income</p>
            <h3 className="mt-1 text-[20px] font-medium tracking-[-0.05em] text-[#171717]">{income.description || "New income record"}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-[12px] uppercase tracking-[0.16em] text-[#4d4944]">Close</button>
        </div>

        {hasSaved ? (
          <div aria-live="polite" className="mt-4 rounded-xl border border-[#cfc8c1] bg-[#f2efe9] px-3 py-2 text-[12px] font-medium text-[#2f2b28]">Income record saved.</div>
        ) : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={financeLabelClass}>Description</label>
            <input value={income.description} onChange={(event) => onChange("description", event.target.value)} className={financeFieldClass} />
          </div>
          {hasInvalidDescription ? (
            <p role="alert" className="md:col-span-2 rounded-lg border border-[#d4b4a7] bg-[#f8efeb] px-3 py-2 text-[12px] font-medium text-[#6a3328]">Description is required.</p>
          ) : null}
          <div>
            <label className={financeLabelClass}>Date</label>
            <input type="date" value={income.date} onChange={(event) => onChange("date", event.target.value)} className={financeFieldClass} />
          </div>
          <div>
            <label className={financeLabelClass}>Customer / source</label>
            <input value={income.customerSource} onChange={(event) => onChange("customerSource", event.target.value)} className={financeFieldClass} />
          </div>
          <div>
            <label className={financeLabelClass}>Amount</label>
            <input value={income.amount} onChange={(event) => onChange("amount", event.target.value)} placeholder="e.g. 850" className={financeFieldClass} />
          </div>
          <div>
            <label className={financeLabelClass}>Pillar / area</label>
            <select value={income.area} onChange={(event) => onChange("area", event.target.value)} className={financeFieldClass}>
              {sharedAreaOptions.map((area) => <option key={area} value={area}>{area}</option>)}
            </select>
          </div>
          <div>
            <label className={financeLabelClass}>Status</label>
            <select value={income.status} onChange={(event) => onChange("status", event.target.value)} className={financeFieldClass}>
              {incomeStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={financeLabelClass}>Notes</label>
            <textarea rows={3} value={income.notes} onChange={(event) => onChange("notes", event.target.value)} className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]">Cancel</button>
          <button type="button" onClick={() => { onSave(); markSaved(); }} disabled={hasInvalidDescription} className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45">{hasSaved ? "Saved" : "Save income"}</button>
        </div>
      </div>
    </div>
  );
}

function ExpenseDetailPanel({ expense, onClose, onChange, onSave }: {
  expense: ExpenseRecord;
  onClose: () => void;
  onChange: (field: keyof ExpenseRecord, value: string) => void;
  onSave: () => void;
}) {
  const hasInvalidDescription = !expense.description.trim();
  const [hasSaved, markSaved] = useFinanceSavedFeedback();

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#171717]/20 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#cfc8c1] bg-[#f9f7f4] p-5 shadow-[0_18px_40px_rgba(23,23,23,0.08)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#d3cbc3] pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Expense</p>
            <h3 className="mt-1 text-[20px] font-medium tracking-[-0.05em] text-[#171717]">{expense.description || "New expense record"}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-[12px] uppercase tracking-[0.16em] text-[#4d4944]">Close</button>
        </div>

        {hasSaved ? (
          <div aria-live="polite" className="mt-4 rounded-xl border border-[#cfc8c1] bg-[#f2efe9] px-3 py-2 text-[12px] font-medium text-[#2f2b28]">Expense record saved.</div>
        ) : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={financeLabelClass}>Description</label>
            <input value={expense.description} onChange={(event) => onChange("description", event.target.value)} className={financeFieldClass} />
          </div>
          {hasInvalidDescription ? (
            <p role="alert" className="md:col-span-2 rounded-lg border border-[#d4b4a7] bg-[#f8efeb] px-3 py-2 text-[12px] font-medium text-[#6a3328]">Description is required.</p>
          ) : null}
          <div>
            <label className={financeLabelClass}>Date</label>
            <input type="date" value={expense.date} onChange={(event) => onChange("date", event.target.value)} className={financeFieldClass} />
          </div>
          <div>
            <label className={financeLabelClass}>Supplier / payee</label>
            <input value={expense.supplier} onChange={(event) => onChange("supplier", event.target.value)} className={financeFieldClass} />
          </div>
          <div>
            <label className={financeLabelClass}>Amount</label>
            <input value={expense.amount} onChange={(event) => onChange("amount", event.target.value)} placeholder="e.g. 220" className={financeFieldClass} />
          </div>
          <div>
            <label className={financeLabelClass}>Category</label>
            <select value={expense.category} onChange={(event) => onChange("category", event.target.value)} className={financeFieldClass}>
              {!expenseCategoryOptions.includes(expense.category as (typeof expenseCategoryOptions)[number]) && expense.category ? <option value={expense.category}>{expense.category}</option> : null}
              {expenseCategoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
          <div>
            <label className={financeLabelClass}>Pillar / area</label>
            <select value={expense.area} onChange={(event) => onChange("area", event.target.value)} className={financeFieldClass}>
              {sharedAreaOptions.map((area) => <option key={area} value={area}>{area}</option>)}
            </select>
          </div>
          <div>
            <label className={financeLabelClass}>Status</label>
            <select value={expense.status} onChange={(event) => onChange("status", event.target.value)} className={financeFieldClass}>
              {expenseStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={financeLabelClass}>Notes</label>
            <textarea rows={3} value={expense.notes} onChange={(event) => onChange("notes", event.target.value)} className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]">Cancel</button>
          <button type="button" onClick={() => { onSave(); markSaved(); }} disabled={hasInvalidDescription} className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45">{hasSaved ? "Saved" : "Save expense"}</button>
        </div>
      </div>
    </div>
  );
}

function CommitmentDetailPanel({ commitment, onClose, onChange, onSave }: {
  commitment: CommitmentRecord;
  onClose: () => void;
  onChange: (field: keyof CommitmentRecord, value: string) => void;
  onSave: () => void;
}) {
  const hasInvalidName = !commitment.commitmentName.trim();
  const [hasSaved, markSaved] = useFinanceSavedFeedback();

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#171717]/20 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#cfc8c1] bg-[#f9f7f4] p-5 shadow-[0_18px_40px_rgba(23,23,23,0.08)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#d3cbc3] pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Financial commitment</p>
            <h3 className="mt-1 text-[20px] font-medium tracking-[-0.05em] text-[#171717]">{commitment.commitmentName || "New commitment"}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-[12px] uppercase tracking-[0.16em] text-[#4d4944]">Close</button>
        </div>

        {hasSaved ? (
          <div aria-live="polite" className="mt-4 rounded-xl border border-[#cfc8c1] bg-[#f2efe9] px-3 py-2 text-[12px] font-medium text-[#2f2b28]">Commitment saved.</div>
        ) : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={financeLabelClass}>Commitment name</label>
            <input value={commitment.commitmentName} onChange={(event) => onChange("commitmentName", event.target.value)} className={financeFieldClass} />
          </div>
          {hasInvalidName ? (
            <p role="alert" className="md:col-span-2 rounded-lg border border-[#d4b4a7] bg-[#f8efeb] px-3 py-2 text-[12px] font-medium text-[#6a3328]">Commitment name is required.</p>
          ) : null}
          <div>
            <label className={financeLabelClass}>Amount</label>
            <input value={commitment.amount} onChange={(event) => onChange("amount", event.target.value)} placeholder="e.g. 480" className={financeFieldClass} />
          </div>
          <div>
            <label className={financeLabelClass}>Due date</label>
            <input type="date" value={commitment.dueDate} onChange={(event) => onChange("dueDate", event.target.value)} className={financeFieldClass} />
          </div>
          <div>
            <label className={financeLabelClass}>Type</label>
            <select value={commitment.type} onChange={(event) => onChange("type", event.target.value)} className={financeFieldClass}>
              {!commitmentTypeOptions.includes(commitment.type as (typeof commitmentTypeOptions)[number]) && commitment.type ? <option value={commitment.type}>{commitment.type}</option> : null}
              {commitmentTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
          <div>
            <label className={financeLabelClass}>Status</label>
            <select value={commitment.status} onChange={(event) => onChange("status", event.target.value)} className={financeFieldClass}>
              {!commitmentStatusOptions.includes(commitment.status as (typeof commitmentStatusOptions)[number]) && commitment.status ? <option value={commitment.status}>{commitment.status}</option> : null}
              {commitmentStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={financeLabelClass}>Related pillar / area</label>
            <select value={commitment.relatedPillar} onChange={(event) => onChange("relatedPillar", event.target.value)} className={financeFieldClass}>
              {sharedAreaOptions.map((area) => <option key={area} value={area}>{area}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={financeLabelClass}>Notes</label>
            <textarea rows={3} value={commitment.notes} onChange={(event) => onChange("notes", event.target.value)} className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6" />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]">Cancel</button>
          <button type="button" onClick={() => { onSave(); markSaved(); }} disabled={hasInvalidName} className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45">{hasSaved ? "Saved" : "Save commitment"}</button>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">{label}</div>
      <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{value}</div>
    </div>
  );
}

type FocusListItem = {
  objectType: string;
  id: string;
  title: string;
  area: string;
  reason: string;
};

type TodayBriefStep = {
  label: string;
  count: number;
  hint: string;
};

type TrendItem = {
  label: string;
  text: string;
  direction: "up" | "down" | "flat";
};

type PostureChangeItem = {
  key: string;
  title: string;
  objectType: string;
  category: string;
};

type PostureChange = {
  hasBaseline: boolean;
  newSincePrevious: PostureChangeItem[];
  movedAgainst: Array<{ label: string; text: string }>;
  resolvedSincePrevious: PostureChangeItem[];
};

function TodayBrief({ posture, postureIsClear, steps, delegation, delegationIsClear, freshness, freshnessIsClear, growth, growthIsClear, progress, deskIsClear, trendItems, sevenDayShape, postureChange, onOpenRecord, onOpenStep }: {
  posture: string;
  postureIsClear: boolean;
  steps: TodayBriefStep[];
  delegation: string;
  delegationIsClear: boolean;
  freshness: string;
  freshnessIsClear: boolean;
  growth: string;
  growthIsClear: boolean;
  progress: string;
  deskIsClear: boolean;
  trendItems: TrendItem[];
  sevenDayShape: string;
  postureChange: PostureChange;
  onOpenRecord: (objectType: string, id: string) => void;
  onOpenStep: (stepLabel: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-[#171717] bg-[#f9f7f4] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">Today — founder brief</div>
        {deskIsClear ? (
          <span className="rounded-full border border-[#2f5d3a] bg-[#eef4ee] px-2.5 py-1 text-[9px] font-medium uppercase tracking-[0.14em] text-[#2f5d3a]">
            Desk is clear
          </span>
        ) : null}
      </div>

      <div className="mt-3 text-[12px] font-medium text-[#2f2b28]">
        {progress}
      </div>

      <div className={`mt-3 rounded-xl border px-3 py-2.5 text-[13px] leading-5 ${postureIsClear ? "border-[#d3cbc3] bg-white text-[#2f2b28]" : "border-[#c9b8a3] bg-[#f5efe6] text-[#2f2b28]"}`}>
        {posture}
      </div>

      <div className="mt-4 space-y-1.5">
        {steps.map((step, index) => {
          const clear = step.count === 0;
          return (
            <button
              key={step.label}
              type="button"
              onClick={() => onOpenStep(step.label)}
              className="flex w-full items-center gap-3 rounded-xl border border-[#d3cbc3] bg-white px-3 py-2.5 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
            >
              <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${clear ? "border border-[#d3cbc3] bg-[#f1eee9] text-[#4d4944]" : "bg-[#171717] text-[#f7f4f1]"}`}>
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-[#171717]">{step.label}</span>
                <span className="mt-0.5 block text-[11px] text-[#4d4944]">{clear ? "Clear" : step.hint}</span>
              </span>
              <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.14em] ${clear ? "border-[#d3cbc3] bg-[#f1eee9] text-[#4d4944]" : "border-[#cfc8c1] bg-[#f9f7f4] text-[#2f2b28]"}`}>
                {clear ? "Done" : step.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className={`mt-4 rounded-xl border px-3 py-2.5 text-[12px] leading-5 ${delegationIsClear ? "border-[#d3cbc3] bg-white text-[#2f2b28]" : "border-[#c9b8a3] bg-[#f5efe6] text-[#2f2b28]"}`}>
        <span className="font-medium text-[#171717]">Today&apos;s delegation:</span> {delegation}
      </div>

      <div className={`mt-3 rounded-xl border px-3 py-2.5 text-[12px] leading-5 ${freshnessIsClear ? "border-[#d3cbc3] bg-white text-[#2f2b28]" : "border-[#c9b8a3] bg-[#f5efe6] text-[#2f2b28]"}`}>
        <span className="font-medium text-[#171717]">Trust the picture:</span> {freshness}
      </div>

      <div className={`mt-3 rounded-xl border px-3 py-2.5 text-[12px] leading-5 ${growthIsClear ? "border-[#d3cbc3] bg-white text-[#2f2b28]" : "border-[#b8c4a3] bg-[#f1f4ea] text-[#2f2b28]"}`}>
        <span className="font-medium text-[#171717]">Growth:</span> {growth}
      </div>

      {trendItems.length > 0 || sevenDayShape ? (
        <div className="mt-3 rounded-xl border border-[#d3cbc3] bg-white px-3 py-2.5">
          {trendItems.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {trendItems.map((item) => {
                const improved = item.direction === "flat" ? null : item.label === "Operating cash" ? item.direction === "up" : item.direction === "down";
                const colorClass = improved === null ? "text-[#4d4944]" : improved ? "text-[#2f5d3a]" : "text-[#6a3328]";
                return (
                  <span key={item.label} className="text-[11px] leading-5 text-[#4d4944]">
                    <span className="font-medium text-[#171717]">{item.label}:</span>{" "}
                    <span className={colorClass}>
                      {item.text}
                    </span>
                  </span>
                );
              })}
            </div>
          ) : null}
          {sevenDayShape ? (
            <div className="mt-1.5 text-[11px] leading-5 text-[#4d4944]">
              <span className="font-medium text-[#171717]">Outstanding over recent days:</span> {sevenDayShape}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 rounded-xl border border-[#d3cbc3] bg-white px-3 py-2.5">
        {!postureChange.hasBaseline ? (
          <div className="text-[11px] leading-5 text-[#4d4944]">
            <span className="font-medium text-[#171717]">Change since last snapshot:</span> No previous day recorded yet — tomorrow&apos;s brief will show what is new, what moved against you, and what resolved.
          </div>
        ) : (
          <div className="space-y-2.5">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#4d4944]">New since previous snapshot</div>
              {postureChange.newSincePrevious.length === 0 ? (
                <div className="mt-1 text-[11px] text-[#4d4944]">Nothing new appeared.</div>
              ) : (
                <div className="mt-1 space-y-1">
                  {postureChange.newSincePrevious.map((item) => (
                    <button
                      key={`new-${item.key}`}
                      type="button"
                      onClick={() => onOpenRecord(item.objectType, item.key.slice(item.key.indexOf(":") + 1))}
                      className="block w-full rounded-lg border border-[#d3cbc3] bg-[#f9f7f4] px-2.5 py-1.5 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                    >
                      <div className="text-[12px] font-medium text-[#171717]">{item.title}</div>
                      <div className="text-[10px] uppercase tracking-[0.1em] text-[#4d4944]">{item.objectType} • {item.category}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#4d4944]">Moved against you</div>
              {postureChange.movedAgainst.length === 0 ? (
                <div className="mt-1 text-[11px] text-[#4d4944]">Nothing deteriorated.</div>
              ) : (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {postureChange.movedAgainst.map((item) => (
                    <span key={item.label} className="text-[11px] leading-5 text-[#6a3328]">
                      <span className="font-medium text-[#171717]">{item.label}:</span> {item.text}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#4d4944]">Resolved since previous snapshot</div>
              {postureChange.resolvedSincePrevious.length === 0 ? (
                <div className="mt-1 text-[11px] text-[#4d4944]">Nothing resolved since the previous snapshot.</div>
              ) : (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {postureChange.resolvedSincePrevious.map((item) => (
                    <span key={`resolved-${item.key}`} className="inline-flex items-center gap-1.5 text-[11px] leading-5 text-[#2f5d3a]">
                      <span>{item.title}</span>
                      {item.objectType !== "Record" ? (
                        <span className="rounded border border-[#b8c9ba] bg-[#eef4ee] px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.1em] text-[#2f5d3a]">
                          {item.objectType}
                        </span>
                      ) : null}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FounderFocusList({ items, onOpen }: { items: FocusListItem[]; onOpen: (objectType: string, id: string) => void }) {
  const rankLabels = ["Why this is first", "Why this is second", "Why this is third"];

  return (
    <div className="rounded-2xl border border-[#171717] bg-[#f9f7f4] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">Founder focus — top {items.length} for today</div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#d3cbc3] bg-white px-3 py-4 text-[13px] text-[#4d4944]">
          Nothing requires founder attention right now. The queues below stay visible for review.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <button
              key={`focus-${item.objectType}-${item.id}`}
              type="button"
              onClick={() => onOpen(item.objectType, item.id)}
              className="block w-full rounded-xl border border-[#d3cbc3] bg-white px-3 py-3 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#171717] text-[10px] font-semibold text-[#f7f4f1]">{index + 1}</span>
                <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">{item.objectType}</span>
                {item.area ? (
                  <span className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#4d4944]">{item.area}</span>
                ) : null}
                <span className="rounded-full border border-[#cfc8c1] bg-[#f1efe9] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">Open record</span>
              </div>
              <div className="mt-2 text-[16px] font-medium tracking-[-0.04em] text-[#171717]">{item.title}</div>
              <div className="mt-2 text-[12px] leading-5 text-[#524d49]">
                <span className="font-medium text-[#171717]">{rankLabels[index] || "Why this ranks here"}:</span> {item.reason}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PillarCard({ pillar, summary, onSelect }: { pillar: string; summary: { activeProjects: number; blockedProjects: number; openActions: number; openProblems: number; openOpportunities: number; leadsWaiting: number; wonLeadValue: number; priorityScore: number; }; onSelect: (pillar: string) => void; }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(pillar)}
      className="w-full rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Business pillar</div>
          <div className="mt-2 text-[24px] font-semibold tracking-[-0.05em] text-[#171717]">{pillar}</div>
        </div>
        <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]">
          Priority {summary.priorityScore}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <MetricCard label="Active projects" value={String(summary.activeProjects)} />
        <MetricCard label="Blocked projects" value={String(summary.blockedProjects)} />
        <MetricCard label="Open actions" value={String(summary.openActions)} />
        <MetricCard label="Open problems" value={String(summary.openProblems)} />
        <MetricCard label="Open opportunities" value={String(summary.openOpportunities)} />
        <MetricCard label="Leads awaiting follow-up" value={String(summary.leadsWaiting)} />
      </div>

      <div className="mt-4 rounded-xl border border-[#d3cbc3] bg-white px-3 py-2 text-[12px] text-[#2f2b28]">
        Won lead value: {summary.wonLeadValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
    </button>
  );
}

function RelatedRecordsPanel({ upstream, downstream }: RelatedRecordsPanelProps) {
  const renderItems = (items: RelatedRecordItem[]) => {
    if (items.length === 0) {
      return <div className="text-[12px] text-[#4d4944]">None recorded.</div>;
    }

    return (
      <div className="space-y-2">
        {items.map((item) => (
          <button
            key={`${item.label}-${item.id}`}
            type="button"
            onClick={item.onClick}
            disabled={!item.onClick}
            className={[
              "block w-full rounded-lg border px-2.5 py-2 text-left transition",
              item.onClick
                ? "border-[#d3cbc3] bg-white hover:border-[#171717]"
                : "border-[#d3cbc3] bg-[#f1eee9] cursor-default",
            ].join(" ")}
          >
            <div className="text-[12px] font-medium text-[#171717]">{item.title}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[#4d4944]">{item.label}</div>
            <div className="mt-1 text-[10px] text-[#6a625d]">{item.id}</div>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="mt-6 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Related records / lineage</div>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-2 text-[9px] uppercase tracking-[0.16em] text-[#4d4944]">Upstream lineage</div>
          {renderItems(upstream)}
        </div>
        <div>
          <div className="mb-2 text-[9px] uppercase tracking-[0.16em] text-[#4d4944]">Downstream lineage</div>
          {renderItems(downstream)}
        </div>
      </div>
    </div>
  );
}

type ConvertedDestinationViewProps = {
  title: string;
  description: string;
  records: CaptureConversionRecord[];
};

function ConvertedDestinationView({ title, description, records }: ConvertedDestinationViewProps) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">
            Operational destination
          </p>
          <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">
            {title}
          </h1>
        </div>
        <span className="rounded-full border border-[#cfc8c1] bg-[#f7f4f1] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#2f2b28]">
          {records.length} record{records.length === 1 ? "" : "s"}
        </span>
      </header>

      <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#43403b]">{description}</p>

      {records.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[14px] text-[#4d4944]">
          No {title} yet. Convert a Capture to {title.slice(0, -1)} to see it here.
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {records.map((record) => (
            <article
              key={record.id}
              className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
                    {record.title}
                  </h2>
                  <p className="mt-2 text-[14px] leading-6 text-[#424039]">
                    {record.originalRawNote.length > 220
                      ? `${record.originalRawNote.slice(0, 220)}…`
                      : record.originalRawNote}
                  </p>
                </div>
                <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">
                  {record.importance}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                  {record.relatedArea}
                </span>
                <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                  {record.status}
                </span>
                <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                  {formatCapturedAt(record.createdAt)}
                </span>
                <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1.5">
                  Source Capture: {record.sourceCaptureId}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

type ProblemDetailPanelProps = {
  problem: ProblemRecord;
  linkedActions: ActionRecord[];
  linkedLessons: LessonRecord[];
  upstream: RelatedRecordItem[];
  downstream: RelatedRecordItem[];
  onClose: () => void;
  onChange: (field: keyof Omit<ProblemRecord, "id" | "sourceCaptureId" | "targetType" | "createdAt" | "title" | "originalRawNote" | "relatedArea" | "importance" | "status">, value: string) => void;
  onSave: () => void;
  onCreateLinkedAction: () => void;
  onCreateLinkedLesson: () => void;
  onOpenLinkedAction: (action: ActionRecord) => void;
  onOpenLinkedLesson: (lesson: LessonRecord) => void;
};

function ProblemDetailPanel({ problem, linkedActions, linkedLessons, upstream, downstream, onClose, onChange, onSave, onCreateLinkedAction, onCreateLinkedLesson, onOpenLinkedAction, onOpenLinkedLesson }: ProblemDetailPanelProps) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#171717]/20 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#cfc8c1] bg-[#f9f7f4] p-5 shadow-[0_18px_40px_rgba(23,23,23,0.08)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#d3cbc3] pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Problem detail</p>
            <h3 className="mt-1 text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
              {problem.problemStatement}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] uppercase tracking-[0.16em] text-[#4d4944]"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Problem statement
            </label>
            <input
              value={problem.problemStatement}
              onChange={(event) => onChange("problemStatement", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Severity
            </label>
            <select
              value={problem.severity}
              onChange={(event) => onChange("severity", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              {problemSeverityOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Frequency
            </label>
            <select
              value={problem.frequency}
              onChange={(event) => onChange("frequency", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              {problemFrequencyOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Root cause status
            </label>
            <select
              value={problem.rootCauseStatus}
              onChange={(event) => onChange("rootCauseStatus", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              {problemRootCauseStatusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Status
            </label>
            <select
              value={problem.problemStatus}
              onChange={(event) => onChange("problemStatus", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              {problemStatusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Impact
            </label>
            <textarea
              rows={3}
              value={problem.impact}
              onChange={(event) => onChange("impact", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Root cause
            </label>
            <textarea
              rows={3}
              value={problem.rootCause}
              onChange={(event) => onChange("rootCause", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Owner
            </label>
            <input
              value={problem.owner}
              onChange={(event) => onChange("owner", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Related area
            </label>
            <input
              value={problem.relatedArea}
              readOnly
              className="w-full rounded-xl border border-[#d3cbc3] bg-[#f1eee9] px-3.5 py-3 text-[14px] text-[#171717] outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Resolution
            </label>
            <textarea
              rows={3}
              value={problem.resolution}
              onChange={(event) => onChange("resolution", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Source traceability</div>
            <div className="mt-2 space-y-2 text-[12px] text-[#2f2b28]">
              <div><span className="font-medium">Original Capture title:</span> {problem.title}</div>
              <div><span className="font-medium">Original raw note:</span> {problem.originalRawNote}</div>
              <div><span className="font-medium">Source Capture ID:</span> {problem.sourceCaptureId}</div>
              <div><span className="font-medium">Conversion date:</span> {formatCapturedAt(problem.createdAt)}</div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCreateLinkedAction}
            className="rounded-lg border border-[#171717] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#171717]"
          >
            Create linked Action
          </button>
          {(problem.problemStatus === "Resolved" || problem.problemStatus === "Closed") ? (
            <button
              type="button"
              onClick={onCreateLinkedLesson}
              className="rounded-lg border border-[#171717] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#171717]"
            >
              Create lesson from problem
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1]"
          >
            Save problem
          </button>
        </div>

        <div className="mt-6 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Linked Lessons</div>
          <div className="mt-3 space-y-2">
            {linkedLessons.length === 0 ? (
              <div className="text-[12px] text-[#4d4944]">No linked lessons yet.</div>
            ) : (
              linkedLessons.map((lesson) => (
                <button
                  key={lesson.id}
                  type="button"
                  onClick={() => onOpenLinkedLesson(lesson)}
                  className="block w-full rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-left text-[12px] text-[#171717] hover:border-[#171717]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{lesson.lessonTitle}</span>
                    <span className="text-[9px] uppercase tracking-[0.14em] text-[#4d4944]">{lesson.status}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <RelatedRecordsPanel upstream={upstream} downstream={downstream} />
      </div>
    </div>
  );
}

type ActionDetailPanelProps = {
  action: ActionRecord;
  people: PersonRecord[];
  problems: ProblemRecord[];
  decisions: DecisionRecord[];
  upstream: RelatedRecordItem[];
  downstream: RelatedRecordItem[];
  onClose: () => void;
  onChange: (field: keyof ActionRecord, value: string) => void;
  onOwnerChange: (personId: string) => void;
  onSave: () => void;
  onOpenRelatedProblem?: () => void;
  onOpenRelatedDecision?: () => void;
};

function ActionDetailPanel({ action, people, problems, decisions, upstream, downstream, onClose, onChange, onOwnerChange, onSave, onOpenRelatedProblem, onOpenRelatedDecision }: ActionDetailPanelProps) {
  const isCompleted = action.status === "Completed";
  const activePeople = people.filter((person) => person.status === "Active");
  const savedOwner = action.owner?.trim() ?? "";
  const savedOwnerMatchesActivePerson = activePeople.some(
    (person) => person.name.trim().toLowerCase() === savedOwner.toLowerCase(),
  );
  const calumAvailableFromActivePerson = activePeople.some(
    (person) => person.name.trim().toLowerCase() === "calum",
  );
  const calumIsSavedOwner = savedOwner.toLowerCase() === "calum";
  const ownerOptions = [
    { id: "unassigned", name: "Unassigned" },
    ...activePeople,
    ...(!calumAvailableFromActivePerson && !calumIsSavedOwner
      ? [{ id: "named-owner:Calum", name: "Calum" }]
      : []),
    ...(savedOwner && !savedOwnerMatchesActivePerson && savedOwner.toLowerCase() !== "unassigned"
      ? [{ id: `legacy-owner:${savedOwner}`, name: savedOwner }]
      : []),
  ];
  const selectedOwnerValue =
    getActionOwnerValue(action, people) === "unassigned" && savedOwner && !savedOwnerMatchesActivePerson && savedOwner.toLowerCase() !== "unassigned"
      ? `legacy-owner:${savedOwner}`
      : getActionOwnerValue(action, people);
  const ownerDisplay = getActionOwnerDisplay(action, people);
  const selectedProblemValue = problems.some((problem) => problem.id === action.relatedProblem) ? action.relatedProblem : "";
  const selectedDecisionValue = decisions.some((decision) => decision.id === action.relatedDecision) ? action.relatedDecision : "";

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#171717]/20 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#cfc8c1] bg-[#f9f7f4] p-5 shadow-[0_18px_40px_rgba(23,23,23,0.08)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#d3cbc3] pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Action detail</p>
            <h3 className="mt-1 text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
              {action.actionTitle}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] uppercase tracking-[0.16em] text-[#4d4944]"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Action title
            </label>
            <input
              value={action.actionTitle}
              onChange={(event) => onChange("actionTitle", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Description
            </label>
            <textarea
              rows={4}
              value={action.description}
              onChange={(event) => onChange("description", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Owner
            </label>
            <select
              value={selectedOwnerValue}
              onChange={(event) => onOwnerChange(event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              {ownerOptions.map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </select>
            <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[#4d4944]">
              {action.ownerPersonId ? `Owner: ${ownerDisplay}` : `Owner: ${ownerDisplay}`}
              {action.ownerPersonId ? <span className="mt-1 block text-[9px] normal-case tracking-normal text-[#6a625d]">Person ID: {action.ownerPersonId}</span> : null}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Created by
            </label>
            <input
              value={action.createdBy}
              onChange={(event) => onChange("createdBy", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Created date
            </label>
            <input
              type="date"
              value={action.createdDate ? action.createdDate.slice(0, 10) : ""}
              onChange={(event) => onChange("createdDate", event.target.value ? new Date(event.target.value).toISOString() : "")}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Due date
            </label>
            <input
              type="date"
              value={action.dueDate ? action.dueDate.slice(0, 10) : ""}
              onChange={(event) => onChange("dueDate", event.target.value ? new Date(event.target.value).toISOString() : "")}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Priority
            </label>
            <select
              value={action.priority}
              onChange={(event) => onChange("priority", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              {actionPriorityOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Status
            </label>
            <select
              value={action.status}
              onChange={(event) => onChange("status", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              {actionStatusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Related problem
            </label>
            <select
              value={selectedProblemValue}
              onChange={(event) => onChange("relatedProblem", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              <option value="">Not linked</option>
              {problems.map((problem) => (
                <option key={problem.id} value={problem.id}>{problem.problemStatement || problem.title}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Related decision
            </label>
            <select
              value={selectedDecisionValue}
              onChange={(event) => onChange("relatedDecision", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              <option value="">Not linked</option>
              {decisions.map((decision) => (
                <option key={decision.id} value={decision.id}>{decision.decisionTitle || decision.title}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Related capture
            </label>
            <input
              value={action.relatedCapture}
              readOnly
              className="w-full rounded-xl border border-[#d3cbc3] bg-[#f1eee9] px-3.5 py-3 text-[14px] text-[#171717] outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Related pillar
            </label>
            <input
              value={action.relatedPillar}
              onChange={(event) => onChange("relatedPillar", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          {isCompleted ? (
            <>
              <div className="md:col-span-2">
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                  Completion evidence
                </label>
                <textarea
                  rows={4}
                  value={action.completionEvidence}
                  onChange={(event) => onChange("completionEvidence", event.target.value)}
                  className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                  Completion date
                </label>
                <input
                  type="date"
                  value={action.completionDate ? action.completionDate.slice(0, 10) : ""}
                  onChange={(event) => onChange("completionDate", event.target.value ? new Date(event.target.value).toISOString() : "")}
                  className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                />
              </div>
            </>
          ) : null}

          <div className="md:col-span-2 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Linkage</div>
            <div className="mt-2 space-y-2 text-[12px] text-[#2f2b28]">
              <div><span className="font-medium">Related Problem ID:</span> {action.relatedProblem || "Not linked"}</div>
              <div><span className="font-medium">Related Decision ID:</span> {action.relatedDecision || "Not linked"}</div>
              <div><span className="font-medium">Source Capture relationship:</span> {action.relatedCapture || "Not linked"}</div>
              <div><span className="font-medium">Original Capture title:</span> {action.title}</div>
              <div><span className="font-medium">Original raw note:</span> {action.originalRawNote}</div>
              <div><span className="font-medium">Source Capture ID:</span> {action.sourceCaptureId}</div>
              <div><span className="font-medium">Conversion date:</span> {formatCapturedAt(action.createdAt)}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {action.relatedProblem && onOpenRelatedProblem ? (
                <button
                  type="button"
                  onClick={onOpenRelatedProblem}
                  className="rounded-lg border border-[#171717] bg-white px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#171717]"
                >
                  Open related Problem
                </button>
              ) : null}
              {action.relatedDecision && onOpenRelatedDecision ? (
                <button
                  type="button"
                  onClick={onOpenRelatedDecision}
                  className="rounded-lg border border-[#171717] bg-white px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#171717]"
                >
                  Open related Decision
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1]"
          >
            Save action
          </button>
        </div>

        <RelatedRecordsPanel upstream={upstream} downstream={downstream} />
      </div>
    </div>
  );
}

type OpportunityDetailPanelProps = {
  opportunity: OpportunityRecord;
  linkedDecisions: DecisionRecord[];
  upstream: RelatedRecordItem[];
  downstream: RelatedRecordItem[];
  onClose: () => void;
  onChange: (field: keyof OpportunityRecord, value: string) => void;
  onSave: () => void;
  onCreateLinkedDecision: () => void;
  onOpenLinkedDecision: (decision: DecisionRecord) => void;
};

function OpportunityDetailPanel({ opportunity, linkedDecisions, upstream, downstream, onClose, onChange, onSave, onCreateLinkedDecision, onOpenLinkedDecision }: OpportunityDetailPanelProps) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#171717]/20 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#cfc8c1] bg-[#f9f7f4] p-5 shadow-[0_18px_40px_rgba(23,23,23,0.08)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#d3cbc3] pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Opportunity detail</p>
            <h3 className="mt-1 text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
              {opportunity.opportunityTitle}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] uppercase tracking-[0.16em] text-[#4d4944]"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Opportunity title
            </label>
            <input
              value={opportunity.opportunityTitle}
              onChange={(event) => onChange("opportunityTitle", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Description
            </label>
            <textarea
              rows={4}
              value={opportunity.description}
              onChange={(event) => onChange("description", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Source
            </label>
            <input
              value={opportunity.source}
              onChange={(event) => onChange("source", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Date identified
            </label>
            <input
              type="date"
              value={opportunity.dateIdentified ? opportunity.dateIdentified.slice(0, 10) : ""}
              onChange={(event) => onChange("dateIdentified", event.target.value ? new Date(event.target.value).toISOString() : "")}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Related pillar / area
            </label>
            <select
              value={opportunityAreaOptions.includes(opportunity.relatedPillar as (typeof opportunityAreaOptions)[number]) ? opportunity.relatedPillar : ""}
              onChange={(event) => onChange("relatedPillar", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              <option value="">Select area</option>
              {opportunityAreaOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
              {!opportunityAreaOptions.includes(opportunity.relatedPillar as (typeof opportunityAreaOptions)[number]) && opportunity.relatedPillar ? (
                <option value={opportunity.relatedPillar}>{opportunity.relatedPillar}</option>
              ) : null}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Strategic fit
            </label>
            <select
              value={opportunity.strategicFit}
              onChange={(event) => onChange("strategicFit", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              {opportunityStrategicFitOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Estimated upside
            </label>
            <input
              value={opportunity.estimatedUpside}
              onChange={(event) => onChange("estimatedUpside", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Required capital
            </label>
            <input
              value={opportunity.requiredCapital}
              onChange={(event) => onChange("requiredCapital", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Required time
            </label>
            <input
              value={opportunity.requiredTime}
              onChange={(event) => onChange("requiredTime", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Required capability
            </label>
            <input
              value={opportunity.requiredCapability}
              onChange={(event) => onChange("requiredCapability", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Owner
            </label>
            <input
              value={opportunity.owner}
              onChange={(event) => onChange("owner", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Status
            </label>
            <select
              value={opportunity.status}
              onChange={(event) => onChange("status", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              {opportunityStatusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Risks
            </label>
            <textarea
              rows={3}
              value={opportunity.risks}
              onChange={(event) => onChange("risks", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Opportunity cost
            </label>
            <textarea
              rows={3}
              value={opportunity.opportunityCost}
              onChange={(event) => onChange("opportunityCost", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Evidence
            </label>
            <textarea
              rows={3}
              value={opportunity.evidence}
              onChange={(event) => onChange("evidence", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Decision
            </label>
            <input
              value={opportunity.decision}
              onChange={(event) => onChange("decision", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Outcome
            </label>
            <input
              value={opportunity.outcome}
              onChange={(event) => onChange("outcome", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Source traceability</div>
            <div className="mt-2 space-y-2 text-[12px] text-[#2f2b28]">
              <div><span className="font-medium">Original Capture title:</span> {opportunity.title}</div>
              <div><span className="font-medium">Original raw note:</span> {opportunity.originalRawNote}</div>
              <div><span className="font-medium">Source Capture ID:</span> {opportunity.sourceCaptureId}</div>
              <div><span className="font-medium">Conversion date:</span> {formatCapturedAt(opportunity.createdAt)}</div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCreateLinkedDecision}
            className="rounded-lg border border-[#171717] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#171717]"
          >
            Create linked Decision
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1]"
          >
            Save opportunity
          </button>
        </div>

        <div className="mt-6 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Linked Decisions</div>
          <div className="mt-3 space-y-2">
            {linkedDecisions.length === 0 ? (
              <div className="text-[12px] text-[#4d4944]">No linked decisions yet.</div>
            ) : (
              linkedDecisions.map((decision) => (
                <button
                  key={decision.id}
                  type="button"
                  onClick={() => onOpenLinkedDecision(decision)}
                  className="block w-full rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-left text-[12px] text-[#171717] hover:border-[#171717]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{decision.decisionTitle}</span>
                    <span className="text-[9px] uppercase tracking-[0.14em] text-[#4d4944]">{decision.decisionStatus}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <RelatedRecordsPanel upstream={upstream} downstream={downstream} />
      </div>
    </div>
  );
}

type LessonDetailPanelProps = {
  lesson: LessonRecord;
  linkedSystems: SystemRecord[];
  upstream: RelatedRecordItem[];
  downstream: RelatedRecordItem[];
  onClose: () => void;
  onChange: (field: keyof LessonRecord, value: string) => void;
  onSave: () => void;
  onCreateLinkedSystem: () => void;
  onOpenLinkedSystem: (system: SystemRecord) => void;
};

function LessonDetailPanel({ lesson, linkedSystems, upstream, downstream, onClose, onChange, onSave, onCreateLinkedSystem, onOpenLinkedSystem }: LessonDetailPanelProps) {
  const existingLinkedSystem = linkedSystems[0];
  const hasLinkedSystem = linkedSystems.length > 0;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#171717]/20 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#cfc8c1] bg-[#f9f7f4] p-5 shadow-[0_18px_40px_rgba(23,23,23,0.08)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#d3cbc3] pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Lesson detail</p>
            <h3 className="mt-1 text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
              {lesson.lessonTitle}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] uppercase tracking-[0.16em] text-[#4d4944]"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Lesson title
            </label>
            <input
              value={lesson.lessonTitle}
              onChange={(event) => onChange("lessonTitle", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Description
            </label>
            <textarea
              rows={4}
              value={lesson.description}
              onChange={(event) => onChange("description", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Source event
            </label>
            <input
              value={lesson.sourceEvent}
              onChange={(event) => onChange("sourceEvent", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Date learned
            </label>
            <input
              type="date"
              value={lesson.dateLearned ? lesson.dateLearned.slice(0, 10) : ""}
              onChange={(event) => onChange("dateLearned", event.target.value ? new Date(event.target.value).toISOString() : "")}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Pillar / area
            </label>
            <input
              value={lesson.relatedPillar}
              onChange={(event) => onChange("relatedPillar", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Status
            </label>
            <select
              value={lesson.status}
              onChange={(event) => onChange("status", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              {lessonStatusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Owner
            </label>
            <input
              value={lesson.owner}
              onChange={(event) => onChange("owner", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Why it matters
            </label>
            <textarea
              rows={3}
              value={lesson.whyItMatters}
              onChange={(event) => onChange("whyItMatters", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Recommended change
            </label>
            <textarea
              rows={3}
              value={lesson.recommendedChange}
              onChange={(event) => onChange("recommendedChange", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Related problem
            </label>
            <input
              value={lesson.relatedProblem}
              onChange={(event) => onChange("relatedProblem", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Related project
            </label>
            <input
              value={lesson.relatedProject}
              onChange={(event) => onChange("relatedProject", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Related decision
            </label>
            <input
              value={lesson.relatedDecision}
              onChange={(event) => onChange("relatedDecision", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Related system
            </label>
            <input
              value={lesson.relatedSystem}
              onChange={(event) => onChange("relatedSystem", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Source traceability</div>
            <div className="mt-2 space-y-2 text-[12px] text-[#2f2b28]">
              <div><span className="font-medium">Original Capture title:</span> {lesson.title}</div>
              <div><span className="font-medium">Original raw note:</span> {lesson.originalRawNote}</div>
              <div><span className="font-medium">Source Capture ID:</span> {lesson.sourceCaptureId}</div>
              <div><span className="font-medium">Conversion date:</span> {formatCapturedAt(lesson.createdAt)}</div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]"
          >
            Cancel
          </button>
          {hasLinkedSystem && existingLinkedSystem ? (
            <button
              type="button"
              onClick={() => onOpenLinkedSystem(existingLinkedSystem)}
              className="rounded-lg border border-[#171717] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#171717]"
            >
              View linked System
            </button>
          ) : (
            <button
              type="button"
              onClick={onCreateLinkedSystem}
              className="rounded-lg border border-[#171717] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#171717]"
            >
              Create linked System
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1]"
          >
            Save lesson
          </button>
        </div>

        <div className="mt-6 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Linked Systems</div>
          <div className="mt-3 space-y-2">
            {linkedSystems.length === 0 ? (
              <div className="text-[12px] text-[#4d4944]">No linked systems yet.</div>
            ) : (
              linkedSystems.map((system) => (
                <button
                  key={system.id}
                  type="button"
                  onClick={() => onOpenLinkedSystem(system)}
                  className="block w-full rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-left text-[12px] text-[#171717] hover:border-[#171717]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{system.systemName}</span>
                    <span className="text-[9px] uppercase tracking-[0.14em] text-[#4d4944]">{system.status}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <RelatedRecordsPanel upstream={upstream} downstream={downstream} />
      </div>
    </div>
  );
}

type SystemDetailPanelProps = {
  system: SystemRecord;
  linkedSops: SopRecord[];
  upstream: RelatedRecordItem[];
  downstream: RelatedRecordItem[];
  onClose: () => void;
  onChange: (field: keyof SystemRecord, value: string) => void;
  onSave: () => void;
  onCreateLinkedSop: () => void;
  onOpenLinkedSop: (sop: SopRecord) => void;
  onOpenRelatedLesson?: () => void;
};

function SystemDetailPanel({ system, linkedSops, upstream, downstream, onClose, onChange, onSave, onCreateLinkedSop, onOpenLinkedSop, onOpenRelatedLesson }: SystemDetailPanelProps) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#171717]/20 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#cfc8c1] bg-[#f9f7f4] p-5 shadow-[0_18px_40px_rgba(23,23,23,0.08)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#d3cbc3] pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">System detail</p>
            <h3 className="mt-1 text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
              {system.systemName}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] uppercase tracking-[0.16em] text-[#4d4944]"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              System name
            </label>
            <input
              value={system.systemName}
              onChange={(event) => onChange("systemName", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Purpose
            </label>
            <textarea
              rows={3}
              value={system.purpose}
              onChange={(event) => onChange("purpose", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Owner
            </label>
            <input
              value={system.owner}
              onChange={(event) => onChange("owner", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Area
            </label>
            <input
              value={system.area}
              onChange={(event) => onChange("area", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Inputs
            </label>
            <textarea
              rows={2}
              value={system.inputs}
              onChange={(event) => onChange("inputs", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Process
            </label>
            <textarea
              rows={3}
              value={system.process}
              onChange={(event) => onChange("process", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Outputs
            </label>
            <textarea
              rows={2}
              value={system.outputs}
              onChange={(event) => onChange("outputs", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Standards
            </label>
            <textarea
              rows={2}
              value={system.standards}
              onChange={(event) => onChange("standards", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Failure points
            </label>
            <textarea
              rows={2}
              value={system.failurePoints}
              onChange={(event) => onChange("failurePoints", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Version
            </label>
            <input
              value={system.version}
              onChange={(event) => onChange("version", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Status
            </label>
            <select
              value={system.status}
              onChange={(event) => onChange("status", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              {systemStatusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Last reviewed
            </label>
            <input
              type="date"
              value={system.lastReviewed ? system.lastReviewed.slice(0, 10) : ""}
              onChange={(event) => onChange("lastReviewed", event.target.value ? new Date(event.target.value).toISOString() : "")}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Source traceability</div>
            <div className="mt-2 space-y-2 text-[12px] text-[#2f2b28]">
              <div><span className="font-medium">Related Lesson ID:</span> {system.relatedLesson || "Not linked"}</div>
              <div><span className="font-medium">Source Capture relationship:</span> {system.relatedCapture || "Not linked"}</div>
              <div><span className="font-medium">Original Capture title:</span> {system.title}</div>
              <div><span className="font-medium">Original raw note:</span> {system.originalRawNote}</div>
              <div><span className="font-medium">Source Capture ID:</span> {system.sourceCaptureId}</div>
              <div><span className="font-medium">Conversion date:</span> {formatCapturedAt(system.createdAt)}</div>
            </div>
            {system.relatedLesson && onOpenRelatedLesson ? (
              <button
                type="button"
                onClick={onOpenRelatedLesson}
                className="mt-3 rounded-lg border border-[#171717] bg-white px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#171717]"
              >
                Open related Lesson
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCreateLinkedSop}
            className="rounded-lg border border-[#171717] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#171717]"
          >
            Create linked SOP
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1]"
          >
            Save system
          </button>
        </div>

        <div className="mt-6 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Linked SOPs</div>
          <div className="mt-3 space-y-2">
            {linkedSops.length === 0 ? (
              <div className="text-[12px] text-[#4d4944]">No linked SOPs yet.</div>
            ) : (
              linkedSops.map((sop) => (
                <button
                  key={sop.id}
                  type="button"
                  onClick={() => onOpenLinkedSop(sop)}
                  className="block w-full rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-left text-[12px] text-[#171717] hover:border-[#171717]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{sop.sopTitle}</span>
                    <span className="text-[9px] uppercase tracking-[0.14em] text-[#4d4944]">{sop.status}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <RelatedRecordsPanel upstream={upstream} downstream={downstream} />
      </div>
    </div>
  );
}

type SopDetailPanelProps = {
  sop: SopRecord;
  upstream: RelatedRecordItem[];
  downstream: RelatedRecordItem[];
  onClose: () => void;
  onChange: (field: keyof SopRecord, value: string) => void;
  onSave: () => void;
  onOpenRelatedSystem?: () => void;
};

function SopDetailPanel({ sop, upstream, downstream, onClose, onChange, onSave, onOpenRelatedSystem }: SopDetailPanelProps) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#171717]/20 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#cfc8c1] bg-[#f9f7f4] p-5 shadow-[0_18px_40px_rgba(23,23,23,0.08)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#d3cbc3] pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">SOP detail</p>
            <h3 className="mt-1 text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
              {sop.sopTitle}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] uppercase tracking-[0.16em] text-[#4d4944]"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              SOP title
            </label>
            <input
              value={sop.sopTitle}
              onChange={(event) => onChange("sopTitle", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Purpose
            </label>
            <textarea
              rows={3}
              value={sop.purpose}
              onChange={(event) => onChange("purpose", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Owner
            </label>
            <input
              value={sop.owner}
              onChange={(event) => onChange("owner", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Applicable roles
            </label>
            <input
              value={sop.applicableRoles}
              onChange={(event) => onChange("applicableRoles", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Procedure
            </label>
            <textarea
              rows={5}
              value={sop.procedure}
              onChange={(event) => onChange("procedure", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Required tools
            </label>
            <textarea
              rows={2}
              value={sop.requiredTools}
              onChange={(event) => onChange("requiredTools", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Safety considerations
            </label>
            <textarea
              rows={3}
              value={sop.safetyConsiderations}
              onChange={(event) => onChange("safetyConsiderations", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Quality standard
            </label>
            <textarea
              rows={2}
              value={sop.qualityStandard}
              onChange={(event) => onChange("qualityStandard", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Evidence of completion
            </label>
            <textarea
              rows={2}
              value={sop.completionEvidence}
              onChange={(event) => onChange("completionEvidence", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Version
            </label>
            <input
              value={sop.version}
              onChange={(event) => onChange("version", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Status
            </label>
            <select
              value={sop.status}
              onChange={(event) => onChange("status", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              {sopStatusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Effective date
            </label>
            <input
              type="date"
              value={sop.effectiveDate ? sop.effectiveDate.slice(0, 10) : ""}
              onChange={(event) => onChange("effectiveDate", event.target.value ? new Date(event.target.value).toISOString() : "")}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Review date
            </label>
            <input
              type="date"
              value={sop.reviewDate ? sop.reviewDate.slice(0, 10) : ""}
              onChange={(event) => onChange("reviewDate", event.target.value ? new Date(event.target.value).toISOString() : "")}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Source traceability</div>
            <div className="mt-2 space-y-2 text-[12px] text-[#2f2b28]">
              <div><span className="font-medium">Related System ID:</span> {sop.relatedSystem || "Not linked"}</div>
              <div><span className="font-medium">Related Lesson ID:</span> {sop.relatedLesson || "Not linked"}</div>
              <div><span className="font-medium">Source Capture relationship:</span> {sop.relatedCapture || "Not linked"}</div>
              <div><span className="font-medium">Original Capture title:</span> {sop.title}</div>
              <div><span className="font-medium">Original raw note:</span> {sop.originalRawNote}</div>
              <div><span className="font-medium">Source Capture ID:</span> {sop.sourceCaptureId}</div>
              <div><span className="font-medium">Conversion date:</span> {formatCapturedAt(sop.createdAt)}</div>
            </div>
            {sop.relatedSystem && onOpenRelatedSystem ? (
              <button
                type="button"
                onClick={onOpenRelatedSystem}
                className="mt-3 rounded-lg border border-[#171717] bg-white px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#171717]"
              >
                Open related System
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1]"
          >
            Save SOP
          </button>
        </div>

        <RelatedRecordsPanel upstream={upstream} downstream={downstream} />
      </div>
    </div>
  );
}

type DecisionDetailPanelProps = {
  decision: DecisionRecord;
  linkedActions: ActionRecord[];
  linkedLessons: LessonRecord[];
  upstream: RelatedRecordItem[];
  downstream: RelatedRecordItem[];
  onClose: () => void;
  onChange: (field: keyof DecisionRecord, value: string) => void;
  onSave: () => void;
  onCreateLinkedAction: () => void;
  onCreateLinkedLesson: () => void;
  onOpenLinkedAction: (action: ActionRecord) => void;
  onOpenLinkedLesson: (lesson: LessonRecord) => void;
  onOpenRelatedOpportunity?: () => void;
};

function DecisionDetailPanel({ decision, linkedActions, linkedLessons, upstream, downstream, onClose, onChange, onSave, onCreateLinkedAction, onCreateLinkedLesson, onOpenLinkedAction, onOpenLinkedLesson, onOpenRelatedOpportunity }: DecisionDetailPanelProps) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#171717]/20 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#cfc8c1] bg-[#f9f7f4] p-5 shadow-[0_18px_40px_rgba(23,23,23,0.08)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#d3cbc3] pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Decision detail</p>
            <h3 className="mt-1 text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
              {decision.decisionTitle}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] uppercase tracking-[0.16em] text-[#4d4944]"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Decision title
            </label>
            <input
              value={decision.decisionTitle}
              onChange={(event) => onChange("decisionTitle", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Decision statement
            </label>
            <textarea
              rows={3}
              value={decision.decisionStatement}
              onChange={(event) => onChange("decisionStatement", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Decision maker
            </label>
            <input
              value={decision.decisionMaker}
              onChange={(event) => onChange("decisionMaker", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Decision date
            </label>
            <input
              type="date"
              value={decision.decisionDate ? decision.decisionDate.slice(0, 10) : ""}
              onChange={(event) => onChange("decisionDate", event.target.value ? new Date(event.target.value).toISOString() : "")}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Context
            </label>
            <textarea
              rows={3}
              value={decision.context}
              onChange={(event) => onChange("context", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Reasoning
            </label>
            <textarea
              rows={4}
              value={decision.reasoning}
              onChange={(event) => onChange("reasoning", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Evidence considered
            </label>
            <textarea
              rows={3}
              value={decision.evidenceConsidered}
              onChange={(event) => onChange("evidenceConsidered", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Alternatives considered
            </label>
            <textarea
              rows={3}
              value={decision.alternativesConsidered}
              onChange={(event) => onChange("alternativesConsidered", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Assumptions
            </label>
            <textarea
              rows={3}
              value={decision.assumptions}
              onChange={(event) => onChange("assumptions", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Risk level
            </label>
            <select
              value={decision.riskLevel}
              onChange={(event) => onChange("riskLevel", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              {decisionRiskOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Status
            </label>
            <select
              value={decision.decisionStatus}
              onChange={(event) => onChange("decisionStatus", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            >
              {decisionStatusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Review date
            </label>
            <input
              type="date"
              value={decision.reviewDate ? decision.reviewDate.slice(0, 10) : ""}
              onChange={(event) => onChange("reviewDate", event.target.value ? new Date(event.target.value).toISOString() : "")}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Expected outcome
            </label>
            <input
              value={decision.expectedOutcome}
              onChange={(event) => onChange("expectedOutcome", event.target.value)}
              className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2 rounded-xl border border-[#c9b8a3] bg-[#f5efe6] p-4">
            <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">
              Formal review
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                  Outcome rating
                </label>
                <select
                  value={decision.outcomeRating}
                  onChange={(event) => onChange("outcomeRating", event.target.value)}
                  className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                >
                  {decisionOutcomeRatingOptions.map((option) => (
                    <option key={option} value={option}>{option || "Not yet rated"}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                  Final status
                </label>
                <select
                  value={decision.decisionStatus}
                  onChange={(event) => onChange("decisionStatus", event.target.value)}
                  className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                >
                  {decisionStatusOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4">
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                Actual outcome
              </label>
              <textarea
                rows={3}
                value={decision.actualOutcome}
                onChange={(event) => onChange("actualOutcome", event.target.value)}
                className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
              />
            </div>
            {decision.expectedOutcome ? (
              <div className="mt-3 rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[12px] text-[#524d49]">
                <span className="font-medium text-[#171717]">Expected:</span> {decision.expectedOutcome}
              </div>
            ) : null}
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
              Lessons
            </label>
            <textarea
              rows={3}
              value={decision.lessons}
              onChange={(event) => onChange("lessons", event.target.value)}
              className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
            />
          </div>

          <div className="md:col-span-2 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Source traceability</div>
            <div className="mt-2 space-y-2 text-[12px] text-[#2f2b28]">
              <div><span className="font-medium">Related Opportunity ID:</span> {decision.relatedOpportunity || "Not linked"}</div>
              <div><span className="font-medium">Source Capture relationship:</span> {decision.relatedCapture || "Not linked"}</div>
              <div><span className="font-medium">Original Capture title:</span> {decision.title}</div>
              <div><span className="font-medium">Original raw note:</span> {decision.originalRawNote}</div>
              <div><span className="font-medium">Source Capture ID:</span> {decision.sourceCaptureId}</div>
              <div><span className="font-medium">Conversion date:</span> {formatCapturedAt(decision.createdAt)}</div>
            </div>
            {decision.relatedOpportunity && onOpenRelatedOpportunity ? (
              <button
                type="button"
                onClick={onOpenRelatedOpportunity}
                className="mt-3 rounded-lg border border-[#171717] bg-white px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#171717]"
              >
                Open related Opportunity
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCreateLinkedAction}
            className="rounded-lg border border-[#171717] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#171717]"
          >
            Create linked Action
          </button>
          {(decision.decisionStatus === "Completed" || decision.decisionStatus === "Reversed") ? (
            <button
              type="button"
              onClick={onCreateLinkedLesson}
              className="rounded-lg border border-[#171717] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#171717]"
            >
              Create lesson from decision
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1]"
          >
            Save decision
          </button>
        </div>

        {["Active", "Under Review"].includes(decision.decisionStatus) && !linkedActions.some((action) => ["Open", "In Progress", "Blocked"].includes(action.status)) ? (
          <div className="mt-3 rounded-xl border border-[#c9b8a3] bg-[#f5efe6] px-3 py-2.5 text-[12px] text-[#2f2b28]">
            <span className="font-medium text-[#171717]">No execution path.</span> This decision has no active execution path. Create a linked action so it becomes someone&apos;s work.
          </div>
        ) : null}

        <div className="mt-6 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Linked Actions</div>
          <div className="mt-3 space-y-2">
            {linkedActions.length === 0 ? (
              <div className="text-[12px] text-[#4d4944]">No linked actions yet.</div>
            ) : (
              linkedActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => onOpenLinkedAction(action)}
                  className="block w-full rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-left text-[12px] text-[#171717] hover:border-[#171717]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{action.actionTitle}</span>
                    <span className="text-[9px] uppercase tracking-[0.14em] text-[#4d4944]">{action.status}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Linked Lessons</div>
          <div className="mt-3 space-y-2">
            {linkedLessons.length === 0 ? (
              <div className="text-[12px] text-[#4d4944]">No linked lessons yet.</div>
            ) : (
              linkedLessons.map((lesson) => (
                <button
                  key={lesson.id}
                  type="button"
                  onClick={() => onOpenLinkedLesson(lesson)}
                  className="block w-full rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-left text-[12px] text-[#171717] hover:border-[#171717]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{lesson.lessonTitle}</span>
                    <span className="text-[9px] uppercase tracking-[0.14em] text-[#4d4944]">{lesson.status}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <RelatedRecordsPanel upstream={upstream} downstream={downstream} />
      </div>
    </div>
  );
}

export default function Home() {
  const [formValues, setFormValues] = useState<CaptureFormValues>(defaultFormValues);
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [conversions, setConversions] = useState<CaptureConversionRecord[]>([]);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<ReviewOutcome>("Keep as Capture");
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  const [problemEditor, setProblemEditor] = useState<ProblemRecord | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [actionEditor, setActionEditor] = useState<ActionRecord | null>(null);
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null);
  const [decisionEditor, setDecisionEditor] = useState<DecisionRecord | null>(null);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(null);
  const [opportunityEditor, setOpportunityEditor] = useState<OpportunityRecord | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [lessonEditor, setLessonEditor] = useState<LessonRecord | null>(null);
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  const [systemEditor, setSystemEditor] = useState<SystemRecord | null>(null);
  const [selectedSopId, setSelectedSopId] = useState<string | null>(null);
  const [sopEditor, setSopEditor] = useState<SopRecord | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [personEditor, setPersonEditor] = useState<PersonRecord | null>(null);
  const [personSaveState, setPersonSaveState] = useState<"idle" | "saved">("idle");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectEditor, setProjectEditor] = useState<ProjectRecord | null>(null);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [leadEditor, setLeadEditor] = useState<LeadRecord | null>(null);
  const [leadStatusFilter, setLeadStatusFilter] = useState<string>("All statuses");
  const [leadSourceFilter, setLeadSourceFilter] = useState<string>("All sources");
  const [leadOwnerFilter, setLeadOwnerFilter] = useState<string>("All owners");
  const [showArchivedLeads, setShowArchivedLeads] = useState<boolean>(false);
  const [cashPosition, setCashPosition] = useState<CashPositionRecord>(defaultCashPosition);
  const [incomeRecords, setIncomeRecords] = useState<IncomeRecord[]>([]);
  const [expenseRecords, setExpenseRecords] = useState<ExpenseRecord[]>([]);
  const [commitmentRecords, setCommitmentRecords] = useState<CommitmentRecord[]>([]);
  const [dailyPostureSnapshots, setDailyPostureSnapshots] = useState<DailyPostureSnapshot[]>([]);
  const [cashPositionEditor, setCashPositionEditor] = useState<CashPositionRecord | null>(null);
  const [selectedIncomeId, setSelectedIncomeId] = useState<string | null>(null);
  const [incomeEditor, setIncomeEditor] = useState<IncomeRecord | null>(null);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [expenseEditor, setExpenseEditor] = useState<ExpenseRecord | null>(null);
  const [selectedCommitmentId, setSelectedCommitmentId] = useState<string | null>(null);
  const [commitmentEditor, setCommitmentEditor] = useState<CommitmentRecord | null>(null);
  const [creatingLinkedActionForProblemId, setCreatingLinkedActionForProblemId] = useState<string | null>(null);
  const [creatingLinkedActionForDecisionId, setCreatingLinkedActionForDecisionId] = useState<string | null>(null);
  const [creatingLinkedDecisionForOpportunityId, setCreatingLinkedDecisionForOpportunityId] = useState<string | null>(null);
  const [creatingLinkedSystemForLessonId, setCreatingLinkedSystemForLessonId] = useState<string | null>(null);
  const [creatingLinkedLessonForDecisionId, setCreatingLinkedLessonForDecisionId] = useState<string | null>(null);
  const [creatingLinkedLessonForProblemId, setCreatingLinkedLessonForProblemId] = useState<string | null>(null);
  const [creatingLinkedSopForSystemId, setCreatingLinkedSopForSystemId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DestinationKey>("Capture");
  const [selectedPillar, setSelectedPillar] = useState<string | null>(null);
  const [selectedAccountabilityKey, setSelectedAccountabilityKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (feedback?.message !== "Action details saved." && feedback?.message !== "Decision details saved." && feedback?.message !== "Problem details saved." && feedback?.message !== "Opportunity details saved." && feedback?.message !== "Lesson details saved.") {
      return;
    }

    const timeoutId = window.setTimeout(() => setFeedback(null), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [feedback]);

  useEffect(() => {
    try {
      const storedCaptures = window.localStorage.getItem(STORAGE_KEY);
      const storedConversions = window.localStorage.getItem(CONVERSION_STORAGE_KEY);
      const storedPeople = window.localStorage.getItem(PERSON_STORAGE_KEY);
      const storedProjects = window.localStorage.getItem(PROJECT_STORAGE_KEY);
      const storedLeads = window.localStorage.getItem(LEAD_STORAGE_KEY);
      const storedCashPosition = window.localStorage.getItem(CASH_POSITION_STORAGE_KEY);
      const storedIncome = window.localStorage.getItem(INCOME_STORAGE_KEY);
      const storedExpenses = window.localStorage.getItem(EXPENSE_STORAGE_KEY);
      const storedCommitments = window.localStorage.getItem(COMMITMENT_STORAGE_KEY);

      if (storedCaptures) {
        const parsedCaptures = JSON.parse(storedCaptures);

        if (Array.isArray(parsedCaptures)) {
          setCaptures(parsedCaptures);
        }
      }

      if (storedConversions) {
        const parsedConversions = JSON.parse(storedConversions);

        if (Array.isArray(parsedConversions)) {
          const alreadyCleaned = window.localStorage.getItem(LEGACY_DUPLICATE_SYSTEM_CLEANUP_KEY) === "done";

          if (!alreadyCleaned) {
            const cleanedConversions = cleanupLegacyDuplicateLessonTestSystems(parsedConversions);
            window.localStorage.setItem(LEGACY_DUPLICATE_SYSTEM_CLEANUP_KEY, "done");
            setConversions(cleanedConversions);
          } else {
            setConversions(parsedConversions);
          }
        }
      }

      if (storedPeople) {
        const parsedPeople = JSON.parse(storedPeople);

        if (Array.isArray(parsedPeople)) {
          setPeople(parsedPeople);
        }
      }

      if (storedProjects) {
        const parsedProjects = JSON.parse(storedProjects);

        if (Array.isArray(parsedProjects)) {
          setProjects(parsedProjects);
        }
      }

      if (storedLeads) {
        const parsedLeads = JSON.parse(storedLeads);

        if (Array.isArray(parsedLeads)) {
          setLeads(parsedLeads);
        }
      }

      if (storedCashPosition) {
        const parsedCashPosition = JSON.parse(storedCashPosition);

        if (parsedCashPosition && typeof parsedCashPosition === "object") {
          setCashPosition({ ...defaultCashPosition, ...parsedCashPosition });
        }
      }

      if (storedIncome) {
        const parsedIncome = JSON.parse(storedIncome);

        if (Array.isArray(parsedIncome)) {
          setIncomeRecords(parsedIncome);
        }
      }

      if (storedExpenses) {
        const parsedExpenses = JSON.parse(storedExpenses);

        if (Array.isArray(parsedExpenses)) {
          setExpenseRecords(parsedExpenses);
        }
      }

      if (storedCommitments) {
        const parsedCommitments = JSON.parse(storedCommitments);

        if (Array.isArray(parsedCommitments)) {
          setCommitmentRecords(parsedCommitments);
        }
      }

      const storedSnapshots = window.localStorage.getItem(DAILY_POSTURE_SNAPSHOTS_STORAGE_KEY);
      if (storedSnapshots) {
        const parsedSnapshots = JSON.parse(storedSnapshots);

        if (Array.isArray(parsedSnapshots)) {
          const normalised = parsedSnapshots
            .filter((entry) => entry && typeof entry === "object" && typeof entry.date === "string")
            .map((entry) => ({
              date: entry.date,
              focusCount: typeof entry.focusCount === "number" ? entry.focusCount : 0,
              ownershipGapCount: typeof entry.ownershipGapCount === "number" ? entry.ownershipGapCount : 0,
              decisionReviewsDue: typeof entry.decisionReviewsDue === "number" ? entry.decisionReviewsDue : 0,
              executionGapCount: typeof entry.executionGapCount === "number" ? entry.executionGapCount : 0,
              learningGapCount: typeof entry.learningGapCount === "number" ? entry.learningGapCount : 0,
              staleRecordCount: typeof entry.staleRecordCount === "number" ? entry.staleRecordCount : 0,
              financeAttentionCount: typeof entry.financeAttentionCount === "number" ? entry.financeAttentionCount : 0,
              growthStallCount: typeof entry.growthStallCount === "number" ? entry.growthStallCount : 0,
              outstandingCount: typeof entry.outstandingCount === "number" ? entry.outstandingCount : 0,
              availableOperatingCash: typeof entry.availableOperatingCash === "number" ? entry.availableOperatingCash : null,
              delegationQualityPct: typeof entry.delegationQualityPct === "number" ? entry.delegationQualityPct : null,
              avgOpenDecisionDays: typeof entry.avgOpenDecisionDays === "number" ? entry.avgOpenDecisionDays : null,
              selfSufficiencyPct: typeof entry.selfSufficiencyPct === "number" ? entry.selfSufficiencyPct : null,
              outstandingKeys: Array.isArray(entry.outstandingKeys)
                ? entry.outstandingKeys
                    .filter((k: unknown) => k && typeof k === "object" && typeof (k as { key?: unknown }).key === "string")
                    .map((k: { key: string; title?: unknown; objectType?: unknown; category?: unknown }) => ({
                      key: k.key,
                      title: typeof k.title === "string" ? k.title : k.key,
                      objectType: typeof k.objectType === "string" ? k.objectType : "Record",
                      category: typeof k.category === "string" ? k.category : "attention",
                    }))
                : [],
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
          setDailyPostureSnapshots(normalised);
        }
      }
    } catch {
      setFeedback({
        type: "error",
        message: "Local capture storage could not be loaded.",
      });
    }
  }, []);

  useEffect(() => {
    if (captures.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(captures));
    }
  }, [captures]);

  useEffect(() => {
    if (conversions.length === 0) {
      window.localStorage.removeItem(CONVERSION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(CONVERSION_STORAGE_KEY, JSON.stringify(conversions));
    }
  }, [conversions]);

  useEffect(() => {
    if (people.length === 0) {
      window.localStorage.removeItem(PERSON_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PERSON_STORAGE_KEY, JSON.stringify(people));
    }
  }, [people]);

  useEffect(() => {
    if (projects.length === 0) {
      window.localStorage.removeItem(PROJECT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(projects));
    }
  }, [projects]);

  useEffect(() => {
    if (leads.length === 0) {
      window.localStorage.removeItem(LEAD_STORAGE_KEY);
    } else {
      window.localStorage.setItem(LEAD_STORAGE_KEY, JSON.stringify(leads));
    }
  }, [leads]);

  useEffect(() => {
    window.localStorage.setItem(CASH_POSITION_STORAGE_KEY, JSON.stringify(cashPosition));
  }, [cashPosition]);

  useEffect(() => {
    if (incomeRecords.length === 0) {
      window.localStorage.removeItem(INCOME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(INCOME_STORAGE_KEY, JSON.stringify(incomeRecords));
    }
  }, [incomeRecords]);

  useEffect(() => {
    if (expenseRecords.length === 0) {
      window.localStorage.removeItem(EXPENSE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(EXPENSE_STORAGE_KEY, JSON.stringify(expenseRecords));
    }
  }, [expenseRecords]);

  useEffect(() => {
    if (commitmentRecords.length === 0) {
      window.localStorage.removeItem(COMMITMENT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(COMMITMENT_STORAGE_KEY, JSON.stringify(commitmentRecords));
    }
  }, [commitmentRecords]);

  const orderedCaptures = [...captures].sort(
    (first, second) =>
      new Date(second.capturedAt).getTime() - new Date(first.capturedAt).getTime(),
  );

  const orderedPeople = [...people].sort(
    (first, second) => new Date(second.dateCreated).getTime() - new Date(first.dateCreated).getTime(),
  );

  const activeLeads = leads.filter((lead) => !lead.archived);
  const archivedLeads = leads.filter((lead) => lead.archived);

  const orderedLeads = [...activeLeads].sort(
    (first, second) => new Date(second.dateCreated).getTime() - new Date(first.dateCreated).getTime(),
  );

  const orderedArchivedLeads = [...archivedLeads].sort(
    (first, second) => new Date(second.dateCreated).getTime() - new Date(first.dateCreated).getTime(),
  );

  const leadOwnerFilterOptions = Array.from(
    new Set(orderedLeads.map((lead) => lead.owner.trim() || "Unassigned")),
  ).sort();

  const filteredLeads = orderedLeads.filter((lead) => {
    const matchesStatus = leadStatusFilter === "All statuses" || lead.status === leadStatusFilter;
    const matchesSource = leadSourceFilter === "All sources" || lead.sourceChannel === leadSourceFilter;
    const matchesOwner = leadOwnerFilter === "All owners" || (lead.owner.trim() || "Unassigned") === leadOwnerFilter;
    return matchesStatus && matchesSource && matchesOwner;
  });

  const parseFinanceAmount = (value: string) => {
    const parsed = parseFloat(value.replace(/[^0-9.\-]/g, ""));
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  const formatFinanceAmount = (value: number) =>
    value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const orderedIncome = [...incomeRecords].sort((a, b) => (b.date || b.dateCreated).localeCompare(a.date || a.dateCreated));
  const orderedExpenses = [...expenseRecords].sort((a, b) => (b.date || b.dateCreated).localeCompare(a.date || a.dateCreated));
  const orderedCommitments = [...commitmentRecords].sort((a, b) => (a.dueDate || a.dateCreated).localeCompare(b.dueDate || b.dateCreated));

  const totalReceivedIncome = incomeRecords
    .filter((record) => record.status === "Received")
    .reduce((total, record) => total + parseFinanceAmount(record.amount), 0);
  const totalPaidExpenses = expenseRecords
    .filter((record) => record.status === "Paid")
    .reduce((total, record) => total + parseFinanceAmount(record.amount), 0);
  const netCashMovement = totalReceivedIncome - totalPaidExpenses;
  const reservedTaxAmount = parseFinanceAmount(cashPosition.reservedTax);
  const safetyBufferAmount = parseFinanceAmount(cashPosition.safetyBuffer);
  const availableOperatingCash = parseFinanceAmount(cashPosition.currentCash) - reservedTaxAmount - safetyBufferAmount;

  const getConvertedRecordsByType = (targetType: CaptureConversionRecord["targetType"]) =>
    [...conversions]
      .filter((conversion) => conversion.targetType === targetType)
      .sort(
        (first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime(),
      );

  const activeDestination = destinationDefinitions.find((destination) => destination.key === activeView);
  const problemRecords = getConvertedRecordsByType("Convert to Problem").map(normalizeProblemRecord);
  const actionRecords = getConvertedRecordsByType("Convert to Action").map(normalizeActionRecord);
  const decisionRecords = getConvertedRecordsByType("Convert to Decision").map(normalizeDecisionRecord);
  const opportunityRecords = getConvertedRecordsByType("Convert to Opportunity").map(normalizeOpportunityRecord);
  const lessonRecords = getConvertedRecordsByType("Convert to Lesson").map(normalizeLessonRecord);
  const systemRecords = getConvertedRecordsByType("Convert to System").map(normalizeSystemRecord);
  const sopRecords = getConvertedRecordsByType("Convert to SOP").map(normalizeSopRecord);

  type AttentionItem = {
    id: string;
    objectType: "Problem" | "Action" | "Decision" | "Opportunity" | "Project" | "Lesson" | "System" | "SOP";
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
    onOpen: () => void;
    dependencyAction?: {
      label: string;
      onOpen: () => void;
    };
  };

  const getAreaText = (record: { relatedArea?: string; relatedPillar?: string; area?: string; }) => {
    return record.relatedPillar || record.relatedArea || record.area || "";
  };

  const getDateValue = (value?: string) => {
    if (!value) {
      return 0;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  };

  const getProblemPriorityScore = (problem: ProblemRecord) => {
    let score = 0;

    if (problem.severity === "Critical") {
      score += 150;
    } else if (problem.severity === "High") {
      score += 110;
    }

    if (problem.problemStatus === "Open") {
      score += 35;
    } else if (problem.problemStatus === "Action required") {
      score += 30;
    } else if (problem.problemStatus === "Investigating") {
      score += 20;
    }

    return score;
  };

  const getActionPriorityScore = (action: ActionRecord) => {
    let score = 0;

    if (action.status === "Blocked") {
      score += 140;
    }

    if (action.priority === "Critical") {
      score += 120;
    } else if (action.priority === "High") {
      score += 90;
    }

    if (action.dueDate) {
      const dueDate = getDateValue(action.dueDate);
      const daysUntilDue = (dueDate - Date.now()) / (1000 * 60 * 60 * 24);

      if (dueDate && daysUntilDue < 0) {
        score += 180;
      } else if (daysUntilDue <= 7) {
        score += 60;
      }
    }

    if (action.status === "In Progress") {
      score += 20;
    }

    return score;
  };

  const isActionActive = (action: ActionRecord) =>
    ["Open", "In Progress", "Blocked"].includes(action.status);

  const isProblemUnresolved = (problem: ProblemRecord) =>
    ["Open", "Investigating", "Action required"].includes(problem.problemStatus);

  const isDecisionActive = (decision: DecisionRecord) =>
    ["Draft", "Active", "Under Review"].includes(decision.decisionStatus);

  const isDecisionNotYetActionable = (decision: DecisionRecord) =>
    ["Draft", "Under Review"].includes(decision.decisionStatus);

  const isOpportunityUnderEvaluation = (opportunity: OpportunityRecord) =>
    opportunity.status === "Evaluating" && ["High", "Exceptional"].includes(opportunity.strategicFit);

  const isProjectActive = (project: ProjectRecord) =>
    !["completed", "closed", "final", "cancelled", "canceled"].includes(project.status.trim().toLowerCase());

  const metricsLeadsGenerated = activeLeads.length;
  const metricsLeadsBySource = leadSourceOptions
    .map((source) => ({ source, count: activeLeads.filter((lead) => lead.sourceChannel === source).length }))
    .filter((entry) => entry.count > 0);
  const metricsJobsWon = activeLeads.filter((lead) => lead.status === "Won").length;
  const metricsQuotesSent = activeLeads.filter((lead) => lead.status === "Quote Sent" || lead.status === "Follow-Up" || lead.status === "Won" || Boolean(lead.quoteSentDate)).length;
  const metricsLeadToJobConversion = metricsLeadsGenerated === 0 ? 0 : (metricsJobsWon / metricsLeadsGenerated) * 100;
  const wonLeadsValue = (lead: LeadRecord) => parseFinanceAmount(lead.finalJobValue) || parseFinanceAmount(lead.quoteValue);
  const metricsRevenueFromWonLeads = activeLeads
    .filter((lead) => lead.status === "Won")
    .reduce((total, lead) => total + wonLeadsValue(lead), 0);
  const metricsAverageJobValue = metricsJobsWon === 0
    ? 0
    : activeLeads.filter((lead) => lead.status === "Won").reduce((total, lead) => total + wonLeadsValue(lead), 0) / metricsJobsWon;

  const metricsOpenActions = actionRecords.filter((action) => action.status === "Open").length;
  const metricsInProgressActions = actionRecords.filter((action) => action.status === "In Progress").length;
  const metricsCompletedActions = actionRecords.filter((action) => action.status === "Completed").length;
  const metricsActiveProjects = projects.filter((project) => isProjectActive(project)).length;
  const metricsBlockedProjects = projects.filter((project) => project.status.trim().toLowerCase() === "blocked").length;

  const pillarOptions = ["Garden Maintenance", "Hard Landscape Construction", "Excavation"] as const;
  const pillarSummaries = pillarOptions.map((pillar) => {
    const pillarProjects = projects.filter((project) => project.area === pillar && isProjectActive(project));
    const pillarActions = actionRecords.filter((action) => action.relatedPillar === pillar && isActionActive(action));
    const pillarProblems = problemRecords.filter((problem) => getAreaText(problem) === pillar && isProblemUnresolved(problem));
    const pillarOpportunities = opportunityRecords.filter((opportunity) => (opportunity.relatedPillar || opportunity.relatedArea || "") === pillar && ["New", "Evaluating", "On Hold"].includes(opportunity.status));
    const pillarLeads = activeLeads.filter((lead) => (lead.relatedPillar || "") === pillar);
    const pillarFollowUpLeads = pillarLeads.filter((lead) => lead.status === "Follow-Up");
    const pillarWonLeadsValue = pillarLeads
      .filter((lead) => lead.status === "Won")
      .reduce((total, lead) => total + wonLeadsValue(lead), 0);

    const priorityScore = (
      pillarProblems.length * 6 +
      pillarActions.filter((action) => action.status === "Blocked").length * 8 +
      pillarActions.filter((action) => action.dueDate && new Date(action.dueDate).getTime() <= Date.now()).length * 3 +
      pillarProjects.filter((project) => project.status.trim().toLowerCase() === "blocked").length * 5 +
      pillarFollowUpLeads.length * 2 +
      pillarOpportunities.length * 2
    );

    return {
      pillar,
      activeProjects: pillarProjects.length,
      blockedProjects: pillarProjects.filter((project) => project.status.trim().toLowerCase() === "blocked").length,
      openActions: pillarActions.length,
      openProblems: pillarProblems.length,
      openOpportunities: pillarOpportunities.length,
      leadsWaiting: pillarFollowUpLeads.length,
      wonLeadValue: pillarWonLeadsValue,
      priorityScore,
    };
  });

  const empireDecisionQueue = (() => {
    const founderReviewQueue = [
      ...decisionRecords
        .filter((decision) => ["Draft", "Active", "Under Review"].includes(decision.decisionStatus))
        .map((decision) => ({
          id: decision.id,
          kind: "Decision" as const,
          title: decision.decisionTitle,
          pillar: getAreaText(decision) || "Unassigned",
          owner: decision.decisionMaker || "Unassigned",
          whatIsChanging: decision.decisionStatement || "No decision statement recorded.",
          whyItMatters: decision.reviewDate && new Date(decision.reviewDate).getTime() <= Date.now()
            ? `This decision is overdue for review, so the current path may be stale or unchallenged.`
            : decision.riskLevel === "High" || decision.riskLevel === "Critical"
              ? `This decision carries ${decision.riskLevel.toLowerCase()} risk and should be checked before it becomes a delivery issue.`
              : "This decision is active and still shaping execution or resource allocation.",
          founderIntervention: decision.decisionStatus === "Under Review" || decision.riskLevel === "High" || decision.riskLevel === "Critical" ? "Yes" : "Maybe",
          delegationAction: decision.decisionStatus === "Draft" ? "Delegate for drafting and owner review" : "Escalate if risk increases",
        })),
      ...problemRecords
        .filter((problem) => isProblemUnresolved(problem) && (problem.severity === "High" || problem.severity === "Critical" || problem.problemStatus === "Action required"))
        .map((problem) => ({
          id: problem.id,
          kind: "Problem" as const,
          title: problem.problemStatement,
          pillar: getAreaText(problem) || "Unassigned",
          owner: problem.owner || "Unassigned",
          whatIsChanging: `${problem.severity} severity problem still requiring action.`,
          whyItMatters: `This issue remains ${problem.problemStatus.toLowerCase()}, so quality, time, or delivery is still being affected.`,
          founderIntervention: problem.severity === "Critical" ? "Yes" : "Maybe",
          delegationAction: problem.severity === "High" || problem.severity === "Critical" ? "Escalate to direct owner and review urgency" : "Delegate to operational owner",
        })),
      ...actionRecords
        .filter((action) => action.status === "Blocked" || (action.status === "Open" && action.priority === "Critical"))
        .map((action) => ({
          id: action.id,
          kind: "Action" as const,
          title: action.actionTitle,
          pillar: action.relatedPillar || "Unassigned",
          owner: action.owner || "Unassigned",
          whatIsChanging: action.status === "Blocked" ? "This dependency is blocked and preventing progress." : "This critical action is still open and needs immediate movement.",
          whyItMatters: action.dueDate && new Date(action.dueDate).getTime() <= Date.now()
            ? `The due date of ${action.dueDate} has passed, so momentum is slipping and downstream work is delayed.`
            : "This item is critical to the current operating plan and should not sit unresolved.",
          founderIntervention: action.status === "Blocked" || action.priority === "Critical" ? "Yes" : "Maybe",
          delegationAction: action.status === "Blocked" ? "Escalate and remove dependency" : "Delegate with clear owner follow-up",
        })),
    ];

    const riskByPillar = pillarOptions.map((pillar) => {
      const criticalProblems = problemRecords.filter((problem) => getAreaText(problem) === pillar && (problem.severity === "Critical" || problem.severity === "High") && isProblemUnresolved(problem));
      const blockedProjects = projects.filter((project) => project.area === pillar && project.status.trim().toLowerCase() === "blocked");
      const overdueActions = actionRecords.filter((action) => action.relatedPillar === pillar && action.dueDate && new Date(action.dueDate).getTime() <= Date.now() && isActionActive(action));
      const activeDecisions = decisionRecords.filter((decision) => getAreaText(decision) === pillar && ["Active", "Under Review"].includes(decision.decisionStatus));
      const riskScore = criticalProblems.length * 4 + blockedProjects.length * 3 + overdueActions.length * 2 + activeDecisions.length;

      return {
        pillar,
        riskScore,
        criticalProblems,
        blockedProjects,
        overdueActions,
        activeDecisions,
      };
    }).filter((item) => item.riskScore > 0 || item.activeDecisions.length > 0 || item.blockedProjects.length > 0 || item.criticalProblems.length > 0);

    const crossPillarIssues = [
      ...problemRecords.filter((problem) => {
        const area = getAreaText(problem);
        return area && !pillarOptions.includes(area as (typeof pillarOptions)[number]) && isProblemUnresolved(problem);
      }),
      ...actionRecords.filter((action) => {
        const area = action.relatedPillar || "";
        return !pillarOptions.includes(area as (typeof pillarOptions)[number]) && isActionActive(action);
      }),
      ...projects.filter((project) => project.area && !pillarOptions.includes(project.area as (typeof pillarOptions)[number]) && isProjectActive(project)),
    ].slice(0, 8).map((item) => {
      const owner = "owner" in item ? item.owner || "Unassigned" : "Unassigned";
      const area = "relatedPillar" in item ? (item.relatedPillar || "General") : "area" in item ? item.area : "General";

      return {
        id: item.id,
        objectType: "problemStatement" in item ? "Problem" : "actionTitle" in item ? "Action" : "Project",
        title: "problemStatement" in item ? item.problemStatement : "actionTitle" in item ? item.actionTitle : item.projectName,
        kind: "problemStatement" in item ? "Cross-pillar problem" : "actionTitle" in item ? "Cross-pillar action" : "Cross-pillar project",
        owner,
        area,
        why: "problemStatement" in item
          ? `This issue is unresolved and affects work outside the three core pillars, which can slow delivery across the wider operation.`
          : "actionTitle" in item
            ? "This action is still active and can create dependency drag across more than one business stream."
            : "This project is active outside the core pillar list and may be creating execution pressure or resource contention.",
        founderIntervention: "Maybe",
        delegationAction: "Delegate to the accountable lead with founder review if it becomes material",
      };
    });

    const delegateItems = actionRecords
      .filter((action) => action.status === "Open" && action.priority !== "Critical" && (!action.dueDate || new Date(action.dueDate).getTime() > Date.now() + 1000 * 60 * 60 * 24 * 30))
      .slice(0, 6)
      .map((action) => ({
        id: action.id,
        objectType: "Action",
        title: action.actionTitle,
        pillar: action.relatedPillar || "Unassigned",
        owner: action.owner || "Unassigned",
        whatIsChanging: "The work is still active but does not require founder-level attention yet.",
        whyItMatters: action.dueDate
          ? `The next deadline is ${action.dueDate}, which gives enough runway for standard operational management.`
          : "This action is live and should remain inside normal operational ownership.",
        founderIntervention: "No",
        delegationAction: "Delegate to the assigned owner for routine delivery",
      }));

    const founderAuthorityItems = [
      ...projects.filter((project) => project.status.trim().toLowerCase() === "blocked" && project.area && pillarOptions.includes(project.area as (typeof pillarOptions)[number])).map((project) => ({
        id: project.id,
        objectType: "Project",
        title: project.projectName,
        pillar: project.area,
        owner: project.owner || "Unassigned",
        whatIsChanging: "This project is blocked and needs a decision on sequencing, resourcing or scope.",
        whyItMatters: "A blocked project is preventing delivery, revenue timing or plan confidence in this pillar.",
        founderIntervention: "Yes",
        delegationAction: "Escalate to founder or executive decision on how to unblock",
      })),
      ...opportunityRecords
        .filter((opportunity) => {
          const hasSettledDecision = decisionRecords.some((decision) =>
            decision.relatedOpportunity === opportunity.id && ["Completed", "Reversed"].includes(decision.decisionStatus),
          );

          return ["Evaluating", "Approved"].includes(opportunity.status)
            && ["High", "Exceptional"].includes(opportunity.strategicFit)
            && !(opportunity.status === "Approved" && hasSettledDecision);
        })
        .map((opportunity) => ({
          id: opportunity.id,
          objectType: "Opportunity",
          title: opportunity.opportunityTitle,
          pillar: opportunity.relatedPillar || opportunity.relatedArea || "Unassigned",
          owner: opportunity.owner || "Unassigned",
          whatIsChanging: `This opportunity is still being evaluated for ${opportunity.strategicFit.toLowerCase()} strategic fit.`,
          whyItMatters: "This item could materially change revenue or allocation, so it needs a deliberate decision rather than casual drift.",
          founderIntervention: "Yes",
          delegationAction: "Escalate to founder approval or strategic decision",
        })),
    ].slice(0, 8);

    return {
      founderReviewQueue,
      riskByPillar,
      crossPillarIssues,
      delegateItems,
      founderAuthorityItems,
    };
  })();

  const decisionTrackRecord = (() => {
    const reviewedDecisions = decisionRecords.filter((decision) =>
      decision.decisionStatus === "Completed" || decision.decisionStatus === "Reversed" || Boolean(decision.outcomeRating),
    );
    const reviewsDue = decisionRecords.filter((decision) =>
      ["Draft", "Active", "Under Review"].includes(decision.decisionStatus) &&
      Boolean(decision.reviewDate) &&
      new Date(decision.reviewDate).getTime() <= Date.now(),
    );
    const ratings = { worked: 0, partially: 0, failed: 0, unrated: 0 };
    reviewedDecisions.forEach((decision) => {
      if (decision.outcomeRating === "Worked") ratings.worked += 1;
      else if (decision.outcomeRating === "Partially worked") ratings.partially += 1;
      else if (decision.outcomeRating === "Failed") ratings.failed += 1;
      else ratings.unrated += 1;
    });
    const byMaker = new Map<string, { total: number; worked: number; failed: number }>();
    reviewedDecisions.forEach((decision) => {
      const maker = decision.decisionMaker || "Unassigned";
      const entry = byMaker.get(maker) || { total: 0, worked: 0, failed: 0 };
      entry.total += 1;
      if (decision.outcomeRating === "Worked") entry.worked += 1;
      if (decision.outcomeRating === "Failed") entry.failed += 1;
      byMaker.set(maker, entry);
    });
    const byPillar = new Map<string, { total: number; worked: number; failed: number }>();
    reviewedDecisions.forEach((decision) => {
      const pillar = getAreaText(decision) || "Unassigned";
      const entry = byPillar.get(pillar) || { total: 0, worked: 0, failed: 0 };
      entry.total += 1;
      if (decision.outcomeRating === "Worked") entry.worked += 1;
      if (decision.outcomeRating === "Failed") entry.failed += 1;
      byPillar.set(pillar, entry);
    });
    const lessonsCreated = reviewedDecisions.filter((decision) =>
      lessonRecords.some((lesson) => lesson.relatedDecision === decision.id),
    ).length;
    return {
      reviewsDue,
      reviewedDecisions,
      ratings,
      byMaker: [...byMaker.entries()].map(([maker, counts]) => ({ maker, ...counts })),
      byPillar: [...byPillar.entries()].map(([pillar, counts]) => ({ pillar, ...counts })),
      lessonsCreated,
    };
  })();

  const recurringProblemLearning = (() => {
    const isRecurring = (problem: ProblemRecord) =>
      problem.frequency === "Recurring" || problem.frequency === "Persistent";

    const recurringProblems = problemRecords.filter((problem) => isRecurring(problem));
    const unresolvedRecurring = recurringProblems.filter((problem) => isProblemUnresolved(problem));

    const learningCapturedFor = (problem: ProblemRecord) => {
      const linkedLessons = lessonRecords.filter((lesson) => lesson.relatedProblem === problem.id);
      if (linkedLessons.length > 0) {
        return true;
      }
      const linkedLessonIds = new Set(linkedLessons.map((lesson) => lesson.id));
      const linkedSystems = systemRecords.filter((system) => linkedLessonIds.has(system.relatedLesson));
      if (linkedSystems.length > 0) {
        return true;
      }
      const linkedSystemIds = new Set(linkedSystems.map((system) => system.id));
      return sopRecords.some((sop) => linkedSystemIds.has(sop.relatedSystem));
    };

    const gaps = recurringProblems
      .filter((problem) => !learningCapturedFor(problem))
      .map((problem) => ({
        id: problem.id,
        objectType: "Problem" as const,
        title: problem.problemStatement || problem.title,
        frequency: problem.frequency,
        severity: problem.severity,
        status: problem.problemStatus,
        area: getAreaText(problem) || "Unassigned",
        owner: problem.owner || "Unassigned",
      }));

    return {
      unresolvedRecurring,
      gaps,
    };
  })();

  const decisionsWithoutExecution = (() => {
    const openActionStatuses = ["Open", "In Progress", "Blocked"];

    return decisionRecords
      .filter((decision) => ["Active", "Under Review"].includes(decision.decisionStatus))
      .map((decision) => {
        const linked = actionRecords.filter((action) => action.relatedDecision === decision.id);
        const openLinked = linked.filter((action) => openActionStatuses.includes(action.status));

        if (openLinked.length > 0) {
          return null;
        }

        return {
          id: decision.id,
          objectType: "Decision" as const,
          title: decision.decisionTitle || decision.title,
          status: decision.decisionStatus,
          area: getAreaText(decision) || "Unassigned",
          owner: decision.decisionMaker || "Unassigned",
          reason: linked.length === 0
            ? "No linked actions"
            : "All linked actions are closed while decision remains active",
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  })();

  const selectedPillarDetail = selectedPillar ? (() => {
    const blockedProjects = projects.filter((project) => project.area === selectedPillar && project.status.trim().toLowerCase() === "blocked");
    const overdueActions = actionRecords.filter((action) => action.relatedPillar === selectedPillar &&
      action.status !== "Completed" &&
      action.status !== "Cancelled" &&
      action.dueDate &&
      new Date(action.dueDate).getTime() <= Date.now());
    const unresolvedProblems = problemRecords.filter((problem) => getAreaText(problem) === selectedPillar && isProblemUnresolved(problem));
    const openOpportunities = opportunityRecords.filter((opportunity) =>
      (opportunity.relatedPillar || opportunity.relatedArea || "") === selectedPillar &&
      ["New", "Evaluating", "On Hold"].includes(opportunity.status),
    );
    const followUpLeads = activeLeads.filter((lead) => (lead.relatedPillar || "") === selectedPillar && lead.status === "Follow-Up");

    const sections = [
      {
        label: "Blocked projects",
        items: blockedProjects.map((project) => ({
          id: project.id,
          objectType: "Project",
          title: project.projectName,
          meta: `${project.owner} • ${project.status}`,
          why: project.targetCompletionDate
            ? `This project is blocked and has a target completion of ${project.targetCompletionDate}. That keeps delivery and revenue timing uncertain for this pillar.`
            : "This project is blocked, which means work is stalled and the pillar is carrying execution risk until it is resolved.",
        })),
      },
      {
        label: "Overdue actions",
        items: overdueActions.map((action) => ({
          id: action.id,
          objectType: "Action",
          title: action.actionTitle,
          meta: `${action.owner || "Unassigned"} • ${action.status} • ${action.priority}`,
          why: action.dueDate
            ? `The due date was ${action.dueDate}. This action is overdue and is now creating execution drag for the current workstream.`
            : "This action is still active but has no clear deadline, so it is at risk of slipping and delaying dependent work.",
        })),
      },
      {
        label: "Unresolved problems",
        items: unresolvedProblems.map((problem) => ({
          id: problem.id,
          objectType: "Problem",
          title: problem.problemStatement,
          meta: `${problem.severity} • ${problem.problemStatus} • ${problem.owner || "Unassigned"}`,
          why: problem.severity === "Critical" || problem.severity === "High"
            ? `This problem is ${problem.severity.toLowerCase()} and still ${problem.problemStatus.toLowerCase()}. It is materially affecting quality, safety, or delivery reliability.`
            : `This problem is still ${problem.problemStatus.toLowerCase()} and remains unresolved, so it is likely reducing productivity or increasing rework in this pillar.`,
        })),
      },
      {
        label: "Open opportunities",
        items: openOpportunities.map((opportunity) => ({
          id: opportunity.id,
          objectType: "Opportunity",
          title: opportunity.opportunityTitle,
          meta: `${opportunity.status} • ${opportunity.strategicFit} fit • ${opportunity.owner || "Unassigned"}`,
          why: opportunity.status === "Evaluating" || opportunity.status === "On Hold"
            ? `This opportunity is still ${opportunity.status.toLowerCase()} and is not yet converted into revenue. It is a live growth lever that needs a decision or follow-through.`
            : `This opportunity is still active, and the current status means it needs attention before it slips or is lost to competitors.`,
        })),
      },
      {
        label: "Leads needing follow-up",
        items: followUpLeads.map((lead) => ({
          id: lead.id,
          objectType: "Lead",
          title: lead.leadName,
          meta: `${lead.serviceRequested} • ${lead.owner || "Unassigned"} • ${lead.followUpDate || "Follow-up date not set"}`,
          why: lead.followUpDate
            ? `The follow-up date was ${lead.followUpDate}. This lead is waiting for a response, so momentum is at risk of stalling into lost opportunity.`
            : "This lead is marked for follow-up and is still waiting for a response, which means the deal is not yet moving forward.",
        })),
      },
    ];

    return {
      pillar: selectedPillar,
      sections,
    };
  })() : null;

  const buildAccountabilitySnapshot = (person: PersonRecord | null) => {
    const personName = person?.name ?? "";
    const isBlankOwner = (ownerValue?: string) => {
      const text = (ownerValue || "").trim();
      return text === "" || text.toLowerCase() === "unassigned";
    };
    const matchesActivePerson = (ownerValue?: string) => {
      const text = (ownerValue || "").trim();
      if (text === "") {
        return false;
      }
      return orderedPeople.some((entry) => entry.status === "Active" && entry.name.trim().toLowerCase() === text.toLowerCase());
    };
    const ownsByName = (ownerValue?: string) =>
      person !== null && personName.trim() !== "" && !isBlankOwner(ownerValue) && (ownerValue || "").trim().toLowerCase() === personName.trim().toLowerCase();

    const isOwnedAction = (action: ActionRecord) => {
      if (person === null) {
        if (action.ownerPersonId) {
          const activeOwner = orderedPeople.find((entry) => entry.id === action.ownerPersonId && entry.status === "Active");
          if (activeOwner) {
            return false;
          }
        }
        return isBlankOwner(action.owner) || !matchesActivePerson(action.owner);
      }

      if (action.ownerPersonId) {
        return action.ownerPersonId === person.id;
      }

      return ownsByName(action.owner);
    };
    const isOwnedProject = (project: ProjectRecord) => (person === null ? (isBlankOwner(project.owner) || !matchesActivePerson(project.owner)) : ownsByName(project.owner));
    const isOwnedLead = (lead: LeadRecord) => (person === null ? (isBlankOwner(lead.owner) || !matchesActivePerson(lead.owner)) : ownsByName(lead.owner));
    const isOwnedProblem = (problem: ProblemRecord) => (person === null ? (isBlankOwner(problem.owner) || !matchesActivePerson(problem.owner)) : ownsByName(problem.owner));
    const isOwnedDecision = (decision: DecisionRecord) => (person === null ? isBlankOwner(decision.decisionMaker) : ownsByName(decision.decisionMaker));

    const ownedActions = actionRecords.filter((action) => isActionActive(action) && isOwnedAction(action));
    const overdueActions = ownedActions.filter((action) => Boolean(action.dueDate) && new Date(action.dueDate).getTime() <= Date.now());
    const blockedActions = ownedActions.filter((action) => action.status === "Blocked");
    const otherOpenActions = ownedActions.filter((action) => !overdueActions.includes(action) && !blockedActions.includes(action));
    const ownedActiveProjects = projects.filter((project) => isProjectActive(project) && isOwnedProject(project));
    const ownedBlockedProjects = ownedActiveProjects.filter((project) => project.status.trim().toLowerCase() === "blocked");
    const ownedOtherProjects = ownedActiveProjects.filter((project) => project.status.trim().toLowerCase() !== "blocked");
    const pipelineLeads = activeLeads.filter((lead) => isOwnedLead(lead) && !["Won", "Lost"].includes(lead.status));
    const followUpLeads = pipelineLeads.filter((lead) =>
      lead.status === "Follow-Up" || (Boolean(lead.followUpDate) && new Date(lead.followUpDate).getTime() <= Date.now()),
    );
    const otherPipelineLeads = pipelineLeads.filter((lead) => !followUpLeads.includes(lead));
    const waitingDecisions = decisionRecords.filter((decision) =>
      isOwnedDecision(decision) && (
        ["Draft", "Under Review"].includes(decision.decisionStatus) ||
        (decision.decisionStatus === "Active" && Boolean(decision.reviewDate) && new Date(decision.reviewDate).getTime() <= Date.now())
      ),
    );
    const ownedUnresolvedProblems = problemRecords.filter((problem) => isProblemUnresolved(problem) && isOwnedProblem(problem));

    const blockedCount = blockedActions.length + ownedBlockedProjects.length;
    const carriedCount = ownedActions.length + ownedActiveProjects.length + pipelineLeads.length + waitingDecisions.length + ownedUnresolvedProblems.length;
    const attentionCount = overdueActions.length + blockedCount + followUpLeads.length + waitingDecisions.length;

    const sortByRiskThenAge = <T extends { dueDate?: string; createdAt?: string; priority?: string; severity?: string; targetCompletionDate?: string }>(items: T[]): T[] => {
      const riskWeight = (item: T) => {
        const level = (item.priority || item.severity || "").toLowerCase();
        if (level === "critical") return 4;
        if (level === "high") return 3;
        if (level === "medium") return 2;
        return 1;
      };
      const ageValue = (item: T) => {
        const dateText = item.dueDate || item.targetCompletionDate || item.createdAt || "";
        const parsed = dateText ? new Date(dateText).getTime() : 0;
        return Number.isNaN(parsed) ? 0 : parsed;
      };
      return [...items].sort((a, b) => {
        const riskDiff = riskWeight(b) - riskWeight(a);
        if (riskDiff !== 0) return riskDiff;
        return ageValue(a) - ageValue(b);
      });
    };

    return {
      person,
      ownerLabel: person ? person.name : "Unassigned",
      ownedActions: sortByRiskThenAge(ownedActions),
      overdueActions: sortByRiskThenAge(overdueActions),
      blockedActions: sortByRiskThenAge(blockedActions),
      otherOpenActions: sortByRiskThenAge(otherOpenActions),
      activeProjects: sortByRiskThenAge(ownedActiveProjects),
      blockedProjects: sortByRiskThenAge(ownedBlockedProjects),
      otherActiveProjects: sortByRiskThenAge(ownedOtherProjects),
      pipelineLeads,
      followUpLeads,
      otherPipelineLeads,
      waitingDecisions,
      unresolvedProblems: sortByRiskThenAge(ownedUnresolvedProblems),
      blockedCount,
      carriedCount,
      attentionCount,
    };
  };

  const personAccountabilitySummaries = orderedPeople.map((person) => ({ ...buildAccountabilitySnapshot(person), person }));
  const unassignedAccountability = buildAccountabilitySnapshot(null);

  const organisationalHealth = (() => {
    const founderPerson = orderedPeople.find((person) => person.accessLevel === "Founder" && person.status === "Active") || null;

    const activeActions = actionRecords.filter((action) => isActionActive(action));
    const activeProjects = projects.filter((project) => isProjectActive(project));
    const pipelineLeadsAll = activeLeads.filter((lead) => !["Won", "Lost"].includes(lead.status));
    const unresolvedProblems = problemRecords.filter((problem) => isProblemUnresolved(problem));

    const totalWork = activeActions.length + activeProjects.length + pipelineLeadsAll.length + unresolvedProblems.length;

    const founderNames = new Set<string>();
    if (founderPerson) {
      founderNames.add(founderPerson.name.trim().toLowerCase());
    }

    const hasValidOwner = (ownerText: string | undefined, ownerPersonId?: string) => {
      if (ownerPersonId) {
        const owner = orderedPeople.find((person) => person.id === ownerPersonId && person.status === "Active");
        if (owner) return owner.name.trim().toLowerCase();
      }
      const text = (ownerText || "").trim();
      if (!text || text.toLowerCase() === "unassigned") return null;
      const matched = orderedPeople.find((person) => person.status === "Active" && person.name.trim().toLowerCase() === text.toLowerCase());
      return matched ? matched.name.trim().toLowerCase() : null;
    };

    let validOwned = 0;
    let founderOwned = 0;
    let stalledOrRiskyDelegated = 0;
    const ownerLoad = new Map<string, number>();

    const tallyWork = (ownerText: string | undefined, ownerPersonId: string | undefined, isRisky: boolean) => {
      const ownerKey = hasValidOwner(ownerText, ownerPersonId);
      if (!ownerKey) return;
      validOwned += 1;
      ownerLoad.set(ownerKey, (ownerLoad.get(ownerKey) || 0) + 1);
      if (founderNames.has(ownerKey)) {
        founderOwned += 1;
      } else if (isRisky) {
        stalledOrRiskyDelegated += 1;
      }
    };

    const nowMs = Date.now();
    activeActions.forEach((action) => {
      const isRisky = action.status === "Blocked" || (Boolean(action.dueDate) && new Date(action.dueDate).getTime() < nowMs);
      tallyWork(action.owner, action.ownerPersonId, isRisky);
    });
    activeProjects.forEach((project) => {
      const isRisky = project.status.trim().toLowerCase() === "blocked" || (Boolean(project.targetCompletionDate) && new Date(project.targetCompletionDate).getTime() < nowMs);
      tallyWork(project.owner, undefined, isRisky);
    });
    pipelineLeadsAll.forEach((lead) => {
      const isRisky = (lead.status === "Quote Sent" && !lead.followUpDate) || (Boolean(lead.followUpDate) && new Date(lead.followUpDate).getTime() < nowMs);
      tallyWork(lead.owner, undefined, isRisky);
    });
    unresolvedProblems.forEach((problem) => {
      const isRisky = problem.severity === "Critical" || problem.severity === "High";
      tallyWork(problem.owner, undefined, isRisky);
    });

    const pctValidOwner = totalWork === 0 ? null : Math.round((validOwned / totalWork) * 100);
    const pctNonFounder = validOwned === 0 ? null : Math.round(((validOwned - founderOwned) / validOwned) * 100);
    const delegatedCount = validOwned - founderOwned;
    const pctDelegatedStalled = delegatedCount === 0 ? null : Math.round((stalledOrRiskyDelegated / delegatedCount) * 100);

    let topOwnerShare: number | null = null;
    if (validOwned > 0 && ownerLoad.size > 0) {
      const maxLoad = Math.max(...ownerLoad.values());
      topOwnerShare = Math.round((maxLoad / validOwned) * 100);
    }

    const delegationComponentsPresent = [pctValidOwner, pctNonFounder, pctDelegatedStalled, topOwnerShare].filter((v) => v !== null).length;
    const delegationScore = delegationComponentsPresent < 3 || totalWork === 0
      ? null
      : Math.round((pctValidOwner ?? 0) * 0.5 + (pctNonFounder ?? 0) * 0.3 + (100 - (pctDelegatedStalled ?? 0)) * 0.2);
    const delegationQuality = (() => {
      if (totalWork === 0) return { label: "No active work", tone: "clear" as const };
      if (delegationComponentsPresent < 3) return { label: "Insufficient data", tone: "neutral" as const };
      const score = delegationScore ?? 0;
      if (score >= 80) return { label: "Strong", tone: "clear" as const };
      if (score >= 60) return { label: "Adequate", tone: "neutral" as const };
      return { label: "Needs attention", tone: "warn" as const };
    })();

    const openDecisions = decisionRecords.filter((decision) => ["Active", "Under Review"].includes(decision.decisionStatus));
    const openDecisionAges = openDecisions
      .map((decision) => {
        const start = getDateValue(decision.decisionDate || decision.createdAt);
        return start > 0 ? Math.floor((nowMs - start) / (1000 * 60 * 60 * 24)) : null;
      })
      .filter((days): days is number => days !== null);
    const avgOpenDecisionDays = openDecisionAges.length === 0 ? null : Math.round(openDecisionAges.reduce((a, b) => a + b, 0) / openDecisionAges.length);

    const closedDecisions = decisionRecords.filter((decision) => ["Completed", "Reversed"].includes(decision.decisionStatus));
    const closedLatencies = closedDecisions
      .map((decision) => {
        const start = getDateValue(decision.decisionDate || decision.createdAt);
        const end = getDateValue(decision.reviewDate) || nowMs;
        return start > 0 && end > start ? Math.floor((end - start) / (1000 * 60 * 60 * 24)) : null;
      })
      .filter((days): days is number => days !== null);
    const avgClosedDecisionDays = closedLatencies.length === 0 ? null : Math.round(closedLatencies.reduce((a, b) => a + b, 0) / closedLatencies.length);

    const selfSufficiencyPct = totalWork === 0 ? null : pctNonFounder;

    return {
      totalWork,
      pctValidOwner,
      pctNonFounder,
      pctDelegatedStalled,
      topOwnerShare,
      delegationQuality,
      delegationScore,
      openDecisionCount: openDecisions.length,
      avgOpenDecisionDays,
      closedDecisionCount: closedDecisions.length,
      avgClosedDecisionDays,
      selfSufficiencyPct,
    };
  })();

  const capitalAllocation = (() => {
    const liveStatuses = ["New", "Evaluating", "On Hold", "Approved"];

    const liveOpportunities = opportunityRecords
      .filter((opportunity) => liveStatuses.includes(opportunity.status))
      .map((opportunity) => {
        const upside = parseFinanceAmount(opportunity.estimatedUpside);
        const capital = parseFinanceAmount(opportunity.requiredCapital);
        const hasUpside = upside > 0;
        const hasCapital = capital > 0;
        const efficiency = hasUpside && hasCapital ? upside / capital : null;
        const fitRank = opportunity.strategicFit === "Exceptional" ? 4 : opportunity.strategicFit === "High" ? 3 : opportunity.strategicFit === "Medium" ? 2 : 1;

        return {
          id: opportunity.id,
          title: opportunity.opportunityTitle || opportunity.title,
          status: opportunity.status,
          strategicFit: opportunity.strategicFit,
          fitRank,
          area: opportunity.relatedPillar || opportunity.relatedArea || "Unassigned",
          upside: hasUpside ? upside : null,
          capital: hasCapital ? capital : null,
          requiredTime: opportunity.requiredTime?.trim() || "",
          efficiency,
        };
      })
      .sort((a, b) =>
        b.fitRank - a.fitRank ||
        (b.efficiency ?? -1) - (a.efficiency ?? -1) ||
        (b.upside ?? 0) - (a.upside ?? 0),
      );

    const cashConfigured = cashPosition.currentCash.trim() !== "" || cashPosition.safetyBuffer.trim() !== "";
    const deployableCash = cashConfigured ? Math.max(0, availableOperatingCash) : null;
    const highFitWithCapital = liveOpportunities.filter((opp) => opp.fitRank >= 3 && opp.capital !== null);
    const highFitOpportunityCount = liveOpportunities.filter((opp) => opp.fitRank >= 3).length;
    const highFitCapitalRequired = highFitWithCapital.length === 0
      ? null
      : highFitWithCapital.reduce((sum, opp) => sum + (opp.capital ?? 0), 0);

    const pillarReturn = pillarOptions.map((pillar) => {
      const wonValue = activeLeads
        .filter((lead) => (lead.relatedPillar || "") === pillar && lead.status === "Won")
        .reduce((total, lead) => total + wonLeadsValue(lead), 0);
      const liveCount = liveOpportunities.filter((opp) => opp.area === pillar).length;
      const wonPerLiveOpportunity = liveCount > 0 && wonValue > 0 ? wonValue / liveCount : null;
      return { pillar, wonValue, liveCount, wonPerLiveOpportunity };
    });
    const totalWonValue = pillarReturn.reduce((sum, p) => sum + p.wonValue, 0);

    return {
      liveOpportunities,
      deployableCash,
      cashConfigured,
      highFitCapitalRequired,
      highFitOpportunityCount,
      pillarReturn,
      totalWonValue,
    };
  })();

  const isBlankOwnerText = (ownerValue?: string) => {
    const text = (ownerValue || "").trim();
    return text === "" || text.toLowerCase() === "unassigned";
  };
  const ownershipGapLabel = (ownerValue?: string) => (isBlankOwnerText(ownerValue) ? "Unassigned" : "Invalid / inactive owner");

  const staleUnownedWork = (() => {
    const now = Date.now();
    const staleThresholdMs = 1000 * 60 * 60 * 24 * 7;
    const ageMs = (dateText?: string) => {
      if (!dateText) return 0;
      const parsed = new Date(dateText).getTime();
      return Number.isNaN(parsed) ? 0 : now - parsed;
    };
    const isStale = (dateText?: string) => {
      const ms = ageMs(dateText);
      return ms > staleThresholdMs;
    };
    const movementDate = (record: { dueDate?: string; createdAt?: string; targetCompletionDate?: string }) =>
      record.dueDate || record.targetCompletionDate || record.createdAt;

    const items: Array<{
      key: string;
      objectType: string;
      id: string;
      title: string;
      area: string;
      owner: string;
      gapLabel: string;
      staleDays: number;
      score: number;
    }> = [];

    unassignedAccountability.ownedActions.forEach((action) => {
      const moved = movementDate(action);
      if (!isStale(moved)) return;
      items.push({
        key: `Action:${action.id}`,
        objectType: "Action",
        id: action.id,
        title: action.actionTitle,
        area: action.relatedPillar || "Unassigned",
        owner: action.owner || "Unassigned",
        gapLabel: ownershipGapLabel(action.owner),
        staleDays: Math.max(1, Math.floor(ageMs(moved) / (1000 * 60 * 60 * 24))),
        score: 320 + (action.priority === "Critical" ? 40 : action.priority === "High" ? 20 : 0),
      });
    });

    unassignedAccountability.unresolvedProblems.forEach((problem) => {
      const moved = movementDate(problem);
      if (!isStale(moved)) return;
      items.push({
        key: `Problem:${problem.id}`,
        objectType: "Problem",
        id: problem.id,
        title: problem.problemStatement,
        area: getAreaText(problem) || "Unassigned",
        owner: problem.owner || "Unassigned",
        gapLabel: ownershipGapLabel(problem.owner),
        staleDays: Math.max(1, Math.floor(ageMs(moved) / (1000 * 60 * 60 * 24))),
        score: 320 + (problem.severity === "Critical" ? 40 : problem.severity === "High" ? 20 : 0),
      });
    });

    unassignedAccountability.activeProjects.forEach((project) => {
      const moved = movementDate(project);
      if (!isStale(moved)) return;
      items.push({
        key: `Project:${project.id}`,
        objectType: "Project",
        id: project.id,
        title: project.projectName,
        area: project.area || "Unassigned",
        owner: project.owner || "Unassigned",
        gapLabel: ownershipGapLabel(project.owner),
        staleDays: Math.max(1, Math.floor(ageMs(moved) / (1000 * 60 * 60 * 24))),
        score: 330,
      });
    });

    unassignedAccountability.pipelineLeads.forEach((lead) => {
      const moved = lead.followUpDate || lead.dateReceived || lead.dateCreated;
      if (!isStale(moved)) return;
      items.push({
        key: `Lead:${lead.id}`,
        objectType: "Lead",
        id: lead.id,
        title: lead.leadName,
        area: lead.relatedPillar || "Unassigned",
        owner: lead.owner || "Unassigned",
        gapLabel: ownershipGapLabel(lead.owner),
        staleDays: Math.max(1, Math.floor(ageMs(moved) / (1000 * 60 * 60 * 24))),
        score: 300,
      });
    });

    return items.sort((a, b) => b.score - a.score || b.staleDays - a.staleDays);
  })();

  const cashAttention = (() => {
    const now = Date.now();
    const isPast = (dateText?: string) => {
      if (!dateText) return false;
      const parsed = new Date(dateText).getTime();
      return !Number.isNaN(parsed) && parsed < now;
    };

    const cashConfigured = cashPosition.currentCash.trim() !== "" || cashPosition.safetyBuffer.trim() !== "";
    const bufferBreached = cashConfigured && availableOperatingCash < 0;
    const bufferPressured = cashConfigured && !bufferBreached && availableOperatingCash === 0;

    const buffer = cashConfigured && (bufferBreached || bufferPressured)
      ? {
          key: "Finance:cash-buffer",
          title: bufferBreached ? "Cash below safety buffer" : "Cash at safety buffer",
          detail: bufferBreached
            ? `Available operating cash is ${formatFinanceAmount(availableOperatingCash)}, below the safety buffer of ${formatFinanceAmount(safetyBufferAmount)}.`
            : `Available operating cash is exactly at the safety buffer of ${formatFinanceAmount(safetyBufferAmount)}.`,
          severity: bufferBreached ? "critical" : "high",
        }
      : null;

    const overdueCommitments = commitmentRecords
      .filter((commitment) => commitment.status !== "Paid" && commitment.status !== "Cancelled" && (commitment.status === "Overdue" || isPast(commitment.dueDate)))
      .map((commitment) => ({
        key: `Finance:commitment:${commitment.id}`,
        id: commitment.id,
        title: commitment.commitmentName,
        amount: parseFinanceAmount(commitment.amount),
        dueDate: commitment.dueDate,
        detail: `${commitment.type} commitment of ${formatFinanceAmount(parseFinanceAmount(commitment.amount))} was due ${commitment.dueDate || "—"} and is not paid.`,
      }));

    const overdueExpectedIncome = incomeRecords
      .filter((income) => income.status === "Expected" && isPast(income.date))
      .map((income) => ({
        key: `Finance:income:${income.id}`,
        id: income.id,
        title: income.description || income.customerSource || "Expected income",
        amount: parseFinanceAmount(income.amount),
        date: income.date,
        detail: `Expected income of ${formatFinanceAmount(parseFinanceAmount(income.amount))} was due ${income.date || "—"} and has not been received.`,
      }));

    return {
      buffer,
      overdueCommitments,
      overdueExpectedIncome,
      count: (buffer ? 1 : 0) + overdueCommitments.length + overdueExpectedIncome.length,
      totalOverdueAmount: overdueCommitments.reduce((sum, item) => sum + item.amount, 0) + overdueExpectedIncome.reduce((sum, item) => sum + item.amount, 0),
    };
  })();

  const growthAttention = (() => {
    const now = Date.now();
    const dayMs = 1000 * 60 * 60 * 24;
    const ageDays = (dateText?: string) => {
      const value = getDateValue(dateText);
      return value > 0 ? Math.floor((now - value) / dayMs) : 0;
    };

    const opportunityThresholdDays = 14;
    const stalledOpportunities = opportunityRecords
      .filter((opportunity) =>
        ["High", "Exceptional"].includes(opportunity.strategicFit) &&
        ["New", "Evaluating"].includes(opportunity.status) &&
        ageDays(opportunity.dateIdentified || opportunity.createdAt) >= opportunityThresholdDays &&
        !decisionRecords.some((decision) => decision.relatedOpportunity === opportunity.id && isDecisionActive(decision)),
      )
      .map((opportunity) => ({
        id: opportunity.id,
        title: opportunity.opportunityTitle || opportunity.title,
        strategicFit: opportunity.strategicFit,
        status: opportunity.status,
        area: getAreaText(opportunity) || "Unassigned",
        ageDays: ageDays(opportunity.dateIdentified || opportunity.createdAt),
        estimatedUpside: parseFinanceAmount(opportunity.estimatedUpside),
      }));

    const newLeadThresholdDays = 7;
    const stalledLeads = activeLeads
      .filter((lead) => !["Won", "Lost"].includes(lead.status))
      .map((lead) => {
        const quoteAmount = parseFinanceAmount(lead.quoteValue);
        const followUpTime = getDateValue(lead.followUpDate);
        const receivedAge = ageDays(lead.dateReceived || lead.dateCreated);

        if (lead.status === "Quote Sent" && !lead.followUpDate) {
          return { lead, quoteAmount, reason: "Quote sent with no follow-up scheduled", ageDays: ageDays(lead.quoteSentDate || lead.dateReceived || lead.dateCreated) };
        }
        if (lead.status === "Quote Sent" && followUpTime > 0 && followUpTime < now) {
          return { lead, quoteAmount, reason: "Follow-up date passed with no resolution", ageDays: ageDays(lead.followUpDate) };
        }
        if (lead.status === "New" && receivedAge >= newLeadThresholdDays) {
          return { lead, quoteAmount, reason: "New lead with no contact progress", ageDays: receivedAge };
        }
        return null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => ({
        id: entry.lead.id,
        title: entry.lead.leadName,
        status: entry.lead.status,
        area: entry.lead.relatedPillar || "Unassigned",
        quoteValue: entry.quoteAmount,
        reason: entry.reason,
        ageDays: entry.ageDays,
      }));

    const stalledQuoteValue = stalledLeads.reduce((sum, item) => sum + item.quoteValue, 0);

    return {
      stalledOpportunities,
      stalledLeads,
      stalledQuoteValue,
      count: stalledOpportunities.length + stalledLeads.length,
    };
  })();

  const selectedAccountability = selectedAccountabilityKey === "unassigned"
    ? unassignedAccountability
    : personAccountabilitySummaries.find((entry) => entry.person.id === selectedAccountabilityKey) ?? null;
  const selectedAccountabilityPerson = selectedAccountability?.person ?? null;

  const selectedAccountabilityDetail = selectedAccountability ? (() => {
    const snapshot = selectedAccountability;
    const ownerLabel = snapshot.ownerLabel;
    const hasOwner = snapshot.person !== null;
    const ownerPhrase = hasOwner ? `with ${ownerLabel}` : "without a named owner";
    const gapMeta = (ownerValue?: string) => (hasOwner ? "" : `${ownershipGapLabel(ownerValue)} • `);

    const sections = [
      {
        label: "Overdue actions",
        items: snapshot.overdueActions.map((action) => ({
          id: action.id,
          objectType: "Action",
          title: action.actionTitle,
          meta: `${gapMeta(action.owner)}${action.status} • ${action.priority} priority • Due ${action.dueDate || "not set"}`,
          why: hasOwner
            ? `The due date was ${action.dueDate}. This is still ${action.status.toLowerCase()} and sits ${ownerPhrase}, so delegated delivery is slipping and needs a reset on timing, scope or support.`
            : `The due date was ${action.dueDate}. This action is overdue and has no owner, so it will keep slipping until it is assigned.`,
        })),
      },
      {
        label: "Blocked actions",
        items: snapshot.blockedActions.map((action) => ({
          id: action.id,
          objectType: "Action",
          title: action.actionTitle,
          meta: `${gapMeta(action.owner)}${action.priority} priority • Due ${action.dueDate || "not set"}`,
          why: `This action is blocked ${ownerPhrase}, which means progress depends on removing a dependency before anything else can move.`,
        })),
      },
      {
        label: "Blocked projects",
        items: snapshot.blockedProjects.map((project) => ({
          id: project.id,
          objectType: "Project",
          title: project.projectName,
          meta: `${gapMeta(project.owner)}${project.area || "No area"} • Target ${project.targetCompletionDate || "not set"}`,
          why: `This project is blocked ${ownerPhrase}, so delivery and revenue timing are uncertain until it is unblocked.`,
        })),
      },
      {
        label: "Decisions waiting on them",
        items: snapshot.waitingDecisions.map((decision) => ({
          id: decision.id,
          objectType: "Decision",
          title: decision.decisionTitle,
          meta: `${decision.decisionStatus} • ${decision.riskLevel} risk • Review ${decision.reviewDate || "not set"}`,
          why: decision.decisionStatus === "Draft"
            ? `This decision is still in draft ${ownerPhrase}, so execution is waiting on a choice that has not been finished.`
            : decision.decisionStatus === "Under Review"
              ? `This decision is under review ${ownerPhrase} and needs a conclusion so work can proceed on a settled basis.`
              : `The review date of ${decision.reviewDate} has passed ${ownerPhrase}, so the decision may be stale and needs confirmation or reversal.`,
        })),
      },
      {
        label: "Leads needing follow-up",
        items: snapshot.followUpLeads.map((lead) => ({
          id: lead.id,
          objectType: "Lead",
          title: lead.leadName,
          meta: `${gapMeta(lead.owner)}${lead.status} • ${lead.serviceRequested} • Follow-up ${lead.followUpDate || "not set"}`,
          why: lead.followUpDate && new Date(lead.followUpDate).getTime() <= Date.now()
            ? `The follow-up date was ${lead.followUpDate}. This lead is going stale ${ownerPhrase}, and slow response risks losing the work.`
            : `This lead is marked Follow-Up ${ownerPhrase}, so momentum depends on the next contact happening soon.`,
        })),
      },
      {
        label: "Unresolved problems",
        items: snapshot.unresolvedProblems.map((problem) => ({
          id: problem.id,
          objectType: "Problem",
          title: problem.problemStatement,
          meta: `${gapMeta(problem.owner)}${problem.severity} severity • ${problem.problemStatus}`,
          why: hasOwner
            ? `This problem is still ${problem.problemStatus.toLowerCase()} ${ownerPhrase}, so it continues to affect quality, time or delivery until resolved.`
            : `This problem is still ${problem.problemStatus.toLowerCase()} but has no valid active owner, so accountability for resolving it is not established.`,
        })),
      },
      {
        label: "Active projects",
        items: snapshot.otherActiveProjects.map((project) => ({
          id: project.id,
          objectType: "Project",
          title: project.projectName,
          meta: `${gapMeta(project.owner)}${project.status} • ${project.area || "No area"} • Target ${project.targetCompletionDate || "not set"}`,
          why: hasOwner
            ? `This project is active ${ownerPhrase} and forms part of the current delivery load.`
            : "This project is active but has no valid active owner, so accountability for its delivery is not established.",
        })),
      },
      {
        label: "Other open actions",
        items: snapshot.otherOpenActions.map((action) => ({
          id: action.id,
          objectType: "Action",
          title: action.actionTitle,
          meta: `${gapMeta(action.owner)}${action.status} • ${action.priority} priority • Due ${action.dueDate || "not set"}`,
          why: hasOwner
            ? `This action is part of the current workload ${ownerPhrase} and is proceeding inside normal ownership.`
            : "This action is active but has no valid active owner, so accountability for it is not established.",
        })),
      },
      {
        label: "Other pipeline leads",
        items: snapshot.otherPipelineLeads.map((lead) => ({
          id: lead.id,
          objectType: "Lead",
          title: lead.leadName,
          meta: `${gapMeta(lead.owner)}${lead.status} • ${lead.serviceRequested}`,
          why: hasOwner
            ? `This lead is in the pipeline ${ownerPhrase} and is progressing without an immediate follow-up risk.`
            : "This lead is in the pipeline but has no valid active owner, so accountability for progressing it is not established.",
        })),
      },
    ];

    return { ownerLabel, hasOwner, sections };
  })() : null;

  const metricsOpenOpportunities = opportunityRecords.filter((opportunity) => opportunity.status === "New" || opportunity.status === "Evaluating" || opportunity.status === "On Hold").length;
  const metricsApprovedOpportunities = opportunityRecords.filter((opportunity) => opportunity.status === "Approved").length;
  const metricsActiveDecisions = decisionRecords.filter((decision) => isDecisionActive(decision)).length;
  const metricsLeadsAwaitingFollowUp = activeLeads.filter((lead) => lead.status === "Follow-Up").length;
  const metricsWonLeads = metricsJobsWon;
  const metricsLostLeads = activeLeads.filter((lead) => lead.status === "Lost").length;

  const formatMetricPercent = (value: number) => `${value.toFixed(0)}%`;

  const getDaysOverdue = (dateValue: string) => {
    const dueDate = getDateValue(dateValue);

    if (!dueDate || dueDate >= Date.now()) {
      return 0;
    }

    return Math.max(1, Math.ceil((Date.now() - dueDate) / (1000 * 60 * 60 * 24)));
  };

  const getDecisionPriorityScore = (decision: DecisionRecord) => {
    let score = 0;

    if (decision.decisionStatus === "Under Review") {
      score += 40;
    }

    if (decision.reviewDate) {
      const reviewDate = getDateValue(decision.reviewDate);
      if (reviewDate && reviewDate <= Date.now()) {
        score += 150;
      } else {
        score += 60;
      }
    }

    return score;
  };

  const getOpportunityPriorityScore = (opportunity: OpportunityRecord) => {
    let score = 0;

    if (opportunity.status === "Evaluating") {
      score += 35;
    }

    if (opportunity.strategicFit === "Exceptional") {
      score += 110;
    } else if (opportunity.strategicFit === "High") {
      score += 90;
    }

    return score;
  };

  const getLessonPriorityScore = (lesson: LessonRecord) => {
    return lesson.status === "Change Required" ? 80 : 0;
  };

  const getSystemPriorityScore = (system: SystemRecord) => {
    return system.status === "Reviewing" ? 65 : 0;
  };

  const getSopPriorityScore = (sop: SopRecord) => {
    if (!sop.reviewDate) {
      return 0;
    }

    const reviewDate = getDateValue(sop.reviewDate);
    return reviewDate <= Date.now() ? 150 : 60;
  };

  const compareAttentionItems = (left: AttentionItem, right: AttentionItem) => {
    if (left.attentionRank !== right.attentionRank) {
      return left.attentionRank - right.attentionRank;
    }

    if (left.tieWeight !== right.tieWeight) {
      return right.tieWeight - left.tieWeight;
    }

    if (left.sortDate !== right.sortDate) {
      return left.sortDateAscending
        ? left.sortDate - right.sortDate
        : right.sortDate - left.sortDate;
    }

    const titleOrder = left.title.localeCompare(right.title);
    if (titleOrder !== 0) {
      return titleOrder;
    }

    return left.id.localeCompare(right.id);
  };

  const orderAttentionReasons = (reasons: string[]) => {
    const getReasonRank = (reason: string) => {
      if (reason === "BLOCKED") return 1;
      if (reason.startsWith("OVERDUE BY ")) return 2;
      if (reason.includes("SEVERITY")) return 3;
      if (reason.startsWith("REVIEW ")) return 4;
      if (reason === "CRITICAL PRIORITY" || reason === "HIGH PRIORITY") return 5;
      if (reason.startsWith("STRATEGIC FIT:")) return 6;
      return 7;
    };

    return [...reasons].sort((left, right) => {
      const rankDifference = getReasonRank(left) - getReasonRank(right);
      return rankDifference || left.localeCompare(right);
    });
  };

  const getAttentionSummary = (item: AttentionItem) => {
    const blockerReason = item.reasons.find((reason) => reason.startsWith("BLOCKED BY PROBLEM: "));
    if (blockerReason) {
      return `Blocked by unresolved problem: ${blockerReason.slice("BLOCKED BY PROBLEM: ".length)}.`;
    }

    const decisionReason = item.reasons.find((reason) => reason.startsWith("WAITING ON DECISION: "));
    if (decisionReason) {
      return `Waiting on active decision: ${decisionReason.slice("WAITING ON DECISION: ".length)}.`;
    }

    const overdueReason = item.reasons.find((reason) => reason.startsWith("OVERDUE BY "));
    if (overdueReason && item.objectType === "Action") {
      const days = overdueReason.replace("OVERDUE BY ", "").replace(/ DAY(S)?$/, "");
      return `Overdue by ${days} day${days === "1" ? "" : "s"} and still ${item.statusText.split(" /")[0].toLowerCase()}.`;
    }

    if (item.objectType === "Problem" && item.reasons.some((reason) => reason.includes("SEVERITY"))) {
      return `${item.statusText.split(" /")[0]}-severity problem remains unresolved.`;
    }

    if (item.objectType === "Decision" && item.reasons.includes("REVIEW DUE")) {
      return "Decision review date has been reached.";
    }

    if (item.objectType === "Action" && item.reasons.some((reason) => reason.endsWith("PRIORITY"))) {
      return "High-priority action is still active.";
    }

    if (item.objectType === "Opportunity" && item.reasons.some((reason) => reason.startsWith("STRATEGIC FIT:"))) {
      return "High strategic-fit opportunity is still under evaluation.";
    }

    if (item.objectType === "Project") {
      if (item.reasons.includes("BLOCKED PROJECT")) return "Project is currently blocked and requires status review.";
      if (item.reasons.includes("OVERDUE PROJECT")) return "Project target completion date has passed.";
      if (item.reasons.includes("DUE WITHIN 7 DAYS")) return "Project target completion date is approaching.";
      if (item.reasons.includes("PAST START DATE • NOT STARTED")) return "Project start date has passed and work has not started.";
    }

    return `${item.objectType} remains ${item.statusText.split(" /")[0].toLowerCase()}.`;
  };

  const getProjectIssueSummary = (item: AttentionItem) => {
    if (item.objectType !== "Project") {
      return null;
    }

    const overdueReason = item.reasons.find((reason) => /^\d+ DAYS? OVERDUE$/.test(reason));
    const overdueDays = overdueReason?.match(/^\d+/)?.[0];
    return [
      item.reasons.includes("BLOCKED PROJECT") ? "Blocked" : null,
      overdueDays ? `${overdueDays} day${overdueDays === "1" ? "" : "s"} overdue` : null,
      item.reasons.includes("DUE WITHIN 7 DAYS") ? "Due soon" : null,
      item.reasons.includes("PAST START DATE • NOT STARTED") ? "Past start date" : null,
    ].filter(Boolean).join(" • ");
  };

  const getProjectAttentionAge = (item: AttentionItem) => {
    if (item.objectType !== "Project" || !item.targetCompletionDate) {
      return null;
    }

    const targetCompletionDate = new Date(`${item.targetCompletionDate}T00:00:00`);
    if (Number.isNaN(targetCompletionDate.getTime())) {
      return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysFromToday = Math.round((targetCompletionDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (item.reasons.includes("OVERDUE PROJECT") && daysFromToday < 0) {
      const days = Math.abs(daysFromToday);
      return `Overdue for ${days} day${days === 1 ? "" : "s"}`;
    }

    if (item.reasons.includes("DUE WITHIN 7 DAYS") && daysFromToday >= 0) {
      return `Due in ${daysFromToday} day${daysFromToday === 1 ? "" : "s"}`;
    }

    return null;
  };

  const getProjectTargetDateState = (item: AttentionItem) => {
    if (item.objectType !== "Project" || !item.targetCompletionDate) {
      return "No target date";
    }

    const targetCompletionDate = new Date(`${item.targetCompletionDate}T00:00:00`);
    if (Number.isNaN(targetCompletionDate.getTime())) {
      return "No target date";
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysFromToday = Math.round((targetCompletionDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysFromToday < 0) return "Overdue";
    if (daysFromToday === 0) return "Due today";
    if (daysFromToday <= 7) return "Due soon";
    return "Due later";
  };

  const getActionDependencyBlocker = (action: ActionRecord) => {
    const relatedProblem = problemRecords.find((problem) => problem.id === action.relatedProblem);
    if (relatedProblem && isProblemUnresolved(relatedProblem)) {
      return {
        reason: `BLOCKED BY PROBLEM: ${relatedProblem.problemStatement || relatedProblem.title}`,
        label: "Open blocker",
        onOpen: () => {
          setSelectedProblemId(relatedProblem.id);
          setProblemEditor(relatedProblem);
        },
      };
    }

    const relatedDecision = decisionRecords.find((decision) => decision.id === action.relatedDecision);
    if (relatedDecision && isDecisionNotYetActionable(relatedDecision)) {
      return {
        reason: `WAITING ON DECISION: ${relatedDecision.decisionTitle || relatedDecision.title}`,
        label: "Open decision",
        onOpen: () => {
          setSelectedDecisionId(relatedDecision.id);
          setDecisionEditor(relatedDecision);
        },
      };
    }

    return null;
  };

  const buildCommandAttention = (): Record<string, AttentionItem[]> => {
    const groups: Record<string, AttentionItem[]> = {};
    const uniqueByKey = new Map<string, AttentionItem>();

    const addAttentionItem = (groupName: string, item: AttentionItem) => {
      const key = `${item.objectType}:${item.id}`;
      const existing = uniqueByKey.get(key);

      if (existing) {
        const mergedReasons = orderAttentionReasons(Array.from(new Set([...existing.reasons, ...item.reasons])));
        existing.reasons = mergedReasons;
        existing.reason = mergedReasons.join(" • ");

        if (!groups[groupName]) {
          groups[groupName] = [];
        }

        const currentIndex = groups[groupName].findIndex((entry) => entry.id === item.id && entry.objectType === item.objectType);
        if (currentIndex === -1) {
          groups[groupName].push(existing);
        }

        return;
      }

      item.reasons = orderAttentionReasons(item.reasons);
      item.reason = item.reasons.join(" • ");
      uniqueByKey.set(key, item);
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(item);
    };

    const now = Date.now();

    problemRecords.forEach((problem) => {
      const reasons: string[] = [];

      const isUnresolved = isProblemUnresolved(problem);
      const isRecurring = problem.frequency === "Recurring" || problem.frequency === "Persistent";

      if (isUnresolved && isRecurring) {
        reasons.push("RECURRING PROBLEM");
        reasons.push(problem.frequency.toUpperCase());
      }

      if (isUnresolved && ["Critical", "High"].includes(problem.severity)) {
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
          attentionRank: isRecurring ? 2 : problem.severity === "Critical" ? 3 : 4,
          tieWeight: isRecurring ? 3 : problem.severity === "Critical" ? 2 : 1,
          priorityScore: getProblemPriorityScore(problem) + (isRecurring ? 120 : 0),
          sortDate: getDateValue(problem.createdAt),
          sortDateAscending: false,
          onOpen: () => {
            setSelectedProblemId(problem.id);
            setProblemEditor(problem);
          },
        });
      }
    });

    actionRecords.forEach((action) => {
      const reasons: string[] = [];
      const dependencyBlocker = getActionDependencyBlocker(action);

      if (!isActionActive(action)) {
        return;
      }

      if (["Critical", "High"].includes(action.priority)) {
        reasons.push(`${action.priority.toUpperCase()} PRIORITY`);
        reasons.push(action.status.toUpperCase());
      }

      if (action.status === "Blocked") {
        if (!reasons.includes("BLOCKED")) {
          reasons.push("BLOCKED");
        }
      }

      if (dependencyBlocker) {
        reasons.push(dependencyBlocker.reason);
      }

      if (action.dueDate) {
        const dueDate = new Date(action.dueDate);

        if (!Number.isNaN(dueDate.getTime())) {
          const msUntilDue = dueDate.getTime() - now;
          const daysUntilDue = msUntilDue / (1000 * 60 * 60 * 24);

          if (daysUntilDue < 0) {
            reasons.push(`OVERDUE BY ${getDaysOverdue(action.dueDate)} DAY${getDaysOverdue(action.dueDate) === 1 ? "" : "S"}`);
          } else if (daysUntilDue <= 7) {
            reasons.push("DUE WITHIN 7 DAYS");
          }
        }
      }

      const isAlreadyFlagged = reasons.length > 0;
      if (!isAlreadyFlagged && action.status === "In Progress") {
        const referenceTime = getDateValue(action.dueDate) || getDateValue(action.createdDate || action.createdAt);
        if (referenceTime > 0) {
          const daysSinceReference = Math.floor((now - referenceTime) / (1000 * 60 * 60 * 24));
          if (daysSinceReference >= 14) {
            reasons.push("STALE IN-PROGRESS ACTION");
          }
        }
      }

      if (reasons.length > 0) {
        addAttentionItem(reasons[0], {
          id: action.id,
          objectType: "Action",
          title: action.actionTitle || action.title,
          reason: reasons.join(" • "),
          reasons,
          statusText: `${action.status} / ${action.priority} / ${action.dueDate ? formatCapturedAt(action.dueDate) : "No due date"}`,
          area: getAreaText(action),
          attentionRank: action.status === "Blocked" || Boolean(dependencyBlocker) ? 1 : action.dueDate && getDateValue(action.dueDate) < now ? 2 : ["Critical", "High"].includes(action.priority) ? 6 : reasons[0] === "STALE IN-PROGRESS ACTION" ? 7 : 8,
          tieWeight: action.priority === "Critical" ? 2 : action.priority === "High" ? 1 : 0,
          priorityScore: reasons[0] === "STALE IN-PROGRESS ACTION" ? 65 : getActionPriorityScore(action),
          sortDate: getDateValue(action.dueDate || action.createdAt),
          sortDateAscending: Boolean(action.dueDate),
          onOpen: () => {
            setSelectedActionId(action.id);
            setActionEditor(action);
          },
          dependencyAction: dependencyBlocker
            ? { label: dependencyBlocker.label, onOpen: dependencyBlocker.onOpen }
            : undefined,
        });
      }
    });

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfEightDaysFromNow = new Date(startOfToday);
    startOfEightDaysFromNow.setDate(startOfEightDaysFromNow.getDate() + 8);

    projects.forEach((project) => {
      if (!isProjectActive(project)) {
        return;
      }

      const status = project.status.trim().toLowerCase();
      const isBlocked = status === "blocked";
      const isInProgress = status === "in progress";
      const isOpen = status === "open";

      const reasons: string[] = [];
      const targetCompletionDate = project.targetCompletionDate ? new Date(`${project.targetCompletionDate}T00:00:00`) : null;
      const hasTargetCompletionDate = targetCompletionDate && !Number.isNaN(targetCompletionDate.getTime());
      const startDate = project.startDate ? new Date(`${project.startDate}T00:00:00`) : null;
      const hasStartDate = startDate && !Number.isNaN(startDate.getTime());
      const isOverdue = Boolean(isInProgress && hasTargetCompletionDate && targetCompletionDate < startOfToday);
      const isDueSoon = Boolean(isInProgress && hasTargetCompletionDate && targetCompletionDate >= startOfToday && targetCompletionDate < startOfEightDaysFromNow);
      const isPastStartNotStarted = Boolean(isOpen && hasStartDate && startDate < startOfToday);
      const daysOverdue = isOverdue && targetCompletionDate
        ? Math.max(1, Math.floor((startOfToday.getTime() - targetCompletionDate.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

      const referenceDate = getDateValue(project.targetCompletionDate || project.startDate);
      const daysSinceReference = referenceDate ? Math.floor((now - referenceDate) / (1000 * 60 * 60 * 24)) : 0;
      const isStaleActive = Boolean(
        (isOpen || isInProgress) &&
        !isBlocked &&
        !isOverdue &&
        referenceDate > 0 &&
        daysSinceReference >= 21,
      );
      const isStaleApproaching = Boolean(
        isStaleActive &&
        isInProgress &&
        hasTargetCompletionDate &&
        targetCompletionDate &&
        targetCompletionDate >= startOfToday &&
        (targetCompletionDate.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24) <= 14,
      );

      if (isBlocked) {
        reasons.push("BLOCKED PROJECT");
      }
      if (isOverdue) {
        reasons.push("OVERDUE PROJECT");
        reasons.push(`${daysOverdue} DAY${daysOverdue === 1 ? "" : "S"} OVERDUE`);
      }
      if (isDueSoon) {
        reasons.push("DUE WITHIN 7 DAYS");
      }
      if (isPastStartNotStarted) {
        reasons.push("PAST START DATE • NOT STARTED");
      }
      if (isStaleActive) {
        reasons.push(isStaleApproaching ? "STALE PROJECT • TARGET APPROACHING" : "STALE PROJECT");
      }

      if (reasons.length > 0) {
        addAttentionItem(reasons[0], {
          id: project.id,
          objectType: "Project",
          title: project.projectName,
          reason: reasons.join(" • "),
          reasons,
          statusText: `${project.status || "No status"} / ${project.targetCompletionDate ? formatCapturedAt(project.targetCompletionDate) : "No target completion date"}`,
          area: project.area,
          attentionRank: isBlocked ? 1 : isOverdue ? 2 : isDueSoon ? 3 : isStaleActive ? 5 : 4,
          tieWeight: 0,
          priorityScore: isOverdue ? 180 : isDueSoon ? 120 : isStaleActive ? 70 : 60,
          sortDate: getDateValue(project.targetCompletionDate || project.startDate),
          sortDateAscending: Boolean(project.targetCompletionDate),
          targetCompletionDate: project.targetCompletionDate,
          onOpen: () => handleProjectEditOpen(project),
        });
      }
    });

    decisionRecords.forEach((decision) => {
      const reasons: string[] = [];

      if (isDecisionActive(decision) && decision.decisionStatus === "Under Review") {
        reasons.push("Under review");
      }

      if (isDecisionActive(decision) && decision.reviewDate) {
        const reviewDate = new Date(decision.reviewDate);

        if (!Number.isNaN(reviewDate.getTime()) && reviewDate.getTime() <= now) {
          reasons.push("REVIEW DUE");
        }
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
          priorityScore: getDecisionPriorityScore(decision),
          sortDate: getDateValue(decision.reviewDate || decision.createdAt),
          sortDateAscending: Boolean(decision.reviewDate),
          onOpen: () => {
            setSelectedDecisionId(decision.id);
            setDecisionEditor(decision);
          },
        });
      }
    });

    opportunityRecords.forEach((opportunity) => {
      const reasons: string[] = [];

      if (isOpportunityUnderEvaluation(opportunity)) {
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
          onOpen: () => {
            setSelectedOpportunityId(opportunity.id);
            setOpportunityEditor(opportunity);
          },
        });
      }
    });

    lessonRecords.forEach((lesson) => {
      if (lesson.status === "Change Required") {
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
          onOpen: () => {
            setSelectedLessonId(lesson.id);
            setLessonEditor(lesson);
          },
        });
      }
    });

    systemRecords.forEach((system) => {
      if (system.status === "Reviewing") {
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
          onOpen: () => {
            setSelectedSystemId(system.id);
            setSystemEditor(system);
          },
        });
      }
    });

    sopRecords.forEach((sop) => {
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
            priorityScore: getSopPriorityScore(sop),
            sortDate: getDateValue(sop.reviewDate || sop.createdAt),
            sortDateAscending: Boolean(sop.reviewDate),
            onOpen: () => {
              setSelectedSopId(sop.id);
              setSopEditor(sop);
            },
          });
        }
      }
    });

    return groups;
  };

  const commandAttention = buildCommandAttention();
  const sortedCommandAttention = Object.fromEntries(
    Object.entries(commandAttention).map(([reason, items]) => [
      reason,
      [...items].sort(compareAttentionItems),
    ]),
  ) as Record<string, AttentionItem[]>;
  const commandAttentionItemList = Array.from(
    new Map(
      Object.values(sortedCommandAttention)
        .flat()
        .map((item) => [`${item.objectType}:${item.id}`, item]),
    ).values(),
  ).sort(compareAttentionItems);

  const staleRecords = commandAttentionItemList.filter((item) =>
    item.reasons.some((reason) => reason === "STALE PROJECT" || reason === "STALE PROJECT • TARGET APPROACHING" || reason === "STALE IN-PROGRESS ACTION"),
  );

  const correlationLayer = (() => {
    type SignalledRecord = {
      recordKey: string;
      objectType: string;
      id: string;
      title: string;
      area: string;
      signals: Set<string>;
      baseScore: number;
    };

    const signalled = new Map<string, SignalledRecord>();
    const addSignal = (recordKey: string, objectType: string, id: string, title: string, area: string, signal: string, baseScore: number) => {
      const existing = signalled.get(recordKey);
      if (existing) {
        existing.signals.add(signal);
        existing.baseScore = Math.max(existing.baseScore, baseScore);
      } else {
        signalled.set(recordKey, { recordKey, objectType, id, title, area, signals: new Set([signal]), baseScore });
      }
    };

    empireDecisionQueue.founderAuthorityItems.forEach((item) =>
      addSignal(`${item.objectType}:${item.id}`, item.objectType, item.id, item.title, item.pillar, "founder authority", 400));

    commandAttentionItemList
      .filter((item) => item.reasons.some((reason) => reason === "BLOCKED PROJECT" || reason === "BLOCKED" || reason.startsWith("BLOCKED BY PROBLEM:")))
      .forEach((item) => addSignal(`${item.objectType}:${item.id}`, item.objectType, item.id, item.title, item.area, "blocked", 360 + item.priorityScore));

    commandAttentionItemList
      .filter((item) => item.reasons.some((reason) => reason.startsWith("OVERDUE")))
      .forEach((item) => addSignal(`${item.objectType}:${item.id}`, item.objectType, item.id, item.title, item.area, "overdue", 200 + item.priorityScore));

    decisionTrackRecord.reviewsDue.forEach((decision) =>
      addSignal(`Decision:${decision.id}`, "Decision", decision.id, decision.decisionTitle || decision.title, getAreaText(decision) || "Unassigned", "review due", 300));

    decisionsWithoutExecution.forEach((decision) =>
      addSignal(`Decision:${decision.id}`, "Decision", decision.id, decision.title, decision.area, "no execution path", 280));

    recurringProblemLearning.gaps.forEach((problem) =>
      addSignal(`Problem:${problem.id}`, "Problem", problem.id, problem.title, problem.area, "learning not captured", 240));

    staleUnownedWork.forEach((item) =>
      addSignal(item.key, item.objectType, item.id, item.title, item.area, "no valid owner", item.score));

    staleRecords.forEach((item) =>
      addSignal(`${item.objectType}:${item.id}`, item.objectType, item.id, item.title, item.area, "stale record", 230));

    growthAttention.stalledOpportunities.forEach((item) =>
      addSignal(`Opportunity:${item.id}`, "Opportunity", item.id, item.title, item.area, "opportunity stalled", item.strategicFit === "Exceptional" ? 290 : 250));

    growthAttention.stalledLeads.forEach((item) =>
      addSignal(`Lead:${item.id}`, "Lead", item.id, item.title, item.area, "lead stalled", item.quoteValue >= 1000 ? 240 : 180));

    if (cashAttention.buffer) {
      addSignal("Finance:cash-buffer", "Finance", "cash-buffer", cashAttention.buffer.title, "Finance", "cash buffer pressure", cashAttention.buffer.severity === "critical" ? 380 : 300);
    }
    cashAttention.overdueCommitments.forEach((item) =>
      addSignal(`Finance:commitment:${item.id}`, "Finance", `commitment:${item.id}`, item.title, "Finance", "overdue commitment", 310));
    cashAttention.overdueExpectedIncome.forEach((item) =>
      addSignal(`Finance:income:${item.id}`, "Finance", `income:${item.id}`, item.title, "Finance", "expected income overdue", 260));

    const recordById = (key: string) => {
      const [objectType, ...rest] = key.split(":");
      const id = rest.join(":");
      return { objectType, id };
    };

    const adjacency = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      if (a === b) return;
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a)!.add(b);
      adjacency.get(b)!.add(a);
    };

    actionRecords.forEach((action) => {
      if (action.relatedProblem) link(`Action:${action.id}`, `Problem:${action.relatedProblem}`);
      if (action.relatedDecision) link(`Action:${action.id}`, `Decision:${action.relatedDecision}`);
      if (action.relatedOpportunity) link(`Action:${action.id}`, `Opportunity:${action.relatedOpportunity}`);
    });
    decisionRecords.forEach((decision) => {
      if (decision.relatedOpportunity) link(`Decision:${decision.id}`, `Opportunity:${decision.relatedOpportunity}`);
    });
    lessonRecords.forEach((lesson) => {
      if (lesson.relatedProblem) link(`Lesson:${lesson.id}`, `Problem:${lesson.relatedProblem}`);
      if (lesson.relatedDecision) link(`Lesson:${lesson.id}`, `Decision:${lesson.relatedDecision}`);
      if (lesson.relatedProject) link(`Lesson:${lesson.id}`, `Project:${lesson.relatedProject}`);
    });
    projects.forEach((project) => {
      (project.relatedActionIds || []).forEach((actionId) => link(`Project:${project.id}`, `Action:${actionId}`));
      (project.relatedDecisionIds || []).forEach((decisionId) => link(`Project:${project.id}`, `Decision:${decisionId}`));
    });

    const visited = new Set<string>();
    const clusters: Array<{
      clusterKey: string;
      title: string;
      records: SignalledRecord[];
      categories: Set<string>;
      recordCount: number;
      topScore: number;
    }> = [];

    signalled.forEach((record, recordKey) => {
      if (visited.has(recordKey)) return;

      const component: SignalledRecord[] = [];
      const queue = [recordKey];
      visited.add(recordKey);

      while (queue.length > 0) {
        const current = queue.pop()!;
        const currentRecord = signalled.get(current);
        if (currentRecord) {
          component.push(currentRecord);
        }
        const neighbours = adjacency.get(current);
        if (neighbours) {
          neighbours.forEach((neighbour) => {
            if (!visited.has(neighbour) && signalled.has(neighbour)) {
              visited.add(neighbour);
              queue.push(neighbour);
            }
          });
        }
      }

      const categories = new Set<string>();
      component.forEach((item) => item.signals.forEach((signal) => categories.add(signal)));

      const root = component.reduce((best, item) => (item.baseScore > best.baseScore ? item : best), component[0]);

      clusters.push({
        clusterKey: `cluster:${root.recordKey}`,
        title: root.title,
        records: component,
        categories,
        recordCount: component.length,
        topScore: root.baseScore,
      });
    });

    const convergentRisks = clusters
      .filter((cluster) => cluster.categories.size >= 3 && cluster.recordCount >= 2)
      .sort((a, b) => b.categories.size - a.categories.size || b.recordCount - a.recordCount || b.topScore - a.topScore);

    const clusterByRecordKey = new Map<string, (typeof clusters)[number]>();
    clusters.forEach((cluster) => {
      cluster.records.forEach((record) => clusterByRecordKey.set(record.recordKey, cluster));
    });

    return { signalled, clusters, convergentRisks, clusterByRecordKey };
  })();

  const founderFocusList = (() => {
    type FocusCandidate = {
      key: string;
      objectType: string;
      id: string;
      title: string;
      area: string;
      score: number;
      tier: number;
      reason: string;
    };

    const recordsInConvergentClusters = new Set<string>();
    correlationLayer.convergentRisks.forEach((cluster) => {
      cluster.records.forEach((record) => recordsInConvergentClusters.add(record.recordKey));
    });

    const candidates: FocusCandidate[] = [];

    correlationLayer.convergentRisks.forEach((cluster) => {
      const root = cluster.records.reduce((best, item) => (item.baseScore > best.baseScore ? item : best), cluster.records[0]);
      const categoryList = [...cluster.categories].join(", ");
      candidates.push({
        key: cluster.clusterKey,
        objectType: root.objectType,
        id: root.id,
        title: cluster.title,
        area: root.area,
        score: 420 + cluster.categories.size * 10 + cluster.recordCount,
        tier: 1,
        reason: `Convergent risk — one situation is generating ${cluster.categories.size} kinds of signal (${categoryList}) across ${cluster.recordCount} linked records, so it is systemic rather than isolated.`,
      });
    });

    correlationLayer.signalled.forEach((record, recordKey) => {
      if (recordsInConvergentClusters.has(recordKey)) {
        return;
      }

      const signalList = [...record.signals];
      const combinedReason = signalList.length > 1
        ? `Needs attention for ${signalList.length} reasons: ${signalList.join(", ")}.`
        : `Needs attention: ${signalList[0]}.`;

      candidates.push({
        key: recordKey,
        objectType: record.objectType,
        id: record.id,
        title: record.title,
        area: record.area,
        score: record.baseScore + (signalList.length - 1) * 40,
        tier: record.baseScore >= 360 ? 1 : record.baseScore >= 240 ? 2 : 3,
        reason: combinedReason,
      });
    });

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  })();

  const todayBrief = (() => {
    const authorityCount = empireDecisionQueue.founderAuthorityItems.length;
    const reviewDueCount = decisionTrackRecord.reviewsDue.length;
    const ownershipGapCount = unassignedAccountability.ownedActions.length
      + unassignedAccountability.activeProjects.length
      + unassignedAccountability.pipelineLeads.length
      + unassignedAccountability.unresolvedProblems.length;
    const learningGapCount = recurringProblemLearning.gaps.length;
    const executionGapCount = decisionsWithoutExecution.length;
    const focusCount = founderFocusList.length;
    const delegationGapCount = unassignedAccountability.carriedCount;
    const financeCount = cashAttention.count;

    const postureParts: string[] = [];
    if (authorityCount > 0) postureParts.push(`${authorityCount} need${authorityCount === 1 ? "s" : ""} your authority`);
    if (reviewDueCount > 0) postureParts.push(`${reviewDueCount} decision review${reviewDueCount === 1 ? "" : "s"} overdue`);
    if (ownershipGapCount > 0) postureParts.push(`${ownershipGapCount} ownership gap${ownershipGapCount === 1 ? "" : "s"}`);
    if (learningGapCount > 0) postureParts.push(`${learningGapCount} recurring problem${learningGapCount === 1 ? "" : "s"} not yet captured as learning`);
    if (executionGapCount > 0) postureParts.push(`${executionGapCount} decision${executionGapCount === 1 ? "" : "s"} without an execution path`);
    if (cashAttention.buffer) postureParts.push("cash buffer pressure");
    if (cashAttention.overdueCommitments.length > 0) postureParts.push(`${cashAttention.overdueCommitments.length} overdue commitment${cashAttention.overdueCommitments.length === 1 ? "" : "s"}`);
    if (cashAttention.overdueExpectedIncome.length > 0) postureParts.push(`${cashAttention.overdueExpectedIncome.length} expected income overdue`);

    const posture = postureParts.length > 0
      ? postureParts.join(" • ")
      : "Nothing needs founder authority, review, ownership triage, learning capture or cash attention right now.";

    const steps = [
      {
        label: "Clear founder focus",
        count: focusCount,
        hint: "Work the ranked top items first.",
      },
      {
        label: "Fix ownership gaps",
        count: delegationGapCount,
        hint: "Assign a valid active owner to dropped or ghost-owned work.",
      },
      {
        label: "Complete decision reviews",
        count: reviewDueCount,
        hint: "Record outcomes and ratings so decisions stop drifting.",
      },
      {
        label: "Restore execution paths",
        count: executionGapCount,
        hint: "Give each active decision an open linked action.",
      },
      {
        label: "Close recurring-learning gaps",
        count: learningGapCount,
        hint: "Turn repeat problems into a lesson, system or SOP.",
      },
      {
        label: "Clear cash attention",
        count: financeCount,
        hint: "Address cash buffer pressure, overdue commitments and overdue expected income.",
      },
    ];

    const peopleWithAttention = personAccountabilitySummaries.filter((entry) => entry.attentionCount > 0);

    const delegation = delegationGapCount === 0
      ? "Delegation hygiene is clear — every active work item has a valid active owner."
      : `${delegationGapCount} active item${delegationGapCount === 1 ? "" : "s"} lack${delegationGapCount === 1 ? "s" : ""} a valid active owner. ${peopleWithAttention.length} ${peopleWithAttention.length === 1 ? "person is" : "people are"} carrying attention items.`;

    const staleCount = staleRecords.length;
    const freshness = staleCount === 0
      ? "The operating picture looks current — no stale active records detected."
      : `${staleCount} active record${staleCount === 1 ? "" : "s"} may be stale — the operating picture needs review.`;

    const growthParts: string[] = [];
    if (growthAttention.stalledOpportunities.length > 0) growthParts.push(`${growthAttention.stalledOpportunities.length} high-fit opportunit${growthAttention.stalledOpportunities.length === 1 ? "y" : "ies"} idle`);
    if (growthAttention.stalledLeads.length > 0) growthParts.push(`${growthAttention.stalledLeads.length} lead${growthAttention.stalledLeads.length === 1 ? "" : "s"} stalled`);
    if (growthAttention.stalledQuoteValue > 0) growthParts.push(`${formatFinanceAmount(growthAttention.stalledQuoteValue)} in quotes awaiting movement`);
    const growth = growthParts.length > 0
      ? growthParts.join(" • ")
      : "Growth pipeline is moving — no stalled high-fit opportunities or leads.";
    const growthIsClear = growthParts.length === 0;

    const outstandingRecordKeys = new Set<string>();
    empireDecisionQueue.founderAuthorityItems.forEach((item) => outstandingRecordKeys.add(`${item.objectType}:${item.id}`));
    decisionTrackRecord.reviewsDue.forEach((decision) => outstandingRecordKeys.add(`Decision:${decision.id}`));
    unassignedAccountability.ownedActions.forEach((action) => outstandingRecordKeys.add(`Action:${action.id}`));
    unassignedAccountability.activeProjects.forEach((project) => outstandingRecordKeys.add(`Project:${project.id}`));
    unassignedAccountability.pipelineLeads.forEach((lead) => outstandingRecordKeys.add(`Lead:${lead.id}`));
    unassignedAccountability.unresolvedProblems.forEach((problem) => outstandingRecordKeys.add(`Problem:${problem.id}`));
    decisionsWithoutExecution.forEach((decision) => outstandingRecordKeys.add(`Decision:${decision.id}`));
    recurringProblemLearning.gaps.forEach((problem) => outstandingRecordKeys.add(`Problem:${problem.id}`));
    staleRecords.forEach((item) => outstandingRecordKeys.add(`${item.objectType}:${item.id}`));
    if (cashAttention.buffer) outstandingRecordKeys.add("Finance:cash-buffer");
    cashAttention.overdueCommitments.forEach((item) => outstandingRecordKeys.add(`Finance:commitment:${item.id}`));
    cashAttention.overdueExpectedIncome.forEach((item) => outstandingRecordKeys.add(`Finance:income:${item.id}`));
    growthAttention.stalledOpportunities.forEach((item) => outstandingRecordKeys.add(`Opportunity:${item.id}`));
    growthAttention.stalledLeads.forEach((item) => outstandingRecordKeys.add(`Lead:${item.id}`));
    const outstandingCount = outstandingRecordKeys.size;

    const outstandingSituationCount = correlationLayer.clusters.filter((cluster) =>
      cluster.records.some((record) => outstandingRecordKeys.has(record.recordKey)),
    ).length;

    const outstandingKeys = [...outstandingRecordKeys].map((key) => {
      const signalled = correlationLayer.signalled.get(key);
      const separatorIndex = key.indexOf(":");
      const objectType = separatorIndex >= 0 ? key.slice(0, separatorIndex) : key;
      return {
        key,
        title: signalled?.title || key,
        objectType: signalled?.objectType || objectType,
        category: signalled ? [...signalled.signals].join(", ") : "attention",
      };
    });

    return {
      posture,
      postureIsClear: postureParts.length === 0,
      steps,
      delegation,
      delegationIsClear: delegationGapCount === 0,
      freshness,
      freshnessIsClear: staleCount === 0,
      growth,
      growthIsClear,
      outstandingCount,
      outstandingSituationCount,
      outstandingKeys,
      authorityCount,
      reviewDueCount,
      ownershipGapCount,
      learningGapCount,
      executionGapCount,
      staleCount,
      financeCount,
      growthStallCount: growthAttention.count,
    };
  })();

  const deskIsClear = founderFocusList.length === 0 && todayBrief.outstandingCount === 0;

  const attentionSnapshot: Record<string, string> = {};

  empireDecisionQueue.founderAuthorityItems.forEach((item) => {
    attentionSnapshot[`authority:${item.objectType}:${item.id}`] = "Founder authority";
  });
  decisionTrackRecord.reviewsDue.forEach((decision) => {
    attentionSnapshot[`review:Decision:${decision.id}`] = "Decision review";
  });
  const ownershipRecordKeys = new Set<string>();
  unassignedAccountability.ownedActions.forEach((action) => {
    attentionSnapshot[`ownership:Action:${action.id}`] = "Ownership gap";
    ownershipRecordKeys.add(`Action:${action.id}`);
  });
  unassignedAccountability.activeProjects.forEach((project) => {
    attentionSnapshot[`ownership:Project:${project.id}`] = "Ownership gap";
    ownershipRecordKeys.add(`Project:${project.id}`);
  });
  unassignedAccountability.pipelineLeads.forEach((lead) => {
    attentionSnapshot[`ownership:Lead:${lead.id}`] = "Ownership gap";
    ownershipRecordKeys.add(`Lead:${lead.id}`);
  });
  unassignedAccountability.unresolvedProblems.forEach((problem) => {
    attentionSnapshot[`ownership:Problem:${problem.id}`] = "Ownership gap";
    ownershipRecordKeys.add(`Problem:${problem.id}`);
  });
  decisionsWithoutExecution.forEach((decision) => {
    attentionSnapshot[`execution:Decision:${decision.id}`] = "Execution gap";
  });
  recurringProblemLearning.gaps.forEach((problem) => {
    attentionSnapshot[`learning:Problem:${problem.id}`] = "Recurring-learning gap";
  });
  staleRecords.forEach((item) => {
    const recordKey = `${item.objectType}:${item.id}`;
    if (ownershipRecordKeys.has(recordKey)) {
      return;
    }
    attentionSnapshot[`stale:${item.objectType}:${item.id}`] = "Stale record";
  });
  if (cashAttention.buffer) {
    attentionSnapshot["finance:cash-buffer"] = "Finance attention";
  }
  cashAttention.overdueCommitments.forEach((item) => {
    attentionSnapshot[`finance:commitment:${item.id}`] = "Finance attention";
  });
  cashAttention.overdueExpectedIncome.forEach((item) => {
    attentionSnapshot[`finance:income:${item.id}`] = "Finance attention";
  });
  growthAttention.stalledOpportunities.forEach((item) => {
    attentionSnapshot[`growth:Opportunity:${item.id}`] = "Growth";
  });
  growthAttention.stalledLeads.forEach((item) => {
    if (ownershipRecordKeys.has(`Lead:${item.id}`)) {
      return;
    }
    attentionSnapshot[`growth:Lead:${item.id}`] = "Growth";
  });

  const [clearedThisSession, setClearedThisSession] = useState<{ total: number; byCategory: Record<string, number> }>({ total: 0, byCategory: {} });
  const previousAttentionSnapshotRef = useRef<Record<string, string> | null>(null);
  const clearedKeysRef = useRef<Set<string>>(new Set());

  const attentionSnapshotJson = JSON.stringify(attentionSnapshot);

  useEffect(() => {
    const currentSnapshot = JSON.parse(attentionSnapshotJson) as Record<string, string>;
    const currentKeys = new Set(Object.keys(currentSnapshot));

    if (previousAttentionSnapshotRef.current === null) {
      previousAttentionSnapshotRef.current = currentSnapshot;
      return;
    }

    const previousSnapshot = previousAttentionSnapshotRef.current;
    const previousKeys = new Set(Object.keys(previousSnapshot));
    const newlyCleared: Array<{ key: string; category: string }> = [];

    previousKeys.forEach((key) => {
      if (!currentKeys.has(key) && !clearedKeysRef.current.has(key)) {
        newlyCleared.push({ key, category: previousSnapshot[key] || "Founder authority" });
      }
    });

    if (newlyCleared.length > 0) {
      setClearedThisSession((current) => {
        const byCategory = { ...current.byCategory };
        newlyCleared.forEach(({ key, category }) => {
          clearedKeysRef.current.add(key);
          byCategory[category] = (byCategory[category] || 0) + 1;
        });
        return { total: current.total + newlyCleared.length, byCategory };
      });
    }

    previousAttentionSnapshotRef.current = currentSnapshot;
  }, [attentionSnapshotJson]);

  const clearedCategoryBreakdown = Object.entries(clearedThisSession.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `${count} ${category.toLowerCase()}`)
    .join(" • ");

  const todayProgressText = clearedThisSession.total === 0 && todayBrief.outstandingCount === 0
    ? "Nothing on the desk."
    : `Today: ${clearedThisSession.total} cleared • ${todayBrief.outstandingSituationCount} situation${todayBrief.outstandingSituationCount === 1 ? "" : "s"} outstanding${todayBrief.outstandingSituationCount !== todayBrief.outstandingCount ? ` across ${todayBrief.outstandingCount} records` : ""}${clearedCategoryBreakdown ? ` (${clearedCategoryBreakdown})` : ""}`;

  const todaySnapshotDate = new Date().toISOString().slice(0, 10);
  const cashIsConfigured = cashPosition.currentCash.trim() !== "" || cashPosition.safetyBuffer.trim() !== "";
  const todaySnapshot: DailyPostureSnapshot = {
    date: todaySnapshotDate,
    focusCount: founderFocusList.length,
    ownershipGapCount: todayBrief.ownershipGapCount,
    decisionReviewsDue: todayBrief.reviewDueCount,
    executionGapCount: todayBrief.executionGapCount,
    learningGapCount: todayBrief.learningGapCount,
    staleRecordCount: todayBrief.staleCount,
    financeAttentionCount: todayBrief.financeCount,
    growthStallCount: todayBrief.growthStallCount,
    outstandingCount: todayBrief.outstandingCount,
    availableOperatingCash: cashIsConfigured ? availableOperatingCash : null,
    delegationQualityPct: organisationalHealth.delegationScore,
    avgOpenDecisionDays: organisationalHealth.avgOpenDecisionDays,
    selfSufficiencyPct: organisationalHealth.selfSufficiencyPct,
    outstandingKeys: todayBrief.outstandingKeys,
  };

  const todaySnapshotJson = JSON.stringify(todaySnapshot);
  const snapshotsLoadedRef = useRef(false);

  useEffect(() => {
    if (!snapshotsLoadedRef.current) {
      snapshotsLoadedRef.current = true;
      return;
    }

    setDailyPostureSnapshots((current) => {
      const existingTodayIndex = current.findIndex((entry) => entry.date === todaySnapshotDate);

      if (existingTodayIndex >= 0) {
        const existing = current[existingTodayIndex];
        if (JSON.stringify(existing) === todaySnapshotJson) {
          return current;
        }
        const next = [...current];
        next[existingTodayIndex] = todaySnapshot;
        window.localStorage.setItem(DAILY_POSTURE_SNAPSHOTS_STORAGE_KEY, JSON.stringify(next));
        return next;
      }

      const next = [...current, todaySnapshot].sort((a, b) => a.date.localeCompare(b.date));
      window.localStorage.setItem(DAILY_POSTURE_SNAPSHOTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [todaySnapshotJson, todaySnapshotDate]);

  const previousDaySnapshot = (() => {
    const earlier = dailyPostureSnapshots
      .filter((entry) => entry.date < todaySnapshotDate)
      .sort((a, b) => b.date.localeCompare(a.date));
    return earlier[0] || null;
  })();

  const healthTrend = (() => {
    if (!previousDaySnapshot) {
      return { delegation: null as string | null, latency: null as string | null, selfSufficiency: null as string | null };
    }

    const trendText = (current: number | null, previous: number | null | undefined, lowerIsBetter: boolean, unit: string) => {
      if (current === null || previous === null || previous === undefined || current === previous) {
        return null;
      }
      const improved = lowerIsBetter ? current < previous : current > previous;
      return `${current}${unit} ${improved ? "↑" : "↓"} vs ${previous}${unit} ${improved ? "(improving)" : "(worsening)"}`;
    };

    return {
      delegation: trendText(organisationalHealth.delegationScore, previousDaySnapshot.delegationQualityPct, false, ""),
      latency: trendText(organisationalHealth.avgOpenDecisionDays, previousDaySnapshot.avgOpenDecisionDays, true, "d"),
      selfSufficiency: trendText(organisationalHealth.selfSufficiencyPct, previousDaySnapshot.selfSufficiencyPct, false, "%"),
    };
  })();

  const postureChange = (() => {
    const currentKeys = new Map(todayBrief.outstandingKeys.map((item) => [item.key, item]));
    const previousKeys = new Map((previousDaySnapshot?.outstandingKeys || []).map((item) => [item.key, item]));

    const resolveTitle = (key: string, item?: { title: string; objectType: string; category: string }) => {
      if (item?.title && item.title !== key) {
        return item;
      }
      const signalled = correlationLayer.signalled.get(key);
      if (signalled) {
        return { title: signalled.title, objectType: signalled.objectType, category: [...signalled.signals].join(", ") };
      }

      const keyParts = key.split(":");
      const objectTypes = ["Action", "Decision", "Problem", "Opportunity", "Project", "Lead", "Lesson"];
      const objectTypeIndex = keyParts.findIndex((part) => objectTypes.includes(part));
      const objectType = objectTypeIndex >= 0 ? keyParts[objectTypeIndex] : item?.objectType || "Record";
      const recordId = objectTypeIndex >= 0 ? keyParts.slice(objectTypeIndex + 1).join(":") : "";
      const recordTitle = objectType === "Action"
        ? actionRecords.find((record) => record.id === recordId)?.actionTitle
        : objectType === "Decision"
          ? decisionRecords.find((record) => record.id === recordId)?.decisionTitle
          : objectType === "Problem"
            ? problemRecords.find((record) => record.id === recordId)?.problemStatement
            : objectType === "Opportunity"
              ? opportunityRecords.find((record) => record.id === recordId)?.opportunityTitle
              : objectType === "Project"
                ? projects.find((record) => record.id === recordId)?.projectName
                : objectType === "Lead"
                  ? leads.find((record) => record.id === recordId)?.leadName
                  : objectType === "Lesson"
                    ? lessonRecords.find((record) => record.id === recordId)?.lessonTitle
                    : undefined;

      return {
        title: recordTitle || `Resolved ${objectType.toLowerCase()} attention`,
        objectType,
        category: item?.category || "attention",
      };
    };

    const newSincePrevious = [...currentKeys.entries()]
      .filter(([key]) => !previousKeys.has(key))
      .map(([key, item]) => ({ key, ...resolveTitle(key, item) }));

    const resolvedSincePrevious = [...previousKeys.keys()]
      .filter((key) => !currentKeys.has(key))
      .map((key) => ({ key, ...resolveTitle(key, previousKeys.get(key)) }));

    const movedAgainst: Array<{ label: string; text: string }> = [];
    if (previousDaySnapshot) {
      const worsened = (label: string, currentValue: number, previousValue: number) => {
        if (currentValue > previousValue) {
          movedAgainst.push({ label, text: `${previousValue} → ${currentValue}` });
        }
      };
      worsened("Ownership gaps", todayBrief.ownershipGapCount, previousDaySnapshot.ownershipGapCount);
      worsened("Decision reviews", todayBrief.reviewDueCount, previousDaySnapshot.decisionReviewsDue);
      worsened("Execution gaps", todayBrief.executionGapCount, previousDaySnapshot.executionGapCount);
      worsened("Learning gaps", todayBrief.learningGapCount, previousDaySnapshot.learningGapCount);
      worsened("Stale records", todayBrief.staleCount, previousDaySnapshot.staleRecordCount);
      worsened("Finance attention", todayBrief.financeCount, previousDaySnapshot.financeAttentionCount);
      worsened("Growth stalls", todayBrief.growthStallCount, previousDaySnapshot.growthStallCount);

      if (todaySnapshot.availableOperatingCash !== null && previousDaySnapshot.availableOperatingCash !== null && todaySnapshot.availableOperatingCash < previousDaySnapshot.availableOperatingCash) {
        movedAgainst.push({ label: "Operating cash", text: `${formatFinanceAmount(previousDaySnapshot.availableOperatingCash)} → ${formatFinanceAmount(todaySnapshot.availableOperatingCash)}` });
      }
    }

    return {
      hasBaseline: previousDaySnapshot !== null,
      newSincePrevious,
      movedAgainst,
      resolvedSincePrevious,
    };
  })();

  const trendItems = (() => {
    if (!previousDaySnapshot) {
      return [] as Array<{ label: string; text: string; direction: "up" | "down" | "flat" }>;
    }

    const gapItem = (label: string, currentValue: number, previousValue: number) => {
      if (currentValue === previousValue) {
        return { label, text: `${currentValue} → unchanged`, direction: "flat" as const };
      }
      const improved = currentValue < previousValue;
      return {
        label,
        text: `${currentValue} ${improved ? "↓" : "↑"} from ${previousValue}`,
        direction: improved ? ("down" as const) : ("up" as const),
      };
    };

    const items = [
      gapItem("Ownership gaps", todayBrief.ownershipGapCount, previousDaySnapshot.ownershipGapCount),
      gapItem("Decision reviews", todayBrief.reviewDueCount, previousDaySnapshot.decisionReviewsDue),
      gapItem("Execution gaps", todayBrief.executionGapCount, previousDaySnapshot.executionGapCount),
      gapItem("Learning gaps", todayBrief.learningGapCount, previousDaySnapshot.learningGapCount),
      gapItem("Stale records", todayBrief.staleCount, previousDaySnapshot.staleRecordCount),
      gapItem("Finance attention", todayBrief.financeCount, previousDaySnapshot.financeAttentionCount),
      gapItem("Growth stalls", todayBrief.growthStallCount, previousDaySnapshot.growthStallCount),
    ];

    if (todaySnapshot.availableOperatingCash !== null && previousDaySnapshot.availableOperatingCash !== null) {
      const currentCash = todaySnapshot.availableOperatingCash;
      const previousCash = previousDaySnapshot.availableOperatingCash;
      if (currentCash === previousCash) {
        items.push({ label: "Operating cash", text: `${formatFinanceAmount(currentCash)} → unchanged`, direction: "flat" });
      } else {
        const improved = currentCash > previousCash;
        items.push({
          label: "Operating cash",
          text: `${formatFinanceAmount(currentCash)} ${improved ? "↑" : "↓"} from ${formatFinanceAmount(previousCash)}`,
          direction: improved ? "up" : "down",
        });
      }
    }

    return items;
  })();

  const sevenDayShape = (() => {
    const recent = [...dailyPostureSnapshots]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-7);
    if (recent.length === 0) {
      return "";
    }
    return recent.map((entry) => entry.outstandingCount).join(" → ");
  })();

  const getAttentionGroup = (item: AttentionItem) => {
    const isBlockedOrWaiting = item.reasons.some((reason) =>
      reason === "BLOCKED PROJECT" || (item.objectType !== "Project" && reason === "BLOCKED") || reason.startsWith("BLOCKED BY PROBLEM:") || reason.startsWith("WAITING ON DECISION:"),
    );

    if (isBlockedOrWaiting) {
      return "Blocked / Waiting";
    }

    if ((item.objectType === "Action" && item.reasons.some((reason) => reason.startsWith("OVERDUE BY "))) || (item.objectType === "Project" && item.reasons.includes("OVERDUE PROJECT"))) {
      return "Urgent / Overdue";
    }

    if (item.objectType === "Problem" && item.reasons.some((reason) => reason.includes("SEVERITY")) && item.attentionRank === 3) {
      return "Urgent / Overdue";
    }

    if (item.objectType === "Decision" && item.reasons.includes("REVIEW DUE")) {
      return "Urgent / Overdue";
    }

    if (item.objectType === "Problem") {
      return "Problems";
    }

    if (item.objectType === "Action") {
      return "Actions";
    }

    if (item.objectType === "Project") {
      return "Projects";
    }

    if (item.objectType === "Opportunity") {
      return "Opportunities";
    }

    return "Other Attention";
  };
  const commandAttentionGroups = ["Blocked / Waiting", "Urgent / Overdue", "Problems", "Actions", "Projects", "Opportunities", "Other Attention"]
    .map((label) => ({
      label,
      items: commandAttentionItemList.filter((item) => getAttentionGroup(item) === label),
    }))
    .filter((group) => group.items.length > 0);
  const commandAttentionItems = commandAttentionItemList.length;
  const executiveAttentionRecordKeys = new Set(todayBrief.outstandingKeys.map((item) => item.key));
  const executiveAttentionItems = todayBrief.outstandingCount;
  const projectAttentionCount = new Set(
    commandAttentionGroups.flatMap((group) => group.items)
      .filter((item) => item.objectType === "Project")
      .map((item) => item.id),
  ).size;
  const attentionSummaryItems = commandAttentionGroups
    .map((group) => ({
      label: group.label,
      count: group.items.filter((item) => executiveAttentionRecordKeys.has(`${item.objectType}:${item.id}`)).length,
    }))
    .filter((group) => group.count > 0);
  const getAttentionSummaryLabel = (label: string, count: number) => {
    if (count !== 1) {
      return label;
    }

    return label
      .replace("Blocked / Waiting", "Blocked / Waiting item")
      .replace("Problems", "Problem")
      .replace("Actions", "Action")
      .replace("Projects", "Project")
      .replace("Opportunities", "Opportunity")
      .replace("Decisions", "Decision")
      .replace("Other Attention", "Other attention item");
  };
  const overdueActionCount = actionRecords.filter((action) => {
    if (!isActionActive(action) || !action.dueDate) {
      return false;
    }

    const dueDate = new Date(action.dueDate);
    return !Number.isNaN(dueDate.getTime()) && dueDate.getTime() < Date.now();
  }).length;
  const decisionsDueForReviewCount = decisionRecords.filter((decision) => {
    if (!isDecisionActive(decision) || !decision.reviewDate) {
      return false;
    }

    const reviewDate = new Date(decision.reviewDate);
    return !Number.isNaN(reviewDate.getTime()) && reviewDate.getTime() <= Date.now();
  }).length;
  const criticalHighProblemCount = problemRecords.filter((problem) =>
    isProblemUnresolved(problem) &&
    (problem.severity === "Critical" || problem.severity === "High"),
  ).length;

  const commandRecordGroups: CommandRecordGroup[] = [
    {
      label: "Problems",
      records: problemRecords.map((problem) => ({
        id: problem.id,
        objectType: "Problem",
        title: problem.problemStatement || problem.title,
        searchText: `${problem.problemStatement || problem.title} ${problem.impact} ${problem.rootCause}`,
        createdAt: problem.createdAt,
        operationalDate: "",
        owner: problem.owner || "Unassigned",
        status: problem.problemStatus,
        area: getAreaText(problem),
        sourceCaptureId: problem.sourceCaptureId,
        onOpen: () => {
          setSelectedProblemId(problem.id);
          setProblemEditor(problem);
        },
      })),
    },
    {
      label: "Actions",
      records: actionRecords.map((action) => ({
        id: action.id,
        objectType: "Action",
        title: action.actionTitle || action.title,
        searchText: `${action.actionTitle || action.title} ${action.description}`,
        createdAt: action.createdAt,
        operationalDate: action.dueDate,
        owner: getActionOwnerDisplay(action, people),
        status: action.status,
        area: getAreaText(action),
        sourceCaptureId: action.sourceCaptureId,
        onOpen: () => {
          setSelectedActionId(action.id);
          setActionEditor(action);
        },
      })),
    },
    {
      label: "Decisions",
      records: decisionRecords.map((decision) => ({
        id: decision.id,
        objectType: "Decision",
        title: decision.decisionTitle || decision.title,
        searchText: `${decision.decisionTitle || decision.title} ${decision.decisionStatement} ${decision.context} ${decision.reasoning}`,
        createdAt: decision.createdAt,
        operationalDate: decision.reviewDate,
        owner: decision.decisionMaker || "Unassigned",
        status: decision.decisionStatus,
        area: getAreaText(decision),
        sourceCaptureId: decision.sourceCaptureId,
        onOpen: () => {
          setSelectedDecisionId(decision.id);
          setDecisionEditor(decision);
        },
      })),
    },
    {
      label: "Opportunities",
      records: opportunityRecords.map((opportunity) => ({
        id: opportunity.id,
        objectType: "Opportunity",
        title: opportunity.opportunityTitle || opportunity.title,
        searchText: `${opportunity.opportunityTitle || opportunity.title} ${opportunity.description} ${opportunity.evidence}`,
        createdAt: opportunity.createdAt,
        operationalDate: "",
        owner: opportunity.owner || "Unassigned",
        status: opportunity.status,
        area: getAreaText(opportunity),
        sourceCaptureId: opportunity.sourceCaptureId,
        onOpen: () => {
          setSelectedOpportunityId(opportunity.id);
          setOpportunityEditor(opportunity);
        },
      })),
    },
    {
      label: "Projects",
      records: projects.map((project) => ({
        id: project.id,
        objectType: "Project",
        title: project.projectName,
        searchText: `${project.projectName} ${project.owner} ${project.area} ${project.status}`,
        createdAt: "",
        startDate: project.startDate,
        operationalDate: project.targetCompletionDate,
        owner: project.owner || "Unassigned",
        status: project.status || "No status",
        area: project.area,
        sourceCaptureId: "",
        onOpen: () => handleProjectEditOpen(project),
      })),
    },
    {
      label: "Lessons",
      records: lessonRecords.map((lesson) => ({
        id: lesson.id,
        objectType: "Lesson",
        title: lesson.lessonTitle || lesson.title,
        searchText: `${lesson.lessonTitle || lesson.title} ${lesson.description} ${lesson.whyItMatters} ${lesson.recommendedChange}`,
        createdAt: lesson.createdAt,
        operationalDate: "",
        owner: lesson.owner || "Unassigned",
        status: lesson.status,
        area: getAreaText(lesson),
        sourceCaptureId: lesson.sourceCaptureId,
        onOpen: () => {
          setSelectedLessonId(lesson.id);
          setLessonEditor(lesson);
        },
      })),
    },
    {
      label: "Systems",
      records: systemRecords.map((system) => ({
        id: system.id,
        objectType: "System",
        title: system.systemName || system.title,
        searchText: `${system.systemName || system.title} ${system.purpose} ${system.process} ${system.outputs}`,
        createdAt: system.createdAt,
        operationalDate: "",
        owner: system.owner || "Unassigned",
        status: system.status,
        area: getAreaText(system),
        sourceCaptureId: system.sourceCaptureId,
        onOpen: () => {
          setSelectedSystemId(system.id);
          setSystemEditor(system);
        },
      })),
    },
    {
      label: "SOPs",
      records: sopRecords.map((sop) => ({
        id: sop.id,
        objectType: "SOP",
        title: sop.sopTitle || sop.title,
        searchText: `${sop.sopTitle || sop.title} ${sop.purpose} ${sop.procedure} ${sop.qualityStandard}`,
        createdAt: sop.createdAt,
        operationalDate: "",
        owner: sop.owner || "Unassigned",
        status: sop.status,
        area: getAreaText(sop),
        sourceCaptureId: sop.sourceCaptureId,
        onOpen: () => {
          setSelectedSopId(sop.id);
          setSopEditor(sop);
        },
      })),
    },
  ];

  const getCaptureLineage = (captureId?: string) => {
    if (!captureId) {
      return [] as RelatedRecordItem[];
    }

    const capture = captures.find((item) => item.id === captureId);
    if (!capture) {
      return [] as RelatedRecordItem[];
    }

    return [{
      label: "Capture",
      title: capture.title,
      id: capture.id,
    }];
  };

  const handleFieldChange = (field: keyof CaptureFormValues, value: string) => {
    setFormValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedTitle = formValues.title.trim();
    const trimmedNote = formValues.rawNote.trim();

    if (!trimmedTitle || !trimmedNote) {
      setFeedback({
        type: "error",
        message: "Title and raw note are required before saving a capture.",
      });
      return;
    }

    const newCapture: CaptureRecord = {
      id: generateCaptureId(),
      title: trimmedTitle,
      rawNote: trimmedNote,
      initialType: formValues.initialType,
      relatedArea: formValues.relatedArea,
      importance: formValues.importance,
      status: "New",
      capturedAt: new Date().toISOString(),
      reviewOutcome: null,
      reviewedAt: null,
    };

    setCaptures((currentCaptures) => [newCapture, ...currentCaptures]);
    setFormValues(defaultFormValues);
    setFeedback({
      type: "success",
      message: "Capture saved successfully.",
    });
  };

  const handleReview = (capture: CaptureRecord) => {
    if (capture.reviewOutcome) {
      setSelectedCaptureId(null);
      setFeedback({
        type: "success",
        message: `This capture was already reviewed as ${capture.reviewOutcome}.`,
      });
      return;
    }

    setSelectedCaptureId(capture.id);
    setSelectedOutcome("Keep as Capture");
  };

  const handleReviewSubmit = () => {
    if (!selectedCaptureId) {
      return;
    }

    const capture = captures.find((item) => item.id === selectedCaptureId);

    if (!capture || capture.reviewOutcome) {
      setSelectedCaptureId(null);
      return;
    }

    const reviewDate = new Date().toISOString();
    const nextStatus = getStatusFromOutcome(selectedOutcome);
    const outcomeLabel = formatReviewOutcome(selectedOutcome) ?? "Capture";

    const updatedCapture: CaptureRecord = {
      ...capture,
      status: nextStatus,
      reviewOutcome: selectedOutcome,
      reviewedAt: reviewDate,
    };

    const nextCaptureList = captures.map((item) =>
      item.id === selectedCaptureId ? updatedCapture : item,
    );

    setCaptures(nextCaptureList);

    if (selectedOutcome !== "Keep as Capture" && selectedOutcome !== "Close") {
      const conversion: CaptureConversionRecord = {
        id: generateConversionId(),
        sourceCaptureId: capture.id,
        targetType: selectedOutcome,
        createdAt: reviewDate,
        title: capture.title,
        originalRawNote: capture.rawNote,
        relatedArea: capture.relatedArea,
        importance: capture.importance,
        status: nextStatus,
      };

      if (selectedOutcome === "Convert to Problem") {
        const problemDefaults = normalizeProblemRecord(conversion);
        Object.assign(conversion, problemDefaults);
      }

      if (selectedOutcome === "Convert to Decision") {
        const decisionDefaults = normalizeDecisionRecord(conversion);
        Object.assign(conversion, decisionDefaults);
      }

      if (selectedOutcome === "Convert to Opportunity") {
        const opportunityDefaults = normalizeOpportunityRecord(conversion);
        Object.assign(conversion, opportunityDefaults);
      }

      if (selectedOutcome === "Convert to Lesson") {
        const lessonDefaults = normalizeLessonRecord(conversion);
        Object.assign(conversion, lessonDefaults);
      }

      if (selectedOutcome === "Convert to System") {
        const systemDefaults = normalizeSystemRecord(conversion);
        Object.assign(conversion, systemDefaults);
      }

      setConversions((currentConversions) => [conversion, ...currentConversions]);
    }

    setSelectedCaptureId(null);
    setFeedback({
      type: "success",
      message: selectedOutcome === "Close"
        ? "Capture closed and retained in the record."
        : selectedOutcome === "Keep as Capture"
          ? "Capture reviewed and kept as a capture."
          : `Capture converted to ${outcomeLabel}.`,
    });
  };

  const handleProblemEditOpen = (problem: ProblemRecord) => {
    setSelectedProblemId(problem.id);
    setProblemEditor(problem);
  };

  const handleProblemEditorChange = (
    field: keyof Omit<ProblemRecord, "id" | "sourceCaptureId" | "targetType" | "createdAt" | "title" | "originalRawNote" | "relatedArea" | "importance" | "status">,
    value: string,
  ) => {
    if (!problemEditor) {
      return;
    }

    setProblemEditor({
      ...problemEditor,
      [field]: value,
    });
  };

  const handleProblemSave = () => {
    if (!selectedProblemId || !problemEditor) {
      return;
    }

    const updatedProblem = normalizeProblemRecord({
      ...problemEditor,
      status: problemEditor.problemStatus,
    });

    setConversions((currentConversions) =>
      currentConversions.map((conversion) =>
        conversion.id === selectedProblemId ? updatedProblem : conversion,
      ),
    );

    setSelectedProblemId(null);
    setProblemEditor(null);
    setFeedback({
      type: "success",
      message: "Problem details saved.",
    });
  };

  const handleActionEditOpen = (action: ActionRecord) => {
    setSelectedActionId(action.id);
    setActionEditor(action);
  };

  const handleActionEditorChange = (
    field: keyof ActionRecord,
    value: string,
  ) => {
    if (!actionEditor) {
      return;
    }

    setActionEditor({
      ...actionEditor,
      [field]: value,
    });
  };

  const handleActionOwnerChange = (personId: string) => {
    if (!actionEditor) {
      return;
    }

    if (personId.startsWith("named-owner:") || personId.startsWith("legacy-owner:")) {
      const ownerName = personId.slice(personId.indexOf(":") + 1);
      setActionEditor({
        ...actionEditor,
        ownerPersonId: "",
        owner: ownerName,
      });
      return;
    }

    const activePerson = people.find((person) => person.id === personId && person.status === "Active");

    setActionEditor({
      ...actionEditor,
      ownerPersonId: activePerson ? activePerson.id : "",
      owner: activePerson ? activePerson.name : "Unassigned",
    });
  };

  const handleActionSave = () => {
    if (!selectedActionId || !actionEditor) {
      return;
    }

    const validRelatedProblem = problemRecords.some((problem) => problem.id === actionEditor.relatedProblem)
      ? actionEditor.relatedProblem
      : "";
    const validRelatedDecision = decisionRecords.some((decision) => decision.id === actionEditor.relatedDecision)
      ? actionEditor.relatedDecision
      : "";

    const updatedAction = normalizeActionRecord({
      ...actionEditor,
      relatedProblem: validRelatedProblem,
      relatedDecision: validRelatedDecision,
      status: actionEditor.status,
      priority: actionEditor.priority,
      owner: actionEditor.owner,
      createdBy: actionEditor.createdBy,
      dueDate: actionEditor.dueDate,
      completionDate: actionEditor.completionDate,
      completionEvidence: actionEditor.completionEvidence,
    });

    setConversions((currentConversions) =>
      currentConversions.map((conversion) =>
        conversion.id === selectedActionId ? updatedAction : conversion,
      ),
    );

    setSelectedActionId(null);
    setActionEditor(null);
    setFeedback({
      type: "success",
      message: "Action details saved.",
    });
  };

  const handleCreateLinkedAction = (problem: ProblemRecord) => {
    if (creatingLinkedActionForProblemId === problem.id) {
      return;
    }

    setCreatingLinkedActionForProblemId(problem.id);

    const createdAction = normalizeActionRecord({
      id: generateConversionId(),
      sourceCaptureId: problem.sourceCaptureId,
      targetType: "Convert to Action",
      createdAt: new Date().toISOString(),
      title: problem.problemStatement || problem.title,
      originalRawNote: problem.impact || problem.rootCause || problem.originalRawNote || problem.problemStatement,
      relatedArea: problem.relatedArea,
      importance: problem.importance,
      status: "Open",
      actionTitle: problem.problemStatement || problem.title,
      actionDescription: problem.impact || problem.rootCause || problem.originalRawNote || problem.problemStatement,
      createdBy: "",
      createdDate: new Date().toISOString(),
      dueDate: "",
      priority: "Medium",
      relatedProblem: problem.id,
      relatedDecision: "",
      relatedCapture: problem.sourceCaptureId,
      relatedPillar: problem.relatedArea,
      completionEvidence: "",
      completionDate: "",
      owner: problem.owner || "",
    });

    setConversions((currentConversions) => [
      {
        ...createdAction,
        relatedProblem: problem.id,
        relatedCapture: problem.sourceCaptureId,
        relatedPillar: problem.relatedArea,
      },
      ...currentConversions,
    ]);

    setSelectedActionId(createdAction.id);
    setActionEditor(createdAction);
    setCreatingLinkedActionForProblemId(null);
    setFeedback({
      type: "success",
      message: "Linked Action created from the Problem.",
    });
  };

  const handleOpenRelatedProblem = (action: ActionRecord) => {
    const linkedProblem = problemRecords.find((problem) => problem.id === action.relatedProblem);

    if (!linkedProblem) {
      setFeedback({
        type: "error",
        message: "The related Problem could not be found.",
      });
      return;
    }

    setSelectedProblemId(linkedProblem.id);
    setProblemEditor(linkedProblem);
    setSelectedActionId(null);
    setActionEditor(null);
  };

  const handleDecisionCreateLinkedAction = (decision: DecisionRecord) => {
    if (creatingLinkedActionForDecisionId === decision.id) {
      return;
    }

    setCreatingLinkedActionForDecisionId(decision.id);

    const createdAction = normalizeActionRecord({
      id: generateConversionId(),
      sourceCaptureId: decision.sourceCaptureId,
      targetType: "Convert to Action",
      createdAt: new Date().toISOString(),
      title: decision.decisionTitle || decision.title,
      originalRawNote: decision.decisionStatement || decision.context || decision.originalRawNote || decision.title,
      relatedArea: decision.relatedArea,
      importance: decision.importance,
      status: "Open",
      actionTitle: decision.decisionTitle || decision.title,
      actionDescription: decision.decisionStatement || decision.context || decision.originalRawNote || decision.title,
      createdBy: "",
      createdDate: new Date().toISOString(),
      dueDate: "",
      priority: "Medium",
      relatedProblem: "",
      relatedDecision: decision.id,
      relatedCapture: decision.sourceCaptureId,
      relatedPillar: decision.relatedArea,
      completionEvidence: "",
      completionDate: "",
      owner: decision.decisionMaker || "",
    });

    setConversions((currentConversions) => [
      {
        ...createdAction,
        relatedDecision: decision.id,
        relatedCapture: decision.sourceCaptureId,
        relatedPillar: decision.relatedArea,
      },
      ...currentConversions,
    ]);

    setSelectedActionId(createdAction.id);
    setActionEditor(createdAction);
    setCreatingLinkedActionForDecisionId(null);
    setFeedback({
      type: "success",
      message: "Linked Action created from the Decision.",
    });
  };

  const handleOpenRelatedDecision = (action: ActionRecord) => {
    const linkedDecision = decisionRecords.find((decision) => decision.id === action.relatedDecision);

    if (!linkedDecision) {
      setFeedback({
        type: "error",
        message: "The related Decision could not be found.",
      });
      return;
    }

    setSelectedDecisionId(linkedDecision.id);
    setDecisionEditor(linkedDecision);
    setSelectedActionId(null);
    setActionEditor(null);
  };

  const handleDecisionEditOpen = (decision: DecisionRecord) => {
    setSelectedDecisionId(decision.id);
    setDecisionEditor(decision);
  };

  const handleDecisionEditorChange = (
    field: keyof DecisionRecord,
    value: string,
  ) => {
    if (!decisionEditor) {
      return;
    }

    setDecisionEditor({
      ...decisionEditor,
      [field]: value,
    });
  };

  const handleDecisionSave = () => {
    if (!selectedDecisionId || !decisionEditor) {
      return;
    }

    const updatedDecision = normalizeDecisionRecord({
      ...decisionEditor,
      status: decisionEditor.decisionStatus,
      riskLevel: decisionEditor.riskLevel,
      reviewDate: decisionEditor.reviewDate,
      actualOutcome: decisionEditor.actualOutcome,
      lessons: decisionEditor.lessons,
    });

    setConversions((currentConversions) =>
      currentConversions.map((conversion) =>
        conversion.id === selectedDecisionId ? updatedDecision : conversion,
      ),
    );

    setSelectedDecisionId(null);
    setDecisionEditor(null);
    setFeedback({
      type: "success",
      message: "Decision details saved.",
    });
  };

  const handleCreateLinkedDecision = (opportunity: OpportunityRecord) => {
    if (creatingLinkedDecisionForOpportunityId === opportunity.id) {
      return;
    }

    setCreatingLinkedDecisionForOpportunityId(opportunity.id);

    const createdDecision = normalizeDecisionRecord({
      id: generateConversionId(),
      sourceCaptureId: opportunity.sourceCaptureId,
      targetType: "Convert to Decision",
      createdAt: new Date().toISOString(),
      title: opportunity.opportunityTitle || opportunity.title,
      originalRawNote: opportunity.description || opportunity.originalRawNote || opportunity.title,
      relatedArea: opportunity.relatedArea || opportunity.relatedPillar,
      importance: opportunity.importance,
      status: "Draft",
      decisionTitle: opportunity.opportunityTitle || opportunity.title,
      decisionStatement: opportunity.description || opportunity.originalRawNote || opportunity.title,
      decisionMaker: opportunity.owner || "",
      decisionDate: new Date().toISOString(),
      context: opportunity.description || opportunity.evidence || opportunity.risks || "",
      reasoning: opportunity.evidence || opportunity.strategicFit || "",
      evidenceConsidered: opportunity.evidence || "",
      alternativesConsidered: "",
      assumptions: "",
      expectedOutcome: opportunity.estimatedUpside || opportunity.outcome || "",
      riskLevel: "Medium",
      reviewDate: "",
      actualOutcome: "",
      lessons: "",
      decisionStatus: "Draft",
      relatedOpportunity: opportunity.id,
      relatedDecision: "",
      relatedCapture: opportunity.sourceCaptureId,
      relatedPillar: opportunity.relatedPillar || opportunity.relatedArea,
    });

    setConversions((currentConversions) => [
      {
        ...createdDecision,
        relatedOpportunity: opportunity.id,
        relatedCapture: opportunity.sourceCaptureId,
        relatedPillar: opportunity.relatedPillar || opportunity.relatedArea,
      },
      ...currentConversions,
    ]);

    setSelectedDecisionId(createdDecision.id);
    setDecisionEditor(createdDecision);
    setCreatingLinkedDecisionForOpportunityId(null);
    setFeedback({
      type: "success",
      message: "Linked Decision created from the Opportunity.",
    });
  };

  const handleOpenRelatedOpportunity = (decision: DecisionRecord) => {
    const linkedOpportunity = opportunityRecords.find((opportunity) => opportunity.id === decision.relatedOpportunity);

    if (!linkedOpportunity) {
      setFeedback({
        type: "error",
        message: "The related Opportunity could not be found.",
      });
      return;
    }

    setSelectedOpportunityId(linkedOpportunity.id);
    setOpportunityEditor(linkedOpportunity);
    setSelectedDecisionId(null);
    setDecisionEditor(null);
  };

  const handleOpportunityEditOpen = (opportunity: OpportunityRecord) => {
    setSelectedOpportunityId(opportunity.id);
    setOpportunityEditor(opportunity);
  };

  const handleOpenAttentionRecord = (objectType: string, id: string) => {
    if (objectType === "Decision") {
      const record = decisionRecords.find((item) => item.id === id);
      if (record) handleDecisionEditOpen(record);
    } else if (objectType === "Action") {
      const record = actionRecords.find((item) => item.id === id);
      if (record) handleActionEditOpen(record);
    } else if (objectType === "Problem") {
      const record = problemRecords.find((item) => item.id === id);
      if (record) handleProblemEditOpen(record);
    } else if (objectType === "Opportunity") {
      const record = opportunityRecords.find((item) => item.id === id);
      if (record) handleOpportunityEditOpen(record);
    } else if (objectType === "Project") {
      const record = projects.find((item) => item.id === id);
      if (record) handleProjectEditOpen(record);
    } else if (objectType === "Lead") {
      const record = leads.find((item) => item.id === id);
      if (record) handleLeadEditOpen(record);
    } else if (objectType === "Lesson") {
      const record = lessonRecords.find((item) => item.id === id);
      if (record) handleLessonEditOpen(record);
    } else if (objectType === "Finance") {
      setActiveView("Finance");
      if (id === "cash-buffer") {
        handleCashPositionOpen();
      } else if (id.startsWith("commitment:")) {
        const record = commitmentRecords.find((item) => item.id === id.slice("commitment:".length));
        if (record) handleCommitmentEditOpen(record);
      } else if (id.startsWith("income:")) {
        const record = incomeRecords.find((item) => item.id === id.slice("income:".length));
        if (record) handleIncomeEditOpen(record);
      }
    }
  };

  const handleOpenTodayStep = (stepLabel: string) => {
    if (stepLabel === "Clear founder focus") {
      const first = founderFocusList[0];
      if (first) {
        handleOpenAttentionRecord(first.objectType, first.id);
      }
      return;
    }

    if (stepLabel === "Fix ownership gaps") {
      setActiveView("People");
      setSelectedAccountabilityKey("unassigned");
      return;
    }

    if (stepLabel === "Complete decision reviews") {
      const first = decisionTrackRecord.reviewsDue[0];
      if (first) {
        handleOpenAttentionRecord("Decision", first.id);
      } else {
        setActiveView("Decisions");
      }
      return;
    }

    if (stepLabel === "Restore execution paths") {
      const first = decisionsWithoutExecution[0];
      if (first) {
        handleOpenAttentionRecord("Decision", first.id);
      } else {
        setActiveView("Decisions");
      }
      return;
    }

    if (stepLabel === "Close recurring-learning gaps") {
      const first = recurringProblemLearning.gaps[0];
      if (first) {
        handleOpenAttentionRecord("Problem", first.id);
      } else {
        setActiveView("Problems");
      }
      return;
    }

    if (stepLabel === "Clear cash attention") {
      if (cashAttention.buffer) {
        handleOpenAttentionRecord("Finance", "cash-buffer");
      } else if (cashAttention.overdueCommitments.length > 0) {
        handleOpenAttentionRecord("Finance", `commitment:${cashAttention.overdueCommitments[0].id}`);
      } else if (cashAttention.overdueExpectedIncome.length > 0) {
        handleOpenAttentionRecord("Finance", `income:${cashAttention.overdueExpectedIncome[0].id}`);
      } else {
        setActiveView("Finance");
      }
      return;
    }
  };

  const handleOpportunityEditorChange = (
    field: keyof OpportunityRecord,
    value: string,
  ) => {
    if (!opportunityEditor) {
      return;
    }

    setOpportunityEditor({
      ...opportunityEditor,
      [field]: value,
    });
  };

  const handleOpportunitySave = () => {
    if (!selectedOpportunityId || !opportunityEditor) {
      return;
    }

    const updatedOpportunity = normalizeOpportunityRecord({
      ...opportunityEditor,
      status: opportunityEditor.status,
      strategicFit: opportunityEditor.strategicFit,
      opportunityStatus: opportunityEditor.status,
      owner: opportunityEditor.owner,
      decision: opportunityEditor.decision,
      outcome: opportunityEditor.outcome,
    });

    setConversions((currentConversions) =>
      currentConversions.map((conversion) =>
        conversion.id === selectedOpportunityId ? updatedOpportunity : conversion,
      ),
    );

    setSelectedOpportunityId(null);
    setOpportunityEditor(null);
    setFeedback({
      type: "success",
      message: "Opportunity details saved.",
    });
  };

  const handleLessonEditOpen = (lesson: LessonRecord) => {
    setSelectedLessonId(lesson.id);
    setLessonEditor(lesson);
  };

  const handleLessonEditorChange = (
    field: keyof LessonRecord,
    value: string,
  ) => {
    if (!lessonEditor) {
      return;
    }

    setLessonEditor({
      ...lessonEditor,
      [field]: value,
    });
  };

  const handleLessonSave = () => {
    if (!selectedLessonId || !lessonEditor) {
      return;
    }

    const updatedLesson = normalizeLessonRecord({
      ...lessonEditor,
      status: lessonEditor.status,
      owner: lessonEditor.owner,
      relatedProblem: lessonEditor.relatedProblem,
      relatedProject: lessonEditor.relatedProject,
      relatedDecision: lessonEditor.relatedDecision,
      relatedSystem: lessonEditor.relatedSystem,
      lessonStatus: lessonEditor.status,
    });

    setConversions((currentConversions) =>
      currentConversions.map((conversion) =>
        conversion.id === selectedLessonId ? updatedLesson : conversion,
      ),
    );

    setSelectedLessonId(null);
    setLessonEditor(null);
    setFeedback({
      type: "success",
      message: "Lesson details saved.",
    });
  };

  const handleSystemEditOpen = (system: SystemRecord) => {
    setSelectedSystemId(system.id);
    setSystemEditor(system);
  };

  const handleSystemEditorChange = (
    field: keyof SystemRecord,
    value: string,
  ) => {
    if (!systemEditor) {
      return;
    }

    setSystemEditor({
      ...systemEditor,
      [field]: value,
    });
  };

  const handleSystemSave = () => {
    if (!selectedSystemId || !systemEditor) {
      return;
    }

    const updatedSystem = normalizeSystemRecord({
      ...systemEditor,
      status: systemEditor.status,
      owner: systemEditor.owner,
      area: systemEditor.area,
      relatedLesson: systemEditor.relatedLesson,
      relatedCapture: systemEditor.relatedCapture,
      systemStatus: systemEditor.status,
    });

    setConversions((currentConversions) =>
      currentConversions.map((conversion) =>
        conversion.id === selectedSystemId ? updatedSystem : conversion,
      ),
    );

    setSelectedSystemId(null);
    setSystemEditor(null);
    setFeedback({
      type: "success",
      message: "System details saved.",
    });
  };

  const handleSopEditOpen = (sop: SopRecord) => {
    setSelectedSopId(sop.id);
    setSopEditor(sop);
  };

  const handleSopEditorChange = (
    field: keyof SopRecord,
    value: string,
  ) => {
    if (!sopEditor) {
      return;
    }

    setSopEditor({
      ...sopEditor,
      [field]: value,
    });
  };

  const handleSopSave = () => {
    if (!selectedSopId || !sopEditor) {
      return;
    }

    const updatedSop = normalizeSopRecord({
      ...sopEditor,
      status: sopEditor.status,
      owner: sopEditor.owner,
      relatedSystem: sopEditor.relatedSystem,
      relatedLesson: sopEditor.relatedLesson,
      relatedCapture: sopEditor.relatedCapture,
      sopStatus: sopEditor.status,
      version: sopEditor.version,
      effectiveDate: sopEditor.effectiveDate,
      reviewDate: sopEditor.reviewDate,
    });

    setConversions((currentConversions) =>
      currentConversions.map((conversion) =>
        conversion.id === selectedSopId ? updatedSop : conversion,
      ),
    );

    setSelectedSopId(null);
    setSopEditor(null);
    setFeedback({
      type: "success",
      message: "SOP details saved.",
    });
  };

  const handleCreateLinkedSop = (system: SystemRecord) => {
    if (creatingLinkedSopForSystemId === system.id) {
      return;
    }

    const existingSop = sopRecords.find((sop) => sop.relatedSystem === system.id);
    if (existingSop) {
      setSelectedSopId(existingSop.id);
      setSopEditor(existingSop);
      setFeedback({
        type: "success",
        message: "A linked SOP already exists for this System.",
      });
      return;
    }

    setCreatingLinkedSopForSystemId(system.id);

    const createdSop = normalizeSopRecord({
      id: generateConversionId(),
      sourceCaptureId: system.sourceCaptureId,
      targetType: "Convert to SOP",
      createdAt: new Date().toISOString(),
      title: system.systemName || system.title,
      originalRawNote: system.purpose || system.originalRawNote || system.systemName,
      relatedArea: system.relatedArea || system.area,
      importance: system.importance,
      status: "Draft",
      sopTitle: system.systemName || system.title,
      sopPurpose: system.purpose || system.originalRawNote || system.systemName,
      owner: system.owner || "",
      relatedSystem: system.id,
      applicableRoles: "",
      procedure: system.process || system.purpose || "",
      requiredTools: "",
      safetyConsiderations: system.failurePoints || "",
      qualityStandard: system.standards || "",
      completionEvidence: "",
      version: system.version || "v1",
      effectiveDate: new Date().toISOString(),
      reviewDate: "",
      sopStatus: "Draft",
      relatedLesson: system.relatedLesson || "",
      relatedCapture: system.relatedCapture || system.sourceCaptureId,
      relatedPillar: system.relatedPillar || system.relatedArea,
    });

    setConversions((currentConversions) => [
      {
        ...createdSop,
        relatedSystem: system.id,
        relatedLesson: system.relatedLesson || "",
        relatedCapture: system.relatedCapture || system.sourceCaptureId,
        relatedPillar: system.relatedPillar || system.relatedArea,
      },
      ...currentConversions,
    ]);

    setSelectedSopId(createdSop.id);
    setSopEditor(createdSop);
    setCreatingLinkedSopForSystemId(null);
    setFeedback({
      type: "success",
      message: "Linked SOP created from the System.",
    });
  };

  const handleOpenRelatedSystem = (sop: SopRecord) => {
    const linkedSystem = systemRecords.find((system) => system.id === sop.relatedSystem);

    if (!linkedSystem) {
      setFeedback({
        type: "error",
        message: "The related System could not be found.",
      });
      return;
    }

    setSelectedSystemId(linkedSystem.id);
    setSystemEditor(linkedSystem);
    setSelectedSopId(null);
    setSopEditor(null);
  };

  const handleCreateLinkedSystem = (lesson: LessonRecord) => {
    if (creatingLinkedSystemForLessonId === lesson.id) {
      return;
    }

    const existingSystem = systemRecords.find((system) => system.relatedLesson === lesson.id);
    if (existingSystem) {
      setSelectedSystemId(existingSystem.id);
      setSystemEditor(existingSystem);
      setFeedback({
        type: "success",
        message: "A linked System already exists for this Lesson.",
      });
      return;
    }

    setCreatingLinkedSystemForLessonId(lesson.id);

    const createdSystem = normalizeSystemRecord({
      id: generateConversionId(),
      sourceCaptureId: lesson.sourceCaptureId,
      targetType: "Convert to System",
      createdAt: new Date().toISOString(),
      title: lesson.lessonTitle || lesson.title,
      originalRawNote: lesson.description || lesson.originalRawNote || lesson.title,
      relatedArea: lesson.relatedArea || lesson.relatedPillar,
      importance: lesson.importance,
      status: "Draft",
      systemName: lesson.lessonTitle || lesson.title,
      purpose: lesson.recommendedChange || lesson.whyItMatters || lesson.description || "",
      owner: lesson.owner || "",
      area: lesson.relatedPillar || lesson.relatedArea || "",
      inputs: "",
      process: lesson.recommendedChange || "",
      outputs: "",
      standards: "",
      failurePoints: "",
      version: "v1",
      lastReviewed: new Date().toISOString(),
      systemStatus: "Draft",
      relatedLesson: lesson.id,
      relatedCapture: lesson.sourceCaptureId,
      relatedPillar: lesson.relatedPillar || lesson.relatedArea,
      relatedSystem: lesson.relatedSystem || "",
    });

    setConversions((currentConversions) => [
      {
        ...createdSystem,
        relatedLesson: lesson.id,
        relatedCapture: lesson.sourceCaptureId,
        relatedPillar: lesson.relatedPillar || lesson.relatedArea,
      },
      ...currentConversions,
    ]);

    setSelectedSystemId(createdSystem.id);
    setSystemEditor(createdSystem);
    setCreatingLinkedSystemForLessonId(null);
    setFeedback({
      type: "success",
      message: "Linked System created from the Lesson.",
    });
  };

  const handleCreateLinkedLesson = (decision: DecisionRecord) => {
    if (creatingLinkedLessonForDecisionId === decision.id) {
      return;
    }

    const existingLesson = lessonRecords.find((lesson) => lesson.relatedDecision === decision.id);
    if (existingLesson) {
      setSelectedLessonId(existingLesson.id);
      setLessonEditor(existingLesson);
      setFeedback({
        type: "success",
        message: "A linked Lesson already exists for this Decision.",
      });
      return;
    }

    setCreatingLinkedLessonForDecisionId(decision.id);

    const ratingText = decision.outcomeRating ? ` Outcome rating: ${decision.outcomeRating}.` : "";
    const actualText = decision.actualOutcome ? ` What actually happened: ${decision.actualOutcome}` : "";

    const createdLesson = normalizeLessonRecord({
      id: generateConversionId(),
      sourceCaptureId: decision.sourceCaptureId,
      targetType: "Convert to Lesson",
      createdAt: new Date().toISOString(),
      title: decision.decisionTitle || decision.title,
      originalRawNote: decision.originalRawNote || decision.decisionStatement || decision.title,
      relatedArea: decision.relatedArea || decision.relatedPillar || "",
      importance: decision.importance,
      status: "New",
      lessonTitle: `Review: ${decision.decisionTitle || decision.title}`,
      lessonDescription: `Decision review: ${decision.decisionStatement || decision.title}.${ratingText}${actualText}`.trim(),
      sourceEvent: `Decision: ${decision.decisionTitle || decision.title}`,
      dateLearned: new Date().toISOString(),
      relatedPillar: decision.relatedPillar || decision.relatedArea || "",
      whyItMatters: decision.expectedOutcome
        ? `Expected: ${decision.expectedOutcome}.${actualText ? ` Actual: ${decision.actualOutcome}.` : ""}${ratingText}`
        : `Outcome rating: ${decision.outcomeRating || "Not rated"}.${actualText}`,
      recommendedChange: decision.lessons || "",
      relatedProblem: "",
      relatedProject: "",
      relatedDecision: decision.id,
      relatedSystem: "",
      owner: decision.decisionMaker || "",
      lessonStatus: "New",
      relatedCapture: decision.sourceCaptureId,
    });

    setConversions((currentConversions) => [
      {
        ...createdLesson,
        relatedDecision: decision.id,
        relatedCapture: decision.sourceCaptureId,
        relatedPillar: decision.relatedPillar || decision.relatedArea,
      },
      ...currentConversions,
    ]);

    setSelectedLessonId(createdLesson.id);
    setLessonEditor(createdLesson);
    setCreatingLinkedLessonForDecisionId(null);
    setFeedback({
      type: "success",
      message: "Linked Lesson created from the Decision.",
    });
  };

  const handleCreateLinkedLessonFromProblem = (problem: ProblemRecord) => {
    if (creatingLinkedLessonForProblemId === problem.id) {
      return;
    }

    const existingLesson = lessonRecords.find((lesson) => lesson.relatedProblem === problem.id);
    if (existingLesson) {
      setSelectedLessonId(existingLesson.id);
      setLessonEditor(existingLesson);
      setFeedback({
        type: "success",
        message: "A linked Lesson already exists for this Problem.",
      });
      return;
    }

    setCreatingLinkedLessonForProblemId(problem.id);

    const rootCauseText = problem.rootCause ? ` Root cause: ${problem.rootCause}.` : "";
    const resolutionText = problem.resolution ? ` Resolution: ${problem.resolution}.` : "";

    const createdLesson = normalizeLessonRecord({
      id: generateConversionId(),
      sourceCaptureId: problem.sourceCaptureId,
      targetType: "Convert to Lesson",
      createdAt: new Date().toISOString(),
      title: problem.problemStatement || problem.title,
      originalRawNote: problem.originalRawNote || problem.problemStatement || problem.title,
      relatedArea: problem.relatedArea || problem.relatedPillar || "",
      importance: problem.importance,
      status: "New",
      lessonTitle: `From problem: ${problem.problemStatement || problem.title}`,
      lessonDescription: `Problem: ${problem.problemStatement || problem.title}.${rootCauseText}${resolutionText}`.trim(),
      sourceEvent: `Problem (${problem.frequency}): ${problem.problemStatement || problem.title}`,
      dateLearned: new Date().toISOString(),
      relatedPillar: problem.relatedPillar || problem.relatedArea || "",
      whyItMatters: `This was a ${problem.frequency.toLowerCase()} problem (${problem.severity.toLowerCase()} severity). Capturing the fix prevents the business from re-learning it.`,
      recommendedChange: problem.resolution || "",
      relatedProblem: problem.id,
      relatedProject: "",
      relatedDecision: "",
      relatedSystem: "",
      owner: problem.owner || "",
      lessonStatus: "New",
      relatedCapture: problem.sourceCaptureId,
    });

    setConversions((currentConversions) => [
      {
        ...createdLesson,
        relatedProblem: problem.id,
        relatedCapture: problem.sourceCaptureId,
        relatedPillar: problem.relatedPillar || problem.relatedArea,
      },
      ...currentConversions,
    ]);

    setSelectedLessonId(createdLesson.id);
    setLessonEditor(createdLesson);
    setCreatingLinkedLessonForProblemId(null);
    setFeedback({
      type: "success",
      message: "Linked Lesson created from the Problem.",
    });
  };

  const handleOpenRelatedLesson = (system: SystemRecord) => {
    const linkedLesson = lessonRecords.find((lesson) => lesson.id === system.relatedLesson);

    if (!linkedLesson) {
      setFeedback({
        type: "error",
        message: "The related Lesson could not be found.",
      });
      return;
    }

    setSelectedLessonId(linkedLesson.id);
    setLessonEditor(linkedLesson);
    setSelectedSystemId(null);
    setSystemEditor(null);
  };

  const handlePersonEditOpen = (person: PersonRecord) => {
    setSelectedPersonId(person.id);
    setPersonEditor(person);
    setPersonSaveState("idle");
  };

  const handlePersonEditorChange = (
    field: keyof PersonRecord,
    value: string,
  ) => {
    if (!personEditor) {
      return;
    }

    setPersonSaveState("idle");
    setPersonEditor({
      ...personEditor,
      [field]: value,
    });
  };

  const handlePersonSave = () => {
    if (!personEditor) {
      return;
    }

    const nextPerson: PersonRecord = {
      ...personEditor,
      id: personEditor.id || generatePersonId(),
      name: personEditor.name.trim() || "Unnamed person",
      role: personEditor.role.trim(),
      responsibilities: personEditor.responsibilities.trim(),
      authority: personEditor.authority.trim(),
      manager: personEditor.manager.trim(),
      pillar: personEditor.pillar.trim() || "Garden Maintenance",
      skills: personEditor.skills.trim(),
      developmentAreas: personEditor.developmentAreas.trim(),
      performanceIndicators: personEditor.performanceIndicators.trim(),
      accessLevel: personAccessLevelOptions.includes(personEditor.accessLevel as PersonAccessLevel)
        ? (personEditor.accessLevel as PersonAccessLevel)
        : "Team Member",
      status: personStatusOptions.includes(personEditor.status as PersonStatus)
        ? (personEditor.status as PersonStatus)
        : "Active",
      dateCreated: personEditor.dateCreated || new Date().toISOString(),
    };

    const isNewPerson = !people.some((person) => person.id === nextPerson.id);

    setPeople((currentPeople) =>
      isNewPerson
        ? [nextPerson, ...currentPeople]
        : currentPeople.map((person) => person.id === nextPerson.id ? nextPerson : person),
    );

    setPersonSaveState("saved");
    window.setTimeout(() => setPersonSaveState("idle"), 1800);
    setFeedback({
      type: "success",
      message: isNewPerson ? "Person created." : "Person details saved.",
    });
  };

  const handleCreatePerson = () => {
    const newPerson: PersonRecord = {
      ...defaultPersonForm,
      id: generatePersonId(),
      dateCreated: new Date().toISOString(),
    };

    setSelectedPersonId(newPerson.id);
    setPersonEditor(newPerson);
    setPersonSaveState("idle");
  };

  const handleProjectEditOpen = (project: ProjectRecord) => {
    setSelectedProjectId(project.id);
    setProjectEditor(project);
  };

  const handleProjectEditorChange = (field: keyof ProjectRecord, value: string) => {
    if (!projectEditor) {
      return;
    }

    setProjectEditor({ ...projectEditor, [field]: value });
  };

  const handleProjectAddLink = (field: ProjectLinkSectionKey, id: string) => {
    if (!projectEditor || !id) {
      return;
    }

    const current = projectEditor[field] ?? [];
    if (current.includes(id)) {
      return;
    }

    setProjectEditor({ ...projectEditor, [field]: [...current, id] });
  };

  const handleProjectRemoveLink = (field: ProjectLinkSectionKey, id: string) => {
    if (!projectEditor) {
      return;
    }

    const current = projectEditor[field] ?? [];
    setProjectEditor({ ...projectEditor, [field]: current.filter((entry) => entry !== id) });
  };

  const handleProjectOpenRecord = (objectType: "Action" | "Decision" | "System" | "SOP", id: string) => {
    if (objectType === "Action") {
      const record = actionRecords.find((action) => action.id === id);
      if (record) {
        handleActionEditOpen(record);
      }
      return;
    }
    if (objectType === "Decision") {
      const record = decisionRecords.find((decision) => decision.id === id);
      if (record) {
        handleDecisionEditOpen(record);
      }
      return;
    }
    if (objectType === "System") {
      const record = systemRecords.find((system) => system.id === id);
      if (record) {
        handleSystemEditOpen(record);
      }
      return;
    }
    const record = sopRecords.find((sop) => sop.id === id);
    if (record) {
      handleSopEditOpen(record);
    }
  };

  const handleProjectSave = () => {
    if (!projectEditor) {
      return;
    }

    const projectName = projectEditor.projectName.trim();
    const normalizeProjectDate = (value: string) => {
      const dateValue = value.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        return "";
      }

      const parsedDate = new Date(`${dateValue}T00:00:00`);
      const [year, month, day] = dateValue.split("-").map(Number);
      return !Number.isNaN(parsedDate.getTime()) && parsedDate.getFullYear() === year && parsedDate.getMonth() === month - 1 && parsedDate.getDate() === day
        ? dateValue
        : "";
    };
    const startDate = normalizeProjectDate(projectEditor.startDate);
    const targetCompletionDate = normalizeProjectDate(projectEditor.targetCompletionDate);

    if (!projectName || (startDate && targetCompletionDate && targetCompletionDate < startDate)) {
      return;
    }

    const selectedOwner = people.find((person) =>
      person.status === "Active" && person.name === projectEditor.owner.trim(),
    );
    const selectedArea = projectEditor.area.trim();
    const selectedStatus = projectEditor.status.trim();

    const nextProject: ProjectRecord = {
      ...projectEditor,
      id: projectEditor.id || generateProjectId(),
      projectName,
      owner: selectedOwner ? selectedOwner.name : "",
      area: sharedAreaOptions.includes(selectedArea as (typeof sharedAreaOptions)[number]) ? selectedArea : "Garden Maintenance",
      startDate,
      targetCompletionDate,
      status: projectStatusOptions.includes(selectedStatus as (typeof projectStatusOptions)[number]) ? selectedStatus : "Open",
      relatedActionIds: projectEditor.relatedActionIds ?? [],
      relatedDecisionIds: projectEditor.relatedDecisionIds ?? [],
      relatedSystemIds: projectEditor.relatedSystemIds ?? [],
      relatedSopIds: projectEditor.relatedSopIds ?? [],
    };
    const isNewProject = !projects.some((project) => project.id === nextProject.id);

    setProjects((currentProjects) =>
      isNewProject
        ? [nextProject, ...currentProjects]
        : currentProjects.map((project) => project.id === nextProject.id ? nextProject : project),
    );
    setSelectedProjectId(nextProject.id);
    setProjectEditor(nextProject);
  };

  const handleCreateProject = () => {
    const newProject: ProjectRecord = {
      ...defaultProjectForm,
      id: generateProjectId(),
    };

    setSelectedProjectId(newProject.id);
    setProjectEditor(newProject);
  };

  const handleLeadEditOpen = (lead: LeadRecord) => {
    setSelectedLeadId(lead.id);
    setLeadEditor(lead);
  };

  const handleLeadEditorChange = (field: keyof LeadRecord, value: string) => {
    if (!leadEditor) {
      return;
    }

    setLeadEditor({ ...leadEditor, [field]: value });
  };

  const handleLeadSave = () => {
    if (!leadEditor) {
      return;
    }

    const leadName = leadEditor.leadName.trim();
    if (!leadName) {
      return;
    }

    const selectedOwner = people.find((person) =>
      person.status === "Active" && person.name === leadEditor.owner.trim(),
    );
    const selectedStatus = leadEditor.status.trim();
    const selectedSource = leadEditor.sourceChannel.trim();
    const selectedPillar = leadEditor.relatedPillar.trim();

    const nextLead: LeadRecord = {
      ...leadEditor,
      id: leadEditor.id || generateLeadId(),
      leadName,
      contactName: leadEditor.contactName.trim(),
      phone: leadEditor.phone.trim(),
      email: leadEditor.email.trim(),
      location: leadEditor.location.trim(),
      serviceRequested: leadEditor.serviceRequested.trim(),
      sourceChannel: leadSourceOptions.includes(selectedSource as LeadSource) ? (selectedSource as LeadSource) : "Other",
      dateReceived: leadEditor.dateReceived,
      status: leadStatusOptions.includes(selectedStatus as LeadStatus) ? (selectedStatus as LeadStatus) : "New",
      quoteValue: leadEditor.quoteValue.trim(),
      quoteSentDate: leadEditor.quoteSentDate,
      followUpDate: leadEditor.followUpDate,
      outcome: leadEditor.outcome.trim(),
      finalJobValue: leadEditor.finalJobValue.trim(),
      notes: leadEditor.notes.trim(),
      owner: selectedOwner ? selectedOwner.name : leadEditor.owner.trim(),
      relatedPillar: sharedAreaOptions.includes(selectedPillar as (typeof sharedAreaOptions)[number]) ? selectedPillar : "Garden Maintenance",
      dateCreated: leadEditor.dateCreated || new Date().toISOString(),
    };
    const isNewLead = !leads.some((lead) => lead.id === nextLead.id);

    setLeads((currentLeads) =>
      isNewLead
        ? [nextLead, ...currentLeads]
        : currentLeads.map((lead) => lead.id === nextLead.id ? nextLead : lead),
    );
    setSelectedLeadId(nextLead.id);
    setLeadEditor(nextLead);
    setFeedback({
      type: "success",
      message: isNewLead ? "Lead created." : "Lead details saved.",
    });
  };

  const handleCreateLead = () => {
    const newLead: LeadRecord = {
      ...defaultLeadForm,
      id: generateLeadId(),
      dateCreated: new Date().toISOString(),
    };

    setSelectedLeadId(newLead.id);
    setLeadEditor(newLead);
  };

  const handleLeadArchiveToggle = (lead: LeadRecord, archived: boolean) => {
    setLeads((currentLeads) =>
      currentLeads.map((entry) => entry.id === lead.id ? { ...entry, archived } : entry),
    );

    if (selectedLeadId === lead.id) {
      setSelectedLeadId(null);
      setLeadEditor(null);
    }

    setFeedback({
      type: "success",
      message: archived ? "Lead archived." : "Lead restored.",
    });
  };

  const handleCashPositionOpen = () => {
    setCashPositionEditor({ ...cashPosition });
  };

  const handleCashPositionChange = (field: keyof CashPositionRecord, value: string) => {
    if (!cashPositionEditor) {
      return;
    }

    setCashPositionEditor({ ...cashPositionEditor, [field]: value });
  };

  const handleCashPositionSave = () => {
    if (!cashPositionEditor) {
      return;
    }

    setCashPosition({
      ...cashPositionEditor,
      lastUpdated: cashPositionEditor.lastUpdated || new Date().toISOString().slice(0, 10),
    });
    setFeedback({ type: "success", message: "Cash position saved." });
  };

  const handleIncomeEditOpen = (income: IncomeRecord) => {
    setSelectedIncomeId(income.id);
    setIncomeEditor(income);
  };

  const handleIncomeEditorChange = (field: keyof IncomeRecord, value: string) => {
    if (!incomeEditor) {
      return;
    }

    setIncomeEditor({ ...incomeEditor, [field]: value });
  };

  const handleIncomeSave = () => {
    if (!incomeEditor || !incomeEditor.description.trim()) {
      return;
    }

    const nextIncome: IncomeRecord = {
      ...incomeEditor,
      id: incomeEditor.id || generateFinanceRecordId("income"),
      description: incomeEditor.description.trim(),
      customerSource: incomeEditor.customerSource.trim(),
      amount: incomeEditor.amount.trim(),
      status: incomeStatusOptions.includes(incomeEditor.status as IncomeStatus) ? incomeEditor.status : "Expected",
      notes: incomeEditor.notes.trim(),
      dateCreated: incomeEditor.dateCreated || new Date().toISOString(),
    };
    const isNew = !incomeRecords.some((record) => record.id === nextIncome.id);

    setIncomeRecords((current) =>
      isNew ? [nextIncome, ...current] : current.map((record) => record.id === nextIncome.id ? nextIncome : record),
    );
    setSelectedIncomeId(nextIncome.id);
    setIncomeEditor(nextIncome);
    setFeedback({ type: "success", message: isNew ? "Income record created." : "Income record saved." });
  };

  const handleCreateIncome = () => {
    const newIncome: IncomeRecord = {
      ...defaultIncomeForm,
      id: generateFinanceRecordId("income"),
      dateCreated: new Date().toISOString(),
    };

    setSelectedIncomeId(newIncome.id);
    setIncomeEditor(newIncome);
  };

  const handleExpenseEditOpen = (expense: ExpenseRecord) => {
    setSelectedExpenseId(expense.id);
    setExpenseEditor(expense);
  };

  const handleExpenseEditorChange = (field: keyof ExpenseRecord, value: string) => {
    if (!expenseEditor) {
      return;
    }

    setExpenseEditor({ ...expenseEditor, [field]: value });
  };

  const handleExpenseSave = () => {
    if (!expenseEditor || !expenseEditor.description.trim()) {
      return;
    }

    const nextExpense: ExpenseRecord = {
      ...expenseEditor,
      id: expenseEditor.id || generateFinanceRecordId("expense"),
      description: expenseEditor.description.trim(),
      supplier: expenseEditor.supplier.trim(),
      amount: expenseEditor.amount.trim(),
      status: expenseStatusOptions.includes(expenseEditor.status as ExpenseStatus) ? expenseEditor.status : "Planned",
      notes: expenseEditor.notes.trim(),
      dateCreated: expenseEditor.dateCreated || new Date().toISOString(),
    };
    const isNew = !expenseRecords.some((record) => record.id === nextExpense.id);

    setExpenseRecords((current) =>
      isNew ? [nextExpense, ...current] : current.map((record) => record.id === nextExpense.id ? nextExpense : record),
    );
    setSelectedExpenseId(nextExpense.id);
    setExpenseEditor(nextExpense);
    setFeedback({ type: "success", message: isNew ? "Expense record created." : "Expense record saved." });
  };

  const handleCreateExpense = () => {
    const newExpense: ExpenseRecord = {
      ...defaultExpenseForm,
      id: generateFinanceRecordId("expense"),
      dateCreated: new Date().toISOString(),
    };

    setSelectedExpenseId(newExpense.id);
    setExpenseEditor(newExpense);
  };

  const handleCommitmentEditOpen = (commitment: CommitmentRecord) => {
    setSelectedCommitmentId(commitment.id);
    setCommitmentEditor(commitment);
  };

  const handleCommitmentEditorChange = (field: keyof CommitmentRecord, value: string) => {
    if (!commitmentEditor) {
      return;
    }

    setCommitmentEditor({ ...commitmentEditor, [field]: value });
  };

  const handleCommitmentSave = () => {
    if (!commitmentEditor || !commitmentEditor.commitmentName.trim()) {
      return;
    }

    const nextCommitment: CommitmentRecord = {
      ...commitmentEditor,
      id: commitmentEditor.id || generateFinanceRecordId("commitment"),
      commitmentName: commitmentEditor.commitmentName.trim(),
      amount: commitmentEditor.amount.trim(),
      notes: commitmentEditor.notes.trim(),
      dateCreated: commitmentEditor.dateCreated || new Date().toISOString(),
    };
    const isNew = !commitmentRecords.some((record) => record.id === nextCommitment.id);

    setCommitmentRecords((current) =>
      isNew ? [nextCommitment, ...current] : current.map((record) => record.id === nextCommitment.id ? nextCommitment : record),
    );
    setSelectedCommitmentId(nextCommitment.id);
    setCommitmentEditor(nextCommitment);
    setFeedback({ type: "success", message: isNew ? "Commitment created." : "Commitment saved." });
  };

  const handleCreateCommitment = () => {
    const newCommitment: CommitmentRecord = {
      ...defaultCommitmentForm,
      id: generateFinanceRecordId("commitment"),
      dateCreated: new Date().toISOString(),
    };

    setSelectedCommitmentId(newCommitment.id);
    setCommitmentEditor(newCommitment);
  };

  return (
    <div className="min-h-screen bg-[#f1efe9] text-[#171717]">
      <div className="flex min-h-screen">
        <aside className="w-[260px] shrink-0 border-r border-[#cfc8c1] bg-[#f7f4f1] px-4 py-5">
          <div className="px-2 pb-6">
            <div className="text-[10px] font-medium uppercase tracking-[0.24em] text-[#5e5953]">
              Empire OS
            </div>
            <div className="mt-3 text-[22px] font-semibold tracking-[-0.06em] text-[#171717]">
              Empire
            </div>
          </div>

          <nav className="space-y-1.5">
            {navigation.map((item) => {
              const active = item === activeView;

              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    if (
                      item === "Command" ||
                      item === "Empire" ||
                      item === "Capture" ||
                      item === "Problems" ||
                      item === "Opportunities" ||
                      item === "Actions" ||
                      item === "Decisions" ||
                      item === "Lessons" ||
                      item === "Projects" ||
                      item === "Systems" ||
                      item === "SOPs" ||
                      item === "Leads" ||
                      item === "Finance" ||
                      item === "Metrics" ||
                      item === "Pillars" ||
                      item === "People"
                    ) {
                      setActiveView(item as DestinationKey);
                    }
                  }}
                  className={[
                    "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors duration-150",
                    active
                      ? "bg-[#e7e1da] text-[#171717] shadow-[inset_0_0_0_1px_rgba(23,23,23,0.08)]"
                      : "text-[#4d4944] hover:bg-[#efeae5] hover:text-[#171717]",
                  ].join(" ")}
                >
                  <span className="font-medium tracking-[-0.02em]">{item}</span>
                  {active ? <span className="h-2.5 w-2.5 rounded-full bg-[#171717]" /> : null}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 bg-[#f3f1ee]">
          {feedback?.type === "success" && (feedback.message === "Action details saved." || feedback.message === "Decision details saved." || feedback.message === "Problem details saved." || feedback.message === "Opportunity details saved." || feedback.message === "Lesson details saved.") ? (
            <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 lg:px-8">
              <p aria-live="polite" className="w-fit rounded-lg border border-[#cfc8c1] bg-[#f2efe9] px-3 py-2 text-[12px] font-medium text-[#2f2b28]">
                {feedback.message === "Lesson details saved." ? "Lesson saved" : feedback.message === "Opportunity details saved." ? "Opportunity saved" : feedback.message === "Problem details saved." ? "Problem saved" : feedback.message === "Decision details saved." ? "Decision saved" : "Action saved"}
              </p>
            </div>
          ) : null}
          {activeView === "Command" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">
                    Executive attention
                  </p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">
                    Command
                  </h1>
                </div>
                <span className="rounded-full border border-[#cfc8c1] bg-[#f7f4f1] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#2f2b28]">
                  {executiveAttentionItems} item{executiveAttentionItems === 1 ? "" : "s"}
                </span>
              </header>

              <div className="mt-5">
                <TodayBrief
                  posture={todayBrief.posture}
                  postureIsClear={todayBrief.postureIsClear}
                  steps={todayBrief.steps}
                  delegation={todayBrief.delegation}
                  delegationIsClear={todayBrief.delegationIsClear}
                  freshness={todayBrief.freshness}
                  freshnessIsClear={todayBrief.freshnessIsClear}
                  growth={todayBrief.growth}
                  growthIsClear={todayBrief.growthIsClear}
                  progress={todayProgressText}
                  deskIsClear={deskIsClear}
                  trendItems={trendItems}
                  sevenDayShape={sevenDayShape}
                  postureChange={postureChange}
                  onOpenRecord={handleOpenAttentionRecord}
                  onOpenStep={handleOpenTodayStep}
                />
              </div>

              <div className="mt-5">
                <FounderFocusList items={founderFocusList} onOpen={handleOpenAttentionRecord} />
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Attention items</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{executiveAttentionItems}</div>
                </div>
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Overdue actions</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{overdueActionCount}</div>
                </div>
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Decisions due for review</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{decisionsDueForReviewCount}</div>
                </div>
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Critical/high problems</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{criticalHighProblemCount}</div>
                </div>
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Projects requiring attention</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{projectAttentionCount}</div>
                </div>
              </div>

              {attentionSummaryItems.length > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Attention composition summary">
                  {attentionSummaryItems.map((item) => (
                    <span
                      key={item.label}
                      className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#4d4944]"
                    >
                      {item.count} {getAttentionSummaryLabel(item.label, item.count)}
                    </span>
                  ))}
                </div>
              ) : null}

              {cashAttention.count > 0 ? (
                <div className="mt-4 rounded-2xl border border-[#c9b8a3] bg-[#f5efe6] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">Cash attention</div>
                    <span className="rounded-full border border-[#6a3328] bg-[#f8efeb] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#6a3328]">
                      {cashAttention.count} item{cashAttention.count === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {cashAttention.buffer ? (
                      <button
                        type="button"
                        onClick={() => handleOpenAttentionRecord("Finance", "cash-buffer")}
                        className="block w-full rounded-xl border border-[#d3cbc3] bg-white px-3 py-2.5 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                      >
                        <div className="text-[13px] font-medium text-[#171717]">{cashAttention.buffer.title}</div>
                        <div className="mt-0.5 text-[11px] text-[#4d4944]">{cashAttention.buffer.detail}</div>
                      </button>
                    ) : null}

                    {cashAttention.overdueCommitments.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => handleOpenAttentionRecord("Finance", `commitment:${item.id}`)}
                        className="block w-full rounded-xl border border-[#d3cbc3] bg-white px-3 py-2.5 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                      >
                        <div className="text-[13px] font-medium text-[#171717]">{item.title}</div>
                        <div className="mt-0.5 text-[11px] text-[#4d4944]">{item.detail}</div>
                      </button>
                    ))}

                    {cashAttention.overdueExpectedIncome.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => handleOpenAttentionRecord("Finance", `income:${item.id}`)}
                        className="block w-full rounded-xl border border-[#d3cbc3] bg-white px-3 py-2.5 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                      >
                        <div className="text-[13px] font-medium text-[#171717]">{item.title}</div>
                        <div className="mt-0.5 text-[11px] text-[#4d4944]">{item.detail}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {growthAttention.count > 0 ? (
                <div className="mt-4 rounded-2xl border border-[#b8c4a3] bg-[#f1f4ea] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">Growth attention</div>
                    <span className="rounded-full border border-[#4d5a2f] bg-[#eef2e3] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#4d5a2f]">
                      {growthAttention.count} item{growthAttention.count === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {growthAttention.stalledOpportunities.map((item) => (
                      <button
                        key={`growth-opp-${item.id}`}
                        type="button"
                        onClick={() => handleOpenAttentionRecord("Opportunity", item.id)}
                        className="block w-full rounded-xl border border-[#d3cbc3] bg-white px-3 py-2.5 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-[#4d5a2f] bg-[#eef2e3] px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[#4d5a2f]">Stalled high-fit opportunity</span>
                          <span className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[#4d4944]">{item.status}</span>
                        </div>
                        <div className="mt-1.5 text-[13px] font-medium text-[#171717]">{item.title}</div>
                        <div className="mt-0.5 text-[11px] text-[#4d4944]">
                          {item.strategicFit} fit • idle {item.ageDays} day{item.ageDays === 1 ? "" : "s"}{item.estimatedUpside > 0 ? ` • est. upside ${formatFinanceAmount(item.estimatedUpside)}` : ""} • {item.area}
                        </div>
                      </button>
                    ))}

                    {growthAttention.stalledLeads.map((item) => (
                      <button
                        key={`growth-lead-${item.id}`}
                        type="button"
                        onClick={() => handleOpenAttentionRecord("Lead", item.id)}
                        className="block w-full rounded-xl border border-[#d3cbc3] bg-white px-3 py-2.5 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-[#4d5a2f] bg-[#eef2e3] px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[#4d5a2f]">Stalled lead</span>
                          <span className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[#4d4944]">{item.status}</span>
                        </div>
                        <div className="mt-1.5 text-[13px] font-medium text-[#171717]">{item.title}</div>
                        <div className="mt-0.5 text-[11px] text-[#4d4944]">
                          {item.reason}{item.quoteValue > 0 ? ` • quote ${formatFinanceAmount(item.quoteValue)}` : ""} • {item.area}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {commandAttentionItems === 0 ? (
                <div className="mt-6 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[15px] text-[#4d4944]">
                  No current items require attention.
                </div>
              ) : (
                <div className="mt-6 space-y-5">
                  {commandAttentionGroups.map(({ label, items }) => (
                      <section key={label} className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4">
                        <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">
                          {label} <span className="ml-1 text-[#7a726b]">{items.length}</span>
                        </div>
                        <div className="space-y-2">
                          {items.map((item) => (
                            <div
                              key={`${item.objectType}-${item.id}-${item.reason}`}
                              onClick={item.onOpen}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  item.onOpen();
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              aria-label={`Open ${item.objectType}: ${item.title}`}
                              className="block w-full cursor-pointer rounded-xl border border-[#d3cbc3] bg-white px-3 py-3 text-left transition hover:border-[#171717] hover:bg-[#f5f2ee]"
                            >
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">
                                      {item.objectType}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-[0.14em] text-[#4d4944]">
                                      {item.reasons.join(" • ")}
                                    </span>
                                  </div>
                                  <div className="mt-2 text-[17px] font-medium tracking-[-0.04em] text-[#171717]">
                                    {item.title}
                                  </div>
                                  <p className="mt-1 text-[12px] leading-5 text-[#5e5953]">
                                    {getAttentionSummary(item)}
                                  </p>
                                  {item.objectType === "Project" ? (
                                    <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[#7a726b]">
                                      {getProjectIssueSummary(item)}
                                    </div>
                                  ) : null}
                                  {getProjectAttentionAge(item) ? (
                                    <div className="mt-1 text-[10px] text-[#7a726b]">
                                      {getProjectAttentionAge(item)}
                                    </div>
                                  ) : null}
                                </div>
                                <div className="text-[10px] uppercase tracking-[0.14em] text-[#4d4944]">
                                  {item.statusText}
                                </div>
                              </div>

                              <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                                {item.area ? (
                                  <span className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1">
                                    {item.area}
                                  </span>
                                ) : null}
                                {item.objectType === "Project" && item.reasons.includes("PAST START DATE • NOT STARTED") ? (
                                  <span className="rounded-full border border-[#6a3328] bg-[#f8efeb] px-2 py-1 text-[#6a3328]">
                                    Not started
                                  </span>
                                ) : null}
                                {item.objectType === "Project" ? (
                                  <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1 text-[#5e5953]">
                                    {getProjectTargetDateState(item)}
                                  </span>
                                ) : null}
                                <span className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1">
                                  {item.objectType}
                                </span>
                                <span className="rounded-full border border-[#cfc8c1] bg-[#f1efe9] px-2 py-1 text-[#2f2b28]">
                                  Open record
                                </span>
                                {item.objectType === "Project" && (item.reasons.includes("OVERDUE PROJECT") || item.reasons.includes("DUE WITHIN 7 DAYS") || item.reasons.includes("PAST START DATE • NOT STARTED")) ? (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      item.onOpen();
                                    }}
                                    className="rounded-full border border-[#6a3328] bg-[#f8efeb] px-2 py-1 text-[#6a3328] hover:bg-[#f1dfd8]"
                                  >
                                    Review date
                                  </button>
                                ) : null}
                                {item.objectType === "Project" && item.statusText.startsWith("Blocked /") ? (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      item.onOpen();
                                    }}
                                    className="rounded-full border border-[#6a3328] bg-[#f8efeb] px-2 py-1 text-[#6a3328] hover:bg-[#f1dfd8]"
                                  >
                                    Review status
                                  </button>
                                ) : null}
                                {item.dependencyAction ? (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      item.dependencyAction?.onOpen();
                                    }}
                                    className="rounded-full border border-[#6a3328] bg-[#f8efeb] px-2 py-1 text-[#6a3328] hover:bg-[#f1dfd8]"
                                  >
                                    {item.dependencyAction.label}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                  ))}
                </div>
              )}

              <CommandRecordRegister
                groups={commandRecordGroups}
                attentionRecordKeys={commandAttentionItemList.map((item) => `${item.objectType}:${item.id}`)}
                testSourceCaptureIds={captures.filter((capture) => isObviousTestTitle(capture.title)).map((capture) => capture.id)}
              />
            </div>
          ) : activeView === "Empire" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">Empire layer</p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">Empire</h1>
                </div>
              </header>

              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#43403b]">
                This view brings together the founder-facing decisions, risk signals, and escalation points already represented across the operating records.
              </p>

              <div className="mt-6">
                <FounderFocusList items={founderFocusList} onOpen={handleOpenAttentionRecord} />
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Founder review queue</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{empireDecisionQueue.founderReviewQueue.length}</div>
                </div>
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Pillars at risk</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{empireDecisionQueue.riskByPillar.length}</div>
                </div>
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Cross-pillar issues</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{empireDecisionQueue.crossPillarIssues.length}</div>
                </div>
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Delegate to owner</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{empireDecisionQueue.delegateItems.length}</div>
                </div>
              </div>

              <div className="mt-8 space-y-6">
                <section className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4">
                  <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">Founder review queue</div>
                  {empireDecisionQueue.founderReviewQueue.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#d3cbc3] bg-white px-3 py-4 text-[13px] text-[#4d4944]">No items currently require founder review.</div>
                  ) : (
                    <div className="space-y-2">
                      {empireDecisionQueue.founderReviewQueue.map((item) => (
                        <button
                          key={`${item.kind}-${item.id}`}
                          type="button"
                          onClick={() => handleOpenAttentionRecord(item.kind, item.id)}
                          className="block w-full rounded-xl border border-[#d3cbc3] bg-white px-3 py-3 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">{item.kind}</span>
                            <span className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#4d4944]">{item.pillar}</span>
                            <span className="rounded-full border border-[#cfc8c1] bg-[#f1efe9] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">Open record</span>
                          </div>
                          <div className="mt-2 text-[17px] font-medium tracking-[-0.04em] text-[#171717]">{item.title}</div>
                          <div className="mt-2 text-[12px] leading-5 text-[#524d49]">
                            <div><span className="font-medium text-[#171717]">What is changing:</span> {item.whatIsChanging}</div>
                            <div className="mt-1"><span className="font-medium text-[#171717]">Why it matters:</span> {item.whyItMatters}</div>
                            <div className="mt-1"><span className="font-medium text-[#171717]">Owner:</span> {item.owner}</div>
                            <div className="mt-1"><span className="font-medium text-[#171717]">Founder intervention:</span> {item.founderIntervention}</div>
                            <div className="mt-1"><span className="font-medium text-[#171717]">Delegation:</span> {item.delegationAction}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">Decision track record</div>
                    <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">
                      {decisionTrackRecord.reviewsDue.length} review{decisionTrackRecord.reviewsDue.length === 1 ? "" : "s"} due
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <MetricCard label="Reviews due" value={String(decisionTrackRecord.reviewsDue.length)} />
                    <MetricCard label="Reviewed" value={String(decisionTrackRecord.reviewedDecisions.length)} />
                    <MetricCard label="Lessons created" value={String(decisionTrackRecord.lessonsCreated)} />
                    <MetricCard
                      label="Worked / Failed"
                      value={`${decisionTrackRecord.ratings.worked} / ${decisionTrackRecord.ratings.failed}`}
                    />
                  </div>

                  {decisionTrackRecord.reviewsDue.length > 0 ? (
                    <div className="mt-4">
                      <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#4d4944]">Reviews due now</div>
                      <div className="space-y-2">
                        {decisionTrackRecord.reviewsDue.map((decision) => (
                          <button
                            key={`review-due-${decision.id}`}
                            type="button"
                            onClick={() => handleOpenAttentionRecord("Decision", decision.id)}
                            className="block w-full rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                          >
                            <div className="text-[13px] font-medium text-[#171717]">{decision.decisionTitle}</div>
                            <div className="mt-1 text-[11px] text-[#4d4944]">
                              {decision.decisionMaker || "Unassigned"} • {decision.decisionStatus} • Review {decision.reviewDate ? decision.reviewDate.slice(0, 10) : "not set"}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {decisionTrackRecord.reviewedDecisions.length > 0 ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-[#d3cbc3] bg-white px-3 py-2 text-[12px] text-[#2f2b28]">
                        <span className="font-medium text-[#171717]">Worked:</span> {decisionTrackRecord.ratings.worked}
                      </div>
                      <div className="rounded-xl border border-[#d3cbc3] bg-white px-3 py-2 text-[12px] text-[#2f2b28]">
                        <span className="font-medium text-[#171717]">Partially worked:</span> {decisionTrackRecord.ratings.partially}
                      </div>
                      <div className="rounded-xl border border-[#d3cbc3] bg-white px-3 py-2 text-[12px] text-[#2f2b28]">
                        <span className="font-medium text-[#171717]">Failed:</span> {decisionTrackRecord.ratings.failed}
                      </div>
                    </div>
                  ) : null}

                  {decisionTrackRecord.byPillar.length > 0 ? (
                    <div className="mt-4">
                      <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#4d4944]">By pillar</div>
                      <div className="flex flex-wrap gap-2">
                        {decisionTrackRecord.byPillar.map((entry) => (
                          <span key={entry.pillar} className="rounded-full border border-[#d3cbc3] bg-white px-2.5 py-1.5 text-[11px] text-[#2f2b28]">
                            {entry.pillar}: {entry.total} reviewed ({entry.worked} worked, {entry.failed} failed)
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {decisionTrackRecord.byMaker.length > 0 ? (
                    <div className="mt-4">
                      <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#4d4944]">By decision maker</div>
                      <div className="flex flex-wrap gap-2">
                        {decisionTrackRecord.byMaker.map((entry) => (
                          <span key={entry.maker} className="rounded-full border border-[#d3cbc3] bg-white px-2.5 py-1.5 text-[11px] text-[#2f2b28]">
                            {entry.maker}: {entry.total} reviewed ({entry.worked} worked, {entry.failed} failed)
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {decisionTrackRecord.reviewedDecisions.length === 0 && decisionTrackRecord.reviewsDue.length === 0 ? (
                    <div className="mt-4 rounded-xl border border-dashed border-[#d3cbc3] bg-white px-3 py-4 text-[13px] text-[#4d4944]">
                      No decisions reviewed yet. When a decision is due, open it, record the actual outcome and rating, and set the final status.
                    </div>
                  ) : null}
                </section>

                <section className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4">
                  <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">Capital allocation</div>

                  <p className="mb-3 max-w-3xl text-[13px] leading-5 text-[#524d49]">
                    Live opportunities lined up against deployable cash. Capital efficiency and time are shown as separate dimensions — no composite score, and affordability here is not a recommendation to spend.
                  </p>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-[#d3cbc3] bg-white px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[#4d4944]">Deployable cash</div>
                      <div className="mt-1.5 text-[22px] font-semibold tracking-[-0.05em] text-[#171717]">
                        {capitalAllocation.cashConfigured && capitalAllocation.deployableCash !== null ? formatFinanceAmount(capitalAllocation.deployableCash) : "—"}
                      </div>
                      <div className="mt-1 text-[11px] leading-4 text-[#4d4944]">
                        {capitalAllocation.cashConfigured
                          ? "Available operating cash above the protected safety buffer."
                          : "Cash position is not configured, so deployable cash above buffer cannot be derived safely."}
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#d3cbc3] bg-white px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[#4d4944]">Capital required (high-fit)</div>
                      <div className="mt-1.5 text-[22px] font-semibold tracking-[-0.05em] text-[#171717]">
                        {capitalAllocation.highFitCapitalRequired !== null ? formatFinanceAmount(capitalAllocation.highFitCapitalRequired) : "—"}
                      </div>
                      <div className="mt-1 text-[11px] leading-4 text-[#4d4944]">
                        {capitalAllocation.highFitCapitalRequired !== null
                          ? "Total stated required capital across live High/Exceptional-fit opportunities with a valid capital figure."
                          : capitalAllocation.highFitOpportunityCount > 0
                            ? "Not enough data — capital requirements have not yet been stated for the live high-fit opportunities."
                            : "No live high-fit opportunities."}
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#d3cbc3] bg-white px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[#4d4944]">Live opportunities</div>
                      <div className="mt-1.5 text-[22px] font-semibold tracking-[-0.05em] text-[#171717]">
                        {capitalAllocation.liveOpportunities.length}
                      </div>
                      <div className="mt-1 text-[11px] leading-4 text-[#4d4944]">
                        New, Evaluating, On Hold or Approved — not yet decided or completed.
                      </div>
                    </div>
                  </div>

                  {capitalAllocation.liveOpportunities.length === 0 ? (
                    <div className="mt-3 rounded-xl border border-dashed border-[#d3cbc3] bg-white px-3 py-4 text-[13px] text-[#4d4944]">
                      No live opportunities to allocate against.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {capitalAllocation.liveOpportunities.map((opp, index) => {
                        const affordable = capitalAllocation.deployableCash !== null && opp.capital !== null && opp.capital <= capitalAllocation.deployableCash;
                        return (
                          <button
                            key={opp.id}
                            type="button"
                            onClick={() => handleOpenAttentionRecord("Opportunity", opp.id)}
                            className="block w-full rounded-xl border border-[#d3cbc3] bg-white px-3 py-3 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">#{index + 1}</span>
                              <span className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[#4d4944]">{opp.strategicFit} fit</span>
                              <span className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[#4d4944]">{opp.status}</span>
                              {opp.capital !== null && capitalAllocation.deployableCash !== null ? (
                                <span className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] ${affordable ? "border-[#2f5d3a] bg-[#eef4ee] text-[#2f5d3a]" : "border-[#6a3328] bg-[#f8efeb] text-[#6a3328]"}`}>
                                  {affordable ? "Within deployable cash" : "Exceeds deployable cash"}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1.5 text-[15px] font-medium tracking-[-0.04em] text-[#171717]">{opp.title}</div>
                            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] leading-4 text-[#4d4944]">
                              <span><span className="font-medium text-[#171717]">Upside:</span> {opp.upside !== null ? formatFinanceAmount(opp.upside) : "Not stated"}</span>
                              <span><span className="font-medium text-[#171717]">Capital:</span> {opp.capital !== null ? formatFinanceAmount(opp.capital) : "Not stated"}</span>
                              <span><span className="font-medium text-[#171717]">Time:</span> {opp.requiredTime || "Not stated"}</span>
                              <span><span className="font-medium text-[#171717]">Pillar:</span> {opp.area}</span>
                            </div>
                            <div className="mt-1 text-[11px] leading-4 text-[#4d4944]">
                              {opp.efficiency !== null
                                ? `≈ £${opp.efficiency.toFixed(2)} estimated upside per £1 required.`
                                : opp.capital === null
                                  ? "No capital requirement stated — capital efficiency N/A."
                                  : "No valid upside figure — capital efficiency N/A."}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-4">
                    <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#4d4944]">Historical won value by pillar <span className="normal-case tracking-normal text-[#7a726b]">(current evidence only — not proof of future return)</span></div>
                    {capitalAllocation.totalWonValue === 0 && capitalAllocation.pillarReturn.every((p) => p.liveCount === 0) ? (
                      <div className="rounded-xl border border-dashed border-[#d3cbc3] bg-white px-3 py-3 text-[12px] text-[#4d4944]">
                        Insufficient evidence — too little won-value or live-opportunity history to compare pillars.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {capitalAllocation.pillarReturn.map((p) => (
                          <span key={p.pillar} className="rounded-full border border-[#d3cbc3] bg-white px-2.5 py-1.5 text-[11px] text-[#2f2b28]">
                            {p.pillar}: {formatFinanceAmount(p.wonValue)} won • {p.liveCount} live{p.wonPerLiveOpportunity !== null ? ` • ${formatFinanceAmount(p.wonPerLiveOpportunity)}/live` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4">
                  <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">Organisational health &amp; self-sufficiency</div>

                  <p className="mb-3 max-w-3xl text-[13px] leading-5 text-[#524d49]">
                    Whether the business can run without the founder carrying it. These are derived from current ownership, delegation and decision records — not targets.
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-[#d3cbc3] bg-white px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[#4d4944]">Delegation quality</div>
                      <div className="mt-1.5 text-[22px] font-semibold tracking-[-0.05em] text-[#171717]">{organisationalHealth.delegationQuality.label}</div>
                      <div className="mt-1.5 space-y-0.5 text-[11px] leading-4 text-[#4d4944]">
                        {organisationalHealth.pctValidOwner !== null ? <div>{organisationalHealth.pctValidOwner}% valid owner</div> : null}
                        {organisationalHealth.pctNonFounder !== null ? <div>{organisationalHealth.pctNonFounder}% not founder-owned</div> : null}
                        <div>{organisationalHealth.pctDelegatedStalled !== null ? `${organisationalHealth.pctDelegatedStalled}% of delegated work stalled / at risk` : "No delegated work — stalled share N/A"}</div>
                        {organisationalHealth.topOwnerShare !== null ? <div>Top owner carries {organisationalHealth.topOwnerShare}%</div> : null}
                      </div>
                      {healthTrend.delegation ? <div className="mt-1.5 text-[10px] text-[#4d4944]">{healthTrend.delegation}</div> : null}
                    </div>

                    <div className="rounded-xl border border-[#d3cbc3] bg-white px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[#4d4944]">Flows without founder</div>
                      <div className="mt-1.5 text-[22px] font-semibold tracking-[-0.05em] text-[#171717]">
                        {organisationalHealth.selfSufficiencyPct === null ? "—" : `${organisationalHealth.selfSufficiencyPct}%`}
                      </div>
                      <div className="mt-1.5 text-[11px] leading-4 text-[#4d4944]">
                        {organisationalHealth.selfSufficiencyPct === null
                          ? "No active work to measure."
                          : `${organisationalHealth.selfSufficiencyPct}% of actively owned work is owned by someone other than the founder.`}
                      </div>
                      {healthTrend.selfSufficiency ? <div className="mt-1.5 text-[10px] text-[#4d4944]">{healthTrend.selfSufficiency}</div> : null}
                    </div>

                    <div className="rounded-xl border border-[#d3cbc3] bg-white px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[#4d4944]">Avg open decision age</div>
                      <div className="mt-1.5 text-[22px] font-semibold tracking-[-0.05em] text-[#171717]">
                        {organisationalHealth.avgOpenDecisionDays === null ? "—" : `${organisationalHealth.avgOpenDecisionDays}d`}
                      </div>
                      <div className="mt-1.5 text-[11px] leading-4 text-[#4d4944]">
                        {organisationalHealth.avgOpenDecisionDays === null
                          ? "No open decisions to measure."
                          : `${organisationalHealth.openDecisionCount} open decision${organisationalHealth.openDecisionCount === 1 ? "" : "s"}, average age.`}
                      </div>
                      {healthTrend.latency ? <div className="mt-1.5 text-[10px] text-[#4d4944]">{healthTrend.latency}</div> : null}
                    </div>

                    <div className="rounded-xl border border-[#d3cbc3] bg-white px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[#4d4944]">Avg time to close decisions</div>
                      <div className="mt-1.5 text-[22px] font-semibold tracking-[-0.05em] text-[#171717]">
                        {organisationalHealth.avgClosedDecisionDays === null ? "—" : `${organisationalHealth.avgClosedDecisionDays}d`}
                      </div>
                      <div className="mt-1.5 text-[11px] leading-4 text-[#4d4944]">
                        {organisationalHealth.avgClosedDecisionDays === null
                          ? "No closed decisions yet."
                          : `Across ${organisationalHealth.closedDecisionCount} closed decision${organisationalHealth.closedDecisionCount === 1 ? "" : "s"}.`}
                      </div>
                    </div>
                  </div>

                  {organisationalHealth.delegationQuality.label === "Insufficient data" ? (
                    <div className="mt-3 rounded-xl border border-dashed border-[#d3cbc3] bg-white px-3 py-2.5 text-[12px] text-[#4d4944]">
                      Limited data — delegation quality is indicative only until more active work has valid owners.
                    </div>
                  ) : null}
                </section>

                <section className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4">
                  <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">Current risks by pillar</div>
                  {empireDecisionQueue.riskByPillar.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#d3cbc3] bg-white px-3 py-4 text-[13px] text-[#4d4944]">No pillar risks are currently active.</div>
                  ) : (
                    <div className="space-y-3">
                      {empireDecisionQueue.riskByPillar.map((pillar) => (
                        <div key={pillar.pillar} className="rounded-xl border border-[#d3cbc3] bg-white px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[17px] font-medium tracking-[-0.04em] text-[#171717]">{pillar.pillar}</div>
                            <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">Risk {pillar.riskScore}</span>
                          </div>
                          <div className="mt-2 text-[12px] leading-5 text-[#524d49]">
                            <div><span className="font-medium text-[#171717]">Blocked projects:</span> {pillar.blockedProjects.length}</div>
                            <div><span className="font-medium text-[#171717]">Critical/high problems:</span> {pillar.criticalProblems.length}</div>
                            <div><span className="font-medium text-[#171717]">Overdue actions:</span> {pillar.overdueActions.length}</div>
                            <div><span className="font-medium text-[#171717]">Active decisions:</span> {pillar.activeDecisions.length}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-[#6a3328] bg-[#f9f7f4] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">Convergent risk</div>
                    <span className="rounded-full border border-[#6a3328] bg-[#f8efeb] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#6a3328]">
                      {correlationLayer.convergentRisks.length} situation{correlationLayer.convergentRisks.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <p className="mb-3 max-w-3xl text-[13px] leading-5 text-[#524d49]">
                    These are single underlying situations generating signals across three or more categories at once — recurring problem, blocked work, overdue decision, cash or growth pressure touching the same linked records. They are systemic, not isolated, and deserve founder attention first.
                  </p>

                  {correlationLayer.convergentRisks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#d3cbc3] bg-white px-3 py-4 text-[13px] text-[#4d4944]">
                      No situation is currently generating signals across three or more categories at once.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {correlationLayer.convergentRisks.map((cluster) => (
                        <div key={cluster.clusterKey} className="rounded-xl border border-[#d3cbc3] bg-white px-3 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-[#6a3328] bg-[#f8efeb] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#6a3328]">Convergent risk</span>
                            <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">{cluster.recordCount} records</span>
                            <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">{cluster.categories.size} categories</span>
                          </div>
                          <div className="mt-2 text-[16px] font-medium tracking-[-0.04em] text-[#171717]">{cluster.title}</div>
                          <div className="mt-2 text-[12px] leading-5 text-[#524d49]">
                            <span className="font-medium text-[#171717]">Why this is systemic:</span> one linked situation is producing {[...cluster.categories].join(", ")} at the same time, so fixing one symptom will not clear it.
                          </div>
                          <div className="mt-2.5 space-y-1">
                            {cluster.records.map((record) => (
                              <button
                                key={record.recordKey}
                                type="button"
                                onClick={() => handleOpenAttentionRecord(record.objectType, record.id)}
                                className="block w-full rounded-lg border border-[#d3cbc3] bg-[#f9f7f4] px-2.5 py-2 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                              >
                                <div className="text-[13px] font-medium text-[#171717]">{record.title}</div>
                                <div className="mt-0.5 text-[11px] text-[#4d4944]">{record.objectType} • {[...record.signals].join(", ")}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">Problems that keep coming back</div>
                    <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">
                      {recurringProblemLearning.gaps.length} learning gap{recurringProblemLearning.gaps.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <p className="mb-3 max-w-3xl text-[13px] leading-5 text-[#524d49]">
                    Recurring or persistent problems are evidence of a weak system, not a one-off event. Resolve them into a Lesson, System or SOP so the fix becomes institutional rather than relearned.
                  </p>

                  {recurringProblemLearning.unresolvedRecurring.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#d3cbc3] bg-white px-3 py-4 text-[13px] text-[#4d4944]">
                      No recurring or persistent problems are currently unresolved.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {recurringProblemLearning.unresolvedRecurring.map((problem) => {
                        const gap = recurringProblemLearning.gaps.some((entry) => entry.id === problem.id);
                        return (
                          <button
                            key={`recurring-${problem.id}`}
                            type="button"
                            onClick={() => handleOpenAttentionRecord("Problem", problem.id)}
                            className="block w-full rounded-xl border border-[#d3cbc3] bg-white px-3 py-3 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">{problem.frequency}</span>
                              <span className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#4d4944]">{problem.severity}</span>
                              {gap ? (
                                <span className="rounded-full border border-[#6a3328] bg-[#f8efeb] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#6a3328]">
                                  Learning not yet captured
                                </span>
                              ) : (
                                <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">
                                  Learning captured
                                </span>
                              )}
                            </div>
                            <div className="mt-2 text-[16px] font-medium tracking-[-0.04em] text-[#171717]">{problem.problemStatement || problem.title}</div>
                            <div className="mt-1 text-[11px] text-[#4d4944]">
                              {(getAreaText(problem) || "Unassigned")} • {problem.owner || "Unassigned"} • {problem.problemStatus}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">Decisions without execution</div>
                    <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">
                      {decisionsWithoutExecution.length} gap{decisionsWithoutExecution.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <p className="mb-3 max-w-3xl text-[13px] leading-5 text-[#524d49]">
                    An active or under-review decision with no open linked action exists on paper only. Create a linked action so the decision becomes someone&apos;s work.
                  </p>

                  {decisionsWithoutExecution.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#d3cbc3] bg-white px-3 py-4 text-[13px] text-[#4d4944]">
                      Every active decision has an open execution path.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {decisionsWithoutExecution.map((decision) => (
                        <button
                          key={`no-exec-${decision.id}`}
                          type="button"
                          onClick={() => handleOpenAttentionRecord("Decision", decision.id)}
                          className="block w-full rounded-xl border border-[#d3cbc3] bg-white px-3 py-3 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-[#6a3328] bg-[#f8efeb] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#6a3328]">
                              {decision.reason}
                            </span>
                            <span className="rounded-full border border-[#d3cbc3] bg-[#f9f7f4] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#4d4944]">{decision.status}</span>
                          </div>
                          <div className="mt-2 text-[16px] font-medium tracking-[-0.04em] text-[#171717]">{decision.title}</div>
                          <div className="mt-1 text-[11px] text-[#4d4944]">
                            {decision.area} • {decision.owner}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4">
                    <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">Cross-pillar issues</div>
                    {empireDecisionQueue.crossPillarIssues.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[#d3cbc3] bg-white px-3 py-4 text-[13px] text-[#4d4944]">No cross-pillar issues are currently flagged.</div>
                    ) : (
                      <div className="space-y-2">
                        {empireDecisionQueue.crossPillarIssues.map((issue) => (
                          <button
                            key={`${issue.kind}-${issue.id}`}
                            type="button"
                            onClick={() => handleOpenAttentionRecord(issue.objectType, issue.id)}
                            className="block w-full rounded-xl border border-[#d3cbc3] bg-white px-3 py-3 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                          >
                            <div className="text-[15px] font-medium tracking-[-0.04em] text-[#171717]">{issue.title}</div>
                            <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[#4d4944]">{issue.kind} • {issue.area}</div>
                            <div className="mt-2 text-[12px] leading-5 text-[#524d49]">{issue.why}</div>
                            <div className="mt-2 text-[12px] leading-5 text-[#524d49]">
                              <span className="font-medium text-[#171717]">Owner:</span> {issue.owner}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4">
                    <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">Delegation vs founder authority</div>
                    <div className="space-y-4">
                      <div className="rounded-xl border border-[#d3cbc3] bg-white px-3 py-3">
                        <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-[#4d4944]">Should be delegated</div>
                        {empireDecisionQueue.delegateItems.length === 0 ? (
                          <div className="mt-2 text-[12px] text-[#4d4944]">No routine items are ready for delegation.</div>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {empireDecisionQueue.delegateItems.map((item) => (
                              <button
                                key={`delegate-${item.id}`}
                                type="button"
                                onClick={() => handleOpenAttentionRecord(item.objectType, item.id)}
                                className="block w-full rounded-lg border border-[#d3cbc3] bg-[#f9f7f4] px-2.5 py-2 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                              >
                                <div className="text-[13px] font-medium text-[#171717]">{item.title}</div>
                                <div className="mt-1 text-[11px] text-[#4d4944]">{item.pillar} • {item.owner}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl border border-[#d3cbc3] bg-white px-3 py-3">
                        <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-[#4d4944]">Requires founder authority</div>
                        {empireDecisionQueue.founderAuthorityItems.length === 0 ? (
                          <div className="mt-2 text-[12px] text-[#4d4944]">No current items clearly require founder authority.</div>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {empireDecisionQueue.founderAuthorityItems.map((item) => (
                              <button
                                key={`founder-${item.id}`}
                                type="button"
                                onClick={() => handleOpenAttentionRecord(item.objectType, item.id)}
                                className="block w-full rounded-lg border border-[#d3cbc3] bg-[#f9f7f4] px-2.5 py-2 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                              >
                                <div className="text-[13px] font-medium text-[#171717]">{item.title}</div>
                                <div className="mt-1 text-[11px] text-[#4d4944]">{item.pillar} • {item.owner}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          ) : activeView === "Projects" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">Operational record</p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">Projects</h1>
                </div>
                <button type="button" onClick={handleCreateProject} className="rounded-lg border border-[#171717] bg-[#171717] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition hover:bg-[#2a2724]">Create Project</button>
              </header>

              {projects.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[14px] text-[#4d4944]">No Projects yet. Create the first project to establish planned operational work.</div>
              ) : (
                <div className="mt-6 space-y-3">
                  {projects.map((project) => (
                    <button key={project.id} type="button" onClick={() => handleProjectEditOpen(project)} className="block w-full rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-4 text-left transition hover:border-[#171717] hover:bg-[#f4f0ec]">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <h2 className="text-[20px] font-medium tracking-[-0.05em] text-[#171717]">{project.projectName}</h2>
                        </div>
                        <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">{project.status || "No status"}</span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{project.area}</span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{project.owner || "Unassigned"}</span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{project.startDate ? `Start ${formatCapturedAt(project.startDate)}` : "No start date"}</span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{project.targetCompletionDate ? `Target ${formatCapturedAt(project.targetCompletionDate)}` : "No target completion date"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : activeView === "Leads" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">Lead tracking</p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">Leads</h1>
                </div>
                <button type="button" onClick={handleCreateLead} className="rounded-lg border border-[#171717] bg-[#171717] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition hover:bg-[#2a2724]">Create Lead</button>
              </header>

              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#43403b]">
                Lead records track incoming work from first contact through quote, follow-up and outcome so no potential job disappears into messages.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowArchivedLeads(false)}
                  className={[
                    "rounded-lg border px-2.5 py-1.5 text-[11px] transition",
                    !showArchivedLeads
                      ? "border-[#171717] bg-[#171717] text-[#f7f4f1]"
                      : "border-[#cfc8c1] bg-white text-[#2f2b28] hover:border-[#171717]",
                  ].join(" ")}
                >
                  Active ({orderedLeads.length})
                </button>
                <button
                  type="button"
                  onClick={() => setShowArchivedLeads(true)}
                  className={[
                    "rounded-lg border px-2.5 py-1.5 text-[11px] transition",
                    showArchivedLeads
                      ? "border-[#171717] bg-[#171717] text-[#f7f4f1]"
                      : "border-[#cfc8c1] bg-white text-[#2f2b28] hover:border-[#171717]",
                  ].join(" ")}
                >
                  Archived ({archivedLeads.length})
                </button>
              </div>

              {showArchivedLeads ? (
                orderedArchivedLeads.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[14px] text-[#4d4944]">No archived leads.</div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {orderedArchivedLeads.map((lead) => (
                      <div key={lead.id} className="block w-full rounded-2xl border border-[#d3cbc3] bg-[#f4f0ec] px-4 py-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <button type="button" onClick={() => handleLeadEditOpen(lead)} className="min-w-0 flex-1 text-left">
                            <h2 className="text-[20px] font-medium tracking-[-0.05em] text-[#171717]">{lead.leadName}</h2>
                            <p className="mt-2 text-[14px] leading-6 text-[#424039]">{lead.serviceRequested || "Service not specified"}</p>
                          </button>
                          <div className="flex items-center gap-2">
                            <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">{lead.status}</span>
                            <button
                              type="button"
                              onClick={() => handleLeadArchiveToggle(lead, false)}
                              className="rounded-lg border border-[#171717] bg-white px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#171717] hover:bg-[#f1eee9]"
                            >
                              Restore
                            </button>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                          <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{lead.sourceChannel}</span>
                          <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{lead.owner || "Unassigned"}</span>
                          <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1.5">{lead.relatedPillar}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : orderedLeads.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[14px] text-[#4d4944]">No active leads yet. Create the first lead to start tracking incoming work.</div>
              ) : (
                <>
                  <div className="mt-6 flex flex-wrap items-center gap-2">
                    <select value={leadStatusFilter} onChange={(event) => setLeadStatusFilter(event.target.value)} className="rounded-lg border border-[#cfc8c1] bg-white px-2.5 py-1.5 text-[11px] text-[#2f2b28] outline-none transition focus:border-[#171717]">
                      <option value="All statuses">All statuses</option>
                      {leadStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                    <select value={leadSourceFilter} onChange={(event) => setLeadSourceFilter(event.target.value)} className="rounded-lg border border-[#cfc8c1] bg-white px-2.5 py-1.5 text-[11px] text-[#2f2b28] outline-none transition focus:border-[#171717]">
                      <option value="All sources">All sources</option>
                      {leadSourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
                    </select>
                    <select value={leadOwnerFilter} onChange={(event) => setLeadOwnerFilter(event.target.value)} className="rounded-lg border border-[#cfc8c1] bg-white px-2.5 py-1.5 text-[11px] text-[#2f2b28] outline-none transition focus:border-[#171717]">
                      <option value="All owners">All owners</option>
                      {leadOwnerFilterOptions.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
                    </select>
                    <span className="text-[11px] text-[#5d584f]">{filteredLeads.length} of {orderedLeads.length} lead{orderedLeads.length === 1 ? "" : "s"}</span>
                  </div>

                  {filteredLeads.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[14px] text-[#4d4944]">No leads match the selected filters.</div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {filteredLeads.map((lead) => (
                        <button key={lead.id} type="button" onClick={() => handleLeadEditOpen(lead)} className="block w-full rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-4 text-left transition hover:border-[#171717] hover:bg-[#f4f0ec]">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 flex-1">
                              <h2 className="text-[20px] font-medium tracking-[-0.05em] text-[#171717]">{lead.leadName}</h2>
                              <p className="mt-2 text-[14px] leading-6 text-[#424039]">{lead.serviceRequested || "Service not specified"}</p>
                            </div>
                            <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">{lead.status}</span>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                            <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{lead.sourceChannel}</span>
                            <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{lead.quoteValue ? `Quote ${lead.quoteValue}` : "No quote value"}</span>
                            <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{lead.followUpDate ? `Follow-up ${formatCapturedAt(lead.followUpDate)}` : "No follow-up"}</span>
                            <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{lead.owner || "Unassigned"}</span>
                            <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1.5">{lead.relatedPillar}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : activeView === "Finance" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">Financial operations</p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">Finance</h1>
                </div>
                <button type="button" onClick={handleCashPositionOpen} className="rounded-lg border border-[#171717] bg-[#171717] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition hover:bg-[#2a2724]">Update cash position</button>
              </header>

              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#43403b]">
                Track cash position, income, expenses and financial commitments so the business always knows its real operating position.
              </p>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Total received income</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{formatFinanceAmount(totalReceivedIncome)}</div>
                </div>
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Total paid expenses</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{formatFinanceAmount(totalPaidExpenses)}</div>
                </div>
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Net cash movement</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{formatFinanceAmount(netCashMovement)}</div>
                </div>
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Reserved tax</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{formatFinanceAmount(reservedTaxAmount)}</div>
                </div>
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Safety buffer</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{formatFinanceAmount(safetyBufferAmount)}</div>
                </div>
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Available operating cash</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{formatFinanceAmount(availableOperatingCash)}</div>
                  {cashPosition.lastUpdated ? (
                    <div className="mt-1 text-[10px] text-[#5d584f]">Updated {formatCapturedAt(cashPosition.lastUpdated)}</div>
                  ) : null}
                </div>
              </div>

              <section className="mt-8">
                <div className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-2.5">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2f2b28]">Income records</h2>
                  <button type="button" onClick={handleCreateIncome} className="rounded-lg border border-[#171717] bg-[#171717] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition hover:bg-[#2a2724]">Add income</button>
                </div>
                {orderedIncome.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-6 text-[14px] text-[#4d4944]">No income records yet.</div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {orderedIncome.map((income) => (
                      <button key={income.id} type="button" onClick={() => handleIncomeEditOpen(income)} className="block w-full rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-4 text-left transition hover:border-[#171717] hover:bg-[#f4f0ec]">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-[16px] font-medium tracking-[-0.03em] text-[#171717]">{income.description}</h3>
                            <p className="mt-1 text-[13px] text-[#424039]">{income.customerSource || "Source not specified"}</p>
                          </div>
                          <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">{income.status}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                          <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{formatFinanceAmount(parseFinanceAmount(income.amount))}</span>
                          <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{income.date ? formatCapturedAt(income.date) : "No date"}</span>
                          <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1.5">{income.area}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="mt-8">
                <div className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-2.5">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2f2b28]">Expense records</h2>
                  <button type="button" onClick={handleCreateExpense} className="rounded-lg border border-[#171717] bg-[#171717] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition hover:bg-[#2a2724]">Add expense</button>
                </div>
                {orderedExpenses.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-6 text-[14px] text-[#4d4944]">No expense records yet.</div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {orderedExpenses.map((expense) => (
                      <button key={expense.id} type="button" onClick={() => handleExpenseEditOpen(expense)} className="block w-full rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-4 text-left transition hover:border-[#171717] hover:bg-[#f4f0ec]">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-[16px] font-medium tracking-[-0.03em] text-[#171717]">{expense.description}</h3>
                            <p className="mt-1 text-[13px] text-[#424039]">{expense.supplier || "Payee not specified"}</p>
                          </div>
                          <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">{expense.status}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                          <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{formatFinanceAmount(parseFinanceAmount(expense.amount))}</span>
                          <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{expense.category}</span>
                          <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{expense.date ? formatCapturedAt(expense.date) : "No date"}</span>
                          <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1.5">{expense.area}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="mt-8">
                <div className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-2.5">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2f2b28]">Financial commitments</h2>
                  <button type="button" onClick={handleCreateCommitment} className="rounded-lg border border-[#171717] bg-[#171717] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition hover:bg-[#2a2724]">Add commitment</button>
                </div>
                {orderedCommitments.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-6 text-[14px] text-[#4d4944]">No financial commitments yet.</div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {orderedCommitments.map((commitment) => (
                      <button key={commitment.id} type="button" onClick={() => handleCommitmentEditOpen(commitment)} className="block w-full rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-4 text-left transition hover:border-[#171717] hover:bg-[#f4f0ec]">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-[16px] font-medium tracking-[-0.03em] text-[#171717]">{commitment.commitmentName}</h3>
                            <p className="mt-1 text-[13px] text-[#424039]">{commitment.type}</p>
                          </div>
                          <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">{commitment.status}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                          <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{formatFinanceAmount(parseFinanceAmount(commitment.amount))}</span>
                          <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{commitment.dueDate ? `Due ${formatCapturedAt(commitment.dueDate)}` : "No due date"}</span>
                          <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1.5">{commitment.relatedPillar}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : activeView === "Metrics" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">Measurement</p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">Metrics</h1>
                </div>
              </header>

              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#43403b]">
                A live read-only dashboard derived from current Empire OS records, showing whether each part of the business is healthy, improving or falling behind.
              </p>

              <section className="mt-7">
                <h2 className="border-b border-[#d7d1ca] pb-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2f2b28]">Marketing</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <MetricCard label="Leads generated" value={String(metricsLeadsGenerated)} />
                  <MetricCard label="Quotes sent" value={String(metricsQuotesSent)} />
                  <MetricCard label="Jobs won" value={String(metricsJobsWon)} />
                  <MetricCard label="Lead-to-job conversion" value={formatMetricPercent(metricsLeadToJobConversion)} />
                  <MetricCard label="Revenue from won leads" value={formatFinanceAmount(metricsRevenueFromWonLeads)} />
                  <MetricCard label="Average job value" value={formatFinanceAmount(metricsAverageJobValue)} />
                </div>
                <div className="mt-3 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Leads by source</div>
                  {metricsLeadsBySource.length === 0 ? (
                    <div className="mt-2 text-[12px] text-[#4d4944]">No leads recorded yet.</div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {metricsLeadsBySource.map((entry) => (
                        <span key={entry.source} className="rounded-full border border-[#d3cbc3] bg-white px-2.5 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[#4e4a45]">
                          {entry.source}: {entry.count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="mt-8">
                <h2 className="border-b border-[#d7d1ca] pb-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2f2b28]">Operations</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <MetricCard label="Open actions" value={String(metricsOpenActions)} />
                  <MetricCard label="In-progress actions" value={String(metricsInProgressActions)} />
                  <MetricCard label="Overdue actions" value={String(overdueActionCount)} />
                  <MetricCard label="Completed actions" value={String(metricsCompletedActions)} />
                  <MetricCard label="Active projects" value={String(metricsActiveProjects)} />
                  <MetricCard label="Blocked projects" value={String(metricsBlockedProjects)} />
                </div>
              </section>

              <section className="mt-8">
                <h2 className="border-b border-[#d7d1ca] pb-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2f2b28]">Finance</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <MetricCard label="Total received income" value={formatFinanceAmount(totalReceivedIncome)} />
                  <MetricCard label="Total paid expenses" value={formatFinanceAmount(totalPaidExpenses)} />
                  <MetricCard label="Net cash movement" value={formatFinanceAmount(netCashMovement)} />
                  <MetricCard label="Reserved tax" value={formatFinanceAmount(reservedTaxAmount)} />
                  <MetricCard label="Safety buffer" value={formatFinanceAmount(safetyBufferAmount)} />
                  <MetricCard label="Available operating cash" value={formatFinanceAmount(availableOperatingCash)} />
                </div>
              </section>

              <section className="mt-8">
                <h2 className="border-b border-[#d7d1ca] pb-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2f2b28]">Growth / Pipeline</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <MetricCard label="Open opportunities" value={String(metricsOpenOpportunities)} />
                  <MetricCard label="Approved opportunities" value={String(metricsApprovedOpportunities)} />
                  <MetricCard label="Active decisions" value={String(metricsActiveDecisions)} />
                  <MetricCard label="Leads awaiting follow-up" value={String(metricsLeadsAwaitingFollowUp)} />
                  <MetricCard label="Won leads" value={String(metricsWonLeads)} />
                  <MetricCard label="Lost leads" value={String(metricsLostLeads)} />
                </div>
              </section>
            </div>
          ) : activeView === "Pillars" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">Founder focus</p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">Pillars</h1>
                </div>
                {selectedPillar ? (
                  <button
                    type="button"
                    onClick={() => setSelectedPillar(null)}
                    className="rounded-lg border border-[#171717] bg-[#171717] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition hover:bg-[#2a2724]"
                  >
                    Back to overview
                  </button>
                ) : null}
              </header>

              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#43403b]">
                This view shows where the core business is strongest, under pressure, or needs founder attention across Garden Maintenance, Hard Landscape Construction, and Excavation.
              </p>

              {selectedPillar && selectedPillarDetail ? (
                <div className="mt-6">
                  <div className="mb-4 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Selected pillar</div>
                    <div className="mt-2 text-[30px] font-semibold tracking-[-0.06em] text-[#171717]">{selectedPillarDetail.pillar}</div>
                  </div>

                  <div className="space-y-5">
                    {selectedPillarDetail.sections.map((section) => (
                      <section key={section.label} className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4">
                        <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">
                          {section.label}
                          <span className="ml-2 text-[#7a726b]">{section.items.length}</span>
                        </div>

                        {section.items.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-[#d3cbc3] bg-white px-3 py-4 text-[13px] text-[#4d4944]">
                            No current items in this category.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {section.items.map((item) => (
                              <button
                                key={`${section.label}-${item.id}`}
                                type="button"
                                onClick={() => handleOpenAttentionRecord(item.objectType, item.id)}
                                className="block w-full rounded-xl border border-[#d3cbc3] bg-white px-3 py-3 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="text-[16px] font-medium tracking-[-0.04em] text-[#171717]">{item.title}</div>
                                  <span className="mt-0.5 shrink-0 rounded-full border border-[#cfc8c1] bg-[#f1efe9] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">
                                    Open record
                                  </span>
                                </div>
                                <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[#4d4944]">{item.meta}</div>
                                <div className="mt-2 text-[12px] leading-5 text-[#524d49]">
                                  <span className="font-medium text-[#171717]">Why this matters now:</span> {item.why}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </section>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-6 grid gap-4 xl:grid-cols-3">
                  {pillarSummaries.map((summary) => (
                    <PillarCard key={summary.pillar} pillar={summary.pillar} summary={summary} onSelect={setSelectedPillar} />
                  ))}
                </div>
              )}
            </div>
          ) : activeView === "People" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">
                    People foundation
                  </p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">
                    People
                  </h1>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {selectedAccountability ? (
                    <button
                      type="button"
                      onClick={() => setSelectedAccountabilityKey(null)}
                      className="rounded-lg border border-[#cfc8c1] bg-white px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#171717] transition hover:border-[#171717]"
                    >
                      Back to overview
                    </button>
                  ) : null}
                  {selectedAccountabilityPerson ? (
                    <button
                      type="button"
                      onClick={() => handlePersonEditOpen(selectedAccountabilityPerson)}
                      className="rounded-lg border border-[#171717] bg-[#171717] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition hover:bg-[#2a2724]"
                    >
                      Edit person
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleCreatePerson}
                    className="rounded-lg border border-[#171717] bg-[#171717] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition hover:bg-[#2a2724]"
                  >
                    Create Person
                  </button>
                </div>
              </header>

              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#43403b]">
                People records provide a structured foundation for names, roles, authority, skills, accountability and access level. Each card shows what that person currently carries across actions, projects, leads, decisions and problems, so delegated work stays visible.
              </p>

              {selectedAccountability && selectedAccountabilityDetail ? (
                <div className="mt-6">
                  <div className="mb-4 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">
                      {selectedAccountabilityDetail.hasOwner ? "Accountability view" : "Accountability gap"}
                    </div>
                    <div className="mt-2 text-[30px] font-semibold tracking-[-0.06em] text-[#171717]">{selectedAccountabilityDetail.ownerLabel}</div>
                    {selectedAccountability.person ? (
                      <div className="mt-1 text-[12px] text-[#4d4944]">
                        {selectedAccountability.person.role || "Role not specified"} • {selectedAccountability.person.pillar} • {selectedAccountability.person.status}
                      </div>
                    ) : (
                      <div className="mt-1 text-[12px] text-[#4d4944]">
                        Active work with no valid active owner — blank or assigned to a name that isn&apos;t an active person. Assign each item to a real person to close this accountability gap.
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                      <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">Carrying {selectedAccountability.carriedCount}</span>
                      <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{selectedAccountability.attentionCount} need attention</span>
                      <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{selectedAccountability.overdueActions.length} overdue</span>
                      <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{selectedAccountability.blockedCount} blocked</span>
                      <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{selectedAccountability.followUpLeads.length} follow-ups</span>
                      <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">{selectedAccountability.waitingDecisions.length} decisions waiting</span>
                    </div>
                  </div>

                  <div className="space-y-5">
                    {selectedAccountabilityDetail.sections.map((section) => (
                      <section key={section.label} className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4">
                        <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#4d4944]">
                          {section.label}
                          <span className="ml-2 text-[#7a726b]">{section.items.length}</span>
                        </div>

                        {section.items.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-[#d3cbc3] bg-white px-3 py-4 text-[13px] text-[#4d4944]">
                            No current items in this category.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {section.items.map((item) => (
                              <button
                                key={`${section.label}-${item.id}`}
                                type="button"
                                onClick={() => handleOpenAttentionRecord(item.objectType, item.id)}
                                className="block w-full rounded-xl border border-[#d3cbc3] bg-white px-3 py-3 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="text-[16px] font-medium tracking-[-0.04em] text-[#171717]">{item.title}</div>
                                  <span className="mt-0.5 shrink-0 rounded-full border border-[#cfc8c1] bg-[#f1efe9] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#2f2b28]">
                                    Open record
                                  </span>
                                </div>
                                <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[#4d4944]">{item.meta}</div>
                                <div className="mt-2 text-[12px] leading-5 text-[#524d49]">
                                  <span className="font-medium text-[#171717]">Why this matters now:</span> {item.why}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </section>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-6">
                  {orderedPeople.length === 0 ? (
                    <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[14px] text-[#4d4944]">
                      No people yet. Create the first person record to establish the People foundation.
                    </div>
                  ) : (
                    <div className="grid gap-4 xl:grid-cols-3">
                      {personAccountabilitySummaries.map((summary) => (
                        <button
                          key={summary.person.id}
                          type="button"
                          onClick={() => setSelectedAccountabilityKey(summary.person.id)}
                          className="w-full rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-4 text-left transition hover:border-[#171717] hover:bg-[#f4f1ee]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">{summary.person.role || "Role not specified"}</div>
                              <div className="mt-2 text-[24px] font-semibold tracking-[-0.05em] text-[#171717]">{summary.person.name}</div>
                            </div>
                            <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]">
                              {summary.person.status}
                            </span>
                          </div>

                          <div className="mt-1 text-[11px] text-[#4d4944]">{summary.person.pillar}</div>

                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <MetricCard label="Carrying" value={String(summary.carriedCount)} />
                            <MetricCard label="Overdue actions" value={String(summary.overdueActions.length)} />
                            <MetricCard label="Blocked" value={String(summary.blockedCount)} />
                            <MetricCard label="Follow-ups" value={String(summary.followUpLeads.length)} />
                            <MetricCard label="Decisions waiting" value={String(summary.waitingDecisions.length)} />
                            <MetricCard label="Open problems" value={String(summary.unresolvedProblems.length)} />
                          </div>

                          <div className="mt-4 rounded-xl border border-[#d3cbc3] bg-white px-3 py-2 text-[12px] text-[#2f2b28]">
                            {summary.attentionCount > 0
                              ? `${summary.attentionCount} item${summary.attentionCount === 1 ? "" : "s"} need${summary.attentionCount === 1 ? "s" : ""} attention — check overdue, blocked, follow-up and decision items.`
                              : summary.carriedCount > 0
                                ? "Carrying active work with nothing overdue or blocked."
                                : "No active work assigned."}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="mt-4">
                    {unassignedAccountability.carriedCount === 0 ? (
                      <div className="rounded-2xl border border-dashed border-[#d3cbc3] bg-[#f9f7f4] px-4 py-4 text-[13px] text-[#4d4944]">
                        No unassigned or ghost-owned active work. Every active action, project, problem and pipeline lead has a valid active owner.
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSelectedAccountabilityKey("unassigned")}
                        className="w-full rounded-2xl border border-[#c9b8a3] bg-[#f5efe6] p-4 text-left transition hover:border-[#171717]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Accountability gap</div>
                            <div className="mt-2 text-[24px] font-semibold tracking-[-0.05em] text-[#171717]">Unassigned</div>
                          </div>
                          <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]">
                            {unassignedAccountability.carriedCount} item{unassignedAccountability.carriedCount === 1 ? "" : "s"}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                          <MetricCard label="Open actions" value={String(unassignedAccountability.ownedActions.length)} />
                          <MetricCard label="Overdue" value={String(unassignedAccountability.overdueActions.length)} />
                          <MetricCard label="Blocked" value={String(unassignedAccountability.blockedCount)} />
                          <MetricCard label="Projects" value={String(unassignedAccountability.activeProjects.length)} />
                          <MetricCard label="Pipeline leads" value={String(unassignedAccountability.pipelineLeads.length)} />
                          <MetricCard label="Problems" value={String(unassignedAccountability.unresolvedProblems.length)} />
                        </div>

                        <div className="mt-4 rounded-xl border border-[#d3cbc3] bg-white px-3 py-2 text-[12px] text-[#2f2b28]">
                          This work has no valid active owner (blank or an unrecognised/inactive name). Assign it to close the accountability gap.
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : activeView === "Capture" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-[#4f4a45]">
                    Capture / Inbox
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[#4b4742]">
                  <span className="rounded-full border border-[#cfc8c1] bg-[#f7f4f1] px-2.5 py-1.5 font-medium text-[#2f2b28]">
                    New
                  </span>
                  <span>Not connected</span>
                </div>
              </header>

              <section className="pt-5">
                <div className="border-b border-[#d7d1ca] pb-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">
                    Universal entry point
                  </p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">
                    Capture
                  </h1>
                </div>

                <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[#43403b]">
                  This is the central intake for important organisational information — ideas,
                  observations, risks, opportunities, and evidence that may later be structured
                  into decisions, actions, or project work.
                </p>
              </section>

              <section className="mt-7 rounded-2xl border border-[#cfc8c1] bg-[#f7f4f1] p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-3">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2f2b28]">
                    Quick capture
                  </h2>
                  <span className="text-[11px] text-[#5d584f]">Local prototype</span>
                </div>

                {feedback ? (
                  <div
                    className={[
                      "mt-4 rounded-xl border px-3 py-2 text-[12px]",
                      feedback.type === "success"
                        ? "border-[#cfc8c1] bg-[#f2efe9] text-[#2f2b28]"
                        : "border-[#d4b4a7] bg-[#f8f1ee] text-[#4b312b]",
                    ].join(" ")}
                    aria-live="polite"
                  >
                    {feedback.message}
                  </div>
                ) : null}

                <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                      Title
                    </label>
                    <input
                      type="text"
                      value={formValues.title}
                      onChange={(event) => handleFieldChange("title", event.target.value)}
                      placeholder="e.g. Drainage review for north garden bed"
                      required
                      className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                      Raw note
                    </label>
                    <textarea
                      rows={5}
                      value={formValues.rawNote}
                      onChange={(event) => handleFieldChange("rawNote", event.target.value)}
                      placeholder="Capture the issue, observation, idea, or evidence while it is still fresh."
                      required
                      className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                        Initial type
                      </label>
                      <select
                        value={formValues.initialType}
                        onChange={(event) => handleFieldChange("initialType", event.target.value)}
                        className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                      >
                        <option>Idea</option>
                        <option>Observation</option>
                        <option>Problem</option>
                        <option>Opportunity</option>
                        <option>Risk</option>
                        <option>Decision</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                        Related area
                      </label>
                      <select
                        value={formValues.relatedArea}
                        onChange={(event) => handleFieldChange("relatedArea", event.target.value)}
                        className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                      >
                        {sharedAreaOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                        Importance
                      </label>
                      <select
                        value={formValues.importance}
                        onChange={(event) => handleFieldChange("importance", event.target.value)}
                        className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                      >
                        <option>High</option>
                        <option>Medium</option>
                        <option>Low</option>
                      </select>
                    </div>

                    <div className="flex items-end">
                      <button
                        type="submit"
                        className="w-full rounded-xl bg-[#171717] px-4 py-3.5 text-[13px] font-semibold tracking-[0.04em] text-[#f7f4f1] transition hover:bg-[#2a2724] focus:outline-none focus:ring-3 focus:ring-[#171717]/10"
                      >
                        Save Capture
                      </button>
                    </div>
                  </div>
                </form>
              </section>

              <section className="mt-8">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                    Recent captures
                  </h2>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-[#5d584f]">
                    {captures.length > 0 ? "Stored locally" : "No captures yet"}
                  </span>
                </div>

                {orderedCaptures.length === 0 ? (
                  <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-6 text-[14px] text-[#4d4944]">
                    No captures yet. Save the first record and it will appear here.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {orderedCaptures.map((capture) => {
                      const reviewAlreadyComplete = Boolean(capture.reviewOutcome);

                      return (
                        <article
                          key={capture.id}
                          className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-3.5"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h3 className="text-[17px] font-medium tracking-[-0.04em] text-[#171717]">
                                  {capture.title}
                                </h3>
                                {capture.reviewOutcome ? (
                                  <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-[#534e49]">
                                    {capture.status}
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-2 text-[14px] leading-6 text-[#424039]">
                                {capture.rawNote.length > 180
                                  ? `${capture.rawNote.slice(0, 180)}…`
                                  : capture.rawNote}
                              </p>
                            </div>

                            <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">
                              {capture.importance}
                            </span>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                            <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                              {capture.initialType}
                            </span>
                            <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                              {capture.relatedArea}
                            </span>
                            <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                              {capture.status}
                            </span>
                            <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                              {formatCapturedAt(capture.capturedAt)}
                            </span>
                            {capture.reviewOutcome ? (
                              <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1.5">
                                {formatReviewOutcome(capture.reviewOutcome)}
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#d3cbc3] pt-3">
                            {reviewAlreadyComplete ? (
                              <span className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">
                                Review complete: {formatReviewOutcome(capture.reviewOutcome)}
                              </span>
                            ) : (
                              <span className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">
                                Pending review
                              </span>
                            )}

                            {reviewAlreadyComplete ? null : (
                              <button
                                type="button"
                                onClick={() => handleReview(capture)}
                                className="rounded-lg border border-[#171717] bg-[#171717] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition hover:bg-[#2a2724]"
                              >
                                Review
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          ) : activeView === "Problems" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">
                    Operational destination
                  </p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">
                    Problems
                  </h1>
                </div>
                <span className="rounded-full border border-[#cfc8c1] bg-[#f7f4f1] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#2f2b28]">
                  {problemRecords.length} record{problemRecords.length === 1 ? "" : "s"}
                </span>
              </header>

              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#43403b]">
                Problem records created from Capture entries are maintained here with diagnosis,
                ownership, resolution notes and traceability back to the original record.
              </p>

              {problemRecords.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[14px] text-[#4d4944]">
                  No Problems yet. Convert a Capture to Problem to see it here.
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  {problemRecords.map((problem) => (
                    <button
                      key={problem.id}
                      type="button"
                      onClick={() => handleProblemEditOpen(problem)}
                      className="block w-full rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-4 text-left transition hover:border-[#171717] hover:bg-[#f4f0ec]"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <h2 className="text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
                            {problem.problemStatement}
                          </h2>
                          <p className="mt-2 text-[14px] leading-6 text-[#424039]">
                            {problem.impact || problem.originalRawNote.length > 220
                              ? problem.impact || `${problem.originalRawNote.slice(0, 220)}…`
                              : problem.originalRawNote}
                          </p>
                        </div>
                        <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">
                          {problem.problemStatus}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {problem.relatedArea}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {problem.severity}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {problem.frequency}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {formatCapturedAt(problem.createdAt)}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1.5">
                          Source Capture: {problem.sourceCaptureId}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : activeView === "Actions" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">
                    Operational destination
                  </p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">
                    Actions
                  </h1>
                </div>
                <span className="rounded-full border border-[#cfc8c1] bg-[#f7f4f1] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#2f2b28]">
                  {actionRecords.length} record{actionRecords.length === 1 ? "" : "s"}
                </span>
              </header>

              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#43403b]">
                Action records created from Capture entries are maintained here as accountable work items with ownership, priority, dates and source traceability.
              </p>

              {actionRecords.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[14px] text-[#4d4944]">
                  No Actions yet. Convert a Capture to Action to see it here.
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  {actionRecords.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => handleActionEditOpen(action)}
                      className="block w-full rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-4 text-left transition hover:border-[#171717] hover:bg-[#f4f0ec]"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <h2 className="text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
                            {action.actionTitle}
                          </h2>
                          <p className="mt-2 text-[14px] leading-6 text-[#424039]">
                            {action.description || action.originalRawNote}
                          </p>
                        </div>
                        <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">
                          {action.status}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {action.priority}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {getActionOwnerDisplay(action, people)}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {action.relatedPillar}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {action.dueDate ? `Due ${formatCapturedAt(action.dueDate)}` : "No due date"}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1.5">
                          Source Capture: {action.sourceCaptureId}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : activeView === "Opportunities" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">
                    Operational destination
                  </p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">
                    Opportunities
                  </h1>
                </div>
                <span className="rounded-full border border-[#cfc8c1] bg-[#f7f4f1] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#2f2b28]">
                  {opportunityRecords.length} record{opportunityRecords.length === 1 ? "" : "s"}
                </span>
              </header>

              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#43403b]">
                Opportunity records created from Capture entries are maintained here with upside, resource, risk and opportunity-cost consideration before commitment.
              </p>

              {opportunityRecords.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[14px] text-[#4d4944]">
                  No Opportunities yet. Convert a Capture to Opportunity to see it here.
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  {opportunityRecords.map((opportunity) => (
                    <button
                      key={opportunity.id}
                      type="button"
                      onClick={() => handleOpportunityEditOpen(opportunity)}
                      className="block w-full rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-4 text-left transition hover:border-[#171717] hover:bg-[#f4f0ec]"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <h2 className="text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
                            {opportunity.opportunityTitle}
                          </h2>
                          <p className="mt-2 text-[14px] leading-6 text-[#424039]">
                            {opportunity.description || opportunity.originalRawNote}
                          </p>
                        </div>
                        <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">
                          {opportunity.status}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {opportunity.strategicFit}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {opportunity.owner || "Unassigned"}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {opportunity.relatedPillar || opportunity.relatedArea}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1.5">
                          Source Capture: {opportunity.sourceCaptureId}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : activeView === "Decisions" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">
                    Operational destination
                  </p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">
                    Decisions
                  </h1>
                </div>
                <span className="rounded-full border border-[#cfc8c1] bg-[#f7f4f1] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#2f2b28]">
                  {decisionRecords.length} record{decisionRecords.length === 1 ? "" : "s"}
                </span>
              </header>

              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#43403b]">
                Decision records created from Capture entries are maintained here with rationale, evidence, expected outcomes and later learning.
              </p>

              {decisionRecords.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[14px] text-[#4d4944]">
                  No Decisions yet. Convert a Capture to Decision to see it here.
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  {decisionRecords.map((decision) => (
                    <button
                      key={decision.id}
                      type="button"
                      onClick={() => handleDecisionEditOpen(decision)}
                      className="block w-full rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-4 text-left transition hover:border-[#171717] hover:bg-[#f4f0ec]"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <h2 className="text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
                            {decision.decisionTitle}
                          </h2>
                          <p className="mt-2 text-[14px] leading-6 text-[#424039]">
                            {decision.decisionStatement || decision.originalRawNote}
                          </p>
                        </div>
                        <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">
                          {decision.decisionStatus}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {decision.riskLevel}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {decision.decisionMaker || "Unassigned"}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {decision.relatedArea}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1.5">
                          Source Capture: {decision.sourceCaptureId}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : activeView === "Lessons" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">
                    Operational destination
                  </p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">
                    Lessons
                  </h1>
                </div>
                <span className="rounded-full border border-[#cfc8c1] bg-[#f7f4f1] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#2f2b28]">
                  {lessonRecords.length} record{lessonRecords.length === 1 ? "" : "s"}
                </span>
              </header>

              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#43403b]">
                Lesson records created from Capture entries are maintained here so the organisation can retain what was learned, why it matters, and what should change as a result.
              </p>

              {lessonRecords.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[14px] text-[#4d4944]">
                  No Lessons yet. Convert a Capture to Lesson to see it here.
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  {lessonRecords.map((lesson) => (
                    <button
                      key={lesson.id}
                      type="button"
                      onClick={() => handleLessonEditOpen(lesson)}
                      className="block w-full rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-4 text-left transition hover:border-[#171717] hover:bg-[#f4f0ec]"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <h2 className="text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
                            {lesson.lessonTitle}
                          </h2>
                          <p className="mt-2 text-[14px] leading-6 text-[#424039]">
                            {lesson.description || lesson.originalRawNote}
                          </p>
                        </div>
                        <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">
                          {lesson.status}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {lesson.relatedPillar || lesson.relatedArea}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {lesson.owner || "Unassigned"}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1.5">
                          Source Capture: {lesson.sourceCaptureId}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : activeView === "Systems" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">
                    Operational destination
                  </p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">
                    Systems
                  </h1>
                </div>
                <span className="rounded-full border border-[#cfc8c1] bg-[#f7f4f1] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#2f2b28]">
                  {systemRecords.length} record{systemRecords.length === 1 ? "" : "s"}
                </span>
              </header>

              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#43403b]">
                System records capture repeatable operational changes derived from lessons so the organisation can turn learning into stable process improvement.
              </p>

              {systemRecords.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[14px] text-[#4d4944]">
                  No Systems yet. Create a linked System from a Lesson to see it here.
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  {systemRecords.map((system) => (
                    <button
                      key={system.id}
                      type="button"
                      onClick={() => handleSystemEditOpen(system)}
                      className="block w-full rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-4 text-left transition hover:border-[#171717] hover:bg-[#f4f0ec]"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <h2 className="text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
                            {system.systemName}
                          </h2>
                          <p className="mt-2 text-[14px] leading-6 text-[#424039]">
                            {system.purpose || system.originalRawNote}
                          </p>
                        </div>
                        <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">
                          {system.status}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {system.area || system.relatedArea}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {system.owner || "Unassigned"}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1.5">
                          Source Capture: {system.sourceCaptureId}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : activeView === "SOPs" ? (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <header className="flex items-center justify-between gap-3 border-b border-[#d7d1ca] pb-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#4d4944]">
                    Operational destination
                  </p>
                  <h1 className="mt-2.5 text-[36px] font-semibold tracking-[-0.07em] text-[#171717] sm:text-[42px]">
                    SOPs
                  </h1>
                </div>
                <span className="rounded-full border border-[#cfc8c1] bg-[#f7f4f1] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#2f2b28]">
                  {sopRecords.length} record{sopRecords.length === 1 ? "" : "s"}
                </span>
              </header>

              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#43403b]">
                SOP records turn approved systems into repeatable procedures that people can follow with clear roles, tools and quality expectations.
              </p>

              {sopRecords.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[14px] text-[#4d4944]">
                  No SOPs yet. Create a linked SOP from a System to see it here.
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  {sopRecords.map((sop) => (
                    <button
                      key={sop.id}
                      type="button"
                      onClick={() => handleSopEditOpen(sop)}
                      className="block w-full rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-4 text-left transition hover:border-[#171717] hover:bg-[#f4f0ec]"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <h2 className="text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
                            {sop.sopTitle}
                          </h2>
                          <p className="mt-2 text-[14px] leading-6 text-[#424039]">
                            {sop.purpose || sop.originalRawNote}
                          </p>
                        </div>
                        <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">
                          {sop.status}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {sop.owner || "Unassigned"}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {sop.relatedSystem || "Unlinked"}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1.5">
                          Source Capture: {sop.sourceCaptureId}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : activeDestination ? (
            <ConvertedDestinationView
              title={activeDestination.title}
              description={activeDestination.description}
              records={getConvertedRecordsByType(activeDestination.targetType)}
            />
          ) : null}
        </main>
      </div>

      {selectedCaptureId ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#171717]/20 px-4">
          <div className="w-full max-w-md rounded-2xl border border-[#cfc8c1] bg-[#f9f7f4] p-5 shadow-[0_18px_40px_rgba(23,23,23,0.08)]">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[18px] font-medium tracking-[-0.04em] text-[#171717]">
                Review capture
              </h3>
              <button
                type="button"
                onClick={() => setSelectedCaptureId(null)}
                className="text-[12px] uppercase tracking-[0.16em] text-[#4d4944]"
              >
                Close
              </button>
            </div>

            <p className="mt-3 text-[13px] leading-6 text-[#4d4944]">
              Choose the next organisational outcome for this record while preserving the
              original capture content.
            </p>

            <div className="mt-4 space-y-2">
              {reviewOutcomes.map((option) => (
                <label
                  key={option}
                  className={[
                    "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-[13px] text-[#171717] transition",
                    selectedOutcome === option
                      ? "border-[#171717] bg-[#f2efe9]"
                      : "border-[#d3cbc3] bg-white",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="review-outcome"
                    value={option}
                    checked={selectedOutcome === option}
                    onChange={() => setSelectedOutcome(option)}
                    className="accent-[#171717]"
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedCaptureId(null)}
                className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReviewSubmit}
                className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1]"
              >
                Confirm review
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedProblemId && problemEditor ? (
        <ProblemDetailPanel
          problem={problemEditor}
          linkedActions={actionRecords.filter((action) => action.relatedProblem === problemEditor.id)}
          linkedLessons={lessonRecords.filter((lesson) => lesson.relatedProblem === problemEditor.id)}
          upstream={getCaptureLineage(problemEditor.sourceCaptureId)}
          downstream={[
            ...actionRecords
              .filter((action) => action.relatedProblem === problemEditor.id)
              .map((action) => ({
                label: "Action",
                title: action.actionTitle,
                id: action.id,
                onClick: () => handleActionEditOpen(action),
              })),
            ...lessonRecords
              .filter((lesson) => lesson.relatedProblem === problemEditor.id)
              .map((lesson) => ({
                label: "Lesson",
                title: lesson.lessonTitle,
                id: lesson.id,
                onClick: () => handleLessonEditOpen(lesson),
              })),
          ]}
          onClose={() => {
            setSelectedProblemId(null);
            setProblemEditor(null);
          }}
          onChange={handleProblemEditorChange}
          onSave={handleProblemSave}
          onCreateLinkedAction={() => handleCreateLinkedAction(problemEditor)}
          onCreateLinkedLesson={() => handleCreateLinkedLessonFromProblem(problemEditor)}
          onOpenLinkedAction={(action) => handleActionEditOpen(action)}
          onOpenLinkedLesson={(lesson) => handleLessonEditOpen(lesson)}
        />
      ) : null}

      {selectedActionId && actionEditor ? (
        <ActionDetailPanel
          action={actionEditor}
          people={people.filter((person) => person.status === "Active")}
          problems={problemRecords}
          decisions={decisionRecords}
          upstream={[
            ...getCaptureLineage(actionEditor.sourceCaptureId),
            ...(actionEditor.relatedProblem
              ? problemRecords
                  .filter((problem) => problem.id === actionEditor.relatedProblem)
                  .map((problem) => ({
                    label: "Problem",
                    title: problem.problemStatement,
                    id: problem.id,
                    onClick: () => handleOpenRelatedProblem(actionEditor),
                  }))
              : []),
          ]}
          downstream={
            actionEditor.relatedDecision
              ? decisionRecords
                  .filter((decision) => decision.id === actionEditor.relatedDecision)
                  .map((decision) => ({
                    label: "Decision",
                    title: decision.decisionTitle,
                    id: decision.id,
                    onClick: () => handleOpenRelatedDecision(actionEditor),
                  }))
              : []
          }
          onClose={() => {
            setSelectedActionId(null);
            setActionEditor(null);
          }}
          onChange={handleActionEditorChange}
          onOwnerChange={handleActionOwnerChange}
          onSave={handleActionSave}
          onOpenRelatedProblem={() => handleOpenRelatedProblem(actionEditor)}
          onOpenRelatedDecision={() => handleOpenRelatedDecision(actionEditor)}
        />
      ) : null}

      {selectedDecisionId && decisionEditor ? (
        <DecisionDetailPanel
          decision={decisionEditor}
          linkedActions={actionRecords.filter((action) => action.relatedDecision === decisionEditor.id)}
          linkedLessons={lessonRecords.filter((lesson) => lesson.relatedDecision === decisionEditor.id)}
          upstream={[
            ...getCaptureLineage(decisionEditor.sourceCaptureId),
            ...(decisionEditor.relatedOpportunity
              ? opportunityRecords
                  .filter((opportunity) => opportunity.id === decisionEditor.relatedOpportunity)
                  .map((opportunity) => ({
                    label: "Opportunity",
                    title: opportunity.opportunityTitle,
                    id: opportunity.id,
                    onClick: () => handleOpenRelatedOpportunity(decisionEditor),
                  }))
              : []),
          ]}
          downstream={[
            ...actionRecords
              .filter((action) => action.relatedDecision === decisionEditor.id)
              .map((action) => ({
                label: "Action",
                title: action.actionTitle,
                id: action.id,
                onClick: () => handleActionEditOpen(action),
              })),
            ...lessonRecords
              .filter((lesson) => lesson.relatedDecision === decisionEditor.id)
              .map((lesson) => ({
                label: "Lesson",
                title: lesson.lessonTitle,
                id: lesson.id,
                onClick: () => handleLessonEditOpen(lesson),
              })),
          ]}
          onClose={() => {
            setSelectedDecisionId(null);
            setDecisionEditor(null);
          }}
          onChange={handleDecisionEditorChange}
          onSave={handleDecisionSave}
          onCreateLinkedAction={() => handleDecisionCreateLinkedAction(decisionEditor)}
          onCreateLinkedLesson={() => handleCreateLinkedLesson(decisionEditor)}
          onOpenLinkedAction={(action) => handleActionEditOpen(action)}
          onOpenLinkedLesson={(lesson) => handleLessonEditOpen(lesson)}
        />
      ) : null}

      {selectedOpportunityId && opportunityEditor ? (
        <OpportunityDetailPanel
          opportunity={opportunityEditor}
          linkedDecisions={decisionRecords.filter((decision) => decision.relatedOpportunity === opportunityEditor.id)}
          upstream={getCaptureLineage(opportunityEditor.sourceCaptureId)}
          downstream={decisionRecords
            .filter((decision) => decision.relatedOpportunity === opportunityEditor.id)
            .map((decision) => ({
              label: "Decision",
              title: decision.decisionTitle,
              id: decision.id,
              onClick: () => handleDecisionEditOpen(decision),
            }))}
          onClose={() => {
            setSelectedOpportunityId(null);
            setOpportunityEditor(null);
          }}
          onChange={handleOpportunityEditorChange}
          onSave={handleOpportunitySave}
          onCreateLinkedDecision={() => handleCreateLinkedDecision(opportunityEditor)}
          onOpenLinkedDecision={(decision) => handleDecisionEditOpen(decision)}
        />
      ) : null}

      {selectedLessonId && lessonEditor ? (
        <LessonDetailPanel
          lesson={lessonEditor}
          linkedSystems={systemRecords.filter((system) => system.relatedLesson === lessonEditor.id)}
          upstream={getCaptureLineage(lessonEditor.sourceCaptureId)}
          downstream={systemRecords
            .filter((system) => system.relatedLesson === lessonEditor.id)
            .map((system) => ({
              label: "System",
              title: system.systemName,
              id: system.id,
              onClick: () => handleSystemEditOpen(system),
            }))}
          onClose={() => {
            setSelectedLessonId(null);
            setLessonEditor(null);
          }}
          onChange={handleLessonEditorChange}
          onSave={handleLessonSave}
          onCreateLinkedSystem={() => handleCreateLinkedSystem(lessonEditor)}
          onOpenLinkedSystem={(system) => handleSystemEditOpen(system)}
        />
      ) : null}

      {selectedSystemId && systemEditor ? (
        <SystemDetailPanel
          system={systemEditor}
          linkedSops={sopRecords.filter((sop) => sop.relatedSystem === systemEditor.id)}
          upstream={[
            ...getCaptureLineage(systemEditor.sourceCaptureId),
            ...(systemEditor.relatedLesson
              ? lessonRecords
                  .filter((lesson) => lesson.id === systemEditor.relatedLesson)
                  .map((lesson) => ({
                    label: "Lesson",
                    title: lesson.lessonTitle,
                    id: lesson.id,
                    onClick: () => handleOpenRelatedLesson(systemEditor),
                  }))
              : []),
          ]}
          downstream={sopRecords
            .filter((sop) => sop.relatedSystem === systemEditor.id)
            .map((sop) => ({
              label: "SOP",
              title: sop.sopTitle,
              id: sop.id,
              onClick: () => handleSopEditOpen(sop),
            }))}
          onClose={() => {
            setSelectedSystemId(null);
            setSystemEditor(null);
          }}
          onChange={handleSystemEditorChange}
          onSave={handleSystemSave}
          onCreateLinkedSop={() => handleCreateLinkedSop(systemEditor)}
          onOpenLinkedSop={(sop) => handleSopEditOpen(sop)}
          onOpenRelatedLesson={() => handleOpenRelatedLesson(systemEditor)}
        />
      ) : null}

      {selectedSopId && sopEditor ? (
        <SopDetailPanel
          sop={sopEditor}
          upstream={[
            ...getCaptureLineage(sopEditor.sourceCaptureId),
            ...(sopEditor.relatedLesson
              ? lessonRecords
                  .filter((lesson) => lesson.id === sopEditor.relatedLesson)
                  .map((lesson) => ({
                    label: "Lesson",
                    title: lesson.lessonTitle,
                    id: lesson.id,
                  }))
              : []),
            ...(sopEditor.relatedSystem
              ? systemRecords
                  .filter((system) => system.id === sopEditor.relatedSystem)
                  .map((system) => ({
                    label: "System",
                    title: system.systemName,
                    id: system.id,
                    onClick: () => handleOpenRelatedSystem(sopEditor),
                  }))
              : []),
          ]}
          downstream={[]}
          onClose={() => {
            setSelectedSopId(null);
            setSopEditor(null);
          }}
          onChange={handleSopEditorChange}
          onSave={handleSopSave}
          onOpenRelatedSystem={() => handleOpenRelatedSystem(sopEditor)}
        />
      ) : null}

      {selectedProjectId && projectEditor ? (
        <ProjectDetailPanel
          project={projectEditor}
          people={people}
          actions={actionRecords}
          decisions={decisionRecords}
          systems={systemRecords}
          sops={sopRecords}
          onClose={() => {
            setSelectedProjectId(null);
            setProjectEditor(null);
          }}
          onChange={handleProjectEditorChange}
          onSave={handleProjectSave}
          onAddLink={handleProjectAddLink}
          onRemoveLink={handleProjectRemoveLink}
          onOpenRecord={handleProjectOpenRecord}
        />
      ) : null}

      {selectedLeadId && leadEditor ? (
        <LeadDetailPanel
          lead={leadEditor}
          people={people}
          onClose={() => {
            setSelectedLeadId(null);
            setLeadEditor(null);
          }}
          onChange={handleLeadEditorChange}
          onSave={handleLeadSave}
          onArchiveToggle={handleLeadArchiveToggle}
        />
      ) : null}

      {cashPositionEditor ? (
        <CashPositionPanel
          value={cashPositionEditor}
          onClose={() => setCashPositionEditor(null)}
          onChange={handleCashPositionChange}
          onSave={handleCashPositionSave}
        />
      ) : null}

      {selectedIncomeId && incomeEditor ? (
        <IncomeDetailPanel
          income={incomeEditor}
          onClose={() => {
            setSelectedIncomeId(null);
            setIncomeEditor(null);
          }}
          onChange={handleIncomeEditorChange}
          onSave={handleIncomeSave}
        />
      ) : null}

      {selectedExpenseId && expenseEditor ? (
        <ExpenseDetailPanel
          expense={expenseEditor}
          onClose={() => {
            setSelectedExpenseId(null);
            setExpenseEditor(null);
          }}
          onChange={handleExpenseEditorChange}
          onSave={handleExpenseSave}
        />
      ) : null}

      {selectedCommitmentId && commitmentEditor ? (
        <CommitmentDetailPanel
          commitment={commitmentEditor}
          onClose={() => {
            setSelectedCommitmentId(null);
            setCommitmentEditor(null);
          }}
          onChange={handleCommitmentEditorChange}
          onSave={handleCommitmentSave}
        />
      ) : null}

      {selectedPersonId && personEditor ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#171717]/20 px-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#cfc8c1] bg-[#f9f7f4] p-5 shadow-[0_18px_40px_rgba(23,23,23,0.08)]">
            <div className="flex items-center justify-between gap-3 border-b border-[#d3cbc3] pb-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Person detail</p>
                <h3 className="mt-1 text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
                  {personEditor.name || "New person"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedPersonId(null);
                  setPersonEditor(null);
                  setPersonSaveState("idle");
                }}
                className="text-[12px] uppercase tracking-[0.16em] text-[#4d4944]"
              >
                Close
              </button>
            </div>

            {personSaveState === "saved" ? (
              <div
                aria-live="polite"
                className="mt-4 rounded-xl border border-[#cfc8c1] bg-[#f2efe9] px-3 py-2 text-[12px] font-medium text-[#2f2b28]"
              >
                Person details saved.
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                  Name
                </label>
                <input
                  type="text"
                  value={personEditor.name}
                  onChange={(event) => handlePersonEditorChange("name", event.target.value)}
                  className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                  Role
                </label>
                <input
                  type="text"
                  value={personEditor.role}
                  onChange={(event) => handlePersonEditorChange("role", event.target.value)}
                  className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                  Pillar / area
                </label>
                <select
                  value={personEditor.pillar}
                  onChange={(event) => handlePersonEditorChange("pillar", event.target.value)}
                  className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                >
                  {sharedAreaOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                  Manager
                </label>
                <input
                  type="text"
                  value={personEditor.manager}
                  onChange={(event) => handlePersonEditorChange("manager", event.target.value)}
                  className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                  Status
                </label>
                <select
                  value={personEditor.status}
                  onChange={(event) => handlePersonEditorChange("status", event.target.value)}
                  className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                >
                  {personStatusOptions.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                  Access level
                </label>
                <select
                  value={personEditor.accessLevel}
                  onChange={(event) => handlePersonEditorChange("accessLevel", event.target.value)}
                  className="w-full rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                >
                  {personAccessLevelOptions.map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                  Responsibilities
                </label>
                <textarea
                  rows={3}
                  value={personEditor.responsibilities}
                  onChange={(event) => handlePersonEditorChange("responsibilities", event.target.value)}
                  className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                  Authority
                </label>
                <textarea
                  rows={3}
                  value={personEditor.authority}
                  onChange={(event) => handlePersonEditorChange("authority", event.target.value)}
                  className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                  Skills
                </label>
                <textarea
                  rows={3}
                  value={personEditor.skills}
                  onChange={(event) => handlePersonEditorChange("skills", event.target.value)}
                  className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                  Development areas
                </label>
                <textarea
                  rows={3}
                  value={personEditor.developmentAreas}
                  onChange={(event) => handlePersonEditorChange("developmentAreas", event.target.value)}
                  className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f2b28]">
                  Performance indicators
                </label>
                <textarea
                  rows={3}
                  value={personEditor.performanceIndicators}
                  onChange={(event) => handlePersonEditorChange("performanceIndicators", event.target.value)}
                  className="w-full resize-none rounded-xl border border-[#beb3aa] bg-white px-3.5 py-3 text-[14px] leading-6 text-[#171717] outline-none transition focus:border-[#171717] focus:ring-3 focus:ring-[#171717]/6"
                />
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-[#d3cbc3] bg-[#f1eee9] p-3 text-[11px] uppercase tracking-[0.14em] text-[#4d4944]">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>Person ID: {personEditor.id}</span>
                <span>Date created: {formatCapturedAt(personEditor.dateCreated)}</span>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedPersonId(null);
                  setPersonEditor(null);
                  setPersonSaveState("idle");
                }}
                className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePersonSave}
                className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1]"
              >
                {personSaveState === "saved" ? "Saved" : "Save person"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

