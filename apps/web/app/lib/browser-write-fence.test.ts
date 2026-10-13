import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFullBackup, runBackupRestoreTransaction, STORAGE_KEY } from "./backup";
import { removeBrowserBusinessItem, RESTORE_INTERRUPTION_STORAGE_KEY, setBrowserBusinessItem } from "./browser-write-fence";

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    values,
    writes,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { writes.push(`set:${key}`); values.set(key, value); },
      removeItem: (key: string) => { writes.push(`remove:${key}`); values.delete(key); },
    },
  };
}

describe("browser restore write fence", () => {
  it("blocks direct business writes and removals while preserving the marker and business data", () => {
    const target = memory({
      [RESTORE_INTERRUPTION_STORAGE_KEY]: "untrusted marker contents",
      [STORAGE_KEY]: '[{"id":"retained"}]',
    });
    expect(() => setBrowserBusinessItem(target.storage, STORAGE_KEY, "[]")).toThrow("multi-store restore was interrupted");
    expect(() => removeBrowserBusinessItem(target.storage, STORAGE_KEY)).toThrow("multi-store restore was interrupted");
    expect(target.values.get(STORAGE_KEY)).toBe('[{"id":"retained"}]');
    expect(target.values.get(RESTORE_INTERRUPTION_STORAGE_KEY)).toBe("untrusted marker contents");
    expect(target.writes).toEqual([]);
  });

  it("does not allow guarded business helpers to overwrite or remove the marker itself", () => {
    const target = memory({ [RESTORE_INTERRUPTION_STORAGE_KEY]: "interrupted" });
    expect(() => setBrowserBusinessItem(target.storage, RESTORE_INTERRUPTION_STORAGE_KEY, "cleared"))
      .toThrow("multi-store restore was interrupted");
    expect(() => removeBrowserBusinessItem(target.storage, RESTORE_INTERRUPTION_STORAGE_KEY))
      .toThrow("multi-store restore was interrupted");
    expect(target.values.get(RESTORE_INTERRUPTION_STORAGE_KEY)).toBe("interrupted");
    expect(target.writes).toEqual([]);
  });

  it("fails closed if marker reads fail", () => {
    const target = memory();
    const storage = { ...target.storage, getItem: (key: string) => {
      if (key === RESTORE_INTERRUPTION_STORAGE_KEY) throw new Error("Storage denied");
      return target.storage.getItem(key);
    } };
    expect(() => setBrowserBusinessItem(storage, STORAGE_KEY, "[]")).toThrow("could not be verified");
    expect(target.writes).toEqual([]);
  });

  it("keeps the explicit complete-backup restore path available to an operator", () => {
    const target = memory({
      [RESTORE_INTERRUPTION_STORAGE_KEY]: "interrupted",
      [STORAGE_KEY]: '[{"id":"partial"}]',
    });
    const completeBackup = buildFullBackup({ getItem: () => null });
    expect(runBackupRestoreTransaction(target.storage, completeBackup)).toEqual({ ok: true });
    expect(target.values.get(RESTORE_INTERRUPTION_STORAGE_KEY)).toBeUndefined();
    expect(target.values.get(STORAGE_KEY)).toBeUndefined();
  });

  it("routes dashboard direct business-store mutations through the fenced helpers", () => {
    const dashboard = readFileSync(new URL("../empire-dashboard-client.tsx", import.meta.url), "utf8");
    const directWrites = [...dashboard.matchAll(/window\.localStorage\.(?:setItem|removeItem)\(([^,\n]+)/g)]
      .map((match) => match[1]);
    expect(directWrites).toEqual(["LAST_BACKUP_AT_STORAGE_KEY"]);
    expect(dashboard).toContain("setBrowserBusinessItem(window.localStorage, STRATEGIC_OBJECTIVES_STORAGE_KEY");
    expect(dashboard).toContain("removeBrowserBusinessItem(window.localStorage, SAVED_VIEWS_STORAGE_KEY");
  });
});
