-- The ClickUp KPI push gets the media sync's 7 days and a booking ledger by campaign
-- (cost per booking, build 2, 22 Oct 2026; docs/client-performance/CPB-BUILD2-CONTRACT.md
-- 2.7, audit R12; Creative Triage bldgtotkfmhoxmlzowdx).
--
-- The push planned Bookings (7d) and Cost Per Booking from its own 7 days, which counted
-- today's bookings against spend that stops yesterday, and matched bookings to cards by
-- client name. Additive only; every key it returned before stays as it was:
-- - top level: weekFrom, weekThrough and weekSource, from cockpit_media_week()
--   (20261022w). weekFrom is null until the media sync publishes its window, and the
--   push then plans nothing.
-- - with p_with_stats: bookingsByCampaign [{campaignName, day, booked}] from
--   cockpit_media_booking_events, grouped by campaign and booking day; and the daily,
--   bookings and new ledger reads start 10 days back (were 8), so an overnight window
--   that starts 9 days back is covered.
--
-- The body is the live one (prosrc md5 2e98bd0efe32770de5555fa3163f1266, the body of
-- 20261009f) with those lines added. The file refuses, and changes nothing, if the live
-- body is neither that one nor this file's (224ee97aa499a9750fa676a5d323003a). Owner and grants are
-- kept (EXECUTE for service_role, as live) and restated. Safe to run twice.
-- Needs 20261022w. Deploy before the clickup-writeback Edge Function that reads it.
-- Test: apps/media-buyer-cockpit/scripts/clickup-kpi-inputs-supabase.test.ts.
-- Rollback: ~/.cache/mahara-ship/rollback/cockpit_clickup_writeback_inputs.before-20261022z.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v_md5 text;
BEGIN
  IF to_regprocedure('public.cockpit_media_week()') IS NULL THEN
    RAISE EXCEPTION 'cockpit_media_week is missing: apply 20261022w_media_week.sql first';
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_clickup_writeback_inputs(boolean)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('2e98bd0efe32770de5555fa3163f1266', '224ee97aa499a9750fa676a5d323003a') THEN
    RAISE EXCEPTION 'cockpit_clickup_writeback_inputs is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_inputs(p_with_stats boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE today date:=(now() AT TIME ZONE 'Asia/Kuwait')::date; out jsonb; week jsonb:=public.cockpit_media_week();
BEGIN
 out:=jsonb_build_object('workingDay',today,
  'campaigns',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'campaignName',c.raw_data->>'campaignName','clientName',nullif(c.raw_data->>'clientName',''),'clientTag',nullif(c.raw_data->>'clientTag',''),
    'taskId',nullif(coalesce(c.raw_data->>'taskId',c.task_id),''),'taskUrl',coalesce(c.raw_data->>'taskUrl',c.task_url),
    'internal',coalesce(c.raw_data->>'internal','false')='true',
    'cpl',c.raw_data->'cpl','spend7d',c.raw_data->'spend7d','leads7d',c.raw_data->'leads7d','bookings7d',c.raw_data->'bookings7d',
    'metaCampaignId',coalesce(nullif(c.raw_data->>'metaCampaignId',''),c.meta_campaign_id),'boardAdStatus',c.raw_data->>'boardAdStatus',
    'syncedAt',c.synced_at) ORDER BY c.id)
   FROM public.cockpit_campaigns c WHERE NOT c.source_deleted AND nullif(c.raw_data->>'campaignName','') IS NOT NULL),'[]'::jsonb),
  'latestPublishAt',(SELECT max(r.published_at) FROM public.cockpit_native_media_runs r WHERE r.status='published'),
  'latestSyncedAt',(SELECT max(c.synced_at) FROM public.cockpit_campaigns c WHERE NOT c.source_deleted),
  -- The media sync's 7 days (20261022w cockpit_media_week): the KPI push plans over these days only.
  'weekFrom',week->'from','weekThrough',week->'through','weekSource',week->'source');
 IF p_with_stats THEN
  out:=out||jsonb_build_object(
   'dailyReady',coalesce((SELECT f.ready FROM public.cockpit_media_feed_state f WHERE f.feed='dailyStats'),false),
   'bookingsReady',coalesce((SELECT f.ready FROM public.cockpit_media_feed_state f WHERE f.feed='bookingEvents'),false),
   'daily',coalesce((SELECT jsonb_agg(jsonb_build_object('campaignName',s.campaign_name,'day',s.day,'spend',s.spend,'leads',s.leads))
    FROM (SELECT d.campaign_name,d.day,sum((d.data->>'spend')::numeric) AS spend,sum((d.data->>'leads')::numeric) AS leads
     FROM public.cockpit_media_daily_stats d WHERE d.day>=today-10 GROUP BY d.campaign_name,d.day) s),'[]'::jsonb),
   'bookings',coalesce((SELECT jsonb_agg(jsonb_build_object('client',b.client,'day',b.day,'booked',b.n))
    FROM (SELECT lower(btrim(e.data->>'client')) AS client,e.day,count(*) AS n FROM public.cockpit_media_booking_events e
     WHERE e.day>=today-10 AND nullif(btrim(e.data->>'client'),'') IS NOT NULL GROUP BY 1,2) b),'[]'::jsonb),
   -- Bookings by campaign and booking day, for the per-card ledger check (20261022z).
   'bookingsByCampaign',coalesce((SELECT jsonb_agg(jsonb_build_object('campaignName',b.campaign_name,'day',b.day,'booked',b.n) ORDER BY b.campaign_name,b.day)
    FROM (SELECT e.campaign_name,e.day,count(*) AS n FROM public.cockpit_media_booking_events e
     WHERE e.day>=today-10 GROUP BY 1,2) b),'[]'::jsonb));
 END IF;
 RETURN out;
END $fn$;

REVOKE ALL ON FUNCTION public.cockpit_clickup_writeback_inputs(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_clickup_writeback_inputs(boolean) TO service_role;
COMMIT;
