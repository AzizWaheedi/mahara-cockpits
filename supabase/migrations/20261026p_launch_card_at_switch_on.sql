-- The Launch desk makes the Ads Managment card at Switch on, with every answer of the ClickUp form
-- "Launch New Campaign", instead of at the paused build (Muhammed, 26 Oct 2026). Make 9356423 starts
-- on a new card, so its launch message, billing anchor and onboarding map now wait for a live campaign.
-- Each function below is its live definition (pg_get_functiondef, 26 Oct 2026) with one change:
-- 1. cockpit_media_account_scope_before_client_hold allows launch.logCampaign, the cockpit's
--    replacement for the form when a campaign was switched on in Ads Manager.
-- 2. cockpit_media_action_effects keeps the card a confirmed Switch on made, and words a logged launch.
-- 3. The one-pending-intent-per-account index also covers launch.logCampaign, so a double press
--    cannot make two cards. Safe to apply twice.

CREATE OR REPLACE FUNCTION public.cockpit_media_account_scope_before_client_hold(p_operation text, p_clickup_id text, p_account text, p_launch uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE m public.cockpit_members; c jsonb; a jsonb; l public.cockpit_launches; contract numeric; source text;
BEGIN
 m:=public.cockpit_launch_member();
 IF p_operation NOT IN ('launch.readiness','launch.copyIdeas','launch.switchOn','launch.copy','launch.rebuild','launch.new','launch.attachAccount','launch.discard','launch.logCampaign') THEN RAISE EXCEPTION 'Unknown launch operation'; END IF;
 c:=public.cockpit_launch_pipeline(p_clickup_id)->'clients'->0;
 IF p_operation NOT IN ('launch.readiness','launch.copyIdeas') AND (c->>'readOnly')::boolean THEN RAISE EXCEPTION 'This client is stopped. Its launch history is read-only.'; END IF;
 IF p_operation NOT IN ('launch.readiness','launch.copyIdeas','launch.discard') AND c->>'status' NOT IN ('Active','Paused','Launching') THEN RAISE EXCEPTION 'The CSM marks this client Active before a launch'; END IF;
 IF p_operation='launch.readiness' AND p_account IS NULL THEN RETURN jsonb_build_object('actor',auth.uid(),'client',c->>'name','clickupId',p_clickup_id,'locationId',c->>'locationId','account',NULL); END IF;
 IF coalesce(p_account,'') !~ '^[0-9]{5,25}$' THEN RAISE EXCEPTION 'Choose a valid ad account'; END IF;
 SELECT x INTO a FROM jsonb_array_elements(c->'accounts')x WHERE x->>'id'=p_account;
 IF a IS NULL AND p_operation<>'launch.attachAccount' THEN RAISE EXCEPTION 'This ad account is not linked to this client'; END IF;
 IF p_operation='launch.attachAccount' AND EXISTS(SELECT 1 FROM public.cockpit_board_clients b WHERE b.location_id<>c->>'locationId' AND p_account=ANY(public.cockpit_launch_accounts(b.location_id))) THEN RAISE EXCEPTION 'This ad account belongs to another client'; END IF;
 IF p_operation='launch.attachAccount' AND EXISTS(SELECT 1 FROM public.cockpit_board_account_ties WHERE account_id=p_account AND (kept_out OR location_id<>c->>'locationId')) THEN RAISE EXCEPTION 'This ad account is kept out or belongs to another client'; END IF;
 IF p_operation NOT IN ('launch.readiness','launch.copyIdeas','launch.discard') THEN
  IF a->>'status'='3' THEN RAISE EXCEPTION 'This ad account owes Meta a payment. Meta refuses every change on it, pausing included, until the client pays in Ads Manager.'; END IF;
  IF a->>'status'='2' THEN RAISE EXCEPTION 'Meta has disabled this ad account. Nothing can run on it until the client''s appeal is accepted.'; END IF;
  IF a->>'status' IN ('100','101') THEN RAISE EXCEPTION 'This ad account is closed. Choose another account for this client.'; END IF;
 END IF;
 IF p_launch IS NOT NULL THEN
  SELECT * INTO l FROM public.cockpit_launches WHERE id=p_launch;
  IF l.id IS NULL OR l.clickup_id<>p_clickup_id OR l.account_id<>p_account OR l.state NOT IN ('built','switched_on') OR (p_operation IN ('launch.switchOn','launch.discard') AND l.state<>'built') THEN RAISE EXCEPTION 'This launch is unavailable or belongs to another client'; END IF;
 END IF;
 SELECT (x->>'dailyAdSpend')::numeric INTO contract FROM jsonb_array_elements(c->'cards')x WHERE x->>'dailyAdSpend' ~ '^[0-9]+(\.[0-9]+)?$' ORDER BY x->>'taskId' LIMIT 1;
 source:='Ads card';
 IF contract IS NULL AND c->'brief'->'answers'->>'daily_budget' ~ '^[0-9]+(\.[0-9]+)?$' THEN contract:=(c->'brief'->'answers'->>'daily_budget')::numeric; source:='Blueprint part 1'; END IF;
 IF contract IS NULL AND c->'handover'->>'daily_budget' ~ '^[0-9]+(\.[0-9]+)?$' THEN contract:=(c->'handover'->>'daily_budget')::numeric;source:='Kickoff'; END IF;
 RETURN jsonb_build_object('actor',auth.uid(),'client',c->>'name','clickupId',p_clickup_id,'locationId',c->>'locationId','account',p_account,'founder',m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com'),'admin','admin'=ANY(m.roles),'boardStatus',c->>'status','serviceMode',c->>'serviceMode','contractedUsd',contract,'contractSource',CASE WHEN contract IS NOT NULL THEN source END,'launch',CASE WHEN l.id IS NOT NULL THEN to_jsonb(l)-'created_by_email' END);
END $function$;
REVOKE ALL ON FUNCTION public.cockpit_media_account_scope_before_client_hold(text,text,text,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_media_action_effects()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE launch_plan jsonb; launch_scope jsonb; launch_id uuid; note text; learning boolean; draft_id bigint;
BEGIN
 IF NEW.operation IN ('launch.switchOn','launch.copy','launch.rebuild','launch.new') AND NEW.state IN ('confirmed','reconcile') THEN
  launch_plan:=NEW.request->'plan'; launch_scope:=launch_plan->'result';
  IF NEW.state='confirmed' AND (
   coalesce(NEW.result->>'metaCampaignId','') !~ '^[0-9]{5,25}$'
   OR jsonb_typeof(NEW.result->'metaAdsetIds') IS DISTINCT FROM 'array'
   OR jsonb_typeof(NEW.result->'metaAdIds') IS DISTINCT FROM 'array'
   OR jsonb_array_length(NEW.result->'metaAdsetIds')=0 OR jsonb_array_length(NEW.result->'metaAdIds')=0
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.result->'metaAdsetIds')x WHERE x !~ '^[0-9]{5,25}$')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.result->'metaAdIds')x WHERE x !~ '^[0-9]{5,25}$')
  ) THEN RAISE EXCEPTION 'Verified campaign, ad set and ad receipts required'; END IF;
  IF NEW.operation='launch.switchOn' AND nullif(NEW.request->'args'->>'launchId','') IS NOT NULL THEN
   -- A build has no card; the Switch on that makes it records it here.
   UPDATE public.cockpit_launches SET state=CASE WHEN NEW.state='confirmed' THEN 'switched_on' ELSE 'reconcile' END,
    impressions_at_switch=coalesce((NEW.result->>'impressionsAtSwitch')::bigint,0),impression_day=(NEW.result->>'impressionDay')::date,switch_action_id=NEW.id,switched_on_at=CASE WHEN NEW.state='confirmed' THEN now() END,
    card_task_id=coalesce(CASE WHEN NEW.state='confirmed' THEN nullif(NEW.result->>'cardTaskId','') END,card_task_id),updated_at=now()
   WHERE id=(NEW.request->'args'->>'launchId')::uuid AND clickup_id=launch_scope->>'clickupId' AND account_id=launch_scope->>'accountId' AND state='built'
   RETURNING id INTO launch_id;
   IF launch_id IS NULL THEN RAISE EXCEPTION 'Launch changed before the switch receipt'; END IF;
  ELSE
   INSERT INTO public.cockpit_launches(clickup_id,location_id,client_name,account_id,kind,source_account_id,source_campaign_id,campaign_name,budget_usd,budget_level,state,meta_campaign_id,meta_adset_ids,meta_ad_ids,card_task_id,build_action_id,switch_action_id,created_by,created_by_email,switched_on_at,impressions_at_switch,impression_day)
   VALUES(launch_scope->>'clickupId',launch_scope->>'locationId',launch_scope->>'clientName',launch_scope->>'accountId',
    CASE WHEN NEW.operation='launch.switchOn' THEN 'switch_on' ELSE split_part(NEW.operation,'.',2) END,
    launch_scope->>'sourceAccountId',launch_scope->>'sourceCampaignId',NEW.campaign_name,(launch_scope->>'budgetUsd')::numeric,launch_scope->>'budgetLevel',
    CASE WHEN NEW.state='reconcile' THEN 'reconcile' WHEN NEW.operation='launch.switchOn' THEN 'switched_on' ELSE 'built' END,
    CASE WHEN NEW.state='confirmed' THEN NEW.result->>'metaCampaignId' END,
    CASE WHEN NEW.state='confirmed' THEN ARRAY(SELECT jsonb_array_elements_text(NEW.result->'metaAdsetIds')) ELSE '{}' END,
    CASE WHEN NEW.state='confirmed' THEN ARRAY(SELECT jsonb_array_elements_text(NEW.result->'metaAdIds')) ELSE '{}' END,
    CASE WHEN NEW.state='confirmed' THEN NEW.result->>'cardTaskId' END,
    NEW.id,CASE WHEN NEW.operation='launch.switchOn' THEN NEW.id END,NEW.actor_id,(SELECT email FROM auth.users WHERE id=NEW.actor_id),CASE WHEN NEW.state='confirmed' AND NEW.operation='launch.switchOn' THEN now() END,coalesce((NEW.result->>'impressionsAtSwitch')::bigint,0),(NEW.result->>'impressionDay')::date);
  END IF;
 END IF;
 IF NEW.operation IN ('launch.switchOn','launch.copy','launch.rebuild','launch.new') AND NEW.state='reconcile' THEN
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,source_system,metadata) VALUES(NEW.operation||'.reconcile','cockpit_media_actions',NEW.id::text,'media-buyer','meta',jsonb_build_object('actor',NEW.actor_id,'message','Launch outcome needs reconciliation. Do not launch again.'));
 END IF;
 IF NEW.operation='ceo.b2bLaunch.launch' AND NEW.state IN ('confirmed','reconcile') THEN
  draft_id:=(NEW.request->'args'->>'id')::bigint;
  IF NEW.state='confirmed' THEN
   IF coalesce(NEW.result->>'metaCampaignId','') !~ '^\d{5,}$' OR coalesce(NEW.result->>'metaAdsetId','') !~ '^\d{5,}$' OR jsonb_typeof(NEW.result->'metaAdIds') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.result->'metaAdIds')=0 THEN RAISE EXCEPTION 'Verified campaign, ad set and ad receipts required'; END IF;
   UPDATE public.cockpit_ad_drafts SET status='launched',meta_campaign_id=NEW.result->>'metaCampaignId',meta_adset_id=NEW.result->>'metaAdsetId',meta_ad_ids=ARRAY(SELECT jsonb_array_elements_text(NEW.result->'metaAdIds')),launched_at=now(),error=NEW.result->>'error' WHERE id=draft_id AND launch_action_id=NEW.id;
  ELSE UPDATE public.cockpit_ad_drafts SET status='failed',error='Launch outcome needs reconciliation. Do not launch again. '||coalesce(NEW.result->>'error','') WHERE id=draft_id AND launch_action_id=NEW.id; END IF;
 END IF;
 IF NEW.state<>'confirmed' OR nullif(NEW.campaign_name,'') IS NULL THEN RETURN NEW; END IF;
 learning:=NEW.operation IN ('cockpit.launchBuild','execute.runAction','control.setStatus','edit.setAdSetBudget','edit.duplicateAdSet','edit.newAdsFromExisting','edit.addCreativeToCampaign','forms.publish','forms.switch','launch.switchOn','launch.copy','launch.rebuild','launch.new');
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
  WHEN 'launch.switchOn' THEN 'Switched the campaign on. Waiting for first impressions.'
  WHEN 'launch.copy' THEN 'Copied the client campaign, paused for review'
  WHEN 'launch.rebuild' THEN 'Rebuilt the client campaign on its clean account, paused for review'
  WHEN 'launch.new' THEN 'Created the client campaign from Blueprint part 1, paused for review'
  WHEN 'launch.attachAccount' THEN 'Linked the client ad account'
  WHEN 'launch.logCampaign' THEN 'Logged the Ads Manager launch on the board'
  ELSE NULL END;
 IF note IS NOT NULL THEN INSERT INTO public.cockpit_campaign_action_messages VALUES(NEW.id,NEW.campaign_name,NEW.actor_id,note,coalesce(NEW.completed_at,now()),CASE WHEN learning THEN coalesce(NEW.completed_at,now()) ELSE NULL END) ON CONFLICT(id) DO NOTHING; END IF;
 RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.cockpit_media_action_effects() FROM PUBLIC,anon,authenticated;

DROP INDEX IF EXISTS public.cockpit_launch_intent_account;
CREATE UNIQUE INDEX cockpit_launch_intent_account ON public.cockpit_media_actions ((request->'args'->>'accountId')) WHERE operation IN ('launch.new','launch.copy','launch.rebuild','launch.switchOn','launch.attachAccount','launch.logCampaign') AND state IN ('pending','reconcile');
