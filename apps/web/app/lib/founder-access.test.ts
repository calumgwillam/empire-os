import { describe, expect, it } from "vitest";
import { isAuthorizedFounder } from "./founder-access";

const founderId = "user_founder123456789";

describe("Founder-only access", () => {
  it("allows the configured founder", () => {
    expect(isAuthorizedFounder(founderId, founderId)).toBe(true);
  });

  it("denies unauthenticated visitors", () => {
    expect(isAuthorizedFounder(null, founderId)).toBe(false);
  });

  it("denies other authenticated users", () => {
    expect(isAuthorizedFounder("user_other123456789", founderId)).toBe(false);
  });

  it("fails closed when founder configuration is missing", () => {
    expect(isAuthorizedFounder(founderId, undefined)).toBe(false);
  });

  it("rejects invalid founder configuration", () => {
    expect(isAuthorizedFounder(founderId, "placeholder")).toBe(false);
  });
});
