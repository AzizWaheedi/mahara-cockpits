-- Direct Supabase checklist API. Existing Convex identifiers remain provenance only.
-- Browser roles never receive table access; these narrow functions enforce membership.
BEGIN;

CREATE OR REPLACE FUNCTION public.cockpit_get_daily_checks(
  p_role text,
  p_day date
)
RETURNS TABLE (
  id bigint,
  day date,
  check_key text,
  label text,
  detail text,
  phase text,
  block text,
  display_order numeric,
  href text,
  done boolean,
  done_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('media_buyer', 'csm', 'creative')
     OR p_day IS NULL THEN
    RAISE EXCEPTION 'Invalid checklist role or day' USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NULL OR NOT (
    public.cockpit_has_role(p_role) OR public.cockpit_is_ceo()
  ) THEN
    RAISE EXCEPTION 'Checklist access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT c.id, c.day, c.check_key, c.label, c.detail, c.phase,
           c.block, c.display_order, c.href, c.done, c.done_at
    FROM public.cockpit_daily_checks AS c
    WHERE c.role = p_role AND c.day = p_day AND c.source_deleted = false
    ORDER BY c.display_order NULLS LAST, c.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_set_daily_check(
  p_id bigint,
  p_expected_done boolean,
  p_done boolean
)
RETURNS TABLE (id bigint, done boolean, done_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_check public.cockpit_daily_checks%ROWTYPE;
  v_email text;
BEGIN
  IF p_id IS NULL OR p_expected_done IS NULL OR p_done IS NULL
     OR p_expected_done = p_done THEN
    RAISE EXCEPTION 'Invalid checklist change' USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Checklist access denied' USING ERRCODE = '42501';
  END IF;

  SELECT c.* INTO v_check
  FROM public.cockpit_daily_checks AS c
  WHERE c.id = p_id AND c.source_deleted = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checklist item not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.cockpit_has_role(v_check.role) OR public.cockpit_is_ceo()) THEN
    RAISE EXCEPTION 'Checklist access denied' USING ERRCODE = '42501';
  END IF;
  IF v_check.done IS DISTINCT FROM p_expected_done THEN
    RAISE EXCEPTION 'Checklist changed; reload before trying again' USING ERRCODE = '40001';
  END IF;

  SELECT lower(trim(au.email)) INTO v_email
  FROM auth.users AS au
  JOIN public.cockpit_members AS cm ON cm.auth_user_id = au.id
  WHERE au.id = auth.uid() AND cm.active = true
    AND cm.email = lower(trim(au.email))
    AND au.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Checklist access denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.cockpit_daily_checks AS c
  SET done = p_done,
      done_at = CASE WHEN p_done THEN now() ELSE NULL END,
      source_system = 'supabase',
      source_revision = c.source_revision + 1,
      changed_by = v_email
  WHERE c.id = p_id
  RETURNING c.id, c.done, c.done_at INTO id, done, done_at;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cockpit_get_daily_checks(text, date)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_set_daily_check(bigint, boolean, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_get_daily_checks(text, date)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_set_daily_check(bigint, boolean, boolean)
  TO authenticated, service_role;

COMMIT;
