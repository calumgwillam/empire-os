import type { ResponsibilityContributionMode } from "./founder-intelligence";
import { OPERATING_PILLARS, type OperatingPillarId } from "./pillar-identity";
import { isCounter, isObject, isSha256 } from "./server-persistence-contract";

export const CONTRIBUTION_DOMAIN_VERSION = 1;
export const CONTRIBUTION_SAFETY = Object.freeze({
  productionActivationAllowed: false as const,
  changesEquity: false as const, changesCompensation: false as const,
  changesEmploymentStatus: false as const, changesAuthority: false as const,
});
export type ContributionScope = Readonly<{ tenantId: string; datasetId: string }>;
export type ContributionPeriod = Readonly<{ startMs: number; endMs: number }>;
export type ContributionEvidenceReference = Readonly<{ id: string; revision: number; sha256: string }>;
export type ContributionCategory = "delivery" | "leadership" | "systems" | "learning" | "customer" | "financial" | "support";
export type ContributionMeasure =
  | Readonly<{ kind: "hours"; reportedMinutes: number }>
  | Readonly<{ kind: "deliverable" | "outcome" | "financial"; resultId: string }>
  | Readonly<{ kind: "quality"; criteria: string; assessment: "meets" | "exceeds" | "needs-improvement" | "not-assessed" }>
  | Readonly<{ kind: "initiative"; description: string }>;
export type ContributionRecord = Readonly<{
  kind: "contribution";
  id: string;
  personId: string;
  businessId: string;
  roleId: string | null;
  departmentId: string | null;
  projectId: string | null;
  actionId: string | null;
  pillarId: OperatingPillarId | null;
  category: ContributionCategory;
  participation: ResponsibilityContributionMode;
  period: ContributionPeriod;
  measure: ContributionMeasure;
  evidence: readonly ContributionEvidenceReference[];
}>;
export type ContributionMoney = Readonly<{
  currency: string;
  minorUnitScale: number;
  amountMinor: number;
  financialKind: "revenue" | "cost" | "cost-saving" | "capital-contributed" | "loss-avoided";
  basis: "recorded" | "reported" | "estimated";
}>;
export type SharedContributionResult = Readonly<{
  kind: "shared-result";
  id: string;
  businessId: string;
  resultKind: "deliverable" | "outcome" | "financial";
  origin: Readonly<{ type: "Action" | "Project" | "Finance" | "Manual"; id: string; resultKey: string }>;
  occurredAtMs: number;
  description: string;
  money: ContributionMoney | null;
  evidence: readonly ContributionEvidenceReference[];
}>;
export type ContributionAllocation = Readonly<{
  kind: "allocation";
  id: string;
  resultId: string;
  resultVersion: number;
  participationVersions: readonly Readonly<{ entityId: string; version: number }>[];
  shares: readonly Readonly<{ personId: string; basisPoints: number }>[];
  rationale: string;
  evidence: readonly ContributionEvidenceReference[];
}>;
export type ContributionExpectationDimension =
  | "reported-minutes" | "corroborated-minutes" | "deliverable-participations"
  | "outcome-participations" | "initiative" | "quality" | "financial";
export type ContributionExpectation = Readonly<{
  kind: "expectation";
  id: string;
  businessId: string;
  roleId: string;
  departmentId: string | null;
  period: ContributionPeriod;
  criteria: readonly Readonly<{
    id: string; dimension: ContributionExpectationDimension; statement: string; minimum: number | null;
  }>[];
  evidence: readonly ContributionEvidenceReference[];
}>;
export type ContributionEntity = ContributionRecord | SharedContributionResult | ContributionAllocation | ContributionExpectation;
type EventBody =
  | Readonly<{ type: "created"; entity: ContributionEntity }>
  | Readonly<{
    type: "corrected"; entityId: string; expectedVersion: number; replacement: ContributionEntity;
    reason: string; evidence: readonly ContributionEvidenceReference[];
  }>
  | Readonly<{
    type: "disputed"; entityId: string; expectedVersion: number; disputeId: string;
    reason: string; evidence: readonly ContributionEvidenceReference[];
  }>
  | Readonly<{
    type: "dispute-resolved"; entityId: string; expectedVersion: number; disputeId: string;
    finding: "supported" | "not-supported"; reason: string; evidence: readonly ContributionEvidenceReference[];
  }>
  | Readonly<{
    type: "reviewed"; entityId: string; expectedVersion: number; decision: "approved" | "rejected";
    reason: string; evidence: readonly ContributionEvidenceReference[];
  }>
  | Readonly<{
    type: "hours-corroborated"; entityId: string; expectedVersion: number; minutes: number;
    evidence: readonly ContributionEvidenceReference[];
  }>
  | Readonly<{
    type: "withdrawn"; entityId: string; expectedVersion: number;
    reason: string; evidence: readonly ContributionEvidenceReference[];
  }>;
export type ContributionAuditEvent = Readonly<{
  id: string;
  sequence: number;
  previousEventId: string | null;
  actorPersonId: string;
  recordedAtMs: number;
  body: EventBody;
}>;
export type ContributionLedger = Readonly<{
  version: typeof CONTRIBUTION_DOMAIN_VERSION;
  scope: ContributionScope;
  revision: number;
  events: readonly ContributionAuditEvent[];
}>;
export type ContributionReviewEvent = ContributionAuditEvent & Readonly<{
  body: Extract<EventBody, { type: "reviewed" }>;
}>;
export type ContributionCorroborationEvent = ContributionAuditEvent & Readonly<{
  body: Extract<EventBody, { type: "hours-corroborated" }>;
}>;
export type ContributionDispute = Readonly<{
  id: string; openedByPersonId: string; openedAtMs: number; version: number;
  resolution: Readonly<{ finding: "supported" | "not-supported"; version: number; eventId: string }> | null;
}>;
export type ContributionEntityState = Readonly<{
  entity: ContributionEntity;
  version: number;
  createdByPersonId: string;
  authorPersonIds: readonly string[];
  interestedPersonIds: readonly string[];
  createdAtMs: number;
  updatedAtMs: number;
  withdrawnAtMs: number | null;
  eventIds: readonly string[];
  reviews: readonly ContributionReviewEvent[];
  corroborations: readonly ContributionCorroborationEvent[];
  disputes: readonly ContributionDispute[];
}>;
export type ContributionProjection = Readonly<{
  scope: ContributionScope;
  sourceRevision: number;
  observedRevision: number;
  asOfMs: number;
  entities: readonly ContributionEntityState[];
  audit: readonly ContributionAuditEvent[];
}>;
export type ContributionDomainRefusal = Readonly<{
  status: "refused"; message: string;
}> & typeof CONTRIBUTION_SAFETY;

export function contributionRefusal(message: string): ContributionDomainRefusal {
  return Object.freeze({ status: "refused", ...CONTRIBUTION_SAFETY, message });
}
export function freezeContributionValue<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeContributionValue);
    Object.freeze(value);
  }
  return value;
}
export function contributionFields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isObject(value) || Reflect.ownKeys(value).length !== keys.length) throw new Error("Incomplete or unsupported contribution data shape.");
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new Error("Contribution data must contain own data fields, not accessors.");
    result[key] = descriptor.value;
  }
  return result;
}
export function contributionList<T>(value: unknown, decode: (entry: unknown) => T): T[] {
  if (!Array.isArray(value) || Reflect.ownKeys(value).length !== value.length + 1) throw new Error("A dense data-only contribution list is required.");
  const result: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) throw new Error("Sparse/accessor contribution lists are unsupported.");
    result.push(decode(descriptor.value));
  }
  return result;
}
export function contributionId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 512 || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("A stable nonblank contribution/reference identity is required.");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 16_384) throw new Error("A nonblank bounded explanation is required.");
  return value;
}
export function contributionCounter(value: unknown): number {
  if (!isCounter(value)) throw new Error("A nonnegative safe integer is required.");
  return value;
}
function positive(value: unknown): number {
  const result = contributionCounter(value);
  if (result === 0) throw new Error("A positive version or sequence is required.");
  return result;
}
export function contributionChoice<const T extends string>(value: unknown, choices: readonly T[]): T {
  const result = choices.find(choice => choice === value);
  if (result === undefined) throw new Error("Unsupported contribution classification.");
  return result;
}
function nullableId(value: unknown): string | null { return value === null ? null : contributionId(value); }
export function decodeContributionScope(value: unknown): ContributionScope {
  const item = contributionFields(value, ["tenantId", "datasetId"]);
  return { tenantId: contributionId(item.tenantId), datasetId: contributionId(item.datasetId) };
}
export function decodeContributionPeriod(value: unknown): ContributionPeriod {
  const item = contributionFields(value, ["startMs", "endMs"]);
  const result = { startMs: contributionCounter(item.startMs), endMs: contributionCounter(item.endMs) };
  if (result.startMs >= result.endMs) throw new Error("Periods are nonempty half-open intervals [startMs, endMs).");
  return result;
}
export function decodeContributionEvidence(value: unknown): readonly ContributionEvidenceReference[] {
  const result = contributionList(value, entry => {
    const item = contributionFields(entry, ["id", "revision", "sha256"]);
    if (!isSha256(item.sha256)) throw new Error("Evidence requires an exact revision and SHA-256 fingerprint.");
    return { id: contributionId(item.id), revision: positive(item.revision), sha256: item.sha256 };
  });
  const keys = result.map(ref => JSON.stringify([ref.id, ref.revision]));
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate/contradictory evidence references are not independent evidence.");
  return result;
}
function measure(value: unknown): ContributionMeasure {
  const kind = dataTag(value, "kind");
  if (kind === "hours") {
    const item = contributionFields(value, ["kind", "reportedMinutes"]);
    return { kind, reportedMinutes: contributionCounter(item.reportedMinutes) };
  }
  if (kind === "deliverable" || kind === "outcome" || kind === "financial") {
    const item = contributionFields(value, ["kind", "resultId"]);
    return { kind, resultId: contributionId(item.resultId) };
  }
  if (kind === "quality") {
    const item = contributionFields(value, ["kind", "criteria", "assessment"]);
    return {
      kind, criteria: text(item.criteria),
      assessment: contributionChoice(item.assessment, ["meets", "exceeds", "needs-improvement", "not-assessed"]),
    };
  }
  if (kind === "initiative") {
    const item = contributionFields(value, ["kind", "description"]);
    return { kind, description: text(item.description) };
  }
  throw new Error("Unsupported contribution measure; dimensions cannot be silently converted.");
}
function dataTag(value: unknown, key: string): unknown {
  if (!isObject(value)) throw new Error("An own data discriminator is required.");
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) throw new Error("Accessors are not contribution discriminators.");
  return descriptor.value;
}
function money(value: unknown): ContributionMoney {
  const item = contributionFields(value, ["currency", "minorUnitScale", "amountMinor", "financialKind", "basis"]);
  if (typeof item.currency !== "string" || !/^[A-Z]{3}$/.test(item.currency)) throw new Error("An explicit three-letter currency is required; no default or conversion is supplied.");
  const scale = contributionCounter(item.minorUnitScale);
  if (scale > 6) throw new Error("Unsupported explicit currency minor-unit scale.");
  return {
    currency: item.currency, minorUnitScale: scale, amountMinor: contributionCounter(item.amountMinor),
    financialKind: contributionChoice(item.financialKind, ["revenue", "cost", "cost-saving", "capital-contributed", "loss-avoided"]),
    basis: contributionChoice(item.basis, ["recorded", "reported", "estimated"]),
  };
}
function entity(value: unknown): ContributionEntity {
  const kind = dataTag(value, "kind");
  if (kind === "contribution") {
    const item = contributionFields(value, [
      "kind", "id", "personId", "businessId", "roleId", "departmentId", "projectId", "actionId",
      "pillarId", "category", "participation", "period", "measure", "evidence",
    ]);
    const period = decodeContributionPeriod(item.period);
    const measurement = measure(item.measure);
    if (measurement.kind === "hours" && measurement.reportedMinutes > Math.floor((period.endMs - period.startMs) / 60_000)) {
      throw new Error("Reported minutes exceed the record's elapsed interval.");
    }
    return {
      kind, id: contributionId(item.id), personId: contributionId(item.personId), businessId: contributionId(item.businessId),
      roleId: nullableId(item.roleId), departmentId: nullableId(item.departmentId),
      projectId: nullableId(item.projectId), actionId: nullableId(item.actionId),
      pillarId: item.pillarId === null ? null : contributionChoice(item.pillarId, OPERATING_PILLARS.map(pillar => pillar.id)),
      category: contributionChoice(item.category, ["delivery", "leadership", "systems", "learning", "customer", "financial", "support"]),
      participation: contributionChoice(item.participation, ["owner", "lead", "executor", "contributor", "support", "reviewer"]),
      period, measure: measurement, evidence: decodeContributionEvidence(item.evidence),
    };
  }
  if (kind === "shared-result") {
    const item = contributionFields(value, ["kind", "id", "businessId", "resultKind", "origin", "occurredAtMs", "description", "money", "evidence"]);
    const origin = contributionFields(item.origin, ["type", "id", "resultKey"]);
    const resultKind = contributionChoice(item.resultKind, ["deliverable", "outcome", "financial"]);
    if ((resultKind === "financial") !== (item.money !== null)) throw new Error("Only financial results require a separately classified money measure.");
    return {
      kind, id: contributionId(item.id), businessId: contributionId(item.businessId), resultKind,
      origin: {
        type: contributionChoice(origin.type, ["Action", "Project", "Finance", "Manual"]),
        id: contributionId(origin.id), resultKey: contributionId(origin.resultKey),
      },
      occurredAtMs: contributionCounter(item.occurredAtMs), description: text(item.description),
      money: item.money === null ? null : money(item.money), evidence: decodeContributionEvidence(item.evidence),
    };
  }
  if (kind === "allocation") {
    const item = contributionFields(value, ["kind", "id", "resultId", "resultVersion", "participationVersions", "shares", "rationale", "evidence"]);
    const participationVersions = contributionList(item.participationVersions, entry => {
      const reference = contributionFields(entry, ["entityId", "version"]);
      return { entityId: contributionId(reference.entityId), version: positive(reference.version) };
    });
    if (new Set(participationVersions.map(reference => reference.entityId)).size !== participationVersions.length) {
      throw new Error("Allocation participation versions must be unique.");
    }
    const shares = contributionList(item.shares, entry => {
      const share = contributionFields(entry, ["personId", "basisPoints"]);
      const basisPoints = positive(share.basisPoints);
      if (basisPoints > 10_000) throw new Error("An allocation share cannot exceed 100%.");
      return { personId: contributionId(share.personId), basisPoints };
    });
    if (new Set(shares.map(share => share.personId)).size !== shares.length
      || shares.reduce((sum, share) => sum + share.basisPoints, 0) > 10_000) throw new Error("Unique participant shares must total at most 100%.");
    return {
      kind, id: contributionId(item.id), resultId: contributionId(item.resultId), resultVersion: positive(item.resultVersion),
      participationVersions, shares, rationale: text(item.rationale), evidence: decodeContributionEvidence(item.evidence),
    };
  }
  if (kind === "expectation") {
    const item = contributionFields(value, ["kind", "id", "businessId", "roleId", "departmentId", "period", "criteria", "evidence"]);
    const criteria = contributionList(item.criteria, entry => {
      const criterion = contributionFields(entry, ["id", "dimension", "statement", "minimum"]);
      const dimension = contributionChoice(criterion.dimension, [
        "reported-minutes", "corroborated-minutes", "deliverable-participations", "outcome-participations", "initiative", "quality", "financial",
      ]);
      if ((dimension === "quality" || dimension === "financial") && criterion.minimum !== null) {
        throw new Error("Quality and financial expectations require contextual human review, not a scalar target.");
      }
      return {
        id: contributionId(criterion.id), dimension, statement: text(criterion.statement),
        minimum: criterion.minimum === null ? null : contributionCounter(criterion.minimum),
      };
    });
    if (criteria.length === 0 || new Set(criteria.map(criterion => criterion.id)).size !== criteria.length) throw new Error("Unique explicit expectation criteria are required.");
    return {
      kind, id: contributionId(item.id), businessId: contributionId(item.businessId), roleId: contributionId(item.roleId),
      departmentId: nullableId(item.departmentId), period: decodeContributionPeriod(item.period),
      criteria, evidence: decodeContributionEvidence(item.evidence),
    };
  }
  throw new Error("Unsupported contribution entity.");
}
export function decodeContributionEventBody(value: unknown): ContributionAuditEvent["body"] {
  const type = dataTag(value, "type");
  if (type === "created") {
    const item = contributionFields(value, ["type", "entity"]);
    return { type, entity: entity(item.entity) };
  }
  const keys = type === "corrected" ? ["replacement", "reason", "evidence"]
    : type === "disputed" ? ["disputeId", "reason", "evidence"]
      : type === "dispute-resolved" ? ["disputeId", "finding", "reason", "evidence"]
        : type === "reviewed" ? ["decision", "reason", "evidence"]
          : type === "hours-corroborated" ? ["minutes", "evidence"]
            : type === "withdrawn" ? ["reason", "evidence"] : null;
  if (!keys) throw new Error("Unsupported audit event.");
  const item = contributionFields(value, ["type", "entityId", "expectedVersion", ...keys]);
  const common = {
    entityId: contributionId(item.entityId), expectedVersion: positive(item.expectedVersion),
    evidence: decodeContributionEvidence(item.evidence),
  };
  if (type === "corrected") return { type, ...common, replacement: entity(item.replacement), reason: text(item.reason) };
  if (type === "disputed") return { type, ...common, disputeId: contributionId(item.disputeId), reason: text(item.reason) };
  if (type === "dispute-resolved") return {
    type, ...common, disputeId: contributionId(item.disputeId),
    finding: contributionChoice(item.finding, ["supported", "not-supported"]), reason: text(item.reason),
  };
  if (type === "reviewed") return {
    type, ...common, decision: contributionChoice(item.decision, ["approved", "rejected"]), reason: text(item.reason),
  };
  if (type === "withdrawn") {
    if (common.evidence.length === 0) throw new Error("Withdrawal must preserve evidence and a reason; deletion is not supported.");
    return { type, ...common, reason: text(item.reason) };
  }
  return { type: "hours-corroborated", ...common, minutes: contributionCounter(item.minutes) };
}
function auditEvent(value: unknown): ContributionAuditEvent {
  const item = contributionFields(value, ["id", "sequence", "previousEventId", "actorPersonId", "recordedAtMs", "body"]);
  return {
    id: contributionId(item.id), sequence: positive(item.sequence), previousEventId: nullableId(item.previousEventId),
    actorPersonId: contributionId(item.actorPersonId), recordedAtMs: contributionCounter(item.recordedAtMs), body: decodeContributionEventBody(item.body),
  };
}
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function verifyEntityTime(value: ContributionEntity, atMs: number): void {
  if ((value.kind === "contribution" && value.period.endMs > atMs)
    || (value.kind === "shared-result" && value.occurredAtMs > atMs)) throw new Error("Observed work/results cannot be recorded before they occurred.");
}
function sameIdentity(before: ContributionEntity, after: ContributionEntity): boolean {
  if (before.kind !== after.kind || before.id !== after.id) return false;
  if (before.kind === "contribution" && after.kind === "contribution") return before.personId === after.personId
    && before.businessId === after.businessId && before.measure.kind === after.measure.kind;
  if (before.kind === "shared-result" && after.kind === "shared-result") return before.businessId === after.businessId
    && before.resultKind === after.resultKind && same(before.origin, after.origin);
  if (before.kind === "allocation" && after.kind === "allocation") return before.resultId === after.resultId;
  if (before.kind === "expectation" && after.kind === "expectation") return before.businessId === after.businessId
    && before.roleId === after.roleId && before.departmentId === after.departmentId && same(before.period, after.period);
  return false;
}
function interestedPeople(value: ContributionEntity): readonly string[] {
  return value.kind === "contribution" ? [value.personId] : value.kind === "allocation" ? value.shares.map(share => share.personId) : [];
}
function verifyLinks(value: ContributionEntity, states: ReadonlyMap<string, ContributionEntityState>): void {
  if (value.kind === "allocation") {
    const result = states.get(value.resultId);
    if (!result || result.entity.kind !== "shared-result" || result.withdrawnAtMs !== null
      || result.version !== value.resultVersion) throw new Error("Allocation requires the exact current authoritative result version.");
    const boundParticipation = value.participationVersions.map(reference => {
      const state = states.get(reference.entityId);
      if (!state || state.version !== reference.version || state.withdrawnAtMs !== null
        || state.entity.kind !== "contribution" || !("resultId" in state.entity.measure)
        || state.entity.measure.resultId !== value.resultId) throw new Error("Allocation must bind exact current participation versions for this result.");
      return state.entity;
    });
    for (const share of value.shares) {
      if (!boundParticipation.some(record => record.personId === share.personId)) {
        throw new Error("Allocation beneficiaries require explicit version-bound participation, never inferred equal shares.");
      }
    }
  }
  if (value.kind === "contribution" && "resultId" in value.measure) {
    const state = states.get(value.measure.resultId);
    const result = state?.entity;
    if (!result || state?.withdrawnAtMs !== null || result.kind !== "shared-result" || result.businessId !== value.businessId || result.resultKind !== value.measure.kind) {
      throw new Error("Participation must reference one matching result in the same business.");
    }
  }
}
function replay(events: readonly ContributionAuditEvent[]): ContributionEntityState[] {
  const states = new Map<string, ContributionEntityState>();
  const origins = new Set<string>();
  const allocatedResults = new Set<string>();
  const disputes = new Set<string>();
  for (const event of events) {
    const body = event.body;
    if (body.type === "created") {
      const value = body.entity;
      if (states.has(value.id)) throw new Error("Entity identity cannot be reused or overwritten.");
      verifyEntityTime(value, event.recordedAtMs);
      verifyLinks(value, states);
      if (value.kind === "shared-result") {
        const key = JSON.stringify(value.origin);
        if (origins.has(key)) throw new Error("The same organisational result origin cannot be counted under another identity.");
        origins.add(key);
      }
      if (value.kind === "allocation") {
        if (allocatedResults.has(value.resultId)) throw new Error("One versioned allocation identity per result is required; correct it instead of stacking allocations.");
        allocatedResults.add(value.resultId);
      }
      states.set(value.id, {
        entity: value, version: 1, createdByPersonId: event.actorPersonId, createdAtMs: event.recordedAtMs,
        authorPersonIds: [event.actorPersonId], interestedPersonIds: interestedPeople(value),
        updatedAtMs: event.recordedAtMs, withdrawnAtMs: null, eventIds: [event.id], reviews: [], corroborations: [], disputes: [],
      });
      continue;
    }
    const previous = states.get(body.entityId);
    if (!previous || previous.version !== body.expectedVersion) throw new Error("Unknown entity or stale version; never auto-rebase a correction, dispute or review.");
    if (previous.withdrawnAtMs !== null && body.type !== "disputed" && body.type !== "dispute-resolved") {
      throw new Error("Withdrawn history cannot be revived or overwritten; only dispute history may be appended.");
    }
    let next: ContributionEntityState = { ...previous, updatedAtMs: event.recordedAtMs, eventIds: [...previous.eventIds, event.id] };
    if (body.type === "corrected") {
      if (!sameIdentity(previous.entity, body.replacement)) throw new Error("Corrections cannot transfer stable person/business/result identity or rewrite expectation periods.");
      verifyEntityTime(body.replacement, event.recordedAtMs);
      verifyLinks(body.replacement, states);
      if (previous.version === Number.MAX_SAFE_INTEGER) throw new Error("Entity version exhausted.");
      next = {
        ...next, entity: body.replacement, version: previous.version + 1, reviews: [], corroborations: [],
        authorPersonIds: [...new Set([...previous.authorPersonIds, event.actorPersonId])],
        interestedPersonIds: [...new Set([...previous.interestedPersonIds, ...interestedPeople(body.replacement)])],
      };
    } else if (body.type === "disputed") {
      if (disputes.has(body.disputeId)) throw new Error("Dispute identity cannot be replayed.");
      disputes.add(body.disputeId);
      next = { ...next, disputes: [...previous.disputes, {
        id: body.disputeId, openedByPersonId: event.actorPersonId, openedAtMs: event.recordedAtMs,
        version: previous.version, resolution: null,
      }] };
    } else if (body.type === "dispute-resolved") {
      const dispute = previous.disputes.find(entry => entry.id === body.disputeId);
      if (!dispute || dispute.resolution !== null || dispute.openedByPersonId === event.actorPersonId
        || previous.authorPersonIds.includes(event.actorPersonId) || previous.interestedPersonIds.includes(event.actorPersonId)
        || body.evidence.length === 0) throw new Error("A dispute requires a separate evidence-backed resolver; it cannot resolve itself or silently disappear.");
      next = { ...next, disputes: previous.disputes.map(entry => entry.id !== body.disputeId ? entry : {
        ...entry, resolution: { finding: body.finding, version: previous.version, eventId: event.id },
      }) };
    } else if (body.type === "reviewed") {
      if (previous.entity.kind === "contribution" || previous.authorPersonIds.includes(event.actorPersonId)
        || previous.interestedPersonIds.includes(event.actorPersonId) || body.evidence.length === 0
        || previous.reviews.some(review => review.actorPersonId === event.actorPersonId)) {
        throw new Error("Review requires a separate reviewer and evidence; self-review and reviewer replay are prohibited.");
      }
      const review: ContributionReviewEvent = { ...event, body };
      next = { ...next, reviews: [...previous.reviews, review] };
    } else if (body.type === "withdrawn") {
      next = { ...next, withdrawnAtMs: event.recordedAtMs };
    } else {
      if (previous.entity.kind !== "contribution" || previous.entity.measure.kind !== "hours"
        || event.actorPersonId === previous.entity.personId || previous.authorPersonIds.includes(event.actorPersonId)
        || body.minutes > previous.entity.measure.reportedMinutes || body.evidence.length === 0
        || previous.corroborations.some(entry => entry.actorPersonId === event.actorPersonId)) {
        throw new Error("Hours corroboration must be independent, version-bound, non-replayed and no greater than reported time.");
      }
      const corroboration: ContributionCorroborationEvent = { ...event, body };
      next = { ...next, corroborations: [...previous.corroborations, corroboration] };
    }
    states.set(body.entityId, next);
  }
  return [...states.values()];
}

export function projectContributionLedger(value: unknown, nowMs: number, asOfMs = nowMs):
  | Readonly<{ status: "projected"; projection: ContributionProjection }> & typeof CONTRIBUTION_SAFETY
  | ContributionDomainRefusal {
  try {
    contributionCounter(nowMs);
    contributionCounter(asOfMs);
    if (asOfMs > nowMs) throw new Error("An as-of observation cannot be in the future.");
    const item = contributionFields(value, ["version", "scope", "revision", "events"]);
    if (item.version !== CONTRIBUTION_DOMAIN_VERSION) throw new Error("Unsupported contribution domain version.");
    const scope = decodeContributionScope(item.scope);
    const revision = contributionCounter(item.revision);
    const events = contributionList(item.events, auditEvent);
    if (revision !== events.length || new Set(events.map(event => event.id)).size !== events.length) throw new Error("Ledger revision, event identity or inventory is inconsistent.");
    for (const [index, event] of events.entries()) {
      const previous = events[index - 1];
      if (event.sequence !== index + 1 || event.previousEventId !== (previous?.id ?? null)
        || event.recordedAtMs > nowMs || (previous && event.recordedAtMs < previous.recordedAtMs)) {
        throw new Error("Audit order, previous identity or trusted observation clock is inconsistent.");
      }
    }
    const all = replay(events);
    const selected = events.filter(event => event.recordedAtMs <= asOfMs);
    return freezeContributionValue({
      status: "projected", ...CONTRIBUTION_SAFETY,
      projection: {
        scope, sourceRevision: revision, observedRevision: selected.length, asOfMs,
        entities: selected.length === events.length ? all : replay(selected), audit: selected,
      },
    });
  } catch (error) {
    return contributionRefusal(`Contribution history refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function previewContributionAppend(
  ledgerValue: unknown, eventValue: unknown, expectedRevision: number, nowMs: number,
) {
  const checked = projectContributionLedger(ledgerValue, nowMs);
  if (checked.status === "refused") return checked;
  try {
    contributionCounter(expectedRevision);
    if (checked.projection.sourceRevision !== expectedRevision || expectedRevision === Number.MAX_SAFE_INTEGER) {
      throw new Error("Stale/exhausted ledger revision; preserve the exact request and reconcile before retry.");
    }
    const event = auditEvent(eventValue);
    const ledger: ContributionLedger = {
      version: CONTRIBUTION_DOMAIN_VERSION, scope: checked.projection.scope,
      revision: expectedRevision + 1, events: [...checked.projection.audit, event],
    };
    const projected = projectContributionLedger(ledger, nowMs);
    if (projected.status === "refused") return projected;
    return freezeContributionValue({
      status: "preview" as const, ...CONTRIBUTION_SAFETY, durable: false as const,
      ledger, projection: projected.projection,
    });
  } catch (error) {
    return contributionRefusal(`Contribution append preview refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}
