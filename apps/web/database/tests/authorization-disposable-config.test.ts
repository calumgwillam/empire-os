import { describe, expect, it } from "vitest";
import { authorizationDisposableConfig } from "./authorization-disposable-config";
import { DISPOSABLE_MARKER } from "./disposable-config";

const env = {
  EMPIRE_OS_AUTH_TEST_PG_HOST: "127.0.0.1", EMPIRE_OS_AUTH_TEST_PG_PORT: "5432",
  EMPIRE_OS_AUTH_TEST_PG_DATABASE: "empire_os_test_authority_new", EMPIRE_OS_AUTH_TEST_PG_USER: "test_admin",
  EMPIRE_OS_AUTH_TEST_PG_CONFIRM: `empire_os_test_authority_new:${DISPOSABLE_MARKER}`,
};
describe("independent authorization disposable configuration", () => {
  it("does not fall back to the existing integration database configuration", () => {
    expect(authorizationDisposableConfig({ EMPIRE_OS_TEST_PG_DATABASE: "empire_os_test_populated" }).status).toBe("skip");
  });
  it("requires independent explicit confirmation", () => {
    expect(authorizationDisposableConfig(env).status).toBe("configured");
    expect(() => authorizationDisposableConfig({ ...env, EMPIRE_OS_AUTH_TEST_PG_CONFIRM: "" })).toThrow();
  });
  it("rejects non-loopback hosts and reuse of the old configured database", () => {
    expect(() => authorizationDisposableConfig({ ...env, EMPIRE_OS_AUTH_TEST_PG_HOST: "db.example.invalid" })).toThrow();
    expect(() => authorizationDisposableConfig({ ...env, EMPIRE_OS_TEST_PG_DATABASE: env.EMPIRE_OS_AUTH_TEST_PG_DATABASE })).toThrow();
  });
});
