import "server-only";
import { resolveClerkSession } from "./clerk-session-resolver";
import {
  createDurableServerPersistenceAuthority,
  type DurableServerPersistenceDependencies,
} from "./durable-dataset-repository";

type Infrastructure = Omit<DurableServerPersistenceDependencies, "resolveSession">;

export function createClerkDurableAuthority(infrastructure: Infrastructure) {
  return createDurableServerPersistenceAuthority({
    ...infrastructure,
    resolveSession: resolveClerkSession,
  });
}
