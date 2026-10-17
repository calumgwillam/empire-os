-- INACTIVE DESIGN CANDIDATE ONLY. Not a migration or deployment entry point.
-- Requires 001-004 and the Phase 6 identity persistence candidate on a NEW
-- disposable database. No grants, bootstrap records or browser-data import.
--
-- This establishes database eligibility evidence and compatible locks, NOT an
-- installed People verifier/issuer. The trusted identity schema owner must verify
-- existing Person IDs, independently establish issuer provenance and append an
-- eligibility event with the next revision in its own transaction. Empty/missing
-- eligibility is denied. No operational Person data is inferred or copied.
-- A repeated operation_id is rejected; a future issuer must reconcile its exact
-- original event after an uncertain commit, never blindly resubmit it.
--
-- Fresh disposable PostgreSQL verification still required (not performed here):
-- * Parse/apply 001-004, Phase 6, then THIS candidate once as the shared owner;
--   explicitly provision isolated fixture roles/data, never reuse an old database.
-- * With two connections, hold a member observation transaction open. Verify
--   binding revoke/reassign, Person inactive append, role binding changes and
--   tenant membership/role/delegation changes block until it rolls back. Reverse
--   the ordering and verify the waiting reader sees the committed revocation.
-- * Verify absent/inactive People, missing/ambiguous binding, wrong role/tenant,
--   and expired/revoked grants disclose no identity history or business values.
-- * Verify RLS, ACLs, unique constraints, statement/row triggers, owner/search_path
--   checks, disabled-trigger denial and lock/statement timeout rollback behaviour.
-- * Verify eligibility event append/revision conflicts, immutable audit evidence,
--   rollback and exact-event reconciliation after interrupted issuer COMMIT.
-- * Verify real driver/TLS restricted leases, clock expiry, aborted transactions,
--   connection loss and unconfirmed rollback discard observations without retries.
-- A returned observation is historical only; it cannot authorize later operations.
-- Business write/audit/idempotency/reconciliation integration remains unimplemented.
-- Phase 8 extends the locked result with this Person's exact eligibility audit
-- fields. These are stored claims, NOT historical issuer authentication. The
-- server adapter must refuse approval until independent provenance is implemented.
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('empire_os_identity.lock_operation(text,text,text)') IS NULL
    OR to_regprocedure('empire_os_authorization.read_dataset_snapshot(text,uuid)') IS NULL
    OR current_user IS DISTINCT FROM (
      SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='empire_os_identity')
    OR (SELECT nspowner FROM pg_namespace WHERE nspname='empire_os_identity')
      IS DISTINCT FROM (SELECT nspowner FROM pg_namespace WHERE nspname='empire_os_authorization') THEN
    RAISE EXCEPTION 'Member authority requires the Phase 6 identity owner and snapshot API' USING ERRCODE='55000';
  END IF;
  IF to_regclass('empire_os_identity.person_authority_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Member authority candidate was already installed' USING ERRCODE='55000';
  END IF;
END;
$$;

-- Minimal authentication eligibility for existing Person IDs, not a second People
-- directory or a membership/permission model. Each row IS its immutable audit event.
-- Only the trusted schema owner may attest verified Person eligibility. There is
-- deliberately no runtime writer, self-registration API or inferred bootstrap.
CREATE TABLE empire_os_identity.person_authority_events (
  tenant_id text NOT NULL REFERENCES empire_os_authorization.tenants,
  person_id text NOT NULL CHECK (length(person_id) BETWEEN 1 AND 512
    AND person_id=btrim(person_id) AND person_id !~ '[[:cntrl:]]'),
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  status text NOT NULL CHECK (status IN ('active','inactive')),
  kind text NOT NULL CHECK (kind IN ('founder','system-owner','other')),
  operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$'),
  issuer_subject text NOT NULL CHECK (issuer_subject ~ '^user_[A-Za-z0-9_]+$'
    AND length(issuer_subject)<=512),
  source_reference text NOT NULL CHECK (length(btrim(source_reference)) BETWEEN 1 AND 512),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at_ms bigint NOT NULL,
  database_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),
  PRIMARY KEY (tenant_id,person_id,revision),
  UNIQUE (tenant_id,operation_id),
  CHECK (recorded_at_ms BETWEEN 0 AND 9007199254740991)
);
ALTER TABLE empire_os_identity.person_authority_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE empire_os_identity.person_authority_events FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  EXECUTE format('CREATE POLICY trusted_api ON empire_os_identity.person_authority_events
    USING (current_user=%L) WITH CHECK (current_user=%L)',current_user,current_user);
END;
$$;
CREATE TRIGGER trusted_statement BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON empire_os_identity.person_authority_events FOR EACH STATEMENT
EXECUTE FUNCTION empire_os_identity.owner_statement();
CREATE TRIGGER immutable_person_authority BEFORE UPDATE OR DELETE
ON empire_os_identity.person_authority_events FOR EACH ROW
EXECUTE FUNCTION empire_os_identity.reject_mutation();
CREATE TRIGGER no_person_authority_truncate BEFORE TRUNCATE
ON empire_os_identity.person_authority_events FOR EACH STATEMENT
EXECUTE FUNCTION empire_os_identity.reject_mutation();

CREATE FUNCTION empire_os_identity.fence_person_authority() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE previous_revision bigint; stamp bigint;
BEGIN
  -- Same order as Phase 6: registry first, then tenant. Registry serializes
  -- eligibility changes even when no previous Person eligibility row exists.
  PERFORM 1 FROM empire_os_identity.identity_registry WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Identity registry unavailable' USING ERRCODE='55000'; END IF;
  PERFORM 1 FROM empire_os_authorization.tenants WHERE tenant_id=NEW.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tenant authority unavailable' USING ERRCODE='42501'; END IF;
  SELECT coalesce(max(revision),0) INTO previous_revision
    FROM empire_os_identity.person_authority_events
    WHERE tenant_id=NEW.tenant_id AND person_id=NEW.person_id;
  IF NEW.revision<>previous_revision+1 OR NEW.database_transaction<>pg_current_xact_id() THEN
    RAISE EXCEPTION 'Stale Person authority revision' USING ERRCODE='40001';
  END IF;
  stamp := floor(extract(epoch FROM clock_timestamp())*1000);
  NEW.recorded_at_ms := stamp;
  RETURN NEW;
END;
$$;
CREATE TRIGGER serialize_person_authority BEFORE INSERT
ON empire_os_identity.person_authority_events FOR EACH ROW
EXECUTE FUNCTION empire_os_identity.fence_person_authority();

-- Also fence privileged projection maintenance, not just the existing approved
-- consume_operation path. No writer may change a binding behind a held registry lock.
CREATE FUNCTION empire_os_identity.fence_member_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  PERFORM 1 FROM empire_os_identity.identity_registry WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Identity registry unavailable' USING ERRCODE='55000'; END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER serialize_member_identity BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON empire_os_identity.active_bindings FOR EACH STATEMENT
EXECUTE FUNCTION empire_os_identity.fence_member_identity();
CREATE TRIGGER serialize_member_history BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON empire_os_identity.identity_events FOR EACH STATEMENT
EXECUTE FUNCTION empire_os_identity.fence_member_identity();

CREATE FUNCTION empire_os_identity.member_authority_ready() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT
    (SELECT count(*)=4 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='empire_os_identity'
        AND c.relname IN ('person_authority_events','identity_registry','active_bindings','identity_events')
        AND c.relowner=n.nspowner AND c.relrowsecurity AND c.relforcerowsecurity)
    AND (SELECT count(*)=3 FROM pg_constraint c JOIN pg_index i ON i.indexrelid=c.conindid
      WHERE c.conrelid=to_regclass('empire_os_identity.active_bindings') AND c.contype IN ('p','u')
        AND c.convalidated AND i.indisvalid AND i.indisunique
        AND c.conname IN ('active_bindings_pkey','active_bindings_subject_key','active_bindings_person_id_key'))
    AND (SELECT count(*)=2 FROM pg_constraint c JOIN pg_index i ON i.indexrelid=c.conindid
      WHERE c.conrelid=to_regclass('empire_os_identity.person_authority_events')
        AND c.contype IN ('p','u') AND c.convalidated AND i.indisvalid AND i.indisunique)
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('empire_os_identity.person_authority_events','serialize_person_authority',
          'empire_os_identity.fence_person_authority()',7),
        ('empire_os_identity.person_authority_events','immutable_person_authority',
          'empire_os_identity.reject_mutation()',27),
        ('empire_os_identity.person_authority_events','no_person_authority_truncate',
          'empire_os_identity.reject_mutation()',34),
        ('empire_os_identity.person_authority_events','trusted_statement',
          'empire_os_identity.owner_statement()',62),
        ('empire_os_identity.active_bindings','serialize_member_identity',
          'empire_os_identity.fence_member_identity()',62),
        ('empire_os_identity.identity_events','serialize_member_history',
          'empire_os_identity.fence_member_identity()',62),
        ('empire_os_identity.identity_events','immutable_identity_events',
          'empire_os_identity.reject_mutation()',27),
        ('empire_os_identity.identity_events','no_identity_history_truncate',
          'empire_os_identity.reject_mutation()',34),
        ('empire_os_identity.identity_events','trusted_statement',
          'empire_os_identity.owner_statement()',62),
        ('empire_os_identity.active_bindings','trusted_statement',
          'empire_os_identity.owner_statement()',62),
        ('empire_os_identity.identity_registry','trusted_statement',
          'empire_os_identity.owner_statement()',62),
        ('empire_os_authorization.role_tenants','serialize_binding',
          'empire_os_authorization.lock_tenant()',31)
      ) required(table_name,trigger_name,function_name,trigger_type)
      WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid=to_regclass(required.table_name) AND t.tgname=required.trigger_name
          AND t.tgfoid=to_regprocedure(required.function_name) AND t.tgtype=required.trigger_type
          AND t.tgenabled IN ('O','A')))
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('empire_os_identity.lock_member_authority(text,uuid)',true),
        ('empire_os_identity.member_authority_ready()',true),
        ('empire_os_identity.fence_person_authority()',false),
        ('empire_os_identity.fence_member_identity()',false),
        ('empire_os_authorization.read_dataset_snapshot(text,uuid)',true)
      ) required(function_name,definer)
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE p.oid=to_regprocedure(required.function_name)
          AND p.proowner=n.nspowner AND p.prosecdef=required.definer
          AND n.nspowner=(SELECT nspowner FROM pg_namespace WHERE nspname='empire_os_authorization')
          AND p.proconfig @> ARRAY['search_path=pg_catalog']
          AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
            WHERE a.grantee=0 AND a.privilege_type='EXECUTE')))
$$;

CREATE FUNCTION empire_os_identity.lock_member_authority(p_tenant text,p_dataset uuid)
RETURNS TABLE(actor_subject text,binding_id text,person_id text,
  registry_revision bigint,binding_revision bigint,person_revision bigint,
  person_status text,person_kind text,state jsonb,revision bigint,
  decision jsonb,checked_at bigint,eligibility_event jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  actor text; initial_actor text; saved jsonb; bound empire_os_identity.active_bindings%ROWTYPE;
  person_event empire_os_identity.person_authority_events%ROWTYPE;
  snapshot record; runtime_role name; last_event jsonb;
BEGIN
  -- Do not use runtime_actor: ordinary members are not identity administrators.
  actor := empire_os_authorization.runtime_subject(p_tenant);
  initial_actor := actor;
  runtime_role := CASE WHEN current_setting('role')='none' THEN session_user
    ELSE current_setting('role')::name END;
  IF has_schema_privilege(runtime_role,'empire_os_identity','CREATE') OR EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='empire_os_identity' AND
      (c.relowner=(SELECT oid FROM pg_roles WHERE rolname=runtime_role)
       OR (c.relkind IN ('r','p','v','m','f') AND (
         has_any_column_privilege(runtime_role,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
         OR has_table_privilege(runtime_role,c.oid,'DELETE,TRUNCATE'))))
  ) THEN
    RAISE EXCEPTION 'Member authority unavailable' USING ERRCODE='42501';
  END IF;
  SELECT r.registry INTO STRICT saved FROM empire_os_identity.identity_registry r WHERE singleton FOR UPDATE;
  -- Keep trigger/index DDL from invalidating the catalogue observation while this
  -- transaction runs. ROW EXCLUSIVE remains compatible with ordinary DML writers.
  LOCK TABLE empire_os_identity.identity_registry,empire_os_identity.person_authority_events,
    empire_os_identity.active_bindings,empire_os_identity.identity_events,
    empire_os_authorization.role_tenants IN ROW EXCLUSIVE MODE;
  IF empire_os_identity.member_authority_ready() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Member authority locking contract unavailable' USING ERRCODE='55000';
  END IF;
  PERFORM 1 FROM empire_os_authorization.tenants t WHERE t.tenant_id=p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member authority unavailable' USING ERRCODE='42501'; END IF;
  actor := empire_os_authorization.runtime_subject(p_tenant);
  IF actor IS DISTINCT FROM initial_actor THEN
    RAISE EXCEPTION 'Member authority unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO bound FROM empire_os_identity.active_bindings b WHERE b.subject=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member authority unavailable' USING ERRCODE='42501'; END IF;
  -- Cross-check the caller's projection against the latest applicable history event.
  -- Never disclose global identity history to an ordinary tenant member.
  SELECT e INTO last_event FROM jsonb_array_elements(saved->'events') WITH ORDINALITY h(e,n)
    WHERE (e->>'kind' IN ('subject-bound','binding-revoked')
        AND (e->>'subject'=actor OR e->>'personId'=bound.person_id))
      OR (e->>'kind'='binding-reassigned' AND (e->>'subject'=actor OR e->>'previousSubject'=actor
        OR e->>'personId'=bound.person_id OR e->>'previousPersonId'=bound.person_id))
    ORDER BY n DESC LIMIT 1;
  IF last_event IS NULL OR last_event->>'kind' NOT IN ('subject-bound','binding-reassigned')
    OR last_event->>'subject' IS DISTINCT FROM actor
    OR last_event->>'personId' IS DISTINCT FROM bound.person_id
    OR last_event->>'bindingId' IS DISTINCT FROM bound.binding_id
    OR last_event->>'tenantId' IS DISTINCT FROM p_tenant
    OR last_event->>'eventId' IS DISTINCT FROM bound.event_id
    OR NOT EXISTS (SELECT 1 FROM empire_os_identity.identity_events e
      WHERE e.event_id=bound.event_id AND e.event=last_event) THEN
    RAISE EXCEPTION 'Member authority unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO person_event FROM empire_os_identity.person_authority_events p
    WHERE p.tenant_id=p_tenant AND p.person_id=bound.person_id ORDER BY p.revision DESC LIMIT 1;
  IF NOT FOUND OR person_event.status<>'active' THEN
    RAISE EXCEPTION 'Member authority unavailable' USING ERRCODE='42501';
  END IF;
  -- Reuse the existing SQL permission/delegation evaluator under the SAME tenant
  -- lock. Its business values stay inside PostgreSQL; none leave this function.
  SELECT * INTO STRICT snapshot FROM empire_os_authorization.read_dataset_snapshot(p_tenant,p_dataset);
  IF snapshot.actor_subject IS DISTINCT FROM actor OR snapshot.decision->>'status' IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'Member authority unavailable' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT actor,bound.binding_id,bound.person_id,
    (saved->>'revision')::bigint,(saved->>'bindingRevision')::bigint,
    person_event.revision,person_event.status,person_event.kind,
    snapshot.state,snapshot.revision,snapshot.decision,snapshot.checked_at,
    jsonb_build_object(
      'tenantId',person_event.tenant_id,'personId',person_event.person_id,
      'revision',person_event.revision,'status',person_event.status,'kind',person_event.kind,
      'operationId',person_event.operation_id,'issuerSubject',person_event.issuer_subject,
      'sourceReference',person_event.source_reference,'evidenceSha256',person_event.evidence_sha256,
      'recordedAtMs',person_event.recorded_at_ms);
END;
$$;
REVOKE ALL ON TABLE empire_os_identity.person_authority_events FROM PUBLIC;
REVOKE ALL ON FUNCTION empire_os_identity.fence_person_authority() FROM PUBLIC;
REVOKE ALL ON FUNCTION empire_os_identity.fence_member_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION empire_os_identity.member_authority_ready() FROM PUBLIC;
REVOKE ALL ON FUNCTION empire_os_identity.lock_member_authority(text,uuid) FROM PUBLIC;
COMMIT;
