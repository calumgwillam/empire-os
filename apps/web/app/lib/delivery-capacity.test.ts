import { describe, expect, it } from "vitest";
import { defaultLeadForm, type LeadRecord } from "./crm";
import { normalizeActionRecord, normalizeProblemRecord, normalizeDecisionRecord, type ActionRecord } from "./capture-conversions";
import { acceptLeadDelivery, scheduleLeadDelivery } from "./lead-delivery";
import { assertCapacityRecord, buildDeliveryCapacity, recordAvailabilityReview, recordWorkloadAssessment,
  type DeliveryCapacityInput, type WorkloadAssessment, type AvailabilityReview } from "./delivery-capacity";
import { buildCommandAttention, type CommandAttentionInput } from "./command-attention";
import { runIntegrityAudit } from "./integrity-audit";
import { BACKUP_FORMAT, BACKUP_VERSION, PERSON_STORAGE_KEY, LEAD_STORAGE_KEY, CONVERSION_STORAGE_KEY, validateEmpireOsBackup } from "./backup";
import { persistJsonArraysTransaction } from "./persistence";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const person = { id: "operator", name: "Delivery operator", status: "Active", role: "Delivery",
  responsibilities: "Deliver recorded scope", authority: "Schedule agreed work" };
const prospect = (id = "prospect"): LeadRecord => ({ ...defaultLeadForm, id, leadName: id,
  status: "Quote Sent", serviceRequested: "Maintenance", relatedPillar: "Garden Maintenance", dateCreated: "2026-10-01T12:00:00Z" });
const action = (id = "routine", overrides: Partial<ActionRecord> = {}): ActionRecord => ({
  ...normalizeActionRecord({ id, sourceCaptureId: "", targetType: "Convert to Action", title: id, originalRawNote: "",
    createdAt: "2026-10-01T12:00:00Z", status: "Open", importance: "Low", owner: person.name, relatedArea: "Garden Maintenance" }),
  ownerPersonId: person.id, ...overrides,
});
const input = (overrides: Partial<DeliveryCapacityInput> = {}): DeliveryCapacityInput => ({
  leads: [], actions: [], projects: [], people: [person], income: [], problems: [], decisions: [], nowMs: NOW, ...overrides,
});
const workload: Omit<WorkloadAssessment, "recordedAt" | "sourceSnapshot"> = {
  personId: person.id, recordedByPersonId: person.id, windowStart: "2026-10-09", windowEnd: "2026-10-12",
  remainingHours: "8", estimateEvidence: "Remaining agreed scope and attributed labour estimate reviewed",
  readinessConfirmed: true, readinessEvidence: "Access, skills, schedule, resources, quality and commercial assumptions reviewed",
  dependencyActionIds: [], validUntil: "2026-10-12",
};
const availability: Omit<AvailabilityReview, "recordedAt" | "workloadSnapshot"> = {
  recordedByPersonId: person.id, windowStart: "2026-10-09", windowEnd: "2026-10-12", availableHours: "20",
  evidence: "Confirmed workable hours after absence and untracked routine duties",
  workloadCoverageComplete: true, coverageEvidence: "All jobs, Actions and project coordination reviewed; untracked duties deducted",
  validUntil: "2026-10-12",
};
function size(source: DeliveryCapacityInput, type: "Lead" | "Action", id: string, changes: Partial<typeof workload> = {}): DeliveryCapacityInput {
  const result = recordWorkloadAssessment(source, { objectType: type, id }, { ...workload, ...changes });
  return type === "Lead" ? { ...source, leads: source.leads.map((lead) => lead.id === id ? { ...lead, workloadAssessments: result.workloadAssessments } : lead) }
    : { ...source, actions: source.actions.map((record) => record.id === id ? { ...record, workloadAssessments: result.workloadAssessments } : record) };
}
function review(source: DeliveryCapacityInput, changes: Partial<typeof availability> = {}): DeliveryCapacityInput {
  const result = recordAvailabilityReview(source, person.id, { ...availability, ...changes });
  return { ...source, people: source.people.map((entry) => entry.id === person.id ? { ...entry, availabilityReviews: result.availabilityReviews } : entry) };
}
function committed(): DeliveryCapacityInput {
  const source = input({ leads: [{ ...prospect("customer"), status: "Won" }] });
  const accepted = acceptLeadDelivery(source, { leadId: "customer", actionId: "delivery", scope: "Agreed maintenance scope",
    acceptedAt: "2026-10-02", acceptedByPersonId: person.id, acceptanceEvidence: "Written customer scope acceptance",
    ownerPersonId: person.id, promisedBy: "2026-10-12" });
  const linked = { ...source, leads: [accepted.lead], actions: [accepted.action] };
  return { ...linked, leads: [scheduleLeadDelivery(linked, "customer", { date: "2026-10-09",
    evidence: "Delivery date confirmed with customer and operator", recordedByPersonId: person.id })] };
}
const project = { id: "project", projectName: "Delivery project", owner: person.name, area: "Garden Maintenance",
  startDate: "2026-10-09", targetCompletionDate: "2026-10-12", status: "In Progress", relatedActionIds: ["delivery"] };
const command = (source?: DeliveryCapacityInput, overrides: Partial<CommandAttentionInput> = {}) =>
  buildCommandAttention({ problems: [], actions: [], outreach: [], projects: [], decisions: [], opportunities: [],
    lessons: [], systems: [], sops: [], handoffs: [], procurementQueue: [], nowMs: NOW, deliveryCapacity: source, ...overrides });

describe("Evidence-backed capacity, not record-count capacity", () => {
  it("keeps legacy availability and profitability/financial outcomes unknown instead of inventing hours", () => {
    const result = buildDeliveryCapacity(input({ leads: [prospect()], actions: [action()] }));
    expect(result.people[0]).toMatchObject({ availableHours: null, remainingCapacityHours: null, coverageCurrent: false,
      unknownCommittedCount: 1, knownCommittedHours: 0 });
    expect(result.scenarios[0].state).toBe("Unknown");
    expect(command().items).toEqual([]);
    expect(command(input({ actions: [action()] })).items).toEqual([]);
  });
  it("separates accepted and won-unaccepted obligations from potential pipeline without reservations", () => {
    const base = committed();
    const result = buildDeliveryCapacity({ ...base, leads: [...base.leads, prospect(), { ...prospect("won"), status: "Won" }] });
    expect(result).toMatchObject({ committedCount: 2, potentialCount: 1, unownedCommittedCount: 1 });
    expect(result.work.find((work) => work.id === "won")?.remainingHours).toBeNull();
    expect(buildDeliveryCapacity({ ...base, leads: base.leads.map((lead) => ({ ...lead, archived: true })) }).committedCount).toBe(1);
  });
  it("counts accepted delivery once and rolls up its Project without duplicating hours", () => {
    const source = review(size({ ...committed(), projects: [project] }, "Lead", "customer"));
    const result = buildDeliveryCapacity(source);
    expect(result.work.map((work) => `${work.objectType}:${work.id}`)).toEqual(["Lead:customer"]);
    expect(result.people[0]).toMatchObject({ knownCommittedHours: 8, unknownCommittedCount: 0, remainingCapacityHours: 12, coverageCurrent: true });
    expect(() => size(source, "Action", "delivery")).toThrow("Delivery hours belong on its Lead");
    expect(buildDeliveryCapacity({ ...source, projects: [{ ...project, relatedActionIds: ["missing"] }] }).work)
      .toEqual(expect.arrayContaining([expect.objectContaining({ objectType: "Project", remainingHours: null })]));
  });
  it("does not discharge delivery or an active Project from unsupported completion", () => {
    const source = size(committed(), "Lead", "customer");
    const unsupported = { ...source, actions: source.actions.map((record) => ({ ...record, status: "Completed" as const })) };
    expect(buildDeliveryCapacity(unsupported).committedCount).toBe(1);
    expect(buildDeliveryCapacity(unsupported).work[0].operationallyReady).toBe(false);
    const supported = { ...unsupported, projects: [project], actions: unsupported.actions.map((record) => ({
      ...record, completionDate: new Date(NOW).toISOString(), completionEvidence: "Dated agreed customer scope completed" })) };
    expect(buildDeliveryCapacity(supported).work).toEqual([expect.objectContaining({ objectType: "Project", remainingHours: null })]);
  });
  it("retains explicitly assessed ordinary Action work when completion evidence is absent", () => {
    const source = size(input({ actions: [action()] }), "Action", "routine");
    const result = buildDeliveryCapacity({ ...source, actions: source.actions.map((record) => ({ ...record, status: "Completed" as const })) });
    expect(result.work[0]).toMatchObject({ id: "routine", remainingHours: null, operationallyReady: false });
    const contradictory = { ...source, actions: source.actions.map((record) => ({ ...record, status: "Completed" as const,
      completionDate: "2026-10-08T11:00:00Z", completionEvidence: "Earlier completion cannot discharge a later remaining-work review" })) };
    expect(buildDeliveryCapacity(contradictory).committedCount).toBe(1);
  });
  it("uses exact decimal sums and explicit zero availability; no generic capacity limit", () => {
    let source = size(input({ actions: [action("a"), action("b")] }), "Action", "a", { remainingHours: "0.10" });
    source = review(size(source, "Action", "b", { remainingHours: "0.20" }), { availableHours: "0.30" });
    expect(buildDeliveryCapacity(source).people[0]).toMatchObject({ knownCommittedHours: 0.3, remainingCapacityHours: 0, plannedOvercommitment: false });
    expect(buildDeliveryCapacity(review(source, { availableHours: "0" })).people[0])
      .toMatchObject({ availableHours: 0, plannedOvercommitment: true, remainingCapacityHours: -0.3 });
    const zero = review(size(input({ actions: [action()] }), "Action", "routine", { remainingHours: "0" }), { availableHours: "0" });
    expect(buildDeliveryCapacity(zero).work[0].remainingHours).toBe(0);
    expect(zero.actions[0].status).toBe("Open");
  });
  it("keeps missing competing estimates unknown even after a declared full coverage review", () => {
    const source = review(size(input({ actions: [action("sized"), action("unknown")] }), "Action", "sized"));
    expect(buildDeliveryCapacity(source).people[0]).toMatchObject({ availableHours: 20, knownCommittedHours: 8,
      unknownCommittedCount: 1, coverageCurrent: false, remainingCapacityHours: null });
    expect(buildDeliveryCapacity(review(source, { availableHours: "4", workloadCoverageComplete: false, coverageEvidence: "" })).people[0].plannedOvercommitment).toBe(true);
  });
  it("does not spread partial overlaps or count disjoint demand in a reviewed window", () => {
    const partial = review(size(input({ actions: [action()] }), "Action", "routine", { windowEnd: "2026-10-14", validUntil: "2026-10-14" }));
    expect(buildDeliveryCapacity(partial).people[0]).toMatchObject({ knownCommittedHours: 0, unknownCommittedCount: 1, remainingCapacityHours: null });
    const disjoint = review(size(input({ actions: [action()] }), "Action", "routine",
      { windowStart: "2026-10-13", windowEnd: "2026-10-14", validUntil: "2026-10-14" }));
    expect(buildDeliveryCapacity(disjoint).people[0]).toMatchObject({ knownCommittedHours: 0, unknownCommittedCount: 0, remainingCapacityHours: 20 });
  });
  it("invalidates remaining estimates and coverage when scope, source ownership or demand changes", () => {
    const source = review(size(committed(), "Lead", "customer"));
    const scope = { ...source, leads: source.leads.map((lead) => ({ ...lead, deliveryCommitment: lead.deliveryCommitment
      ? { ...lead.deliveryCommitment, scope: "Changed accepted scope" } : undefined })) };
    expect(buildDeliveryCapacity(scope).work[0].remainingHours).toBeNull();
    expect(buildDeliveryCapacity(scope).people[0].coverageCurrent).toBe(false);
    expect(buildDeliveryCapacity({ ...source, actions: [...source.actions, action()] }).people[0].coverageCurrent).toBe(false);
    expect(buildDeliveryCapacity({ ...source, actions: source.actions.map((record) => ({ ...record, description: "Changed execution scope" })) }).work[0].assessmentCurrent).toBe(false);
    expect(buildDeliveryCapacity({ ...source, actions: source.actions.map((record) => ({ ...record, ownerPersonId: "missing" })) }).work[0].ownerPersonId).toBeNull();
    expect(buildDeliveryCapacity(size(source, "Lead", "customer", { remainingHours: "7" })).people[0].coverageCurrent).toBe(false);
  });
  it("re-reviews elapsed windows, expiration and changed Person governance; never adds overlapping historical reviews", () => {
    const source = review(review(size(input({ actions: [action()] }), "Action", "routine"), { availableHours: "100" }), { availableHours: "10" });
    expect(source.people[0].availabilityReviews).toHaveLength(2);
    expect(buildDeliveryCapacity(source).people[0].remainingCapacityHours).toBe(2);
    expect(buildDeliveryCapacity({ ...source, nowMs: Date.parse("2026-10-10T12:00:00Z") }).people[0].availableHours).toBeNull();
    expect(buildDeliveryCapacity({ ...source, people: source.people.map((entry) => ({ ...entry, authority: "New authority scope" })) }).people[0].coverageCurrent).toBe(false);
    const expired = review(source, { validUntil: "2026-10-08" });
    expect(buildDeliveryCapacity({ ...expired, nowMs: Date.parse("2026-10-09T12:00:00Z") }).people[0].availableHours).toBeNull();
  });
  it("models each potential job separately, preserves sales ownership and never accepts/reassigns automatically", () => {
    let source = review(size(committed(), "Lead", "customer"));
    source = { ...source, leads: [...source.leads, prospect("first"), prospect("second")] };
    const original = JSON.stringify(source);
    source = size(size(source, "Lead", "first"), "Lead", "second");
    const result = buildDeliveryCapacity(source);
    expect(result.scenarios.map((scenario) => [scenario.state, scenario.remainingHoursAfter]))
      .toEqual([["Evidence supports this scenario", 4], ["Evidence supports this scenario", 4]]);
    expect(result.people[0].knownCommittedHours).toBe(8);
    expect(JSON.parse(original).leads[1].deliveryCommitment).toBeUndefined();
    expect(source.leads[1].deliveryCommitment).toBeUndefined();
    expect(source.leads[1].owner).toBe(prospect().owner);
    expect(buildDeliveryCapacity(size(source, "Lead", "first", { remainingHours: "13" })).scenarios[0].state).toBe("Planned overcommitment");
  });
  it("requires committed readiness and unowned-area coverage before supporting further work", () => {
    let source = size(committed(), "Lead", "customer", { readinessConfirmed: false, readinessEvidence: "" });
    source = review({ ...source, leads: [...source.leads, prospect()] });
    source = size(source, "Lead", "prospect");
    expect(buildDeliveryCapacity(source).scenarios[0].state).toBe("Unknown");
    const ready = review(size(source, "Lead", "customer"));
    expect(buildDeliveryCapacity({ ...ready, leads: [...ready.leads, { ...prospect("unowned"), status: "Won" }] }).scenarios[0].state).toBe("Unknown");
    const founder = { ...ready, people: ready.people.map((entry) => ({ ...entry, accessLevel: "Founder" })) };
    expect(buildDeliveryCapacity(founder).people[0].reasons.some((reason) => reason.includes("founder capacity"))).toBe(true);
  });
  it("flags lower-bound prospective overcommitment even with incomplete competing-work coverage", () => {
    let source = review(size(committed(), "Lead", "customer"), { workloadCoverageComplete: false, coverageEvidence: "", availableHours: "10" });
    source = size({ ...source, leads: [...source.leads, prospect()] }, "Lead", "prospect");
    expect(buildDeliveryCapacity(source).scenarios[0]).toMatchObject({ state: "Planned overcommitment", remainingHoursAfter: null });
  });
  it("rejects mismatched actual/proposed People and keeps expired/ambiguous workload unknown", () => {
    const other = { ...person, id: "other", name: "Other ready operator" };
    const source = { ...committed(), people: [person, other] };
    expect(() => size(source, "Lead", "customer", { personId: other.id })).toThrow("delegation workflow");
    const sized = review(size(source, "Lead", "customer"));
    expect(buildDeliveryCapacity({ ...sized, leads: [...sized.leads, sized.leads[0]] }).work[0].remainingHours).toBeNull();
    expect(buildDeliveryCapacity({ ...sized, people: [sized.people[0], sized.people[0]] }).work[0].ownerPersonId).toBeNull();
    expect(buildDeliveryCapacity({ ...sized, nowMs: Date.parse("2026-10-13T12:00:00Z") }).work[0].assessmentCurrent).toBe(false);
    expect(() => size(input({ actions: [action()], people: [{ ...person, authority: "" }] }), "Action", "routine")).toThrow("delegation-ready");
  });
});

describe("Capacity evidence safeguards and dependency accountability", () => {
  it("allows unresolved genuine prerequisites but refuses broken, self and duplicate references", () => {
    const source = input({ actions: [action("work"), action("prerequisite")] });
    const sized = size(source, "Action", "work", { dependencyActionIds: ["prerequisite"] });
    expect(buildDeliveryCapacity(sized).work[0].operationallyReady).toBe(false);
    for (const dependencyActionIds of [["missing"], ["work"], ["prerequisite", "prerequisite"]]) {
      expect(() => size(source, "Action", "work", { dependencyActionIds })).toThrow("Dependency");
    }
    expect(() => size({ ...source, actions: [...source.actions, action("prerequisite")] },
      "Action", "work", { dependencyActionIds: ["prerequisite"] })).toThrow("ambiguous");
  });
  it("refuses direct and transitive dependency cycles, including completion-shaped cyclic evidence", () => {
    let source = size(input({ actions: [action("a"), action("b"), action("c")] }), "Action", "a", { dependencyActionIds: ["b"] });
    source = size(source, "Action", "b", { dependencyActionIds: ["c"] });
    expect(() => size(source, "Action", "c", { dependencyActionIds: ["a"] })).toThrow("cycle");
    const completed = action("b", { status: "Completed", completionDate: new Date(NOW).toISOString(), completionEvidence: "Evidence recorded",
      workloadAssessments: source.actions[0].workloadAssessments });
    expect(() => size(input({ actions: [action("a"), completed] }), "Action", "a", { dependencyActionIds: ["b"] })).toThrow("cycle");
  });
  it("resolves explicit dated prerequisite evidence without treating unowned availability as confirmed", () => {
    const source = input({ actions: [action("work"), action("prerequisite", { status: "Completed",
      completionDate: new Date(NOW).toISOString(), completionEvidence: "Dated materials readiness confirmed" })] });
    expect(buildDeliveryCapacity(size(source, "Action", "work", { dependencyActionIds: ["prerequisite"] })).work[0].operationallyReady).toBe(true);
    expect(() => size(source, "Action", "work", { personId: "missing" })).toThrow("delegation-ready");
    expect(() => size(source, "Action", "work", { personId: "different" })).toThrow();
    expect(() => recordAvailabilityReview(input({ people: [person, person] }), person.id, availability)).toThrow();
  });
  it("preserves existing Problem/Decision blockers and treats broken dependency references as unready", () => {
    const problem = normalizeProblemRecord({ ...action("problem"), targetType: "Convert to Problem", problemStatus: "Open" });
    const decision = normalizeDecisionRecord({ ...action("decision"), targetType: "Convert to Decision", decisionStatus: "Draft" });
    const source = input({ actions: [action("work", { relatedProblem: problem.id, relatedDecision: decision.id })],
      problems: [problem], decisions: [decision] });
    const sized = size(source, "Action", "work");
    expect(buildDeliveryCapacity(sized).work[0].reasons.some((reason) => reason.includes("BLOCKED BY PROBLEM"))).toBe(true);
    const decided = { ...sized, problems: [{ ...problem, problemStatus: "Resolved" as const }] };
    expect(buildDeliveryCapacity(decided).work[0].reasons.some((reason) => reason.includes("WAITING ON DECISION"))).toBe(true);
    expect(buildDeliveryCapacity({ ...sized, problems: [], decisions: [] }).work[0].operationallyReady).toBe(false);
  });
  it.each(["-1", "1.001", "NaN", "Infinity", "1e2", ""])("rejects fabricated/invalid quantity %s", (remainingHours) => {
    expect(() => size(input({ actions: [action()] }), "Action", "routine", { remainingHours })).toThrow("non-negative");
    expect(() => review(input(), { availableHours: remainingHours })).toThrow("genuine");
  });
  it("requires evidence, review attribution, valid dates and precise boundaries without blocking operational gaps", () => {
    const source = input({ actions: [action()] });
    expect(() => size(source, "Action", "routine", { windowStart: "2026-02-30" })).toThrow();
    expect(() => size(source, "Action", "routine", { windowStart: "2026-10-07" })).toThrow();
    expect(() => size(source, "Action", "routine", { estimateEvidence: "" })).toThrow();
    expect(() => size(source, "Action", "routine", { readinessEvidence: "" })).toThrow("readiness");
    expect(() => review(source, { evidence: "" })).toThrow();
    expect(() => review(source, { coverageEvidence: "" })).toThrow("Full coverage");
    expect(() => review(source, { workloadCoverageComplete: false, coverageEvidence: "" })).not.toThrow();
    const late = size(input({ actions: [action("late", { dueDate: "2026-10-10" })] }), "Action", "late");
    expect(buildDeliveryCapacity(late).work[0].reasons.some((reason) => reason.includes("deadline"))).toBe(true);
  });
  it("invalidates pre-acceptance estimates against the actual agreed scope and commitment", () => {
    const source = size(input({ leads: [prospect()] }), "Lead", "prospect");
    const won = { ...source, leads: source.leads.map((lead) => ({ ...lead, status: "Won" as const })) };
    const accepted = acceptLeadDelivery(won, { leadId: "prospect", actionId: "delivery", scope: "Actual agreed scope", acceptedAt: "2026-10-08",
      acceptedByPersonId: person.id, acceptanceEvidence: "Written acceptance", ownerPersonId: person.id, promisedBy: "2026-10-12" });
    expect(buildDeliveryCapacity({ ...won, leads: [accepted.lead], actions: [accepted.action] }).work[0].assessmentCurrent).toBe(false);
  });
});

describe("Capacity integration and backward-compatible recovery", () => {
  it("adds source-hosted attention without changing existing urgent priority or legacy omission", () => {
    const source = review(size(committed(), "Lead", "customer"), { availableHours: "4" });
    expect(command(source).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: "customer", objectType: "Lead", attentionRank: 2 })]));
    const urgent = action("urgent", { status: "Blocked", priority: "Critical", dueDate: "2026-10-01" });
    const urgentSource = review(size(input({ actions: [urgent] }), "Action", "urgent"));
    const before = command(undefined, { actions: [urgent] }).items[0];
    const after = command(urgentSource, { actions: [urgent] }).items.find((item) => item.id === "urgent")!;
    expect(after.attentionRank).toBeLessThanOrEqual(before.attentionRank);
    expect(after.priorityScore).toBeGreaterThanOrEqual(before.priorityScore);
    expect(after.reasons).toEqual(expect.arrayContaining(before.reasons));
  });
  it("audits stale sizing/coverage and missing attribution/dependency references", () => {
    const source = review(size(committed(), "Lead", "customer"));
    const lead = { ...source.leads[0], workloadAssessments: source.leads[0].workloadAssessments!.map((assessment) => ({
      ...assessment, recordedByPersonId: "missing", dependencyActionIds: ["missing-dependency"] })) };
    const report = runIntegrityAudit({ leads: [lead], actions: [...source.actions], people: [...source.people], projects: [],
      captures: [], conversions: [...source.actions], decisions: [], problems: [], opportunities: [], lessons: [], systems: [], sops: [],
      commitments: [], outreach: [], handoffs: [], strategicObjectives: [], strategicReviews: [], income: [], expenses: [], storage: {},
      sharedAreaOptions: ["Garden Maintenance"], commitmentTypeOptions: [], commitmentStatusOptions: [], nowIso: () => new Date(NOW).toISOString() });
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ recordId: "customer", category: "Delivery capacity evidence" }),
      expect.objectContaining({ recordId: person.id, category: "Delivery capacity evidence" }),
      expect.objectContaining({ recordId: "customer", reason: expect.stringContaining("missing-dependency") }),
    ]));
  });
  it("round-trips histories in existing version-one stores and rejects malformed optional evidence", () => {
    const source = review(size(committed(), "Lead", "customer"));
    const storage = { [PERSON_STORAGE_KEY]: JSON.stringify(source.people), [LEAD_STORAGE_KEY]: JSON.stringify(source.leads),
      [CONVERSION_STORAGE_KEY]: JSON.stringify(source.actions) };
    const backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date(NOW).toISOString(), storage };
    expect(validateEmpireOsBackup(backup).storage).toEqual(storage);
    expect(() => assertCapacityRecord({ id: "legacy" }, "Person")).not.toThrow();
    for (const availabilityReviews of [null, {}, [{}], [{ ...source.people[0].availabilityReviews![0], availableHours: "-1" }]]) {
      expect(() => validateEmpireOsBackup({ ...backup, storage: { [PERSON_STORAGE_KEY]: JSON.stringify([{ ...person, availabilityReviews }]) } })).toThrow("malformed");
    }
    expect(() => validateEmpireOsBackup({ ...backup, storage: { [LEAD_STORAGE_KEY]: JSON.stringify([{ ...source.leads[0], workloadAssessments: [{}] }]) } })).toThrow("malformed");
    expect(() => validateEmpireOsBackup({ ...backup, storage: { [CONVERSION_STORAGE_KEY]: JSON.stringify([{ ...action(), workloadAssessments: null }]) } })).toThrow("malformed");
  });
  it("preserves previous storage strings when verified evidence persistence fails", () => {
    const data = new Map([[PERSON_STORAGE_KEY, "previous people"], [LEAD_STORAGE_KEY, "previous leads"]]);
    let failed = false;
    const storage = { getItem: (key: string) => data.get(key) ?? null, removeItem: (key: string) => { data.delete(key); },
      setItem: (key: string, value: string) => {
        if (key === LEAD_STORAGE_KEY && !failed) { failed = true; throw new Error("Write rejected"); }
        data.set(key, value);
      } };
    expect(() => persistJsonArraysTransaction(storage, [{ key: PERSON_STORAGE_KEY, records: [person] },
      { key: LEAD_STORAGE_KEY, records: [prospect()] }])).toThrow();
    expect(data.get(PERSON_STORAGE_KEY)).toBe("previous people");
    expect(data.get(LEAD_STORAGE_KEY)).toBe("previous leads");
  });
});
