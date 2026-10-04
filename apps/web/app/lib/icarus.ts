import { isValidCalendarDateInput } from "./dates";

export const ICARUS_STORAGE_KEY = "empire-os-icarus-assessments";

export const ICARUS_SOURCE_TYPES = [
  "Capture",
  "Problem",
  "Action",
  "Decision",
  "Lesson",
  "Project",
  "System",
  "SOP",
  "Opportunity",
  "Lead",
  "Outreach",
  "Commitment",
  "Finance",
  "Person",
  "Pillar",
  "Strategic Objective",
] as const;

export type IcarusSourceType = (typeof ICARUS_SOURCE_TYPES)[number];

export type IcarusRecordReference = {
  recordType: IcarusSourceType;
  recordId: string;
};

export type IcarusEvidenceReview =
  | "Unreviewed"
  | "Supports"
  | "Contradicts"
  | "Unresolved";

export type IcarusEvidence = {
  id: string;
  statement: string;
  origin: "Source record" | "Direct observation";
  reference?: IcarusRecordReference;
  observedAt?: string;
  recordedAt: string;
  recordedBy: string;
  review: IcarusEvidenceReview;
  reviewedAt?: string;
  reviewedBy?: string;
  validUntil?: string;
};

export type IcarusFailureMode = {
  id: string;
  mechanism: string;
  vulnerability: string;
  evidence: IcarusEvidence[];
};

export type IcarusControlLifecycle =
  | "Planned"
  | "Active"
  | "Monitoring"
  | "Ineffective"
  | "Retired";

export type IcarusControlEffectiveness =
  | "Unknown"
  | "Untested"
  | "Weak"
  | "Evidence supports"
  | "Evidence contradicts"
  | "Unresolved";

export type IcarusControl = {
  id: string;
  failureModeId: string;
  intervention: string;
  lifecycle: IcarusControlLifecycle;
  effectiveness: IcarusControlEffectiveness;
  effectivenessReviewedAt?: string;
  effectivenessReviewedBy?: string;
  evidenceIds: string[];
  linkedRecords: IcarusRecordReference[];
  nextReviewAt?: string;
};

export type IcarusAssessmentStatus = "Open" | "Monitoring" | "Closed";

export type IcarusAssessmentRecord = {
  id: string;
  outcome: string;
  status: IcarusAssessmentStatus;
  createdAt: string;
  updatedAt: string;
  linkedRecords: IcarusRecordReference[];
  failureModes: IcarusFailureMode[];
  controls: IcarusControl[];
};

export type IcarusSourceRecord = IcarusRecordReference & {
  title: string;
};

export type IcarusEvidenceFreshness =
  | "Current"
  | "Not time-bounded"
  | "Stale"
  | "Invalid";

export type IcarusReviewFindingCode =
  | "missing-outcome"
  | "no-failure-modes"
  | "incomplete-failure-mode"
  | "no-evidence"
  | "unreviewed-evidence"
  | "unresolved-evidence"
  | "stale-evidence"
  | "invalid-evidence"
  | "conflicting-evidence"
  | "missing-source"
  | "missing-control"
  | "planned-control"
  | "untested-control"
  | "missing-control-review"
  | "weak-control"
  | "stale-control-review"
  | "invalid-control-review"
  | "invalid-control-assessment"
  | "ineffective-control"
  | "contradicted-control";

export type IcarusReviewFinding = {
  code: IcarusReviewFindingCode;
  assessmentId: string;
  failureModeId?: string;
  evidenceId?: string;
  controlId?: string;
  recordReference?: IcarusRecordReference;
  message: string;
};

export type IcarusReview = {
  assessmentId: string;
  findings: IcarusReviewFinding[];
};

const evidenceReviews: readonly IcarusEvidenceReview[] = [
  "Unreviewed",
  "Supports",
  "Contradicts",
  "Unresolved",
];
const assessmentStatuses: readonly IcarusAssessmentStatus[] = ["Open", "Monitoring", "Closed"];
const controlLifecycles: readonly IcarusControlLifecycle[] = [
  "Planned",
  "Active",
  "Monitoring",
  "Ineffective",
  "Retired",
];
const controlEffectiveness: readonly IcarusControlEffectiveness[] = [
  "Unknown",
  "Untested",
  "Weak",
  "Evidence supports",
  "Evidence contradicts",
  "Unresolved",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseReviewDeadline(value: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !isValidCalendarDateInput(value)) return Number.NaN;
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T23:59:59.999Z`)
    : Date.parse(value);
}

function isValidIcarusDate(value: string): boolean {
  const calendarDate = value.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/)?.[1];
  return (!calendarDate || isValidCalendarDateInput(calendarDate)) && !Number.isNaN(Date.parse(value));
}

export function getIcarusIdentityKey(assessmentId: string): string {
  return `icarus-assessment:${assessmentId}`;
}

export function getIcarusReferenceKey(reference: IcarusRecordReference): string {
  return `${reference.recordType}:${reference.recordId}`;
}

export function isIcarusRecordReference(value: unknown): value is IcarusRecordReference {
  return isPlainObject(value)
    && ICARUS_SOURCE_TYPES.includes(value.recordType as IcarusSourceType)
    && isNonEmptyString(value.recordId);
}

function isIcarusEvidence(value: unknown): value is IcarusEvidence {
  if (!isPlainObject(value)
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.statement)
    || (value.origin !== "Source record" && value.origin !== "Direct observation")
    || !isNonEmptyString(value.recordedAt)
    || !isNonEmptyString(value.recordedBy)
    || !evidenceReviews.includes(value.review as IcarusEvidenceReview)) {
    return false;
  }
  if (value.origin === "Source record" && !isIcarusRecordReference(value.reference)) return false;
  if (value.origin === "Direct observation"
    && (value.reference !== undefined || !isNonEmptyString(value.observedAt))) return false;
  if (value.reference !== undefined && !isIcarusRecordReference(value.reference)) return false;
  if (value.observedAt !== undefined && typeof value.observedAt !== "string") return false;
  if (value.validUntil !== undefined && typeof value.validUntil !== "string") return false;
  if (value.review !== "Unreviewed"
    && (!isNonEmptyString(value.reviewedAt) || !isNonEmptyString(value.reviewedBy))) return false;
  if (value.review === "Unreviewed" && (value.reviewedAt !== undefined || value.reviewedBy !== undefined)) return false;
  return true;
}

export function isIcarusAssessmentRecord(value: unknown): value is IcarusAssessmentRecord {
  if (!isPlainObject(value)
    || !isNonEmptyString(value.id)
    || typeof value.outcome !== "string"
    || !assessmentStatuses.includes(value.status as IcarusAssessmentStatus)
    || !isNonEmptyString(value.createdAt)
    || !isNonEmptyString(value.updatedAt)
    || !Array.isArray(value.linkedRecords)
    || !value.linkedRecords.every(isIcarusRecordReference)
    || !Array.isArray(value.failureModes)
    || !value.failureModes.every((mode: unknown) =>
      isPlainObject(mode)
      && isNonEmptyString(mode.id)
      && typeof mode.mechanism === "string"
      && typeof mode.vulnerability === "string"
      && Array.isArray(mode.evidence)
      && mode.evidence.every(isIcarusEvidence))
    || !Array.isArray(value.controls)
    || !value.controls.every((control: unknown) =>
      isPlainObject(control)
      && isNonEmptyString(control.id)
      && isNonEmptyString(control.failureModeId)
      && isNonEmptyString(control.intervention)
      && controlLifecycles.includes(control.lifecycle as IcarusControlLifecycle)
      && controlEffectiveness.includes(control.effectiveness as IcarusControlEffectiveness)
      && (control.effectivenessReviewedAt === undefined || typeof control.effectivenessReviewedAt === "string")
      && (control.effectivenessReviewedBy === undefined || typeof control.effectivenessReviewedBy === "string")
      && (control.effectiveness === "Unknown"
        ? control.effectivenessReviewedAt === undefined && control.effectivenessReviewedBy === undefined
        : isNonEmptyString(control.effectivenessReviewedAt) && isNonEmptyString(control.effectivenessReviewedBy))
      && Array.isArray(control.evidenceIds)
      && control.evidenceIds.every(isNonEmptyString)
      && Array.isArray(control.linkedRecords)
      && control.linkedRecords.every(isIcarusRecordReference)
      && (control.nextReviewAt === undefined || typeof control.nextReviewAt === "string"))) {
    return false;
  }
  return true;
}

function assertUniqueIds(ids: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Icarus contains a duplicate ${label} ID: ${id}.`);
    seen.add(id);
  }
}

export function assertIcarusDataStructure(value: unknown): asserts value is IcarusAssessmentRecord[] {
  if (!Array.isArray(value) || !value.every(isIcarusAssessmentRecord)) {
    throw new Error("Icarus data must be an array of valid assessment records.");
  }

  assertUniqueIds(value.map((assessment) => assessment.id), "assessment");
  const failureModeIds: string[] = [];
  const evidenceIds: string[] = [];
  const controlIds: string[] = [];

  for (const assessment of value) {
    const modes = new Map(assessment.failureModes.map((mode) => [mode.id, mode] as const));
    for (const mode of assessment.failureModes) {
      failureModeIds.push(mode.id);
      evidenceIds.push(...mode.evidence.map((evidence) => evidence.id));
    }
    for (const control of assessment.controls) {
      controlIds.push(control.id);
      if (!modes.has(control.failureModeId)) {
        throw new Error(`Icarus control ${control.id} references missing failure mode ${control.failureModeId}.`);
      }
      const modeEvidenceIds = new Set(modes.get(control.failureModeId)!.evidence.map((evidence) => evidence.id));
      if (control.evidenceIds.some((id) => !modeEvidenceIds.has(id))) {
        throw new Error(`Icarus control ${control.id} references evidence outside its failure mode.`);
      }
      assertUniqueIds(control.evidenceIds, `control evidence for ${control.id}`);
      assertUniqueIds(control.linkedRecords.map(getIcarusReferenceKey), `linked record for control ${control.id}`);
    }
    assertUniqueIds(assessment.linkedRecords.map(getIcarusReferenceKey), `linked record for assessment ${assessment.id}`);
  }

  assertUniqueIds(failureModeIds, "failure mode");
  assertUniqueIds(evidenceIds, "evidence");
  assertUniqueIds(controlIds, "control");
}

export function parseIcarusAssessments(storedValue: string | null): IcarusAssessmentRecord[] {
  const parsed: unknown = storedValue === null ? [] : JSON.parse(storedValue);
  assertIcarusDataStructure(parsed);
  return parsed;
}

export function classifyIcarusEvidenceFreshness(
  evidence: Pick<IcarusEvidence, "recordedAt" | "observedAt" | "validUntil" | "reviewedAt">,
  nowMs = Date.now(),
): IcarusEvidenceFreshness {
  const dates = [evidence.recordedAt, evidence.observedAt, evidence.validUntil, evidence.reviewedAt].filter(
    (date): date is string => date !== undefined,
  );
  if (dates.some((date) => !isValidIcarusDate(date))) return "Invalid";
  if (evidence.validUntil === undefined) return "Not time-bounded";
  return parseReviewDeadline(evidence.validUntil) < nowMs ? "Stale" : "Current";
}

export function buildIcarusReview(
  assessments: readonly IcarusAssessmentRecord[],
  sourceRecords: readonly IcarusSourceRecord[],
  nowMs = Date.now(),
): IcarusReview[] {
  const sourceKeys = new Set(sourceRecords.map(getIcarusReferenceKey));

  return assessments.map((assessment) => {
    const findings: IcarusReviewFinding[] = [];
    const addFinding = (
      code: IcarusReviewFindingCode,
      details: Omit<IcarusReviewFinding, "code" | "assessmentId" | "message">,
      message: string,
    ) => findings.push({ code, assessmentId: assessment.id, ...details, message });

    if (!assessment.outcome.trim()) {
      addFinding("missing-outcome", {}, "The failure outcome has not been stated.");
    }
    if (assessment.failureModes.length === 0) {
      addFinding("no-failure-modes", {}, "No failure mechanism has been recorded for this outcome.");
    }
    assessment.failureModes.forEach((mode) => {
      if (!mode.mechanism.trim() || !mode.vulnerability.trim()) {
        addFinding("incomplete-failure-mode", { failureModeId: mode.id }, "The failure mechanism or current vulnerability is incomplete.");
      }
      const usableEvidence: IcarusEvidence[] = [];
      mode.evidence.forEach((evidence) => {
        const freshness = classifyIcarusEvidenceFreshness(evidence, nowMs);
        if (freshness === "Invalid") {
          addFinding("invalid-evidence", { failureModeId: mode.id, evidenceId: evidence.id }, "Evidence has an invalid date and cannot support a current conclusion.");
        } else if (freshness === "Stale") {
          addFinding("stale-evidence", { failureModeId: mode.id, evidenceId: evidence.id }, "Evidence has passed its recorded validity date and needs review.");
        } else if (evidence.reference && !sourceKeys.has(getIcarusReferenceKey(evidence.reference))) {
          addFinding(
            "missing-source",
            { failureModeId: mode.id, evidenceId: evidence.id, recordReference: evidence.reference },
            `Evidence points to a missing ${evidence.reference.recordType} record ${evidence.reference.recordId}.`,
          );
        } else {
          usableEvidence.push(evidence);
          if (evidence.review === "Unreviewed") {
            addFinding("unreviewed-evidence", { failureModeId: mode.id, evidenceId: evidence.id }, "Evidence has not been reviewed by a named person.");
          } else if (evidence.review === "Unresolved") {
            addFinding("unresolved-evidence", { failureModeId: mode.id, evidenceId: evidence.id }, "Evidence has been reviewed but remains unresolved.");
          }
        }
      });

      const reviewedEvidence = usableEvidence.filter((evidence) =>
        evidence.review === "Supports" || evidence.review === "Contradicts");
      if (reviewedEvidence.length === 0) {
        addFinding("no-evidence", { failureModeId: mode.id }, "No current, reviewed evidence supports or challenges this failure mechanism.");
      }
      if (reviewedEvidence.some((evidence) => evidence.review === "Supports")
        && reviewedEvidence.some((evidence) => evidence.review === "Contradicts")) {
        addFinding("conflicting-evidence", { failureModeId: mode.id }, "Current evidence both supports and contradicts this failure mechanism.");
      }

      const controls = assessment.controls.filter((control) => control.failureModeId === mode.id);
      const operatingControls = controls.filter((control) =>
        control.lifecycle === "Active" || control.lifecycle === "Monitoring");
      if (controls.length === 0 || (controls.length > 0 && operatingControls.length === 0
        && controls.every((control) => control.lifecycle === "Retired"))) {
        addFinding("missing-control", { failureModeId: mode.id }, "No operating control or intervention is linked to this failure mechanism.");
      }
      controls.forEach((control) => {
        control.linkedRecords.forEach((reference) => {
          if (!sourceKeys.has(getIcarusReferenceKey(reference))) {
            addFinding("missing-source", {
              failureModeId: mode.id,
              controlId: control.id,
              recordReference: reference,
            }, `Control link to ${reference.recordType} ${reference.recordId} is unresolved.`);
          }
        });
        if (control.effectivenessReviewedAt !== undefined && !isValidIcarusDate(control.effectivenessReviewedAt)) {
          addFinding("invalid-control-assessment", { failureModeId: mode.id, controlId: control.id }, "The control effectiveness assessment date is invalid.");
        }
        if (control.lifecycle === "Active" || control.lifecycle === "Monitoring") {
          if (control.nextReviewAt === undefined) {
            addFinding("missing-control-review", { failureModeId: mode.id, controlId: control.id }, "No next review is recorded for this operating control.");
          } else {
            const reviewDeadline = parseReviewDeadline(control.nextReviewAt);
            if (Number.isNaN(reviewDeadline)) {
              addFinding("invalid-control-review", { failureModeId: mode.id, controlId: control.id }, "The control review date is invalid.");
            } else if (reviewDeadline < nowMs) {
              addFinding("stale-control-review", { failureModeId: mode.id, controlId: control.id }, "The control review date has passed.");
            }
          }
        }
        const controlEvidence = usableEvidence.filter((evidence) => control.evidenceIds.includes(evidence.id));
        const hasSupportingEvidence = controlEvidence.some((evidence) => evidence.review === "Supports");
        const hasContradictingEvidence = controlEvidence.some((evidence) => evidence.review === "Contradicts");
        if (control.lifecycle === "Ineffective") {
          addFinding("ineffective-control", { failureModeId: mode.id, controlId: control.id }, "This control is recorded as ineffective.");
        } else if (control.effectiveness === "Weak") {
          addFinding("weak-control", { failureModeId: mode.id, controlId: control.id }, "This control is explicitly assessed as weak and needs review or strengthening.");
        } else if (control.lifecycle === "Planned") {
          addFinding("planned-control", { failureModeId: mode.id, controlId: control.id }, "This control is planned but is not recorded as operating.");
        } else if (control.lifecycle !== "Retired"
          && (control.effectiveness === "Unknown" || control.effectiveness === "Untested" || control.effectiveness === "Unresolved")) {
          addFinding("untested-control", { failureModeId: mode.id, controlId: control.id }, "This operating control has no resolved effectiveness assessment.");
        }

        if (control.effectiveness === "Evidence contradicts" && hasContradictingEvidence) {
          addFinding("contradicted-control", { failureModeId: mode.id, controlId: control.id }, "Current linked evidence contradicts this control's effectiveness.");
        } else if (control.effectiveness === "Evidence contradicts" && !hasContradictingEvidence) {
          addFinding("untested-control", { failureModeId: mode.id, controlId: control.id }, "Control effectiveness is marked as contradicted but has no current, reviewed contradicting evidence linked to it.");
        }
        if (control.effectiveness === "Evidence supports" && !hasSupportingEvidence) {
          addFinding("untested-control", { failureModeId: mode.id, controlId: control.id }, "Control effectiveness is marked as supported but has no current, reviewed supporting evidence linked to it.");
        }
        if (hasSupportingEvidence && hasContradictingEvidence) {
          addFinding("conflicting-evidence", { failureModeId: mode.id, controlId: control.id }, "Evidence linked to this control both supports and contradicts its effectiveness.");
        }
      });

    });

    assessment.linkedRecords.forEach((reference) => {
      if (!sourceKeys.has(getIcarusReferenceKey(reference))) {
        addFinding("missing-source", { recordReference: reference }, `Assessment link to ${reference.recordType} ${reference.recordId} is unresolved.`);
      }
    });

    return { assessmentId: assessment.id, findings };
  });
}
