import { describe, expect, it } from "vitest";
import { normalizeActionRecord, type DecisionRecord } from "./capture-conversions";
import { recordWorkloadAssessment, recordAvailabilityReview } from "./delivery-capacity";
import { approveCapacityResolution, assertCapacityResolutionRecord, buildCapacityResolutions, createCapacityResolution,
  evaluateCapacityResolution, refreshCapacityBaseline, reviseCapacityResolution, type CapacityResolutionInput, type CapacityAlternative } from "./capacity-resolution";
import { buildCapitalAllocation } from "./capital-allocation";
import { buildCommandAttention } from "./command-attention";
import { buildOrganisationalLearning } from "./organisational-learning";
import { BACKUP_FORMAT, BACKUP_VERSION, CONVERSION_STORAGE_KEY, validateEmpireOsBackup } from "./backup";
import { runIntegrityAudit } from "./integrity-audit";
import type { CommitmentRecord } from "./finance";
import { persistJsonArraysTransaction } from "./persistence";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const operator = { id: "operator", name: "Operator", status: "Active", role: "Delivery",
  responsibilities: "Deliver recorded obligations", authority: "Recorded delegated delivery authority", pillar: "Garden Maintenance" };
const implementer = { ...operator, id: "implementer", name: "Implementation owner", role: "Operations improvement" };
const action = (id: string, owner = operator, relatedDecision = "") => ({
  ...normalizeActionRecord({ id, sourceCaptureId: "", targetType: "Convert to Action", title: id, originalRawNote: "Explicit implementation scope",
    relatedArea: "Garden Maintenance", importance: "Low", status: "Open", owner: owner.name, relatedDecision,
    createdAt: "2026-10-08T11:00:00Z", dueDate: "2026-10-12" }), ownerPersonId: owner.id,
});
const workload = { personId: operator.id, recordedByPersonId: operator.id, windowStart: "2026-10-09", windowEnd: "2026-10-12",
  remainingHours: "10", estimateEvidence: "Attributed remaining work estimate for the agreed scope",
  readinessConfirmed: true, readinessEvidence: "Access, resources, skills and commercial/quality assumptions reviewed",
  dependencyActionIds: [], validUntil: "2026-10-12" };
const availability = { recordedByPersonId: operator.id, windowStart: "2026-10-09", windowEnd: "2026-10-12", availableHours: "5",
  evidence: "Confirmed availability after other duties", workloadCoverageComplete: true,
  coverageEvidence: "All competing obligations reviewed; routine duties deducted", validUntil: "2026-10-12" };
function sized(source: CapacityResolutionInput, remainingHours = "10"): CapacityResolutionInput {
  const record = recordWorkloadAssessment(source, { objectType: "Action", id: "work" }, { ...workload, remainingHours });
  return { ...source, actions: source.actions.map((entry) => entry.id === "work" ? { ...entry, workloadAssessments: record.workloadAssessments } : entry) };
}
function reviewed(source: CapacityResolutionInput, availableHours = "5", complete = true): CapacityResolutionInput {
  const record = recordAvailabilityReview(source, operator.id, { ...availability, availableHours, workloadCoverageComplete: complete });
  return { ...source, people: source.people.map((entry) => entry.id === operator.id ? { ...entry, availabilityReviews: record.availabilityReviews } : entry) };
}
function input(): CapacityResolutionInput {
  return reviewed(sized({ leads: [], actions: [action("work")], people: [operator, implementer], projects: [], problems: [],
    decisions: [], income: [], commitments: [], nowMs: NOW }));
}
function replace(source: CapacityResolutionInput, decision: DecisionRecord): CapacityResolutionInput {
  return { ...source, decisions: source.decisions.map((entry) => entry.id === decision.id ? decision : entry) };
}
function proposed(): CapacityResolutionInput {
  let source = input();
  const decision = createCapacityResolution(source, "resolution", operator.id, operator.id, "Five evidenced hours of shortage against committed scope");
  source = { ...source, decisions: [{ ...decision, decisionStatus: "Active", status: "Active", decisionDate: "2026-10-08",
    decisionStatement: "Trial a reviewed operational improvement within delegated scope", reasoning: "Recorded capacity shortfall requires an intervention",
    evidenceConsidered: "Remaining-work and confirmed availability reviews", reviewDate: "2026-10-12" }],
    actions: [...source.actions, action("milestone", implementer, decision.id)] };
  const alternatives = source.decisions[0].capacityResolution!.alternatives.map((option): CapacityAlternative => ({
    ...option, rationale: "Alternative reviewed; current evidence is insufficient, so feasibility remains unresolved",
    ...(option.kind === "Process improvement" ? { feasibility: "Feasible", rationale: "Scoped process change supported by trial evidence",
      cost: "0", costEvidence: "No incremental spending; implementation labour covered by recorded duties",
      availableHours: "5", availabilityEvidence: "Implementation owner confirms five hours in the original window",
      expectedReliefHours: "4", impactEvidence: "Trial suggests four hours reduction, subject to observed scope and quality",
      dependencyEvidence: "No additional prerequisites for this trial", authorityEvidence: "Delegated process-change authority; no customer promise or reassignment",
      validUntil: "2026-10-12" } : {}),
  }));
  return replace(source, reviseCapacityResolution(source, "resolution", alternatives, "Process improvement", ["milestone"]));
}
const approval = { personId: operator.id, authorityEvidence: "Recorded authority covers this exact cost, scope and operational commitments",
  selectionRationale: "Supported process trial preferable to currently unverified alternatives",
  evidence: "Explicit responsible-person approval of the saved response and milestones", capitalEvidence: "" };
function approved(source = proposed()): CapacityResolutionInput {
  return replace(source, approveCapacityResolution(source, "resolution", approval));
}
function implemented(source = approved()): CapacityResolutionInput {
  return { ...source, nowMs: NOW + 10 * 60_000, actions: source.actions.map((entry) => entry.id === "milestone" ? {
    ...entry, status: "Completed", completionDate: new Date(NOW + 10 * 60_000).toISOString(),
    completionEvidence: "Trial process adopted and evidence recorded" } : entry) };
}
function fresh(source = implemented(), hours = "6"): CapacityResolutionInput {
  source = sized({ ...source, nowMs: NOW + 11 * 60_000 }, hours);
  return reviewed({ ...source, nowMs: NOW + 12 * 60_000 });
}
const evaluation = { personId: operator.id, validUntil: "2026-10-12", outcome: "Improved" as const,
  evidence: "Fresh remaining effort and availability show shortage fell from five to one hour",
  comparabilityEvidence: "Same window and scope; no work abandoned or displaced; customer/quality standards maintained",
  attributionEvidence: "Trial adopted on this scope; observed association is not proof of sole causation" };
function evaluated(source = fresh()): CapacityResolutionInput {
  source = { ...source, nowMs: NOW + 13 * 60_000 };
  return replace(source, evaluateCapacityResolution(source, "resolution", evaluation));
}
function view(source: CapacityResolutionInput) {
  return buildCapacityResolutions(source)[0];
}
function finance(certainty: CommitmentRecord["certainty"] = "Committed"): CommitmentRecord {
  return { id: "finance", commitmentName: "Scoped intervention cost", amount: "100", type: "Supplier", status: "Upcoming", certainty,
    dueDate: "2026-10-12", relatedPillar: "Garden Maintenance", notes: "Full evidence cost horizon",
    dateCreated: "2026-10-08T10:00:00Z", approvalStatus: "Approved", approvedRejectedBy: operator.name, approvalDate: "2026-10-08",
    approvalRationale: "Explicit existing procurement approval", supplier: "Evidence source", quoteReference: "Quote reference", quoteExpiryDate: "2026-10-12" };
}
function costed(certainty: CommitmentRecord["certainty"] = "Committed", cash = 100): CapacityResolutionInput {
  let source = proposed();
  const record = finance(certainty);
  source = { ...source, commitments: [record] };
  const decision = source.decisions[0];
  const alternatives = decision.capacityResolution!.alternatives.map((option) => option.kind === "Process improvement"
    ? { ...option, cost: "100", commitmentId: record.id, costEvidence: "Full intervention cost supported by approved Finance quote" } : option);
  source = replace(source, reviseCapacityResolution(source, decision.id, alternatives, "Process improvement", ["milestone"]));
  return { ...source, capital: buildCapitalAllocation({ opportunities: [], leads: [], commitments: [{ commitment: record, amount: 100,
    originalBudget: null, targetPrice: null, actualPurchasePrice: null, dueDateValid: true, quoteState: "Current" }],
    currentCashAmount: cash, cashAmountsValid: true, reservedTaxAmount: 0, safetyBufferAmount: 0,
    cashSnapshotFreshness: { label: "Current", tone: "clear" }, cashSnapshotAgeDays: 0, nowMs: NOW }) };
}

describe("Existing Decisions close capacity constraints accountably", () => {
  it("captures six unknown alternatives and an attributed immutable source baseline without inventing business evidence", () => {
    const source = input();
    const before = JSON.stringify(source);
    const decision = createCapacityResolution(source, "resolution", operator.id, operator.id, "Evidenced shortage");
    expect(decision).toMatchObject({ targetType: "Convert to Decision", decisionStatus: "Draft" });
    expect(decision.capacityResolution!.baseline.shortfallHours).toBe(5);
    expect(decision.capacityResolution!.alternatives).toHaveLength(6);
    expect(decision.capacityResolution!.alternatives.every((option) => option.feasibility === "Unknown" && option.cost === "")).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("requires an existing committed constraint, unique ready People and explicit evidence", () => {
    expect(() => createCapacityResolution(input(), "resolution", operator.id, operator.id, "")).toThrow("attributable");
    expect(() => createCapacityResolution({ ...input(), people: [operator, operator] }, "resolution", operator.id, operator.id, "Evidence")).toThrow();
    expect(() => createCapacityResolution({ ...input(), actions: [], people: [operator] }, "resolution", operator.id, operator.id, "Evidence")).toThrow();
    expect(() => createCapacityResolution(input(), "work", operator.id, operator.id, "Evidence")).toThrow("identity");
  });
  it("records a comparison without changing existing Actions, People, Finance, delivery or Projects", () => {
    const source = proposed();
    expect(source.decisions[0].capacityResolution!.selectedKind).toBe("Process improvement");
    expect(source.actions.find((entry) => entry.id === "milestone")?.status).toBe("Open");
    expect(source.commitments).toEqual([]);
    expect(view(source)).toMatchObject({ approvalCurrent: false, implementationComplete: false, outcome: "Unknown" });
  });
  it("permits unresolved alternatives with explicit rationale but not unknown selected cost/capacity/impact", () => {
    const source = proposed();
    for (const changes of [{ cost: "" }, { costEvidence: "" }, { availableHours: "" }, { availabilityEvidence: "" },
      { expectedReliefHours: "" }, { impactEvidence: "" }, { dependencyEvidence: "" }, { authorityEvidence: "" }, { validUntil: "2026-10-07" }]) {
      const decision = { ...source.decisions[0], capacityResolution: { ...source.decisions[0].capacityResolution!,
        alternatives: source.decisions[0].capacityResolution!.alternatives.map((option) => option.kind === "Process improvement" ? { ...option, ...changes } : option) } };
      expect(() => approveCapacityResolution(replace(source, decision), decision.id, approval)).toThrow("Approval requires");
    }
    const unknown = { ...source.decisions[0], capacityResolution: { ...source.decisions[0].capacityResolution!,
      alternatives: source.decisions[0].capacityResolution!.alternatives.map((option) => ({ ...option, rationale: "" })) } };
    expect(() => approveCapacityResolution(replace(source, unknown), unknown.id, approval)).toThrow("comparison rationale");
  });
  it("requires explicit active dated authority, evidence, review timing and owned scoped milestones", () => {
    const source = proposed();
    for (const changes of [{ personId: "missing" }, { authorityEvidence: "" }, { evidence: "" }, { selectionRationale: "" }]) {
      expect(() => approveCapacityResolution(source, "resolution", { ...approval, ...changes })).toThrow();
    }
    expect(() => approveCapacityResolution(replace(source, { ...source.decisions[0], decisionStatus: "Draft" }), "resolution", approval)).toThrow();
    expect(() => approveCapacityResolution(replace(source, { ...source.decisions[0], reviewDate: "" }), "resolution", approval)).toThrow();
    expect(() => approveCapacityResolution({ ...source, actions: source.actions.map((entry) => entry.id === "milestone" ? { ...entry, ownerPersonId: undefined } : entry) },
      "resolution", approval)).toThrow("owned");
    expect(view(approved()).approvalCurrent).toBe(true);
  });
  it("binds approval to precise proposal, milestone ownership/scope/deadline and approving Person governance", () => {
    const source = approved();
    expect(view(replace(source, { ...source.decisions[0], reasoning: "Changed reasoning" })).approvalCurrent).toBe(false);
    expect(view({ ...source, actions: source.actions.map((entry) => entry.id === "milestone" ? { ...entry, dueDate: "2026-10-13" } : entry) }).approvalCurrent).toBe(false);
    expect(view({ ...source, people: source.people.map((entry) => entry.id === operator.id ? { ...entry, authority: "Changed authority" } : entry) }).approvalCurrent).toBe(false);
    expect(view({ ...source, nowMs: Date.parse("2026-10-13T12:00:00Z") }).approvalCurrent).toBe(false);
    expect(source.decisions[0].capacityResolution!.approvals).toHaveLength(1);
  });
  it("requires positive costs to use approved existing Finance and current affordable capital, without double reservation", () => {
    const source = costed();
    expect(source.capital!.uncommittedDeployableCash).toBe(0);
    expect(() => approveCapacityResolution(source, "resolution", { ...approval, capitalEvidence: "Commitment already reserved; protected cash and full horizon reviewed" })).not.toThrow();
    expect(() => approveCapacityResolution(source, "resolution", approval)).toThrow("capital allocation");
    expect(() => approveCapacityResolution({ ...source, capital: undefined }, "resolution", { ...approval, capitalEvidence: "Human note cannot replace capital data" })).toThrow();
    expect(() => approveCapacityResolution(costed("Planned", 50), "resolution", { ...approval, capitalEvidence: "Unreserved cost" })).toThrow("exceeds");
    expect(() => approveCapacityResolution(costed("Committed", 50), "resolution", { ...approval, capitalEvidence: "Shortfall" })).toThrow("shortfall");
  });
  it("does not bypass rejected/pending/expired/mismatched Finance evidence", () => {
    const source = costed();
    for (const changes of [{ approvalStatus: "Rejected" as const }, { pendingValidationReason: "Awaiting validation" },
      { quoteExpiryDate: "2026-10-07" }, { amount: "101" }, { approvedRejectedBy: "" }, { approvalRationale: "" }]) {
      expect(() => approveCapacityResolution({ ...source, commitments: [{ ...source.commitments[0], ...changes }] },
        "resolution", { ...approval, capitalEvidence: "Capital reviewed" })).toThrow();
    }
    const approvedSource = sourceWithCapitalApproval(source);
    expect(view({ ...approvedSource, commitments: [{ ...approvedSource.commitments[0], amount: "101" }] }).approvalCurrent).toBe(false);
  });
  it("requires existing non-conflicting milestone/dependency references and preserves approval/outcome history on revision", () => {
    const source = approved();
    const decision = source.decisions[0];
    expect(() => reviseCapacityResolution(source, decision.id, decision.capacityResolution!.alternatives, "Process improvement", ["missing"])).toThrow("Milestones");
    const options = decision.capacityResolution!.alternatives.map((option) => option.kind === "Process improvement" ? { ...option, dependencyActionIds: ["milestone"] } : option);
    expect(() => reviseCapacityResolution(source, decision.id, options, "Process improvement", ["milestone"])).toThrow("distinct");
    const revised = reviseCapacityResolution(source, decision.id, decision.capacityResolution!.alternatives, "Equipment", ["milestone"]);
    expect(revised.capacityResolution!.approvals).toEqual(decision.capacityResolution!.approvals);
    expect(view(replace(source, revised)).approvalCurrent).toBe(false);
    const pending = { ...source, actions: [...source.actions, { ...action("prerequisite", implementer),
      workloadAssessments: source.actions[0].workloadAssessments!.map((assessment) => ({ ...assessment, dependencyActionIds: ["milestone"] })) }] };
    const transitive = decision.capacityResolution!.alternatives.map((option) => option.kind === "Process improvement"
      ? { ...option, dependencyActionIds: ["prerequisite"] } : option);
    expect(() => reviseCapacityResolution(pending, decision.id, transitive, "Process improvement", ["milestone"])).toThrow("prerequisite chain");
  });
  it("retains explicit pre-approval baseline re-reviews but forbids changing an approved original diagnosis", () => {
    let source = proposed();
    source = { ...source, actions: source.actions.map((entry) => entry.id === "milestone" ? { ...entry, owner: operator.name, ownerPersonId: operator.id } : entry) };
    expect(view(source).baselineCurrent).toBe(false);
    const refreshed = refreshCapacityBaseline(source, "resolution", operator.id, "Mitigation Action itself adds workload; coverage now unknown");
    expect(refreshed.capacityResolution!.baselineHistory).toHaveLength(1);
    expect(refreshed.capacityResolution!.baseline.shortfallHours).toBeNull();
    expect(view(replace(source, refreshed)).baselineCurrent).toBe(true);
    expect(() => refreshCapacityBaseline(approved(), "resolution", operator.id, "Overwrite target")).toThrow("cannot be rewritten");
  });
});

function sourceWithCapitalApproval(source: CapacityResolutionInput): CapacityResolutionInput {
  return replace(source, approveCapacityResolution(source, "resolution", { ...approval, capitalEvidence: "Existing commitment reserved; cash reviewed" }));
}

describe("Fresh evidence, not completion-shaped success", () => {
  it("does not equate milestone completion to capacity improvement", () => {
    const source = implemented();
    expect(view(source)).toMatchObject({ approvalCurrent: true, implementationComplete: true, outcomeCurrent: false, outcome: "Unknown" });
    expect(() => evaluateCapacityResolution(source, "resolution", evaluation)).toThrow("fresh post-implementation");
    expect(() => evaluateCapacityResolution(proposed(), "resolution", evaluation)).toThrow("approved");
  });
  it("requires post-approval completion evidence and outstanding prerequisites remain unresolved", () => {
    const source = implemented();
    expect(view({ ...source, actions: source.actions.map((entry) => entry.id === "milestone" ? { ...entry, completionEvidence: "" } : entry) }).implementationComplete).toBe(false);
    expect(view({ ...source, actions: source.actions.map((entry) => entry.id === "milestone" ? { ...entry, completionDate: "2026-10-08T11:00:00Z" } : entry) }).implementationComplete).toBe(false);
    let pending = proposed();
    pending = { ...pending, actions: [...pending.actions, action("prerequisite", implementer)] };
    const decision = pending.decisions[0];
    pending = replace(pending, reviseCapacityResolution(pending, decision.id, decision.capacityResolution!.alternatives.map((option) =>
      option.kind === "Process improvement" ? { ...option, dependencyActionIds: ["prerequisite"] } : option), "Process improvement", ["milestone"]));
    expect(view(implemented(approved(pending)))).toMatchObject({ approvalCurrent: true, implementationComplete: false });
  });
  it("verifies strictly reduced covered shortfall on fresh comparable original-window evidence", () => {
    const source = evaluated();
    expect(view(source)).toMatchObject({ baselineShortfall: 5, currentShortfall: 1, outcomeCurrent: true, outcome: "Improved" });
    expect(source.actions.find((entry) => entry.id === "work")!.status).toBe("Open");
    expect(source.decisions[0].capacityResolution!.evaluations).toHaveLength(1);
    expect(() => evaluateCapacityResolution(fresh(implemented(), "10"), "resolution", evaluation)).toThrow("strictly lower");
    expect(() => evaluateCapacityResolution(fresh(), "resolution", { ...evaluation, outcome: "Not improved" })).toThrow("did not reduce");
  });
  it("preserves unknown and ineffective outcomes, never inventing a successful baseline", () => {
    const unchanged = fresh(implemented(), "10");
    const decision = evaluateCapacityResolution(unchanged, "resolution", { ...evaluation, outcome: "Not improved" });
    expect(view(replace(unchanged, decision)).outcome).toBe("Not improved");
    const source = implemented();
    expect(evaluateCapacityResolution(source, "resolution", { ...evaluation, outcome: "Unknown" }).capacityResolution!.evaluations[0].outcome).toBe("Unknown");
    const unknown = reviewed(input(), "5", false);
    const baseline = createCapacityResolution(unknown, "unknown", operator.id, operator.id, "Coverage unknown; investigate");
    expect(baseline.capacityResolution!.baseline.shortfallHours).toBeNull();
  });
  it("stales outcomes on changed capacity/execution, expired windows or reversed approval", () => {
    const source = evaluated();
    expect(view(sized(source, "7")).outcome).toBe("Unknown");
    expect(view({ ...source, actions: source.actions.map((entry) => entry.id === "milestone" ? { ...entry, completionEvidence: "Changed completion evidence" } : entry) }).outcome).toBe("Unknown");
    expect(view({ ...source, nowMs: Date.parse("2026-10-13T12:00:00Z") }).outcome).toBe("Unknown");
    expect(view(replace(source, { ...source.decisions[0], decisionStatus: "Reversed" })).outcome).toBe("Unknown");
    const current = fresh();
    const changedReview = recordAvailabilityReview(current, operator.id, { ...availability, windowEnd: "2026-10-13", validUntil: "2026-10-13" });
    const differentWindow = { ...current, people: current.people.map((person) => person.id === operator.id
      ? { ...person, availabilityReviews: changedReview.availabilityReviews } : person) };
    expect(() => evaluateCapacityResolution(differentWindow, "resolution", evaluation)).toThrow("original window");
  });
  it("does not verify relief by silently deleting, cancelling, postponing or overloading another Person", () => {
    const source = fresh();
    const removed = reviewed({ ...source, actions: source.actions.filter((action) => action.id !== "work") });
    expect(() => evaluateCapacityResolution(removed, "resolution", evaluation)).toThrow("Original obligation");
    const cancelled = reviewed({ ...source, actions: source.actions.map((action) => action.id === "work"
      ? { ...action, status: "Cancelled" as const } : action) });
    expect(() => evaluateCapacityResolution(cancelled, "resolution", evaluation)).toThrow("cancelled");
    const record = recordWorkloadAssessment(source, { objectType: "Action", id: "work" },
      { ...workload, remainingHours: "6", windowStart: "2026-10-13", windowEnd: "2026-10-14", validUntil: "2026-10-14" });
    const postponed = reviewed({ ...source, actions: source.actions.map((action) => action.id === "work"
      ? { ...action, workloadAssessments: record.workloadAssessments } : action) });
    expect(() => evaluateCapacityResolution(postponed, "resolution", evaluation)).toThrow();
    const delegated = reviewed({ ...source, actions: source.actions.map((action) => action.id === "work"
      ? { ...action, owner: implementer.name, ownerPersonId: implementer.id } : action) });
    expect(() => evaluateCapacityResolution(delegated, "resolution", evaluation)).toThrow("delegated without");
  });
});

describe("Capacity resolution integration and persistence", () => {
  const command = (source?: CapacityResolutionInput) => buildCommandAttention({ problems: [], actions: [], outreach: [], projects: [],
    decisions: [], opportunities: [], lessons: [], systems: [], sops: [], handoffs: [], procurementQueue: [], capacityResolution: source, nowMs: source?.nowMs ?? NOW });
  it("surfaces unresolved/ineffective Decisions and keeps successful current outcomes distinct", () => {
    expect(command().items).toEqual([]);
    expect(command(proposed()).items).toEqual(expect.arrayContaining([expect.objectContaining({ objectType: "Decision", id: "resolution" })]));
    expect(command(evaluated()).items).toEqual([]);
    const source = fresh(implemented(), "10");
    expect(command(replace(source, evaluateCapacityResolution(source, "resolution", { ...evaluation, outcome: "Not improved" }))).items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: "resolution", attentionRank: 2 })]));
  });
  it("preserves more urgent existing Decision attention when capacity resolution enriches its reasons", () => {
    const source = proposed();
    const decisions = source.decisions.map((decision) => ({ ...decision, reviewDate: "2026-10-01", decisionStatus: "Under Review" as const }));
    const base = { problems: [], actions: [], outreach: [], projects: [], decisions, opportunities: [], lessons: [], systems: [], sops: [],
      handoffs: [], procurementQueue: [], nowMs: NOW };
    const before = buildCommandAttention(base).items.find((item) => item.id === "resolution")!;
    const after = buildCommandAttention({ ...base, capacityResolution: { ...source, decisions } }).items.find((item) => item.id === "resolution")!;
    expect(after.attentionRank).toBeLessThanOrEqual(before.attentionRank);
    expect(after.reasons).toEqual(expect.arrayContaining(before.reasons));
  });
  it("prevents manual Decision outcome text from bypassing evidence-aware organisational learning", () => {
    const source = evaluated();
    const decisions = source.decisions.map((decision) => ({ ...decision, actualOutcome: "Worked perfectly", outcomeRating: "Worked" }));
    const input = { actions: [], projects: [], decisions, lessons: [], problems: [], systems: [], sops: [] };
    expect(buildOrganisationalLearning(input)[0].outcomeState).toBe("Unknown");
    expect(buildOrganisationalLearning({ ...input, capacityResolutions: buildCapacityResolutions(source) })[0].outcomeState).toBe("Worked");
    expect(buildOrganisationalLearning({ ...input, capacityResolutions: buildCapacityResolutions(sized(source, "8")) })[0].outcomeState).toBe("Unknown");
  });
  it("preserves version-one backup compatibility and rejects malformed/misplaced history", () => {
    const source = evaluated();
    const backup = (records: readonly unknown[]) => ({ format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date(NOW).toISOString(),
      storage: { [CONVERSION_STORAGE_KEY]: JSON.stringify(records) } });
    expect(JSON.parse(validateEmpireOsBackup(backup(source.decisions)).storage[CONVERSION_STORAGE_KEY]!)).toEqual(source.decisions);
    expect(() => assertCapacityResolutionRecord({ id: "legacy", targetType: "Convert to Decision" })).not.toThrow();
    for (const capacityResolution of [null, {}, { ...source.decisions[0].capacityResolution, approvals: [{}] },
      { ...source.decisions[0].capacityResolution, baselineHistory: [{}] }, { ...source.decisions[0].capacityResolution, alternatives: [] }]) {
      expect(() => validateEmpireOsBackup(backup([{ ...source.decisions[0], capacityResolution }]))).toThrow("malformed");
    }
    expect(() => validateEmpireOsBackup(backup([{ ...source.decisions[0], targetType: "Convert to Action" }]))).toThrow("malformed");
  });
  it("audits stale scope and broken Person, milestone and Finance references on the existing Decision", () => {
    const source = proposed();
    const decision = { ...source.decisions[0], capacityResolution: { ...source.decisions[0].capacityResolution!,
      milestoneActionIds: ["missing"], baseline: { ...source.decisions[0].capacityResolution!.baseline, recordedByPersonId: "missing-person" } } };
    const report = runIntegrityAudit({ captures: [], conversions: [decision], actions: [...source.actions], projects: [], problems: [],
      decisions: [decision], opportunities: [], lessons: [], systems: [], sops: [], people: [...source.people], leads: [], income: [], expenses: [],
      commitments: [], outreach: [], handoffs: [], strategicObjectives: [], strategicReviews: [], storage: {},
      sharedAreaOptions: ["Garden Maintenance"], commitmentTypeOptions: [], commitmentStatusOptions: [], nowIso: () => new Date(NOW).toISOString() });
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ recordId: decision.id, category: "Capacity resolution evidence" }),
      expect.objectContaining({ recordId: decision.id, reason: expect.stringContaining("missing-person") }),
      expect.objectContaining({ recordId: decision.id, reason: expect.stringContaining("missing") })]));
  });
  it("retains stored evidence on failed verified persistence instead of success-shaped saving", () => {
    let value = "previous stored evidence";
    let first = true;
    const storage = { getItem: () => value, removeItem: () => { value = ""; }, setItem: (_key: string, next: string) => {
      if (first) { first = false; throw new Error("Write failed"); } value = next;
    } };
    expect(() => persistJsonArraysTransaction(storage, [{ key: CONVERSION_STORAGE_KEY, records: evaluated().decisions }])).toThrow();
    expect(value).toBe("previous stored evidence");
  });
});
