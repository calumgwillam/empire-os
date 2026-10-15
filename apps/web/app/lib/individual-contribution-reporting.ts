import {
  CONTRIBUTION_SAFETY, contributionChoice, contributionCounter, contributionFields, contributionId,
  contributionList, contributionRefusal, decodeContributionEvidence, decodeContributionPeriod, decodeContributionScope,
  freezeContributionValue, projectContributionLedger,
  type ContributionDomainRefusal, type ContributionEntityState, type ContributionEvidenceReference,
  type ContributionExpectation, type ContributionExpectationDimension, type ContributionMoney,
  type ContributionPeriod, type ContributionProjection, type ContributionRecord, type ContributionScope,
  type SharedContributionResult,
} from "./individual-contribution";

export type ContributionEvidenceDescriptor = ContributionEvidenceReference & Readonly<{
  recordedAtMs: number;
  source: "self-report" | "work-record" | "independent-observation" | "financial-record";
  custodianPersonId: string;
  availability: "available" | "missing" | "restricted";
}>;
export type ContributionBusinessReference = Readonly<{ id: string; businessId: string }>;
export type ContributionReferenceSnapshot = Readonly<{
  scope: ContributionScope;
  asOfMs: number;
  people: readonly Readonly<{
    id: string; kind: "founder" | "department-head" | "employee" | "contractor" | "partner" | "unclassified";
  }>[];
  businessIds: readonly string[];
  roles: readonly ContributionBusinessReference[];
  departments: readonly ContributionBusinessReference[];
  projects: readonly ContributionBusinessReference[];
  actions: readonly ContributionBusinessReference[];
  financialRecords: readonly ContributionBusinessReference[];
  evidence: readonly ContributionEvidenceDescriptor[];
}>;
export type ContributionIssue = Readonly<{ entityId: string | null; code: string }>;
type RoleContext = Readonly<{ roleId: string | null; departmentId: string | null }>;
export type ContributionPersonSummary = Readonly<{
  personId: string;
  businessId: string;
  roleContexts: readonly RoleContext[];
  recordIds: readonly string[];
  reportedMinutes: number | null;
  corroboratedMinutes: number | null;
  corroboratedSubsetMinutes: number;
  reportedMinutesWithoutCorroboration: number | null;
  partiallyCorroboratedRecordIds: readonly string[];
  uncorroboratedRecordIds: readonly string[];
  deliverableIds: readonly string[];
  outcomeIds: readonly string[];
  financialResultIds: readonly string[];
  qualityRecordIds: readonly string[];
  initiativeRecordIds: readonly string[];
  issueCodes: readonly string[];
}>;
export type ContributionExactShare = Readonly<{
  wholeMinorUnits: number;
  remainderNumerator: number;
  denominator: 10_000;
}>;
export type ContributionResultSummary = Readonly<{
  resultId: string;
  version: number;
  businessId: string;
  resultKind: SharedContributionResult["resultKind"];
  participantIds: readonly string[];
  independentlyReviewed: boolean;
  money: ContributionMoney | null;
  allocationId: string | null;
  attributionStatus: "reviewed" | "unallocated" | "blocked";
  allocatedBasisPoints: number;
  unallocatedBasisPoints: number;
  effectiveShares: readonly Readonly<{
    personId: string; basisPoints: number; money: ContributionExactShare | null;
  }>[];
  unallocatedMoney: ContributionExactShare | null;
}>;
export type ContributionFinancialBucket = Readonly<{
  businessId: string;
  currency: string;
  minorUnitScale: number;
  financialKind: ContributionMoney["financialKind"];
  basis: ContributionMoney["basis"];
  reportedAmountMinor: number;
  independentlyReviewedAmountMinor: number;
  resultIds: readonly string[];
}>;
export type ContributionExpectationComparison = Readonly<{
  expectationId: string;
  version: number;
  personId: string | null;
  criterionId: string;
  dimension: ContributionExpectationDimension;
  minimum: number | null;
  observed: number | null;
  status: "human-review-required" | "not-comparable";
  recordedMinimumComparison: "below" | "at-or-above" | null;
  reasons: readonly string[];
}>;
export type ContributionPeriodReport = Readonly<{
  scope: ContributionScope;
  sourceRevision: number;
  observedRevision: number;
  asOfMs: number;
  period: ContributionPeriod;
  people: readonly ContributionPersonSummary[];
  peopleWithNoIncludedRecords: readonly string[];
  results: readonly ContributionResultSummary[];
  uniqueResultCounts: Readonly<{ deliverable: number; outcome: number; financial: number }>;
  financialBuckets: readonly ContributionFinancialBucket[];
  expectations: readonly ContributionExpectationComparison[];
  issues: readonly ContributionIssue[];
  coverage: "not-established";
  valueJudgement: "not-calculated";
}> & typeof CONTRIBUTION_SAFETY;

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function compareKey(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function referenceExists(values: readonly ContributionBusinessReference[], id: string, businessId: string): boolean {
  return values.some(value => value.id === id && value.businessId === businessId);
}
function ids(value: unknown): string[] {
  const result = contributionList(value, contributionId);
  if (new Set(result).size !== result.length) throw new Error("Ambiguous duplicate reference identities.");
  return result;
}
function referenceSnapshot(value: unknown): ContributionReferenceSnapshot {
  const item = contributionFields(value, [
    "scope", "asOfMs", "people", "businessIds", "roles", "departments", "projects", "actions", "financialRecords", "evidence",
  ]);
  const businessIds = ids(item.businessIds);
  const businessReferences = (value: unknown) => {
    const result = contributionList(value, entry => {
      const reference = contributionFields(entry, ["id", "businessId"]);
      const businessId = contributionId(reference.businessId);
      if (!businessIds.includes(businessId)) throw new Error("A scoped reference belongs to an unknown business.");
      return { id: contributionId(reference.id), businessId };
    });
    if (new Set(result.map(reference => JSON.stringify([reference.id, reference.businessId]))).size !== result.length) {
      throw new Error("Duplicate scoped reference identities are ambiguous.");
    }
    return result;
  };
  const people = contributionList(item.people, entry => {
    const person = contributionFields(entry, ["id", "kind"]);
    return {
      id: contributionId(person.id),
      kind: contributionChoice(person.kind, ["founder", "department-head", "employee", "contractor", "partner", "unclassified"]),
    };
  });
  if (new Set(people.map(person => person.id)).size !== people.length) throw new Error("People identity is ambiguous; names are never identity fallbacks.");
  const evidence = contributionList(item.evidence, entry => {
    const descriptor = contributionFields(entry, ["id", "revision", "sha256", "recordedAtMs", "source", "custodianPersonId", "availability"]);
    const [ref] = decodeContributionEvidence([{ id: descriptor.id, revision: descriptor.revision, sha256: descriptor.sha256 }]);
    return {
      ...ref, recordedAtMs: contributionCounter(descriptor.recordedAtMs),
      source: contributionChoice(descriptor.source, ["self-report", "work-record", "independent-observation", "financial-record"]),
      custodianPersonId: contributionId(descriptor.custodianPersonId),
      availability: contributionChoice(descriptor.availability, ["available", "missing", "restricted"]),
    };
  });
  if (new Set(evidence.map(ref => JSON.stringify([ref.id, ref.revision]))).size !== evidence.length) throw new Error("Evidence identity/revision is ambiguous.");
  return {
    scope: decodeContributionScope(item.scope), asOfMs: contributionCounter(item.asOfMs), people,
    businessIds, roles: businessReferences(item.roles), departments: businessReferences(item.departments),
    projects: businessReferences(item.projects), actions: businessReferences(item.actions),
    financialRecords: businessReferences(item.financialRecords), evidence,
  };
}
function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("Contribution aggregate exceeds safe integer precision; no rounded result is returned.");
  return result;
}
function sum(values: readonly number[]): number { return values.reduce(safeAdd, 0); }
function unique(values: readonly string[]): string[] { return [...new Set(values)].sort(); }
function blocked(state: ContributionEntityState): boolean {
  return state.disputes.some(dispute => dispute.resolution === null
    || (dispute.resolution.finding === "not-supported" && dispute.resolution.version === state.version));
}
function intersects(left: ContributionPeriod, right: ContributionPeriod): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}
function contained(inner: ContributionPeriod, outer: ContributionPeriod): boolean {
  return inner.startMs >= outer.startMs && inner.endMs <= outer.endMs;
}
function exactShare(amount: number, basisPoints: number): ContributionExactShare {
  const product = BigInt(amount) * BigInt(basisPoints);
  return {
    wholeMinorUnits: Number(product / BigInt(10_000)),
    remainderNumerator: Number(product % BigInt(10_000)), denominator: 10_000,
  };
}

export function buildContributionPeriodReport(
  ledgerValue: unknown, referencesValue: unknown, periodValue: unknown, nowMs: number, asOfMs = nowMs,
):
  | Readonly<{ status: "reported"; report: ContributionPeriodReport }> & typeof CONTRIBUTION_SAFETY
  | ContributionDomainRefusal {
  try {
    const period = decodeContributionPeriod(periodValue);
    const references = referenceSnapshot(referencesValue);
    const projected = projectContributionLedger(ledgerValue, nowMs, asOfMs);
    if (projected.status === "refused") return projected;
    const projection = projected.projection;
    if (!same(references.scope, projection.scope) || references.asOfMs !== asOfMs) {
      throw new Error("Reference/evidence snapshot must match the exact tenant, dataset and as-of time.");
    }
    const issues: ContributionIssue[] = [];
    const issueKeys = new Set<string>();
    const issue = (entityId: string | null, code: string) => {
      const key = JSON.stringify([entityId, code]);
      if (!issueKeys.has(key)) { issueKeys.add(key); issues.push({ entityId, code }); }
    };
    if (period.endMs > asOfMs) issue(null, "period-not-complete");
    issue(null, "coverage-not-established");
    const stateIndex = new Map(projection.entities.map(state => [state.entity.id, state]));
    const eventIndex = new Map(projection.audit.map(event => [event.id, event]));
    const authoredAt = new Map<string, number>();
    const participationByResult = new Map<string, ContributionEntityState[]>();
    const allocationByResult = new Map<string, ContributionEntityState>();
    for (const event of projection.audit) {
      const body = event.body;
      if (body.type === "created") authoredAt.set(body.entity.id, event.recordedAtMs);
      if (body.type === "corrected") authoredAt.set(body.entityId, event.recordedAtMs);
    }
    for (const state of projection.entities) {
      const value = state.entity;
      if (value.kind === "contribution" && "resultId" in value.measure) {
        const group = participationByResult.get(value.measure.resultId) ?? [];
        group.push(state);
        participationByResult.set(value.measure.resultId, group);
      }
      if (value.kind === "allocation") allocationByResult.set(value.resultId, state);
    }
    const knownPeople = new Set(references.people.map(person => person.id));
    const evidenceIndex = new Map(references.evidence.map(ref => [JSON.stringify([ref.id, ref.revision]), ref]));
    const evidenceOK = (
      refs: readonly ContributionEvidenceReference[], entityId: string, atMs: number,
      independentOf: readonly string[] = [],
    ): boolean => {
      if (refs.length === 0) { issue(entityId, "missing-evidence"); return false; }
      let valid = true;
      let independent = independentOf.length === 0;
      for (const ref of refs) {
        const descriptor = evidenceIndex.get(JSON.stringify([ref.id, ref.revision]));
        if (!descriptor || descriptor.sha256 !== ref.sha256) { issue(entityId, "unresolved-evidence"); valid = false; continue; }
        if (descriptor.recordedAtMs > atMs || descriptor.recordedAtMs > asOfMs) {
          issue(entityId, "evidence-postdates-assertion"); valid = false;
        }
        if (descriptor.availability !== "available") { issue(entityId, "evidence-not-available"); valid = false; }
        if (!knownPeople.has(descriptor.custodianPersonId)) { issue(entityId, "unknown-evidence-custodian"); valid = false; }
        if (descriptor.source !== "self-report" && !independentOf.includes(descriptor.custodianPersonId)
          && knownPeople.has(descriptor.custodianPersonId)) independent = true;
      }
      if (!independent) { issue(entityId, "independent-evidence-not-established"); valid = false; }
      return valid;
    };
    const historyFor = (state: ContributionEntityState) => state.eventIds.map(id => {
      const event = eventIndex.get(id);
      if (!event) throw new Error("Projected audit reference is missing.");
      return event;
    });
    const integrityOK = (state: ContributionEntityState, extraInterested: readonly string[] = []): boolean => {
      let valid = true;
      if (state.withdrawnAtMs !== null) { issue(state.entity.id, "withdrawn"); valid = false; }
      if (blocked(state)) { issue(state.entity.id, "disputed-or-not-supported"); valid = false; }
      for (const event of historyFor(state)) {
        if (!knownPeople.has(event.actorPersonId)) { issue(state.entity.id, "unknown-audit-actor"); valid = false; }
        if (event.body.type === "corrected") {
          if (!evidenceOK(event.body.evidence, state.entity.id, event.recordedAtMs)) valid = false;
        }
        if (event.body.type === "dispute-resolved") {
          if (extraInterested.includes(event.actorPersonId)) { issue(state.entity.id, "resolver-conflict-of-interest"); valid = false; }
          if (!evidenceOK(event.body.evidence, state.entity.id, event.recordedAtMs, [
            ...state.authorPersonIds, ...state.interestedPersonIds, ...extraInterested,
          ])) valid = false;
        }
      }
      return valid;
    };
    const refsOK = (record: ContributionRecord): boolean => {
      let valid = true;
      const check = (resolved: boolean, code: string) => { if (!resolved) { issue(record.id, code); valid = false; } };
      check(knownPeople.has(record.personId), "unknown-person");
      check(references.businessIds.includes(record.businessId), "unknown-business");
      check(record.roleId !== null && referenceExists(references.roles, record.roleId, record.businessId), "missing-or-unknown-role");
      check(record.departmentId !== null && referenceExists(references.departments, record.departmentId, record.businessId), "missing-or-unknown-department");
      if (record.projectId !== null) check(referenceExists(references.projects, record.projectId, record.businessId), "unknown-project");
      if (record.actionId !== null) check(referenceExists(references.actions, record.actionId, record.businessId), "unknown-action");
      if ("resultId" in record.measure) {
        const result = stateIndex.get(record.measure.resultId);
        check(result !== undefined && result.withdrawnAtMs === null && !blocked(result), "linked-result-withdrawn-or-disputed");
      }
      if (record.pillarId === null) issue(record.id, "pillar-not-specified");
      return valid;
    };
    // Includes historical participants in this as-of audit, so changing a link or share
    // cannot turn a prior beneficiary into an independent reviewer.
    const participants = new Map<string, Set<string>>();
    for (const event of projection.audit) {
      const body = event.body;
      const value = body.type === "created" ? body.entity : body.type === "corrected" ? body.replacement : null;
      if (value?.kind === "contribution" && "resultId" in value.measure) {
        const set = participants.get(value.measure.resultId) ?? new Set<string>();
        set.add(value.personId);
        participants.set(value.measure.resultId, set);
      }
      if (value?.kind === "allocation") {
        const set = participants.get(value.resultId) ?? new Set<string>();
        value.shares.forEach(share => set.add(share.personId));
        participants.set(value.resultId, set);
      }
    }
    const approved = (state: ContributionEntityState, extraInterested: readonly string[] = []): boolean => {
      let valid = integrityOK(state, extraInterested);
      if (!evidenceOK(state.entity.evidence, state.entity.id, authoredAt.get(state.entity.id) ?? state.createdAtMs)) valid = false;
      if (state.reviews.length === 0) { issue(state.entity.id, "independent-review-missing"); return false; }
      const excluded = [...state.authorPersonIds, ...state.interestedPersonIds, ...extraInterested];
      for (const review of state.reviews) {
        if (review.body.decision !== "approved") { issue(state.entity.id, "review-rejected-or-conflicting"); valid = false; }
        if (excluded.includes(review.actorPersonId)) { issue(state.entity.id, "reviewer-conflict-of-interest"); valid = false; }
        if (!knownPeople.has(review.actorPersonId)) { issue(state.entity.id, "unknown-reviewer"); valid = false; }
        if (!evidenceOK(review.body.evidence, state.entity.id, review.recordedAtMs, excluded)) valid = false;
      }
      return valid;
    };
    const included = projection.entities.filter((state): state is ContributionEntityState & { entity: ContributionRecord } => {
      const record = state.entity;
      if (state.withdrawnAtMs !== null || record.kind !== "contribution" || !intersects(record.period, period)) return false;
      if (!contained(record.period, period)) { issue(record.id, "cross-period-record-not-prorated"); return false; }
      return true;
    });
    const people: ContributionPersonSummary[] = [];
    const corroboratedByRecord = new Map<string, number>();
    const groups = new Map<string, typeof included>();
    for (const state of included) {
      const key = JSON.stringify([state.entity.personId, state.entity.businessId]);
      const group = groups.get(key) ?? [];
      group.push(state);
      groups.set(key, group);
    }
    const validRecords = new Map<string, boolean>();
    for (const state of included) {
      const valid = integrityOK(state);
      const links = refsOK(state.entity);
      const supported = evidenceOK(state.entity.evidence, state.entity.id, authoredAt.get(state.entity.id) ?? state.createdAtMs);
      validRecords.set(state.entity.id, valid && links && supported);
    }
    // Overlap is checked across businesses, not just inside a displayed business row.
    const hours = projection.entities.filter((state): state is ContributionEntityState & { entity: ContributionRecord } =>
      state.withdrawnAtMs === null && state.entity.kind === "contribution" && state.entity.measure.kind === "hours"
      && intersects(state.entity.period, period)).sort((left, right) => compareKey(left.entity.personId, right.entity.personId)
        || left.entity.period.startMs - right.entity.period.startMs || left.entity.period.endMs - right.entity.period.endMs);
    const overlapping = new Set<string>();
    let furthest: (typeof hours)[number] | undefined;
    for (const current of hours) {
      if (furthest?.entity.personId !== current.entity.personId) furthest = undefined;
      if (furthest && intersects(furthest.entity.period, current.entity.period)) {
        overlapping.add(furthest.entity.id); overlapping.add(current.entity.id);
        issue(furthest.entity.id, "overlapping-time-claims"); issue(current.entity.id, "overlapping-time-claims");
      }
      if (!furthest || current.entity.period.endMs > furthest.entity.period.endMs) furthest = current;
    }
    for (const group of groups.values()) {
      const first = group[0].entity;
      const uncorroborated: string[] = [];
      const minutes: number[] = [];
      const reported: number[] = [];
      const partial: string[] = [];
      for (const state of group) {
        const record = state.entity;
        if (record.measure.kind !== "hours") continue;
        reported.push(record.measure.reportedMinutes);
        let valid = validRecords.get(record.id) === true && !overlapping.has(record.id);
        if (state.corroborations.length === 0) { issue(record.id, "hours-not-independently-corroborated"); valid = false; }
        const values = unique(state.corroborations.map(entry => String(entry.body.minutes)));
        if (values.length > 1) { issue(record.id, "conflicting-hours-corroborations"); valid = false; }
        for (const entry of state.corroborations) {
          if (!knownPeople.has(entry.actorPersonId)) { issue(record.id, "unknown-corroborator"); valid = false; }
          if (!evidenceOK(entry.body.evidence, record.id, entry.recordedAtMs, [...state.authorPersonIds, record.personId])) valid = false;
        }
        if (valid && state.corroborations.length > 0) {
          minutes.push(state.corroborations[0].body.minutes);
          corroboratedByRecord.set(record.id, state.corroborations[0].body.minutes);
          if (state.corroborations[0].body.minutes < record.measure.reportedMinutes) partial.push(record.id);
        } else uncorroborated.push(record.id);
      }
      const participationIds = (kind: "deliverable" | "outcome" | "financial") => unique(group.flatMap(state => {
        const measurement = state.entity.measure;
        return measurement.kind === kind && "resultId" in measurement ? [measurement.resultId] : [];
      }));
      const roleContexts = [...new Map(group.map(state => {
        const context = { roleId: state.entity.roleId, departmentId: state.entity.departmentId };
        return [JSON.stringify(context), context];
      })).values()].sort((left, right) => compareKey(JSON.stringify(left), JSON.stringify(right)));
      people.push({
        personId: first.personId, businessId: first.businessId, roleContexts,
        recordIds: group.map(state => state.entity.id).sort(),
        reportedMinutes: reported.length === 0 ? null : sum(reported),
        corroboratedMinutes: reported.length === 0 || uncorroborated.length > 0 ? null : sum(minutes),
        corroboratedSubsetMinutes: sum(minutes), uncorroboratedRecordIds: uncorroborated.sort(),
        reportedMinutesWithoutCorroboration: reported.length === 0 ? null : sum(reported) - sum(minutes),
        partiallyCorroboratedRecordIds: partial.sort(),
        deliverableIds: participationIds("deliverable"), outcomeIds: participationIds("outcome"), financialResultIds: participationIds("financial"),
        qualityRecordIds: group.filter(state => state.entity.measure.kind === "quality").map(state => state.entity.id).sort(),
        initiativeRecordIds: group.filter(state => state.entity.measure.kind === "initiative").map(state => state.entity.id).sort(),
        issueCodes: [],
      });
    }
    const results: ContributionResultSummary[] = [];
    const buckets = new Map<string, ContributionFinancialBucket>();
    for (const state of projection.entities) {
      const result = state.entity;
      if (state.withdrawnAtMs !== null || result.kind !== "shared-result" || result.occurredAtMs < period.startMs || result.occurredAtMs >= period.endMs) continue;
      const beneficiaries = [...(participants.get(result.id) ?? [])];
      let reviewed = approved(state, beneficiaries);
      if (!references.businessIds.includes(result.businessId)) { issue(result.id, "unknown-business"); reviewed = false; }
      if (result.origin.type === "Action" && !referenceExists(references.actions, result.origin.id, result.businessId)) { issue(result.id, "unknown-origin-action"); reviewed = false; }
      if (result.origin.type === "Project" && !referenceExists(references.projects, result.origin.id, result.businessId)) { issue(result.id, "unknown-origin-project"); reviewed = false; }
      if (result.origin.type === "Finance" && !referenceExists(references.financialRecords, result.origin.id, result.businessId)) { issue(result.id, "unknown-origin-financial-record"); reviewed = false; }
      if (result.money?.basis === "recorded" && !result.evidence.some(ref =>
        evidenceIndex.get(JSON.stringify([ref.id, ref.revision]))?.source === "financial-record")) {
        issue(result.id, "financial-record-evidence-required"); reviewed = false;
      }
      const allocationState = allocationByResult.get(result.id);
      const allocation = allocationState?.entity.kind === "allocation" ? allocationState.entity : null;
      let allocationOK = reviewed;
      if (allocationState && allocation) {
        const allocationReviewed = approved(allocationState, [...beneficiaries, ...state.authorPersonIds]);
        allocationOK = allocationOK && allocationReviewed;
        for (const participation of participationByResult.get(result.id) ?? []) {
          if (blocked(participation)) {
            issue(allocation.id, "participation-disputed");
            allocationOK = false;
          }
        }
        if (allocation.resultVersion !== state.version) { issue(allocation.id, "allocation-binds-old-result-version"); allocationOK = false; }
        for (const reference of allocation.participationVersions) {
          const participation = stateIndex.get(reference.entityId);
          if (!participation || participation.version !== reference.version || participation.withdrawnAtMs !== null) {
            issue(allocation.id, "allocation-binds-old-participation-version"); allocationOK = false;
          }
        }
        for (const share of allocation.shares) {
          const matching = (participationByResult.get(result.id) ?? []).filter(entry => {
            const record = entry.entity;
            return entry.withdrawnAtMs === null && record.kind === "contribution" && record.personId === share.personId && "resultId" in record.measure
              && record.measure.resultId === result.id;
          });
          if (!knownPeople.has(share.personId) || matching.length === 0) { issue(allocation.id, "unresolved-allocation-participant"); allocationOK = false; }
          for (const participation of matching) {
            const record = participation.entity;
            if (record.kind !== "contribution") continue;
            const valid = integrityOK(participation);
            const links = refsOK(record);
            const supported = evidenceOK(record.evidence, record.id, authoredAt.get(record.id) ?? participation.createdAtMs);
            if (!valid || !links || !supported) allocationOK = false;
          }
        }
      } else allocationOK = false;
      const effectiveShares = allocation && allocationOK ? allocation.shares.map(share => ({
        ...share, money: result.money ? exactShare(result.money.amountMinor, share.basisPoints) : null,
      })) : [];
      const allocated = sum(effectiveShares.map(share => share.basisPoints));
      results.push({
        resultId: result.id, version: state.version, businessId: result.businessId, resultKind: result.resultKind,
        participantIds: unique((participationByResult.get(result.id) ?? []).flatMap(entry => {
          const record = entry.entity;
          return entry.withdrawnAtMs === null && record.kind === "contribution" && "resultId" in record.measure && record.measure.resultId === result.id ? [record.personId] : [];
        })),
        independentlyReviewed: reviewed, money: result.money, allocationId: allocation?.id ?? null,
        attributionStatus: allocation ? allocationOK ? "reviewed" : "blocked" : "unallocated",
        allocatedBasisPoints: allocated, unallocatedBasisPoints: 10_000 - allocated, effectiveShares,
        unallocatedMoney: result.money ? exactShare(result.money.amountMinor, 10_000 - allocated) : null,
      });
      if (result.money) {
        const monetary = result.money;
        const key = JSON.stringify([result.businessId, monetary.currency, monetary.minorUnitScale, monetary.financialKind, monetary.basis]);
        const previous = buckets.get(key);
        buckets.set(key, {
          businessId: result.businessId, currency: monetary.currency, minorUnitScale: monetary.minorUnitScale,
          financialKind: monetary.financialKind, basis: monetary.basis,
          reportedAmountMinor: safeAdd(previous?.reportedAmountMinor ?? 0, monetary.amountMinor),
          independentlyReviewedAmountMinor: safeAdd(previous?.independentlyReviewedAmountMinor ?? 0, reviewed ? monetary.amountMinor : 0),
          resultIds: [...(previous?.resultIds ?? []), result.id].sort(),
        });
      }
    }
    const expectations = compareExpectations(projection, references, period, included, approved, validRecords, corroboratedByRecord, issue);
    const resultRows = results.sort((left, right) => compareKey(left.resultId, right.resultId));
    const summaries = people.map(row => {
      const related = new Set([
        ...projection.entities.flatMap(state => state.entity.kind === "contribution"
          && state.entity.personId === row.personId && state.entity.businessId === row.businessId
          && intersects(state.entity.period, period) ? [state.entity.id] : []),
        ...row.deliverableIds, ...row.outcomeIds, ...row.financialResultIds,
      ]);
      return { ...row, issueCodes: unique(issues.filter(entry => entry.entityId !== null && related.has(entry.entityId)).map(entry => entry.code)) };
    }).sort((left, right) => compareKey(JSON.stringify([left.personId, left.businessId]), JSON.stringify([right.personId, right.businessId])));
    return freezeContributionValue({
      status: "reported", ...CONTRIBUTION_SAFETY,
      report: {
        ...CONTRIBUTION_SAFETY, scope: projection.scope, sourceRevision: projection.sourceRevision,
        observedRevision: projection.observedRevision, asOfMs, period, people: summaries,
        peopleWithNoIncludedRecords: references.people.filter(person => !summaries.some(row => row.personId === person.id)).map(person => person.id).sort(),
        results: resultRows,
        uniqueResultCounts: {
          deliverable: resultRows.filter(row => row.resultKind === "deliverable").length,
          outcome: resultRows.filter(row => row.resultKind === "outcome").length,
          financial: resultRows.filter(row => row.resultKind === "financial").length,
        },
        financialBuckets: [...buckets.values()].sort((left, right) => compareKey(JSON.stringify(left), JSON.stringify(right))),
        expectations, issues: issues.sort((left, right) => compareKey(JSON.stringify(left), JSON.stringify(right))),
        coverage: "not-established", valueJudgement: "not-calculated",
      },
    });
  } catch (error) {
    return contributionRefusal(`Contribution report refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function compareExpectations(
  projection: ContributionProjection,
  references: ContributionReferenceSnapshot,
  period: ContributionPeriod,
  included: readonly (ContributionEntityState & { entity: ContributionRecord })[],
  approved: (state: ContributionEntityState) => boolean,
  validRecords: ReadonlyMap<string, boolean>,
  corroboratedByRecord: ReadonlyMap<string, number>,
  issue: (id: string | null, code: string) => void,
): ContributionExpectationComparison[] {
  const result: ContributionExpectationComparison[] = [];
  const expectations = projection.entities.filter((state): state is ContributionEntityState & { entity: ContributionExpectation } =>
    state.withdrawnAtMs === null && state.entity.kind === "expectation");
  for (const state of expectations) {
    const plan = state.entity;
    if (!intersects(plan.period, period)) continue;
    const reviewed = approved(state);
    const eligible = included.filter(entry => entry.entity.businessId === plan.businessId
      && entry.entity.roleId === plan.roleId && entry.entity.departmentId === plan.departmentId);
    const people = unique(eligible.map(entry => entry.entity.personId));
    const alternatives = expectations.filter(entry => {
      const other = entry.entity;
      return other.id !== plan.id && other.businessId === plan.businessId && other.roleId === plan.roleId
        && other.departmentId === plan.departmentId && intersects(other.period, plan.period);
    });
    for (const personId of people.length > 0 ? people : [null]) {
      const records = eligible.filter(entry => entry.entity.personId === personId);
      for (const criterion of plan.criteria) {
        const reasons: string[] = [];
        if (!same(plan.period, period)) reasons.push("expectation-period-mismatch-no-proration");
        if (!reviewed) reasons.push("expectation-not-independently-reviewed");
        const revisedLate = projection.audit.some(event => event.recordedAtMs > plan.period.startMs
          && event.body.type === "corrected" && event.body.entityId === plan.id);
        if (state.createdAtMs > plan.period.startMs || revisedLate
          || state.reviews.some(review => review.recordedAtMs > plan.period.startMs)) reasons.push("retrospective-expectation-or-review");
        if (!references.businessIds.includes(plan.businessId) || !referenceExists(references.roles, plan.roleId, plan.businessId)
          || (plan.departmentId !== null && !referenceExists(references.departments, plan.departmentId, plan.businessId))) reasons.push("unresolved-expectation-context");
        if (alternatives.length > 0) reasons.push("overlapping-expectations");
        if (personId === null) reasons.push("no-recorded-role-context");
        if (period.endMs > projection.asOfMs) reasons.push("period-not-complete");
        const relevant = records.filter(entry => {
          const kind = entry.entity.measure.kind;
          return criterion.dimension === "reported-minutes" || criterion.dimension === "corroborated-minutes" ? kind === "hours"
            : criterion.dimension === "deliverable-participations" ? kind === "deliverable"
              : criterion.dimension === "outcome-participations" ? kind === "outcome"
                : criterion.dimension === kind;
        });
        if (relevant.length === 0) reasons.push("no-recorded-observations");
        if (relevant.some(entry => !validRecords.get(entry.entity.id))) reasons.push("record-evidence-or-context-uncertain");
        // Completeness of a person's reporting cannot be inferred from an empty set,
        // a role label or an arbitrary event stream supplied by a caller.
        reasons.push("coverage-not-established");
        let observed: number | null = null;
        if (criterion.dimension === "reported-minutes") {
          const values = relevant.flatMap(entry => entry.entity.measure.kind === "hours" ? [entry.entity.measure.reportedMinutes] : []);
          observed = values.length === 0 ? null : sum(values);
        } else if (criterion.dimension === "corroborated-minutes") {
          if (relevant.length > 0 && relevant.every(entry => corroboratedByRecord.has(entry.entity.id))) {
            observed = sum(relevant.map(entry => corroboratedByRecord.get(entry.entity.id) ?? 0));
          } else reasons.push("corroboration-incomplete");
        } else if (criterion.dimension === "deliverable-participations" || criterion.dimension === "outcome-participations") {
          const values = unique(relevant.flatMap(entry => "resultId" in entry.entity.measure ? [entry.entity.measure.resultId] : []));
          observed = values.length === 0 ? null : values.length;
        } else if (criterion.dimension === "initiative") observed = relevant.length === 0 ? null : relevant.length;
        for (const reason of reasons) if (reason !== "coverage-not-established") issue(plan.id, reason);
        result.push({
          expectationId: plan.id, version: state.version, personId, criterionId: criterion.id,
          dimension: criterion.dimension, minimum: criterion.minimum, observed,
          recordedMinimumComparison: observed === null || criterion.minimum === null
            || reasons.some(reason => reason !== "coverage-not-established")
            ? null : observed >= criterion.minimum ? "at-or-above" : "below",
          status: reasons.some(reason => reason !== "coverage-not-established")
            ? "not-comparable" : "human-review-required",
          reasons: unique(reasons),
        });
      }
    }
  }
  return result.sort((left, right) => compareKey(JSON.stringify([left.expectationId, left.personId, left.criterionId]),
    JSON.stringify([right.expectationId, right.personId, right.criterionId])));
}

export type ContributionReportInput = Readonly<{
  ledger: unknown; references: unknown; period: ContributionPeriod; asOfMs: number;
}>;
export function compareContributionPeriods(
  leftInput: ContributionReportInput, rightInput: ContributionReportInput,
  personId: string, businessId: string, nowMs: number,
) {
  try {
    contributionId(personId);
    contributionId(businessId);
    const decode = (input: ContributionReportInput) => {
      const item = contributionFields(input, ["ledger", "references", "period", "asOfMs"]);
      return buildContributionPeriodReport(
        item.ledger, item.references, item.period, nowMs, contributionCounter(item.asOfMs),
      );
    };
    const leftResult = decode(leftInput);
    const rightResult = decode(rightInput);
    if (leftResult.status === "refused") return leftResult;
    if (rightResult.status === "refused") return rightResult;
    const leftValue = leftResult.report;
    const rightValue = rightResult.report;
    const left = leftValue.people.find(row => row.personId === personId && row.businessId === businessId);
    const right = rightValue.people.find(row => row.personId === personId && row.businessId === businessId);
    const reasons: string[] = [];
    if (!same(leftValue.scope, rightValue.scope)) reasons.push("scope-mismatch");
    if (leftValue.period.endMs > rightValue.period.startMs) reasons.push("periods-overlap-or-reversed");
    if (leftValue.period.endMs - leftValue.period.startMs !== rightValue.period.endMs - rightValue.period.startMs) reasons.push("unequal-period-length");
    if (!left || !right) reasons.push("missing-person-observations");
    if (left && right && !same(left.roleContexts, right.roleContexts)) reasons.push("role-or-department-context-changed");
    if (leftValue.period.endMs > leftValue.asOfMs || rightValue.period.endMs > rightValue.asOfMs) reasons.push("period-not-complete");
    if (left?.issueCodes.length || right?.issueCodes.length) reasons.push("evidence-or-context-uncertain");
    return freezeContributionValue({
      status: "compared" as const, ...CONTRIBUTION_SAFETY, personId, businessId,
      comparableRecordedObservations: reasons.length === 0,
      reportedMinutesDelta: reasons.length === 0 && left?.reportedMinutes !== null && right?.reportedMinutes !== null
        && left && right ? right.reportedMinutes - left.reportedMinutes : null,
      corroboratedMinutesDelta: reasons.length === 0 && left?.corroboratedMinutes !== null && right?.corroboratedMinutes !== null
        && left && right ? right.corroboratedMinutes - left.corroboratedMinutes : null,
      recordedDeliverableParticipationDelta: reasons.length === 0 && left && right ? right.deliverableIds.length - left.deliverableIds.length : null,
      recordedOutcomeParticipationDelta: reasons.length === 0 && left && right ? right.outcomeIds.length - left.outcomeIds.length : null,
      recordedInitiativeCountDelta: reasons.length === 0 && left && right ? right.initiativeRecordIds.length - left.initiativeRecordIds.length : null,
      qualityComparison: "criteria-and-evidence-human-review-required" as const,
      financialComparison: "separate-currency-basis-and-allocation-human-review-required" as const,
      reasons: unique([...reasons, "coverage-not-established"]),
      interpretation: "recorded-observations-only-not-a-person-ranking-or-value-score" as const,
    });
  } catch (error) {
    return contributionRefusal(`Contribution comparison refused: ${error instanceof Error ? error.message : String(error)}`);
  }
}
