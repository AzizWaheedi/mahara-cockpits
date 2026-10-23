-- Done with you on the Client Performance board (the CEO, 23 Oct 2026, cost per booking
-- decisions, 2: "No keep the CPL but ignore CPB"). Contract: docs/client-performance/
-- CPB-DECISIONS-20261023.md 1.2 and 3.3. Creative Triage bldgtotkfmhoxmlzowdx.
--
-- A done-with-you client (cockpit_board_clients.service_mode DWY; today only نهوض نجد) books its
-- own meetings. Its cost per lead stays judged; its cost per booking and booking rate are not.
-- What changes, and nothing else:
--   cockpit_board_rows: for a DWY row, leadToBooking and costPerBooking are
--     {v: null, status: not_measured, note: "Done with you: the client books its own meetings, so
--     its cost per booking and booking rate are not judged.", clientBooks: true}, whatever
--     GoHighLevel holds (the shape of the call cells' clientCalls). The row note reads "Done With
--     You: the client calls its own leads and books its own meetings." Who is DWY:
--     upper(btrim(service_mode)) = 'DWY'; a blank mode is not (it was NULL, which skipped the
--     golden rule; the table's check allows only DFY, DWY or blank, and only cancelled rows are
--     blank on 23 Oct). The golden rule keeps IF NOT v_dwy, so a DWY cost per lead keeps its own
--     status. Bookings, provisional bookings, show rate and every other cell are unchanged.
--   cockpit_board_tree: reads the client's service mode from cockpit_board_clients by
--     p_location (no signature change); for DWY every campaign, ad set and ad costPerBooking is
--     the same cell. Booking counts stay.
--   cockpit_dictionary_definitions: the cost_per_booking "leaves out" text adds "A done-with-you
--     client (it books its own meetings): no cost per booking, and its spend is out of every
--     portfolio cost per booking." cockpit_dictionary_numbers copies the board cell and follows.
--   cockpit_board_lever_context: a lever filed on a done-with-you client's Cost per booking or
--     Lead to booking (the form offers every metric) carries the ClickUp evidence "<client> Cost
--     per booking, <from> to <to>: done with you (the client books its own meetings), so not
--     judged." where it said "not measured". It reads the cell's clientBooks; nothing else moves.
-- The app shows "Done with you" when clientBooks is set (boardClient.ts, cells.tsx); until it
-- ships, the board shows these two cells as not measured with the note.
--
-- Each body is the live one (prosrc md5: rows 48b398196dbdd9eb9737239882d73fb5, the body of 20261022y;
-- tree 0c3652110bc32d89d7884fa14ce0a505, the body of 20261021m; dictionary definitions
-- 307d4a6df3bfbc5e1380ee5abdeeb5e4, the body of 20261021e; lever context
-- d05e1b3839d17715ff6b31643eb4925e, the body of 20261017b) with those edits. The file refuses, and
-- changes nothing, unless every live body is either that one or this file's (rows
-- 26c4f6dbd4ac2b81d0c733911429420b, tree 2d35c796b088ae207b7b9094fe169813, dictionary definitions
-- 6e88042d0f35598e5585a4d1a0a3f8d4, lever context d9cfdda684173ea1878a1d51e21ac384), so a change made
-- since is never overwritten. Owner, security and grants are kept and restated: rows and tree for
-- the owner only (definer); dictionary definitions for the service role (invoker); lever context
-- for signed-in seats (definer, EXECUTE for authenticated, as live). Safe to run twice.
-- Test: apps/media-buyer-cockpit/scripts/board-done-with-you-supabase.test.ts.
-- Rollback: ~/.cache/mahara-ship/rollback/cockpit_board_rows.before-20261023r_board_done_with_you.sql,
-- cockpit_board_tree.before-20261023r_board_done_with_you.sql,
-- cockpit_dictionary_definitions.before-20261023r_board_done_with_you.sql and
-- cockpit_board_lever_context.before-20261023r_board_done_with_you.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_board_rows(date,date,text,jsonb)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('48b398196dbdd9eb9737239882d73fb5', '26c4f6dbd4ac2b81d0c733911429420b') THEN
    RAISE EXCEPTION 'cockpit_board_rows is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_board_tree(text,text[],date,date,jsonb,jsonb,jsonb)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('0c3652110bc32d89d7884fa14ce0a505', '2d35c796b088ae207b7b9094fe169813') THEN
    RAISE EXCEPTION 'cockpit_board_tree is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_dictionary_definitions()');
  IF v_md5 IS NULL OR v_md5 NOT IN ('307d4a6df3bfbc5e1380ee5abdeeb5e4', '6e88042d0f35598e5585a4d1a0a3f8d4') THEN
    RAISE EXCEPTION 'cockpit_dictionary_definitions is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_board_lever_context(jsonb)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('d05e1b3839d17715ff6b31643eb4925e', 'd9cfdda684173ea1878a1d51e21ac384') THEN
    RAISE EXCEPTION 'cockpit_board_lever_context is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.cockpit_board_rows(p_from date, p_to date, p_location text, p_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_now timestamptz := public.cockpit_meta_ad_days_now();
  v_days integer := p_to - p_from + 1;
  v_cover jsonb;
  v_ad_days integer;
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
  -- the facts, NULL when no day has a figure
  crm numeric; booked numeric; due numeric; shows numeric; no_shows numeric; marked numeric;
  no_out numeric; quotes numeric; closes numeric; valued numeric; revenue numeric; lq_n numeric;
  v_rev_incomplete boolean;
  v_closes_status text; v_quotes_status text; v_lq_status text;
  v_calls_note constant text := 'The client calls: Done With You.';
  -- Done with you (the CEO, 23 Oct 2026, cost per booking decisions, 2: "No keep the CPL but
  -- ignore CPB"; 20261023r): the client books its own meetings, so its cost per booking and
  -- booking rate are not judged, whatever GoHighLevel holds. Its cost per lead is.
  v_books_cell constant jsonb := jsonb_build_object('v', NULL, 'status', 'not_measured',
    'note', 'Done with you: the client books its own meetings, so its cost per booking and booking rate are not judged.', 'clientBooks', true);
  v_cell jsonb;
  v_x numeric;
  v_pair jsonb;
  v_bud jsonb;
BEGIN
  FOR r IN
    WITH cl AS (
      SELECT b.location_id, b.clickup_id, b.client_name, b.status, b.service_mode, b.ad_account_ids, b.tiktok,
        public.cockpit_board_ad_cover(b.ad_account_ids, p_from, p_to, p_meta) AS cover
      FROM public.cockpit_board_clients b
      -- The board lists Active clients only (the CEO, 2026-10-17). One client's
      -- page, opened by its location, still reads any client not cancelled.
      WHERE CASE WHEN p_location IS NULL THEN b.status = 'Active'
                 ELSE coalesce(b.status, '') NOT IN ('Cancelled', 'Removed from sheet') AND b.location_id = p_location END
    ), clp AS (
      -- The clients whose ad days the store holds, with their ad window and the days every linked account has.
      SELECT cl.location_id, cl.ad_account_ids, (cl.cover->>'winTo')::date AS win_to,
        (cl.cover->>'pairFrom')::date AS pair_from, (cl.cover->>'pairTo')::date AS pair_to
      FROM cl WHERE cl.cover->>'state' IN ('full', 'partial')
    ), fx AS (
      SELECT d.location_id AS fx_loc,
        count(*) AS f_days, max(d.computed_at) AS f_computed,
        sum(d.crm_leads) AS f_crm, count(d.crm_leads) AS f_crm_d,
        sum(d.crm_ad_leads) AS f_crm_ad, count(d.crm_ad_leads) AS f_crm_ad_d,
        sum(d.crm_dm_contacts) FILTER (WHERE d.crm_leads IS NOT NULL) AS f_dm,
        sum(d.confirmed_bookings) AS f_booked, count(d.confirmed_bookings) AS f_booked_d,
        sum(d.provisional_bookings) AS f_prov, count(d.provisional_bookings) AS f_prov_d,
        sum(d.meetings_due) AS f_due, count(d.meetings_due) AS f_due_d,
        sum(d.shows) AS f_shows, sum(d.no_shows) AS f_no_shows, count(d.shows) AS f_shows_d,
        sum(d.no_outcome) AS f_no_out, count(d.no_outcome) AS f_no_out_d,
        min(d.day) FILTER (WHERE d.no_outcome > 0) AS f_no_out_first,
        sum(d.quotations) AS f_quotes, count(d.quotations) AS f_quotes_d,
        sum(d.quotation_answers) AS f_qa, count(d.quotation_answers) AS f_qa_d,
        sum(d.closes) AS f_closes, count(d.closes) AS f_closes_d,
        -- Won, pending and lost: pending and lost are known together, on days whose closes are known.
        sum(d.closes_pending) FILTER (WHERE d.closes_pending IS NOT NULL AND d.closes_lost IS NOT NULL) AS f_pending,
        sum(d.closes_lost) FILTER (WHERE d.closes_pending IS NOT NULL AND d.closes_lost IS NOT NULL) AS f_lost,
        count(*) FILTER (WHERE d.closes_pending IS NOT NULL AND d.closes_lost IS NOT NULL) AS f_pl_d,
        sum(d.closes_with_value) AS f_valued,
        sum(d.revenue_usd) AS f_revenue,
        coalesce(sum((d.sources->'sheet'->>'unpricedCloses')::integer), 0) AS f_unpriced,
        sum(d.lead_quality_sum) AS f_lq_sum, sum(d.lead_quality_count) AS f_lq_n, count(d.lead_quality_count) AS f_lq_d,
        sum(d.dials) AS f_dials, count(d.dials) AS f_dials_d,
        sum(d.leads_called) AS f_called, count(d.leads_called) AS f_called_d,
        -- Rates over two sources: each side summed over the days where both are known.
        sum(d.confirmed_bookings) FILTER (WHERE d.crm_leads IS NOT NULL) AS f_lb_booked,
        sum(d.crm_leads) FILTER (WHERE d.confirmed_bookings IS NOT NULL) AS f_lb_leads,
        count(*) FILTER (WHERE d.crm_leads IS NOT NULL AND d.confirmed_bookings IS NOT NULL) AS f_lb_d,
        sum(d.closes) FILTER (WHERE d.shows IS NOT NULL) AS f_cr_closes,
        sum(d.shows) FILTER (WHERE d.closes IS NOT NULL) AS f_cr_shows,
        count(*) FILTER (WHERE d.closes IS NOT NULL AND d.shows IS NOT NULL) AS f_cr_d,
        sum(d.quotations) FILTER (WHERE d.shows IS NOT NULL) AS f_qr_quotes,
        sum(d.shows) FILTER (WHERE d.quotations IS NOT NULL) AS f_qr_shows,
        count(*) FILTER (WHERE d.quotations IS NOT NULL AND d.shows IS NOT NULL) AS f_qr_d,
        sum(d.leads_called) FILTER (WHERE d.crm_leads IS NOT NULL) AS f_lc_called,
        sum(d.crm_leads) FILTER (WHERE d.leads_called IS NOT NULL) AS f_lc_leads,
        count(*) FILTER (WHERE d.crm_leads IS NOT NULL AND d.leads_called IS NOT NULL) AS f_lc_d
      FROM public.cockpit_client_days d JOIN cl ON cl.location_id = d.location_id
      WHERE d.day BETWEEN p_from AND p_to
      GROUP BY d.location_id
    ), src AS (
      SELECT DISTINCT ON (d.location_id) d.location_id, d.sources
      FROM public.cockpit_client_days d JOIN cl ON cl.location_id = d.location_id
      WHERE d.day BETWEEN p_from AND p_to
      ORDER BY d.location_id, d.day DESC
    ), mx AS (
      -- Ad days in the client's ad window, each finished on its own account's clock.
      SELECT clp.location_id, clp.pair_from, clp.pair_to, m.*
      FROM clp JOIN public.cockpit_meta_ad_days m ON m.account_id = ANY(clp.ad_account_ids)
      WHERE m.day BETWEEN p_from AND clp.win_to
        AND m.day < (v_now AT TIME ZONE coalesce(m.account_timezone, 'Asia/Kuwait'))::date
        -- Never an ad on the compromise list (cockpit_excluded_ads), matched on the ad id alone.
        AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xa WHERE xa.ad_id = m.ad_id)
    ), ad AS (
      SELECT m.location_id, jsonb_build_object(
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
      FROM mx m
      GROUP BY m.location_id
    ), ad_day AS (
      -- Spend per day on the days every linked account has stored.
      SELECT m.location_id, m.day, sum(m.spend_usd) AS spend, count(*) FILTER (WHERE m.spend IS NOT NULL AND m.spend_usd IS NULL) AS unpriced
      FROM mx m WHERE m.day BETWEEN m.pair_from AND m.pair_to
      GROUP BY m.location_id, m.day
    ), pr AS (
      -- Cost per booking and ROAS: spend and the facts summed over the same days, those
      -- every linked account has stored and the facts know (bookings, closed deals).
      SELECT d.location_id AS pr_loc,
        count(d.confirmed_bookings) AS p_b_d,
        sum(d.confirmed_bookings) AS p_b_booked,
        coalesce(sum(s.spend) FILTER (WHERE d.confirmed_bookings IS NOT NULL), 0) AS p_b_spend,
        coalesce(sum(s.unpriced) FILTER (WHERE d.confirmed_bookings IS NOT NULL), 0) AS p_b_unpriced,
        count(d.closes) AS p_r_d,
        coalesce(sum(d.revenue_usd) FILTER (WHERE d.closes IS NOT NULL), 0) AS p_r_rev,
        coalesce(sum(d.closes), 0) AS p_r_closes,
        coalesce(sum(d.closes_with_value) FILTER (WHERE d.closes IS NOT NULL), 0) AS p_r_valued,
        coalesce(sum((d.sources->'sheet'->>'unpricedCloses')::integer) FILTER (WHERE d.closes IS NOT NULL), 0) AS p_r_unpriced_closes,
        coalesce(sum(s.spend) FILTER (WHERE d.closes IS NOT NULL), 0) AS p_r_spend,
        coalesce(sum(s.unpriced) FILTER (WHERE d.closes IS NOT NULL), 0) AS p_r_unpriced
      FROM public.cockpit_client_days d JOIN clp ON clp.location_id = d.location_id
      LEFT JOIN ad_day s ON s.location_id = d.location_id AND s.day = d.day
      WHERE d.day BETWEEN clp.pair_from AND clp.pair_to
      GROUP BY d.location_id
    ), rc AS (
      -- Meta reads reach per account, so it counts every ad on it. When an ad on the compromise list
      -- delivered on the client's accounts in these days, the reach is mostly the outsiders' (Liwan's
      -- October: 460,096 impressions, 7,119 of them its own), so it is left out and said: the frequency
      -- falls back to the impression-weighted daily frequency of the client's own ads, which leaves the
      -- listed ads out.
      SELECT DISTINCT ON (x.key) x.key AS location_id,
        CASE WHEN EXISTS (SELECT 1 FROM public.cockpit_meta_ad_days m
                          JOIN public.cockpit_excluded_ads xa ON xa.ad_id = m.ad_id
                          WHERE m.account_id = ANY(cl.ad_account_ids)
                            AND m.day BETWEEN p_from AND p_to AND m.impressions > 0)
          THEN jsonb_build_object('reach', NULL, 'impressions', NULL, 'note',
            'Meta''s reach for these ad accounts also counts the outsiders'' ads on the compromise list, so it is not used: this is the average daily frequency of the client''s own ads.')
          ELSE jsonb_build_object('reach', x.reach, 'impressions', x.impressions, 'note', x.note) END AS a_reach
      FROM public.cockpit_meta_reach x
      JOIN cl ON cl.location_id = x.key
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
    SELECT cl.location_id, cl.clickup_id, cl.client_name, cl.status, cl.service_mode, cl.ad_account_ids, cl.tiktok, cl.cover AS c_cover,
      fx.*, pr.*, src.sources AS s_sources, ad.a_sums, ad.a_fetched, rc.a_reach, coalesce(cr.callers, '[]'::jsonb) AS c_callers,
      n.untouched_leads AS n_untouched, n.oldest_untouched_at AS n_oldest, n.touched_share_30d AS n_share,
      n.callable_30d AS n_callable, n.touched_30d AS n_touched, n.first_call_median_work_seconds_30d AS n_first,
      n.computed_at AS n_computed, n.note AS n_note, n.location_id IS NOT NULL AS n_has,
      n.verified_called_30d AS n_verified, n.outcome_only_30d AS n_outcome_only,
      coalesce(lv.l_open, 0) AS l_open, coalesce(lv.l_reconcile, 0) AS l_reconcile, lv.l_last
    FROM cl
    LEFT JOIN fx ON fx.fx_loc = cl.location_id
    LEFT JOIN pr ON pr.pr_loc = cl.location_id
    LEFT JOIN src ON src.location_id = cl.location_id
    LEFT JOIN ad ON ad.location_id = cl.location_id
    LEFT JOIN rc ON rc.location_id = cl.location_id
    LEFT JOIN cr ON cr.location_id = cl.location_id
    LEFT JOIN public.cockpit_client_now n ON n.location_id = cl.location_id
    LEFT JOIN lv ON lv.location_id = cl.location_id
    ORDER BY cl.client_name, cl.location_id
  LOOP
    t := public.cockpit_board_targets_map(r.clickup_id);
    v_dwy := coalesce(upper(btrim(r.service_mode)) = 'DWY', false);
    v_notes := '{}'::text[];
    v_src := coalesce(r.s_sources, '{}'::jsonb);

    crm := CASE WHEN r.f_crm_d > 0 THEN r.f_crm END;
    booked := CASE WHEN r.f_booked_d > 0 THEN r.f_booked END;
    due := CASE WHEN r.f_due_d > 0 THEN r.f_due END;
    shows := CASE WHEN r.f_shows_d > 0 THEN r.f_shows END;
    no_shows := CASE WHEN r.f_shows_d > 0 THEN r.f_no_shows END;
    marked := coalesce(shows, 0) + coalesce(no_shows, 0);
    no_out := CASE WHEN r.f_no_out_d > 0 THEN r.f_no_out END;
    quotes := CASE WHEN r.f_quotes_d > 0 THEN r.f_quotes END;
    closes := CASE WHEN r.f_closes_d > 0 THEN r.f_closes END;
    valued := CASE WHEN r.f_closes_d > 0 THEN r.f_valued END;
    revenue := CASE WHEN r.f_closes_d > 0 THEN r.f_revenue END;
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

    -- The ad half: only the days the Meta store holds for every linked account (cockpit_board_ad_cover).
    v_cover := r.c_cover;
    v_ad_ok := v_cover->>'state' IN ('full', 'partial');
    v_ad_days := CASE WHEN v_ad_ok THEN (v_cover->>'adDays')::integer END;
    IF v_cover->>'state' = 'no_account' THEN
      v_ad := public.cockpit_board_ad_unmeasured('not_measured', CASE WHEN r.tiktok
        THEN 'No Meta ad account is linked to this client, and TikTok spend is not stored.'
        ELSE 'No Meta ad account is linked to this client.' END);
    ELSIF NOT v_ad_ok THEN
      -- Before the store's first day, today only, or not over yet on the accounts' clocks: not measured, never $0.
      v_ad := public.cockpit_board_ad_unmeasured('not_measured', v_cover->>'note');
    ELSE
      v_ad := public.cockpit_board_ad_cells(coalesce(r.a_sums, jsonb_build_object('rows', 0, 'spend', 0))
          || CASE WHEN (v_cover->>'partial')::boolean THEN jsonb_build_object('partial', true, 'partial_note', v_cover->>'note') ELSE '{}'::jsonb END,
        t, r.a_reach);
      IF (v_cover->>'partial')::boolean THEN
        v_notes := v_notes || (v_cover->>'note');
      ELSIF r.a_sums IS NULL THEN
        v_notes := v_notes || 'No delivery on the linked ad accounts in these days.'::text;
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
    -- Budgets (2026-10-17): the daily budgets switched on now, spend per day
    -- and the share of the daily budgets spent, beside the ad cells.
    v_bud := public.cockpit_board_budget_cells(r.ad_account_ids, NULL, p_from, p_to, v_cover, p_meta, t, v_ad->'spend');
    v_ad := v_ad || jsonb_build_object('dailyBudget', v_bud->'dailyBudget', 'spendPerDay', v_bud->'spendPerDay',
      'budgetUsed', v_bud->'budgetUsed');

    v_vals := v_ad
      || jsonb_build_object(
        -- Instagram and Messenger chats with no ad stay in CRM leads (the call centre calls them); said, and counted.
        'crmLeads', public.cockpit_board_add_note(
          public.cockpit_board_count(r.f_crm, r.f_crm_d, v_days, 'not_measured', v_src->'leads'->>'note',
            CASE WHEN r.f_crm_d > 0 AND r.f_dm IS NOT NULL THEN jsonb_build_object('dms', r.f_dm) END),
          CASE WHEN r.f_crm_d > 0 AND r.f_dm > 0 THEN format('%s of these %s an Instagram or Messenger chat with no ad behind it; WhatsApp chats are left out.',
            r.f_dm, CASE WHEN r.f_dm = 1 THEN 'is' ELSE 'are' END) END),
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
                              CASE WHEN r.f_lc_d > 0 AND r.f_lc_leads > 0 THEN jsonb_build_object('share', round(r.f_lc_called::numeric / r.f_lc_leads * 100, 2))
                                || CASE WHEN r.f_lc_d < v_days THEN jsonb_build_object('sharePartial', true,
                                     'shareNote', public.cockpit_board_paired(r.f_lc_d, v_days)->>'note') ELSE '{}'::jsonb END END) END
      );

    -- Lead to booking: confirmed bookings / CRM leads, both by the day made,
    -- over the days where both are known (a lead-sync outage is not a 0).
    v_pair := public.cockpit_board_paired(r.f_lb_d, v_days);
    v_vals := v_vals || jsonb_build_object('leadToBooking', CASE
      WHEN v_dwy THEN v_books_cell
      WHEN crm IS NULL OR booked IS NULL THEN public.cockpit_board_cell('lead_to_booking', NULL, t, NULL, NULL, NULL, 'not_measured',
        coalesce(v_src->'leads'->>'note', v_src->'appointments'->>'note'))
      WHEN r.f_lb_d = 0 THEN public.cockpit_board_cell('lead_to_booking', NULL, t, NULL, NULL, NULL, 'not_measured',
        'No day in this time frame has both CRM leads and bookings known.')
      WHEN r.f_lb_leads = 0 THEN public.cockpit_board_cell('lead_to_booking', NULL, t, 0, r.f_lb_booked, 0, 'too_few',
        concat_ws(' ', 'No CRM lead in this time frame.', v_pair->>'note'), v_pair - 'note')
      ELSE public.cockpit_board_cell('lead_to_booking', round(r.f_lb_booked::numeric / r.f_lb_leads * 100, 2), t, r.f_lb_leads, r.f_lb_booked, r.f_lb_leads,
        NULL, v_pair->>'note', v_pair - 'note') END);

    -- Cost per booking: spend / confirmed bookings over the same days: those to
    -- yesterday that every linked account has stored and the facts know.
    v_pair := CASE WHEN v_ad_ok THEN public.cockpit_board_paired(r.p_b_d, v_ad_days) ELSE '{}'::jsonb END;
    v_vals := v_vals || jsonb_build_object('costPerBooking', CASE
      WHEN v_dwy THEN v_books_cell
      WHEN NOT v_ad_ok THEN public.cockpit_board_cell('cost_per_booking', NULL, t, NULL, NULL, NULL, 'not_measured', v_ad->'spend'->>'note')
      WHEN booked IS NULL THEN public.cockpit_board_cell('cost_per_booking', NULL, t, NULL, NULL, NULL, 'not_measured',
        coalesce(v_src->'appointments'->>'note', 'No confirmed bookings are stored for these days.'))
      WHEN (v_cover->>'pairTo')::date < (v_cover->>'pairFrom')::date THEN public.cockpit_board_cell('cost_per_booking', NULL, t, NULL, NULL, NULL,
        'not_measured', 'No day of this time frame is over on every linked ad account''s clock yet.')
      WHEN coalesce(r.p_b_d, 0) = 0 THEN public.cockpit_board_cell('cost_per_booking', NULL, t, NULL, NULL, NULL, 'not_measured',
        'No day in this time frame has both ad numbers and confirmed bookings stored.')
      WHEN r.p_b_unpriced > 0 AND r.p_b_spend = 0 THEN public.cockpit_board_cell('cost_per_booking', NULL, t, NULL, NULL, NULL, 'not_measured',
        'The spend is in a currency with no fixed USD rate.')
      WHEN r.p_b_booked > 0 THEN public.cockpit_board_cell('cost_per_booking', round(r.p_b_spend / r.p_b_booked, 2), t, r.p_b_booked,
        round(r.p_b_spend, 2), r.p_b_booked,
        CASE WHEN r.p_b_unpriced > 0 THEN public.cockpit_board_floor_status('cost_per_booking', round(r.p_b_spend / r.p_b_booked, 2), t) END,
        concat_ws(' ', 'Spend and confirmed bookings over the same days, to yesterday.',
          CASE WHEN r.p_b_unpriced > 0 THEN 'Some spend is in a currency with no fixed USD rate, so the cost is at least this.' END, v_pair->>'note'),
        (v_pair - 'note') || CASE WHEN r.p_b_unpriced > 0 THEN jsonb_build_object('atLeast', true) ELSE '{}'::jsonb END)
      WHEN r.p_b_spend > 0 THEN public.cockpit_board_cell('cost_per_booking', NULL, t, 0, round(r.p_b_spend, 2), 0,
        public.cockpit_board_floor_status('cost_per_booking', round(r.p_b_spend, 2), t),
        concat_ws(' ', format('No confirmed booking yet for %s of spend.', public.cockpit_board_fmt(r.p_b_spend, 'usd')), v_pair->>'note'),
        (v_pair - 'note') || jsonb_build_object('atLeast', round(r.p_b_spend, 2)))
      ELSE public.cockpit_board_cell('cost_per_booking', NULL, t, 0, 0, 0, 'too_few',
        concat_ws(' ', 'No spend and no confirmed booking in these days.', v_pair->>'note'), v_pair - 'note') END);

    -- The golden rule (the CEO, 21 Oct 2026; 20261022y): while the cost per booking is
    -- known and within its line, a cost per lead over its line is one to watch, never
    -- off. A done-with-you client books its own meetings, so it keeps the cost per lead's
    -- own status, and so does a cost per booking known only as a floor ("at least").
    IF NOT v_dwy AND v_vals->'costPerBooking'->>'status' = 'good' AND NOT (v_vals->'costPerBooking' ? 'atLeast')
       AND v_vals->'cpl'->>'status' = 'off' THEN
      v_vals := v_vals || jsonb_build_object('cpl', public.cockpit_board_add_note(v_vals->'cpl' || jsonb_build_object('status', 'watch'),
        format('Cost per booking is within the %s gate, so a cost per lead over %s is a watch line, not off (the golden rule).',
          (SELECT '$' || CASE WHEN g = trunc(g) THEN to_char(g, 'FM999,999,990') ELSE to_char(g, 'FM999,999,990.00') END
             FROM (SELECT (t->'cost_per_booking'->>'good')::numeric AS g) x),
          (SELECT '$' || CASE WHEN g = trunc(g) THEN to_char(g, 'FM999,999,990') ELSE to_char(g, 'FM999,999,990.00') END
             FROM (SELECT (t->'cpl'->>'good')::numeric AS g) x))));
    END IF;

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
    v_pair := public.cockpit_board_paired(r.f_qr_d, v_days);
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
        WHEN r.f_qr_d = 0 THEN public.cockpit_board_cell('quotation_rate', NULL, t, NULL, NULL, NULL, 'not_measured',
          'No day in this time frame has both quotations and shows known.')
        WHEN r.f_qr_shows = 0 THEN public.cockpit_board_cell('quotation_rate', NULL, t, 0, r.f_qr_quotes, 0, 'too_few',
          concat_ws(' ', 'No show in this time frame.', v_pair->>'note'), v_pair - 'note')
        ELSE public.cockpit_board_cell('quotation_rate', round(r.f_qr_quotes::numeric / r.f_qr_shows * 100, 2), t, r.f_qr_shows, r.f_qr_quotes, r.f_qr_shows,
          NULL, v_pair->>'note', v_pair - 'note') END);

    -- Closes, close rate, revenue, AOV, ROAS.
    v_pair := public.cockpit_board_paired(r.f_cr_d, v_days);
    v_vals := v_vals || jsonb_build_object(
      'closes', CASE WHEN closes IS NULL THEN jsonb_build_object('v', NULL, 'status', v_closes_status,
                       'note', coalesce(nullif(concat_ws(' ', v_src->'sheet'->>'note', v_src->'outcomes'->>'note'), ''), 'The client does not record closed deals.'))
                     ELSE public.cockpit_board_add_note(
                       public.cockpit_board_count(r.f_closes, r.f_closes_d, v_days, 'not_measured', NULL, jsonb_build_object('withValue', coalesce(valued, 0))
                         || CASE WHEN r.f_pl_d > 0 THEN jsonb_build_object('pending', r.f_pending, 'lost', r.f_lost) ELSE '{}'::jsonb END),
                       -- A client who marks only wins has no pending or lost to say (20261016210000).
                       CASE WHEN r.f_pl_d > 0 AND r.f_pending + r.f_lost > 0
                         THEN format('Won %s, still pending %s, lost %s.', r.f_closes, r.f_pending, r.f_lost) END) END,
      'closeRate', CASE
        WHEN closes IS NULL THEN public.cockpit_board_cell('close_rate', NULL, t, NULL, NULL, NULL, v_closes_status, 'The client does not record closed deals.')
        WHEN shows IS NULL THEN public.cockpit_board_cell('close_rate', NULL, t, NULL, closes, NULL, 'not_filled_in', 'No meeting is marked showed, so the rate is not known.')
        WHEN r.f_cr_d = 0 THEN public.cockpit_board_cell('close_rate', NULL, t, NULL, NULL, NULL, 'not_measured',
          'No day in this time frame has both closed deals and shows known.')
        WHEN r.f_cr_shows = 0 THEN public.cockpit_board_cell('close_rate', NULL, t, 0, r.f_cr_closes, 0, 'too_few',
          concat_ws(' ', 'No show in this time frame.', v_pair->>'note'), v_pair - 'note')
        ELSE public.cockpit_board_cell('close_rate', round(r.f_cr_closes::numeric / r.f_cr_shows * 100, 2), t, r.f_cr_shows, r.f_cr_closes, r.f_cr_shows,
          NULL, v_pair->>'note', v_pair - 'note') END,
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

    -- ROAS: revenue by meeting day / spend, over the same days as cost per booking, those the facts know closed deals for.
    v_pair := CASE WHEN v_ad_ok THEN public.cockpit_board_paired(r.p_r_d, v_ad_days) ELSE '{}'::jsonb END;
    v_x := CASE WHEN r.p_r_spend > 0 THEN round(r.p_r_rev / r.p_r_spend, 2) END;
    v_vals := v_vals || jsonb_build_object('roas', CASE
      WHEN closes IS NULL THEN public.cockpit_board_cell('roas', NULL, t, NULL, NULL, NULL, v_closes_status, 'The client does not record closed deals.')
      WHEN NOT v_ad_ok THEN public.cockpit_board_cell('roas', NULL, t, NULL, NULL, NULL, 'not_measured', v_ad->'spend'->>'note')
      WHEN (v_cover->>'pairTo')::date < (v_cover->>'pairFrom')::date THEN public.cockpit_board_cell('roas', NULL, t, NULL, NULL, NULL,
        'not_measured', 'No day of this time frame is over on every linked ad account''s clock yet.')
      WHEN coalesce(r.p_r_d, 0) = 0 THEN public.cockpit_board_cell('roas', NULL, t, NULL, NULL, NULL, 'not_measured',
        'No day in this time frame has both ad numbers and closed deals stored.')
      WHEN r.p_r_unpriced > 0 THEN public.cockpit_board_cell('roas', NULL, t, NULL, round(r.p_r_rev, 2), round(r.p_r_spend, 2), 'not_measured',
        'Some spend is in a currency with no fixed USD rate, so ROAS is not known.')
      WHEN r.p_r_spend = 0 THEN public.cockpit_board_cell('roas', NULL, t, NULL, round(r.p_r_rev, 2), 0, 'not_measured', 'No ad spend in these days.')
      WHEN r.p_r_closes > r.p_r_valued OR r.p_r_unpriced_closes > 0 THEN
        public.cockpit_board_cell('roas', v_x, t, NULL, round(r.p_r_rev, 2), round(r.p_r_spend, 2), public.cockpit_board_floor_status('roas', v_x, t),
          concat_ws(' ', 'A closed deal has no value in a known currency, so ROAS is at least this.', v_pair->>'note'),
          (v_pair - 'note') || jsonb_build_object('atLeast', true))
      ELSE public.cockpit_board_cell('roas', v_x, t, NULL, round(r.p_r_rev, 2), round(r.p_r_spend, 2), NULL,
        concat_ws(' ', 'Revenue by meeting day to yesterday, over the same days'' spend.', v_pair->>'note'), v_pair - 'note') END);

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
        WHEN r.n_share IS NULL THEN public.cockpit_board_cell('leads_touched', NULL, t, coalesce(r.n_callable, 0), coalesce(r.n_verified, r.n_touched), r.n_callable, 'too_few',
          coalesce(r.n_note, 'No lead from the last 30 days is old enough to judge yet.'))
        -- Facts worked out before the Maqsam split (20261016210000): the looser share, said so.
        WHEN r.n_verified IS NULL OR coalesce(r.n_callable, 0) = 0 THEN public.cockpit_board_cell('leads_touched', round(r.n_share * 100, 2), t, r.n_callable, r.n_touched, r.n_callable, NULL,
          concat_ws(' ', 'Last 30 days, as of ' || to_char(r.n_computed AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI') || ' Kuwait time.',
            'This still counts a saved outcome with no Maqsam call; the next refresh counts Maqsam calls only.', r.n_note))
        -- A lead counts once it has a Maqsam call. A saved outcome with no call
        -- (one caller saved 798 outcomes against 530 Maqsam calls in 30 days)
        -- is said beside it, never counted as contact.
        ELSE public.cockpit_board_cell('leads_touched', round(r.n_verified::numeric / r.n_callable * 100, 2), t, r.n_callable, r.n_verified, r.n_callable, NULL,
          concat_ws(' ',
            format('%s of the %s callable leads from the last 30 days have a Maqsam call, as of %s Kuwait time.',
              r.n_verified, r.n_callable, to_char(r.n_computed AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI')),
            CASE WHEN r.n_outcome_only > 0 THEN format('%s more %s a saved outcome but no Maqsam call, so %s not counted (%s%% if %s were).',
              r.n_outcome_only, CASE WHEN r.n_outcome_only = 1 THEN 'has' ELSE 'have' END, CASE WHEN r.n_outcome_only = 1 THEN 'it is' ELSE 'they are' END,
              round(r.n_share * 100), CASE WHEN r.n_outcome_only = 1 THEN 'it' ELSE 'they' END) END,
            -- The facts' own sentence about outcome-only touches says the same thing again.
            nullif(btrim(regexp_replace(r.n_note,
              '[0-9]+ of the [0-9]+ touched leads had a dialer outcome saved but no Maqsam call to the number\.\s*', '', 'g')), '')),
          jsonb_build_object('outcomeOnly', r.n_outcome_only, 'touchedShare', round(r.n_share * 100, 2))) END,
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

    IF v_dwy THEN v_notes := v_notes || 'Done With You: the client calls its own leads and books its own meetings.'::text; END IF;
    IF r.clickup_id IS NULL THEN v_notes := v_notes || 'No ClickUp card, so no lever can be filed for this client.'::text; END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'locationId', r.location_id, 'clickupId', r.clickup_id, 'clientName', r.client_name, 'status', r.status,
      'serviceMode', r.service_mode, 'clientCalls', v_dwy, 'tiktok', r.tiktok,
      'adAccounts', to_jsonb(coalesce(r.ad_account_ids, '{}'::text[])),
      'adCover', v_cover,
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
END $fn$;

CREATE OR REPLACE FUNCTION public.cockpit_board_tree(p_location text, p_accounts text[], p_from date, p_to date, p_targets jsonb, p_marks jsonb, p_cover jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_now timestamptz := public.cockpit_meta_ad_days_now();
  v_start timestamptz := p_from::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_end timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_ad_ok boolean := coalesce(p_cover->>'state' IN ('full', 'partial'), false);
  v_win_to date := (p_cover->>'winTo')::date;
  v_pair_from date := (p_cover->>'pairFrom')::date;
  v_pair_to date := (p_cover->>'pairTo')::date;
  v_pair_start timestamptz := (p_cover->>'pairFrom')::date::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_pair_end timestamptz := ((p_cover->>'pairTo')::date + 1)::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_partial jsonb := CASE WHEN coalesce((p_cover->>'partial')::boolean, false)
    THEN jsonb_build_object('partial', true, 'partial_note', p_cover->>'note') ELSE '{}'::jsonb END;
  v_unmeasured jsonb := public.cockpit_board_ad_unmeasured('not_measured',
    coalesce(p_cover->>'note', 'No Meta ad account is linked to this client.'));
  v_pair_days text := CASE WHEN (p_cover->>'pairTo')::date >= (p_cover->>'pairFrom')::date
    THEN format('%s to %s', to_char((p_cover->>'pairFrom')::date, 'DD Mon'), to_char((p_cover->>'pairTo')::date, 'DD Mon')) END;
  v_out jsonb;
  -- (2026-10-21) The bookings that are not bookings, by the facts' rule.
  v_gone text[] := '{}'::text[];
  v_drop text[] := '{}'::text[];
  -- Done with you (20261023r): the client books its own meetings, so no campaign, ad set or ad
  -- of it has a cost per booking that is judged. The booking counts stay.
  v_dwy boolean := coalesce((SELECT bool_or(upper(btrim(b.service_mode)) = 'DWY') FROM public.cockpit_board_clients b
    WHERE b.location_id = p_location), false);
  v_books_cell constant jsonb := jsonb_build_object('v', NULL, 'status', 'not_measured',
    'note', 'Done with you: the client books its own meetings, so its cost per booking and booking rate are not judged.', 'clientBooks', true);
BEGIN
  -- Not a booking, by the facts' rule (2026-10-21): bookings GoHighLevel no longer holds
  -- (cockpit_board_gone_booking_ids), the call centre's call backs and the bookings it moved while the
  -- first still counts (cockpit_board_replaced_booking_ids). Each is read in a block of its own, so a
  -- read that fails leaves the bookings as they were counted before rather than the client page broken.
  BEGIN
    SELECT coalesce(array_agg(DISTINCT g.id), '{}'::text[]) INTO v_gone
    FROM public.cockpit_board_gone_booking_ids(ARRAY[p_location]) g WHERE nullif(g.id, '') IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    v_gone := '{}'::text[];
  END;
  BEGIN
    SELECT coalesce(array_agg(DISTINCT r.id), '{}'::text[]) INTO v_drop
    FROM public.cockpit_board_replaced_booking_ids(ARRAY[p_location], v_gone) r WHERE nullif(r.id, '') IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    v_drop := '{}'::text[];
  END;
  v_drop := v_drop || v_gone;

  WITH m AS (
    -- Ad days the store holds: to yesterday, each finished on its own account's clock.
    SELECT x.* FROM public.cockpit_meta_ad_days x
    WHERE v_ad_ok AND x.account_id = ANY(coalesce(p_accounts, '{}'::text[])) AND x.day BETWEEN p_from AND v_win_to
      AND x.day < (v_now AT TIME ZONE coalesce(x.account_timezone, 'Asia/Kuwait'))::date
      -- Never an ad on the compromise list (cockpit_excluded_ads), matched on the ad id alone.
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xa WHERE xa.ad_id = x.ad_id)
  ), names AS (
    SELECT DISTINCT ON (x.ad_id) x.ad_id, x.ad_name, x.adset_id, x.adset_name, x.campaign_id, x.campaign_name, x.objective,
      x.destination_type, x.account_id
    FROM public.cockpit_meta_ad_days x
    WHERE x.account_id = ANY(coalesce(p_accounts, '{}'::text[]))
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xa WHERE xa.ad_id = x.ad_id)
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
      -- bookings_ad: made on the days cost per booking divides over (every linked account stored).
      SELECT a.ad_id, 0, 1, CASE WHEN a.booked_at >= v_pair_start AND a.booked_at < v_pair_end THEN 1 ELSE 0 END, 0, 0, 0 FROM ap a
      WHERE a.kind IN ('main', 'online') AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid')
        AND a.booked_at >= v_start AND a.booked_at < v_end
        -- Before 2026-10-21 the tree dropped none of these, so a campaign could show more bookings than
        -- its client's row. Meetings due below are as before.
        AND NOT (a.id = ANY(v_drop))
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
      sum(m.spend_usd) FILTER (WHERE m.day BETWEEN v_pair_from AND v_pair_to) AS pair_spend,
      count(*) FILTER (WHERE m.day BETWEEN v_pair_from AND v_pair_to AND m.spend IS NOT NULL AND m.spend_usd IS NULL) AS pair_unpriced,
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
            sum(a.freq_w) AS freq_w, sum(a.freq_imp) AS freq_imp, sum(a.pair_spend) AS pair_spend, sum(a.pair_unpriced) AS pair_unpriced,
            sum(a.crm_leads) AS crm_leads, sum(a.crm_bookings) AS crm_bookings,
            sum(a.crm_bookings_ad) AS crm_bookings_ad, sum(a.crm_shows) AS crm_shows, sum(a.crm_no_shows) AS crm_no_shows,
            sum(a.crm_due) AS crm_due
          FROM per_ad a GROUP BY a.adset_id) x
    UNION ALL
    SELECT 'campaign', x.campaign_id, NULL, x.campaign_id, to_jsonb(x) - 'campaign_id'
    FROM (SELECT a.campaign_id, sum(a.rows) AS rows, sum(a.spend) AS spend, sum(a.unpriced) AS unpriced,
            sum(a.imp) AS imp, sum(a.clicks) AS clicks, sum(a.lead_rows) AS lead_rows, sum(a.leads) AS leads, sum(a.lead_spend) AS lead_spend,
            sum(a.lead_clicks) AS lead_clicks, sum(a.video_rows) AS video_rows, sum(a.video_imp) AS video_imp, sum(a.v3) AS v3, sum(a.thru) AS thru,
            sum(a.plays) AS plays, sum(a.p25) AS p25, sum(a.p50) AS p50, sum(a.p75) AS p75, sum(a.p100) AS p100,
            sum(a.freq_w) AS freq_w, sum(a.freq_imp) AS freq_imp, sum(a.pair_spend) AS pair_spend, sum(a.pair_unpriced) AS pair_unpriced,
            sum(a.crm_leads) AS crm_leads, sum(a.crm_bookings) AS crm_bookings,
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
      CASE WHEN v_ad_ok THEN public.cockpit_board_ad_cells(l.s || v_partial, p_targets, rr.j) ELSE v_unmeasured END
      || jsonb_build_object(
        'crmLeads', jsonb_build_object('v', (l.s->>'crm_leads')::numeric, 'status', NULL),
        'confirmedBookings', jsonb_build_object('v', (l.s->>'crm_bookings')::numeric, 'status', NULL),
        'shows', public.cockpit_board_shows((l.s->>'crm_shows')::numeric, (l.s->>'crm_no_shows')::numeric, (l.s->>'crm_due')::numeric),
        'costPerBooking', CASE
          WHEN v_dwy THEN v_books_cell
          WHEN NOT v_ad_ok THEN public.cockpit_board_cell('cost_per_booking', NULL, p_targets, NULL, NULL, NULL, 'not_measured', p_cover->>'note')
          WHEN v_pair_days IS NULL THEN public.cockpit_board_cell('cost_per_booking', NULL, p_targets, NULL, NULL, NULL, 'not_measured',
            'No day of this time frame is over on every linked ad account''s clock yet.')
          WHEN coalesce((l.s->>'pair_unpriced')::numeric, 0) > 0 AND coalesce((l.s->>'pair_spend')::numeric, 0) = 0 THEN
            public.cockpit_board_cell('cost_per_booking', NULL, p_targets, NULL, NULL, NULL, 'not_measured', 'The spend is in a currency with no fixed USD rate.')
          WHEN (l.s->>'crm_bookings_ad')::numeric > 0 AND (l.s->>'pair_spend') IS NOT NULL THEN
            public.cockpit_board_cell('cost_per_booking', round((l.s->>'pair_spend')::numeric / (l.s->>'crm_bookings_ad')::numeric, 2), p_targets,
              (l.s->>'crm_bookings_ad')::numeric, round((l.s->>'pair_spend')::numeric, 2), (l.s->>'crm_bookings_ad')::numeric,
              CASE WHEN (l.s->>'pair_unpriced')::numeric > 0 THEN public.cockpit_board_floor_status('cost_per_booking',
                round((l.s->>'pair_spend')::numeric / (l.s->>'crm_bookings_ad')::numeric, 2), p_targets) END,
              format('Confirmed bookings with this ad id and spend over the same days, %s.', v_pair_days),
              CASE WHEN (l.s->>'pair_unpriced')::numeric > 0 THEN jsonb_build_object('atLeast', true) END)
          WHEN coalesce((l.s->>'pair_spend')::numeric, 0) > 0 THEN
            public.cockpit_board_cell('cost_per_booking', NULL, p_targets, 0, round((l.s->>'pair_spend')::numeric, 2), 0,
              public.cockpit_board_floor_status('cost_per_booking', round((l.s->>'pair_spend')::numeric, 2), p_targets),
              format('No confirmed booking with this ad id yet, %s.', v_pair_days), jsonb_build_object('atLeast', round((l.s->>'pair_spend')::numeric, 2)))
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
END $fn$;

CREATE OR REPLACE FUNCTION public.cockpit_dictionary_definitions()
 RETURNS TABLE(metric text, label text, formula text, counts text, leaves_out text, source text, decision text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $fn$
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
     'Provisional bookings (not-confirmed calendar), shown beside it and never counted. Days with no ad numbers. A done-with-you client (it books its own meetings): no cost per booking, and its spend is out of every portfolio cost per booking.',
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
$fn$;

-- The lever's ClickUp evidence (20261017b's body): a done-with-you cell reads "done with you", not
-- "not measured".
CREATE OR REPLACE FUNCTION public.cockpit_board_lever_context(p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
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
  -- team-only: a call center seat reads its clients' rows; levers go through
  -- the client's media buyer or CSM.
  IF coalesce(public.cockpit_is_team_only(), false) THEN
    RAISE EXCEPTION 'Call center seats can read the board but not add levers. Ask the client''s media buyer or CSM to add it.' USING ERRCODE = '42501';
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
        -- Done with you (the CEO, 23 Oct 2026, cost per booking decisions, 2; 20261023r): the cell is
        -- not judged by rule, never a gap in the data.
        WHEN coalesce((v_cell->>'clientBooks')::boolean, false) THEN 'done with you (the client books its own meetings), so not judged'
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
END $fn$;

-- The grants as they are live, restated (CREATE OR REPLACE keeps the live ones; this says them once more).
REVOKE ALL ON FUNCTION public.cockpit_board_rows(date,date,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_board_tree(text,text[],date,date,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_dictionary_definitions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_dictionary_definitions() TO service_role;
REVOKE ALL ON FUNCTION public.cockpit_board_lever_context(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_board_lever_context(jsonb) TO authenticated;
COMMIT;
