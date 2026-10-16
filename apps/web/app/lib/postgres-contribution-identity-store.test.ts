import { createHash } from "node:crypto";
import type { QueryArrayConfig, QueryArrayResult, QueryConfig, QueryConfigValues, QueryResult, QueryResultRow, Submittable } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const controls = vi.hoisted(() => ({ approved: false, bound: true }));
vi.mock("./contribution-identity-release", async importOriginal => {
  const original = await importOriginal<typeof import("./contribution-identity-release")>();
  return {
    contributionIdentityRelease: () => controls.approved ? { status: "approved" } : original.contributionIdentityRelease(),
  };
});
vi.mock("./restricted-postgres-provider", () => ({
  restrictedSourceBinding: () => controls.bound ? { subject: "user_founder", tenantId: "identity-test-tenant" } : undefined,
}));
import {
  identityTestClaim, identityTestObservation, identityTestPrincipal, identityTestRegistry, identityTestRequest,
  IDENTITY_TEST_NOW, IDENTITY_TEST_TENANT,
} from "../../database/tests/contribution-identity-fixtures";
import type { AuthorizationPostgresConnection } from "./postgres-authorization-store";
import {
  createPostgresContributionIdentityStore, identityPersistenceRequestText, prepareIdentityPersistenceApproval,
  IDENTITY_APPLY_SQL, IDENTITY_LOCK_SQL, IDENTITY_CONTRACT_SQL,
} from "./postgres-contribution-identity-store";
import { parse } from "libpg-query";

async function harness(options: {
  fail?: string; replay?: boolean; corrupt?: boolean; denied?: boolean; rollbackFails?: boolean; ready?: boolean; code?: string;
  corruptReplay?: "revision" | "revocation";
} = {}) {
  const principal = await identityTestPrincipal();
  const claim = await identityTestClaim();
  const request = identityTestRequest();
  const registry = identityTestRegistry();
  const authority = identityTestObservation();
  const approval = prepareIdentityPersistenceApproval({
    principal, approvalPrincipal: null, registry, authority, request, claim, nowMs: IDENTITY_TEST_NOW,
    issuerReference: "offline-test-issuer",
    verification: { verifiedBySubject: "user_reviewer", verifierReference: "independent-proof", evidenceSha256: "a".repeat(64) },
  });
  const after = {
    ...registry, revision: registry.revision + 1, bindingRevision: registry.bindingRevision + 1,
    events: [...registry.events, approval.plan.event],
  };
  const savedReceipt = {
    operationId: request.operationId, eventId: request.eventId, registryRevision: after.revision,
    requestSha256: approval.requestSha256, actorSubject: principal.subject, tenantId: IDENTITY_TEST_TENANT,
    requiresSessionRevocation: false,
  };
  const statements: string[] = [];
  const release = vi.fn();
  const query = vi.fn(async (sql: string, _values: unknown[] = []) => {
    statements.push(sql);
    if (sql === options.fail || (sql === "ROLLBACK" && options.rollbackFails)) {
      throw Object.assign(new Error("PRIVATE DRIVER DETAILS"), { code: options.code });
    }
    let rows: QueryResultRow[] = [];
    if (sql.includes("AS unsafe")) rows = [{ unsafe: false }];
    if (sql === IDENTITY_CONTRACT_SQL) rows = [{ ready: options.ready ?? true }];
    if (sql === IDENTITY_LOCK_SQL) rows = [{
      registry: options.replay ? after : registry, actor_subject: principal.subject,
      now_ms: String(IDENTITY_TEST_NOW), receipt: options.replay ? {
        ...savedReceipt,
        ...(options.corruptReplay === "revision" ? { registryRevision: registry.revision } : {}),
        ...(options.corruptReplay === "revocation" ? { requiresSessionRevocation: true } : {}),
      } : null,
    }];
    if (sql === IDENTITY_APPLY_SQL) rows = [{ registry: options.corrupt ? registry : after, receipt: savedReceipt }];
    return { rows, command: sql.startsWith("BEGIN") ? "BEGIN" : ["COMMIT", "ROLLBACK"].includes(sql) ? sql : "SELECT",
      rowCount: rows.length, fields: [], oid: 0 };
  });
  function connectionQuery<T extends Submittable>(stream: T): T;
  function connectionQuery<R extends unknown[] = unknown[], I = unknown[]>(
    config: QueryArrayConfig<I>, values?: QueryConfigValues<I>,
  ): Promise<QueryArrayResult<R>>;
  function connectionQuery<R extends QueryResultRow = QueryResultRow, I = unknown[]>(
    textOrConfig: string | QueryConfig<I>, values?: QueryConfigValues<I>,
  ): Promise<QueryResult<R>>;
  function connectionQuery<R extends unknown[] = unknown[], I = unknown[]>(
    config: QueryArrayConfig<I>, callback: (error: Error, result: QueryArrayResult<R>) => void,
  ): void;
  function connectionQuery<R extends QueryResultRow = QueryResultRow, I = unknown[]>(
    textOrConfig: string | QueryConfig<I>, callback: (error: Error, result: QueryResult<R>) => void,
  ): void;
  function connectionQuery<R extends QueryResultRow = QueryResultRow, I = unknown[]>(
    text: string, values: QueryConfigValues<I>, callback: (error: Error, result: QueryResult<R>) => void,
  ): void;
  function connectionQuery(...args: unknown[]): unknown {
    const [sql, values] = args;
    // Match the driver interface, but fail explicitly for forms this repository
    // does not use rather than silently simulating callbacks, streams or row modes.
    if (args.length < 1 || args.length > 2 || typeof sql !== "string"
      || (values !== undefined && !Array.isArray(values))) {
      throw new Error("Identity test adapter supports only promise queries with SQL text and optional values.");
    }
    return query(sql, values);
  }
  const client: AuthorizationPostgresConnection = {
    query: connectionQuery, release,
  };
  const connect = vi.fn(async () => client);
  const observe = vi.fn(async () => ({
    authority: options.denied ? { ...authority, memberships: [] } : authority, claim,
  }));
  return { principal, request, statements, query, client, release, connect, observe, approval,
    store: createPostgresContributionIdentityStore({ connect }, { observe }) };
}

afterEach(() => { controls.approved = false; controls.bound = true; });

describe("inactive identity repository (offline, no database)", () => {
  it("adapts text promise queries with and without values while preserving driver metadata and ordering", async () => {
    const h = await harness();
    expect(await h.client.query("BEGIN ISOLATION LEVEL READ COMMITTED")).toMatchObject({
      command: "BEGIN", rows: [], rowCount: 0, fields: [], oid: 0,
    });
    const values = [IDENTITY_TEST_TENANT, h.request.operationId, h.approval.requestSha256];
    const locked = await h.client.query<{ actor_subject: unknown }>(IDENTITY_LOCK_SQL, values);
    expect(locked.rows[0].actor_subject).toBe(h.principal.subject);
    expect(locked.command).toBe("SELECT");
    expect(h.query).toHaveBeenNthCalledWith(1, "BEGIN ISOLATION LEVEL READ COMMITTED", undefined);
    expect(h.query).toHaveBeenNthCalledWith(2, IDENTITY_LOCK_SQL, values);
    expect(h.statements).toEqual(["BEGIN ISOLATION LEVEL READ COMMITTED", IDENTITY_LOCK_SQL]);
  });
  it("rejects unsupported driver query forms before recording or simulating SQL", async () => {
    const h = await harness();
    expect(() => h.client.query({ text: IDENTITY_LOCK_SQL })).toThrow("only promise queries");
    expect(() => h.client.query({ text: IDENTITY_LOCK_SQL, rowMode: "array" })).toThrow("only promise queries");
    expect(() => h.client.query({ submit: () => {} })).toThrow("only promise queries");
    const callback = vi.fn();
    expect(() => h.client.query(IDENTITY_LOCK_SQL, callback)).toThrow("only promise queries");
    expect(() => h.client.query(IDENTITY_LOCK_SQL, [], callback)).toThrow("only promise queries");
    expect(callback).not.toHaveBeenCalled();
    expect(h.query).not.toHaveBeenCalled();
    expect(h.statements).toEqual([]);
  });
  it("parses parameterized repository queries offline", async () => {
    await expect(parse(IDENTITY_LOCK_SQL)).resolves.toBeDefined();
    await expect(parse(IDENTITY_APPLY_SQL)).resolves.toBeDefined();
    await expect(parse(IDENTITY_CONTRACT_SQL)).resolves.toBeDefined();
  });
  it("never connects while disabled", async () => {
    const h = await harness();
    expect(await h.store.execute(h.principal, null, h.request)).toEqual({ status: "disabled" });
    expect(h.connect).not.toHaveBeenCalled();
  });
  it("rejects fabricated principals and unbound providers before connecting", async () => {
    controls.approved = true;
    const h = await harness();
    expect(await h.store.execute({ subject: "user_founder" }, null, h.request))
      .toMatchObject({ status: "denied", reason: "authentication-required" });
    controls.bound = false;
    expect(await h.store.execute(h.principal, null, h.request))
      .toMatchObject({ status: "denied", reason: "restricted-principal-source-required" });
    expect(h.connect).not.toHaveBeenCalled();
  });
  it("reuses the Phase 5 planner and confirms only after COMMIT", async () => {
    controls.approved = true;
    const h = await harness();
    expect(await h.store.execute(h.principal, null, h.request)).toMatchObject({
      status: "committed", registryRevision: 6, durability: "transaction-commit-confirmed",
    });
    expect(h.observe).toHaveBeenCalledOnce();
    expect(h.statements.indexOf(IDENTITY_LOCK_SQL)).toBeLessThan(h.statements.indexOf(IDENTITY_APPLY_SQL));
    expect(h.statements.at(-1)).toBe("COMMIT");
    expect(h.release).toHaveBeenCalledWith(false);
  });
  it("returns an existing committed receipt without observing or applying again", async () => {
    controls.approved = true;
    const h = await harness({ replay: true });
    expect(await h.store.execute(h.principal, null, h.request)).toMatchObject({ status: "replayed" });
    expect(h.observe).not.toHaveBeenCalled();
    expect(h.statements).not.toContain(IDENTITY_APPLY_SQL);
  });
  it.each(["revision", "revocation"] as const)("rejects a replay receipt with corrupted %s metadata", async corruptReplay => {
    controls.approved = true;
    const h = await harness({ replay: true, corruptReplay });
    expect(await h.store.execute(h.principal, null, h.request)).toEqual({ status: "failed", outcome: "rolled-back" });
    expect(h.statements).not.toContain("COMMIT");
    expect(h.observe).not.toHaveBeenCalled();
  });
  it("rolls back a missing membership without submitting a mutation", async () => {
    controls.approved = true;
    const h = await harness({ denied: true });
    expect(await h.store.execute(h.principal, null, h.request)).toMatchObject({
      status: "denied", reason: "active-admin-membership-required",
    });
    expect(h.statements).not.toContain(IDENTITY_APPLY_SQL);
    expect(h.statements.at(-1)).toBe("ROLLBACK");
  });
  it.each([IDENTITY_LOCK_SQL, IDENTITY_APPLY_SQL])("rolls back a pre-commit failure at %s", async fail => {
    controls.approved = true;
    const h = await harness({ fail });
    expect(await h.store.execute(h.principal, null, h.request)).toEqual({ status: "failed", outcome: "rolled-back" });
    expect(h.statements).not.toContain("COMMIT");
  });
  it("rejects corrupt post-write state and rolls back", async () => {
    controls.approved = true;
    const h = await harness({ corrupt: true });
    expect(await h.store.execute(h.principal, null, h.request)).toEqual({ status: "failed", outcome: "rolled-back" });
    expect(h.statements.at(-1)).toBe("ROLLBACK");
  });
  it("rejects missing database safeguards before reading or mutating identity state", async () => {
    controls.approved = true;
    const h = await harness({ ready: false });
    expect(await h.store.execute(h.principal, null, h.request)).toEqual({ status: "failed", outcome: "rolled-back" });
    expect(h.statements).not.toContain(IDENTITY_LOCK_SQL);
    expect(h.statements).not.toContain(IDENTITY_APPLY_SQL);
  });
  it.each(["40001", "40P01", "23505", "55P03"])("returns a confirmed-rollback conflict for SQLSTATE %s", async code => {
    controls.approved = true;
    const h = await harness({ fail: IDENTITY_APPLY_SQL, code });
    expect(await h.store.execute(h.principal, null, h.request))
      .toEqual({ status: "conflict", reason: "identity-concurrency-conflict" });
    expect(h.statements.at(-1)).toBe("ROLLBACK");
  });
  it("does not claim rollback after a lost COMMIT acknowledgement", async () => {
    controls.approved = true;
    const h = await harness({ fail: "COMMIT" });
    expect(await h.store.execute(h.principal, null, h.request)).toEqual({ status: "failed", outcome: "unknown" });
    expect(h.statements.at(-1)).toBe("COMMIT");
    expect(h.release).toHaveBeenCalledWith(true);
  });
  it("discards a connection when rollback is unconfirmed", async () => {
    controls.approved = true;
    const h = await harness({ fail: IDENTITY_APPLY_SQL, rollbackFails: true });
    expect(await h.store.execute(h.principal, null, h.request)).toEqual({ status: "failed", outcome: "unknown" });
    expect(h.release).toHaveBeenCalledWith(true);
  });
  it("binds approval to exact canonical request content and session expiry", async () => {
    const h = await harness();
    expect(h.approval.requestSha256).toBe(createHash("sha256")
      .update(identityPersistenceRequestText(h.request)).digest("hex"));
    expect(h.approval.expiresAtMs).toBe(IDENTITY_TEST_NOW + 60_000);
    expect(() => identityPersistenceRequestText({ ...h.request, role: undefined })).toThrow();
  });
  it("never extends an approval beyond the actor's existing reauthentication window", async () => {
    const h = await harness();
    const observed = identityTestObservation();
    const approval = prepareIdentityPersistenceApproval({
      principal: h.principal, approvalPrincipal: null, registry: identityTestRegistry(), request: h.request,
      authority: {
        ...observed,
        recentAuthentications: observed.recentAuthentications.map(entry => entry.subject === h.principal.subject
          ? { ...entry, authenticatedAtMs: IDENTITY_TEST_NOW - 299_999 } : entry),
      },
      claim: await identityTestClaim(), nowMs: IDENTITY_TEST_NOW,
      issuerReference: "offline-test-issuer",
      verification: { verifiedBySubject: "user_reviewer", verifierReference: "independent-proof", evidenceSha256: "a".repeat(64) },
    });
    expect(approval.expiresAtMs).toBe(IDENTITY_TEST_NOW + 1);
  });
  it("does not let evidence metadata override the branded verification identity", async () => {
    const h = await harness();
    const verification = {
      verifiedBySubject: "user_reviewer", verifierReference: "independent-proof", evidenceSha256: "a".repeat(64),
      subject: "user_attacker", verificationId: "fabricated",
    };
    const approval = prepareIdentityPersistenceApproval({
      principal: h.principal, approvalPrincipal: null, registry: identityTestRegistry(), request: h.request,
      authority: identityTestObservation(), claim: await identityTestClaim(), nowMs: IDENTITY_TEST_NOW,
      issuerReference: "offline-test-issuer", verification,
    });
    expect(approval.verification).toMatchObject({ subject: "user_target", verificationId: "verification-user_target" });
  });
});
