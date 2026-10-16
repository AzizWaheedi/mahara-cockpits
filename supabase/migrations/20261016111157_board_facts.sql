-- Client Performance board: the per-client daily business facts (2026-10-16,
-- Creative Triage bldgtotkfmhoxmlzowdx).
--
-- The CEO, 2026-10-16, asked for one shared "Client Performance" board for every
-- team member: one row per client over a time frame, with CRM leads, bookings,
-- shows, quotations, closes, revenue, lead quality, appointments with no
-- outcome, dials and whether every lead was contacted, shown only when the data
-- exists and the client filled it in. This file is the business half of that
-- board's data. The ad half (spend, impressions, video) is
-- public.cockpit_meta_ad_days; the reads and the targets are the board's own
-- functions. Nothing here is read by a browser directly.
--
-- What it adds:
--   cockpit_board_clients   the client spine: one row per GoHighLevel location,
--                           its ClickUp card, status, service mode, every Meta ad
--                           account tied to it (digits only, no "act_") and how
--                           each one was tied, and whether it runs TikTok
--   cockpit_client_days     one row per client per Kuwait day: CRM leads,
--                           bookings, meetings due, shows, no-shows, no outcome,
--                           quotations, closes, revenue, lead quality, dials and
--                           leads called, with a note per source
--   cockpit_client_now      the call centre right now: leads still waiting for
--                           a first touch, the oldest of them, the share of the
--                           last 30 days' leads that were touched, the median
--                           first call in working time
--   cockpit_board_facts_refresh(from, to)  rebuilds the days in a window
--   cockpit_board_facts_run(mode)          the pg_cron entry: 'recent' is the
--                                          last 3 days, 'nightly' the last 120
--   cockpit_board_facts_doctor()           what is missing, for the service key
--   pg_cron mahara-board-facts             at minutes 10 and 40, recent
--   pg_cron mahara-board-facts-nightly     at 00:50 UTC (03:50 Kuwait), nightly
--   cockpit_sync_state 'board-facts'       the state row, one audit row a run
--
-- The rules (research 2026-10-16, metrics.checked.md, corrected table and C1-C9):
--   Spine. Every ghl_clients row. An ad account ties to a location the way
--     hermes/lead-sync-watch ties it: clients.ghl_location_id, then
--     ghl_client_ad_accounts, then the client name (the board card's name,
--     deleted cards after live ones, then the ad account's own name) matched
--     to one ghl_clients name that is not cancelled. Accounts hidden from the
--     dashboards and Mahara's own two accounts are left out. Facts are built
--     for every client that is not cancelled.
--   CRM leads. client_leads not deleted, by the Kuwait day the contact was
--     created, leaving out WhatsApp chats: no ad, no campaign and tagged
--     "inbound whatsapp" in GoHighLevel (DECISIONS 2026-10-15, the same rule as
--     cockpit_client_calls). crm_ad_leads is the part with an ad id or the
--     Meta channel.
--   Confirmed bookings. Main and online appointment calendars, by the Kuwait
--     day the booking was made (Mahara OS and the stability playbook), minus
--     cancelled, invalid and Google Calendar copies (ghl_source google_calendar,
--     DECISIONS 2026-10-10; C1: 16 of Atlantis's 28 meetings were copies).
--     A main-calendar appointment in status new counts here, as on the CEO
--     Delivery tab; the dialer's report calls it provisional.
--   Provisional bookings. triage.js provisionalBookingsSql: public.appointments,
--     the dialer's verified bookings and its GoHighLevel appointment facts,
--     newest version, on a not-confirmed / provisional / tentative calendar, by
--     the Kuwait day the booking was made, minus Google copies by id and (C2)
--     any row with the same contact and start time as a Google copy, minus
--     cancelled, invalid and deleted.
--   Shows, no-shows, no outcome. Meetings on those calendars whose time has
--     passed, by the Kuwait meeting day, not cancelled or invalid, not Google
--     copies. Attendance is triage.js attendanceOf: the CRM status showed or
--     noshow, else the client sheet's mark (appointments.attended, or for a
--     meeting that copy missed the dialer's sheet row on the same contact at
--     the same meeting time, cc_results), else the client portal's attendance. Unmarked is unknown, never a no-show; a day
--     whose due meetings are all unmarked has shows and no_shows NULL. No
--     outcome is hasNoOutcome: no portal outcome at any revision and no sheet
--     mark.
--   Quotations. The client sheet's column K "Y" (the CSM sheet copy,
--     cockpit_csm_sources clientProfiles, which keeps only Y) and the portal's
--     quotation = true, by meeting day. The two sources share no appointment
--     id, so a day counts the larger of the two, never their sum.
--     quotation_answers is NULL while the sheet copy cannot tell N from blank;
--     for a client with no sheet copy it is the portal's answered count.
--   Closes and revenue. The client sheet (the dialer's cc_results: closed Y,
--     the first closed meeting per contact, no conflict, DECISIONS 2026-09-27
--     the sheet is authoritative) and the portal's deal = won, matched on
--     location, meeting day and contact or phone so one deal counts once.
--     Revenue is USD only: KWD, AED, SAR and QAR at the cockpit's fixed rates
--     (hermes/ceo-refresh/native/data/tap.js USD_PER, pinned by the test); a
--     value in no currency or another one stays out and is named in the note.
--   Lead quality. The portal's latest revision per appointment, 1 to 10 only.
--   Dials and leads called. The dialer's own events
--     (mahara_reporting.call_center_events): dials are saved outcomes with a
--     note, by save day, equal to mahara_call_center_report's dials; leads
--     called are leads, by creation day, with a verified Maqsam dial so far,
--     WhatsApp chats left out as in CRM leads, so the report's leadsDialed is
--     leads called plus the chats it called (the note counts them).
--   Now. The waiting / touched rule inside cockpit_client_calls, re-done here
--     for every client at once over the last 30 Kuwait days, and the report's
--     median first call in working seconds. The test proves both match.
--
-- Missing is never zero. A source that cannot be read leaves the stored figure
-- as it was (NULL on a new row) and says why in sources; 0 means the source was
-- read, covers the day and has nothing. A source that is behind (its sync older
-- than 3 hours, a sheet read that errored) never lowers a closed day; a
-- complete read may, and the run's audit row lists the drops. A day no source
-- covers (after a stale source last read, in a month the client sheet has no
-- tab for, before the first meeting the client reported in the portal) is
-- never 0: what a source does hold for it still counts, as a floor.
--
-- Not in scope: ad spend, Meta leads and every ad metric
-- (cockpit_meta_ad_days); the board reads, targets and levers; any screen; the
-- quotation N values (the CSM sheet copy drops them, csmProviders.ts:72); the
-- missing ad-account ties (Ardon's ghl_client_ad_accounts row, Professional
-- Touch's account); CEO Delivery's own Google-copy bug (triage.js:306,411-422).
--
-- How we know it works: apps/media-buyer-cockpit/scripts/board-facts-supabase.test.ts
-- runs this file on PGlite over the dialer's real views and report, one test per
-- rule, the NULL and 0 cases, the closed-day rule, and cockpit_client_calls side
-- by side for the waiting numbers. Second source, read live 2026-10-16 with
-- these rules (16 Sep to 15 Oct): confirmed bookings Atlantis 11, Arcturus 29,
-- Ocean Home 30 against CEO Delivery's 28, 30 and 31 (it dates by meeting day,
-- keeps Atlantis's 16 Google copies and one cancelled Arcturus meeting); shows
-- and no-shows equal Delivery's (5/3, 16/9, 1/0) before the sheet-mark fill,
-- which adds one Arcturus show the CRM copy missed; dials 17 Sep to 16 Oct equal
-- the dialer's report exactly (62, 165, 203). The RUNBOOK section repeats the
-- check for after the migration is applied.
--
-- Safe to apply twice: tables IF NOT EXISTS, functions CREATE OR REPLACE, the
-- jobs unscheduled by name before they are scheduled again. pg_cron is touched
-- only inside guarded dynamic SQL, so the file loads in PGlite. Apply after
-- 20261013180000_cockpit_client_calls.sql and
-- 20261015200000_cockpit_client_calls_whatsapp_chats.sql; then run
-- select public.cockpit_board_facts_run('nightly'); once to fill 120 days.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regclass('public.cockpit_sync_state') IS NULL OR to_regclass('public.cockpit_audit_log') IS NULL THEN
    RAISE EXCEPTION 'The cockpit core (sync state, audit log) is missing';
  END IF;
  IF to_regclass('mahara_reporting.call_center_events') IS NULL OR to_regclass('mahara_reporting.cc_calls') IS NULL
     OR to_regclass('mahara_reporting.cc_leads') IS NULL OR to_regclass('mahara_reporting.cc_attempts') IS NULL
     OR to_regclass('mahara_reporting.cc_results') IS NULL OR to_regclass('mahara_reporting.cc_people') IS NULL
     OR to_regclass('mahara_reporting.cc_clients') IS NULL
     OR to_regprocedure('mahara_reporting.cc_work_seconds(jsonb,timestamptz,timestamptz)') IS NULL
     OR to_regprocedure('mahara_reporting.cc_time(text)') IS NULL
     OR to_regprocedure('mahara_reporting.cc_phone(text,text)') IS NULL
     OR to_regprocedure('mahara_reporting.cc_window(jsonb,date)') IS NULL THEN
    RAISE EXCEPTION 'The dialer''s reporting views (mahara_reporting) are missing';
  END IF;
  IF to_regprocedure('public.cockpit_call_centre_is_test(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261013180000_cockpit_client_calls.sql first';
  END IF;
END $$;

-- The run's detail goes on its sync-state row (20261011c added the column).
ALTER TABLE public.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;

-- ---------------------------------------------------------------------------
-- 1. Tables

CREATE TABLE IF NOT EXISTS public.cockpit_board_clients (
  location_id text PRIMARY KEY CHECK (location_id <> ''),
  clickup_id text,
  client_name text NOT NULL,
  status text,
  service_mode text CHECK (service_mode IN ('DFY','DWY')),
  ad_account_ids text[] NOT NULL DEFAULT '{}',
  ad_account_ties jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(ad_account_ties) = 'array'),
  tiktok boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cockpit_board_clients_clickup_idx ON public.cockpit_board_clients (clickup_id);
COMMENT ON TABLE public.cockpit_board_clients IS
  'The Client Performance board''s client spine: one row per GoHighLevel location, refreshed with the facts by cockpit_board_facts_refresh. Ad accounts tie in lead-sync-watch order (clients.ghl_location_id, ghl_client_ad_accounts, the client name).';
COMMENT ON COLUMN public.cockpit_board_clients.ad_account_ids IS
  'Meta ad account ids tied to the location, digits only (no act_ prefix), sorted.';
COMMENT ON COLUMN public.cockpit_board_clients.ad_account_ties IS
  'How each ad account was tied: [{account, matchedBy, name}], matchedBy clients.ghl_location_id, ghl_client_ad_accounts or ghl_clients name.';

CREATE TABLE IF NOT EXISTS public.cockpit_client_days (
  location_id text NOT NULL REFERENCES public.cockpit_board_clients(location_id) ON DELETE CASCADE,
  day date NOT NULL,
  crm_leads integer,
  crm_ad_leads integer,
  confirmed_bookings integer,
  provisional_bookings integer,
  meetings_due integer,
  shows integer,
  no_shows integer,
  no_outcome integer,
  quotations integer,
  quotation_answers integer,
  closes integer,
  closes_with_value integer,
  revenue_usd numeric(14,2),
  lead_quality_sum numeric,
  lead_quality_count integer,
  dials integer,
  leads_called integer,
  computed_at timestamptz NOT NULL DEFAULT now(),
  sources jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(sources) = 'object'),
  PRIMARY KEY (location_id, day),
  CONSTRAINT cockpit_client_days_counts_check CHECK (
    coalesce(crm_leads,0) >= 0 AND coalesce(crm_ad_leads,0) >= 0 AND coalesce(confirmed_bookings,0) >= 0
    AND coalesce(provisional_bookings,0) >= 0 AND coalesce(meetings_due,0) >= 0 AND coalesce(shows,0) >= 0
    AND coalesce(no_shows,0) >= 0 AND coalesce(no_outcome,0) >= 0 AND coalesce(quotations,0) >= 0
    AND coalesce(quotation_answers,0) >= 0 AND coalesce(closes,0) >= 0 AND coalesce(closes_with_value,0) >= 0
    AND coalesce(revenue_usd,0) >= 0 AND coalesce(lead_quality_sum,0) >= 0 AND coalesce(lead_quality_count,0) >= 0
    AND coalesce(dials,0) >= 0 AND coalesce(leads_called,0) >= 0)
);
CREATE INDEX IF NOT EXISTS cockpit_client_days_day_idx ON public.cockpit_client_days (day);
COMMENT ON TABLE public.cockpit_client_days IS
  'One row per client location per Kuwait day for the Client Performance board, written only by cockpit_board_facts_refresh. NULL means the source could not be read or the client does not fill it; 0 means it was read and has nothing. sources holds {ok, state, as_of, note, from} per source: leads, appointments, outcomes, sheet_marks, provisional, sheet, sheet_copy, dialer, dialer_leads. state is ok (a complete read), stale (partial: a closed day is never lowered), failed or none (the stored figure is kept).';
COMMENT ON COLUMN public.cockpit_client_days.crm_leads IS 'Contacts created this Kuwait day, not deleted, WhatsApp chats (no ad, tagged inbound whatsapp) left out.';
COMMENT ON COLUMN public.cockpit_client_days.crm_ad_leads IS 'The part of crm_leads with an ad id or the Meta channel.';
COMMENT ON COLUMN public.cockpit_client_days.confirmed_bookings IS 'Main and online calendar bookings made this day, minus cancelled, invalid and Google Calendar copies.';
COMMENT ON COLUMN public.cockpit_client_days.provisional_bookings IS 'Not-confirmed calendar bookings made this day (triage.js rule), minus Google copies by id and by contact and start time.';
COMMENT ON COLUMN public.cockpit_client_days.meetings_due IS 'Booked meetings on this day whose time has passed, not cancelled or invalid.';
COMMENT ON COLUMN public.cockpit_client_days.shows IS 'Due meetings marked showed (CRM status, sheet, portal). NULL when meetings were due and none was marked.';
COMMENT ON COLUMN public.cockpit_client_days.no_shows IS 'Due meetings marked no-show. Unmarked is never a no-show. NULL when meetings were due and none was marked.';
COMMENT ON COLUMN public.cockpit_client_days.no_outcome IS 'Due meetings with no portal outcome at any revision and no sheet mark (triage.js hasNoOutcome).';
COMMENT ON COLUMN public.cockpit_client_days.quotations IS 'Meetings this day with a quotation given: the larger of the sheet copy''s Y count and the portal''s true count.';
COMMENT ON COLUMN public.cockpit_client_days.quotation_answers IS 'Meetings whose quotation was answered either way; NULL while the sheet copy keeps only Y.';
COMMENT ON COLUMN public.cockpit_client_days.revenue_usd IS 'Closed deal values in USD (fixed rates for KWD, AED, SAR, QAR); values in no or another currency are left out and named in sources.';
COMMENT ON COLUMN public.cockpit_client_days.dials IS 'The dialer''s official dials: outcomes saved with a note, by the Kuwait day saved.';
COMMENT ON COLUMN public.cockpit_client_days.leads_called IS 'Leads created this day with a verified Maqsam dial so far (the dialer''s count less WhatsApp chats, as in crm_leads).';

CREATE TABLE IF NOT EXISTS public.cockpit_client_now (
  location_id text PRIMARY KEY REFERENCES public.cockpit_board_clients(location_id) ON DELETE CASCADE,
  untouched_leads integer CHECK (coalesce(untouched_leads,0) >= 0),
  oldest_untouched_at timestamptz,
  touched_share_30d numeric CHECK (touched_share_30d IS NULL OR touched_share_30d BETWEEN 0 AND 1),
  callable_30d integer CHECK (coalesce(callable_30d,0) >= 0),
  touched_30d integer CHECK (coalesce(touched_30d,0) >= 0),
  first_call_median_work_seconds_30d numeric,
  computed_at timestamptz NOT NULL DEFAULT now(),
  note text
);
COMMENT ON TABLE public.cockpit_client_now IS
  'The call centre now, per client, over the last 30 Kuwait days: the waiting and touched rule of cockpit_client_calls (dialable leads older than one working hour; touched = dialled, dialled under another lead, or a saved attempt) and the dialer report''s median first call in working seconds.';
COMMENT ON COLUMN public.cockpit_client_now.touched_share_30d IS 'touched_30d / callable_30d as a fraction from 0 to 1 (0.9 is 90%); NULL when no lead was callable.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_board_clients','cockpit_client_days','cockpit_client_now'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Small rules

-- A name for matching: lower case, spaces and punctuation folded to one space.
CREATE OR REPLACE FUNCTION public.cockpit_board_norm(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT nullif(btrim(regexp_replace(lower(coalesce(p, '')), '[[:space:][:punct:]]+', ' ', 'g')), '');
$$;

-- triage.js calendarKind: main, online, provisional, callback, reschedule, other.
CREATE OR REPLACE FUNCTION public.cockpit_board_calendar_kind(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN coalesce(p_name, '') = '' THEN 'other'
    WHEN lower(p_name) ~ 'callback|call-back|معاودة' THEN 'callback'
    WHEN lower(p_name) ~ 'not confirmed|provisional|tentative' THEN 'provisional'
    WHEN lower(p_name) ~ 'reschedul' THEN 'reschedule'
    WHEN lower(p_name) ~ 'appointment calendar|main appointment' THEN CASE WHEN lower(p_name) ~ 'online' THEN 'online' ELSE 'main' END
    ELSE 'other' END;
$$;

-- USD per unit, the cockpit's fixed rates (tap.js USD_PER). No currency, or one
-- not listed, is unknown: NULL, never one to one.
CREATE OR REPLACE FUNCTION public.cockpit_board_usd_rate(p_currency text) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE upper(btrim(coalesce(p_currency, '')))
    WHEN 'USD' THEN 1 WHEN 'KWD' THEN 3.26 WHEN 'AED' THEN 0.2723 WHEN 'SAR' THEN 0.2666 WHEN 'QAR' THEN 0.2747 END::numeric;
$$;

-- The closed-day rule. ok: the new figure. stale: the new figure, but a closed
-- day is never lowered. gap (no source covers the day): what was found is at
-- least true, so a count above the stored one is kept, but a zero is never
-- claimed. Anything else (failed, none): the stored figure. NULL on a new row.
CREATE OR REPLACE FUNCTION public.cockpit_board_facts_pick(p_state text, p_day date, p_today date, p_old numeric, p_new numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_state
    WHEN 'ok' THEN p_new
    WHEN 'stale' THEN CASE WHEN p_day < p_today AND p_old IS NOT NULL AND (p_new IS NULL OR p_new < p_old) THEN p_old ELSE p_new END
    WHEN 'gap' THEN CASE WHEN p_new > 0 AND (p_old IS NULL OR p_new > p_old) THEN p_new ELSE p_old END
    ELSE p_old END;
$$;

-- ---------------------------------------------------------------------------
-- 3. The refresh

CREATE OR REPLACE FUNCTION public.cockpit_board_facts_refresh(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now timestamptz := now();
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_t0 timestamptz := clock_timestamp();
  v_start timestamptz;
  v_end timestamptz;
  v_30_start timestamptz;
  v_ev_start timestamptz;
  v_fresh constant interval := interval '3 hours';
  v_err text;
  v_failures jsonb := '[]'::jsonb;
  v_dialer_ok boolean := false;
  v_rows integer := 0;
  v_clients integer := 0;
  v_drops jsonb;
  v_drop_count integer := 0;
  v_summary jsonb;
  v_ok boolean;
  v_note text;
  v_prev jsonb;
  v_detail jsonb;
  -- The dialer's views join leads to calls through CTEs a nested loop makes
  -- slow; its own report runs them with enable_nestloop off, and so do these
  -- reads (switched back after each, and undone with a failed block).
  v_nestloop text := current_setting('enable_nestloop');
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to > v_today OR p_to - p_from > 399 THEN
    RAISE EXCEPTION 'Choose days up to today (Kuwait time), at most 400 of them.' USING ERRCODE = '22023';
  END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_board_facts_refresh', 0)) THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'note', 'Another board facts refresh is running.');
  END IF;
  v_start := p_from::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_end := (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_30_start := (v_today - 29)::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_ev_start := least(v_start, v_30_start);

  -- Working tables, dropped at commit. Created before any source is read, so a
  -- source that fails leaves them empty rather than missing.
  DROP TABLE IF EXISTS pg_temp._bf_loc, pg_temp._bf_grid, pg_temp._bf_src, pg_temp._bf_v, pg_temp._bf_out,
    pg_temp._bf_ap, pg_temp._bf_sc, pg_temp._bf_pw, pg_temp._bf_dl, pg_temp._bf_sch, pg_temp._bf_ccl,
    pg_temp._bf_calls, pg_temp._bf_coh, pg_temp._bf_att, pg_temp._bf_st, pg_temp._bf_fin, pg_temp._bf_rm;
  CREATE TEMP TABLE _bf_src (source text, location_id text, state text, as_of timestamptz, note text, cov_from date,
    cov_months date[]) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_v (location_id text, day date, metric text, value numeric) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_out (location_id text, appointment_id text, attendance text, deal text, quotation boolean,
    project_value numeric, currency text, lead_quality numeric, captured_at timestamptz) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_ap (location_id text, id text, contact_id text, contact_phone text, booked_at timestamptz,
    start_at timestamptz, status text, attended boolean, kind text) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_sc (location_id text, contact_id text, phone8 text, meeting timestamptz, day date,
    value numeric, currency text, value_usd numeric) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_pw (location_id text, contact_id text, phone8 text, day date, value numeric, currency text,
    value_usd numeric) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_dl (location_id text, contact_id text, kind text, event_at timestamptz, first_dial boolean, speed numeric,
    chat boolean NOT NULL DEFAULT false) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_sch (location_id text, schedule jsonb, is_default boolean) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_att (location_id text, contact_id text) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_rm (location_id text, contact_id text, meeting timestamptz, mark boolean) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_ccl (location_id text, contact_id text, created_at timestamptz, phone text) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_calls (id text, started_at timestamptz, agent text, type text, conflict boolean,
    location_id text, contact_id text, phone text) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_coh (location_id text, contact_id text, created_at timestamptz, phone text, chat boolean) ON COMMIT DROP;

  -- 3.1 The client spine ------------------------------------------------------
  WITH acc AS (
    SELECT regexp_replace(lower(btrim(c.meta_ad_account_id)), '^act_', '') AS acct, c.id, nullif(btrim(c.ghl_location_id), '') AS loc,
           c.name, coalesce(c.hidden_from_dashboard, false) AS hidden
    FROM public.clients c WHERE coalesce(c.meta_ad_account_id, '') <> ''
  ), cards AS (
    SELECT regexp_replace(lower(btrim(k.meta_account_id)), '^act_', '') AS acct, k.client_name AS name,
           coalesce(k.source_deleted, false) AS deleted
    FROM public.cockpit_campaigns k
    WHERE coalesce(k.meta_account_id, '') <> '' AND public.cockpit_board_norm(k.client_name) IS NOT NULL
  ), accounts AS (
    SELECT acct FROM acc UNION SELECT acct FROM cards
  ), gnames AS (
    SELECT public.cockpit_board_norm(g.client_name) AS n, min(g.location_id) AS loc, count(*) AS k
    FROM public.ghl_clients g
    WHERE coalesce(g.status, '') <> 'Cancelled' AND public.cockpit_board_norm(g.client_name) IS NOT NULL
    GROUP BY 1
  ), tie AS (
    SELECT a.acct, t.loc, t.how, t.name
    FROM accounts a
    CROSS JOIN LATERAL (
      SELECT x.loc, x.how, x.name FROM (
        SELECT c.loc, 'clients.ghl_location_id' AS how, c.name, 1::numeric AS o FROM acc c WHERE c.acct = a.acct AND c.loc IS NOT NULL
        UNION ALL
        SELECT m.location_id, 'ghl_client_ad_accounts', c.name, CASE WHEN m.matched_by = 'meta_exact' THEN 2 ELSE 2.5 END
        FROM acc c JOIN public.ghl_client_ad_accounts m ON m.client_id = c.id
        WHERE c.acct = a.acct AND nullif(btrim(m.location_id), '') IS NOT NULL
        UNION ALL
        SELECT gn.loc, 'ghl_clients name', k.name, CASE WHEN k.deleted THEN 3.5 ELSE 3 END
        FROM cards k JOIN gnames gn ON gn.n = public.cockpit_board_norm(k.name) AND gn.k = 1 WHERE k.acct = a.acct
        UNION ALL
        SELECT gn.loc, 'ghl_clients name', c.name, 4
        FROM acc c JOIN gnames gn ON gn.n = public.cockpit_board_norm(c.name) AND gn.k = 1 WHERE c.acct = a.acct
      ) x ORDER BY x.o, x.loc LIMIT 1
    ) t
    WHERE a.acct ~ '^[0-9]{5,20}$'
      AND NOT EXISTS (SELECT 1 FROM acc h WHERE h.acct = a.acct
                      AND (h.hidden OR replace(coalesce(public.cockpit_board_norm(h.name), ''), ' ', '') IN ('maharamedia', 'maharamassdesign')))
  ), tt AS (
    SELECT DISTINCT coalesce(nullif(btrim(c.ghl_location_id), ''), m.location_id) AS loc
    FROM public.clients c LEFT JOIN public.ghl_client_ad_accounts m ON m.client_id = c.id
    WHERE lower(coalesce(c.platform, '')) = 'tiktok' OR nullif(btrim(c.tiktok_advertiser_id), '') IS NOT NULL
  ), g AS (
    SELECT DISTINCT ON (btrim(x.location_id)) btrim(x.location_id) AS location_id, nullif(btrim(x.clickup_id), '') AS clickup_id,
           coalesce(nullif(btrim(x.client_name), ''), btrim(x.location_id)) AS client_name, x.status,
           CASE upper(btrim(coalesce(x.service_mode, ''))) WHEN 'DFY' THEN 'DFY' WHEN 'DWY' THEN 'DWY' END AS service_mode,
           nullif(btrim(x.tiktok_ad_account), '') IS NOT NULL AS tiktok_ghl
    FROM public.ghl_clients x WHERE nullif(btrim(x.location_id), '') IS NOT NULL
    ORDER BY btrim(x.location_id), x.synced_at DESC NULLS LAST
  )
  INSERT INTO public.cockpit_board_clients AS b (location_id, clickup_id, client_name, status, service_mode,
    ad_account_ids, ad_account_ties, tiktok, updated_at)
  SELECT g.location_id, g.clickup_id, g.client_name, g.status, g.service_mode,
    coalesce((SELECT array_agg(t.acct ORDER BY t.acct) FROM tie t WHERE t.loc = g.location_id), '{}'::text[]),
    coalesce((SELECT jsonb_agg(jsonb_build_object('account', t.acct, 'matchedBy', t.how, 'name', t.name) ORDER BY t.acct)
              FROM tie t WHERE t.loc = g.location_id), '[]'::jsonb),
    g.tiktok_ghl OR EXISTS (SELECT 1 FROM tt WHERE tt.loc = g.location_id),
    v_now
  FROM g
  ON CONFLICT (location_id) DO UPDATE SET clickup_id = EXCLUDED.clickup_id, client_name = EXCLUDED.client_name,
    status = EXCLUDED.status, service_mode = EXCLUDED.service_mode, ad_account_ids = EXCLUDED.ad_account_ids,
    ad_account_ties = EXCLUDED.ad_account_ties, tiktok = EXCLUDED.tiktok, updated_at = EXCLUDED.updated_at
  WHERE (b.clickup_id, b.client_name, b.status, b.service_mode, b.ad_account_ids, b.ad_account_ties, b.tiktok)
        IS DISTINCT FROM (EXCLUDED.clickup_id, EXCLUDED.client_name, EXCLUDED.status, EXCLUDED.service_mode,
                          EXCLUDED.ad_account_ids, EXCLUDED.ad_account_ties, EXCLUDED.tiktok);

  CREATE TEMP TABLE _bf_loc ON COMMIT DROP AS
  SELECT b.location_id, b.clickup_id, b.client_name, b.service_mode
  FROM public.cockpit_board_clients b
  WHERE coalesce(b.status, '') NOT IN ('Cancelled', 'Removed from sheet');
  SELECT count(*) INTO v_clients FROM pg_temp._bf_loc;

  CREATE TEMP TABLE _bf_grid ON COMMIT DROP AS
  SELECT l.location_id, d::date AS day
  FROM pg_temp._bf_loc l CROSS JOIN generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d;

  -- 3.2 CRM leads -------------------------------------------------------------
  BEGIN
    INSERT INTO pg_temp._bf_src (source, location_id, state, as_of, note)
    SELECT 'leads', l.location_id,
      CASE WHEN s.last_status = 'success' AND s.last_synced_at >= v_now - v_fresh THEN 'ok' ELSE 'stale' END,
      s.last_synced_at,
      CASE WHEN s.location_id IS NULL THEN 'The lead sync has no record of a run for this client, so a closed day is never lowered.'
           WHEN s.last_status IS DISTINCT FROM 'success' THEN format('The lead sync''s last run ended "%s"%s, so a closed day is never lowered and later days stay empty until it runs again.',
             coalesce(s.last_status, 'without a status'), coalesce(': ' || left(s.last_error, 160), ''))
           WHEN s.last_synced_at < v_now - v_fresh THEN format('The lead sync last ran %s Kuwait time, so a closed day is never lowered and later days stay empty until it runs again.',
             to_char(s.last_synced_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI')) END
    FROM pg_temp._bf_loc l LEFT JOIN public.lead_sync_state s ON s.location_id = l.location_id;

    INSERT INTO pg_temp._bf_v (location_id, day, metric, value)
    SELECT x.location_id, x.day, m.metric, count(*)
    FROM (
      SELECT cl.location_id, (cl.created_at AT TIME ZONE 'Asia/Kuwait')::date AS day,
             (cl.channel = 'Meta' OR nullif(btrim(cl.ad_id), '') IS NOT NULL) AS ad
      FROM public.client_leads cl
      JOIN pg_temp._bf_loc l ON l.location_id = cl.location_id
      LEFT JOIN mahara_reporting.facts f ON f.namespace = 'production' AND f.source = 'ghl' AND f.kind = 'contact'
        AND f.external_id = cl.location_id || ':' || cl.ghl_contact_id
      WHERE NOT coalesce(cl.deleted, false) AND cl.created_at >= v_start AND cl.created_at < v_end
        AND NOT (nullif(cl.ad_id, '') IS NULL AND nullif(cl.campaign_id, '') IS NULL
                 AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.data->'tags') = 'array'
                              THEN f.data->'tags' ELSE '[]'::jsonb END) t(x) WHERE lower(btrim(t.x)) = 'inbound whatsapp'))
    ) x
    CROSS JOIN LATERAL (VALUES ('crm_leads', true), ('crm_ad_leads', x.ad)) m(metric, keep)
    WHERE m.keep
    GROUP BY 1, 2, 3;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO pg_temp._bf_src (source, location_id, state, note)
    SELECT 'leads', l.location_id, 'failed', 'The CRM leads could not be read, so the figures stored before are kept: ' || left(v_err, 200)
    FROM pg_temp._bf_loc l;
    v_failures := v_failures || jsonb_build_object('source', 'leads', 'error', left(v_err, 300));
  END;

  -- 3.3 Portal outcomes (latest revision per appointment) ---------------------
  BEGIN
    INSERT INTO pg_temp._bf_out
    SELECT DISTINCT ON (o.location_id, o.appointment_id) o.location_id, o.appointment_id, o.attendance, o.deal, o.quotation,
           o.project_value, nullif(upper(btrim(o.currency)), ''), o.lead_quality, o.captured_at
    FROM portal_data.appointment_outcomes o JOIN pg_temp._bf_loc l ON l.location_id = o.location_id
    ORDER BY o.location_id, o.appointment_id, o.revision DESC;

    INSERT INTO pg_temp._bf_src (source, location_id, state, as_of, note)
    SELECT 'outcomes', l.location_id, 'ok', x.latest,
      nullif(concat_ws(' ',
        CASE WHEN x.n = 0 THEN 'The client has not reported any appointment in the portal.' END,
        CASE WHEN x.undated > 0 THEN format('%s portal outcome%s on an appointment this database does not hold %s left out.',
          x.undated, CASE WHEN x.undated = 1 THEN '' ELSE 's' END, CASE WHEN x.undated = 1 THEN 'is' ELSE 'are' END) END,
        CASE WHEN x.bad_lq > 0 THEN format('%s lead quality score%s outside 1 to 10 left out.', x.bad_lq, CASE WHEN x.bad_lq = 1 THEN '' ELSE 's' END) END), '')
    FROM pg_temp._bf_loc l
    CROSS JOIN LATERAL (
      SELECT count(*) AS n, max(o.captured_at) AS latest,
        count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.appointments a WHERE a.ghl_appointment_id = o.appointment_id)) AS undated,
        count(*) FILTER (WHERE o.lead_quality IS NOT NULL AND o.lead_quality NOT BETWEEN 1 AND 10) AS bad_lq
      FROM pg_temp._bf_out o WHERE o.location_id = l.location_id
    ) x;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO pg_temp._bf_src (source, location_id, state, note)
    SELECT 'outcomes', l.location_id, 'failed', 'The client portal''s outcomes could not be read, so the figures stored before are kept: ' || left(v_err, 200)
    FROM pg_temp._bf_loc l;
    v_failures := v_failures || jsonb_build_object('source', 'outcomes', 'error', left(v_err, 300));
  END;

  -- 3.4a The client sheets' own attendance marks ---------------------------
  -- The sheet's mark reaches most appointments as appointments.attended. The
  -- dialer's read of the sheet (cc_results) also gives it for a meeting that
  -- copy missed, matched the dialer's way: same contact, same meeting time.
  BEGIN
    PERFORM pg_catalog.set_config('enable_nestloop', 'off', true);
    INSERT INTO pg_temp._bf_rm
    SELECT r.location_id, r.contact_id, r.meeting, bool_or(r.attendance = 'Y')
    FROM mahara_reporting.cc_results r JOIN pg_temp._bf_loc l ON l.location_id = r.location_id
    WHERE NOT r.conflict AND r.contact_id IS NOT NULL AND r.attendance IN ('Y', 'N')
      AND r.meeting >= v_start AND r.meeting < v_end
    GROUP BY 1, 2, 3
    HAVING count(DISTINCT r.attendance) = 1;
    PERFORM pg_catalog.set_config('enable_nestloop', v_nestloop, true);
    INSERT INTO pg_temp._bf_src (source, location_id, state, as_of, note)
    SELECT 'sheet_marks', l.location_id, 'ok', NULL, NULL FROM pg_temp._bf_loc l;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO pg_temp._bf_src (source, location_id, state, note)
    SELECT 'sheet_marks', l.location_id, 'failed',
      'The client sheets'' attendance marks could not be read, so only the marks copied onto the appointments count and a closed day is never lowered: ' || left(v_err, 200)
    FROM pg_temp._bf_loc l;
    v_failures := v_failures || jsonb_build_object('source', 'sheet_marks', 'error', left(v_err, 300));
  END;

  -- 3.4 Appointments: confirmed bookings, meetings, attendance ----------------
  BEGIN
    INSERT INTO pg_temp._bf_src (source, location_id, state, as_of, note)
    SELECT 'appointments', l.location_id,
      CASE WHEN s.last_status = 'success' AND s.last_synced_at >= v_now - v_fresh THEN 'ok' ELSE 'stale' END,
      s.last_synced_at,
      nullif(concat_ws(' ',
        CASE WHEN s.location_id IS NULL THEN 'The appointments sync has no record of a run for this client, so a closed day is never lowered.'
             WHEN s.last_status IS DISTINCT FROM 'success' THEN format('The appointments sync''s last run ended "%s", so a closed day is never lowered and later days stay empty until it runs again.', coalesce(s.last_status, 'without a status'))
             WHEN s.last_synced_at < v_now - v_fresh THEN format('The appointments sync last ran %s Kuwait time, so a closed day is never lowered and later days stay empty until it runs again.',
               to_char(s.last_synced_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI')) END,
        CASE WHEN g.n > 0 THEN format('%s Google Calendar cop%s left out.', g.n, CASE WHEN g.n = 1 THEN 'y is' ELSE 'ies are' END) END), '')
    FROM pg_temp._bf_loc l
    LEFT JOIN public.appointment_sync_state s ON s.location_id = l.location_id
    CROSS JOIN LATERAL (
      SELECT count(*) AS n FROM public.appointments a
      WHERE coalesce(nullif(a.ghl_location_id, ''), nullif(a.ghl_location, '')) = l.location_id AND a.ghl_source = 'google_calendar'
        AND ((a.booked_at >= v_start AND a.booked_at < v_end) OR (a.start_at >= v_start AND a.start_at < v_end))
    ) g;

    INSERT INTO pg_temp._bf_ap
    SELECT x.location_id, a.ghl_appointment_id, a.ghl_contact_id, a.contact_phone, a.booked_at, a.start_at, a.status, a.attended,
           public.cockpit_board_calendar_kind(cal.name)
    FROM public.appointments a
    CROSS JOIN LATERAL (SELECT coalesce(nullif(a.ghl_location_id, ''), nullif(a.ghl_location, '')) AS location_id) x
    JOIN pg_temp._bf_loc l ON l.location_id = x.location_id
    LEFT JOIN LATERAL (
      SELECT c.name FROM public.ghl_calendars c WHERE c.calendar_id = a.calendar_id
      ORDER BY (c.location_id = x.location_id) DESC, c.synced_at DESC NULLS LAST LIMIT 1
    ) cal ON true
    WHERE coalesce(a.ghl_source, '') <> 'google_calendar'
      AND ((a.booked_at >= v_start AND a.booked_at < v_end) OR (a.start_at >= v_start AND a.start_at < v_end));

    -- Where the client's portal reports begin: the first meeting day with an
    -- outcome. The portal says nothing about the days before it.
    UPDATE pg_temp._bf_src s SET cov_from = c.cov,
      note = concat_ws(' ', s.note, format('The client''s portal reports start with meetings on %s.', to_char(c.cov, 'DD Mon YYYY')))
    FROM (SELECT o.location_id, min((a.start_at AT TIME ZONE 'Asia/Kuwait')::date) AS cov
          FROM pg_temp._bf_out o JOIN public.appointments a ON a.ghl_appointment_id = o.appointment_id
          WHERE a.start_at IS NOT NULL GROUP BY 1) c
    WHERE s.source = 'outcomes' AND s.location_id = c.location_id AND s.state = 'ok';

    INSERT INTO pg_temp._bf_v (location_id, day, metric, value)
    SELECT a.location_id, (a.booked_at AT TIME ZONE 'Asia/Kuwait')::date, 'confirmed_bookings', count(*)
    FROM pg_temp._bf_ap a
    WHERE a.kind IN ('main', 'online') AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid')
      AND a.booked_at >= v_start AND a.booked_at < v_end
    GROUP BY 1, 2;

    -- Meetings whose time has passed, with the portal's latest outcome.
    INSERT INTO pg_temp._bf_v (location_id, day, metric, value)
    SELECT m.location_id, m.day, k.metric, sum(k.v)
    FROM (
      SELECT a.location_id, (a.start_at AT TIME ZONE 'Asia/Kuwait')::date AS day,
        CASE WHEN a.status = 'showed' THEN 'showed' WHEN a.status = 'noshow' THEN 'noshow'
             WHEN coalesce(a.attended, sm.mark) IS TRUE OR o.attendance = 'showed' THEN 'showed'
             WHEN coalesce(a.attended, sm.mark) IS FALSE OR o.attendance = 'no_show' THEN 'noshow' ELSE 'unknown' END AS att,
        (o.appointment_id IS NULL AND coalesce(a.attended, sm.mark) IS NULL) AS no_outcome,
        CASE WHEN o.lead_quality BETWEEN 1 AND 10 THEN o.lead_quality END AS lq,
        o.quotation
      FROM pg_temp._bf_ap a
      LEFT JOIN pg_temp._bf_out o ON o.location_id = a.location_id AND o.appointment_id = a.id
      LEFT JOIN pg_temp._bf_rm sm ON sm.location_id = a.location_id AND sm.contact_id = a.contact_id AND sm.meeting = a.start_at
      WHERE a.kind IN ('main', 'online', 'provisional') AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid')
        AND a.start_at >= v_start AND a.start_at < v_end AND a.start_at <= v_now
    ) m
    CROSS JOIN LATERAL (VALUES
      ('meetings_due', 1::numeric), ('shows', (m.att = 'showed')::int), ('no_shows', (m.att = 'noshow')::int),
      ('no_outcome', m.no_outcome::int), ('lq_sum', m.lq), ('lq_count', CASE WHEN m.lq IS NOT NULL THEN 1 ELSE 0 END),
      ('q_portal', (m.quotation IS TRUE)::int), ('q_portal_answered', (m.quotation IS NOT NULL)::int)
    ) k(metric, v)
    GROUP BY 1, 2, 3;

    -- Deals the client marked won in the portal, for the closes below.
    INSERT INTO pg_temp._bf_pw
    SELECT a.location_id, a.contact_id,
      right(regexp_replace(coalesce(nullif(a.contact_phone, ''), cl.contact_phone, ''), '[^0-9]', '', 'g'), 8),
      (a.start_at AT TIME ZONE 'Asia/Kuwait')::date,
      CASE WHEN o.project_value > 0 THEN o.project_value END, o.currency,
      CASE WHEN o.project_value > 0 THEN round(o.project_value * public.cockpit_board_usd_rate(o.currency), 2) END
    FROM pg_temp._bf_ap a
    JOIN pg_temp._bf_out o ON o.location_id = a.location_id AND o.appointment_id = a.id
    LEFT JOIN public.client_leads cl ON cl.ghl_contact_id = a.contact_id AND cl.location_id = a.location_id
    WHERE o.deal = 'won' AND a.kind IN ('main', 'online', 'provisional') AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid')
      AND a.start_at >= v_start AND a.start_at < v_end AND a.start_at <= v_now;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO pg_temp._bf_src (source, location_id, state, note)
    SELECT 'appointments', l.location_id, 'failed', 'The appointments could not be read, so the figures stored before are kept: ' || left(v_err, 200)
    FROM pg_temp._bf_loc l;
    v_failures := v_failures || jsonb_build_object('source', 'appointments', 'error', left(v_err, 300));
  END;

  -- 3.5 Provisional bookings (triage.js provisionalBookingsSql, by booking day)
  BEGIN
    INSERT INTO pg_temp._bf_src (source, location_id, state, as_of, note)
    SELECT 'provisional', l.location_id,
      CASE WHEN j.last_success >= v_now - v_fresh AND j.error IS NULL THEN 'ok' ELSE 'stale' END,
      j.last_success,
      CASE WHEN j.last_success IS NULL THEN 'The dialer has no appointment sync for this client, so a closed day is never lowered.'
           WHEN j.error IS NOT NULL THEN 'The dialer''s appointment sync reports an error, so a closed day is never lowered and later days stay empty until it succeeds: ' || left(j.error, 160)
           WHEN j.last_success < v_now - v_fresh THEN format('The dialer''s appointment sync last succeeded %s Kuwait time, so a closed day is never lowered and later days stay empty until it runs again.',
             to_char(j.last_success AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI')) END
    FROM pg_temp._bf_loc l
    LEFT JOIN LATERAL (
      SELECT max(s.last_success) AS last_success, max(s.error) AS error FROM mahara_reporting.sync_jobs s
      WHERE s.namespace = 'production' AND s.location_id = l.location_id AND s.kind = 'appointments_recent'
    ) j ON true;

    INSERT INTO pg_temp._bf_v (location_id, day, metric, value)
    WITH records AS (
      SELECT coalesce(nullif(ap.ghl_location_id, ''), nullif(ap.ghl_location, '')) AS location_id, ap.ghl_appointment_id AS id,
             ap.ghl_contact_id AS contact_id, ap.calendar_id, ap.booked_at, ap.start_at, ap.status, ap.updated_at AS version_at,
             0 AS priority, false AS conflict
      FROM public.appointments ap
      UNION ALL
      SELECT a.location_id, a.data->'bookingVerification'->>'id', a.contact_id, a.data->'bookingVerification'->>'calendarId',
             mahara_reporting.cc_time(a.data->'bookingVerification'->>'verifiedAt'),
             mahara_reporting.cc_time(a.data->'bookingVerification'->>'startTime'),
             a.data->'bookingVerification'->>'appointmentStatus',
             mahara_reporting.cc_time(a.data->'bookingVerification'->>'verifiedAt'), 2, false
      FROM mahara_reporting.cc_attempts a
      WHERE a.data->'disposition'->>'outcome' = 'BOOKED' AND a.data->'bookingVerification'->>'verifiedAt' IS NOT NULL
      UNION ALL
      SELECT f.data->>'locationId', f.data->>'id', f.data->>'contactId', f.data->>'calendarId',
             mahara_reporting.cc_time(f.data->>'bookedAt'), mahara_reporting.cc_time(f.data->>'startAt'),
             CASE WHEN coalesce(f.data->>'deleted', 'false') = 'true' OR coalesce(f.data->>'missingFromProvider', 'false') = 'true'
                  THEN 'deleted' ELSE f.data->>'status' END,
             f.version_at, 1, f.conflict
      FROM mahara_reporting.facts f
      WHERE f.namespace = 'production' AND f.kind = 'appointment' AND f.source = 'ghl'
    ), latest AS (
      SELECT DISTINCT ON (r.location_id, r.id) r.*
      FROM records r
      WHERE r.location_id IN (SELECT location_id FROM pg_temp._bf_loc) AND r.id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.appointments g WHERE g.ghl_appointment_id = r.id AND g.ghl_source = 'google_calendar')
      ORDER BY r.location_id, r.id, r.version_at DESC NULLS LAST, r.priority
    ), calendars AS (
      SELECT DISTINCT ON (c.location_id, c.calendar_id) c.location_id, c.calendar_id, c.name
      FROM (SELECT location_id, calendar_id, name, synced_at FROM public.ghl_calendars
            UNION ALL
            SELECT f.data->>'locationId', f.data->>'id', f.data->>'name', f.version_at
            FROM mahara_reporting.facts f WHERE f.namespace = 'production' AND f.kind = 'calendar') c
      ORDER BY c.location_id, c.calendar_id, c.synced_at DESC NULLS LAST
    )
    SELECT p.location_id, (p.booked_at AT TIME ZONE 'Asia/Kuwait')::date, 'provisional_bookings', count(*)
    FROM latest p
    JOIN calendars cal ON cal.location_id = p.location_id AND cal.calendar_id = p.calendar_id
    WHERE lower(cal.name) ~ 'not confirmed|provisional|tentative' AND lower(cal.name) !~ 'callback|call-back|reschedul|معاودة'
      AND p.conflict IS NOT TRUE AND coalesce(p.status, '') NOT IN ('deleted', 'cancelled', 'invalid')
      AND p.start_at IS NOT NULL AND p.booked_at >= v_start AND p.booked_at < v_end
      AND NOT EXISTS (
        SELECT 1 FROM public.appointments g
        WHERE g.ghl_source = 'google_calendar' AND g.ghl_contact_id = p.contact_id
          AND coalesce(nullif(g.ghl_location_id, ''), nullif(g.ghl_location, '')) = p.location_id
          AND abs(extract(epoch FROM g.start_at - p.start_at)) < 60)
    GROUP BY 1, 2;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO pg_temp._bf_src (source, location_id, state, note)
    SELECT 'provisional', l.location_id, 'failed', 'The provisional bookings could not be read, so the figures stored before are kept: ' || left(v_err, 200)
    FROM pg_temp._bf_loc l;
    v_failures := v_failures || jsonb_build_object('source', 'provisional', 'error', left(v_err, 300));
  END;

  -- 3.6 The CSM sheet copy: quotations (column K, Y only) --------------------
  BEGIN
    WITH prof AS (
      SELECT DISTINCT ON (s.data->>'taskId') s.data->>'taskId' AS task_id, s.data->'performance' AS perf,
        CASE WHEN jsonb_typeof(s.data->'performanceSyncedAt') = 'number'
             THEN to_timestamp((s.data->>'performanceSyncedAt')::numeric / 1000) END AS synced_at
      FROM public.cockpit_csm_sources s
      WHERE s.table_name = 'clientProfiles' AND nullif(s.data->>'taskId', '') IS NOT NULL
      ORDER BY s.data->>'taskId',
        CASE WHEN jsonb_typeof(s.data->'performanceSyncedAt') = 'number' THEN (s.data->>'performanceSyncedAt')::numeric END DESC NULLS LAST,
        s.source_snapshot_at DESC NULLS LAST
    ), joined AS (
      SELECT l.location_id, p.perf, p.synced_at,
        CASE WHEN p.perf IS NULL OR jsonb_typeof(p.perf) <> 'object' THEN 'none'
             WHEN p.synced_at IS NULL OR p.synced_at < v_now - v_fresh THEN 'stale' ELSE 'ok' END AS state,
        CASE WHEN p.perf IS NULL OR jsonb_typeof(p.perf) <> 'object' THEN NULL
             WHEN coalesce(p.perf->>'source', '') ~* '^appointments tab' THEN NULL
             ELSE (date_trunc('month', coalesce(p.synced_at, v_now) AT TIME ZONE 'Asia/Kuwait') - interval '1 month')::date END AS cov_from
      FROM pg_temp._bf_loc l LEFT JOIN prof p ON p.task_id = l.clickup_id
    ), ins_src AS (
      INSERT INTO pg_temp._bf_src (source, location_id, state, as_of, note, cov_from)
      SELECT 'sheet_copy', j.location_id, j.state, j.synced_at,
        CASE WHEN j.state = 'none' THEN 'No client sheet copy for this client (the CSM profile has no sheet read).'
             ELSE concat_ws(' ',
               CASE WHEN j.state = 'stale' THEN format('The client sheet was last read %s Kuwait time, so a closed day is never lowered and later days wait for the next read.',
                 coalesce(to_char(j.synced_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'), 'at an unknown time')) END,
               CASE WHEN j.cov_from IS NOT NULL THEN format('The sheet copy holds month tabs from %s; earlier days keep the figures stored before.', to_char(j.cov_from, 'DD Mon YYYY')) END,
               'The copy keeps only Y in the Quotation column, so answered quotations are not known.') END,
        j.cov_from
      FROM joined j
      RETURNING 1
    )
    INSERT INTO pg_temp._bf_v (location_id, day, metric, value)
    SELECT j.location_id, (r->>'appAt')::date, 'q_sheet', count(*)
    FROM joined j
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(j.perf->'appointments') = 'array' THEN j.perf->'appointments' ELSE '[]'::jsonb END) r
    WHERE j.state <> 'none' AND lower(coalesce(r->>'quote', '')) = 'y' AND coalesce(r->>'appAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND (r->>'appAt')::date BETWEEN p_from AND p_to
    GROUP BY 1, 2;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO pg_temp._bf_src (source, location_id, state, note)
    SELECT 'sheet_copy', l.location_id, 'failed', 'The client sheet copy could not be read, so the figures stored before are kept: ' || left(v_err, 200)
    FROM pg_temp._bf_loc l;
    v_failures := v_failures || jsonb_build_object('source', 'sheet_copy', 'error', left(v_err, 300));
  END;

  -- 3.7 The client sheets (the dialer's cc_results): closes and values -------
  BEGIN
    INSERT INTO pg_temp._bf_src (source, location_id, state, as_of, note, cov_from, cov_months)
    SELECT 'sheet', l.location_id, x.state, s.checked_at,
      CASE WHEN x.state = 'none' THEN 'The dialer reads no sheet for this client.'
           ELSE nullif(concat_ws(' ',
             CASE WHEN s.data IS NULL OR (s.data->>'sheetId') IS DISTINCT FROM s.sheet_id THEN 'The stored sheet rows belong to another sheet, so a closed day is never lowered.'
                  WHEN s.error IS NOT NULL THEN 'The last sheet read failed and its earlier rows are used, so a closed day is never lowered and later days wait for the next read: ' || left(s.error, 120)
                  WHEN NOT coalesce(s.active, false) THEN 'The sheet is switched off in the dialer, so a closed day is never lowered.'
                  WHEN s.checked_at < v_now - v_fresh THEN format('The sheet was last read %s Kuwait time, so a closed day is never lowered and later days wait for the next read.',
                    to_char(s.checked_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI')) END,
             CASE WHEN cardinality(x.months) = 0 THEN 'The sheet holds no month tab, so it covers no day.'
                  ELSE format('The sheet holds the month tab%s %s; days in other months keep the figures stored before.',
                    CASE WHEN cardinality(x.months) = 1 THEN '' ELSE 's' END,
                    (SELECT string_agg(to_char(m, 'Mon YYYY'), ', ' ORDER BY m) FROM unnest(x.months) m)) END), '') END,
      x.months[1], x.months
    FROM pg_temp._bf_loc l
    LEFT JOIN mahara_reporting.sheet_snapshots s ON s.namespace = 'production' AND s.id = l.location_id
    CROSS JOIN LATERAL (
      SELECT CASE WHEN s.id IS NULL THEN 'none'
                  WHEN s.data IS NULL OR (s.data->>'sheetId') IS DISTINCT FROM s.sheet_id OR s.error IS NOT NULL
                       OR NOT coalesce(s.active, false) OR s.checked_at IS NULL OR s.checked_at < v_now - v_fresh THEN 'stale'
                  ELSE 'ok' END AS state,
             -- The month tabs the stored rows came from; rows of another sheet cover nothing.
             CASE WHEN s.id IS NULL THEN NULL
                  WHEN s.data IS NULL OR (s.data->>'sheetId') IS DISTINCT FROM s.sheet_id THEN '{}'::date[]
                  ELSE coalesce((
                    SELECT array_agg(t.m ORDER BY t.m) FROM (
                      SELECT DISTINCT to_date('01 ' || (r->>'tab'), 'DD Mon YY') AS m
                      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.data->'rows') = 'array' THEN s.data->'rows' ELSE '[]'::jsonb END) r
                      WHERE coalesce(r->>'tab', '') ~ '^[A-Z][a-z]{2} [0-9]{2}$') t), '{}'::date[]) END AS months
    ) x;

    PERFORM pg_catalog.set_config('enable_nestloop', 'off', true);
    INSERT INTO pg_temp._bf_sc
    SELECT r.location_id, r.contact_id, right(regexp_replace(coalesce(r.phone, ''), '[^0-9]', '', 'g'), 8), r.meeting,
      (r.meeting AT TIME ZONE 'Asia/Kuwait')::date,
      CASE WHEN r.value > 0 THEN r.value END, nullif(upper(btrim(r.currency)), ''),
      CASE WHEN r.value > 0 THEN round(r.value * public.cockpit_board_usd_rate(r.currency), 2) END
    FROM mahara_reporting.cc_results r
    JOIN pg_temp._bf_loc l ON l.location_id = r.location_id
    WHERE r.closed = 'Y' AND NOT r.conflict AND NOT (coalesce(r.confirmed, '') = 'C' AND coalesce(r.attendance, '') = 'Y')
      AND r.project_rank = 1 AND NOT r.project_conflict
      AND r.meeting >= v_start AND r.meeting < v_end;
    PERFORM pg_catalog.set_config('enable_nestloop', v_nestloop, true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO pg_temp._bf_src (source, location_id, state, note)
    SELECT 'sheet', l.location_id, 'failed', 'The client sheets could not be read, so the figures stored before are kept: ' || left(v_err, 200)
    FROM pg_temp._bf_loc l;
    v_failures := v_failures || jsonb_build_object('source', 'sheet', 'error', left(v_err, 300));
  END;

  -- One deal counts once: a portal win on the same day and contact (or the
  -- last 8 phone digits) as a sheet close is the same deal. The sheet's value
  -- wins; the portal's fills a sheet close that has none.
  INSERT INTO pg_temp._bf_v (location_id, day, metric, value)
  SELECT d.location_id, d.day, k.metric, sum(k.v)
  FROM (
    SELECT s.location_id, s.day, coalesce(s.value_usd, pw.value_usd) AS value_usd,
           (s.value IS NOT NULL AND s.value_usd IS NULL AND pw.value_usd IS NULL) AS unknown_currency
    FROM pg_temp._bf_sc s
    LEFT JOIN LATERAL (
      SELECT p.value_usd FROM pg_temp._bf_pw p
      WHERE p.location_id = s.location_id AND p.day = s.day
        AND ((s.contact_id IS NOT NULL AND p.contact_id = s.contact_id) OR (length(s.phone8) = 8 AND p.phone8 = s.phone8))
      ORDER BY p.value_usd DESC NULLS LAST LIMIT 1
    ) pw ON true
    UNION ALL
    SELECT p.location_id, p.day, p.value_usd, (p.value IS NOT NULL AND p.value_usd IS NULL)
    FROM pg_temp._bf_pw p
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_temp._bf_sc s
      WHERE s.location_id = p.location_id AND s.day = p.day
        AND ((s.contact_id IS NOT NULL AND p.contact_id = s.contact_id) OR (length(s.phone8) = 8 AND p.phone8 = s.phone8)))
  ) d
  CROSS JOIN LATERAL (VALUES
    ('closes', 1::numeric), ('closes_with_value', CASE WHEN d.value_usd > 0 THEN 1 ELSE 0 END),
    ('revenue_usd', coalesce(d.value_usd, 0)), ('unknown_currency', d.unknown_currency::int)
  ) k(metric, v)
  GROUP BY 1, 2, 3;

  -- 3.8 The dialer: official dials, leads called, first call in working time -
  BEGIN
    PERFORM pg_catalog.set_config('enable_nestloop', 'off', true);
    EXECUTE 'INSERT INTO pg_temp._bf_dl (location_id, contact_id, kind, event_at, first_dial, speed)
      SELECT e.location_id, e.contact_id, e.kind, e.event_at, (e.data->>''firstDialAt'') IS NOT NULL,
             CASE WHEN e.kind = ''lead'' THEN (e.data->>''speedSeconds'')::numeric END
      FROM mahara_reporting.call_center_events e
      WHERE e.kind IN (''lead'', ''outcome'') AND e.event_at >= $1 AND e.event_at < $2 AND e.location_id = ANY($3)'
    USING v_ev_start, least(v_end, v_now), (SELECT coalesce(array_agg(location_id), '{}'::text[]) FROM pg_temp._bf_loc);
    PERFORM pg_catalog.set_config('enable_nestloop', v_nestloop, true);
    -- A WhatsApp chat (tagged inbound whatsapp, no ad, no campaign) is not a
    -- lead, as in CRM leads and cockpit_client_calls, so leads called leave it
    -- out too. The dialer's own leadsDialed counts it: the difference is the
    -- chats it called.
    UPDATE pg_temp._bf_dl d SET chat = true
    WHERE d.kind = 'lead' AND d.contact_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM mahara_reporting.facts f
                  WHERE f.namespace = 'production' AND f.source = 'ghl' AND f.kind = 'contact'
                    AND f.external_id = d.location_id || ':' || d.contact_id AND jsonb_typeof(f.data->'tags') = 'array'
                    AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(f.data->'tags') t(x) WHERE lower(btrim(t.x)) = 'inbound whatsapp'))
      AND NOT EXISTS (SELECT 1 FROM public.client_leads cl
                      WHERE cl.ghl_contact_id = d.contact_id AND cl.location_id = d.location_id
                        AND (nullif(cl.ad_id, '') IS NOT NULL OR nullif(cl.campaign_id, '') IS NOT NULL));

    INSERT INTO pg_temp._bf_src (source, location_id, state, as_of, note)
    SELECT x.source, l.location_id,
      CASE WHEN x.source = 'dialer_leads' AND NOT EXISTS (SELECT 1 FROM mahara_reporting.cc_clients c WHERE c.id = l.location_id) THEN 'none' ELSE 'ok' END,
      CASE WHEN x.source = 'dialer' THEN (SELECT to_timestamp(max(a.updated) / 1000.0) FROM mahara_console.attempts a WHERE a.namespace = 'production')
           ELSE (SELECT max(f.captured_at) FROM mahara_reporting.facts f WHERE f.namespace = 'production' AND f.source = 'maqsam' AND f.kind = 'call') END,
      nullif(concat_ws(' ',
        CASE WHEN x.source = 'dialer_leads' AND NOT EXISTS (SELECT 1 FROM mahara_reporting.cc_clients c WHERE c.id = l.location_id)
             THEN 'The dialer does not list this client, so its leads called are not known.' END,
        CASE WHEN x.source = 'dialer_leads' AND ch.n > 0
             THEN format('%s WhatsApp chat contact%s the dialer called in these days %s left out, as in CRM leads.',
               ch.n, CASE WHEN ch.n = 1 THEN '' ELSE 's' END, CASE WHEN ch.n = 1 THEN 'is' ELSE 'are' END) END,
        CASE WHEN l.service_mode = 'DWY' THEN 'Done with you: the call centre does not call this client''s leads.' END,
        CASE WHEN EXISTS (SELECT 1 FROM mahara_console.metadata m WHERE m.namespace = 'production' AND m.id = 'access:client:' || l.location_id
                          AND m.data->>'active' = 'false') THEN 'This client is switched off in the dialer.' END), '')
    FROM pg_temp._bf_loc l CROSS JOIN (VALUES ('dialer'), ('dialer_leads')) x(source)
    CROSS JOIN LATERAL (
      SELECT count(*) AS n FROM pg_temp._bf_dl d
      WHERE d.location_id = l.location_id AND d.kind = 'lead' AND d.chat AND d.first_dial AND d.event_at >= v_start
    ) ch;

    INSERT INTO pg_temp._bf_v (location_id, day, metric, value)
    SELECT d.location_id, (d.event_at AT TIME ZONE 'Asia/Kuwait')::date, CASE WHEN d.kind = 'outcome' THEN 'dials' ELSE 'leads_called' END, count(*)
    FROM pg_temp._bf_dl d
    WHERE d.event_at >= v_start AND (d.kind = 'outcome' OR (d.first_dial AND NOT d.chat))
    GROUP BY 1, 2, 3;
    v_dialer_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO pg_temp._bf_src (source, location_id, state, note)
    SELECT x.source, l.location_id, 'failed', 'The dialer''s report could not be read, so the figures stored before are kept: ' || left(v_err, 200)
    FROM pg_temp._bf_loc l CROSS JOIN (VALUES ('dialer'), ('dialer_leads')) x(source);
    v_failures := v_failures || jsonb_build_object('source', 'dialer', 'error', left(v_err, 300));
  END;

  -- 3.9 Waiting now (cockpit_client_calls' rule, every client at once) -------
  BEGIN
    -- The assigned callers' hours: the dialer's active assignments that hold the
    -- location, kept when the dialer account says agent (or, with no dialer
    -- account, Team & Payroll says call centre agent) and the hours read.
    INSERT INTO pg_temp._bf_sch (location_id, schedule, is_default)
    SELECT l.location_id, x.schedule, false
    FROM pg_temp._bf_loc l
    CROSS JOIN LATERAL (
      SELECT cp.schedule,
        cp.schedule IS NOT NULL AND mahara_reporting.cc_window(cp.schedule, v_today) IS NOT NULL AS schedule_ok,
        CASE WHEN i.id IS NOT NULL THEN coalesce(i.data->>'role' = 'agent' AND i.data->>'enabled' = 'true', false)
             ELSE coalesce(pp.role ~* '^call cent(re|er) agent' AND pp.active, false) END AS agent
      FROM (SELECT DISTINCT lower(btrim(m.data->>'email')) AS email FROM mahara_console.metadata m
            WHERE m.namespace = 'production' AND m.id LIKE 'access:agent:%' AND m.data->>'active' = 'true'
              AND jsonb_typeof(m.data->'locationIds') = 'array' AND m.data->'locationIds' ? l.location_id
              AND nullif(btrim(m.data->>'email'), '') IS NOT NULL) a
      LEFT JOIN mahara_console.metadata i ON i.namespace = 'production' AND i.id = 'identity:account:' || a.email
      LEFT JOIN mahara_reporting.cc_people cp ON cp.email = a.email
      LEFT JOIN LATERAL (SELECT p.role, p.active FROM public.cockpit_people p WHERE lower(btrim(p.email)) = a.email
                         ORDER BY p.active DESC, p.id DESC LIMIT 1) pp ON true
    ) x
    WHERE x.agent AND x.schedule_ok;
    -- 10:00 to 18:00 Kuwait time, Friday off, when no assigned caller has hours.
    INSERT INTO pg_temp._bf_sch (location_id, schedule, is_default)
    SELECT l.location_id, '{"timezone":"Asia/Kuwait","exceptions":[],"week":{
      "sun":{"on":true,"start":"10:00","end":"18:00"},"mon":{"on":true,"start":"10:00","end":"18:00"},
      "tue":{"on":true,"start":"10:00","end":"18:00"},"wed":{"on":true,"start":"10:00","end":"18:00"},
      "thu":{"on":true,"start":"10:00","end":"18:00"},"fri":{"on":false,"start":"10:00","end":"18:00"},
      "sat":{"on":true,"start":"10:00","end":"18:00"}}}'::jsonb, true
    FROM pg_temp._bf_loc l WHERE NOT EXISTS (SELECT 1 FROM pg_temp._bf_sch s WHERE s.location_id = l.location_id);

    PERFORM pg_catalog.set_config('enable_nestloop', 'off', true);
    INSERT INTO pg_temp._bf_ccl
    SELECT c.location_id, c.contact_id, c.created_at, c.phone FROM mahara_reporting.cc_leads c
    WHERE c.location_id IN (SELECT location_id FROM pg_temp._bf_loc);
    INSERT INTO pg_temp._bf_calls
    SELECT c.id, c.started_at, c.agent, c.data->>'type', c.conflict, c.location_id, c.contact_id, mahara_reporting.cc_phone(c.data->>'phone')
    FROM mahara_reporting.cc_calls c WHERE c.started_at >= v_30_start - interval '180 days';
    INSERT INTO pg_temp._bf_coh
    SELECT l.location_id, l.contact_id, l.created_at, l.phone,
      (nullif(cl.ad_id, '') IS NULL AND nullif(cl.campaign_id, '') IS NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.data->'tags') = 'array'
                    THEN f.data->'tags' ELSE '[]'::jsonb END) t(x) WHERE lower(btrim(t.x)) = 'inbound whatsapp'))
    FROM pg_temp._bf_ccl l
    LEFT JOIN public.client_leads cl ON cl.ghl_contact_id = l.contact_id AND cl.location_id = l.location_id
    LEFT JOIN mahara_reporting.facts f ON f.namespace = 'production' AND f.source = 'ghl' AND f.kind = 'contact'
      AND f.external_id = l.location_id || ':' || l.contact_id
    WHERE l.created_at >= v_30_start AND l.created_at < v_now;
    INSERT INTO pg_temp._bf_att
    SELECT DISTINCT a.location_id, a.contact_id FROM mahara_reporting.cc_attempts a
    WHERE a.location_id IN (SELECT location_id FROM pg_temp._bf_loc) AND a.contact_id IS NOT NULL
      AND NOT public.cockpit_call_centre_is_test(a.data);
    PERFORM pg_catalog.set_config('enable_nestloop', v_nestloop, true);
    CREATE INDEX ON pg_temp._bf_calls (location_id, contact_id);
    CREATE INDEX ON pg_temp._bf_calls (phone);
    CREATE INDEX ON pg_temp._bf_att (location_id, contact_id);
    ANALYZE pg_temp._bf_calls;
    ANALYZE pg_temp._bf_coh;
    ANALYZE pg_temp._bf_att;

    INSERT INTO public.cockpit_client_now AS n (location_id, untouched_leads, oldest_untouched_at, touched_share_30d,
      callable_30d, touched_30d, first_call_median_work_seconds_30d, computed_at, note)
    SELECT l.location_id, coalesce(w.untouched, 0), w.oldest,
      CASE WHEN coalesce(w.callable, 0) > 0 THEN round(w.touched::numeric / w.callable, 4) END,
      coalesce(w.callable, 0), coalesce(w.touched, 0), sp.median, v_now,
      nullif(concat_ws(' ',
        CASE WHEN l.service_mode = 'DWY' THEN 'Done with you: the call centre does not call this client''s leads, so there is no verdict.' END,
        CASE WHEN l.service_mode IS DISTINCT FROM 'DWY' AND NOT EXISTS (SELECT 1 FROM mahara_reporting.cc_clients c WHERE c.id = l.location_id)
             THEN 'The dialer does not list this client, so no caller is working these leads.' END,
        CASE WHEN EXISTS (SELECT 1 FROM mahara_console.metadata m WHERE m.namespace = 'production' AND m.id = 'access:client:' || l.location_id
                          AND m.data->>'active' = 'false') THEN 'This client is switched off in the dialer, so no new leads reach the callers.' END,
        CASE WHEN coalesce(w.callable, 0) = 0 THEN 'No lead from the last 30 days is old enough to judge yet (one working hour).' END,
        CASE WHEN EXISTS (SELECT 1 FROM pg_temp._bf_sch s WHERE s.location_id = l.location_id AND s.is_default)
             THEN 'No assigned caller has hours on Team & Payroll, so working time is 10:00 to 18:00 Kuwait time, Friday off.' END,
        CASE WHEN w.chats > 0 THEN format('%s WhatsApp chat contact%s left out (tagged inbound whatsapp, no ad).', w.chats, CASE WHEN w.chats = 1 THEN ' is' ELSE 's are' END) END,
        CASE WHEN NOT v_dialer_ok THEN 'The dialer''s report could not be read, so the median first call is the one stored before.' END), '')
    FROM pg_temp._bf_loc l
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE NOT c.chat AND c.callable) AS callable,
             count(*) FILTER (WHERE NOT c.chat AND c.callable AND c.touched) AS touched,
             count(*) FILTER (WHERE NOT c.chat AND c.callable AND NOT c.touched) AS untouched,
             min(c.created_at) FILTER (WHERE NOT c.chat AND c.callable AND NOT c.touched) AS oldest,
             count(*) FILTER (WHERE c.chat) AS chats
      FROM (
        SELECT h.chat, h.created_at,
          (coalesce(h.phone ~ '^(966|965|971|974)', false)
           AND CASE WHEN h.created_at <= v_now - interval '4 days' THEN true
                    ELSE coalesce((SELECT bool_or(mahara_reporting.cc_work_seconds(s.schedule, h.created_at, v_now) >= 3600)
                                   FROM pg_temp._bf_sch s WHERE s.location_id = h.location_id), false) END) AS callable,
          (EXISTS (SELECT 1 FROM pg_temp._bf_calls v WHERE v.location_id = h.location_id AND v.contact_id = h.contact_id
                     AND v.type = 'outbound' AND NOT v.conflict AND v.agent IS NOT NULL AND v.started_at >= h.created_at)
           OR EXISTS (SELECT 1 FROM pg_temp._bf_calls x WHERE x.phone = h.phone AND x.type = 'outbound' AND x.started_at >= h.created_at
                        AND NOT (x.location_id IS NOT DISTINCT FROM h.location_id AND x.contact_id IS NOT DISTINCT FROM h.contact_id))
           OR EXISTS (SELECT 1 FROM pg_temp._bf_att a WHERE a.location_id = h.location_id AND a.contact_id = h.contact_id)) AS touched
        FROM pg_temp._bf_coh h WHERE h.location_id = l.location_id
      ) c
    ) w ON true
    LEFT JOIN LATERAL (
      SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY d.speed))::numeric) AS median
      FROM pg_temp._bf_dl d
      WHERE d.location_id = l.location_id AND d.kind = 'lead' AND d.event_at >= v_30_start AND d.speed IS NOT NULL
    ) sp ON true
    ON CONFLICT (location_id) DO UPDATE SET untouched_leads = EXCLUDED.untouched_leads,
      oldest_untouched_at = EXCLUDED.oldest_untouched_at, touched_share_30d = EXCLUDED.touched_share_30d,
      callable_30d = EXCLUDED.callable_30d, touched_30d = EXCLUDED.touched_30d,
      first_call_median_work_seconds_30d = CASE WHEN v_dialer_ok THEN EXCLUDED.first_call_median_work_seconds_30d
                                                ELSE n.first_call_median_work_seconds_30d END,
      computed_at = EXCLUDED.computed_at, note = EXCLUDED.note;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    UPDATE public.cockpit_client_now n SET note = 'The last refresh could not work out who is waiting, so these figures are from '
      || to_char(n.computed_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI') || ' Kuwait time: ' || left(v_err, 160)
    WHERE n.location_id IN (SELECT location_id FROM pg_temp._bf_loc);
    v_failures := v_failures || jsonb_build_object('source', 'waiting', 'error', left(v_err, 300));
  END;

  -- 4. Merge into the days ------------------------------------------------------
  CREATE TEMP TABLE _bf_st ON COMMIT DROP AS
  SELECT s.location_id,
    max(s.state) FILTER (WHERE s.source = 'leads') AS leads,
    max(s.state) FILTER (WHERE s.source = 'appointments') AS appts,
    max(s.state) FILTER (WHERE s.source = 'outcomes') AS outcomes,
    max(s.state) FILTER (WHERE s.source = 'provisional') AS prov,
    max(s.state) FILTER (WHERE s.source = 'sheet') AS sheet,
    max(s.state) FILTER (WHERE s.source = 'sheet_copy') AS copy,
    max(s.cov_from) FILTER (WHERE s.source = 'sheet_copy') AS copy_cov,
    max(s.state) FILTER (WHERE s.source = 'dialer') AS dialer,
    max(s.state) FILTER (WHERE s.source = 'dialer_leads') AS dialer_leads,
    max(s.state) FILTER (WHERE s.source = 'sheet_marks') AS marks,
    -- The last Kuwait day each source read; a source that is behind says
    -- nothing about the days after it.
    max((s.as_of AT TIME ZONE 'Asia/Kuwait')::date) FILTER (WHERE s.source = 'leads') AS leads_asof,
    max((s.as_of AT TIME ZONE 'Asia/Kuwait')::date) FILTER (WHERE s.source = 'appointments') AS appts_asof,
    max((s.as_of AT TIME ZONE 'Asia/Kuwait')::date) FILTER (WHERE s.source = 'provisional') AS prov_asof,
    max((s.as_of AT TIME ZONE 'Asia/Kuwait')::date) FILTER (WHERE s.source = 'sheet') AS sheet_asof,
    max((s.as_of AT TIME ZONE 'Asia/Kuwait')::date) FILTER (WHERE s.source = 'sheet_copy') AS copy_asof,
    max(s.cov_from) FILTER (WHERE s.source = 'outcomes') AS portal_cov,
    jsonb_object_agg(s.source, jsonb_build_object('ok', s.state = 'ok', 'state', s.state, 'as_of', s.as_of, 'note', s.note)
      || CASE WHEN s.cov_from IS NOT NULL THEN jsonb_build_object('from', s.cov_from) ELSE '{}'::jsonb END) AS sources
  FROM pg_temp._bf_src s GROUP BY 1;
  ALTER TABLE pg_temp._bf_st ADD COLUMN portal_none boolean, ADD COLUMN lq_none boolean, ADD COLUMN sheet_months date[];
  UPDATE pg_temp._bf_st st SET
    sheet_months = (SELECT s.cov_months FROM pg_temp._bf_src s WHERE s.source = 'sheet' AND s.location_id = st.location_id LIMIT 1),
    portal_none = NOT EXISTS (SELECT 1 FROM pg_temp._bf_out o WHERE o.location_id = st.location_id),
    lq_none = NOT EXISTS (SELECT 1 FROM pg_temp._bf_out o WHERE o.location_id = st.location_id AND o.lead_quality BETWEEN 1 AND 10);
  -- Name the deal values left out of revenue on the sheet's note.
  UPDATE pg_temp._bf_st st SET sources = jsonb_set(st.sources, '{sheet,note}', to_jsonb(concat_ws(' ', st.sources->'sheet'->>'note',
      format('%s closed deal%s in these days carr%s a value in no known currency, left out of revenue.', u.n,
        CASE WHEN u.n = 1 THEN '' ELSE 's' END, CASE WHEN u.n = 1 THEN 'ies' ELSE 'y' END))))
  FROM (SELECT v.location_id, sum(v.value)::int AS n FROM pg_temp._bf_v v WHERE v.metric = 'unknown_currency' GROUP BY 1 HAVING sum(v.value) > 0) u
  WHERE u.location_id = st.location_id AND st.sources ? 'sheet';

  CREATE TEMP TABLE _bf_fin ON COMMIT DROP AS
  WITH piv AS (
    SELECT g.location_id, g.day,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'crm_leads'), 0) AS crm_leads,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'crm_ad_leads'), 0) AS crm_ad_leads,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'confirmed_bookings'), 0) AS confirmed_bookings,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'provisional_bookings'), 0) AS provisional_bookings,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'meetings_due'), 0) AS meetings_due,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'shows'), 0) AS shows,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'no_shows'), 0) AS no_shows,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'no_outcome'), 0) AS no_outcome,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'q_sheet'), 0) AS q_sheet,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'q_portal'), 0) AS q_portal,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'q_portal_answered'), 0) AS q_answered,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'closes'), 0) AS closes,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'closes_with_value'), 0) AS closes_with_value,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'revenue_usd'), 0) AS revenue_usd,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'lq_sum'), 0) AS lq_sum,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'lq_count'), 0) AS lq_count,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'dials'), 0) AS dials,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'leads_called'), 0) AS leads_called
    FROM pg_temp._bf_grid g
    LEFT JOIN pg_temp._bf_v v ON v.location_id = g.location_id AND v.day = g.day
    GROUP BY 1, 2
  ), cov AS (
    -- What covers each day. A stale source covers no day after the one it
    -- last read; a sheet covers the month tabs it holds; the portal covers
    -- the days from the first meeting the client reported.
    SELECT p.*, st.sources, st.copy, st.portal_none, st.lq_none,
      coalesce(st.leads, 'failed') AS leads, coalesce(st.appts, 'failed') AS appts, coalesce(st.outcomes, 'failed') AS outcomes,
      coalesce(st.prov, 'failed') AS prov, coalesce(st.sheet, 'failed') AS sheet, coalesce(st.copy, 'failed') AS copy_state,
      coalesce(st.dialer, 'failed') AS dialer, coalesce(st.dialer_leads, 'failed') AS dialer_leads,
      coalesce(st.marks, 'failed') AS marks,
      (st.leads = 'stale' AND p.day > st.leads_asof) AS leads_gap,
      (st.appts = 'stale' AND p.day > st.appts_asof) AS appts_gap,
      (st.prov = 'stale' AND p.day > st.prov_asof) AS prov_gap,
      (st.sheet IN ('ok', 'stale')) AS sheet_has,
      (st.sheet IN ('ok', 'stale') AND date_trunc('month', p.day::timestamp)::date = ANY(coalesce(st.sheet_months, '{}'::date[]))
        AND NOT coalesce(st.sheet = 'stale' AND p.day > st.sheet_asof, false)) AS sheet_covers,
      (st.copy IN ('ok', 'stale')) AS copy_has,
      (st.copy IN ('ok', 'stale') AND (st.copy_cov IS NULL OR p.day >= st.copy_cov)
        AND NOT coalesce(st.copy = 'stale' AND p.day > st.copy_asof, false)) AS copy_covers,
      (NOT st.portal_none) AS portal_has,
      (NOT st.portal_none AND p.day >= st.portal_cov AND st.appts IN ('ok', 'stale')
        AND NOT coalesce(st.appts = 'stale' AND p.day > st.appts_asof, false)) AS portal_covers
    FROM piv p JOIN pg_temp._bf_st st ON st.location_id = p.location_id
  ), eff AS (
    -- Each column's state for the day: ok (a complete read: the new figure),
    -- stale (a partial read: the new figure, but a closed day is never
    -- lowered), or failed, none, gap (nothing read: the stored figure, NULL on
    -- a new row).
    SELECT c.*,
      CASE WHEN coalesce(c.leads_gap, false) THEN 'gap' ELSE c.leads END AS s_leads,
      CASE WHEN coalesce(c.appts_gap, false) THEN 'gap' ELSE c.appts END AS s_book,
      CASE WHEN c.appts = 'failed' OR c.outcomes = 'failed' THEN 'failed'
           WHEN coalesce(c.appts_gap, false) THEN 'gap' WHEN c.appts = 'stale' OR c.marks = 'failed' THEN 'stale' ELSE 'ok' END AS s_att,
      CASE WHEN coalesce(c.prov_gap, false) THEN 'gap' ELSE c.prov END AS s_prov,
      CASE WHEN c.appts = 'failed' OR c.outcomes = 'failed' THEN 'failed'
           WHEN c.lq_none THEN 'none' WHEN NOT coalesce(c.portal_covers, false) THEN 'gap'
           WHEN c.appts = 'stale' THEN 'stale' ELSE 'ok' END AS s_lq,
      CASE WHEN c.copy_state = 'failed' OR c.outcomes = 'failed' OR c.appts = 'failed' THEN 'failed'
           WHEN NOT c.copy_has AND NOT c.portal_has THEN 'none'
           WHEN NOT c.copy_covers AND NOT coalesce(c.portal_covers, false) THEN 'gap'
           WHEN (c.copy_has AND NOT (c.copy_covers AND c.copy_state = 'ok'))
             OR (c.portal_has AND NOT (coalesce(c.portal_covers, false) AND c.appts = 'ok')) THEN 'stale'
           ELSE 'ok' END AS s_quote,
      CASE WHEN c.sheet = 'failed' OR c.outcomes = 'failed' OR c.appts = 'failed' THEN 'failed'
           WHEN NOT c.sheet_has AND NOT c.portal_has THEN 'none'
           WHEN NOT c.sheet_covers AND NOT coalesce(c.portal_covers, false) THEN 'gap'
           WHEN (c.sheet_has AND NOT (c.sheet_covers AND c.sheet = 'ok'))
             OR (c.portal_has AND NOT (coalesce(c.portal_covers, false) AND c.appts = 'ok')) THEN 'stale'
           ELSE 'ok' END AS s_close,
      c.dialer AS s_dials,
      c.dialer_leads AS s_called
    FROM cov c
  )
  SELECT e.location_id, e.day, e.sources,
    o.crm_leads AS o_crm_leads, o.crm_ad_leads AS o_crm_ad_leads, o.confirmed_bookings AS o_confirmed_bookings,
    o.provisional_bookings AS o_provisional_bookings, o.meetings_due AS o_meetings_due, o.shows AS o_shows,
    o.no_shows AS o_no_shows, o.no_outcome AS o_no_outcome, o.quotations AS o_quotations, o.closes AS o_closes,
    o.revenue_usd AS o_revenue_usd, o.lead_quality_count AS o_lead_quality_count, o.dials AS o_dials, o.leads_called AS o_leads_called,
    public.cockpit_board_facts_pick(e.s_leads, e.day, v_today, o.crm_leads, e.crm_leads)::int AS crm_leads,
    public.cockpit_board_facts_pick(e.s_leads, e.day, v_today, o.crm_ad_leads, e.crm_ad_leads)::int AS crm_ad_leads,
    public.cockpit_board_facts_pick(e.s_book, e.day, v_today, o.confirmed_bookings, e.confirmed_bookings)::int AS confirmed_bookings,
    public.cockpit_board_facts_pick(e.s_prov, e.day, v_today, o.provisional_bookings, e.provisional_bookings)::int AS provisional_bookings,
    public.cockpit_board_facts_pick(e.s_att, e.day, v_today, o.meetings_due, e.meetings_due)::int AS meetings_due,
    public.cockpit_board_facts_pick(e.s_att, e.day, v_today, o.shows,
      CASE WHEN e.meetings_due > 0 AND e.shows + e.no_shows = 0 THEN NULL ELSE e.shows END)::int AS shows,
    public.cockpit_board_facts_pick(e.s_att, e.day, v_today, o.no_shows,
      CASE WHEN e.meetings_due > 0 AND e.shows + e.no_shows = 0 THEN NULL ELSE e.no_shows END)::int AS no_shows,
    public.cockpit_board_facts_pick(e.s_att, e.day, v_today, o.no_outcome, e.no_outcome)::int AS no_outcome,
    public.cockpit_board_facts_pick(e.s_quote, e.day, v_today, o.quotations, greatest(e.q_sheet, e.q_portal))::int AS quotations,
    public.cockpit_board_facts_pick(e.s_quote, e.day, v_today, o.quotation_answers,
      CASE WHEN e.copy = 'none' AND NOT e.portal_none THEN e.q_answered END)::int AS quotation_answers,
    public.cockpit_board_facts_pick(e.s_close, e.day, v_today, o.closes, e.closes)::int AS closes,
    public.cockpit_board_facts_pick(e.s_close, e.day, v_today, o.closes_with_value, e.closes_with_value)::int AS closes_with_value,
    public.cockpit_board_facts_pick(e.s_close, e.day, v_today, o.revenue_usd, e.revenue_usd) AS revenue_usd,
    public.cockpit_board_facts_pick(e.s_lq, e.day, v_today, o.lead_quality_sum, e.lq_sum) AS lead_quality_sum,
    public.cockpit_board_facts_pick(e.s_lq, e.day, v_today, o.lead_quality_count, e.lq_count)::int AS lead_quality_count,
    public.cockpit_board_facts_pick(e.s_dials, e.day, v_today, o.dials, e.dials)::int AS dials,
    public.cockpit_board_facts_pick(e.s_called, e.day, v_today, o.leads_called, e.leads_called)::int AS leads_called
  FROM eff e
  LEFT JOIN public.cockpit_client_days o ON o.location_id = e.location_id AND o.day = e.day;

  INSERT INTO public.cockpit_client_days AS d (location_id, day, crm_leads, crm_ad_leads, confirmed_bookings, provisional_bookings,
    meetings_due, shows, no_shows, no_outcome, quotations, quotation_answers, closes, closes_with_value, revenue_usd,
    lead_quality_sum, lead_quality_count, dials, leads_called, computed_at, sources)
  SELECT f.location_id, f.day, f.crm_leads, f.crm_ad_leads, f.confirmed_bookings, f.provisional_bookings,
    f.meetings_due, f.shows, f.no_shows, f.no_outcome, f.quotations, f.quotation_answers, f.closes, f.closes_with_value,
    f.revenue_usd, f.lead_quality_sum, f.lead_quality_count, f.dials, f.leads_called, v_now, coalesce(f.sources, '{}'::jsonb)
  FROM pg_temp._bf_fin f
  ON CONFLICT (location_id, day) DO UPDATE SET crm_leads = EXCLUDED.crm_leads, crm_ad_leads = EXCLUDED.crm_ad_leads,
    confirmed_bookings = EXCLUDED.confirmed_bookings, provisional_bookings = EXCLUDED.provisional_bookings,
    meetings_due = EXCLUDED.meetings_due, shows = EXCLUDED.shows, no_shows = EXCLUDED.no_shows, no_outcome = EXCLUDED.no_outcome,
    quotations = EXCLUDED.quotations, quotation_answers = EXCLUDED.quotation_answers, closes = EXCLUDED.closes,
    closes_with_value = EXCLUDED.closes_with_value, revenue_usd = EXCLUDED.revenue_usd,
    lead_quality_sum = EXCLUDED.lead_quality_sum, lead_quality_count = EXCLUDED.lead_quality_count,
    dials = EXCLUDED.dials, leads_called = EXCLUDED.leads_called, computed_at = EXCLUDED.computed_at, sources = EXCLUDED.sources;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- A closed day a complete read lowered: kept on the audit row.
  SELECT count(*), coalesce(jsonb_agg(z.j ORDER BY z.day DESC, z.location_id, z.metric) FILTER (WHERE z.rn <= 50), '[]'::jsonb)
  INTO v_drop_count, v_drops
  FROM (
    SELECT f.location_id, f.day, m.metric, row_number() OVER (ORDER BY f.day DESC, f.location_id, m.metric) AS rn,
      jsonb_build_object('location', f.location_id, 'day', f.day, 'metric', m.metric, 'from', m.old, 'to', m.new) AS j
    FROM pg_temp._bf_fin f
    CROSS JOIN LATERAL (VALUES
      ('crm_leads', f.o_crm_leads::numeric, f.crm_leads::numeric), ('crm_ad_leads', f.o_crm_ad_leads, f.crm_ad_leads),
      ('confirmed_bookings', f.o_confirmed_bookings, f.confirmed_bookings), ('provisional_bookings', f.o_provisional_bookings, f.provisional_bookings),
      ('meetings_due', f.o_meetings_due, f.meetings_due), ('shows', f.o_shows, f.shows), ('no_shows', f.o_no_shows, f.no_shows),
      ('no_outcome', f.o_no_outcome, f.no_outcome), ('quotations', f.o_quotations, f.quotations), ('closes', f.o_closes, f.closes),
      ('revenue_usd', f.o_revenue_usd, f.revenue_usd), ('lead_quality_count', f.o_lead_quality_count, f.lead_quality_count),
      ('dials', f.o_dials, f.dials), ('leads_called', f.o_leads_called, f.leads_called)
    ) m(metric, old, new)
    WHERE f.day < v_today AND m.old IS NOT NULL AND m.new IS NOT NULL AND m.new < m.old
  ) z;

  -- 5. State row and audit row ------------------------------------------------
  SELECT jsonb_object_agg(x.source, x.counts) INTO v_summary FROM (
    SELECT s.source, jsonb_object_agg(s.state, s.n) AS counts
    FROM (SELECT source, state, count(*) AS n FROM pg_temp._bf_src GROUP BY 1, 2) s GROUP BY 1
  ) x;
  v_ok := jsonb_array_length(v_failures) = 0;
  v_note := CASE WHEN v_ok
    THEN format('Refreshed %s clients for %s to %s.', v_clients, to_char(p_from, 'DD Mon'), to_char(p_to, 'DD Mon'))
    ELSE format('Refreshed %s clients for %s to %s, but %s could not be read; their figures stored before are kept.', v_clients,
      to_char(p_from, 'DD Mon'), to_char(p_to, 'DD Mon'),
      (SELECT string_agg(DISTINCT f->>'source', ', ') FROM jsonb_array_elements(v_failures) f)) END;
  SELECT s.detail INTO v_prev FROM public.cockpit_sync_state s WHERE s.key = 'board-facts';
  v_detail := jsonb_build_object('from', p_from, 'to', p_to, 'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000),
    'clients', v_clients, 'rows', v_rows, 'sources', coalesce(v_summary, '{}'::jsonb), 'failures', v_failures,
    'drops', v_drop_count,
    'lastDeepAt', CASE WHEN p_to - p_from >= 60 THEN to_jsonb(v_now) ELSE coalesce(v_prev->'lastDeepAt', 'null'::jsonb) END,
    'lastDeepFrom', CASE WHEN p_to - p_from >= 60 THEN to_jsonb(p_from) ELSE coalesce(v_prev->'lastDeepFrom', 'null'::jsonb) END,
    -- Whether the last 120-day fill read every source, and which it could
    -- not: a 30-minute run after it must not hide a failed fill.
    'lastDeepOk', CASE WHEN p_to - p_from >= 60 THEN to_jsonb(v_ok) ELSE coalesce(v_prev->'lastDeepOk', 'null'::jsonb) END,
    'lastDeepFailed', CASE WHEN p_to - p_from >= 60
      THEN coalesce((SELECT jsonb_agg(DISTINCT f->>'source') FROM jsonb_array_elements(v_failures) f), '[]'::jsonb)
      ELSE coalesce(v_prev->'lastDeepFailed', 'null'::jsonb) END);

  INSERT INTO public.cockpit_sync_state (key, last_run_at, last_ok_at, ok, note, rows_seen, detail, updated_at)
  VALUES ('board-facts', v_now, CASE WHEN v_ok THEN v_now END, v_ok, v_note, v_rows, v_detail, v_now)
  ON CONFLICT (key) DO UPDATE SET last_run_at = EXCLUDED.last_run_at,
    last_ok_at = CASE WHEN v_ok THEN EXCLUDED.last_run_at ELSE public.cockpit_sync_state.last_ok_at END,
    ok = EXCLUDED.ok, note = EXCLUDED.note, rows_seen = EXCLUDED.rows_seen, detail = EXCLUDED.detail, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, "before", "after")
  VALUES ('board_facts.refresh', 'cockpit_client_days', to_char(p_from, 'YYYY-MM-DD') || '..' || to_char(p_to, 'YYYY-MM-DD'),
    'board-facts', 'board', 'pg_cron', NULL,
    v_detail || jsonb_build_object('ok', v_ok, 'droppedDays', v_drops));

  RETURN jsonb_build_object('ok', v_ok, 'from', p_from, 'to', p_to, 'clients', v_clients, 'rows', v_rows,
    'failures', v_failures, 'drops', v_drop_count, 'note', v_note);
END;
$$;

-- The pg_cron entry. 'recent': today and the two days before. 'nightly': the
-- last 120 days. A refresh that stops says so on the state row.
CREATE OR REPLACE FUNCTION public.cockpit_board_facts_run(p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_from date;
  v_out jsonb;
  v_err text;
BEGIN
  IF p_mode = 'recent' THEN v_from := v_today - 2;
  ELSIF p_mode = 'nightly' THEN v_from := v_today - 119;
  ELSE RAISE EXCEPTION 'Choose recent (the last 3 days) or nightly (the last 120 days).' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_out := public.cockpit_board_facts_refresh(v_from, v_today);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO public.cockpit_sync_state (key, last_run_at, ok, note, updated_at)
    VALUES ('board-facts', now(), false, left('The board facts refresh stopped, so the board shows the figures from the last good run: ' || v_err, 500), now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, ok = false, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at;
    INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, "before", "after")
    VALUES ('board_facts.refresh_failed', 'cockpit_client_days', to_char(v_from, 'YYYY-MM-DD') || '..' || to_char(v_today, 'YYYY-MM-DD'),
      'board-facts', 'board', 'pg_cron', NULL, jsonb_build_object('mode', p_mode, 'error', left(v_err, 500)));
    v_out := jsonb_build_object('ok', false, 'error', v_err);
  END;
  RETURN v_out || jsonb_build_object('mode', p_mode);
END;
$$;

-- What is missing, in plain words, for the service key.
CREATE OR REPLACE FUNCTION public.cockpit_board_facts_doctor()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_jobs jsonb := '[]'::jsonb;
  v_state record;
  v_problems text[] := '{}';
  v_days jsonb;
  v_deep_at timestamptz;
  v_fail record;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT coalesce(jsonb_agg(jsonb_build_object(''name'', j.jobname, ''schedule'', j.schedule, ''active'', j.active) ORDER BY j.jobname), ''[]''::jsonb)
             FROM cron.job j WHERE j.jobname IN (''mahara-board-facts'', ''mahara-board-facts-nightly'')' INTO v_jobs;
    IF jsonb_array_length(v_jobs) < 2 THEN
      v_problems := v_problems || 'A board facts job is missing from pg_cron: apply the migration again.';
    END IF;
  ELSE
    v_problems := v_problems || 'pg_cron is not installed, so the board facts never refresh on their own.';
  END IF;
  SELECT s.last_run_at, s.last_ok_at, s.ok, s.note, s.detail INTO v_state FROM public.cockpit_sync_state s WHERE s.key = 'board-facts';
  IF v_state.last_run_at IS NULL THEN
    v_problems := v_problems || 'The board facts have never run: select public.cockpit_board_facts_run(''nightly'');';
  ELSIF v_state.last_run_at < now() - interval '2 hours' THEN
    v_problems := v_problems || format('The board facts last ran %s Kuwait time.', to_char(v_state.last_run_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'));
  END IF;
  IF v_state.ok IS FALSE THEN v_problems := v_problems || coalesce(v_state.note, 'The last run failed.'); END IF;
  -- The 120-day fill keeps leads called and late sheet closes current on
  -- days older than 3. A 30-minute run after a failed fill sets ok again, so
  -- the fill is checked on its own: its age, its last read, its last stop.
  v_deep_at := (v_state.detail->>'lastDeepAt')::timestamptz;
  IF v_state.detail IS NOT NULL AND v_deep_at IS NULL THEN
    v_problems := v_problems || 'The 120-day fill has not run yet: select public.cockpit_board_facts_run(''nightly'');';
  ELSIF v_deep_at < now() - interval '26 hours' THEN
    v_problems := v_problems || format('The 120-day fill last ran %s Kuwait time, so days older than 3 days (leads called, late sheet closes) have stopped refreshing.',
      to_char(v_deep_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'));
  END IF;
  IF v_deep_at IS NOT NULL AND (v_state.detail->>'lastDeepOk') = 'false' THEN
    v_problems := v_problems || format('The 120-day fill of %s Kuwait time could not read %s, so those figures are the ones stored before.',
      to_char(v_deep_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'),
      coalesce((SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(v_state.detail->'lastDeepFailed') x), 'every source'));
  END IF;
  SELECT a.created_at, a."after"->>'error' AS error INTO v_fail
  FROM public.cockpit_audit_log a
  WHERE a.action = 'board_facts.refresh_failed' AND a."after"->>'mode' = 'nightly'
    AND a.created_at > coalesce(v_deep_at, '-infinity'::timestamptz)
  ORDER BY a.created_at DESC LIMIT 1;
  IF v_fail.created_at IS NOT NULL THEN
    v_problems := v_problems || format('The 120-day fill stopped at %s Kuwait time: %s',
      to_char(v_fail.created_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'), left(coalesce(v_fail.error, 'no error recorded'), 300));
  END IF;
  SELECT jsonb_build_object('rows', count(*), 'clients', count(DISTINCT location_id), 'from', min(day), 'to', max(day))
  INTO v_days FROM public.cockpit_client_days;
  RETURN jsonb_build_object('ok', cardinality(v_problems) = 0, 'problems', to_jsonb(v_problems), 'jobs', v_jobs,
    'state', CASE WHEN v_state.last_run_at IS NULL THEN NULL ELSE jsonb_build_object('lastRunAt', v_state.last_run_at,
      'lastOkAt', v_state.last_ok_at, 'ok', v_state.ok, 'note', v_state.note, 'detail', v_state.detail) END,
    'days', v_days,
    'spine', (SELECT jsonb_build_object('clients', count(*), 'withAdAccount', count(*) FILTER (WHERE cardinality(ad_account_ids) > 0),
      'activeWithoutAdAccount', coalesce(jsonb_agg(client_name ORDER BY client_name) FILTER (WHERE status = 'Active' AND cardinality(ad_account_ids) = 0), '[]'::jsonb))
      FROM public.cockpit_board_clients));
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Privileges: revoked from all four roles; the doctor for the service key.

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['cockpit_board_norm(text)', 'cockpit_board_calendar_kind(text)', 'cockpit_board_usd_rate(text)',
    'cockpit_board_facts_pick(text,date,date,numeric,numeric)', 'cockpit_board_facts_refresh(date,date)',
    'cockpit_board_facts_run(text)', 'cockpit_board_facts_doctor()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_board_facts_doctor() TO service_role';
END $$;

COMMENT ON FUNCTION public.cockpit_board_facts_refresh(date,date) IS
  'Rebuilds cockpit_board_clients, cockpit_client_days for the Kuwait days p_from..p_to (at most 400) and cockpit_client_now. Run by pg_cron as postgres; writes the board-facts state row and one audit row.';

-- ---------------------------------------------------------------------------
-- 5. The jobs (pg_cron only where it exists)

-- cron:begin
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname IN (''mahara-board-facts'', ''mahara-board-facts-nightly'')';
    EXECUTE $q$SELECT cron.schedule('mahara-board-facts', '10,40 * * * *', $job$SELECT public.cockpit_board_facts_run('recent');$job$)$q$;
    EXECUTE $q$SELECT cron.schedule('mahara-board-facts-nightly', '50 0 * * *', $job$SELECT public.cockpit_board_facts_run('nightly');$job$)$q$;
  END IF;
END $$;
-- cron:end

NOTIFY pgrst, 'reload schema';

COMMIT;
