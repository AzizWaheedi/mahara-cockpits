-- The 7-day window, one end for every reader (cost per booking, build 2, 22 Oct 2026;
-- docs/client-performance/CPB-BUILD2-CONTRACT.md 2.2 to 2.4, audit R1 and the overnight
-- window; Creative Triage bldgtotkfmhoxmlzowdx).
--
-- The media sync's 7 days end on the sheet's last spend day (`through`), the same day
-- for every client in one publish. Bookings made after that day have no spend beside
-- them yet, so every count of bookings must stop there too. This file gives that day
-- one home and makes two reads use it:
--
-- 1. public.cockpit_media_week() (new). {"from", "through", "source"}:
--    - "media sync": the window the worker publishes on the client links
--      (cockpit_media_sources, table clientLinks, data.ads7d.from and .through) of the
--      current ready snapshot: from = the earliest from, through = the latest through.
--    - "media data", before the worker publishes ads7d: through = the last day of
--      cockpit_media_daily_stats, from = null.
--    Never after Kuwait's yesterday either way. A malformed or impossible day on a link
--    (2026-09-31) is ignored, never an error. Called only from definer functions:
--    EXECUTE for service_role alone.
-- 2. cockpit_media_statistics (live prosrc md5 d800cf97035c9b261e72b6b02a0a41f4, the
--    body of 20261010c): only the coverage read changes. It also returns
--    bookingsThrough (the week's through), weekFrom and weekSource, so the media buyer
--    caps every range read at the same day. Range, campaign trend and portfolio trend
--    are unchanged. Grants as live: authenticated and service_role.
-- 3. cockpit_winner_numbers (live prosrc md5 cbbacd4df63c8af8bda56918bda4d1f6, the body
--    of 20260927q): spend rows and booking rows are both counted from p_start to
--    least(p_end, the week's through), and the stats carry "through". On 21 Oct the
--    preview of CityWood v1 over 1 to 21 Oct counted 7 bookings (four of them made on
--    21 Oct) against spend to 20 Oct: $16.38 a booking where the paired days give 3
--    and $38.22. Saved rows in cockpit_winner_saves are not rewritten. Grants as live:
--    service_role (and the owner), never authenticated.
--
-- The file refuses, and changes nothing, when a live body is neither the one above nor
-- this file's own, so a change made since is never overwritten. Owners, SECURITY DEFINER
-- and search_path are kept; REVOKE and GRANT are restated as live. Safe to run twice.
-- Test: apps/media-buyer-cockpit/scripts/media-week-supabase.test.ts.
-- Rollback: ~/.cache/mahara-ship/rollback/20261022w.before.sql (the two live definitions
-- and their grants), then DROP FUNCTION public.cockpit_media_week() once nothing calls it.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_media_statistics(text,text,date,date)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('d800cf97035c9b261e72b6b02a0a41f4', '93a026c3e98cb44f52d8717cfd073235') THEN
    RAISE EXCEPTION 'cockpit_media_statistics is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_winner_numbers(text,text,date,date)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('cbbacd4df63c8af8bda56918bda4d1f6', '7a752b99b58c3886df251f165569071d') THEN
    RAISE EXCEPTION 'cockpit_winner_numbers is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
  -- New in this file: when it exists already, it is this file's.
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_media_week()');
  IF v_md5 IS NOT NULL AND v_md5 <> '14382f486c92f0236a12b1f8d54a51b5' THEN
    RAISE EXCEPTION 'cockpit_media_week is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', v_md5;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.cockpit_media_week()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  -- The media sync's 7 days: the shared window its client links carry (ads7d.from and
  -- ads7d.through, one end for every client in a publish), read from the current ready
  -- snapshot. Before the sync publishes it: the media data's last day, and no start.
  -- Never after Kuwait's yesterday either way.
  -- A day is YYYY-MM-DD and a real date (pg_input_is_valid): one malformed or impossible
  -- day on a link (2026-09-31) is ignored, never an error for every reader.
  WITH sync AS (
    SELECT min(CASE WHEN s.data->'ads7d'->>'from' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                     AND pg_catalog.pg_input_is_valid(s.data->'ads7d'->>'from', 'date')
                    THEN (s.data->'ads7d'->>'from')::date END) AS w_from,
           max(CASE WHEN s.data->'ads7d'->>'through' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                     AND pg_catalog.pg_input_is_valid(s.data->'ads7d'->>'through', 'date')
                    THEN (s.data->'ads7d'->>'through')::date END) AS w_through
    FROM public.cockpit_media_source_state st
    JOIN public.cockpit_media_sources s ON s.table_name = st.table_name AND s.source_snapshot_at = st.source_snapshot_at
    WHERE st.table_name = 'clientLinks' AND st.ready AND jsonb_typeof(s.data->'ads7d') = 'object'
  ), yesterday AS (
    SELECT (now() AT TIME ZONE 'Asia/Kuwait')::date - 1 AS d
  )
  SELECT CASE WHEN sync.w_through IS NOT NULL
    THEN jsonb_build_object('from', CASE WHEN sync.w_from <= least(sync.w_through, y.d) THEN sync.w_from END,
      'through', least(sync.w_through, y.d), 'source', 'media sync')
    ELSE jsonb_build_object('from', NULL,
      'through', least((SELECT max(d.day) FROM public.cockpit_media_daily_stats d), y.d), 'source', 'media data') END
  FROM sync CROSS JOIN yesterday y
$fn$;

CREATE OR REPLACE FUNCTION public.cockpit_media_statistics(p_kind text, p_campaign text DEFAULT NULL::text, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE result jsonb; start_day date; end_day date; week jsonb;
BEGIN
 IF NOT (public.cockpit_has_role('media_buyer') OR public.cockpit_has_role('admin') OR public.cockpit_is_ceo()) THEN
  RAISE EXCEPTION 'Verified media-buyer access required' USING ERRCODE='42501';END IF;
 IF p_kind NOT IN ('range','campaignTrend','portfolioTrend','coverage') OR p_kind IS NULL THEN RAISE EXCEPTION 'Unknown statistics operation';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_media_feed_state WHERE feed='dailyStats' AND ready) THEN
  RAISE EXCEPTION 'Daily statistics history has not been imported and verified yet';END IF;
 IF p_kind IN ('range','campaignTrend') THEN
  IF p_start IS NULL OR p_end IS NULL OR p_start>p_end OR p_end-p_start>=400 THEN RAISE EXCEPTION 'Choose a valid range of at most 400 days';END IF;
  IF public.cockpit_media_campaign_allowed(p_campaign) IS NOT TRUE THEN RAISE EXCEPTION 'Campaign is outside your assigned clients' USING ERRCODE='42501';END IF;
 END IF;
 IF p_kind='range' THEN
  IF NOT EXISTS(SELECT 1 FROM public.cockpit_media_feed_state WHERE feed='bookingEvents' AND ready) THEN RAISE EXCEPTION 'Booking history has not been imported and verified yet';END IF;
  RETURN jsonb_build_object(
   'rows',coalesce((SELECT jsonb_agg(data ORDER BY day,coalesce((data->>'_creationTime')::numeric,0),source_id) FROM public.cockpit_media_daily_stats WHERE campaign_name=p_campaign AND day BETWEEN p_start AND p_end),'[]'::jsonb),
   'historical',coalesce((SELECT jsonb_agg(data ORDER BY day,coalesce((data->>'_creationTime')::numeric,0),source_id) FROM public.cockpit_media_daily_stats WHERE campaign_name=p_campaign AND day>=p_start-30 AND day<p_start),'[]'::jsonb),
   'bookings',coalesce((SELECT jsonb_agg(jsonb_build_object('campaignName',campaign_name,'date',day,'status',data->>'status','adId',data->>'adId','startTime',data->>'startTime','appointmentDate',data->>'appointmentDate') ORDER BY day,source_id) FROM public.cockpit_media_booking_events WHERE campaign_name=p_campaign AND day BETWEEN p_start AND p_end),'[]'::jsonb)
  );
 END IF;
 IF p_kind='coverage' THEN
  -- The day every booking count stops (20261022w): the media sync's own 7-day end, or
  -- before the sync publishes it the media data's last day, never after yesterday.
  week:=public.cockpit_media_week();
  SELECT jsonb_build_object('first',min(d.day),'last',max(d.day),'rows',NULL,
   'bookingsThrough',week->'through','weekFrom',week->'from','weekSource',week->'source')
  INTO result FROM public.cockpit_media_daily_stats d WHERE public.cockpit_media_campaign_allowed(d.campaign_name);
  RETURN result;
 END IF;
 start_day:=CASE WHEN p_kind='portfolioTrend' THEN (now() AT TIME ZONE 'Asia/Kuwait')::date-30 ELSE p_start END;
 end_day:=CASE WHEN p_kind='portfolioTrend' THEN (now() AT TIME ZONE 'Asia/Kuwait')::date ELSE p_end END;
 WITH allowed AS (
  SELECT DISTINCT c.raw_data->>'campaignName' AS name FROM public.cockpit_campaigns c
  WHERE public.cockpit_media_campaign_allowed(c.raw_data->>'campaignName')
   AND (p_kind<>'portfolioTrend' OR coalesce(c.raw_data->>'internal','false')<>'true')
 ), totals AS (
  SELECT d.day,sum((d.data->>'spend')::numeric) AS spend,sum((d.data->>'leads')::numeric) AS leads
  FROM public.cockpit_media_daily_stats d JOIN allowed a ON a.name=d.campaign_name
  WHERE d.day BETWEEN start_day AND end_day AND (p_kind='portfolioTrend' OR d.campaign_name=p_campaign)
  GROUP BY d.day
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('date',day,'spend',round(spend,2),'leads',leads,
  'cpl',CASE WHEN leads>0 THEN round(spend/leads,2) ELSE NULL END) ORDER BY day),'[]'::jsonb) INTO result FROM totals;
 RETURN result;
END;$fn$;

CREATE OR REPLACE FUNCTION public.cockpit_winner_numbers(p_campaign text, p_id text, p_start date, p_end date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
 -- Spend and bookings both stop on the paired day (20261022w): the range's end, or the
 -- media sync's 7-day end when the range runs past it, so a booking made today never
 -- meets spend that stops yesterday. The stats say which day that was.
 WITH wk AS(
 SELECT least(p_end,(public.cockpit_media_week()->>'through')::date) through
 ), totals AS(
 SELECT sum((data->>'spend')::numeric) spend,sum((data->>'leads')::numeric) leads,sum((data->>'impressions')::numeric) impressions,sum((data->>'linkClicks')::numeric) clicks,max((data->>'frequency')::numeric) frequency,count(*) rows
 FROM public.cockpit_media_daily_stats CROSS JOIN wk WHERE campaign_name=p_campaign AND day BETWEEN p_start AND wk.through AND data->>'metaAdId'=p_id
 ), bookings AS(
 SELECT count(*) FILTER(WHERE data->>'adId'=p_id) n,count(*) FILTER(WHERE data->>'adId'=p_id AND data->>'status'='showed') showed,bool_or(nullif(data->>'adId','') IS NOT NULL) attributed FROM public.cockpit_media_booking_events CROSS JOIN wk WHERE campaign_name=p_campaign AND day BETWEEN p_start AND wk.through
 ) SELECT jsonb_strip_nulls(jsonb_build_object('spend',round(t.spend,2),'leads',t.leads,'cpl',CASE WHEN t.leads>0 THEN round(t.spend/t.leads,2) END,'impressions',t.impressions,'linkClicks',t.clicks,'linkCtr',CASE WHEN t.impressions>=1000 THEN round(t.clicks/t.impressions*100,2) END,'cpm',CASE WHEN t.impressions>=1000 THEN round(t.spend/t.impressions*1000,2) END,'optInRate',CASE WHEN t.clicks>=50 THEN round(t.leads/t.clicks*100,2) END,'frequency',t.frequency,'bookings',b.n,'showed',b.showed,'costPerBooking',CASE WHEN b.n>0 THEN round(t.spend/b.n,2) END,'bookingsAttributed',coalesce(b.attributed,false),'rows',t.rows,'through',w.through)) FROM totals t CROSS JOIN bookings b CROSS JOIN wk w;
$fn$;

COMMENT ON FUNCTION public.cockpit_media_week() IS
  'The media sync''s 7 days: {from, through, source}. "media sync" = the window on the current clientLinks snapshot (ads7d); "media data" = the last day of cockpit_media_daily_stats, from null. Never after Kuwait''s yesterday. 20261022w.';

REVOKE ALL ON FUNCTION public.cockpit_media_week() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_week() TO service_role;
REVOKE ALL ON FUNCTION public.cockpit_media_statistics(text,text,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_statistics(text,text,date,date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_winner_numbers(text,text,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_winner_numbers(text,text,date,date) TO service_role;
COMMIT;
