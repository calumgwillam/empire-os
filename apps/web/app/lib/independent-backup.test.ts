import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { transpileModule, ScriptTarget, ModuleKind } from "typescript";
import { buildFullBackup, validateEmpireOsBackup, validateStandaloneBackup, runBackupRestoreTransaction, EMPIRE_OS_BACKUP_STORAGE_KEYS,
  STORAGE_KEY, CONVERSION_STORAGE_KEY, LEAD_STORAGE_KEY, INCOME_STORAGE_KEY, RECOVERY_SNAPSHOTS_STORAGE_KEY,
  type BackupStorage } from "./backup";
import { BACKUP_VERIFICATIONS_STORAGE_KEY, backupStorageContent, currentBackupStorageDigest, independentBackupHealth,
  readBackupVerifications, recordBackupVerification, sha256, verifyBackupFile, verifyBackupRecoveryDrill } from "./independent-backup";

const NOW = Date.parse("2026-10-09T19:00:00Z");
const digest = async (value: string) => createHash("sha256").update(value).digest("hex");
const request = { fileName: "saved-empire-backup.json", verifier: "Recorded reviewer",
  externalLocation: "Independent storage; access reviewed without the operating browser/device",
  independenceDeclared: true, nowMs: NOW };
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  const storage: BackupStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); data.set(key, value); },
    removeItem: (key) => { writes.push(key); data.delete(key); },
  };
  return { storage, data, writes };
}
function full(createdAt = new Date(NOW).toISOString()) {
  return buildFullBackup(memory({ [STORAGE_KEY]: '[{"id":"capture","rawNote":"Genuine recorded information"}]' }).storage, createdAt);
}
afterEach(() => vi.unstubAllGlobals());

describe("Independent saved-file assurance", () => {
  it("read-backs a complete file, records exact SHA-256 evidence and never mutates business or recovery stores", async () => {
    const backup = full();
    const text = JSON.stringify(backup, null, 2);
    const target = memory({ [STORAGE_KEY]: backup.storage[STORAGE_KEY]!, [RECOVERY_SNAPSHOTS_STORAGE_KEY]: "[]" });
    const before = Object.fromEntries(target.data);
    const verification = await verifyBackupFile(text, request, digest);
    expect(verification).toMatchObject({ fileName: request.fileName, verifier: request.verifier,
      fileSha256: await digest(text), storageSha256: await digest(backupStorageContent(backup.storage)),
      storeCount: EMPIRE_OS_BACKUP_STORAGE_KEYS.length, independenceDeclared: true });
    recordBackupVerification(target.storage, verification);
    expect(target.writes).toEqual([BACKUP_VERIFICATIONS_STORAGE_KEY]);
    for (const [key, value] of Object.entries(before)) expect(target.storage.getItem(key)).toBe(value);
    expect(readBackupVerifications(target.storage)).toEqual([verification]);
    expect(independentBackupHealth(readBackupVerifications(target.storage), await currentBackupStorageDigest(target.storage, digest), NOW))
      .toMatchObject({ label: "Verified file matches current stored data", warning: false });
    const recovery = memory();
    expect(runBackupRestoreTransaction(recovery.storage, validateStandaloneBackup(JSON.parse(text)))).toEqual({ ok: true });
    for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) expect(recovery.storage.getItem(key)).toBe(backup.storage[key]);
  });
  it("uses real browser SHA-256 rather than an invented file fingerprint", async () => {
    vi.stubGlobal("crypto", webcrypto);
    expect(await sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it.each(["verifier", "externalLocation", "fileName"] as const)("requires explicit %s attribution", async (field) => {
    await expect(verifyBackupFile(JSON.stringify(full()), { ...request, [field]: " " }, digest)).rejects.toThrow("Name the verifier");
  });
  it("does not infer independence from a file picker or a download request", async () => {
    await expect(verifyBackupFile(JSON.stringify(full()), { ...request, independenceDeclared: false }, digest))
      .rejects.toThrow("explicitly confirm");
    const target = memory({ "empire-os-last-backup-at": new Date(NOW).toISOString(), [RECOVERY_SNAPSHOTS_STORAGE_KEY]: "[]" });
    expect(independentBackupHealth(readBackupVerifications(target.storage), await currentBackupStorageDigest(target.storage, digest), NOW))
      .toEqual({ label: "No verified external backup file", warning: true });
  });
  it("accepts complete legacy files without a manifest but does not call partial legacy backups independently complete", async () => {
    const backup = full();
    delete backup.includedStorageKeys;
    await expect(verifyBackupFile(JSON.stringify(backup), request, digest)).resolves.toMatchObject({ storeCount: EMPIRE_OS_BACKUP_STORAGE_KEYS.length });
    delete backup.storage[LEAD_STORAGE_KEY];
    expect(() => validateEmpireOsBackup(backup)).not.toThrow();
    await expect(verifyBackupFile(JSON.stringify(backup), request, digest)).rejects.toThrow("missing business stores");
  });
  it.each(["corrupt JSON", "incomplete manifest", "broken reference", "duplicate identity"] as const)(
    "rejects %s without changing an existing verified copy", async (kind) => {
      const target = memory();
      const record = await verifyBackupFile(JSON.stringify(full()), request, digest);
      recordBackupVerification(target.storage, record);
      const prior = target.storage.getItem(BACKUP_VERIFICATIONS_STORAGE_KEY);
      const backup = full();
      if (kind === "incomplete manifest") delete backup.storage[INCOME_STORAGE_KEY];
      if (kind === "broken reference") backup.storage[CONVERSION_STORAGE_KEY] = JSON.stringify([
        { id: "delivery", targetType: "Convert to Action", deliveryLeadId: "absent-lead" },
      ]);
      if (kind === "duplicate identity") backup.storage[CONVERSION_STORAGE_KEY] = JSON.stringify([
        { id: "same", targetType: "Convert to Action" }, { id: "same", targetType: "Convert to Action" },
      ]);
      await expect(verifyBackupFile(kind === "corrupt JSON" ? "{invalid" : JSON.stringify(backup), request, digest)).rejects.toThrow();
      expect(target.storage.getItem(BACKUP_VERIFICATIONS_STORAGE_KEY)).toBe(prior);
    });
  it("keeps historical file verification but warns that later business changes are not covered", async () => {
    const backup = full();
    const target = memory({ [STORAGE_KEY]: backup.storage[STORAGE_KEY]! });
    const record = await verifyBackupFile(JSON.stringify(backup), request, digest);
    recordBackupVerification(target.storage, record);
    target.storage.setItem(STORAGE_KEY, '[{"id":"capture","rawNote":"Subsequent real change"}]');
    expect(independentBackupHealth([record], await currentBackupStorageDigest(target.storage, digest), NOW))
      .toMatchObject({ label: "Verified file exists; current data is not covered", warning: true, verification: record });
  });
  it("age is based on backed-up data creation, so rechecking an old file cannot make it current", async () => {
    for (const [days, label] of [[8, "Verified matching file is getting stale"], [31, "Verified matching file is stale"]] as const) {
      const backup = full(new Date(NOW - days * 86400000).toISOString());
      const record = await verifyBackupFile(JSON.stringify(backup), request, digest);
      expect(independentBackupHealth([record], record.storageSha256, NOW)).toMatchObject({ label, warning: true });
    }
  });
  it("selects evidence for the current snapshot rather than allowing a newer verification of a different file to mask it", async () => {
    const matching = await verifyBackupFile(JSON.stringify(full(new Date(NOW - 1000).toISOString())),
      { ...request, nowMs: NOW - 1000 }, digest);
    const other = full();
    other.storage[STORAGE_KEY] = '[{"id":"different"}]';
    const newer = await verifyBackupFile(JSON.stringify(other), request, digest);
    expect(independentBackupHealth([matching, newer], matching.storageSha256, NOW)).toMatchObject({ verification: matching, warning: false });
  });
  it("hashes exact file bytes while ordering store keys deterministically for coverage comparison", async () => {
    const backup = full();
    const reversed = { ...backup, storage: Object.fromEntries(Object.entries(backup.storage).reverse()) };
    const original = await verifyBackupFile(JSON.stringify(backup), request, digest);
    const reformatted = await verifyBackupFile(JSON.stringify(reversed, null, 2), request, digest);
    expect(original.fileSha256).not.toBe(reformatted.fileSha256);
    expect(original.storageSha256).toBe(reformatted.storageSha256);
    const changed = { ...backup, storage: { ...backup.storage, [STORAGE_KEY]: "[]" } };
    expect((await verifyBackupFile(JSON.stringify(changed), request, digest)).storageSha256).not.toBe(original.storageSha256);
  });
  it("cannot manufacture verification when crypto fails, clocks are invalid, or the backup is future-dated", async () => {
    await expect(verifyBackupFile(JSON.stringify(full()), request, async () => { throw new Error("Crypto unavailable"); })).rejects.toThrow("Crypto unavailable");
    await expect(verifyBackupFile(JSON.stringify(full()), request, async () => "invented")).rejects.toThrow("fingerprint");
    await expect(verifyBackupFile(JSON.stringify(full()), { ...request, nowMs: NaN }, digest)).rejects.toThrow("valid clock");
    await expect(verifyBackupFile(JSON.stringify(full(new Date(NOW + 86400000).toISOString())), request, digest)).rejects.toThrow("future");
  });
  it.each(["{corrupt", "{}", "[{}]"])("preserves unreadable verification history %s instead of silently substituting empty evidence", (raw) => {
    const target = memory({ [BACKUP_VERIFICATIONS_STORAGE_KEY]: raw });
    expect(() => readBackupVerifications(target.storage)).toThrow();
    expect(target.storage.getItem(BACKUP_VERIFICATIONS_STORAGE_KEY)).toBe(raw);
    expect(target.writes).toEqual([]);
  });
  it("rolls back failed verification persistence and never claims new durable evidence", async () => {
    const target = memory();
    const record = await verifyBackupFile(JSON.stringify(full()), request, digest);
    recordBackupVerification(target.storage, record);
    const before = target.storage.getItem(BACKUP_VERIFICATIONS_STORAGE_KEY);
    const next = await verifyBackupFile(JSON.stringify(full()), { ...request, nowMs: NOW + 1000 }, digest);
    const original = target.storage.setItem;
    let failed = false;
    target.storage.setItem = (key, value) => {
      if (!failed) { failed = true; original(key, "corrupt write"); return; }
      original(key, value);
    };
    expect(() => recordBackupVerification(target.storage, next)).toThrow("Previous storage restored");
    expect(target.storage.getItem(BACKUP_VERIFICATIONS_STORAGE_KEY)).toBe(before);
    expect(readBackupVerifications(target.storage)).toEqual([record]);
  });
  it("preserves malformed stored evidence when asked to record a new verification", async () => {
    const target = memory({ [BACKUP_VERIFICATIONS_STORAGE_KEY]: "[{}]" });
    const record = await verifyBackupFile(JSON.stringify(full()), request, digest);
    expect(() => recordBackupVerification(target.storage, record)).toThrow("malformed");
    expect(target.storage.getItem(BACKUP_VERIFICATIONS_STORAGE_KEY)).toBe("[{}]");
  });
  it("preserves valid older file evidence when verification dates or fingerprints are malformed", async () => {
    const record = await verifyBackupFile(JSON.stringify(full()), request, digest);
    for (const changed of [{ ...record, verifiedAt: "invalid" }, { ...record, verifiedAt: new Date(NOW - 1000).toISOString() },
      { ...record, fileSha256: "not-sha256" }, { ...record, independenceDeclared: false }, { ...record, storeCount: 1 }]) {
      const raw = JSON.stringify([changed]);
      const target = memory({ [BACKUP_VERIFICATIONS_STORAGE_KEY]: raw });
      expect(() => readBackupVerifications(target.storage)).toThrow("malformed");
      expect(target.storage.getItem(BACKUP_VERIFICATIONS_STORAGE_KEY)).toBe(raw);
      expect(target.writes).toEqual([]);
    }
  });
});

describe("Production saved-file verification and download semantics", () => {
  const component = readFileSync(new URL("../components/independent-backup-section.tsx", import.meta.url), "utf8");
  const start = component.indexOf("  const verify = async (drill = false) => {");
  const end = component.indexOf("  const field =", start);
  if (start < 0 || end < start) throw new Error("Saved-file verification handler could not be located.");
  function handler(text: () => Promise<string>, drill = false,
    drillOperation = (value: string, input: Parameters<typeof verifyBackupFile>[1]) =>
      verifyBackupRecoveryDrill(value, { ...input, nowMs: NOW }, digest, () => NOW)) {
    const target = memory({ [STORAGE_KEY]: full().storage[STORAGE_KEY]! });
    const results: string[] = [];
    const errors: string[] = [];
    const context = {
      file: { name: request.fileName, text }, disabled: false, busy: false, pending: undefined as Promise<void> | undefined,
      writable: { current: true }, mounted: { current: true }, verificationRun: { current: 0 },
      verifier: request.verifier, location: request.externalLocation, declared: true,
      window: { localStorage: target.storage }, Error,
      verifyBackupFile: (value: string, input: Parameters<typeof verifyBackupFile>[1]) =>
        verifyBackupFile(value, { ...input, nowMs: NOW }, digest),
      verifyBackupRecoveryDrill: drillOperation,
      recordBackupVerification, setBusy: () => {}, setError: (error: string) => { if (error) errors.push(error); },
      setResult: (result: string) => { if (result) results.push(result); }, refreshRef: { current: () => {} },
    };
    const production = transpileModule(`${component.slice(start, end)}pending = verify(${drill});`,
      { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText;
    runInNewContext(production, context, { timeout: 1000 });
    return { context, target, results, errors };
  }
  it("reports success only after read-back validation and verified evidence persistence", async () => {
    const live = handler(async () => JSON.stringify(full()));
    await live.context.pending;
    expect(live.errors).toEqual([]);
    expect(live.results[0]).toContain("No data was restored");
    expect(readBackupVerifications(live.target.storage)).toHaveLength(1);
    expect(live.target.writes).toEqual([BACKUP_VERIFICATIONS_STORAGE_KEY]);
  });
  it("reports storage failure instead of showing a success-shaped verification", async () => {
    const live = handler(async () => JSON.stringify(full()));
    live.target.storage.setItem = () => { throw new Error("Quota exceeded"); };
    await live.context.pending;
    expect(live.results).toEqual([]);
    expect(live.errors[0]).toContain("Quota exceeded");
    expect(readBackupVerifications(live.target.storage)).toEqual([]);
  });
  it("records simulated recovery separately without touching live business or recovery data", async () => {
    const live = handler(async () => JSON.stringify(full()), true);
    const before = Object.fromEntries(live.target.data);
    await live.context.pending;
    expect(live.errors).toEqual([]);
    expect(live.results[0]).toContain("Simulated restore passed");
    expect(readBackupVerifications(live.target.storage)[0].recoveryDrill)
      .toEqual({ completedAt: new Date(NOW).toISOString(), checkedStoreCount: EMPIRE_OS_BACKUP_STORAGE_KEYS.length });
    expect(live.target.writes).toEqual([BACKUP_VERIFICATIONS_STORAGE_KEY]);
    for (const [key, value] of Object.entries(before)) expect(live.target.storage.getItem(key)).toBe(value);
  });
  it("never shows drill success when receipt persistence fails", async () => {
    const live = handler(async () => JSON.stringify(full()), true);
    live.target.storage.setItem = () => { throw new Error("Quota exceeded"); };
    await live.context.pending;
    expect(live.results).toEqual([]);
    expect(live.errors[0]).toContain("Quota exceeded");
  });
  it("reports drill failure without overwriting previous file-verification evidence", async () => {
    let resolve!: (value: string) => void;
    const live = handler(() => new Promise<string>((done) => { resolve = done; }), true,
      async () => { throw new Error("Isolated recovery drill failed: read-back mismatch"); });
    const prior = await verifyBackupFile(JSON.stringify(full()), request, digest);
    recordBackupVerification(live.target.storage, prior);
    const before = live.target.storage.getItem(BACKUP_VERIFICATIONS_STORAGE_KEY);
    resolve(JSON.stringify(full()));
    await live.context.pending;
    expect(live.results).toEqual([]);
    expect(live.errors[0]).toContain("read-back mismatch");
    expect(live.target.storage.getItem(BACKUP_VERIFICATIONS_STORAGE_KEY)).toBe(before);
  });
  it("can drill an already-verified file at the same clock value without replacing its file-only receipt", async () => {
    let resolve!: (value: string) => void;
    const live = handler(() => new Promise<string>((done) => { resolve = done; }), true);
    const prior = await verifyBackupFile(JSON.stringify(full()), request, digest);
    recordBackupVerification(live.target.storage, prior);
    resolve(JSON.stringify(full()));
    await live.context.pending;
    expect(live.errors).toEqual([]);
    expect(live.results[0]).toContain("Simulated restore passed");
    const records = readBackupVerifications(live.target.storage);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(prior);
    expect(records[1].recoveryDrill).toBeDefined();
    expect(records[1].id).not.toBe(prior.id);
    expect(live.target.writes.every((key) => key === BACKUP_VERIFICATIONS_STORAGE_KEY)).toBe(true);
  });
  it("does not record an obsolete file selection or an unmounted verification", async () => {
    for (const [mode, drill] of [["selection", false], ["unmount", false], ["selection", true], ["unmount", true]] as const) {
      let resolve!: (value: string) => void;
      const live = handler(() => new Promise<string>((done) => { resolve = done; }), drill);
      if (mode === "selection") live.context.verificationRun.current++;
      else live.context.mounted.current = false;
      resolve(JSON.stringify(full()));
      await live.context.pending;
      expect(live.results).toEqual([]);
      expect(live.target.writes).toEqual([]);
    }
  });
  it("does not retain a green coverage claim if live data changes during its asynchronous fingerprint check", async () => {
    const start = component.indexOf("    const refresh = async () => {");
    const end = component.indexOf("    refreshRef.current =", start);
    if (start < 0 || end < start) throw new Error("Backup coverage check could not be located.");
    const target = memory({ [STORAGE_KEY]: full().storage[STORAGE_KEY]! });
    const record = await verifyBackupFile(JSON.stringify(full()), request, digest);
    recordBackupVerification(target.storage, record);
    let finish!: (value: string) => void;
    const statuses: Array<{ label: string; warning: boolean }> = [];
    const context = {
      active: true, healthRun: { current: 0 }, writable: { current: false },
      pending: undefined as Promise<void> | undefined, window: { localStorage: target.storage },
      readBackupVerifications, backupStorageContent, buildFullBackup, independentBackupHealth, Error,
      currentBackupStorageDigest: () => new Promise<string>((done) => { finish = done; }),
      setHealth: (value: { label: string; warning: boolean }) => { statuses.push(value); }, setCheckError: () => {},
    };
    runInNewContext(transpileModule(`${component.slice(start, end)}pending = refresh();`,
      { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText, context, { timeout: 1000 });
    target.storage.setItem(STORAGE_KEY, '[{"id":"new-record"}]');
    finish(record.storageSha256);
    await context.pending;
    expect(statuses.every((status) => status.warning)).toBe(true);
    expect(statuses.at(-1)?.label).toContain("Data changed");
  });
  it("keeps raw safety downloads available but requires complete standalone validation for a normal full export", () => {
    const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
    const start = page.indexOf("  function handleDownloadFullBackup()");
    const end = page.indexOf("  function handleRestoreFullBackup()", start);
    if (start < 0 || end < start) throw new Error("Full export handler could not be located.");
    let downloads = 0;
    let feedback = "";
    const backup = full();
    delete backup.storage[LEAD_STORAGE_KEY];
    const context = {
      createFullBackup: () => backup, validateStandaloneBackup, Error,
      downloadBackup: () => { downloads++; }, setFeedback: (value: { message: string }) => { feedback = value.message; },
    };
    runInNewContext(transpileModule(`${page.slice(start, end)}handleDownloadFullBackup();`,
      { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText, context, { timeout: 1000 });
    expect(downloads).toBe(0);
    expect(feedback).toContain("could not be created");
    expect(page).not.toContain("Backup health: {backupHealth.label}");
    expect(page).toContain("Last download request (not file verification)");
  });
  it("never converts a download click into file verification, including safety-copy downloads", () => {
    const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
    const start = page.indexOf("  function downloadBackup(");
    const end = page.indexOf("  function handleDownloadFullBackup()", start);
    if (start < 0 || end < start) throw new Error("Download handler could not be located.");
    const target = memory();
    let clicks = 0;
    const anchor = { href: "", download: "", click: () => { clicks++; }, remove: () => {} };
    const context = {
      window: { localStorage: target.storage }, Blob, URL: { createObjectURL: () => "blob:download", revokeObjectURL: () => {} },
      document: { createElement: () => anchor, body: { appendChild: () => {} } },
      LAST_BACKUP_AT_STORAGE_KEY: "empire-os-last-backup-at", setLastBackupAt: () => {}, backup: full(),
    };
    runInNewContext(transpileModule(`${page.slice(start, end)}downloadBackup(backup, "empire-os-pre-restore-safety-backup");`,
      { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText, context, { timeout: 1000 });
    expect(clicks).toBe(1);
    expect(target.writes).toEqual(["empire-os-last-backup-at"]);
    expect(readBackupVerifications(target.storage)).toEqual([]);
    expect(independentBackupHealth([], "0".repeat(64), NOW).warning).toBe(true);
  });
  it("allows explicitly unverified raw export of damaged data without altering any verification evidence", () => {
    const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
    const start = page.indexOf("  function handleDownloadRawRecoveryCopy()");
    const end = page.indexOf("  function handleRestoreFullBackup()", start);
    if (start < 0 || end < start) throw new Error("Raw recovery export handler could not be located.");
    const backup = full();
    backup.storage[STORAGE_KEY] = "{damaged-genuine-data";
    let downloaded = "";
    let feedback = "";
    const context = { createFullBackup: () => backup, Error,
      downloadBackup: (value: ReturnType<typeof full>) => { downloaded = value.storage[STORAGE_KEY]!; },
      setFeedback: (value: { message: string }) => { feedback = value.message; } };
    runInNewContext(transpileModule(`${page.slice(start, end)}handleDownloadRawRecoveryCopy();`,
      { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText, context, { timeout: 1000 });
    expect(downloaded).toBe("{damaged-genuine-data");
    expect(feedback).toContain("does not establish recovery readiness");
  });
});
