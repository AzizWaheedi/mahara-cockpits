-- Lead form changes from the media buyer's funnel view (cockpit-media-api
-- forms.publish and forms.switch) are campaign changes like any other:
-- the sentence the function confirms goes on the campaign's "Changes and
-- results" log, the judging window restarts (Meta relearns after a creative
-- swap), and the change joins the ClickUp change log.
-- Both functions are the live definitions read on 2026-10-10 with only the two
-- operations added; grants are kept by CREATE OR REPLACE.
BEGIN;

CREATE OR REPLACE FUNCTION public.cockpit_media_action_effects()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE note text; learning boolean; draft_id bigint;
BEGIN
 IF NEW.operation='ceo.b2bLaunch.launch' AND NEW.state IN ('confirmed','reconcile') THEN
  draft_id:=(NEW.request->'args'->>'id')::bigint;
  IF NEW.state='confirmed' THEN
   IF coalesce(NEW.result->>'metaCampaignId','') !~ '^\d{5,}$' OR coalesce(NEW.result->>'metaAdsetId','') !~ '^\d{5,}$' OR jsonb_typeof(NEW.result->'metaAdIds') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.result->'metaAdIds')=0 THEN RAISE EXCEPTION 'Verified campaign, ad set and ad receipts required'; END IF;
   UPDATE public.cockpit_ad_drafts SET status='launched',meta_campaign_id=NEW.result->>'metaCampaignId',meta_adset_id=NEW.result->>'metaAdsetId',meta_ad_ids=ARRAY(SELECT jsonb_array_elements_text(NEW.result->'metaAdIds')),launched_at=now(),error=NEW.result->>'error' WHERE id=draft_id AND launch_action_id=NEW.id;
  ELSE UPDATE public.cockpit_ad_drafts SET status='failed',error='Launch outcome needs reconciliation. Do not launch again. '||coalesce(NEW.result->>'error','') WHERE id=draft_id AND launch_action_id=NEW.id; END IF;
 END IF;
 IF NEW.state<>'confirmed' OR nullif(NEW.campaign_name,'') IS NULL THEN RETURN NEW; END IF;
 learning:=NEW.operation IN ('cockpit.launchBuild','execute.runAction','control.setStatus','edit.setAdSetBudget','edit.duplicateAdSet','edit.newAdsFromExisting','edit.addCreativeToCampaign','forms.publish','forms.switch');
 note:=CASE NEW.operation WHEN 'cockpit.launchBuild' THEN 'Created the campaign and ad set, paused for review' WHEN 'execute.runAction' THEN NEW.result->>'did' WHEN 'cockpit.askForDetail' THEN 'Asked for more detail on the board task' WHEN 'control.setStatus' THEN CASE WHEN (NEW.request->'args'->>'active')::boolean THEN 'Turned on ' ELSE 'Paused ' END||coalesce(NEW.request->'args'->>'name','the selected ad')
  WHEN 'edit.setAdSetBudget' THEN 'Changed the daily budget to $'||(NEW.request->'args'->>'dailyBudget')
  WHEN 'edit.duplicateAdSet' THEN 'Created a paused copy of the ad set'
  WHEN 'edit.newAdsFromExisting' THEN 'Created paused ads with approved copy'
  WHEN 'edit.addCreativeToCampaign' THEN 'Added a new creative, paused for review'
  WHEN 'forms.publish' THEN NEW.result->>'did'
  WHEN 'forms.switch' THEN NEW.result->>'did'
  WHEN 'edit.askViktorFor' THEN 'Sent a request to Aziz: '||left(NEW.request->'args'->>'request',160)
  WHEN 'board.setAdStatus' THEN 'Changed the board status to '||(NEW.request->'args'->>'status')
  WHEN 'board.setAdvertisingCities' THEN 'Updated the advertising cities on the board'
  WHEN 'board.renameCard' THEN 'Renamed the board card'
  WHEN 'board.addToBoard' THEN 'Added the campaign to the board'
  ELSE NULL END;
 IF note IS NOT NULL THEN INSERT INTO public.cockpit_campaign_action_messages VALUES(NEW.id,NEW.campaign_name,NEW.actor_id,note,coalesce(NEW.completed_at,now()),CASE WHEN learning THEN coalesce(NEW.completed_at,now()) ELSE NULL END) ON CONFLICT(id) DO NOTHING; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_sweep(p_kind text DEFAULT NULL::text, p_source_id text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE since timestamptz; n integer:=0; k integer;
BEGIN
 IF p_kind IS NOT NULL AND p_kind NOT IN('decision','manual_change','provider_action') THEN RAISE EXCEPTION 'Unsupported writeback kind'; END IF;
 SELECT enqueue_since INTO since FROM public.cockpit_clickup_writeback_config WHERE singleton;
 IF since IS NULL THEN RAISE EXCEPTION 'The ClickUp writeback configuration row is missing'; END IF;
 IF p_kind IS NULL OR p_kind='decision' THEN
  INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,campaign_name,payload)
  SELECT 'decision:'||d.id,'decision','cockpit_decisions',d.id::text,d.subject,jsonb_build_object(
    'decisionId',d.id,'subject',d.subject,'action',d.action,'kind',coalesce(nullif(btrim(d.kind),''),'decision'),
    'evidence',coalesce(d.evidence,''),'reason',nullif(btrim(coalesce(d.reason,'')),''),
    'snooze',nullif(btrim(coalesce(d.metadata->>'snooze','')),''),
    'reroutedTo',nullif(btrim(coalesce(d.metadata->>'reroutedTo',d.metadata->>'rerouted_to','')),''),
    'byEmail',(SELECT a.actor_email FROM public.cockpit_audit_log a WHERE a.entity_type='cockpit_decisions' AND a.entity_id=d.id::text
      AND a.action='INSERT' AND a.actor_email LIKE '%@%' ORDER BY a.created_at LIMIT 1),
    'at',round(extract(epoch FROM coalesce(d.logged_at,d.created_at))*1000))
  FROM public.cockpit_decisions d
  WHERE d.role='media_buyer' AND d.source_system='supabase' AND d.created_at>=since
   AND (p_source_id IS NULL OR d.id::text=p_source_id)
   AND NOT EXISTS(SELECT 1 FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key='decision:'||d.id)
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS k=ROW_COUNT; n:=n+k;
 END IF;
 IF p_kind IS NULL OR p_kind='manual_change' THEN
  INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,campaign_name,payload)
  SELECT 'manual:'||r.id,'manual_change','cockpit_media_native_records',r.id::text,r.campaign_name,jsonb_build_object(
    'recordId',r.id,'campaignName',coalesce(nullif(r.data->>'campaignName',''),r.campaign_name),'adName',nullif(btrim(coalesce(r.data->>'adName','')),''),
    'what',coalesce(r.data->>'what',''),'by',coalesce(nullif(r.data->>'by',''),(SELECT u.email FROM auth.users u WHERE u.id=r.actor_id),'cockpit'),
    'at',round(extract(epoch FROM r.created_at)*1000))
  FROM public.cockpit_media_native_records r
  WHERE r.kind='manual' AND r.created_at>=since
   AND (p_source_id IS NULL OR r.id::text=p_source_id)
   AND NOT EXISTS(SELECT 1 FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key='manual:'||r.id)
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS k=ROW_COUNT; n:=n+k;
 END IF;
 IF p_kind IS NULL OR p_kind='provider_action' THEN
  INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,campaign_name,payload)
  SELECT 'action:'||m.id,'provider_action','cockpit_campaign_action_messages',m.id::text,m.campaign_name,jsonb_build_object(
    'actionId',m.id,'operation',a.operation,'campaignName',m.campaign_name,'what',m.text,
    'by',coalesce((SELECT u.email FROM auth.users u WHERE u.id=m.actor_id),'cockpit'),
    'at',round(extract(epoch FROM m.at)*1000),
    'adName',CASE WHEN a.operation='control.setStatus' AND coalesce(a.request->'args'->>'level','')<>'campaign' THEN nullif(a.request->'args'->>'name','') END,
    'metaId',CASE WHEN a.operation='control.setStatus' AND a.request->'args'->>'level'='campaign' THEN a.request->'args'->>'metaId' END,
    'syncAdStatus',(a.operation='control.setStatus' AND a.request->'args'->>'level'='campaign')
      OR (a.operation='execute.runAction' AND a.request->'args'->>'action'='Turn it off'))
  FROM public.cockpit_campaign_action_messages m JOIN public.cockpit_media_actions a ON a.id=m.id
  WHERE a.state='confirmed' AND m.at>=since
   AND a.operation IN('control.setStatus','execute.runAction','edit.setAdSetBudget','edit.duplicateAdSet','edit.newAdsFromExisting','edit.addCreativeToCampaign','cockpit.launchBuild','forms.publish','forms.switch')
   AND (p_source_id IS NULL OR m.id::text=p_source_id)
   AND NOT EXISTS(SELECT 1 FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key='action:'||m.id)
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS k=ROW_COUNT; n:=n+k;
 END IF;
 RETURN n;
END $function$;

COMMIT;
