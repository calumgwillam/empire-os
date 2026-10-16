import "server-only";
import { createHash } from "node:crypto";
import { isAuthorityIdentifier } from "./authorization-policy";
import {
  isContributionIdentityRegistry, previewContributionIdentityOperation,
  IDENTITY_REAUTHENTICATION_WINDOW_MS,
  type ContributionIdentityPlan, type IdentityAuthorityObservation, type VerifiedIdentityClaim,
} from "./contribution-identity-authority";
import { contributionIdentityRelease } from "./contribution-identity-release";
import {
  beginRestrictedTransaction, type AuthorizationPostgresConnection, type AuthorizationPostgresSource,
} from "./postgres-authorization-store";
import { restrictedSourceBinding } from "./restricted-postgres-provider";
import { isAuthenticatedPrincipal, type AuthenticatedPrincipal } from "./server-persistence-authority";
import { isCounter, isIdempotencyKey, isObject } from "./server-persistence-contract";

export type IdentityPersistenceResult =
  | Readonly<{ status: "disabled" }>
  | Readonly<{ status: "denied"; reason: string }>
  | Readonly<{ status: "conflict"; reason: string }>
  | Readonly<{ status: "unavailable"; outcome: "not-submitted" }>
  | Readonly<{ status: "failed"; outcome: "rolled-back" | "unknown" }>
  | Readonly<{
    status: "committed" | "replayed";
    operationId: string;
    eventId: string;
    registryRevision: number;
    requiresSessionRevocation: boolean;
    durability: "transaction-commit-confirmed";
  }>;

export type IdentityPersistenceDependencies = Readonly<{
  // Trusted server installation only. Called after the database locks are held.
  // Resolve People, fresh sessions and independent proof from authoritative sources,
  // never from input. The issuer separately records this exact planner decision in
  // approved_operations; this restricted connection cannot mint approval records.
  observe(
    client: AuthorizationPostgresConnection,
    principal: AuthenticatedPrincipal,
    approvalPrincipal: AuthenticatedPrincipal | null,
    nowMs: number,
  ): Promise<Readonly<{ authority: unknown; claim: VerifiedIdentityClaim | null }>>;
}>;

export const IDENTITY_LOCK_SQL = `SELECT registry,actor_subject,now_ms::text,receipt
  FROM empire_os_identity.lock_operation($1::text,$2::text,$3::text)`;
export const IDENTITY_APPLY_SQL = `SELECT registry,receipt
  FROM empire_os_identity.consume_operation($1::text,$2::text,$3::text,$4::jsonb)`;
export const IDENTITY_CONTRACT_SQL = `SELECT
  (SELECT count(*)=3 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.oid IN (to_regprocedure('empire_os_identity.lock_operation(text,text,text)'),
      to_regprocedure('empire_os_identity.consume_operation(text,text,text,jsonb)'),
      to_regprocedure('empire_os_identity.runtime_actor(text)'))
      AND p.proowner=n.nspowner AND p.prosecdef
      AND n.nspowner=(SELECT nspowner FROM pg_namespace WHERE nspname='empire_os_authorization')
      AND p.proconfig @> ARRAY['search_path=pg_catalog']
      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))
  AND (SELECT count(*)=6 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='empire_os_identity' AND c.relname IN
      ('identity_registry','approved_operations','identity_events','active_bindings','administrator_grants','session_revocations')
      AND c.relrowsecurity AND c.relforcerowsecurity)
  AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('empire_os_identity.identity_events')
    AND tgname='identity_completion' AND tgdeferrable AND tginitdeferred AND tgenabled IN ('O','A'))
  AND (SELECT count(*)=2 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='empire_os_identity' AND i.indisvalid AND i.indisunique
      AND c.relname IN ('one_use_per_identity_verification','one_active_identity_grant_per_tenant'))
  AND (SELECT count(*)=2 FROM pg_constraint c JOIN pg_index i ON i.indexrelid=c.conindid
    WHERE c.conrelid=to_regclass('empire_os_identity.active_bindings') AND c.contype='u'
      AND c.convalidated AND i.indisvalid AND i.indisunique
      AND c.conname IN ('active_bindings_subject_key','active_bindings_person_id_key'))
  AND NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('identity_registry','trusted_statement'),('approved_operations','trusted_statement'),
      ('identity_events','trusted_statement'),('active_bindings','trusted_statement'),
      ('administrator_grants','trusted_statement'),('session_revocations','trusted_statement'),
      ('identity_events','immutable_identity_events'),('approved_operations','immutable_identity_approvals'),
      ('session_revocations','immutable_session_revocations'),
      ('identity_events','no_identity_history_truncate'),('approved_operations','no_identity_approval_truncate'),
      ('session_revocations','no_session_revocation_truncate')
    ) required(table_name,trigger_name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid=to_regclass('empire_os_identity.'||required.table_name)
        AND t.tgname=required.trigger_name AND t.tgenabled IN ('O','A')))
  AS ready`;

function counter(value: unknown): number {
  const parsed = typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (!isCounter(parsed)) throw new Error("Invalid identity database revision.");
  return parsed;
}

// Sort object keys only; event and capability ordering is part of the request.
export function identityPersistenceRequestText(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) throw new Error("Sparse identity request.");
    const entries: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const entry = Object.getOwnPropertyDescriptor(value, String(index));
      if (!entry || !("value" in entry)) throw new Error("Identity request accessors are forbidden.");
      entries.push(identityPersistenceRequestText(entry.value));
    }
    return `[${entries.join(",")}]`;
  }
  if (isObject(value)) {
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== "string") || keys.length !== Object.keys(value).length) {
      throw new Error("Invalid identity request keys.");
    }
    return `{${Object.keys(value).sort().map(key => {
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (!field || !("value" in field) || !field.enumerable) throw new Error("Identity request accessors are forbidden.");
      return `${JSON.stringify(key)}:${identityPersistenceRequestText(field.value)}`;
    }).join(",")}}`;
  }
  throw new Error("Invalid identity request value.");
}

// Produces an issuer record only, never writes or grants authority. Only the
// separately installed trusted issuer may insert it into approved_operations.
export function prepareIdentityPersistenceApproval(options: Readonly<{
  principal: AuthenticatedPrincipal;
  approvalPrincipal: AuthenticatedPrincipal | null;
  registry: unknown;
  authority: IdentityAuthorityObservation;
  request: unknown;
  claim: VerifiedIdentityClaim | null;
  nowMs: number;
  issuerReference: string;
  verification: Readonly<{
    verifiedBySubject: string;
    verifierReference: string;
    evidenceSha256: string;
  }> | null;
}>) {
  const decision = previewContributionIdentityOperation(options.principal, options.approvalPrincipal,
    options.registry, options.authority, options.request, options.claim, options.nowMs);
  if (decision.status === "denied") throw new Error(`Identity approval denied: ${decision.reason}`);
  if (!isAuthorityIdentifier(options.issuerReference)) throw new Error("Identity issuer reference required.");
  const event = decision.plan.event;
  const needsProof = event.kind === "subject-bound" || event.kind === "binding-reassigned";
  if (needsProof && (!options.verification || !/^[a-f0-9]{64}$/.test(options.verification.evidenceSha256)
    || !isAuthorityIdentifier(options.verification.verifierReference)
    || typeof options.verification.verifiedBySubject !== "string"
    || !/^user_[A-Za-z0-9_]+$/.test(options.verification.verifiedBySubject)
    || options.verification.verifiedBySubject.length > 512
    || options.verification.verifiedBySubject === options.claim?.subject)) {
    throw new Error("Independent identity evidence provenance required.");
  }
  const expiryTimes = [options.nowMs + IDENTITY_REAUTHENTICATION_WINDOW_MS, options.authority.validUntilMs];
  for (const subject of [options.principal.subject, options.approvalPrincipal?.subject]) {
    if (!subject) continue;
    const auth = options.authority.recentAuthentications.find(entry => entry.subject === subject);
    if (!auth) throw new Error("Fresh issuer authentication unavailable.");
    expiryTimes.push(auth.authenticatedAtMs + IDENTITY_REAUTHENTICATION_WINDOW_MS);
  }
  if (options.claim) expiryTimes.push(options.claim.verifiedAtMs + IDENTITY_REAUTHENTICATION_WINDOW_MS);
  const expiresAtMs = Math.min(...expiryTimes);
  if (!isCounter(expiresAtMs) || expiresAtMs <= options.nowMs) throw new Error("Identity approval has no remaining lifetime.");
  const requestText = identityPersistenceRequestText(options.request);
  return Object.freeze({
    operationId: decision.plan.operationId, tenantId: decision.plan.scopeTenantId,
    actorSubject: options.principal.subject, requestText,
    requestSha256: createHash("sha256").update(requestText).digest("hex"),
    plan: decision.plan, checkedAtMs: options.nowMs, expiresAtMs,
    issuerReference: options.issuerReference,
    verification: needsProof && options.claim && options.verification ? {
      verificationId: options.claim.verificationId, tenantId: options.claim.tenantId,
      subject: options.claim.subject, personId: options.claim.personId,
      verifiedAtMs: options.claim.verifiedAtMs,
      verifiedBySubject: options.verification.verifiedBySubject,
      verifierReference: options.verification.verifierReference, evidenceSha256: options.verification.evidenceSha256,
    } : {},
  });
}

function receipt(value: unknown, operationId: string, digest: string, actor: string, tenantId: string) {
  if (!isObject(value) || value.operationId !== operationId || value.requestSha256 !== digest
    || value.actorSubject !== actor || value.tenantId !== tenantId
    || typeof value.eventId !== "string" || !value.eventId
    || !isCounter(value.registryRevision) || value.registryRevision === 0
    || typeof value.requiresSessionRevocation !== "boolean") throw new Error("Invalid identity commit receipt.");
  return {
    operationId, eventId: value.eventId, registryRevision: value.registryRevision,
    requiresSessionRevocation: value.requiresSessionRevocation,
    durability: "transaction-commit-confirmed" as const,
  };
}

function sqlFailure(error: unknown): IdentityPersistenceResult {
  if (isObject(error) && error.code === "42501") return { status: "denied", reason: "database-authority-required" };
  if (isObject(error) && ["40001", "40P01", "23505", "55P03"].includes(String(error.code))) {
    return { status: "conflict", reason: "identity-concurrency-conflict" };
  }
  return { status: "failed", outcome: "rolled-back" };
}

export function createPostgresContributionIdentityStore(
  source: AuthorizationPostgresSource,
  dependencies: IdentityPersistenceDependencies,
) {
  return Object.freeze({
    async execute(principal: unknown, approvalPrincipal: AuthenticatedPrincipal | null, input: unknown): Promise<IdentityPersistenceResult> {
      if (!isAuthenticatedPrincipal(principal)) return { status: "denied", reason: "authentication-required" };
      if (approvalPrincipal !== null && !isAuthenticatedPrincipal(approvalPrincipal)) {
        return { status: "denied", reason: "independent-authentication-required" };
      }
      if (contributionIdentityRelease().status !== "approved") return { status: "disabled" };
      let text: string;
      try { text = identityPersistenceRequestText(input); } catch { return { status: "denied", reason: "invalid-request" }; }
      // Snapshot before awaiting; caller mutation cannot change the bound request.
      const request: unknown = JSON.parse(text);
      if (!isObject(request) || typeof request.tenantId !== "string" || !isIdempotencyKey(request.operationId)) {
        return { status: "denied", reason: "invalid-request" };
      }
      const tenantId = request.tenantId;
      const operationId = request.operationId;
      const binding = restrictedSourceBinding(source);
      if (!binding || binding.subject !== principal.subject || binding.tenantId !== tenantId) {
        return { status: "denied", reason: "restricted-principal-source-required" };
      }
      const digest = createHash("sha256").update(text).digest("hex");
      let client: AuthorizationPostgresConnection;
      try { client = await source.connect(); } catch { return { status: "unavailable", outcome: "not-submitted" }; }
      let destroy = false;
      let commitSent = false;
      try {
        await beginRestrictedTransaction(client);
        const contract = await client.query<{ ready: unknown }>(IDENTITY_CONTRACT_SQL);
        if (contract.rows.length !== 1 || contract.rows[0].ready !== true) throw new Error("Identity database contract unavailable.");
        const locked = await client.query<{
          registry: unknown; actor_subject: unknown; now_ms: unknown; receipt: unknown;
        }>(IDENTITY_LOCK_SQL, [tenantId, operationId, digest]);
        if (locked.rows.length !== 1) throw new Error("Invalid locked identity authority.");
        const row = locked.rows[0];
        const registry = row.registry;
        if (row.actor_subject !== principal.subject || !isContributionIdentityRegistry(registry)) {
          throw new Error("Invalid locked identity authority.");
        }
        let result: IdentityPersistenceResult;
        if (row.receipt !== null) {
          const replay = receipt(row.receipt, operationId, digest, principal.subject, tenantId);
          const event = registry.events.find(entry => entry.eventId === replay.eventId && entry.operationId === operationId);
          if (!event || event.actorSubject !== principal.subject || event.tenantId !== tenantId
            || event.sequence !== replay.registryRevision
            || replay.requiresSessionRevocation !== ["binding-revoked", "binding-reassigned", "administrator-revoked"].includes(event.kind)) {
            throw new Error("Dangling identity replay.");
          }
          // The SQL lookup checks CURRENT membership/admin authority even on replay.
          result = { status: "replayed", ...replay };
        } else {
          const nowMs = counter(row.now_ms);
          const observed = await dependencies.observe(client, principal, approvalPrincipal, nowMs);
          const decision = previewContributionIdentityOperation(
            principal, approvalPrincipal, registry, observed.authority, request, observed.claim, nowMs,
          );
          if (decision.status === "denied") {
            const rolledBack = await client.query("ROLLBACK");
            if (rolledBack.command !== "ROLLBACK") throw new Error("Unconfirmed identity rollback.");
            if (["stale-authority", "active-identity-binding-conflict", "identity-operation-reused"].includes(decision.reason)) {
              return { status: "conflict", reason: decision.reason };
            }
            return decision;
          }
          const plan: ContributionIdentityPlan = decision.plan;
          const applied = await client.query<{ registry: unknown; receipt: unknown }>(
            IDENTITY_APPLY_SQL, [tenantId, operationId, text, JSON.stringify(plan)],
          );
          if (applied.rows.length !== 1) throw new Error("Invalid identity mutation result.");
          const after = applied.rows[0].registry;
          if (!isContributionIdentityRegistry(after) || after.revision !== registry.revision + 1
            || identityPersistenceRequestText(after.events) !== identityPersistenceRequestText([...registry.events, plan.event])) {
            throw new Error("Identity mutation did not append the planned event.");
          }
          const committed = receipt(applied.rows[0].receipt, operationId, digest, principal.subject, tenantId);
          if (committed.registryRevision !== after.revision || committed.eventId !== plan.event.eventId
            || committed.requiresSessionRevocation !== plan.requiresSessionRevocation) throw new Error("Identity receipt mismatch.");
          result = { status: "committed", ...committed };
        }
        commitSent = true;
        const committed = await client.query("COMMIT");
        if (committed.command !== "COMMIT") throw new Error("Unconfirmed identity commit.");
        return result;
      } catch (error) {
        // Once COMMIT may have reached PostgreSQL, ROLLBACK cannot establish absence.
        if (commitSent) {
          destroy = true;
          return { status: "failed", outcome: "unknown" };
        }
        try {
          const rolledBack = await client.query("ROLLBACK");
          if (rolledBack.command !== "ROLLBACK") throw new Error("Unconfirmed identity rollback.");
        } catch {
          destroy = true;
          return { status: "failed", outcome: "unknown" };
        }
        return sqlFailure(error);
      } finally {
        client.release(destroy);
      }
    },
  });
}
