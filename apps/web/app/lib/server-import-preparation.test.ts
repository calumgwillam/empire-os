import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERSION_STORAGE_KEY, DEFAULT_SAVED_VIEW_STORAGE_KEY, EMPIRE_OS_BACKUP_STORAGE_KEYS, STORAGE_KEY } from "./backup";
import { backupStorageContent, sha256 } from "./independent-backup";
import {
  decodeRawStoreValue, encodeRawStoreValue, prepareServerImport, stageImportContent, validateStageImportRequest, verifyServerImportPlan,
} from "./server-import-preparation";
import type { ImportPlan } from "./server-persistence-contract";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function source() {
  const values = new Map<string, string>([[STORAGE_KEY, ' [ {"id":"source","unknown":"\\u0061"} ] ']]);
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn(() => { throw new Error("Forbidden live write."); }),
    removeItem: vi.fn(() => { throw new Error("Forbidden live removal."); }),
  };
  return { values, storage };
}
async function plan(): Promise<ImportPlan> {
  const result = await prepareServerImport(source().storage);
  if (result.status !== "prepared") throw new Error(JSON.stringify(result));
  return result.plan;
}

describe("Server import preparation unit tests (no database)", () => {
  it("captures every raw value, unknown field and absence without writing the source", async () => {
    const { values, storage } = source();
    const before = [...values];
    const result = await prepareServerImport(storage);
    expect(result.status).toBe("prepared");
    if (result.status !== "prepared") throw new Error(JSON.stringify(result));
    expect(result.plan.entries).toEqual(EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => ({ key, rawValue: values.get(key) ?? null })));
    expect(result.plan.sourceSha256).toBe(await sha256(backupStorageContent(Object.fromEntries(
      result.plan.entries.map(({ key, rawValue }) => [key, rawValue]),
    ))));
    expect(Object.isFrozen(result.plan)).toBe(true);
    expect(Object.isFrozen(result.plan.entries)).toBe(true);
    expect(Object.isFrozen(result.plan.entries[0])).toBe(true);
    expect([...values]).toEqual(before);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it("prepares an empty complete source as 21 nulls, not missing keys", async () => {
    const result = await prepareServerImport({ getItem: () => null });
    if (result.status !== "prepared") throw new Error(JSON.stringify(result));
    expect(result.plan.entries).toHaveLength(21);
    expect(result.plan.entries.every((entry) => entry.rawValue === null)).toBe(true);
  });
  it("repeated preparation and independent verification yield the same immutable content", async () => {
    const first = await plan();
    const second = await plan();
    expect(second).toEqual(first);
    const verified = await verifyServerImportPlan(first);
    expect(verified).toEqual({ status: "prepared", plan: first });
  });
  it.each(["not-json", "[null]", "{}"])("rejects malformed source without rewriting it: %s", async (raw) => {
    const { values, storage } = source();
    values.set(STORAGE_KEY, raw);
    expect((await prepareServerImport(storage)).status).toBe("source-invalid");
    expect(values.get(STORAGE_KEY)).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it("rejects broken cross-store references rather than treating valid JSON as sufficient", async () => {
    const { values, storage } = source();
    values.set(CONVERSION_STORAGE_KEY, '[{"id":"action","targetType":"Convert to Action","deliveryLeadId":"missing"}]');
    expect((await prepareServerImport(storage)).status).toBe("source-invalid");
  });
  it("reports source access failure explicitly", async () => {
    expect(await prepareServerImport({ getItem: () => { throw new Error("Source inaccessible."); } }))
      .toMatchObject({ status: "source-invalid", message: "Source inaccessible." });
  });
  it("fails explicitly when hashing is unavailable; a retry remains non-destructive", async () => {
    const { storage } = source();
    vi.stubGlobal("crypto", undefined);
    expect((await prepareServerImport(storage)).status).toBe("failed");
    vi.stubGlobal("crypto", webcrypto);
    expect((await prepareServerImport(storage)).status).toBe("prepared");
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it("detects source changes while hashing is pending and permits a fresh preparation", async () => {
    const { values, storage } = source();
    const pending = prepareServerImport(storage);
    values.set(STORAGE_KEY, '[{"id":"new-source"}]');
    expect((await pending).status).toBe("source-changed");
    expect((await prepareServerImport(storage)).status).toBe("prepared");
  });
  it("rejects incomplete, duplicate and unregistered submitted entries", async () => {
    const original = await plan();
    const duplicate = [...original.entries];
    duplicate[1] = duplicate[0];
    for (const entries of [
      original.entries.slice(1), duplicate,
      original.entries.map((entry, index) => index === 0 ? { ...entry, key: "internal-authority" } : entry),
    ]) {
      expect((await verifyServerImportPlan({ ...original, entries })).status).toBe("source-invalid");
    }
  });
  it("rejects forged fingerprints and changes to exact raw formatting", async () => {
    const original = await plan();
    expect((await verifyServerImportPlan({ ...original, sourceSha256: "0".repeat(64) })).status).toBe("source-invalid");
    expect((await verifyServerImportPlan({ ...original, entries: original.entries.map((entry) =>
      entry.key === STORAGE_KEY ? { ...entry, rawValue: entry.rawValue?.trim() } : entry) })).status).toBe("source-invalid");
  });
  it("copies submitted entries before awaiting verification", async () => {
    const original = await plan();
    const entries = original.entries.map((entry) => ({ ...entry }));
    const pending = verifyServerImportPlan({ ...original, entries });
    entries[0].rawValue = "caller mutation";
    expect(await pending).toEqual({ status: "prepared", plan: original });
  });
  it("does not accept client authorization fields in an import plan", async () => {
    expect((await verifyServerImportPlan({ ...await plan(), authorized: true })).status).toBe("source-invalid");
  });
  it("validates submitted relationships independently of a well-formed fingerprint", async () => {
    const original = await plan();
    const entries = original.entries.map((entry) => entry.key === CONVERSION_STORAGE_KEY
      ? { ...entry, rawValue: '[{"id":"a","targetType":"Convert to Action","deliveryLeadId":"missing"}]' } : entry);
    const sourceSha256 = await sha256(backupStorageContent(Object.fromEntries(entries.map(({ key, rawValue }) => [key, rawValue]))));
    expect((await verifyServerImportPlan({ ...original, entries, sourceSha256 })).status).toBe("source-invalid");
  });
  it("preserves raw default-view strings containing NUL and lone surrogates through preparation", async () => {
    const { storage, values } = source();
    const raw = "view\u0000\ud800";
    values.set(DEFAULT_SAVED_VIEW_STORAGE_KEY, raw);
    const result = await prepareServerImport(storage);
    if (result.status !== "prepared") throw new Error(JSON.stringify(result));
    expect(result.plan.entries.find((entry) => entry.key === DEFAULT_SAVED_VIEW_STORAGE_KEY)?.rawValue).toBe(raw);
    expect((await verifyServerImportPlan(result.plan)).status).toBe("prepared");
  });
  it("validates and freezes an import envelope but does not stage or activate a database", async () => {
    const request = {
      fence: { datasetId: "00000000-0000-4000-8000-000000000001", protocolVersion: 1, generation: 1, authorityRevision: 0 },
      idempotencyKey: "import:one", plan: await plan(),
    };
    const result = await validateStageImportRequest(request);
    if (result.status !== "valid") throw new Error(JSON.stringify(result));
    expect(result.value).toEqual(request);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.plan)).toBe(true);
    expect((await validateStageImportRequest({ ...request, principalId: "owner" })).status).toBe("invalid-request");
    expect((await validateStageImportRequest({ ...request, fence: { ...request.fence, protocolVersion: 2 } })).status).toBe("unsupported-protocol");
  });
  it("binds import retries to the dataset, fence, key and complete source fingerprint", async () => {
    const result = await validateStageImportRequest({
      fence: { datasetId: "00000000-0000-4000-8000-000000000001", protocolVersion: 1, generation: 1, authorityRevision: 0 },
      idempotencyKey: "import:one", plan: await plan(),
    });
    if (result.status !== "valid") throw new Error(JSON.stringify(result));
    const first = stageImportContent(result.value);
    expect(stageImportContent({ ...result.value, idempotencyKey: "import:two" })).not.toBe(first);
    expect(stageImportContent({ ...result.value, fence: { ...result.value.fence, generation: 2 } })).not.toBe(first);
    expect(first).not.toContain("empire-os-write");
  });
});

describe("Lossless raw bytea codec unit tests (no PostgreSQL)", () => {
  it.each([null, "", "ascii", "line\r\nend", "\u0000", "\ud800", "\udfff", "\ud83d\ude00", "e\u0301", "\u00e9"])(
    "round-trips exact JavaScript code units: %j", (raw) => {
      expect(decodeRawStoreValue(encodeRawStoreValue(raw))).toBe(raw);
    },
  );
  it("distinguishes absence, empty content and UTF-16 little-endian bytes", () => {
    expect(encodeRawStoreValue(null)).toBeNull();
    expect(encodeRawStoreValue("")).toEqual(new Uint8Array(0));
    expect(encodeRawStoreValue("\u1234")).toEqual(new Uint8Array([0x34, 0x12]));
  });
  it("rejects corrupt odd-byte values instead of truncating data", () => {
    expect(() => decodeRawStoreValue(new Uint8Array([1]))).toThrow("incomplete UTF-16");
  });
  it("round-trips large strings without exceeding function argument limits", () => {
    const raw = "\ud800\u0000abc".repeat(30000);
    expect(decodeRawStoreValue(encodeRawStoreValue(raw))).toBe(raw);
  });
});
