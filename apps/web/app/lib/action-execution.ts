import { normalizeActionRecord, assertActionFinanceLink, assertActionLeadLink, type ActionRecord, type CaptureConversionRecord, type DecisionRecord, type ProblemRecord } from "./capture-conversions";
import { assertCapacityRecord } from "./delivery-capacity";
import { assertCommercialLessonRecord } from "./commercial-learning";
import { getDelegationReadinessMissingFields } from "./execution-release";
import { assertIcarusObservationActionLinks, assertIcarusObservationHandoffs } from "./icarus-observation-action";
import { validateDeliveryIncomeSave, type LeadDeliveryInput } from "./lead-delivery";
import type { IncomeRecord } from "./finance";

export type ActionExecutionInput = LeadDeliveryInput & {
  conversions: readonly CaptureConversionRecord[];
  problems: readonly ProblemRecord[];
  decisions: readonly DecisionRecord[];
};
export type ActionExecutionChange = { conversions: CaptureConversionRecord[]; income: IncomeRecord[]; incomeChanged: boolean; action: ActionRecord };

export function prepareActionExecutionChange(input: ActionExecutionInput, candidate: ActionRecord): ActionExecutionChange {
  const matches = input.conversions.filter((record) => record.id === candidate.id);
  if (matches.length !== 1 || matches[0].targetType !== "Convert to Action"
    || input.actions.filter((action) => action.id === candidate.id).length !== 1) {
    throw new Error("Select a unique persisted Action; missing or ambiguous execution records cannot be saved.");
  }
  const previous = normalizeActionRecord(matches[0]);
  for (const field of ["deliveryLeadId", "relatedLeadId", "financeIncomeId", "financeIncomeRole"] as const) {
    if (candidate[field] !== previous[field]) throw new Error("Use the existing linked-record workflow to change customer/financial execution references; ordinary Action edits cannot replace them.");
  }
  if (previous.commercialImplementation && candidate.implementsLessonId !== previous.implementsLessonId) {
    throw new Error("Commercial implementation attribution cannot be replaced by ordinary Action edits.");
  }
  if (candidate.deliveryLeadId && (input.leads.filter((lead) => lead.id === candidate.deliveryLeadId).length !== 1
    || input.leads.find((lead) => lead.id === candidate.deliveryLeadId)?.deliveryCommitment?.actionId !== candidate.id)) {
    throw new Error("Accepted delivery reference is missing, ambiguous or mismatched; reconcile the customer commitment before editing its Action.");
  }
  if (candidate.relatedLeadId && input.leads.filter((lead) => lead.id === candidate.relatedLeadId).length !== 1) {
    throw new Error("Commercial Lead reference is missing or ambiguous; reconcile it before editing its Action.");
  }
  if (candidate.implementsLessonId && input.conversions.filter((record) =>
    record.id === candidate.implementsLessonId && record.targetType === "Convert to Lesson").length !== 1) {
    throw new Error("Implementation Lesson is missing or ambiguous; reconcile its attributable commercial history.");
  }
  if (candidate.relatedProblem && input.problems.filter((problem) => problem.id === candidate.relatedProblem).length !== 1) {
    throw new Error("Related Problem is missing or ambiguous; explicitly reconcile its reference rather than silently dropping it.");
  }
  if (candidate.relatedDecision && input.decisions.filter((decision) => decision.id === candidate.relatedDecision).length !== 1) {
    throw new Error("Related Decision is missing or ambiguous; explicitly reconcile its reference rather than silently dropping it.");
  }
  const action = normalizeActionRecord({
    ...candidate,
    workloadAssessments: previous.workloadAssessments,
    commercialImplementation: previous.commercialImplementation,
    icarusObservationLinks: previous.icarusObservationLinks,
    icarusObservationHandoffs: previous.icarusObservationHandoffs,
  });
  assertCapacityRecord(action, "Action");
  assertCommercialLessonRecord(action);
  assertActionLeadLink(action.deliveryLeadId, "deliveryLeadId");
  assertActionLeadLink(action.relatedLeadId);
  assertActionFinanceLink(action.financeIncomeId, action.financeIncomeRole);
  assertIcarusObservationActionLinks(action.icarusObservationLinks);
  assertIcarusObservationHandoffs(action.icarusObservationHandoffs);
  const ownerChanged = previous.ownerPersonId !== action.ownerPersonId || previous.owner.trim() !== action.owner.trim();
  if (action.icarusObservationLinks?.length && ownerChanged) throw new Error("Observation responsibility requires its explicit accepted Icarus handoff; ordinary Action edits cannot transfer monitoring ownership.");
  let income = [...input.income];
  let incomeChanged = false;
  if (action.financeIncomeId) {
    const financialRecords = input.income.filter((record) => record.id === action.financeIncomeId);
    const record = financialRecords[0];
    const role = action.financeIncomeRole;
    const currentId = role === "Billing" ? record?.billingActionId : role === "Collection" ? record?.collectionActionId : undefined;
    if (financialRecords.length !== 1 || !role || (ownerChanged && currentId !== action.id)) {
      throw new Error("Finance responsibility is missing, ambiguous or historical; reconcile its current Income Action instead of rewriting ownership history.");
    }
    let nextIncome = record;
    if (ownerChanged) {
      const owners = input.people.filter((person) => person.id === action.ownerPersonId);
      if (owners.length !== 1 || owners[0].status !== "Active" || !owners[0].name.trim()
        || owners[0].name !== action.owner.trim() || getDelegationReadinessMissingFields(owners[0]).length) {
        throw new Error("Financial execution requires a unique active delegation-ready Person; responsibility cannot be cleared or inferred from a name.");
      }
      nextIncome = role === "Billing" ? { ...record, billingOwnerPersonId: owners[0].id }
        : { ...record, collectionOwnerPersonId: owners[0].id };
    }
    const actions = input.actions.map((entry) => entry.id === action.id ? action : entry);
    validateDeliveryIncomeSave(nextIncome, { ...input, actions });
    income = input.income.map((entry) => entry.id === record.id ? nextIncome : entry);
    incomeChanged = JSON.stringify(nextIncome) !== JSON.stringify(record);
  }
  return { action, conversions: input.conversions.map((record) => record.id === action.id ? action : record), income, incomeChanged };
}
