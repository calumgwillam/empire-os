-- Isolated foundation only. No production activation, roles, credentials or live-data import.
BEGIN;

CREATE SCHEMA empire_os_preparation;
REVOKE ALL ON SCHEMA empire_os_preparation FROM PUBLIC;

CREATE TABLE empire_os_preparation.store_registry (
  store_key text PRIMARY KEY,
  registry_position integer NOT NULL UNIQUE CHECK (registry_position BETWEEN 1 AND 21)
);
INSERT INTO empire_os_preparation.store_registry (store_key, registry_position) VALUES
  ('empire-os-captures', 1),
  ('empire-os-capture-conversions', 2),
  ('empire-os-people', 3),
  ('empire-os-projects', 4),
  ('empire-os-leads', 5),
  ('empire-os-outreach-contacts', 6),
  ('empire-os-delegation-handoffs', 7),
  ('empire-os-cash-position', 8),
  ('empire-os-income-records', 9),
  ('empire-os-expense-records', 10),
  ('empire-os-financial-commitments', 11),
  ('empire-os-tax-payment-records', 12),
  ('empire-os-records-in-motion-views', 13),
  ('empire-os-records-in-motion-default-view', 14),
  ('empire-os-daily-posture-snapshots', 15),
  ('empire-os-change-history', 16),
  ('empire-os-strategic-objectives', 17),
  ('empire-os-strategic-reviews', 18),
  ('empire-os-working-relationships', 19),
  ('empire-os-founder-intelligence', 20),
  ('empire-os-icarus-assessments', 21);

CREATE TABLE empire_os_preparation.datasets (
  dataset_id uuid PRIMARY KEY,
  protocol_version integer NOT NULL DEFAULT 1 CHECK (protocol_version = 1),
  generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
  authority_revision bigint NOT NULL DEFAULT 0 CHECK (authority_revision BETWEEN 0 AND 9007199254740991),
  authority_mode text NOT NULL DEFAULT 'denied' CHECK (authority_mode IN ('denied', 'preparation-only')),
  commit_sequence bigint NOT NULL DEFAULT 0 CHECK (commit_sequence BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Principal IDs are resolved by the authenticated server, never copied from request JSON.
CREATE TABLE empire_os_preparation.dataset_access (
  dataset_id uuid NOT NULL REFERENCES empire_os_preparation.datasets,
  principal_id text NOT NULL CHECK (length(principal_id) > 0),
  can_read boolean NOT NULL DEFAULT false,
  can_write boolean NOT NULL DEFAULT false,
  can_import boolean NOT NULL DEFAULT false,
  PRIMARY KEY (dataset_id, principal_id)
);

CREATE TABLE empire_os_preparation.import_sources (
  dataset_id uuid NOT NULL REFERENCES empire_os_preparation.datasets,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  canonical_source bytea NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (dataset_id, source_sha256)
);
CREATE TABLE empire_os_preparation.import_source_values (
  dataset_id uuid NOT NULL,
  source_sha256 text NOT NULL,
  store_key text NOT NULL REFERENCES empire_os_preparation.store_registry,
  raw_value bytea CHECK (raw_value IS NULL OR octet_length(raw_value) % 2 = 0),
  PRIMARY KEY (dataset_id, source_sha256, store_key),
  FOREIGN KEY (dataset_id, source_sha256) REFERENCES empire_os_preparation.import_sources
);

CREATE TABLE empire_os_preparation.generations (
  dataset_id uuid NOT NULL REFERENCES empire_os_preparation.datasets,
  generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
  phase text NOT NULL DEFAULT 'preparing' CHECK (phase IN ('preparing', 'verified', 'recovery-required')),
  source_sha256 text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (dataset_id, generation),
  FOREIGN KEY (dataset_id, source_sha256) REFERENCES empire_os_preparation.import_sources
);
ALTER TABLE empire_os_preparation.datasets ADD CONSTRAINT dataset_generation
  FOREIGN KEY (dataset_id, generation) REFERENCES empire_os_preparation.generations
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE empire_os_preparation.store_values (
  dataset_id uuid NOT NULL,
  generation bigint NOT NULL,
  store_key text NOT NULL REFERENCES empire_os_preparation.store_registry,
  raw_value bytea CHECK (raw_value IS NULL OR octet_length(raw_value) % 2 = 0),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  CHECK (revision <> 0 OR raw_value IS NULL),
  PRIMARY KEY (dataset_id, generation, store_key),
  FOREIGN KEY (dataset_id, generation) REFERENCES empire_os_preparation.generations
);

CREATE TABLE empire_os_preparation.transactions (
  transaction_id uuid PRIMARY KEY,
  dataset_id uuid NOT NULL,
  generation bigint NOT NULL,
  authority_revision bigint NOT NULL CHECK (authority_revision BETWEEN 0 AND 9007199254740991),
  protocol_version integer NOT NULL CHECK (protocol_version = 1),
  commit_sequence bigint NOT NULL CHECK (commit_sequence BETWEEN 1 AND 9007199254740991),
  principal_id text NOT NULL CHECK (length(principal_id) > 0),
  operation text NOT NULL CHECK (operation IN ('write', 'stage-import')),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (dataset_id, commit_sequence),
  UNIQUE (dataset_id, transaction_id),
  FOREIGN KEY (dataset_id, generation) REFERENCES empire_os_preparation.generations
);
CREATE TABLE empire_os_preparation.transaction_stores (
  transaction_id uuid NOT NULL REFERENCES empire_os_preparation.transactions,
  store_key text NOT NULL REFERENCES empire_os_preparation.store_registry,
  before_revision bigint NOT NULL CHECK (before_revision BETWEEN 0 AND 9007199254740990),
  after_revision bigint NOT NULL CHECK (after_revision = before_revision + 1 AND after_revision <= 9007199254740991),
  before_value bytea CHECK (before_value IS NULL OR octet_length(before_value) % 2 = 0),
  after_value bytea CHECK (after_value IS NULL OR octet_length(after_value) % 2 = 0),
  PRIMARY KEY (transaction_id, store_key)
);
CREATE TABLE empire_os_preparation.transaction_reads (
  transaction_id uuid NOT NULL REFERENCES empire_os_preparation.transactions,
  store_key text NOT NULL REFERENCES empire_os_preparation.store_registry,
  expected_revision bigint NOT NULL CHECK (expected_revision BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (transaction_id, store_key)
);

CREATE TABLE empire_os_preparation.idempotency_results (
  dataset_id uuid NOT NULL,
  request_generation bigint NOT NULL CHECK (request_generation BETWEEN 1 AND 9007199254740991),
  principal_id text NOT NULL CHECK (length(principal_id) > 0),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$'),
  operation text NOT NULL CHECK (operation IN ('write', 'stage-import')),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  transaction_id uuid NOT NULL,
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  PRIMARY KEY (dataset_id, request_generation, principal_id, idempotency_key),
  FOREIGN KEY (dataset_id, transaction_id) REFERENCES empire_os_preparation.transactions (dataset_id, transaction_id)
);

CREATE FUNCTION empire_os_preparation.reject_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Persistence evidence is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER immutable_source BEFORE UPDATE OR DELETE ON empire_os_preparation.import_sources
  FOR EACH ROW EXECUTE FUNCTION empire_os_preparation.reject_evidence_mutation();
CREATE TRIGGER immutable_source_values BEFORE UPDATE OR DELETE ON empire_os_preparation.import_source_values
  FOR EACH ROW EXECUTE FUNCTION empire_os_preparation.reject_evidence_mutation();
CREATE TRIGGER immutable_transaction BEFORE UPDATE OR DELETE ON empire_os_preparation.transactions
  FOR EACH ROW EXECUTE FUNCTION empire_os_preparation.reject_evidence_mutation();
CREATE TRIGGER immutable_transaction_stores BEFORE UPDATE OR DELETE ON empire_os_preparation.transaction_stores
  FOR EACH ROW EXECUTE FUNCTION empire_os_preparation.reject_evidence_mutation();
CREATE TRIGGER immutable_transaction_reads BEFORE UPDATE OR DELETE ON empire_os_preparation.transaction_reads
  FOR EACH ROW EXECUTE FUNCTION empire_os_preparation.reject_evidence_mutation();
CREATE TRIGGER immutable_idempotency BEFORE UPDATE OR DELETE ON empire_os_preparation.idempotency_results
  FOR EACH ROW EXECUTE FUNCTION empire_os_preparation.reject_evidence_mutation();
CREATE TRIGGER immutable_registry BEFORE INSERT OR UPDATE OR DELETE ON empire_os_preparation.store_registry
  FOR EACH ROW EXECUTE FUNCTION empire_os_preparation.reject_evidence_mutation();

CREATE FUNCTION empire_os_preparation.enforce_revision_step()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.dataset_id <> OLD.dataset_id OR NEW.generation <> OLD.generation OR NEW.store_key <> OLD.store_key
     OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Store identity is immutable and revision must advance exactly once' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER monotonic_store_revision BEFORE UPDATE ON empire_os_preparation.store_values
  FOR EACH ROW EXECUTE FUNCTION empire_os_preparation.enforce_revision_step();
CREATE TRIGGER no_store_deletion BEFORE DELETE ON empire_os_preparation.store_values
  FOR EACH ROW EXECUTE FUNCTION empire_os_preparation.reject_evidence_mutation();

-- No runtime roles/policies are supplied. Ordinary application roles are denied until reviewed policies exist.
ALTER TABLE empire_os_preparation.datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.datasets FORCE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.dataset_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.dataset_access FORCE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.generations FORCE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.store_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.store_values FORCE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.import_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.import_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.import_source_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.import_source_values FORCE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.transaction_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.transaction_stores FORCE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.transaction_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.transaction_reads FORCE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.idempotency_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE empire_os_preparation.idempotency_results FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA empire_os_preparation FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA empire_os_preparation FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA empire_os_preparation REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA empire_os_preparation REVOKE ALL ON FUNCTIONS FROM PUBLIC;

COMMIT;
