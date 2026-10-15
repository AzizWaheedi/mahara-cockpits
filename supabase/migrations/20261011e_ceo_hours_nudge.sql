-- A372. An optional daily Slack note to the CEO: who should have tracked
-- yesterday and did not.
--
-- The CEO, 2026-10-09, about Hubstaff and Timetastic: "so now build it and i
-- need to make sure everyone uses them now". Hours and pay (Team & payroll
-- tab) already lists who is not tracking right now, and it says "Nothing is
-- sent to anyone." This adds the morning note. It ships switched OFF: nothing is sent until the CEO
-- turns it on from Hours and pay.
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Apply after 20261009a/20261009b,
-- deploy cockpit-hours-sync with the nudge operation in the same step, and
-- apply it before the next ship of the media buyer cockpit: ship.sh's auth
-- preflight refuses while code calls a cockpit_ function production lacks.
-- Until the function is deployed, a kick reaches the old door, which runs an
-- ordinary recent read. Safe to apply twice.
--
--   cockpit_settings 'hours.nudge'      {"on": false} until the CEO switches it
--   cockpit_ceo_hours_nudge_get()       the CEO's read: the switch and the last run
--   cockpit_ceo_hours_nudge_set(bool)   the CEO's switch (gated, audited)
--   cockpit_hours_nudge_list(date)      service only: the list for one Kuwait day
--   cockpit_hours_nudge_finish(jsonb)   service only: sync state + audit row per run
--   cockpit_hours_nudge_kick()          cron: posts {"op":"nudge"} to cockpit-hours-sync
--   mahara-hours-nudge                  pg_cron, 06:05 UTC = 09:05 Kuwait, daily
--
-- The rule for the list matches Hours and pay (hoursModel.ts): tracking is
-- required (the person's terms, else the role default in
-- cockpit_hours_role_default), the person is active and employed that day and
-- not paused (cockpit_employment_periods), the day is a working day on the
-- schedule in force that day (cockpit_schedule_history; with none, the company
-- week for fixed pay), it is not a public holiday (cockpit_hours_holidays_json,
-- the same function the tab reads) and no pending or approved Timetastic
-- booking covers it, the CEO has not already decided the day (a time
-- adjustment), and Hubstaff shows no tracked time. Timetastic's own
-- non-working days are not used, as on the tab: the cockpit's schedule is the
-- working week. When Hubstaff has not been read since the day ended, nobody is
-- listed and the run says so: missing is never zero.
--
-- The Slack calls are receipted in cockpit_hours_provider_health, so the
-- provider list there gains 'slack'.

BEGIN;

-- 1. The switch, off.
INSERT INTO public.cockpit_settings(key,value,updated_by)
VALUES('hours.nudge','{"on":false}'::jsonb,'migration 20261011e (ships off)')
ON CONFLICT (key) DO NOTHING;

-- 2. Slack receipts land in the hours ledger.
ALTER TABLE public.cockpit_hours_provider_health DROP CONSTRAINT IF EXISTS cockpit_hours_provider_health_provider_check;
ALTER TABLE public.cockpit_hours_provider_health ADD CONSTRAINT cockpit_hours_provider_health_provider_check
  CHECK (provider IN ('hubstaff','hubstaff-auth','timetastic','slack'));

-- 3. The CEO's read and switch.
CREATE OR REPLACE FUNCTION public.cockpit_hours_nudge_state()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'on', coalesce((SELECT (s.value->>'on')::boolean FROM public.cockpit_settings s WHERE s.key='hours.nudge'), false),
    'updatedAt', (SELECT s.updated_at FROM public.cockpit_settings s WHERE s.key='hours.nudge'),
    'updatedBy', (SELECT s.updated_by FROM public.cockpit_settings s WHERE s.key='hours.nudge'),
    'last', (SELECT jsonb_build_object('runAt',st.last_run_at,'okAt',st.last_ok_at,'ok',st.ok,'note',st.note,'listed',st.rows_seen)
             FROM public.cockpit_sync_state st WHERE st.key='hours-nudge'))
$$;
REVOKE ALL ON FUNCTION public.cockpit_hours_nudge_state() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_nudge_get()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF public.cockpit_is_ceo() IS NOT TRUE THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  RETURN public.cockpit_hours_nudge_state();
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_nudge_set(p_on boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE who text; old jsonb; new jsonb;
BEGIN
  IF public.cockpit_is_ceo() IS NOT TRUE THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  IF p_on IS NULL THEN RAISE EXCEPTION 'Choose on or off' USING ERRCODE='22023'; END IF;
  SELECT lower(btrim(u.email)) INTO who FROM auth.users u WHERE u.id=auth.uid();
  SELECT to_jsonb(s) INTO old FROM public.cockpit_settings s WHERE s.key='hours.nudge' FOR UPDATE;
  INSERT INTO public.cockpit_settings(key,value,updated_by,updated_at)
  VALUES('hours.nudge',jsonb_build_object('on',p_on),who,now())
  ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()
  RETURNING to_jsonb(public.cockpit_settings.*) INTO new;
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
  VALUES('hours.nudge.set','cockpit_settings','hours.nudge',who,'ceo','supabase',old,new);
  RETURN public.cockpit_hours_nudge_state();
END $$;

REVOKE ALL ON FUNCTION public.cockpit_ceo_hours_nudge_get(), public.cockpit_ceo_hours_nudge_set(boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_hours_nudge_get(), public.cockpit_ceo_hours_nudge_set(boolean) TO authenticated;

-- 4. The list for one Kuwait day (service only).
CREATE OR REPLACE FUNCTION public.cockpit_hours_nudge_list(p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_day_end timestamptz;
  v_read timestamptz;
  v_on boolean;
  v_required integer;
  v_people jsonb;
BEGIN
  IF p_day IS NULL OR p_day >= v_today OR p_day < v_today - 31 THEN
    RAISE EXCEPTION 'Choose a finished day in the last month' USING ERRCODE='22023';
  END IF;
  v_day_end := (p_day + 1)::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_on := coalesce((SELECT (s.value->>'on')::boolean FROM public.cockpit_settings s WHERE s.key='hours.nudge'), false);
  SELECT c.last_ok_at INTO v_read FROM public.cockpit_hours_coverage c WHERE c.provider='hubstaff' AND c.day=p_day;

  WITH people AS (
    SELECT p.id, p.name, p.role, coalesce(t.tracking, d.tracking) AS tracking, coalesce(t.pay_basis, d.pay_basis) AS pay_basis
    FROM public.cockpit_people p
    LEFT JOIN public.cockpit_hours_terms t ON t.person_id=p.id
    CROSS JOIN LATERAL public.cockpit_hours_role_default(p.role, p.engagement) d
    WHERE p.active AND p.engagement<>'bot'
  ), required AS (
    -- Employed that day and not paused, by the dated periods the Hours tab reads (employedOn).
    SELECT pe.* FROM people pe
    WHERE pe.tracking='required'
      AND EXISTS (SELECT 1 FROM public.cockpit_employment_periods e WHERE e.person_id=pe.id AND e.kind='employed'
                  AND e.from_day<=p_day AND (e.to_day IS NULL OR p_day<=e.to_day))
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_employment_periods e WHERE e.person_id=pe.id AND e.kind='paused'
                  AND e.from_day<=p_day AND (e.to_day IS NULL OR p_day<=e.to_day))
  ), day_rule AS (
    -- The schedule in force that day (scheduleOn: the newest history row from on or before it).
    SELECT r.*, h.schedule,
      (SELECT e FROM jsonb_array_elements(coalesce(h.schedule->'exceptions','[]'::jsonb)) e WHERE e->>'date'=to_char(p_day,'YYYY-MM-DD') LIMIT 1) AS exception,
      h.schedule->'week'->lower(to_char(p_day,'dy')) AS weekday
    FROM required r
    LEFT JOIN LATERAL (SELECT sh.schedule FROM public.cockpit_schedule_history sh
                       WHERE sh.person_id=r.id AND sh.effective_from<=p_day ORDER BY sh.effective_from DESC LIMIT 1) h ON true
  ), working AS (
    SELECT dr.* FROM day_rule dr
    WHERE CASE
      -- No schedule: fixed pay works the company week (Saturday to Thursday); pay that follows hours expects nothing.
      WHEN dr.schedule IS NULL THEN dr.pay_basis='fixed' AND extract(isodow FROM p_day)<>5
      WHEN dr.exception IS NOT NULL THEN coalesce((dr.exception->>'off')::boolean,false) IS NOT TRUE
      ELSE coalesce((dr.weekday->>'on')::boolean,false)
    END
  ), off_by_holiday AS (
    -- Public holidays exactly as Hours and pay reads them: Timetastic's, plus adds, minus removes.
    SELECT w.id FROM working w WHERE jsonb_array_length(public.cockpit_hours_holidays_json(w.id,p_day,p_day))>0
  ), off_by_leave AS (
    -- A pending or approved Timetastic booking covering the day, unless the CEO marked it not taken.
    SELECT DISTINCT w.id FROM working w
    JOIN public.cockpit_time_accounts a ON a.provider='timetastic' AND a.person_id=w.id AND NOT a.ignored
    JOIN public.cockpit_timetastic_bookings b ON b.tt_user_id=a.external_id AND b.status IN ('Pending','Approved') AND b.gone_at IS NULL
      AND b.start_at::date<=p_day AND p_day<=b.end_at::date
    WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_time_adjustments j
                      WHERE j.kind='not_booked' AND j.booking_id=b.booking_id AND j.withdrawn_at IS NULL)
  ), decided AS (
    -- The CEO already decided the day (absent, excused, counted as worked, time added).
    SELECT DISTINCT j.person_id AS id FROM public.cockpit_time_adjustments j
    WHERE j.day=p_day AND j.withdrawn_at IS NULL
  ), due AS (
    SELECT w.* FROM working w
    WHERE w.id NOT IN (SELECT id FROM off_by_holiday)
      AND w.id NOT IN (SELECT id FROM off_by_leave)
      AND w.id NOT IN (SELECT id FROM decided)
  ), checked AS (
    SELECT due.id, due.name, due.role,
      (SELECT h.external_id FROM public.cockpit_time_accounts h
        WHERE h.provider='hubstaff' AND h.person_id=due.id AND NOT h.ignored LIMIT 1) AS hubstaff_id
    FROM due
  ), tracked AS (
    SELECT c.*, (SELECT sum(hd.tracked_s) FROM public.cockpit_hubstaff_days hd
                 WHERE hd.hubstaff_user_id=c.hubstaff_id AND hd.day=p_day AND hd.gone_at IS NULL) AS tracked_s
    FROM checked c
  )
  SELECT (SELECT count(*) FROM due),
         coalesce(jsonb_agg(jsonb_build_object('personId',t.id,'name',t.name,'role',t.role,
           'reason',CASE WHEN t.hubstaff_id IS NULL THEN 'no_hubstaff_account' ELSE 'nothing_tracked' END)
           ORDER BY t.role NULLS LAST, t.name) FILTER (WHERE t.hubstaff_id IS NULL OR coalesce(t.tracked_s,0)=0), '[]'::jsonb)
  INTO v_required, v_people
  FROM tracked t;

  RETURN jsonb_build_object(
    'day', p_day,
    'on', v_on,
    'ready', v_read IS NOT NULL AND v_read>=v_day_end,
    'hubstaffReadAt', v_read,
    'required', coalesce(v_required,0),
    'people', CASE WHEN v_read IS NOT NULL AND v_read>=v_day_end THEN v_people ELSE '[]'::jsonb END,
    'note', CASE WHEN v_read IS NULL OR v_read<v_day_end
      THEN format('Hubstaff has not been read since %s ended, so nobody is listed.', to_char(p_day,'Dy DD Mon'))
      ELSE NULL END);
END $$;

-- 5. One row of state and one audit row per run (service only).
CREATE OR REPLACE FUNCTION public.cockpit_hours_nudge_finish(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_ok boolean; v_note text; v_listed integer;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p->'ok') IS DISTINCT FROM 'boolean'
     OR coalesce(p->>'day','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR length(coalesce(p->>'note',''))>500 THEN
    RAISE EXCEPTION 'Invalid nudge run' USING ERRCODE='22023';
  END IF;
  v_ok := (p->>'ok')::boolean; v_note := nullif(btrim(p->>'note'),''); v_listed := nullif(p->>'listed','')::integer;
  INSERT INTO public.cockpit_sync_state(key,last_run_at,last_ok_at,ok,note,rows_seen,updated_at)
  VALUES('hours-nudge',now(),CASE WHEN v_ok THEN now() END,v_ok,v_note,v_listed,now())
  ON CONFLICT (key) DO UPDATE SET last_run_at=now(),
    last_ok_at=CASE WHEN v_ok THEN now() ELSE public.cockpit_sync_state.last_ok_at END,
    ok=v_ok,note=EXCLUDED.note,rows_seen=EXCLUDED.rows_seen,updated_at=now();
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
  VALUES('hours.nudge','cockpit_settings','hours.nudge','service-role','ceo','supabase',NULL,
    jsonb_build_object('day',p->>'day','ok',v_ok,'sent',coalesce((p->>'sent')::boolean,false),'listed',v_listed,'note',v_note,
      'people',coalesce(p->'people','[]'::jsonb)));
  RETURN jsonb_build_object('ok',true);
END $$;

REVOKE ALL ON FUNCTION public.cockpit_hours_nudge_list(date), public.cockpit_hours_nudge_finish(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_hours_nudge_list(date), public.cockpit_hours_nudge_finish(jsonb) TO service_role;

-- 6. The daily kick.
CREATE OR REPLACE FUNCTION public.cockpit_hours_nudge_kick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_url constant text := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-hours-sync';
  v_secret text;
  v_request bigint;
BEGIN
  SELECT ds.decrypted_secret INTO v_secret FROM vault.decrypted_secrets ds WHERE ds.name='cockpit_sync_secret' LIMIT 1;
  IF v_secret IS NULL OR btrim(v_secret)='' THEN
    INSERT INTO public.cockpit_sync_state(key,last_run_at,ok,note,updated_at)
    VALUES('hours-nudge',now(),false,'The vault has no cockpit_sync_secret, so the morning hours note was not started. Add it to the vault.',now())
    ON CONFLICT (key) DO UPDATE SET last_run_at=now(),ok=false,note=EXCLUDED.note,updated_at=now();
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := v_url,
    body := jsonb_build_object('op','nudge'),
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',v_secret),
    timeout_milliseconds := 5000) INTO v_request;
  RETURN v_request;
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_hours_nudge_kick() FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname='mahara-hours-nudge';
SELECT cron.schedule('mahara-hours-nudge','5 6 * * *',$job$SELECT public.cockpit_hours_nudge_kick();$job$);

NOTIFY pgrst, 'reload schema';

COMMIT;
