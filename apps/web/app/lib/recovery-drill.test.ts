import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as backupTools from "./backup";
import { buildFullBackup, EMPIRE_OS_BACKUP_STORAGE_KEYS, STORAGE_KEY, CONVERSION_STORAGE_KEY, PERSON_STORAGE_KEY,
  LEAD_STORAGE_KEY, INCOME_STORAGE_KEY, EXPENSE_STORAGE_KEY, RECOVERY_SNAPSHOTS_STORAGE_KEY } from "./backup";
import { runRecoveryDrill } from "./recovery-drill";
import { BACKUP_VERIFICATIONS_STORAGE_KEY, readBackupVerifications, recordBackupVerification,
  verifyBackupFile, verifyBackupRecoveryDrill, independentBackupHealth } from "./independent-backup";
import { defaultLeadForm } from "./crm";
import { acceptLeadDelivery, buildLeadDelivery, createIncomeWorkflowAction, getDeliveryIncomeEvidence } from "./lead-delivery";
import { buildJobPerformance, recordJobFinancialReview } from "./job-performance";
import { createCommercialLesson, buildCommercialLearning, type CommercialLearningInput } from "./commercial-learning";
import { ICARUS_STORAGE_KEY, parseIcarusAssessments, type IcarusAssessmentRecord } from "./icarus";

const NOW = Date.parse("2026-10-09T19:20:00Z");
const digest = async (value: string) => createHash("sha256").update(value).digest("hex");
const request = { fileName: "saved.json", verifier: "Recovery reviewer", externalLocation: "Independent storage",
  independenceDeclared: true, nowMs: NOW };
function full() {
  return buildFullBackup({ getItem: (key) => key === STORAGE_KEY ? '[{"id":"capture","rawNote":"Recorded evidence"}]' : null },
    new Date(NOW).toISOString());
}
afterEach(() => vi.restoreAllMocks());

describe("Non-destructive isolated recovery drills", () => {
  it("uses the production transaction, checks all stores and never accesses browser storage", () => {
    const liveAccess = vi.fn(() => { throw new Error("Live storage must not be accessed"); });
    vi.stubGlobal("window", { get localStorage() { return liveAccess(); } });
    try {
      const transaction = vi.spyOn(backupTools, "runBackupRestoreTransaction");
      const revalidate = vi.spyOn(backupTools, "validateStandaloneBackup");
      const backup = full();
      const drill = runRecoveryDrill(JSON.stringify(backup));
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(revalidate).toHaveBeenCalledTimes(1);
      expect(drill).toMatchObject({ checkedStoreCount: EMPIRE_OS_BACKUP_STORAGE_KEYS.length, missingStorageKeys: [] });
      expect(drill.restored.storage).toEqual(backup.storage);
      expect(liveAccess).not.toHaveBeenCalled();
      expect(Object.keys(drill.restored.storage)).not.toContain(RECOVERY_SNAPSHOTS_STORAGE_KEY);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("accepts legacy complete files and reports omitted legacy stores instead of inventing their contents", () => {
    const backup = full();
    delete backup.includedStorageKeys;
    expect(runRecoveryDrill(JSON.stringify(backup)).missingStorageKeys).toEqual([]);
    delete backup.storage[PERSON_STORAGE_KEY];
    const partial = runRecoveryDrill(JSON.stringify(backup));
    expect(partial.missingStorageKeys).toEqual([PERSON_STORAGE_KEY]);
    expect(partial.restored.storage[PERSON_STORAGE_KEY]).toBeNull();
  });
  it.each(["JSON", "array", "manifest", "reference", "Icarus"] as const)("rejects invalid %s with no success receipt", async (kind) => {
    const backup = full();
    if (kind === "array") backup.storage[INCOME_STORAGE_KEY] = "{}";
    if (kind === "manifest") delete backup.storage[EXPENSE_STORAGE_KEY];
    if (kind === "reference") backup.storage[CONVERSION_STORAGE_KEY] = JSON.stringify([
      { id: "billing", targetType: "Convert to Action", financeIncomeId: "missing-income", financeIncomeRole: "Billing" },
    ]);
    if (kind === "Icarus") backup.storage[ICARUS_STORAGE_KEY] = '[{"id":"risk","controls":[{}]}]';
    const text = kind === "JSON" ? "{invalid" : JSON.stringify(backup);
    expect(() => runRecoveryDrill(text)).toThrow();
    await expect(verifyBackupRecoveryDrill(text, request, digest)).rejects.toThrow();
  });
  it("does not treat a partial legacy simulation as complete standalone recovery", async () => {
    const backup = full();
    delete backup.includedStorageKeys;
    delete backup.storage[LEAD_STORAGE_KEY];
    expect(runRecoveryDrill(JSON.stringify(backup)).missingStorageKeys).toContain(LEAD_STORAGE_KEY);
    await expect(verifyBackupRecoveryDrill(JSON.stringify(backup), request, digest)).rejects.toThrow("missing business stores");
  });
  it("reports production restore write failure without claiming simulation success", () => {
    const real = backupTools.runBackupRestoreTransaction;
    vi.spyOn(backupTools, "runBackupRestoreTransaction").mockImplementationOnce((isolated, backup) => {
      const write = isolated.setItem;
      isolated.setItem = (key, value) => {
        if (key === STORAGE_KEY) throw new Error("Simulated write failure");
        write(key, value);
      };
      return real(isolated, backup);
    });
    expect(() => runRecoveryDrill(JSON.stringify(full()))).toThrow("Isolated recovery drill failed: Simulated write failure");
  });
  it("independently detects incorrect restored bytes even if the transaction reports success", () => {
    vi.spyOn(backupTools, "runBackupRestoreTransaction").mockImplementationOnce((isolated) => {
      isolated.setItem(STORAGE_KEY, "[]");
      return { ok: true };
    });
    expect(() => runRecoveryDrill(JSON.stringify(full()))).toThrow(`read-back failed for: ${STORAGE_KEY}`);
  });
  it("reports uncertain isolated rollback explicitly without implying live data was involved", () => {
    vi.spyOn(backupTools, "runBackupRestoreTransaction").mockReturnValueOnce({
      ok: false, error: new Error("Read-back failed"), writesStarted: true, rollbackFailures: [STORAGE_KEY],
    });
    expect(() => runRecoveryDrill(JSON.stringify(full())))
      .toThrow(`Isolated rollback could not be verified for: ${STORAGE_KEY}. Live storage was not accessed.`);
  });
  it("records drill evidence separately while retaining legacy verification receipts and warning on later data changes", async () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
    const text = JSON.stringify(full());
    const fileOnly = await verifyBackupFile(text, request, digest);
    recordBackupVerification(storage, fileOnly);
    const drill = await verifyBackupRecoveryDrill(text, { ...request, nowMs: NOW + 1 }, digest, () => NOW + 2);
    recordBackupVerification(storage, drill);
    expect([...data.keys()]).toEqual([BACKUP_VERIFICATIONS_STORAGE_KEY]);
    expect(readBackupVerifications(storage)).toEqual([fileOnly, drill]);
    expect(fileOnly.recoveryDrill).toBeUndefined();
    expect(drill.recoveryDrill).toEqual({ completedAt: new Date(NOW + 2).toISOString(), checkedStoreCount: EMPIRE_OS_BACKUP_STORAGE_KEYS.length });
    expect(independentBackupHealth([drill], "0".repeat(64), NOW + 1).warning).toBe(true);
    for (const change of [{ completedAt: "invalid", checkedStoreCount: EMPIRE_OS_BACKUP_STORAGE_KEYS.length },
      { completedAt: new Date(NOW - 1).toISOString(), checkedStoreCount: EMPIRE_OS_BACKUP_STORAGE_KEYS.length },
      { completedAt: new Date(NOW + 1).toISOString(), checkedStoreCount: 0 }]) {
      const raw = JSON.stringify([{ ...drill, recoveryDrill: change }]);
      expect(() => readBackupVerifications({ getItem: () => raw })).toThrow("malformed");
    }
  });
  it.each([NaN, NOW - 1])("does not establish drill evidence with invalid completion clock %s", async (clock) => {
    await expect(verifyBackupRecoveryDrill(JSON.stringify(full()), request, digest, () => clock))
      .rejects.toThrow("completion clock");
  });
});

describe("Connected financial and operating evidence in an isolated restore", () => {
  it("retains delivery, revenue, costs, financial review, learning and Icarus evidence without manufacturing outcomes", () => {
    const person = { id: "owner", name: "Operating owner", status: "Active", role: "Delivery",
      responsibilities: "Deliver and reconcile", authority: "Recorded operating authority" };
    const accepted = acceptLeadDelivery({ leads: [{ ...defaultLeadForm, id: "job", leadName: "Accepted scope", status: "Won",
      serviceRequested: "Maintenance", relatedPillar: "Garden Maintenance", dateCreated: "2026-10-01T10:00:00Z" }],
      actions: [], people: [person], income: [], nowMs: Date.parse("2026-10-02T12:00:00Z") }, {
      leadId: "job", actionId: "delivery", scope: "Accepted scope", acceptedAt: "2026-10-02",
      acceptedByPersonId: person.id, acceptanceEvidence: "Customer acceptance", ownerPersonId: person.id, promisedBy: "2026-10-10",
    });
    let source: CommercialLearningInput = { leads: [accepted.lead], actions: [{ ...accepted.action, status: "Completed",
      completionDate: "2026-10-08T10:00:00Z", completionEvidence: "Recorded scope completion" }], people: [person],
      income: [{ id: "income", relatedLeadId: "job", date: "2026-10-08T11:00:00Z", description: "Accepted scope",
        customerSource: "Customer", amount: "1000", area: "Garden Maintenance", status: "Received", notes: "",
        dateCreated: "2026-10-08T10:00:00Z", earnedDate: "2026-10-08T10:00:00Z", earnedReference: "earned",
        earnedEvidence: "Delivery revenue evidence", receiptReference: "receipt", receiptEvidence: "Payment evidence" }],
      expenses: [{ id: "cost", relatedLeadId: "job", date: "2026-10-08", description: "Labour", supplier: "Labour source",
        amount: "400", category: "Labour", area: "Garden Maintenance", status: "Paid", notes: "",
        dateCreated: "2026-10-08T10:00:00Z", incurredDate: "2026-10-08T10:00:00Z",
        incurredEvidence: "Approved labour", costReference: "cost", jobCostType: "Direct" }],
      lessons: [], decisions: [], nowMs: NOW };
    const billing = createIncomeWorkflowAction(source, { incomeId: "income", actionId: "billing", role: "Billing",
      ownerPersonId: person.id, dueDate: "2026-10-10" });
    source = { ...source, actions: [...source.actions, billing.action], income: [{ ...billing.income,
      invoiceIssuedDate: "2026-10-08T10:30:00Z", invoiceReference: "invoice", invoiceEvidence: "Issued invoice" }] };
    expect(buildLeadDelivery(source)[0].completionSupported).toBe(true);
    expect(() => recordJobFinancialReview({ ...source, actions: source.actions.map((action) => action.id === "delivery"
      ? { ...action, completionDate: "2026-10-01T10:00:00Z" } : action) }, "job", { reviewedByPersonId: person.id,
      revenueComplete: true, directCostsComplete: true, overheadCostsComplete: false, evidence: "Revenue/direct costs reconciled" }))
      .toThrow("supported delivery completion");
    source = { ...source, leads: [recordJobFinancialReview(source, "job", { reviewedByPersonId: person.id,
      revenueComplete: true, directCostsComplete: true, overheadCostsComplete: false, evidence: "Revenue/direct costs reconciled" })] };
    source = { ...source, lessons: [createCommercialLesson(source, "lesson", "job", {
      cause: "Labour estimation", attribution: "Supported contribution", evidence: "Cost and scope review",
      expectedDirectCost: "", estimateEvidence: "", changeKind: "Operating", ownerPersonId: person.id,
      recommendedChange: "Review access before scoping",
    })] };
    const assessment: IcarusAssessmentRecord = { id: "risk", outcome: "Continuity", status: "Open",
      createdAt: "2026-10-08T10:00:00Z", updatedAt: "2026-10-08T10:00:00Z", linkedRecords: [],
      failureModes: [{ id: "mode", mechanism: "Loss of continuity", vulnerability: "Protection unavailable", evidence: [{
        id: "evidence", statement: "Observed barrier", origin: "Direct observation", observedAt: "2026-10-08T10:00:00Z",
        recordedAt: "2026-10-08T10:00:00Z", recordedBy: person.id, review: "Unreviewed",
      }] }], controls: [{ id: "control", failureModeId: "mode", intervention: "Operating barrier",
        lifecycle: "Active", effectiveness: "Unknown", evidenceIds: ["evidence"], linkedRecords: [] }] };
    const stores: Record<string, string> = {
      [CONVERSION_STORAGE_KEY]: JSON.stringify([...source.actions, ...source.lessons]),
      [LEAD_STORAGE_KEY]: JSON.stringify(source.leads), [PERSON_STORAGE_KEY]: JSON.stringify(source.people),
      [INCOME_STORAGE_KEY]: JSON.stringify(source.income), [EXPENSE_STORAGE_KEY]: JSON.stringify(source.expenses),
      [ICARUS_STORAGE_KEY]: JSON.stringify([assessment]),
    };
    const backup = buildFullBackup({ getItem: (key) => stores[key] ?? null }, new Date(NOW).toISOString());
    const drill = runRecoveryDrill(JSON.stringify(backup));
    expect(drill.restored.storage).toEqual(backup.storage);
    const recovered: CommercialLearningInput = { ...source,
      people: JSON.parse(drill.restored.storage[PERSON_STORAGE_KEY]!),
      leads: JSON.parse(drill.restored.storage[LEAD_STORAGE_KEY]!), income: JSON.parse(drill.restored.storage[INCOME_STORAGE_KEY]!),
      expenses: JSON.parse(drill.restored.storage[EXPENSE_STORAGE_KEY]!),
      actions: JSON.parse(drill.restored.storage[CONVERSION_STORAGE_KEY]!).filter((record: { targetType: string }) => record.targetType === "Convert to Action"),
      lessons: JSON.parse(drill.restored.storage[CONVERSION_STORAGE_KEY]!).filter((record: { targetType: string }) => record.targetType === "Convert to Lesson"),
    };
    expect(getDeliveryIncomeEvidence(recovered.income[0], recovered)).toMatchObject({ earned: true, invoiced: true, received: true, validationErrors: [] });
    expect(buildJobPerformance(recovered)[0]).toMatchObject({ contribution: 600, reviewCurrent: true, profitAfterAllocatedCosts: null });
    expect(buildCommercialLearning(recovered)[0]).toMatchObject({ diagnosisCurrent: true, evaluationCurrent: false, outcome: "Unknown" });
    expect(parseIcarusAssessments(drill.restored.storage[ICARUS_STORAGE_KEY])[0].controls[0].effectiveness).toBe("Unknown");
  });
});
