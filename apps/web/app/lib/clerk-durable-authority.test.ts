import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./clerk-session-resolver", () => ({
  resolveClerkSession: vi.fn(),
}));
vi.mock("./durable-dataset-repository", () => ({
  createDurableServerPersistenceAuthority: vi.fn(),
}));

import { resolveClerkSession } from "./clerk-session-resolver";
import { createDurableServerPersistenceAuthority } from "./durable-dataset-repository";
import { createClerkDurableAuthority } from "./clerk-durable-authority";

describe("Clerk durable authority integration", () => {
  it("preserves tenant, restricted source and verified identity", () => {
    const sourceForPrincipal = vi.fn();
    createClerkDurableAuthority({
      tenantId: "tenant-a",
      sourceForPrincipal,
    });

    expect(createDurableServerPersistenceAuthority).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      sourceForPrincipal,
      resolveSession: resolveClerkSession,
    });
  });
});
