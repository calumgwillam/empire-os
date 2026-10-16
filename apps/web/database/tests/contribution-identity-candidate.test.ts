import { readFileSync } from "node:fs";
import { parse, parsePlPgSQL } from "libpg-query";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../design/sql/contribution-identity-registry-candidate.sql", import.meta.url), "utf8");

describe("contribution identity schema candidate (offline only)", () => {
  it("parses SQL and PL/pgSQL without connecting to PostgreSQL", async () => {
    await expect(parse(sql)).resolves.toBeDefined();
    await expect(parsePlPgSQL(sql)).resolves.toBeDefined();
  });

  it("remains a design candidate with no runtime mutation API or grants", () => {
    expect(sql).toContain("DESIGN CANDIDATE ONLY");
    expect(sql).not.toMatch(/^\s*GRANT\b/im);
    expect(sql).not.toMatch(/CREATE\s+FUNCTION\s+empire_os_identity\.(?:bind|reassign|revoke|apply)/i);
    expect(sql).toContain("REVOKE ALL ON SCHEMA empire_os_identity FROM PUBLIC");
    expect(sql).toContain("ALTER TABLE empire_os_identity.%I FORCE ROW LEVEL SECURITY");
  });

  it("stores global one-to-one active bindings and tenant-scoped explicit administrator capabilities", () => {
    expect(sql).toContain("subject text NOT NULL UNIQUE");
    expect(sql).toContain("person_id text NOT NULL UNIQUE");
    expect(sql).toContain("one_active_identity_grant_per_tenant");
    expect(sql).toContain('"bind","revoke","reassign","delegate","approve-reassignment","recover-founder"');
  });

  it("retains verification and audit provenance and prevents history mutation", () => {
    expect(sql).toContain("verified_identity_claims");
    expect(sql).toContain("one_use_per_verified_identity_claim");
    expect(sql).toContain("immutable_verified_identity_claims");
    expect(sql).toContain("immutable_identity_events");
    expect(sql).toContain("membership_revocations jsonb");
    expect(sql).toContain("approved_by_subject <> actor_subject");
    expect(sql).toContain("registry_revision bigint NOT NULL UNIQUE");
  });
});
