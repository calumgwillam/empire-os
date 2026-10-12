import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createServerEmployeeProvisioningAuthority } from "./server-employee-provisioning";
import { isAuthenticatedPrincipal, type ServerSessionResolution } from "./server-persistence-authority";
import { employeeProvisioningRelease } from "./employee-provisioning-release";
import { validateEmployeeProvisioningInput } from "./employee-provisioning-contract";

const input = {
  operationId: "provision:one", expectedPolicyRevision: 1,
  subject: "user_employee", roleIds: ["worker"],
};
const request = () => new Request("https://empire-os.invalid/internal", {
  method: "POST",
  headers: { "x-empire-actor": "user_founder", "x-empire-role": "owner", "x-empire-tenant": "foreign" },
});
function harness(session: ServerSessionResolution = { status: "authenticated", subject: "user_verified" }) {
  const sourceForPrincipal = vi.fn(() => ({ connect: vi.fn() }));
  const resolveSession = vi.fn(async () => session);
  return {
    sourceForPrincipal, resolveSession,
    authority: createServerEmployeeProvisioningAuthority({ tenantId: "tenant-a", sourceForPrincipal, resolveSession }),
  };
}

describe("server-only employee provisioning (release disabled)", () => {
  it("blocks migration 005 regardless of authenticated identity, headers or candidate installation", async () => {
    const h = harness();
    expect(employeeProvisioningRelease()).toEqual({ status: "disabled", reason: "migration-005-disabled" });
    expect(await h.authority.provision(request(), input)).toEqual({
      status: "disabled", reason: "migration-005-disabled",
    });
    expect(h.resolveSession).toHaveBeenCalledOnce();
    expect(h.sourceForPrincipal).not.toHaveBeenCalled();
  });

  it("denies unauthenticated callers before inspecting provisioning state or creating a database source", async () => {
    const h = harness({ status: "unauthenticated" });
    expect(await h.authority.provision(request(), input)).toEqual({
      status: "unauthorized", reason: "authentication-required",
    });
    expect(h.sourceForPrincipal).not.toHaveBeenCalled();
  });

  it("reports authentication service failures without leaking provider details", async () => {
    const h = harness();
    h.resolveSession.mockRejectedValue(new Error("private provider credentials"));
    const result = await h.authority.provision(request(), input);
    expect(result).toMatchObject({ status: "unavailable", outcome: "not-submitted" });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(h.sourceForPrincipal).not.toHaveBeenCalled();
  });

  it("fails closed when a resolver returns an invalid session shape", async () => {
    const sourceForPrincipal = vi.fn(() => { throw new Error("must not connect"); });
    const authority = createServerEmployeeProvisioningAuthority({
      tenantId: "tenant-a", sourceForPrincipal,
      resolveSession: async () => ({ status: "authenticated", subject: "user_founder", authorized: true }),
    });
    expect(await authority.provision(request(), input)).toMatchObject({
      status: "unauthorized", reason: "authentication-required",
    });
    expect(sourceForPrincipal).not.toHaveBeenCalled();
  });

  it.each(["actorSubject", "principal", "tenantId", "datasetId", "authorized", "ready", "migrationVersion"])(
    "rejects submitted %s claims instead of silently stripping them", async key => {
      const h = harness();
      expect(await h.authority.provision(request(), { ...input, [key]: "forged" }))
        .toMatchObject({ status: "invalid-request" });
      expect(h.sourceForPrincipal).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...input, subject: "not-clerk" },
    { ...input, expectedPolicyRevision: -1 },
    { ...input, expectedPolicyRevision: 1.5 },
    { ...input, expectedPolicyRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...input, roleIds: ["worker", "worker"] },
    { ...input, roleIds: ["worker", 3] },
    { ...input, roleIds: [" worker"] },
    { ...input, operationId: "bad key" },
    { ...input, command: { kind: "provision-member" } },
  ])("rejects malformed input %j", async malformed => {
    expect(await harness().authority.provision(request(), malformed))
      .toMatchObject({ status: "invalid-request" });
  });

  it("detaches and freezes submitted roles while preserving zero-role memberships", () => {
    const roles = ["worker"];
    const parsed = validateEmployeeProvisioningInput({ ...input, roleIds: roles });
    if (parsed.status !== "valid") throw new Error("Valid input rejected.");
    roles.push("admin");
    expect(parsed.value.roleIds).toEqual(["worker"]);
    expect(Object.isFrozen(parsed.value.roleIds)).toBe(true);
    expect(validateEmployeeProvisioningInput({ ...input, roleIds: [] }).status).toBe("valid");
  });

  it("does not accept plain objects as authenticated principals", () => {
    expect(isAuthenticatedPrincipal({ subject: "user_founder" })).toBe(false);
  });

  it("rejects invalid server tenant configuration", () => {
    expect(() => createServerEmployeeProvisioningAuthority({
      tenantId: "", resolveSession: async () => ({ status: "unauthenticated" }),
      sourceForPrincipal: () => { throw new Error("must not connect"); },
    })).toThrow("Invalid server provisioning tenant.");
  });
});
