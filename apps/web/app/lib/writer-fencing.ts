import type { MigrationFence } from "./migration-coordinator";
import type { PersistenceErrorDetails } from "./indexeddb-persistence";

export const WRITER_AUTHORITY_KEY = "empire-os-internal-preparation-writer-authority";
export const PREPARATION_DATABASE_PREFIX = "empire-os-preparation:";

// This fence belongs to the preparation database, not the migration coordinator's independent snapshot fence.
// A future live backend must co-locate its activation authority and write checks in one atomic boundary.
export type WriterAuthority = MigrationFence & {
  version: 1;
  scope: string;
  mode: "denied" | "preparation-only";
};

export type WriterCredential = MigrationFence & {
  // A concurrency credential for participating code, not authentication against same-origin code.
  scope: string;
  mode: "preparation-only";
};

export type WriterDenied = {
  status: "authority-denied";
  reason: "missing-authority" | "invalid-authority" | "stale-credential" | "writers-fenced"
    | "unsupported-storage-mode" | "authority-verification-failed";
  message: string;
};

export type WriterAuthorityResult =
  | { status: "authority-saved"; authority: WriterAuthority }
  | WriterDenied
  | { status: "authority-storage-failed"; error: PersistenceErrorDetails };

export function isFence(value: unknown): value is MigrationFence {
  if (!value || typeof value !== "object") return false;
  return "generation" in value && typeof value.generation === "number"
    && Number.isSafeInteger(value.generation) && value.generation >= 0
    && "revision" in value && typeof value.revision === "number"
    && Number.isSafeInteger(value.revision) && value.revision >= 0;
}

export function decodeWriterAuthority(value: unknown): WriterAuthority | null {
  if (value === undefined) return null;
  if (!isFence(value) || !("version" in value) || value.version !== 1
    || !("scope" in value) || typeof value.scope !== "string" || !value.scope.startsWith(PREPARATION_DATABASE_PREFIX)
    || !("mode" in value) || (value.mode !== "denied" && value.mode !== "preparation-only")) {
    throw new Error("Writer authority is malformed or uses an unsupported storage mode.");
  }
  return { version: 1, generation: value.generation, revision: value.revision, scope: value.scope, mode: value.mode };
}

export function checkWriterAuthority(value: unknown, credential: unknown): WriterDenied | null {
  let authority: WriterAuthority | null;
  try {
    authority = decodeWriterAuthority(value);
  } catch {
    return { status: "authority-denied", reason: "invalid-authority",
      message: "Stored writer authority cannot be verified; writes are disabled." };
  }
  if (!authority) return { status: "authority-denied", reason: "missing-authority",
    message: "No durable writer authority exists; writes are disabled." };
  if (!isFence(credential) || !("scope" in credential) || credential.scope !== authority.scope
    || !("mode" in credential) || credential.mode !== "preparation-only") {
    return { status: "authority-denied", reason: "unsupported-storage-mode",
      message: "Only isolated preparation writes are supported; production activation is unavailable." };
  }
  if (authority.generation !== credential.generation || authority.revision !== credential.revision) {
    return { status: "authority-denied", reason: "stale-credential",
      message: "Writer credential is stale; obtain current authority before retrying." };
  }
  if (authority.mode !== "preparation-only") return { status: "authority-denied", reason: "writers-fenced",
    message: "Participating writers have been fenced off." };
  return null;
}
