import { describe, expect, it } from "vitest";
import {
  appendFounderRelationshipObservation,
  assertFounderIntelligenceDataStructure,
  createFounderRelationshipObservation,
  createFounderRelationshipRecord,
  deriveFounderRelationshipUnderstanding,
  mergeFounderIntelligence,
  normaliseFounderIntelligence,
  type FounderIntelligenceContext,
  type FounderIntelligenceEvidenceReference,
  type PairIntelligenceObservation,
  type PairIntelligenceRecord,
} from "./founder-intelligence";
import {
  calumLeadershipReflectionSubmission,
  emekaLeadershipAlignmentSubmission,
  lewisLeadershipAlignmentSubmission,
} from "./operating-profile-evidence";
import { individualOperatingUnderstandingSeeds } from "./individual-operating-understanding";
import { buildFullBackup, FOUNDER_INTELLIGENCE_STORAGE_KEY } from "./backup";

function context(): FounderIntelligenceContext {
  return {
    people: [
      { id: "calum", accessLevel: "Founder", operatingProfile: {
        sourceSubmissions: [calumLeadershipReflectionSubmission],
        individualUnderstandings: individualOperatingUnderstandingSeeds[0].understandings,
      } },
      { id: "lewis", accessLevel: "Founder", operatingProfile: {
        sourceSubmissions: [lewisLeadershipAlignmentSubmission],
        individualUnderstandings: individualOperatingUnderstandingSeeds[1].understandings,
      } },
      { id: "emeka", accessLevel: "Team Member", operatingProfile: {
        sourceSubmissions: [emekaLeadershipAlignmentSubmission],
        individualUnderstandings: individualOperatingUnderstandingSeeds[2].understandings,
      } },
    ],
    operationalRecords: [{ recordType: "Decision", recordId: "decision-review" }],
    operationalEvidence: [{
      personId: "calum",
      recordType: "Decision",
      recordId: "decision-review",
      outcomeId: "review-result",
      contribution: "reviewer",
      outcome: "mixed",
      observedResult: "The review resolved one concern but left another open.",
    }],
  };
}

function pair(): PairIntelligenceRecord {
  return createFounderRelationshipRecord(["lewis", "calum"], context());
}

function sourceReference(
  personId: "calum" | "lewis",
): Extract<FounderIntelligenceEvidenceReference, { type: "source-answer" }> {
  return {
    type: "source-answer",
    personId,
    sourceSubmissionId: personId === "calum"
      ? calumLeadershipReflectionSubmission.id : lewisLeadershipAlignmentSubmission.id,
    answerIndex: 5,
  };
}

function sourceObservation(personId: "calum" | "lewis"): PairIntelligenceObservation {
  return createFounderRelationshipObservation(pair(), `${personId}-expectation`, {
    relationshipKind: "source-grounded-understanding",
    dimension: "disagreement-and-conflict",
    direction: { fromPersonId: personId, toPersonId: personId === "calum" ? "lewis" : "calum" },
    claim: {
      id: `${personId}-expectation-claim`,
      status: "evidence-grounded-understanding",
      statement: `${personId}'s recorded expectation concerns respectful disagreement.`,
      evidence: [sourceReference(personId)],
    },
  });
}

function interpretation(): PairIntelligenceObservation {
  return createFounderRelationshipObservation(pair(), "shared-expectation", {
    relationshipKind: "compatibility-interpretation",
    dimension: "disagreement-and-conflict",
    claim: {
      id: "shared-expectation-claim",
      status: "supported-interpretation",
      statement: "These stated expectations may support a respectful disagreement process.",
      evidence: ["calum", "lewis"].map((personId) => ({
        type: "pair-observation",
        pairId: pair().id,
        observationId: `${pair().id}:relationship:${personId}-expectation`,
      })),
    },
  });
}

function operatingObservation(): PairIntelligenceObservation {
  return createFounderRelationshipObservation(pair(), "decision-review-observation", {
    relationshipKind: "operating-observation",
    dimension: "decision-making",
    claim: {
      id: "decision-review-claim",
      status: "evidence-grounded-understanding",
      statement: "The recorded review had a mixed outcome.",
      evidence: [{
        type: "operational-outcome",
        personId: "calum",
        recordType: "Decision",
        recordId: "decision-review",
        outcomeId: "review-result",
      }],
    },
  });
}

function normalize(observations: PairIntelligenceObservation[], evidenceContext = context()) {
  return normaliseFounderIntelligence({
    pairRecords: [{ ...pair(), observations }],
  }, evidenceContext);
}

describe("founder relationship intelligence", () => {
  it("creates deterministic founder-pair and observation identities without assigning authority", () => {
    expect(pair()).toEqual(createFounderRelationshipRecord(["calum", "lewis"], context()));
    expect(pair().observations).toEqual([]);
    expect(sourceObservation("calum").id).toBe("pair:calum:lewis:relationship:calum-expectation");
    const empty = deriveFounderRelationshipUnderstanding(pair(), context());
    expect(empty).toMatchObject({
      founderStatus: "verified",
      sourceCoverage: "unresolved",
      compatibilityStatus: "unresolved",
      authorityChanged: false,
    });
  });

  it("does not promote a team member, infer founder access, or accept ambiguous People identities", () => {
    expect(() => createFounderRelationshipRecord(["calum", "emeka"], context()))
      .toThrow("two distinct People records with Founder access");
    expect(() => createFounderRelationshipRecord(["calum", "calum"], context())).toThrow();
    expect(() => createFounderRelationshipRecord(["calum", "missing"], context())).toThrow();
    expect(() => createFounderRelationshipRecord(["calum", "lewis"], {
      ...context(),
      people: context().people.map((person) => ({ ...person, accessLevel: undefined })),
    })).toThrow();
    expect(() => createFounderRelationshipRecord(["calum", "lewis"], {
      ...context(), people: [...context().people, context().people[0]],
    })).toThrow();
  });

  it("keeps bilateral source understanding distinct from interpreted compatibility and execution", () => {
    const result = normalize([
      interpretation(),
      sourceObservation("lewis"),
      sourceObservation("calum"),
      operatingObservation(),
    ]);
    const view = deriveFounderRelationshipUnderstanding(result.pairRecords[0], context());
    expect(view.sourceCoverage).toBe("both-founders");
    expect(view.sourceUnderstandings).toHaveLength(2);
    expect(view.operatingObservations[0].claim.status).toBe("evidence-grounded-understanding");
    expect(view.compatibilityInterpretations[0].claim.status).toBe("supported-interpretation");
    expect(view.compatibilityStatus).toBe("supported-interpretation");
    expect(view.authorityChanged).toBe(false);
    expect(normalize([sourceObservation("calum"), sourceObservation("lewis")])
      .pairRecords[0].observations).toHaveLength(2);
    expect(deriveFounderRelationshipUnderstanding(
      normalize([sourceObservation("calum"), sourceObservation("lewis")]).pairRecords[0], context(),
    ).compatibilityStatus).toBe("unresolved");
  });

  it("resolves direct individual-understanding citations without converting interpretations into source facts", () => {
    const understanding = individualOperatingUnderstandingSeeds[0].understandings[5];
    const observation = sourceObservation("calum");
    observation.claim.evidence = [{
      type: "individual-understanding",
      personId: "calum",
      understandingId: understanding.id,
      claimId: understanding.understanding.id,
    }];
    expect(normalize([observation]).pairRecords[0].observations[0].claim.status)
      .toBe("evidence-grounded-understanding");
    const interpretedContext = context();
    interpretedContext.people = interpretedContext.people.map((person) => person.id !== "calum" ? person : {
      ...person,
      operatingProfile: {
        ...person.operatingProfile,
        individualUnderstandings: [{
          ...understanding,
          understanding: { ...understanding.understanding, status: "supported-interpretation" },
        }],
      },
    });
    expect(normalize([observation], interpretedContext).pairRecords[0].observations[0].claim.status)
      .toBe("unresolved");
  });

  it.each(["submission", "answer", "understanding", "person"])(
    "preserves invalid %s citations as unresolved instead of manufacturing understanding",
    (missing) => {
      const observation = sourceObservation("calum");
      observation.claim.evidence = missing === "understanding" ? [{
        type: "individual-understanding", personId: "calum",
        understandingId: "missing", claimId: "missing",
      }] : [{
        type: "source-answer",
        personId: missing === "person" ? "missing" : "calum",
        sourceSubmissionId: missing === "submission" ? "missing" : calumLeadershipReflectionSubmission.id,
        answerIndex: missing === "answer" ? 999 : 5,
      }];
      const normalized = normalize([observation]).pairRecords[0].observations[0];
      expect(normalized.claim).toMatchObject({
        status: "unresolved", candidateStatus: "evidence-grounded-understanding",
        evidence: observation.claim.evidence,
      });
    },
  );

  it("requires both founders' evidence for a relationship interpretation", () => {
    const partial = normalize([sourceObservation("calum"), interpretation()]).pairRecords[0];
    expect(partial.observations[1].claim.status).toBe("unresolved");
    expect(deriveFounderRelationshipUnderstanding(partial, context()).sourceCoverage).toBe("partial");
    const unilateral = interpretation();
    unilateral.claim.evidence = [sourceReference("calum")];
    expect(normalize([unilateral]).pairRecords[0].observations[0].claim.status).toBe("unresolved");
    const bilateral = interpretation();
    bilateral.claim.evidence = [sourceReference("calum"), sourceReference("lewis")];
    expect(normalize([bilateral]).pairRecords[0].observations[0].claim.status)
      .toBe("supported-interpretation");
  });

  it("restores evidence-unavailable candidates only when their original citations become valid", () => {
    const records = [sourceObservation("calum"), sourceObservation("lewis"), interpretation()];
    const unavailableContext = {
      ...context(),
      people: context().people.map((person) => person.id !== "lewis" ? person : {
        ...person,
        operatingProfile: { ...person.operatingProfile, sourceSubmissions: [] },
      }),
    };
    const unavailable = normalize(records, unavailableContext);
    expect(unavailable.pairRecords[0].observations[1].claim).toMatchObject({
      status: "unresolved", candidateStatus: "evidence-grounded-understanding",
    });
    expect(unavailable.pairRecords[0].observations[2].claim.status).toBe("unresolved");
    const restored = normaliseFounderIntelligence(JSON.parse(JSON.stringify(unavailable)), context());
    expect(restored).toEqual(normalize(records));
    const explicitlyUnresolved = sourceObservation("calum");
    explicitlyUnresolved.claim.status = "unresolved";
    expect(normalize([explicitlyUnresolved]).pairRecords[0].observations[0].claim.status)
      .toBe("unresolved");
  });

  it("does not depend on observation order when resolving relationship citations", () => {
    const forward = normalize([sourceObservation("calum"), sourceObservation("lewis"), interpretation()]);
    const reversed = normalize([interpretation(), sourceObservation("lewis"), sourceObservation("calum")]);
    expect(reversed.pairRecords[0].observations.map((observation) =>
      [observation.id, observation.claim.status]).sort())
      .toEqual(forward.pairRecords[0].observations.map((observation) =>
        [observation.id, observation.claim.status]).sort());
    expect(normaliseFounderIntelligence(JSON.parse(JSON.stringify(forward)), context())).toEqual(forward);
  });

  it("does not upgrade an interpretation into source understanding or misattribute directional evidence", () => {
    const upgraded = interpretation();
    upgraded.claim.status = "evidence-grounded-understanding";
    expect(normalize([sourceObservation("calum"), sourceObservation("lewis"), upgraded])
      .pairRecords[0].observations[2].claim.status).toBe("unresolved");
    const misattributed = sourceObservation("calum");
    misattributed.claim.evidence = [sourceReference("lewis")];
    expect(normalize([misattributed]).pairRecords[0].observations[0].claim.status).toBe("unresolved");
    const selfReportedExecution = sourceObservation("calum");
    selfReportedExecution.relationshipKind = "operating-observation";
    expect(normalize([selfReportedExecution]).pairRecords[0].observations[0].claim.status)
      .toBe("unresolved");
  });

  it("requires independent operating evidence and a real record; stored assertions cannot validate themselves", () => {
    const observation = operatingObservation();
    const stored = normalize([observation]);
    expect(stored.pairRecords[0].observations[0].claim.status).toBe("evidence-grounded-understanding");
    const assertion = {
      ...context().operationalEvidence![0], id: "assertion", observedResult: "Recorded result.",
      evidenceStatus: "resolved",
    };
    const withoutIndependentEvidence = normaliseFounderIntelligence({
      ...stored, operationalOutcomes: [assertion],
    }, { ...context(), operationalEvidence: [] });
    expect(withoutIndependentEvidence.pairRecords[0].observations[0].claim.status).toBe("unresolved");
    expect(normalize([observation], { ...context(), operationalRecords: [] })
      .pairRecords[0].observations[0].claim.status).toBe("unresolved");
    expect(normalize([observation], {
      ...context(),
      operationalEvidence: [{ ...context().operationalEvidence![0], outcome: "unassessed" }],
    }).pairRecords[0].observations[0].claim.status).toBe("unresolved");
  });

  it("retains unresolved observations for contradictory independent results", () => {
    const evidenceContext = context();
    evidenceContext.operationalEvidence = [
      ...evidenceContext.operationalEvidence!,
      { ...evidenceContext.operationalEvidence![0], outcome: "unsuccessful", observedResult: "A conflicting result." },
    ];
    expect(normalize([operatingObservation()], evidenceContext)
      .pairRecords[0].observations[0].claim.status).toBe("unresolved");
  });

  it("prevents relationship interpretations and untyped observations from validating interpretations", () => {
    const conclusion = interpretation();
    conclusion.claim.evidence = [{
      type: "pair-observation", pairId: pair().id, observationId: conclusion.id,
    }];
    expect(normalize([conclusion]).pairRecords[0].observations[0].claim.status).toBe("unresolved");
    const legacy = { ...sourceObservation("calum"), relationshipKind: undefined };
    expect(normalize([legacy, sourceObservation("lewis"), interpretation()])
      .pairRecords[0].observations[2].claim.status).toBe("unresolved");
    const crossPair = interpretation();
    crossPair.claim.evidence = [{
      type: "pair-observation", pairId: "pair:calum:emeka", observationId: "employee-observation",
    }, sourceReference("lewis")];
    expect(normalize([crossPair], {
      ...context(),
      pairRecords: [{
        id: "pair:calum:emeka", personIds: ["calum", "emeka"],
        observations: [{ ...sourceObservation("calum"), id: "employee-observation", direction: undefined }],
      }],
    }).pairRecords[0].observations[0].claim.status).toBe("unresolved");
  });

  it("preserves same-ID conflicts and provenance across repeated merge and rehydration", () => {
    const original = normalize([sourceObservation("calum"), sourceObservation("lewis"), interpretation()]);
    const conflicting = sourceObservation("calum");
    conflicting.claim.statement = "A conflicting account of the same expectation.";
    const additionalSourceEvidence: Extract<FounderIntelligenceEvidenceReference, { type: "source-answer" }> = {
      type: "source-answer",
      personId: "calum",
      sourceSubmissionId: calumLeadershipReflectionSubmission.id,
      answerIndex: 10,
    };
    conflicting.claim.evidence.push(additionalSourceEvidence);
    const incoming = { pairRecords: [{ ...pair(), observations: [conflicting] }] };
    const merged = mergeFounderIntelligence(original, incoming, context());
    expect(merged.pairRecords[0].observations[0]).toMatchObject({
      integrityStatus: "conflicting", claim: { status: "unresolved" },
    });
    expect(merged.pairRecords[0].observations[0].claim.evidence).toHaveLength(2);
    expect(merged.pairRecords[0].observations[2].claim.status).toBe("unresolved");
    const rehydrated = normaliseFounderIntelligence(JSON.parse(JSON.stringify(merged)), context());
    expect(rehydrated).toEqual(merged);
    expect(mergeFounderIntelligence(merged, incoming, context())).toEqual(merged);
  });

  it("does not silently replace a same-ID relationship kind or direction", () => {
    const original = normalize([sourceObservation("calum")]);
    const changed = sourceObservation("calum");
    changed.direction = { fromPersonId: "lewis", toPersonId: "calum" };
    expect(mergeFounderIntelligence(original, {
      pairRecords: [{ ...pair(), observations: [changed] }],
    }, context()).pairRecords[0].observations[0].integrityStatus).toBe("conflicting");
    const differentKind = { ...sourceObservation("calum"), relationshipKind: "operating-observation" as const };
    expect(mergeFounderIntelligence(original, {
      pairRecords: [{ ...pair(), observations: [differentKind] }],
    }, context()).pairRecords[0].observations[0].integrityStatus).toBe("conflicting");
    const differentClaim = sourceObservation("calum");
    differentClaim.claim.id = "replacement-claim";
    expect(mergeFounderIntelligence(original, {
      pairRecords: [{ ...pair(), observations: [differentClaim] }],
    }, context()).pairRecords[0].observations[0].integrityStatus).toBe("conflicting");
  });

  it("retains source provenance verbatim and round-trips through the existing backup store", () => {
    const original = normalize([sourceObservation("calum"), sourceObservation("lewis"), interpretation()]);
    const stored = JSON.stringify(original);
    const backup = buildFullBackup({
      getItem: (key) => key === FOUNDER_INTELLIGENCE_STORAGE_KEY ? stored : null,
    }, "2026-10-04T00:00:00.000Z");
    const restored = JSON.parse(backup.storage[FOUNDER_INTELLIGENCE_STORAGE_KEY]!);
    assertFounderIntelligenceDataStructure(restored);
    expect(normaliseFounderIntelligence(restored, context())).toEqual(original);
    expect(original.pairRecords[0].observations[0].claim.evidence)
      .toEqual(sourceObservation("calum").claim.evidence);
    expect(calumLeadershipReflectionSubmission.answers[5].answer)
      .toBe(context().people[0].operatingProfile!.sourceSubmissions![0].answers[5].answer);
  });

  it("preserves source records, People governance and input records during append, merge and derivation", () => {
    const evidenceContext = context();
    const original = normalize([]);
    const observation = sourceObservation("calum");
    const before = structuredClone({ evidenceContext, original, observation });
    const appended = appendFounderRelationshipObservation(original, pair(), observation, evidenceContext);
    deriveFounderRelationshipUnderstanding(appended.pairRecords[0], evidenceContext);
    expect({ evidenceContext, original, observation }).toEqual(before);
    expect(appended.responsibilityFits).toEqual([]);
    expect(appended.trioRecords).toEqual([]);
    expect(evidenceContext.people[2].accessLevel).toBe("Team Member");
  });

  it("keeps persisted employee and missing-founder relationship claims unresolved without changing authority", () => {
    const observation = sourceObservation("calum");
    observation.direction = undefined;
    const employeePair = { id: "pair:calum:emeka", personIds: ["calum", "emeka"] as [string, string],
      observations: [observation] };
    const view = deriveFounderRelationshipUnderstanding(employeePair, context());
    expect(view.founderStatus).toBe("unresolved");
    expect(view.sourceUnderstandings[0].claim.status).toBe("unresolved");
    expect(view.authorityChanged).toBe(false);
    expect(normalize([sourceObservation("calum")], {
      ...context(), people: context().people.filter((person) => person.id !== "lewis"),
    }).pairRecords[0].observations[0].claim.status).toBe("unresolved");
  });

  it("rejects malformed relationship fields without weakening legacy normalization", () => {
    const malformed = {
      pairRecords: [{ ...pair(), observations: [{ ...sourceObservation("calum"), claim: null }] }],
    };
    expect(() => assertFounderIntelligenceDataStructure(malformed)).toThrow("malformed pairRecords");
    expect(() => normaliseFounderIntelligence(malformed, context())).toThrow("malformed pairRecords");
    expect(() => normaliseFounderIntelligence({
      pairRecords: [{ ...pair(), observations: [{
        ...sourceObservation("calum"), relationshipKind: "unsupported-kind",
      }] }],
    }, context())).toThrow("malformed pairRecords");
    expect(() => normaliseFounderIntelligence({
      pairRecords: [{ ...pair(), personIds: ["calum"], observations: [sourceObservation("calum")] }],
    }, context())).toThrow("malformed pairRecords");
    expect(() => assertFounderIntelligenceDataStructure({
      pairRecords: [{ ...pair(), observations: [{
        ...sourceObservation("calum"), integrityStatus: "resolved",
      }] }],
    })).toThrow("malformed pairRecords");
    const legacy = normalize([{ ...sourceObservation("calum"), relationshipKind: undefined }]);
    expect(legacy.pairRecords[0].observations[0].claim.status).toBe("evidence-grounded-understanding");
    expect(normaliseFounderIntelligence({}, context()).pairRecords).toEqual([]);
  });
});
