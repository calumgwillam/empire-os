import { readFileSync } from "node:fs";
import { parse, parsePlPgSQL } from "libpg-query";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../design/sql/founder-eligibility-preflight-candidate.sql", import.meta.url), "utf8");

describe("dormant founder preflight reader (offline only, not database enforcement proof)", () => {
  it("parses SQL and PL/pgSQL without a PostgreSQL connection", async () => {
    await expect(parse(sql)).resolves.toBeDefined();
    await expect(parsePlPgSQL(sql)).resolves.toBeDefined();
  });
  it("adds only a revoked-public reader, not a writer, grant, table or migration", () => {
    expect(sql.match(/CREATE FUNCTION /g)).toHaveLength(1);
    expect(sql).toContain("SECURITY DEFINER SET search_path=pg_catalog");
    expect(sql).toContain("REVOKE ALL ON FUNCTION empire_os_identity.lock_founder_eligibility_decision(text,text,text,text) FROM PUBLIC");
    expect(sql).not.toMatch(/^\s*(GRANT|INSERT|UPDATE|DELETE|TRUNCATE|CREATE TABLE|CREATE ROLE)\b/im);
    expect(sql).not.toContain("consume_operation");
    expect(sql).not.toContain("approved_operations");
  });
  it("locks registry before all tenants, then checks derived actor authority before disclosure", () => {
    const registry = sql.indexOf("identity_registry r WHERE singleton FOR UPDATE");
    const table = sql.indexOf("LOCK TABLE empire_os_authorization.tenants");
    const tenants = sql.indexOf("tenants ORDER BY tenant_id FOR UPDATE");
    const actor = sql.indexOf("actor := empire_os_identity.runtime_actor(p_tenant)");
    expect(registry).toBeGreaterThan(0);
    expect(table).toBeGreaterThan(registry);
    expect(tenants).toBeGreaterThan(table);
    expect(actor).toBeGreaterThan(tenants);
    expect(sql.indexOf("empire_os_identity.runtime_actor(scope)")).toBeGreaterThan(actor);
    expect(sql.indexOf("RETURN QUERY")).toBeGreaterThan(sql.indexOf("snapshot,tenant,ownerSubjects"));
    expect(sql).toContain("p_subject IS NOT DISTINCT FROM actor");
  });
  it("returns exact latest existing events and decision evidence, never inferred Person data", () => {
    expect(sql.match(/ORDER BY p.revision DESC LIMIT 1/g)).toHaveLength(2);
    for (const field of ["issuerSubject", "sourceReference", "evidenceSha256", "recordedAtMs",
      "authenticationReference", "issuerAuthorityReference", "issuerMembershipRevision", "subjectMembershipRevision"]) {
      expect(sql).toContain(`'${field}'`);
    }
    expect(sql).toContain("d.tenant_id=p_tenant AND d.operation_id=p_operation");
    expect(sql).toContain("p.tenant_id=p_tenant AND p.operation_id=p_operation");
    expect(sql).toContain("e.operation_id=p_operation");
    expect(sql).toContain("e.event->>'tenantId'=p_tenant");
    expect(sql).not.toContain("'kind','other'");
    expect(sql).not.toContain("'status','active'");
  });
});
