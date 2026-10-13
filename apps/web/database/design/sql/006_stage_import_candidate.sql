-- INACTIVE CANDIDATE ONLY — never run from application startup or production deployment.
-- Requires migrations 001–004 on a NEW disposable database. Review this SQL and its real
-- PostgreSQL integration tests before any separate approval to apply it.
-- Adds import staging through the existing immutable authorization audit and preparation_writes.
BEGIN;

DO $$
DECLARE
  operation_constraints text[];
BEGIN
  IF to_regprocedure('empire_os_authorization.read_dataset_snapshot(text,uuid)') IS NULL
    OR to_regprocedure('empire_os_authorization.lookup_operation(text,text)') IS NULL
    OR to_regprocedure('empire_os_authorization.runtime_subject(text)') IS NULL THEN
    RAISE EXCEPTION 'Import candidate requires migrations 001–004' USING ERRCODE='55000';
  END IF;
  IF to_regprocedure('empire_os_authorization.stage_import(text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Import candidate was already applied' USING ERRCODE='55000';
  END IF;
  IF current_user IS DISTINCT FROM (SELECT r.rolname FROM pg_namespace n
      JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname='empire_os_authorization') THEN
    RAISE EXCEPTION 'Import candidate must run as the authorization schema owner' USING ERRCODE='42501';
  END IF;

  -- Replace exactly the existing operation allow-list; fail closed on schema drift.
  SELECT array_agg(c.conname) INTO operation_constraints
    FROM pg_constraint c
    WHERE c.conrelid='empire_os_authorization.audit'::regclass AND c.contype='c'
      AND position('evidence' in lower(pg_get_constraintdef(c.oid))) > 0
      AND position('operation' in lower(pg_get_constraintdef(c.oid))) > 0
      AND position('write' in lower(pg_get_constraintdef(c.oid))) > 0
      AND position('assign-role' in lower(pg_get_constraintdef(c.oid))) > 0
      AND position('delegate' in lower(pg_get_constraintdef(c.oid))) > 0
      AND position('revoke' in lower(pg_get_constraintdef(c.oid))) > 0;
  IF coalesce(array_length(operation_constraints,1),0) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one existing audit operation constraint' USING ERRCODE='55000';
  END IF;
  EXECUTE format('ALTER TABLE empire_os_authorization.audit DROP CONSTRAINT %I', operation_constraints[1]);
  ALTER TABLE empire_os_authorization.audit ADD CONSTRAINT audit_supported_operation
    CHECK (coalesce(evidence->>'operation' IN ('write','stage-import','assign-role','delegate','revoke'),false));
END;
$$;

CREATE OR REPLACE FUNCTION empire_os_authorization.check_write_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM empire_os_authorization.audit a WHERE a.tenant_id=NEW.tenant_id
    AND a.transaction_id=NEW.transaction_id AND a.dataset_id=NEW.dataset_id AND a.allowed
    AND a.database_transaction=pg_current_xact_id()
    AND a.resulting_revision=(SELECT revision FROM empire_os_authorization.tenants WHERE tenant_id=NEW.tenant_id)
    AND a.evidence->>'operation' IN ('write','stage-import')) THEN
    RAISE EXCEPTION 'Preparation write requires allowed atomic audit' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;

-- Runtime roles receive EXECUTE only through a separately reviewed, explicit GRANT.
-- This function atomically records one import audit and all 21 exact UTF-16LE store values.
-- A successful_operation_once conflict, occupied dataset or any failed check aborts the caller's
-- transaction; there is no overwrite, partial result, data cleanup or internal COMMIT.
CREATE FUNCTION empire_os_authorization.stage_import(p_request_text text,p_evidence jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  p_request jsonb;
  command jsonb; payload jsonb; plan jsonb; fence_request jsonb; entries jsonb;
  tenant text; actor text; old_state jsonb; snapshot jsonb; current_revision bigint;
  dataset uuid; member jsonb; mapped boolean := false; allowed boolean := false;
  reason text; evidence_id text; delegated jsonb; read_decision jsonb; now_ms numeric; checked_ms numeric;
  expected_decision jsonb; request_sha text; transaction_uuid uuid;
  item jsonb; item_count integer; key_count integer;
  registered_key text; key_bytes bytea; raw_bytes bytea;
  source_content bytea := convert_to('empire-os-import-source-v2','UTF8') || decode('00','hex');
BEGIN
  IF p_request_text IS NULL THEN
    RAISE EXCEPTION 'Invalid import request' USING ERRCODE='22023';
  END IF;
  p_request := p_request_text::jsonb;
  tenant := p_request->>'tenantId';
  actor := empire_os_authorization.runtime_subject(tenant);
  SELECT t.state,t.revision INTO STRICT old_state,current_revision
    FROM empire_os_authorization.tenants t WHERE t.tenant_id=tenant FOR UPDATE;
  actor := empire_os_authorization.runtime_subject(tenant);
  now_ms := floor(extract(epoch FROM clock_timestamp())*1000);
  snapshot := old_state->'snapshot';
  command := p_request->'command';
  payload := command->'request';
  fence_request := payload->'fence';
  plan := payload->'plan';
  entries := plan->'entries';

  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object'
    OR p_request - ARRAY['tenantId','operationId','expectedPolicyRevision','command'] <> '{}'::jsonb
    OR jsonb_typeof(command) IS DISTINCT FROM 'object'
    OR command - ARRAY['kind','request'] <> '{}'::jsonb
    OR command->>'kind' IS DISTINCT FROM 'stage-import'
    OR jsonb_typeof(payload) IS DISTINCT FROM 'object'
    OR payload - ARRAY['fence','idempotencyKey','plan'] <> '{}'::jsonb
    OR jsonb_typeof(fence_request) IS DISTINCT FROM 'object'
    OR fence_request - ARRAY['datasetId','protocolVersion','generation','authorityRevision'] <> '{}'::jsonb
    OR fence_request->>'datasetId' IS NULL
    OR fence_request->>'datasetId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR fence_request->>'protocolVersion' IS DISTINCT FROM '1'
    OR NOT empire_os_authorization.valid_counter(fence_request->'generation')
    OR NOT empire_os_authorization.valid_counter(fence_request->'authorityRevision')
    OR payload->>'idempotencyKey' IS DISTINCT FROM p_request->>'operationId'
    OR p_request->>'operationId' !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$'
    OR NOT empire_os_authorization.valid_counter(p_request->'expectedPolicyRevision')
    OR (p_request->>'expectedPolicyRevision')::bigint <> current_revision
    OR jsonb_typeof(plan) IS DISTINCT FROM 'object'
    OR plan - ARRAY['version','sourceSha256','entries'] <> '{}'::jsonb
    OR plan->>'version' IS DISTINCT FROM '2'
    OR plan->>'sourceSha256' IS NULL
    OR plan->>'sourceSha256' !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(entries) IS DISTINCT FROM 'array'
    OR jsonb_array_length(entries) <> 21 THEN
    RAISE EXCEPTION 'Invalid import request envelope' USING ERRCODE='23514';
  END IF;
  dataset := (fence_request->>'datasetId')::uuid;
  transaction_uuid := (p_evidence->>'transactionId')::uuid;
  request_sha := encode(sha256(convert_to(p_request_text,'UTF8')),'hex');

  SELECT count(*),count(DISTINCT entry->>'key') INTO item_count,key_count
    FROM jsonb_array_elements(entries) AS rows(entry);
  IF item_count <> 21 OR key_count <> 21
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(entries) AS rows(entry)
      WHERE jsonb_typeof(entry) IS DISTINCT FROM 'object'
        OR entry - ARRAY['key','rawValueHex'] <> '{}'::jsonb
        OR jsonb_typeof(entry->'key') IS DISTINCT FROM 'string'
        OR NOT (entry ? 'rawValueHex')
        OR jsonb_typeof(entry->'rawValueHex') NOT IN ('string','null')
        OR (jsonb_typeof(entry->'rawValueHex')='string' AND entry->>'rawValueHex' !~ '^([a-f0-9]{4})*$')
        OR NOT EXISTS (SELECT 1 FROM empire_os_preparation.store_registry r WHERE r.store_key=entry->>'key'))
    OR EXISTS (SELECT 1 FROM empire_os_preparation.store_registry r WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(entries) AS rows(entry) WHERE entry->>'key'=r.store_key)) THEN
    RAISE EXCEPTION 'Import must contain every registered store exactly once as exact UTF-16LE bytes' USING ERRCODE='23514';
  END IF;

  -- Match importSourceContent() v2: fixed registry order, length-framed UTF-8 keys, and
  -- exact UTF-16LE values. This independently binds the source digest to persisted bytes.
  FOR registered_key IN
    SELECT r.store_key FROM empire_os_preparation.store_registry r ORDER BY r.registry_position
  LOOP
    SELECT entry INTO STRICT item FROM jsonb_array_elements(entries) AS rows(entry)
      WHERE entry->>'key'=registered_key;
    key_bytes := convert_to(registered_key,'UTF8');
    source_content := source_content || int2send(octet_length(key_bytes)::smallint) || key_bytes;
    IF jsonb_typeof(item->'rawValueHex')='null' THEN
      source_content := source_content || decode('00','hex');
    ELSE
      raw_bytes := decode(item->>'rawValueHex','hex');
      source_content := source_content || decode('01','hex')
        || int8send((octet_length(raw_bytes)/2)::bigint) || raw_bytes;
    END IF;
  END LOOP;
  IF encode(sha256(source_content),'hex') IS DISTINCT FROM plan->>'sourceSha256' THEN
    RAISE EXCEPTION 'Import source fingerprint does not match exact UTF-16LE values' USING ERRCODE='23514';
  END IF;

  IF EXISTS (SELECT 1 FROM
      (SELECT d->>'datasetId' AS dataset_id FROM jsonb_array_elements(snapshot->'datasets') d) policy
      FULL JOIN (SELECT d.dataset_id::text AS dataset_id FROM empire_os_authorization.datasets d
        WHERE d.tenant_id=tenant) mapping USING (dataset_id)
      WHERE policy.dataset_id IS NULL OR mapping.dataset_id IS NULL) THEN
    RAISE EXCEPTION 'Authority dataset mapping is inconsistent' USING ERRCODE='23514';
  END IF;
  SELECT EXISTS (SELECT 1 FROM empire_os_authorization.datasets d
    JOIN empire_os_preparation.datasets legacy ON legacy.dataset_id=d.dataset_id
    WHERE d.tenant_id=tenant AND d.dataset_id=dataset
      AND d.generation=(fence_request->>'generation')::bigint
      AND d.authority_revision=(fence_request->>'authorityRevision')::bigint
      AND d.authority_mode='preparation-only'
      AND legacy.protocol_version=1 AND legacy.generation=d.generation AND legacy.commit_sequence=0
      AND EXISTS (SELECT 1 FROM empire_os_preparation.generations g
        WHERE g.dataset_id=dataset AND g.generation=d.generation
          AND g.phase='preparing' AND g.source_sha256 IS NULL)) INTO mapped;
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
        AND g->>'datasetId'=dataset::text AND g->>'capability'='import'
      ORDER BY (g->>'id') COLLATE "C" LIMIT 1;
    IF evidence_id IS NOT NULL THEN allowed := true; reason := 'direct-grant';
    ELSE
      SELECT d INTO delegated FROM jsonb_array_elements(snapshot->'delegations') d,
        LATERAL jsonb_array_elements(snapshot->'memberships') issuer,
        LATERAL jsonb_array_elements(snapshot->'roles') r,
        LATERAL jsonb_array_elements(r->'grants') g
        WHERE d->>'status'='active' AND d->>'recipientSubject'=actor AND d->>'datasetId'=dataset::text
          AND d->>'capability'='import'
          AND (d->>'issuedAt')::numeric <= now_ms AND (d->>'expiresAt')::numeric > now_ms
          AND d->'recipientMembershipRevision'=member->'revision'
          AND issuer->>'subject'=d->>'issuerSubject' AND issuer->>'status'='active'
          AND issuer->'revision'=d->'issuerMembershipRevision'
          AND r->>'id'=d->>'sourceRoleId' AND r->>'status'='active'
          AND r->'revision'=d->'sourceRoleRevision' AND (issuer->'roleIds') ? (r->>'id')
          AND g->>'id'=d->>'sourceGrantId' AND g->>'datasetId'=dataset::text
          AND g->>'capability'='import' AND g->>'delegable'='true'
        ORDER BY (d->>'id') COLLATE "C" LIMIT 1;
      IF delegated IS NULL THEN reason := 'capability-not-granted';
      ELSE allowed := true; reason := 'delegated-grant'; evidence_id := delegated->>'id'; END IF;
    END IF;
  END IF;
  expected_decision := jsonb_build_object('status',CASE WHEN allowed THEN 'allowed' ELSE 'denied' END,
    'reason',reason,'policyVersion',1,'observedPolicyRevision',current_revision);
  IF evidence_id IS NOT NULL THEN expected_decision := expected_decision || jsonb_build_object('evidenceId',evidence_id); END IF;
  IF NOT allowed THEN RAISE EXCEPTION 'Import capability denied' USING ERRCODE='42501'; END IF;
  SELECT r.decision INTO read_decision
    FROM empire_os_authorization.read_dataset_snapshot(tenant,dataset) r;
  IF read_decision->>'status' IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'Import staging also requires read capability' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM empire_os_authorization.preparation_writes w
      WHERE w.tenant_id=tenant AND w.dataset_id=dataset)
    OR EXISTS (SELECT 1 FROM empire_os_authorization.audit a
      WHERE a.tenant_id=tenant AND a.dataset_id=dataset AND a.allowed
        AND a.evidence->>'operation' IN ('write','stage-import')) THEN
    RAISE EXCEPTION 'Import target is already initialized' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM empire_os_preparation.store_values s
      WHERE s.dataset_id=dataset AND (s.generation<>(fence_request->>'generation')::bigint
        OR s.raw_value IS NOT NULL OR s.revision<>0))
    OR EXISTS (SELECT 1 FROM empire_os_preparation.store_values s
      WHERE s.dataset_id=dataset AND s.generation=(fence_request->>'generation')::bigint
      GROUP BY s.dataset_id HAVING count(*) NOT IN (0,21))
    OR EXISTS (SELECT 1 FROM empire_os_preparation.transactions t WHERE t.dataset_id=dataset)
    OR EXISTS (SELECT 1 FROM empire_os_preparation.idempotency_results i WHERE i.dataset_id=dataset)
    OR EXISTS (SELECT 1 FROM empire_os_preparation.import_sources s WHERE s.dataset_id=dataset) THEN
    RAISE EXCEPTION 'Import target has existing dataset values or import evidence' USING ERRCODE='23514';
  END IF;

  checked_ms := (p_evidence->>'checkedAt')::numeric;
  IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'object'
    OR p_evidence - ARRAY['version','operationId','decisionId','transactionId','requestSha256','actorSubject',
      'tenantId','datasetId','operation','decision','checkedAt','completedAt','resultingPolicyRevision'] <> '{}'::jsonb
    OR p_evidence->'version' IS DISTINCT FROM '1'::jsonb
    OR p_evidence->>'operation' IS DISTINCT FROM 'stage-import'
    OR p_evidence->>'operationId' IS DISTINCT FROM p_request->>'operationId'
    OR p_evidence->>'transactionId' IS DISTINCT FROM transaction_uuid::text
    OR p_evidence->>'decisionId' IS DISTINCT FROM encode(sha256(convert_to(
      '["' || transaction_uuid::text || '","' || (p_request->>'operationId') || '","decision",1]','UTF8')),'hex')
    OR p_evidence->>'requestSha256' IS DISTINCT FROM request_sha
    OR p_evidence->>'actorSubject' IS DISTINCT FROM actor
    OR p_evidence->>'tenantId' IS DISTINCT FROM tenant
    OR p_evidence->>'datasetId' IS DISTINCT FROM dataset::text
    OR p_evidence->'decision' IS DISTINCT FROM expected_decision
    OR p_evidence->>'resultingPolicyRevision' IS DISTINCT FROM current_revision::text
    OR checked_ms IS NULL OR checked_ms < floor(extract(epoch FROM transaction_timestamp())*1000)
    OR checked_ms > now_ms
    OR (p_evidence->>'completedAt')::numeric < checked_ms
    OR (p_evidence->>'completedAt')::numeric > now_ms THEN
    RAISE EXCEPTION 'Unverified import actor, request or decision evidence' USING ERRCODE='42501';
  END IF;

  INSERT INTO empire_os_authorization.audit
    (tenant_id,dataset_id,mapped_dataset_id,transaction_id,operation_id,decision_id,actor_subject,allowed,
      resulting_revision,evidence,applied_request,applied_request_sha256)
  VALUES (tenant,dataset,dataset,transaction_uuid,p_request->>'operationId',p_evidence->>'decisionId',actor,true,
    current_revision,p_evidence,p_request_text,request_sha);

  FOR item IN SELECT entry FROM jsonb_array_elements(entries) AS rows(entry) LOOP
    INSERT INTO empire_os_authorization.preparation_writes
      (tenant_id,dataset_id,transaction_id,store_key,revision,raw_value)
    VALUES (tenant,dataset,transaction_uuid,item->>'key',1,
      CASE WHEN jsonb_typeof(item->'rawValueHex')='null' THEN NULL ELSE decode(item->>'rawValueHex','hex') END);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION empire_os_authorization.stage_import(text,jsonb) FROM PUBLIC;
COMMIT;
