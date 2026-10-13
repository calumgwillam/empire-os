import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["database/tests/stage-import-v9.postgres.integration.test.ts"],
    exclude: configDefaults.exclude,
  },
});
