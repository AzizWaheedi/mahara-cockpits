-- Refresh provenance on every publish; audit full payloads only when the source content changes.
-- No table rewrite, index build, historical audit deletion, or trigger disabling.
BEGIN;
CREATE OR REPLACE FUNCTION public.cockpit_creative_source_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='cockpit_creative_sources' THEN
  IF (to_jsonb(OLD)-'source_snapshot_at') IS NOT DISTINCT FROM (to_jsonb(NEW)-'source_snapshot_at') THEN RETURN NEW; END IF;
 END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,before,after)
 VALUES(lower(TG_OP),'creative_source',NEW.table_name||':'||NEW.source_id,'creative',
  CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_csm_source_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='cockpit_csm_sources' THEN
  IF (to_jsonb(OLD)-'source_snapshot_at') IS NOT DISTINCT FROM (to_jsonb(NEW)-'source_snapshot_at') THEN RETURN NEW; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,before,after)
 VALUES(lower(TG_OP),'csm_source',NEW.table_name||coalesce(':'||(to_jsonb(NEW)->>'source_id'),''),'client-success',
  CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_media_source_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='cockpit_media_sources' THEN
  IF (to_jsonb(OLD)-'source_snapshot_at') IS NOT DISTINCT FROM (to_jsonb(NEW)-'source_snapshot_at') THEN RETURN NEW; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
 VALUES(TG_OP,TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'source_id',to_jsonb(NEW)->>'table_name'),
  'source-import','media-buyer','supabase',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_media_feed_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME IN ('cockpit_media_daily_stats','cockpit_media_booking_events') THEN
  IF (to_jsonb(OLD)-'imported_at') IS NOT DISTINCT FROM (to_jsonb(NEW)-'imported_at') THEN RETURN NEW; END IF;
 END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
 VALUES(TG_OP,TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'source_id',to_jsonb(NEW)->>'feed'),
  'media-feed-import','media-buyer','supabase',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_native_mirrors(p_table text,p_rows jsonb,p_stamp timestamptz) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE item jsonb; proposed jsonb; old jsonb; matches jsonb; key jsonb; old_projection jsonb; k text; v jsonb; cols text; assigns text; seen bigint[]:='{}'; row_id bigint; raw_keys text[];
BEGIN
 IF p_table NOT IN('cockpit_campaigns','cockpit_ads') THEN RAISE EXCEPTION 'Unsupported native mirror';END IF;
 -- Raw ownership is the canonical 20260927k contract; unrelated JSON annotations survive.
 raw_keys:=CASE WHEN p_table='cockpit_campaigns' THEN ARRAY['_id','_creationTime','campaignName','accountName','accountIssue','clientName','taskId','taskUrl','adStatus','onBoard','internal','currency','spend7d','spendToday','leadsToday','dataThrough','lost','leads7d','cpl','impressions7d','linkClicks7d','linkCtr','cpm','optInRate','frequency','dayRate','medianDayRate','contractedBudget','budgetLevel','budgetDaily','budgetLifetime','firstSpend','daysLive','staleTaskName','diagnosis','findings','daysSinceTouch','lastChangeAt','clientTag','tags','serviceType','serviceMode','priority','boardAdStatus','advertisingCities','cplStatus','cpbStatus','showed7d','costPerBooking','bookingRate','showRate','hasGhl','metaAccountId','metaCampaignId','bookings7d','verdict','reason','rank','syncedAt'] ELSE ARRAY['_id','_creationTime','campaignName','adName','spend','leads','cpl','linkCtr','cpm','optInRate','frequency','thumbnailUrl','previewSrc','metaAdId','stillKey','stillUrl','stillTinyUrl','verdict','reason','syncedAt'] END;
 IF p_table='cockpit_ads' THEN raw_keys:=raw_keys||ARRAY['creativeId'];END IF; -- Resolved by native still capture.
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  proposed:=public.cockpit_snapshot_projection(p_table,item,'native:media')||jsonb_build_object('source_system','supabase','raw_data',item,'synced_at',p_stamp,'source_deleted',false,'source_deleted_at',NULL);
  old:=NULL;
  IF jsonb_array_length(public.cockpit_snapshot_keys(p_table,proposed))=0 THEN RAISE EXCEPTION 'No stable mirror identity';END IF;
  FOR key IN SELECT value FROM jsonb_array_elements(public.cockpit_snapshot_keys(p_table,proposed)) LOOP
   EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t WHERE public.cockpit_snapshot_keys($1,to_jsonb(t)) @> jsonb_build_array($2)',p_table) INTO matches USING p_table,key;
   IF jsonb_array_length(matches)>1 THEN RAISE EXCEPTION 'Ambiguous mirror identity';END IF;
   IF jsonb_array_length(matches)=1 THEN old:=matches->0;EXIT;END IF;
  END LOOP;
  IF old IS NOT NULL THEN
   IF (old->>'id')::bigint=ANY(seen) THEN RAISE EXCEPTION 'Duplicate logical mirror identity';END IF;
   IF nullif(old->'raw_data'->>'_id','') IS NULL OR NOT(old->>'source_system'='convex' OR EXISTS(SELECT 1 FROM public.cockpit_native_mirror_owners o WHERE o.table_name=p_table AND o.row_id=(old->>'id')::bigint)) THEN RAISE EXCEPTION 'Mirror is not source owned';END IF;
   k:=CASE WHEN p_table='cockpit_campaigns' THEN 'meta_campaign_id' ELSE 'meta_ad_id' END;
   IF nullif(old->>k,'') IS NOT NULL AND nullif(proposed->>k,'') IS NOT NULL AND (old->>k) IS DISTINCT FROM (proposed->>k) THEN RAISE EXCEPTION 'Conflicting provider identities; review the source mapping';END IF;
   IF (old->>'synced_at')::timestamptz>p_stamp OR (old->>'updated_at')::timestamptz>p_stamp THEN RAISE EXCEPTION 'Mirror is newer than source snapshot';END IF;
   proposed:=proposed||jsonb_build_object('source_deployment',old->'source_deployment','source_id',old->'source_id');
   IF p_table='cockpit_campaigns' THEN proposed:=proposed||jsonb_build_object('client_id',old->'client_id');END IF;
   old_projection:=public.cockpit_snapshot_projection(p_table,old->'raw_data',old->>'source_deployment');
   FOR k,v IN SELECT * FROM jsonb_each(old_projection) LOOP
    IF k IN('source_system','source_deployment','source_id') THEN CONTINUE;END IF;
    IF old->k IS DISTINCT FROM v
     AND NOT(old->>'source_system'='convex' AND k='client_name' AND old->>'client_name'=old->'raw_data'->>'campaignName')
     AND NOT(v='null'::jsonb AND old->k='0'::jsonb AND k IN('spend_7d','spend_today','leads_7d','leads_today','spend','leads'))
    THEN RAISE EXCEPTION 'Human or untracked source field changed: %',k;END IF;
   END LOOP;
   IF EXISTS(SELECT 1 FROM jsonb_each(item) e WHERE NOT(e.key=ANY(raw_keys)) AND (old->'raw_data')?e.key AND old->'raw_data'->e.key IS DISTINCT FROM e.value) THEN RAISE EXCEPTION 'Untracked raw annotation changed; preserve for review';END IF;
   proposed:=proposed||jsonb_build_object('raw_data',((old->'raw_data')-raw_keys)||item);
  END IF;
  SELECT string_agg(format('%I',name),','),string_agg(format('%I=x.%I',name,name),',') INTO cols,assigns FROM jsonb_object_keys(proposed) name;
  IF old IS NULL THEN
   EXECUTE format('INSERT INTO public.%I(%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) x RETURNING id',p_table,cols,cols,p_table) INTO row_id USING proposed;
  ELSE
   EXECUTE format('UPDATE public.%I t SET %s,updated_at=clock_timestamp() FROM jsonb_populate_record(NULL::public.%I,$1) x WHERE t.id=$2 RETURNING t.id',p_table,assigns,p_table) INTO row_id USING proposed,(old->>'id')::bigint;
  END IF;
  seen:=array_append(seen,row_id);
  INSERT INTO public.cockpit_native_mirror_owners(table_name,row_id,original_deployment,original_source_id)
  VALUES(p_table,row_id,old->>'source_deployment',old->>'source_id') ON CONFLICT DO NOTHING;
  IF old IS NULL OR (old - ARRAY['id','created_at','updated_at','synced_at','raw_data']::text[]) IS DISTINCT FROM (proposed - ARRAY['id','created_at','updated_at','synced_at','raw_data']::text[])
    OR ((old->'raw_data')-'syncedAt'::text) IS DISTINCT FROM ((proposed->'raw_data')-'syncedAt'::text) THEN
   INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,source_system,before,after) VALUES('native.publish',p_table,row_id::text,'media-buyer','supabase',old,proposed);
  END IF;
 END LOOP;
 FOR old IN EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE NOT source_deleted AND (source_system=''convex'' OR EXISTS(SELECT 1 FROM public.cockpit_native_mirror_owners o WHERE o.table_name=$2 AND o.row_id=t.id)) AND raw_data ? ''_id'' AND NOT(id=ANY($1))',p_table) USING seen,p_table LOOP
  old_projection:=public.cockpit_snapshot_projection(p_table,old->'raw_data',old->>'source_deployment');
  FOR k,v IN SELECT * FROM jsonb_each(old_projection) LOOP
   IF k IN('source_system','source_deployment','source_id') THEN CONTINUE;END IF;
   IF old->k IS DISTINCT FROM v AND NOT(v='null'::jsonb AND old->k='0'::jsonb AND k IN('spend_7d','spend_today','leads_7d','leads_today','spend','leads')) THEN RAISE EXCEPTION 'Human change in absent mirror; cannot retire';END IF;
  END LOOP;
  EXECUTE format('UPDATE public.%I SET source_deleted=true,source_deleted_at=$1,updated_at=clock_timestamp() WHERE id=$2',p_table) USING p_stamp,(old->>'id')::bigint;
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,source_system,before,after) VALUES('native.retire',p_table,old->>'id','media-buyer','supabase',old,old||jsonb_build_object('source_deleted',true,'source_deleted_at',p_stamp));
 END LOOP;
END $$;

COMMIT;
