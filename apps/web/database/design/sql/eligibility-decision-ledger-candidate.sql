-- INACTIVE DESIGN CANDIDATE ONLY. Never apply to a live or consumed database.
-- Requires the Phase 7 member-authority candidate. No runtime grants or issuer.
-- This ledger links decisions to EXISTING Person events, not another People store.
-- The insertion trigger deliberately REFUSES all writes until independently
-- authenticated decision persistence and historical issuer rules are approved.
-- Owner-written strings/references/xids are NOT historical authentication proof.
BEGIN;
DO $$
BEGIN
  IF to_regclass('empire_os_identity.person_authority_events') IS NULL
    OR current_user IS DISTINCT FROM (
      SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='empire_os_identity')
    OR to_regclass('empire_os_identity.eligibility_decisions') IS NOT NULL THEN
    RAISE EXCEPTION 'Eligibility ledger requires the existing identity owner and an uninstalled candidate'
      USING ERRCODE='55000';
  END IF;
END;
$$;

CREATE TABLE empire_os_identity.eligibility_decisions (
  version integer NOT NULL DEFAULT 1 CHECK (version=1),
  tenant_id text NOT NULL,
  person_id text NOT NULL,
  person_revision bigint NOT NULL CHECK (person_revision BETWEEN 1 AND 9007199254740991),
  operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$'),
  subject text NOT NULL CHECK (subject ~ '^user_[A-Za-z0-9_]+$' AND length(subject)<=512),
  issuer_subject text NOT NULL CHECK (issuer_subject ~ '^user_[A-Za-z0-9_]+$' AND length(issuer_subject)<=512),
  binding_id text NOT NULL CHECK (length(btrim(binding_id)) BETWEEN 1 AND 512),
  issuer_binding_id text NOT NULL CHECK (length(btrim(issuer_binding_id)) BETWEEN 1 AND 512),
  issuer_person_id text NOT NULL,
  issuer_person_revision bigint NOT NULL CHECK (issuer_person_revision BETWEEN 1 AND 9007199254740991),
  registry_revision bigint NOT NULL CHECK (registry_revision BETWEEN 1 AND 9007199254740991),
  binding_revision bigint NOT NULL CHECK (binding_revision BETWEEN 1 AND registry_revision),
  policy_revision bigint NOT NULL CHECK (policy_revision BETWEEN 1 AND 9007199254740991),
  issuer_membership_revision bigint NOT NULL CHECK (issuer_membership_revision BETWEEN 1 AND 9007199254740991),
  subject_membership_revision bigint NOT NULL CHECK (subject_membership_revision BETWEEN 1 AND 9007199254740991),
  authenticated_at_ms bigint NOT NULL CHECK (authenticated_at_ms BETWEEN 0 AND 9007199254740991),
  valid_until_ms bigint NOT NULL CHECK (valid_until_ms BETWEEN 1 AND 9007199254740991),
  authentication_reference text NOT NULL CHECK (length(btrim(authentication_reference)) BETWEEN 1 AND 512),
  issuer_authority_reference text NOT NULL CHECK (length(btrim(issuer_authority_reference)) BETWEEN 1 AND 512),
  decision text NOT NULL CHECK (decision IN ('issue','revoke')),
  event jsonb NOT NULL CHECK (jsonb_typeof(event)='object'),
  recorded_at_ms bigint NOT NULL CHECK (recorded_at_ms BETWEEN 0 AND 9007199254740991),
  database_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),
  PRIMARY KEY (tenant_id,operation_id),
  UNIQUE (tenant_id,person_id,person_revision),
  FOREIGN KEY (tenant_id,person_id,person_revision)
    REFERENCES empire_os_identity.person_authority_events(tenant_id,person_id,revision),
  FOREIGN KEY (tenant_id,issuer_person_id,issuer_person_revision)
    REFERENCES empire_os_identity.person_authority_events(tenant_id,person_id,revision),
  CHECK (subject<>issuer_subject AND person_id<>issuer_person_id AND binding_id<>issuer_binding_id),
  CHECK (valid_until_ms=authenticated_at_ms+300000 AND authenticated_at_ms<=recorded_at_ms
    AND recorded_at_ms<valid_until_ms),
  CHECK ((decision='issue' AND person_revision=1) OR (decision='revoke' AND person_revision>1))
);
ALTER TABLE empire_os_identity.eligibility_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE empire_os_identity.eligibility_decisions FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  EXECUTE format('CREATE POLICY trusted_api ON empire_os_identity.eligibility_decisions
    USING (current_user=%L) WITH CHECK (current_user=%L)',current_user,current_user);
END;
$$;
CREATE TRIGGER trusted_statement BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON empire_os_identity.eligibility_decisions FOR EACH STATEMENT
EXECUTE FUNCTION empire_os_identity.owner_statement();
CREATE TRIGGER immutable_eligibility_decision BEFORE UPDATE OR DELETE
ON empire_os_identity.eligibility_decisions FOR EACH ROW
EXECUTE FUNCTION empire_os_identity.reject_mutation();
CREATE TRIGGER no_eligibility_decision_truncate BEFORE TRUNCATE
ON empire_os_identity.eligibility_decisions FOR EACH STATEMENT
EXECUTE FUNCTION empire_os_identity.reject_mutation();

CREATE FUNCTION empire_os_identity.fence_eligibility_decision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE
  saved jsonb; tenant_state jsonb; tenant_revision bigint;
  person_event empire_os_identity.person_authority_events%ROWTYPE;
  bound empire_os_identity.active_bindings%ROWTYPE;
  issuer_bound empire_os_identity.active_bindings%ROWTYPE;
BEGIN
  -- Same order as identity and Person writers; never obtain a tenant lock first.
  SELECT registry INTO STRICT saved FROM empire_os_identity.identity_registry WHERE singleton FOR UPDATE;
  SELECT state,revision INTO STRICT tenant_state,tenant_revision
    FROM empire_os_authorization.tenants WHERE tenant_id=NEW.tenant_id FOR UPDATE;
  IF NEW.registry_revision IS DISTINCT FROM (saved->>'revision')::bigint
    OR NEW.binding_revision IS DISTINCT FROM (saved->>'bindingRevision')::bigint
    OR NEW.policy_revision IS DISTINCT FROM tenant_revision THEN
    RAISE EXCEPTION 'Stale eligibility decision authority' USING ERRCODE='40001';
  END IF;
  SELECT * INTO STRICT bound FROM empire_os_identity.active_bindings WHERE subject=NEW.subject;
  SELECT * INTO STRICT issuer_bound FROM empire_os_identity.active_bindings WHERE subject=NEW.issuer_subject;
  IF bound.binding_id IS DISTINCT FROM NEW.binding_id OR bound.person_id IS DISTINCT FROM NEW.person_id
    OR issuer_bound.binding_id IS DISTINCT FROM NEW.issuer_binding_id
    OR issuer_bound.person_id IS DISTINCT FROM NEW.issuer_person_id THEN
    RAISE EXCEPTION 'Eligibility decision binding changed' USING ERRCODE='42501';
  END IF;
  IF tenant_state #>> '{snapshot,tenant,status}' IS DISTINCT FROM 'active'
    OR NOT coalesce((tenant_state #> '{snapshot,tenant,ownerSubjects}') ? NEW.issuer_subject,false)
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(tenant_state #> '{snapshot,memberships}') m
      WHERE m->>'subject'=NEW.issuer_subject AND m->>'status'='active'
        AND m->>'tenantId'=NEW.tenant_id AND (m->>'revision')::bigint=NEW.issuer_membership_revision)
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(tenant_state #> '{snapshot,memberships}') m
      WHERE m->>'subject'=NEW.subject AND m->>'tenantId'=NEW.tenant_id
        AND (m->>'revision')::bigint=NEW.subject_membership_revision
        AND (NEW.decision='revoke' OR m->>'status'='active'))
    OR NOT EXISTS (SELECT 1 FROM empire_os_identity.identity_events e
      WHERE e.event_id=bound.event_id AND e.event->>'tenantId'=NEW.tenant_id
        AND e.event->>'subject'=NEW.subject AND e.event->>'personId'=NEW.person_id
        AND e.event->>'bindingId'=NEW.binding_id AND e.event->>'kind' IN ('subject-bound','binding-reassigned'))
    OR NOT EXISTS (SELECT 1 FROM empire_os_identity.identity_events e
      WHERE e.event_id=issuer_bound.event_id AND e.event->>'tenantId'=NEW.tenant_id
        AND e.event->>'subject'=NEW.issuer_subject AND e.event->>'personId'=NEW.issuer_person_id
        AND e.event->>'bindingId'=NEW.issuer_binding_id AND e.event->>'kind' IN ('subject-bound','binding-reassigned'))
    OR NOT EXISTS (SELECT 1 FROM empire_os_identity.person_authority_events p
      WHERE p.tenant_id=NEW.tenant_id AND p.person_id=NEW.issuer_person_id
        AND p.revision=NEW.issuer_person_revision AND p.status='active' AND p.kind='founder')
    OR EXISTS (SELECT 1 FROM empire_os_identity.person_authority_events p
      WHERE p.tenant_id=NEW.tenant_id AND
        ((p.person_id=NEW.person_id AND p.revision>NEW.person_revision)
         OR (p.person_id=NEW.issuer_person_id AND p.revision>NEW.issuer_person_revision))) THEN
    RAISE EXCEPTION 'Eligibility decision tenant, membership or Person evidence changed' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT person_event FROM empire_os_identity.person_authority_events
    WHERE tenant_id=NEW.tenant_id AND person_id=NEW.person_id AND revision=NEW.person_revision;
  -- Event and decision must be appended in ONE transaction. No backfill of old
  -- issuer claims and no caller-selected timestamp can establish authentication.
  IF person_event.database_transaction IS DISTINCT FROM pg_current_xact_id()
    OR NEW.database_transaction IS DISTINCT FROM pg_current_xact_id()
    OR person_event.operation_id IS DISTINCT FROM NEW.operation_id
    OR person_event.issuer_subject IS DISTINCT FROM NEW.issuer_subject
    OR person_event.kind<>'other'
    OR person_event.status IS DISTINCT FROM (CASE WHEN NEW.decision='issue' THEN 'active' ELSE 'inactive' END)
    OR NEW.event IS DISTINCT FROM jsonb_build_object(
      'tenantId',person_event.tenant_id,'personId',person_event.person_id,'revision',person_event.revision,
      'status',person_event.status,'kind',person_event.kind,'operationId',person_event.operation_id,
      'issuerSubject',person_event.issuer_subject,'sourceReference',person_event.source_reference,
      'evidenceSha256',person_event.evidence_sha256,'recordedAtMs',person_event.recorded_at_ms) THEN
    RAISE EXCEPTION 'Eligibility decision does not match exact event' USING ERRCODE='23514';
  END IF;
  NEW.recorded_at_ms := person_event.recorded_at_ms;
  -- Deliberate hard stop: no authenticated issuer writer/source is installed.
  -- Do not remove based on matching claims, schema ownership or catalog presence.
  RAISE EXCEPTION 'Authenticated eligibility decision persistence is unavailable' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER serialize_eligibility_decision BEFORE INSERT
ON empire_os_identity.eligibility_decisions FOR EACH ROW
EXECUTE FUNCTION empire_os_identity.fence_eligibility_decision();
REVOKE ALL ON TABLE empire_os_identity.eligibility_decisions FROM PUBLIC;
REVOKE ALL ON FUNCTION empire_os_identity.fence_eligibility_decision() FROM PUBLIC;
COMMIT;
