"use client";

import { FormEvent, useEffect, useState } from "react";

const navigation = [
  "Empire OS",
  "Command",
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
  "People",
  "Pillars",
];

const STORAGE_KEY = "empire-os-captures";
const CONVERSION_STORAGE_KEY = "empire-os-capture-conversions";
const PERSON_STORAGE_KEY = "empire-os-people";
const PROJECT_STORAGE_KEY = "empire-os-projects";
const LEAD_STORAGE_KEY = "empire-os-leads";
const SAVED_VIEWS_STORAGE_KEY = "empire-os-records-in-motion-views";
const DEFAULT_SAVED_VIEW_STORAGE_KEY = "empire-os-records-in-motion-default-view";

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

type DestinationKey = "Command" | "Capture" | "People" | "Projects" | "Leads" | (typeof destinationDefinitions)[number]["key"];

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

function CommandRecordRegister({ groups, attentionRecordKeys }: { groups: CommandRecordGroup[]; attentionRecordKeys: string[] }) {
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
        return matchesSearch && matchesType && matchesStatus && matchesArea && matchesOwner && matchesDate && matchesOperational && matchesAttention;
      }).sort((left, right) => sortOrder === "Default" ? 0 : compareRecords(left, right)),
    }))
    .filter((group) => group.records.length > 0);
  const totalRecordCount = groups.reduce((total, group) => total + group.records.length, 0);
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
              {visibleRecordCount} {visibleRecordCount === 1 ? "record" : "records"}{hasActiveFilters ? ` shown of ${totalRecordCount}` : ""}
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
        <div className="mt-4 rounded-xl border border-[#d3cbc3] bg-[#f9f7f4] px-3 py-4 text-[12px] text-[#6a625d]">
          No records match the current filters.
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
                        {record.sourceCaptureId ? <span>Capture {record.sourceCaptureId}</span> : null}
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

function LeadDetailPanel({ lead, people, onClose, onChange, onSave }: {
  lead: LeadRecord;
  people: PersonRecord[];
  onClose: () => void;
  onChange: (field: keyof LeadRecord, value: string) => void;
  onSave: () => void;
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

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#d3cbc3] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#2f2b28]">Cancel</button>
          <button type="button" onClick={() => { onSave(); setHasSaved(true); }} disabled={hasInvalidLeadName} className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45">{hasSaved ? "Saved" : "Save lead"}</button>
        </div>
      </div>
    </div>
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
  upstream: RelatedRecordItem[];
  downstream: RelatedRecordItem[];
  onClose: () => void;
  onChange: (field: keyof Omit<ProblemRecord, "id" | "sourceCaptureId" | "targetType" | "createdAt" | "title" | "originalRawNote" | "relatedArea" | "importance" | "status">, value: string) => void;
  onSave: () => void;
  onCreateLinkedAction: () => void;
  onOpenLinkedAction: (action: ActionRecord) => void;
};

function ProblemDetailPanel({ problem, linkedActions, upstream, downstream, onClose, onChange, onSave, onCreateLinkedAction, onOpenLinkedAction }: ProblemDetailPanelProps) {
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
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1]"
          >
            Save problem
          </button>
        </div>

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
  upstream: RelatedRecordItem[];
  downstream: RelatedRecordItem[];
  onClose: () => void;
  onChange: (field: keyof DecisionRecord, value: string) => void;
  onSave: () => void;
  onCreateLinkedAction: () => void;
  onOpenLinkedAction: (action: ActionRecord) => void;
  onOpenRelatedOpportunity?: () => void;
};

function DecisionDetailPanel({ decision, linkedActions, upstream, downstream, onClose, onChange, onSave, onCreateLinkedAction, onOpenLinkedAction, onOpenRelatedOpportunity }: DecisionDetailPanelProps) {
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

          <div className="md:col-span-2">
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
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1]"
          >
            Save decision
          </button>
        </div>

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
  const [creatingLinkedActionForProblemId, setCreatingLinkedActionForProblemId] = useState<string | null>(null);
  const [creatingLinkedActionForDecisionId, setCreatingLinkedActionForDecisionId] = useState<string | null>(null);
  const [creatingLinkedDecisionForOpportunityId, setCreatingLinkedDecisionForOpportunityId] = useState<string | null>(null);
  const [creatingLinkedSystemForLessonId, setCreatingLinkedSystemForLessonId] = useState<string | null>(null);
  const [creatingLinkedSopForSystemId, setCreatingLinkedSopForSystemId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DestinationKey>("Capture");
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

  const orderedCaptures = [...captures].sort(
    (first, second) =>
      new Date(second.capturedAt).getTime() - new Date(first.capturedAt).getTime(),
  );

  const orderedPeople = [...people].sort(
    (first, second) => new Date(second.dateCreated).getTime() - new Date(first.dateCreated).getTime(),
  );

  const orderedLeads = [...leads].sort(
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
          statusText: `${problem.severity} / ${problem.problemStatus}`,
          area: getAreaText(problem),
          attentionRank: problem.severity === "Critical" ? 3 : 4,
          tieWeight: problem.severity === "Critical" ? 2 : 1,
          priorityScore: getProblemPriorityScore(problem),
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

      if (reasons.length > 0) {
        addAttentionItem(reasons[0], {
          id: action.id,
          objectType: "Action",
          title: action.actionTitle || action.title,
          reason: reasons.join(" • "),
          reasons,
          statusText: `${action.status} / ${action.priority} / ${action.dueDate ? formatCapturedAt(action.dueDate) : "No due date"}`,
          area: getAreaText(action),
          attentionRank: action.status === "Blocked" || Boolean(dependencyBlocker) ? 1 : action.dueDate && getDateValue(action.dueDate) < now ? 2 : ["Critical", "High"].includes(action.priority) ? 6 : 8,
          tieWeight: action.priority === "Critical" ? 2 : action.priority === "High" ? 1 : 0,
          priorityScore: getActionPriorityScore(action),
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

      if (reasons.length > 0) {
        addAttentionItem(reasons[0], {
          id: project.id,
          objectType: "Project",
          title: project.projectName,
          reason: reasons.join(" • "),
          reasons,
          statusText: `${project.status || "No status"} / ${project.targetCompletionDate ? formatCapturedAt(project.targetCompletionDate) : "No target completion date"}`,
          area: project.area,
          attentionRank: isBlocked ? 1 : isOverdue ? 2 : isDueSoon ? 3 : 4,
          tieWeight: 0,
          priorityScore: isOverdue ? 180 : isDueSoon ? 120 : 60,
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
  const projectAttentionCount = new Set(
    commandAttentionGroups.flatMap((group) => group.items)
      .filter((item) => item.objectType === "Project")
      .map((item) => item.id),
  ).size;
  const attentionSummaryItems = commandAttentionGroups.map((group) => ({
    label: group.label,
    count: group.items.length,
  }));
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
                      item === "People"
                    ) {
                      setActiveView(item === "Command" ? "Command" : item);
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
                  {commandAttentionItems} item{commandAttentionItems === 1 ? "" : "s"}
                </span>
              </header>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#4d4944]">Attention items</div>
                  <div className="mt-2 text-[26px] font-semibold tracking-[-0.06em] text-[#171717]">{commandAttentionItems}</div>
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
              />
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

              {orderedLeads.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[14px] text-[#4d4944]">No Leads yet. Create the first lead to start tracking incoming work.</div>
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
                <button
                  type="button"
                  onClick={handleCreatePerson}
                  className="rounded-lg border border-[#171717] bg-[#171717] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#f7f4f1] transition hover:bg-[#2a2724]"
                >
                  Create Person
                </button>
              </header>

              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-[#43403b]">
                People records provide a structured foundation for names, roles, authority, skills, accountability and access level without replacing the broader operating model.
              </p>

              {orderedPeople.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-8 text-[14px] text-[#4d4944]">
                  No people yet. Create the first person record to establish the People foundation.
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  {orderedPeople.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => handlePersonEditOpen(person)}
                      className="block w-full rounded-2xl border border-[#d3cbc3] bg-[#f9f7f4] px-4 py-4 text-left transition hover:border-[#171717] hover:bg-[#f4f0ec]"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <h2 className="text-[20px] font-medium tracking-[-0.05em] text-[#171717]">
                            {person.name}
                          </h2>
                          <p className="mt-2 text-[14px] leading-6 text-[#424039]">
                            {person.role || "Role not specified"}
                          </p>
                        </div>
                        <span className="inline-flex w-fit rounded-full border border-[#cfc8c1] bg-[#f3efe9] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-[#38342f]">
                          {person.status}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.14em] text-[#4e4a45]">
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {person.pillar}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {person.accessLevel}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-white px-2 py-1.5">
                          {person.manager || "No manager"}
                        </span>
                        <span className="rounded-full border border-[#d3cbc3] bg-[#f1eee9] px-2 py-1.5">
                          {formatCapturedAt(person.dateCreated)}
                        </span>
                      </div>
                    </button>
                  ))}
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
          upstream={getCaptureLineage(problemEditor.sourceCaptureId)}
          downstream={actionRecords
            .filter((action) => action.relatedProblem === problemEditor.id)
            .map((action) => ({
              label: "Action",
              title: action.actionTitle,
              id: action.id,
              onClick: () => handleActionEditOpen(action),
            }))}
          onClose={() => {
            setSelectedProblemId(null);
            setProblemEditor(null);
          }}
          onChange={handleProblemEditorChange}
          onSave={handleProblemSave}
          onCreateLinkedAction={() => handleCreateLinkedAction(problemEditor)}
          onOpenLinkedAction={(action) => handleActionEditOpen(action)}
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
          downstream={actionRecords
            .filter((action) => action.relatedDecision === decisionEditor.id)
            .map((action) => ({
              label: "Action",
              title: action.actionTitle,
              id: action.id,
              onClick: () => handleActionEditOpen(action),
            }))}
          onClose={() => {
            setSelectedDecisionId(null);
            setDecisionEditor(null);
          }}
          onChange={handleDecisionEditorChange}
          onSave={handleDecisionSave}
          onCreateLinkedAction={() => handleDecisionCreateLinkedAction(decisionEditor)}
          onOpenLinkedAction={(action) => handleActionEditOpen(action)}
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

