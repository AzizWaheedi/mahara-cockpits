-- A churned client's ad account in the Meta ad-days notes (the CEO, 23 Oct 2026, cost per
-- booking decisions, 5: "triple edge is a old churned client"). Contract:
-- docs/client-performance/CPB-DECISIONS-20261023.md 1.5 and 3.6. Creative Triage
-- bldgtotkfmhoxmlzowdx.
--
-- An account with no live tie that public.cockpit_churned_ad_accounts (20261023q) lists is named
-- as a churned client's, never "Not linked to a client":
--   cockpit_meta_ad_days_finish: the run note's "Not linked" list leaves it out, and the line
--     "Spent for a cancelled, stopped or churned client: ..." (was "a cancelled or stopped
--     client") names it as "<account> (<id>, <client> is Churned, <currency> <spend>)".
--   cockpit_meta_ad_days_inputs: notLinked leaves it out.
--   cockpit_meta_ad_days_status: each account with no tie takes clientName and clientStatus
--     'Churned' from the list; notLinked leaves it out; cancelledDelivering also takes a churned
--     account with spend in the last two days; billingStopped stays linked accounts only.
-- A live tie (a board row or a GoHighLevel tie, through cockpit_meta_ad_days_ties) always wins,
-- and a hidden account (clients.hidden_from_dashboard, through cockpit_meta_ad_days_hidden) is
-- dropped before the list is read: it is named under "Hidden on purpose" alone, never Churned.
-- Not touched: cockpit_meta_ad_days_ties, _hidden, _begin, cockpit_meta_ad_days_apply and
-- cockpit_meta_feed_run, which decide which accounts the dashboard feed writes (changing them
-- could drop the account's spend silently). supabase/functions/meta-ad-days/run.ts is unchanged:
-- its doctor names the account through cancelledDelivering. On 23 Oct the hourly note read "Not
-- linked to a client: Triple Edge Building Construction (2002793296961811, USD 2.09)"; it then
-- reads "Spent for a cancelled, stopped or churned client: ..., Triple Edge Building
-- Construction (2002793296961811, Triple Edge Building Construction is Churned, USD ...)".
--
-- Each body is the live one (prosrc md5: finish 4eaec242a7c5f6eef2b648679cfeacdb, inputs
-- 41434eea3236bf3c00450bdca0574b69, status 83f802620ce19710e8f73bd9d8747cc1, the bodies of
-- 20261017100000) with those edits. The file refuses, and changes nothing, if 20261023q is not
-- applied or any live body is neither that one nor this file's (finish
-- 8b3a044931517e3d991ce6958ad979f5, inputs 2f7386ba5e5a980f7af5abd6193f4071, status
-- 398d86c9f4bdf9ca9d0db2a3505d40a1). Owner, definer and grants are kept and restated: finish for the
-- owner only; inputs and status for the service role. Safe to run twice.
-- Test: apps/media-buyer-cockpit/scripts/churned-ad-accounts-supabase.test.ts and
-- scripts/meta-ad-days-supabase.test.ts.
-- Rollback: ~/.cache/mahara-ship/rollback/cockpit_meta_ad_days_finish.before-20261023u_meta_ad_days_churned.sql,
-- cockpit_meta_ad_days_inputs.before-20261023u_meta_ad_days_churned.sql and
-- cockpit_meta_ad_days_status.before-20261023u_meta_ad_days_churned.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('public.cockpit_churned_ad_accounts') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261023q_churned_ad_accounts.sql first';
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_meta_ad_days_finish(uuid)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('4eaec242a7c5f6eef2b648679cfeacdb', '8b3a044931517e3d991ce6958ad979f5') THEN
    RAISE EXCEPTION 'cockpit_meta_ad_days_finish is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_meta_ad_days_inputs(jsonb)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('41434eea3236bf3c00450bdca0574b69', '2f7386ba5e5a980f7af5abd6193f4071') THEN
    RAISE EXCEPTION 'cockpit_meta_ad_days_inputs is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_meta_ad_days_status()');
  IF v_md5 IS NULL OR v_md5 NOT IN ('83f802620ce19710e8f73bd9d8747cc1', '398d86c9f4bdf9ca9d0db2a3505d40a1') THEN
    RAISE EXCEPTION 'cockpit_meta_ad_days_status is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_finish(p_run uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE
  r public.cockpit_meta_ad_day_runs; v_open int; v_done int; v_failed int; v_rows int; v_changed int; v_accounts int;
  v_state text; v_note text; v_failing text; v_not_linked text; v_no_rate text; v_reach int; v_clients int := 0;
  v_hidden text; v_gone text; v_leadids int; v_lead_notes text; v_days_failed int;
  v_bud_total int; v_bud_done int; v_bud_failing text; v_hist_total int; v_hist_done int; v_hist_notes text; v_hist_failing text;
  v_unlisted text; v_bud_rate text; v_core_done int; v_core_failed int;
BEGIN
  SELECT * INTO r FROM public.cockpit_meta_ad_day_runs WHERE id = p_run FOR UPDATE;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  IF r.state <> 'running' THEN RETURN r.state; END IF;
  SELECT count(*) FILTER (WHERE state IN ('pending','running')), count(*) FILTER (WHERE state = 'done'), count(*) FILTER (WHERE state = 'failed'),
         coalesce(sum(rows_read) FILTER (WHERE kind = 'days' AND state = 'done'), 0), coalesce(sum(changed) FILTER (WHERE kind = 'days' AND state = 'done'), 0),
         count(DISTINCT account_id), count(*) FILTER (WHERE kind IN ('reach_account','reach_all') AND state = 'done'),
         count(*) FILTER (WHERE kind = 'lead_ids' AND state = 'done'),
         string_agg(coalesce(account_name, account_id) || ': ' || note, '; ' ORDER BY account_id) FILTER (WHERE kind = 'lead_ids' AND note IS NOT NULL),
         count(DISTINCT account_id) FILTER (WHERE kind = 'days' AND state = 'failed'),
         count(*) FILTER (WHERE kind = 'budgets'), count(*) FILTER (WHERE kind = 'budgets' AND state = 'done'),
         count(*) FILTER (WHERE kind = 'activities'), count(*) FILTER (WHERE kind = 'activities' AND state = 'done'),
         string_agg(coalesce(account_name, account_id) || ': ' || rtrim(note, '. '), '; ' ORDER BY account_id) FILTER (WHERE kind = 'activities' AND state = 'done' AND note IS NOT NULL),
         count(*) FILTER (WHERE kind NOT IN ('budgets','activities') AND state = 'done'),
         count(*) FILTER (WHERE kind NOT IN ('budgets','activities') AND state = 'failed')
    INTO v_open, v_done, v_failed, v_rows, v_changed, v_accounts, v_reach, v_leadids, v_lead_notes, v_days_failed,
         v_bud_total, v_bud_done, v_hist_total, v_hist_done, v_hist_notes, v_core_done, v_core_failed
  FROM public.cockpit_meta_ad_day_tasks WHERE run_id = p_run;
  IF v_open > 0 THEN RETURN 'running'; END IF;
  -- The run's state is the ad numbers' (days, reach, lead ids); budgets and their history are said apart.
  v_state := CASE WHEN v_core_failed = 0 THEN 'ok' WHEN v_core_done = 0 THEN 'failed' ELSE 'partial' END;

  -- The day reads that finished: their days' spend is known, kept after the tasks are gone.
  INSERT INTO public.cockpit_meta_spend_reads AS x (account_id, source, since, until, read_at, run_id)
  SELECT t.account_id, 'days', t.since, t.until, max(t.updated_at), p_run
  FROM public.cockpit_meta_ad_day_tasks t
  WHERE t.run_id = p_run AND t.kind = 'days' AND t.state = 'done' AND t.since IS NOT NULL AND t.until IS NOT NULL
  GROUP BY t.account_id, t.since, t.until
  ON CONFLICT (account_id, source, since, until) DO UPDATE SET read_at = greatest(x.read_at, EXCLUDED.read_at),
    run_id = CASE WHEN EXCLUDED.read_at >= x.read_at THEN EXCLUDED.run_id ELSE x.run_id END;

  -- Reads that failed, per account: ad-days, reach and lead ids here; budgets and their history apart.
  SELECT string_agg(coalesce(f.account_name, f.account_id) || ' (' || f.account_id || '): ' || coalesce(f.error, 'not read'), '; ' ORDER BY f.account_id)
    INTO v_failing
  FROM (SELECT DISTINCT ON (t.account_id) t.account_id, t.account_name, t.error FROM public.cockpit_meta_ad_day_tasks t
        WHERE t.run_id = p_run AND t.state = 'failed' AND t.kind NOT IN ('budgets','activities') ORDER BY t.account_id, t.id) f;
  -- The error's own full stop is dropped: the line ends with one.
  SELECT string_agg(coalesce(t.account_name, t.account_id) || ' (' || t.account_id || '): ' || rtrim(coalesce(t.error, 'not read'), '. '), '; ' ORDER BY t.account_id)
    INTO v_bud_failing
  FROM public.cockpit_meta_ad_day_tasks t WHERE t.run_id = p_run AND t.kind = 'budgets' AND t.state = 'failed';
  SELECT string_agg(coalesce(t.account_name, t.account_id) || ' (' || t.account_id || '): ' || rtrim(coalesce(t.error, 'not read'), '. '), '; ' ORDER BY t.account_id)
    INTO v_hist_failing
  FROM public.cockpit_meta_ad_day_tasks t WHERE t.run_id = p_run AND t.kind = 'activities' AND t.state = 'failed';
  SELECT string_agg(coalesce(u->>'clientName', '?') || ' (' || (u->>'accountId') || ')', ', ' ORDER BY u->>'accountId')
    INTO v_unlisted
  FROM jsonb_array_elements(coalesce(r.detail->'budgetUnlisted', '[]'::jsonb)) u;
  SELECT string_agg(DISTINCT coalesce(t.account_currency, 'no currency') || ' on ' || coalesce(t.account_name, t.account_id), ', ')
    INTO v_bud_rate
  FROM public.cockpit_meta_ad_day_tasks t
  WHERE t.run_id = p_run AND t.kind = 'budgets' AND t.state = 'done' AND public.cockpit_meta_ad_days_usd_per(t.account_currency) IS NULL;
  SELECT string_agg(coalesce(a->>'name', a->>'accountId') || ' (' || (a->>'accountId') || ', ' || coalesce(a->>'currency','?') || ' ' || coalesce(a->>'spend','?') || ')', ', ' ORDER BY a->>'accountId')
    INTO v_not_linked
  FROM jsonb_array_elements(r.accounts) a WHERE (a->>'linked')::boolean IS NOT TRUE AND (a->>'hidden')::boolean IS NOT TRUE
    -- A churned client's account is named with the cancelled and stopped ones below (20261023u).
    AND NOT EXISTS (SELECT 1 FROM public.cockpit_churned_ad_accounts f WHERE f.account_id = a->>'accountId');
  -- Hidden on purpose (a hidden clients row, Mahara's own Mass Design account):
  -- named apart, not as "not linked".
  SELECT string_agg(coalesce(a->>'name', a->>'accountId') || ' (' || (a->>'accountId') || ', ' || coalesce(a->>'currency','?') || ' ' || coalesce(a->>'spend','?') || ')', ', ' ORDER BY a->>'accountId')
    INTO v_hidden
  FROM jsonb_array_elements(r.accounts) a WHERE (a->>'linked')::boolean IS NOT TRUE AND (a->>'hidden')::boolean IS TRUE;
  -- Spending for a client that is cancelled, stopped or churned (an account no live tie holds
  -- that cockpit_churned_ad_accounts lists, 20261023u). A hidden account is dropped before the
  -- list is read (contract 1.5, 3): it stays under "Hidden on purpose" alone.
  SELECT string_agg(coalesce(a->>'name', a->>'accountId') || ' (' || (a->>'accountId') || ', ' || coalesce(ch.client_name, a->>'clientName', '?') || ' is '
           || coalesce(ch.status, a->>'clientStatus', '?') || ', ' || coalesce(a->>'currency','?') || ' ' || coalesce(a->>'spend','?') || ')', ', ' ORDER BY a->>'accountId')
    INTO v_gone
  FROM jsonb_array_elements(r.accounts) a
  LEFT JOIN public.cockpit_churned_ad_accounts ch ON ch.account_id = a->>'accountId' AND (a->>'linked')::boolean IS NOT TRUE
    AND (a->>'hidden')::boolean IS NOT TRUE
  WHERE ((a->>'linked')::boolean IS TRUE AND a->>'clientStatus' IN ('Cancelled', 'Stopped', 'Removed from sheet'))
     OR ch.account_id IS NOT NULL;
  SELECT string_agg(DISTINCT coalesce(a->>'currency','no currency') || ' on ' || coalesce(a->>'name', a->>'accountId'), ', ')
    INTO v_no_rate
  FROM jsonb_array_elements(r.accounts) a WHERE public.cockpit_meta_ad_days_usd_per(a->>'currency') IS NULL;

  v_note := left(concat_ws(' ',
    CASE WHEN jsonb_array_length(r.accounts) = 0 AND v_bud_total + v_hist_total = 0 THEN 'No ad account of the business spent in the window; nothing to read.'
         WHEN jsonb_array_length(r.accounts) = 0 THEN 'No ad account of the business spent in the window.'
         ELSE 'Read ' || (jsonb_array_length(r.accounts) - v_days_failed) || ' of ' || jsonb_array_length(r.accounts) || ' ad accounts: '
              || v_rows || ' ad-days written, ' || v_changed || ' new or changed.' END,
    CASE WHEN v_reach > 0 THEN 'Reach read for ' || v_reach || ' accounts.' END,
    CASE WHEN v_leadids > 0 THEN 'Lead ids read for ' || v_leadids || CASE WHEN v_leadids = 1 THEN ' account' ELSE ' accounts' END
      || coalesce(' (' || v_lead_notes || ')', '') || '.' END,
    CASE WHEN v_failing IS NOT NULL THEN 'Could not read ' || v_failing || '.' END,
    CASE WHEN v_bud_total > 0 THEN 'Budgets read for ' || v_bud_done || CASE WHEN v_bud_done = 1 THEN ' account' ELSE ' accounts' END
      || coalesce('; not read for ' || v_bud_failing, '') || '.' END,
    CASE WHEN v_bud_rate IS NOT NULL THEN 'No USD rate for ' || v_bud_rate || ', so its daily_budget_usd is empty.' END,
    CASE WHEN v_unlisted IS NOT NULL THEN 'Tied to an Active client but not listed under Mahara''s business, so no budget could be read: ' || v_unlisted || '.' END,
    CASE WHEN v_hist_total > 0 THEN 'Budget history read for ' || v_hist_done || CASE WHEN v_hist_done = 1 THEN ' account' ELSE ' accounts' END
      || coalesce(' (' || v_hist_notes || ')', '') || coalesce('; not read for ' || v_hist_failing, '') || '.' END,
    CASE WHEN r.detail->>'tieSource' = 'board_clients' AND v_gone IS NOT NULL THEN 'Spent for a cancelled, stopped or churned client: ' || v_gone || '.' END,
    CASE WHEN r.detail->>'tieSource' = 'board_clients' AND v_hidden IS NOT NULL THEN 'Hidden on purpose: ' || v_hidden || '.' END,
    CASE WHEN r.detail->>'tieSource' = 'board_clients' AND v_not_linked IS NOT NULL THEN 'Not linked to a client: ' || v_not_linked || '.'
         WHEN r.detail->>'tieSource' IN ('missing','empty') AND jsonb_array_length(r.accounts) > 0
           THEN 'No account is tied to a client yet (cockpit_board_clients is ' || CASE WHEN r.detail->>'tieSource' = 'missing' THEN 'missing' ELSE 'empty' END || '); reach is kept at account level.' END,
    CASE WHEN v_no_rate IS NOT NULL THEN 'No USD rate for ' || v_no_rate || ', so its spend_usd is empty.' END), 2000);

  IF v_reach > 0 THEN
    IF r.job = 'nightly' THEN
      -- Rows of windows that have moved on are no longer last_7 and its kin. The nightly run re-read every
      -- account that delivered in any of today's windows, so an account row still on an earlier day had no
      -- delivery in that window (or its read failed, which the rebuild names); dropped before the rebuild.
      DELETE FROM public.cockpit_meta_reach x WHERE x.level <> 'client'
        AND NOT EXISTS (SELECT 1 FROM public.cockpit_meta_reach_windows(public.cockpit_meta_ad_days_today()) w
                        WHERE w.window_key = x.window_key AND w.from_day = x.from_day AND w.to_day = x.to_day);
    END IF;
    v_clients := public.cockpit_meta_reach_rebuild_clients();
  END IF;

  UPDATE public.cockpit_meta_ad_day_runs SET state = v_state, finished_at = pg_catalog.now(), note = v_note,
    tasks_done = v_done, tasks_failed = v_failed, rows_written = v_rows, rows_changed = v_changed,
    detail = detail || jsonb_build_object('clientReachRows', v_clients, 'budgetsRead', v_bud_done, 'budgetsFailed', v_bud_total - v_bud_done,
      'historyRead', v_hist_done, 'historyFailed', v_hist_total - v_hist_done)
  WHERE id = p_run;

  INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, rows_seen, detail, updated_at)
  VALUES ('meta-ad-days-' || r.job, pg_catalog.now(), CASE WHEN v_state = 'ok' THEN pg_catalog.now() END, v_state = 'ok', v_note, v_rows,
    jsonb_build_object('runId', p_run, 'state', v_state, 'accounts', jsonb_array_length(r.accounts), 'tasksDone', v_done, 'tasksFailed', v_failed,
      'changed', v_changed, 'from', r.window_from, 'to', r.window_to, 'tieSource', r.detail->>'tieSource',
      'budgetsRead', v_bud_done, 'budgetsFailed', v_bud_total - v_bud_done, 'historyRead', v_hist_done, 'historyFailed', v_hist_total - v_hist_done),
    pg_catalog.now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = pg_catalog.now(),
    last_ok_at = CASE WHEN v_state = 'ok' THEN pg_catalog.now() ELSE public.cockpit_sync_state.last_ok_at END,
    ok = EXCLUDED.ok, note = EXCLUDED.note, rows_seen = EXCLUDED.rows_seen, detail = EXCLUDED.detail, updated_at = pg_catalog.now();

  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, "before", "after")
  VALUES ('meta_ad_days.run', 'meta_ad_day_run', p_run::text,
    CASE WHEN r.requested_by ~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN r.requested_by ELSE 'meta-ad-days' END, 'board', 'meta-ad-days', NULL,
    jsonb_build_object('job', r.job, 'state', v_state, 'accounts', jsonb_array_length(r.accounts), 'tasksDone', v_done, 'tasksFailed', v_failed,
      'rowsWritten', v_rows, 'rowsChanged', v_changed, 'reachAccounts', v_reach, 'clientReachRows', v_clients,
      'budgetsRead', v_bud_done, 'budgetsFailed', v_bud_total - v_bud_done, 'historyRead', v_hist_done, 'historyFailed', v_hist_total - v_hist_done,
      'from', r.window_from, 'to', r.window_to));

  DELETE FROM public.cockpit_meta_ad_day_receipts WHERE created_at < pg_catalog.now() - interval '30 days';
  DELETE FROM public.cockpit_meta_ad_day_tasks t USING public.cockpit_meta_ad_day_runs x
    WHERE t.run_id = x.id AND x.state <> 'running' AND x.finished_at < pg_catalog.now() - interval '14 days';
  DELETE FROM public.cockpit_meta_ad_day_runs WHERE state <> 'running' AND finished_at < pg_catalog.now() - interval '90 days';
  DELETE FROM public.cockpit_meta_budget_days WHERE day < public.cockpit_meta_ad_days_today() - 400;
  DELETE FROM public.cockpit_meta_budget_account_days WHERE day < public.cockpit_meta_ad_days_today() - 400;
  DELETE FROM public.cockpit_meta_spend_reads WHERE until < public.cockpit_meta_ad_days_today() - 400;
  RETURN v_state;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_inputs(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE v_ties jsonb; v_today date := public.cockpit_meta_ad_days_today(); v_hidden jsonb; v_accounts jsonb;
BEGIN
  PERFORM public.cockpit_meta_ad_days_require_service();
  v_ties := public.cockpit_meta_ad_days_ties();
  v_hidden := public.cockpit_meta_ad_days_hidden();
  -- p.accounts [{accountId, name, currency, spend}], or p.accountIds [ids]: the
  -- doctor and the dry run sent only ids before 2026-10-16, so their "Not
  -- linked" list was always empty.
  v_accounts := CASE WHEN jsonb_typeof(p->'accounts') = 'array' THEN p->'accounts'
                     WHEN jsonb_typeof(p->'accountIds') = 'array'
                       THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('accountId', x.v)), '[]'::jsonb) FROM jsonb_array_elements_text(p->'accountIds') x(v))
                     ELSE '[]'::jsonb END;
  RETURN jsonb_build_object(
    'today', to_char(v_today,'YYYY-MM-DD'),
    'windows', public.cockpit_meta_reach_windows_json(v_today),
    'ties', jsonb_build_object('source', v_ties->>'source', 'clients', (v_ties->>'clients')::int, 'shared', (v_ties->>'shared')::int,
              'linked', (SELECT count(*) FROM jsonb_array_elements(v_accounts) a WHERE (v_ties->'accounts') ? (a->>'accountId'))),
    'notLinked', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', a->>'accountId', 'name', a->>'name', 'currency', a->>'currency', 'spend', a->'spend')
                                   ORDER BY a->>'accountId')
                           FROM jsonb_array_elements(v_accounts) a
                           WHERE v_ties->>'source' = 'board_clients' AND NOT ((v_ties->'accounts') ? (a->>'accountId'))
                             AND NOT public.cockpit_meta_ad_days_is_hidden(v_hidden, a->>'accountId', a->>'name')
                             -- A churned client's account is named as one, never "not linked" (20261023u).
                             AND NOT EXISTS (SELECT 1 FROM public.cockpit_churned_ad_accounts f WHERE f.account_id = a->>'accountId')), '[]'::jsonb),
    'hidden', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', a->>'accountId', 'name', a->>'name') ORDER BY a->>'accountId')
                        FROM jsonb_array_elements(v_accounts) a
                        WHERE NOT ((v_ties->'accounts') ? (a->>'accountId'))
                          AND public.cockpit_meta_ad_days_is_hidden(v_hidden, a->>'accountId', a->>'name')), '[]'::jsonb),
    'cancelled', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', a->>'accountId', 'name', a->>'name',
                             'clientName', v_ties->'accounts'->(a->>'accountId')->>'clientName',
                             'status', v_ties->'accounts'->(a->>'accountId')->>'status') ORDER BY a->>'accountId')
                           FROM jsonb_array_elements(v_accounts) a
                           WHERE v_ties->'accounts'->(a->>'accountId')->>'status' IN ('Cancelled', 'Stopped', 'Removed from sheet')), '[]'::jsonb),
    'activeAccounts', coalesce((SELECT jsonb_agg(e.key ORDER BY e.key) FROM jsonb_each(coalesce(v_ties->'accounts', '{}'::jsonb)) e
                                WHERE e.value->>'status' = 'Active' AND NOT public.cockpit_meta_ad_days_is_hidden(v_hidden, e.key, NULL)), '[]'::jsonb),
    'queue', jsonb_build_object(
      'pending', (SELECT count(*) FROM public.cockpit_meta_ad_day_tasks WHERE state = 'pending'),
      'running', (SELECT count(*) FROM public.cockpit_meta_ad_day_tasks WHERE state = 'running')));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE
  v_today date := public.cockpit_meta_ad_days_today();
  v_ties jsonb := public.cockpit_meta_ad_days_ties();
  v_hidden jsonb := public.cockpit_meta_ad_days_hidden();
  v_accounts jsonb;
BEGIN
  v_accounts := coalesce((
    WITH latest AS (
      SELECT x.accounts FROM public.cockpit_meta_ad_day_runs x WHERE x.job IN ('hourly','nightly') AND x.state <> 'running'
      ORDER BY x.started_at DESC LIMIT 1
    ), ids AS (
      SELECT d.account_id FROM public.cockpit_meta_ad_days d GROUP BY d.account_id
      UNION SELECT a->>'accountId' FROM latest CROSS JOIN LATERAL jsonb_array_elements(latest.accounts) a
    ), seen AS (
      SELECT DISTINCT ON (a->>'accountId') a->>'accountId' AS account_id,
        CASE WHEN jsonb_typeof(a->'status') = 'number' THEN (a->>'status')::int END AS status, r.started_at AS seen_at,
        a->>'name' AS name
      FROM public.cockpit_meta_ad_day_runs r CROSS JOIN LATERAL jsonb_array_elements(r.accounts) a
      WHERE r.state <> 'running' AND r.started_at > public.cockpit_meta_ad_days_now() - interval '3 days'
      ORDER BY a->>'accountId', r.started_at DESC
    )
    SELECT jsonb_agg(jsonb_build_object('accountId', i.account_id, 'name', coalesce(s.account_name, l.name, st.name), 'currency', s.account_currency,
             'timezone', s.account_timezone, 'lastDay', s.last_day, 'lastFetchedAt', s.last_fetched,
             'linked', (v_ties->'accounts') ? i.account_id, 'locationId', v_ties->'accounts'->i.account_id->>'locationId',
             -- With no live tie, a churned client's account (cockpit_churned_ad_accounts, 20261023u) is named
             -- with the list's client and the status Churned. A live tie wins, and a hidden account is
             -- dropped before the list is read (the join below).
             'clientName', CASE WHEN (v_ties->'accounts') ? i.account_id THEN v_ties->'accounts'->i.account_id->>'clientName' ELSE ch.client_name END,
             'clientStatus', CASE WHEN (v_ties->'accounts') ? i.account_id THEN v_ties->'accounts'->i.account_id->>'status' ELSE ch.status END,
             'hidden', NOT ((v_ties->'accounts') ? i.account_id)
                       AND public.cockpit_meta_ad_days_is_hidden(v_hidden, i.account_id, coalesce(s.account_name, l.name, st.name)),
             'status', st.status, 'statusLabel', public.cockpit_meta_ad_days_status_label(st.status), 'statusAt', st.seen_at,
             'spend2d', s.spend2d, 'lastSpendDay', s.last_spend_day,
             'failing', CASE WHEN f.state = 'failed' THEN f.error END, 'failingSince', CASE WHEN f.state = 'failed' THEN f.updated_at END)
           ORDER BY i.account_id)
    FROM ids i
    LEFT JOIN LATERAL (SELECT max(d.account_name) AS account_name, max(d.account_currency) AS account_currency,
                              max(d.account_timezone) AS account_timezone, max(d.day) AS last_day, max(d.fetched_at) AS last_fetched,
                              sum(d.spend) FILTER (WHERE d.day >= v_today - 2) AS spend2d,
                              max(d.day) FILTER (WHERE d.spend > 0) AS last_spend_day
                       FROM public.cockpit_meta_ad_days d WHERE d.account_id = i.account_id) s ON true
    LEFT JOIN LATERAL (SELECT a->>'name' AS name FROM latest CROSS JOIN LATERAL jsonb_array_elements(latest.accounts) a
                       WHERE a->>'accountId' = i.account_id LIMIT 1) l ON true
    LEFT JOIN seen st ON st.account_id = i.account_id
    LEFT JOIN public.cockpit_churned_ad_accounts ch ON ch.account_id = i.account_id
      AND NOT public.cockpit_meta_ad_days_is_hidden(v_hidden, i.account_id, coalesce(s.account_name, l.name, st.name))
    LEFT JOIN LATERAL (SELECT t.state, t.error, t.updated_at FROM public.cockpit_meta_ad_day_tasks t
                       WHERE t.account_id = i.account_id AND t.kind = 'days' AND t.state IN ('done','failed')
                       ORDER BY t.updated_at DESC, t.id DESC LIMIT 1) f ON true), '[]'::jsonb);
  RETURN jsonb_build_object(
    'today', to_char(v_today,'YYYY-MM-DD'),
    'windows', public.cockpit_meta_reach_windows_json(v_today),
    'tieSource', v_ties->>'source',
    'jobs', coalesce((SELECT jsonb_object_agg(r.job, jsonb_build_object('runId', r.id, 'state', r.state, 'startedAt', r.started_at,
                 'finishedAt', r.finished_at, 'note', r.note, 'tasksTotal', r.tasks_total, 'tasksDone', r.tasks_done,
                 'tasksFailed', r.tasks_failed, 'rowsWritten', r.rows_written, 'graphVersion', r.graph_version,
                 'lastOkAt', (SELECT max(o.finished_at) FROM public.cockpit_meta_ad_day_runs o WHERE o.job = r.job AND o.state = 'ok')))
               FROM (SELECT DISTINCT ON (job) * FROM public.cockpit_meta_ad_day_runs ORDER BY job, started_at DESC) r), '{}'::jsonb),
    'sync', coalesce((SELECT jsonb_object_agg(s.key, jsonb_build_object('ok', s.ok, 'note', s.note, 'lastRunAt', s.last_run_at, 'lastOkAt', s.last_ok_at))
               FROM public.cockpit_sync_state s WHERE s.key LIKE 'meta-ad-days%'), '{}'::jsonb),
    'queue', jsonb_build_object(
      'pending', (SELECT count(*) FROM public.cockpit_meta_ad_day_tasks WHERE state = 'pending'),
      'running', (SELECT count(*) FROM public.cockpit_meta_ad_day_tasks WHERE state = 'running')),
    'store', (SELECT jsonb_build_object('rows', count(*), 'firstDay', min(day), 'lastDay', max(day), 'lastFetchedAt', max(fetched_at))
              FROM public.cockpit_meta_ad_days),
    'accounts', v_accounts,
    'notLinked', coalesce((
      SELECT jsonb_agg(jsonb_build_object('accountId', a->>'accountId', 'name', a->>'name', 'currency', a->>'currency', 'spend', a->'spend')
               ORDER BY a->>'accountId')
      FROM (SELECT x.accounts, x.detail FROM public.cockpit_meta_ad_day_runs x WHERE x.job IN ('hourly','nightly') AND x.state <> 'running'
            ORDER BY x.started_at DESC LIMIT 1) r CROSS JOIN LATERAL jsonb_array_elements(r.accounts) a
      WHERE r.detail->>'tieSource' = 'board_clients' AND (a->>'linked')::boolean IS NOT TRUE
        AND NOT ((v_ties->'accounts') ? (a->>'accountId'))
        AND NOT public.cockpit_meta_ad_days_is_hidden(v_hidden, a->>'accountId', a->>'name')
        AND NOT EXISTS (SELECT 1 FROM public.cockpit_churned_ad_accounts f WHERE f.account_id = a->>'accountId')), '[]'::jsonb),
    'hidden', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', x->>'accountId', 'name', x->>'name', 'lastSpendDay', x->'lastSpendDay')
                                         ORDER BY x->>'accountId')
                        FROM jsonb_array_elements(v_accounts) x WHERE (x->>'hidden')::boolean), '[]'::jsonb),
    'cancelledDelivering', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', x->>'accountId', 'name', x->>'name',
                                         'clientName', x->>'clientName', 'clientStatus', x->>'clientStatus', 'currency', x->>'currency',
                                         'spend2d', x->'spend2d') ORDER BY x->>'accountId')
                        FROM jsonb_array_elements(v_accounts) x
                        WHERE x->>'clientStatus' IN ('Cancelled', 'Stopped', 'Removed from sheet', 'Churned') AND coalesce((x->>'spend2d')::numeric, 0) > 0), '[]'::jsonb),
    'billingStopped', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', x->>'accountId', 'name', x->>'name',
                                         'locationId', x->>'locationId', 'clientName', x->>'clientName', 'status', x->'status',
                                         'statusLabel', x->>'statusLabel', 'lastSpendDay', x->'lastSpendDay') ORDER BY x->>'accountId')
                        FROM jsonb_array_elements(v_accounts) x
                        WHERE (x->>'linked')::boolean AND coalesce(x->>'clientStatus', '') NOT IN ('Cancelled', 'Stopped', 'Removed from sheet')
                          AND jsonb_typeof(x->'status') = 'number' AND (x->>'status')::int <> 1), '[]'::jsonb),
    'reach', coalesce((SELECT jsonb_object_agg(x.level, jsonb_build_object('rows', x.n, 'oldest', x.oldest, 'newest', x.newest))
               FROM (SELECT level, count(*) AS n, min(computed_at) AS oldest, max(computed_at) AS newest FROM public.cockpit_meta_reach GROUP BY level) x), '{}'::jsonb),
    -- Meta's lead ids, read nightly: how many, the newest lead, the last read,
    -- the accounts covered and from when, and the accounts whose lead ads Meta
    -- will not show (no lead access on the Page).
    'leadIds', (SELECT jsonb_build_object('rows', count(*), 'newestLead', max(l.created_time), 'lastReadAt', max(l.fetched_at))
                FROM public.cockpit_meta_lead_ids l)
               || (SELECT jsonb_build_object('accounts', count(*), 'coveredFrom', min(v.covered_from),
                     'noLeadAccess', coalesce(jsonb_agg('act_' || v.account_id ORDER BY v.account_id) FILTER (WHERE v.ads > 0 AND v.ads_unread >= v.ads), '[]'::jsonb))
                   FROM public.cockpit_meta_lead_id_cover v),
    -- Budgets (2026-10-17): read hourly, their history nightly.
    'budgets', (SELECT jsonb_build_object('accounts', count(DISTINCT b.account_id), 'campaigns', count(*) FILTER (WHERE b.level = 'campaign'),
                  'switchedOn', count(*) FILTER (WHERE b.level = 'campaign' AND b.switched_on),
                  'delivering', count(*) FILTER (WHERE b.level = 'campaign' AND b.delivering),
                  'newestFetchedAt', max(b.fetched_at), 'oldestFetchedAt', min(b.fetched_at))
                FROM public.cockpit_meta_budgets b)
               || jsonb_build_object(
                  'lastRun', (SELECT jsonb_build_object('runId', x.id, 'at', x.finished_at, 'read', (x.detail->>'budgetsRead')::int,
                                'failed', (x.detail->>'budgetsFailed')::int,
                                'state', CASE WHEN coalesce((x.detail->>'budgetsFailed')::int, 0) = 0 THEN 'ok'
                                              WHEN coalesce((x.detail->>'budgetsRead')::int, 0) = 0 THEN 'failed' ELSE 'partial' END)
                              FROM public.cockpit_meta_ad_day_runs x
                              WHERE x.job = 'hourly' AND x.state <> 'running' AND coalesce((x.detail->>'budgetAccounts')::int, 0) > 0
                              ORDER BY x.started_at DESC LIMIT 1),
                  'historyLastRun', (SELECT jsonb_build_object('runId', x.id, 'job', x.job, 'at', x.finished_at, 'read', (x.detail->>'historyRead')::int,
                                'failed', (x.detail->>'historyFailed')::int,
                                'state', CASE WHEN coalesce((x.detail->>'historyFailed')::int, 0) = 0 THEN 'ok'
                                              WHEN coalesce((x.detail->>'historyRead')::int, 0) = 0 THEN 'failed' ELSE 'partial' END)
                              FROM public.cockpit_meta_ad_day_runs x
                              WHERE x.job IN ('nightly','backfill') AND x.state <> 'running' AND coalesce((x.detail->>'historyAccounts')::int, 0) > 0
                              ORDER BY x.started_at DESC LIMIT 1),
                  'unlisted', coalesce((SELECT x.detail->'budgetUnlisted' FROM public.cockpit_meta_ad_day_runs x
                                        WHERE x.job = 'hourly' AND x.state <> 'running' AND jsonb_typeof(x.detail->'budgetUnlisted') = 'array'
                                          AND coalesce((x.detail->>'budgetAccounts')::int, 0) > 0
                                        ORDER BY x.started_at DESC LIMIT 1), '[]'::jsonb))
               || jsonb_build_object(
                  'failing', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', f.account_id, 'name', f.account_name, 'error', f.error,
                                         'at', f.updated_at) ORDER BY f.account_id)
                                       FROM (SELECT DISTINCT ON (t.account_id) t.account_id, t.account_name, t.state, t.error, t.updated_at
                                             FROM public.cockpit_meta_ad_day_tasks t WHERE t.kind = 'budgets' AND t.state IN ('done','failed')
                                             ORDER BY t.account_id, t.updated_at DESC, t.id DESC) f WHERE f.state = 'failed'), '[]'::jsonb),
                  'historyFailing', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', f.account_id, 'name', f.account_name, 'error', f.error,
                                         'at', f.updated_at) ORDER BY f.account_id)
                                       FROM (SELECT DISTINCT ON (t.account_id) t.account_id, t.account_name, t.state, t.error, t.updated_at
                                             FROM public.cockpit_meta_ad_day_tasks t WHERE t.kind = 'activities' AND t.state IN ('done','failed')
                                             ORDER BY t.account_id, t.updated_at DESC, t.id DESC) f WHERE f.state = 'failed'), '[]'::jsonb))
               || (SELECT jsonb_build_object('historyFrom', min(a.day), 'snapshotFrom', min(a.day) FILTER (WHERE a.source = 'snapshot'),
                     'lastDay', max(a.day), 'activityDays', count(*) FILTER (WHERE a.source = 'activity'),
                     'unverifiedDays', count(*) FILTER (WHERE NOT a.verified))
                   FROM public.cockpit_meta_budget_account_days a));
END;
$fn$;

-- The grants as they are live, restated (CREATE OR REPLACE keeps the live ones; this says them once more).
REVOKE ALL ON FUNCTION public.cockpit_meta_ad_days_finish(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_meta_ad_days_inputs(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_meta_ad_days_inputs(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.cockpit_meta_ad_days_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_meta_ad_days_status() TO service_role;
COMMIT;
