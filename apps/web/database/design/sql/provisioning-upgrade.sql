-- DRAFT ONLY. Do not execute against any database.
-- Security upgrade for migration 005.
-- Must be integrated and tested before enabling provisioning.

BEGIN;

CREATE OR REPLACE FUNCTION empire_os_authorization.require_state_audit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM empire_os_authorization.audit a
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
  WHERE tenant_id = NEW.tenant_id FOR UPDATE;

  observed := (NEW.evidence #>> '{decision,observedPolicyRevision}')::bigint;

  IF current_revision IS NULL OR observed IS NULL
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


-- Recreate the authority uniqueness index within the migration transaction.
DROP INDEX empire_os_authorization.authority_revision_once;

CREATE UNIQUE INDEX authority_revision_once
ON empire_os_authorization.audit(tenant_id, resulting_revision)
WHERE allowed AND evidence->>'operation' IN
  ('assign-role','delegate','revoke','provision-member');


DO $upgrade$
DECLARE
  constraint_name name;
BEGIN
  SELECT con.conname INTO STRICT constraint_name
  FROM pg_constraint con
  WHERE con.conrelid = 'empire_os_authorization.audit'::regclass
    AND con.contype = 'c'
    AND con.convalidated
    AND pg_get_constraintdef(con.oid) LIKE '%assign-role%'
    AND pg_get_constraintdef(con.oid) LIKE '%delegate%'
    AND pg_get_constraintdef(con.oid) LIKE '%revoke%'
    AND pg_get_constraintdef(con.oid) LIKE '%write%'
    AND pg_get_constraintdef(con.oid) LIKE '%operation%';

  EXECUTE format('ALTER TABLE empire_os_authorization.audit DROP CONSTRAINT %I', constraint_name);
  ALTER TABLE empire_os_authorization.audit
    ADD CONSTRAINT audit_provisioning_operation_check
    CHECK (coalesce(evidence->>'operation' IN
      ('write','assign-role','delegate','revoke','provision-member'), false));
END;
$upgrade$;

-- INCOMPLETE: additional constraint, index and trigger changes required.
-- Do not commit a deployable migration yet.
ROLLBACK;
