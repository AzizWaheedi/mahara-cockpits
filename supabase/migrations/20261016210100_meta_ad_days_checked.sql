-- Meta ad-day store, corrected after the second-source check of 2026-10-16
-- (Creative Triage bldgtotkfmhoxmlzowdx).
--
-- The check read 27 spending accounts' 30 and 7 days from Meta (account,
-- campaign and ad set insights, the Leads API ids only) against
-- cockpit_meta_ad_days and cockpit_meta_reach. Spend, impressions, link clicks,
-- form leads and every video field matched to the cent or the count. What it
-- found, and what this file changes (20261016121700_meta_ad_days.sql stands
-- otherwise; the live bodies were read with pg_get_functiondef and equal it):
--
--   1. A client's reach could quietly sum only part of its accounts. Marble and
--      more's 30-day row held one account (3,604 reach, 5,673 impressions) with
--      no note while its other account delivered 8,136 impressions in the
--      window and had never been read for reach; ARCWANI and Liwan, which spent
--      in the window, had no client row at all. Now an account tied to the
--      client with ad-days delivering inside a window but no account row for it
--      makes the client's reach unknown (NULL), with a note, and the row is
--      written even when no account row exists.
--   2. Two more windows end yesterday, the last complete Kuwait day:
--      last_7_full and last_30_full, so the board can show reach and frequency
--      over the same full days as its spend and leads (the five windows end
--      today; the ad numbers checked were full days).
--   3. Accounts hidden on purpose (a clients row with hidden_from_dashboard,
--      or Mahara's own Mass Design account) were reported as "not linked to a
--      client". They are named apart as "Hidden on purpose".
--   4. The board had no word for an account whose billing stopped delivery
--      (ARCWANI since 9 Oct, Liwan since 12 Oct: Meta account_status 3) or an
--      account delivering for a cancelled client (Pidco, AEA, Ideal Elite:
--      $1,507 in 30 days). cockpit_meta_ad_days_status() now gives each
--      account's Meta status with a label, and lists cancelledDelivering and
--      billingStopped; the ties carry the client's status.
--   5. inputs accepts the doctor's and the dry run's account ids, so the
--      doctor's "Not linked" list is no longer always empty.
--   6. The leads column says what the check showed: leads from lead campaigns,
--      instant form or website (Atlantis: 38 form + 4 website), chat leads out.
--   7. About 19 Meta form leads in 30 days never became GoHighLevel contacts
--      (Arcturus 5 in three days), and nothing kept Meta's lead ids to see it
--      (lead-sync-watch compares daily counts for 7 days). A nightly run that
--      asks now reads every lead ad's lead ids and times (never field_data)
--      into cockpit_meta_lead_ids, and cockpit_meta_leads_not_in_crm(from, to)
--      counts, per client, the Meta leads no CRM contact on the same ad matches,
--      one lead to one contact (a contact of the next day's lead never covers a
--      lead of the window that did not arrive). cockpit_meta_lead_id_cover
--      keeps, per account, the span the held lead ids cover, so a window before
--      it, or a client whose lead ads Meta will not show, reads unknown, not 0.
--
-- The Edge Function meta-ad-days changes with this file and can be deployed
-- before or after it: reach windows with the same days (last_7 and this_month
-- on the 7th of a month) are read once and written under both keys, where
-- before the read was refused as "two reach rows" or the second window wrote
-- 0; the nightly run asks for lead ids (an older database ignores the ask);
-- the doctor sends the accounts with their names.
--
-- How we know it works: apps/media-buyer-cockpit/scripts/meta-ad-days-supabase.test.ts
-- loads 20261016121700 and this file on PGlite. Safe to apply twice; loads
-- before or after the board's facts files (cockpit_board_clients and public.clients
-- are read through guarded dynamic SQL).

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regprocedure('public.cockpit_meta_reach_rebuild_clients()') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261016121700_meta_ad_days.sql first';
  END IF;
END $$;

ALTER TABLE public.cockpit_meta_reach DROP CONSTRAINT IF EXISTS cockpit_meta_reach_window_key_check;
ALTER TABLE public.cockpit_meta_reach ADD CONSTRAINT cockpit_meta_reach_window_key_check
  CHECK (window_key IN ('last_7','last_14','last_30','this_month','last_month','last_7_full','last_30_full'));
COMMENT ON TABLE public.cockpit_meta_reach IS
  'Meta reach and impressions over the standard windows (cockpit_meta_reach_windows, Kuwait days: five ending today, last_7_full and last_30_full ending yesterday) per level: account, campaign, adset and ad from Meta''s own time_ranges read (written nightly, account level hourly), client (key = GHL location id) from its ad accounts through cockpit_board_clients. Frequency over a window = impressions / reach of the same row. A row whose from_day and to_day are not today''s window is stale.';
COMMENT ON COLUMN public.cockpit_meta_reach.note IS
  'Client rows: the sum of more than one ad account (a person reached by two counts twice), or why the reach is unknown (NULL): an account that could not be read, one not re-read since the windows moved, or one that delivered in the window and has not been read for it yet.';
COMMENT ON COLUMN public.cockpit_meta_ad_days.leads IS
  'Leads from lead campaigns: on a lead campaign (objective OUTCOME_LEADS or LEAD_GENERATION), Meta''s lead action less its messaging leads (onsite_conversion.lead), 0 when Meta lists none. Instant-form leads, and website (pixel) leads on a WEBSITE ad set (destination_type ON_AD vs WEBSITE tells them apart; Atlantis 38 + 4 over 30 days to 15 Oct). NULL on every other objective, and NULL on a lead ad set whose destination_type is a chat (WhatsApp, Messenger, Instagram Direct): those report a lead action for leads marked in a chat, which are not form leads. CPL = spend over the rows where leads is not NULL / their leads, so a chat ad set''s spend stays out of it.';

/**
 * Meta's account_status as a word: 1 active, 2 disabled, 3 unsettled (billing),
 * 7 pending risk review, 8 pending settlement, 9 in grace period, 100 pending
 * closure, 101 closed, 201 any active, 202 any closed. NULL when not known.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_status_label(p_status int)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE p_status WHEN 1 THEN 'active' WHEN 2 THEN 'disabled' WHEN 3 THEN 'unsettled' WHEN 7 THEN 'pending risk review'
    WHEN 8 THEN 'pending settlement' WHEN 9 THEN 'in grace period' WHEN 100 THEN 'pending closure' WHEN 101 THEN 'closed'
    WHEN 201 THEN 'any active' WHEN 202 THEN 'any closed' END
$$;

/**
 * The ad accounts hidden on purpose: a clients row with hidden_from_dashboard,
 * or one named for Mahara itself (MaharaMedia, Mahara Mass Design), the
 * spine's rule; and an account kept out of its client's figures by hand
 * (cockpit_board_account_ties.kept_out: Alkhalil's own post-boost account).
 * An account tied to a client by hand is never hidden. A jsonb array of ids.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_hidden()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb := '[]'::jsonb;
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    EXECUTE $q$
      SELECT coalesce(jsonb_agg(DISTINCT x.id), '[]'::jsonb) FROM (
        SELECT regexp_replace(lower(btrim(c.meta_ad_account_id)), '^act_', '') AS id
        FROM public.clients c
        WHERE coalesce(c.meta_ad_account_id, '') <> ''
          AND (coalesce(c.hidden_from_dashboard, false)
               OR regexp_replace(lower(coalesce(c.name, '')), '[^[:alnum:]]+', '', 'g') IN ('maharamedia', 'maharamassdesign'))
      ) x
      WHERE x.id ~ '^[0-9]{5,25}$'
    $q$ INTO v;
  END IF;
  IF to_regclass('public.cockpit_board_account_ties') IS NOT NULL THEN
    -- A hand tie unhides an account; a hand row kept out (kept_out) hides it.
    EXECUTE $q$
      SELECT coalesce(jsonb_agg(DISTINCT x.id), '[]'::jsonb) FROM (
        SELECT h.id FROM jsonb_array_elements_text($1) h(id)
        WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_board_account_ties t
                          WHERE t.account_id = h.id AND (to_jsonb(t)->>'kept_out')::boolean IS NOT TRUE)
        UNION
        SELECT t.account_id FROM public.cockpit_board_account_ties t WHERE (to_jsonb(t)->>'kept_out')::boolean IS TRUE
      ) x
    $q$ INTO v USING v;
  END IF;
  RETURN v;
END;
$$;

/** True when an account is hidden on purpose: in the hidden list, or named for Mahara itself on Meta. */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_is_hidden(p_hidden jsonb, p_account_id text, p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT coalesce(p_hidden ? p_account_id, false)
      OR regexp_replace(lower(coalesce(p_name, '')), '[^[:alnum:]]+', '', 'g') IN ('maharamedia', 'maharamassdesign')
$$;

/**
 * The standard windows on Kuwait's calendar. Five end today, the way the
 * cockpits' reporting periods count them (reportPeriod.ts: "last 7 days" is
 * today and the 6 days before it); this_month runs from the 1st to today;
 * last_month is the whole previous month. Two end yesterday, the last
 * complete day: last_7_full and last_30_full, for a board whose spend and
 * leads stop at yesterday (2026-10-16 check). Two windows can hold the same
 * days (last_7 and this_month on the 7th): the function reads such a span once.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_reach_windows(p_today date)
RETURNS TABLE(window_key text, from_day date, to_day date) LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT v.window_key, v.from_day, v.to_day FROM (VALUES
    (1, 'last_7', p_today - 6, p_today),
    (2, 'last_14', p_today - 13, p_today),
    (3, 'last_30', p_today - 29, p_today),
    (4, 'this_month', date_trunc('month', p_today::timestamp)::date, p_today),
    (5, 'last_month', (date_trunc('month', p_today::timestamp) - interval '1 month')::date, (date_trunc('month', p_today::timestamp) - interval '1 day')::date),
    (6, 'last_7_full', p_today - 7, p_today - 1),
    (7, 'last_30_full', p_today - 30, p_today - 1)
  ) AS v(n, window_key, from_day, to_day)
  ORDER BY v.n
$$;

/**
 * Which client each ad account belongs to, from cockpit_board_clients (the
 * board's client spine; its ad_account_ids follow the tie order of
 * hermes/lead-sync-watch). {source: 'board_clients' | 'empty' | 'missing',
 * clients, accounts: {"<account id>": {locationId, clientName, status}}}. An
 * account listed on two clients is tied to the first by location id and
 * counted in `shared`. status is the client's (Active, Cancelled, Stopped...).
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_ties()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_map jsonb; v_clients int; v_shared int;
BEGIN
  IF to_regclass('public.cockpit_board_clients') IS NULL THEN
    RETURN jsonb_build_object('source', 'missing', 'clients', 0, 'shared', 0, 'accounts', '{}'::jsonb);
  END IF;
  EXECUTE $q$
    WITH pairs AS (
      SELECT regexp_replace(btrim(x), '^act_', '') AS account_id, c.location_id, c.client_name, c.status
      FROM public.cockpit_board_clients c CROSS JOIN LATERAL unnest(coalesce(c.ad_account_ids, '{}'::text[])) AS x
      WHERE c.location_id IS NOT NULL
    ), firsts AS (
      SELECT DISTINCT ON (account_id) account_id, location_id, client_name, status, count(*) OVER (PARTITION BY account_id) AS n
      FROM pairs WHERE account_id ~ '^[0-9]{5,25}$' ORDER BY account_id, location_id
    )
    SELECT coalesce((SELECT jsonb_object_agg(account_id, jsonb_build_object('locationId', location_id, 'clientName', client_name,
                       'status', status)) FROM firsts), '{}'::jsonb),
           (SELECT count(*)::int FROM public.cockpit_board_clients),
           (SELECT count(*)::int FROM firsts WHERE n > 1)
  $q$ INTO v_map, v_clients, v_shared;
  RETURN jsonb_build_object('source', CASE WHEN v_clients = 0 THEN 'empty' ELSE 'board_clients' END,
    'clients', v_clients, 'shared', v_shared, 'accounts', v_map);
END;
$$;

/**
 * Rebuild the client rows of cockpit_meta_reach from today's account rows:
 * per client (cockpit_board_clients location) and window, the sum of its ad
 * accounts' reach. One account: Meta's own number. Two or more: a sum, and
 * the note says a person reached by two accounts counts twice. The client's
 * reach is NULL, with the account named, when an account of the client
 *   - failed its latest reach read, or
 *   - still holds that window as of an earlier day: it was not re-read since
 *     the windows moved on (after Kuwait midnight the hourly run re-reads only
 *     the accounts that spent in the last two days; the nightly run re-reads
 *     every account that delivered in any window, and drops the rows of the
 *     ones that did not before this rebuild). Summing without it would show
 *     part of the client as the whole.
 *   - delivered inside the window (its ad-days have impressions there) but has
 *     no account row for the window at all: it was never read for it (the
 *     backfill reads no reach, the hourly run only accounts that spent in the
 *     last two days). Before 2026-10-16 such an account was left out of the
 *     sum with no note (Marble and more: one account of two).
 * The row is written even when the client has no account row yet (ARCWANI,
 * Liwan before the first nightly run), so the board reads "unknown", never
 * a missing client. Without the client spine there are no client rows.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_reach_rebuild_clients()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_n int := 0;
BEGIN
  DELETE FROM public.cockpit_meta_reach WHERE level = 'client';
  IF to_regclass('public.cockpit_board_clients') IS NULL THEN RETURN 0; END IF;
  EXECUTE $q$
    WITH clients AS (
      SELECT c.location_id, array_agg(DISTINCT regexp_replace(btrim(x), '^act_', '')) AS accounts
      FROM public.cockpit_board_clients c CROSS JOIN LATERAL unnest(coalesce(c.ad_account_ids, '{}'::text[])) AS x
      WHERE c.location_id IS NOT NULL GROUP BY c.location_id
    ), w AS (SELECT * FROM public.cockpit_meta_reach_windows($1)),
    acc AS (
      SELECT r.key, r.window_key, r.reach, r.impressions, r.computed_at
      FROM public.cockpit_meta_reach r JOIN w ON w.window_key = r.window_key AND w.from_day = r.from_day AND w.to_day = r.to_day
      WHERE r.level = 'account'
    ), stale AS (
      SELECT r.key, r.window_key, r.to_day
      FROM public.cockpit_meta_reach r JOIN w ON w.window_key = r.window_key
      WHERE r.level = 'account' AND (r.from_day, r.to_day) IS DISTINCT FROM (w.from_day, w.to_day)
    ), last_read AS (
      SELECT DISTINCT ON (t.account_id) t.account_id, t.state
      FROM public.cockpit_meta_ad_day_tasks t
      WHERE t.kind IN ('reach_account','reach_all') AND t.state IN ('done','failed')
      ORDER BY t.account_id, t.updated_at DESC, t.id DESC
    ), delivered AS (
      -- Accounts with impressions in each window, from the ad-days.
      SELECT DISTINCT d.account_id, w.window_key
      FROM public.cockpit_meta_ad_days d JOIN w ON d.day BETWEEN w.from_day AND w.to_day
      WHERE d.impressions > 0
    ), ins AS (
      INSERT INTO public.cockpit_meta_reach(level, key, window_key, from_day, to_day, reach, impressions, computed_at, account_id, note)
      SELECT 'client', c.location_id, w.window_key, w.from_day, w.to_day,
        CASE WHEN f.failed IS NULL AND s.stale IS NULL AND m.missing IS NULL THEN a.reach END,
        CASE WHEN f.failed IS NULL AND s.stale IS NULL AND m.missing IS NULL THEN a.impressions END,
        coalesce(a.computed_at, pg_catalog.now()), NULL,
        left(nullif(concat_ws(' ',
          CASE WHEN f.failed IS NOT NULL THEN 'Could not read ad account ' || f.failed || ', so this client''s reach is unknown.' END,
          CASE WHEN f.failed IS NULL AND s.stale IS NOT NULL THEN CASE WHEN s.n > 1 THEN 'Ad accounts ' ELSE 'Ad account ' END || s.stale
            || '; this client''s reach waits for the nightly run.' END,
          CASE WHEN f.failed IS NULL AND s.stale IS NULL AND m.missing IS NOT NULL THEN CASE WHEN m.n > 1 THEN 'Ad accounts ' ELSE 'Ad account ' END
            || m.missing || CASE WHEN m.n > 1 THEN ' have' ELSE ' has' END
            || ' not been read for this window yet; this client''s reach waits for the nightly run.' END,
          CASE WHEN f.failed IS NULL AND s.stale IS NULL AND m.missing IS NULL AND a.n > 1 THEN 'The sum of ' || a.n || ' ad accounts: a person reached by two of them counts twice.' END), ''), 500)
      FROM clients c CROSS JOIN w
      CROSS JOIN LATERAL (SELECT count(*)::int AS n, sum(r.reach)::bigint AS reach, sum(r.impressions)::bigint AS impressions, min(r.computed_at) AS computed_at
                          FROM acc r WHERE r.key = ANY(c.accounts) AND r.window_key = w.window_key) a
      CROSS JOIN LATERAL (SELECT string_agg(l.account_id, ', ' ORDER BY l.account_id) AS failed
                          FROM last_read l WHERE l.account_id = ANY(c.accounts) AND l.state = 'failed') f
      CROSS JOIN LATERAL (SELECT count(*)::int AS n, string_agg(x.key || ' not re-read since ' || to_char(x.to_day, 'YYYY-MM-DD'), ', ' ORDER BY x.key) AS stale
                          FROM stale x WHERE x.key = ANY(c.accounts) AND x.window_key = w.window_key) s
      CROSS JOIN LATERAL (SELECT count(*)::int AS n, string_agg(dv.account_id, ', ' ORDER BY dv.account_id) AS missing
                          FROM delivered dv
                          WHERE dv.account_id = ANY(c.accounts) AND dv.window_key = w.window_key
                            AND NOT EXISTS (SELECT 1 FROM public.cockpit_meta_reach r
                                            WHERE r.level = 'account' AND r.key = dv.account_id AND r.window_key = w.window_key)) m
      WHERE a.n > 0 OR f.failed IS NOT NULL OR s.stale IS NOT NULL OR m.missing IS NOT NULL
      RETURNING 1
    )
    SELECT count(*)::int FROM ins
  $q$ INTO v_n USING public.cockpit_meta_ad_days_today();
  RETURN v_n;
END;
$$;

/**
 * Close a run once every task is done or failed: its state (ok, partial or
 * failed), its note, the sync-state row meta-ad-days-<job>, one audit row,
 * the client reach rows, and the retention of receipts, tasks and runs.
 * The run row is locked first, so two tasks finishing at once close it once.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_finish(p_run uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  r public.cockpit_meta_ad_day_runs; v_open int; v_done int; v_failed int; v_rows int; v_changed int; v_accounts int;
  v_state text; v_note text; v_failing text; v_not_linked text; v_no_rate text; v_reach int; v_clients int := 0;
  v_hidden text; v_gone text; v_leadids int; v_lead_notes text;
BEGIN
  SELECT * INTO r FROM public.cockpit_meta_ad_day_runs WHERE id = p_run FOR UPDATE;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  IF r.state <> 'running' THEN RETURN r.state; END IF;
  SELECT count(*) FILTER (WHERE state IN ('pending','running')), count(*) FILTER (WHERE state = 'done'), count(*) FILTER (WHERE state = 'failed'),
         coalesce(sum(rows_read) FILTER (WHERE kind = 'days' AND state = 'done'), 0), coalesce(sum(changed) FILTER (WHERE kind = 'days' AND state = 'done'), 0),
         count(DISTINCT account_id), count(*) FILTER (WHERE kind IN ('reach_account','reach_all') AND state = 'done'),
         count(*) FILTER (WHERE kind = 'lead_ids' AND state = 'done'),
         string_agg(coalesce(account_name, account_id) || ': ' || note, '; ' ORDER BY account_id) FILTER (WHERE kind = 'lead_ids' AND note IS NOT NULL)
    INTO v_open, v_done, v_failed, v_rows, v_changed, v_accounts, v_reach, v_leadids, v_lead_notes
  FROM public.cockpit_meta_ad_day_tasks WHERE run_id = p_run;
  IF v_open > 0 THEN RETURN 'running'; END IF;
  v_state := CASE WHEN v_failed = 0 THEN 'ok' WHEN v_done = 0 THEN 'failed' ELSE 'partial' END;

  SELECT string_agg(coalesce(f.account_name, f.account_id) || ' (' || f.account_id || '): ' || coalesce(f.error, 'not read'), '; ' ORDER BY f.account_id)
    INTO v_failing
  FROM (SELECT DISTINCT ON (t.account_id) t.account_id, t.account_name, t.error FROM public.cockpit_meta_ad_day_tasks t
        WHERE t.run_id = p_run AND t.state = 'failed' ORDER BY t.account_id, t.id) f;
  SELECT string_agg(coalesce(a->>'name', a->>'accountId') || ' (' || (a->>'accountId') || ', ' || coalesce(a->>'currency','?') || ' ' || coalesce(a->>'spend','?') || ')', ', ' ORDER BY a->>'accountId')
    INTO v_not_linked
  FROM jsonb_array_elements(r.accounts) a WHERE (a->>'linked')::boolean IS NOT TRUE AND (a->>'hidden')::boolean IS NOT TRUE;
  -- Hidden on purpose (a hidden clients row, Mahara's own Mass Design account):
  -- named apart, not as "not linked".
  SELECT string_agg(coalesce(a->>'name', a->>'accountId') || ' (' || (a->>'accountId') || ', ' || coalesce(a->>'currency','?') || ' ' || coalesce(a->>'spend','?') || ')', ', ' ORDER BY a->>'accountId')
    INTO v_hidden
  FROM jsonb_array_elements(r.accounts) a WHERE (a->>'linked')::boolean IS NOT TRUE AND (a->>'hidden')::boolean IS TRUE;
  -- Spending for a client that is cancelled or stopped.
  SELECT string_agg(coalesce(a->>'name', a->>'accountId') || ' (' || (a->>'accountId') || ', ' || coalesce(a->>'clientName', '?') || ' is '
           || coalesce(a->>'clientStatus', '?') || ', ' || coalesce(a->>'currency','?') || ' ' || coalesce(a->>'spend','?') || ')', ', ' ORDER BY a->>'accountId')
    INTO v_gone
  FROM jsonb_array_elements(r.accounts) a
  WHERE (a->>'linked')::boolean IS TRUE AND a->>'clientStatus' IN ('Cancelled', 'Stopped', 'Removed from sheet');
  SELECT string_agg(DISTINCT coalesce(a->>'currency','no currency') || ' on ' || coalesce(a->>'name', a->>'accountId'), ', ')
    INTO v_no_rate
  FROM jsonb_array_elements(r.accounts) a WHERE public.cockpit_meta_ad_days_usd_per(a->>'currency') IS NULL;

  v_note := left(concat_ws(' ',
    CASE WHEN jsonb_array_length(r.accounts) = 0 THEN 'No ad account of the business spent in the window; nothing to read.'
         ELSE 'Read ' || (jsonb_array_length(r.accounts) - coalesce((SELECT count(DISTINCT t.account_id) FROM public.cockpit_meta_ad_day_tasks t
                WHERE t.run_id = p_run AND t.state = 'failed'), 0)) || ' of ' || jsonb_array_length(r.accounts) || ' ad accounts: '
              || v_rows || ' ad-days written, ' || v_changed || ' new or changed.' END,
    CASE WHEN v_reach > 0 THEN 'Reach read for ' || v_reach || ' accounts.' END,
    CASE WHEN v_leadids > 0 THEN 'Lead ids read for ' || v_leadids || CASE WHEN v_leadids = 1 THEN ' account' ELSE ' accounts' END
      || coalesce(' (' || v_lead_notes || ')', '') || '.' END,
    CASE WHEN v_failing IS NOT NULL THEN 'Could not read ' || v_failing || '.' END,
    CASE WHEN r.detail->>'tieSource' = 'board_clients' AND v_gone IS NOT NULL THEN 'Spent for a cancelled or stopped client: ' || v_gone || '.' END,
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
    detail = detail || jsonb_build_object('clientReachRows', v_clients)
  WHERE id = p_run;

  INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, rows_seen, detail, updated_at)
  VALUES ('meta-ad-days-' || r.job, pg_catalog.now(), CASE WHEN v_state = 'ok' THEN pg_catalog.now() END, v_state = 'ok', v_note, v_rows,
    jsonb_build_object('runId', p_run, 'state', v_state, 'accounts', jsonb_array_length(r.accounts), 'tasksDone', v_done, 'tasksFailed', v_failed,
      'changed', v_changed, 'from', r.window_from, 'to', r.window_to, 'tieSource', r.detail->>'tieSource'), pg_catalog.now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = pg_catalog.now(),
    last_ok_at = CASE WHEN v_state = 'ok' THEN pg_catalog.now() ELSE public.cockpit_sync_state.last_ok_at END,
    ok = EXCLUDED.ok, note = EXCLUDED.note, rows_seen = EXCLUDED.rows_seen, detail = EXCLUDED.detail, updated_at = pg_catalog.now();

  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, "before", "after")
  VALUES ('meta_ad_days.run', 'meta_ad_day_run', p_run::text,
    CASE WHEN r.requested_by ~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN r.requested_by ELSE 'meta-ad-days' END, 'board', 'meta-ad-days', NULL,
    jsonb_build_object('job', r.job, 'state', v_state, 'accounts', jsonb_array_length(r.accounts), 'tasksDone', v_done, 'tasksFailed', v_failed,
      'rowsWritten', v_rows, 'rowsChanged', v_changed, 'reachAccounts', v_reach, 'clientReachRows', v_clients,
      'from', r.window_from, 'to', r.window_to));

  DELETE FROM public.cockpit_meta_ad_day_receipts WHERE created_at < pg_catalog.now() - interval '30 days';
  DELETE FROM public.cockpit_meta_ad_day_tasks t USING public.cockpit_meta_ad_day_runs x
    WHERE t.run_id = x.id AND x.state <> 'running' AND x.finished_at < pg_catalog.now() - interval '14 days';
  DELETE FROM public.cockpit_meta_ad_day_runs WHERE state <> 'running' AND finished_at < pg_catalog.now() - interval '90 days';
  RETURN v_state;
END;
$$;

/** What a run or a dry run needs from the database: today, the windows, the ties, and which of p.accounts tie to no client. Reads only. */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_inputs(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
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
                             AND NOT public.cockpit_meta_ad_days_is_hidden(v_hidden, a->>'accountId', a->>'name')), '[]'::jsonb),
    'hidden', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', a->>'accountId', 'name', a->>'name') ORDER BY a->>'accountId')
                        FROM jsonb_array_elements(v_accounts) a
                        WHERE NOT ((v_ties->'accounts') ? (a->>'accountId'))
                          AND public.cockpit_meta_ad_days_is_hidden(v_hidden, a->>'accountId', a->>'name')), '[]'::jsonb),
    'cancelled', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', a->>'accountId', 'name', a->>'name',
                             'clientName', v_ties->'accounts'->(a->>'accountId')->>'clientName',
                             'status', v_ties->'accounts'->(a->>'accountId')->>'status') ORDER BY a->>'accountId')
                           FROM jsonb_array_elements(v_accounts) a
                           WHERE v_ties->'accounts'->(a->>'accountId')->>'status' IN ('Cancelled', 'Stopped', 'Removed from sheet')), '[]'::jsonb),
    'queue', jsonb_build_object(
      'pending', (SELECT count(*) FROM public.cockpit_meta_ad_day_tasks WHERE state = 'pending'),
      'running', (SELECT count(*) FROM public.cockpit_meta_ad_day_tasks WHERE state = 'running')));
END;
$$;

/**
 * Start a run: p = {job, requestedBy, graphVersion, window {since, until},
 * accounts [{accountId, name, currency, timezone, status, spend, edge}],
 * internal [ids], unreadable [ids], tasks [{kind: 'days', accountId, since,
 * until}], reach: 'account' | 'all' | null, leadIds: boolean (nightly only)}. Each account is tied to a client
 * (or listed as not linked) here. One reach task per account is added with
 * today's windows. A run of the same job still working answers busy.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_begin(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_job text := p->>'job'; v_by text; v_busy public.cockpit_meta_ad_day_runs; v_run uuid; v_today date; v_ties jsonb;
  v_accounts jsonb; v_bad text; v_tasks int; v_reach text := nullif(p->>'reach',''); v_state text; v_hidden jsonb;
BEGIN
  PERFORM public.cockpit_meta_ad_days_require_service();
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR v_job IS NULL OR v_job NOT IN ('hourly','nightly','backfill')
     OR jsonb_typeof(p->'accounts') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'tasks') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Send {job: hourly, nightly or backfill, accounts: [...], tasks: [...]}' USING ERRCODE='22023';
  END IF;
  IF v_reach IS NOT NULL AND v_reach NOT IN ('account','all') THEN RAISE EXCEPTION 'reach is account, all or null' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p->'accounts') > 300 OR jsonb_array_length(p->'tasks') > 5000 THEN
    RAISE EXCEPTION 'Too many accounts or tasks for one run' USING ERRCODE='22023';
  END IF;
  v_by := CASE WHEN coalesce(p->>'requestedBy','') ~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN lower(p->>'requestedBy') ELSE 'cron' END;
  PERFORM public.cockpit_meta_ad_days_expire();
  SELECT * INTO v_busy FROM public.cockpit_meta_ad_day_runs WHERE job = v_job AND state = 'running' ORDER BY started_at DESC LIMIT 1;
  IF v_busy.id IS NOT NULL THEN
    RETURN jsonb_build_object('started', false, 'busy', true, 'runId', v_busy.id, 'since', v_busy.started_at);
  END IF;
  v_today := public.cockpit_meta_ad_days_today();

  SELECT CASE
      WHEN jsonb_typeof(a) <> 'object' OR coalesce(a->>'accountId','') !~ '^[0-9]{5,25}$' THEN 'an account without a valid id'
      WHEN a->>'currency' IS NOT NULL AND a->>'currency' !~ '^[A-Z]{3}$' THEN 'an account currency that is not a code'
      WHEN length(coalesce(a->>'timezone','')) > 64 OR length(coalesce(a->>'name','')) > 200 THEN 'an account name or zone that is too long'
      WHEN jsonb_typeof(a->'spend') IS DISTINCT FROM 'number' OR (a->>'spend')::numeric < 0 THEN 'an account without its spend'
    END INTO v_bad
  FROM jsonb_array_elements(p->'accounts') a
  WHERE jsonb_typeof(a) <> 'object' OR coalesce(a->>'accountId','') !~ '^[0-9]{5,25}$'
     OR (a->>'currency' IS NOT NULL AND a->>'currency' !~ '^[A-Z]{3}$') OR length(coalesce(a->>'timezone','')) > 64
     OR length(coalesce(a->>'name','')) > 200 OR jsonb_typeof(a->'spend') IS DISTINCT FROM 'number' OR (a->>'spend')::numeric < 0
  LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'The run named %', v_bad USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) <> count(DISTINCT a->>'accountId') FROM jsonb_array_elements(p->'accounts') a) THEN
    RAISE EXCEPTION 'The run named an account twice' USING ERRCODE='22023';
  END IF;

  SELECT CASE
      WHEN jsonb_typeof(t) <> 'object' OR t->>'kind' IS DISTINCT FROM 'days' THEN 'a task that is not a days task'
      WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'accounts') a WHERE a->>'accountId' = t->>'accountId') THEN 'a task for an account not in the run'
      WHEN public.cockpit_meta_ad_days_try_date(t->>'since') IS NULL OR public.cockpit_meta_ad_days_try_date(t->>'until') IS NULL THEN 'a task without its days'
      WHEN public.cockpit_meta_ad_days_try_date(t->>'until') < public.cockpit_meta_ad_days_try_date(t->>'since') THEN 'a task that ends before it starts'
      WHEN public.cockpit_meta_ad_days_try_date(t->>'until') - public.cockpit_meta_ad_days_try_date(t->>'since') > 30 THEN 'a task longer than 31 days'
      WHEN public.cockpit_meta_ad_days_try_date(t->>'since') < v_today - 400 OR public.cockpit_meta_ad_days_try_date(t->>'until') > v_today + 1 THEN 'a task outside the last 400 days'
    END INTO v_bad
  FROM jsonb_array_elements(p->'tasks') t
  WHERE jsonb_typeof(t) <> 'object' OR t->>'kind' IS DISTINCT FROM 'days'
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'accounts') a WHERE a->>'accountId' = t->>'accountId')
     OR public.cockpit_meta_ad_days_try_date(t->>'since') IS NULL OR public.cockpit_meta_ad_days_try_date(t->>'until') IS NULL
     OR public.cockpit_meta_ad_days_try_date(t->>'until') < public.cockpit_meta_ad_days_try_date(t->>'since')
     OR public.cockpit_meta_ad_days_try_date(t->>'until') - public.cockpit_meta_ad_days_try_date(t->>'since') > 30
     OR public.cockpit_meta_ad_days_try_date(t->>'since') < v_today - 400 OR public.cockpit_meta_ad_days_try_date(t->>'until') > v_today + 1
  LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'The run named %', v_bad USING ERRCODE='22023'; END IF;

  v_ties := public.cockpit_meta_ad_days_ties();
  v_hidden := public.cockpit_meta_ad_days_hidden();
  -- Each account: tied to a client (with the client's status), or hidden on
  -- purpose, or not linked.
  SELECT coalesce(jsonb_agg(a || jsonb_build_object(
           'linked', (v_ties->'accounts') ? (a->>'accountId'),
           'locationId', v_ties->'accounts'->(a->>'accountId')->>'locationId',
           'clientName', v_ties->'accounts'->(a->>'accountId')->>'clientName',
           'clientStatus', v_ties->'accounts'->(a->>'accountId')->>'status',
           'hidden', NOT ((v_ties->'accounts') ? (a->>'accountId'))
                     AND public.cockpit_meta_ad_days_is_hidden(v_hidden, a->>'accountId', a->>'name')) ORDER BY a->>'accountId'), '[]'::jsonb)
    INTO v_accounts
  FROM jsonb_array_elements(p->'accounts') a;

  INSERT INTO public.cockpit_meta_ad_day_runs(job, requested_by, graph_version, window_from, window_to, accounts, detail, started_at)
  VALUES (v_job, v_by, nullif(p->>'graphVersion',''), public.cockpit_meta_ad_days_try_date(p->'window'->>'since'),
    public.cockpit_meta_ad_days_try_date(p->'window'->>'until'), v_accounts,
    jsonb_build_object('tieSource', v_ties->>'source', 'clients', (v_ties->>'clients')::int, 'reach', v_reach,
      'internal', coalesce(p->'internal','[]'::jsonb), 'unreadable', coalesce(p->'unreadable','[]'::jsonb),
      'notLinked', coalesce((SELECT jsonb_agg(a->>'accountId') FROM jsonb_array_elements(v_accounts) a
                             WHERE (a->>'linked')::boolean IS NOT TRUE AND (a->>'hidden')::boolean IS NOT TRUE), '[]'::jsonb),
      'hidden', coalesce((SELECT jsonb_agg(a->>'accountId') FROM jsonb_array_elements(v_accounts) a WHERE (a->>'hidden')::boolean IS TRUE), '[]'::jsonb)),
    public.cockpit_meta_ad_days_now())
  RETURNING id INTO v_run;

  INSERT INTO public.cockpit_meta_ad_day_tasks(run_id, kind, account_id, account_name, account_currency, account_timezone, since, until)
  SELECT v_run, 'days', a->>'accountId', left(a->>'name', 200), a->>'currency', a->>'timezone', (t->>'since')::date, (t->>'until')::date
  FROM jsonb_array_elements(p->'tasks') t JOIN jsonb_array_elements(p->'accounts') a ON a->>'accountId' = t->>'accountId'
  ON CONFLICT DO NOTHING;
  IF v_reach IS NOT NULL THEN
    INSERT INTO public.cockpit_meta_ad_day_tasks(run_id, kind, account_id, account_name, account_currency, account_timezone, windows)
    SELECT v_run, CASE v_reach WHEN 'account' THEN 'reach_account' ELSE 'reach_all' END, a->>'accountId', left(a->>'name', 200),
      a->>'currency', a->>'timezone', public.cockpit_meta_reach_windows_json(v_today)
    FROM jsonb_array_elements(p->'accounts') a
    ON CONFLICT DO NOTHING;
  END IF;
  -- A nightly run that asks (p.leadIds, the function since 2026-10-16) also
  -- reads the lead ids of every ad with form leads in the last 31 days, one
  -- task per account (cockpit_meta_lead_ids). An older function does not ask,
  -- so the two can be deployed in either order.
  IF v_job = 'nightly' AND coalesce((p->>'leadIds')::boolean, false) THEN
    INSERT INTO public.cockpit_meta_ad_day_tasks(run_id, kind, account_id, account_name, account_currency, account_timezone, windows, ad_ids)
    SELECT v_run, 'lead_ids', a->>'accountId', left(a->>'name', 200), a->>'currency', a->>'timezone', '[]'::jsonb, x.ads
    FROM jsonb_array_elements(p->'accounts') a
    CROSS JOIN LATERAL (SELECT jsonb_agg(DISTINCT d.ad_id) AS ads FROM public.cockpit_meta_ad_days d
                        WHERE d.account_id = a->>'accountId' AND d.leads > 0 AND d.day >= v_today - 31) x
    WHERE x.ads IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
  SELECT count(*) INTO v_tasks FROM public.cockpit_meta_ad_day_tasks WHERE run_id = v_run;
  UPDATE public.cockpit_meta_ad_day_runs SET tasks_total = v_tasks WHERE id = v_run;
  IF v_tasks = 0 THEN v_state := public.cockpit_meta_ad_days_finish(v_run); END IF;
  RETURN jsonb_build_object('started', true, 'runId', v_run, 'tasks', v_tasks, 'tieSource', v_ties->>'source',
    'notLinked', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', a->>'accountId', 'name', a->>'name'))
                           FROM jsonb_array_elements(v_accounts) a
                           WHERE (a->>'linked')::boolean IS NOT TRUE AND (a->>'hidden')::boolean IS NOT TRUE), '[]'::jsonb),
    'state', coalesce(v_state, 'running'));
END;
$$;

/**
 * How fresh the store is, for the board's read (its SECURITY DEFINER
 * functions call this as the owner) and for the doctor (service role): the
 * last run of each job, the sync-state rows, the queue, each account's last
 * day and last read with its failure if the latest read failed, and the reach
 * rows per level. Since 2026-10-16 each account also carries Meta's status
 * (account_status from the latest run that listed it in the last 3 days, with
 * a word), its client's status, whether it is hidden on purpose, its spend
 * over the last 2 days and its last day with spend; and four lists:
 *   notLinked            spending, tied to no client, not hidden on purpose
 *   hidden               hidden on purpose (a hidden clients row, Mahara's own)
 *   cancelledDelivering  spent in the last 2 days for a cancelled or stopped client
 *   billingStopped       tied to a client that is not cancelled or stopped,
 *                        and Meta says the account is not active (unsettled
 *                        billing, disabled, closed): the board says why
 *                        delivery stopped, with the last day it spent.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
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
             'clientName', v_ties->'accounts'->i.account_id->>'clientName', 'clientStatus', v_ties->'accounts'->i.account_id->>'status',
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
        AND NOT public.cockpit_meta_ad_days_is_hidden(v_hidden, a->>'accountId', a->>'name')), '[]'::jsonb),
    'hidden', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', x->>'accountId', 'name', x->>'name', 'lastSpendDay', x->'lastSpendDay')
                                         ORDER BY x->>'accountId')
                        FROM jsonb_array_elements(v_accounts) x WHERE (x->>'hidden')::boolean), '[]'::jsonb),
    'cancelledDelivering', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', x->>'accountId', 'name', x->>'name',
                                         'clientName', x->>'clientName', 'clientStatus', x->>'clientStatus', 'currency', x->>'currency',
                                         'spend2d', x->'spend2d') ORDER BY x->>'accountId')
                        FROM jsonb_array_elements(v_accounts) x
                        WHERE x->>'clientStatus' IN ('Cancelled', 'Stopped', 'Removed from sheet') AND coalesce((x->>'spend2d')::numeric, 0) > 0), '[]'::jsonb),
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
                   FROM public.cockpit_meta_lead_id_cover v));
END;
$$;

-- ---------------------------------------------------------------------------
-- Meta's lead ids, for "Meta leads not in the CRM" (2026-10-16 check: about
-- 19 form leads in 30 days never became GoHighLevel contacts, Arcturus 5 in
-- three days; lead-sync-watch compares daily counts for 7 days only)

CREATE TABLE IF NOT EXISTS public.cockpit_meta_lead_ids (
  lead_id text PRIMARY KEY CHECK (lead_id ~ '^[0-9]{5,25}$'),
  ad_id text NOT NULL CHECK (ad_id ~ '^[0-9]{5,25}$'),
  account_id text NOT NULL CHECK (account_id ~ '^[0-9]{5,25}$'),
  created_time timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL
);
COMMENT ON TABLE public.cockpit_meta_lead_ids IS
  'Meta''s lead-form leads on the ads with form leads: each nightly meta-ad-days run reads the last 31 days (GET <ad>/leads?fields=id,created_time) and adds them here, so the history grows from the first nightly run; leads older than 180 days are deleted. The lead''s id, its ad and when Meta took it. Never a name, phone, email or answer (field_data is not read). The span each account''s ids cover is in cockpit_meta_lead_id_cover. For matching against the CRM''s contacts by ad: cockpit_meta_leads_not_in_crm.';
CREATE INDEX IF NOT EXISTS cockpit_meta_lead_ids_ad_idx ON public.cockpit_meta_lead_ids(ad_id, created_time);
CREATE INDEX IF NOT EXISTS cockpit_meta_lead_ids_account_idx ON public.cockpit_meta_lead_ids(account_id, created_time);
ALTER TABLE public.cockpit_meta_lead_ids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_meta_lead_ids FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_meta_lead_ids TO service_role;

CREATE TABLE IF NOT EXISTS public.cockpit_meta_lead_id_cover (
  account_id text PRIMARY KEY CHECK (account_id ~ '^[0-9]{5,25}$'),
  covered_from timestamptz NOT NULL,
  read_to timestamptz NOT NULL CHECK (read_to >= covered_from),
  ads int NOT NULL CHECK (ads >= 0),
  ads_unread int NOT NULL CHECK (ads_unread >= 0 AND ads_unread <= ads),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
COMMENT ON TABLE public.cockpit_meta_lead_id_cover IS
  'Per ad account, the span its lead ids in cockpit_meta_lead_ids cover without a gap: covered_from (31 days before the first nightly read, or before the read after a gap longer than 31 days; never more than 180 days back) to read_to (the last read). ads and ads_unread are the last read''s lead ads and those Meta would not show (no lead access on the Page, or an error). Written by cockpit_meta_lead_ids_apply on a lead_ids task''s last call.';
ALTER TABLE public.cockpit_meta_lead_id_cover ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_meta_lead_id_cover FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_meta_lead_id_cover TO service_role;

ALTER TABLE public.cockpit_meta_ad_day_tasks ADD COLUMN IF NOT EXISTS ad_ids jsonb
  CHECK (ad_ids IS NULL OR jsonb_typeof(ad_ids) = 'array');
ALTER TABLE public.cockpit_meta_ad_day_tasks DROP CONSTRAINT IF EXISTS cockpit_meta_ad_day_tasks_kind_check;
ALTER TABLE public.cockpit_meta_ad_day_tasks ADD CONSTRAINT cockpit_meta_ad_day_tasks_kind_check
  CHECK (kind IN ('days','reach_account','reach_all','lead_ids'));
COMMENT ON COLUMN public.cockpit_meta_ad_day_tasks.ad_ids IS 'A lead_ids task''s ads: the account''s ads with form leads in the last 31 days.';

/**
 * Lease up to p.limit (1 to 5) open tasks for p.leaseSeconds (60 to 900):
 * pending ones, or running ones whose lease ran out (4 tries in all). Hourly
 * work first, then nightly, then backfill; days before reach and lead ids. A
 * claim starts the task's counts again, so a retried read is counted once. A
 * lead-ids task carries its ads (adIds).
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_claim(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_limit int := least(greatest(coalesce(nullif(p->>'limit','')::int, 1), 1), 5);
  v_lease interval := make_interval(secs => least(greatest(coalesce(nullif(p->>'leaseSeconds','')::int, 300), 60), 900));
  v_out jsonb;
BEGIN
  PERFORM public.cockpit_meta_ad_days_require_service();
  PERFORM public.cockpit_meta_ad_days_expire();
  WITH picked AS (
    SELECT t.id FROM public.cockpit_meta_ad_day_tasks t JOIN public.cockpit_meta_ad_day_runs r ON r.id = t.run_id
    WHERE r.state = 'running' AND t.attempts < 4
      AND ((t.state = 'pending' AND (t.retry_at IS NULL OR t.retry_at <= public.cockpit_meta_ad_days_now()))
           OR (t.state = 'running' AND t.lease_until < public.cockpit_meta_ad_days_now()))
    ORDER BY CASE r.job WHEN 'hourly' THEN 0 WHEN 'nightly' THEN 1 ELSE 2 END, CASE t.kind WHEN 'days' THEN 0 ELSE 1 END, t.id
    LIMIT v_limit
    FOR UPDATE OF t SKIP LOCKED
  ), claimed AS (
    UPDATE public.cockpit_meta_ad_day_tasks t SET state = 'running', attempts = t.attempts + 1, lease_token = gen_random_uuid(),
      lease_until = public.cockpit_meta_ad_days_now() + v_lease, retry_at = NULL, rows_read = 0, changed = 0, spend = NULL, leads = NULL, updated_at = pg_catalog.now()
    FROM picked WHERE t.id = picked.id
    RETURNING t.*
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'runId', c.run_id, 'job', r.job, 'kind', c.kind, 'accountId', c.account_id, 'accountName', c.account_name,
      'currency', c.account_currency, 'timezone', c.account_timezone,
      'since', to_char(c.since,'YYYY-MM-DD'), 'until', to_char(c.until,'YYYY-MM-DD'), 'windows', c.windows,
      'adIds', c.ad_ids, 'leaseToken', c.lease_token, 'attempt', c.attempts) ORDER BY c.id), '[]'::jsonb)
    INTO v_out
  FROM claimed c JOIN public.cockpit_meta_ad_day_runs r ON r.id = c.run_id;
  RETURN v_out;
END;
$$;

/**
 * A leased task that could not be read: p = {taskId, leaseToken, error,
 * retry}. With retry (Meta's limits, Meta too slow, the database not
 * answering) and tries left it goes back to the queue, not before 3 minutes
 * times the tries so far; otherwise it is failed with the sentence, and the
 * run closes when it was the last.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_fail(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.cockpit_meta_ad_day_tasks; v_retry boolean := coalesce((p->>'retry')::boolean, false); v_state text; v_run text;
BEGIN
  PERFORM public.cockpit_meta_ad_days_require_service();
  t := public.cockpit_meta_ad_days_leased(p, ARRAY['days','reach_account','reach_all','lead_ids']);
  v_state := CASE WHEN v_retry AND t.attempts < 4 THEN 'pending' ELSE 'failed' END;
  UPDATE public.cockpit_meta_ad_day_tasks SET state = v_state, lease_token = NULL, lease_until = NULL,
    retry_at = CASE WHEN v_state = 'pending' THEN public.cockpit_meta_ad_days_now() + make_interval(mins => 3 * t.attempts) END,
    error = left(coalesce(nullif(btrim(p->>'error'), ''), 'The read failed without a reason.'), 500), updated_at = pg_catalog.now()
  WHERE id = t.id;
  IF v_state = 'failed' THEN v_run := public.cockpit_meta_ad_days_finish(t.run_id); END IF;
  RETURN jsonb_build_object('ok', true, 'state', v_state, 'attempts', t.attempts, 'run', v_run);
END;
$$;

/**
 * Write one account's lead ids for a leased lead_ids task: p = {taskId,
 * leaseToken, fetchedAt, rows [{lead_id, ad_id, created_time}], final, note,
 * adsUnread}. Up to 5,000 rows a call, every one on an ad of the task.
 * Upserted by lead id. The last call (final) also records the span the
 * account's ids cover (cockpit_meta_lead_id_cover: 31 days before fetchedAt,
 * joined to the span held when the last read is no older than that) and
 * deletes the account's ids older than 180 days.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_lead_ids_apply(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.cockpit_meta_ad_day_tasks; v_rows jsonb := p->'rows'; v_fetched timestamptz; v_bad text; v_n int;
  v_final boolean := coalesce((p->>'final')::boolean, false); v_state text; v_ads int;
BEGIN
  PERFORM public.cockpit_meta_ad_days_require_service();
  t := public.cockpit_meta_ad_days_leased(p, ARRAY['lead_ids']);
  v_ads := jsonb_array_length(coalesce(t.ad_ids, '[]'::jsonb));
  IF jsonb_typeof(v_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(v_rows) > 5000 THEN
    RAISE EXCEPTION 'Send rows as a list of at most 5000' USING ERRCODE='22023';
  END IF;
  BEGIN
    v_fetched := (p->>'fetchedAt')::timestamptz;
  EXCEPTION WHEN others THEN v_fetched := NULL;
  END;
  IF v_fetched IS NULL OR v_fetched > public.cockpit_meta_ad_days_now() + interval '5 minutes'
     OR v_fetched < public.cockpit_meta_ad_days_now() - interval '1 hour' THEN
    RAISE EXCEPTION 'fetchedAt must be when Meta answered, within the last hour' USING ERRCODE='22023';
  END IF;
  SELECT x.why INTO v_bad FROM (
    SELECT CASE
        WHEN r.lead_id IS NULL OR r.lead_id !~ '^[0-9]{5,25}$' THEN 'a lead without a valid id'
        WHEN r.ad_id IS NULL OR NOT (coalesce(t.ad_ids, '[]'::jsonb) ? r.ad_id) THEN 'a lead on an ad the task did not ask for'
        WHEN r.created_time IS NULL OR r.created_time > public.cockpit_meta_ad_days_now() + interval '1 hour' THEN 'a lead without its time'
      END AS why
    FROM jsonb_to_recordset(v_rows) AS r(lead_id text, ad_id text, created_time timestamptz)
  ) x WHERE x.why IS NOT NULL LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Meta''s leads for act_% held %; nothing was written', t.account_id, v_bad USING ERRCODE='22023'; END IF;
  INSERT INTO public.cockpit_meta_lead_ids AS x (lead_id, ad_id, account_id, created_time, fetched_at)
  SELECT DISTINCT ON (r.lead_id) r.lead_id, r.ad_id, t.account_id, r.created_time, v_fetched
  FROM jsonb_to_recordset(v_rows) AS r(lead_id text, ad_id text, created_time timestamptz)
  ORDER BY r.lead_id
  ON CONFLICT (lead_id) DO UPDATE SET ad_id = EXCLUDED.ad_id, account_id = EXCLUDED.account_id,
    created_time = EXCLUDED.created_time, fetched_at = EXCLUDED.fetched_at
  WHERE x.fetched_at <= EXCLUDED.fetched_at;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.cockpit_meta_ad_day_tasks SET rows_read = rows_read + v_n,
    leads = coalesce(leads, 0) + jsonb_array_length(v_rows),
    note = coalesce(left(nullif(btrim(p->>'note'), ''), 300), note),
    state = CASE WHEN v_final THEN 'done' ELSE state END,
    error = CASE WHEN v_final THEN NULL ELSE error END,
    lease_token = CASE WHEN v_final THEN NULL ELSE lease_token END,
    lease_until = CASE WHEN v_final THEN NULL ELSE public.cockpit_meta_ad_days_now() + interval '5 minutes' END,
    updated_at = pg_catalog.now()
  WHERE id = t.id;
  IF v_final THEN
    -- The read asked Meta for the leads after (start of the read - 31 days),
    -- so fetchedAt - 31 days is covered. A last read older than that leaves a
    -- gap, and the span starts again.
    INSERT INTO public.cockpit_meta_lead_id_cover AS x (account_id, covered_from, read_to, ads, ads_unread, updated_at)
    VALUES (t.account_id, v_fetched - interval '31 days', v_fetched, v_ads,
      least(CASE WHEN p->>'adsUnread' ~ '^[0-9]{1,6}$' THEN (p->>'adsUnread')::int ELSE 0 END, v_ads), pg_catalog.now())
    ON CONFLICT (account_id) DO UPDATE SET
      covered_from = CASE WHEN x.read_to < EXCLUDED.covered_from THEN EXCLUDED.covered_from
                          ELSE least(x.covered_from, EXCLUDED.covered_from) END,
      read_to = greatest(x.read_to, EXCLUDED.read_to), ads = EXCLUDED.ads, ads_unread = EXCLUDED.ads_unread,
      updated_at = pg_catalog.now();
    DELETE FROM public.cockpit_meta_lead_ids
    WHERE account_id = t.account_id AND created_time < public.cockpit_meta_ad_days_now() - interval '180 days';
    UPDATE public.cockpit_meta_lead_id_cover SET covered_from = public.cockpit_meta_ad_days_now() - interval '180 days'
    WHERE account_id = t.account_id AND covered_from < public.cockpit_meta_ad_days_now() - interval '180 days';
    v_state := public.cockpit_meta_ad_days_finish(t.run_id);
  END IF;
  RETURN jsonb_build_object('ok', true, 'written', v_n, 'final', v_final, 'run', v_state);
END;
$$;

/**
 * Meta's form leads that did not become a CRM contact, per client, for the
 * Kuwait days p_from..p_to (at most 93). One lead to one contact, per ad:
 * Meta's leads and the CRM contacts on the ad (not deleted) in time order.
 * First each lead takes the earliest free contact created within 10 minutes
 * of it (a lead reaches GoHighLevel within minutes); then each lead still
 * alone takes the earliest free contact from 10 minutes before it to a day
 * after it (a late sync). The leads of the two days before the window and of
 * the day after it take part, so the next day's contacts pair with the next
 * day's leads and never cover a lead of the window that did not arrive (the
 * 2026-10-16 review: a count of contacts up to a day after the window gave
 * Arcturus 1 missing lead over 30 days where the lead-by-lead check found 5).
 * notInCrm = the window's leads left without a contact.
 *
 * Known only where Meta's lead ids are held. The clients are those with form
 * leads in the days (cockpit_meta_ad_days); per account the ids cover
 * cockpit_meta_lead_id_cover.covered_from to read_to. A client with an account
 * never read, an account whose ids start after the window's first moment, or
 * every lead ad unread (no lead access on the Page: Ardon) gets metaLeads,
 * inCrm and notInCrm NULL with a note, never 0. Some ads unread: the numbers
 * stand for the ads read, with a note. A window running past the last read
 * (today) counts the leads to it, and the note says when. Website (pixel)
 * leads are not in Meta's Leads API, so metaLeads can be under
 * cockpit_meta_ad_days.leads (Atlantis 4). Bulk uploads (Ardon, نهوض نجد) land
 * on the upload's day, so a lead uploaded more than a day late counts as not in
 * the CRM.
 * [{locationId, metaLeads, inCrm, notInCrm, coveredFrom, readTo, note}].
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_leads_not_in_crm(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_from timestamptz; v_to timestamptz; g record; r record;
  v_l timestamptz[]; v_c timestamptz[]; v_lm boolean[]; v_cu boolean[];
  v_nl int; v_nc int; v_hi interval; v_pass int; i int; j int;
  v_meta int; v_miss int; v_note text; v_known boolean;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'Choose up to 93 days' USING ERRCODE='22023';
  END IF;
  IF to_regclass('public.cockpit_board_clients') IS NULL OR to_regclass('public.client_leads') IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  v_from := p_from::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_to := (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait';
  FOR g IN EXECUTE $q$
    WITH c AS (
      SELECT DISTINCT b.location_id, regexp_replace(btrim(x), '^act_', '') AS account_id
      FROM public.cockpit_board_clients b CROSS JOIN LATERAL unnest(coalesce(b.ad_account_ids, '{}'::text[])) x
    ), f AS (
      SELECT DISTINCT c.location_id, c.account_id
      FROM c JOIN public.cockpit_meta_ad_days d ON d.account_id = c.account_id
      WHERE d.day BETWEEN $1 AND $2 AND d.leads > 0
    )
    SELECT f.location_id,
      string_agg('act_' || f.account_id, ', ' ORDER BY f.account_id) FILTER (WHERE v.account_id IS NULL) AS never_read,
      max(v.covered_from) AS covered_from, min(v.read_to) AS read_to,
      coalesce(sum(v.ads), 0)::int AS ads, coalesce(sum(v.ads_unread), 0)::int AS ads_unread
    FROM f LEFT JOIN public.cockpit_meta_lead_id_cover v ON v.account_id = f.account_id
    GROUP BY f.location_id
    ORDER BY f.location_id
  $q$ USING p_from, p_to
  LOOP
    v_known := true;
    v_note := NULL;
    IF g.never_read IS NOT NULL THEN
      v_known := false;
      v_note := format('Meta''s lead ids for %s have not been read yet (the nightly run reads them), so leads not in the CRM are not known.', g.never_read);
    ELSIF g.covered_from > v_from THEN
      v_known := false;
      v_note := format('Meta''s lead ids are held from %s Kuwait time; this window starts earlier, so leads not in the CRM are not known for it.',
        to_char(g.covered_from AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD HH24:MI'));
    ELSIF g.ads > 0 AND g.ads_unread >= g.ads THEN
      v_known := false;
      v_note := 'Meta does not show this client''s form leads to Mahara (the Page has not given Mahara''s business lead access), so leads not in the CRM are not known.';
    END IF;
    IF NOT v_known THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('locationId', g.location_id, 'metaLeads', NULL, 'inCrm', NULL,
        'notInCrm', NULL, 'coveredFrom', g.covered_from, 'readTo', g.read_to, 'note', v_note));
      CONTINUE;
    END IF;
    v_meta := 0;
    v_miss := 0;
    FOR r IN EXECUTE $q$
      WITH a AS (
        SELECT DISTINCT regexp_replace(btrim(x), '^act_', '') AS account_id
        FROM public.cockpit_board_clients b CROSS JOIN LATERAL unnest(coalesce(b.ad_account_ids, '{}'::text[])) x
        WHERE b.location_id = $1
      ), ads AS (
        SELECT DISTINCT l.ad_id FROM public.cockpit_meta_lead_ids l JOIN a ON a.account_id = l.account_id
        WHERE l.created_time >= $2 AND l.created_time < $3
      )
      SELECT ads.ad_id,
        ARRAY(SELECT l.created_time FROM public.cockpit_meta_lead_ids l
              WHERE l.ad_id = ads.ad_id AND l.created_time >= $2 - interval '2 days' AND l.created_time < $3 + interval '1 day'
              ORDER BY l.created_time, l.lead_id) AS leads,
        ARRAY(SELECT cl.created_at FROM public.client_leads cl
              WHERE cl.location_id = $1 AND cl.ad_id = ads.ad_id AND NOT coalesce(cl.deleted, false)
                AND cl.created_at >= $2 - interval '2 days 10 minutes' AND cl.created_at < $3 + interval '2 days'
              ORDER BY cl.created_at) AS crm
      FROM ads
    $q$ USING g.location_id, v_from, v_to
    LOOP
      v_l := r.leads;
      v_c := r.crm;
      v_nl := coalesce(array_length(v_l, 1), 0);
      v_nc := coalesce(array_length(v_c, 1), 0);
      v_lm := array_fill(false, ARRAY[greatest(v_nl, 1)]);
      v_cu := array_fill(false, ARRAY[greatest(v_nc, 1)]);
      FOR v_pass IN 1..2 LOOP
        v_hi := CASE v_pass WHEN 1 THEN interval '10 minutes' ELSE interval '1 day' END;
        FOR i IN 1..v_nl LOOP
          CONTINUE WHEN v_lm[i];
          FOR j IN 1..v_nc LOOP
            EXIT WHEN v_c[j] > v_l[i] + v_hi;
            IF NOT v_cu[j] AND v_c[j] >= v_l[i] - interval '10 minutes' THEN
              v_lm[i] := true;
              v_cu[j] := true;
              EXIT;
            END IF;
          END LOOP;
        END LOOP;
      END LOOP;
      FOR i IN 1..v_nl LOOP
        IF v_l[i] >= v_from AND v_l[i] < v_to THEN
          v_meta := v_meta + 1;
          IF NOT v_lm[i] THEN v_miss := v_miss + 1; END IF;
        END IF;
      END LOOP;
    END LOOP;
    v_note := nullif(concat_ws(' ',
      CASE WHEN g.ads_unread > 0 THEN format('Meta did not show the leads of %s of %s lead ads (no lead access on the Page, or an error); their leads are not counted.', g.ads_unread, g.ads) END,
      CASE WHEN g.read_to < v_to THEN format('Meta''s leads are read to %s Kuwait time; later leads wait for the next nightly run.',
        to_char(g.read_to AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD HH24:MI')) END), '');
    v_out := v_out || jsonb_build_array(jsonb_build_object('locationId', g.location_id, 'metaLeads', v_meta, 'inCrm', v_meta - v_miss,
      'notInCrm', v_miss, 'coveredFrom', g.covered_from, 'readTo', g.read_to, 'note', v_note));
  END LOOP;
  RETURN v_out;
END;
$$;


-- ---------------------------------------------------------------------------
-- Function privileges: the new helpers for nobody (definer functions and the
-- board's own reads call them as the owner); the replaced ones keep theirs.

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['cockpit_meta_ad_days_status_label(int)', 'cockpit_meta_ad_days_hidden()',
    'cockpit_meta_ad_days_is_hidden(jsonb,text,text)', 'cockpit_meta_reach_windows(date)', 'cockpit_meta_ad_days_ties()',
    'cockpit_meta_reach_rebuild_clients()', 'cockpit_meta_ad_days_finish(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['cockpit_meta_ad_days_inputs(jsonb)', 'cockpit_meta_ad_days_begin(jsonb)', 'cockpit_meta_ad_days_status()',
    'cockpit_meta_ad_days_claim(jsonb)', 'cockpit_meta_ad_days_fail(jsonb)', 'cockpit_meta_lead_ids_apply(jsonb)',
    'cockpit_meta_leads_not_in_crm(date,date)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
