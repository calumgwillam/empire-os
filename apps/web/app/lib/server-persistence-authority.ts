import { versions } from "node:process";
import {
  validateCommitLookup,
  validateSnapshotRequest,
  validateWriteBatch,
  type PersistenceProblem,
  type ServerPersistenceRepository,
} from "./server-persistence-contract";
import { validateStageImportRequest } from "./server-import-preparation";

if (!versions.node) throw new Error("Server persistence authority requires the Node.js runtime.");

const authenticatedPrincipalBrand: unique symbol = Symbol("authenticated-principal");
const authenticatedPrincipals = new WeakSet<object>();

export type AuthenticatedPrincipal = Readonly<{
  subject: string;
  readonly [authenticatedPrincipalBrand]: true;
}>;

export function isAuthenticatedPrincipal(value: unknown): value is AuthenticatedPrincipal {
  return value !== null && typeof value === "object" && authenticatedPrincipals.has(value);
}

export type ServerSessionResolution =
  | Readonly<{ status: "authenticated"; subject: string }>
  | Readonly<{ status: "unauthenticated" }>;

export type PersistenceCapability = "read" | "write" | "import";

export type ServerPersistenceAuthorityDependencies = Readonly<{
  // This resolver must establish identity from a verified server-side session.
  resolveSession(request: Request): Promise<ServerSessionResolution>;
  authorize(
    principal: AuthenticatedPrincipal,
    datasetId: string,
    capability: PersistenceCapability,
  ): Promise<boolean>;
  // The returned adapter must bind this server-resolved principal to each transaction.
  repositoryForPrincipal(principal: AuthenticatedPrincipal): ServerPersistenceRepository;
}>;

function isValidSubject(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSessionResolution(value: unknown): value is ServerSessionResolution {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  if (session.status === "unauthenticated") return Object.keys(session).length === 1;
  return session.status === "authenticated" && Object.keys(session).length === 2 && isValidSubject(session.subject);
}

function unavailable(
  outcome: "not-submitted" | "unknown",
  message: string,
): Extract<PersistenceProblem, { status: "unavailable" }> {
  return { status: "unavailable", outcome, message };
}

export function createServerPersistenceAuthority(dependencies: ServerPersistenceAuthorityDependencies) {
  async function resolvePrincipal(request: Request): Promise<AuthenticatedPrincipal | PersistenceProblem> {
    let resolution: ServerSessionResolution;
    try {
      resolution = await dependencies.resolveSession(request);
    } catch {
      return unavailable("not-submitted", "Authentication service is unavailable.");
    }
    if (!isSessionResolution(resolution)) {
      return { status: "unauthorized", reason: "authentication-required" };
    }
    if (resolution.status === "unauthenticated") {
      return { status: "unauthorized", reason: "authentication-required" };
    }
    const principal = Object.freeze({ subject: resolution.subject, [authenticatedPrincipalBrand]: true as const });
    authenticatedPrincipals.add(principal);
    return principal;
  }

  async function execute<T>(
    principal: AuthenticatedPrincipal,
    datasetId: string,
    capability: PersistenceCapability,
    operation: (repository: ServerPersistenceRepository) => Promise<T>,
    exceptionResult: (stage: "authorization" | "repository" | "operation") => T | PersistenceProblem,
  ): Promise<T | PersistenceProblem> {
    let authorized: boolean;
    try {
      authorized = await dependencies.authorize(principal, datasetId, capability);
    } catch {
      return exceptionResult("authorization");
    }
    if (authorized !== true) return { status: "unauthorized", reason: "forbidden" };

    let repository: ServerPersistenceRepository;
    try {
      repository = dependencies.repositoryForPrincipal(principal);
    } catch {
      return exceptionResult("repository");
    }
    try {
      return await operation(repository);
    } catch {
      return exceptionResult("operation");
    }
  }

  return Object.freeze({
    async readSnapshot(request: Request, input: unknown) {
      const principal = await resolvePrincipal(request);
      if (!("subject" in principal)) return principal;

      const validated = validateSnapshotRequest(input);
      if (validated.status !== "valid") return validated;
      return execute(principal, validated.value.datasetId, "read",
        (repository) => repository.readSnapshot(validated.value),
        (stage) => unavailable("not-submitted", stage === "authorization"
          ? "Authorization service is unavailable." : "PostgreSQL persistence is unavailable."));
    },

    async writeBatch(request: Request, input: unknown) {
      const principal = await resolvePrincipal(request);
      if (!("subject" in principal)) return principal;

      const validated = validateWriteBatch(input);
      if (validated.status !== "valid") return validated;
      return execute(principal, validated.value.fence.datasetId, "write",
        (repository) => repository.writeBatch(validated.value),
        (stage) => stage === "operation"
          ? unavailable("unknown", "The write outcome could not be confirmed; retry only the exact original request.")
          : unavailable("not-submitted", stage === "authorization"
            ? "Authorization service is unavailable." : "PostgreSQL persistence is unavailable."));
    },

    async lookupCommit(request: Request, input: unknown) {
      const principal = await resolvePrincipal(request);
      if (!("subject" in principal)) return principal;

      const validated = validateCommitLookup(input);
      if (validated.status !== "valid") return validated;
      return execute(principal, validated.value.datasetId, "write",
        (repository) => repository.lookupCommit(validated.value),
        (stage) => unavailable("not-submitted", stage === "authorization"
          ? "Authorization service is unavailable." : "PostgreSQL persistence is unavailable."));
    },

    async stageImport(request: Request, input: unknown) {
      const principal = await resolvePrincipal(request);
      if (!("subject" in principal)) return principal;

      const validated = await validateStageImportRequest(input);
      if (validated.status !== "valid") return validated;
      return execute(principal, validated.value.fence.datasetId, "import",
        (repository) => repository.stageImport(validated.value),
        (stage) => stage === "operation"
          ? unavailable("unknown", "The import outcome could not be confirmed; retry only the exact original request.")
          : unavailable("not-submitted", stage === "authorization"
            ? "Authorization service is unavailable." : "PostgreSQL persistence is unavailable."));
    },
  });
}
