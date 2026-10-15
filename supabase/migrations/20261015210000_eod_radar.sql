-- EOD Radar, native in the cockpit, 2026-10-15 (Creative Triage bldgtotkfmhoxmlzowdx).
--
-- The CEO, 2026-10-15: "try to fix the eod radar". The old radar is an
-- OpenClaw daemon on the VPS that posted as the Slack bot "Aziz's Assistant".
-- That bot was deleted, so since 3 August it has credited nobody: every day
-- reads 13 missed, on-time EODs included, and its last post (24 Sep) named a
-- false third strike. Its roster still lists six people who have left. This
-- file is the cockpit's own radar; the daemon and its sheet are not touched.
--
-- What it adds:
--   cockpit_eod_channels          which role files where (a regex on cockpit_people.role)
--   cockpit_eod_radar             one row per person per working day: on time, late,
--                                 missed, pending, leave, off or not read, and how
--                                 the post was credited
--   cockpit_eod_radar_settings    one row: the digest switch, 22:00 late, 23:00
--                                 closeout; reminders and strikes are off and
--                                 cannot be switched on (they are not built, and
--                                 the old radar's strikes were false)
--   cockpit_eod_radar_slack_ids   each person's Slack id, looked up by email,
--                                 seeded from the 2026-10-15 lookup by name
--   cockpit_eod_radar_digests     one closeout post per day, claimed before it is sent
--   cockpit_eod_radar_receipts    every Slack call the radar makes (intent, then
--                                 response or unknown)
--   service RPCs                  inputs, apply, digest claim and result (the
--                                 Edge Function eod-radar, service key)
--   cockpit_eod_radar_read        the CEO's read (and admins'), for the Management tab
--   mahara-eod-radar              pg_cron at minutes 1 and 31, posts {"job":"run"}
--
-- Rules (the old radar's, kept): Saturday to Thursday, Friday off; late after
-- 22:00 Kuwait on the EOD day; missed only after 23:00 and only when every EOD
-- channel was read; a channel Slack refused is "not read", never missed. The
-- EOD day of a post with no Date line is Kuwait time minus 4 hours, the same
-- rule as cockpit_eod_working_day. Leave is a full-day Timetastic booking,
-- approved or pending, that the CEO has not marked not taken. "Lazy" (under 50
-- words, or no wins, blockers or plan for tomorrow) is a quality note only.
--
-- Safe to apply twice: tables IF NOT EXISTS, functions CREATE OR REPLACE,
-- seeds never overwrite, the job is unscheduled by name before it is
-- scheduled again. pg_cron, pg_net and the vault are touched only inside
-- guarded dynamic SQL, so the file loads in PGlite. Apply after
-- 20261009a_cockpit_team_hours.sql and 20260922a_eod_outbox.sql, and after the
-- Edge Function eod-radar is deployed (until then the job's posts are refused).

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.cockpit_people') IS NULL OR to_regclass('public.cockpit_time_accounts') IS NULL
     OR to_regclass('public.cockpit_timetastic_bookings') IS NULL OR to_regclass('public.cockpit_employment_periods') IS NULL
     OR to_regprocedure('public.cockpit_hours_holidays_json(bigint,date,date)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261009a_cockpit_team_hours.sql first';
  END IF;
  IF to_regclass('public.eod_outbox') IS NULL THEN RAISE EXCEPTION 'Apply 20260922a_eod_outbox.sql first'; END IF;
  IF to_regclass('public.cockpit_sync_state') IS NULL OR to_regclass('public.cockpit_audit_log') IS NULL
     OR to_regprocedure('public.cockpit_is_ceo()') IS NULL OR to_regprocedure('public.cockpit_has_role(text)') IS NULL THEN
    RAISE EXCEPTION 'The cockpit core (sync state, audit log, CEO gate) is missing';
  END IF;
END $$;

-- The run's detail (channels read, posts that named nobody) goes on its sync-state row (20261011c added the column).
ALTER TABLE public.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;

-- ---------------------------------------------------------------------------
-- 1. Tables

CREATE TABLE IF NOT EXISTS public.cockpit_eod_channels (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_pattern text NOT NULL UNIQUE CHECK (length(role_pattern) BETWEEN 1 AND 200),
  files_eod boolean NOT NULL DEFAULT true,
  channel_id text CHECK (channel_id IS NULL OR channel_id ~ '^[CG][A-Z0-9]{8,12}$'),
  channel_name text CHECK (channel_name IS NULL OR channel_name ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  priority integer NOT NULL DEFAULT 100,
  note text CHECK (note IS NULL OR length(note) <= 300),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((files_eod AND channel_id IS NOT NULL AND channel_name IS NOT NULL) OR (NOT files_eod AND channel_id IS NULL AND channel_name IS NULL))
);
COMMENT ON TABLE public.cockpit_eod_channels IS
  'Which roles file an EOD and in which Slack channel. role_pattern is a case-insensitive POSIX regex on cockpit_people.role; the lowest priority that matches wins. files_eod false: the role owes no EOD (the CEO, bots).';

CREATE TABLE IF NOT EXISTS public.cockpit_eod_radar (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES public.cockpit_people(id),
  day date NOT NULL,
  channel text CHECK (channel IS NULL OR channel ~ '^[CG][A-Z0-9]{8,12}$'),
  status text NOT NULL CHECK (status IN ('on_time','late','missed','pending','leave','off','not_read')),
  posted_at timestamptz,
  slack_ts text CHECK (slack_ts IS NULL OR slack_ts ~ '^[0-9]{9,11}\.[0-9]{6}$'),
  posted_channel text CHECK (posted_channel IS NULL OR posted_channel ~ '^[CG][A-Z0-9]{8,12}$'),
  late_minutes integer CHECK (late_minutes IS NULL OR late_minutes BETWEEN 1 AND 100000),
  credited_by text CHECK (credited_by IS NULL OR credited_by IN ('poster','submitted_by','name_line','cockpit_outbox')),
  words integer CHECK (words IS NULL OR words BETWEEN 0 AND 100000),
  quality text CHECK (quality IS NULL OR length(quality) <= 200),
  note text CHECK (note IS NULL OR length(note) <= 300),
  posts integer NOT NULL DEFAULT 0 CHECK (posts BETWEEN 0 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, day),
  CHECK ((status IN ('on_time','late')) = (posted_at IS NOT NULL AND credited_by IS NOT NULL)),
  CHECK ((status = 'late') = (late_minutes IS NOT NULL))
);
COMMENT ON TABLE public.cockpit_eod_radar IS
  'EOD Radar: one row per person per working day, written by the Edge Function eod-radar from the five Slack EOD channels and the cockpit outbox. A channel Slack would not let the radar read makes the day not_read, never missed.';
CREATE INDEX IF NOT EXISTS cockpit_eod_radar_day_idx ON public.cockpit_eod_radar(day);

CREATE TABLE IF NOT EXISTS public.cockpit_eod_radar_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  digest_on boolean NOT NULL DEFAULT true,
  -- Not built. A later migration that builds them lifts these checks.
  reminders_on boolean NOT NULL DEFAULT false CHECK (NOT reminders_on),
  strikes_on boolean NOT NULL DEFAULT false CHECK (NOT strikes_on),
  late_at time NOT NULL DEFAULT '22:00',
  closeout_at time NOT NULL DEFAULT '23:00',
  digest_channel text NOT NULL DEFAULT 'C0B5TL9H370' CHECK (digest_channel ~ '^[CG][A-Z0-9]{8,12}$'),
  digest_channel_name text NOT NULL DEFAULT 'team-management' CHECK (digest_channel_name ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  lookback_days integer NOT NULL DEFAULT 2 CHECK (lookback_days BETWEEN 2 AND 45),
  updated_by text NOT NULL DEFAULT 'migration 20261015210000',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (closeout_at > late_at)
);

CREATE TABLE IF NOT EXISTS public.cockpit_eod_radar_slack_ids (
  person_id bigint PRIMARY KEY REFERENCES public.cockpit_people(id),
  slack_user_id text CHECK (slack_user_id IS NULL OR slack_user_id ~ '^[UW][A-Z0-9]{8,12}$'),
  source text NOT NULL CHECK (source IN ('lookup','migration','manual')),
  state text NOT NULL DEFAULT 'ok' CHECK (state IN ('ok','not_found','refused')),
  note text CHECK (note IS NULL OR length(note) <= 300),
  checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cockpit_eod_radar_slack_ids IS
  'Each person''s Slack member id for EOD Radar: users.lookupByEmail with the cockpit email, refreshed weekly. A failed lookup keeps the last good id.';

CREATE TABLE IF NOT EXISTS public.cockpit_eod_radar_digests (
  day date PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('sending','posted','failed','unknown')),
  channel text NOT NULL CHECK (channel ~ '^[CG][A-Z0-9]{8,12}$'),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 3000),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 3),
  slack_ts text CHECK (slack_ts IS NULL OR slack_ts ~ '^[0-9]{9,11}\.[0-9]{6}$'),
  error text CHECK (error IS NULL OR length(error) <= 240),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
COMMENT ON TABLE public.cockpit_eod_radar_digests IS
  'The closeout post, one per working day. Claimed (sending) before it is sent; a send that may have arrived is unknown and never sent again; a refused one may be claimed again, 3 tries at most.';

CREATE TABLE IF NOT EXISTS public.cockpit_eod_radar_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL CHECK (provider = 'slack'),
  method text NOT NULL CHECK (method IN ('GET','POST')),
  resource text NOT NULL CHECK (length(resource) <= 300 AND resource !~ '[[:space:]?#@]'),
  phase text NOT NULL CHECK (phase IN ('intent','response','unknown')),
  http_status integer,
  error text CHECK (error IS NULL OR length(error) <= 240),
  run_id uuid,
  receipt_index integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cockpit_eod_radar_receipts IS
  'Receipts for every Slack call EOD Radar makes: the method and a resource template only, never a token, an email, a channel''s messages or a user id. Kept 30 days.';
CREATE INDEX IF NOT EXISTS cockpit_eod_radar_receipts_created_idx ON public.cockpit_eod_radar_receipts(created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_eod_channels','cockpit_eod_radar','cockpit_eod_radar_settings','cockpit_eod_radar_slack_ids',
    'cockpit_eod_radar_digests','cockpit_eod_radar_receipts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
  END LOOP;
END $$;
-- The one direct write: the function's receipt before each Slack call.
GRANT INSERT ON public.cockpit_eod_radar_receipts TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Seeds (never overwrite)

INSERT INTO public.cockpit_eod_radar_settings(id) VALUES (true) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.cockpit_eod_channels(role_pattern,files_eod,channel_id,channel_name,priority,note) VALUES
  ('\mceo\M|founder|chief[[:space:]]*executive', false, NULL, NULL, 1, 'The CEO files no EOD'),
  ('\mbot\M', false, NULL, NULL, 1, 'Bots file no EOD'),
  ('media[[:space:]]*buy', true, 'C0AQ2LD0PL1', 'media-eods', 10, NULL),
  ('video[[:space:]]*edit', true, 'C0AQ2LD0PL1', 'media-eods', 10, NULL),
  ('creative[[:space:]]*(strateg|direct)', true, 'C0AQ2LD0PL1', 'media-eods', 10, NULL),
  ('client[[:space:]]*success|account[[:space:]]*manag|\mcsm\M', true, 'C09RQS2TFST', 'eods-csms', 10, NULL),
  ('\mcloser\M|\msetter\M|sales[[:space:]]*rep', true, 'C0AF5PJEAUX', 'eods-salesreps', 10, NULL),
  ('call[[:space:]]*cent(re|er)|\mcsr\M', true, 'C09R4QJCZ5Y', 'eods-csr', 10, NULL),
  ('systems?[[:space:]]*manag|web[[:space:]]*develop', true, 'C0AS90M9SN6', 'tech-eods', 10, NULL)
ON CONFLICT (role_pattern) DO NOTHING;

-- Slack ids from users.lookupByEmail on 2026-10-15 (read only), matched here
-- by the roster name so no email is written into this file. Ali has no email
-- on the roster: his id is the "Submitted by" on his EODs, whose Slack profile
-- is Ali Abu Elkhair. The function looks everyone up again by email weekly.
INSERT INTO public.cockpit_eod_radar_slack_ids(person_id,slack_user_id,source,note)
SELECT p.id, s.uid, 'migration', s.why
FROM (VALUES
  ('Ahmed Abusahiba','Closer','U0B665Z7WCQ','Looked up by email on 2026-10-15'),
  ('Daniya Ziad','Call centre agent','U0ANNBCT3B3','Looked up by email on 2026-10-15'),
  ('Karim Abdelrahman','Video editor','U0B19NM24AD','Looked up by email on 2026-10-15'),
  ('Lama Harb','Call centre agent','U09SF7GUEHY','Looked up by email on 2026-10-15'),
  ('Muhammed Burhan','Systems manager','U0AS90SHMH8','Looked up by email on 2026-10-15'),
  ('Nada Al Saed','Media buyer','U0AJQ8P1ACF','Looked up by email on 2026-10-15'),
  ('Ahmed Sabry','Creative strategist','U0B2SHGS1JA','Looked up by email on 2026-10-15'),
  ('Rasem Abdel All','Client success manager','U0C5JHUCTPG','Looked up by email on 2026-10-15'),
  ('Ali','Video editor','U0C69400F1U','No email on the roster: the Submitted by on his EODs (Slack profile Ali Abu Elkhair)')
) AS s(name,role,uid,why)
JOIN public.cockpit_people p ON p.name = s.name AND p.role = s.role
WHERE (SELECT count(*) FROM public.cockpit_people q WHERE q.name = s.name) = 1
ON CONFLICT (person_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Helpers (internal: no role may call them directly)

CREATE OR REPLACE FUNCTION public.cockpit_eod_radar_require_service()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF coalesce(auth.jwt()->>'role','') <> 'service_role' THEN
    RAISE EXCEPTION 'EOD Radar needs the service role' USING ERRCODE='42501';
  END IF;
END;
$$;

/** The radar's clock: now(). One seam, so the tests can stand at a fixed moment. */
CREATE OR REPLACE FUNCTION public.cockpit_eod_radar_now()
RETURNS timestamptz LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT pg_catalog.now()
$$;

/** The EOD working day at an instant: Kuwait time minus 4 hours (cockpit_eod_working_day's rule). */
CREATE OR REPLACE FUNCTION public.cockpit_eod_radar_day(p_now timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT ((p_now AT TIME ZONE 'Asia/Kuwait') - interval '4 hours')::date
$$;

/** 'YYYY-MM-DD' as a real date, or NULL. */
CREATE OR REPLACE FUNCTION public.cockpit_eod_radar_try_date(p text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE d date;
BEGIN
  IF p IS NULL OR p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN NULL; END IF;
  BEGIN d := p::date; EXCEPTION WHEN others THEN RETURN NULL; END;
  IF to_char(d,'YYYY-MM-DD') <> p THEN RETURN NULL; END IF;
  RETURN d;
END;
$$;

/** The window a run or a read asks for, checked: real dates, from <= to, at most p_max days, never past today's working day. */
CREATE OR REPLACE FUNCTION public.cockpit_eod_radar_window(p_from text,p_to text,p_max integer)
RETURNS TABLE(from_day date,to_day date) LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE f date := public.cockpit_eod_radar_try_date(p_from); t date := public.cockpit_eod_radar_try_date(p_to);
BEGIN
  IF f IS NULL OR t IS NULL THEN RAISE EXCEPTION 'Choose the days as YYYY-MM-DD' USING ERRCODE='22023'; END IF;
  IF t < f THEN RAISE EXCEPTION 'The first day must come before the last' USING ERRCODE='22023'; END IF;
  IF t - f + 1 > p_max THEN RAISE EXCEPTION 'Choose % days at most', p_max USING ERRCODE='22023'; END IF;
  IF t > public.cockpit_eod_radar_day(public.cockpit_eod_radar_now()) THEN RAISE EXCEPTION 'The radar cannot look at a day that has not started' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT f, t;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_eod_radar_settings_json()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('digestOn',s.digest_on,'remindersOn',s.reminders_on,'strikesOn',s.strikes_on,
    'lateAt',to_char(s.late_at,'HH24:MI'),'closeoutAt',to_char(s.closeout_at,'HH24:MI'),
    'digestChannel',s.digest_channel,'digestChannelName',s.digest_channel_name,'lookbackDays',s.lookback_days)
  FROM public.cockpit_eod_radar_settings s WHERE s.id
$$;

/** The channel row a role files in (lowest priority first), or nothing. */
CREATE OR REPLACE FUNCTION public.cockpit_eod_radar_channel_of(p_role text)
RETURNS public.cockpit_eod_channels LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT c.* FROM public.cockpit_eod_channels c
  WHERE coalesce(p_role,'') ~* c.role_pattern
  ORDER BY c.priority, c.id LIMIT 1
$$;

/**
 * Everyone the radar owes a look at over [p_from, p_to]: not a bot, active or
 * ended inside the window, with a role that files an EOD. Each day says why it
 * is off (friday, not_started, ended, paused, holiday) and whether a full-day
 * Timetastic booking (approved or pending, not marked not taken) covers it.
 * The first owed day is started_on, else the day the person joined the roster.
 */
CREATE OR REPLACE FUNCTION public.cockpit_eod_radar_people(p_from date,p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH ppl AS (
    SELECT p.id, p.name, p.email, p.role, p.ended_on, p.paused_on,
      coalesce(p.started_on, (p.added_at AT TIME ZONE 'Asia/Kuwait')::date) AS first_day,
      c.channel_id, c.channel_name,
      public.cockpit_hours_holidays_json(p.id, p_from, p_to) AS holidays,
      public.cockpit_hours_account_id(p.id, 'timetastic') AS tt
    FROM public.cockpit_people p
    CROSS JOIN LATERAL public.cockpit_eod_radar_channel_of(p.role) c
    WHERE p.engagement IS DISTINCT FROM 'bot'
      AND c.files_eod
      AND (p.active OR (p.ended_on IS NOT NULL AND p.ended_on >= p_from))
  ), days AS (
    SELECT x.id, d::date AS day,
      CASE
        WHEN d::date < x.first_day THEN 'not_started'
        WHEN x.ended_on IS NOT NULL AND d::date > x.ended_on THEN 'ended'
        WHEN (x.paused_on IS NOT NULL AND d::date >= x.paused_on)
          OR EXISTS (SELECT 1 FROM public.cockpit_employment_periods e WHERE e.person_id = x.id AND e.kind = 'paused'
                     AND e.from_day <= d::date AND (e.to_day IS NULL OR d::date <= e.to_day)) THEN 'paused'
        WHEN extract(isodow FROM d) = 5 THEN 'friday'
        WHEN x.holidays @> jsonb_build_array(jsonb_build_object('day', to_char(d,'YYYY-MM-DD'))) THEN 'holiday'
      END AS off,
      (SELECT h->>'name' FROM jsonb_array_elements(x.holidays) h WHERE h->>'day' = to_char(d,'YYYY-MM-DD') LIMIT 1) AS holiday,
      (SELECT coalesce(nullif(btrim(b.leave_type_name),''),'Leave') || CASE WHEN b.status = 'Pending' THEN ' (pending approval)' ELSE '' END
         FROM public.cockpit_timetastic_bookings b
        WHERE x.tt IS NOT NULL AND b.tt_user_id = x.tt AND b.status IN ('Approved','Pending') AND b.gone_at IS NULL
          AND b.booking_unit = 'Days' AND b.start_type <> 'Hours' AND b.end_type <> 'Hours'
          AND b.start_at::date <= d::date AND d::date <= b.end_at::date
          AND NOT (b.start_at::date = d::date AND b.start_type = 'Afternoon')
          AND NOT (b.end_at::date = d::date AND b.end_type = 'Morning')
          AND NOT EXISTS (SELECT 1 FROM public.cockpit_time_adjustments j
                          WHERE j.kind = 'not_booked' AND j.booking_id = b.booking_id AND j.withdrawn_at IS NULL)
        ORDER BY (b.status = 'Approved') DESC, b.booking_id LIMIT 1) AS leave
    FROM ppl x CROSS JOIN generate_series(p_from, p_to, interval '1 day') d
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'personId', x.id, 'name', x.name, 'email', lower(btrim(x.email)), 'role', x.role,
      'channel', x.channel_id, 'channelName', x.channel_name,
      'slackUserId', s.slack_user_id, 'slackSource', s.source, 'slackState', s.state, 'slackCheckedAt', s.checked_at,
      'days', (SELECT jsonb_agg(jsonb_build_object('day', to_char(y.day,'YYYY-MM-DD'), 'off', y.off,
                 'offNote', CASE y.off WHEN 'holiday' THEN coalesce(y.holiday,'Public holiday') END,
                 'leave', y.leave) ORDER BY y.day)
               FROM days y WHERE y.id = x.id)
    ) ORDER BY lower(x.name), x.id), '[]'::jsonb)
  FROM ppl x LEFT JOIN public.cockpit_eod_radar_slack_ids s ON s.person_id = x.id
$$;

-- ---------------------------------------------------------------------------
-- 4. Service RPCs (the Edge Function eod-radar, service key)

/**
 * What a run needs: the settings, the people and their days, the cockpit's
 * sent EODs, the digests. {to} defaults to today's working day and {from} to
 * lookback_days before it, so the regular run credits late posts.
 */
CREATE OR REPLACE FUNCTION public.cockpit_eod_radar_inputs(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE w record; s public.cockpit_eod_radar_settings; v_to text; v_from text;
BEGIN
  PERFORM public.cockpit_eod_radar_require_service();
  SELECT * INTO s FROM public.cockpit_eod_radar_settings WHERE id;
  v_to := coalesce(nullif(p->>'to',''), to_char(public.cockpit_eod_radar_day(public.cockpit_eod_radar_now()),'YYYY-MM-DD'));
  v_from := coalesce(nullif(p->>'from',''), to_char(public.cockpit_eod_radar_try_date(v_to) - s.lookback_days,'YYYY-MM-DD'));
  SELECT * INTO w FROM public.cockpit_eod_radar_window(v_from, v_to, 45);
  RETURN jsonb_build_object(
    'now', public.cockpit_eod_radar_now(),
    'today', to_char(public.cockpit_eod_radar_day(public.cockpit_eod_radar_now()),'YYYY-MM-DD'),
    'from', to_char(w.from_day,'YYYY-MM-DD'), 'to', to_char(w.to_day,'YYYY-MM-DD'),
    'settings', public.cockpit_eod_radar_settings_json(),
    'channels', coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object('id', c.channel_id, 'name', c.channel_name))
                           FROM public.cockpit_eod_channels c WHERE c.files_eod), '[]'::jsonb),
    'people', public.cockpit_eod_radar_people(w.from_day, w.to_day),
    'outbox', coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'role', o.role, 'day', o.day, 'person', o.person,
                  'slackId', o.slack_id, 'channel', o.channel, 'slackTs', o.slack_ts, 'createdAt', o.created_at) ORDER BY o.id)
                FROM public.eod_outbox o
                WHERE o.status = 'sent' AND public.cockpit_eod_radar_try_date(o.day) BETWEEN w.from_day AND w.to_day), '[]'::jsonb),
    'digests', coalesce((SELECT jsonb_agg(jsonb_build_object('day', to_char(g.day,'YYYY-MM-DD'), 'state', g.state, 'attempts', g.attempts) ORDER BY g.day)
                FROM public.cockpit_eod_radar_digests g WHERE g.day BETWEEN w.from_day AND w.to_day), '[]'::jsonb));
END;
$$;

/**
 * Write one run: every person-day of the window (upserted, unchanged rows left
 * alone), the Slack ids looked up, the sync-state row eod-radar and one audit
 * row. Refuses a missed day while a channel was not read, and a missed day
 * before its closeout. Receipts older than 30 days go.
 */
CREATE OR REPLACE FUNCTION public.cockpit_eod_radar_apply(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  w record; s public.cockpit_eod_radar_settings; r jsonb; v_day date; v_person bigint; v_status text;
  v_written int := 0; v_changed int := 0; v_transitions jsonb := '[]'::jsonb; v_old text;
  v_unread boolean; v_today date := public.cockpit_eod_radar_day(public.cockpit_eod_radar_now()); v_ok boolean; v_note text; v_by text;
  v_seen jsonb := '{}'::jsonb; v_key text; v_counts jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.cockpit_eod_radar_require_service();
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR jsonb_typeof(p->'rows') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Send {from, to, rows: [...]}' USING ERRCODE='22023';
  END IF;
  SELECT * INTO w FROM public.cockpit_eod_radar_window(p->>'from', p->>'to', 45);
  SELECT * INTO s FROM public.cockpit_eod_radar_settings WHERE id;
  IF jsonb_array_length(p->'rows') > 5000 THEN RAISE EXCEPTION 'Too many rows in one run' USING ERRCODE='22023'; END IF;
  v_unread := EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p->'channels','[]'::jsonb)) c WHERE (c->>'ok')::boolean IS NOT TRUE);
  v_ok := coalesce((p->>'ok')::boolean, false);
  v_note := left(coalesce(nullif(btrim(p->>'note'),''), CASE WHEN v_ok THEN 'Checked' ELSE 'Checked with problems' END), 500);
  v_by := CASE WHEN coalesce(p->>'requestedBy','cron') ~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN lower(p->>'requestedBy') ELSE 'eod-radar' END;

  FOR r IN SELECT * FROM jsonb_array_elements(p->'rows') LOOP
    v_day := public.cockpit_eod_radar_try_date(r->>'day');
    v_person := CASE WHEN (r->>'personId') ~ '^[0-9]{1,18}$' THEN (r->>'personId')::bigint END;
    v_status := r->>'status';
    IF v_day IS NULL OR v_day < w.from_day OR v_day > w.to_day THEN
      RAISE EXCEPTION 'A row''s day is outside the run''s window' USING ERRCODE='22023';
    END IF;
    IF v_person IS NULL OR NOT EXISTS (SELECT 1 FROM public.cockpit_people x WHERE x.id = v_person) THEN
      RAISE EXCEPTION 'A row names a person who is not on the roster' USING ERRCODE='22023';
    END IF;
    v_key := v_person::text || ':' || to_char(v_day,'YYYY-MM-DD');
    IF v_seen ? v_key THEN RAISE EXCEPTION 'A person has two rows for one day' USING ERRCODE='22023'; END IF;
    v_seen := v_seen || jsonb_build_object(v_key, true);
    IF v_status = 'missed' AND v_unread THEN
      RAISE EXCEPTION 'Nobody is missed while an EOD channel was not read' USING ERRCODE='22023';
    END IF;
    IF v_status = 'missed' AND public.cockpit_eod_radar_now() < ((v_day + s.closeout_at) AT TIME ZONE 'Asia/Kuwait') THEN
      RAISE EXCEPTION 'Nobody is missed before the closeout' USING ERRCODE='22023';
    END IF;
    SELECT x.status INTO v_old FROM public.cockpit_eod_radar x WHERE x.person_id = v_person AND x.day = v_day;
    INSERT INTO public.cockpit_eod_radar AS x(person_id,day,channel,status,posted_at,slack_ts,posted_channel,late_minutes,credited_by,words,quality,note,posts,updated_at)
    VALUES (v_person, v_day, nullif(r->>'channel',''), v_status, (r->>'postedAt')::timestamptz, nullif(r->>'slackTs',''),
      nullif(r->>'postedChannel',''), (r->>'lateMinutes')::int, nullif(r->>'creditedBy',''), (r->>'words')::int,
      left(nullif(btrim(r->>'quality'),''),200), left(nullif(btrim(r->>'note'),''),300), coalesce((r->>'posts')::int,0), now())
    ON CONFLICT (person_id, day) DO UPDATE SET
      channel = EXCLUDED.channel, status = EXCLUDED.status, posted_at = EXCLUDED.posted_at, slack_ts = EXCLUDED.slack_ts,
      posted_channel = EXCLUDED.posted_channel, late_minutes = EXCLUDED.late_minutes, credited_by = EXCLUDED.credited_by,
      words = EXCLUDED.words, quality = EXCLUDED.quality, note = EXCLUDED.note, posts = EXCLUDED.posts, updated_at = now()
    WHERE (x.channel, x.status, x.posted_at, x.slack_ts, x.posted_channel, x.late_minutes, x.credited_by, x.words, x.quality, x.note, x.posts)
      IS DISTINCT FROM (EXCLUDED.channel, EXCLUDED.status, EXCLUDED.posted_at, EXCLUDED.slack_ts, EXCLUDED.posted_channel,
        EXCLUDED.late_minutes, EXCLUDED.credited_by, EXCLUDED.words, EXCLUDED.quality, EXCLUDED.note, EXCLUDED.posts);
    IF FOUND THEN v_changed := v_changed + 1; END IF;
    v_written := v_written + 1;
    v_counts := jsonb_set(v_counts, ARRAY[v_status], to_jsonb(coalesce((v_counts->>v_status)::int,0) + 1));
    IF v_old IS DISTINCT FROM v_status AND jsonb_array_length(v_transitions) < 60 THEN
      v_transitions := v_transitions || jsonb_build_array(jsonb_build_object('personId', v_person, 'day', to_char(v_day,'YYYY-MM-DD'), 'from', v_old, 'to', v_status));
    END IF;
  END LOOP;

  -- Slack ids: a found id replaces the old one; a refusal or a miss keeps it.
  INSERT INTO public.cockpit_eod_radar_slack_ids AS x(person_id,slack_user_id,source,state,note,checked_at,updated_at)
  SELECT (i->>'personId')::bigint, nullif(i->>'slackUserId',''), 'lookup', i->>'state', left(nullif(btrim(i->>'note'),''),300), now(), now()
  FROM jsonb_array_elements(coalesce(p->'slackIds','[]'::jsonb)) i
  WHERE (i->>'personId') ~ '^[0-9]{1,18}$' AND i->>'state' IN ('ok','not_found','refused')
    AND EXISTS (SELECT 1 FROM public.cockpit_people q WHERE q.id = (i->>'personId')::bigint)
    AND (i->>'state' <> 'ok' OR coalesce(i->>'slackUserId','') ~ '^[UW][A-Z0-9]{8,12}$')
  ON CONFLICT (person_id) DO UPDATE SET
    slack_user_id = coalesce(EXCLUDED.slack_user_id, x.slack_user_id),
    source = CASE WHEN EXCLUDED.slack_user_id IS NOT NULL THEN 'lookup' ELSE x.source END,
    state = EXCLUDED.state, note = EXCLUDED.note, checked_at = now(), updated_at = now();

  INSERT INTO public.cockpit_sync_state(key,last_run_at,last_ok_at,ok,note,rows_seen,detail,updated_at)
  VALUES ('eod-radar', now(), CASE WHEN v_ok THEN now() END, v_ok, v_note, v_written,
    jsonb_build_object('from', to_char(w.from_day,'YYYY-MM-DD'), 'to', to_char(w.to_day,'YYYY-MM-DD'), 'mode', coalesce(p->>'mode','run'),
      'counts', v_counts, 'changed', v_changed, 'channels', coalesce(p->'channels','[]'::jsonb),
      'unmatched', coalesce(p->'unmatched','[]'::jsonb), 'scopes', p->'scopes', 'lookups', coalesce(p->'lookups','{}'::jsonb)), now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = CASE WHEN v_ok THEN now() ELSE public.cockpit_sync_state.last_ok_at END,
    ok = v_ok, note = EXCLUDED.note, rows_seen = EXCLUDED.rows_seen, detail = EXCLUDED.detail, updated_at = now();

  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
  VALUES ('eod_radar.run', 'eod_radar', to_char(w.from_day,'YYYY-MM-DD') || '..' || to_char(w.to_day,'YYYY-MM-DD'), v_by, 'ceo', 'eod-radar', NULL,
    jsonb_build_object('mode', coalesce(p->>'mode','run'), 'ok', v_ok, 'rows', v_written, 'changed', v_changed, 'counts', v_counts,
      'transitions', v_transitions,
      'unread', coalesce((SELECT jsonb_agg(c->>'name') FROM jsonb_array_elements(coalesce(p->'channels','[]'::jsonb)) c WHERE (c->>'ok')::boolean IS NOT TRUE), '[]'::jsonb)));

  DELETE FROM public.cockpit_eod_radar_receipts WHERE created_at < now() - interval '30 days';
  RETURN jsonb_build_object('ok', true, 'rows', v_written, 'changed', v_changed, 'today', to_char(v_today,'YYYY-MM-DD'));
END;
$$;

/**
 * Claim the closeout post for a day: only with the digest switched on, only
 * after that day's closeout, once per day. A post left sending for 10 minutes
 * becomes unknown (it may have arrived) and is never sent again; a refused one
 * may be claimed again, 3 tries in all.
 */
CREATE OR REPLACE FUNCTION public.cockpit_eod_radar_digest_claim(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.cockpit_eod_radar_settings; v_day date; v_text text; g public.cockpit_eod_radar_digests;
BEGIN
  PERFORM public.cockpit_eod_radar_require_service();
  SELECT * INTO s FROM public.cockpit_eod_radar_settings WHERE id;
  v_day := public.cockpit_eod_radar_try_date(p->>'day');
  v_text := btrim(coalesce(p->>'text',''));
  IF v_day IS NULL OR v_text = '' OR length(v_text) > 3000 THEN
    RAISE EXCEPTION 'Send {day, text}' USING ERRCODE='22023';
  END IF;
  UPDATE public.cockpit_eod_radar_digests SET state = 'unknown', finished_at = now(),
    error = 'No result was recorded within 10 minutes; it may have been posted, so it is not sent again.'
  WHERE state = 'sending' AND claimed_at < now() - interval '10 minutes';
  IF NOT s.digest_on THEN RETURN jsonb_build_object('claimed', false, 'reason', 'off'); END IF;
  IF public.cockpit_eod_radar_now() < ((v_day + s.closeout_at) AT TIME ZONE 'Asia/Kuwait') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'early');
  END IF;
  IF v_day < public.cockpit_eod_radar_day(public.cockpit_eod_radar_now()) - 1 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'stale');
  END IF;
  INSERT INTO public.cockpit_eod_radar_digests AS x(day,state,channel,text,attempts,claimed_at)
  VALUES (v_day, 'sending', s.digest_channel, v_text, 1, now())
  ON CONFLICT (day) DO UPDATE SET state = 'sending', attempts = x.attempts + 1, text = EXCLUDED.text, channel = EXCLUDED.channel,
    claimed_at = now(), finished_at = NULL, error = NULL
  WHERE x.state = 'failed' AND x.attempts < 3
  RETURNING * INTO g;
  IF g.day IS NULL THEN
    SELECT * INTO g FROM public.cockpit_eod_radar_digests WHERE day = v_day;
    RETURN jsonb_build_object('claimed', false, 'reason', 'done', 'state', g.state);
  END IF;
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
  VALUES ('eod_radar.digest_claim', 'eod_radar_digest', to_char(v_day,'YYYY-MM-DD'), 'eod-radar', 'ceo', 'eod-radar', NULL,
    jsonb_build_object('attempt', g.attempts, 'channel', g.channel));
  RETURN jsonb_build_object('claimed', true, 'day', to_char(g.day,'YYYY-MM-DD'), 'channel', g.channel, 'text', g.text, 'attempt', g.attempts);
END;
$$;

/** Record how the claimed post went: posted (with its ts), failed (Slack refused, nothing posted) or unknown. */
CREATE OR REPLACE FUNCTION public.cockpit_eod_radar_digest_result(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_day date := public.cockpit_eod_radar_try_date(p->>'day'); v_state text := p->>'state'; v_ts text := nullif(p->>'ts','');
BEGIN
  PERFORM public.cockpit_eod_radar_require_service();
  IF v_day IS NULL OR v_state IS NULL OR v_state NOT IN ('posted','failed','unknown') THEN
    RAISE EXCEPTION 'Send {day, state: posted, failed or unknown}' USING ERRCODE='22023';
  END IF;
  IF v_state = 'posted' AND (v_ts IS NULL OR v_ts !~ '^[0-9]{9,11}\.[0-9]{6}$') THEN
    RAISE EXCEPTION 'A posted digest needs its Slack ts' USING ERRCODE='22023';
  END IF;
  UPDATE public.cockpit_eod_radar_digests SET state = v_state, slack_ts = CASE WHEN v_state = 'posted' THEN v_ts END,
    error = left(nullif(btrim(p->>'error'),''),240), finished_at = now()
  WHERE day = v_day AND state = 'sending';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'note', 'That digest is not being sent.'); END IF;
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
  VALUES ('eod_radar.digest_result', 'eod_radar_digest', to_char(v_day,'YYYY-MM-DD'), 'eod-radar', 'ceo', 'eod-radar', NULL,
    jsonb_build_object('state', v_state, 'ts', v_ts, 'error', left(nullif(btrim(p->>'error'),''),240)));
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. The CEO's read (and admins'), for the Management tab

/**
 * Everyone on the radar with their rows in [p_from, p_to] (at most 62 days),
 * the people whose role has no EOD channel, the settings, the last run and the
 * last 7 digests. Reads only; no audit row (nothing changes).
 */
CREATE OR REPLACE FUNCTION public.cockpit_eod_radar_read(p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE w record;
BEGIN
  IF NOT (public.cockpit_is_ceo() OR public.cockpit_has_role('admin')) THEN
    RAISE EXCEPTION 'EOD Radar is for the CEO and admins' USING ERRCODE='42501';
  END IF;
  SELECT * INTO w FROM public.cockpit_eod_radar_window(to_char(p_from,'YYYY-MM-DD'), to_char(p_to,'YYYY-MM-DD'), 62);
  RETURN jsonb_build_object(
    'now', public.cockpit_eod_radar_now(),
    'today', to_char(public.cockpit_eod_radar_day(public.cockpit_eod_radar_now()),'YYYY-MM-DD'),
    'from', to_char(w.from_day,'YYYY-MM-DD'), 'to', to_char(w.to_day,'YYYY-MM-DD'),
    'settings', public.cockpit_eod_radar_settings_json(),
    'sync', (SELECT jsonb_build_object('lastRunAt', x.last_run_at, 'lastOkAt', x.last_ok_at, 'ok', x.ok, 'note', x.note,
               'channels', coalesce(x.detail->'channels','[]'::jsonb), 'unmatched', coalesce(x.detail->'unmatched','[]'::jsonb),
               'scopes', x.detail->'scopes', 'from', x.detail->>'from', 'to', x.detail->>'to')
             FROM public.cockpit_sync_state x WHERE x.key = 'eod-radar'),
    'kick', (SELECT jsonb_build_object('lastRunAt', x.last_run_at, 'ok', x.ok, 'note', x.note)
             FROM public.cockpit_sync_state x WHERE x.key = 'eod-radar-kick'),
    'people', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
          'personId', p.id, 'name', p.name, 'role', p.role, 'active', p.active,
          'channel', c.channel_id, 'channelName', c.channel_name,
          'slackLinked', EXISTS (SELECT 1 FROM public.cockpit_eod_radar_slack_ids s WHERE s.person_id = p.id AND s.slack_user_id IS NOT NULL),
          'days', coalesce((SELECT jsonb_agg(jsonb_build_object('day', to_char(r.day,'YYYY-MM-DD'), 'status', r.status,
                     'postedAt', r.posted_at, 'lateMinutes', r.late_minutes, 'creditedBy', r.credited_by, 'words', r.words,
                     'quality', r.quality, 'note', r.note, 'slackTs', r.slack_ts, 'postedChannel', r.posted_channel, 'posts', r.posts,
                     'updatedAt', r.updated_at) ORDER BY r.day)
                   FROM public.cockpit_eod_radar r WHERE r.person_id = p.id AND r.day BETWEEN w.from_day AND w.to_day), '[]'::jsonb)
        ) ORDER BY lower(p.name), p.id)
      FROM public.cockpit_people p
      CROSS JOIN LATERAL public.cockpit_eod_radar_channel_of(p.role) c
      WHERE p.engagement IS DISTINCT FROM 'bot' AND c.files_eod
        AND (p.active OR EXISTS (SELECT 1 FROM public.cockpit_eod_radar r WHERE r.person_id = p.id AND r.day BETWEEN w.from_day AND w.to_day))
    ), '[]'::jsonb),
    'notTracked', coalesce((
      SELECT jsonb_agg(jsonb_build_object('personId', p.id, 'name', p.name, 'role', p.role) ORDER BY lower(p.name), p.id)
      FROM public.cockpit_people p
      WHERE p.active AND p.engagement IS DISTINCT FROM 'bot'
        AND NOT EXISTS (SELECT 1 FROM public.cockpit_eod_channels c WHERE coalesce(p.role,'') ~* c.role_pattern)
    ), '[]'::jsonb),
    'digests', coalesce((
      SELECT jsonb_agg(jsonb_build_object('day', to_char(g.day,'YYYY-MM-DD'), 'state', g.state, 'slackTs', g.slack_ts,
               'error', g.error, 'finishedAt', g.finished_at) ORDER BY g.day DESC)
      FROM (SELECT * FROM public.cockpit_eod_radar_digests ORDER BY day DESC LIMIT 7) g
    ), '[]'::jsonb));
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. The half-hour kick (vault, pg_net and pg_cron only where they exist)

CREATE OR REPLACE FUNCTION public.cockpit_eod_radar_kick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_url constant text := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/eod-radar';
  v_secret text;
  v_request bigint;
  v_note text;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name=$1 LIMIT 1' INTO v_secret USING 'cockpit_sync_secret';
  END IF;
  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    v_note := 'The vault has no cockpit_sync_secret, so EOD Radar was not started. Add it to the vault.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid = f.pronamespace
                    WHERE n.nspname = 'net' AND f.proname = 'http_post') THEN
    v_note := 'pg_net is not installed, so EOD Radar was not started. Turn the pg_net extension on.';
  END IF;
  IF v_note IS NOT NULL THEN
    INSERT INTO public.cockpit_sync_state(key,last_run_at,ok,note,updated_at)
    VALUES ('eod-radar-kick', now(), false, v_note, now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now(), ok = false, note = EXCLUDED.note, updated_at = now();
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)' INTO v_request
    USING v_url, jsonb_build_object('job','run'), jsonb_build_object('Content-Type','application/json','x-cron-secret',v_secret);
  INSERT INTO public.cockpit_sync_state(key,last_run_at,last_ok_at,ok,note,updated_at)
  VALUES ('eod-radar-kick', now(), now(), true, 'Posted a radar run', now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = now(), ok = true, note = EXCLUDED.note, updated_at = now();
  RETURN v_request;
END;
$$;

-- cron:begin
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname=''mahara-eod-radar''';
    EXECUTE $q$SELECT cron.schedule('mahara-eod-radar','1,31 * * * *',$job$SELECT public.cockpit_eod_radar_kick();$job$)$q$;
  END IF;
END $$;
-- cron:end

-- ---------------------------------------------------------------------------
-- 7. Function privileges: revoked from all four roles, then exactly one grant

DO $$
DECLARE f text;
BEGIN
  -- Internal: no role at all (called by the definer functions above, or by pg_cron as its owner).
  FOREACH f IN ARRAY ARRAY[
    'cockpit_eod_radar_require_service()','cockpit_eod_radar_now()','cockpit_eod_radar_day(timestamptz)','cockpit_eod_radar_try_date(text)',
    'cockpit_eod_radar_window(text,text,integer)','cockpit_eod_radar_settings_json()','cockpit_eod_radar_channel_of(text)',
    'cockpit_eod_radar_people(date,date)','cockpit_eod_radar_kick()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- The CEO's read, with his session (admins too).
  EXECUTE 'REVOKE ALL ON FUNCTION public.cockpit_eod_radar_read(date,date) FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_eod_radar_read(date,date) TO authenticated';
  -- Service RPCs, called by the Edge Function eod-radar with the service key.
  FOREACH f IN ARRAY ARRAY['cockpit_eod_radar_inputs(jsonb)','cockpit_eod_radar_apply(jsonb)',
    'cockpit_eod_radar_digest_claim(jsonb)','cockpit_eod_radar_digest_result(jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
