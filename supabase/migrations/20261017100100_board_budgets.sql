-- Client Performance board: daily budgets and the share spent (2026-10-17,
-- Creative Triage bldgtotkfmhoxmlzowdx).
--
-- The CEO, 2026-10-17: "the daily budget of all the campaigns in the account
-- and then how much is actually being spent. Sometimes the campaign isnt
-- spending as much as the budget, or its not spending enough." The budgets
-- are stored by 20261017100000_meta_budgets.sql (meta-ad-days: every hour,
-- and the activity log for the days before). This file puts them on the board:
--
--   cockpit_board_default_targets  + budget_used ("Budget used"): good at 90%
--                                  and above, watch to 70%, judged from 3 days
--                                  with a budget, set 2026-10-17 as a starting
--                                  aim. 20 targets; it sits before CPM.
--   cockpit_board_budget_cells     (new, internal) the three Ads cells of a
--                                  client, or of one campaign for its page:
--       dailyBudget   the daily budgets of the campaigns delivering now on the
--                     linked accounts, USD (CBO the campaign's, ABO its
--                     delivering ad sets'); the budget now, whatever the time
--                     frame; not judged
--       spendPerDay   the Spend cell / the ad days it covers, with its floor
--                     and partial; not judged
--       budgetUsed    judged: spend / daily budgets over the (campaign,
--                     account-day) pairs of the ad window, each day before its
--                     account's own today, that had a stored daily budget and
--                     were delivering that day. A pair with no ad-day rows is
--                     $0 only when the account's ad numbers were read that day
--                     (rows that day, or a finished day read); otherwise it is
--                     left out and said. Partial when fewer days have budgets
--                     than the ad window (before the history starts). Lifetime
--                     budgets are left out and said. Above 110% is a note
--                     (Meta may spend up to 75% over a daily budget on one day,
--                     at most 7 times it in a week), never a status.
--                     Extras: budgetDays, yesterday {day on each account's
--                     clock, spend, budget}, notSpending (campaigns delivering
--                     on a daily budget that spent $0 yesterday), over.
--   cockpit_board_budget_clocks    (new, internal) each account's time zone and today
--   cockpit_board_account_words    (new, internal) Meta's account status in words
--   cockpit_board_rows             the three cells beside the ad cells, in every
--                                  branch (rebuilt from 20261017090000; nothing
--                                  else changes)
--   cockpit_board_budget_list      (new, internal) and cockpit_board_client: the
--                                  page's budgets: each account (Meta status,
--                                  spending limit and how many days of budget
--                                  are left under it), one row per campaign
--                                  switched on now (a $0 one too, which the
--                                  tree leaves out), and the paused ones summed
--   cockpit_board_read             a note when the budgets were last read more
--                                  than 3 hours ago, or never; every key kept
--
-- Missing is never zero: a budget not read is not measured with a sentence,
-- never $0, and a day whose ad numbers were not read is never a $0 day.
--
-- How we know it works: apps/media-buyer-cockpit/scripts/board-api-supabase.test.ts
-- (the formulas on PGlite) and board-contract-supabase.test.ts (the screen's
-- fixture against the real read). Safe to apply twice.
--
-- Rollback: re-run cockpit_board_default_targets from 20261016220000,
-- cockpit_board_rows and cockpit_board_read from 20261017090000 and
-- cockpit_board_client from 20261016133300 (with their grant sections), then
-- DROP FUNCTION public.cockpit_board_budget_list(text[],date,date,jsonb,jsonb,jsonb),
-- public.cockpit_board_budget_cells(text[],text,date,date,jsonb,jsonb,jsonb,jsonb),
-- public.cockpit_board_budget_clocks(text[],jsonb) and
-- public.cockpit_board_account_words(integer). Any saved budget_used target
-- or lever row stays and is ignored.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regclass('public.cockpit_meta_budget_days') IS NULL OR to_regclass('public.cockpit_meta_account_state') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261017100000_meta_budgets.sql first';
  END IF;
  IF to_regprocedure('public.cockpit_board_add_note(jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261016220000_board_read_checked.sql first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The targets: Budget used, before CPM

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
    (11, 'budget_used', 'budgetUsed', 'Budget used', 'percent', 'higher', 90, 70, false, false, 3, 'days with a budget',
        'media_buyer', 'set 2026-10-17 as a starting aim; Meta paces a daily budget over a week (up to 75% over on one day, at most 7 times it in a week), so the time frame is judged, never one day'),
    (12, 'cpm', 'cpm', 'CPM', 'usd', 'lower', 10, 15, false, false, 1000, 'impressions',
        'media_buyer', 'approved 2026-10-16'),
    (13, 'frequency', 'frequency', 'Frequency', 'ratio', 'lower', 2.5, 3.5, true, false, 1000, 'impressions',
        'creative', 'calculator.ts: fatigue at 2.5 or more'),
    (14, 'link_ctr', 'linkCtr', 'Link CTR', 'percent', 'higher', 0.8, 0.3, false, false, 1000, 'impressions',
        'creative', 'kpi.ts LINK_CTR_FLOOR is the watch line'),
    (15, 'cpc', 'cpc', 'Cost per link click', 'usd', 'lower', 1.25, 2, false, false, 1000, 'impressions',
        'media_buyer', 'approved 2026-10-16'),
    (16, 'opt_in', 'optIn', 'Opt-in rate', 'percent', 'higher', 10, 2, false, false, 50, 'link clicks',
        'media_buyer', 'calculator.ts: under 2% is a page or form problem'),
    (17, 'hook_rate', 'hookRate', 'Hook rate', 'percent', 'higher', 25, 15, false, false, 1000, 'video impressions',
        'creative', '3-second plays / impressions; approved 2026-10-16'),
    (18, 'hold_rate', 'holdRate', 'Hold rate', 'percent', 'higher', 30, 15, false, false, 1000, 'video impressions',
        'creative', 'ThruPlays / 3-second plays; approved 2026-10-16'),
    (19, 'leads_touched', 'leadsTouched', 'Leads contacted', 'percent', 'higher', 90, 90, false, false, 20, 'callable leads',
        'call_center', 'callCentre.ts CALL_RULES.touchedShare and minLeads, over leads with a Maqsam call (2026-10-16 check); any miss is off, as in callCentreVerdict'),
    (20, 'first_call', 'firstCall', 'First call', 'minutes', 'lower', 30, 30, false, false, NULL, NULL,
        'call_center', 'callCentre.ts CALL_RULES.firstCallWorkMinutes, in working minutes; any miss is off, as in callCentreVerdict')
  ) AS v(n, metric, value_key, label, unit, direction, good, watch, strict_good, never_off, min_sample, sample, owner_department, basis)
  ORDER BY v.n
$$;

-- ---------------------------------------------------------------------------
-- 2. Helpers (internal)

/** Meta's ad account status in a few plain words (accountWhyNot in meta-ad-days/parse.ts says the same). */
CREATE OR REPLACE FUNCTION public.cockpit_board_account_words(p_status integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_status IS NULL THEN 'Status not known'
    WHEN p_status = 1 THEN 'Active'
    WHEN p_status = 9 THEN 'In its grace period: a payment is due'
    WHEN p_status = 3 THEN 'Unsettled: payment needed'
    WHEN p_status = 2 THEN 'Disabled'
    WHEN p_status = 7 THEN 'Under Meta''s risk review'
    WHEN p_status = 8 THEN 'Pending settlement'
    WHEN p_status = 100 THEN 'Pending closure'
    WHEN p_status = 101 THEN 'Closed'
    ELSE format('Not active (Meta status %s)', p_status) END
$$;

/**
 * Each linked ad account's clock for the budgets: a name to say it by, its
 * time zone (the Meta store's, else the meta-ad-days tasks', since an account
 * read only for its budgets has no ad-day rows, else Kuwait's), and today on
 * it. The budget days and the ad days are both on this clock. p_meta is
 * cockpit_meta_ad_days_status().
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_budget_clocks(p_accounts text[], p_meta jsonb)
RETURNS TABLE(account_id text, name text, tz text, today date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id,
    coalesce(nullif(btrim(j.e->>'name'), ''), nullif(btrim(k.account_name), '')),
    coalesce(nullif(btrim(j.e->>'timezone'), ''), nullif(btrim(k.account_timezone), ''), 'Asia/Kuwait'),
    public.cockpit_meta_budget_day(public.cockpit_meta_ad_days_now(),
      coalesce(nullif(btrim(j.e->>'timezone'), ''), nullif(btrim(k.account_timezone), ''), 'Asia/Kuwait'))
  FROM (SELECT DISTINCT x AS id FROM unnest(coalesce(p_accounts, '{}'::text[])) x WHERE x IS NOT NULL) a
  LEFT JOIN LATERAL (SELECT e FROM jsonb_array_elements(coalesce(p_meta->'accounts', '[]'::jsonb)) e
                     WHERE e->>'accountId' = a.id LIMIT 1) j ON true
  LEFT JOIN LATERAL (SELECT t.account_name, t.account_timezone FROM public.cockpit_meta_ad_day_tasks t
                     WHERE t.account_id = a.id AND t.account_timezone IS NOT NULL
                     ORDER BY t.updated_at DESC LIMIT 1) k ON true
$$;

/**
 * The budget cells of one client (p_campaign NULL: its row's Ads cells) or of
 * one campaign (its page's budget rows; p_accounts is then the campaign's
 * account), over the Kuwait days p_from..p_to:
 *   dailyBudget     now. A client: the daily budgets of the campaigns
 *                   delivering now, USD, with the campaigns counted, the
 *                   lifetime ones left out, the read time, the ones switched
 *                   on but not delivering and the accounts that need action.
 *                   A campaign: its own daily budget while switched on.
 *   spendPerDay     the Spend cell (p_spend; a campaign's own spend when NULL)
 *                   / the ad days it covers, with its floor and partial.
 *   budgetUsed      judged (budget_used); see the head of this file.
 *   spentYesterday, usedYesterday   a campaign's own yesterday (its page);
 *                   NULL for a client.
 * p_cover is cockpit_board_ad_cover(), p_meta cockpit_meta_ad_days_status(),
 * p_targets cockpit_board_targets_map().
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_budget_cells(p_accounts text[], p_campaign text, p_from date, p_to date,
  p_cover jsonb, p_meta jsonb, p_targets jsonb, p_spend jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_accounts text[] := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_accounts, '{}'::text[])) x WHERE x IS NOT NULL);
  v_ad_ok boolean := coalesce(p_cover->>'state' IN ('full', 'partial'), false);
  v_win_to date := (p_cover->>'winTo')::date;
  v_ad_days integer := (p_cover->>'adDays')::integer;
  v_none constant text := 'No Meta ad account is linked to this client.';
  v_unread_now constant text := 'Meta budgets have not been read for the linked ad account yet; they are read every hour.';
  v_clocks jsonb;
  n record;
  w record;
  cb public.cockpit_meta_budgets;
  v_read_n integer; v_unread_n integer; v_unread text; v_as_of timestamptz;
  v_issues jsonb;
  v_known integer := 0; v_any_read boolean := false; v_first date; v_hist_from date; v_hist_all boolean; v_no_hist text; v_lag text;
  v_y_read integer; v_y_accounts integer; v_y_min date; v_y_max date;
  v_ys numeric; v_ys_unpriced integer; v_ys_read boolean;
  v_zero date;
  v_spend jsonb := p_spend;
  v_s numeric; v_su integer;
  v_daily jsonb; v_per_day jsonb; v_used jsonb; v_yesterday jsonb; v_spent_y jsonb; v_used_y jsonb;
  v_pair jsonb; v_extra jsonb; v_x numeric; v_note text;
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

  -- Which accounts' budgets were ever read (the account state comes with every read), and when.
  SELECT count(s.account_id)::int, (count(*) - count(s.account_id))::int,
         string_agg(coalesce(c.name, 'ad account ' || c.account_id), ', ' ORDER BY c.account_id) FILTER (WHERE s.account_id IS NULL),
         min(s.fetched_at)
    INTO v_read_n, v_unread_n, v_unread, v_as_of
  FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
  LEFT JOIN public.cockpit_meta_account_state s ON s.account_id = c.account_id;

  -- 1. The budget now.
  IF p_campaign IS NULL THEN
    SELECT count(*) FILTER (WHERE b.delivering AND b.budget_type = 'daily')::int AS d_n,
           count(*) FILTER (WHERE b.delivering AND b.budget_type = 'daily' AND b.budget_level = 'campaign')::int AS d_cbo,
           count(*) FILTER (WHERE b.delivering AND b.budget_type = 'daily' AND b.budget_level = 'adset')::int AS d_abo,
           sum(b.daily_budget_usd) FILTER (WHERE b.delivering AND b.budget_type = 'daily') AS d_usd,
           count(*) FILTER (WHERE b.delivering AND b.budget_type = 'daily' AND b.daily_budget_usd IS NULL)::int AS d_unpriced,
           count(*) FILTER (WHERE b.delivering AND b.budget_type = 'lifetime')::int AS l_n,
           count(*) FILTER (WHERE b.switched_on AND NOT b.delivering AND b.budget_type = 'daily')::int AS h_n,
           sum(b.daily_budget_usd) FILTER (WHERE b.switched_on AND NOT b.delivering AND b.budget_type = 'daily') AS h_usd,
           string_agg(DISTINCT b.why_not, '; ' ORDER BY b.why_not)
             FILTER (WHERE b.switched_on AND NOT b.delivering AND b.budget_type = 'daily') AS h_why
      INTO n
    FROM public.cockpit_meta_budgets b
    WHERE b.level = 'campaign' AND b.account_id = ANY(v_accounts);

    -- The accounts that need action: billing, a spending limit reached or under a day of budget away.
    SELECT jsonb_agg(jsonb_build_object('accountId', c.account_id, 'name', c.name, 'issue', i.issue,
             'words', CASE i.issue
               WHEN 'billing' THEN public.cockpit_board_account_words(s.account_status)
               WHEN 'limit_reached' THEN 'Spending limit reached'
               ELSE format('Spending limit nearly used: %s %s left, under one day of budget',
                 to_char(s.spend_cap - coalesce(s.amount_spent, 0), 'FM999,999,990.00'), coalesce(s.currency, '')) END)
             ORDER BY c.account_id)
      INTO v_issues
    FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
    JOIN public.cockpit_meta_account_state s ON s.account_id = c.account_id
    LEFT JOIN LATERAL (SELECT sum(b.daily_budget) AS daily FROM public.cockpit_meta_budgets b
                       WHERE b.account_id = c.account_id AND b.level = 'campaign' AND b.delivering AND b.budget_type = 'daily') d ON true
    CROSS JOIN LATERAL (SELECT CASE
        WHEN s.account_status IS NOT NULL AND s.account_status <> 1 THEN 'billing'
        WHEN s.spend_cap IS NOT NULL AND coalesce(s.amount_spent, 0) >= s.spend_cap THEN 'limit_reached'
        WHEN s.spend_cap IS NOT NULL AND d.daily > 0 AND s.spend_cap - coalesce(s.amount_spent, 0) < d.daily THEN 'limit_near'
      END AS issue) i
    WHERE i.issue IS NOT NULL;

    IF v_read_n = 0 THEN
      v_daily := public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_unread_now);
    ELSE
      v_daily := public.cockpit_board_cell(NULL, round(coalesce(n.d_usd, 0), 2), p_targets, NULL, NULL, NULL, NULL,
        concat_ws(' ',
          CASE WHEN n.d_n = 0 THEN 'No campaign is delivering on a daily budget now.'
               ELSE format('%s delivering now: %s.', CASE WHEN n.d_n = 1 THEN '1 campaign' ELSE n.d_n || ' campaigns' END,
                 concat_ws(', ', CASE WHEN n.d_cbo > 0 THEN n.d_cbo || ' on a campaign budget' END,
                                 CASE WHEN n.d_abo > 0 THEN n.d_abo || ' on ad set budgets' END)) END,
          CASE WHEN n.l_n > 0 THEN format('%s on a lifetime budget %s left out.',
            CASE WHEN n.l_n = 1 THEN '1 campaign' ELSE n.l_n || ' campaigns' END, CASE WHEN n.l_n = 1 THEN 'is' ELSE 'are' END) END,
          CASE WHEN n.h_n > 0 THEN format('%s %s on but not delivering%s: %s.',
            CASE WHEN n.h_n = 1 THEN '1 more campaign' ELSE n.h_n || ' more campaigns' END, CASE WHEN n.h_n = 1 THEN 'is' ELSE 'are' END,
            CASE WHEN n.h_usd IS NOT NULL THEN format(' (%s a day)', public.cockpit_board_fmt(n.h_usd, 'usd')) ELSE '' END, n.h_why) END,
          CASE WHEN n.d_unpriced > 0 THEN format('%s of them %s in a currency with no fixed USD rate, so this is at least the budget.',
            n.d_unpriced, CASE WHEN n.d_unpriced = 1 THEN 'is' ELSE 'are' END) END,
          CASE WHEN v_unread_n > 0 THEN format('The budgets of %s have not been read yet, so this is at least the budget.', v_unread) END,
          format('Read %s Kuwait time: the budget now, whatever the time frame.', to_char(v_as_of AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'))),
        jsonb_build_object('campaigns', n.d_n, 'lifetime', n.l_n, 'asOf', v_as_of, 'notDelivering', n.h_n)
          || CASE WHEN n.h_n > 0 THEN jsonb_build_object('heldBudget', round(n.h_usd, 2)) ELSE '{}'::jsonb END
          || CASE WHEN n.d_unpriced > 0 OR v_unread_n > 0 THEN jsonb_build_object('atLeast', true) ELSE '{}'::jsonb END
          || CASE WHEN v_issues IS NOT NULL THEN jsonb_build_object('accountIssues', v_issues) ELSE '{}'::jsonb END);
    END IF;
  ELSE
    SELECT * INTO cb FROM public.cockpit_meta_budgets b
    WHERE b.level = 'campaign' AND b.object_id = p_campaign AND b.account_id = ANY(v_accounts);
    v_daily := CASE
      WHEN cb.object_id IS NULL THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        CASE WHEN v_read_n = 0 THEN v_unread_now ELSE 'This campaign was not in the last budgets read.' END)
      WHEN cb.budget_type = 'lifetime' THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        'A lifetime budget: no daily figure.')
      WHEN cb.budget_type IS NULL THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        'No budget is set on the campaign or its ad sets.')
      WHEN cb.daily_budget_usd IS NULL THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        format('%s %s a day, in a currency with no fixed USD rate.', to_char(cb.daily_budget, 'FM999,999,990.00'), cb.currency))
      ELSE public.cockpit_board_cell(NULL, round(cb.daily_budget_usd, 2), p_targets, NULL, NULL, NULL, NULL,
        concat_ws(' ',
          CASE WHEN cb.budget_level = 'campaign' THEN 'The campaign''s own budget.' ELSE 'Its ad sets'' budgets, added up.' END,
          CASE WHEN cb.currency <> 'USD' THEN format('%s %s a day.', to_char(cb.daily_budget, 'FM999,999,990.00'), cb.currency) END,
          CASE WHEN NOT cb.delivering THEN format('Not delivering now: %s.', cb.why_not) END,
          format('Read %s Kuwait time.', to_char(cb.fetched_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'))))
    END;
  END IF;

  -- 2. The campaign-days: those of the ad window, each before its account's
  -- own today, and each account's own yesterday, with the day's spend.
  WITH c AS (
    SELECT * FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
  ), bd AS (
    SELECT d.account_id, d.campaign_id, d.day, d.budget_type, d.daily_budget_usd, d.delivering, d.changed_during_day,
      c.tz, c.name AS account_name, d.day = c.today - 1 AS is_y,
      (v_ad_ok AND d.day BETWEEN p_from AND v_win_to AND d.day < c.today) AS in_win
    FROM public.cockpit_meta_budget_days d JOIN c ON c.account_id = d.account_id
    WHERE (p_campaign IS NULL OR d.campaign_id = p_campaign)
      AND d.delivering_any AND d.budget_type IN ('daily', 'lifetime')
      AND (d.day = c.today - 1 OR (v_ad_ok AND d.day BETWEEN p_from AND v_win_to AND d.day < c.today))
  ), pr AS (
    SELECT bd.*, coalesce(s.spend, 0) AS spend, s.unpriced,
      -- No ad-day rows: $0 only when the account's ad numbers were read that day.
      CASE WHEN s.n > 0 THEN true
           ELSE EXISTS (SELECT 1 FROM public.cockpit_meta_ad_days m WHERE m.account_id = bd.account_id AND m.day = bd.day)
             OR EXISTS (SELECT 1 FROM public.cockpit_meta_ad_day_tasks t
                        WHERE t.account_id = bd.account_id AND t.kind = 'days' AND t.state = 'done'
                          AND bd.day BETWEEN t.since AND t.until
                          AND public.cockpit_meta_budget_day(t.updated_at, bd.tz) > bd.day) END AS ad_read
    FROM bd
    CROSS JOIN LATERAL (SELECT count(*) AS n, sum(m.spend_usd) AS spend,
                          count(*) FILTER (WHERE m.spend IS NOT NULL AND m.spend_usd IS NULL) AS unpriced
                        FROM public.cockpit_meta_ad_days m
                        WHERE m.campaign_id = bd.campaign_id AND m.day = bd.day AND m.account_id = bd.account_id) s
  ), ok AS (
    SELECT pr.*, (pr.budget_type = 'daily' AND pr.daily_budget_usd IS NOT NULL AND pr.unpriced = 0 AND pr.ad_read) AS counted
    FROM pr
  )
  SELECT
    count(*) FILTER (WHERE ok.in_win AND ok.counted)::int AS n,
    sum(ok.spend) FILTER (WHERE ok.in_win AND ok.counted) AS num,
    sum(ok.daily_budget_usd) FILTER (WHERE ok.in_win AND ok.counted) AS den,
    count(DISTINCT ok.day) FILTER (WHERE ok.in_win AND ok.counted AND ok.daily_budget_usd > 0)::int AS days,
    count(*) FILTER (WHERE ok.in_win AND ok.budget_type = 'daily' AND NOT ok.ad_read)::int AS unread,
    string_agg(DISTINCT coalesce(ok.account_name, 'ad account ' || ok.account_id), ', ')
      FILTER (WHERE ok.in_win AND ok.budget_type = 'daily' AND NOT ok.ad_read) AS unread_names,
    count(*) FILTER (WHERE ok.in_win AND ok.budget_type = 'daily' AND ok.ad_read AND NOT ok.counted)::int AS unpriced,
    count(DISTINCT ok.campaign_id) FILTER (WHERE ok.in_win AND ok.budget_type = 'lifetime')::int AS lifetime,
    count(*) FILTER (WHERE ok.in_win AND ok.counted AND ok.changed_during_day)::int AS changed,
    sum(ok.spend) FILTER (WHERE ok.is_y AND ok.counted) AS y_spend,
    sum(ok.daily_budget_usd) FILTER (WHERE ok.is_y AND ok.counted) AS y_budget,
    count(*) FILTER (WHERE ok.is_y AND ok.budget_type = 'daily' AND NOT ok.counted)::int AS y_left,
    count(DISTINCT ok.campaign_id) FILTER (WHERE ok.is_y AND ok.counted AND ok.delivering AND ok.daily_budget_usd > 0
                                             AND ok.spend = 0)::int AS y_zero
    INTO w
  FROM ok;

  -- The days whose budgets are known for every linked account, and why not the others.
  IF v_ad_ok THEN
    SELECT count(*)::int INTO v_known
    FROM generate_series(0, v_win_to - p_from) g(i)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
      WHERE NOT (p_from + g.i < c.today AND EXISTS (SELECT 1 FROM public.cockpit_meta_budget_account_days x
                                                    WHERE x.account_id = c.account_id AND x.day = p_from + g.i)));
    SELECT EXISTS (SELECT 1 FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
                   JOIN public.cockpit_meta_budget_account_days x ON x.account_id = c.account_id
                   WHERE x.day BETWEEN p_from AND v_win_to AND x.day < c.today)
      INTO v_any_read;
  END IF;
  SELECT bool_and(f.first IS NOT NULL), max(f.first), min(f.first),
         string_agg(coalesce(c.name, 'ad account ' || c.account_id), ', ' ORDER BY c.account_id) FILTER (WHERE f.first IS NULL),
         string_agg(format('%s keeps %s time, so %s is not over there yet', coalesce(c.name, 'ad account ' || c.account_id), c.tz,
           to_char(v_win_to, 'DD Mon')), '; ' ORDER BY c.account_id) FILTER (WHERE v_ad_ok AND v_win_to >= c.today)
    INTO v_hist_all, v_hist_from, v_first, v_no_hist, v_lag
  FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
  LEFT JOIN LATERAL (SELECT min(x.day) AS first FROM public.cockpit_meta_budget_account_days x WHERE x.account_id = c.account_id) f ON true;

  -- Yesterday, on each account's own clock, whatever the time frame.
  SELECT count(x.account_id)::int, count(*)::int, min(c.today - 1), max(c.today - 1)
    INTO v_y_read, v_y_accounts, v_y_min, v_y_max
  FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
  LEFT JOIN public.cockpit_meta_budget_account_days x ON x.account_id = c.account_id AND x.day = c.today - 1;
  v_yesterday := CASE WHEN v_y_read > 0 THEN
      jsonb_build_object('day', v_y_max, 'spend', round(coalesce(w.y_spend, 0), 2), 'budget', round(coalesce(w.y_budget, 0), 2))
      || CASE WHEN v_y_min <> v_y_max THEN jsonb_build_object('days', jsonb_build_array(v_y_min, v_y_max)) ELSE '{}'::jsonb END
      || CASE WHEN v_y_read < v_y_accounts OR w.y_left > 0 THEN jsonb_build_object('partial', true) ELSE '{}'::jsonb END END;

  -- 3. Spend per day: the Spend cell over the ad days it covers.
  IF NOT v_ad_ok THEN
    v_per_day := public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
      coalesce(p_cover->>'note', v_spend->>'note', 'No ad numbers are stored for these days.'));
  ELSE
    IF v_spend IS NULL THEN
      -- One campaign: its own spend in the ad window, each day before its account's own today.
      SELECT sum(m.spend_usd), count(*) FILTER (WHERE m.spend IS NOT NULL AND m.spend_usd IS NULL)::int INTO v_s, v_su
      FROM public.cockpit_meta_ad_days m
      JOIN jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date) ON c.account_id = m.account_id
      WHERE m.campaign_id = p_campaign AND m.day BETWEEN p_from AND v_win_to AND m.day < c.today;
      v_spend := jsonb_build_object('v', CASE WHEN v_s IS NOT NULL OR v_su = 0 THEN round(coalesce(v_s, 0), 2) END)
        || jsonb_strip_nulls(jsonb_build_object(
             'atLeast', CASE WHEN v_su > 0 OR coalesce((p_cover->>'partial')::boolean, false) THEN true END,
             'partial', CASE WHEN coalesce((p_cover->>'partial')::boolean, false) THEN true END,
             'note', nullif(concat_ws(' ', CASE WHEN v_su > 0 THEN 'Some spend is in a currency with no fixed USD rate, so this is at least the spend.' END,
               p_cover->>'note'), '')));
    END IF;
    v_s := (v_spend->>'v')::numeric;
    v_per_day := CASE
      WHEN v_s IS NULL THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        coalesce(v_spend->>'note', 'The spend is in a currency with no fixed USD rate.'))
      ELSE public.cockpit_board_cell(NULL, round(v_s / v_ad_days, 2), p_targets, NULL, round(v_s, 2), v_ad_days, NULL, v_spend->>'note',
        jsonb_strip_nulls(jsonb_build_object('atLeast', CASE WHEN v_spend->'atLeast' = 'true'::jsonb THEN true END,
          'partial', CASE WHEN v_spend->'partial' = 'true'::jsonb THEN true END))) END;
  END IF;

  -- 4. Budget used: spend / daily budgets over the campaign-days that had one and were delivering.
  v_extra := jsonb_build_object('budgetDays', CASE WHEN v_any_read THEN w.days END, 'yesterday', v_yesterday,
    'notSpending', CASE WHEN v_y_read > 0 THEN w.y_zero END);
  IF NOT v_ad_ok THEN
    v_used := public.cockpit_board_cell('budget_used', NULL, p_targets, NULL, NULL, NULL, 'not_measured',
      coalesce(p_cover->>'note', 'No ad numbers are stored for these days.'), v_extra);
  ELSIF NOT v_any_read THEN
    v_used := public.cockpit_board_cell('budget_used', NULL, p_targets, NULL, NULL, NULL, 'not_measured',
      CASE WHEN v_first IS NULL THEN v_unread_now
           WHEN v_win_to < v_first THEN format('Meta budgets are stored from %s; this time frame is before that.', to_char(v_first, 'DD Mon YYYY'))
           ELSE 'No budget was read on these days.' END, v_extra);
  ELSE
    v_pair := public.cockpit_board_paired(v_known, v_ad_days) - 'note';
    IF w.unread > 0 OR w.unpriced > 0 THEN v_pair := v_pair || jsonb_build_object('partial', true); END IF;
    v_note := nullif(concat_ws(' ',
      CASE WHEN v_known < v_ad_days THEN concat_ws(' ',
        CASE WHEN v_known = 1 THEN format('Over the one day of %s whose budgets are known.', v_ad_days)
             ELSE format('Over the %s of %s days whose budgets are known.', v_known, v_ad_days) END,
        CASE WHEN NOT v_hist_all THEN format('The budgets of %s have not been read yet.', v_no_hist)
             WHEN p_from < v_hist_from THEN format('Budgets are stored from %s.', to_char(v_hist_from, 'DD Mon YYYY')) END,
        CASE WHEN v_lag IS NOT NULL THEN v_lag || '.' END) END,
      CASE WHEN w.unread > 0 THEN format('%s campaign-day%s with a daily budget %s left out: the ad numbers of %s were not read those days.',
        w.unread, CASE WHEN w.unread = 1 THEN '' ELSE 's' END, CASE WHEN w.unread = 1 THEN 'is' ELSE 'are' END, w.unread_names) END,
      CASE WHEN w.unpriced > 0 THEN format('%s campaign-day%s in a currency with no fixed USD rate %s left out.',
        w.unpriced, CASE WHEN w.unpriced = 1 THEN '' ELSE 's' END, CASE WHEN w.unpriced = 1 THEN 'is' ELSE 'are' END) END,
      CASE WHEN w.lifetime > 0 THEN format('%s on a lifetime budget %s left out.',
        CASE WHEN w.lifetime = 1 THEN '1 campaign' ELSE w.lifetime || ' campaigns' END, CASE WHEN w.lifetime = 1 THEN 'is' ELSE 'are' END) END,
      CASE WHEN w.changed > 0 THEN format('A budget changed during %s of these campaign-days; each day is read at its last budget.', w.changed) END), '');
    IF coalesce(w.den, 0) = 0 THEN
      v_used := CASE
        WHEN p_campaign IS NOT NULL AND cb.budget_type = 'lifetime' THEN public.cockpit_board_cell('budget_used', NULL, p_targets, NULL,
          NULL, NULL, 'not_measured', 'A lifetime budget: no daily figure.', v_extra || v_pair)
        WHEN w.unread > 0 OR w.unpriced > 0
        THEN public.cockpit_board_cell('budget_used', NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_note, v_extra || v_pair)
        ELSE public.cockpit_board_cell('budget_used', NULL, p_targets, 0, 0, 0, 'too_few',
          concat_ws(' ', 'No campaign was delivering on a daily budget in these days.', v_note), v_extra || v_pair) END;
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
    WHERE m.campaign_id = p_campaign AND m.day = c.today - 1;
    SELECT bool_and(EXISTS (SELECT 1 FROM public.cockpit_meta_ad_days m WHERE m.account_id = c.account_id AND m.day = c.today - 1)
                    OR EXISTS (SELECT 1 FROM public.cockpit_meta_ad_day_tasks t
                               WHERE t.account_id = c.account_id AND t.kind = 'days' AND t.state = 'done'
                                 AND c.today - 1 BETWEEN t.since AND t.until AND public.cockpit_meta_budget_day(t.updated_at, c.tz) > c.today - 1))
      INTO v_ys_read
    FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date);
    -- Delivering on a daily budget yesterday and nothing spent: since when, back to its last spend.
    IF w.y_zero > 0 THEN
      SELECT min(d.day) INTO v_zero FROM public.cockpit_meta_budget_days d
      WHERE d.campaign_id = p_campaign AND d.budget_type = 'daily' AND d.delivering_any AND d.day <= v_y_max
        AND d.day > coalesce((SELECT max(m.day) FROM public.cockpit_meta_ad_days m
                              WHERE m.campaign_id = p_campaign AND m.spend > 0 AND m.day <= v_y_max), '-infinity'::date);
    END IF;
    v_spent_y := CASE
      WHEN NOT coalesce(v_ys_read, false) THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
        format('The ad numbers for %s have not been read yet.', to_char(v_y_max, 'DD Mon')))
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
        CASE WHEN w.y_left > 0 THEN 'Yesterday''s spend or budget is not known in US dollars.'
             ELSE 'Not delivering on a daily budget yesterday.' END)
      ELSE public.cockpit_board_cell(NULL, round(w.y_spend / w.y_budget * 100, 2), p_targets, NULL, round(w.y_spend, 2),
        round(w.y_budget, 2), NULL,
        'Yesterday''s spend / yesterday''s daily budget. One day is not judged: Meta may spend up to 75% over a daily budget on a day.') END;
  END IF;

  RETURN jsonb_build_object('dailyBudget', v_daily, 'spendPerDay', v_per_day, 'budgetUsed', v_used,
    'spentYesterday', v_spent_y, 'usedYesterday', v_used_y);
END $$;

/**
 * One client's budgets for its page (cockpit_board_client.budgets):
 *   asOf, note
 *   account    each linked ad account: name, currency, Meta's status in words,
 *              when it was read, and its spending limit when one is set (cap,
 *              spent, left, in its currency, and daysLeft: what is left in
 *              days of the daily budgets delivering on it now)
 *   campaigns  one row per campaign switched on now, delivering or not (one
 *              that spent $0 too: the tree lists only campaigns with ad
 *              numbers), and any campaign that spent in these days on an
 *              account whose budgets were never read; each with its budget
 *              cells, why it is not delivering, a lifetime budget apart, and a
 *              flag (off or watch, in words): flagged first, then the biggest
 *              daily budget
 *   paused     the campaigns switched off now that spent in these days, summed
 */
CREATE OR REPLACE FUNCTION public.cockpit_board_budget_list(p_accounts text[], p_from date, p_to date, p_cover jsonb,
  p_meta jsonb, p_targets jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_accounts text[] := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_accounts, '{}'::text[])) x WHERE x IS NOT NULL);
  v_ad_ok boolean := coalesce(p_cover->>'state' IN ('full', 'partial'), false);
  v_win_to date := (p_cover->>'winTo')::date;
  v_clocks jsonb;
  v_as_of timestamptz;
  v_account jsonb;
  v_campaigns jsonb;
  v_paused jsonb;
BEGIN
  IF cardinality(v_accounts) = 0 THEN
    RETURN jsonb_build_object('asOf', NULL, 'note', 'No Meta ad account is linked to this client.', 'account', '[]'::jsonb,
      'campaigns', '[]'::jsonb, 'paused', jsonb_build_object('campaigns', 0, 'spend', NULL));
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_clocks FROM public.cockpit_board_budget_clocks(v_accounts, p_meta) c;

  SELECT min(s.fetched_at), jsonb_agg(jsonb_build_object(
      'accountId', c.account_id, 'name', c.name, 'currency', coalesce(s.currency, j.currency),
      'status', CASE WHEN s.account_id IS NULL THEN 'Budgets not read yet' ELSE public.cockpit_board_account_words(s.account_status) END,
      'asOf', s.fetched_at,
      'spendingLimit', CASE WHEN s.spend_cap IS NOT NULL THEN jsonb_build_object(
          'cap', s.spend_cap, 'spent', s.amount_spent, 'left', greatest(s.spend_cap - coalesce(s.amount_spent, 0), 0),
          'daysLeft', CASE WHEN d.daily > 0 THEN round(greatest(s.spend_cap - coalesce(s.amount_spent, 0), 0) / d.daily, 1) END) END)
      ORDER BY c.account_id)
    INTO v_as_of, v_account
  FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
  LEFT JOIN public.cockpit_meta_account_state s ON s.account_id = c.account_id
  LEFT JOIN LATERAL (SELECT e->>'currency' AS currency FROM jsonb_array_elements(coalesce(p_meta->'accounts', '[]'::jsonb)) e
                     WHERE e->>'accountId' = c.account_id LIMIT 1) j ON true
  LEFT JOIN LATERAL (SELECT sum(b.daily_budget) AS daily FROM public.cockpit_meta_budgets b
                     WHERE b.account_id = c.account_id AND b.level = 'campaign' AND b.delivering AND b.budget_type = 'daily') d ON true;

  WITH c AS (
    SELECT * FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
  ), spent AS (
    -- The campaigns that spent in the ad window, each day before its account's own today.
    SELECT m.campaign_id, max(m.account_id) AS account_id, max(m.campaign_name) AS name
    FROM public.cockpit_meta_ad_days m JOIN c ON c.account_id = m.account_id
    WHERE v_ad_ok AND m.day BETWEEN p_from AND v_win_to AND m.day < c.today
    GROUP BY m.campaign_id
    HAVING sum(m.spend) > 0
  ), rows AS (
    SELECT b.object_id AS id, b.name, b.account_id, b.budget_level, b.budget_type, b.delivering, b.why_not, b.daily_budget_usd,
      b.lifetime_budget, b.budget_remaining, b.end_time, b.currency, c.tz, c.today,
      (SELECT count(*) FROM public.cockpit_meta_budgets x WHERE x.level = 'adset' AND x.campaign_id = b.object_id AND x.switched_on)::int AS adsets
    FROM public.cockpit_meta_budgets b JOIN c ON c.account_id = b.account_id
    WHERE b.level = 'campaign' AND b.switched_on
    UNION ALL
    -- Spent in these days on an account whose budgets were never read: its budget is not known.
    SELECT sp.campaign_id, sp.name, sp.account_id, NULL, NULL, NULL, 'Budget not read yet', NULL, NULL, NULL, NULL, NULL, c.tz, c.today, NULL
    FROM spent sp JOIN c ON c.account_id = sp.account_id
    WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_meta_account_state s WHERE s.account_id = sp.account_id)
  ), cells AS (
    SELECT r.*, public.cockpit_board_budget_cells(ARRAY[r.account_id], r.id, p_from, p_to, p_cover, p_meta, p_targets, NULL) AS m
    FROM rows r
  ), flagged AS (
    SELECT x.*, CASE
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
      'adsets', f.adsets, 'delivering', f.delivering, 'whyNot', f.why_not,
      'lifetime', CASE WHEN f.budget_type = 'lifetime' THEN jsonb_build_object(
          'budget', round(f.lifetime_budget * public.cockpit_meta_ad_days_usd_per(f.currency), 2),
          'remaining', round(f.budget_remaining * public.cockpit_meta_ad_days_usd_per(f.currency), 2),
          'currency', f.currency,
          'endsOn', public.cockpit_meta_budget_day(f.end_time, f.tz)) END,
      'flag', f.flag,
      'metrics', jsonb_build_object('dailyBudget', f.m->'dailyBudget', 'spentYesterday', f.m->'spentYesterday',
        'usedYesterday', f.m->'usedYesterday', 'spendPerDay', f.m->'spendPerDay', 'budgetUsed', f.m->'budgetUsed'))
      ORDER BY (f.flag IS NOT NULL) DESC, f.daily_budget_usd DESC NULLS LAST, f.name, f.id), '[]'::jsonb)
    INTO v_campaigns
  FROM flagged f;

  WITH c AS (
    SELECT * FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date)
  ), spent AS (
    SELECT m.campaign_id, max(m.account_id) AS account_id, sum(m.spend_usd) AS spend
    FROM public.cockpit_meta_ad_days m JOIN c ON c.account_id = m.account_id
    WHERE v_ad_ok AND m.day BETWEEN p_from AND v_win_to AND m.day < c.today
    GROUP BY m.campaign_id
    HAVING sum(m.spend) > 0
  )
  SELECT CASE WHEN v_ad_ok THEN jsonb_build_object('campaigns', count(*), 'spend', round(coalesce(sum(sp.spend), 0), 2))
              ELSE jsonb_build_object('campaigns', NULL, 'spend', NULL) END
    INTO v_paused
  FROM spent sp
  WHERE EXISTS (SELECT 1 FROM public.cockpit_meta_account_state s WHERE s.account_id = sp.account_id)
    AND NOT EXISTS (SELECT 1 FROM public.cockpit_meta_budgets b WHERE b.level = 'campaign' AND b.object_id = sp.campaign_id AND b.switched_on);

  RETURN jsonb_build_object(
    'asOf', v_as_of,
    'note', concat_ws(' ',
      CASE WHEN v_as_of IS NULL THEN 'Meta budgets have not been read for the linked ad account yet; they are read every hour.'
           ELSE format('Budgets as Meta had them at %s Kuwait time; spend runs to yesterday on each ad account''s own clock.',
             to_char(v_as_of AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI')) END,
      'One day is not judged: Meta may spend up to 75% over a daily budget on a day, and at most 7 times it in a week.'),
    'account', coalesce(v_account, '[]'::jsonb),
    'campaigns', v_campaigns,
    'paused', v_paused);
END $$;

-- ---------------------------------------------------------------------------
-- 3. The rows: the three budget cells beside the ad cells (from 20261017090000)

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
    -- Budgets (2026-10-17): the daily budgets delivering now, spend per day
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
-- 4. The client page: its budgets (from 20261016133300)

/**
 * One client for a time frame: its board row, its campaigns > ad sets > ads
 * with CRM leads, bookings and shows per ad id, the appointments due with no
 * outcome (live), its levers, and (2026-10-17) its budgets
 * (cockpit_board_budget_list).
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
  v_cover jsonb;
  v_list jsonb;
  v_levers jsonb;
  v_board numeric;
  v_live integer;
  v_check text;
  v_facts_at timestamptz;
  v_budgets jsonb;
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
  v_cover := public.cockpit_board_ad_cover(c.ad_account_ids, p_from, p_to, v_meta);
  v_tree := public.cockpit_board_tree(c.location_id, c.ad_account_ids, p_from, p_to, t, v_marks, v_cover);
  v_list := public.cockpit_board_no_outcome_list(c.location_id, p_from, p_to, v_marks);
  v_budgets := public.cockpit_board_budget_list(c.ad_account_ids, p_from, p_to, v_cover, v_meta, t);
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
      'note', concat_ws(' ', 'Ad numbers end yesterday on each ad account''s own clock; CRM leads, bookings and shows per ad run to the end of the time frame.',
        v_cover->>'note')),
    'adCover', v_cover,
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
    'budgets', v_budgets,
    'canEditTargets', coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false));
END $$;

-- ---------------------------------------------------------------------------
-- 5. The board read: a note when the budgets are old or never read (from 20261017090000)

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
  v_bud_at timestamptz;
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
  -- Budgets (2026-10-17): read every hour by meta-ad-days.
  v_bud_at := (v_meta->'budgets'->>'newestFetchedAt')::timestamptz;
  IF v_bud_at IS NULL THEN
    v_notes := v_notes || 'Meta budgets have not been read yet, so Budget/day and Budget used are empty.'::text;
  ELSIF v_bud_at < now() - interval '3 hours' THEN
    v_notes := v_notes || format('Meta budgets were last read %s Kuwait time; they are read every hour.',
      to_char(v_bud_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'));
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
-- 6. Function privileges: the new helpers for nobody (the definer reads call
-- them as the owner); the reads and the defaults as before.

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['cockpit_board_default_targets()', 'cockpit_board_account_words(integer)',
    'cockpit_board_budget_clocks(text[],jsonb)', 'cockpit_board_budget_cells(text[],text,date,date,jsonb,jsonb,jsonb,jsonb)',
    'cockpit_board_budget_list(text[],date,date,jsonb,jsonb,jsonb)', 'cockpit_board_rows(date,date,text,jsonb)',
    'cockpit_board_client(text,date,date)', 'cockpit_board_read(date,date)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_board_read(date,date) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_board_client(text,date,date) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_board_default_targets() TO service_role';
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
