import { assertBackupRecoveryReferences } from "./backup";
import { sha256 } from "./independent-backup";
import { readStartupStorage } from "./startup-hydration";
import {
  checkBatchPreconditions, validateSnapshot, validateWriteBatch, writeBatchContent,
  type BatchConflict, type DatasetSnapshot, type PersistenceProblem, type Validation, type WriteBatch,
} from "./server-persistence-contract";

export type PreparedWrite = Readonly<{
  batch: WriteBatch;
  requestSha256: string;
}>;

export async function prepareServerWrite(value: unknown): Promise<Validation<PreparedWrite> | Extract<PersistenceProblem, { status: "failed" }>> {
  const batch = validateWriteBatch(value);
  if (batch.status !== "valid") return batch;
  try {
    const requestSha256 = await sha256(writeBatchContent(batch.value));
    return { status: "valid", value: Object.freeze({ batch: batch.value, requestSha256 }) };
  } catch (error) {
    return { status: "failed", outcome: "not-submitted",
      message: `Write fingerprint could not be established: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// The adapter must call this against locked database rows, not a caller's claimed snapshot.
export function prepareWriteCandidate(value: unknown, observed: unknown): Validation<DatasetSnapshot> | BatchConflict {
  const validatedBatch = validateWriteBatch(value);
  if (validatedBatch.status !== "valid") return validatedBatch;
  const batch = validatedBatch.value;
  const snapshot = validateSnapshot(observed);
  if (snapshot.status !== "valid") return snapshot;
  const conflict = checkBatchPreconditions(batch, snapshot.value);
  if (conflict) return conflict;
  if (snapshot.value.commitSequence === Number.MAX_SAFE_INTEGER) {
    return { status: "invalid-request", message: "Dataset commit sequence cannot be incremented safely." };
  }
  const values = snapshot.value.values.map((entry) => {
    const write = batch.writes.find(({ key }) => key === entry.key);
    return write ? { key: entry.key, rawValue: write.rawValue, revision: write.expectedRevision + 1 } : entry;
  });
  const storage = Object.fromEntries(values.map(({ key, rawValue }) => [key, rawValue]));
  try {
    readStartupStorage({ getItem: (key) => storage[key] });
    assertBackupRecoveryReferences(storage);
  } catch (error) {
    return { status: "invalid-request",
      message: `Candidate business data failed validation: ${error instanceof Error ? error.message : String(error)}` };
  }
  return validateSnapshot({ ...snapshot.value, values, commitSequence: snapshot.value.commitSequence + 1 });
}
