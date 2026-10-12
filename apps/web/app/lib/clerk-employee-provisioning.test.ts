import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./clerk-session-resolver", () => ({ resolveClerkSession: vi.fn() }));
vi.mock("./server-employee-provisioning", () => ({ createServerEmployeeProvisioningAuthority: vi.fn() }));
import { resolveClerkSession } from "./clerk-session-resolver";
import { createServerEmployeeProvisioningAuthority } from "./server-employee-provisioning";
import { createClerkEmployeeProvisioningAuthority } from "./clerk-employee-provisioning";

describe("Clerk employee provisioning composition (not routed)", () => {
  it("always supplies the verified Clerk resolver, even if runtime infrastructure contains an override", () => {
    const sourceForPrincipal = vi.fn();
    const infrastructure = { tenantId: "tenant-a", sourceForPrincipal, resolveSession: vi.fn() };
    createClerkEmployeeProvisioningAuthority(infrastructure);
    expect(createServerEmployeeProvisioningAuthority).toHaveBeenCalledWith({
      tenantId: "tenant-a", sourceForPrincipal, resolveSession: resolveClerkSession,
    });
  });
});
