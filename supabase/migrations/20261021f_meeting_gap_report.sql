-- Meeting gap report: one "no result" rule, per client (2026-10-21, Creative Triage
-- bldgtotkfmhoxmlzowdx).
--
-- Program 1, item 1.1 of the 20 October software plan. On 20 October the board showed 56%
-- of the last 30 days' meetings (95 of 169) with no outcome, and the media buyer and client
-- success screens do not say the same thing: the board counts "no portal outcome and no
-- sheet mark" (triage.js hasNoOutcome), the client success report counts a blank Show cell
-- on the client's sheet. This file gives one rule and two splits. It reads only. It writes
-- nothing to a sheet, sends nothing to a client and stores nothing.
--
-- The one rule (cockpit_no_result_rule): the meeting has ended, it was not cancelled or
-- invalid, and no attendance is recorded. Attendance is recorded when the CRM status says
-- showed or no-show, or the client sheet marks it, or the portal records it. That is the
-- attendance the board already works out for every meeting (cockpit_board_appointments),
-- so this reuses the board's source and its due rule and adds nothing of its own.
-- On 21 October the rule gave the same count as the board's stored no-outcome count for
-- every one of the 19 Active clients (112 of 184 past meetings in 30 days); it differs only
-- when a meeting has a portal row with no attendance in it, or a CRM status of showed or
-- no-show and no sheet or portal row. The report returns both counts, and says when they differ.
--
-- The two splits, for each meeting with no result:
--   crm_confirmed   the CRM still says "confirmed" (nobody moved it to showed or no-show)
--   sheet state     blank: the client's sheet has a row for the meeting and its Show cell is
--                   empty. missing: no sheet row matches the meeting. unclear: the sheet
--                   has two rows for it that disagree.
-- A row matches a meeting on the contact and the exact meeting time, the way the board
-- matches sheet marks (cockpit_board_sheet_marks).
--
-- What it adds (read-only, service key only):
--   cockpit_no_result_rule(due, attendance)             the rule, in one place
--   cockpit_gap_sheet_rows(location, start, end)        the dialer's sheet rows matched to a contact, blank ones too
--   cockpit_gap_meetings(location, from, to)            the meetings with no result, with both splits
--   cockpit_gap_report(from, to, location)              the counts per client, the sheet row count and the board's own counts beside them
--
-- Not in scope: any write to a sheet, any client message, the portal's reminders, the
-- Thursday message (item 3 reads the sheet separately), changing the board's stored
-- no_outcome, any screen.
--
-- How we know it works: apps/media-buyer-cockpit/scripts/results-speed-data-supabase.test.ts
-- runs this file on PGlite. For each invented client the report's counts equal the board's
-- stored counts (cockpit_client_days) after the board's own refresh, the sheet row count
-- equals the rows in the sheet snapshot, and the cases where the rule and the board differ
-- are each shown on purpose.
--
-- Database work: one pass over the client's appointments (public.appointments, about 3,400
-- rows) and the dialer's sheet view (about 400 rows) per client, the same reads one board
-- client page makes. 19 Active clients. No table is scanned in a loop and nothing is
-- scheduled. Measured numbers are in the commit message and the session hand-over note.
--
-- Depends on 20261016133300_board_api.sql (and its corrections) and the dialer's
-- mahara_reporting views. Safe to apply twice. Rollback: DROP FUNCTION for the four names.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regprocedure('public.cockpit_board_appointments(text,date,date,jsonb)') IS NULL
     OR to_regprocedure('public.cockpit_board_marks_json(text,date,date)') IS NULL
     OR to_regprocedure('public.cockpit_board_check_window(date,date)') IS NULL THEN
    RAISE EXCEPTION 'The board functions are missing: apply 20261016133300_board_api.sql and its corrections first';
  END IF;
  IF to_regclass('mahara_reporting.cc_results') IS NULL OR to_regclass('mahara_reporting.sheet_snapshots') IS NULL
     OR to_regprocedure('mahara_reporting.cc_time(text)') IS NULL THEN
    RAISE EXCEPTION 'The dialer''s reporting views (mahara_reporting) are missing';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The rule

/** The one "no result" rule. p_due is the board's due (ended, not cancelled or invalid); p_attendance its showed, noshow or unknown. */
CREATE OR REPLACE FUNCTION public.cockpit_no_result_rule(p_due boolean, p_attendance text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(p_due, false) AND p_attendance = 'unknown'
$$;

-- ---------------------------------------------------------------------------
-- 2. The client sheet's rows for one client, blank Show cells included

/**
 * The sheet rows the dialer matched to one contact, in the time range, one row per contact
 * and meeting time. attendance is Y or N, or NULL when the Show cell is blank. Duplicates
 * that disagree come back with conflict true. Nested loops off, as the board's marks run.
 */
CREATE OR REPLACE FUNCTION public.cockpit_gap_sheet_rows(p_location text, p_start timestamptz, p_end timestamptz)
RETURNS TABLE(contact_id text, meeting timestamptz, attendance text, conflict boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET enable_nestloop = off AS $$
  -- conflict: the rows for the meeting disagree, or hold something other than Y, N or blank.
  SELECT r.contact_id, r.meeting, min(r.attendance) FILTER (WHERE r.attendance IN ('Y', 'N')),
         bool_or(r.conflict) OR count(DISTINCT nullif(btrim(r.attendance), '')) > 1
           OR bool_or(nullif(btrim(r.attendance), '') IS NOT NULL AND r.attendance NOT IN ('Y', 'N'))
  FROM mahara_reporting.cc_results r
  WHERE r.location_id = p_location AND r.contact_id IS NOT NULL AND r.meeting >= p_start AND r.meeting < p_end
  GROUP BY r.contact_id, r.meeting
$$;

-- ---------------------------------------------------------------------------
-- 3. The meetings with no result, one client

/**
 * Past meetings with no attendance, oldest first, for one client and a Kuwait-day window.
 * The lead's first name only, as the board's no-outcome list gives it. crm_confirmed is
 * true when the CRM status is still "confirmed". sheet_state is blank, missing or unclear.
 */
CREATE OR REPLACE FUNCTION public.cockpit_gap_meetings(p_location text, p_from date, p_to date)
RETURNS TABLE(appointment_id text, contact_id text, first_name text, meeting_at timestamptz, meeting_day date,
  calendar_kind text, crm_status text, crm_confirmed boolean, sheet_state text, days_since integer, contact_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH mk AS (
    SELECT public.cockpit_board_marks_json(p_location, p_from, p_to) AS marks
  ), ap AS (
    SELECT a.* FROM mk, public.cockpit_board_appointments(p_location, p_from, p_to, mk.marks) a
    WHERE public.cockpit_no_result_rule(a.due, a.attendance)
  ), sh AS MATERIALIZED (
    SELECT * FROM public.cockpit_gap_sheet_rows(p_location, p_from::timestamp AT TIME ZONE 'Asia/Kuwait',
      (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait')
  )
  SELECT ap.id, ap.contact_id,
    (regexp_match(btrim(coalesce(nullif(btrim(ap.contact_name), ''), cl.contact_name, '')), '^[^[:space:]]+'))[1],
    ap.start_at, (ap.start_at AT TIME ZONE 'Asia/Kuwait')::date, ap.kind, ap.status, ap.status = 'confirmed',
    CASE WHEN s.n IS NULL THEN 'missing' WHEN s.has_conflict THEN 'unclear' WHEN s.has_blank THEN 'blank' ELSE 'missing' END,
    (now() AT TIME ZONE 'Asia/Kuwait')::date - (ap.start_at AT TIME ZONE 'Asia/Kuwait')::date,
    CASE WHEN p_location ~ '^[A-Za-z0-9_-]{1,64}$' AND coalesce(ap.contact_id, '') ~ '^[A-Za-z0-9_-]{1,64}$'
         THEN 'https://app.gohighlevel.com/v2/location/' || p_location || '/contacts/detail/' || ap.contact_id END
  FROM ap
  LEFT JOIN LATERAL (SELECT l.contact_name FROM public.client_leads l
                     WHERE l.ghl_contact_id = ap.contact_id AND l.location_id = p_location LIMIT 1) cl ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, bool_or(x.attendance IS NULL AND NOT x.conflict) AS has_blank, bool_or(x.conflict) AS has_conflict
    FROM sh x WHERE x.contact_id = ap.contact_id AND x.meeting = ap.start_at
  ) s ON s.n > 0
  ORDER BY ap.start_at, ap.id
$$;

-- ---------------------------------------------------------------------------
-- 4. The report, per client

/**
 * One row per client (Active clients; one client by location, any not cancelled) for the
 * Kuwait-day window. The counts come from the board's own appointment list, so they equal
 * the board's. board_* are the board's stored counts for the same days: matches_board is
 * true when both agree, NULL when the stored facts have no figure for the window.
 * sheet_rows_* are the rows of the client's own report sheet as the dialer last read it
 * (sheet_checked_at): every row in the window is filled (Y or N) or blank. sheet_read_ok is
 * false when the dialer's sheet read failed: the no-result count may then be too high.
 */
CREATE OR REPLACE FUNCTION public.cockpit_gap_report(p_from date, p_to date, p_location text DEFAULT NULL)
RETURNS TABLE(
  location_id text, client_name text, service_mode text, window_from date, window_to date,
  meetings_past integer, with_attendance integer, no_result integer, coverage numeric,
  crm_confirmed integer, sheet_blank integer, sheet_missing integer, sheet_unclear integer,
  crm_confirmed_sheet_blank integer, oldest_days integer, sheet_read_ok boolean,
  sheet_rows_total integer, sheet_rows_in_window integer, sheet_rows_filled integer, sheet_rows_blank integer,
  sheet_checked_at timestamptz, sheet_error text,
  board_meetings_past integer, board_no_outcome integer, matches_board boolean, facts_computed_at timestamptz,
  note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_board_check_window(p_from, p_to);
  RETURN QUERY
  WITH cl AS (
    SELECT b.location_id AS loc, b.client_name AS name, b.service_mode AS mode
    FROM public.cockpit_board_clients b
    WHERE CASE WHEN p_location IS NULL THEN b.status = 'Active'
               ELSE coalesce(b.status, '') NOT IN ('Cancelled', 'Removed from sheet') AND b.location_id = p_location END
  ), g AS (
    SELECT cl.loc, x.*
    FROM cl
    CROSS JOIN LATERAL (
      WITH mk AS (
        SELECT public.cockpit_board_marks_json(cl.loc, p_from, p_to) AS marks
      ), sh AS MATERIALIZED (
        SELECT * FROM public.cockpit_gap_sheet_rows(cl.loc, p_from::timestamp AT TIME ZONE 'Asia/Kuwait',
          (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait')
      ), ap AS (
        SELECT a.*, public.cockpit_no_result_rule(a.due, a.attendance) AS gap, s.state
        FROM mk
        CROSS JOIN LATERAL public.cockpit_board_appointments(cl.loc, p_from, p_to, mk.marks) a
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
        max((now() AT TIME ZONE 'Asia/Kuwait')::date - (ap.start_at AT TIME ZONE 'Asia/Kuwait')::date) FILTER (WHERE ap.gap) AS oldest
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
        coalesce(mahara_reporting.cc_time(r->>'meeting') >= p_from::timestamp AT TIME ZONE 'Asia/Kuwait'
          AND mahara_reporting.cc_time(r->>'meeting') < (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait'
          AND mahara_reporting.cc_time(r->>'meeting') <= now(), false) AS in_win
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.data->'rows') = 'array' THEN s.data->'rows' ELSE '[]'::jsonb END) r
    ) w ON true
    WHERE s.namespace = 'production' AND s.data->>'sheetId' = s.sheet_id
    GROUP BY s.id, s.checked_at, s.error
  ), bd AS (
    SELECT f.location_id AS loc,
      sum(f.meetings_due) AS due, count(f.meetings_due) AS due_d,
      sum(f.no_outcome) AS no_out, count(f.no_outcome) AS no_out_d, max(f.computed_at) AS computed
    FROM public.cockpit_client_days f JOIN cl ON cl.loc = f.location_id
    WHERE f.day BETWEEN p_from AND p_to
    GROUP BY f.location_id
  )
  SELECT cl.loc, cl.name, cl.mode, p_from, p_to,
    coalesce(g.due, 0)::integer,
    (coalesce(g.due, 0) - coalesce(g.no_result, 0))::integer,
    coalesce(g.no_result, 0)::integer,
    CASE WHEN g.due > 0 THEN round((g.due - g.no_result)::numeric / g.due * 100, 2) END,
    coalesce(g.crm_conf, 0)::integer, coalesce(g.sh_blank, 0)::integer, coalesce(g.sh_missing, 0)::integer,
    coalesce(g.sh_unclear, 0)::integer, coalesce(g.both_, 0)::integer, g.oldest::integer,
    coalesce(g.marks_ok, false),
    sh.total::integer, sh.in_win::integer, sh.filled::integer, sh.blank::integer, sh.checked_at, sh.error,
    CASE WHEN bd.due_d > 0 THEN bd.due::integer END,
    CASE WHEN bd.no_out_d > 0 THEN bd.no_out::integer END,
    CASE WHEN bd.due_d > 0 AND bd.no_out_d > 0 THEN (bd.due = coalesce(g.due, 0) AND bd.no_out = coalesce(g.no_result, 0)) END,
    bd.computed,
    nullif(concat_ws(' ',
      CASE WHEN NOT coalesce(g.marks_ok, false) THEN 'The dialer''s sheet read failed, so a meeting the sheet marks may show here as having no result.' END,
      CASE WHEN sh.loc IS NULL THEN 'The dialer holds no sheet for this client, so every sheet state is missing.' END,
      CASE WHEN bd.due_d > 0 AND bd.no_out_d > 0 AND NOT (bd.due = coalesce(g.due, 0) AND bd.no_out = coalesce(g.no_result, 0))
        THEN format('The board''s stored counts (%s past, %s no outcome) are from %s Kuwait time and differ: the facts refresh every 30 minutes, or a portal row holds no attendance, or the CRM says showed or no-show with no sheet or portal row.',
          bd.due, bd.no_out, to_char(bd.computed AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI')) END), '')
  FROM cl
  LEFT JOIN g ON g.loc = cl.loc
  LEFT JOIN sh ON sh.loc = cl.loc
  LEFT JOIN bd ON bd.loc = cl.loc
  ORDER BY g.no_result DESC NULLS LAST, cl.name, cl.loc;
END $$;

REVOKE ALL ON FUNCTION public.cockpit_no_result_rule(boolean, text), public.cockpit_gap_sheet_rows(text, timestamptz, timestamptz),
  public.cockpit_gap_meetings(text, date, date), public.cockpit_gap_report(date, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_no_result_rule(boolean, text), public.cockpit_gap_sheet_rows(text, timestamptz, timestamptz),
  public.cockpit_gap_meetings(text, date, date), public.cockpit_gap_report(date, date, text) TO service_role;

COMMIT;
