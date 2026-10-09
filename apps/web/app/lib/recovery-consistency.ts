import { isIcarusObservationPlan } from "./icarus";
import { sameIcarusObservationPlan } from "./icarus-observation-plan";
import { findDuplicateIds } from "./integrity-core";

type RecordData = Record<string, unknown>;
type RecoveryStores = {
  conversions?: string | null; leads?: string | null; people?: string | null; projects?: string | null;
  income?: string | null; expenses?: string | null; commitments?: string | null; icarus?: string | null;
};

export function getRecoveryReferenceIssues(stores: RecoveryStores): string[] {
  const read = (raw: string | null | undefined): RecordData[] => {
    if (raw == null) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error("Recovery reference validation requires array stores.");
    return value.filter((record): record is RecordData => record !== null && typeof record === "object" && !Array.isArray(record));
  };
  const conversions = read(stores.conversions);
  const leads = read(stores.leads);
  const people = read(stores.people);
  const projects = read(stores.projects);
  const income = read(stores.income);
  const expenses = read(stores.expenses);
  const commitments = read(stores.commitments);
  const assessments = read(stores.icarus);
  const actions = conversions.filter((record) => record.targetType === "Convert to Action");
  const lessons = conversions.filter((record) => record.targetType === "Convert to Lesson");
  const decisions = conversions.filter((record) => record.targetType === "Convert to Decision");
  const issues: string[] = [];
  const object = (value: unknown): value is RecordData => value !== null && typeof value === "object" && !Array.isArray(value);
  const unique = (records: RecordData[], id: unknown) => typeof id === "string" && id.trim()
    ? records.filter((record) => record.id === id) : [];
  const requireReference = (source: RecordData, field: string, id: unknown, records: RecordData[]) => {
    if (unique(records, id).length !== 1) issues.push(`${String(source.id)}: ${field} has no unique matching record (${String(id)})`);
  };
  const optionalReference = (source: RecordData, field: string, records: RecordData[]) => {
    if (typeof source[field] === "string" && source[field]) requireReference(source, field, source[field], records);
  };
  for (const [name, records] of Object.entries({ conversions, leads, people, projects, income, expenses, commitments, assessments })) {
    const identities = records.flatMap((record) => typeof record.id === "string" && record.id.trim() ? [{ id: record.id }] : []);
    for (const id of findDuplicateIds(identities).keys()) issues.push(`${name}: duplicated identity ${id}`);
  }
  for (const lead of leads) {
    if (!object(lead.deliveryCommitment)) continue;
    const commitment = lead.deliveryCommitment;
    requireReference(lead, "delivery Action", commitment.actionId, actions);
    const action = unique(actions, commitment.actionId)[0];
    if (action && action.deliveryLeadId !== lead.id) issues.push(`${String(lead.id)}: delivery Action does not point back to its accepted Lead`);
    requireReference(lead, "acceptance attribution", commitment.acceptedByPersonId, people);
    requireReference(lead, "original delivery attribution", commitment.assignedPersonId, people);
  }
  for (const action of actions) {
    optionalReference(action, "relatedLeadId", leads);
    optionalReference(action, "deliveryLeadId", leads);
    optionalReference(action, "financeIncomeId", income);
    if (action.commercialImplementation) {
      optionalReference(action, "implementsLessonId", lessons);
      optionalReference(action, "relatedDecision", decisions);
    }
    if (action.deliveryLeadId) {
      const lead = unique(leads, action.deliveryLeadId)[0];
      if (lead && (!object(lead.deliveryCommitment) || lead.deliveryCommitment.actionId !== action.id)) {
        issues.push(`${String(action.id)}: delivery Lead does not reference this Action`);
      }
    }
    if (Array.isArray(action.icarusObservationLinks)) {
      for (const link of action.icarusObservationLinks) {
        if (!object(link)) continue;
        requireReference(action, "Icarus assessment", link.assessmentId, assessments);
        const assessment = unique(assessments, link.assessmentId)[0];
        const targets = assessment && Array.isArray(assessment.treatmentTargets) ? assessment.treatmentTargets.filter(object) : [];
        requireReference(action, "Icarus treatment target", link.treatmentTargetId, targets);
        const target = unique(targets, link.treatmentTargetId)[0];
        const plans = target && Array.isArray(target.observationPlans) ? target.observationPlans.filter(object) : [];
        if (object(link.plan)) {
          requireReference(action, "Icarus observation plan", link.plan.id, plans);
          const plan = unique(plans, link.plan.id)[0];
          if (plan && (!isIcarusObservationPlan(plan) || !isIcarusObservationPlan(link.plan)
            || !sameIcarusObservationPlan(plan, link.plan) || action.ownerPersonId !== plan.ownerPersonId)) {
            issues.push(`${String(action.id)}: Icarus observation plan or ownership disagrees with assessment history`);
          }
        }
      }
    }
  }
  for (const record of income) {
    optionalReference(record, "relatedLeadId", leads);
    for (const role of ["billing", "collection"] as const) {
      const actionId = record[`${role}ActionId`];
      if (!actionId) continue;
      requireReference(record, `${role} Action`, actionId, actions);
      requireReference(record, `${role} owner`, record[`${role}OwnerPersonId`], people);
      const action = unique(actions, actionId)[0];
      if (action && (action.financeIncomeId !== record.id || action.financeIncomeRole !== (role === "billing" ? "Billing" : "Collection")
        || action.ownerPersonId !== record[`${role}OwnerPersonId`])) {
        issues.push(`${String(record.id)}: ${role} Action and Income responsibility disagree`);
      }
    }
  }
  for (const field of ["invoiceReference", "receiptReference", "earnedReference"] as const) {
    const references = new Set<string>();
    for (const record of income) {
      const value = record[field];
      if (typeof value !== "string" || !value.trim()) continue;
      const reference = field === "earnedReference" ? value.trim().toLowerCase() : value.trim();
      if (references.has(reference)) issues.push(`income: duplicated ${field} ${value.trim()}`);
      references.add(reference);
    }
  }
  const costReferences = new Set<string>();
  for (const expense of expenses) {
    optionalReference(expense, "relatedLeadId", leads);
    if (!expense.relatedLeadId || typeof expense.costReference !== "string" || !expense.costReference.trim()) continue;
    const reference = expense.costReference.trim().toLowerCase();
    if (costReferences.has(reference)) issues.push(`expenses: duplicated costReference ${expense.costReference.trim()}`);
    costReferences.add(reference);
  }
  for (const lesson of lessons) {
    if (!object(lesson.commercialLearning) || !object(lesson.commercialLearning.diagnosis)) continue;
    requireReference(lesson, "commercial diagnosis job", lesson.commercialLearning.diagnosis.leadId, leads);
    optionalReference(lesson, "relatedDecision", decisions);
  }
  for (const decision of decisions) {
    if (!object(decision.capacityResolution)) continue;
    const resolution = decision.capacityResolution;
    if (object(resolution.baseline)) requireReference(decision, "capacity Person", resolution.baseline.personId, people);
    if (Array.isArray(resolution.milestoneActionIds)) {
      for (const id of resolution.milestoneActionIds) {
        requireReference(decision, "capacity milestone", id, actions);
        const action = unique(actions, id)[0];
        if (action && action.relatedDecision !== decision.id) issues.push(`${String(decision.id)}: milestone does not point back to its capacity Decision`);
      }
    }
    if (Array.isArray(resolution.alternatives)) {
      for (const option of resolution.alternatives.filter(object)) {
        optionalReference(option, "commitmentId", commitments);
        if (Array.isArray(option.dependencyActionIds)) {
          for (const id of option.dependencyActionIds) requireReference(decision, "capacity prerequisite", id, actions);
        }
      }
    }
  }
  return [...new Set(issues)];
}
