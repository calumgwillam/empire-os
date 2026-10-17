-- INACTIVE, ROLLBACK-ONLY READER CANDIDATE. Not a migration or release approval.
-- Requires Phase 6 identity persistence, Phase 7 member authority and the Phase 8
-- eligibility ledger on a NEW disposable database. No grants, writes, credentials
-- or Person bootstrap. Do not apply to live or previously consumed databases.
-- This reader exposes stored claims for consistency checks, NOT authentic issuance.
-- The decision-ledger insertion stop and independent provenance gate remain intact.
BEGIN;
DO $$
BEGIN
  IF to_regclass('empire_os_identity.eligibility_decisions') IS NULL
    OR to_regprocedure('empire_os_identity.member_authority_ready()') IS NULL
    OR current_user IS DISTINCT FROM (
      SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='empire_os_identity') THEN
    RAISE EXCEPTION 'Founder preflight requires the existing eligibility ledger owner' USING ERRCODE='55000';
  END IF;
END;
$$;

CREATE FUNCTION empire_os_identity.lock_founder_eligibility_decision(
  p_tenant text,p_subject text,p_person text,p_operation text)
RETURNS TABLE(registry jsonb,state jsonb,policy_revision bigint,actor_subject text,
  binding_id text,issuer_binding_id text,person_id text,issuer_person_id text,now_ms bigint,
  issuer_event jsonb,target_event jsonb,operation_record jsonb,operation_used boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  saved jsonb; tenant_state jsonb; tenant_revision bigint; actor text; scope text;
  issuer_person text; target_person text; issuer_binding text; target_binding text;
  issuer jsonb; target jsonb; prior jsonb;
BEGIN
  -- Match the Phase 6 global-history reader's locks and disclosure restriction.
  SELECT r.registry INTO STRICT saved
    FROM empire_os_identity.identity_registry r WHERE singleton FOR UPDATE;
  LOCK TABLE empire_os_authorization.tenants IN SHARE ROW EXCLUSIVE MODE;
  PERFORM 1 FROM empire_os_authorization.tenants ORDER BY tenant_id FOR UPDATE;
  actor := empire_os_identity.runtime_actor(p_tenant);
  FOR scope IN SELECT DISTINCT e->>'tenantId' FROM jsonb_array_elements(saved->'events') e LOOP
    IF empire_os_identity.runtime_actor(scope) IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'Global identity history authority changed' USING ERRCODE='42501';
    END IF;
  END LOOP;
  IF NOT empire_os_identity.member_authority_ready() THEN
    RAISE EXCEPTION 'Member authority contract unavailable' USING ERRCODE='55000';
  END IF;
  SELECT t.state,t.revision INTO STRICT tenant_state,tenant_revision
    FROM empire_os_authorization.tenants t WHERE t.tenant_id=p_tenant;
  IF tenant_state #>> '{snapshot,tenant,status}' IS DISTINCT FROM 'active'
    OR NOT coalesce((tenant_state #> '{snapshot,tenant,ownerSubjects}') ? actor,false)
    OR p_subject IS NOT DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Founder tenant ownership required' USING ERRCODE='42501';
  END IF;
  SELECT b.person_id,b.binding_id INTO STRICT issuer_person,issuer_binding
    FROM empire_os_identity.active_bindings b WHERE b.subject=actor;
  SELECT b.person_id,b.binding_id INTO STRICT target_person,target_binding
    FROM empire_os_identity.active_bindings b WHERE b.subject=p_subject;
  IF target_person IS DISTINCT FROM p_person OR target_person=issuer_person
    OR NOT EXISTS (SELECT 1 FROM empire_os_identity.active_bindings b
      JOIN empire_os_identity.identity_events e ON e.event_id=b.event_id
      WHERE b.subject=p_subject AND e.event->>'tenantId'=p_tenant
        AND e.event->>'personId'=p_person AND e.event->>'subject'=p_subject
        AND e.event->>'bindingId'=b.binding_id)
    OR NOT EXISTS (SELECT 1 FROM empire_os_identity.active_bindings b
      JOIN empire_os_identity.identity_events e ON e.event_id=b.event_id
      WHERE b.subject=actor AND e.event->>'tenantId'=p_tenant
        AND e.event->>'personId'=issuer_person AND e.event->>'subject'=actor
        AND e.event->>'bindingId'=b.binding_id) THEN
    RAISE EXCEPTION 'Founder decision binding unavailable' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'tenantId',p.tenant_id,'personId',p.person_id,'revision',p.revision,
    'status',p.status,'kind',p.kind,'operationId',p.operation_id,
    'issuerSubject',p.issuer_subject,'sourceReference',p.source_reference,
    'evidenceSha256',p.evidence_sha256,'recordedAtMs',p.recorded_at_ms)
    INTO issuer FROM empire_os_identity.person_authority_events p
    WHERE p.tenant_id=p_tenant AND p.person_id=issuer_person ORDER BY p.revision DESC LIMIT 1;
  SELECT jsonb_build_object(
    'tenantId',p.tenant_id,'personId',p.person_id,'revision',p.revision,
    'status',p.status,'kind',p.kind,'operationId',p.operation_id,
    'issuerSubject',p.issuer_subject,'sourceReference',p.source_reference,
    'evidenceSha256',p.evidence_sha256,'recordedAtMs',p.recorded_at_ms)
    INTO target FROM empire_os_identity.person_authority_events p
    WHERE p.tenant_id=p_tenant AND p.person_id=p_person ORDER BY p.revision DESC LIMIT 1;
  SELECT jsonb_build_object(
    'version',d.version,'subject',d.subject,'bindingId',d.binding_id,'issuerBindingId',d.issuer_binding_id,
    'issuerPersonId',d.issuer_person_id,'issuerPersonRevision',d.issuer_person_revision,
    'registryRevision',d.registry_revision,'bindingRevision',d.binding_revision,'policyRevision',d.policy_revision,
    'issuerMembershipRevision',d.issuer_membership_revision,'subjectMembershipRevision',d.subject_membership_revision,
    'authenticatedAtMs',d.authenticated_at_ms,'validUntilMs',d.valid_until_ms,
    'authenticationReference',d.authentication_reference,'issuerAuthorityReference',d.issuer_authority_reference,
    'decision',d.decision,'event',d.event)
    INTO prior FROM empire_os_identity.eligibility_decisions d
    WHERE d.tenant_id=p_tenant AND d.operation_id=p_operation;
  RETURN QUERY SELECT saved,tenant_state,tenant_revision,actor,target_binding,issuer_binding,target_person,issuer_person,
    floor(extract(epoch FROM clock_timestamp())*1000)::bigint,
    issuer,target,prior,
    prior IS NOT NULL OR EXISTS (SELECT 1 FROM empire_os_identity.person_authority_events p
      WHERE p.tenant_id=p_tenant AND p.operation_id=p_operation)
    OR EXISTS (SELECT 1 FROM empire_os_identity.identity_events e WHERE e.operation_id=p_operation);
END;
$$;
REVOKE ALL ON FUNCTION empire_os_identity.lock_founder_eligibility_decision(text,text,text,text) FROM PUBLIC;
COMMIT;
