import { describe, expect, it } from "vitest";
import { resolveVerifiedIdentity } from "./clerk-session-resolver";

describe("Clerk verified identity boundary", () => {
  it("accepts a verified user identity", async () => {
    expect(await resolveVerifiedIdentity(async () => ({
      userId: "user_founder123",
    }))).toEqual({
      status: "authenticated",
      subject: "user_founder123",
    });
  });

  it("denies unauthenticated visitors", async () => {
    expect(await resolveVerifiedIdentity(async () => ({
      userId: null,
    }))).toEqual({ status: "unauthenticated" });
  });

  it("rejects invalid identities", async () => {
    await expect(resolveVerifiedIdentity(async () => ({
      userId: "invalid",
    }))).rejects.toThrow("Invalid Clerk identity");
  });

  it("fails closed when the identity provider is unavailable", async () => {
    expect(await resolveVerifiedIdentity(async () => {
      throw new Error("Authentication unavailable");
    })).toEqual({ status: "unauthenticated" });
  });

  it("rejects missing identity fields", async () => {
    await expect(resolveVerifiedIdentity(async () => (
      {} as { userId: unknown }
    ))).rejects.toThrow("Invalid Clerk identity");
  });
});
