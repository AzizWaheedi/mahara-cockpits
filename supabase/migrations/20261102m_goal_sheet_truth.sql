-- Goals sheet round 2 (2026-11-02): every number from its system of record, read by the sheet.
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive. The audit is
-- hw-notes/goals-sheet/truth/SYNTHESIS.md (fixes 1, 4, 5, 6, 10); the CEO's words and the decisions
-- are hw-notes/goals-sheet/SPEC-ROUND2.md. Applies twice. The app ships separately: every key added
-- here is new, so a sheet that does not read it yet is unchanged.
--
-- 1. cockpit_ceo_goal_sheet_context(text) is replaced. Same gate (cockpit_goal_actor), SECURITY
--    DEFINER, search_path '', the same grants (EXECUTE for authenticated and service_role) and every
--    key it returned before, built the same way. Two old keys change, as asked:
--      cashDaily  (fix 1) leaves out money in that the CEO marked as not program money in
--                 cockpit_billing_payment_exclusions and that no client's deal or card holds
--                 (revenue = money in, and October's money in is $27,977.36 once his own 1 KWD test
--                 is out). A payment left out on a client's deal (Castello's website $1,500, 21 Aug)
--                 is still money that client paid us, so it stays.
--      windows    (fix 11, amended 2026-11-02 before any apply) each entry (mtd, lastMonth) gains
--                 frontEndCash, the growth window's whole object as published, beside from and raw,
--                 so the sheet reads paidOnWindowDeals (UF cash % = paidOnWindowDeals / contracted).
--                 Additive: from and raw are built as before; frontEndCash is null when the window
--                 has none.
--    lifecycle.extensions is NOT widened to from_day (the audit's Q:89 line): the live lock-in lists
--    every row of it as the month's grant, so October's grants would show on November's lock-in
--    until the app ships. The wider read is the new key extensionsDaily instead.
--    New keys (shapes in the contract below):
--      cashExcluded     what cashDaily left out, so the source line can say it.
--      winsDaily        the wins ledger by day and kind, with the days it was read (fix 5). A review,
--                       video testimonial or referral on its win date; an upsell on the day it was
--                       signed (its first accepted event), never won_on, which is the day it was
--                       offered (the ledger's rule 4.8, as money.upsells.accepted counts it).
--      upsellCashDaily  checked payments tied to an upsell win, by paid day (fix 5).
--      upsellContracted signed or paid upsells at their quoted price, by the day each was signed (fix 5).
--      refundsDaily     refunds in the money refresh's rows by day, Whop (netted) and by hand (not) (fix 5).
--      salesEodDaily    the closer's EOD: offers summed and EODs filed per day (fix 10).
--      extensionsDaily  extension grants from the tab's from_day, so the rolling rows that reach into
--                       the month before see them (fix 4), read no earlier than the billing log's first
--                       day (23 Sep 2026): a day before it is not known, never 0. lifecycle.extensions
--                       stays the tab's month only: the live lock-in lists every row of it as the
--                       month's grant.
--      softwareByMonth  overhead per month of the tab: the month point for a past month, today's
--                       lines for the current month only (fix 6).
--      frontEndMonths   (fix 11, amended 2026-11-02 before any apply) the growth refresh's
--                       frontEndMonths kept to the tab's month and the month before, so the sheet has
--                       UF cash % on a month's own deals for any month, not only the two windows. Null
--                       until the CEO refresh release that publishes it; a month the list lacks is
--                       not known, never 0.
--      readsMissing     a sentence for each new read that is not live or failed; never a silent 0.
-- 2. The October 2026 software point: cockpit_metric_days (2026-10-01, costs.software.monthly,
--    company) = 5324.74, the Costs page's lines as the October lock-in read them on 30 Oct (row 69,
--    "The Costs page's 44 active lines, at their monthly rate"). Written once, with an audit row; a
--    point already there (a later capture, or the CEO's own figure) is kept.
-- 3. The CEO's own 1 KWD Ecom test (INV_20261023ma6YMqMr, "Mahara payment test", 23 Oct 2026, $3.26)
--    is left out of client money: one cockpit_billing_payment_exclusions row (reason other) with an
--    audit row. No card or deal holds the payment, so the row's card and deal are 'none' (the
--    table's checks need a value; no billing read joins 'none', so Pending payments never shows it).
--    No billing event: the billing log is per card. Written once; a row for the payment, live or
--    withdrawn, means it was already written. Refused if the invoice is no longer that payment.
--
-- Contract (the app reads these; each is absent on an older server and null when its store is not
-- live, with a sentence in readsMissing):
--   cashExcluded:     [{date, id, rail, usd, reason, note}]
--   winsDaily:        {from, through, ledgerFrom, rows: [{date, kind, count}], source}
--   upsellCashDaily:  {from, through, ledgerFrom, rows: [{date, usd, payments}], source}
--   upsellContracted: {from, through, ledgerFrom, rows: [{date, usd, count}], source}
--   refundsDaily:     {from, through, rows: [{date, count, usd, whopCount, whopUsd, manualCount, manualUsd}], source}
--   salesEodDaily:    {rows: [{date, offers, eods}], source}
--   extensionsDaily:  {from, through, logFrom, rows: [{date, count, grants: [{grantId, client, weeks, state}]}], source}
--   softwareByMonth:  [{month, usd, basis: point|lines|missing|not_started, capturedAt, source}]
--   frontEndMonths:   [{month: 'YYYY-MM', paid, paidOnWindowDeals}] as growth publishes them, at most
--                     the month before and the tab's month, by month; [] when growth's list holds
--                     neither (an empty list means the deal ledger was not read). A started month not
--                     in it gets a readsMissing sentence; a month not started yet does not.
--   windows[i].frontEndCash: growth's windows.{mtd,lastMonth}.frontEndCash, whole (paid,
--                     paidOnWindowDeals, byRail, byCloser, ...), or null.
--   readsMissing:     [text]
-- from/through are the days of the tab's range (from_day to last_day, never after today, never before
-- the store began: ledgerFrom 2 Nov 2026 for the wins ledger, logFrom 23 Sep 2026 for the billing log)
-- the store was read; a day in that range with no row is 0, a day outside it is not known. Both are
-- null when no day was read (October for the wins ledger).
--
-- Rollback: ~/.cache/mahara-ship/rollback/cockpit_ceo_goal_sheet_context.before-20261102m_goal_sheet_truth.sql
-- (the live body, md5 5be4703416750ab41d8a6032916ed97f, and its grants). The exclusion row is
-- append-only: withdraw it, never delete it. Test: apps/media-buyer-cockpit/scripts/goal-sheet-truth-supabase.test.ts.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard: the live body read on 2026-11-02 (20261101q's), or this file's own on a second
--    apply. Anything else was changed since and must be re-read first. 2026-11-02: this file's own
--    hash is the amended body's (frontEndMonths and the windows' frontEndCash); the draft before it
--    was applied nowhere (no 20261102m in schema_migrations, live md5 still 20261101q's), so its hash
--    is not accepted.

DO $$
DECLARE v text;
BEGIN
  SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.cockpit_ceo_goal_sheet_context(text)'::regprocedure;
  IF v IS DISTINCT FROM '5be4703416750ab41d8a6032916ed97f' AND v IS DISTINCT FROM '9317c8f0c73e1c7dc989c92055abc175' THEN
    RAISE EXCEPTION 'cockpit_ceo_goal_sheet_context changed since the goals sheet round 2 read it (2026-11-02); stop and re-read it.'
      USING ERRCODE = '55000';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The goal sheet's context, reading each number's system of record

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
        FROM public.cockpit_media_daily_stats s WHERE s.day BETWEEN from_day AND last_day GROUP BY 1) x),
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

-- ---------------------------------------------------------------------------
-- 2. October 2026's software point (fix 6): $5,324.74, the Costs page's lines as the October lock-in
--    read them on 30 Oct 2026 at 20:53 Kuwait (cockpit_goal_lockin_rows 69). Today's lines read
--    $5,057.71 because they were repriced on 1 Nov. Written once, with its audit row; a point already
--    there is kept (a later capture or the CEO's own figure wins).

DO $software$
DECLARE
  v_day constant date := DATE '2026-10-01';
  v_metric constant text := 'costs.software.monthly';
  v_old record;
  v_new record;
BEGIN
  SELECT d.day, d.metric, d.scope, d.value, d.captured_at INTO v_old
    FROM public.cockpit_metric_days d WHERE d.day = v_day AND d.metric = v_metric AND d.scope = 'company';
  IF FOUND THEN
    RAISE NOTICE '20261102m: % for October 2026 already holds %; the backfill writes nothing.', v_metric, v_old.value;
    RETURN;
  END IF;
  INSERT INTO public.cockpit_metric_days(day, metric, scope, value, captured_at)
  VALUES (v_day, v_metric, 'company', 5324.74, TIMESTAMPTZ '2026-10-30 20:53:17.864635+03')
  RETURNING day, metric, scope, value, captured_at INTO v_new;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('metric.backfill', 'cockpit_metric_days', format('%s|%s|company', v_day, v_metric), 'migration 20261102m', 'ceo', 'supabase',
          NULL, to_jsonb(v_new),
          jsonb_build_object('run_by', 'migration 20261102m',
            'why', 'Past months read their software point, not today''s lines (goals sheet round 2, fix 6, 2026-11-02).',
            'from', 'The October lock-in''s Software expenses line (cockpit_goal_lockin_rows 69, 30 Oct 2026 20:53 Kuwait): the Costs page''s 44 active lines at their monthly rate.',
            'todays_lines_usd', 5057.71));
END
$software$;

-- ---------------------------------------------------------------------------
-- 3. The CEO's own 1 KWD Ecom test (fix 1): out of client money. One row, written once.

DO $exclude$
DECLARE
  v_pid  constant text := 'ecom:INV_20261023ma6YMqMr';
  v_note constant text := 'The CEO''s own 1 KWD Ecom test ("Mahara payment test", 23 Oct 2026, $3.26): not client money and not revenue. Held by no card or deal, hence none. Left out on the goals sheet audit''s default (round 2, fix 1, 2 Nov 2026).';
  v_inv record;
  -- jsonb, not the table's row type: a database without the table must still compile this block.
  v_id bigint;
  v_after jsonb;
BEGIN
  IF to_regclass('public.cockpit_billing_payment_exclusions') IS NULL THEN
    RAISE NOTICE '20261102m: cockpit_billing_payment_exclusions is not in this database; the exclusion writes nothing.';
    RETURN;
  END IF;
  -- Written once: a row for this payment, live or withdrawn since, means it was.
  IF EXISTS (SELECT 1 FROM public.cockpit_billing_payment_exclusions x WHERE x.payment_id = v_pid) THEN
    RAISE NOTICE '20261102m: % already has an exclusion row; the exclusion writes nothing.', v_pid;
    RETURN;
  END IF;
  IF to_regclass('public.cockpit_ecom_invoices') IS NULL THEN
    RAISE NOTICE '20261102m: cockpit_ecom_invoices is not in this database; the exclusion writes nothing.';
    RETURN;
  END IF;
  SELECT i.id, i.status, i.amount_kwd, i.usd, i.day INTO v_inv
    FROM public.cockpit_ecom_invoices i WHERE i.id = 'INV_20261023ma6YMqMr';
  IF NOT FOUND THEN
    RAISE NOTICE '20261102m: the Ecom invoice INV_20261023ma6YMqMr is not in this database; the exclusion writes nothing.';
    RETURN;
  END IF;
  IF v_inv.status IS DISTINCT FROM 'PAID' OR v_inv.amount_kwd IS DISTINCT FROM 1.000 OR v_inv.usd IS DISTINCT FROM 3.26
     OR v_inv.day IS DISTINCT FROM DATE '2026-10-23' THEN
    RAISE EXCEPTION '20261102m: INV_20261023ma6YMqMr is no longer the paid 1 KWD ($3.26) test of 23 Oct; read it again before applying.'
      USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.cockpit_billing_payment_exclusions AS x(payment_id, clickup_task_id, deal_response_id, reason, note, set_by, event_id)
  VALUES (v_pid, 'none', 'none', 'other', v_note, 'migration 20261102m', NULL)
  RETURNING x.id, to_jsonb(x) INTO v_id, v_after;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('billing.exclude', 'cockpit_billing_payment_exclusions', v_id::text, 'migration 20261102m', 'ceo', 'supabase', NULL, v_after,
          jsonb_build_object('payment_id', v_pid, 'usd', v_inv.usd, 'amount_kwd', v_inv.amount_kwd, 'day', v_inv.day, 'rail', 'ecom',
                             'run_by', 'migration 20261102m',
                             'instruction', 'Goals sheet round 2, fix 1 (truth/SYNTHESIS.md): revenue is every client dollar in; the CEO''s own test is out. The audit''s default under the CEO''s standing rule, 2 Nov 2026.'));
END
$exclude$;

NOTIFY pgrst, 'reload schema';
COMMIT;
