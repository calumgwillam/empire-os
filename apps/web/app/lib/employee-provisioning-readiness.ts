import "server-only";
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { evaluateAuthorization, isAuthorityIdentifier } from "./authorization-policy";
import { validateDurableAuthorityState } from "./durable-authorization-state";
import { employeeProvisioningRelease } from "./employee-provisioning-release";
import {
  beginRestrictedTransaction, type AuthorizationPostgresConnection, type AuthorizationPostgresSource,
} from "./postgres-authorization-store";
import { PROVISIONING_CONTRACT_SQL } from "./postgres-employee-provisioning-store";
import { restrictedSourceBinding, RESTRICTED_LEASE_IDENTITY_SQL } from "./restricted-postgres-provider";
import {
  createServerPrincipalResolver, isAuthenticatedPrincipal, type AuthenticatedPrincipal, type ServerSessionResolution,
} from "./server-persistence-authority";
import { hasOnlyFields, isCounter, isObject, isSha256 } from "./server-persistence-contract";

export const PROVISIONING_READINESS_CONTROLS = [
  "postgres-integration", "production-tls-identity", "rollback-drill", "recovery-drill",
] as const;
type Control = typeof PROVISIONING_READINESS_CONTROLS[number];
export type ProvisioningReadinessTarget = Readonly<{
  environment: "production"; environmentId: string; deploymentId: string;
  artifactSha256: string; databaseIdentitySha256: string; tenantId: string;
}>;
type Finding = Readonly<{
  control: Control | "authentication" | "migration-approval" | "schema-audit" | "connection-actor";
  status: "verified" | "unverified" | "failed" | "blocked";
  reason: string;
}>;
export type ProvisioningReadinessAssessment = Readonly<{
  activation: "blocked";
  assurance: "verified" | "unverified" | "failed";
  findings: readonly Finding[];
}>;
export type ReadinessAttestationSource = Readonly<{
  // Trusted server repository lookup, never submitted evidence or a client callback.
  read(target: ProvisioningReadinessTarget, subject: string): Promise<unknown>;
  readReport(evidenceSha256: string): Promise<unknown>;
}>;
export const REQUIRED_READINESS_CHECKS: Readonly<Record<Control, readonly string[]>> = Object.freeze({
  "postgres-integration": Object.freeze(["founder-success", "employee-denial", "actor-binding", "tenant-isolation",
    "revision-fence", "replay-denial", "atomic-audit", "rollback", "concurrent-requests", "uncertain-outcome-reconciliation"]),
  "production-tls-identity": Object.freeze(["certificate-chain", "hostname-match", "restricted-login",
    "tenant-actor-binding", "no-privileged-fallback"]),
  "rollback-drill": Object.freeze(["stop-new-dispatch", "preserve-data-and-audits",
    "drain-or-reconcile-inflight", "no-automatic-retry", "no-schema-reversal"]),
  "recovery-drill": Object.freeze(["restore-tested", "authority-audit-consistency", "immutable-audits",
    "environment-identity-reverified", "unknown-outcomes-reconciled"]),
});
export type ReadinessTrustKey = Readonly<{
  keyId: string; publicKeyPem: string; controls: readonly Control[];
}>;

// Captures definitions AND security settings rather than trusting object names alone.
// Attested digest must be independently generated for the reviewed deployment catalog.
export const PROVISIONING_CATALOG_SQL = `SELECT coalesce(jsonb_agg(item ORDER BY item::text),'[]'::jsonb)::text AS catalog
FROM (
  SELECT jsonb_build_array('schema',n.nspname,n.nspowner::regrole::text,n.nspacl::text) AS item
    FROM pg_namespace n WHERE n.nspname IN ('empire_os_authorization','empire_os_preparation')
  UNION ALL
  SELECT jsonb_build_array('routine',p.oid::regprocedure::text,p.prokind,p.proowner::regrole::text,
    p.proacl::text,pg_get_functiondef(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('empire_os_authorization','empire_os_preparation') AND p.prokind IN ('f','p','w')
  UNION ALL
  SELECT jsonb_build_array('relation',n.nspname,c.relname,c.relkind,c.relowner::regrole::text,
    c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,c.reloptions,
    CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,false) ELSE NULL END)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('empire_os_authorization','empire_os_preparation') AND c.relkind IN ('r','p','v','m','f')
  UNION ALL
  SELECT jsonb_build_array('column',a.attrelid::regclass::text,a.attname,
    format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attacl::text,a.attidentity,a.attgenerated,
    (SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum))
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('empire_os_authorization','empire_os_preparation')
      AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT jsonb_build_array('rule',r.ev_class::regclass::text,r.rulename,r.ev_enabled,pg_get_ruledef(r.oid,false))
    FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('empire_os_authorization','empire_os_preparation')
  UNION ALL
  SELECT jsonb_build_array('constraint',c.conrelid::regclass::text,c.conname,c.convalidated,pg_get_constraintdef(c.oid))
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname IN ('empire_os_authorization','empire_os_preparation')
  UNION ALL
  SELECT jsonb_build_array('index',i.indrelid::regclass::text,i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid))
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname IN ('empire_os_authorization','empire_os_preparation')
  UNION ALL
  SELECT jsonb_build_array('trigger',t.tgrelid::regclass::text,t.tgenabled,pg_get_triggerdef(t.oid))
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('empire_os_authorization','empire_os_preparation') AND NOT t.tgisinternal
  UNION ALL
  SELECT jsonb_build_array('policy',p.polrelid::regclass::text,p.polname,p.polcmd,p.polpermissive,
    (SELECT jsonb_agg(CASE WHEN role=0 THEN 'PUBLIC' ELSE role::regrole::text END ORDER BY role::regrole::text)
      FROM unnest(p.polroles) role),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('empire_os_authorization','empire_os_preparation')
) objects`;

function exact(value: Record<string, unknown>, fields: readonly string[]) {
  return Object.keys(value).length === fields.length && hasOnlyFields(value, fields);
}
function targetValid(value: ProvisioningReadinessTarget) {
  return isObject(value) && exact(value, ["environment", "environmentId", "deploymentId", "artifactSha256", "databaseIdentitySha256", "tenantId"])
    && value.environment === "production" && isAuthorityIdentifier(value.environmentId)
    && isAuthorityIdentifier(value.deploymentId) && isAuthorityIdentifier(value.tenantId)
    && isSha256(value.artifactSha256) && isSha256(value.databaseIdentitySha256);
}
function matchesTarget(value: unknown, target: ProvisioningReadinessTarget) {
  return isObject(value) && exact(value, Object.keys(target))
    && Object.entries(target).every(([key, expected]) => value[key] === expected);
}

export function createEmployeeProvisioningReadinessGate(dependencies: Readonly<{
  target: ProvisioningReadinessTarget;
  resolveSession(request: Request): Promise<ServerSessionResolution>;
  sourceForPrincipal(principal: AuthenticatedPrincipal): AuthorizationPostgresSource;
  attestations: ReadinessAttestationSource;
  trustKeys: readonly ReadinessTrustKey[];
  // Server policy, not request parameters. No default/fake freshness thresholds.
  maxEvidenceAgeMs: number;
  nowMs(): number;
}>) {
  if (!targetValid(dependencies.target) || !isCounter(dependencies.maxEvidenceAgeMs)
    || dependencies.maxEvidenceAgeMs === 0 || dependencies.trustKeys.length === 0) {
    throw new Error("Invalid provisioning readiness trust configuration.");
  }
  const target = Object.freeze({ ...dependencies.target });
  const maxAge = dependencies.maxEvidenceAgeMs;
  const keys = new Map<string, { key: KeyObject; controls: readonly Control[] }>();
  for (const entry of dependencies.trustKeys) {
    if (!isAuthorityIdentifier(entry.keyId) || keys.has(entry.keyId) || entry.controls.length === 0
      || entry.controls.some(control => !PROVISIONING_READINESS_CONTROLS.includes(control))
      || new Set(entry.controls).size !== entry.controls.length) throw new Error("Invalid readiness trust key scope.");
    let key: KeyObject;
    try { key = createPublicKey(entry.publicKeyPem); } catch { throw new Error("Invalid readiness public verification key."); }
    if (key.asymmetricKeyType !== "ed25519") throw new Error("Readiness requires Ed25519 verification keys.");
    keys.set(entry.keyId, { key, controls: Object.freeze([...entry.controls]) });
  }
  const resolvePrincipal = createServerPrincipalResolver(dependencies.resolveSession);
  const { sourceForPrincipal, attestations, nowMs } = dependencies;

  return Object.freeze({
    // Assessment cannot accept caller claims and never returns an activation token.
    async assess(request: Request, submittedEvidence?: unknown): Promise<ProvisioningReadinessAssessment> {
      const findings: Finding[] = [];
      const finish = (): ProvisioningReadinessAssessment => Object.freeze({
        activation: "blocked",
        assurance: findings.some(f => f.status === "failed") ? "failed"
          : findings.some(f => f.status === "unverified" || f.status === "blocked") ? "unverified" : "verified",
        findings: Object.freeze(findings.map(f => Object.freeze(f))),
      });
      const release = employeeProvisioningRelease();
      findings.push({
        control: "migration-approval", status: release.status === "approved" && release.migrationVersion === 5 ? "verified" : "blocked",
        reason: release.status === "approved" ? "existing-release-authority" : "migration-005-disabled",
      });
      if (submittedEvidence !== undefined) {
        findings.push({ control: "authentication", status: "failed", reason: "submitted-readiness-claims-rejected" });
        return finish();
      }
      const principal = await resolvePrincipal(request);
      if (!isAuthenticatedPrincipal(principal)) {
        findings.push({ control: "authentication", status: "unverified", reason: "verified-session-required" });
        return finish();
      }
      findings.push({ control: "authentication", status: "verified", reason: "server-principal" });
      let start: number;
      try { start = nowMs(); } catch {
        findings.push({ control: "authentication", status: "unverified", reason: "trusted-clock-unavailable" });
        return finish();
      }
      if (!isCounter(start)) {
        findings.push({ control: "authentication", status: "unverified", reason: "trusted-clock-invalid" });
        return finish();
      }
      let envelopes: unknown;
      try { envelopes = await attestations.read(target, principal.subject); } catch { envelopes = undefined; }
      const catalogDigests = new Set<string>();
      const validEvidence: Array<{ control: Control; observedAt: number; expiresAt: number }> = [];
      if (!Array.isArray(envelopes)) {
        for (const control of PROVISIONING_READINESS_CONTROLS) findings.push({ control, status: "unverified", reason: "trusted-evidence-unavailable" });
      } else {
        if (envelopes.length > PROVISIONING_READINESS_CONTROLS.length) {
          findings.push({ control: "schema-audit", status: "failed", reason: "ambiguous-or-excess-attestations" });
          return finish();
        }
        const seen = new Set<Control>();
        for (const envelope of envelopes) {
          try {
            if (!isObject(envelope) || !exact(envelope, ["keyId", "payload", "signature"])
              || typeof envelope.keyId !== "string" || typeof envelope.payload !== "string"
              || envelope.payload.length > 32768 || typeof envelope.signature !== "string"
              || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) throw new Error("Invalid envelope.");
            const trusted = keys.get(envelope.keyId);
            if (!trusted || !verify(null, Buffer.from(envelope.payload), trusted.key, Buffer.from(envelope.signature, "base64"))) {
              throw new Error("Untrusted provenance.");
            }
            const payload: unknown = JSON.parse(envelope.payload);
            if (!isObject(payload) || !exact(payload, ["version", "control", "target", "actorSubject", "observedAt", "expiresAt", "catalogSha256", "result", "method", "evidenceSha256"])
              || payload.version !== 1 || !PROVISIONING_READINESS_CONTROLS.some(c => c === payload.control)
              || !trusted.controls.some(c => c === payload.control) || !matchesTarget(payload.target, target)
              || payload.actorSubject !== principal.subject || !isCounter(payload.observedAt) || !isCounter(payload.expiresAt)
              || !isSha256(payload.catalogSha256) || !isSha256(payload.evidenceSha256)) throw new Error("Mismatched evidence.");
            const control = PROVISIONING_READINESS_CONTROLS.find(c => c === payload.control);
            if (!control) throw new Error("Unknown control.");
            if (seen.has(control)) throw new Error("Ambiguous evidence.");
            seen.add(control);
            const methods: Record<Control, string> = {
              "postgres-integration": "real-postgresql-16-reviewed-artifact",
              "production-tls-identity": "production-verified-tls-restricted-login",
              "rollback-drill": "production-stop-dispatch-preserve-data-reconcile-inflight",
              "recovery-drill": "production-restore-verified-audit-and-authority",
            };
            if (payload.result !== "passed" || payload.method !== methods[control]) {
              findings.push({ control, status: "failed", reason: "required-control-not-demonstrated" });
            } else if (payload.observedAt > start || payload.expiresAt <= start
              || payload.expiresAt <= payload.observedAt || payload.expiresAt - payload.observedAt > maxAge
              || start - payload.observedAt > maxAge) {
              findings.push({ control, status: "unverified", reason: "stale-or-future-evidence" });
            } else {
              let reportText: unknown;
              try { reportText = await attestations.readReport(payload.evidenceSha256); } catch { reportText = undefined; }
              if (reportText === undefined || reportText === null) {
                findings.push({ control, status: "unverified", reason: "signed-report-unavailable" });
              } else {
                if (typeof reportText !== "string" || reportText.length > 65536
                  || createHash("sha256").update(reportText).digest("hex") !== payload.evidenceSha256) {
                  throw new Error("Report digest mismatch.");
                }
                const report: unknown = JSON.parse(reportText);
                if (!isObject(report) || !exact(report, ["version", "control", "target", "actorSubject", "observedAt",
                  "execution", "catalogSha256", "checks", "failedChecks"])
                  || report.version !== 1 || report.control !== control || !matchesTarget(report.target, target)
                  || report.actorSubject !== principal.subject || report.observedAt !== payload.observedAt
                  || report.catalogSha256 !== payload.catalogSha256 || report.failedChecks !== 0
                  || report.execution !== (control === "postgres-integration" ? "real-postgresql-16" : "production")
                  || !Array.isArray(report.checks) || report.checks.length !== REQUIRED_READINESS_CHECKS[control].length
                  || new Set(report.checks).size !== report.checks.length
                  || !REQUIRED_READINESS_CHECKS[control].every(check => Array.isArray(report.checks) && report.checks.includes(check))) {
                  throw new Error("Required verified checks missing.");
                }
                catalogDigests.add(payload.catalogSha256);
                validEvidence.push({ control, observedAt: payload.observedAt, expiresAt: payload.expiresAt });
                findings.push({ control, status: "verified", reason: "pinned-key-environment-scoped-attestation" });
              }
            }
          } catch {
            findings.push({ control: "schema-audit", status: "failed", reason: "forged-malformed-or-contradictory-attestation" });
          }
        }
        for (const control of PROVISIONING_READINESS_CONTROLS) {
          if (!seen.has(control)) findings.push({ control, status: "unverified", reason: "missing-required-attestation" });
        }
      }
      if (catalogDigests.size > 1) findings.push({ control: "schema-audit", status: "failed", reason: "contradictory-catalog-attestations" });
      let source: AuthorizationPostgresSource;
      try { source = sourceForPrincipal(principal); } catch {
        findings.push({ control: "connection-actor", status: "unverified", reason: "restricted-source-unavailable" });
        return finish();
      }
      const binding = restrictedSourceBinding(source);
      if (!binding || binding.subject !== principal.subject || binding.tenantId !== target.tenantId
        || binding.databaseIdentitySha256 !== target.databaseIdentitySha256) {
        findings.push({ control: "connection-actor", status: "failed", reason: "unverified-source-or-environment-mismatch" });
        return finish();
      }
      let client: AuthorizationPostgresConnection;
      try { client = await source.connect(); } catch {
        findings.push({ control: "connection-actor", status: "unverified", reason: "connection-verification-unavailable" });
        return finish();
      }
      const live: Finding[] = [];
      let destroy = false;
      try {
        try {
          await beginRestrictedTransaction(client);
          const identity = await client.query(RESTRICTED_LEASE_IDENTITY_SQL);
          const row: unknown = identity.rows[0];
          if (identity.rows.length !== 1 || !isObject(row) || row.recovery !== false || row.tls !== true
            || row.database !== binding.database || row.login !== binding.login || row.effective !== binding.login
            || row.restricted !== true || row.standalone !== true || row.safe_schema !== true || row.safe_tables !== true
            || !Array.isArray(row.bindings) || row.bindings.length !== 1 || !isObject(row.bindings[0])
            || row.bindings[0].tenantId !== target.tenantId || row.bindings[0].subject !== principal.subject) {
            live.push({ control: "connection-actor", status: "failed", reason: "live-restricted-identity-mismatch" });
          } else {
            const locked = await client.query(`SELECT state,revision::text AS revision,actor_subject,authorized,records
              FROM empire_os_authorization.lookup_operation($1,$2)`, [target.tenantId, "provisioning:readiness"]);
            const observed = locked.rows[0];
            const loaded = validateDurableAuthorityState(observed?.state);
            const snapshot = loaded.status === "valid" ? loaded.value.snapshot : undefined;
            const datasetId = snapshot?.datasets[0]?.datasetId;
            if (locked.rows.length !== 1 || !snapshot || !datasetId || snapshot.tenant.id !== target.tenantId
              || String(snapshot.revision) !== observed.revision || observed.actor_subject !== principal.subject
              || observed.authorized !== true || evaluateAuthorization(principal, snapshot, {
                operation: "access", capability: "read", tenantId: target.tenantId, datasetId,
                expectedPolicyRevision: snapshot.revision,
              }, start).reason !== "owner-authority") {
              live.push({ control: "connection-actor", status: "failed", reason: "locked-founder-binding-required" });
            } else live.push({ control: "connection-actor", status: "verified", reason: "live-locked-founder-binding" });
          }
          const schema = await client.query(PROVISIONING_CONTRACT_SQL);
          const catalog = await client.query<{ catalog: unknown }>(PROVISIONING_CATALOG_SQL);
          const text = catalog.rows[0]?.catalog;
          if (schema.rows.length !== 1 || schema.rows[0].ready !== true || catalog.rows.length !== 1 || typeof text !== "string") {
            live.push({ control: "schema-audit", status: "failed", reason: "live-schema-audit-contract-failed" });
          } else if (catalogDigests.size !== 1) {
            live.push({ control: "schema-audit", status: "unverified", reason: "reviewed-catalog-fingerprint-unavailable" });
          } else if (!catalogDigests.has(createHash("sha256").update(text).digest("hex"))) {
            live.push({ control: "schema-audit", status: "failed", reason: "live-catalog-differs-from-reviewed-evidence" });
          } else live.push({ control: "schema-audit", status: "verified", reason: "live-contract-and-signed-catalog-match" });
        } catch {
          live.length = 0;
          live.push({ control: "schema-audit", status: "unverified", reason: "live-verification-unavailable" });
        }
        try {
          const rollback = await client.query("ROLLBACK");
          if (rollback.command !== "ROLLBACK") throw new Error("Unconfirmed rollback.");
          findings.push(...live);
        } catch {
          destroy = true;
          findings.push({ control: "schema-audit", status: "unverified", reason: "assessment-rollback-unconfirmed" });
        }
      } finally {
        try { client.release(destroy); } catch {
          findings.push({ control: "connection-actor", status: "unverified", reason: "lease-cleanup-unconfirmed" });
        }
      }
      let end: number;
      try { end = nowMs(); } catch { end = -1; }
      if (!isCounter(end) || end < start || validEvidence.some(e => e.expiresAt <= end || end - e.observedAt > maxAge)) {
        findings.push({ control: "schema-audit", status: "unverified", reason: "evidence-expired-during-assessment" });
      }
      if (JSON.stringify(employeeProvisioningRelease()) !== JSON.stringify(release)) {
        findings.push({ control: "migration-approval", status: "failed", reason: "release-authority-changed" });
      }
      return finish();
    },
  });
}
