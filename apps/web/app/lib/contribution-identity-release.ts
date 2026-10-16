import "server-only";

// Candidate installation is not release approval. There is no environment override.
export function contributionIdentityRelease(): Readonly<{ status: "disabled" | "approved" }> {
  return Object.freeze({ status: "disabled" });
}
