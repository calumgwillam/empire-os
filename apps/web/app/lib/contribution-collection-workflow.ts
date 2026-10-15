import {
  CONTRIBUTION_SAFETY, contributionChoice, contributionCounter, contributionFields, contributionId, contributionList,
  contributionRefusal, decodeContributionEvidence, decodeContributionEventBody, decodeContributionScope, freezeContributionValue,
  previewContributionAppend, projectContributionLedger,
  type ContributionAuditEvent, type ContributionDomainRefusal, type ContributionEntityState,
  type ContributionLedger, type ContributionScope,
} from "./individual-contribution";
import {
  buildContributionPeriodReport, decodeContributionReferenceSnapshot,
  type ContributionReferenceSnapshot,
} from "./individual-contribution-reporting";
import {
  createServerPrincipalResolver, isAuthenticatedPrincipal,
  type AuthenticatedPrincipal, type ServerSessionResolution,
} from "./server-persistence-authority";

const PURPOSES = [
  "submit-own", "submit-on-behalf", "submit-result", "propose-allocation", "define-expectation",
  "corroborate-time", "review-result", "review-allocation", "review-expectation",
  "propose-correction", "approve-correction", "open-dispute", "resolve-dispute", "withdraw",
  "disclose-own", "disclose-business-summary", "disclose-evidence",
] as const;
export type ContributionCollectionPurpose = (typeof PURPOSES)[number];
export type ContributionCollectionAuthority = Readonly<{
  scope: ContributionScope;
  policyRevision: number;
  bindingRevision: number;
  checkedAtMs: number;
  validUntilMs: number;
  bindings: readonly Readonly<{ subject: string; personId: string; status: "active" | "revoked" }>[];
  grants: readonly Readonly<{
    subject: string; businessId: string; purposes: readonly ContributionCollectionPurpose[];
    personIds: readonly string[] | null;
  }>[];
}>;
export type ContributionCollectionObservation = Readonly<{
  authority: ContributionCollectionAuthority;
  ledger: unknown;
  references: unknown;
}>;
export type ContributionCollectionRequest = Readonly<{
  operationId: string;
  eventId: string;
  expectedPolicyRevision: number;
  expectedBindingRevision: number;
  expectedLedgerRevision: number;
  expectedHeadEventId: string | null;
  body: ContributionAuditEvent["body"];
}>;
export type ContributionCollectionPlan = Readonly<{
  operationId: string;
  scope: ContributionScope;
  actorSubject: string;
  actorPersonId: string;
  requestContent: string;
  policyRevision: number;
  bindingRevision: number;
  expectedLedgerRevision: number;
  expectedHeadEventId: string | null;
  expectedEntityVersions: readonly Readonly<{ entityId: string; version: number }>[];
  correctionApproval: Readonly<{
    proposerSubject: string; proposerPersonId: string; proposalOperationId: string;
    proposedAtMs: number; approvalSubject: string; approvalPersonId: string; approvedAtMs: number;
  }> | null;
  event: ContributionAuditEvent;
  effect: "append-preview-only";
  durable: false;
  requiresLockedRevalidation: true;
  limitations: readonly string[];
}> & typeof CONTRIBUTION_SAFETY;
type CorrectionBody = Extract<ContributionAuditEvent["body"], { type: "corrected" }>;
type Proposal = Readonly<{
  subject: string; personId: string; scope: ContributionScope;
  proposedAtMs: number; body: CorrectionBody; requested: ContributionCollectionRequest;
}>;
const correctionBrand: unique symbol = Symbol("correction-proposal");
export type ContributionCorrectionProposal = Readonly<{ [correctionBrand]: true }>;
const proposals = new WeakMap<ContributionCorrectionProposal, Proposal>();

function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function uniqueIds(value: unknown): string[] {
  const values = contributionList(value, contributionId);
  if (new Set(values).size !== values.length) throw new Error("Duplicate authority identities are ambiguous.");
  return values.sort();
}
function authority(value: unknown): ContributionCollectionAuthority {
  const item = contributionFields(value, ["scope", "policyRevision", "bindingRevision", "checkedAtMs", "validUntilMs", "bindings", "grants"]);
  const bindings = contributionList(item.bindings, value => {
    const binding = contributionFields(value, ["subject", "personId", "status"]);
    return {
      subject: contributionId(binding.subject), personId: contributionId(binding.personId),
      status: contributionChoice(binding.status, ["active", "revoked"]),
    };
  });
  if (new Set(bindings.map(binding => binding.subject)).size !== bindings.length
    || new Set(bindings.filter(binding => binding.status === "active").map(binding => binding.personId)).size
      !== bindings.filter(binding => binding.status === "active").length) {
    throw new Error("Subject/Person binding is ambiguous; account linking requires a separate governed process.");
  }
  const grants = contributionList(item.grants, value => {
    const grant = contributionFields(value, ["subject", "businessId", "purposes", "personIds"]);
    const purposes = contributionList(grant.purposes, purpose => contributionChoice(purpose, PURPOSES));
    if (new Set(purposes).size !== purposes.length) throw new Error("Duplicate collection purposes.");
    return {
      subject: contributionId(grant.subject), businessId: contributionId(grant.businessId), purposes,
      personIds: grant.personIds === null ? null : uniqueIds(grant.personIds),
    };
  });
  if (new Set(grants.map(grant => JSON.stringify([grant.subject, grant.businessId]))).size !== grants.length) {
    throw new Error("Duplicate collection grants.");
  }
  return {
    scope: decodeContributionScope(item.scope), policyRevision: contributionCounter(item.policyRevision),
    bindingRevision: contributionCounter(item.bindingRevision), checkedAtMs: contributionCounter(item.checkedAtMs),
    validUntilMs: contributionCounter(item.validUntilMs), bindings, grants,
  };
}
function request(value: unknown): ContributionCollectionRequest {
  const item = contributionFields(value, [
    "operationId", "eventId", "expectedPolicyRevision", "expectedBindingRevision", "expectedLedgerRevision", "expectedHeadEventId", "body",
  ]);
  return {
    operationId: contributionId(item.operationId), eventId: contributionId(item.eventId),
    expectedPolicyRevision: contributionCounter(item.expectedPolicyRevision), expectedBindingRevision: contributionCounter(item.expectedBindingRevision),
    expectedLedgerRevision: contributionCounter(item.expectedLedgerRevision),
    expectedHeadEventId: item.expectedHeadEventId === null ? null : contributionId(item.expectedHeadEventId),
    body: decodeContributionEventBody(item.body),
  };
}
type Context = Readonly<{
  policy: ContributionCollectionAuthority; personId: string; subject: string; references: ContributionReferenceSnapshot;
  ledger: ContributionLedger; states: readonly ContributionEntityState[]; nowMs: number;
}>;
function context(principal: AuthenticatedPrincipal, observation: ContributionCollectionObservation, nowMs: number): Context {
  if (!isAuthenticatedPrincipal(principal)) throw new Error("A server-minted authenticated principal is required.");
  contributionCounter(nowMs);
  const observed = contributionFields(observation, ["authority", "ledger", "references"]);
  const policy = authority(observed.authority);
  if (policy.checkedAtMs !== nowMs || policy.validUntilMs <= nowMs) throw new Error("A fresh non-expired server authority observation is required.");
  const binding = policy.bindings.find(binding => binding.subject === principal.subject && binding.status === "active");
  if (!binding) throw new Error("No active authenticated actor-to-Person binding.");
  const projected = projectContributionLedger(observed.ledger, nowMs);
  if (projected.status === "refused") throw new Error(projected.message);
  const references = decodeContributionReferenceSnapshot(observed.references);
  if (!same(policy.scope, projected.projection.scope) || !same(policy.scope, references.scope) || references.asOfMs !== nowMs
    || !references.people.some(person => person.id === binding.personId)) throw new Error("Scope, Person or reference snapshot binding is inconsistent.");
  if (policy.grants.some(grant => !references.businessIds.includes(grant.businessId)
    || (grant.personIds !== null && grant.personIds.some(id => !references.people.some(person => person.id === id))))) {
    throw new Error("Collection grants contain unresolved organisational identities.");
  }
  return {
    policy, personId: binding.personId, subject: principal.subject, nowMs, references,
    states: projected.projection.entities,
    ledger: { version: 1, scope: policy.scope, revision: projected.projection.sourceRevision, events: projected.projection.audit },
  };
}
function allowed(ctx: Context, purpose: ContributionCollectionPurpose, businessId: string, personIds: readonly string[]): boolean {
  return ctx.policy.grants.some(grant => grant.subject === ctx.subject && grant.businessId === businessId
    && grant.purposes.includes(purpose) && (grant.personIds === null || (personIds.length > 0 && personIds.every(id => grant.personIds?.includes(id)))));
}
function target(ctx: Context, body: ContributionAuditEvent["body"]) {
  const state = body.type === "created" ? undefined : ctx.states.find(state => state.entity.id === body.entityId);
  const entity = body.type === "created" ? body.entity : state?.entity;
  if (!entity) throw new Error("Contribution target is unavailable.");
  const result = entity.kind === "allocation" ? ctx.states.find(state => state.entity.id === entity.resultId)?.entity : null;
  const businessId = entity.kind === "allocation" ? result?.kind === "shared-result" ? result.businessId : null : entity.businessId;
  if (!businessId) throw new Error("Allocation result business is unresolved.");
  const values = [entity, ...(body.type === "corrected" ? [body.replacement] : [])];
  const resultIds = values.flatMap(entity => entity.kind === "shared-result" ? [entity.id] : entity.kind === "allocation" ? [entity.resultId]
    : entity.kind === "contribution" && "resultId" in entity.measure ? [entity.measure.resultId] : []);
  const historical = ctx.ledger.events.flatMap(event => {
    const value = event.body.type === "created" ? event.body.entity : event.body.type === "corrected" ? event.body.replacement : null;
    return value && (resultIds.includes(value.id) || (value.kind === "allocation" && resultIds.includes(value.resultId))
      || (value.kind === "contribution" && "resultId" in value.measure && resultIds.includes(value.measure.resultId))) ? [value] : [];
  });
  const dependencyIds = new Set([...resultIds, ...historical.map(value => value.id)]);
  const dependencies = ctx.states.filter(item => dependencyIds.has(item.entity.id));
  const interested = [...new Set([
    ...(state?.authorPersonIds ?? []), ...(state?.interestedPersonIds ?? []),
    ...dependencies.flatMap(item => [...item.authorPersonIds, ...item.interestedPersonIds]),
    ...historical.flatMap(value => value.kind === "contribution" ? [value.personId] : value.kind === "allocation" ? value.shares.map(share => share.personId) : []),
    ...values.flatMap(value => value.kind === "contribution" ? [value.personId] : value.kind === "allocation" ? value.shares.map(share => share.personId) : []),
  ])];
  const people = entity.kind === "contribution" ? [entity.personId] : [...new Set([
    ...values.flatMap(value => value.kind === "allocation" ? value.shares.map(share => share.personId) : []),
    ...dependencies.flatMap(item => item.entity.kind === "contribution" ? [item.entity.personId]
      : item.entity.kind === "allocation" ? item.entity.shares.map(share => share.personId) : []),
  ])];
  return { state, entity, businessId, people, interested, dependencies };
}
function purposeFor(ctx: Context, body: ContributionAuditEvent["body"]): ContributionCollectionPurpose {
  const { entity } = target(ctx, body);
  if (body.type === "created") return entity.kind === "contribution"
    ? entity.personId === ctx.personId ? "submit-own" : "submit-on-behalf"
    : entity.kind === "shared-result" ? "submit-result" : entity.kind === "allocation" ? "propose-allocation" : "define-expectation";
  if (body.type === "reviewed") return entity.kind === "shared-result" ? "review-result"
    : entity.kind === "allocation" ? "review-allocation" : "review-expectation";
  return body.type === "hours-corroborated" ? "corroborate-time" : body.type === "corrected" ? "propose-correction"
    : body.type === "disputed" ? "open-dispute" : body.type === "dispute-resolved" ? "resolve-dispute" : "withdraw";
}
function checkPermission(ctx: Context, body: ContributionAuditEvent["body"], purpose: ContributionCollectionPurpose,
  extraInterested: readonly string[] = []): void {
  const item = target(ctx, body);
  const interested = [...item.interested, ...extraInterested];
  const eventEvidence = body.type === "created" ? body.entity.evidence
    : body.type === "corrected" ? [...body.evidence, ...body.replacement.evidence] : body.evidence;
  for (const ref of eventEvidence) {
    const descriptor = ctx.references.evidence.find(item => item.id === ref.id && item.revision === ref.revision);
    if (!descriptor || descriptor.sha256 !== ref.sha256 || descriptor.recordedAtMs > ctx.nowMs || descriptor.availability !== "available"
      || !ctx.references.people.some(person => person.id === descriptor.custodianPersonId)) {
      throw new Error("New event evidence must resolve to available versioned descriptors.");
    }
  }
  if (!allowed(ctx, purpose, item.businessId, item.people)) throw new Error("Contribution operation is not authorised.");
  if (["corroborate-time", "review-result", "review-allocation", "review-expectation", "resolve-dispute", "approve-correction"].includes(purpose)) {
    if (interested.includes(ctx.personId)) throw new Error("Independent review cannot be performed by an interested actor, including founders.");
    if (!eventEvidence.some(ref => ctx.references.evidence.some(descriptor => descriptor.id === ref.id && descriptor.revision === ref.revision
      && descriptor.source !== "self-report" && !interested.includes(descriptor.custodianPersonId)))) {
      throw new Error("Independent review requires non-self-reported evidence from an unrelated custodian.");
    }
  }
}
function fences(ctx: Context, input: ContributionCollectionRequest): void {
  if (input.expectedPolicyRevision !== ctx.policy.policyRevision || input.expectedBindingRevision !== ctx.policy.bindingRevision
    || input.expectedLedgerRevision !== ctx.ledger.revision || input.expectedHeadEventId !== (ctx.ledger.events.at(-1)?.id ?? null)) {
    throw new Error("Stale policy, Person binding, ledger or head fence; no automatic rebase.");
  }
}
function plan(ctx: Context, input: ContributionCollectionRequest, body = input.body, correctionProposer?: Proposal): ContributionCollectionPlan {
  fences(ctx, input);
  const event: ContributionAuditEvent = {
    id: input.eventId, sequence: ctx.ledger.revision + 1, previousEventId: input.expectedHeadEventId,
    actorPersonId: ctx.personId, recordedAtMs: ctx.nowMs, body,
  };
  const preview = previewContributionAppend(ctx.ledger, event, ctx.ledger.revision, ctx.nowMs);
  if (preview.status === "refused") throw new Error(preview.message);
  const item = target(ctx, body);
  // Reference support is checked by the same Phase 1 report used by intelligence.
  if (ctx.nowMs >= Number.MAX_SAFE_INTEGER) throw new Error("No safe complete report boundary.");
  const evaluationPeriod = item.entity.kind === "expectation" ? item.entity.period : { startMs: 0, endMs: ctx.nowMs + 1 };
  const report = buildContributionPeriodReport(preview.ledger, ctx.references, evaluationPeriod, ctx.nowMs);
  if (report.status === "refused") throw new Error(report.message);
  const targetId = body.type === "created" ? body.entity.id : body.entityId;
  const targetIssues = report.report.issues.filter(issue => issue.entityId === targetId);
  const integrityIssues = new Set([
    "unknown-person", "unknown-business", "missing-or-unknown-role", "missing-or-unknown-department", "unknown-project", "unknown-action",
    "missing-evidence", "unresolved-evidence", "evidence-postdates-assertion", "evidence-not-available", "unknown-evidence-custodian",
    "unknown-audit-actor", "independent-evidence-not-established", "reviewer-conflict-of-interest", "resolver-conflict-of-interest",
    "unknown-reviewer", "unknown-corroborator", "overlapping-time-claims", "conflicting-hours-corroborations",
    "unknown-origin-action", "unknown-origin-project", "unknown-origin-financial-record",
    "unresolved-expectation-context", "unresolved-allocation-participant", "linked-result-withdrawn-or-disputed",
  ]);
  if (["created", "corrected", "hours-corroborated"].includes(body.type)
    && targetIssues.some(issue => integrityIssues.has(issue.code))) throw new Error("Submission/reference evidence or independent review is unsupported.");
  if (body.type === "reviewed" && body.decision === "approved") {
    const result = report.report.results.find(result => result.resultId === targetId);
    const allocation = item.entity.kind === "allocation" ? report.report.results.find(result => result.allocationId === targetId) : null;
    if ((item.entity.kind === "shared-result" && !result?.independentlyReviewed)
      || (item.entity.kind === "allocation" && allocation?.attributionStatus !== "reviewed")
      || (item.entity.kind === "expectation" && targetIssues.some(issue => [
        "expectation-not-independently-reviewed", "retrospective-expectation-or-review", "unresolved-expectation-context", "overlapping-expectations",
      ].includes(issue.code)))) throw new Error("Approval cannot establish support for a disputed, stale or unsupported target.");
  }
  const states = [...(item.state ? [item.state] : []), ...item.dependencies];
  return freezeContributionValue({
    ...CONTRIBUTION_SAFETY, operationId: input.operationId, scope: ctx.policy.scope, actorSubject: ctx.subject, actorPersonId: ctx.personId,
    requestContent: JSON.stringify({
      scope: ctx.policy.scope, actorSubject: ctx.subject, actorPersonId: ctx.personId, request: input,
      correctionProposer: correctionProposer ? {
        subject: correctionProposer.subject, personId: correctionProposer.personId,
        proposedAtMs: correctionProposer.proposedAtMs, request: correctionProposer.requested,
      } : null,
    }),
    policyRevision: ctx.policy.policyRevision, bindingRevision: ctx.policy.bindingRevision,
    expectedLedgerRevision: input.expectedLedgerRevision, expectedHeadEventId: input.expectedHeadEventId,
    expectedEntityVersions: [...new Map(states.map(state => [state.entity.id, { entityId: state.entity.id, version: state.version }])).values()]
      .sort((a, b) => a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0),
    correctionApproval: correctionProposer ? {
      proposerSubject: correctionProposer.subject, proposerPersonId: correctionProposer.personId,
      proposalOperationId: correctionProposer.requested.operationId, proposedAtMs: correctionProposer.proposedAtMs,
      approvalSubject: ctx.subject, approvalPersonId: ctx.personId, approvedAtMs: ctx.nowMs,
    } : null,
    event, effect: "append-preview-only", durable: false, requiresLockedRevalidation: true,
    limitations: ["not-a-write-or-commit-receipt", "server-transaction-must-recheck-all-authority-and-version-fences",
      "request-content-requires-server-canonical-hash-and-atomic-idempotency-before-storage",
      ...(correctionProposer ? ["correction-proposal-and-approval-must-be-atomically-retained-in-separate-durable-audit"] : [])],
  });
}
export function previewContributionSubmission(principal: AuthenticatedPrincipal, observation: ContributionCollectionObservation,
  value: unknown, nowMs: number):
  | Readonly<{ status: "preview"; plan: ContributionCollectionPlan }> & typeof CONTRIBUTION_SAFETY
  | ContributionDomainRefusal {
  try {
    const ctx = context(principal, observation, nowMs);
    const input = request(value);
    if (input.body.type === "corrected") throw new Error("Corrections require a separately authenticated proposal and approval.");
    checkPermission(ctx, input.body, purposeFor(ctx, input.body));
    return freezeContributionValue({ status: "preview", ...CONTRIBUTION_SAFETY, plan: plan(ctx, input) });
  } catch (error) {
    return contributionRefusal(`Contribution submission refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}
export function proposeContributionCorrection(principal: AuthenticatedPrincipal, observation: ContributionCollectionObservation,
  value: unknown, nowMs: number):
  | Readonly<{ status: "proposed"; proposal: ContributionCorrectionProposal; durable: false }> & typeof CONTRIBUTION_SAFETY
  | ContributionDomainRefusal {
  try {
    const ctx = context(principal, observation, nowMs);
    const input = request(value);
    if (input.body.type !== "corrected") throw new Error("An exact correction body is required.");
    checkPermission(ctx, input.body, "propose-correction");
    plan(ctx, input);
    const proposal: ContributionCorrectionProposal = Object.freeze({ [correctionBrand]: true });
    proposals.set(proposal, freezeContributionValue({
      subject: ctx.subject, personId: ctx.personId, scope: ctx.policy.scope, proposedAtMs: ctx.nowMs, body: input.body, requested: input,
    }));
    return Object.freeze({ status: "proposed", ...CONTRIBUTION_SAFETY, durable: false, proposal });
  } catch (error) {
    return contributionRefusal(`Correction proposal refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}
export function approveContributionCorrection(principal: AuthenticatedPrincipal, observation: ContributionCollectionObservation,
  proposal: ContributionCorrectionProposal, approvalRequest: unknown, nowMs: number):
  | Readonly<{ status: "preview"; plan: ContributionCollectionPlan }> & typeof CONTRIBUTION_SAFETY
  | ContributionDomainRefusal {
  try {
    const ctx = context(principal, observation, nowMs);
    const proposed = proposals.get(proposal);
    if (!proposed || !same(proposed.scope, ctx.policy.scope) || proposed.subject === ctx.subject || proposed.personId === ctx.personId
      || proposed.proposedAtMs > ctx.nowMs) {
      throw new Error("A separate authenticated independent approver and original proposal are required.");
    }
    const input = request(approvalRequest);
    if (input.operationId === proposed.requested.operationId || input.eventId === proposed.requested.eventId) {
      throw new Error("Proposal and approval require separate operation and event identities.");
    }
    if (!same(input.body, proposed.body)) throw new Error("Approval cannot amend the proposed correction.");
    if (input.expectedLedgerRevision !== proposed.requested.expectedLedgerRevision
      || input.expectedPolicyRevision !== proposed.requested.expectedPolicyRevision
      || input.expectedBindingRevision !== proposed.requested.expectedBindingRevision
      || input.expectedHeadEventId !== proposed.requested.expectedHeadEventId) throw new Error("Proposal fences changed; propose again after reconciliation.");
    const proposerBinding = ctx.policy.bindings.find(binding => binding.subject === proposed.subject && binding.personId === proposed.personId && binding.status === "active");
    if (!proposerBinding) throw new Error("Correction proposer binding was revoked.");
    checkPermission({ ...ctx, subject: proposed.subject, personId: proposed.personId }, proposed.body, "propose-correction");
    checkPermission(ctx, input.body, "approve-correction", [proposed.personId]);
    return freezeContributionValue({
      status: "preview", ...CONTRIBUTION_SAFETY, plan: plan(ctx, input, proposed.body, proposed),
    });
  } catch (error) {
    return contributionRefusal(`Correction approval refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function previewContributionDisclosure(principal: AuthenticatedPrincipal, observation: ContributionCollectionObservation,
  value: unknown, nowMs: number):
  | Readonly<{ status: "disclosure-preview"; purpose: ContributionCollectionPurpose; businessId: string; personIds: readonly string[];
      mayDisclose: false; requiresFieldAndEvidenceChecks: true }> & typeof CONTRIBUTION_SAFETY
  | ContributionDomainRefusal {
  try {
    const ctx = context(principal, observation, nowMs);
    const item = contributionFields(value, ["purpose", "businessId", "personIds", "expectedPolicyRevision", "expectedBindingRevision"]);
    const purpose = contributionChoice(item.purpose, ["disclose-own", "disclose-business-summary", "disclose-evidence"]);
    const businessId = contributionId(item.businessId);
    const personIds = uniqueIds(item.personIds);
    if (contributionCounter(item.expectedPolicyRevision) !== ctx.policy.policyRevision
      || contributionCounter(item.expectedBindingRevision) !== ctx.policy.bindingRevision) throw new Error("Stale disclosure authority.");
    if (purpose === "disclose-own" && (personIds.length !== 1 || personIds[0] !== ctx.personId)) throw new Error("Private disclosure must bind the authenticated subject.");
    if (!allowed(ctx, purpose, businessId, personIds) || personIds.some(id => !ctx.references.people.some(person => person.id === id))) {
      throw new Error("Contribution disclosure is not authorised.");
    }
    return freezeContributionValue({
      status: "disclosure-preview", ...CONTRIBUTION_SAFETY, purpose, businessId, personIds, mayDisclose: false, requiresFieldAndEvidenceChecks: true,
    });
  } catch (error) {
    return contributionRefusal(`Disclosure preview refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export type ContributionCollectionDependencies = Readonly<{
  resolveSession(request: Request): Promise<ServerSessionResolution>;
  // Trusted server loader only: must freshly resolve binding, policy, complete ledger
  // and evidence descriptors consistently. No adapter or default loader is installed.
  observe(principal: AuthenticatedPrincipal): Promise<Readonly<{ observation: ContributionCollectionObservation; nowMs: number }>>;
}>;
export function createContributionCollectionPreviewAuthority(dependencies: ContributionCollectionDependencies) {
  const resolve = createServerPrincipalResolver(dependencies.resolveSession);
  async function execute<T>(request: Request, operation: (principal: AuthenticatedPrincipal, observed: ContributionCollectionObservation, nowMs: number) => T) {
    const principal = await resolve(request);
    if (!isAuthenticatedPrincipal(principal)) return contributionRefusal("Verified contribution authentication is unavailable.");
    try {
      const loaded = await dependencies.observe(principal);
      return operation(principal, loaded.observation, loaded.nowMs);
    } catch {
      return contributionRefusal("Trusted contribution authority observation is unavailable; nothing was submitted.");
    }
  }
  return Object.freeze({
    preview(request: Request, input: unknown) {
      return execute(request, (principal, observed, nowMs) => previewContributionSubmission(principal, observed, input, nowMs));
    },
    proposeCorrection(request: Request, input: unknown) {
      return execute(request, (principal, observed, nowMs) => proposeContributionCorrection(principal, observed, input, nowMs));
    },
    approveCorrection(request: Request, proposal: ContributionCorrectionProposal, input: unknown) {
      return execute(request, (principal, observed, nowMs) => approveContributionCorrection(principal, observed, proposal, input, nowMs));
    },
    previewDisclosure(request: Request, input: unknown) {
      return execute(request, (principal, observed, nowMs) => previewContributionDisclosure(principal, observed, input, nowMs));
    },
  });
}

export type ContributionOperationObservation = Readonly<{
  scope: ContributionScope; operationId: string; actorSubject: string; requestContent: string;
  status: "in-flight" | "commit-confirmed" | "rejected-no-write" | "unknown";
}>;
export function prepareOperationalContributionEvidence(value: unknown, referencesValue: unknown, nowMs: number) {
  try {
    contributionCounter(nowMs);
    const item = contributionFields(value, ["kind", "sourceId", "businessId", "snapshotEvidence", "observedStatus"]);
    const kind = contributionChoice(item.kind, ["Action", "Project"]);
    const sourceId = contributionId(item.sourceId);
    const businessId = contributionId(item.businessId);
    const observedStatus = contributionId(item.observedStatus);
    const evidence = decodeContributionEvidence(item.snapshotEvidence);
    const references = decodeContributionReferenceSnapshot(referencesValue);
    if (references.asOfMs !== nowMs || evidence.length !== 1
      || !(kind === "Action" ? references.actions : references.projects).some(ref => ref.id === sourceId && ref.businessId === businessId)) {
      throw new Error("An explicit business-scoped operational source and one immutable snapshot reference are required.");
    }
    const descriptor = references.evidence.find(ref => ref.id === evidence[0].id && ref.revision === evidence[0].revision);
    if (!descriptor || descriptor.sha256 !== evidence[0].sha256 || descriptor.source !== "work-record"
      || descriptor.availability !== "available" || descriptor.recordedAtMs > nowMs
      || !references.people.some(person => person.id === descriptor.custodianPersonId)) throw new Error("Operational snapshot evidence is unresolved.");
    return freezeContributionValue({
      status: "evidence-candidate" as const, ...CONTRIBUTION_SAFETY, scope: references.scope,
      source: { kind, sourceId, businessId, observedStatus }, evidence,
      support: "operational-context-only" as const, provesHours: false as const, provesQuality: false as const,
      provesOutcome: false as const, createsContribution: false as const,
      requirements: [
        "server-authorised-source-read-and-immutable-snapshot-content-hash-verification",
        "explicit-source-version-occurrence-and-canonical-result-origin-review",
        "status-and-owner-labels-are-assertions-not-independent-corroboration",
        "no-person-name-matching-or-automatic-hours-outcome-or-allocation-import",
      ],
    });
  } catch (error) {
    return contributionRefusal(`Operational evidence refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Pure reconciliation model. Observations must come from a future locked server registry. */
export function reconcileContributionOperation(
  request: Readonly<{ scope: ContributionScope; operationId: string; actorSubject: string; requestContent: string }>, observation: ContributionOperationObservation | null,
  currentAuthorityRechecked: boolean,
) {
  try {
    const candidate = contributionFields(request, ["scope", "operationId", "actorSubject", "requestContent"]);
    const scope = decodeContributionScope(candidate.scope);
    const operationId = contributionId(candidate.operationId);
    const actorSubject = contributionId(candidate.actorSubject);
    if (typeof candidate.requestContent !== "string" || candidate.requestContent.length === 0) throw new Error("Exact canonical request content is required.");
    if (currentAuthorityRechecked !== true) throw new Error("Fresh authority checks are required even for replay.");
    let action: "reserve-under-transaction-lock" | "replay-confirmed-receipt-after-verification" | "return-recorded-rejection"
      | "wait-and-reconcile" | "refuse-identity-reuse" = "reserve-under-transaction-lock";
    if (observation !== null) {
      const stored = contributionFields(observation, ["scope", "operationId", "actorSubject", "requestContent", "status"]);
      const status = contributionChoice(stored.status, ["in-flight", "commit-confirmed", "rejected-no-write", "unknown"]);
      if (!same(decodeContributionScope(stored.scope), scope)
        || contributionId(stored.operationId) !== operationId || contributionId(stored.actorSubject) !== actorSubject
        || stored.requestContent !== candidate.requestContent) action = "refuse-identity-reuse";
      else action = status === "commit-confirmed" ? "replay-confirmed-receipt-after-verification"
        : status === "rejected-no-write" ? "return-recorded-rejection" : "wait-and-reconcile";
    }
    return Object.freeze({
      status: "reconciliation-plan" as const, ...CONTRIBUTION_SAFETY, action, mayWrite: false as const,
      establishesDurability: false as const, requiresAuthoritativeReceiptValidation: true as const,
    });
  } catch (error) {
    return contributionRefusal(`Operation reconciliation refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}
