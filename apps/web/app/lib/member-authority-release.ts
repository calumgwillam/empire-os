import "server-only";

// Candidate installation is not release approval. No caller/environment override.
export function memberAuthorityRelease(): Readonly<{ status: "disabled" | "approved" }> {
  return Object.freeze({ status: "disabled" });
}
