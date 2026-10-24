-- Launch desk. Client identity survives the seven-day campaign spend floor.
-- Provider application stays behind LAUNCH_APPLY in the media API.
DO $$ BEGIN
 IF to_regclass('public.cockpit_blueprints') IS NULL OR to_regclass('public.cockpit_board_account_ties') IS NULL OR to_regprocedure('public.cockpit_blueprint_part_answers(integer,jsonb)') IS NULL THEN RAISE EXCEPTION 'Apply the Brand Blueprint and checked board-facts migrations first'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.cockpit_launches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clickup_id text NOT NULL,
 location_id text NOT NULL, client_name text NOT NULL,
 account_id text NOT NULL CHECK(account_id ~ '^[0-9]{5,25}$'),
 kind text NOT NULL CHECK(kind IN ('switch_on','copy','rebuild','new')),
 source_account_id text, source_campaign_id text, campaign_name text NOT NULL,
 budget_usd numeric CHECK(budget_usd BETWEEN 5 AND 5000),
 budget_level text CHECK(budget_level IN ('campaign','adset')),
 state text NOT NULL CHECK(state IN ('built','switched_on','reconcile','discarded')),
 meta_campaign_id text CHECK(meta_campaign_id ~ '^[0-9]{5,25}$'),
 meta_adset_ids text[] NOT NULL DEFAULT '{}', meta_ad_ids text[] NOT NULL DEFAULT '{}',
 card_task_id text, build_action_id uuid REFERENCES public.cockpit_media_actions(id),
 switch_action_id uuid REFERENCES public.cockpit_media_actions(id),
 created_by uuid NOT NULL, created_by_email text, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), switched_on_at timestamptz
);
ALTER TABLE public.cockpit_launches ADD COLUMN IF NOT EXISTS impressions_at_switch bigint NOT NULL DEFAULT 0;
ALTER TABLE public.cockpit_launches ADD COLUMN IF NOT EXISTS impression_day date;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_launches_campaign ON public.cockpit_launches(meta_campaign_id) WHERE meta_campaign_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_launches_build ON public.cockpit_launches(build_action_id) WHERE build_action_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cockpit_launches_client ON public.cockpit_launches(clickup_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.cockpit_meta_people (
 actor_name text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('mahara','client','outsider')),
 note text, added_by text NOT NULL, added_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.cockpit_meta_people(actor_name,kind,note,added_by)
 SELECT n,'mahara','Verified in media launch mapping, 24 October 2026','launch-desk-1024'
 FROM unnest(ARRAY['Saleh Attale','Nada Al Saed','Muhammed Burhan','Abdulaziz Waheedi','Claude','MaharaMedia']) n
 ON CONFLICT DO NOTHING;
ALTER TABLE public.cockpit_launches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_meta_people ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_launches,public.cockpit_meta_people FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_launches,public.cockpit_meta_people TO service_role;

-- Private helpers have no callable grants. Every public read checks current membership.
CREATE OR REPLACE FUNCTION public.cockpit_launch_member() RETURNS public.cockpit_members
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members;
BEGIN
 SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users u ON u.id=cm.auth_user_id
 WHERE cm.auth_user_id=auth.uid() AND cm.active AND u.email_confirmed_at IS NOT NULL AND cm.email=lower(btrim(u.email));
 IF m.auth_user_id IS NULL THEN RAISE EXCEPTION 'Current confirmed membership required'; END IF;
 IF NOT (m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com') OR 'admin'=ANY(m.roles) OR 'media_buyer'=ANY(m.roles)) THEN RAISE EXCEPTION 'Media buyer access required'; END IF;
 RETURN m;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_launch_member() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cockpit_launch_accounts(p_location text) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(array_agg(DISTINCT account),'{}') FROM (
 SELECT unnest(ad_account_ids) account FROM public.cockpit_board_clients WHERE location_id=p_location
 UNION SELECT t->>'account' FROM public.cockpit_board_clients b CROSS JOIN LATERAL jsonb_array_elements(b.ad_account_ties)t WHERE b.location_id=p_location
 UNION SELECT account_id FROM public.cockpit_board_account_ties WHERE location_id=p_location AND NOT kept_out
 ) a WHERE account ~ '^[0-9]{5,25}$' AND NOT EXISTS (SELECT 1 FROM public.cockpit_board_account_ties t WHERE t.account_id=a.account AND (t.kept_out OR t.location_id<>p_location))
$$;
REVOKE ALL ON FUNCTION public.cockpit_launch_accounts(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cockpit_launch_pipeline(p_clickup_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members; b public.cockpit_board_clients; o jsonb; brief jsonb; cards jsonb; tasks jsonb;
 ids text[]; accounts jsonb; launches jsonb; history jsonb; out_rows jsonb:='[]'; row_data jsonb;
 lane text; in_ads boolean; waiting boolean; ready boolean; caller boolean; part jsonb; source_at timestamptz;
BEGIN
 m:=public.cockpit_launch_member();
 FOR b IN SELECT * FROM public.cockpit_board_clients WHERE status NOT IN ('Cancelled','Removed from sheet') AND clickup_id IS NOT NULL AND (p_clickup_id IS NULL OR clickup_id=p_clickup_id) ORDER BY client_name LOOP
  IF NOT (m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com') OR 'admin'=ANY(m.roles) OR cardinality(m.clients)=0 OR EXISTS(SELECT 1 FROM unnest(m.clients)c WHERE lower(btrim(c))=lower(btrim(b.client_name)))) THEN CONTINUE; END IF;
  ids:=public.cockpit_launch_accounts(b.location_id);
  SELECT to_jsonb(x) INTO o FROM public.cockpit_client_onboarding x WHERE clickup_task_id=b.clickup_id;
  SELECT jsonb_build_object('answers',public.cockpit_blueprint_part_answers(1,answers),'sentAt',parts->'1'->'lastAt','launchTaskId',launch_task_id) INTO brief FROM public.cockpit_blueprints WHERE task_id=b.clickup_id;
  -- Parts 2/3 and answer metadata never cross the media buyer boundary.
  SELECT coalesce(jsonb_agg(data ORDER BY data->>'name'),'[]') INTO cards FROM public.cockpit_media_sources s WHERE table_name='boardCards' AND (EXISTS(SELECT 1 FROM unnest(client_names)n WHERE lower(n)=lower(b.client_name)) OR lower(coalesce(data->>'tag',data->>'clientTag'))=lower(b.client_name));
  SELECT coalesce(jsonb_agg(data),'[]') INTO tasks FROM public.cockpit_media_sources s WHERE table_name='onboardings' AND coalesce(data->>'parent','')='' AND lower(coalesce(data->>'status','')) NOT IN ('complete','closed','done','cancelled') AND (EXISTS(SELECT 1 FROM unnest(client_names)n WHERE lower(n)=lower(b.client_name)) OR lower(data->>'clientName')=lower(b.client_name));
  caller:=NULL;
  IF b.service_mode='DWY' THEN caller:=true;
  ELSIF to_regclass('mahara_console.metadata') IS NOT NULL THEN
   BEGIN
    EXECUTE $q$ SELECT EXISTS(SELECT 1 FROM mahara_console.metadata WHERE namespace='production' AND id LIKE 'access:agent:%' AND data->>'active'='true' AND data->'locationIds' ? $1) $q$ INTO caller USING b.location_id;
   EXCEPTION WHEN undefined_column OR insufficient_privilege THEN caller:=NULL; END;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',i,'name',coalesce((SELECT t->>'name' FROM jsonb_array_elements(b.ad_account_ties)t WHERE t->>'account'=i LIMIT 1),d.name),'status',s.account_status,'currency',s.currency,'readAt',s.fetched_at,'lastRan',d.last_ran,'hasHistory',d.n>0) ORDER BY (s.account_status=1) DESC NULLS LAST,d.last_ran DESC NULLS LAST,i),'[]') INTO accounts
  FROM unnest(ids)i LEFT JOIN public.cockpit_meta_account_state s ON s.account_id=i
  LEFT JOIN LATERAL (SELECT max(account_name) name,max(day) FILTER(WHERE spend>0) last_ran,count(*) n FROM public.cockpit_meta_ad_days WHERE account_id=i) d ON true;
  in_ads:=EXISTS(SELECT 1 FROM public.cockpit_campaigns c WHERE NOT c.source_deleted AND (regexp_replace(c.meta_account_id,'^act_','')=ANY(ids) OR lower(coalesce(nullif(c.raw_data->>'clientName',''),nullif(c.raw_data->>'accountName',''),c.client_name))=lower(b.client_name)));
  SELECT coalesce(jsonb_agg(to_jsonb(l)-'created_by_email'||jsonb_build_object('inAds',EXISTS(SELECT 1 FROM public.cockpit_campaigns c WHERE NOT c.source_deleted AND c.meta_campaign_id=l.meta_campaign_id),'today',(SELECT jsonb_build_object('impressions',sum(d.impressions),'spend',sum(d.spend_usd),'leads',sum(d.leads)) FROM public.cockpit_meta_ad_days d WHERE d.campaign_id=l.meta_campaign_id AND d.day=(now() AT TIME ZONE 'Asia/Kuwait')::date),'firstImpressionAt',(SELECT min(d.day) FROM public.cockpit_meta_ad_days d WHERE d.campaign_id=l.meta_campaign_id AND l.state='switched_on' AND d.day>=coalesce(l.impression_day,l.switched_on_at::date,l.created_at::date) GROUP BY d.day HAVING sum(d.impressions)>CASE WHEN d.day=l.impression_day THEN l.impressions_at_switch ELSE 0 END ORDER BY d.day LIMIT 1),'hasImpressions',EXISTS(SELECT 1 FROM public.cockpit_meta_ad_days d WHERE d.campaign_id=l.meta_campaign_id AND l.state='switched_on' AND d.day>=coalesce(l.impression_day,l.switched_on_at::date,l.created_at::date) GROUP BY d.day HAVING sum(d.impressions)>CASE WHEN d.day=l.impression_day THEN l.impressions_at_switch ELSE 0 END)) ORDER BY l.created_at DESC),'[]') INTO launches FROM public.cockpit_launches l WHERE clickup_id=b.clickup_id AND state<>'discarded';
  waiting:=EXISTS(SELECT 1 FROM jsonb_array_elements(launches)l WHERE l->>'state' IN ('built','switched_on','reconcile') AND l->>'inAds'='false' AND coalesce(l->>'hasImpressions','false')='false');
  ready:=(brief->>'sentAt' IS NOT NULL OR jsonb_array_length(tasks)>0) AND (b.status IN ('Launching','Active') OR coalesce((o->>'in_onboarding')::boolean,false));
  lane:=CASE WHEN b.status IN ('Stopped','Ghosting') THEN 'search' WHEN in_ads THEN 'ads' WHEN waiting THEN 'waiting' WHEN ready THEN 'ready' WHEN b.status='Launching' OR coalesce((o->>'in_onboarding')::boolean,false) THEN 'onboarding' WHEN waiting THEN 'waiting' ELSE 'nothing' END;
  history:='[]';
  IF p_clickup_id IS NOT NULL THEN
   SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.leads DESC NULLS LAST),'[]') INTO history FROM (
    SELECT d.account_id,d.campaign_id,max(d.campaign_name) name,max(d.day) FILTER(WHERE d.spend>0) last_ran,sum(d.leads) leads,sum(d.spend_usd) spend,CASE WHEN sum(d.leads)>0 THEN sum(d.spend_usd)/sum(d.leads) END cpl,
    (SELECT a.actor_name FROM public.cockpit_csm_meta_activities a WHERE a.account_id=d.account_id AND a.object_id=d.campaign_id AND a.event_type ILIKE '%create%' ORDER BY a.event_time LIMIT 1) creator
    FROM public.cockpit_meta_ad_days d WHERE d.account_id=ANY(ids) AND d.day>=current_date-120 GROUP BY d.account_id,d.campaign_id
   ) h;
  END IF;
  row_data:=jsonb_build_object('id',b.clickup_id,'locationId',b.location_id,'name',b.client_name,'status',b.status,'registryStatus',b.registry_status,'stage',b.card_stage,'serviceMode',b.service_mode,'lane',lane,'ghosted',coalesce(b.card_stage,'') ILIKE '%ghost%','readOnly',b.status IN ('Stopped','Ghosting'),'accounts',accounts,'brief',brief,'caller',caller,'cards',cards,'tasks',tasks,'launches',launches,'waiting',waiting,'inAds',in_ads,'history',history,'updatedAt',b.updated_at);
  IF p_clickup_id IS NOT NULL THEN
   row_data:=row_data||jsonb_build_object('handover',coalesce(o->'handover','{}'),'links',coalesce(o->'links','{}'),'people',coalesce((SELECT jsonb_agg(jsonb_build_object('name',actor_name,'kind',kind)) FROM public.cockpit_meta_people),'[]'),'activities',coalesce((SELECT jsonb_agg(to_jsonb(a)-'extra_data'-'task_id') FROM (SELECT * FROM public.cockpit_csm_meta_activities WHERE account_id=ANY(ids) ORDER BY event_time DESC LIMIT 500)a),'[]'),'excludedAds',coalesce((SELECT jsonb_agg(ad_id) FROM public.cockpit_excluded_ads WHERE account_id=ANY(ids)),'[]'),'starterPack',(SELECT value FROM public.cockpit_blueprint_settings WHERE key='pack.'||(brief->'answers'->>'service')));
  END IF;
  out_rows:=out_rows||jsonb_build_array(row_data);
 END LOOP;
 IF p_clickup_id IS NOT NULL AND jsonb_array_length(out_rows)<>1 THEN RAISE EXCEPTION 'That client is not on your access list'; END IF;
 SELECT max(updated_at) INTO source_at FROM public.cockpit_board_clients;
 RETURN jsonb_build_object('asOf',now(),'sources',jsonb_build_object('board',jsonb_build_object('at',source_at,'ok',source_at IS NOT NULL),'accounts',jsonb_build_object('at',(SELECT max(fetched_at) FROM public.cockpit_meta_account_state),'ok',EXISTS(SELECT 1 FROM public.cockpit_meta_account_state)),'onboarding',jsonb_build_object('at',(SELECT max(to_jsonb(obsource)->>'updated_at') FROM public.cockpit_client_onboarding obsource),'ok',EXISTS(SELECT 1 FROM public.cockpit_client_onboarding)),'blueprints',jsonb_build_object('at',(SELECT max(to_jsonb(bp)->>'updated_at') FROM public.cockpit_blueprints bp),'ok',true),'media',coalesce((SELECT jsonb_object_agg(ms.table_name,jsonb_build_object('at',ms.source_snapshot_at,'ok',ms.ready)) FROM public.cockpit_media_source_state ms WHERE ms.table_name IN ('boardCards','onboardings')),'{}')),'clients',out_rows,'lanes',jsonb_build_object('onboarding',(SELECT count(*) FROM jsonb_array_elements(out_rows)x WHERE x->>'lane'='onboarding'),'ready',(SELECT count(*) FROM jsonb_array_elements(out_rows)x WHERE x->>'lane'='ready'),'nothing',(SELECT count(*) FROM jsonb_array_elements(out_rows)x WHERE x->>'lane'='nothing'),'waiting',(SELECT count(*) FROM jsonb_array_elements(out_rows)x WHERE x->>'waiting'='true' AND x->>'readOnly'='false'),'ads',(SELECT count(*) FROM jsonb_array_elements(out_rows)x WHERE x->>'inAds'='true' AND x->>'readOnly'='false')));
END $$;
REVOKE ALL ON FUNCTION public.cockpit_launch_pipeline(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_launch_pipeline(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_media_account_scope(p_operation text,p_clickup_id text,p_account text,p_launch uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members; c jsonb; a jsonb; l public.cockpit_launches; contract numeric; source text;
BEGIN
 m:=public.cockpit_launch_member();
 IF p_operation NOT IN ('launch.readiness','launch.copyIdeas','launch.switchOn','launch.copy','launch.rebuild','launch.new','launch.attachAccount','launch.discard') THEN RAISE EXCEPTION 'Unknown launch operation'; END IF;
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
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_account_scope(text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_media_account_scope(text,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_launch_action(p_action text,p_args jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.cockpit_launches; before_row jsonb;
BEGIN
 PERFORM public.cockpit_launch_member();
 IF p_action<>'discard' THEN RAISE EXCEPTION 'Unknown launch action'; END IF;
 SELECT * INTO l FROM public.cockpit_launches WHERE id=(p_args->>'id')::uuid FOR UPDATE;
 IF l.id IS NULL THEN RAISE EXCEPTION 'Launch not found'; END IF;
 PERFORM public.cockpit_media_account_scope('launch.discard',l.clickup_id,l.account_id,l.id);
 IF l.state<>'built' THEN RAISE EXCEPTION 'Only a paused build can be discarded'; END IF;
 before_row:=to_jsonb(l);
 UPDATE public.cockpit_launches SET state='discarded',updated_at=now() WHERE id=l.id;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,source_system,"before","after",metadata) VALUES('launch.discard','cockpit_launches',l.id::text,'media-buyer','supabase',before_row,jsonb_build_object('state','discarded'),jsonb_build_object('actor',auth.uid(),'meta_objects_unchanged',true));
 RETURN jsonb_build_object('ok',true,'message','Build removed from Launch. Its Meta objects remain paused.');
END $$;
REVOKE ALL ON FUNCTION public.cockpit_launch_action(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_launch_action(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_launch_attach(p_action_id uuid,p_location text,p_account text,p_evidence text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.cockpit_media_actions; b public.cockpit_board_clients;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('launch-account:'||p_account,0));
 SELECT * INTO a FROM public.cockpit_media_actions WHERE id=p_action_id FOR UPDATE;
 SELECT * INTO b FROM public.cockpit_board_clients WHERE clickup_id=a.request->'args'->>'clickupId';
 IF a.id IS NULL OR a.state<>'pending' OR a.operation<>'launch.attachAccount' OR a.request->'args'->>'accountId' IS DISTINCT FROM p_account OR b.location_id IS DISTINCT FROM p_location THEN RAISE EXCEPTION 'Matching pending account-link intent required'; END IF;
 IF EXISTS(SELECT 1 FROM public.cockpit_board_account_ties WHERE account_id=p_account AND (kept_out OR location_id<>p_location)) OR EXISTS(SELECT 1 FROM public.cockpit_board_clients c WHERE c.location_id<>p_location AND p_account=ANY(public.cockpit_launch_accounts(c.location_id))) THEN RAISE EXCEPTION 'This ad account is kept out or belongs to another client'; END IF;
 INSERT INTO public.cockpit_board_account_ties(account_id,location_id,evidence,added_by) VALUES(p_account,p_location,p_evidence,(SELECT email FROM auth.users WHERE id=a.actor_id)) ON CONFLICT(account_id) DO NOTHING;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,source_system,metadata) VALUES('launch.attachAccount.tie','cockpit_board_account_ties',p_account,'media-buyer','supabase',jsonb_build_object('actor',a.actor_id,'actionId',a.id,'locationId',p_location));
 PERFORM public.cockpit_finish_media_action(p_action_id,jsonb_build_object('ok',true,'accountId',p_account,'locationId',p_location),'{}');
 RETURN jsonb_build_object('ok',true,'accountId',p_account,'receiptId',p_action_id);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_launch_attach(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_launch_attach(uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_media_scope(p_operation text, p_campaign text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE l public.cockpit_launches; launch_scope jsonb; m public.cockpit_members; c public.cockpit_campaigns; n integer; founder boolean; client text; feed jsonb; hits jsonb;
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
 IF n=0 AND (p_operation IN ('control.setStatus','board.setAdStatus','board.setAdvertisingCities','board.renameCard','funnel.read','campaignChat.read') OR p_operation LIKE 'edit.%' OR p_operation LIKE 'forms.%') THEN
  SELECT count(*) INTO n FROM public.cockpit_launches WHERE campaign_name=p_campaign AND state IN ('built','switched_on');
  IF n<>1 THEN RAISE EXCEPTION 'Campaign is missing or ambiguous; refresh the campaign source'; END IF;
  SELECT * INTO l FROM public.cockpit_launches WHERE campaign_name=p_campaign AND state IN ('built','switched_on');
  launch_scope:=public.cockpit_media_account_scope('launch.readiness',l.clickup_id,l.account_id,l.id);
  IF launch_scope->>'boardStatus' IN ('Stopped','Ghosting') AND p_operation NOT IN ('funnel.read','campaignChat.read') THEN RAISE EXCEPTION 'This client is stopped. Its launch history is read-only.'; END IF;
  RETURN launch_scope||jsonb_build_object('campaign',l.meta_campaign_id,'campaignName',l.campaign_name,'task',l.card_task_id);
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
END $function$
;
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
   UPDATE public.cockpit_launches SET state=CASE WHEN NEW.state='confirmed' THEN 'switched_on' ELSE 'reconcile' END,
    impressions_at_switch=coalesce((NEW.result->>'impressionsAtSwitch')::bigint,0),impression_day=(NEW.result->>'impressionDay')::date,switch_action_id=NEW.id,switched_on_at=CASE WHEN NEW.state='confirmed' THEN now() END,updated_at=now()
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
  ELSE NULL END;
 IF note IS NOT NULL THEN INSERT INTO public.cockpit_campaign_action_messages VALUES(NEW.id,NEW.campaign_name,NEW.actor_id,note,coalesce(NEW.completed_at,now()),CASE WHEN learning THEN coalesce(NEW.completed_at,now()) ELSE NULL END) ON CONFLICT(id) DO NOTHING; END IF;
 RETURN NEW;
END $function$

;
REVOKE ALL ON FUNCTION public.cockpit_media_action_effects() FROM PUBLIC,anon,authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS cockpit_launch_intent_account ON public.cockpit_media_actions ((request->'args'->>'accountId')) WHERE operation IN ('launch.new','launch.copy','launch.rebuild','launch.switchOn','launch.attachAccount') AND state IN ('pending','reconcile');

-- Account chooser reveals only the supplied, readable accounts that are free to link.
CREATE OR REPLACE FUNCTION public.cockpit_launch_available_accounts(p_clickup_id text,p_ids text[]) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb; result text[];
BEGIN
 c:=public.cockpit_launch_pipeline(p_clickup_id)->'clients'->0;
 SELECT coalesce(array_agg(i),'{}') INTO result FROM unnest(p_ids)i
 WHERE i ~ '^[0-9]{5,25}$' AND NOT EXISTS(SELECT 1 FROM public.cockpit_board_account_ties t WHERE t.account_id=i AND (t.kept_out OR t.location_id<>c->>'locationId'))
 AND NOT EXISTS(SELECT 1 FROM public.cockpit_board_clients b WHERE i=ANY(public.cockpit_launch_accounts(b.location_id)));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_launch_available_accounts(text,text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_launch_available_accounts(text,text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_launch_writeback_campaigns() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('campaignName',campaign_name,'clientName',client_name,'taskId',card_task_id,'clientTaskId',clickup_id,'metaCampaignId',meta_campaign_id)),'[]') FROM public.cockpit_launches WHERE state IN ('built','switched_on')
$$;
REVOKE ALL ON FUNCTION public.cockpit_launch_writeback_campaigns() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_launch_writeback_campaigns() TO service_role;
