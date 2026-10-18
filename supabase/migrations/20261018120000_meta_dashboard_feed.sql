-- Meta for the creative dashboard, from meta-ad-days, 2026-10-18
-- (Creative Triage bldgtotkfmhoxmlzowdx).
--
-- Muhammed, 2026-10-18: the creative dashboard's own Meta sync has been refused
-- since 2 Oct ("API access blocked": its Meta app's only admin is a banned
-- Facebook account), so ads_daily_snapshots stopped at 2 Oct 18:32 Kuwait. That
-- table feeds the dashboard and also the CEO refresh, the client portal, cockpit
-- sync and the Hermes skills. meta-ad-days reads the same ads hourly with
-- Mahara's system-user token: on the 1,776 ad-days both held (18 Jul to 1 Oct)
-- spend, impressions, link clicks and leads were equal. Decision: meta-ad-days is
-- the one Meta ad reader, and the dashboard takes Meta from it. This file adds
-- what the dashboard needs and the feed:
--
--   cockpit_meta_ad_days.clicks   all clicks (Meta's `clicks`), the dashboard's clicks and CTR
--   cockpit_meta_ad_days_apply    the same apply, clicks added
--   cockpit_meta_ads              one row per ad: name, status, campaign status, thumbnail;
--                                 read by the days task that reaches today (run.ts workDays)
--   cockpit_meta_ads_apply        its service RPC, lease-checked like apply
--   cockpit_meta_feed_runs        one row per feed call: what it read, wrote and found
--   cockpit_meta_feed_run         the feed (internal): new and changed ad-days into
--                                 ads_daily_snapshots for the dashboard's active clients, a
--                                 client row for a new spending account (the dashboard's old
--                                 discovery), and sync_jobs for each Meta client
--   cockpit_meta_feed_snapshots   the same for the service role: a window, some accounts, a dry run
--   cockpit_meta_feed_tick        pg_cron's call: mahara-meta-dashboard-feed, every 10 minutes
--                                 from minute 4, so the :07 hourly run lands within 20 minutes
--
-- Rules:
--   - The feed writes Meta rows only (platform 'meta'). TikTok stays with the
--     dashboard's own sync.
--   - A snapshot row is written only when a value changed or the worker read it
--     again. A value the worker does not hold (a thumbnail or status it could not
--     read, all clicks on a day read before this file) keeps the stored value.
--   - An ad that a complete read (every status Meta lists, which is all but
--     DELETED) no longer returns is DELETED.
--   - Excluded ads stay out: the snapshot trigger cockpit_skip_excluded_ad_snapshot
--     drops them.
--   - sync_jobs says, per active Meta client, whether the worker's last hourly run
--     read its ad account, and why not (the worker is stale, the account is hidden
--     on purpose, or the business does not list it). It never says success when
--     no hourly run finished in the last 3 hours. A client with a TikTok account
--     too is left to the dashboard's sync.
--   - Missing is never zero: cockpit_sync_state 'meta-dashboard-feed' and the run
--     rows say when the feed last worked, what failed, and how many calls failed
--     since.
--
-- Safe to apply twice. Order-free with the function deploy: an older function
-- sends no clicks (NULL) and never calls cockpit_meta_ads_apply; a newer function
-- on an older database notes that statuses and thumbnails were not stored.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.cockpit_meta_ad_days') IS NULL OR to_regclass('public.cockpit_sync_state') IS NULL THEN
    RAISE EXCEPTION 'The Meta ad-day store (20261016121700_meta_ad_days.sql) is missing';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. All clicks on the ad-day, and the feed's index

ALTER TABLE public.cockpit_meta_ad_days ADD COLUMN IF NOT EXISTS clicks bigint CHECK (clicks IS NULL OR clicks >= 0);
COMMENT ON COLUMN public.cockpit_meta_ad_days.clicks IS
  'Meta''s clicks (all clicks: link, profile, reactions, expand). NULL on a day last read before 2026-10-18; the next read fills it. Link CTR uses link_clicks, never this.';
CREATE INDEX IF NOT EXISTS cockpit_meta_ad_days_fetched_idx ON public.cockpit_meta_ad_days(fetched_at);

CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_apply(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.cockpit_meta_ad_day_tasks; v_rows jsonb := p->'rows'; v_fetched timestamptz; v_rate numeric; v_bad text;
  v_n int; v_new int; v_changed int; v_older int; v_spend numeric; v_leads bigint; v_final boolean := coalesce((p->>'final')::boolean, false);
  v_state text;
BEGIN
  PERFORM public.cockpit_meta_ad_days_require_service();
  t := public.cockpit_meta_ad_days_leased(p, ARRAY['days']);
  IF jsonb_typeof(v_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Send rows as a list' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(v_rows) > 2000 THEN RAISE EXCEPTION 'At most 2000 rows a call' USING ERRCODE='22023'; END IF;
  BEGIN
    v_fetched := (p->>'fetchedAt')::timestamptz;
  EXCEPTION WHEN others THEN v_fetched := NULL;
  END;
  IF v_fetched IS NULL OR v_fetched > public.cockpit_meta_ad_days_now() + interval '5 minutes'
     OR v_fetched < public.cockpit_meta_ad_days_now() - interval '1 hour' THEN
    RAISE EXCEPTION 'fetchedAt must be when Meta answered, within the last hour' USING ERRCODE='22023';
  END IF;
  v_rate := public.cockpit_meta_ad_days_usd_per(t.account_currency);

  SELECT x.why INTO v_bad FROM (
    SELECT CASE
        WHEN r.ad_id IS NULL OR r.ad_id !~ '^[0-9]{5,25}$' THEN 'a row without a valid ad id'
        WHEN r.day IS NULL OR r.day < t.since OR r.day > t.until THEN 'a row for a day outside the task''s days'
        WHEN r.account_id IS DISTINCT FROM t.account_id THEN 'a row from another ad account'
        WHEN (r.campaign_id IS NOT NULL AND r.campaign_id !~ '^[0-9]{5,25}$') OR (r.adset_id IS NOT NULL AND r.adset_id !~ '^[0-9]{5,25}$') THEN 'a campaign or ad set id that is not one'
        WHEN least(r.spend, r.frequency) < 0 OR least(r.impressions, r.reach, r.clicks, r.link_clicks, r.leads, r.lead_actions, r.landing_page_views,
               r.video_plays, r.video_3s, r.video_p25, r.video_p50, r.video_p75, r.video_p100, r.thruplays) < 0 THEN 'a negative number'
        WHEN r.leads > r.lead_actions THEN 'more leads than lead actions'
        WHEN r.destination_type IS NOT NULL AND r.destination_type !~ '^[A-Z_]{1,60}$' THEN 'a destination that is not one of Meta''s names'
        WHEN r.leads IS NOT NULL AND (r.destination_type IN ('WHATSAPP','MESSENGER','INSTAGRAM_DIRECT','LEAD_FROM_MESSENGER','LEAD_FROM_IG_DIRECT')
               OR r.destination_type LIKE 'MESSAGING\_%') THEN 'form leads on a chat ad set'
      END AS why
    FROM jsonb_to_recordset(v_rows) AS r(account_id text, day date, campaign_id text, adset_id text, ad_id text, spend numeric, frequency numeric,
      impressions bigint, reach bigint, clicks bigint, link_clicks bigint, leads bigint, lead_actions bigint, landing_page_views bigint, video_plays bigint,
      video_3s bigint, video_p25 bigint, video_p50 bigint, video_p75 bigint, video_p100 bigint, thruplays bigint, destination_type text)
  ) x WHERE x.why IS NOT NULL LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Meta''s rows for act_% held %; nothing was written', t.account_id, v_bad USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) <> count(DISTINCT (r->>'ad_id') || '|' || (r->>'day')) FROM jsonb_array_elements(v_rows) r) THEN
    RAISE EXCEPTION 'Meta''s rows for act_% held one ad twice on a day; nothing was written', t.account_id USING ERRCODE='22023';
  END IF;

  SELECT count(*)::int, count(*) FILTER (WHERE x.ad_id IS NULL)::int,
         count(*) FILTER (WHERE x.ad_id IS NOT NULL AND x.fetched_at <= v_fetched AND
           (x.account_id, x.campaign_id, x.campaign_name, x.objective, x.adset_id, x.adset_name, x.ad_name, x.spend, x.impressions, x.reach,
            x.frequency, x.clicks, x.link_clicks, x.leads, x.lead_actions, x.landing_page_views, x.video_plays, x.video_3s, x.video_p25, x.video_p50,
            x.video_p75, x.video_p100, x.thruplays, x.destination_type)
           IS DISTINCT FROM
           (r.account_id, r.campaign_id, r.campaign_name, r.objective, r.adset_id, r.adset_name, r.ad_name, r.spend, r.impressions, r.reach,
            r.frequency, r.clicks, r.link_clicks, r.leads, r.lead_actions, r.landing_page_views, r.video_plays, r.video_3s, r.video_p25, r.video_p50,
            r.video_p75, r.video_p100, r.thruplays, r.destination_type))::int,
         count(*) FILTER (WHERE x.fetched_at > v_fetched)::int,
         sum(r.spend), sum(r.leads)
    INTO v_n, v_new, v_changed, v_older, v_spend, v_leads
  FROM jsonb_to_recordset(v_rows) AS r(account_id text, day date, campaign_id text, campaign_name text, objective text, adset_id text,
      adset_name text, ad_id text, ad_name text, spend numeric, impressions bigint, reach bigint, frequency numeric, clicks bigint, link_clicks bigint,
      leads bigint, lead_actions bigint, landing_page_views bigint, video_plays bigint, video_3s bigint, video_p25 bigint, video_p50 bigint,
      video_p75 bigint, video_p100 bigint, thruplays bigint, destination_type text)
  LEFT JOIN public.cockpit_meta_ad_days x ON x.ad_id = r.ad_id AND x.day = r.day;

  INSERT INTO public.cockpit_meta_ad_days AS x(account_id, account_name, account_timezone, account_currency, day, campaign_id, campaign_name,
    objective, adset_id, adset_name, ad_id, ad_name, spend, spend_usd, usd_rate, impressions, reach, frequency, clicks, link_clicks, leads, lead_actions,
    landing_page_views, video_plays, video_3s, video_p25, video_p50, video_p75, video_p100, thruplays, destination_type, fetched_at)
  SELECT t.account_id, t.account_name, t.account_timezone, t.account_currency, r.day, r.campaign_id, left(r.campaign_name, 400), left(r.objective, 60),
    r.adset_id, left(r.adset_name, 400), r.ad_id, left(r.ad_name, 400), r.spend,
    CASE WHEN r.spend IS NOT NULL AND v_rate IS NOT NULL THEN round(r.spend * v_rate, 6) END,
    CASE WHEN r.spend IS NOT NULL AND v_rate IS NOT NULL THEN v_rate END,
    r.impressions, r.reach, r.frequency, r.clicks, r.link_clicks, r.leads, r.lead_actions, r.landing_page_views, r.video_plays, r.video_3s,
    r.video_p25, r.video_p50, r.video_p75, r.video_p100, r.thruplays, r.destination_type, v_fetched
  FROM jsonb_to_recordset(v_rows) AS r(day date, campaign_id text, campaign_name text, objective text, adset_id text, adset_name text,
      ad_id text, ad_name text, spend numeric, impressions bigint, reach bigint, frequency numeric, clicks bigint, link_clicks bigint, leads bigint,
      lead_actions bigint, landing_page_views bigint, video_plays bigint, video_3s bigint, video_p25 bigint, video_p50 bigint, video_p75 bigint,
      video_p100 bigint, thruplays bigint, destination_type text)
  ON CONFLICT (ad_id, day) DO UPDATE SET
    account_id = EXCLUDED.account_id, account_name = EXCLUDED.account_name, account_timezone = EXCLUDED.account_timezone,
    account_currency = EXCLUDED.account_currency, campaign_id = EXCLUDED.campaign_id, campaign_name = EXCLUDED.campaign_name,
    objective = EXCLUDED.objective, adset_id = EXCLUDED.adset_id, adset_name = EXCLUDED.adset_name, ad_name = EXCLUDED.ad_name,
    spend = EXCLUDED.spend, spend_usd = EXCLUDED.spend_usd, usd_rate = EXCLUDED.usd_rate, impressions = EXCLUDED.impressions,
    reach = EXCLUDED.reach, frequency = EXCLUDED.frequency, clicks = EXCLUDED.clicks, link_clicks = EXCLUDED.link_clicks, leads = EXCLUDED.leads,
    lead_actions = EXCLUDED.lead_actions, landing_page_views = EXCLUDED.landing_page_views, video_plays = EXCLUDED.video_plays,
    video_3s = EXCLUDED.video_3s, video_p25 = EXCLUDED.video_p25, video_p50 = EXCLUDED.video_p50, video_p75 = EXCLUDED.video_p75,
    video_p100 = EXCLUDED.video_p100, thruplays = EXCLUDED.thruplays, destination_type = EXCLUDED.destination_type,
    fetched_at = EXCLUDED.fetched_at
  WHERE x.fetched_at <= EXCLUDED.fetched_at;

  UPDATE public.cockpit_meta_ad_day_tasks SET rows_read = rows_read + v_n, changed = changed + v_new + v_changed,
    spend = CASE WHEN v_spend IS NULL THEN spend ELSE coalesce(spend, 0) + v_spend END,
    leads = CASE WHEN v_leads IS NULL THEN leads ELSE coalesce(leads, 0) + v_leads END,
    note = coalesce(left(nullif(btrim(p->>'note'), ''), 300), note),
    state = CASE WHEN v_final THEN 'done' ELSE state END,
    error = CASE WHEN v_final THEN NULL ELSE error END,
    lease_token = CASE WHEN v_final THEN NULL ELSE lease_token END,
    lease_until = CASE WHEN v_final THEN NULL ELSE public.cockpit_meta_ad_days_now() + interval '5 minutes' END,
    updated_at = pg_catalog.now()
  WHERE id = t.id;
  IF v_final THEN v_state := public.cockpit_meta_ad_days_finish(t.run_id); END IF;
  RETURN jsonb_build_object('ok', true, 'written', v_n - v_older, 'inserted', v_new, 'changed', v_changed, 'olderThanStored', v_older,
    'final', v_final, 'run', v_state);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The ads: what the dashboard shows beside the numbers

CREATE TABLE IF NOT EXISTS public.cockpit_meta_ads (
  ad_id text PRIMARY KEY CHECK (ad_id ~ '^[0-9]{5,25}$'),
  account_id text NOT NULL CHECK (account_id ~ '^[0-9]{5,25}$'),
  ad_name text CHECK (ad_name IS NULL OR length(ad_name) <= 400),
  effective_status text CHECK (effective_status IS NULL OR effective_status ~ '^[A-Z_]{1,40}$'),
  campaign_id text CHECK (campaign_id IS NULL OR campaign_id ~ '^[0-9]{5,25}$'),
  campaign_name text CHECK (campaign_name IS NULL OR length(campaign_name) <= 400),
  campaign_status text CHECK (campaign_status IS NULL OR campaign_status ~ '^[A-Z_]{1,40}$'),
  thumbnail_url text CHECK (thumbnail_url IS NULL OR (thumbnail_url ~ '^https://' AND length(thumbnail_url) <= 2048)),
  fetched_at timestamptz NOT NULL,
  changed_at timestamptz NOT NULL
);
COMMENT ON TABLE public.cockpit_meta_ads IS
  'One row per Meta ad of a spending account of Mahara''s business: its name, effective status, campaign and campaign status, and a thumbnail an ad blocker does not drop (720x405). Written by meta-ad-days (cockpit_meta_ads_apply) on the days task that reaches today: hourly the statuses the dashboard shows, nightly and on a backfill every status Meta lists, after which an ad it no longer lists is DELETED. fetched_at is the last read, changed_at the last change (the feed reads by it). A thumbnail link is Meta''s signed CDN link and expires; the next read renews it.';
CREATE INDEX IF NOT EXISTS cockpit_meta_ads_account_idx ON public.cockpit_meta_ads(account_id);
CREATE INDEX IF NOT EXISTS cockpit_meta_ads_changed_idx ON public.cockpit_meta_ads(changed_at);

CREATE TABLE IF NOT EXISTS public.cockpit_meta_feed_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  ok boolean NOT NULL,
  mode text NOT NULL CHECK (mode IN ('tick','window')),
  dry_run boolean NOT NULL DEFAULT false,
  requested_by text NOT NULL CHECK (length(requested_by) <= 80),
  since date,
  until date,
  accounts text[],
  watermark timestamptz,
  through timestamptz,
  ad_days_read integer,
  rows_unmapped integer,
  rows_inserted integer,
  rows_updated integer,
  clients_added integer,
  clients_current integer,
  clients_unread integer,
  worker_run_at timestamptz,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  detail jsonb
);
COMMENT ON TABLE public.cockpit_meta_feed_runs IS
  'One row per call of the Meta feed into ads_daily_snapshots (cockpit_meta_feed_run): the window or the watermark it read from, the ad-days read, rows inserted and updated, ad-days with no active dashboard client, clients added, Meta clients current and not read, and the error when it failed. Kept 30 days.';
CREATE INDEX IF NOT EXISTS cockpit_meta_feed_runs_started_idx ON public.cockpit_meta_feed_runs(started_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_meta_ads','cockpit_meta_feed_runs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
  END LOOP;
END $$;

/**
 * One account's ads as a days task read them: {taskId, leaseToken, fetchedAt,
 * complete, rows: [{ad_id, ad_name, effective_status, campaign_id,
 * campaign_name, campaign_status, thumbnail_url}]}. A value Meta did not give
 * keeps the stored one. complete (every status Meta lists) marks the account's
 * ads of the last 40 days that the read did not return as DELETED. The task's
 * own state is the days apply's to change.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ads_apply(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.cockpit_meta_ad_day_tasks; v_rows jsonb := p->'rows'; v_fetched timestamptz; v_bad text;
  v_complete boolean := coalesce((p->>'complete')::boolean, false); v_n int; v_changed int; v_gone int := 0;
BEGIN
  PERFORM public.cockpit_meta_ad_days_require_service();
  t := public.cockpit_meta_ad_days_leased(p, ARRAY['days']);
  IF jsonb_typeof(v_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Send rows as a list' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(v_rows) > 5000 THEN RAISE EXCEPTION 'At most 5000 ads a call' USING ERRCODE='22023'; END IF;
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
        WHEN r.ad_id IS NULL OR r.ad_id !~ '^[0-9]{5,25}$' THEN 'an ad without a valid id'
        WHEN r.campaign_id IS NOT NULL AND r.campaign_id !~ '^[0-9]{5,25}$' THEN 'a campaign id that is not one'
        WHEN r.effective_status IS NOT NULL AND r.effective_status !~ '^[A-Z_]{1,40}$' THEN 'a status that is not one of Meta''s names'
        WHEN r.campaign_status IS NOT NULL AND r.campaign_status !~ '^[A-Z_]{1,40}$' THEN 'a campaign status that is not one of Meta''s names'
        WHEN r.thumbnail_url IS NOT NULL AND (r.thumbnail_url !~ '^https://' OR length(r.thumbnail_url) > 2048) THEN 'a thumbnail that is not an https link'
      END AS why
    FROM jsonb_to_recordset(v_rows) AS r(ad_id text, campaign_id text, effective_status text, campaign_status text, thumbnail_url text)
  ) x WHERE x.why IS NOT NULL LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Meta''s ads for act_% held %; nothing was written', t.account_id, v_bad USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) <> count(DISTINCT r->>'ad_id') FROM jsonb_array_elements(v_rows) r) THEN
    RAISE EXCEPTION 'Meta''s ads for act_% held one ad twice; nothing was written', t.account_id USING ERRCODE='22023';
  END IF;

  WITH r AS (
    SELECT r.ad_id, left(r.ad_name, 400) AS ad_name, r.effective_status, r.campaign_id, left(r.campaign_name, 400) AS campaign_name,
           r.campaign_status, r.thumbnail_url
    FROM jsonb_to_recordset(v_rows) AS r(ad_id text, ad_name text, effective_status text, campaign_id text, campaign_name text,
      campaign_status text, thumbnail_url text)
  ), up AS (
    INSERT INTO public.cockpit_meta_ads AS x(ad_id, account_id, ad_name, effective_status, campaign_id, campaign_name, campaign_status,
      thumbnail_url, fetched_at, changed_at)
    SELECT r.ad_id, t.account_id, r.ad_name, r.effective_status, r.campaign_id, r.campaign_name, r.campaign_status, r.thumbnail_url,
      v_fetched, v_fetched
    FROM r
    ON CONFLICT (ad_id) DO UPDATE SET
      account_id = EXCLUDED.account_id,
      ad_name = coalesce(EXCLUDED.ad_name, x.ad_name),
      effective_status = coalesce(EXCLUDED.effective_status, x.effective_status),
      campaign_id = coalesce(EXCLUDED.campaign_id, x.campaign_id),
      campaign_name = coalesce(EXCLUDED.campaign_name, x.campaign_name),
      campaign_status = coalesce(EXCLUDED.campaign_status, x.campaign_status),
      thumbnail_url = coalesce(EXCLUDED.thumbnail_url, x.thumbnail_url),
      fetched_at = EXCLUDED.fetched_at,
      changed_at = CASE WHEN (x.account_id, x.ad_name, x.effective_status, x.campaign_id, x.campaign_name, x.campaign_status, x.thumbnail_url)
          IS DISTINCT FROM (EXCLUDED.account_id, coalesce(EXCLUDED.ad_name, x.ad_name), coalesce(EXCLUDED.effective_status, x.effective_status),
            coalesce(EXCLUDED.campaign_id, x.campaign_id), coalesce(EXCLUDED.campaign_name, x.campaign_name),
            coalesce(EXCLUDED.campaign_status, x.campaign_status), coalesce(EXCLUDED.thumbnail_url, x.thumbnail_url))
        THEN EXCLUDED.fetched_at ELSE x.changed_at END
    WHERE x.fetched_at <= EXCLUDED.fetched_at
    RETURNING x.changed_at = v_fetched AS changed
  )
  SELECT count(*)::int, count(*) FILTER (WHERE up.changed)::int INTO v_n, v_changed FROM up;

  IF v_complete THEN
    WITH gone AS (
      SELECT DISTINCT d.ad_id FROM public.cockpit_meta_ad_days d
      WHERE d.account_id = t.account_id AND d.day >= public.cockpit_meta_ad_days_today() - 40
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r->>'ad_id' = d.ad_id)
    ), up AS (
      INSERT INTO public.cockpit_meta_ads AS x(ad_id, account_id, effective_status, fetched_at, changed_at)
      SELECT g.ad_id, t.account_id, 'DELETED', v_fetched, v_fetched FROM gone g
      ON CONFLICT (ad_id) DO UPDATE SET effective_status = 'DELETED', fetched_at = EXCLUDED.fetched_at,
        changed_at = CASE WHEN x.effective_status IS DISTINCT FROM 'DELETED' THEN EXCLUDED.fetched_at ELSE x.changed_at END
      WHERE x.fetched_at <= EXCLUDED.fetched_at
      RETURNING 1
    )
    SELECT count(*)::int INTO v_gone FROM up;
  END IF;
  RETURN jsonb_build_object('ok', true, 'written', v_n, 'changed', v_changed, 'deleted', v_gone);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. The feed into ads_daily_snapshots

/**
 * The feed. p: {since, until} (a window of ad-days; both or neither, at most
 * 121 days), accounts (ad account ids; only those), dryRun (everything is done
 * and then undone: the answer says what would change), requestedBy.
 * Without a window it is a tick: the ad-days and ads that changed since the
 * last tick (30 minutes of overlap, so a write that committed late is not
 * missed), and the tick alone moves the watermark and cockpit_sync_state.
 * sync_jobs is written only by a call that names no accounts.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_feed_run(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_now timestamptz := public.cockpit_meta_ad_days_now();
  v_today date := public.cockpit_meta_ad_days_today();
  v_dry boolean := coalesce((p->>'dryRun')::boolean, false);
  v_by text := left(coalesce(nullif(btrim(p->>'requestedBy'), ''), 'cron'), 80);
  v_since date := public.cockpit_meta_ad_days_try_date(p->>'since');
  v_until date := public.cockpit_meta_ad_days_try_date(p->>'until');
  v_mode text := CASE WHEN p ? 'since' OR p ? 'until' THEN 'window' ELSE 'tick' END;
  v_accounts text[];
  v_wm timestamptz; v_from timestamptz; v_through timestamptz;
  v_worker_started timestamptz; v_worker_finished timestamptz; v_fresh boolean;
  v_read int := 0; v_unmapped int := 0; v_ins int := 0; v_upd int := 0; v_added int := 0; v_current int := 0; v_unread int := 0;
  v_added_list jsonb := '[]'::jsonb; v_unread_list jsonb := '[]'::jsonb;
  v_hidden jsonb; v_ok boolean := true; v_err text; v_note text; v_run bigint; v_failing int;
BEGIN
  IF v_mode = 'window' AND (v_since IS NULL OR v_until IS NULL OR v_until < v_since OR v_until - v_since > 120 OR v_until > v_today + 1) THEN
    RAISE EXCEPTION 'Send since and until as YYYY-MM-DD: at most 121 days, until no later than tomorrow' USING ERRCODE='22023';
  END IF;
  IF p ? 'accounts' THEN
    IF jsonb_typeof(p->'accounts') <> 'array' OR jsonb_array_length(p->'accounts') = 0 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p->'accounts') a WHERE jsonb_typeof(a) <> 'string' OR (a#>>'{}') !~ '^(act_)?[0-9]{5,25}$') THEN
      RAISE EXCEPTION 'Send accounts as a list of ad account ids' USING ERRCODE='22023';
    END IF;
    SELECT array_agg(DISTINCT regexp_replace(a#>>'{}', '^act_', '')) INTO v_accounts FROM jsonb_array_elements(p->'accounts') a;
  END IF;
  IF to_regclass('public.ads_daily_snapshots') IS NULL OR to_regclass('public.clients') IS NULL OR to_regclass('public.sync_jobs') IS NULL THEN
    RAISE EXCEPTION 'The creative dashboard''s tables (clients, sync_jobs, ads_daily_snapshots) are missing' USING ERRCODE='55000';
  END IF;
  -- One feed at a time; a second call while one works says so and does nothing.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('cockpit_meta_feed')) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'Another feed call is working; this one did nothing.');
  END IF;

  BEGIN
    v_wm := (SELECT (s.detail->>'through')::timestamptz FROM public.cockpit_sync_state s WHERE s.key = 'meta-dashboard-feed');
  EXCEPTION WHEN others THEN v_wm := NULL;
  END;
  v_wm := coalesce(v_wm, v_now - interval '2 hours');
  v_from := v_wm - interval '30 minutes';
  SELECT r.started_at, r.finished_at INTO v_worker_started, v_worker_finished
  FROM public.cockpit_meta_ad_day_runs r
  WHERE r.job = 'hourly' AND r.state IN ('ok', 'partial') AND r.finished_at IS NOT NULL
  ORDER BY r.finished_at DESC LIMIT 1;
  v_fresh := v_worker_finished IS NOT NULL AND v_worker_finished > v_now - interval '3 hours';

  BEGIN
    DROP TABLE IF EXISTS pg_temp.meta_feed_rows;
    CREATE TEMP TABLE meta_feed_rows (
      client_id uuid, account_id text, account_name text, account_currency text, ad_id text, day date,
      ad_name text, campaign_id text, campaign_name text, campaign_status text, effective_status text,
      spend numeric, impressions bigint, clicks bigint, link_clicks bigint, leads bigint, thumbnail_url text,
      fetched_at timestamptz, ad_changed_at timestamptz, exists_now boolean
    ) ON COMMIT DROP;

    INSERT INTO pg_temp.meta_feed_rows(account_id, account_name, account_currency, ad_id, day, ad_name, campaign_id, campaign_name,
      campaign_status, effective_status, spend, impressions, clicks, link_clicks, leads, thumbnail_url, fetched_at, ad_changed_at)
    SELECT d.account_id, d.account_name, d.account_currency, d.ad_id, d.day, coalesce(a.ad_name, d.ad_name), coalesce(d.campaign_id, a.campaign_id),
      coalesce(d.campaign_name, a.campaign_name), a.campaign_status, a.effective_status, d.spend, d.impressions, d.clicks, d.link_clicks,
      d.leads, a.thumbnail_url, d.fetched_at, a.changed_at
    FROM public.cockpit_meta_ad_days d
    LEFT JOIN public.cockpit_meta_ads a ON a.ad_id = d.ad_id
    WHERE (v_accounts IS NULL OR d.account_id = ANY(v_accounts))
      AND CASE WHEN v_mode = 'window' THEN d.day BETWEEN v_since AND v_until
               ELSE d.fetched_at > v_from OR (a.changed_at > v_from AND d.day >= v_today - 40) END;
    GET DIAGNOSTICS v_read = ROW_COUNT;
    SELECT greatest(max(r.fetched_at), max(r.ad_changed_at)) INTO v_through FROM pg_temp.meta_feed_rows r;
    v_through := greatest(coalesce(v_through, v_wm), v_wm);

    -- A spending account no dashboard client holds becomes one (the dashboard's old
    -- discovery), unless it is hidden on purpose (cockpit_meta_ad_days_hidden).
    v_hidden := public.cockpit_meta_ad_days_hidden();
    WITH spending AS (
      SELECT r.account_id, max(r.account_name) AS name, max(r.account_currency) AS currency
      FROM pg_temp.meta_feed_rows r WHERE coalesce(r.spend, 0) > 0 GROUP BY r.account_id
    ), added AS (
      INSERT INTO public.clients(name, meta_ad_account_id, currency, is_active, platform)
      SELECT left(coalesce(s.name, s.account_id), 200), 'act_' || s.account_id, coalesce(s.currency, 'USD'), true, 'meta'
      FROM spending s
      WHERE NOT EXISTS (SELECT 1 FROM public.clients c WHERE regexp_replace(c.meta_ad_account_id, '^act_', '') = s.account_id)
        AND NOT public.cockpit_meta_ad_days_is_hidden(v_hidden, s.account_id, s.name)
      ON CONFLICT DO NOTHING
      RETURNING name, meta_ad_account_id
    )
    SELECT count(*)::int, coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'account', a.meta_ad_account_id)), '[]'::jsonb)
      INTO v_added, v_added_list FROM added a;

    UPDATE pg_temp.meta_feed_rows r SET client_id = c.id
    FROM public.clients c
    WHERE c.is_active AND c.meta_ad_account_id IN ('act_' || r.account_id, r.account_id);
    SELECT count(*)::int INTO v_unmapped FROM pg_temp.meta_feed_rows r WHERE r.client_id IS NULL;
    DELETE FROM pg_temp.meta_feed_rows r WHERE r.client_id IS NULL;

    -- What the dashboard row becomes: the worker's values, and the stored ones where the worker holds none.
    UPDATE pg_temp.meta_feed_rows r SET exists_now = true,
      ad_name = coalesce(r.ad_name, s.ad_name), campaign_id = coalesce(r.campaign_id, s.campaign_id),
      campaign_name = coalesce(r.campaign_name, s.campaign_name), campaign_status = coalesce(r.campaign_status, s.campaign_status),
      effective_status = coalesce(r.effective_status, s.effective_status), clicks = coalesce(r.clicks, s.clicks),
      thumbnail_url = coalesce(r.thumbnail_url, s.thumbnail_url)
    FROM public.ads_daily_snapshots s
    WHERE s.ad_id = r.ad_id AND s.client_id = r.client_id AND s.date = r.day;

    WITH src AS (
      SELECT r.*, coalesce(r.spend, 0) AS spend0, coalesce(r.impressions, 0)::int AS impr0, coalesce(r.clicks, r.link_clicks, 0)::int AS clicks0,
        coalesce(r.leads, 0)::int AS leads0
      FROM pg_temp.meta_feed_rows r WHERE r.exists_now
    ), upd AS (
      UPDATE public.ads_daily_snapshots s SET
        ad_name = src.ad_name, campaign_id = src.campaign_id, campaign_name = src.campaign_name, campaign_status = src.campaign_status,
        effective_status = src.effective_status, spend = src.spend0, impressions = src.impr0, clicks = src.clicks0,
        link_clicks = src.link_clicks::int, leads = src.leads0,
        ctr = CASE WHEN src.impr0 > 0 THEN round(src.clicks0::numeric * 100 / src.impr0, 6) ELSE 0 END,
        cpm = CASE WHEN src.impr0 > 0 THEN round(src.spend0 * 1000 / src.impr0, 6) ELSE 0 END,
        thumbnail_url = src.thumbnail_url, last_synced_at = src.fetched_at
      FROM src
      WHERE s.ad_id = src.ad_id AND s.client_id = src.client_id AND s.date = src.day AND s.platform = 'meta'
        AND ((s.ad_name, s.campaign_id, s.campaign_name, s.campaign_status, s.effective_status, s.spend, s.impressions, s.clicks,
              s.link_clicks, s.leads, s.thumbnail_url)
             IS DISTINCT FROM
             (src.ad_name, src.campaign_id, src.campaign_name, src.campaign_status, src.effective_status, src.spend0, src.impr0, src.clicks0,
              src.link_clicks::int, src.leads0, src.thumbnail_url)
             OR s.last_synced_at < src.fetched_at)
      RETURNING 1
    )
    SELECT count(*)::int INTO v_upd FROM upd;

    WITH src AS (
      SELECT r.*, coalesce(r.spend, 0) AS spend0, coalesce(r.impressions, 0)::int AS impr0, coalesce(r.clicks, r.link_clicks, 0)::int AS clicks0,
        coalesce(r.leads, 0)::int AS leads0
      FROM pg_temp.meta_feed_rows r WHERE r.exists_now IS NOT TRUE
    ), ins AS (
      INSERT INTO public.ads_daily_snapshots(ad_id, client_id, date, ad_name, campaign_id, campaign_name, campaign_status, effective_status,
        spend, impressions, clicks, ctr, cpm, leads, thumbnail_url, last_synced_at, platform, link_clicks, smart_plus_ad_id)
      SELECT src.ad_id, src.client_id, src.day, src.ad_name, src.campaign_id, src.campaign_name, src.campaign_status, src.effective_status,
        src.spend0, src.impr0, src.clicks0,
        CASE WHEN src.impr0 > 0 THEN round(src.clicks0::numeric * 100 / src.impr0, 6) ELSE 0 END,
        CASE WHEN src.impr0 > 0 THEN round(src.spend0 * 1000 / src.impr0, 6) ELSE 0 END,
        src.leads0, src.thumbnail_url, src.fetched_at, 'meta', src.link_clicks::int, NULL
      FROM src
      ON CONFLICT (ad_id, client_id, date) DO NOTHING
      RETURNING 1
    )
    SELECT count(*)::int INTO v_ins FROM ins;

    -- Each active Meta-only client: read on the worker's last hourly run, or not, and why.
    IF v_accounts IS NULL THEN
      WITH mc AS (
        SELECT c.id, c.name, regexp_replace(c.meta_ad_account_id, '^act_', '') AS account_id
        FROM public.clients c
        WHERE c.is_active AND coalesce(c.meta_ad_account_id, '') <> '' AND c.tiktok_advertiser_id IS NULL
      ), seen AS (
        SELECT mc.id, mc.name, mc.account_id, public.cockpit_meta_ad_days_is_hidden(v_hidden, mc.account_id, mc.name) AS hidden, v_fresh AND (
            EXISTS (SELECT 1 FROM public.cockpit_meta_spend_reads s WHERE s.account_id = mc.account_id AND s.read_at >= v_worker_started - interval '5 minutes')
            OR EXISTS (SELECT 1 FROM public.cockpit_meta_account_state a WHERE a.account_id = mc.account_id AND a.fetched_at >= v_worker_started - interval '5 minutes')
            OR EXISTS (SELECT 1 FROM public.cockpit_meta_ad_days d WHERE d.account_id = mc.account_id AND d.fetched_at >= v_worker_started - interval '5 minutes')
          ) AS ok
        FROM mc
      ), up AS (
        INSERT INTO public.sync_jobs AS j(client_id, last_synced_at, last_sync_status, last_error, next_eligible_sync)
        SELECT s.id, CASE WHEN s.ok THEN v_worker_finished END, CASE WHEN s.ok THEN 'success' ELSE 'error' END,
          CASE WHEN s.ok THEN NULL
               WHEN NOT v_fresh THEN 'meta: the meta-ad-days worker has not finished an hourly run since '
                 || coalesce(to_char(v_worker_finished AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI') || ' Kuwait time', 'it started')
                 || '. Read its last runs (cockpit_meta_ad_day_runs) or run its doctor.'
               WHEN s.hidden THEN 'meta: act_' || s.account_id
                 || ' is hidden on purpose (Mahara''s own account, a client hidden from the dashboard, or kept out on the board), so meta-ad-days does not read it.'
               ELSE 'meta: Mahara''s business does not list act_' || s.account_id
                 || ' to meta-ad-days, so no numbers come in for it. Share the ad account with the business, or set the client inactive.' END,
          v_now + interval '1 hour'
        FROM seen s
        ON CONFLICT (client_id) DO UPDATE SET
          last_synced_at = coalesce(EXCLUDED.last_synced_at, j.last_synced_at),
          last_sync_status = EXCLUDED.last_sync_status, last_error = EXCLUDED.last_error, next_eligible_sync = EXCLUDED.next_eligible_sync
        WHERE (j.last_synced_at, j.last_sync_status, j.last_error)
          IS DISTINCT FROM (coalesce(EXCLUDED.last_synced_at, j.last_synced_at), EXCLUDED.last_sync_status, EXCLUDED.last_error)
        RETURNING 1
      )
      SELECT count(*) FILTER (WHERE s.ok)::int, count(*) FILTER (WHERE NOT s.ok)::int,
        coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'account', s.account_id) ORDER BY s.name) FILTER (WHERE NOT s.ok), '[]'::jsonb)
        INTO v_current, v_unread, v_unread_list
      FROM seen s;
    END IF;

    IF v_dry THEN RAISE EXCEPTION USING ERRCODE = 'P0D01', MESSAGE = 'dry run'; END IF;
  EXCEPTION
    WHEN SQLSTATE 'P0D01' THEN NULL;  -- the dry run's undo: the counts above stay, the writes go
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_ok := false;
      -- Everything above was undone: say nothing was written.
      v_ins := 0; v_upd := 0; v_added := 0; v_added_list := '[]'::jsonb; v_current := 0; v_unread := 0; v_unread_list := '[]'::jsonb;
  END;

  v_note := CASE WHEN NOT v_ok THEN 'The feed failed and wrote nothing: ' || left(v_err, 300)
    ELSE concat_ws(' ',
      CASE WHEN v_dry THEN 'Dry run, nothing kept:' END,
      format('%s ad-days read, %s dashboard rows added, %s updated.', v_read, v_ins, v_upd),
      CASE WHEN v_unmapped > 0 THEN format('%s ad-days have no active dashboard client.', v_unmapped) END,
      CASE WHEN v_added > 0 THEN format('Added %s client(s) for new spending accounts.', v_added) END,
      CASE WHEN v_accounts IS NULL THEN format('%s Meta clients current, %s not read on the last hourly run.', v_current, v_unread) END,
      CASE WHEN NOT v_fresh THEN 'The worker has not finished an hourly run in 3 hours.' END)
  END;

  INSERT INTO public.cockpit_meta_feed_runs(started_at, finished_at, ok, mode, dry_run, requested_by, since, until, accounts, watermark, through,
    ad_days_read, rows_unmapped, rows_inserted, rows_updated, clients_added, clients_current, clients_unread, worker_run_at, note, detail)
  VALUES (v_now, pg_catalog.clock_timestamp(), v_ok, v_mode, v_dry, v_by, v_since, v_until, v_accounts,
    CASE WHEN v_mode = 'tick' THEN v_wm END, CASE WHEN v_ok AND v_mode = 'tick' THEN v_through END,
    v_read, v_unmapped, v_ins, v_upd, v_added, v_current, v_unread, v_worker_finished, left(v_note, 1000),
    jsonb_build_object('added', v_added_list, 'unread', v_unread_list, 'error', v_err))
  RETURNING id INTO v_run;

  IF v_mode = 'tick' AND v_accounts IS NULL AND NOT v_dry THEN
    SELECT count(*)::int INTO v_failing FROM public.cockpit_meta_feed_runs f
    WHERE f.mode = 'tick' AND NOT f.dry_run AND NOT f.ok
      AND f.started_at > coalesce((SELECT max(g.started_at) FROM public.cockpit_meta_feed_runs g WHERE g.mode = 'tick' AND NOT g.dry_run AND g.ok), '-infinity');
    INSERT INTO public.cockpit_sync_state AS s(key, last_run_at, last_ok_at, ok, note, rows_seen, updated_at, detail)
    VALUES ('meta-dashboard-feed', v_now, CASE WHEN v_ok THEN v_now END, v_ok, left(v_note, 500), v_read, pg_catalog.now(),
      jsonb_build_object('through', CASE WHEN v_ok THEN v_through ELSE v_wm END, 'runId', v_run, 'failingSinceOk', v_failing,
        'workerRunAt', v_worker_finished, 'clientsCurrent', v_current, 'clientsUnread', v_unread))
    ON CONFLICT (key) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, last_ok_at = coalesce(EXCLUDED.last_ok_at, s.last_ok_at),
      ok = EXCLUDED.ok, note = EXCLUDED.note, rows_seen = EXCLUDED.rows_seen, updated_at = EXCLUDED.updated_at, detail = EXCLUDED.detail;
    DELETE FROM public.cockpit_meta_feed_runs f WHERE f.started_at < v_now - interval '30 days';
  END IF;

  RETURN jsonb_build_object('ok', v_ok, 'runId', v_run, 'mode', v_mode, 'dryRun', v_dry, 'read', v_read, 'unmapped', v_unmapped,
    'inserted', v_ins, 'updated', v_upd, 'clientsAdded', v_added_list, 'clientsCurrent', v_current, 'clientsUnread', v_unread_list,
    'workerRunAt', v_worker_finished, 'through', CASE WHEN v_mode = 'tick' THEN v_through END, 'note', v_note, 'error', v_err);
END;
$$;

/** The feed for the service role: a window, some accounts, a dry run (cockpit_meta_feed_run). */
CREATE OR REPLACE FUNCTION public.cockpit_meta_feed_snapshots(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.cockpit_meta_ad_days_require_service();
  IF p IS NOT NULL AND jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'Send an object' USING ERRCODE='22023'; END IF;
  RETURN public.cockpit_meta_feed_run(coalesce(p, '{}'::jsonb)
    || jsonb_build_object('requestedBy', left(coalesce(nullif(btrim(p->>'requestedBy'), ''), 'service'), 80)));
END;
$$;

/** pg_cron's call: a tick. */
CREATE OR REPLACE FUNCTION public.cockpit_meta_feed_tick()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT public.cockpit_meta_feed_run('{"requestedBy":"cron"}'::jsonb)
$$;

-- cron:begin
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname = ''mahara-meta-dashboard-feed''';
    EXECUTE $q$SELECT cron.schedule('mahara-meta-dashboard-feed','4-59/10 * * * *',$job$SELECT public.cockpit_meta_feed_tick();$job$)$q$;
  END IF;
END $$;
-- cron:end

-- ---------------------------------------------------------------------------
-- 4. Function privileges: revoked from all four roles, then exactly the grants below

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['cockpit_meta_feed_run(jsonb)','cockpit_meta_feed_tick()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['cockpit_meta_ad_days_apply(jsonb)','cockpit_meta_ads_apply(jsonb)','cockpit_meta_feed_snapshots(jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

COMMIT;
