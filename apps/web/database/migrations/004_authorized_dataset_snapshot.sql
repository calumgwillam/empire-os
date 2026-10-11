-- Version 4; apply exactly once after 001, 002 and 003, as the empire_os_authorization schema
-- owner, on a NEW verified empty disposable instance. Never apply to a populated database.
-- Adds one read-only authorized dataset snapshot API. No tables, grants, runtime roles, policy,
-- trigger or data changes; 001-003 objects and their guarantees are untouched.
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('empire_os_authorization.apply_operation(text,jsonb,jsonb)') IS NULL
    OR to_regprocedure('empire_os_authorization.runtime_subject(text)') IS NULL
    OR to_regprocedure('empire_os_authorization.lookup_operation(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Migration 004 requires migrations 002 and 003' USING ERRCODE='55000';
  END IF;
  IF to_regprocedure('empire_os_authorization.read_dataset_snapshot(text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 004 was already applied' USING ERRCODE='55000';
  END IF;
  -- The definer must be the owner bound into the 002 trusted_api RLS policies.
  IF current_user IS DISTINCT FROM (SELECT r.rolname FROM pg_namespace n
      JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname='empire_os_authorization') THEN
    RAISE EXCEPTION 'Migration 004 must run as the authorization schema owner' USING ERRCODE='42501';
  END IF;
END;
$$;

-- Returns the committed current value of every registered store for one tenant dataset.
-- Waits on the SAME tenant row lock as lock_authority/apply_operation/lookup_operation, so the
-- values, fence and authority are one consistent committed state with no in-flight writer.
-- The actor is derived from the restricted database role; callers cannot choose it.
-- Read capability is evaluated here independently, with the same owner/direct/delegated rules
-- apply_operation uses; values, fence counters and the commit sequence are returned ONLY when
-- allowed. Never returns audit evidence or applied requests. Performs no writes; the caller
-- must ROLLBACK, except when called inside an apply_operation transaction that already holds
-- the tenant lock (the write adapter's locked full-candidate validation).
CREATE FUNCTION empire_os_authorization.read_dataset_snapshot(p_tenant text,p_dataset uuid)
RETURNS TABLE(state jsonb,revision bigint,actor_subject text,decision jsonb,checked_at bigint,
  generation bigint,authority_revision bigint,commit_sequence bigint,store_values jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor text; locked_state jsonb; locked_revision bigint; snapshot jsonb; member jsonb;
  fence empire_os_authorization.datasets%ROWTYPE; mapped boolean := false;
  allowed boolean := false; reason text; evidence_id text; now_ms bigint; read_decision jsonb;
BEGIN
  IF p_dataset IS NULL THEN
    RAISE EXCEPTION 'Invalid dataset identifier' USING ERRCODE='22023';
  END IF;
  actor := empire_os_authorization.runtime_subject(p_tenant);
  SELECT t.state,t.revision INTO STRICT locked_state,locked_revision
    FROM empire_os_authorization.tenants t WHERE t.tenant_id=p_tenant FOR UPDATE;
  -- Re-derive after waiting: the binding and identity safety are rechecked on a fresh snapshot.
  actor := empire_os_authorization.runtime_subject(p_tenant);
  -- Sample time AFTER waiting for the tenant lock.
  now_ms := floor(extract(epoch FROM clock_timestamp())*1000);
  snapshot := locked_state->'snapshot';
  IF EXISTS (SELECT 1 FROM
      (SELECT d->>'datasetId' AS dataset_id FROM jsonb_array_elements(snapshot->'datasets') d) policy
      FULL JOIN (SELECT d.dataset_id::text AS dataset_id FROM empire_os_authorization.datasets d
        WHERE d.tenant_id=p_tenant) mapping USING (dataset_id)
      WHERE policy.dataset_id IS NULL OR mapping.dataset_id IS NULL) THEN
    RAISE EXCEPTION 'Authority dataset mapping is inconsistent' USING ERRCODE='23514';
  END IF;
  SELECT * INTO fence FROM empire_os_authorization.datasets d WHERE d.tenant_id=p_tenant AND d.dataset_id=p_dataset;
  mapped := FOUND;
  SELECT m INTO member FROM jsonb_array_elements(snapshot->'memberships') m WHERE m->>'subject'=actor;
  IF snapshot #>> '{tenant,status}' IS DISTINCT FROM 'active' THEN reason := 'tenant-revoked';
  ELSIF NOT mapped THEN reason := 'dataset-not-authorized';
  ELSIF member IS NULL THEN reason := 'membership-required';
  ELSIF member->>'status' IS DISTINCT FROM 'active' THEN reason := 'membership-revoked';
  ELSIF (snapshot #> '{tenant,ownerSubjects}') ? actor THEN
    allowed := true; reason := 'owner-authority';
  ELSE
    SELECT g->>'id' INTO evidence_id FROM jsonb_array_elements(snapshot->'roles') r,
      LATERAL jsonb_array_elements(r->'grants') g
      WHERE r->>'status'='active' AND (member->'roleIds') ? (r->>'id')
        AND g->>'datasetId'=p_dataset::text AND g->>'capability'='read'
      ORDER BY (g->>'id') COLLATE "C" LIMIT 1;
    IF evidence_id IS NOT NULL THEN allowed := true; reason := 'direct-grant';
    ELSE
      SELECT d->>'id' INTO evidence_id FROM jsonb_array_elements(snapshot->'delegations') d,
        LATERAL jsonb_array_elements(snapshot->'memberships') issuer,
        LATERAL jsonb_array_elements(snapshot->'roles') r,
        LATERAL jsonb_array_elements(r->'grants') g
        WHERE d->>'status'='active' AND d->>'recipientSubject'=actor AND d->>'datasetId'=p_dataset::text
          AND d->>'capability'='read'
          AND (d->>'issuedAt')::numeric <= now_ms AND (d->>'expiresAt')::numeric > now_ms
          AND d->'recipientMembershipRevision'=member->'revision'
          AND issuer->>'subject'=d->>'issuerSubject' AND issuer->>'status'='active'
          AND issuer->'revision'=d->'issuerMembershipRevision'
          AND r->>'id'=d->>'sourceRoleId' AND r->>'status'='active'
          AND r->'revision'=d->'sourceRoleRevision' AND (issuer->'roleIds') ? (r->>'id')
          AND g->>'id'=d->>'sourceGrantId' AND g->>'datasetId'=p_dataset::text
          AND g->>'capability'=d->>'capability' AND g->>'delegable'='true'
        ORDER BY (d->>'id') COLLATE "C" LIMIT 1;
      IF evidence_id IS NULL THEN reason := 'capability-not-granted';
      ELSE allowed := true; reason := 'delegated-grant'; END IF;
    END IF;
  END IF;
  read_decision := jsonb_build_object('status',CASE WHEN allowed THEN 'allowed' ELSE 'denied' END,
    'reason',reason,'policyVersion',1,'observedPolicyRevision',locked_revision);
  IF evidence_id IS NOT NULL THEN read_decision := read_decision || jsonb_build_object('evidenceId',evidence_id); END IF;
  RETURN QUERY SELECT locked_state,locked_revision,actor,read_decision,now_ms,
    CASE WHEN allowed THEN fence.generation END,
    CASE WHEN allowed THEN fence.authority_revision END,
    CASE WHEN allowed THEN (SELECT count(DISTINCT w.transaction_id) FROM empire_os_authorization.preparation_writes w
      WHERE w.tenant_id=p_tenant AND w.dataset_id=p_dataset) END,
    CASE WHEN allowed THEN (SELECT jsonb_agg(jsonb_build_object('key',s.store_key,
        'revision',coalesce(l.latest_revision,0),'rawValueHex',encode(l.latest_value,'hex'))
        ORDER BY s.registry_position)
      FROM empire_os_preparation.store_registry s
      LEFT JOIN LATERAL (SELECT w.revision AS latest_revision,w.raw_value AS latest_value
        FROM empire_os_authorization.preparation_writes w
        WHERE w.tenant_id=p_tenant AND w.dataset_id=p_dataset AND w.store_key=s.store_key
        ORDER BY w.revision DESC LIMIT 1) l ON true)
    ELSE '[]'::jsonb END;
END;
$$;
REVOKE ALL ON FUNCTION empire_os_authorization.read_dataset_snapshot(text,uuid) FROM PUBLIC;
COMMIT;
