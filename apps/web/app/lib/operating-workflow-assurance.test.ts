import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { transpileModule, ScriptTarget, ModuleKind } from "typescript";
import { defaultLeadForm } from "./crm";
import { normalizeActionRecord, normalizeDecisionRecord, normalizeProblemRecord, type ActionRecord, type CaptureConversionRecord, type DecisionRecord, type ProblemRecord } from "./capture-conversions";
import { acceptLeadDelivery, scheduleLeadDelivery, buildLeadDelivery, createIncomeWorkflowAction, getDeliveryIncomeEvidence } from "./lead-delivery";
import { buildJobPerformance, recordJobFinancialReview } from "./job-performance";
import { buildCommercialLearning, createCommercialLesson, createCommercialImplementation } from "./commercial-learning";
import { buildDeliveryCapacity, recordAvailabilityReview, recordWorkloadAssessment } from "./delivery-capacity";
import { buildCapacityResolutions, createCapacityResolution, reviseCapacityResolution, approveCapacityResolution } from "./capacity-resolution";
import { buildCommandAttention } from "./command-attention";
import { prepareActionExecutionChange } from "./action-execution";
import { assertDelegationHandoffs, type DelegationHandoffRecord } from "./delegation-handoffs";
import { getDelegationReadinessMissingFields } from "./execution-release";
import { persistJsonArraysTransaction, PersistenceTransactionError } from "./persistence";
import { BACKUP_FORMAT, BACKUP_VERSION, CONVERSION_STORAGE_KEY, INCOME_STORAGE_KEY, LEAD_STORAGE_KEY,
  EXPENSE_STORAGE_KEY, PERSON_STORAGE_KEY, DELEGATION_HANDOFF_STORAGE_KEY, validateEmpireOsBackup } from "./backup";
import type { CommercialLearningInput } from "./commercial-learning";
import type { DeliveryCapacityInput } from "./delivery-capacity";
import type { IncomeRecord } from "./finance";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const owner = { id: "owner", name: "Original owner", status: "Active", role: "Delivery and finance",
  responsibilities: "Deliver agreed scope and record customer finance", authority: "Recorded delivery and finance authority", pillar: "Garden Maintenance" };
const receiver = { ...owner, id: "receiver", name: "Receiving owner" };
type Workflow = CommercialLearningInput & DeliveryCapacityInput;
function accepted(): Workflow {
  const input = { leads: [{ ...defaultLeadForm, id: "job", leadName: "Accepted customer scope", status: "Won" as const,
    serviceRequested: "Maintenance", relatedPillar: "Garden Maintenance", dateCreated: "2026-10-01T10:00:00Z" }],
    actions: [], people: [owner, receiver], income: [], nowMs: NOW - 24 * 60 * 60_000 };
  const result = acceptLeadDelivery(input, { leadId: "job", actionId: "delivery", scope: "Customer agreed scope",
    acceptedAt: "2026-10-02", acceptedByPersonId: owner.id, acceptanceEvidence: "Written scope acceptance",
    ownerPersonId: owner.id, promisedBy: "2026-10-12" });
  const linked = { ...input, leads: [result.lead], actions: [result.action] };
  return { ...linked, leads: [scheduleLeadDelivery(linked, "job", { date: "2026-10-10",
    evidence: "Agreed delivery schedule", recordedByPersonId: owner.id })],
    projects: [], problems: [], decisions: [], lessons: [], expenses: [], nowMs: NOW };
}
function readyJob(): Workflow {
  let source = accepted();
  const completed: ActionRecord = { ...source.actions[0], status: "Completed", completionDate: "2026-10-08T10:00:00Z",
    completionEvidence: "Agreed customer scope completion evidence" };
  const income: IncomeRecord = { id: "income", relatedLeadId: "job", date: "2026-10-08", description: "Customer scope",
    customerSource: "Customer", amount: "1000", area: "Garden Maintenance", status: "Expected", notes: "", dateCreated: "2026-10-08T10:00:00Z",
    earnedDate: "2026-10-08T10:00:00Z", earnedReference: "earned-scope", earnedEvidence: "Revenue recognition from completed agreed scope" };
  source = { ...source, actions: [completed], income: [income], expenses: [{
    id: "cost", relatedLeadId: "job", date: "2026-10-08", description: "Job labour", supplier: "Labour cost source",
    amount: "400", category: "Labour", area: "Garden Maintenance", status: "Planned", notes: "", dateCreated: "2026-10-08T10:00:00Z",
    jobCostType: "Direct", costReference: "labour-cost", incurredDate: "2026-10-08T10:00:00Z", incurredEvidence: "Attributed labour cost evidence" }],
    nowMs: NOW - 30 * 60_000 };
  const lead = recordJobFinancialReview(source, "job", { reviewedByPersonId: owner.id, revenueComplete: true,
    directCostsComplete: true, overheadCostsComplete: false, evidence: "All earned revenue/direct costs checked; other categories genuinely zero; overhead unknown" });
  source = { ...source, leads: [lead] };
  const lesson = createCommercialLesson(source, "lesson", "job", { cause: "Labour estimation", attribution: "Supported contribution",
    evidence: "Scope and actual cost basis reviewed", expectedDirectCost: "300", estimateEvidence: "Original scope estimate",
    changeKind: "Operating", ownerPersonId: owner.id, recommendedChange: "Review access before labour estimation" });
  return { ...source, lessons: [lesson], nowMs: NOW };
}
const records = (source: Workflow): CaptureConversionRecord[] => [...source.actions, ...source.lessons, ...source.decisions, ...source.problems];
const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
const start = page.indexOf("  const persistOwnershipRecords =");
const end = page.indexOf("  const handleProblemEditOpen =", start);
const creationStart = page.indexOf("  const handleDecisionCreateLinkedAction =");
const creationEnd = page.indexOf("  const handleOpenRelatedDecision =", creationStart);
const problemCreationStart = page.indexOf("  const handleCreateLinkedAction =");
const problemCreationEnd = page.indexOf("  const handleOpenRelatedProblem =", problemCreationStart);
if (start < 0 || end < start || creationStart < 0 || creationEnd < creationStart || problemCreationStart < 0 || problemCreationEnd < problemCreationStart) {
  throw new Error("Production execution persistence handlers could not be located.");
}
const production = transpileModule(`${page.slice(start, end)}${page.slice(creationStart, creationEnd)}${page.slice(problemCreationStart, problemCreationEnd)}
  api = { persistActionExecution, applyOwnershipChangeWithDelegationIntegrity, tryPersistExecution, handleDecisionCreateLinkedAction, handleCreateLinkedAction };`,
{ compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText;

function harness(source: Workflow) {
  const initial = {
    [CONVERSION_STORAGE_KEY]: JSON.stringify(records(source)), [INCOME_STORAGE_KEY]: JSON.stringify(source.income),
    [LEAD_STORAGE_KEY]: JSON.stringify(source.leads), [EXPENSE_STORAGE_KEY]: JSON.stringify(source.expenses),
    [PERSON_STORAGE_KEY]: JSON.stringify(source.people), [DELEGATION_HANDOFF_STORAGE_KEY]: JSON.stringify([]),
  };
  const data = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
  type Api = {
    persistActionExecution: (action: ActionRecord, handoffs?: DelegationHandoffRecord[]) => ActionRecord;
    tryPersistExecution: (commit: () => void) => boolean;
    handleDecisionCreateLinkedAction: (decision: DecisionRecord) => void;
    handleCreateLinkedAction: (problem: ProblemRecord) => void;
    applyOwnershipChangeWithDelegationIntegrity: (request: {
      objectType: "Action"; objectId: string; title: string; area: string; previousOwner: string;
      previousOwnerPersonId?: string; newOwner: string; newOwnerPersonId?: string; handoffContext: string;
      applyOwnershipChange: (handoffs: DelegationHandoffRecord[]) => void;
    }) => boolean;
  };
  const refs = {
    conversionsWritableRef: { current: true }, incomeWritableRef: { current: true }, leadsWritableRef: { current: true },
    projectsWritableRef: { current: true }, handoffsWritableRef: { current: true }, icarusWritableRef: { current: true },
    peopleWritableRef: { current: true }, expensesWritableRef: { current: true },
  };
  const feedback: { type: string; message: string }[] = [];
  const editor: { selectedId: string | null; action: ActionRecord | null } = { selectedId: null, action: null };
  const state: { conversions: CaptureConversionRecord[]; income: IncomeRecord[]; handoffs: DelegationHandoffRecord[] } = {
    conversions: records(source), income: [...source.income], handoffs: [],
  };
  const context = {
    ...refs, api: undefined as Api | undefined, window: { localStorage: storage }, operatingDataLoaded: true,
    get conversions() { return state.conversions; },
    get actionRecords() { return state.conversions.filter((record) => record.targetType === "Convert to Action").map(normalizeActionRecord); },
    get incomeRecords() { return state.income; },
    get delegationHandoffs() { return state.handoffs; },
    leads: source.leads, people: source.people, orderedPeople: source.people, delegationReadyPeople: source.people,
    problemRecords: source.problems, decisionRecords: source.decisions,
    creatingLinkedActionForDecisionId: null, generateConversionId: () => "new-implementation", normalizeActionRecord,
    creatingLinkedActionForProblemId: null, setCreatingLinkedActionForProblemId: () => {},
    setCreatingLinkedActionForDecisionId: () => {},
    setSelectedActionId: (value: string) => { editor.selectedId = value; },
    setActionEditor: (value: ActionRecord) => { editor.action = value; },
    CONVERSION_STORAGE_KEY, INCOME_STORAGE_KEY, LEAD_STORAGE_KEY, PROJECT_STORAGE_KEY: "empire-os-projects",
    PERSON_STORAGE_KEY, EXPENSE_STORAGE_KEY,
    DELEGATION_HANDOFF_STORAGE_KEY, ICARUS_STORAGE_KEY: "empire-os-icarus-assessments",
    prepareActionExecutionChange, assertDelegationHandoffs, persistJsonArraysTransaction, PersistenceTransactionError, Error,
    getDelegationReadinessMissingFields, isFounderOwned: () => false,
    getDelegationReadyPeopleForArea: () => source.people, setIncomeEditor: () => {},
    Date: class extends Date { constructor(value?: string | number) { super(value ?? NOW); } static now() { return NOW; } },
    setFeedback: (value: { type: string; message: string }) => { feedback.push(value); },
    setConversions: (value: CaptureConversionRecord[]) => { state.conversions = value; },
    setIncomeRecords: (value: IncomeRecord[]) => { state.income = value; },
    setDelegationHandoffs: (value: DelegationHandoffRecord[]) => { state.handoffs = value; },
  };
  runInNewContext(production, context, { timeout: 1000 });
  if (!context.api) throw new Error("Production execution handlers were not exposed.");
  const api = context.api;
  const save = (candidate: ActionRecord) => api.tryPersistExecution(() => { api.persistActionExecution(candidate); });
  const transfer = (candidate: ActionRecord) => {
    const previous = source.actions.find((action) => action.id === candidate.id)!;
    return api.applyOwnershipChangeWithDelegationIntegrity({ objectType: "Action", objectId: candidate.id,
      title: candidate.actionTitle, area: candidate.relatedPillar, previousOwner: previous.owner,
      previousOwnerPersonId: previous.ownerPersonId, newOwner: candidate.owner, newOwnerPersonId: candidate.ownerPersonId,
      handoffContext: "Explicit reassignment within existing authority",
      applyOwnershipChange: (handoffs) => { api.persistActionExecution(candidate, handoffs); } });
  };
  const reload = (): Workflow => ({ ...source, actions: JSON.parse(storage.getItem(CONVERSION_STORAGE_KEY) || "[]")
    .filter((record: CaptureConversionRecord) => record.targetType === "Convert to Action").map(normalizeActionRecord),
    income: JSON.parse(storage.getItem(INCOME_STORAGE_KEY) || "[]"), leads: JSON.parse(storage.getItem(LEAD_STORAGE_KEY) || "[]") });
  return { api, data, storage, state, refs, feedback, editor, save, transfer, reload };
}
function billed(source = readyJob()): Workflow {
  const routed = createIncomeWorkflowAction(source, { incomeId: "income", actionId: "billing", role: "Billing",
    ownerPersonId: owner.id, dueDate: "2026-10-09" });
  return { ...source, income: [routed.income], actions: [...source.actions, routed.action] };
}
function collectible(): Workflow {
  const source = billed();
  const issued = { ...source.income[0], invoiceIssuedDate: "2026-10-08T11:00:00Z", invoiceReference: "invoice-1", invoiceEvidence: "Customer invoice sent" };
  const billing = source.actions.map((action) => action.id === "billing" ? { ...action, status: "Completed" as const,
    completionDate: "2026-10-08T12:00:00Z", completionEvidence: "Invoice issued and recorded" } : action);
  const input = { ...source, income: [issued], actions: billing };
  const result = createIncomeWorkflowAction(input, { incomeId: issued.id, actionId: "collection", role: "Collection",
    ownerPersonId: owner.id, dueDate: "2026-10-09", paymentDueDate: "2026-10-10" });
  return { ...input, income: [result.income], actions: [...billing, result.action] };
}

describe("Connected execution assurance through actual production save handlers", () => {
  it("persists delivery completion before UI state and reload establishes delivery, but not earned income or profitability", () => {
    const source = accepted();
    const live = harness(source);
    expect(live.save({ ...source.actions[0], status: "Completed", completionDate: new Date(NOW).toISOString(),
      completionEvidence: "Agreed scope completed with attributable evidence" })).toBe(true);
    const restored = live.reload();
    expect(buildLeadDelivery(restored)[0].completionSupported).toBe(true);
    expect(buildJobPerformance(restored)[0]).toMatchObject({ contribution: null, receivedSubtotal: null, reviewCurrent: false });
    expect(live.state.conversions.find((record) => record.id === "delivery")!.status).toBe("Completed");
  });
  it("leaves delivery and UI unchanged when completion storage fails or silently refuses a write", () => {
    for (const silent of [false, true]) {
      const source = accepted();
      const live = harness(source);
      const before = Object.fromEntries(live.data);
      const original = live.storage.setItem;
      let failed = false;
      live.storage.setItem = (key, value) => {
        if (!failed && key === CONVERSION_STORAGE_KEY) { failed = true; if (!silent) throw new Error("Quota exceeded"); return; }
        original(key, value);
      };
      expect(live.save({ ...source.actions[0], status: "Completed", completionDate: new Date(NOW).toISOString(),
        completionEvidence: "Genuine evidence remains in the editor, not falsely saved" })).toBe(false);
      expect(Object.fromEntries(live.data)).toEqual(before);
      expect(live.state.conversions[0].status).toBe("Open");
      expect(buildLeadDelivery(live.reload())[0].completionSupported).toBe(false);
      expect(live.feedback.at(-1)?.type).toBe("error");
    }
  });
  it.each(["Billing", "Collection"] as const)("atomically reassigns %s Action, its Income responsibility and delegation history", (role) => {
    const source = role === "Billing" ? billed() : collectible();
    const current = source.actions.find((action) => action.financeIncomeRole === role)!;
    const live = harness(source);
    const untouched = source.income[0];
    expect(live.transfer({ ...current, owner: receiver.name, ownerPersonId: receiver.id })).toBe(true);
    const restored = live.reload();
    const financial = getDeliveryIncomeEvidence(restored.income[0], restored);
    expect(role === "Billing" ? financial.billingActionTracked : financial.collectionActionTracked).toBe(true);
    expect(restored.income[0][role === "Billing" ? "billingOwnerPersonId" : "collectionOwnerPersonId"]).toBe(receiver.id);
    expect(restored.income[0].amount).toBe(untouched.amount);
    expect(restored.income[0].earnedEvidence).toBe(untouched.earnedEvidence);
    expect(restored.income[0].receiptEvidence).toBe(untouched.receiptEvidence);
    expect(live.state.handoffs[0]).toMatchObject({ objectId: current.id, newOwnerPersonId: receiver.id });
    expect(JSON.parse(live.storage.getItem(DELEGATION_HANDOFF_STORAGE_KEY)!)[0].newOwnerPersonId).toBe(receiver.id);
  });
  it("allows genuine invoicing follow-through despite unpaid balance and unresolved subsequent collection controls", () => {
    const source = billed();
    const issued = { ...source.income[0], invoiceIssuedDate: "2026-10-08T11:00:00Z",
      invoiceReference: "issued-invoice", invoiceEvidence: "Actual invoice sent to customer" };
    const live = harness({ ...source, income: [issued] });
    const billing = source.actions.find((action) => action.id === "billing")!;
    expect(live.save({ ...billing, status: "Completed", completionDate: new Date(NOW).toISOString(),
      completionEvidence: "Customer invoice issue recorded; collection still unresolved" })).toBe(true);
    const restored = live.reload();
    const evidence = getDeliveryIncomeEvidence(restored.income[0], restored);
    expect(evidence).toMatchObject({ invoiced: true, received: false, validationErrors: [] });
    expect(evidence.workflowReasons).toEqual(expect.arrayContaining([
      "DELIVERY FINANCE: Invoiced balance has no valid payment deadline",
      "DELIVERY FINANCE: Invoiced balance has no active delegation-ready collection owner",
      "DELIVERY FINANCE: Invoiced customer balance remains unpaid",
    ]));
  });
  it.each([INCOME_STORAGE_KEY, DELEGATION_HANDOFF_STORAGE_KEY])("rolls back every related store and UI when %s fails during delegation", (failedKey) => {
    const source = collectible();
    const current = source.actions.find((action) => action.id === "collection")!;
    const live = harness(source);
    const before = Object.fromEntries(live.data);
    const original = live.storage.setItem;
    let failed = false;
    live.storage.setItem = (key, value) => {
      if (key === failedKey && !failed) { failed = true; throw new Error("Related write rejected"); }
      original(key, value);
    };
    expect(live.transfer({ ...current, owner: receiver.name, ownerPersonId: receiver.id })).toBe(false);
    expect(Object.fromEntries(live.data)).toEqual(before);
    expect(live.state.handoffs).toEqual([]);
    expect(live.state.income[0].collectionOwnerPersonId).toBe(owner.id);
    expect(getDeliveryIncomeEvidence(live.reload().income[0], live.reload()).collectionActionTracked).toBe(true);
  });
  it("locks connected execution stores after failed rollback instead of overwriting uncertain ownership on the next save", () => {
    const source = collectible();
    const current = source.actions.find((action) => action.id === "collection")!;
    const live = harness(source);
    const original = live.storage.setItem;
    let write = 0;
    live.storage.setItem = (key, value) => {
      write++;
      if (write === 1) { original(key, value); return; }
      throw new Error("Storage unavailable");
    };
    expect(live.transfer({ ...current, owner: receiver.name, ownerPersonId: receiver.id })).toBe(false);
    expect(live.feedback.at(-1)?.message).toContain("Rollback failed");
    expect(Object.values(live.refs).every((ref) => !ref.current)).toBe(true);
    const state = JSON.stringify(live.state);
    const writes = write;
    expect(live.save(current)).toBe(false);
    expect(write).toBe(writes);
    expect(JSON.stringify(live.state)).toBe(state);
  });
  it("does not overwrite unreadable delegation history or allow ambiguous financial responsibility", () => {
    const source = collectible();
    const current = source.actions.find((action) => action.id === "collection")!;
    const live = harness(source);
    live.data.set(DELEGATION_HANDOFF_STORAGE_KEY, "{unreadable historical evidence");
    live.refs.handoffsWritableRef.current = false;
    const before = Object.fromEntries(live.data);
    expect(live.transfer({ ...current, owner: receiver.name, ownerPersonId: receiver.id })).toBe(false);
    expect(Object.fromEntries(live.data)).toEqual(before);
    const ambiguous = harness({ ...source, income: [source.income[0], source.income[0]] });
    expect(ambiguous.transfer({ ...current, owner: receiver.name, ownerPersonId: receiver.id })).toBe(false);
    expect(ambiguous.state.handoffs).toEqual([]);
  });
  it.each([
    { completionEvidence: "", completionSupported: false },
    { completionEvidence: "Revised attributable completion evidence for the agreed scope", completionSupported: true },
  ])("keeps stale profitability visible with completionSupported=$completionSupported after execution evidence changes", ({ completionEvidence, completionSupported }) => {
    const source = readyJob();
    expect(buildJobPerformance(source)[0].contribution).toBe(600);
    expect(buildCommercialLearning(source)[0].diagnosisCurrent).toBe(true);
    const live = harness(source);
    expect(live.save({ ...source.actions[0], completionEvidence })).toBe(true);
    const restored = live.reload();
    expect(buildLeadDelivery(restored)[0].completionSupported).toBe(completionSupported);
    expect(buildJobPerformance(restored)[0]).toMatchObject({ contribution: null, reviewCurrent: false, receivedSubtotal: null });
    expect(buildCommercialLearning(restored)[0].diagnosisCurrent).toBe(false);
    expect(restored.leads[0].jobFinancialReview).toEqual(source.leads[0].jobFinancialReview);
    const attention = buildCommandAttention({ problems: [], actions: restored.actions, decisions: [], projects: [], outreach: [], opportunities: [],
      lessons: [], systems: [], sops: [], handoffs: [], procurementQueue: [], nowMs: NOW, jobPerformance: restored, delivery: restored }).items;
    const reviewReason = completionSupported
      ? "JOB FINANCE: Completed job needs a current attributed financial coverage review"
      : "JOB FINANCE: Existing financial coverage review is stale; reconcile delivery and financial evidence before relying on profitability";
    expect(attention).toEqual(expect.arrayContaining([expect.objectContaining({
      id: "job", objectType: "Lead", reasons: expect.arrayContaining([reviewReason]),
    })]));
    const missingCompletionReason = "DELIVERY: Completed Action lacks admissible linked delivery completion evidence";
    if (!completionSupported) {
      expect(attention).toEqual(expect.arrayContaining([expect.objectContaining({
        id: "delivery", objectType: "Action", reasons: expect.arrayContaining([missingCompletionReason]),
      })]));
      expect(() => recordJobFinancialReview(restored, "job", {
        reviewedByPersonId: owner.id, revenueComplete: true, directCostsComplete: true, overheadCostsComplete: false,
        evidence: source.leads[0].jobFinancialReview!.evidence,
      })).toThrow("evidence-supported delivery completion");
    } else {
      expect(attention.flatMap((item) => item.reasons)).not.toContain(missingCompletionReason);
    }
  });
  it("reconciles completed delivery, earned/invoiced/received money, incurred costs and a fresh review without treating contribution as net profit", () => {
    let source = collectible();
    const received: IncomeRecord = { ...source.income[0], status: "Received", date: "2026-10-08T11:59:00Z",
      receiptReference: "payment-1", receiptEvidence: "Customer payment matched to invoice" };
    source = { ...source, income: [received] };
    const evidence = getDeliveryIncomeEvidence(received, source);
    expect(evidence).toMatchObject({ earned: true, invoiced: true, received: true, validationErrors: [] });
    expect(buildJobPerformance(source)[0].contribution).toBeNull();
    const reviewed = recordJobFinancialReview(source, "job", { reviewedByPersonId: owner.id, revenueComplete: true, directCostsComplete: true,
      overheadCostsComplete: false, evidence: "Full customer revenue and incurred direct costs reconciled to attributable evidence; shared overhead unresolved" });
    source = { ...source, leads: [reviewed] };
    expect(buildJobPerformance(source)[0]).toMatchObject({ earnedSubtotal: 1000, receivedSubtotal: 1000, directCostSubtotal: 400,
      contribution: 600, profitAfterAllocatedCosts: null, reviewCurrent: true });
    expect(buildCommercialLearning(source)[0].diagnosisCurrent).toBe(false);
    const newLesson = createCommercialLesson(source, "reconciled-lesson", "job", { cause: "Labour estimation", attribution: "Supported contribution",
      evidence: "Reconciled contribution supports learning", expectedDirectCost: "", estimateEvidence: "", changeKind: "Operating",
      ownerPersonId: owner.id, recommendedChange: "Use access observations in future scope estimates" });
    expect(buildCommercialLearning({ ...source, lessons: [newLesson] })[0]).toMatchObject({ diagnosisCurrent: true, outcome: "Unknown" });
  });
  it("rejects changing financial bindings, orphaned dependencies and superseded finance responsibility instead of silently rewriting evidence", () => {
    const source = collectible();
    const current = source.actions.find((action) => action.id === "collection")!;
    for (const candidate of [{ ...current, financeIncomeId: "different-income" }, { ...current, relatedProblem: "missing-problem" },
      { ...current, relatedDecision: "missing-decision" }]) {
      const live = harness(source);
      const before = Object.fromEntries(live.data);
      expect(live.save(candidate)).toBe(false);
      expect(Object.fromEntries(live.data)).toEqual(before);
      expect(live.feedback.at(-1)?.type).toBe("error");
    }
    const historical = harness({ ...source, income: [{ ...source.income[0], collectionActionId: "replacement" }] });
    expect(historical.transfer({ ...current, owner: receiver.name, ownerPersonId: receiver.id })).toBe(false);
    expect(historical.state.income[0].collectionOwnerPersonId).toBe(owner.id);
    expect(historical.state.handoffs).toEqual([]);
    expect(harness({ ...source, actions: [...source.actions, current] }).save(current)).toBe(false);
    expect(harness({ ...source, income: [] }).save(current)).toBe(false);
    expect(harness({ ...source, leads: [] }).save(source.actions[0])).toBe(false);
  });
  it("retains Icarus observation lineage through ordinary saves and refuses owner transfer without explicit accepted monitoring handoff", () => {
    const plan = { id: "plan", recordedAt: "2026-10-07T10:00:00Z", recordedByPersonId: owner.id, ownerPersonId: owner.id,
      protection: "Operating barrier", controlIds: [], evidenceRequirements: "Fresh attributable operating observations",
      acceptanceCriteria: "Barrier operates as specified", firstReviewBy: "2026-10-12" };
    const observation = { ...normalizeActionRecord({ id: "observe", targetType: "Convert to Action", sourceCaptureId: "",
      title: "Observe protection", originalRawNote: plan.evidenceRequirements, relatedArea: owner.pillar, importance: "High",
      status: "Open", owner: owner.name, dueDate: "2026-10-12", createdAt: "2026-10-07T12:00:00Z",
      icarusObservationLinks: [{ assessmentId: "risk", treatmentTargetId: "treatment", plan, reviewBy: "2026-10-12",
        linkedAt: "2026-10-07T12:00:00Z", linkedByPersonId: owner.id }] }), ownerPersonId: owner.id };
    const source = { ...accepted(), leads: [], actions: [observation] };
    const live = harness(source);
    expect(live.save({ ...observation, icarusObservationLinks: [] })).toBe(true);
    expect(live.reload().actions[0].icarusObservationLinks).toEqual(observation.icarusObservationLinks);
    expect(live.transfer({ ...observation, owner: receiver.name, ownerPersonId: receiver.id })).toBe(false);
    expect(live.reload().actions[0].ownerPersonId).toBe(owner.id);
    expect(live.state.handoffs).toEqual([]);
    expect(live.feedback.at(-1)?.message).toContain("explicit accepted Icarus handoff");
  });
  it("persists genuine Lesson implementation completion without inventing a commercial outcome or losing proposal history", () => {
    let source = readyJob();
    const implementation = createCommercialImplementation(source, "lesson", "implementation", owner.id, "2026-10-12");
    source = { ...source, actions: [...source.actions, implementation] };
    const live = harness(source);
    expect(live.save({ ...implementation, status: "Completed", completionDate: new Date(NOW).toISOString(),
      completionEvidence: "Checklist implemented; commercial outcome still untested", commercialImplementation: undefined })).toBe(true);
    const restored = live.reload();
    const record = restored.actions.find((action) => action.id === "implementation")!;
    expect(record.commercialImplementation).toEqual(implementation.commercialImplementation);
    expect(buildCommercialLearning(restored)[0]).toMatchObject({ implementationComplete: true, evaluationCurrent: false, outcome: "Unknown" });
  });
  it.each(["Decision", "Problem"] as const)("opens a %s implementation Action only after durable creation, rejecting unsaved source scope", (type) => {
    const decision = normalizeDecisionRecord({ id: "decision", targetType: "Convert to Decision", sourceCaptureId: "", createdAt: new Date(NOW).toISOString(),
      title: "Operational response", originalRawNote: "Scoped response", relatedArea: owner.pillar, importance: "High",
      status: "Active", decisionStatement: "Scoped implementation" });
    const problem = normalizeProblemRecord({ id: "problem", targetType: "Convert to Problem", sourceCaptureId: "", createdAt: new Date(NOW).toISOString(),
      title: "Operational constraint", originalRawNote: "Observed condition", relatedArea: owner.pillar, importance: "High",
      status: "Open", problemStatement: "Observed operating constraint", owner: owner.name });
    const source = { ...accepted(), decisions: [decision], problems: [problem] };
    const create = (live: ReturnType<typeof harness>, dirty = false) => {
      if (type === "Decision") live.api.handleDecisionCreateLinkedAction(dirty ? { ...decision, title: "Unsaved source scope" } : decision);
      else live.api.handleCreateLinkedAction(dirty ? { ...problem, title: "Unsaved source scope" } : problem);
    };
    const blocked = harness(source);
    const before = Object.fromEntries(blocked.data);
    let failed = false;
    const original = blocked.storage.setItem;
    blocked.storage.setItem = (key, value) => {
      if (!failed) { failed = true; throw new Error("Creation not persisted"); }
      original(key, value);
    };
    create(blocked);
    expect(blocked.editor).toEqual({ selectedId: null, action: null });
    expect(blocked.feedback.at(-1)?.type).toBe("error");
    expect(Object.fromEntries(blocked.data)).toEqual(before);
    const dirty = harness(source);
    create(dirty, true);
    expect(dirty.editor.selectedId).toBeNull();
    expect(dirty.feedback.at(-1)?.message).toContain("Save or reload");
    const saved = harness(source);
    create(saved);
    expect(saved.editor.selectedId).toBe("new-implementation");
    expect(saved.reload().actions.find((action) => action.id === "new-implementation"))
      .toMatchObject({ [type === "Decision" ? "relatedDecision" : "relatedProblem"]: type === "Decision" ? decision.id : problem.id, status: "Open" });
    expect(saved.feedback.at(-1)?.type).toBe("success");
  });
});

describe("Capacity and resolution remain bound to persisted execution", () => {
  function constrained(): Workflow {
    let source = accepted();
    const lead = recordWorkloadAssessment(source, { objectType: "Lead", id: "job" }, { personId: owner.id, recordedByPersonId: owner.id,
      windowStart: "2026-10-09", windowEnd: "2026-10-12", remainingHours: "10", estimateEvidence: "Remaining agreed customer workload",
      readinessConfirmed: true, readinessEvidence: "Schedule, access, resources and quality assumptions reviewed", dependencyActionIds: [], validUntil: "2026-10-12" });
    source = { ...source, leads: [{ ...source.leads[0], workloadAssessments: lead.workloadAssessments }] };
    const person = recordAvailabilityReview(source, owner.id, { recordedByPersonId: owner.id, windowStart: "2026-10-09", windowEnd: "2026-10-12",
      availableHours: "5", evidence: "Confirmed available hours", workloadCoverageComplete: true, coverageEvidence: "All competing obligations and routine duties reviewed",
      validUntil: "2026-10-12" });
    return { ...source, people: source.people.map((entry) => entry.id === owner.id ? { ...entry, availabilityReviews: person.availabilityReviews } : entry) };
  }
  it("stales committed sizing/availability when delivery ownership actually changes, retaining original acceptance evidence", () => {
    const source = constrained();
    expect(buildDeliveryCapacity(source).people.find((person) => person.personId === owner.id)?.plannedOvercommitment).toBe(true);
    const live = harness(source);
    expect(live.transfer({ ...source.actions[0], owner: receiver.name, ownerPersonId: receiver.id })).toBe(true);
    const restored = live.reload();
    expect(buildLeadDelivery(restored)[0]).toMatchObject({ assigned: true, completionSupported: false });
    expect(buildDeliveryCapacity(restored).work[0]).toMatchObject({ ownerPersonId: receiver.id, assessmentCurrent: false, remainingHours: null });
    expect(restored.leads[0].deliveryCommitment).toEqual(source.leads[0].deliveryCommitment);
    expect(restored.leads[0].workloadAssessments).toEqual(source.leads[0].workloadAssessments);
  });
  it("does not report implemented/successful resolution when a milestone completion fails to persist", () => {
    let source = constrained();
    const input = { ...source, commitments: [] };
    const diagnosis = createCapacityResolution(input, "resolution", owner.id, owner.id, "Five hours of covered shortage");
    const milestone = { ...normalizeActionRecord({ id: "milestone", targetType: "Convert to Action", sourceCaptureId: "", title: "Scoped process trial",
      originalRawNote: "Review delivery setup", relatedArea: owner.pillar, importance: "Low", status: "Open", relatedDecision: diagnosis.id,
      owner: receiver.name, dueDate: "2026-10-12", createdAt: new Date(NOW).toISOString() }), ownerPersonId: receiver.id };
    source = { ...source, decisions: [{ ...diagnosis, status: "Active", decisionStatus: "Active", decisionDate: "2026-10-08", reviewDate: "2026-10-12",
      reasoning: "Recorded evidence supports a controlled trial", evidenceConsidered: "Work and availability evidence", decisionStatement: "Trial setup improvement" }],
      actions: [...source.actions, milestone] };
    const alternatives = diagnosis.capacityResolution!.alternatives.map((option) => ({ ...option, rationale: "Reviewed; unverified alternatives remain unresolved",
      ...(option.kind === "Process improvement" ? { feasibility: "Feasible" as const, cost: "0", costEvidence: "No incremental spend; labour within existing duties",
        availableHours: "2", availabilityEvidence: "Confirmed implementation time", expectedReliefHours: "3", impactEvidence: "Trial estimate; quality maintained",
        dependencyEvidence: "No external prerequisites", authorityEvidence: "Delegated operational improvement authority", validUntil: "2026-10-12" } : {}) }));
    const revised = reviseCapacityResolution({ ...source, commitments: [] }, diagnosis.id, alternatives, "Process improvement", [milestone.id]);
    source = { ...source, decisions: [revised] };
    const approved = approveCapacityResolution({ ...source, commitments: [] }, diagnosis.id, { personId: owner.id,
      evidence: "Explicit approval", authorityEvidence: "Within recorded authority", selectionRationale: "Best evidence-supported alternative", capitalEvidence: "" });
    source = { ...source, decisions: [approved] };
    const live = harness(source);
    const original = live.storage.setItem;
    let failed = false;
    live.storage.setItem = (key, value) => {
      if (key === CONVERSION_STORAGE_KEY && !failed) { failed = true; throw new Error("Milestone not persisted"); }
      original(key, value);
    };
    expect(live.save({ ...milestone, status: "Completed", completionDate: new Date(NOW).toISOString(),
      completionEvidence: "Trial performed; still must verify capacity outcome" })).toBe(false);
    const restored = live.reload();
    expect(buildCapacityResolutions({ ...restored, commitments: [] })[0]).toMatchObject({ approvalCurrent: true, implementationComplete: false, outcome: "Unknown" });
    expect(live.save({ ...milestone, description: "Revised implementation scope", actionDescription: "Revised implementation scope" })).toBe(true);
    expect(buildCapacityResolutions({ ...live.reload(), commitments: [] })[0]).toMatchObject({ approvalCurrent: false, implementationComplete: false, outcome: "Unknown" });
  });
  it("round-trips connected financial ownership and original evidence in version-one backups, refusing malformed handoff history", () => {
    const source = collectible();
    const live = harness(source);
    const collection = source.actions.find((action) => action.id === "collection")!;
    expect(live.transfer({ ...collection, owner: receiver.name, ownerPersonId: receiver.id })).toBe(true);
    const backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date(NOW).toISOString(), storage: Object.fromEntries(live.data) };
    expect(validateEmpireOsBackup(backup).storage).toEqual(backup.storage);
    expect(() => validateEmpireOsBackup({ ...backup, storage: { ...backup.storage, [DELEGATION_HANDOFF_STORAGE_KEY]: "[{}]" } })).toThrow("malformed");
    expect(() => validateEmpireOsBackup({ ...backup, storage: { ...backup.storage, [DELEGATION_HANDOFF_STORAGE_KEY]: "{}" } })).toThrow();
    const legacy = { ...live.state.handoffs[0], status: undefined, delegatedBy: undefined, reviewDate: undefined, outcomeLesson: undefined };
    expect(() => assertDelegationHandoffs([legacy])).not.toThrow();
    expect(() => assertDelegationHandoffs([legacy, { ...legacy, newOwnerPersonId: 5 }])).toThrow("malformed");
  });
});

describe("Actual delegation hydration never erases malformed persisted history", () => {
  const hydrateStart = page.indexOf("      if (storedDelegationHandoffs) {");
  const hydrateEnd = page.indexOf("      if (storedCashPosition)", hydrateStart);
  const assertion = page.indexOf("      assertDelegationHandoffs(delegationHandoffs);");
  const effectStart = page.lastIndexOf("  useEffect(() => {", assertion) + "  useEffect(() => {".length;
  const effectEnd = page.indexOf("  }, [delegationHandoffs", assertion);
  if (hydrateStart < 0 || hydrateEnd < hydrateStart || assertion < 0 || effectEnd < effectStart) throw new Error("Delegation hydration/persistence could not be located.");
  const hydration = transpileModule(`${page.slice(hydrateStart, hydrateEnd)}
    (() => { ${page.slice(effectStart, effectEnd)} })();`,
  { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText;
  it.each(["{broken", "{}", "[{}]"])("preserves %s exactly and blocks its autosave", (stored) => {
    let persisted: string | null = stored;
    const errors: string[] = [];
    const context = { storedDelegationHandoffs: stored, handoffsWritableRef: { current: false }, operatingDataLoaded: true,
      delegationHandoffs: [], assertDelegationHandoffs, persistJsonArraysTransaction, DELEGATION_HANDOFF_STORAGE_KEY,
      setDelegationHandoffs: () => { throw new Error("Malformed records must not hydrate as success."); },
      setFeedback: (feedback: { message: string }) => { errors.push(feedback.message); },
      window: { localStorage: { getItem: () => persisted, setItem: (_key: string, value: string) => { persisted = value; },
        removeItem: () => { persisted = null; } } } };
    runInNewContext(hydration, context, { timeout: 1000 });
    expect(persisted).toBe(stored);
    expect(context.handoffsWritableRef.current).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("preserved");
  });
  it("hydrates legacy optional fields without changing historical strings, attribution or extra stored properties", () => {
    const record = { id: "legacy", objectType: "Action", objectId: "work", title: "Historical transfer", area: owner.pillar,
      previousOwner: owner.name, newOwner: receiver.name, newOwnerPersonId: receiver.id,
      transferredAt: "2026-10-01T12:00:00Z", handoffContext: "Historical context retained", legacyEvidence: { reference: "original" } };
    let persisted: string | null = JSON.stringify([record]);
    const context = { storedDelegationHandoffs: persisted, handoffsWritableRef: { current: false }, operatingDataLoaded: true,
      delegationHandoffs: [] as unknown[], assertDelegationHandoffs, persistJsonArraysTransaction, DELEGATION_HANDOFF_STORAGE_KEY,
      setDelegationHandoffs: (value: DelegationHandoffRecord[]) => { context.delegationHandoffs = value; },
      setFeedback: () => { throw new Error("Valid legacy history must remain loadable."); },
      window: { localStorage: { getItem: () => persisted, setItem: (_key: string, value: string) => { persisted = value; },
        removeItem: () => { persisted = null; } } } };
    runInNewContext(hydration, context, { timeout: 1000 });
    expect(context.handoffsWritableRef.current).toBe(true);
    expect(context.delegationHandoffs).toEqual([record]);
    expect(persisted).toBe(JSON.stringify([record]));
  });
});
