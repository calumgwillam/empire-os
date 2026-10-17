"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AutomaticRecoverySnapshots, automaticRecoveryMessage, type AutomaticRecoveryStatus } from "../lib/automatic-recovery";
import { openBackupDestination } from "../lib/backup-destination";
import { AutomaticFileBackups, isBackupDirectory, type AutomaticFileBackupResult, type BackupDirectory } from "../lib/file-backup";
import { startAutomaticBackupSchedule } from "../lib/automatic-backup-schedule";

const subscribeToBrowserCapabilities = () => () => {};
const supportsFolderBackups = () => typeof window !== "undefined"
  && "showDirectoryPicker" in window && typeof window.showDirectoryPicker === "function"
  && typeof navigator !== "undefined" && Boolean(navigator.locks);

export function AutomaticBackupSection({ revision, disabled }: { revision: unknown; disabled: boolean }) {
  const directory = useRef<BackupDirectory | null>(null);
  const destinationRevision = useRef(0);
  const settings = useRef<Awaited<ReturnType<typeof openBackupDestination>> | null>(null);
  const local = useRef(new AutomaticRecoverySnapshots());
  const files = useRef(new AutomaticFileBackups());
  const running = useRef(false);
  const schedule = useRef<ReturnType<typeof startAutomaticBackupSchedule> | null>(null);
  const mounted = useRef(false);
  const blocked = useRef(disabled);
  const [localStatus, setLocalStatus] = useState<AutomaticRecoveryStatus | null>(null);
  const [fileStatus, setFileStatus] = useState<AutomaticFileBackupResult | null>(null);
  const [folderName, setFolderName] = useState("");
  const [error, setError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [busy, setBusy] = useState(false);
  const supported = useSyncExternalStore(subscribeToBrowserCapabilities, supportsFolderBackups, () => false);

  useEffect(() => { blocked.current = disabled; }, [disabled]);

  const check = useCallback(async () => {
    if (!mounted.current || blocked.current || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const result = local.current.check(window.localStorage);
      if (mounted.current) setLocalStatus(result);
      if (directory.current) {
        const checked = await files.current.check(directory.current, window.localStorage);
        if (mounted.current) setFileStatus(checked);
      }
      if (mounted.current) setError("");
    } catch (failure) {
      if (mounted.current) {
        setFileStatus(null);
        setError(failure instanceof Error ? failure.message : "Automatic backup could not be verified.");
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const available = supportsFolderBackups();
    let active = true;
    const setupRevision = destinationRevision.current;
    if (available) {
      void (async () => {
        try {
          const repository = await openBackupDestination();
          if (!active) { repository.close(); return; }
          settings.current = repository;
          const saved = await repository.load();
          if (!active || setupRevision !== destinationRevision.current) return;
          directory.current = saved;
          setFolderName(saved?.name ?? "");
          await check();
        } catch (failure) {
          if (active) setSettingsError(failure instanceof Error ? failure.message : "Backup folder approval could not be loaded.");
        }
      })();
    }
    schedule.current = startAutomaticBackupSchedule(() => { void check(); }, {
      setTimeout: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeout: id => window.clearTimeout(id),
      setInterval: (callback, delay) => window.setInterval(callback, delay),
      clearInterval: id => window.clearInterval(id),
      windowEvents: window, documentEvents: document, visible: () => document.visibilityState === "visible",
    });
    return () => {
      active = false;
      mounted.current = false;
      schedule.current?.stop();
      schedule.current = null;
      settings.current?.close();
      settings.current = null;
    };
  }, [check]);

  useEffect(() => {
    schedule.current?.changed();
  }, [revision, disabled]);

  const approve = async () => {
    if (blocked.current || running.current || !supported) return;
    const approvalRevision = ++destinationRevision.current;
    try {
      // Invocation remains inside a user gesture. Permission is never requested by
      // the timer; reloads use queryPermission and fail closed if access expired.
      if (!("showDirectoryPicker" in window) || typeof window.showDirectoryPicker !== "function") {
        throw new Error("This browser does not support approved-folder automatic backups.");
      }
      const selected: unknown = await window.showDirectoryPicker({ mode: "readwrite", id: "empire-os-backups" });
      if (!isBackupDirectory(selected)) throw new Error("The selected folder cannot support verified backups.");
      if (!mounted.current || blocked.current || approvalRevision !== destinationRevision.current) return;
      directory.current = selected;
      setFolderName(selected.name);
      setFileStatus(null);
      if (settings.current) {
        try {
          await settings.current.save(selected);
          if (mounted.current) setSettingsError("");
        } catch (failure) {
          if (mounted.current) setSettingsError(`${failure instanceof Error ? failure.message : "Folder approval could not be saved."} Approval is usable only in this open page.`);
        }
      } else {
        setSettingsError("Folder approval cannot be remembered. This folder is usable only in this open page.");
      }
      await check();
    } catch (failure) {
      if (failure instanceof Error && failure.name === "AbortError") return;
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Backup folder approval failed.");
    }
  };

  const stop = async () => {
    if (running.current) return;
    destinationRevision.current++;
    directory.current = null;
    setFolderName("");
    setFileStatus(null);
    try {
      await settings.current?.forget();
      setSettingsError("");
      setError("");
    } catch (failure) {
      setSettingsError(`${failure instanceof Error ? failure.message : "Folder approval could not be removed."} Writes are stopped in this page, but saved approval may resume on reload. Revoke folder access in browser settings.`);
    }
  };

  return <section className="mt-3 rounded-lg border border-[#cfc8c1] p-3 text-[11px] leading-4">
    <p className="font-medium">Automatic backup and recovery</p>
    <p className="mt-2 font-medium text-[#7a352b]">Unattended off-device protection is not established.</p>
    <p className="mt-2">Checks run while this dashboard is open: after edits settle, every minute, and on return to the page. Closed browsers, sleeping laptops and browser throttling prevent a guaranteed schedule.</p>
    {localStatus ? <p className="mt-2" role="status">Browser-local check: {automaticRecoveryMessage(localStatus)} Checked {new Date(localStatus.checkedAt).toLocaleString()}. These copies share this browser&apos;s failure domain.</p> : null}
    <p className="mt-2">Approved folder: {folderName || "none"}. Each new file contains all 21 stores, version metadata and SHA-256 checks, is read back, and passes an isolated restore drill. Previous files are never overwritten or automatically deleted.</p>
    {fileStatus ? <div className="mt-2" role="status">
      <p>{fileStatus.status === "created" ? "New full file written and verified."
        : fileStatus.status === "current" ? "A matching full backup file was read and verified."
          : "No stored business data was captured; no empty file was created."}</p>
      <p>{fileStatus.currentDataCovered ? "Stored data matched at the last check." : "Current stored data is not covered; another check is required."}</p>
      <p>Last check: {new Date(fileStatus.checkedAt).toLocaleString()}. Verified recovery points: {fileStatus.verifiedRecoveryPoints}. Damaged or incomplete files: {fileStatus.damagedFiles}.</p>
      {fileStatus.fileName ? <p className="break-all">{fileStatus.fileName}</p> : null}
    </div> : null}
    {error ? <p role="alert" className="mt-2 text-[#7a352b]">{error}</p> : null}
    {settingsError ? <p role="alert" className="mt-2 text-[#7a352b]">{settingsError}</p> : null}
    <p className="mt-2">Folder approval permits automatic writes of unencrypted business backup files. Choose a private folder you control. A folder on this laptop is not off-device protection. An OS-synchronised folder is off-device only after its provider confirms upload and independent recovery; Empire OS cannot verify that here. No cloud account, upload permission or server credential is assumed.</p>
    {supported ? <button type="button" disabled={disabled || busy}
      className="mt-2 rounded border border-[#cfc8c1] px-3 py-2 disabled:opacity-45" onClick={() => void approve()}>
      Approve backup folder
    </button> : <p className="mt-2">Automatic folder writing is unavailable in this browser. Use a supporting desktop browser or the existing manual export and verification workflow.</p>}
    <button type="button" disabled={disabled || busy} className="ml-2 mt-2 rounded border border-[#cfc8c1] px-3 py-2 disabled:opacity-45"
      onClick={() => void check()}>{busy ? "Checking..." : "Check backups now"}</button>
    {folderName ? <button type="button" disabled={busy} className="mt-2 rounded border border-[#cfc8c1] px-3 py-2 disabled:opacity-45"
      onClick={() => void stop()}>Stop folder backups (keep files)</button> : null}
    <p className="mt-2">Recover through Restore full backup: select a file from the folder on a working device, review it, then explicitly confirm. Files are never automatically restored.</p>
    <p className="mt-2">Closed-browser off-device backups require durably synchronised server data, an approved remote destination, server-owned credentials, a scheduler and independently tested recovery. None is activated by folder approval.</p>
  </section>;
}
