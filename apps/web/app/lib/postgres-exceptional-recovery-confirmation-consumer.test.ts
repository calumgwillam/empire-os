import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type {
  ExceptionalRecoveryPostgresConnection,
  ExceptionalRecoveryPostgresSource,
} from "./postgres-exceptional-recovery-confirmation-consumer";
import { createPostgresExceptionalRecoveryConfirmationConsumer } from "./postgres-exceptional-recovery-confirmation-consumer";
import type { ExceptionalRecoveryConsumptionRequest } from "./exceptional-recovery-transaction-gate";

const challengeSha256 = "1".repeat(64);
const nonce = "2".repeat(64);
const confirmationId = "3".repeat(64);
const attemptId = "4".repeat(64);

function request(overrides: Partial<ExceptionalRecoveryConsumptionRequest> = {}): ExceptionalRecoveryConsumptionRequest {
  return {
    challengeSha256,
    nonce,
    confirmationId,
    attemptId,
    expiresAtMs: Date.now() + 60_000,
    ...overrides,
  };
}

function row(value: ExceptionalRecoveryConsumptionRequest): Record<string, unknown> {
  return {
    challenge_sha256: value.challengeSha256,
    nonce: value.nonce,
    confirmation_id: value.confirmationId,
    attempt_id: value.attemptId,
    expires_at_ms: String(value.expiresAtMs),
  };
}

function identity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    database: "empire_os_test_recovery_unit",
    login: "empire_os_recovery_test_runtime",
    effective: "empire_os_recovery_test_runtime",
    recovery: false,
    client_address: "127.0.0.1",
    tls: false,
    fsync: true,
    full_page_writes: true,
    safe_search_path: true,
    login_enabled: true,
    elevated: false,
    standalone: true,
    no_database_create: true,
    no_business_schema_access: true,
    no_other_table_access: true,
    no_other_sequence_access: true,
    no_other_function_access: true,
    no_recovery_function_access: true,
    no_other_schema_create: true,
    recovery_schema_access: true,
    recovery_table_access: true,
    not_recovery_owner: true,
    ...overrides,
  };
}

function connection(
  queryImpl: (sql: string, values?: unknown[]) => Promise<{
    command?: string;
    rowCount: number | null;
    rows: readonly Record<string, unknown>[];
  }>,
  onRelease: (destroy?: boolean) => void = () => {},
): ExceptionalRecoveryPostgresConnection {
  return { query: queryImpl, release: onRelease };
}

function scriptedConnection(options: Readonly<{
  insertRowCount?: number | null;
  conflicts?: readonly Record<string, unknown>[];
  serverNowMs?: number;
  identity?: Record<string, unknown>;
  contract?: Record<string, unknown>;
  failAt?: string;
  rollbackCommand?: string;
  commitCommand?: string;
  release?: (destroy?: boolean) => void;
}> = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = connection(async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes("current_database() AS database")) {
      return { rowCount: 1, rows: [options.identity ?? identity()] };
    }
    if (sql.includes("nonce_unique")) {
      return {
        rowCount: 1,
        rows: [options.contract ?? {
          table_exists: true,
          permanent_table: true,
          exact_columns: true,
          nonce_unique: true,
          confirmation_unique: true,
          attempt_unique: true,
          deferred_expiry_trigger: true,
          no_mutating_rules: true,
        }],
      };
    }
    if (sql.startsWith("BEGIN")) {
      if (options.failAt === "begin") throw new Error("BEGIN acknowledgement lost");
      return { command: "BEGIN", rowCount: null, rows: [] };
    }
    if (sql.startsWith("SET LOCAL")) {
      if (options.failAt === sql) throw new Error("Setting failure");
      return { command: "SET", rowCount: null, rows: [] };
    }
    if (sql === "SHOW synchronous_commit") {
      return { rowCount: 1, rows: [{ synchronous_commit: "on" }] };
    }
    if (sql.startsWith("INSERT INTO")) {
      if (options.failAt === "insert") throw new Error("Insert failure");
      return { rowCount: options.insertRowCount ?? 1, rows: [] };
    }
    if (sql.startsWith("SELECT floor(extract")) {
      return { rowCount: 1, rows: [{ now_ms: String(options.serverNowMs ?? Date.now()) }] };
    }
    if (sql.startsWith("SELECT challenge_sha256")) {
      return { rowCount: options.conflicts?.length ?? 0, rows: options.conflicts ?? [] };
    }
    if (sql === "COMMIT") {
      if (options.failAt === "commit") throw new Error("Commit acknowledgement lost");
      return { command: options.commitCommand ?? "COMMIT", rowCount: null, rows: [] };
    }
    if (sql === "ROLLBACK") {
      if (options.failAt === "rollback") throw new Error("Rollback acknowledgement lost");
      return { command: options.rollbackCommand ?? "ROLLBACK", rowCount: null, rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }, options.release);
  return { client, calls };
}

function sourceFor(client: ExceptionalRecoveryPostgresConnection): ExceptionalRecoveryPostgresSource {
  return {
    database: "empire_os_test_recovery_unit",
    login: "empire_os_recovery_test_runtime",
    connectionMode: "disposable-loopback",
    connect: async () => client,
  };
}

describe("PostgreSQL exceptional recovery confirmation consumer", () => {
  it("binds durable insertion to challenge, nonce, confirmation, attempt and expiry", async () => {
    const scripted = scriptedConnection();
    const consumer = createPostgresExceptionalRecoveryConfirmationConsumer(sourceFor(scripted.client));
    const result = await consumer.consumeIfUnused(request());
    expect(result).toEqual({ status: "consumed" });
    const insert = scripted.calls.find((call) => call.sql.startsWith("INSERT INTO"));
    expect(insert?.values).toEqual([challengeSha256, nonce, confirmationId, attemptId, expect.any(Number)]);
    expect(scripted.calls.map((call) => call.sql)).toContain("SET LOCAL search_path = pg_catalog");
    expect(scripted.calls.map((call) => call.sql)).toContain("SET LOCAL synchronous_commit = 'on'");
    expect(scripted.calls.map((call) => call.sql)).toContain("COMMIT");
  });

  it("distinguishes an exact replay from conflicting reused identities", async () => {
    const exact = request();
    const duplicate = scriptedConnection({ insertRowCount: 0, conflicts: [row(exact)] });
    expect(await createPostgresExceptionalRecoveryConfirmationConsumer(sourceFor(duplicate.client)).consumeIfUnused(exact))
      .toMatchObject({ status: "already-consumed" });

    const conflict = scriptedConnection({
      insertRowCount: 0,
      conflicts: [row({ ...exact, attemptId: "5".repeat(64) })],
    });
    expect(await createPostgresExceptionalRecoveryConfirmationConsumer(sourceFor(conflict.client)).consumeIfUnused(exact))
      .toMatchObject({ status: "conflict" });

    const mismatchedChallenge = scriptedConnection({
      insertRowCount: 0,
      conflicts: [row({ ...exact, challengeSha256: "9".repeat(64) })],
    });
    expect(await createPostgresExceptionalRecoveryConfirmationConsumer(sourceFor(mismatchedChallenge.client))
      .consumeIfUnused(exact)).toMatchObject({ status: "conflict" });

    const mismatchedExpiry = scriptedConnection({
      insertRowCount: 0,
      conflicts: [row({ ...exact, expiresAtMs: exact.expiresAtMs + 1 })],
    });
    expect(await createPostgresExceptionalRecoveryConfirmationConsumer(sourceFor(mismatchedExpiry.client))
      .consumeIfUnused(exact)).toMatchObject({ status: "conflict" });
  });

  it("refuses expired, malformed, or database-role-bypassing inputs", async () => {
    const expired = request({ expiresAtMs: Date.now() - 1 });
    const expiredDb = scriptedConnection({ insertRowCount: 0, serverNowMs: Date.now() });
    expect(await createPostgresExceptionalRecoveryConfirmationConsumer(sourceFor(expiredDb.client)).consumeIfUnused(expired))
      .toMatchObject({ status: "expired" });

    const malformed = scriptedConnection();
    expect(await createPostgresExceptionalRecoveryConfirmationConsumer(sourceFor(malformed.client))
      .consumeIfUnused(request({ nonce: "weak" })))
      .toMatchObject({ status: "invalid-input" });
    expect(malformed.calls).toHaveLength(0);

    const bypass = scriptedConnection({ identity: identity({ no_other_table_access: false }) });
    expect(await createPostgresExceptionalRecoveryConfirmationConsumer(sourceFor(bypass.client)).consumeIfUnused(request()))
      .toMatchObject({ status: "unavailable" });
    expect(bypass.calls.some((call) => call.sql.startsWith("BEGIN"))).toBe(false);

    const missingUnique = scriptedConnection({
      contract: {
        table_exists: true, permanent_table: true, exact_columns: true, nonce_unique: false,
        confirmation_unique: true, attempt_unique: true,
        deferred_expiry_trigger: true, no_mutating_rules: true,
      },
    });
    expect(await createPostgresExceptionalRecoveryConfirmationConsumer(sourceFor(missingUnique.client)).consumeIfUnused(request()))
      .toMatchObject({ status: "unavailable" });
    expect(missingUnique.calls.some((call) => call.sql.startsWith("BEGIN"))).toBe(false);
  });

  it("fails closed for connection, transaction, rollback, and ambiguous commit failures", async () => {
    const unreachable: ExceptionalRecoveryPostgresSource = {
      ...sourceFor(connection(async () => { throw new Error("unused"); })),
      connect: async () => { throw new Error("connection failed"); },
    };
    expect(await createPostgresExceptionalRecoveryConfirmationConsumer(unreachable).consumeIfUnused(request()))
      .toMatchObject({ status: "unavailable" });

    const rolledBack = scriptedConnection({ failAt: "insert" });
    expect(await createPostgresExceptionalRecoveryConfirmationConsumer(sourceFor(rolledBack.client)).consumeIfUnused(request()))
      .toMatchObject({ status: "unavailable" });

    const beginFailure = scriptedConnection({ failAt: "begin" });
    expect(await createPostgresExceptionalRecoveryConfirmationConsumer(sourceFor(beginFailure.client)).consumeIfUnused(request()))
      .toMatchObject({ status: "unavailable" });
    expect(beginFailure.calls.some((call) => call.sql === "ROLLBACK")).toBe(true);

    const timeout = scriptedConnection({ failAt: "SET LOCAL statement_timeout = '10s'" });
    expect(await createPostgresExceptionalRecoveryConfirmationConsumer(sourceFor(timeout.client)).consumeIfUnused(request()))
      .toMatchObject({ status: "unavailable" });

    const rollbackFailure = scriptedConnection({ failAt: "insert", rollbackCommand: "COMMIT" });
    expect(await createPostgresExceptionalRecoveryConfirmationConsumer(sourceFor(rollbackFailure.client)).consumeIfUnused(request()))
      .toMatchObject({ status: "uncertain" });

    let destroyed = false;
    const ambiguousCommit = scriptedConnection({
      failAt: "commit",
      release: (destroy) => { destroyed = destroy === true; },
    });
    expect(await createPostgresExceptionalRecoveryConfirmationConsumer(sourceFor(ambiguousCommit.client)).consumeIfUnused(request()))
      .toMatchObject({ status: "uncertain" });
    expect(destroyed).toBe(true);
    expect(ambiguousCommit.calls.some((call) => call.sql === "ROLLBACK")).toBe(false);
  });

  it("does not report success for malformed transaction outcomes", async () => {
    const malformedCommit = scriptedConnection({ commitCommand: "SELECT" });
    expect(await createPostgresExceptionalRecoveryConfirmationConsumer(sourceFor(malformedCommit.client)).consumeIfUnused(request()))
      .toMatchObject({ status: "uncertain" });
  });
});
