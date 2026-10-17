import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./clerk-session-resolver", () => ({ resolveClerkSession: vi.fn() }));
import { resolveClerkSession } from "./clerk-session-resolver";
import { createServerRecoveryBackup } from "./server-recovery-backup";

describe("real server recovery source interlock", () => {
  it("refuses an authenticated Clerk identity while independent Person authority is unresolved, without constructing a database", async () => {
    vi.mocked(resolveClerkSession).mockResolvedValue({ status: "authenticated", subject: "user_fixture" });
    const sourceForPrincipal = vi.fn(() => { throw new Error("No database connection is approved."); });
    const list = vi.fn(async () => []);
    const service = createServerRecoveryBackup({
      tenantId: "tenant-fixture", datasetId: "00000000-0000-4000-8000-000000000001",
      sourceForPrincipal, repositoryForExecution: () => { throw new Error("No repository is approved."); },
      alert: vi.fn(async () => {}),
      archive: { list, read: vi.fn(), putIfAbsent: vi.fn(),
        withExclusiveLease: async (_prefix, operation) => operation() },
    });
    const result = await service.capture(new Request("https://empire.invalid/internal"));
    expect(result).toMatchObject({ status: "unavailable", outcome: "not-submitted",
      message: expect.stringContaining("Trusted Person authority source is unresolved") });
    expect(sourceForPrincipal).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});
