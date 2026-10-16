-- Client Performance board: the read takes the 16 October corrections
-- (2026-10-16, Creative Triage bldgtotkfmhoxmlzowdx).
--
-- The CEO, 2026-10-16: "check the numbers and even make it better and more
-- accurate the data and tell me all sources of truth". The second-source
-- check (docs/client-performance/SOURCES.md) fixed the facts underneath
-- (20261016210000, 20261016210100, 20261016210200) and left the board's own
-- read to take three of them. This does:
--
--   - Leads contacted (leadsTouched, judged against the call centre's 90%
--     line) counts a lead once it has a Maqsam call: verified_called_30d /
--     callable_30d. A saved outcome with no Maqsam call no longer counts as
--     contact. On 16 Oct that moved City Wood from 95% to 57%, Marble and
--     more from 100% to 76%, شركة العلا from 95% to 80%, mergestudio from 94%
--     to 81%, Arcturus from 99% to 89% and Khalida from 100% to 57%. The
--     looser share stays in the cell (touchedShare, outcomeOnly) and its note.
--     Facts worked out before 20261016210000 keep the looser share and say so.
--   - Closes carries won, pending and lost (closes_pending, closes_lost) and
--     says them in its note; the close rate stays closes / shows.
--   - CRM leads says how many are Instagram or Messenger chats with no ad
--     (crm_dm_contacts, kept in CRM leads because the call centre calls them).
--   - The board read returns offBoard: spend in the time frame on ad accounts
--     no client row carries (a cancelled client's account still delivering,
--     an account tied to no client, one kept out on purpose), with each
--     account and why. Whole-board seats only, as notLinked.
--   - The leads-contacted target's label is "Leads contacted".
--
-- Replaces cockpit_board_default_targets, cockpit_board_rows and
-- cockpit_board_read (20261016133300; their live bodies matched that file on
-- 16 Oct) and adds cockpit_board_add_note. The output keeps every key it had;
-- the new keys are additions. Grants restated: unchanged.
--
-- Rollback: re-run, from 20261016133300_board_api.sql, cockpit_board_default_targets
-- (section 2), cockpit_board_rows (section 4) and cockpit_board_read (section 6),
-- then drop cockpit_board_add_note.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A note added to a cell, beside the note it already carries

CREATE OR REPLACE FUNCTION public.cockpit_board_add_note(p_cell jsonb, p_note text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_note IS NULL OR p_cell IS NULL THEN p_cell
              ELSE p_cell || jsonb_build_object('note', concat_ws(' ', p_cell->>'note', p_note)) END
$$;

-- ---------------------------------------------------------------------------
-- 2. The leads-contacted target says what it counts

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
    (18, 'leads_touched', 'leadsTouched', 'Leads contacted', 'percent', 'higher', 90, 90, false, false, 20, 'callable leads',
        'call_center', 'callCentre.ts CALL_RULES.touchedShare and minLeads, over leads with a Maqsam call (2026-10-16 check); any miss is off, as in callCentreVerdict'),
    (19, 'first_call', 'firstCall', 'First call', 'minutes', 'lower', 30, 30, false, false, NULL, NULL,
        'call_center', 'callCentre.ts CALL_RULES.firstCallWorkMinutes, in working minutes; any miss is off, as in callCentreVerdict')
  ) AS v(n, metric, value_key, label, unit, direction, good, watch, strict_good, never_off, min_sample, sample, owner_department, basis)
  ORDER BY v.n
$$;

-- ---------------------------------------------------------------------------
-- 3. The rows: leads contacted on Maqsam calls, won/pending/lost, DMs said

CREATE OR REPLACE FUNCTION public.cockpit_board_rows(p_from date, p_to date, p_location text, p_meta jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
  v_cell jsonb;
  v_x numeric;
  v_pair jsonb;
BEGIN
  FOR r IN
    WITH cl AS (
      SELECT b.location_id, b.clickup_id, b.client_name, b.status, b.service_mode, b.ad_account_ids, b.tiktok,
        public.cockpit_board_ad_cover(b.ad_account_ids, p_from, p_to, p_meta) AS cover
      FROM public.cockpit_board_clients b
      WHERE coalesce(b.status, '') NOT IN ('Cancelled', 'Removed from sheet')
        AND (p_location IS NULL OR b.location_id = p_location)
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
    v_dwy := r.service_mode = 'DWY';
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
                       CASE WHEN r.f_pl_d > 0 THEN format('Won %s, still pending %s, lost %s.', r.f_closes, r.f_pending, r.f_lost) END) END,
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
            r.n_note),
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

    IF v_dwy THEN v_notes := v_notes || 'Done With You: the client calls its own leads.'::text; END IF;
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
END $$;

-- ---------------------------------------------------------------------------
-- 4. The board: spend no client row carries

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
  v_off jsonb;
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

  -- Spend in these days on ad accounts no client row carries: a cancelled
  -- client's account still delivering, an account tied to no client, or one
  -- kept out on purpose. It names other clients, so only whole-board seats
  -- see it; the rows' totals never include it.
  IF v_whole THEN
    WITH shown AS (
      SELECT DISTINCT a FROM public.cockpit_board_clients b, unnest(b.ad_account_ids) a
      WHERE coalesce(b.status, '') NOT IN ('Cancelled', 'Removed from sheet')
    ), owner AS (
      SELECT a, min(b.client_name) AS client_name, min(b.status) AS status
      FROM public.cockpit_board_clients b, unnest(b.ad_account_ids) a GROUP BY a
    ), acct AS (
      SELECT m.account_id, max(m.account_name) AS account_name, sum(m.spend_usd) AS spend,
        count(*) FILTER (WHERE m.spend > 0 AND m.spend_usd IS NULL) AS unpriced
      FROM public.cockpit_meta_ad_days m
      WHERE m.day BETWEEN p_from AND p_to
        AND m.day < (public.cockpit_meta_ad_days_now() AT TIME ZONE coalesce(m.account_timezone, 'Asia/Kuwait'))::date
        AND NOT EXISTS (SELECT 1 FROM shown s WHERE s.a = m.account_id)
      GROUP BY m.account_id
      HAVING sum(m.spend) > 0
    )
    SELECT jsonb_build_object(
        'spend', round(coalesce(sum(x.spend), 0), 2),
        'unpriced', coalesce(sum(x.unpriced), 0) > 0,
        'accounts', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'accountId', x.account_id, 'name', x.account_name, 'spend', round(x.spend, 2),
          'client', coalesce(o.client_name, k.client_name),
          'reason', CASE WHEN k.kept_out THEN 'kept_out'
                         WHEN o.status IN ('Cancelled', 'Removed from sheet') THEN 'cancelled'
                         ELSE 'not_tied' END)) ORDER BY x.spend DESC NULLS LAST), '[]'::jsonb))
      INTO v_off
    FROM acct x
    LEFT JOIN owner o ON o.a = x.account_id
    LEFT JOIN LATERAL (
      SELECT t.kept_out, b.client_name FROM public.cockpit_board_account_ties t
      LEFT JOIN public.cockpit_board_clients b ON b.location_id = t.location_id
      WHERE t.account_id = x.account_id ORDER BY t.kept_out DESC LIMIT 1) k ON true;
  END IF;

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
    'offBoard', v_off,
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

-- ---------------------------------------------------------------------------
-- 5. Function privileges: as 20261016133300, plus the note helper (internal)

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['cockpit_board_add_note(jsonb,text)', 'cockpit_board_default_targets()',
    'cockpit_board_rows(date,date,text,jsonb)', 'cockpit_board_read(date,date)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_board_read(date,date) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_board_default_targets() TO service_role';
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
