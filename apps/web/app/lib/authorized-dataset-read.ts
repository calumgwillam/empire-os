import { Buffer } from "node:buffer";
import { versions } from "node:process";
import { isAuthorityIdentifier } from "./authorization-policy";
import { EMPIRE_OS_BACKUP_STORAGE_KEYS } from "./backup";
import { validateDurableAuthorityState, type DurableAuthorityState } from "./durable-authorization-state";
import { decodeRawStoreValue } from "./server-import-preparation";
import {
  hasOnlyFields, isBusinessKey, isCounter, isObject, SERVER_PERSISTENCE_PROTOCOL, validateSnapshot,
  type DatasetSnapshot, type ServerStoreValue,
} from "./server-persistence-contract";

if (!versions.node) throw new Error("Authorized dataset reads require the Node.js runtime.");

// Migration 004. Counters are cast to text so bigint values are never silently rounded by the driver.
export const READ_DATASET_SNAPSHOT_SQL = `SELECT state,revision::text AS revision,actor_subject,decision,
  checked_at::text AS checked_at,generation::text AS generation,authority_revision::text AS authority_revision,
  commit_sequence::text AS commit_sequence,store_values
  FROM empire_os_authorization.read_dataset_snapshot($1,$2::uuid)`;

export type DatasetReadObservation = Readonly<{
  source: "test-model-only" | "committed-database-read";
  authority: DurableAuthorityState;
  // Bound by the store (e.g. the restricted database role), never by the caller.
  actorSubject: string;
  // The store's independent read decision. Callers must cross-check it, never trust it alone.
  readDecision: Readonly<{ status: "allowed" | "denied"; reason: string }>;
  checkedAt: number;
  // Present only when the store allowed the read.
  snapshot: DatasetSnapshot | null;
}>;
export type DatasetReadResult =
  | Readonly<{ status: "observed"; observation: DatasetReadObservation }>
  | Readonly<{ status: "unavailable"; message: string }>;

export interface AuthorizedDatasetReader {
  // Acquire the SAME tenant-wide lock as runLocked BEFORE reading committed state.
  // Never stage, commit or write any effect.
  readDataset(tenantId: string, datasetId: string): Promise<DatasetReadResult>;
}

function counter(value: unknown): number {
  const number = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (!isCounter(number)) throw new Error("Invalid dataset snapshot counter.");
  return number;
}

// Untrusted database row -> verified observation. Throws on ANY inconsistency.
export function decodeDatasetSnapshotRow(row: unknown, tenantId: string, datasetId: string): DatasetReadObservation {
  if (!isObject(row)) throw new Error("Dataset snapshot row is malformed.");
  const authority = validateDurableAuthorityState(row.state);
  if (authority.status !== "valid" || authority.value.snapshot.tenant.id !== tenantId
    || authority.value.snapshot.revision !== counter(row.revision)) throw new Error("Inconsistent authority state.");
  const actorSubject = row.actor_subject;
  if (!isAuthorityIdentifier(actorSubject)) throw new Error("Invalid bound actor.");
  const decision = row.decision;
  if (!isObject(decision) || (decision.status !== "allowed" && decision.status !== "denied")
    || typeof decision.reason !== "string" || decision.policyVersion !== 1
    || decision.observedPolicyRevision !== authority.value.snapshot.revision) throw new Error("Invalid read decision.");
  const checkedAt = counter(row.checked_at);
  const base = {
    source: "committed-database-read" as const, authority: authority.value, actorSubject,
    readDecision: Object.freeze({ status: decision.status, reason: decision.reason }), checkedAt,
  };
  if (decision.status === "denied") {
    // A denied read must disclose no business values or dataset counters.
    if (row.generation !== null || row.authority_revision !== null || row.commit_sequence !== null
      || !Array.isArray(row.store_values) || row.store_values.length !== 0) throw new Error("Denied read disclosed data.");
    return Object.freeze({ ...base, snapshot: null });
  }
  if (!authority.value.snapshot.datasets.some((entry) => entry.datasetId === datasetId)) throw new Error("Unmapped dataset.");
  const rows = row.store_values;
  if (!Array.isArray(rows) || rows.length !== EMPIRE_OS_BACKUP_STORAGE_KEYS.length) throw new Error("Incomplete store set.");
  const values = new Map<string, ServerStoreValue>();
  for (const entry of rows) {
    if (!isObject(entry) || !hasOnlyFields(entry, ["key", "revision", "rawValueHex"]) || !isBusinessKey(entry.key)
      || values.has(entry.key) || !isCounter(entry.revision)
      || (entry.rawValueHex !== null && (typeof entry.rawValueHex !== "string" || !/^(?:[0-9a-f]{4})*$/.test(entry.rawValueHex)))) {
      throw new Error("Invalid stored value.");
    }
    const rawValue = entry.rawValueHex === null ? null : decodeRawStoreValue(new Uint8Array(Buffer.from(entry.rawValueHex, "hex")));
    values.set(entry.key, { key: entry.key, revision: entry.revision, rawValue });
  }
  const snapshot = validateSnapshot({
    datasetId, protocolVersion: SERVER_PERSISTENCE_PROTOCOL, generation: counter(row.generation),
    authorityRevision: counter(row.authority_revision), commitSequence: counter(row.commit_sequence),
    values: EMPIRE_OS_BACKUP_STORAGE_KEYS.map((key) => values.get(key)),
  });
  if (snapshot.status !== "valid") throw new Error("Invalid dataset snapshot.");
  // Each committed write advances every store it writes by exactly one revision, and at least one store.
  const revisions = snapshot.value.values.map((entry) => entry.revision);
  if (snapshot.value.commitSequence < Math.max(...revisions)
    || snapshot.value.commitSequence > revisions.reduce((total, revision) => total + revision, 0)) {
    throw new Error("Commit sequence contradicts store revisions.");
  }
  return Object.freeze({ ...base, snapshot: snapshot.value });
}
