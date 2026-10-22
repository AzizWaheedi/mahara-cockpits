-- Number meanings: one definition per number, in SQL (2026-10-21, Creative Triage
-- bldgtotkfmhoxmlzowdx).
--
-- Program 1, item 1.6 of the 20 October software plan (Muhammed approved the reduced
-- build on 21 October). The media buyer, client success and CEO screens each count show
-- rate, coverage and cost per booking their own way, so the same client and week can read
-- three different numbers. This file gives one reading that all three can call. It adds
-- reading functions only. It changes no stored value and adds no table, no job and no
-- schedule ("change how reports count, never a stored value").
--
-- What it adds (all read-only, service key only):
--   cockpit_dictionary_definitions()        what each number means, in plain words, with
--                                           its source and the decision that set it
--   cockpit_dictionary_cancelled(from, to)  cancelled past meetings per client, counted
--                                           apart from no-shows
--   cockpit_dictionary_numbers(from, to, location)
--                                           per client, for one Kuwait-day window: show
--                                           rate, coverage, cancellations, bookings,
--                                           cost per booking, cost per attended meeting,
--                                           first call in working minutes
--   cockpit_dictionary_first_call()         the official first-call number: the median of
--                                           the clients' medians, in working minutes
--
-- The meanings (DECISIONS.md: 2026-09-23 "Show rate and close rate formulas";
-- 2026-08-27 "Panel attendance comes from the client report sheet"; "New bookings count
-- by creation date"; 2026-10-16 board targets; plan item 1.6 and research D06):
--   Show rate. Shows / (shows + no-shows). A meeting nobody marked is never a no-show
--     and is not in the rate. A cancellation is neither a show nor a no-show.
--   Cancellations. Past meetings the CRM says were cancelled, by the Kuwait meeting day,
--     main, online and not-confirmed calendars, no Google Calendar copies. Counted apart
--     from no-shows, because a reminder can raise cancellations while it lowers no-shows.
--   Coverage. Meetings with attendance recorded / past meetings that were not cancelled.
--     Attendance is recorded when the CRM status says showed or no-show, or the client
--     sheet marks it, or the portal records it (the board's attendance rule, unchanged).
--   Cost per booking. Spend / confirmed bookings counted by the day the booking was
--     made. A booking on the not-confirmed calendar (provisional) is shown beside it and
--     never counted. The board's own cell is read as it is, so the number is the board's.
--   Cost per attended meeting. Spend / showed meetings by the day of the meeting, over
--     the same days as cost per booking. Done-for-you clients only. Hidden (NULL, with
--     the reason) until coverage is 80% or more over the same time frame.
--   First call. Working minutes are the official number: the call centre's own hours, the
--     assigned caller's schedule, the dialer's cc_work_seconds. Clock minutes (wall clock)
--     are kept for shift analysis and are read lead by lead in cockpit_speed_leads
--     (20261021h). The official figure is the median of the clients' 30-day medians.
--   No result (the one rule for a gap) is in 20261021f: meeting ended, not cancelled, no
--     attendance recorded.
--
-- Not in scope: any screen, any write, any stored value, the close rate and the quotation
-- rate, a second spend source, a new schedule or job, Make's sent record (item 3 says how
-- that is handled), the UAE callback cap and the country rule counters.
--
-- How we know it works: apps/media-buyer-cockpit/scripts/results-speed-data-supabase.test.ts
-- runs this file on PGlite over the board's own migrations. The dictionary's show rate and
-- cost per booking equal cockpit_board_rows' cells for the same window, coverage and
-- cancellations are worked out from invented meetings, and the cost per attended meeting is
-- hidden at 79% and shown at 80% coverage, and for a done-with-you client never.
--
-- Database work: the functions read cockpit_client_days (about 4,100 rows), cockpit_client_now
-- (33 rows) and public.appointments (about 3,400 rows) and call cockpit_board_rows once, which
-- is what one board page load already does. No table is scanned in a loop and nothing is
-- scheduled. Measured numbers are in the commit message and the session hand-over note.
--
-- Depends on the board: 20261016111157, 20261016133300, 20261016210000 and the later board
-- files. Safe to apply twice (CREATE OR REPLACE). Rollback: DROP FUNCTION for the four names.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regclass('public.cockpit_client_days') IS NULL OR to_regclass('public.cockpit_client_now') IS NULL
     OR to_regclass('public.cockpit_board_clients') IS NULL OR to_regclass('public.appointments') IS NULL THEN
    RAISE EXCEPTION 'The board facts tables are missing: apply 20261016111157_board_facts.sql and its corrections first';
  END IF;
  IF to_regprocedure('public.cockpit_board_rows(date,date,text,jsonb)') IS NULL
     OR to_regprocedure('public.cockpit_board_check_window(date,date)') IS NULL
     OR to_regprocedure('public.cockpit_board_calendar_kind(text)') IS NULL
     OR to_regprocedure('public.cockpit_meta_ad_days_status()') IS NULL THEN
    RAISE EXCEPTION 'The board functions are missing: apply 20261016133300_board_api.sql and its corrections first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. What each number means

CREATE OR REPLACE FUNCTION public.cockpit_dictionary_definitions()
RETURNS TABLE(metric text, label text, formula text, counts text, leaves_out text, source text, decision text)
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT * FROM (VALUES
    ('show_rate', 'Show rate',
     'Shows divided by shows plus no-shows.',
     'Meetings whose time has passed that are marked showed or no-show: the CRM status, else the client sheet, else the portal.',
     'Meetings nobody marked (never a no-show) and cancelled meetings.',
     'cockpit_client_days (shows, no_shows), the same sums as the board.',
     '2026-09-23 Show rate and close rate formulas; 2026-08-27 Panel attendance comes from the client report sheet'),
    ('cancellations', 'Cancellations',
     'Count of past meetings the CRM says were cancelled.',
     'Meetings on the main, online and not-confirmed calendars, by the Kuwait day of the meeting, with the meeting time already past.',
     'Google Calendar copies. Cancellations are never added to no-shows.',
     'public.appointments with status cancelled.',
     'Plan item 1.6, research D06 (a reminder can raise cancellations)'),
    ('coverage', 'Coverage',
     'Meetings with attendance recorded divided by past meetings that were not cancelled.',
     'Recorded means showed or no-show from the CRM status, the client sheet or the portal.',
     'Cancelled and invalid meetings, and meetings still in the future.',
     'cockpit_client_days (meetings_due, shows, no_shows).',
     'Plan item 1.6'),
    ('no_attendance', 'No result',
     'Past meetings that were not cancelled and have no attendance recorded.',
     'The meeting has ended, it is not cancelled or invalid, and none of the CRM status, the client sheet and the portal gives showed or no-show.',
     'Cancelled meetings, future meetings, Google Calendar copies.',
     'cockpit_board_appointments, the board''s own appointment list (see cockpit_gap_report).',
     'Plan item 1.1'),
    ('cost_per_booking', 'Cost per booking',
     'Ad spend divided by confirmed bookings counted by the day the booking was made.',
     'Main and online calendar bookings that are not cancelled, not invalid and not Google Calendar copies. Spend and bookings over the same days.',
     'Provisional bookings (not-confirmed calendar), shown beside it and never counted. Days with no ad numbers.',
     'The board''s costPerBooking cell (cockpit_board_rows).',
     'New bookings count by creation date; 2026-10-13 Client success judges clients on $15 per lead and $60 per booking'),
    ('cost_per_attended', 'Cost per attended meeting',
     'Ad spend divided by showed meetings counted by the day of the meeting, over the same days as cost per booking.',
     'Done-for-you clients only. Shown only when coverage is 80% or more.',
     'Done-with-you clients. Any client under 80% coverage: the reason is returned instead of a number.',
     'The board''s costPerBooking spend and cockpit_client_days.shows.',
     'Plan item 1.6'),
    ('first_call_working', 'First call (working minutes), official',
     'Minutes from the lead arriving to the first outbound call, counting only the assigned caller''s working hours.',
     'Each client''s 30-day median. The official number is the median of those client medians.',
     'Time outside the caller''s schedule. Leads with no call.',
     'cockpit_client_now.first_call_median_work_seconds_30d (the dialer''s cc_work_seconds).',
     '2026-10-16 board lines: First call, 30 working minutes'),
    ('first_call_clock', 'First call (clock minutes), for shift analysis',
     'Minutes on the wall clock from the lead arriving to the first outbound call.',
     'Every minute, day and night.',
     'Not an official number. It shows what the lead lived through, including nights and Fridays.',
     'cockpit_speed_leads (20261021h).',
     'Plan item 1.6'),
    ('bookings_per_100_by_speed', 'Bookings per 100 paid leads by speed to first call',
     'Paid leads that booked divided by paid leads, times 100, per band of minutes to first call.',
     'Paid leads (an ad id) at clients the call centre dials, created at least 3 days ago.',
     'It shows correlation only. It does not show that a faster call causes a booking.',
     'cockpit_booking_by_speed (20261021h).',
     'Plan item 2.8')
  ) AS v(metric, label, formula, counts, leaves_out, source, decision)
$$;

-- ---------------------------------------------------------------------------
-- 2. Cancellations, counted apart from no-shows

CREATE OR REPLACE FUNCTION public.cockpit_dictionary_cancelled(p_from date, p_to date)
RETURNS TABLE(location_id text, cancellations integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT x.location_id, count(*)::integer
  FROM (
    SELECT coalesce(nullif(a.ghl_location_id, ''), nullif(a.ghl_location, '')) AS location_id, a.calendar_id
    FROM public.appointments a
    WHERE a.status = 'cancelled' AND coalesce(a.ghl_source, '') <> 'google_calendar'
      AND a.start_at >= p_from::timestamp AT TIME ZONE 'Asia/Kuwait'
      AND a.start_at < (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait'
      AND a.start_at <= now()
  ) x
  LEFT JOIN LATERAL (
    SELECT c.name FROM public.ghl_calendars c WHERE c.calendar_id = x.calendar_id
    ORDER BY (c.location_id = x.location_id) DESC, c.synced_at DESC NULLS LAST LIMIT 1
  ) cal ON true
  WHERE x.location_id IS NOT NULL AND public.cockpit_board_calendar_kind(cal.name) IN ('main', 'online', 'provisional')
  GROUP BY x.location_id
$$;

-- ---------------------------------------------------------------------------
-- 3. The numbers per client for one window

/**
 * One row per client for the Kuwait-day window. p_location limits it to one client (any
 * client not cancelled); with NULL it lists the Active clients, as the board does.
 * A figure is NULL when it cannot be worked out, and its *_status says why:
 *   ok, not_measured (the source could not be read), not_filled_in (meetings were due and
 *   none is marked), too_few (nothing to divide by), hidden_low_coverage, not_dfy.
 * Missing is never zero.
 */
CREATE OR REPLACE FUNCTION public.cockpit_dictionary_numbers(p_from date, p_to date, p_location text DEFAULT NULL)
RETURNS TABLE(
  location_id text, client_name text, service_mode text, window_from date, window_to date,
  meetings_past integer, shows integer, no_shows integer, attendance_recorded integer, no_attendance integer,
  cancellations integer,
  show_rate numeric, show_rate_status text,
  coverage numeric, coverage_status text,
  bookings_counted integer, bookings_provisional integer,
  bookings_paired integer, spend_paired_usd numeric, cost_per_booking numeric, cost_per_booking_status text,
  showed_paired integer, cost_per_attended numeric, cost_per_attended_status text,
  first_call_work_minutes numeric, note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_line constant numeric := 80;   -- coverage, in percent, at which cost per attended meeting shows
  v_meta jsonb;
BEGIN
  PERFORM public.cockpit_board_check_window(p_from, p_to);
  v_meta := public.cockpit_meta_ad_days_status();
  RETURN QUERY
  WITH b AS (
    SELECT x AS r FROM jsonb_array_elements(public.cockpit_board_rows(p_from, p_to, p_location, v_meta)) x
  ), cx AS (
    SELECT r->>'locationId' AS loc, r->>'clientName' AS name, r->>'serviceMode' AS mode, r,
      r->'values'->'costPerBooking' AS cpb, r->'adCover' AS cover
    FROM b
  ), d AS (
    -- The stored facts, summed as the board sums them: a figure exists when at least one day has one.
    SELECT f.location_id AS loc,
      sum(f.meetings_due) AS due, count(f.meetings_due) AS due_d,
      sum(f.shows) AS shows, sum(f.no_shows) AS no_shows, count(f.shows) AS shows_d,
      sum(f.confirmed_bookings) AS booked, count(f.confirmed_bookings) AS booked_d,
      sum(f.provisional_bookings) AS prov, count(f.provisional_bookings) AS prov_d
    FROM public.cockpit_client_days f JOIN cx ON cx.loc = f.location_id
    WHERE f.day BETWEEN p_from AND p_to
    GROUP BY f.location_id
  ), paired AS (
    -- Showed meetings on the days cost per booking is worked out over: the days every linked
    -- ad account has stored and the facts know bookings for.
    SELECT cx.loc, sum(f.shows) AS shows_paired, count(*) AS paired_days
    FROM cx
    JOIN public.cockpit_client_days f ON f.location_id = cx.loc
      AND f.day BETWEEN (cx.cover->>'pairFrom')::date AND (cx.cover->>'pairTo')::date
      AND f.day BETWEEN p_from AND p_to AND f.confirmed_bookings IS NOT NULL
    WHERE cx.cover->>'state' IN ('full', 'partial')
    GROUP BY cx.loc
  ), c AS (
    SELECT * FROM public.cockpit_dictionary_cancelled(p_from, p_to)
  ), m AS (
    SELECT cx.loc, cx.name, cx.mode, cx.cpb, cx.r,
      CASE WHEN d.due_d > 0 THEN d.due END AS due,
      CASE WHEN d.shows_d > 0 THEN coalesce(d.shows, 0) END AS shows,
      CASE WHEN d.shows_d > 0 THEN coalesce(d.no_shows, 0) END AS no_shows,
      CASE WHEN d.booked_d > 0 THEN d.booked END AS booked,
      CASE WHEN d.prov_d > 0 THEN d.prov END AS prov,
      p.shows_paired, c.cancellations AS cancelled,
      (r->'values'->'firstCall'->>'v')::numeric AS first_work
    FROM cx
    LEFT JOIN d ON d.loc = cx.loc
    LEFT JOIN paired p ON p.loc = cx.loc
    LEFT JOIN c ON c.location_id = cx.loc
  ), k AS (
    SELECT m.*,
      -- recorded attendance: shows + no-shows. A day with meetings due and none marked has both NULL: that is 0 recorded.
      CASE WHEN m.due IS NULL THEN NULL ELSE coalesce(m.shows, 0) + coalesce(m.no_shows, 0) END AS recorded
    FROM m
  )
  SELECT k.loc, k.name, k.mode, p_from, p_to,
    k.due::integer, k.shows::integer, k.no_shows::integer, k.recorded::integer,
    CASE WHEN k.due IS NULL THEN NULL ELSE (k.due - k.recorded)::integer END,
    coalesce(k.cancelled, 0),
    -- show rate: shows / (shows + no-shows), as the board's showRate cell
    CASE WHEN k.recorded > 0 THEN round(k.shows::numeric / k.recorded * 100, 2) END,
    CASE WHEN k.due IS NULL THEN 'not_measured' WHEN k.due = 0 THEN 'too_few'
         WHEN k.recorded = 0 THEN 'not_filled_in' ELSE 'ok' END,
    -- coverage: recorded / past meetings not cancelled
    CASE WHEN k.due > 0 THEN round(k.recorded::numeric / k.due * 100, 2) END,
    CASE WHEN k.due IS NULL THEN 'not_measured' WHEN k.due = 0 THEN 'too_few' ELSE 'ok' END,
    k.booked::integer, k.prov::integer,
    (k.cpb->>'den')::integer,
    (k.cpb->>'num')::numeric,
    -- cost per booking is the board's own cell, so the number cannot differ from the board's
    (k.cpb->>'v')::numeric,
    CASE WHEN k.cpb->>'status' IN ('not_measured', 'too_few', 'not_filled_in') THEN k.cpb->>'status' ELSE 'ok' END,
    k.shows_paired::integer,
    CASE WHEN k.mode = 'DFY' AND k.due > 0 AND round(k.recorded::numeric / k.due * 100, 2) >= v_line
              AND (k.cpb->>'num') IS NOT NULL AND coalesce(k.shows_paired, 0) > 0
         THEN round((k.cpb->>'num')::numeric / k.shows_paired, 2) END,
    CASE WHEN k.mode IS DISTINCT FROM 'DFY' THEN 'not_dfy'
         WHEN k.due IS NULL THEN 'not_measured'
         WHEN k.due = 0 OR round(k.recorded::numeric / k.due * 100, 2) < v_line THEN 'hidden_low_coverage'
         WHEN (k.cpb->>'num') IS NULL OR k.shows_paired IS NULL THEN 'not_measured'
         WHEN k.shows_paired = 0 THEN 'too_few'
         ELSE 'ok' END,
    k.first_work,
    nullif(concat_ws(' ',
      CASE WHEN k.mode IS DISTINCT FROM 'DFY' THEN 'Done with you: cost per attended meeting does not apply.' END,
      CASE WHEN k.mode = 'DFY' AND k.due > 0 AND round(k.recorded::numeric / k.due * 100, 2) < v_line
        THEN format('Coverage is %s%%, under the %s%% line, so cost per attended meeting is hidden.',
               round(k.recorded::numeric / k.due * 100), v_line) END,
      CASE WHEN k.due = 0 THEN 'No meeting was due in this time frame.' END), '')
  FROM k
  ORDER BY k.name, k.loc;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The official first-call number

/** Median of the Active, done-for-you clients' 30-day medians, in working minutes. */
CREATE OR REPLACE FUNCTION public.cockpit_dictionary_first_call()
RETURNS TABLE(official_work_minutes numeric, clients integer, oldest_computed_at timestamptz, newest_computed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY n.first_call_median_work_seconds_30d / 60.0))::numeric, 1),
         count(*)::integer, min(n.computed_at), max(n.computed_at)
  FROM public.cockpit_client_now n
  JOIN public.cockpit_board_clients b ON b.location_id = n.location_id
  WHERE b.status = 'Active' AND b.service_mode IS DISTINCT FROM 'DWY' AND n.first_call_median_work_seconds_30d IS NOT NULL
$$;

-- Service key only (the cockpits read through the server). Supabase grants new functions to
-- anon and authenticated by default, so every grant is restated.
REVOKE ALL ON FUNCTION public.cockpit_dictionary_definitions(), public.cockpit_dictionary_cancelled(date, date),
  public.cockpit_dictionary_numbers(date, date, text), public.cockpit_dictionary_first_call()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_dictionary_definitions(), public.cockpit_dictionary_cancelled(date, date),
  public.cockpit_dictionary_numbers(date, date, text), public.cockpit_dictionary_first_call() TO service_role;

COMMIT;
