import { describe, expect, it } from "vitest";
import {
  ICARUS_EXPOSURES,
  ICARUS_MATERIALITY_CONTRACT,
  classifyIcarusControlGap,
  classifyIcarusExposure,
  classifyIcarusMechanismEvidence,
  compareIcarusSeverity,
  composeIcarusRankingScore,
  deriveIcarusStrategicScope,
  getIcarusAttentionScore,
  getIcarusCommandRank,
  getIcarusExposureRank,
  getIcarusFounderFocusBand,
  getIcarusMaterialityTier,
  isIcarusMaterialExposure,
  isIcarusMechanismEvidenced,
  type IcarusRankingInput,
} from "./icarus-materiality-policy";

const baseRanking: IcarusRankingInput = {
  exposure: "Exposed",
  scope: "Operational",
  materialFailureModeCount: 1,
  weaknessCount: 1,
  hasOverdueControlReview: false,
};

describe("Icarus materiality contract", () => {
  it("documents that only assessment status is persisted and consequence comes from live context", () => {
    expect(ICARUS_MATERIALITY_CONTRACT.assessmentStatus).toBe("Persisted");
    expect(ICARUS_MATERIALITY_CONTRACT.strategicConsequence).toBe("Derived from live strategic context");
    expect(ICARUS_MATERIALITY_CONTRACT.evidenceStrength).toBe("Derived from persisted Icarus records");
    expect(ICARUS_MATERIALITY_CONTRACT.controlState).toBe("Derived from persisted Icarus records");
    expect(Object.values(ICARUS_MATERIALITY_CONTRACT).filter((source) => source === "Persisted")).toHaveLength(1);
  });
});

describe("evidence strength", () => {
  it("classifies supporting and contradicting evidence", () => {
    expect(classifyIcarusMechanismEvidence({ supportingCount: 1, contradictingCount: 0 })).toBe("Supported");
    expect(classifyIcarusMechanismEvidence({ supportingCount: 2, contradictingCount: 1 })).toBe("Contested");
    expect(classifyIcarusMechanismEvidence({ supportingCount: 0, contradictingCount: 1 })).toBe("Contradicted");
    expect(classifyIcarusMechanismEvidence({ supportingCount: 0, contradictingCount: 0 })).toBe("Unevidenced");
    expect(isIcarusMechanismEvidenced("Supported")).toBe(true);
    expect(isIcarusMechanismEvidenced("Contested")).toBe(true);
    expect(isIcarusMechanismEvidenced("Contradicted")).toBe(false);
    expect(isIcarusMechanismEvidenced("Unevidenced")).toBe(false);
  });
});

describe("control state", () => {
  it("treats any failing control as dominant, then absence, then unverified", () => {
    expect(classifyIcarusControlGap({ failingControlCount: 1, operatingControlCount: 2 })).toBe("Failing");
    expect(classifyIcarusControlGap({ failingControlCount: 0, operatingControlCount: 0 })).toBe("Uncontrolled");
    expect(classifyIcarusControlGap({ failingControlCount: 0, operatingControlCount: 1 })).toBe("Unverified");
  });
});

describe("evidence × control => exposure", () => {
  it("covers every combination deterministically", () => {
    expect(classifyIcarusExposure({ evidence: "Supported", controlGap: "Uncontrolled", strategicallyLinked: false })).toBe("Exposed");
    expect(classifyIcarusExposure({ evidence: "Supported", controlGap: "Failing", strategicallyLinked: false })).toBe("Exposed");
    expect(classifyIcarusExposure({ evidence: "Supported", controlGap: "Unverified", strategicallyLinked: false })).toBe("Unverified control");
    expect(classifyIcarusExposure({ evidence: "Unevidenced", controlGap: "Failing", strategicallyLinked: false })).toBe("Failing control");
    expect(classifyIcarusExposure({ evidence: "Unevidenced", controlGap: "Uncontrolled", strategicallyLinked: true })).toBe("Unexamined strategic exposure");
    expect(classifyIcarusExposure({ evidence: "Unevidenced", controlGap: "Uncontrolled", strategicallyLinked: false })).toBeNull();
    expect(classifyIcarusExposure({ evidence: "Unevidenced", controlGap: "Unverified", strategicallyLinked: true })).toBeNull();
    expect(classifyIcarusExposure({ evidence: "Contradicted", controlGap: "Failing", strategicallyLinked: true })).toBeNull();
  });

  it("orders exposures from most to least severe", () => {
    expect(ICARUS_EXPOSURES.map(getIcarusExposureRank)).toEqual([0, 1, 2, 3]);
  });
});

describe("materiality tier", () => {
  it("only evidenced or failing-control exposure is Material", () => {
    expect(ICARUS_EXPOSURES.map(getIcarusMaterialityTier)).toEqual(["Material", "Material", "Corroborating", "Corroborating"]);
    expect(ICARUS_EXPOSURES.filter(isIcarusMaterialExposure)).toEqual(["Exposed", "Failing control"]);
  });
});

describe("strategic consequence", () => {
  it("derives scope from live objective first, then operating pillar", () => {
    expect(deriveIcarusStrategicScope({ liveObjectiveLinked: true, operatingPillarLinked: true })).toBe("Strategic objective");
    expect(deriveIcarusStrategicScope({ liveObjectiveLinked: false, operatingPillarLinked: true })).toBe("Pillar");
    expect(deriveIcarusStrategicScope({ liveObjectiveLinked: false, operatingPillarLinked: false })).toBe("Operational");
  });
});

describe("ranking score", () => {
  it("keeps exposure dominant over context so an unverified risk cannot outrank an equivalent exposed risk", () => {
    const exposedOperational = composeIcarusRankingScore(baseRanking);
    const unverifiedCritical = composeIcarusRankingScore({ ...baseRanking, exposure: "Unverified control", scope: "Strategic objective", objectiveImportance: "Critical" });
    expect(unverifiedCritical).toBeLessThan(exposedOperational);
  });

  it("orders strategic consequence: objective > pillar > operational, critical > high > medium", () => {
    const operational = composeIcarusRankingScore(baseRanking);
    const pillar = composeIcarusRankingScore({ ...baseRanking, scope: "Pillar" });
    const medium = composeIcarusRankingScore({ ...baseRanking, scope: "Strategic objective", objectiveImportance: "Medium" });
    const high = composeIcarusRankingScore({ ...baseRanking, scope: "Strategic objective", objectiveImportance: "High" });
    const critical = composeIcarusRankingScore({ ...baseRanking, scope: "Strategic objective", objectiveImportance: "Critical" });
    expect([operational < pillar, pillar < medium, medium < high, high < critical]).toEqual([true, true, true, true]);
  });

  it("caps concentration so many weak modes cannot run away", () => {
    const capped = composeIcarusRankingScore({ ...baseRanking, materialFailureModeCount: 4, weaknessCount: 5 });
    const many = composeIcarusRankingScore({ ...baseRanking, materialFailureModeCount: 40, weaknessCount: 50 });
    expect(many).toBe(capped);
  });

  it("puts the attention score on the shared Focus/correlation scale", () => {
    expect(getIcarusAttentionScore(200)).toBe(350);
  });
});

describe("Command rank and Founder Focus band", () => {
  it("never claims the blocked/overdue Command ranks", () => {
    ICARUS_EXPOSURES.forEach((exposure) => {
      expect(getIcarusCommandRank(exposure, true)).toBeGreaterThanOrEqual(3);
      expect(getIcarusCommandRank(exposure, false)).toBeGreaterThanOrEqual(3);
    });
    expect(getIcarusCommandRank("Unverified control", true)).toBeLessThan(getIcarusCommandRank("Unverified control", false));
  });

  it("never claims Founder Focus authority or blocked bands", () => {
    ICARUS_EXPOSURES.forEach((exposure) => {
      expect(getIcarusFounderFocusBand(exposure, true)).toBeGreaterThanOrEqual(3);
    });
    expect(getIcarusFounderFocusBand("Exposed", false)).toBe(3);
    expect(getIcarusFounderFocusBand("Unverified control", true)).toBe(4);
    expect(getIcarusFounderFocusBand("Unverified control", false)).toBe(5);
  });
});

describe("trajectory severity comparison", () => {
  const entry = (exposure: (typeof ICARUS_EXPOSURES)[number], riskScore: number, failureModeIds: string[]) => ({ exposure, riskScore, failureModeIds });

  it("detects worsening tiers and newly exposed mechanisms", () => {
    expect(compareIcarusSeverity(entry("Unverified control", 100, ["a"]), entry("Exposed", 100, ["a"]))).toBe("Worsened");
    expect(compareIcarusSeverity(entry("Exposed", 100, ["a"]), entry("Exposed", 100, ["a", "b"]))).toBe("Worsened");
    expect(compareIcarusSeverity(entry("Exposed", 100, ["a"]), entry("Exposed", 100, ["b"]))).toBe("Worsened");
  });

  it("detects improvement and persistence", () => {
    expect(compareIcarusSeverity(entry("Exposed", 100, ["a"]), entry("Failing control", 100, ["a"]))).toBe("Improved");
    expect(compareIcarusSeverity(entry("Exposed", 100, ["a", "b"]), entry("Exposed", 100, ["a"]))).toBe("Improved");
    expect(compareIcarusSeverity(entry("Exposed", 100, ["a"]), entry("Exposed", 90, ["a"]))).toBe("Improved");
    expect(compareIcarusSeverity(entry("Exposed", 100, ["a"]), entry("Exposed", 110, ["a"]))).toBe("Worsened");
    expect(compareIcarusSeverity(entry("Exposed", 100, ["a"]), entry("Exposed", 100, ["a"]))).toBe("Persistent");
  });
});
