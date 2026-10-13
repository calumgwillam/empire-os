export const RESTORE_INTERRUPTION_STORAGE_KEY = "empire-os-restore-interruption-v1";

export class BrowserWriteFenceError extends Error {
  readonly reason: "interrupted" | "unavailable";

  constructor(reason: "interrupted" | "unavailable", cause?: unknown) {
    super(reason === "interrupted"
      ? "Browser business-data writes are blocked because a multi-store restore was interrupted."
      : "Browser business-data writes are blocked because restore-interruption state could not be verified.");
    this.name = "BrowserWriteFenceError";
    this.reason = reason;
    if (cause !== undefined) Object.defineProperty(this, "cause", { value: cause });
  }
}

export function assertBrowserBusinessWritesAllowed(
  storage: Pick<Storage, "getItem">,
): void {
  let marker: string | null;
  try {
    marker = storage.getItem(RESTORE_INTERRUPTION_STORAGE_KEY);
  } catch (error) {
    throw new BrowserWriteFenceError("unavailable", error);
  }
  if (marker !== null) throw new BrowserWriteFenceError("interrupted");
}

export function setBrowserBusinessItem(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  value: string,
): void {
  if (key === RESTORE_INTERRUPTION_STORAGE_KEY) throw new BrowserWriteFenceError("interrupted");
  assertBrowserBusinessWritesAllowed(storage);
  storage.setItem(key, value);
}

export function removeBrowserBusinessItem(
  storage: Pick<Storage, "getItem" | "removeItem">,
  key: string,
): void {
  if (key === RESTORE_INTERRUPTION_STORAGE_KEY) throw new BrowserWriteFenceError("interrupted");
  assertBrowserBusinessWritesAllowed(storage);
  storage.removeItem(key);
}
