import { readFileSync } from "node:fs";
import { parse, parsePlPgSQL } from "libpg-query";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../design/sql/006_stage_import_candidate.sql", import.meta.url), "utf8");
const stage = sql.slice(sql.indexOf("CREATE FUNCTION empire_os_authorization.stage_import"), sql.indexOf("REVOKE ALL"));

describe("stage-import candidate offline SQL syntax", () => {
  it("parses SQL and PL/pgSQL without connecting to or changing a database", async () => {
    await expect(parse(sql)).resolves.toBeDefined();
    await expect(parsePlPgSQL(sql)).resolves.toBeDefined();
  });
});

describe("inactive stage-import candidate safety contract (static, not PostgreSQL execution)", () => {
  it("remains an explicit candidate with no runtime grants, route or activation", () => {
    expect(sql).toContain("INACTIVE CANDIDATE ONLY");
    expect(sql.match(/^CREATE FUNCTION\b/gm)).toHaveLength(1);
    expect(sql).toMatch(/^CREATE OR REPLACE FUNCTION empire_os_authorization\.check_write_audit\(\)/m);
    expect(sql).not.toMatch(/^GRANT\b/gm);
    expect(sql).toContain("REVOKE ALL ON FUNCTION empire_os_authorization.stage_import(text,jsonb) FROM PUBLIC");
  });

  it("fails closed on prerequisite/schema drift and requires the authorization schema owner", () => {
    for (const prerequisite of ["read_dataset_snapshot(text,uuid)", "lookup_operation(text,text)", "runtime_subject(text)"]) {
      expect(sql).toContain(`to_regprocedure('empire_os_authorization.${prerequisite}') IS NULL`);
    }
    expect(sql).toContain("stage_import(text,jsonb)') IS NOT NULL");
    expect(sql).toContain("Expected exactly one existing audit operation constraint");
    expect(sql).toMatch(/current_user IS DISTINCT FROM \(SELECT r\.rolname FROM pg_namespace n/);
  });

  it("binds server actor/tenant authority and refuses incomplete, conflicting or occupied imports", () => {
    expect(stage).toContain("actor := empire_os_authorization.runtime_subject(tenant)");
    expect(stage).toContain("empire-os-import-source-v2");
    expect(stage).toContain("empire_os_authorization.read_dataset_snapshot(tenant,dataset)");
    expect(stage).toContain("Import staging also requires read capability");
    expect(stage).toContain("p_request->>'tenantId'");
    expect(stage).toContain("payload->>'idempotencyKey' IS DISTINCT FROM p_request->>'operationId'");
    expect(stage).toContain("plan->>'version' IS DISTINCT FROM '2'");
    expect(stage).toContain("jsonb_array_length(entries) <> 21");
    expect(stage).toContain("Import source fingerprint does not match exact UTF-16LE values");
    expect(stage).toContain("Import target is already initialized");
    expect(stage).toContain("Import target has existing dataset values or import evidence");
    expect(stage).toContain("empire_os_preparation.transactions");
    expect(stage).toContain("empire_os_preparation.idempotency_results");
    expect(stage).toContain("empire_os_preparation.import_sources");
    expect(stage).toContain("authority_mode='preparation-only'");
    const authorizationMigration = readFileSync(
      new URL("../migrations/002_isolated_authorization.sql", import.meta.url), "utf8"
    );
    expect(authorizationMigration).toMatch(
      /CREATE UNIQUE INDEX successful_operation_once ON empire_os_authorization\.audit\(tenant_id,actor_subject,operation_id\) WHERE allowed;/
    );
    expect(stage).toContain("INSERT INTO empire_os_authorization.audit");
    expect(stage).toContain("INSERT INTO empire_os_authorization.preparation_writes");
  });
});
