import "server-only";
import { constants } from "node:fs";
import { lstat, opendir, open, realpath, link, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import type { ServerRecoveryArchive } from "./server-recovery-backup";

const KEY = /^empire-os-server-v1-[a-f0-9]{64}-[1-9][0-9]*-[0-9]+-[0-9]+\.json$/;
const PREFIX = /^empire-os-server-v1-[a-f0-9]{64}-$/;
const MAX_BYTES = 64 * 1024 * 1024;
function code(error: unknown, expected: string): boolean {
  return error instanceof Error && "code" in error && error.code === expected;
}

// Explicit server-owned staging directory only: never created automatically,
// never a browser folder approval or a claim of off-device storage. A crashed
// lease fails closed until an operator reconciles the archive and stale lease.
export async function createFilesystemRecoveryArchive(root: string): Promise<ServerRecoveryArchive> {
  if (!isAbsolute(root)) throw new Error("Recovery archive requires an absolute approved server directory.");
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077) {
    throw new Error("Recovery staging directory must be private and must not be a symlink.");
  }
  const directory = await realpath(root);
  async function syncDirectory() {
    const handle = await open(directory, constants.O_RDONLY);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  function path(key: string) {
    if (!KEY.test(key)) throw new Error("Invalid recovery object key.");
    return join(directory, key);
  }
  return Object.freeze({
    async list(prefix: string) {
      if (!PREFIX.test(prefix)) throw new Error("Invalid recovery namespace.");
      const result: string[] = [];
      const entries = await opendir(directory);
      for await (const entry of entries) {
        if (!entry.name.startsWith(prefix)) continue;
        if (!KEY.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()) throw new Error("Invalid recovery directory entry.");
        result.push(entry.name);
        if (result.length > 32) throw new Error("Recovery archive inspection limit exceeded.");
      }
      return result;
    },
    async read(key: string) {
      const handle = await open(path(key), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("Invalid recovery object size or type.");
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of handle.createReadStream({ autoClose: false })) {
          length += chunk.length;
          if (length > MAX_BYTES) throw new Error("Recovery object grew beyond the inspection limit.");
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString("utf8");
        if (!Buffer.from(text, "utf8").equals(buffer)) throw new Error("Recovery object is not exact UTF-8.");
        return text;
      } finally { await handle.close(); }
    },
    async putIfAbsent(key: string, text: string) {
      const destination = path(key);
      if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("Recovery object exceeds the archive size limit.");
      const temporary = join(directory, `.pending-${randomUUID()}`);
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        try {
          await handle.writeFile(text, "utf8");
          await handle.sync();
        } finally { await handle.close(); }
        try { await link(temporary, destination); } catch (error) {
          if (code(error, "EEXIST")) return "existing";
          throw error;
        }
        await syncDirectory();
        return "created";
      } finally {
        await unlink(temporary);
      }
    },
    async withExclusiveLease<T>(prefix: string, operation: () => Promise<T>): Promise<T> {
      if (!PREFIX.test(prefix)) throw new Error("Invalid recovery lease namespace.");
      const lease = join(directory, `.lease-${prefix}`);
      // Exclusive creation fences independent workers too. Never steal a lock
      // based on a caller timestamp, process ID or an assumed lease timeout.
      const handle = await open(lease, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await handle.writeFile(randomUUID(), "utf8");
        await handle.sync();
        return await operation();
      } finally {
        await handle.close();
        await unlink(lease);
        await syncDirectory();
      }
    },
  });
}
