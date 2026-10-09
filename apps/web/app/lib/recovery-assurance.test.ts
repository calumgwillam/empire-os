import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { transpileModule, ScriptTarget, ModuleKind } from "typescript";
import {
  BACKUP_FORMAT, BACKUP_VERSION, buildFullBackup, validateEmpireOsBackup, runBackupRestoreTransaction,
  retainRecoverySnapshot, RECOVERY_SNAPSHOTS_STORAGE_KEY, EMPIRE_OS_BACKUP_STORAGE_KEYS,
  STORAGE_KEY, CONVERSION_STORAGE_KEY, PERSON_STORAGE_KEY, LEAD_STORAGE_KEY, INCOME_STORAGE_KEY, EXPENSE_STORAGE_KEY,
  TAX_PAYMENT_STORAGE_KEY, OUTREACH_STORAGE_KEY, CHANGE_HISTORY_STORAGE_KEY, STRATEGIC_OBJECTIVES_STORAGE_KEY,
  STRATEGIC_REVIEWS_STORAGE_KEY, WORKING_RELATIONSHIP_STORAGE_KEY, FOUNDER_INTELLIGENCE_STORAGE_KEY,
  type EmpireOsBackup, type BackupStorage,
} from "./backup";
import { ICARUS_STORAGE_KEY } from "./icarus";
import { defaultLeadForm } from "./crm";
import { acceptLeadDelivery, createIncomeWorkflowAction, getDeliveryIncomeEvidence } from "./lead-delivery";
import { buildJobPerformance, recordJobFinancialReview } from "./job-performance";
import { normalizeActionRecord } from "./capture-conversions";
import { createCommercialLesson, createCommercialImplementation, buildCommercialLearning } from "./commercial-learning";
import type { CommercialLearningInput } from "./commercial-learning";
import type { IncomeRecord } from "./finance";
import { getRecoveryReferenceIssues } from "./recovery-consistency";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const person = { id: "owner", name: "Operating owner", status: "Active", role: "Delivery and commercial operations",
  responsibilities: "Deliver customer scope and reconcile attributable financial evidence", authority: "Recorded operating authority" };
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  const storage: BackupStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); data.set(key, value); },
    removeItem: (key) => { writes.push(key); data.delete(key); },
  };
  const business = () => Object.fromEntries([...data].filter(([key]) => key !== RECOVERY_SNAPSHOTS_STORAGE_KEY));
  return { data, writes, storage, business };
}
function workflow(): CommercialLearningInput {
  const accepted = acceptLeadDelivery({ leads: [{ ...defaultLeadForm, id: "job", leadName: "Customer scope", status: "Won",
    serviceRequested: "Maintenance", relatedPillar: "Garden Maintenance", dateCreated: "2026-10-01T10:00:00Z" }],
    actions: [], people: [person], income: [], nowMs: NOW - 86400000 }, {
    leadId: "job", actionId: "delivery", scope: "Accepted customer scope", acceptedAt: "2026-10-02", acceptedByPersonId: person.id,
    acceptanceEvidence: "Recorded customer acceptance", ownerPersonId: person.id, promisedBy: "2026-10-10",
  });
  let source: CommercialLearningInput = { leads: [accepted.lead], actions: [{ ...accepted.action, status: "Completed",
    completionDate: "2026-10-08T10:00:00Z", completionEvidence: "Attributable agreed-scope completion" }],
    people: [person], income: [{
      id: "income", relatedLeadId: "job", date: "2026-10-08T11:00:00Z", description: "Agreed customer scope",
      customerSource: "Customer", amount: "1000", area: "Garden Maintenance", status: "Received",
      notes: "", dateCreated: "2026-10-08T10:00:00Z", earnedDate: "2026-10-08T10:00:00Z",
      earnedReference: "earned-scope", earnedEvidence: "Revenue supported by delivery",
      receiptReference: "receipt", receiptEvidence: "Customer payment evidence",
    }], expenses: [{
      id: "cost", relatedLeadId: "job", date: "2026-10-08", description: "Attributed labour", supplier: "Labour cost source",
      amount: "400", category: "Labour", area: "Garden Maintenance", status: "Paid", notes: "",
      dateCreated: "2026-10-08T10:00:00Z", incurredDate: "2026-10-08T10:00:00Z",
      incurredEvidence: "Approved labour and cost record", costReference: "cost", jobCostType: "Direct",
    }], lessons: [], decisions: [], nowMs: NOW };
  const billing = createIncomeWorkflowAction(source, { incomeId: "income", actionId: "billing", role: "Billing",
    ownerPersonId: person.id, dueDate: "2026-10-09" });
  source = { ...source, actions: [...source.actions, billing.action], income: [{ ...billing.income,
    invoiceIssuedDate: "2026-10-08T10:30:00Z", invoiceReference: "invoice", invoiceEvidence: "Invoice recorded" }] };
  source = { ...source, leads: [recordJobFinancialReview(source, "job", {
    reviewedByPersonId: person.id, revenueComplete: true, directCostsComplete: true, overheadCostsComplete: false,
    evidence: "All earned revenue and attributable direct costs reconciled; overhead coverage unresolved",
  })] };
  const lesson = createCommercialLesson(source, "lesson", "job", { cause: "Labour estimation", attribution: "Supported contribution",
    evidence: "Actual cost and scope reviewed", expectedDirectCost: "", estimateEvidence: "", changeKind: "Operating",
    ownerPersonId: person.id, recommendedChange: "Review access before scoping labour" });
  source = { ...source, lessons: [lesson] };
  return { ...source, actions: [...source.actions, createCommercialImplementation(source, lesson.id, "implementation", person.id, "2026-10-10")] };
}
function backupFor(source = workflow()): EmpireOsBackup {
  const storage = memory({
    [CONVERSION_STORAGE_KEY]: JSON.stringify([...source.actions, ...source.lessons, ...source.decisions]),
    [LEAD_STORAGE_KEY]: JSON.stringify(source.leads), [PERSON_STORAGE_KEY]: JSON.stringify(source.people),
    [INCOME_STORAGE_KEY]: JSON.stringify(source.income), [EXPENSE_STORAGE_KEY]: JSON.stringify(source.expenses),
  });
  return buildFullBackup(storage.storage, new Date(NOW).toISOString());
}
function decoded<T>(storage: BackupStorage, key: string): T {
  return JSON.parse(storage.getItem(key) || "[]") as T;
}

describe("Verified business recovery", () => {
  it("restores connected execution and evidence exactly without inventing net profit or learning success", () => {
    const source = workflow();
    const backup = backupFor(source);
    const target = memory({ [STORAGE_KEY]: '[{"id":"known-good-capture"}]' });
    expect(runBackupRestoreTransaction(target.storage, backup)).toEqual({ ok: true });
    const restored: CommercialLearningInput = {
      ...source, leads: decoded(target.storage, LEAD_STORAGE_KEY), actions: decoded<CommercialLearningInput["actions"]>(target.storage, CONVERSION_STORAGE_KEY)
        .filter((record) => record.targetType === "Convert to Action").map(normalizeActionRecord),
      income: decoded(target.storage, INCOME_STORAGE_KEY), expenses: decoded(target.storage, EXPENSE_STORAGE_KEY),
      lessons: source.lessons, people: decoded(target.storage, PERSON_STORAGE_KEY),
    };
    expect(getDeliveryIncomeEvidence(restored.income[0], restored)).toMatchObject({ earned: true, invoiced: true, received: true, validationErrors: [] });
    expect(buildJobPerformance(restored)[0]).toMatchObject({ contribution: 600, reviewCurrent: true, profitAfterAllocatedCosts: null });
    expect(buildCommercialLearning(restored)[0]).toMatchObject({ diagnosisCurrent: true, evaluationCurrent: false, outcome: "Unknown" });
    for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) expect(target.storage.getItem(key)).toBe(backup.storage[key]);
    const pinned = JSON.parse(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)!)[0];
    expect(pinned).toMatchObject({ pinned: true, storage: { [STORAGE_KEY]: '[{"id":"known-good-capture"}]' } });
  });
  it.each([TAX_PAYMENT_STORAGE_KEY, OUTREACH_STORAGE_KEY, CHANGE_HISTORY_STORAGE_KEY, STRATEGIC_OBJECTIVES_STORAGE_KEY,
    STRATEGIC_REVIEWS_STORAGE_KEY, WORKING_RELATIONSHIP_STORAGE_KEY, FOUNDER_INTELLIGENCE_STORAGE_KEY, ICARUS_STORAGE_KEY])(
    "rejects a new full backup missing declared store %s before touching known-good business data", (key) => {
      const backup = backupFor();
      delete backup.storage[key];
      const target = memory({ [STORAGE_KEY]: '[{"id":"only-known-good"}]' });
      expect(runBackupRestoreTransaction(target.storage, backup)).toMatchObject({ ok: false, writesStarted: false, rollbackFailures: [] });
      expect(target.writes).toEqual([]);
      expect(target.business()).toEqual({ [STORAGE_KEY]: '[{"id":"only-known-good"}]' });
    });
  it("preserves absent legacy stores, while rejecting a partial restore which would break retained financial responsibility", () => {
    const backup = backupFor();
    const target = memory(Object.fromEntries(Object.entries(backup.storage).filter((entry): entry is [string, string] => typeof entry[1] === "string")));
    const before = target.business();
    const legacy: EmpireOsBackup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date(NOW).toISOString(),
      storage: { [STORAGE_KEY]: '[{"id":"legacy-capture"}]' } };
    expect(runBackupRestoreTransaction(target.storage, legacy)).toEqual({ ok: true });
    for (const key of [INCOME_STORAGE_KEY, LEAD_STORAGE_KEY, CONVERSION_STORAGE_KEY, PERSON_STORAGE_KEY]) {
      expect(target.storage.getItem(key)).toBe(before[key]);
    }
    target.writes.length = 0;
    const invalid = { ...legacy, storage: { [CONVERSION_STORAGE_KEY]: "[]" } };
    const snapshot = target.business();
    const result = runBackupRestoreTransaction(target.storage, invalid);
    expect(result).toMatchObject({ ok: false, writesStarted: false, rollbackFailures: [] });
    if (result.ok) throw new Error("Broken retained responsibility must block recovery.");
    expect(String(result.error)).toContain("inconsistent record references");
    expect(target.writes).toEqual([]);
    expect(target.business()).toEqual(snapshot);
  });
  it.each(["delivery reverse link", "billing owner", "missing income", "missing lesson", "duplicate identity", "duplicate receipt"] as const)(
    "rejects structurally valid but inconsistent %s without a live write", (kind) => {
      const backup = backupFor();
      const conversions = JSON.parse(backup.storage[CONVERSION_STORAGE_KEY]!) as Record<string, unknown>[];
      const income = JSON.parse(backup.storage[INCOME_STORAGE_KEY]!) as IncomeRecord[];
      if (kind === "delivery reverse link") conversions.find((record) => record.id === "delivery")!.deliveryLeadId = "wrong-job";
      if (kind === "billing owner") conversions.find((record) => record.id === "billing")!.ownerPersonId = "different-person";
      if (kind === "missing income") backup.storage[INCOME_STORAGE_KEY] = "[]";
      if (kind === "missing lesson") {
        const filtered = conversions.filter((record) => record.id !== "lesson");
        conversions.splice(0, conversions.length, ...filtered);
      }
      if (kind === "duplicate identity") conversions.push({ ...conversions[0] });
      if (kind === "duplicate receipt") income.push({ ...income[0], id: "second-income", billingActionId: undefined, billingOwnerPersonId: undefined,
        invoiceReference: "second-invoice", earnedReference: "second-earned" });
      backup.storage[CONVERSION_STORAGE_KEY] = JSON.stringify(conversions);
      if (kind !== "missing income") backup.storage[INCOME_STORAGE_KEY] = JSON.stringify(income);
      expect(() => validateEmpireOsBackup(backup)).not.toThrow();
      const target = memory({ [STORAGE_KEY]: '[{"id":"known-good"}]' });
      const result = runBackupRestoreTransaction(target.storage, backup);
      expect(result).toMatchObject({ ok: false, writesStarted: false, rollbackFailures: [] });
      expect(target.writes).toEqual([]);
      expect(target.business()).toEqual({ [STORAGE_KEY]: '[{"id":"known-good"}]' });
    });
  it.each(["throw", "silent"] as const)("blocks restore when the safety copy cannot be verified (%s)", (mode) => {
    const target = memory({ [STORAGE_KEY]: '[{"id":"only-known-good"}]' });
    const original = target.storage.setItem;
    target.storage.setItem = (key, value) => {
      if (key === RECOVERY_SNAPSHOTS_STORAGE_KEY) {
        if (mode === "throw") throw new Error("Recovery quota exceeded");
        return;
      }
      original(key, value);
    };
    expect(runBackupRestoreTransaction(target.storage, backupFor())).toMatchObject({ ok: false, writesStarted: false, rollbackFailures: [] });
    expect(target.business()).toEqual({ [STORAGE_KEY]: '[{"id":"only-known-good"}]' });
  });
  it("restores the exact previous recovery history if a safety write corrupts its value", () => {
    const originalHistory = JSON.stringify([{ createdAt: new Date(NOW).toISOString(), pinned: true,
      storage: { [STORAGE_KEY]: '[{"id":"previous-known-good"}]' } }]);
    const target = memory({ [STORAGE_KEY]: '[{"id":"current-known-good"}]', [RECOVERY_SNAPSHOTS_STORAGE_KEY]: originalHistory });
    const original = target.storage.setItem;
    let corrupted = false;
    target.storage.setItem = (key, value) => {
      if (key === RECOVERY_SNAPSHOTS_STORAGE_KEY && !corrupted) {
        corrupted = true;
        original(key, "{corrupted-write");
        return;
      }
      original(key, value);
    };
    expect(runBackupRestoreTransaction(target.storage, backupFor())).toMatchObject({ ok: false, writesStarted: false, rollbackFailures: [] });
    expect(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe(originalHistory);
    expect(target.business()).toEqual({ [STORAGE_KEY]: '[{"id":"current-known-good"}]' });
  });
  it("reports failed recovery-history rollback without starting any business-store writes", () => {
    const target = memory({ [STORAGE_KEY]: '[{"id":"current-known-good"}]', [RECOVERY_SNAPSHOTS_STORAGE_KEY]: "[]" });
    const original = target.storage.setItem;
    target.storage.setItem = (key) => { original(key, "{corrupted"); };
    const result = runBackupRestoreTransaction(target.storage, backupFor());
    expect(result).toMatchObject({ ok: false, writesStarted: false, rollbackFailures: [] });
    if (result.ok) throw new Error("Unverified safety storage must block restore.");
    expect(String(result.error)).toContain("prior recovery history could not be restored");
    expect(target.business()).toEqual({ [STORAGE_KEY]: '[{"id":"current-known-good"}]' });
  });
  it.each(["{broken", "{}", '[{"createdAt":"valid","storage":42}]'])("preserves malformed recovery history %s and refuses destructive restore", (history) => {
    const target = memory({ [STORAGE_KEY]: '[{"id":"known-good"}]', [RECOVERY_SNAPSHOTS_STORAGE_KEY]: history });
    expect(runBackupRestoreTransaction(target.storage, backupFor())).toMatchObject({ ok: false, writesStarted: false, rollbackFailures: [] });
    expect(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe(history);
    expect(target.writes).toEqual([]);
  });
  it("retains pinned pre-restore evidence through normal five-snapshot rotation and can restore the safety copy", () => {
    const target = memory({ [STORAGE_KEY]: '[{"id":"original"}]' });
    expect(runBackupRestoreTransaction(target.storage, backupFor())).toEqual({ ok: true });
    const pinned = JSON.parse(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)!)[0];
    for (let index = 0; index < 7; index++) {
      target.storage.setItem(STORAGE_KEY, JSON.stringify([{ id: `capture-${index}` }]));
      retainRecoverySnapshot(target.storage, buildFullBackup(target.storage, new Date(NOW + index).toISOString()));
    }
    const snapshots = JSON.parse(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)!);
    expect(snapshots.filter((entry: { pinned?: boolean }) => entry.pinned)).toEqual([pinned]);
    expect(snapshots.filter((entry: { pinned?: boolean }) => !entry.pinned)).toHaveLength(5);
    expect(runBackupRestoreTransaction(target.storage, validateEmpireOsBackup(pinned))).toEqual({ ok: true });
    expect(target.business()).toEqual({ [STORAGE_KEY]: '[{"id":"original"}]' });
  });
  it("restores exact prior stores on a later write failure while retaining an independently verified safety copy", () => {
    const target = memory({ [STORAGE_KEY]: '[{"id":"original"}]' });
    const original = target.storage.setItem;
    let failed = false;
    target.storage.setItem = (key, value) => {
      if (key === INCOME_STORAGE_KEY && !failed) { failed = true; throw new Error("Income write failed"); }
      original(key, value);
    };
    expect(runBackupRestoreTransaction(target.storage, backupFor())).toMatchObject({ ok: false, writesStarted: true, rollbackFailures: [] });
    expect(target.business()).toEqual({ [STORAGE_KEY]: '[{"id":"original"}]' });
    expect(JSON.parse(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)!)[0].storage[STORAGE_KEY]).toBe('[{"id":"original"}]');
  });
  it("preserves the full safety copy even when rollback itself fails", () => {
    const target = memory({ [STORAGE_KEY]: '[{"id":"original"}]' });
    const originalSet = target.storage.setItem;
    const originalRemove = target.storage.removeItem;
    let failed = false;
    target.storage.setItem = (key, value) => {
      if (key === INCOME_STORAGE_KEY) { failed = true; throw new Error("Write failed"); }
      if (failed && key === STORAGE_KEY) throw new Error("Rollback failed");
      originalSet(key, value);
    };
    target.storage.removeItem = (key) => {
      if (failed && key === CONVERSION_STORAGE_KEY) throw new Error("Rollback failed");
      originalRemove(key);
    };
    const result = runBackupRestoreTransaction(target.storage, backupFor());
    expect(result).toMatchObject({ ok: false, writesStarted: true, rollbackFailures: [STORAGE_KEY, CONVERSION_STORAGE_KEY] });
    const pinned = JSON.parse(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)!)[0];
    expect(pinned.storage[STORAGE_KEY]).toBe('[{"id":"original"}]');
    expect(pinned.storage[CONVERSION_STORAGE_KEY]).toBeNull();
  });
  it("aborts without undoing a legitimate intervening edit during preparation", () => {
    const target = memory({ [STORAGE_KEY]: '[{"id":"original"}]' });
    const result = runBackupRestoreTransaction(target.storage, backupFor(), () => {
      target.storage.setItem(STORAGE_KEY, '[{"id":"intervening-edit"}]');
    });
    expect(result).toMatchObject({ ok: false, writesStarted: false, rollbackFailures: [] });
    expect(target.business()).toEqual({ [STORAGE_KEY]: '[{"id":"intervening-edit"}]' });
    expect(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBeNull();
  });
  it("cannot have its verified restore target or retained safety bytes changed by the download callback", () => {
    const target = memory({ [STORAGE_KEY]: '[{"id":"original"}]' });
    const backup = backupFor();
    const expected = { ...backup.storage };
    expect(runBackupRestoreTransaction(target.storage, backup, (safety) => {
      safety.storage[STORAGE_KEY] = "[\"not-the-original\"]";
      backup.storage[INCOME_STORAGE_KEY] = "[]";
    })).toEqual({ ok: true });
    for (const key of EMPIRE_OS_BACKUP_STORAGE_KEYS) expect(target.storage.getItem(key)).toBe(expected[key]);
    expect(JSON.parse(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)!)[0].storage[STORAGE_KEY]).toBe('[{"id":"original"}]');
  });
  it("checks capacity milestone and Icarus monitoring bindings without turning stale/unknown outcomes into recovery errors", () => {
    const action = { id: "milestone", targetType: "Convert to Action", relatedDecision: "wrong" };
    const decision = { id: "resolution", targetType: "Convert to Decision", capacityResolution: {
      baseline: { personId: person.id }, milestoneActionIds: [action.id], alternatives: [],
    } };
    expect(getRecoveryReferenceIssues({ conversions: JSON.stringify([action, decision]), people: JSON.stringify([person]) }))
      .toContain("resolution: milestone does not point back to its capacity Decision");
    const plan = { id: "plan", ownerPersonId: person.id, recordedAt: new Date(NOW).toISOString(), recordedByPersonId: person.id,
      protection: "Operating barrier", controlIds: [], evidenceRequirements: "Direct operating observation",
      acceptanceCriteria: "Barrier operates as specified", firstReviewBy: "2026-10-10" };
    const monitoring = { id: "monitor", targetType: "Convert to Action", ownerPersonId: person.id,
      icarusObservationLinks: [{ assessmentId: "risk", treatmentTargetId: "target", plan }] };
    const assessment = { id: "risk", treatmentTargets: [{ id: "target", observationPlans: [plan] }] };
    expect(getRecoveryReferenceIssues({ conversions: JSON.stringify([monitoring]), icarus: JSON.stringify([assessment]) })).toEqual([]);
    expect(getRecoveryReferenceIssues({ conversions: JSON.stringify([{ ...monitoring, ownerPersonId: "wrong" }]),
      icarus: JSON.stringify([assessment]) })).toContain("monitor: Icarus observation plan or ownership disagrees with assessment history");
    const { id, ...otherFields } = plan;
    const reorderedPlan = { ...otherFields, id };
    expect(getRecoveryReferenceIssues({ conversions: JSON.stringify([{ ...monitoring,
      icarusObservationLinks: [{ assessmentId: "risk", treatmentTargetId: "target", plan: reorderedPlan }] }]),
      icarus: JSON.stringify([assessment]) })).toEqual([]);
  });
});

describe("Emergency recovery uses the production verified restore path", () => {
  const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
  const start = page.indexOf("  function handleRestoreEmergencySnapshot()");
  const end = page.indexOf("  const learningClosure =", start);
  if (start < 0 || end < start) throw new Error("Emergency recovery handler could not be located.");
  const production = transpileModule(`${page.slice(start, end)}handleRestoreEmergencySnapshot();`,
    { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText;
  it.each(["success", "write failure", "rollback failure"] as const)("verifies %s before deciding whether to reload or quarantine", (mode) => {
    const backup = backupFor();
    const legacySnapshot = { createdAt: backup.createdAt, storage: backup.storage };
    const target = memory({ [STORAGE_KEY]: '[{"id":"original"}]',
      [RECOVERY_SNAPSHOTS_STORAGE_KEY]: JSON.stringify([legacySnapshot]) });
    const original = target.storage.setItem;
    let failed = false;
    target.storage.setItem = (key, value) => {
      if (mode !== "success" && key === INCOME_STORAGE_KEY) { failed = true; throw new Error("Income failed"); }
      if (mode === "rollback failure" && failed && key === STORAGE_KEY) throw new Error("Rollback failed");
      original(key, value);
    };
    let reloads = 0;
    let quarantines = 0;
    const feedback: string[] = [];
    const context = {
      window: { localStorage: target.storage, prompt: () => "1", confirm: () => true, alert: () => {},
        location: { reload: () => { reloads++; } } },
      RECOVERY_SNAPSHOTS_STORAGE_KEY, BACKUP_FORMAT, BACKUP_VERSION, validateEmpireOsBackup, runBackupRestoreTransaction,
      restoreInProgressRef: { current: false }, auditRestoreInProgressRef: { current: false }, Error,
      downloadBackup: (safety: EmpireOsBackup) => { expect(safety.storage[STORAGE_KEY]).toBe('[{"id":"original"}]'); },
      quarantineRecoveryWrites: () => { quarantines++; },
      setFeedback: (value: { message: string }) => { feedback.push(value.message); },
    };
    runInNewContext(production, context, { timeout: 1000 });
    expect(reloads).toBe(mode === "success" ? 1 : 0);
    expect(quarantines).toBe(mode === "rollback failure" ? 1 : 0);
    if (mode === "write failure") {
      expect(target.business()).toEqual({ [STORAGE_KEY]: '[{"id":"original"}]' });
      expect(feedback[0]).toContain("restored and verified");
    }
    if (mode === "rollback failure") expect(feedback[0]).toContain("Editing is blocked");
    expect(JSON.parse(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)!)[0]).toMatchObject({ pinned: true });
  });
  it("quarantines every writable evidence store and keeps restore/audit guards active after unverified rollback", () => {
    const start = page.indexOf("  function quarantineRecoveryWrites()");
    const end = page.indexOf("  function handleRestoreEmergencySnapshot()", start);
    if (start < 0 || end < start) throw new Error("Recovery quarantine handler could not be located.");
    const refs = Object.fromEntries([
      "conversions", "people", "projects", "leads", "handoffs", "income", "expenses", "icarus", "founderIntelligence",
      "strategicObjectives", "strategicReviews", "changeHistory",
    ].map((name) => [`${name}WritableRef`, { current: true }]));
    let message = "";
    const context = { ...refs, restoreInProgressRef: { current: false }, auditRestoreInProgressRef: { current: false },
      setRecoveryFailure: (value: string) => { message = value; } };
    runInNewContext(transpileModule(`${page.slice(start, end)}quarantineRecoveryWrites();`,
      { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText, context, { timeout: 1000 });
    expect(Object.values(refs).every((ref) => !ref.current)).toBe(true);
    expect(context.restoreInProgressRef.current).toBe(true);
    expect(context.auditRestoreInProgressRef.current).toBe(true);
    expect(message).toContain("Editing is blocked");
  });
  it("startup recovery captures every registered business store and does not replace malformed recovery history", () => {
    const start = page.indexOf("      // Preserve the untouched browser data");
    const end = page.indexOf("      if (storedCaptures)", start);
    if (start < 0 || end < start) throw new Error("Startup recovery snapshot code could not be located.");
    const production = transpileModule(page.slice(start, end),
      { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText;
    const target = memory({ [TAX_PAYMENT_STORAGE_KEY]: '[{"id":"tax"}]', [OUTREACH_STORAGE_KEY]: '[{"id":"outreach"}]',
      [STRATEGIC_OBJECTIVES_STORAGE_KEY]: '[{"id":"objective"}]', [STRATEGIC_REVIEWS_STORAGE_KEY]: '[{"id":"review"}]' });
    const errors: string[] = [];
    const context = { window: { localStorage: target.storage }, buildFullBackup, retainRecoverySnapshot,
      setFeedback: (value: { message: string }) => { errors.push(value.message); }, Error };
    runInNewContext(production, context, { timeout: 1000 });
    const snapshot = JSON.parse(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)!)[0];
    expect(Object.keys(snapshot.storage)).toEqual([...EMPIRE_OS_BACKUP_STORAGE_KEYS]);
    for (const key of [TAX_PAYMENT_STORAGE_KEY, OUTREACH_STORAGE_KEY, STRATEGIC_OBJECTIVES_STORAGE_KEY, STRATEGIC_REVIEWS_STORAGE_KEY]) {
      expect(snapshot.storage[key]).toBe(target.storage.getItem(key));
    }
    target.storage.setItem(RECOVERY_SNAPSHOTS_STORAGE_KEY, "{malformed");
    runInNewContext(production, context, { timeout: 1000 });
    expect(target.storage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY)).toBe("{malformed");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("could not be verified");
  });
});
