export type IntegritySeverity = "Critical" | "Material" | "Warning";
export type IntegrityStatus = "Healthy" | "Needs attention" | "Integrity risk";

// Returns only IDs that occur 2+ times, in first-occurrence order; empty IDs are ignored.
export function findDuplicateIds(records: Array<{ id: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (record.id) counts.set(record.id, (counts.get(record.id) || 0) + 1);
  }
  const duplicates = new Map<string, number>();
  for (const [recordId, count] of counts) {
    if (count >= 2) duplicates.set(recordId, count);
  }
  return duplicates;
}

export const CROSS_TYPE_EXCLUDED_COLLECTION_TYPES: readonly string[] = ["Capture conversion"];

export function findCrossTypeIdCollisions(collections: Array<{ type: string; records: Array<{ id: string }> }>): Map<string, string[]> {
  const crossTypeIds = new Map<string, Set<string>>();
  for (const collection of collections.filter((entry) => !CROSS_TYPE_EXCLUDED_COLLECTION_TYPES.includes(entry.type))) {
    for (const record of collection.records) {
      if (!record.id) continue;
      if (!crossTypeIds.has(record.id)) crossTypeIds.set(record.id, new Set());
      crossTypeIds.get(record.id)!.add(collection.type);
    }
  }
  const collisions = new Map<string, string[]>();
  for (const [recordId, types] of crossTypeIds) {
    if (types.size >= 2) collisions.set(recordId, Array.from(types));
  }
  return collisions;
}

export type CaptureLineageReference = {
  captureId: string | undefined;
  recordType: string;
  recordTitle: string;
  recordId: string;
};

export type MissingCaptureLineageRoot = {
  records: Map<string, { recordType: string; recordTitle: string; recordId: string }>;
  recordTypes: Set<string>;
};

export function groupMissingCaptureLineage(validCaptureIds: Set<string>, references: CaptureLineageReference[]): Map<string, MissingCaptureLineageRoot> {
  const roots = new Map<string, MissingCaptureLineageRoot>();
  for (const { captureId, recordType, recordTitle, recordId } of references) {
    const missingCaptureId = captureId?.trim();
    if (!missingCaptureId || validCaptureIds.has(missingCaptureId)) continue;
    if (!roots.has(missingCaptureId)) {
      roots.set(missingCaptureId, { records: new Map(), recordTypes: new Set() });
    }
    const root = roots.get(missingCaptureId)!;
    root.records.set(`${recordType}:${recordId}`, { recordType, recordTitle, recordId });
    root.recordTypes.add(recordType);
  }
  return roots;
}

export function summarizeIntegrityIssues(issues: Array<{ severity: IntegritySeverity; category: string }>): {
  status: IntegrityStatus;
  severityCounts: Record<IntegritySeverity, number>;
  categoryCounts: Array<{ category: string; count: number }>;
} {
  const severityCounts: Record<IntegritySeverity, number> = { Critical: 0, Material: 0, Warning: 0 };
  const categories = new Map<string, number>();
  for (const issue of issues) {
    severityCounts[issue.severity] += 1;
    categories.set(issue.category, (categories.get(issue.category) || 0) + 1);
  }
  return {
    status: severityCounts.Critical > 0 ? "Integrity risk" : issues.length > 0 ? "Needs attention" : "Healthy",
    severityCounts,
    categoryCounts: Array.from(categories, ([category, count]) => ({ category, count })).sort((first, second) => second.count - first.count || first.category.localeCompare(second.category)),
  };
}
