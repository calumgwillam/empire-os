import { describe, expect, it, vi } from "vitest";
import { persistJsonArray, persistJsonValue, type PersistenceStorage } from "./persistence";

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
