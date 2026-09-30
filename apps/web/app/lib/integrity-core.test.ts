import { describe, expect, it } from "vitest";
import {
  findCrossTypeIdCollisions,
  findDuplicateIds,
  groupMissingCaptureLineage,
  summarizeIntegrityIssues,
  type IntegritySeverity,
} from "./integrity-core";

const ids = (...values: string[]) => values.map((id) => ({ id }));

describe("findDuplicateIds", () => {
  it("returns nothing when all IDs are unique", () => {
    expect(findDuplicateIds(ids("a", "b", "c")).size).toBe(0);
  });

  it("reports each duplicated ID with its count in first-occurrence order", () => {
    expect([...findDuplicateIds(ids("b", "a", "b", "c", "a", "b"))]).toEqual([["b", 3], ["a", 2]]);
  });

  it("ignores empty IDs", () => {
    expect(findDuplicateIds(ids("", "", "a")).size).toBe(0);
  });
});

describe("findCrossTypeIdCollisions", () => {
  it("detects the same ID across two record types", () => {
    const collisions = findCrossTypeIdCollisions([
      { type: "Action", records: ids("x", "a1") },
      { type: "Project", records: ids("x", "p1") },
    ]);
    expect([...collisions]).toEqual([["x", ["Action", "Project"]]]);
  });

  it("does not treat repeats within one type as a cross-type collision", () => {
    expect(findCrossTypeIdCollisions([
      { type: "Action", records: ids("x", "x") },
      { type: "Project", records: ids("p1") },
    ]).size).toBe(0);
  });

  it("excludes Capture conversion from cross-type checks", () => {
    expect(findCrossTypeIdCollisions([
      { type: "Capture conversion", records: ids("x") },
      { type: "Action", records: ids("x") },
    ]).size).toBe(0);
  });

  it("ignores empty IDs", () => {
    expect(findCrossTypeIdCollisions([
      { type: "Action", records: ids("") },
      { type: "Project", records: ids("") },
    ]).size).toBe(0);
  });
});

describe("groupMissingCaptureLineage", () => {
  it("groups every downstream record referencing the same missing Capture into one root", () => {
    const roots = groupMissingCaptureLineage(new Set(), [
      { captureId: "gone", recordType: "Action", recordTitle: "A", recordId: "a1" },
      { captureId: "gone", recordType: "Problem", recordTitle: "P", recordId: "p1" },
      { captureId: " gone ", recordType: "Project", recordTitle: "Pr", recordId: "pr1" },
    ]);
    expect([...roots.keys()]).toEqual(["gone"]);
    const root = roots.get("gone")!;
    expect([...root.records.values()]).toEqual([
      { recordType: "Action", recordTitle: "A", recordId: "a1" },
      { recordType: "Problem", recordTitle: "P", recordId: "p1" },
      { recordType: "Project", recordTitle: "Pr", recordId: "pr1" },
    ]);
    expect([...root.recordTypes]).toEqual(["Action", "Problem", "Project"]);
  });

  it("does not double-count a record whose two lineage fields reference the same missing Capture", () => {
    const roots = groupMissingCaptureLineage(new Set(), [
      { captureId: "gone", recordType: "Action", recordTitle: "A", recordId: "a1" },
      { captureId: "gone", recordType: "Action", recordTitle: "A", recordId: "a1" },
    ]);
    expect(roots.get("gone")!.records.size).toBe(1);
  });

  it("keeps same record ID under different record types distinct", () => {
    const roots = groupMissingCaptureLineage(new Set(), [
      { captureId: "gone", recordType: "Action", recordTitle: "A", recordId: "shared" },
      { captureId: "gone", recordType: "Lesson", recordTitle: "L", recordId: "shared" },
    ]);
    expect(roots.get("gone")!.records.size).toBe(2);
  });

  it("does not report valid or blank Capture references", () => {
    const roots = groupMissingCaptureLineage(new Set(["c1"]), [
      { captureId: "c1", recordType: "Action", recordTitle: "A", recordId: "a1" },
      { captureId: " c1 ", recordType: "Action", recordTitle: "A", recordId: "a2" },
      { captureId: "", recordType: "Action", recordTitle: "A", recordId: "a3" },
      { captureId: "   ", recordType: "Action", recordTitle: "A", recordId: "a4" },
      { captureId: undefined, recordType: "Action", recordTitle: "A", recordId: "a5" },
    ]);
    expect(roots.size).toBe(0);
  });
});

describe("summarizeIntegrityIssues", () => {
  const issue = (severity: IntegritySeverity, category: string) => ({ severity, category });

  it("counts severities", () => {
    const { severityCounts } = summarizeIntegrityIssues([
      issue("Critical", "A"), issue("Material", "A"), issue("Material", "B"), issue("Warning", "C"),
    ]);
    expect(severityCounts).toEqual({ Critical: 1, Material: 2, Warning: 1 });
  });

  it("sorts categories by descending count, then category name", () => {
    const { categoryCounts } = summarizeIntegrityIssues([
      issue("Warning", "Zeta"), issue("Warning", "Beta"), issue("Warning", "Alpha"),
      issue("Warning", "Zeta"), issue("Warning", "Beta"), issue("Warning", "Zeta"),
    ]);
    expect(categoryCounts).toEqual([
      { category: "Zeta", count: 3 },
      { category: "Beta", count: 2 },
      { category: "Alpha", count: 1 },
    ]);
  });

  it("is Healthy with no issues", () => {
    expect(summarizeIntegrityIssues([])).toEqual({
      status: "Healthy",
      severityCounts: { Critical: 0, Material: 0, Warning: 0 },
      categoryCounts: [],
    });
  });

  it("is Needs attention with only Warning or Material issues", () => {
    expect(summarizeIntegrityIssues([issue("Warning", "A")]).status).toBe("Needs attention");
    expect(summarizeIntegrityIssues([issue("Material", "A"), issue("Material", "B"), issue("Material", "C")]).status).toBe("Needs attention");
  });

  it("is Integrity risk with any Critical issue", () => {
    expect(summarizeIntegrityIssues([issue("Critical", "A")]).status).toBe("Integrity risk");
    expect(summarizeIntegrityIssues([issue("Warning", "A"), issue("Critical", "B")]).status).toBe("Integrity risk");
  });
});
