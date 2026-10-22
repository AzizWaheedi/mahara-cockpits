-- The browser's doors to the results and speed data (20261021e to 20261021h), and the CSM call log.
--
-- Plan items 1.5, 1.6, 2.6 and 2.8 of the 20 October 2026 software leap plan, screens side. The four
-- earlier migrations hold the numbers behind the service key. These functions put each one behind a seat
-- check, so a signed-in cockpit seat can read it, and add the one write the call list needs: a CSM presses
-- "Called" and the app records who and when.
--
-- Reads (each is jsonb, gated in the function, never open to anon):
--   cockpit_gap_read(from, to)                    every client's meetings with no result (any active seat,
--                                                 each client through cockpit_client_allowed)
--   cockpit_gap_client_read(location, from, to)   one client's meetings with no result, one row each
--   cockpit_csm_calls_read()                      this week's call list with who called and when (CSM seat)
--   cockpit_speed_read(from, to, clock)           paid leads by arrival hour, country and call-speed band, as
--                                                 counts the screen adds up itself (seats that see every client)
--   cockpit_morning_uncalled_read(location)       the uncalled leads in their groups, with the board's counts
-- Write:
--   cockpit_csm_call_logged(location)             records that this seat called a client on this week's list
--
-- The write goes to a new table, cockpit_csm_call_log: one row per client and week (a second press on the
-- same client the same week returns the first row and writes nothing), row security on, no direct grant to
-- the browser, every insert, change and removal leaves an audit row in cockpit_audit_log.
--
-- Nothing here changes a number. The reads call the earlier functions and filter the clients the seat may
-- see. The CSM list is ranked again inside the seat's own clients, so a CSM limited to some clients gets
-- five of their own, and a seat that sees every client gets the list cockpit_csm_call_list gives.
--
-- Applied to the Creative Triage database on 21 October 2026, after 20261021e to h. Rollback: DROP FUNCTION each name below, DROP TABLE cockpit_csm_call_log.
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regprocedure('public.cockpit_gap_report(date,date,text)') IS NULL
     OR to_regprocedure('public.cockpit_gap_meetings(text,date,date)') IS NULL
     OR to_regprocedure('public.cockpit_csm_call_list(timestamptz,integer,jsonb,integer,integer)') IS NULL
     OR to_regprocedure('public.cockpit_speed_leads(timestamptz,timestamptz,integer)') IS NULL
     OR to_regprocedure('public.cockpit_speed_band(numeric,boolean)') IS NULL
     OR to_regprocedure('public.cockpit_uncalled_cohort(text,timestamptz)') IS NULL
     OR to_regprocedure('public.cockpit_board_check_window(date,date)') IS NULL
     OR to_regprocedure('public.cockpit_is_team_only()') IS NULL
     OR to_regclass('public.cockpit_audit_log') IS NULL
     OR to_regclass('public.cockpit_members') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261021e to 20261021h and the Client Performance board first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Who sees every client

/** The CEO, an admin, or a seat whose client list is empty and is not team only: the board's own rule for whole-board figures. */
CREATE OR REPLACE FUNCTION public.cockpit_whole_board_seat()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false)
    OR EXISTS (SELECT 1 FROM public.cockpit_members cm JOIN auth.users au ON au.id = cm.auth_user_id
               WHERE cm.auth_user_id = auth.uid() AND cm.active AND au.email_confirmed_at IS NOT NULL
                 AND cm.email = lower(btrim(au.email)) AND cardinality(coalesce(cm.clients, '{}'::text[])) = 0
                 AND NOT coalesce(public.cockpit_is_team_only(), false))
$$;

/** The locations of the board's clients this seat may see (cockpit_client_allowed per client, not per row). */
CREATE OR REPLACE FUNCTION public.cockpit_allowed_locations()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(array_agg(b.location_id), '{}'::text[])
  FROM public.cockpit_board_clients b WHERE public.cockpit_client_allowed(b.client_name)
$$;

-- ---------------------------------------------------------------------------
-- 2. The gap report

/**
 * Every client with a past meeting in the Kuwait-day window, the meetings with no result, and the two splits
 * side by side: the sheet row is blank, or the CRM still says confirmed. The two overlap, so they are not added.
 * Clients with no past meeting in the window are counted in quiet, not listed. share is no_result over meetings.
 */
CREATE OR REPLACE FUNCTION public.cockpit_gap_read(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rows jsonb;
  v_quiet integer;
  v_tot record;
  v_notes text[] := '{}';
BEGIN
  IF NOT coalesce(public.cockpit_has_active_seat(), false) THEN
    RAISE EXCEPTION 'Sign in with an active cockpit seat to see the meetings with no result.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.cockpit_board_check_window(p_from, p_to);
  WITH r AS MATERIALIZED (
    SELECT g.* FROM public.cockpit_gap_report(p_from, p_to, NULL) g
    WHERE g.location_id = ANY (public.cockpit_allowed_locations())
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'locationId', r.location_id, 'clientName', r.client_name, 'serviceMode', r.service_mode,
      'meetings', r.meetings_past, 'withResult', r.with_attendance, 'noResult', r.no_result,
      'share', CASE WHEN r.meetings_past > 0 THEN round(r.no_result::numeric / r.meetings_past, 4) END,
      'crmConfirmed', r.crm_confirmed, 'sheetBlank', r.sheet_blank, 'sheetMissing', r.sheet_missing,
      'sheetUnclear', r.sheet_unclear, 'confirmedAndBlank', r.crm_confirmed_sheet_blank,
      'oldestDays', r.oldest_days, 'sheetReadOk', r.sheet_read_ok, 'sheetCheckedAt', r.sheet_checked_at,
      'sheetError', r.sheet_error, 'matchesBoard', r.matches_board, 'note', r.note)
      ORDER BY r.no_result DESC, r.meetings_past DESC, r.client_name, r.location_id) FILTER (WHERE r.meetings_past > 0), '[]'::jsonb),
    count(*) FILTER (WHERE r.meetings_past = 0)::integer
  INTO v_rows, v_quiet FROM r;
  SELECT coalesce(sum((x->>'meetings')::integer), 0) AS meetings, coalesce(sum((x->>'noResult')::integer), 0) AS no_result,
         coalesce(sum((x->>'sheetBlank')::integer), 0) AS sheet_blank, coalesce(sum((x->>'crmConfirmed')::integer), 0) AS crm_confirmed
  INTO v_tot FROM jsonb_array_elements(v_rows) x;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) x WHERE (x->>'sheetReadOk')::boolean IS FALSE) THEN
    v_notes := v_notes || 'The dialer could not read some clients'' sheets on its last pass, so their no-result count may be too high.'::text;
  END IF;
  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to, 'computedAt', now(), 'rows', v_rows, 'quietClients', v_quiet,
    'totals', jsonb_build_object('meetings', v_tot.meetings, 'noResult', v_tot.no_result, 'sheetBlank', v_tot.sheet_blank,
      'crmConfirmed', v_tot.crm_confirmed,
      'share', CASE WHEN v_tot.meetings > 0 THEN round(v_tot.no_result::numeric / v_tot.meetings, 4) END),
    'notes', to_jsonb(v_notes));
END $$;

/** One client's meetings with no result in the window, oldest first: the lead's first name, the CRM status and the sheet state. */
CREATE OR REPLACE FUNCTION public.cockpit_gap_client_read(p_location text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_name text;
  v_list jsonb;
BEGIN
  IF NOT coalesce(public.cockpit_has_active_seat(), false) THEN
    RAISE EXCEPTION 'Sign in with an active cockpit seat to see the meetings with no result.' USING ERRCODE = '42501';
  END IF;
  IF p_location IS NULL OR p_location !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'Choose one of the board''s clients.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cockpit_board_check_window(p_from, p_to);
  SELECT b.client_name INTO v_name FROM public.cockpit_board_clients b WHERE b.location_id = p_location;
  IF v_name IS NULL OR NOT coalesce(public.cockpit_client_allowed(v_name), false) THEN
    RAISE EXCEPTION 'That client is not on your board.' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.appointment_id, 'contactId', m.contact_id, 'firstName', m.first_name, 'meetingAt', m.meeting_at,
    'day', m.meeting_day, 'calendar', m.calendar_kind, 'crmStatus', m.crm_status, 'crmConfirmed', m.crm_confirmed,
    'sheetState', m.sheet_state, 'daysSince', m.days_since, 'contactUrl', m.contact_url) ORDER BY m.meeting_at, m.appointment_id), '[]'::jsonb)
  INTO v_list FROM public.cockpit_gap_meetings(p_location, p_from, p_to) m;
  RETURN jsonb_build_object('locationId', p_location, 'clientName', v_name, 'from', p_from, 'to', p_to,
    'computedAt', now(), 'meetings', v_list);
END $$;

-- ---------------------------------------------------------------------------
-- 3. The CSM call list and its log

CREATE TABLE IF NOT EXISTS public.cockpit_csm_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id text NOT NULL CHECK (location_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  client_name text NOT NULL CHECK (length(btrim(client_name)) BETWEEN 1 AND 200),
  week_key text NOT NULL CHECK (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  missing_meetings integer NOT NULL CHECK (missing_meetings >= 1),
  called_by text NOT NULL CHECK (length(called_by) BETWEEN 1 AND 254),
  called_by_id uuid NOT NULL,
  called_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, week_key)
);
CREATE INDEX IF NOT EXISTS cockpit_csm_call_log_week_idx ON public.cockpit_csm_call_log (week_key, called_at DESC);
COMMENT ON TABLE public.cockpit_csm_call_log IS
  'The CSM call list''s "Called" presses: one row per client and ISO week (Kuwait), who pressed it and when, and how many meetings were still missing at that moment. Written only by cockpit_csm_call_logged; every change leaves an audit row.';
ALTER TABLE public.cockpit_csm_call_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_csm_call_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_csm_call_log TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_csm_call_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN RETURN NULL; END IF;
  INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, "before", "after")
  VALUES ('csm_call.' || lower(TG_OP), TG_TABLE_NAME, v_row->>'id',
    coalesce(nullif(current_setting('cockpit.csm_actor', true), ''), v_row->>'called_by', nullif(auth.jwt()->>'email', ''), session_user::text),
    'client-success', 'supabase',
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cockpit_csm_call_log_audit ON public.cockpit_csm_call_log;
CREATE TRIGGER cockpit_csm_call_log_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_csm_call_log
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_call_audit();

/**
 * The list as the screen shows it, at the given time: the call list for every client the seat may see
 * (all of them when p_all is true, for the service key), ranked again inside that set with the cap of 5,
 * and each row with who called and when this week. The week is the ISO week in Kuwait.
 */
CREATE OR REPLACE FUNCTION public.cockpit_csm_calls_json(p_now timestamptz, p_all boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cap constant integer := 5;
  v_week text := to_char(p_now AT TIME ZONE 'Asia/Kuwait', 'IYYY-"W"IW');
  v_rows jsonb;
  v_basis text;
  v_notes text[] := '{}';
BEGIN
  WITH l AS (
    SELECT c.*, row_number() OVER (ORDER BY c.missing_meetings DESC, c.oldest_meeting, c.client_name, c.location_id) AS rk
    FROM public.cockpit_csm_call_list(p_now, 1000) c
    WHERE p_all OR c.location_id = ANY (public.cockpit_allowed_locations())
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'locationId', l.location_id, 'clientName', l.client_name, 'rank', l.rk,
      'status', CASE WHEN l.rk <= v_cap THEN 'call' ELSE 'queued' END,
      'missing', l.missing_meetings, 'missingShow', l.missing_show, 'missingClosed', l.missing_closed,
      'oldestMeeting', l.oldest_meeting, 'inFirstChase', l.in_first_chase, 'meetings', coalesce(l.meetings, '[]'::jsonb),
      'sheetCheckedAt', l.sheet_checked_at, 'sheetError', l.sheet_error,
      'calledAt', g.called_at, 'calledBy', g.called_by,
      'calledByName', (SELECT nullif(btrim(p.name), '') FROM public.cockpit_people p
                       WHERE lower(btrim(p.email)) = lower(btrim(g.called_by)) ORDER BY p.active DESC, p.id DESC LIMIT 1)
    ) ORDER BY l.rk), '[]'::jsonb),
    max(l.runs_basis)
  INTO v_rows, v_basis
  FROM l LEFT JOIN public.cockpit_csm_call_log g ON g.location_id = l.location_id AND g.week_key = v_week;
  IF v_basis = 'scheduled_runs' THEN
    v_notes := v_notes || 'Counted by Thursday messages that were due, not by messages sent: the sent list lives in Make.'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) x WHERE nullif(x->>'sheetError', '') IS NOT NULL) THEN
    v_notes := v_notes || 'The dialer''s last read of some clients'' sheets reported an error, so those rows may be out of date.'::text;
  END IF;
  RETURN jsonb_build_object('week', v_week, 'cap', v_cap, 'computedAt', p_now, 'runsBasis', coalesce(v_basis, 'scheduled_runs'),
    'rows', v_rows, 'notes', to_jsonb(v_notes));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_calls_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (coalesce(public.cockpit_has_role('csm'), false) OR coalesce(public.cockpit_is_ceo(), false)) THEN
    RAISE EXCEPTION 'The call list is for the client success seat.' USING ERRCODE = '42501';
  END IF;
  RETURN public.cockpit_csm_calls_json(now());
END $$;

/** Records that this seat called a client on this week's list. A second press the same week returns the first row. */
CREATE OR REPLACE FUNCTION public.cockpit_csm_call_logged(p_location text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email text;
  v_uid uuid;
  v_list jsonb;
  v_row jsonb;
  v_log public.cockpit_csm_call_log;
  v_again boolean := false;
BEGIN
  IF NOT (coalesce(public.cockpit_has_role('csm'), false) OR coalesce(public.cockpit_is_ceo(), false)) THEN
    RAISE EXCEPTION 'Only the client success seat logs a call.' USING ERRCODE = '42501';
  END IF;
  SELECT cm.email, cm.auth_user_id INTO v_email, v_uid FROM public.cockpit_members cm JOIN auth.users au ON au.id = cm.auth_user_id
  WHERE cm.auth_user_id = auth.uid() AND cm.active AND au.email_confirmed_at IS NOT NULL
    AND cm.email = lower(btrim(au.email))
  ORDER BY cm.email LIMIT 1;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Only the client success seat logs a call.' USING ERRCODE = '42501';
  END IF;
  IF p_location IS NULL OR p_location !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'Choose one of the clients on the list.' USING ERRCODE = '22023';
  END IF;
  v_list := public.cockpit_csm_calls_json(now());
  SELECT x INTO v_row FROM jsonb_array_elements(v_list->'rows') x
  WHERE x->>'locationId' = p_location AND x->>'status' = 'call';
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'That client is not on this week''s call list.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.set_config('cockpit.csm_actor', v_email, true);
  INSERT INTO public.cockpit_csm_call_log AS g (location_id, client_name, week_key, missing_meetings, called_by, called_by_id)
  VALUES (p_location, v_row->>'clientName', v_list->>'week', (v_row->>'missing')::integer, v_email, v_uid)
  ON CONFLICT (location_id, week_key) DO NOTHING
  RETURNING * INTO v_log;
  IF v_log.id IS NULL THEN
    v_again := true;
    SELECT * INTO v_log FROM public.cockpit_csm_call_log g WHERE g.location_id = p_location AND g.week_key = v_list->>'week';
  END IF;
  RETURN jsonb_build_object('ok', true, 'alreadyLogged', v_again, 'locationId', v_log.location_id, 'clientName', v_log.client_name,
    'week', v_log.week_key, 'calledAt', v_log.called_at, 'calledBy', v_log.called_by);
END $$;

-- ---------------------------------------------------------------------------
-- 4. Bookings by call speed

/**
 * Paid leads grouped by arrival hour (Kuwait), country and call-speed band, as counts: [hour, country,
 * band, paid leads, bookings, bookings of any kind]. The screen adds the cells up for any filter, so a
 * change of hour or country asks nothing more of the database. One read of cockpit_speed_leads, 120 days
 * at most. The same rule as cockpit_booking_by_speed: leads from the first day to the last day, less the
 * settle days; bookings are the counted ones. Correlation only.
 */
CREATE OR REPLACE FUNCTION public.cockpit_speed_read(p_from date, p_to date, p_clock text DEFAULT 'clock')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_settle constant integer := 3;
  v_from timestamptz;
  v_to timestamptz;
  v_cells jsonb;
BEGIN
  IF NOT coalesce(public.cockpit_whole_board_seat(), false) THEN
    RAISE EXCEPTION 'Speed numbers cover every client, so only seats that see every client open them.' USING ERRCODE = '42501';
  END IF;
  IF p_clock IS NULL OR p_clock NOT IN ('clock', 'working') THEN
    RAISE EXCEPTION 'Choose clock minutes or working minutes.' USING ERRCODE = '22023';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 119 THEN
    RAISE EXCEPTION 'Choose a first day before the last, at most 120 days apart.' USING ERRCODE = '22023';
  END IF;
  v_from := p_from::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_to := (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait';
  WITH l AS (
    SELECT s.arrival_hour AS hr, s.country AS ctry, s.booked, s.booked_any,
      public.cockpit_speed_band(CASE p_clock WHEN 'working' THEN s.working_minutes ELSE s.clock_minutes END,
                                s.first_call_at IS NOT NULL) AS bnd
    FROM public.cockpit_speed_leads(v_from, v_to, v_settle) s
  )
  SELECT coalesce(jsonb_agg(jsonb_build_array(g.hr, g.ctry, g.bnd, g.n, g.bk, g.bk_any) ORDER BY g.hr, g.ctry, g.bnd), '[]'::jsonb)
  INTO v_cells
  FROM (SELECT l.hr, l.ctry, l.bnd, count(*)::integer AS n, count(*) FILTER (WHERE l.booked)::integer AS bk,
               count(*) FILTER (WHERE l.booked_any)::integer AS bk_any
        FROM l GROUP BY l.hr, l.ctry, l.bnd) g;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'clock', p_clock, 'settleDays', v_settle,
    'windowTo', (least(v_to, now() - make_interval(days => v_settle)) AT TIME ZONE 'Asia/Kuwait')::date,
    'computedAt', now(), 'cells', v_cells,
    'note', 'Correlation only: lead mix by client and hour can differ between bands, so a faster call is not shown to cause a booking.');
END $$;

-- ---------------------------------------------------------------------------
-- 5. The morning uncalled list

/**
 * The leads with no call linked to them, in their groups, and per client the groups beside the board's
 * own stored counts. One read of the cohort feeds both. never_called is the board's untouched count and
 * outcome_only its outcome-only count; exact + phone_only is the board's verified count, so phone_only
 * is the group the board counts as called and a strict reading does not.
 */
CREATE OR REPLACE FUNCTION public.cockpit_morning_uncalled_read(p_location text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now timestamptz := now();
  v_allowed text[];
  v_clients jsonb;
  v_leads jsonb;
  v_tot record;
BEGIN
  IF NOT coalesce(public.cockpit_has_active_seat(), false) THEN
    RAISE EXCEPTION 'Sign in with an active cockpit seat to see the uncalled leads.' USING ERRCODE = '42501';
  END IF;
  IF p_location IS NOT NULL AND p_location !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'Choose one of the board''s clients.' USING ERRCODE = '22023';
  END IF;
  v_allowed := public.cockpit_allowed_locations();
  IF p_location IS NOT NULL AND NOT (p_location = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'That client is not on your board.' USING ERRCODE = '42501';
  END IF;
  WITH c AS MATERIALIZED (
    SELECT * FROM public.cockpit_uncalled_cohort(p_location, v_now) x WHERE x.location_id = ANY (v_allowed)
  ), s AS (
    SELECT c.location_id, count(*) AS callable,
      count(*) FILTER (WHERE c.grp = 'exact') AS exact, count(*) FILTER (WHERE c.grp = 'phone_only') AS phone_only,
      count(*) FILTER (WHERE c.grp = 'outcome_only') AS outcome_only, count(*) FILTER (WHERE c.grp = 'never_called') AS never_called,
      count(*) FILTER (WHERE c.grp <> 'exact' AND c.paid) AS uncalled_paid
    FROM c GROUP BY c.location_id
  ), per AS (
    SELECT b.location_id, b.client_name, coalesce(s.callable, 0)::integer AS callable, coalesce(s.exact, 0)::integer AS exact,
      coalesce(s.phone_only, 0)::integer AS phone_only, coalesce(s.outcome_only, 0)::integer AS outcome_only,
      coalesce(s.never_called, 0)::integer AS never_called, coalesce(s.uncalled_paid, 0)::integer AS uncalled_paid,
      n.callable_30d, n.verified_called_30d, n.outcome_only_30d, n.untouched_leads, n.computed_at,
      CASE WHEN n.location_id IS NULL THEN NULL
           ELSE coalesce(s.never_called, 0) = coalesce(n.untouched_leads, 0)
            AND coalesce(s.outcome_only, 0) = coalesce(n.outcome_only_30d, 0)
            AND coalesce(s.exact, 0) + coalesce(s.phone_only, 0) = coalesce(n.verified_called_30d, 0) END AS matches
    FROM public.cockpit_board_clients b
    LEFT JOIN s ON s.location_id = b.location_id
    LEFT JOIN public.cockpit_client_now n ON n.location_id = b.location_id
    WHERE b.service_mode IS DISTINCT FROM 'DWY' AND b.location_id = ANY (v_allowed)
      AND CASE WHEN p_location IS NULL THEN b.status = 'Active'
               ELSE coalesce(b.status, '') NOT IN ('Cancelled', 'Removed from sheet', 'Stopped') AND b.location_id = p_location END
  )
  SELECT
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'locationId', p.location_id, 'clientName', p.client_name, 'callable', p.callable, 'exact', p.exact,
        'phoneOnly', p.phone_only, 'outcomeOnly', p.outcome_only, 'neverCalled', p.never_called,
        'noCallLinked', p.phone_only + p.outcome_only + p.never_called, 'uncalledPaid', p.uncalled_paid,
        'boardCallable', p.callable_30d, 'boardVerified', p.verified_called_30d, 'boardOutcomeOnly', p.outcome_only_30d,
        'boardUntouched', p.untouched_leads, 'boardComputedAt', p.computed_at, 'matchesBoard', p.matches)
        ORDER BY (p.phone_only + p.outcome_only + p.never_called) DESC, p.client_name, p.location_id), '[]'::jsonb) FROM per p),
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'locationId', c.location_id, 'clientName', c.client_name, 'contactId', c.contact_id, 'firstName', c.first_name,
        'createdAt', c.created_at, 'hoursWaiting', c.hours_waiting, 'paid', c.paid, 'group', c.grp,
        'callEvidence', c.call_evidence, 'lastCallAt', c.last_call_at, 'lastAttemptAt', c.last_attempt_at,
        'lastOutcome', c.last_outcome, 'phoneLast4', c.phone_last4, 'contactUrl', c.contact_url)
        ORDER BY c.created_at, c.contact_id), '[]'::jsonb) FROM c WHERE c.grp <> 'exact')
  INTO v_clients, v_leads;
  SELECT coalesce(sum((x->>'callable')::integer), 0) AS callable, coalesce(sum((x->>'exact')::integer), 0) AS exact,
         coalesce(sum((x->>'phoneOnly')::integer), 0) AS phone_only, coalesce(sum((x->>'outcomeOnly')::integer), 0) AS outcome_only,
         coalesce(sum((x->>'neverCalled')::integer), 0) AS never_called, coalesce(sum((x->>'uncalledPaid')::integer), 0) AS uncalled_paid,
         bool_and((x->>'matchesBoard')::boolean) AS matches, count(*) FILTER (WHERE x->>'matchesBoard' IS NULL)::integer AS no_board
  INTO v_tot FROM jsonb_array_elements(v_clients) x;
  RETURN jsonb_build_object('asOf', v_now, 'clients', v_clients, 'leads', v_leads,
    'totals', jsonb_build_object('callable', v_tot.callable, 'exact', v_tot.exact, 'phoneOnly', v_tot.phone_only,
      'outcomeOnly', v_tot.outcome_only, 'neverCalled', v_tot.never_called,
      'noCallLinked', v_tot.phone_only + v_tot.outcome_only + v_tot.never_called, 'uncalledPaid', v_tot.uncalled_paid,
      'matchesBoard', v_tot.matches, 'clientsWithoutBoardRow', v_tot.no_board));
END $$;

-- ---------------------------------------------------------------------------
-- 6. Grants: the browser gets the six doors, everything else stays internal

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'cockpit_whole_board_seat()', 'cockpit_allowed_locations()',
    'cockpit_gap_read(date,date)', 'cockpit_gap_client_read(text,date,date)',
    'cockpit_csm_call_audit()', 'cockpit_csm_calls_json(timestamptz,boolean)', 'cockpit_csm_calls_read()',
    'cockpit_csm_call_logged(text)', 'cockpit_speed_read(date,date,text)', 'cockpit_morning_uncalled_read(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'cockpit_gap_read(date,date)', 'cockpit_gap_client_read(text,date,date)', 'cockpit_csm_calls_read()',
    'cockpit_csm_call_logged(text)', 'cockpit_speed_read(date,date,text)', 'cockpit_morning_uncalled_read(text)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- The service key reads the same numbers the screens do, and the list at any time.
  FOREACH f IN ARRAY ARRAY['cockpit_csm_calls_json(timestamptz,boolean)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
