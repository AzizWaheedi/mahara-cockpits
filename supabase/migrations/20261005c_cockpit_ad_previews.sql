BEGIN;
-- All browser access goes through the current confirmed directory actor, never Auth metadata.
CREATE FUNCTION public.cockpit_ad_preview_scope_for_actor(p_actor uuid,p_ad text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members; a public.cockpit_ads; c public.cockpit_campaigns;
 n integer; founder boolean; global_access boolean; winner boolean; client text;
BEGIN
 IF p_ad IS NULL OR p_ad !~ '^[0-9]{5,}$' THEN RAISE EXCEPTION 'A valid Meta ad ID is required';END IF;
 SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users u ON u.id=cm.auth_user_id
 WHERE u.id=p_actor AND cm.active AND u.email_confirmed_at IS NOT NULL AND cm.email=lower(btrim(u.email));
 IF m.auth_user_id IS NULL THEN RAISE EXCEPTION 'Current confirmed membership required' USING ERRCODE='42501';END IF;
 founder:=m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com');
 IF NOT(founder OR m.roles && ARRAY['admin','media_buyer','creative','csm']) THEN
  RAISE EXCEPTION 'Active cockpit access required' USING ERRCODE='42501';END IF;
 global_access:=founder OR 'admin'=ANY(m.roles) OR cardinality(m.clients)=0;
 SELECT EXISTS(SELECT 1 FROM public.cockpit_creative_sources s WHERE s.table_name='winnersArchive'
  AND coalesce(s.data->>'adId',s.data->>'metaAdId')=p_ad) INTO winner;
 SELECT count(*) INTO n FROM public.cockpit_ads WHERE meta_ad_id=p_ad AND NOT source_deleted;
 IF n>1 THEN RAISE EXCEPTION 'Ad ownership is ambiguous; refresh the ad source';END IF;
 IF n=0 THEN
  IF NOT(global_access OR winner) THEN RAISE EXCEPTION 'That client is not on your access list' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('actor',p_actor,'ad',p_ad,'account',NULL,'campaign',NULL,'unrestricted',true,'winner',winner);
 END IF;
 SELECT * INTO a FROM public.cockpit_ads WHERE meta_ad_id=p_ad AND NOT source_deleted;
 SELECT count(*) INTO n FROM public.cockpit_campaigns WHERE raw_data->>'campaignName'=a.campaign_name AND NOT source_deleted;
 IF n<>1 THEN RAISE EXCEPTION 'Campaign ownership is missing or ambiguous; refresh the campaign source';END IF;
 SELECT * INTO c FROM public.cockpit_campaigns WHERE raw_data->>'campaignName'=a.campaign_name AND NOT source_deleted;
 client:=coalesce(nullif(btrim(c.raw_data->>'clientName'),''),nullif(btrim(c.raw_data->>'accountName'),''),c.client_name);
 IF NOT(global_access OR winner OR EXISTS(SELECT 1 FROM unnest(m.clients) name WHERE lower(btrim(name))=lower(btrim(client)))) THEN
  RAISE EXCEPTION 'That client is not on your access list' USING ERRCODE='42501';END IF;
 IF coalesce(regexp_replace(c.meta_account_id,'^act_',''),'') !~ '^[0-9]{5,}$' OR coalesce(c.meta_campaign_id,'') !~ '^[0-9]{5,}$' THEN
  RAISE EXCEPTION 'The campaign Meta identity is missing; refresh the campaign source';END IF;
 RETURN jsonb_build_object('actor',p_actor,'ad',p_ad,'account',regexp_replace(c.meta_account_id,'^act_',''),
  'campaign',c.meta_campaign_id,'unrestricted',global_access OR winner,'winner',winner);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ad_preview_scope_for_actor(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.cockpit_ad_preview_scope(p_ad text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.cockpit_ad_preview_scope_for_actor(auth.uid(),p_ad)
$$;
REVOKE ALL ON FUNCTION public.cockpit_ad_preview_scope(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ad_preview_scope(text) TO authenticated;

CREATE TABLE public.cockpit_ad_preview_cache(
 ad_id text NOT NULL CHECK(ad_id ~ '^[0-9]{5,}$'), format text NOT NULL,
 account_id text NOT NULL CHECK(account_id ~ '^[0-9]{5,}$'), campaign_id text NOT NULL CHECK(campaign_id ~ '^[0-9]{5,}$'),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'), expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(ad_id,format)
);
ALTER TABLE public.cockpit_ad_preview_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_ad_preview_cache FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_ad_preview_cache TO service_role;
CREATE FUNCTION public.cockpit_ad_preview_cache_save(p_actor uuid,p_ad text,p_format text,p_account text,p_campaign text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE scope jsonb; fetched double precision; expires double precision; saved public.cockpit_ad_preview_cache;
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';END IF;
 scope:=public.cockpit_ad_preview_scope_for_actor(p_actor,p_ad);
 IF p_format<>ALL(ARRAY['MOBILE_FEED_STANDARD','DESKTOP_FEED_STANDARD','INSTAGRAM_STANDARD','INSTAGRAM_STORY','INSTAGRAM_REELS','FACEBOOK_STORY_MOBILE','FACEBOOK_REELS_MOBILE'])
  OR p_account IS NULL OR p_account !~ '^[0-9]{5,}$' OR p_campaign IS NULL OR p_campaign !~ '^[0-9]{5,}$'
  OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->'ok' IS DISTINCT FROM 'true'::jsonb
  OR p_payload->>'adId' IS DISTINCT FROM p_ad OR p_payload->>'accountId' IS DISTINCT FROM p_account
  OR coalesce(p_payload->>'src','') !~* '^https://([a-z0-9-]+[.])*(facebook[.]com|instagram[.]com)([/?:]|$)'
  OR coalesce(p_payload->>'src','') ~* '([?&])(access_token|authorization|api_key|token)='
  OR jsonb_typeof(p_payload->'fetchedAt') IS DISTINCT FROM 'number' OR jsonb_typeof(p_payload->'expiresAt') IS DISTINCT FROM 'number'
 THEN RAISE EXCEPTION 'Invalid confirmed Meta preview';END IF;
 IF (scope->>'account' IS NOT NULL AND scope->>'account'<>p_account) OR (scope->>'campaign' IS NOT NULL AND scope->>'campaign'<>p_campaign) THEN
  RAISE EXCEPTION 'Ad ownership changed before caching' USING ERRCODE='42501';END IF;
 fetched:=(p_payload->>'fetchedAt')::double precision;expires:=(p_payload->>'expiresAt')::double precision;
 IF fetched>extract(epoch FROM clock_timestamp())*1000+60000 OR expires<=extract(epoch FROM clock_timestamp())*1000
  OR expires>fetched+20*3600000 OR fetched+20*3600000<=extract(epoch FROM clock_timestamp())*1000 THEN
  RAISE EXCEPTION 'Meta preview is stale or has an invalid expiry';END IF;
 INSERT INTO public.cockpit_ad_preview_cache(ad_id,format,account_id,campaign_id,payload,expires_at)
 VALUES(p_ad,p_format,p_account,p_campaign,p_payload,to_timestamp(expires/1000))
 ON CONFLICT(ad_id,format) DO UPDATE SET account_id=excluded.account_id,campaign_id=excluded.campaign_id,
  payload=excluded.payload,expires_at=excluded.expires_at,updated_at=clock_timestamp() RETURNING * INTO saved;
 -- Preview URLs are bearer links. Audit identity and expiry, never the link or HTML.
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,after)
 SELECT 'preview.cached','cockpit_ad_preview_cache',p_ad,m.email,'shared-cockpits','supabase',
  jsonb_build_object('adId',p_ad,'format',p_format,'accountId',p_account,'campaignId',p_campaign,'expiresAt',expires)
 FROM public.cockpit_members m WHERE m.auth_user_id=p_actor;
 RETURN jsonb_build_object('ok',true,'adId',p_ad,'expiresAt',expires);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ad_preview_cache_save(uuid,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ad_preview_cache_save(uuid,text,text,text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
