import { createHash, randomUUID } from "node:crypto";
import type { Client, QueryResult } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../app/lib/clerk-session-resolver", () => ({
  resolveClerkSession: () => { throw new Error("SQL-only integration must not contact Clerk."); },
}));

import { auditDecisionId, authorizationRequestContent } from "../../app/lib/authorization-transaction";
import type { AuthorizationAuditEvidence, TransactionAuthorizationRequest } from "../../app/lib/authorization-transaction-contract";
import {
  isContributionIdentityRegistry, type ContributionIdentityEvent,
} from "../../app/lib/contribution-identity-authority";
import { validateAuthorityTransition, validateDurableAuthorityState, type DurableAuthorityState } from "../../app/lib/durable-authorization-state";
import { LOCK_MEMBER_AUTHORITY_SQL } from "../../app/lib/postgres-member-authority";
import { memberAuthorityRelease } from "../../app/lib/member-authority-release";
import { memberAuthorityDisposableConfig } from "./member-authority-disposable-config";
import { createMemberAuthorityHarness, memberBackendPid, waitForMemberBlock } from "./member-authority-harness";
import { seedDataset } from "./postgres-harness";

const configuration = memberAuthorityDisposableConfig(process.env);
type Harness = Awaited<ReturnType<typeof createMemberAuthorityHarness>>;
type Fixture = Readonly<{
  tenant: string; dataset: string; subject: string; person: string; owner: string;
  memberRole: string; ownerRole: string; state: DurableAuthorityState;
}>;
type Change = "person" | "membership" | "role";
type Settled = { status: "fulfilled"; value: QueryResult } | { status: "rejected"; reason: unknown };

// Attach rejection handling immediately; a blocked query is never retried.
function settle(query: Promise<QueryResult>): Promise<Settled> {
  return query.then(value => ({ status: "fulfilled", value }), reason => ({ status: "rejected", reason }));
}

describe.skipIf(configuration.status === "skip").sequential(
  "REAL PostgreSQL 16 member authority on an independently identified NEW local cluster",
  () => {
    let h: Harness | undefined;
    let ready = false;
    let poisoned = false;

    beforeAll(async () => {
      if (configuration.status !== "configured") throw new Error("Dedicated member configuration required.");
      h = await createMemberAuthorityHarness(configuration.config);
      ready = true;
    }, 30000);
    afterAll(async () => { if (h) await h.close(); }, 20000);

    function harness(): Harness {
      if (!h || !ready || poisoned) throw new Error("Member fixture setup is unavailable or a previous scenario failed; no automatic repair.");
      return h;
    }
    async function scenario(work: (target: Harness) => Promise<void>): Promise<void> {
      const target = harness();
      try { await work(target); } catch (error) {
        poisoned = true;
        throw error;
      }
    }
    async function stamp(client: Client): Promise<number> {
      const result = await client.query<{ ms: string }>("SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS ms");
      const value = Number(result.rows[0]?.ms);
      if (result.rows.length !== 1 || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid database clock.");
      return value;
    }

    async function fixture(target: Harness): Promise<Fixture> {
      const suffix = randomUUID().replaceAll("-", "");
      const tenant = `member-${suffix}`;
      const dataset = randomUUID();
      const subject = `user_member_${suffix}`;
      const person = `person-${suffix}`;
      const owner = `user_owner_${suffix}`;
      const state: DurableAuthorityState = { schemaVersion: 1, revocations: [], snapshot: {
        version: 1, revision: 1, tenant: { id: tenant, status: "active", ownerSubjects: [owner] },
        datasets: [{ tenantId: tenant, datasetId: dataset }],
        memberships: [
          { tenantId: tenant, subject: owner, revision: 1, status: "active", roleIds: [] },
          { tenantId: tenant, subject, revision: 1, status: "active", roleIds: ["reader"] },
        ],
        roles: [{ id: "reader", tenantId: tenant, revision: 1, status: "active",
          grants: [{ id: "read", datasetId: dataset, capability: "read", delegable: false }] }],
        delegations: [],
      } };
      expect(validateDurableAuthorityState(state).status).toBe("valid");
      await seedDataset(target.admin, dataset);
      await target.admin.query("INSERT INTO empire_os_authorization.tenants VALUES($1,1,$2::jsonb)", [tenant, JSON.stringify(state)]);
      await target.admin.query("INSERT INTO empire_os_authorization.datasets(tenant_id,dataset_id) VALUES($1,$2)", [tenant, dataset]);

      await target.admin.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      try {
        const result = await target.admin.query("SELECT registry FROM empire_os_identity.identity_registry WHERE singleton FOR UPDATE");
        const registry: unknown = result.rows[0]?.registry;
        if (!isContributionIdentityRegistry(registry)) throw new Error("Invalid fixture registry.");
        const now = await stamp(target.admin);
        const operationId = `bind-${suffix}`;
        const event: ContributionIdentityEvent = {
          sequence: registry.revision + 1, eventId: operationId, previousEventId: registry.events.at(-1)?.eventId ?? null,
          operationId, tenantId: tenant, actorSubject: owner, recordedAtMs: now,
          kind: "subject-bound", bindingId: `binding-${suffix}`, subject, personId: person,
          verificationId: `proof-${suffix}`, verifiedAtMs: now,
        };
        const next = {
          ...registry, revision: registry.revision + 1, bindingRevision: registry.bindingRevision + 1,
          events: [...registry.events, event],
        };
        if (!isContributionIdentityRegistry(next)) throw new Error("Invalid synthetic binding history.");
        const text = JSON.stringify({ operationId, tenantId: tenant });
        // Explicit synthetic owner bootstrap, not a verifier or production issuer.
        await target.admin.query(`INSERT INTO empire_os_identity.approved_operations VALUES
          ($1,$2,$3,$4,$5,$6::jsonb,'{}','member-disposable-fixture',$7,$8)`, [
          operationId, tenant, owner, text, createHash("sha256").update(text).digest("hex"),
          JSON.stringify({ operationId, scopeTenantId: tenant, actorSubject: owner, event }), now, now + 300000,
        ]);
        await target.admin.query(`INSERT INTO empire_os_identity.identity_events
          (event_id,operation_id,registry_revision,event,receipt) VALUES($1,$1,$2,$3::jsonb,'{}')`,
        [operationId, event.sequence, JSON.stringify(event)]);
        await target.admin.query("INSERT INTO empire_os_identity.active_bindings VALUES($1,$2,$3,$4)",
          [event.bindingId, subject, person, event.eventId]);
        await target.admin.query("UPDATE empire_os_identity.identity_registry SET registry=$1::jsonb WHERE singleton", [JSON.stringify(next)]);
        await appendPerson(target.admin, { tenant, person }, "active", 1);
        await target.admin.query("COMMIT");
      } catch (error) {
        try { await target.admin.query("ROLLBACK"); } catch (cleanup) {
          throw new AggregateError([error, cleanup], "Fixture bootstrap rollback failed.");
        }
        throw error;
      }
      const memberRole = await target.createMemberLogin(subject, tenant);
      const ownerRole = await target.createMemberLogin(owner, tenant);
      await target.admin.query(`GRANT USAGE ON SCHEMA empire_os_authorization TO "${ownerRole}"`);
      await target.admin.query(`GRANT EXECUTE ON FUNCTION empire_os_authorization.apply_operation(text,jsonb,jsonb) TO "${ownerRole}"`);
      return { tenant, dataset, subject, person, owner, memberRole, ownerRole, state };
    }

    async function appendPerson(client: Client, f: Pick<Fixture, "tenant" | "person">, status: "active" | "inactive", revision: number) {
      await client.query(`INSERT INTO empire_os_identity.person_authority_events
        (tenant_id,person_id,revision,status,kind,operation_id,issuer_subject,source_reference,evidence_sha256,recorded_at_ms)
        VALUES($1,$2,$3,$4,'other',$5,'user_fixture_issuer','synthetic-fixture',$6,0)`, [
        f.tenant, f.person, revision, status, `eligibility-${randomUUID()}`, "a".repeat(64),
      ]);
    }
    async function applyChange(client: Client, f: Fixture, kind: Change): Promise<void> {
      if (kind === "person") return appendPerson(client, f, "inactive", 2);
      const now = await stamp(client);
      const operationId = `revoke-${randomUUID()}`;
      const target = kind === "membership" ? { kind: "membership" as const, id: f.subject }
        : { kind: "role" as const, id: "reader" };
      const command: Extract<TransactionAuthorizationRequest["command"], { kind: "revoke" }> =
        { kind: "revoke", datasetId: f.dataset, target };
      const input: TransactionAuthorizationRequest = {
        tenantId: f.tenant, operationId, expectedPolicyRevision: 1,
        command,
      };
      const next: DurableAuthorityState = {
        ...f.state,
        snapshot: {
          ...f.state.snapshot, revision: 2,
          memberships: f.state.snapshot.memberships.map(member => kind === "membership" && member.subject === f.subject
            ? { ...member, status: "revoked", revision: 2 } : member),
          roles: f.state.snapshot.roles.map(role => kind === "role" ? { ...role, status: "revoked", revision: 2 } : role),
        },
        revocations: [{ ...target, operationId, policyRevision: 2, revokedAt: now }],
      };
      if (validateAuthorityTransition(f.state, next, now).status !== "valid") throw new Error("Invalid fixture revocation.");
      const text = authorizationRequestContent(input);
      const transactionId = randomUUID();
      const evidence: AuthorizationAuditEvidence = {
        version: 1, operationId, transactionId, decisionId: auditDecisionId(transactionId, operationId),
        requestSha256: createHash("sha256").update(text).digest("hex"), actorSubject: f.owner,
        tenantId: f.tenant, datasetId: f.dataset, operation: "revoke", authorityChange: command,
        decision: { status: "allowed", reason: "owner-authority", policyVersion: 1, observedPolicyRevision: 1 },
        checkedAt: now, completedAt: now, resultingPolicyRevision: 2,
      };
      await client.query("SELECT empire_os_authorization.apply_operation($1,$2::jsonb,$3::jsonb)",
        [text, JSON.stringify(evidence), JSON.stringify(next)]);
    }
    async function rollbackAll(...clients: Client[]): Promise<void> {
      const results = await Promise.allSettled(clients.map(client => client.query("ROLLBACK")));
      const errors = results.flatMap(result => result.status === "rejected" ? [result.reason]
        : result.value.command !== "ROLLBACK" ? [new Error("Unconfirmed test rollback.")] : []);
      if (errors.length) throw new AggregateError(errors, "Scenario rollback failed.");
    }
    async function assertIdle(target: Harness, ...pids: number[]) {
      const result = await target.admin.query(`SELECT pid FROM pg_stat_activity
        WHERE pid=ANY($1::int[]) AND (xact_start IS NOT NULL OR state<>'idle')`, [pids]);
      expect(result.rows).toEqual([]);
      const locks = await target.admin.query(`SELECT pid FROM pg_locks
        WHERE pid=ANY($1::int[]) AND locktype IN ('transactionid','tuple')`, [pids]);
      expect(locks.rows).toEqual([]);
    }

    it("reads only the ordinary member binding/authority and rolls back without business effects", async () => scenario(async target => {
      const f = await fixture(target);
      const client = await target.member(f.memberRole);
      const pid = await memberBackendPid(client);
      try {
        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        const result = await client.query(LOCK_MEMBER_AUTHORITY_SQL, [f.tenant, f.dataset]);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({
          actor_subject: f.subject, person_id: f.person, person_status: "active", person_revision: "1",
          revision: "1", decision: { status: "allowed", reason: "direct-grant" },
        });
        expect(Object.keys(result.rows[0]).sort()).toEqual([
          "actor_subject", "binding_id", "person_id", "registry_revision", "binding_revision", "person_revision",
          "person_status", "person_kind", "state", "revision", "decision", "checked_at", "eligibility_event",
        ].sort());
      } finally { await rollbackAll(client); }
      await assertIdle(target, pid);
      expect((await target.admin.query("SELECT * FROM empire_os_authorization.preparation_writes")).rows).toEqual([]);
      expect((await target.admin.query("SELECT * FROM empire_os_authorization.audit WHERE tenant_id=$1", [f.tenant])).rows).toEqual([]);
      expect(memberAuthorityRelease()).toEqual({ status: "disabled" });
    }));

    it.each<Change>(["person", "membership", "role"])(
      "reader-first: %s mutation blocks until reader rollback, then future reads deny", async kind => scenario(async target => {
        const f = await fixture(target);
        const reader = await target.member(f.memberRole);
        const writer = kind === "person" ? await target.owner() : await target.member(f.ownerRole);
        const readerPid = await memberBackendPid(reader);
        const writerPid = await memberBackendPid(writer);
        let pending: Promise<Settled> | undefined;
        try {
          await reader.query("BEGIN ISOLATION LEVEL READ COMMITTED");
          expect((await reader.query(LOCK_MEMBER_AUTHORITY_SQL, [f.tenant, f.dataset])).rows).toHaveLength(1);
          await writer.query("BEGIN ISOLATION LEVEL READ COMMITTED");
          pending = settle(applyChange(writer, f, kind).then(() => writer.query("SELECT 1")));
          await waitForMemberBlock(target.admin, readerPid, writerPid);
          await reader.query("ROLLBACK");
          expect((await pending).status).toBe("fulfilled");
          expect((await writer.query("COMMIT")).command).toBe("COMMIT");
          await reader.query("BEGIN ISOLATION LEVEL READ COMMITTED");
          await expect(reader.query(LOCK_MEMBER_AUTHORITY_SQL, [f.tenant, f.dataset])).rejects.toMatchObject({ code: "42501" });
        } finally {
          // Release the blocker before awaiting any outstanding blocked query.
          await rollbackAll(reader);
          if (pending) await pending;
          await rollbackAll(writer);
        }
        await assertIdle(target, readerPid, writerPid);
      }), 20000,
    );

    it("serializes privileged binding projection changes and rolls them back without losing identity", async () => scenario(async target => {
      const f = await fixture(target);
      const reader = await target.member(f.memberRole);
      const writer = await target.owner();
      const readerPid = await memberBackendPid(reader);
      const writerPid = await memberBackendPid(writer);
      let pending: Promise<Settled> | undefined;
      try {
        await reader.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        await reader.query(LOCK_MEMBER_AUTHORITY_SQL, [f.tenant, f.dataset]);
        await writer.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        // Projection-maintenance fence only, not a production revoke workflow.
        pending = settle(writer.query("DELETE FROM empire_os_identity.active_bindings WHERE subject=$1", [f.subject]));
        await waitForMemberBlock(target.admin, readerPid, writerPid);
        await reader.query("ROLLBACK");
        expect((await pending).status).toBe("fulfilled");
        await writer.query("ROLLBACK");
        await reader.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        expect((await reader.query(LOCK_MEMBER_AUTHORITY_SQL, [f.tenant, f.dataset])).rows[0])
          .toMatchObject({ actor_subject: f.subject, person_id: f.person });
      } finally {
        await rollbackAll(reader);
        if (pending) await pending;
        await rollbackAll(writer);
      }
      await assertIdle(target, readerPid, writerPid);
    }), 20000);

    it.each([
      { kind: "person" as const, completion: "COMMIT" as const },
      { kind: "person" as const, completion: "ROLLBACK" as const },
      { kind: "membership" as const, completion: "COMMIT" as const },
      { kind: "membership" as const, completion: "ROLLBACK" as const },
      { kind: "role" as const, completion: "COMMIT" as const },
      { kind: "role" as const, completion: "ROLLBACK" as const },
    ])("writer-first: $kind $completion is observed after an actual lock wait", async ({ kind, completion }) => scenario(async target => {
      const f = await fixture(target);
      const reader = await target.member(f.memberRole);
      const writer = kind === "person" ? await target.owner() : await target.member(f.ownerRole);
      const readerPid = await memberBackendPid(reader);
      const writerPid = await memberBackendPid(writer);
      let pending: Promise<Settled> | undefined;
      try {
        await writer.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        await applyChange(writer, f, kind);
        await reader.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        pending = settle(reader.query(LOCK_MEMBER_AUTHORITY_SQL, [f.tenant, f.dataset]));
        await waitForMemberBlock(target.admin, writerPid, readerPid);
        expect((await writer.query(completion)).command).toBe(completion);
        const result = await pending;
        if (completion === "COMMIT") {
          expect(result.status).toBe("rejected");
          if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "42501" });
        } else {
          expect(result.status).toBe("fulfilled");
          if (result.status === "fulfilled") expect(result.value.rows[0]).toMatchObject({ person_status: "active", revision: "1" });
        }
      } finally {
        await rollbackAll(writer);
        if (pending) await pending;
        await rollbackAll(reader);
      }
      await assertIdle(target, readerPid, writerPid);
      if (kind !== "person") {
        const audit = await target.admin.query("SELECT allowed FROM empire_os_authorization.audit WHERE tenant_id=$1", [f.tenant]);
        expect(audit.rows).toHaveLength(completion === "COMMIT" ? 1 : 0);
      } else {
        const events = await target.admin.query("SELECT status FROM empire_os_identity.person_authority_events WHERE tenant_id=$1 ORDER BY revision", [f.tenant]);
        expect(events.rows.map(row => row.status)).toEqual(completion === "COMMIT" ? ["active", "inactive"] : ["active"]);
      }
    }), 20000);

    it("denies foreign tenants/datasets and rolls back aborted transactions", async () => scenario(async target => {
      const f = await fixture(target);
      const foreign = await fixture(target);
      const client = await target.member(f.memberRole);
      const pid = await memberBackendPid(client);
      for (const [tenant, dataset] of [[foreign.tenant, foreign.dataset], [f.tenant, foreign.dataset]]) {
        try {
          await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
          await expect(client.query(LOCK_MEMBER_AUTHORITY_SQL, [tenant, dataset])).rejects.toMatchObject({ code: "42501" });
        } finally { await rollbackAll(client); }
      }
      await assertIdle(target, pid);
    }));

    it("enforces restricted LOGIN attributes, forced RLS and denied direct access/impersonation", async () => scenario(async target => {
      const f = await fixture(target);
      const client = await target.member(f.memberRole);
      const identity = await client.query(`SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,
        EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS member
        FROM pg_roles r WHERE rolname=current_user`);
      expect(identity.rows).toEqual([{
        rolcanlogin: true, rolsuper: false, rolbypassrls: false, rolcreatedb: false,
        rolcreaterole: false, rolreplication: false, member: false,
      }]);
      const rls = await target.admin.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('empire_os_identity','empire_os_authorization','empire_os_preparation') AND c.relkind='r'
          AND NOT (n.nspname='empire_os_preparation' AND c.relname='store_registry')`);
      expect(rls.rows.length).toBeGreaterThan(0);
      expect(rls.rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
      for (const sql of [
        "SELECT * FROM empire_os_identity.active_bindings",
        "SELECT * FROM empire_os_identity.person_authority_events",
        "INSERT INTO empire_os_identity.person_authority_events DEFAULT VALUES",
        "DELETE FROM empire_os_identity.identity_events WHERE false",
        "SELECT * FROM empire_os_authorization.tenants",
        "SELECT empire_os_identity.lock_operation('foreign','fabricated','fabricated')",
        `SET ROLE "${f.ownerRole}"`,
      ]) {
        try {
          await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
          await expect(client.query(sql)).rejects.toMatchObject({ code: "42501" });
        } finally { await rollbackAll(client); }
      }
      // Even an accidental SELECT grant cannot expose rows through forced RLS.
      const owner = await target.owner();
      try {
        await owner.query("BEGIN");
        await owner.query(`GRANT SELECT ON empire_os_identity.person_authority_events TO "${f.memberRole}"`);
        await owner.query("COMMIT");
        expect((await client.query("SELECT * FROM empire_os_identity.person_authority_events")).rows).toEqual([]);
        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        await expect(client.query(LOCK_MEMBER_AUTHORITY_SQL, [f.tenant, f.dataset])).rejects.toMatchObject({ code: "42501" });
      } finally {
        await rollbackAll(client, owner);
      }
      // Deliberately retain this adversarial fixture; do not repair or reuse it.
    }));
  },
);
