-- Meta's zero reads never overwrite a settled ad-day (2026-10-21, Creative
-- Triage bldgtotkfmhoxmlzowdx).
--
-- The CEO, 2026-10-21: "make sure it shows the cost per booking correctly for
-- all". On 21 Oct at 09:07 Kuwait Meta answered the hourly read of Atlantis's
-- ad account 290802986 (Los Angeles days) with spend, impressions and clicks as
-- "0" for 19 Oct on 4 ads, while the same rows carried 14 link clicks and 2
-- leads. cockpit_meta_ad_days_apply stored it over the earlier read ($15.38 in
-- the media sync: 52522397660916 $7.51, 52522396895916 $1.77, 52522396896516
-- $2.39, 52522397660716 $3.71), every hourly task said "ok", and 19 Oct left
-- the hourly window an hour later. Until 20:07 the board read Arcturus at
-- $52.89 "good" (true $60.62, watch), City Wood $106.41 (true $118.00) and
-- Atlantis 14-20 Oct $39.79 (true $43.63); Team & payroll's cost per booking
-- and ads_daily_snapshots took the same zeros.
--
-- What changes, and nothing else:
--   - A zero read never replaces a settled day. When the stored row of a
--     finished day (before today on the ad account's own clock, the clock
--     days.ts reads by; Kuwait when the zone is not one) has spend or
--     impressions above 0, an incoming row for it with spend 0 and impressions
--     0 is not written: the stored row, its fetched_at included, stands, so the
--     dashboard feed does not pick the zeros up either. Today is left to Meta:
--     it is re-read every hour, so the next read replaces a zero there. The
--     check is in the ON CONFLICT ... WHERE, so a read that lands at the same
--     moment as another is judged against the row that read committed. It
--     never keys on clicks (Meta zeroed them too) or leads (the zeroed SAFAD,
--     Madana and City Wood rows had none).
--   - The task's note counts the rows kept ("Kept 4 settled ad-days ...", over
--     every call of the task's attempt; a retry counts afresh), and the call
--     returns keptZeroReads. They are not counted as written or changed.
--   - Two signs of a zeroed read are refused on a finished day, so the task
--     fails with the sentence, the run reads "partial" and its note names the
--     account, instead of every hourly task saying "ok":
--       link clicks on an ad-day with no impressions (Atlantis 19 Oct; none of
--       the other 2,902 stored ad-days has it), and
--       link clicks with no clicks and no spend.
--     Today's rows are not refused: the next hourly read replaces them, and a
--     refusal would also hold back yesterday's rows sent in the same call. A
--     zeroed read that is still there once the day has finished is refused.
--     More link clicks than clicks on its own is not refused: Meta counts the
--     two apart, and City Wood's real 23 Sep row (read 21 Oct 03:22) holds 6
--     link clicks against 5 clicks on $6.51 and 246 impressions. Refusing that
--     would fail the account's whole 7-day piece every night it is read.
--   - Every guard of 20261018120000 stands: the lease, the row count, the
--     hour-old fetchedAt, each row check, one ad once a day, and an earlier read
--     never replacing a later one.
--
-- What it cannot do: heal a day already stored as zero. Atlantis 19 Oct is $0
-- until a read Meta answers correctly; the nightly run (03:20 Kuwait) re-reads
-- the 28 days before today. If Meta still zeroes it, its 7-day piece is refused
-- and the run says so. Check after 03:20: Atlantis 19 Oct = $15.38.
--
-- The body is the live one (prosrc md5 8d81d8eb68621d56cdb8e9561578adb3, equal
-- to 20261018120000_meta_dashboard_feed.sql) with only these lines added. The
-- file refuses, and changes nothing, if the live body is neither that one nor
-- this file's, so a change made since 21 Oct is never overwritten.
-- Rollback: ~/.cache/mahara-ship/rollback/cockpit_meta_ad_days_apply.before-20261021200100.sql
-- (the live definition and its grants, dumped before this file).
-- How we know it works: apps/media-buyer-cockpit/scripts/meta-ad-days-zero-reads-supabase.test.ts,
-- on the production chain (20261016121700, 20261016210100, 20261017100000,
-- 20261018120000, then this). Safe to apply twice. Order-free with the Edge
-- Function: it sends the same rows either way.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE v_md5 text;
BEGIN
  IF to_regprocedure('public.cockpit_meta_budget_day(timestamptz,text)') IS NULL
     OR to_regprocedure('public.cockpit_meta_ads_apply(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261017100000_meta_budgets.sql and 20261018120000_meta_dashboard_feed.sql first';
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_meta_ad_days_apply(jsonb)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('8d81d8eb68621d56cdb8e9561578adb3', '31c1e5724ff8dd063431367034e9031a') THEN
    RAISE EXCEPTION 'cockpit_meta_ad_days_apply is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_apply(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.cockpit_meta_ad_day_tasks; v_rows jsonb := p->'rows'; v_fetched timestamptz; v_rate numeric; v_bad text;
  v_n int; v_new int; v_changed int; v_older int; v_spend numeric; v_leads bigint; v_final boolean := coalesce((p->>'final')::boolean, false);
  v_state text;
  -- (2026-10-21) The account's today, the zero reads this call kept, and the task's note.
  v_today date; v_kept int; v_prior int; v_note text;
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
  -- A day before this one has finished on the account's clock (days.ts zonedDay: Kuwait when the zone is not one).
  v_today := public.cockpit_meta_budget_day(public.cockpit_meta_ad_days_now(), t.account_timezone);

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
        -- (2026-10-21) Meta zeroed the read: Atlantis 19 Oct came back as $0 and 0 impressions with 14 link clicks.
        -- Only a finished day on the account's clock: today is read again within the hour, and refusing it would
        -- also stop yesterday's rows in the same call from landing.
        WHEN r.day < v_today AND r.link_clicks > 0 AND (r.impressions = 0 OR (r.clicks = 0 AND r.spend = 0))
          THEN 'ad ' || r.ad_id || ' on ' || to_char(r.day, 'YYYY-MM-DD') || ': link clicks with '
            || CASE WHEN r.impressions = 0 THEN 'no impressions' ELSE 'no clicks and no spend' END || ' (Meta zeroed the read)'
      END AS why
    FROM jsonb_to_recordset(v_rows) AS r(account_id text, day date, campaign_id text, adset_id text, ad_id text, spend numeric, frequency numeric,
      impressions bigint, reach bigint, clicks bigint, link_clicks bigint, leads bigint, lead_actions bigint, landing_page_views bigint, video_plays bigint,
      video_3s bigint, video_p25 bigint, video_p50 bigint, video_p75 bigint, video_p100 bigint, thruplays bigint, destination_type text)
  ) x WHERE x.why IS NOT NULL LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Meta''s rows for act_% held %; nothing was written', t.account_id, v_bad USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) <> count(DISTINCT (r->>'ad_id') || '|' || (r->>'day')) FROM jsonb_array_elements(v_rows) r) THEN
    RAISE EXCEPTION 'Meta''s rows for act_% held one ad twice on a day; nothing was written', t.account_id USING ERRCODE='22023';
  END IF;

  -- (2026-10-21) v_kept: rows a zero read would have written over a settled day (the same test as the upsert's WHERE).
  SELECT count(*)::int, count(*) FILTER (WHERE x.ad_id IS NULL)::int,
         count(*) FILTER (WHERE x.ad_id IS NOT NULL AND x.fetched_at <= v_fetched AND
           NOT coalesce(r.day < v_today AND r.spend = 0 AND r.impressions = 0 AND (x.spend > 0 OR x.impressions > 0), false) AND
           (x.account_id, x.campaign_id, x.campaign_name, x.objective, x.adset_id, x.adset_name, x.ad_name, x.spend, x.impressions, x.reach,
            x.frequency, x.clicks, x.link_clicks, x.leads, x.lead_actions, x.landing_page_views, x.video_plays, x.video_3s, x.video_p25, x.video_p50,
            x.video_p75, x.video_p100, x.thruplays, x.destination_type)
           IS DISTINCT FROM
           (r.account_id, r.campaign_id, r.campaign_name, r.objective, r.adset_id, r.adset_name, r.ad_name, r.spend, r.impressions, r.reach,
            r.frequency, r.clicks, r.link_clicks, r.leads, r.lead_actions, r.landing_page_views, r.video_plays, r.video_3s, r.video_p25, r.video_p50,
            r.video_p75, r.video_p100, r.thruplays, r.destination_type))::int,
         count(*) FILTER (WHERE x.fetched_at > v_fetched)::int,
         count(*) FILTER (WHERE x.ad_id IS NOT NULL AND x.fetched_at <= v_fetched AND
           coalesce(r.day < v_today AND r.spend = 0 AND r.impressions = 0 AND (x.spend > 0 OR x.impressions > 0), false))::int,
         sum(r.spend), sum(r.leads)
    INTO v_n, v_new, v_changed, v_older, v_kept, v_spend, v_leads
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
  WHERE x.fetched_at <= EXCLUDED.fetched_at
    -- (2026-10-21) A finished day Meta read as $0 and 0 impressions keeps the read that had delivery.
    AND NOT coalesce(EXCLUDED.day < v_today AND EXCLUDED.spend = 0 AND EXCLUDED.impressions = 0 AND (x.spend > 0 OR x.impressions > 0), false);

  -- (2026-10-21) The kept rows, over every call of this attempt, lead the note; the function's own note follows.
  -- A claim zeroes rows_read but keeps the note, so an earlier attempt's count is not carried into a retry.
  v_prior := CASE WHEN t.rows_read > 0 THEN coalesce(substring(t.note FROM '^Kept ([0-9]{1,9}) settled ad-days? ')::int, 0) ELSE 0 END;
  v_note := coalesce(nullif(btrim(p->>'note'), ''), nullif(regexp_replace(t.note, '^Kept [0-9]+ settled ad-days? [^.]*[.] ?', ''), ''));
  IF v_prior + v_kept > 0 THEN
    v_note := concat_ws(' ', 'Kept ' || (v_prior + v_kept) || ' settled ad-day' || CASE WHEN v_prior + v_kept = 1 THEN '' ELSE 's' END
      || ' Meta read as $0 and 0 impressions; the earlier read stands.', v_note);
  END IF;

  UPDATE public.cockpit_meta_ad_day_tasks SET rows_read = rows_read + v_n, changed = changed + v_new + v_changed,
    spend = CASE WHEN v_spend IS NULL THEN spend ELSE coalesce(spend, 0) + v_spend END,
    leads = CASE WHEN v_leads IS NULL THEN leads ELSE coalesce(leads, 0) + v_leads END,
    note = left(v_note, 300),
    state = CASE WHEN v_final THEN 'done' ELSE state END,
    error = CASE WHEN v_final THEN NULL ELSE error END,
    lease_token = CASE WHEN v_final THEN NULL ELSE lease_token END,
    lease_until = CASE WHEN v_final THEN NULL ELSE public.cockpit_meta_ad_days_now() + interval '5 minutes' END,
    updated_at = pg_catalog.now()
  WHERE id = t.id;
  IF v_final THEN v_state := public.cockpit_meta_ad_days_finish(t.run_id); END IF;
  RETURN jsonb_build_object('ok', true, 'written', v_n - v_older - v_kept, 'inserted', v_new, 'changed', v_changed, 'olderThanStored', v_older,
    'keptZeroReads', v_kept, 'final', v_final, 'run', v_state);
END;
$$;

-- CREATE OR REPLACE keeps the privileges; stated again, exactly as 20261018120000 left them.
REVOKE ALL ON FUNCTION public.cockpit_meta_ad_days_apply(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_meta_ad_days_apply(jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
