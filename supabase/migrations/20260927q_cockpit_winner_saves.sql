BEGIN;
CREATE TABLE IF NOT EXISTS public.cockpit_winner_save_state(id boolean PRIMARY KEY DEFAULT true CHECK(id),history_ready boolean NOT NULL DEFAULT false,source_snapshot_at timestamptz);
INSERT INTO public.cockpit_winner_save_state(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.cockpit_winner_saves(
 ad_id text PRIMARY KEY,campaign_name text NOT NULL,client_name text NOT NULL,
 saved_by text NOT NULL,saved_by_name text NOT NULL,saved_at timestamptz NOT NULL,
 note text,stats jsonb NOT NULL,window_start date NOT NULL,window_end date NOT NULL,
 unsaved_at timestamptz,unsaved_by text,source_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.cockpit_winner_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_winner_save_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_winner_saves,public.cockpit_winner_save_state FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_winner_saves,public.cockpit_winner_save_state TO service_role;
ALTER TABLE public.winner_ads ADD COLUMN IF NOT EXISTS cockpit_manual_only boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.cockpit_winner_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,before,after)
 VALUES(lower(TG_OP),'winner_save',NEW.ad_id,CASE WHEN NEW.unsaved_at IS NOT NULL THEN NEW.unsaved_by ELSE NEW.saved_by END,'media_buyer',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cockpit_winner_save_audit ON public.cockpit_winner_saves;
CREATE TRIGGER cockpit_winner_save_audit AFTER INSERT OR UPDATE ON public.cockpit_winner_saves FOR EACH ROW EXECUTE FUNCTION public.cockpit_winner_audit();

CREATE OR REPLACE FUNCTION public.cockpit_winner_saved_visible(p_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (public.cockpit_has_role('media_buyer') OR public.cockpit_has_role('creative') OR public.cockpit_has_role('editor') OR public.cockpit_is_ceo())
 AND EXISTS(SELECT 1 FROM public.cockpit_winner_saves s WHERE s.ad_id=p_id AND s.unsaved_at IS NULL);
$$;
-- Removing a manual save does not delete the mirrored file or any automated winner.
DROP POLICY IF EXISTS cockpit_winner_withdrawn_guard ON public.winner_ads;
CREATE POLICY cockpit_winner_withdrawn_guard ON public.winner_ads AS RESTRICTIVE FOR SELECT TO authenticated USING(NOT cockpit_manual_only OR public.cockpit_winner_saved_visible(ad_id));

CREATE OR REPLACE FUNCTION public.cockpit_winner_numbers(p_campaign text,p_id text,p_start date,p_end date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH totals AS(
 SELECT sum((data->>'spend')::numeric) spend,sum((data->>'leads')::numeric) leads,sum((data->>'impressions')::numeric) impressions,sum((data->>'linkClicks')::numeric) clicks,max((data->>'frequency')::numeric) frequency,count(*) rows
 FROM public.cockpit_media_daily_stats WHERE campaign_name=p_campaign AND day BETWEEN p_start AND p_end AND data->>'metaAdId'=p_id
 ), bookings AS(
 SELECT count(*) FILTER(WHERE data->>'adId'=p_id) n,count(*) FILTER(WHERE data->>'adId'=p_id AND data->>'status'='showed') showed,bool_or(nullif(data->>'adId','') IS NOT NULL) attributed FROM public.cockpit_media_booking_events WHERE campaign_name=p_campaign AND day BETWEEN p_start AND p_end
 ) SELECT jsonb_strip_nulls(jsonb_build_object('spend',round(t.spend,2),'leads',t.leads,'cpl',CASE WHEN t.leads>0 THEN round(t.spend/t.leads,2) END,'impressions',t.impressions,'linkClicks',t.clicks,'linkCtr',CASE WHEN t.impressions>=1000 THEN round(t.clicks/t.impressions*100,2) END,'cpm',CASE WHEN t.impressions>=1000 THEN round(t.spend/t.impressions*1000,2) END,'optInRate',CASE WHEN t.clicks>=50 THEN round(t.leads/t.clicks*100,2) END,'frequency',t.frequency,'bookings',b.n,'showed',b.showed,'costPerBooking',CASE WHEN b.n>0 THEN round(t.spend/b.n,2) END,'bookingsAttributed',coalesce(b.attributed,false),'rows',t.rows)) FROM totals t CROSS JOIN bookings b;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_winner_preview(p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE campaign text:=p_args->>'campaignName';start_day date:=(p_args->>'start')::date;end_day date:=(p_args->>'end')::date;candidates jsonb;picked text;stats jsonb;widened boolean:=false;
BEGIN
 IF NOT public.cockpit_media_campaign_allowed(campaign) THEN RAISE EXCEPTION 'Campaign is outside your assigned clients' USING ERRCODE='42501'; END IF;
 IF start_day IS NULL OR end_day IS NULL OR start_day>end_day OR end_day-start_day>=400 THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
 IF (SELECT count(*) FROM public.cockpit_media_feed_state WHERE feed IN('dailyStats','bookingEvents') AND ready)<>2 THEN RAISE EXCEPTION 'Ad and booking histories must be imported and verified first'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('adId',id,'name',name) ORDER BY id),'[]') INTO candidates FROM(
 SELECT data->>'metaAdId' id,max(data->>'adName') name FROM public.cockpit_media_daily_stats
 WHERE campaign_name=campaign AND data->>'metaAdId' ~ '^[0-9]{5,25}$' AND (data->>'adName'=p_args->>'adName' OR data->>'metaAdId'=p_args->>'adId' OR coalesce(p_args->'adIds','[]'::jsonb)?(data->>'metaAdId')) GROUP BY data->>'metaAdId' LIMIT 20) x;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(candidates) x WHERE x->>'adId'=p_args->>'adId') THEN picked:=p_args->>'adId';ELSIF jsonb_array_length(candidates)=1 THEN picked:=candidates->0->>'adId'; END IF;
 IF picked IS NULL THEN RETURN jsonb_build_object('candidates',candidates,'problem',CASE WHEN jsonb_array_length(candidates)=0 THEN 'This ad has no identified source records yet. Refresh its data first.' END); END IF;
 stats:=public.cockpit_winner_numbers(campaign,picked,start_day,end_day);
 IF coalesce((stats->>'leads')::numeric,0)=0 THEN start_day:=end_day-89;widened:=true;stats:=public.cockpit_winner_numbers(campaign,picked,start_day,end_day);END IF;
 RETURN jsonb_strip_nulls(jsonb_build_object('candidates',candidates,'adId',picked,'stats',stats,'window',jsonb_build_object('start',start_day,'end',end_day,'label',CASE WHEN widened THEN 'Last 90 days' END),'widened',widened,'problem',CASE WHEN coalesce((stats->>'rows')::int,0)=0 THEN 'No identified ad records in this period. Refresh its data first.' WHEN coalesce((stats->>'leads')::numeric,0)=0 THEN 'No leads recorded for this ad in its last 90 days.' END));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_winner_save(p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE preview jsonb;email text;label text;client text;ad text:=p_args->>'adId';prior public.cockpit_winner_saves;ad_name text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_winner_save_state WHERE history_ready) THEN RAISE EXCEPTION 'Saved-winner history has not been imported and verified yet'; END IF;
 preview:=public.cockpit_winner_preview(p_args);
 IF preview->>'problem' IS NOT NULL OR preview->>'adId' IS DISTINCT FROM ad THEN RAISE EXCEPTION '%',coalesce(preview->>'problem','Choose the ad to save'); END IF;
 SELECT lower(btrim(u.email)),coalesce(nullif(btrim(m.name),''),split_part(u.email,'@',1)) INTO email,label FROM auth.users u JOIN public.cockpit_members m ON m.auth_user_id=u.id WHERE u.id=auth.uid();
 SELECT c.client_name INTO client FROM public.cockpit_campaigns c WHERE c.raw_data->>'campaignName'=p_args->>'campaignName' LIMIT 1;
 SELECT x->>'name' INTO ad_name FROM jsonb_array_elements(preview->'candidates') x WHERE x->>'adId'=ad;
 PERFORM pg_advisory_xact_lock(hashtextextended('winner:'||ad,0));
 SELECT * INTO prior FROM public.cockpit_winner_saves WHERE ad_id=ad FOR UPDATE;
 IF prior.ad_id IS NOT NULL AND prior.campaign_name<>p_args->>'campaignName' THEN RAISE EXCEPTION 'This ad was saved under another campaign'; END IF;
 IF prior.ad_id IS NOT NULL AND prior.unsaved_at IS NULL THEN
  IF p_args ? 'note' AND nullif(left(btrim(p_args->>'note'),500),'') IS DISTINCT FROM prior.note THEN RAISE EXCEPTION 'This ad is already saved with another note. Remove the save before replacing it'; END IF;
  RETURN jsonb_build_object('ok',true,'adId',ad,'created',false);
 END IF;
 INSERT INTO public.cockpit_winner_saves(ad_id,campaign_name,client_name,saved_by,saved_by_name,saved_at,note,stats,window_start,window_end)
 VALUES(ad,p_args->>'campaignName',client,email,label,now(),coalesce(nullif(left(btrim(p_args->>'note'),500),''),prior.note),preview->'stats',(preview->'window'->>'start')::date,(preview->'window'->>'end')::date)
 ON CONFLICT(ad_id) DO UPDATE SET saved_by=excluded.saved_by,saved_by_name=excluded.saved_by_name,saved_at=excluded.saved_at,note=excluded.note,stats=excluded.stats,window_start=excluded.window_start,window_end=excluded.window_end,unsaved_at=NULL,unsaved_by=NULL;
 INSERT INTO public.winner_ads(ad_id,ad_name,client,spend,leads,cpl,origin,first_seen_at,last_seen_at,cockpit_manual_only)
 VALUES(ad,ad_name,client,(preview->'stats'->>'spend')::numeric,(preview->'stats'->>'leads')::int,(preview->'stats'->>'cpl')::numeric,'manual',now(),now(),true)
 ON CONFLICT(ad_id) DO NOTHING;
 RETURN jsonb_build_object('ok',true,'adId',ad,'created',prior.ad_id IS NULL);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_winner_unsave(p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_winner_saves;email text;
BEGIN
 IF NOT (public.cockpit_has_role('media_buyer') OR public.cockpit_is_ceo()) THEN RAISE EXCEPTION 'Media buyer access required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_winner_save_state WHERE history_ready) THEN RAISE EXCEPTION 'Saved-winner history has not been imported and verified yet'; END IF;
 SELECT * INTO r FROM public.cockpit_winner_saves WHERE ad_id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'changed',false); END IF;
 IF NOT public.cockpit_media_campaign_allowed(r.campaign_name) THEN RAISE EXCEPTION 'Campaign is outside your assigned clients' USING ERRCODE='42501'; END IF;
 IF r.unsaved_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'changed',false); END IF;
 SELECT lower(btrim(u.email)) INTO email FROM auth.users u WHERE u.id=auth.uid();
 UPDATE public.cockpit_winner_saves SET unsaved_at=greatest(now(),saved_at),unsaved_by=email WHERE ad_id=p_id;
 RETURN jsonb_build_object('ok',true,'changed',true);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_winner_saved_in(p_ids text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT (public.cockpit_has_role('media_buyer') OR public.cockpit_is_ceo()) THEN RAISE EXCEPTION 'Media buyer access required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_winner_save_state WHERE history_ready) THEN RAISE EXCEPTION 'Saved-winner history has not been imported and verified yet'; END IF;
 IF cardinality(p_ids)>300 THEN RAISE EXCEPTION 'Read at most 300 ads at once'; END IF;
 SELECT coalesce(jsonb_object_agg(w.ad_id,jsonb_strip_nulls(jsonb_build_object('saved',s.ad_id IS NOT NULL AND s.unsaved_at IS NULL,'savedBy',CASE WHEN s.unsaved_at IS NULL THEN s.saved_by END,'savedByName',CASE WHEN s.unsaved_at IS NULL THEN s.saved_by_name END,'savedAt',CASE WHEN s.unsaved_at IS NULL THEN extract(epoch FROM s.saved_at)*1000 END,'auto',NOT w.cockpit_manual_only))),'{}') INTO result
 FROM public.winner_ads w LEFT JOIN public.cockpit_winner_saves s ON s.ad_id=w.ad_id
 WHERE w.ad_id=ANY(p_ids) AND public.cockpit_client_allowed(w.client) AND (NOT w.cockpit_manual_only OR s.unsaved_at IS NULL AND s.ad_id IS NOT NULL);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_winner_audit(),public.cockpit_winner_saved_visible(text),public.cockpit_winner_numbers(text,text,date,date),public.cockpit_winner_preview(jsonb),public.cockpit_winner_save(jsonb),public.cockpit_winner_unsave(text),public.cockpit_winner_saved_in(text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_winner_saved_visible(text),public.cockpit_winner_preview(jsonb),public.cockpit_winner_save(jsonb),public.cockpit_winner_unsave(text),public.cockpit_winner_saved_in(text[]) TO authenticated;
COMMIT;
