-- INACTIVE CANDIDATE ONLY. Never run from application startup or production deployment.
-- Apply only to a newly provisioned, separately marked disposable database for integration tests.
-- This schema stores confirmation-consumption identities only; it contains no business-store data.
BEGIN;

DO $$
BEGIN
  IF to_regnamespace('empire_os_recovery') IS NOT NULL THEN
    RAISE EXCEPTION 'Exceptional recovery confirmation schema already exists; refusing overwrite'
      USING ERRCODE='55000';
  END IF;
END;
$$;

CREATE SCHEMA empire_os_recovery;
REVOKE ALL ON SCHEMA empire_os_recovery FROM PUBLIC;

CREATE TABLE empire_os_recovery.confirmations (
  challenge_sha256 text NOT NULL CHECK (challenge_sha256 ~ '^[a-f0-9]{64}$'),
  nonce text PRIMARY KEY CHECK (nonce ~ '^[a-f0-9]{64}$'),
  confirmation_id text NOT NULL UNIQUE CHECK (confirmation_id ~ '^[a-f0-9]{64}$'),
  attempt_id text NOT NULL UNIQUE CHECK (attempt_id ~ '^[a-f0-9]{64}$'),
  expires_at_ms bigint NOT NULL CHECK (expires_at_ms BETWEEN 1 AND 8640000000000000),
  consumed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION empire_os_recovery.reject_confirmation_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Exceptional recovery confirmation evidence is append-only'
    USING ERRCODE='23514';
END;
$$;

CREATE TRIGGER immutable_confirmation
  BEFORE UPDATE OR DELETE ON empire_os_recovery.confirmations
  FOR EACH ROW EXECUTE FUNCTION empire_os_recovery.reject_confirmation_mutation();

CREATE FUNCTION empire_os_recovery.reject_expired_confirmation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.expires_at_ms <= floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint THEN
    RAISE EXCEPTION 'Exceptional recovery confirmation expired before commit'
      USING ERRCODE='22023';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER unexpired_confirmation_at_commit
  AFTER INSERT ON empire_os_recovery.confirmations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION empire_os_recovery.reject_expired_confirmation();

-- No roles or grants are created here. Deployment must separately provision a dedicated
-- non-owner LOGIN with only schema USAGE and SELECT/INSERT on this table, and no business
-- schema/table access. Do not grant UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER or CREATE.
REVOKE ALL ON ALL TABLES IN SCHEMA empire_os_recovery FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA empire_os_recovery FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA empire_os_recovery FROM PUBLIC;

COMMIT;
