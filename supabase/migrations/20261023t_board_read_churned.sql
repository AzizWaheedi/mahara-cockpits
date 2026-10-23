-- A churned client's ad account in the board's "Not in these totals" (the CEO, 23 Oct 2026,
-- cost per booking decisions, 5: "triple edge is a old churned client"). Contract:
-- docs/client-performance/CPB-DECISIONS-20261023.md 1.5 and 3.5. Creative Triage
-- bldgtotkfmhoxmlzowdx.
--
-- Only the whole-board off-board block of cockpit_board_read changes: an account on
-- public.cockpit_churned_ad_accounts (20261023q) reads reason "churned" with the list's client
-- name, where it read "not_tied" with no name. Reason order: kept_out, cancelled, not_active,
-- churned, else not_tied; a live tie (a board row or a hand tie naming a client) wins over the
-- list. Totals, rows and limited seats (null) are unchanged. On 23 Oct that is Triple Edge
-- Building Construction ($14.62 in 14 to 20 Oct and 1 to 20 Oct, $9.74 in 16 to 22 Oct); the
-- board's "Not linked" line goes with 20261023u.
--
-- The body is the live one (prosrc md5 b526537e282839af372d2c1f75c9e291, the body of 20261021a) with that
-- change. It refuses, and changes nothing, if 20261023q is not applied or the live body is
-- neither that one nor this file's (a44e997f4cb8f72c9b3a0cb8e5f9732b). Owner, definer and grants are
-- kept and restated (EXECUTE for authenticated only, as live). Safe to run twice.
-- Test: apps/media-buyer-cockpit/scripts/churned-ad-accounts-supabase.test.ts and
-- scripts/board-api-supabase.test.ts.
-- Rollback: ~/.cache/mahara-ship/rollback/cockpit_board_read.before-20261023t_board_read_churned.sql
-- (before dropping the table of 20261023q).

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('public.cockpit_churned_ad_accounts') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261023q_churned_ad_accounts.sql first';
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_board_read(date,date)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('b526537e282839af372d2c1f75c9e291', 'a44e997f4cb8f72c9b3a0cb8e5f9732b') THEN
    RAISE EXCEPTION 'cockpit_board_read is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.cockpit_board_read(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
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
  -- stopped, launching, ghosting: off the board since 2026-10-17), a churned
  -- client's account (cockpit_churned_ad_accounts, 20261023t), an account
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
          'client', coalesce(o.client_name, k.client_name, f.client_name),
          'clientStatus', CASE WHEN NOT coalesce(k.kept_out, false) AND o.status NOT IN ('Cancelled', 'Removed from sheet') THEN o.status END,
          'reason', CASE WHEN k.kept_out THEN 'kept_out'
                         WHEN o.status IN ('Cancelled', 'Removed from sheet') THEN 'cancelled'
                         WHEN o.client_name IS NOT NULL THEN 'not_active'
                         -- A former client with no card, location or board row left (the CEO, 23 Oct 2026,
                         -- decision 5). A live tie wins over the list.
                         WHEN f.account_id IS NOT NULL AND k.client_name IS NULL THEN 'churned'
                         ELSE 'not_tied' END)) ORDER BY x.spend DESC NULLS LAST), '[]'::jsonb))
      INTO v_off
    FROM acct x
    LEFT JOIN owner o ON o.a = x.account_id
    LEFT JOIN LATERAL (
      SELECT t.kept_out, b.client_name FROM public.cockpit_board_account_ties t
      LEFT JOIN public.cockpit_board_clients b ON b.location_id = t.location_id
      WHERE t.account_id = x.account_id ORDER BY t.kept_out DESC LIMIT 1) k ON true
    LEFT JOIN public.cockpit_churned_ad_accounts f ON f.account_id = x.account_id;
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
END $fn$;

-- The grants as they are live, restated (CREATE OR REPLACE keeps the live ones; this says them once more).
REVOKE ALL ON FUNCTION public.cockpit_board_read(date,date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_board_read(date,date) TO authenticated;
COMMIT;
