-- Reuse the native upload worker, with an explicit client/account binding.
CREATE OR REPLACE FUNCTION public.cockpit_launch_import_scope(p_actor uuid,p_client text,p_account text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.cockpit_board_clients;
BEGIN
 SELECT * INTO b FROM public.cockpit_board_clients WHERE clickup_id=p_client;
 IF b.clickup_id IS NULL OR NOT public.cockpit_ask_ai_owner_allowed(p_actor,'media-buyer',b.client_name) THEN RAISE EXCEPTION 'This client is not available to this media buyer'; END IF;
 IF b.status NOT IN ('Active','Paused','Launching') THEN RAISE EXCEPTION 'This client is read-only'; END IF;
 IF coalesce(p_account,'') !~ '^[0-9]{5,25}$' OR NOT p_account=ANY(public.cockpit_launch_accounts(b.location_id)) THEN RAISE EXCEPTION 'This ad account is not linked to this client'; END IF;
 IF EXISTS(SELECT 1 FROM public.cockpit_board_clients x WHERE x.location_id<>b.location_id AND p_account=ANY(public.cockpit_launch_accounts(x.location_id))) THEN RAISE EXCEPTION 'The ad account mapping is ambiguous'; END IF;
 IF EXISTS(SELECT 1 FROM public.cockpit_board_account_ties WHERE account_id=p_account AND (kept_out OR location_id<>b.location_id)) THEN RAISE EXCEPTION 'This account is kept out or belongs to another client'; END IF;
 IF EXISTS(SELECT 1 FROM public.cockpit_meta_account_state WHERE account_id=p_account AND account_status IN (2,3,100,101)) THEN RAISE EXCEPTION 'Resolve this account problem before importing creatives'; END IF;
 RETURN jsonb_build_object('client',b.client_name,'locationId',b.location_id,'account',p_account);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_launch_import_scope(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_launch_import_scope(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_launch_import_enqueue(p_actor uuid,p_client text,p_account text,p_links jsonb,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; r public.cockpit_media_native_records; req jsonb; request_data jsonb;
BEGIN
 s:=public.cockpit_launch_import_scope(p_actor,p_client,p_account);
 IF p_id IS NULL OR jsonb_typeof(p_links) IS DISTINCT FROM 'array' OR jsonb_array_length(p_links) NOT BETWEEN 1 AND 6 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_links) x WHERE x !~ '^https://drive[.]google[.]com/file/d/[A-Za-z0-9_-]{16,}/view$') THEN RAISE EXCEPTION 'Choose one to six individual Drive files'; END IF;
 req:=jsonb_build_object('operation','launch.importCreatives','args',jsonb_build_object('clickupId',p_client,'accountId',p_account,'driveLinks',p_links));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_client||':'||p_account,0));
 SELECT * INTO r FROM public.cockpit_media_native_records WHERE id=p_id;
 IF FOUND THEN
  IF r.actor_id<>p_actor OR r.request<>req THEN RAISE EXCEPTION 'Request id already used for different inputs'; END IF;
  RETURN jsonb_build_object('ok',true,'id',r.id,'status',r.data->>'status');
 END IF;
 -- A lost response or two team members clicking the same files reuses the job.
 SELECT * INTO r FROM public.cockpit_media_native_records WHERE request=req AND kind='assist' ORDER BY created_at DESC LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('ok',true,'id',r.id,'status',r.data->>'status','reused',true); END IF;
 request_data:=jsonb_build_object('kind','creative','client',s->>'client','driveLinks',p_links,'launchImport',true,'clickupId',p_client,'accountId',p_account,'status','queued','note','Importing approved files into this account. No ad is created.');
 INSERT INTO public.cockpit_media_native_records(id,kind,actor_id,client_name,request,data) VALUES(p_id,'assist',p_actor,s->>'client',req,request_data);
 INSERT INTO public.cockpit_media_native_jobs(id,record_id,operation) VALUES(gen_random_uuid(),p_id,'assist.run');
 RETURN jsonb_build_object('ok',true,'id',p_id,'status','queued');
END $$;
REVOKE ALL ON FUNCTION public.cockpit_launch_import_enqueue(uuid,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_launch_import_enqueue(uuid,text,text,jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_launch_imports(p_client text,p_account text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.cockpit_launch_import_scope(auth.uid(),p_client,p_account);
 RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'requestedAt' DESC) FROM (
 SELECT data||jsonb_build_object('id',id,'requestedAt',created_at) x FROM public.cockpit_media_native_records
 WHERE kind='assist' AND data->>'launchImport'='true' AND data->>'clickupId'=p_client AND data->>'accountId'=p_account ORDER BY created_at DESC LIMIT 20)q),'[]');
END $$;
REVOKE ALL ON FUNCTION public.cockpit_launch_imports(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_launch_imports(text,text) TO authenticated;

-- Keep the existing fencing, receipts and identity checks for every native job.
DO $$ BEGIN
 IF to_regprocedure('public.cockpit_media_native_guard_before_launch_import(uuid,uuid)') IS NULL THEN
  ALTER FUNCTION public.cockpit_media_native_guard(uuid,uuid) RENAME TO cockpit_media_native_guard_before_launch_import;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_native_guard_before_launch_import(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.cockpit_media_native_guard(p_job_id uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb; r jsonb; s jsonb;
BEGIN
 ctx:=public.cockpit_media_native_guard_before_launch_import(p_job_id,p_token);
 r:=ctx->'record';
 IF r->'data'->>'launchImport'='true' THEN
  s:=public.cockpit_launch_import_scope((r->>'actor_id')::uuid,r->'data'->>'clickupId',r->'data'->>'accountId');
  IF s->>'client' IS DISTINCT FROM r->>'client_name' THEN RAISE EXCEPTION 'Client identity changed during import'; END IF;
  -- The existing uploader requires exactly one verified account. Never infer it
  -- from an old campaign or another account in the onboarding source.
  ctx:=jsonb_set(ctx,'{campaign}',jsonb_build_object('meta_account_id',s->>'account'));
  ctx:=jsonb_set(ctx,'{sources,onboardings}','[]');
  ctx:=jsonb_set(ctx,'{sources,launchWatch}','[]');
 END IF;
 RETURN ctx;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_native_guard(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_native_guard(uuid,uuid) TO service_role;

-- Ambiguous or stale task mappings stay in the team inbox, never on an arbitrary client.
CREATE OR REPLACE FUNCTION public.cockpit_media_client_notices() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members; notices jsonb; feed public.cockpit_media_source_state; tasks_ready boolean;
BEGIN
 m:=public.cockpit_launch_member();
 SELECT * INTO feed FROM public.cockpit_media_source_state WHERE table_name='inbox';
 tasks_ready:=coalesce(feed.ready AND feed.source_snapshot_at IS NOT NULL AND feed.row_count=(SELECT count(*) FROM public.cockpit_media_sources WHERE table_name='inbox' AND source_snapshot_at=feed.source_snapshot_at),false);
 WITH clients AS MATERIALIZED (
  SELECT b.*,public.cockpit_launch_accounts(b.location_id) accounts FROM public.cockpit_board_clients b
  WHERE b.clickup_id IS NOT NULL AND b.status NOT IN ('Cancelled','Removed from sheet')
  AND (m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com') OR 'admin'=ANY(m.roles) OR cardinality(m.clients)=0 OR EXISTS(SELECT 1 FROM unnest(m.clients)c WHERE lower(btrim(c))=lower(btrim(b.client_name))))
 ), work AS (
  SELECT 'task:'||s.source_id id,'task' kind,coalesce(s.data->>'title','Media task') title,
   CASE WHEN s.data->>'kind'='mention' THEN coalesce(s.data->>'author','A teammate')||' mentioned the media buyer'
    ELSE replace(replace(coalesce(s.data->>'reason','Open media task'),'assigned to you','Assigned to the media buyer'),'—',',') END body,
   hit.clickup_id client_id,hit.client_name,
   CASE WHEN s.data->>'taskId' ~ '^[A-Za-z0-9_-]+$' THEN 'https://app.clickup.com/t/'||(s.data->>'taskId') ELSE '/dashboard#tasks' END href,
   md5((s.data-'_creationTime')::text) version,
   CASE WHEN s.data->>'overdue'='true' THEN 0 ELSE 2 END priority,s.data task
  FROM public.cockpit_media_sources s
  LEFT JOIN LATERAL (SELECT min(b.clickup_id) clickup_id,min(b.client_name) client_name FROM public.cockpit_board_clients b WHERE b.clickup_id IS NOT NULL AND b.status NOT IN ('Cancelled','Removed from sheet') AND (
   EXISTS(SELECT 1 FROM unnest(s.client_names)n WHERE lower(btrim(n))=lower(btrim(b.client_name)))
   OR s.data->>'taskId'=b.clickup_id
   OR EXISTS(SELECT 1 FROM public.cockpit_media_sources card JOIN public.cockpit_media_source_state cs ON cs.table_name=card.table_name AND cs.source_snapshot_at=card.source_snapshot_at AND cs.ready AND cs.row_count=(SELECT count(*) FROM public.cockpit_media_sources s2 WHERE s2.table_name=cs.table_name AND s2.source_snapshot_at=cs.source_snapshot_at) WHERE card.table_name IN ('boardCards','onboardings') AND card.data->>'taskId'=s.data->>'taskId' AND EXISTS(SELECT 1 FROM unnest(card.client_names)n WHERE lower(btrim(n))=lower(btrim(b.client_name))))
   ) HAVING count(*)=1) hit ON true
  WHERE s.table_name='inbox' AND tasks_ready AND s.source_snapshot_at=feed.source_snapshot_at
   AND lower(coalesce(s.data->>'status','')) NOT IN ('complete','closed','done','cancelled')
   AND (EXISTS(SELECT 1 FROM clients cb WHERE cb.clickup_id=hit.clickup_id) OR m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com') OR 'admin'=ANY(m.roles) OR cardinality(m.clients)=0)
 ), attention AS (
  SELECT 'client:'||b.clickup_id id,
   CASE WHEN l.state='reconcile' THEN 'reconcile' WHEN l.state='built' THEN 'review' WHEN l.state='switched_on' THEN 'delivery' ELSE 'relaunch' END kind,
   b.client_name title,
   CASE WHEN l.state='reconcile' THEN 'Review an uncertain launch before trying again.'
    WHEN l.state='built' THEN 'A campaign is built paused. Review it before switching on.'
    WHEN l.state='switched_on' THEN 'No first impressions after 24 hours. Check delivery.'
    WHEN cardinality(b.accounts)=0 THEN 'Link an ad account to prepare the next campaign.'
    ELSE 'Nothing is listed in Ads. Review the account and next launch.' END body,
   b.clickup_id client_id,b.client_name,'/clients?client='||b.clickup_id||'&tab=launch' href,
   md5(concat_ws(':',b.clickup_id,b.status,l.id::text,l.state,array_to_string(b.accounts,','))) version,
   CASE WHEN l.state='reconcile' OR l.state='switched_on' THEN 0 ELSE 1 END priority,NULL::jsonb task
  FROM clients b LEFT JOIN LATERAL (SELECT * FROM public.cockpit_launches l WHERE l.clickup_id=b.clickup_id AND l.state<>'discarded'
   AND NOT EXISTS(SELECT 1 FROM public.cockpit_campaigns c WHERE NOT c.source_deleted AND c.meta_campaign_id=l.meta_campaign_id)
   ORDER BY CASE l.state WHEN 'reconcile' THEN 0 WHEN 'built' THEN 1 ELSE 2 END,l.created_at DESC LIMIT 1) l ON true
  WHERE b.status IN ('Active','Paused','Launching') AND (l.state IN ('built','reconcile') OR
   (l.state='switched_on' AND l.switched_on_at<now()-interval '24 hours' AND NOT EXISTS(
    SELECT 1 FROM public.cockpit_meta_ad_days d WHERE d.campaign_id=l.meta_campaign_id
    AND d.day>=coalesce(l.impression_day,l.switched_on_at::date) GROUP BY d.day
    HAVING sum(d.impressions)>CASE WHEN d.day=l.impression_day THEN l.impressions_at_switch ELSE 0 END)) OR
   (l.id IS NULL AND b.status IN ('Active','Paused') AND NOT EXISTS(SELECT 1 FROM public.cockpit_campaigns c WHERE NOT c.source_deleted AND (regexp_replace(c.meta_account_id,'^act_','')=ANY(b.accounts) OR lower(coalesce(nullif(c.raw_data->>'clientName',''),nullif(c.raw_data->>'accountName',''),c.client_name))=lower(b.client_name)))))
 ), all_notices AS (SELECT * FROM work UNION ALL SELECT * FROM attention)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'kind',n.kind,'title',n.title,'body',n.body,'clientId',n.client_id,'clientName',n.client_name,'href',n.href,'version',n.version,'priority',n.priority,'task',n.task,'read',r.version=n.version) ORDER BY n.priority,n.title),'[]') INTO notices
 FROM all_notices n LEFT JOIN public.cockpit_media_notice_reads r ON r.actor_id=m.auth_user_id AND r.notice_id=n.id;
 RETURN jsonb_build_object('asOf',now(),'sourceAt',feed.source_snapshot_at,'tasksReady',tasks_ready,'notices',notices);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_client_notices() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_media_client_notices() TO authenticated;


CREATE OR REPLACE FUNCTION public.cockpit_media_clients(p_clickup_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p jsonb; c jsonb; notices jsonb; rows jsonb:='[]'; activity jsonb;
BEGIN
 p:=public.cockpit_launch_pipeline(p_clickup_id); -- membership and exact client scope
 notices:=public.cockpit_media_client_notices();
 FOR c IN SELECT x FROM jsonb_array_elements(p->'clients')x LOOP
  c:=c||jsonb_build_object('tasksReady',notices->'tasksReady','mediaTasks',coalesce((SELECT jsonb_agg(n) FROM jsonb_array_elements(notices->'notices')n WHERE n->>'kind'='task' AND n->>'clientId'=c->>'id'),'[]'));
  IF p_clickup_id IS NOT NULL THEN
   SELECT coalesce(jsonb_agg(x ORDER BY x->>'at' DESC),'[]') INTO activity FROM (SELECT x FROM (
    SELECT jsonb_build_object('id',a.id,'operation',a.operation,'state',a.state,'at',a.created_at,'completedAt',a.completed_at,'actor',coalesce(m.name,'Team member'),'campaign',a.campaign_name,'did',a.result->>'did') x
    FROM public.cockpit_media_actions a LEFT JOIN public.cockpit_members m ON m.auth_user_id=a.actor_id
    WHERE a.request->'args'->>'clickupId'=c->>'id' OR
     (nullif(a.request->'args'->>'clickupId','') IS NULL AND a.campaign_name IS NOT NULL
      AND (SELECT count(*) FROM public.cockpit_campaigns cp WHERE cp.raw_data->>'campaignName'=a.campaign_name)=1
      AND EXISTS(SELECT 1 FROM public.cockpit_campaigns cp WHERE cp.raw_data->>'campaignName'=a.campaign_name AND regexp_replace(cp.meta_account_id,'^act_','') IN (SELECT ac->>'id' FROM jsonb_array_elements(c->'accounts')ac)))
    UNION ALL
    SELECT jsonb_build_object('id',r.id,'operation','launch.importCreatives','state',CASE WHEN r.data->>'status'='ready' THEN 'confirmed' ELSE r.data->>'status' END,'at',r.created_at,'actor',coalesce(m.name,'Team member'),'did','Import approved creatives') x
    FROM public.cockpit_media_native_records r LEFT JOIN public.cockpit_members m ON m.auth_user_id=r.actor_id
    WHERE r.kind='assist' AND r.data->>'launchImport'='true' AND r.data->>'clickupId'=c->>'id'
    UNION ALL
    SELECT jsonb_build_object('id',a.id,'operation','launch.discard','state','recorded','at',a.created_at,'actor',coalesce(m.name,'Team member'),'campaign',l.campaign_name,'did','Paused build dismissed. Meta objects unchanged.') x
    FROM public.cockpit_audit_log a JOIN public.cockpit_launches l ON l.id::text=a.entity_id AND l.clickup_id=c->>'id'
    LEFT JOIN public.cockpit_members m ON m.auth_user_id::text=a.metadata->>'actor'
    WHERE a.action='launch.discard' AND a.entity_type='cockpit_launches'
    ) events ORDER BY x->>'at' DESC LIMIT 50
   ) q;
   c:=c||jsonb_build_object('actionHistory',activity);
  END IF;
  rows:=rows||jsonb_build_array(c);
 END LOOP;
 RETURN jsonb_set(p,'{clients}',rows)||jsonb_build_object('notices',notices);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_clients(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_media_clients(text) TO authenticated;
