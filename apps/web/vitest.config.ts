import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      "database/tests/stage-import-v9.postgres.integration.test.ts",
    ],
  },
});
