-- Client Performance board: ads on the compromise list never count (2026-10-21, Creative Triage
-- bldgtotkfmhoxmlzowdx).
--
-- The ads outsiders placed during the October 2026 Meta compromise are listed in
-- public.cockpit_excluded_ads (20261010a). The media sync drops them (withoutExcludedAds in
-- hermes/cockpit-sync), and so does the dashboard feed (the snapshot trigger), but no board function
-- read the list. So the board counted their delivery as the client's own. On Munshaat Khalida's old
-- account 1275190574533155 that is $189.83 in September and $1,442.30 in October, most of it ad
-- 120246795745520088 in "29/8". It also touched Liwan and ARCWANI, and the spend outside the rows
-- (Ideal Elite, Rm decor).
--
-- What changes, and nothing else:
--   - Every ad-day read that counts leaves out an ad the list names. That covers spend, impressions,
--     clicks, leads and video on the rows; the tree; the spend no row carries; the budget pairs; and
--     the pay facts. The match is on the ad id alone, as the media sync and the snapshot trigger
--     match it: Meta's ad ids are unique, so the account the list writes beside it does not matter.
--   - An outsiders' campaign is one the list names whose stored ads are all on it. Its budget leaves
--     the sums in Budget/day and Budget used with its spend (with its spend gone, it would otherwise
--     stay in Budget used at 0% spent). While it is switched on it is said, never hidden: Budget/day's
--     note names it with its budget ("2 outsiders' campaigns on the compromise list are switched on
--     at $7,260.00 a day, not counted: switch them off in Meta.") and the cell carries `outsiders`
--     {campaigns, budget, atLeast}; the client page's budget list keeps it as a row flagged off
--     ('outsider': true) with no figures, a lifetime budget's included ('lifetime' is null). A campaign that also holds an ad off the list keeps its
--     budget; only the listed ad's spend leaves. The campaigns are looked up on the caller's accounts
--     only.
--   - The ad account is read as Meta runs it: an outsiders' campaign switched on keeps the account in
--     use (so "Account unsettled" still shows on Liwan and ARCWANI), and the days of spending limit
--     or prepaid balance left count its budget, since Meta spends the limit on it.
--   - A client row's frequency: Meta reads reach per account, so when a listed ad delivered on the
--     client's accounts in the time frame, Meta's reach for it is mostly the outsiders' (1-21 Oct, Liwan:
--     460,096 impressions, 7,119 of them its own to yesterday). The row leaves that reach out, so the
--     frequency is the impression-weighted daily frequency of the client's own ads, and its note says
--     why: Liwan 1.30 -> 1.12, ARCWANI 1.28 -> 1.12, Khalida 1.19 -> 1.08. The tree's campaign, ad set
--     and ad reach is each node's own, and the listed nodes are gone with their rows.
--
-- Checked on live data on 2026-10-21 (the live definitions re-read first: unchanged since the
-- morning), inside a transaction that ended in an exception, so nothing was kept. Spend to yesterday:
--   - Khalida: September $594.09 -> $404.26, October $1,704.74 -> $262.44.
--   - Liwan: September $1,063.77 -> $946.94, October $1,379.53 -> $194.58. Budget/day $7,260 -> $0,
--     its note naming the two outsiders' campaigns ($7,260 a day) and the unsettled account.
--   - ARCWANI: September $832.63 -> $791.81, October $418.97 -> $151.40. Budget/day $1,109 -> $35,
--     its note naming one outsiders' campaign ($1,074 a day) and the unsettled account.
--   - Each equals the store's own sum without the listed ads. The board's October spend: $10,578.42 ->
--     $7,683.60. The pay facts' September cost per booking: $57.78 -> $55.51; the strategist's guard
--     over every client: $14.92 over 11 -> $14.05 over 10 (Khalida's own spend is under $500).
-- Two more outsiders' ads on Khalida's old account count until they are listed:
-- 120247012327250088 and 120247083365360088.
--
-- Not changed, on purpose:
--   - cockpit_board_spend_known asks whether an account day was read, not what it spent.
--   - cockpit_board_facts_refresh reads the store only to tie accounts to clients.
--   - cockpit_board_no_outcome_list looks up an ad's name.
--   - cockpit_meta_ad_days_status reports the store's health and who is delivering. An outsider
--     delivering on a cancelled client's account should still show there.
--   - cockpit_meta_reach_rebuild_clients: Meta's reach is per account, so one ad cannot be taken out
--     (the client row leaves the reach out instead, above).
--   - cockpit_meta_leads_not_in_crm reads lead ids, and no listed ad has any.
--
-- Replaces these, each from its live definition (equal to the repo's latest on 2026-10-21, read with
-- pg_get_functiondef): cockpit_board_rows (20261017100100), cockpit_board_read (20261017b),
-- cockpit_board_tree (20261016133300), cockpit_board_budget_cells (20261017120000),
-- cockpit_board_budget_list (20261017100100) and cockpit_pay_facts_ads (20261018b).
-- Grants are restated as live: only cockpit_board_read runs for authenticated, the rest for nobody.
-- Safe to run twice. Rollback: restore each function's definition from the migration named beside it
-- (that statement only, not the whole file).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The client rows: the ad-days of each client's accounts (as 20261017100100 left it).

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
-- 2. The board: the spend no client row carries, "Not in these totals" (as 20261017b left it).

CREATE OR REPLACE FUNCTION public.cockpit_board_read(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_meta jsonb;
  v_rows jsonb;
  v_facts record;
  v_notes text[] := '{}';
  v_hourly jsonb;
  v_whole boolean;
  v_off jsonb;
  v_bud_at timestamptz;
BEGIN
  IF NOT coalesce(public.cockpit_has_active_seat(), false) THEN
    RAISE EXCEPTION 'Sign in with an active cockpit seat to see the Client Performance board.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.cockpit_board_check_window(p_from, p_to);
  -- Ad accounts tied to no client, and the Meta jobs' own notes, name other
  -- clients' accounts: only the CEO, admins and seats not limited to some
  -- clients see them (cockpit_client_allowed's rule for the whole board).
  -- team-only: a call center seat is never a whole-board seat.
  v_whole := coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false)
    OR (NOT coalesce(public.cockpit_is_team_only(), false) AND EXISTS (SELECT 1 FROM public.cockpit_members cm JOIN auth.users au ON au.id = cm.auth_user_id
               WHERE cm.auth_user_id = auth.uid() AND cm.active AND au.email_confirmed_at IS NOT NULL
                 AND cm.email = lower(btrim(au.email)) AND cardinality(coalesce(cm.clients, '{}'::text[])) = 0));
  v_meta := public.cockpit_meta_ad_days_status();
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'clientName', x->>'locationId'), '[]'::jsonb) INTO v_rows
  FROM jsonb_array_elements(public.cockpit_board_rows(p_from, p_to, NULL, v_meta)) x
  WHERE public.cockpit_client_allowed(x->>'clientName');

  -- Spend in these days on ad accounts no client row carries: a cancelled
  -- client's account still delivering, a client that is not Active (paused,
  -- stopped, launching, ghosting: off the board since 2026-10-17), an account
  -- tied to no client, or one kept out on purpose. It names other clients, so
  -- only whole-board seats see it; the rows' totals never include it.
  IF v_whole THEN
    WITH shown AS (
      SELECT DISTINCT a FROM public.cockpit_board_clients b, unnest(b.ad_account_ids) a
      WHERE b.status = 'Active'
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
        -- Never an ad on the compromise list (cockpit_excluded_ads), matched on the ad id alone.
        AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xa WHERE xa.ad_id = m.ad_id)
      GROUP BY m.account_id
      HAVING sum(m.spend) > 0
    )
    SELECT jsonb_build_object(
        'spend', round(coalesce(sum(x.spend), 0), 2),
        'unpriced', coalesce(sum(x.unpriced), 0) > 0,
        'accounts', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'accountId', x.account_id, 'name', x.account_name, 'spend', round(x.spend, 2),
          'client', coalesce(o.client_name, k.client_name),
          'clientStatus', CASE WHEN NOT coalesce(k.kept_out, false) AND o.status NOT IN ('Cancelled', 'Removed from sheet') THEN o.status END,
          'reason', CASE WHEN k.kept_out THEN 'kept_out'
                         WHEN o.status IN ('Cancelled', 'Removed from sheet') THEN 'cancelled'
                         WHEN o.client_name IS NOT NULL THEN 'not_active'
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
  -- Budgets (2026-10-17): read every hour by meta-ad-days, with their own
  -- state (a failed budgets read never makes the ad numbers incomplete).
  v_bud_at := (v_meta->'budgets'->>'newestFetchedAt')::timestamptz;
  IF v_bud_at IS NULL THEN
    v_notes := v_notes || 'Meta budgets have not been read yet, so Budget/day and Budget used are empty.'::text;
  ELSIF v_bud_at < now() - interval '3 hours' THEN
    v_notes := v_notes || format('Budgets were last read at %s Kuwait time.',
      to_char(v_bud_at AT TIME ZONE 'Asia/Kuwait',
        CASE WHEN (v_bud_at AT TIME ZONE 'Asia/Kuwait')::date = v_today THEN 'HH24:MI' ELSE 'HH24:MI on DD Mon' END));
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
END $function$;

-- ---------------------------------------------------------------------------
-- 3. The client page's campaign tree: its ad-days and the ads it names (as 20261016133300 left it).

CREATE OR REPLACE FUNCTION public.cockpit_board_tree(p_location text, p_accounts text[], p_from date, p_to date,
  p_targets jsonb, p_marks jsonb, p_cover jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
BEGIN
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
END $$;

-- ---------------------------------------------------------------------------
-- 4. Budget/day, Spend/day and Budget used: the listed ads and the outsiders' campaigns out of the sums, the
-- outsiders' campaigns switched on said (as 20261017120000 left it).

CREATE OR REPLACE FUNCTION public.cockpit_board_budget_cells(p_accounts text[], p_campaign text, p_from date, p_to date,
  p_cover jsonb, p_meta jsonb, p_targets jsonb, p_spend jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_accounts text[] := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_accounts, '{}'::text[])) x WHERE x IS NOT NULL);
  v_ad_ok boolean := coalesce(p_cover->>'state' IN ('full', 'partial'), false);
  v_win_to date := (p_cover->>'winTo')::date;
  v_ad_days integer := (p_cover->>'adDays')::integer;
  v_none constant text := 'No Meta ad account is linked to this client.';
  v_clocks jsonb;
  n record;
  o record;
  w record;
  cb public.cockpit_meta_budgets;
  v_read_n integer; v_unread_n integer; v_unread text; v_as_of timestamptz; v_stale text;
  v_issues jsonb; v_issue_words text; v_why text[]; v_why_words text; v_all_unpriced boolean; v_local text;
  v_reads jsonb; v_hist_n integer; v_known integer := 0; v_any_read boolean := false; v_first date; v_lag text; v_late text;
  v_y_read integer; v_y_accounts integer; v_y_min date; v_y_max date;
  v_ys numeric; v_ys_unpriced integer; v_ys_read boolean;
  v_zero date;
  v_spend jsonb := p_spend;
  v_s numeric; v_su integer; v_spend_days integer;
  v_daily jsonb; v_per_day jsonb; v_used jsonb; v_yesterday jsonb; v_spent_y jsonb; v_used_y jsonb;
  v_pair jsonb; v_extra jsonb; v_x numeric; v_note text; v_outsiders text;
  -- The outsiders' own campaigns on these accounts (2026-10-21): named on cockpit_excluded_ads, with
  -- no ad stored that the list does not name. Their budgets are never the client's, so they leave the
  -- sums with their spend, and are said instead. Campaign ids, unique in Meta as ad ids are.
  v_out_campaigns text[] := ARRAY(
    SELECT DISTINCT xa.campaign_id
    FROM public.cockpit_excluded_ads xa
    WHERE xa.campaign_id IS NOT NULL AND regexp_replace(xa.account_id, '^act_', '') = ANY(v_accounts)
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_meta_ad_days m
                      WHERE m.campaign_id = xa.campaign_id
                        AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xb WHERE xb.ad_id = m.ad_id)));
BEGIN
  IF cardinality(v_accounts) = 0 THEN
    RETURN jsonb_build_object(
      'dailyBudget', public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_none),
      'spendPerDay', public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_none),
      'budgetUsed', public.cockpit_board_cell('budget_used', NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_none),
      'spentYesterday', public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_none),
      'usedYesterday', public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_none));
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_clocks FROM public.cockpit_board_budget_clocks(v_accounts, p_meta) c;

  -- Which accounts' budgets were ever read (the account state comes with every read), and when. An
  -- account never read is named, with why when the last run knows (not listed under Mahara's business,
  -- or its read failed); one read more than 3 hours ago is named with its time.
  SELECT count(s.account_id)::int, (count(*) - count(s.account_id))::int,
         string_agg(format('Budgets for act_%s%s have not been read%s.', c.account_id, coalesce(' (' || c.name || ')', ''),
             CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_meta->'budgets'->'unlisted', '[]'::jsonb)) u
                               WHERE coalesce(u->>'accountId', u #>> '{}') = c.account_id)
                    THEN ': Mahara''s business does not list the account'
                  WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_meta->'budgets'->'failing', '[]'::jsonb)) f
                               WHERE f->>'accountId' = c.account_id)
                    THEN ': the last read failed'
                  ELSE '' END), ' ' ORDER BY c.account_id) FILTER (WHERE s.account_id IS NULL),
         min(s.fetched_at),
         string_agg(format('Budgets for act_%s%s were last read %s Kuwait time.', c.account_id, coalesce(' (' || c.name || ')', ''),
             to_char(s.fetched_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI')), ' ' ORDER BY c.account_id)
           FILTER (WHERE s.fetched_at < public.cockpit_meta_ad_days_now() - interval '3 hours')
    INTO v_read_n, v_unread_n, v_unread, v_as_of, v_stale
  FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
  LEFT JOIN public.cockpit_meta_account_state s ON s.account_id = c.account_id;

  -- 1. The budget now.
  IF p_campaign IS NULL THEN
    SELECT count(*) FILTER (WHERE b.switched_on AND b.budget_type = 'daily')::int AS d_n,
           count(*) FILTER (WHERE b.switched_on AND b.budget_type = 'daily' AND b.budget_level = 'campaign')::int AS d_cbo,
           count(*) FILTER (WHERE b.switched_on AND b.budget_type = 'daily' AND b.budget_level = 'adset')::int AS d_abo,
           sum(b.daily_budget_usd) FILTER (WHERE b.switched_on AND b.budget_type = 'daily') AS d_usd,
           count(*) FILTER (WHERE b.switched_on AND b.budget_type = 'daily' AND b.daily_budget_usd IS NULL)::int AS d_unpriced,
           count(*) FILTER (WHERE b.switched_on AND b.budget_type = 'lifetime')::int AS l_n,
           count(*) FILTER (WHERE b.switched_on AND NOT b.delivering AND b.budget_type = 'daily')::int AS h_n,
           sum(b.daily_budget_usd) FILTER (WHERE b.switched_on AND NOT b.delivering AND b.budget_type = 'daily') AS h_usd,
           array_agg(DISTINCT b.why_not ORDER BY b.why_not)
             FILTER (WHERE b.switched_on AND NOT b.delivering AND b.budget_type = 'daily' AND b.why_not IS NOT NULL) AS h_whys,
           count(*) FILTER (WHERE b.starts_at IS NOT NULL)::int AS s_n,
           string_agg(DISTINCT b.why_not, '; ' ORDER BY b.why_not) FILTER (WHERE b.starts_at IS NOT NULL) AS s_why
      INTO n
    FROM public.cockpit_meta_budgets b
    WHERE b.level = 'campaign' AND b.account_id = ANY(v_accounts) AND b.campaign_id <> ALL (v_out_campaigns);

    -- The outsiders' campaigns switched on now: not in the sum, said instead, so a payment or a fixed
    -- account cannot let them spend unseen (2026-10-21: Liwan's two, $7,260 a day, on an unsettled account).
    SELECT count(*)::int AS o_n,
           count(*) FILTER (WHERE b.budget_type = 'daily' AND b.daily_budget_usd IS NOT NULL)::int AS o_priced,
           sum(b.daily_budget_usd) FILTER (WHERE b.budget_type = 'daily') AS o_usd
      INTO o
    FROM public.cockpit_meta_budgets b
    WHERE b.level = 'campaign' AND b.account_id = ANY(v_accounts) AND b.switched_on AND b.campaign_id = ANY (v_out_campaigns);
    v_outsiders := CASE WHEN o.o_n > 0 THEN format('%s on the compromise list %s switched on%s, not counted: switch %s off in Meta.',
        CASE WHEN o.o_n = 1 THEN '1 outsider''s campaign' ELSE o.o_n || ' outsiders'' campaigns' END,
        CASE WHEN o.o_n = 1 THEN 'is' ELSE 'are' END,
        CASE WHEN o.o_priced = 0 THEN ''
             WHEN o.o_priced < o.o_n THEN format(' at %s a day or more', public.cockpit_board_fmt(o.o_usd, 'usd'))
             ELSE format(' at %s a day', public.cockpit_board_fmt(o.o_usd, 'usd')) END,
        CASE WHEN o.o_n = 1 THEN 'it' ELSE 'them' END) END;

    -- The accounts that need action (one issue each, the account's status first): a payment (3, 8),
    -- a payment due in the grace period (9, still delivering: billing_due), an account that cannot run
    -- (2, 7, 100, 101, 201...), a spending limit reached or under a day of budget away, or on a prepaid
    -- account its balance used up or under a day away. A spending limit whose amount spent Meta did not
    -- give is not known: no issue, never $0 spent. These read the account as Meta runs it: an outsiders'
    -- campaign switched on spends the same limit and makes the account one in use.
    SELECT jsonb_agg(jsonb_build_object('accountId', c.account_id, 'name', c.name, 'issue', i.issue, 'words', i.words) ORDER BY c.account_id),
           string_agg(format('%s (%s).', i.words, coalesce(c.name, 'act_' || c.account_id)), ' ' ORDER BY c.account_id)
      INTO v_issues, v_issue_words
    FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
    JOIN public.cockpit_meta_account_state s ON s.account_id = c.account_id
    LEFT JOIN LATERAL (SELECT sum(b.daily_budget) AS daily FROM public.cockpit_meta_budgets b
                       WHERE b.account_id = c.account_id AND b.level = 'campaign' AND b.switched_on AND b.budget_type = 'daily') d ON true
    CROSS JOIN LATERAL (SELECT CASE WHEN s.spend_cap IS NOT NULL AND s.amount_spent IS NOT NULL
                                    THEN greatest(s.spend_cap - s.amount_spent, 0) END AS amt) l
    CROSS JOIN LATERAL (SELECT CASE
        WHEN s.account_status IN (3, 8) THEN 'billing'
        WHEN s.account_status = 9 THEN 'billing_due'
        WHEN s.account_status IS NOT NULL AND s.account_status <> 1 THEN 'account'
        WHEN l.amt IS NOT NULL AND l.amt <= 0 THEN CASE WHEN s.is_prepay THEN 'balance_out' ELSE 'limit_reached' END
        WHEN l.amt IS NOT NULL AND d.daily > 0 AND l.amt < d.daily THEN CASE WHEN s.is_prepay THEN 'balance_low' ELSE 'limit_near' END
      END AS issue) k
    CROSS JOIN LATERAL (SELECT k.issue, CASE k.issue
        WHEN 'billing' THEN public.cockpit_board_account_words(s.account_status)
        WHEN 'billing_due' THEN public.cockpit_board_account_words(s.account_status)
        WHEN 'account' THEN public.cockpit_board_account_words(s.account_status)
        WHEN 'limit_reached' THEN 'Spending limit reached'
        WHEN 'limit_near' THEN format('Spending limit nearly used: %s left, under a day of budget', public.cockpit_board_money(l.amt, s.currency))
        WHEN 'balance_out' THEN 'Prepaid balance used up: add funds'
        WHEN 'balance_low' THEN format('Prepaid balance: %s left, under a day of budget', public.cockpit_board_money(l.amt, s.currency))
      END AS words) i
    WHERE k.issue IS NOT NULL
      -- Only an account in use needs action: one with a campaign switched on now, or spend in these
      -- days. An old closed or unpaid account the client no longer runs stays quiet (2026-10-17: City
      -- Wood's and Castello's closed second accounts read "Account closed" on the board).
      AND (EXISTS (SELECT 1 FROM public.cockpit_meta_budgets b2
                   WHERE b2.account_id = c.account_id AND b2.level = 'campaign' AND b2.switched_on)
           OR EXISTS (SELECT 1 FROM public.cockpit_meta_ad_days m
                      WHERE m.account_id = c.account_id AND m.day BETWEEN p_from AND coalesce(v_win_to, p_to) AND m.spend > 0
                        AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xa WHERE xa.ad_id = m.ad_id)));

    -- Why the ones not delivering are not, each its own sentence (never after a second colon). An
    -- account's own words are left out here: v_issue_words says them once, with the account's name.
    SELECT array_agg(x ORDER BY x),
           string_agg(rtrim(btrim(x), '.') || '.', ' ' ORDER BY x)
      INTO v_why, v_why_words
    FROM unnest(n.h_whys) x
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_issues, '[]'::jsonb)) i WHERE i->>'words' = x);

    -- Every daily budget switched on in a currency with no fixed USD rate: not measured, never $0.
    v_all_unpriced := n.d_n > 0 AND n.d_usd IS NULL;
    IF v_all_unpriced THEN
      SELECT string_agg(public.cockpit_board_money(s.amt, s.currency), ' and ' ORDER BY s.currency) INTO v_local
      FROM (SELECT b.currency, sum(b.daily_budget) AS amt FROM public.cockpit_meta_budgets b
            WHERE b.level = 'campaign' AND b.account_id = ANY(v_accounts) AND b.switched_on AND b.budget_type = 'daily'
              AND b.campaign_id <> ALL (v_out_campaigns)
            GROUP BY b.currency) s;
    END IF;

    IF v_read_n = 0 THEN
      v_daily := public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_unread);
    ELSE
      v_daily := public.cockpit_board_cell(NULL, CASE WHEN NOT v_all_unpriced THEN round(coalesce(n.d_usd, 0), 2) END, p_targets,
        NULL, NULL, NULL, CASE WHEN v_all_unpriced THEN 'not_measured' END,
        concat_ws(' ',
          CASE WHEN n.d_n = 0 THEN 'No campaign is switched on with a daily budget now.'
               ELSE format('%s switched on now: %s.', CASE WHEN n.d_n = 1 THEN '1 campaign' ELSE n.d_n || ' campaigns' END,
                 concat_ws(', ', CASE WHEN n.d_cbo > 0 THEN n.d_cbo || ' on a campaign budget' END,
                                 CASE WHEN n.d_abo > 0 THEN n.d_abo || ' on ad set budgets' END)) END,
          CASE WHEN v_all_unpriced THEN format('%s %s a day, in a currency with no fixed USD rate.',
            CASE WHEN n.d_n = 1 THEN 'Its budget is' ELSE 'Their budgets add up to' END, v_local) END,
          CASE WHEN n.h_n > 0 THEN format('%s of them %s not delivering%s.',
            n.h_n, CASE WHEN n.h_n = 1 THEN 'is' ELSE 'are' END,
            CASE WHEN n.h_usd IS NOT NULL THEN format(' (%s a day)', public.cockpit_board_fmt(n.h_usd, 'usd')) ELSE '' END) END,
          CASE WHEN n.h_n > 0 THEN v_why_words END,
          CASE WHEN n.l_n > 0 THEN format('%s on a lifetime budget %s left out.',
            CASE WHEN n.l_n = 1 THEN '1 campaign' ELSE n.l_n || ' campaigns' END, CASE WHEN n.l_n = 1 THEN 'is' ELSE 'are' END) END,
          CASE WHEN n.s_n > 0 THEN format('%s waiting for %s start, not counted yet: %s.',
            CASE WHEN n.s_n = 1 THEN '1 campaign is' ELSE n.s_n || ' campaigns are' END, CASE WHEN n.s_n = 1 THEN 'its' ELSE 'their' END, n.s_why) END,
          CASE WHEN n.d_unpriced > 0 AND NOT v_all_unpriced THEN format('%s of them %s in a currency with no fixed USD rate, so this is at least the budget.',
            n.d_unpriced, CASE WHEN n.d_unpriced = 1 THEN 'is' ELSE 'are' END) END,
          CASE WHEN v_unread_n > 0 THEN v_unread || CASE WHEN v_all_unpriced THEN '' ELSE ' So this is at least the budget.' END END,
          v_outsiders,
          v_issue_words,
          v_stale,
          format('Read %s Kuwait time: the budget now, whatever the time frame.', to_char(v_as_of AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'))),
        jsonb_build_object('campaigns', n.d_n, 'lifetime', n.l_n, 'asOf', v_as_of, 'notDelivering', n.h_n)
          || CASE WHEN n.h_n > 0 THEN jsonb_build_object('heldBudget', round(n.h_usd, 2)) ELSE '{}'::jsonb END
          || CASE WHEN n.h_n > 0 AND v_why IS NOT NULL THEN jsonb_build_object('notDeliveringWhy', to_jsonb(v_why)) ELSE '{}'::jsonb END
          || CASE WHEN n.s_n > 0 THEN jsonb_build_object('starting', n.s_n) ELSE '{}'::jsonb END
          || CASE WHEN NOT v_all_unpriced AND (n.d_unpriced > 0 OR v_unread_n > 0) THEN jsonb_build_object('atLeast', true) ELSE '{}'::jsonb END
          || CASE WHEN v_issues IS NOT NULL THEN jsonb_build_object('accountIssues', v_issues) ELSE '{}'::jsonb END
          || CASE WHEN o.o_n > 0 THEN jsonb_build_object('outsiders', jsonb_build_object('campaigns', o.o_n)
               || CASE WHEN o.o_priced > 0 THEN jsonb_build_object('budget', round(o.o_usd, 2)) ELSE '{}'::jsonb END
               || CASE WHEN o.o_priced BETWEEN 1 AND o.o_n - 1 THEN jsonb_build_object('atLeast', true) ELSE '{}'::jsonb END)
             ELSE '{}'::jsonb END);
    END IF;
  ELSE
    SELECT * INTO cb FROM public.cockpit_meta_budgets b
    WHERE b.level = 'campaign' AND b.object_id = p_campaign AND b.account_id = ANY(v_accounts);
    v_daily := CASE
      WHEN cb.object_id IS NULL THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        CASE WHEN v_read_n = 0 THEN v_unread ELSE 'This campaign was not in the last budgets read.' END)
      WHEN cb.budget_type = 'lifetime' THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        'A lifetime budget: no daily figure.')
      WHEN cb.budget_type IS NULL THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        'No budget is set on the campaign or its ad sets switched on.')
      WHEN cb.daily_budget_usd IS NULL THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        format('%s a day, in a currency with no fixed USD rate.', public.cockpit_board_money(cb.daily_budget, cb.currency)))
      ELSE public.cockpit_board_cell(NULL, round(cb.daily_budget_usd, 2), p_targets, NULL, NULL, NULL, NULL,
        concat_ws(' ',
          CASE WHEN cb.budget_level = 'campaign' THEN 'The campaign''s own budget.' ELSE 'Its ad sets'' budgets, added up.' END,
          CASE WHEN cb.currency <> 'USD' THEN format('%s a day.', public.cockpit_board_money(cb.daily_budget, cb.currency)) END,
          CASE WHEN cb.starts_at IS NOT NULL THEN format('%s: not counted until then.', cb.why_not)
               WHEN NOT cb.delivering THEN format('Not delivering now (%s).', rtrim(btrim(cb.why_not), '.')) END,
          format('Read %s Kuwait time.', to_char(cb.fetched_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'))))
    END;
  END IF;

  -- 2. The campaign-days: those of the ad window, each before its account's
  -- own today, and each account's own yesterday, with the day's spend. A
  -- campaign-day counts when the campaign was switched on with a daily budget
  -- at any read (or moment, for the history) of the day, at the highest daily
  -- budget it was switched on with (2026-10-17: a campaign paused at noon
  -- keeps the budget it spent that morning against, CBO and ABO alike). A
  -- history day switched on whose budget the activity log cannot give (the
  -- day before a change whose old side is 0) is left out and said.
  WITH c AS (
    SELECT * FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
  ), bd AS (
    SELECT d.account_id, d.campaign_id, d.day, d.budget_type, d.max_switched_on_budget AS max_b, d.max_switched_on_budget_usd AS max_usd,
      d.changed_during_day, d.source, d.verified, c.tz, c.name AS account_name, d.day = c.today - 1 AS is_y,
      (v_ad_ok AND d.day BETWEEN p_from AND v_win_to AND d.day < c.today) AS in_win
    FROM public.cockpit_meta_budget_days d JOIN c ON c.account_id = d.account_id
    WHERE (p_campaign IS NULL OR d.campaign_id = p_campaign) AND d.campaign_id <> ALL (v_out_campaigns)
      AND d.switched_on_any AND (d.max_switched_on_budget IS NOT NULL OR d.budget_type = 'lifetime' OR d.source = 'activity')
      AND (d.day = c.today - 1 OR (v_ad_ok AND d.day BETWEEN p_from AND v_win_to AND d.day < c.today))
  ), pr AS (
    SELECT bd.*, coalesce(s.spend, 0) AS spend, s.unpriced,
      -- No ad-day rows: $0 only when the account's spend that day is known.
      (s.n > 0 OR public.cockpit_board_spend_known(bd.account_id, bd.day, bd.tz)) AS ad_read
    FROM bd
    CROSS JOIN LATERAL (SELECT count(*) AS n, sum(m.spend_usd) AS spend,
                          count(*) FILTER (WHERE m.spend IS NOT NULL AND m.spend_usd IS NULL) AS unpriced
                        FROM public.cockpit_meta_ad_days m
                        WHERE m.campaign_id = bd.campaign_id AND m.day = bd.day AND m.account_id = bd.account_id
                          AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xa WHERE xa.ad_id = m.ad_id)) s
  ), ok AS (
    SELECT pr.*, pr.max_b IS NOT NULL AS daily, (pr.max_b IS NULL AND pr.budget_type IS DISTINCT FROM 'lifetime') AS no_budget,
      (pr.max_usd IS NOT NULL AND pr.unpriced = 0 AND pr.ad_read) AS counted
    FROM pr
  )
  SELECT
    count(*) FILTER (WHERE ok.in_win AND ok.counted)::int AS n,
    sum(ok.spend) FILTER (WHERE ok.in_win AND ok.counted) AS num,
    sum(ok.max_usd) FILTER (WHERE ok.in_win AND ok.counted) AS den,
    count(DISTINCT ok.day) FILTER (WHERE ok.in_win AND ok.counted)::int AS days,
    count(*) FILTER (WHERE ok.in_win AND ok.daily AND NOT ok.ad_read)::int AS unread,
    string_agg(DISTINCT coalesce(ok.account_name, 'ad account ' || ok.account_id), ', ')
      FILTER (WHERE ok.in_win AND ok.daily AND NOT ok.ad_read) AS unread_names,
    count(*) FILTER (WHERE ok.in_win AND ok.daily AND ok.ad_read AND NOT ok.counted)::int AS unpriced,
    count(DISTINCT ok.campaign_id) FILTER (WHERE ok.in_win AND NOT ok.daily AND NOT ok.no_budget)::int AS lifetime,
    count(*) FILTER (WHERE ok.in_win AND ok.no_budget)::int AS no_budget,
    count(*) FILTER (WHERE ok.in_win AND ok.counted AND ok.changed_during_day)::int AS changed,
    count(*) FILTER (WHERE ok.in_win AND ok.counted AND ok.source = 'activity' AND NOT ok.verified)::int AS unverified,
    sum(ok.spend) FILTER (WHERE ok.is_y AND ok.counted) AS y_spend,
    sum(ok.max_usd) FILTER (WHERE ok.is_y AND ok.counted) AS y_budget,
    count(*) FILTER (WHERE ok.is_y AND ok.daily AND NOT ok.counted)::int AS y_left,
    count(DISTINCT ok.campaign_id) FILTER (WHERE ok.is_y AND ok.counted AND ok.spend = 0)::int AS y_zero
    INTO w
  FROM ok;

  -- The linked accounts that have been read (one never read is named apart, never a "0 of N days"), each
  -- with the first day its budgets are stored. A day is known when at least one of them had started by
  -- then and every one that had has that day; an account whose budgets start after the others' (added
  -- later, or its history not read) is said in its own sentence, never as "0 of N days".
  SELECT coalesce(jsonb_agg(jsonb_build_object('account_id', c.account_id, 'name', c.name, 'tz', c.tz, 'today', c.today,
           'first', f.first)), '[]'::jsonb)
    INTO v_reads
  FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
  LEFT JOIN LATERAL (SELECT min(x.day) AS first FROM public.cockpit_meta_budget_account_days x WHERE x.account_id = c.account_id) f ON true
  WHERE f.first IS NOT NULL OR EXISTS (SELECT 1 FROM public.cockpit_meta_account_state s WHERE s.account_id = c.account_id);
  WITH c AS (
    SELECT r.*, min(r.first) OVER () AS first_any
    FROM jsonb_to_recordset(v_reads) AS r(account_id text, name text, tz text, today date, first date)
  )
  SELECT count(*)::int, min(c.first),
         string_agg(format('%s keeps %s time, so %s is not over there yet', coalesce(c.name, 'ad account ' || c.account_id), c.tz,
           to_char(v_win_to, 'DD Mon')), '; ' ORDER BY c.account_id) FILTER (WHERE v_ad_ok AND v_win_to >= c.today),
         string_agg(format('Budgets for act_%s%s are known from %s.', c.account_id, coalesce(' (' || c.name || ')', ''),
           to_char(c.first, 'DD Mon YYYY')), ' ' ORDER BY c.account_id)
           FILTER (WHERE v_ad_ok AND c.first > c.first_any AND c.first > p_from)
    INTO v_hist_n, v_first, v_lag, v_late
  FROM c;
  IF v_ad_ok AND v_hist_n > 0 THEN
    SELECT count(*)::int INTO v_known
    FROM generate_series(0, v_win_to - p_from) g(i)
    WHERE EXISTS (SELECT 1 FROM jsonb_to_recordset(v_reads) AS c(account_id text, first date) WHERE c.first <= p_from + g.i)
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_to_recordset(v_reads) AS c(account_id text, today date, first date)
        WHERE c.first <= p_from + g.i
          AND NOT (p_from + g.i < c.today AND EXISTS (SELECT 1 FROM public.cockpit_meta_budget_account_days x
                                                      WHERE x.account_id = c.account_id AND x.day = p_from + g.i)));
    SELECT EXISTS (SELECT 1 FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
                   JOIN public.cockpit_meta_budget_account_days x ON x.account_id = c.account_id
                   WHERE x.day BETWEEN p_from AND v_win_to AND x.day < c.today)
      INTO v_any_read;
  ELSE
    v_any_read := false;
  END IF;

  -- Yesterday, on each account's own clock, whatever the time frame.
  SELECT count(x.account_id)::int, count(*)::int, min(c.today - 1), max(c.today - 1)
    INTO v_y_read, v_y_accounts, v_y_min, v_y_max
  FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
  LEFT JOIN public.cockpit_meta_budget_account_days x ON x.account_id = c.account_id AND x.day = c.today - 1;
  v_yesterday := CASE WHEN v_y_read > 0 THEN
      jsonb_build_object('day', v_y_max, 'spend', round(coalesce(w.y_spend, 0), 2), 'budget', round(coalesce(w.y_budget, 0), 2))
      || CASE WHEN v_y_min <> v_y_max THEN jsonb_build_object('days', jsonb_build_array(v_y_min, v_y_max)) ELSE '{}'::jsonb END
      || CASE WHEN v_y_read < v_y_accounts OR w.y_left > 0 THEN jsonb_build_object('partial', true) ELSE '{}'::jsonb END END;

  -- 3. Spend per day: the Spend cell over the ad days it covers (from the
  -- first day the Meta store holds, to the end of the ad window).
  IF NOT v_ad_ok THEN
    v_per_day := public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
      coalesce(p_cover->>'note', v_spend->>'note', 'No ad numbers are stored for these days.'));
  ELSE
    v_spend_days := v_win_to - coalesce((p_cover->>'pairFrom')::date, p_from) + 1;
    IF v_spend IS NULL THEN
      -- One campaign: its own spend in the ad window, each day before its account's own today.
      SELECT sum(m.spend_usd), count(*) FILTER (WHERE m.spend IS NOT NULL AND m.spend_usd IS NULL)::int INTO v_s, v_su
      FROM public.cockpit_meta_ad_days m
      JOIN jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date) ON c.account_id = m.account_id
      WHERE m.campaign_id = p_campaign AND m.day BETWEEN p_from AND v_win_to AND m.day < c.today
        AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xa WHERE xa.ad_id = m.ad_id);
      v_spend := jsonb_build_object('v', CASE WHEN v_s IS NOT NULL OR v_su = 0 THEN round(coalesce(v_s, 0), 2) END)
        || jsonb_strip_nulls(jsonb_build_object(
             'atLeast', CASE WHEN v_su > 0 OR coalesce((p_cover->>'partial')::boolean, false) THEN true END,
             'partial', CASE WHEN coalesce((p_cover->>'partial')::boolean, false) THEN true END,
             'note', nullif(concat_ws(' ', CASE WHEN v_su > 0 THEN 'Some spend is in a currency with no fixed USD rate, so this is at least the spend.' END,
               p_cover->>'note'), '')));
    END IF;
    v_s := (v_spend->>'v')::numeric;
    v_per_day := CASE
      WHEN v_s IS NULL OR v_spend_days < 1 THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        coalesce(v_spend->>'note', 'The spend is in a currency with no fixed USD rate.'))
      ELSE public.cockpit_board_cell(NULL, round(v_s / v_spend_days, 2), p_targets, NULL, round(v_s, 2), v_spend_days, NULL, v_spend->>'note',
        jsonb_strip_nulls(jsonb_build_object('atLeast', CASE WHEN v_spend->'atLeast' = 'true'::jsonb THEN true END,
          'partial', CASE WHEN v_spend->'partial' = 'true'::jsonb THEN true END))) END;
  END IF;

  -- 4. Budget used: spend / daily budgets over the campaign-days switched on with one.
  v_extra := jsonb_build_object('budgetDays', CASE WHEN v_any_read THEN w.days END, 'yesterday', v_yesterday,
    'notSpending', CASE WHEN v_y_read > 0 THEN w.y_zero END);
  IF NOT v_ad_ok THEN
    v_used := public.cockpit_board_cell('budget_used', NULL, p_targets, NULL, NULL, NULL, 'not_measured',
      coalesce(p_cover->>'note', 'No ad numbers are stored for these days.'), v_extra);
  ELSIF v_hist_n = 0 THEN
    v_used := public.cockpit_board_cell('budget_used', NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_unread, v_extra);
  ELSIF NOT v_any_read THEN
    v_used := public.cockpit_board_cell('budget_used', NULL, p_targets, NULL, NULL, NULL, 'not_measured',
      concat_ws(' ',
        CASE WHEN v_first IS NOT NULL AND v_win_to < v_first
               THEN format('Meta budgets are stored from %s; this time frame is before that.', to_char(v_first, 'DD Mon YYYY'))
             ELSE 'No budget was read on these days.' END,
        CASE WHEN v_unread_n > 0 THEN v_unread END), v_extra);
  ELSE
    v_pair := public.cockpit_board_paired(v_known, v_ad_days) - 'note';
    IF w.unread > 0 OR w.unpriced > 0 OR w.no_budget > 0 OR v_unread_n > 0 OR v_late IS NOT NULL THEN
      v_pair := v_pair || jsonb_build_object('partial', true);
    END IF;
    v_note := nullif(concat_ws(' ',
      CASE WHEN v_unread_n > 0 THEN v_unread END,
      CASE WHEN v_known < v_ad_days THEN concat_ws(' ',
        CASE WHEN v_known = 1 THEN format('Over the one day of %s whose budgets are known.', v_ad_days)
             ELSE format('Over the %s of %s days whose budgets are known.', v_known, v_ad_days) END,
        CASE WHEN p_from < v_first THEN format('Budgets are stored from %s.', to_char(v_first, 'DD Mon YYYY')) END,
        CASE WHEN v_lag IS NOT NULL THEN v_lag || '.' END) END,
      v_late,
      CASE WHEN w.unread > 0 THEN format('%s campaign-day%s with a daily budget %s left out: the spend of %s was not read those days.',
        w.unread, CASE WHEN w.unread = 1 THEN '' ELSE 's' END, CASE WHEN w.unread = 1 THEN 'is' ELSE 'are' END, w.unread_names) END,
      CASE WHEN w.unpriced > 0 THEN format('%s campaign-day%s in a currency with no fixed USD rate %s left out.',
        w.unpriced, CASE WHEN w.unpriced = 1 THEN '' ELSE 's' END, CASE WHEN w.unpriced = 1 THEN 'is' ELSE 'are' END) END,
      CASE WHEN w.no_budget > 0 THEN format('%s campaign-day%s switched on with a budget Meta''s activity log does not show %s left out.',
        w.no_budget, CASE WHEN w.no_budget = 1 THEN '' ELSE 's' END, CASE WHEN w.no_budget = 1 THEN 'is' ELSE 'are' END) END,
      CASE WHEN w.lifetime > 0 THEN format('%s on a lifetime budget %s left out.',
        CASE WHEN w.lifetime = 1 THEN '1 campaign' ELSE w.lifetime || ' campaigns' END, CASE WHEN w.lifetime = 1 THEN 'is' ELSE 'are' END) END,
      CASE WHEN w.changed > 0 THEN format('A budget changed during %s of these campaign-days; each day counts the highest budget it was switched on with.',
        w.changed) END,
      CASE WHEN w.unverified > 0 THEN format('%s of these campaign-days %s rebuilt from Meta''s activity log without reaching the live budget, so %s budget is not checked.',
        w.unverified, CASE WHEN w.unverified = 1 THEN 'was' ELSE 'were' END, CASE WHEN w.unverified = 1 THEN 'its' ELSE 'their' END) END), '');
    IF coalesce(w.den, 0) = 0 THEN
      v_used := CASE
        WHEN p_campaign IS NOT NULL AND cb.budget_type = 'lifetime' THEN public.cockpit_board_cell('budget_used', NULL, p_targets, NULL,
          NULL, NULL, 'not_measured', 'A lifetime budget: no daily figure.', v_extra || v_pair)
        WHEN w.unread > 0 OR w.unpriced > 0 OR w.no_budget > 0
        THEN public.cockpit_board_cell('budget_used', NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_note, v_extra || v_pair)
        ELSE public.cockpit_board_cell('budget_used', NULL, p_targets, 0, 0, 0, 'too_few',
          concat_ws(' ', 'No campaign was switched on with a daily budget in these days.', v_note), v_extra || v_pair) END;
    ELSE
      v_x := round(w.num / w.den * 100, 2);
      v_used := public.cockpit_board_cell('budget_used', v_x, p_targets, w.days, round(w.num, 2), round(w.den, 2), NULL,
        nullif(concat_ws(' ', v_note, CASE WHEN v_x > 110 THEN
          'Above its daily budgets: Meta may spend up to 75% over a daily budget on one day, and at most 7 times it in a week.' END), ''),
        v_extra || v_pair || CASE WHEN v_x > 110 THEN jsonb_build_object('over', true) ELSE '{}'::jsonb END);
    END IF;
  END IF;

  -- 5. One campaign's own yesterday, for its page.
  IF p_campaign IS NOT NULL THEN
    SELECT sum(m.spend_usd), count(*) FILTER (WHERE m.spend IS NOT NULL AND m.spend_usd IS NULL)::int INTO v_ys, v_ys_unpriced
    FROM public.cockpit_meta_ad_days m
    JOIN jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date) ON c.account_id = m.account_id
    WHERE m.campaign_id = p_campaign AND m.day = c.today - 1
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xa WHERE xa.ad_id = m.ad_id);
    SELECT bool_and(public.cockpit_board_spend_known(c.account_id, c.today - 1, c.tz))
      INTO v_ys_read
    FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date);
    -- Switched on with a daily budget yesterday and nothing spent: since when, back to its last spend.
    IF w.y_zero > 0 THEN
      SELECT min(d.day) INTO v_zero FROM public.cockpit_meta_budget_days d
      WHERE d.campaign_id = p_campaign AND d.switched_on_any AND d.max_switched_on_budget IS NOT NULL AND d.day <= v_y_max
        AND d.day > coalesce((SELECT max(m.day) FROM public.cockpit_meta_ad_days m
                              WHERE m.campaign_id = p_campaign AND m.spend > 0 AND m.day <= v_y_max
                                AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xa WHERE xa.ad_id = m.ad_id)), '-infinity'::date);
    END IF;
    v_spent_y := CASE
      WHEN NOT coalesce(v_ys_read, false) THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        format('The spend for %s has not been read yet.', to_char(v_y_max, 'DD Mon')))
      WHEN v_ys IS NULL AND v_ys_unpriced > 0 THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        'The spend is in a currency with no fixed USD rate.')
      ELSE public.cockpit_board_cell(NULL, round(coalesce(v_ys, 0), 2), p_targets, NULL, NULL, NULL, NULL,
        format('Spend on %s, the ad account''s own yesterday.', to_char(v_y_max, 'DD Mon')),
        CASE WHEN v_zero IS NOT NULL THEN jsonb_build_object('zeroSince', v_zero) END) END;
    v_used_y := CASE
      WHEN cb.budget_type = 'lifetime' THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        'A lifetime budget: no daily figure.')
      WHEN v_y_read = 0 THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        'Yesterday''s budget was not read.')
      WHEN coalesce(w.y_budget, 0) = 0 THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        CASE WHEN w.y_left > 0 THEN 'Yesterday''s spend is not known yet, or not in US dollars.'
             ELSE 'Not switched on with a daily budget yesterday.' END)
      ELSE public.cockpit_board_cell(NULL, round(w.y_spend / w.y_budget * 100, 2), p_targets, NULL, round(w.y_spend, 2),
        round(w.y_budget, 2), NULL,
        'Yesterday''s spend / yesterday''s daily budget. One day is not judged: Meta may spend up to 75% over a daily budget on a day.') END;
  END IF;

  RETURN jsonb_build_object('dailyBudget', v_daily, 'spendPerDay', v_per_day, 'budgetUsed', v_used,
    'spentYesterday', v_spent_y, 'usedYesterday', v_used_y);
END $$;

-- ---------------------------------------------------------------------------
-- 5. The client page's budget list: the same, an outsiders' campaign switched on kept as a flagged row with
-- no figures (as 20261017100100 left it).

CREATE OR REPLACE FUNCTION public.cockpit_board_budget_list(p_accounts text[], p_from date, p_to date, p_cover jsonb,
  p_meta jsonb, p_targets jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_accounts text[] := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_accounts, '{}'::text[])) x WHERE x IS NOT NULL);
  v_ad_ok boolean := coalesce(p_cover->>'state' IN ('full', 'partial'), false);
  v_win_to date := (p_cover->>'winTo')::date;
  v_clocks jsonb;
  v_as_of timestamptz;
  v_why_all boolean;
  v_unlisted boolean;
  v_account jsonb;
  v_campaigns jsonb;
  v_paused jsonb;
  -- The outsiders' own campaigns on these accounts (2026-10-21): named on cockpit_excluded_ads, with
  -- no ad stored that the list does not name. Their budgets are never the client's, so they leave the
  -- sums with their spend, and are said instead. Campaign ids, unique in Meta as ad ids are.
  v_out_campaigns text[] := ARRAY(
    SELECT DISTINCT xa.campaign_id
    FROM public.cockpit_excluded_ads xa
    WHERE xa.campaign_id IS NOT NULL AND regexp_replace(xa.account_id, '^act_', '') = ANY(v_accounts)
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_meta_ad_days m
                      WHERE m.campaign_id = xa.campaign_id
                        AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xb WHERE xb.ad_id = m.ad_id)));
BEGIN
  IF cardinality(v_accounts) = 0 THEN
    RETURN jsonb_build_object('asOf', NULL, 'note', 'No Meta ad account is linked to this client.', 'account', '[]'::jsonb,
      'campaigns', '[]'::jsonb, 'paused', jsonb_build_object('campaigns', 0, 'spend', NULL));
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_clocks FROM public.cockpit_board_budget_clocks(v_accounts, p_meta) c;

  SELECT min(s.fetched_at), jsonb_agg(jsonb_build_object(
      'accountId', c.account_id, 'name', c.name, 'currency', coalesce(s.currency, j.currency),
      'status', CASE WHEN s.account_id IS NULL THEN 'Budgets not read yet' ELSE public.cockpit_board_account_words(s.account_status) END,
      'prepaid', s.is_prepay,
      'asOf', s.fetched_at,
      'spendingLimit', CASE WHEN s.spend_cap IS NOT NULL THEN jsonb_build_object(
          'cap', s.spend_cap, 'spent', s.amount_spent, 'left', l.amt,
          'daysLeft', CASE WHEN d.daily > 0 AND l.amt IS NOT NULL THEN round(l.amt / d.daily, 1) END,
          'prepaid', coalesce(s.is_prepay, false)) END,
      'words', nullif(concat_ws(' ',
          CASE WHEN s.account_id IS NULL THEN format('Budgets for act_%s have not been read%s.', c.account_id, coalesce(u.why, ''))
               ELSE public.cockpit_board_account_words(s.account_status) || '.' END,
          CASE
            WHEN s.account_id IS NULL THEN NULL
            WHEN s.is_prepay AND s.spend_cap IS NULL THEN 'Prepaid account: Meta did not give its balance.'
            WHEN s.spend_cap IS NULL THEN NULL
            WHEN l.amt IS NULL THEN CASE WHEN s.is_prepay
                 THEN format('Prepaid funds of %s; Meta did not say how much is spent, so the balance is not known.', public.cockpit_board_money(s.spend_cap, s.currency))
                 ELSE format('Spending limit of %s; Meta did not say how much of it is spent.', public.cockpit_board_money(s.spend_cap, s.currency)) END
            WHEN l.amt <= 0 THEN CASE WHEN s.is_prepay THEN 'Prepaid balance used up: add funds.' ELSE 'Spending limit reached.' END
            ELSE format('%s: %s left%s.', CASE WHEN s.is_prepay THEN 'Prepaid balance' ELSE 'Spending limit' END,
                   public.cockpit_board_money(l.amt, s.currency),
                   CASE WHEN coalesce(d.daily, 0) <= 0 THEN ''
                        WHEN l.amt < d.daily THEN ' (under a day of budget)'
                        WHEN round(l.amt / d.daily, 1) = 1 THEN ' (about 1 day of budget)'
                        ELSE format(' (about %s days of budget)', to_char(round(l.amt / d.daily, 1), 'FM999,990.9')) END) END), ''))
      ORDER BY c.account_id),
      bool_and(u.why IS NOT NULL) FILTER (WHERE s.account_id IS NULL),
      coalesce(bool_or(u.why LIKE '%does not list%'), false)
    INTO v_as_of, v_account, v_why_all, v_unlisted
  FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
  LEFT JOIN public.cockpit_meta_account_state s ON s.account_id = c.account_id
  -- Why an account was never read, when the last run knows (as cockpit_board_budget_cells says it).
  CROSS JOIN LATERAL (SELECT CASE
      WHEN s.account_id IS NOT NULL THEN NULL
      WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_meta->'budgets'->'unlisted', '[]'::jsonb)) x
                   WHERE coalesce(x->>'accountId', x #>> '{}') = c.account_id)
        THEN ': Mahara''s business does not list the account'
      WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_meta->'budgets'->'failing', '[]'::jsonb)) x
                   WHERE x->>'accountId' = c.account_id)
        THEN ': the last read failed'
    END AS why) u
  LEFT JOIN LATERAL (SELECT e->>'currency' AS currency FROM jsonb_array_elements(coalesce(p_meta->'accounts', '[]'::jsonb)) e
                     WHERE e->>'accountId' = c.account_id LIMIT 1) j ON true
  -- The days of budget left count every campaign switched on, an outsiders' too: Meta spends the
  -- limit on all of them.
  LEFT JOIN LATERAL (SELECT sum(b.daily_budget) AS daily FROM public.cockpit_meta_budgets b
                     WHERE b.account_id = c.account_id AND b.level = 'campaign' AND b.switched_on AND b.budget_type = 'daily') d ON true
  CROSS JOIN LATERAL (SELECT CASE WHEN s.spend_cap IS NOT NULL AND s.amount_spent IS NOT NULL
                                  THEN greatest(s.spend_cap - s.amount_spent, 0) END AS amt) l;

  WITH c AS (
    SELECT * FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
  ), spent AS (
    -- The campaigns that spent in the ad window, each day before its account's own today.
    SELECT m.campaign_id, max(m.account_id) AS account_id, max(m.campaign_name) AS name
    FROM public.cockpit_meta_ad_days m JOIN c ON c.account_id = m.account_id
    WHERE v_ad_ok AND m.day BETWEEN p_from AND v_win_to AND m.day < c.today
      -- Never an ad on the compromise list (cockpit_excluded_ads), matched on the ad id alone.
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xa WHERE xa.ad_id = m.ad_id)
    GROUP BY m.campaign_id
    HAVING sum(m.spend) > 0
  ), rows AS (
    -- An outsiders' campaign stays in the list, flagged, with no figures: it is not the client's, and
    -- it has to be switched off in Meta.
    SELECT b.object_id AS id, b.name, b.account_id, b.budget_level, b.budget_type, b.delivering, b.why_not, b.daily_budget_usd,
      b.lifetime_budget, b.budget_remaining, b.end_time, b.starts_at, b.currency, c.tz, c.today,
      (SELECT count(*) FROM public.cockpit_meta_budgets x WHERE x.level = 'adset' AND x.campaign_id = b.object_id AND x.switched_on)::int AS adsets,
      b.daily_budget, b.campaign_id = ANY (v_out_campaigns) AS outsider
    FROM public.cockpit_meta_budgets b JOIN c ON c.account_id = b.account_id
    WHERE b.level = 'campaign' AND (b.switched_on OR b.starts_at IS NOT NULL)
    UNION ALL
    -- Spent in these days on an account whose budgets were never read: its budget is not known.
    SELECT sp.campaign_id, sp.name, sp.account_id, NULL, NULL, NULL, 'Budget not read yet', NULL, NULL, NULL, NULL, NULL, NULL, c.tz, c.today, NULL,
      NULL, false
    FROM spent sp JOIN c ON c.account_id = sp.account_id
    WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_meta_account_state s WHERE s.account_id = sp.account_id)
  ), cells AS (
    SELECT r.*, CASE WHEN NOT r.outsider
                     THEN public.cockpit_board_budget_cells(ARRAY[r.account_id], r.id, p_from, p_to, p_cover, p_meta, p_targets, NULL) END AS m
    FROM rows r
  ), flagged AS (
    SELECT x.*, CASE
        WHEN x.outsider THEN jsonb_build_object('status', 'off', 'words',
          format('An outsider''s campaign on the compromise list%s, not counted. Switch it off in Meta.',
            CASE WHEN x.daily_budget_usd IS NOT NULL THEN format(' (%s a day)', public.cockpit_board_fmt(x.daily_budget_usd, 'usd'))
                 WHEN x.budget_type = 'daily' AND x.daily_budget IS NOT NULL
                   THEN format(' (%s a day)', public.cockpit_board_money(x.daily_budget, x.currency))
                 WHEN x.budget_type = 'lifetime' THEN ' (a lifetime budget)'
                 ELSE '' END))
        -- Waiting for its start: said, never a problem.
        WHEN x.starts_at IS NOT NULL THEN jsonb_build_object('status', NULL, 'words', x.why_not)
        WHEN x.delivering IS FALSE THEN jsonb_build_object('status', 'off', 'words', x.why_not)
        WHEN x.delivering IS NULL THEN NULL
        WHEN x.m->'spentYesterday'->>'zeroSince' IS NOT NULL THEN jsonb_build_object('status', 'off', 'words',
          CASE WHEN (x.m->'spentYesterday'->>'zeroSince')::date >= x.today - 1 THEN 'Spent nothing yesterday'
               ELSE 'Spent nothing since ' || to_char((x.m->'spentYesterday'->>'zeroSince')::date, 'FMDD Mon') END)
        WHEN x.m->'budgetUsed'->>'status' IN ('off', 'watch') THEN
          jsonb_build_object('status', x.m->'budgetUsed'->>'status', 'words', 'Under its budget in these days')
      END AS flag
    FROM cells x
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'name', f.name, 'accountId', f.account_id, 'budgetLevel', f.budget_level, 'budgetType', f.budget_type,
      'adsets', f.adsets, 'delivering', f.delivering, 'whyNot', f.why_not, 'startsAt', f.starts_at,
      -- Never for an outsiders' campaign: its figures are not the client's.
      'lifetime', CASE WHEN f.budget_type = 'lifetime' AND NOT f.outsider THEN jsonb_build_object(
          'budget', round(f.lifetime_budget * public.cockpit_meta_ad_days_usd_per(f.currency), 2),
          'remaining', round(f.budget_remaining * public.cockpit_meta_ad_days_usd_per(f.currency), 2),
          'currency', f.currency,
          'endsOn', public.cockpit_meta_budget_day(f.end_time - interval '1 millisecond', f.tz)) END,
      'flag', f.flag,
      'metrics', CASE WHEN f.outsider THEN '{}'::jsonb
        ELSE jsonb_build_object('dailyBudget', f.m->'dailyBudget', 'spentYesterday', f.m->'spentYesterday',
          'usedYesterday', f.m->'usedYesterday', 'spendPerDay', f.m->'spendPerDay', 'budgetUsed', f.m->'budgetUsed') END)
      || CASE WHEN f.outsider THEN jsonb_build_object('outsider', true) ELSE '{}'::jsonb END
      ORDER BY (f.flag->>'status' IS NOT NULL) DESC, (f.starts_at IS NOT NULL), f.daily_budget_usd DESC NULLS LAST, f.name, f.id), '[]'::jsonb)
    INTO v_campaigns
  FROM flagged f;

  WITH c AS (
    SELECT * FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
  ), spent AS (
    SELECT m.campaign_id, max(m.account_id) AS account_id, sum(m.spend_usd) AS spend
    FROM public.cockpit_meta_ad_days m JOIN c ON c.account_id = m.account_id
    WHERE v_ad_ok AND m.day BETWEEN p_from AND v_win_to AND m.day < c.today
      -- Never an ad on the compromise list (cockpit_excluded_ads), matched on the ad id alone.
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xa WHERE xa.ad_id = m.ad_id)
    GROUP BY m.campaign_id
    HAVING sum(m.spend) > 0
  )
  SELECT CASE WHEN v_ad_ok THEN jsonb_build_object('campaigns', count(*), 'spend', round(coalesce(sum(sp.spend), 0), 2))
              ELSE jsonb_build_object('campaigns', NULL, 'spend', NULL) END
    INTO v_paused
  FROM spent sp
  WHERE EXISTS (SELECT 1 FROM public.cockpit_meta_account_state s WHERE s.account_id = sp.account_id)
    AND NOT EXISTS (SELECT 1 FROM public.cockpit_meta_budgets b WHERE b.level = 'campaign' AND b.object_id = sp.campaign_id
                    AND (b.switched_on OR b.starts_at IS NOT NULL));

  RETURN jsonb_build_object(
    'asOf', v_as_of,
    'note', concat_ws(' ',
      -- Read every hour, unless the last run knows why it was not (the account's words say why).
      CASE WHEN v_as_of IS NULL AND coalesce(v_why_all, false) THEN concat_ws(' ', 'Meta budgets have not been read for the linked ad account.',
             CASE WHEN v_unlisted THEN 'Ask the client to share the ad account with Mahara''s business in Meta; it is read every hour after that.' END)
           WHEN v_as_of IS NULL THEN 'Meta budgets have not been read for the linked ad account yet; they are read every hour.'
           ELSE format('Budgets as Meta had them at %s Kuwait time; spend runs to yesterday on each ad account''s own clock.',
             to_char(v_as_of AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI')) END,
      'One day is not judged: Meta may spend up to 75% over a daily budget on a day, and at most 7 times it in a week.'),
    'account', coalesce(v_account, '[]'::jsonb),
    'campaigns', v_campaigns,
    'paused', v_paused);
END $$;

-- ---------------------------------------------------------------------------
-- 6. The pay facts' ads: each client's spend, Meta leads and creative start (as 20261018b left it).

CREATE OR REPLACE FUNCTION public.cockpit_pay_facts_ads(p_from date, p_to date, p_exclude_days integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_through date;
  v_days integer;
  v_ex integer := coalesce(p_exclude_days, 0);
  v_out jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'Choose a range of up to 93 days.' USING ERRCODE = '22023';
  END IF;
  IF v_ex < 0 OR v_ex > 90 THEN
    RAISE EXCEPTION 'Days left out after a creative starts are 0 to 90.' USING ERRCODE = '22023';
  END IF;
  v_through := least(p_to, v_today - 1);
  v_days := greatest(0, v_through - p_from + 1);

  WITH snap AS (
    SELECT x.d, c.value->>'key' AS k, c.value->>'name' AS n, c.value->>'status' AS st
      FROM public.cockpit_csm_sources AS s
      CROSS JOIN LATERAL (SELECT CASE WHEN s.data->>'day' ~ '^\d{4}-\d{2}-\d{2}$' THEN (s.data->>'day')::date END AS d) AS x
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.data->'clients') = 'array' THEN s.data->'clients' ELSE '[]'::jsonb END) AS c(value)
     WHERE s.table_name = 'rosterDays' AND x.d BETWEEN p_from AND p_to AND nullif(c.value->>'key', '') IS NOT NULL
  ), act AS (
    SELECT k, count(DISTINCT d) FILTER (WHERE st = 'Active') AS active_days, (array_agg(n ORDER BY d DESC))[1] AS roster_name
      FROM snap GROUP BY k HAVING count(*) FILTER (WHERE st = 'Active') > 0
  ), card AS (
    SELECT DISTINCT ON (s.data->>'taskId') s.data->>'taskId' AS k, x.launch
      FROM public.cockpit_csm_sources AS s
      CROSS JOIN LATERAL (SELECT CASE WHEN s.data->>'launchDate' ~ '^\d{4}-\d{2}-\d{2}' THEN left(s.data->>'launchDate', 10)::date END AS launch) AS x
     WHERE s.table_name = 'clients' AND nullif(s.data->>'taskId', '') IS NOT NULL
     ORDER BY s.data->>'taskId', s.source_snapshot_at DESC NULLS LAST
  ), cs AS (
    SELECT a.k, a.active_days, a.roster_name, b.location_id, b.client_name, b.service_mode, b.tiktok,
           coalesce(b.ad_account_ids, '{}'::text[]) AS ad_account_ids, card.launch,
           coalesce(card.launch, (SELECT min(m.day) FROM public.cockpit_meta_ad_days AS m
                                   WHERE m.account_id = ANY (b.ad_account_ids) AND m.spend > 0 AND m.leads IS NOT NULL
                                     AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads AS xa WHERE xa.ad_id = m.ad_id))) AS creative_start
      FROM act AS a
      LEFT JOIN public.cockpit_board_clients AS b ON b.clickup_id = a.k
      LEFT JOIN card ON card.k = a.k
  ), meta AS (
    SELECT cs.k, cs.location_id, count(*) AS row_count,
           sum(m.spend_usd) AS spend,
           sum(m.spend_usd) FILTER (WHERE m.leads IS NOT NULL) AS lead_spend,
           sum(m.leads) AS leads,
           count(*) FILTER (WHERE m.leads IS NOT NULL) AS lead_rows,
           count(*) FILTER (WHERE m.spend > 0 AND m.spend_usd IS NULL) AS unpriced,
           sum(m.spend_usd) FILTER (WHERE cs.creative_start IS NULL OR m.day >= cs.creative_start + v_ex) AS spend_x,
           sum(m.spend_usd) FILTER (WHERE m.leads IS NOT NULL AND (cs.creative_start IS NULL OR m.day >= cs.creative_start + v_ex)) AS lead_spend_x,
           sum(m.leads) FILTER (WHERE cs.creative_start IS NULL OR m.day >= cs.creative_start + v_ex) AS leads_x
      FROM cs JOIN public.cockpit_meta_ad_days AS m ON m.account_id = ANY (cs.ad_account_ids)
     WHERE m.day BETWEEN p_from AND p_to
       AND m.day < (now() AT TIME ZONE coalesce(m.account_timezone, 'Asia/Kuwait'))::date
       -- Never an ad on the compromise list (cockpit_excluded_ads), matched on the ad id alone.
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads AS xa WHERE xa.ad_id = m.ad_id)
     GROUP BY cs.k, cs.location_id
  ), biz AS (
    SELECT cs.k, cs.location_id, sum(d.confirmed_bookings) AS bookings, count(d.confirmed_bookings) AS stored_days,
           sum(d.confirmed_bookings) FILTER (WHERE cs.creative_start IS NULL OR d.day >= cs.creative_start + v_ex) AS bookings_x
      FROM cs JOIN public.cockpit_client_days AS d ON d.location_id = cs.location_id
     WHERE d.day BETWEEN p_from AND v_through
     GROUP BY cs.k, cs.location_id
  ), rowsj AS (
    SELECT cs.*, m.row_count, m.spend, m.lead_spend, m.leads, m.lead_rows, coalesce(m.unpriced, 0) AS unpriced,
           m.spend_x, m.lead_spend_x, m.leads_x, b.bookings, b.bookings_x,
           greatest(v_days - coalesce(b.stored_days, 0), 0) AS null_days,
           CASE
             WHEN cs.location_id IS NULL THEN 'No board row for this card.'
             WHEN v_days = 0 THEN 'No finished day in this range yet.'
             WHEN cardinality(cs.ad_account_ids) = 0 THEN 'No ad account is linked to this client.'
             WHEN coalesce(m.unpriced, 0) > 0 THEN format('%s spend rows have no USD price.', m.unpriced)
             WHEN coalesce(m.lead_rows, 0) = 0 THEN 'No lead-form campaign ran in this range.'
           END AS out_cpl,
           CASE
             WHEN cs.location_id IS NULL THEN 'No board row for this card.'
             WHEN upper(coalesce(cs.service_mode, '')) = 'DWY' THEN 'Done with you: the client books its own meetings.'
             WHEN v_days = 0 THEN 'No finished day in this range yet.'
             WHEN cardinality(cs.ad_account_ids) = 0 THEN 'No ad account is linked to this client.'
             WHEN coalesce(m.unpriced, 0) > 0 THEN format('%s spend rows have no USD price.', m.unpriced)
             WHEN coalesce(m.row_count, 0) = 0 THEN 'No Meta spend was recorded in this range.'
             WHEN v_days - coalesce(b.stored_days, 0) > 0
               THEN format('Bookings are not stored for %s of the %s days.', v_days - coalesce(b.stored_days, 0), v_days)
           END AS out_cpb,
           -- spend is measured: a linked account with rows and no unpriced row
           (cs.location_id IS NOT NULL AND v_days > 0 AND cardinality(cs.ad_account_ids) > 0
             AND coalesce(m.row_count, 0) > 0 AND coalesce(m.unpriced, 0) = 0) AS spend_measured
      FROM cs
      LEFT JOIN meta AS m ON m.k = cs.k AND m.location_id IS NOT DISTINCT FROM cs.location_id
      LEFT JOIN biz AS b ON b.k = cs.k AND b.location_id IS NOT DISTINCT FROM cs.location_id
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to, 'adThrough', CASE WHEN v_days > 0 THEN v_through END, 'excludeDays', v_ex,
    'clients', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'clickupId', r.k, 'locationId', r.location_id, 'name', coalesce(r.client_name, r.roster_name, r.k),
               'serviceMode', r.service_mode, 'tiktok', r.tiktok, 'activeDays', r.active_days,
               'launchDate', r.launch, 'creativeStart', r.creative_start,
               'spendUsd', round(r.spend, 2), 'leadSpendUsd', round(r.lead_spend, 2),
               'nonLeadSpendUsd', round(r.spend - coalesce(r.lead_spend, 0), 2),
               'leads', r.leads, 'bookings', r.bookings,
               'cpl', CASE WHEN r.out_cpl IS NULL AND r.leads > 0 THEN round(r.lead_spend / r.leads, 2) END,
               'cpb', CASE WHEN r.out_cpb IS NULL AND r.bookings > 0 THEN round(r.spend / r.bookings, 2) END,
               'unpricedRows', r.unpriced, 'nullBookingDays', CASE WHEN r.location_id IS NOT NULL THEN r.null_days END,
               'after', jsonb_build_object('from', CASE WHEN r.creative_start IS NOT NULL THEN r.creative_start + v_ex END,
                                           'spendUsd', round(r.spend_x, 2), 'leadSpendUsd', round(r.lead_spend_x, 2),
                                           'leads', r.leads_x, 'bookings', r.bookings_x),
               'notMeasured', jsonb_build_object('cpl', r.out_cpl, 'cpb', r.out_cpb))
             ORDER BY r.spend DESC NULLS LAST, coalesce(r.client_name, r.roster_name, r.k))
        FROM rowsj AS r), '[]'::jsonb),
    'pooled', (
      SELECT jsonb_build_object(
               'clients', count(*) FILTER (WHERE r.out_cpl IS NULL),
               'leadSpendUsd', round(sum(r.lead_spend) FILTER (WHERE r.out_cpl IS NULL), 2),
               'leads', sum(r.leads) FILTER (WHERE r.out_cpl IS NULL),
               'cpl', CASE WHEN sum(r.leads) FILTER (WHERE r.out_cpl IS NULL) > 0
                           THEN round(sum(r.lead_spend) FILTER (WHERE r.out_cpl IS NULL) / sum(r.leads) FILTER (WHERE r.out_cpl IS NULL), 2) END,
               'nonLeadSpendUsd', round(sum(r.spend - coalesce(r.lead_spend, 0)) FILTER (WHERE r.spend_measured), 2),
               'spendUsd', round(sum(r.spend) FILTER (WHERE r.out_cpb IS NULL), 2),
               'bookings', sum(r.bookings) FILTER (WHERE r.out_cpb IS NULL),
               'cpb', CASE WHEN sum(r.bookings) FILTER (WHERE r.out_cpb IS NULL) > 0
                           THEN round(sum(r.spend) FILTER (WHERE r.out_cpb IS NULL) / sum(r.bookings) FILTER (WHERE r.out_cpb IS NULL), 2) END,
               'cpbClients', count(*) FILTER (WHERE r.out_cpb IS NULL),
               'outOfCpl', coalesce(jsonb_agg(jsonb_build_object('clickupId', r.k, 'name', coalesce(r.client_name, r.roster_name, r.k), 'why', r.out_cpl)
                                              ORDER BY coalesce(r.client_name, r.roster_name, r.k)) FILTER (WHERE r.out_cpl IS NOT NULL), '[]'::jsonb),
               'outOfCpb', coalesce(jsonb_agg(jsonb_build_object('clickupId', r.k, 'name', coalesce(r.client_name, r.roster_name, r.k), 'why', r.out_cpb)
                                              ORDER BY coalesce(r.client_name, r.roster_name, r.k)) FILTER (WHERE r.out_cpb IS NOT NULL), '[]'::jsonb))
        FROM rowsj AS r),
    'note', to_jsonb(array_remove(ARRAY[
      'Clients: the cards Active on at least one roster snapshot in the range.',
      'Spend and Meta form leads to yesterday on each ad account''s clock; confirmed main and online bookings to Kuwait yesterday.',
      'Cost per lead is lead-campaign spend / Meta form leads; cost per booking is all spend / confirmed bookings; both pooled as ratios of sums.',
      'Non-lead spend is pooled over every client whose spend is measured.',
      'A client left out of a pool is named with why, never counted as 0.',
      CASE WHEN EXISTS (SELECT 1 FROM rowsj AS r WHERE r.tiktok) THEN 'TikTok spend is not counted: figures are Meta only.' END,
      CASE WHEN v_ex > 0 THEN format('"after" counts from each client''s creative start (the card''s launch date, else its first lead-campaign spend day) plus %s days.', v_ex) END], NULL))
  ) INTO v_out;

  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Privileges, as live on 2026-10-21: the board's read for authenticated (its own gate inside), the
-- rest for nobody (the definer reads call them as the owner).

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['cockpit_board_rows(date,date,text,jsonb)', 'cockpit_board_read(date,date)',
    'cockpit_board_tree(text,text[],date,date,jsonb,jsonb,jsonb)',
    'cockpit_board_budget_cells(text[],text,date,date,jsonb,jsonb,jsonb,jsonb)',
    'cockpit_board_budget_list(text[],date,date,jsonb,jsonb,jsonb)', 'cockpit_pay_facts_ads(date,date,integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_board_read(date,date) TO authenticated';
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
