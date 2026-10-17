export const AUTOMATIC_BACKUP_INTERVAL_MS = 60_000;
export const AUTOMATIC_BACKUP_SETTLE_MS = 2000;

export function startAutomaticBackupSchedule(check: () => void, environment: Readonly<{
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number): void;
  setInterval(callback: () => void, delay: number): number;
  clearInterval(id: number): void;
  windowEvents: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  documentEvents: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  visible(): boolean;
}>) {
  let stopped = false;
  let pending: number | undefined;
  const run = () => { if (!stopped) check(); };
  const returned = () => { if (environment.visible()) run(); };
  const interval = environment.setInterval(run, AUTOMATIC_BACKUP_INTERVAL_MS);
  environment.windowEvents.addEventListener("focus", returned);
  environment.windowEvents.addEventListener("storage", returned);
  environment.documentEvents.addEventListener("visibilitychange", returned);
  run();
  return Object.freeze({
    changed() {
      if (stopped) return;
      if (pending !== undefined) environment.clearTimeout(pending);
      pending = environment.setTimeout(() => { pending = undefined; run(); }, AUTOMATIC_BACKUP_SETTLE_MS);
    },
    stop() {
      stopped = true;
      environment.clearInterval(interval);
      if (pending !== undefined) environment.clearTimeout(pending);
      environment.windowEvents.removeEventListener("focus", returned);
      environment.windowEvents.removeEventListener("storage", returned);
      environment.documentEvents.removeEventListener("visibilitychange", returned);
    },
  });
}
