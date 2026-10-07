BEGIN;
ALTER TABLE public.cockpit_campaigns ADD COLUMN IF NOT EXISTS source_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.cockpit_campaigns ADD COLUMN IF NOT EXISTS source_deleted_at timestamptz;
ALTER TABLE public.cockpit_ads ADD COLUMN IF NOT EXISTS source_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.cockpit_ads ADD COLUMN IF NOT EXISTS source_deleted_at timestamptz;
CREATE OR REPLACE FUNCTION public.cockpit_snapshot_projection(p_table text,p_source jsonb,p_deployment text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF p_table='cockpit_campaigns' THEN result:=jsonb_build_object(
 'client_name',coalesce(nullif(p_source->>'clientName',''),nullif(p_source->>'accountName','')),
  'meta_account_id',p_source->'metaAccountId',
  'meta_campaign_id',p_source->'metaCampaignId',
  'task_id',p_source->'taskId',
  'task_url',p_source->'taskUrl',
  'service_mode',p_source->'serviceMode',
  'verdict',p_source->'verdict',
  'reason',p_source->'reason',
  'rank',p_source->'rank',
  'spend_7d',p_source->'spend7d',
  'spend_today',p_source->'spendToday',
  'leads_7d',p_source->'leads7d',
  'leads_today',p_source->'leadsToday',
  'cpl',p_source->'cpl',
  'frequency',p_source->'frequency',
  'link_ctr',p_source->'linkCtr',
  'opt_in_rate',p_source->'optInRate');
 ELSIF p_table='cockpit_ads' THEN result:=jsonb_build_object(
 'campaign_name',p_source->'campaignName',
  'ad_name',p_source->'adName',
  'meta_ad_id',p_source->'metaAdId',
  'verdict',p_source->'verdict',
  'reason',p_source->'reason',
  'spend',p_source->'spend',
  'leads',p_source->'leads',
  'frequency',p_source->'frequency',
  'still_url',p_source->'stillUrl',
  'thumbnail_url',p_source->'thumbnailUrl');
 ELSE RAISE EXCEPTION 'Unsupported mirror'; END IF;
 RETURN result||jsonb_build_object('source_system','convex','source_deployment',p_deployment,'source_id',p_source->>'_id');
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_snapshot_keys(p_table text,p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE keys jsonb:='[]'; meta text; account text; raw jsonb:=coalesce(p_row->'raw_data','{}'); task text; name text;
BEGIN
 meta:=p_row->>(CASE WHEN p_table='cockpit_campaigns' THEN 'meta_campaign_id' ELSE 'meta_ad_id' END);
 account:=coalesce(nullif(p_row->>'meta_account_id',''),nullif(raw->>'metaAccountId',''),nullif(raw->>'accountName',''));
 account:=regexp_replace(btrim(account),'^act_','');
 IF nullif(meta,'') IS NOT NULL THEN keys:=keys||jsonb_build_array(jsonb_build_array('meta',meta)); END IF;
 IF nullif(account,'') IS NOT NULL THEN
  IF p_table='cockpit_campaigns' THEN
   task:=coalesce(nullif(p_row->>'task_id',''),nullif(raw->>'taskId',''));
   IF task IS NOT NULL THEN keys:=keys||jsonb_build_array(jsonb_build_array('task',account,task)); END IF;
   name:=nullif(raw->>'campaignName','');
   IF name IS NOT NULL THEN keys:=keys||jsonb_build_array(jsonb_build_array('name',account,name)); END IF;
  ELSIF nullif(raw->>'campaignName','') IS NOT NULL AND nullif(raw->>'adName','') IS NOT NULL THEN
   keys:=keys||jsonb_build_array(jsonb_build_array('name',account,raw->>'campaignName',raw->>'adName'));
  END IF;
 END IF;
 RETURN keys;
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_reconcile_snapshot(p_table text,p_expected jsonb,p_after jsonb,p_source jsonb,p_plan_sha text,p_apply boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE allowed text[]; current_row jsonb; found_rows jsonb; key jsonb; projected jsonb; old_projection jsonb;
 column_name text; column_value jsonb; raw_keys text[]; incoming_time timestamptz; result jsonb; assignments text; columns text; old_meta text; new_meta text;
BEGIN
 IF p_table NOT IN ('cockpit_campaigns','cockpit_ads') THEN RAISE EXCEPTION 'Unsupported mirror'; END IF;
 IF coalesce(p_plan_sha,'') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Reviewed plan SHA256 required'; END IF;
 IF jsonb_typeof(p_source)<>'object' OR nullif(p_source->>'_id','') IS NULL OR nullif(p_after->>'source_deployment','') IS NULL THEN RAISE EXCEPTION 'Original source JSON and deployment required'; END IF;
 raw_keys:=CASE WHEN p_table='cockpit_campaigns' THEN ARRAY['_id','_creationTime','campaignName','accountName','accountIssue','clientName','taskId','taskUrl','adStatus','onBoard','internal','currency','spend7d','spendToday','leadsToday','dataThrough','lost','leads7d','cpl','impressions7d','linkClicks7d','linkCtr','cpm','optInRate','frequency','dayRate','medianDayRate','contractedBudget','budgetLevel','budgetDaily','budgetLifetime','firstSpend','daysLive','staleTaskName','diagnosis','findings','daysSinceTouch','lastChangeAt','clientTag','tags','serviceType','serviceMode','priority','boardAdStatus','advertisingCities','cplStatus','cpbStatus','showed7d','costPerBooking','bookingRate','showRate','hasGhl','metaAccountId','metaCampaignId','bookings7d','verdict','reason','rank','syncedAt'] ELSE ARRAY['_id','_creationTime','campaignName','adName','spend','leads','cpl','linkCtr','cpm','optInRate','frequency','thumbnailUrl','previewSrc','metaAdId','stillKey','stillUrl','stillTinyUrl','verdict','reason','syncedAt'] END;
 projected:=public.cockpit_snapshot_projection(p_table,p_source,p_after->>'source_deployment');
 SELECT array_agg(k) INTO allowed FROM jsonb_object_keys(projected) k;
 allowed:=allowed||ARRAY['raw_data','synced_at','source_deleted','source_deleted_at'];
 IF p_after->'source_deleted' IS DISTINCT FROM 'false'::jsonb OR p_after->'source_deleted_at' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Source-present rows must restore active status'; END IF;
 IF p_expected IS NULL AND p_table='cockpit_campaigns' THEN allowed:=allowed||ARRAY['client_id']; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_after) k WHERE NOT(k=ANY(allowed))) THEN RAISE EXCEPTION 'Non-source column in update; SQL id, foreign keys and human columns are protected'; END IF;
 IF NOT(p_after @> projected) THEN RAISE EXCEPTION 'After fields do not match original source JSON'; END IF;
 IF p_after->>'synced_at' IS NULL THEN RAISE EXCEPTION 'Source timestamp required'; END IF;
 incoming_time:=(p_after->>'synced_at')::timestamptz;
 IF incoming_time IS DISTINCT FROM to_timestamp(coalesce(p_source->>'syncedAt',p_source->>'_creationTime')::numeric/1000) THEN RAISE EXCEPTION 'Source timestamp mismatch'; END IF;
 IF jsonb_array_length(public.cockpit_snapshot_keys(p_table,p_after))=0 THEN RAISE EXCEPTION 'No stable identity'; END IF;
 -- Serializes identity discovery plus insert against ordinary writes; no duplicate race or silent merge.
 EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',p_table);
 FOR key IN SELECT value FROM jsonb_array_elements(public.cockpit_snapshot_keys(p_table,p_after)) LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t WHERE public.cockpit_snapshot_keys($1,to_jsonb(t)) @> jsonb_build_array($2)',p_table)
   INTO found_rows USING p_table,key;
  IF jsonb_array_length(found_rows)>1 THEN RAISE EXCEPTION 'Ambiguous target identity; duplicates cannot be merged'; END IF;
  IF jsonb_array_length(found_rows)=1 THEN current_row:=found_rows->0; EXIT; END IF;
 END LOOP;
 IF p_expected IS DISTINCT FROM current_row THEN RAISE EXCEPTION 'Concurrent change or identity mismatch; exact current row does not match reviewed plan'; END IF;
 IF current_row IS NOT NULL THEN
  IF current_row->>'source_system' IS DISTINCT FROM 'convex' OR current_row->>'source_deployment' IS DISTINCT FROM p_after->>'source_deployment' THEN RAISE EXCEPTION 'Target is not owned by this source deployment'; END IF;
  old_meta:=current_row->>(CASE WHEN p_table='cockpit_campaigns' THEN 'meta_campaign_id' ELSE 'meta_ad_id' END);
  new_meta:=p_after->>(CASE WHEN p_table='cockpit_campaigns' THEN 'meta_campaign_id' ELSE 'meta_ad_id' END);
  IF nullif(old_meta,'') IS NOT NULL AND nullif(new_meta,'') IS NOT NULL AND old_meta<>new_meta THEN RAISE EXCEPTION 'Conflicting Meta identities'; END IF;
  IF nullif(current_row->'raw_data'->>'_id','') IS NULL THEN RAISE EXCEPTION 'Target original source JSON missing'; END IF;
  IF p_after->'raw_data' IS DISTINCT FROM (((current_row->'raw_data')-raw_keys)||p_source) THEN RAISE EXCEPTION 'Unrelated raw JSON fields must be preserved'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(p_source) e WHERE NOT(e.key=ANY(raw_keys)) AND (current_row->'raw_data')?e.key AND current_row->'raw_data'->e.key IS DISTINCT FROM e.value) THEN RAISE EXCEPTION 'Untracked raw JSON field changed; preserve for review'; END IF;
  old_projection:=public.cockpit_snapshot_projection(p_table,current_row->'raw_data',current_row->>'source_deployment');
  FOR column_name,column_value IN SELECT * FROM jsonb_each(old_projection) LOOP
   IF column_name IN ('source_system','source_deployment','source_id') THEN CONTINUE; END IF;
   IF current_row->column_name IS DISTINCT FROM column_value
    AND NOT(column_name='client_name' AND current_row->>'client_name'=current_row->'raw_data'->>'campaignName')
    AND NOT(column_value='null'::jsonb AND current_row->column_name='0'::jsonb AND column_name IN ('spend_7d','spend_today','leads_7d','leads_today','spend','leads'))
   THEN RAISE EXCEPTION 'Human or untracked change in field %; preserve for review',column_name; END IF;
  END LOOP;
  IF (current_row->>'synced_at')::timestamptz>incoming_time OR (current_row->>'updated_at')::timestamptz>incoming_time THEN RAISE EXCEPTION 'Target is newer than source'; END IF;
 ELSE
  IF p_after->'raw_data' IS DISTINCT FROM p_source THEN RAISE EXCEPTION 'Insert raw JSON must be the original source'; END IF;
 END IF;
 IF NOT p_apply THEN RETURN jsonb_build_object('dry_run',true,'operation',CASE WHEN current_row IS NULL THEN 'insert' ELSE 'update' END,'before',current_row,'after',p_after); END IF;
 SELECT string_agg(format('%I',k),','),string_agg(format('%I = x.%I',k,k),',') INTO columns,assignments FROM jsonb_object_keys(p_after) k;
 IF current_row IS NULL THEN
  EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) x RETURNING to_jsonb(%I.*)',p_table,columns,columns,p_table,p_table) INTO result USING p_after;
 ELSE
  EXECUTE format('UPDATE public.%I t SET %s,updated_at=now() FROM jsonb_populate_record(NULL::public.%I,$1) x WHERE t.id=$2 RETURNING to_jsonb(t.*)',p_table,assignments,p_table) INTO result USING p_after,(current_row->>'id')::bigint;
 END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,source_system,"before","after",metadata)
 VALUES('snapshot.'||CASE WHEN current_row IS NULL THEN 'insert' ELSE 'update' END,p_table,result->>'id','migration','convex',current_row,result,jsonb_build_object('reviewed_plan_sha256',p_plan_sha,'original_source_json',p_source));
 RETURN jsonb_build_object('dry_run',false,'operation',CASE WHEN current_row IS NULL THEN 'insert' ELSE 'update' END,'row',result);
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_retire_snapshot(p_table text,p_expected jsonb,p_snapshot jsonb,p_plan_sha text,p_apply boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_row jsonb; record jsonb; projected jsonb; keys jsonb; current_keys jsonb; seen jsonb:='[]'; oldest_projection jsonb;
 column_name text; column_value jsonb; matches integer; exported timestamptz; result jsonb;
BEGIN
 IF p_table NOT IN ('cockpit_campaigns','cockpit_ads') THEN RAISE EXCEPTION 'Unsupported mirror'; END IF;
 IF coalesce(p_plan_sha,'') !~ '^[0-9a-f]{64}$' OR coalesce(p_snapshot->>'archive_sha256','') !~ '^[0-9a-f]{64}$'
  OR p_snapshot->'complete' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(p_snapshot->'records') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Reviewed complete archive evidence required'; END IF;
 IF jsonb_array_length(p_snapshot->'records')=0 OR (p_snapshot->>'source_count')::integer IS DISTINCT FROM jsonb_array_length(p_snapshot->'records') THEN RAISE EXCEPTION 'Complete nonempty source required'; END IF;
 exported:=(p_snapshot->>'exported_at')::timestamptz;
 IF exported IS NULL THEN RAISE EXCEPTION 'Snapshot export timestamp required'; END IF;
 EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',p_table);
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',p_table) INTO current_row USING (p_expected->>'id')::bigint;
 IF current_row IS NULL OR current_row IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Concurrent change; exact current row does not match retirement plan'; END IF;
 IF current_row->>'source_system' IS DISTINCT FROM 'convex' OR current_row->>'source_deployment' IS DISTINCT FROM p_snapshot->>'deployment' THEN RAISE EXCEPTION 'Target is not owned by this snapshot'; END IF;
 IF current_row->'source_deleted'='true'::jsonb THEN RAISE EXCEPTION 'Row is already retired'; END IF;
 IF (current_row->>'updated_at')::timestamptz>exported OR (current_row->>'synced_at')::timestamptz>exported THEN RAISE EXCEPTION 'Target is newer than the full snapshot'; END IF;
 current_keys:=public.cockpit_snapshot_keys(p_table,current_row);
 IF jsonb_array_length(current_keys)=0 OR nullif(current_row->'raw_data'->>'_id','') IS NULL THEN RAISE EXCEPTION 'Original source identity missing'; END IF;
 EXECUTE format('SELECT count(*) FROM public.%I t WHERE public.cockpit_snapshot_keys($1,to_jsonb(t)) @> jsonb_build_array($2)',p_table)
 INTO matches USING p_table,current_keys->0;
 IF matches<>1 THEN RAISE EXCEPTION 'Ambiguous retirement identity'; END IF;
 FOR record IN SELECT value FROM jsonb_array_elements(p_snapshot->'records') LOOP
  IF jsonb_typeof(record) IS DISTINCT FROM 'object' OR nullif(record->>'_id','') IS NULL OR coalesce(record->>'syncedAt',record->>'_creationTime') IS NULL THEN RAISE EXCEPTION 'Invalid source row in full snapshot'; END IF;
  IF to_timestamp(coalesce(record->>'syncedAt',record->>'_creationTime')::numeric/1000)>exported THEN RAISE EXCEPTION 'Source record is newer than snapshot export'; END IF;
  projected:=public.cockpit_snapshot_projection(p_table,record,p_snapshot->>'deployment')||jsonb_build_object('raw_data',record);
  IF (p_table='cockpit_campaigns' AND nullif(projected->>'client_name','') IS NULL) OR (p_table='cockpit_ads' AND (nullif(projected->>'ad_name','') IS NULL OR nullif(projected->>'campaign_name','') IS NULL)) THEN RAISE EXCEPTION 'Incomplete source identity'; END IF;
  keys:=public.cockpit_snapshot_keys(p_table,projected);
  IF jsonb_array_length(keys)=0 OR seen @> jsonb_build_array(keys->0) THEN RAISE EXCEPTION 'Invalid or duplicate source identity'; END IF;
  seen:=seen||jsonb_build_array(keys->0);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(keys) k WHERE current_keys @> jsonb_build_array(k.value)) THEN RAISE EXCEPTION 'Target still appears in source or identity is ambiguous'; END IF;
 END LOOP;
 oldest_projection:=public.cockpit_snapshot_projection(p_table,current_row->'raw_data',current_row->>'source_deployment');
 FOR column_name,column_value IN SELECT * FROM jsonb_each(oldest_projection) LOOP
  IF column_name IN ('source_system','source_deployment','source_id') THEN CONTINUE; END IF;
  IF current_row->column_name IS DISTINCT FROM column_value
   AND NOT(column_name='client_name' AND current_row->>'client_name'=current_row->'raw_data'->>'campaignName')
   AND NOT(column_value='null'::jsonb AND current_row->column_name='0'::jsonb AND column_name IN ('spend_7d','spend_today','leads_7d','leads_today','spend','leads'))
  THEN RAISE EXCEPTION 'Human change in absent row field %; cannot retire',column_name; END IF;
 END LOOP;
 IF NOT p_apply THEN RETURN jsonb_build_object('dry_run',true,'operation','retire','before',current_row); END IF;
 EXECUTE format('UPDATE public.%I SET source_deleted=true,source_deleted_at=now(),updated_at=now() WHERE id=$1 RETURNING to_jsonb(%I.*)',p_table,p_table)
 INTO result USING (current_row->>'id')::bigint;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,source_system,"before","after",metadata)
 VALUES('snapshot.retire',p_table,result->>'id','migration','convex',current_row,result,jsonb_build_object('reviewed_plan_sha256',p_plan_sha,'full_snapshot_evidence',p_snapshot));
 RETURN jsonb_build_object('dry_run',false,'operation','retire','row',result);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_retire_snapshot(text,jsonb,jsonb,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_retire_snapshot(text,jsonb,jsonb,text,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.cockpit_snapshot_projection(text,jsonb,text),public.cockpit_snapshot_keys(text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_reconcile_snapshot(text,jsonb,jsonb,jsonb,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_reconcile_snapshot(text,jsonb,jsonb,jsonb,text,boolean) TO service_role;
COMMIT;
