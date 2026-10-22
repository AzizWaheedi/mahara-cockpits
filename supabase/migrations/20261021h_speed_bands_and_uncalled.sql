-- Bookings by call speed, and the morning uncalled list (2026-10-21, Creative Triage
-- bldgtotkfmhoxmlzowdx).
--
-- Program 2, items 2.8 and 2.6 of the 20 October software plan.
--
-- 2.8 Bookings by response band. On 20 October the dialer worker's read-only query found that
-- paid leads first called within 30 minutes booked 27% of the time against 19% for leads first
-- called after 24 hours (1,365 paid leads, 60 days). Nothing in the database could be asked that
-- question again. This gives Mahara its own curve: bookings per 100 paid leads by minutes to
-- first call, by the hour the lead arrived and by country. It shows correlation only. A faster
-- call may not cause a booking: lead mix by client and hour can differ between the bands.
--   Paid lead      a CRM lead with an ad id (public.client_leads.ad_id), not deleted, at a client the
--                  call centre dials (a location with an outbound call linked to a lead in the window),
--                  created in the window and at least 3 days ago (so it has had time to be called and
--                  to book).
--   First call     the first outbound call linked to the lead after it arrived, with a caller and
--                  no conflict (the dialer's own first-call rule, mahara_reporting.call_center_events).
--                  A call is linked to a lead by the dialer's attribution: the call id the caller saved
--                  or one lead with that full phone number (cc_calls.attribution).
--   Minutes        clock minutes (wall clock) by default, which show the nights and Fridays a lead
--                  waits through. Working minutes (the first caller's schedule, cc_work_seconds) are the
--                  official KPI and are returned beside them.
--   Booked         the lead has a confirmed booking made after it arrived: main or online calendar,
--                  not cancelled or invalid, not a Google Calendar copy. A booking on the
--                  not-confirmed calendar (provisional) is not counted. booked_any also counts every
--                  appointment, which is the 20 October query's basis.
--   Bands          up to 30 minutes, 30 minutes to 4 hours, 4 to 24 hours, over 24 hours, no call.
--   Live read on 21 October (read-only, leads created in the 60 days up to 3 days ago, counted
--   bookings): 26.5% booked when called within 30 minutes (22 of 83) and 18.1% after 24 hours
--   (59 of 326), 1,348 paid leads, with no call 16.0% (62 of 388). The 20 October read, which had no
--   settle time and counted any appointment, gave 27% and 19% over 1,365 leads. The test fixture
--   reproduces the 20 October counts exactly (81/22, 326/61, 1,365 leads).
--
-- 2.6 Morning coverage guard. The board's "called" count counts a lead as called when the contact
-- or the same phone number has an outbound Maqsam call after the lead arrived
-- (cockpit_client_now.verified_called_30d). A call joined to a lead only by its phone number is not
-- a call the caller linked to the lead. This splits every lead the call centre should have called
-- (the board's callable leads: last 30 days, not a WhatsApp chat, a Gulf phone number, older than
-- one working hour) into four groups that add up to the callable total:
--   exact           an outbound call whose id the caller saved against this lead (verified)
--   phone_only      called according to the board, but only because a call to the same phone number was
--                   joined to the lead by number (a unique number match, or a call under another lead
--                   with the same number): no call is linked to this lead
--   outcome_only    no call to the number, but a dialer outcome was saved for the lead
--   never_called    no call and no saved outcome
-- The list (cockpit_morning_uncalled) shows the last three, for paid leads and the rest (a paid flag).
-- It ties to the board like this: never_called = cockpit_client_now.untouched_leads,
-- outcome_only = outcome_only_30d, exact + phone_only = verified_called_30d. So the board's own
-- "uncalled" (callable less verified) is never_called + outcome_only, and the strict total (no call
-- linked to the lead) is that plus phone_only.
--
-- What it adds (read-only, service key only):
--   cockpit_speed_band(minutes, called)               the one place that names a band
--   cockpit_speed_leads(from, to, settle_days)        one row per paid lead: arrival hour, country, minutes (clock and working), booked
--   cockpit_booking_by_speed(from, to, clock, settle) bookings per 100 paid leads by band, by arrival hour and by country
--   cockpit_uncalled_cohort(location, now)            every callable lead with its group
--   cockpit_morning_uncalled(location, now)           the leads in the last three groups
--   cockpit_morning_uncalled_summary(location, now)   the group counts per client beside the board's own counts
--
-- Not in scope: any write, any screen, any alert, a cached copy or a scheduled refresh (the
-- results are worked out when asked), the UAE callback cap and the country rule counters,
-- calls after a meeting, and any claim that call speed causes bookings.
--
-- How we know it works: apps/media-buyer-cockpit/scripts/results-speed-data-supabase.test.ts runs
-- this file on PGlite. A fixture of 1,365 invented paid leads with the 20 October band counts
-- (81/22, 133/33, 422/92, 326/61, 403/69) returns 27.2% and 18.7%. The group counts equal the
-- board's cockpit_client_now columns after the board's own refresh.
--
-- Database work: these functions read the dialer's call view (mahara_reporting.cc_calls), which the
-- board's 30-minute refresh already builds, once per call. They are read when the screen asks and
-- never on a timer. A screen should read them on a person's click, not on a refresh loop.
-- Measured on 21 October with EXPLAIN (ANALYZE, BUFFERS) on the live database, inline, nothing applied:
--   bookings by speed, 60 days: 0.84 s, 12,919 buffer hits, 2 disk reads (cc_calls is two thirds of it)
--   uncalled cohort, first draft (a scan of every call for every lead): 5.8 s, 27,916 buffer hits
--   uncalled cohort, as written here (calls, outcomes and phone numbers summed per lead in one pass, no
--   join per lead): same rows as the draft on a 9,849-lead, 7,935-call test database (no differences in
--   either direction), 2.3 to 3.5 s against 78 to 135 s for the draft there. That test database holds
--   11 times the live number of callable leads. The final shape was not timed live: the database
--   restarted at 21:04 Kuwait time while a different test of the draft was running, so no further live
--   read was run.
--
-- Safe to apply twice. Rollback: DROP FUNCTION for the six names.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regclass('mahara_reporting.cc_calls') IS NULL OR to_regclass('mahara_reporting.cc_leads') IS NULL
     OR to_regclass('mahara_reporting.cc_attempts') IS NULL OR to_regclass('mahara_reporting.cc_people') IS NULL
     OR to_regclass('mahara_reporting.facts') IS NULL OR to_regclass('mahara_console.metadata') IS NULL
     OR to_regprocedure('mahara_reporting.cc_work_seconds(jsonb,timestamptz,timestamptz)') IS NULL
     OR to_regprocedure('mahara_reporting.cc_window(jsonb,date)') IS NULL
     OR to_regprocedure('mahara_reporting.cc_phone(text,text)') IS NULL THEN
    RAISE EXCEPTION 'The dialer''s reporting views (mahara_reporting) are missing';
  END IF;
  IF to_regclass('public.cockpit_client_now') IS NULL OR to_regclass('public.cockpit_board_clients') IS NULL
     OR to_regprocedure('public.cockpit_board_calendar_kind(text)') IS NULL
     OR to_regprocedure('public.cockpit_call_centre_is_test(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'The board facts and the call centre rules are missing: apply 20261013180000 and 20261016111157 first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Bands

/** The band of a first call. p_called is whether the lead had a first call; p_minutes NULL with p_called true is a clock that cannot be read. */
CREATE OR REPLACE FUNCTION public.cockpit_speed_band(p_minutes numeric, p_called boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN NOT coalesce(p_called, false) THEN 'no_call'
    WHEN p_minutes IS NULL THEN 'clock_unknown'
    WHEN p_minutes <= 30 THEN 'up_to_30m'
    WHEN p_minutes <= 240 THEN '30m_to_4h'
    WHEN p_minutes <= 1440 THEN '4h_to_24h'
    ELSE 'over_24h' END
$$;

-- ---------------------------------------------------------------------------
-- 2. One row per paid lead

CREATE OR REPLACE FUNCTION public.cockpit_speed_leads(p_from timestamptz, p_to timestamptz, p_settle_days integer DEFAULT 3)
RETURNS TABLE(location_id text, contact_id text, created_at timestamptz, arrival_hour integer, country text,
  first_call_at timestamptz, clock_minutes numeric, working_minutes numeric, booked boolean, booked_any boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_to timestamptz;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '366 days'
     OR p_settle_days IS NULL OR p_settle_days < 0 OR p_settle_days > 60 THEN
    RAISE EXCEPTION 'Choose a first time before the last, at most 366 days apart, and a settle time of 0 to 60 days.' USING ERRCODE = '22023';
  END IF;
  v_to := least(p_to, now() - make_interval(days => p_settle_days));
  RETURN QUERY
  WITH calls AS MATERIALIZED (
    SELECT c.id, c.started_at, c.agent, c.conflict, c.location_id AS loc, c.contact_id AS cid, c.data->>'type' AS typ
    FROM mahara_reporting.cc_calls c WHERE c.location_id IS NOT NULL AND c.started_at >= p_from
  ), dialed AS (
    SELECT DISTINCT x.loc FROM calls x WHERE x.typ = 'outbound'
  ), lead AS (
    SELECT l.ghl_contact_id AS cid, l.location_id AS loc, l.created_at AS at,
      mahara_reporting.cc_phone(l.contact_phone, g.country) AS phone
    FROM public.client_leads l
    LEFT JOIN public.ghl_clients g ON g.location_id = l.location_id
    WHERE NOT coalesce(l.deleted, false) AND nullif(btrim(l.ad_id), '') IS NOT NULL
      AND l.created_at >= p_from AND l.created_at < v_to
      AND l.location_id IN (SELECT d.loc FROM dialed d)
  ), first_call AS (
    SELECT DISTINCT ON (l.loc, l.cid) l.loc, l.cid, c.started_at, c.agent
    FROM lead l
    JOIN calls c ON c.loc = l.loc AND c.cid = l.cid AND c.typ = 'outbound' AND NOT c.conflict AND c.agent IS NOT NULL
      AND c.started_at >= l.at
    ORDER BY l.loc, l.cid, c.started_at, c.id
  ), appt AS (
    SELECT a.ghl_contact_id AS cid, a.booked_at,
      (coalesce(a.ghl_source, '') <> 'google_calendar' AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid')
        AND public.cockpit_board_calendar_kind(cal.name) IN ('main', 'online')) AS counted
    FROM public.appointments a
    LEFT JOIN LATERAL (
      SELECT c.name FROM public.ghl_calendars c WHERE c.calendar_id = a.calendar_id
      ORDER BY (c.location_id = coalesce(nullif(a.ghl_location_id, ''), nullif(a.ghl_location, ''))) DESC, c.synced_at DESC NULLS LAST LIMIT 1
    ) cal ON true
    WHERE a.ghl_contact_id IS NOT NULL AND a.booked_at >= p_from
  ), bk AS (
    SELECT l.loc, l.cid, bool_or(a.counted) AS counted, true AS any_appt
    FROM lead l JOIN appt a ON a.cid = l.cid AND a.booked_at >= l.at
    GROUP BY l.loc, l.cid
  )
  SELECT l.loc, l.cid, l.at,
    extract(hour FROM l.at AT TIME ZONE 'Asia/Kuwait')::integer,
    CASE left(coalesce(l.phone, ''), 3) WHEN '965' THEN 'KW' WHEN '966' THEN 'SA' WHEN '971' THEN 'AE'
      WHEN '974' THEN 'QA' WHEN '973' THEN 'BH' WHEN '968' THEN 'OM' ELSE 'unknown' END,
    f.started_at,
    CASE WHEN f.started_at IS NOT NULL THEN round(extract(epoch FROM f.started_at - l.at) / 60.0, 1) END,
    CASE WHEN f.started_at IS NOT NULL THEN round(mahara_reporting.cc_work_seconds(p.schedule, l.at, f.started_at) / 60.0, 1) END,
    coalesce(b.counted, false), coalesce(b.any_appt, false)
  FROM lead l
  LEFT JOIN first_call f ON f.loc = l.loc AND f.cid = l.cid
  LEFT JOIN mahara_reporting.cc_people p ON p.email = f.agent
  LEFT JOIN bk b ON b.loc = l.loc AND b.cid = l.cid;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Bookings per 100 paid leads

/**
 * Long format: dimension speed (key all, one row per band and a total), arrival_hour
 * (key 00 to 23, a row per band and one with band all) and country (key KW, SA, AE, QA, BH,
 * OM or unknown). p_clock is clock (wall clock, the default) or working. The count behind each
 * rate is paid_leads: a rate over a handful of leads is a guess. Correlation only.
 */
CREATE OR REPLACE FUNCTION public.cockpit_booking_by_speed(p_from timestamptz, p_to timestamptz,
  p_clock text DEFAULT 'clock', p_settle_days integer DEFAULT 3)
RETURNS TABLE(dimension text, key text, band text, band_order integer, paid_leads integer, bookings integer,
  bookings_per_100 numeric, bookings_any integer, bookings_any_per_100 numeric, window_from timestamptz, window_to timestamptz, note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_clock IS NULL OR p_clock NOT IN ('clock', 'working') THEN
    RAISE EXCEPTION 'p_clock is clock or working.' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH l AS (
    SELECT s.arrival_hour AS hr, s.country AS ctry, s.booked, s.booked_any,
      public.cockpit_speed_band(CASE p_clock WHEN 'working' THEN s.working_minutes ELSE s.clock_minutes END,
                                s.first_call_at IS NOT NULL) AS bnd
    FROM public.cockpit_speed_leads(p_from, p_to, p_settle_days) s
  ), g AS (
    SELECT CASE WHEN GROUPING(l.hr) = 0 THEN 'arrival_hour' WHEN GROUPING(l.ctry) = 0 THEN 'country' ELSE 'speed' END AS dim,
      CASE WHEN GROUPING(l.hr) = 0 THEN lpad(l.hr::text, 2, '0') WHEN GROUPING(l.ctry) = 0 THEN l.ctry ELSE 'all' END AS k,
      CASE WHEN GROUPING(l.bnd) = 0 THEN l.bnd ELSE 'all' END AS b,
      count(*)::integer AS n, count(*) FILTER (WHERE l.booked)::integer AS bk, count(*) FILTER (WHERE l.booked_any)::integer AS bk_any
    FROM l
    GROUP BY GROUPING SETS ((l.bnd), (), (l.hr, l.bnd), (l.hr), (l.ctry, l.bnd), (l.ctry))
  )
  SELECT g.dim, g.k, g.b,
    CASE g.b WHEN 'up_to_30m' THEN 1 WHEN '30m_to_4h' THEN 2 WHEN '4h_to_24h' THEN 3 WHEN 'over_24h' THEN 4
             WHEN 'clock_unknown' THEN 5 WHEN 'no_call' THEN 6 ELSE 7 END,
    g.n, g.bk, round(100.0 * g.bk / g.n, 1), g.bk_any, round(100.0 * g.bk_any / g.n, 1),
    p_from, least(p_to, now() - make_interval(days => p_settle_days)),
    'Correlation only: lead mix by client and hour can differ between bands, so a faster call is not shown to cause a booking.'
  FROM g WHERE g.n > 0
  ORDER BY 1, 2, 4;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The morning uncalled list

/**
 * Every callable lead (the board's rule, cockpit_board_facts_refresh 3.9) with its group:
 * exact, phone_only, outcome_only or never_called. Done-with-you clients are left out, as on
 * the board. p_location limits it to one client; with NULL it lists the Active clients.
 * The lead's first name only, and the last four digits of the phone number.
 */
CREATE OR REPLACE FUNCTION public.cockpit_uncalled_cohort(p_location text DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS TABLE(location_id text, client_name text, contact_id text, first_name text, created_at timestamptz,
  hours_waiting numeric, paid boolean, grp text, call_evidence text, last_call_at timestamptz,
  last_attempt_at timestamptz, last_outcome text, phone_last4 text, contact_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (p_now AT TIME ZONE 'Asia/Kuwait')::date;
  v_start timestamptz := ((p_now AT TIME ZONE 'Asia/Kuwait')::date - 29)::timestamp AT TIME ZONE 'Asia/Kuwait';
BEGIN
  RETURN QUERY
  WITH loc AS (
    SELECT b.location_id AS lid, b.client_name AS cname
    FROM public.cockpit_board_clients b
    WHERE b.service_mode IS DISTINCT FROM 'DWY'
      AND CASE WHEN p_location IS NULL THEN b.status = 'Active'
               ELSE coalesce(b.status, '') NOT IN ('Cancelled', 'Removed from sheet', 'Stopped') AND b.location_id = p_location END
  ), asg AS (
    -- The assigned callers' hours, as the board reads them (the dialer's active assignments, kept
    -- when the dialer account says agent, or Team & Payroll says call centre agent, and the hours read).
    SELECT l.lid, x.schedule
    FROM loc l
    CROSS JOIN LATERAL (
      SELECT cp.schedule,
        cp.schedule IS NOT NULL AND mahara_reporting.cc_window(cp.schedule, v_today) IS NOT NULL AS schedule_ok,
        CASE WHEN i.id IS NOT NULL THEN coalesce(i.data->>'role' = 'agent' AND i.data->>'enabled' = 'true', false)
             ELSE coalesce(pp.role ~* '^call cent(re|er) agent' AND pp.active, false) END AS agent
      FROM (SELECT DISTINCT lower(btrim(m.data->>'email')) AS email FROM mahara_console.metadata m
            WHERE m.namespace = 'production' AND m.id LIKE 'access:agent:%' AND m.data->>'active' = 'true'
              AND jsonb_typeof(m.data->'locationIds') = 'array' AND m.data->'locationIds' ? l.lid
              AND nullif(btrim(m.data->>'email'), '') IS NOT NULL) a
      LEFT JOIN mahara_console.metadata i ON i.namespace = 'production' AND i.id = 'identity:account:' || a.email
      LEFT JOIN mahara_reporting.cc_people cp ON cp.email = a.email
      LEFT JOIN LATERAL (SELECT p.role, p.active FROM public.cockpit_people p WHERE lower(btrim(p.email)) = a.email
                         ORDER BY p.active DESC, p.id DESC LIMIT 1) pp ON true
    ) x
    WHERE x.agent AND x.schedule_ok
  ), sch AS (
    SELECT s.lid, s.schedule FROM asg s
    UNION ALL
    -- 10:00 to 18:00 Kuwait time, Friday off, when no assigned caller has hours.
    SELECT l.lid, '{"timezone":"Asia/Kuwait","exceptions":[],"week":{
      "sun":{"on":true,"start":"10:00","end":"18:00"},"mon":{"on":true,"start":"10:00","end":"18:00"},
      "tue":{"on":true,"start":"10:00","end":"18:00"},"wed":{"on":true,"start":"10:00","end":"18:00"},
      "thu":{"on":true,"start":"10:00","end":"18:00"},"fri":{"on":false,"start":"10:00","end":"18:00"},
      "sat":{"on":true,"start":"10:00","end":"18:00"}}}'::jsonb
    FROM loc l WHERE NOT EXISTS (SELECT 1 FROM asg s WHERE s.lid = l.lid)
  ), coh AS (
    SELECT l.location_id AS lid, l.contact_id AS cid, l.created_at AS at, l.phone,
      (nullif(cl.ad_id, '') IS NULL AND nullif(cl.campaign_id, '') IS NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.data->'tags') = 'array'
                    THEN f.data->'tags' ELSE '[]'::jsonb END) t(x) WHERE lower(btrim(t.x)) = 'inbound whatsapp')) AS chat,
      nullif(btrim(cl.ad_id), '') IS NOT NULL AS paid, cl.contact_name AS nm
    FROM mahara_reporting.cc_leads l
    JOIN loc ON loc.lid = l.location_id
    LEFT JOIN public.client_leads cl ON cl.ghl_contact_id = l.contact_id AND cl.location_id = l.location_id
    LEFT JOIN mahara_reporting.facts f ON f.namespace = 'production' AND f.source = 'ghl' AND f.kind = 'contact'
      AND f.external_id = l.location_id || ':' || l.contact_id
    WHERE l.created_at >= v_start AND l.created_at < p_now
  ), cb AS (
    SELECT h.*, (coalesce(h.phone ~ '^(966|965|971|974)', false)
      AND CASE WHEN h.at <= p_now - interval '4 days' THEN true
               ELSE coalesce((SELECT bool_or(mahara_reporting.cc_work_seconds(s.schedule, h.at, p_now) >= 3600)
                              FROM sch s WHERE s.lid = h.lid), false) END) AS callable
    FROM coh h WHERE NOT h.chat
  ), calls AS MATERIALIZED (
    -- Only calls since the oldest lead in the cohort can follow a lead's arrival.
    SELECT c.started_at, c.agent, c.data->>'type' AS typ, c.conflict, c.location_id AS lid, c.contact_id AS cid,
      c.attribution, mahara_reporting.cc_phone(c.data->>'phone') AS phone
    FROM mahara_reporting.cc_calls c WHERE c.started_at >= v_start
  ), lead_rows AS (
    -- One row per callable lead, with its calls and saved outcomes beside it: the latest linked outbound call,
    -- the latest one the caller saved, the latest saved outcome. This sums three row sets that share the lead's
    -- key, so it needs no join: a join here let the planner scan the call rows once per lead, because a WITH
    -- result carries no statistics to tell it better. A lead has a call after it arrived when the latest is
    -- not before the lead's own created time.
    SELECT u.lid, u.cid,
      max(u.at) FILTER (WHERE u.kind = 0) AS at, max(u.phone) FILTER (WHERE u.kind = 0) AS phone,
      bool_or(u.paid) FILTER (WHERE u.kind = 0) AS paid, max(u.nm) FILTER (WHERE u.kind = 0) AS nm,
      max(u.own_at) AS own_at, max(u.exact_at) AS exact_at, bool_or(u.kind = 2) AS has_att,
      max(u.att_at) AS att_at, max(u.att_outcome) AS att_outcome
    FROM (
      SELECT h.lid, h.cid, h.at, h.phone, h.paid, h.nm, NULL::timestamptz AS own_at, NULL::timestamptz AS exact_at,
        NULL::timestamptz AS att_at, NULL::text AS att_outcome, 0 AS kind
      FROM cb h WHERE h.callable
      UNION ALL
      SELECT c.lid, c.cid, NULL, NULL, NULL, NULL, max(c.started_at),
        max(c.started_at) FILTER (WHERE c.attribution = 'exact_call_id'), NULL, NULL, 1
      FROM calls c
      WHERE c.typ = 'outbound' AND NOT c.conflict AND c.agent IS NOT NULL AND c.lid IS NOT NULL AND c.cid IS NOT NULL
      GROUP BY c.lid, c.cid
      UNION ALL
      SELECT a.location_id, a.contact_id, NULL, NULL, NULL, NULL, NULL, NULL, max(a.outcome_at),
        (array_agg(a.data->'disposition'->>'outcome' ORDER BY a.outcome_at DESC NULLS LAST))[1], 2
      FROM mahara_reporting.cc_attempts a
      WHERE a.location_id IN (SELECT lid FROM loc) AND a.contact_id IS NOT NULL AND NOT public.cockpit_call_centre_is_test(a.data)
      GROUP BY a.location_id, a.contact_id
    ) u
    GROUP BY u.lid, u.cid
    HAVING bool_or(u.kind = 0)
  ), with_phone AS (
    -- The same by phone number, with one window per number instead of a join: calls under the same number
    -- are summed per lead they are under, then ordered newest first. Each lead reads the newest call under
    -- its number and the newest under any other lead (the second row when the newest is its own).
    SELECT t.*,
      nth_value(t.last_at, 1) OVER w AS n1_at, nth_value(t.owner, 1) OVER w AS n1_owner, nth_value(t.last_at, 2) OVER w AS n2_at
    FROM (
      SELECT l.lid, l.cid, l.at, l.phone, l.paid, l.nm, l.own_at, l.exact_at, l.has_att, l.att_at, l.att_outcome,
        NULL::timestamptz AS last_at, NULL::text AS owner, 0 AS kind
      FROM lead_rows l
      UNION ALL
      SELECT NULL, NULL, NULL, x.phone, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        max(x.started_at), x.lid || chr(31) || x.cid, 1
      FROM calls x WHERE x.typ = 'outbound' AND x.phone IS NOT NULL
      GROUP BY x.phone, x.lid, x.cid
    ) t
    WINDOW w AS (PARTITION BY t.phone ORDER BY t.last_at DESC NULLS LAST, t.owner NULLS LAST
                 ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
  )
  SELECT p.lid, loc.cname, p.cid,
    (regexp_match(btrim(coalesce(p.nm, '')), '^[^[:space:]]+'))[1],
    p.at, round(extract(epoch FROM p_now - p.at) / 3600.0, 1), p.paid,
    CASE WHEN x.exact THEN 'exact'
         WHEN x.own_last IS NOT NULL OR x.oth_last IS NOT NULL THEN 'phone_only'
         WHEN p.has_att THEN 'outcome_only'
         ELSE 'never_called' END,
    CASE WHEN x.exact THEN 'call_id'
         WHEN x.own_last IS NOT NULL THEN 'unique_phone_match'
         WHEN x.oth_last IS NOT NULL THEN 'same_phone_other_lead' END,
    greatest(x.own_last, x.oth_last), p.att_at, p.att_outcome,
    right(p.phone, 4),
    CASE WHEN p.lid ~ '^[A-Za-z0-9_-]{1,64}$' AND p.cid ~ '^[A-Za-z0-9_-]{1,64}$'
         THEN 'https://app.gohighlevel.com/v2/location/' || p.lid || '/contacts/detail/' || p.cid END
  FROM with_phone p
  JOIN loc ON loc.lid = p.lid
  CROSS JOIN LATERAL (SELECT CASE WHEN p.n1_owner IS NOT DISTINCT FROM (p.lid || chr(31) || p.cid)
                                  THEN p.n2_at ELSE p.n1_at END AS raw) o2
  CROSS JOIN LATERAL (SELECT CASE WHEN p.own_at >= p.at THEN p.own_at END AS own_last,
                             coalesce(p.exact_at >= p.at, false) AS exact,
                             CASE WHEN o2.raw >= p.at THEN o2.raw END AS oth_last) x
  WHERE p.kind = 0
  ORDER BY loc.cname, p.at;
END $$;

/** The leads with no call linked to them, oldest first: phone_only, outcome_only and never_called. */
CREATE OR REPLACE FUNCTION public.cockpit_morning_uncalled(p_location text DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS TABLE(location_id text, client_name text, contact_id text, first_name text, created_at timestamptz,
  hours_waiting numeric, paid boolean, grp text, call_evidence text, last_call_at timestamptz,
  last_attempt_at timestamptz, last_outcome text, phone_last4 text, contact_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM public.cockpit_uncalled_cohort(p_location, p_now) c WHERE c.grp <> 'exact'
  ORDER BY c.created_at, c.contact_id
$$;

/**
 * Per client: the callable leads and the four groups, with the board's own stored counts beside
 * them. matches_board is true when never_called = untouched_leads, outcome_only = outcome_only_30d
 * and exact + phone_only = verified_called_30d, NULL when the board holds no row for the client.
 * The board's counts are as of its last refresh (board_computed_at), so a lead called since then
 * can make the two differ by a few.
 */
CREATE OR REPLACE FUNCTION public.cockpit_morning_uncalled_summary(p_location text DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS TABLE(location_id text, client_name text, callable integer, exact integer, phone_only integer,
  outcome_only integer, never_called integer, uncalled_strict integer, uncalled_paid integer,
  board_callable integer, board_verified integer, board_outcome_only integer, board_untouched integer,
  board_computed_at timestamptz, matches_board boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH c AS (SELECT * FROM public.cockpit_uncalled_cohort(p_location, p_now)),
  s AS (
    SELECT c.location_id, max(c.client_name) AS client_name, count(*) AS callable,
      count(*) FILTER (WHERE c.grp = 'exact') AS exact, count(*) FILTER (WHERE c.grp = 'phone_only') AS phone_only,
      count(*) FILTER (WHERE c.grp = 'outcome_only') AS outcome_only, count(*) FILTER (WHERE c.grp = 'never_called') AS never_called,
      count(*) FILTER (WHERE c.grp <> 'exact' AND c.paid) AS uncalled_paid
    FROM c GROUP BY c.location_id
  )
  SELECT b.location_id, b.client_name, coalesce(s.callable, 0)::integer, coalesce(s.exact, 0)::integer, coalesce(s.phone_only, 0)::integer,
    coalesce(s.outcome_only, 0)::integer, coalesce(s.never_called, 0)::integer,
    (coalesce(s.phone_only, 0) + coalesce(s.outcome_only, 0) + coalesce(s.never_called, 0))::integer,
    coalesce(s.uncalled_paid, 0)::integer,
    n.callable_30d, n.verified_called_30d, n.outcome_only_30d, n.untouched_leads, n.computed_at,
    CASE WHEN n.location_id IS NULL THEN NULL
         ELSE coalesce(s.never_called, 0) = coalesce(n.untouched_leads, 0)
          AND coalesce(s.outcome_only, 0) = coalesce(n.outcome_only_30d, 0)
          AND coalesce(s.exact, 0) + coalesce(s.phone_only, 0) = coalesce(n.verified_called_30d, 0) END
  FROM public.cockpit_board_clients b
  LEFT JOIN s ON s.location_id = b.location_id
  LEFT JOIN public.cockpit_client_now n ON n.location_id = b.location_id
  WHERE b.service_mode IS DISTINCT FROM 'DWY'
    AND CASE WHEN p_location IS NULL THEN b.status = 'Active'
             ELSE coalesce(b.status, '') NOT IN ('Cancelled', 'Removed from sheet', 'Stopped') AND b.location_id = p_location END
  ORDER BY b.client_name, b.location_id
$$;

REVOKE ALL ON FUNCTION public.cockpit_speed_band(numeric, boolean), public.cockpit_speed_leads(timestamptz, timestamptz, integer),
  public.cockpit_booking_by_speed(timestamptz, timestamptz, text, integer),
  public.cockpit_uncalled_cohort(text, timestamptz), public.cockpit_morning_uncalled(text, timestamptz),
  public.cockpit_morning_uncalled_summary(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_speed_band(numeric, boolean), public.cockpit_speed_leads(timestamptz, timestamptz, integer),
  public.cockpit_booking_by_speed(timestamptz, timestamptz, text, integer),
  public.cockpit_uncalled_cohort(text, timestamptz), public.cockpit_morning_uncalled(text, timestamptz),
  public.cockpit_morning_uncalled_summary(text, timestamptz) TO service_role;

COMMIT;
