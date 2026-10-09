import { describe, expect, it, vi } from "vitest";
import { persistJsonArray, persistJsonValue, persistJsonArraysTransaction, PersistenceTransactionError, type PersistenceStorage } from "./persistence";

const createStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const storage = {
    data,
    getItem: vi.fn((key: string) => (data.has(key) ? data.get(key)! : null)),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
  };
  return storage;
};

describe("persistJsonArray", () => {
  it("stores a non-empty array as JSON under the supplied key", () => {
    const storage = createStorage();
    const records = [{ id: "a", nested: { value: 1 } }, { id: "b" }];
    persistJsonArray(storage, "records-key", records);

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith("records-key", JSON.stringify(records));
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(Object.fromEntries(storage.data)).toEqual({ "records-key": JSON.stringify(records) });
  });

  it("removes only the supplied key for an empty array", () => {
    const storage = createStorage({ "records-key": "[1]", "other-key": "[2]" });
    persistJsonArray(storage, "records-key", []);

    expect(storage.removeItem).toHaveBeenCalledTimes(1);
    expect(storage.removeItem).toHaveBeenCalledWith("records-key");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(Object.fromEntries(storage.data)).toEqual({ "other-key": "[2]" });
  });

  it("does not mutate the input array", () => {
    const records = [{ id: "a", tags: ["x"] }];
    const before = structuredClone(records);
    persistJsonArray(createStorage(), "k", records);
    expect(records).toEqual(before);
  });

  it("propagates setItem errors", () => {
    const storage: PersistenceStorage = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(() => persistJsonArray(storage, "k", [1])).toThrow("QuotaExceededError");
  });

  it("propagates removeItem errors", () => {
    const storage: PersistenceStorage = {
      setItem: () => {},
      removeItem: () => {
        throw new Error("remove failed");
      },
    };
    expect(() => persistJsonArray(storage, "k", [])).toThrow("remove failed");
  });
});

describe("persistJsonValue", () => {
  it("always stores the JSON representation under the supplied key", () => {
    const storage = createStorage();
    const value = { currentCash: "100", reservedTax: "", safetyBuffer: "0" };
    persistJsonValue(storage, "value-key", value);
    persistJsonValue(storage, "empty-key", {});
    persistJsonValue(storage, "array-key", []);

    expect(storage.setItem.mock.calls).toEqual([
      ["value-key", JSON.stringify(value)],
      ["empty-key", "{}"],
      ["array-key", "[]"],
    ]);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  describe("persistJsonArraysTransaction", () => {
    it("writes and verifies related stores without touching unrelated records", () => {
      const storage = createStorage({ other: "retained" });
      persistJsonArraysTransaction(storage, [{ key: "actions", records: [{ id: "a" }] }, { key: "plans", records: [{ id: "p" }] }]);
      expect(storage.getItem("actions")).toBe('[{"id":"a"}]');
      expect(storage.getItem("plans")).toBe('[{"id":"p"}]');
      expect(storage.getItem("other")).toBe("retained");
    });

    it("restores both stores if a later write fails", () => {
      const storage = createStorage({ actions: '[{"id":"old-action"}]', plans: '[{"id":"old-plan"}]' });
      storage.setItem.mockImplementationOnce((key, value) => { storage.data.set(key, value); })
        .mockImplementationOnce(() => { throw new Error("Quota exceeded"); });
      expect(() => persistJsonArraysTransaction(storage, [
        { key: "actions", records: [{ id: "new-action" }] }, { key: "plans", records: [{ id: "new-plan" }] },
      ])).toThrow("Previous storage restored");
      expect(storage.getItem("actions")).toBe('[{"id":"old-action"}]');
      expect(storage.getItem("plans")).toBe('[{"id":"old-plan"}]');
    });

    it("rejects silent writes and exposes failed rollback instead of claiming success", () => {
      const storage = createStorage({ actions: "old-actions", plans: "old-plans" });
      storage.setItem.mockImplementation(() => {});
      expect(() => persistJsonArraysTransaction(storage, [
        { key: "actions", records: [1] }, { key: "plans", records: [2] },
      ])).toThrow("verification failed");
      storage.setItem.mockImplementationOnce((key, value) => { storage.data.set(key, value); })
        .mockImplementation(() => { throw new Error("Storage unavailable"); });
      expect(() => persistJsonArraysTransaction(storage, [
        { key: "actions", records: [1] }, { key: "plans", records: [2] },
      ])).toThrow("Rollback failed");
    });

    it("does not rewrite already committed records during follow-up persistence effects", () => {
      const storage = createStorage({ actions: '[{"id":"a"}]' });
      persistJsonArraysTransaction(storage, [{ key: "actions", records: [{ id: "a" }] }, { key: "absent", records: [] }]);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
      expect(storage.getItem).toHaveBeenCalledWith("actions");
    });

    it("reports precisely the rollback keys still uncertain and preserves stores that never changed", () => {
      const storage = createStorage({ actions: '[{"id":"old"}]', plans: '[{"id":"plan"}]', other: "retained" });
      storage.setItem.mockImplementationOnce((key, value) => { storage.data.set(key, value); })
        .mockImplementation(() => { throw new Error("Storage unavailable"); });
      let failure: unknown;
      try {
        persistJsonArraysTransaction(storage, [
          { key: "actions", records: [{ id: "new" }] }, { key: "plans", records: [{ id: "updated" }] },
        ]);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(PersistenceTransactionError);
      if (!(failure instanceof PersistenceTransactionError)) throw new Error("Expected structured transaction failure.");
      expect(failure.rollbackFailedKeys).toEqual(["actions"]);
      expect(storage.getItem("plans")).toBe('[{"id":"plan"}]');
      expect(storage.getItem("other")).toBe("retained");
    });

    it("rejects duplicate keys before writing and preserves absent stores after rollback", () => {
      const storage = createStorage();
      expect(() => persistJsonArraysTransaction(storage, [
        { key: "actions", records: [1] }, { key: "actions", records: [2] },
      ])).toThrow("duplicate storage keys");
      expect(storage.setItem).not.toHaveBeenCalled();
      storage.setItem.mockImplementationOnce((key, value) => { storage.data.set(key, value); })
        .mockImplementationOnce(() => { throw new Error("Write failed"); });
      expect(() => persistJsonArraysTransaction(storage, [
        { key: "actions", records: [1] }, { key: "plans", records: [2] },
      ])).toThrow("Previous storage restored");
      expect(storage.data.size).toBe(0);
    });
  });

  it("does not mutate the input value", () => {
    const value = { a: 1, nested: { b: [1, 2] } };
    const before = structuredClone(value);
    persistJsonValue(createStorage(), "k", value);
    expect(value).toEqual(before);
  });

  it("propagates setItem errors", () => {
    const storage: PersistenceStorage = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(() => persistJsonValue(storage, "k", {})).toThrow("QuotaExceededError");
  });
});
