import { readFileSync } from "node:fs";
import { parse, parsePlPgSQL } from "libpg-query";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../design/sql/member-authority-candidate.sql", import.meta.url), "utf8");
const identity = readFileSync(new URL("../design/sql/contribution-identity-persistence-candidate.sql", import.meta.url), "utf8");
const authorization = readFileSync(new URL("../migrations/002_isolated_authorization.sql", import.meta.url), "utf8");
const snapshot = readFileSync(new URL("../migrations/004_authorized_dataset_snapshot.sql", import.meta.url), "utf8");

function definition(name: string): string {
  const start = sql.indexOf(`CREATE FUNCTION empire_os_identity.${name}(`);
  if (start < 0) throw new Error(`Missing candidate function: ${name}`);
  const end = sql.indexOf("$$;", start);
  if (end < 0) throw new Error(`Unterminated candidate function: ${name}`);
  return sql.slice(start, end);
}

describe("member authority SQL candidate (offline structural checks, NOT database lock proof)", () => {
  it("parses SQL and PL/pgSQL without a database", async () => {
    await expect(parse(sql)).resolves.toBeDefined();
    await expect(parsePlPgSQL(sql)).resolves.toBeDefined();
  });

  it("remains an unapplied candidate with no grants, roles, bootstrap or business DML", () => {
    expect(sql).toContain("INACTIVE DESIGN CANDIDATE ONLY");
    expect(sql).not.toMatch(/^\s*(GRANT|CREATE ROLE|INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\b/im);
    expect(sql).toContain("REVOKE ALL ON TABLE empire_os_identity.person_authority_events FROM PUBLIC");
    for (const name of ["lock_member_authority(text,uuid)", "member_authority_ready()", "fence_person_authority()", "fence_member_identity()"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION empire_os_identity.${name} FROM PUBLIC`);
    }
    expect(sql).not.toMatch(/CREATE TABLE empire_os_authorization\./);
  });

  it("stores only existing IdentityPerson eligibility plus immutable evidence, not competing permissions", () => {
    const table = sql.slice(sql.indexOf("CREATE TABLE"), sql.indexOf("ALTER TABLE"));
    expect(table).toContain("status IN ('active','inactive')");
    expect(table).toContain("kind IN ('founder','system-owner','other')");
    for (const field of ["issuer_subject", "source_reference", "evidence_sha256", "database_transaction", "recorded_at_ms"]) {
      expect(table).toContain(field);
    }
    expect(table).toContain("PRIMARY KEY (tenant_id,person_id,revision)");
    expect(table).toContain("UNIQUE (tenant_id,operation_id)");
    expect(table).not.toMatch(/\b(role_ids|permissions|grants|memberships)\b/i);
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("EXECUTE FUNCTION empire_os_identity.owner_statement()");
    expect(sql).toContain("CREATE TRIGGER immutable_person_authority BEFORE UPDATE OR DELETE");
    expect(sql).toContain("CREATE TRIGGER no_person_authority_truncate BEFORE TRUNCATE");
  });

  it("uses registry-before-tenant order for eligibility appends and rejects stale revisions", () => {
    const writer = definition("fence_person_authority");
    const registry = writer.indexOf("identity_registry WHERE singleton FOR UPDATE");
    const tenant = writer.indexOf("tenants WHERE tenant_id=NEW.tenant_id FOR UPDATE");
    const history = writer.indexOf("SELECT coalesce(max(revision),0)");
    expect(registry).toBeGreaterThan(0);
    expect(tenant).toBeGreaterThan(registry);
    expect(history).toBeGreaterThan(tenant);
    expect(writer).toContain("NEW.revision<>previous_revision+1");
    expect(writer).toContain("NEW.database_transaction<>pg_current_xact_id()");
    expect(writer).toContain("NEW.recorded_at_ms := stamp");
  });

  it("fences projection maintenance and history insertion with the same existing registry row lock", () => {
    expect(definition("fence_member_identity")).toContain("identity_registry WHERE singleton FOR UPDATE");
    expect(sql).toContain("CREATE TRIGGER serialize_member_identity BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE");
    expect(sql).toContain("CREATE TRIGGER serialize_member_history BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE");
    const approvedLock = identity.slice(identity.indexOf("CREATE FUNCTION empire_os_identity.lock_operation("));
    expect(approvedLock.indexOf("identity_registry WHERE singleton FOR UPDATE"))
      .toBeLessThan(approvedLock.indexOf("tenants ORDER BY tenant_id FOR UPDATE"));
    expect(identity).toContain("DELETE FROM empire_os_identity.active_bindings WHERE subject=old_subject");
  });

  it("derives actor from the restricted role and never accepts a subject, Person or role argument", () => {
    const reader = definition("lock_member_authority");
    expect(reader.startsWith("CREATE FUNCTION empire_os_identity.lock_member_authority(p_tenant text,p_dataset uuid)")).toBe(true);
    expect(reader.match(/actor := empire_os_authorization.runtime_subject\(p_tenant\)/g)).toHaveLength(2);
    expect(reader).toContain("has_schema_privilege(runtime_role,'empire_os_identity','CREATE')");
    expect(reader).toContain("has_any_column_privilege(runtime_role,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')");
    expect(reader).toContain("actor IS DISTINCT FROM initial_actor");
    expect(reader).not.toContain("empire_os_identity.runtime_actor(");
  });

  it("locks before reading the binding/Person and uses existing SQL read permission evaluation", () => {
    const reader = definition("lock_member_authority");
    const registry = reader.indexOf("WHERE singleton FOR UPDATE");
    const tenant = reader.indexOf("WHERE t.tenant_id=p_tenant FOR UPDATE");
    const binding = reader.indexOf("SELECT * INTO bound");
    const person = reader.indexOf("SELECT * INTO person_event");
    const permission = reader.indexOf("SELECT * INTO STRICT snapshot");
    expect(registry).toBeGreaterThan(0);
    expect(tenant).toBeGreaterThan(registry);
    expect(reader.indexOf("IN ROW EXCLUSIVE MODE")).toBeGreaterThan(registry);
    expect(reader.indexOf("member_authority_ready() IS DISTINCT FROM true"))
      .toBeGreaterThan(reader.indexOf("IN ROW EXCLUSIVE MODE"));
    expect(binding).toBeGreaterThan(tenant);
    expect(person).toBeGreaterThan(binding);
    expect(permission).toBeGreaterThan(person);
    expect(reader).toContain("person_event.status<>'active'");
    expect(reader).toContain("read_dataset_snapshot(p_tenant,p_dataset)");
    expect(reader).toContain("snapshot.decision->>'status' IS DISTINCT FROM 'allowed'");
    expect(reader).not.toMatch(/->'roles'|->'delegations'|ownerSubjects/);
    expect(snapshot).toContain("WHERE t.tenant_id=p_tenant FOR UPDATE");
    expect(authorization).toContain("CREATE TRIGGER serialize_binding BEFORE INSERT OR UPDATE OR DELETE");
  });

  it("cross-checks binding evidence without returning global history or business values", () => {
    const reader = definition("lock_member_authority");
    expect(reader).toContain("last_event->>'eventId' IS DISTINCT FROM bound.event_id");
    expect(reader).toContain("last_event->>'bindingId' IS DISTINCT FROM bound.binding_id");
    expect(reader).toContain("last_event->>'tenantId' IS DISTINCT FROM p_tenant");
    expect(reader).toContain("e->>'previousPersonId'=bound.person_id");
    expect(reader).toContain("WHERE e.event_id=bound.event_id AND e.event=last_event");
    const result = reader.slice(reader.indexOf("RETURN QUERY"));
    expect(result).not.toMatch(/store_values|saved->'events'|registry\s*[,;]/);
    expect(reader).not.toContain("approved_operations");
  });

  it("returns exact eligibility audit fields from the locked latest event without claiming issuer verification", () => {
    const reader = definition("lock_member_authority");
    expect(reader).toContain("eligibility_event jsonb");
    expect(reader).toContain("WHERE p.tenant_id=p_tenant AND p.person_id=bound.person_id ORDER BY p.revision DESC LIMIT 1");
    const result = reader.slice(reader.indexOf("RETURN QUERY"));
    for (const [field, column] of [
      ["tenantId", "tenant_id"], ["personId", "person_id"], ["revision", "revision"],
      ["status", "status"], ["kind", "kind"], ["operationId", "operation_id"],
      ["issuerSubject", "issuer_subject"], ["sourceReference", "source_reference"],
      ["evidenceSha256", "evidence_sha256"], ["recordedAtMs", "recorded_at_ms"],
    ]) expect(result).toContain(`'${field}',person_event.${column}`);
    expect(result).not.toMatch(/issuerVerified|provenanceVerified|approved_operations|database_transaction/);
  });

  it("fails closed on absent or disabled locking triggers rather than assuming their presence", () => {
    const ready = definition("member_authority_ready");
    const reader = definition("lock_member_authority");
    expect(reader).toContain("member_authority_ready() IS DISTINCT FROM true");
    expect(ready).toContain("t.tgfoid=to_regprocedure(required.function_name)");
    expect(ready).toContain("t.tgtype=required.trigger_type");
    expect(ready).toContain("t.tgenabled IN ('O','A')");
    expect(ready).toContain("'empire_os_authorization.lock_tenant()',31");
    expect(ready).toContain("i.indisvalid AND i.indisunique");
    expect(ready).toContain("p.proconfig @> ARRAY['search_path=pg_catalog']");
    expect(ready).toContain("a.grantee=0 AND a.privilege_type='EXECUTE'");
  });
});
