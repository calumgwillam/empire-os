-- Version 3; apply exactly once after 001 and 002, as the empire_os_authorization schema
-- owner, on a NEW verified empty disposable instance. Never apply to a populated database.
-- Adds one read-only reconciliation API. No tables, grants, runtime roles, policy, trigger
-- or data changes; 001/002 objects and their guarantees are untouched.
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('empire_os_authorization.apply_operation(text,jsonb,jsonb)') IS NULL
    OR to_regprocedure('empire_os_authorization.runtime_subject(text)') IS NULL THEN
    RAISE EXCEPTION 'Migration 003 requires migration 002' USING ERRCODE='55000';
  END IF;
  IF to_regprocedure('empire_os_authorization.lookup_operation(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 003 was already applied' USING ERRCODE='55000';
  END IF;
  -- The definer must be the owner bound into the 002 trusted_api RLS policies.
  IF current_user IS DISTINCT FROM (SELECT r.rolname FROM pg_namespace n
      JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname='empire_os_authorization') THEN
    RAISE EXCEPTION 'Migration 003 must run as the authorization schema owner' USING ERRCODE='42501';
  END IF;
END;
$$;

-- Reconciles an operation whose outcome was unknown (e.g. lost COMMIT acknowledgement) or whose
-- retry failed. Waits on the SAME tenant row lock as lock_authority/apply_operation, so any
-- in-flight transaction for the tenant has committed or rolled back before audits are read.
-- The actor is derived from the restricted database role; callers cannot choose it.
-- Returns only this actor's audit metadata for this operation, and only while the tenant and
-- the actor's membership are active. Never returns applied_request or raw business values.
-- Performs no writes; the caller must ROLLBACK.
CREATE FUNCTION empire_os_authorization.lookup_operation(p_tenant text,p_operation_id text)
RETURNS TABLE(state jsonb,revision bigint,actor_subject text,authorized boolean,records jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor text; locked_state jsonb; locked_revision bigint; permitted boolean;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$' THEN
    RAISE EXCEPTION 'Invalid operation identifier' USING ERRCODE='22023';
  END IF;
  actor := empire_os_authorization.runtime_subject(p_tenant);
  SELECT t.state,t.revision INTO STRICT locked_state,locked_revision
    FROM empire_os_authorization.tenants t WHERE t.tenant_id=p_tenant FOR UPDATE;
  -- Re-derive after waiting: the binding and identity safety are rechecked on a fresh snapshot.
  actor := empire_os_authorization.runtime_subject(p_tenant);
  permitted := coalesce(locked_state #>> '{snapshot,tenant,status}' = 'active', false)
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(locked_state #> '{snapshot,memberships}') m
      WHERE m->>'subject'=actor AND m->>'status'='active');
  RETURN QUERY SELECT locked_state,locked_revision,actor,permitted,
    CASE WHEN permitted THEN coalesce((SELECT jsonb_agg(jsonb_build_object(
        'transactionId',a.transaction_id::text,'decisionId',a.decision_id,
        'requestSha256',a.applied_request_sha256,'allowed',a.allowed,
        'resultingPolicyRevision',a.resulting_revision,'evidence',a.evidence) ORDER BY a.decision_id)
      FROM empire_os_authorization.audit a
      WHERE a.tenant_id=p_tenant AND a.actor_subject=actor AND a.operation_id=p_operation_id),'[]'::jsonb)
    ELSE '[]'::jsonb END;
END;
$$;
REVOKE ALL ON FUNCTION empire_os_authorization.lookup_operation(text,text) FROM PUBLIC;
COMMIT;
