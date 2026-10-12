-- DESIGN CANDIDATE ONLY. Never apply to production or a populated database.
-- Candidate audit-contract upgrade paired with provision-member.sql.
-- Migration 005 remains fail-closed until this complete candidate is reviewed and tested.
BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('empire_os_authorization.apply_operation(text,jsonb,jsonb)') IS NULL
    OR to_regprocedure('empire_os_authorization.runtime_subject(text)') IS NULL
    OR to_regprocedure('empire_os_authorization.read_dataset_snapshot(text,uuid)') IS NULL
    OR to_regprocedure('empire_os_authorization.require_state_audit()') IS NULL
    OR to_regprocedure('empire_os_authorization.audit_revision()') IS NULL THEN
    RAISE EXCEPTION 'Provisioning candidate requires migrations 001-004'
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('empire_os_authorization.provision_member(text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Provisioning candidate was already installed'
      USING ERRCODE = '55000';
  END IF;
  IF current_user IS DISTINCT FROM (
    SELECT r.rolname FROM pg_namespace n
    JOIN pg_roles r ON r.oid = n.nspowner
    WHERE n.nspname = 'empire_os_authorization'
  ) THEN
    RAISE EXCEPTION 'Provisioning candidate requires the authorization schema owner'
      USING ERRCODE = '42501';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION empire_os_authorization.require_state_audit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM empire_os_authorization.audit a
    WHERE a.tenant_id = NEW.tenant_id
      AND a.resulting_revision = NEW.revision
      AND a.allowed
      AND a.database_transaction = pg_current_xact_id()
      AND a.evidence->>'operation' IN
        ('assign-role','delegate','revoke','provision-member')
  ) THEN
    RAISE EXCEPTION 'Authority transition requires atomic audit'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION empire_os_authorization.audit_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog AS $$
DECLARE
  current_revision bigint;
  observed bigint;
BEGIN
  SELECT revision INTO current_revision
  FROM empire_os_authorization.tenants
  WHERE tenant_id = NEW.tenant_id
  FOR UPDATE;

  observed := (NEW.evidence #>> '{decision,observedPolicyRevision}')::bigint;

  IF current_revision IS NULL
    OR observed IS NULL
    OR NEW.resulting_revision <> current_revision
    OR observed <> current_revision - (
      CASE WHEN NEW.allowed AND NEW.evidence->>'operation' IN
        ('assign-role','delegate','revoke','provision-member')
      THEN 1 ELSE 0 END
    ) THEN
    RAISE EXCEPTION 'Stale authorization audit revision'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER authority_audit ON empire_os_authorization.tenants;
CREATE CONSTRAINT TRIGGER authority_audit
AFTER UPDATE ON empire_os_authorization.tenants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION empire_os_authorization.require_state_audit();

DROP INDEX empire_os_authorization.authority_revision_once;
CREATE UNIQUE INDEX authority_revision_once
ON empire_os_authorization.audit (tenant_id, resulting_revision)
WHERE allowed
  AND evidence->>'operation' IN
    ('assign-role','delegate','revoke','provision-member');

DO $constraint$
DECLARE
  operation_constraint name;
BEGIN
  SELECT con.conname INTO STRICT operation_constraint
  FROM pg_constraint con
  WHERE con.conrelid = 'empire_os_authorization.audit'::regclass
    AND con.contype = 'c'
    AND con.convalidated
    AND pg_get_constraintdef(con.oid) LIKE '%operation%'
    AND pg_get_constraintdef(con.oid) LIKE '%write%'
    AND pg_get_constraintdef(con.oid) LIKE '%assign-role%'
    AND pg_get_constraintdef(con.oid) LIKE '%delegate%'
    AND pg_get_constraintdef(con.oid) LIKE '%revoke%';

  EXECUTE format(
    'ALTER TABLE empire_os_authorization.audit DROP CONSTRAINT %I',
    operation_constraint
  );

  ALTER TABLE empire_os_authorization.audit
    ADD CONSTRAINT audit_provisioning_operation_check
    CHECK (coalesce(
      evidence->>'operation' IN
        ('write','assign-role','delegate','revoke','provision-member'),
      false
    ));
END;
$constraint$;

REVOKE ALL ON FUNCTION empire_os_authorization.require_state_audit() FROM PUBLIC;
REVOKE ALL ON FUNCTION empire_os_authorization.audit_revision() FROM PUBLIC;

COMMIT;
