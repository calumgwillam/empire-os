import { describe, expect, it } from "vitest";
import { provisioningDisposableConfig } from "./provisioning-disposable-config";

describe("Provisioning database isolation", () => {
  it("skips when no dedicated configuration exists", () => {
    expect(provisioningDisposableConfig({}).status).toBe("skip");
  });

  it("rejects reuse of the authorization database", () => {
    const env = {
      EMPIRE_OS_PROVISION_TEST_PG_HOST: "127.0.0.1",
      EMPIRE_OS_PROVISION_TEST_PG_PORT: "55432",
      EMPIRE_OS_PROVISION_TEST_PG_DATABASE: "empire_os_provision_test",
      EMPIRE_OS_PROVISION_TEST_PG_USER: "test_owner",
      EMPIRE_OS_PROVISION_TEST_PG_PASSWORD: "test-only",
      EMPIRE_OS_PROVISION_TEST_PG_CONFIRM: "empire_os_provision_test",
      EMPIRE_OS_AUTH_TEST_PG_DATABASE: "empire_os_provision_test",
    };
    expect(() => provisioningDisposableConfig(env)).toThrow();
  });
});
