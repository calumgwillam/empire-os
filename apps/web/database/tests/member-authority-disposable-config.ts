import { isAbsolute, normalize } from "node:path";
import { DISPOSABLE_MARKER, disposableConfig, type DisposableConfig } from "./disposable-config";

const PREFIX = "EMPIRE_OS_MEMBER_TEST_PG_";
// Dedicated opt-in only. CONFIRM uses the existing database:DISPOSABLE_MARKER
// convention. An independent local provisioner must initialize a NEW directory,
// record its pg_control system identifier, then record postmaster.pid identity and
// the freshly created template0 database's OID/owner in the manifest below.
// Never generate expected identity by querying the connection this harness checks.
// The manifest is a targeting guard, not cryptographic proof of provisioning.
// Preserve the target after EVERY migration attempt; a new run needs a new cluster,
// manifest and database. No signing keys, cluster creation or discovery fallback.
const KEYS = ["HOST", "PORT", "DATABASE", "USER", "PASSWORD", "CONFIRM",
  "IDENTITY_MANIFEST_FILE", "ATTESTATION_FILE", "ATTESTOR_PUBLIC_KEY_FILE"] as const;
export const MEMBER_CONSUMED_MARKER = "empire-os-member-authority-attempt-consumed";

export type MemberDisposableConfig = Readonly<{
  database: DisposableConfig;
  identityManifestFile: string;
}>;
export type MemberProvisioningIdentity = Readonly<{
  version: 1;
  purpose: "empire-os-member-authority-pg16";
  runId: string;
  host: string;
  port: number;
  database: string;
  databaseOid: string;
  owner: string;
  systemIdentifier: string;
  dataDirectory: string;
  postmasterPid: number;
  postmasterStartedAtSeconds: number;
  clusterCreatedAtMs: number;
  databaseCreatedAtMs: number;
  isolatedNewCluster: true;
  neverPreviouslyAttempted: true;
}>;

export function memberAuthorityDisposableConfig(env: Readonly<Record<string, string | undefined>>):
  { status: "skip" } | { status: "configured"; config: MemberDisposableConfig } {
  if (KEYS.every(key => env[`${PREFIX}${key}`] === undefined)) return { status: "skip" };
  const isolated: Record<string, string | undefined> = {};
  for (const key of ["HOST", "PORT", "DATABASE", "USER", "PASSWORD", "CONFIRM"]) {
    isolated[`EMPIRE_OS_TEST_PG_${key}`] = env[`${PREFIX}${key}`];
  }
  const result = disposableConfig(isolated);
  const identityManifestFile = env[`${PREFIX}IDENTITY_MANIFEST_FILE`];
  if (result.status !== "configured" || !/^empire_os_test_member_[a-f0-9]{32}$/.test(result.config.database)
    || !absolutePath(identityManifestFile)
    || env[`${PREFIX}ATTESTATION_FILE`] !== undefined || env[`${PREFIX}ATTESTOR_PUBLIC_KEY_FILE`] !== undefined) {
    throw new Error("Member tests require dedicated explicit configuration and a local identity manifest; legacy signing settings are unsupported.");
  }
  for (const [key, value] of Object.entries(env)) {
    if (key === `${PREFIX}DATABASE`) continue;
    if (key.endsWith("_DATABASE") && value === result.config.database) {
      throw new Error("Member tests cannot share another suite's database.");
    }
    if (!key.startsWith(PREFIX) && key.endsWith("_TEST_PG_HOST") && (value === "127.0.0.1" || value === "::1")) {
      const otherPort = env[key.replace(/HOST$/, "PORT")];
      if (Number(otherPort) === result.config.port) throw new Error("Member tests require a separate test cluster endpoint.");
    }
  }
  return { status: "configured", config: Object.freeze({
    database: result.config, identityManifestFile,
  }) };
}

export function verifyMemberProvisioningIdentity(
  config: MemberDisposableConfig, value: unknown, nowMs: number,
): MemberProvisioningIdentity {
  const invalid = () => new Error("Independent local provisioning identity verification failed.");
  const fields = ["version", "purpose", "runId", "host", "port", "database", "databaseOid", "owner", "systemIdentifier",
    "dataDirectory", "postmasterPid", "postmasterStartedAtSeconds",
    "clusterCreatedAtMs", "databaseCreatedAtMs", "isolatedNewCluster", "neverPreviouslyAttempted"];
  if (!object(value) || Object.keys(value).sort().join(",") !== fields.sort().join(",")
    || value.version !== 1 || value.purpose !== "empire-os-member-authority-pg16"
    || typeof value.runId !== "string" || !/^[a-f0-9]{32}$/.test(value.runId)
    || value.database !== `empire_os_test_member_${value.runId}` || value.database !== config.database.database
    || value.owner !== config.database.user || value.host !== config.database.host || value.port !== config.database.port
    || typeof value.databaseOid !== "string" || !/^[1-9][0-9]{0,9}$/.test(value.databaseOid)
    || typeof value.systemIdentifier !== "string" || !/^[1-9][0-9]{0,19}$/.test(value.systemIdentifier)
    || !absolutePath(value.dataDirectory) || value.dataDirectory === "/"
    || !time(value.postmasterPid) || value.postmasterPid === 0 || value.postmasterPid > 2147483647
    || !time(value.postmasterStartedAtSeconds) || value.postmasterStartedAtSeconds === 0
    || !time(value.clusterCreatedAtMs) || !time(value.databaseCreatedAtMs) || !time(nowMs)
    || value.clusterCreatedAtMs > value.databaseCreatedAtMs || value.databaseCreatedAtMs > nowMs
    || value.postmasterStartedAtSeconds * 1000 > value.databaseCreatedAtMs
    || (value.postmasterStartedAtSeconds + 1) * 1000 <= value.clusterCreatedAtMs
    || value.isolatedNewCluster !== true || value.neverPreviouslyAttempted !== true) throw invalid();
  return Object.freeze({
    version: 1, purpose: "empire-os-member-authority-pg16", runId: value.runId,
    host: config.database.host, port: config.database.port, database: config.database.database, databaseOid: value.databaseOid,
    owner: config.database.user, systemIdentifier: value.systemIdentifier,
    dataDirectory: value.dataDirectory, postmasterPid: value.postmasterPid,
    postmasterStartedAtSeconds: value.postmasterStartedAtSeconds,
    clusterCreatedAtMs: value.clusterCreatedAtMs, databaseCreatedAtMs: value.databaseCreatedAtMs,
    isolatedNewCluster: true, neverPreviouslyAttempted: true,
  });
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function time(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function absolutePath(value: unknown): value is string {
  return typeof value === "string" && isAbsolute(value) && normalize(value) === value && !/[\u0000-\u001f\u007f]/.test(value);
}

export type MemberDatabaseIdentity = Readonly<{
  database: string; database_oid: string; owner: string; principal: string; session_principal: string;
  system_identifier: string; version: string; recovery: boolean; read_only: string; superuser: boolean;
  clean_cluster: boolean; marker: string | null;
  data_directory: string; server_port: number; server_address: string; postmaster_started_at: string;
}>;

export function verifyMemberDatabaseIdentity(
  proof: MemberProvisioningIdentity, identity: MemberDatabaseIdentity, phase: "fresh" | "consumed" = "fresh",
): void {
  if (identity.database !== proof.database || identity.database_oid !== proof.databaseOid
    || identity.owner !== proof.owner || identity.principal !== proof.owner || identity.session_principal !== proof.owner
    || identity.system_identifier !== proof.systemIdentifier || !/^16[0-9]{4}$/.test(identity.version)
    || identity.data_directory !== proof.dataDirectory || identity.server_port !== proof.port
    || identity.server_address !== proof.host || identity.postmaster_started_at !== String(proof.postmasterStartedAtSeconds)
    || identity.recovery !== false || identity.read_only !== "off" || identity.superuser !== true
    || identity.marker !== (phase === "fresh" ? DISPOSABLE_MARKER : MEMBER_CONSUMED_MARKER)
    || (phase === "fresh" && identity.clean_cluster !== true)) {
    throw new Error("Member test database/owner/cluster identity verification failed; no setup authorized.");
  }
}
