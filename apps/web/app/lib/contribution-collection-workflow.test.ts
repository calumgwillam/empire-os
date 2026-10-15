import { describe, expect, it, vi } from "vitest";
import {
  CONTRIBUTION_SAFETY, previewContributionAppend, type ContributionAuditEvent, type ContributionEntity, type ContributionLedger, type ContributionRecord,
} from "./individual-contribution";
import { type ContributionReferenceSnapshot } from "./individual-contribution-reporting";
import { createServerPrincipalResolver, isAuthenticatedPrincipal, type AuthenticatedPrincipal } from "./server-persistence-authority";
import {
  approveContributionCorrection, createContributionCollectionPreviewAuthority, prepareOperationalContributionEvidence,
  previewContributionDisclosure, previewContributionSubmission, proposeContributionCorrection, reconcileContributionOperation,
  type ContributionCollectionAuthority, type ContributionCollectionObservation, type ContributionCollectionPurpose,
  type ContributionCollectionRequest, type ContributionCorrectionProposal, type ContributionOperationObservation,
} from "./contribution-collection-workflow";

const NOW = 60_000_000;
const SCOPE = { tenantId: "tenant", datasetId: "dataset" };
const SELF = { id: "self", revision: 1, sha256: "a".repeat(64) };
const PROOF = { id: "proof", revision: 1, sha256: "b".repeat(64) };
const WORK = { id: "work-snapshot", revision: 1, sha256: "c".repeat(64) };
const ALL: readonly ContributionCollectionPurpose[] = [
  "submit-own", "submit-on-behalf", "submit-result", "propose-allocation", "define-expectation", "corroborate-time",
  "review-result", "review-allocation", "review-expectation", "propose-correction", "approve-correction",
  "open-dispute", "resolve-dispute", "withdraw", "disclose-own", "disclose-business-summary", "disclose-evidence",
];
async function actor(subject = "employee"): Promise<AuthenticatedPrincipal> {
  const result = await createServerPrincipalResolver(async () => ({ status: "authenticated", subject: `user_${subject}` }))(new Request("https://empire.invalid"));
  if (!isAuthenticatedPrincipal(result)) throw new Error("Synthetic authentication failed.");
  return result;
}
function refs(): ContributionReferenceSnapshot {
  return {
    scope: SCOPE, asOfMs: NOW,
    people: [
      { id: "employee", kind: "employee" }, { id: "founder", kind: "founder" }, { id: "head", kind: "department-head" },
      { id: "reviewer", kind: "employee" }, { id: "observer", kind: "contractor" },
    ],
    businessIds: ["org", "other-org"], roles: [{ id: "role", businessId: "org" }],
    departments: [{ id: "department", businessId: "org" }], projects: [{ id: "project", businessId: "org" }],
    actions: [{ id: "action", businessId: "org" }], financialRecords: [],
    evidence: [
      { ...SELF, recordedAtMs: 0, source: "self-report", custodianPersonId: "employee", availability: "available" },
      { ...PROOF, recordedAtMs: 0, source: "independent-observation", custodianPersonId: "observer", availability: "available" },
      { ...WORK, recordedAtMs: 0, source: "work-record", custodianPersonId: "observer", availability: "available" },
    ],
  };
}
function policy(): ContributionCollectionAuthority {
  return {
    scope: SCOPE, policyRevision: 4, bindingRevision: 2, checkedAtMs: NOW, validUntilMs: NOW + 1_000,
    bindings: ["employee", "founder", "head", "reviewer"].map(personId => ({ subject: `user_${personId}`, personId, status: "active" as const })),
    grants: ["employee", "founder", "head", "reviewer"].map(subject => ({ subject: `user_${subject}`, businessId: "org", purposes: ALL, personIds: null })),
  };
}
function work(personId = "employee", id = "time"): ContributionRecord {
  return {
    kind: "contribution", id, personId, businessId: "org", roleId: "role", departmentId: "department", projectId: "project",
    actionId: "action", pillarId: "garden-maintenance", category: "delivery", participation: "contributor",
    period: { startMs: 60_000, endMs: 120_000 }, measure: { kind: "hours", reportedMinutes: 1 }, evidence: [SELF],
  };
}
function add(history: ContributionLedger, body: ContributionAuditEvent["body"], actorPersonId = "employee"): ContributionLedger {
  const sequence = history.events.length + 1;
  return {
    ...history, revision: sequence, events: [...history.events, {
      id: `old-event-${sequence}`, sequence, previousEventId: history.events.at(-1)?.id ?? null,
      actorPersonId, recordedAtMs: 1_000_000 + sequence, body,
    }],
  };
}
function observation(entities: readonly ContributionEntity[] = []): ContributionCollectionObservation {
  let history: ContributionLedger = { version: 1, scope: SCOPE, revision: 0, events: [] };
  for (const entity of entities) history = add(history, { type: "created", entity }, entity.kind === "contribution" ? entity.personId : "employee");
  return { authority: policy(), ledger: history, references: refs() };
}
function historyOf(observed: ContributionCollectionObservation) { return observed.ledger as ContributionLedger; }
function request(observed = observation(), body: ContributionAuditEvent["body"] = { type: "created", entity: work() }): ContributionCollectionRequest {
  return {
    operationId: "operation", eventId: "new-event", expectedPolicyRevision: 4, expectedBindingRevision: 2,
    expectedLedgerRevision: historyOf(observed).revision, expectedHeadEventId: historyOf(observed).events.at(-1)?.id ?? null, body,
  };
}
function correction(observed = observation([work()])) {
  return request(observed, {
    type: "corrected", entityId: "time", expectedVersion: 1, replacement: { ...work(), measure: { kind: "hours", reportedMinutes: 0 } },
    reason: "Approved correction must preserve original history.", evidence: [PROOF],
  });
}
function refused(value: unknown) { expect(value).toMatchObject({ status: "refused", ...CONTRIBUTION_SAFETY, message: expect.any(String) }); }
function approvedRequest(input: ContributionCollectionRequest) { return { ...input, operationId: "approval", eventId: "approval-event" }; }
function frozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen);
}
function resultEntity(): ContributionEntity {
  return {
    kind: "shared-result", id: "result", businessId: "org", resultKind: "outcome",
    origin: { type: "Action", id: "action", resultKey: "one-canonical-result" }, occurredAtMs: 120_000,
    description: "Synthetic result.", money: null, evidence: [PROOF],
  };
}

describe("authenticated inactive collection boundary", () => {
  it("constructs actor, sequence, previous event and time from the server observation without writing", async () => {
    const observed = observation();
    const before = JSON.stringify(observed);
    const result = previewContributionSubmission(await actor(), observed, request(observed), NOW);
    expect(result.status).toBe("preview");
    if (result.status !== "preview") throw new Error(result.message);
    expect(result.plan).toMatchObject({
      actorSubject: "user_employee", actorPersonId: "employee", event: { actorPersonId: "employee", sequence: 1, previousEventId: null, recordedAtMs: NOW },
      durable: false, effect: "append-preview-only", requiresLockedRevalidation: true, ...CONTRIBUTION_SAFETY,
    });
    frozen(result);
    expect(JSON.stringify(observed)).toBe(before);
    expect(Object.isFrozen(observed)).toBe(false);
  });

  it("denies fabricated or copied principals and never uses founder/department role labels as grants", async () => {
    const observed = observation();
    refused(previewContributionSubmission({ subject: "user_founder" } as AuthenticatedPrincipal, observed, request(observed), NOW));
    refused(previewContributionSubmission({ ...await actor() }, observed, request(observed), NOW));
    const noGrants = { ...observed, authority: { ...policy(), grants: [] } };
    for (const person of ["founder", "head"]) refused(previewContributionSubmission(await actor(person), noGrants,
      request(observed, { type: "created", entity: work(person) }), NOW));
  });

  it.each(["actorPersonId", "actorSubject", "recordedAtMs", "sequence", "role", "scope"])("refuses client authority field %s", async field => {
    const observed = observation();
    refused(previewContributionSubmission(await actor(), observed, Object.assign({}, request(observed), { [field]: "founder" }), NOW));
  });

  it("requires separate on-behalf permission to submit for a founder or employee", async () => {
    const observed = observation();
    const ownOnly = { ...observed, authority: { ...policy(), grants: [{ subject: "user_head", businessId: "org", purposes: ["submit-own"] as const, personIds: null }] } };
    refused(previewContributionSubmission(await actor("head"), ownOnly, request(observed), NOW));
    const permitted = previewContributionSubmission(await actor("head"), observed, request(observed), NOW);
    expect(permitted.status).toBe("preview");
    if (permitted.status === "preview") expect(permitted.plan.event).toMatchObject({
      actorPersonId: "head", body: { entity: { personId: "employee" } },
    });
  });

  it("fails closed for revoked, ambiguous, stale and missing bindings", async () => {
    const observed = observation();
    for (const authority of [
      { ...policy(), bindings: [] },
      { ...policy(), bindings: policy().bindings.map(binding => ({ ...binding, status: "revoked" as const })) },
      { ...policy(), bindings: [...policy().bindings, policy().bindings[0]] },
      { ...policy(), bindings: [...policy().bindings, { subject: "user_alias", personId: "employee", status: "active" as const }] },
      { ...policy(), checkedAtMs: NOW - 1 },
      { ...policy(), validUntilMs: NOW },
    ]) refused(previewContributionSubmission(await actor(), { ...observed, authority }, request(observed), NOW));
  });

  it("refuses foreign scopes and unknown business/person references", async () => {
    const observed = observation();
    refused(previewContributionSubmission(await actor(), { ...observed, authority: { ...policy(), scope: { ...SCOPE, tenantId: "foreign" } } }, request(observed), NOW));
    refused(previewContributionSubmission(await actor(), observed, request(observed, { type: "created", entity: { ...work(), personId: "fabricated" } }), NOW));
    refused(previewContributionSubmission(await actor(), observed, request(observed, { type: "created", entity: { ...work(), businessId: "other-org" } }), NOW));
  });

  it("does not invoke accessors or accept sparse authority grants", async () => {
    const observed = observation();
    const getter = vi.fn(() => request(observed).body);
    refused(previewContributionSubmission(await actor(), observed, Object.defineProperty({ ...request(observed) }, "body", { get: getter }), NOW));
    expect(getter).not.toHaveBeenCalled();
    const grants = new Array(1);
    refused(previewContributionSubmission(await actor(), { ...observed, authority: { ...policy(), grants } }, request(observed), NOW));
  });

  it("only loads an observation after verified authentication and explicitly refuses loader failure", async () => {
    const observe = vi.fn(async () => ({ observation: observation(), nowMs: NOW }));
    const unauthenticated = createContributionCollectionPreviewAuthority({ resolveSession: async () => ({ status: "unauthenticated" }), observe });
    refused(await unauthenticated.preview(new Request("https://empire.invalid"), request()));
    expect(observe).not.toHaveBeenCalled();
    const failed = createContributionCollectionPreviewAuthority({
      resolveSession: async () => ({ status: "authenticated", subject: "user_employee" }),
      observe: async () => { throw new Error("Storage offline"); },
    });
    refused(await failed.preview(new Request("https://empire.invalid"), request()));
    const valid = createContributionCollectionPreviewAuthority({
      resolveSession: async () => ({ status: "authenticated", subject: "user_employee" }), observe,
    });
    expect((await valid.preview(new Request("https://empire.invalid", { headers: { "x-actor": "user_founder" } }), request())).status).toBe("preview");
  });
});

describe("independent evidence and domain review reuse", () => {
  it("validates prospective expectations in their own period, including missing role and evidence references", async () => {
    const expectation: ContributionEntity = {
      kind: "expectation", id: "future-standard", businessId: "org", roleId: "role", departmentId: "department",
      period: { startMs: NOW + 1_000, endMs: NOW + 61_000 }, evidence: [PROOF],
      criteria: [{ id: "time", dimension: "corroborated-minutes", statement: "Future agreed standard.", minimum: 1 }],
    };
    const empty = observation();
    expect(previewContributionSubmission(await actor("head"), empty, request(empty, { type: "created", entity: expectation }), NOW).status).toBe("preview");
    refused(previewContributionSubmission(await actor("head"), empty, request(empty, { type: "created", entity: { ...expectation, evidence: [] } }), NOW));
    refused(previewContributionSubmission(await actor("head"), empty, request(empty, { type: "created", entity: { ...expectation, roleId: "invented" } }), NOW));
    const observed = observation([expectation]);
    expect(previewContributionSubmission(await actor("head"), observed, request(observed, {
      type: "reviewed", entityId: expectation.id, expectedVersion: 1, decision: "approved", reason: "Prospective independent review.", evidence: [PROOF],
    }), NOW).status).toBe("preview");
  });

  it("keeps self-report distinct from corroboration and denies founder self-corroboration", async () => {
    const observed = observation([work("founder")]);
    const corroboration = request(observed, { type: "hours-corroborated", entityId: "time", expectedVersion: 1, minutes: 1, evidence: [PROOF] });
    refused(previewContributionSubmission(await actor("founder"), observed, corroboration, NOW));
    expect(previewContributionSubmission(await actor("reviewer"), observed, corroboration, NOW).status).toBe("preview");
    refused(previewContributionSubmission(await actor("reviewer"), observed, {
      ...corroboration, body: { type: "hours-corroborated", entityId: "time", expectedVersion: 1, minutes: 1, evidence: [SELF] },
    }, NOW));
  });

  it("rejects duplicate corroborators and contradictory corroboration instead of selecting a preferred value", async () => {
    const initial = observation([work()]);
    const history = add(historyOf(initial), { type: "hours-corroborated", entityId: "time", expectedVersion: 1, minutes: 1, evidence: [PROOF] }, "reviewer");
    const observed = { ...initial, ledger: history };
    const body: ContributionAuditEvent["body"] = { type: "hours-corroborated", entityId: "time", expectedVersion: 1, minutes: 0, evidence: [PROOF] };
    refused(previewContributionSubmission(await actor("reviewer"), observed, request(observed, body), NOW));
    refused(previewContributionSubmission(await actor("head"), observed, request(observed, body), NOW));
  });

  it("rejects generic approval of an activity record and approval of disputed outcomes", async () => {
    const observed = observation([work(), resultEntity()]);
    const body: ContributionAuditEvent["body"] = { type: "reviewed", entityId: "time", expectedVersion: 1, decision: "approved", reason: "Claimed approval.", evidence: [PROOF] };
    refused(previewContributionSubmission(await actor("head"), observed, request(observed, body), NOW));
    const history = add(historyOf(observed), { type: "disputed", entityId: "result", expectedVersion: 1, disputeId: "dispute", reason: "Contested.", evidence: [] }, "founder");
    const disputed = { ...observed, ledger: history };
    refused(previewContributionSubmission(await actor("reviewer"), disputed, request(disputed, { ...body, entityId: "result" }), NOW));
  });

  it("allows independent supported outcome review and records rejection without claiming approval", async () => {
    const observed = observation([resultEntity()]);
    const body: ContributionAuditEvent["body"] = { type: "reviewed", entityId: "result", expectedVersion: 1, decision: "approved", reason: "Independent evidence inspected.", evidence: [PROOF] };
    expect(previewContributionSubmission(await actor("reviewer"), observed, request(observed, body), NOW).status).toBe("preview");
    refused(previewContributionSubmission(await actor(), observed, request(observed, body), NOW));
    const rejected = previewContributionSubmission(await actor("head"), observed, request(observed, { ...body, decision: "rejected" }), NOW);
    expect(rejected.status).toBe("preview");
    if (rejected.status === "preview") expect(rejected.plan.event.body).toMatchObject({ decision: "rejected" });
  });

  it("requires scoped review over every participant and preserves historical interested parties", async () => {
    const participant = { ...work("founder", "participation"), measure: { kind: "outcome" as const, resultId: "result" } };
    const observed = observation([resultEntity(), participant]);
    const body: ContributionAuditEvent["body"] = { type: "reviewed", entityId: "result", expectedVersion: 1, decision: "approved", reason: "Review.", evidence: [PROOF] };
    refused(previewContributionSubmission(await actor("founder"), observed, request(observed, body), NOW));
    const limited = { ...observed, authority: { ...policy(), grants: [{ subject: "user_head", businessId: "org", purposes: ["review-result"] as const, personIds: ["employee"] }] } };
    refused(previewContributionSubmission(await actor("head"), limited, request(observed, body), NOW));
  });

  it("does not make a prior beneficiary independent by moving participation to a different result", async () => {
    const first = resultEntity();
    if (first.kind !== "shared-result") throw new Error("Synthetic result missing.");
    const second = { ...first, id: "other-result", origin: { ...first.origin, resultKey: "other-outcome" } };
    const participation: ContributionRecord = { ...work("founder", "participation"), measure: { kind: "outcome", resultId: "result" } };
    const initial = observation([first, second, participation]);
    const history = add(historyOf(initial), {
      type: "corrected", entityId: "participation", expectedVersion: 1,
      replacement: { ...participation, measure: { kind: "outcome", resultId: "other-result" } },
      reason: "Historical participation remains visible.", evidence: [PROOF],
    }, "head");
    const observed = { ...initial, ledger: history };
    refused(previewContributionSubmission(await actor("founder"), observed, request(observed, {
      type: "reviewed", entityId: "result", expectedVersion: 1, decision: "approved", reason: "Attempted self approval.", evidence: [PROOF],
    }), NOW));
  });

  it("requires usable new-event evidence but allows evidence-free dispute opening to preserve recourse", async () => {
    const observed = observation([work()]);
    const dispute: ContributionAuditEvent["body"] = { type: "disputed", entityId: "time", expectedVersion: 1, disputeId: "dispute", reason: "I contest this.", evidence: [] };
    expect(previewContributionSubmission(await actor(), observed, request(observed, dispute), NOW).status).toBe("preview");
    refused(previewContributionSubmission(await actor(), observed, request(observed, { ...dispute, evidence: [{ ...PROOF, revision: 99 }] }), NOW));
    const references = refs();
    refused(previewContributionSubmission(await actor(), {
      ...observed, references: { ...references, evidence: references.evidence.map(ref => ({ ...ref, availability: "restricted" })) },
    }, request(observed, { ...dispute, evidence: [PROOF] }), NOW));
  });

  it("does not prevent a person disputing an existing claim merely because its original evidence is missing", async () => {
    const observed = observation([{ ...work(), evidence: [] }]);
    const body: ContributionAuditEvent["body"] = { type: "disputed", entityId: "time", expectedVersion: 1, disputeId: "dispute", reason: "Original record lacks evidence.", evidence: [] };
    expect(previewContributionSubmission(await actor(), observed, request(observed, body), NOW).status).toBe("preview");
  });

  it("retains canonical outcome identity and reviewed allocation dependencies without approving self-allocation", async () => {
    const result = resultEntity();
    const participation: ContributionRecord = { ...work("founder", "participation"), measure: { kind: "outcome", resultId: "result" } };
    const observed = observation([result, participation]);
    let history = add(historyOf(observed), {
      type: "reviewed", entityId: "result", expectedVersion: 1, decision: "approved", reason: "Reviewed result.", evidence: [PROOF],
    }, "reviewer");
    history = add(history, { type: "created", entity: {
      kind: "allocation", id: "allocation", resultId: "result", resultVersion: 1,
      participationVersions: [{ entityId: "participation", version: 1 }],
      shares: [{ personId: "founder", basisPoints: 6_000 }], rationale: "Explicit proposal, not equity.", evidence: [PROOF],
    } });
    const withAllocation = { ...observed, ledger: history };
    const body: ContributionAuditEvent["body"] = { type: "reviewed", entityId: "allocation", expectedVersion: 1, decision: "approved", reason: "Independent review.", evidence: [PROOF] };
    refused(previewContributionSubmission(await actor("founder"), withAllocation, request(withAllocation, body), NOW));
    const valid = previewContributionSubmission(await actor("head"), withAllocation, request(withAllocation, body), NOW);
    expect(valid.status).toBe("preview");
    if (valid.status === "preview") expect(valid.plan.expectedEntityVersions.map(item => item.entityId)).toEqual(["allocation", "participation", "result"]);
    const duplicate = previewContributionSubmission(await actor("head"), withAllocation,
      request(withAllocation, { type: "created", entity: { ...result, id: "duplicate-result" } }), NOW);
    refused(duplicate);
  });
});

describe("approved corrections, concurrency and preserved audit", () => {
  it("requires an original proposal and separate independent approval bound to identical correction content", async () => {
    const observed = observation([work()]);
    const input = correction(observed);
    refused(previewContributionSubmission(await actor(), observed, input, NOW));
    const proposed = proposeContributionCorrection(await actor(), observed, input, NOW);
    if (proposed.status !== "proposed") throw new Error(proposed.message);
    expect(historyOf(observed).revision).toBe(1);
    refused(approveContributionCorrection(await actor(), observed, proposed.proposal, approvedRequest(input), NOW));
    const result = approveContributionCorrection(await actor("reviewer"), observed, proposed.proposal, approvedRequest(input), NOW);
    expect(result.status).toBe("preview");
    if (result.status !== "preview") throw new Error(result.message);
    const virtualAppend = previewContributionAppend(historyOf(observed), result.plan.event, historyOf(observed).revision, NOW);
    if (virtualAppend.status !== "preview") throw new Error(virtualAppend.message);
    expect(virtualAppend.projection.entities.find(state => state.entity.id === "time")?.version).toBe(2);
    expect(result.plan.correctionApproval).toMatchObject({ proposerPersonId: "employee", approvalPersonId: "reviewer", proposalOperationId: "operation" });
    expect(result.plan.event).toMatchObject({ actorPersonId: "reviewer", body: { type: "corrected", expectedVersion: 1 } });
    expect(historyOf(observed).events[0].body).toMatchObject({ entity: { measure: { reportedMinutes: 1 } } });
  });

  it("refuses forged proposals, edited approvals, identity reuse and revoked proposers", async () => {
    const observed = observation([work()]);
    const input = correction(observed);
    const proposed = proposeContributionCorrection(await actor(), observed, input, NOW);
    if (proposed.status !== "proposed") throw new Error(proposed.message);
    refused(approveContributionCorrection(await actor("reviewer"), observed, {} as ContributionCorrectionProposal, approvedRequest(input), NOW));
    refused(approveContributionCorrection(await actor("reviewer"), observed, proposed.proposal, input, NOW));
    const body = input.body;
    if (body.type !== "corrected") throw new Error("Fixture correction missing.");
    refused(approveContributionCorrection(await actor("reviewer"), observed, proposed.proposal, { ...approvedRequest(input), body: { ...body, reason: "Changed content" } }, NOW));
    const revoked = { ...observed, authority: { ...policy(), bindings: policy().bindings.map(binding => binding.personId === "employee" ? { ...binding, status: "revoked" as const } : binding) } };
    refused(approveContributionCorrection(await actor("reviewer"), revoked, proposed.proposal, approvedRequest(input), NOW));
    const noProposerGrant = { ...observed, authority: { ...policy(), grants: policy().grants.filter(grant => grant.subject !== "user_employee") } };
    refused(approveContributionCorrection(await actor("reviewer"), noProposerGrant, proposed.proposal, approvedRequest(input), NOW));
  });

  it("refuses approval after a competing append even when a caller supplies newer ledger fences", async () => {
    const initial = observation([work()]);
    const input = correction(initial);
    const proposed = proposeContributionCorrection(await actor(), initial, input, NOW);
    if (proposed.status !== "proposed") throw new Error(proposed.message);
    const changed = { ...initial, ledger: add(historyOf(initial), {
      type: "disputed", entityId: "time", expectedVersion: 1, disputeId: "concurrent", reason: "Competing observation.", evidence: [],
    }, "founder") };
    refused(approveContributionCorrection(await actor("reviewer"), changed, proposed.proposal, approvedRequest(request(changed, input.body)), NOW));
  });

  it("refuses stale entity versions, replayed event identities and post-correction corroboration pins", async () => {
    const observed = observation([work()]);
    const body: ContributionAuditEvent["body"] = { type: "hours-corroborated", entityId: "time", expectedVersion: 2, minutes: 1, evidence: [PROOF] };
    refused(previewContributionSubmission(await actor("reviewer"), observed, request(observed, body), NOW));
    refused(previewContributionSubmission(await actor("head"), observed, {
      ...request(observed, { type: "disputed", entityId: "time", expectedVersion: 1, disputeId: "dispute", reason: "Contested.", evidence: [] }),
      eventId: historyOf(observed).events[0].id,
    }, NOW));
    const changed = { ...observed, ledger: add(historyOf(observed), correction(observed).body) };
    refused(previewContributionSubmission(await actor("reviewer"), changed, request(changed, { ...body, expectedVersion: 1 }), NOW));
  });

  it.each(["expectedPolicyRevision", "expectedBindingRevision", "expectedLedgerRevision", "expectedHeadEventId"] as const)("refuses stale %s instead of rebasing", async field => {
    const observed = observation([work()]);
    refused(previewContributionSubmission(await actor(), observed, { ...request(observed, { type: "disputed", entityId: "time", expectedVersion: 1, disputeId: "dispute", reason: "Contested.", evidence: [] }), [field]: field === "expectedHeadEventId" ? "wrong-head" : 99 }, NOW));
  });

  it("two competing previews are not two commits; applying one makes the other's fences stale", async () => {
    const observed = observation();
    const principal = await actor();
    const first = previewContributionSubmission(principal, observed, request(observed), NOW);
    const secondInput = { ...request(observed, { type: "created", entity: work("employee", "other") }), operationId: "second", eventId: "second-event" };
    expect(previewContributionSubmission(principal, observed, secondInput, NOW).status).toBe("preview");
    if (first.status !== "preview") throw new Error(first.message);
    const history: ContributionLedger = { ...historyOf(observed), revision: 1, events: [first.plan.event] };
    refused(previewContributionSubmission(principal, { ...observed, ledger: history }, secondInput, NOW));
  });

  it("does not clear a dispute through a correction or permit the claimant to resolve it", async () => {
    const initial = observation([work()]);
    const history = add(historyOf(initial), { type: "disputed", entityId: "time", expectedVersion: 1, disputeId: "dispute", reason: "Contested.", evidence: [] }, "founder");
    const observed = { ...initial, ledger: history };
    const input = correction(observed);
    const proposed = proposeContributionCorrection(await actor(), observed, input, NOW);
    if (proposed.status !== "proposed") throw new Error(proposed.message);
    const result = approveContributionCorrection(await actor("reviewer"), observed, proposed.proposal, approvedRequest(input), NOW);
    expect(result.status).toBe("preview");
    if (result.status !== "preview") throw new Error(result.message);
    const virtualAppend = previewContributionAppend(history, result.plan.event, history.revision, NOW);
    if (virtualAppend.status !== "preview") throw new Error(virtualAppend.message);
    expect(virtualAppend.projection.entities.find(state => state.entity.id === "time")?.disputes[0].resolution).toBeNull();
    refused(previewContributionSubmission(await actor(), observed, request(observed, {
      type: "dispute-resolved", entityId: "time", expectedVersion: 1, disputeId: "dispute", finding: "supported", reason: "Self cleared.", evidence: [PROOF],
    }), NOW));
    expect(previewContributionSubmission(await actor("head"), observed, request(observed, {
      type: "dispute-resolved", entityId: "time", expectedVersion: 1, disputeId: "dispute",
      finding: "not-supported", reason: "Independent adverse finding retained.", evidence: [PROOF],
    }), NOW).status).toBe("preview");
  });
});

describe("disclosure separation, operational evidence and idempotency model", () => {
  it("binds private disclosure to the subject and grants neither content nor evidence access", async () => {
    const observed = observation();
    const input = { purpose: "disclose-own", businessId: "org", personIds: ["employee"], expectedPolicyRevision: 4, expectedBindingRevision: 2 };
    const result = previewContributionDisclosure(await actor(), observed, input, NOW);
    expect(result).toMatchObject({ status: "disclosure-preview", mayDisclose: false, requiresFieldAndEvidenceChecks: true });
    refused(previewContributionDisclosure(await actor(), observed, { ...input, personIds: ["founder"] }, NOW));
    refused(previewContributionDisclosure(await actor(), observed, { ...input, purpose: "disclose-business-summary", businessId: "other-org" }, NOW));
    refused(previewContributionDisclosure(await actor(), observed, { ...input, expectedPolicyRevision: 3 }, NOW));
  });

  it.each(["Action", "Project"])("treats completed %s snapshots as context, never proof of time, quality or outcomes", kind => {
    const result = prepareOperationalContributionEvidence({
      kind, sourceId: kind === "Action" ? "action" : "project", businessId: "org", observedStatus: "Completed", snapshotEvidence: [WORK],
    }, refs(), NOW);
    expect(result).toMatchObject({
      status: "evidence-candidate", support: "operational-context-only", provesHours: false, provesQuality: false, provesOutcome: false, createsContribution: false,
    });
    frozen(result);
  });

  it("refuses source identity, hash, business and evidence-class substitutions", () => {
    const base = { kind: "Action", sourceId: "action", businessId: "org", observedStatus: "Completed", snapshotEvidence: [WORK] };
    for (const changed of [
      { ...base, sourceId: "invented" }, { ...base, businessId: "other-org" }, { ...base, snapshotEvidence: [PROOF] },
      { ...base, snapshotEvidence: [{ ...WORK, sha256: "d".repeat(64) }] }, { ...base, snapshotEvidence: [] },
    ]) refused(prepareOperationalContributionEvidence(changed, refs(), NOW));
  });

  it.each([
    ["in-flight", "wait-and-reconcile"], ["unknown", "wait-and-reconcile"],
    ["commit-confirmed", "replay-confirmed-receipt-after-verification"], ["rejected-no-write", "return-recorded-rejection"],
  ] as const)("models %s without writing or establishing durability", (status, action) => {
    const input = { scope: SCOPE, operationId: "operation", actorSubject: "user_employee", requestContent: "exact-canonical-content" };
    const result = reconcileContributionOperation(input, { ...input, status }, true);
    expect(result).toMatchObject({ status: "reconciliation-plan", action, mayWrite: false, establishesDurability: false });
    expect(reconcileContributionOperation({ ...input, requestContent: "changed" }, { ...input, status }, true)).toMatchObject({ action: "refuse-identity-reuse" });
    expect(reconcileContributionOperation({ ...input, actorSubject: "user_founder" }, { ...input, status }, true)).toMatchObject({ action: "refuse-identity-reuse" });
    expect(reconcileContributionOperation({ ...input, scope: { ...SCOPE, tenantId: "other" } }, { ...input, status }, true)).toMatchObject({ action: "refuse-identity-reuse" });
  });

  it("does not accept replay without fresh authority or turn an absent observation into permission to write", () => {
    const input = { scope: SCOPE, operationId: "operation", actorSubject: "user_employee", requestContent: "content" };
    refused(reconcileContributionOperation(input, null, false));
    expect(reconcileContributionOperation(input, null, true)).toMatchObject({ action: "reserve-under-transaction-lock", mayWrite: false });
    const malformedObservation: unknown = { ...input, status: "made-up" };
    // Inject an untrusted runtime payload to exercise the reconciler's own status validation.
    refused(reconcileContributionOperation(input, malformedObservation as ContributionOperationObservation, true));
  });
});
