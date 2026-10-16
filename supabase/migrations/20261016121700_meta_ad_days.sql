-- Meta ad-day store for the Client Performance board, 2026-10-16
-- (Creative Triage bldgtotkfmhoxmlzowdx).
--
-- The CEO, 2026-10-16: one shared Client Performance board for the whole team,
-- with the ad columns (impressions, CPM, frequency, link CTR, link clicks, CPC,
-- opt-in rate, hook rate, video retention at 25/50/75/100%, hold rate) and every
-- campaign, ad set and ad of a client. Nothing stored had them. The media
-- buyer's daily table (cockpit_media_daily_stats) keeps only campaigns with a
-- board card, keyed by name, with no ids, no reach and no video fields, and it
-- was 13% short of Meta's client spend over 30 days (5 accounts short, 7 absent).
-- This file is the store that has all of it:
--
--   cockpit_meta_ad_days          one row per Meta ad per ad-account day, PK (ad_id, day); leads are
--                                 lead-form leads only (a WhatsApp or Messenger lead ad set's are not)
--   cockpit_meta_reach            reach and impressions over five windows for each client,
--                                 account, campaign, ad set and ad. Frequency over a window
--                                 is impressions / reach of that window, never an average
--                                 or a maximum of daily frequencies.
--   cockpit_meta_ad_day_runs      one row per run: hourly, nightly or backfill
--   cockpit_meta_ad_day_tasks     a run's work: one account and up to 7 days, or one
--                                 account's reach; leased 5 minutes, 4 tries
--   cockpit_meta_ad_day_receipts  every Graph call (intent, then response or unknown), 30 days
--   service RPCs                  inputs, begin, claim, apply, reach apply, fail, record and
--                                 status, for the Edge Function meta-ad-days (service key)
--   cockpit_meta_reach_windows    the five windows as days: the one definition
--   cockpit_meta_ad_days_status   freshness, failures and accounts not linked, for the board's
--                                 read (callable by the owner's definer functions) and the doctor
--   cockpit_meta_ad_days_usd_per  USD per unit of an account currency: the cockpit's fixed
--                                 rates (hermes/ceo-refresh/native/data/tap.js USD_PER, the
--                                 same as hermes/cockpit-sync/calculator.ts FX)
--   pg_cron                       mahara-meta-ad-days-hourly (minute 7), -nightly (00:20 UTC,
--                                 03:20 Kuwait), -drain (every 2 minutes; posts only while
--                                 tasks wait)
--
-- Rules:
--   - NULL is "Meta did not return it", never 0 (the column comments say where a
--     zero is real).
--   - Days are each ad account's own calendar (account_timezone), as Meta counts
--     them; the CRM is on Kuwait time.
--   - A row is upserted by (ad_id, day): a later read replaces an earlier one, an
--     earlier read never replaces a later one, and nothing is deleted because an
--     ad stopped.
--   - Spend is kept in the account currency and in USD at the fixed rates; a
--     currency with no rate leaves spend_usd NULL and the run's note names it.
--   - Accounts that spent but tie to no client are kept, and the run's note lists
--     them as not linked to a client. Ties come from cockpit_board_clients (the
--     board's client spine, its own migration); while that table is missing or
--     empty, reach is kept at account level only.
--   - Nobody reads these tables directly: the board reads them through its own
--     SECURITY DEFINER functions.
--
-- Safe to apply twice: tables IF NOT EXISTS, functions CREATE OR REPLACE, the
-- jobs unscheduled by name before they are scheduled again. pg_cron, pg_net,
-- the vault and cockpit_board_clients are touched only inside guarded dynamic
-- SQL, so the file loads in PGlite and in either order with the board's client
-- spine. Apply after the Edge Function meta-ad-days is deployed (until then the
-- jobs' posts are refused).

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.cockpit_sync_state') IS NULL OR to_regclass('public.cockpit_audit_log') IS NULL THEN
    RAISE EXCEPTION 'The cockpit core (cockpit_sync_state, cockpit_audit_log) is missing';
  END IF;
END $$;

-- A run's detail goes on its sync-state row (20261011c added the column).
ALTER TABLE public.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;

-- ---------------------------------------------------------------------------
-- 1. Tables

CREATE TABLE IF NOT EXISTS public.cockpit_meta_ad_days (
  account_id text NOT NULL CHECK (account_id ~ '^[0-9]{5,25}$'),
  account_name text CHECK (account_name IS NULL OR length(account_name) <= 200),
  account_timezone text CHECK (account_timezone IS NULL OR length(account_timezone) <= 64),
  account_currency text CHECK (account_currency IS NULL OR account_currency ~ '^[A-Z]{3}$'),
  day date NOT NULL,
  campaign_id text CHECK (campaign_id IS NULL OR campaign_id ~ '^[0-9]{5,25}$'),
  campaign_name text CHECK (campaign_name IS NULL OR length(campaign_name) <= 400),
  objective text CHECK (objective IS NULL OR length(objective) <= 60),
  adset_id text CHECK (adset_id IS NULL OR adset_id ~ '^[0-9]{5,25}$'),
  adset_name text CHECK (adset_name IS NULL OR length(adset_name) <= 400),
  ad_id text NOT NULL CHECK (ad_id ~ '^[0-9]{5,25}$'),
  ad_name text CHECK (ad_name IS NULL OR length(ad_name) <= 400),
  spend numeric CHECK (spend IS NULL OR spend >= 0),
  spend_usd numeric CHECK (spend_usd IS NULL OR spend_usd >= 0),
  usd_rate numeric CHECK (usd_rate IS NULL OR usd_rate > 0),
  impressions bigint CHECK (impressions IS NULL OR impressions >= 0),
  reach bigint CHECK (reach IS NULL OR reach >= 0),
  frequency numeric CHECK (frequency IS NULL OR frequency >= 0),
  link_clicks bigint CHECK (link_clicks IS NULL OR link_clicks >= 0),
  leads bigint CHECK (leads IS NULL OR leads >= 0),
  lead_actions bigint CHECK (lead_actions IS NULL OR lead_actions >= 0),
  landing_page_views bigint CHECK (landing_page_views IS NULL OR landing_page_views >= 0),
  video_plays bigint CHECK (video_plays IS NULL OR video_plays >= 0),
  video_3s bigint CHECK (video_3s IS NULL OR video_3s >= 0),
  video_p25 bigint CHECK (video_p25 IS NULL OR video_p25 >= 0),
  video_p50 bigint CHECK (video_p50 IS NULL OR video_p50 >= 0),
  video_p75 bigint CHECK (video_p75 IS NULL OR video_p75 >= 0),
  video_p100 bigint CHECK (video_p100 IS NULL OR video_p100 >= 0),
  thruplays bigint CHECK (thruplays IS NULL OR thruplays >= 0),
  destination_type text CHECK (destination_type IS NULL OR destination_type ~ '^[A-Z_]{1,60}$'),
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (ad_id, day),
  CHECK (spend_usd IS NULL OR usd_rate IS NOT NULL),
  -- A chat destination has messaging leads, never form leads (parse.ts MESSAGING_DESTINATIONS, pinned by parse.test.ts).
  CONSTRAINT cockpit_meta_ad_days_no_form_leads_in_chats CHECK (leads IS NULL OR destination_type IS NULL OR NOT (
    destination_type IN ('WHATSAPP','MESSENGER','INSTAGRAM_DIRECT','LEAD_FROM_MESSENGER','LEAD_FROM_IG_DIRECT') OR destination_type LIKE 'MESSAGING\_%'))
);
COMMENT ON TABLE public.cockpit_meta_ad_days IS
  'Every Meta ad of every spending ad account of Mahara''s business (767701513092162), one row per ad per ad-account day, written by the Edge Function meta-ad-days (Graph v25.0, ad level, time_increment=1, use_unified_attribution_setting=true). NULL means Meta did not return it, never 0. Days are the ad account''s own calendar. Upserted by (ad_id, day); never deleted because an ad stopped.';
COMMENT ON COLUMN public.cockpit_meta_ad_days.day IS 'The ad account''s own day (account_timezone), as Meta counts it; the CRM is on Kuwait time.';
COMMENT ON COLUMN public.cockpit_meta_ad_days.spend IS 'Spend in account_currency, as Meta reports it.';
COMMENT ON COLUMN public.cockpit_meta_ad_days.spend_usd IS 'spend x usd_rate. NULL when the currency has no fixed rate (the run''s note names it), never one to one.';
COMMENT ON COLUMN public.cockpit_meta_ad_days.usd_rate IS 'USD per unit of account_currency at the cockpit''s fixed rates (cockpit_meta_ad_days_usd_per), the rate spend_usd used.';
COMMENT ON COLUMN public.cockpit_meta_ad_days.reach IS 'Meta''s reach for this ad on this day. Not additive across days or ads: reach over a window is in cockpit_meta_reach.';
COMMENT ON COLUMN public.cockpit_meta_ad_days.frequency IS 'Meta''s frequency for this ad on this day. Never average it: frequency over a window is impressions / reach in cockpit_meta_reach.';
COMMENT ON COLUMN public.cockpit_meta_ad_days.link_clicks IS 'inline_link_clicks: clicks on the ad''s link (the tap that opens an instant form counts). Link CTR = link_clicks / impressions.';
COMMENT ON COLUMN public.cockpit_meta_ad_days.leads IS 'Lead-form leads: on a lead campaign (objective OUTCOME_LEADS or LEAD_GENERATION), Meta''s lead action less its messaging leads (onsite_conversion.lead), 0 when Meta lists none. NULL on every other objective, and NULL on a lead ad set whose destination_type is a chat (WhatsApp, Messenger, Instagram Direct): those report a lead action for leads marked in a chat, which are not form leads. CPL = spend over the rows where leads is not NULL / their leads, so a chat ad set''s spend stays out of it.';
COMMENT ON COLUMN public.cockpit_meta_ad_days.lead_actions IS 'Meta''s lead action on any objective (lead, else onsite_conversion.lead_grouped + offsite_conversion.fb_pixel_lead, as hermes/lead-sync-watch counts it), 0 when none. Matches Meta''s account-level lead count; includes messaging leads.';
COMMENT ON COLUMN public.cockpit_meta_ad_days.destination_type IS 'The ad set''s destination as Meta lists it (ON_AD = instant form, WEBSITE, WHATSAPP, MESSAGING_...), looked up for lead-campaign ad sets only. NULL on other objectives and on a deleted ad set Meta no longer lists (the task''s note names it).';
COMMENT ON COLUMN public.cockpit_meta_ad_days.landing_page_views IS 'actions[landing_page_view]; NULL when Meta lists none (instant-form ads have no landing page). Opt-in rate for a website funnel = leads / landing_page_views.';
COMMENT ON COLUMN public.cockpit_meta_ad_days.video_plays IS 'video_play_actions: every start of the video (90 to 94% of impressions), not 3-second plays. NULL on a row that is not a video. Retention at p25..p100 = video_pXX / video_plays.';
COMMENT ON COLUMN public.cockpit_meta_ad_days.video_3s IS '3-second plays, actions[video_view]. Hook (stop) rate = video_3s / impressions over video rows; hold rate = thruplays / video_3s. 0 on a video row with none; NULL on a row that is not a video.';
COMMENT ON COLUMN public.cockpit_meta_ad_days.thruplays IS 'video_thruplay_watched_actions: plays to 15 seconds or to the end of a shorter video. 0 on a video row with none; NULL on a row that is not a video.';
COMMENT ON COLUMN public.cockpit_meta_ad_days.fetched_at IS 'When Meta answered the read that wrote this row.';
CREATE INDEX IF NOT EXISTS cockpit_meta_ad_days_account_day_idx ON public.cockpit_meta_ad_days(account_id, day);
CREATE INDEX IF NOT EXISTS cockpit_meta_ad_days_day_idx ON public.cockpit_meta_ad_days(day);
CREATE INDEX IF NOT EXISTS cockpit_meta_ad_days_campaign_day_idx ON public.cockpit_meta_ad_days(campaign_id, day);
CREATE INDEX IF NOT EXISTS cockpit_meta_ad_days_adset_day_idx ON public.cockpit_meta_ad_days(adset_id, day);

CREATE TABLE IF NOT EXISTS public.cockpit_meta_reach (
  level text NOT NULL CHECK (level IN ('client','account','campaign','adset','ad')),
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 80),
  window_key text NOT NULL CHECK (window_key IN ('last_7','last_14','last_30','this_month','last_month')),
  from_day date NOT NULL,
  to_day date NOT NULL,
  reach bigint CHECK (reach IS NULL OR reach >= 0),
  impressions bigint CHECK (impressions IS NULL OR impressions >= 0),
  computed_at timestamptz NOT NULL DEFAULT now(),
  account_id text CHECK (account_id IS NULL OR account_id ~ '^[0-9]{5,25}$'),
  note text CHECK (note IS NULL OR length(note) <= 500),
  PRIMARY KEY (level, key, window_key),
  CHECK (to_day >= from_day),
  CHECK ((level = 'client') = (account_id IS NULL)),
  CHECK (level = 'client' OR key ~ '^[0-9]{5,25}$')
);
COMMENT ON TABLE public.cockpit_meta_reach IS
  'Meta reach and impressions over the five standard windows (cockpit_meta_reach_windows, Kuwait days) per level: account, campaign, adset and ad from Meta''s own time_ranges read (written nightly, account level hourly), client (key = GHL location id) from its ad accounts through cockpit_board_clients. Frequency over a window = impressions / reach of the same row. A row whose from_day and to_day are not today''s window is stale.';
COMMENT ON COLUMN public.cockpit_meta_reach.account_id IS 'The ad account the row was read from; NULL on client rows.';
COMMENT ON COLUMN public.cockpit_meta_reach.note IS 'Client rows: the sum of more than one ad account (a person reached by two counts twice), or an account that could not be read (reach NULL).';
CREATE INDEX IF NOT EXISTS cockpit_meta_reach_account_idx ON public.cockpit_meta_reach(account_id, level);

CREATE TABLE IF NOT EXISTS public.cockpit_meta_ad_day_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL CHECK (job IN ('hourly','nightly','backfill')),
  state text NOT NULL DEFAULT 'running' CHECK (state IN ('running','ok','partial','failed')),
  requested_by text NOT NULL CHECK (length(requested_by) BETWEEN 1 AND 254),
  graph_version text CHECK (graph_version IS NULL OR graph_version ~ '^v[0-9]{1,3}\.[0-9]$'),
  window_from date,
  window_to date,
  accounts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(accounts) = 'array'),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  tasks_total integer NOT NULL DEFAULT 0,
  tasks_done integer NOT NULL DEFAULT 0,
  tasks_failed integer NOT NULL DEFAULT 0,
  rows_written integer NOT NULL DEFAULT 0,
  rows_changed integer NOT NULL DEFAULT 0,
  note text CHECK (note IS NULL OR length(note) <= 2000),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK ((state = 'running') = (finished_at IS NULL))
);
COMMENT ON TABLE public.cockpit_meta_ad_day_runs IS
  'One row per meta-ad-days run: the accounts that spent (and whether each ties to a client), the tasks, the rows written and a plain note. Kept 90 days.';
CREATE INDEX IF NOT EXISTS cockpit_meta_ad_day_runs_job_idx ON public.cockpit_meta_ad_day_runs(job, started_at DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_meta_ad_day_tasks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.cockpit_meta_ad_day_runs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('days','reach_account','reach_all')),
  account_id text NOT NULL CHECK (account_id ~ '^[0-9]{5,25}$'),
  account_name text CHECK (account_name IS NULL OR length(account_name) <= 200),
  account_currency text CHECK (account_currency IS NULL OR account_currency ~ '^[A-Z]{3}$'),
  account_timezone text CHECK (account_timezone IS NULL OR length(account_timezone) <= 64),
  since date,
  until date,
  windows jsonb,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','done','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 4),
  lease_token uuid,
  lease_until timestamptz,
  retry_at timestamptz,
  rows_read integer NOT NULL DEFAULT 0,
  changed integer NOT NULL DEFAULT 0,
  spend numeric,
  leads bigint,
  error text CHECK (error IS NULL OR length(error) <= 500),
  note text CHECK (note IS NULL OR length(note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (run_id, kind, account_id, since, until),
  CHECK ((kind = 'days') = (since IS NOT NULL AND until IS NOT NULL)),
  CHECK (since IS NULL OR until >= since),
  CHECK (kind = 'days' OR jsonb_typeof(windows) = 'array'),
  CHECK ((state = 'running') = (lease_token IS NOT NULL))
);
COMMENT ON TABLE public.cockpit_meta_ad_day_tasks IS
  'The work of a meta-ad-days run: one account and up to 7 of its days (days), or its reach over the five windows (reach_account: account level; reach_all: account, campaign, adset and ad). Claimed with a 5-minute lease; a task whose lease ran out goes back to the queue, 4 tries in all. A read Meta refused for its rate limit or its load waits until retry_at (3, 6, 9 minutes). Kept 14 days after the run.';
CREATE INDEX IF NOT EXISTS cockpit_meta_ad_day_tasks_open_idx ON public.cockpit_meta_ad_day_tasks(state, id) WHERE state IN ('pending','running');
CREATE INDEX IF NOT EXISTS cockpit_meta_ad_day_tasks_run_idx ON public.cockpit_meta_ad_day_tasks(run_id);
CREATE INDEX IF NOT EXISTS cockpit_meta_ad_day_tasks_account_idx ON public.cockpit_meta_ad_day_tasks(account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_meta_ad_day_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL CHECK (provider = 'meta'),
  method text NOT NULL CHECK (method = 'GET'),
  resource text NOT NULL CHECK (resource ~ '^[A-Za-z0-9_/]{1,120}$'),
  phase text NOT NULL CHECK (phase IN ('intent','response','unknown')),
  http_status integer,
  error text CHECK (error IS NULL OR length(error) <= 240),
  run_id uuid,
  receipt_index integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cockpit_meta_ad_day_receipts IS
  'Receipts for every Graph call meta-ad-days makes: the path (an ad account id at most), the phase, the status and Meta''s error code and text with any token taken out. Never a token, never a URL query. Kept 30 days.';
CREATE INDEX IF NOT EXISTS cockpit_meta_ad_day_receipts_created_idx ON public.cockpit_meta_ad_day_receipts(created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_meta_ad_days','cockpit_meta_reach','cockpit_meta_ad_day_runs',
    'cockpit_meta_ad_day_tasks','cockpit_meta_ad_day_receipts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
  END LOOP;
END $$;
-- The one direct write: the function's receipt before and after each Graph call.
GRANT INSERT ON public.cockpit_meta_ad_day_receipts TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Helpers (internal unless granted below)

CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_require_service()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF coalesce(auth.jwt()->>'role','') <> 'service_role' THEN
    RAISE EXCEPTION 'The Meta ad-day store is written by the service role only' USING ERRCODE='42501';
  END IF;
END;
$$;

/** The store's clock: now(). One seam, so the tests can stand at a fixed moment. */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_now()
RETURNS timestamptz LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT pg_catalog.now()
$$;

/** Today on Kuwait's calendar, the board's. */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_today()
RETURNS date LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT (public.cockpit_meta_ad_days_now() AT TIME ZONE 'Asia/Kuwait')::date
$$;

/**
 * USD per unit of an account currency at the cockpit's fixed rates, the
 * table of hermes/ceo-refresh/native/data/tap.js (USD_PER) and
 * hermes/cockpit-sync/calculator.ts (FX); the migration test pins it to both.
 * A currency with no rate, or none at all, is NULL: never one to one.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_usd_per(p_currency text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE upper(btrim(p_currency))
    WHEN 'USD' THEN 1 WHEN 'KWD' THEN 3.26 WHEN 'AED' THEN 0.2723 WHEN 'SAR' THEN 0.2666 WHEN 'QAR' THEN 0.2747
  END::numeric
$$;

/**
 * The five standard windows on Kuwait's calendar, ending today, the way the
 * cockpits' reporting periods count them (reportPeriod.ts: "last 7 days" is
 * today and the 6 days before it). this_month runs from the 1st to today;
 * last_month is the whole previous month.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_reach_windows(p_today date)
RETURNS TABLE(window_key text, from_day date, to_day date) LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT v.window_key, v.from_day, v.to_day FROM (VALUES
    (1, 'last_7', p_today - 6, p_today),
    (2, 'last_14', p_today - 13, p_today),
    (3, 'last_30', p_today - 29, p_today),
    (4, 'this_month', date_trunc('month', p_today::timestamp)::date, p_today),
    (5, 'last_month', (date_trunc('month', p_today::timestamp) - interval '1 month')::date, (date_trunc('month', p_today::timestamp) - interval '1 day')::date)
  ) AS v(n, window_key, from_day, to_day)
  ORDER BY v.n
$$;

CREATE OR REPLACE FUNCTION public.cockpit_meta_reach_windows_json(p_today date)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_agg(jsonb_build_object('key', w.window_key, 'from', to_char(w.from_day,'YYYY-MM-DD'), 'to', to_char(w.to_day,'YYYY-MM-DD')))
  FROM public.cockpit_meta_reach_windows(p_today) w
$$;

/**
 * Which client each ad account belongs to, from cockpit_board_clients (the
 * board's client spine; its ad_account_ids follow the tie order of
 * hermes/lead-sync-watch). {source: 'board_clients' | 'empty' | 'missing',
 * clients, accounts: {"<account id>": {locationId, clientName}}}. An account
 * listed on two clients is tied to the first by location id and counted in
 * `shared`.
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
      SELECT regexp_replace(btrim(x), '^act_', '') AS account_id, c.location_id, c.client_name
      FROM public.cockpit_board_clients c CROSS JOIN LATERAL unnest(coalesce(c.ad_account_ids, '{}'::text[])) AS x
      WHERE c.location_id IS NOT NULL
    ), firsts AS (
      SELECT DISTINCT ON (account_id) account_id, location_id, client_name, count(*) OVER (PARTITION BY account_id) AS n
      FROM pairs WHERE account_id ~ '^[0-9]{5,25}$' ORDER BY account_id, location_id
    )
    SELECT coalesce((SELECT jsonb_object_agg(account_id, jsonb_build_object('locationId', location_id, 'clientName', client_name)) FROM firsts), '{}'::jsonb),
           (SELECT count(*)::int FROM public.cockpit_board_clients),
           (SELECT count(*)::int FROM firsts WHERE n > 1)
  $q$ INTO v_map, v_clients, v_shared;
  RETURN jsonb_build_object('source', CASE WHEN v_clients = 0 THEN 'empty' ELSE 'board_clients' END,
    'clients', v_clients, 'shared', v_shared, 'accounts', v_map);
END;
$$;

/** 'YYYY-MM-DD' as a real date, or NULL. */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_try_date(p text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE d date;
BEGIN
  IF p IS NULL OR p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN NULL; END IF;
  BEGIN d := p::date; EXCEPTION WHEN others THEN RETURN NULL; END;
  IF to_char(d,'YYYY-MM-DD') <> p THEN RETURN NULL; END IF;
  RETURN d;
END;
$$;

/** A task leased to this call (its token), locked; anything else is refused. */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_leased(p jsonb, p_kinds text[])
RETURNS public.cockpit_meta_ad_day_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.cockpit_meta_ad_day_tasks;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR coalesce(p->>'taskId','') !~ '^[0-9]{1,18}$'
     OR coalesce(p->>'leaseToken','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Send {taskId, leaseToken, ...}' USING ERRCODE='22023';
  END IF;
  SELECT * INTO t FROM public.cockpit_meta_ad_day_tasks x WHERE x.id = (p->>'taskId')::bigint FOR UPDATE;
  IF t.id IS NULL OR t.state <> 'running' OR t.lease_token IS DISTINCT FROM (p->>'leaseToken')::uuid THEN
    RAISE EXCEPTION 'That task is no longer leased to this call; it was not written' USING ERRCODE='55000';
  END IF;
  IF NOT (t.kind = ANY(p_kinds)) THEN
    RAISE EXCEPTION 'That task is not a % task', array_to_string(p_kinds, ' or ') USING ERRCODE='22023';
  END IF;
  RETURN t;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Finishing a run, the client rows, expiry

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
 * Without the client spine there are no client rows.
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
    ), ins AS (
      INSERT INTO public.cockpit_meta_reach(level, key, window_key, from_day, to_day, reach, impressions, computed_at, account_id, note)
      SELECT 'client', c.location_id, w.window_key, w.from_day, w.to_day,
        CASE WHEN f.failed IS NULL AND s.stale IS NULL THEN a.reach END,
        CASE WHEN f.failed IS NULL AND s.stale IS NULL THEN a.impressions END,
        coalesce(a.computed_at, pg_catalog.now()), NULL,
        left(nullif(concat_ws(' ',
          CASE WHEN f.failed IS NOT NULL THEN 'Could not read ad account ' || f.failed || ', so this client''s reach is unknown.' END,
          CASE WHEN f.failed IS NULL AND s.stale IS NOT NULL THEN CASE WHEN s.n > 1 THEN 'Ad accounts ' ELSE 'Ad account ' END || s.stale
            || '; this client''s reach waits for the nightly run.' END,
          CASE WHEN f.failed IS NULL AND s.stale IS NULL AND a.n > 1 THEN 'The sum of ' || a.n || ' ad accounts: a person reached by two of them counts twice.' END), ''), 500)
      FROM clients c CROSS JOIN w
      CROSS JOIN LATERAL (SELECT count(*)::int AS n, sum(r.reach)::bigint AS reach, sum(r.impressions)::bigint AS impressions, min(r.computed_at) AS computed_at
                          FROM acc r WHERE r.key = ANY(c.accounts) AND r.window_key = w.window_key) a
      CROSS JOIN LATERAL (SELECT string_agg(l.account_id, ', ' ORDER BY l.account_id) AS failed
                          FROM last_read l WHERE l.account_id = ANY(c.accounts) AND l.state = 'failed') f
      CROSS JOIN LATERAL (SELECT count(*)::int AS n, string_agg(x.key || ' not re-read since ' || to_char(x.to_day, 'YYYY-MM-DD'), ', ' ORDER BY x.key) AS stale
                          FROM stale x WHERE x.key = ANY(c.accounts) AND x.window_key = w.window_key) s
      WHERE a.n > 0 OR f.failed IS NOT NULL OR s.stale IS NOT NULL
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
BEGIN
  SELECT * INTO r FROM public.cockpit_meta_ad_day_runs WHERE id = p_run FOR UPDATE;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  IF r.state <> 'running' THEN RETURN r.state; END IF;
  SELECT count(*) FILTER (WHERE state IN ('pending','running')), count(*) FILTER (WHERE state = 'done'), count(*) FILTER (WHERE state = 'failed'),
         coalesce(sum(rows_read) FILTER (WHERE kind = 'days' AND state = 'done'), 0), coalesce(sum(changed) FILTER (WHERE kind = 'days' AND state = 'done'), 0),
         count(DISTINCT account_id), count(*) FILTER (WHERE kind <> 'days' AND state = 'done')
    INTO v_open, v_done, v_failed, v_rows, v_changed, v_accounts, v_reach
  FROM public.cockpit_meta_ad_day_tasks WHERE run_id = p_run;
  IF v_open > 0 THEN RETURN 'running'; END IF;
  v_state := CASE WHEN v_failed = 0 THEN 'ok' WHEN v_done = 0 THEN 'failed' ELSE 'partial' END;

  SELECT string_agg(coalesce(f.account_name, f.account_id) || ' (' || f.account_id || '): ' || coalesce(f.error, 'not read'), '; ' ORDER BY f.account_id)
    INTO v_failing
  FROM (SELECT DISTINCT ON (t.account_id) t.account_id, t.account_name, t.error FROM public.cockpit_meta_ad_day_tasks t
        WHERE t.run_id = p_run AND t.state = 'failed' ORDER BY t.account_id, t.id) f;
  SELECT string_agg(coalesce(a->>'name', a->>'accountId') || ' (' || (a->>'accountId') || ', ' || coalesce(a->>'currency','?') || ' ' || coalesce(a->>'spend','?') || ')', ', ' ORDER BY a->>'accountId')
    INTO v_not_linked
  FROM jsonb_array_elements(r.accounts) a WHERE (a->>'linked')::boolean IS NOT TRUE;
  SELECT string_agg(DISTINCT coalesce(a->>'currency','no currency') || ' on ' || coalesce(a->>'name', a->>'accountId'), ', ')
    INTO v_no_rate
  FROM jsonb_array_elements(r.accounts) a WHERE public.cockpit_meta_ad_days_usd_per(a->>'currency') IS NULL;

  v_note := left(concat_ws(' ',
    CASE WHEN jsonb_array_length(r.accounts) = 0 THEN 'No ad account of the business spent in the window; nothing to read.'
         ELSE 'Read ' || (jsonb_array_length(r.accounts) - coalesce((SELECT count(DISTINCT t.account_id) FROM public.cockpit_meta_ad_day_tasks t
                WHERE t.run_id = p_run AND t.state = 'failed'), 0)) || ' of ' || jsonb_array_length(r.accounts) || ' ad accounts: '
              || v_rows || ' ad-days written, ' || v_changed || ' new or changed.' END,
    CASE WHEN v_reach > 0 THEN 'Reach read for ' || v_reach || ' accounts.' END,
    CASE WHEN v_failing IS NOT NULL THEN 'Could not read ' || v_failing || '.' END,
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

/**
 * Runs that ran out of time (hourly 50 minutes, nightly 6 hours, backfill 12
 * hours) and tasks out of tries are failed with a sentence, and their runs
 * closed. Called by begin, claim and the drain's kick.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_expire()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run uuid; v_runs uuid[]; v_n int := 0;
BEGIN
  WITH dead AS (
    UPDATE public.cockpit_meta_ad_day_tasks t SET state = 'failed', lease_token = NULL, lease_until = NULL, updated_at = pg_catalog.now(),
      error = left(coalesce(t.error || ' ', '') || 'Not finished after 4 tries.', 500)
    WHERE t.state = 'running' AND t.lease_until < public.cockpit_meta_ad_days_now() AND t.attempts >= 4
    RETURNING t.run_id
  ) SELECT array_agg(DISTINCT run_id) INTO v_runs FROM dead;
  FOREACH v_run IN ARRAY coalesce(v_runs, '{}'::uuid[]) LOOP
    PERFORM public.cockpit_meta_ad_days_finish(v_run);
    v_n := v_n + 1;
  END LOOP;
  FOR v_run IN
    SELECT r.id FROM public.cockpit_meta_ad_day_runs r
    WHERE r.state = 'running' AND r.started_at < public.cockpit_meta_ad_days_now()
      - CASE r.job WHEN 'hourly' THEN interval '50 minutes' WHEN 'nightly' THEN interval '6 hours' ELSE interval '12 hours' END
  LOOP
    UPDATE public.cockpit_meta_ad_day_tasks SET state = 'failed', lease_token = NULL, lease_until = NULL, updated_at = pg_catalog.now(),
      error = left(coalesce(error || ' ', '') || 'The run ran out of time before this was read; a later run reads these days again.', 500)
    WHERE run_id = v_run AND state IN ('pending','running');
    PERFORM public.cockpit_meta_ad_days_finish(v_run);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Service RPCs (the Edge Function meta-ad-days, service key)

/** What a run or a dry run needs from the database: today, the windows, the ties, and which of p.accounts tie to no client. Reads only. */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_inputs(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_ties jsonb; v_today date := public.cockpit_meta_ad_days_today();
BEGIN
  PERFORM public.cockpit_meta_ad_days_require_service();
  v_ties := public.cockpit_meta_ad_days_ties();
  RETURN jsonb_build_object(
    'today', to_char(v_today,'YYYY-MM-DD'),
    'windows', public.cockpit_meta_reach_windows_json(v_today),
    'ties', jsonb_build_object('source', v_ties->>'source', 'clients', (v_ties->>'clients')::int, 'shared', (v_ties->>'shared')::int,
              'linked', (SELECT count(*) FROM jsonb_array_elements(coalesce(p->'accounts','[]'::jsonb)) a WHERE (v_ties->'accounts') ? (a->>'accountId'))),
    'notLinked', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', a->>'accountId', 'name', a->>'name', 'currency', a->>'currency', 'spend', a->'spend')
                                   ORDER BY a->>'accountId')
                           FROM jsonb_array_elements(coalesce(p->'accounts','[]'::jsonb)) a
                           WHERE v_ties->>'source' = 'board_clients' AND NOT ((v_ties->'accounts') ? (a->>'accountId'))), '[]'::jsonb),
    'queue', jsonb_build_object(
      'pending', (SELECT count(*) FROM public.cockpit_meta_ad_day_tasks WHERE state = 'pending'),
      'running', (SELECT count(*) FROM public.cockpit_meta_ad_day_tasks WHERE state = 'running')));
END;
$$;

/**
 * Start a run: p = {job, requestedBy, graphVersion, window {since, until},
 * accounts [{accountId, name, currency, timezone, status, spend, edge}],
 * internal [ids], unreadable [ids], tasks [{kind: 'days', accountId, since,
 * until}], reach: 'account' | 'all' | null}. Each account is tied to a client
 * (or listed as not linked) here. One reach task per account is added with
 * today's windows. A run of the same job still working answers busy.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_begin(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_job text := p->>'job'; v_by text; v_busy public.cockpit_meta_ad_day_runs; v_run uuid; v_today date; v_ties jsonb;
  v_accounts jsonb; v_bad text; v_tasks int; v_reach text := nullif(p->>'reach',''); v_state text;
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
  SELECT coalesce(jsonb_agg(a || jsonb_build_object(
           'linked', (v_ties->'accounts') ? (a->>'accountId'),
           'locationId', v_ties->'accounts'->(a->>'accountId')->>'locationId',
           'clientName', v_ties->'accounts'->(a->>'accountId')->>'clientName') ORDER BY a->>'accountId'), '[]'::jsonb)
    INTO v_accounts
  FROM jsonb_array_elements(p->'accounts') a;

  INSERT INTO public.cockpit_meta_ad_day_runs(job, requested_by, graph_version, window_from, window_to, accounts, detail, started_at)
  VALUES (v_job, v_by, nullif(p->>'graphVersion',''), public.cockpit_meta_ad_days_try_date(p->'window'->>'since'),
    public.cockpit_meta_ad_days_try_date(p->'window'->>'until'), v_accounts,
    jsonb_build_object('tieSource', v_ties->>'source', 'clients', (v_ties->>'clients')::int, 'reach', v_reach,
      'internal', coalesce(p->'internal','[]'::jsonb), 'unreadable', coalesce(p->'unreadable','[]'::jsonb),
      'notLinked', coalesce((SELECT jsonb_agg(a->>'accountId') FROM jsonb_array_elements(v_accounts) a WHERE (a->>'linked')::boolean IS NOT TRUE), '[]'::jsonb)),
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
  SELECT count(*) INTO v_tasks FROM public.cockpit_meta_ad_day_tasks WHERE run_id = v_run;
  UPDATE public.cockpit_meta_ad_day_runs SET tasks_total = v_tasks WHERE id = v_run;
  IF v_tasks = 0 THEN v_state := public.cockpit_meta_ad_days_finish(v_run); END IF;
  RETURN jsonb_build_object('started', true, 'runId', v_run, 'tasks', v_tasks, 'tieSource', v_ties->>'source',
    'notLinked', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', a->>'accountId', 'name', a->>'name'))
                           FROM jsonb_array_elements(v_accounts) a WHERE (a->>'linked')::boolean IS NOT TRUE), '[]'::jsonb),
    'state', coalesce(v_state, 'running'));
END;
$$;

/**
 * Lease up to p.limit (1 to 5) open tasks for p.leaseSeconds (60 to 900):
 * pending ones, or running ones whose lease ran out (4 tries in all). Hourly
 * work first, then nightly, then backfill; days before reach. A claim starts
 * the task's counts again, so a retried read is counted once.
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
      'leaseToken', c.lease_token, 'attempt', c.attempts) ORDER BY c.id), '[]'::jsonb)
    INTO v_out
  FROM claimed c JOIN public.cockpit_meta_ad_day_runs r ON r.id = c.run_id;
  RETURN v_out;
END;
$$;

/**
 * Write one account's ad-days for a leased days task: p = {taskId,
 * leaseToken, fetchedAt, rows [...], final, note}. Up to 2,000 rows a call;
 * every row must be inside the task's days and account. Upserted by (ad_id,
 * day): a row read later replaces it, a row read earlier does not. spend_usd
 * is spend at the fixed rate of the account's currency. `final` closes the
 * task (and the run when it was the last).
 */
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
        WHEN least(r.spend, r.frequency) < 0 OR least(r.impressions, r.reach, r.link_clicks, r.leads, r.lead_actions, r.landing_page_views,
               r.video_plays, r.video_3s, r.video_p25, r.video_p50, r.video_p75, r.video_p100, r.thruplays) < 0 THEN 'a negative number'
        WHEN r.leads > r.lead_actions THEN 'more leads than lead actions'
        WHEN r.destination_type IS NOT NULL AND r.destination_type !~ '^[A-Z_]{1,60}$' THEN 'a destination that is not one of Meta''s names'
        WHEN r.leads IS NOT NULL AND (r.destination_type IN ('WHATSAPP','MESSENGER','INSTAGRAM_DIRECT','LEAD_FROM_MESSENGER','LEAD_FROM_IG_DIRECT')
               OR r.destination_type LIKE 'MESSAGING\_%') THEN 'form leads on a chat ad set'
      END AS why
    FROM jsonb_to_recordset(v_rows) AS r(account_id text, day date, campaign_id text, adset_id text, ad_id text, spend numeric, frequency numeric,
      impressions bigint, reach bigint, link_clicks bigint, leads bigint, lead_actions bigint, landing_page_views bigint, video_plays bigint,
      video_3s bigint, video_p25 bigint, video_p50 bigint, video_p75 bigint, video_p100 bigint, thruplays bigint, destination_type text)
  ) x WHERE x.why IS NOT NULL LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Meta''s rows for act_% held %; nothing was written', t.account_id, v_bad USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) <> count(DISTINCT (r->>'ad_id') || '|' || (r->>'day')) FROM jsonb_array_elements(v_rows) r) THEN
    RAISE EXCEPTION 'Meta''s rows for act_% held one ad twice on a day; nothing was written', t.account_id USING ERRCODE='22023';
  END IF;

  SELECT count(*)::int, count(*) FILTER (WHERE x.ad_id IS NULL)::int,
         count(*) FILTER (WHERE x.ad_id IS NOT NULL AND x.fetched_at <= v_fetched AND
           (x.account_id, x.campaign_id, x.campaign_name, x.objective, x.adset_id, x.adset_name, x.ad_name, x.spend, x.impressions, x.reach,
            x.frequency, x.link_clicks, x.leads, x.lead_actions, x.landing_page_views, x.video_plays, x.video_3s, x.video_p25, x.video_p50,
            x.video_p75, x.video_p100, x.thruplays, x.destination_type)
           IS DISTINCT FROM
           (r.account_id, r.campaign_id, r.campaign_name, r.objective, r.adset_id, r.adset_name, r.ad_name, r.spend, r.impressions, r.reach,
            r.frequency, r.link_clicks, r.leads, r.lead_actions, r.landing_page_views, r.video_plays, r.video_3s, r.video_p25, r.video_p50,
            r.video_p75, r.video_p100, r.thruplays, r.destination_type))::int,
         count(*) FILTER (WHERE x.fetched_at > v_fetched)::int,
         sum(r.spend), sum(r.leads)
    INTO v_n, v_new, v_changed, v_older, v_spend, v_leads
  FROM jsonb_to_recordset(v_rows) AS r(account_id text, day date, campaign_id text, campaign_name text, objective text, adset_id text,
      adset_name text, ad_id text, ad_name text, spend numeric, impressions bigint, reach bigint, frequency numeric, link_clicks bigint,
      leads bigint, lead_actions bigint, landing_page_views bigint, video_plays bigint, video_3s bigint, video_p25 bigint, video_p50 bigint,
      video_p75 bigint, video_p100 bigint, thruplays bigint, destination_type text)
  LEFT JOIN public.cockpit_meta_ad_days x ON x.ad_id = r.ad_id AND x.day = r.day;

  INSERT INTO public.cockpit_meta_ad_days AS x(account_id, account_name, account_timezone, account_currency, day, campaign_id, campaign_name,
    objective, adset_id, adset_name, ad_id, ad_name, spend, spend_usd, usd_rate, impressions, reach, frequency, link_clicks, leads, lead_actions,
    landing_page_views, video_plays, video_3s, video_p25, video_p50, video_p75, video_p100, thruplays, destination_type, fetched_at)
  SELECT t.account_id, t.account_name, t.account_timezone, t.account_currency, r.day, r.campaign_id, left(r.campaign_name, 400), left(r.objective, 60),
    r.adset_id, left(r.adset_name, 400), r.ad_id, left(r.ad_name, 400), r.spend,
    CASE WHEN r.spend IS NOT NULL AND v_rate IS NOT NULL THEN round(r.spend * v_rate, 6) END,
    CASE WHEN r.spend IS NOT NULL AND v_rate IS NOT NULL THEN v_rate END,
    r.impressions, r.reach, r.frequency, r.link_clicks, r.leads, r.lead_actions, r.landing_page_views, r.video_plays, r.video_3s,
    r.video_p25, r.video_p50, r.video_p75, r.video_p100, r.thruplays, r.destination_type, v_fetched
  FROM jsonb_to_recordset(v_rows) AS r(day date, campaign_id text, campaign_name text, objective text, adset_id text, adset_name text,
      ad_id text, ad_name text, spend numeric, impressions bigint, reach bigint, frequency numeric, link_clicks bigint, leads bigint,
      lead_actions bigint, landing_page_views bigint, video_plays bigint, video_3s bigint, video_p25 bigint, video_p50 bigint, video_p75 bigint,
      video_p100 bigint, thruplays bigint, destination_type text)
  ON CONFLICT (ad_id, day) DO UPDATE SET
    account_id = EXCLUDED.account_id, account_name = EXCLUDED.account_name, account_timezone = EXCLUDED.account_timezone,
    account_currency = EXCLUDED.account_currency, campaign_id = EXCLUDED.campaign_id, campaign_name = EXCLUDED.campaign_name,
    objective = EXCLUDED.objective, adset_id = EXCLUDED.adset_id, adset_name = EXCLUDED.adset_name, ad_name = EXCLUDED.ad_name,
    spend = EXCLUDED.spend, spend_usd = EXCLUDED.spend_usd, usd_rate = EXCLUDED.usd_rate, impressions = EXCLUDED.impressions,
    reach = EXCLUDED.reach, frequency = EXCLUDED.frequency, link_clicks = EXCLUDED.link_clicks, leads = EXCLUDED.leads,
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

/**
 * Write one level of one account's reach for a leased reach task: p =
 * {taskId, leaseToken, level, computedAt, rows [{key, window_key, reach,
 * impressions}], final}. The account's earlier rows of that level for the
 * task's windows are replaced (an ad without delivery in a window has no row).
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_reach_apply(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.cockpit_meta_ad_day_tasks; v_level text := p->>'level'; v_rows jsonb := p->'rows'; v_at timestamptz; v_bad text; v_n int;
  v_final boolean := coalesce((p->>'final')::boolean, false); v_state text;
BEGIN
  PERFORM public.cockpit_meta_ad_days_require_service();
  t := public.cockpit_meta_ad_days_leased(p, ARRAY['reach_account','reach_all']);
  IF v_level IS NULL OR v_level NOT IN ('account','campaign','adset','ad') OR (t.kind = 'reach_account' AND v_level <> 'account') THEN
    RAISE EXCEPTION 'level is account, campaign, adset or ad (account only on an account task)' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(v_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(v_rows) > 25000 THEN
    RAISE EXCEPTION 'Send rows as a list of at most 25000' USING ERRCODE='22023';
  END IF;
  BEGIN
    v_at := (p->>'computedAt')::timestamptz;
  EXCEPTION WHEN others THEN v_at := NULL;
  END;
  IF v_at IS NULL OR v_at > public.cockpit_meta_ad_days_now() + interval '5 minutes' OR v_at < public.cockpit_meta_ad_days_now() - interval '1 hour' THEN
    RAISE EXCEPTION 'computedAt must be when Meta answered, within the last hour' USING ERRCODE='22023';
  END IF;
  SELECT x.why INTO v_bad FROM (
    SELECT CASE
        WHEN r.key IS NULL OR r.key !~ '^[0-9]{5,25}$' THEN 'a row without a valid id'
        WHEN v_level = 'account' AND r.key <> t.account_id THEN 'another ad account'
        WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.windows) w WHERE w->>'key' = r.window_key) THEN 'a window the task did not ask for'
        WHEN least(r.reach, r.impressions) < 0 THEN 'a negative number'
      END AS why
    FROM jsonb_to_recordset(v_rows) AS r(key text, window_key text, reach bigint, impressions bigint)
  ) x WHERE x.why IS NOT NULL LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Meta''s reach for act_% held %; nothing was written', t.account_id, v_bad USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) <> count(DISTINCT (r->>'key') || '|' || (r->>'window_key')) FROM jsonb_array_elements(v_rows) r) THEN
    RAISE EXCEPTION 'Meta''s reach for act_% held one % twice in a window' , t.account_id, v_level USING ERRCODE='22023';
  END IF;

  DELETE FROM public.cockpit_meta_reach x WHERE x.account_id = t.account_id AND x.level = v_level
    AND x.window_key IN (SELECT w->>'key' FROM jsonb_array_elements(t.windows) w);
  INSERT INTO public.cockpit_meta_reach AS x(level, key, window_key, from_day, to_day, reach, impressions, computed_at, account_id, note)
  SELECT v_level, r.key, r.window_key, (w->>'from')::date, (w->>'to')::date, r.reach, r.impressions, v_at, t.account_id, NULL
  FROM jsonb_to_recordset(v_rows) AS r(key text, window_key text, reach bigint, impressions bigint)
  JOIN jsonb_array_elements(t.windows) w ON w->>'key' = r.window_key
  ON CONFLICT (level, key, window_key) DO UPDATE SET from_day = EXCLUDED.from_day, to_day = EXCLUDED.to_day, reach = EXCLUDED.reach,
    impressions = EXCLUDED.impressions, computed_at = EXCLUDED.computed_at, account_id = EXCLUDED.account_id, note = NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.cockpit_meta_ad_day_tasks SET rows_read = rows_read + v_n,
    state = CASE WHEN v_final THEN 'done' ELSE state END,
    error = CASE WHEN v_final THEN NULL ELSE error END,
    lease_token = CASE WHEN v_final THEN NULL ELSE lease_token END,
    lease_until = CASE WHEN v_final THEN NULL ELSE public.cockpit_meta_ad_days_now() + interval '5 minutes' END,
    updated_at = pg_catalog.now()
  WHERE id = t.id;
  IF v_final THEN v_state := public.cockpit_meta_ad_days_finish(t.run_id); END IF;
  RETURN jsonb_build_object('ok', true, 'written', v_n, 'final', v_final, 'run', v_state);
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
  t := public.cockpit_meta_ad_days_leased(p, ARRAY['days','reach_account','reach_all']);
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
 * A job that did not get as far as a run (the accounts could not be listed,
 * the job stopped), or the doctor's verdict: p = {job, ok, note, requestedBy,
 * detail}. Writes the sync-state row meta-ad-days-<job> and one audit row.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_record(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job text := p->>'job'; v_ok boolean := coalesce((p->>'ok')::boolean, false); v_note text; v_by text;
BEGIN
  PERFORM public.cockpit_meta_ad_days_require_service();
  IF v_job IS NULL OR v_job NOT IN ('hourly','nightly','backfill','continue','doctor') THEN
    RAISE EXCEPTION 'job is hourly, nightly, backfill, continue or doctor' USING ERRCODE='22023';
  END IF;
  v_note := left(coalesce(nullif(btrim(p->>'note'), ''), CASE WHEN v_ok THEN 'Checked' ELSE 'Failed without a reason' END), 500);
  v_by := CASE WHEN coalesce(p->>'requestedBy','') ~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN lower(p->>'requestedBy') ELSE 'meta-ad-days' END;
  INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, detail, updated_at)
  VALUES ('meta-ad-days-' || v_job, pg_catalog.now(), CASE WHEN v_ok THEN pg_catalog.now() END, v_ok, v_note,
    CASE WHEN jsonb_typeof(p->'detail') = 'object' THEN p->'detail' ELSE '{}'::jsonb END, pg_catalog.now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = pg_catalog.now(),
    last_ok_at = CASE WHEN v_ok THEN pg_catalog.now() ELSE public.cockpit_sync_state.last_ok_at END,
    ok = v_ok, note = EXCLUDED.note, detail = EXCLUDED.detail, updated_at = pg_catalog.now();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, "before", "after")
  VALUES (CASE WHEN v_job = 'doctor' THEN 'meta_ad_days.doctor' ELSE 'meta_ad_days.not_run' END, 'meta_ad_day_job', v_job, v_by, 'board',
    'meta-ad-days', NULL, jsonb_build_object('ok', v_ok, 'note', v_note));
  RETURN jsonb_build_object('ok', true);
END;
$$;

/**
 * How fresh the store is, for the board's read (its SECURITY DEFINER
 * functions call this as the owner) and for the doctor (service role): the
 * last run of each job, the sync-state rows, the queue, each account's last
 * day and last read with its failure if the latest read failed, the accounts
 * not linked to a client, and the reach rows per level.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_today date := public.cockpit_meta_ad_days_today(); v_ties jsonb := public.cockpit_meta_ad_days_ties();
BEGIN
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
    'accounts', coalesce((
      WITH latest AS (
        SELECT x.accounts FROM public.cockpit_meta_ad_day_runs x WHERE x.job IN ('hourly','nightly') AND x.state <> 'running'
        ORDER BY x.started_at DESC LIMIT 1
      ), ids AS (
        SELECT d.account_id FROM public.cockpit_meta_ad_days d GROUP BY d.account_id
        UNION SELECT a->>'accountId' FROM latest CROSS JOIN LATERAL jsonb_array_elements(latest.accounts) a
      )
      SELECT jsonb_agg(jsonb_build_object('accountId', i.account_id, 'name', coalesce(s.account_name, l.name), 'currency', s.account_currency,
               'timezone', s.account_timezone, 'lastDay', s.last_day, 'lastFetchedAt', s.last_fetched,
               'linked', (v_ties->'accounts') ? i.account_id, 'locationId', v_ties->'accounts'->i.account_id->>'locationId',
               'failing', CASE WHEN f.state = 'failed' THEN f.error END, 'failingSince', CASE WHEN f.state = 'failed' THEN f.updated_at END)
             ORDER BY i.account_id)
      FROM ids i
      LEFT JOIN LATERAL (SELECT max(d.account_name) AS account_name, max(d.account_currency) AS account_currency,
                                max(d.account_timezone) AS account_timezone, max(d.day) AS last_day, max(d.fetched_at) AS last_fetched
                         FROM public.cockpit_meta_ad_days d WHERE d.account_id = i.account_id) s ON true
      LEFT JOIN LATERAL (SELECT a->>'name' AS name FROM latest CROSS JOIN LATERAL jsonb_array_elements(latest.accounts) a
                         WHERE a->>'accountId' = i.account_id LIMIT 1) l ON true
      LEFT JOIN LATERAL (SELECT t.state, t.error, t.updated_at FROM public.cockpit_meta_ad_day_tasks t
                         WHERE t.account_id = i.account_id AND t.kind = 'days' AND t.state IN ('done','failed')
                         ORDER BY t.updated_at DESC, t.id DESC LIMIT 1) f ON true), '[]'::jsonb),
    'notLinked', coalesce((
      SELECT jsonb_agg(jsonb_build_object('accountId', a->>'accountId', 'name', a->>'name', 'currency', a->>'currency', 'spend', a->'spend')
               ORDER BY a->>'accountId')
      FROM (SELECT x.accounts, x.detail FROM public.cockpit_meta_ad_day_runs x WHERE x.job IN ('hourly','nightly') AND x.state <> 'running'
            ORDER BY x.started_at DESC LIMIT 1) r CROSS JOIN LATERAL jsonb_array_elements(r.accounts) a
      WHERE r.detail->>'tieSource' = 'board_clients' AND (a->>'linked')::boolean IS NOT TRUE), '[]'::jsonb),
    'reach', coalesce((SELECT jsonb_object_agg(x.level, jsonb_build_object('rows', x.n, 'oldest', x.oldest, 'newest', x.newest))
               FROM (SELECT level, count(*) AS n, min(computed_at) AS oldest, max(computed_at) AS newest FROM public.cockpit_meta_reach GROUP BY level) x), '{}'::jsonb));
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. The kicks (vault, pg_net and pg_cron only where they exist)

/**
 * Post {"job": p_job} to meta-ad-days with the cron secret. 'continue' first
 * expires what ran out of time, then posts only while a task waits and fewer
 * than 3 are being read, so an idle queue costs no call.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_kick(p_job text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_url constant text := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/meta-ad-days';
  v_secret text; v_request bigint; v_note text;
BEGIN
  IF p_job IS NULL OR p_job NOT IN ('hourly','nightly','continue') THEN
    RAISE EXCEPTION 'The kick posts hourly, nightly or continue' USING ERRCODE='22023';
  END IF;
  IF p_job = 'continue' THEN
    PERFORM public.cockpit_meta_ad_days_expire();
    IF NOT EXISTS (SELECT 1 FROM public.cockpit_meta_ad_day_tasks t JOIN public.cockpit_meta_ad_day_runs r ON r.id = t.run_id
                   WHERE r.state = 'running' AND t.attempts < 4
                     AND ((t.state = 'pending' AND (t.retry_at IS NULL OR t.retry_at <= public.cockpit_meta_ad_days_now()))
                          OR (t.state = 'running' AND t.lease_until < public.cockpit_meta_ad_days_now()))) THEN
      RETURN NULL;
    END IF;
    IF (SELECT count(*) FROM public.cockpit_meta_ad_day_tasks WHERE state = 'running' AND lease_until >= public.cockpit_meta_ad_days_now()) >= 3 THEN
      RETURN NULL;
    END IF;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name=$1 LIMIT 1' INTO v_secret USING 'cockpit_sync_secret';
  END IF;
  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    v_note := 'The vault has no cockpit_sync_secret, so meta-ad-days was not started. Add it to the vault.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid = f.pronamespace
                    WHERE n.nspname = 'net' AND f.proname = 'http_post') THEN
    v_note := 'pg_net is not installed, so meta-ad-days was not started. Turn the pg_net extension on.';
  END IF;
  IF v_note IS NOT NULL THEN
    INSERT INTO public.cockpit_sync_state(key, last_run_at, ok, note, updated_at)
    VALUES ('meta-ad-days-kick', pg_catalog.now(), false, v_note, pg_catalog.now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = pg_catalog.now(), ok = false, note = EXCLUDED.note, updated_at = pg_catalog.now();
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)' INTO v_request
    USING v_url, jsonb_build_object('job', p_job), jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret);
  INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, updated_at)
  VALUES ('meta-ad-days-kick', pg_catalog.now(), pg_catalog.now(), true, 'Posted ' || p_job, pg_catalog.now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = pg_catalog.now(), last_ok_at = pg_catalog.now(), ok = true, note = EXCLUDED.note, updated_at = pg_catalog.now();
  RETURN v_request;
END;
$$;

-- cron:begin
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname IN (''mahara-meta-ad-days-hourly'',''mahara-meta-ad-days-nightly'',''mahara-meta-ad-days-drain'')';
    EXECUTE $q$SELECT cron.schedule('mahara-meta-ad-days-hourly','7 * * * *',$job$SELECT public.cockpit_meta_ad_days_kick('hourly');$job$)$q$;
    EXECUTE $q$SELECT cron.schedule('mahara-meta-ad-days-nightly','20 0 * * *',$job$SELECT public.cockpit_meta_ad_days_kick('nightly');$job$)$q$;
    EXECUTE $q$SELECT cron.schedule('mahara-meta-ad-days-drain','*/2 * * * *',$job$SELECT public.cockpit_meta_ad_days_kick('continue');$job$)$q$;
  END IF;
END $$;
-- cron:end

-- ---------------------------------------------------------------------------
-- 6. Function privileges: revoked from all four roles, then exactly the grants below

DO $$
DECLARE f text;
BEGIN
  -- Internal: no role at all (called by the definer functions above, by pg_cron as their owner,
  -- or, for the windows, the ties and the rate, by the board's own definer functions).
  FOREACH f IN ARRAY ARRAY[
    'cockpit_meta_ad_days_require_service()','cockpit_meta_ad_days_now()','cockpit_meta_ad_days_today()',
    'cockpit_meta_ad_days_usd_per(text)','cockpit_meta_reach_windows(date)','cockpit_meta_reach_windows_json(date)',
    'cockpit_meta_ad_days_ties()','cockpit_meta_ad_days_try_date(text)','cockpit_meta_ad_days_leased(jsonb,text[])',
    'cockpit_meta_reach_rebuild_clients()','cockpit_meta_ad_days_finish(uuid)','cockpit_meta_ad_days_expire()',
    'cockpit_meta_ad_days_kick(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- Service RPCs, called by the Edge Function meta-ad-days with the service key.
  FOREACH f IN ARRAY ARRAY['cockpit_meta_ad_days_inputs(jsonb)','cockpit_meta_ad_days_begin(jsonb)','cockpit_meta_ad_days_claim(jsonb)',
    'cockpit_meta_ad_days_apply(jsonb)','cockpit_meta_reach_apply(jsonb)','cockpit_meta_ad_days_fail(jsonb)',
    'cockpit_meta_ad_days_record(jsonb)','cockpit_meta_ad_days_status()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
