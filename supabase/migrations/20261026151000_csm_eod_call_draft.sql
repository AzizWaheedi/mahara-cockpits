-- The CSM end of day: a call summary draft and the time the form was opened.
--
-- Muhammed, 2026-10-26 ("go with ... 5"): the Call summary box drafts itself from
-- the CSM's logged calls and their own Fathom recordings, with no AI rewriting,
-- and the first open of the form each working day is kept so open-to-submit time
-- can be measured. The draft and the counts read the EOD's own working day,
-- 04:00 to 04:00 Kuwait (public.cockpit_eod_working_day, 20260927e).
--
-- 1. cockpit_csm_eod_calls(day): the held Fathom calls the signed-in CSM hosted
--    that working day, for the clients they may see. A read: no write, no
--    provider call. The call store stays closed to browsers (20261011c).
-- 2. cockpit_eod_opens + cockpit_mark_eod_opened(role, day): one row per person,
--    role and working day, written once (primary key, insert only) with an audit
--    row. No open is kept for a report already submitted.
-- 3. cockpit_eod_open_to_submit: minutes from first open to submit, service only.

BEGIN;

-- 1. The day's own Fathom calls ------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_csm_eod_calls(p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; me text; day_for date; t0 timestamptz; t1 timestamptz; calls jsonb;
BEGIN
  uid := public.cockpit_eod_actor('csm');
  day_for := coalesce(p_day, public.cockpit_eod_working_day(now()));
  IF day_for > public.cockpit_eod_working_day(now()) THEN
    RAISE EXCEPTION 'EOD day cannot be in the future' USING ERRCODE='22023';
  END IF;
  SELECT lower(btrim(m.email)) INTO me FROM public.cockpit_members m WHERE m.auth_user_id=uid;
  t0 := (day_for + time '04:00') AT TIME ZONE 'Asia/Kuwait';
  t1 := t0 + interval '1 day';
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'taskId', c.task_id, 'clientName', v.client_name,
      'startsAt', c.starts_at, 'kind', c.kind,
      -- The draft takes the first sentence; the top of the summary is enough.
      'summary', left(c.summary, 1200)) ORDER BY c.starts_at), '[]'::jsonb)
    INTO calls
    FROM public.cockpit_csm_calls c
    JOIN public.cockpit_csm_visible_tasks() v ON v.task_id=c.task_id
   WHERE c.source='fathom' AND c.status='held'
     AND c.starts_at >= t0 AND c.starts_at < t1
     AND me IS NOT NULL AND lower(btrim(c.host_email))=me;
  RETURN jsonb_build_object('day', day_for, 'from', t0, 'to', t1, 'calls', calls);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_eod_calls(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_eod_calls(date) TO authenticated;

-- 2. The first open of the form, once per working day --------------------------------

CREATE TABLE IF NOT EXISTS public.cockpit_eod_opens(
  owner_user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('media_buyer','csm','creative')),
  day date NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, role, day)
);
COMMENT ON TABLE public.cockpit_eod_opens IS
  'The first time each person opened their EOD form for a working day. Written once by cockpit_mark_eod_opened, never updated.';
ALTER TABLE public.cockpit_eod_opens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_eod_opens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.cockpit_eod_opens TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_mark_eod_opened(p_role text, p_day date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; wd date; opened timestamptz; fresh boolean := false; row_ public.cockpit_eod_opens; actor text;
BEGIN
  uid := public.cockpit_eod_actor(p_role);
  wd := public.cockpit_eod_working_day(now());
  -- Yesterday too: a page left open past 04:00 keeps the day it started on.
  IF p_day IS NULL OR p_day > wd OR p_day < wd - 1 THEN
    RAISE EXCEPTION 'Only today''s or yesterday''s EOD can be opened' USING ERRCODE='22023';
  END IF;
  SELECT o.opened_at INTO opened FROM public.cockpit_eod_opens o
   WHERE o.owner_user_id=uid AND o.role=p_role AND o.day=p_day;
  IF opened IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.cockpit_eod_reports r
     WHERE r.owner_user_id=uid AND r.role=p_role AND r.day=p_day AND r.submitted_at IS NOT NULL) THEN
    INSERT INTO public.cockpit_eod_opens(owner_user_id, role, day) VALUES (uid, p_role, p_day)
      ON CONFLICT DO NOTHING RETURNING * INTO row_;
    IF row_.owner_user_id IS NOT NULL THEN
      fresh := true;
      opened := row_.opened_at;
      SELECT m.email INTO actor FROM public.cockpit_members m WHERE m.auth_user_id=uid;
      INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, "after")
      VALUES ('eod.opened', 'cockpit_eod_opens', uid::text||':'||p_role||':'||p_day::text,
              coalesce(actor, 'unknown'), p_role, 'supabase', to_jsonb(row_));
    ELSE
      -- Another tab won the race: its time stands.
      SELECT o.opened_at INTO opened FROM public.cockpit_eod_opens o
       WHERE o.owner_user_id=uid AND o.role=p_role AND o.day=p_day;
    END IF;
  END IF;
  RETURN jsonb_build_object('day', p_day, 'openedAt', opened, 'first', fresh);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_mark_eod_opened(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_mark_eod_opened(text, date) TO authenticated;

-- 3. Open to submit ------------------------------------------------------------------

CREATE OR REPLACE VIEW public.cockpit_eod_open_to_submit WITH (security_invoker=true) AS
SELECT o.owner_user_id, m.email AS owner_email, o.role, o.day, o.opened_at, r.submitted_at,
       round(extract(epoch FROM r.submitted_at - o.opened_at) / 60) AS minutes_open_to_submit
  FROM public.cockpit_eod_opens o
  LEFT JOIN public.cockpit_members m ON m.auth_user_id=o.owner_user_id
  LEFT JOIN public.cockpit_eod_reports r
    ON r.owner_user_id=o.owner_user_id AND r.role=o.role AND r.day=o.day;
REVOKE ALL ON public.cockpit_eod_open_to_submit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cockpit_eod_open_to_submit TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
