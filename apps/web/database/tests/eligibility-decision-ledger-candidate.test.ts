import { readFileSync } from "node:fs";
import { parse, parsePlPgSQL } from "libpg-query";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../design/sql/eligibility-decision-ledger-candidate.sql", import.meta.url), "utf8");
const fence = sql.slice(sql.indexOf("CREATE FUNCTION empire_os_identity.fence_eligibility_decision()"));

describe("dormant decision-ledger SQL (offline structure, not database enforcement proof)", () => {
  it("parses SQL and PL/pgSQL without connecting to PostgreSQL", async () => {
    await expect(parse(sql)).resolves.toBeDefined();
    await expect(parsePlPgSQL(sql)).resolves.toBeDefined();
  });
  it("creates only decision evidence referencing existing Person event revisions", () => {
    expect(sql.match(/CREATE TABLE /g)).toHaveLength(1);
    expect(sql).toContain("REFERENCES empire_os_identity.person_authority_events(tenant_id,person_id,revision)");
    expect(sql).toContain("FOREIGN KEY (tenant_id,issuer_person_id,issuer_person_revision)");
    expect(sql).toContain("PRIMARY KEY (tenant_id,operation_id)");
    expect(sql).toContain("UNIQUE (tenant_id,person_id,person_revision)");
    expect(sql).not.toMatch(/^\s*(INSERT INTO|GRANT|CREATE ROLE|UPDATE|DELETE FROM|TRUNCATE)\b/im);
  });
  it("enforces owner-only RLS, immutable rows and no truncate", () => {
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("EXECUTE FUNCTION empire_os_identity.owner_statement()");
    expect(sql).toContain("immutable_eligibility_decision BEFORE UPDATE OR DELETE");
    expect(sql).toContain("no_eligibility_decision_truncate BEFORE TRUNCATE");
    expect(sql.match(/EXECUTE FUNCTION empire_os_identity.reject_mutation\(\)/g)).toHaveLength(2);
    expect(sql).toContain("REVOKE ALL ON TABLE empire_os_identity.eligibility_decisions FROM PUBLIC");
    expect(sql).toContain("REVOKE ALL ON FUNCTION empire_os_identity.fence_eligibility_decision() FROM PUBLIC");
  });
  it("serializes with existing writers in registry-before-tenant order and rejects stale bindings/revisions", () => {
    const registry = fence.indexOf("identity_registry WHERE singleton FOR UPDATE");
    const tenant = fence.indexOf("tenants WHERE tenant_id=NEW.tenant_id FOR UPDATE");
    expect(registry).toBeGreaterThan(0);
    expect(tenant).toBeGreaterThan(registry);
    expect(fence.indexOf("SELECT * INTO STRICT bound")).toBeGreaterThan(tenant);
    for (const field of ["registry_revision", "binding_revision", "policy_revision", "binding_id", "issuer_binding_id"]) {
      expect(fence).toContain(`NEW.${field}`);
    }
    expect(fence).toContain("USING ERRCODE='40001'");
  });
  it("requires same-transaction exact-event evidence and derives recorded time from the existing database event", () => {
    expect(fence).toContain("person_event.database_transaction IS DISTINCT FROM pg_current_xact_id()");
    expect(fence).toContain("NEW.database_transaction IS DISTINCT FROM pg_current_xact_id()");
    expect(fence).toContain("person_event.operation_id IS DISTINCT FROM NEW.operation_id");
    expect(fence).toContain("NEW.event IS DISTINCT FROM jsonb_build_object(");
    for (const field of ["sourceReference", "evidenceSha256", "issuerSubject", "recordedAtMs"]) expect(fence).toContain(`'${field}'`);
    expect(fence).toContain("NEW.recorded_at_ms := person_event.recorded_at_ms");
    expect(sql).toContain("subject<>issuer_subject AND person_id<>issuer_person_id");
  });
  it("checks current issuer and target membership, tenant binding origin and subsequent Person events under the locks", () => {
    for (const condition of [
      "snapshot,tenant,ownerSubjects", "NEW.issuer_membership_revision", "NEW.subject_membership_revision",
      "e.event->>'tenantId'=NEW.tenant_id", "p.status='active' AND p.kind='founder'",
      "p.revision>NEW.person_revision", "p.revision>NEW.issuer_person_revision",
    ]) expect(fence).toContain(condition);
    expect(fence.indexOf("Eligibility decision tenant, membership or Person evidence changed"))
      .toBeGreaterThan(fence.indexOf("tenants WHERE tenant_id=NEW.tenant_id FOR UPDATE"));
  });
  it("has an unconditional insertion stop, not an environment/catalog/caller approval", () => {
    const stop = fence.indexOf("RAISE EXCEPTION 'Authenticated eligibility decision persistence is unavailable'");
    expect(stop).toBeGreaterThan(fence.indexOf("NEW.recorded_at_ms :="));
    expect(fence.slice(stop, fence.indexOf("$$;", stop))).not.toMatch(/\bIF\b|\bRETURN\b/);
    expect(sql).not.toContain("SECURITY DEFINER");
    expect(sql).not.toContain("COMMIT AND");
  });
});
