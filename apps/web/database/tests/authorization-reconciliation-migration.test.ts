import { readFileSync } from "node:fs";
import { parse, parsePlPgSQL } from "libpg-query";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../migrations/003_authorization_reconciliation.sql", import.meta.url), "utf8");
const lookup = sql.slice(sql.indexOf("CREATE FUNCTION empire_os_authorization.lookup_operation"), sql.indexOf("REVOKE ALL"));

describe("authorization reconciliation migration offline syntax", () => {
  // The WASM parser executes no SQL and does not connect to a database.
  it("parses the complete SQL migration and its PL/pgSQL function and guard block", async () => {
    await expect(parse(sql)).resolves.toBeDefined();
    await expect(parsePlPgSQL(sql)).resolves.toBeDefined();
  });
});

describe("authorization reconciliation migration security contract (static, not PostgreSQL execution)", () => {
  it("is additive: one guarded function, no tables, grants, roles, policies, triggers or data changes", () => {
    expect(sql.match(/CREATE FUNCTION/g)).toHaveLength(1);
    expect(sql).not.toMatch(/\b(GRANT|CREATE TABLE|ALTER TABLE|CREATE POLICY|CREATE TRIGGER|CREATE ROLE|ALTER ROLE|DROP|INSERT|DELETE|TRUNCATE)\b/);
    expect(sql.replaceAll("FOR UPDATE", "")).not.toMatch(/\bUPDATE\b/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION empire_os_authorization.lookup_operation(text,text) FROM PUBLIC");
  });
  it("refuses to run without 002, twice, or as anyone but the authorization schema owner", () => {
    expect(sql).toContain("to_regprocedure('empire_os_authorization.apply_operation(text,jsonb,jsonb)') IS NULL");
    expect(sql).toContain("to_regprocedure('empire_os_authorization.runtime_subject(text)') IS NULL");
    expect(sql).toContain("to_regprocedure('empire_os_authorization.lookup_operation(text,text)') IS NOT NULL");
    expect(sql).toMatch(/current_user IS DISTINCT FROM \(SELECT r\.rolname FROM pg_namespace n\s+JOIN pg_roles r ON r\.oid=n\.nspowner WHERE n\.nspname='empire_os_authorization'\)/);
  });
  it("is search-path pinned, binds the actor from the database role, and waits on the tenant lock", () => {
    expect(lookup).toMatch(/LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS/);
    const lock = lookup.indexOf("FOR UPDATE");
    expect(lookup.indexOf("actor := empire_os_authorization.runtime_subject(p_tenant)")).toBeLessThan(lock);
    expect(lookup.lastIndexOf("actor := empire_os_authorization.runtime_subject(p_tenant)")).toBeGreaterThan(lock);
    expect(lookup).toContain("FROM empire_os_authorization.tenants t WHERE t.tenant_id=p_tenant FOR UPDATE");
    expect(lookup.indexOf("FROM empire_os_authorization.audit a")).toBeGreaterThan(lock);
    expect(lookup).not.toMatch(/p_actor|current_setting\('empire/);
  });
  it("discloses only the bound actor's audit metadata for one operation, only while authorized", () => {
    expect(lookup).toContain("WHERE a.tenant_id=p_tenant AND a.actor_subject=actor AND a.operation_id=p_operation_id");
    expect(lookup).toContain("m->>'subject'=actor AND m->>'status'='active'");
    expect(lookup).toContain("locked_state #>> '{snapshot,tenant,status}' = 'active'");
    expect(lookup).toMatch(/CASE WHEN permitted THEN[\s\S]*ELSE '\[\]'::jsonb END/);
    expect(lookup).not.toMatch(/a\.applied_request\b(?!_sha256)/);
    expect(lookup).not.toMatch(/raw_value|preparation_writes|database_transaction/);
    expect(lookup).toContain("'^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$'");
  });
});
