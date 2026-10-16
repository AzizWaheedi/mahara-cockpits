-- Client Performance board: the reads, the targets and the levers (2026-10-16,
-- Creative Triage bldgtotkfmhoxmlzowdx).
--
-- The CEO, 2026-10-16: one shared "Client Performance" board for every team
-- member, one row per client over a time frame, the business and the ad
-- columns, every campaign, ad set and ad of a client a click away, every KPI
-- target easy to edit starting from the normal KPIs, numbers shown only when
-- the data exists and the client filled it in, and from the board a task per
-- client with the lever to pull. Added the same day: every client row names
-- its assigned call centre agent(s), and carries the appointments that were
-- due in the time frame and still have no outcome, with the list itself on
-- the client page.
--
-- What it adds:
--   cockpit_board_targets          target overrides only. scope 'defaults' or
--                                  'client:<ClickUp id>'; an absent row is the
--                                  official default from
--                                  cockpit_board_default_targets(), whose values
--                                  the test pins to both kpi.ts copies and
--                                  callCentre.ts CALL_RULES
--   cockpit_board_levers           one row per lever filed from the board: the
--                                  client, the metric, the lever, the department
--                                  that owns it, its ClickUp task, its state
--   cockpit_board_provider_health  every ClickUp call the lever path makes
--   cockpit_board_read(from, to)   every client row (any active seat, each client
--                                  through cockpit_client_allowed)
--   cockpit_board_client(location, from, to)
--                                  one client: its row, campaign > ad set > ad
--                                  with CRM leads, bookings and shows per ad id,
--                                  the appointments with no outcome, its levers
--   cockpit_board_targets_save(scope, metric, good, watch[, note])
--                                  the CEO and admins; both lines empty goes back
--                                  to the official target
--   cockpit_board_lever_context(args)  the lever gate, for the Edge Function
--                                  cockpit-board-api (as the signed-in seat)
--   cockpit_board_lever_begin / _finish  the lever row, service role only
--   cockpit_client_caller_rows()   the dialer's assigned callers per client: the
--                                  rule of cockpit_client_callers()
--                                  (20261013180200), now held once here and used
--                                  by both that gated read (redefined below,
--                                  same output, same gate) and the board
--   audit triggers                 every insert, change and removal of a target
--                                  or a lever writes a cockpit_audit_log row
--
-- Read rules:
--   - Rates are worked out at read time from the summed facts: the sum of the
--     numerators over the sum of the denominators, never an average of daily
--     rates. Each value comes with a status against the effective target (the
--     client's override, else the board's override, else the official
--     default): good, watch, off, not_measured (no source), not_filled_in (the
--     client does not record it), too_few (under the minimum sample), or null
--     (a plain count with nothing to judge). A rule with no watch line (AOV)
--     calls anything short of good a watch; the show rate is never off. Leads
--     touched and first call have the watch line on the good line, so any miss
--     is off, as callCentre.ts callCentreVerdict judges them.
--   - Ad numbers (cockpit_meta_ad_days) end yesterday on each ad account's own
--     clock; the read says so. Cost per booking and ROAS divide by the same
--     days (bookings and revenue to yesterday). Cost per lead is lead-campaign
--     spend over form leads, so chat lead ad sets stay out (leads is NULL there).
--   - Frequency is Meta's own over the time frame (cockpit_meta_reach) when the
--     time frame is one of the five standard windows; otherwise it is the
--     impressions-weighted daily frequency, labelled "average daily".
--   - Hook rate = 3-second plays / impressions of video ads; hold rate =
--     ThruPlays / 3-second plays; retention = p25..p100 / plays; opt-in = form
--     leads / link clicks on lead campaigns.
--   - Show rate = shows / (shows + no-shows), judged from 5 marked meetings;
--     quotation and close rates are of shows, judged from 5 shows; the
--     quotation rate only when the client recorded a quotation in the window;
--     quotation answers (given or not) only where the source can tell them;
--     AOV = revenue / closes with a value; ROAS = revenue / spend; revenue with
--     a close of no known value is "at least".
--   - Missing is never zero: a source that could not be read, a client who
--     does not fill a column, a client with no ad account, all give NULL with
--     a plain sentence. A Done-With-You client's call columns say the client
--     calls.
--   - No outcome on a row is the facts' count (cockpit_client_days.no_outcome,
--     refreshed every 30 minutes for the last 3 days and nightly for 120); the
--     client page lists the same meetings live, by the same rule (no portal
--     outcome at any revision, no sheet mark), and says when the two differ.
--
-- Not in scope: any screen; the meeting embed (team_meetings.embed's CHECK);
-- suggested lever wording; reviving the frozen portal ad tables; the facts and
-- the Meta store themselves (20261016111157, 20261016121700).
--
-- How we know it works: apps/media-buyer-cockpit/scripts/board-api-supabase.test.ts
-- runs this file on PGlite over the facts and Meta migrations with the
-- dialer's real views: every formula and status, the gate (no seat, inactive,
-- unconfirmed refused; every active seat allowed; a client-limited seat sees
-- its clients only), the targets (CEO and admins only, audit rows, overrides
-- reach the statuses), the default targets against both kpi.ts copies, the
-- callers against the original cockpit_client_callers(), and the no-outcome
-- list against the facts' count. The Edge Function's lever path is tested in
-- supabase/functions/cockpit-board-api/*.test.ts with a mocked ClickUp.
--
-- Safe to apply twice: tables IF NOT EXISTS, functions CREATE OR REPLACE,
-- triggers dropped before they are created. Apply after 20261016111157 and
-- 20261016121700; deploy cockpit-board-api (verify_jwt on) with
-- --extra supabase/functions/cockpit-csm-api/core.ts supabase/functions/cockpit-csm-api/tools.ts.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regclass('public.cockpit_board_clients') IS NULL OR to_regclass('public.cockpit_client_days') IS NULL
     OR to_regclass('public.cockpit_client_now') IS NULL OR to_regprocedure('public.cockpit_board_calendar_kind(text)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261016111157_board_facts.sql first';
  END IF;
  IF to_regclass('public.cockpit_meta_ad_days') IS NULL OR to_regclass('public.cockpit_meta_reach') IS NULL
     OR to_regprocedure('public.cockpit_meta_ad_days_status()') IS NULL OR to_regprocedure('public.cockpit_meta_reach_windows(date)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261016121700_meta_ad_days.sql first';
  END IF;
  IF to_regprocedure('public.cockpit_has_active_seat()') IS NULL OR to_regprocedure('public.cockpit_client_allowed(text)') IS NULL
     OR to_regprocedure('public.cockpit_is_ceo()') IS NULL OR to_regprocedure('public.cockpit_has_role(text)') IS NULL THEN
    RAISE EXCEPTION 'The cockpit seat gates are missing';
  END IF;
  IF to_regprocedure('public.cockpit_call_centre_seat()') IS NULL OR to_regprocedure('public.cockpit_client_callers()') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261013180000_cockpit_client_calls.sql and 20261013180200_cockpit_client_callers.sql first';
  END IF;
  IF to_regclass('public.cockpit_audit_log') IS NULL OR to_regclass('mahara_console.metadata') IS NULL
     OR to_regclass('mahara_reporting.cc_results') IS NULL OR to_regclass('mahara_reporting.cc_attempts') IS NULL
     OR to_regclass('portal_data.appointment_outcomes') IS NULL THEN
    RAISE EXCEPTION 'The audit log, the dialer''s views or the portal outcomes are missing';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Tables

CREATE TABLE IF NOT EXISTS public.cockpit_board_targets (
  scope_key text NOT NULL CHECK (scope_key = 'defaults' OR scope_key ~ '^client:[A-Za-z0-9_-]{1,40}$'),
  metric text NOT NULL CHECK (metric ~ '^[a-z][a-z0-9_]{1,39}$'),
  good numeric NOT NULL CHECK (good >= 0 AND good < 1000000000),
  watch numeric CHECK (watch IS NULL OR (watch >= 0 AND watch < 1000000000)),
  direction text NOT NULL CHECK (direction IN ('higher', 'lower')),
  note text CHECK (note IS NULL OR length(note) <= 300),
  updated_by text NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, metric),
  CHECK (watch IS NULL OR (direction = 'higher' AND watch <= good) OR (direction = 'lower' AND watch >= good))
);
COMMENT ON TABLE public.cockpit_board_targets IS
  'Client Performance board target overrides only. An absent row means the official default (cockpit_board_default_targets(), pinned to kpi.ts). scope_key defaults or client:<ClickUp task id>. Written only by cockpit_board_targets_save (the CEO and admins); every change leaves an audit row.';

CREATE TABLE IF NOT EXISTS public.cockpit_board_levers (
  id uuid PRIMARY KEY,
  location_id text NOT NULL CHECK (location_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  clickup_id text NOT NULL CHECK (clickup_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name text NOT NULL CHECK (length(btrim(client_name)) BETWEEN 1 AND 200),
  metric text NOT NULL CHECK (metric ~ '^[a-z][a-z0-9_]{1,39}$'),
  lever text NOT NULL CHECK (length(btrim(lever)) BETWEEN 3 AND 200),
  owner_department text NOT NULL CHECK (owner_department IN ('creative', 'tech', 'client_success', 'call_center', 'media_buyer')),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  evidence text CHECK (evidence IS NULL OR length(evidence) <= 500),
  clickup_task_id text CHECK (clickup_task_id IS NULL OR clickup_task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  clickup_url text CHECK (clickup_url IS NULL OR clickup_url ~ '^https://app\.clickup\.com/'),
  comment_id text CHECK (comment_id IS NULL OR length(comment_id) <= 80),
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'open', 'reconcile')),
  error text CHECK (error IS NULL OR length(error) <= 1500),
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  created_by text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 254),
  created_by_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  meeting_id text CHECK (meeting_id IS NULL OR meeting_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  CHECK ((status = 'open') = (clickup_task_id IS NOT NULL AND clickup_url IS NOT NULL)),
  CHECK ((status = 'sending') = (finished_at IS NULL))
);
CREATE INDEX IF NOT EXISTS cockpit_board_levers_location_idx ON public.cockpit_board_levers (location_id, created_at DESC);
COMMENT ON TABLE public.cockpit_board_levers IS
  'Levers filed from the Client Performance board: one ClickUp task in the owning department''s list plus a comment on the client card (cockpit-csm-api core.ts, reused by cockpit-board-api). id is the request id; sending until ClickUp confirms by read-back, then open; reconcile when ClickUp''s state is unknown. Written only through cockpit_board_lever_begin/_finish (service role); every change leaves an audit row.';

CREATE TABLE IF NOT EXISTS public.cockpit_board_provider_health (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lever_id uuid REFERENCES public.cockpit_board_levers(id),
  method text NOT NULL,
  resource text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('intent', 'response', 'unknown')),
  http_status integer,
  object_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cockpit_board_provider_health_lever_idx ON public.cockpit_board_provider_health (lever_id);
COMMENT ON TABLE public.cockpit_board_provider_health IS
  'The board''s health ledger: every ClickUp call cockpit-board-api makes (intent, then response or unknown), through cockpit-csm-api tools.ts providerTools.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_board_targets', 'cockpit_board_levers', 'cockpit_board_provider_health'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
  END LOOP;
END $$;
-- The one direct write: the Edge Function's ClickUp receipts.
GRANT INSERT ON public.cockpit_board_provider_health TO service_role;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON SEQUENCE public.cockpit_board_provider_health_id_seq FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.cockpit_board_provider_health_id_seq TO service_role';
END $$;

-- Every insert, change and removal of a target or a lever: one audit row. The
-- actor is the seat that saved it (set by the save function), else the row's
-- own author.
CREATE OR REPLACE FUNCTION public.cockpit_board_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_actor text;
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN RETURN NULL; END IF;
  v_actor := coalesce(nullif(current_setting('cockpit.board_actor', true), ''), v_row->>'updated_by', v_row->>'created_by',
    nullif(auth.jwt()->>'email', ''), session_user::text);
  INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, "before", "after")
  VALUES (CASE TG_TABLE_NAME WHEN 'cockpit_board_targets' THEN 'board_target.' ELSE 'board_lever.' END || lower(TG_OP),
    TG_TABLE_NAME,
    CASE TG_TABLE_NAME WHEN 'cockpit_board_targets' THEN (v_row->>'scope_key') || ':' || (v_row->>'metric') ELSE v_row->>'id' END,
    v_actor, 'board', 'supabase',
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cockpit_board_targets_audit ON public.cockpit_board_targets;
CREATE TRIGGER cockpit_board_targets_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_board_targets
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_board_audit();
DROP TRIGGER IF EXISTS cockpit_board_levers_audit ON public.cockpit_board_levers;
CREATE TRIGGER cockpit_board_levers_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_board_levers
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_board_audit();

-- ---------------------------------------------------------------------------
-- 2. Targets and judging

/**
 * The official default targets, Aziz's approved list (2026-10-16), pinned by
 * the test to apps/media-buyer-cockpit/src/lib/kpi.ts and
 * apps/client-success-cockpit/src/lib/kpi.ts (CPL_GATE, CPL_BAD, CPB_GATE,
 * CPB_BAD, BOOKING_RATE_GATE, SHOW_RATE_AIM, SHOW_RATE_GOOD, CLOSE_RATE_GATE,
 * LINK_CTR_FLOOR) and to callCentre.ts CALL_RULES (touchedShare, minLeads,
 * firstCallWorkMinutes). The one copy: overrides live in
 * cockpit_board_targets, never a second set of numbers. strict_good: good
 * means strictly under (frequency under 2.5); never_off: short of the watch
 * line is still a watch (the show rate). min_sample: below it a rate is shown
 * and called too few. Leads touched and first call put the watch line on the
 * good line: callCentreVerdict calls any miss of CALL_RULES the call centre's
 * problem, so the board calls it off, never a watch.
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_default_targets()
RETURNS TABLE(metric text, value_key text, label text, unit text, direction text, good numeric, watch numeric,
  strict_good boolean, never_off boolean, min_sample numeric, sample text, owner_department text, basis text)
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT v.metric, v.value_key, v.label, v.unit, v.direction, v.good, v.watch, v.strict_good, v.never_off,
         v.min_sample, v.sample, v.owner_department, v.basis
  FROM (VALUES
    (1, 'cpl', 'cpl', 'Cost per lead', 'usd', 'lower', 15::numeric, 22.5::numeric, false, false, NULL::numeric, NULL::text,
        'media_buyer', 'kpi.ts CPL_GATE and CPL_BAD'),
    (2, 'cost_per_booking', 'costPerBooking', 'Cost per booking', 'usd', 'lower', 60, 80, false, false, NULL, NULL,
        'media_buyer', 'kpi.ts CPB_GATE and CPB_BAD'),
    (3, 'lead_to_booking', 'leadToBooking', 'Lead to booking', 'percent', 'higher', 25, 17.5, false, false, 10, 'CRM leads',
        'call_center', 'kpi.ts BOOKING_RATE_GATE; the watch line approved 2026-10-16'),
    (4, 'show_rate', 'showRate', 'Show rate', 'percent', 'higher', 70, 60, false, true, 5, 'marked meetings',
        'call_center', 'kpi.ts SHOW_RATE_AIM and SHOW_RATE_GOOD; under the line is a watch, never off'),
    (5, 'quotation_rate', 'quotationRate', 'Quotation rate', 'percent', 'higher', 50, 30, false, false, 5, 'shows',
        'client_success', 'constraints checklist: quote rate 50% or more of shows'),
    (6, 'close_rate', 'closeRate', 'Close rate', 'percent', 'higher', 30, 20, false, false, 5, 'shows',
        'client_success', 'kpi.ts CLOSE_RATE_GATE; checklist 20 to 30% of shows'),
    (7, 'aov', 'aov', 'Average order value', 'usd', 'higher', 10000, NULL, false, false, NULL, NULL,
        'client_success', 'constraints checklist: $10k renovations; set it per client'),
    (8, 'roas', 'roas', 'ROAS', 'times', 'higher', 20, 10, false, false, NULL, NULL,
        'media_buyer', 'approved 2026-10-16'),
    (9, 'lead_quality', 'leadQuality', 'Lead quality', 'score', 'higher', 7, 5, false, false, NULL, NULL,
        'media_buyer', 'the client portal''s score, 1 to 10; approved 2026-10-16'),
    (10, 'no_outcome_share', 'noOutcomeShare', 'No outcome', 'percent', 'lower', 0, 10, false, false, 1, 'meetings due',
        'client_success', 'approved 2026-10-16'),
    (11, 'cpm', 'cpm', 'CPM', 'usd', 'lower', 10, 15, false, false, 1000, 'impressions',
        'media_buyer', 'approved 2026-10-16'),
    (12, 'frequency', 'frequency', 'Frequency', 'ratio', 'lower', 2.5, 3.5, true, false, 1000, 'impressions',
        'creative', 'calculator.ts: fatigue at 2.5 or more'),
    (13, 'link_ctr', 'linkCtr', 'Link CTR', 'percent', 'higher', 0.8, 0.3, false, false, 1000, 'impressions',
        'creative', 'kpi.ts LINK_CTR_FLOOR is the watch line'),
    (14, 'cpc', 'cpc', 'Cost per link click', 'usd', 'lower', 1.25, 2, false, false, 1000, 'impressions',
        'media_buyer', 'approved 2026-10-16'),
    (15, 'opt_in', 'optIn', 'Opt-in rate', 'percent', 'higher', 10, 2, false, false, 50, 'link clicks',
        'media_buyer', 'calculator.ts: under 2% is a page or form problem'),
    (16, 'hook_rate', 'hookRate', 'Hook rate', 'percent', 'higher', 25, 15, false, false, 1000, 'video impressions',
        'creative', '3-second plays / impressions; approved 2026-10-16'),
    (17, 'hold_rate', 'holdRate', 'Hold rate', 'percent', 'higher', 30, 15, false, false, 1000, 'video impressions',
        'creative', 'ThruPlays / 3-second plays; approved 2026-10-16'),
    (18, 'leads_touched', 'leadsTouched', 'Leads touched', 'percent', 'higher', 90, 90, false, false, 20, 'callable leads',
        'call_center', 'callCentre.ts CALL_RULES.touchedShare and minLeads; any miss is off, as in callCentreVerdict'),
    (19, 'first_call', 'firstCall', 'First call', 'minutes', 'lower', 30, 30, false, false, NULL, NULL,
        'call_center', 'callCentre.ts CALL_RULES.firstCallWorkMinutes, in working minutes; any miss is off, as in callCentreVerdict')
  ) AS v(n, metric, value_key, label, unit, direction, good, watch, strict_good, never_off, min_sample, sample, owner_department, basis)
  ORDER BY v.n
$$;

/** good, watch or off for one value against one rule; NULL when there is nothing to judge. */
CREATE OR REPLACE FUNCTION public.cockpit_board_judge(p_value numeric, p_direction text, p_good numeric, p_watch numeric,
  p_strict boolean DEFAULT false, p_never_off boolean DEFAULT false)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_value IS NULL OR p_good IS NULL OR p_direction IS NULL OR p_direction NOT IN ('higher', 'lower') THEN NULL
    WHEN p_direction = 'higher' AND (p_value > p_good OR (p_value = p_good AND NOT coalesce(p_strict, false))) THEN 'good'
    WHEN p_direction = 'lower' AND (p_value < p_good OR (p_value = p_good AND NOT coalesce(p_strict, false))) THEN 'good'
    WHEN p_watch IS NULL OR coalesce(p_never_off, false) THEN 'watch'
    WHEN p_direction = 'higher' AND p_value >= p_watch THEN 'watch'
    WHEN p_direction = 'lower' AND p_value <= p_watch THEN 'watch'
    ELSE 'off' END
$$;

/**
 * The effective targets for one client (p_clickup NULL: the board's own):
 * per metric the client's override, else the board's, else the official one,
 * with where it came from and the official lines beside it.
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_targets_map(p_clickup text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(d.metric, jsonb_build_object(
      'key', d.value_key, 'label', d.label, 'unit', d.unit, 'direction', d.direction,
      'good', CASE WHEN c.metric IS NOT NULL THEN c.good WHEN b.metric IS NOT NULL THEN b.good ELSE d.good END,
      'watch', CASE WHEN c.metric IS NOT NULL THEN c.watch WHEN b.metric IS NOT NULL THEN b.watch ELSE d.watch END,
      'source', CASE WHEN c.metric IS NOT NULL THEN 'client' WHEN b.metric IS NOT NULL THEN 'board' ELSE 'official' END,
      'official', jsonb_build_object('good', d.good, 'watch', d.watch),
      'board', CASE WHEN b.metric IS NOT NULL THEN jsonb_build_object('good', b.good, 'watch', b.watch, 'by', b.updated_by,
                 'at', b.updated_at, 'note', b.note) END,
      'client', CASE WHEN c.metric IS NOT NULL THEN jsonb_build_object('good', c.good, 'watch', c.watch, 'by', c.updated_by,
                  'at', c.updated_at, 'note', c.note) END,
      'strict', d.strict_good, 'neverOff', d.never_off, 'minSample', d.min_sample, 'sample', d.sample,
      'owner', d.owner_department, 'basis', d.basis)), '{}'::jsonb)
  FROM public.cockpit_board_default_targets() d
  LEFT JOIN public.cockpit_board_targets b ON b.scope_key = 'defaults' AND b.metric = d.metric
  LEFT JOIN public.cockpit_board_targets c ON p_clickup IS NOT NULL AND c.scope_key = 'client:' || p_clickup AND c.metric = d.metric
$$;

/**
 * One value as the board shows it: {v, status, num?, den?, sample?, note?,
 * target?} plus extra keys. A given status wins; else NULL is not measured,
 * a value with no rule has no status, a sample under the rule's minimum is
 * too few, and anything else is judged.
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_cell(p_metric text, p_value numeric, p_targets jsonb,
  p_sample numeric DEFAULT NULL, p_num numeric DEFAULT NULL, p_den numeric DEFAULT NULL,
  p_status text DEFAULT NULL, p_note text DEFAULT NULL, p_extra jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  t jsonb := CASE WHEN p_metric IS NULL THEN NULL ELSE p_targets->p_metric END;
  s text := p_status;
BEGIN
  IF s IS NULL AND p_value IS NULL THEN s := 'not_measured'; END IF;
  IF s IS NULL AND t IS NOT NULL THEN
    IF (t->>'minSample') IS NOT NULL AND coalesce(p_sample, 0) < (t->>'minSample')::numeric THEN
      s := 'too_few';
    ELSE
      s := public.cockpit_board_judge(p_value, t->>'direction', (t->>'good')::numeric, (t->>'watch')::numeric,
        coalesce((t->>'strict')::boolean, false), coalesce((t->>'neverOff')::boolean, false));
    END IF;
  END IF;
  RETURN jsonb_build_object('v', p_value, 'status', s)
    || jsonb_strip_nulls(jsonb_build_object('num', p_num, 'den', p_den, 'sample', p_sample, 'note', p_note,
         'target', CASE WHEN t IS NOT NULL THEN p_metric END))
    || coalesce(p_extra, '{}'::jsonb);
END $$;

/**
 * The status of a value known only as a floor (the true value is at least
 * p_floor): a cost with nothing to divide by yet (no lead, no booking), or
 * revenue with a close of no known value. A cost already past its lines is
 * as bad as that; one under them is too early to call. A higher-is-better
 * floor already good is good; under it, the true value is not known.
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_floor_status(p_metric text, p_floor numeric, p_targets jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE t jsonb := p_targets->p_metric; s text;
BEGIN
  IF t IS NULL OR p_floor IS NULL THEN RETURN 'too_few'; END IF;
  s := public.cockpit_board_judge(p_floor, t->>'direction', (t->>'good')::numeric, (t->>'watch')::numeric,
    coalesce((t->>'strict')::boolean, false), coalesce((t->>'neverOff')::boolean, false));
  IF t->>'direction' = 'lower' THEN RETURN CASE WHEN s = 'good' THEN 'too_few' ELSE s END; END IF;
  RETURN CASE WHEN s = 'good' THEN 'good' ELSE 'not_measured' END;
END $$;

/** A summed count over the time frame: NULL when no day has a figure; "at least" when some days have none. */
CREATE OR REPLACE FUNCTION public.cockpit_board_count(p_sum numeric, p_days bigint, p_window integer,
  p_null_status text DEFAULT 'not_measured', p_null_note text DEFAULT NULL, p_extra jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN coalesce(p_days, 0) = 0 THEN jsonb_build_object('v', NULL, 'status', p_null_status,
      'note', coalesce(p_null_note, 'No figure is stored for these days.'))
    WHEN p_days < p_window THEN jsonb_build_object('v', p_sum, 'status', NULL, 'atLeast', true,
      'note', format('%s of the %s days have no figure, so this is what was found.', p_window - p_days, p_window))
    ELSE jsonb_build_object('v', p_sum, 'status', NULL) END
    || coalesce(p_extra, '{}'::jsonb)
$$;

/**
 * Shows as the board shows them, for a client row, a campaign, an ad set or
 * an ad: unmarked is never a no-show, so meetings due with none marked are
 * not filled in, never 0 shows. p_due NULL: no figure.
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_shows(p_shows numeric, p_no_shows numeric, p_due numeric, p_null_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_due IS NULL THEN jsonb_build_object('v', NULL, 'status', 'not_measured', 'note', coalesce(p_null_note, 'No figure is stored for these days.'))
    WHEN p_due > 0 AND coalesce(p_shows, 0) + coalesce(p_no_shows, 0) = 0 THEN jsonb_build_object('v', NULL, 'status', 'not_filled_in',
      'due', p_due, 'note', format('None of the %s meeting%s due is marked showed or no-show.', p_due, CASE WHEN p_due = 1 THEN '' ELSE 's' END))
    ELSE jsonb_build_object('v', coalesce(p_shows, 0), 'status', NULL, 'noShows', coalesce(p_no_shows, 0),
      'marked', coalesce(p_shows, 0) + coalesce(p_no_shows, 0), 'due', p_due)
      || CASE WHEN p_due > 0 THEN jsonb_build_object('note', format('%s of %s meetings due are marked.',
           coalesce(p_shows, 0) + coalesce(p_no_shows, 0), p_due)) ELSE '{}'::jsonb END END
$$;

/** Every ad column with one status and one sentence: no ad account, nothing read yet. */
CREATE OR REPLACE FUNCTION public.cockpit_board_ad_unmeasured(p_status text, p_note text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_object_agg(k, jsonb_build_object('v', NULL, 'status', p_status, 'note', p_note))
  FROM unnest(ARRAY['spend', 'impressions', 'linkClicks', 'metaLeads', 'cpl', 'cpm', 'frequency', 'linkCtr', 'cpc', 'optIn',
    'hookRate', 'holdRate', 'retention25', 'retention50', 'retention75', 'retention100']) k
$$;

/**
 * The ad columns from summed ad-days (p: rows, spend, unpriced, imp, clicks,
 * lead_rows, leads, lead_spend, lead_clicks, video_rows, video_imp, v3, thru,
 * plays, p25, p50, p75, p100, freq_w, freq_imp) and, when the time frame is a
 * standard window, Meta's reach for it (p_reach: reach, impressions, note).
 * The same rules for a client, a campaign, an ad set and an ad.
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_ad_cells(p jsonb, p_targets jsonb, p_reach jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  spend numeric := (p->>'spend')::numeric;
  unpriced integer := coalesce((p->>'unpriced')::integer, 0);
  imp numeric := coalesce((p->>'imp')::numeric, 0);
  clicks numeric := coalesce((p->>'clicks')::numeric, 0);
  lead_rows integer := coalesce((p->>'lead_rows')::integer, 0);
  leads numeric := coalesce((p->>'leads')::numeric, 0);
  lead_spend numeric := coalesce((p->>'lead_spend')::numeric, 0);
  lead_clicks numeric := coalesce((p->>'lead_clicks')::numeric, 0);
  video_rows integer := coalesce((p->>'video_rows')::integer, 0);
  video_imp numeric := coalesce((p->>'video_imp')::numeric, 0);
  v3 numeric := coalesce((p->>'v3')::numeric, 0);
  thru numeric := coalesce((p->>'thru')::numeric, 0);
  plays numeric := coalesce((p->>'plays')::numeric, 0);
  freq_w numeric := (p->>'freq_w')::numeric;
  freq_imp numeric := (p->>'freq_imp')::numeric;
  r_reach numeric := (p_reach->>'reach')::numeric;
  r_imp numeric := (p_reach->>'impressions')::numeric;
  v_spend_note text := CASE WHEN unpriced > 0 THEN format('%s ad-day%s in a currency with no fixed USD rate %s left out, so spend is at least this.',
    unpriced, CASE WHEN unpriced = 1 THEN '' ELSE 's' END, CASE WHEN unpriced = 1 THEN 'is' ELSE 'are' END) END;
  v_no_lead constant text := 'No lead-form campaign ran in this time frame.';
  v_no_video constant text := 'Not a video: no video ad ran in this time frame.';
  v_floor boolean := unpriced > 0;
  v_at_least jsonb := CASE WHEN unpriced > 0 THEN jsonb_build_object('atLeast', true) END;
  v_freq jsonb;
  v_ret jsonb := '{}'::jsonb;
  k text;
BEGIN
  spend := coalesce(spend, CASE WHEN unpriced = 0 THEN 0 END);
  IF r_reach > 0 AND r_imp IS NOT NULL THEN
    v_freq := public.cockpit_board_cell('frequency', round(r_imp / r_reach, 2), p_targets, r_imp, r_imp, r_reach, NULL,
      concat_ws(' ', 'Over the whole time frame: Meta''s reach for it, read to today.', p_reach->>'note'),
      jsonb_build_object('basis', 'window'));
  ELSIF freq_imp > 0 THEN
    v_freq := public.cockpit_board_cell('frequency', round(freq_w / freq_imp, 2), p_targets, imp, NULL, NULL, NULL,
      concat_ws(' ', 'Average daily frequency, weighted by impressions: frequency over a whole time frame is kept for the last 7, 14 and 30 days, this month and last month.',
        p_reach->>'note'),
      jsonb_build_object('basis', 'average_daily'));
  ELSE
    v_freq := public.cockpit_board_cell('frequency', NULL, p_targets, imp, NULL, NULL, CASE WHEN imp = 0 THEN 'too_few' ELSE 'not_measured' END,
      coalesce(p_reach->>'note', CASE WHEN imp = 0 THEN 'No impressions in this time frame.' END));
  END IF;
  FOREACH k IN ARRAY ARRAY['25', '50', '75', '100'] LOOP
    v_ret := v_ret || jsonb_build_object('retention' || k, CASE
      WHEN video_rows = 0 THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_no_video, jsonb_build_object('notVideo', true))
      WHEN plays = 0 THEN public.cockpit_board_cell(NULL, NULL, p_targets, 0, NULL, NULL, 'too_few', 'No video plays in this time frame.')
      ELSE public.cockpit_board_cell(NULL, round(coalesce((p->>('p' || k))::numeric, 0) / plays * 100, 2), p_targets, plays,
        coalesce((p->>('p' || k))::numeric, 0), plays) END);
  END LOOP;
  RETURN jsonb_build_object(
    'spend', public.cockpit_board_cell(NULL, round(spend, 2), p_targets, NULL, NULL, NULL, NULL, v_spend_note,
      CASE WHEN unpriced > 0 THEN jsonb_build_object('atLeast', true) END),
    'impressions', public.cockpit_board_cell(NULL, imp, p_targets),
    'linkClicks', public.cockpit_board_cell(NULL, clicks, p_targets),
    'metaLeads', CASE WHEN lead_rows = 0 THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_no_lead)
                      ELSE public.cockpit_board_cell(NULL, leads, p_targets) END,
    'cpl', CASE
      WHEN lead_rows = 0 THEN public.cockpit_board_cell('cpl', NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_no_lead)
      WHEN leads > 0 THEN public.cockpit_board_cell('cpl', round(lead_spend / leads, 2), p_targets, leads, round(lead_spend, 2), leads,
        CASE WHEN v_floor THEN public.cockpit_board_floor_status('cpl', round(lead_spend / leads, 2), p_targets) END, v_spend_note, v_at_least)
      ELSE public.cockpit_board_cell('cpl', NULL, p_targets, 0, round(lead_spend, 2), 0,
        public.cockpit_board_floor_status('cpl', round(lead_spend, 2), p_targets),
        format('No form lead yet for $%s of lead-campaign spend.', to_char(round(lead_spend, 2), 'FM999,999,990.00')),
        jsonb_build_object('atLeast', round(lead_spend, 2))) END,
    'cpm', CASE WHEN spend IS NULL THEN public.cockpit_board_cell('cpm', NULL, p_targets, imp, NULL, NULL, 'not_measured', v_spend_note)
                WHEN imp > 0 THEN public.cockpit_board_cell('cpm', round(spend / imp * 1000, 2), p_targets, imp, round(spend, 2), imp,
                  CASE WHEN v_floor THEN public.cockpit_board_floor_status('cpm', round(spend / imp * 1000, 2), p_targets) END, v_spend_note, v_at_least)
                ELSE public.cockpit_board_cell('cpm', NULL, p_targets, 0, NULL, NULL, 'too_few', 'No impressions in this time frame.') END,
    'frequency', v_freq,
    'linkCtr', CASE WHEN imp > 0 THEN public.cockpit_board_cell('link_ctr', round(clicks / imp * 100, 2), p_targets, imp, clicks, imp)
                    ELSE public.cockpit_board_cell('link_ctr', NULL, p_targets, 0, NULL, NULL, 'too_few', 'No impressions in this time frame.') END,
    'cpc', CASE WHEN spend IS NULL THEN public.cockpit_board_cell('cpc', NULL, p_targets, imp, NULL, NULL, 'not_measured', v_spend_note)
                WHEN clicks > 0 THEN public.cockpit_board_cell('cpc', round(spend / clicks, 2), p_targets, imp, round(spend, 2), clicks,
                  CASE WHEN v_floor THEN public.cockpit_board_floor_status('cpc', round(spend / clicks, 2), p_targets) END, v_spend_note, v_at_least)
                ELSE public.cockpit_board_cell('cpc', NULL, p_targets, imp, NULL, NULL, 'too_few', 'No link clicks in this time frame.') END,
    'optIn', CASE WHEN lead_rows = 0 THEN public.cockpit_board_cell('opt_in', NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_no_lead)
                  WHEN lead_clicks > 0 THEN public.cockpit_board_cell('opt_in', round(leads / lead_clicks * 100, 2), p_targets, lead_clicks, leads, lead_clicks,
                    NULL, 'Form leads / link clicks on lead campaigns.')
                  ELSE public.cockpit_board_cell('opt_in', NULL, p_targets, 0, NULL, NULL, 'too_few', 'No link clicks on lead campaigns in this time frame.') END,
    'hookRate', CASE WHEN video_rows = 0 THEN public.cockpit_board_cell('hook_rate', NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_no_video,
                       jsonb_build_object('notVideo', true))
                     WHEN video_imp > 0 THEN public.cockpit_board_cell('hook_rate', round(v3 / video_imp * 100, 2), p_targets, video_imp, v3, video_imp,
                       NULL, '3-second plays / impressions of video ads.')
                     ELSE public.cockpit_board_cell('hook_rate', NULL, p_targets, 0, NULL, NULL, 'too_few', 'No video impressions in this time frame.') END,
    'holdRate', CASE WHEN video_rows = 0 THEN public.cockpit_board_cell('hold_rate', NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_no_video,
                       jsonb_build_object('notVideo', true))
                     WHEN v3 > 0 THEN public.cockpit_board_cell('hold_rate', round(thru / v3 * 100, 2), p_targets, video_imp, thru, v3,
                       NULL, 'ThruPlays / 3-second plays.')
                     ELSE public.cockpit_board_cell('hold_rate', NULL, p_targets, video_imp, NULL, NULL, 'too_few', 'No 3-second plays in this time frame.') END
  ) || v_ret;
END $$;

-- ---------------------------------------------------------------------------
-- 3. The assigned callers: one rule for cockpit_client_callers() and the board

/**
 * The dialer's assigned callers per client location (Aziz, 2026-10-13: the
 * assigned agent). The rule of cockpit_client_calls (20261013180000) as
 * cockpit_client_callers (20261013180200) wrote it: the dialer's active
 * assignments (mahara_console.metadata access:agent:<email>, locationIds),
 * kept when the dialer's account says agent, or, with no dialer account, when
 * Team & Payroll says call centre agent; admin seats that hold assignments to
 * see the queue are left out. Held once here: cockpit_client_callers() and
 * the board both read it. No gate: the service key and the definer reads only.
 */
CREATE OR REPLACE FUNCTION public.cockpit_client_caller_rows()
RETURNS TABLE(location_id text, email text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH agents AS (
    SELECT DISTINCT lower(btrim(m.data->>'email')) AS email, loc
    FROM mahara_console.metadata m, jsonb_array_elements_text(m.data->'locationIds') loc
    WHERE m.namespace = 'production' AND m.id LIKE 'access:agent:%' AND m.data->>'active' = 'true'
      AND jsonb_typeof(m.data->'locationIds') = 'array' AND nullif(btrim(m.data->>'email'), '') IS NOT NULL)
  SELECT a.loc, a.email, coalesce(nullif(btrim(pp.name), ''), a.email)
  FROM agents a
  LEFT JOIN mahara_console.metadata i ON i.namespace = 'production' AND i.id = 'identity:account:' || a.email
  LEFT JOIN LATERAL (SELECT p.name, p.role, p.active FROM public.cockpit_people p WHERE lower(btrim(p.email)) = a.email
                     ORDER BY p.active DESC, p.id DESC LIMIT 1) pp ON true
  WHERE CASE WHEN i.id IS NOT NULL THEN coalesce(i.data->>'role' = 'agent' AND i.data->>'enabled' = 'true', false)
             ELSE coalesce(pp.role ~* '^call cent(re|er) agent' AND pp.active, false) END
$$;

-- The gated read keeps its gate, its output and its grants; its rule now
-- comes from the helper above, so the two can never drift.
CREATE OR REPLACE FUNCTION public.cockpit_client_callers() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_out jsonb;
BEGIN
 PERFORM public.cockpit_call_centre_seat();
 WITH callers AS MATERIALIZED (SELECT * FROM public.cockpit_client_caller_rows())
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'taskId', g.clickup_id, 'locationId', g.location_id, 'clientName', g.client_name,
   'callers', coalesce((SELECT jsonb_agg(jsonb_build_object('email', c.email, 'name', c.name) ORDER BY c.name)
                        FROM callers c WHERE c.location_id = g.location_id), '[]'::jsonb)) ORDER BY g.client_name), '[]'::jsonb)
 INTO v_out
 FROM public.ghl_clients g
 WHERE nullif(btrim(g.clickup_id), '') IS NOT NULL AND public.cockpit_client_allowed(g.client_name);
 RETURN jsonb_build_object(
  'clients', v_out,
  'source', 'The dialer''s client assignments',
  'generatedAt', now());
END $$;

-- ---------------------------------------------------------------------------
-- 4. The rows

CREATE OR REPLACE FUNCTION public.cockpit_board_check_window(p_from date, p_to date)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Choose a time frame: a first day on or before the last day.' USING ERRCODE = '22023';
  END IF;
  IF p_to > (now() AT TIME ZONE 'Asia/Kuwait')::date THEN
    RAISE EXCEPTION 'Choose days up to today (Kuwait time).' USING ERRCODE = '22023';
  END IF;
  IF p_to - p_from > 365 THEN
    RAISE EXCEPTION 'Choose at most 366 days.' USING ERRCODE = '22023';
  END IF;
END $$;

/** A plain money, percent or count for a sentence. */
CREATE OR REPLACE FUNCTION public.cockpit_board_fmt(p_value numeric, p_unit text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN 'not known'
    WHEN p_unit = 'usd' THEN '$' || to_char(round(p_value, 2), 'FM999,999,999,990.00')
    WHEN p_unit = 'percent' THEN to_char(round(p_value, 2), 'FM999,990.09') || '%'
    WHEN p_unit = 'times' THEN to_char(round(p_value, 2), 'FM999,990.09') || 'x'
    WHEN p_unit = 'minutes' THEN to_char(round(p_value, 1), 'FM999,990.9') || ' working minutes'
    ELSE to_char(round(p_value, 2), 'FM999,999,990.09') END
$$;

/**
 * Every client row for the time frame, ungated (the reads gate and filter).
 * p_location limits it to one client; p_meta is cockpit_meta_ad_days_status().
 * Clients that are cancelled or removed from the sheet are left out, as the
 * facts leave them out.
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_rows(p_from date, p_to date, p_location text, p_meta jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_days integer := p_to - p_from + 1;
  v_ad_to date := least(p_to, ((now() AT TIME ZONE 'Asia/Kuwait')::date) - 1);
  v_store_rows bigint := coalesce((p_meta->'store'->>'rows')::bigint, 0);
  v_store_first date := (p_meta->'store'->>'firstDay')::date;
  v_out jsonb := '[]'::jsonb;
  r record;
  t jsonb;
  v_dwy boolean;
  v_notes text[];
  v_src jsonb;
  v_vals jsonb;
  v_ad jsonb;
  v_ad_ok boolean;
  v_fail text;
  v_spend numeric;
  v_unpriced_spend boolean;
  -- the facts, NULL when no day has a figure
  crm numeric; booked numeric; booked_ad numeric; due numeric; shows numeric; no_shows numeric; marked numeric;
  no_out numeric; quotes numeric; closes numeric; valued numeric; revenue numeric; revenue_ad numeric; lq_n numeric;
  v_rev_incomplete boolean;
  v_closes_status text; v_quotes_status text; v_lq_status text;
  v_calls_note constant text := 'The client calls: Done With You.';
  v_cell jsonb;
  v_x numeric;
BEGIN
  FOR r IN
    WITH cl AS (
      SELECT b.location_id, b.clickup_id, b.client_name, b.status, b.service_mode, b.ad_account_ids, b.tiktok
      FROM public.cockpit_board_clients b
      WHERE coalesce(b.status, '') NOT IN ('Cancelled', 'Removed from sheet')
        AND (p_location IS NULL OR b.location_id = p_location)
    ), fx AS (
      SELECT d.location_id AS fx_loc,
        count(*) AS f_days, max(d.computed_at) AS f_computed,
        sum(d.crm_leads) AS f_crm, count(d.crm_leads) AS f_crm_d,
        sum(d.crm_ad_leads) AS f_crm_ad, count(d.crm_ad_leads) AS f_crm_ad_d,
        sum(d.confirmed_bookings) AS f_booked, count(d.confirmed_bookings) AS f_booked_d,
        sum(d.confirmed_bookings) FILTER (WHERE d.day <= v_ad_to) AS f_booked_ad,
        count(d.confirmed_bookings) FILTER (WHERE d.day <= v_ad_to) AS f_booked_ad_d,
        sum(d.provisional_bookings) AS f_prov, count(d.provisional_bookings) AS f_prov_d,
        sum(d.meetings_due) AS f_due, count(d.meetings_due) AS f_due_d,
        sum(d.shows) AS f_shows, sum(d.no_shows) AS f_no_shows, count(d.shows) AS f_shows_d,
        sum(d.no_outcome) AS f_no_out, count(d.no_outcome) AS f_no_out_d,
        min(d.day) FILTER (WHERE d.no_outcome > 0) AS f_no_out_first,
        sum(d.quotations) AS f_quotes, count(d.quotations) AS f_quotes_d,
        sum(d.quotation_answers) AS f_qa, count(d.quotation_answers) AS f_qa_d,
        sum(d.closes) AS f_closes, count(d.closes) AS f_closes_d,
        sum(d.closes_with_value) AS f_valued,
        sum(d.revenue_usd) AS f_revenue,
        sum(d.revenue_usd) FILTER (WHERE d.day <= v_ad_to) AS f_revenue_ad,
        sum(d.closes) FILTER (WHERE d.day <= v_ad_to) AS f_closes_ad,
        sum(d.closes_with_value) FILTER (WHERE d.day <= v_ad_to) AS f_valued_ad,
        coalesce(sum((d.sources->'sheet'->>'unpricedCloses')::integer), 0) AS f_unpriced,
        coalesce(sum((d.sources->'sheet'->>'unpricedCloses')::integer) FILTER (WHERE d.day <= v_ad_to), 0) AS f_unpriced_ad,
        sum(d.lead_quality_sum) AS f_lq_sum, sum(d.lead_quality_count) AS f_lq_n, count(d.lead_quality_count) AS f_lq_d,
        sum(d.dials) AS f_dials, count(d.dials) AS f_dials_d,
        sum(d.leads_called) AS f_called, count(d.leads_called) AS f_called_d
      FROM public.cockpit_client_days d JOIN cl ON cl.location_id = d.location_id
      WHERE d.day BETWEEN p_from AND p_to
      GROUP BY d.location_id
    ), src AS (
      SELECT DISTINCT ON (d.location_id) d.location_id, d.sources
      FROM public.cockpit_client_days d JOIN cl ON cl.location_id = d.location_id
      WHERE d.day BETWEEN p_from AND p_to
      ORDER BY d.location_id, d.day DESC
    ), ad AS (
      SELECT cl.location_id, jsonb_build_object(
          'rows', count(*), 'spend', sum(m.spend_usd), 'unpriced', count(*) FILTER (WHERE m.spend IS NOT NULL AND m.spend_usd IS NULL),
          'imp', sum(m.impressions), 'clicks', sum(m.link_clicks),
          'lead_rows', count(*) FILTER (WHERE m.leads IS NOT NULL), 'leads', sum(m.leads),
          'lead_spend', sum(m.spend_usd) FILTER (WHERE m.leads IS NOT NULL), 'lead_clicks', sum(m.link_clicks) FILTER (WHERE m.leads IS NOT NULL),
          'video_rows', count(*) FILTER (WHERE m.video_3s IS NOT NULL), 'video_imp', sum(m.impressions) FILTER (WHERE m.video_3s IS NOT NULL),
          'v3', sum(m.video_3s), 'thru', sum(m.thruplays) FILTER (WHERE m.video_3s IS NOT NULL),
          'plays', sum(m.video_plays), 'p25', sum(m.video_p25) FILTER (WHERE m.video_plays IS NOT NULL),
          'p50', sum(m.video_p50) FILTER (WHERE m.video_plays IS NOT NULL), 'p75', sum(m.video_p75) FILTER (WHERE m.video_plays IS NOT NULL),
          'p100', sum(m.video_p100) FILTER (WHERE m.video_plays IS NOT NULL),
          'freq_w', sum(m.impressions * m.frequency) FILTER (WHERE m.frequency > 0), 'freq_imp', sum(m.impressions) FILTER (WHERE m.frequency > 0)
        ) AS a_sums, max(m.fetched_at) AS a_fetched
      FROM cl JOIN public.cockpit_meta_ad_days m ON m.account_id = ANY(cl.ad_account_ids)
      WHERE m.day BETWEEN p_from AND p_to
        AND m.day < (now() AT TIME ZONE coalesce(m.account_timezone, 'Asia/Kuwait'))::date
      GROUP BY cl.location_id
    ), rc AS (
      SELECT DISTINCT ON (x.key) x.key AS location_id,
        jsonb_build_object('reach', x.reach, 'impressions', x.impressions, 'note', x.note) AS a_reach
      FROM public.cockpit_meta_reach x
      JOIN public.cockpit_meta_reach_windows(v_today) w ON w.window_key = x.window_key AND w.from_day = x.from_day AND w.to_day = x.to_day
      WHERE x.level = 'client' AND w.from_day = p_from AND w.to_day = p_to
      ORDER BY x.key, (x.reach IS NOT NULL) DESC
    ), cr AS (
      SELECT c.location_id, jsonb_agg(jsonb_build_object('email', c.email, 'name', c.name) ORDER BY c.name) AS callers
      FROM public.cockpit_client_caller_rows() c GROUP BY c.location_id
    ), lv AS (
      SELECT l.location_id, count(*) FILTER (WHERE l.status = 'open') AS l_open,
        count(*) FILTER (WHERE l.status = 'reconcile') AS l_reconcile, max(l.created_at) AS l_last
      FROM public.cockpit_board_levers l GROUP BY l.location_id
    )
    SELECT cl.location_id, cl.clickup_id, cl.client_name, cl.status, cl.service_mode, cl.ad_account_ids, cl.tiktok,
      fx.*, src.sources AS s_sources, ad.a_sums, ad.a_fetched, rc.a_reach, coalesce(cr.callers, '[]'::jsonb) AS c_callers,
      n.untouched_leads AS n_untouched, n.oldest_untouched_at AS n_oldest, n.touched_share_30d AS n_share,
      n.callable_30d AS n_callable, n.touched_30d AS n_touched, n.first_call_median_work_seconds_30d AS n_first,
      n.computed_at AS n_computed, n.note AS n_note, n.location_id IS NOT NULL AS n_has,
      coalesce(lv.l_open, 0) AS l_open, coalesce(lv.l_reconcile, 0) AS l_reconcile, lv.l_last
    FROM cl
    LEFT JOIN fx ON fx.fx_loc = cl.location_id
    LEFT JOIN src ON src.location_id = cl.location_id
    LEFT JOIN ad ON ad.location_id = cl.location_id
    LEFT JOIN rc ON rc.location_id = cl.location_id
    LEFT JOIN cr ON cr.location_id = cl.location_id
    LEFT JOIN public.cockpit_client_now n ON n.location_id = cl.location_id
    LEFT JOIN lv ON lv.location_id = cl.location_id
    ORDER BY cl.client_name, cl.location_id
  LOOP
    t := public.cockpit_board_targets_map(r.clickup_id);
    v_dwy := r.service_mode = 'DWY';
    v_notes := '{}'::text[];
    v_src := coalesce(r.s_sources, '{}'::jsonb);

    crm := CASE WHEN r.f_crm_d > 0 THEN r.f_crm END;
    booked := CASE WHEN r.f_booked_d > 0 THEN r.f_booked END;
    booked_ad := CASE WHEN r.f_booked_ad_d > 0 THEN r.f_booked_ad END;
    due := CASE WHEN r.f_due_d > 0 THEN r.f_due END;
    shows := CASE WHEN r.f_shows_d > 0 THEN r.f_shows END;
    no_shows := CASE WHEN r.f_shows_d > 0 THEN r.f_no_shows END;
    marked := coalesce(shows, 0) + coalesce(no_shows, 0);
    no_out := CASE WHEN r.f_no_out_d > 0 THEN r.f_no_out END;
    quotes := CASE WHEN r.f_quotes_d > 0 THEN r.f_quotes END;
    closes := CASE WHEN r.f_closes_d > 0 THEN r.f_closes END;
    valued := CASE WHEN r.f_closes_d > 0 THEN r.f_valued END;
    revenue := CASE WHEN r.f_closes_d > 0 THEN r.f_revenue END;
    revenue_ad := CASE WHEN r.f_closes_d > 0 THEN coalesce(r.f_revenue_ad, 0) END;
    lq_n := CASE WHEN r.f_lq_d > 0 THEN r.f_lq_n END;
    v_rev_incomplete := coalesce(r.f_closes, 0) > coalesce(r.f_valued, 0) OR coalesce(r.f_unpriced, 0) > 0;

    IF r.f_days IS NULL THEN
      v_notes := v_notes || 'No business figures are stored for these days yet.'::text;
    END IF;
    -- A source that could not be read is not the client's blank.
    v_closes_status := CASE WHEN v_src->'sheet'->>'state' = 'failed' OR v_src->'outcomes'->>'state' = 'failed'
                              OR v_src->'appointments'->>'state' = 'failed' OR r.f_days IS NULL THEN 'not_measured' ELSE 'not_filled_in' END;
    v_quotes_status := CASE WHEN v_src->'sheet_copy'->>'state' = 'failed' OR v_src->'outcomes'->>'state' = 'failed'
                              OR v_src->'appointments'->>'state' = 'failed' OR r.f_days IS NULL THEN 'not_measured' ELSE 'not_filled_in' END;
    v_lq_status := CASE WHEN v_src->'outcomes'->>'state' = 'failed' OR v_src->'appointments'->>'state' = 'failed'
                          OR r.f_days IS NULL THEN 'not_measured' ELSE 'not_filled_in' END;

    -- The ad half.
    v_ad_ok := false;
    v_spend := NULL;
    IF cardinality(coalesce(r.ad_account_ids, '{}'::text[])) = 0 THEN
      v_ad := public.cockpit_board_ad_unmeasured('not_measured', CASE WHEN r.tiktok
        THEN 'No Meta ad account is linked to this client, and TikTok spend is not stored.'
        ELSE 'No Meta ad account is linked to this client.' END);
    ELSIF p_from > v_ad_to THEN
      v_ad := public.cockpit_board_ad_unmeasured('not_measured', 'Ad numbers end yesterday on each ad account''s clock, so today is not in yet.');
    ELSIF v_store_rows = 0 THEN
      v_ad := public.cockpit_board_ad_unmeasured('not_measured', 'The Meta ad store has no rows yet.');
    ELSE
      v_ad := public.cockpit_board_ad_cells(coalesce(r.a_sums, jsonb_build_object('rows', 0, 'spend', 0)), t, r.a_reach);
      v_ad_ok := true;
      v_spend := (v_ad->'spend'->>'v')::numeric;
      IF r.a_sums IS NULL THEN
        v_notes := v_notes || 'No delivery on the linked ad accounts in these days.'::text;
      END IF;
      IF v_store_first IS NOT NULL AND p_from < v_store_first THEN
        v_notes := v_notes || format('Meta ad numbers are stored from %s; earlier days are left out.', to_char(v_store_first, 'DD Mon YYYY'));
      END IF;
      SELECT string_agg(format('%s%s since %s', a->>'accountId', coalesce(' (' || (a->>'name') || ')', ''),
               coalesce(to_char((a->>'failingSince')::timestamptz AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'), 'its last read')), ', ')
        INTO v_fail
      FROM jsonb_array_elements(coalesce(p_meta->'accounts', '[]'::jsonb)) a
      WHERE a->>'failing' IS NOT NULL AND a->>'accountId' = ANY(r.ad_account_ids);
      IF v_fail IS NOT NULL THEN
        v_notes := v_notes || format('Meta could not be read for ad account %s, so its newest days may be missing.', v_fail);
      END IF;
      IF r.tiktok THEN
        v_notes := v_notes || 'Meta only: TikTok spend is not stored.'::text;
      END IF;
    END IF;
    v_unpriced_spend := coalesce((v_ad->'spend'->>'atLeast')::boolean, false);

    v_vals := v_ad
      || jsonb_build_object(
        'crmLeads', public.cockpit_board_count(r.f_crm, r.f_crm_d, v_days, 'not_measured', v_src->'leads'->>'note'),
        'crmAdLeads', public.cockpit_board_count(r.f_crm_ad, r.f_crm_ad_d, v_days, 'not_measured', v_src->'leads'->>'note'),
        'confirmedBookings', public.cockpit_board_count(r.f_booked, r.f_booked_d, v_days, 'not_measured', v_src->'appointments'->>'note'),
        'provisionalBookings', public.cockpit_board_count(r.f_prov, r.f_prov_d, v_days, 'not_measured', v_src->'provisional'->>'note'),
        'meetingsDue', public.cockpit_board_count(r.f_due, r.f_due_d, v_days, 'not_measured', v_src->'appointments'->>'note'),
        'noOutcome', public.cockpit_board_count(r.f_no_out, r.f_no_out_d, v_days, 'not_measured', v_src->'appointments'->>'note',
          jsonb_build_object('oldestDays', CASE WHEN r.f_no_out_first IS NOT NULL THEN v_today - r.f_no_out_first END)),
        'dials', CASE WHEN v_dwy THEN jsonb_build_object('v', NULL, 'status', 'not_measured', 'note', v_calls_note, 'clientCalls', true)
                      ELSE public.cockpit_board_count(r.f_dials, r.f_dials_d, v_days, 'not_measured', v_src->'dialer'->>'note') END,
        'leadsCalled', CASE WHEN v_dwy THEN jsonb_build_object('v', NULL, 'status', 'not_measured', 'note', v_calls_note, 'clientCalls', true)
                            ELSE public.cockpit_board_count(r.f_called, r.f_called_d, v_days, 'not_measured', v_src->'dialer_leads'->>'note',
                              CASE WHEN r.f_called_d > 0 AND crm > 0 THEN jsonb_build_object('share', round(r.f_called / crm * 100, 2)) END) END
      );

    -- Lead to booking: confirmed bookings / CRM leads, both by the day made.
    v_vals := v_vals || jsonb_build_object('leadToBooking', CASE
      WHEN crm IS NULL OR booked IS NULL THEN public.cockpit_board_cell('lead_to_booking', NULL, t, NULL, NULL, NULL, 'not_measured',
        coalesce(v_src->'leads'->>'note', v_src->'appointments'->>'note'))
      WHEN crm = 0 THEN public.cockpit_board_cell('lead_to_booking', NULL, t, 0, booked, 0, 'too_few', 'No CRM lead in this time frame.')
      ELSE public.cockpit_board_cell('lead_to_booking', round(booked / crm * 100, 2), t, crm, booked, crm) END);

    -- Cost per booking: spend / confirmed bookings over the same days (to yesterday).
    v_vals := v_vals || jsonb_build_object('costPerBooking', CASE
      WHEN NOT v_ad_ok THEN public.cockpit_board_cell('cost_per_booking', NULL, t, NULL, NULL, NULL, 'not_measured', v_ad->'spend'->>'note')
      WHEN booked_ad IS NULL OR v_spend IS NULL THEN public.cockpit_board_cell('cost_per_booking', NULL, t, NULL, NULL, NULL, 'not_measured',
        coalesce(v_src->'appointments'->>'note', v_ad->'spend'->>'note'))
      WHEN booked_ad > 0 THEN public.cockpit_board_cell('cost_per_booking', round(v_spend / booked_ad, 2), t, booked_ad, v_spend, booked_ad,
        CASE WHEN v_unpriced_spend THEN public.cockpit_board_floor_status('cost_per_booking', round(v_spend / booked_ad, 2), t) END,
        concat_ws(' ', 'Confirmed bookings to yesterday, the same days as spend.', v_ad->'spend'->>'note'),
        CASE WHEN v_unpriced_spend THEN jsonb_build_object('atLeast', true) END)
      WHEN v_spend > 0 THEN public.cockpit_board_cell('cost_per_booking', NULL, t, 0, v_spend, 0,
        public.cockpit_board_floor_status('cost_per_booking', v_spend, t),
        format('No confirmed booking yet for %s of spend.', public.cockpit_board_fmt(v_spend, 'usd')), jsonb_build_object('atLeast', v_spend))
      ELSE public.cockpit_board_cell('cost_per_booking', NULL, t, 0, 0, 0, 'too_few', 'No spend and no confirmed booking in these days.') END);

    -- Shows and the show rate: shows / (shows + no-shows), unmarked never a no-show.
    v_vals := v_vals || jsonb_build_object(
      'shows', public.cockpit_board_shows(shows, no_shows, due, v_src->'appointments'->>'note'),
      'noShows', CASE WHEN due IS NULL OR (due > 0 AND marked = 0) THEN jsonb_build_object('v', NULL, 'status', CASE WHEN due IS NULL THEN 'not_measured' ELSE 'not_filled_in' END)
                      ELSE jsonb_build_object('v', coalesce(no_shows, 0), 'status', NULL) END,
      'showRate', CASE
        WHEN due IS NULL THEN public.cockpit_board_cell('show_rate', NULL, t, NULL, NULL, NULL, 'not_measured', v_src->'appointments'->>'note')
        WHEN due = 0 THEN public.cockpit_board_cell('show_rate', NULL, t, 0, NULL, NULL, 'too_few', 'No meeting was due in this time frame.')
        WHEN marked = 0 THEN public.cockpit_board_cell('show_rate', NULL, t, 0, NULL, NULL, 'not_filled_in',
          format('None of the %s meeting%s due is marked showed or no-show.', due, CASE WHEN due = 1 THEN '' ELSE 's' END))
        ELSE public.cockpit_board_cell('show_rate', round(shows / marked * 100, 2), t, marked, shows, marked, NULL,
          format('%s of %s meetings due are marked.', marked, due)) END);

    -- Quotations and the quotation rate (of shows, only when the client recorded one).
    v_vals := v_vals || jsonb_build_object(
      'quotations', CASE WHEN quotes IS NULL THEN jsonb_build_object('v', NULL, 'status', v_quotes_status,
                           'note', coalesce(nullif(concat_ws(' ', v_src->'sheet_copy'->>'note', v_src->'outcomes'->>'note'), ''), 'The client does not record quotations.'))
                         ELSE public.cockpit_board_count(r.f_quotes, r.f_quotes_d, v_days) END,
      -- Meetings whose quotation was answered either way (given or not): known only where the source can tell.
      'quotationAnswers', public.cockpit_board_count(r.f_qa, r.f_qa_d, v_days, 'not_measured',
        CASE WHEN r.f_days IS NULL THEN NULL ELSE 'The client sheet copy keeps only Y, so answers cannot be counted.' END),
      'quotationRate', CASE
        WHEN quotes IS NULL OR quotes = 0 THEN public.cockpit_board_cell('quotation_rate', NULL, t, shows, quotes, shows, CASE WHEN quotes IS NULL THEN v_quotes_status ELSE 'not_filled_in' END,
          'No quotation is recorded in this time frame, so the rate is not known.')
        WHEN shows IS NULL THEN public.cockpit_board_cell('quotation_rate', NULL, t, NULL, quotes, NULL, 'not_filled_in', 'No meeting is marked showed, so the rate is not known.')
        WHEN shows = 0 THEN public.cockpit_board_cell('quotation_rate', NULL, t, 0, quotes, 0, 'too_few', 'No show in this time frame.')
        ELSE public.cockpit_board_cell('quotation_rate', round(quotes / shows * 100, 2), t, shows, quotes, shows) END);

    -- Closes, close rate, revenue, AOV, ROAS.
    v_vals := v_vals || jsonb_build_object(
      'closes', CASE WHEN closes IS NULL THEN jsonb_build_object('v', NULL, 'status', v_closes_status,
                       'note', coalesce(nullif(concat_ws(' ', v_src->'sheet'->>'note', v_src->'outcomes'->>'note'), ''), 'The client does not record closed deals.'))
                     ELSE public.cockpit_board_count(r.f_closes, r.f_closes_d, v_days, 'not_measured', NULL, jsonb_build_object('withValue', coalesce(valued, 0))) END,
      'closeRate', CASE
        WHEN closes IS NULL THEN public.cockpit_board_cell('close_rate', NULL, t, NULL, NULL, NULL, v_closes_status, 'The client does not record closed deals.')
        WHEN shows IS NULL THEN public.cockpit_board_cell('close_rate', NULL, t, NULL, closes, NULL, 'not_filled_in', 'No meeting is marked showed, so the rate is not known.')
        WHEN shows = 0 THEN public.cockpit_board_cell('close_rate', NULL, t, 0, closes, 0, 'too_few', 'No show in this time frame.')
        ELSE public.cockpit_board_cell('close_rate', round(closes / shows * 100, 2), t, shows, closes, shows) END,
      'revenue', CASE WHEN closes IS NULL THEN jsonb_build_object('v', NULL, 'status', v_closes_status, 'note', 'The client does not record closed deals.')
                      ELSE jsonb_build_object('v', round(revenue, 2), 'status', NULL)
                        || CASE WHEN v_rev_incomplete THEN jsonb_build_object('atLeast', true, 'note',
                             format('%s closed deal%s no value in a known currency, so revenue is at least this.',
                               greatest(coalesce(r.f_closes, 0) - coalesce(r.f_valued, 0), r.f_unpriced),
                               CASE WHEN greatest(coalesce(r.f_closes, 0) - coalesce(r.f_valued, 0), r.f_unpriced) = 1 THEN ' has' ELSE 's have' END))
                           ELSE '{}'::jsonb END END,
      'aov', CASE
        WHEN closes IS NULL THEN public.cockpit_board_cell('aov', NULL, t, NULL, NULL, NULL, v_closes_status, 'The client does not record closed deals.')
        WHEN valued > 0 THEN public.cockpit_board_cell('aov', round(revenue / valued, 2), t, valued, round(revenue, 2), valued, NULL,
          CASE WHEN v_rev_incomplete THEN 'Of the closed deals with a value in a known currency.' END)
        WHEN closes > 0 THEN public.cockpit_board_cell('aov', NULL, t, 0, NULL, NULL, 'not_measured', 'No closed deal carries a value in a known currency.')
        ELSE public.cockpit_board_cell('aov', NULL, t, 0, NULL, NULL, 'too_few', 'No closed deal in this time frame.') END);

    v_x := CASE WHEN v_spend > 0 AND revenue_ad IS NOT NULL THEN round(revenue_ad / v_spend, 2) END;
    v_vals := v_vals || jsonb_build_object('roas', CASE
      WHEN closes IS NULL THEN public.cockpit_board_cell('roas', NULL, t, NULL, NULL, NULL, v_closes_status, 'The client does not record closed deals.')
      WHEN NOT v_ad_ok THEN public.cockpit_board_cell('roas', NULL, t, NULL, NULL, NULL, 'not_measured', v_ad->'spend'->>'note')
      WHEN v_spend IS NULL OR v_spend = 0 THEN public.cockpit_board_cell('roas', NULL, t, NULL, revenue_ad, v_spend, 'not_measured', 'No ad spend in these days.')
      WHEN v_unpriced_spend THEN public.cockpit_board_cell('roas', NULL, t, NULL, revenue_ad, v_spend, 'not_measured',
        'Some spend is in a currency with no fixed USD rate, so ROAS is not known.')
      WHEN r.f_closes_ad > coalesce(r.f_valued_ad, 0) OR r.f_unpriced_ad > 0 THEN
        public.cockpit_board_cell('roas', v_x, t, NULL, revenue_ad, v_spend, public.cockpit_board_floor_status('roas', v_x, t),
          'A closed deal has no value in a known currency, so ROAS is at least this.', jsonb_build_object('atLeast', true))
      ELSE public.cockpit_board_cell('roas', v_x, t, NULL, revenue_ad, v_spend, NULL, 'Revenue by meeting day to yesterday, over the same days'' spend.') END);

    -- Lead quality: the portal's score, 1 to 10, averaged over rated meetings.
    v_vals := v_vals || jsonb_build_object('leadQuality', CASE
      WHEN lq_n IS NULL THEN public.cockpit_board_cell('lead_quality', NULL, t, NULL, NULL, NULL, v_lq_status,
        coalesce(v_src->'outcomes'->>'note', 'The client does not rate leads in the portal.'))
      WHEN lq_n = 0 THEN public.cockpit_board_cell('lead_quality', NULL, t, 0, NULL, NULL, 'too_few', 'No rated meeting in this time frame.')
      ELSE public.cockpit_board_cell('lead_quality', round(r.f_lq_sum / lq_n, 2), t, lq_n, round(r.f_lq_sum, 2), lq_n) END);

    -- No outcome as a share of the meetings due.
    v_vals := v_vals || jsonb_build_object('noOutcomeShare', CASE
      WHEN due IS NULL OR no_out IS NULL THEN public.cockpit_board_cell('no_outcome_share', NULL, t, NULL, NULL, NULL, 'not_measured', v_src->'appointments'->>'note')
      WHEN due = 0 THEN public.cockpit_board_cell('no_outcome_share', NULL, t, 0, 0, 0, 'too_few', 'No meeting was due in this time frame.')
      ELSE public.cockpit_board_cell('no_outcome_share', round(no_out / due * 100, 2), t, due, no_out, due) END);

    -- The call centre now: last 30 days, whatever the time frame.
    v_vals := v_vals || jsonb_build_object(
      'leadsTouched', CASE
        WHEN v_dwy THEN jsonb_build_object('v', NULL, 'status', 'not_measured', 'note', v_calls_note, 'clientCalls', true)
        WHEN NOT r.n_has THEN public.cockpit_board_cell('leads_touched', NULL, t, NULL, NULL, NULL, 'not_measured', 'The call centre figures have not been worked out yet.')
        WHEN r.n_share IS NULL THEN public.cockpit_board_cell('leads_touched', NULL, t, coalesce(r.n_callable, 0), r.n_touched, r.n_callable, 'too_few',
          coalesce(r.n_note, 'No lead from the last 30 days is old enough to judge yet.'))
        ELSE public.cockpit_board_cell('leads_touched', round(r.n_share * 100, 2), t, r.n_callable, r.n_touched, r.n_callable, NULL,
          concat_ws(' ', 'Last 30 days, as of ' || to_char(r.n_computed AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI') || ' Kuwait time.', r.n_note)) END,
      'untouchedLeads', CASE
        WHEN v_dwy THEN jsonb_build_object('v', NULL, 'status', 'not_measured', 'note', v_calls_note, 'clientCalls', true)
        WHEN NOT r.n_has THEN jsonb_build_object('v', NULL, 'status', 'not_measured', 'note', 'The call centre figures have not been worked out yet.')
        ELSE jsonb_build_object('v', r.n_untouched, 'status', NULL, 'oldestAt', r.n_oldest,
          'note', concat_ws(' ', 'Leads still waiting for a first call now.', r.n_note)) END,
      'firstCall', CASE
        WHEN v_dwy THEN jsonb_build_object('v', NULL, 'status', 'not_measured', 'note', v_calls_note, 'clientCalls', true)
        WHEN r.n_first IS NULL THEN public.cockpit_board_cell('first_call', NULL, t, NULL, NULL, NULL, 'not_measured',
          coalesce(r.n_note, 'No first call in the last 30 days.'))
        ELSE public.cockpit_board_cell('first_call', round(r.n_first / 60.0, 1), t, NULL, NULL, NULL, NULL,
          'Median first call in working minutes, last 30 days.') END);

    IF v_dwy THEN v_notes := v_notes || 'Done With You: the client calls its own leads.'::text; END IF;
    IF r.clickup_id IS NULL THEN v_notes := v_notes || 'No ClickUp card, so no lever can be filed for this client.'::text; END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'locationId', r.location_id, 'clickupId', r.clickup_id, 'clientName', r.client_name, 'status', r.status,
      'serviceMode', r.service_mode, 'clientCalls', v_dwy, 'tiktok', r.tiktok,
      'adAccounts', to_jsonb(coalesce(r.ad_account_ids, '{}'::text[])),
      'callers', r.c_callers,
      'noOutcome', (v_vals->'noOutcome'->>'v')::numeric,
      'noOutcomeOldestDays', (v_vals->'noOutcome'->>'oldestDays')::integer,
      'values', v_vals,
      'overrides', (SELECT coalesce(jsonb_object_agg(k, x->'client'), '{}'::jsonb) FROM jsonb_each(t) e(k, x) WHERE x->>'source' = 'client'),
      'levers', jsonb_build_object('open', r.l_open, 'reconcile', r.l_reconcile, 'lastAt', r.l_last),
      'computedAt', r.f_computed, 'adsFetchedAt', r.a_fetched,
      'sources', v_src,
      'notes', to_jsonb(v_notes)));
  END LOOP;
  RETURN v_out;
END $$;

-- ---------------------------------------------------------------------------
-- 5. The client page: the tree, the no-outcome list, the levers

/**
 * The client sheets' own attendance marks for one client, the facts' rule
 * (20261016111157 3.4a): the dialer's read of the sheet, same contact and
 * meeting time, one mark only. Nested loops off, as the dialer's report runs.
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_sheet_marks(p_location text, p_start timestamptz, p_end timestamptz)
RETURNS TABLE(contact_id text, meeting timestamptz, mark boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET enable_nestloop = off AS $$
  SELECT r.contact_id, r.meeting, bool_or(r.attendance = 'Y')
  FROM mahara_reporting.cc_results r
  WHERE r.location_id = p_location AND NOT r.conflict AND r.contact_id IS NOT NULL AND r.attendance IN ('Y', 'N')
    AND r.meeting >= p_start AND r.meeting < p_end
  GROUP BY r.contact_id, r.meeting
  HAVING count(DISTINCT r.attendance) = 1
$$;

/**
 * One client's appointments in the time frame, with the facts' attendance
 * rule (triage.js attendanceOf): the CRM status showed or noshow, else the
 * sheet mark (appointments.attended, else the dialer's sheet row on the same
 * contact and time), else the portal's attendance. no_outcome is the facts'
 * hasNoOutcome: no portal outcome at any revision and no sheet mark. Google
 * Calendar copies are left out. p_marks is cockpit_board_sheet_marks as json.
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_appointments(p_location text, p_from date, p_to date, p_marks jsonb)
RETURNS TABLE(id text, contact_id text, contact_name text, ad_id text, ghl_source text, calendar_name text, kind text,
  status text, booked_at timestamptz, start_at timestamptz, due boolean, attendance text, no_outcome boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH a AS (
    SELECT a.ghl_appointment_id AS id, a.ghl_contact_id AS contact_id, a.contact_name, nullif(btrim(a.ad_id), '') AS ad_id,
           a.ghl_source, cal.name AS calendar_name, public.cockpit_board_calendar_kind(cal.name) AS kind, a.status,
           a.booked_at, a.start_at, a.attended
    FROM public.appointments a
    LEFT JOIN LATERAL (
      SELECT c.name FROM public.ghl_calendars c WHERE c.calendar_id = a.calendar_id
      ORDER BY (c.location_id = p_location) DESC, c.synced_at DESC NULLS LAST LIMIT 1
    ) cal ON true
    WHERE coalesce(nullif(a.ghl_location_id, ''), nullif(a.ghl_location, '')) = p_location
      AND coalesce(a.ghl_source, '') <> 'google_calendar'
      AND ((a.booked_at >= p_from::timestamp AT TIME ZONE 'Asia/Kuwait' AND a.booked_at < (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait')
        OR (a.start_at >= p_from::timestamp AT TIME ZONE 'Asia/Kuwait' AND a.start_at < (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait'))
  ), marks AS (
    SELECT x->>'contact_id' AS contact_id, (x->>'meeting')::timestamptz AS meeting, (x->>'mark')::boolean AS mark
    FROM jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) x
  ), outc AS (
    SELECT DISTINCT ON (o.appointment_id) o.appointment_id, o.attendance
    FROM portal_data.appointment_outcomes o WHERE o.location_id = p_location
    ORDER BY o.appointment_id, o.revision DESC
  )
  SELECT a.id, a.contact_id, a.contact_name, a.ad_id, a.ghl_source, a.calendar_name, a.kind, a.status, a.booked_at, a.start_at,
    (a.kind IN ('main', 'online', 'provisional') AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid')
      AND a.start_at >= p_from::timestamp AT TIME ZONE 'Asia/Kuwait' AND a.start_at < (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait'
      AND a.start_at <= now()) AS due,
    CASE WHEN a.status = 'showed' THEN 'showed' WHEN a.status = 'noshow' THEN 'noshow'
         WHEN coalesce(a.attended, sm.mark) IS TRUE OR o.attendance = 'showed' THEN 'showed'
         WHEN coalesce(a.attended, sm.mark) IS FALSE OR o.attendance = 'no_show' THEN 'noshow' ELSE 'unknown' END,
    (o.appointment_id IS NULL AND coalesce(a.attended, sm.mark) IS NULL)
  FROM a
  LEFT JOIN outc o ON o.appointment_id = a.id
  LEFT JOIN marks sm ON sm.contact_id = a.contact_id AND sm.meeting = a.start_at
$$;

/** The sheet marks as json, or NULL when the dialer's sheet read fails (the caller says so). */
CREATE OR REPLACE FUNCTION public.cockpit_board_marks_json(p_location text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('contact_id', m.contact_id, 'meeting', m.meeting, 'mark', m.mark)), '[]'::jsonb)
  INTO v FROM public.cockpit_board_sheet_marks(p_location, p_from::timestamp AT TIME ZONE 'Asia/Kuwait',
    (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait') m;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

/**
 * The appointments of one client that were due in the time frame and still
 * have no outcome, oldest first: the meeting's Kuwait day and time, its
 * calendar, the lead's first name only, the ad when known, who booked it when
 * known (the dialer's caller who verified the booking, else how GoHighLevel
 * says it was made), days since, and the GoHighLevel contact.
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_no_outcome_list(p_location text, p_from date, p_to date, p_marks jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH ap AS (
    SELECT * FROM public.cockpit_board_appointments(p_location, p_from, p_to, p_marks) a WHERE a.due AND a.no_outcome
  ), bookers AS (
    SELECT coalesce(c.data->'bookingVerification'->>'id', c.appointment_id) AS id,
           CASE WHEN count(DISTINCT c.agent) = 1 THEN min(c.agent) END AS agent
    FROM mahara_reporting.cc_attempts c
    WHERE c.location_id = p_location AND c.data->'disposition'->>'outcome' = 'BOOKED'
      AND c.data->'bookingVerification'->>'verifiedAt' IS NOT NULL
    GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'appointmentId', a.id,
      'meetingAt', a.start_at,
      'meetingDay', to_char(a.start_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD'),
      'meetingTime', to_char(a.start_at AT TIME ZONE 'Asia/Kuwait', 'HH24:MI'),
      'calendar', a.kind,
      'calendarName', a.calendar_name,
      'crmStatus', a.status,
      'firstName', (regexp_match(btrim(coalesce(nullif(btrim(a.contact_name), ''), cl.contact_name, '')), '^[^[:space:]]+'))[1],
      'adId', coalesce(a.ad_id, nullif(btrim(cl.ad_id), '')),
      'adName', an.ad_name,
      'bookedBy', CASE
        WHEN b.agent IS NOT NULL THEN jsonb_build_object('name', coalesce(pp.name, b.agent), 'how', 'The call centre')
        WHEN a.ghl_source = 'booking_widget' THEN jsonb_build_object('name', 'The lead', 'how', 'The booking page')
        WHEN a.ghl_source = 'conversations_ai' THEN jsonb_build_object('name', 'The AI assistant', 'how', 'A GoHighLevel conversation')
        WHEN a.ghl_source IN ('calendar_page', 'contactdetails_page', 'opportunity_page') THEN
          jsonb_build_object('name', 'Someone in GoHighLevel', 'how', 'Booked by hand in GoHighLevel') END,
      'daysSince', (now() AT TIME ZONE 'Asia/Kuwait')::date - (a.start_at AT TIME ZONE 'Asia/Kuwait')::date,
      'contactUrl', CASE WHEN p_location ~ '^[A-Za-z0-9_-]{1,64}$' AND coalesce(a.contact_id, '') ~ '^[A-Za-z0-9_-]{1,64}$'
        THEN 'https://app.gohighlevel.com/v2/location/' || p_location || '/contacts/detail/' || a.contact_id END
    ) ORDER BY a.start_at, a.id), '[]'::jsonb)
  FROM ap a
  LEFT JOIN LATERAL (SELECT l.contact_name, l.ad_id FROM public.client_leads l
                     WHERE l.ghl_contact_id = a.contact_id AND l.location_id = p_location LIMIT 1) cl ON true
  LEFT JOIN LATERAL (SELECT m.ad_name FROM public.cockpit_meta_ad_days m
                     WHERE m.ad_id = coalesce(a.ad_id, nullif(btrim(cl.ad_id), '')) AND m.ad_name IS NOT NULL
                     ORDER BY m.day DESC LIMIT 1) an ON true
  LEFT JOIN bookers b ON b.id = a.id
  LEFT JOIN LATERAL (SELECT nullif(btrim(p.name), '') AS name FROM public.cockpit_people p WHERE lower(btrim(p.email)) = b.agent
                     ORDER BY p.active DESC, p.id DESC LIMIT 1) pp ON b.agent IS NOT NULL
$$;

/**
 * One client's campaigns > ad sets > ads in the time frame (ad days to
 * yesterday on the account's clock), each with the ad columns and the CRM
 * leads, confirmed bookings and shows that carry its ad id; ads with CRM rows
 * but no spend in the time frame are listed too. CRM rows whose ad is not in
 * the Meta store, and those with no ad at all, are counted apart.
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_tree(p_location text, p_accounts text[], p_from date, p_to date,
  p_targets jsonb, p_marks jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_start timestamptz := p_from::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_end timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_ad_end timestamptz := least(p_to + 1, v_today)::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_out jsonb;
BEGIN
  WITH m AS (
    SELECT x.* FROM public.cockpit_meta_ad_days x
    WHERE x.account_id = ANY(coalesce(p_accounts, '{}'::text[])) AND x.day BETWEEN p_from AND p_to
      AND x.day < (now() AT TIME ZONE coalesce(x.account_timezone, 'Asia/Kuwait'))::date
  ), names AS (
    SELECT DISTINCT ON (x.ad_id) x.ad_id, x.ad_name, x.adset_id, x.adset_name, x.campaign_id, x.campaign_name, x.objective,
      x.destination_type, x.account_id
    FROM public.cockpit_meta_ad_days x
    WHERE x.account_id = ANY(coalesce(p_accounts, '{}'::text[]))
    ORDER BY x.ad_id, x.day DESC
  ), ap AS (
    SELECT * FROM public.cockpit_board_appointments(p_location, p_from, p_to, p_marks)
  ), crm AS (
    SELECT k.ad_id, sum(k.leads) AS leads, sum(k.bookings) AS bookings, sum(k.bookings_ad) AS bookings_ad, sum(k.shows) AS shows,
      sum(k.no_shows) AS no_shows, sum(k.due) AS due
    FROM (
      SELECT nullif(btrim(l.ad_id), '') AS ad_id, 1 AS leads, 0 AS bookings, 0 AS bookings_ad, 0 AS shows, 0 AS no_shows, 0 AS due
      FROM public.client_leads l
      LEFT JOIN mahara_reporting.facts f ON f.namespace = 'production' AND f.source = 'ghl' AND f.kind = 'contact'
        AND f.external_id = l.location_id || ':' || l.ghl_contact_id
      WHERE l.location_id = p_location AND NOT coalesce(l.deleted, false) AND l.created_at >= v_start AND l.created_at < v_end
        -- A WhatsApp chat (no ad, no campaign, tagged inbound whatsapp) is not a lead, as in the facts' CRM leads.
        AND NOT (nullif(l.ad_id, '') IS NULL AND nullif(l.campaign_id, '') IS NULL
                 AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.data->'tags') = 'array'
                              THEN f.data->'tags' ELSE '[]'::jsonb END) tg(x) WHERE lower(btrim(tg.x)) = 'inbound whatsapp'))
      UNION ALL
      SELECT a.ad_id, 0, 1, CASE WHEN a.booked_at < v_ad_end THEN 1 ELSE 0 END, 0, 0, 0 FROM ap a
      WHERE a.kind IN ('main', 'online') AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid')
        AND a.booked_at >= v_start AND a.booked_at < v_end
      UNION ALL
      -- Every meeting due, and its mark: unmarked is never a no-show.
      SELECT a.ad_id, 0, 0, 0, (a.attendance = 'showed')::int, (a.attendance = 'noshow')::int, 1 FROM ap a WHERE a.due
    ) k
    GROUP BY k.ad_id
  ), per_ad AS (
    SELECT n.ad_id, n.adset_id, n.campaign_id,
      count(m.ad_id) AS rows, sum(m.spend_usd) AS spend, count(*) FILTER (WHERE m.spend IS NOT NULL AND m.spend_usd IS NULL) AS unpriced,
      sum(m.impressions) AS imp, sum(m.link_clicks) AS clicks,
      count(*) FILTER (WHERE m.leads IS NOT NULL) AS lead_rows, sum(m.leads) AS leads,
      sum(m.spend_usd) FILTER (WHERE m.leads IS NOT NULL) AS lead_spend, sum(m.link_clicks) FILTER (WHERE m.leads IS NOT NULL) AS lead_clicks,
      count(*) FILTER (WHERE m.video_3s IS NOT NULL) AS video_rows, sum(m.impressions) FILTER (WHERE m.video_3s IS NOT NULL) AS video_imp,
      sum(m.video_3s) AS v3, sum(m.thruplays) FILTER (WHERE m.video_3s IS NOT NULL) AS thru,
      sum(m.video_plays) AS plays, sum(m.video_p25) FILTER (WHERE m.video_plays IS NOT NULL) AS p25,
      sum(m.video_p50) FILTER (WHERE m.video_plays IS NOT NULL) AS p50, sum(m.video_p75) FILTER (WHERE m.video_plays IS NOT NULL) AS p75,
      sum(m.video_p100) FILTER (WHERE m.video_plays IS NOT NULL) AS p100,
      sum(m.impressions * m.frequency) FILTER (WHERE m.frequency > 0) AS freq_w, sum(m.impressions) FILTER (WHERE m.frequency > 0) AS freq_imp,
      coalesce(c.leads, 0) AS crm_leads, coalesce(c.bookings, 0) AS crm_bookings, coalesce(c.bookings_ad, 0) AS crm_bookings_ad,
      coalesce(c.shows, 0) AS crm_shows, coalesce(c.no_shows, 0) AS crm_no_shows, coalesce(c.due, 0) AS crm_due
    FROM names n
    LEFT JOIN m ON m.ad_id = n.ad_id
    LEFT JOIN crm c ON c.ad_id = n.ad_id
    WHERE EXISTS (SELECT 1 FROM m m2 WHERE m2.ad_id = n.ad_id) OR c.ad_id IS NOT NULL
    GROUP BY n.ad_id, n.adset_id, n.campaign_id, c.leads, c.bookings, c.bookings_ad, c.shows, c.no_shows, c.due
  ), lvl AS (
    SELECT 'ad'::text AS level, a.ad_id AS key, a.adset_id, a.campaign_id, to_jsonb(a) - 'ad_id' - 'adset_id' - 'campaign_id' AS s
    FROM per_ad a
    UNION ALL
    SELECT 'adset', x.adset_id, x.adset_id, x.campaign_id, to_jsonb(x) - 'adset_id' - 'campaign_id'
    FROM (SELECT a.adset_id, min(a.campaign_id) AS campaign_id, sum(a.rows) AS rows, sum(a.spend) AS spend, sum(a.unpriced) AS unpriced,
            sum(a.imp) AS imp, sum(a.clicks) AS clicks, sum(a.lead_rows) AS lead_rows, sum(a.leads) AS leads, sum(a.lead_spend) AS lead_spend,
            sum(a.lead_clicks) AS lead_clicks, sum(a.video_rows) AS video_rows, sum(a.video_imp) AS video_imp, sum(a.v3) AS v3, sum(a.thru) AS thru,
            sum(a.plays) AS plays, sum(a.p25) AS p25, sum(a.p50) AS p50, sum(a.p75) AS p75, sum(a.p100) AS p100,
            sum(a.freq_w) AS freq_w, sum(a.freq_imp) AS freq_imp, sum(a.crm_leads) AS crm_leads, sum(a.crm_bookings) AS crm_bookings,
            sum(a.crm_bookings_ad) AS crm_bookings_ad, sum(a.crm_shows) AS crm_shows, sum(a.crm_no_shows) AS crm_no_shows,
            sum(a.crm_due) AS crm_due
          FROM per_ad a GROUP BY a.adset_id) x
    UNION ALL
    SELECT 'campaign', x.campaign_id, NULL, x.campaign_id, to_jsonb(x) - 'campaign_id'
    FROM (SELECT a.campaign_id, sum(a.rows) AS rows, sum(a.spend) AS spend, sum(a.unpriced) AS unpriced,
            sum(a.imp) AS imp, sum(a.clicks) AS clicks, sum(a.lead_rows) AS lead_rows, sum(a.leads) AS leads, sum(a.lead_spend) AS lead_spend,
            sum(a.lead_clicks) AS lead_clicks, sum(a.video_rows) AS video_rows, sum(a.video_imp) AS video_imp, sum(a.v3) AS v3, sum(a.thru) AS thru,
            sum(a.plays) AS plays, sum(a.p25) AS p25, sum(a.p50) AS p50, sum(a.p75) AS p75, sum(a.p100) AS p100,
            sum(a.freq_w) AS freq_w, sum(a.freq_imp) AS freq_imp, sum(a.crm_leads) AS crm_leads, sum(a.crm_bookings) AS crm_bookings,
            sum(a.crm_bookings_ad) AS crm_bookings_ad, sum(a.crm_shows) AS crm_shows, sum(a.crm_no_shows) AS crm_no_shows,
            sum(a.crm_due) AS crm_due
          FROM per_ad a GROUP BY a.campaign_id) x
  ), reach AS (
    SELECT DISTINCT ON (x.level, x.key) x.level, x.key, jsonb_build_object('reach', x.reach, 'impressions', x.impressions, 'note', x.note) AS j
    FROM public.cockpit_meta_reach x
    JOIN public.cockpit_meta_reach_windows(v_today) w ON w.window_key = x.window_key AND w.from_day = x.from_day AND w.to_day = x.to_day
    WHERE x.level IN ('campaign', 'adset', 'ad') AND w.from_day = p_from AND w.to_day = p_to
    ORDER BY x.level, x.key, (x.reach IS NOT NULL) DESC
  ), node AS (
    SELECT l.level, l.key, l.adset_id, l.campaign_id, (l.s->>'spend')::numeric AS spend,
      public.cockpit_board_ad_cells(l.s, p_targets, rr.j)
      || jsonb_build_object(
        'crmLeads', jsonb_build_object('v', (l.s->>'crm_leads')::numeric, 'status', NULL),
        'confirmedBookings', jsonb_build_object('v', (l.s->>'crm_bookings')::numeric, 'status', NULL),
        'shows', public.cockpit_board_shows((l.s->>'crm_shows')::numeric, (l.s->>'crm_no_shows')::numeric, (l.s->>'crm_due')::numeric),
        'costPerBooking', CASE
          WHEN (l.s->>'crm_bookings_ad')::numeric > 0 AND (l.s->>'spend') IS NOT NULL THEN
            public.cockpit_board_cell('cost_per_booking', round((l.s->>'spend')::numeric / (l.s->>'crm_bookings_ad')::numeric, 2), p_targets,
              (l.s->>'crm_bookings_ad')::numeric, round((l.s->>'spend')::numeric, 2), (l.s->>'crm_bookings_ad')::numeric, NULL,
              'Confirmed bookings with this ad id to yesterday, the same days as spend.')
          WHEN coalesce((l.s->>'spend')::numeric, 0) > 0 THEN
            public.cockpit_board_cell('cost_per_booking', NULL, p_targets, 0, round((l.s->>'spend')::numeric, 2), 0,
              public.cockpit_board_floor_status('cost_per_booking', round((l.s->>'spend')::numeric, 2), p_targets),
              'No confirmed booking with this ad id yet.', jsonb_build_object('atLeast', round((l.s->>'spend')::numeric, 2)))
          ELSE public.cockpit_board_cell('cost_per_booking', NULL, p_targets, 0, NULL, NULL, 'too_few', 'No spend in these days.') END) AS metrics
    FROM lvl l LEFT JOIN reach rr ON rr.level = l.level AND rr.key = l.key
  ), ads AS (
    SELECT n.adset_id, jsonb_agg(jsonb_build_object('id', n.key, 'name', nm.ad_name, 'metrics', n.metrics)
             ORDER BY n.spend DESC NULLS LAST, nm.ad_name, n.key) AS j
    FROM node n JOIN names nm ON nm.ad_id = n.key WHERE n.level = 'ad' GROUP BY n.adset_id
  ), sets AS (
    SELECT n.campaign_id, jsonb_agg(jsonb_build_object('id', n.key, 'name', sn.adset_name, 'destination', sn.destination_type,
             'metrics', n.metrics, 'ads', coalesce(ads.j, '[]'::jsonb)) ORDER BY n.spend DESC NULLS LAST, sn.adset_name, n.key) AS j
    FROM node n
    LEFT JOIN LATERAL (SELECT x.adset_name, x.destination_type FROM names x WHERE x.adset_id = n.key LIMIT 1) sn ON true
    LEFT JOIN ads ON ads.adset_id = n.key
    WHERE n.level = 'adset' GROUP BY n.campaign_id
  ), camps AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', n.key, 'name', cn.campaign_name, 'objective', cn.objective, 'accountId', cn.account_id,
             'metrics', n.metrics, 'adsets', coalesce(sets.j, '[]'::jsonb)) ORDER BY n.spend DESC NULLS LAST, cn.campaign_name, n.key), '[]'::jsonb) AS j
    FROM node n
    LEFT JOIN LATERAL (SELECT x.campaign_name, x.objective, x.account_id FROM names x WHERE x.campaign_id = n.key LIMIT 1) cn ON true
    LEFT JOIN sets ON sets.campaign_id = n.key
    WHERE n.level = 'campaign'
  ), stray AS (
    SELECT
      coalesce(jsonb_agg(jsonb_build_object('adId', c.ad_id, 'crmLeads', c.leads, 'confirmedBookings', c.bookings,
          'shows', public.cockpit_board_shows(c.shows, c.no_shows, c.due))
        ORDER BY c.leads DESC, c.ad_id) FILTER (WHERE c.ad_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM names n WHERE n.ad_id = c.ad_id))
        , '[]'::jsonb) AS not_in_store,
      jsonb_build_object('crmLeads', coalesce(sum(c.leads) FILTER (WHERE c.ad_id IS NULL), 0),
        'confirmedBookings', coalesce(sum(c.bookings) FILTER (WHERE c.ad_id IS NULL), 0),
        'shows', public.cockpit_board_shows(coalesce(sum(c.shows) FILTER (WHERE c.ad_id IS NULL), 0),
          coalesce(sum(c.no_shows) FILTER (WHERE c.ad_id IS NULL), 0), coalesce(sum(c.due) FILTER (WHERE c.ad_id IS NULL), 0))) AS no_ad
    FROM crm c
  )
  SELECT jsonb_build_object('campaigns', camps.j, 'notInStore', stray.not_in_store, 'noAd', stray.no_ad)
  INTO v_out FROM camps, stray;
  RETURN v_out;
END $$;

/** One lever as the board shows it. */
CREATE OR REPLACE FUNCTION public.cockpit_board_lever_json(l public.cockpit_board_levers)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', l.id, 'locationId', l.location_id, 'clickupId', l.clickup_id, 'clientName', l.client_name,
    'metric', l.metric, 'lever', l.lever, 'department', l.owner_department, 'note', l.note, 'evidence', l.evidence,
    'status', l.status, 'clickupTaskId', l.clickup_task_id, 'clickupUrl', l.clickup_url, 'error', l.error,
    'createdBy', l.created_by,
    'createdByName', (SELECT nullif(btrim(p.name), '') FROM public.cockpit_people p WHERE lower(btrim(p.email)) = lower(btrim(l.created_by))
                      ORDER BY p.active DESC, p.id DESC LIMIT 1),
    'createdAt', l.created_at, 'finishedAt', l.finished_at, 'meetingId', l.meeting_id)
$$;

-- ---------------------------------------------------------------------------
-- 6. The reads (any active seat; each client through cockpit_client_allowed)

/**
 * The whole board for a time frame (Kuwait days p_from..p_to, at most 366,
 * up to today): every client row the seat may see, the targets, the data
 * stamps and plain sentences for what is missing.
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_read(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_meta jsonb;
  v_rows jsonb;
  v_facts record;
  v_notes text[] := '{}';
  v_hourly jsonb;
  v_whole boolean;
BEGIN
  IF NOT coalesce(public.cockpit_has_active_seat(), false) THEN
    RAISE EXCEPTION 'Sign in with an active cockpit seat to see the Client Performance board.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.cockpit_board_check_window(p_from, p_to);
  -- Ad accounts tied to no client, and the Meta jobs' own notes, name other
  -- clients' accounts: only the CEO, admins and seats not limited to some
  -- clients see them (cockpit_client_allowed's rule for the whole board).
  v_whole := coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false)
    OR EXISTS (SELECT 1 FROM public.cockpit_members cm JOIN auth.users au ON au.id = cm.auth_user_id
               WHERE cm.auth_user_id = auth.uid() AND cm.active AND au.email_confirmed_at IS NOT NULL
                 AND cm.email = lower(btrim(au.email)) AND cardinality(coalesce(cm.clients, '{}'::text[])) = 0);
  v_meta := public.cockpit_meta_ad_days_status();
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'clientName', x->>'locationId'), '[]'::jsonb) INTO v_rows
  FROM jsonb_array_elements(public.cockpit_board_rows(p_from, p_to, NULL, v_meta)) x
  WHERE public.cockpit_client_allowed(x->>'clientName');

  SELECT s.last_run_at, s.last_ok_at, s.ok, s.note INTO v_facts FROM public.cockpit_sync_state s WHERE s.key = 'board-facts';
  IF v_facts.last_run_at IS NULL THEN
    v_notes := v_notes || 'The client facts have not been worked out yet, so the business columns are empty.'::text;
  ELSIF v_facts.last_run_at < now() - interval '2 hours' THEN
    v_notes := v_notes || format('The client facts last refreshed %s Kuwait time; they refresh every 30 minutes.',
      to_char(v_facts.last_run_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'));
  END IF;
  IF v_facts.ok IS FALSE THEN
    v_notes := v_notes || coalesce(v_facts.note, 'The last client facts refresh could not read every source.');
  END IF;
  v_hourly := v_meta->'jobs'->'hourly';
  IF coalesce((v_meta->'store'->>'rows')::bigint, 0) = 0 THEN
    v_notes := v_notes || 'The Meta ad store has no rows yet, so the ad columns are empty.'::text;
  ELSIF v_hourly IS NULL OR (v_hourly->>'startedAt')::timestamptz < now() - interval '3 hours' THEN
    v_notes := v_notes || format('Meta was last read %s Kuwait time; it is read every hour.',
      coalesce(to_char((v_meta->'store'->>'lastFetchedAt')::timestamptz AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'), 'at an unknown time'));
  ELSIF v_hourly->>'state' IN ('failed', 'partial') THEN
    v_notes := v_notes || CASE WHEN v_whole THEN coalesce(v_hourly->>'note', 'The last Meta read did not finish every ad account.')
                               ELSE 'The last Meta read did not finish every ad account.' END;
  END IF;

  RETURN jsonb_build_object(
    'version', 1,
    'from', p_from, 'to', p_to, 'today', v_today, 'days', p_to - p_from + 1,
    'adWindow', jsonb_build_object('from', p_from, 'to', least(p_to, v_today - 1),
      'note', 'Ad numbers end yesterday on each ad account''s own clock (most are Kuwait or Riyadh time); today is not in yet. The business numbers run to the end of the time frame on Kuwait time.'),
    'generatedAt', now(),
    'targets', public.cockpit_board_targets_map(NULL),
    'canEditTargets', coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false),
    'clients', v_rows,
    'notLinked', CASE WHEN v_whole THEN coalesce(v_meta->'notLinked', '[]'::jsonb) ELSE '[]'::jsonb END,
    'freshness', jsonb_build_object(
      'facts', jsonb_build_object('lastRunAt', v_facts.last_run_at, 'lastOkAt', v_facts.last_ok_at, 'ok', v_facts.ok, 'note', v_facts.note),
      'meta', jsonb_build_object('lastFetchedAt', v_meta->'store'->'lastFetchedAt', 'firstDay', v_meta->'store'->'firstDay',
        'lastDay', v_meta->'store'->'lastDay',
        'hourly', CASE WHEN v_whole THEN v_hourly ELSE v_hourly - 'note' END,
        'nightly', CASE WHEN v_whole THEN v_meta->'jobs'->'nightly' ELSE (v_meta->'jobs'->'nightly') - 'note' END,
        'note', CASE WHEN NOT v_whole AND (v_hourly->>'state' IN ('failed', 'partial') OR v_meta->'jobs'->'nightly'->>'state' IN ('failed', 'partial'))
                     THEN 'The last Meta read did not finish every ad account.' END)),
    'notes', to_jsonb(v_notes));
END $$;

/**
 * One client for a time frame: its board row, its campaigns > ad sets > ads
 * with CRM leads, bookings and shows per ad id, the appointments due with no
 * outcome (live), and its levers.
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_client(p_location text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  c public.cockpit_board_clients;
  v_meta jsonb;
  v_row jsonb;
  t jsonb;
  v_marks jsonb;
  v_tree jsonb;
  v_list jsonb;
  v_levers jsonb;
  v_board numeric;
  v_live integer;
  v_check text;
  v_facts_at timestamptz;
BEGIN
  IF NOT coalesce(public.cockpit_has_active_seat(), false) THEN
    RAISE EXCEPTION 'Sign in with an active cockpit seat to see the Client Performance board.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.cockpit_board_check_window(p_from, p_to);
  SELECT * INTO c FROM public.cockpit_board_clients b WHERE b.location_id = p_location;
  IF c.location_id IS NULL OR NOT coalesce(public.cockpit_client_allowed(c.client_name), false) THEN
    RAISE EXCEPTION 'This client is not on your board.' USING ERRCODE = '42501';
  END IF;
  v_meta := public.cockpit_meta_ad_days_status();
  v_row := public.cockpit_board_rows(p_from, p_to, c.location_id, v_meta)->0;
  t := public.cockpit_board_targets_map(c.clickup_id);
  v_marks := public.cockpit_board_marks_json(c.location_id, p_from, p_to);
  v_tree := public.cockpit_board_tree(c.location_id, c.ad_account_ids, p_from, p_to, t, v_marks);
  v_list := public.cockpit_board_no_outcome_list(c.location_id, p_from, p_to, v_marks);
  SELECT coalesce(jsonb_agg(public.cockpit_board_lever_json(l) ORDER BY l.created_at DESC), '[]'::jsonb) INTO v_levers
  FROM (SELECT * FROM public.cockpit_board_levers x WHERE x.location_id = c.location_id ORDER BY x.created_at DESC LIMIT 50) l;

  v_board := (v_row->>'noOutcome')::numeric;
  v_live := jsonb_array_length(v_list);
  v_facts_at := (v_row->>'computedAt')::timestamptz;
  v_check := concat_ws(' ',
    CASE WHEN v_marks IS NULL THEN 'The client sheet''s marks could not be read just now, so a meeting marked only in the sheet may be listed.' END,
    CASE WHEN v_board IS NOT NULL AND v_live < v_board THEN format('%s of the board''s %s ha%s been marked since the board''s figures were worked out at %s Kuwait time.',
           v_board - v_live, v_board, CASE WHEN v_board - v_live = 1 THEN 's' ELSE 've' END, to_char(v_facts_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'))
         WHEN v_board IS NOT NULL AND v_live > v_board THEN format('%s more than the board''s %s: the board''s figures were worked out at %s Kuwait time.',
           v_live - v_board, v_board, to_char(v_facts_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI')) END);

  RETURN jsonb_build_object(
    'version', 1,
    'from', p_from, 'to', p_to, 'today', v_today,
    'adWindow', jsonb_build_object('from', p_from, 'to', least(p_to, v_today - 1),
      'note', 'Ad numbers end yesterday on each ad account''s own clock; CRM leads, bookings and shows per ad run to the end of the time frame.'),
    'generatedAt', now(),
    'client', v_row,
    'clientName', c.client_name, 'locationId', c.location_id, 'clickupId', c.clickup_id, 'status', c.status,
    'targets', t,
    'campaigns', coalesce(v_tree->'campaigns', '[]'::jsonb),
    'notInStore', coalesce(v_tree->'notInStore', '[]'::jsonb),
    'noAd', v_tree->'noAd',
    'noOutcomeAppointments', v_list,
    'noOutcomeCheck', jsonb_build_object('board', v_board, 'live', v_live, 'note', nullif(v_check, '')),
    'levers', v_levers,
    'canEditTargets', coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false));
END $$;

-- ---------------------------------------------------------------------------
-- 7. Targets: the CEO and admins

/**
 * Save or remove one target override. p_scope 'defaults' (the whole board) or
 * 'client:<ClickUp id>'; p_good and p_watch both NULL removes the override (back
 * to the board's, then the official, target). The watch line sits on the worse
 * side of the good line, or is empty (short of good is then a watch).
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_targets_save(p_scope text, p_metric text, p_good numeric, p_watch numeric,
  p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email text;
  d record;
  v_clickup text;
BEGIN
  IF NOT (coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false)) THEN
    RAISE EXCEPTION 'Only the CEO and admins change the board''s targets.' USING ERRCODE = '42501';
  END IF;
  SELECT cm.email INTO v_email FROM public.cockpit_members cm JOIN auth.users au ON au.id = cm.auth_user_id
  WHERE cm.auth_user_id = auth.uid() AND cm.active AND au.email_confirmed_at IS NOT NULL
  ORDER BY cm.email LIMIT 1;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Only the CEO and admins change the board''s targets.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM public.cockpit_board_default_targets() x WHERE x.metric = p_metric;
  IF d.metric IS NULL THEN
    RAISE EXCEPTION 'Choose one of the board''s targets.' USING ERRCODE = '22023';
  END IF;
  IF p_scope IS NULL OR NOT (p_scope = 'defaults' OR p_scope ~ '^client:[A-Za-z0-9_-]{1,40}$') THEN
    RAISE EXCEPTION 'Choose the whole board or one client.' USING ERRCODE = '22023';
  END IF;
  IF p_scope <> 'defaults' THEN
    v_clickup := substr(p_scope, 8);
    IF NOT EXISTS (SELECT 1 FROM public.cockpit_board_clients b WHERE b.clickup_id = v_clickup) THEN
      RAISE EXCEPTION 'That client is not on the board.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 300 THEN
    RAISE EXCEPTION 'Keep the note to 300 characters.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.set_config('cockpit.board_actor', v_email, true);

  IF p_good IS NULL AND p_watch IS NULL THEN
    DELETE FROM public.cockpit_board_targets x WHERE x.scope_key = p_scope AND x.metric = p_metric;
  ELSE
    IF p_good IS NULL THEN
      RAISE EXCEPTION 'Set the good line, or leave both lines empty to go back to the official target.' USING ERRCODE = '22023';
    END IF;
    IF p_good < 0 OR coalesce(p_watch, 0) < 0 OR p_good >= 1000000000 OR coalesce(p_watch, 0) >= 1000000000
       OR (d.unit = 'percent' AND (p_good > 100 OR coalesce(p_watch, 0) > 100)) THEN
      RAISE EXCEPTION 'Use a number from 0%.', CASE WHEN d.unit = 'percent' THEN ' to 100' ELSE '' END USING ERRCODE = '22023';
    END IF;
    IF p_watch IS NOT NULL AND ((d.direction = 'higher' AND p_watch > p_good) OR (d.direction = 'lower' AND p_watch < p_good)) THEN
      RAISE EXCEPTION '%: % is better, so the watch line must be % the good line.', d.label,
        CASE WHEN d.direction = 'higher' THEN 'higher' ELSE 'lower' END,
        CASE WHEN d.direction = 'higher' THEN 'at or below' ELSE 'at or above' END USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.cockpit_board_targets AS x (scope_key, metric, good, watch, direction, note, updated_by, updated_at)
    VALUES (p_scope, p_metric, p_good, p_watch, d.direction, nullif(btrim(p_note), ''), v_email, now())
    ON CONFLICT (scope_key, metric) DO UPDATE SET good = EXCLUDED.good, watch = EXCLUDED.watch, direction = EXCLUDED.direction,
      note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
  END IF;
  RETURN jsonb_build_object('ok', true, 'scope', p_scope, 'metric', p_metric,
    'target', public.cockpit_board_targets_map(v_clickup)->p_metric);
END $$;

-- ---------------------------------------------------------------------------
-- 8. Levers: the gate for the Edge Function, then the row (service role)

/**
 * The lever gate, called by cockpit-board-api as the signed-in seat: any
 * active seat, the client through cockpit_client_allowed, a ClickUp card on
 * the client. Returns the context the function files from, with the metric's
 * value over the time frame (default the last 30 days) as the evidence.
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_lever_context(p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_email text;
  c public.cockpit_board_clients;
  d record;
  v_metric text := p_args->>'metric';
  v_lever text := btrim(coalesce(p_args->>'lever', ''));
  v_dep text := p_args->>'department';
  v_note text := nullif(btrim(coalesce(p_args->>'note', '')), '');
  v_meeting text := nullif(btrim(coalesce(p_args->>'meetingId', '')), '');
  v_from date;
  v_to date;
  v_row jsonb;
  v_cell jsonb;
  v_t jsonb;
  v_evidence text;
BEGIN
  IF NOT coalesce(public.cockpit_has_active_seat(), false) THEN
    RAISE EXCEPTION 'Sign in with an active cockpit seat to add a lever.' USING ERRCODE = '42501';
  END IF;
  SELECT cm.email INTO v_email FROM public.cockpit_members cm JOIN auth.users au ON au.id = cm.auth_user_id
  WHERE cm.auth_user_id = auth.uid() AND cm.active AND au.email_confirmed_at IS NOT NULL ORDER BY cm.email LIMIT 1;
  IF jsonb_typeof(p_args) IS DISTINCT FROM 'object'
     OR p_args - ARRAY['locationId', 'metric', 'lever', 'department', 'note', 'meetingId', 'from', 'to'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Send the client, the metric, the lever and the department that owns it.' USING ERRCODE = '22023';
  END IF;
  IF length(v_lever) < 3 OR length(v_lever) > 200 THEN
    RAISE EXCEPTION 'Write the lever in 3 to 200 characters.' USING ERRCODE = '22023';
  END IF;
  IF v_dep IS NULL OR v_dep NOT IN ('creative', 'tech', 'client_success', 'call_center', 'media_buyer') THEN
    RAISE EXCEPTION 'Choose the department that owns the lever: creative, tech, client success, call centre or media buyer.' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN
    RAISE EXCEPTION 'Keep the note to 1,000 characters.' USING ERRCODE = '22023';
  END IF;
  IF v_meeting IS NOT NULL AND v_meeting !~ '^[A-Za-z0-9_-]{1,80}$' THEN
    RAISE EXCEPTION 'That meeting is not known.' USING ERRCODE = '22023';
  END IF;
  IF v_meeting IS NOT NULL AND to_regclass('public.team_meetings') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.team_meetings m WHERE m.id = v_meeting) THEN
      RAISE EXCEPTION 'That meeting is not known.' USING ERRCODE = '22023';
    END IF;
  END IF;
  SELECT * INTO d FROM public.cockpit_board_default_targets() x WHERE x.metric = v_metric;
  IF d.metric IS NULL AND v_metric IS DISTINCT FROM 'other' THEN
    RAISE EXCEPTION 'Choose the metric the lever moves.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_from := coalesce((p_args->>'from')::date, v_today - 29);
    v_to := coalesce((p_args->>'to')::date, v_today);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Choose a time frame: a first and a last day.' USING ERRCODE = '22023';
  END;
  PERFORM public.cockpit_board_check_window(v_from, v_to);
  SELECT * INTO c FROM public.cockpit_board_clients b WHERE b.location_id = p_args->>'locationId';
  IF c.location_id IS NULL OR NOT coalesce(public.cockpit_client_allowed(c.client_name), false) THEN
    RAISE EXCEPTION 'This client is not on your board.' USING ERRCODE = '42501';
  END IF;
  IF c.clickup_id IS NULL OR c.clickup_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'This client has no ClickUp card, so the lever cannot be filed. Link the card first.' USING ERRCODE = '22023';
  END IF;

  IF d.metric IS NOT NULL THEN
    v_row := public.cockpit_board_rows(v_from, v_to, c.location_id, public.cockpit_meta_ad_days_status())->0;
    v_cell := v_row->'values'->d.value_key;
    v_t := public.cockpit_board_targets_map(c.clickup_id)->d.metric;
    v_evidence := format('%s %s, %s to %s: %s', c.client_name, d.label, to_char(v_from, 'DD Mon'), to_char(v_to, 'DD Mon'),
      CASE
        WHEN (v_cell->>'v') IS NOT NULL THEN public.cockpit_board_fmt((v_cell->>'v')::numeric, d.unit)
          || format(' against a good line of %s', public.cockpit_board_fmt((v_t->>'good')::numeric, d.unit))
          || CASE v_cell->>'status' WHEN 'good' THEN ' (good)' WHEN 'watch' THEN ' (watch)' WHEN 'off' THEN ' (off target)'
               WHEN 'too_few' THEN ' (too few to judge)' ELSE '' END
        WHEN v_cell->>'status' = 'not_filled_in' THEN 'not filled in by the client'
        WHEN v_cell->>'status' = 'too_few' THEN 'too few to judge'
        ELSE 'not measured' END || '.');
  ELSE
    v_evidence := format('%s, %s to %s: raised in a board review.', c.client_name, to_char(v_from, 'DD Mon'), to_char(v_to, 'DD Mon'));
  END IF;

  RETURN jsonb_build_object(
    'actorId', auth.uid(), 'email', v_email,
    'locationId', c.location_id, 'taskId', c.clickup_id, 'clientName', c.client_name,
    'metric', v_metric, 'metricLabel', coalesce(d.label, 'Other'),
    'lever', v_lever, 'department', v_dep, 'note', v_note, 'meetingId', v_meeting,
    'evidence', left(v_evidence, 500), 'day', v_today, 'from', v_from, 'to', v_to);
END $$;

/**
 * The lever row before ClickUp is called (service role). A request id seen
 * before returns that lever instead: the function replays a confirmed one and
 * refuses anything else, so a retry never files twice.
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_lever_begin(p_id uuid, p_context jsonb, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l public.cockpit_board_levers; c public.cockpit_board_clients;
BEGIN
  IF coalesce(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Levers are filed by the board''s function only.' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR jsonb_typeof(p_context) IS DISTINCT FROM 'object' OR jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Send the request id, the lever''s context and the request.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO l FROM public.cockpit_board_levers x WHERE x.id = p_id FOR UPDATE;
  IF l.id IS NOT NULL THEN
    RETURN jsonb_build_object('existing', public.cockpit_board_lever_json(l)
      || jsonb_build_object('request', l.request, 'result', l.result, 'createdById', l.created_by_id));
  END IF;
  SELECT * INTO c FROM public.cockpit_board_clients b WHERE b.location_id = p_context->>'locationId';
  IF c.location_id IS NULL OR c.clickup_id IS DISTINCT FROM p_context->>'taskId' THEN
    RAISE EXCEPTION 'The client changed; refresh the board before adding the lever.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_board_levers (id, location_id, clickup_id, client_name, metric, lever, owner_department, note, evidence,
    status, request, created_by, created_by_id, meeting_id)
  VALUES (p_id, c.location_id, c.clickup_id, c.client_name, p_context->>'metric', btrim(p_context->>'lever'), p_context->>'department',
    nullif(p_context->>'note', ''), left(p_context->>'evidence', 500), 'sending', p_request, p_context->>'email',
    (p_context->>'actorId')::uuid, nullif(p_context->>'meetingId', ''));
  RETURN jsonb_build_object('created', true);
END $$;

/** The lever once ClickUp answered: open with its task, or reconcile with the error. */
CREATE OR REPLACE FUNCTION public.cockpit_board_lever_finish(p_id uuid, p_result jsonb, p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l public.cockpit_board_levers;
BEGIN
  IF coalesce(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Levers are filed by the board''s function only.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM public.cockpit_board_levers x WHERE x.id = p_id FOR UPDATE;
  IF l.id IS NULL THEN
    RAISE EXCEPTION 'No lever has that request id.' USING ERRCODE = 'P0002';
  END IF;
  IF l.status <> 'sending' THEN
    RAISE EXCEPTION 'This lever is already %.', l.status USING ERRCODE = '55000';
  END IF;
  IF p_error IS NULL THEN
    IF coalesce(p_result->>'ticketId', '') !~ '^[A-Za-z0-9_-]{1,40}$' OR coalesce(p_result->>'ticketUrl', '') !~ '^https://app\.clickup\.com/' THEN
      RAISE EXCEPTION 'A filed lever needs its ClickUp task id and link.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.cockpit_board_levers x SET status = 'open', clickup_task_id = p_result->>'ticketId', clickup_url = p_result->>'ticketUrl',
      comment_id = left(p_result->>'commentId', 80), result = p_result, finished_at = now()
    WHERE x.id = p_id RETURNING * INTO l;
  ELSE
    UPDATE public.cockpit_board_levers x SET status = 'reconcile', error = left(p_error, 1500), finished_at = now()
    WHERE x.id = p_id RETURNING * INTO l;
  END IF;
  RETURN public.cockpit_board_lever_json(l);
END $$;

-- ---------------------------------------------------------------------------
-- 9. Function privileges: revoked from all four roles, then exactly these grants

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'cockpit_board_audit()', 'cockpit_board_default_targets()',
    'cockpit_board_judge(numeric,text,numeric,numeric,boolean,boolean)', 'cockpit_board_targets_map(text)',
    'cockpit_board_cell(text,numeric,jsonb,numeric,numeric,numeric,text,text,jsonb)',
    'cockpit_board_floor_status(text,numeric,jsonb)', 'cockpit_board_count(numeric,bigint,integer,text,text,jsonb)',
    'cockpit_board_shows(numeric,numeric,numeric,text)',
    'cockpit_board_ad_unmeasured(text,text)', 'cockpit_board_ad_cells(jsonb,jsonb,jsonb)', 'cockpit_client_caller_rows()',
    'cockpit_board_check_window(date,date)', 'cockpit_board_fmt(numeric,text)', 'cockpit_board_rows(date,date,text,jsonb)',
    'cockpit_board_sheet_marks(text,timestamptz,timestamptz)', 'cockpit_board_appointments(text,date,date,jsonb)',
    'cockpit_board_marks_json(text,date,date)', 'cockpit_board_no_outcome_list(text,date,date,jsonb)',
    'cockpit_board_tree(text,text[],date,date,jsonb,jsonb)', 'cockpit_board_lever_json(public.cockpit_board_levers)',
    'cockpit_board_read(date,date)', 'cockpit_board_client(text,date,date)',
    'cockpit_board_targets_save(text,text,numeric,numeric,text)', 'cockpit_board_lever_context(jsonb)',
    'cockpit_board_lever_begin(uuid,jsonb,jsonb)', 'cockpit_board_lever_finish(uuid,jsonb,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- The browser's doors: the two reads, the targets save, the lever gate.
  FOREACH f IN ARRAY ARRAY['cockpit_board_read(date,date)', 'cockpit_board_client(text,date,date)',
    'cockpit_board_targets_save(text,text,numeric,numeric,text)', 'cockpit_board_lever_context(jsonb)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- The service key: the lever row, the callers, the defaults.
  FOREACH f IN ARRAY ARRAY['cockpit_board_lever_begin(uuid,jsonb,jsonb)', 'cockpit_board_lever_finish(uuid,jsonb,text)',
    'cockpit_client_caller_rows()', 'cockpit_board_default_targets()'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  -- cockpit_client_callers keeps its own grants (20261013180200).
  EXECUTE 'REVOKE ALL ON FUNCTION public.cockpit_client_callers() FROM PUBLIC, anon, service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_client_callers() TO authenticated';
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
