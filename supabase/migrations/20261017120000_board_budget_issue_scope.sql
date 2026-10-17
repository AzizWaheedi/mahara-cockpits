-- Client Performance board: budget warnings only for ad accounts in use (2026-10-17,
-- Creative Triage bldgtotkfmhoxmlzowdx).
--
-- Read back on production after 20261017100100_board_budgets: City Wood's and Castello's
-- closed second ad accounts (no campaign switched on, no spend) made their Budget/day note say
-- "Account closed", and would have put them on the budget line. An account now needs action only
-- when it has a campaign switched on now or spend in the time frame.
--
-- Replaces cockpit_board_budget_cells (as 20261017100100 left it, this condition apart). Grants
-- restated: unchanged (no browser role). Rollback: re-run it from 20261017100100.

BEGIN;

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
    WHERE b.level = 'campaign' AND b.account_id = ANY(v_accounts);

    -- The accounts that need action (one issue each, the account's status first): a payment (3, 8),
    -- a payment due in the grace period (9, still delivering: billing_due), an account that cannot run
    -- (2, 7, 100, 101, 201...), a spending limit reached or under a day of budget away, or on a prepaid
    -- account its balance used up or under a day away. A spending limit whose amount spent Meta did not
    -- give is not known: no issue, never $0 spent.
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
                      WHERE m.account_id = c.account_id AND m.day BETWEEN p_from AND coalesce(v_win_to, p_to) AND m.spend > 0));

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
          v_issue_words,
          v_stale,
          format('Read %s Kuwait time: the budget now, whatever the time frame.', to_char(v_as_of AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'))),
        jsonb_build_object('campaigns', n.d_n, 'lifetime', n.l_n, 'asOf', v_as_of, 'notDelivering', n.h_n)
          || CASE WHEN n.h_n > 0 THEN jsonb_build_object('heldBudget', round(n.h_usd, 2)) ELSE '{}'::jsonb END
          || CASE WHEN n.h_n > 0 AND v_why IS NOT NULL THEN jsonb_build_object('notDeliveringWhy', to_jsonb(v_why)) ELSE '{}'::jsonb END
          || CASE WHEN n.s_n > 0 THEN jsonb_build_object('starting', n.s_n) ELSE '{}'::jsonb END
          || CASE WHEN NOT v_all_unpriced AND (n.d_unpriced > 0 OR v_unread_n > 0) THEN jsonb_build_object('atLeast', true) ELSE '{}'::jsonb END
          || CASE WHEN v_issues IS NOT NULL THEN jsonb_build_object('accountIssues', v_issues) ELSE '{}'::jsonb END);
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
    WHERE (p_campaign IS NULL OR d.campaign_id = p_campaign)
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
                        WHERE m.campaign_id = bd.campaign_id AND m.day = bd.day AND m.account_id = bd.account_id) s
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
    WHERE m.campaign_id = p_campaign AND m.day = c.today - 1;
    SELECT bool_and(public.cockpit_board_spend_known(c.account_id, c.today - 1, c.tz))
      INTO v_ys_read
    FROM jsonb_to_recordset(v_clocks) AS c(account_id text, name text, tz text, today date);
    -- Switched on with a daily budget yesterday and nothing spent: since when, back to its last spend.
    IF w.y_zero > 0 THEN
      SELECT min(d.day) INTO v_zero FROM public.cockpit_meta_budget_days d
      WHERE d.campaign_id = p_campaign AND d.switched_on_any AND d.max_switched_on_budget IS NOT NULL AND d.day <= v_y_max
        AND d.day > coalesce((SELECT max(m.day) FROM public.cockpit_meta_ad_days m
                              WHERE m.campaign_id = p_campaign AND m.spend > 0 AND m.day <= v_y_max), '-infinity'::date);
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

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.cockpit_board_budget_cells(text[],text,date,date,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role';
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
