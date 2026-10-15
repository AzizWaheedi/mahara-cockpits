-- Hubstaff watch: who is working right now, who is not, and the proof.
--
-- The CEO, 2026-10-13: "I need a really easy way to be alerted, maybe on
-- Slack in a management channel and on the CEO cockpit in the management
-- section ... if anybody's been doing something that's not work or hasn't had
-- Hubstaff on." The contract is docs/hours-watch/SPEC.md; names, payloads and
-- defaults below follow it.
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Apply after 20261009a, 20261009b and
-- 20261011e, and before the next ship of the media buyer cockpit: ship.sh's
-- auth preflight refuses while code calls a cockpit_ function production
-- lacks. Safe to apply twice: tables IF NOT EXISTS, functions CREATE OR
-- REPLACE, the settings seed never overwrites, the job is unscheduled by name
-- before it is scheduled again. The vault, pg_net, pg_cron and storage are
-- touched only inside guarded dynamic SQL, so the file loads in PGlite.
--
--   cockpit_settings 'hours.watch'            the switches, thresholds and the Slack mention (seeded once, on)
--   cockpit_hours_watch_runs                  one row per run, with its own 6-minute lease
--   cockpit_hours_watch_status                one row per watched person: the state right now
--   cockpit_hours_watch_slots                 10-minute blocks for the shift line (14 days)
--   cockpit_hours_watch_shots                 each screenshot read once (30 days; flagged images 90)
--   cockpit_hours_watch_incidents             one alert per person and kind; kept for good
--   cockpit_hours_watch_keys                  the vision model key (no grant to any role)
--   bucket cockpit-hours-watch                private copies of not-work screenshots, CEO read only
--   mahara-hours-watch                        pg_cron, every 5 minutes, posts {"job":"watch"}
--
-- Who is watched is the Hours and pay rule, unchanged: tracking is required
-- (the person's terms, else cockpit_hours_role_default: call centre agents and
-- the media buyer), active and not a bot. Who is on shift: the schedule in
-- force that day (cockpit_schedule_history, else cockpit_people.schedule, else
-- Saturday to Thursday 10:00 to 18:00 Asia/Kuwait), the date's exception
-- before the weekday, wall clock in the schedule's time zone; not on a public
-- holiday (cockpit_hours_holidays_json), not on pending or approved Timetastic
-- leave over the whole shift (as cockpit_hours_nudge_list; part-day leave is
-- passed as windows inside the shift), employed and not paused that day
-- (cockpit_employment_periods) and not past ended_on. Someone paid by the hour
-- with no schedule at all is not watched (no_schedule), as Hours and pay
-- expects nothing of them. When a source cannot be read nobody is alerted
-- about: missing is never zero.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Settings, seeded once and never overwritten

CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_defaults()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT '{"on":true,"shots":true,"channel":"C0B5TL9H370","channelName":"team-management","notTrackingMinutes":30,"graceMinutes":15,"idleMinutes":30,"idleFloorPct":10,"windowMinutes":30,"nonWorkShots":2,"minConfidence":0.75,"mention":true,"mentionUser":"U09305KE2KS"}'::jsonb
$$;

INSERT INTO public.cockpit_settings(key,value,updated_by)
VALUES('hours.watch',public.cockpit_hours_watch_defaults(),'migration 20261013d')
ON CONFLICT (key) DO NOTHING;

/** Why one setting's value is refused, in plain words; NULL when it is fine. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_setting_problem(p_key text,p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE n numeric; lo numeric; hi numeric; label text;
BEGIN
  IF p_key IN ('on','shots','mention') THEN
    IF jsonb_typeof(p_value) IS DISTINCT FROM 'boolean' THEN
      RETURN CASE p_key WHEN 'on' THEN 'Choose on or off for Slack alerts' WHEN 'shots' THEN 'Choose on or off for the screenshot check'
        ELSE 'Choose on or off for the mention in each alert' END;
    END IF;
    RETURN NULL;
  ELSIF p_key='mentionUser' THEN
    IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR (p_value#>>'{}') !~ '^[UW][A-Z0-9]{8,12}$' THEN
      RETURN 'A Slack user id starts with U or W, then 8 to 12 capital letters or digits';
    END IF;
    RETURN NULL;
  ELSIF p_key='channel' THEN
    IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR (p_value#>>'{}') !~ '^[CG][A-Z0-9]{8,12}$' THEN
      RETURN 'A Slack channel id starts with C or G, then 8 to 12 capital letters or digits';
    END IF;
    RETURN NULL;
  ELSIF p_key='channelName' THEN
    IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR (p_value#>>'{}') !~ '^[a-z0-9][a-z0-9._-]{0,79}$' THEN
      RETURN 'Write the channel name in lower case, without the #';
    END IF;
    RETURN NULL;
  END IF;
  SELECT b.lo,b.hi,b.label INTO lo,hi,label FROM (VALUES
    ('notTrackingMinutes',10::numeric,240::numeric,'Alert after Hubstaff is off for'),
    ('graceMinutes',0,120,'Grace after the shift starts'),
    ('idleMinutes',20,240,'Keyboard and mouse measured over'),
    ('idleFloorPct',1,50,'Keyboard and mouse below'),
    ('windowMinutes',20,120,'Screenshots looked at over'),
    ('nonWorkShots',1,6,'Screenshots off work'),
    ('minConfidence',0.5,0.99,'Only when the check is at least')) AS b(k,lo,hi,label)
  WHERE b.k=p_key;
  IF label IS NULL THEN RETURN format('There is no setting called %s', left(coalesce(p_key,''),40)); END IF;
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN
    RETURN format('%s: choose a number', label);
  END IF;
  n:=(p_value#>>'{}')::numeric;
  IF p_key='minConfidence' THEN
    IF n<lo OR n>hi THEN RETURN format('%s: choose from 50%% to 99%%', label); END IF;
  ELSIF n<>trunc(n) OR n<lo OR n>hi THEN
    RETURN format('%s: choose a whole number from %s to %s', label, lo, hi);
  END IF;
  RETURN NULL;
END;
$$;

/** The settings in force: the defaults, overlaid with every stored value that passes its check. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.cockpit_hours_watch_defaults()||coalesce((
    SELECT jsonb_object_agg(e.key,e.value)
    FROM public.cockpit_settings s
    CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(s.value)='object' THEN s.value ELSE '{}'::jsonb END) e
    WHERE s.key='hours.watch' AND public.cockpit_hours_watch_defaults() ? e.key
      AND public.cockpit_hours_watch_setting_problem(e.key,e.value) IS NULL),'{}'::jsonb)
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables

CREATE TABLE IF NOT EXISTS public.cockpit_hours_watch_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  state text NOT NULL DEFAULT 'running' CHECK (state IN ('running','ok','failed','abandoned')),
  holder uuid NOT NULL,
  lease_until timestamptz NOT NULL,
  dry_run boolean NOT NULL DEFAULT false,
  requested_by text NOT NULL DEFAULT 'cron' CHECK (length(requested_by)<=200),
  result jsonb,
  error text CHECK (error IS NULL OR length(error)<=240)
);
COMMENT ON TABLE public.cockpit_hours_watch_runs IS
  'One row per Hubstaff watch run (cockpit-hours-watch, every 5 minutes). Its own lease, independent of the hourly hours read. Kept 30 days.';
-- At most one run holds the lease, whatever the advisory lock does.
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_hours_watch_runs_running_uidx ON public.cockpit_hours_watch_runs((true)) WHERE state='running';
CREATE INDEX IF NOT EXISTS cockpit_hours_watch_runs_started_idx ON public.cockpit_hours_watch_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_hours_watch_status (
  person_id bigint PRIMARY KEY REFERENCES public.cockpit_people(id),
  state text NOT NULL CHECK (state IN ('tracking','not_tracking','on_break','idle','not_work','off_shift','on_leave','holiday','no_account','cant_tell')),
  since timestamptz,
  shift_start timestamptz,
  shift_end timestamptz,
  online boolean,
  last_activity_at timestamptz,
  tracked_today_s integer CHECK (tracked_today_s IS NULL OR tracked_today_s BETWEEN 0 AND 86400),
  active_pct_30m numeric(5,2) CHECK (active_pct_30m IS NULL OR active_pct_30m BETWEEN 0 AND 100),
  screenshots_on boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  run_id bigint,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail)='object')
);
COMMENT ON TABLE public.cockpit_hours_watch_status IS
  'The Hubstaff watch''s state per watched person, written by each run. A row older than 15 minutes reads as cant_tell on the board, never as working.';
-- on_break (2026-10-13 final round): stopped inside the allowed lunch wait, no alert yet. A table made
-- before it keeps the old list, so the check is replaced by name (safe to apply twice).
ALTER TABLE public.cockpit_hours_watch_status DROP CONSTRAINT IF EXISTS cockpit_hours_watch_status_state_check;
ALTER TABLE public.cockpit_hours_watch_status ADD CONSTRAINT cockpit_hours_watch_status_state_check
  CHECK (state IN ('tracking','not_tracking','on_break','idle','not_work','off_shift','on_leave','holiday','no_account','cant_tell'));

CREATE TABLE IF NOT EXISTS public.cockpit_hours_watch_slots (
  person_id bigint NOT NULL REFERENCES public.cockpit_people(id),
  slot_start timestamptz NOT NULL,
  tracked_s integer NOT NULL CHECK (tracked_s BETWEEN 0 AND 3600),
  overall_s integer NOT NULL CHECK (overall_s BETWEEN 0 AND 3600),
  idle boolean NOT NULL DEFAULT false,
  PRIMARY KEY (person_id, slot_start)
);
COMMENT ON TABLE public.cockpit_hours_watch_slots IS
  'Hubstaff 10-minute blocks (tracked and keyboard and mouse seconds) for the shift line. Kept 14 days.';
-- The block's computer time (Hubstaff input_tracked): keyboard and mouse share is overall / input_tracked,
-- because phone and web timer time has no activity level. Null when the run did not send it.
ALTER TABLE public.cockpit_hours_watch_slots ADD COLUMN IF NOT EXISTS input_tracked_s integer
  CHECK (input_tracked_s IS NULL OR input_tracked_s BETWEEN 0 AND 3600);

CREATE TABLE IF NOT EXISTS public.cockpit_hours_watch_shots (
  shot_id bigint PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES public.cockpit_people(id),
  hubstaff_user_id text NOT NULL CHECK (length(hubstaff_user_id)<=40),
  recorded_at timestamptz NOT NULL,
  slot_start timestamptz,
  verdict text NOT NULL DEFAULT 'pending' CHECK (verdict IN ('pending','work','not_work','unclear','error','skipped')),
  label text CHECK (label IS NULL OR length(label)<=120),
  reason text CHECK (reason IS NULL OR length(reason)<=240),
  category text CHECK (category IS NULL OR length(category)<=40),
  confidence numeric(4,3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  model text CHECK (model IS NULL OR length(model)<=80),
  apps jsonb CHECK (apps IS NULL OR jsonb_typeof(apps) IN ('array','object')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  classified_at timestamptz,
  thumb_path text CHECK (thumb_path IS NULL OR (length(thumb_path)<=300 AND thumb_path !~ '\.\.')),
  full_path text CHECK (full_path IS NULL OR (length(full_path)<=300 AND full_path !~ '\.\.')),
  error text CHECK (error IS NULL OR length(error)<=240),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cockpit_hours_watch_shots IS
  'Each Hubstaff screenshot read once by the vision check. Only not-work ones keep a copy (thumb_path, full_path in the private bucket cockpit-hours-watch). Kept 30 days; rows with stored images 90 days.';
CREATE INDEX IF NOT EXISTS cockpit_hours_watch_shots_person_idx ON public.cockpit_hours_watch_shots(person_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS cockpit_hours_watch_shots_thumb_idx ON public.cockpit_hours_watch_shots(thumb_path) WHERE thumb_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS cockpit_hours_watch_shots_full_idx ON public.cockpit_hours_watch_shots(full_path) WHERE full_path IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cockpit_hours_watch_incidents (
  id bigserial PRIMARY KEY,
  person_id bigint REFERENCES public.cockpit_people(id),
  kind text NOT NULL CHECK (kind IN ('not_tracking','not_work','idle','source')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  close_reason text CHECK (close_reason IS NULL OR length(close_reason)<=60),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail)='object'),
  slack_channel text CHECK (slack_channel IS NULL OR slack_channel ~ '^[CG][A-Z0-9]{8,12}$'),
  slack_ts text CHECK (slack_ts IS NULL OR slack_ts ~ '^[0-9]{1,12}\.[0-9]{1,8}$'),
  slack_state text NOT NULL DEFAULT 'pending' CHECK (slack_state IN ('pending','sending','posted','failed','unknown','muted')),
  slack_error text CHECK (slack_error IS NULL OR length(slack_error)<=240),
  resolve_state text NOT NULL DEFAULT 'none' CHECK (resolve_state IN ('none','pending','sending','posted','failed','unknown','muted')),
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text CHECK (review_note IS NULL OR length(review_note)<=300),
  run_id bigint,
  CHECK ((kind='source')=(person_id IS NULL)),
  CHECK (closed_at IS NULL OR closed_at>=opened_at),
  CHECK (slack_state<>'posted' OR slack_ts IS NOT NULL)
);
COMMENT ON TABLE public.cockpit_hours_watch_incidents IS
  'Hubstaff watch alerts: one open per person and kind (source has no person). Posted once to Slack, replied to once in the thread when it clears. Kept for good.';
-- When a post or reply was claimed (pending -> sending). A claim with no answer
-- after 10 minutes is swept to unknown by the next apply: it may have arrived,
-- so it is never sent again, but it never reads "Sending" for good either.
ALTER TABLE public.cockpit_hours_watch_incidents ADD COLUMN IF NOT EXISTS slack_claimed_at timestamptz;
ALTER TABLE public.cockpit_hours_watch_incidents ADD COLUMN IF NOT EXISTS resolve_claimed_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_hours_watch_incidents_open_uidx
  ON public.cockpit_hours_watch_incidents((coalesce(person_id,0)), kind) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS cockpit_hours_watch_incidents_closed_idx ON public.cockpit_hours_watch_incidents(closed_at DESC) WHERE closed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cockpit_hours_watch_keys (
  provider text PRIMARY KEY CHECK (provider IN ('google_ai','openai')),
  secret text NOT NULL CHECK (length(secret) BETWEEN 10 AND 4000),
  last4 text,
  saved_by text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'unchecked' CHECK (state IN ('connected','refused','unchecked')),
  state_note text CHECK (state_note IS NULL OR length(state_note)<=240),
  checked_at timestamptz
);
COMMENT ON TABLE public.cockpit_hours_watch_keys IS
  'The vision model key for the screenshot check, pasted by the CEO. No role has any grant: reached only through service-only SECURITY DEFINER functions. Nothing returns a key to a browser.';

-- Row security on every table, every grant revoked, then the service path reads.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_hours_watch_runs','cockpit_hours_watch_status','cockpit_hours_watch_slots','cockpit_hours_watch_shots',
    'cockpit_hours_watch_incidents','cockpit_hours_watch_keys'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['cockpit_hours_watch_runs_id_seq','cockpit_hours_watch_incidents_id_seq'] LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $$;
GRANT SELECT ON public.cockpit_hours_watch_runs, public.cockpit_hours_watch_status, public.cockpit_hours_watch_slots,
  public.cockpit_hours_watch_shots, public.cockpit_hours_watch_incidents TO service_role;
-- cockpit_hours_watch_keys: no grant to any role, service_role included.

-- Model and storage calls are receipted in the hours ledger beside Hubstaff and Slack.
-- Storage removals (the daily prune) are DELETE requests.
ALTER TABLE public.cockpit_hours_provider_health DROP CONSTRAINT IF EXISTS cockpit_hours_provider_health_provider_check;
ALTER TABLE public.cockpit_hours_provider_health ADD CONSTRAINT cockpit_hours_provider_health_provider_check
  CHECK (provider IN ('hubstaff','hubstaff-auth','timetastic','slack','google-ai','openai','storage'));
ALTER TABLE public.cockpit_hours_provider_health DROP CONSTRAINT IF EXISTS cockpit_hours_provider_health_method_check;
ALTER TABLE public.cockpit_hours_provider_health ADD CONSTRAINT cockpit_hours_provider_health_method_check
  CHECK (method IN ('GET','POST','DELETE'));

-- ---------------------------------------------------------------------------
-- 3. Guards: an alert never reopens, never changes person or kind, and each
--    Slack post moves pending, sending, then posted, failed or unknown once
--    (the apply's 10-minute sweep is a sending -> unknown move).

CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_incident_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.kind<>OLD.kind OR NEW.opened_at<>OLD.opened_at THEN
    RAISE EXCEPTION 'An alert''s person, kind and opening time never change' USING ERRCODE='55000';
  END IF;
  IF OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'A closed alert stays closed: a new one opens instead' USING ERRCODE='55000';
  END IF;
  IF OLD.slack_ts IS NOT NULL AND NEW.slack_ts IS DISTINCT FROM OLD.slack_ts THEN
    RAISE EXCEPTION 'An alert''s Slack message never changes once posted' USING ERRCODE='55000';
  END IF;
  IF NEW.slack_state<>OLD.slack_state AND NOT (
       (OLD.slack_state='pending' AND NEW.slack_state IN ('sending','muted'))
    OR (OLD.slack_state='sending' AND NEW.slack_state IN ('posted','failed','unknown'))) THEN
    RAISE EXCEPTION 'A Slack post goes from % to % only once it is claimed', OLD.slack_state, NEW.slack_state USING ERRCODE='55000';
  END IF;
  IF NEW.resolve_state<>OLD.resolve_state AND NOT (
       (OLD.resolve_state='none' AND OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND NEW.resolve_state IN ('pending','muted'))
    OR (OLD.resolve_state='pending' AND NEW.resolve_state IN ('sending','muted'))
    OR (OLD.resolve_state='sending' AND NEW.resolve_state IN ('posted','failed','unknown'))) THEN
    RAISE EXCEPTION 'A Slack reply goes from % to % only once it is claimed', OLD.resolve_state, NEW.resolve_state USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cockpit_hours_watch_incidents_guard ON public.cockpit_hours_watch_incidents;
CREATE TRIGGER cockpit_hours_watch_incidents_guard BEFORE UPDATE ON public.cockpit_hours_watch_incidents
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_hours_watch_incident_guard();
DROP TRIGGER IF EXISTS cockpit_hours_watch_incidents_guard_delete ON public.cockpit_hours_watch_incidents;
CREATE TRIGGER cockpit_hours_watch_incidents_guard_delete BEFORE DELETE ON public.cockpit_hours_watch_incidents
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_hours_refuse_delete();
DROP TRIGGER IF EXISTS cockpit_hours_watch_incidents_guard_truncate ON public.cockpit_hours_watch_incidents;
CREATE TRIGGER cockpit_hours_watch_incidents_guard_truncate BEFORE TRUNCATE ON public.cockpit_hours_watch_incidents
  FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_hours_refuse_delete();

-- ---------------------------------------------------------------------------
-- 4. Who is on shift

/** The team standard when a person has no schedule: Saturday to Thursday, 10:00 to 18:00 Kuwait. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_default_schedule()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_build_object('timezone','Asia/Kuwait','exceptions','[]'::jsonb,'week',
    (SELECT jsonb_object_agg(d,jsonb_build_object('on',d<>'fri','start','10:00','end','18:00'))
       FROM unnest(ARRAY['mon','tue','wed','thu','fri','sat','sun']) d))
$$;

/**
 * One person's window on one day: {timezone, day, source, dayOff, start, end}.
 * The schedule in force that day, the date's exception before the weekday,
 * wall clock in the schedule's time zone. A time that is not HH:MM, or an end
 * not after the start, falls back to 10:00 to 18:00 (cockpit_people_schedule_check
 * refuses both on save).
 */
CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_window(p_person bigint,p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_s jsonb; v_src text:='history'; v_tz text; v_ex jsonb; v_wd jsonb; v_off boolean:=false; v_start text; v_end text;
  v_hhmm constant text:='^([01][0-9]|2[0-3]):[0-5][0-9]$';
BEGIN
  SELECT h.schedule INTO v_s FROM public.cockpit_schedule_history h
    WHERE h.person_id=p_person AND h.effective_from<=p_day ORDER BY h.effective_from DESC LIMIT 1;
  IF v_s IS NULL OR jsonb_typeof(v_s)<>'object' OR jsonb_typeof(v_s->'week') IS DISTINCT FROM 'object' THEN
    v_src:='roster';
    SELECT p.schedule INTO v_s FROM public.cockpit_people p WHERE p.id=p_person;
  END IF;
  IF v_s IS NULL OR jsonb_typeof(v_s)<>'object' OR jsonb_typeof(v_s->'week') IS DISTINCT FROM 'object' THEN
    v_src:='default';
    v_s:=public.cockpit_hours_watch_default_schedule();
  END IF;
  v_tz:=coalesce(nullif(btrim(v_s->>'timezone'),''),'Asia/Kuwait');
  BEGIN
    PERFORM (p_day::timestamp AT TIME ZONE v_tz);
  EXCEPTION WHEN others THEN v_tz:='Asia/Kuwait';
  END;
  SELECT e INTO v_ex FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_s->'exceptions')='array' THEN v_s->'exceptions' ELSE '[]'::jsonb END) e
    WHERE jsonb_typeof(e)='object' AND e->>'date'=to_char(p_day,'YYYY-MM-DD') LIMIT 1;
  v_wd:=v_s->'week'->lower(to_char(p_day,'dy'));
  IF v_ex IS NOT NULL AND v_ex->'off'='true'::jsonb THEN
    v_off:=true;
  ELSIF v_ex IS NOT NULL THEN
    v_start:=coalesce(v_ex->>'start',v_wd->>'start'); v_end:=coalesce(v_ex->>'end',v_wd->>'end');
  ELSIF v_wd->'on'='true'::jsonb THEN
    v_start:=v_wd->>'start'; v_end:=v_wd->>'end';
  ELSE
    v_off:=true;
  END IF;
  IF NOT v_off AND (coalesce(v_start,'') !~ v_hhmm OR coalesce(v_end,'') !~ v_hhmm OR v_start>=v_end) THEN
    v_start:='10:00'; v_end:='18:00';
  END IF;
  RETURN jsonb_build_object('timezone',v_tz,'day',to_char(p_day,'YYYY-MM-DD'),'source',v_src,'dayOff',v_off,
    'start',CASE WHEN NOT v_off THEN (p_day+v_start::time) AT TIME ZONE v_tz END,
    'end',CASE WHEN NOT v_off THEN (p_day+v_end::time) AT TIME ZONE v_tz END);
END;
$$;

/** The window for "today" in the person's own schedule time zone at p_now. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_today(p_person bigint,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE w jsonb; v_local date;
BEGIN
  w:=public.cockpit_hours_watch_window(p_person,(p_now AT TIME ZONE 'Asia/Kuwait')::date);
  v_local:=(p_now AT TIME ZONE (w->>'timezone'))::date;
  IF v_local<>(w->>'day')::date THEN w:=public.cockpit_hours_watch_window(p_person,v_local); END IF;
  RETURN w;
END;
$$;

/**
 * The Timetastic leave inside one shift, as merged windows [{start, end}]
 * (instants, clipped to the shift, oldest first). Pending and approved
 * bookings, unless the CEO marked one not taken (as cockpit_hours_nudge_list).
 * Days bookings: an Afternoon start on the first day is the shift's midpoint
 * to its end, a Morning end on the last day its start to the midpoint (the
 * Hours tab's dayParts: an Afternoon start wins when both fall on the day),
 * any other covered day the whole shift. Hours bookings: start_at..end_at as
 * wall clock in the schedule's time zone (a day inside a longer booking is
 * the whole shift). A window that misses the shift is dropped.
 */
CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_leave(p_person bigint,p_day date,p_tz text,p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH b AS (
    SELECT DISTINCT b.booking_id,b.start_at,b.start_type,b.end_at,b.end_type,
      (b.booking_unit='Hours' OR b.start_type='Hours' OR b.end_type='Hours') AS by_hours
    FROM public.cockpit_time_accounts a
    JOIN public.cockpit_timetastic_bookings b ON b.tt_user_id=a.external_id AND b.status IN ('Pending','Approved') AND b.gone_at IS NULL
      AND b.start_at::date<=p_day AND p_day<=b.end_at::date
    WHERE a.provider='timetastic' AND a.person_id=p_person AND NOT a.ignored
      AND p_start IS NOT NULL AND p_end>p_start
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_time_adjustments j
                      WHERE j.kind='not_booked' AND j.booking_id=b.booking_id AND j.withdrawn_at IS NULL)
  ), w AS (
    SELECT
      CASE WHEN b.by_hours THEN greatest(p_start,CASE WHEN b.start_at::date=p_day THEN b.start_at AT TIME ZONE p_tz ELSE p_start END)
           WHEN b.start_at::date=p_day AND b.start_type='Afternoon' THEN p_start+(p_end-p_start)/2
           ELSE p_start END AS s,
      CASE WHEN b.by_hours THEN least(p_end,CASE WHEN b.end_at::date=p_day THEN b.end_at AT TIME ZONE p_tz ELSE p_end END)
           WHEN b.start_at::date=p_day AND b.start_type='Afternoon' THEN p_end
           WHEN b.end_at::date=p_day AND b.end_type='Morning' THEN p_start+(p_end-p_start)/2
           ELSE p_end END AS e
    FROM b
  ), g AS (
    -- Overlapping or touching windows merge into one.
    SELECT w.s,w.e,CASE WHEN w.s<=max(w.e) OVER (ORDER BY w.s,w.e ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) THEN 0 ELSE 1 END AS brk
    FROM w WHERE w.e>w.s
  ), m AS (
    SELECT g.s,g.e,sum(g.brk) OVER (ORDER BY g.s,g.e ROWS UNBOUNDED PRECEDING) AS grp FROM g
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('start',x.s,'end',x.e) ORDER BY x.s),'[]'::jsonb)
  FROM (SELECT min(m.s) AS s,max(m.e) AS e FROM m GROUP BY m.grp) x
$$;

/**
 * Everyone the watch looks at, at p_now: required to track (terms, else the
 * role default), active, not a bot. offReason says why someone is not on
 * shift today; shift is null whenever offReason is set. Someone paid by the
 * hour (terms pay_basis, else the role default) with no schedule at all is
 * no_schedule, as Hours and pay and the morning note expect nothing of them;
 * fixed pay keeps the team standard. leave lists the part-day Timetastic
 * windows inside today's shift; leave over the whole shift is offReason leave.
 */
CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_roster(p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; w jsonb; v_day date; v_hub text; v_status text; v_off text; v_shots boolean; v_leave jsonb; out jsonb:='[]'::jsonb;
BEGIN
  FOR r IN
    SELECT p.id,p.name,p.role,p.ended_on,coalesce(t.pay_basis,d.pay_basis) AS pay_basis FROM public.cockpit_people p
    LEFT JOIN public.cockpit_hours_terms t ON t.person_id=p.id
    CROSS JOIN LATERAL public.cockpit_hours_role_default(p.role,p.engagement) d
    WHERE p.active AND p.engagement<>'bot' AND coalesce(t.tracking,d.tracking)='required'
    ORDER BY lower(p.name),p.id
  LOOP
    w:=public.cockpit_hours_watch_today(r.id,p_now);
    v_day:=(w->>'day')::date;
    v_hub:=public.cockpit_hours_account_id(r.id,'hubstaff');
    v_status:=NULL;
    IF v_hub IS NOT NULL THEN
      SELECT coalesce(a.status,'unknown') INTO v_status FROM public.cockpit_time_accounts a WHERE a.provider='hubstaff' AND a.external_id=v_hub;
    END IF;
    v_off:=CASE
      WHEN (r.ended_on IS NOT NULL AND r.ended_on<v_day)
        OR NOT EXISTS (SELECT 1 FROM public.cockpit_employment_periods e WHERE e.person_id=r.id AND e.kind='employed'
                       AND e.from_day<=v_day AND (e.to_day IS NULL OR v_day<=e.to_day)) THEN 'not_employed'
      WHEN EXISTS (SELECT 1 FROM public.cockpit_employment_periods e WHERE e.person_id=r.id AND e.kind='paused'
                   AND e.from_day<=v_day AND (e.to_day IS NULL OR v_day<=e.to_day)) THEN 'paused'
      -- No schedule history and none on the roster (the window fell back to the default): pay that follows hours expects nothing.
      WHEN w->>'source'='default' AND r.pay_basis IS DISTINCT FROM 'fixed' THEN 'no_schedule'
      WHEN (w->>'dayOff')::boolean THEN 'day_off'
      WHEN jsonb_array_length(public.cockpit_hours_holidays_json(r.id,v_day,v_day))>0 THEN 'holiday'
      ELSE NULL END;
    v_leave:='[]'::jsonb;
    IF v_off IS NULL THEN
      v_leave:=public.cockpit_hours_watch_leave(r.id,v_day,w->>'timezone',(w->>'start')::timestamptz,(w->>'end')::timestamptz);
      -- Leave over the whole shift (one booking, or a morning and an afternoon together) is a day off for the watch.
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_leave) l
                 WHERE (l->>'start')::timestamptz<=(w->>'start')::timestamptz AND (l->>'end')::timestamptz>=(w->>'end')::timestamptz) THEN
        v_off:='leave'; v_leave:='[]'::jsonb;
      END IF;
    END IF;
    SELECT s.screenshots_on INTO v_shots FROM public.cockpit_hours_watch_status s WHERE s.person_id=r.id;
    IF NOT FOUND THEN v_shots:=NULL; END IF;
    out:=out||jsonb_build_array(jsonb_build_object(
      'personId',r.id,'name',r.name,'role',r.role,'hubstaffUserId',v_hub,'accountStatus',coalesce(v_status,'none'),
      'timezone',w->>'timezone','day',w->>'day',
      'shift',CASE WHEN v_off IS NULL THEN jsonb_build_object('start',w->'start','end',w->'end') END,
      'offReason',v_off,'leave',v_leave,'screenshotsOn',v_shots));
  END LOOP;
  RETURN out;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_incident_json(i public.cockpit_hours_watch_incidents)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',i.id,'personId',i.person_id,'kind',i.kind,'openedAt',i.opened_at,'lastSeenAt',i.last_seen_at,
    'closedAt',i.closed_at,'closeReason',i.close_reason,'detail',i.detail,'slackChannel',i.slack_channel,'slackTs',i.slack_ts,
    'slackState',i.slack_state,'slackError',i.slack_error,'resolveState',i.resolve_state,'reviewedAt',i.reviewed_at,
    'name',(SELECT p.name FROM public.cockpit_people p WHERE p.id=i.person_id),
    'role',(SELECT p.role FROM public.cockpit_people p WHERE p.id=i.person_id))
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_cron_on()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v boolean:=false;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT count(*)>0 FROM cron.job WHERE jobname=''mahara-hours-watch'' AND active' INTO v;
    EXCEPTION WHEN others THEN v:=false;
    END;
  END IF;
  RETURN coalesce(v,false);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Service RPCs (cockpit-hours-watch and cockpit-hours-api with the service key)

CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_lease_claim(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_hours_watch_runs; v_by text; v_id bigint; v_holder uuid:=gen_random_uuid();
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF p IS NOT NULL AND jsonb_typeof(p)<>'object' THEN RAISE EXCEPTION 'A watch run is asked for with an object' USING ERRCODE='22023'; END IF;
  v_by:=coalesce(nullif(btrim(p->>'requestedBy'),''),'cron');
  IF v_by<>'cron' AND v_by !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'A watch run is requested by cron or a verified email' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p->'dryRun') NOT IN ('boolean','null') THEN RAISE EXCEPTION 'dryRun is true or false' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cockpit_hours_watch_lease'));
  UPDATE public.cockpit_hours_watch_runs SET state='abandoned',finished_at=now(),error=coalesce(error,'The lease ran out before the run finished')
    WHERE state='running' AND lease_until<now();
  SELECT * INTO r FROM public.cockpit_hours_watch_runs WHERE state='running' ORDER BY started_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok',false,'busy',true,'since',r.started_at,'runId',r.id); END IF;
  INSERT INTO public.cockpit_hours_watch_runs(holder,lease_until,dry_run,requested_by)
  VALUES(v_holder,now()+interval '6 minutes',coalesce((p->>'dryRun')::boolean,false),v_by)
  RETURNING id INTO v_id;
  -- Check now is the CEO's action; the five-minute schedule is not audited.
  IF v_by<>'cron' THEN
    PERFORM public.cockpit_hours_audit('hours.watch.runNow','cockpit_hours_watch_runs',v_id::text,
      jsonb_build_object('dryRun',coalesce((p->>'dryRun')::boolean,false)),v_by);
  END IF;
  RETURN jsonb_build_object('ok',true,'runId',v_id,'leaseToken',v_holder);
END;
$$;

/**
 * What one run needs: the settings, who is on shift, the open alerts, the
 * screenshots already read, the Hours rules' lunch break (cockpit_hours_rules
 * in force for the Kuwait month, else 60 minutes when the shift is longer
 * than 6 hours), when a run last finished ok (the source alert waits 10
 * minutes from it), the Kuwait day of the last prune, and the thread replies
 * still due from alerts closed in the last 24 hours.
 */
CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_inputs(p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz:=coalesce(p_now,now()); v_rules jsonb; v_break numeric; v_longer numeric; v_prune timestamptz;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  SELECT r.settings INTO v_rules FROM public.cockpit_hours_rules r
    WHERE r.from_month<=date_trunc('month',v_now AT TIME ZONE 'Asia/Kuwait')::date ORDER BY r.from_month DESC LIMIT 1;
  -- The same bounds cockpit_ceo_hours_rules_save enforces; anything else reads as the default.
  v_break:=CASE WHEN jsonb_typeof(v_rules->'breakMinutes')='number' AND (v_rules->>'breakMinutes')::numeric BETWEEN 0 AND 600
    THEN (v_rules->>'breakMinutes')::numeric ELSE 60 END;
  v_longer:=CASE WHEN jsonb_typeof(v_rules->'breakWhenLongerThanHours')='number' AND (v_rules->>'breakWhenLongerThanHours')::numeric>0
      AND (v_rules->>'breakWhenLongerThanHours')::numeric<=24
    THEN (v_rules->>'breakWhenLongerThanHours')::numeric ELSE 6 END;
  SELECT coalesce(s.last_ok_at,CASE WHEN s.ok THEN s.last_run_at END) INTO v_prune FROM public.cockpit_sync_state s WHERE s.key='hours-watch-prune';
  RETURN jsonb_build_object(
    'settings',public.cockpit_hours_watch_settings(),
    'now',v_now,
    'rules',jsonb_build_object('breakMinutes',v_break,'breakWhenLongerThanHours',v_longer),
    -- When the newest run that finished ok started: its Hubstaff read is the last good one.
    'lastOkRunAt',(SELECT r.started_at FROM public.cockpit_hours_watch_runs r WHERE r.state='ok' AND NOT r.dry_run
                   ORDER BY r.started_at DESC LIMIT 1),
    'lastPruneOn',CASE WHEN v_prune IS NOT NULL THEN to_char((v_prune AT TIME ZONE 'Asia/Kuwait')::date,'YYYY-MM-DD') END,
    'people',public.cockpit_hours_watch_roster(v_now),
    'open',(SELECT coalesce(jsonb_agg(public.cockpit_hours_watch_incident_json(i) ORDER BY i.id),'[]'::jsonb)
            FROM public.cockpit_hours_watch_incidents i WHERE i.closed_at IS NULL),
    'replies',(SELECT coalesce(jsonb_agg(public.cockpit_hours_watch_incident_json(i) ORDER BY i.id),'[]'::jsonb)
            FROM public.cockpit_hours_watch_incidents i
            WHERE i.closed_at IS NOT NULL AND i.closed_at>=v_now-interval '24 hours' AND i.resolve_state='pending'),
    'knownShots',(SELECT coalesce(jsonb_agg(jsonb_build_object('shotId',s.shot_id,'verdict',s.verdict,'attempts',s.attempts,
              'personId',s.person_id,'recordedAt',s.recorded_at,'confidence',s.confidence,'label',s.label) ORDER BY s.shot_id),'[]'::jsonb)
            FROM public.cockpit_hours_watch_shots s WHERE s.recorded_at>=v_now-interval '3 hours'));
END;
$$;

/**
 * One run's writes, under its lease: statuses and slots upserted, shots
 * upserted (a judged verdict is never replaced by pending, error or skipped),
 * then touches, closes and opens of alerts. An open that meets an alert
 * already open for that person and kind touches it instead. First, a Slack
 * post or reply claimed more than 10 minutes ago and never answered becomes
 * unknown (returned as slackUnknown).
 */
CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_apply(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_hours_watch_runs; x jsonb; k text; v_set jsonb; v_on boolean; v_id bigint; v_person bigint; v_kind text;
  v_opened bigint[]:='{}'; v_closed bigint[]:='{}'; v_swept bigint[]:='{}'; v_thumb text; v_full text; v_detail jsonb; v_verdict text;
  v_path constant text:='^[A-Za-z0-9][A-Za-z0-9/_.-]*$';
  v_uuid constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_final constant text[]:=ARRAY['work','not_work','unclear'];
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'A watch payload is an object' USING ERRCODE='22023'; END IF;
  IF octet_length(p::text)>1048576 THEN RAISE EXCEPTION 'The watch payload is over 1 MB; nothing was written' USING ERRCODE='54000'; END IF;
  IF coalesce(p->>'runId','') !~ '^[0-9]{1,18}$' OR coalesce(p->>'leaseToken','') !~ v_uuid THEN
    RAISE EXCEPTION 'A watch payload names its run and lease' USING ERRCODE='22023';
  END IF;
  FOREACH k IN ARRAY ARRAY['statuses','slots','shots','open','update','close'] LOOP
    IF p ? k AND jsonb_typeof(p->k) NOT IN ('array','null') THEN RAISE EXCEPTION 'The watch payload''s % is a list', k USING ERRCODE='22023'; END IF;
  END LOOP;
  SELECT * INTO r FROM public.cockpit_hours_watch_runs WHERE id=(p->>'runId')::bigint FOR UPDATE;
  IF NOT FOUND OR r.holder<>(p->>'leaseToken')::uuid OR r.state<>'running' OR r.lease_until<now() THEN
    RAISE EXCEPTION 'This watch run no longer holds the lease; nothing was written' USING ERRCODE='40001';
  END IF;
  IF r.dry_run THEN RAISE EXCEPTION 'A dry run writes nothing' USING ERRCODE='22023'; END IF;
  v_set:=public.cockpit_hours_watch_settings();
  v_on:=(v_set->>'on')::boolean;

  -- A post or reply claimed more than 10 minutes ago with no answer (the
  -- worker stopped, a receipt or the result call failed) becomes unknown: it
  -- may have arrived, so it is never sent again, and the card says so.
  WITH u AS (
    UPDATE public.cockpit_hours_watch_incidents i SET slack_state='unknown',
      slack_error=coalesce(i.slack_error,'No answer from Slack within 10 minutes; the post may have gone out')
    WHERE i.slack_state='sending' AND coalesce(i.slack_claimed_at,i.opened_at)<now()-interval '10 minutes'
    RETURNING i.id)
  SELECT coalesce(array_agg(u.id ORDER BY u.id),'{}') INTO v_swept FROM u;
  WITH u AS (
    UPDATE public.cockpit_hours_watch_incidents i SET resolve_state='unknown',
      slack_error=coalesce(i.slack_error,'No answer from Slack within 10 minutes; the reply may have gone out')
    WHERE i.resolve_state='sending' AND coalesce(i.resolve_claimed_at,i.closed_at,i.opened_at)<now()-interval '10 minutes'
    RETURNING i.id)
  SELECT v_swept||coalesce(array_agg(u.id ORDER BY u.id),'{}') INTO v_swept FROM u;

  -- The state of each person right now.
  FOR x IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p->'statuses')='array' THEN p->'statuses' ELSE '[]'::jsonb END) LOOP
    INSERT INTO public.cockpit_hours_watch_status AS s(person_id,state,since,shift_start,shift_end,online,last_activity_at,tracked_today_s,
      active_pct_30m,screenshots_on,updated_at,run_id,detail)
    VALUES((x->>'personId')::bigint,x->>'state',(x->>'since')::timestamptz,(x->>'shiftStart')::timestamptz,(x->>'shiftEnd')::timestamptz,
      (x->>'online')::boolean,(x->>'lastActivityAt')::timestamptz,round((x->>'trackedTodayS')::numeric)::integer,
      -- Two decimals, cut rather than rounded: the card rounds down, so 9.996 must never read 10%.
      trunc((x->>'activePct30m')::numeric,2),(x->>'screenshotsOn')::boolean,now(),r.id,
      CASE WHEN jsonb_typeof(x->'detail')='object' THEN x->'detail' ELSE '{}'::jsonb END)
    ON CONFLICT (person_id) DO UPDATE SET state=EXCLUDED.state,
      since=coalesce(EXCLUDED.since,CASE WHEN s.state=EXCLUDED.state THEN s.since ELSE now() END),
      shift_start=EXCLUDED.shift_start,shift_end=EXCLUDED.shift_end,
      -- A run that read no figures (nobody on shift) keeps the last ones it had.
      online=CASE WHEN x ? 'online' THEN EXCLUDED.online ELSE s.online END,
      last_activity_at=CASE WHEN x ? 'lastActivityAt' THEN EXCLUDED.last_activity_at ELSE s.last_activity_at END,
      tracked_today_s=CASE WHEN x ? 'trackedTodayS' THEN EXCLUDED.tracked_today_s ELSE s.tracked_today_s END,
      active_pct_30m=CASE WHEN x ? 'activePct30m' THEN EXCLUDED.active_pct_30m ELSE s.active_pct_30m END,
      screenshots_on=coalesce(EXCLUDED.screenshots_on,s.screenshots_on),updated_at=now(),run_id=r.id,
      -- So does the time Hubstaff was last read for them (detail.readAt), or the day's blocks would read as not in yet.
      detail=CASE WHEN EXCLUDED.detail ? 'readAt' OR NOT (s.detail ? 'readAt') THEN EXCLUDED.detail
                  ELSE EXCLUDED.detail||jsonb_build_object('readAt',s.detail->'readAt') END;
  END LOOP;

  -- The 10-minute blocks of the shift line.
  FOR x IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p->'slots')='array' THEN p->'slots' ELSE '[]'::jsonb END) LOOP
    INSERT INTO public.cockpit_hours_watch_slots AS sl(person_id,slot_start,tracked_s,overall_s,idle,input_tracked_s)
    VALUES((x->>'personId')::bigint,(x->>'slotStart')::timestamptz,round(coalesce((x->>'trackedS')::numeric,0))::integer,
      round(coalesce((x->>'overallS')::numeric,0))::integer,coalesce((x->>'idle')::boolean,false),
      CASE WHEN jsonb_typeof(x->'inputTrackedS')='number' THEN round((x->>'inputTrackedS')::numeric)::integer END)
    ON CONFLICT (person_id,slot_start) DO UPDATE SET tracked_s=EXCLUDED.tracked_s,overall_s=EXCLUDED.overall_s,idle=EXCLUDED.idle,
      input_tracked_s=coalesce(EXCLUDED.input_tracked_s,sl.input_tracked_s);
  END LOOP;

  -- Screenshots, each read once.
  FOR x IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p->'shots')='array' THEN p->'shots' ELSE '[]'::jsonb END) LOOP
    v_thumb:=nullif(btrim(x->>'thumbPath'),''); v_full:=nullif(btrim(x->>'fullPath'),'');
    IF (v_thumb IS NOT NULL AND (length(v_thumb)>300 OR v_thumb !~ v_path OR v_thumb ~ '\.\.'))
       OR (v_full IS NOT NULL AND (length(v_full)>300 OR v_full !~ v_path OR v_full ~ '\.\.')) THEN
      RAISE EXCEPTION 'A stored screenshot path is a plain path inside the bucket' USING ERRCODE='22023';
    END IF;
    v_verdict:=coalesce(nullif(x->>'verdict',''),'pending');
    INSERT INTO public.cockpit_hours_watch_shots AS s(shot_id,person_id,hubstaff_user_id,recorded_at,slot_start,verdict,label,reason,category,
      confidence,model,apps,attempts,classified_at,thumb_path,full_path,error)
    VALUES((x->>'shotId')::bigint,(x->>'personId')::bigint,left(x->>'hubstaffUserId',40),(x->>'recordedAt')::timestamptz,(x->>'slotStart')::timestamptz,
      v_verdict,left(nullif(btrim(x->>'label'),''),120),left(nullif(btrim(x->>'reason'),''),240),left(nullif(btrim(x->>'category'),''),40),
      greatest(0,least(1,round((x->>'confidence')::numeric,3))),left(nullif(btrim(x->>'model'),''),80),
      CASE WHEN jsonb_typeof(x->'apps') IN ('array','object') THEN x->'apps' END,
      least(20,greatest(0,round(coalesce((x->>'attempts')::numeric,0))::integer)),(x->>'classifiedAt')::timestamptz,v_thumb,v_full,
      left(nullif(btrim(x->>'error'),''),240))
    ON CONFLICT (shot_id) DO UPDATE SET verdict=EXCLUDED.verdict,label=EXCLUDED.label,reason=EXCLUDED.reason,category=EXCLUDED.category,
      confidence=EXCLUDED.confidence,model=EXCLUDED.model,apps=coalesce(EXCLUDED.apps,s.apps),attempts=greatest(s.attempts,EXCLUDED.attempts),
      classified_at=EXCLUDED.classified_at,thumb_path=coalesce(EXCLUDED.thumb_path,s.thumb_path),full_path=coalesce(EXCLUDED.full_path,s.full_path),
      error=EXCLUDED.error
      WHERE NOT (s.verdict=ANY(v_final) AND EXCLUDED.verdict<>ALL(v_final));
    -- A judged shot can still gain its stored copies.
    IF v_verdict<>ALL(v_final) AND (v_thumb IS NOT NULL OR v_full IS NOT NULL) THEN
      UPDATE public.cockpit_hours_watch_shots SET thumb_path=coalesce(v_thumb,thumb_path),full_path=coalesce(v_full,full_path)
        WHERE shot_id=(x->>'shotId')::bigint AND verdict=ANY(v_final);
    END IF;
  END LOOP;

  -- Alerts still open: seen again.
  FOR x IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p->'update')='array' THEN p->'update' ELSE '[]'::jsonb END) LOOP
    UPDATE public.cockpit_hours_watch_incidents i SET last_seen_at=now(),run_id=r.id,
      detail=i.detail||CASE WHEN jsonb_typeof(x->'detail')='object' THEN x->'detail' ELSE '{}'::jsonb END
    WHERE i.id=(x->>'id')::bigint AND i.closed_at IS NULL;
  END LOOP;

  -- Alerts that cleared. A reply is due only where the alert itself went out;
  -- a post still waiting is never sent for an alert that already cleared.
  FOR x IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p->'close')='array' THEN p->'close' ELSE '[]'::jsonb END) LOOP
    v_id:=NULL;
    UPDATE public.cockpit_hours_watch_incidents i SET closed_at=greatest(now(),i.opened_at),last_seen_at=now(),run_id=r.id,
      close_reason=left(coalesce(nullif(btrim(x->>'reason'),''),nullif(btrim(x->>'closeReason'),''),'cleared'),60),
      detail=i.detail||CASE WHEN jsonb_typeof(x->'detail')='object' THEN x->'detail' ELSE '{}'::jsonb END,
      slack_state=CASE WHEN i.slack_state='pending' THEN 'muted' ELSE i.slack_state END,
      resolve_state=CASE WHEN i.slack_state='posted' AND v_on THEN 'pending'
                         WHEN i.slack_state IN ('posted','muted') THEN 'muted'
                         ELSE 'none' END
    WHERE i.id=(x->>'id')::bigint AND i.closed_at IS NULL
    RETURNING i.id INTO v_id;
    IF v_id IS NOT NULL THEN v_closed:=v_closed||v_id; END IF;
  END LOOP;

  -- New alerts. Slack is due when alerts are on; otherwise it is recorded muted.
  FOR x IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p->'open')='array' THEN p->'open' ELSE '[]'::jsonb END) LOOP
    v_kind:=x->>'kind'; v_person:=nullif(x->>'personId','')::bigint;
    IF v_kind IS NULL OR v_kind NOT IN ('not_tracking','not_work','idle','source') OR (v_kind='source')<>(v_person IS NULL) THEN
      RAISE EXCEPTION 'An alert names its kind, and a person unless it is about Hubstaff itself' USING ERRCODE='22023';
    END IF;
    v_detail:=CASE WHEN jsonb_typeof(x->'detail')='object' THEN x->'detail' ELSE '{}'::jsonb END;
    v_id:=NULL;
    INSERT INTO public.cockpit_hours_watch_incidents(person_id,kind,opened_at,last_seen_at,detail,slack_channel,slack_state,resolve_state,run_id)
    VALUES(v_person,v_kind,now(),now(),v_detail,v_set->>'channel',CASE WHEN v_on THEN 'pending' ELSE 'muted' END,'none',r.id)
    ON CONFLICT ((coalesce(person_id,0)),kind) WHERE closed_at IS NULL DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      UPDATE public.cockpit_hours_watch_incidents i SET last_seen_at=now(),run_id=r.id
        WHERE coalesce(i.person_id,0)=coalesce(v_person,0) AND i.kind=v_kind AND i.closed_at IS NULL;
    ELSE
      v_opened:=v_opened||v_id;
    END IF;
  END LOOP;

  IF cardinality(v_opened)+cardinality(v_closed)+cardinality(v_swept)>0 THEN
    PERFORM public.cockpit_hours_audit('hours.watch.alerts','cockpit_hours_watch_runs',r.id::text,
      jsonb_build_object('opened',to_jsonb(v_opened),'closed',to_jsonb(v_closed),'slackUnknown',to_jsonb(v_swept),'slack',v_on),'sync');
  END IF;
  RETURN jsonb_build_object('ok',true,'opened',to_jsonb(v_opened),'closed',to_jsonb(v_closed),'slackUnknown',to_jsonb(v_swept));
END;
$$;

/**
 * Claim one Slack post (which: open) or thread reply (which: resolve) before
 * sending it: pending becomes sending and the alert comes back; anything else
 * returns NULL, so a post goes out at most once. With alerts switched off the
 * pending post becomes muted instead. The claim time is kept
 * (slack_claimed_at, resolve_claimed_at) for the apply's 10-minute sweep.
 */
CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_slack_claim(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id bigint; v_which text:=p->>'which'; v_set jsonb; i public.cockpit_hours_watch_incidents;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF coalesce(p->>'incidentId','') !~ '^[0-9]{1,18}$' OR v_which IS NULL OR v_which NOT IN ('open','resolve') THEN
    RAISE EXCEPTION 'A Slack claim names the alert and open or resolve' USING ERRCODE='22023';
  END IF;
  v_id:=(p->>'incidentId')::bigint;
  v_set:=public.cockpit_hours_watch_settings();
  IF (v_set->>'on')::boolean IS NOT TRUE THEN
    IF v_which='open' THEN
      UPDATE public.cockpit_hours_watch_incidents SET slack_state='muted' WHERE id=v_id AND slack_state='pending';
    ELSE
      UPDATE public.cockpit_hours_watch_incidents SET resolve_state='muted' WHERE id=v_id AND resolve_state='pending';
    END IF;
    RETURN NULL;
  END IF;
  IF v_which='open' THEN
    UPDATE public.cockpit_hours_watch_incidents SET slack_state='sending',slack_claimed_at=now(),slack_channel=coalesce(slack_channel,v_set->>'channel')
      WHERE id=v_id AND slack_state='pending' AND closed_at IS NULL
      RETURNING * INTO i;
  ELSE
    UPDATE public.cockpit_hours_watch_incidents SET resolve_state='sending',resolve_claimed_at=now()
      WHERE id=v_id AND resolve_state='pending' AND closed_at IS NOT NULL AND slack_ts IS NOT NULL
      RETURNING * INTO i;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN public.cockpit_hours_watch_incident_json(i);
END;
$$;

/** The answer to a claimed post: posted (with its ts for an open), failed or unknown. Never retried. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_slack_result(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id bigint; v_which text:=p->>'which'; v_state text:=p->>'state'; v_ts text:=nullif(btrim(p->>'ts'),''); v_err text;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF coalesce(p->>'incidentId','') !~ '^[0-9]{1,18}$' OR v_which IS NULL OR v_which NOT IN ('open','resolve')
     OR v_state IS NULL OR v_state NOT IN ('posted','failed','unknown') THEN
    RAISE EXCEPTION 'A Slack result names the alert, open or resolve, and posted, failed or unknown' USING ERRCODE='22023';
  END IF;
  IF v_ts IS NOT NULL AND v_ts !~ '^[0-9]{1,12}\.[0-9]{1,8}$' THEN RAISE EXCEPTION 'That is not a Slack message ts' USING ERRCODE='22023'; END IF;
  IF v_which='open' AND v_state='posted' AND v_ts IS NULL THEN RAISE EXCEPTION 'A posted alert carries its Slack ts' USING ERRCODE='22023'; END IF;
  v_id:=(p->>'incidentId')::bigint;
  v_err:=CASE WHEN v_state='posted' THEN NULL ELSE left(coalesce(nullif(btrim(p->>'error'),''),
    CASE v_state WHEN 'unknown' THEN 'No answer from Slack' ELSE 'Slack refused the post' END),240) END;
  IF v_which='open' THEN
    UPDATE public.cockpit_hours_watch_incidents SET slack_state=v_state,
      slack_ts=CASE WHEN v_state='posted' THEN v_ts ELSE slack_ts END,slack_error=v_err
      WHERE id=v_id AND slack_state='sending';
  ELSE
    UPDATE public.cockpit_hours_watch_incidents SET resolve_state=v_state,slack_error=coalesce(v_err,slack_error)
      WHERE id=v_id AND resolve_state='sending';
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'note','That Slack post was not claimed, so nothing changed'); END IF;
  RETURN jsonb_build_object('ok',true);
END;
$$;

/** Close the run and leave the guardian's freshness row (cockpit_sync_state 'hours-watch'). */
CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_finish(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_hours_watch_runs; v_ok boolean; v_result jsonb; v_note text; v_watched integer;
  v_uuid constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(p->>'state','') NOT IN ('ok','failed')
     OR coalesce(p->>'runId','') !~ '^[0-9]{1,18}$' OR coalesce(p->>'leaseToken','') !~ v_uuid THEN
    RAISE EXCEPTION 'A watch run finishes ok or failed, with its run and lease' USING ERRCODE='22023';
  END IF;
  SELECT * INTO r FROM public.cockpit_hours_watch_runs WHERE id=(p->>'runId')::bigint AND holder=(p->>'leaseToken')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That watch run is not this lease''s' USING ERRCODE='42501'; END IF;
  IF r.state<>'running' THEN RETURN jsonb_build_object('ok',false,'state',r.state); END IF;
  v_ok:=p->>'state'='ok';
  v_result:=CASE
    WHEN jsonb_typeof(p->'result')='object' AND octet_length((p->'result')::text)<=65536 THEN p->'result'
    WHEN jsonb_typeof(p->'result')='object' THEN jsonb_build_object('note',left(p#>>'{result,note}',240),'truncated',true)
    ELSE NULL END;
  v_note:=left(nullif(btrim(coalesce(v_result->>'note',p->>'error',CASE WHEN v_ok THEN NULL ELSE 'The watch run failed' END)),''),240);
  v_watched:=CASE WHEN coalesce(v_result->>'watched','') ~ '^[0-9]{1,6}$' THEN (v_result->>'watched')::integer END;
  UPDATE public.cockpit_hours_watch_runs SET state=CASE WHEN v_ok THEN 'ok' ELSE 'failed' END,finished_at=now(),result=v_result,
    error=left(nullif(btrim(p->>'error'),''),240)
    WHERE id=r.id;
  IF NOT r.dry_run THEN
    INSERT INTO public.cockpit_sync_state(key,last_run_at,last_ok_at,ok,note,rows_seen,updated_at)
    VALUES('hours-watch',now(),CASE WHEN v_ok THEN now() END,v_ok,v_note,v_watched,now())
    ON CONFLICT (key) DO UPDATE SET last_run_at=now(),
      last_ok_at=CASE WHEN v_ok THEN now() ELSE public.cockpit_sync_state.last_ok_at END,
      ok=v_ok,note=EXCLUDED.note,rows_seen=EXCLUDED.rows_seen,updated_at=now();
  END IF;
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_key_get(p_provider text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE k public.cockpit_hours_watch_keys;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  SELECT * INTO k FROM public.cockpit_hours_watch_keys WHERE provider=p_provider;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('provider',k.provider,'secret',k.secret,'last4',k.last4,'state',k.state,'stateNote',k.state_note,
    'savedAt',k.saved_at,'checkedAt',k.checked_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_key_put(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_provider text:=p->>'provider'; v_secret text:=p->>'secret'; v_by text:=p->>'savedBy'; v_state text:=coalesce(nullif(p->>'state',''),'unchecked');
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF v_provider IS NULL OR v_provider NOT IN ('google_ai','openai') THEN RAISE EXCEPTION 'The key is for google_ai or openai' USING ERRCODE='22023'; END IF;
  IF v_secret IS NULL OR length(v_secret) NOT BETWEEN 10 AND 4000 OR v_secret ~ '[[:space:]]' THEN RAISE EXCEPTION 'That doesn''t look like a key' USING ERRCODE='22023'; END IF;
  IF coalesce(v_by,'') !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN RAISE EXCEPTION 'A key is saved by a verified email' USING ERRCODE='22023'; END IF;
  IF v_state NOT IN ('connected','refused','unchecked') THEN RAISE EXCEPTION 'A key is connected, refused or unchecked' USING ERRCODE='22023'; END IF;
  INSERT INTO public.cockpit_hours_watch_keys(provider,secret,last4,saved_by,saved_at,state,state_note,checked_at)
  VALUES(v_provider,v_secret,right(v_secret,4),lower(btrim(v_by)),now(),v_state,left(nullif(btrim(p->>'stateNote'),''),240),
    CASE WHEN v_state<>'unchecked' THEN now() END)
  ON CONFLICT (provider) DO UPDATE SET secret=EXCLUDED.secret,last4=EXCLUDED.last4,saved_by=EXCLUDED.saved_by,saved_at=now(),
    state=EXCLUDED.state,state_note=EXCLUDED.state_note,checked_at=EXCLUDED.checked_at;
  PERFORM public.cockpit_hours_audit('hours.watch.keySaved','cockpit_hours_watch_keys',v_provider,
    jsonb_build_object('provider',v_provider,'savedBy',lower(btrim(v_by)),'state',v_state),lower(btrim(v_by)));
  RETURN jsonb_build_object('ok',true,'last4',right(v_secret,4),'state',v_state);
END;
$$;

/**
 * The watch's own verdict on a saved key: refused (401/403, Google's
 * API_KEY_INVALID) or connected again. Compare-and-swap on savedAt (from
 * cockpit_hours_watch_key_get at the start of the run, passed back as it
 * came): a key pasted mid-run is never marked by the old key's failure, and
 * the answer is {ok:false, note:'The key changed during the run'} with
 * nothing written. Changes the state, its note and when it was checked; never
 * the key. One audit row (hours.watch.keyState) when the state or the note
 * changes. A note that would quote the key is refused.
 */
CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_key_mark(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_provider text:=p->>'provider'; v_state text:=p->>'state'; v_note text; v_saved timestamptz; k public.cockpit_hours_watch_keys;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR v_provider IS NULL OR v_provider NOT IN ('google_ai','openai') THEN
    RAISE EXCEPTION 'The key is for google_ai or openai' USING ERRCODE='22023';
  END IF;
  IF v_state IS NULL OR v_state NOT IN ('refused','connected') THEN RAISE EXCEPTION 'A key is marked refused or connected' USING ERRCODE='22023'; END IF;
  IF p ? 'note' AND jsonb_typeof(p->'note') NOT IN ('string','null') THEN RAISE EXCEPTION 'A note is text' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p->'savedAt') IS DISTINCT FROM 'string' OR (p->>'savedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}' THEN
    RAISE EXCEPTION 'A key is marked with the savedAt its run read' USING ERRCODE='22023';
  END IF;
  BEGIN
    v_saved:=(p->>'savedAt')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'A key is marked with the savedAt its run read' USING ERRCODE='22023';
  END;
  v_note:=left(nullif(btrim(p->>'note'),''),240);
  SELECT * INTO k FROM public.cockpit_hours_watch_keys WHERE provider=v_provider FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'note','No key is saved for that provider'); END IF;
  -- Milliseconds: a savedAt that went through a JavaScript Date still matches its own key.
  IF date_trunc('milliseconds',k.saved_at)<>date_trunc('milliseconds',v_saved) THEN
    RETURN jsonb_build_object('ok',false,'note','The key changed during the run');
  END IF;
  IF v_note IS NOT NULL AND strpos(v_note,k.secret)>0 THEN RAISE EXCEPTION 'A key''s note never quotes the key' USING ERRCODE='22023'; END IF;
  UPDATE public.cockpit_hours_watch_keys SET state=v_state,state_note=v_note,checked_at=now() WHERE provider=v_provider;
  IF k.state IS DISTINCT FROM v_state OR k.state_note IS DISTINCT FROM v_note THEN
    PERFORM public.cockpit_hours_audit('hours.watch.keyState','cockpit_hours_watch_keys',v_provider,
      jsonb_build_object('provider',v_provider,'from',k.state,'state',v_state,'note',v_note),'sync');
  END IF;
  RETURN jsonb_build_object('ok',true,'provider',v_provider,'state',v_state);
END;
$$;

/**
 * Daily clean-up: slots after 14 days, screenshots after 30 days (90 when
 * images are stored), runs after 30 days, and the watch's own receipts
 * (google-ai, openai, storage) in cockpit_hours_provider_health after 30
 * days. Alerts are kept, and so are the Hubstaff, Timetastic and Slack
 * receipts the hours read shares. Leaves cockpit_sync_state
 * 'hours-watch-prune' (the inputs' lastPruneOn). Returns the storage paths
 * of the removed rows for the function to delete.
 */
CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_prune()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n_slots integer; n_shots integer; n_runs integer; n_receipts integer; v_paths jsonb;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  WITH d AS (DELETE FROM public.cockpit_hours_watch_slots WHERE slot_start<now()-interval '14 days' RETURNING 1) SELECT count(*) INTO n_slots FROM d;
  WITH d AS (
    DELETE FROM public.cockpit_hours_watch_shots s
    WHERE (s.thumb_path IS NULL AND s.full_path IS NULL AND s.recorded_at<now()-interval '30 days')
       OR ((s.thumb_path IS NOT NULL OR s.full_path IS NOT NULL) AND s.recorded_at<now()-interval '90 days')
    RETURNING s.thumb_path,s.full_path)
  SELECT count(*),coalesce((SELECT jsonb_agg(x.path ORDER BY x.path) FROM (
      SELECT d2.thumb_path AS path FROM d d2 WHERE d2.thumb_path IS NOT NULL
      UNION SELECT d3.full_path FROM d d3 WHERE d3.full_path IS NOT NULL) x),'[]'::jsonb)
    INTO n_shots,v_paths FROM d;
  WITH d AS (DELETE FROM public.cockpit_hours_watch_runs WHERE state<>'running' AND coalesce(finished_at,started_at)<now()-interval '30 days' RETURNING 1)
    SELECT count(*) INTO n_runs FROM d;
  WITH d AS (DELETE FROM public.cockpit_hours_provider_health h
             WHERE h.provider IN ('google-ai','openai','storage') AND h.created_at<now()-interval '30 days' RETURNING 1)
    SELECT count(*) INTO n_receipts FROM d;
  IF n_slots+n_shots+n_runs+n_receipts>0 THEN
    PERFORM public.cockpit_hours_audit('hours.watch.prune','cockpit_hours_watch_shots',NULL,
      jsonb_build_object('slots',n_slots,'shots',n_shots,'runs',n_runs,'receipts',n_receipts,'paths',jsonb_array_length(v_paths)),'sync');
  END IF;
  INSERT INTO public.cockpit_sync_state(key,last_run_at,last_ok_at,ok,note,rows_seen,updated_at)
  VALUES('hours-watch-prune',now(),now(),true,
    format('Removed old rows: blocks %s, screenshots %s, runs %s, receipts %s', n_slots, n_shots, n_runs, n_receipts),
    n_slots+n_shots+n_runs+n_receipts,now())
  ON CONFLICT (key) DO UPDATE SET last_run_at=now(),last_ok_at=now(),ok=true,note=EXCLUDED.note,rows_seen=EXCLUDED.rows_seen,updated_at=now();
  RETURN jsonb_build_object('ok',true,'slots',n_slots,'shots',n_shots,'runs',n_runs,'receipts',n_receipts,'paths',v_paths);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. CEO RPCs (the Management tab's Hubstaff watch card)

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_watch_board()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz:=now(); v_set jsonb; x jsonb; st public.cockpit_hours_watch_status; v_state text; v_day_start timestamptz;
  v_fresh boolean; v_today boolean; v_people jsonb:='[]'::jsonb; v_hub jsonb; v_ai jsonb; v_slack jsonb; v_last jsonb;
  v_src_note text; v_src_open boolean; v_key_state text; v_key_note text; v_ai_provider text; v_ai_state text; v_ai_note text;
  v_ev_state text; v_ev_error text; v_run_ai jsonb; v_ai_failing boolean; v_ai_error text;
BEGIN
  IF public.cockpit_is_ceo() IS NOT TRUE THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  v_set:=public.cockpit_hours_watch_settings();

  FOR x IN SELECT value FROM jsonb_array_elements(public.cockpit_hours_watch_roster(v_now)) LOOP
    SELECT * INTO st FROM public.cockpit_hours_watch_status s WHERE s.person_id=(x->>'personId')::bigint;
    v_day_start:=((x->>'day')::date)::timestamp AT TIME ZONE (x->>'timezone');
    v_fresh:=st.person_id IS NOT NULL AND st.updated_at>=v_now-interval '15 minutes';
    v_today:=st.person_id IS NOT NULL AND st.updated_at>=v_day_start;
    -- Today's roster decides who is off; a status older than 15 minutes is never shown as working.
    v_state:=CASE
      WHEN x->>'offReason' IN ('day_off','not_employed','paused') THEN 'off_shift'
      WHEN x->>'offReason'='holiday' THEN 'holiday'
      WHEN x->>'offReason'='leave' THEN 'on_leave'
      WHEN x->>'offReason' IS NOT NULL THEN 'off_shift'
      -- Inside a part-day leave window: on leave, whatever the last run said.
      WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(x->'leave')='array' THEN x->'leave' ELSE '[]'::jsonb END) l
                   WHERE (l->>'start')::timestamptz<=v_now AND v_now<(l->>'end')::timestamptz) THEN 'on_leave'
      WHEN v_fresh THEN st.state
      WHEN v_now<(x#>>'{shift,start}')::timestamptz OR v_now>=(x#>>'{shift,end}')::timestamptz THEN 'off_shift'
      WHEN x->>'hubstaffUserId' IS NULL THEN 'no_account'
      ELSE 'cant_tell' END;
    v_people:=v_people||jsonb_build_array(jsonb_build_object(
      'personId',(x->>'personId')::bigint,'name',x->>'name','role',x->>'role','state',v_state,
      'since',CASE WHEN st.person_id IS NOT NULL AND st.state=v_state THEN st.since END,
      'shiftStart',x#>'{shift,start}','shiftEnd',x#>'{shift,end}',
      'online',CASE WHEN v_today THEN st.online END,
      'lastActivityAt',CASE WHEN v_today THEN st.last_activity_at END,
      'trackedTodayS',CASE WHEN v_today THEN st.tracked_today_s END,
      'activePct30m',CASE WHEN v_fresh THEN st.active_pct_30m END,
      'screenshotsOn',st.screenshots_on,
      'offReason',x->'offReason',
      -- Stopped inside the allowed lunch wait: a neutral chip, not someone who needs a look.
      'onBreak',v_state='on_break',
      'leave',CASE WHEN jsonb_typeof(x->'leave')='array' THEN x->'leave' ELSE '[]'::jsonb END,
      -- When this person's Hubstaff data was last read: blocks after readAt - 20 min are not in yet.
      'readAt',CASE WHEN jsonb_typeof(st.detail->'readAt')='string' AND (st.detail->>'readAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                 THEN st.detail->'readAt' END,
      'slots',(SELECT coalesce(jsonb_agg(jsonb_build_object('start',sl.slot_start,'trackedS',sl.tracked_s,'overallS',sl.overall_s,
                 'inputTrackedS',sl.input_tracked_s,'idle',sl.idle)
                 ORDER BY sl.slot_start),'[]'::jsonb)
               FROM public.cockpit_hours_watch_slots sl
               WHERE sl.person_id=(x->>'personId')::bigint AND sl.slot_start>=v_day_start AND sl.slot_start<v_day_start+interval '1 day'),
      'shots',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.shot_id,'at',t.recorded_at,'verdict',t.verdict,'label',t.label,
                 'confidence',t.confidence,'thumbPath',t.thumb_path,'fullPath',t.full_path) ORDER BY t.recorded_at DESC,t.shot_id DESC),'[]'::jsonb)
               FROM (SELECT * FROM public.cockpit_hours_watch_shots sh
                     WHERE sh.person_id=(x->>'personId')::bigint AND sh.recorded_at>=v_day_start AND sh.verdict IN ('not_work','unclear')
                     ORDER BY sh.recorded_at DESC,sh.shot_id DESC LIMIT 12) t)));
  END LOOP;

  -- Hubstaff: an open source alert first, then the saved key.
  SELECT true,i.detail->>'note' INTO v_src_open,v_src_note FROM public.cockpit_hours_watch_incidents i
    WHERE i.kind='source' AND i.closed_at IS NULL ORDER BY i.id DESC LIMIT 1;
  SELECT k.state,k.state_note INTO v_key_state,v_key_note FROM public.cockpit_hours_keys k WHERE k.provider='hubstaff';
  v_hub:=CASE
    WHEN v_src_open THEN jsonb_build_object('state','failing','note',coalesce(nullif(btrim(v_src_note),''),'Hubstaff could not be read'))
    WHEN v_key_state IS NULL THEN jsonb_build_object('state','missing_key','note','Hubstaff is not connected')
    WHEN v_key_state IN ('refused','plan_blocked','needs_new_key') THEN
      jsonb_build_object('state',v_key_state,'note',coalesce(nullif(btrim(v_key_note),''),'Hubstaff refused the saved key'))
    ELSE jsonb_build_object('state','connected','note',NULL) END;

  -- The vision model: the pasted key the run uses (one not refused, OpenAI first), else what the last run used.
  SELECT k.provider,k.state,k.state_note INTO v_ai_provider,v_ai_state,v_ai_note FROM public.cockpit_hours_watch_keys k
    ORDER BY (k.state<>'refused') DESC,(k.provider='openai') DESC LIMIT 1;
  IF v_ai_provider IS NULL THEN
    SELECT r.result->'ai' INTO v_run_ai FROM public.cockpit_hours_watch_runs r
      WHERE r.state IN ('ok','failed') AND NOT r.dry_run ORDER BY r.started_at DESC LIMIT 1;
    IF v_run_ai->>'state'='connected' AND v_run_ai->>'provider' IN ('google_ai','openai') THEN
      v_ai_provider:=v_run_ai->>'provider'; v_ai_state:='connected'; v_ai_note:=NULL;
    END IF;
  END IF;
  -- Failing: the last 3 screenshots the model answered or failed on in the last hour all failed in the model
  -- (category 'model'). A failed download or an expired link (category 'download') says nothing about the key.
  IF (v_set->>'shots')::boolean IS TRUE THEN
    SELECT count(*)=3 AND bool_and(t.verdict='error'),(array_agg(t.error ORDER BY t.at DESC,t.shot_id DESC))[1]
      INTO v_ai_failing,v_ai_error
      FROM (SELECT sh.shot_id,sh.verdict,sh.error,coalesce(sh.classified_at,sh.created_at) AS at FROM public.cockpit_hours_watch_shots sh
            WHERE (sh.verdict IN ('work','not_work','unclear') OR (sh.verdict='error' AND sh.category='model'))
              AND coalesce(sh.classified_at,sh.created_at)>=v_now-interval '1 hour'
            ORDER BY coalesce(sh.classified_at,sh.created_at) DESC,sh.shot_id DESC LIMIT 3) t;
  END IF;
  v_ai:=CASE
    WHEN v_ai_provider IS NULL THEN jsonb_build_object('state','missing','provider',NULL,'note',NULL)
    WHEN v_ai_state='refused' THEN jsonb_build_object('state','refused','provider',v_ai_provider,
      'note',coalesce(nullif(btrim(v_ai_note),''),'The saved key was refused'))
    WHEN v_ai_failing IS TRUE THEN jsonb_build_object('state','failing','provider',v_ai_provider,
      'note',coalesce(nullif(btrim(v_ai_error),''),'The last 3 screenshots could not be checked'))
    ELSE jsonb_build_object('state','connected','provider',v_ai_provider,
      'note',CASE WHEN (v_set->>'shots')::boolean IS NOT TRUE THEN 'The screenshot check is off' END) END;

  -- Slack: the newest post or reply that got an answer.
  SELECT e.state,e.err INTO v_ev_state,v_ev_error FROM (
    -- Posts opened in one run share opened_at; the claim time tells them apart.
    SELECT i.slack_state AS state,i.slack_error AS err,coalesce(i.slack_claimed_at,i.opened_at) AS at,i.id FROM public.cockpit_hours_watch_incidents i
      WHERE i.slack_state IN ('posted','failed','unknown')
    UNION ALL
    SELECT i.resolve_state,i.slack_error,coalesce(i.resolve_claimed_at,i.closed_at),i.id FROM public.cockpit_hours_watch_incidents i
      WHERE i.resolve_state IN ('posted','failed','unknown')) e
  ORDER BY e.at DESC,e.id DESC LIMIT 1;
  v_slack:=CASE
    WHEN v_ev_state='posted' THEN jsonb_build_object('state','ok','note',NULL)
    WHEN v_ev_state='failed' THEN jsonb_build_object('state','failing','note',coalesce(v_ev_error,'Slack refused the post'))
    WHEN v_ev_state='unknown' THEN jsonb_build_object('state','unknown','note',coalesce(v_ev_error,'No answer from Slack'))
    ELSE jsonb_build_object('state','unknown','note',NULL) END;

  SELECT jsonb_build_object('at',s.last_run_at,'ok',s.ok,'note',s.note) INTO v_last
    FROM public.cockpit_sync_state s WHERE s.key='hours-watch';

  RETURN jsonb_build_object(
    'settings',v_set,
    'sources',jsonb_build_object('hubstaff',v_hub,'ai',v_ai,'slack',v_slack),
    'lastRun',v_last,
    'cronOn',public.cockpit_hours_watch_cron_on(),
    'now',v_now,
    'people',v_people,
    'open',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'personId',i.person_id,'name',p.name,'kind',i.kind,'openedAt',i.opened_at,
              'lastSeenAt',i.last_seen_at,'detail',i.detail,'slackState',i.slack_state,'slackError',i.slack_error,'reviewedAt',i.reviewed_at)
              ORDER BY i.opened_at DESC,i.id DESC),'[]'::jsonb)
            FROM public.cockpit_hours_watch_incidents i LEFT JOIN public.cockpit_people p ON p.id=i.person_id
            WHERE i.closed_at IS NULL),
    'recent',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'personId',t.person_id,'name',t.name,'kind',t.kind,'openedAt',t.opened_at,
              'closedAt',t.closed_at,'closeReason',t.close_reason,'detail',t.detail,'reviewedAt',t.reviewed_at)
              ORDER BY t.closed_at DESC,t.id DESC),'[]'::jsonb)
            FROM (SELECT i.*,p.name FROM public.cockpit_hours_watch_incidents i LEFT JOIN public.cockpit_people p ON p.id=i.person_id
                  WHERE i.closed_at IS NOT NULL AND i.closed_at>=v_now-interval '7 days'
                  ORDER BY i.closed_at DESC,i.id DESC LIMIT 50) t));
END;
$$;

/** A partial settings patch, checked against the bounds; one audit row with before and after. */
CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_watch_set(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text; k text; v jsonb; v_problem text; v_old jsonb; v_new jsonb;
BEGIN
  IF public.cockpit_is_ceo() IS NOT TRUE THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  v_actor:=public.cockpit_hours_ceo_email();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p='{}'::jsonb THEN RAISE EXCEPTION 'Choose a setting to change' USING ERRCODE='22023'; END IF;
  FOR k,v IN SELECT e.key,e.value FROM jsonb_each(p) e LOOP
    v_problem:=public.cockpit_hours_watch_setting_problem(k,v);
    IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem USING ERRCODE='22023'; END IF;
  END LOOP;
  PERFORM 1 FROM public.cockpit_settings s WHERE s.key='hours.watch' FOR UPDATE;
  v_old:=public.cockpit_hours_watch_settings();
  v_new:=v_old||p;
  IF v_new=v_old THEN RETURN jsonb_build_object('ok',true,'settings',v_old); END IF;
  INSERT INTO public.cockpit_settings(key,value,updated_by,updated_at)
  VALUES('hours.watch',v_new,v_actor,now())
  ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now();
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
  VALUES('hours.watch.set','cockpit_settings','hours.watch',v_actor,'ceo','supabase',v_old,v_new);
  RETURN jsonb_build_object('ok',true,'settings',public.cockpit_hours_watch_settings());
END;
$$;

/** The CEO has looked at an alert (open or closed), with an optional note. */
CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_watch_review(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text; v_id bigint; v_note text; i public.cockpit_hours_watch_incidents;
BEGIN
  IF public.cockpit_is_ceo() IS NOT TRUE THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  v_actor:=public.cockpit_hours_ceo_email();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(p->>'incidentId','') !~ '^[0-9]{1,18}$' THEN
    RAISE EXCEPTION 'Choose an alert to mark reviewed' USING ERRCODE='22023';
  END IF;
  IF p ? 'note' AND jsonb_typeof(p->'note') NOT IN ('string','null') THEN RAISE EXCEPTION 'A note is text' USING ERRCODE='22023'; END IF;
  v_note:=nullif(btrim(p->>'note'),'');
  IF length(v_note)>300 THEN RAISE EXCEPTION 'Keep the note to 300 characters' USING ERRCODE='22023'; END IF;
  v_id:=(p->>'incidentId')::bigint;
  UPDATE public.cockpit_hours_watch_incidents SET reviewed_at=now(),reviewed_by=v_actor,review_note=v_note
    WHERE id=v_id RETURNING * INTO i;
  IF NOT FOUND THEN RAISE EXCEPTION 'That alert is not there any more. Refresh the card' USING ERRCODE='22023'; END IF;
  -- The note stays on the alert (service only); admins can read the audit log, so it says only whether there is one.
  PERFORM public.cockpit_hours_audit('hours.watch.review','cockpit_hours_watch_incidents',v_id::text,
    jsonb_build_object('incidentId',v_id,'personId',i.person_id,'kind',i.kind,'hasNote',v_note IS NOT NULL),v_actor);
  RETURN jsonb_build_object('ok',true,'id',v_id,'reviewedAt',i.reviewed_at);
END;
$$;

/** The storage read policy: the CEO, and only a path a screenshot row recorded. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_object_allowed(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(public.cockpit_is_ceo(),false) AND p_name IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.cockpit_hours_watch_shots s WHERE s.thumb_path=p_name OR s.full_path=p_name)
$$;

-- ---------------------------------------------------------------------------
-- 7. The private bucket and its CEO read policy (storage only where it exists)

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE $q$INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      VALUES('cockpit-hours-watch','cockpit-hours-watch',false,3145728,ARRAY['image/jpeg','image/png','image/webp'])
      ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=3145728,allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp']$q$;
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS cockpit_hours_watch_read ON storage.objects';
    EXECUTE $q$CREATE POLICY cockpit_hours_watch_read ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id='cockpit-hours-watch' AND public.cockpit_hours_watch_object_allowed(name))$q$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. The 5-minute kick (vault, pg_net and pg_cron only where they exist)

CREATE OR REPLACE FUNCTION public.cockpit_hours_watch_kick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_url constant text := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-hours-watch';
  v_secret text;
  v_request bigint;
  v_note text;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name=$1 LIMIT 1' INTO v_secret USING 'cockpit_sync_secret';
  END IF;
  IF v_secret IS NULL OR btrim(v_secret)='' THEN
    v_note:='The vault has no cockpit_sync_secret, so the Hubstaff watch was not started. Add it to the vault.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace
                    WHERE n.nspname='net' AND f.proname='http_post') THEN
    v_note:='pg_net is not installed, so the Hubstaff watch was not started. Turn the pg_net extension on.';
  END IF;
  IF v_note IS NOT NULL THEN
    INSERT INTO public.cockpit_sync_state(key,last_run_at,ok,note,updated_at)
    VALUES('hours-watch-kick',now(),false,v_note,now())
    ON CONFLICT (key) DO UPDATE SET last_run_at=now(),ok=false,note=EXCLUDED.note,updated_at=now();
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)' INTO v_request
    USING v_url, jsonb_build_object('job','watch'), jsonb_build_object('Content-Type','application/json','x-cron-secret',v_secret);
  INSERT INTO public.cockpit_sync_state(key,last_run_at,last_ok_at,ok,note,updated_at)
  VALUES('hours-watch-kick',now(),now(),true,'Posted a watch run',now())
  ON CONFLICT (key) DO UPDATE SET last_run_at=now(),last_ok_at=now(),ok=true,note=EXCLUDED.note,updated_at=now();
  RETURN v_request;
END;
$$;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname=''mahara-hours-watch''';
    EXECUTE $q$SELECT cron.schedule('mahara-hours-watch','*/5 * * * *',$job$SELECT public.cockpit_hours_watch_kick();$job$)$q$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Function privileges: revoked from all four roles, then exactly one grant

DO $$
DECLARE f text;
BEGIN
  -- Internal: no role at all (called by the definer functions above, or by pg_cron as its owner).
  FOREACH f IN ARRAY ARRAY[
    'cockpit_hours_watch_defaults()','cockpit_hours_watch_setting_problem(text,jsonb)','cockpit_hours_watch_settings()',
    'cockpit_hours_watch_incident_guard()','cockpit_hours_watch_default_schedule()','cockpit_hours_watch_window(bigint,date)',
    'cockpit_hours_watch_today(bigint,timestamptz)','cockpit_hours_watch_leave(bigint,date,text,timestamptz,timestamptz)',
    'cockpit_hours_watch_roster(timestamptz)',
    'cockpit_hours_watch_incident_json(public.cockpit_hours_watch_incidents)','cockpit_hours_watch_cron_on()','cockpit_hours_watch_kick()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- CEO RPCs and the storage read policy, called with the CEO's session.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_ceo_hours_watch_board()','cockpit_ceo_hours_watch_set(jsonb)','cockpit_ceo_hours_watch_review(jsonb)',
    'cockpit_hours_watch_object_allowed(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- Service RPCs, called by cockpit-hours-watch and cockpit-hours-api with the service key.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_hours_watch_lease_claim(jsonb)','cockpit_hours_watch_inputs(timestamptz)','cockpit_hours_watch_apply(jsonb)',
    'cockpit_hours_watch_slack_claim(jsonb)','cockpit_hours_watch_slack_result(jsonb)','cockpit_hours_watch_finish(jsonb)',
    'cockpit_hours_watch_key_get(text)','cockpit_hours_watch_key_put(jsonb)','cockpit_hours_watch_key_mark(jsonb)',
    'cockpit_hours_watch_prune()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
