-- DESIGN CANDIDATE ONLY. This is not a numbered migration and must not be applied.
-- It defines the durable relational shape only; no runtime API, grants or live binding
-- path exists. Any future implementation must add a reviewed SECURITY DEFINER transaction
-- API that locks identity_registry before sorted tenant rows and revalidates all authority.
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('empire_os_authorization.tenants') IS NULL
    OR to_regprocedure('empire_os_authorization.runtime_subject(text)') IS NULL THEN
    RAISE EXCEPTION 'Identity registry candidate requires the isolated authorization foundation'
      USING ERRCODE = '55000';
  END IF;
  IF to_regnamespace('empire_os_identity') IS NOT NULL THEN
    RAISE EXCEPTION 'Identity registry candidate was already installed'
      USING ERRCODE = '55000';
  END IF;
  IF current_user IS DISTINCT FROM (
    SELECT r.rolname FROM pg_namespace n
    JOIN pg_roles r ON r.oid = n.nspowner
    WHERE n.nspname = 'empire_os_authorization'
  ) THEN
    RAISE EXCEPTION 'Identity registry candidate requires the authorization schema owner'
      USING ERRCODE = '42501';
  END IF;
END;
$guard$;

CREATE SCHEMA empire_os_identity;
REVOKE ALL ON SCHEMA empire_os_identity FROM PUBLIC;

CREATE TABLE empire_os_identity.identity_registry (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  binding_revision bigint NOT NULL DEFAULT 0 CHECK (binding_revision BETWEEN 0 AND 9007199254740991),
  policy_revision bigint NOT NULL DEFAULT 0 CHECK (policy_revision BETWEEN 0 AND 9007199254740991)
);
INSERT INTO empire_os_identity.identity_registry(singleton) VALUES (true);

-- Active bindings are global; tenant membership and permissions remain separate.
-- Deleting/replacing a current row is allowed only inside a future reviewed transaction
-- that appends identity_events and revokes affected memberships in the same commit.
CREATE TABLE empire_os_identity.active_bindings (
  binding_id text PRIMARY KEY CHECK (length(binding_id) BETWEEN 1 AND 512),
  subject text NOT NULL UNIQUE CHECK (subject ~ '^user_[A-Za-z0-9_]+$' AND length(subject) <= 512),
  person_id text NOT NULL UNIQUE CHECK (length(person_id) BETWEEN 1 AND 512),
  binding_revision bigint NOT NULL UNIQUE CHECK (binding_revision BETWEEN 1 AND 9007199254740991),
  source_tenant_id text NOT NULL REFERENCES empire_os_authorization.tenants(tenant_id),
  created_event_id text NOT NULL UNIQUE
);

CREATE TABLE empire_os_identity.administrator_grants (
  grant_id text PRIMARY KEY CHECK (length(grant_id) BETWEEN 1 AND 512),
  tenant_id text NOT NULL REFERENCES empire_os_authorization.tenants(tenant_id),
  subject text NOT NULL CHECK (subject ~ '^user_[A-Za-z0-9_]+$' AND length(subject) <= 512),
  capabilities jsonb NOT NULL CHECK (
    jsonb_typeof(capabilities)='array' AND jsonb_array_length(capabilities) > 0
    AND capabilities <@ '["bind","revoke","reassign","delegate","approve-reassignment","recover-founder"]'::jsonb
  ),
  source text NOT NULL CHECK (source IN ('bootstrap','delegated')),
  grant_revision bigint NOT NULL CHECK (grant_revision BETWEEN 1 AND 9007199254740991),
  grant_event_id text NOT NULL,
  revoked_event_id text,
  revoked_at_ms bigint CHECK (revoked_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK ((revoked_event_id IS NULL) = (revoked_at_ms IS NULL))
);
CREATE UNIQUE INDEX one_active_identity_grant_per_tenant
  ON empire_os_identity.administrator_grants(tenant_id,subject)
  WHERE revoked_event_id IS NULL;

-- Proof metadata records the verifier's result, not identity documents or credentials.
-- A claim is bound to one tenant/subject/Person tuple and consumed by at most one event.
CREATE TABLE empire_os_identity.verified_identity_claims (
  verification_id text PRIMARY KEY CHECK (length(verification_id) BETWEEN 1 AND 512),
  tenant_id text NOT NULL REFERENCES empire_os_authorization.tenants(tenant_id),
  subject text NOT NULL CHECK (subject ~ '^user_[A-Za-z0-9_]+$' AND length(subject) <= 512),
  person_id text NOT NULL CHECK (length(person_id) BETWEEN 1 AND 512),
  verified_by_subject text NOT NULL CHECK (verified_by_subject ~ '^user_[A-Za-z0-9_]+$'),
  verifier_reference text NOT NULL CHECK (length(verifier_reference) BETWEEN 1 AND 512),
  verified_at_ms bigint NOT NULL CHECK (verified_at_ms BETWEEN 0 AND 9007199254740991),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  UNIQUE (verification_id,tenant_id,subject,person_id)
);

CREATE TABLE empire_os_identity.identity_events (
  event_id text PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 512),
  operation_id text NOT NULL UNIQUE CHECK (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$'),
  sequence bigint NOT NULL UNIQUE CHECK (sequence BETWEEN 1 AND 9007199254740991),
  registry_revision bigint NOT NULL UNIQUE CHECK (registry_revision BETWEEN 1 AND 9007199254740991),
  tenant_id text NOT NULL REFERENCES empire_os_authorization.tenants(tenant_id),
  event_kind text NOT NULL CHECK (event_kind IN (
    'subject-bound','binding-revoked','binding-reassigned','administrator-granted','administrator-revoked'
  )),
  actor_subject text NOT NULL CHECK (actor_subject ~ '^user_[A-Za-z0-9_]+$'),
  subject text CHECK (subject IS NULL OR (subject ~ '^user_[A-Za-z0-9_]+$' AND length(subject) <= 512)),
  person_id text CHECK (person_id IS NULL OR length(person_id) BETWEEN 1 AND 512),
  previous_subject text CHECK (previous_subject IS NULL OR previous_subject ~ '^user_[A-Za-z0-9_]+$'),
  previous_person_id text CHECK (previous_person_id IS NULL OR length(previous_person_id) BETWEEN 1 AND 512),
  binding_id text,
  previous_binding_id text,
  verification_id text REFERENCES empire_os_identity.verified_identity_claims(verification_id),
  grant_id text,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(capabilities)='array'
    AND capabilities <@ '["bind","revoke","reassign","delegate","approve-reassignment","recover-founder"]'::jsonb
  ),
  revoked_administrator_grant_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(revoked_administrator_grant_ids)='array'),
  membership_revocations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(membership_revocations)='array'),
  justification text,
  approved_by_subject text CHECK (approved_by_subject IS NULL OR approved_by_subject ~ '^user_[A-Za-z0-9_]+$'),
  approved_authenticated_at_ms bigint CHECK (approved_authenticated_at_ms BETWEEN 0 AND 9007199254740991),
  approved_at_ms bigint CHECK (approved_at_ms BETWEEN 0 AND 9007199254740991),
  tenant_policy_revisions jsonb NOT NULL CHECK (jsonb_typeof(tenant_policy_revisions)='array'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at_ms bigint NOT NULL CHECK (recorded_at_ms BETWEEN 0 AND 9007199254740991),
  database_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),
  CHECK (event_kind <> 'subject-bound' OR (
    subject IS NOT NULL AND person_id IS NOT NULL AND binding_id IS NOT NULL AND verification_id IS NOT NULL
  )),
  CHECK (event_kind <> 'binding-revoked' OR (
    subject IS NOT NULL AND person_id IS NOT NULL AND binding_id IS NOT NULL
    AND ((approved_by_subject IS NULL AND approved_authenticated_at_ms IS NULL AND approved_at_ms IS NULL)
      OR (approved_by_subject IS NOT NULL AND approved_by_subject <> actor_subject
        AND approved_by_subject <> subject AND approved_authenticated_at_ms IS NOT NULL AND approved_at_ms IS NOT NULL))
  )),
  CHECK (event_kind <> 'binding-reassigned' OR (
    previous_subject IS NOT NULL AND previous_person_id IS NOT NULL AND subject IS NOT NULL AND person_id IS NOT NULL
    AND binding_id IS NOT NULL AND previous_binding_id IS NOT NULL AND verification_id IS NOT NULL
    AND approved_by_subject IS NOT NULL AND approved_by_subject <> actor_subject AND approved_by_subject <> subject
    AND approved_authenticated_at_ms IS NOT NULL AND approved_at_ms IS NOT NULL
    AND justification IS NOT NULL AND length(btrim(justification)) > 0
  )),
  CHECK (event_kind NOT IN ('binding-revoked','administrator-revoked')
    OR (justification IS NOT NULL AND length(btrim(justification)) > 0)),
  CHECK (event_kind <> 'administrator-granted'
    OR (jsonb_array_length(capabilities) > 0 AND grant_id IS NOT NULL)),
  CHECK (event_kind <> 'administrator-revoked' OR (grant_id IS NOT NULL AND subject IS NOT NULL)),
  CHECK (approved_at_ms IS NULL OR approved_authenticated_at_ms <= approved_at_ms),
  CHECK (approved_at_ms IS NULL OR approved_at_ms <= recorded_at_ms)
);
CREATE UNIQUE INDEX one_identity_operation_per_database_transaction
  ON empire_os_identity.identity_events(database_transaction);
CREATE UNIQUE INDEX one_use_per_verified_identity_claim
  ON empire_os_identity.identity_events(verification_id) WHERE verification_id IS NOT NULL;
ALTER TABLE empire_os_identity.active_bindings
  ADD CONSTRAINT binding_creation_event_fk
  FOREIGN KEY (created_event_id) REFERENCES empire_os_identity.identity_events(event_id);
ALTER TABLE empire_os_identity.administrator_grants
  ADD CONSTRAINT grant_creation_event_fk
  FOREIGN KEY (grant_event_id) REFERENCES empire_os_identity.identity_events(event_id);
ALTER TABLE empire_os_identity.administrator_grants
  ADD CONSTRAINT grant_revocation_event_fk
  FOREIGN KEY (revoked_event_id) REFERENCES empire_os_identity.identity_events(event_id);

CREATE FUNCTION empire_os_identity.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Identity verification and audit history are immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER immutable_verified_identity_claims
  BEFORE UPDATE OR DELETE ON empire_os_identity.verified_identity_claims
  FOR EACH ROW EXECUTE FUNCTION empire_os_identity.reject_history_mutation();
CREATE TRIGGER immutable_identity_events
  BEFORE UPDATE OR DELETE ON empire_os_identity.identity_events
  FOR EACH ROW EXECUTE FUNCTION empire_os_identity.reject_history_mutation();

DO $rls$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY[
    'identity_registry','active_bindings','administrator_grants','verified_identity_claims','identity_events'
  ] LOOP
    EXECUTE format('ALTER TABLE empire_os_identity.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE empire_os_identity.%I FORCE ROW LEVEL SECURITY',tab);
    EXECUTE format('CREATE POLICY trusted_api ON empire_os_identity.%I
      USING (current_user=%L) WITH CHECK (current_user=%L)',tab,current_user,current_user);
  END LOOP;
END;
$rls$;

COMMIT;
