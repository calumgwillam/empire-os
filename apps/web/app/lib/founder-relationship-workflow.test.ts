import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FounderRelationshipPanel from "../components/founder-relationship-panel";
import {
  createFounderRelationshipRecord,
  normaliseFounderIntelligence,
  type FounderIntelligence,
  type FounderIntelligenceContext,
} from "./founder-intelligence";
import {
  getFounderRelationshipEvidenceOptions,
  recordFounderRelationshipDraft,
  reviewFounderRelationshipEvidence,
  type FounderRelationshipDraft,
} from "./founder-relationship-workflow";
import { calumLeadershipReflectionSubmission, lewisLeadershipAlignmentSubmission } from "./operating-profile-evidence";

function context(): FounderIntelligenceContext {
  return {
    people: [
      { id: "founder-a", accessLevel: "Founder", operatingProfile: { sourceSubmissions: [calumLeadershipReflectionSubmission] } },
      { id: "founder-b", accessLevel: "Founder", operatingProfile: { sourceSubmissions: [lewisLeadershipAlignmentSubmission] } },
      { id: "employee", accessLevel: "Team Member" },
    ],
    workItems: [{ objectType: "Action", objectId: "action-1" }],
    operationalEvidence: [{
      personId: "founder-a", recordType: "Action", recordId: "action-1", outcomeId: "outcome-1",
      contribution: "reviewer", outcome: "successful", observedResult: "Recorded review result.",
    }],
  };
}

function empty(): FounderIntelligence {
  return normaliseFounderIntelligence(null, context());
}

function draft(overrides: Partial<FounderRelationshipDraft> = {}): FounderRelationshipDraft {
  const pair = createFounderRelationshipRecord(["founder-a", "founder-b"], context());
  const options = getFounderRelationshipEvidenceOptions(pair, "source-grounded-understanding", context());
  return {
    observationKey: "human-entry", personIds: ["founder-a", "founder-b"],
    kind: "source-grounded-understanding", dimension: "standards",
    statement: "A human-authored description of stated standards.",
    evidenceKeys: [options[0].key], keepUnresolved: false,
    ...overrides,
  };
}

describe("founder relationship authoring and review integration", () => {
  const renderPanel = (personId: string, writable = true) => renderToStaticMarkup(createElement(
    FounderRelationshipPanel,
    {
      personId, intelligence: empty(), context: context(), writable,
      personName: (id: string) => id === "employee" ? "Employee name" : id,
      evidenceDetails: () => [],
      onRecord: () => { throw new Error("Rendering must not record evidence."); },
      onReview: () => { throw new Error("Rendering must not persist a review."); },
      newObservationKey: () => "new-key",
    },
  ));

  it("renders a discoverable founder workflow without offering employee partners or inventing records", () => {
    const markup = renderPanel("founder-a");
    expect(markup).toContain("Founder relationship authoring and review");
    expect(markup).toContain('value="founder-b"');
    expect(markup).not.toContain('value="employee"');
    expect(markup).not.toContain("Employee name");
    expect(markup).toContain("Existing working relationships remain separate");
    expect(markup).not.toContain("A human-authored description");
  });

  it("does not render founder authoring for a saved employee People record", () => {
    expect(renderPanel("employee")).toBe("");
  });

  it("exposes blocked persistence rather than presenting unsafe authoring as writable", () => {
    expect(renderPanel("founder-a", false)).toContain("Authoring is blocked");
  });

  it("records source understanding through canonical APIs without changing other intelligence or People", () => {
    const evidenceContext = context();
    const intelligence = empty();
    const before = structuredClone({ intelligence, evidenceContext });
    const result = recordFounderRelationshipDraft(intelligence, draft(), evidenceContext);
    expect(result.pairRecords[0].observations[0]).toMatchObject({
      id: "pair:founder-a:founder-b:relationship:human-entry",
      relationshipKind: "source-grounded-understanding",
      claim: { status: "evidence-grounded-understanding", statement: draft().statement },
    });
    expect(result.responsibilityFits).toBe(intelligence.responsibilityFits);
    expect(result.operationalOutcomes).toBe(intelligence.operationalOutcomes);
    expect({ intelligence, evidenceContext }).toEqual(before);
  });

  it("offers different evidence choices for each kind without using stored assertions as independent evidence", () => {
    const pair = createFounderRelationshipRecord(draft().personIds, context());
    const sourceOptions = getFounderRelationshipEvidenceOptions(pair, "source-grounded-understanding", context());
    expect(sourceOptions.every((option) => option.reference.type === "source-answer")).toBe(true);
    const executionOptions = getFounderRelationshipEvidenceOptions(pair, "operating-observation", context());
    expect(executionOptions).toHaveLength(1);
    expect(executionOptions[0].reference).toMatchObject({ type: "operational-outcome", recordId: "action-1" });
    expect(getFounderRelationshipEvidenceOptions(pair, "operating-observation", {
      ...context(), operationalEvidence: [],
    })).toEqual([]);
    expect(getFounderRelationshipEvidenceOptions(pair, "compatibility-interpretation", context())
      .some((option) => option.reference.type === "operational-outcome")).toBe(false);
  });

  it("requires bilateral support for compatibility, retaining partial support as unresolved", () => {
    const pair = createFounderRelationshipRecord(draft().personIds, context());
    const options = getFounderRelationshipEvidenceOptions(pair, "compatibility-interpretation", context());
    const first = options.find((option) => option.reference.type === "source-answer" && option.reference.personId === "founder-a")!;
    const second = options.find((option) => option.reference.type === "source-answer" && option.reference.personId === "founder-b")!;
    const partial = recordFounderRelationshipDraft(empty(), draft({
      kind: "compatibility-interpretation", evidenceKeys: [first.key],
    }), context());
    expect(partial.pairRecords[0].observations[0].claim.status).toBe("unresolved");
    const bilateral = recordFounderRelationshipDraft(empty(), draft({
      kind: "compatibility-interpretation", evidenceKeys: [first.key, second.key],
    }), context());
    expect(bilateral.pairRecords[0].observations[0].claim.status).toBe("supported-interpretation");
    expect(bilateral.responsibilityFits).toEqual([]);
  });

  it("lets human authors deliberately retain uncertainty without silently upgrading on review", () => {
    const result = recordFounderRelationshipDraft(empty(), draft({
      keepUnresolved: true, evidenceKeys: [],
    }), context());
    expect(result.pairRecords[0].observations[0].claim.status).toBe("unresolved");
    expect(reviewFounderRelationshipEvidence(result, context()).pairRecords[0].observations[0].claim.status)
      .toBe("unresolved");
    expect(() => recordFounderRelationshipDraft(empty(), draft({ evidenceKeys: [] }), context()))
      .toThrow("Select evidence or explicitly record this as unresolved");
  });

  it("rejects stale or cross-kind selections instead of silently dropping them", () => {
    expect(() => recordFounderRelationshipDraft(empty(), draft({ evidenceKeys: ["missing-reference"] }), context()))
      .toThrow("no longer available");
    expect(() => recordFounderRelationshipDraft(empty(), draft({ kind: "operating-observation" }), context()))
      .toThrow("no longer available");
    expect(() => recordFounderRelationshipDraft(empty(), draft(), {
      ...context(), people: context().people.map((person) => ({ ...person, operatingProfile: undefined })),
    })).toThrow("no longer available");
  });

  it("requires saved Founder access and never infers it from employee responsibility", () => {
    expect(() => recordFounderRelationshipDraft(empty(), draft({
      personIds: ["founder-a", "employee"],
    }), context())).toThrow("Founder access");
    expect(() => recordFounderRelationshipDraft(empty(), draft(), {
      ...context(), people: context().people.map((person) => ({ ...person, accessLevel: "Team Member" })),
    })).toThrow("Founder access");
  });

  it("validates human-authored content and directional founder attribution", () => {
    expect(() => recordFounderRelationshipDraft(empty(), draft({ statement: " " }), context())).toThrow("human-authored statement");
    expect(() => recordFounderRelationshipDraft(empty(), draft({ dimension: "" }), context())).toThrow("relationship dimension");
    expect(() => recordFounderRelationshipDraft(empty(), draft({ fromPersonId: "employee" }), context())).toThrow("Directional understanding");
    const directed = recordFounderRelationshipDraft(empty(), draft({ fromPersonId: "founder-a" }), context());
    expect(directed.pairRecords[0].observations[0].direction).toEqual({ fromPersonId: "founder-a", toPersonId: "founder-b" });
  });

  it("records operating observations only with independent available execution citations", () => {
    const pair = createFounderRelationshipRecord(draft().personIds, context());
    const options = getFounderRelationshipEvidenceOptions(pair, "operating-observation", context());
    const result = recordFounderRelationshipDraft(empty(), draft({
      kind: "operating-observation", evidenceKeys: [options[0].key],
    }), context());
    expect(result.pairRecords[0].observations[0].claim.status).toBe("evidence-grounded-understanding");
    expect(result.operationalOutcomes).toEqual([]);
    const withoutRecord = recordFounderRelationshipDraft(empty(), draft({
      kind: "operating-observation", evidenceKeys: [options[0].key],
    }), { ...context(), workItems: [] });
    expect(withoutRecord.pairRecords[0].observations[0].claim.status).toBe("unresolved");
  });

  it("allows supported base observations, but never compatibility interpretations, as interpretation provenance", () => {
    let result = recordFounderRelationshipDraft(empty(), draft(), context());
    const secondSource = getFounderRelationshipEvidenceOptions(result.pairRecords[0], "source-grounded-understanding", context())
      .find((option) => option.reference.type === "source-answer" && option.reference.personId === "founder-b")!;
    result = recordFounderRelationshipDraft(result, draft({
      observationKey: "second-source", evidenceKeys: [secondSource.key],
    }), context());
    const baseOptions = getFounderRelationshipEvidenceOptions(result.pairRecords[0], "compatibility-interpretation", context())
      .filter((option) => option.reference.type === "pair-observation");
    expect(baseOptions).toHaveLength(2);
    const interpreted = recordFounderRelationshipDraft(result, draft({
      observationKey: "interpretation", kind: "compatibility-interpretation",
      evidenceKeys: baseOptions.map((option) => option.key),
    }), context());
    expect(interpreted.pairRecords[0].observations[2].claim.status).toBe("supported-interpretation");
    const interpretationOptions = getFounderRelationshipEvidenceOptions(interpreted.pairRecords[0], "compatibility-interpretation", context());
    expect(interpretationOptions.some((option) => option.reference.type === "pair-observation"
      && option.reference.observationId === interpreted.pairRecords[0].observations[2].id)).toBe(false);
  });

  it("rechecks lost evidence and founder access without changing unrelated state or inventing review approval", () => {
    const original = recordFounderRelationshipDraft(empty(), draft(), context());
    const lostAccess = reviewFounderRelationshipEvidence(original, {
      ...context(), people: context().people.map((person) => ({ ...person, accessLevel: "Team Member" })),
    });
    expect(lostAccess.pairRecords[0].observations[0].claim.status).toBe("unresolved");
    expect(lostAccess.responsibilityFits).toBe(original.responsibilityFits);
    expect(lostAccess.developmentOpportunities).toBe(original.developmentOpportunities);
    const missingSources = reviewFounderRelationshipEvidence(original, {
      ...context(), people: context().people.map((person) => ({ ...person, operatingProfile: undefined })),
    });
    expect(missingSources.pairRecords[0].observations[0].claim.status).toBe("unresolved");
    expect(reviewFounderRelationshipEvidence(missingSources, context()).pairRecords[0].observations[0].claim.status)
      .toBe("evidence-grounded-understanding");
  });

  it("preserves same-ID conflicts across human review and persistence without mutating source records", () => {
    const original = recordFounderRelationshipDraft(empty(), draft(), context());
    const snapshot = structuredClone(original);
    const conflicting = recordFounderRelationshipDraft(original, draft({ statement: "A different account." }), context());
    expect(conflicting.pairRecords[0].observations[0].integrityStatus).toBe("conflicting");
    const reviewed = reviewFounderRelationshipEvidence(JSON.parse(JSON.stringify(conflicting)), context());
    expect(reviewed.pairRecords[0].observations[0].claim.status).toBe("unresolved");
    expect(original).toEqual(snapshot);
    expect(reviewFounderRelationshipEvidence(JSON.parse(JSON.stringify(original)), context())).toEqual(original);
  });
});
