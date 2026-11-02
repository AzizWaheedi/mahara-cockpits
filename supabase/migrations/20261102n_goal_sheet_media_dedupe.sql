-- Goals sheet round 3 (2026-11-02): the client media numbers count each Meta ad once a day.
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). One function body; no table, no grant change, no data row.
-- Applies twice. The app ships separately and needs nothing: mediaDaily keeps its shape and keys.
--
-- 1. cockpit_ceo_goal_sheet_context(text) is replaced with 20261102m's body and one change: mediaDaily
--    keeps one row per Meta ad and day, the newest import, before it sums the day (the media client
--    range's rule, 20261022x_media_client_range.sql). Same gate (cockpit_goal_actor), SECURITY
--    DEFINER, search_path '', the same grants (EXECUTE for authenticated and service_role) and every
--    other key built exactly as before.
--
-- Why. The media publish never deletes a row, and its grain holds the campaign name
-- (cockpit_native_grain_key('dailyStats')), so a renamed campaign repeats its ad-days under the old
-- name. Shades' ad 120250793408950703 is stored on 14, 15 and 16 Oct 2026 under 'Shades|mahara|14\10'
-- (imported 17 Oct) and again under 'Shades|mahara|17\10' (imported again 2 Nov). The live mediaDaily
-- summed both, so October counted $70.00, 20,686 impressions, 113 link clicks and 4 leads twice: client
-- CPM read $12.83 for $13.05, link CTR 1.0606% for 1.0723% and opt-in 9.61% for 9.68%. Kept to the
-- newest import, October reads $11,824.95 spend, 906,471 impressions, 9,720 link clicks and 941 leads,
-- which equals Meta's own per-ad table (cockpit_meta_ad_days) over the same ad-days. Those three are
-- the table's only repeated ad-days (1,801 rows, 1,798 ad-days, 13 Aug to 1 Nov 2026, read on 2 Nov),
-- so no other month moves today.
--
-- The audit: the second-source run of 2 Nov 2026, area "Client delivery, call centre, customer success
-- and creative": Client CPM, link CTR and opt-in for October, each verified real. The key is the Meta
-- ad id. A row with none counts as its own ad (source_id), since nothing says it repeats another; every
-- row read on 2 Nov carries one. No other block of this function reads the media table or a table
-- keyed by a name that can change: cockpit_client_days holds one row per location and day,
-- cockpit_sales_eods one per closer and day, and growthDaily and deliveryDaily come from the CEO
-- refresh's payloads, not from this table.
--
-- No audit row: nothing here writes a data row, and the function replacements before it keep none
-- (20261102m writes one for each of its two data rows only). The old-name rows stay in the table; the
-- media sync owns them.
--
-- Rollback: ~/.cache/mahara-ship/rollback/cockpit_ceo_goal_sheet_context.before-20261102n_goal_sheet_media_dedupe.sql
-- (the live body, md5 9317c8f0c73e1c7dc989c92055abc175, which is 20261102m's, and its grants).
-- Test: apps/media-buyer-cockpit/scripts/goal-sheet-media-dedupe-supabase.test.ts.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard: the live body read on 2026-11-02 (20261102m's), or this file's own on a second
--    apply. Anything else was changed since and must be re-read first.

DO $$
DECLARE v text;
BEGIN
  SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.cockpit_ceo_goal_sheet_context(text)'::regprocedure;
  IF v IS DISTINCT FROM '9317c8f0c73e1c7dc989c92055abc175' AND v IS DISTINCT FROM '751dcbdc003977879a3f763dba01faa9' THEN
    RAISE EXCEPTION 'cockpit_ceo_goal_sheet_context changed since the goals sheet round 3 read it (2026-11-02); stop and re-read it.'
      USING ERRCODE = '55000';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The goal sheet's context: 20261102m's body, with mediaDaily counting each Meta ad once a day

CREATE OR REPLACE FUNCTION public.cockpit_ceo_goal_sheet_context(p_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  who text; first_day date; last_day date; from_day date;
  p public.cockpit_goal_plans; growth jsonb; money jsonb; delivery jsonb;
  today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  ext jsonb; late jsonb; dep jsonb; missing jsonb := '[]'::jsonb;
  -- 2026-11-02 (round 2): the reads below. Each is NULL with a sentence in reads_missing when its
  -- store is not live or the read failed, so the old keys never fail because of a new one.
  cash jsonb; cash_out jsonb; wins jsonb; upsell_cash jsonb; upsell_contracted jsonb; refunds jsonb;
  eods jsonb; ext_days jsonb; software jsonb; reads_missing jsonb := '[]'::jsonb;
  -- 2026-11-02 (fix 11): growth's frontEndMonths for the tab's two months; NULL until it is published.
  fe_months jsonb;
  -- The wins ledger (20261102h) opened on 2 Nov 2026; a day before it was not recorded there.
  ledger_from constant date := DATE '2026-11-02';
  -- The billing log (cockpit_billing_events, 20260923a), the only source of cockpit_extensions_v, holds
  -- its first event on 23 Sep 2026 13:55 Kuwait; a grant before that day was not recorded there.
  ext_log_from constant date := DATE '2026-09-23';
  this_month date := date_trunc('month', today::timestamp)::date;
  read_from date; read_through date; lines_usd numeric; no_accept integer;
BEGIN
  who := public.cockpit_goal_actor();
  IF p_month IS NULL OR p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Choose a month like 2026-11' USING ERRCODE='22023';
  END IF;
  first_day := (p_month||'-01')::date;
  last_day := (first_day + interval '1 month - 1 day')::date;
  -- The rolling rows (the last 30 days) reach into the month before.
  from_day := (first_day - interval '1 month')::date;

  SELECT * INTO p FROM public.cockpit_goal_plans
    WHERE period_from = first_day AND period_to = last_day ORDER BY id DESC LIMIT 1;
  SELECT payload INTO growth FROM public.cockpit_sections WHERE key='growth' AND ok AND payload IS NOT NULL;
  SELECT payload INTO money FROM public.cockpit_sections WHERE key='money' AND ok AND payload IS NOT NULL;
  SELECT payload INTO delivery FROM public.cockpit_sections WHERE key='delivery' AND ok AND payload IS NOT NULL;

  -- The month's lifecycle, from the three records the CSM's acts write (WAVE12-CONTRACT 2.8, 4.11):
  -- extension grants (cockpit_extensions_v, billing events only), late spells (cockpit_late_payments_v,
  -- the daily card snapshots) and departures (the churn register with its confirm columns). Each row
  -- carries its source sentence. A record that is not there yet is NULL with a sentence in `missing`,
  -- never an empty list that reads as none.
  IF to_regclass('public.cockpit_extensions_v') IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'grantId', e.grant_id, 'taskId', e.clickup_task_id, 'client', e.client_name,
        'grantedOn', e.granted_on, 'weeks', e.weeks, 'from', e.from_date, 'until', e.until,
        'state', e.state, 'reason', e.reason, 'ours', e.ours, 'atRisk', e.at_risk,
        'seatRole', e.seat_role,
        'source', format('Given in the cockpit on %s%s; the grant %s.',
          to_char(e.granted_on, 'FMDD Mon'),
          -- The seat as the code (cockpit_billing_detail) or as the words (20261101p's acts and the view's fallback).
          CASE WHEN e.seat_role IN ('csm', 'the CSM') THEN ' by the CSM'
               WHEN e.seat_role = 'finance' THEN ' by finance'
               WHEN e.seat_role IN ('ceo', 'the CEO') THEN ' by the CEO'
               WHEN e.seat_role = 'the billing agent' THEN ' by the billing agent'
               ELSE '' END,
          CASE e.state WHEN 'live' THEN format('runs to %s', to_char(e.until, 'FMDD Mon'))
                       WHEN 'replaced' THEN 'was replaced by a longer one'
                       ELSE format('ended %s', to_char(e.until, 'FMDD Mon')) END))
        ORDER BY e.granted_on, e.grant_id), '[]'::jsonb)
      INTO ext
      FROM public.cockpit_extensions_v e
     WHERE e.granted_on BETWEEN first_day AND last_day;

    -- 2026-11-02 (fix 4): the same grants from the tab's from_day, by the day each was given, so the
    -- 14- and 30-day rows that cross into the month before count them (the November tab read 3 where
    -- the October tab read 4 for the same days). A new key: the lock-in keeps the month's list above.
    -- Read no earlier than the billing log's first day: before it a day with no grant is not known,
    -- not 0 (the October tab's from_day is 1 Sep; the September tab's would be all of August).
    BEGIN
      read_from := greatest(from_day, ext_log_from);
      read_through := least(last_day, today);
      SELECT jsonb_build_object(
          'from', CASE WHEN read_from <= read_through THEN read_from END,
          'through', CASE WHEN read_from <= read_through THEN read_through END,
          'logFrom', ext_log_from,
          'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('date', g.day, 'count', g.n, 'grants', g.grants) ORDER BY g.day)
            FROM (SELECT e.granted_on AS day, count(*)::int AS n,
                         jsonb_agg(jsonb_build_object('grantId', e.grant_id, 'client', e.client_name, 'weeks', e.weeks,
                                                      'state', e.state) ORDER BY e.grant_id) AS grants
                    FROM public.cockpit_extensions_v e
                   WHERE e.granted_on BETWEEN from_day AND last_day
                   GROUP BY e.granted_on) g), '[]'::jsonb),
          'source', 'Every extension grant in the billing log (cockpit_extensions_v, voids applied), by the day it was given, from the first of the month before. The billing log began on 23 Sep 2026; a day before it is not known.')
        INTO ext_days;
    EXCEPTION WHEN OTHERS THEN
      ext_days := NULL;
      reads_missing := reads_missing || jsonb_build_array(format('Extensions by day were not read (%s).', left(SQLERRM, 160)));
    END;
  ELSE
    missing := missing || jsonb_build_array('Extensions are not read: cockpit_extensions_v is not live yet (migration 20261101p).');
    reads_missing := reads_missing || jsonb_build_array('Extensions by day are not read: cockpit_extensions_v is not live yet (migration 20261101p).');
  END IF;

  IF to_regclass('public.cockpit_late_payments_v') IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'taskId', l.clickup_task_id, 'client', l.client_name, 'dueOn', l.due_on,
        'amountUsd', l.amount_usd, 'endedOn', l.ended_on, 'closedHow', l.closed_how,
        'paidOn', l.paid_on, 'daysLate', l.days_late,
        'source', format('The card''s next payment date in the daily snapshots: due %s, %s%s.',
          to_char(l.due_on, 'FMDD Mon'),
          CASE l.closed_how WHEN 'open' THEN format('still late, %s days', l.days_late)
                            WHEN 'extended' THEN 'an extension was given'
                            WHEN 'stopped' THEN 'the client stopped'
                            ELSE 'the date moved on the card' END,
          CASE WHEN l.paid_on IS NOT NULL THEN format('; paid %s on the rails', to_char(l.paid_on, 'FMDD Mon'))
               ELSE '; no payment on the rails' END))
        ORDER BY l.due_on, l.client_name), '[]'::jsonb)
      INTO late
      FROM public.cockpit_late_payments_v l
     WHERE l.due_on <= last_day AND coalesce(l.ended_on, today) >= first_day;
  ELSE
    missing := missing || jsonb_build_array('Late payments are not read: cockpit_late_payments_v is not live yet (migration 20261101p).');
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid = 'public.cockpit_churn_departures'::regclass
                AND a.attname = 'confirmed_at' AND NOT a.attisdropped) THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'departureId', d.id, 'taskId', d.clickup_task_id, 'client', d.client, 'leftOn', d.left_on,
        'reason', d.reason, 'churnType', d.churn_type, 'whyDetail', d.why_detail,
        'howToStop', d.how_to_stop, 'surveyState', d.survey_state, 'noticeOn', d.notice_on,
        'mrrLostUsd', d.mrr_lost_usd, 'confirmed', d.confirmed_at IS NOT NULL,
        'confirmedOn', ((d.confirmed_at AT TIME ZONE 'Asia/Kuwait')::date),
        'source', CASE WHEN d.confirmed_at IS NOT NULL
          THEN format('Confirmed in the cockpit on %s; left %s.',
                 to_char((d.confirmed_at AT TIME ZONE 'Asia/Kuwait')::date, 'FMDD Mon'), to_char(d.left_on, 'FMDD Mon'))
          ELSE format('Logged in the churn register, not confirmed; left %s.', to_char(d.left_on, 'FMDD Mon')) END)
        ORDER BY d.left_on, d.id), '[]'::jsonb)
      INTO dep
      FROM public.cockpit_churn_departures d
     WHERE d.removed_at IS NULL AND d.left_on BETWEEN first_day AND last_day;
  ELSE
    missing := missing || jsonb_build_array('Departures are read without their confirm: the churn confirm columns are not live yet (migration 20261101o).');
  END IF;

  -- Money in by day (cashDaily, the revenue the sheet shows). 2026-11-02 (fix 1): a payment the CEO
  -- left out of program money (cockpit_billing_payment_exclusions, live) that the money refresh
  -- credits to no client (side unattributed or not_client) is not revenue: his own 1 KWD Ecom test
  -- of 23 Oct. A payment left out on a client's deal is still that client's money and stays.
  IF to_regclass('public.cockpit_billing_payment_exclusions') IS NOT NULL THEN
    BEGIN
      SELECT coalesce(jsonb_agg(jsonb_build_object('date',x.day,'usd',x.usd)),'[]'::jsonb) INTO cash FROM (
          SELECT t->>'day' AS day, round(sum((t->>'usd')::numeric),2) AS usd
          FROM jsonb_array_elements(coalesce(money #> '{attribution,transactions}','[]'::jsonb)) t
          WHERE t->>'direction'='in' AND (t->>'day')::date BETWEEN from_day AND last_day
            -- Bank lines matched to nobody are a classification question, not client cash: the Money tab leaves them out too.
            AND NOT (t->>'side'='unattributed' AND t->>'rail'='bank')
            AND NOT (coalesce(t->>'side','') IN ('unattributed','not_client')
                     AND EXISTS (SELECT 1 FROM public.cockpit_billing_payment_exclusions x
                                  WHERE x.payment_id = t->>'id' AND x.withdrawn_at IS NULL))
          GROUP BY 1) x;
      SELECT coalesce(jsonb_agg(jsonb_build_object('date', t->>'day', 'id', t->>'id', 'rail', t->>'rail',
               'usd', round((t->>'usd')::numeric, 2), 'reason', x.reason, 'note', x.note)
               ORDER BY t->>'day', t->>'id'), '[]'::jsonb)
        INTO cash_out
        FROM jsonb_array_elements(coalesce(money #> '{attribution,transactions}','[]'::jsonb)) t
        JOIN public.cockpit_billing_payment_exclusions x ON x.payment_id = t->>'id' AND x.withdrawn_at IS NULL
       WHERE t->>'direction'='in' AND (t->>'day')::date BETWEEN from_day AND last_day
         AND coalesce(t->>'side','') IN ('unattributed','not_client');
    EXCEPTION WHEN OTHERS THEN
      cash := NULL; cash_out := NULL;
      reads_missing := reads_missing || jsonb_build_array(format('The CEO''s exclusions were not read (%s), so money in counts every payment.', left(SQLERRM, 160)));
    END;
  ELSE
    reads_missing := reads_missing || jsonb_build_array('The CEO''s exclusions are not read: cockpit_billing_payment_exclusions is not live (migration 20261024p), so money in counts every payment.');
  END IF;
  IF cash IS NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('date',x.day,'usd',x.usd)),'[]'::jsonb) INTO cash FROM (
        SELECT t->>'day' AS day, round(sum((t->>'usd')::numeric),2) AS usd
        FROM jsonb_array_elements(coalesce(money #> '{attribution,transactions}','[]'::jsonb)) t
        WHERE t->>'direction'='in' AND (t->>'day')::date BETWEEN from_day AND last_day
          -- Bank lines matched to nobody are a classification question, not client cash: the Money tab leaves them out too.
          AND NOT (t->>'side'='unattributed' AND t->>'rail'='bank')
        GROUP BY 1) x;
  END IF;

  -- 2026-11-02 (fix 5): the wins ledger instead of typed cells. One rule with the money refresh's wins
  -- read (money.js WINS_SQL): canary wins and the internal test card 86eywg1cq never count. A review,
  -- video testimonial or referral counts once logged (their only live stage), on its win date. An
  -- upsell counts once signed or paid (a quote is not a sale), on the day it was signed: its first
  -- accepted event (cockpit_win_event_day, cockpit_wins_v.accepted_on). Its won_on is the day it was
  -- offered and never moves (cockpit_csm_wins_guard), so an upsell offered on 27 Nov and signed on
  -- 2 Dec is December's, as money.upsells.accepted and the CSM list (upsellsAccepted) count it (4.8).
  -- Days before the ledger opened are not read.
  IF to_regclass('public.cockpit_csm_wins') IS NOT NULL THEN
    BEGIN
      read_from := greatest(from_day, ledger_from);
      read_through := least(last_day, today);
      SELECT jsonb_build_object(
          'from', CASE WHEN read_from <= read_through THEN read_from END,
          'through', CASE WHEN read_from <= read_through THEN read_through END,
          'ledgerFrom', ledger_from,
          'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('date', w.day, 'kind', w.kind, 'count', w.n) ORDER BY w.day, w.kind)
            FROM (SELECT d.day, c.kind, count(*)::int AS n
                    FROM public.cockpit_csm_wins c
                    CROSS JOIN LATERAL (SELECT CASE WHEN c.kind LIKE 'upsell\_%' THEN public.cockpit_win_event_day(c.id, 'accepted')
                                                    ELSE c.won_on END AS day) d
                   WHERE d.day BETWEEN from_day AND last_day
                     AND c.source <> 'canary' AND c.task_id <> '86eywg1cq'
                     AND CASE WHEN c.kind LIKE 'upsell\_%' THEN c.stage IN ('signed','paid') ELSE c.stage <> 'void' END
                   GROUP BY d.day, c.kind) w), '[]'::jsonb),
          'source', 'The wins ledger (cockpit_csm_wins): a review, video testimonial or referral on its win date, once logged with its proof; an upsell on the day it was signed, once signed or paid. Voided wins, canary wins and the test card never count. The ledger opened on 2 Nov 2026; a day before it is not known.')
        INTO wins;
      SELECT jsonb_build_object(
          'from', CASE WHEN read_from <= read_through THEN read_from END,
          'through', CASE WHEN read_from <= read_through THEN read_through END,
          'ledgerFrom', ledger_from,
          'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('date', u.day, 'usd', u.usd, 'count', u.n) ORDER BY u.day)
            FROM (SELECT d.day, round(sum(c.quoted_usd), 2) AS usd, count(*)::int AS n
                    FROM public.cockpit_csm_wins c
                    CROSS JOIN LATERAL (SELECT public.cockpit_win_event_day(c.id, 'accepted') AS day) d
                   WHERE d.day BETWEEN from_day AND last_day
                     AND c.source <> 'canary' AND c.task_id <> '86eywg1cq'
                     AND c.kind LIKE 'upsell\_%' AND c.stage IN ('signed','paid') AND c.quoted_usd IS NOT NULL
                   GROUP BY d.day) u), '[]'::jsonb),
          'source', 'Upsells signed or paid in the wins ledger at their quoted price (quoted_usd), by the day each was signed: the upsell part of Total contracted.')
        INTO upsell_contracted;
      -- Every signed or paid upsell has its accepted event (the only way to signed writes one); one
      -- without it is on no day, so it is said here rather than counted as nothing.
      SELECT count(*)::int INTO no_accept
        FROM public.cockpit_csm_wins c
       WHERE c.kind LIKE 'upsell\_%' AND c.stage IN ('signed','paid')
         AND c.source <> 'canary' AND c.task_id <> '86eywg1cq'
         AND public.cockpit_win_event_day(c.id, 'accepted') IS NULL;
      IF no_accept > 0 THEN
        reads_missing := reads_missing || jsonb_build_array(format(
          'Signed upsells with no signing day in the wins ledger: %s. No day counts them in upsells or Total contracted.', no_accept));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      wins := NULL; upsell_contracted := NULL;
      reads_missing := reads_missing || jsonb_build_array(format('The wins ledger was not read (%s), so wins and upsells contracted are not known.', left(SQLERRM, 160)));
    END;
  ELSE
    reads_missing := reads_missing || jsonb_build_array('The wins ledger is not read: cockpit_csm_wins is not live (migration 20261102h), so wins and upsells contracted are not known.');
  END IF;

  -- Upsell cash: each checked payment tied to an upsell win, on the day it was paid (the money
  -- refresh's rule, winGoalActuals). Per win this sums to cockpit_wins_v.tied_checked_usd. It is
  -- already inside back-end cash, so the sheet shows it and never adds it to revenue again.
  IF to_regclass('public.cockpit_wins_v') IS NOT NULL THEN
    BEGIN
      read_from := greatest(from_day, ledger_from);
      read_through := least(last_day, today);
      SELECT jsonb_build_object(
          'from', CASE WHEN read_from <= read_through THEN read_from END,
          'through', CASE WHEN read_from <= read_through THEN read_through END,
          'ledgerFrom', ledger_from,
          'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('date', c.day, 'usd', c.usd, 'payments', c.n) ORDER BY c.day)
            FROM (SELECT (t->>'paidOn')::date AS day, round(sum((t->>'usd')::numeric), 2) AS usd, count(*)::int AS n
                    FROM public.cockpit_wins_v v
                    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.ties) = 'array' THEN v.ties ELSE '[]'::jsonb END) t
                   WHERE v.kind LIKE 'upsell\_%' AND v.source <> 'canary' AND v.task_id <> '86eywg1cq'
                     AND t->'checked' = 'true'::jsonb AND jsonb_typeof(t->'usd') = 'number'
                     AND coalesce(t->>'paidOn', '') ~ '^\d{4}-\d{2}-\d{2}$'
                     AND (t->>'paidOn')::date BETWEEN from_day AND last_day
                   GROUP BY 1) c), '[]'::jsonb),
          'source', 'Checked payments tied to an upsell win in the wins ledger (cockpit_wins_v), by the day each was paid. Already inside back-end cash, never added to revenue again. The ledger opened on 2 Nov 2026; a day before it is not known.')
        INTO upsell_cash;
    EXCEPTION WHEN OTHERS THEN
      upsell_cash := NULL;
      reads_missing := reads_missing || jsonb_build_array(format('Upsell cash was not read (%s).', left(SQLERRM, 160)));
    END;
  ELSE
    reads_missing := reads_missing || jsonb_build_array('Upsell cash is not read: cockpit_wins_v is not live (migration 20261102h).');
  END IF;

  -- 2026-11-02 (fix 5): the refund count from the money refresh's rows instead of a typed cell. Whop
  -- refunds are already netted off the charge they refund; refunds logged by hand are not, so they
  -- are given apart (revenue subtracts only those). Read over the refresh's attribution window.
  IF jsonb_typeof(money #> '{attribution,transactions}') = 'array' THEN
    BEGIN
      read_from := CASE WHEN coalesce(money #>> '{attribution,from}', '') ~ '^\d{4}-\d{2}-\d{2}$'
                        THEN greatest(from_day, (money #>> '{attribution,from}')::date) END;
      read_through := CASE WHEN coalesce(money #>> '{attribution,to}', '') ~ '^\d{4}-\d{2}-\d{2}$'
                           THEN least(last_day, today, (money #>> '{attribution,to}')::date) END;
      SELECT jsonb_build_object(
          'from', CASE WHEN read_from <= read_through THEN read_from END,
          'through', CASE WHEN read_from <= read_through THEN read_through END,
          'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('date', r.day, 'count', r.n, 'usd', r.usd,
                    'whopCount', r.whop_n, 'whopUsd', r.whop_usd, 'manualCount', r.manual_n, 'manualUsd', r.manual_usd) ORDER BY r.day)
            FROM (SELECT t->>'day' AS day, count(*)::int AS n, round(sum((t->>'usd')::numeric), 2) AS usd,
                         (count(*) FILTER (WHERE t->>'rail' = 'whop'))::int AS whop_n,
                         coalesce(round(sum((t->>'usd')::numeric) FILTER (WHERE t->>'rail' = 'whop'), 2), 0) AS whop_usd,
                         (count(*) FILTER (WHERE t->>'rail' = 'manual'))::int AS manual_n,
                         coalesce(round(sum((t->>'usd')::numeric) FILTER (WHERE t->>'rail' = 'manual'), 2), 0) AS manual_usd
                    FROM jsonb_array_elements(money #> '{attribution,transactions}') t
                   WHERE t->>'direction' = 'out' AND t->>'kind' = 'refund'
                     AND (t->>'day')::date BETWEEN from_day AND last_day
                   GROUP BY 1) r), '[]'::jsonb),
          'source', 'Refunds in the money refresh''s rows, by the day of the refund: Whop refunds (already netted off the charge they refund) and refunds logged by hand (not netted, counted while they wait on a bank check).')
        INTO refunds;
    EXCEPTION WHEN OTHERS THEN
      refunds := NULL;
      reads_missing := reads_missing || jsonb_build_array(format('Refunds were not read (%s).', left(SQLERRM, 160)));
    END;
  ELSE
    reads_missing := reads_missing || jsonb_build_array('Refunds are not read: the money refresh has not published its rows.');
  END IF;

  -- 2026-11-02 (fix 10): offers made from the closer's EOD, the only system that records them. Filed
  -- EODs only (a draft has no submitted_at). A day with no EOD is not recorded, not zero; the CEO's
  -- own demos are on no EOD. offers is null on a day whose EODs carry no number.
  IF to_regclass('public.cockpit_sales_eods') IS NOT NULL THEN
    BEGIN
      SELECT jsonb_build_object(
          'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('date', e.day, 'offers', e.offers, 'eods', e.n) ORDER BY e.day)
            FROM (SELECT s.day, sum((s.answers->>'offers')::numeric) FILTER (WHERE jsonb_typeof(s.answers->'offers') = 'number') AS offers,
                         count(*)::int AS n
                    FROM public.cockpit_sales_eods s
                   WHERE s.role = 'closer' AND s.submitted_at IS NOT NULL AND s.day BETWEEN from_day AND last_day
                   GROUP BY s.day) e), '[]'::jsonb),
          'source', 'The closer''s end-of-day form (cockpit_sales_eods, offers), on the days one was filed. A day with no EOD is not recorded; the CEO''s own demos are on no EOD; an offer made on an intro call is counted, so offers can pass demos shown.')
        INTO eods;
    EXCEPTION WHEN OTHERS THEN
      eods := NULL;
      reads_missing := reads_missing || jsonb_build_array(format('The closer''s EODs were not read (%s).', left(SQLERRM, 160)));
    END;
  ELSE
    reads_missing := reads_missing || jsonb_build_array('The closer''s EODs are not read: cockpit_sales_eods is not live (migration 20260924o).');
  END IF;

  -- 2026-11-02 (fix 6): overhead per month. A past month reads its month point (cockpit_metric_days
  -- costs.software.monthly, dated the 1st, as money.book.projected is); today's lines are for the
  -- current month only, because the lines are repriced (1 Nov) and keep no history. A past month with
  -- no point is missing, never today's lines.
  BEGIN
    lines_usd := (SELECT round(sum(l.unit_price * coalesce(l.seats,1) / CASE WHEN l.billing='yearly' THEN 12 ELSE 1 END),2)
      FROM public.cockpit_cost_lines l WHERE l.kind='software' AND l.status='active' AND l.currency='USD');
    SELECT jsonb_agg(jsonb_build_object(
        'month', to_char(m.ms, 'YYYY-MM'),
        'usd', CASE WHEN m.ms = this_month THEN lines_usd
                    WHEN m.ms < this_month THEN round(pt.value::numeric, 2) END,
        'basis', CASE WHEN m.ms > this_month THEN 'not_started'
                      WHEN m.ms = this_month THEN 'lines'
                      WHEN pt.value IS NOT NULL THEN 'point'
                      ELSE 'missing' END,
        'capturedAt', CASE WHEN m.ms < this_month THEN pt.captured_at END,
        'source', CASE
          WHEN m.ms > this_month THEN format('%s has not started.', to_char(m.ms, 'FMMonth YYYY'))
          WHEN m.ms = this_month THEN 'Today''s active software lines on the Costs page at their monthly rate (yearly lines divided by 12, USD lines). What software runs at, not what was charged.'
          WHEN pt.value IS NOT NULL THEN format('What software ran at in %s: the Costs page''s lines as kept on %s (cockpit_metric_days costs.software.monthly). Not what was charged.',
            to_char(m.ms, 'FMMonth YYYY'), to_char((pt.captured_at AT TIME ZONE 'Asia/Kuwait')::date, 'FMDD Mon'))
          ELSE format('No month point was kept for %s, and today''s lines are not used for a past month.', to_char(m.ms, 'FMMonth YYYY')) END)
      ORDER BY m.ms)
      INTO software
      FROM (VALUES (from_day), (first_day)) AS m(ms)
      LEFT JOIN public.cockpit_metric_days pt
        ON pt.day = m.ms AND pt.metric = 'costs.software.monthly' AND pt.scope = 'company';
  EXCEPTION WHEN OTHERS THEN
    software := NULL;
    reads_missing := reads_missing || jsonb_build_array(format('Overhead by month was not read (%s).', left(SQLERRM, 160)));
  END;

  -- 2026-11-02 (fix 11): front-end cash by whole month, as the growth refresh publishes it (paid, and
  -- paidOnWindowDeals = paid in the month on deals signed in the same month), so the sheet has UF cash %
  -- on a month's own deals for any tab, not only the two windows below. Kept to the tab's month and the
  -- month before, the only months the sheet shows. Passed as published: the worker owns the rule. Before
  -- the CEO refresh release that publishes it the list is not there: NULL with a sentence. A started month
  -- the list lacks (the deal ledger was not read, or does not reach it) is said, never 0; a month that has
  -- not started is simply not there yet.
  IF growth IS NULL THEN
    reads_missing := reads_missing || jsonb_build_array('Front-end cash by month is not read: the growth refresh has no payload, so UF cash % on the month''s own deals is not known.');
  ELSIF jsonb_typeof(growth->'frontEndMonths') IS DISTINCT FROM 'array' THEN
    reads_missing := reads_missing || jsonb_build_array('Front-end cash by month is not read: the growth refresh does not publish frontEndMonths yet (the CEO refresh release of 2 Nov 2026), so UF cash % on the month''s own deals is not known.');
  ELSE
    SELECT coalesce(jsonb_agg(f ORDER BY f->>'month'), '[]'::jsonb) INTO fe_months
      FROM jsonb_array_elements(growth->'frontEndMonths') f
     WHERE f->>'month' IN (to_char(from_day, 'YYYY-MM'), p_month);
    SELECT reads_missing || coalesce(jsonb_agg(format(
             'Front-end cash for %s is not in the growth refresh''s months (the deal ledger was not read, or does not reach that month), so its UF cash %% is not known.',
             to_char(m.ms, 'FMMonth YYYY')) ORDER BY m.ms), '[]'::jsonb)
      INTO reads_missing
      FROM (VALUES (from_day), (first_day)) AS m(ms)
     WHERE m.ms <= this_month
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(fe_months) f WHERE f->>'month' = to_char(m.ms, 'YYYY-MM'));
  END IF;

  RETURN jsonb_build_object(
    'today', ((now() AT TIME ZONE 'Asia/Kuwait')::date)::text,
    'month', p_month,
    'plan', CASE WHEN p.id IS NULL THEN NULL ELSE to_jsonb(p) END,
    'plans', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'periodFrom',x.period_from,'periodTo',x.period_to,'title',x.title,'status',x.status) ORDER BY x.period_from),'[]'::jsonb)
      FROM public.cockpit_goal_plans x WHERE x.period_kind='month'),
    'targets', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.sort,t.id),'[]'::jsonb)
      FROM public.cockpit_goal_targets t WHERE t.plan_id = p.id),
    'metrics', (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.created_at),'[]'::jsonb)
      FROM public.cockpit_goal_sheet_metrics m WHERE m.archived_at IS NULL),
    'cells', (SELECT coalesce(jsonb_agg(jsonb_build_object('day',c.day,'key',c.metric_key,'kind',c.kind,'value',c.value,'note',c.note,'by',c.updated_by,'at',c.updated_at)),'[]'::jsonb)
      FROM public.cockpit_goal_sheet_cells c WHERE c.day BETWEEN from_day AND last_day),
    'growthDaily', (SELECT coalesce(jsonb_agg(d),'[]'::jsonb) FROM jsonb_array_elements(coalesce(growth->'daily','[]'::jsonb)) d
      WHERE (d->>'date')::date BETWEEN from_day AND last_day),
    -- 2026-11-02 (fix 11): each window also carries its frontEndCash whole (paidOnWindowDeals for
    -- UF cash %), null when the window has none; from and raw are as before.
    'windows', jsonb_build_array(
      jsonb_build_object('from', growth #>> '{windows,mtd,from}', 'raw', growth #> '{windows,mtd,raw}',
        'frontEndCash', growth #> '{windows,mtd,frontEndCash}'),
      jsonb_build_object('from', growth #>> '{windows,lastMonth,from}', 'raw', growth #> '{windows,lastMonth,raw}',
        'frontEndCash', growth #> '{windows,lastMonth,frontEndCash}')),
    'cashDaily', cash,
    'book', money->'book',
    'refundsMonthly', (SELECT coalesce(jsonb_agg(jsonb_build_object('month',m->>'month','refunds',m->'refunds')),'[]'::jsonb)
      FROM jsonb_array_elements(coalesce(money->'monthly','[]'::jsonb)) m),
    'bankThrough', money #>> '{bank,lastStatementTo}',
    'deliveryDaily', (SELECT coalesce(jsonb_agg(d),'[]'::jsonb) FROM jsonb_array_elements(coalesce(delivery->'daily','[]'::jsonb)) d
      WHERE (d->>'date')::date BETWEEN from_day AND last_day),
    'mediaDaily', (SELECT coalesce(jsonb_agg(jsonb_build_object('date',x.day,'spend',x.spend,'impressions',x.impressions,'clicks',x.clicks,'leads',x.leads)),'[]'::jsonb) FROM (
        SELECT s.day::text AS day, sum((s.data->>'spend')::numeric) AS spend, sum((s.data->>'impressions')::numeric) AS impressions,
          sum((s.data->>'linkClicks')::numeric) AS clicks, sum((s.data->>'leads')::numeric) AS leads
        -- 2026-11-02 (round 3): one row per Meta ad and day, the newest import, as the media client
        -- range reads the table (20261022x). The media publish never deletes a row and its grain holds
        -- the campaign name, so a renamed campaign repeats its ad-days under the old name (Shades' ad
        -- 120250793408950703 on 14-16 Oct: October CPM read $12.83, not $13.05). A row with no ad id is
        -- its own ad (source_id): nothing says it repeats another.
        FROM (SELECT DISTINCT ON (d.day, coalesce(nullif(d.data->>'metaAdId', ''), d.source_id)) d.day, d.data
                FROM public.cockpit_media_daily_stats d
               WHERE d.day BETWEEN from_day AND last_day
               ORDER BY d.day, coalesce(nullif(d.data->>'metaAdId', ''), d.source_id), d.imported_at DESC NULLS LAST, d.source_id DESC) s
        GROUP BY 1) x),
    'clientDaily', (SELECT coalesce(jsonb_agg(jsonb_build_object('date',x.day,'closes',x.closes,'qualitySum',x.q,'qualityCount',x.n)),'[]'::jsonb) FROM (
        SELECT d.day::text AS day, sum(d.closes) AS closes, sum(d.lead_quality_sum) AS q, sum(d.lead_quality_count) AS n
        FROM public.cockpit_client_days d WHERE d.day BETWEEN from_day AND last_day GROUP BY 1) x),
    'churned', (SELECT coalesce(jsonb_agg(jsonb_build_object('leftOn',d.left_on,'client',d.client,'reason',d.reason)),'[]'::jsonb)
      FROM public.cockpit_churn_departures d WHERE d.removed_at IS NULL AND d.left_on BETWEEN from_day AND last_day
        -- One rule with ceo-refresh and the CSM KPI (plan 3.5): the confirm's churn type decides
        -- (completed does not count); with no type yet, a finished-term reason is completed. Read
        -- through to_jsonb so the list still works before 20261101o adds the column.
        AND coalesce(to_jsonb(d)->>'churn_type', CASE WHEN d.reason = 'Completed term, did not renew' THEN 'completed' END)
            IS DISTINCT FROM 'completed'),
    'churnMonths', (SELECT coalesce(jsonb_agg(jsonb_build_object('month',m.month,'activeAtStart',m.active_at_start,'lostBefore',m.lost_before_register)),'[]'::jsonb)
      FROM public.cockpit_churn_months m WHERE m.month IN (p_month, to_char(from_day,'YYYY-MM'))),
    'softwareMonthly', (SELECT round(sum(l.unit_price * coalesce(l.seats,1) / CASE WHEN l.billing='yearly' THEN 12 ELSE 1 END),2)
      FROM public.cockpit_cost_lines l WHERE l.kind='software' AND l.status='active' AND l.currency='USD'),
    'lockin', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.section,r.sort,r.id),'[]'::jsonb)
      FROM public.cockpit_goal_lockin_rows r WHERE r.month = p_month),
    'locked', (SELECT to_jsonb(l) FROM public.cockpit_goal_lockin_months l WHERE l.month = p_month))
  || jsonb_build_object(
    'lifecycle', jsonb_build_object('extensions', ext, 'latePayments', late, 'departures', dep, 'missing', missing),
    -- Hand-logged money not yet checked against the bank (checked-money's rails.manualLogged): the lock-in's
    -- "Logged, not checked" line on Total new cash. NULL until the money refresh writes it.
    'manualLogged', money #> '{rails,manualLogged}')
  -- 2026-11-02 (round 2): the systems of record the sheet reads instead of typed cells.
  || jsonb_build_object(
    'cashExcluded', cash_out,
    'winsDaily', wins,
    'upsellCashDaily', upsell_cash,
    'upsellContracted', upsell_contracted,
    'refundsDaily', refunds,
    'salesEodDaily', eods,
    'extensionsDaily', ext_days,
    'softwareByMonth', software,
    'frontEndMonths', fe_months,
    'readsMissing', reads_missing);
END $$;

REVOKE ALL ON FUNCTION public.cockpit_ceo_goal_sheet_context(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_goal_sheet_context(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
