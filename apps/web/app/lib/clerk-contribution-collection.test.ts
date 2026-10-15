import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./clerk-session-resolver", () => ({ resolveClerkSession: vi.fn() }));
vi.mock("./contribution-collection-workflow", () => ({ createContributionCollectionPreviewAuthority: vi.fn() }));
import { resolveClerkSession } from "./clerk-session-resolver";
import { createContributionCollectionPreviewAuthority } from "./contribution-collection-workflow";
import { createClerkContributionCollectionPreview } from "./clerk-contribution-collection";

describe("inactive Clerk contribution preview composition", () => {
  it("cannot replace the verified Clerk resolver through infrastructure overrides", () => {
    const observe = vi.fn();
    const infrastructure = { observe, resolveSession: vi.fn() };
    createClerkContributionCollectionPreview(infrastructure);
    expect(createContributionCollectionPreviewAuthority).toHaveBeenCalledWith({ observe, resolveSession: resolveClerkSession });
  });
});
