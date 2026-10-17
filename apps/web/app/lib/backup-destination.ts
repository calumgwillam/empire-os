import { isBackupDirectory, type BackupDirectory } from "./file-backup";

const DATABASE = "empire-os-backup-destination-v1";
const STORE = "approved-directory";
const KEY = "directory";

// Only an explicitly approved browser file-system handle is persisted here.
// No business stores, credentials, directory contents or release state are copied.
export async function openBackupDestination(factory: Pick<IDBFactory, "open"> = indexedDB) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DATABASE, 1);
    let abandoned = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onblocked = () => { abandoned = true; reject(new Error("Backup folder settings are blocked by another browser tab.")); };
    request.onerror = () => reject(new Error("Backup folder settings could not be opened."));
    request.onsuccess = () => {
      if (abandoned) request.result.close();
      else resolve(request.result);
    };
  });
  database.onversionchange = () => database.close();

  async function load(): Promise<BackupDirectory | null> {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(KEY);
      let value: unknown;
      request.onsuccess = () => { value = request.result; };
      transaction.oncomplete = () => {
        if (value === undefined) resolve(null);
        else if (isBackupDirectory(value)) resolve(value);
        else reject(new Error("Stored backup folder approval is malformed; select the folder again."));
      };
      transaction.onerror = () => reject(new Error("Backup folder approval could not be read."));
      transaction.onabort = () => reject(new Error("Backup folder approval read was aborted."));
    });
  }
  return Object.freeze({
    load,
    async forget(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).delete(KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new Error("Backup folder approval could not be removed."));
        transaction.onabort = () => reject(new Error("Removing backup folder approval was aborted."));
      });
      if (await load() !== null) throw new Error("Removing backup folder approval could not be verified.");
    },
    async save(directory: BackupDirectory): Promise<void> {
      if (!isBackupDirectory(directory) || await directory.queryPermission({ mode: "readwrite" }) !== "granted") {
        throw new Error("A user-approved writable backup folder is required.");
      }
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).put(directory, KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new Error("Backup folder approval could not be saved."));
        transaction.onabort = () => reject(new Error("Backup folder approval save was aborted."));
      });
      const saved = await load();
      if (!saved || !await directory.isSameEntry(saved)) throw new Error("Saved backup folder approval could not be verified.");
    },
    close: () => database.close(),
  });
}
