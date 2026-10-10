-- The media buyer's funnel sheet counts a booked call as shown when it is
-- marked showed, or confirmed or invalid once its time has passed (Aziz's
-- rule, the B2B cockpit's). The range read therefore also returns each
-- booking's start time and appointment day. Nothing else changes: the
-- campaign range table ignores the two extra keys, and the grants are the
-- ones 20260927j set.
CREATE OR REPLACE FUNCTION public.cockpit_media_statistics(p_kind text,p_campaign text DEFAULT NULL,p_start date DEFAULT NULL,p_end date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; start_day date; end_day date;
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
  SELECT jsonb_build_object('first',min(d.day),'last',max(d.day),'rows',NULL)
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
END;$$;

REVOKE ALL ON FUNCTION public.cockpit_media_statistics(text,text,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_statistics(text,text,date,date) TO authenticated;
