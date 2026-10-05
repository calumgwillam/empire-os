import { describe, expect, it } from "vitest";
import {
  ICARUS_ASSURANCE_CONTRACT,
  ICARUS_ASSURANCE_STATES,
  ICARUS_OBLIGATION_CATEGORIES,
  ICARUS_OBLIGATION_KIND,
  ICARUS_OBLIGATION_LABEL,
  adjustIcarusCommandRankForAssurance,
  adjustIcarusFounderFocusBandForAssurance,
  aggregateIcarusAssuranceState,
  getIcarusAssuranceCommandReasons,
  isIcarusRemediationStalled,
  type IcarusSignalAssurance,
} from "./icarus-assurance-policy";
import { ICARUS_MATERIALITY_CONTRACT } from "./icarus-materiality-policy";

function assurance(overrides: Partial<IcarusSignalAssurance> = {}): IcarusSignalAssurance {
  return {
    state: "Weak",
    escalation: "None",
    escalationCategories: [],
    ownership: "Assigned",
    founderOwned: false,
    acceptance: "None",
    materialModesAccepted: false,
    failedControlIds: [],
    overdueObligationCount: 0,
    obligationCount: 0,
    ...overrides,
  };
}

describe("Icarus assurance contract", () => {
  it("persists only ownership, tests and acceptance; obligations, state and escalation are derived", () => {
    const persisted = Object.entries(ICARUS_ASSURANCE_CONTRACT).filter(([, source]) => source === "Persisted").map(([key]) => key).sort();
    expect(persisted).toEqual(["acceptedExposure", "controlOwnership", "controlTests", "riskOwnership"]);
    expect(ICARUS_ASSURANCE_CONTRACT.assuranceObligations).not.toBe("Persisted");
    expect(ICARUS_ASSURANCE_CONTRACT.escalation).not.toBe("Persisted");
  });

  it("does not add persisted severity to the materiality contract", () => {
    expect(Object.values(ICARUS_MATERIALITY_CONTRACT).filter((source) => source === "Persisted")).toHaveLength(1);
  });

  it("labels every obligation and separates risk treatment from assurance failure and governance gaps", () => {
    ICARUS_OBLIGATION_CATEGORIES.forEach((category) => {
      expect(ICARUS_OBLIGATION_LABEL[category]).toBeTruthy();
      expect(ICARUS_OBLIGATION_KIND[category]).toBeTruthy();
    });
    expect(ICARUS_OBLIGATION_KIND["no-control"]).toBe("Risk treatment");
    expect(ICARUS_OBLIGATION_KIND["mechanism-unexamined"]).toBe("Risk treatment");
    expect(ICARUS_OBLIGATION_KIND["failing-control-remediation"]).toBe("Assurance failure");
    expect(ICARUS_OBLIGATION_KIND["acceptance-expired"]).toBe("Assurance failure");
    expect(ICARUS_OBLIGATION_KIND["no-risk-owner"]).toBe("Governance gap");
  });

  it("orders assurance states from weakest to strongest", () => {
    expect(ICARUS_ASSURANCE_STATES).toEqual(["Weak", "Unassured", "Partially assured", "Accepted exposure", "Assured"]);
  });
});

describe("aggregateIcarusAssuranceState", () => {
  it("is conservative", () => {
    expect(aggregateIcarusAssuranceState([])).toBe("Unassured");
    expect(aggregateIcarusAssuranceState(["Assured", "Failing"])).toBe("Weak");
    expect(aggregateIcarusAssuranceState(["Assured", "Assured"])).toBe("Assured");
    expect(aggregateIcarusAssuranceState(["Assured", "Accepted"])).toBe("Partially assured");
    expect(aggregateIcarusAssuranceState(["Accepted", "Accepted"])).toBe("Accepted exposure");
    expect(aggregateIcarusAssuranceState(["Assured", "Unassured"])).toBe("Partially assured");
    expect(aggregateIcarusAssuranceState(["Accepted", "Unassured"])).toBe("Unassured");
    expect(aggregateIcarusAssuranceState(["Partially assured"])).toBe("Partially assured");
  });
});

describe("assurance placement adjustment", () => {
  it("leaves placement untouched without assurance, for governance gaps and for accepted exposure", () => {
    expect(adjustIcarusCommandRankForAssurance(4)).toBe(4);
    expect(adjustIcarusCommandRankForAssurance(4, assurance({ escalation: "Governance gap" }))).toBe(4);
    expect(adjustIcarusCommandRankForAssurance(6, assurance({ escalation: "None", acceptance: "Active", materialModesAccepted: true }))).toBe(6);
    expect(adjustIcarusFounderFocusBandForAssurance(5, assurance({ escalation: "Governance gap" }))).toBe(5);
  });

  it("lifts an assurance failure one step but never above rank 3 / band 3 (execution keeps ranks 1–2)", () => {
    const failure = assurance({ escalation: "Assurance failure" });
    expect(adjustIcarusCommandRankForAssurance(4, failure)).toBe(3);
    expect(adjustIcarusCommandRankForAssurance(3, failure)).toBe(3);
    expect(adjustIcarusCommandRankForAssurance(7, failure)).toBe(6);
    expect(adjustIcarusFounderFocusBandForAssurance(5, failure)).toBe(4);
    expect(adjustIcarusFounderFocusBandForAssurance(3, failure)).toBe(3);
  });

  it("caps assurance reasons at two and makes accepted exposure visible", () => {
    expect(getIcarusAssuranceCommandReasons()).toEqual([]);
    expect(getIcarusAssuranceCommandReasons(assurance({
      escalationCategories: ["failing-control-remediation", "control-test-overdue", "no-risk-owner"],
    }))).toEqual(["ASSURANCE: FAILING CONTROL UNREMEDIATED", "ASSURANCE: CONTROL TEST OVERDUE"]);
    expect(getIcarusAssuranceCommandReasons(assurance({ acceptance: "Active", materialModesAccepted: true }))).toEqual(["ACCEPTED EXPOSURE"]);
    expect(getIcarusAssuranceCommandReasons(assurance({ acceptance: "Expired", materialModesAccepted: true }))).toEqual([]);
  });

  it("treats only blocked, overdue, cancelled or missing remediation as stalled", () => {
    expect(isIcarusRemediationStalled("None")).toBe(true);
    expect(isIcarusRemediationStalled("Blocked")).toBe(true);
    expect(isIcarusRemediationStalled("Overdue")).toBe(true);
    expect(isIcarusRemediationStalled("Cancelled")).toBe(true);
    expect(isIcarusRemediationStalled("Missing action")).toBe(true);
    expect(isIcarusRemediationStalled("In progress")).toBe(false);
    expect(isIcarusRemediationStalled("Completed")).toBe(false);
  });
});
