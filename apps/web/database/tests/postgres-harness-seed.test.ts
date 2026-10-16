import { Client } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DISPOSABLE_MARKER, type DisposableConfig } from "./disposable-config";
import { connectDisposable, seedDataset, seedDatasetInTransaction } from "./postgres-harness";

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), end: vi.fn() }));
vi.mock("pg", () => ({
  Client: class {
    query = mocks.query;
    connect = mocks.connect;
    end = mocks.end;
  },
}));

const config: DisposableConfig = {
  host: "127.0.0.1", port: 55432, database: "empire_os_test_seed_offline",
  user: "test_owner", password: "offline-only",
  application_name: "empire-os-disposable-integration", connectionTimeoutMillis: 5000,
};
const datasetId = "00000000-0000-4000-8000-000000000001";
const inserts = [
  "INSERT INTO empire_os_preparation.datasets",
  "INSERT INTO empire_os_preparation.generations",
  "INSERT INTO empire_os_preparation.store_values",
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
  mocks.query.mockResolvedValue({ rows: [{
    database: config.database, principal: config.user, marker: DISPOSABLE_MARKER, recovery: false,
  }] });
});

async function fixture(failAt?: string, rollbackFails = false) {
  const client = await connectDisposable(config);
  mocks.query.mockClear();
  const originalError = new Error("Simulated fixture failure.");
  const rollbackError = new Error("Simulated rollback failure.");
  let pending: string[] | null = null;
  const persisted: string[] = [];
  mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
    if (sql === failAt) throw originalError;
    if (sql === "BEGIN") {
      pending = [];
    } else if (sql === "ROLLBACK") {
      if (rollbackFails) throw rollbackError;
      pending = null;
    } else if (sql === "COMMIT") {
      if (!pending || inserts.some(insert => !pending?.includes(insert))) throw new Error("Deferred fixture constraints cannot pass.");
      persisted.push(...pending);
      pending = null;
    } else if (sql === "INSERT caller-owned work") {
      if (!pending) throw new Error("Caller work outside a transaction.");
      pending.push("caller-owned work");
    } else {
      const insert = inserts.find(prefix => sql.startsWith(prefix));
      if (!insert || !pending) throw new Error("Fixture insert outside the expected transaction.");
      expect(values).toEqual([datasetId]);
      pending.push(insert);
    }
    return { rows: [], command: sql };
  });
  return { client, persisted, originalError };
}

describe("dataset fixture seeding (offline driver simulation, no PostgreSQL)", () => {
  it("commits all three inserts together in their original order", async () => {
    const h = await fixture();
    await seedDataset(h.client, datasetId);
    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toHaveLength(5);
    expect(statements[0]).toBe("BEGIN");
    inserts.forEach((prefix, index) => expect(statements[index + 1]).toMatch(new RegExp(`^${prefix}`)));
    expect(statements[4]).toBe("COMMIT");
    expect(h.persisted).toEqual(inserts);
  });

  it.each([0, 1, 2])("rolls back failure at insert %i without persisting a partial fixture", async index => {
    const h = await fixture();
    const execute = mocks.query.getMockImplementation();
    if (!execute) throw new Error("Offline query simulation unavailable.");
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith(inserts[index])) throw h.originalError;
      return execute(sql, values);
    });
    await expect(seedDataset(h.client, datasetId)).rejects.toBe(h.originalError);
    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toBe("BEGIN");
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(statements).toHaveLength(index + 3);
    expect(h.persisted).toEqual([]);
  });

  it.each(["BEGIN", "COMMIT"])("attempts rollback and preserves the original error when %s fails", async failAt => {
    const h = await fixture(failAt);
    await expect(seedDataset(h.client, datasetId)).rejects.toBe(h.originalError);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(h.persisted).toEqual([]);
  });

  it("preserves the original failure even if rollback also fails", async () => {
    const h = await fixture("COMMIT", true);
    await expect(seedDataset(h.client, datasetId)).rejects.toBe(h.originalError);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it.each(["COMMIT", "ROLLBACK"])("leaves successful caller-owned seeding pending until the caller chooses %s", async completion => {
    const h = await fixture();
    await h.client.query("BEGIN");
    await h.client.query("INSERT caller-owned work");
    mocks.query.mockClear();
    await seedDatasetInTransaction(h.client, datasetId);
    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toHaveLength(3);
    inserts.forEach((prefix, index) => expect(statements[index].startsWith(prefix)).toBe(true));
    expect(h.persisted).toEqual([]);
    await h.client.query(completion);
    expect(h.persisted).toEqual(completion === "COMMIT" ? ["caller-owned work", ...inserts] : []);
  });

  it.each([0, 1, 2])("leaves rollback to the caller after failure at insert %i without committing earlier work", async index => {
    const h = await fixture();
    await h.client.query("BEGIN");
    await h.client.query("INSERT caller-owned work");
    mocks.query.mockClear();
    const execute = mocks.query.getMockImplementation();
    if (!execute) throw new Error("Offline query simulation unavailable.");
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith(inserts[index])) throw h.originalError;
      return execute(sql, values);
    });
    await expect(seedDatasetInTransaction(h.client, datasetId)).rejects.toBe(h.originalError);
    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toHaveLength(index + 1);
    expect(statements.every(sql => sql.startsWith("INSERT INTO empire_os_preparation."))).toBe(true);
    expect(h.persisted).toEqual([]);
    await h.client.query("ROLLBACK");
    expect(h.persisted).toEqual([]);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it.each([seedDataset, seedDatasetInTransaction])("rejects an unverified connection before any transaction command or insert (%#)", async seed => {
    mocks.query.mockClear();
    await expect(seed(new Client(config), datasetId)).rejects.toThrow("Unverified connection");
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
