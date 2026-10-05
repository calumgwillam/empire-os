import { describe, expect, it } from "vitest";
import { indexConvergentSituationMembers, resolveStrategicRiskConvergence } from "./strategic-risk-resolution";

const situation = (clusterKey: string, rootRecordKey: string, keys: string[]) => ({
  clusterKey,
  rootRecordKey,
  records: keys.map((recordKey) => ({ recordKey })),
});

describe("strategic risk convergence resolution", () => {
  it("indexes members with the first situation winning", () => {
    const index = indexConvergentSituationMembers([situation("c1", "A:1", ["A:1", "X:1"]), situation("c2", "A:2", ["A:2", "X:1"])]);
    expect(index.get("X:1")).toBe("c1");
    expect(index.get("A:2")).toBe("c2");
  });

  it("resolves risks to their situation with root-first, sorted hosts that exclude risks", () => {
    const resolved = resolveStrategicRiskConvergence(
      [situation("cluster:Project:p", "Project:p", ["Risk:b", "Action:z", "Project:p", "Action:a", "Risk:a"])],
      ["Risk:a", "Risk:b", "Risk:absent"],
    );
    expect([...resolved.keys()]).toEqual(["Risk:a", "Risk:b"]);
    expect(resolved.get("Risk:a")).toEqual({
      clusterKey: "cluster:Project:p",
      rootRecordKey: "Project:p",
      hostRecordKeys: ["Project:p", "Action:a", "Action:z"],
    });
  });

  it("returns nothing for risks outside every convergent situation so they stay independently visible", () => {
    expect(resolveStrategicRiskConvergence([], ["Risk:a"]).size).toBe(0);
    expect(resolveStrategicRiskConvergence([situation("c", "A:1", ["A:1", "A:2"])], ["Risk:a"]).size).toBe(0);
  });

  it("is deterministic regardless of risk input order", () => {
    const situations = [situation("c", "A:1", ["A:1", "Risk:b", "Risk:a"])];
    expect([...resolveStrategicRiskConvergence(situations, ["Risk:b", "Risk:a"]).entries()])
      .toEqual([...resolveStrategicRiskConvergence(situations, ["Risk:a", "Risk:b"]).entries()]);
  });

  it("falls back to the first member as root when no root is supplied", () => {
    const resolved = resolveStrategicRiskConvergence([{ clusterKey: "c", records: [{ recordKey: "B:1" }, { recordKey: "Risk:a" }] }], ["Risk:a"]);
    expect(resolved.get("Risk:a")).toEqual({ clusterKey: "c", rootRecordKey: "B:1", hostRecordKeys: ["B:1"] });
  });
});
