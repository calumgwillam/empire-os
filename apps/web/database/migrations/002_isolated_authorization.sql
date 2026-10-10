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
CREATE TABLE empire_os_authorization.role_tenants (
  database_role name NOT NULL,
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
  operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$'),
  decision_id text NOT NULL UNIQUE CHECK (decision_id ~ '^[a-f0-9]{64}$'),
  actor_subject text NOT NULL,
  allowed boolean NOT NULL,
  resulting_revision bigint NOT NULL CHECK (resulting_revision BETWEEN 0 AND 9007199254740991),
  evidence jsonb NOT NULL,
  FOREIGN KEY (tenant_id,dataset_id) REFERENCES empire_os_authorization.datasets(tenant_id,dataset_id),
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
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM empire_os_authorization.audit a
    WHERE a.tenant_id=NEW.tenant_id AND a.resulting_revision=NEW.revision AND a.allowed
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
BEGIN
  PERFORM 1 FROM empire_os_authorization.tenants WHERE tenant_id=NEW.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tenant authority unavailable' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER serialize_audit BEFORE INSERT ON empire_os_authorization.audit
FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.lock_tenant();
CREATE TRIGGER serialize_write BEFORE INSERT ON empire_os_authorization.preparation_writes
FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.lock_tenant();
CREATE TRIGGER serialize_mapping BEFORE INSERT ON empire_os_authorization.datasets
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
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM empire_os_authorization.audit a WHERE a.tenant_id=NEW.tenant_id
    AND a.transaction_id=NEW.transaction_id AND a.dataset_id=NEW.dataset_id AND a.allowed
    AND a.evidence->>'operation'='write') THEN
    RAISE EXCEPTION 'Preparation write requires allowed atomic audit' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER write_audit AFTER INSERT ON empire_os_authorization.preparation_writes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION empire_os_authorization.check_write_audit();

CREATE FUNCTION empire_os_authorization.check_delegation_expiry() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
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
REVOKE ALL ON ALL TABLES IN SCHEMA empire_os_authorization FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA empire_os_authorization FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA empire_os_authorization REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA empire_os_authorization REVOKE ALL ON FUNCTIONS FROM PUBLIC;
COMMIT;
