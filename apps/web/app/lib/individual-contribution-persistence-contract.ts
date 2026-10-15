import type {
  ContributionAuditEvent, ContributionEntityState, ContributionLedger, ContributionScope,
} from "./individual-contribution";

export const CONTRIBUTION_DURABLE_PREREQUISITES = Object.freeze([
  "server-resolved-session-and-explicit-subject-to-person-binding",
  "tenant-dataset-business-and-row-scoped-access-with-fresh-revocation-checks",
  "separate-reporter-reviewer-evidence-custodian-and-dispute-resolver-responsibilities",
  "atomic-global-ledger-revision-head-entity-version-and-policy-revision-checks",
  "unique-operation-event-entity-origin-allocation-and-dispute-identities",
  "append-only-audit-and-immutable-revisioned-evidence-retention",
  "confirmed-commit-receipts-and-authorized-exact-request-reconciliation",
  "privacy-minimisation-retention-appeal-and-controlled-redaction-policy",
  "independent-allocation-review-even-for-founders-and-department-heads",
  "explicit-human-legal-and-contractual-review-for-any-reward-or-equity-decision",
] as const);

// Design requirements only. These are NOT additions to existing authorization grants.
export type ContributionAccessPurpose =
  | "report-own" | "report-on-behalf" | "read-own" | "read-business-summary"
  | "read-evidence" | "corroborate-hours" | "review-outcome" | "review-allocation"
  | "define-expectation" | "correct-history" | "open-dispute" | "resolve-dispute";

export type ContributionAppendRequest = Readonly<{
  operationId: string;
  scope: ContributionScope;
  expectedPolicyRevision: number;
  expectedPersonBindingRevision: number;
  expectedLedgerRevision: number;
  expectedHeadEventId: string | null;
  expectedEntityVersions: readonly Readonly<{ entityId: string; version: number }>[];
  event: ContributionAuditEvent;
}>;
export type ContributionCommitReceipt = Readonly<{
  operationId: string;
  scope: ContributionScope;
  requestSha256: string;
  transactionId: string;
  eventId: string;
  ledgerRevision: number;
  headEventId: string;
  policyRevision: number;
  personBindingRevision: number;
  durability: "transaction-commit-confirmed";
}>;
export type ContributionPersistenceProblem =
  | Readonly<{ status: "unauthorized"; message: string }>
  | Readonly<{ status: "invalid-request"; message: string }>
  | Readonly<{ status: "conflict"; reason: "stale-policy" | "stale-binding" | "stale-ledger" | "stale-entity" | "identity-reused" }>
  | Readonly<{ status: "unavailable"; outcome: "not-submitted" | "unknown"; message: string }>
  | Readonly<{ status: "failed"; outcome: "rolled-back"; message: string }>;

/**
 * Future server-only dependency bound to a verified principal, never to a Person
 * access label or a caller's actorPersonId. No implementation or caller is provided.
 * Each operation must enforce current row/evidence access before returning any data.
 * append must lock the scope, bind the server actor, revalidate the full history and
 * referenced evidence/result versions, check all fences, and commit one event plus
 * audit/idempotency receipt atomically. No last-writer-wins or automatic rebase.
 */
export interface FutureContributionRepository {
  readCompleteForAggregation(scope: ContributionScope): Promise<
    | Readonly<{ status: "snapshot"; durability: "committed-database-read"; ledger: ContributionLedger }>
    | ContributionPersistenceProblem
  >;
  append(request: ContributionAppendRequest): Promise<
    | Readonly<{ status: "committed"; receipt: ContributionCommitReceipt }>
    | ContributionPersistenceProblem
  >;
  // Read under the same scope lock after in-flight attempts settle; authorize
  // afresh. Not-found is not permission to generate a new operation identity.
  lookup(scope: ContributionScope, operationId: string, requestSha256: string): Promise<
    | Readonly<{ status: "committed"; receipt: ContributionCommitReceipt }>
    | Readonly<{ status: "unresolved" }>
    | ContributionPersistenceProblem
  >;
}

export type ContributionReadProjection = Readonly<{
  scope: ContributionScope;
  ledgerRevision: number;
  entities: readonly ContributionEntityState[];
  // A filtered read cannot attest complete organisational totals, an absence of
  // disputes, or independent review; trusted complete aggregation must precede it.
  coverage: "authorised-subset-not-complete-ledger";
}>;
