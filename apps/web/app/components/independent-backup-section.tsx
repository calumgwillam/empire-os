"use client";

import { useEffect, useRef, useState } from "react";
import { backupStorageContent, currentBackupStorageDigest, independentBackupHealth, readBackupVerifications,
  recordBackupVerification, verifyBackupFile, verifyBackupRecoveryDrill } from "../lib/independent-backup";
import { buildFullBackup } from "../lib/backup";

export function IndependentBackupSection({ revision, disabled }: { revision: unknown; disabled: boolean }) {
  const [health, setHealth] = useState<ReturnType<typeof independentBackupHealth>>({ label: "Checking external backup evidence", warning: true });
  const [error, setError] = useState("");
  const [checkError, setCheckError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [verifier, setVerifier] = useState("");
  const [location, setLocation] = useState("");
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const healthRun = useRef(0);
  const verificationRun = useRef(0);
  const writable = useRef(false);
  const mounted = useRef(false);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      healthRun.current++;
      verificationRun.current++;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const run = ++healthRun.current;
      setHealth({ label: "Checking external backup evidence against stored data", warning: true });
      try {
        const records = readBackupVerifications(window.localStorage);
        writable.current = true;
        const before = backupStorageContent(buildFullBackup(window.localStorage).storage);
        const digest = await currentBackupStorageDigest(window.localStorage);
        if (!active || run !== healthRun.current) return;
        if (before !== backupStorageContent(buildFullBackup(window.localStorage).storage)
          || JSON.stringify(records) !== JSON.stringify(readBackupVerifications(window.localStorage))) {
          setHealth({ label: "Data changed during backup check; verification pending", warning: true });
          return;
        }
        setHealth(independentBackupHealth(records, digest, Date.now()));
        setCheckError("");
      } catch (error) {
        if (!active || run !== healthRun.current) return;
        writable.current = false;
        setHealth({ label: "External backup evidence could not be verified", warning: true });
        setCheckError(error instanceof Error ? error.message : "Backup assurance could not be checked.");
      }
    };
    refreshRef.current = () => { void refresh(); };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 60_000);
    window.addEventListener("focus", refreshRef.current);
    window.addEventListener("storage", refreshRef.current);
    const listener = refreshRef.current;
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", listener);
      window.removeEventListener("storage", listener);
    };
  }, [revision]);

  const invalidate = () => {
    verificationRun.current++;
    setBusy(false);
    setResult("");
  };
  const verify = async (drill = false) => {
    if (!file || disabled || busy) return;
    const run = ++verificationRun.current;
    setBusy(true);
    setError("");
    setResult("");
    try {
      if (!writable.current) throw new Error("Verification history is not safely readable; preserve it and reconcile storage first.");
      const record = await (drill ? verifyBackupRecoveryDrill : verifyBackupFile)(await file.text(), {
        fileName: file.name, verifier, externalLocation: location, independenceDeclared: declared, nowMs: Date.now(),
      });
      if (!mounted.current || run !== verificationRun.current) return;
      recordBackupVerification(window.localStorage, record);
      setResult(drill
        ? "Simulated restore passed in isolated memory: every business store was read back exactly and restored evidence/references revalidated. Receipt recorded. Live business data was not accessed by the drill. This is not proof of real disaster-recovery readiness."
        : "Saved file read back, all business stores and recovery references checked, and SHA-256 evidence recorded. No data was restored. External independence remains your declaration, not automatically proven.");
      refreshRef.current();
    } catch (error) {
      if (!mounted.current || run !== verificationRun.current) return;
      setError(error instanceof Error ? error.message : "Saved backup file could not be verified.");
    } finally {
      if (mounted.current && run === verificationRun.current) setBusy(false);
    }
  };
  const field = "mt-1 w-full rounded border border-[#cfc8c1] bg-white p-2 text-[11px]";
  return <section className="mt-3 rounded-lg border border-[#cfc8c1] p-3 text-[11px] leading-4">
    <p role="status" className={health.warning ? "font-medium text-[#7a352b]" : "font-medium text-[#315b45]"}>{health.label}</p>
    <p className="mt-2">A download request or browser recovery snapshot is not an independent backup. Read back a saved copy from storage available without this browser/device. No cloud synchronisation is performed.</p>
    {health.verification ? <div className="mt-2 break-words">
      <p>File: {health.verification.fileName}</p>
      <p>Backup created: {new Date(health.verification.backupCreatedAt).toLocaleString()}</p>
      <p>Read-back verified: {new Date(health.verification.verifiedAt).toLocaleString()} by {health.verification.verifier}</p>
      <p>User-reported external location: {health.verification.externalLocation}</p>
      <p className="mt-1">{health.verification.recoveryDrill
        ? `Simulated restore passed: ${new Date(health.verification.recoveryDrill.completedAt).toLocaleString()} (${health.verification.recoveryDrill.checkedStoreCount} stores checked).`
        : "File verification only; no simulated restore in this verification receipt."}</p>
      <p>Real disaster-recovery readiness is not established: independent access, available devices, browser storage capacity and application operation after recovery require separate real-world checks.</p>
      <details className="mt-1"><summary>Verification fingerprint</summary><p className="break-all">SHA-256: {health.verification.fileSha256}</p>
        <p>These receipts cover this file fingerprint only; they do not prove future file availability or a real-device restore.</p></details>
    </div> : null}
    <details className="mt-3">
      <summary>Verify or drill saved external copy</summary>
      <p className="mt-2">The non-destructive drill runs the restore transaction in private memory, checks every stored value and revalidates recovered references. It does not test disk quotas, UI hydration or actual loss of this device.</p>
      <label className="mt-2 block">Saved backup JSON file
        <input className={field} type="file" accept="application/json,.json" disabled={disabled}
          onChange={(event) => { invalidate(); setFile(event.target.files?.[0] || null); }} /></label>
      <label className="mt-2 block">Verification recorded by
        <input className={field} value={verifier} disabled={disabled} onChange={(event) => { invalidate(); setVerifier(event.target.value); }} /></label>
      <label className="mt-2 block">External location and access/recovery basis (no passwords)
        <textarea className={field} value={location} disabled={disabled} onChange={(event) => { invalidate(); setLocation(event.target.value); }} /></label>
      <label className="mt-2 flex gap-2"><input type="checkbox" checked={declared} disabled={disabled}
        onChange={(event) => { invalidate(); setDeclared(event.target.checked); }} />
        I selected the externally stored copy and confirm it can be accessed independently of this browser and device.</label>
      <button type="button" className="mt-2 rounded border border-[#cfc8c1] px-3 py-2 disabled:opacity-45"
        disabled={disabled || busy || !file || !verifier.trim() || !location.trim() || !declared} onClick={() => void verify()}>
        {busy ? "Checking file..." : "Read back and verify copy"}
      </button>
      <button type="button" className="mt-2 rounded border border-[#cfc8c1] px-3 py-2 disabled:opacity-45"
        disabled={disabled || busy || !file || !verifier.trim() || !location.trim() || !declared} onClick={() => void verify(true)}>
        {busy ? "Checking file..." : "Run isolated recovery drill"}
      </button>
    </details>
    {error ? <p role="alert" className="mt-2 text-[#7a352b]">{error}</p> : null}
    {checkError ? <p role="alert" className="mt-2 text-[#7a352b]">{checkError}</p> : null}
    {result ? <p role="status" className="mt-2">{result}</p> : null}
  </section>;
}
