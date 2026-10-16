-- Client Performance board: the business facts, corrected after the second-source
-- check of 2026-10-16 (Creative Triage bldgtotkfmhoxmlzowdx).
--
-- The CEO, 2026-10-16: "check the numbers and even make it better and more
-- accurate". Three checks read every client's figures against Meta, the dialer's
-- report, the lead sync watch, the client sheets (Google Sheets, read live) and
-- the ClickUp roster. This file fixes, at the root, what they found in the facts
-- (20261016111157_board_facts.sql); docs/client-performance/SOURCES.md is the
-- record of every column's source of truth and the check table.
--
-- What changes, and why (the numbers are the 30 days 16 Sep to 15 Oct):
--   1. CRM ad leads counted Instagram and Facebook DM conversations: contacts on
--      the Meta channel with no ad id, no adSource, no fbclid (98 at active
--      clients; Ocean Home 139 against Meta's 115 form leads, all 115 of which
--      became contacts). crm_ad_leads is now a contact with an ad id, a Facebook
--      Ads source or an ad click id (attribution adSource, utmFbclid or fbc).
--      The DMs are counted apart in crm_dm_contacts and stay inside crm_leads:
--      the call centre calls them and the dialer's report counts them, and only
--      contacts tagged "inbound whatsapp" were taken out (DECISIONS 2026-10-15).
--   2. The client spine took status and service from the client registry
--      (ghl_clients), which disagreed with ClickUp on 7 clients: Shades Active on
--      its card but Launching, three clients lost on 20 Sep still Paused or
--      Ghosting. Status and service now come from the ClickUp card (the CSM
--      roster, cockpit_csm_sources 'clients'), the registry only where there is
--      no card. A Stopped client gets no new days, like a cancelled one. The
--      registry's word is kept in registry_status.
--   3. Spending ad accounts no tie could reach (Shades, Alkhalil's SAR boost
--      account, and for the history Pidco and AEA Designs) get a cockpit-owned
--      tie table, public.cockpit_board_account_ties, read first by the spine.
--      Its rows, each with its evidence, are in 20261016210200_board_account_ties.sql.
--      The registry's own ad account field (ghl_clients.meta_ad_account) was
--      never read; it is now the last tie: an account id written in it, or a
--      name equal to one Meta account's name (Shades would have tied itself).
--      The TikTok flag also takes the card's Ads Platform.
--   4. A booking the contact or the call centre replaced before its time was
--      still due: GoHighLevel leaves the old one "confirmed" (Alkhalil 8 meetings
--      due against 7 on the client's sheet, Atlantis 12 against 10). A main or
--      online meeting with no mark anywhere is left out of meetings due and no
--      outcome when the same contact booked another main or online meeting
--      after it was booked and before its time; the day's note counts them.
--   5. A call-centre RESCHEDULE or CALLBACK booking was counted as a new
--      confirmed booking (Alkhalil 8 against the dialer's 7). It still counts as
--      a meeting, not as a booking.
--   6. A sheet's show mark was lost when the CRM moved the meeting's time
--      (Atlantis 5 shows against the sheet's 6). The exact-time match stays
--      first; then the same contact's only meeting that day takes the sheet's
--      only mark that day.
--   7. Pending and lost deals were not kept, so a client with 25 deals pending
--      read 0% closed (Arcturus). closes_pending, closes_lost and
--      closes_answered (meetings whose deal is answered: won, lost or pending)
--      are new; close rate on answered meetings is closes / closes_answered.
--   8. Closes and quotations read 0 on a day whose due meetings nobody answered
--      (31 client-days; Ocean Home's October rows are blank). Such a day is now
--      NULL, the rule shows already follow.
--   9. Quotation N: the CSM sheet copy keeps N once its worker carries
--      quoteKeepsN (hermes/cockpit-sync/csmProviders.ts, same commit); from then
--      quotation_answers is the sheet's Y plus N, the larger per day of the sheet
--      and the portal.
--  10. Dials read 0 for the 15 clients the dialer does not list; they are NULL
--      with a note now.
--  11. Leads contacted counted a saved dialer outcome as contact with no Maqsam
--      call (City Wood 95% touched, 57% with a Maqsam call). cockpit_client_now
--      keeps touched and adds verified_called_30d and outcome_only_30d. A
--      done-with-you client stores no waiting figures (the call centre does not
--      call its leads), and a client with no lead in 30 days says so.
--  12. A day whose sources read later than the day's end is "so far": every
--      source on it carries partial: true while its last read is before the
--      day ended.
--  13. A failed sheet read left "stale" notes on old days until the nightly
--      run. The 30-minute run now runs the 120-day fill once (at most every 3
--      hours) when a source that was behind in the last fill reads again.
--  14. Leads uploaded in bulk (Ardon: 18 contacts in one hour on 13 Oct) are
--      named on their day: their creation day is not their form day.
--  15. The calendar "Project Review & Qualification Call" is the call centre's
--      callback calendar (3 CALLBACK bookings at Atlantis): kind callback,
--      as in triage.js calendarKind.
--  16. The sheet note named the tabs that have rows, so an empty October tab read
--      as a missing tab; it now says the month's tab has no rows yet.
--
-- Not here (another team, or upstream): the board's reads and screen; the
-- dialer's appointment facts that keep bookings GoHighLevel dropped; the Meta
-- side (20261016210100_meta_ad_days_checked.sql).
--
-- How we know it works: apps/media-buyer-cockpit/scripts/board-facts-supabase.test.ts
-- loads the first file and this one on PGlite and checks each rule above.
-- Safe to apply twice. Apply after 20261016111157_board_facts.sql, then
-- 20261016210200_board_account_ties.sql, then run
-- select public.cockpit_board_facts_run('nightly'); once.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regprocedure('public.cockpit_board_facts_refresh(date,date)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261016111157_board_facts.sql first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Tables and columns

CREATE TABLE IF NOT EXISTS public.cockpit_board_account_ties (
  account_id text PRIMARY KEY CHECK (account_id ~ '^[0-9]{5,25}$'),
  location_id text NOT NULL CHECK (location_id <> ''),
  evidence text NOT NULL CHECK (length(evidence) BETWEEN 10 AND 1000),
  added_by text NOT NULL CHECK (length(added_by) BETWEEN 1 AND 254),
  added_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cockpit_board_account_ties IS
  'Meta ad accounts tied to a client (GoHighLevel location) by hand, with the evidence. Read first by cockpit_board_facts_refresh''s spine, ahead of clients, ghl_client_ad_accounts and the name match, and even for an account hidden from the dashboards; Mahara''s own accounts are never tied. Cockpit-owned, so no other team''s table is written. Digits only, no act_.';
ALTER TABLE public.cockpit_board_account_ties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_board_account_ties FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_board_account_ties TO service_role;

ALTER TABLE public.cockpit_board_clients
  ADD COLUMN IF NOT EXISTS registry_status text,
  ADD COLUMN IF NOT EXISTS card_stage text;
COMMENT ON COLUMN public.cockpit_board_clients.status IS
  'The client''s status from its ClickUp card (Active; Launching for Brand Blueprint Booked, LAUNCH BOOKED, Ready For Launch, Needs Contacting; Paused; Stopped), the client registry''s (ghl_clients.status) where there is no card or the card says Stopped and the registry Cancelled. Stopped, Cancelled and Removed from sheet get no new days.';
COMMENT ON COLUMN public.cockpit_board_clients.registry_status IS 'ghl_clients.status as the registry has it; the doctor lists where it disagrees with the card.';
COMMENT ON COLUMN public.cockpit_board_clients.card_stage IS 'The ClickUp card''s stage as the CSM roster has it (cockpit_csm_sources clients.stage); NULL when the location has no card.';
COMMENT ON COLUMN public.cockpit_board_clients.service_mode IS 'DFY or DWY from the ClickUp card''s service, the registry''s service_mode where the card has none.';
COMMENT ON COLUMN public.cockpit_board_clients.tiktok IS 'The client may run TikTok: a stored TikTok advertiser or account, or Tiktok in the card''s Ads Platform. No TikTok spend is read anywhere, so its ad numbers are Meta only.';
COMMENT ON COLUMN public.cockpit_board_clients.ad_account_ties IS
  'How each ad account was tied: [{account, matchedBy, name}], matchedBy cockpit_board_account_ties, clients.ghl_location_id, ghl_client_ad_accounts, ghl_clients name or ghl_clients.meta_ad_account (the registry''s own field: an account id in it, or a name equal to one Meta account''s name).';

ALTER TABLE public.cockpit_client_days
  ADD COLUMN IF NOT EXISTS crm_dm_contacts integer CHECK (coalesce(crm_dm_contacts, 0) >= 0),
  ADD COLUMN IF NOT EXISTS closes_pending integer CHECK (coalesce(closes_pending, 0) >= 0),
  ADD COLUMN IF NOT EXISTS closes_lost integer CHECK (coalesce(closes_lost, 0) >= 0),
  ADD COLUMN IF NOT EXISTS closes_answered integer CHECK (coalesce(closes_answered, 0) >= 0);
COMMENT ON COLUMN public.cockpit_client_days.crm_ad_leads IS
  'The part of crm_leads that came from an ad: an ad id, or a Facebook Ads source or ad click id in the attribution (adSource, utmFbclid, fbc). Compare it with Meta''s form leads (cockpit_meta_ad_days.leads) as the delivery check; Instagram and Facebook DMs are crm_dm_contacts.';
COMMENT ON COLUMN public.cockpit_client_days.crm_dm_contacts IS
  'The part of crm_leads on the Meta channel with no ad evidence: Instagram and Messenger DM conversations. They stay in crm_leads (the call centre calls them, the dialer counts them) and are never ad leads.';
COMMENT ON COLUMN public.cockpit_client_days.meetings_due IS
  'Booked meetings on this day whose time has passed, on the main, online or provisional calendar as public.appointments holds them (the appointments sync has never carried the Not Confirmed calendar, so provisional bookings do not reach here), not cancelled or invalid, not Google copies, and not a booking the same contact replaced before its time with no mark on it (sources.appointments.note counts those).';
COMMENT ON COLUMN public.cockpit_client_days.confirmed_bookings IS
  'Main and online calendar bookings made this day, minus cancelled, invalid, Google Calendar copies and the call centre''s RESCHEDULE or CALLBACK replacements (a meeting moved is not a new booking). The dialer''s report also keeps bookings cancelled later; this does not.';
COMMENT ON COLUMN public.cockpit_client_days.quotations IS
  'Meetings this day with a quotation given: the larger of the sheet copy''s Y count and the portal''s true count. NULL when the client fills neither, or when meetings were due this day and none has a quotation answer.';
COMMENT ON COLUMN public.cockpit_client_days.quotation_answers IS
  'Meetings whose quotation was answered either way: the larger per day of the sheet copy''s Y plus N (once the copy keeps N, performance.quoteKeepsN) and the portal''s answers. NULL while the copy keeps only Y. Quotation rate = quotations / quotation_answers.';
COMMENT ON COLUMN public.cockpit_client_days.closes IS
  'Closed deals by meeting day: the sheet''s first closed meeting per contact and the portal''s won deals, one deal counted once. NULL when the client fills neither the sheet''s Closed column nor the portal''s deal, or when meetings were due this day and none has a deal answer.';
COMMENT ON COLUMN public.cockpit_client_days.closes_pending IS 'Meetings this day whose deal is marked pending: the sheet''s Closed P or the portal''s pending, one per contact, not a contact closed this day. NULL as closes.';
COMMENT ON COLUMN public.cockpit_client_days.closes_lost IS 'Meetings this day whose deal is marked lost: the sheet''s Closed N or the portal''s lost, one per contact, not a contact closed this day. NULL as closes.';
COMMENT ON COLUMN public.cockpit_client_days.closes_answered IS 'Meetings this day whose deal is answered (won, lost or pending in the sheet or the portal), one per contact: the close-rate denominator (closes / closes_answered). NULL as closes.';
COMMENT ON COLUMN public.cockpit_client_days.dials IS 'The dialer''s official dials: outcomes saved with a note, by the Kuwait day saved. NULL for a client the dialer does not list.';
COMMENT ON TABLE public.cockpit_client_days IS
  'One row per client location per Kuwait day for the Client Performance board, written only by cockpit_board_facts_refresh. NULL means the source could not be read or the client does not fill it; 0 means it was read and has nothing. sources holds {ok, state, as_of, note, from, partial} per source: leads, appointments, outcomes, sheet_marks, provisional, sheet, sheet_copy, dialer, dialer_leads; partial is true while the source''s last read is before the day ended (the day is "so far"); sheet also has unpricedCloses on a day with closes whose value is in no known currency, leads has bulkImport on a day 10 or more contacts arrived within one hour. state is ok (a complete read), stale (partial: a closed day is never lowered; as_of NULL means no record of a read, so it covers no day), failed or none (the stored figure is kept).';

ALTER TABLE public.cockpit_client_now
  ADD COLUMN IF NOT EXISTS verified_called_30d integer CHECK (coalesce(verified_called_30d, 0) >= 0),
  ADD COLUMN IF NOT EXISTS outcome_only_30d integer CHECK (coalesce(outcome_only_30d, 0) >= 0);
COMMENT ON COLUMN public.cockpit_client_now.verified_called_30d IS
  'Callable leads of the last 30 days with an outbound Maqsam call after they arrived (by contact, or by phone under another lead): the figure for the 90% line. NULL for a done-with-you client.';
COMMENT ON COLUMN public.cockpit_client_now.outcome_only_30d IS
  'Callable leads counted as touched only because a dialer outcome was saved, with no Maqsam call to the number (touched_30d - verified_called_30d). A caller dialling outside Maqsam, or an outcome saved without a call.';
COMMENT ON COLUMN public.cockpit_client_now.touched_share_30d IS 'touched_30d / callable_30d as a fraction from 0 to 1 (0.9 is 90%); NULL when no lead was callable or the client is done with you. Touched includes a saved outcome with no Maqsam call: verified_called_30d / callable_30d is the stricter share.';

-- ---------------------------------------------------------------------------
-- 2. Small rules

-- triage.js calendarKind: main, online, provisional, callback, reschedule, other.
-- The call centre's "Project Review & Qualification Call" calendar holds its
-- callbacks (CALLBACK dispositions only), so it is a callback calendar.
CREATE OR REPLACE FUNCTION public.cockpit_board_calendar_kind(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN coalesce(p_name, '') = '' THEN 'other'
    WHEN lower(p_name) ~ 'callback|call-back|معاودة|qualification|project review|مراجعة' THEN 'callback'
    WHEN lower(p_name) ~ 'not confirmed|provisional|tentative' THEN 'provisional'
    WHEN lower(p_name) ~ 'reschedul' THEN 'reschedule'
    WHEN lower(p_name) ~ 'appointment calendar|main appointment' THEN CASE WHEN lower(p_name) ~ 'online' THEN 'online' ELSE 'main' END
    ELSE 'other' END;
$$;

-- A ClickUp card stage as the board's status; NULL when the stage is not one
-- the board knows (the registry's status is used then).
CREATE OR REPLACE FUNCTION public.cockpit_board_card_status(p_stage text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_stage IS NULL OR btrim(p_stage) = '' THEN NULL
    WHEN lower(p_stage) ~ '^\s*active' THEN 'Active'
    WHEN lower(p_stage) ~ 'stop|cancel|churn|lost' THEN 'Stopped'
    WHEN lower(p_stage) ~ 'pause' THEN 'Paused'
    WHEN lower(p_stage) ~ 'blueprint|launch|ready|onboard|needs contacting|kick' THEN 'Launching'
  END;
$$;

-- Every source on a day whose end comes after the source's last read is "so
-- far": partial true, false otherwise. A source with no read time is left as it
-- is, and so are the portal's outcomes, whose as_of is the client's latest
-- report, not a read.
CREATE OR REPLACE FUNCTION public.cockpit_board_facts_partial(p_sources jsonb, p_day date) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(s.key, CASE
           WHEN jsonb_typeof(s.value) = 'object' AND s.key <> 'outcomes' AND nullif(s.value->>'as_of', '') IS NOT NULL
             THEN s.value || jsonb_build_object('partial', ((p_day + 1)::timestamp AT TIME ZONE 'Asia/Kuwait') > (s.value->>'as_of')::timestamptz)
           ELSE s.value END), '{}'::jsonb)
  FROM jsonb_each(coalesce(p_sources, '{}'::jsonb)) s;
$$;

-- ---------------------------------------------------------------------------
-- 3. The refresh (20261016111157 section 3, with the changes above; the live
-- body was read with pg_get_functiondef on 2026-10-16 and equals that file)

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
  v_stale jsonb;
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
    pg_temp._bf_calls, pg_temp._bf_coh, pg_temp._bf_att, pg_temp._bf_st, pg_temp._bf_fin, pg_temp._bf_rm,
    pg_temp._bf_cj, pg_temp._bf_cs, pg_temp._bf_rmd, pg_temp._bf_rs, pg_temp._bf_dm, pg_temp._bf_bulk, pg_temp._bf_rl,
    pg_temp._bf_regtie;
  -- fills: whether the client fills the source's column at all (the sheet's
  -- Closed marks, the sheet copy's Quotation Y); a source it does not fill
  -- gives nothing, never a 0.
  CREATE TEMP TABLE _bf_src (source text, location_id text, state text, as_of timestamptz, note text, cov_from date,
    cov_months date[], fills boolean, keeps_n boolean) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_v (location_id text, day date, metric text, value numeric) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_out (location_id text, appointment_id text, attendance text, deal text, quotation boolean,
    project_value numeric, currency text, lead_quality numeric, captured_at timestamptz) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_ap (location_id text, id text, contact_id text, contact_phone text, booked_at timestamptz,
    start_at timestamptz, status text, attended boolean, kind text, superseded boolean NOT NULL DEFAULT false) ON COMMIT DROP;
  -- The sheet's only mark on a contact's Kuwait day, for a meeting whose time
  -- the CRM moved; the call centre's RESCHEDULE and CALLBACK bookings; every
  -- deal answer (sheet Closed Y/N/P, portal won/lost/pending) per contact and
  -- meeting day; the hours in which one location got 10 or more contacts.
  CREATE TEMP TABLE _bf_rmd (location_id text, contact_id text, day date, mark boolean) ON COMMIT DROP;
  -- Every meeting the client's sheet lists (a row at that contact and time,
  -- marked or not): a booking the sheet lists is never a replaced one.
  CREATE TEMP TABLE _bf_rl (location_id text, contact_id text, meeting timestamptz) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_rs (id text PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_dm (location_id text, day date, who text, mark text) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_bulk (location_id text, day date, n integer) ON COMMIT DROP;
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
  CREATE TEMP TABLE _bf_cj (email text, last_success timestamptz, error text, active boolean, locs text[]) ON COMMIT DROP;
  CREATE TEMP TABLE _bf_cs (location_id text, last_success timestamptz, error text, jobs integer, state text) ON COMMIT DROP;

  -- 3.1 The client spine ------------------------------------------------------
  -- The client registry's own ad account field (ghl_clients.meta_ad_account),
  -- read last: an account id written in it ("718146936708597, SAR"), or a name
  -- equal to one Meta account's name in the ad-day store ("Shades"). Clients
  -- that are not cancelled, and a name only when it is unique on both sides.
  -- Before 2026-10-16 the field was never read, so Shades spent with no tie.
  -- An id counts only when it is a known ad account: on a clients row, a
  -- board card, or in the ad-day store.
  CREATE TEMP TABLE _bf_regtie (acct text, loc text) ON COMMIT DROP;
  INSERT INTO pg_temp._bf_regtie (acct, loc)
  SELECT DISTINCT m[1], btrim(g.location_id)
  FROM public.ghl_clients g CROSS JOIN LATERAL regexp_matches(coalesce(g.meta_ad_account, ''), '([0-9]{10,20})', 'g') m
  WHERE coalesce(g.status, '') NOT IN ('Cancelled', 'Removed from sheet') AND nullif(btrim(g.location_id), '') IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.clients c WHERE regexp_replace(lower(btrim(c.meta_ad_account_id)), '^act_', '') = m[1])
         OR EXISTS (SELECT 1 FROM public.cockpit_campaigns k WHERE regexp_replace(lower(btrim(k.meta_account_id)), '^act_', '') = m[1]));
  IF to_regclass('public.cockpit_meta_ad_days') IS NOT NULL THEN
    EXECUTE $q$
      INSERT INTO pg_temp._bf_regtie (acct, loc)
      SELECT DISTINCT m[1], btrim(g.location_id)
      FROM public.ghl_clients g CROSS JOIN LATERAL regexp_matches(coalesce(g.meta_ad_account, ''), '([0-9]{10,20})', 'g') m
      WHERE coalesce(g.status, '') NOT IN ('Cancelled', 'Removed from sheet') AND nullif(btrim(g.location_id), '') IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.cockpit_meta_ad_days d WHERE d.account_id = m[1])
        AND NOT EXISTS (SELECT 1 FROM pg_temp._bf_regtie t WHERE t.acct = m[1] AND t.loc = btrim(g.location_id))
    $q$;
    EXECUTE $q$
      INSERT INTO pg_temp._bf_regtie (acct, loc)
      SELECT d.account_id, r.loc
      FROM (SELECT x.account_id, public.cockpit_board_norm(max(x.account_name)) AS n
            FROM public.cockpit_meta_ad_days x GROUP BY 1) d
      JOIN (SELECT public.cockpit_board_norm(g.meta_ad_account) AS n, min(btrim(g.location_id)) AS loc, count(DISTINCT btrim(g.location_id)) AS k
            FROM public.ghl_clients g
            WHERE coalesce(g.status, '') NOT IN ('Cancelled', 'Removed from sheet') AND nullif(btrim(g.location_id), '') IS NOT NULL
              AND public.cockpit_board_norm(g.meta_ad_account) IS NOT NULL AND g.meta_ad_account !~ '[0-9]{10,20}'
            GROUP BY 1) r ON r.n = d.n AND r.k = 1
      WHERE d.n IS NOT NULL
        AND (SELECT count(DISTINCT y.account_id) FROM public.cockpit_meta_ad_days y WHERE public.cockpit_board_norm(y.account_name) = d.n) = 1
        AND NOT EXISTS (SELECT 1 FROM pg_temp._bf_regtie t WHERE t.acct = d.account_id)
    $q$;
  END IF;

  -- Ties: an account tied by hand (cockpit_board_account_ties, with its
  -- evidence) first, then lead-sync-watch's order, then the registry's field.
  -- A hand tie holds even for an account hidden from the dashboards; Mahara's
  -- own accounts are never tied.
  -- Status and service come from the ClickUp card (the CSM roster), the client
  -- registry where there is no card; the registry's status is kept beside it.
  WITH acc AS (
    SELECT regexp_replace(lower(btrim(c.meta_ad_account_id)), '^act_', '') AS acct, c.id, nullif(btrim(c.ghl_location_id), '') AS loc,
           c.name, coalesce(c.hidden_from_dashboard, false) AS hidden
    FROM public.clients c WHERE coalesce(c.meta_ad_account_id, '') <> ''
  ), cards AS (
    SELECT regexp_replace(lower(btrim(k.meta_account_id)), '^act_', '') AS acct, k.client_name AS name,
           coalesce(k.source_deleted, false) AS deleted
    FROM public.cockpit_campaigns k
    WHERE coalesce(k.meta_account_id, '') <> '' AND public.cockpit_board_norm(k.client_name) IS NOT NULL
  ), manual AS (
    SELECT regexp_replace(lower(btrim(m.account_id)), '^act_', '') AS acct, btrim(m.location_id) AS loc
    FROM public.cockpit_board_account_ties m
  ), accounts AS (
    SELECT acct FROM acc UNION SELECT acct FROM cards UNION SELECT acct FROM manual UNION SELECT acct FROM pg_temp._bf_regtie
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
        SELECT m.loc, 'cockpit_board_account_ties' AS how, NULL::text AS name, 0::numeric AS o FROM manual m WHERE m.acct = a.acct
        UNION ALL
        SELECT c.loc, 'clients.ghl_location_id', c.name, 1 FROM acc c WHERE c.acct = a.acct AND c.loc IS NOT NULL
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
        UNION ALL
        SELECT r.loc, 'ghl_clients.meta_ad_account', NULL, 5 FROM pg_temp._bf_regtie r WHERE r.acct = a.acct
      ) x ORDER BY x.o, x.loc LIMIT 1
    ) t
    WHERE a.acct ~ '^[0-9]{5,20}$'
      AND NOT EXISTS (SELECT 1 FROM acc h WHERE h.acct = a.acct
                      AND replace(coalesce(public.cockpit_board_norm(h.name), ''), ' ', '') IN ('maharamedia', 'maharamassdesign'))
      AND (EXISTS (SELECT 1 FROM manual m WHERE m.acct = a.acct)
           OR NOT EXISTS (SELECT 1 FROM acc h WHERE h.acct = a.acct AND h.hidden))
  ), tt AS (
    SELECT DISTINCT coalesce(nullif(btrim(c.ghl_location_id), ''), m.location_id) AS loc
    FROM public.clients c LEFT JOIN public.ghl_client_ad_accounts m ON m.client_id = c.id
    WHERE lower(coalesce(c.platform, '')) = 'tiktok' OR nullif(btrim(c.tiktok_advertiser_id), '') IS NOT NULL
  ), card AS (
    SELECT DISTINCT ON (s.data->>'taskId') s.data->>'taskId' AS task, nullif(btrim(s.data->>'stage'), '') AS stage,
      CASE upper(btrim(coalesce(s.data->>'service', ''))) WHEN 'DFY' THEN 'DFY' WHEN 'DWY' THEN 'DWY' END AS service
    FROM public.cockpit_csm_sources s
    WHERE s.table_name = 'clients' AND nullif(btrim(s.data->>'taskId'), '') IS NOT NULL
    ORDER BY s.data->>'taskId', s.source_snapshot_at DESC NULLS LAST
  ), prof AS (
    SELECT DISTINCT ON (s.data->>'taskId') s.data->>'taskId' AS task, s.data->>'adsPlatform' AS platform
    FROM public.cockpit_csm_sources s
    WHERE s.table_name = 'clientProfiles' AND nullif(btrim(s.data->>'taskId'), '') IS NOT NULL
    ORDER BY s.data->>'taskId', s.source_snapshot_at DESC NULLS LAST
  ), g AS (
    SELECT DISTINCT ON (btrim(x.location_id)) btrim(x.location_id) AS location_id, nullif(btrim(x.clickup_id), '') AS clickup_id,
           coalesce(nullif(btrim(x.client_name), ''), btrim(x.location_id)) AS client_name, x.status AS registry_status,
           CASE upper(btrim(coalesce(x.service_mode, ''))) WHEN 'DFY' THEN 'DFY' WHEN 'DWY' THEN 'DWY' END AS service_mode,
           nullif(btrim(x.tiktok_ad_account), '') IS NOT NULL AS tiktok_ghl
    FROM public.ghl_clients x WHERE nullif(btrim(x.location_id), '') IS NOT NULL
    ORDER BY btrim(x.location_id), x.synced_at DESC NULLS LAST
  ), sp AS (
    SELECT g.*, cd.stage AS card_stage, public.cockpit_board_card_status(cd.stage) AS card_status, cd.service AS card_service,
      coalesce(pf.platform, '') ~* 'tiktok' AS tiktok_card
    FROM g LEFT JOIN card cd ON cd.task = g.clickup_id LEFT JOIN prof pf ON pf.task = g.clickup_id
  )
  INSERT INTO public.cockpit_board_clients AS b (location_id, clickup_id, client_name, status, service_mode,
    ad_account_ids, ad_account_ties, tiktok, updated_at, registry_status, card_stage)
  SELECT sp.location_id, sp.clickup_id, sp.client_name,
    -- A Stopped card on a client the registry already calls Cancelled keeps
    -- the registry's word: the two mean the same.
    CASE WHEN sp.card_status IS NULL THEN sp.registry_status
         WHEN sp.card_status = 'Stopped' AND sp.registry_status IN ('Cancelled', 'Removed from sheet') THEN sp.registry_status
         ELSE sp.card_status END,
    coalesce(sp.card_service, sp.service_mode),
    coalesce((SELECT array_agg(t.acct ORDER BY t.acct) FROM tie t WHERE t.loc = sp.location_id), '{}'::text[]),
    coalesce((SELECT jsonb_agg(jsonb_build_object('account', t.acct, 'matchedBy', t.how, 'name', t.name) ORDER BY t.acct)
              FROM tie t WHERE t.loc = sp.location_id), '[]'::jsonb),
    sp.tiktok_ghl OR sp.tiktok_card OR EXISTS (SELECT 1 FROM tt WHERE tt.loc = sp.location_id),
    v_now, sp.registry_status, sp.card_stage
  FROM sp
  ON CONFLICT (location_id) DO UPDATE SET clickup_id = EXCLUDED.clickup_id, client_name = EXCLUDED.client_name,
    status = EXCLUDED.status, service_mode = EXCLUDED.service_mode, ad_account_ids = EXCLUDED.ad_account_ids,
    ad_account_ties = EXCLUDED.ad_account_ties, tiktok = EXCLUDED.tiktok, updated_at = EXCLUDED.updated_at,
    registry_status = EXCLUDED.registry_status, card_stage = EXCLUDED.card_stage
  WHERE (b.clickup_id, b.client_name, b.status, b.service_mode, b.ad_account_ids, b.ad_account_ties, b.tiktok, b.registry_status, b.card_stage)
        IS DISTINCT FROM (EXCLUDED.clickup_id, EXCLUDED.client_name, EXCLUDED.status, EXCLUDED.service_mode,
                          EXCLUDED.ad_account_ids, EXCLUDED.ad_account_ties, EXCLUDED.tiktok, EXCLUDED.registry_status, EXCLUDED.card_stage);

  CREATE TEMP TABLE _bf_loc ON COMMIT DROP AS
  SELECT b.location_id, b.clickup_id, b.client_name, b.service_mode
  FROM public.cockpit_board_clients b
  WHERE coalesce(b.status, '') NOT IN ('Cancelled', 'Removed from sheet', 'Stopped');
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
      CASE WHEN s.location_id IS NULL THEN 'The lead sync has no record of a run for this client, so only the leads found count and a day with none stays empty.'
           WHEN s.last_status IS DISTINCT FROM 'success' THEN format('The lead sync''s last run ended "%s"%s, so a closed day is never lowered and later days stay empty until it runs again.',
             coalesce(s.last_status, 'without a status'), coalesce(': ' || left(s.last_error, 160), ''))
           WHEN s.last_synced_at < v_now - v_fresh THEN format('The lead sync last ran %s Kuwait time, so a closed day is never lowered and later days stay empty until it runs again.',
             to_char(s.last_synced_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI')) END
    FROM pg_temp._bf_loc l LEFT JOIN public.lead_sync_state s ON s.location_id = l.location_id;

    -- An ad lead has an ad id, or a Facebook Ads source or ad click id in its
    -- attribution; a Meta-channel contact with none of them is an Instagram or
    -- Messenger DM conversation: counted apart, kept in CRM leads.
    INSERT INTO pg_temp._bf_v (location_id, day, metric, value)
    SELECT x.location_id, x.day, m.metric, count(*)
    FROM (
      SELECT cl.location_id, (cl.created_at AT TIME ZONE 'Asia/Kuwait')::date AS day, y.ad,
             (cl.channel = 'Meta' AND NOT y.ad) AS dm
      FROM public.client_leads cl
      CROSS JOIN LATERAL (SELECT (nullif(btrim(cl.ad_id), '') IS NOT NULL
        OR coalesce(jsonb_typeof(cl.attribution_raw) = 'object' AND cl.attribution_raw ?| array['adSource', 'utmFbclid', 'fbc'], false)) AS ad) y
      JOIN pg_temp._bf_loc l ON l.location_id = cl.location_id
      LEFT JOIN mahara_reporting.facts f ON f.namespace = 'production' AND f.source = 'ghl' AND f.kind = 'contact'
        AND f.external_id = cl.location_id || ':' || cl.ghl_contact_id
      WHERE NOT coalesce(cl.deleted, false) AND cl.created_at >= v_start AND cl.created_at < v_end
        AND NOT (nullif(cl.ad_id, '') IS NULL AND nullif(cl.campaign_id, '') IS NULL
                 AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.data->'tags') = 'array'
                              THEN f.data->'tags' ELSE '[]'::jsonb END) t(x) WHERE lower(btrim(t.x)) = 'inbound whatsapp'))
    ) x
    CROSS JOIN LATERAL (VALUES ('crm_leads', true), ('crm_ad_leads', x.ad), ('crm_dm_contacts', x.dm)) m(metric, keep)
    WHERE m.keep
    GROUP BY 1, 2, 3;

    -- Leads uploaded in bulk: an hour in which one location got 10 or more
    -- contacts (Ardon 18 within one hour on 13 Oct). Their creation day is the
    -- upload's, not the form's; the day's leads note says so.
    INSERT INTO pg_temp._bf_bulk (location_id, day, n)
    WITH c AS (
      SELECT cl.location_id, cl.created_at,
        count(*) OVER (PARTITION BY cl.location_id ORDER BY cl.created_at
                       RANGE BETWEEN CURRENT ROW AND interval '1 hour' FOLLOWING) AS n_next
      FROM public.client_leads cl JOIN pg_temp._bf_loc l ON l.location_id = cl.location_id
      WHERE NOT coalesce(cl.deleted, false) AND cl.created_at >= v_start - interval '1 hour' AND cl.created_at < v_end
    ), starts AS (
      SELECT c.location_id, c.created_at FROM c WHERE c.n_next >= 10
    )
    SELECT c.location_id, (c.created_at AT TIME ZONE 'Asia/Kuwait')::date, count(*)::int
    FROM c
    WHERE c.created_at >= v_start
      AND EXISTS (SELECT 1 FROM starts b WHERE b.location_id = c.location_id
                  AND c.created_at >= b.created_at AND c.created_at <= b.created_at + interval '1 hour')
    GROUP BY 1, 2;
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
        -- A client who reports in the portal but never marks a deal (won,
        -- lost or pending; "unknown" is the form's blank) or a quotation does
        -- not fill those fields: the portal gives none of them, so it never
        -- turns a day's closes or quotations into 0.
        CASE WHEN x.n > 0 AND x.deals = 0 AND x.quotes = 0 THEN 'The client''s portal reports mark no deal and no quotation yet, so the portal gives no closes and no quotations.'
             WHEN x.n > 0 AND x.deals = 0 THEN 'The client''s portal reports mark no deal yet, so the portal gives no closes.'
             WHEN x.n > 0 AND x.quotes = 0 THEN 'The client''s portal reports answer no quotation yet, so the portal gives no quotations.' END,
        CASE WHEN x.undated > 0 THEN format('%s portal outcome%s on an appointment this database does not hold %s left out.',
          x.undated, CASE WHEN x.undated = 1 THEN '' ELSE 's' END, CASE WHEN x.undated = 1 THEN 'is' ELSE 'are' END) END,
        CASE WHEN x.bad_lq > 0 THEN format('%s lead quality score%s outside 1 to 10 left out.', x.bad_lq, CASE WHEN x.bad_lq = 1 THEN '' ELSE 's' END) END), '')
    FROM pg_temp._bf_loc l
    CROSS JOIN LATERAL (
      SELECT count(*) AS n, max(o.captured_at) AS latest,
        count(*) FILTER (WHERE coalesce(o.deal, 'unknown') <> 'unknown') AS deals, count(*) FILTER (WHERE o.quotation IS NOT NULL) AS quotes,
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
    -- When the CRM moved the meeting's time (Atlantis: the sheet marks 13:00,
    -- the CRM holds 15:15), the exact match misses. The contact's only sheet
    -- row that Kuwait day gives its mark to the contact's only meeting that day
    -- (the second half of the match is in 3.4).
    INSERT INTO pg_temp._bf_rmd
    SELECT r.location_id, r.contact_id, (r.meeting AT TIME ZONE 'Asia/Kuwait')::date, bool_or(r.attendance = 'Y')
    FROM mahara_reporting.cc_results r JOIN pg_temp._bf_loc l ON l.location_id = r.location_id
    WHERE NOT r.conflict AND r.contact_id IS NOT NULL AND r.meeting >= v_start AND r.meeting < v_end
    GROUP BY 1, 2, 3
    HAVING count(*) = 1 AND bool_and(coalesce(r.attendance, '') IN ('Y', 'N'));
    INSERT INTO pg_temp._bf_rl
    SELECT DISTINCT r.location_id, r.contact_id, r.meeting
    FROM mahara_reporting.cc_results r JOIN pg_temp._bf_loc l ON l.location_id = r.location_id
    WHERE NOT r.conflict AND r.contact_id IS NOT NULL AND r.meeting >= v_start AND r.meeting < v_end;
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
        CASE WHEN s.location_id IS NULL THEN 'The appointments sync has no record of a run for this client, so only the bookings and meetings found count and a day with none stays empty.'
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

    -- A booking the contact or the call centre replaced before its time:
    -- GoHighLevel leaves the old one confirmed (Alkhalil, Atlantis). With no
    -- mark anywhere (CRM status, a sheet row at its time, marked or not, the
    -- portal) it is not a meeting due: the same contact booked another main
    -- or online meeting after it was booked and before its time. A booking
    -- replaced after its time stays (a likely no-show), and so does one with
    -- a mark or a row on the client's sheet (both meetings were real).
    UPDATE pg_temp._bf_ap a SET superseded = true
    WHERE a.kind IN ('main', 'online') AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid', 'showed', 'noshow')
      AND a.attended IS NULL AND a.contact_id IS NOT NULL AND a.booked_at IS NOT NULL AND a.start_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pg_temp._bf_out o WHERE o.location_id = a.location_id AND o.appointment_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM pg_temp._bf_rm r WHERE r.location_id = a.location_id AND r.contact_id = a.contact_id AND r.meeting = a.start_at)
      AND NOT EXISTS (SELECT 1 FROM pg_temp._bf_rl r WHERE r.location_id = a.location_id AND r.contact_id = a.contact_id AND r.meeting = a.start_at)
      AND EXISTS (
        SELECT 1 FROM public.appointments b
        LEFT JOIN LATERAL (
          SELECT c.name FROM public.ghl_calendars c WHERE c.calendar_id = b.calendar_id
          ORDER BY (c.location_id = a.location_id) DESC, c.synced_at DESC NULLS LAST LIMIT 1
        ) bc ON true
        WHERE b.ghl_contact_id = a.contact_id AND b.ghl_appointment_id <> a.id
          AND coalesce(nullif(b.ghl_location_id, ''), nullif(b.ghl_location, '')) = a.location_id
          AND coalesce(b.ghl_source, '') <> 'google_calendar' AND coalesce(b.status, '') NOT IN ('cancelled', 'invalid')
          AND b.booked_at > a.booked_at AND b.booked_at < a.start_at
          AND public.cockpit_board_calendar_kind(bc.name) IN ('main', 'online'));
    UPDATE pg_temp._bf_src s SET note = concat_ws(' ', s.note, format('%s booking%s the contact replaced before %s time, with no mark, %s left out of meetings due.',
        x.n, CASE WHEN x.n = 1 THEN '' ELSE 's' END, CASE WHEN x.n = 1 THEN 'its' ELSE 'their' END, CASE WHEN x.n = 1 THEN 'is' ELSE 'are' END))
    FROM (SELECT a.location_id, count(*) AS n FROM pg_temp._bf_ap a
          WHERE a.superseded AND a.start_at >= v_start AND a.start_at < v_end AND a.start_at <= v_now GROUP BY 1) x
    WHERE s.source = 'appointments' AND s.location_id = x.location_id;

    -- The call centre's RESCHEDULE and CALLBACK bookings move a meeting or book
    -- a call back: not a new booking (the dialer's own rule). They still count
    -- as meetings.
    INSERT INTO pg_temp._bf_rs (id)
    SELECT DISTINCT k.id
    FROM mahara_reporting.cc_attempts a
    CROSS JOIN LATERAL (VALUES (a.data->'bookingVerification'->>'id'),
      (CASE WHEN a.data->'disposition'->>'outcome' = 'RESCHEDULE' AND nullif(a.data->>'originalAppointmentId', '') IS NOT NULL
            THEN a.appointment_id END)) k(id)
    WHERE a.data->'disposition'->>'outcome' IN ('RESCHEDULE', 'CALLBACK') AND nullif(k.id, '') IS NOT NULL
      AND a.location_id IN (SELECT location_id FROM pg_temp._bf_loc)
    ON CONFLICT DO NOTHING;

    INSERT INTO pg_temp._bf_v (location_id, day, metric, value)
    SELECT a.location_id, (a.booked_at AT TIME ZONE 'Asia/Kuwait')::date, 'confirmed_bookings', count(*)
    FROM pg_temp._bf_ap a
    WHERE a.kind IN ('main', 'online') AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid')
      AND a.booked_at >= v_start AND a.booked_at < v_end
      AND NOT EXISTS (SELECT 1 FROM pg_temp._bf_rs r WHERE r.id = a.id)
    GROUP BY 1, 2;

    -- Meetings whose time has passed, with the portal's latest outcome. The
    -- sheet's mark: at the meeting's time, else the contact's only sheet row
    -- that day for the contact's only meeting that day.
    INSERT INTO pg_temp._bf_v (location_id, day, metric, value)
    SELECT m.location_id, m.day, k.metric, sum(k.v)
    FROM (
      SELECT a.location_id, a.day,
        CASE WHEN a.status = 'showed' THEN 'showed' WHEN a.status = 'noshow' THEN 'noshow'
             WHEN coalesce(a.attended, sm.mark, sd.mark) IS TRUE OR o.attendance = 'showed' THEN 'showed'
             WHEN coalesce(a.attended, sm.mark, sd.mark) IS FALSE OR o.attendance = 'no_show' THEN 'noshow' ELSE 'unknown' END AS att,
        (o.appointment_id IS NULL AND coalesce(a.attended, sm.mark, sd.mark) IS NULL) AS no_outcome,
        CASE WHEN o.lead_quality BETWEEN 1 AND 10 THEN o.lead_quality END AS lq,
        o.quotation
      FROM (
        SELECT a.*, (a.start_at AT TIME ZONE 'Asia/Kuwait')::date AS day,
          count(*) OVER (PARTITION BY a.location_id, a.contact_id, (a.start_at AT TIME ZONE 'Asia/Kuwait')::date) AS same_day
        FROM pg_temp._bf_ap a
        WHERE a.kind IN ('main', 'online', 'provisional') AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid') AND NOT a.superseded
      ) a
      LEFT JOIN pg_temp._bf_out o ON o.location_id = a.location_id AND o.appointment_id = a.id
      LEFT JOIN pg_temp._bf_rm sm ON sm.location_id = a.location_id AND sm.contact_id = a.contact_id AND sm.meeting = a.start_at
      LEFT JOIN pg_temp._bf_rmd sd ON sm.location_id IS NULL AND a.same_day = 1 AND sd.location_id = a.location_id
        AND sd.contact_id = a.contact_id AND sd.day = a.day
      WHERE a.start_at >= v_start AND a.start_at < v_end AND a.start_at <= v_now
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

    -- Every deal the client answered in the portal (won, lost, pending), per
    -- contact and meeting day, for closes answered, pending and lost.
    INSERT INTO pg_temp._bf_dm (location_id, day, who, mark)
    SELECT a.location_id, (a.start_at AT TIME ZONE 'Asia/Kuwait')::date,
      coalesce(a.contact_id, 'p:' || nullif(right(regexp_replace(coalesce(a.contact_phone, ''), '[^0-9]', '', 'g'), 8), ''), 'a:' || a.id),
      CASE o.deal WHEN 'won' THEN 'Y' WHEN 'lost' THEN 'N' ELSE 'P' END
    FROM pg_temp._bf_ap a
    JOIN pg_temp._bf_out o ON o.location_id = a.location_id AND o.appointment_id = a.id
    WHERE o.deal IN ('won', 'lost', 'pending') AND a.kind IN ('main', 'online', 'provisional')
      AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid')
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
      CASE WHEN j.last_success IS NULL THEN 'The dialer has no appointment sync for this client, so only the provisional bookings found count and a day with none stays empty.'
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
             ELSE (date_trunc('month', coalesce(p.synced_at, v_now) AT TIME ZONE 'Asia/Kuwait') - interval '1 month')::date END AS cov_from,
        -- The client fills the Quotation column when any row the copy holds
        -- says Y, or N once the copy keeps N (performance.quoteKeepsN, from
        -- csmProviders.ts). Before that the copy drops N, so a client who
        -- writes only N cannot be told from one who writes nothing.
        EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.perf->'appointments') = 'array' THEN p.perf->'appointments' ELSE '[]'::jsonb END) r
                WHERE lower(btrim(coalesce(r->>'quote', ''))) = 'y'
                   OR (lower(btrim(coalesce(r->>'quote', ''))) = 'n' AND coalesce(p.perf->>'quoteKeepsN', '') = 'true')) AS fills,
        coalesce(p.perf->>'quoteKeepsN', '') = 'true' AS keeps_n
      FROM pg_temp._bf_loc l LEFT JOIN prof p ON p.task_id = l.clickup_id
    ), ins_src AS (
      INSERT INTO pg_temp._bf_src (source, location_id, state, as_of, note, cov_from, fills, keeps_n)
      SELECT 'sheet_copy', j.location_id, j.state, j.synced_at,
        CASE WHEN j.state = 'none' THEN 'No client sheet copy for this client (the CSM profile has no sheet read).'
             ELSE nullif(concat_ws(' ',
               CASE WHEN j.state = 'stale' THEN format('The client sheet was last read %s Kuwait time, so a closed day is never lowered and later days wait for the next read.',
                 coalesce(to_char(j.synced_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'), 'at an unknown time')) END,
               CASE WHEN j.cov_from IS NOT NULL THEN format('The sheet copy holds month tabs from %s; earlier days keep the figures stored before.', to_char(j.cov_from, 'DD Mon YYYY')) END,
               CASE WHEN NOT j.fills AND j.keeps_n THEN 'The client''s sheet has no Y or N in the Quotation column yet, so the sheet gives no quotations.'
                    WHEN NOT j.fills THEN 'The client''s sheet has no Y in the Quotation column yet, so the sheet gives no quotations.'
                    WHEN NOT j.keeps_n THEN 'The copy keeps only Y in the Quotation column, so answered quotations are not known.' END), '') END,
        j.cov_from, j.state <> 'none' AND j.fills, j.state <> 'none' AND j.keeps_n
      FROM joined j
      RETURNING 1
    )
    -- q_sheet: the Y rows; q_sheet_answered: Y and, once the copy keeps it, N.
    INSERT INTO pg_temp._bf_v (location_id, day, metric, value)
    SELECT j.location_id, (r->>'appAt')::date, m.metric, count(*)
    FROM joined j
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(j.perf->'appointments') = 'array' THEN j.perf->'appointments' ELSE '[]'::jsonb END) r
    CROSS JOIN LATERAL (VALUES ('q_sheet', lower(coalesce(r->>'quote', '')) = 'y'),
      ('q_sheet_answered', lower(coalesce(r->>'quote', '')) = 'y' OR (j.keeps_n AND lower(coalesce(r->>'quote', '')) = 'n'))) m(metric, keep)
    WHERE j.state <> 'none' AND m.keep AND coalesce(r->>'appAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND (r->>'appAt')::date BETWEEN p_from AND p_to
    GROUP BY 1, 2, 3;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO pg_temp._bf_src (source, location_id, state, note)
    SELECT 'sheet_copy', l.location_id, 'failed', 'The client sheet copy could not be read, so the figures stored before are kept: ' || left(v_err, 200)
    FROM pg_temp._bf_loc l;
    v_failures := v_failures || jsonb_build_object('source', 'sheet_copy', 'error', left(v_err, 300));
  END;

  -- 3.7 The client sheets (the dialer's cc_results): closes and values -------
  BEGIN
    INSERT INTO pg_temp._bf_src (source, location_id, state, as_of, note, cov_from, cov_months, fills)
    SELECT 'sheet', l.location_id, x.state, s.checked_at,
      CASE WHEN x.state = 'none' THEN 'The dialer reads no sheet for this client.'
           ELSE nullif(concat_ws(' ',
             CASE WHEN NOT x.fills AND s.data IS NOT NULL AND (s.data->>'sheetId') IS NOT DISTINCT FROM s.sheet_id
                  THEN 'The client''s sheet has no Closed marks yet, so the sheet gives no closes or revenue.' END,
             CASE WHEN s.data IS NULL OR (s.data->>'sheetId') IS DISTINCT FROM s.sheet_id THEN 'The stored sheet rows belong to another sheet, so a closed day is never lowered.'
                  WHEN s.error IS NOT NULL THEN 'The last sheet read failed and its earlier rows are used, so a closed day is never lowered and later days wait for the next read: ' || left(s.error, 120)
                  WHEN NOT coalesce(s.active, false) THEN 'The sheet is switched off in the dialer, so a closed day is never lowered.'
                  WHEN s.checked_at < v_now - v_fresh THEN format('The sheet was last read %s Kuwait time, so a closed day is never lowered and later days wait for the next read.',
                    to_char(s.checked_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI')) END,
             -- The dialer keeps only filled rows, so a month tab with no rows
             -- yet looks the same as a missing tab: the note says the tab has
             -- no rows, so client success asks the client to fill it.
             CASE WHEN cardinality(x.months) = 0 THEN 'The sheet has no rows in any month tab yet, so it covers no day.'
                  ELSE concat_ws(' ', format('The sheet has rows in the month tab%s %s; days in other months keep the figures stored before.',
                    CASE WHEN cardinality(x.months) = 1 THEN '' ELSE 's' END,
                    (SELECT string_agg(to_char(m, 'Mon YYYY'), ', ' ORDER BY m) FROM unnest(x.months) m)),
                    CASE WHEN date_trunc('month', v_today::timestamp)::date <> ALL (x.months)
                         THEN format('Its %s tab has no rows yet, so %s is not covered until the client fills it.',
                           to_char(v_today, 'Mon YY'), to_char(v_today, 'FMMonth')) END) END), '') END,
      x.months[1], x.months, x.state <> 'none' AND x.fills
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
                      WHERE coalesce(r->>'tab', '') ~ '^[A-Z][a-z]{2} [0-9]{2}$') t), '{}'::date[]) END AS months,
             -- The client fills the Closed column when any row it holds has a
             -- mark there (Y, N, P or anything else); a sheet whose Closed
             -- column is blank on every row gives no closes, never 0.
             s.id IS NOT NULL AND s.data IS NOT NULL AND (s.data->>'sheetId') IS NOT DISTINCT FROM s.sheet_id
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.data->'rows') = 'array' THEN s.data->'rows' ELSE '[]'::jsonb END) r
                           WHERE nullif(btrim(coalesce(r->>'closed', '')), '') IS NOT NULL) AS fills
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
    -- Every Closed answer on the sheet (Y, N, P), per contact and meeting day,
    -- for closes answered, pending and lost.
    INSERT INTO pg_temp._bf_dm (location_id, day, who, mark)
    SELECT r.location_id, (r.meeting AT TIME ZONE 'Asia/Kuwait')::date,
      coalesce(r.contact_id, 'p:' || nullif(right(regexp_replace(coalesce(r.phone, ''), '[^0-9]', '', 'g'), 8), '')),
      upper(btrim(r.closed))
    FROM mahara_reporting.cc_results r
    JOIN pg_temp._bf_loc l ON l.location_id = r.location_id
    WHERE NOT r.conflict AND upper(btrim(coalesce(r.closed, ''))) IN ('Y', 'N', 'P')
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

  -- Deals answered per meeting day, one per contact: won before lost before
  -- pending when the sheet and the portal both answer.
  INSERT INTO pg_temp._bf_v (location_id, day, metric, value)
  SELECT d.location_id, d.day, k.metric, sum(k.v)
  FROM (
    SELECT x.location_id, x.day, x.who,
      CASE WHEN bool_or(x.mark = 'Y') THEN 'Y' WHEN bool_or(x.mark = 'N') THEN 'N' ELSE 'P' END AS mark
    FROM pg_temp._bf_dm x WHERE x.who IS NOT NULL GROUP BY 1, 2, 3
  ) d
  CROSS JOIN LATERAL (VALUES ('closes_answered', 1::numeric), ('closes_pending', (d.mark = 'P')::int),
    ('closes_lost', (d.mark = 'N')::int)) k(metric, v)
  GROUP BY 1, 2, 3;

  -- 3.8 The dialer: official dials, leads called, first call in working time -
  BEGIN
    -- The events are read up to now, whatever the window: the last 30 days'
    -- median first call is taken from them, and a refresh of past days must
    -- not leave it short. The day facts below keep to the window.
    PERFORM pg_catalog.set_config('enable_nestloop', 'off', true);
    EXECUTE 'INSERT INTO pg_temp._bf_dl (location_id, contact_id, kind, event_at, first_dial, speed)
      SELECT e.location_id, e.contact_id, e.kind, e.event_at, (e.data->>''firstDialAt'') IS NOT NULL,
             CASE WHEN e.kind = ''lead'' THEN (e.data->>''speedSeconds'')::numeric END
      FROM mahara_reporting.call_center_events e
      WHERE e.kind IN (''lead'', ''outcome'') AND e.event_at >= $1 AND e.event_at < $2 AND e.location_id = ANY($3)'
    USING v_ev_start, v_now, (SELECT coalesce(array_agg(location_id), '{}'::text[]) FROM pg_temp._bf_loc);
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

    -- How current the Maqsam calls are. The dialer syncs them with one job
    -- per caller (sync_jobs kind calls, its location_id the caller's email),
    -- so a client's leads called are only as current as the oldest job of the
    -- active callers assigned to it; with none assigned, of every active
    -- caller; with no active caller, of every calls job. Leads called and who
    -- is waiting both rest on these calls.
    INSERT INTO pg_temp._bf_cj (email, last_success, error, active, locs)
    SELECT lower(btrim(s.location_id)), s.last_success, nullif(btrim(s.error), ''),
      EXISTS (SELECT 1 FROM mahara_console.metadata m WHERE m.namespace = 'production' AND m.id LIKE 'access:agent:%'
              AND m.data->>'active' = 'true' AND lower(btrim(m.data->>'email')) = lower(btrim(s.location_id))),
      ARRAY(SELECT DISTINCT x.loc FROM mahara_console.metadata m
            CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(m.data->'locationIds') = 'array'
                                                              THEN m.data->'locationIds' ELSE '[]'::jsonb END) x(loc)
            WHERE m.namespace = 'production' AND m.id LIKE 'access:agent:%' AND m.data->>'active' = 'true'
              AND lower(btrim(m.data->>'email')) = lower(btrim(s.location_id)))
    FROM mahara_reporting.sync_jobs s
    WHERE s.namespace = 'production' AND s.kind = 'calls';
    INSERT INTO pg_temp._bf_cs (location_id, last_success, error, jobs, state)
    SELECT l.location_id, j.last_success, j.error, coalesce(j.n, 0),
      CASE WHEN j.n IS NULL OR j.last_success IS NULL OR j.error IS NOT NULL OR j.last_success < v_now - v_fresh THEN 'stale' ELSE 'ok' END
    FROM pg_temp._bf_loc l
    LEFT JOIN LATERAL (
      SELECT y.last_success, y.error, y.n FROM (
        SELECT 1 AS o, min(c.last_success) AS last_success, max(c.error) AS error, count(*) AS n
        FROM pg_temp._bf_cj c WHERE c.active AND l.location_id = ANY(c.locs)
        UNION ALL
        SELECT 2, min(c.last_success), max(c.error), count(*) FROM pg_temp._bf_cj c WHERE c.active
        UNION ALL
        SELECT 3, min(c.last_success), max(c.error), count(*) FROM pg_temp._bf_cj c
      ) y WHERE y.n > 0 ORDER BY y.o LIMIT 1
    ) j ON true;

    INSERT INTO pg_temp._bf_src (source, location_id, state, as_of, note)
    SELECT x.source, l.location_id,
      -- A client the dialer does not list has no dials and no leads called
      -- to count: both are unknown (NULL), never 0.
      CASE WHEN NOT EXISTS (SELECT 1 FROM mahara_reporting.cc_clients c WHERE c.id = l.location_id) THEN 'none'
           WHEN x.source = 'dialer_leads' THEN cs.state ELSE 'ok' END,
      CASE WHEN x.source = 'dialer' THEN (SELECT to_timestamp(max(a.updated) / 1000.0) FROM mahara_console.attempts a WHERE a.namespace = 'production')
           ELSE cs.last_success END,
      nullif(concat_ws(' ',
        CASE WHEN x.source = 'dialer' AND NOT EXISTS (SELECT 1 FROM mahara_reporting.cc_clients c WHERE c.id = l.location_id)
             THEN 'The dialer does not list this client, so its dials are not known.'
             WHEN x.source = 'dialer_leads' AND NOT EXISTS (SELECT 1 FROM mahara_reporting.cc_clients c WHERE c.id = l.location_id)
             THEN 'The dialer does not list this client, so its leads called are not known.'
             WHEN x.source = 'dialer_leads' AND cs.state = 'stale' THEN
               CASE WHEN cs.jobs = 0 OR cs.last_success IS NULL THEN 'The dialer has no record of a Maqsam call sync, so only the leads found called count and a day with none stays empty.'
                    WHEN cs.error IS NOT NULL THEN format('The Maqsam call sync reports an error (last success %s Kuwait time), so a closed day is never lowered and later days stay empty until it succeeds: %s',
                      to_char(cs.last_success AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'), left(cs.error, 160))
                    ELSE format('The Maqsam call sync last ran %s Kuwait time, so a closed day is never lowered and later days stay empty until it runs again.',
                      to_char(cs.last_success AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI')) END END,
        CASE WHEN x.source = 'dialer_leads' AND ch.n > 0
             THEN format('%s WhatsApp chat contact%s the dialer called in these days %s left out, as in CRM leads.',
               ch.n, CASE WHEN ch.n = 1 THEN '' ELSE 's' END, CASE WHEN ch.n = 1 THEN 'is' ELSE 'are' END) END,
        CASE WHEN l.service_mode = 'DWY' THEN 'Done with you: the call centre does not call this client''s leads.' END,
        CASE WHEN EXISTS (SELECT 1 FROM mahara_console.metadata m WHERE m.namespace = 'production' AND m.id = 'access:client:' || l.location_id
                          AND m.data->>'active' = 'false') THEN 'This client is switched off in the dialer.' END), '')
    FROM pg_temp._bf_loc l CROSS JOIN (VALUES ('dialer'), ('dialer_leads')) x(source)
    JOIN pg_temp._bf_cs cs ON cs.location_id = l.location_id
    CROSS JOIN LATERAL (
      SELECT count(*) AS n FROM pg_temp._bf_dl d
      WHERE d.location_id = l.location_id AND d.kind = 'lead' AND d.chat AND d.first_dial AND d.event_at >= v_start AND d.event_at < v_end
    ) ch;

    INSERT INTO pg_temp._bf_v (location_id, day, metric, value)
    SELECT d.location_id, (d.event_at AT TIME ZONE 'Asia/Kuwait')::date, CASE WHEN d.kind = 'outcome' THEN 'dials' ELSE 'leads_called' END, count(*)
    FROM pg_temp._bf_dl d
    WHERE d.event_at >= v_start AND d.event_at < v_end AND (d.kind = 'outcome' OR (d.first_dial AND NOT d.chat))
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

    -- Touched keeps cockpit_client_calls' rule (a call by contact, a call to
    -- the phone under another lead, or a saved attempt). Verified is a Maqsam
    -- call only: a saved outcome with no call to the number is counted apart
    -- (City Wood 42 of 44 touched, 25 of 44 called). A done-with-you client's
    -- leads are not the call centre's, so it stores no waiting figures.
    INSERT INTO public.cockpit_client_now AS n (location_id, untouched_leads, oldest_untouched_at, touched_share_30d,
      callable_30d, touched_30d, first_call_median_work_seconds_30d, computed_at, note, verified_called_30d, outcome_only_30d)
    SELECT l.location_id,
      CASE WHEN l.service_mode = 'DWY' THEN NULL ELSE coalesce(w.untouched, 0) END,
      CASE WHEN l.service_mode = 'DWY' THEN NULL ELSE w.oldest END,
      CASE WHEN l.service_mode IS DISTINCT FROM 'DWY' AND coalesce(w.callable, 0) > 0 THEN round(w.touched::numeric / w.callable, 4) END,
      CASE WHEN l.service_mode = 'DWY' THEN NULL ELSE coalesce(w.callable, 0) END,
      CASE WHEN l.service_mode = 'DWY' THEN NULL ELSE coalesce(w.touched, 0) END,
      sp.median, v_now,
      nullif(concat_ws(' ',
        CASE WHEN l.service_mode = 'DWY' THEN 'Done with you: the call centre does not call this client''s leads, so there is no verdict.' END,
        CASE WHEN l.service_mode IS DISTINCT FROM 'DWY' AND NOT EXISTS (SELECT 1 FROM mahara_reporting.cc_clients c WHERE c.id = l.location_id)
             THEN 'The dialer does not list this client, so no caller is working these leads.' END,
        CASE WHEN EXISTS (SELECT 1 FROM mahara_console.metadata m WHERE m.namespace = 'production' AND m.id = 'access:client:' || l.location_id
                          AND m.data->>'active' = 'false') THEN 'This client is switched off in the dialer, so no new leads reach the callers.' END,
        CASE WHEN l.service_mode = 'DWY' THEN NULL
             WHEN coalesce(w.leads, 0) = 0 THEN 'No leads in the last 30 days.'
             WHEN coalesce(w.callable, 0) = 0 THEN 'No lead from the last 30 days is old enough to judge yet (one working hour).' END,
        CASE WHEN l.service_mode IS DISTINCT FROM 'DWY' AND coalesce(w.touched, 0) > coalesce(w.verified, 0)
             THEN format('%s of the %s touched lead%s had a dialer outcome saved but no Maqsam call to the number.',
               w.touched - w.verified, w.touched, CASE WHEN w.touched = 1 THEN '' ELSE 's' END) END,
        CASE WHEN EXISTS (SELECT 1 FROM pg_temp._bf_sch s WHERE s.location_id = l.location_id AND s.is_default)
             THEN 'No assigned caller has hours on Team & Payroll, so working time is 10:00 to 18:00 Kuwait time, Friday off.' END,
        CASE WHEN w.chats > 0 THEN format('%s WhatsApp chat contact%s left out (tagged inbound whatsapp, no ad).', w.chats, CASE WHEN w.chats = 1 THEN ' is' ELSE 's are' END) END,
        CASE WHEN cs.state = 'stale' AND l.service_mode IS DISTINCT FROM 'DWY' THEN
          CASE WHEN cs.last_success IS NULL THEN 'The dialer has no record of a Maqsam call sync, so leads already called may still show as waiting.'
               WHEN cs.error IS NOT NULL THEN format('The Maqsam call sync reports an error (last success %s Kuwait time), so leads called since then may still show as waiting.',
                 to_char(cs.last_success AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'))
               ELSE format('The Maqsam call sync last ran %s Kuwait time, so leads called since then may still show as waiting.',
                 to_char(cs.last_success AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI')) END END,
        CASE WHEN NOT v_dialer_ok THEN 'The dialer''s report could not be read, so the median first call is the one stored before.' END), ''),
      CASE WHEN l.service_mode = 'DWY' THEN NULL ELSE coalesce(w.verified, 0) END,
      CASE WHEN l.service_mode = 'DWY' THEN NULL ELSE coalesce(w.touched, 0) - coalesce(w.verified, 0) END
    FROM pg_temp._bf_loc l
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE NOT c.chat AND c.callable) AS callable,
             count(*) FILTER (WHERE NOT c.chat AND c.callable AND c.touched) AS touched,
             count(*) FILTER (WHERE NOT c.chat AND c.callable AND NOT c.touched) AS untouched,
             min(c.created_at) FILTER (WHERE NOT c.chat AND c.callable AND NOT c.touched) AS oldest,
             count(*) FILTER (WHERE c.chat) AS chats,
             count(*) FILTER (WHERE NOT c.chat) AS leads,
             count(*) FILTER (WHERE NOT c.chat AND c.callable AND c.verified) AS verified
      FROM (
        SELECT v.*, (v.verified OR EXISTS (SELECT 1 FROM pg_temp._bf_att a WHERE a.location_id = v.location_id AND a.contact_id = v.contact_id)) AS touched
        FROM (
        SELECT h.location_id, h.contact_id, h.chat, h.created_at,
          (coalesce(h.phone ~ '^(966|965|971|974)', false)
           AND CASE WHEN h.created_at <= v_now - interval '4 days' THEN true
                    ELSE coalesce((SELECT bool_or(mahara_reporting.cc_work_seconds(s.schedule, h.created_at, v_now) >= 3600)
                                   FROM pg_temp._bf_sch s WHERE s.location_id = h.location_id), false) END) AS callable,
          (EXISTS (SELECT 1 FROM pg_temp._bf_calls v WHERE v.location_id = h.location_id AND v.contact_id = h.contact_id
                     AND v.type = 'outbound' AND NOT v.conflict AND v.agent IS NOT NULL AND v.started_at >= h.created_at)
           OR EXISTS (SELECT 1 FROM pg_temp._bf_calls x WHERE x.phone = h.phone AND x.type = 'outbound' AND x.started_at >= h.created_at
                        AND NOT (x.location_id IS NOT DISTINCT FROM h.location_id AND x.contact_id IS NOT DISTINCT FROM h.contact_id))) AS verified
        FROM pg_temp._bf_coh h WHERE h.location_id = l.location_id
        ) v
      ) c
    ) w ON true
    LEFT JOIN LATERAL (
      SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY d.speed))::numeric) AS median
      FROM pg_temp._bf_dl d
      WHERE d.location_id = l.location_id AND d.kind = 'lead' AND d.event_at >= v_30_start AND d.speed IS NOT NULL
    ) sp ON true
    LEFT JOIN pg_temp._bf_cs cs ON cs.location_id = l.location_id
    ON CONFLICT (location_id) DO UPDATE SET untouched_leads = EXCLUDED.untouched_leads,
      oldest_untouched_at = EXCLUDED.oldest_untouched_at, touched_share_30d = EXCLUDED.touched_share_30d,
      callable_30d = EXCLUDED.callable_30d, touched_30d = EXCLUDED.touched_30d,
      first_call_median_work_seconds_30d = CASE WHEN v_dialer_ok THEN EXCLUDED.first_call_median_work_seconds_30d
                                                ELSE n.first_call_median_work_seconds_30d END,
      computed_at = EXCLUDED.computed_at, note = EXCLUDED.note,
      verified_called_30d = EXCLUDED.verified_called_30d, outcome_only_30d = EXCLUDED.outcome_only_30d;
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
    -- nothing about the days after it, and one with no record of a read says
    -- nothing about any day.
    max((s.as_of AT TIME ZONE 'Asia/Kuwait')::date) FILTER (WHERE s.source = 'leads') AS leads_asof,
    max((s.as_of AT TIME ZONE 'Asia/Kuwait')::date) FILTER (WHERE s.source = 'appointments') AS appts_asof,
    max((s.as_of AT TIME ZONE 'Asia/Kuwait')::date) FILTER (WHERE s.source = 'provisional') AS prov_asof,
    max((s.as_of AT TIME ZONE 'Asia/Kuwait')::date) FILTER (WHERE s.source = 'sheet') AS sheet_asof,
    max((s.as_of AT TIME ZONE 'Asia/Kuwait')::date) FILTER (WHERE s.source = 'sheet_copy') AS copy_asof,
    max((s.as_of AT TIME ZONE 'Asia/Kuwait')::date) FILTER (WHERE s.source = 'dialer_leads') AS called_asof,
    max(s.cov_from) FILTER (WHERE s.source = 'outcomes') AS portal_cov,
    -- Whether the client fills the column at all: the sheet's Closed marks,
    -- the sheet copy's Quotation Y.
    coalesce(bool_or(s.fills) FILTER (WHERE s.source = 'sheet'), false) AS sheet_fills_closed,
    coalesce(bool_or(s.fills) FILTER (WHERE s.source = 'sheet_copy'), false) AS copy_fills_quote,
    coalesce(bool_or(s.keeps_n) FILTER (WHERE s.source = 'sheet_copy'), false) AS copy_keeps_n,
    jsonb_object_agg(s.source, jsonb_build_object('ok', s.state = 'ok', 'state', s.state, 'as_of', s.as_of, 'note', s.note)
      || CASE WHEN s.cov_from IS NOT NULL THEN jsonb_build_object('from', s.cov_from) ELSE '{}'::jsonb END) AS sources
  FROM pg_temp._bf_src s GROUP BY 1;
  ALTER TABLE pg_temp._bf_st ADD COLUMN portal_none boolean, ADD COLUMN lq_none boolean, ADD COLUMN sheet_months date[],
    ADD COLUMN portal_fills_deal boolean, ADD COLUMN portal_fills_quote boolean;
  UPDATE pg_temp._bf_st st SET
    sheet_months = (SELECT s.cov_months FROM pg_temp._bf_src s WHERE s.source = 'sheet' AND s.location_id = st.location_id LIMIT 1),
    portal_none = NOT EXISTS (SELECT 1 FROM pg_temp._bf_out o WHERE o.location_id = st.location_id),
    lq_none = NOT EXISTS (SELECT 1 FROM pg_temp._bf_out o WHERE o.location_id = st.location_id AND o.lead_quality BETWEEN 1 AND 10),
    -- The portal fills deals when any report marks one won, lost or pending
    -- ("unknown" is the form's blank), and quotations when any answers yes or no.
    portal_fills_deal = EXISTS (SELECT 1 FROM pg_temp._bf_out o WHERE o.location_id = st.location_id AND coalesce(o.deal, 'unknown') <> 'unknown'),
    portal_fills_quote = EXISTS (SELECT 1 FROM pg_temp._bf_out o WHERE o.location_id = st.location_id AND o.quotation IS NOT NULL);

  CREATE TEMP TABLE _bf_fin ON COMMIT DROP AS
  WITH piv AS (
    SELECT g.location_id, g.day,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'crm_leads'), 0) AS crm_leads,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'crm_ad_leads'), 0) AS crm_ad_leads,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'crm_dm_contacts'), 0) AS crm_dm_contacts,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'confirmed_bookings'), 0) AS confirmed_bookings,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'provisional_bookings'), 0) AS provisional_bookings,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'meetings_due'), 0) AS meetings_due,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'shows'), 0) AS shows,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'no_shows'), 0) AS no_shows,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'no_outcome'), 0) AS no_outcome,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'q_sheet'), 0) AS q_sheet,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'q_portal'), 0) AS q_portal,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'q_portal_answered'), 0) AS q_answered,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'q_sheet_answered'), 0) AS q_sheet_answered,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'closes_answered'), 0) AS closes_answered,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'closes_pending'), 0) AS closes_pending,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'closes_lost'), 0) AS closes_lost,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'closes'), 0) AS closes,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'closes_with_value'), 0) AS closes_with_value,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'revenue_usd'), 0) AS revenue_usd,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'unknown_currency'), 0)::int AS unpriced,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'lq_sum'), 0) AS lq_sum,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'lq_count'), 0) AS lq_count,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'dials'), 0) AS dials,
      coalesce(sum(v.value) FILTER (WHERE v.metric = 'leads_called'), 0) AS leads_called
    FROM pg_temp._bf_grid g
    LEFT JOIN pg_temp._bf_v v ON v.location_id = g.location_id AND v.day = g.day
    GROUP BY 1, 2
  ), gaps AS (
    -- A stale source covers no day after the one it last read, and with no
    -- record of a read (as_of NULL) no day at all.
    SELECT p.*, st.sources, st.copy, st.portal_none, st.lq_none,
      st.sheet_fills_closed, st.copy_fills_quote, st.copy_keeps_n, coalesce(st.portal_fills_deal, false) AS portal_fills_deal,
      coalesce(st.portal_fills_quote, false) AS portal_fills_quote,
      coalesce(st.leads, 'failed') AS leads, coalesce(st.appts, 'failed') AS appts, coalesce(st.outcomes, 'failed') AS outcomes,
      coalesce(st.prov, 'failed') AS prov, coalesce(st.sheet, 'failed') AS sheet, coalesce(st.copy, 'failed') AS copy_state,
      coalesce(st.dialer, 'failed') AS dialer, coalesce(st.dialer_leads, 'failed') AS dialer_leads,
      coalesce(st.marks, 'failed') AS marks,
      (st.leads = 'stale' AND (st.leads_asof IS NULL OR p.day > st.leads_asof)) AS leads_gap,
      (st.appts = 'stale' AND (st.appts_asof IS NULL OR p.day > st.appts_asof)) AS appts_gap,
      (st.prov = 'stale' AND (st.prov_asof IS NULL OR p.day > st.prov_asof)) AS prov_gap,
      (st.dialer_leads = 'stale' AND (st.called_asof IS NULL OR p.day > st.called_asof)) AS called_gap,
      (st.sheet = 'stale' AND (st.sheet_asof IS NULL OR p.day > st.sheet_asof)) AS sheet_gap,
      (st.copy = 'stale' AND (st.copy_asof IS NULL OR p.day > st.copy_asof)) AS copy_gap,
      st.sheet_months, st.copy_cov, st.portal_cov
    FROM piv p JOIN pg_temp._bf_st st ON st.location_id = p.location_id
  ), cov AS (
    -- What covers each day's closes and quotations: a sheet the client fills
    -- covers the month tabs it holds; a sheet copy the client fills covers
    -- its tabs; the portal covers the days from the first meeting the client
    -- reported, for the fields the client marks there.
    SELECT g.*,
      (g.sheet IN ('ok', 'stale') AND g.sheet_fills_closed) AS sheet_has,
      (g.sheet IN ('ok', 'stale') AND g.sheet_fills_closed
        AND date_trunc('month', g.day::timestamp)::date = ANY(coalesce(g.sheet_months, '{}'::date[]))
        AND NOT coalesce(g.sheet_gap, false)) AS sheet_covers,
      (g.copy IN ('ok', 'stale') AND g.copy_fills_quote) AS copy_has,
      (g.copy IN ('ok', 'stale') AND g.copy_fills_quote AND (g.copy_cov IS NULL OR g.day >= g.copy_cov)
        AND NOT coalesce(g.copy_gap, false)) AS copy_covers,
      (NOT g.portal_none AND g.portal_fills_deal) AS portal_deal_has,
      (NOT g.portal_none AND g.portal_fills_quote) AS portal_quote_has,
      (NOT g.portal_none AND g.day >= g.portal_cov AND g.appts IN ('ok', 'stale')
        AND NOT coalesce(g.appts_gap, false)) AS portal_covers
    FROM gaps g
  ), eff AS (
    -- Each column's state for the day: ok (a complete read: the new figure),
    -- stale (a partial read: the new figure, but a closed day is never
    -- lowered), gap (what was found counts, but a zero is never claimed), or
    -- failed and none (nothing read, or the client does not fill it: the
    -- stored figure, NULL on a new row).
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
           WHEN NOT c.copy_has AND NOT c.portal_quote_has THEN 'none'
           WHEN NOT c.copy_covers AND NOT (c.portal_quote_has AND coalesce(c.portal_covers, false)) THEN 'gap'
           WHEN (c.copy_has AND NOT (c.copy_covers AND c.copy_state = 'ok'))
             OR (c.portal_quote_has AND NOT (coalesce(c.portal_covers, false) AND c.appts = 'ok')) THEN 'stale'
           ELSE 'ok' END AS s_quote,
      CASE WHEN c.sheet = 'failed' OR c.outcomes = 'failed' OR c.appts = 'failed' THEN 'failed'
           WHEN NOT c.sheet_has AND NOT c.portal_deal_has THEN 'none'
           WHEN NOT c.sheet_covers AND NOT (c.portal_deal_has AND coalesce(c.portal_covers, false)) THEN 'gap'
           WHEN (c.sheet_has AND NOT (c.sheet_covers AND c.sheet = 'ok'))
             OR (c.portal_deal_has AND NOT (coalesce(c.portal_covers, false) AND c.appts = 'ok')) THEN 'stale'
           ELSE 'ok' END AS s_close,
      c.dialer AS s_dials,
      CASE WHEN coalesce(c.called_gap, false) THEN 'gap' ELSE c.dialer_leads END AS s_called
    FROM cov c
  ), ef2 AS (
    -- A closed deal whose value is in no known currency is left out of that
    -- day's revenue; the day says how many (sources.sheet.unpricedCloses), so
    -- a read can mark its revenue incomplete.
    SELECT e.*,
      CASE WHEN e.unpriced > 0 AND e.s_close NOT IN ('failed', 'none') AND e.sources ? 'sheet'
           THEN jsonb_set(jsonb_set(e.sources, '{sheet,unpricedCloses}', to_jsonb(e.unpriced)), '{sheet,note}',
             to_jsonb(concat_ws(' ', e.sources->'sheet'->>'note',
               format('%s closed deal%s this day carr%s a value in no known currency, left out of revenue.', e.unpriced,
                 CASE WHEN e.unpriced = 1 THEN '' ELSE 's' END, CASE WHEN e.unpriced = 1 THEN 'ies' ELSE 'y' END))))
           ELSE e.sources END AS src1,
      -- Meetings were due this day and none has a quotation answer, or none a
      -- deal answer: nothing was reported, so the day's figure is unknown
      -- (NULL), the rule shows already follow, never 0.
      (e.meetings_due > 0 AND greatest(e.q_sheet, e.q_portal) = 0 AND greatest(e.q_sheet_answered, e.q_answered) = 0) AS q_unanswered,
      (e.meetings_due > 0 AND e.closes = 0 AND e.closes_answered = 0) AS c_unanswered
    FROM eff e
  )
  SELECT e.location_id, e.day,
    -- Leads uploaded in bulk are named on their day, and every source whose
    -- last read is before the day ended says the day is so far (partial).
    public.cockpit_board_facts_partial(
      CASE WHEN bk.n IS NOT NULL AND e.src1 ? 'leads'
           THEN jsonb_set(jsonb_set(e.src1, '{leads,bulkImport}', to_jsonb(bk.n)), '{leads,note}',
             to_jsonb(concat_ws(' ', e.src1->'leads'->>'note',
               format('%s contact%s arrived within one hour this day: an upload in bulk, so %s creation day is not %s form day.', bk.n,
                 CASE WHEN bk.n = 1 THEN '' ELSE 's' END, CASE WHEN bk.n = 1 THEN 'its' ELSE 'their' END,
                 CASE WHEN bk.n = 1 THEN 'its' ELSE 'their' END))))
           ELSE e.src1 END, e.day) AS sources,
    o.crm_leads AS o_crm_leads, o.crm_ad_leads AS o_crm_ad_leads, o.confirmed_bookings AS o_confirmed_bookings,
    o.provisional_bookings AS o_provisional_bookings, o.meetings_due AS o_meetings_due, o.shows AS o_shows,
    o.no_shows AS o_no_shows, o.no_outcome AS o_no_outcome, o.quotations AS o_quotations, o.closes AS o_closes,
    o.revenue_usd AS o_revenue_usd, o.lead_quality_count AS o_lead_quality_count, o.dials AS o_dials, o.leads_called AS o_leads_called,
    public.cockpit_board_facts_pick(e.s_leads, e.day, v_today, o.crm_leads, e.crm_leads)::int AS crm_leads,
    public.cockpit_board_facts_pick(e.s_leads, e.day, v_today, o.crm_ad_leads, e.crm_ad_leads)::int AS crm_ad_leads,
    public.cockpit_board_facts_pick(e.s_leads, e.day, v_today, o.crm_dm_contacts, e.crm_dm_contacts)::int AS crm_dm_contacts,
    public.cockpit_board_facts_pick(e.s_book, e.day, v_today, o.confirmed_bookings, e.confirmed_bookings)::int AS confirmed_bookings,
    public.cockpit_board_facts_pick(e.s_prov, e.day, v_today, o.provisional_bookings, e.provisional_bookings)::int AS provisional_bookings,
    public.cockpit_board_facts_pick(e.s_att, e.day, v_today, o.meetings_due, e.meetings_due)::int AS meetings_due,
    public.cockpit_board_facts_pick(e.s_att, e.day, v_today, o.shows,
      CASE WHEN e.meetings_due > 0 AND e.shows + e.no_shows = 0 THEN NULL ELSE e.shows END)::int AS shows,
    public.cockpit_board_facts_pick(e.s_att, e.day, v_today, o.no_shows,
      CASE WHEN e.meetings_due > 0 AND e.shows + e.no_shows = 0 THEN NULL ELSE e.no_shows END)::int AS no_shows,
    public.cockpit_board_facts_pick(e.s_att, e.day, v_today, o.no_outcome, e.no_outcome)::int AS no_outcome,
    public.cockpit_board_facts_pick(e.s_quote, e.day, v_today, o.quotations,
      CASE WHEN e.q_unanswered THEN NULL ELSE greatest(e.q_sheet, e.q_portal) END)::int AS quotations,
    public.cockpit_board_facts_pick(e.s_quote, e.day, v_today, o.quotation_answers,
      CASE WHEN e.copy = 'none' AND NOT e.portal_none THEN e.q_answered
           WHEN e.copy_keeps_n THEN greatest(e.q_sheet_answered, e.q_answered) END)::int AS quotation_answers,
    public.cockpit_board_facts_pick(e.s_close, e.day, v_today, o.closes, CASE WHEN e.c_unanswered THEN NULL ELSE e.closes END)::int AS closes,
    public.cockpit_board_facts_pick(e.s_close, e.day, v_today, o.closes_with_value,
      CASE WHEN e.c_unanswered THEN NULL ELSE e.closes_with_value END)::int AS closes_with_value,
    public.cockpit_board_facts_pick(e.s_close, e.day, v_today, o.revenue_usd, CASE WHEN e.c_unanswered THEN NULL ELSE e.revenue_usd END) AS revenue_usd,
    public.cockpit_board_facts_pick(e.s_close, e.day, v_today, o.closes_pending, e.closes_pending)::int AS closes_pending,
    public.cockpit_board_facts_pick(e.s_close, e.day, v_today, o.closes_lost, e.closes_lost)::int AS closes_lost,
    public.cockpit_board_facts_pick(e.s_close, e.day, v_today, o.closes_answered, e.closes_answered)::int AS closes_answered,
    public.cockpit_board_facts_pick(e.s_lq, e.day, v_today, o.lead_quality_sum, e.lq_sum) AS lead_quality_sum,
    public.cockpit_board_facts_pick(e.s_lq, e.day, v_today, o.lead_quality_count, e.lq_count)::int AS lead_quality_count,
    -- A client the dialer does not list: dials unknown, even over a stored 0.
    CASE WHEN e.s_dials = 'none' THEN NULL ELSE public.cockpit_board_facts_pick(e.s_dials, e.day, v_today, o.dials, e.dials) END::int AS dials,
    public.cockpit_board_facts_pick(e.s_called, e.day, v_today, o.leads_called, e.leads_called)::int AS leads_called
  FROM ef2 e
  LEFT JOIN public.cockpit_client_days o ON o.location_id = e.location_id AND o.day = e.day
  LEFT JOIN pg_temp._bf_bulk bk ON bk.location_id = e.location_id AND bk.day = e.day;

  INSERT INTO public.cockpit_client_days AS d (location_id, day, crm_leads, crm_ad_leads, confirmed_bookings, provisional_bookings,
    meetings_due, shows, no_shows, no_outcome, quotations, quotation_answers, closes, closes_with_value, revenue_usd,
    lead_quality_sum, lead_quality_count, dials, leads_called, computed_at, sources,
    crm_dm_contacts, closes_pending, closes_lost, closes_answered)
  SELECT f.location_id, f.day, f.crm_leads, f.crm_ad_leads, f.confirmed_bookings, f.provisional_bookings,
    f.meetings_due, f.shows, f.no_shows, f.no_outcome, f.quotations, f.quotation_answers, f.closes, f.closes_with_value,
    f.revenue_usd, f.lead_quality_sum, f.lead_quality_count, f.dials, f.leads_called, v_now, coalesce(f.sources, '{}'::jsonb),
    f.crm_dm_contacts, f.closes_pending, f.closes_lost, f.closes_answered
  FROM pg_temp._bf_fin f
  ON CONFLICT (location_id, day) DO UPDATE SET crm_leads = EXCLUDED.crm_leads, crm_ad_leads = EXCLUDED.crm_ad_leads,
    crm_dm_contacts = EXCLUDED.crm_dm_contacts, closes_pending = EXCLUDED.closes_pending, closes_lost = EXCLUDED.closes_lost,
    closes_answered = EXCLUDED.closes_answered,
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
  -- The sources behind or failing in this run, as source:location. The
  -- 30-minute run compares them with the last 120-day fill's, and fills the
  -- 120 days again when one of those reads again (cockpit_board_facts_run).
  SELECT coalesce(jsonb_agg(DISTINCT s.source || ':' || s.location_id), '[]'::jsonb) INTO v_stale
  FROM pg_temp._bf_src s WHERE s.state IN ('stale', 'failed');
  v_detail := jsonb_build_object('from', p_from, 'to', p_to, 'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000),
    'stale', v_stale,
    'lastDeepStale', CASE WHEN p_to - p_from >= 60 THEN v_stale ELSE coalesce(v_prev->'lastDeepStale', '[]'::jsonb) END,
    'lastHealAt', coalesce(v_prev->'lastHealAt', 'null'::jsonb),
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
-- last 120 days. A refresh that stops says so on the state row. A 'recent' run
-- that finds a source reading again that the last 120-day fill wrote while it
-- was behind or failing fills the 120 days again (at most every 3 hours), so
-- an old day does not keep a stale note until the night.
CREATE OR REPLACE FUNCTION public.cockpit_board_facts_run(p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_from date;
  v_out jsonb;
  v_err text;
  v_detail jsonb;
  v_healed jsonb;
  v_heal jsonb;
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
  IF p_mode = 'recent' AND coalesce((v_out->>'ok')::boolean, false) THEN
    SELECT s.detail INTO v_detail FROM public.cockpit_sync_state s WHERE s.key = 'board-facts';
    SELECT coalesce(jsonb_agg(x.v ORDER BY x.v), '[]'::jsonb) INTO v_healed
    FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_detail->'lastDeepStale') = 'array' THEN v_detail->'lastDeepStale' ELSE '[]'::jsonb END) x(v)
    WHERE NOT (CASE WHEN jsonb_typeof(v_detail->'stale') = 'array' THEN v_detail->'stale' ELSE '[]'::jsonb END ? x.v);
    IF jsonb_array_length(v_healed) > 0
       AND (nullif(v_detail->>'lastHealAt', '') IS NULL OR (v_detail->>'lastHealAt')::timestamptz < now() - interval '3 hours') THEN
      BEGIN
        v_heal := public.cockpit_board_facts_refresh(v_today - 119, v_today);
        UPDATE public.cockpit_sync_state SET detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('lastHealAt', now(), 'healed', v_healed)
        WHERE key = 'board-facts';
        v_out := v_out || jsonb_build_object('healed', v_healed, 'healOk', v_heal->'ok');
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        v_out := v_out || jsonb_build_object('healError', left(v_err, 300));
      END;
    END IF;
  END IF;
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
      v_problems := v_problems || text 'A board facts job is missing from pg_cron: apply the migration again.';
    END IF;
  ELSE
    v_problems := v_problems || text 'pg_cron is not installed, so the board facts never refresh on their own.';
  END IF;
  SELECT s.last_run_at, s.last_ok_at, s.ok, s.note, s.detail INTO v_state FROM public.cockpit_sync_state s WHERE s.key = 'board-facts';
  IF v_state.last_run_at IS NULL THEN
    v_problems := v_problems || text 'The board facts have never run: select public.cockpit_board_facts_run(''nightly'');';
  ELSIF v_state.last_run_at < now() - interval '2 hours' THEN
    v_problems := v_problems || format('The board facts last ran %s Kuwait time.', to_char(v_state.last_run_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'));
  END IF;
  IF v_state.ok IS FALSE THEN v_problems := v_problems || coalesce(v_state.note, 'The last run failed.'); END IF;
  -- The 120-day fill keeps leads called and late sheet closes current on
  -- days older than 3. A 30-minute run after a failed fill sets ok again, so
  -- the fill is checked on its own: its age, its last read, its last stop.
  v_deep_at := (v_state.detail->>'lastDeepAt')::timestamptz;
  IF v_state.detail IS NOT NULL AND v_deep_at IS NULL THEN
    v_problems := v_problems || text 'The 120-day fill has not run yet: select public.cockpit_board_facts_run(''nightly'');';
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
  IF EXISTS (SELECT 1 FROM public.cockpit_board_account_ties t
             WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_board_clients b WHERE b.location_id = t.location_id)) THEN
    v_problems := v_problems || (SELECT 'A hand tie in cockpit_board_account_ties names a location the client registry does not hold: '
      || string_agg(t.account_id || ' to ' || t.location_id, ', ' ORDER BY t.account_id) || '.'
      FROM public.cockpit_board_account_ties t
      WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_board_clients b WHERE b.location_id = t.location_id));
  END IF;
  SELECT jsonb_build_object('rows', count(*), 'clients', count(DISTINCT location_id), 'from', min(day), 'to', max(day))
  INTO v_days FROM public.cockpit_client_days;
  RETURN jsonb_build_object('ok', cardinality(v_problems) = 0, 'problems', to_jsonb(v_problems), 'jobs', v_jobs,
    'state', CASE WHEN v_state.last_run_at IS NULL THEN NULL ELSE jsonb_build_object('lastRunAt', v_state.last_run_at,
      'lastOkAt', v_state.last_ok_at, 'ok', v_state.ok, 'note', v_state.note, 'detail', v_state.detail) END,
    'days', v_days,
    'spine', (SELECT jsonb_build_object('clients', count(*), 'withAdAccount', count(*) FILTER (WHERE cardinality(ad_account_ids) > 0),
      'activeWithoutAdAccount', coalesce(jsonb_agg(client_name ORDER BY client_name) FILTER (WHERE status = 'Active' AND cardinality(ad_account_ids) = 0), '[]'::jsonb),
      -- Where the client registry and the ClickUp card disagree (the card
      -- wins), and the clients with no card (the registry's word is used).
      'registryDisagrees', coalesce(jsonb_agg(jsonb_build_object('client', client_name, 'registry', registry_status, 'card', card_stage) ORDER BY client_name)
        FILTER (WHERE card_stage IS NOT NULL AND status IS DISTINCT FROM registry_status
                AND NOT (status = 'Cancelled' AND registry_status = 'Cancelled')), '[]'::jsonb),
      'noCard', coalesce(jsonb_agg(client_name ORDER BY client_name)
        FILTER (WHERE card_stage IS NULL AND coalesce(status, '') NOT IN ('Cancelled', 'Removed from sheet')), '[]'::jsonb))
      FROM public.cockpit_board_clients),
    'handTies', (SELECT jsonb_build_object('rows', count(*),
      'unknownLocation', coalesce(jsonb_agg(t.account_id ORDER BY t.account_id) FILTER (WHERE b.location_id IS NULL), '[]'::jsonb))
      FROM public.cockpit_board_account_ties t LEFT JOIN public.cockpit_board_clients b ON b.location_id = t.location_id));
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Privileges: revoked from all four roles; the doctor for the service key.

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['cockpit_board_calendar_kind(text)', 'cockpit_board_card_status(text)',
    'cockpit_board_facts_partial(jsonb,date)', 'cockpit_board_facts_refresh(date,date)',
    'cockpit_board_facts_run(text)', 'cockpit_board_facts_doctor()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_board_facts_doctor() TO service_role';
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
