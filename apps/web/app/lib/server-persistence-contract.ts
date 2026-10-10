import { EMPIRE_OS_BACKUP_STORAGE_KEYS } from "./backup";
import type { BusinessStorageKey } from "./indexeddb-persistence";

export const SERVER_PERSISTENCE_PROTOCOL = 1;

export type DatasetFence = Readonly<{
  datasetId: string;
  protocolVersion: typeof SERVER_PERSISTENCE_PROTOCOL;
  generation: number;
  authorityRevision: number;
}>;
export type StoreExpectation = Readonly<{ key: BusinessStorageKey; expectedRevision: number }>;
export type ServerStoreWrite = StoreExpectation & Readonly<{ rawValue: string | null }>;
export type ServerStoreValue = Readonly<{ key: BusinessStorageKey; rawValue: string | null; revision: number }>;
export type DatasetSnapshot = DatasetFence & Readonly<{
  commitSequence: number;
  values: readonly ServerStoreValue[];
}>;
export type SnapshotRequest = Readonly<{ datasetId: string; protocolVersion: typeof SERVER_PERSISTENCE_PROTOCOL }>;
export type WriteBatch = Readonly<{
  fence: DatasetFence;
  idempotencyKey: string;
  reads: readonly StoreExpectation[];
  writes: readonly ServerStoreWrite[];
}>;

export type PersistenceProblem =
  | { status: "invalid-request"; message: string }
  | { status: "unsupported-protocol"; supportedVersion: typeof SERVER_PERSISTENCE_PROTOCOL }
  | { status: "unauthorized"; reason: "authentication-required" | "forbidden" }
  | { status: "unavailable"; outcome: "not-submitted" | "unknown"; message: string }
  | { status: "failed"; outcome: "not-submitted" | "rolled-back" | "unknown"; message: string };
export type BatchConflict =
  | { status: "conflict"; reason: "dataset-fence"; message: string }
  | { status: "conflict"; reason: "store-revision"; conflicts: readonly (StoreExpectation & { actualRevision: number })[] }
  | { status: "conflict"; reason: "idempotency-key-reused" | "import-source"; message: string };

// A receipt describes confirmed COMMIT, not an accepted request or queued local draft.
export type CommitReceipt = Readonly<{
  fence: DatasetFence;
  idempotencyKey: string;
  requestSha256: string;
  transactionId: string;
  commitSequence: number;
  durability: "database-commit-confirmed";
  revisions: readonly Readonly<{ key: BusinessStorageKey; revision: number }>[];
}>;
export type CommitResult =
  | { status: "committed"; receipt: CommitReceipt; replayed: boolean }
  | BatchConflict | PersistenceProblem;
export type CommitLookup = SnapshotRequest & Readonly<{
  generation: number; idempotencyKey: string; requestSha256: string;
}>;
export type LookupResult = CommitResult | { status: "unresolved"; retry: "same-request-only" };

export type ImportPlan = Readonly<{
  version: 1;
  sourceSha256: string;
  entries: readonly Readonly<{ key: BusinessStorageKey; rawValue: string | null }>[];
}>;
export type StageImportRequest = Readonly<{
  fence: DatasetFence; idempotencyKey: string; plan: ImportPlan;
}>;
export type StageImportResult =
  | { status: "staged"; replayed: boolean; receipt: Readonly<{
    fence: DatasetFence; generation: number; sourceSha256: string; transactionId: string;
    idempotencyKey: string; requestSha256: string; commitSequence: number; durability: "database-commit-confirmed";
  }> }
  | BatchConflict | PersistenceProblem;

// Implementations must bind identity to a verified server session, never to request fields.
// There is deliberately no activation API or client-supplied actor/permission.
export interface ServerPersistenceRepository {
  readSnapshot(request: SnapshotRequest): Promise<{ status: "snapshot"; snapshot: DatasetSnapshot } | PersistenceProblem>;
  writeBatch(request: WriteBatch): Promise<CommitResult>;
  lookupCommit(request: CommitLookup): Promise<LookupResult>;
  stageImport(request: StageImportRequest): Promise<StageImportResult>;
}

export type Validation<T> = { status: "valid"; value: T } | Extract<PersistenceProblem, { status: "invalid-request" | "unsupported-protocol" }>;

function invalid(message: string): Extract<PersistenceProblem, { status: "invalid-request" }> {
  return { status: "invalid-request", message };
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function hasOnlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).every((key) => fields.includes(key));
}
export function isCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function isDatasetId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
export function isIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(value);
}
export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
export function isBusinessKey(value: unknown): value is BusinessStorageKey {
  return typeof value === "string" && EMPIRE_OS_BACKUP_STORAGE_KEYS.some((key) => key === value);
}

export function validateSnapshotRequest(value: unknown): Validation<SnapshotRequest> {
  if (!isObject(value) || !hasOnlyFields(value, ["datasetId", "protocolVersion"]) || !isDatasetId(value.datasetId)) {
    return invalid("Snapshot request is malformed or contains unsupported claims.");
  }
  if (value.protocolVersion !== SERVER_PERSISTENCE_PROTOCOL) {
    return { status: "unsupported-protocol", supportedVersion: SERVER_PERSISTENCE_PROTOCOL };
  }
  return { status: "valid", value: Object.freeze({ datasetId: value.datasetId, protocolVersion: SERVER_PERSISTENCE_PROTOCOL }) };
}

export function validateCommitLookup(value: unknown): Validation<CommitLookup> {
  if (!isObject(value) || !hasOnlyFields(value, ["datasetId", "protocolVersion", "generation", "idempotencyKey", "requestSha256"])
    || !isCounter(value.generation) || value.generation === 0 || !isIdempotencyKey(value.idempotencyKey) || !isSha256(value.requestSha256)) {
    return invalid("Commit lookup requires the original generation, key and fingerprint.");
  }
  const request = validateSnapshotRequest({ datasetId: value.datasetId, protocolVersion: value.protocolVersion });
  if (request.status !== "valid") return request;
  return { status: "valid", value: Object.freeze({
    ...request.value, generation: value.generation, idempotencyKey: value.idempotencyKey, requestSha256: value.requestSha256,
  }) };
}

export function validateDatasetFence(value: unknown): Validation<DatasetFence> {
  if (!isObject(value) || !hasOnlyFields(value, ["datasetId", "protocolVersion", "generation", "authorityRevision"])) {
    return invalid("Dataset fence is malformed or contains unsupported claims.");
  }
  if (value.protocolVersion !== SERVER_PERSISTENCE_PROTOCOL) {
    return { status: "unsupported-protocol", supportedVersion: SERVER_PERSISTENCE_PROTOCOL };
  }
  if (!isDatasetId(value.datasetId) || !isCounter(value.generation) || value.generation === 0 || !isCounter(value.authorityRevision)) {
    return invalid("Dataset ID, generation or authority revision is invalid.");
  }
  return { status: "valid", value: Object.freeze({
    datasetId: value.datasetId, protocolVersion: SERVER_PERSISTENCE_PROTOCOL,
    generation: value.generation, authorityRevision: value.authorityRevision,
  }) };
}

export function validateWriteBatch(value: unknown): Validation<WriteBatch> {
  if (!isObject(value) || !hasOnlyFields(value, ["fence", "idempotencyKey", "reads", "writes"])) {
    return invalid("Write batch is malformed or contains unsupported identity/authorization claims.");
  }
  const fence = validateDatasetFence(value.fence);
  if (fence.status !== "valid") return fence;
  if (!isIdempotencyKey(value.idempotencyKey) || !Array.isArray(value.reads) || !Array.isArray(value.writes)
    || value.writes.length === 0 || value.reads.length > EMPIRE_OS_BACKUP_STORAGE_KEYS.length
    || value.writes.length > EMPIRE_OS_BACKUP_STORAGE_KEYS.length) {
    return invalid("Write batch requires a bounded read/write set and an idempotency key.");
  }
  const reads: StoreExpectation[] = [];
  const writes: ServerStoreWrite[] = [];
  for (const entry of value.reads) {
    if (!isObject(entry) || !hasOnlyFields(entry, ["key", "expectedRevision"])
      || !isBusinessKey(entry.key) || !isCounter(entry.expectedRevision)
      || reads.some(({ key }) => key === entry.key)) return invalid("Read dependencies are invalid or duplicated.");
    reads.push(Object.freeze({ key: entry.key, expectedRevision: entry.expectedRevision }));
  }
  for (const entry of value.writes) {
    if (!isObject(entry) || !hasOnlyFields(entry, ["key", "expectedRevision", "rawValue"])
      || !isBusinessKey(entry.key) || !isCounter(entry.expectedRevision) || entry.expectedRevision === Number.MAX_SAFE_INTEGER
      || (entry.rawValue !== null && typeof entry.rawValue !== "string")
      || writes.some(({ key }) => key === entry.key)
      || reads.some(({ key, expectedRevision }) => key === entry.key && expectedRevision !== entry.expectedRevision)) {
      return invalid("Write values/revisions are invalid, duplicated or contradict the read set.");
    }
    writes.push(Object.freeze({ key: entry.key, expectedRevision: entry.expectedRevision, rawValue: entry.rawValue }));
  }
  const order = (a: StoreExpectation, b: StoreExpectation) =>
    EMPIRE_OS_BACKUP_STORAGE_KEYS.indexOf(a.key) - EMPIRE_OS_BACKUP_STORAGE_KEYS.indexOf(b.key);
  reads.sort(order);
  writes.sort(order);
  return { status: "valid", value: Object.freeze({
    fence: fence.value, idempotencyKey: value.idempotencyKey,
    reads: Object.freeze(reads), writes: Object.freeze(writes),
  }) };
}

export function writeBatchContent(batch: WriteBatch): string {
  const { fence } = batch;
  return JSON.stringify([
    "empire-os-write", SERVER_PERSISTENCE_PROTOCOL, fence.datasetId, fence.generation, fence.authorityRevision, batch.idempotencyKey,
    EMPIRE_OS_BACKUP_STORAGE_KEYS.flatMap((key) => batch.reads.filter((entry) => entry.key === key).map((entry) => [key, entry.expectedRevision])),
    EMPIRE_OS_BACKUP_STORAGE_KEYS.flatMap((key) => batch.writes.filter((entry) => entry.key === key)
      .map((entry) => [key, entry.expectedRevision, entry.rawValue])),
  ]);
}

export function validateSnapshot(value: unknown): Validation<DatasetSnapshot> {
  if (!isObject(value) || !hasOnlyFields(value, ["datasetId", "protocolVersion", "generation", "authorityRevision", "commitSequence", "values"])) {
    return invalid("Snapshot is malformed.");
  }
  const fence = validateDatasetFence({
    datasetId: value.datasetId, protocolVersion: value.protocolVersion, generation: value.generation, authorityRevision: value.authorityRevision,
  });
  if (fence.status !== "valid") return fence;
  if (!isCounter(value.commitSequence) || !Array.isArray(value.values) || value.values.length !== EMPIRE_OS_BACKUP_STORAGE_KEYS.length) {
    return invalid("Snapshot must contain every registered store and a commit sequence.");
  }
  const values: ServerStoreValue[] = [];
  for (const entry of value.values) {
    if (!isObject(entry) || !hasOnlyFields(entry, ["key", "rawValue", "revision"]) || !isBusinessKey(entry.key)
      || (entry.rawValue !== null && typeof entry.rawValue !== "string") || !isCounter(entry.revision)
      || (entry.revision === 0 && entry.rawValue !== null) || values.some(({ key }) => key === entry.key)) {
      return invalid("Snapshot contains invalid or duplicate stores.");
    }
    values.push(Object.freeze({ key: entry.key, rawValue: entry.rawValue, revision: entry.revision }));
  }
  return { status: "valid", value: Object.freeze({ ...fence.value, commitSequence: value.commitSequence, values: Object.freeze(values) }) };
}

// This pure check is reusable inside a real transaction; it does not acquire locks or commit.
export function checkBatchPreconditions(batch: WriteBatch, snapshot: DatasetSnapshot): BatchConflict | null {
  if (batch.fence.datasetId !== snapshot.datasetId || batch.fence.protocolVersion !== snapshot.protocolVersion
    || batch.fence.generation !== snapshot.generation || batch.fence.authorityRevision !== snapshot.authorityRevision) {
    return { status: "conflict", reason: "dataset-fence", message: "Dataset authority has changed." };
  }
  const expected = new Map([...batch.reads, ...batch.writes].map((entry) => [entry.key, entry.expectedRevision]));
  const conflicts: (StoreExpectation & { actualRevision: number })[] = [];
  for (const [key, expectedRevision] of expected) {
    const actual = snapshot.values.find((entry) => entry.key === key);
    if (!actual) throw new Error("Preconditions require a validated complete snapshot.");
    if (actual.revision !== expectedRevision) conflicts.push({ key, expectedRevision, actualRevision: actual.revision });
  }
  return conflicts.length ? { status: "conflict", reason: "store-revision", conflicts } : null;
}

export function validateCommitReceipt(value: unknown, batch: WriteBatch, requestSha256: string): Validation<CommitReceipt> {
  if (!isObject(value) || !hasOnlyFields(value, ["fence", "idempotencyKey", "requestSha256", "transactionId", "commitSequence", "durability", "revisions"])) {
    return invalid("Commit receipt is malformed.");
  }
  const fence = validateDatasetFence(value.fence);
  if (fence.status !== "valid") return fence;
  if (fence.value.datasetId !== batch.fence.datasetId || fence.value.generation !== batch.fence.generation
    || fence.value.authorityRevision !== batch.fence.authorityRevision || fence.value.protocolVersion !== batch.fence.protocolVersion
    || value.idempotencyKey !== batch.idempotencyKey
    || !isSha256(requestSha256) || value.requestSha256 !== requestSha256 || !isDatasetId(value.transactionId)
    || !isCounter(value.commitSequence) || value.commitSequence === 0 || value.durability !== "database-commit-confirmed"
    || !Array.isArray(value.revisions) || value.revisions.length !== batch.writes.length) {
    return invalid("Commit receipt does not confirm this exact request.");
  }
  const revisions: { key: BusinessStorageKey; revision: number }[] = [];
  for (const entry of value.revisions) {
    if (!isObject(entry) || !hasOnlyFields(entry, ["key", "revision"]) || !isBusinessKey(entry.key) || !isCounter(entry.revision)
      || !batch.writes.some((write) => write.key === entry.key && entry.revision === write.expectedRevision + 1)
      || revisions.some(({ key }) => key === entry.key)) return invalid("Commit receipt has incorrect or incomplete revisions.");
    revisions.push(Object.freeze({ key: entry.key, revision: entry.revision }));
  }
  return { status: "valid", value: Object.freeze({
    fence: fence.value, idempotencyKey: batch.idempotencyKey, requestSha256, transactionId: value.transactionId,
    commitSequence: value.commitSequence, durability: "database-commit-confirmed", revisions: Object.freeze(revisions),
  }) };
}

export function commitRetryPolicy(result: LookupResult): "complete" | "same-request-only" | "stop" {
  switch (result.status) {
    case "committed": return "complete";
    case "unresolved": return "same-request-only";
    case "unavailable": return "same-request-only";
    case "failed": return result.outcome === "unknown" ? "same-request-only" : "stop";
    case "conflict":
    case "invalid-request":
    case "unsupported-protocol":
    case "unauthorized": return "stop";
  }
}

// Not a database simulator: no method can manufacture persistence or a commit receipt.
export class UnconfiguredServerPersistenceRepository implements ServerPersistenceRepository {
  private unavailable(): Extract<PersistenceProblem, { status: "unavailable" }> {
    return { status: "unavailable", outcome: "not-submitted", message: "No authenticated PostgreSQL adapter is configured." };
  }
  readSnapshot: ServerPersistenceRepository["readSnapshot"] = async () => this.unavailable();
  writeBatch: ServerPersistenceRepository["writeBatch"] = async () => this.unavailable();
  lookupCommit: ServerPersistenceRepository["lookupCommit"] = async () => this.unavailable();
  stageImport: ServerPersistenceRepository["stageImport"] = async () => this.unavailable();
}
