import "server-only";
import { createHash } from "node:crypto";
import { isAuthorityIdentifier } from "./authorization-policy";
import { BACKUP_FORMAT, BACKUP_VERSION, EMPIRE_OS_BACKUP_STORAGE_KEYS, type EmpireOsBackup } from "./backup";
import { backupStorageContent } from "./backup-fingerprint";
import { runRecoveryDrill } from "./recovery-drill";
import {
  hasOnlyFields, isCounter, isDatasetId, isObject, SERVER_PERSISTENCE_PROTOCOL, validateSnapshot,
  type DatasetSnapshot, type PersistenceProblem,
} from "./server-persistence-contract";
import { assertDatasetContent } from "./server-write-preparation";
import { createTrustedMultiUserAuthority, type TrustedMultiUserAuthorityDependencies } from "./trusted-multi-user-authority";
import { sealFullBackup, verifyBackupIntegrity } from "./verified-backup";

export const UNATTENDED_BACKUP_DEPENDENCIES = Object.freeze([
  "approved-durable-browser-to-server-synchronisation",
  "approved-independent-person-and-issuer-authority",
  "approved-noninteractive-backup-service-identity",
  "approved-off-device-immutable-destination-and-server-owned-credentials",
  "deployed-scheduler-and-independent-failure-alert-delivery",
  "real-provider-readback-and-independent-device-restore-test",
] as const);

export function unattendedBackupReadiness() {
  return Object.freeze({ status: "blocked" as const, missing: UNATTENDED_BACKUP_DEPENDENCIES });
}

export interface ServerRecoveryArchive {
  // Server composition only. An adapter is NOT proof of remote durability.
  // Atomically create or report existing; never replace, delete or silently prune.
  list(prefix: string): Promise<readonly string[]>;
  read(key: string): Promise<string>;
  putIfAbsent(key: string, text: string): Promise<"created" | "existing">;
  withExclusiveLease<T>(prefix: string, operation: () => Promise<T>): Promise<T>;
}
export type ServerBackupAlert = Readonly<{
  code: "backup-failed" | "backup-missing" | "backup-stale" | "backup-not-current";
  tenantId: string;
  datasetId: string;
  checkedAt: string;
  message: string;
  failure?: ServerBackupFailure;
}>;
type ServerBackupFailure = "source-read" | "source-validation" | "archive-lease" | "archive-inspection"
  | "retention-limit" | "archive-write" | "archive-readback" | "alert-delivery";
export type ServerRecoveryPoint = Readonly<{
  format: "empire-os-server-recovery";
  version: 1;
  tenantId: string;
  datasetId: string;
  generation: number;
  authorityRevision: number;
  commitSequence: number;
  storeRevisions: readonly Readonly<{ key: string; revision: number }>[];
  backup: EmpireOsBackup;
  envelopeSha256: string;
}>;
const MAX_POINTS = 32;
const STALE_MS = 24 * 60 * 60_000;
const MAX_TEXT_BYTES = 64 * 1024 * 1024;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function prefix(tenantId: string, datasetId: string): string {
  return `empire-os-server-v1-${hash(JSON.stringify([tenantId, datasetId]))}-`;
}
function sourceKey(tenantId: string, snapshot: DatasetSnapshot): string {
  return `${prefix(tenantId, snapshot.datasetId)}${snapshot.generation}-${snapshot.authorityRevision}-${snapshot.commitSequence}.json`;
}
function payload(point: Omit<ServerRecoveryPoint, "envelopeSha256">): string {
  return JSON.stringify([point.format, point.version, point.tenantId, point.datasetId, point.generation,
    point.authorityRevision, point.commitSequence, point.storeRevisions, point.backup.integrity?.contentSha256]);
}

async function prepare(tenantId: string, snapshot: DatasetSnapshot, createdAt: string): Promise<ServerRecoveryPoint> {
  assertDatasetContent(snapshot);
  const storage = Object.fromEntries(snapshot.values.map(entry => [entry.key, entry.rawValue]));
  const backup = await sealFullBackup({
    format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt, storage, includedStorageKeys: [...EMPIRE_OS_BACKUP_STORAGE_KEYS],
  });
  const point: Omit<ServerRecoveryPoint, "envelopeSha256"> = {
    format: "empire-os-server-recovery", version: 1, tenantId, datasetId: snapshot.datasetId,
    generation: snapshot.generation, authorityRevision: snapshot.authorityRevision, commitSequence: snapshot.commitSequence,
    storeRevisions: EMPIRE_OS_BACKUP_STORAGE_KEYS.map(key => {
      const entry = snapshot.values.find(value => value.key === key);
      if (!entry) throw new Error("Incomplete server backup source.");
      return { key, revision: entry.revision };
    }), backup,
  };
  return { ...point, envelopeSha256: hash(payload(point)) };
}

// Corruption/consistency verification only. Hashes, counters and dates in an
// archive do not authenticate its issuer or prove that a browser was synced.
export async function verifyServerRecoveryPoint(
  text: string, tenantId: string, datasetId: string, nowMs: number,
): Promise<ServerRecoveryPoint> {
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES || !isCounter(nowMs)) throw new Error("Invalid server recovery bounds.");
  const value: unknown = JSON.parse(text);
  if (!isObject(value) || !hasOnlyFields(value, [
    "format", "version", "tenantId", "datasetId", "generation", "authorityRevision", "commitSequence",
    "storeRevisions", "backup", "envelopeSha256",
  ]) || value.format !== "empire-os-server-recovery" || value.version !== 1
    || value.tenantId !== tenantId || value.datasetId !== datasetId || !isAuthorityIdentifier(tenantId) || !isDatasetId(datasetId)
    || !Array.isArray(value.storeRevisions) || value.storeRevisions.length !== EMPIRE_OS_BACKUP_STORAGE_KEYS.length) {
    throw new Error("Server recovery scope or manifest is invalid.");
  }
  const verified = await verifyBackupIntegrity(value.backup);
  if (verified.integrity !== "sha256-verified" || Date.parse(verified.backup.createdAt) > nowMs) {
    throw new Error("Server recovery integrity or timestamp is invalid.");
  }
  const snapshot = validateSnapshot({
    datasetId, protocolVersion: SERVER_PERSISTENCE_PROTOCOL, generation: value.generation,
    authorityRevision: value.authorityRevision, commitSequence: value.commitSequence,
    values: value.storeRevisions.map((entry: unknown, index) => {
      if (!isObject(entry) || !hasOnlyFields(entry, ["key", "revision"]) || entry.key !== EMPIRE_OS_BACKUP_STORAGE_KEYS[index]) {
        throw new Error("Server recovery revision manifest is invalid.");
      }
      return { ...entry, rawValue: verified.backup.storage[EMPIRE_OS_BACKUP_STORAGE_KEYS[index]] };
    }),
  });
  if (snapshot.status !== "valid") throw new Error("Invalid recovery source counters.");
  const expected = await prepare(tenantId, snapshot.value, verified.backup.createdAt);
  if (expected.envelopeSha256 !== value.envelopeSha256) throw new Error("Server recovery envelope hash mismatch.");
  runRecoveryDrill(JSON.stringify(verified.backup));
  return expected;
}

function matches(point: ServerRecoveryPoint, snapshot: DatasetSnapshot): boolean {
  return point.generation === snapshot.generation && point.authorityRevision === snapshot.authorityRevision
    && point.commitSequence === snapshot.commitSequence
    && point.storeRevisions.every(entry => snapshot.values.some(value => value.key === entry.key && value.revision === entry.revision))
    && backupStorageContent(point.backup.storage) === backupStorageContent(
      Object.fromEntries(snapshot.values.map(entry => [entry.key, entry.rawValue])));
}

// No route, scheduler, browser writer, cloud client or service principal is
// installed here. The SAME Clerk/Person/tenant authority must allow each read.
// Once those independent dependencies exist, an approved noninteractive source
// may reuse this archive format; no caller snapshot or asserted service role is accepted.
export function createServerRecoveryBackup(dependencies: TrustedMultiUserAuthorityDependencies & Readonly<{
  datasetId: string;
  archive: ServerRecoveryArchive;
  alert(event: ServerBackupAlert): Promise<void>;
}>) {
  const { tenantId, datasetId, archive, alert } = dependencies;
  if (!isAuthorityIdentifier(tenantId) || !isDatasetId(datasetId)) throw new Error("Invalid server recovery scope.");
  const authority = createTrustedMultiUserAuthority(dependencies);
  let busy = false;

  async function execute(request: Request, write: boolean) {
    if (busy) return { status: "unavailable", outcome: "not-submitted",
      message: "Server backup execution is already in progress." } satisfies PersistenceProblem;
    busy = true;
    let stage: ServerBackupFailure = "source-read";
    try {
      const read = await authority.readSnapshot(request, { datasetId, protocolVersion: SERVER_PERSISTENCE_PROTOCOL });
      if (read.status !== "snapshot") return read;
      stage = "source-validation";
      const decoded = validateSnapshot(read.snapshot);
      if (decoded.status !== "valid" || decoded.value.datasetId !== datasetId) throw new Error("Invalid server backup source.");
      const snapshot = decoded.value;
      assertDatasetContent(snapshot);
      if (snapshot.values.every(entry => entry.rawValue === null)) throw new Error("Empty server source cannot establish business-data recovery.");
      stage = "archive-lease";
      return await archive.withExclusiveLease(prefix(tenantId, datasetId), async () => {
        stage = "archive-inspection";
        const nowMs = Date.now();
        const createdAt = new Date(nowMs).toISOString();
        const names = await archive.list(prefix(tenantId, datasetId));
        if (names.length > MAX_POINTS || new Set(names).size !== names.length
          || names.some(name => !name.startsWith(prefix(tenantId, datasetId)))) throw new Error("Invalid or full server recovery listing.");
        const points: ServerRecoveryPoint[] = [];
        for (const name of names) {
          const point = await verifyServerRecoveryPoint(await archive.read(name), tenantId, datasetId, nowMs);
          if (sourceKey(tenantId, {
            ...snapshot, generation: point.generation, authorityRevision: point.authorityRevision, commitSequence: point.commitSequence,
          }) !== name) throw new Error("Recovery key does not match its immutable source fence.");
          points.push(point);
        }
        const matching = points.find(point => matches(point, snapshot));
        const key = sourceKey(tenantId, snapshot);
        if (write && !matching) {
          if (names.length >= MAX_POINTS) {
            stage = "retention-limit";
            throw new Error("Recovery retention ceiling reached. All prior points were preserved.");
          }
          const point = await prepare(tenantId, snapshot, createdAt);
          const text = JSON.stringify(point);
          if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) throw new Error("Server recovery point exceeds the size limit.");
          // Lost acknowledgements reconcile by deterministic source key and exact
          // content. Never overwrite, refresh timestamps or silently resubmit a write.
          stage = "archive-write";
          const written = await archive.putIfAbsent(key, text);
          if (written !== "created" && written !== "existing") throw new Error("Invalid archive write acknowledgement.");
          stage = "archive-readback";
          const readBack = await archive.read(key);
          if (written === "created" && readBack !== text) throw new Error("New archive bytes differ from the intended recovery object.");
          const observed = await verifyServerRecoveryPoint(readBack, tenantId, datasetId, Date.now());
          if (!matches(observed, snapshot)) throw new Error("Read-back differs from the exact source revision.");
          if (Date.now() - Date.parse(observed.backup.createdAt) > STALE_MS) throw new Error("Reconciled recovery object is stale.");
          return { status: "archive-verified" as const, key, recoveryPoints: points.length + 1,
            browserCoverage: "not-established" as const, remoteDurability: "not-established" as const };
        }
        const code = points.length === 0 ? "backup-missing" : !matching ? "backup-not-current"
          : nowMs - Date.parse(matching.backup.createdAt) > STALE_MS ? "backup-stale" : null;
        if (code) {
          stage = "alert-delivery";
          await alert({ code, tenantId, datasetId, checkedAt: createdAt,
            message: "Server recovery needs attention. Inspect the authorised backup monitor; no business content is included in this alert." });
          return { status: "attention-required" as const, reason: code, recoveryPoints: points.length,
            browserCoverage: "not-established" as const, remoteDurability: "not-established" as const };
        }
        return { status: "archive-verified" as const, key, recoveryPoints: points.length,
          browserCoverage: "not-established" as const, remoteDurability: "not-established" as const };
      });
    } catch {
      try {
        await alert({ code: "backup-failed", tenantId, datasetId, checkedAt: new Date().toISOString(),
          failure: stage,
          message: "Server backup could not be verified. Earlier recovery points were not intentionally changed; reconcile storage before retrying." });
      } catch {
        return { status: "unavailable" as const, outcome: "unknown" as const, failure: "alert-delivery" as const,
          message: `Server backup failed during ${stage}, and alert delivery could not be confirmed.` };
      }
      return { status: "unavailable" as const, outcome: "unknown" as const, failure: stage,
        message: `Server backup failed during ${stage}; an alert was submitted. Reconcile the exact source key before retrying.` };
    } finally {
      busy = false;
    }
  }
  return Object.freeze({
    capture: (request: Request) => execute(request, true),
    inspect: (request: Request) => execute(request, false),
  });
}
