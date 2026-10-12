-- DESIGN CANDIDATE ONLY. Never apply to production or a populated database.
-- Apply after provisioning-upgrade.sql on a newly verified empty disposable database.
-- No PUBLIC/runtime grants are issued here; execution remains disabled pending review.
BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('empire_os_authorization.runtime_subject(text)') IS NULL
    OR to_regprocedure('empire_os_authorization.valid_counter(jsonb)') IS NULL
    OR to_regprocedure('empire_os_authorization.valid_identifier(jsonb)') IS NULL
    OR to_regprocedure('empire_os_authorization.audit_revision()') IS NULL THEN
    RAISE EXCEPTION 'Provisioning operation requires the complete audit candidate'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    WHERE con.conrelid = 'empire_os_authorization.audit'::regclass
      AND con.contype = 'c'
      AND con.convalidated
      AND pg_get_constraintdef(con.oid) LIKE '%provision-member%'
  ) OR pg_get_functiondef(
    'empire_os_authorization.audit_revision()'::regprocedure
  ) NOT LIKE '%provision-member%'
    OR pg_get_functiondef(
      'empire_os_authorization.require_state_audit()'::regprocedure
    ) NOT LIKE '%provision-member%' THEN
    RAISE EXCEPTION 'Provisioning audit protections must be upgraded first'
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('empire_os_authorization.provision_member(text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Provisioning operation was already installed'
      USING ERRCODE = '55000';
  END IF;
  IF current_user IS DISTINCT FROM (
    SELECT r.rolname FROM pg_namespace n
    JOIN pg_roles r ON r.oid = n.nspowner
    WHERE n.nspname = 'empire_os_authorization'
  ) THEN
    RAISE EXCEPTION 'Provisioning operation requires the authorization schema owner'
      USING ERRCODE = '42501';
  END IF;
END;
$guard$;

-- This is the sole provisioning write path. It derives both authorization and the exact
-- next state after taking the same tenant lock used by existing authorization operations.
CREATE FUNCTION empire_os_authorization.provision_member(
  p_request_text text,
  p_evidence jsonb
)
RETURNS TABLE(state jsonb, revision bigint, actor_subject text, audit_evidence jsonb)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
DECLARE
  tenant text;
  actor text;
  request jsonb;
  command jsonb;
  old_state jsonb;
  snapshot jsonb;
  next_state jsonb;
  current_revision bigint;
  expected_revision bigint;
  subject text;
  dataset uuid;
  transaction_uuid uuid;
  operation_id text;
  decision_id text;
  request_sha256 text;
  now_ms bigint;
  checked_ms numeric;
  completed_ms numeric;
  decision jsonb;
  affected integer;
  membership jsonb;
BEGIN
  IF p_request_text IS NULL OR jsonb_typeof(p_request_text::jsonb) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid provisioning request' USING ERRCODE = '22023';
  END IF;
  request := p_request_text::jsonb;
  tenant := request->>'tenantId';
  IF tenant IS NULL
    OR length(tenant) NOT BETWEEN 1 AND 512
    OR btrim(tenant) <> tenant
    OR tenant ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid tenant identifier' USING ERRCODE = '22023';
  END IF;

  -- Identity comes only from the database-bound principal. Re-resolve after waiting for
  -- the tenant lock, matching lock_authority/apply_operation's READ COMMITTED discipline.
  actor := empire_os_authorization.runtime_subject(tenant);
  SELECT t.state, t.revision
    INTO STRICT old_state, current_revision
    FROM empire_os_authorization.tenants t
    WHERE t.tenant_id = tenant
    FOR UPDATE;
  actor := empire_os_authorization.runtime_subject(tenant);
  snapshot := old_state->'snapshot';

  IF jsonb_typeof(snapshot) IS DISTINCT FROM 'object'
    OR snapshot #>> '{tenant,id}' IS DISTINCT FROM tenant
    OR jsonb_typeof(snapshot->'memberships') IS DISTINCT FROM 'array'
    OR jsonb_typeof(snapshot->'roles') IS DISTINCT FROM 'array'
    OR jsonb_typeof(snapshot->'delegations') IS DISTINCT FROM 'array'
    OR jsonb_typeof(snapshot->'datasets') IS DISTINCT FROM 'array'
    OR jsonb_typeof(snapshot #> '{tenant,ownerSubjects}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(old_state->'revocations') IS DISTINCT FROM 'array'
    OR (snapshot->>'revision')::bigint IS DISTINCT FROM current_revision THEN
    RAISE EXCEPTION 'Invalid tenant authority state' USING ERRCODE = '23514';
  END IF;

  IF snapshot #>> '{tenant,status}' IS DISTINCT FROM 'active'
    OR NOT coalesce((snapshot #> '{tenant,ownerSubjects}') ? actor, false)
    OR NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(snapshot->'memberships') m
      WHERE m->>'subject' = actor
        AND m->>'tenantId' = tenant
        AND m->>'status' = 'active'
    ) THEN
    RAISE EXCEPTION 'Founder authority required' USING ERRCODE = '42501';
  END IF;

  IF request - ARRAY['operationId','tenantId','expectedPolicyRevision','command'] <> '{}'::jsonb
    OR jsonb_typeof(request->'command') IS DISTINCT FROM 'object'
    OR (request->'command') - ARRAY['kind','subject','roleIds'] <> '{}'::jsonb
    OR request #>> '{command,kind}' IS DISTINCT FROM 'provision-member'
    OR NOT empire_os_authorization.valid_counter(request->'expectedPolicyRevision')
    OR NOT empire_os_authorization.valid_identifier(request->'operationId')
    OR coalesce(request->>'operationId','') !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$'
    OR NOT empire_os_authorization.valid_identifier(request #> '{command,subject}')
    OR coalesce(request #>> '{command,subject}','') !~ '^user_[A-Za-z0-9_]+$'
    OR length(request #>> '{command,subject}') > 512
    OR jsonb_typeof(request #> '{command,roleIds}') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid provisioning request' USING ERRCODE = '23514';
  END IF;

  command := request->'command';
  operation_id := request->>'operationId';
  subject := command->>'subject';
  expected_revision := (request->>'expectedPolicyRevision')::bigint;

  -- Operation IDs are single-use even after denied attempts. This also prevents an old
  -- successful request from being presented as a retry with altered contents.
  IF EXISTS (
    SELECT 1 FROM empire_os_authorization.audit a
    WHERE a.tenant_id = tenant
      AND a.actor_subject = actor
      AND a.operation_id = operation_id
  ) THEN
    RAISE EXCEPTION 'Provisioning operation replay' USING ERRCODE = '23505';
  END IF;

  IF expected_revision <> current_revision THEN
    RAISE EXCEPTION 'Stale authority revision' USING ERRCODE = '40001';
  END IF;
  IF current_revision >= 9007199254740991 THEN
    RAISE EXCEPTION 'Authority revision exhausted' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(snapshot->'memberships') m
    WHERE m->>'subject' = subject
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(old_state->'revocations') r
    WHERE r->>'kind' = 'membership'
      AND r->>'id' = subject
  ) THEN
    RAISE EXCEPTION 'Employee identity already exists or was removed'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(command->'roleIds') r
    WHERE jsonb_typeof(r) IS DISTINCT FROM 'string'
       OR NOT empire_os_authorization.valid_identifier(r)
       OR NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(snapshot->'roles') existing_role
         WHERE existing_role->>'id' = r #>> '{}'
           AND existing_role->>'tenantId' = tenant
           AND existing_role->>'status' = 'active'
       )
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(command->'roleIds') r
    GROUP BY r
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Every assigned role must be a distinct active tenant role'
      USING ERRCODE = '23514';
  END IF;

  -- Audit rows require a mapped dataset. Use an existing tenant mapping as the audit
  -- anchor; provisioning does not change or grant access to that dataset.
  IF EXISTS (
    SELECT 1
    FROM (SELECT d->>'datasetId' AS dataset_id
          FROM jsonb_array_elements(snapshot->'datasets') d) policy
    FULL JOIN (SELECT d.dataset_id::text AS dataset_id
               FROM empire_os_authorization.datasets d
               WHERE d.tenant_id = tenant) mapping USING (dataset_id)
    WHERE policy.dataset_id IS NULL OR mapping.dataset_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Authority dataset mapping is inconsistent'
      USING ERRCODE = '23514';
  END IF;
  SELECT d.dataset_id INTO dataset
  FROM empire_os_authorization.datasets d
  WHERE d.tenant_id = tenant
  ORDER BY d.dataset_id
  LIMIT 1;
  IF dataset IS NULL THEN
    RAISE EXCEPTION 'Provisioning audit requires an existing tenant dataset'
      USING ERRCODE = '23514';
  END IF;

  now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000);
  decision := jsonb_build_object(
    'status', 'allowed',
    'reason', 'owner-authority',
    'policyVersion', 1,
    'observedPolicyRevision', current_revision
  );
  request_sha256 := encode(sha256(convert_to(p_request_text, 'UTF8')), 'hex');

  IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'object'
    OR p_evidence - ARRAY['version','operationId','decisionId','transactionId','requestSha256',
      'actorSubject','tenantId','datasetId','operation','authorityChange','decision',
      'checkedAt','completedAt','resultingPolicyRevision'] <> '{}'::jsonb
    OR NOT (p_evidence ?& ARRAY['version','operationId','decisionId','transactionId',
      'requestSha256','actorSubject','tenantId','datasetId','operation','authorityChange',
      'decision','checkedAt','completedAt','resultingPolicyRevision'])
    OR p_evidence->'version' IS DISTINCT FROM '1'::jsonb
    OR NOT empire_os_authorization.valid_counter(p_evidence->'checkedAt')
    OR NOT empire_os_authorization.valid_counter(p_evidence->'completedAt')
    OR NOT empire_os_authorization.valid_counter(p_evidence->'resultingPolicyRevision')
    OR coalesce(p_evidence->>'transactionId','') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR coalesce(p_evidence->>'decisionId','') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid provisioning audit envelope' USING ERRCODE = '23514';
  END IF;

  transaction_uuid := (p_evidence->>'transactionId')::uuid;
  decision_id := p_evidence->>'decisionId';
  checked_ms := (p_evidence->>'checkedAt')::numeric;
  completed_ms := (p_evidence->>'completedAt')::numeric;

  IF p_evidence->>'transactionId' IS DISTINCT FROM transaction_uuid::text
    OR p_evidence->>'operationId' IS DISTINCT FROM operation_id
    OR p_evidence->>'actorSubject' IS DISTINCT FROM actor
    OR p_evidence->>'tenantId' IS DISTINCT FROM tenant
    OR p_evidence->>'datasetId' IS DISTINCT FROM dataset::text
    OR p_evidence->>'operation' IS DISTINCT FROM 'provision-member'
    OR p_evidence->'authorityChange' IS DISTINCT FROM command
    OR p_evidence->'decision' IS DISTINCT FROM decision
    OR p_evidence->>'requestSha256' IS DISTINCT FROM request_sha256
    OR decision_id IS DISTINCT FROM encode(sha256(convert_to(
      '["' || transaction_uuid::text || '","' || operation_id || '","decision",1]',
      'UTF8'
    )), 'hex')
    OR checked_ms < floor(extract(epoch FROM transaction_timestamp()) * 1000)
    OR checked_ms > now_ms
    OR completed_ms < checked_ms
    OR completed_ms > now_ms
    OR (p_evidence->>'resultingPolicyRevision')::bigint <> current_revision + 1 THEN
    RAISE EXCEPTION 'Unverified provisioning request or audit evidence'
      USING ERRCODE = '42501';
  END IF;

  membership := jsonb_build_object(
    'subject', subject,
    'tenantId', tenant,
    'revision', 1,
    'status', 'active',
    'roleIds', command->'roleIds'
  );
  next_state := jsonb_set(
    jsonb_set(
      old_state,
      '{snapshot,revision}',
      to_jsonb(current_revision + 1),
      false
    ),
    '{snapshot,memberships}',
    (snapshot->'memberships') || jsonb_build_array(membership),
    false
  );

  UPDATE empire_os_authorization.tenants t
  SET state = next_state, revision = current_revision + 1
  WHERE t.tenant_id = tenant
    AND t.revision = current_revision;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Tenant authority changed during provisioning'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO empire_os_authorization.audit (
    tenant_id, dataset_id, mapped_dataset_id, transaction_id, operation_id,
    decision_id, actor_subject, allowed, resulting_revision, evidence,
    applied_request, applied_request_sha256
  ) VALUES (
    tenant, dataset, dataset, transaction_uuid, operation_id,
    decision_id, actor, true, current_revision + 1, p_evidence,
    p_request_text, request_sha256
  );

  RETURN QUERY SELECT next_state, current_revision + 1, actor, p_evidence;
END;
$$;

REVOKE ALL ON FUNCTION empire_os_authorization.provision_member(text,jsonb) FROM PUBLIC;

COMMIT;
