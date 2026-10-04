import { describe, expect, it } from "vitest";
import {
  createResponsibilityDefinition,
  createPairIntelligenceRecords,
  createTrioIntelligenceRecord,
  assertFounderIntelligenceDataStructure,
  mergeFounderIntelligence,
  normaliseFounderIntelligence,
  type FounderIntelligenceContext,
} from "./founder-intelligence";
import {
  calumLeadershipReflectionSubmission,
  emekaLeadershipAlignmentSubmission,
  lewisLeadershipAlignmentSubmission,
} from "./operating-profile-evidence";
import { founderIndividualOperatingUnderstandings } from "./individual-operating-understanding";

function createContext(): FounderIntelligenceContext {
  const submissions = [
    calumLeadershipReflectionSubmission,
    lewisLeadershipAlignmentSubmission,
    emekaLeadershipAlignmentSubmission,
  ];
  return {
    people: submissions.map((submission, index) => ({
      id: `person-${index + 1}`,
      operatingProfile: {
        sourceSubmissions: [submission],
        individualUnderstandings: founderIndividualOperatingUnderstandings[index].understandings,
      },
    })),
    operationalEvidence: [{
      personId: "person-1",
      recordType: "Decision",
      recordId: "decision-1",
      outcomeId: "decision-outcome-1",
      contribution: "reviewer",
      outcome: "successful",
    }],
  };
}

describe("founder intelligence evidence foundations", () => {
  it("creates deterministic, unordered pair identities for arbitrary People records", () => {
    const first = createPairIntelligenceRecords(["person-c", "person-a", "person-b", "person-a"]);
    const second = createPairIntelligenceRecords(["person-b", "person-c", "person-a"]);

    expect(first).toEqual(second);
    expect(first.map(({ personIds }) => personIds)).toEqual([
      ["person-a", "person-b"],
      ["person-a", "person-c"],
      ["person-b", "person-c"],
    ]);
    expect(first.every(({ observations }) => observations.length === 0)).toBe(true);
  });

  it("creates a deterministic trio only for exactly three distinct people", () => {
    expect(createTrioIntelligenceRecord(["person-c", "person-a", "person-b"]))
      .toEqual(createTrioIntelligenceRecord(["person-b", "person-c", "person-a"]));
    expect(createTrioIntelligenceRecord(["person-a", "person-b"])).toBeNull();
    expect(createTrioIntelligenceRecord(["person-a", "person-a", "person-b"])).toBeNull();
  });

  it.each([
    ["Calum", "person-1", calumLeadershipReflectionSubmission.id],
    ["Lewis", "person-2", lewisLeadershipAlignmentSubmission.id],
    ["Emeka", "person-3", emekaLeadershipAlignmentSubmission.id],
  ])("validates a %s source answer through the shared evidence architecture", (_name, personId, submissionId) => {
    const context = createContext();
    const otherPersonId = personId === "person-1" ? "person-2" : "person-1";
    const normalized = normaliseFounderIntelligence({
      pairRecords: [{
        id: "ignored-in-favour-of-deterministic-pair-id",
        personIds: [otherPersonId, personId],
        observations: [{
          id: `${personId}-observation`,
          dimension: "shared-working-expectation",
          direction: {
            fromPersonId: personId,
            toPersonId: otherPersonId,
          },
          claim: {
            id: `${personId}-claim`,
            status: "evidence-grounded-understanding",
            statement: "Evidence-grounded statement.",
            evidence: [{
              type: "source-answer",
              personId,
              sourceSubmissionId: submissionId,
              answerIndex: 0,
            }],
          },
        }],
      }],
    }, context);

    expect(normalized.pairRecords).toHaveLength(1);
    expect(normalized.pairRecords[0].observations[0]).toMatchObject({
      direction: {
        fromPersonId: personId,
        toPersonId: otherPersonId,
      },
      claim: {
        status: "evidence-grounded-understanding",
        evidence: [{
          type: "source-answer",
          personId,
          sourceSubmissionId: submissionId,
          answerIndex: 0,
        }],
      },
    });
  });

  it("retains direct answer provenance and individual understanding references without mixing source wording", () => {
    const context = createContext();
    const emekaSubmissionId = emekaLeadershipAlignmentSubmission.id;
    const emekaUnderstanding = founderIndividualOperatingUnderstandings[2].understandings[0];
    const normalized = normaliseFounderIntelligence({
      pairRecords: [{
        id: "pair:person-2:person-3",
        personIds: ["person-2", "person-3"],
        observations: [{
          id: "pair-claim-1",
          dimension: "long-term-expectations",
          claim: {
            id: "pair-claim",
            status: "supported-interpretation",
            statement: "A cautious interpretation based on both people’s statements.",
            evidence: [
              {
                type: "source-answer",
                personId: "person-3",
                sourceSubmissionId: emekaSubmissionId,
                answerIndex: 11,
              },
              {
                type: "individual-understanding",
                personId: "person-3",
                understandingId: emekaUnderstanding.id,
                claimId: emekaUnderstanding.understanding.id,
              },
            ],
          },
        }],
      }],
    }, context);

    expect(normalized.pairRecords[0].observations[0].claim.evidence).toHaveLength(2);
    expect(emekaSubmissionId).toBe(emekaLeadershipAlignmentSubmission.id);
    expect(emekaLeadershipAlignmentSubmission.answers[11].question)
      .toBe("What would need to be true for you to make a deeper long-term commitment to this business and team?");
  });

  it("marks claims unresolved when a submission, answer, understanding, or claim reference is invalid", () => {
    const context = createContext();
    const normalized = normaliseFounderIntelligence({
      pairRecords: [{
        id: "",
        personIds: ["person-1", "person-2"],
        observations: [{
          id: "unsupported-claim",
          dimension: "decision-making",
          claim: {
            id: "claim-1",
            status: "supported-interpretation",
            statement: "Unsupported interpretation.",
            evidence: [
              {
                type: "source-answer",
                personId: "person-1",
                sourceSubmissionId: "missing-submission",
                answerIndex: 0,
              },
              {
                type: "source-answer",
                personId: "person-1",
                sourceSubmissionId: calumLeadershipReflectionSubmission.id,
                answerIndex: 99,
              },
              {
                type: "individual-understanding",
                personId: "person-1",
                understandingId: "missing-understanding",
                claimId: "missing-claim",
              },
            ],
          },
        }],
      }],
    }, context);

    expect(normalized.pairRecords[0].observations[0].claim).toMatchObject({
      status: "unresolved",
      candidateStatus: "supported-interpretation",
    });
    expect(normalized.pairRecords[0].observations[0].claim.evidence).toHaveLength(3);
  });

  it("validates trio evidence through existing pair observations and individual evidence", () => {
    const context = createContext();
    const pairRecords = createPairIntelligenceRecords(["person-1", "person-2"]);
    pairRecords[0].observations.push({
      id: "pair-observation-1",
      dimension: "decision-making",
      claim: {
        id: "pair-claim-1",
        status: "evidence-grounded-understanding",
        statement: "Supported pair understanding.",
        evidence: [{
          type: "source-answer",
          personId: "person-1",
          sourceSubmissionId: calumLeadershipReflectionSubmission.id,
          answerIndex: 5,
        }],
      },
    });
    const trio = createTrioIntelligenceRecord(["person-1", "person-2", "person-3"]);
    expect(trio).not.toBeNull();

    const normalized = normaliseFounderIntelligence({
      pairRecords,
      trioRecords: [{
        ...trio!,
        observations: [{
          id: "trio-observation-1",
          dimension: "collective-decision-making",
          claim: {
            id: "trio-claim-1",
            status: "supported-interpretation",
            statement: "A supported but provisional trio interpretation.",
            evidence: [{
              type: "pair-observation",
              pairId: pairRecords[0].id,
              observationId: "pair-observation-1",
            }],
          },
        }],
      }],
    }, { ...context, pairRecords });

    expect(normalized.trioRecords[0].observations[0].claim.status).toBe("supported-interpretation");
    expect(normalized.trioRecords[0].observations[0].claim.evidence).toEqual([{
      type: "pair-observation",
      pairId: pairRecords[0].id,
      observationId: "pair-observation-1",
    }]);
  });

  it("keeps responsibility fit categories qualitative and requires suitable evidence", () => {
    const context = createContext();
    const normalized = normaliseFounderIntelligence({
      responsibilityFits: [{
        id: "responsibility-1",
        title: "Operational decisions",
        requirements: [{
          id: "requirement-1",
          capability: "decision-making",
          description: "Make considered operational decisions.",
        }],
        assessments: [
          {
            id: "stated",
            personId: "person-1",
            responsibility: "Operational decisions",
            contribution: "lead",
            fit: "stated-capability",
            claim: {
              id: "stated-claim",
              status: "evidence-grounded-understanding",
              statement: "The person explicitly describes this capability.",
              evidence: [{
                type: "source-answer",
                personId: "person-1",
                sourceSubmissionId: calumLeadershipReflectionSubmission.id,
                answerIndex: 0,
              }],
            },
          },
          {
            id: "demonstrated",
            personId: "person-1",
            responsibility: "Operational decisions",
            contribution: "reviewer",
            fit: "demonstrated-capability",
            claim: {
              id: "demonstrated-claim",
              status: "evidence-grounded-understanding",
              statement: "Supported by an operational record.",
              evidence: [{
                type: "operational-outcome",
                personId: "person-1",
                recordType: "Decision",
                recordId: "decision-1",
                outcomeId: "decision-outcome-1",
              }],
            },
          },
          {
            id: "unsupported-demonstration",
            personId: "person-2",
            responsibility: "Operational decisions",
            contribution: "owner",
            fit: "demonstrated-capability",
            claim: {
              id: "unsupported-claim",
              status: "evidence-grounded-understanding",
              statement: "This only cites a questionnaire answer.",
              evidence: [{
                type: "source-answer",
                personId: "person-2",
                sourceSubmissionId: lewisLeadershipAlignmentSubmission.id,
                answerIndex: 0,
              }],
            },
          },
        ],
      }],
    }, context);

    expect(normalized.responsibilityFits[0].assessments.map(({ fit }) => fit))
      .toEqual(["stated-capability", "demonstrated-capability", "unresolved"]);
    expect(normalized.responsibilityFits[0].assessments[2].claim.status).toBe("unresolved");
    expect(normalized.responsibilityFits[0]).not.toHaveProperty("score");
  });

  it("does not treat source-grounded understanding as a fit interpretation", () => {
    const normalized = normaliseFounderIntelligence({
      responsibilityFits: [{
        id: "fit-review",
        title: "Operational decisions",
        requirements: [],
        assessments: [{
          id: "potential-fit",
          personId: "person-1",
          responsibility: "Operational decisions",
          contribution: "owner",
          fit: "evidence-grounded-fit",
          assessmentStatus: "potential-fit",
          claim: {
            id: "source-understanding",
            status: "evidence-grounded-understanding",
            statement: "The source directly supports an individual operating understanding.",
            evidence: [{
              type: "source-answer",
              personId: "person-1",
              sourceSubmissionId: calumLeadershipReflectionSubmission.id,
              answerIndex: 0,
            }],
          },
        }],
      }],
    }, createContext());

    expect(normalized.responsibilityFits[0].assessments[0]).toMatchObject({
      fit: "unresolved",
      candidateFit: "evidence-grounded-fit",
      assessmentStatus: "unresolved",
      candidateAssessmentStatus: "potential-fit",
      claim: { status: "unresolved" },
    });
  });

  it("keeps an unavailable outcome citation unresolved and restores its candidate status when verified", () => {
    const context = createContext();
    const verifiedContext: FounderIntelligenceContext = {
      ...context,
      operationalRecords: [{ recordType: "Decision", recordId: "decision-1" }],
    };
    const fit = {
      responsibilityFits: [{
        id: "responsibility-1",
        title: "Operational decisions",
        requirements: [],
        assessments: [{
          id: "demonstrated",
          personId: "person-1",
          responsibility: "Operational decisions",
          contribution: "reviewer",
          fit: "demonstrated-capability",
          claim: {
            id: "demonstrated-claim",
            status: "evidence-grounded-understanding",
            statement: "Supported by a recorded operational outcome.",
            evidence: [{
              type: "operational-outcome",
              personId: "person-1",
              recordType: "Decision",
              recordId: "decision-1",
              outcomeId: "decision-outcome-1",
            }],
          },
        }],
      }],
    };

    const withoutOutcome = normaliseFounderIntelligence(fit, { people: context.people });
    expect(withoutOutcome.responsibilityFits[0].assessments[0]).toMatchObject({
      fit: "unresolved",
      candidateFit: "demonstrated-capability",
      claim: {
        status: "unresolved",
        candidateStatus: "evidence-grounded-understanding",
      },
    });
    expect(normaliseFounderIntelligence(withoutOutcome, verifiedContext).responsibilityFits[0].assessments[0])
      .toMatchObject({
        fit: "demonstrated-capability",
        claim: { status: "evidence-grounded-understanding" },
      });
  });

  it("creates reusable, deterministic responsibility definitions with explicit requirements", () => {
    const definition = createResponsibilityDefinition("Own customer acquisition", "Ongoing accountability.", [{
      id: "customer-acquisition:commercial-judgement",
      type: "commercial-requirement",
      capability: "Commercial judgement",
      description: "Assess customer and commercial opportunities.",
    }]);

    expect(definition).toEqual({
      id: "responsibility:own%20customer%20acquisition",
      title: "Own customer acquisition",
      description: "Ongoing accountability.",
      requirements: [{
        id: "customer-acquisition:commercial-judgement",
        type: "commercial-requirement",
        capability: "Commercial judgement",
        description: "Assess customer and commercial opportunities.",
      }],
    });
    expect(createResponsibilityDefinition("Own customer acquisition").id).toBe(definition.id);
  });

  it("links reusable responsibility requirements to separate people, contribution modes, and existing Actions", () => {
    const context = createContext();
    const responsibility = createResponsibilityDefinition("Manage quoting", "", [{
      id: "quoting:reliability",
      type: "reliability-demand",
      capability: "Reliability",
      description: "Follow through on quote commitments.",
    }, {
      id: "quoting:customer-communication",
      type: "communication-demand",
      capability: "Customer communication",
      description: "Communicate clearly with customers.",
    }]);
    const sourceBackedClaim = (
      id: string,
      personId: string,
      submissionId: string,
      status: "evidence-grounded-understanding" | "supported-interpretation",
    ) => ({
      id,
      status,
      statement: "The cited answer provides the stated basis for review.",
      evidence: [{
        type: "source-answer",
        personId,
        sourceSubmissionId: submissionId,
        answerIndex: 0,
      }],
    });
    const roles = ["owner", "lead", "executor", "contributor", "support", "reviewer"] as const;
    const normalized = normaliseFounderIntelligence({
      responsibilities: [responsibility],
      responsibilityFits: [{
        id: "quote-fit-review",
        title: "Quoting responsibility fit",
        responsibilityId: responsibility.id,
        requirements: [],
        assessments: [
          ...roles.map((contribution, index) => ({
            id: `person-1-${contribution}`,
            personId: "person-1",
            responsibility: "Manage quoting",
            contribution,
            fit: "inferred-fit",
            assessmentStatus: "potential-fit",
            target: { type: "responsibility", responsibilityId: responsibility.id },
            requirementIds: [responsibility.requirements[index % responsibility.requirements.length].id],
            claim: sourceBackedClaim(
              `calum-${contribution}`,
              "person-1",
              calumLeadershipReflectionSubmission.id,
              "supported-interpretation",
            ),
          })),
          {
            id: "person-2-executor",
            personId: "person-2",
            responsibility: "Manage quoting",
            contribution: "executor",
            fit: "inferred-fit",
            assessmentStatus: "conditional-fit",
            target: {
              type: "work-item",
              responsibilityId: responsibility.id,
              workItem: { objectType: "Action", objectId: "action-1" },
            },
            requirementIds: [responsibility.requirements[0].id],
            claim: sourceBackedClaim(
              "lewis-executor",
              "person-2",
              lewisLeadershipAlignmentSubmission.id,
              "supported-interpretation",
            ),
          },
        ],
      }],
    }, {
      ...context,
      workItems: [{ objectType: "Action", objectId: "action-1" }],
    });

    const fit = normalized.responsibilityFits[0];
    expect(fit.responsibilityId).toBe(responsibility.id);
    expect(fit.assessments.map(({ contribution }) => contribution))
      .toEqual([...roles, "executor"]);
    expect(fit.assessments.slice(0, roles.length).every((assessment) =>
      assessment.fit === "inferred-fit"
      && assessment.assessmentStatus === "potential-fit")).toBe(true);
    expect(fit.assessments[roles.length]).toMatchObject({
      personId: "person-2",
      contribution: "executor",
      target: {
        type: "work-item",
        workItem: { objectType: "Action", objectId: "action-1" },
      },
      assessmentStatus: "conditional-fit",
    });
  });

  it("leaves missing task links unresolved and retains the unresolved requirement", () => {
    const context = createContext();
    const normalized = normaliseFounderIntelligence({
      responsibilityFits: [{
        id: "task-fit",
        title: "Action fit",
        target: {
          type: "work-item",
          workItem: { objectType: "Action", objectId: "missing-action" },
        },
        requirements: [{ id: "required-1", capability: "Planning", description: "Plan delivery." }],
        assessments: [{
          id: "assessment-1",
          personId: "person-1",
          responsibility: "Action execution",
          contribution: "executor",
          fit: "inferred-fit",
          assessmentStatus: "potential-fit",
          requirementIds: ["required-1", "missing-requirement"],
          claim: {
            id: "claim-1",
            status: "supported-interpretation",
            statement: "Potential fit awaits a valid task and requirement reference.",
            evidence: [{
              type: "source-answer",
              personId: "person-1",
              sourceSubmissionId: calumLeadershipReflectionSubmission.id,
              answerIndex: 0,
            }],
          },
        }],
      }],
    }, context);

    expect(normalized.responsibilityFits[0].assessments[0]).toMatchObject({
      fit: "unresolved",
      candidateFit: "inferred-fit",
      assessmentStatus: "unresolved",
      candidateAssessmentStatus: "potential-fit",
      unresolvedRequirementIds: ["missing-requirement"],
    });
  });

  it("requires recorded successful operational outcome evidence for demonstrated capability", () => {
    const context: FounderIntelligenceContext = {
      ...createContext(),
      workItems: [{ objectType: "Action", objectId: "action-completed" }],
      operationalRecords: [{ recordType: "Action", recordId: "action-completed" }],
      operationalEvidence: [{
        personId: "person-1",
        recordType: "Action",
        recordId: "action-completed",
        outcomeId: "completion-review-1",
        contribution: "executor",
        outcome: "successful",
      }],
    };
    const stored = {
      operationalOutcomes: [{
        id: "action-outcome-1",
        personId: "person-1",
        recordType: "Action",
        recordId: "action-completed",
        outcomeId: "completion-review-1",
        contribution: "executor",
        outcome: "successful",
        observedResult: "Quality review confirmed the acceptance criteria were met.",
      }],
      responsibilityFits: [{
        id: "task-fit",
        title: "Action fit",
        target: {
          type: "work-item",
          workItem: { objectType: "Action", objectId: "action-completed" },
        },
        requirements: [{ id: "required-1", capability: "Planning", description: "Plan delivery." }],
        assessments: [{
          id: "demonstrated",
          personId: "person-1",
          responsibility: "Action execution",
          contribution: "executor",
          fit: "demonstrated-capability",
          assessmentStatus: "strong-potential-fit",
          requirementIds: ["required-1"],
          claim: {
            id: "demonstrated-claim",
            status: "evidence-grounded-understanding",
            statement: "The reviewed outcome demonstrates completion of the cited requirement.",
            evidence: [{
              type: "operational-outcome",
              personId: "person-1",
              recordType: "Action",
              recordId: "action-completed",
              outcomeId: "completion-review-1",
            }],
          },
        }],
      }],
    };

    const successful = normaliseFounderIntelligence(stored, context);
    expect(successful.responsibilityFits[0].assessments[0]).toMatchObject({
      fit: "demonstrated-capability",
      assessmentStatus: "strong-potential-fit",
    });
    expect(normaliseFounderIntelligence({
      ...stored,
      operationalOutcomes: [{
        ...stored.operationalOutcomes[0],
        outcome: "unassessed",
      }],
    }, context).responsibilityFits[0].assessments[0]).toMatchObject({
      fit: "unresolved",
      candidateFit: "demonstrated-capability",
    });
    expect(normaliseFounderIntelligence({
      ...stored,
      operationalOutcomes: [],
    }, context).responsibilityFits[0].assessments[0].fit).toBe("unresolved");
  });

  it("does not allow a stored outcome assertion to validate itself", () => {
    const context: FounderIntelligenceContext = {
      ...createContext(),
      workItems: [{ objectType: "Action", objectId: "action-completed" }],
      operationalRecords: [{ recordType: "Action", recordId: "action-completed" }],
    };
    const stored = {
      operationalOutcomes: [{
        id: "self-asserted-outcome",
        personId: "person-1",
        recordType: "Action",
        recordId: "action-completed",
        outcomeId: "unverified-review",
        contribution: "executor",
        outcome: "successful",
        observedResult: "The stored assertion says the work succeeded.",
      }],
      responsibilityFits: [{
        id: "self-asserted-fit",
        title: "Action execution",
        assessments: [{
          id: "self-asserted-assessment",
          personId: "person-1",
          responsibility: "Action execution",
          contribution: "executor",
          fit: "demonstrated-capability",
          claim: {
            id: "self-asserted-claim",
            status: "evidence-grounded-understanding",
            statement: "No independent outcome evidence supports this assertion.",
            evidence: [{
              type: "operational-outcome",
              personId: "person-1",
              recordType: "Action",
              recordId: "action-completed",
              outcomeId: "unverified-review",
            }],
          },
        }],
      }],
    };

    const normalized = normaliseFounderIntelligence(stored, context);
    expect(normalized.operationalOutcomes[0].evidenceStatus).toBe("unresolved");
    expect(normalized.responsibilityFits[0].assessments[0]).toMatchObject({
      fit: "unresolved",
      candidateFit: "demonstrated-capability",
      claim: { status: "unresolved" },
    });
  });

  it("keeps development opportunity separate from current insufficient-evidence fit", () => {
    const context = createContext();
    const responsibility = createResponsibilityDefinition("Financial administration", "", [{
      id: "finance:learning",
      capability: "Financial administration",
      description: "Develop practical financial administration capability.",
    }]);
    const normalized = normaliseFounderIntelligence({
      responsibilities: [responsibility],
      responsibilityFits: [{
        id: "current-fit",
        title: "Current financial administration fit",
        responsibilityId: responsibility.id,
        requirements: [],
        assessments: [{
          id: "current-assessment",
          personId: "person-3",
          responsibility: "Financial administration",
          contribution: "executor",
          fit: "unresolved",
          assessmentStatus: "insufficient-evidence",
          target: { type: "responsibility", responsibilityId: responsibility.id },
          requirementIds: ["finance:learning"],
          claim: {
            id: "current-claim",
            status: "unresolved",
            statement: "There is not enough evidence to assess current fit.",
            evidence: [],
          },
        }],
      }],
      developmentOpportunities: [{
        id: "development-1",
        personId: "person-3",
        requirementId: "finance:learning",
        statement: "A supported area to explore through development.",
        claim: {
          id: "development-claim",
          status: "supported-interpretation",
          statement: "A supported area to explore through development.",
          evidence: [{
            type: "source-answer",
            personId: "person-3",
            sourceSubmissionId: emekaLeadershipAlignmentSubmission.id,
            answerIndex: 7,
          }],
        },
      }],
    }, context);

    expect(normalized.responsibilityFits[0].assessments[0].assessmentStatus)
      .toBe("insufficient-evidence");
    expect(normalized.responsibilityFits[0].assessments[0].fit).toBe("unresolved");
    expect(normalized.developmentOpportunities[0]).toMatchObject({
      status: "supported",
      requirementId: "finance:learning",
    });
    expect(normalized.developmentOpportunities[0].claim.status).toBe("supported-interpretation");

    const unsupportedOpportunity = normaliseFounderIntelligence({
      responsibilities: [responsibility],
      developmentOpportunities: [{
        id: "development-2",
        personId: "person-3",
        requirementId: "finance:learning",
        statement: "A direct source-grounded statement is not a development interpretation.",
        claim: {
          id: "development-claim-2",
          status: "evidence-grounded-understanding",
          statement: "A direct source-grounded statement is not a development interpretation.",
          evidence: [{
            type: "source-answer",
            personId: "person-3",
            sourceSubmissionId: emekaLeadershipAlignmentSubmission.id,
            answerIndex: 7,
          }],
        },
      }],
    }, context);
    expect(unsupportedOpportunity.developmentOpportunities[0]).toMatchObject({
      status: "unresolved",
      claim: { status: "unresolved", candidateStatus: "evidence-grounded-understanding" },
    });
  });

  it("supports evidence-backed multi-person arrangements without ranking or assigning anyone", () => {
    const context = createContext();
    const fitRecord = {
      id: "joint-responsibility-fit",
      title: "Joint delivery option",
      requirements: [{ id: "joint-requirement", capability: "Delivery", description: "Deliver together." }],
      assessments: ["person-1", "person-2", "person-3"].map((personId, index) => ({
        id: `assessment-${index + 1}`,
        personId,
        responsibility: "Joint delivery",
        contribution: index === 0 ? "owner" : "executor",
        fit: "inferred-fit",
        assessmentStatus: "potential-fit",
        requirementIds: ["joint-requirement"],
        claim: {
          id: `claim-${index + 1}`,
          status: "supported-interpretation",
          statement: "An individual evidence-supported potential fit interpretation.",
          evidence: [{
            type: "source-answer",
            personId,
            sourceSubmissionId: [
              calumLeadershipReflectionSubmission.id,
              lewisLeadershipAlignmentSubmission.id,
              emekaLeadershipAlignmentSubmission.id,
            ][index],
            answerIndex: 0,
          }],
        },
      })),
      arrangements: [{
        id: "owner-executor-reviewer-arrangement",
        assessmentIds: ["assessment-1", "assessment-2", "assessment-3"],
        status: "conditional-fit",
        claim: {
          id: "arrangement-claim",
          status: "supported-interpretation",
          statement: "A human-authored possible combination to review.",
          evidence: ["person-1", "person-2", "person-3"].map((personId, index) => ({
            type: "source-answer",
            personId,
            sourceSubmissionId: [
              calumLeadershipReflectionSubmission.id,
              lewisLeadershipAlignmentSubmission.id,
              emekaLeadershipAlignmentSubmission.id,
            ][index],
            answerIndex: 0,
          })),
        },
      }],
    };
    const normalized = normaliseFounderIntelligence({
      responsibilityFits: [fitRecord],
    }, context);

    expect(normalized.responsibilityFits[0].arrangements).toEqual(fitRecord.arrangements);
    expect(normalized.responsibilityFits[0].assessments).toHaveLength(3);
    expect(normalized.responsibilityFits[0]).not.toHaveProperty("winner");

    const sourceGroundedArrangement = normaliseFounderIntelligence({
      responsibilityFits: [{
        ...fitRecord,
        arrangements: [{
          ...fitRecord.arrangements[0],
          claim: {
            ...fitRecord.arrangements[0].claim,
            status: "evidence-grounded-understanding",
          },
        }],
      }],
    }, context);
    expect(sourceGroundedArrangement.responsibilityFits[0].arrangements?.[0]).toMatchObject({
      status: "unresolved",
      candidateStatus: "conditional-fit",
      claim: { status: "unresolved" },
    });
  });

  it("rehydrates responsibility definitions, outcomes, and fit evidence without mutation", () => {
    const context: FounderIntelligenceContext = {
      ...createContext(),
      workItems: [{ objectType: "Action", objectId: "action-1" }],
      operationalRecords: [{ recordType: "Action", recordId: "action-1" }],
      operationalEvidence: [{
        personId: "person-1",
        recordType: "Action",
        recordId: "action-1",
        outcomeId: "review-1",
        contribution: "executor",
        outcome: "mixed",
      }],
    };
    const original = {
      responsibilities: [createResponsibilityDefinition("Develop operating systems", "", [{
        id: "systems:organisation",
        capability: "Organisation",
        description: "Maintain operating systems.",
      }])],
      operationalOutcomes: [{
        id: "outcome-1",
        personId: "person-1",
        recordType: "Action",
        recordId: "action-1",
        outcomeId: "review-1",
        contribution: "executor",
        outcome: "mixed",
        observedResult: "The work was completed with changes requested.",
        evidenceStatus: "resolved",
      }],
      responsibilityFits: [],
      pairRecords: [],
      trioRecords: [],
      developmentOpportunities: [],
    };
    const before = structuredClone(original);
    const hydrated = normaliseFounderIntelligence(JSON.parse(JSON.stringify(original)), context);

    expect(hydrated).toEqual(original);
    expect(original).toEqual(before);
    expect(mergeFounderIntelligence(hydrated, original, context)).toEqual(hydrated);
  });

  it("does not mutate founder source submissions or operating-profile records", () => {
    const context = createContext();
    const before = structuredClone(context.people);

    normaliseFounderIntelligence({
      pairRecords: [{
        id: "ignored",
        personIds: ["person-1", "person-2"],
        observations: [{
          id: "claim",
          dimension: "shared-expectations",
          claim: {
            id: "claim",
            status: "supported-interpretation",
            statement: "A supported interpretation.",
            evidence: [{
              type: "source-answer",
              personId: "person-1",
              sourceSubmissionId: calumLeadershipReflectionSubmission.id,
              answerIndex: 0,
            }],
          },
        }],
      }],
    }, context);

    expect(context.people).toEqual(before);
  });

  it("merges repeated records deterministically without mutating either input", () => {
    const context = createContext();
    const original = {
      pairRecords: createPairIntelligenceRecords(["person-1", "person-2"]),
      trioRecords: [],
      responsibilities: [],
      responsibilityFits: [],
      developmentOpportunities: [],
      operationalOutcomes: [],
    };
    const incoming = {
      pairRecords: createPairIntelligenceRecords(["person-2", "person-1"]),
      trioRecords: [],
      responsibilityFits: [],
    };
    const beforeOriginal = structuredClone(original);
    const beforeIncoming = structuredClone(incoming);

    const first = mergeFounderIntelligence(original, incoming, context);
    const second = mergeFounderIntelligence(first, incoming, context);

    expect(first.pairRecords).toHaveLength(1);
    expect(second).toEqual(first);
    expect(original).toEqual(beforeOriginal);
    expect(incoming).toEqual(beforeIncoming);
  });

  it("survives JSON persistence and rehydration with evidence references intact", () => {
    const context = createContext();
    const record = createPairIntelligenceRecords(["person-1", "person-2"])[0];
    record.observations.push({
      id: "persisted-observation",
      dimension: "decision-making",
      claim: {
        id: "persisted-claim",
        status: "evidence-grounded-understanding",
        statement: "A source-backed observation.",
        evidence: [{
          type: "source-answer",
          personId: "person-1",
          sourceSubmissionId: calumLeadershipReflectionSubmission.id,
          answerIndex: 5,
        }],
      },
    });
    const persisted = JSON.parse(JSON.stringify({
      pairRecords: [record],
      trioRecords: [],
      responsibilityFits: [],
    }));

    expect(normaliseFounderIntelligence(persisted, context).pairRecords[0])
      .toEqual(record);
  });

  it("preserves distinct observations when merging the same pair record", () => {
    const context = createContext();
    const left = {
      pairRecords: [{
        ...createPairIntelligenceRecords(["person-1", "person-2"])[0],
        observations: [{
          id: "first-observation",
          dimension: "working-expectations",
          claim: {
            id: "first-claim",
            status: "evidence-grounded-understanding" as const,
            statement: "First cited observation.",
            evidence: [{
              type: "source-answer" as const,
              personId: "person-1",
              sourceSubmissionId: calumLeadershipReflectionSubmission.id,
              answerIndex: 0,
            }],
          },
        }],
      }],
    };
    const right = {
      pairRecords: [{
        ...createPairIntelligenceRecords(["person-1", "person-2"])[0],
        observations: [{
          id: "second-observation",
          dimension: "working-expectations",
          claim: {
            id: "second-claim",
            status: "supported-interpretation" as const,
            statement: "Second cited observation.",
            evidence: [{
              type: "source-answer" as const,
              personId: "person-2",
              sourceSubmissionId: lewisLeadershipAlignmentSubmission.id,
              answerIndex: 0,
            }],
          },
        }],
      }],
    };

    const merged = mergeFounderIntelligence(left, right, context);
    expect(merged.pairRecords[0].observations.map(({ id }) => id))
      .toEqual(["first-observation", "second-observation"]);
  });

  it("preserves and deduplicates evidence when merging same-ID observations", () => {
    const context = createContext();
    const pair = createPairIntelligenceRecords(["person-1", "person-2"])[0];
    const left = {
      pairRecords: [{
        ...pair,
        observations: [{
          id: "shared-observation",
          dimension: "working-expectations",
          claim: {
            id: "shared-claim",
            status: "supported-interpretation" as const,
            statement: "A supported interpretation with evidence from both submissions.",
            evidence: [
              {
                type: "source-answer" as const,
                personId: "person-1",
                sourceSubmissionId: calumLeadershipReflectionSubmission.id,
                answerIndex: 0,
              },
              {
                type: "source-answer" as const,
                personId: "person-1",
                sourceSubmissionId: calumLeadershipReflectionSubmission.id,
                answerIndex: 1,
              },
            ],
          },
        }],
      }],
    };
    const right = {
      pairRecords: [{
        ...pair,
        observations: [{
          id: "shared-observation",
          dimension: "working-expectations",
          claim: {
            id: "shared-claim",
            status: "supported-interpretation" as const,
            statement: "A supported interpretation with evidence from both submissions.",
            evidence: [
              {
                type: "source-answer" as const,
                personId: "person-2",
                sourceSubmissionId: lewisLeadershipAlignmentSubmission.id,
                answerIndex: 0,
              },
            ],
          },
        }],
      }],
    };
    const beforeLeft = structuredClone(left);
    const beforeRight = structuredClone(right);

    const merged = mergeFounderIntelligence(left, right, context);
    const mergedAgain = mergeFounderIntelligence(merged, right, context);
    const evidence = merged.pairRecords[0].observations[0].claim.evidence;

    expect(evidence).toHaveLength(3);
    expect(evidence).toContainEqual({
      type: "source-answer",
      personId: "person-1",
      sourceSubmissionId: calumLeadershipReflectionSubmission.id,
      answerIndex: 1,
    });
    expect(evidence).toContainEqual({
      type: "source-answer",
      personId: "person-2",
      sourceSubmissionId: lewisLeadershipAlignmentSubmission.id,
      answerIndex: 0,
    });
    expect(mergedAgain).toEqual(merged);
    expect(left).toEqual(beforeLeft);
    expect(right).toEqual(beforeRight);
  });

  it("rejects malformed nested stored records before normalization can discard them", () => {
    const malformedPair = {
      pairRecords: [{
        id: "pair:person-1:person-2",
        personIds: ["person-1", "person-2"],
        observations: [{
          id: "observation-without-a-claim",
          dimension: "working-expectations",
        }],
      }],
    };

    expect(normaliseFounderIntelligence(malformedPair, createContext()).pairRecords[0].observations)
      .toEqual([]);
    expect(() => assertFounderIntelligenceDataStructure(malformedPair))
      .toThrow("malformed pairRecords");

    const malformedFit = {
      responsibilityFits: [{
        id: "fit-record",
        title: "Operational decisions",
        assessments: [{
          id: "assessment-without-a-claim",
          personId: "person-1",
          responsibility: "Operational decisions",
          contribution: "lead",
          fit: "stated-capability",
        }],
      }],
    };
    expect(normaliseFounderIntelligence(malformedFit, createContext()).responsibilityFits[0].assessments)
      .toEqual([]);
    expect(() => assertFounderIntelligenceDataStructure(malformedFit))
      .toThrow("malformed responsibilityFits");
  });

  it("retains legacy People and unresolved founder references without inventing evidence", () => {
    const context = createContext();
    const legacyContext: FounderIntelligenceContext = {
      people: [{ id: "legacy-person" }],
    };
    expect(normaliseFounderIntelligence({
      pairRecords: [{
        id: "pair:legacy-person:missing",
        personIds: ["legacy-person", "missing-person"],
        observations: [{
          id: "unresolved-observation",
          dimension: "working-expectations",
          claim: {
            id: "unresolved-claim",
            status: "evidence-grounded-understanding",
            statement: "The unavailable source must not become established.",
            evidence: [{
              type: "source-answer",
              personId: "missing-person",
              sourceSubmissionId: "missing-submission",
              answerIndex: 0,
            }],
          },
        }],
      }],
    }, legacyContext)).toEqual({
      pairRecords: [{
        id: "pair:legacy-person:missing",
        personIds: ["legacy-person", "missing-person"],
        observations: [{
          id: "unresolved-observation",
          dimension: "working-expectations",
          claim: {
            id: "unresolved-claim",
            status: "unresolved",
            candidateStatus: "evidence-grounded-understanding",
            statement: "The unavailable source must not become established.",
            evidence: [{
              type: "source-answer",
              personId: "missing-person",
              sourceSubmissionId: "missing-submission",
              answerIndex: 0,
            }],
          },
        }],
      }],
      trioRecords: [],
      responsibilities: [],
      responsibilityFits: [],
      developmentOpportunities: [],
      operationalOutcomes: [],
    });
    expect(normaliseFounderIntelligence(undefined, context)).toEqual({
      pairRecords: [],
      trioRecords: [],
      responsibilities: [],
      responsibilityFits: [],
      developmentOpportunities: [],
      operationalOutcomes: [],
    });
  });
});
