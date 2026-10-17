import { describe, expect, it } from "vitest";
import { types } from "pg";
import { DISPOSABLE_MARKER } from "./disposable-config";
import {
  MEMBER_CONSUMED_MARKER, memberAuthorityDisposableConfig, verifyMemberProvisioningIdentity, verifyMemberDatabaseIdentity,
  type MemberProvisioningIdentity, type MemberDatabaseIdentity,
} from "./member-authority-disposable-config";

const runId = "a".repeat(32);
const database = `empire_os_test_member_${runId}`;
const now = 100000000;
function environment(): Record<string, string> {
  return {
    EMPIRE_OS_MEMBER_TEST_PG_HOST: "127.0.0.1", EMPIRE_OS_MEMBER_TEST_PG_PORT: "6543",
    EMPIRE_OS_MEMBER_TEST_PG_DATABASE: database, EMPIRE_OS_MEMBER_TEST_PG_USER: "test_owner",
    EMPIRE_OS_MEMBER_TEST_PG_CONFIRM: `${database}:${DISPOSABLE_MARKER}`,
    EMPIRE_OS_MEMBER_TEST_PG_IDENTITY_MANIFEST_FILE: "/independent/identity.json",
  };
}
function configured() {
  const result = memberAuthorityDisposableConfig(environment());
  if (result.status !== "configured") throw new Error("Expected synthetic configuration.");
  return result.config;
}
function proof(): MemberProvisioningIdentity {
  return {
    version: 1, purpose: "empire-os-member-authority-pg16", runId, host: "127.0.0.1", port: 6543,
    database, databaseOid: "16384", owner: "test_owner", systemIdentifier: "1234567890123456789",
    dataDirectory: "/independent/pgdata", postmasterPid: 1234, postmasterStartedAtSeconds: 99998,
    clusterCreatedAtMs: now - 2000, databaseCreatedAtMs: now - 1000,
    isolatedNewCluster: true, neverPreviouslyAttempted: true,
  };
}
function identity(): MemberDatabaseIdentity {
  return {
    database, database_oid: "16384", owner: "test_owner", principal: "test_owner", session_principal: "test_owner",
    system_identifier: "1234567890123456789", version: "160006", recovery: false, read_only: "off",
    superuser: true, clean_cluster: true, marker: DISPOSABLE_MARKER,
    data_directory: "/independent/pgdata", server_port: 6543, server_address: "127.0.0.1", postmaster_started_at: "99998",
  };
}

describe("member disposable configuration and local provisioning identity (offline only)", () => {
  it("skips without dedicated variables and ignores ambient connection settings", () => {
    expect(memberAuthorityDisposableConfig({ DATABASE_URL: "unused", PGDATABASE: "unused" })).toEqual({ status: "skip" });
  });
  it("requires every non-secret dedicated setting and rejects partial setup", () => {
    for (const key of Object.keys(environment())) {
      const env = environment();
      delete env[key];
      expect(() => memberAuthorityDisposableConfig(env)).toThrow();
    }
    expect(() => memberAuthorityDisposableConfig({ EMPIRE_OS_MEMBER_TEST_PG_PASSWORD: "unused" })).toThrow();
  });
  it.each([
    { EMPIRE_OS_MEMBER_TEST_PG_HOST: "localhost" }, { EMPIRE_OS_MEMBER_TEST_PG_HOST: "remote.invalid" },
    { EMPIRE_OS_MEMBER_TEST_PG_DATABASE: "empire_os_test_identity_old" },
    { EMPIRE_OS_MEMBER_TEST_PG_PORT: "0" }, { EMPIRE_OS_MEMBER_TEST_PG_CONFIRM: "wrong" },
    { EMPIRE_OS_MEMBER_TEST_PG_IDENTITY_MANIFEST_FILE: "relative.json" },
    { EMPIRE_OS_MEMBER_TEST_PG_ATTESTATION_FILE: "/old/receipt.json" },
    { EMPIRE_OS_MEMBER_TEST_PG_ATTESTOR_PUBLIC_KEY_FILE: "/old/key.pem" },
  ])("rejects unsafe or legacy configuration: %j", change => {
    expect(() => memberAuthorityDisposableConfig({ ...environment(), ...change })).toThrow();
  });
  it("rejects another suite's database or loopback cluster port, including IPv6 aliases", () => {
    expect(() => memberAuthorityDisposableConfig({ ...environment(), EMPIRE_OS_IDENTITY_TEST_PG_DATABASE: database })).toThrow();
    for (const host of ["127.0.0.1", "::1"]) {
      expect(() => memberAuthorityDisposableConfig({
        ...environment(), EMPIRE_OS_AUTH_TEST_PG_HOST: host, EMPIRE_OS_AUTH_TEST_PG_PORT: "6543",
      })).toThrow();
    }
  });
  it("accepts exact independently recorded identity without signing keys or arbitrary receipt expiry", () => {
    expect(verifyMemberProvisioningIdentity(configured(), proof(), now)).toEqual(proof());
    expect(Object.isFrozen(verifyMemberProvisioningIdentity(configured(), proof(), now))).toBe(true);
    expect(() => verifyMemberProvisioningIdentity(configured(), proof(), now + 172800000)).not.toThrow();
  });
  it("accepts a restart after database creation before the first attempt", () => {
    const restarted = { ...proof(), postmasterPid: 5678, postmasterStartedAtSeconds: 100000 };
    expect(verifyMemberProvisioningIdentity(configured(), restarted, now)).toEqual(restarted);
    expect(() => verifyMemberDatabaseIdentity(restarted, {
      ...identity(), postmaster_started_at: "100000",
    })).not.toThrow();
  });
  it("preserves second-resolution startup bounds without imposing database creation ordering", () => {
    expect(() => verifyMemberProvisioningIdentity(configured(), {
      ...proof(), clusterCreatedAtMs: 99998999,
    }, now)).not.toThrow();
    expect(() => verifyMemberProvisioningIdentity(configured(), {
      ...proof(), postmasterStartedAtSeconds: 99997,
    }, now)).toThrow();
    expect(() => verifyMemberProvisioningIdentity(configured(), {
      ...proof(), postmasterStartedAtSeconds: 100001,
    }, now + 999)).toThrow();
  });
  it.each([
    { purpose: "other-suite" }, { database: "empire_os_test_identity_old" }, { runId: "b".repeat(32) },
    { owner: "other" }, { host: "::1" }, { port: 5432 }, { databaseOid: "" }, { systemIdentifier: "not-id" },
    { dataDirectory: "/" }, { dataDirectory: "relative" }, { dataDirectory: "/tmp/../existing" },
    { postmasterPid: 0 }, { postmasterPid: 2147483648 }, { postmasterStartedAtSeconds: 0 },
    { postmasterStartedAtSeconds: 100001 }, { postmasterStartedAtSeconds: Number.MAX_SAFE_INTEGER },
    { isolatedNewCluster: false }, { neverPreviouslyAttempted: false }, { clusterCreatedAtMs: now + 1 },
    { databaseCreatedAtMs: now + 1 }, { databaseCreatedAtMs: now - 3000 }, { unexpected: true },
  ])("rejects invalid independent manifests: %j", change => {
    expect(() => verifyMemberProvisioningIdentity(configured(), { ...proof(), ...change }, now)).toThrow();
  });
  it("does not accept the old signed-envelope shape", () => {
    expect(() => verifyMemberProvisioningIdentity(configured(), { payload: JSON.stringify(proof()), signature: "unused" }, now)).toThrow();
  });
  it.each([
    ["127.0.0.1", "127.0.0.1/32"],
    ["::1", "::1/128"],
  ])("reproduces inet-to-text rejection for %s with PostgreSQL 16.11 driver types", (host, network) => {
    const text = types.getTypeParser(types.builtins.TEXT, "text");
    const integer = types.getTypeParser(types.builtins.INT4, "text");
    const boolean = types.getTypeParser(types.builtins.BOOL, "text");
    const decoded: MemberDatabaseIdentity = {
      ...identity(),
      database_oid: text("16384"), system_identifier: text(proof().systemIdentifier),
      version: text("160011"), postmaster_started_at: text("99998"),
      server_port: integer("6543"), server_address: text(network),
      recovery: boolean("f"), superuser: boolean("t"), clean_cluster: boolean("t"),
    };
    expect(decoded.version).toBe("160011");
    expect(decoded.server_port).toBe(6543);
    expect(decoded.recovery).toBe(false);
    expect(decoded.superuser).toBe(true);
    expect(decoded.clean_cluster).toBe(true);
    const expected = { ...proof(), host };
    expect(() => verifyMemberDatabaseIdentity(expected, decoded)).toThrow();
    expect(() => verifyMemberDatabaseIdentity(expected, {
      ...decoded, server_address: text(host),
    })).not.toThrow();
    expect(() => verifyMemberDatabaseIdentity(expected, {
      ...decoded, server_address: text(host), marker: MEMBER_CONSUMED_MARKER,
    })).toThrow();
  });
  it.each([
    { database: "postgres" }, { database_oid: "16385" }, { owner: "other" }, { principal: "other" },
    { session_principal: "other" }, { system_identifier: "999" }, { version: "150010" }, { version: "170001" },
    { version: "16.11" }, { version: "160011 " },
    { recovery: true }, { read_only: "on" }, { superuser: false }, { clean_cluster: false },
    { marker: null }, { marker: MEMBER_CONSUMED_MARKER }, { data_directory: "/existing/pgdata" },
    { server_port: 5432 }, { server_address: "::1" }, { postmaster_started_at: "99999" },
  ])("rejects mismatched live cluster/database identity: %j", change => {
    expect(() => verifyMemberDatabaseIdentity(proof(), { ...identity(), ...change })).toThrow();
  });
  it("requires consumption on follow-up connections, preserving all other identity checks", () => {
    expect(() => verifyMemberDatabaseIdentity(proof(), identity())).not.toThrow();
    expect(() => verifyMemberDatabaseIdentity(proof(), identity(), "consumed")).toThrow();
    expect(() => verifyMemberDatabaseIdentity(proof(), {
      ...identity(), marker: MEMBER_CONSUMED_MARKER, clean_cluster: false,
    }, "consumed")).not.toThrow();
  });
  it("does not let a restart or a never-attempted manifest override consumption", () => {
    const restarted = { ...proof(), postmasterPid: 5678, postmasterStartedAtSeconds: 100000 };
    const consumed = { ...identity(), postmaster_started_at: "100000", marker: MEMBER_CONSUMED_MARKER };
    expect(() => verifyMemberDatabaseIdentity(restarted, consumed)).toThrow();
    expect(() => verifyMemberDatabaseIdentity(restarted, consumed, "consumed")).not.toThrow();
    expect(() => verifyMemberDatabaseIdentity(restarted, {
      ...consumed, database_oid: "16385",
    }, "consumed")).toThrow();
  });
});
