import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../migrations/002_isolated_authorization.sql", import.meta.url), "utf8");

describe("authorization migration security contract (static, not PostgreSQL execution)", () => {
  it("exposes owner-scoped, search-path-pinned APIs without public execute or runtime DML grants", () => {
    expect(sql).toMatch(/lock_authority\(p_tenant text\)[\s\S]*?SECURITY DEFINER SET search_path = pg_catalog/);
    expect(sql).toMatch(/apply_operation\(p_request_text text,p_evidence jsonb,p_next jsonb\)[\s\S]*?SECURITY DEFINER SET search_path = pg_catalog/);
    expect(sql).toContain("REVOKE ALL ON ALL FUNCTIONS IN SCHEMA empire_os_authorization FROM PUBLIC");
    expect(sql).not.toMatch(/\bGRANT\b/);
    expect(sql).toContain("CREATE TRIGGER a_only_trusted_mutation BEFORE INSERT OR UPDATE OR DELETE");
    expect(sql).toContain("CREATE TRIGGER no_runtime_truncate BEFORE TRUNCATE");
  });
  it("binds actors to provisioned roles and computes current decisions and exact transitions", () => {
    expect(sql).toContain("SELECT actor_subject INTO subject");
    expect(sql).toContain("WHERE database_role=runtime_role AND tenant_id=p_tenant");
    expect(sql).toContain("p_evidence->>'actorSubject' IS DISTINCT FROM actor");
    expect(sql).toContain("p_evidence->'decision' IS DISTINCT FROM decision");
    expect(sql).toContain("p_next IS DISTINCT FROM expected_state");
    expect(sql).toContain("sha256(convert_to(p_request_text,'UTF8'))");
    expect(sql).toContain("AND issuer->>'status'='active'");
    expect(sql).toContain("has_any_column_privilege(runtime_role,c.oid,'UPDATE')");
    expect(sql).toContain("CREATE TRIGGER serialize_binding BEFORE INSERT OR UPDATE OR DELETE");
    expect(sql).toContain("current_setting('transaction_isolation') <> 'read committed'");
  });
  it("requires audit evidence from the actual database transaction and current revision", () => {
    expect(sql).toContain("database_transaction xid8 NOT NULL DEFAULT pg_current_xact_id()");
    expect(sql).toContain("UNIQUE (tenant_id,database_transaction)");
    expect(sql.match(/AND a\.database_transaction=pg_current_xact_id\(\)/g)).toHaveLength(2);
    expect(sql).toContain("AND a.resulting_revision=(SELECT revision");
  });
  it("retains strict allowed dataset references while allowing tenant-scoped denial targets", () => {
    expect(sql).toContain("dataset_id uuid NOT NULL");
    expect(sql).toContain("mapped_dataset_id uuid,");
    expect(sql).toContain("FOREIGN KEY (tenant_id,mapped_dataset_id)");
    expect(sql).toContain("CHECK (NOT allowed OR mapped_dataset_id IS NOT NULL)");
    expect(sql).toContain("CHECK (mapped_dataset_id IS NULL OR mapped_dataset_id = dataset_id)");
  });
});
