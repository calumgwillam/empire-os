import { describe, expect, it } from "vitest";
import { configDefaults } from "vitest/config";
import defaultConfig from "./vitest.config";
import stageV9Config from "./vitest.stage-v9.config";

const stageV9Test = "database/tests/stage-import-v9.postgres.integration.test.ts";

describe("Vitest one-use PostgreSQL suite discovery", () => {
  it("excludes only the v9 suite from default discovery while retaining Vitest defaults", () => {
    const exclusions = defaultConfig.test?.exclude ?? [];
    expect(exclusions).toContain(stageV9Test);
    for (const exclusion of configDefaults.exclude) {
      expect(exclusions).toContain(exclusion);
    }
  });

  it("selects the v9 suite only under its dedicated config", () => {
    expect(stageV9Config.test?.include).toEqual([stageV9Test]);
    expect(stageV9Config.test?.exclude ?? []).not.toContain(stageV9Test);
  });
});
