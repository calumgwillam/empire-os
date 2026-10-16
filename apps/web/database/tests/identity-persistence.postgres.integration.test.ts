import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const controls = vi.hoisted(() => ({ approved: false }));
vi.mock("../../app/lib/contribution-identity-release", () => ({
  contributionIdentityRelease: () => ({ status: controls.approved ? "approved" : "disabled" }),
}));
// Disposable loopback driver only: production uses the branded TLS provider.
vi.mock("../../app/lib/restricted-postgres-provider", () => ({
  restrictedSourceBinding: () => ({ subject: "user_founder", tenantId: "identity-test-tenant" }),
}));
import {
  isContributionIdentityRegistry, type ContributionIdentityRegistry, type IdentityAuthorityObservation,
} from "../../app/lib/contribution-identity-authority";
import {
  createPostgresContributionIdentityStore, prepareIdentityPersistenceApproval,
  identityPersistenceRequestText, IDENTITY_APPLY_SQL, IDENTITY_LOCK_SQL,
} from "../../app/lib/postgres-contribution-identity-store";
import type { AuthorizationPostgresSource } from "../../app/lib/postgres-authorization-store";
import { validateDurableAuthorityState } from "../../app/lib/durable-authorization-state";
import { connectDisposable, migrateEmptyAuthorizationDisposable, seedDataset } from "./postgres-harness";
import { identityPersistenceDisposableConfig } from "./identity-persistence-disposable-config";
import {
  identityTestRegistry, identityTestObservation, identityTestRequest, identityTestRequestBase, identityTestPrincipal, identityTestClaim,
  IDENTITY_TEST_SUBJECTS, IDENTITY_TEST_TENANT,
} from "./contribution-identity-fixtures";

const configuration = identityPersistenceDisposableConfig(process.env);
describe.skipIf(configuration.status === "skip").sequential("identity persistence on a NEW disposable PostgreSQL database", () => {
  let admin: Client;
  let role: string;
  let password: string;
  let source: AuthorizationPostgresSource;
  const datasetId = randomUUID();
  const tenantId = IDENTITY_TEST_TENANT;
  const connections: Client[] = [];

  async function clock() {
    const result = await admin.query<{ now_ms: string }>(
      "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS now_ms",
    );
    return Number(result.rows[0].now_ms);
  }
  async function registry(): Promise<ContributionIdentityRegistry> {
    const result = await admin.query<{ registry: unknown }>("SELECT registry FROM empire_os_identity.identity_registry");
    const value = result.rows[0].registry;
    if (!isContributionIdentityRegistry(value)) throw new Error("Invalid persisted fixture registry.");
    return value;
  }
  async function observation(nowMs: number): Promise<IdentityAuthorityObservation> {
    const result = await admin.query<{ state: unknown }>("SELECT state FROM empire_os_authorization.tenants WHERE tenant_id=$1", [tenantId]);
    const loaded = validateDurableAuthorityState(result.rows[0].state);
    if (loaded.status !== "valid") throw new Error("Invalid persisted fixture membership authority.");
    return {
      ...identityTestObservation(nowMs), policyRevision: loaded.value.snapshot.revision,
      tenantPolicyRevisions: [{ tenantId, revision: loaded.value.snapshot.revision }],
      memberships: loaded.value.snapshot.memberships.map(({ subject, tenantId, revision, status }) => ({
        subject, tenantId, revision, status,
      })),
    };
  }
  async function issue(request: ReturnType<typeof identityTestRequest> | Record<string, unknown>, persistenceSource = source) {
    const nowMs = await clock();
    const principal = await identityTestPrincipal();
    const observed = await observation(nowMs);
    const target = typeof request.subject === "string" ? request.subject : "user_target";
    const personId = typeof request.personId === "string" ? request.personId : `person-${target}`;
    const claim = request.kind === "bind" || request.kind === "reassign" ? await identityTestClaim(target, personId, nowMs) : null;
    const approver = request.kind === "reassign" ? await identityTestPrincipal("user_reviewer") : null;
    const approval = prepareIdentityPersistenceApproval({
      principal, approvalPrincipal: approver, registry: await registry(), authority: observed, request, claim, nowMs,
      issuerReference: "disposable-independent-issuer",
      verification: claim ? { verifiedBySubject: "user_reviewer", verifierReference: "disposable-proof", evidenceSha256: "a".repeat(64) } : null,
    });
    await admin.query(`INSERT INTO empire_os_identity.approved_operations
      (operation_id,tenant_id,actor_subject,request_text,request_sha256,plan,verification,issuer_reference,checked_at_ms,expires_at_ms)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)`, [
      approval.operationId, approval.tenantId, approval.actorSubject, approval.requestText, approval.requestSha256,
      JSON.stringify(approval.plan), JSON.stringify(approval.verification), approval.issuerReference,
      approval.checkedAtMs, approval.expiresAtMs,
    ]);
    const store = createPostgresContributionIdentityStore(persistenceSource, {
      observe: async (_client, _principal, _approver, stamp) => ({
        authority: { ...observed, checkedAtMs: stamp }, claim,
      }),
    });
    return { store, approval, principal, approver, request };
  }

  beforeAll(async () => {
    if (configuration.status !== "configured") throw new Error("New identity disposable configuration required.");
    admin = await connectDisposable(configuration.config);
    const identity = await admin.query<{ superuser: boolean; version: string }>(
      "SELECT rolsuper AS superuser,current_setting('server_version_num') AS version FROM pg_roles WHERE rolname=current_user",
    );
    if (identity.rows.length !== 1 || !identity.rows[0].superuser
      || Math.floor(Number(identity.rows[0].version) / 10000) !== 16) {
      throw new Error("Identity fixtures require PostgreSQL 16 and a verified disposable-instance superuser.");
    }
    // Verified marker, advisory lock and zero-object checks; never reset a database.
    const database = configuration.config.database;
    await migrateEmptyAuthorizationDisposable(admin, async client => {
      // Runs only AFTER all original verified-empty checks, outside migration
      // transactions. A failed first migration cannot make this database reusable.
      await client.query(`COMMENT ON DATABASE "${database}" IS 'empire-os-identity-test-attempt-consumed'`);
    });
    const candidate = await readFile(new URL("../design/sql/contribution-identity-persistence-candidate.sql", import.meta.url), "utf8");
    await admin.query(candidate);
    const nowMs = await clock();
    await seedDataset(admin, datasetId);
    const state = {
      schemaVersion: 1, revocations: [], snapshot: {
        version: 1, revision: 1, tenant: { id: tenantId, status: "active", ownerSubjects: ["user_founder"] },
        datasets: [{ tenantId, datasetId }], roles: [], delegations: [],
        memberships: IDENTITY_TEST_SUBJECTS.map(subject => ({ subject, tenantId, revision: 1, status: "active", roleIds: [] })),
      },
    };
    expect(validateDurableAuthorityState(state).status).toBe("valid");
    await admin.query("INSERT INTO empire_os_authorization.tenants VALUES($1,1,$2::jsonb)", [tenantId, JSON.stringify(state)]);
    await admin.query("INSERT INTO empire_os_authorization.datasets(tenant_id,dataset_id) VALUES($1,$2)", [tenantId, datasetId]);
    const initial = identityTestRegistry();
    const seeded = { ...initial, events: initial.events.map(event => ({
      ...event, recordedAtMs: nowMs, ...("verifiedAtMs" in event ? { verifiedAtMs: nowMs } : {}),
    })) };
    expect(isContributionIdentityRegistry(seeded)).toBe(true);
    // Explicit trusted bootstrap fixture, never an application bootstrap endpoint.
    // Each history insert has its own transaction, respecting one-event-per-transaction.
    for (const event of seeded.events) {
      const text = identityPersistenceRequestText({ operationId: event.operationId, tenantId });
      await admin.query(`INSERT INTO empire_os_identity.approved_operations VALUES
        ($1,$2,'user_founder',$3,$4,$5::jsonb,'{}','disposable-bootstrap',$6,$7)`, [
        event.operationId, tenantId, text, createHash("sha256").update(text).digest("hex"),
        JSON.stringify({ operationId: event.operationId, scopeTenantId: tenantId, actorSubject: "user_founder", event }),
        nowMs, nowMs + 300_000,
      ]);
      await admin.query(`INSERT INTO empire_os_identity.identity_events
        (event_id,operation_id,registry_revision,event,receipt) VALUES($1,$2,$3,$4::jsonb,'{}')`,
      [event.eventId, event.operationId, event.sequence, JSON.stringify(event)]);
      if (event.kind === "subject-bound") {
        await admin.query("INSERT INTO empire_os_identity.active_bindings VALUES($1,$2,$3,$4)",
          [event.bindingId, event.subject, event.personId, event.eventId]);
      } else if (event.kind === "administrator-granted") {
        await admin.query("INSERT INTO empire_os_identity.administrator_grants VALUES($1,$2,$3,$4::jsonb,$5,false)",
          [event.grantId, event.tenantId, event.subject, JSON.stringify(event.capabilities), event.source]);
      }
    }
    await admin.query("UPDATE empire_os_identity.identity_registry SET registry=$1::jsonb", [JSON.stringify(seeded)]);
    role = `empire_identity_${randomUUID().replaceAll("-", "")}`;
    password = randomUUID();
    await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`);
    await admin.query(`GRANT CONNECT ON DATABASE "${configuration.config.database}" TO "${role}"`);
    await admin.query(`GRANT USAGE ON SCHEMA empire_os_identity TO "${role}"`);
    await admin.query(`GRANT EXECUTE ON FUNCTION empire_os_identity.lock_operation(text,text,text),
      empire_os_identity.consume_operation(text,text,text,jsonb) TO "${role}"`);
    await admin.query("INSERT INTO empire_os_authorization.role_tenants VALUES($1,$2,$3)", [role, "user_founder", tenantId]);
    source = {
      async connect() {
        if (configuration.status !== "configured") throw new Error("Missing isolated configuration.");
        const client = new Client({ ...configuration.config, user: role, password, ssl: false });
        await client.connect();
        connections.push(client);
        return { query: client.query.bind(client), release: () => {} };
      },
    };
    controls.approved = true;
  }, 30_000);

  afterAll(async () => {
    controls.approved = false;
    for (const client of connections) await client.end();
    if (admin) await admin.end();
    // Deliberately retain every schema, role and audit row. Never reset/reuse.
  });

  it("binds atomically and replays a duplicate without a second event", async () => {
    const request = identityTestRequest(`bind-${randomUUID()}`, await registry());
    const issued = await issue(request);
    const competing = await Promise.all([
      issued.store.execute(issued.principal, null, request),
      issued.store.execute(issued.principal, null, request),
    ]);
    expect(competing.map(result => result.status).sort()).toEqual(["committed", "replayed"]);
    expect((await issued.store.execute(issued.principal, null, request)).status).toBe("replayed");
    const saved = await admin.query("SELECT * FROM empire_os_identity.identity_events WHERE operation_id=$1", [request.operationId]);
    expect(saved.rows).toHaveLength(1);
    const active = await admin.query("SELECT * FROM empire_os_identity.active_bindings WHERE subject='user_target'");
    expect(active.rows).toHaveLength(1);
  });
  it("rejects changed content under the same operation without disclosing another receipt", async () => {
    const request = { ...identityTestRequest("bind-user_old", await registry()), eventId: "changed-event" };
    const store = createPostgresContributionIdentityStore(source, { observe: async () => { throw new Error("Replay must not observe."); } });
    expect(await store.execute(await identityTestPrincipal(), null, request))
      .toMatchObject({ status: "denied" });
  });
  it("rejects concurrent different requests sharing a stale registry revision without rebasing", async () => {
    const state = await registry();
    const first = { ...identityTestRequest(`parallel-a-${randomUUID()}`, state),
      subject: "user_parallel_a", personId: "person-user_parallel_a" };
    const second = { ...identityTestRequest(`parallel-b-${randomUUID()}`, state),
      subject: "user_parallel_b", personId: "person-user_parallel_b" };
    const a = await issue(first);
    const b = await issue(second);
    const results = await Promise.all([
      a.store.execute(a.principal, null, first), b.store.execute(b.principal, null, second),
    ]);
    expect(results.map(result => result.status).sort()).toEqual(["committed", "conflict"]);
    expect((await registry()).revision).toBe(state.revision + 1);
  });
  it("reconciles an actually committed transaction after a lost COMMIT acknowledgement", async () => {
    const unreliable: AuthorizationPostgresSource = {
      async connect() {
        const client = await source.connect();
        return {
          ...client,
          query: new Proxy(client.query, {
            async apply(target, thisArg, argumentsList) {
              const result = await Reflect.apply(target, thisArg, argumentsList);
              if (argumentsList[0] === "COMMIT") throw new Error("Simulated lost COMMIT acknowledgement.");
              return result;
            },
          }),
        };
      },
    };
    const request = { ...identityTestRequest(`lost-ack-${randomUUID()}`, await registry()),
      subject: "user_lost_ack", personId: "person-user_lost_ack" };
    const issued = await issue(request, unreliable);
    expect(await issued.store.execute(issued.principal, null, request)).toEqual({ status: "failed", outcome: "unknown" });
    const reconciler = createPostgresContributionIdentityStore(source, {
      observe: async () => { throw new Error("Replay must not reapply an operation."); },
    });
    expect((await reconciler.execute(issued.principal, null, request)).status).toBe("replayed");
    const events = await admin.query("SELECT * FROM empire_os_identity.identity_events WHERE operation_id=$1", [request.operationId]);
    expect(events.rows).toHaveLength(1);
  });
  it("rejects direct table writes and impersonation by the restricted role", async () => {
    const client = await source.connect();
    await expect(client.query("UPDATE empire_os_identity.identity_registry SET registry='{}'")).rejects.toThrow();
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await expect(client.query(IDENTITY_LOCK_SQL, ["another-tenant", "unknown-operation", "a".repeat(64)])).rejects.toThrow();
    await client.query("ROLLBACK");
  });
  it("rolls back a plan that differs from the protected issuer decision", async () => {
    const request = {
      ...identityTestRequest(`tamper-${randomUUID()}`, await registry()), subject: "user_new", personId: "person-user_new",
    };
    const issued = await issue(request);
    const before = await registry();
    const client = await source.connect();
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await expect(client.query(IDENTITY_APPLY_SQL, [
      tenantId, request.operationId, issued.approval.requestText,
      JSON.stringify({ ...issued.approval.plan, actorSubject: "user_attacker" }),
    ])).rejects.toThrow();
    await client.query("ROLLBACK");
    expect(await registry()).toEqual(before);
  });
  it("atomically grants and revokes delegated administration without transferring role grants", async () => {
    const grant = {
      ...identityTestRequestBase(`grant-${randomUUID()}`, await registry()),
      kind: "grant-administrator", grantId: `delegated-${randomUUID()}`, subject: "user_old", capabilities: ["bind"],
    };
    const issued = await issue(grant);
    expect((await issued.store.execute(issued.principal, null, grant)).status).toBe("committed");
    const revoke = {
      ...identityTestRequestBase(`revoke-grant-${randomUUID()}`, await registry()),
      kind: "revoke-administrator", grantId: grant.grantId, justification: "Disposable delegation ended.",
    };
    const revocation = await issue(revoke);
    expect(await revocation.store.execute(revocation.principal, null, revoke))
      .toMatchObject({ status: "committed", requiresSessionRevocation: true });
    const result = await admin.query("SELECT revoked FROM empire_os_identity.administrator_grants WHERE grant_id=$1", [grant.grantId]);
    expect(result.rows).toEqual([{ revoked: true }]);
    const pending = await admin.query("SELECT subject FROM empire_os_identity.session_revocations WHERE event_id=$1", [revoke.eventId]);
    expect(pending.rows).toEqual([{ subject: "user_old" }]);
  });
  it("retains original ownership while reassigning and atomically revoking the obsolete membership", async () => {
    const state = await registry();
    const request = {
      ...identityTestRequest(`reassign-${randomUUID()}`, state), kind: "reassign",
      previousSubject: "user_old", previousPersonId: "person-user_old", subject: "user_new", personId: "person-user_old",
      justification: "Disposable independent replacement proof.",
    };
    const issued = await issue(request);
    expect((await issued.store.execute(issued.principal, issued.approver, request)).status).toBe("committed");
    const after = await registry();
    expect(after.events.some(event => event.kind === "subject-bound" && event.subject === "user_old")).toBe(true);
    const observed = await observation(await clock());
    expect(observed.memberships.find(member => member.subject === "user_old")?.status).toBe("revoked");
    const audit = await admin.query("SELECT * FROM empire_os_authorization.audit WHERE operation_id=$1", [request.operationId]);
    expect(audit.rows).toHaveLength(1);
  });
  it("does not let runtime connections mint authorizations or rewrite evidence", async () => {
    const client = await source.connect();
    await expect(client.query("INSERT INTO empire_os_identity.approved_operations DEFAULT VALUES")).rejects.toThrow();
    await expect(client.query("DELETE FROM empire_os_identity.identity_events WHERE false")).rejects.toThrow();
    await expect(client.query(IDENTITY_APPLY_SQL, [tenantId, "fabricated", "{}", "{}"])).rejects.toThrow();
  });
  it("revokes a bound identity and its membership in the same audited commit", async () => {
    const observed = await observation(await clock());
    const request = {
      ...identityTestRequestBase(`revoke-binding-${randomUUID()}`, await registry()),
      expectedTenantPolicyRevision: observed.policyRevision, kind: "revoke", subject: "user_new",
      justification: "Disposable access ended.",
    };
    const issued = await issue(request);
    const before = await registry();
    const trial = await source.connect();
    await trial.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await trial.query(IDENTITY_APPLY_SQL, [tenantId, request.operationId, issued.approval.requestText, JSON.stringify(issued.approval.plan)]);
    await trial.query("ROLLBACK");
    expect(await registry()).toEqual(before);
    expect((await observation(await clock())).memberships.find(member => member.subject === "user_new")?.status).toBe("active");
    expect(await issued.store.execute(issued.principal, null, request))
      .toMatchObject({ status: "committed", requiresSessionRevocation: true });
    const binding = await admin.query("SELECT * FROM empire_os_identity.active_bindings WHERE subject='user_new'");
    expect(binding.rows).toHaveLength(0);
    expect((await observation(await clock())).memberships.find(member => member.subject === "user_new")?.status).toBe("revoked");
    const audit = await admin.query("SELECT * FROM empire_os_authorization.audit WHERE operation_id=$1", [request.operationId]);
    expect(audit.rows).toHaveLength(1);
  });
  it("refuses to expose global history when the actor lacks administration in another represented tenant", async () => {
    const prior = await registry();
    const unbound = ["user_parallel_a", "user_parallel_b"].find(subject =>
      !prior.events.some(event => event.kind === "subject-bound" && event.subject === subject));
    if (!unbound) throw new Error("Concurrent-conflict fixture did not retain an unbound identity.");
    const request = { ...identityTestRequest(`scope-${randomUUID()}`, prior), subject: unbound, personId: `person-${unbound}`,
      expectedTenantPolicyRevision: (await observation(await clock())).policyRevision };
    const issued = await issue(request);
    const foreignTenant = `foreign-${randomUUID()}`;
    const foreignDataset = randomUUID();
    await seedDataset(admin, foreignDataset);
    const foreignState = {
      schemaVersion: 1, revocations: [], snapshot: {
        version: 1, revision: 1, tenant: { id: foreignTenant, status: "active", ownerSubjects: ["user_foreign"] },
        datasets: [{ tenantId: foreignTenant, datasetId: foreignDataset }], roles: [], delegations: [],
        memberships: [{ subject: "user_foreign", tenantId: foreignTenant, revision: 1, status: "active", roleIds: [] }],
      },
    };
    expect(validateDurableAuthorityState(foreignState).status).toBe("valid");
    await admin.query("INSERT INTO empire_os_authorization.tenants VALUES($1,1,$2::jsonb)", [foreignTenant, JSON.stringify(foreignState)]);
    await admin.query("INSERT INTO empire_os_authorization.datasets(tenant_id,dataset_id) VALUES($1,$2)", [foreignTenant, foreignDataset]);
    const nowMs = await clock();
    const event = {
      sequence: prior.revision + 1, eventId: `foreign-event-${randomUUID()}`,
      previousEventId: prior.events.at(-1)?.eventId ?? null, operationId: `foreign-operation-${randomUUID()}`,
      tenantId: foreignTenant, actorSubject: "user_foreign", recordedAtMs: nowMs,
      kind: "subject-bound", bindingId: "foreign-binding", subject: "user_foreign", personId: "person-user_foreign",
      verificationId: "foreign-verification", verifiedAtMs: nowMs,
    };
    // Separate trusted-organisation history fixture, never a runtime bootstrap API.
    const text = identityPersistenceRequestText({ operationId: event.operationId, tenantId: foreignTenant });
    await admin.query(`INSERT INTO empire_os_identity.approved_operations VALUES
      ($1,$2,'user_foreign',$3,$4,$5::jsonb,'{}','disposable-foreign-bootstrap',$6,$7)`, [
      event.operationId, foreignTenant, text, createHash("sha256").update(text).digest("hex"),
      JSON.stringify({ operationId: event.operationId, scopeTenantId: foreignTenant, actorSubject: "user_foreign", event }),
      nowMs, nowMs + 300_000,
    ]);
    await admin.query(`INSERT INTO empire_os_identity.identity_events
      (event_id,operation_id,registry_revision,event,receipt) VALUES($1,$2,$3,$4::jsonb,'{}')`,
    [event.eventId, event.operationId, event.sequence, JSON.stringify(event)]);
    await admin.query("INSERT INTO empire_os_identity.active_bindings VALUES($1,$2,$3,$4)",
      [event.bindingId, event.subject, event.personId, event.eventId]);
    const next = { ...prior, revision: prior.revision + 1, bindingRevision: prior.bindingRevision + 1, events: [...prior.events, event] };
    expect(isContributionIdentityRegistry(next)).toBe(true);
    await admin.query("UPDATE empire_os_identity.identity_registry SET registry=$1::jsonb", [JSON.stringify(next)]);
    const client = await source.connect();
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await expect(client.query(IDENTITY_LOCK_SQL, [tenantId, request.operationId, issued.approval.requestSha256]))
      .rejects.toThrow("Global identity history");
    await client.query("ROLLBACK");
  });
});
