import { readFileSync } from "node:fs";
import { parse, parsePlPgSQL } from "libpg-query";
import { describe, expect, it } from "vitest";

const auditUpgrade = readFileSync(
  new URL("../design/sql/provisioning-upgrade.sql", import.meta.url),
  "utf8",
);
const operation = readFileSync(
  new URL("../design/sql/provision-member.sql", import.meta.url),
  "utf8",
);
const migration005 = readFileSync(
  new URL("../migrations/005_trusted_employee_provisioning.sql", import.meta.url),
  "utf8",
);

describe("Employee provisioning SQL candidate (offline)", () => {
  it("parses both complete SQL files and their PL/pgSQL bodies", async () => {
    for (const sql of [auditUpgrade, operation]) {
      await expect(parse(sql)).resolves.toBeDefined();
      await expect(parsePlPgSQL(sql)).resolves.toBeDefined();
    }
  });

  it("keeps migration 005 fail-closed and keeps the candidate outside migrations", () => {
    expect(migration005).toContain("Employee provisioning migration is incomplete and disabled");
    expect(auditUpgrade + operation).toContain("DESIGN CANDIDATE ONLY");
    expect((auditUpgrade + operation).replace(/^\s*--.*$/gm, ""))
      .not.toMatch(/\bGRANT\b/i);
  });

  it("extends every existing authority-audit protection to provisioning", () => {
    expect(auditUpgrade).toContain("audit_provisioning_operation_check");
    expect(auditUpgrade).toContain("'write','assign-role','delegate','revoke','provision-member'");
    expect(auditUpgrade).toContain("CREATE UNIQUE INDEX authority_revision_once");
    expect(auditUpgrade).toContain("CREATE OR REPLACE FUNCTION empire_os_authorization.audit_revision()");
    expect(auditUpgrade).toContain("CREATE OR REPLACE FUNCTION empire_os_authorization.require_state_audit()");
    expect(auditUpgrade).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(auditUpgrade).toContain("pg_current_xact_id()");
  });

  it("binds the actor from the database principal before and after acquiring the tenant lock", () => {
    const firstIdentity = operation.indexOf("actor := empire_os_authorization.runtime_subject(tenant)");
    const lock = operation.indexOf("FOR UPDATE;");
    const secondIdentity = operation.lastIndexOf("actor := empire_os_authorization.runtime_subject(tenant)");
    expect(firstIdentity).toBeGreaterThan(-1);
    expect(firstIdentity).toBeLessThan(lock);
    expect(secondIdentity).toBeGreaterThan(lock);
    expect(operation).not.toMatch(/\bp_actor\b|request->>'actorSubject'/);
    expect(operation).toContain("(snapshot #> '{tenant,ownerSubjects}') ? actor");
  });

  it("checks revisions, tombstones, identity shape, duplicate memberships and each active role", () => {
    expect(operation).toContain("expected_revision <> current_revision");
    expect(operation).toContain("r->>'kind' = 'membership'");
    expect(operation).toContain("r->>'id' = subject");
    expect(operation).toContain("coalesce(request #>> '{command,subject}','') !~ '^user_[A-Za-z0-9_]+$'");
    expect(operation).toContain("existing_role->>'status' = 'active'");
    expect(operation).toContain("HAVING count(*) > 1");
    expect(operation).toContain("Employee identity already exists or was removed");
  });

  it("derives exactly one membership and one revision step inside PostgreSQL", () => {
    expect(operation).toContain("'revision', 1");
    expect(operation).toContain("snapshot->'memberships') || jsonb_build_array(membership)");
    expect(operation).toContain("SET state = next_state, revision = current_revision + 1");
    expect(operation).not.toMatch(/\bp_next\b/);
    expect(operation).toContain("INSERT INTO empire_os_authorization.audit");
    expect(operation).toContain("p_evidence->'decision' IS DISTINCT FROM decision");
    expect(operation).toContain("p_evidence->>'requestSha256' IS DISTINCT FROM request_sha256");
    expect(operation).toContain("Provisioning operation replay");
  });

  it("revokes PUBLIC execution and leaves all runtime grants for a later reviewed activation", () => {
    expect(operation).toContain(
      "REVOKE ALL ON FUNCTION empire_os_authorization.provision_member(text,jsonb) FROM PUBLIC",
    );
    expect(operation.replace(/^\s*--.*$/gm, "")).not.toMatch(/\bGRANT\s+EXECUTE\b/i);
    expect(operation).toContain("SET search_path = pg_catalog");
  });
});
