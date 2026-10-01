import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeActionRecord,
  normalizeDecisionRecord,
  normalizeLessonRecord,
  normalizeOpportunityRecord,
  normalizeProblemRecord,
  normalizeSopRecord,
  normalizeSystemRecord,
  type CaptureConversionRecord,
} from "./capture-conversions";

function makeConversion(
  overrides: Partial<CaptureConversionRecord> = {},
): CaptureConversionRecord {
  return {
    id: "conversion-1",
    sourceCaptureId: "capture-1",
    targetType: "Convert to Action",
    createdAt: "2026-10-01T12:00:00.000Z",
    title: "Captured title",
    originalRawNote: "Captured note",
    relatedArea: "Garden Maintenance",
    importance: "Medium",
    status: "Converted",
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("capture conversion record normalization", () => {
  it("normalizes Problems and promotes a valid generic status", () => {
    const result = normalizeProblemRecord(
      makeConversion({
        title: "  Captured title  ",
        problemStatement: "  Damaged gate  ",
        status: "Resolved",
        impact: "  Delayed access  ",
      }),
    );

    expect(result.problemStatement).toBe("Damaged gate");
    expect(result.status).toBe("Resolved");
    expect(result.problemStatus).toBe("Resolved");
    expect(result.severity).toBe("Medium");
    expect(result.frequency).toBe("Occasional");
    expect(result.impact).toBe("Delayed access");
    expect(
      normalizeProblemRecord(makeConversion({ title: "  Captured title  " })).problemStatement,
    ).toBe("  Captured title  ");
  });

  it("normalizes Actions using legacy description, lineage and status fallbacks", () => {
    const result = normalizeActionRecord(
      makeConversion({
        title: "  Repair gate  ",
        actionDescription: "  Repair the damaged gate  ",
        status: "Converted",
        relatedArea: "People",
      }),
    );

    expect(result.actionTitle).toBe("Repair gate");
    expect(result.description).toBe("Repair the damaged gate");
    expect(result.status).toBe("Open");
    expect(result.relatedCapture).toBe("capture-1");
    expect(result.relatedPillar).toBe("People");
    expect(result.createdDate).toBe("2026-10-01T12:00:00.000Z");
  });

  it("normalizes Decisions from captured fields and defaults", () => {
    const result = normalizeDecisionRecord(
      makeConversion({
        status: "Active",
        decisionTitle: "  Replace the supplier  ",
        decisionMaker: "  Founder  ",
      }),
    );

    expect(result.decisionTitle).toBe("Replace the supplier");
    expect(result.decisionStatement).toBe("Captured title");
    expect(result.decisionMaker).toBe("Founder");
    expect(result.status).toBe("Active");
    expect(result.decisionStatus).toBe("Active");
    expect(result.decisionDate).toBe("2026-10-01T12:00:00.000Z");
    expect(result.riskLevel).toBe("Medium");
  });

  it("normalizes Opportunities from legacy description and capture metadata", () => {
    const result = normalizeOpportunityRecord(
      makeConversion({
        opportunityDescription: "  Offer seasonal maintenance  ",
        status: "Evaluating",
      }),
    );

    expect(result.opportunityTitle).toBe("Captured title");
    expect(result.description).toBe("Offer seasonal maintenance");
    expect(result.relatedPillar).toBe("Garden Maintenance");
    expect(result.status).toBe("Evaluating");
    expect(result.dateIdentified).toBe("2026-10-01T12:00:00.000Z");
    expect(result.source).toBe("Unknown");
  });

  it("normalizes Lessons from legacy description and related area", () => {
    const result = normalizeLessonRecord(
      makeConversion({
        lessonDescription: "  Confirm access before scheduling  ",
        relatedArea: "Systems",
        status: "Reviewed",
      }),
    );

    expect(result.lessonTitle).toBe("Captured title");
    expect(result.description).toBe("Confirm access before scheduling");
    expect(result.relatedPillar).toBe("Systems");
    expect(result.status).toBe("Reviewed");
    expect(result.dateLearned).toBe("2026-10-01T12:00:00.000Z");
  });

  it("normalizes Systems from capture metadata and purpose fallbacks", () => {
    const result = normalizeSystemRecord(
      makeConversion({
        purpose: "  Standardize site handover  ",
        relatedPillar: "Operations",
      }),
    );

    expect(result.systemName).toBe("Captured title");
    expect(result.purpose).toBe("Standardize site handover");
    expect(result.process).toBe("Standardize site handover");
    expect(result.area).toBe("Operations");
    expect(result.relatedCapture).toBe("capture-1");
    expect(result.version).toBe("v1");
  });

  it("normalizes SOPs from System fields and defaults current-time dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T08:30:00.000Z"));

    const result = normalizeSopRecord(
      makeConversion({
        createdAt: "",
        process: "  Inspect, clean, record  ",
        standards: "  Site left clear  ",
      }),
    );

    expect(result.sopTitle).toBe("Captured title");
    expect(result.procedure).toBe("Inspect, clean, record");
    expect(result.qualityStandard).toBe("Site left clear");
    expect(result.status).toBe("Draft");
    expect(result.effectiveDate).toBe("2026-10-02T08:30:00.000Z");
  });
});
