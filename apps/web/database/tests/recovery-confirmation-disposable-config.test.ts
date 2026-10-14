import { describe, expect, it } from "vitest";
import {
  RECOVERY_CONFIRMATION_DISPOSABLE_MARKER,
  recoveryConfirmationDisposableConfig,
  verifyRecoveryConfirmationDatabaseIdentity,
} from "./recovery-confirmation-disposable-config";

function environment() {
  return {
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_HOST: "127.0.0.1",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_PORT: "5432",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_DATABASE: "empire_os_test_recovery_0123456789abcdef0123456789abcdef",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_USER: "empire_os_recovery_fixture_owner",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_PASSWORD: "fixture-only",
    EMPIRE_OS_RECOVERY_CONFIRM_TEST_PG_FIXTURE_ID: "0123456789abcdef0123456789abcdef",
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
  ])("rejects unsafe or shared fixture settings: %j", (change) => {
    expect(() => recoveryConfirmationDisposableConfig({ ...environment(), ...change })).toThrow();
  });

  it("requires the independently verified database comment and connection identity", () => {
    const configured = recoveryConfirmationDisposableConfig(environment());
    if (configured.status !== "configured") throw new Error("Expected a configured fixture.");
    const identity = {
      database: configured.config.database,
      principal: configured.config.user,
      marker: `${configured.config.database}:${RECOVERY_CONFIRMATION_DISPOSABLE_MARKER}:${configured.config.fixtureId}`,
      recovery: false,
    };
    expect(() => verifyRecoveryConfirmationDatabaseIdentity(configured.config, identity)).not.toThrow();
    expect(() => verifyRecoveryConfirmationDatabaseIdentity(configured.config, { ...identity, marker: null }))
      .toThrow("identity check failed");
  });
});
