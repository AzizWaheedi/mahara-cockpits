-- Require a shared verified owner generation and matching per-row sync time
-- for native-ID fallback. Retain fail-closed identity and account checks.
CREATE OR REPLACE FUNCTION public.cockpit_media_native_catalog_read(p_operation text,p_args jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE source text; feed public.cockpit_creative_source_state; rows jsonb; same jsonb; rest jsonb;
BEGIN
 PERFORM public.cockpit_media_scope('board.adStatusOptions',NULL);
 IF p_operation='cockpit.onboardings' THEN RETURN public.cockpit_media_native_source('onboardings')->'rows'; END IF;
 IF p_operation='cockpit.launchWatch' THEN RETURN public.cockpit_media_native_source('launchWatch')->'rows'; END IF;
 IF p_operation<>'cockpit.winners' THEN RAISE EXCEPTION 'Unsupported native catalog read'; END IF;
 FOREACH source IN ARRAY ARRAY['campaigns','ads'] LOOP
  SELECT * INTO feed FROM public.cockpit_creative_source_state WHERE table_name=source;
  IF feed.ready IS DISTINCT FROM true OR feed.row_count IS NULL OR feed.source_snapshot_at IS NULL OR feed.row_count<>(SELECT count(*) FROM public.cockpit_creative_sources WHERE table_name=source AND source_snapshot_at=feed.source_snapshot_at) THEN RAISE EXCEPTION 'The % source is not verified',source; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT source_snapshot_at) FROM public.cockpit_creative_source_state
     WHERE table_name IN ('campaigns','ads')) <> 1 THEN
  RAISE EXCEPTION 'Campaign and ad owner snapshots differ; refresh both verified sources';
 END IF;
 -- A synthetic mirror ID does not equal the verified source's Convex ID.
 -- The stable Meta ad/campaign ID is acceptable only when it uniquely names
 -- one row in the current verified snapshot. The final client/account checks
 -- still reject a wrong or ambiguous owner.
 IF EXISTS(
  SELECT 1 FROM public.cockpit_ads a
  LEFT JOIN public.cockpit_creative_source_state af ON af.table_name='ads'
  LEFT JOIN public.cockpit_creative_sources ads ON ads.table_name='ads' AND ads.source_snapshot_at=af.source_snapshot_at
   AND ((ads.source_id=a.raw_data->>'_id' OR (nullif(a.meta_ad_id,'') IS NOT NULL AND ads.data->>'metaAdId'=a.meta_ad_id AND ads.data->>'syncedAt' IS NOT NULL AND ads.data->>'syncedAt'=a.raw_data->>'syncedAt' AND ads.data->>'campaignName'=a.campaign_name)) AND (nullif(ads.data->>'metaAdId','') IS NULL OR nullif(a.meta_ad_id,'') IS NULL OR ads.data->>'metaAdId'=a.meta_ad_id))
  WHERE NOT a.source_deleted AND a.leads>0 AND a.spend>=45
  AND coalesce((a.raw_data->>'cpl')::numeric,a.spend/nullif(a.leads,0))<=15
  AND (ads.source_id IS NULL OR cardinality(ads.client_names)<>1
   OR (SELECT count(*) FROM public.cockpit_creative_sources x WHERE x.table_name='ads' AND x.source_snapshot_at=af.source_snapshot_at
     AND ((x.source_id=a.raw_data->>'_id' OR (nullif(a.meta_ad_id,'') IS NOT NULL AND x.data->>'metaAdId'=a.meta_ad_id AND x.data->>'syncedAt' IS NOT NULL AND x.data->>'syncedAt'=a.raw_data->>'syncedAt' AND x.data->>'campaignName'=a.campaign_name)) AND (nullif(x.data->>'metaAdId','') IS NULL OR nullif(a.meta_ad_id,'') IS NULL OR x.data->>'metaAdId'=a.meta_ad_id)))<>1
   OR (SELECT count(*) FROM public.cockpit_campaigns c WHERE NOT c.source_deleted AND c.raw_data->>'campaignName'=a.campaign_name)<>1
   OR NOT EXISTS(
    SELECT 1 FROM public.cockpit_campaigns c
    JOIN public.cockpit_creative_source_state cf ON cf.table_name='campaigns'
    JOIN public.cockpit_creative_sources cs ON cs.table_name='campaigns' AND cs.source_snapshot_at=cf.source_snapshot_at
     AND ((cs.source_id=c.raw_data->>'_id' OR (nullif(c.meta_campaign_id,'') IS NOT NULL AND cs.data->>'metaCampaignId'=c.meta_campaign_id AND cs.data->>'syncedAt' IS NOT NULL AND cs.data->>'syncedAt'=c.raw_data->>'syncedAt' AND cs.data->>'campaignName'=c.raw_data->>'campaignName' AND regexp_replace(coalesce(cs.data->>'metaAccountId',''),'^act_','')=regexp_replace(c.meta_account_id,'^act_',''))) AND (nullif(cs.data->>'metaCampaignId','') IS NULL OR nullif(c.meta_campaign_id,'') IS NULL OR cs.data->>'metaCampaignId'=c.meta_campaign_id))
    WHERE NOT c.source_deleted AND c.raw_data->>'campaignName'=a.campaign_name
    AND cardinality(cs.client_names)=1
    AND (SELECT count(*) FROM public.cockpit_creative_sources x WHERE x.table_name='campaigns' AND x.source_snapshot_at=cf.source_snapshot_at
      AND ((x.source_id=c.raw_data->>'_id' OR (nullif(c.meta_campaign_id,'') IS NOT NULL AND x.data->>'metaCampaignId'=c.meta_campaign_id AND x.data->>'syncedAt' IS NOT NULL AND x.data->>'syncedAt'=c.raw_data->>'syncedAt' AND x.data->>'campaignName'=c.raw_data->>'campaignName' AND regexp_replace(coalesce(x.data->>'metaAccountId',''),'^act_','')=regexp_replace(c.meta_account_id,'^act_',''))) AND (nullif(x.data->>'metaCampaignId','') IS NULL OR nullif(c.meta_campaign_id,'') IS NULL OR x.data->>'metaCampaignId'=c.meta_campaign_id)))=1
    AND lower(btrim(ads.client_names[1]))=lower(btrim(coalesce(c.raw_data->>'clientName',c.raw_data->>'accountName',c.client_name)))
    AND lower(btrim(cs.client_names[1]))=lower(btrim(ads.client_names[1]))
    AND (nullif(ads.data->>'campaignName','') IS NULL OR ads.data->>'campaignName'=a.campaign_name)
    AND (nullif(ads.data->>'metaAccountId','') IS NULL OR regexp_replace(ads.data->>'metaAccountId','^act_','')=regexp_replace(c.meta_account_id,'^act_',''))
    AND (nullif(cs.data->>'campaignName','') IS NULL OR cs.data->>'campaignName'=a.campaign_name)
    AND regexp_replace(coalesce(c.meta_account_id,''),'^act_','')~'^[0-9]+$'
    AND (nullif(cs.data->>'metaAccountId','') IS NULL OR regexp_replace(cs.data->>'metaAccountId','^act_','')=regexp_replace(c.meta_account_id,'^act_',''))
    AND (nullif(c.raw_data->>'metaAccountId','') IS NULL OR regexp_replace(c.raw_data->>'metaAccountId','^act_','')=regexp_replace(c.meta_account_id,'^act_',''))
   ))
 ) THEN RAISE EXCEPTION 'Winner ownership mapping is missing or ambiguous. Refresh the verified campaign and ad sources before opening winners.'; END IF;
 SELECT coalesce(jsonb_agg(item ORDER BY coalesce(cpb,9999),cpl),'[]') INTO rows FROM(
  SELECT jsonb_strip_nulls(jsonb_build_object(
   '_id',a.raw_data->>'_id','adName',a.ad_name,'campaignName',a.campaign_name,
   'clientName',coalesce(c.raw_data->>'clientName',c.raw_data->>'accountName',c.client_name),
   'serviceType',c.raw_data->'serviceType','thumbnailUrl',a.thumbnail_url,'metaAdId',a.meta_ad_id,
   'accountId',c.meta_account_id,'stillKey',a.raw_data->'stillKey','stillUrl',a.still_url,'stillTinyUrl',a.raw_data->'stillTinyUrl',
   'spend',a.spend,'leads',a.leads,'cpl',coalesce((a.raw_data->>'cpl')::numeric,a.spend/nullif(a.leads,0)),
   'linkCtr',a.raw_data->'linkCtr','cpm',a.raw_data->'cpm','optInRate',a.raw_data->'optInRate',
   'costPerBooking',c.raw_data->'costPerBooking','bookingRate',c.raw_data->'bookingRate')) item,
   (c.raw_data->>'costPerBooking')::numeric cpb,coalesce((a.raw_data->>'cpl')::numeric,a.spend/nullif(a.leads,0)) cpl
  FROM public.cockpit_ads a JOIN public.cockpit_campaigns c ON c.raw_data->>'campaignName'=a.campaign_name
  WHERE NOT a.source_deleted AND NOT c.source_deleted AND a.leads>0 AND a.spend>=45
  AND EXISTS(SELECT 1 FROM public.cockpit_creative_sources s JOIN public.cockpit_creative_source_state f ON f.table_name=s.table_name AND f.source_snapshot_at=s.source_snapshot_at WHERE s.table_name='ads' AND ((s.source_id=a.raw_data->>'_id' OR (nullif(a.meta_ad_id,'') IS NOT NULL AND s.data->>'metaAdId'=a.meta_ad_id AND s.data->>'syncedAt' IS NOT NULL AND s.data->>'syncedAt'=a.raw_data->>'syncedAt' AND s.data->>'campaignName'=a.campaign_name)) AND (nullif(s.data->>'metaAdId','') IS NULL OR nullif(a.meta_ad_id,'') IS NULL OR s.data->>'metaAdId'=a.meta_ad_id)) AND f.ready AND cardinality(s.client_names)=1 AND lower(btrim(s.client_names[1]))=lower(btrim(coalesce(c.raw_data->>'clientName',c.raw_data->>'accountName',c.client_name))) AND public.cockpit_ask_ai_owner_allowed(auth.uid(),'media-buyer',s.client_names[1]))
  AND EXISTS(SELECT 1 FROM public.cockpit_creative_sources s JOIN public.cockpit_creative_source_state f ON f.table_name=s.table_name AND f.source_snapshot_at=s.source_snapshot_at WHERE s.table_name='campaigns' AND ((s.source_id=c.raw_data->>'_id' OR (nullif(c.meta_campaign_id,'') IS NOT NULL AND s.data->>'metaCampaignId'=c.meta_campaign_id AND s.data->>'syncedAt' IS NOT NULL AND s.data->>'syncedAt'=c.raw_data->>'syncedAt' AND s.data->>'campaignName'=c.raw_data->>'campaignName' AND regexp_replace(coalesce(s.data->>'metaAccountId',''),'^act_','')=regexp_replace(c.meta_account_id,'^act_',''))) AND (nullif(s.data->>'metaCampaignId','') IS NULL OR nullif(c.meta_campaign_id,'') IS NULL OR s.data->>'metaCampaignId'=c.meta_campaign_id)) AND f.ready AND cardinality(s.client_names)=1 AND lower(btrim(s.client_names[1]))=lower(btrim(coalesce(c.raw_data->>'clientName',c.raw_data->>'accountName',c.client_name))))
  AND coalesce((a.raw_data->>'cpl')::numeric,a.spend/nullif(a.leads,0))<=15
  AND public.cockpit_ask_ai_owner_allowed(auth.uid(),'media-buyer',coalesce(c.raw_data->>'clientName',c.raw_data->>'accountName',c.client_name))
 ) q;
 SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]') INTO same FROM(SELECT value,ordinality FROM jsonb_array_elements(rows) WITH ORDINALITY WHERE nullif(p_args->>'serviceType','') IS NOT NULL AND value->>'serviceType'=p_args->>'serviceType' LIMIT 8) q;
 SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]') INTO rest FROM(SELECT value,ordinality FROM jsonb_array_elements(rows) WITH ORDINALITY WHERE nullif(p_args->>'serviceType','') IS NULL OR value->>'serviceType' IS DISTINCT FROM p_args->>'serviceType' LIMIT 12) q;
 RETURN jsonb_build_object('sameLine',same,'rest',rest);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_native_catalog_read(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_media_native_catalog_read(text,jsonb) TO authenticated;
