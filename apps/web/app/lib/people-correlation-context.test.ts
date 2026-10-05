import { describe, expect, it } from "vitest";
import { buildPeopleCorrelationContext, getPersonCorrelationRecordKey } from "./people-correlation-context";

const people = [
  { id: "founder", name: "Founder", status: "Active" },
  { id: "lead", name: "Lead", status: "Active" },
  { id: "former", name: "Former", status: "Inactive" },
];

describe("buildPeopleCorrelationContext", () => {
  it("records founder dependency on the founder with founder-only work as evidence", () => {
    const records = buildPeopleCorrelationContext({
      people,
      primaryFounderId: "founder",
      founderDependentWork: [{ objectType: "Action", id: "b" }, { objectType: "Action", id: "a" }, { objectType: "Action", id: "a" }],
      capabilityGaps: [],
    });
    expect(records).toEqual([{
      recordKey: "Person:founder",
      objectType: "Person",
      id: "founder",
      title: "Founder",
      area: "People",
      signals: ["founder dependency"],
      evidenceRecordKeysBySignal: { "founder dependency": ["Action:a", "Action:b"] },
    }]);
  });

  it("does not record founder dependency without founder-only work or a resolved founder", () => {
    expect(buildPeopleCorrelationContext({ people, primaryFounderId: "founder", founderDependentWork: [], capabilityGaps: [] })).toEqual([]);
    expect(buildPeopleCorrelationContext({ people, primaryFounderId: null, founderDependentWork: [{ objectType: "Action", id: "a" }], capabilityGaps: [] })).toEqual([]);
  });

  it("records capability gaps only for active non-founder people with missing fields", () => {
    const records = buildPeopleCorrelationContext({
      people,
      primaryFounderId: "founder",
      founderDependentWork: [],
      capabilityGaps: [
        { personId: "lead", missingFields: ["role"] },
        { personId: "founder", missingFields: ["role"] },
        { personId: "former", missingFields: ["role"] },
        { personId: "unknown", missingFields: ["role"] },
        { personId: "lead", missingFields: [] },
      ],
    });
    expect(records.map((record) => [record.recordKey, record.signals])).toEqual([["Person:lead", ["capability gap"]]]);
  });

  it("merges signals per Person and orders deterministically", () => {
    const input = {
      people: [...people, { id: "a-person", name: "A", status: "Active" }],
      primaryFounderId: "founder",
      founderDependentWork: [{ objectType: "Action", id: "a" }],
      capabilityGaps: [{ personId: "lead", missingFields: ["role"] }, { personId: "a-person", missingFields: ["authority"] }],
    };
    const records = buildPeopleCorrelationContext(input);
    expect(records.map((record) => record.recordKey)).toEqual(["Person:a-person", "Person:founder", "Person:lead"]);
    expect(buildPeopleCorrelationContext({ ...input, capabilityGaps: [...input.capabilityGaps].reverse() })).toEqual(records);
  });

  it("keys Person identity by stable id, never by name", () => {
    expect(getPersonCorrelationRecordKey("lead")).toBe("Person:lead");
    const renamed = buildPeopleCorrelationContext({
      people: [{ id: "lead", name: "Renamed", status: "Active" }],
      primaryFounderId: null,
      founderDependentWork: [],
      capabilityGaps: [{ personId: "lead", missingFields: ["role"] }],
    });
    expect(renamed[0].recordKey).toBe("Person:lead");
  });
});
