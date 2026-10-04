import { describe, expect, it } from "vitest";
import { normalizeActionRecord, type ActionRecord } from "./capture-conversions";
import {
  createResponsibilityDefinition,
  type OperationalOutcomeEvidence,
  type ResponsibilityFitRecord,
} from "./founder-intelligence";
import type { ActionResponsibilityOutcomeEvidence } from "./capture-conversions";
import {
  assertActionResponsibilityOutcomeEvidenceStructure,
  assessResponsibilityDelegationEvidence,
  deriveActionOperationalOutcomeEvidence,
  isActionResponsibilityOutcomeEvidence,
  mergeActionResponsibilityOutcomeEvidence,
} from "./responsibility-task-intelligence";

const responsibility = createResponsibilityDefinition("Manage customer handover", "", [
  {
    id: "handover:communication",
    capability: "Customer communication",
    description: "Communicate handover information accurately.",
  },
  {
    id: "handover:follow-through",
    capability: "Reliable follow-through",
    description: "Complete agreed next steps.",
  },
]);

const people = [
  { id: "calum", name: "Calum", role: "Founder", accessLevel: "Founder", status: "Active" },
  { id: "lewis", name: "Lewis", role: "Co-founder", accessLevel: "Founder", status: "Active" },
  { id: "emeka", name: "Emeka", role: "Operations Manager", accessLevel: "Team Member", status: "Active" },
];

function action(overrides: Partial<ActionRecord> = {}): ActionRecord {
  return normalizeActionRecord({
    id: "action-handover",
    sourceCaptureId: "capture-handover",
    targetType: "Convert to Action",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "Complete customer handover",
    originalRawNote: "",
    relatedArea: "",
    importance: "High",
    status: "Completed",
    actionTitle: "Complete customer handover",
    owner: "Calum",
    ownerPersonId: "calum",
    completionEvidence: "Customer handover checklist completed and customer confirmed receipt.",
    completionDate: "2026-09-25T00:00:00.000Z",
    reviewOutcome: "Complete",
    ...overrides,
  });
}

function executionEvidence(
  overrides: Partial<ActionResponsibilityOutcomeEvidence> = {},
): ActionResponsibilityOutcomeEvidence {
  return {
    id: "action-handover:assertion:successful",
    responsibilityId: responsibility.id,
    requirementId: responsibility.requirements[0].id,
    personId: "emeka",
    contribution: "executor",
    outcomeId: "action-handover:handover:communication:emeka:executor",
    outcome: "successful",
    observedResult: "Customer received complete and accurate handover details.",
    evidenceStatus: "validated",
    reviewedByPersonId: "lewis",
    reviewedAt: "2026-09-26T10:00:00.000Z",
    ...overrides,
  };
}

function outcomeAssertion(
  overrides: Partial<OperationalOutcomeEvidence> = {},
): OperationalOutcomeEvidence {
  return {
    ...executionEvidence(),
    recordType: "Action",
    recordId: "action-handover",
    evidenceStatus: "resolved",
    ...overrides,
  };
}

function fitRecord(
  fit: "demonstrated-capability" | "unresolved" = "demonstrated-capability",
  options: { requirementId?: string; outcomeId?: string; contribution?: "executor" | "support" } = {},
): ResponsibilityFitRecord {
  const requirementId = options.requirementId ?? responsibility.requirements[0].id;
  const outcomeId = options.outcomeId ?? "action-handover:handover:communication:emeka:executor";
  const contribution = options.contribution ?? "executor";
  return {
    id: "handover-fit",
    title: responsibility.title,
    responsibilityId: responsibility.id,
    requirements: [],
    assessments: [{
      id: "handover-fit-emeka",
      personId: "emeka",
      responsibility: responsibility.title,
      contribution,
      fit,
      ...(fit === "unresolved" ? { candidateFit: "demonstrated-capability" as const } : {}),
      target: {
        type: "work-item",
        responsibilityId: responsibility.id,
        workItem: { objectType: "Action", objectId: "action-handover" },
      },
      requirementIds: [requirementId],
      claim: {
        id: "handover-fit-claim",
        status: fit === "unresolved" ? "unresolved" : "evidence-grounded-understanding",
        statement: fit === "unresolved" ? "" : "A validated successful execution outcome supports this requirement.",
        evidence: [{
          type: "operational-outcome",
          personId: "emeka",
          recordType: "Action",
          recordId: "action-handover",
          outcomeId,
        }],
      },
    }],
  };
}

describe("responsibility and task intelligence", () => {
  it("derives independent successful operational evidence only from completed, reviewed Actions", () => {
    const record = action({ responsibilityOutcomeEvidence: [executionEvidence()] });
    const derived = deriveActionOperationalOutcomeEvidence([record], people);

    expect(derived).toEqual([{
      id: "action-handover:assertion:successful",
      personId: "emeka",
      recordType: "Action",
      recordId: "action-handover",
      outcomeId: "action-handover:handover:communication:emeka:executor",
      contribution: "executor",
      outcome: "successful",
      observedResult: "Customer received complete and accurate handover details.",
      evidenceStatus: "resolved",
      responsibilityId: responsibility.id,
      requirementId: responsibility.requirements[0].id,
    }]);
    expect(record.ownerPersonId).toBe("calum");
    expect(derived[0].personId).toBe("emeka");
  });

  it.each([
    ["unassigned Action", action({ status: "In Progress" })],
    ["incomplete Action evidence", action({ completionEvidence: "" })],
    ["unreviewed Action result", action({ reviewOutcome: "Continue" })],
    ["non-successful result", action({ responsibilityOutcomeEvidence: [executionEvidence({ outcome: "mixed" })] })],
    ["self-review", action({ responsibilityOutcomeEvidence: [executionEvidence({ reviewedByPersonId: "emeka" })] })],
    ["inactive reviewer", action({ responsibilityOutcomeEvidence: [executionEvidence({ reviewedByPersonId: "inactive" })] })],
  ])("does not treat %s as demonstrated execution evidence", (_label, record) => {
    const withEvidence = record.responsibilityOutcomeEvidence
      ? record
      : { ...record, responsibilityOutcomeEvidence: [executionEvidence()] };
    expect(deriveActionOperationalOutcomeEvidence([withEvidence], people)).toEqual([]);
  });

  it("requires requirement-, person-, contribution- and Action-matched evidence for delegation review", () => {
    const record = action({ responsibilityOutcomeEvidence: [executionEvidence()] });
    const context = {
      people,
      responsibilities: [responsibility],
      actions: [record],
      operationalOutcomeAssertions: [outcomeAssertion()],
    };
    const valid = assessResponsibilityDelegationEvidence(
      "emeka",
      responsibility.id,
      [fitRecord()],
      context,
    );
    expect(valid).toMatchObject({
      governanceClass: "team-member",
      status: "not-established",
      authorityChanged: false,
      requirements: [
        { requirementId: "handover:communication", status: "demonstrated", actionIds: ["action-handover"] },
        { requirementId: "handover:follow-through", status: "missing" },
      ],
    });

    const onlyRequirement = createResponsibilityDefinition("Manage customer handover", "", [
      responsibility.requirements[0],
    ]);
    const fullCoverage = assessResponsibilityDelegationEvidence(
      "emeka",
      onlyRequirement.id,
      [fitRecord()],
      { ...context, responsibilities: [onlyRequirement] },
    );
    expect(fullCoverage.status).toBe("evidence-supports-human-delegation-review");
    expect(fullCoverage.authorityChanged).toBe(false);
  });

  it("does not equate founder status with capability or readiness", () => {
    const result = assessResponsibilityDelegationEvidence(
      "calum",
      responsibility.id,
      [],
      { people, responsibilities: [responsibility], actions: [] },
    );
    expect(result).toMatchObject({
      governanceClass: "founder",
      status: "not-established",
      authorityChanged: false,
      requirements: [
        { status: "missing" },
        { status: "missing" },
      ],
    });
  });

  it("keeps candidate demonstrated fit unresolved when the referenced action outcome is unavailable", () => {
    const result = assessResponsibilityDelegationEvidence(
      "emeka",
      responsibility.id,
      [fitRecord("unresolved")],
      { people, responsibilities: [responsibility], actions: [] },
    );
    expect(result.status).toBe("unresolved");
    expect(result.requirements[0].status).toBe("unresolved");
  });

  it("requires a matching successful persisted assertion as well as independent Action evidence", () => {
    const record = action({ responsibilityOutcomeEvidence: [executionEvidence()] });
    const withoutAssertion = assessResponsibilityDelegationEvidence(
      "emeka",
      responsibility.id,
      [fitRecord()],
      { people, responsibilities: [responsibility], actions: [record] },
    );
    expect(withoutAssertion.requirements[0].status).toBe("unresolved");

    const withConflictingAssertion = assessResponsibilityDelegationEvidence(
      "emeka",
      responsibility.id,
      [fitRecord()],
      {
        people,
        responsibilities: [responsibility],
        actions: [record],
        operationalOutcomeAssertions: [
          outcomeAssertion({ outcome: "unassessed", evidenceStatus: "unresolved" }),
        ],
      },
    );
    expect(withConflictingAssertion.requirements[0].status).toBe("unresolved");

    const withDifferentResultAssertion = assessResponsibilityDelegationEvidence(
      "emeka",
      responsibility.id,
      [fitRecord()],
      {
        people,
        responsibilities: [responsibility],
        actions: [record],
        operationalOutcomeAssertions: [
          outcomeAssertion({ observedResult: "The stored assertion reports a different result." }),
        ],
      },
    );
    expect(withDifferentResultAssertion.requirements[0].status).toBe("unresolved");
  });

  it("rejects mismatched requirement and outcome references", () => {
    const record = action({ responsibilityOutcomeEvidence: [executionEvidence()] });
    const result = assessResponsibilityDelegationEvidence(
      "emeka",
      responsibility.id,
      [fitRecord("demonstrated-capability", {
        requirementId: "missing-requirement",
        outcomeId: "different-outcome",
      })],
      { people, responsibilities: [responsibility], actions: [record] },
    );
    expect(result.status).toBe("unresolved");
    expect(result.requirements[0]).toMatchObject({ status: "unresolved", actionIds: [] });
  });

  it("keeps contradictory successful-result assertions unresolved", () => {
    const record = action({
      responsibilityOutcomeEvidence: [
        executionEvidence(),
        executionEvidence({
          id: "action-handover:assertion:conflict",
          observedResult: "Customer rejected the incomplete handover.",
        }),
      ],
    });
    expect(deriveActionOperationalOutcomeEvidence([record], people)).toEqual([]);
    expect(assessResponsibilityDelegationEvidence(
      "emeka",
      responsibility.id,
      [fitRecord()],
      {
        people,
        responsibilities: [responsibility],
        actions: [record],
        operationalOutcomeAssertions: [outcomeAssertion()],
      },
    ).requirements[0].status).toBe("unresolved");
  });

  it("merges duplicate execution evidence deterministically without mutating inputs", () => {
    const original = [executionEvidence()];
    const inputSnapshot = structuredClone(original);
    const merged = mergeActionResponsibilityOutcomeEvidence(original, {
      ...executionEvidence(),
      evidenceStatus: "unreviewed",
      reviewedByPersonId: undefined,
      reviewedAt: undefined,
    });

    expect(merged).toEqual(original);
    expect(original).toEqual(inputSnapshot);
    expect(mergeActionResponsibilityOutcomeEvidence(merged, executionEvidence())).toEqual(merged);
    expect(mergeActionResponsibilityOutcomeEvidence(
      merged,
      executionEvidence({ observedResult: "A conflicting result." }),
    )[0].evidenceStatus).toBe("unresolved");
    expect(mergeActionResponsibilityOutcomeEvidence(
      merged,
      executionEvidence({ reviewedAt: "2026-09-27T10:00:00.000Z" }),
    )).toEqual(merged);
    expect(mergeActionResponsibilityOutcomeEvidence(
      merged,
      executionEvidence({ reviewedByPersonId: "calum" }),
    )[0].evidenceStatus).toBe("unresolved");
    const conflicted = mergeActionResponsibilityOutcomeEvidence(
      merged,
      executionEvidence({ observedResult: "A conflicting result." }),
    );
    expect(mergeActionResponsibilityOutcomeEvidence(conflicted, executionEvidence())[0].evidenceStatus)
      .toBe("unresolved");
  });

  it("fails closed on malformed nested execution evidence and round-trips valid evidence through JSON", () => {
    const malformed = [{ ...executionEvidence(), requirementId: "" }];
    expect(isActionResponsibilityOutcomeEvidence(malformed[0])).toBe(false);
    expect(() => assertActionResponsibilityOutcomeEvidenceStructure(malformed))
      .toThrow("An Action contains malformed responsibility outcome evidence.");
    expect(() => assertActionResponsibilityOutcomeEvidenceStructure(null))
      .toThrow("An Action contains malformed responsibility outcome evidence.");
    expect(deriveActionOperationalOutcomeEvidence(
      [{ ...action(), completionEvidence: null } as unknown as ActionRecord],
      people,
    )).toEqual([]);
    expect(deriveActionOperationalOutcomeEvidence([action()], people)).toEqual([]);

    const stored = JSON.parse(JSON.stringify(action({
      responsibilityOutcomeEvidence: [executionEvidence()],
    }))) as ActionRecord;
    assertActionResponsibilityOutcomeEvidenceStructure(stored.responsibilityOutcomeEvidence);
    expect(deriveActionOperationalOutcomeEvidence([stored], people))
      .toEqual(deriveActionOperationalOutcomeEvidence(
        [action({ responsibilityOutcomeEvidence: [executionEvidence()] })],
        people,
      ));
  });
});
