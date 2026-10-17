import { mkdtemp, readdir, readFile, rm, chmod, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createFilesystemRecoveryArchive } from "./server-recovery-filesystem";

const prefix = `empire-os-server-v1-${"a".repeat(64)}-`;
const key = `${prefix}1-1-1.json`;
const directories: string[] = [];
async function root() {
  const path = await mkdtemp(join(tmpdir(), "empire-recovery-fixture-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
describe("private server filesystem staging (not a cloud destination)", () => {
  it("publishes complete append-only files, reads them independently and never replaces a prior file", async () => {
    const path = await root();
    const archive = await createFilesystemRecoveryArchive(path);
    expect(await archive.putIfAbsent(key, "original recovery bytes")).toBe("created");
    expect(await archive.putIfAbsent(key, "must not replace")).toBe("existing");
    expect(await archive.read(key)).toBe("original recovery bytes");
    expect(await archive.list(prefix)).toEqual([key]);
    expect(await readdir(path)).toEqual([key]);
  });
  it("refuses a concurrent lease and releases its own lease after a failure", async () => {
    const path = await root();
    const first = await createFilesystemRecoveryArchive(path);
    const second = await createFilesystemRecoveryArchive(path);
    await expect(first.withExclusiveLease(prefix, async () => {
      await expect(second.withExclusiveLease(prefix, async () => "unsafe")).rejects.toThrow();
      throw new Error("Injected execution failure.");
    })).rejects.toThrow("Injected");
    expect(await second.withExclusiveLease(prefix, async () => "recovered")).toBe("recovered");
  });
  it("does not steal an orphaned lease or delete any recovery data", async () => {
    const path = await root();
    await writeFile(join(path, `.lease-${prefix}`), "retained orphaned lease");
    const archive = await createFilesystemRecoveryArchive(path);
    await expect(archive.withExclusiveLease(prefix, async () => "unsafe")).rejects.toThrow();
    expect(await readFile(join(path, `.lease-${prefix}`), "utf8")).toBe("retained orphaned lease");
  });
  it("rejects public directories, path traversal, symlinks and malformed UTF-8", async () => {
    const path = await root();
    await chmod(path, 0o755);
    await expect(createFilesystemRecoveryArchive(path)).rejects.toThrow("private");
    await chmod(path, 0o700);
    const archive = await createFilesystemRecoveryArchive(path);
    await expect(archive.putIfAbsent("../outside.json", "unsafe")).rejects.toThrow("key");
    await writeFile(join(path, "outside"), "preserved");
    await symlink(join(path, "outside"), join(path, key));
    await expect(archive.read(key)).rejects.toThrow();
    await expect(archive.list(prefix)).rejects.toThrow();
    expect(await archive.putIfAbsent(key, "overwrite denied")).toBe("existing");
    expect(await readFile(join(path, "outside"), "utf8")).toBe("preserved");
    const other = `${prefix}1-1-2.json`;
    await writeFile(join(path, other), Buffer.from([0xff, 0xfe]));
    await expect(archive.read(other)).rejects.toThrow("UTF-8");
  });
});
