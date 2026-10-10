import { EMPIRE_OS_BACKUP_STORAGE_KEYS, type BackupStorage } from "./backup";
import { readStartupStorage } from "./startup-hydration";
import {
  checkWriterAuthority, decodeWriterAuthority, isFence, PREPARATION_DATABASE_PREFIX, WRITER_AUTHORITY_KEY,
  type WriterAuthority, type WriterAuthorityResult, type WriterCredential, type WriterDenied,
} from "./writer-fencing";
import type { MigrationFence } from "./migration-coordinator";

export type BusinessStorageKey = typeof EMPIRE_OS_BACKUP_STORAGE_KEYS[number];

const DATABASE_VERSION = 1;
const BUSINESS_STORE_NAME = "business-data";

export type RawStoredValue = {
  key: BusinessStorageKey;
  rawValue: string | null;
  revision: number;
};

export type StorageReadResult =
  | { status: "read"; values: readonly RawStoredValue[] }
  | PersistenceFailure;

export type StorageWrite = {
  key: BusinessStorageKey;
  rawValue: string | null;
  expectedRevision: number;
};

export type RevisionConflict = {
  key: BusinessStorageKey;
  expectedRevision: number;
  actualRevision: number;
};

export type PersistenceFailure =
  | { status: "quota-exceeded"; error: PersistenceErrorDetails }
  | { status: "unavailable"; error: PersistenceErrorDetails }
  | { status: "transaction-failed"; error: PersistenceErrorDetails };

export type PersistenceErrorDetails = {
  name: string;
  message: string;
};

export type StorageWriteResult =
  | { status: "committed"; revisions: Readonly<Partial<Record<BusinessStorageKey, number>>> }
  | { status: "conflict"; conflicts: readonly RevisionConflict[] }
  | PersistenceFailure;

export type FencedWriteResult = StorageWriteResult | WriterDenied;

export interface RawStringPersistenceRepository {
  read(keys: readonly BusinessStorageKey[]): Promise<StorageReadResult>;
  write(updates: readonly StorageWrite[]): Promise<StorageWriteResult>;
}

export type LegacyImportPlan = {
  readonly entries: readonly {
    readonly key: BusinessStorageKey;
    readonly rawValue: string | null;
  }[];
};

export type LegacyImportResult =
  | { status: "imported"; revisions: Readonly<Partial<Record<BusinessStorageKey, number>>> }
  | { status: "already-imported"; revisions: Readonly<Partial<Record<BusinessStorageKey, number>>> }
  | { status: "source-changed"; keys: readonly BusinessStorageKey[] }
  | { status: "source-invalid"; error: PersistenceErrorDetails }
  | { status: "conflict"; conflicts: readonly RevisionConflict[] }
  | PersistenceFailure;

type ImportSource = { plan: LegacyImportPlan; storage: Pick<BackupStorage, "getItem"> };

class StorageAccessError extends Error {
  constructor(message: string, name = "UnavailableStorageError") {
    super(message);
    this.name = name;
  }
}

function browserIndexedDbFactory(): Pick<IDBFactory, "open"> | undefined {
  try {
    return globalThis.indexedDB;
  } catch {
    return undefined;
  }
}

function errorDetails(error: unknown): PersistenceErrorDetails {
  if (error instanceof Error) return { name: error.name, message: error.message };
  if (error && typeof error === "object") {
    const value = error as { name?: unknown; message?: unknown };
    return {
      name: typeof value.name === "string" ? value.name : "UnknownError",
      message: typeof value.message === "string" ? value.message : String(error),
    };
  }
  return { name: "UnknownError", message: String(error) };
}

function classifyFailure(error: unknown): PersistenceFailure {
  const details = errorDetails(error);
  if (details.name === "QuotaExceededError") return { status: "quota-exceeded", error: details };
  if (["UnavailableStorageError", "BlockedError", "SecurityError", "InvalidStateError", "NotSupportedError"].includes(details.name)) {
    return { status: "unavailable", error: details };
  }
  return { status: "transaction-failed", error: details };
}

function validateUniqueKeys(keys: readonly BusinessStorageKey[]): void {
  if (keys.some((key) => !(EMPIRE_OS_BACKUP_STORAGE_KEYS as readonly string[]).includes(key))) {
    throw new Error("A persistence operation contains an unregistered business storage key.");
  }
  if (new Set(keys).size !== keys.length) throw new Error("A persistence operation cannot contain duplicate storage keys.");
}

function validRevision(revision: number): boolean {
  return Number.isSafeInteger(revision) && revision >= 0;
}

function isStoredValue(value: unknown): value is RawStoredValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<RawStoredValue>;
  return typeof record.key === "string" && (EMPIRE_OS_BACKUP_STORAGE_KEYS as readonly string[]).includes(record.key)
    && (record.rawValue === null || typeof record.rawValue === "string")
    && Number.isSafeInteger(record.revision) && (record.revision as number) > 0;
}

function toValue(key: BusinessStorageKey, value: unknown): RawStoredValue {
  if (value === undefined) return { key, rawValue: null, revision: 0 };
  if (!isStoredValue(value) || value.key !== key) throw new Error(`IndexedDB contains an invalid value for ${key}.`);
  return value;
}

function validateImportPlan(plan: LegacyImportPlan): void {
  if (!plan || !Array.isArray(plan.entries) || plan.entries.length !== EMPIRE_OS_BACKUP_STORAGE_KEYS.length) {
    throw new Error("Legacy import plan must contain every registered business store exactly once.");
  }
  const keys = new Set<string>();
  for (const entry of plan.entries) {
    if (!entry || !(EMPIRE_OS_BACKUP_STORAGE_KEYS as readonly string[]).includes(entry.key)
      || keys.has(entry.key) || (entry.rawValue !== null && typeof entry.rawValue !== "string")) {
      throw new Error("Legacy import plan contains an unsupported, duplicate, or malformed storage value.");
    }
    keys.add(entry.key);
  }
}

export function prepareLegacyImport(source: Pick<BackupStorage, "getItem">): LegacyImportPlan {
  const storage = readStartupStorage(source);
  const entries = EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => Object.freeze({
    key,
    rawValue: storage[key],
  }));
  return Object.freeze({ entries: Object.freeze(entries) });
}

export class IndexedDbPersistenceRepository implements RawStringPersistenceRepository {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: Pick<IDBFactory, "open"> | undefined = browserIndexedDbFactory(),
    private readonly databaseName = "empire-os-persistence",
  ) {}

  async read(keys: readonly BusinessStorageKey[]): Promise<StorageReadResult> {
    validateUniqueKeys(keys);
    let database: IDBDatabase;
    try {
      database = await this.openDatabase();
    } catch (error) {
      return classifyFailure(error);
    }

    return new Promise<StorageReadResult>((resolve) => {
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(BUSINESS_STORE_NAME, "readonly");
      } catch (error) {
        resolve(classifyFailure(error));
        return;
      }

      let store: IDBObjectStore;
      try {
        store = transaction.objectStore(BUSINESS_STORE_NAME);
      } catch (error) {
        resolve(classifyFailure(error));
        return;
      }
      const values = new Map<BusinessStorageKey, RawStoredValue>();
      let requestError: unknown;
      let settled = false;
      const failRequest = (request: IDBRequest) => {
        requestError = request.error || new Error("IndexedDB read request failed.");
        try { transaction.abort(); } catch { /* The transaction may already be aborting. */ }
      };

      try {
        for (const key of keys) {
          const request = store.get(key);
          request.onsuccess = () => {
            try {
              values.set(key, toValue(key, request.result));
            } catch (error) {
              requestError = error;
              try { transaction.abort(); } catch { /* The transaction may already be aborting. */ }
            }
          };
          request.onerror = () => failRequest(request);
        }
      } catch (error) {
        requestError = error;
        try { transaction.abort(); } catch { /* The transaction may already be aborting. */ }
      }

      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        if (values.size !== keys.length) {
          resolve({ status: "transaction-failed", error: {
            name: "VerificationError", message: "IndexedDB read transaction completed without returning every requested key.",
          } });
          return;
        }
        resolve({ status: "read", values: keys.map((key) => values.get(key)!) });
      };
      transaction.onabort = () => {
        if (settled) return;
        settled = true;
        resolve(classifyFailure(requestError || transaction.error || new Error("IndexedDB read transaction aborted.")));
      };
      transaction.onerror = () => {
        requestError ||= transaction.error || new Error("IndexedDB read transaction failed.");
      };
    });
  }

  async write(updates: readonly StorageWrite[]): Promise<StorageWriteResult> {
    if (this.databaseName.startsWith(PREPARATION_DATABASE_PREFIX)) {
      throw new Error("This preparation database requires fenced writes; unguarded writes are forbidden.");
    }
    this.validateUpdates(updates);
    return this.transactWrite(updates, "write");
  }

  async writeWithAuthority(updates: readonly StorageWrite[], credential: WriterCredential): Promise<FencedWriteResult> {
    this.validateUpdates(updates);
    if (!this.databaseName.startsWith(PREPARATION_DATABASE_PREFIX)) {
      return { status: "authority-denied", reason: "unsupported-storage-mode",
        message: "Fenced writes are restricted to isolated preparation databases." };
    }
    if (!isFence(credential) || credential.mode !== "preparation-only" || credential.scope !== this.databaseName) {
      return { status: "authority-denied", reason: "unsupported-storage-mode", message: "Unsupported writer credentials." };
    }
    return this.transactWrite(updates.map((update) => ({ ...update })), "write", { ...credential });
  }

  private validateUpdates(updates: readonly StorageWrite[]): void {
    if (!updates.length) throw new Error("A persistence write must update at least one registered storage key.");
    validateUniqueKeys(updates.map(({ key }) => key));
    if (updates.some(({ expectedRevision }) => !validRevision(expectedRevision))) {
      throw new Error("Expected revisions must be non-negative safe integers.");
    }
    if (updates.some(({ expectedRevision }) => expectedRevision === Number.MAX_SAFE_INTEGER)) {
      throw new Error("Expected revision is at its maximum safe integer and cannot be incremented.");
    }
    if (updates.some(({ rawValue }) => rawValue !== null && typeof rawValue !== "string")) {
      throw new Error("Persisted business values must be exact strings or null.");
    }
  }

  async updatePreparationAuthority(
    expected: MigrationFence,
    mode: WriterAuthority["mode"],
  ): Promise<WriterAuthorityResult> {
    if (!this.databaseName.startsWith(PREPARATION_DATABASE_PREFIX) || (mode !== "denied" && mode !== "preparation-only")) {
      return { status: "authority-denied", reason: "unsupported-storage-mode",
        message: "Only preparation-only authority or revocation is supported; production activation is disabled." };
    }
    if (!isFence(expected)) throw new Error("Writer authority requires a valid expected fence.");
    const fence = { ...expected };
    let database: IDBDatabase;
    try {
      database = await this.openDatabase();
    } catch (error) {
      return { status: "authority-storage-failed", error: errorDetails(error) };
    }
    return new Promise<WriterAuthorityResult>((resolve) => {
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(BUSINESS_STORE_NAME, "readwrite");
      } catch (error) {
        resolve({ status: "authority-storage-failed", error: errorDetails(error) });
        return;
      }
      let result: WriterAuthorityResult | null = null;
      let failure: unknown;
      const abort = (error: unknown) => {
        failure = error;
        try { transaction.abort(); } catch (abortError) { failure = abortError; }
      };
      transaction.onabort = () => resolve({
        status: "authority-storage-failed", error: errorDetails(failure || transaction.error || new Error("Authority update aborted.")),
      });
      transaction.onerror = () => { failure ||= transaction.error; };
      transaction.oncomplete = () => resolve(failure || !result
        ? { status: "authority-storage-failed", error: errorDetails(failure || new Error("Authority verification incomplete.")) }
        : result);
      try {
        const store = transaction.objectStore(BUSINESS_STORE_NAME);
        const read = store.get(WRITER_AUTHORITY_KEY);
        read.onerror = () => abort(read.error || new Error("Writer authority read failed."));
        read.onsuccess = () => {
          try {
            const current = decodeWriterAuthority(read.result);
            if (current && current.scope !== this.databaseName) throw new Error("Writer authority belongs to a different database scope.");
            if ((current?.generation ?? 0) !== fence.generation || (current?.revision ?? 0) !== fence.revision) {
              result = { status: "authority-denied", reason: "stale-credential", message: "Authority update fence is stale." };
              return;
            }
            if (fence.generation === Number.MAX_SAFE_INTEGER || fence.revision === Number.MAX_SAFE_INTEGER) {
              throw new Error("Writer authority fence capacity is exhausted.");
            }
            const authority: WriterAuthority = {
              version: 1, generation: fence.generation + 1, revision: fence.revision + 1, scope: this.databaseName, mode,
            };
            const write = store.put({ ...authority, key: WRITER_AUTHORITY_KEY });
            write.onerror = () => abort(write.error || new Error("Writer authority write failed."));
            write.onsuccess = () => {
              try {
                const verify = store.get(WRITER_AUTHORITY_KEY);
                verify.onerror = () => abort(verify.error || new Error("Writer authority verification failed."));
                verify.onsuccess = () => {
                  try {
                    if (JSON.stringify(decodeWriterAuthority(verify.result)) !== JSON.stringify(authority)) {
                      throw new Error("Writer authority read-back failed.");
                    }
                    result = { status: "authority-saved", authority };
                  } catch (error) { abort(error); }
                };
              } catch (error) { abort(error); }
            };
          } catch (error) { abort(error); }
        };
      } catch (error) { abort(error); }
    });
  }

  async importLegacyDataset(
    plan: LegacyImportPlan,
    source: Pick<BackupStorage, "getItem">,
  ): Promise<LegacyImportResult> {
    if (this.databaseName.startsWith(PREPARATION_DATABASE_PREFIX)) {
      throw new Error("Unguarded legacy imports are forbidden in participating-writer preparation databases.");
    }
    validateImportPlan(plan);
    let currentLegacyValues: Record<string, string | null>;
    try {
      currentLegacyValues = readStartupStorage(source);
    } catch (error) {
      return { status: "source-invalid", error: errorDetails(error) };
    }
    const changedKeys = plan.entries
      .filter(({ key, rawValue }) => currentLegacyValues[key] !== rawValue)
      .map(({ key }) => key);
    if (changedKeys.length) return { status: "source-changed", keys: changedKeys };

    const updates = plan.entries.map(({ key, rawValue }) => ({
      key, rawValue, expectedRevision: 0,
    }));
    return this.transactWrite(updates, "import", { plan, storage: source });
  }

  private transactWrite(
    updates: readonly StorageWrite[],
    operation: "write",
  ): Promise<StorageWriteResult>;
  private transactWrite(
    updates: readonly StorageWrite[],
    operation: "write",
    credential: WriterCredential,
  ): Promise<FencedWriteResult>;
  private transactWrite(
    updates: readonly StorageWrite[],
    operation: "import",
    importSource: ImportSource,
  ): Promise<LegacyImportResult>;
  private async transactWrite(
    updates: readonly StorageWrite[],
    operation: "write" | "import",
    context?: ImportSource | WriterCredential,
  ): Promise<StorageWriteResult | LegacyImportResult | WriterDenied> {
    const importSource = context && "plan" in context ? context : undefined;
    const credential = context && "mode" in context ? context : undefined;
    let database: IDBDatabase;
    try {
      database = await this.openDatabase();
    } catch (error) {
      return classifyFailure(error);
    }

    return new Promise<StorageWriteResult | LegacyImportResult | WriterDenied>((resolve) => {
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(BUSINESS_STORE_NAME, "readwrite");
      } catch (error) {
        resolve(classifyFailure(error));
        return;
      }

      let store: IDBObjectStore;
      try {
        store = transaction.objectStore(BUSINESS_STORE_NAME);
      } catch (error) {
        resolve(classifyFailure(error));
        return;
      }
      const current = new Map<BusinessStorageKey, RawStoredValue>();
      let readCount = 0;
      let writeCount = 0;
      let verifyCount = 0;
      let requestError: unknown;
      let intentionalConflicts: readonly RevisionConflict[] | null = null;
      let changedSourceKeys: readonly BusinessStorageKey[] | null = null;
      let invalidSourceError: PersistenceErrorDetails | null = null;
      let preparedResult: StorageWriteResult | LegacyImportResult | null = null;
      let denied: WriterDenied | null = null;
      let settled = false;

      const abort = (error: unknown) => {
        requestError = error;
        try { transaction.abort(); } catch { /* The transaction may already be aborting. */ }
      };

      const verifyCommittedValues = (expected: readonly RawStoredValue[]) => {
        if (!expected.length) {
          abort(new Error("Persistence verification requires at least one storage value."));
          return;
        }
        for (const expectedValue of expected) {
          try {
            const request = store.get(expectedValue.key);
            request.onsuccess = () => {
              try {
                const actual = toValue(expectedValue.key, request.result);
                if (actual.rawValue !== expectedValue.rawValue || actual.revision !== expectedValue.revision) {
                  throw new Error(`IndexedDB verification failed for ${expectedValue.key}.`);
                }
                verifyCount++;
                if (verifyCount === expected.length && !preparedResult) {
                  if (operation === "import") {
                    preparedResult = { status: "imported", revisions: Object.fromEntries(expected.map(({ key, revision }) => [key, revision])) };
                  } else {
                    preparedResult = { status: "committed", revisions: Object.fromEntries(expected.map(({ key, revision }) => [key, revision])) };
                  }
                }
              } catch (error) {
                abort(error);
              }
            };
            request.onerror = () => abort(request.error || new Error(`IndexedDB verification read failed for ${expectedValue.key}.`));
          } catch (error) {
            abort(error);
            return;
          }
        }
      };

      const onAllReads = () => {
        const values = updates.map(({ key }) => current.get(key)!);
        if (operation === "import") {
          if (!importSource) {
            abort(new Error("Legacy import source is unavailable for verification."));
            return;
          }
          let sourceValues: Record<string, string | null>;
          try {
            sourceValues = readStartupStorage(importSource.storage);
          } catch (error) {
            invalidSourceError = errorDetails(error);
            try { transaction.abort(); } catch { /* The transaction may already be aborting. */ }
            return;
          }
          const changedKeys = importSource.plan.entries
            .filter(({ key, rawValue }) => sourceValues[key] !== rawValue)
            .map(({ key }) => key);
          if (changedKeys.length) {
            changedSourceKeys = changedKeys;
            try { transaction.abort(); } catch { /* The transaction may already be aborting. */ }
            return;
          }

          // localStorage cannot join this IndexedDB transaction; another tab can still change it before commit.
          const alreadyImported = values.every((value, index) =>
            value.revision > 0 && value.rawValue === updates[index].rawValue);
          if (alreadyImported) {
            let verifiedCount = 0;
            for (const expectedValue of values) {
              try {
                const request = store.get(expectedValue.key);
                request.onsuccess = () => {
                  try {
                    const actual = toValue(expectedValue.key, request.result);
                    if (actual.rawValue !== expectedValue.rawValue || actual.revision !== expectedValue.revision) {
                      throw new Error(`IndexedDB import verification failed for ${expectedValue.key}.`);
                    }
                    verifiedCount++;
                    if (verifiedCount === values.length) {
                      preparedResult = {
                        status: "already-imported",
                        revisions: Object.fromEntries(values.map(({ key, revision }) => [key, revision])),
                      };
                    }
                  } catch (error) {
                    abort(error);
                  }
                };
                request.onerror = () => abort(request.error || new Error(`IndexedDB import verification failed for ${expectedValue.key}.`));
              } catch (error) {
                abort(error);
                return;
              }
            }
            return;
          }
        }

        const conflicts = updates.flatMap(({ key, expectedRevision }) => {
          const actualRevision = current.get(key)!.revision;
          return actualRevision === expectedRevision ? [] : [{ key, expectedRevision, actualRevision }];
        });
        if (conflicts.length) {
          intentionalConflicts = conflicts;
          try { transaction.abort(); } catch { /* The transaction may already be aborting. */ }
          return;
        }

        const nextValues = updates.map(({ key, rawValue, expectedRevision }) => ({
          key, rawValue, revision: expectedRevision + 1,
        }));
        if (!nextValues.length) {
          abort(new Error("Persistence transaction requires at least one storage update."));
          return;
        }

        for (const value of nextValues) {
          try {
            const request = store.put(value);
            request.onsuccess = () => {
              writeCount++;
              if (writeCount === nextValues.length) verifyCommittedValues(nextValues);
            };
            request.onerror = () => abort(request.error || new Error(`IndexedDB write failed for ${value.key}.`));
          } catch (error) {
            abort(error);
            return;
          }
        }
      };

      const queueReads = () => {
        try {
          for (const { key } of updates) {
            const request = store.get(key);
            request.onsuccess = () => {
              try {
                current.set(key, toValue(key, request.result));
                readCount++;
                if (readCount === updates.length) onAllReads();
              } catch (error) {
                abort(error);
              }
            };
            request.onerror = () => abort(request.error || new Error(`IndexedDB read failed for ${key}.`));
          }
        } catch (error) {
          abort(error);
        }
      };
      if (credential) {
        try {
          const authorityRead = store.get(WRITER_AUTHORITY_KEY);
          authorityRead.onerror = () => {
            denied = { status: "authority-denied", reason: "authority-verification-failed",
              message: "Writer authority read failed; no business changes were authorized." };
            abort(authorityRead.error);
          };
          authorityRead.onsuccess = () => {
            denied = checkWriterAuthority(authorityRead.result, credential);
            if (denied) abort(new Error(denied.message));
            else queueReads();
          };
        } catch (error) {
          denied = { status: "authority-denied", reason: "authority-verification-failed",
            message: "Writer authority cannot be verified." };
          abort(error);
        }
      } else {
        queueReads();
      }

      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        if (denied) {
          resolve(denied);
          return;
        }
        if (requestError) {
          resolve(classifyFailure(requestError));
          return;
        }
        if (preparedResult && (operation === "write"
          ? preparedResult.status === "imported" || preparedResult.status === "already-imported"
          : preparedResult.status === "committed")) {
          resolve({ status: "transaction-failed", error: {
            name: "VerificationError", message: "IndexedDB transaction result does not match its operation.",
          } });
          return;
        }
        resolve(preparedResult || { status: "transaction-failed", error: {
          name: "VerificationError", message: "IndexedDB transaction completed without a verified result.",
        } });
      };
      transaction.onabort = () => {
        if (settled) return;
        settled = true;
        if (denied) {
          resolve(denied);
          return;
        }
        if (changedSourceKeys) {
          resolve({ status: "source-changed", keys: changedSourceKeys });
          return;
        }
        if (invalidSourceError) {
          resolve({ status: "source-invalid", error: invalidSourceError });
          return;
        }
        if (intentionalConflicts) {
          resolve({ status: "conflict", conflicts: intentionalConflicts });
          return;
        }
        resolve(classifyFailure(requestError || transaction.error || new Error("IndexedDB write transaction aborted.")));
      };
      transaction.onerror = () => {
        requestError ||= transaction.error || new Error("IndexedDB write transaction failed.");
      };
    });
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    const factory = this.factory;
    if (!factory) return Promise.reject(new StorageAccessError("IndexedDB is unavailable in this environment."));

    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(this.databaseName, DATABASE_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      let settled = false;
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(BUSINESS_STORE_NAME)) {
          database.createObjectStore(BUSINESS_STORE_NAME, { keyPath: "key" });
        }
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        reject(new StorageAccessError("IndexedDB database opening is blocked by another connection.", "BlockedError"));
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        reject(request.error || new StorageAccessError("IndexedDB database could not be opened."));
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        const cached = this.databasePromise;
        database.onversionchange = () => {
          database.close();
          if (this.databasePromise === cached) this.databasePromise = null;
        };
        resolve(database);
      };
    });
    let cached: Promise<IDBDatabase>;
    cached = opening.catch((error: unknown) => {
      if (this.databasePromise === cached) this.databasePromise = null;
      throw error;
    });
    this.databasePromise = cached;
    return cached;
  }
}

export function createBrowserPersistenceRepository(databaseName?: string): IndexedDbPersistenceRepository {
  return new IndexedDbPersistenceRepository(browserIndexedDbFactory(), databaseName);
}
