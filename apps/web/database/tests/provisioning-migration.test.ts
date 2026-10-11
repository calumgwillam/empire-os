import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "database/migrations/005_trusted_employee_provisioning.sql",
  "utf8",
);

describe("Employee provisioning migration safety", () => {
  it("remains fail-closed until implementation", () => {
    expect(migration).toContain(
      "Employee provisioning migration is incomplete and disabled",
    );
  });

  it("does not grant runtime permissions while disabled", () => {
    expect(migration.replace(/^\s*--.*$/gm, "")).not.toMatch(/\bGRANT\b/i);
  });
});
