import { describe, expect, it } from "vitest";
import { defaultLeadForm } from "./crm";
import { acceptLeadDelivery } from "./lead-delivery";
import { recordJobFinancialReview } from "./job-performance";
import { normalizeActionRecord, normalizeLessonRecord, applyLessonEditorChanges } from "./capture-conversions";
import { assertCommercialLearning, approveCommercialProposal, buildCommercialLearning, createCommercialImplementation,
  createCommercialLesson, evaluateCommercialChange, prepareCommercialDecision, commercialLearningValidity, assignCommercialResponsibility,
  type CommercialLearningInput } from "./commercial-learning";
import { buildOrganisationalLearning } from "./organisational-learning";
import { buildCommandAttention } from "./command-attention";
import { BACKUP_FORMAT, BACKUP_VERSION, CONVERSION_STORAGE_KEY, validateEmpireOsBackup } from "./backup";
import { persistJsonArraysTransaction } from "./persistence";
import { runIntegrityAudit } from "./integrity-audit";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const person = { id: "commercial-owner", name: "Commercial owner", status: "Active", role: "Commercial review",
  responsibilities: "Review scope, pricing and execution evidence", authority: "Approve changes within recorded delegation" };
function job(id: string, accepted: string, completed: string, reviewed: string, cost: string) {
  const result = acceptLeadDelivery({ leads: [{ ...defaultLeadForm, id, leadName: id, status: "Won",
    serviceRequested: "Maintenance", dateCreated: accepted }], actions: [], people: [person], income: [], nowMs: Date.parse(accepted) }, {
    leadId: id, actionId: `delivery:${id}`, scope: "Customer accepted scope", acceptedAt: accepted,
    acceptedByPersonId: person.id, acceptanceEvidence: "Written customer scope acceptance",
    ownerPersonId: person.id, promisedBy: completed.slice(0, 10),
  });
  const source = { leads: [result.lead], actions: [{ ...result.action, status: "Completed" as const, completionDate: completed,
    completionEvidence: "Dated customer scope completion" }], people: [person], income: [{
    id: `income:${id}`, relatedLeadId: id, date: completed.slice(0, 10), description: "Earned scope", customerSource: id,
    amount: "1000", area: "Garden Maintenance", status: "Expected" as const, notes: "", dateCreated: completed,
    earnedDate: completed, earnedEvidence: "Completed scope revenue recognition", earnedReference: `earned:${id}`,
  }], expenses: [{
    id: `cost:${id}`, relatedLeadId: id, date: completed.slice(0, 10), description: "Job labour", supplier: "Labour source",
    amount: cost, category: "Labour", area: "Garden Maintenance", status: "Planned" as const, notes: "", dateCreated: completed,
    jobCostType: "Direct" as const, costReference: `cost-ref:${id}`, incurredDate: completed, incurredEvidence: "Dated timesheet and cost basis",
  }], nowMs: Date.parse(reviewed) };
  const lead = recordJobFinancialReview(source, id, { reviewedByPersonId: person.id, revenueComplete: true,
    directCostsComplete: true, overheadCostsComplete: false, evidence: "All earned revenue and direct cost categories reviewed; other direct categories genuinely zero" });
  return { ...source, leads: [lead] };
}
function input(): CommercialLearningInput {
  return { ...job("baseline", "2026-09-29T10:00:00Z", "2026-09-30T10:00:00Z", "2026-10-01T12:00:00Z", "300"),
    lessons: [], decisions: [], nowMs: Date.parse("2026-10-02T12:00:00Z") };
}
const diagnosisRequest = { cause: "Labour estimation" as const, attribution: "Supported contribution" as const,
  evidence: "Original scope and timesheets show access conditions required extra labour; labour cost source linked on the job.",
  expectedDirectCost: "200", estimateEvidence: "Original estimate sheet version 1, before acceptance; same scope",
  changeKind: "Operating" as const, ownerPersonId: person.id, recommendedChange: "Include access assessment before estimating labour" };
function diagnosed(changeKind: "Pricing" | "Operating" = "Operating"): CommercialLearningInput {
  const source = input();
  return { ...source, lessons: [createCommercialLesson(source, "lesson-1", "baseline", { ...diagnosisRequest, changeKind })] };
}
function implemented(source = diagnosed()): CommercialLearningInput {
  const action = createCommercialImplementation(source, "lesson-1", "implementation-1", person.id, "2026-10-03");
  return { ...source, actions: [...source.actions, { ...action, status: "Completed", completionDate: "2026-10-03T12:00:00Z",
    completionEvidence: "Access assessment incorporated into the estimating process and reviewed with estimator" }], nowMs: NOW };
}
function withSubsequent(source = implemented(), cost = "200"): CommercialLearningInput {
  const next = job("subsequent", "2026-10-04T12:00:00Z", "2026-10-05T12:00:00Z", "2026-10-06T12:00:00Z", cost);
  return { ...source, leads: [...source.leads, ...next.leads], actions: [...source.actions, ...next.actions],
    income: [...source.income, ...next.income], expenses: [...source.expenses, ...next.expenses], nowMs: NOW };
}
const evaluationRequest = { personId: person.id, leadId: "subsequent", comparabilityEvidence: "Same scope, scale and access conditions; no other process changes recorded",
  adoptionEvidence: "Estimator used the new access checklist and job records confirm it", evidence: "Comparable reviewed contribution margin increased from 70% to 80%; association only",
  outcome: "Improved" as const };
function evaluated(source = withSubsequent()): CommercialLearningInput {
  return { ...source, lessons: [evaluateCommercialChange(source, "lesson-1", evaluationRequest)] };
}
function approved(): CommercialLearningInput {
  const source = diagnosed("Pricing");
  const prepared = prepareCommercialDecision(source, "lesson-1", "decision-1");
  const input = { ...source, lessons: [prepared.lesson], decisions: [{ ...prepared.decision, decisionStatus: "Active" as const,
    status: "Active", decisionDate: "2026-10-02", reasoning: "Cost evidence supports reviewing the estimate method, not automatic uplift",
    evidenceConsidered: "Source job evidence, estimate and scope review", alternativesConsidered: "Improve scheduling instead" }] };
  return { ...input, lessons: [approveCommercialProposal(input, "lesson-1", { personId: person.id,
    authorityEvidence: "Recorded delegated authority for this service; applies only to matching scope after site access review",
    evidence: "Decision explicitly approved by the responsible commercial authority" })] };
}

describe("Commercial diagnosis and responsibility", () => {
  it("uses existing Lessons and preserves financial/quote truth without changing prices or inventing estimates", () => {
    const source = input();
    const before = JSON.stringify(source);
    const lesson = createCommercialLesson(source, "lesson-1", "baseline", diagnosisRequest);
    expect(JSON.stringify(source)).toBe(before);
    expect(lesson).toMatchObject({ targetType: "Convert to Lesson", ownerPersonId: person.id, status: "Change Required",
      commercialLearning: { diagnosis: { leadId: "baseline", cause: "Labour estimation", attribution: "Supported contribution" } } });
    expect(buildCommercialLearning({ ...source, lessons: [lesson] })[0]).toMatchObject({ diagnosisCurrent: true,
      actualDirectCost: 300, expectedDirectCost: 200, variance: 100, approvalCurrent: false, outcome: "Unknown" });
    const unknownEstimate = createCommercialLesson(source, "lesson-2", "baseline", { ...diagnosisRequest, expectedDirectCost: "", estimateEvidence: "" });
    expect(buildCommercialLearning({ ...source, lessons: [unknownEstimate] })[0]).toMatchObject({ expectedDirectCost: null, variance: null });
    expect(() => createCommercialLesson(source, "lesson-3", "baseline", { ...diagnosisRequest, estimateEvidence: "" })).toThrow("genuine recorded estimate");
  });
  it("does not diagnose unknown profitability as verified underperformance", () => {
    const source = input();
    source.leads = source.leads.map((lead) => ({ ...lead, jobFinancialReview: undefined }));
    expect(() => createCommercialLesson(source, "lesson-1", "baseline", diagnosisRequest)).toThrow("Review complete");
    expect(() => createCommercialLesson({ ...input(), nowMs: NaN }, "lesson-1", "baseline", diagnosisRequest)).toThrow("clock");
    expect(() => createCommercialLesson(input(), "lesson-1", "baseline", { ...diagnosisRequest, evidence: "" })).toThrow("evidence");
  });
  it("requires explicit attribution and current accountable People without treating hypothesis as causation", () => {
    const source = diagnosed();
    const hypothesis = createCommercialLesson(input(), "hypothesis", "baseline", { ...diagnosisRequest, attribution: "Hypothesis" });
    expect(buildCommercialLearning({ ...input(), lessons: [hypothesis] })[0].reasons.join(" ")).toContain("hypothesis");
    for (const people of [[], [person, person], [{ ...person, status: "Inactive" }], [{ ...person, authority: "" }]]) {
      expect(() => createCommercialLesson({ ...input(), people }, "lesson-1", "baseline", diagnosisRequest)).toThrow("Person");
      expect(buildCommercialLearning({ ...source, people })[0].diagnosisCurrent).toBe(false);
    }
  });
  it("creates ordinary owned Lesson implementation Actions and prevents duplicate active responsibility", () => {
    const source = diagnosed();
    const action = createCommercialImplementation(source, "lesson-1", "implementation-1", person.id, "2026-10-03");
    expect(action).toMatchObject({ implementsLessonId: "lesson-1", ownerPersonId: person.id, status: "Open", dueDate: "2026-10-03" });
    expect(() => createCommercialImplementation({ ...source, actions: [...source.actions, action] }, "lesson-1", "second-action",
      person.id, "2026-10-04")).toThrow("already active");
    expect(() => createCommercialImplementation(source, "lesson-1", "action-1", person.id, "2026-02-30")).toThrow("deadline");
  });
  it("cannot establish adoption or successful learning from completion or Implemented Lesson status", () => {
    const source = implemented();
    source.lessons = source.lessons.map((lesson) => ({ ...lesson, status: "Implemented" }));
    const view = buildCommercialLearning(source)[0];
    expect(view).toMatchObject({ implementationComplete: true, evaluationCurrent: false, outcome: "Unknown" });
    expect(view.reasons.join(" ")).toContain("does not establish successful");
    const signals = buildOrganisationalLearning({ actions: source.actions, lessons: source.lessons, projects: [], decisions: [],
      problems: [], systems: [], sops: [], commercialLearning: [view] });
    expect(signals.find((signal) => signal.sourceType === "Lesson")).toMatchObject({ outcomeState: "Missing evidence",
      executionState: "Completed execution", learningState: "Lesson available" });
  });
  it("retains original diagnosis attribution when corrective responsibility is reassigned", () => {
    const source = diagnosed();
    const delegate = { ...person, id: "delegate", name: "Delegated commercial lead" };
    const next = assignCommercialResponsibility({ ...source, people: [person, delegate] }, "lesson-1", delegate.id);
    expect(next).toMatchObject({ owner: delegate.name, ownerPersonId: delegate.id });
    expect(next.commercialLearning?.diagnosis.recordedByPersonId).toBe(person.id);
    expect(() => assignCommercialResponsibility(source, "lesson-1", "missing")).toThrow("Person");
  });
  it("does not claim implementation of an edited proposal or an Action with a different scope", () => {
    const source = implemented();
    const changedProposal = { ...source, lessons: source.lessons.map((lesson) => ({ ...lesson, recommendedChange: "Different change" })) };
    expect(buildCommercialLearning(changedProposal)[0].implementationComplete).toBe(false);
    const changedScope = { ...source, actions: source.actions.map((action) => action.implementsLessonId
      ? { ...action, description: "Different task" } : action) };
    expect(buildCommercialLearning(changedScope)[0].implementationComplete).toBe(false);
  });
});

describe("Human pricing approval boundaries", () => {
  it("prepares a linked Draft Decision without inventing judgment or approving a policy", () => {
    const source = diagnosed("Pricing");
    const prepared = prepareCommercialDecision(source, "lesson-1", "decision-1");
    expect(prepared.decision).toMatchObject({ targetType: "Convert to Decision", decisionStatus: "Draft", reasoning: "",
      alternativesConsidered: "", actualOutcome: "", outcomeRating: "" });
    expect(prepared.lesson.relatedDecision).toBe("decision-1");
    const next = { ...source, lessons: [prepared.lesson], decisions: [prepared.decision] };
    expect(buildCommercialLearning(next)[0].approvalCurrent).toBe(false);
    expect(() => approveCommercialProposal(next, "lesson-1", { personId: person.id, authorityEvidence: "Authority", evidence: "Approval" })).toThrow("non-draft");
    expect(() => prepareCommercialDecision(next, "lesson-1", "decision-2")).toThrow("already linked");
  });
  it("requires explicit authority evidence against the current non-draft Decision; status alone never approves pricing", () => {
    const source = approved();
    expect(buildCommercialLearning(source)[0].approvalCurrent).toBe(true);
    const noApproval = { ...source, lessons: source.lessons.map((lesson) => ({ ...lesson,
      commercialLearning: { ...lesson.commercialLearning!, approvals: [] } })) };
    expect(buildCommercialLearning(noApproval)[0].approvalCurrent).toBe(false);
    expect(() => approveCommercialProposal(noApproval, "lesson-1", { personId: person.id, authorityEvidence: "", evidence: "Approved" })).toThrow("authority");
    const reversed = { ...source, decisions: source.decisions.map((decision) => ({ ...decision, decisionStatus: "Reversed" as const })) };
    expect(buildCommercialLearning(reversed)[0].approvalCurrent).toBe(false);
    const changed = { ...source, decisions: source.decisions.map((decision) => ({ ...decision, reasoning: "Changed rationale" })) };
    expect(buildCommercialLearning(changed)[0].approvalCurrent).toBe(false);
    expect(source.lessons[0].commercialLearning?.approvals).toHaveLength(1);
  });
  it("invalidates approval and outcome after proposal edits, preserving protected evidence history on normal Lesson saves", () => {
    const source = approved();
    const edited = { ...source.lessons[0], recommendedChange: "Different pricing policy", commercialLearning: undefined };
    const saved = applyLessonEditorChanges(source.lessons[0], edited);
    expect(saved.commercialLearning).toEqual(source.lessons[0].commercialLearning);
    expect(buildCommercialLearning({ ...source, lessons: [saved] })[0].approvalCurrent).toBe(false);
    expect(normalizeLessonRecord(saved).commercialLearning).toEqual(saved.commercialLearning);
  });
  it("requires pricing approval before a comparable subsequent job, not retroactive approval", () => {
    const noApproval = withSubsequent(implemented(diagnosed("Pricing")));
    expect(() => evaluateCommercialChange(noApproval, "lesson-1", evaluationRequest)).toThrow("pricing");
    const source = withSubsequent(implemented(approved()));
    expect(buildCommercialLearning(evaluated(source))[0]).toMatchObject({ approvalCurrent: true, outcome: "Improved" });
    const late = { ...source, lessons: [approveCommercialProposal(source, "lesson-1", { personId: person.id,
      authorityEvidence: "Authority and scope", evidence: "Late approval" })] };
    expect(() => evaluateCommercialChange(late, "lesson-1", evaluationRequest)).toThrow("later comparable");
  });
});

describe("Comparable-job outcome evidence", () => {
  it("records a human-reviewed observed improvement, not automatic causation, and retains history", () => {
    const source = evaluated();
    const view = buildCommercialLearning(source)[0];
    expect(view).toMatchObject({ diagnosisCurrent: true, implementationComplete: true, evaluationCurrent: true, outcome: "Improved" });
    expect(view.baseline?.contributionMarginPct).toBe(70);
    expect(view.subsequent?.contributionMarginPct).toBe(80);
    expect(source.lessons[0].commercialLearning?.evaluations[0].evidence).toContain("association only");
    const signals = buildOrganisationalLearning({ actions: source.actions, lessons: source.lessons, decisions: source.decisions,
      projects: [], problems: [], systems: [], sops: [], commercialLearning: [view] });
    expect(signals.find((signal) => signal.sourceType === "Lesson")).toMatchObject({ outcomeState: "Worked" });
  });
  it("rejects missing adoption, self-comparison, mismatched service/pillar and unreconciled subsequent profitability", () => {
    const source = withSubsequent();
    expect(() => evaluateCommercialChange(source, "lesson-1", { ...evaluationRequest, adoptionEvidence: "" })).toThrow("adoption");
    expect(() => evaluateCommercialChange(source, "lesson-1", { ...evaluationRequest, leadId: "baseline" })).toThrow("comparable");
    for (const change of [{ serviceRequested: "Excavation" }, { relatedPillar: "Excavation" }, { jobFinancialReview: undefined }]) {
      const next = { ...source, leads: source.leads.map((lead) => lead.id === "subsequent" ? { ...lead, ...change } : lead) };
      expect(() => evaluateCommercialChange(next, "lesson-1", evaluationRequest)).toThrow("comparable");
    }
    const unsupported = { ...source, actions: source.actions.map((action) => action.implementsLessonId ? { ...action, completionEvidence: "" } : action) };
    expect(() => evaluateCommercialChange(unsupported, "lesson-1", evaluationRequest)).toThrow("implementation");
  });
  it("does not accept an improved claim when actual reviewed direct contribution margin is unchanged or worse", () => {
    for (const cost of ["300", "400"]) {
      const source = withSubsequent(implemented(), cost);
      expect(() => evaluateCommercialChange(source, "lesson-1", evaluationRequest)).toThrow("higher reviewed");
      const lesson = evaluateCommercialChange(source, "lesson-1", { ...evaluationRequest, outcome: "Not improved",
        evidence: "Reviewed results did not improve; reassess the hypothesis" });
      expect(buildCommercialLearning({ ...source, lessons: [lesson] })[0]).toMatchObject({ outcome: "Not improved", evaluationCurrent: true });
    }
  });
  it("makes outcome unknown after financial edits, source changes, implementation edits or reviewer readiness changes", () => {
    const source = evaluated();
    for (const next of [
      { ...source, expenses: source.expenses.map((expense) => ({ ...expense, amount: "201" })) },
      { ...source, income: source.income.filter((income) => income.relatedLeadId !== "baseline") },
      { ...source, actions: source.actions.map((action) => action.implementsLessonId ? { ...action, completionEvidence: "Different evidence" } : action) },
      { ...source, people: [{ ...person, status: "Inactive" }] },
    ]) expect(buildCommercialLearning(next)[0]).toMatchObject({ evaluationCurrent: false, outcome: "Unknown" });
    expect(source.lessons[0].commercialLearning?.evaluations).toHaveLength(1);
  });
  it("requires acceptance after actual implementation time, not simply the same calendar date", () => {
    const source = implemented();
    const earlier = job("earlier", "2026-10-03T11:00:00Z", "2026-10-05T12:00:00Z", "2026-10-06T12:00:00Z", "200");
    const combined = { ...source, leads: [...source.leads, ...earlier.leads], income: [...source.income, ...earlier.income],
      expenses: [...source.expenses, ...earlier.expenses], actions: [...source.actions, ...earlier.actions] };
    expect(() => evaluateCommercialChange(combined, "lesson-1", { ...evaluationRequest, leadId: "earlier" })).toThrow("later comparable");
  });
  it("preserves successive outcome reviews and prevents premature retrospective timestamps from establishing success", () => {
    const source = evaluated();
    const next = evaluateCommercialChange(source, "lesson-1", { ...evaluationRequest, outcome: "Mixed", evidence: "Margin improved but evidence of consistent adoption is mixed" });
    expect(next.commercialLearning?.evaluations).toHaveLength(2);
    expect(buildCommercialLearning({ ...source, lessons: [next] })[0].outcome).toBe("Mixed");
    const premature = { ...source.lessons[0], commercialLearning: { ...source.lessons[0].commercialLearning!,
      evaluations: source.lessons[0].commercialLearning!.evaluations.map((review) => ({ ...review, recordedAt: "2026-10-05T12:00:00Z" })) } };
    expect(buildCommercialLearning({ ...source, lessons: [premature] })[0]).toMatchObject({ evaluationCurrent: false, outcome: "Unknown" });
  });
  it("requires measured success and linked operating records for institutionalisation without overriding Icarus safeguards", () => {
    const source = evaluated();
    const views = buildCommercialLearning(source);
    const systems = [{ id: "system-1", relatedLesson: "lesson-1", status: "Active" }];
    expect(commercialLearningValidity(undefined, views, source.lessons, []).get("lesson-1")).toEqual({ validated: true, institutionalised: false });
    expect(commercialLearningValidity(undefined, views, source.lessons, systems).get("lesson-1")).toEqual({ validated: true, institutionalised: true });
    const existing = new Map([["lesson-1", { validated: false, institutionalised: false }]]);
    expect(commercialLearningValidity(existing, views, source.lessons, systems).get("lesson-1")?.validated).toBe(false);
    expect(commercialLearningValidity(undefined, buildCommercialLearning(implemented()), source.lessons, systems).get("lesson-1")?.validated).toBe(false);
    expect(existing.get("lesson-1")).toEqual({ validated: false, institutionalised: false });
  });
});

describe("Commercial attention, integrity and persistence", () => {
  const command = (source?: CommercialLearningInput) => buildCommandAttention({ problems: [], actions: [], outreach: [], projects: [],
    decisions: [], opportunities: [], lessons: [], systems: [], sops: [], handoffs: [], procurementQueue: [], nowMs: NOW,
    commercialLearning: source });
  it("surfaces unresolved commercial weakness on the existing Lesson and leaves legacy behavior unchanged", () => {
    expect(command().items).toEqual([]);
    expect(command(diagnosed()).items).toEqual(expect.arrayContaining([expect.objectContaining({
      objectType: "Lesson", id: "lesson-1", navigationMode: "record-handler",
    })]));
    expect(command(evaluated()).items).toEqual([]);
    const archived = { ...diagnosed(), lessons: diagnosed().lessons.map((lesson) => ({ ...lesson, status: "Archived" as const })) };
    expect(command(archived).items).toEqual([]);
  });
  it("does not weaken urgent Action priority when commercial attention is added", () => {
    const action = normalizeActionRecord({ id: "urgent", sourceCaptureId: "", targetType: "Convert to Action", title: "Urgent",
      originalRawNote: "", createdAt: "2026-10-01T12:00:00Z", relatedArea: "Garden Maintenance", importance: "High",
      status: "Blocked", priority: "Critical", dueDate: "2026-10-01" });
    const base = { problems: [], actions: [action], outreach: [], projects: [], decisions: [], opportunities: [],
      lessons: [], systems: [], sops: [], handoffs: [], procurementQueue: [], nowMs: NOW };
    expect(buildCommandAttention({ ...base, commercialLearning: diagnosed() }).items.find((item) => item.id === "urgent"))
      .toEqual(buildCommandAttention(base).items[0]);
  });
  it("flags stale evidence and broken source-job references through integrity auditing", () => {
    const source = evaluated();
    const report = runIntegrityAudit({ ...source, leads: source.leads.filter((lead) => lead.id !== "baseline"),
      actions: [...source.actions], decisions: [...source.decisions], lessons: [...source.lessons],
      people: [...source.people], income: [...source.income], expenses: [...source.expenses],
      captures: [], conversions: [...source.lessons], projects: [], problems: [], opportunities: [], systems: [], sops: [],
      commitments: [], outreach: [], handoffs: [], strategicObjectives: [], strategicReviews: [], storage: {},
      sharedAreaOptions: ["Garden Maintenance"], commitmentTypeOptions: [], commitmentStatusOptions: [],
      nowIso: () => new Date(NOW).toISOString() });
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ recordId: "lesson-1",
      category: "Commercial learning evidence", openObjectType: "Lesson" })]));
  });
  it("preserves legacy absence and all evidence through version-one backup round trips; rejects malformed nested data", () => {
    const source = evaluated();
    const backup = (records: readonly unknown[]) => ({ format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date(NOW).toISOString(),
      storage: { [CONVERSION_STORAGE_KEY]: JSON.stringify(records) } });
    const result = validateEmpireOsBackup(backup(source.lessons));
    expect(JSON.parse(result.storage[CONVERSION_STORAGE_KEY]!)).toEqual(source.lessons);
    expect(() => assertCommercialLearning(undefined)).not.toThrow();
    expect(() => validateEmpireOsBackup(backup([{ id: "legacy", targetType: "Convert to Lesson" }]))).not.toThrow();
    for (const learning of [null, {}, { ...source.lessons[0].commercialLearning, evaluations: [{}] },
      { ...source.lessons[0].commercialLearning, approvals: [{}] }]) {
      expect(() => validateEmpireOsBackup(backup([{ ...source.lessons[0], commercialLearning: learning }]))).toThrow("malformed");
    }
    expect(() => validateEmpireOsBackup(backup([{ ...source.lessons[0], targetType: "Convert to Decision" }]))).toThrow("Lesson");
    expect(() => validateEmpireOsBackup(backup([{ ...source.actions.find((action) => action.implementsLessonId),
      commercialImplementation: { recordedAt: 1, proposalSnapshot: "" } }]))).toThrow("implementation");
  });
  it("rolls back failed commercial record writes without losing prior Lesson history", () => {
    const source = evaluated();
    const previous = JSON.stringify(source.lessons);
    const values = new Map([[CONVERSION_STORAGE_KEY, previous]]);
    let fail = true;
    const storage = { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); },
      setItem: (key: string, value: string) => { values.set(key, value); if (fail) { fail = false; throw new Error("Write rejected"); } } };
    expect(() => persistJsonArraysTransaction(storage, [{ key: CONVERSION_STORAGE_KEY, records: diagnosed().lessons }])).toThrow("Previous storage restored");
    expect(values.get(CONVERSION_STORAGE_KEY)).toBe(previous);
  });
});
