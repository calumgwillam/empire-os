import "server-only";
import { evaluateAuthorization, isAuthorityIdentifier } from "./authorization-policy";
import type { LockedAuthorizationTransaction } from "./authorization-transaction-contract";
import { resolveClerkSession } from "./clerk-session-resolver";
import {
  isContributionIdentityRegistry, isIdentityPerson, resolveContributionIdentityBinding,
} from "./contribution-identity-authority";
import { validateDurableAuthorityState } from "./durable-authorization-state";
import type { AuthorizationPostgresSource } from "./postgres-authorization-store";
import { restrictedSourceBinding } from "./restricted-postgres-provider";
import {
  createServerPrincipalResolver, isAuthenticatedPrincipal,
  type AuthenticatedPrincipal, type PersistenceCapability,
} from "./server-persistence-authority";
import {
  isCounter, isObject, validateCommitLookup, validateSnapshotRequest, validateWriteBatch,
  type PersistenceProblem, type ServerPersistenceRepository, type Validation,
} from "./server-persistence-contract";

export type TrustedMultiUserTransaction = Pick<
  LockedAuthorizationTransaction, "loadAuthority" | "nowMs" | "beforeCommit"
> & Readonly<{
  actorSubject: string;
  tenantId: string;
  datasetId: string;
  loadIdentityRegistry(): Promise<unknown>;
  loadPeople(): Promise<unknown>;
}>;

export type TrustedExecutionIdentity = Readonly<{
  status: "authorized";
  subject: string;
  personId: string;
  bindingId: string;
  registryRevision: number;
  bindingRevision: number;
  tenantId: string;
  policyRevision: number;
  membershipRevision: number;
}>;

export type TrustedMultiUserRepository = Pick<
  ServerPersistenceRepository, "readSnapshot" | "writeBatch" | "lookupCommit"
>;

export type TrustedMultiUserAuthorityDependencies = Readonly<{
  tenantId: string;
  sourceForPrincipal(principal: AuthenticatedPrincipal): AuthorizationPostgresSource;
  // Install a transaction-aware adapter, not an unguarded durable repository. It must
  // lock the identity registry before tenant authority (the identity writer's order),
  // load current People under compatible locks, and call authorize in EVERY transaction,
  // including snapshot reads, replay, reconciliation and write read-back. A refusal
  // must roll back before effects/disclosure. Hold all locks through completion and
  // run beforeCommit guards with a refreshed database clock immediately before COMMIT
  // (or before completing a read-only transaction and disclosing its result).
  // The adapter alone owns BEGIN/COMMIT/ROLLBACK, audit, fences and idempotency. Receipts
  // require confirmed COMMIT; never retry or manufacture receipts in this boundary.
  repositoryForExecution(options: Readonly<{
    principal: AuthenticatedPrincipal;
    tenantId: string;
    datasetId: string;
    source: AuthorizationPostgresSource;
    authorize(transaction: TrustedMultiUserTransaction): Promise<TrustedExecutionIdentity | PersistenceProblem>;
  }>): TrustedMultiUserRepository;
}>;

function forbidden(): Extract<PersistenceProblem, { status: "unauthorized" }> {
  return { status: "unauthorized", reason: "forbidden" };
}

function unavailable(outcome: "not-submitted" | "unknown"): Extract<PersistenceProblem, { status: "unavailable" }> {
  return {
    status: "unavailable", outcome,
    message: outcome === "unknown"
      ? "The operation outcome could not be confirmed; reconcile only the exact original request."
      : "Trusted execution authority is unavailable.",
  };
}

// Internal composition only: no route, default loader, SQL installation or release
// approval. Execution identities are transaction evidence, never transferable grants.
export function createTrustedMultiUserAuthority(dependencies: TrustedMultiUserAuthorityDependencies) {
  const { tenantId } = dependencies;
  if (!isAuthorityIdentifier(tenantId)) throw new Error("Invalid trusted execution tenant.");
  const resolvePrincipal = createServerPrincipalResolver(resolveClerkSession);

  async function execute<Input, Result>(
    request: Request,
    input: unknown,
    validate: (input: unknown) => Validation<Input>,
    target: (input: Input) => string,
    capability: PersistenceCapability,
    mutating: boolean,
    invoke: (repository: TrustedMultiUserRepository, input: Input) => Promise<Result>,
  ): Promise<Result | PersistenceProblem> {
    const principal = await resolvePrincipal(request);
    if (!isAuthenticatedPrincipal(principal)) return principal;
    const validated = validate(input);
    if (validated.status !== "valid") return validated;
    const datasetId = target(validated.value);
    let submitted = false;
    let authorizedTransactions = 0;
    let completedTransactions = 0;
    let active = true;
    let refusal: PersistenceProblem | undefined;
    const transactions = new WeakSet<object>();

    try {
      const source = dependencies.sourceForPrincipal(principal);
      const binding = restrictedSourceBinding(source);
      if (!binding || binding.subject !== principal.subject || binding.tenantId !== tenantId) return forbidden();

      const repository = dependencies.repositoryForExecution({
        principal, tenantId, datasetId, source,
        async authorize(transaction) {
          if (!active) return forbidden();
          if (refusal) return refusal;
          try {
            if (transactions.has(transaction) || transaction.actorSubject !== principal.subject
              || transaction.tenantId !== tenantId || transaction.datasetId !== datasetId) {
              refusal = forbidden();
              return refusal;
            }
            transactions.add(transaction);
            const registry = structuredClone(await transaction.loadIdentityRegistry());
            const authority = validateDurableAuthorityState(structuredClone(await transaction.loadAuthority()));
            const people: unknown = structuredClone(await transaction.loadPeople());
            const nowMs = transaction.nowMs();
            if (!active) return forbidden();
            if (!isCounter(nowMs) || !isContributionIdentityRegistry(registry)
              || registry.events.some(event => event.recordedAtMs > nowMs)
              || authority.status !== "valid" || !Array.isArray(people)) {
              refusal = forbidden();
              return refusal;
            }
            const personIds = new Set<string>();
            for (let index = 0; index < people.length; index += 1) {
              const person: unknown = people[index];
              if (!isIdentityPerson(person) || person.tenantId !== tenantId || personIds.has(person.personId)) {
                refusal = forbidden();
                return refusal;
              }
              personIds.add(person.personId);
            }
            const identity = resolveContributionIdentityBinding(registry, principal.subject);
            const person = identity && people.find(person =>
              isIdentityPerson(person) && person.personId === identity.personId && person.status === "active");
            const state = authority.value.snapshot;
            const member = state.memberships.find(member => member.subject === principal.subject);
            const allowed = (atMs: number) => evaluateAuthorization(principal, state, {
              tenantId, datasetId, operation: "access", capability, expectedPolicyRevision: state.revision,
            }, atMs).status === "allowed";
            // Writes validate a complete candidate, so they also require read authority.
            const readable = (atMs: number) => !mutating || evaluateAuthorization(principal, state, {
              tenantId, datasetId, operation: "access", capability: "read", expectedPolicyRevision: state.revision,
            }, atMs).status === "allowed";
            if (!identity || !person || !member || !allowed(nowMs) || !readable(nowMs)) {
              refusal = forbidden();
              return refusal;
            }
            let completed = false;
            transaction.beforeCommit(() => {
              const commitTime = transaction.nowMs();
              if (refusal || !active || !isCounter(commitTime) || commitTime < nowMs
                || !allowed(commitTime) || !readable(commitTime)) {
                refusal = forbidden();
                throw new Error("Trusted execution authority expired before completion.");
              }
              if (!completed) {
                completed = true;
                completedTransactions += 1;
              }
            });
            authorizedTransactions += 1;
            return Object.freeze({
              status: "authorized", subject: principal.subject, personId: identity.personId,
              bindingId: identity.bindingId, registryRevision: registry.revision,
              bindingRevision: registry.bindingRevision, tenantId, policyRevision: state.revision,
              membershipRevision: member.revision,
            });
          } catch {
            refusal = unavailable("not-submitted");
            return refusal;
          }
        },
      });
      submitted = true;
      const result = await invoke(repository, validated.value);
      if (isObject(result) && (result.status === "unavailable" || result.status === "failed")
        && result.outcome === "unknown") return result;
      if (refusal) return refusal;
      // Detect an incorrectly wired adapter without disclosing its result. This does
      // not make untrusted adapter code safe: locked invocation is an installation contract.
      if (authorizedTransactions === 0 || completedTransactions !== authorizedTransactions) {
        // Definite backend failures need no success attestation.
        if (isObject(result) && (result.status === "unavailable" || result.status === "failed")) return result;
        return unavailable(mutating ? "unknown" : "not-submitted");
      }
      return result;
    } catch {
      // Once a writer is invoked, a thrown exception cannot prove rollback.
      return unavailable(mutating && submitted ? "unknown" : "not-submitted");
    } finally {
      active = false;
    }
  }

  return Object.freeze({
    readSnapshot(request: Request, input: unknown) {
      return execute(request, input, validateSnapshotRequest, input => input.datasetId, "read", false,
        (repository, input) => repository.readSnapshot(input));
    },
    writeBatch(request: Request, input: unknown) {
      return execute(request, input, validateWriteBatch, input => input.fence.datasetId, "write", true,
        (repository, input) => repository.writeBatch(input));
    },
    lookupCommit(request: Request, input: unknown) {
      return execute(request, input, validateCommitLookup, input => input.datasetId, "write", false,
        (repository, input) => repository.lookupCommit(input));
    },
  });
}
