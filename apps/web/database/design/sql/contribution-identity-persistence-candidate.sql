-- DESIGN CANDIDATE ONLY: alternative to (NOT an upgrade of) the Phase 5 candidate.
-- Requires 001-004 on a NEW verified disposable database. No runtime grants.
-- The trusted authorization schema owner issues approved_operations out-of-band.
-- Restricted runtime roles can consume, but cannot issue, planner authorizations.
BEGIN;
DO $guard$
BEGIN
  IF to_regprocedure('empire_os_authorization.lookup_operation(text,text)') IS NULL
    OR to_regnamespace('empire_os_identity') IS NOT NULL
    OR current_user IS DISTINCT FROM (
      SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='empire_os_authorization'
    ) THEN
    RAISE EXCEPTION 'Identity persistence requires the authorization owner and a new isolated schema'
      USING ERRCODE='55000';
  END IF;
END;
$guard$;
CREATE SCHEMA empire_os_identity;
REVOKE ALL ON SCHEMA empire_os_identity FROM PUBLIC;

CREATE TABLE empire_os_identity.identity_registry (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  registry jsonb NOT NULL CHECK (coalesce(
    jsonb_typeof(registry)='object' AND registry->'version'='1'::jsonb
    AND registry - ARRAY['version','revision','bindingRevision','policyRevision','events']='{}'::jsonb
    AND jsonb_typeof(registry->'events')='array'
    AND empire_os_authorization.valid_counter(registry->'revision')
    AND empire_os_authorization.valid_counter(registry->'bindingRevision')
    AND empire_os_authorization.valid_counter(registry->'policyRevision')
    AND (registry->>'revision')::bigint=jsonb_array_length(registry->'events'),false
  ))
);
INSERT INTO empire_os_identity.identity_registry VALUES
  (true,'{"version":1,"revision":0,"bindingRevision":0,"policyRevision":0,"events":[]}');

CREATE TABLE empire_os_identity.approved_operations (
  operation_id text PRIMARY KEY CHECK (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$'),
  tenant_id text NOT NULL REFERENCES empire_os_authorization.tenants,
  actor_subject text NOT NULL CHECK (actor_subject ~ '^user_[A-Za-z0-9_]+$'),
  request_text text NOT NULL CHECK (jsonb_typeof(request_text::jsonb)='object'),
  request_sha256 text NOT NULL CHECK (request_sha256=encode(sha256(convert_to(request_text,'UTF8')),'hex')),
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan)='object'),
  -- Independent verifier provenance, not identity documents, credentials or client claims.
  verification jsonb NOT NULL CHECK (jsonb_typeof(verification)='object'),
  issuer_reference text NOT NULL CHECK (length(btrim(issuer_reference)) BETWEEN 1 AND 512),
  checked_at_ms bigint NOT NULL CHECK (checked_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms bigint NOT NULL CHECK (expires_at_ms > checked_at_ms AND expires_at_ms <= checked_at_ms+300000),
  CHECK (coalesce(request_text::jsonb->>'operationId'=operation_id,false)),
  CHECK (coalesce(request_text::jsonb->>'tenantId'=tenant_id,false)),
  CHECK (coalesce(plan->>'operationId'=operation_id AND plan->>'scopeTenantId'=tenant_id AND plan->>'actorSubject'=actor_subject,false)),
  CHECK (coalesce((plan #>> '{event,recordedAtMs}')::bigint=checked_at_ms,false))
);

CREATE TABLE empire_os_identity.identity_events (
  event_id text PRIMARY KEY CHECK (length(btrim(event_id)) BETWEEN 1 AND 512),
  operation_id text NOT NULL UNIQUE REFERENCES empire_os_identity.approved_operations,
  registry_revision bigint NOT NULL UNIQUE CHECK (registry_revision BETWEEN 1 AND 9007199254740991),
  event jsonb NOT NULL CHECK (jsonb_typeof(event)='object'),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object'),
  database_transaction xid8 NOT NULL UNIQUE DEFAULT pg_current_xact_id(),
  CHECK (coalesce(event->>'eventId'=event_id AND event->>'operationId'=operation_id,false)),
  CHECK (coalesce((event->>'sequence')::bigint=registry_revision,false))
);
CREATE UNIQUE INDEX one_use_per_identity_verification
  ON empire_os_identity.identity_events((event->>'verificationId'))
  WHERE event->>'kind' IN ('subject-bound','binding-reassigned');
CREATE TABLE empire_os_identity.session_revocations (
  event_id text NOT NULL REFERENCES empire_os_identity.identity_events,
  subject text NOT NULL CHECK (subject ~ '^user_[A-Za-z0-9_]+$'),
  PRIMARY KEY (event_id,subject)
);
CREATE TABLE empire_os_identity.active_bindings (
  binding_id text PRIMARY KEY CHECK (length(btrim(binding_id)) BETWEEN 1 AND 512),
  subject text NOT NULL UNIQUE CHECK (subject ~ '^user_[A-Za-z0-9_]+$' AND length(subject)<=512),
  person_id text NOT NULL UNIQUE CHECK (length(btrim(person_id)) BETWEEN 1 AND 512),
  event_id text NOT NULL REFERENCES empire_os_identity.identity_events
);
CREATE TABLE empire_os_identity.administrator_grants (
  grant_id text PRIMARY KEY CHECK (length(btrim(grant_id)) BETWEEN 1 AND 512),
  tenant_id text NOT NULL REFERENCES empire_os_authorization.tenants,
  subject text NOT NULL CHECK (subject ~ '^user_[A-Za-z0-9_]+$' AND length(subject)<=512),
  capabilities jsonb NOT NULL CHECK (jsonb_typeof(capabilities)='array' AND jsonb_array_length(capabilities)>0
    AND capabilities <@ '["bind","revoke","reassign","delegate","approve-reassignment","recover-founder"]'::jsonb),
  source text NOT NULL CHECK (source IN ('bootstrap','delegated')),
  revoked boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX one_active_identity_grant_per_tenant
  ON empire_os_identity.administrator_grants(tenant_id,subject) WHERE NOT revoked;

CREATE FUNCTION empire_os_identity.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Identity evidence is append-only' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER immutable_identity_events BEFORE UPDATE OR DELETE ON empire_os_identity.identity_events
FOR EACH ROW EXECUTE FUNCTION empire_os_identity.reject_mutation();
CREATE TRIGGER immutable_identity_approvals BEFORE UPDATE OR DELETE ON empire_os_identity.approved_operations
FOR EACH ROW EXECUTE FUNCTION empire_os_identity.reject_mutation();
CREATE TRIGGER no_identity_history_truncate BEFORE TRUNCATE ON empire_os_identity.identity_events
FOR EACH STATEMENT EXECUTE FUNCTION empire_os_identity.reject_mutation();
CREATE TRIGGER no_identity_approval_truncate BEFORE TRUNCATE ON empire_os_identity.approved_operations
FOR EACH STATEMENT EXECUTE FUNCTION empire_os_identity.reject_mutation();
CREATE TRIGGER immutable_session_revocations BEFORE UPDATE OR DELETE ON empire_os_identity.session_revocations
FOR EACH ROW EXECUTE FUNCTION empire_os_identity.reject_mutation();
CREATE TRIGGER no_session_revocation_truncate BEFORE TRUNCATE ON empire_os_identity.session_revocations
FOR EACH STATEMENT EXECUTE FUNCTION empire_os_identity.reject_mutation();

-- Defense against accidental DML grants, including statements matching zero rows.
CREATE FUNCTION empire_os_identity.owner_statement() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(nspowner)
      FROM pg_namespace WHERE nspname='empire_os_identity') THEN
    RAISE EXCEPTION 'Identity tables require trusted transaction API' USING ERRCODE='42501';
  END IF;
  RETURN NULL;
END;
$$;
DO $tables$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['identity_registry','approved_operations','identity_events','active_bindings','administrator_grants','session_revocations'] LOOP
    EXECUTE format('ALTER TABLE empire_os_identity.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE empire_os_identity.%I FORCE ROW LEVEL SECURITY',tab);
    EXECUTE format('CREATE POLICY trusted_api ON empire_os_identity.%I
      USING (current_user=%L) WITH CHECK (current_user=%L)',tab,current_user,current_user);
    EXECUTE format('CREATE TRIGGER trusted_statement BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
      ON empire_os_identity.%I FOR EACH STATEMENT EXECUTE FUNCTION empire_os_identity.owner_statement()',tab);
  END LOOP;
END;
$tables$;

-- Current membership is checked on EVERY read, including idempotent replay.
CREATE FUNCTION empire_os_identity.runtime_actor(p_tenant text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; runtime_role name;
BEGIN
  actor := empire_os_authorization.runtime_subject(p_tenant);
  runtime_role := CASE WHEN current_setting('role')='none' THEN session_user
    ELSE current_setting('role')::name END;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='empire_os_identity' AND (c.relowner=(SELECT oid FROM pg_roles WHERE rolname=runtime_role)
      OR (c.relkind IN ('r','p','v','m','f') AND (
        has_table_privilege(runtime_role,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_any_column_privilege(runtime_role,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))))
    OR has_schema_privilege(runtime_role,'empire_os_identity','CREATE') THEN
    RAISE EXCEPTION 'Unsafe identity database role' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM empire_os_authorization.tenants t,
      LATERAL jsonb_array_elements(t.state #> '{snapshot,memberships}') m
    WHERE t.tenant_id=p_tenant AND t.state #>> '{snapshot,tenant,status}'='active'
      AND m->>'subject'=actor AND m->>'status'='active'
  ) OR NOT EXISTS (
    SELECT 1 FROM empire_os_identity.administrator_grants g
    JOIN empire_os_identity.active_bindings b ON b.subject=g.subject
    WHERE g.tenant_id=p_tenant AND g.subject=actor AND NOT g.revoked
  ) THEN
    RAISE EXCEPTION 'Current identity administration authority required' USING ERRCODE='42501';
  END IF;
  RETURN actor;
END;
$$;
CREATE FUNCTION empire_os_identity.lock_operation(p_tenant text,p_operation text,p_digest text)
RETURNS TABLE(registry jsonb,actor_subject text,now_ms bigint,receipt jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; saved jsonb; approved empire_os_identity.approved_operations%ROWTYPE; stamp bigint;
BEGIN
  -- Single registry serializes identity transitions. The table lock also freezes
  -- membership discovery against existing provisioning paths that do not take it.
  SELECT r.registry INTO STRICT saved FROM empire_os_identity.identity_registry r WHERE singleton FOR UPDATE;
  LOCK TABLE empire_os_authorization.tenants IN SHARE ROW EXCLUSIVE MODE;
  PERFORM 1 FROM empire_os_authorization.tenants ORDER BY tenant_id FOR UPDATE;
  actor := empire_os_identity.runtime_actor(p_tenant);
  -- Phase 5 validates a complete GLOBAL history. Never disclose that history to
  -- a tenant-only administrator. Until a minimised global-uniqueness reader exists,
  -- this adapter requires explicit current authority in every represented tenant.
  IF EXISTS (
    SELECT 1 FROM (SELECT DISTINCT e->>'tenantId' AS tenant_id
      FROM jsonb_array_elements(saved->'events') e) scope
    WHERE NOT EXISTS (
      SELECT 1 FROM empire_os_identity.administrator_grants g
      JOIN empire_os_authorization.tenants t ON t.tenant_id=g.tenant_id,
      LATERAL jsonb_array_elements(t.state #> '{snapshot,memberships}') m
      WHERE g.tenant_id=scope.tenant_id AND g.subject=actor AND NOT g.revoked
        AND t.state #>> '{snapshot,tenant,status}'='active'
        AND m->>'subject'=actor AND m->>'status'='active'
    )
  ) THEN
    RAISE EXCEPTION 'Global identity history requires explicit authority in every represented tenant' USING ERRCODE='42501';
  END IF;
  stamp := floor(extract(epoch FROM clock_timestamp())*1000);
  SELECT a.* INTO approved FROM empire_os_identity.approved_operations a WHERE a.operation_id=p_operation;
  IF NOT FOUND OR approved.tenant_id<>p_tenant OR approved.actor_subject<>actor OR approved.request_sha256<>p_digest THEN
    RAISE EXCEPTION 'Identity operation unavailable or conflicting' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT saved,actor,
    CASE WHEN e.event_id IS NULL THEN approved.checked_at_ms ELSE stamp END,e.receipt
    FROM (SELECT 1) dummy LEFT JOIN empire_os_identity.identity_events e ON e.operation_id=p_operation;
  IF NOT EXISTS (SELECT 1 FROM empire_os_identity.identity_events WHERE operation_id=p_operation)
    AND (approved.checked_at_ms>stamp OR approved.expires_at_ms<=stamp) THEN
    RAISE EXCEPTION 'Identity approval expired' USING ERRCODE='40001';
  END IF;
END;
$$;

CREATE FUNCTION empire_os_identity.consume_operation(p_tenant text,p_operation text,p_request text,p_plan jsonb)
RETURNS TABLE(registry jsonb,receipt jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  locked record; approved empire_os_identity.approved_operations%ROWTYPE; prior jsonb; next_registry jsonb;
  ev jsonb; kind text; grant_entry jsonb; fence jsonb; target jsonb; tenant_row record; member jsonb;
  next_state jsonb; memberships jsonb; revocations jsonb; audit_request text; audit_hash text;
  audit_id uuid; audit_evidence jsonb; dataset uuid; stamp bigint; result_receipt jsonb;
  binding_delta bigint; policy_delta bigint; old_subject text; required_capability text;
BEGIN
  SELECT * INTO STRICT locked FROM empire_os_identity.lock_operation(
    p_tenant,p_operation,encode(sha256(convert_to(p_request,'UTF8')),'hex'));
  IF locked.receipt IS NOT NULL THEN
    RETURN QUERY SELECT locked.registry,locked.receipt;
    RETURN;
  END IF;
  SELECT * INTO STRICT approved FROM empire_os_identity.approved_operations WHERE operation_id=p_operation;
  -- No runtime role can choose a plan, approver, proof, timestamp or affected tenant.
  IF approved.request_text IS DISTINCT FROM p_request OR approved.plan IS DISTINCT FROM p_plan THEN
    RAISE EXCEPTION 'Identity approval does not match exact planner decision' USING ERRCODE='42501';
  END IF;
  prior := locked.registry;
  ev := p_plan->'event';
  kind := ev->>'kind';
  IF (prior->>'revision')::bigint IS DISTINCT FROM (p_plan->>'registryRevision')::bigint
    OR (prior->>'bindingRevision')::bigint IS DISTINCT FROM (p_plan->>'bindingRevision')::bigint
    OR (prior->>'policyRevision')::bigint IS DISTINCT FROM (p_plan->>'identityPolicyRevision')::bigint THEN
    RAISE EXCEPTION 'Stale identity revision' USING ERRCODE='40001';
  END IF;
  IF ev->>'actorSubject' IS DISTINCT FROM locked.actor_subject
    OR ev->>'tenantId' IS DISTINCT FROM p_tenant OR ev->>'operationId' IS DISTINCT FROM p_operation
    OR (ev->>'sequence')::bigint IS DISTINCT FROM (prior->>'revision')::bigint+1
    OR ev->>'previousEventId' IS DISTINCT FROM prior #>> ARRAY['events',(jsonb_array_length(prior->'events')-1)::text,'eventId']
    OR kind IS NULL OR kind NOT IN ('subject-bound','binding-revoked','binding-reassigned','administrator-granted','administrator-revoked') THEN
    RAISE EXCEPTION 'Invalid identity event chain' USING ERRCODE='23514';
  END IF;
  required_capability := CASE kind WHEN 'subject-bound' THEN 'bind' WHEN 'binding-revoked' THEN 'revoke'
    WHEN 'binding-reassigned' THEN 'reassign' ELSE 'delegate' END;
  FOR fence IN SELECT f FROM jsonb_array_elements(p_plan->'tenantPolicyRevisions') f LOOP
    IF NOT EXISTS (SELECT 1 FROM empire_os_authorization.tenants t
      WHERE t.tenant_id=fence->>'tenantId' AND t.revision=(fence->>'revision')::bigint
        AND t.state #>> '{snapshot,tenant,status}'='active')
      OR NOT EXISTS (SELECT 1 FROM empire_os_identity.administrator_grants g
        WHERE g.tenant_id=fence->>'tenantId' AND g.subject=locked.actor_subject AND NOT g.revoked
          AND g.capabilities ? required_capability) THEN
      RAISE EXCEPTION 'Identity tenant policy or permission changed' USING ERRCODE='40001';
    END IF;
  END LOOP;
  IF kind='binding-reassigned' OR (kind='binding-revoked' AND ev->>'approvedBySubject' IS NOT NULL) THEN
    IF ev->>'approvedBySubject' IN (locked.actor_subject,ev->>'subject',ev->>'previousSubject')
      OR ev->>'approvedBySubject' IS NULL THEN
      RAISE EXCEPTION 'Independent identity approval required' USING ERRCODE='42501';
    END IF;
    FOR fence IN SELECT f FROM jsonb_array_elements(p_plan->'tenantPolicyRevisions') f LOOP
      IF NOT EXISTS (SELECT 1 FROM empire_os_identity.administrator_grants g
        JOIN empire_os_identity.active_bindings b ON b.subject=g.subject
        JOIN empire_os_authorization.tenants t ON t.tenant_id=g.tenant_id,
        LATERAL jsonb_array_elements(t.state #> '{snapshot,memberships}') m
        WHERE g.tenant_id=fence->>'tenantId' AND g.subject=ev->>'approvedBySubject'
          AND NOT g.revoked AND g.capabilities ? 'approve-reassignment'
          AND m->>'subject'=g.subject AND m->>'status'='active') THEN
        RAISE EXCEPTION 'Approver authority changed' USING ERRCODE='42501';
      END IF;
    END LOOP;
  END IF;
  IF kind IN ('subject-bound','binding-reassigned') AND (
    approved.verification->>'verificationId' IS DISTINCT FROM ev->>'verificationId'
    OR approved.verification->>'tenantId' IS DISTINCT FROM p_tenant
    OR approved.verification->>'subject' IS DISTINCT FROM ev->>'subject'
    OR approved.verification->>'personId' IS DISTINCT FROM ev->>'personId'
    OR approved.verification->>'verifiedAtMs' IS DISTINCT FROM ev->>'verifiedAtMs'
    OR approved.verification->>'evidenceSha256' IS NULL
    OR approved.verification->>'evidenceSha256' !~ '^[a-f0-9]{64}$'
    OR approved.verification->>'verifierReference' IS NULL
    OR approved.verification->>'verifiedBySubject' IS NULL
    OR approved.verification->>'verifiedBySubject' !~ '^user_[A-Za-z0-9_]+$'
    OR approved.verification->>'verifiedBySubject'=ev->>'subject'
  ) THEN
    RAISE EXCEPTION 'Independent identity proof missing' USING ERRCODE='42501';
  END IF;
  old_subject := CASE kind WHEN 'binding-revoked' THEN ev->>'subject'
    WHEN 'binding-reassigned' THEN ev->>'previousSubject' ELSE NULL END;
  IF EXISTS (
    SELECT 1 FROM empire_os_authorization.tenants t,
      LATERAL jsonb_array_elements(t.state #> '{snapshot,memberships}') m
    WHERE m->>'status'='active' AND (m->>'subject'=old_subject OR m->>'subject'=ev->>'subject')
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_plan->'tenantPolicyRevisions') f
        WHERE f->>'tenantId'=t.tenant_id)
  ) AND kind IN ('subject-bound','binding-revoked','binding-reassigned') THEN
    RAISE EXCEPTION 'Identity membership scope changed' USING ERRCODE='40001';
  END IF;
  -- Complete affected membership set, not merely the tenant the caller selected.
  IF old_subject IS NOT NULL AND EXISTS (
    SELECT 1 FROM empire_os_authorization.tenants t,
      LATERAL jsonb_array_elements(t.state #> '{snapshot,memberships}') m
    WHERE m->>'subject'=old_subject AND m->>'status'='active' AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_plan->'membershipRevocations') v
      WHERE v->>'tenantId'=t.tenant_id AND v->>'subject'=old_subject
        AND (v->>'expectedMembershipRevision')::bigint=(m->>'revision')::bigint
    )
  ) THEN
    RAISE EXCEPTION 'Incomplete identity membership fence' USING ERRCODE='40001';
  END IF;
  stamp := floor(extract(epoch FROM clock_timestamp())*1000);
  FOR target IN SELECT v FROM jsonb_array_elements(p_plan->'membershipRevocations') v ORDER BY v->>'tenantId' LOOP
    SELECT * INTO STRICT tenant_row FROM empire_os_authorization.tenants WHERE tenant_id=target->>'tenantId';
    SELECT m INTO STRICT member FROM jsonb_array_elements(tenant_row.state #> '{snapshot,memberships}') m
      WHERE m->>'subject'=target->>'subject' AND m->>'status'='active';
    IF target->>'subject' IS DISTINCT FROM old_subject
      OR (member->>'revision')::bigint IS DISTINCT FROM (target->>'expectedMembershipRevision')::bigint THEN
      RAISE EXCEPTION 'Stale identity membership' USING ERRCODE='40001';
    END IF;
    SELECT jsonb_agg(CASE WHEN m->>'subject'=old_subject THEN
      m || jsonb_build_object('status','revoked','roleIds','[]'::jsonb,'revision',(m->>'revision')::bigint+1)
      ELSE m END ORDER BY ordinal) INTO memberships
      FROM jsonb_array_elements(tenant_row.state #> '{snapshot,memberships}') WITH ORDINALITY x(m,ordinal);
    revocations := tenant_row.state->'revocations' || jsonb_build_array(jsonb_build_object(
      'kind','membership','id',old_subject,'operationId',p_operation,
      'policyRevision',tenant_row.revision+1,'revokedAt',stamp));
    next_state := jsonb_set(jsonb_set(jsonb_set(tenant_row.state,'{snapshot,memberships}',memberships),
      '{snapshot,revision}',to_jsonb(tenant_row.revision+1)),'{revocations}',revocations);
    UPDATE empire_os_authorization.tenants SET state=next_state,revision=tenant_row.revision+1
      WHERE tenant_id=tenant_row.tenant_id;
    SELECT dataset_id INTO STRICT dataset FROM empire_os_authorization.datasets
      WHERE tenant_id=tenant_row.tenant_id ORDER BY dataset_id LIMIT 1;
    audit_id := gen_random_uuid();
    audit_request := jsonb_build_object('kind','identity-membership-revocation','operationId',p_operation,
      'identityEventId',ev->>'eventId','tenantId',tenant_row.tenant_id,'subject',old_subject)::text;
    audit_hash := encode(sha256(convert_to(audit_request,'UTF8')),'hex');
    audit_evidence := jsonb_build_object('version',1,'transactionId',audit_id::text,
      'tenantId',tenant_row.tenant_id,'datasetId',dataset::text,'operationId',p_operation,
      'decisionId',encode(sha256(convert_to(audit_id::text,'UTF8')),'hex'),
      'actorSubject',locked.actor_subject,'resultingPolicyRevision',tenant_row.revision+1,
      'requestSha256',audit_hash,'operation','revoke','checkedAt',stamp,'completedAt',stamp,
      'decision',jsonb_build_object('status','allowed','policyVersion',1,'observedPolicyRevision',tenant_row.revision,
        'reason','identity-registry-revocation'),'identityEventId',ev->>'eventId');
    INSERT INTO empire_os_authorization.audit(transaction_id,tenant_id,dataset_id,mapped_dataset_id,
      applied_request,applied_request_sha256,operation_id,decision_id,actor_subject,allowed,resulting_revision,evidence)
    VALUES(audit_id,tenant_row.tenant_id,dataset,dataset,audit_request,audit_hash,p_operation,
      audit_evidence->>'decisionId',locked.actor_subject,true,tenant_row.revision+1,audit_evidence);
  END LOOP;
  binding_delta := CASE WHEN kind IN ('subject-bound','binding-revoked','binding-reassigned') THEN 1 ELSE 0 END;
  policy_delta := CASE WHEN kind IN ('administrator-granted','administrator-revoked') THEN 1
    ELSE coalesce(jsonb_array_length(ev->'revokedAdministratorGrantIds'),0) END;
  next_registry := jsonb_build_object('version',1,'revision',(prior->>'revision')::bigint+1,
    'bindingRevision',(prior->>'bindingRevision')::bigint+binding_delta,
    'policyRevision',(prior->>'policyRevision')::bigint+policy_delta,
    'events',prior->'events'||jsonb_build_array(ev));
  result_receipt := jsonb_build_object('operationId',p_operation,'eventId',ev->>'eventId',
    'registryRevision',(next_registry->>'revision')::bigint,'requestSha256',approved.request_sha256,
    'actorSubject',locked.actor_subject,'tenantId',p_tenant,
    'requiresSessionRevocation',p_plan->'requiresSessionRevocation');
  INSERT INTO empire_os_identity.identity_events VALUES
    (ev->>'eventId',p_operation,(next_registry->>'revision')::bigint,ev,result_receipt,pg_current_xact_id());
  IF p_plan->>'requiresSessionRevocation'='true' THEN
    INSERT INTO empire_os_identity.session_revocations VALUES
      (ev->>'eventId',coalesce(old_subject,ev->>'subject'));
  END IF;
  IF old_subject IS NOT NULL THEN
    DELETE FROM empire_os_identity.active_bindings WHERE subject=old_subject;
    UPDATE empire_os_identity.administrator_grants SET revoked=true WHERE subject=old_subject AND NOT revoked;
  END IF;
  IF kind IN ('subject-bound','binding-reassigned') THEN
    INSERT INTO empire_os_identity.active_bindings VALUES
      (ev->>'bindingId',ev->>'subject',ev->>'personId',ev->>'eventId');
  ELSIF kind='administrator-granted' THEN
    IF NOT EXISTS (SELECT 1 FROM empire_os_identity.administrator_grants g WHERE g.tenant_id=p_tenant
      AND g.subject=locked.actor_subject AND NOT g.revoked AND g.capabilities @> (ev->'capabilities')) THEN
      RAISE EXCEPTION 'Delegation exceeds current authority' USING ERRCODE='42501';
    END IF;
    INSERT INTO empire_os_identity.administrator_grants VALUES
      (ev->>'grantId',p_tenant,ev->>'subject',ev->'capabilities','delegated',false);
  ELSIF kind='administrator-revoked' THEN
    UPDATE empire_os_identity.administrator_grants SET revoked=true WHERE grant_id=ev->>'grantId'
      AND tenant_id=p_tenant AND source='delegated' AND NOT revoked;
    IF NOT FOUND THEN RAISE EXCEPTION 'Delegated grant unavailable' USING ERRCODE='40001'; END IF;
  END IF;
  UPDATE empire_os_identity.identity_registry SET registry=next_registry WHERE singleton;
  RETURN QUERY SELECT next_registry,result_receipt;
END;
$$;

-- Deferred expiry check covers COMMIT, including time spent after the last query.
CREATE FUNCTION empire_os_identity.check_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM empire_os_identity.approved_operations a
    WHERE a.operation_id=NEW.operation_id
      AND a.expires_at_ms>floor(extract(epoch FROM clock_timestamp())*1000)) THEN
    RAISE EXCEPTION 'Identity authority expired before completion' USING ERRCODE='40001';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER identity_completion AFTER INSERT ON empire_os_identity.identity_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION empire_os_identity.check_completion();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA empire_os_identity FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA empire_os_identity FROM PUBLIC;
COMMIT;
