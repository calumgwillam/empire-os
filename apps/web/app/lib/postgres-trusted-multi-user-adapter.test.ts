import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { parse } from "libpg-query";

vi.mock("server-only", () => ({}));
vi.mock("./clerk-session-resolver", () => ({ resolveClerkSession: vi.fn() }));
vi.mock("pg", () => ({
  Pool: vi.fn(function () { throw new Error("Offline adapter tests cannot connect to PostgreSQL."); }),
}));
// Only the provider's process-local brand is substituted. Every query/response
// below is synthetic; these tests do not prove real locks, TLS or SQL execution.
vi.mock("./restricted-postgres-provider", () => ({ restrictedSourceBinding: vi.fn() }));

import { Pool } from "pg";
import { resolveClerkSession } from "./clerk-session-resolver";
import type { AuthorizationPostgresConnection } from "./postgres-authorization-store";
import { IDENTITY_CONTRACT_SQL } from "./postgres-contribution-identity-store";
import {
  createPostgresTrustedMultiUserAdapter, TRUSTED_POSTGRES_EXISTING_APIS_SQL,
  TRUSTED_POSTGRES_MISSING_DEPENDENCIES,
} from "./postgres-trusted-multi-user-adapter";
import { restrictedSourceBinding } from "./restricted-postgres-provider";
import {
  createServerPrincipalResolver, isAuthenticatedPrincipal, type AuthenticatedPrincipal,
} from "./server-persistence-authority";
import { createTrustedMultiUserAuthority } from "./trusted-multi-user-authority";
import type { TrustedMultiUserAuthorityDependencies } from "./trusted-multi-user-authority";
import { EMPIRE_OS_BACKUP_STORAGE_KEYS } from "./backup";
import type { CommitLookup, SnapshotRequest, WriteBatch } from "./server-persistence-contract";

const SUBJECT = "user_staff";
const TENANT = "tenant-a";
const DATASET = "00000000-0000-4000-8000-000000000001";
const OTHER_DATASET = "00000000-0000-4000-8000-000000000002";
const BEGIN = "BEGIN ISOLATION LEVEL READ COMMITTED";
const request = () => new Request("https://empire.invalid/internal");
const readInput = () => ({ datasetId: DATASET, protocolVersion: 1 as const });
const writeInput = () => ({
  fence: { ...readInput(), generation: 1, authorityRevision: 0 },
  idempotencyKey: "write:original",
  reads: [],
  writes: [{ key: EMPIRE_OS_BACKUP_STORAGE_KEYS[0], expectedRevision: 0, rawValue: "[]" }],
});
const lookupInput = () => ({
  ...readInput(), generation: 1, idempotencyKey: "write:original", requestSha256: "a".repeat(64),
});

async function principal(subject = SUBJECT): Promise<AuthenticatedPrincipal> {
  const resolved = await createServerPrincipalResolver(async () => ({ status: "authenticated", subject }))(request());
  if (!isAuthenticatedPrincipal(resolved)) throw new Error("Invalid offline principal fixture.");
  return resolved;
}

async function harness() {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const control = {
    fail: new Set<string>(),
    wrongCommand: new Map<string, string>(),
    unsafe: false,
    releaseFailure: false,
    catalogRows: [{ dataset_snapshot: true, atomic_operation: true, operation_lookup: true }] as QueryResultRow[],
    identityRows: [{ ready: true }] as QueryResultRow[],
    duringQuery: undefined as ((sql: string) => void) | undefined,
  };
  const release = vi.fn((_destroy?: boolean) => {
    if (control.releaseFailure) throw new Error("Private disposal failure.");
  });
  async function query<Row extends QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    sql.push(text);
    params.push(values);
    control.duringQuery?.(text);
    if (control.fail.has(text) || (text.includes("AS unsafe") && control.fail.has("unsafe"))) {
      throw new Error("Private database failure.");
    }
    const rows: QueryResultRow[] = text.includes("AS unsafe") ? [{ unsafe: control.unsafe }]
      : text === TRUSTED_POSTGRES_EXISTING_APIS_SQL ? control.catalogRows
      : text === IDENTITY_CONTRACT_SQL ? control.identityRows : [];
    // Driver-fixture cast only; production rows are decoded at the adapter boundary.
    return { rows: rows as Row[], rowCount: rows.length, fields: [], oid: 0,
      command: control.wrongCommand.get(text) ?? (text === BEGIN ? "BEGIN" : text === "ROLLBACK" ? text
        : text.startsWith("SET LOCAL") ? "SET" : "SELECT") };
  }
  const client: AuthorizationPostgresConnection = { query: query as AuthorizationPostgresConnection["query"], release };
  const source = { connect: vi.fn(async () => client) };
  const actor = await principal();
  const authorize = vi.fn<Parameters<TrustedMultiUserAuthorityDependencies["repositoryForExecution"]>[0]["authorize"]>();
  const options = { principal: actor, tenantId: TENANT, datasetId: DATASET, source, authorize };
  const adapter = createPostgresTrustedMultiUserAdapter(options);
  return { adapter, control, source, authorize, sql, params, release, options };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveClerkSession).mockResolvedValue({ status: "authenticated", subject: SUBJECT });
  vi.mocked(restrictedSourceBinding).mockReturnValue({
    subject: SUBJECT, tenantId: TENANT, database: "offline-fixture", login: "staff_login",
    databaseIdentitySha256: "a".repeat(64),
  });
});
afterEach(() => { expect(Pool).not.toHaveBeenCalled(); });

describe("dormant trusted PostgreSQL adapter (offline, no business execution)", () => {
  it("parses the fixed catalog probe offline without executing SQL", async () => {
    await expect(parse(TRUSTED_POSTGRES_EXISTING_APIS_SQL)).resolves.toBeDefined();
  });

  it("owns one bounded rollback-only transaction and reports explicit unresolved dependencies", async () => {
    const h = await harness();
    expect(await h.adapter.inspectReadiness()).toEqual({
      status: "blocked", missingDependencies: TRUSTED_POSTGRES_MISSING_DEPENDENCIES,
      existingApis: { datasetSnapshot: true, atomicOperation: true, operationLookup: true, identityAdministration: true },
    });
    expect(h.source.connect).toHaveBeenCalledTimes(1);
    expect(h.sql.slice(0, 4)).toEqual([
      BEGIN, "SET LOCAL lock_timeout = '5s'", "SET LOCAL statement_timeout = '10s'",
      "SET LOCAL idle_in_transaction_session_timeout = '15s'",
    ]);
    expect(h.sql[4]).toContain("AS unsafe");
    expect(h.sql.slice(5)).toEqual([TRUSTED_POSTGRES_EXISTING_APIS_SQL, IDENTITY_CONTRACT_SQL, "ROLLBACK"]);
    expect(h.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(h.authorize).not.toHaveBeenCalled();
    expect(h.params.every(values => values.length === 0)).toBe(true);
  });

  it.each(["readSnapshot", "writeBatch", "lookupCommit"] as const)(
    "refuses %s without connecting, even with every existing API present", async method => {
      const h = await harness();
      const input = { readSnapshot: readInput(), writeBatch: writeInput(), lookupCommit: lookupInput() };
      const original = structuredClone(input);
      const result = method === "readSnapshot"
        ? await h.adapter.readSnapshot(input.readSnapshot)
        : method === "writeBatch"
          ? await h.adapter.writeBatch(input.writeBatch)
          : await h.adapter.lookupCommit(input.lookupCommit);
      expect(result).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
      expect(input).toEqual(original);
      expect(h.source.connect).not.toHaveBeenCalled();
      expect(h.authorize).not.toHaveBeenCalled();
      expect(h.sql).toEqual([]);
    },
  );

  it("cannot be unlocked by a successful authorization callback or a successful catalog probe", async () => {
    const h = await harness();
    h.authorize.mockResolvedValue({
      status: "authorized", subject: SUBJECT, personId: "person-staff", bindingId: "binding",
      registryRevision: 1, bindingRevision: 1, tenantId: TENANT, policyRevision: 1, membershipRevision: 1,
    });
    expect(await h.adapter.inspectReadiness()).toMatchObject({ status: "blocked" });
    const before = [...h.sql];
    expect(await h.adapter.writeBatch(writeInput())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(h.sql).toEqual(before);
    expect(h.authorize).not.toHaveBeenCalled();
    expect(h.sql).not.toContain("COMMIT");
  });

  it.each(["unbranded", "wrong-subject", "wrong-tenant"] as const)(
    "denies %s sources before leasing a connection or probing catalog state", async kind => {
      const h = await harness();
      const binding = restrictedSourceBinding(h.source);
      if (!binding) throw new Error("Expected offline brand.");
      vi.mocked(restrictedSourceBinding).mockReturnValue(kind === "unbranded" ? undefined
        : { ...binding, subject: kind === "wrong-subject" ? "user_other" : SUBJECT,
          tenantId: kind === "wrong-tenant" ? "tenant-b" : TENANT });
      expect(await h.adapter.inspectReadiness()).toEqual({ status: "unauthorized", reason: "forbidden" });
      expect(await h.adapter.writeBatch(writeInput())).toEqual({ status: "unauthorized", reason: "forbidden" });
      expect(h.source.connect).not.toHaveBeenCalled();
    },
  );

  it("rejects a reconstructed principal rather than trusting an actor property", async () => {
    const h = await harness();
    const forged = { ...h.options.principal };
    expect(isAuthenticatedPrincipal(forged)).toBe(false);
    const adapter = createPostgresTrustedMultiUserAdapter({ ...h.options, principal: forged });
    expect(await adapter.inspectReadiness()).toEqual({ status: "unauthorized", reason: "authentication-required" });
    expect(h.source.connect).not.toHaveBeenCalled();
  });

  it.each(["", " tenant-a", "tenant-b"] as const)("rejects invalid or mismatched tenant scope %j", async tenantId => {
    const h = await harness();
    const adapter = createPostgresTrustedMultiUserAdapter({ ...h.options, tenantId });
    expect(await adapter.inspectReadiness()).toEqual({ status: "unauthorized", reason: "forbidden" });
    expect(h.source.connect).not.toHaveBeenCalled();
  });

  it("denies another dataset without probing its existence", async () => {
    const h = await harness();
    expect(await h.adapter.readSnapshot({ ...readInput(), datasetId: OTHER_DATASET }))
      .toEqual({ status: "unauthorized", reason: "forbidden" });
    const write = writeInput();
    expect(await h.adapter.writeBatch({ ...write, fence: { ...write.fence, datasetId: OTHER_DATASET } }))
      .toEqual({ status: "unauthorized", reason: "forbidden" });
    expect(h.source.connect).not.toHaveBeenCalled();
  });

  it("validates requests without adding an actor or tenant claim surface", async () => {
    const h = await harness();
    const spoofedSnapshot: SnapshotRequest & { tenantId: string; role: string } = {
      ...readInput(), tenantId: TENANT, role: "owner",
    };
    expect(await h.adapter.readSnapshot(spoofedSnapshot))
      .toMatchObject({ status: "invalid-request" });
    const write = writeInput();
    const spoofedWrite: WriteBatch & { fence: WriteBatch["fence"] & { actor: string } } = {
      ...write, fence: { ...write.fence, actor: SUBJECT },
    };
    expect(await h.adapter.writeBatch(spoofedWrite))
      .toMatchObject({ status: "invalid-request" });
    const spoofedLookup: CommitLookup & { actor: string } = { ...lookupInput(), actor: SUBJECT };
    expect(await h.adapter.lookupCommit(spoofedLookup))
      .toMatchObject({ status: "invalid-request" });
    expect(h.source.connect).not.toHaveBeenCalled();
  });

  it("never treats missing existing APIs as a fallback to an unguarded repository", async () => {
    const h = await harness();
    h.control.catalogRows = [{ dataset_snapshot: false, atomic_operation: false, operation_lookup: false }];
    h.control.identityRows = [{ ready: false }];
    expect(await h.adapter.inspectReadiness()).toMatchObject({
      status: "blocked",
      existingApis: { datasetSnapshot: false, atomicOperation: false, operationLookup: false, identityAdministration: false },
    });
    expect(h.sql.at(-1)).toBe("ROLLBACK");
    expect(h.authorize).not.toHaveBeenCalled();
  });

  it("cannot promote a catalog observation into authority after a simulated revocation", async () => {
    const h = await harness();
    await h.adapter.inspectReadiness();
    // This is a simulated capability loss, not a proof of real PostgreSQL locking.
    h.control.catalogRows = [{ dataset_snapshot: false, atomic_operation: false, operation_lookup: false }];
    expect(await h.adapter.inspectReadiness()).toMatchObject({
      status: "blocked", existingApis: { datasetSnapshot: false },
    });
    const before = [...h.sql];
    expect(await h.adapter.writeBatch(writeInput())).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(h.sql).toEqual(before);
    expect(h.source.connect).toHaveBeenCalledTimes(2);
  });

  it("cannot race from a mid-probe capability change into business execution", async () => {
    const h = await harness();
    h.control.duringQuery = sql => {
      if (sql === TRUSTED_POSTGRES_EXISTING_APIS_SQL) h.control.identityRows = [{ ready: false }];
    };
    expect(await h.adapter.inspectReadiness()).toMatchObject({
      status: "blocked", existingApis: { identityAdministration: false },
    });
    expect(h.authorize).not.toHaveBeenCalled();
    expect(h.sql).not.toContain("COMMIT");
  });

  it("rejects unsafe database privileges before probing capabilities", async () => {
    const h = await harness();
    h.control.unsafe = true;
    expect(await h.adapter.inspectReadiness()).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(h.sql).not.toContain(TRUSTED_POSTGRES_EXISTING_APIS_SQL);
    expect(h.sql.at(-1)).toBe("ROLLBACK");
    expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it.each([
    BEGIN, "SET LOCAL lock_timeout = '5s'", "SET LOCAL statement_timeout = '10s'",
    "SET LOCAL idle_in_transaction_session_timeout = '15s'", "unsafe",
    TRUSTED_POSTGRES_EXISTING_APIS_SQL, IDENTITY_CONTRACT_SQL,
  ])("rolls back and sanitizes a failed readiness step: %s", async failure => {
    const h = await harness();
    h.control.fail.add(failure);
    const result = await h.adapter.inspectReadiness();
    expect(result).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(JSON.stringify(result)).not.toContain("Private");
    expect(h.sql.at(-1)).toBe("ROLLBACK");
    expect(h.sql).not.toContain("COMMIT");
    expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(h.source.connect).toHaveBeenCalledTimes(1);
  });

  it("does not pretend that a failed BEGIN acknowledgement means no transaction began", async () => {
    const h = await harness();
    h.control.wrongCommand.set(BEGIN, "SELECT");
    expect(await h.adapter.inspectReadiness()).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(h.sql).toEqual([BEGIN, "ROLLBACK"]);
    expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("handles connection failure without SQL, rollback or retries", async () => {
    const h = await harness();
    h.source.connect.mockRejectedValue(new Error("Private connection details"));
    expect(await h.adapter.inspectReadiness()).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(h.source.connect).toHaveBeenCalledTimes(1);
    expect(h.release).not.toHaveBeenCalled();
    expect(h.sql).toEqual([]);
  });

  it.each(["catalog-empty", "catalog-type", "identity-empty", "identity-type", "catalog-command"] as const)(
    "refuses malformed catalog responses: %s", async kind => {
      const h = await harness();
      if (kind === "catalog-empty") h.control.catalogRows = [];
      if (kind === "catalog-type") h.control.catalogRows = [{ dataset_snapshot: "true", atomic_operation: true, operation_lookup: true }];
      if (kind === "identity-empty") h.control.identityRows = [];
      if (kind === "identity-type") h.control.identityRows = [{ ready: 1 }];
      if (kind === "catalog-command") h.control.wrongCommand.set(TRUSTED_POSTGRES_EXISTING_APIS_SQL, "UPDATE");
      expect(await h.adapter.inspectReadiness()).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
      expect(h.release).toHaveBeenCalledExactlyOnceWith(true);
    },
  );

  it.each(["rollback-error", "rollback-command", "disposal-error", "begin-and-rollback"] as const)(
    "suppresses observations when transaction cleanup is uncertain: %s", async kind => {
      const h = await harness();
      if (kind === "rollback-error" || kind === "begin-and-rollback") h.control.fail.add("ROLLBACK");
      if (kind === "begin-and-rollback") h.control.fail.add(BEGIN);
      if (kind === "rollback-command") h.control.wrongCommand.set("ROLLBACK", "COMMIT");
      if (kind === "disposal-error") h.control.releaseFailure = true;
      const result = await h.adapter.inspectReadiness();
      expect(result).toMatchObject({ status: "unavailable", outcome: "unknown" });
      expect(result).not.toHaveProperty("existingApis");
      expect(h.release).toHaveBeenCalledTimes(1);
      if (kind !== "disposal-error") expect(h.release).toHaveBeenCalledWith(true);
      expect(h.source.connect).toHaveBeenCalledTimes(1);
      // No COMMIT can be lost here: business execution is disabled. A wrong
      // completion response is conservatively uncertain, never a commit receipt.
      expect(h.sql).not.toContain("COMMIT");
    },
  );

  it("keeps an earlier unknown write outcome unresolved instead of reporting non-execution", async () => {
    const h = await harness();
    const input = lookupInput();
    expect(await h.adapter.lookupCommit(input)).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(input.idempotencyKey).toBe("write:original");
    expect(h.source.connect).not.toHaveBeenCalled();
  });

  it("composes with the verified Clerk boundary without invoking any business transaction", async () => {
    const h = await harness();
    const authority = createTrustedMultiUserAuthority({
      tenantId: TENANT, sourceForPrincipal: () => h.source,
      repositoryForExecution: createPostgresTrustedMultiUserAdapter,
    });
    expect(await authority.writeBatch(request(), writeInput()))
      .toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(h.source.connect).not.toHaveBeenCalled();
    expect(h.sql).toEqual([]);
  });

  it("rejects an unauthenticated Clerk request before selecting this adapter", async () => {
    const h = await harness();
    vi.mocked(resolveClerkSession).mockResolvedValue({ status: "unauthenticated" });
    const repositoryForExecution = vi.fn(createPostgresTrustedMultiUserAdapter);
    const authority = createTrustedMultiUserAuthority({
      tenantId: TENANT, sourceForPrincipal: () => h.source, repositoryForExecution,
    });
    expect(await authority.readSnapshot(request(), readInput()))
      .toEqual({ status: "unauthorized", reason: "authentication-required" });
    expect(repositoryForExecution).not.toHaveBeenCalled();
    expect(h.source.connect).not.toHaveBeenCalled();
  });
});
