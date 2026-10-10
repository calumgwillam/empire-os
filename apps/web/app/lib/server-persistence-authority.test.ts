import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPIRE_OS_BACKUP_STORAGE_KEYS } from "./backup";
import { prepareServerImport } from "./server-import-preparation";
import {
  createServerPersistenceAuthority,
  type AuthenticatedPrincipal,
  type ServerPersistenceAuthorityDependencies,
} from "./server-persistence-authority";
import {
  SERVER_PERSISTENCE_PROTOCOL,
  type CommitLookup,
  type DatasetFence,
  type DatasetSnapshot,
  type ServerPersistenceRepository,
  type StageImportRequest,
  type WriteBatch,
} from "./server-persistence-contract";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const datasetId = "00000000-0000-4000-8000-000000000001";
const fence = { datasetId, protocolVersion: SERVER_PERSISTENCE_PROTOCOL, generation: 1, authorityRevision: 0 } satisfies DatasetFence;

function snapshot(): DatasetSnapshot {
  return {
    ...fence,
    commitSequence: 0,
    values: EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => ({ key, rawValue: null, revision: 0 })),
  };
}

function writeBatch(): WriteBatch {
  return {
    fence,
    idempotencyKey: "request:one",
    reads: [],
    writes: [{ key: EMPIRE_OS_BACKUP_STORAGE_KEYS[0], expectedRevision: 0, rawValue: "[]" }],
  };
}

async function stageImportRequest(): Promise<StageImportRequest> {
  const prepared = await prepareServerImport({ getItem: () => null });
  if (prepared.status !== "prepared") throw new Error("Expected a valid empty import plan.");
  return { fence, idempotencyKey: "import:one", plan: prepared.plan };
}

function harness(options: {
  session?: ServerPersistenceAuthorityDependencies["resolveSession"];
  authorize?: ServerPersistenceAuthorityDependencies["authorize"];
  repository?: Partial<ServerPersistenceRepository>;
} = {}) {
  const scopedPrincipals: AuthenticatedPrincipal[] = [];
  const principalFactory = vi.fn((principal: AuthenticatedPrincipal) => {
    scopedPrincipals.push(principal);
    return repository;
  });
  const authorize = options.authorize ?? vi.fn<ServerPersistenceAuthorityDependencies["authorize"]>(async () => true);
  const repository: ServerPersistenceRepository = {
    readSnapshot: vi.fn<ServerPersistenceRepository["readSnapshot"]>(async () => ({ status: "snapshot", snapshot: snapshot() })),
    writeBatch: vi.fn<ServerPersistenceRepository["writeBatch"]>(async () => ({
      status: "conflict",
      reason: "store-revision",
      conflicts: [{ key: EMPIRE_OS_BACKUP_STORAGE_KEYS[0], expectedRevision: 0, actualRevision: 1 }],
    })),
    lookupCommit: vi.fn<ServerPersistenceRepository["lookupCommit"]>(async () => ({ status: "unresolved", retry: "same-request-only" })),
    stageImport: vi.fn<ServerPersistenceRepository["stageImport"]>(async () => ({
      status: "unavailable", outcome: "not-submitted", message: "Not configured.",
    })),
    ...options.repository,
  };
  const authority = createServerPersistenceAuthority({
    resolveSession: options.session ?? vi.fn<ServerPersistenceAuthorityDependencies["resolveSession"]>(
      async () => ({ status: "authenticated", subject: "verified-user" }),
    ),
    authorize,
    repositoryForPrincipal: principalFactory,
  });
  return { authority, authorize, principalFactory, repository, scopedPrincipals };
}

function request(headers?: HeadersInit): Request {
  return new Request("https://empire-os.invalid/api/persistence", { method: "POST", headers });
}

describe("server-owned persistence authority boundary", () => {
  it("uses verified server session identity, never browser identity headers or payload fields", async () => {
    const { authority, authorize, principalFactory, repository } = harness({
      session: vi.fn<ServerPersistenceAuthorityDependencies["resolveSession"]>(
        async () => ({ status: "authenticated", subject: "session-subject" }),
      ),
    });
    const result = await authority.readSnapshot(request({
      "x-empire-os-principal-id": "attacker",
      "x-empire-os-role": "owner",
      "x-empire-os-authorized": "true",
    }), { datasetId, protocolVersion: 1 });

    expect(result).toMatchObject({ status: "snapshot" });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ subject: "session-subject" }), datasetId, "read");
    expect(principalFactory).toHaveBeenCalledWith(expect.objectContaining({ subject: "session-subject" }));
    expect(repository.readSnapshot).toHaveBeenCalledWith({ datasetId, protocolVersion: 1 });
  });

  it.each([
    { datasetId, protocolVersion: 1, principalId: "attacker" },
    { datasetId, protocolVersion: 1, actor: "founder" },
    { datasetId, protocolVersion: 1, authorized: true },
  ])("rejects browser-supplied authority claims before authorization: %j", async (input) => {
    const { authority, authorize, principalFactory } = harness();
    expect(await authority.readSnapshot(request(), input)).toMatchObject({ status: "invalid-request" });
    expect(authorize).not.toHaveBeenCalled();
    expect(principalFactory).not.toHaveBeenCalled();
  });

  it("fails closed when the verified session is missing or malformed", async () => {
    const { authority, principalFactory } = harness({
      session: vi.fn<ServerPersistenceAuthorityDependencies["resolveSession"]>(
        async () => ({ status: "authenticated", subject: " " }),
      ),
    });
    expect(await authority.readSnapshot(request(), { datasetId, protocolVersion: 1 }))
      .toEqual({ status: "unauthorized", reason: "authentication-required" });
    expect(principalFactory).not.toHaveBeenCalled();
  });

  it.each(["readSnapshot", "writeBatch", "lookupCommit", "stageImport"] as const)(
    "rejects spoofed identity without a verified session for %s", async (operation) => {
      const { authority, authorize, principalFactory } = harness({
        session: vi.fn<ServerPersistenceAuthorityDependencies["resolveSession"]>(
          async () => ({ status: "unauthenticated" }),
        ),
      });
      expect(await authority[operation](request({
        "x-empire-os-principal-id": "founder", "x-empire-os-authorized": "true",
      }), { principalId: "founder", authorized: true }))
        .toEqual({ status: "unauthorized", reason: "authentication-required" });
      expect(authorize).not.toHaveBeenCalled();
      expect(principalFactory).not.toHaveBeenCalled();
    },
  );

  it("does not construct or call a repository when authorization denies access", async () => {
    const { authority, authorize, principalFactory, repository } = harness({
      authorize: vi.fn(async () => false),
    });
    expect(await authority.readSnapshot(request(), { datasetId, protocolVersion: 1 }))
      .toEqual({ status: "unauthorized", reason: "forbidden" });
    expect(authorize).toHaveBeenCalledWith(expect.any(Object), datasetId, "read");
    expect(principalFactory).not.toHaveBeenCalled();
    expect(repository.readSnapshot).not.toHaveBeenCalled();
  });

  it("preserves the existing stale-revision conflict contract", async () => {
    const { authority, repository } = harness();
    expect(await authority.writeBatch(request(), writeBatch())).toEqual({
      status: "conflict",
      reason: "store-revision",
      conflicts: [{ key: EMPIRE_OS_BACKUP_STORAGE_KEYS[0], expectedRevision: 0, actualRevision: 1 }],
    });
    expect(repository.writeBatch).toHaveBeenCalledWith(writeBatch());
  });

  it("reports a failed write transaction as unknown and never leaks database errors", async () => {
    const { authority } = harness({
      repository: {
        writeBatch: vi.fn(async () => { throw new Error("private connection failure details"); }),
      },
    });
    expect(await authority.writeBatch(request(), writeBatch())).toEqual({
      status: "unavailable",
      outcome: "unknown",
      message: "The write outcome could not be confirmed; retry only the exact original request.",
    });
  });

  it("preserves a confirmed rollback reported by the repository", async () => {
    const result = {
      status: "failed", outcome: "rolled-back", message: "Transaction aborted.",
    } satisfies Awaited<ReturnType<ServerPersistenceRepository["writeBatch"]>>;
    const { authority } = harness({
      repository: { writeBatch: vi.fn<ServerPersistenceRepository["writeBatch"]>(async () => result) },
    });
    expect(await authority.writeBatch(request(), writeBatch())).toEqual(result);
  });

  it("distinguishes repository construction failure from an unconfirmed write", async () => {
    const { authority, principalFactory } = harness();
    principalFactory.mockImplementation(() => { throw new Error("private configuration detail"); });
    expect(await authority.writeBatch(request(), writeBatch())).toEqual({
      status: "unavailable", outcome: "not-submitted", message: "PostgreSQL persistence is unavailable.",
    });
  });

  it("fails closed when authentication or authorization infrastructure throws", async () => {
    const authentication = harness({ session: vi.fn(async () => { throw new Error("private provider detail"); }) });
    expect(await authentication.authority.readSnapshot(request(), { datasetId, protocolVersion: 1 }))
      .toEqual({ status: "unavailable", outcome: "not-submitted", message: "Authentication service is unavailable." });
    expect(authentication.principalFactory).not.toHaveBeenCalled();

    const authorization = harness({ authorize: vi.fn(async () => { throw new Error("private policy detail"); }) });
    expect(await authorization.authority.readSnapshot(request(), { datasetId, protocolVersion: 1 }))
      .toEqual({ status: "unavailable", outcome: "not-submitted", message: "Authorization service is unavailable." });
    expect(authorization.principalFactory).not.toHaveBeenCalled();
  });

  it("authorizes commit lookup as a write capability before database access", async () => {
    const { authority, authorize, repository } = harness();
    const input = {
      datasetId,
      protocolVersion: 1,
      generation: 1,
      idempotencyKey: "request:one",
      requestSha256: "a".repeat(64),
    } satisfies CommitLookup;
    expect(await authority.lookupCommit(request(), input)).toEqual({ status: "unresolved", retry: "same-request-only" });
    expect(authorize).toHaveBeenCalledWith(expect.any(Object), datasetId, "write");
    expect(repository.lookupCommit).toHaveBeenCalledWith(input);
  });

  it("rechecks authorization before every repository access", async () => {
    const authorize = vi.fn<ServerPersistenceAuthorityDependencies["authorize"]>()
      .mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { authority, principalFactory, repository } = harness({ authorize });
    expect(await authority.readSnapshot(request(), { datasetId, protocolVersion: 1 })).toMatchObject({ status: "snapshot" });
    expect(await authority.readSnapshot(request(), { datasetId, protocolVersion: 1 }))
      .toEqual({ status: "unauthorized", reason: "forbidden" });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(principalFactory).toHaveBeenCalledTimes(1);
    expect(repository.readSnapshot).toHaveBeenCalledTimes(1);
  });

  it("authorizes imports separately and preserves the unavailable StageImportResult", async () => {
    const { authority, authorize, repository } = harness();
    const input = await stageImportRequest();
    expect(await authority.stageImport(request(), input))
      .toEqual({ status: "unavailable", outcome: "not-submitted", message: "Not configured." });
    expect(authorize).toHaveBeenCalledWith(expect.any(Object), datasetId, "import");
    expect(repository.stageImport).toHaveBeenCalledWith(input);
  });

  it("never reports an unconfirmed import exception as a confirmed rollback", async () => {
    const { authority } = harness({
      repository: {
        stageImport: vi.fn<ServerPersistenceRepository["stageImport"]>(
          async () => { throw new Error("private transaction details"); },
        ),
      },
    });
    expect(await authority.stageImport(request(), await stageImportRequest())).toEqual({
      status: "unavailable", outcome: "unknown",
      message: "The import outcome could not be confirmed; retry only the exact original request.",
    });
  });
});
