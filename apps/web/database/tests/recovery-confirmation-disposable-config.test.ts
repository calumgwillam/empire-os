import { describe, expect, it } from "vitest";
import {
  RECOVERY_CONFIRMATION_DISPOSABLE_MARKER,
  recoveryConfirmationDisposableConfig,
  verifyRecoveryConfirmationDatabaseIdentity,
  type RecoveryConfirmationDatabaseIdentity,
} from "./recovery-confirmation-disposable-config";

function environment() {
  return {
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_HOST: "127.0.0.1",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_PORT: "55440",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_DATABASE: "empire_os_test_recovery_0123456789abcdef0123456789abcdef",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_USER: "empire_os_recovery_fixture_owner",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_PASSWORD: "fixture-only",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_FIXTURE_ID: "0123456789abcdef0123456789abcdef",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_CLUSTER_DIRECTORY:
      "/private/tmp/empire-os-recovery-0123456789abcdef0123456789abcdef",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_CLUSTER_SYSTEM_IDENTIFIER: "7560000000000000001",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_CONFIRM:
      `empire_os_test_recovery_0123456789abcdef0123456789abcdef:${RECOVERY_CONFIRMATION_DISPOSABLE_MARKER}:0123456789abcdef0123456789abcdef`,
  };
}

describe("recovery confirmation disposable PostgreSQL configuration (no database)", () => {
  it("skips only when all dedicated fixture settings are absent", () => {
    expect(recoveryConfirmationDisposableConfig({})).toMatchObject({ status: "skip" });
  });

  it("does not fall back to any shared or production database configuration", () => {
    expect(recoveryConfirmationDisposableConfig({ DATABASE_URL: "redacted", PGDATABASE: "production" }).status)
      .toBe("skip");
  });

  it.each([
    { EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_HOST: "database.example" },
    { EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_DATABASE: "empire_os_test_stage_v9_20261013_1754" },
    {
      EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_DATABASE: "empire_os_test_recovery_0123456789abcdef0123456789abcdef",
      EMPIRE_OS_TEST_PG_DATABASE: "empire_os_test_recovery_0123456789abcdef0123456789abcdef",
    },
    { EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_PASSWORD: "" },
    { EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_CONFIRM: "" },
    { EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_PORT: "55432" },
    { EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_PORT: "55439" },
    { EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_PORT: " 55439 " },
    { EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_FIXTURE_ID: "not-a-fresh-id" },
    { EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_CLUSTER_DIRECTORY: undefined },
    { EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_CLUSTER_DIRECTORY: "relative/cluster" },
    { EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_CLUSTER_DIRECTORY: "/private/tmp/stage-v9" },
    { EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_CLUSTER_SYSTEM_IDENTIFIER: undefined },
    { EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_CLUSTER_SYSTEM_IDENTIFIER: "0" },
    { EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_CLUSTER_SYSTEM_IDENTIFIER: "18446744073709551616" },
  ])("rejects unsafe or shared fixture settings: %j", (change) => {
    expect(() => recoveryConfirmationDisposableConfig({ ...environment(), ...change })).toThrow();
  });

  it("requires the independently verified database comment and connection identity", () => {
    const configured = recoveryConfirmationDisposableConfig(environment());
    if (configured.status !== "configured") throw new Error("Expected a configured fixture.");
    const identity: RecoveryConfirmationDatabaseIdentity = {
      database: configured.config.database,
      principal: configured.config.user,
      login: configured.config.user,
      marker: `${configured.config.database}:${RECOVERY_CONFIRMATION_DISPOSABLE_MARKER}:${configured.config.fixtureId}`,
      recovery: false,
      superuser: true,
      server_address: configured.config.host,
      server_port: configured.config.port,
      cluster_directory: configured.config.clusterDirectory,
      system_identifier: configured.config.clusterSystemIdentifier,
      version: "160013",
      isolated_databases: true,
      isolated_roles: true,
      exclusive_session: true,
    };
    expect(() => verifyRecoveryConfirmationDatabaseIdentity(configured.config, identity)).not.toThrow();
    const mismatches: Partial<RecoveryConfirmationDatabaseIdentity>[] = [
      { database: "empire_os_test_stage_v9_20261013_1754" },
      { principal: "another_owner" }, { login: "another_login" },
      { marker: null }, { marker: `${identity.marker}:spent` }, { recovery: true },
      { superuser: false }, { server_address: "::1" }, { server_port: 55432 }, { server_port: 55439 },
      { cluster_directory: "/private/tmp/stage-v9" }, { system_identifier: "7560000000000000002" },
      { version: "170001" }, { isolated_databases: false }, { isolated_roles: false },
      { exclusive_session: false },
    ];
    for (const mismatch of mismatches) {
      expect(() => verifyRecoveryConfirmationDatabaseIdentity(configured.config, { ...identity, ...mismatch }))
        .toThrow("identity check failed");
    }
    expect(() => verifyRecoveryConfirmationDatabaseIdentity({ ...configured.config }, identity))
      .toThrow("unchanged validated");
    expect(Object.isFrozen(configured.config)).toBe(true);
  });
});
