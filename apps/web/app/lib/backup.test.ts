import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  CASH_POSITION_STORAGE_KEY,
  CHANGE_HISTORY_STORAGE_KEY,
  CONVERSION_STORAGE_KEY,
  EMPIRE_OS_BACKUP_STORAGE_KEYS,
  FOUNDER_INTELLIGENCE_STORAGE_KEY,
  PERSON_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
  STORAGE_KEY,
  buildFullBackup,
  getBackupHealth,
  runBackupRestoreTransaction,
  validateEmpireOsBackup,
  type BackupStorage,
  type EmpireOsBackup,
} from "./backup";

const validChangeEvent = {
  id: "evt-1",
  timestamp: "2026-01-01T10:00:00.000Z",
  recordType: "Project",
  recordId: "proj-1",
  recordTitle: "Example",
  actor: "Tester",
  action: "Updated",
  changes: [{ field: "status", before: "Open", after: "Closed" }],
};

const makeBackup = (overrides: Record<string, unknown> = {}, storage: Record<string, unknown> = {}) => ({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  createdAt: "2026-01-01T12:00:00.000Z",
  storage: {
    [STORAGE_KEY]: JSON.stringify([{ id: "c1" }]),
    [PROJECT_STORAGE_KEY]: null,
    [CASH_POSITION_STORAGE_KEY]: JSON.stringify({ currentCash: "100" }),
    [CHANGE_HISTORY_STORAGE_KEY]: JSON.stringify([validChangeEvent]),
    ...storage,
  },
  ...overrides,
});

describe("validateEmpireOsBackup", () => {
  it("accepts a correct backup and returns normalised storage", () => {
    const input = makeBackup();
    const result = validateEmpireOsBackup(input);
    expect(result).toEqual({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: input.createdAt,
      storage: input.storage,
    });
  });

  it("rejects non-object input", () => {
    expect(() => validateEmpireOsBackup(null)).toThrow("does not contain a JSON object");
    expect(() => validateEmpireOsBackup([])).toThrow("does not contain a JSON object");
  });

  it("rejects the wrong format", () => {
    expect(() => validateEmpireOsBackup(makeBackup({ format: "something-else" }))).toThrow("not an Empire OS full-backup file");
  });

  it("rejects unsupported versions", () => {
    expect(() => validateEmpireOsBackup(makeBackup({ version: 2 }))).toThrow("Backup version 2 is not supported");
    expect(() => validateEmpireOsBackup(makeBackup({ version: "1" }))).toThrow("is not supported");
  });

  it("rejects invalid createdAt", () => {
    expect(() => validateEmpireOsBackup(makeBackup({ createdAt: "not-a-date" }))).toThrow("creation date is missing or invalid");
    expect(() => validateEmpireOsBackup(makeBackup({ createdAt: "2026-01-01" }))).toThrow("creation date is missing or invalid");
    expect(() => validateEmpireOsBackup(makeBackup({ createdAt: "2026-13-45T00:00:00Z" }))).toThrow("creation date is missing or invalid");
    expect(() => validateEmpireOsBackup(makeBackup({ createdAt: undefined }))).toThrow("creation date is missing or invalid");
  });

  it("rejects missing or empty storage", () => {
    expect(() => validateEmpireOsBackup(makeBackup({ storage: [] }))).toThrow("storage section is missing or invalid");
    expect(() => validateEmpireOsBackup(makeBackup({ storage: {} }))).toThrow("storage section is empty");
  });

  it("rejects unsupported storage keys", () => {
    expect(() => validateEmpireOsBackup(makeBackup({}, { "unknown-key": "[]" }))).toThrow("unsupported storage key: unknown-key");
  });

  it("rejects non-string, non-null stored values", () => {
    expect(() => validateEmpireOsBackup(makeBackup({}, { [STORAGE_KEY]: [] }))).toThrow(`stored value for ${STORAGE_KEY} must be a string or null`);
  });

  it("rejects invalid array-backed stores", () => {
    expect(() => validateEmpireOsBackup(makeBackup({}, { [PROJECT_STORAGE_KEY]: "{}" }))).toThrow(`invalid array data for ${PROJECT_STORAGE_KEY}`);
    expect(() => validateEmpireOsBackup(makeBackup({}, { [STORAGE_KEY]: "not json" }))).toThrow(`invalid array data for ${STORAGE_KEY}`);
  });

  it("rejects invalid change-history events", () => {
    const badEvents = [
      { ...validChangeEvent, action: "Renamed" },
      { ...validChangeEvent, timestamp: "garbage" },
      { ...validChangeEvent, id: "  " },
      { ...validChangeEvent, changes: [{ field: "", before: 1, after: 2 }] },
      { ...validChangeEvent, changes: [{ field: "status", before: 1 }] },
    ];
    for (const event of badEvents) {
      expect(() => validateEmpireOsBackup(makeBackup({}, { [CHANGE_HISTORY_STORAGE_KEY]: JSON.stringify([event]) })))
        .toThrow("invalid change history events");
    }
  });

  it("rejects an invalid cash-position object", () => {
    for (const cash of ["[]", "null", "42", "not json"]) {
      expect(() => validateEmpireOsBackup(makeBackup({}, { [CASH_POSITION_STORAGE_KEY]: cash })))
        .toThrow(`invalid object data for ${CASH_POSITION_STORAGE_KEY}`);
    }
  });

  it("accepts a null cash position", () => {
    expect(() => validateEmpireOsBackup(makeBackup({}, { [CASH_POSITION_STORAGE_KEY]: null }))).not.toThrow();
  });

  it("validates founder-intelligence storage as an object while remaining optional for legacy backups", () => {
    expect(() => validateEmpireOsBackup(makeBackup({}, {
      [FOUNDER_INTELLIGENCE_STORAGE_KEY]: JSON.stringify({
        pairRecords: [],
        trioRecords: [],
        responsibilityFits: [],
      }),
    }))).not.toThrow();
    expect(() => validateEmpireOsBackup(makeBackup({}, {
      [FOUNDER_INTELLIGENCE_STORAGE_KEY]: "[]",
    }))).toThrow(`invalid object data for ${FOUNDER_INTELLIGENCE_STORAGE_KEY}`);
    expect(() => validateEmpireOsBackup(makeBackup())).not.toThrow();
  });

  it("blocks malformed nested founder intelligence before a backup can be restored", () => {
    for (const founderIntelligence of [
      { pairRecords: [{ personIds: ["calum", "lewis"], observations: [{
        id: "missing-claim", dimension: "communication",
      }] }] },
      { responsibilityFits: [{ id: "fit", title: "Delivery", assessments: [{
        id: "missing-claim", personId: "emeka", responsibility: "Delivery",
        contribution: "executor", fit: "demonstrated-capability",
      }] }] },
      { operationalOutcomes: [{ id: "outcome", personId: "emeka" }] },
    ]) {
      expect(() => validateEmpireOsBackup(makeBackup({}, {
        [FOUNDER_INTELLIGENCE_STORAGE_KEY]: JSON.stringify(founderIntelligence),
      }))).toThrow("Stored founder intelligence contains malformed");
    }
  });

  it("preserves valid unresolved citations and legacy People and Action records without normalization", () => {
    const founderIntelligence = {
      pairRecords: [{
        id: "pair:calum:lewis", personIds: ["calum", "lewis"],
        observations: [{
          id: "unresolved-expectation", dimension: "communication",
          relationshipKind: "source-grounded-understanding",
          claim: {
            id: "unresolved-claim", status: "unresolved",
            candidateStatus: "evidence-grounded-understanding",
            statement: "A statement awaiting its recorded source.",
            evidence: [{
              type: "source-answer", personId: "calum",
              sourceSubmissionId: "unavailable-source", answerIndex: 2,
            }],
          },
        }],
      }],
    };
    const input = makeBackup({}, {
      [FOUNDER_INTELLIGENCE_STORAGE_KEY]: JSON.stringify(founderIntelligence),
      [PERSON_STORAGE_KEY]: JSON.stringify([{ id: "emeka", accessLevel: "Team Member" }]),
      [CONVERSION_STORAGE_KEY]: JSON.stringify([{ id: "legacy-action", targetType: "Convert to Action" }]),
    });
    const before = structuredClone(input);
    expect(validateEmpireOsBackup(input).storage).toEqual(input.storage);
    expect(input).toEqual(before);
  });

  it("blocks malformed individual understanding and Action outcome evidence in backups", () => {
    expect(() => validateEmpireOsBackup(makeBackup({}, {
      [PERSON_STORAGE_KEY]: JSON.stringify([{
        id: "person", operatingProfile: { individualUnderstandings: [{ id: "malformed" }] },
      }]),
    }))).toThrow("An individual operating understanding has a malformed nested record.");
    for (const evidence of [null, {}, [{ id: "missing-requirement" }]]) {
      expect(() => validateEmpireOsBackup(makeBackup({}, {
        [CONVERSION_STORAGE_KEY]: JSON.stringify([{
          id: "action", targetType: "Convert to Action", responsibilityOutcomeEvidence: evidence,
        }]),
      }))).toThrow("malformed responsibility outcome evidence");
    }
  });

  it("round-trips valid Phase 4 nested records verbatim without inferring governance or evidence status", () => {
    const input = makeBackup({}, {
      [PERSON_STORAGE_KEY]: JSON.stringify([{
        id: "employee", accessLevel: "Team Member", authority: "Existing execution boundary",
        operatingProfile: { individualUnderstandings: [{
          id: "understanding", dimension: "standards",
          understanding: {
            id: "understanding-claim", status: "unresolved", statement: "Awaiting evidence.",
            sourceSubmissionIds: ["unavailable-submission"],
            sourceAnswerReferences: [{ sourceSubmissionId: "unavailable-submission", answerIndexes: [0] }],
          },
          interpretations: [],
        }] },
      }]),
      [CONVERSION_STORAGE_KEY]: JSON.stringify([{
        id: "action", targetType: "Convert to Action", status: "Completed",
        responsibilityOutcomeEvidence: [{
          id: "assertion", responsibilityId: "responsibility", requirementId: "requirement",
          personId: "employee", contribution: "executor", outcomeId: "outcome",
          outcome: "successful", observedResult: "Recorded execution result.",
          evidenceStatus: "unreviewed",
        }],
      }]),
      [FOUNDER_INTELLIGENCE_STORAGE_KEY]: JSON.stringify({
        pairRecords: [], trioRecords: [], responsibilities: [], responsibilityFits: [],
        developmentOpportunities: [], operationalOutcomes: [],
      }),
    });
    const before = structuredClone(input);
    const validated = validateEmpireOsBackup(input);
    const storage = new MemoryStorage();
    expect(runBackupRestoreTransaction(storage, validated)).toEqual({ ok: true });
    for (const key of [PERSON_STORAGE_KEY, CONVERSION_STORAGE_KEY, FOUNDER_INTELLIGENCE_STORAGE_KEY]) {
      expect(storage.getItem(key)).toBe(validated.storage[key]);
    }
    expect(input).toEqual(before);
  });
});

describe("getBackupHealth", () => {
  const nowMs = Date.parse("2026-09-30T12:00:00.000Z");
  const daysAgo = (days: number) => new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();

  it("reports no backup for empty or invalid dates", () => {
    expect(getBackupHealth("", nowMs).label).toBe("No backup recorded");
    expect(getBackupHealth("not-a-date", nowMs).label).toBe("No backup recorded");
  });

  it("reports Current up to and including 7 days", () => {
    expect(getBackupHealth(daysAgo(0), nowMs).label).toBe("Current");
    expect(getBackupHealth(daysAgo(7), nowMs).label).toBe("Current");
  });

  it("treats future-dated backups as Current", () => {
    expect(getBackupHealth(daysAgo(-3), nowMs).label).toBe("Current");
  });

  it("reports Getting stale after 7 days up to and including 30 days", () => {
    expect(getBackupHealth(new Date(Date.parse(daysAgo(7)) - 1).toISOString(), nowMs).label).toBe("Getting stale");
    expect(getBackupHealth(daysAgo(30), nowMs).label).toBe("Getting stale");
  });

  it("reports Stale after 30 days", () => {
    expect(getBackupHealth(new Date(Date.parse(daysAgo(30)) - 1).toISOString(), nowMs).label).toBe("Stale");
    expect(getBackupHealth(daysAgo(365), nowMs).label).toBe("Stale");
  });
});

class MemoryStorage implements BackupStorage {
  data = new Map<string, string>();
  writes: string[] = [];
  onSet?: (key: string, value: string) => string;
  onRemove?: (key: string) => void;

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.data.set(key, value);
  }

  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  setItem(key: string, value: string) {
    this.writes.push(`set:${key}`);
    this.data.set(key, this.onSet ? this.onSet(key, value) : value);
  }

  removeItem(key: string) {
    this.writes.push(`remove:${key}`);
    this.onRemove?.(key);
    this.data.delete(key);
  }

  snapshot() {
    return Object.fromEntries(this.data);
  }
}

const initialLiveData = {
  [STORAGE_KEY]: "[\"old-capture\"]",
  [CASH_POSITION_STORAGE_KEY]: "{\"currentCash\":\"50\"}",
  "unrelated-key": "untouched",
};

const restoreBackup: EmpireOsBackup = {
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  createdAt: "2026-01-01T12:00:00.000Z",
  storage: {
    [STORAGE_KEY]: "[\"new-capture\"]",
    [PROJECT_STORAGE_KEY]: "[\"new-project\"]",
    [PERSON_STORAGE_KEY]: null,
  },
};

describe("buildFullBackup", () => {
  it("uses the current format and version with a deterministic createdAt", () => {
    const backup = buildFullBackup(new MemoryStorage(), "2026-09-30T08:00:00.000Z");
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.createdAt).toBe("2026-09-30T08:00:00.000Z");
  });

  it("captures exactly the supported keys, with missing values as null", () => {
    const backup = buildFullBackup(new MemoryStorage(initialLiveData), "2026-09-30T08:00:00.000Z");
    expect(Object.keys(backup.storage)).toEqual([...EMPIRE_OS_BACKUP_STORAGE_KEYS]);
    expect(backup.storage[STORAGE_KEY]).toBe(initialLiveData[STORAGE_KEY]);
    expect(backup.storage[CASH_POSITION_STORAGE_KEY]).toBe(initialLiveData[CASH_POSITION_STORAGE_KEY]);
    expect(backup.storage[PROJECT_STORAGE_KEY]).toBeNull();
    expect(backup.storage).not.toHaveProperty("unrelated-key");
  });

  it("defaults createdAt to a valid ISO timestamp and passes validation", () => {
    const backup = buildFullBackup(new MemoryStorage(initialLiveData));
    expect(Number.isNaN(Date.parse(backup.createdAt))).toBe(false);
    expect(validateEmpireOsBackup(JSON.parse(JSON.stringify(backup)))).toEqual(backup);
  });
});

describe("runBackupRestoreTransaction", () => {
  it("rejects malformed Phase 4 records before safety callbacks or live storage writes", () => {
    const storage = new MemoryStorage(initialLiveData);
    let callbackCalled = false;
    const malformed: EmpireOsBackup = {
      ...restoreBackup,
      storage: {
        ...restoreBackup.storage,
        [FOUNDER_INTELLIGENCE_STORAGE_KEY]: JSON.stringify({
          pairRecords: [{ personIds: ["calum", "lewis"], observations: [{
            id: "missing-claim", dimension: "communication",
          }] }],
        }),
      },
    };
    const result = runBackupRestoreTransaction(storage, malformed, () => { callbackCalled = true; });
    expect(result).toMatchObject({ ok: false, writesStarted: false, rollbackFailures: [] });
    expect(callbackCalled).toBe(false);
    expect(storage.writes).toEqual([]);
    expect(storage.snapshot()).toEqual(initialLiveData);
  });

  it("writes backup values and removes keys that are null or missing in the backup", () => {
    const storage = new MemoryStorage({ ...initialLiveData, [PERSON_STORAGE_KEY]: "[\"old-person\"]" });
    const result = runBackupRestoreTransaction(storage, restoreBackup);

    expect(result).toEqual({ ok: true });
    expect(storage.snapshot()).toEqual({
      [STORAGE_KEY]: "[\"new-capture\"]",
      [PROJECT_STORAGE_KEY]: "[\"new-project\"]",
      "unrelated-key": "untouched",
    });
  });

  it("runs beforeWrites after the snapshot and before any live write", () => {
    const storage = new MemoryStorage(initialLiveData);
    let safetyBackup: EmpireOsBackup | null = null;
    runBackupRestoreTransaction(storage, restoreBackup, () => {
      expect(storage.writes).toEqual([]);
      safetyBackup = buildFullBackup(storage, "2026-09-30T08:00:00.000Z");
    });
    expect(safetyBackup).toEqual(buildFullBackup(new MemoryStorage(initialLiveData), "2026-09-30T08:00:00.000Z"));
  });

  it("changes no live data when beforeWrites fails", () => {
    const storage = new MemoryStorage(initialLiveData);
    const failure = new Error("download failed");
    const result = runBackupRestoreTransaction(storage, restoreBackup, () => {
      throw failure;
    });

    expect(result).toEqual({ ok: false, error: failure, writesStarted: false, rollbackFailures: [] });
    expect(storage.writes).toEqual([]);
    expect(storage.snapshot()).toEqual(initialLiveData);
  });

  it("rolls back previously-present and previously-absent keys when verification fails", () => {
    const storage = new MemoryStorage(initialLiveData);
    storage.onSet = (key, value) => (key === PROJECT_STORAGE_KEY ? "corrupted" : value);
    const result = runBackupRestoreTransaction(storage, restoreBackup);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.writesStarted).toBe(true);
    expect((result.error as Error).message).toBe(`Verification failed for: ${PROJECT_STORAGE_KEY}.`);
    expect(result.rollbackFailures).toEqual([]);
    expect(storage.snapshot()).toEqual(initialLiveData);
  });

  it("rolls back when a write throws", () => {
    const storage = new MemoryStorage(initialLiveData);
    storage.onSet = (key, value) => {
      if (key === PROJECT_STORAGE_KEY) throw new Error("QuotaExceededError");
      return value;
    };
    const result = runBackupRestoreTransaction(storage, restoreBackup);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.writesStarted).toBe(true);
    expect((result.error as Error).message).toBe("QuotaExceededError");
    expect(result.rollbackFailures).toEqual([]);
    expect(storage.snapshot()).toEqual(initialLiveData);
  });

  it("reports keys whose rollback could not be verified or threw", () => {
    const storage = new MemoryStorage(initialLiveData);
    storage.onSet = (key, value) => (key === STORAGE_KEY ? "corrupted" : value);
    storage.onRemove = (key) => {
      if (key === PROJECT_STORAGE_KEY && storage.getItem(key) === "[\"new-project\"]") {
        throw new Error("remove failed");
      }
    };
    const result = runBackupRestoreTransaction(storage, restoreBackup);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.writesStarted).toBe(true);
    expect((result.error as Error).message).toBe(`Verification failed for: ${STORAGE_KEY}.`);
    expect(result.rollbackFailures).toEqual([STORAGE_KEY, PROJECT_STORAGE_KEY]);
  });
});
