import { describe, expect, it } from "vitest";
import {
  STAGE_IMPORT_V9_DATABASE, STAGE_IMPORT_V9_MARKER, stageImportV9DisposableConfig,
} from "./stage-import-v9-disposable-config";

function environment(database = STAGE_IMPORT_V9_DATABASE) {
  return {
    EMPIRE_OS_STAGE_V9_TEST_PG_HOST: "127.0.0.1",
    EMPIRE_OS_STAGE_V9_TEST_PG_PORT: "55439",
    EMPIRE_OS_STAGE_V9_TEST_PG_DATABASE: database,
    EMPIRE_OS_STAGE_V9_TEST_PG_USER: "empire_os_test_owner",
    EMPIRE_OS_STAGE_V9_TEST_PG_PASSWORD: "test-only",
    EMPIRE_OS_STAGE_V9_TEST_PG_CONFIRM: `${database}:${STAGE_IMPORT_V9_MARKER}`,
  };
}

describe("stage-import v9 PostgreSQL safety configuration (offline)", () => {
  it("skips without dedicated v9 settings and ignores ambient/older database variables", () => {
    expect(stageImportV9DisposableConfig({
      PGDATABASE: "populated", DATABASE_URL: "postgres://unused.invalid/populated",
      EMPIRE_OS_TEST_PG_DATABASE: "empire_os_test_persistence_v1",
      EMPIRE_OS_AUTH_TEST_PG_DATABASE: "empire_os_test_authorization_v8",
    }).status).toBe("skip");
    expect(stageImportV9DisposableConfig(environment()).status).toBe("configured");
  });

  it("accepts only the exact v9 database name and marker", () => {
    expect(() => stageImportV9DisposableConfig(environment("empire_os_test_stage_v8")))
      .toThrow("fixed v9 database");
    expect(() => stageImportV9DisposableConfig({
      ...environment(), EMPIRE_OS_STAGE_V9_TEST_PG_CONFIRM: "empire_os_test_stage_v9:other",
    })).toThrow("fixed v9 database");
  });

  it.each([
    { EMPIRE_OS_STAGE_V9_TEST_PG_HOST: "postgres.internal" },
    { EMPIRE_OS_STAGE_V9_TEST_PG_PORT: undefined },
    { EMPIRE_OS_STAGE_V9_TEST_PG_PASSWORD: "" },
    { EMPIRE_OS_STAGE_V9_TEST_PG_CONFIRM: "" },
  ])("rejects partial or non-loopback configuration before connection: %j", (changes) => {
    expect(() => stageImportV9DisposableConfig({ ...environment(), ...changes })).toThrow("Unsafe/incomplete");
  });

  it("refuses any alias configuration that points to the dedicated v9 database", () => {
    expect(() => stageImportV9DisposableConfig({
      ...environment(), EMPIRE_OS_TEST_PG_DATABASE: STAGE_IMPORT_V9_DATABASE,
    })).toThrow("not configured for any earlier integration suite");
  });
});
