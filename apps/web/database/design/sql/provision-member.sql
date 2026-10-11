-- DRAFT ONLY. Not an applied migration.
CREATE FUNCTION empire_os_authorization.provision_member_check(
  p_tenant text, p_subject text, p_role_ids jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
DECLARE
  actor text;
  existing jsonb;
  snapshot jsonb;
BEGIN
  actor := empire_os_authorization.runtime_subject(p_tenant);

  SELECT state->'snapshot' INTO STRICT snapshot
  FROM empire_os_authorization.tenants
  WHERE tenant_id = p_tenant FOR UPDATE;
  actor := empire_os_authorization.runtime_subject(p_tenant);

  IF snapshot #>> '{tenant,status}' <> 'active'
    OR NOT (snapshot #> '{tenant,ownerSubjects}') ? actor
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(snapshot->'memberships') m
      WHERE m->>'subject'=actor AND m->>'status'='active'
    ) THEN
    RAISE EXCEPTION 'Founder authority required' USING ERRCODE='42501';
  END IF;
  IF snapshot #>> '{tenant,id}' IS DISTINCT FROM p_tenant
    OR jsonb_typeof(snapshot->'memberships') IS DISTINCT FROM 'array'
    OR jsonb_typeof(snapshot->'roles') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid tenant authority state' USING ERRCODE='23514';
  END IF;
  IF p_subject IS NULL
    OR p_subject !~ '^user_[A-Za-z0-9_]+$'
    OR length(p_subject) > 512
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(snapshot->'memberships') m
      WHERE m->>'subject'=p_subject
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        (SELECT state->'revocations'
         FROM empire_os_authorization.tenants
         WHERE tenant_id=p_tenant)
      ) r
      WHERE r->>'kind'='membership' AND r->>'id'=p_subject
    ) THEN
    RAISE EXCEPTION 'Invalid employee identity' USING ERRCODE='23514';
  END IF;
  IF jsonb_typeof(p_role_ids) IS DISTINCT FROM 'array'
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_role_ids) r
      WHERE jsonb_typeof(r) <> 'string'
        OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(snapshot->'roles') role
          WHERE role->>'id'=r #>> '{}'
            AND role->>'status'='active'
        )
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_role_ids) r
      GROUP BY r HAVING count(*) > 1
    ) THEN
    RAISE EXCEPTION 'Invalid employee roles' USING ERRCODE='23514';
  END IF;

  RETURN true;
END;
$$;

-- Draft-only privilege boundary; not applied to any database.
REVOKE ALL ON FUNCTION
  empire_os_authorization.provision_member_check(text,text,jsonb)
FROM PUBLIC;
