-- results-speed-timing.sql: the reads the four new screens make, as plain read-only SELECTs for timing.
-- Branch claude/results-speed-data-686611, 21 October 2026. Nothing here creates, writes or changes anything.
--
-- Why inline: migrations 20261021e to 20261021i are not applied, so each query below is the body of the new
-- function with its parameters filled in, copied from the migration files (the test
-- "the timing file does the same work as the functions" in results-speed-data-supabase.test.ts holds each one
-- equal to its function on the test database). They call only objects that exist today: cockpit_board_clients,
-- cockpit_client_days, cockpit_client_now, cockpit_board_marks_json, cockpit_board_appointments,
-- cockpit_board_calendar_kind, cockpit_call_centre_is_test, public.appointments, public.client_leads,
-- public.ghl_clients, public.ghl_calendars, public.cockpit_people, mahara_reporting.cc_results, cc_calls, cc_leads,
-- cc_attempts, cc_people, facts, sheet_snapshots, cc_phone, cc_time, cc_window, cc_work_seconds, mahara_console.metadata.
--
-- Every query is one block: BEGIN READ ONLY; SET LOCAL statement_timeout = '15s'; <SELECT>; ROLLBACK;
-- READ ONLY makes any write fail. If your tool cannot hold a transaction across statements, send the SET LOCAL
-- line as SET statement_timeout = '15s' in the same call as the SELECT and RESET statement_timeout after it.
-- Every parameter is worked out inside the query from now() in Kuwait time and from the board's own client list
-- (the prm CTE at the top), so nothing needs filling in.
--
-- To time one: put EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) in front of its SELECT (Execution Time is the number),
-- or run it as written and take the call's wall time. Each ends in a small result so little comes back.
-- Do not change planner settings (no enable_nestloop = off): that is what ran when the database restarted on
-- 21 October. Avoid the :02 and :32 minutes (the board's refresh) and run the blocks one at a time, in order.
--
-- Order, cheapest first: Q7, Q3, Q2, Q1, Q4, Q5, Q6. Q6 is the only one never timed on live data, so run it last
-- and cancel it if it passes about 8 seconds. Measured live on 21 October with the same logic: gap report 0.31 s,
-- CSM list 0.05 s, 60-day speed read 0.84 s, the first draft of the morning cohort 5.8 s (the version here is the
-- final one, 2 to 3.5 s on a test database with 11 times the live leads).
--
-- How often each read runs in production (no timers, no cache; every read happens when a person opens a view):
--   Q1 gap report            when the "No result" view opens (media buyer /performance?view=gap) or the CSM
--                            Clients > results view opens. One read per open, one more per Try again.
--   Q2 one client's meetings when a person opens a client's row in the gap report. One read per row opened.
--   Q3 CSM call list         when the CSM opens Today, and again after each "Called" press (the list reloads).
--   Q4, Q5 speed chart       when the "Call speed" view opens (60 days, clock time) and when a person picks the
--                            30, 90 days or Working hours chip. The hour and country filters read nothing.
--                            Q4 and Q5 are the 30 and 90 day windows; 60 days is the default and sits between.
--   Q6 morning list          when the "Morning list" view opens. One read per open, one more per Try again.
--                            The board comparison (Q7 part) is inside the same read.
--   Q7 board comparison      part of Q6 (the join to cockpit_client_now); alone it is the cost of that join.
--
-- What each scans (mahara_reporting.cc_calls is the heavy one; it is read once, in a MATERIALIZED CTE with a date
-- range, in Q4, Q5 and Q6, and never in a correlated subquery):
--   Q1  cockpit_board_clients, cockpit_board_marks_json and cockpit_board_appointments once per Active client (the
--       board's own page-load work), mahara_reporting.cc_results per client, sheet_snapshots, cockpit_client_days.
--       Does not read cc_calls.
--   Q2  the same for one client, plus public.client_leads (one lookup per meeting). Does not read cc_calls.
--   Q3  sheet_snapshots (about 20 rows, their JSON rows) and cockpit_board_clients. Does not read cc_calls.
--   Q4, Q5  cc_calls since the window start (one MATERIALIZED scan), public.client_leads, public.appointments,
--       ghl_calendars, cc_people, cc_work_seconds once per lead that had a call.
--   Q6  cc_calls since 29 days ago (one MATERIALIZED scan, summed per lead and per phone number), cc_leads,
--       cc_attempts, facts (WhatsApp tag), client_leads, cc_people and mahara_console.metadata (the callers' hours),
--       cockpit_client_now.
--   Q7  cockpit_board_clients and cockpit_client_now only.
--
-- Left out on purpose (tiny, and they read tables that do not exist yet or are not the cost): the call log join
-- (cockpit_csm_call_log, new, at most 5 rows a week), the seat checks (cockpit_has_active_seat and the like, one
-- row each), the cockpit_people name lookup for a called client, and the JSON packing of the result.
-- The Q1 and Q3 reads compute every Active client whatever the seat; the screen filters afterwards. So a CSM seat
-- with one client costs the same as the media buyer's all-clients read.

-- @@ Q7
-- Q7. Board comparison alone: the join of the board's client list to its stored counts.
--   Scans: cockpit_board_clients, cockpit_client_now.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
  SELECT count(*) AS board_clients, count(n.location_id) AS with_board_row, max(n.computed_at) AS board_computed_at,
    sum(n.callable_30d) AS board_callable, sum(n.untouched_leads) AS board_untouched
  FROM public.cockpit_board_clients b
  LEFT JOIN public.cockpit_client_now n ON n.location_id = b.location_id
  WHERE b.service_mode IS DISTINCT FROM 'DWY' AND b.status = 'Active';
ROLLBACK;

-- @@ Q3
-- Q3. CSM call list (CSM Today), all Active clients, runs counted by Thursday 10:00 that were due, 60 days back.
--   Scans: cockpit_board_clients, mahara_reporting.sheet_snapshots (JSON rows).
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
  WITH prm AS (SELECT now() AS ts), runs AS (
    -- Every Thursday 10:00 Kuwait time that has already passed, with its ISO week.
    SELECT ((g.d + time '10:00') AT TIME ZONE 'Asia/Kuwait') AS t, to_char(g.d, 'IYYY-"W"IW') AS wk
    FROM (SELECT ((SELECT ts FROM prm) AT TIME ZONE 'Asia/Kuwait')::date - o AS d FROM generate_series(0, 60 + 14) AS o) g
    WHERE extract(dow FROM g.d) = 4 AND ((g.d + time '10:00') AT TIME ZONE 'Asia/Kuwait') <= (SELECT ts FROM prm)
  ), sent AS (
    SELECT DISTINCT CASE WHEN jsonb_typeof(e) = 'string' THEN e #>> '{}' ELSE e->>'key' END AS k
    FROM jsonb_array_elements(coalesce(NULL::jsonb, '[]'::jsonb)) e
    WHERE jsonb_typeof(e) = 'string' OR coalesce(e->>'status', e->'data'->>'status') = 'sent'
  ), sheet AS (
    SELECT b.location_id AS loc, b.client_name AS name, s.checked_at, s.error,
      btrim(coalesce(r->>'name', '')) AS lead, mahara_reporting.cc_time(r->>'meeting') AS t,
      btrim(coalesce(r->>'show', '')) AS show, btrim(coalesce(r->>'closed', '')) AS closed,
      upper(btrim(coalesce(r->>'confirmed', ''))) AS conf
    FROM public.cockpit_board_clients b
    JOIN mahara_reporting.sheet_snapshots s ON s.id = b.location_id AND s.namespace = 'production' AND s.data->>'sheetId' = s.sheet_id
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.data->'rows') = 'array' THEN s.data->'rows' ELSE '[]'::jsonb END) r
    WHERE b.status = 'Active'
  ), gaps AS (
    SELECT sh.*, CASE WHEN sh.show = '' THEN 'show' WHEN upper(sh.show) = 'Y' AND sh.closed = '' THEN 'closed' END AS kind
    FROM sheet sh
    WHERE sh.lead <> '' AND sh.conf <> 'C' AND sh.t IS NOT NULL AND sh.t <= (SELECT ts FROM prm)
      AND sh.t >= (SELECT ts FROM prm) - make_interval(days => 60)
  ), asked AS (
    SELECT g.*, (
      SELECT count(*) FROM runs u
      WHERE u.t >= g.t AND u.t <= g.t + interval '14 days'
        AND (NULL::jsonb IS NULL OR ('report-' || g.loc || '-' || u.wk) IN (SELECT k FROM sent))
    ) AS asks
    FROM gaps g WHERE g.kind IS NOT NULL
  ), per AS (
    SELECT a.loc, a.name, max(a.checked_at) AS checked, max(a.error) AS err,
      count(*) FILTER (WHERE a.asks >= 2) AS missing,
      count(*) FILTER (WHERE a.asks >= 2 AND a.kind = 'show') AS m_show,
      count(*) FILTER (WHERE a.asks >= 2 AND a.kind = 'closed') AS m_closed,
      min(a.t) FILTER (WHERE a.asks >= 2) AS oldest,
      count(*) FILTER (WHERE a.asks BETWEEN 1 AND 2 - 1) AS first_chase,
      jsonb_agg(jsonb_build_object(
        'name', (regexp_match(a.lead, '^[^[:space:]]+'))[1],
        'day', to_char(a.t AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD'),
        'cell', CASE a.kind WHEN 'show' THEN 'Show' ELSE 'Closed' END,
        'runs', a.asks) ORDER BY a.t, a.lead) FILTER (WHERE a.asks >= 2) AS list
    FROM asked a GROUP BY a.loc, a.name
  )
  SELECT p.loc AS location_id, p.name AS client_name,
    (row_number() OVER (ORDER BY p.missing DESC, p.oldest, p.name, p.loc))::integer AS rank,
    p.missing::integer AS missing_meetings, p.m_show::integer AS missing_show, p.m_closed::integer AS missing_closed,
    (p.oldest AT TIME ZONE 'Asia/Kuwait')::date AS oldest_meeting, p.first_chase::integer AS in_first_chase,
    jsonb_array_length(p.list) AS meetings_listed, p.checked AS sheet_checked_at, p.err AS sheet_error
  FROM per p
  WHERE p.missing > 0
  -- A CSM seat sees only its own clients: the screen filters this list to them afterwards, so the work is the same.
  ORDER BY 3;
ROLLBACK;

-- @@ Q2
-- Q2. One client's meetings with no result, 14 days (a click on a row of the gap report).
--   Scans: cockpit_board_marks_json, cockpit_board_appointments, mahara_reporting.cc_results, public.client_leads.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
  WITH prm AS (
    -- The Active client with the most past meetings in the window: the heaviest row a person can open.
    SELECT now() AS ts, (now() AT TIME ZONE 'Asia/Kuwait')::date - 13 AS d_from, (now() AT TIME ZONE 'Asia/Kuwait')::date AS d_to,
      (SELECT f.location_id FROM public.cockpit_client_days f
       JOIN public.cockpit_board_clients b ON b.location_id = f.location_id AND b.status = 'Active'
       WHERE f.day BETWEEN (now() AT TIME ZONE 'Asia/Kuwait')::date - 13 AND (now() AT TIME ZONE 'Asia/Kuwait')::date
       GROUP BY f.location_id ORDER BY sum(f.meetings_due) DESC NULLS LAST, f.location_id LIMIT 1) AS p_location
  ), mk AS (
    SELECT public.cockpit_board_marks_json((SELECT p_location FROM prm), (SELECT d_from FROM prm), (SELECT d_to FROM prm)) AS marks
  ), ap AS (
    SELECT a.* FROM mk, public.cockpit_board_appointments((SELECT p_location FROM prm), (SELECT d_from FROM prm), (SELECT d_to FROM prm), mk.marks) a
    WHERE (coalesce(a.due, false) AND a.attendance = 'unknown')
  ), sh AS MATERIALIZED (
    SELECT r.contact_id, r.meeting, min(r.attendance) FILTER (WHERE r.attendance IN ('Y', 'N')) AS attendance,
          bool_or(r.conflict) OR count(DISTINCT nullif(btrim(r.attendance), '')) > 1
            OR bool_or(nullif(btrim(r.attendance), '') IS NOT NULL AND r.attendance NOT IN ('Y', 'N')) AS conflict
        FROM mahara_reporting.cc_results r
        WHERE r.location_id = (SELECT p_location FROM prm) AND r.contact_id IS NOT NULL
          AND r.meeting >= (SELECT d_from FROM prm)::timestamp AT TIME ZONE 'Asia/Kuwait'
          AND r.meeting < ((SELECT d_to FROM prm) + 1)::timestamp AT TIME ZONE 'Asia/Kuwait'
        GROUP BY r.contact_id, r.meeting
  )
  SELECT count(*) AS meetings, count(*) FILTER (WHERE m.sheet_state = 'blank') AS sheet_blank,
    count(*) FILTER (WHERE m.crm_confirmed) AS crm_confirmed, max(m.meeting_at) AS latest, (SELECT p_location FROM prm) AS location_id
  FROM (

    SELECT ap.id, ap.contact_id,
      (regexp_match(btrim(coalesce(nullif(btrim(ap.contact_name), ''), cl.contact_name, '')), '^[^[:space:]]+'))[1],
      ap.start_at, (ap.start_at AT TIME ZONE 'Asia/Kuwait')::date, ap.kind, ap.status, ap.status = 'confirmed',
      CASE WHEN s.n IS NULL THEN 'missing' WHEN s.has_conflict THEN 'unclear' WHEN s.has_blank THEN 'blank' ELSE 'missing' END,
      ((SELECT ts FROM prm) AT TIME ZONE 'Asia/Kuwait')::date - (ap.start_at AT TIME ZONE 'Asia/Kuwait')::date,
      CASE WHEN (SELECT p_location FROM prm) ~ '^[A-Za-z0-9_-]{1,64}$' AND coalesce(ap.contact_id, '') ~ '^[A-Za-z0-9_-]{1,64}$'
           THEN 'https://app.gohighlevel.com/v2/location/' || (SELECT p_location FROM prm) || '/contacts/detail/' || ap.contact_id END
    FROM ap
    LEFT JOIN LATERAL (SELECT l.contact_name FROM public.client_leads l
                       WHERE l.ghl_contact_id = ap.contact_id AND l.location_id = (SELECT p_location FROM prm) LIMIT 1) cl ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS n, bool_or(x.attendance IS NULL AND NOT x.conflict) AS has_blank, bool_or(x.conflict) AS has_conflict
      FROM sh x WHERE x.contact_id = ap.contact_id AND x.meeting = ap.start_at
    ) s ON s.n > 0
  ) m(appointment_id, contact_id, first_name, meeting_at, meeting_day, calendar_kind, crm_status, crm_confirmed, sheet_state, days_since, contact_url);
ROLLBACK;

-- @@ Q1
-- Q1. Gap report, every Active client, the last 14 days in Kuwait time.
--   Scans: cockpit_board_marks_json and cockpit_board_appointments per client, mahara_reporting.cc_results, sheet_snapshots, cockpit_client_days.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
  WITH prm AS (
    SELECT now() AS ts, (now() AT TIME ZONE 'Asia/Kuwait')::date - 13 AS d_from, (now() AT TIME ZONE 'Asia/Kuwait')::date AS d_to, NULL::text AS p_location
  ), cl AS (
    SELECT b.location_id AS loc, b.client_name AS name, b.service_mode AS mode
    FROM public.cockpit_board_clients b
    WHERE CASE WHEN (SELECT p_location FROM prm) IS NULL THEN b.status = 'Active'
               ELSE coalesce(b.status, '') NOT IN ('Cancelled', 'Removed from sheet') AND b.location_id = (SELECT p_location FROM prm) END
  ), g AS (
    SELECT cl.loc, x.*
    FROM cl
    CROSS JOIN LATERAL (
      WITH mk AS (
        SELECT public.cockpit_board_marks_json(cl.loc, (SELECT d_from FROM prm), (SELECT d_to FROM prm)) AS marks
      ), sh AS MATERIALIZED (
        SELECT r.contact_id, r.meeting, min(r.attendance) FILTER (WHERE r.attendance IN ('Y', 'N')) AS attendance,
          bool_or(r.conflict) OR count(DISTINCT nullif(btrim(r.attendance), '')) > 1
            OR bool_or(nullif(btrim(r.attendance), '') IS NOT NULL AND r.attendance NOT IN ('Y', 'N')) AS conflict
        FROM mahara_reporting.cc_results r
        WHERE r.location_id = cl.loc AND r.contact_id IS NOT NULL
          AND r.meeting >= (SELECT d_from FROM prm)::timestamp AT TIME ZONE 'Asia/Kuwait'
          AND r.meeting < ((SELECT d_to FROM prm) + 1)::timestamp AT TIME ZONE 'Asia/Kuwait'
        GROUP BY r.contact_id, r.meeting
      ), ap AS (
        SELECT a.*, (coalesce(a.due, false) AND a.attendance = 'unknown') AS gap, s.state
        FROM mk
        CROSS JOIN LATERAL public.cockpit_board_appointments(cl.loc, (SELECT d_from FROM prm), (SELECT d_to FROM prm), mk.marks) a
        LEFT JOIN LATERAL (
          SELECT CASE WHEN count(*) = 0 THEN 'missing' WHEN bool_or(y.conflict) THEN 'unclear'
                      WHEN bool_or(y.attendance IS NULL) THEN 'blank' ELSE 'missing' END AS state
          FROM sh y WHERE y.contact_id = a.contact_id AND y.meeting = a.start_at
        ) s ON true
      )
      SELECT (SELECT marks IS NOT NULL FROM mk) AS marks_ok,
        count(*) FILTER (WHERE ap.due) AS due,
        count(*) FILTER (WHERE ap.gap) AS no_result,
        count(*) FILTER (WHERE ap.gap AND ap.status = 'confirmed') AS crm_conf,
        count(*) FILTER (WHERE ap.gap AND ap.state = 'blank') AS sh_blank,
        count(*) FILTER (WHERE ap.gap AND ap.state = 'missing') AS sh_missing,
        count(*) FILTER (WHERE ap.gap AND ap.state = 'unclear') AS sh_unclear,
        count(*) FILTER (WHERE ap.gap AND ap.status = 'confirmed' AND ap.state = 'blank') AS both_,
        max(((SELECT ts FROM prm) AT TIME ZONE 'Asia/Kuwait')::date - (ap.start_at AT TIME ZONE 'Asia/Kuwait')::date) FILTER (WHERE ap.gap) AS oldest
      FROM ap
    ) x
  ), sh AS (
    -- The sheet, row by row, as the dialer last read it.
    SELECT s.id AS loc, s.checked_at, s.error,
      count(w.r) AS total,
      count(*) FILTER (WHERE w.in_win) AS in_win,
      count(*) FILTER (WHERE w.in_win AND upper(btrim(coalesce(w.show, ''))) IN ('Y', 'N')) AS filled,
      count(*) FILTER (WHERE w.in_win AND btrim(coalesce(w.show, '')) = '') AS blank
    FROM mahara_reporting.sheet_snapshots s
    JOIN cl ON cl.loc = s.id
    LEFT JOIN LATERAL (
      SELECT r, r->>'show' AS show,
        coalesce(mahara_reporting.cc_time(r->>'meeting') >= (SELECT d_from FROM prm)::timestamp AT TIME ZONE 'Asia/Kuwait'
          AND mahara_reporting.cc_time(r->>'meeting') < ((SELECT d_to FROM prm) + 1)::timestamp AT TIME ZONE 'Asia/Kuwait'
          AND mahara_reporting.cc_time(r->>'meeting') <= (SELECT ts FROM prm), false) AS in_win
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.data->'rows') = 'array' THEN s.data->'rows' ELSE '[]'::jsonb END) r
    ) w ON true
    WHERE s.namespace = 'production' AND s.data->>'sheetId' = s.sheet_id
    GROUP BY s.id, s.checked_at, s.error
  ), bd AS (
    SELECT f.location_id AS loc,
      sum(f.meetings_due) AS due, count(f.meetings_due) AS due_d,
      sum(f.no_outcome) AS no_out, count(f.no_outcome) AS no_out_d, max(f.computed_at) AS computed
    FROM public.cockpit_client_days f JOIN cl ON cl.loc = f.location_id
    WHERE f.day BETWEEN (SELECT d_from FROM prm) AND (SELECT d_to FROM prm)
    GROUP BY f.location_id
  )
  SELECT cl.loc AS location_id, cl.name AS client_name,
    coalesce(g.due, 0)::integer AS meetings_past, coalesce(g.no_result, 0)::integer AS no_result,
    coalesce(g.crm_conf, 0)::integer AS crm_confirmed, coalesce(g.sh_blank, 0)::integer AS sheet_blank,
    coalesce(g.sh_missing, 0)::integer AS sheet_missing, coalesce(g.sh_unclear, 0)::integer AS sheet_unclear,
    g.oldest::integer AS oldest_days, coalesce(g.marks_ok, false) AS sheet_read_ok,
    sh.total::integer AS sheet_rows_total, sh.in_win::integer AS sheet_rows_in_window, sh.checked_at AS sheet_checked_at,
    CASE WHEN bd.due_d > 0 THEN bd.due::integer END AS board_meetings_past,
    CASE WHEN bd.no_out_d > 0 THEN bd.no_out::integer END AS board_no_outcome,
    CASE WHEN bd.due_d > 0 AND bd.no_out_d > 0 THEN (bd.due = coalesce(g.due, 0) AND bd.no_out = coalesce(g.no_result, 0)) END AS matches_board
  FROM cl
  LEFT JOIN g ON g.loc = cl.loc
  LEFT JOIN sh ON sh.loc = cl.loc
  LEFT JOIN bd ON bd.loc = cl.loc
  ORDER BY g.no_result DESC NULLS LAST, cl.name, cl.loc;
ROLLBACK;

-- @@ Q4
-- Q4. Speed chart, 30 days (arrival hour and country come from the same cells).
--   Scans: mahara_reporting.cc_calls once (MATERIALIZED, started_at >= window start), public.client_leads, public.appointments, public.ghl_calendars, mahara_reporting.cc_people.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
  WITH prm AS (
    SELECT ((now() AT TIME ZONE 'Asia/Kuwait')::date - 29)::timestamp AT TIME ZONE 'Asia/Kuwait' AS t_from,
           least(((now() AT TIME ZONE 'Asia/Kuwait')::date + 1)::timestamp AT TIME ZONE 'Asia/Kuwait', now() - interval '3 days') AS t_to
  ), calls AS MATERIALIZED (
    SELECT c.id, c.started_at, c.agent, c.conflict, c.location_id AS loc, c.contact_id AS cid, c.data->>'type' AS typ
    FROM mahara_reporting.cc_calls c WHERE c.location_id IS NOT NULL AND c.started_at >= (SELECT t_from FROM prm)
  ), dialed AS (
    SELECT DISTINCT x.loc FROM calls x WHERE x.typ = 'outbound'
  ), lead AS (
    SELECT l.ghl_contact_id AS cid, l.location_id AS loc, l.created_at AS at,
      mahara_reporting.cc_phone(l.contact_phone, g.country) AS phone
    FROM public.client_leads l
    LEFT JOIN public.ghl_clients g ON g.location_id = l.location_id
    WHERE NOT coalesce(l.deleted, false) AND nullif(btrim(l.ad_id), '') IS NOT NULL
      AND l.created_at >= (SELECT t_from FROM prm) AND l.created_at < (SELECT t_to FROM prm)
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
    WHERE a.ghl_contact_id IS NOT NULL AND a.booked_at >= (SELECT t_from FROM prm)
  ), bk AS (
    SELECT l.loc, l.cid, bool_or(a.counted) AS counted, true AS any_appt
    FROM lead l JOIN appt a ON a.cid = l.cid AND a.booked_at >= l.at
    GROUP BY l.loc, l.cid
  ), s AS (
    SELECT l.loc, l.cid, l.at, extract(hour FROM l.at AT TIME ZONE 'Asia/Kuwait')::integer AS hr,
      CASE left(coalesce(l.phone, ''), 3) WHEN '965' THEN 'KW' WHEN '966' THEN 'SA' WHEN '971' THEN 'AE'
        WHEN '974' THEN 'QA' WHEN '973' THEN 'BH' WHEN '968' THEN 'OM' ELSE 'unknown' END AS ctry,
      f.started_at AS first_call_at,
      CASE WHEN f.started_at IS NOT NULL THEN round(extract(epoch FROM f.started_at - l.at) / 60.0, 1) END AS clock_minutes,
      CASE WHEN f.started_at IS NOT NULL THEN round(mahara_reporting.cc_work_seconds(p.schedule, l.at, f.started_at) / 60.0, 1) END AS working_minutes,
      coalesce(b.counted, false) AS booked, coalesce(b.any_appt, false) AS booked_any
    FROM lead l
    LEFT JOIN first_call f ON f.loc = l.loc AND f.cid = l.cid
    LEFT JOIN mahara_reporting.cc_people p ON p.email = f.agent
    LEFT JOIN bk b ON b.loc = l.loc AND b.cid = l.cid
  ), cells AS (
    -- Both clocks are worked out for every lead, as cockpit_speed_leads does; the band is the clock one (cockpit_speed_band).
    SELECT s.hr, s.ctry,
      CASE WHEN s.first_call_at IS NULL THEN 'no_call' WHEN s.clock_minutes IS NULL THEN 'clock_unknown'
           WHEN s.clock_minutes <= 30 THEN 'up_to_30m' WHEN s.clock_minutes <= 240 THEN '30m_to_4h'
           WHEN s.clock_minutes <= 1440 THEN '4h_to_24h' ELSE 'over_24h' END AS bnd,
      count(*)::integer AS n, count(*) FILTER (WHERE s.booked)::integer AS bk,
      count(*) FILTER (WHERE s.booked_any)::integer AS bk_any, sum(s.working_minutes) AS working_minutes_sum
    FROM s GROUP BY 1, 2, 3
  )
  -- The screen gets these cells as they are. To see the bands instead: SELECT bnd, sum(n), sum(bk) FROM cells GROUP BY bnd ORDER BY 1;
  SELECT count(*) AS cells, sum(n) AS paid_leads, sum(bk) AS bookings, sum(bk_any) AS bookings_any,
    round(sum(working_minutes_sum)) AS working_minutes_sum
  FROM cells;
ROLLBACK;

-- @@ Q5
-- Q5. Speed chart, 90 days.
--   Scans: as Q4, over 90 days.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
  WITH prm AS (
    SELECT ((now() AT TIME ZONE 'Asia/Kuwait')::date - 89)::timestamp AT TIME ZONE 'Asia/Kuwait' AS t_from,
           least(((now() AT TIME ZONE 'Asia/Kuwait')::date + 1)::timestamp AT TIME ZONE 'Asia/Kuwait', now() - interval '3 days') AS t_to
  ), calls AS MATERIALIZED (
    SELECT c.id, c.started_at, c.agent, c.conflict, c.location_id AS loc, c.contact_id AS cid, c.data->>'type' AS typ
    FROM mahara_reporting.cc_calls c WHERE c.location_id IS NOT NULL AND c.started_at >= (SELECT t_from FROM prm)
  ), dialed AS (
    SELECT DISTINCT x.loc FROM calls x WHERE x.typ = 'outbound'
  ), lead AS (
    SELECT l.ghl_contact_id AS cid, l.location_id AS loc, l.created_at AS at,
      mahara_reporting.cc_phone(l.contact_phone, g.country) AS phone
    FROM public.client_leads l
    LEFT JOIN public.ghl_clients g ON g.location_id = l.location_id
    WHERE NOT coalesce(l.deleted, false) AND nullif(btrim(l.ad_id), '') IS NOT NULL
      AND l.created_at >= (SELECT t_from FROM prm) AND l.created_at < (SELECT t_to FROM prm)
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
    WHERE a.ghl_contact_id IS NOT NULL AND a.booked_at >= (SELECT t_from FROM prm)
  ), bk AS (
    SELECT l.loc, l.cid, bool_or(a.counted) AS counted, true AS any_appt
    FROM lead l JOIN appt a ON a.cid = l.cid AND a.booked_at >= l.at
    GROUP BY l.loc, l.cid
  ), s AS (
    SELECT l.loc, l.cid, l.at, extract(hour FROM l.at AT TIME ZONE 'Asia/Kuwait')::integer AS hr,
      CASE left(coalesce(l.phone, ''), 3) WHEN '965' THEN 'KW' WHEN '966' THEN 'SA' WHEN '971' THEN 'AE'
        WHEN '974' THEN 'QA' WHEN '973' THEN 'BH' WHEN '968' THEN 'OM' ELSE 'unknown' END AS ctry,
      f.started_at AS first_call_at,
      CASE WHEN f.started_at IS NOT NULL THEN round(extract(epoch FROM f.started_at - l.at) / 60.0, 1) END AS clock_minutes,
      CASE WHEN f.started_at IS NOT NULL THEN round(mahara_reporting.cc_work_seconds(p.schedule, l.at, f.started_at) / 60.0, 1) END AS working_minutes,
      coalesce(b.counted, false) AS booked, coalesce(b.any_appt, false) AS booked_any
    FROM lead l
    LEFT JOIN first_call f ON f.loc = l.loc AND f.cid = l.cid
    LEFT JOIN mahara_reporting.cc_people p ON p.email = f.agent
    LEFT JOIN bk b ON b.loc = l.loc AND b.cid = l.cid
  ), cells AS (
    -- Both clocks are worked out for every lead, as cockpit_speed_leads does; the band is the clock one (cockpit_speed_band).
    SELECT s.hr, s.ctry,
      CASE WHEN s.first_call_at IS NULL THEN 'no_call' WHEN s.clock_minutes IS NULL THEN 'clock_unknown'
           WHEN s.clock_minutes <= 30 THEN 'up_to_30m' WHEN s.clock_minutes <= 240 THEN '30m_to_4h'
           WHEN s.clock_minutes <= 1440 THEN '4h_to_24h' ELSE 'over_24h' END AS bnd,
      count(*)::integer AS n, count(*) FILTER (WHERE s.booked)::integer AS bk,
      count(*) FILTER (WHERE s.booked_any)::integer AS bk_any, sum(s.working_minutes) AS working_minutes_sum
    FROM s GROUP BY 1, 2, 3
  )
  -- The screen gets these cells as they are. To see the bands instead: SELECT bnd, sum(n), sum(bk) FROM cells GROUP BY bnd ORDER BY 1;
  SELECT count(*) AS cells, sum(n) AS paid_leads, sum(bk) AS bookings, sum(bk_any) AS bookings_any,
    round(sum(working_minutes_sum)) AS working_minutes_sum
  FROM cells;
ROLLBACK;

-- @@ Q6
-- Q6. Morning list with the board comparison: every callable lead of the last 30 days, its group, then the counts per client beside cockpit_client_now.
--   Scans: mahara_reporting.cc_calls once (MATERIALIZED, last 30 days), cc_leads, cc_attempts, facts, public.client_leads, cc_people, mahara_console.metadata, cockpit_client_now.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
  WITH prm AS (
    SELECT now() AS ts, (now() AT TIME ZONE 'Asia/Kuwait')::date AS v_today,
           ((now() AT TIME ZONE 'Asia/Kuwait')::date - 29)::timestamp AT TIME ZONE 'Asia/Kuwait' AS v_start, NULL::text AS p_location
  ), loc AS (
    SELECT b.location_id AS lid, b.client_name AS cname
    FROM public.cockpit_board_clients b
    WHERE b.service_mode IS DISTINCT FROM 'DWY'
      AND CASE WHEN (SELECT p_location FROM prm) IS NULL THEN b.status = 'Active'
               ELSE coalesce(b.status, '') NOT IN ('Cancelled', 'Removed from sheet', 'Stopped') AND b.location_id = (SELECT p_location FROM prm) END
  ), asg AS (
    -- The assigned callers' hours, as the board reads them (the dialer's active assignments, kept
    -- when the dialer account says agent, or Team & Payroll says call centre agent, and the hours read).
    SELECT l.lid, x.schedule
    FROM loc l
    CROSS JOIN LATERAL (
      SELECT cp.schedule,
        cp.schedule IS NOT NULL AND mahara_reporting.cc_window(cp.schedule, (SELECT v_today FROM prm)) IS NOT NULL AS schedule_ok,
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
    WHERE l.created_at >= (SELECT v_start FROM prm) AND l.created_at < (SELECT ts FROM prm)
  ), cb AS (
    SELECT h.*, (coalesce(h.phone ~ '^(966|965|971|974)', false)
      AND CASE WHEN h.at <= (SELECT ts FROM prm) - interval '4 days' THEN true
               ELSE coalesce((SELECT bool_or(mahara_reporting.cc_work_seconds(s.schedule, h.at, (SELECT ts FROM prm)) >= 3600)
                              FROM sch s WHERE s.lid = h.lid), false) END) AS callable
    FROM coh h WHERE NOT h.chat
  ), calls AS MATERIALIZED (
    -- Only calls since the oldest lead in the cohort can follow a lead's arrival.
    SELECT c.started_at, c.agent, c.data->>'type' AS typ, c.conflict, c.location_id AS lid, c.contact_id AS cid,
      c.attribution, mahara_reporting.cc_phone(c.data->>'phone') AS phone
    FROM mahara_reporting.cc_calls c WHERE c.started_at >= (SELECT v_start FROM prm)
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
  ), c AS MATERIALIZED (
    SELECT p.lid AS location_id, loc.cname AS client_name, p.cid AS contact_id,
      (regexp_match(btrim(coalesce(p.nm, '')), '^[^[:space:]]+'))[1] AS first_name,
      p.at AS created_at, round(extract(epoch FROM (SELECT ts FROM prm) - p.at) / 3600.0, 1) AS hours_waiting, p.paid,
      CASE WHEN x.exact THEN 'exact'
           WHEN x.own_last IS NOT NULL OR x.oth_last IS NOT NULL THEN 'phone_only'
           WHEN p.has_att THEN 'outcome_only'
           ELSE 'never_called' END AS grp,
      greatest(x.own_last, x.oth_last) AS last_call_at, p.att_at AS last_attempt_at, p.att_outcome AS last_outcome,
      right(p.phone, 4) AS phone_last4
    FROM with_phone p
    JOIN loc ON loc.lid = p.lid
    CROSS JOIN LATERAL (SELECT CASE WHEN p.n1_owner IS NOT DISTINCT FROM (p.lid || chr(31) || p.cid)
                                    THEN p.n2_at ELSE p.n1_at END AS raw) o2
    CROSS JOIN LATERAL (SELECT CASE WHEN p.own_at >= p.at THEN p.own_at END AS own_last,
                               coalesce(p.exact_at >= p.at, false) AS exact,
                               CASE WHEN o2.raw >= p.at THEN o2.raw END AS oth_last) x
    WHERE p.kind = 0
  ), s AS (
    SELECT c.location_id, count(*) AS callable,
      count(*) FILTER (WHERE c.grp = 'exact') AS exact, count(*) FILTER (WHERE c.grp = 'phone_only') AS phone_only,
      count(*) FILTER (WHERE c.grp = 'outcome_only') AS outcome_only, count(*) FILTER (WHERE c.grp = 'never_called') AS never_called,
      count(*) FILTER (WHERE c.grp <> 'exact' AND c.paid) AS uncalled_paid
    FROM c GROUP BY c.location_id
  )
  -- The board comparison: the same read joins the board's stored counts (cockpit_client_now) per client.
  SELECT b.location_id, b.client_name, coalesce(s.callable, 0)::integer AS callable, coalesce(s.exact, 0)::integer AS exact,
    coalesce(s.phone_only, 0)::integer AS phone_only, coalesce(s.outcome_only, 0)::integer AS outcome_only,
    coalesce(s.never_called, 0)::integer AS never_called, coalesce(s.uncalled_paid, 0)::integer AS uncalled_paid,
    n.callable_30d AS board_callable, n.verified_called_30d AS board_verified, n.outcome_only_30d AS board_outcome_only,
    n.untouched_leads AS board_untouched, n.computed_at AS board_computed_at,
    CASE WHEN n.location_id IS NULL THEN NULL
         ELSE coalesce(s.never_called, 0) = coalesce(n.untouched_leads, 0)
          AND coalesce(s.outcome_only, 0) = coalesce(n.outcome_only_30d, 0)
          AND coalesce(s.exact, 0) + coalesce(s.phone_only, 0) = coalesce(n.verified_called_30d, 0) END AS matches_board
  FROM public.cockpit_board_clients b
  LEFT JOIN s ON s.location_id = b.location_id
  LEFT JOIN public.cockpit_client_now n ON n.location_id = b.location_id
  WHERE b.service_mode IS DISTINCT FROM 'DWY' AND b.status = 'Active'
  ORDER BY b.client_name, b.location_id;
ROLLBACK;
