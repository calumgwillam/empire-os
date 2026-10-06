import { describe, expect, it } from "vitest";
import type { IcarusRecordReference, IcarusSourceRecord } from "./icarus";
import {
  buildIcarusDependencyHealthRegistry,
  getIcarusDependencyHealth,
  type IcarusDependencyHealthInput,
} from "./icarus-dependency-health";
import { getIcarusEffectiveBarrierState } from "./icarus-failure-chain-policy";

const reference = (recordType: IcarusRecordReference["recordType"], recordId: string): IcarusRecordReference => ({
  recordType,
  recordId,
});

const source = (
  recordType: IcarusSourceRecord["recordType"],
  recordId: string,
  overrides: Partial<IcarusSourceRecord> = {},
): IcarusSourceRecord => ({ recordType, recordId, title: recordId, ...overrides });

const input = (overrides: Partial<IcarusDependencyHealthInput> = {}): IcarusDependencyHealthInput => ({
  sourceRecords: [],
  people: [],
  actions: [],
  nowMs: Date.parse("2025-04-10T12:00:00.000Z"),
  ...overrides,
});

describe("Icarus dependency health", () => {
  it("derives People health only from known active state", () => {
    const registry = buildIcarusDependencyHealthRegistry(input({
      people: [{ id: "active", status: "Active" }, { id: "inactive", status: "Inactive" }, { id: "other", status: "Unknown" }],
    }));

    expect(getIcarusDependencyHealth(registry, reference("Person", "active"))).toMatchObject({
      health: "Healthy",
      basis: ["active-person"],
      source: "Derived",
    });
    expect(getIcarusDependencyHealth(registry, reference("Person", "inactive")).health).toBe("Failed");
    expect(getIcarusDependencyHealth(registry, reference("Person", "other")).health).toBe("Unknown");
  });

  it("keeps workflow state distinct from verified operational health", () => {
    const registry = buildIcarusDependencyHealthRegistry(input({
      actions: [
        { id: "completed", status: "Completed" },
        { id: "blocked", status: "Blocked" },
        { id: "overdue", status: "In Progress", dueDate: "2025-04-01" },
        { id: "cancelled", status: "Cancelled" },
        { id: "active", status: "In Progress" },
      ],
    }));

    for (const id of ["completed", "blocked", "overdue", "cancelled", "active"]) {
      expect(getIcarusDependencyHealth(registry, reference("Action", id))).toMatchObject({
        health: "Unknown",
        basis: expect.arrayContaining(["no-operational-health-evidence"]),
      });
    }
    expect(getIcarusDependencyHealth(registry, reference("Action", "missing"))).toMatchObject({
      health: "Unknown",
      basis: ["missing-source-record"],
    });
  });

  it("uses existing project health evidence without treating completed projects as failed", () => {
    const registry = buildIcarusDependencyHealthRegistry(input({
      sourceRecords: [
        source("Project", "on-track", { status: "In Progress", health: "On track", relevantAt: "2025-04-09" }),
        source("Project", "at-risk", { status: "In Progress", health: "At risk" }),
        source("Project", "blocked", { status: "Blocked" }),
        source("Project", "completed", { status: "Completed", health: "On track" }),
        source("Project", "cancelled", { status: "Cancelled" }),
        source("Project", "active-no-health", { status: "In Progress" }),
      ],
    }));

    expect(getIcarusDependencyHealth(registry, reference("Project", "on-track"))).toMatchObject({
      health: "Healthy",
      relevantAt: "2025-04-09",
    });
    expect(getIcarusDependencyHealth(registry, reference("Project", "at-risk")).health).toBe("Watch");
    expect(getIcarusDependencyHealth(registry, reference("Project", "blocked")).health).toBe("Degraded");
    expect(getIcarusDependencyHealth(registry, reference("Project", "completed")).health).toBe("Not applicable");
    expect(getIcarusDependencyHealth(registry, reference("Project", "cancelled")).health).toBe("Unknown");
    expect(getIcarusDependencyHealth(registry, reference("Project", "active-no-health"))).toMatchObject({
      health: "Unknown",
      basis: ["unsupported-project-state", "no-operational-health-evidence"],
    });
  });

  it("keeps SOP and System health Unknown when only identity or lifecycle state is available", () => {
    const registry = buildIcarusDependencyHealthRegistry(input({
      sourceRecords: [
        source("SOP", "sop", { status: "Active" }),
        source("System", "system", { status: "Active" }),
      ],
    }));

    expect(getIcarusDependencyHealth(registry, reference("SOP", "sop"))).toMatchObject({
      health: "Unknown",
      basis: ["no-operational-health-evidence"],
    });
    expect(getIcarusDependencyHealth(registry, reference("System", "system")).health).toBe("Unknown");
  });

  it("does not resolve conflicting duplicate states by input order", () => {
    const records = [
      source("Project", "conflict", { status: "In Progress", health: "On track" }),
      source("Project", "conflict", { status: "Blocked", health: "Blocked" }),
    ];
    const first = buildIcarusDependencyHealthRegistry(input({ sourceRecords: records }));
    const second = buildIcarusDependencyHealthRegistry(input({ sourceRecords: [...records].reverse() }));

    expect(getIcarusDependencyHealth(first, reference("Project", "conflict"))).toMatchObject({
      health: "Unknown",
      basis: ["conflicting-record-state"],
    });
    expect(getIcarusDependencyHealth(second, reference("Project", "conflict"))).toMatchObject({
      health: "Unknown",
      basis: ["conflicting-record-state"],
    });
  });
});

describe("effective Icarus barrier precedence", () => {
  it("lets assurance and required dependency health jointly cap the barrier", () => {
    expect(getIcarusEffectiveBarrierState("Assured", ["Healthy"])).toBe("Active");
    expect(getIcarusEffectiveBarrierState("Assured", ["Watch"])).toBe("Active");
    expect(getIcarusEffectiveBarrierState("Assured", ["Degraded"])).toBe("Weak");
    expect(getIcarusEffectiveBarrierState("Assured", ["Failed"])).toBe("Failed");
    expect(getIcarusEffectiveBarrierState("Assured", ["Unknown"])).toBe("Unknown");
    expect(getIcarusEffectiveBarrierState("Assured", ["Not applicable"])).toBe("Active");
  });

  it("does not let dependency health upgrade a failed, untested, or non-operating control", () => {
    expect(getIcarusEffectiveBarrierState("Failed", ["Healthy"])).toBe("Failed");
    expect(getIcarusEffectiveBarrierState("Untested", ["Healthy"])).toBe("Unknown");
    expect(getIcarusEffectiveBarrierState("Not operating", ["Healthy"])).toBe("Failed");
    expect(getIcarusEffectiveBarrierState("Assured", ["Healthy", "Failed"])).toBe("Failed");
  });
});
