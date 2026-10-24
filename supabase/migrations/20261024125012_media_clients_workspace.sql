-- Client-first media workspace. Reads are scoped; no provider calls or new cron.
CREATE TABLE IF NOT EXISTS public.cockpit_media_notice_reads (
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 notice_id text NOT NULL, version text NOT NULL,
 seen_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,notice_id)
);
ALTER TABLE public.cockpit_media_notice_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_media_notice_reads FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.cockpit_media_notice_reads TO service_role;

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
  LEFT JOIN LATERAL (SELECT b.clickup_id,b.client_name FROM clients b WHERE
   EXISTS(SELECT 1 FROM unnest(s.client_names)n WHERE lower(btrim(n))=lower(btrim(b.client_name)))
   OR s.data->>'taskId'=b.clickup_id
   OR EXISTS(SELECT 1 FROM public.cockpit_media_sources card WHERE card.table_name IN ('boardCards','onboardings') AND card.data->>'taskId'=s.data->>'taskId' AND EXISTS(SELECT 1 FROM unnest(card.client_names)n WHERE lower(btrim(n))=lower(btrim(b.client_name))))
   ORDER BY b.clickup_id LIMIT 1) hit ON true
  WHERE s.table_name='inbox' AND tasks_ready AND s.source_snapshot_at=feed.source_snapshot_at
   AND lower(coalesce(s.data->>'status','')) NOT IN ('complete','closed','done','cancelled')
   AND (hit.clickup_id IS NOT NULL OR m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com') OR 'admin'=ANY(m.roles) OR cardinality(m.clients)=0)
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

CREATE OR REPLACE FUNCTION public.cockpit_media_notices_seen(p_notices jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members; n jsonb; current_notices jsonb;
BEGIN
 m:=public.cockpit_launch_member();
 IF jsonb_typeof(p_notices)<>'array' OR jsonb_array_length(p_notices)>200 THEN RAISE EXCEPTION 'Choose up to 200 notices'; END IF;
 current_notices:=public.cockpit_media_client_notices()->'notices';
 FOR n IN SELECT x FROM jsonb_array_elements(current_notices)x WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(p_notices)y WHERE y->>'id'=x->>'id' AND y->>'version'=x->>'version') LOOP
  INSERT INTO public.cockpit_media_notice_reads(actor_id,notice_id,version) VALUES(m.auth_user_id,n->>'id',n->>'version')
  ON CONFLICT(actor_id,notice_id) DO UPDATE SET version=excluded.version,seen_at=now();
 END LOOP;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_notices_seen(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_media_notices_seen(jsonb) TO authenticated;

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
