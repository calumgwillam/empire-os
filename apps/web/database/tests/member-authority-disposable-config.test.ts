import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DISPOSABLE_MARKER } from "./disposable-config";
import {
  MEMBER_ATTESTATION_MAX_AGE_MS, MEMBER_CONSUMED_MARKER, memberAuthorityDisposableConfig,
  verifyMemberClusterAttestation, verifyMemberDatabaseIdentity,
  type MemberClusterAttestation, type MemberDatabaseIdentity,
} from "./member-authority-disposable-config";

const runId = "a".repeat(32);
const database = `empire_os_test_member_${runId}`;
const now = 100000000;
// Ephemeral test signing keys only; no key files or environment are read.
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
function environment(): Record<string, string> {
  return {
    EMPIRE_OS_MEMBER_TEST_PG_HOST: "127.0.0.1", EMPIRE_OS_MEMBER_TEST_PG_PORT: "6543",
    EMPIRE_OS_MEMBER_TEST_PG_DATABASE: database, EMPIRE_OS_MEMBER_TEST_PG_USER: "test_owner",
    EMPIRE_OS_MEMBER_TEST_PG_CONFIRM: `${database}:${DISPOSABLE_MARKER}`,
    EMPIRE_OS_MEMBER_TEST_PG_ATTESTATION_FILE: "/independent/receipt.json",
    EMPIRE_OS_MEMBER_TEST_PG_ATTESTOR_PUBLIC_KEY_FILE: "/reviewer/trusted-public-key.pem",
  };
}
function configured() {
  const result = memberAuthorityDisposableConfig(environment());
  if (result.status !== "configured") throw new Error("Expected synthetic configuration.");
  return result.config;
}
function proof(): MemberClusterAttestation {
  return {
    version: 1, purpose: "empire-os-member-authority-pg16", runId, host: "127.0.0.1", port: 6543,
    database, databaseOid: "16384", owner: "test_owner", systemIdentifier: "1234567890123456789",
    clusterCreatedAtMs: now - 2000, databaseCreatedAtMs: now - 1000,
    isolatedNewCluster: true, neverPreviouslyAttempted: true,
  };
}
function receipt(value: unknown = proof()) {
  const payload = JSON.stringify(value);
  return { payload, signature: sign(null, Buffer.from(payload), keys.privateKey).toString("base64") };
}
function identity(): MemberDatabaseIdentity {
  return {
    database, database_oid: "16384", owner: "test_owner", principal: "test_owner", session_principal: "test_owner",
    system_identifier: "1234567890123456789", version: "160006", recovery: false, read_only: "off",
    superuser: true, clean_cluster: true, marker: DISPOSABLE_MARKER,
  };
}

describe("member disposable configuration and independent attestation (offline only)", () => {
  it("skips with no dedicated variables, ignoring general connection settings", () => {
    expect(memberAuthorityDisposableConfig({ DATABASE_URL: "unused", PGDATABASE: "unused" })).toEqual({ status: "skip" });
  });
  it("requires every non-secret dedicated setting and never silently skips partial setup", () => {
    for (const key of Object.keys(environment())) {
      const env = environment();
      delete env[key];
      expect(() => memberAuthorityDisposableConfig(env)).toThrow();
    }
    expect(() => memberAuthorityDisposableConfig({ EMPIRE_OS_MEMBER_TEST_PG_PASSWORD: "unused" })).toThrow();
  });
  it.each([
    { EMPIRE_OS_MEMBER_TEST_PG_HOST: "localhost" },
    { EMPIRE_OS_MEMBER_TEST_PG_HOST: "remote.invalid" },
    { EMPIRE_OS_MEMBER_TEST_PG_DATABASE: "empire_os_test_identity_old" },
    { EMPIRE_OS_MEMBER_TEST_PG_PORT: "0" },
    { EMPIRE_OS_MEMBER_TEST_PG_CONFIRM: "wrong" },
    { EMPIRE_OS_MEMBER_TEST_PG_ATTESTATION_FILE: "relative.json" },
    { EMPIRE_OS_MEMBER_TEST_PG_ATTESTOR_PUBLIC_KEY_FILE: "/independent/receipt.json" },
  ])("rejects unsafe/incomplete dedicated input: %j", change => {
    expect(() => memberAuthorityDisposableConfig({ ...environment(), ...change })).toThrow();
  });
  it("rejects another suite's database or cluster endpoint", () => {
    expect(() => memberAuthorityDisposableConfig({ ...environment(), EMPIRE_OS_IDENTITY_TEST_PG_DATABASE: database })).toThrow();
    expect(() => memberAuthorityDisposableConfig({
      ...environment(), EMPIRE_OS_AUTH_TEST_PG_HOST: "127.0.0.1", EMPIRE_OS_AUTH_TEST_PG_PORT: "6543",
    })).toThrow();
  });
  it("accepts a signed, exact-scope recent independent receipt", () => {
    const verified = verifyMemberClusterAttestation(configured(), receipt(), publicKey, now);
    expect(verified).toEqual(proof());
    expect(Object.isFrozen(verified)).toBe(true);
  });
  it("rejects a different signing authority, tampering, unsigned data and a key embedded in the receipt", () => {
    const other = generateKeyPairSync("ed25519").publicKey.export({ format: "pem", type: "spki" }).toString();
    expect(() => verifyMemberClusterAttestation(configured(), receipt(), other, now)).toThrow();
    expect(() => verifyMemberClusterAttestation(configured(), { ...receipt(), payload: "{}" }, publicKey, now)).toThrow();
    expect(() => verifyMemberClusterAttestation(configured(), proof(), publicKey, now)).toThrow();
    expect(() => verifyMemberClusterAttestation(configured(), { ...receipt(), publicKey }, publicKey, now)).toThrow();
  });
  it.each([
    { purpose: "other-suite" }, { database: "empire_os_test_identity_old" }, { runId: "b".repeat(32) },
    { owner: "other" }, { host: "::1" }, { port: 5432 }, { databaseOid: "" }, { systemIdentifier: "not-id" },
    { isolatedNewCluster: false }, { neverPreviouslyAttempted: false }, { clusterCreatedAtMs: now + 1 },
    { databaseCreatedAtMs: now + 1 }, { clusterCreatedAtMs: now - MEMBER_ATTESTATION_MAX_AGE_MS - 1 },
    { databaseCreatedAtMs: now - 3000 }, { unexpected: true },
  ])("rejects even signed receipts with invalid or stale assertions: %j", change => {
    expect(() => verifyMemberClusterAttestation(configured(), receipt({ ...proof(), ...change }), publicKey, now)).toThrow();
  });
  it.each([
    { database: "postgres" }, { database_oid: "16385" }, { owner: "other" }, { principal: "other" },
    { session_principal: "other" }, { system_identifier: "999" }, { version: "150010" }, { version: "170001" },
    { recovery: true }, { read_only: "on" }, { superuser: false }, { clean_cluster: false },
    { marker: null }, { marker: MEMBER_CONSUMED_MARKER },
  ])("rejects mismatched live cluster/database identity: %j", change => {
    expect(() => verifyMemberDatabaseIdentity(proof(), { ...identity(), ...change })).toThrow();
  });
  it("permits follow-up fixture connections only after consumption, without demanding an empty cluster again", () => {
    expect(() => verifyMemberDatabaseIdentity(proof(), identity())).not.toThrow();
    expect(() => verifyMemberDatabaseIdentity(proof(), identity(), "consumed")).toThrow();
    expect(() => verifyMemberDatabaseIdentity(proof(), {
      ...identity(), marker: MEMBER_CONSUMED_MARKER, clean_cluster: false,
    }, "consumed")).not.toThrow();
  });
});
