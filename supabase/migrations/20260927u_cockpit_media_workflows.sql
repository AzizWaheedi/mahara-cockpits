BEGIN;
ALTER TABLE public.cockpit_ad_drafts ADD COLUMN IF NOT EXISTS build_request_id uuid;
ALTER TABLE public.cockpit_ad_drafts ADD COLUMN IF NOT EXISTS build_request_args jsonb;
ALTER TABLE public.cockpit_ad_drafts ADD COLUMN IF NOT EXISTS launch_action_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_ad_drafts_build_request ON public.cockpit_ad_drafts(build_request_id) WHERE build_request_id IS NOT NULL;
REVOKE ALL ON public.cockpit_ad_drafts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_ad_drafts TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.cockpit_ad_drafts_id_seq TO service_role;
CREATE OR REPLACE FUNCTION public.cockpit_media_scope(p_operation text,p_campaign text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members; c public.cockpit_campaigns; n integer; founder boolean; client text; feed jsonb; hits jsonb;
BEGIN
 SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users u ON u.id=cm.auth_user_id
 WHERE cm.auth_user_id=auth.uid() AND cm.active AND u.email_confirmed_at IS NOT NULL
 AND cm.email=lower(btrim(u.email));
 IF m.auth_user_id IS NULL THEN RAISE EXCEPTION 'Current confirmed membership required'; END IF;
 founder:=m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com');
 IF p_operation IN ('ceo.b2bControl.setStatus','ceo.ltv.apply') OR p_operation LIKE 'ceo.b2bManage.%' OR p_operation LIKE 'ceo.b2bLaunch.%' THEN
   IF NOT founder THEN RAISE EXCEPTION 'Founder access required'; END IF;
   RETURN jsonb_build_object('actor',auth.uid(),'account','746108264865897','founder',true);
 END IF;
 IF NOT(founder OR 'admin'=ANY(m.roles) OR 'media_buyer'=ANY(m.roles)) THEN RAISE EXCEPTION 'Media buyer access required'; END IF;
 IF p_operation IN ('board.adStatusOptions','board.advertisingCityOptions') THEN
   RETURN jsonb_build_object('actor',auth.uid());
 END IF;
 SELECT count(*) INTO n FROM public.cockpit_campaigns WHERE NOT source_deleted AND raw_data->>'campaignName'=p_campaign;
 IF n=0 AND p_operation IN ('board.addToBoard','board.dismissOffBoard') THEN
  IF to_regprocedure('public.cockpit_media_source_read()') IS NULL THEN RAISE EXCEPTION 'The verified media source feed is not ready'; END IF;
  feed:=public.cockpit_media_source_read();
  SELECT coalesce(jsonb_agg(r),'[]') INTO hits FROM jsonb_array_elements(coalesce(feed->'tables'->'offBoardCampaigns','[]')) r WHERE r->>'campaignName'=p_campaign;
  IF jsonb_array_length(hits)<>1 THEN RAISE EXCEPTION 'Off-board campaign is missing or ambiguous'; END IF;
  client:=coalesce(nullif(hits->0->>'clientName',''),nullif(hits->0->>'accountName',''));
  IF client IS NULL OR NOT(founder OR 'admin'=ANY(m.roles) OR cardinality(m.clients)=0 OR EXISTS(SELECT 1 FROM unnest(m.clients) allowed_client WHERE lower(btrim(allowed_client))=lower(btrim(client)))) THEN RAISE EXCEPTION 'That client is not on your access list'; END IF;
  RETURN jsonb_build_object('actor',auth.uid(),'client',client,'campaignName',p_campaign,'task',NULL);
 END IF;
 IF n<>1 THEN RAISE EXCEPTION 'Campaign is missing or ambiguous; refresh the campaign source'; END IF;
 SELECT * INTO c FROM public.cockpit_campaigns WHERE NOT source_deleted AND raw_data->>'campaignName'=p_campaign;
 -- Older imports accidentally put campaignName into client_name. Prefer the explicit source identity.
 client:=coalesce(nullif(btrim(c.raw_data->>'clientName'),''),nullif(btrim(c.raw_data->>'accountName'),''),c.client_name);
 IF NOT(founder OR 'admin'=ANY(m.roles) OR cardinality(m.clients)=0 OR EXISTS(
   SELECT 1 FROM unnest(m.clients) name WHERE lower(btrim(name))=lower(btrim(client))))
 THEN RAISE EXCEPTION 'That client is not on your access list'; END IF;
 RETURN jsonb_build_object('actor',auth.uid(),'campaign',c.meta_campaign_id,'account',regexp_replace(c.meta_account_id,'^act_',''),
   'task',c.task_id,'client',client,'campaignName',p_campaign);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_scope(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_media_scope(text,text) TO authenticated;


CREATE FUNCTION public.cockpit_b2b_draft_action(p_action text,p_args jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.cockpit_ad_drafts; previous jsonb; uid uuid:=auth.uid(); email text; request_id uuid; ids text[]; wanted text;
BEGIN
 IF NOT public.cockpit_is_ceo() THEN RAISE EXCEPTION 'Founder access required'; END IF;
 SELECT u.email INTO email FROM auth.users u WHERE u.id=uid;
 IF p_action='list' THEN RETURN coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM(SELECT * FROM public.cockpit_ad_drafts WHERE status<>'discarded' ORDER BY created_at DESC LIMIT 20)r),'[]'); END IF;
 IF p_action='begin' THEN
  request_id:=(p_args->>'requestId')::uuid;
  IF request_id IS NULL OR p_args->>'kind' NOT IN ('lead_gen','retargeting') OR length(btrim(p_args->>'brief'))<12 OR (p_args->>'dailyBudgetUsd')::numeric NOT BETWEEN 5 AND 5000 THEN RAISE EXCEPTION 'Review kind, brief and budget'; END IF;
  SELECT * INTO d FROM public.cockpit_ad_drafts WHERE build_request_id=request_id;
  IF FOUND THEN IF d.build_request_args IS DISTINCT FROM p_args THEN RAISE EXCEPTION 'Build request id was already used for different inputs'; END IF; RETURN jsonb_build_object('created',false,'draft',to_jsonb(d)); END IF;
  wanted:='MaharaMedia | '||CASE WHEN p_args->>'kind'='retargeting' THEN 'Retargeting' ELSE 'Lead Gen' END||' | '||to_char(now() AT TIME ZONE 'Asia/Kuwait','YYYY-MM-DD');
  INSERT INTO public.cockpit_ad_drafts(kind,name,brief,daily_budget_usd,created_by,build_request_id,build_request_args) VALUES(p_args->>'kind',wanted,btrim(p_args->>'brief'),(p_args->>'dailyBudgetUsd')::numeric,email,request_id,p_args) RETURNING * INTO d;
 ELSIF p_action IN ('get','save','discard') THEN
  SELECT * INTO d FROM public.cockpit_ad_drafts WHERE id=(p_args->>'id')::bigint FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found'; END IF;
  IF p_action='get' THEN RETURN to_jsonb(d); END IF;
  previous:=to_jsonb(d);
  IF d.status IN ('launching','launched') OR d.launch_action_id IS NOT NULL THEN RAISE EXCEPTION 'This launch needs reconciliation or is already on Meta'; END IF;
  IF p_action='discard' THEN UPDATE public.cockpit_ad_drafts SET status='discarded' WHERE id=d.id RETURNING * INTO d;
  ELSE
   IF d.status NOT IN ('ready','failed') THEN RAISE EXCEPTION 'This draft is not editable yet'; END IF;
   wanted:=btrim(p_args->>'name');
   IF nullif(wanted,'') IS NULL OR length(wanted)>200 OR (p_args->>'dailyBudgetUsd')::numeric NOT BETWEEN 5 AND 5000 THEN RAISE EXCEPTION 'Review name and budget'; END IF;
   IF (d.kind='retargeting' AND wanted !~* 'retarget|remarket|hammer them') OR (d.kind='lead_gen' AND wanted ~* 'retarget|remarket|hammer them|hiring|recruit') THEN RAISE EXCEPTION 'Keep the campaign kind in its name'; END IF;
   IF jsonb_typeof(p_args->'variants') IS DISTINCT FROM 'array' OR jsonb_array_length(p_args->'variants')>5 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_args->'variants') v WHERE nullif(btrim(v->>'headline'),'') IS NULL OR nullif(btrim(v->>'primaryText'),'') IS NULL) THEN RAISE EXCEPTION 'Approve at most five complete variants'; END IF;
   UPDATE public.cockpit_ad_drafts SET name=wanted,daily_budget_usd=(p_args->>'dailyBudgetUsd')::numeric,variants=p_args->'variants',status='ready',error=NULL WHERE id=d.id RETURNING * INTO d;
  END IF;
 ELSE RAISE EXCEPTION 'Unknown draft action'; END IF;
 RETURN CASE WHEN p_action='begin' THEN jsonb_build_object('created',true,'draft',to_jsonb(d)) ELSE to_jsonb(d) END;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_b2b_draft_action(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_b2b_draft_action(text,jsonb) TO authenticated;
CREATE FUNCTION public.cockpit_claim_b2b_launch(p_action_id uuid,p_draft_id bigint,p_expected jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.cockpit_ad_drafts; a public.cockpit_media_actions;
BEGIN
 SELECT * INTO d FROM public.cockpit_ad_drafts WHERE id=p_draft_id FOR UPDATE;
 SELECT * INTO a FROM public.cockpit_media_actions WHERE id=p_action_id;
 IF d.id IS NULL OR to_jsonb(d) IS DISTINCT FROM p_expected OR d.status NOT IN ('ready','failed') OR d.launch_action_id IS NOT NULL OR d.meta_campaign_id IS NOT NULL THEN RAISE EXCEPTION 'Draft changed or already has a launch intent'; END IF;
 IF a.id IS NULL OR a.operation<>'ceo.b2bLaunch.launch' OR a.state<>'pending' OR (a.request->'args'->>'id')::bigint<>d.id THEN RAISE EXCEPTION 'Matching durable launch intent required'; END IF;
 UPDATE public.cockpit_ad_drafts SET status='launching',launch_action_id=p_action_id,error=NULL WHERE id=d.id;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_claim_b2b_launch(uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_claim_b2b_launch(uuid,bigint,jsonb) TO service_role;

CREATE TABLE public.cockpit_campaign_action_messages(
 id uuid PRIMARY KEY REFERENCES public.cockpit_media_actions(id),campaign_name text NOT NULL,actor_id uuid NOT NULL,
 text text NOT NULL,at timestamptz NOT NULL,learning_started_at timestamptz
);
CREATE TABLE public.cockpit_offboard_dismissals(campaign_name text PRIMARY KEY,actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.cockpit_campaign_action_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_offboard_dismissals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_campaign_action_messages,public.cockpit_offboard_dismissals FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.cockpit_campaign_action_messages,public.cockpit_offboard_dismissals TO service_role;
CREATE FUNCTION public.cockpit_media_action_effects() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 learning:=NEW.operation IN ('cockpit.launchBuild','execute.runAction','control.setStatus','edit.setAdSetBudget','edit.duplicateAdSet','edit.newAdsFromExisting','edit.addCreativeToCampaign');
 note:=CASE NEW.operation WHEN 'cockpit.launchBuild' THEN 'Created the campaign and ad set, paused for review' WHEN 'execute.runAction' THEN NEW.result->>'did' WHEN 'cockpit.askForDetail' THEN 'Asked for more detail on the board task' WHEN 'control.setStatus' THEN CASE WHEN (NEW.request->'args'->>'active')::boolean THEN 'Turned on ' ELSE 'Paused ' END||coalesce(NEW.request->'args'->>'name','the selected ad')
  WHEN 'edit.setAdSetBudget' THEN 'Changed the daily budget to $'||(NEW.request->'args'->>'dailyBudget')
  WHEN 'edit.duplicateAdSet' THEN 'Created a paused copy of the ad set'
  WHEN 'edit.newAdsFromExisting' THEN 'Created paused ads with approved copy'
  WHEN 'edit.addCreativeToCampaign' THEN 'Added a new creative, paused for review'
  WHEN 'edit.askViktorFor' THEN 'Sent a request to Aziz: '||left(NEW.request->'args'->>'request',160)
  WHEN 'board.setAdStatus' THEN 'Changed the board status to '||(NEW.request->'args'->>'status')
  WHEN 'board.setAdvertisingCities' THEN 'Updated the advertising cities on the board'
  WHEN 'board.renameCard' THEN 'Renamed the board card'
  WHEN 'board.addToBoard' THEN 'Added the campaign to the board'
  ELSE NULL END;
 IF note IS NOT NULL THEN INSERT INTO public.cockpit_campaign_action_messages VALUES(NEW.id,NEW.campaign_name,NEW.actor_id,note,coalesce(NEW.completed_at,now()),CASE WHEN learning THEN coalesce(NEW.completed_at,now()) ELSE NULL END) ON CONFLICT(id) DO NOTHING; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cockpit_media_confirmed_effects AFTER UPDATE OF state ON public.cockpit_media_actions FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_action_effects();
CREATE FUNCTION public.cockpit_dismiss_offboard(p_campaign text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.cockpit_media_scope('board.dismissOffBoard',p_campaign);
 INSERT INTO public.cockpit_offboard_dismissals(campaign_name,actor_id) VALUES(p_campaign,auth.uid()) ON CONFLICT DO NOTHING;
 IF FOUND THEN INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,source_system,metadata) VALUES('board.dismissOffBoard','campaign',p_campaign,'media-buyer','supabase',jsonb_build_object('actor',auth.uid())); END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_dismiss_offboard(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_dismiss_offboard(text) TO authenticated;
CREATE FUNCTION public.cockpit_media_campaign_history(p_campaign text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.cockpit_media_scope('campaignChat.read',p_campaign);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('_id',id,'campaignName',campaign_name,'author','her','text',text,'at',extract(epoch FROM at)*1000,'kind','action','status','done','pending',false,'ok',true) ORDER BY at) FROM public.cockpit_campaign_action_messages WHERE campaign_name=p_campaign),'[]');
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_campaign_history(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_media_campaign_history(text) TO authenticated;
CREATE FUNCTION public.cockpit_media_live_campaigns() RETURNS SETOF public.cockpit_campaigns LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.cockpit_campaigns; last_change timestamptz; days numeric; note jsonb; bleeding boolean;
BEGIN
 PERFORM public.cockpit_media_scope('board.adStatusOptions',NULL);
 FOR c IN SELECT * FROM public.cockpit_campaigns WHERE NOT source_deleted ORDER BY rank NULLS LAST,id LOOP
  IF NOT public.cockpit_ask_ai_owner_allowed(auth.uid(),'media-buyer',coalesce(nullif(c.raw_data->>'clientName',''),nullif(c.raw_data->>'accountName',''),c.client_name)) THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM public.cockpit_offboard_dismissals d WHERE d.campaign_name=c.raw_data->>'campaignName') THEN c.raw_data:=c.raw_data||'{"offBoardDismissed":true}'::jsonb; END IF;
  SELECT max(learning_started_at) INTO last_change FROM public.cockpit_campaign_action_messages WHERE campaign_name=c.raw_data->>'campaignName';
  IF last_change IS NOT NULL THEN
   c.raw_data:=c.raw_data||jsonb_build_object('lastChangeAt',extract(epoch FROM last_change)*1000);
   days:=extract(epoch FROM now()-last_change)/86400;
   IF days<3 THEN
    note:=jsonb_build_object('severity','optimization','constraint','In learning. Give the change time.','evidence','This campaign changed within the last three days.','fixes',jsonb_build_array('Wait until '||to_char(last_change+interval '3 days','DD Mon')||' before judging this change.'));
    bleeding:=coalesce(c.cpl,0)>30 OR coalesce((c.raw_data->>'costPerBooking')::numeric,0)>90;
    c.raw_data:=c.raw_data||jsonb_build_object('findings',CASE WHEN bleeding THEN jsonb_build_array(note)||coalesce(c.raw_data->'findings','[]') ELSE jsonb_build_array(note) END);
   END IF;
  END IF;
  RETURN NEXT c;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_live_campaigns() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_media_live_campaigns() TO authenticated;
CREATE FUNCTION public.cockpit_media_task_scope(p_task text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE campaign text; matches integer; feed jsonb; hits jsonb;
BEGIN
 SELECT count(*),min(raw_data->>'campaignName') INTO matches,campaign FROM public.cockpit_campaigns WHERE NOT source_deleted AND task_id=p_task;
 IF matches=0 THEN
  PERFORM public.cockpit_media_scope('board.adStatusOptions',NULL);
  IF NOT EXISTS(SELECT 1 FROM public.cockpit_members m WHERE m.auth_user_id=auth.uid() AND (cardinality(m.clients)=0 OR 'admin'=ANY(m.roles) OR public.cockpit_is_ceo())) THEN RAISE EXCEPTION 'This task has no verified client mapping for your access list'; END IF;
  IF to_regprocedure('public.cockpit_media_source_read()') IS NULL THEN RAISE EXCEPTION 'The verified task source feed is not ready'; END IF;
  feed:=public.cockpit_media_source_read();
  SELECT coalesce(jsonb_agg(r),'[]') INTO hits FROM jsonb_array_elements(coalesce(feed->'tables'->'inbox','[]')) r WHERE r->>'taskId'=p_task;
  IF jsonb_array_length(hits)<>1 THEN RAISE EXCEPTION 'This task is missing or ambiguous in the verified inbox'; END IF;
  RETURN jsonb_build_object('actor',auth.uid(),'task',p_task);
 END IF;
 IF matches<>1 THEN RAISE EXCEPTION 'This task has no unique client campaign mapping yet'; END IF;
 RETURN public.cockpit_media_scope('cockpit.askForDetail',campaign);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_task_scope(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_media_task_scope(text) TO authenticated;
CREATE FUNCTION public.cockpit_media_request_scope(p_campaign text,p_client text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF nullif(p_campaign,'') IS NOT NULL THEN RETURN public.cockpit_media_scope('edit.askViktorFor',p_campaign); END IF;
 PERFORM public.cockpit_media_scope('board.adStatusOptions',NULL);
 IF nullif(p_client,'') IS NULL OR NOT public.cockpit_ask_ai_owner_allowed(auth.uid(),'media-buyer',p_client) THEN RAISE EXCEPTION 'A client in your access list is required'; END IF;
 RETURN jsonb_build_object('actor',auth.uid(),'client',p_client);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_request_scope(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_media_request_scope(text,text) TO authenticated;
CREATE TABLE public.cockpit_media_client_preferences(client_name text PRIMARY KEY,language text NOT NULL CHECK(language IN ('ar','en')),updated_by uuid NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.cockpit_media_client_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_media_client_preferences FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_media_client_preferences TO service_role;
CREATE FUNCTION public.cockpit_media_preferences(p_client text DEFAULT NULL,p_language text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous jsonb; next_row jsonb;
BEGIN
 PERFORM public.cockpit_media_scope('board.adStatusOptions',NULL);
 IF p_language IS NULL THEN RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('clientName',client_name,'language',language)) FROM public.cockpit_media_client_preferences WHERE public.cockpit_ask_ai_owner_allowed(auth.uid(),'media-buyer',client_name)),'[]'); END IF;
 IF p_language NOT IN ('ar','en') OR nullif(btrim(p_client),'') IS NULL OR NOT public.cockpit_ask_ai_owner_allowed(auth.uid(),'media-buyer',p_client) THEN RAISE EXCEPTION 'Choose a permitted client and ar/en language'; END IF;
 SELECT to_jsonb(p) INTO previous FROM public.cockpit_media_client_preferences p WHERE client_name=p_client FOR UPDATE;
 INSERT INTO public.cockpit_media_client_preferences VALUES(p_client,p_language,auth.uid(),now()) ON CONFLICT(client_name) DO UPDATE SET language=EXCLUDED.language,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at RETURNING to_jsonb(cockpit_media_client_preferences.*) INTO next_row;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,source_system,"before","after",metadata) VALUES('media.language','client',p_client,'media-buyer','supabase',previous,next_row,jsonb_build_object('actor',auth.uid()));
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_preferences(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_media_preferences(text,text) TO authenticated;
CREATE FUNCTION public.cockpit_b2b_draft_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after") VALUES('b2b.draft.'||lower(TG_OP),'cockpit_ad_drafts',NEW.id::text,coalesce((SELECT email FROM auth.users WHERE id=auth.uid()),NEW.created_by),'media-buyer','supabase',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));RETURN NEW;
END $$;
CREATE TRIGGER cockpit_b2b_draft_audit AFTER INSERT OR UPDATE ON public.cockpit_ad_drafts FOR EACH ROW EXECUTE FUNCTION public.cockpit_b2b_draft_audit();
COMMIT;
