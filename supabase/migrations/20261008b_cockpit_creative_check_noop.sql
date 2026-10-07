-- cockpit_set_creative_check (20261008a), after an independent review:
-- a tick that changes nothing writes nothing (no revision, no audit row), so
-- a second tab or a double click is a no-op rather than a fresh write; the
-- identifiers no longer depend on DateStyle; and PostgREST reloads its schema.
BEGIN;

CREATE OR REPLACE FUNCTION public.cockpit_set_creative_check(
  p_day date,
  p_key text,
  p_done boolean
)
RETURNS TABLE (id bigint, done boolean, done_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_today date := (pg_catalog.now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_label text;
  v_detail text;
  v_phase text;
  v_order numeric;
  v_email text;
BEGIN
  IF p_day IS NULL OR p_key IS NULL OR p_done IS NULL THEN
    RAISE EXCEPTION 'Invalid checklist change' USING ERRCODE = '22023';
  END IF;
  -- The browser sends Kuwait's date at the moment of the tick. Yesterday is
  -- allowed for a device clock running a little behind; rows for older or
  -- future days are never created here.
  IF p_day NOT IN (v_today, v_today - 1) THEN
    RAISE EXCEPTION 'Only today''s checklist can change' USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NULL OR NOT (
    public.cockpit_has_role('creative') OR public.cockpit_is_ceo()
  ) THEN
    RAISE EXCEPTION 'Checklist access denied' USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(au.email)) INTO v_email
  FROM auth.users AS au
  JOIN public.cockpit_members AS cm ON cm.auth_user_id = au.id
  WHERE au.id = auth.uid() AND cm.active = true
    AND cm.email = pg_catalog.lower(pg_catalog.btrim(au.email))
    AND au.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Checklist access denied' USING ERRCODE = '42501';
  END IF;

  -- The eight checks Today shows (DEFAULT_CREATIVE_CHECKS in
  -- useCreativeSnapshot.ts; creative-check.test.ts keeps the two in step).
  SELECT c.label, c.detail, c.phase, c.ord
  INTO v_label, v_detail, v_phase, v_order
  FROM (VALUES
    ('clickup_comments', 'Clear ClickUp comments on the creative board',
     'Anything a client or the media buyer asked you yesterday.', 'sod', 1),
    ('whatsapp_sprint', 'WhatsApp sprint',
     'Client groups — answer anything creative-related.', 'sod', 2),
    ('slack_sprint', 'Slack sprint', 'Editors, media buyer, CSM.', 'sod', 3),
    ('editors_standup', 'Check where every editor is',
     'Anything overdue gets chased before you start your own work.', 'sod', 4),
    ('brand_dna', 'Move the oldest Brand DNA forward',
     'Nothing else can be produced for a client until this is locked.', 'mid', 5),
    ('scripts', 'Write the scripts that are due',
     'Oldest first. Anything past 3 days is blocking a launch.', 'mid', 6),
    ('replace_fatigued', 'Replace the creatives that are burning out',
     'Frequency over the gate means the audience has seen it enough.', 'mid', 7),
    ('social_calendar', 'Plan next week''s scripts on the calendar',
     'Keep every client 2 weeks ahead so no editor runs out of work.', 'mid', 8)
  ) AS c(key, label, detail, phase, ord)
  WHERE c.key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown creative check: %', p_key USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.cockpit_daily_checks AS c (
    role, owner_app, day, check_key, label, detail, phase, display_order,
    done, done_at, source_system, source_deployment, source_id,
    source_snapshot_ts, source_row, changed_by
  ) VALUES (
    'creative', 'creative-director', p_day, p_key, v_label, v_detail, v_phase,
    v_order, p_done, CASE WHEN p_done THEN pg_catalog.now() END,
    'supabase', 'supabase',
    'creative:' || pg_catalog.to_char(p_day, 'YYYY-MM-DD') || ':' || p_key,
    pg_catalog.to_char(pg_catalog.now() AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    pg_catalog.jsonb_build_object('created_by', v_email),
    v_email
  )
  ON CONFLICT ON CONSTRAINT cockpit_daily_checks_logical_unique DO UPDATE
  SET done = EXCLUDED.done,
      -- A check ticked again keeps the time it was first ticked.
      done_at = CASE
        WHEN NOT EXCLUDED.done THEN NULL
        WHEN c.done AND NOT c.source_deleted THEN c.done_at
        ELSE pg_catalog.now()
      END,
      source_deleted = false,
      source_system = 'supabase',
      source_revision = c.source_revision + 1,
      changed_by = EXCLUDED.changed_by
  WHERE c.done IS DISTINCT FROM EXCLUDED.done OR c.source_deleted
  RETURNING c.id, c.done, c.done_at INTO id, done, done_at;

  -- Nothing to change: answer with the row as it stands.
  IF NOT FOUND THEN
    SELECT c.id, c.done, c.done_at INTO id, done, done_at
    FROM public.cockpit_daily_checks AS c
    WHERE c.role = 'creative' AND c.day = p_day AND c.check_key = p_key;
  END IF;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cockpit_set_creative_check(date, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_set_creative_check(date, text, boolean)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
