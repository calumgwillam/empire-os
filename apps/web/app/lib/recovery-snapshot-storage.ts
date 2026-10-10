export const RECOVERY_SNAPSHOT_BUDGET_BYTES = 2 * 1024 * 1024;
const COMPACT_FORMAT = "empire-os-recovery-snapshots";

export type RecoverySnapshot = {
  createdAt: string;
  storage: Record<string, string | null>;
  pinned?: boolean;
  [field: string]: unknown;
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertSnapshots(value: unknown): asserts value is RecoverySnapshot[] {
  if (!Array.isArray(value) || !value.every((entry: unknown) => object(entry)
    && typeof entry.createdAt === "string" && object(entry.storage)
    && Object.values(entry.storage).every((stored) => stored === null || typeof stored === "string")
    && (entry.pinned === undefined || typeof entry.pinned === "boolean"))) {
    throw new Error("Existing recovery history is malformed; it was preserved instead of overwritten.");
  }
}

// Deltas reference only earlier pool entries; every reconstructed store remains an exact string.
export function decodeRecoverySnapshots(raw: string | null): RecoverySnapshot[] {
  const value: unknown = raw === null ? [] : JSON.parse(raw);
  if (Array.isArray(value)) {
    assertSnapshots(value);
    return value;
  }
  if (!object(value) || value.format !== COMPACT_FORMAT || value.version !== 1
    || !Array.isArray(value.pool) || !Array.isArray(value.snapshots)) {
    throw new Error("Recovery history format is invalid or unsupported; stored evidence was preserved.");
  }
  const pool: string[] = [];
  for (const entry of value.pool) {
    if (typeof entry === "string") {
      pool.push(entry);
      continue;
    }
    if (!Array.isArray(entry) || entry.length !== 4) throw new Error("Recovery history delta is malformed.");
    const [base, prefix, suffix, middle] = entry;
    if (typeof base !== "number" || !Number.isInteger(base) || base < 0 || base >= pool.length
      || typeof prefix !== "number" || !Number.isInteger(prefix) || prefix < 0
      || typeof suffix !== "number" || !Number.isInteger(suffix) || suffix < 0
      || prefix + suffix > pool[base].length || typeof middle !== "string") {
      throw new Error("Recovery history delta cannot be reconstructed.");
    }
    const previous = pool[base];
    pool.push(previous.slice(0, prefix) + middle + (suffix ? previous.slice(-suffix) : ""));
  }
  const snapshots = value.snapshots.map((entry: unknown) => {
    if (!object(entry) || !object(entry.storage)) throw new Error("Recovery snapshot is malformed.");
    const storage = Object.fromEntries(Object.entries(entry.storage).map(([key, reference]) => {
      if (reference === null) return [key, null];
      if (typeof reference !== "number" || !Number.isInteger(reference) || reference < 0 || reference >= pool.length) {
        throw new Error("Recovery snapshot store reference is invalid.");
      }
      return [key, pool[reference]];
    }));
    return { ...entry, storage };
  });
  assertSnapshots(snapshots);
  return snapshots;
}

export function encodeRecoverySnapshots(snapshots: readonly RecoverySnapshot[]): string {
  assertSnapshots(snapshots);
  const plain = JSON.stringify(snapshots);
  const pool: Array<string | [number, number, number, string]> = [];
  const indices = new Map<string, number>();
  const previousByKey = new Map<string, string>();
  const encoded = snapshots.map((snapshot) => ({
    ...snapshot,
    storage: Object.fromEntries(Object.entries(snapshot.storage).map(([key, value]) => {
      if (value === null) return [key, null];
      let index = indices.get(value);
      if (index === undefined) {
        let representation: string | [number, number, number, string] = value;
        const previous = previousByKey.get(key);
        if (previous !== undefined) {
          let prefix = 0;
          let suffix = 0;
          const limit = Math.min(previous.length, value.length);
          while (prefix < limit && previous[prefix] === value[prefix]) prefix++;
          while (suffix < limit - prefix && previous[previous.length - 1 - suffix] === value[value.length - 1 - suffix]) suffix++;
          const base = indices.get(previous);
          if (base === undefined) throw new Error("Recovery compaction base is missing.");
          const delta: [number, number, number, string] = [base, prefix, suffix, value.slice(prefix, value.length - suffix)];
          if (JSON.stringify(delta).length < JSON.stringify(value).length) representation = delta;
        }
        index = pool.length;
        pool.push(representation);
        indices.set(value, index);
      }
      previousByKey.set(key, value);
      return [key, index];
    })),
  }));
  const compact = JSON.stringify({ format: COMPACT_FORMAT, version: 1, pool, snapshots: encoded });
  const result = compact.length < plain.length ? compact : plain;
  if (JSON.stringify(decodeRecoverySnapshots(result)) !== plain) {
    throw new Error("Lossless recovery compaction verification failed; existing evidence was preserved.");
  }
  return result;
}
