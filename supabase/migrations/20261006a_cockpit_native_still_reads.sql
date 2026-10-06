BEGIN;
CREATE FUNCTION public.cockpit_native_stills_read(p_keys text[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members;k text;s public.cockpit_native_stills;ad text;creative text;scope jsonb;matches bigint;current_creative text;
 items jsonb[]:='{}';problem text;url text;tiny text;missing boolean;ready boolean;
 native_url constant text:='^https://bldgtotkfmhoxmlzowdx[.]supabase[.]co/storage/v1/object/public/cockpit-ad-stills/([a-f0-9]{64}/)?[a-f0-9]{64}$';
BEGIN
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated' THEN RAISE EXCEPTION 'Sign in before loading saved images' USING ERRCODE='42501';END IF;
 SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users u ON u.id=cm.auth_user_id
 WHERE cm.auth_user_id=auth.uid() AND cm.active AND u.email_confirmed_at IS NOT NULL AND cm.email=lower(btrim(u.email));
 IF m.auth_user_id IS NULL OR NOT(m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com') OR m.roles&&ARRAY['admin','media_buyer','creative','csm']) THEN RAISE EXCEPTION 'Current confirmed cockpit access is required' USING ERRCODE='42501';END IF;
 IF cardinality(p_keys)>200 THEN RAISE EXCEPTION 'Request at most 200 saved images per batch';END IF;
 SELECT EXISTS(SELECT 1 FROM public.cockpit_native_media_runs r WHERE r.status='published' AND jsonb_typeof(r.plan->'tables'->'adStills')='array') INTO ready;
 FOR k IN SELECT DISTINCT requested FROM unnest(coalesce(p_keys,'{}')) requested LOOP
  problem:=NULL;url:=NULL;tiny:=NULL;missing:=false;ad:=NULL;creative:=NULL;
  IF k IS NULL OR k!~'^[ca]:[0-9]{5,25}$' THEN RAISE EXCEPTION 'A valid saved-image key is required';END IF;
  SELECT * INTO s FROM public.cockpit_native_stills WHERE key=k;
  IF NOT FOUND THEN
   missing:=ready;IF NOT ready THEN problem:='The saved-image source has not published. Refresh the native media worker.';END IF;
  ELSE
   IF s.data->>'status' IS DISTINCT FROM 'saved' THEN
    missing:=s.data->>'status'='gone';problem:=CASE WHEN missing THEN NULL ELSE 'This image has not been saved. Refresh the native media worker.' END;
   ELSE
    IF k LIKE 'a:%' THEN
     ad:=substr(k,3);
     IF nullif(s.data->>'adId','') IS NOT NULL AND s.data->>'adId' IS DISTINCT FROM ad THEN problem:='The saved image belongs to another ad. Refresh its source.';END IF;
    ELSE
     creative:=substr(k,3);
     IF nullif(s.data->>'creativeId','') IS NOT NULL AND s.data->>'creativeId' IS DISTINCT FROM creative THEN problem:='The saved creative identity changed. Refresh its source.';END IF;
     ad:=nullif(s.data->>'adId','');
     IF ad IS NULL THEN
      SELECT count(DISTINCT candidate),min(candidate) INTO matches,ad FROM(
       SELECT a.meta_ad_id candidate FROM public.cockpit_ads a WHERE NOT a.source_deleted AND a.raw_data->>'creativeId'=creative
       UNION ALL SELECT coalesce(w.data->>'adId',w.data->>'metaAdId') FROM public.cockpit_creative_sources w WHERE w.table_name='winnersArchive' AND w.data->>'creativeId'=creative
      ) mappings WHERE candidate IS NOT NULL;
      IF matches<>1 THEN problem:='The creative-to-ad mapping is missing or ambiguous. Refresh its source.';END IF;
     END IF;
     SELECT count(*),max(a.raw_data->>'creativeId') INTO matches,current_creative FROM public.cockpit_ads a WHERE NOT a.source_deleted AND a.meta_ad_id=ad;
     IF matches>1 OR (matches=1 AND current_creative IS DISTINCT FROM creative) THEN problem:='The current ad creative is missing or changed. Refresh its source.';END IF;
    END IF;
    IF problem IS NULL THEN
     BEGIN scope:=public.cockpit_ad_preview_scope_for_actor(auth.uid(),ad);
     EXCEPTION WHEN insufficient_privilege OR raise_exception THEN problem:=SQLERRM;END;
    END IF;
    IF problem IS NULL THEN
     url:=s.data->>'url';tiny:=s.data->>'tinyUrl';
     IF (url IS NOT NULL AND url!~native_url) OR (tiny IS NOT NULL AND tiny!~native_url) OR (url IS NULL AND tiny IS NULL) THEN
      url:=NULL;tiny:=NULL;problem:='The saved native image URL is missing or invalid. Refresh its source.';
     END IF;
    END IF;
   END IF;
  END IF;
  items:=array_append(items,jsonb_build_object('key',k,'url',url,'tinyUrl',tiny,'missing',missing,'error',problem));
 END LOOP;
 RETURN jsonb_build_object('ok',true,'stills',to_jsonb(items));
END $$;
REVOKE ALL ON FUNCTION public.cockpit_native_stills_read(text[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_native_stills_read(text[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
