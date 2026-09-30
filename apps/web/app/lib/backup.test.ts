import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  CASH_POSITION_STORAGE_KEY,
  CHANGE_HISTORY_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
  STORAGE_KEY,
  getBackupHealth,
  validateEmpireOsBackup,
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
