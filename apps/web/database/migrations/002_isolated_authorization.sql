-- Version 2; apply only after 001 on a NEW verified empty disposable instance.
-- No grants, runtime roles, live writer, destructive DDL or existing policy changes.
BEGIN;
CREATE SCHEMA empire_os_authorization;
REVOKE ALL ON SCHEMA empire_os_authorization FROM PUBLIC;

CREATE TABLE empire_os_authorization.tenants (
  tenant_id text PRIMARY KEY CHECK (length(tenant_id) BETWEEN 1 AND 512),
  revision bigint NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
  state jsonb NOT NULL,
  CHECK (coalesce(state->>'schemaVersion' = '1', false)),
  CHECK (coalesce(state #>> '{snapshot,version}' = '1', false)),
  CHECK (coalesce(state #>> '{snapshot,tenant,id}' = tenant_id, false)),
  CHECK (coalesce((state #>> '{snapshot,revision}')::bigint = revision, false)),
  CHECK (coalesce(jsonb_typeof(state #> '{snapshot,memberships}') = 'array', false)),
  CHECK (coalesce(jsonb_typeof(state #> '{snapshot,roles}') = 'array', false)),
  CHECK (coalesce(jsonb_typeof(state #> '{snapshot,delegations}') = 'array', false)),
  CHECK (coalesce(jsonb_typeof(state #> '{snapshot,datasets}') = 'array', false)),
  CHECK (coalesce(jsonb_typeof(state->'revocations') = 'array', false)),
  CHECK (state ?& ARRAY['schemaVersion','snapshot','revocations'])
);
-- Bindings are provisioned by a separate trusted process. Application roles get SELECT only.
-- Each effective runtime role has one independently provisioned actor per tenant.
-- Grant runtime EXECUTE only on lock_authority(text) and apply_operation(text,jsonb,jsonb).
CREATE TABLE empire_os_authorization.role_tenants (
  database_role name NOT NULL,
  actor_subject text NOT NULL CHECK (length(actor_subject) BETWEEN 1 AND 512),
  tenant_id text NOT NULL REFERENCES empire_os_authorization.tenants,
  PRIMARY KEY (database_role, tenant_id)
);
CREATE TABLE empire_os_authorization.datasets (
  dataset_id uuid PRIMARY KEY REFERENCES empire_os_preparation.datasets,
  tenant_id text NOT NULL REFERENCES empire_os_authorization.tenants,
  generation bigint NOT NULL DEFAULT 1 CHECK (generation BETWEEN 1 AND 9007199254740991),
  authority_revision bigint NOT NULL DEFAULT 0 CHECK (authority_revision BETWEEN 0 AND 9007199254740991),
  authority_mode text NOT NULL DEFAULT 'preparation-only' CHECK (authority_mode='preparation-only'),
  UNIQUE (tenant_id, dataset_id)
);
CREATE TABLE empire_os_authorization.audit (
  transaction_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  dataset_id uuid NOT NULL,
  mapped_dataset_id uuid,
  database_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),
  applied_request text NOT NULL CHECK (jsonb_typeof(applied_request::jsonb)='object'),
  applied_request_sha256 text NOT NULL CHECK (applied_request_sha256 ~ '^[a-f0-9]{64}$'),
  operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$'),
  decision_id text NOT NULL UNIQUE CHECK (decision_id ~ '^[a-f0-9]{64}$'),
  actor_subject text NOT NULL,
  allowed boolean NOT NULL,
  resulting_revision bigint NOT NULL CHECK (resulting_revision BETWEEN 0 AND 9007199254740991),
  evidence jsonb NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES empire_os_authorization.tenants,
  FOREIGN KEY (tenant_id,mapped_dataset_id) REFERENCES empire_os_authorization.datasets(tenant_id,dataset_id),
  CHECK (mapped_dataset_id IS NULL OR mapped_dataset_id = dataset_id),
  CHECK (NOT allowed OR mapped_dataset_id IS NOT NULL),
  CHECK (applied_request_sha256=encode(sha256(convert_to(applied_request,'UTF8')),'hex')),
  CHECK (evidence->>'requestSha256'=applied_request_sha256),
  UNIQUE (tenant_id,database_transaction),
  UNIQUE (tenant_id,transaction_id),
  CHECK (coalesce(evidence->>'version' = '1',false)),
  CHECK (coalesce(evidence->>'transactionId' = transaction_id::text,false)),
  CHECK (coalesce(evidence->>'tenantId' = tenant_id,false)),
  CHECK (coalesce(evidence->>'datasetId' = dataset_id::text,false)),
  CHECK (coalesce(evidence->>'operationId' = operation_id,false)),
  CHECK (coalesce(evidence->>'decisionId' = decision_id,false)),
  CHECK (coalesce(evidence->>'actorSubject' = actor_subject,false)),
  CHECK (coalesce((evidence->>'resultingPolicyRevision')::bigint = resulting_revision,false)),
  CHECK (coalesce((evidence #>> '{decision,status}' = 'allowed') = allowed,false)),
  CHECK (coalesce(evidence->>'requestSha256' ~ '^[a-f0-9]{64}$',false)),
  CHECK (evidence ?& ARRAY['version','transactionId','tenantId','datasetId','operationId','decisionId',
    'actorSubject','resultingPolicyRevision','decision','requestSha256','operation','checkedAt','completedAt']),
  CHECK (coalesce(evidence #>> '{decision,status}' IN ('allowed','denied'),false)),
  CHECK (coalesce(evidence->>'operation' IN ('write','assign-role','delegate','revoke'),false)),
  CHECK (coalesce(jsonb_typeof(evidence->'decision')='object',false)),
  CHECK (coalesce((evidence->>'checkedAt')::numeric BETWEEN 0 AND 9007199254740991,false)),
  CHECK (coalesce((evidence->>'completedAt')::numeric BETWEEN (evidence->>'checkedAt')::numeric AND 9007199254740991,false)),
  CHECK (coalesce(evidence #>> '{decision,policyVersion}'='1',false))
);
CREATE UNIQUE INDEX successful_operation_once ON empire_os_authorization.audit(tenant_id,actor_subject,operation_id) WHERE allowed;
CREATE UNIQUE INDEX authority_revision_once ON empire_os_authorization.audit(tenant_id,resulting_revision)
  WHERE allowed AND evidence->>'operation' IN ('assign-role','delegate','revoke');
-- Isolated preparation effects, NOT the existing store_values or a live business writer.
CREATE TABLE empire_os_authorization.preparation_writes (
  tenant_id text NOT NULL,
  dataset_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  store_key text NOT NULL REFERENCES empire_os_preparation.store_registry,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  raw_value bytea CHECK (raw_value IS NULL OR octet_length(raw_value) % 2 = 0),
  PRIMARY KEY (tenant_id,dataset_id,store_key,revision),
  FOREIGN KEY (tenant_id,dataset_id) REFERENCES empire_os_authorization.datasets(tenant_id,dataset_id),
  FOREIGN KEY (tenant_id,transaction_id) REFERENCES empire_os_authorization.audit(tenant_id,transaction_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE FUNCTION empire_os_authorization.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Authorization evidence and mappings are immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER immutable_dataset BEFORE UPDATE OR DELETE ON empire_os_authorization.datasets
FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.reject_mutation();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON empire_os_authorization.audit
FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.reject_mutation();
CREATE TRIGGER immutable_write BEFORE UPDATE OR DELETE ON empire_os_authorization.preparation_writes
FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.reject_mutation();
CREATE TRIGGER retained_tenant BEFORE DELETE ON empire_os_authorization.tenants
FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.reject_mutation();

CREATE FUNCTION empire_os_authorization.state_step() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.revision <> OLD.revision + 1
     OR NEW.state #> '{snapshot,tenant}' IS DISTINCT FROM OLD.state #> '{snapshot,tenant}'
     OR NEW.state #> '{snapshot,datasets}' IS DISTINCT FROM OLD.state #> '{snapshot,datasets}' THEN
    RAISE EXCEPTION 'Invalid authority revision, ownership or dataset transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER authority_step BEFORE UPDATE ON empire_os_authorization.tenants
FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.state_step();
CREATE FUNCTION empire_os_authorization.require_state_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM empire_os_authorization.audit a
    WHERE a.tenant_id=NEW.tenant_id AND a.resulting_revision=NEW.revision AND a.allowed
      AND a.database_transaction=pg_current_xact_id()
      AND a.evidence->>'operation' IN ('assign-role','delegate','revoke')) THEN
    RAISE EXCEPTION 'Authority transition requires atomic audit' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER authority_audit AFTER UPDATE ON empire_os_authorization.tenants
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.require_state_audit();

-- Every protected insert participates in the same tenant row-lock order as revocation.
CREATE FUNCTION empire_os_authorization.lock_tenant() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE old_tenant text; new_tenant text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN old_tenant := OLD.tenant_id; END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN new_tenant := NEW.tenant_id; END IF;
  PERFORM 1 FROM empire_os_authorization.tenants WHERE tenant_id IN (old_tenant,new_tenant)
    ORDER BY tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tenant authority unavailable' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER serialize_audit BEFORE INSERT ON empire_os_authorization.audit
FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.lock_tenant();
CREATE TRIGGER serialize_write BEFORE INSERT ON empire_os_authorization.preparation_writes
FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.lock_tenant();
CREATE TRIGGER serialize_mapping BEFORE INSERT ON empire_os_authorization.datasets
FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.lock_tenant();
CREATE TRIGGER serialize_binding BEFORE INSERT OR UPDATE OR DELETE ON empire_os_authorization.role_tenants
FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.lock_tenant();

CREATE FUNCTION empire_os_authorization.audit_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE current_revision bigint; observed bigint;
BEGIN
  SELECT revision INTO current_revision FROM empire_os_authorization.tenants WHERE tenant_id=NEW.tenant_id FOR UPDATE;
  observed := (NEW.evidence #>> '{decision,observedPolicyRevision}')::bigint;
  IF current_revision IS NULL OR observed IS NULL OR NEW.resulting_revision <> current_revision
    OR observed <> current_revision - CASE WHEN NEW.allowed AND
      NEW.evidence->>'operation' IN ('assign-role','delegate','revoke') THEN 1 ELSE 0 END THEN
    RAISE EXCEPTION 'Stale authorization audit revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER current_audit_revision BEFORE INSERT ON empire_os_authorization.audit
FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.audit_revision();

CREATE FUNCTION empire_os_authorization.check_write_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM empire_os_authorization.audit a WHERE a.tenant_id=NEW.tenant_id
    AND a.transaction_id=NEW.transaction_id AND a.dataset_id=NEW.dataset_id AND a.allowed
    AND a.database_transaction=pg_current_xact_id()
    AND a.resulting_revision=(SELECT revision FROM empire_os_authorization.tenants WHERE tenant_id=NEW.tenant_id)
    AND a.evidence->>'operation'='write') THEN
    RAISE EXCEPTION 'Preparation write requires allowed atomic audit' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER write_audit AFTER INSERT ON empire_os_authorization.preparation_writes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.check_write_audit();

CREATE FUNCTION empire_os_authorization.check_delegation_expiry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE expires numeric;
BEGIN
  IF NEW.allowed AND NEW.evidence->>'operation'='delegate' THEN
    expires := (NEW.evidence #>> '{authorityChange,request,expiresAt}')::numeric;
    IF expires IS NULL OR expires <= extract(epoch FROM clock_timestamp()) * 1000 THEN
      RAISE EXCEPTION 'New delegation already expired' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.allowed AND NEW.evidence #>> '{decision,reason}' = 'delegated-grant' THEN
    SELECT (d->>'expiresAt')::numeric INTO expires FROM empire_os_authorization.tenants t,
      LATERAL jsonb_array_elements(t.state #> '{snapshot,delegations}') d
      WHERE t.tenant_id=NEW.tenant_id AND d->>'id'=NEW.evidence #>> '{decision,evidenceId}'
        AND d->>'status'='active';
    IF expires IS NULL OR expires <= extract(epoch FROM clock_timestamp()) * 1000 THEN
      RAISE EXCEPTION 'Delegation expired at database completion boundary' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER audit_expiry AFTER INSERT ON empire_os_authorization.audit
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.check_delegation_expiry();

ALTER TABLE empire_os_authorization.role_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE empire_os_authorization.role_tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY own_binding ON empire_os_authorization.role_tenants FOR SELECT
USING (database_role = current_user);
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['tenants','datasets','audit','preparation_writes'] LOOP
    EXECUTE format('ALTER TABLE empire_os_authorization.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE empire_os_authorization.%I FORCE ROW LEVEL SECURITY',tab);
    EXECUTE format('CREATE POLICY tenant_scope ON empire_os_authorization.%I
      USING (tenant_id IN (SELECT tenant_id FROM empire_os_authorization.role_tenants WHERE database_role=current_user))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM empire_os_authorization.role_tenants WHERE database_role=current_user))',tab);
  END LOOP;
END;
$$;

-- The migration owner is the trusted provisioner/API owner, never a runtime identity.
-- FORCE RLS remains enabled even when that owner is not a superuser.
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['role_tenants','tenants','datasets','audit','preparation_writes'] LOOP
    EXECUTE format('CREATE POLICY trusted_api ON empire_os_authorization.%I
      USING (current_user=%L) WITH CHECK (current_user=%L)',tab,current_user,current_user);
  END LOOP;
END;
$$;

CREATE FUNCTION empire_os_authorization.runtime_subject(p_tenant text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE runtime_role name; subject text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Authorization requires fresh READ COMMITTED snapshots' USING ERRCODE='42501';
  END IF;
  -- PostgreSQL checks SET ROLE itself. An arbitrary custom GUC is never an identity.
  runtime_role := CASE WHEN current_setting('role')='none' THEN session_user
    ELSE current_setting('role')::name END;
  IF NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname=runtime_role
    AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolreplication))
    OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('empire_os_authorization','empire_os_preparation')
      AND (c.relowner=(SELECT oid FROM pg_roles WHERE rolname=runtime_role)
        OR (c.relkind='r' AND (has_any_column_privilege(runtime_role,c.oid,'INSERT')
          OR has_any_column_privilege(runtime_role,c.oid,'UPDATE')
          OR has_table_privilege(runtime_role,c.oid,'DELETE')
          OR has_table_privilege(runtime_role,c.oid,'TRUNCATE'))))) THEN
    RAISE EXCEPTION 'Unsafe authorization database identity' USING ERRCODE='42501';
  END IF;
  SELECT actor_subject INTO subject FROM empire_os_authorization.role_tenants
    WHERE database_role=runtime_role AND tenant_id=p_tenant;
  IF subject IS NULL THEN
    RAISE EXCEPTION 'No authenticated tenant binding' USING ERRCODE='42501';
  END IF;
  RETURN subject;
END;
$$;

CREATE FUNCTION empire_os_authorization.lock_authority(p_tenant text)
RETURNS TABLE(state jsonb,revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM empire_os_authorization.runtime_subject(p_tenant);
  RETURN QUERY SELECT t.state,t.revision FROM empire_os_authorization.tenants t
    WHERE t.tenant_id=p_tenant FOR UPDATE;
  PERFORM empire_os_authorization.runtime_subject(p_tenant);
END;
$$;

CREATE FUNCTION empire_os_authorization.valid_counter(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN jsonb_typeof(value)='number' AND value::text ~ '^(0|[1-9][0-9]*)$'
    THEN value::text::numeric BETWEEN 0 AND 9007199254740991 ELSE false END;
$$;
CREATE FUNCTION empire_os_authorization.valid_identifier(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT coalesce(jsonb_typeof(value)='string' AND length(value #>> '{}') BETWEEN 1 AND 512
    AND btrim(value #>> '{}')=value #>> '{}' AND (value #>> '{}') !~ '[[:cntrl:]]',false);
$$;

-- Direct DML remains forbidden even if a runtime role accidentally receives grants.
CREATE FUNCTION empire_os_authorization.trusted_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF current_user IS DISTINCT FROM (SELECT r.rolname FROM pg_namespace n
      JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname='empire_os_authorization') THEN
    RAISE EXCEPTION 'Use the authenticated authorization API' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['role_tenants','tenants','datasets','audit','preparation_writes'] LOOP
    EXECUTE format('CREATE TRIGGER a_only_trusted_mutation BEFORE INSERT OR UPDATE OR DELETE
      ON empire_os_authorization.%I FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.trusted_mutation()',tab);
    EXECUTE format('CREATE TRIGGER no_runtime_truncate BEFORE TRUNCATE
      ON empire_os_authorization.%I FOR EACH STATEMENT EXECUTE FUNCTION empire_os_authorization.trusted_mutation()',tab);
  END LOOP;
END;
$$;

-- No decision, actor claim, revision claim or proposed state establishes permission.
-- The only callable mutation derives authorization and the exact transition here.
CREATE FUNCTION empire_os_authorization.apply_operation(p_request_text text,p_evidence jsonb,p_next jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  p_request jsonb := p_request_text::jsonb;
  tenant text := p_request->>'tenantId';
  actor text; old_state jsonb; snapshot jsonb; current_revision bigint;
  command jsonb := p_request->'command'; payload jsonb; operation text := command->>'kind';
  dataset uuid; mapped uuid; member jsonb; recipient jsonb; source_role jsonb; source_grant jsonb;
  delegated jsonb; target jsonb; expected_state jsonb; entries jsonb; entry jsonb;
  reason text; evidence_id text; decision jsonb; allowed boolean := false;
  now_ms numeric := floor(extract(epoch FROM clock_timestamp())*1000);
  checked_ms numeric; fence empire_os_authorization.datasets%ROWTYPE;
  actual_revision bigint; transaction_uuid uuid := (p_evidence->>'transactionId')::uuid;
BEGIN
  actor := empire_os_authorization.runtime_subject(tenant);
  SELECT t.state,t.revision INTO STRICT old_state,current_revision
    FROM empire_os_authorization.tenants t WHERE t.tenant_id=tenant FOR UPDATE;
  actor := empire_os_authorization.runtime_subject(tenant);
  -- Sample time AFTER waiting for the tenant lock.
  now_ms := floor(extract(epoch FROM clock_timestamp())*1000);
  snapshot := old_state->'snapshot';
  payload := command->'request';
  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object'
    OR p_request - ARRAY['tenantId','operationId','expectedPolicyRevision','command'] <> '{}'::jsonb
    OR jsonb_typeof(command) IS DISTINCT FROM 'object'
    OR NOT empire_os_authorization.valid_identifier(p_request->'tenantId')
    OR NOT empire_os_authorization.valid_identifier(p_request->'operationId')
    OR NOT empire_os_authorization.valid_counter(p_request->'expectedPolicyRevision') THEN
    RAISE EXCEPTION 'Invalid authorization request envelope' USING ERRCODE='23514';
  END IF;
  dataset := CASE WHEN operation='write' THEN (payload #>> '{fence,datasetId}')::uuid
    WHEN operation='revoke' THEN (command->>'datasetId')::uuid ELSE (payload->>'datasetId')::uuid END;
  IF operation NOT IN ('write','assign-role','delegate','revoke') OR operation IS NULL
    OR dataset IS NULL OR p_request->>'operationId' IS NULL
    OR (p_request->>'expectedPolicyRevision')::numeric NOT BETWEEN 0 AND 9007199254740991
    OR p_request->>'expectedPolicyRevision' IS NULL THEN
    RAISE EXCEPTION 'Invalid authorization request' USING ERRCODE='23514';
  END IF;
  IF operation IN ('assign-role','delegate') AND
    (payload->>'tenantId' IS DISTINCT FROM tenant OR payload->>'operation' IS DISTINCT FROM operation
     OR payload->'expectedPolicyRevision' IS DISTINCT FROM p_request->'expectedPolicyRevision') THEN
    RAISE EXCEPTION 'Invalid authority request scope' USING ERRCODE='23514';
  END IF;
  IF operation IN ('assign-role','delegate') THEN
    IF command - ARRAY['kind','request'] <> '{}'::jsonb OR jsonb_typeof(payload) IS DISTINCT FROM 'object'
      OR NOT empire_os_authorization.valid_identifier(payload->'recipientSubject')
      OR (operation='assign-role' AND
        (payload - ARRAY['tenantId','datasetId','expectedPolicyRevision','operation','recipientSubject','roleId'] <> '{}'::jsonb
          OR NOT empire_os_authorization.valid_identifier(payload->'roleId')))
      OR (operation='delegate' AND
        (payload - ARRAY['tenantId','datasetId','expectedPolicyRevision','operation','recipientSubject',
          'capability','sourceRoleId','sourceGrantId','expiresAt'] <> '{}'::jsonb
          OR NOT empire_os_authorization.valid_identifier(payload->'sourceRoleId')
          OR NOT empire_os_authorization.valid_identifier(payload->'sourceGrantId')
          OR NOT empire_os_authorization.valid_counter(payload->'expiresAt')
          OR coalesce(payload->>'capability','') NOT IN ('read','write','import'))) THEN
      RAISE EXCEPTION 'Invalid authority command' USING ERRCODE='23514';
    END IF;
  ELSIF operation='revoke' THEN
    IF command - ARRAY['kind','datasetId','target'] <> '{}'::jsonb
      OR jsonb_typeof(command->'target') IS DISTINCT FROM 'object'
      OR (command->'target') - ARRAY['kind','id'] <> '{}'::jsonb
      OR coalesce(command #>> '{target,kind}','') NOT IN ('membership','role','delegation')
      OR NOT empire_os_authorization.valid_identifier(command #> '{target,id}') THEN
      RAISE EXCEPTION 'Invalid revocation command' USING ERRCODE='23514';
    END IF;
  ELSE
    IF command - ARRAY['kind','request'] <> '{}'::jsonb
      OR jsonb_typeof(payload) IS DISTINCT FROM 'object'
      OR payload - ARRAY['fence','idempotencyKey','reads','writes'] <> '{}'::jsonb
      OR jsonb_typeof(payload->'fence') IS DISTINCT FROM 'object'
      OR (payload->'fence') - ARRAY['datasetId','protocolVersion','generation','authorityRevision'] <> '{}'::jsonb
      OR payload #>> '{fence,protocolVersion}' IS DISTINCT FROM '1'
      OR NOT empire_os_authorization.valid_counter(payload #> '{fence,generation}')
      OR payload #>> '{fence,generation}'='0'
      OR NOT empire_os_authorization.valid_counter(payload #> '{fence,authorityRevision}')
      OR jsonb_typeof(payload->'reads') IS DISTINCT FROM 'array'
      OR jsonb_typeof(payload->'writes') IS DISTINCT FROM 'array'
      OR coalesce(payload->>'idempotencyKey','') !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$' THEN
      RAISE EXCEPTION 'Invalid preparation write command' USING ERRCODE='23514';
    END IF;
    IF jsonb_array_length(payload->'writes') NOT BETWEEN 1 AND
        (SELECT count(*) FROM empire_os_preparation.store_registry)
      OR jsonb_array_length(payload->'reads') > (SELECT count(*) FROM empire_os_preparation.store_registry)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'writes') w GROUP BY w->>'key' HAVING count(*)>1)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'reads') r GROUP BY r->>'key' HAVING count(*)>1)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'reads') r,
        jsonb_array_elements(payload->'writes') w WHERE r->>'key'=w->>'key'
          AND r->'expectedRevision' IS DISTINCT FROM w->'expectedRevision') THEN
      RAISE EXCEPTION 'Invalid preparation read/write set' USING ERRCODE='23514';
    END IF;
    FOR entry IN SELECT e FROM jsonb_array_elements(payload->'reads') e LOOP
      IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR entry - ARRAY['key','expectedRevision'] <> '{}'::jsonb
        OR NOT EXISTS (SELECT 1 FROM empire_os_preparation.store_registry s WHERE s.store_key=entry->>'key')
        OR NOT empire_os_authorization.valid_counter(entry->'expectedRevision') THEN
        RAISE EXCEPTION 'Invalid read expectation' USING ERRCODE='23514';
      END IF;
    END LOOP;
    FOR entry IN SELECT e FROM jsonb_array_elements(payload->'writes') e LOOP
      IF jsonb_typeof(entry) IS DISTINCT FROM 'object'
        OR entry - ARRAY['key','expectedRevision','rawValueHex'] <> '{}'::jsonb
        OR NOT EXISTS (SELECT 1 FROM empire_os_preparation.store_registry s WHERE s.store_key=entry->>'key')
        OR NOT empire_os_authorization.valid_counter(entry->'expectedRevision')
        OR entry->>'expectedRevision'='9007199254740991'
        OR NOT (entry ? 'rawValueHex')
        OR jsonb_typeof(entry->'rawValueHex') NOT IN ('string','null')
        OR (entry->>'rawValueHex' IS NOT NULL AND entry->>'rawValueHex' !~ '^([a-f0-9]{4})*$') THEN
        RAISE EXCEPTION 'Invalid write expectation or UTF-16 value' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END IF;
  SELECT d.dataset_id INTO mapped FROM empire_os_authorization.datasets d
    WHERE d.tenant_id=tenant AND d.dataset_id=dataset;
  IF EXISTS (SELECT 1 FROM
      (SELECT d->>'datasetId' AS dataset_id FROM jsonb_array_elements(snapshot->'datasets') d) policy
      FULL JOIN (SELECT d.dataset_id::text AS dataset_id FROM empire_os_authorization.datasets d
        WHERE d.tenant_id=tenant) mapping USING (dataset_id)
      WHERE policy.dataset_id IS NULL OR mapping.dataset_id IS NULL) THEN
    RAISE EXCEPTION 'Authority dataset mapping is inconsistent' USING ERRCODE='23514';
  END IF;
  SELECT m INTO member FROM jsonb_array_elements(snapshot->'memberships') m WHERE m->>'subject'=actor;
  IF snapshot #>> '{tenant,status}' <> 'active' THEN reason := 'tenant-revoked';
  ELSIF mapped IS NULL THEN reason := 'dataset-not-authorized';
  ELSIF (p_request->>'expectedPolicyRevision')::bigint <> current_revision THEN reason := 'stale-policy';
  ELSIF member IS NULL THEN reason := 'membership-required';
  ELSIF member->>'status' <> 'active' THEN reason := 'membership-revoked';
  ELSIF operation IN ('assign-role','delegate') THEN
    SELECT m INTO recipient FROM jsonb_array_elements(snapshot->'memberships') m
      WHERE m->>'subject'=payload->>'recipientSubject' AND m->>'status'='active';
    IF payload->>'recipientSubject'=actor THEN reason := 'self-escalation';
    ELSIF recipient IS NULL THEN reason := 'recipient-not-active';
    ELSIF operation='assign-role' THEN
      IF NOT ((snapshot #> '{tenant,ownerSubjects}') ? actor) THEN reason := 'owner-required';
      ELSE
        SELECT r INTO source_role FROM jsonb_array_elements(snapshot->'roles') r
          WHERE r->>'id'=payload->>'roleId' AND r->>'status'='active';
        IF source_role IS NULL THEN reason := 'role-not-active';
        ELSE allowed := true; reason := 'role-assignment-authorized'; evidence_id := source_role->>'id'; END IF;
      END IF;
    ELSIF (payload->>'expiresAt')::numeric <= now_ms THEN reason := 'invalid-expiry';
    ELSE
      SELECT r,g INTO source_role,source_grant FROM jsonb_array_elements(snapshot->'roles') r,
        LATERAL jsonb_array_elements(r->'grants') g
        WHERE r->>'id'=payload->>'sourceRoleId' AND r->>'status'='active'
          AND (member->'roleIds') ? (r->>'id') AND g->>'id'=payload->>'sourceGrantId'
          AND g->>'datasetId'=dataset::text AND g->>'capability'=payload->>'capability' AND g->>'delegable'='true';
      IF source_grant IS NULL THEN reason := 'source-not-delegable';
      ELSE allowed := true; reason := 'delegation-authorized'; evidence_id := source_grant->>'id'; END IF;
    END IF;
  ELSIF (snapshot #> '{tenant,ownerSubjects}') ? actor THEN
    allowed := true; reason := 'owner-authority';
  ELSE
    -- Prefer a claimed proof only among independently validated current grants.
    -- This avoids coupling JavaScript identifier ordering to database collation.
    SELECT g->>'id' INTO evidence_id FROM jsonb_array_elements(snapshot->'roles') r,
      LATERAL jsonb_array_elements(r->'grants') g
      WHERE r->>'status'='active' AND (member->'roleIds') ? (r->>'id')
        AND g->>'datasetId'=dataset::text AND g->>'capability'=CASE WHEN operation='write' THEN 'write' ELSE 'read' END
      ORDER BY CASE WHEN g->>'id'=p_evidence #>> '{decision,evidenceId}' THEN 0 ELSE 1 END,
        (g->>'id') COLLATE "C" LIMIT 1;
    IF evidence_id IS NOT NULL THEN allowed := true; reason := 'direct-grant';
    ELSE
      SELECT d INTO delegated FROM jsonb_array_elements(snapshot->'delegations') d,
        LATERAL jsonb_array_elements(snapshot->'memberships') issuer,
        LATERAL jsonb_array_elements(snapshot->'roles') r,
        LATERAL jsonb_array_elements(r->'grants') g
        WHERE d->>'status'='active' AND d->>'recipientSubject'=actor AND d->>'datasetId'=dataset::text
          AND d->>'capability'=CASE WHEN operation='write' THEN 'write' ELSE 'read' END
          AND (d->>'issuedAt')::numeric <= now_ms AND (d->>'expiresAt')::numeric > now_ms
          AND d->'recipientMembershipRevision'=member->'revision'
          AND issuer->>'subject'=d->>'issuerSubject' AND issuer->>'status'='active'
          AND issuer->'revision'=d->'issuerMembershipRevision'
          AND r->>'id'=d->>'sourceRoleId' AND r->>'status'='active'
          AND r->'revision'=d->'sourceRoleRevision' AND (issuer->'roleIds') ? (r->>'id')
          AND g->>'id'=d->>'sourceGrantId' AND g->>'datasetId'=dataset::text
          AND g->>'capability'=d->>'capability' AND g->>'delegable'='true'
        ORDER BY CASE WHEN d->>'id'=p_evidence #>> '{decision,evidenceId}' THEN 0 ELSE 1 END,
          (d->>'id') COLLATE "C" LIMIT 1;
      IF delegated IS NULL THEN reason := 'capability-not-granted';
      ELSE allowed := true; reason := 'delegated-grant'; evidence_id := delegated->>'id'; END IF;
    END IF;
  END IF;
  IF operation='revoke' AND allowed THEN
    target := command->'target';
    IF reason <> 'owner-authority' THEN allowed := false; reason := 'owner-required'; evidence_id := NULL;
    ELSIF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE target->>'kind'
        WHEN 'membership' THEN snapshot->'memberships' WHEN 'role' THEN snapshot->'roles'
        WHEN 'delegation' THEN snapshot->'delegations' ELSE '[]'::jsonb END) t
        WHERE CASE WHEN target->>'kind'='membership' THEN t->>'subject' ELSE t->>'id' END = target->>'id'
          AND t->>'status'='active')
      OR (target->>'kind'='membership' AND (snapshot #> '{tenant,ownerSubjects}') ? (target->>'id')) THEN
      allowed := false; reason := 'invalid-request'; evidence_id := NULL;
    END IF;
  END IF;
  decision := jsonb_build_object('status',CASE WHEN allowed THEN 'allowed' ELSE 'denied' END,
    'reason',reason,'policyVersion',1,'observedPolicyRevision',current_revision);
  IF evidence_id IS NOT NULL THEN decision := decision || jsonb_build_object('evidenceId',evidence_id); END IF;
  IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'object'
    OR p_evidence - ARRAY['version','operationId','decisionId','transactionId','requestSha256','actorSubject',
      'tenantId','datasetId','operation','authorityChange','decision','checkedAt','completedAt','resultingPolicyRevision'] <> '{}'::jsonb
    OR p_evidence->'version' IS DISTINCT FROM '1'::jsonb
    OR NOT empire_os_authorization.valid_identifier(p_evidence->'actorSubject')
    OR NOT empire_os_authorization.valid_counter(p_evidence->'checkedAt')
    OR NOT empire_os_authorization.valid_counter(p_evidence->'completedAt')
    OR NOT empire_os_authorization.valid_counter(p_evidence->'resultingPolicyRevision') THEN
    RAISE EXCEPTION 'Invalid authorization audit envelope' USING ERRCODE='23514';
  END IF;
  checked_ms := (p_evidence->>'checkedAt')::numeric;
  IF p_evidence->>'actorSubject' IS DISTINCT FROM actor OR p_evidence->>'tenantId' IS DISTINCT FROM tenant
    OR p_evidence->>'datasetId' IS DISTINCT FROM dataset::text OR p_evidence->>'operation' IS DISTINCT FROM operation
    OR p_evidence->>'operationId' IS DISTINCT FROM p_request->>'operationId'
    OR p_evidence->'decision' IS DISTINCT FROM decision
    OR p_evidence->>'requestSha256' IS DISTINCT FROM encode(sha256(convert_to(p_request_text,'UTF8')),'hex')
    OR checked_ms IS NULL OR checked_ms > now_ms
    OR checked_ms < floor(extract(epoch FROM transaction_timestamp())*1000)
    OR (p_evidence->>'completedAt')::numeric > now_ms
    OR (operation IN ('assign-role','delegate','revoke') AND p_evidence->'authorityChange' IS DISTINCT FROM command) THEN
    RAISE EXCEPTION 'Unverified actor, request or decision evidence' USING ERRCODE='42501';
  END IF;
  expected_state := old_state;
  IF allowed AND operation <> 'write' THEN
    IF current_revision=9007199254740991
      OR (operation='assign-role' AND (recipient->>'revision')::bigint=9007199254740991)
      OR (operation='revoke' AND target->>'kind' <> 'delegation' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE target->>'kind' WHEN 'membership'
          THEN snapshot->'memberships' ELSE snapshot->'roles' END) t
        WHERE CASE WHEN target->>'kind'='membership' THEN t->>'subject' ELSE t->>'id' END = target->>'id'
          AND (t->>'revision')::bigint=9007199254740991)) THEN
      RAISE EXCEPTION 'Authority revision exhausted' USING ERRCODE='23514';
    END IF;
    expected_state := jsonb_set(expected_state,'{snapshot,revision}',to_jsonb(current_revision+1));
    IF operation='assign-role' THEN
      SELECT jsonb_agg(CASE WHEN m->>'subject'=payload->>'recipientSubject' THEN
        m || jsonb_build_object('revision',(m->>'revision')::bigint+1,'roleIds',
          CASE WHEN (m->'roleIds') ? (payload->>'roleId') THEN m->'roleIds'
            ELSE (m->'roleIds') || jsonb_build_array(payload->>'roleId') END) ELSE m END ORDER BY ord)
        INTO entries FROM jsonb_array_elements(snapshot->'memberships') WITH ORDINALITY AS a(m,ord);
      expected_state := jsonb_set(expected_state,'{snapshot,memberships}',entries);
    ELSIF operation='delegate' THEN
      IF (payload->>'expiresAt')::numeric NOT BETWEEN checked_ms+1 AND 9007199254740991
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->'delegations') d WHERE d->>'id'=p_request->>'operationId') THEN
        RAISE EXCEPTION 'Invalid new delegation' USING ERRCODE='23514';
      END IF;
      entry := jsonb_build_object('id',p_request->>'operationId','tenantId',tenant,'datasetId',dataset::text,
        'issuerSubject',actor,'recipientSubject',payload->>'recipientSubject','capability',payload->>'capability',
        'sourceRoleId',source_role->>'id','sourceGrantId',source_grant->>'id','sourceRoleRevision',source_role->'revision',
        'issuerMembershipRevision',member->'revision','recipientMembershipRevision',recipient->'revision',
        'issuedAt',checked_ms,'expiresAt',payload->'expiresAt','status','active');
      expected_state := jsonb_set(expected_state,'{snapshot,delegations}',(snapshot->'delegations') || jsonb_build_array(entry));
    ELSE
      SELECT jsonb_agg(CASE WHEN
        CASE WHEN target->>'kind'='membership' THEN t->>'subject' ELSE t->>'id' END = target->>'id'
        THEN t || jsonb_build_object('status','revoked') ||
          CASE WHEN target->>'kind'='delegation' THEN '{}'::jsonb
            ELSE jsonb_build_object('revision',(t->>'revision')::bigint+1) END ELSE t END ORDER BY ord)
        INTO entries FROM jsonb_array_elements(CASE target->>'kind' WHEN 'membership' THEN snapshot->'memberships'
          WHEN 'role' THEN snapshot->'roles' ELSE snapshot->'delegations' END) WITH ORDINALITY AS a(t,ord);
      expected_state := jsonb_set(expected_state,ARRAY['snapshot',CASE target->>'kind'
        WHEN 'membership' THEN 'memberships' WHEN 'role' THEN 'roles' ELSE 'delegations' END],entries);
      expected_state := jsonb_set(expected_state,'{revocations}',(old_state->'revocations') ||
        jsonb_build_array(target || jsonb_build_object('operationId',p_request->>'operationId',
          'policyRevision',current_revision+1,'revokedAt',checked_ms)));
    END IF;
    IF p_next IS DISTINCT FROM expected_state THEN
      RAISE EXCEPTION 'Unauthorized authority transition' USING ERRCODE='42501';
    END IF;
    UPDATE empire_os_authorization.tenants SET state=expected_state,revision=current_revision+1 WHERE tenant_id=tenant;
  ELSIF p_next IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected authority transition' USING ERRCODE='23514';
  END IF;
  IF (p_evidence->>'resultingPolicyRevision')::bigint IS DISTINCT FROM
    current_revision + CASE WHEN allowed AND operation <> 'write' THEN 1 ELSE 0 END THEN
    RAISE EXCEPTION 'Incorrect resulting revision' USING ERRCODE='23514';
  END IF;
  INSERT INTO empire_os_authorization.audit
    (tenant_id,dataset_id,mapped_dataset_id,transaction_id,operation_id,decision_id,actor_subject,allowed,
      resulting_revision,evidence,applied_request,applied_request_sha256)
    VALUES (tenant,dataset,mapped,transaction_uuid,p_request->>'operationId',p_evidence->>'decisionId',actor,allowed,
      (p_evidence->>'resultingPolicyRevision')::bigint,p_evidence,p_request_text,
      encode(sha256(convert_to(p_request_text,'UTF8')),'hex'));
  IF allowed AND operation='write' THEN
    SELECT * INTO STRICT fence FROM empire_os_authorization.datasets WHERE tenant_id=tenant AND dataset_id=dataset;
    IF payload #>> '{fence,protocolVersion}' IS DISTINCT FROM '1'
      OR (payload #>> '{fence,generation}')::bigint IS DISTINCT FROM fence.generation
      OR (payload #>> '{fence,authorityRevision}')::bigint IS DISTINCT FROM fence.authority_revision
      OR payload->>'idempotencyKey' IS DISTINCT FROM p_request->>'operationId' THEN
      RAISE EXCEPTION 'Invalid preparation write fence or batch' USING ERRCODE='23514';
    END IF;
    FOR entry IN SELECT e FROM jsonb_array_elements((payload->'reads') || (payload->'writes')) e LOOP
      SELECT coalesce(max(w.revision),0) INTO actual_revision FROM empire_os_authorization.preparation_writes w
        WHERE w.tenant_id=tenant AND w.dataset_id=dataset AND w.store_key=entry->>'key';
      IF (entry->>'expectedRevision')::bigint IS DISTINCT FROM actual_revision THEN
        RAISE EXCEPTION 'Preparation store revision conflict' USING ERRCODE='23514';
      END IF;
    END LOOP;
    FOR entry IN SELECT e FROM jsonb_array_elements(payload->'writes') e LOOP
      INSERT INTO empire_os_authorization.preparation_writes
        (tenant_id,dataset_id,transaction_id,store_key,revision,raw_value)
        VALUES (tenant,dataset,transaction_uuid,entry->>'key',(entry->>'expectedRevision')::bigint+1,
          decode(entry->>'rawValueHex','hex'));
    END LOOP;
  END IF;
END;
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA empire_os_authorization FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA empire_os_authorization FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA empire_os_authorization REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA empire_os_authorization REVOKE ALL ON FUNCTIONS FROM PUBLIC;
COMMIT;
