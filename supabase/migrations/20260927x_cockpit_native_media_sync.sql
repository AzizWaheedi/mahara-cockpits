BEGIN;
ALTER TABLE public.cockpit_members
 ADD COLUMN IF NOT EXISTS source_deployment text,
 ADD COLUMN IF NOT EXISTS source_id text,
 ADD COLUMN IF NOT EXISTS sales_role text,
 ADD COLUMN IF NOT EXISTS note text,
 ADD COLUMN IF NOT EXISTS added_by text,
 ADD COLUMN IF NOT EXISTS added_at timestamptz,
 ADD COLUMN IF NOT EXISTS source_updated_at timestamptz,
 ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
 ADD COLUMN IF NOT EXISTS last_cockpit text;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_members_source_identity ON public.cockpit_members(source_deployment,source_id) WHERE source_id IS NOT NULL;
ALTER TABLE public.cockpit_eod_reports ADD COLUMN IF NOT EXISTS source_row jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.cockpit_decisions ADD COLUMN IF NOT EXISTS source_row jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.cockpit_plan_items
 ADD COLUMN IF NOT EXISTS source_deployment text,
 ADD COLUMN IF NOT EXISTS source_id text,
 ADD COLUMN IF NOT EXISTS source_row jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_plan_items_source_identity ON public.cockpit_plan_items(source_deployment,source_id) WHERE source_id IS NOT NULL;
ALTER TABLE public.cockpit_team_status
 ADD COLUMN IF NOT EXISTS source_deployment text,
 ADD COLUMN IF NOT EXISTS source_id text;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_team_status_source_identity ON public.cockpit_team_status(source_deployment,source_id) WHERE source_id IS NOT NULL;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_team_status TO service_role;
GRANT SELECT,UPDATE ON public.cockpit_team_status_state TO service_role;
ALTER TABLE public.cockpit_metric_days
 ADD COLUMN IF NOT EXISTS source_deployment text,
 ADD COLUMN IF NOT EXISTS source_id text,
 ADD COLUMN IF NOT EXISTS source_record jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_metric_days_source_identity ON public.cockpit_metric_days(source_deployment,source_id) WHERE source_id IS NOT NULL;
GRANT SELECT ON public.cockpit_metric_days TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_original_audit_source_identity ON public.cockpit_audit_log
 ((metadata->>'source_deployment'),(metadata->>'source_id'))
 WHERE source_system='convex' AND metadata->>'source_table'='ceoAudit';
ALTER TABLE public.cockpit_client_billing_days
 ADD COLUMN IF NOT EXISTS source_deployment text,
 ADD COLUMN IF NOT EXISTS source_id text,
 ADD COLUMN IF NOT EXISTS source_record jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_client_billing_days_source_identity ON public.cockpit_client_billing_days(source_deployment,source_id) WHERE source_id IS NOT NULL;
GRANT SELECT ON public.cockpit_client_billing_days TO service_role;
-- Extends the canonical s/v/w row feeds; never creates replacement cache tables.
CREATE TABLE IF NOT EXISTS public.cockpit_native_media_runs (
 run_id uuid PRIMARY KEY,lease_token uuid NOT NULL UNIQUE,
 status text NOT NULL CHECK(status IN('claimed','published','bootstrapped','failed','expired')),
 lease_expires_at timestamptz NOT NULL,published_at timestamptz,plan_sha text,plan jsonb,receipt jsonb,error text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_native_one_claim ON public.cockpit_native_media_runs((status)) WHERE status='claimed';
CREATE TABLE IF NOT EXISTS public.cockpit_native_stills (
 key text PRIMARY KEY,data jsonb NOT NULL CHECK(jsonb_typeof(data)='object' AND data->>'key'=key),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cockpit_native_mirror_owners (
 table_name text NOT NULL CHECK(table_name IN('cockpit_campaigns','cockpit_ads')),row_id bigint NOT NULL,
 original_deployment text,original_source_id text,PRIMARY KEY(table_name,row_id)
);
ALTER TABLE public.cockpit_native_mirror_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_native_mirror_owners FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.cockpit_native_mirror_owners TO service_role;
ALTER TABLE public.cockpit_native_media_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_native_stills ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_native_media_runs,public.cockpit_native_stills FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.cockpit_native_media_runs,public.cockpit_native_stills TO service_role;
ALTER TABLE public.cockpit_media_provider_health ADD COLUMN IF NOT EXISTS native_run_id uuid REFERENCES public.cockpit_native_media_runs(run_id);
ALTER TABLE public.cockpit_media_provider_health ADD COLUMN IF NOT EXISTS native_receipt_index integer;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_native_receipt_once ON public.cockpit_media_provider_health(native_run_id,native_receipt_index);
ALTER TABLE public.cockpit_media_provider_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_media_provider_health FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.cockpit_media_provider_health TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.cockpit_media_provider_health_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_native_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after)
 VALUES(lower(TG_OP),TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'run_id',to_jsonb(NEW)->>'key',to_jsonb(OLD)->>'source_id'),
 'native-feed','media-buyer','supabase',CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END);
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER cockpit_native_run_audit AFTER INSERT OR UPDATE ON public.cockpit_native_media_runs FOR EACH ROW EXECUTE FUNCTION public.cockpit_native_audit();
CREATE OR REPLACE TRIGGER cockpit_native_still_audit AFTER INSERT OR UPDATE ON public.cockpit_native_stills FOR EACH ROW EXECUTE FUNCTION public.cockpit_native_audit();
CREATE OR REPLACE TRIGGER cockpit_native_owner_audit AFTER INSERT ON public.cockpit_native_mirror_owners FOR EACH ROW EXECUTE FUNCTION public.cockpit_native_audit();
CREATE OR REPLACE TRIGGER cockpit_native_daily_delete_audit AFTER DELETE ON public.cockpit_media_daily_stats FOR EACH ROW EXECUTE FUNCTION public.cockpit_native_audit();
CREATE OR REPLACE TRIGGER cockpit_native_media_delete_audit AFTER DELETE ON public.cockpit_media_sources FOR EACH ROW EXECUTE FUNCTION public.cockpit_native_audit();
CREATE OR REPLACE TRIGGER cockpit_native_csm_delete_audit AFTER DELETE ON public.cockpit_csm_sources FOR EACH ROW EXECUTE FUNCTION public.cockpit_native_audit();
CREATE OR REPLACE TRIGGER cockpit_native_creative_delete_audit AFTER DELETE ON public.cockpit_creative_sources FOR EACH ROW EXECUTE FUNCTION public.cockpit_native_audit();
CREATE OR REPLACE TRIGGER cockpit_native_booking_delete_audit AFTER DELETE ON public.cockpit_media_booking_events FOR EACH ROW EXECUTE FUNCTION public.cockpit_native_audit();

-- This lock also serializes the very first claim, when there is no row to lock.
CREATE OR REPLACE FUNCTION public.cockpit_native_media_claim(p_run_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_native_media_runs;
BEGIN
 PERFORM pg_advisory_xact_lock(1835102821,1);
 IF p_run_id IS NULL THEN RAISE EXCEPTION 'Run ID required';END IF;
 IF EXISTS(SELECT 1 FROM public.cockpit_native_media_runs WHERE status='claimed' AND lease_expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Active lease contention';END IF;
 IF EXISTS(SELECT 1 FROM public.cockpit_native_media_runs WHERE run_id=p_run_id) THEN RAISE EXCEPTION 'Run already exists; retry its publication with the original fence';END IF;
 UPDATE public.cockpit_native_media_runs SET status='expired',updated_at=clock_timestamp() WHERE status='claimed';
 INSERT INTO public.cockpit_native_media_runs(run_id,lease_token,status,lease_expires_at)
 VALUES(p_run_id,gen_random_uuid(),'claimed',clock_timestamp()+interval '30 minutes') RETURNING * INTO r;
 RETURN jsonb_build_object('run_id',r.run_id,'lease_token',r.lease_token,'lease_expires_at',r.lease_expires_at);
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_native_media_fence(p_run_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_native_media_runs;
BEGIN
 PERFORM pg_advisory_xact_lock(1835102821,1);
 SELECT * INTO r FROM public.cockpit_native_media_runs WHERE run_id=p_run_id FOR UPDATE;
 IF r.run_id IS NULL OR r.lease_token IS DISTINCT FROM p_lease_token OR r.status<>'claimed' OR r.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Expired or stale worker fence';END IF;
 RETURN jsonb_build_object('run_id',r.run_id,'lease_expires_at',r.lease_expires_at);
END $$;

-- Fingerprint actual rows as well as readiness/count/stamp. No assumed revision column.
CREATE OR REPLACE FUNCTION public.cockpit_native_manifest() RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE name text; rows jsonb; result jsonb:='{}';
BEGIN
 FOREACH name IN ARRAY ARRAY['cockpit_media_source_state','cockpit_media_sources','cockpit_csm_source_state','cockpit_csm_sources','cockpit_creative_source_state','cockpit_creative_sources','cockpit_campaigns','cockpit_ads','cockpit_media_feed_state','cockpit_media_daily_stats','cockpit_media_booking_events','cockpit_offboard_dismissals','cockpit_client_profiles','cockpit_csm_client_overrides','cockpit_native_stills','cockpit_native_mirror_owners','cockpit_daily_checks','cockpit_decisions','cockpit_media_call_briefs','cockpit_media_calendar_config'] LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb) FROM public.%I t',name) INTO rows;
  result:=result||jsonb_build_object(name,jsonb_build_object('count',jsonb_array_length(rows),'hash',md5(rows::text)));
 END LOOP;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_native_media_state() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE family text; st record; rows jsonb; feeds jsonb; result jsonb:='{}'; n integer; expected_n integer;
BEGIN
 -- Locking all calculation inputs gives a single coherent state even at READ COMMITTED.
 LOCK TABLE public.cockpit_media_sources,public.cockpit_media_source_state,public.cockpit_csm_sources,public.cockpit_csm_source_state,
 public.cockpit_creative_sources,public.cockpit_creative_source_state,public.cockpit_campaigns,public.cockpit_ads,
 public.cockpit_media_feed_state,public.cockpit_media_daily_stats,public.cockpit_media_booking_events,public.cockpit_offboard_dismissals,
 public.cockpit_client_profiles,public.cockpit_csm_client_overrides,public.cockpit_native_stills,public.cockpit_native_mirror_owners,public.cockpit_daily_checks,public.cockpit_decisions,public.cockpit_media_call_briefs,public.cockpit_media_calendar_config IN SHARE MODE;
 FOREACH family IN ARRAY ARRAY['media','csm','creative'] LOOP
  feeds:='{}';n:=0;expected_n:=CASE family WHEN 'media' THEN 17 WHEN 'csm' THEN 11 ELSE 12 END;
  FOR st IN EXECUTE format('SELECT * FROM public.cockpit_%I_source_state ORDER BY table_name',family) LOOP
   n:=n+1;
   IF NOT st.ready OR st.source_snapshot_at IS NULL OR st.row_count IS NULL THEN RAISE EXCEPTION 'Source %.% is not initialized',family,st.table_name;END IF;
   IF st.source_snapshot_at>clock_timestamp()+interval '1 minute' THEN RAISE EXCEPTION 'Source %.% has a future snapshot',family,st.table_name;END IF;
   EXECUTE format('SELECT coalesce(jsonb_agg(data ORDER BY source_id),''[]''::jsonb) FROM public.cockpit_%I_sources WHERE table_name=$1 AND source_snapshot_at=$2',family) INTO rows USING st.table_name,st.source_snapshot_at;
   IF jsonb_array_length(rows)<>st.row_count THEN RAISE EXCEPTION 'Source %.% count is incomplete',family,st.table_name;END IF;
   -- Leftover rows are not silently hidden by the current stamp.
   EXECUTE format('SELECT count(*) FROM public.cockpit_%I_sources WHERE table_name=$1',family) INTO expected_n USING st.table_name;
   IF expected_n<>st.row_count THEN RAISE EXCEPTION 'Source %.% has mixed snapshots',family,st.table_name;END IF;
   feeds:=feeds||jsonb_build_object(st.table_name,rows);
  END LOOP;
  IF n<>(CASE family WHEN 'media' THEN 17 WHEN 'csm' THEN 11 ELSE 12 END) THEN RAISE EXCEPTION 'Source % configuration incomplete',family;END IF;
  result:=result||jsonb_build_object(family,feeds);
 END LOOP;
 FOR st IN SELECT * FROM public.cockpit_media_feed_state LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(data ORDER BY source_deployment,source_id),''[]''::jsonb) FROM public.%I',CASE st.feed WHEN 'dailyStats' THEN 'cockpit_media_daily_stats' ELSE 'cockpit_media_booking_events' END) INTO rows;
  IF NOT st.ready OR st.source_snapshot_at IS NULL OR st.source_rows IS DISTINCT FROM jsonb_array_length(rows)::bigint THEN RAISE EXCEPTION 'Statistics source % is not ready or count is incomplete',st.feed;END IF;
  result:=result||jsonb_build_object(st.feed,rows);
 END LOOP;
 IF (SELECT count(*) FROM public.cockpit_media_feed_state)<>2 THEN RAISE EXCEPTION 'Statistics source configuration incomplete';END IF;
 result:=result||jsonb_build_object(
  'onboardings',result->'media'->'onboardings','clients',result->'csm'->'clients','manualChanges',result->'media'->'manualChanges',
  'oldTree',result->'media'->'metaTree','winners',result->'creative'->'winnersArchive',
  'oldCampaigns',coalesce((SELECT jsonb_agg(raw_data||jsonb_build_object('_id',coalesce(source_id,raw_data->>'_id',id::text)) ORDER BY id) FROM public.cockpit_campaigns WHERE NOT source_deleted),'[]'),
  'oldAds',coalesce((SELECT jsonb_agg(raw_data||jsonb_build_object('_id',coalesce(source_id,raw_data->>'_id',id::text)) ORDER BY id) FROM public.cockpit_ads WHERE NOT source_deleted),'[]'),
  'stills',coalesce((SELECT jsonb_agg(data ORDER BY key) FROM public.cockpit_native_stills),'[]'),
  'offBoardDismissals',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY campaign_name) FROM public.cockpit_offboard_dismissals d),'[]'),
  'mediaDecisions',coalesce((SELECT jsonb_agg(jsonb_build_object('_id',id::text,'subject',subject,'action',action,'kind',kind,'at',extract(epoch FROM coalesce(logged_at,created_at))*1000) ORDER BY id) FROM public.cockpit_decisions WHERE role='media_buyer'),'[]'),
  'callBriefs',coalesce((SELECT jsonb_agg(jsonb_build_object('_id',coalesce(source_id,id::text),'clientName',client_name,'key',key,'jobId',job_id,'status',status,'overall',overall,'perCall',per_call,'at',extract(epoch FROM at)*1000) ORDER BY at DESC,id DESC) FROM public.cockpit_media_call_briefs),'[]'),
  'calendarConfig',(SELECT jsonb_build_object('serviceAccountEmail',service_account_email) FROM public.cockpit_media_calendar_config),
  'expected',public.cockpit_native_manifest());
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_native_receipts(p_run_id uuid,p_receipts jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r jsonb; resource text; provider text; ordinal integer:=0;
BEGIN
 IF jsonb_typeof(p_receipts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_receipts)>20000 THEN RAISE EXCEPTION 'Invalid provider receipts';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_receipts) LOOP
  ordinal:=ordinal+1;
  resource:=split_part(split_part(regexp_replace(coalesce(r->>'resource','unknown'),'^https://',''),'?',1),'#',1);
  IF resource ~ '[[:space:]@]' OR length(resource)>500 OR resource !~ '^((graph\.facebook\.com|api\.clickup\.com|sheets\.googleapis\.com|www\.googleapis\.com|services\.leadconnectorhq\.com|api\.supabase\.com|oauth2\.googleapis\.com|api\.typeform\.com|api\.fathom\.ai|[a-zA-Z0-9.-]+\.(fbcdn\.net|fbsbx\.com|facebook\.com))/|/storage/v1/object/)' THEN resource:='redacted';END IF;
  provider:=CASE WHEN resource LIKE '%graph.facebook.com/%' THEN 'meta' WHEN resource LIKE '%api.clickup.com/%' THEN 'clickup' WHEN resource LIKE '%googleapis.com/%' THEN 'google' WHEN resource LIKE '%leadconnectorhq.com/%' THEN 'ghl' WHEN resource LIKE '%typeform.com/%' THEN 'typeform' WHEN resource LIKE '%fathom.ai/%' THEN 'fathom' WHEN resource LIKE '%/storage/%' THEN 'storage' ELSE 'native-feed' END;
  INSERT INTO public.cockpit_media_provider_health(native_run_id,native_receipt_index,provider,method,resource,phase,http_status)
  VALUES(p_run_id,ordinal,provider,CASE WHEN r->>'method' IN('GET','POST') THEN r->>'method' ELSE 'GET' END,resource,
   CASE WHEN r->>'phase' IN('intent','response','unknown') THEN r->>'phase' ELSE 'unknown' END,
   CASE WHEN r->>'http_status' ~ '^[1-5][0-9][0-9]$' THEN (r->>'http_status')::integer END)
  ON CONFLICT(native_run_id,native_receipt_index) DO NOTHING;
 END LOOP;
END $$;

-- Receipt settlement cannot upload, publish, renew or release a lease. The original
-- run token permits append-only diagnostics after expiry; no new run is affected.
CREATE OR REPLACE FUNCTION public.cockpit_native_media_record_receipts(p_run_id uuid,p_lease_token uuid,p_receipts jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.cockpit_native_media_runs WHERE run_id=p_run_id AND lease_token=p_lease_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid receipt fence';END IF;
 PERFORM public.cockpit_native_receipts(p_run_id,p_receipts);
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,source_system,after)
 VALUES('native.receipts','cockpit_native_media_runs',p_run_id::text,'media-buyer','supabase',jsonb_build_object('receipt_count',jsonb_array_length(p_receipts)));
END $$;
REVOKE ALL ON FUNCTION public.cockpit_native_media_record_receipts(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_native_media_record_receipts(uuid,uuid,jsonb) TO service_role;

-- Source projection only. Existing SQL IDs/FKs and independently edited human columns survive.
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
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,source_system,before,after) VALUES('native.publish',p_table,row_id::text,'media-buyer','supabase',old,proposed);
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

CREATE OR REPLACE FUNCTION public.cockpit_native_grain_key(p_kind text,p_data jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN p_kind='dailyStats' THEN jsonb_build_array(p_data->>'campaignName',p_data->>'date',coalesce(p_data->>'metaAdId',p_data->>'adName',''),coalesce(p_data->>'adSetName',''))
 ELSE jsonb_build_array(p_data->>'campaignName',coalesce(p_data->>'locationId',''),coalesce(p_data->>'eventId',p_data->>'id',p_data->>'contactId'),coalesce(p_data->>'startTime',p_data->>'date')) END
$$;
REVOKE ALL ON FUNCTION public.cockpit_native_grain_key(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cockpit_native_media_publish(p_run_id uuid,p_lease_token uuid,p_plan jsonb,p_plan_sha text,p_receipts jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_native_media_runs; state jsonb; family text; section jsonb; tab text; rows jsonb; item jsonb; stamp timestamptz; names text[]; protected boolean; v_receipt jsonb; mapping text; expected_count integer; retained jsonb; feed_table text;
BEGIN
 PERFORM pg_advisory_xact_lock(1835102821,1);
 SELECT * INTO r FROM public.cockpit_native_media_runs WHERE run_id=p_run_id FOR UPDATE;
 IF r.run_id IS NULL OR r.lease_token IS DISTINCT FROM p_lease_token THEN RAISE EXCEPTION 'Stale worker fence';END IF;
 IF r.status='published' THEN
  IF r.plan_sha IS DISTINCT FROM p_plan_sha OR r.plan IS DISTINCT FROM p_plan THEN RAISE EXCEPTION 'Changed retry hash or plan refused';END IF;
  RETURN r.receipt;
 END IF;
 PERFORM public.cockpit_native_media_fence(p_run_id,p_lease_token);
 IF p_plan_sha IS NULL OR p_plan_sha !~ '^[0-9a-f]{64}$' OR p_plan->>'producer' IS DISTINCT FROM 'media-core' OR p_plan->'version' IS DISTINCT FROM '1'::jsonb THEN RAISE EXCEPTION 'Invalid native plan';END IF;
 stamp:=(p_plan->>'source_snapshot_at')::timestamptz;
 IF stamp IS NULL OR stamp<r.created_at-interval '1 minute' OR stamp<clock_timestamp()-interval '30 minutes' OR stamp>clock_timestamp()+interval '1 minute' THEN RAISE EXCEPTION 'Stale or future snapshot';END IF;
 LOCK TABLE public.cockpit_media_sources,public.cockpit_media_source_state,public.cockpit_csm_sources,public.cockpit_csm_source_state,
 public.cockpit_creative_sources,public.cockpit_creative_source_state,public.cockpit_campaigns,public.cockpit_ads,
 public.cockpit_media_feed_state,public.cockpit_media_daily_stats,public.cockpit_media_booking_events,public.cockpit_offboard_dismissals,
 public.cockpit_client_profiles,public.cockpit_csm_client_overrides,public.cockpit_native_stills,public.cockpit_native_mirror_owners,public.cockpit_daily_checks,public.cockpit_decisions,public.cockpit_media_call_briefs IN SHARE ROW EXCLUSIVE MODE;
 state:=public.cockpit_native_media_state();
 IF p_plan->'expected' IS DISTINCT FROM state->'expected' THEN RAISE EXCEPTION 'Source revision conflict; calculate again';END IF;
 -- Validate the complete wire contract before any write, including protected histories.
 FOREACH family IN ARRAY ARRAY['media','csm','creative'] LOOP
  mapping:=CASE family WHEN 'media' THEN 'tables' ELSE family END;section:=p_plan->mapping;
  IF jsonb_typeof(section) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Missing % output',family;END IF;
  FOR tab IN SELECT jsonb_object_keys(state->family) UNION SELECT unnest(CASE family WHEN 'media' THEN ARRAY['campaigns','ads','dailyStats','bookingEvents','checkProposals','adStills','winnersArchive'] WHEN 'csm' THEN ARRAY['checks'] ELSE ARRAY[]::text[] END) LOOP
   rows:=section->tab;
   IF jsonb_typeof(rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Missing complete %.% array',family,tab;END IF;
   IF p_plan->'counts'->>(CASE family WHEN 'media' THEN '' ELSE family||'_' END||tab) IS DISTINCT FROM jsonb_array_length(rows)::text THEN RAISE EXCEPTION 'Output count mismatch %.%',family,tab;END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(rows) e WHERE jsonb_typeof(e)<>'object' OR nullif(e->>'_id','') IS NULL) THEN RAISE EXCEPTION 'Missing source identity %.%',family,tab;END IF;
   IF (SELECT count(DISTINCT e->>'_id') FROM jsonb_array_elements(rows) e)<>jsonb_array_length(rows) THEN RAISE EXCEPTION 'Duplicate logical identity %.%',family,tab;END IF;
  END LOOP;
  FOR tab,rows IN SELECT * FROM jsonb_each(section) LOOP
   IF NOT(state->family ? tab) AND NOT(family='media' AND tab=ANY(ARRAY['campaigns','ads','dailyStats','bookingEvents','checkProposals','adStills','winnersArchive'])) AND NOT(family='csm' AND tab='checks') THEN RAISE EXCEPTION 'Unknown %.% output',family,tab;END IF;
  END LOOP;
 END LOOP;
 IF p_plan->'creative'->'winnersArchive' IS DISTINCT FROM p_plan->'tables'->'winnersArchive' THEN RAISE EXCEPTION 'Winner feeds disagree';END IF;
 PERFORM public.cockpit_native_mirrors('cockpit_campaigns',p_plan->'tables'->'campaigns',stamp);
 PERFORM public.cockpit_native_mirrors('cockpit_ads',p_plan->'tables'->'ads',stamp);
 FOREACH family IN ARRAY ARRAY['media','csm','creative'] LOOP
  mapping:=CASE family WHEN 'media' THEN 'tables' ELSE family END;
  FOR tab IN SELECT jsonb_object_keys(state->family) LOOP
   rows:=p_plan->mapping->tab;
   protected:=CASE family WHEN 'media' THEN tab=ANY(ARRAY['clientComments','manualChanges','clickupMembers','clientPrefs','feedback','syncRuns','trackingIssues','campaignChat']) WHEN 'csm' THEN tab=ANY(ARRAY['decisions','reportDocs','outbox','syncRuns']) ELSE tab=ANY(ARRAY['touchLog','blueprints']) END;
   IF protected THEN
    IF rows IS DISTINCT FROM state->family->tab THEN RAISE EXCEPTION 'Protected history %.% must remain unchanged',family,tab;END IF;
    CONTINUE;
   END IF;
   -- Historical roster days, human churn and archived winners cannot disappear or mutate.
   IF (family='csm' AND tab IN('rosterDays','churnEvents')) OR (family='creative' AND tab='winnersArchive') THEN
    FOR item IN SELECT value FROM jsonb_array_elements(state->family->tab) LOOP
     IF family='creative' THEN
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) e WHERE e->>'adId'=item->>'adId') THEN RAISE EXCEPTION 'Winner archive cannot delete history';END IF;
      SELECT e INTO retained FROM jsonb_array_elements(rows) e WHERE e->>'adId'=item->>'adId';
      IF NOT (retained @> (item-ARRAY['spend','leads','cpl','headline','body','cta','transcript','hook','voice','format','adName','client','serviceLine','city','country','language','copyTraits','playType','interests','adsetName','creativeId','accountId','campaignName','lastSeenAt','thumbUrl','stillKey','stillUrl','stillTinyUrl','autoFirstAt','wonFrom','wonTo','stillLive','retiredOn','previewSrc'])) THEN RAISE EXCEPTION 'Winner annotations or immutable identity changed';END IF;
     ELSIF item->>'day'<>p_plan->>'working_day' OR (tab='churnEvents' AND item->>'kind' NOT IN('new','new_inactive','regained','lost','paused','removed')) THEN
      IF NOT rows @> jsonb_build_array(item) THEN RAISE EXCEPTION 'Human or historical CSM row changed';END IF;
     END IF;
    END LOOP;
   END IF;
   IF family='csm' AND tab='appointments' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(state->family->tab) LOOP
     IF item->>'startTime' IS NULL OR (item->>'startTime')::timestamptz<((p_plan->>'working_day')||'T00:00:00+03:00')::timestamptz-interval '14 days'
      OR (item->>'startTime')::timestamptz>=((p_plan->>'working_day')||'T00:00:00+03:00')::timestamptz+interval '42 days' THEN
      IF NOT rows @> jsonb_build_array(item) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) e WHERE e->>'apptId'=item->>'apptId'
       AND (e->>'startTime')::timestamptz>=((p_plan->>'working_day')||'T00:00:00+03:00')::timestamptz-interval '14 days'
       AND (e->>'startTime')::timestamptz<((p_plan->>'working_day')||'T00:00:00+03:00')::timestamptz+interval '42 days') THEN RAISE EXCEPTION 'Appointment history outside refreshed window cannot disappear';END IF;
     END IF;
    END LOOP;
   END IF;
   EXECUTE format('DELETE FROM public.cockpit_%I_sources WHERE table_name=$1 AND NOT(source_id IN(SELECT value->>''_id'' FROM jsonb_array_elements($2)))',family) USING tab,rows;
   FOR item IN SELECT value FROM jsonb_array_elements(rows) LOOP
    SELECT coalesce(array_agg(DISTINCT btrim(n)) FILTER(WHERE nullif(btrim(n),'') IS NOT NULL),'{}') INTO names FROM (
     SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(item->'clientNames')='array' THEN item->'clientNames' ELSE '[]' END) n
     UNION ALL SELECT value #>> '{}' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(item->'clients')='array' THEN item->'clients' ELSE '[]' END) WHERE jsonb_typeof(value)='string'
     UNION ALL SELECT coalesce(item->>'clientName',item->>'client',CASE WHEN tab IN('clients','churnEvents','clientLinks') THEN item->>'name' END)
     UNION ALL SELECT coalesce(nullif(c->>'clientName',''),c->>'accountName') FROM jsonb_array_elements(p_plan->'tables'->'campaigns') c WHERE c->>'campaignName'=item->>'campaignName' OR (nullif(item->>'taskId','') IS NOT NULL AND c->>'taskId'=item->>'taskId')
    ) scope;
    EXECUTE format('INSERT INTO public.cockpit_%I_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(table_name,source_id) DO UPDATE SET client_names=excluded.client_names,data=excluded.data,source_snapshot_at=excluded.source_snapshot_at',family) USING tab,item->>'_id',names,item,stamp;
   END LOOP;
   EXECUTE format('UPDATE public.cockpit_%I_source_state SET ready=true,row_count=$2,source_snapshot_at=$3 WHERE table_name=$1',family) USING tab,jsonb_array_length(rows),stamp;
  END LOOP;
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['dailyStats','bookingEvents'] LOOP
  feed_table:=CASE tab WHEN 'dailyStats' THEN 'cockpit_media_daily_stats' ELSE 'cockpit_media_booking_events' END;
  rows:=p_plan->'tables'->tab;
  IF (SELECT count(DISTINCT public.cockpit_native_grain_key(tab,e)) FROM jsonb_array_elements(rows) e)<>jsonb_array_length(rows) THEN RAISE EXCEPTION 'Duplicate logical statistics grain';END IF;
  IF p_plan->>'window_since' IS NULL OR (p_plan->>'window_since')::date>(p_plan->>'working_day')::date THEN RAISE EXCEPTION 'Statistics coverage window required';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(rows) LOOP
   IF tab='bookingEvents' AND nullif(item->>'eventId','') IS NULL AND (nullif(item->>'contactId','') IS NULL OR nullif(item->>'startTime','') IS NULL) THEN RAISE EXCEPTION 'Booking provider identity missing';END IF;
   IF (item->>'date')::date<(p_plan->>'window_since')::date OR (item->>'date')::date>(p_plan->>'working_day')::date THEN RAISE EXCEPTION 'Statistics row outside complete window';END IF;
   -- Match the real daily grain across the imported/native boundary; never add it twice.
   EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t WHERE public.cockpit_native_grain_key($1,data)=public.cockpit_native_grain_key($1,$2)',feed_table) INTO retained USING tab,item;
   IF jsonb_array_length(retained)>1 THEN RAISE EXCEPTION 'Ambiguous existing statistics grain';END IF;
   IF jsonb_array_length(retained)=1 THEN
    EXECUTE format('UPDATE public.%I SET data=$1,imported_at=clock_timestamp() WHERE source_deployment=$2 AND source_id=$3',feed_table) USING item,retained->0->>'source_deployment',retained->0->>'source_id';
   ELSE
    EXECUTE format('INSERT INTO public.%I(source_deployment,source_id,campaign_name,day,data) VALUES(''native:media'',$1,$2,$3,$4)',feed_table) USING item->>'_id',item->>'campaignName',(item->>'date')::date,item;
   END IF;
  END LOOP;
  IF tab='bookingEvents' THEN DELETE FROM public.cockpit_media_booking_events b WHERE day BETWEEN (p_plan->>'window_since')::date AND (p_plan->>'working_day')::date AND source_deployment='native:media' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) e WHERE public.cockpit_native_grain_key(tab,b.data)=public.cockpit_native_grain_key(tab,e));END IF;
  EXECUTE format('SELECT count(*) FROM public.%I',feed_table) INTO expected_count;
  UPDATE public.cockpit_media_feed_state SET ready=true,source_rows=expected_count,source_snapshot_at=stamp,updated_at=clock_timestamp() WHERE feed=tab;
 END LOOP;
 FOREACH family IN ARRAY ARRAY['media_buyer','csm'] LOOP
  rows:=CASE family WHEN 'media_buyer' THEN p_plan->'tables'->'checkProposals' ELSE p_plan->'csm'->'checks' END;
  FOR item IN SELECT value FROM jsonb_array_elements(rows) LOOP
   IF nullif(item->>'key','') IS NULL OR nullif(item->>'label','') IS NULL THEN RAISE EXCEPTION 'Checklist proposal identity missing';END IF;
   INSERT INTO public.cockpit_daily_checks(role,owner_app,day,check_key,label,detail,phase,block,display_order,href,done,source_system,source_deployment,source_id,source_snapshot_ts,source_row,changed_by)
   VALUES(family,CASE family WHEN 'media_buyer' THEN 'media-buyer' ELSE 'client-success' END,(p_plan->>'working_day')::date,item->>'key',item->>'label',item->>'detail',item->>'phase',item->>'block',nullif(item->>'order','')::numeric,item->>'href',false,'supabase','native:'||family,item->>'_id',stamp::text,item,'native-feed')
   ON CONFLICT ON CONSTRAINT cockpit_daily_checks_logical_unique DO UPDATE SET
    label=CASE WHEN public.cockpit_daily_checks.label IS NOT DISTINCT FROM public.cockpit_daily_checks.source_row->>'label' THEN excluded.label ELSE public.cockpit_daily_checks.label END,
    detail=CASE WHEN public.cockpit_daily_checks.detail IS NOT DISTINCT FROM public.cockpit_daily_checks.source_row->>'detail' THEN excluded.detail ELSE public.cockpit_daily_checks.detail END,
    source_snapshot_ts=excluded.source_snapshot_ts,source_row=public.cockpit_daily_checks.source_row||excluded.source_row,changed_by='native-feed',source_revision=public.cockpit_daily_checks.source_revision+1,
    source_deleted=CASE WHEN public.cockpit_daily_checks.changed_by='native-feed' AND public.cockpit_daily_checks.source_deployment='native:'||family THEN false ELSE public.cockpit_daily_checks.source_deleted END;
  END LOOP;
  UPDATE public.cockpit_daily_checks SET source_deleted=true,source_revision=source_revision+1,changed_by='native-feed'
  WHERE role=family AND day=(p_plan->>'working_day')::date AND source_deployment='native:'||family AND NOT source_deleted AND NOT(check_key IN(SELECT e->>'key' FROM jsonb_array_elements(rows) e));
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_plan->'tables'->'adStills') LOOP
  IF item->>'status'='captured' THEN RAISE EXCEPTION 'Unstored still cannot be published';END IF;
  INSERT INTO public.cockpit_native_stills(key,data) VALUES(item->>'key',item) ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=clock_timestamp();
 END LOOP;
 PERFORM public.cockpit_native_receipts(p_run_id,p_receipts);
 PERFORM public.cockpit_native_media_fence(p_run_id,p_lease_token);
 v_receipt:=jsonb_build_object('status','published','run_id',p_run_id,'plan_sha',p_plan_sha,'published_at',clock_timestamp(),'counts',p_plan->'counts');
 UPDATE public.cockpit_native_media_runs SET status='published',published_at=(v_receipt->>'published_at')::timestamptz,plan_sha=p_plan_sha,plan=p_plan,receipt=v_receipt,updated_at=clock_timestamp() WHERE run_id=p_run_id;
 RETURN v_receipt;
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_native_media_release(p_run_id uuid,p_lease_token uuid,p_error text,p_receipts jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.cockpit_native_media_fence(p_run_id,p_lease_token);
 PERFORM public.cockpit_native_receipts(p_run_id,p_receipts);
 UPDATE public.cockpit_native_media_runs SET status='failed',error='Native feed failed; inspect sanitized provider receipts',updated_at=clock_timestamp() WHERE run_id=p_run_id;
 RETURN jsonb_build_object('status','failed','run_id',p_run_id);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_native_audit(),public.cockpit_native_manifest(),public.cockpit_native_receipts(uuid,jsonb),public.cockpit_native_mirrors(text,jsonb,timestamptz),public.cockpit_native_media_claim(uuid),public.cockpit_native_media_state(),public.cockpit_native_media_fence(uuid,uuid),public.cockpit_native_media_publish(uuid,uuid,jsonb,text,jsonb),public.cockpit_native_media_release(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_native_media_claim(uuid),public.cockpit_native_media_state(),public.cockpit_native_media_fence(uuid,uuid),public.cockpit_native_media_publish(uuid,uuid,jsonb,text,jsonb),public.cockpit_native_media_release(uuid,uuid,text,jsonb) TO service_role;

-- Supabase owns storage's schema. An isolated SQL fixture need not emulate it.
DO $$ BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('cockpit-ad-stills','cockpit-ad-stills',true,5242880,ARRAY['image/jpeg','image/png','image/webp','image/gif']) ON CONFLICT(id) DO NOTHING;
  GRANT SELECT,INSERT ON storage.objects TO service_role;
  CREATE POLICY cockpit_native_stills_browser_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(bucket_id<>'cockpit-ad-stills');
  CREATE POLICY cockpit_native_stills_browser_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING(bucket_id<>'cockpit-ad-stills') WITH CHECK(bucket_id<>'cockpit-ad-stills');
  CREATE POLICY cockpit_native_stills_browser_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO anon,authenticated USING(bucket_id<>'cockpit-ad-stills');
 END IF;
END $$;
-- Finite archive cutover. The ledger records exactly what this importer owns.
CREATE TABLE IF NOT EXISTS public.cockpit_runtime_imports(
 app text NOT NULL,table_name text NOT NULL,source_id text NOT NULL,
 source_sha256 text NOT NULL,target_data jsonb NOT NULL,target_clients text[] NOT NULL,
 source_snapshot_at timestamptz NOT NULL,tombstone boolean NOT NULL DEFAULT false,
 run_id uuid NOT NULL REFERENCES public.cockpit_native_media_runs(run_id),
 PRIMARY KEY(app,table_name,source_id)
);
ALTER TABLE public.cockpit_runtime_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_runtime_imports FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.cockpit_runtime_imports TO service_role;
CREATE OR REPLACE TRIGGER cockpit_runtime_import_audit AFTER INSERT OR UPDATE ON public.cockpit_runtime_imports FOR EACH ROW EXECUTE FUNCTION public.cockpit_native_audit();

CREATE OR REPLACE FUNCTION public.cockpit_native_durable_projection(p_table text,p_data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_table
  WHEN 'members' THEN jsonb_build_object('email',p_data->'email','name',p_data->'name','roles',p_data->'roles','clients',p_data->'clients','active',p_data->'active','sales_role',p_data->'sales_role','note',p_data->'note','added_by',p_data->'added_by','added_at',p_data->'added_at','source_updated_at',p_data->'source_updated_at','last_seen_at',p_data->'last_seen_at','last_cockpit',p_data->'last_cockpit','source_deployment',p_data->'source_deployment','source_id',p_data->'source_id')
  WHEN 'eodReports' THEN jsonb_build_object('role',p_data->'role','day',p_data->'day','submitted_at',p_data->'submitted_at','energy',p_data->'energy','answers',p_data->'answers','computed',p_data->'computed','slack_ts',p_data->'slack_ts','source_system',p_data->'source_system','source_deployment',p_data->'source_deployment','source_id',p_data->'source_id','source_row',p_data->'source_row')
  WHEN 'checks' THEN jsonb_build_object('role',p_data->'role','owner_app',p_data->'owner_app','day',p_data->'day','check_key',p_data->'check_key','label',p_data->'label','detail',p_data->'detail','phase',p_data->'phase','block',p_data->'block','display_order',p_data->'display_order','href',p_data->'href','source_system',p_data->'source_system','source_deployment',p_data->'source_deployment','source_id',p_data->'source_id','source_created_at',p_data->'source_created_at','source_row',p_data->'source_row')
  WHEN 'decisions' THEN jsonb_build_object('role',p_data->'role','day',p_data->'day','subject',p_data->'subject','action',p_data->'action','evidence',p_data->'evidence','kind',p_data->'kind','clickup_task_id',p_data->'clickup_task_id','clickup_task_url',p_data->'clickup_task_url','metric_at_decision',p_data->'metric_at_decision','logged_at',p_data->'logged_at','source_system',p_data->'source_system','source_deployment',p_data->'source_deployment','source_id',p_data->'source_id','source_row',p_data->'source_row')
  WHEN 'feedback' THEN jsonb_build_object('kind',p_data->'kind','text',p_data->'text','created_by',p_data->'created_by','source_system',p_data->'source_system','source_id',p_data->'source_id','app',p_data->'app','page',p_data->'page','role',p_data->'role','actor_email',p_data->'actor_email','metadata',p_data->'metadata')
  WHEN 'ceoTeamStatus' THEN jsonb_build_object('person_key',p_data->'person_key','status',p_data->'status','since',p_data->'since','note',p_data->'note','set_by',p_data->'set_by','set_at',to_char((p_data->>'set_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'source_deployment',p_data->'source_deployment','source_id',p_data->'source_id','source_record',p_data->'source_record')
  WHEN 'planItems' THEN jsonb_build_object('role',p_data->'role','day',p_data->'day','text',p_data->'text','reason',p_data->'reason','client_name',p_data->'client_name','list_name',p_data->'list_name','due_date',p_data->'due_date','created_at',to_char((p_data->>'created_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'confirmed',p_data->'confirmed','source_deployment',p_data->'source_deployment','source_id',p_data->'source_id','source_row',p_data->'source_row')
  WHEN 'ceoDaily' THEN jsonb_build_object('day',p_data->'day','metric',p_data->'metric','scope',p_data->'scope','value',to_jsonb((p_data->>'value')::double precision),'captured_at',to_char((p_data->>'captured_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'source_deployment',p_data->'source_deployment','source_id',p_data->'source_id','source_record',p_data->'source_record')
  WHEN 'ceoAudit' THEN jsonb_build_object('action',p_data->'action','entity_type',p_data->'entity_type','entity_id',p_data->'entity_id','actor_email',p_data->'actor_email','source_app',p_data->'source_app','source_system',p_data->'source_system','before',p_data->'before','after',p_data->'after','created_at',to_char((p_data->>'created_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'metadata',p_data->'metadata')
  WHEN 'ceoClientBilling' THEN to_jsonb(jsonb_populate_record(NULL::public.cockpit_client_billing_days,p_data)) ||
   jsonb_build_object('mrr_usd',to_jsonb((p_data->>'mrr_usd')::double precision),'ltv_usd',to_jsonb((p_data->>'ltv_usd')::double precision),'next_payment_usd',to_jsonb((p_data->>'next_payment_usd')::double precision),'captured_at',to_char((p_data->>'captured_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  WHEN 'clientPrefs' THEN jsonb_build_object('client_name',p_data->'client_name','language',p_data->'language','updated_by',p_data->'updated_by','source_system',p_data->'source_system','source_deployment',p_data->'source_deployment','source_id',p_data->'source_id')
  WHEN 'hotList' THEN jsonb_build_object('key',p_data->'key','client_name',p_data->'client_name','owner_email',p_data->'owner_email','data',p_data->'data','source_system',p_data->'source_system','source_deployment',p_data->'source_deployment','source_id',p_data->'source_id')
  WHEN 'looseDismissed' THEN jsonb_build_object('client_name',p_data->'client_name','loose_text',p_data->'loose_text','cleared_by',p_data->'cleared_by','cleared_at',to_char((p_data->>'cleared_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'source_system',p_data->'source_system','source_deployment',p_data->'source_deployment','source_id',p_data->'source_id')
  WHEN 'moneyGoals' THEN jsonb_build_object('owner_email',p_data->'owner_email','month',p_data->'month','target',to_jsonb((p_data->>'target')::double precision),'clients',to_jsonb((p_data->>'clients')::integer),'counts',p_data->'counts','source_system',p_data->'source_system','source_deployment',p_data->'source_deployment','source_id',p_data->'source_id')
  WHEN 'projections' THEN jsonb_build_object('week_start',p_data->'week_start','owner_email',p_data->'owner_email','metric',p_data->'metric','data',p_data->'data','source_id',p_data->'source_id')
  WHEN 'renewalPlans' THEN jsonb_build_object('task_id',p_data->'task_id','client_name',p_data->'client_name','renewal_date',p_data->'renewal_date','data',p_data->'data','source_id',p_data->'source_id')
  WHEN 'callBriefs' THEN jsonb_build_object('client_name',p_data->'client_name','key',p_data->'key','job_id',p_data->'job_id','status',p_data->'status','overall',p_data->'overall','per_call',p_data->'per_call','at',to_char((p_data->>'at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'source_deployment',p_data->'source_deployment','source_id',p_data->'source_id')
  WHEN 'waThreads' THEN jsonb_build_object('source_app',p_data->'source_app','chat_id',p_data->'chat_id','channel',p_data->'channel','name',p_data->'name','client_name',p_data->'client_name','contact_id',p_data->'contact_id','source',p_data->'source','is_group',p_data->'is_group','unread',p_data->'unread','last_from_us',p_data->'last_from_us','silent_days',p_data->'silent_days','draft',p_data->'draft','recent',p_data->'recent','draft_at',CASE WHEN p_data->>'draft_at' IS NOT NULL THEN to_char((p_data->>'draft_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'last_at',to_char((p_data->>'last_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'waiting_since',CASE WHEN p_data->>'waiting_since' IS NOT NULL THEN to_char((p_data->>'waiting_since')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'synced_at',CASE WHEN p_data->>'synced_at' IS NOT NULL THEN to_char((p_data->>'synced_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'creation_time',to_char((p_data->>'creation_time')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'source_deployment',p_data->'source_deployment','source_id',p_data->'source_id')
  WHEN 'replyDrafts' THEN jsonb_build_object('source_app',p_data->'source_app','chat_id',p_data->'chat_id','status',p_data->'status','job_id',p_data->'job_id','draft',p_data->'draft','at',to_char((p_data->>'at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'last_at',CASE WHEN p_data->>'last_at' IS NOT NULL THEN to_char((p_data->>'last_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'creation_time',to_char((p_data->>'creation_time')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'source_deployment',p_data->'source_deployment','source_id',p_data->'source_id')
  ELSE NULL END
 || CASE p_table
  WHEN 'eodReports' THEN jsonb_build_object('submitted_at',to_char((p_data->>'submitted_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  WHEN 'checks' THEN jsonb_build_object('source_created_at',to_char((p_data->>'source_created_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  WHEN 'decisions' THEN jsonb_build_object('logged_at',to_char((p_data->>'logged_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  ELSE '{}'::jsonb END
 || CASE WHEN p_table IN('clientPrefs','hotList','looseDismissed','moneyGoals','projections','renewalPlans','callBriefs','waThreads','replyDrafts')
  THEN jsonb_build_object('source_record',p_data->'source_record','source_deployment',p_data->'source_deployment') ELSE '{}'::jsonb END
 || CASE WHEN p_table IN('clientPrefs','moneyGoals','projections','renewalPlans')
  THEN jsonb_build_object('updated_at',to_char((p_data->>'updated_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  WHEN p_table='hotList' THEN jsonb_build_object('created_at',to_char((p_data->>'created_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((p_data->>'updated_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  ELSE '{}'::jsonb END
$$;
REVOKE ALL ON FUNCTION public.cockpit_native_durable_projection(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cockpit_native_bootstrap_inventory() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE name text; rows jsonb; tables jsonb:='{}';complete jsonb:='[]';
BEGIN
 FOREACH name IN ARRAY ARRAY['cockpit_media_sources','cockpit_media_source_state','cockpit_csm_sources','cockpit_csm_source_state','cockpit_creative_sources','cockpit_creative_source_state','cockpit_runtime_imports','cockpit_campaigns','cockpit_ads','cockpit_media_daily_stats','cockpit_media_booking_events','cockpit_media_feed_state','cockpit_native_stills','cockpit_native_mirror_owners','cockpit_client_profiles','cockpit_csm_client_overrides','cockpit_offboard_dismissals','cockpit_eod_reports','cockpit_decisions','cockpit_daily_checks','cockpit_issue_reports','cockpit_members','cockpit_plan_items','cockpit_team_status','cockpit_team_status_state','cockpit_metric_days','cockpit_client_billing_days','cockpit_csm_client_preferences','cockpit_csm_hot_rows','cockpit_csm_loose_dismissals','cockpit_csm_money_goals','cockpit_csm_projections','cockpit_csm_renewal_plans','cockpit_media_call_briefs','cockpit_wa_thread_captures','cockpit_wa_draft_history'] LOOP
  IF to_regclass('public.'||name) IS NULL THEN CONTINUE;END IF;
  EXECUTE format('LOCK TABLE public.%I IN SHARE MODE',name);
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb) FROM public.%I t',name) INTO rows;
  tables:=tables||jsonb_build_object(name,rows);complete:=complete||jsonb_build_array(name);
 END LOOP;
 -- Audit run rows change during claims. Only original imported audit evidence belongs to this inventory.
 LOCK TABLE public.cockpit_audit_log IN SHARE MODE;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) INTO rows
 FROM public.cockpit_audit_log t WHERE source_system='convex' AND metadata->>'source_table'='ceoAudit';
 tables:=tables||jsonb_build_object('cockpit_audit_log',rows);complete:=complete||jsonb_build_array('cockpit_audit_log');
 RETURN jsonb_build_object('project_ref','bldgtotkfmhoxmlzowdx','captured_at',clock_timestamp(),'complete_tables',complete,'tables',tables);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_native_bootstrap_publish(p_run_id uuid,p_lease_token uuid,p_plan jsonb,p_plan_sha text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_native_media_runs; inventory jsonb; op jsonb; family text; app text; tab text; target text; current_rows jsonb; current_state jsonb;
 rows jsonb; item jsonb; old jsonb; prior public.cockpit_runtime_imports; stamp timestamptz; clients text[]; v_receipt jsonb; entry jsonb;
 durable_row_data jsonb; ledger_data jsonb; current_projection jsonb; incoming_projection jsonb; retire jsonb; source_id text; roles text[]; new_id bigint; new_row jsonb; exact_count bigint; stamped_count bigint;
 resolved_id bigint; resolved_uid uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(1835102821,1);
 SELECT * INTO r FROM public.cockpit_native_media_runs WHERE run_id=p_run_id FOR UPDATE;
 IF r.run_id IS NULL OR r.lease_token IS DISTINCT FROM p_lease_token THEN RAISE EXCEPTION 'Stale bootstrap fence';END IF;
 IF r.status='bootstrapped' THEN
  IF r.plan_sha IS DISTINCT FROM p_plan_sha OR r.plan IS DISTINCT FROM p_plan THEN RAISE EXCEPTION 'Changed bootstrap retry refused';END IF;
  RETURN r.receipt;
 END IF;
 PERFORM public.cockpit_native_media_fence(p_run_id,p_lease_token);
 IF p_plan->>'project_ref' IS DISTINCT FROM 'bldgtotkfmhoxmlzowdx' OR p_plan->'scope_complete' IS DISTINCT FROM 'true'::jsonb OR p_plan->'blockers' IS DISTINCT FROM '[]'::jsonb OR coalesce(p_plan_sha,'') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Reviewed complete bootstrap plan required';END IF;
 IF p_plan->>'created_at' IS NULL OR (p_plan->>'created_at')::timestamptz<clock_timestamp()-interval '24 hours' OR (p_plan->>'created_at')::timestamptz>clock_timestamp()+interval '1 minute' THEN RAISE EXCEPTION 'Bootstrap plan is not fresh';END IF;
 LOCK TABLE public.cockpit_runtime_imports,public.cockpit_media_sources,public.cockpit_media_source_state,public.cockpit_csm_sources,public.cockpit_csm_source_state,public.cockpit_creative_sources,public.cockpit_creative_source_state,public.cockpit_campaigns,public.cockpit_ads,public.cockpit_media_daily_stats,public.cockpit_media_booking_events,public.cockpit_media_feed_state,public.cockpit_csm_client_preferences,public.cockpit_csm_hot_rows,public.cockpit_csm_loose_dismissals,public.cockpit_csm_money_goals,public.cockpit_csm_projections,public.cockpit_csm_renewal_plans,public.cockpit_media_call_briefs,public.cockpit_wa_thread_captures,public.cockpit_wa_draft_history IN SHARE ROW EXCLUSIVE MODE;
 inventory:=public.cockpit_native_bootstrap_inventory();
 IF inventory->'tables' IS DISTINCT FROM p_plan->'expected_tables' THEN RAISE EXCEPTION 'Bootstrap inventory revision conflict';END IF;
 IF jsonb_typeof(p_plan->'operations') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Bootstrap operations missing';END IF;
 IF jsonb_typeof(p_plan->'scope') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan->'scope')=0 THEN RAISE EXCEPTION 'Explicit bootstrap scope required';END IF;
 IF (SELECT count(DISTINCT (e->>'app',e->>'table')) FROM jsonb_array_elements(p_plan->'operations') e)<>jsonb_array_length(p_plan->'operations') THEN RAISE EXCEPTION 'Duplicate bootstrap source operation';END IF;
 FOR op IN SELECT value FROM jsonb_array_elements(p_plan->'operations') LOOP
  app:=op->>'app';tab:=op->>'table';family:=CASE app WHEN 'media-buyer' THEN 'media' WHEN 'client-success' THEN 'csm' WHEN 'creative-director' THEN 'creative' END;
  IF family IS NULL THEN RAISE EXCEPTION 'Unknown bootstrap application';END IF;
  IF ((p_plan->'scope') ? (app||'/'||tab)) IS NOT TRUE THEN RAISE EXCEPTION 'Bootstrap operation outside reviewed scope';END IF;
  IF op->>'kind'='mirror' THEN
   FOR entry IN SELECT value FROM jsonb_array_elements(op->'entries') LOOP
    IF entry->>'operation'='retire' THEN
     PERFORM public.cockpit_retire_snapshot(entry->>'table',entry->'expected',entry->'snapshot',p_plan_sha,true);
    ELSE
     PERFORM public.cockpit_reconcile_snapshot(entry->>'table',nullif(entry->'expected','null'::jsonb),entry->'after',entry->'source_json',p_plan_sha,true);
    END IF;
   END LOOP;
   CONTINUE;
  END IF;
  IF op->>'kind'='statistics' THEN
   IF app<>'media-buyer' OR tab NOT IN('dailyStats','bookingEvents') THEN RAISE EXCEPTION 'Unsupported statistics source';END IF;
   target:=CASE tab WHEN 'dailyStats' THEN 'cockpit_media_daily_stats' ELSE 'cockpit_media_booking_events' END;
   rows:=op->'rows';stamp:=(op->>'source_snapshot_at')::timestamptz;
   IF stamp IS NULL OR stamp<clock_timestamp()-interval '24 hours' OR stamp>clock_timestamp()+interval '1 minute'
    OR jsonb_typeof(rows) IS DISTINCT FROM 'array' OR jsonb_typeof(op->'source_count') IS DISTINCT FROM 'number'
    OR (op->>'source_count') !~ '^[0-9]+$' OR (op->>'source_count')::integer<>jsonb_array_length(rows)
    OR coalesce(op->>'source_sha256','') !~ '^[0-9a-f]{64}$' OR coalesce(op->>'table_sha256','') !~ '^[0-9a-f]{64}$'
    OR nullif(op->>'deployment','') IS NULL THEN RAISE EXCEPTION 'Statistics source evidence incomplete';END IF;
   SELECT to_jsonb(s) INTO current_state FROM public.cockpit_media_feed_state s WHERE s.feed=tab;
   IF current_state IS NULL THEN RAISE EXCEPTION 'Statistics source_state missing';END IF;
   EXECUTE format('SELECT count(*) FROM public.%I',target) INTO exact_count;
   IF current_state->>'ready'='true' THEN
    IF current_state->'source_rows' IS NULL OR current_state->'source_rows'='null'::jsonb
     OR current_state->'source_snapshot_at' IS NULL OR current_state->'source_snapshot_at'='null'::jsonb
     OR (current_state->>'source_rows')::bigint<>exact_count
     OR (current_state->>'source_snapshot_at')::timestamptz>clock_timestamp()+interval '1 minute'
    THEN RAISE EXCEPTION 'Ready statistics source count or snapshot is invalid';END IF;
    IF (current_state->>'source_snapshot_at')::timestamptz>stamp THEN RAISE EXCEPTION 'Target statistics source is newer than archive';END IF;
   ELSIF current_state->>'ready'='false' AND current_state->'source_rows'='null'::jsonb AND current_state->'source_snapshot_at'='null'::jsonb AND exact_count=0 THEN
    NULL;
   ELSE RAISE EXCEPTION 'Uninitialized statistics source contains rows or partial readiness';END IF;
   IF (SELECT count(DISTINCT public.cockpit_native_grain_key(tab,e)) FROM jsonb_array_elements(rows) e)<>jsonb_array_length(rows) THEN RAISE EXCEPTION 'Duplicate statistics grain';END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(rows) LOOP
    IF nullif(item->>'_id','') IS NULL OR nullif(item->>'campaignName','') IS NULL OR nullif(item->>'date','') IS NULL THEN RAISE EXCEPTION 'Statistics identity missing';END IF;
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t WHERE public.cockpit_native_grain_key($1,data)=public.cockpit_native_grain_key($1,$2)',target) INTO current_rows USING tab,item;
    IF jsonb_array_length(current_rows)>1 THEN RAISE EXCEPTION 'Ambiguous existing statistics grain';END IF;
    old:=current_rows->0;
    SELECT * INTO prior FROM public.cockpit_runtime_imports i WHERE i.app=op->>'app' AND i.table_name=tab AND i.source_id=item->>'_id';
    IF prior.tombstone THEN RAISE EXCEPTION 'Protected statistics tombstone';END IF;
    IF old IS NULL AND prior.source_id IS NOT NULL THEN RAISE EXCEPTION 'Previously imported statistics target disappeared';END IF;
    IF old IS NOT NULL AND old->'data' IS DISTINCT FROM item AND (prior.source_id IS NULL OR prior.target_data IS DISTINCT FROM old->'data') THEN RAISE EXCEPTION 'Protected statistics history';END IF;
    IF old IS NULL THEN
     EXECUTE format('INSERT INTO public.%I(source_deployment,source_id,campaign_name,day,data) VALUES($1,$2,$3,$4,$5)',target) USING op->>'deployment',item->>'_id',item->>'campaignName',(item->>'date')::date,item;
    ELSIF old->'data' IS DISTINCT FROM item THEN
     EXECUTE format('UPDATE public.%I SET data=$1,imported_at=clock_timestamp() WHERE source_deployment=$2 AND source_id=$3',target) USING item,old->>'source_deployment',old->>'source_id';
    END IF;
    INSERT INTO public.cockpit_runtime_imports(app,table_name,source_id,source_sha256,target_data,target_clients,source_snapshot_at,run_id)
    VALUES(app,tab,item->>'_id',op->>'source_sha256',item,'{}',stamp,p_run_id)
    ON CONFLICT ON CONSTRAINT cockpit_runtime_imports_pkey DO UPDATE SET source_sha256=excluded.source_sha256,target_data=excluded.target_data,source_snapshot_at=excluded.source_snapshot_at,run_id=excluded.run_id;
   END LOOP;
   EXECUTE format('SELECT count(*) FROM public.%I',target) INTO exact_count;
   UPDATE public.cockpit_media_feed_state SET ready=true,source_rows=exact_count,source_snapshot_at=stamp,updated_at=clock_timestamp() WHERE feed=tab;
   IF NOT FOUND THEN RAISE EXCEPTION 'Statistics source_state disappeared';END IF;
   CONTINUE;
  END IF;
  IF op->>'kind'='durable' THEN
   target:=CASE
    WHEN app='media-buyer' AND tab='members' THEN 'cockpit_members'
    WHEN app='media-buyer' AND tab='eodReports' THEN 'cockpit_eod_reports'
    WHEN app IN('media-buyer','client-success') AND tab='checks' THEN 'cockpit_daily_checks'
    WHEN app IN('media-buyer','client-success') AND tab='decisions' THEN 'cockpit_decisions'
    WHEN app='client-success' AND tab='feedback' THEN 'cockpit_issue_reports'
    WHEN app='media-buyer' AND tab='ceoTeamStatus' THEN 'cockpit_team_status'
    WHEN app IN('media-buyer','client-success','creative-director') AND tab='planItems' THEN 'cockpit_plan_items'
    WHEN app='media-buyer' AND tab='ceoDaily' THEN 'cockpit_metric_days'
    WHEN app='media-buyer' AND tab='ceoAudit' THEN 'cockpit_audit_log'
    WHEN app='media-buyer' AND tab='ceoClientBilling' THEN 'cockpit_client_billing_days'
    WHEN app='client-success' AND tab='clientPrefs' THEN 'cockpit_csm_client_preferences'
    WHEN app='client-success' AND tab='hotList' THEN 'cockpit_csm_hot_rows'
    WHEN app='client-success' AND tab='looseDismissed' THEN 'cockpit_csm_loose_dismissals'
    WHEN app='client-success' AND tab='moneyGoals' THEN 'cockpit_csm_money_goals'
    WHEN app='client-success' AND tab='projections' THEN 'cockpit_csm_projections'
    WHEN app='client-success' AND tab='renewalPlans' THEN 'cockpit_csm_renewal_plans'
    WHEN app='media-buyer' AND tab='callBriefs' THEN 'cockpit_media_call_briefs'
    WHEN app IN('client-success','creative-director') AND tab='waThreads' THEN 'cockpit_wa_thread_captures'
    WHEN app='media-buyer' AND tab='replyDrafts' THEN 'cockpit_wa_draft_history'
    ELSE NULL END;
   IF target IS NULL OR op->>'target' IS DISTINCT FROM target THEN RAISE EXCEPTION 'Unsupported durable canonical target';END IF;
   rows:=op->'rows';stamp:=(op->>'source_snapshot_at')::timestamptz;
   IF stamp IS NULL OR stamp<clock_timestamp()-interval '24 hours' OR stamp>clock_timestamp()+interval '1 minute'
    OR jsonb_typeof(rows) IS DISTINCT FROM 'array' OR jsonb_typeof(op->'retirements') IS DISTINCT FROM 'array'
    OR jsonb_typeof(op->'source_count') IS DISTINCT FROM 'number' OR (op->>'source_count') !~ '^[0-9]+$' OR (op->>'source_count')::integer<>jsonb_array_length(rows)
    OR coalesce(op->>'source_sha256','') !~ '^[0-9a-f]{64}$' OR coalesce(op->>'table_sha256','') !~ '^[0-9a-f]{64}$'
    OR nullif(op->>'deployment','') IS NULL THEN RAISE EXCEPTION 'Durable source evidence incomplete';END IF;
   IF (SELECT count(DISTINCT e->>'source_id') FROM jsonb_array_elements(rows) e)<>jsonb_array_length(rows)
    OR (SELECT count(DISTINCT e->>'source_id') FROM jsonb_array_elements(op->'retirements') e)<>jsonb_array_length(op->'retirements')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(op->'retirements') d JOIN jsonb_array_elements(rows) s ON s->>'source_id'=d->>'source_id')
   THEN RAISE EXCEPTION 'Duplicate or overlapping durable source identities';END IF;
   IF tab='members' AND jsonb_array_length(op->'retirements')<>0 THEN RAISE EXCEPTION 'Member seats cannot be retired from an archive';END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(rows) LOOP
    source_id:=item->>'source_id';durable_row_data:=item->'data';ledger_data:=item->'ledger_data';
    IF nullif(source_id,'') IS NULL OR jsonb_typeof(durable_row_data) IS DISTINCT FROM 'object'
     OR jsonb_typeof(ledger_data) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'client_names') IS DISTINCT FROM 'array'
     OR public.cockpit_native_durable_projection(tab,durable_row_data) IS DISTINCT FROM ledger_data
     OR coalesce(item->>'action','') NOT IN('insert','adopt','existing','preserve','enrich')
    THEN RAISE EXCEPTION 'Durable row identity or projection is invalid';END IF;
    IF tab='members' THEN
     IF durable_row_data - ARRAY['email','name','roles','clients','active','sales_role','note','added_by','added_at','source_updated_at','last_seen_at','last_cockpit','source_deployment','source_id']<>'{}'::jsonb
      OR durable_row_data->>'source_id' IS DISTINCT FROM source_id OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment'
      OR nullif(durable_row_data->>'email','') IS NULL OR durable_row_data->>'email'<>lower(btrim(durable_row_data->>'email'))
      OR jsonb_typeof(durable_row_data->'roles') IS DISTINCT FROM 'array' OR jsonb_typeof(durable_row_data->'clients') IS DISTINCT FROM 'array'
      OR durable_row_data->'active' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(durable_row_data->'added_at') IS DISTINCT FROM 'string'
      OR (durable_row_data->>'sales_role' IS NOT NULL AND durable_row_data->>'sales_role' NOT IN('setter','closer','both','manager'))
      OR app<>'media-buyer'
     THEN RAISE EXCEPTION 'Invalid member import fields';END IF;
    ELSIF tab='eodReports' THEN
     IF durable_row_data - ARRAY['role','day','submitted_at','energy','answers','computed','slack_ts','source_system','source_deployment','source_id','source_row']<>'{}'::jsonb
      OR durable_row_data->>'source_system'<>'convex' OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment'
      OR durable_row_data->>'source_id' IS DISTINCT FROM source_id OR durable_row_data->'answers' IS NULL OR durable_row_data->'answers'='null'::jsonb
      OR durable_row_data->'computed' IS NULL OR durable_row_data->'computed'='null'::jsonb
     THEN RAISE EXCEPTION 'Invalid EOD report mapping';END IF;
    ELSIF tab='checks' THEN
     IF durable_row_data - ARRAY['role','owner_app','day','check_key','label','detail','phase','block','display_order','href','done','done_at','source_system','source_deployment','source_id','source_created_at','source_snapshot_ts','source_row','changed_by','source_revision','source_deleted']<>'{}'::jsonb
      OR durable_row_data->>'source_system'<>'convex' OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment'
      OR durable_row_data->>'source_id' IS DISTINCT FROM source_id OR jsonb_typeof(durable_row_data->'done') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(durable_row_data->'source_revision') IS DISTINCT FROM 'number'
     THEN RAISE EXCEPTION 'Invalid checklist mapping';END IF;
    ELSIF tab='decisions' THEN
     IF durable_row_data - ARRAY['role','day','subject','action','evidence','kind','clickup_task_id','clickup_task_url','metric_at_decision','logged_at','source_system','source_deployment','source_id','source_row']<>'{}'::jsonb
      OR durable_row_data->>'source_system'<>'convex' OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment'
      OR durable_row_data->>'source_id' IS DISTINCT FROM source_id
     THEN RAISE EXCEPTION 'Invalid decision mapping';END IF;
    ELSIF tab='feedback' THEN
     IF durable_row_data - ARRAY['kind','text','status','batch','note','created_by','source_system','source_id','app','page','role','actor_email','metadata']<>'{}'::jsonb
      OR durable_row_data->>'source_system'<>'convex' OR durable_row_data->>'source_id' IS DISTINCT FROM source_id
      OR durable_row_data->>'app' IS DISTINCT FROM app OR jsonb_typeof(durable_row_data->'metadata') IS DISTINCT FROM 'object'
     THEN RAISE EXCEPTION 'Invalid issue report mapping';END IF;
    ELSIF tab='ceoTeamStatus' THEN
     IF durable_row_data - ARRAY['person_key','status','since','note','set_by','set_at','source_deployment','source_id','source_record']<>'{}'::jsonb
      OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment' OR durable_row_data->>'source_id' IS DISTINCT FROM source_id
      OR coalesce(durable_row_data->>'person_key','') !~ '^[a-z][a-z_]*:[[:alpha:]]+$'
      OR durable_row_data->>'person_key'<>lower(durable_row_data->>'person_key')
      OR coalesce(durable_row_data->>'status','') NOT IN('active','paused','left')
      OR nullif(durable_row_data->>'set_by','') IS NULL OR nullif(durable_row_data->>'set_at','') IS NULL
      OR durable_row_data->'source_record'->>'_id' IS DISTINCT FROM source_id
     THEN RAISE EXCEPTION 'Invalid staffing status mapping';END IF;
    ELSIF tab='planItems' THEN
     IF durable_row_data - ARRAY['role','day','text','reason','client_name','list_name','due_date','created_at','confirmed','source_deployment','source_id','source_row']<>'{}'::jsonb
      OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment' OR durable_row_data->>'source_id' IS DISTINCT FROM source_id
      OR nullif(durable_row_data->>'role','') IS NULL OR nullif(btrim(durable_row_data->>'text'),'') IS NULL
      OR nullif(durable_row_data->>'created_at','') IS NULL OR jsonb_typeof(durable_row_data->'confirmed') IS DISTINCT FROM 'boolean'
     THEN RAISE EXCEPTION 'Invalid daily plan mapping';END IF;
    ELSIF tab='ceoDaily' THEN
     IF durable_row_data - ARRAY['day','metric','scope','value','captured_at','source_deployment','source_id','source_record']<>'{}'::jsonb
      OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment' OR durable_row_data->>'source_id' IS DISTINCT FROM source_id
      OR nullif(durable_row_data->>'metric','') IS NULL OR nullif(durable_row_data->>'scope','') IS NULL
      OR jsonb_typeof(durable_row_data->'value') IS DISTINCT FROM 'number' OR nullif(durable_row_data->>'captured_at','') IS NULL
      OR durable_row_data->'source_record'->>'_id' IS DISTINCT FROM source_id
     THEN RAISE EXCEPTION 'Invalid daily metric history mapping';END IF;
    ELSIF tab='ceoAudit' THEN
     IF durable_row_data - ARRAY['action','entity_type','entity_id','actor_email','source_app','source_system','before','after','created_at','metadata']<>'{}'::jsonb
      OR nullif(durable_row_data->>'action','') IS NULL OR nullif(durable_row_data->>'entity_type','') IS NULL
      OR nullif(durable_row_data->>'actor_email','') IS NULL OR nullif(durable_row_data->>'created_at','') IS NULL
      OR durable_row_data->>'source_app' IS DISTINCT FROM app OR durable_row_data->>'source_system' IS DISTINCT FROM 'convex'
      OR durable_row_data->'metadata'->>'source_table' IS DISTINCT FROM tab
      OR durable_row_data->'metadata'->>'source_deployment' IS DISTINCT FROM op->>'deployment'
      OR durable_row_data->'metadata'->>'source_id' IS DISTINCT FROM source_id
      OR durable_row_data->'metadata'->'source_record'->>'_id' IS DISTINCT FROM source_id
     THEN RAISE EXCEPTION 'Invalid original audit mapping';END IF;
    ELSIF tab='ceoClientBilling' THEN
     IF durable_row_data - ARRAY['day','clickup_task_id','client_name','captured_at','source_deployment','source_id','source_record','stage','mrr_usd','ltv_usd','next_payment_usd','source_currency','next_payment_date','signup_date','launch_date','paused_on','churn_date','next_renewal_date','payment_plan','payment_method','contract_status','churn_reason','churn_type','closer','lead_source']<>'{}'::jsonb
      OR nullif(btrim(durable_row_data->>'clickup_task_id'),'') IS NULL OR nullif(btrim(durable_row_data->>'client_name'),'') IS NULL
      OR nullif(durable_row_data->>'captured_at','') IS NULL
      OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment' OR durable_row_data->>'source_id' IS DISTINCT FROM source_id
      OR durable_row_data->'source_record'->>'_id' IS DISTINCT FROM source_id
      OR EXISTS(SELECT 1 FROM jsonb_each(durable_row_data) AS money_field(key,value)
       WHERE key IN('mrr_usd','ltv_usd','next_payment_usd') AND
        (jsonb_typeof(value) NOT IN('number','null') OR CASE WHEN jsonb_typeof(value)='number' THEN
          round((value#>>'{}')::numeric,2) IS DISTINCT FROM (value#>>'{}')::numeric ELSE false END))
     THEN RAISE EXCEPTION 'Invalid original client billing mapping';END IF;
    ELSIF tab='clientPrefs' THEN
     IF durable_row_data - ARRAY['client_name','language','updated_by','updated_at','source_system','source_deployment','source_id','source_record']<>'{}'::jsonb
      OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment' OR durable_row_data->>'source_id' IS DISTINCT FROM source_id
      OR nullif(btrim(durable_row_data->>'client_name'),'') IS NULL
     THEN RAISE EXCEPTION 'Invalid client preferences mapping';END IF;
    ELSIF tab='hotList' THEN
     IF durable_row_data - ARRAY['key','client_name','owner_email','data','created_at','updated_at','source_system','source_deployment','source_id','source_record']<>'{}'::jsonb
      OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment' OR durable_row_data->>'source_id' IS DISTINCT FROM source_id
      OR nullif(durable_row_data->>'key','') IS NULL OR jsonb_typeof(durable_row_data->'data') IS DISTINCT FROM 'object'
     THEN RAISE EXCEPTION 'Invalid hot list mapping';END IF;
    ELSIF tab='looseDismissed' THEN
     IF durable_row_data - ARRAY['client_name','loose_text','cleared_by','cleared_at','source_system','source_deployment','source_id','source_record']<>'{}'::jsonb
      OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment' OR durable_row_data->>'source_id' IS DISTINCT FROM source_id
      OR nullif(btrim(durable_row_data->>'client_name'),'') IS NULL OR nullif(btrim(durable_row_data->>'loose_text'),'') IS NULL
     THEN RAISE EXCEPTION 'Invalid loose dismissal mapping';END IF;
     IF nullif(durable_row_data->>'cleared_by','') IS NOT NULL AND (durable_row_data->>'cleared_by')::uuid IS DISTINCT FROM public.cockpit_csm_history_owner(durable_row_data->'source_record'->>'by')
      THEN RAISE EXCEPTION 'Recorded dismissal author identity changed';END IF;
    ELSIF tab='moneyGoals' THEN
     IF durable_row_data - ARRAY['owner_email','month','target','clients','counts','updated_at','source_system','source_deployment','source_id','source_record']<>'{}'::jsonb
      OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment' OR durable_row_data->>'source_id' IS DISTINCT FROM source_id
      OR nullif(btrim(durable_row_data->>'owner_email'),'') IS NULL OR nullif(durable_row_data->>'month','') IS NULL
      OR jsonb_typeof(durable_row_data->'counts') IS DISTINCT FROM 'object'
     THEN RAISE EXCEPTION 'Invalid money goal mapping';END IF;
    ELSIF tab='projections' THEN
     IF durable_row_data - ARRAY['week_start','owner_email','metric','data','updated_at','source_deployment','source_id','source_record']<>'{}'::jsonb
      OR durable_row_data->>'source_id' IS DISTINCT FROM source_id
      OR nullif(durable_row_data->>'week_start','') IS NULL OR nullif(btrim(durable_row_data->>'owner_email'),'') IS NULL
      OR coalesce(durable_row_data->>'metric','') NOT IN('resell','renewal','cash','review','referral')
      OR jsonb_typeof(durable_row_data->'data') IS DISTINCT FROM 'object'
     THEN RAISE EXCEPTION 'Invalid projection mapping';END IF;
    ELSIF tab='renewalPlans' THEN
     IF durable_row_data - ARRAY['task_id','client_name','renewal_date','data','updated_at','source_deployment','source_id','source_record']<>'{}'::jsonb
      OR durable_row_data->>'source_id' IS DISTINCT FROM source_id
      OR nullif(btrim(durable_row_data->>'task_id'),'') IS NULL OR nullif(btrim(durable_row_data->>'client_name'),'') IS NULL
      OR nullif(durable_row_data->>'renewal_date','') IS NULL OR jsonb_typeof(durable_row_data->'data') IS DISTINCT FROM 'object'
     THEN RAISE EXCEPTION 'Invalid renewal plan mapping';END IF;
    ELSIF tab='callBriefs' THEN
     IF durable_row_data - ARRAY['client_name','key','job_id','status','overall','per_call','at','source_deployment','source_id','source_record']<>'{}'::jsonb
      OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment' OR durable_row_data->>'source_id' IS DISTINCT FROM source_id
      OR nullif(btrim(durable_row_data->>'client_name'),'') IS NULL OR nullif(durable_row_data->>'key','') IS NULL
      OR jsonb_typeof(durable_row_data->'per_call') IS DISTINCT FROM 'array'
     THEN RAISE EXCEPTION 'Invalid call brief mapping';END IF;
    ELSIF tab='waThreads' THEN
     IF durable_row_data - ARRAY['source_app','chat_id','channel','name','client_name','contact_id','source','is_group','unread','last_from_us','silent_days','draft','draft_at','recent','last_at','waiting_since','synced_at','creation_time','source_deployment','source_id','source_record']<>'{}'::jsonb
      OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment' OR durable_row_data->>'source_id' IS DISTINCT FROM source_id
      OR durable_row_data->>'source_app' IS DISTINCT FROM app
      OR nullif(btrim(durable_row_data->>'chat_id'),'') IS NULL OR nullif(btrim(durable_row_data->>'channel'),'') IS NULL
      OR nullif(btrim(durable_row_data->>'name'),'') IS NULL OR nullif(btrim(durable_row_data->>'contact_id'),'') IS NULL
      OR durable_row_data->>'source' IS DISTINCT FROM 'ghl'
      OR jsonb_typeof(durable_row_data->'is_group') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(durable_row_data->'last_from_us') IS DISTINCT FROM 'boolean'
      OR (durable_row_data->'unread'<>'null'::jsonb AND (durable_row_data->>'unread') !~ '^[0-9]+$')
      OR jsonb_typeof(durable_row_data->'recent') IS DISTINCT FROM 'array'
      OR nullif(durable_row_data->>'last_at','') IS NULL OR nullif(durable_row_data->>'creation_time','') IS NULL
     THEN RAISE EXCEPTION 'Invalid WhatsApp thread mapping';END IF;
     IF EXISTS(
      SELECT 1 FROM jsonb_array_elements(durable_row_data->'recent') AS frag(val)
      WHERE jsonb_typeof(val)<>'object'
       OR nullif(frag.val->>'at','') IS NULL
       OR jsonb_typeof(frag.val->'fromMe') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(frag.val->'text') IS DISTINCT FROM 'string'
       OR jsonb_typeof(frag.val->'who') IS DISTINCT FROM 'string'
     ) THEN RAISE EXCEPTION 'Invalid WhatsApp thread fragment';END IF;
    ELSIF tab='replyDrafts' THEN
     IF durable_row_data - ARRAY['source_app','chat_id','status','job_id','draft','at','last_at','creation_time','source_deployment','source_id','source_record']<>'{}'::jsonb
      OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment' OR durable_row_data->>'source_id' IS DISTINCT FROM source_id
      OR durable_row_data->>'source_app' IS DISTINCT FROM app
      OR nullif(btrim(durable_row_data->>'chat_id'),'') IS NULL
      OR coalesce(durable_row_data->>'status','') NOT IN('done','queued','declined')
      OR nullif(durable_row_data->>'at','') IS NULL OR nullif(durable_row_data->>'creation_time','') IS NULL
     THEN RAISE EXCEPTION 'Invalid reply draft mapping';END IF;
    END IF;
    IF tab IN('clientPrefs','hotList','looseDismissed','moneyGoals','projections','renewalPlans','callBriefs','waThreads','replyDrafts') THEN
     IF durable_row_data->'source_record'->>'_id' IS DISTINCT FROM source_id
      OR durable_row_data->>'source_deployment' IS DISTINCT FROM op->>'deployment' THEN RAISE EXCEPTION 'Original CSM record identity mismatch';END IF;
     IF tab IN('clientPrefs','hotList','moneyGoals','projections','renewalPlans') AND nullif(durable_row_data->>'updated_at','') IS NULL
      THEN RAISE EXCEPTION 'Original CSM timestamp missing';END IF;
    END IF;
    IF tab='members' THEN
     IF EXISTS(SELECT 1 FROM jsonb_array_elements(durable_row_data->'roles') AS role_value(value) WHERE jsonb_typeof(value)<>'string')
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(durable_row_data->'clients') AS client_value(value) WHERE jsonb_typeof(value)<>'string')
     THEN RAISE EXCEPTION 'Invalid member assignments';END IF;
    ELSIF tab='feedback' THEN
     IF durable_row_data->'metadata'->>'_id' IS DISTINCT FROM source_id THEN RAISE EXCEPTION 'Issue report source identity mismatch';END IF;
    ELSIF tab NOT IN('ceoTeamStatus','ceoDaily','ceoAudit','ceoClientBilling','clientPrefs','hotList','looseDismissed','moneyGoals','projections','renewalPlans','callBriefs','waThreads','replyDrafts') AND durable_row_data->'source_row'->>'_id' IS DISTINCT FROM source_id THEN
     RAISE EXCEPTION 'Durable archive identity does not match source row';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(item->'client_names') AS n(value) WHERE jsonb_typeof(value)<>'string')
     OR (SELECT count(*) FROM jsonb_array_elements(item->'client_names'))<>(SELECT count(DISTINCT value#>>'{}') FROM jsonb_array_elements(item->'client_names'))
    THEN RAISE EXCEPTION 'Durable client scope is malformed';END IF;
    SELECT * INTO prior FROM public.cockpit_runtime_imports i WHERE i.app=op->>'app' AND i.table_name=op->>'table' AND i.source_id=item->>'source_id';
    IF prior.tombstone THEN RAISE EXCEPTION 'Protected durable import tombstone';END IF;
    IF target='cockpit_members' THEN
     EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t WHERE lower(t.email)=lower($1)',target) INTO current_rows USING durable_row_data->>'email';
    ELSIF tab='ceoTeamStatus' THEN
     SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO current_rows FROM public.cockpit_team_status t WHERE person_key=durable_row_data->>'person_key';
    ELSIF tab='ceoDaily' THEN
     SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO current_rows FROM public.cockpit_metric_days t
      WHERE day=(durable_row_data->>'day')::date AND metric=durable_row_data->>'metric' AND scope=durable_row_data->>'scope';
    ELSIF tab='ceoClientBilling' THEN
     SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO current_rows FROM public.cockpit_client_billing_days t
      WHERE day=(durable_row_data->>'day')::date AND clickup_task_id=durable_row_data->>'clickup_task_id';
    ELSIF tab='feedback' THEN
     EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t WHERE source_system=''convex'' AND source_id=$1',target) INTO current_rows USING source_id;
    ELSIF tab='ceoAudit' THEN
     SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO current_rows FROM public.cockpit_audit_log t
      WHERE source_system='convex' AND metadata->>'source_table'=tab
       AND metadata->>'source_deployment'=op->>'deployment' AND metadata->>'source_id'=source_id;
    ELSIF tab='clientPrefs' THEN
     SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('client_name',p.client_name)),'[]'::jsonb)
     INTO current_rows FROM public.cockpit_csm_client_preferences t
     JOIN public.cockpit_client_profiles p ON p.id=t.client_profile_id
     WHERE t.source_deployment=op->>'deployment' AND t.source_id=item->>'source_id';
    ELSIF tab='looseDismissed' THEN
     SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('client_name',p.client_name)),'[]'::jsonb)
     INTO current_rows FROM public.cockpit_csm_loose_dismissals t
     JOIN public.cockpit_client_profiles p ON p.id=t.client_profile_id
     WHERE t.source_deployment=op->>'deployment' AND t.source_id=item->>'source_id';
    ELSIF tab IN('projections','renewalPlans') THEN
     EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t WHERE source_deployment=$1 AND source_id=$2',target) INTO current_rows USING op->>'deployment',source_id;
    ELSE
     EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t WHERE source_deployment=$1 AND source_id=$2',target) INTO current_rows USING op->>'deployment',source_id;
    END IF;
    IF jsonb_array_length(current_rows)>1 THEN RAISE EXCEPTION 'Ambiguous durable target identity';END IF;
    old:=current_rows->0;
    IF old IS NULL THEN
     IF tab='checks' THEN
      EXECUTE 'SELECT count(*) FROM public.cockpit_daily_checks WHERE role=$1 AND day=$2::date AND check_key=$3'
       INTO exact_count USING durable_row_data->>'role',durable_row_data->>'day',durable_row_data->>'check_key';
      IF exact_count>0 THEN RAISE EXCEPTION 'Protected checklist has a different source identity';END IF;
     ELSIF tab='clientPrefs' THEN
      SELECT count(*) INTO exact_count FROM public.cockpit_csm_client_preferences cp JOIN public.cockpit_client_profiles p ON p.id=cp.client_profile_id WHERE lower(btrim(p.client_name))=lower(btrim(durable_row_data->>'client_name'));
      IF exact_count>0 THEN RAISE EXCEPTION 'Protected client preference has a different source identity';END IF;
     ELSIF tab='hotList' THEN
      SELECT count(*) INTO exact_count FROM public.cockpit_csm_hot_rows WHERE key=durable_row_data->>'key';
      IF exact_count>0 THEN RAISE EXCEPTION 'Protected hot list row has a different source identity';END IF;
     ELSIF tab='looseDismissed' THEN
      SELECT count(*) INTO exact_count FROM public.cockpit_csm_loose_dismissals ld JOIN public.cockpit_client_profiles p ON p.id=ld.client_profile_id WHERE lower(btrim(p.client_name))=lower(btrim(durable_row_data->>'client_name')) AND ld.text_hash=md5(durable_row_data->>'loose_text');
      IF exact_count>0 THEN RAISE EXCEPTION 'Protected loose dismissal has a different source identity';END IF;
     ELSIF tab='moneyGoals' THEN
      SELECT count(*) INTO exact_count FROM public.cockpit_csm_money_goals WHERE lower(btrim(owner_email))=lower(btrim(durable_row_data->>'owner_email')) AND month=durable_row_data->>'month';
      IF exact_count>0 THEN RAISE EXCEPTION 'Protected money goal has a different source identity';END IF;
     ELSIF tab='projections' THEN
      SELECT count(*) INTO exact_count FROM public.cockpit_csm_projections WHERE week_start=(durable_row_data->>'week_start')::date AND lower(btrim(owner_email))=lower(btrim(durable_row_data->>'owner_email')) AND metric=durable_row_data->>'metric';
      IF exact_count>0 THEN RAISE EXCEPTION 'Protected projection has a different source identity';END IF;
     ELSIF tab='renewalPlans' THEN
      SELECT count(*) INTO exact_count FROM public.cockpit_csm_renewal_plans WHERE task_id=durable_row_data->>'task_id' AND renewal_date=(durable_row_data->>'renewal_date')::date;
      IF exact_count>0 THEN RAISE EXCEPTION 'Protected renewal plan has a different source identity';END IF;
     ELSIF tab='callBriefs' THEN
      SELECT count(*) INTO exact_count FROM public.cockpit_media_call_briefs WHERE client_name=durable_row_data->>'client_name' AND key=durable_row_data->>'key';
      IF exact_count>0 THEN RAISE EXCEPTION 'Protected call brief has a different source identity';END IF;
     ELSIF tab='waThreads' THEN
      SELECT count(*) INTO exact_count FROM public.cockpit_wa_thread_captures WHERE chat_id=durable_row_data->>'chat_id' AND source_app=durable_row_data->>'source_app';
      IF exact_count>0 THEN RAISE EXCEPTION 'Protected WhatsApp thread capture has a different source identity';END IF;
     ELSIF tab='replyDrafts' THEN
      SELECT count(*) INTO exact_count FROM public.cockpit_wa_draft_history WHERE chat_id=durable_row_data->>'chat_id' AND source_app=durable_row_data->>'source_app' AND at=(durable_row_data->>'at')::timestamptz;
      IF exact_count>0 THEN RAISE EXCEPTION 'Protected WhatsApp draft version has a different source identity';END IF;
     END IF;
    END IF;
    IF old IS NULL AND prior.source_id IS NOT NULL THEN RAISE EXCEPTION 'Previously imported durable target disappeared';END IF;
    IF old IS NOT NULL AND target<>'cockpit_members' THEN
     current_projection:=public.cockpit_native_durable_projection(tab,old);
     incoming_projection:=ledger_data;
     IF prior.source_id IS NOT NULL AND prior.target_data IS DISTINCT FROM current_projection THEN RAISE EXCEPTION 'Previously imported durable target drifted';END IF;
     IF current_projection IS DISTINCT FROM incoming_projection THEN
      IF tab IN('eodReports','decisions') AND prior.source_id IS NULL
       AND (coalesce(old->'source_row','{}'::jsonb)='{}'::jsonb)
       AND (current_projection-'source_row') IS NOT DISTINCT FROM (incoming_projection-'source_row')
      THEN
       IF tab='eodReports' THEN
        UPDATE public.cockpit_eod_reports SET source_row=durable_row_data->'source_row' WHERE id=(old->>'id')::bigint;
       ELSE
        UPDATE public.cockpit_decisions SET source_row=durable_row_data->'source_row' WHERE id=(old->>'id')::bigint;
        INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,source_system,before,after)
        VALUES('bootstrap.enrich','cockpit_decisions',old->>'id',app,'convex',old,old||jsonb_build_object('source_row',durable_row_data->'source_row'));
       END IF;
      ELSE
       RAISE EXCEPTION 'Durable source differs from protected canonical history';
      END IF;
     END IF;
    ELSIF old IS NULL THEN
     IF prior.source_id IS NOT NULL THEN RAISE EXCEPTION 'Previously imported durable target disappeared';END IF;
     IF target='cockpit_members' THEN
      SELECT coalesce(array_agg(value), '{}') INTO roles FROM jsonb_array_elements_text(durable_row_data->'roles') value;
      SELECT coalesce(array_agg(value), '{}') INTO clients FROM jsonb_array_elements_text(durable_row_data->'clients') value;
      INSERT INTO public.cockpit_members(email,name,roles,clients,active,source_deployment,source_id,sales_role,note,added_by,added_at,source_updated_at,last_seen_at,last_cockpit)
      VALUES(durable_row_data->>'email',durable_row_data->>'name',roles,clients,true,durable_row_data->>'source_deployment',
       durable_row_data->>'source_id',durable_row_data->>'sales_role',durable_row_data->>'note',durable_row_data->>'added_by',
       (durable_row_data->>'added_at')::timestamptz,nullif(durable_row_data->>'source_updated_at','')::timestamptz,
       nullif(durable_row_data->>'last_seen_at','')::timestamptz,durable_row_data->>'last_cockpit');
     ELSIF tab='eodReports' THEN
      INSERT INTO public.cockpit_eod_reports(role,day,submitted_at,energy,answers,computed,slack_ts,source_system,source_deployment,source_id,source_row)
      VALUES(durable_row_data->>'role',(durable_row_data->>'day')::date,nullif(durable_row_data->>'submitted_at','')::timestamptz,
       nullif(durable_row_data->>'energy','')::numeric,durable_row_data->'answers',durable_row_data->'computed',durable_row_data->>'slack_ts',
       'convex',durable_row_data->>'source_deployment',source_id,durable_row_data->'source_row');
     ELSIF tab='checks' THEN
      INSERT INTO public.cockpit_daily_checks(role,owner_app,day,check_key,label,detail,phase,block,display_order,href,done,done_at,
       source_system,source_deployment,source_id,source_created_at,source_snapshot_ts,source_row,changed_by,source_revision,source_deleted)
      VALUES(durable_row_data->>'role',durable_row_data->>'owner_app',(durable_row_data->>'day')::date,durable_row_data->>'check_key',
       durable_row_data->>'label',durable_row_data->>'detail',durable_row_data->>'phase',durable_row_data->>'block',
       nullif(durable_row_data->>'display_order','')::numeric,durable_row_data->>'href',(durable_row_data->>'done')::boolean,
       nullif(durable_row_data->>'done_at','')::timestamptz,'convex',durable_row_data->>'source_deployment',source_id,
       nullif(durable_row_data->>'source_created_at','')::timestamptz,durable_row_data->>'source_snapshot_ts',
       durable_row_data->'source_row',durable_row_data->>'changed_by',(durable_row_data->>'source_revision')::integer,false);
     ELSIF tab='decisions' THEN
      INSERT INTO public.cockpit_decisions(role,day,subject,action,evidence,kind,clickup_task_id,clickup_task_url,metric_at_decision,
       logged_at,source_system,source_deployment,source_id,source_row)
      VALUES(durable_row_data->>'role',(durable_row_data->>'day')::date,durable_row_data->>'subject',durable_row_data->>'action',
       durable_row_data->>'evidence',durable_row_data->>'kind',durable_row_data->>'clickup_task_id',durable_row_data->>'clickup_task_url',
       nullif(durable_row_data->>'metric_at_decision','')::numeric,nullif(durable_row_data->>'logged_at','')::timestamptz,
       'convex',durable_row_data->>'source_deployment',source_id,durable_row_data->'source_row') RETURNING id INTO new_id;
      SELECT to_jsonb(d) INTO new_row FROM public.cockpit_decisions d WHERE d.id=new_id;
      INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,source_system,before,after)
      VALUES('bootstrap.insert','cockpit_decisions',new_id::text,app,'convex',NULL,new_row);
     ELSIF tab='ceoAudit' THEN
      INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,created_at,metadata)
      VALUES(durable_row_data->>'action',durable_row_data->>'entity_type',durable_row_data->>'entity_id',
       durable_row_data->>'actor_email',app,'convex',durable_row_data->'before',durable_row_data->'after',
       (durable_row_data->>'created_at')::timestamptz,durable_row_data->'metadata');
     ELSE
      IF tab='ceoTeamStatus' THEN
       INSERT INTO public.cockpit_team_status(person_key,status,since,note,set_by,set_at,source_deployment,source_id,source_record)
       VALUES(durable_row_data->>'person_key',durable_row_data->>'status',(durable_row_data->>'since')::date,durable_row_data->>'note',
        durable_row_data->>'set_by',(durable_row_data->>'set_at')::timestamptz,op->>'deployment',source_id,durable_row_data->'source_record')
       RETURNING to_jsonb(cockpit_team_status.*) INTO new_row;
      ELSIF tab='planItems' THEN
       INSERT INTO public.cockpit_plan_items(role,day,text,reason,client_name,list_name,due_date,created_at,confirmed,source_deployment,source_id,source_row)
       VALUES(durable_row_data->>'role',(durable_row_data->>'day')::date,durable_row_data->>'text',durable_row_data->>'reason',
        durable_row_data->>'client_name',durable_row_data->>'list_name',nullif(durable_row_data->>'due_date','')::date,
        (durable_row_data->>'created_at')::timestamptz,(durable_row_data->>'confirmed')::boolean,op->>'deployment',source_id,durable_row_data->'source_row')
       RETURNING to_jsonb(cockpit_plan_items.*) INTO new_row;
      ELSIF tab='ceoDaily' THEN
       INSERT INTO public.cockpit_metric_days(day,metric,scope,value,captured_at,source_deployment,source_id,source_record)
       VALUES((durable_row_data->>'day')::date,durable_row_data->>'metric',durable_row_data->>'scope',
        (durable_row_data->>'value')::double precision,(durable_row_data->>'captured_at')::timestamptz,
        op->>'deployment',source_id,durable_row_data->'source_record') RETURNING to_jsonb(cockpit_metric_days.*) INTO new_row;
      ELSIF tab='ceoClientBilling' THEN
       INSERT INTO public.cockpit_client_billing_days SELECT (jsonb_populate_record(NULL::public.cockpit_client_billing_days,durable_row_data)).*
        RETURNING to_jsonb(cockpit_client_billing_days.*) INTO new_row;
      ELSIF tab='clientPrefs' THEN
       SELECT count(*),max(id) INTO exact_count,resolved_id FROM public.cockpit_client_profiles WHERE lower(btrim(client_name))=lower(btrim(durable_row_data->>'client_name'));
       IF exact_count<>1 THEN RAISE EXCEPTION 'Client profile is missing or ambiguous for preference: %',durable_row_data->>'client_name';END IF;
       INSERT INTO public.cockpit_csm_client_preferences(client_profile_id,language,updated_at,source_system,source_deployment,source_id,source_record)
       VALUES(resolved_id,durable_row_data->>'language',(durable_row_data->>'updated_at')::timestamptz,'convex',op->>'deployment',source_id,durable_row_data->'source_record')
       RETURNING to_jsonb(cockpit_csm_client_preferences.*) INTO new_row;
      ELSIF tab='hotList' THEN
       resolved_uid:=public.cockpit_csm_history_owner(durable_row_data->>'owner_email');
       IF coalesce(durable_row_data->>'client_name','')='' AND resolved_uid IS NULL THEN RAISE EXCEPTION 'Private original hot row owner could not be verified';END IF;
       INSERT INTO public.cockpit_csm_hot_rows(key,client_name,owner_id,owner_email,data,created_at,updated_at,source_system,source_deployment,source_id,source_record)
       VALUES(durable_row_data->>'key',durable_row_data->>'client_name',resolved_uid,durable_row_data->>'owner_email',durable_row_data->'data',
        (durable_row_data->>'created_at')::timestamptz,(durable_row_data->>'updated_at')::timestamptz,'convex',op->>'deployment',source_id,durable_row_data->'source_record')
       RETURNING to_jsonb(cockpit_csm_hot_rows.*) INTO new_row;
      ELSIF tab='looseDismissed' THEN
       SELECT count(*),max(id) INTO exact_count,resolved_id FROM public.cockpit_client_profiles WHERE lower(btrim(client_name))=lower(btrim(durable_row_data->>'client_name'));
       IF exact_count<>1 THEN RAISE EXCEPTION 'Client profile is missing or ambiguous for dismissal: %',durable_row_data->>'client_name';END IF;
       INSERT INTO public.cockpit_csm_loose_dismissals(client_profile_id,loose_text,cleared_at,cleared_by,source_system,source_deployment,source_id,source_record)
       VALUES(resolved_id,durable_row_data->>'loose_text',(durable_row_data->>'cleared_at')::timestamptz,public.cockpit_csm_history_owner(durable_row_data->'source_record'->>'by'),'convex',op->>'deployment',source_id,durable_row_data->'source_record')
       RETURNING to_jsonb(cockpit_csm_loose_dismissals.*) INTO new_row;
      ELSIF tab='moneyGoals' THEN
       resolved_uid:=public.cockpit_csm_history_owner(durable_row_data->>'owner_email');
       IF resolved_uid IS NULL THEN RAISE EXCEPTION 'Original income goal owner could not be verified';END IF;
       INSERT INTO public.cockpit_csm_money_goals(owner_id,owner_email,month,target,clients,counts,updated_at,source_system,source_deployment,source_id,source_record)
       VALUES(resolved_uid,durable_row_data->>'owner_email',durable_row_data->>'month',
        nullif(durable_row_data->>'target','')::numeric,nullif(durable_row_data->>'clients','')::integer,
        durable_row_data->'counts',(durable_row_data->>'updated_at')::timestamptz,'convex',op->>'deployment',source_id,durable_row_data->'source_record')
       RETURNING to_jsonb(cockpit_csm_money_goals.*) INTO new_row;
      ELSIF tab='projections' THEN
       INSERT INTO public.cockpit_csm_projections(week_start,owner_email,metric,data,updated_at,source_deployment,source_id,source_record)
       VALUES((durable_row_data->>'week_start')::date,durable_row_data->>'owner_email',
        durable_row_data->>'metric',durable_row_data->'data',(durable_row_data->>'updated_at')::timestamptz,op->>'deployment',source_id,durable_row_data->'source_record')
       RETURNING to_jsonb(cockpit_csm_projections.*) INTO new_row;
      ELSIF tab='renewalPlans' THEN
       INSERT INTO public.cockpit_csm_renewal_plans(task_id,client_name,renewal_date,data,updated_at,source_deployment,source_id,source_record)
       VALUES(durable_row_data->>'task_id',durable_row_data->>'client_name',(durable_row_data->>'renewal_date')::date,
        durable_row_data->'data',(durable_row_data->>'updated_at')::timestamptz,op->>'deployment',source_id,durable_row_data->'source_record')
       RETURNING to_jsonb(cockpit_csm_renewal_plans.*) INTO new_row;
      ELSIF tab='callBriefs' THEN
       INSERT INTO public.cockpit_media_call_briefs(client_name,key,job_id,status,overall,per_call,at,source_deployment,source_id,source_record)
       VALUES(durable_row_data->>'client_name',durable_row_data->>'key',durable_row_data->>'job_id',
        durable_row_data->>'status',durable_row_data->>'overall',durable_row_data->'per_call',
        (durable_row_data->>'at')::timestamptz,op->>'deployment',source_id,durable_row_data->'source_record')
       RETURNING to_jsonb(cockpit_media_call_briefs.*) INTO new_row;
      ELSIF tab='waThreads' THEN
       INSERT INTO public.cockpit_wa_thread_captures(source_app,chat_id,channel,name,client_name,contact_id,source,is_group,unread,last_from_us,silent_days,draft,draft_at,recent,last_at,waiting_since,synced_at,creation_time,source_deployment,source_id,source_record)
       VALUES(durable_row_data->>'source_app',durable_row_data->>'chat_id',durable_row_data->>'channel',durable_row_data->>'name',
        durable_row_data->>'client_name',durable_row_data->>'contact_id',durable_row_data->>'source',
        (durable_row_data->>'is_group')::boolean,(durable_row_data->>'unread')::integer,(durable_row_data->>'last_from_us')::boolean,
        nullif(durable_row_data->>'silent_days','')::integer,durable_row_data->>'draft',
        nullif(durable_row_data->>'draft_at','')::timestamptz,durable_row_data->'recent',
        (durable_row_data->>'last_at')::timestamptz,nullif(durable_row_data->>'waiting_since','')::timestamptz,
        nullif(durable_row_data->>'synced_at','')::timestamptz,(durable_row_data->>'creation_time')::timestamptz,
        op->>'deployment',source_id,durable_row_data->'source_record')
       RETURNING to_jsonb(cockpit_wa_thread_captures.*) INTO new_row;
      ELSIF tab='replyDrafts' THEN
       INSERT INTO public.cockpit_wa_draft_history(source_app,chat_id,status,job_id,draft,at,last_at,creation_time,source_deployment,source_id,source_record)
       VALUES(durable_row_data->>'source_app',durable_row_data->>'chat_id',durable_row_data->>'status',
        durable_row_data->>'job_id',durable_row_data->>'draft',
        (durable_row_data->>'at')::timestamptz,nullif(durable_row_data->>'last_at','')::timestamptz,
        (durable_row_data->>'creation_time')::timestamptz,
        op->>'deployment',source_id,durable_row_data->'source_record')
       RETURNING to_jsonb(cockpit_wa_draft_history.*) INTO new_row;
      END IF;
      IF tab IN('ceoTeamStatus','planItems','ceoDaily','ceoClientBilling','clientPrefs','hotList','looseDismissed','moneyGoals','projections','renewalPlans','callBriefs','waThreads','replyDrafts') THEN
       INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,source_system,before,after)
       VALUES('bootstrap.insert',target,coalesce(new_row->>'chat_id',new_row->>'key',new_row->>'id',new_row->>'person_key',new_row->>'task_id',concat_ws(':',new_row->>'week_start',new_row->>'owner_email',new_row->>'metric'),concat_ws(':',new_row->>'day',new_row->>'clickup_task_id',new_row->>'metric',new_row->>'scope')),app,'convex',NULL,new_row);
      ELSE
      INSERT INTO public.cockpit_issue_reports(kind,text,status,batch,note,created_by,source_system,source_id,app,page,role,actor_email,metadata)
      VALUES(durable_row_data->>'kind',durable_row_data->>'text',durable_row_data->>'status',durable_row_data->>'batch',
       durable_row_data->>'note',durable_row_data->>'created_by','convex',source_id,app,durable_row_data->>'page',
       durable_row_data->>'role',durable_row_data->>'actor_email',durable_row_data->'metadata');
      END IF;
     END IF;
    END IF;
    SELECT coalesce(array_agg(value), '{}') INTO clients FROM jsonb_array_elements_text(item->'client_names') value;
    INSERT INTO public.cockpit_runtime_imports(app,table_name,source_id,source_sha256,target_data,target_clients,source_snapshot_at,run_id)
    VALUES(app,tab,source_id,op->>'source_sha256',ledger_data,clients,stamp,p_run_id)
    ON CONFLICT ON CONSTRAINT cockpit_runtime_imports_pkey DO UPDATE SET source_sha256=excluded.source_sha256,
     target_data=excluded.target_data,target_clients=excluded.target_clients,source_snapshot_at=excluded.source_snapshot_at,run_id=excluded.run_id;
   END LOOP;
   FOR retire IN SELECT value FROM jsonb_array_elements(op->'retirements') LOOP
    source_id:=retire->>'source_id';
    IF nullif(source_id,'') IS NULL OR tab IN('members','ceoAudit') THEN RAISE EXCEPTION 'Invalid durable tombstone';END IF;
    SELECT * INTO prior FROM public.cockpit_runtime_imports i WHERE i.app=op->>'app' AND i.table_name=op->>'table' AND i.source_id=retire->>'source_id';
    IF prior.source_id IS NULL OR prior.tombstone THEN RAISE EXCEPTION 'Durable tombstone lacks active prior import';END IF;
    IF tab='feedback' THEN
     EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t WHERE source_system=''convex'' AND source_id=$1',target) INTO current_rows USING source_id;
    ELSIF tab='clientPrefs' THEN
     SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('client_name',p.client_name)),'[]'::jsonb)
     INTO current_rows FROM public.cockpit_csm_client_preferences t
     JOIN public.cockpit_client_profiles p ON p.id=t.client_profile_id
     WHERE t.source_deployment=op->>'deployment' AND t.source_id=retire->>'source_id';
    ELSIF tab='looseDismissed' THEN
     SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('client_name',p.client_name)),'[]'::jsonb)
     INTO current_rows FROM public.cockpit_csm_loose_dismissals t
     JOIN public.cockpit_client_profiles p ON p.id=t.client_profile_id
     WHERE t.source_deployment=op->>'deployment' AND t.source_id=retire->>'source_id';
    ELSIF tab IN('projections','renewalPlans') THEN
     EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t WHERE source_deployment=$1 AND source_id=$2',target) INTO current_rows USING op->>'deployment',source_id;
    ELSE
     EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t WHERE source_deployment=$1 AND source_id=$2',target) INTO current_rows USING op->>'deployment',source_id;
    END IF;
    IF jsonb_array_length(current_rows)<>1 OR public.cockpit_native_durable_projection(tab,current_rows->0) IS DISTINCT FROM prior.target_data THEN
     RAISE EXCEPTION 'Durable history changed or disappeared before tombstone';
    END IF;
    UPDATE public.cockpit_runtime_imports AS imported SET tombstone=true,source_snapshot_at=stamp,run_id=p_run_id
     WHERE imported.app=op->>'app' AND imported.table_name=op->>'table' AND imported.source_id=retire->>'source_id';
   END LOOP;
   IF tab='ceoTeamStatus' THEN
    UPDATE public.cockpit_team_status_state SET history_ready=true WHERE id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Staffing history state disappeared';END IF;
   END IF;
   CONTINUE;
  END IF;
  IF op->>'kind' IS DISTINCT FROM 'source' THEN RAISE EXCEPTION 'Unsupported bootstrap operation';END IF;
  target:='cockpit_'||family||'_sources';rows:=op->'rows';stamp:=(op->>'source_snapshot_at')::timestamptz;
  IF stamp IS NULL OR stamp<clock_timestamp()-interval '24 hours' OR stamp>clock_timestamp()+interval '1 minute'
   OR coalesce(op->>'source_sha256','') !~ '^[0-9a-f]{64}$' OR coalesce(op->>'table_sha256','') !~ '^[0-9a-f]{64}$'
   OR jsonb_typeof(rows) IS DISTINCT FROM 'array' OR jsonb_typeof(op->'source_count') IS DISTINCT FROM 'number'
   OR (op->>'source_count') !~ '^[0-9]+$' OR (op->>'source_count')::integer<>jsonb_array_length(rows)
  THEN RAISE EXCEPTION 'Source evidence missing or stale';END IF;
  EXECUTE format('SELECT to_jsonb(s) FROM public.%I s WHERE table_name=$1','cockpit_'||family||'_source_state') INTO current_state USING tab;
  IF current_state IS NULL THEN RAISE EXCEPTION 'Unsupported canonical source table';END IF;
  IF current_state->>'ready'='true' THEN
   IF current_state->'row_count' IS NULL OR current_state->'row_count'='null'::jsonb
    OR (current_state->>'row_count') !~ '^[0-9]+$' OR current_state->'source_snapshot_at' IS NULL
    OR current_state->'source_snapshot_at'='null'::jsonb
    OR (current_state->>'source_snapshot_at')::timestamptz>clock_timestamp()+interval '1 minute'
   THEN RAISE EXCEPTION 'Ready source state is missing exact count or snapshot';END IF;
   EXECUTE format('SELECT count(*),count(*) FILTER(WHERE source_snapshot_at=$2::timestamptz) FROM public.%I WHERE table_name=$1',target)
    INTO exact_count,stamped_count USING tab,current_state->>'source_snapshot_at';
   IF exact_count<>(current_state->>'row_count')::bigint OR stamped_count<>exact_count THEN RAISE EXCEPTION 'Ready source target count or snapshot is inconsistent';END IF;
  ELSIF current_state->>'ready'='false' AND current_state->'row_count'='null'::jsonb AND current_state->'source_snapshot_at'='null'::jsonb THEN
   EXECUTE format('SELECT count(*) FROM public.%I WHERE table_name=$1',target) INTO exact_count USING tab;
   IF exact_count<>0 THEN RAISE EXCEPTION 'Uninitialized source state contains target rows';END IF;
  ELSE RAISE EXCEPTION 'Canonical source_state is partially initialized';END IF;
  IF (current_state->>'source_snapshot_at')::timestamptz>stamp THEN RAISE EXCEPTION 'Target source is newer than archive';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(rows) LOOP
   IF nullif(item->>'source_id','') IS NULL OR item->'data'->>'_id' IS DISTINCT FROM item->>'source_id'
    OR jsonb_typeof(item->'client_names') IS DISTINCT FROM 'array'
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'client_names') AS names(value) WHERE jsonb_typeof(value)<>'string')
   THEN RAISE EXCEPTION 'Invalid source identity or client scope';END IF;
   EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE table_name=$1 AND source_id=$2',target) INTO old USING tab,item->>'source_id';
   SELECT * INTO prior FROM public.cockpit_runtime_imports i WHERE i.app=op->>'app' AND i.table_name=tab AND i.source_id=item->>'source_id';
   IF prior.tombstone THEN RAISE EXCEPTION 'Protected import tombstone';END IF;
   IF old IS NULL AND prior.source_id IS NOT NULL THEN RAISE EXCEPTION 'Previously imported source target disappeared';END IF;
   IF old IS NOT NULL AND (old->'data' IS DISTINCT FROM item->'data' OR old->'client_names' IS DISTINCT FROM item->'client_names') AND (prior.source_id IS NULL OR old->'data' IS DISTINCT FROM prior.target_data OR old->'client_names' IS DISTINCT FROM to_jsonb(prior.target_clients)) THEN RAISE EXCEPTION 'Protected native or human source row';END IF;
   SELECT array_agg(value) INTO clients FROM jsonb_array_elements_text(item->'client_names');
   EXECUTE format('INSERT INTO public.%I(table_name,source_id,client_names,data,source_snapshot_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(table_name,source_id) DO UPDATE SET client_names=excluded.client_names,data=excluded.data,source_snapshot_at=excluded.source_snapshot_at',target) USING tab,item->>'source_id',coalesce(clients,'{}'),item->'data',stamp;
   INSERT INTO public.cockpit_runtime_imports(app,table_name,source_id,source_sha256,target_data,target_clients,source_snapshot_at,run_id)
   VALUES(app,tab,item->>'source_id',op->>'source_sha256',item->'data',coalesce(clients,'{}'),stamp,p_run_id)
   ON CONFLICT ON CONSTRAINT cockpit_runtime_imports_pkey DO UPDATE SET source_sha256=excluded.source_sha256,target_data=excluded.target_data,target_clients=excluded.target_clients,source_snapshot_at=excluded.source_snapshot_at,run_id=excluded.run_id;
  END LOOP;
  FOR old IN EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE table_name=$1 AND NOT(source_id IN(SELECT value->>''source_id'' FROM jsonb_array_elements($2)))',target) USING tab,rows LOOP
   SELECT * INTO prior FROM public.cockpit_runtime_imports i WHERE i.app=op->>'app' AND i.table_name=tab AND i.source_id=old->>'source_id';
   IF prior.source_id IS NULL OR prior.tombstone OR old->'data' IS DISTINCT FROM prior.target_data OR old->'client_names' IS DISTINCT FROM to_jsonb(prior.target_clients) THEN RAISE EXCEPTION 'Protected absent source row';END IF;
   EXECUTE format('DELETE FROM public.%I WHERE table_name=$1 AND source_id=$2',target) USING tab,old->>'source_id';
   UPDATE public.cockpit_runtime_imports i SET tombstone=true,run_id=p_run_id,source_snapshot_at=stamp WHERE i.app=op->>'app' AND i.table_name=tab AND i.source_id=old->>'source_id';
  END LOOP;
  EXECUTE format('SELECT count(*),count(*) FILTER(WHERE source_snapshot_at=$2::timestamptz) FROM public.%I WHERE table_name=$1',target)
   INTO exact_count,stamped_count USING tab,stamp;
  IF exact_count<>jsonb_array_length(rows) OR stamped_count<>exact_count THEN RAISE EXCEPTION 'Bootstrap source rows do not match exact count and snapshot';END IF;
  EXECUTE format('UPDATE public.%I SET ready=true,row_count=$2,source_snapshot_at=$3 WHERE table_name=$1','cockpit_'||family||'_source_state')
   USING tab,exact_count,stamp;
  GET DIAGNOSTICS stamped_count=ROW_COUNT;
  IF stamped_count<>1 THEN RAISE EXCEPTION 'Bootstrap source_state update was not applied';END IF;
 END LOOP;
 PERFORM public.cockpit_native_media_fence(p_run_id,p_lease_token);
 v_receipt:=jsonb_build_object('status','bootstrapped','run_id',p_run_id,'plan_sha',p_plan_sha,'scope',p_plan->'scope','published_at',clock_timestamp());
 UPDATE public.cockpit_native_media_runs SET status='bootstrapped',plan_sha=p_plan_sha,plan=p_plan,receipt=v_receipt,updated_at=clock_timestamp() WHERE run_id=p_run_id;
 RETURN v_receipt;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_native_media_doctor() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE checks jsonb:='[]'; ready boolean:=true; bucket boolean:=false; result jsonb;
BEGIN
 BEGIN
  result:=public.cockpit_native_media_state();checks:=checks||jsonb_build_array(jsonb_build_object('key','canonical_sources','ok',true,'manifest',result->'expected'));
 EXCEPTION WHEN OTHERS THEN ready:=false;checks:=checks||jsonb_build_array(jsonb_build_object('key','canonical_sources','ok',false,'error',SQLERRM));END;
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM storage.buckets WHERE id=''cockpit-ad-stills'' AND public AND file_size_limit=5242880)' INTO bucket;
  bucket:=bucket AND coalesce((SELECT relrowsecurity FROM pg_class WHERE oid='storage.objects'::regclass),false)
   AND has_table_privilege('service_role','storage.objects','SELECT,INSERT')
   AND (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname IN('cockpit_native_stills_browser_insert','cockpit_native_stills_browser_update','cockpit_native_stills_browser_delete') AND permissive='RESTRICTIVE')=3;
 END IF;
 checks:=checks||jsonb_build_array(jsonb_build_object('key','still_bucket','ok',bucket));
 RETURN jsonb_build_object('ok',ready AND bucket,'read_only',true,'checks',checks,'providers','Not checked; a dry run must verify provider contracts before activation');
END $$;
REVOKE ALL ON FUNCTION public.cockpit_native_bootstrap_inventory(),public.cockpit_native_bootstrap_publish(uuid,uuid,jsonb,text),public.cockpit_native_media_doctor() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_native_bootstrap_inventory(),public.cockpit_native_bootstrap_publish(uuid,uuid,jsonb,text),public.cockpit_native_media_doctor() TO service_role;
COMMIT;
