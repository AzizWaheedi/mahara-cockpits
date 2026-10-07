BEGIN;
CREATE TABLE IF NOT EXISTS public.cockpit_media_feed_state(
 feed text PRIMARY KEY CHECK(feed IN ('dailyStats','bookingEvents')),
 ready boolean NOT NULL DEFAULT false, source_snapshot_at timestamptz,
 source_rows bigint, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.cockpit_media_feed_state(feed) VALUES('dailyStats'),('bookingEvents') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.cockpit_media_daily_stats(
 source_deployment text NOT NULL, source_id text NOT NULL,
 campaign_name text NOT NULL, day date NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_deployment,source_id),
 CHECK(data ?& ARRAY['campaignName','date','spend','leads','impressions','linkClicks']),
 CHECK(data->>'campaignName'=campaign_name),CHECK((data->>'date')::date=day),
 CHECK(jsonb_typeof(data->'spend')='number' AND (data->>'spend')::numeric>=0),
 CHECK(jsonb_typeof(data->'leads')='number' AND (data->>'leads')::numeric>=0),
 CHECK(jsonb_typeof(data->'impressions')='number' AND (data->>'impressions')::numeric>=0),
 CHECK(jsonb_typeof(data->'linkClicks')='number' AND (data->>'linkClicks')::numeric>=0)
);
CREATE TABLE IF NOT EXISTS public.cockpit_media_booking_events(
 source_deployment text NOT NULL, source_id text NOT NULL,
 campaign_name text NOT NULL, day date NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_deployment,source_id),
 CHECK(data->>'campaignName'=campaign_name),CHECK((data->>'date')::date=day)
);
CREATE INDEX IF NOT EXISTS cockpit_media_daily_campaign_day ON public.cockpit_media_daily_stats(campaign_name,day);
CREATE INDEX IF NOT EXISTS cockpit_media_daily_day ON public.cockpit_media_daily_stats(day);
CREATE INDEX IF NOT EXISTS cockpit_media_bookings_campaign_day ON public.cockpit_media_booking_events(campaign_name,day);
ALTER TABLE public.cockpit_media_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_media_booking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_media_feed_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_media_daily_stats,public.cockpit_media_booking_events,public.cockpit_media_feed_state FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_media_daily_stats,public.cockpit_media_booking_events,public.cockpit_media_feed_state TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_media_feed_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
 VALUES(TG_OP,TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'source_id',to_jsonb(NEW)->>'feed'),
 'media-feed-import','media-buyer','supabase',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS cockpit_media_daily_audit ON public.cockpit_media_daily_stats;
CREATE TRIGGER cockpit_media_daily_audit AFTER INSERT OR UPDATE ON public.cockpit_media_daily_stats FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_feed_audit();
DROP TRIGGER IF EXISTS cockpit_media_booking_audit ON public.cockpit_media_booking_events;
CREATE TRIGGER cockpit_media_booking_audit AFTER INSERT OR UPDATE ON public.cockpit_media_booking_events FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_feed_audit();
DROP TRIGGER IF EXISTS cockpit_media_feed_state_audit ON public.cockpit_media_feed_state;
CREATE TRIGGER cockpit_media_feed_state_audit AFTER INSERT OR UPDATE ON public.cockpit_media_feed_state FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_feed_audit();

CREATE OR REPLACE FUNCTION public.cockpit_media_campaign_allowed(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
 WHERE m.auth_user_id=auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL
 AND m.email=lower(btrim(u.email))
 AND ('media_buyer'=ANY(m.roles) OR 'admin'=ANY(m.roles) OR public.cockpit_is_ceo())
 AND EXISTS(SELECT 1 FROM public.cockpit_campaigns c WHERE c.raw_data->>'campaignName'=p_name)
 AND NOT EXISTS(SELECT 1 FROM public.cockpit_campaigns c WHERE c.raw_data->>'campaignName'=p_name
  AND NOT ('admin'=ANY(m.roles) OR public.cockpit_is_ceo() OR cardinality(m.clients)=0 OR EXISTS(
   SELECT 1 FROM unnest(m.clients) AS allowed(client) WHERE lower(btrim(allowed.client))=lower(btrim(coalesce(nullif(c.raw_data->>'clientName',''),nullif(c.raw_data->>'accountName',''),c.client_name)))
  ))));
$$;

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
   'bookings',coalesce((SELECT jsonb_agg(jsonb_build_object('campaignName',campaign_name,'date',day,'status',data->>'status','adId',data->>'adId') ORDER BY day,source_id) FROM public.cockpit_media_booking_events WHERE campaign_name=p_campaign AND day BETWEEN p_start AND p_end),'[]'::jsonb)
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
REVOKE ALL ON FUNCTION public.cockpit_media_feed_audit(),public.cockpit_media_campaign_allowed(text),public.cockpit_media_statistics(text,text,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_statistics(text,text,date,date) TO authenticated;

-- Bounded read-back avoids downloading all private booking records repeatedly.
CREATE OR REPLACE FUNCTION public.cockpit_verify_media_import(p_table text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE matched bigint; total bigint;
BEGIN
 IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>1000 THEN RAISE EXCEPTION 'At most 1000 verification rows';END IF;
 IF p_table='cockpit_media_daily_stats' THEN
  SELECT count(*) INTO matched FROM jsonb_to_recordset(p_rows) AS e(source_deployment text,source_id text,campaign_name text,day date,data jsonb)
  JOIN public.cockpit_media_daily_stats t USING(source_deployment,source_id,campaign_name,day) WHERE t.data=e.data;
  SELECT count(*) INTO total FROM public.cockpit_media_daily_stats WHERE source_deployment='adorable-seahorse-418';
 ELSIF p_table='cockpit_media_booking_events' THEN
  SELECT count(*) INTO matched FROM jsonb_to_recordset(p_rows) AS e(source_deployment text,source_id text,campaign_name text,day date,data jsonb)
  JOIN public.cockpit_media_booking_events t USING(source_deployment,source_id,campaign_name,day) WHERE t.data=e.data;
  SELECT count(*) INTO total FROM public.cockpit_media_booking_events WHERE source_deployment='adorable-seahorse-418';
 ELSE RAISE EXCEPTION 'Unsupported verification table';END IF;
 RETURN jsonb_build_object('matched',matched,'total',total);
END;$$;
REVOKE ALL ON FUNCTION public.cockpit_verify_media_import(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_verify_media_import(text,jsonb) TO service_role;
COMMIT;
