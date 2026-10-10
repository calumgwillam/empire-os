import {
  IndexedDbPersistenceRepository, type BusinessStorageKey, type StorageWrite,
} from "./indexeddb-persistence";
import type { MigrationFence } from "./migration-coordinator";
import { PREPARATION_DATABASE_PREFIX, type WriterAuthority, type WriterCredential } from "./writer-fencing";

// This opt-in facade does not expose unguarded writes or imports.
// The original Phase 1 repository remains a preparation primitive, not a production authority boundary.
export class PreparationWriterRepository {
  private readonly repository: IndexedDbPersistenceRepository;

  constructor(factory: Pick<IDBFactory, "open">, scope: string) {
    if (!scope.trim()) throw new Error("An isolated preparation scope is required.");
    this.repository = new IndexedDbPersistenceRepository(factory, `${PREPARATION_DATABASE_PREFIX}${scope}`);
  }

  read(keys: readonly BusinessStorageKey[]) {
    return this.repository.read(keys);
  }

  write(updates: readonly StorageWrite[], credential: WriterCredential) {
    return this.repository.writeWithAuthority(updates, credential);
  }

  changeAuthority(expected: MigrationFence, mode: WriterAuthority["mode"]) {
    return this.repository.updatePreparationAuthority(expected, mode);
  }
}
