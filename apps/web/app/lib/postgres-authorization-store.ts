import { randomUUID } from "node:crypto";
import { versions } from "node:process";
import type { PoolClient } from "pg";
import type {
  AuthorizationAuditEvidence, AuthorizationStoreResult, AuthorizationTransactionValue, LockedAuthorizationTransaction,
  SensitivePersistenceCommand, TransactionalAuthorizationStore,
  TransactionAuthorizationRequest,
} from "./authorization-transaction-contract";
import { validateAuthorityTransition, validateDurableAuthorityState, type DurableAuthorityState } from "./durable-authorization-state";
import { isAuthorityIdentifier } from "./authorization-policy";
import { isCounter, validateWriteBatch } from "./server-persistence-contract";
import { authorizationRequestContent } from "./authorization-transaction";

if (!versions.node) throw new Error("PostgreSQL authorization requires the Node.js runtime.");

export type AuthorizationPostgresConnection = Pick<PoolClient, "query" | "release">;
export type AuthorizationPostgresSource = Readonly<{
  // Server-owned verified TLS pool or verified disposable test connection. No env fallback.
  // The effective role must be provisioned for this actor; never share it across subjects.
  connect(): Promise<AuthorizationPostgresConnection>;
}>;

function counter(value: unknown): number {
  const number = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (!isCounter(number)) throw new Error("Invalid PostgreSQL authorization counter.");
  return number;
}
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

export function createPostgresAuthorizationStore(source: AuthorizationPostgresSource): TransactionalAuthorizationStore {
  return Object.freeze({
    async runLocked(
      tenantId: string,
      operation: (transaction: LockedAuthorizationTransaction) => Promise<AuthorizationTransactionValue>,
      request?: TransactionAuthorizationRequest,
    ): Promise<AuthorizationStoreResult> {
      if (!isAuthorityIdentifier(tenantId)) return {
        status: "unavailable", outcome: "not-submitted", message: "Invalid authoritative tenant scope.",
      };
      let client: AuthorizationPostgresConnection;
      try {
        client = await source.connect();
      } catch {
        return { status: "unavailable", outcome: "not-submitted", message: "Authorization storage is unavailable." };
      }
      let beginSent = false;
      let commitSent = false;
      let destroy = false;
      let active = true;
      let clock = 0;
      let state: DurableAuthorityState;
      const auditState: { evidence?: AuthorizationAuditEvidence } = {};
      let persistenceWrites = 0;
      let stagedIdempotencyKey: string | undefined;
      let authorityWrites = 0;
      let proposedState: DurableAuthorityState | undefined;
      let stagedCommand: SensitivePersistenceCommand | undefined;
      const guards: (() => void)[] = [];
      const transactionId = randomUUID();
      const assertActive = () => { if (!active) throw new Error("Authorization transaction context expired."); };
      async function refreshClock() {
        const result = await client.query<{ now_ms: string }>("SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS now_ms");
        const next = counter(result.rows[0]?.now_ms);
        if (next < clock) throw new Error("Database clock moved backwards.");
        clock = next;
      }
      try {
        if (!request || request.tenantId !== tenantId) throw new Error("Authorization request binding is required.");
        beginSent = true;
        const started = await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        if (started.command !== "BEGIN") throw new Error("Database did not confirm BEGIN.");
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '10s'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
        const role = await client.query<{ unsafe: boolean }>(`SELECT
          r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolreplication OR
          EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname IN ('empire_os_authorization','empire_os_preparation') AND
              (c.relowner=r.oid OR (c.relkind='r' AND (
                has_any_column_privilege(current_user,c.oid,'INSERT') OR
                has_any_column_privilege(current_user,c.oid,'UPDATE') OR
                has_table_privilege(current_user,c.oid,'DELETE') OR
                has_table_privilege(current_user,c.oid,'TRUNCATE'))))) AS unsafe
          FROM pg_roles r WHERE r.rolname=current_user`);
        if (role.rows.length !== 1 || role.rows[0].unsafe !== false) throw new Error("Unsafe authorization database identity.");
        // READ COMMITTED creates a fresh snapshot AFTER any concurrent row-lock waiter.
        const locked = await client.query<{ state: unknown; revision: string }>(
          "SELECT state,revision::text FROM empire_os_authorization.lock_authority($1)", [tenantId],
        );
        if (locked.rows.length !== 1) throw new Error("Tenant authority unavailable.");
        const loaded = validateDurableAuthorityState(locked.rows[0].state);
        if (loaded.status !== "valid" || loaded.value.snapshot.tenant.id !== tenantId
          || loaded.value.snapshot.revision !== counter(locked.rows[0].revision)) throw new Error("Inconsistent authority state.");
        state = structuredClone(loaded.value);
        const mapped = await client.query<{ dataset_id: string }>(
          "SELECT dataset_id::text FROM empire_os_authorization.datasets WHERE tenant_id=$1 ORDER BY dataset_id", [tenantId],
        );
        if (!same(mapped.rows.map((row) => row.dataset_id).sort(), state.snapshot.datasets.map((entry) => entry.datasetId).sort())) {
          throw new Error("Authority dataset mapping is inconsistent.");
        }
        await refreshClock();
        const value = await operation({
          transactionId,
          loadAuthority: async () => { assertActive(); return structuredClone(state); },
          nowMs: () => { assertActive(); return clock; },
          beforeCommit: (guard: () => void) => { assertActive(); guards.push(guard); },
          stageAuthority: async (next: DurableAuthorityState) => {
            assertActive();
            if (authorityWrites || persistenceWrites) throw new Error("Only one sensitive operation is allowed.");
            const validated = validateAuthorityTransition(state, next, clock);
            if (validated.status !== "valid") throw new Error("Invalid authority transition.");
            proposedState = structuredClone(validated.value);
            state = structuredClone(validated.value);
            authorityWrites += 1;
            await refreshClock();
          },
          stagePersistence: async (command: SensitivePersistenceCommand) => {
            assertActive();
            if (authorityWrites || persistenceWrites) throw new Error("Only one sensitive operation is allowed.");
            if (command.kind !== "write") throw new Error("PostgreSQL import staging is not implemented.");
            const batch = validateWriteBatch(command.request);
            if (batch.status !== "valid") throw new Error("Invalid preparation write.");
            const request = batch.value;
            if (!state.snapshot.datasets.some((entry) => entry.datasetId === request.fence.datasetId)) throw new Error("Invalid tenant dataset.");
            const fence = await client.query<{ generation: string; authority_revision: string; authority_mode: string }>(
              `SELECT generation::text,authority_revision::text,authority_mode FROM empire_os_authorization.datasets
               WHERE tenant_id=$1 AND dataset_id=$2`, [tenantId, request.fence.datasetId],
            );
            if (fence.rows.length !== 1 || fence.rows[0].authority_mode !== "preparation-only"
              || counter(fence.rows[0].generation) !== request.fence.generation
              || counter(fence.rows[0].authority_revision) !== request.fence.authorityRevision) throw new Error("Preparation dataset fence mismatch.");
            const revisions = await client.query<{ store_key: string; revision: string }>(
              `SELECT store_key,max(revision)::text AS revision FROM empire_os_authorization.preparation_writes
               WHERE tenant_id=$1 AND dataset_id=$2 GROUP BY store_key`, [tenantId, request.fence.datasetId],
            );
            const current = new Map(revisions.rows.map((row) => [row.store_key, counter(row.revision)]));
            for (const entry of [...request.reads, ...request.writes]) {
              if ((current.get(entry.key) ?? 0) !== entry.expectedRevision) throw new Error("Preparation store revision conflict.");
            }
            stagedCommand = structuredClone(command);
            persistenceWrites += 1;
            stagedIdempotencyKey = request.idempotencyKey;
            await refreshClock();
          },
          appendAudit: async (evidence: AuthorizationAuditEvidence) => {
            assertActive();
            if (auditState.evidence || evidence.tenantId !== tenantId || evidence.transactionId !== transactionId
              || evidence.resultingPolicyRevision !== state.snapshot.revision
              || (stagedIdempotencyKey !== undefined && stagedIdempotencyKey !== evidence.operationId)) {
              throw new Error("Invalid atomic audit scope or idempotency identity.");
            }
            const stagedAudit = structuredClone(evidence);
            if (stagedCommand && !same(stagedCommand, request.command)) throw new Error("Staged request differs from bound request.");
            await client.query("SELECT empire_os_authorization.apply_operation($1::text,$2::jsonb,$3::jsonb)",
              [authorizationRequestContent(request), JSON.stringify(stagedAudit), proposedState ? JSON.stringify(proposedState) : null]);
            auditState.evidence = stagedAudit;
            await refreshClock();
          },
        });
        const committedAudit = auditState.evidence;
        if (!committedAudit || !same(value.audit, committedAudit) || !same(value.decision, committedAudit.decision) || guards.length !== 1
          || (value.decision.status === "allowed" ? persistenceWrites + authorityWrites !== 1 : persistenceWrites + authorityWrites !== 0)) {
          throw new Error("Atomic authorization audit requirement failed.");
        }
        await refreshClock();
        guards[0]();
        // Deferred database checks (including expiry) run during COMMIT, not SET CONSTRAINTS.
        commitSent = true;
        const committed = await client.query("COMMIT");
        if (committed.command !== "COMMIT") throw new Error("Database did not confirm COMMIT.");
        active = false;
        return { status: "committed", durability: "transaction-commit-confirmed", transactionId,
          auditDecisionId: committedAudit.decisionId, value };
      } catch {
        active = false;
        destroy = commitSent;
        if (commitSent) return { status: "unavailable", outcome: "unknown", message: "Authorization COMMIT outcome could not be confirmed." };
        if (beginSent) {
          try {
            const rollback = await client.query("ROLLBACK");
            if (rollback.command !== "ROLLBACK") throw new Error("Database did not confirm ROLLBACK.");
            return { status: "failed", outcome: "rolled-back", message: "Authorization transaction rolled back." };
          } catch {
            destroy = true;
            return { status: "unavailable", outcome: "unknown", message: "Authorization rollback could not be confirmed." };
          }
        }
        destroy = true;
        return { status: "unavailable", outcome: "not-submitted", message: "Authorization transaction could not start." };
      } finally {
        active = false;
        client.release(destroy);
      }
    },
  });
}
