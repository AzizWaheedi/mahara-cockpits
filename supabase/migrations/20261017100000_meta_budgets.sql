-- Meta budgets for the Client Performance board, 2026-10-17 (Creative Triage
-- bldgtotkfmhoxmlzowdx).
--
-- The CEO, 2026-10-17: "the daily budget of all the campaigns in the account
-- and then how much is actually being spent. Sometimes the campaign isnt
-- spending as much as the budget, or its not spending enough." Nothing stored
-- held a budget the board could trust: cockpit_campaigns.raw_data keeps 14
-- board-card campaigns, divides every currency by 100, and sums paused ad sets
-- when none is active. This file is the store, filled by the Edge Function
-- meta-ad-days (GET only, Graph v25.0):
--
--   cockpit_meta_budgets              now: one row per campaign and per ad set of every account read
--                                     (act_<id>/campaigns, archived and deleted left out), replaced
--                                     whole at each read of the account. Amounts in the account
--                                     currency's major units (Meta's minor units / Meta's currency
--                                     offset), plus daily_budget_usd at the cockpit's fixed rates.
--   cockpit_meta_budget_days          one row per campaign per day on the ACCOUNT's clock: the
--                                     campaign's effective daily budget at the last read of that day
--                                     (source snapshot, every hourly read), or rebuilt from Meta's
--                                     activity log for a day no read covers (source activity,
--                                     verified when the log's chain ends at the live budget).
--   cockpit_meta_budget_account_days  one row per account per day that was read: snapshot (an hourly
--                                     read) or activity (the history). An account day with no row was
--                                     not read: its budgets are unknown, never 0.
--   cockpit_meta_account_state        the account's Meta status, spending limit and amount spent
--                                     (major units; NULL when there is no limit) at the last read;
--                                     on a prepaid account (is_prepay) the "limit" is the funds added.
--   cockpit_meta_spend_reads          the account days whose spend Meta answered: a finished day
--                                     read (days), or the business listing finding no spend over its
--                                     window (discovery). A budget day with no ad-day rows is $0 spent
--                                     only on such a day; otherwise it was not read.
--   two task kinds                    budgets (hourly, one per account that spent or is tied to an
--                                     Active client, 5 minutes after the run starts so it lands after
--                                     the :07 burst that rate-limits Arcturus) and activities (nightly
--                                     14 days, a backfill its days).
--   cockpit_meta_budgets_apply        the hourly read: current rows, today's day rows, account state
--   cockpit_meta_budget_history_apply the activity history: day rows for days no read covers, and on
--                                     a day a read covers the campaigns no read saw switched on
--
-- Also: "Read X of Y ad accounts" counts the ad-day reads only (the nightly of
-- 17 Oct said "Read 8 of 29" although all 116 day reads were done: every lead
-- ids task had failed, see db.ts), and budgets and their history get their own
-- lines in the run's note and their own state (status().budgets): a budgets
-- or history read that fails never makes the run partial for the ad numbers.
--
-- Rules:
--   - Missing is never zero. A campaign day with no row on an account day that
--     was read means the campaign was switched off at every read of that day
--     (or did not exist); on an account day that was not read it means nothing.
--   - Switched on (what the board's budgets count, the CEO's "budget set, not
--     spending" included): the campaign's status is ACTIVE, its start has passed
--     and its end has not, and at least one of its ad sets is the same. A
--     campaign waiting for its start is not switched on yet (starts_at).
--   - CBO (budget_level campaign): the campaign's own budget. ABO (budget_level
--     adset): the sum of the ad sets switched on, delivering or not, so a
--     campaign blocked by its ads, its account or a spending limit shows the
--     budget it is set to spend. A paused or ended ad set never counts.
--   - Delivering is the explanation, never the filter: the account is active
--     or in its grace period (Meta status 1 or 9), its spending limit (or
--     prepaid balance) is not used up, the campaign and the ad set are ACTIVE
--     and running, and at least one ad under it is ACTIVE. Otherwise why_not
--     says why in plain words. The activity history does not follow the ads,
--     so its rows say nothing about delivery (delivering NULL).
--   - A day's budget: the highest daily budget the campaign was switched on
--     with at any read (snapshot) or moment (activity) of that day, so a
--     campaign paused at noon keeps the budget it spent that morning against.
--   - Lifetime budgets stay lifetime: no daily figure.
--
-- The Edge Function changes with this file and either can go first: an older
-- function sends no budgetAccounts or activityAccounts (no budget tasks), and
-- a newer function on an older database is ignored the same way (the
-- leadIds pattern).
--
-- How we know it works: apps/media-buyer-cockpit/scripts/meta-ad-days-supabase.test.ts
-- loads 20261016121700, 20261016210100 and this file on PGlite. Safe to apply
-- twice.
--
-- Rollback: drop the five tables and the five new functions
-- (cockpit_meta_budgets_apply, cockpit_meta_budget_history_apply,
-- cockpit_meta_budget_day, cockpit_meta_budget_try_ts,
-- cockpit_meta_budget_accounts_bad), delete the budgets and activities tasks,
-- put back the kind CHECK and the span CHECK ((kind = 'days') = (since IS NOT
-- NULL AND until IS NOT NULL)), drop account_state, and re-run inputs, begin,
-- claim, fail, finish and status from 20261016210100_meta_ad_days_checked.sql.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regprocedure('public.cockpit_meta_lead_ids_apply(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261016210100_meta_ad_days_checked.sql first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Tables

CREATE TABLE IF NOT EXISTS public.cockpit_meta_budgets (
  level text NOT NULL CHECK (level IN ('campaign','adset')),
  object_id text NOT NULL CHECK (object_id ~ '^[0-9]{5,25}$'),
  account_id text NOT NULL CHECK (account_id ~ '^[0-9]{5,25}$'),
  campaign_id text NOT NULL CHECK (campaign_id ~ '^[0-9]{5,25}$'),
  name text CHECK (name IS NULL OR length(name) <= 400),
  objective text CHECK (objective IS NULL OR length(objective) <= 60),
  status text CHECK (status IS NULL OR status ~ '^[A-Z_]{1,40}$'),
  effective_status text CHECK (effective_status IS NULL OR effective_status ~ '^[A-Z_]{1,40}$'),
  budget_level text NOT NULL CHECK (budget_level IN ('campaign','adset')),
  budget_type text CHECK (budget_type IS NULL OR budget_type IN ('daily','lifetime')),
  daily_budget numeric CHECK (daily_budget IS NULL OR daily_budget >= 0),
  lifetime_budget numeric CHECK (lifetime_budget IS NULL OR lifetime_budget >= 0),
  budget_remaining numeric CHECK (budget_remaining IS NULL OR budget_remaining >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  currency_offset integer NOT NULL CHECK (currency_offset IN (1, 100)),
  usd_rate numeric CHECK (usd_rate IS NULL OR usd_rate > 0),
  daily_budget_usd numeric CHECK (daily_budget_usd IS NULL OR daily_budget_usd >= 0),
  start_time timestamptz,
  end_time timestamptz,
  ads_active integer NOT NULL CHECK (ads_active >= 0),
  ads_with_issues integer NOT NULL CHECK (ads_with_issues >= 0),
  issues jsonb CHECK (issues IS NULL OR (jsonb_typeof(issues) = 'array' AND length(issues::text) <= 2000)),
  switched_on boolean NOT NULL,
  starts_at timestamptz,
  delivering boolean NOT NULL,
  why_not text CHECK (why_not IS NULL OR length(why_not) <= 300),
  fetched_at timestamptz NOT NULL,
  run_id uuid,
  PRIMARY KEY (level, object_id),
  CONSTRAINT cockpit_meta_budgets_waiting_is_off CHECK (starts_at IS NULL OR NOT switched_on),
  CONSTRAINT cockpit_meta_budgets_campaign_is_itself CHECK (level = 'adset' OR campaign_id = object_id),
  CONSTRAINT cockpit_meta_budgets_usd_has_rate CHECK (daily_budget_usd IS NULL OR usd_rate IS NOT NULL),
  CONSTRAINT cockpit_meta_budgets_says_why CHECK (delivering OR why_not IS NOT NULL),
  CONSTRAINT cockpit_meta_budgets_delivering_is_on CHECK (NOT delivering OR switched_on),
  CONSTRAINT cockpit_meta_budgets_daily_has_amount CHECK (budget_type IS DISTINCT FROM 'daily' OR daily_budget IS NOT NULL),
  CONSTRAINT cockpit_meta_budgets_lifetime_no_daily CHECK (budget_type IS DISTINCT FROM 'lifetime' OR (daily_budget IS NULL AND lifetime_budget IS NOT NULL)),
  CONSTRAINT cockpit_meta_budgets_none_no_amount CHECK (budget_type IS NOT NULL OR (daily_budget IS NULL AND lifetime_budget IS NULL))
);
COMMENT ON TABLE public.cockpit_meta_budgets IS
  'Meta budgets now: one row per campaign and per ad set of every ad account meta-ad-days read (hourly: the accounts that spent in the last two days and the accounts tied to an Active client; act_<id>/campaigns with its ad sets and their ads'' statuses, archived and deleted campaigns left out). Each read replaces the account''s rows, so an object no longer listed is gone. Amounts are the account currency''s major units (Meta''s minor units / currency_offset), NULL when Meta returned none; the string "0" is no budget. History per day is in cockpit_meta_budget_days.';
COMMENT ON COLUMN public.cockpit_meta_budgets.budget_level IS 'campaign = CBO (the campaign has its own daily or lifetime budget); adset = ABO (the ad sets hold the budgets). The campaign''s level, on its ad set rows too.';
COMMENT ON COLUMN public.cockpit_meta_budgets.daily_budget IS 'Major units of the account currency. Campaign rows: CBO the campaign''s budget; ABO the sum of the daily budgets of the ad sets switched on (status ACTIVE, started, not ended), delivering or not, so a blocked campaign shows the budget it is set to spend; paused and ended ad sets never count. Ad set rows: the ad set''s own budget, NULL under a CBO campaign. NULL on a lifetime budget.';
COMMENT ON COLUMN public.cockpit_meta_budgets.daily_budget_usd IS 'daily_budget x usd_rate (cockpit_meta_ad_days_usd_per). NULL when the currency has no fixed rate, never one to one.';
COMMENT ON COLUMN public.cockpit_meta_budgets.budget_remaining IS 'Meta''s budget_remaining in major units: on a daily budget, the budget less today''s spend (today''s pacing, on the account''s clock). A CBO campaign''s own; an ABO campaign''s is the sum of its counted ad sets'' own (Meta''s campaign-level figure is not their sum). NULL on an object without its own budget.';
COMMENT ON COLUMN public.cockpit_meta_budgets.switched_on IS 'The buyer has it set to spend: status ACTIVE, its start passed and its end not; a campaign also needs at least one ad set switched on. Blocked or not (its ads, its account, a spending limit): delivering says that. Off: paused, ended, every ad set paused, or waiting for its start (starts_at).';
COMMENT ON COLUMN public.cockpit_meta_budgets.starts_at IS 'On, but waiting for its start: the campaign''s own start, or the earliest start of its ad sets when every ad set switched on starts later. NULL otherwise. Not switched on yet, and not a problem.';
COMMENT ON COLUMN public.cockpit_meta_budgets.delivering IS 'The explanation, not the filter: Meta can spend it now (account status 1 or 9 and its spending limit or prepaid balance not used up, campaign and ad set effective_status ACTIVE, started and not ended, and at least one ad under it ACTIVE). Campaign rows: at least one ad set delivers.';
COMMENT ON COLUMN public.cockpit_meta_budgets.why_not IS 'Why it is not delivering, in plain words (Account unsettled: payment needed; Spending limit reached; Prepaid balance used up: add funds; Paused; Ended; Starts 20 Oct; Ads with issues; Ads not approved yet...). NULL while delivering.';
COMMENT ON COLUMN public.cockpit_meta_budgets.ads_with_issues IS 'Ads whose effective_status is WITH_ISSUES or DISAPPROVED.';
COMMENT ON COLUMN public.cockpit_meta_budgets.issues IS 'Meta''s issues_info on a campaign, short: [{level, code, summary}], at most 5.';
CREATE INDEX IF NOT EXISTS cockpit_meta_budgets_account_idx ON public.cockpit_meta_budgets(account_id, level);
CREATE INDEX IF NOT EXISTS cockpit_meta_budgets_campaign_idx ON public.cockpit_meta_budgets(campaign_id);

CREATE TABLE IF NOT EXISTS public.cockpit_meta_budget_days (
  campaign_id text NOT NULL CHECK (campaign_id ~ '^[0-9]{5,25}$'),
  day date NOT NULL,
  account_id text NOT NULL CHECK (account_id ~ '^[0-9]{5,25}$'),
  budget_level text NOT NULL CHECK (budget_level IN ('campaign','adset')),
  budget_type text CHECK (budget_type IS NULL OR budget_type IN ('daily','lifetime')),
  daily_budget numeric CHECK (daily_budget IS NULL OR daily_budget >= 0),
  daily_budget_usd numeric CHECK (daily_budget_usd IS NULL OR daily_budget_usd >= 0),
  max_switched_on_budget numeric CHECK (max_switched_on_budget IS NULL OR max_switched_on_budget > 0),
  max_switched_on_budget_usd numeric CHECK (max_switched_on_budget_usd IS NULL OR max_switched_on_budget_usd > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  usd_rate numeric CHECK (usd_rate IS NULL OR usd_rate > 0),
  switched_on boolean NOT NULL,
  switched_on_any boolean NOT NULL,
  delivering boolean,
  delivering_any boolean,
  why_not text CHECK (why_not IS NULL OR length(why_not) <= 300),
  changed_during_day boolean NOT NULL DEFAULT false,
  source text NOT NULL CHECK (source IN ('snapshot','activity')),
  verified boolean NOT NULL,
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  run_id uuid,
  PRIMARY KEY (campaign_id, day),
  CONSTRAINT cockpit_meta_budget_days_seen CHECK (last_seen >= first_seen),
  CONSTRAINT cockpit_meta_budget_days_daily_only CHECK ((budget_type = 'daily') = (daily_budget IS NOT NULL)),
  CONSTRAINT cockpit_meta_budget_days_usd_has_rate CHECK ((daily_budget_usd IS NULL AND max_switched_on_budget_usd IS NULL) OR usd_rate IS NOT NULL),
  CONSTRAINT cockpit_meta_budget_days_says_why CHECK (delivering IS DISTINCT FROM false OR why_not IS NOT NULL),
  CONSTRAINT cockpit_meta_budget_days_any CHECK (delivering IS NOT TRUE OR delivering_any IS TRUE),
  CONSTRAINT cockpit_meta_budget_days_on_any CHECK (NOT switched_on OR switched_on_any),
  CONSTRAINT cockpit_meta_budget_days_max_on CHECK (max_switched_on_budget IS NULL OR switched_on_any),
  CONSTRAINT cockpit_meta_budget_days_max_usd CHECK (max_switched_on_budget_usd IS NULL OR max_switched_on_budget IS NOT NULL),
  -- A read knows whether it delivered; the activity log does not follow the ads, so it never says.
  CONSTRAINT cockpit_meta_budget_days_delivery_known CHECK (CASE WHEN source = 'snapshot' THEN delivering IS NOT NULL AND delivering_any IS NOT NULL
                                                             ELSE delivering IS NULL AND delivering_any IS NULL END),
  CONSTRAINT cockpit_meta_budget_days_snapshot_read CHECK (source = 'activity' OR verified)
);
COMMENT ON TABLE public.cockpit_meta_budget_days IS
  'Each campaign''s daily budget per day on the ACCOUNT''s clock (as Meta counts spend in cockpit_meta_ad_days). A campaign gets a row on a day it was switched on at some read (snapshot) or at some moment (activity). source snapshot: every hourly read upserts today''s row, the last read of the day wins, max_switched_on_budget keeps the highest daily budget it was switched on with. source activity: rebuilt from Meta''s activity log for a day no read covers (cockpit_meta_budget_account_days), never over a snapshot row; verified when the log''s chain of changes ends at the live budget; it says nothing about delivery. The board counts a campaign day at max_switched_on_budget_usd. Whether an account day was read at all: cockpit_meta_budget_account_days.';
COMMENT ON COLUMN public.cockpit_meta_budget_days.day IS 'The ad account''s own day (account timezone), the same calendar as cockpit_meta_ad_days.day.';
COMMENT ON COLUMN public.cockpit_meta_budget_days.daily_budget IS 'The campaign''s daily budget in the account currency''s major units: CBO the campaign budget; ABO the sum of its ad sets switched on. Snapshot: at the last read of the day; activity: at the end of the day. NULL on a lifetime budget (budget_type lifetime) or none (budget_type NULL).';
COMMENT ON COLUMN public.cockpit_meta_budget_days.max_switched_on_budget IS 'The day''s budget for the board: the highest daily budget the campaign was switched on with at any read (snapshot) or moment (activity) of the day, so a campaign paused at noon keeps the budget it spent that morning against. NULL when it was never switched on with a daily budget that day.';
COMMENT ON COLUMN public.cockpit_meta_budget_days.max_switched_on_budget_usd IS 'max_switched_on_budget x usd_rate; NULL when the currency has no fixed USD rate, never one to one.';
COMMENT ON COLUMN public.cockpit_meta_budget_days.switched_on IS 'Switched on at the last read of the day (snapshot) or at the end of the day (activity).';
COMMENT ON COLUMN public.cockpit_meta_budget_days.switched_on_any IS 'Switched on at any read (snapshot) or moment (activity) of the day.';
COMMENT ON COLUMN public.cockpit_meta_budget_days.delivering IS 'Snapshot rows: delivering at the last read of the day (an explanation, never the board''s filter). Activity rows: NULL, since the activity log does not follow the ads.';
COMMENT ON COLUMN public.cockpit_meta_budget_days.delivering_any IS 'Snapshot rows: delivering at any read of the day. Activity rows: NULL.';
COMMENT ON COLUMN public.cockpit_meta_budget_days.why_not IS 'Snapshot rows: why it was not delivering at the last read (NULL while delivering). Activity rows: only what the log shows at the end of the day (the account''s status, Paused, Ended); NULL never means it delivered.';
COMMENT ON COLUMN public.cockpit_meta_budget_days.changed_during_day IS 'The budget (its amount or type) changed between the reads (snapshot) or during the day (activity).';
COMMENT ON COLUMN public.cockpit_meta_budget_days.verified IS 'Snapshot rows: true (read from Meta). Activity rows: true only when the activity log''s chain of budget and status changes for the campaign (and its ad sets) ends at the live budget and status.';
COMMENT ON COLUMN public.cockpit_meta_budget_days.first_seen IS 'Snapshot: the first read of the day. Activity: when the history was read.';
CREATE INDEX IF NOT EXISTS cockpit_meta_budget_days_account_day_idx ON public.cockpit_meta_budget_days(account_id, day);
CREATE INDEX IF NOT EXISTS cockpit_meta_budget_days_day_idx ON public.cockpit_meta_budget_days(day);

CREATE TABLE IF NOT EXISTS public.cockpit_meta_budget_account_days (
  account_id text NOT NULL CHECK (account_id ~ '^[0-9]{5,25}$'),
  day date NOT NULL,
  source text NOT NULL CHECK (source IN ('snapshot','activity')),
  reads integer NOT NULL CHECK (reads >= 1),
  first_read timestamptz NOT NULL,
  last_read timestamptz NOT NULL,
  campaigns integer NOT NULL CHECK (campaigns >= 0),
  verified boolean NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 300),
  run_id uuid,
  PRIMARY KEY (account_id, day),
  CONSTRAINT cockpit_meta_budget_account_days_reads CHECK (last_read >= first_read),
  CONSTRAINT cockpit_meta_budget_account_days_snapshot_read CHECK (source = 'activity' OR verified)
);
COMMENT ON TABLE public.cockpit_meta_budget_account_days IS
  'The account days whose budgets were read, on the account''s clock: snapshot (reads = the hourly reads that day, first_read and last_read) or activity (rebuilt from Meta''s activity log; verified when every campaign''s chain ended at the live budget and no campaign gone since changed on or after it). campaigns = the day rows of the account that day. An account day with no row was not read: its budgets are unknown, never 0.';
CREATE INDEX IF NOT EXISTS cockpit_meta_budget_account_days_day_idx ON public.cockpit_meta_budget_account_days(day);

CREATE TABLE IF NOT EXISTS public.cockpit_meta_account_state (
  account_id text PRIMARY KEY CHECK (account_id ~ '^[0-9]{5,25}$'),
  account_status integer,
  disable_reason integer,
  spend_cap numeric CHECK (spend_cap IS NULL OR spend_cap > 0),
  amount_spent numeric CHECK (amount_spent IS NULL OR amount_spent >= 0),
  is_prepay boolean,
  currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  currency_offset integer CHECK (currency_offset IS NULL OR currency_offset IN (1, 100)),
  usd_rate numeric CHECK (usd_rate IS NULL OR usd_rate > 0),
  fetched_at timestamptz NOT NULL,
  run_id uuid
);
COMMENT ON TABLE public.cockpit_meta_account_state IS
  'Each ad account''s Meta state at the last budgets read: account_status (1 active, 3 unsettled, 9 grace period...: cockpit_board_account_words), disable_reason, spend_cap (the account spending limit) and amount_spent in the account currency''s major units. spend_cap NULL means no limit (Meta''s "0"). On a prepaid account (is_prepay, Meta''s is_prepay_account) spend_cap is the funds added, so spend_cap - amount_spent is the prepaid balance left, not a limit (mergestudio.kw, 17 Oct: 351.77 - 340.96 = "Available balance ($10.81 USD)"). amount_spent NULL with a cap set is unknown, never 0. amount_spent moves within minutes; compare it with spend_cap only from the same row. fetched_at is when the business listing that carried it answered.';

CREATE TABLE IF NOT EXISTS public.cockpit_meta_spend_reads (
  account_id text NOT NULL CHECK (account_id ~ '^[0-9]{5,25}$'),
  source text NOT NULL CHECK (source IN ('days','discovery')),
  since date NOT NULL,
  until date NOT NULL,
  read_at timestamptz NOT NULL,
  run_id uuid,
  PRIMARY KEY (account_id, source, since, until),
  CONSTRAINT cockpit_meta_spend_reads_span CHECK (until >= since AND until - since <= 400)
);
COMMENT ON TABLE public.cockpit_meta_spend_reads IS
  'The account days whose spend Meta answered, on the account''s clock: a day read that finished (days: since..until of a done days task, written when its run closes) or the business listing that found no spend on the account over its window (discovery: written by begin). A day counts as read only when it had ended on the account''s clock by read_at (the latest read of that span). The board counts a budget day with no ad-day rows as $0 spent only on such a day (or one with ad-day rows); otherwise the day was not read and is left out, never $0. Kept 400 days.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_meta_budgets','cockpit_meta_budget_days','cockpit_meta_budget_account_days','cockpit_meta_account_state',
                           'cockpit_meta_spend_reads'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- The day reads already finished (tasks are kept 14 days), so their days stay
-- known once the tasks are gone.
INSERT INTO public.cockpit_meta_spend_reads AS x (account_id, source, since, until, read_at, run_id)
SELECT t.account_id, 'days', t.since, t.until, max(t.updated_at), NULL
FROM public.cockpit_meta_ad_day_tasks t
WHERE t.kind = 'days' AND t.state = 'done' AND t.since IS NOT NULL AND t.until IS NOT NULL AND t.account_id ~ '^[0-9]{5,25}$'
GROUP BY t.account_id, t.since, t.until
ON CONFLICT (account_id, source, since, until) DO UPDATE SET read_at = greatest(x.read_at, EXCLUDED.read_at);

-- ---------------------------------------------------------------------------
-- 2. Two more task kinds, and the account state a budgets task carries

ALTER TABLE public.cockpit_meta_ad_day_tasks ADD COLUMN IF NOT EXISTS account_state jsonb
  CHECK (account_state IS NULL OR jsonb_typeof(account_state) = 'object');
COMMENT ON COLUMN public.cockpit_meta_ad_day_tasks.account_state IS
  'A budgets or activities task''s account as the business listing gave it: {status, disableReason, spendCap, amountSpent (minor units, as Meta writes them), prepay, readAt}.';
ALTER TABLE public.cockpit_meta_ad_day_tasks DROP CONSTRAINT IF EXISTS cockpit_meta_ad_day_tasks_kind_check;
ALTER TABLE public.cockpit_meta_ad_day_tasks ADD CONSTRAINT cockpit_meta_ad_day_tasks_kind_check
  CHECK (kind IN ('days','reach_account','reach_all','lead_ids','budgets','activities'));
-- An activities task has its days too: the unnamed CHECK of 20261016121700
-- ((kind = 'days') = (since and until set)) gives way to a named one.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT x.conname FROM pg_catalog.pg_constraint x
           WHERE x.conrelid = 'public.cockpit_meta_ad_day_tasks'::regclass AND x.contype = 'c'
             AND pg_catalog.pg_get_constraintdef(x.oid) LIKE '%(kind = ''days''::text) = ((since IS NOT NULL) AND (until IS NOT NULL))%' LOOP
    EXECUTE format('ALTER TABLE public.cockpit_meta_ad_day_tasks DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE public.cockpit_meta_ad_day_tasks DROP CONSTRAINT IF EXISTS cockpit_meta_ad_day_tasks_span_check;
ALTER TABLE public.cockpit_meta_ad_day_tasks ADD CONSTRAINT cockpit_meta_ad_day_tasks_span_check
  CHECK ((kind IN ('days','activities')) = (since IS NOT NULL AND until IS NOT NULL));
COMMENT ON TABLE public.cockpit_meta_ad_day_tasks IS
  'The work of a meta-ad-days run: one account and up to 7 of its days (days), its reach (reach_account, reach_all), its lead ids (lead_ids, nightly), its budgets now (budgets, hourly, waiting 5 minutes) or its budget history over since..until (activities, nightly and backfill). Claimed with a 5-minute lease in that order; a task whose lease ran out goes back to the queue, 4 tries in all. A read Meta refused for its rate limit or its load waits until retry_at (3, 6, 9 minutes). Kept 14 days after the run.';

-- ---------------------------------------------------------------------------
-- 3. Helpers (internal)

/** The day of p_at on an ad account's clock; Kuwait when the zone is empty or unknown. */
CREATE OR REPLACE FUNCTION public.cockpit_meta_budget_day(p_at timestamptz, p_tz text)
RETURNS date LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
  RETURN (p_at AT TIME ZONE coalesce(nullif(btrim(p_tz), ''), 'Asia/Kuwait'))::date;
EXCEPTION WHEN others THEN
  RETURN (p_at AT TIME ZONE 'Asia/Kuwait')::date;
END;
$$;

/** A time Meta or the function wrote, or NULL when it is not one. */
CREATE OR REPLACE FUNCTION public.cockpit_meta_budget_try_ts(p text)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
  IF p IS NULL OR length(p) > 40 OR p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN RETURN NULL; END IF;
  RETURN p::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

/**
 * The first thing wrong with a run's budgetAccounts or activityAccounts
 * (p_spans: each carries since and until on its own clock), or NULL.
 * [{accountId, name, currency, timezone, status, disableReason, spendCap,
 * amountSpent, prepay, readAt, since?, until?}]; spendCap and amountSpent are
 * Meta's minor units as digits; prepay true, false or null.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_budget_accounts_bad(p_list jsonb, p_spans boolean, p_today date)
RETURNS text LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE v text;
BEGIN
  IF jsonb_typeof(p_list) IS DISTINCT FROM 'array' THEN RETURN 'a budget account list that is not a list'; END IF;
  IF jsonb_array_length(p_list) > 300 THEN RETURN 'more than 300 budget accounts'; END IF;
  SELECT x.why INTO v FROM (
    SELECT CASE
        WHEN jsonb_typeof(a) <> 'object' OR coalesce(a->>'accountId','') !~ '^[0-9]{5,25}$' THEN 'a budget account without a valid id'
        WHEN a->>'currency' IS NOT NULL AND a->>'currency' !~ '^[A-Z]{3}$' THEN 'a budget account currency that is not a code'
        WHEN length(coalesce(a->>'timezone','')) > 64 OR length(coalesce(a->>'name','')) > 200 THEN 'a budget account name or zone that is too long'
        WHEN coalesce(jsonb_typeof(a->'status'),'null') NOT IN ('number','null') OR coalesce(jsonb_typeof(a->'disableReason'),'null') NOT IN ('number','null')
          OR coalesce(a->>'status','0') !~ '^[0-9]{1,4}$' OR coalesce(a->>'disableReason','0') !~ '^[0-9]{1,4}$' THEN 'a budget account status that is not Meta''s number'
        WHEN coalesce(a->>'spendCap','0') !~ '^[0-9]{1,18}$' OR coalesce(a->>'amountSpent','0') !~ '^[0-9]{1,18}$' THEN 'a spending limit that is not an amount'
        WHEN coalesce(jsonb_typeof(a->'prepay'),'null') NOT IN ('boolean','null') THEN 'a prepaid flag that is not true or false'
        WHEN a->>'readAt' IS NOT NULL AND public.cockpit_meta_budget_try_ts(a->>'readAt') IS NULL THEN 'a budget account read without its time'
        WHEN p_spans AND (public.cockpit_meta_ad_days_try_date(a->>'since') IS NULL OR public.cockpit_meta_ad_days_try_date(a->>'until') IS NULL) THEN 'a budget history without its days'
        WHEN p_spans AND public.cockpit_meta_ad_days_try_date(a->>'until') < public.cockpit_meta_ad_days_try_date(a->>'since') THEN 'a budget history that ends before it starts'
        WHEN p_spans AND public.cockpit_meta_ad_days_try_date(a->>'until') - public.cockpit_meta_ad_days_try_date(a->>'since') > 92 THEN 'a budget history longer than 93 days'
        WHEN p_spans AND (public.cockpit_meta_ad_days_try_date(a->>'since') < p_today - 400 OR public.cockpit_meta_ad_days_try_date(a->>'until') > p_today + 1) THEN 'a budget history outside the last 400 days'
      END AS why
    FROM jsonb_array_elements(p_list) a
  ) x WHERE x.why IS NOT NULL LIMIT 1;
  IF v IS NOT NULL THEN RETURN v; END IF;
  IF (SELECT count(*) <> count(DISTINCT a->>'accountId') FROM jsonb_array_elements(p_list) a) THEN RETURN 'a budget account twice'; END IF;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The queue: inputs, begin, claim, fail, finish (replaced), status (replaced)

/**
 * What a run or a dry run needs from the database: today, the windows, the
 * ties, which of p.accounts tie to no client, and (since 2026-10-17)
 * activeAccounts: the ad accounts tied to a client whose status is Active,
 * hidden ones left out, so the run reads their budgets even when they spent
 * nothing (a budget set and not spending is half of the CEO's question).
 * Reads only.
 */
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
    'activeAccounts', coalesce((SELECT jsonb_agg(e.key ORDER BY e.key) FROM jsonb_each(coalesce(v_ties->'accounts', '{}'::jsonb)) e
                                WHERE e.value->>'status' = 'Active' AND NOT public.cockpit_meta_ad_days_is_hidden(v_hidden, e.key, NULL)), '[]'::jsonb),
    'queue', jsonb_build_object(
      'pending', (SELECT count(*) FROM public.cockpit_meta_ad_day_tasks WHERE state = 'pending'),
      'running', (SELECT count(*) FROM public.cockpit_meta_ad_day_tasks WHERE state = 'running')));
END;
$$;

/**
 * Start a run: p = {job, requestedBy, graphVersion, window {since, until},
 * accounts [{accountId, name, currency, timezone, status, spend, edge}],
 * internal [ids], unreadable [ids], tasks [{kind: 'days', accountId, since,
 * until}], reach: 'account' | 'all' | null, leadIds: boolean (nightly only),
 * budgetAccounts [...] (hourly), activityAccounts [... with since, until]
 * (nightly, backfill), budgetUnlisted [ids], zeroSpend {listedAt, accounts
 * [ids]}: the listed accounts that spent nothing over the window, kept in
 * cockpit_meta_spend_reads as known $0 days}. Each account is tied to a client
 * (or listed as not linked) here. One reach task per account is added with
 * today's windows; one budgets task per budgetAccounts entry, waiting 5
 * minutes on an hourly run (the :07 burst of other readers rate-limits
 * Arcturus' ad set reads in every hourly run); one activities task per
 * activityAccounts entry. An older function sends none of the last three, so
 * the two can be deployed in either order. A run of the same job still
 * working answers busy.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_begin(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_job text := p->>'job'; v_by text; v_busy public.cockpit_meta_ad_day_runs; v_run uuid; v_today date; v_ties jsonb;
  v_accounts jsonb; v_bad text; v_tasks int; v_reach text := nullif(p->>'reach',''); v_state text; v_hidden jsonb;
  v_budget jsonb; v_history jsonb; v_unlisted jsonb; v_budget_n int; v_history_n int;
  v_zero jsonb; v_listed_at timestamptz; v_win_from date; v_win_to date;
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

  -- Budgets and their history (2026-10-17): unknown to an older function.
  v_budget := CASE WHEN jsonb_typeof(p->'budgetAccounts') = 'array' THEN p->'budgetAccounts' ELSE '[]'::jsonb END;
  v_history := CASE WHEN jsonb_typeof(p->'activityAccounts') = 'array' THEN p->'activityAccounts' ELSE '[]'::jsonb END;
  v_bad := coalesce(public.cockpit_meta_budget_accounts_bad(v_budget, false, v_today), public.cockpit_meta_budget_accounts_bad(v_history, true, v_today));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'The run named %', v_bad USING ERRCODE='22023'; END IF;
  v_unlisted := CASE WHEN jsonb_typeof(p->'budgetUnlisted') = 'array' THEN p->'budgetUnlisted' ELSE '[]'::jsonb END;
  IF jsonb_array_length(v_unlisted) > 300 OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_unlisted) u
                                                     WHERE jsonb_typeof(u) <> 'string' OR u #>> '{}' !~ '^[0-9]{5,25}$') THEN
    RAISE EXCEPTION 'The run named a budget account that is not an id' USING ERRCODE='22023';
  END IF;
  -- The accounts the listing found with no spend over the window (2026-10-17): unknown to an older function.
  v_zero := CASE WHEN jsonb_typeof(p->'zeroSpend'->'accounts') = 'array' THEN p->'zeroSpend'->'accounts' ELSE '[]'::jsonb END;
  IF jsonb_array_length(v_zero) > 300 OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_zero) u
                                                 WHERE jsonb_typeof(u) <> 'string' OR u #>> '{}' !~ '^[0-9]{5,25}$') THEN
    RAISE EXCEPTION 'The run named an account with no spend that is not an id' USING ERRCODE='22023';
  END IF;
  v_win_from := public.cockpit_meta_ad_days_try_date(p->'window'->>'since');
  v_win_to := public.cockpit_meta_ad_days_try_date(p->'window'->>'until');
  IF jsonb_array_length(v_zero) > 0 THEN
    v_listed_at := public.cockpit_meta_budget_try_ts(p->'zeroSpend'->>'listedAt');
    IF v_listed_at IS NULL OR v_listed_at > public.cockpit_meta_ad_days_now() + interval '5 minutes'
       OR v_listed_at < public.cockpit_meta_ad_days_now() - interval '1 hour' THEN
      RAISE EXCEPTION 'zeroSpend.listedAt must be when the listing was asked, within the last hour' USING ERRCODE='22023';
    END IF;
    IF v_win_from IS NULL OR v_win_to IS NULL OR v_win_to < v_win_from OR v_win_to - v_win_from > 400 OR v_win_from < v_today - 400 THEN
      RAISE EXCEPTION 'An account with no spend needs the run''s window' USING ERRCODE='22023';
    END IF;
  END IF;

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
      'hidden', coalesce((SELECT jsonb_agg(a->>'accountId') FROM jsonb_array_elements(v_accounts) a WHERE (a->>'hidden')::boolean IS TRUE), '[]'::jsonb),
      'budgetAccounts', jsonb_array_length(v_budget), 'historyAccounts', jsonb_array_length(v_history),
      -- Tied to an Active client, but Mahara's business does not list the account: no budget can be read.
      'budgetUnlisted', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', u #>> '{}',
                                   'clientName', v_ties->'accounts'->(u #>> '{}')->>'clientName') ORDER BY u #>> '{}')
                                  FROM jsonb_array_elements(v_unlisted) u), '[]'::jsonb)),
    public.cockpit_meta_ad_days_now())
  RETURNING id INTO v_run;

  -- No spend over the window: a known $0 on each of its days that had ended when the listing was asked.
  INSERT INTO public.cockpit_meta_spend_reads AS x (account_id, source, since, until, read_at, run_id)
  SELECT DISTINCT u #>> '{}', 'discovery', v_win_from, v_win_to, v_listed_at, v_run
  FROM jsonb_array_elements(v_zero) u
  ON CONFLICT (account_id, source, since, until) DO UPDATE SET read_at = greatest(x.read_at, EXCLUDED.read_at),
    run_id = CASE WHEN EXCLUDED.read_at >= x.read_at THEN EXCLUDED.run_id ELSE x.run_id END;

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
  -- Budgets now: one task per account, after the :07 burst on an hourly run.
  INSERT INTO public.cockpit_meta_ad_day_tasks(run_id, kind, account_id, account_name, account_currency, account_timezone, windows,
    account_state, retry_at)
  SELECT v_run, 'budgets', a->>'accountId', left(a->>'name', 200), a->>'currency', a->>'timezone', '[]'::jsonb,
    jsonb_build_object('status', a->'status', 'disableReason', a->'disableReason', 'spendCap', a->'spendCap',
      'amountSpent', a->'amountSpent', 'prepay', a->'prepay', 'readAt', a->'readAt'),
    CASE WHEN v_job = 'hourly' THEN public.cockpit_meta_ad_days_now() + interval '5 minutes' END
  FROM jsonb_array_elements(v_budget) a
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_budget_n = ROW_COUNT;
  -- Budget history: one task per account over its days.
  INSERT INTO public.cockpit_meta_ad_day_tasks(run_id, kind, account_id, account_name, account_currency, account_timezone, since, until,
    windows, account_state)
  SELECT v_run, 'activities', a->>'accountId', left(a->>'name', 200), a->>'currency', a->>'timezone', (a->>'since')::date, (a->>'until')::date,
    '[]'::jsonb, jsonb_build_object('status', a->'status', 'disableReason', a->'disableReason', 'spendCap', a->'spendCap',
      'amountSpent', a->'amountSpent', 'prepay', a->'prepay', 'readAt', a->'readAt')
  FROM jsonb_array_elements(v_history) a
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_history_n = ROW_COUNT;
  SELECT count(*) INTO v_tasks FROM public.cockpit_meta_ad_day_tasks WHERE run_id = v_run;
  UPDATE public.cockpit_meta_ad_day_runs SET tasks_total = v_tasks WHERE id = v_run;
  IF v_tasks = 0 THEN v_state := public.cockpit_meta_ad_days_finish(v_run); END IF;
  RETURN jsonb_build_object('started', true, 'runId', v_run, 'tasks', v_tasks, 'budgetTasks', v_budget_n, 'historyTasks', v_history_n,
    'zeroSpend', jsonb_array_length(v_zero),
    'tieSource', v_ties->>'source',
    'notLinked', coalesce((SELECT jsonb_agg(jsonb_build_object('accountId', a->>'accountId', 'name', a->>'name'))
                           FROM jsonb_array_elements(v_accounts) a
                           WHERE (a->>'linked')::boolean IS NOT TRUE AND (a->>'hidden')::boolean IS NOT TRUE), '[]'::jsonb),
    'state', coalesce(v_state, 'running'));
END;
$$;

/**
 * Lease up to p.limit (1 to 5) open tasks for p.leaseSeconds (60 to 900):
 * pending ones, or running ones whose lease ran out (4 tries in all). Hourly
 * work first, then nightly, then backfill; within a run days first, then
 * reach and lead ids, then budgets, then budget history. A claim starts the
 * task's counts again, so a retried read is counted once. A lead-ids task
 * carries its ads (adIds); a budgets or activities task its account state.
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
    ORDER BY CASE r.job WHEN 'hourly' THEN 0 WHEN 'nightly' THEN 1 ELSE 2 END,
             CASE t.kind WHEN 'days' THEN 0 WHEN 'budgets' THEN 2 WHEN 'activities' THEN 3 ELSE 1 END, t.id
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
      'adIds', c.ad_ids, 'accountState', c.account_state, 'leaseToken', c.lease_token, 'attempt', c.attempts) ORDER BY c.id), '[]'::jsonb)
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
 * run closes when it was the last. Every kind, budgets and activities too.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_fail(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.cockpit_meta_ad_day_tasks; v_retry boolean := coalesce((p->>'retry')::boolean, false); v_state text; v_run text;
BEGIN
  PERFORM public.cockpit_meta_ad_days_require_service();
  t := public.cockpit_meta_ad_days_leased(p, ARRAY['days','reach_account','reach_all','lead_ids','budgets','activities']);
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
 * Close a run once every task is done or failed: its state (ok, partial or
 * failed, over the ad-day, reach and lead-id tasks: the ad numbers), its
 * note, the sync-state row meta-ad-days-<job>, one audit row, the client
 * reach rows, the finished day reads (cockpit_meta_spend_reads), and the
 * retention of receipts, tasks, runs and budget days. The run row is locked
 * first, so two tasks finishing at once close it once. "Read X of Y ad
 * accounts" counts the ad-day reads only (before 2026-10-17 a failed lead-ids
 * task counted its account as not read: "Read 8 of 29" with every day read).
 * Budgets and their history have lines of their own and their own counts
 * (detail budgetsRead/budgetsFailed and historyRead/historyFailed,
 * status().budgets): a budgets read that fails hour after hour (Arcturus'
 * rate limit) never makes the ad numbers look partial.
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_finish(p_run uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
$$;

/**
 * How fresh the store is, for the board's read (its SECURITY DEFINER
 * functions call this as the owner) and for the doctor (service role): the
 * last run of each job, the sync-state rows, the queue, each account's last
 * day and last read with its failure if the latest read failed, and the reach
 * rows per level. Each account also carries Meta's status (account_status
 * from the latest run that listed it in the last 3 days, with a word), its
 * client's status, whether it is hidden on purpose, its spend over the last 2
 * days and its last day with spend; and four lists:
 *   notLinked            spending, tied to no client, not hidden on purpose
 *   hidden               hidden on purpose (a hidden clients row, Mahara's own)
 *   cancelledDelivering  spent in the last 2 days for a cancelled or stopped client
 *   billingStopped       tied to a client that is not cancelled or stopped,
 *                        and Meta says the account is not active (unsettled
 *                        billing, disabled, closed): the board says why
 *                        delivery stopped, with the last day it spent.
 * Since 2026-10-17 also budgets, with their own state (a budgets read never
 * makes the run partial): the accounts and campaigns read, how many are
 * switched on and how many deliver, the newest and oldest read, the latest
 * hourly run that read budgets (lastRun {runId, at, read, failed, state}) and
 * the latest that rebuilt their history (historyLastRun), the accounts whose
 * latest budgets read failed (failing) or whose latest history read failed
 * (historyFailing), the accounts tied to an Active client that Mahara's
 * business does not list, so no budget can be read (unlisted, from the last
 * hourly run), and the days held: historyFrom (the first account day with
 * budgets), snapshotFrom (the first hourly read), activityDays and
 * unverifiedDays.
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
$$;

-- ---------------------------------------------------------------------------
-- 5. Writing budgets (service RPCs)

/**
 * One account's budgets for a leased budgets task: p = {taskId, leaseToken,
 * fetchedAt, currency, currencyOffset, account {status, disableReason,
 * spendCap, amountSpent, prepay, readAt}, rows [{level, object_id,
 * account_id, campaign_id, name, objective, status, effective_status,
 * budget_level, budget_type, daily_budget, lifetime_budget, budget_remaining,
 * start_time, end_time, ads_active, ads_with_issues, issues, switched_on,
 * starts_at, delivering, why_not}], note}. Amounts in the currency's major
 * units. At most 3,000 rows, every one of the task's account; an ad set's
 * campaign must be in the rows. Then:
 *   - the account's rows in cockpit_meta_budgets are replaced (an object no
 *     longer listed is gone);
 *   - cockpit_meta_account_state is upserted (spend_cap NULL when no limit);
 *   - each campaign switched on (or already holding today's row) gets today's
 *     row in cockpit_meta_budget_days, today on the account's clock: the last
 *     read wins, max_switched_on_budget keeps the highest daily budget it was
 *     switched on with, switched_on_any, delivering_any and changed_during_day
 *     accumulate, and a snapshot replaces an activity row;
 *   - today's cockpit_meta_budget_account_days row counts the read.
 * One call closes the task (and the run when it was the last).
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_budgets_apply(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.cockpit_meta_ad_day_tasks; v_rows jsonb := p->'rows'; v_acc jsonb := p->'account'; v_fetched timestamptz; v_read timestamptz;
  v_currency text := p->>'currency'; v_offset int; v_rate numeric; v_day date; v_bad text; v_n int; v_days int; v_state text;
  v_now timestamptz := public.cockpit_meta_ad_days_now();
BEGIN
  PERFORM public.cockpit_meta_ad_days_require_service();
  t := public.cockpit_meta_ad_days_leased(p, ARRAY['budgets']);
  IF jsonb_typeof(v_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(v_rows) > 3000 THEN
    RAISE EXCEPTION 'Send rows as a list of at most 3000' USING ERRCODE='22023';
  END IF;
  v_fetched := public.cockpit_meta_budget_try_ts(p->>'fetchedAt');
  IF v_fetched IS NULL OR v_fetched > v_now + interval '5 minutes' OR v_fetched < v_now - interval '1 hour' THEN
    RAISE EXCEPTION 'fetchedAt must be when Meta answered, within the last hour' USING ERRCODE='22023';
  END IF;
  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$' OR (t.account_currency IS NOT NULL AND v_currency <> t.account_currency) THEN
    RAISE EXCEPTION 'The budgets of act_% are not in its currency', t.account_id USING ERRCODE='22023';
  END IF;
  IF coalesce(p->>'currencyOffset', '') NOT IN ('1', '100') THEN
    RAISE EXCEPTION 'currencyOffset is Meta''s offset for the currency: 1 or 100' USING ERRCODE='22023';
  END IF;
  v_offset := (p->>'currencyOffset')::int;
  -- CASE, not OR, so no cast runs before its type is known.
  IF (CASE WHEN jsonb_typeof(v_acc) IS DISTINCT FROM 'object' THEN true
          WHEN coalesce(jsonb_typeof(v_acc->'status'), 'null') NOT IN ('number','null') OR coalesce(v_acc->>'status', '0') !~ '^[0-9]{1,4}$' THEN true
          WHEN coalesce(jsonb_typeof(v_acc->'disableReason'), 'null') NOT IN ('number','null') OR coalesce(v_acc->>'disableReason', '0') !~ '^[0-9]{1,4}$' THEN true
          WHEN coalesce(jsonb_typeof(v_acc->'spendCap'), 'null') NOT IN ('number','null') OR coalesce(jsonb_typeof(v_acc->'amountSpent'), 'null') NOT IN ('number','null') THEN true
          WHEN jsonb_typeof(v_acc->'spendCap') = 'number' AND (v_acc->>'spendCap')::numeric <= 0 THEN true
          WHEN jsonb_typeof(v_acc->'amountSpent') = 'number' AND (v_acc->>'amountSpent')::numeric < 0 THEN true
          WHEN coalesce(jsonb_typeof(v_acc->'prepay'), 'null') NOT IN ('boolean','null') THEN true
          ELSE false END) THEN
    RAISE EXCEPTION 'Send the account as {status, disableReason, spendCap (NULL when no limit), amountSpent, prepay, readAt}' USING ERRCODE='22023';
  END IF;
  v_read := public.cockpit_meta_budget_try_ts(v_acc->>'readAt');
  IF v_read IS NULL OR v_read > v_now + interval '5 minutes' OR v_read < v_now - interval '2 hours' THEN
    RAISE EXCEPTION 'account.readAt must be when Meta listed the account, within the last 2 hours' USING ERRCODE='22023';
  END IF;

  SELECT x.why INTO v_bad FROM (
    SELECT CASE
        WHEN jsonb_typeof(e) <> 'object' THEN 'a row that is not an object'
        WHEN coalesce(e->>'level', '') NOT IN ('campaign','adset') THEN 'a row that is not a campaign or an ad set'
        WHEN coalesce(e->>'object_id', '') !~ '^[0-9]{5,25}$' OR coalesce(e->>'campaign_id', '') !~ '^[0-9]{5,25}$' THEN 'an id that is not one'
        WHEN e->>'account_id' IS DISTINCT FROM t.account_id THEN 'a row from another ad account'
        WHEN e->>'level' = 'campaign' AND e->>'campaign_id' <> e->>'object_id' THEN 'a campaign row that names another campaign'
        WHEN e->>'level' = 'adset' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) c
                                                  WHERE c->>'level' = 'campaign' AND c->>'object_id' = e->>'campaign_id') THEN 'an ad set whose campaign was not read'
        WHEN EXISTS (SELECT 1 FROM jsonb_each(e) k WHERE k.key IN ('daily_budget','lifetime_budget','budget_remaining','ads_active','ads_with_issues')
                                                 AND jsonb_typeof(k.value) NOT IN ('number','null')) THEN 'an amount that is not a number'
        WHEN least((e->>'daily_budget')::numeric, (e->>'lifetime_budget')::numeric, (e->>'budget_remaining')::numeric) < 0 THEN 'a negative amount'
        WHEN coalesce(e->>'ads_active', '') !~ '^[0-9]{1,6}$' OR coalesce(e->>'ads_with_issues', '') !~ '^[0-9]{1,6}$' THEN 'an ad count that is not one'
        WHEN coalesce(e->>'budget_level', '') NOT IN ('campaign','adset') THEN 'a row without its budget level'
        WHEN e->>'budget_type' IS NOT NULL AND e->>'budget_type' NOT IN ('daily','lifetime') THEN 'a budget that is neither daily nor lifetime'
        WHEN (e->>'budget_type' = 'daily' AND e->>'daily_budget' IS NULL)
          OR (e->>'budget_type' = 'lifetime' AND (e->>'daily_budget' IS NOT NULL OR e->>'lifetime_budget' IS NULL))
          OR (e->>'budget_type' IS NULL AND (e->>'daily_budget' IS NOT NULL OR e->>'lifetime_budget' IS NOT NULL)) THEN 'a budget that does not match its type'
        WHEN (e->>'status' IS NOT NULL AND e->>'status' !~ '^[A-Z_]{1,40}$')
          OR (e->>'effective_status' IS NOT NULL AND e->>'effective_status' !~ '^[A-Z_]{1,40}$') THEN 'a status that is not one of Meta''s names'
        WHEN jsonb_typeof(e->'switched_on') IS DISTINCT FROM 'boolean' OR jsonb_typeof(e->'delivering') IS DISTINCT FROM 'boolean' THEN 'a row without whether it delivers'
        WHEN (e->>'delivering')::boolean AND NOT (e->>'switched_on')::boolean THEN 'a row delivering while switched off'
        WHEN NOT (e->>'delivering')::boolean AND nullif(btrim(coalesce(e->>'why_not', '')), '') IS NULL THEN 'a row not delivering without the reason'
        WHEN length(coalesce(e->>'why_not', '')) > 300 OR length(coalesce(e->>'name', '')) > 400 OR length(coalesce(e->>'objective', '')) > 60 THEN 'a name or reason that is too long'
        WHEN (e->>'start_time' IS NOT NULL AND public.cockpit_meta_budget_try_ts(e->>'start_time') IS NULL)
          OR (e->>'end_time' IS NOT NULL AND public.cockpit_meta_budget_try_ts(e->>'end_time') IS NULL)
          OR (e->>'starts_at' IS NOT NULL AND public.cockpit_meta_budget_try_ts(e->>'starts_at') IS NULL) THEN 'a time that is not one'
        WHEN e->>'starts_at' IS NOT NULL AND (e->>'switched_on')::boolean THEN 'a row switched on while waiting for its start'
        WHEN e->'issues' IS NOT NULL AND jsonb_typeof(e->'issues') <> 'null'
          AND (jsonb_typeof(e->'issues') <> 'array' OR jsonb_array_length(e->'issues') > 5 OR length((e->'issues')::text) > 2000) THEN 'issues that are not a short list'
      END AS why
    FROM jsonb_array_elements(v_rows) e
  ) x WHERE x.why IS NOT NULL LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Meta''s budgets for act_% held %; nothing was written', t.account_id, v_bad USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) <> count(DISTINCT (e->>'level') || '|' || (e->>'object_id')) FROM jsonb_array_elements(v_rows) e) THEN
    RAISE EXCEPTION 'Meta''s budgets for act_% held one object twice; nothing was written', t.account_id USING ERRCODE='22023';
  END IF;

  v_rate := public.cockpit_meta_ad_days_usd_per(v_currency);
  v_day := public.cockpit_meta_budget_day(v_fetched, t.account_timezone);

  DELETE FROM public.cockpit_meta_budgets WHERE account_id = t.account_id;
  INSERT INTO public.cockpit_meta_budgets AS x (level, object_id, account_id, campaign_id, name, objective, status, effective_status,
    budget_level, budget_type, daily_budget, lifetime_budget, budget_remaining, currency, currency_offset, usd_rate, daily_budget_usd,
    start_time, end_time, ads_active, ads_with_issues, issues, switched_on, starts_at, delivering, why_not, fetched_at, run_id)
  SELECT r.level, r.object_id, t.account_id, r.campaign_id, left(r.name, 400), left(r.objective, 60), r.status, r.effective_status,
    r.budget_level, r.budget_type, r.daily_budget, r.lifetime_budget, r.budget_remaining, v_currency, v_offset,
    CASE WHEN r.daily_budget IS NOT NULL AND v_rate IS NOT NULL THEN v_rate END,
    CASE WHEN r.daily_budget IS NOT NULL AND v_rate IS NOT NULL THEN round(r.daily_budget * v_rate, 6) END,
    public.cockpit_meta_budget_try_ts(r.start_time), public.cockpit_meta_budget_try_ts(r.end_time), r.ads_active, r.ads_with_issues,
    CASE WHEN jsonb_typeof(r.issues) = 'array' AND jsonb_array_length(r.issues) > 0 THEN r.issues END,
    r.switched_on, public.cockpit_meta_budget_try_ts(r.starts_at), r.delivering,
    CASE WHEN r.delivering THEN NULL ELSE left(btrim(r.why_not), 300) END, v_fetched, t.run_id
  FROM jsonb_to_recordset(v_rows) AS r(level text, object_id text, campaign_id text, name text, objective text, status text, effective_status text,
    budget_level text, budget_type text, daily_budget numeric, lifetime_budget numeric, budget_remaining numeric, start_time text, end_time text,
    ads_active int, ads_with_issues int, issues jsonb, switched_on boolean, starts_at text, delivering boolean, why_not text)
  ON CONFLICT (level, object_id) DO UPDATE SET account_id = EXCLUDED.account_id, campaign_id = EXCLUDED.campaign_id, name = EXCLUDED.name,
    objective = EXCLUDED.objective, status = EXCLUDED.status, effective_status = EXCLUDED.effective_status, budget_level = EXCLUDED.budget_level,
    budget_type = EXCLUDED.budget_type, daily_budget = EXCLUDED.daily_budget, lifetime_budget = EXCLUDED.lifetime_budget,
    budget_remaining = EXCLUDED.budget_remaining, currency = EXCLUDED.currency, currency_offset = EXCLUDED.currency_offset,
    usd_rate = EXCLUDED.usd_rate, daily_budget_usd = EXCLUDED.daily_budget_usd, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
    ads_active = EXCLUDED.ads_active, ads_with_issues = EXCLUDED.ads_with_issues, issues = EXCLUDED.issues, switched_on = EXCLUDED.switched_on,
    starts_at = EXCLUDED.starts_at, delivering = EXCLUDED.delivering, why_not = EXCLUDED.why_not, fetched_at = EXCLUDED.fetched_at,
    run_id = EXCLUDED.run_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO public.cockpit_meta_account_state AS x (account_id, account_status, disable_reason, spend_cap, amount_spent, is_prepay, currency,
    currency_offset, usd_rate, fetched_at, run_id)
  VALUES (t.account_id, (v_acc->>'status')::int, (v_acc->>'disableReason')::int, (v_acc->>'spendCap')::numeric, (v_acc->>'amountSpent')::numeric,
    (v_acc->>'prepay')::boolean, v_currency, v_offset, v_rate, v_read, t.run_id)
  ON CONFLICT (account_id) DO UPDATE SET account_status = EXCLUDED.account_status, disable_reason = EXCLUDED.disable_reason,
    spend_cap = EXCLUDED.spend_cap, amount_spent = EXCLUDED.amount_spent, is_prepay = EXCLUDED.is_prepay, currency = EXCLUDED.currency,
    currency_offset = EXCLUDED.currency_offset,
    usd_rate = EXCLUDED.usd_rate, fetched_at = EXCLUDED.fetched_at, run_id = EXCLUDED.run_id
  WHERE x.fetched_at <= EXCLUDED.fetched_at;

  -- Today's row per campaign switched on, or already holding a row today (a
  -- campaign paused since the morning keeps its row and the budget it was on
  -- with, now switched off).
  INSERT INTO public.cockpit_meta_budget_days AS x (campaign_id, day, account_id, budget_level, budget_type, daily_budget, daily_budget_usd,
    max_switched_on_budget, max_switched_on_budget_usd, currency, usd_rate, switched_on, switched_on_any, delivering, delivering_any, why_not,
    changed_during_day, source, verified, first_seen, last_seen, run_id)
  SELECT b.object_id, v_day, t.account_id, b.budget_level, b.budget_type,
    CASE WHEN b.budget_type = 'daily' THEN b.daily_budget END, CASE WHEN b.budget_type = 'daily' THEN b.daily_budget_usd END,
    CASE WHEN b.switched_on AND b.budget_type = 'daily' AND b.daily_budget > 0 THEN b.daily_budget END,
    CASE WHEN b.switched_on AND b.budget_type = 'daily' AND b.daily_budget_usd > 0 THEN b.daily_budget_usd END,
    v_currency, v_rate, b.switched_on, b.switched_on, b.delivering, b.delivering, b.why_not, false, 'snapshot', true, v_fetched, v_fetched, t.run_id
  FROM public.cockpit_meta_budgets b
  WHERE b.account_id = t.account_id AND b.level = 'campaign'
    AND (b.switched_on OR EXISTS (SELECT 1 FROM public.cockpit_meta_budget_days d WHERE d.campaign_id = b.object_id AND d.day = v_day))
  ON CONFLICT (campaign_id, day) DO UPDATE SET account_id = EXCLUDED.account_id, budget_level = EXCLUDED.budget_level,
    budget_type = EXCLUDED.budget_type, daily_budget = EXCLUDED.daily_budget, daily_budget_usd = EXCLUDED.daily_budget_usd,
    max_switched_on_budget = CASE WHEN x.source = 'activity' THEN EXCLUDED.max_switched_on_budget
                                  ELSE greatest(x.max_switched_on_budget, EXCLUDED.max_switched_on_budget) END,
    max_switched_on_budget_usd = CASE WHEN x.source = 'activity' THEN EXCLUDED.max_switched_on_budget_usd
                                      ELSE greatest(x.max_switched_on_budget_usd, EXCLUDED.max_switched_on_budget_usd) END,
    currency = EXCLUDED.currency, usd_rate = EXCLUDED.usd_rate, switched_on = EXCLUDED.switched_on,
    switched_on_any = CASE WHEN x.source = 'activity' THEN EXCLUDED.switched_on_any ELSE x.switched_on_any OR EXCLUDED.switched_on_any END,
    delivering = EXCLUDED.delivering,
    delivering_any = CASE WHEN x.source = 'activity' THEN EXCLUDED.delivering_any ELSE x.delivering_any OR EXCLUDED.delivering_any END,
    why_not = EXCLUDED.why_not,
    -- A change is a switched-on budget unlike one it was switched on with before that day (the highest so far
    -- holds it): pausing a campaign, or every ad set of an ABO one, changes no budget.
    changed_during_day = CASE WHEN x.source = 'activity' THEN false
                              ELSE x.changed_during_day OR (EXCLUDED.switched_on AND x.switched_on_any
                                AND x.max_switched_on_budget IS DISTINCT FROM EXCLUDED.max_switched_on_budget) END,
    source = 'snapshot', verified = true,
    first_seen = CASE WHEN x.source = 'activity' THEN EXCLUDED.first_seen ELSE least(x.first_seen, EXCLUDED.first_seen) END,
    last_seen = EXCLUDED.last_seen, run_id = EXCLUDED.run_id
  WHERE x.source = 'activity' OR x.last_seen <= EXCLUDED.last_seen;
  SELECT count(*)::int INTO v_days FROM public.cockpit_meta_budget_days d WHERE d.account_id = t.account_id AND d.day = v_day;

  INSERT INTO public.cockpit_meta_budget_account_days AS x (account_id, day, source, reads, first_read, last_read, campaigns, verified, note, run_id)
  VALUES (t.account_id, v_day, 'snapshot', 1, v_fetched, v_fetched, v_days, true, NULL, t.run_id)
  ON CONFLICT (account_id, day) DO UPDATE SET
    reads = CASE WHEN x.source = 'snapshot' THEN x.reads + 1 ELSE 1 END,
    first_read = CASE WHEN x.source = 'snapshot' THEN least(x.first_read, EXCLUDED.first_read) ELSE EXCLUDED.first_read END,
    last_read = CASE WHEN x.source = 'snapshot' THEN greatest(x.last_read, EXCLUDED.last_read) ELSE EXCLUDED.last_read END,
    source = 'snapshot', campaigns = EXCLUDED.campaigns, verified = true, note = NULL, run_id = EXCLUDED.run_id;

  UPDATE public.cockpit_meta_ad_day_tasks SET rows_read = v_n, note = left(nullif(btrim(p->>'note'), ''), 300), state = 'done', error = NULL,
    lease_token = NULL, lease_until = NULL, updated_at = pg_catalog.now()
  WHERE id = t.id;
  v_state := public.cockpit_meta_ad_days_finish(t.run_id);
  RETURN jsonb_build_object('ok', true, 'written', v_n, 'day', to_char(v_day, 'YYYY-MM-DD'), 'dayRows', v_days, 'run', v_state);
END;
$$;

/**
 * One account's budget history for a leased activities task, rebuilt by the
 * function from Meta's activity log backwards from the live budgets: p =
 * {taskId, leaseToken, fetchedAt, currency, currencyOffset, days [{day,
 * campaigns, verified, note}], rows [{campaign_id, account_id, day,
 * budget_level, budget_type, daily_budget, max_budget, switched_on,
 * switched_on_any, why_not, changed_during_day, verified}], note}. Every row
 * of the task's account (a campaign the store already holds under another
 * account is refused), every day inside the task's since..until and listed
 * in days; at most 10,000 rows. max_budget is the highest daily budget the
 * campaign was switched on with that day. The log does not follow the ads,
 * so the rows say nothing about delivery (delivering NULL). The task's
 * earlier activity rows are replaced, and a snapshot row is never touched:
 * on an account day an hourly read covers (cockpit_meta_budget_account_days
 * source snapshot) the history adds only the campaigns no read saw switched
 * on, such as one paused before the day's first read, and the account day
 * stays the reads'. One call closes the task (and the run when it was the
 * last).
 */
CREATE OR REPLACE FUNCTION public.cockpit_meta_budget_history_apply(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.cockpit_meta_ad_day_tasks; v_rows jsonb := p->'rows'; v_days jsonb := p->'days'; v_fetched timestamptz;
  v_currency text := p->>'currency'; v_rate numeric; v_bad text; v_n int; v_written_days int; v_covered int; v_state text;
  v_now timestamptz := public.cockpit_meta_ad_days_now();
BEGIN
  PERFORM public.cockpit_meta_ad_days_require_service();
  t := public.cockpit_meta_ad_days_leased(p, ARRAY['activities']);
  IF jsonb_typeof(v_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(v_rows) > 10000 THEN
    RAISE EXCEPTION 'Send rows as a list of at most 10000' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(v_days) IS DISTINCT FROM 'array' OR jsonb_array_length(v_days) > 100 THEN
    RAISE EXCEPTION 'Send days as a list of at most 100' USING ERRCODE='22023';
  END IF;
  v_fetched := public.cockpit_meta_budget_try_ts(p->>'fetchedAt');
  IF v_fetched IS NULL OR v_fetched > v_now + interval '5 minutes' OR v_fetched < v_now - interval '1 hour' THEN
    RAISE EXCEPTION 'fetchedAt must be when Meta answered, within the last hour' USING ERRCODE='22023';
  END IF;
  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$' OR (t.account_currency IS NOT NULL AND v_currency <> t.account_currency) THEN
    RAISE EXCEPTION 'The budget history of act_% is not in its currency', t.account_id USING ERRCODE='22023';
  END IF;
  IF coalesce(p->>'currencyOffset', '') NOT IN ('1', '100') THEN
    RAISE EXCEPTION 'currencyOffset is Meta''s offset for the currency: 1 or 100' USING ERRCODE='22023';
  END IF;

  SELECT x.why INTO v_bad FROM (
    SELECT CASE
        WHEN jsonb_typeof(d) <> 'object' OR public.cockpit_meta_ad_days_try_date(d->>'day') IS NULL THEN 'a day without its date'
        WHEN public.cockpit_meta_ad_days_try_date(d->>'day') NOT BETWEEN t.since AND t.until THEN 'a day outside the task''s days'
        WHEN jsonb_typeof(d->'verified') IS DISTINCT FROM 'boolean' OR coalesce(d->>'campaigns', '') !~ '^[0-9]{1,6}$' THEN 'a day without its count'
        WHEN length(coalesce(d->>'note', '')) > 300 THEN 'a day note that is too long'
      END AS why
    FROM jsonb_array_elements(v_days) d
  ) x WHERE x.why IS NOT NULL LIMIT 1;
  IF v_bad IS NULL AND (SELECT count(*) <> count(DISTINCT d->>'day') FROM jsonb_array_elements(v_days) d) THEN v_bad := 'a day twice'; END IF;
  IF v_bad IS NULL THEN
    SELECT x.why INTO v_bad FROM (
      SELECT CASE
          WHEN jsonb_typeof(e) <> 'object' OR coalesce(e->>'campaign_id', '') !~ '^[0-9]{5,25}$' THEN 'a row without a valid campaign id'
          WHEN e->>'account_id' IS DISTINCT FROM t.account_id THEN 'a row from another ad account'
          WHEN EXISTS (SELECT 1 FROM public.cockpit_meta_budgets b
                       WHERE b.level = 'campaign' AND b.object_id = e->>'campaign_id' AND b.account_id <> t.account_id)
            OR EXISTS (SELECT 1 FROM public.cockpit_meta_budget_days b
                       WHERE b.campaign_id = e->>'campaign_id' AND b.account_id <> t.account_id)
            OR EXISTS (SELECT 1 FROM public.cockpit_meta_ad_days m
                       WHERE m.campaign_id = e->>'campaign_id' AND m.account_id <> t.account_id) THEN 'a campaign another ad account holds'
          WHEN public.cockpit_meta_ad_days_try_date(e->>'day') IS NULL
            OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_days) d WHERE d->>'day' = e->>'day') THEN 'a row for a day the history did not cover'
          WHEN coalesce(e->>'budget_level', '') NOT IN ('campaign','adset') THEN 'a row without its budget level'
          WHEN e->>'budget_type' IS NOT NULL AND e->>'budget_type' NOT IN ('daily','lifetime') THEN 'a budget that is neither daily nor lifetime'
          WHEN EXISTS (SELECT 1 FROM jsonb_each(e) k WHERE k.key IN ('daily_budget','max_budget') AND jsonb_typeof(k.value) NOT IN ('number','null')) THEN 'an amount that is not a number'
          WHEN least((e->>'daily_budget')::numeric, (e->>'max_budget')::numeric) < 0 OR (e->>'max_budget')::numeric = 0 THEN 'a negative or zero amount'
          WHEN (e->>'budget_type' = 'daily') <> (e->>'daily_budget' IS NOT NULL) OR (e->>'budget_type' IS NULL AND e->>'daily_budget' IS NOT NULL) THEN 'a budget that does not match its type'
          WHEN jsonb_typeof(e->'switched_on') IS DISTINCT FROM 'boolean' OR jsonb_typeof(e->'switched_on_any') IS DISTINCT FROM 'boolean'
            OR jsonb_typeof(e->'changed_during_day') IS DISTINCT FROM 'boolean' OR jsonb_typeof(e->'verified') IS DISTINCT FROM 'boolean' THEN 'a row without its flags'
          WHEN NOT (e->>'switched_on_any')::boolean THEN 'a row for a day it was never switched on'
          WHEN e ? 'delivering' OR e ? 'delivering_any' THEN 'a row that says whether it delivered, which the log cannot show'
          WHEN NOT (e->>'switched_on')::boolean AND nullif(btrim(coalesce(e->>'why_not', '')), '') IS NULL THEN 'a row switched off without the reason'
          WHEN length(coalesce(e->>'why_not', '')) > 300 THEN 'a reason that is too long'
        END AS why
      FROM jsonb_array_elements(v_rows) e
    ) x WHERE x.why IS NOT NULL LIMIT 1;
  END IF;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Meta''s budget history for act_% held %; nothing was written', t.account_id, v_bad USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) <> count(DISTINCT (e->>'campaign_id') || '|' || (e->>'day')) FROM jsonb_array_elements(v_rows) e) THEN
    RAISE EXCEPTION 'Meta''s budget history for act_% held one campaign twice on a day; nothing was written', t.account_id USING ERRCODE='22023';
  END IF;

  v_rate := public.cockpit_meta_ad_days_usd_per(v_currency);
  -- A snapshot row is never touched. On a day an hourly read covers, the history adds only the campaigns
  -- no read saw switched on (one paused before the day's first read, the day reads began or after a gap).
  DELETE FROM public.cockpit_meta_budget_days x
  WHERE x.account_id = t.account_id AND x.source = 'activity' AND x.day BETWEEN t.since AND t.until;
  INSERT INTO public.cockpit_meta_budget_days AS x (campaign_id, day, account_id, budget_level, budget_type, daily_budget, daily_budget_usd,
    max_switched_on_budget, max_switched_on_budget_usd, currency, usd_rate, switched_on, switched_on_any, delivering, delivering_any, why_not,
    changed_during_day, source, verified, first_seen, last_seen, run_id)
  SELECT r.campaign_id, r.day, t.account_id, r.budget_level, r.budget_type, r.daily_budget,
    CASE WHEN r.daily_budget IS NOT NULL AND v_rate IS NOT NULL THEN round(r.daily_budget * v_rate, 6) END,
    r.max_budget,
    CASE WHEN r.max_budget IS NOT NULL AND v_rate IS NOT NULL THEN round(r.max_budget * v_rate, 6) END,
    v_currency, v_rate, r.switched_on, r.switched_on_any, NULL, NULL, left(nullif(btrim(r.why_not), ''), 300),
    r.changed_during_day, 'activity', r.verified, v_fetched, v_fetched, t.run_id
  FROM jsonb_to_recordset(v_rows) AS r(campaign_id text, day date, budget_level text, budget_type text, daily_budget numeric, max_budget numeric,
    switched_on boolean, switched_on_any boolean, why_not text, changed_during_day boolean, verified boolean)
  ON CONFLICT (campaign_id, day) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  SELECT count(*) FILTER (WHERE a.source = 'snapshot')::int INTO v_covered
  FROM jsonb_array_elements(v_days) d JOIN public.cockpit_meta_budget_account_days a
    ON a.account_id = t.account_id AND a.day = (d->>'day')::date;
  INSERT INTO public.cockpit_meta_budget_account_days AS x (account_id, day, source, reads, first_read, last_read, campaigns, verified, note, run_id)
  SELECT t.account_id, (d->>'day')::date, 'activity', 1, v_fetched, v_fetched, (d->>'campaigns')::int, (d->>'verified')::boolean,
    left(nullif(btrim(d->>'note'), ''), 300), t.run_id
  FROM jsonb_array_elements(v_days) d
  WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_meta_budget_account_days a
                    WHERE a.account_id = t.account_id AND a.day = (d->>'day')::date AND a.source = 'snapshot')
  ON CONFLICT (account_id, day) DO UPDATE SET reads = 1, first_read = EXCLUDED.first_read, last_read = EXCLUDED.last_read,
    campaigns = EXCLUDED.campaigns, verified = EXCLUDED.verified, note = EXCLUDED.note, run_id = EXCLUDED.run_id
  WHERE x.source = 'activity';
  GET DIAGNOSTICS v_written_days = ROW_COUNT;

  UPDATE public.cockpit_meta_ad_day_tasks SET rows_read = v_n, note = left(nullif(btrim(p->>'note'), ''), 300), state = 'done', error = NULL,
    lease_token = NULL, lease_until = NULL, updated_at = pg_catalog.now()
  WHERE id = t.id;
  v_state := public.cockpit_meta_ad_days_finish(t.run_id);
  RETURN jsonb_build_object('ok', true, 'written', v_n, 'days', v_written_days, 'coveredByReads', v_covered, 'run', v_state);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Function privileges: the new helpers for nobody (the definer functions
-- call them as the owner); the service RPCs for the service role only.

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['cockpit_meta_budget_day(timestamptz,text)', 'cockpit_meta_budget_try_ts(text)',
    'cockpit_meta_budget_accounts_bad(jsonb,boolean,date)', 'cockpit_meta_ad_days_finish(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['cockpit_meta_ad_days_inputs(jsonb)', 'cockpit_meta_ad_days_begin(jsonb)', 'cockpit_meta_ad_days_claim(jsonb)',
    'cockpit_meta_ad_days_fail(jsonb)', 'cockpit_meta_ad_days_status()', 'cockpit_meta_budgets_apply(jsonb)',
    'cockpit_meta_budget_history_apply(jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
