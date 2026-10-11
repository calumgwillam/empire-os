import { readFileSync } from "node:fs";
import { parse, parsePlPgSQL } from "libpg-query";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../migrations/004_authorized_dataset_snapshot.sql", import.meta.url), "utf8");
const read = sql.slice(sql.indexOf("CREATE FUNCTION empire_os_authorization.read_dataset_snapshot"), sql.indexOf("REVOKE ALL"));
const apply = readFileSync(new URL("../migrations/002_isolated_authorization.sql", import.meta.url), "utf8");

describe("authorized dataset snapshot migration offline syntax", () => {
  // The WASM parser executes no SQL and does not connect to a database.
  it("parses the complete SQL migration and its PL/pgSQL function and guard block", async () => {
    await expect(parse(sql)).resolves.toBeDefined();
    await expect(parsePlPgSQL(sql)).resolves.toBeDefined();
  });
});

describe("authorized dataset snapshot migration security contract (static, not PostgreSQL execution)", () => {
  it("is additive: one guarded read-only function, no tables, grants, roles, policies, triggers or data changes", () => {
    expect(sql.match(/CREATE FUNCTION/g)).toHaveLength(1);
    expect(sql).not.toMatch(/\b(GRANT|CREATE TABLE|ALTER TABLE|CREATE POLICY|CREATE TRIGGER|CREATE ROLE|ALTER ROLE|DROP|INSERT|DELETE|TRUNCATE)\b/);
    expect(sql.replaceAll("FOR UPDATE", "")).not.toMatch(/\bUPDATE\b/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION empire_os_authorization.read_dataset_snapshot(text,uuid) FROM PUBLIC");
  });
  it("refuses to run without 002 and 003, twice, or as anyone but the authorization schema owner", () => {
    expect(sql).toContain("to_regprocedure('empire_os_authorization.apply_operation(text,jsonb,jsonb)') IS NULL");
    expect(sql).toContain("to_regprocedure('empire_os_authorization.runtime_subject(text)') IS NULL");
    expect(sql).toContain("to_regprocedure('empire_os_authorization.lookup_operation(text,text)') IS NULL");
    expect(sql).toContain("to_regprocedure('empire_os_authorization.read_dataset_snapshot(text,uuid)') IS NOT NULL");
    expect(sql).toMatch(/current_user IS DISTINCT FROM \(SELECT r\.rolname FROM pg_namespace n\s+JOIN pg_roles r ON r\.oid=n\.nspowner WHERE n\.nspname='empire_os_authorization'\)/);
  });
  it("is search-path pinned, binds the actor from the database role, and reads only after the tenant lock", () => {
    expect(read).toMatch(/LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS/);
    const lock = read.indexOf("FOR UPDATE");
    expect(read).toContain("FROM empire_os_authorization.tenants t WHERE t.tenant_id=p_tenant FOR UPDATE");
    expect(read.indexOf("actor := empire_os_authorization.runtime_subject(p_tenant)")).toBeLessThan(lock);
    expect(read.lastIndexOf("actor := empire_os_authorization.runtime_subject(p_tenant)")).toBeGreaterThan(lock);
    expect(read.indexOf("clock_timestamp()")).toBeGreaterThan(lock);
    expect(read.indexOf("empire_os_authorization.preparation_writes")).toBeGreaterThan(lock);
    expect(read.indexOf("FROM empire_os_authorization.datasets")).toBeGreaterThan(lock);
    expect(read).not.toMatch(/p_actor|current_setting\('empire/);
  });
  it("evaluates read capability with the same ordered rules as apply_operation", () => {
    for (const reason of ["tenant-revoked", "dataset-not-authorized", "membership-required", "membership-revoked",
      "owner-authority", "direct-grant", "delegated-grant", "capability-not-granted"]) {
      expect(read).toContain(`reason := '${reason}'`);
      expect(apply).toContain(`reason := '${reason}'`);
    }
    const order = ["'tenant-revoked'", "'dataset-not-authorized'", "'membership-required'", "'membership-revoked'", "'owner-authority'"]
      .map((reason) => read.indexOf(reason));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(read).toContain("g->>'capability'='read'");
    expect(read).toContain("d->>'capability'='read'");
    expect(read).not.toMatch(/'write'|'import'/);
    for (const clause of ["(d->>'issuedAt')::numeric <= now_ms AND (d->>'expiresAt')::numeric > now_ms",
      "d->'recipientMembershipRevision'=member->'revision'", "issuer->'revision'=d->'issuerMembershipRevision'",
      "r->'revision'=d->'sourceRoleRevision'", "g->>'delegable'='true'", "Authority dataset mapping is inconsistent"]) {
      expect(read).toContain(clause);
      expect(apply).toContain(clause);
    }
  });
  it("discloses dataset counters and values only when allowed, and never audit evidence", () => {
    for (const column of ["fence.generation", "fence.authority_revision"]) {
      expect(read).toContain(`CASE WHEN allowed THEN ${column} END`);
    }
    expect(read).toMatch(/CASE WHEN allowed THEN \(SELECT count\(DISTINCT w\.transaction_id\)/);
    expect(read).toMatch(/CASE WHEN allowed THEN \(SELECT jsonb_agg[\s\S]*ELSE '\[\]'::jsonb END/);
    expect(read).toContain("encode(l.latest_value,'hex')");
    expect(read).toContain("ORDER BY s.registry_position");
    expect(read).toContain("WHERE w.tenant_id=p_tenant AND w.dataset_id=p_dataset AND w.store_key=s.store_key");
    expect(read).not.toMatch(/empire_os_authorization\.audit\b|applied_request|evidence\b/);
  });
});
