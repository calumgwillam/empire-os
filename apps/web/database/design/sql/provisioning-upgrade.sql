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

CREATE OR REPLACE FUNCTION empire_os_authorization.trusted_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog AS $$
BEGIN
  IF current_user IS DISTINCT FROM (
    SELECT r.rolname FROM pg_namespace n
    JOIN pg_roles r ON r.oid = n.nspowner
    WHERE n.nspname = 'empire_os_authorization'
  ) THEN
    RAISE EXCEPTION 'Use the authenticated authorization API' USING ERRCODE = '42501';
  END IF;
  IF TG_LEVEL = 'STATEMENT' THEN
    RETURN NULL;
  END IF;
  -- Returning NEW (null for DELETE) would skip the row and every later BEFORE trigger.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION empire_os_authorization.require_state_audit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
DECLARE
  provisioning_audit jsonb;
  command jsonb;
  expected_state jsonb;
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
  SELECT a.evidence INTO provisioning_audit
  FROM empire_os_authorization.audit a
  WHERE a.tenant_id = NEW.tenant_id AND a.resulting_revision = NEW.revision
    AND a.allowed AND a.database_transaction = pg_current_xact_id()
    AND a.evidence->>'operation' = 'provision-member';
  IF FOUND THEN
    command := provisioning_audit->'authorityChange';
    expected_state := jsonb_set(
      jsonb_set(OLD.state, '{snapshot,revision}', to_jsonb(OLD.revision + 1), false),
      '{snapshot,memberships}',
      (OLD.state #> '{snapshot,memberships}') || jsonb_build_array(jsonb_build_object(
        'subject', command->>'subject', 'tenantId', NEW.tenant_id,
        'revision', 1, 'status', 'active', 'roleIds', command->'roleIds'
      )), false
    );
    IF NEW.state IS DISTINCT FROM expected_state
      OR NEW.revision IS DISTINCT FROM OLD.revision + 1 THEN
      RAISE EXCEPTION 'Provisioning audit does not match the exact authority transition'
        USING ERRCODE = '23514';
    END IF;
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

-- Defense in depth for audit rows, independent of the provisioning API's envelope
-- checks. The existing append-only, transaction, dataset and revision constraints stay.
ALTER TABLE empire_os_authorization.audit
ADD CONSTRAINT audit_provisioning_evidence_check CHECK (coalesce(
  evidence->>'operation' <> 'provision-member' OR (
    allowed
    AND evidence->'version' = '1'::jsonb
    AND evidence - ARRAY['version','operationId','decisionId','transactionId','requestSha256',
      'actorSubject','tenantId','datasetId','operation','authorityChange','decision',
      'checkedAt','completedAt','resultingPolicyRevision'] = '{}'::jsonb
    AND (applied_request::jsonb) - ARRAY[
      'operationId','tenantId','expectedPolicyRevision','command'] = '{}'::jsonb
    AND (applied_request::jsonb)->'tenantId' = to_jsonb(tenant_id)
    AND (applied_request::jsonb)->'operationId' = to_jsonb(operation_id)
    AND empire_os_authorization.valid_counter(
      (applied_request::jsonb)->'expectedPolicyRevision')
    AND ((applied_request::jsonb)->>'expectedPolicyRevision')::bigint = resulting_revision - 1
    AND evidence->'authorityChange' = (applied_request::jsonb)->'command'
    AND jsonb_typeof(evidence->'authorityChange') = 'object'
    AND (evidence->'authorityChange') - ARRAY['kind','subject','roleIds'] = '{}'::jsonb
    AND evidence #>> '{authorityChange,kind}' = 'provision-member'
    AND empire_os_authorization.valid_identifier(evidence #> '{authorityChange,subject}')
    AND evidence #>> '{authorityChange,subject}' ~ '^user_[A-Za-z0-9_]+$'
    AND jsonb_typeof(evidence #> '{authorityChange,roleIds}') = 'array'
    AND evidence->'decision' = jsonb_build_object(
      'status','allowed','reason','owner-authority','policyVersion',1,
      'observedPolicyRevision',resulting_revision - 1)
    AND empire_os_authorization.valid_counter(evidence->'checkedAt')
    AND empire_os_authorization.valid_counter(evidence->'completedAt')
    AND empire_os_authorization.valid_counter(evidence->'resultingPolicyRevision')
    AND decision_id = encode(sha256(convert_to(
      '["' || transaction_id::text || '","' || operation_id || '","decision",1]',
      'UTF8')), 'hex')
  ), false
));

REVOKE ALL ON FUNCTION empire_os_authorization.require_state_audit() FROM PUBLIC;
REVOKE ALL ON FUNCTION empire_os_authorization.audit_revision() FROM PUBLIC;
REVOKE ALL ON FUNCTION empire_os_authorization.trusted_mutation() FROM PUBLIC;

COMMIT;
