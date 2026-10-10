import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transpileModule, ScriptTarget, ModuleKind } from "typescript";
import { describe, expect, it } from "vitest";
import { readStartupStorage, validateSavedViews } from "./startup-hydration";
import { EMPIRE_OS_BACKUP_STORAGE_KEYS, DEFAULT_SAVED_VIEW_STORAGE_KEY, SAVED_VIEWS_STORAGE_KEY,
  CASH_POSITION_STORAGE_KEY, FOUNDER_INTELLIGENCE_STORAGE_KEY, STORAGE_KEY, type BackupStorage } from "./backup";
import { persistJsonArray, persistJsonValue, persistJsonArraysTransaction } from "./persistence";
import * as backup from "./backup";

const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
function execute(code: string, context: Record<string, unknown>) {
  runInNewContext(transpileModule(code, { compilerOptions: {
    target: ScriptTarget.ES2022, module: ModuleKind.ESNext,
  } }).outputText, context, { timeout: 1000 });
}
function effect(ending: string): string {
  const end = page.indexOf(ending);
  const start = page.lastIndexOf("  useEffect(() => {", end);
  if (start < 0 || end < start) throw new Error(`Cannot locate effect ${ending}`);
  return `(() => {${page.slice(start + "  useEffect(() => {".length, end)}})();`;
}
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  const storage: BackupStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); data.set(key, value); },
    removeItem: (key) => { writes.push(key); data.delete(key); },
  };
  return { data, writes, storage };
}

describe("Startup storage validation", () => {
  it.each(EMPIRE_OS_BACKUP_STORAGE_KEYS.filter((key) => key !== DEFAULT_SAVED_VIEW_STORAGE_KEY))(
    "rejects malformed existing %s without any writes", (key) => {
      for (const malformed of ["", "{broken", "null", '"wrong shape"']) {
        const target = memory({ [key]: malformed });
        expect(() => readStartupStorage(target.storage)).toThrow();
        expect(target.storage.getItem(key)).toBe(malformed);
        expect(target.writes).toEqual([]);
      }
    });
  it.each(EMPIRE_OS_BACKUP_STORAGE_KEYS)(
    "fails closed on read exceptions at %s", (key) => {
      const target = memory({ [STORAGE_KEY]: '[{"id":"retained"}]' });
      const get = target.storage.getItem;
      target.storage.getItem = (name) => {
        if (name === key) throw new Error("Read access denied");
        return get(name);
      };
      expect(() => readStartupStorage(target.storage)).toThrow("Read access denied");
      expect(target.writes).toEqual([]);
      expect(target.data.get(STORAGE_KEY)).toBe('[{"id":"retained"}]');
    });
  it("distinguishes absent first-run stores from failed reads", () => {
    const target = memory();
    expect(readStartupStorage(target.storage)).toEqual(Object.fromEntries(EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => [key, null])));
    expect(target.writes).toEqual([]);
  });
  it("rejects malformed array members and daily snapshot entries rather than filtering them away", () => {
    const nonArrayKeys = new Set<string>([
      DEFAULT_SAVED_VIEW_STORAGE_KEY, CASH_POSITION_STORAGE_KEY, FOUNDER_INTELLIGENCE_STORAGE_KEY,
    ]);
    for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS.filter((key) => !nonArrayKeys.has(key))) {
      expect(() => readStartupStorage(memory({ [key]: "[null]" }).storage)).toThrow();
    }
    expect(() => readStartupStorage(memory({ [backup.DAILY_POSTURE_SNAPSHOTS_STORAGE_KEY]: "[{}]" }).storage)).toThrow();
  });
  it("requires a stable verified read before returning hydrated data", () => {
    const target = memory();
    let reads = 0;
    target.storage.getItem = (key) => key === STORAGE_KEY && ++reads > 1 ? '[{"id":"intervening"}]' : null;
    expect(() => readStartupStorage(target.storage)).toThrow("changed during startup validation");
    expect(target.writes).toEqual([]);
  });
  it("preserves exact legacy strings and does not normalize or write during preflight", () => {
    const original = ' [ { "id": "legacy", "unknownEvidence": {"source":"retained"} } ] ';
    const target = memory({ [STORAGE_KEY]: original });
    expect(readStartupStorage(target.storage)[STORAGE_KEY]).toBe(original);
    expect(target.writes).toEqual([]);
  });
});

describe("Production saved-view hydration and persistence", () => {
  const start = page.indexOf("  useEffect(() => {", page.indexOf("const [savedViewLoadError"));
  const end = page.indexOf("  }, []);", start);
  const load = `(() => {${page.slice(start + "  useEffect(() => {".length, end)}})();`;
  const saveViews = effect("  }, [savedViews, savedViewsLoaded]);");
  const saveDefault = effect("  }, [defaultSavedViewId, defaultSavedViewLoaded]);");
  function context(target: ReturnType<typeof memory>) {
    const state: Record<string, unknown> = {
      ...backup, window: { localStorage: target.storage }, validateSavedViews,
      savedViewsLoaded: false, defaultSavedViewLoaded: false, savedViews: [], defaultSavedViewId: "",
      getDefaultRecordControls: () => ({}),
      setSelectedSavedViewId: () => {}, setRenameViewName: () => {}, setRecordControls: () => {},
    };
    for (const [setter, field] of [
      ["setSavedViewsLoaded", "savedViewsLoaded"], ["setDefaultSavedViewLoaded", "defaultSavedViewLoaded"],
      ["setSavedViews", "savedViews"], ["setDefaultSavedViewId", "defaultSavedViewId"],
      ["setSavedViewLoadError", "error"],
    ]) state[setter] = (value: unknown) => { state[field] = value; };
    return state;
  }
  it.each(["{broken", "{}", "[null]", '[{"id":"view","name":"Saved","controls":null}]'])(
    "does not erase malformed saved views %s or their default selection", (raw) => {
      const target = memory({ [SAVED_VIEWS_STORAGE_KEY]: raw, [DEFAULT_SAVED_VIEW_STORAGE_KEY]: "view" });
      const state = context(target);
      execute(load + saveViews + saveDefault, state);
      expect(state.savedViewsLoaded).toBe(false);
      expect(state.defaultSavedViewLoaded).toBe(false);
      expect(state.error).toContain("persistence is blocked");
      expect(target.writes).toEqual([]);
      expect(Object.fromEntries(target.data)).toEqual({ [SAVED_VIEWS_STORAGE_KEY]: raw, [DEFAULT_SAVED_VIEW_STORAGE_KEY]: "view" });
    });
  it("does not enable persistence after storage read exceptions or before hydration", () => {
    const target = memory({ [SAVED_VIEWS_STORAGE_KEY]: "[]", [DEFAULT_SAVED_VIEW_STORAGE_KEY]: "retained" });
    target.storage.getItem = () => { throw new Error("Read denied"); };
    const state = context(target);
    execute(saveViews + saveDefault, state);
    execute(load + saveViews + saveDefault, state);
    expect(target.writes).toEqual([]);
    expect(state.error).toContain("Read denied");
  });
  it("preserves first-run behavior and enables normal saving only after successful hydration", () => {
    const target = memory();
    const state = context(target);
    execute(load, state);
    expect(state.savedViewsLoaded).toBe(true);
    state.savedViews = [{ id: "new", name: "View", controls: {} }];
    state.defaultSavedViewId = "new";
    execute(saveViews + saveDefault, state);
    expect(JSON.parse(target.storage.getItem(SAVED_VIEWS_STORAGE_KEY)!)).toEqual(state.savedViews);
    expect(target.storage.getItem(DEFAULT_SAVED_VIEW_STORAGE_KEY)).toBe("new");
  });
  it("retains an orphan default-view identity rather than silently removing stored evidence", () => {
    const target = memory({ [SAVED_VIEWS_STORAGE_KEY]: "[]", [DEFAULT_SAVED_VIEW_STORAGE_KEY]: "legacy-selection" });
    const state = context(target);
    execute(load + saveDefault, state);
    expect(target.storage.getItem(DEFAULT_SAVED_VIEW_STORAGE_KEY)).toBe("legacy-selection");
  });
});

describe("Production operating persistence gates", () => {
  const endings = [
    "[captures, operatingDataLoaded]", "[conversions, operatingDataLoaded]",
    "[icarusAssessments, icarusLoaded, operatingDataLoaded]", "[people, operatingDataLoaded]",
    "[projects, operatingDataLoaded]", "[leads, operatingDataLoaded]", "[delegationHandoffs, operatingDataLoaded]",
    "[workingRelationships, operatingDataLoaded]", "[founderIntelligence, operatingDataLoaded]",
    "[cashPosition, operatingDataLoaded]", "[incomeRecords, operatingDataLoaded]", "[expenseRecords, operatingDataLoaded]",
    "[commitmentRecords, operatingDataLoaded]", "[taxPaymentRecords, operatingDataLoaded]",
    "[outreachContacts, operatingDataLoaded]", "[strategicObjectives, strategicObjectivesLoaded, operatingDataLoaded]",
    "[strategicReviews, strategicReviewsLoaded, operatingDataLoaded]",
    "[todaySnapshotJson, todaySnapshotDate, operatingDataLoaded, changeHistoryLoaded, strategicObjectivesLoaded, strategicReviewsLoaded, icarusLoaded]",
  ];
  it.each(endings)("prevents writes before completed successful hydration: %s", (ending) => {
    const target = memory({ [STORAGE_KEY]: "original evidence" });
    execute(effect(`  }, ${ending});`), {
      window: { localStorage: target.storage }, operatingDataLoaded: false,
      restoreInProgressRef: { current: false },
    });
    expect(target.writes).toEqual([]);
  });
  it("leaves main hydration unsuccessful on malformed data or a read exception, then blocks capture autosave", () => {
    const start = page.indexOf("  useEffect(() => {", page.indexOf("setIcarusLoaded(true)"));
    const end = page.indexOf("  }, []);", start);
    const load = `(() => {${page.slice(start + "  useEffect(() => {".length, end)}})();`;
    for (const denied of [false, true]) {
      const target = memory({ [STORAGE_KEY]: "{malformed" });
      if (denied) target.storage.getItem = () => { throw new Error("Read denied"); };
      const state: Record<string, unknown> = {
        ...backup, readStartupStorage, window: { localStorage: target.storage },
        operatingDataLoaded: false, captures: [], persistJsonArray,
        restoreInProgressRef: { current: false },
        setOperatingDataLoaded: (value: boolean) => { state.operatingDataLoaded = value; },
        setFeedback: () => {},
        setStartupHydrationFailure: (value: string) => { state.error = value; },
      };
      for (const name of ["people", "conversions", "projects", "leads", "handoffs", "founderIntelligence", "income", "expenses"]) {
        state[`${name}WritableRef`] = { current: false };
      }
      execute(load + effect("  }, [captures, operatingDataLoaded]);"), state);
      expect(state.operatingDataLoaded).toBe(false);
      expect(state.error).toContain("persistence remains disabled");
      expect(target.data.get(STORAGE_KEY)).toBe("{malformed");
      expect(target.writes).toEqual([]);
    }
  });
  it("preserves normal capture saving after successful loading", () => {
    const target = memory({ [STORAGE_KEY]: '[{"id":"old"}]' });
    execute(effect("  }, [captures, operatingDataLoaded]);"), {
      ...backup, persistJsonArray, persistJsonValue, persistJsonArraysTransaction,
      window: { localStorage: target.storage }, operatingDataLoaded: true,
      restoreInProgressRef: { current: false }, captures: [{ id: "new" }],
    });
    expect(target.storage.getItem(STORAGE_KEY)).toBe('[{"id":"new"}]');
  });
  it("permits a genuinely absent capture store to initialize only after startup validation succeeds", () => {
    const target = memory();
    const storage = readStartupStorage(target.storage);
    expect(storage[STORAGE_KEY]).toBeNull();
    execute(effect("  }, [captures, operatingDataLoaded]);"), {
      ...backup, persistJsonArray, window: { localStorage: target.storage },
      operatingDataLoaded: true, restoreInProgressRef: { current: false }, captures: [{ id: "first-record" }],
    });
    expect(target.storage.getItem(STORAGE_KEY)).toBe('[{"id":"first-record"}]');
  });
});
