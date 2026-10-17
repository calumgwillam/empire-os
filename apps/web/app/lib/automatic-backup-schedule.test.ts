import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOMATIC_BACKUP_INTERVAL_MS, AUTOMATIC_BACKUP_SETTLE_MS, startAutomaticBackupSchedule } from "./automatic-backup-schedule";

afterEach(() => vi.useRealTimers());
describe("open-browser automatic backup scheduling", () => {
  it("runs startup, exact settle and interval checks without an explicit backup click", () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const schedule = startAutomaticBackupSchedule(check, {
      setTimeout, clearTimeout, setInterval, clearInterval,
      windowEvents: new EventTarget(), documentEvents: new EventTarget(), visible: () => true,
    });
    expect(check).toHaveBeenCalledTimes(1);
    schedule.changed();
    vi.advanceTimersByTime(AUTOMATIC_BACKUP_SETTLE_MS - 1);
    expect(check).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(check).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(AUTOMATIC_BACKUP_INTERVAL_MS - AUTOMATIC_BACKUP_SETTLE_MS);
    expect(check).toHaveBeenCalledTimes(3);
    schedule.stop();
  });
  it("coalesces rapid edits but does not postpone the independent periodic check", () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const schedule = startAutomaticBackupSchedule(check, {
      setTimeout, clearTimeout, setInterval, clearInterval,
      windowEvents: new EventTarget(), documentEvents: new EventTarget(), visible: () => true,
    });
    for (let index = 0; index < 60; index++) {
      schedule.changed();
      vi.advanceTimersByTime(1000);
    }
    expect(check).toHaveBeenCalledTimes(2);
    schedule.stop();
  });
  it("checks when returning or seeing cross-tab storage changes, and stops every timer/listener on unmount", () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const windowEvents = new EventTarget();
    const documentEvents = new EventTarget();
    let visible = false;
    const schedule = startAutomaticBackupSchedule(check, {
      setTimeout, clearTimeout, setInterval, clearInterval, windowEvents, documentEvents, visible: () => visible,
    });
    windowEvents.dispatchEvent(new Event("focus"));
    expect(check).toHaveBeenCalledTimes(1);
    visible = true;
    windowEvents.dispatchEvent(new Event("focus"));
    windowEvents.dispatchEvent(new Event("storage"));
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    expect(check).toHaveBeenCalledTimes(4);
    schedule.changed();
    schedule.stop();
    schedule.changed();
    vi.advanceTimersByTime(10 * AUTOMATIC_BACKUP_INTERVAL_MS);
    windowEvents.dispatchEvent(new Event("focus"));
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    expect(check).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });
});
