-- Migration 005: trusted employee provisioning.
-- Not ready for execution or deployment.
-- Never grant runtime access before security integration tests.
-- Existing migrations and security policies must remain unchanged.

DO $$
BEGIN
  RAISE EXCEPTION
    'Employee provisioning migration is incomplete and disabled';
END;
$$;
