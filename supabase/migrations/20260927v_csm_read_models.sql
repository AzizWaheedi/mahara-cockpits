BEGIN;
CREATE TABLE IF NOT EXISTS public.cockpit_csm_source_state(table_name text PRIMARY KEY CHECK(table_name IN('clients','csTasks','kpi','appointments','rosterDays','churnEvents','syncRuns','clientProfiles','decisions','reportDocs','outbox')),ready boolean NOT NULL DEFAULT false,row_count integer CHECK(row_count>=0),source_snapshot_at timestamptz);
ALTER TABLE public.cockpit_csm_source_state DROP CONSTRAINT IF EXISTS cockpit_csm_source_state_table_name_check;
ALTER TABLE public.cockpit_csm_source_state ADD CONSTRAINT cockpit_csm_source_state_table_name_check CHECK(table_name IN('clients','csTasks','kpi','appointments','rosterDays','churnEvents','syncRuns','clientProfiles','decisions','reportDocs','outbox'));
INSERT INTO public.cockpit_csm_source_state(table_name) SELECT unnest(ARRAY['clients','csTasks','kpi','appointments','rosterDays','churnEvents','syncRuns','clientProfiles','decisions','reportDocs','outbox']) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.cockpit_csm_sources(table_name text NOT NULL REFERENCES public.cockpit_csm_source_state(table_name),source_id text NOT NULL,client_names text[] NOT NULL DEFAULT '{}',data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),source_snapshot_at timestamptz NOT NULL,PRIMARY KEY(table_name,source_id),CHECK(data ? '_id' AND data->>'_id'=source_id));
CREATE TABLE IF NOT EXISTS public.cockpit_csm_actions(id uuid PRIMARY KEY,operation text NOT NULL CHECK(operation IN ('act','plan')),actor_id uuid NOT NULL,actor_email text NOT NULL,context jsonb NOT NULL,request jsonb NOT NULL,state text NOT NULL DEFAULT 'sending' CHECK(state IN ('sending','confirmed','reconcile','failed')),result jsonb,error text,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz);
CREATE TABLE IF NOT EXISTS public.cockpit_csm_provider_health(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,action_id uuid REFERENCES public.cockpit_csm_actions(id),method text NOT NULL,resource text NOT NULL,phase text NOT NULL,http_status integer,object_id text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.cockpit_csm_client_overrides(task_id text PRIMARY KEY,client_name text NOT NULL,data jsonb NOT NULL,action_id uuid NOT NULL REFERENCES public.cockpit_csm_actions(id),confirmed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.cockpit_csm_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_csm_provider_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_csm_client_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_csm_actions,public.cockpit_csm_provider_health,public.cockpit_csm_client_overrides FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_csm_actions TO service_role;
GRANT SELECT,INSERT ON public.cockpit_csm_provider_health TO service_role;
GRANT SELECT ON public.cockpit_csm_client_overrides TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.cockpit_csm_provider_health_id_seq TO service_role;
ALTER TABLE public.cockpit_plan_items ADD COLUMN IF NOT EXISTS owner_id uuid,ADD COLUMN IF NOT EXISTS provider_task_id text,ADD COLUMN IF NOT EXISTS provider_task_url text,ADD COLUMN IF NOT EXISTS confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE public.cockpit_csm_source_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_csm_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_csm_source_state,public.cockpit_csm_sources FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_csm_source_state,public.cockpit_csm_sources TO service_role;
CREATE OR REPLACE FUNCTION public.cockpit_csm_scope_all() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.cockpit_has_role('admin') OR public.cockpit_is_ceo() OR EXISTS(SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id WHERE m.auth_user_id=auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email)) AND cardinality(m.clients)=0)
$$;
CREATE OR REPLACE FUNCTION public.cockpit_ad_scope_allowed(p_campaign text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.cockpit_csm_scope_all() OR (
  EXISTS(SELECT 1 FROM public.cockpit_campaigns c WHERE (lower(btrim(c.client_name))=lower(btrim(p_campaign)) OR lower(btrim(c.raw_data->>'name'))=lower(btrim(p_campaign))) AND public.cockpit_client_allowed(c.client_name))
  AND NOT EXISTS(SELECT 1 FROM public.cockpit_campaigns c WHERE (lower(btrim(c.client_name))=lower(btrim(p_campaign)) OR lower(btrim(c.raw_data->>'name'))=lower(btrim(p_campaign))) AND NOT public.cockpit_client_allowed(c.client_name)))
$$;
REVOKE ALL ON FUNCTION public.cockpit_csm_scope_all(),public.cockpit_ad_scope_allowed(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_scope_all(),public.cockpit_ad_scope_allowed(text) TO authenticated,service_role;
DROP POLICY IF EXISTS campaigns_read_policy ON public.cockpit_campaigns;
CREATE POLICY campaigns_read_policy ON public.cockpit_campaigns FOR SELECT TO authenticated USING((public.cockpit_has_role('media_buyer') OR public.cockpit_has_role('creative') OR public.cockpit_is_ceo()) AND public.cockpit_client_allowed(client_name));
DROP POLICY IF EXISTS ads_read_policy ON public.cockpit_ads;
CREATE POLICY ads_read_policy ON public.cockpit_ads FOR SELECT TO authenticated USING((public.cockpit_has_role('media_buyer') OR public.cockpit_has_role('creative') OR public.cockpit_has_role('editor') OR public.cockpit_is_ceo()) AND public.cockpit_ad_scope_allowed(campaign_name));
DROP POLICY IF EXISTS client_profiles_read_policy ON public.cockpit_client_profiles;
CREATE POLICY client_profiles_read_policy ON public.cockpit_client_profiles FOR SELECT TO authenticated USING((public.cockpit_has_role('csm') OR public.cockpit_has_role('media_buyer') OR public.cockpit_is_ceo()) AND public.cockpit_client_allowed(client_name));
GRANT SELECT ON public.cockpit_campaigns,public.cockpit_ads,public.cockpit_client_profiles TO authenticated,service_role;
DROP POLICY IF EXISTS decisions_read_policy ON public.cockpit_decisions;
CREATE POLICY decisions_read_policy ON public.cockpit_decisions FOR SELECT TO authenticated USING((public.cockpit_has_role(role) OR public.cockpit_is_ceo()) AND (role<>'csm' OR public.cockpit_csm_scope_all() OR public.cockpit_client_allowed(subject)));
DROP POLICY IF EXISTS plan_items_read_policy ON public.cockpit_plan_items;
CREATE POLICY plan_items_read_policy ON public.cockpit_plan_items FOR SELECT TO authenticated USING((public.cockpit_has_role(role) OR public.cockpit_is_ceo()) AND (role<>'csm' OR public.cockpit_csm_scope_all() OR owner_id=auth.uid() OR public.cockpit_client_allowed(client_name)));
CREATE OR REPLACE FUNCTION public.cockpit_csm_source_read() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE missing text; result jsonb:='{}'; t record; rows jsonb; full_scope boolean; roster jsonb;
BEGIN
 PERFORM public.cockpit_csm_actor();full_scope:=public.cockpit_csm_scope_all();
 SELECT string_agg(s.table_name,', ') INTO missing FROM public.cockpit_csm_source_state s WHERE NOT s.ready OR s.row_count IS DISTINCT FROM (SELECT count(*) FROM public.cockpit_csm_sources r WHERE r.table_name=s.table_name AND r.source_snapshot_at=s.source_snapshot_at) OR s.source_snapshot_at IS NULL;
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'Client-success source history is not ready: %',missing; END IF;
 FOR t IN SELECT table_name,source_snapshot_at FROM public.cockpit_csm_source_state LOOP
  IF t.table_name='rosterDays' THEN
   SELECT coalesce(jsonb_agg(r.data||jsonb_build_object('clients',a.visible,'total',jsonb_array_length(a.visible),'paying',(SELECT count(*) FROM jsonb_array_elements(a.visible) c WHERE c->>'paying'='true'))),'[]') INTO rows
   FROM public.cockpit_csm_sources r CROSS JOIN LATERAL(SELECT coalesce(jsonb_agg(c),'[]') AS visible FROM jsonb_array_elements(r.data->'clients') c WHERE public.cockpit_client_allowed(c->>'name')) a WHERE r.table_name=t.table_name AND r.source_snapshot_at=t.source_snapshot_at;
  ELSIF t.table_name='syncRuns' THEN
   SELECT coalesce(jsonb_agg(data ORDER BY (data->>'at')::numeric DESC),'[]') INTO rows FROM (SELECT CASE WHEN full_scope THEN data ELSE jsonb_build_object('_id',source_id,'at',data->'at','role',data->'role','kind',data->'kind','ok',data->'ok','errors',CASE WHEN data->>'ok'='false' THEN '["A source refresh needs attention"]'::jsonb ELSE '[]'::jsonb END) END AS data FROM public.cockpit_csm_sources WHERE table_name=t.table_name AND source_snapshot_at=t.source_snapshot_at ORDER BY (data->>'at')::numeric DESC LIMIT 40) recent;
  ELSE
   SELECT coalesce(jsonb_agg(r.data),'[]') INTO rows FROM public.cockpit_csm_sources r WHERE r.table_name=t.table_name AND r.source_snapshot_at=t.source_snapshot_at AND (full_scope OR (cardinality(r.client_names)>0 AND NOT EXISTS(SELECT 1 FROM unnest(r.client_names) c WHERE NOT public.cockpit_client_allowed(c))));
  END IF;
  result:=jsonb_set(result,ARRAY[t.table_name],rows);
 END LOOP;
 result:=jsonb_set(result,'{liveDecisions}',coalesce((SELECT jsonb_agg(jsonb_build_object('_id',id::text,'source_id',source_id,'day',day,'subject',subject,'action',action,'kind',kind,'reason',reason,'at',extract(epoch FROM created_at)*1000)) FROM public.cockpit_decisions WHERE role='csm' AND day>=date_trunc('month',now() AT TIME ZONE 'Asia/Kuwait')::date AND public.cockpit_client_allowed(subject)),'[]'));
 result:=jsonb_set(result,'{clientOverrides}',coalesce((SELECT jsonb_agg(to_jsonb(o)) FROM public.cockpit_csm_client_overrides o WHERE public.cockpit_client_allowed(client_name)),'[]'));
 RETURN jsonb_build_object('tables',result,'source',jsonb_build_object('system','Client Success source projection','snapshotAt',(SELECT min(source_snapshot_at) FROM public.cockpit_csm_source_state),'scoped',NOT full_scope,'tables',(SELECT jsonb_object_agg(table_name,jsonb_build_object('rows',row_count,'snapshotAt',source_snapshot_at)) FROM public.cockpit_csm_source_state)));
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_csm_action_context(p_operation text,p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE row_data jsonb; item jsonb;actor uuid;email text;day text:=(now() AT TIME ZONE 'Asia/Kuwait')::date::text;
BEGIN
 actor:=public.cockpit_csm_actor();SELECT lower(btrim(u.email)) INTO email FROM auth.users u WHERE u.id=actor;
 IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR octet_length(p_args::text)>100000 THEN RAISE EXCEPTION 'Invalid client-success action';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_csm_source_state WHERE table_name='clients' AND ready) THEN RAISE EXCEPTION 'Client roster has not been reconciled';END IF;
 IF p_args ? 'due' AND (jsonb_typeof(p_args->'due') IS DISTINCT FROM 'number' OR (p_args->>'due')::numeric NOT BETWEEN 0 AND 4102444800000) THEN RAISE EXCEPTION 'Choose a valid task due date';END IF;
 IF p_operation='act' THEN
  SELECT r.data INTO row_data FROM public.cockpit_csm_sources r WHERE table_name='clients' AND r.source_snapshot_at=(SELECT source_snapshot_at FROM public.cockpit_csm_source_state WHERE table_name='clients' AND ready) AND ((nullif(p_args->>'taskId','') IS NOT NULL AND r.data->>'taskId'=p_args->>'taskId') OR (nullif(p_args->>'taskId','') IS NULL AND r.source_id=p_args->>'clientId')) ORDER BY (data->>'syncedAt')::numeric DESC NULLS LAST LIMIT 1;
  IF row_data IS NULL OR public.cockpit_client_allowed(row_data->>'name') IS NOT TRUE THEN RAISE EXCEPTION 'Choose an assigned client' USING ERRCODE='42501';END IF;
  IF coalesce(p_args->>'kind','') NOT IN ('touchpoint','call','report','stage','service','happiness','booked','upsell','ticket','left') OR length(btrim(coalesce(p_args->>'action',''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Choose a supported action';END IF;
  IF p_args->>'kind' IN ('stage','service','happiness','booked') AND length(btrim(coalesce(p_args->>'value','')))=0 THEN RAISE EXCEPTION 'Choose the new value';END IF;
  IF p_args->>'kind'='booked' AND (coalesce(p_args->>'value','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (p_args->>'value')::date IS NULL) THEN RAISE EXCEPTION 'Choose a valid call date';END IF;
  RETURN jsonb_build_object('actorId',actor,'email',email,'day',day,'clientName',row_data->>'name','taskId',row_data->>'taskId','evidence',row_data->>'todo','client',row_data);
 ELSIF p_operation='plan' THEN
  IF jsonb_typeof(p_args->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_args->'items') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Add between 1 and 30 tasks';END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_args->'items') LOOP
   IF length(btrim(coalesce(item->>'text',''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Every task needs a name';END IF;
   IF nullif(item->>'clientName','') IS NOT NULL AND (public.cockpit_client_allowed(item->>'clientName') IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.cockpit_csm_sources WHERE table_name='clients' AND source_snapshot_at=(SELECT source_snapshot_at FROM public.cockpit_csm_source_state WHERE table_name='clients' AND ready) AND lower(btrim(data->>'name'))=lower(btrim(item->>'clientName')))) THEN RAISE EXCEPTION 'Task client is outside your list';END IF;
   IF nullif(item->>'dueDate','') IS NOT NULL AND ((item->>'dueDate')::date IS NULL OR item->>'dueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN RAISE EXCEPTION 'Choose a valid task date';END IF;
  END LOOP;
  RETURN jsonb_build_object('actorId',actor,'email',email,'day',day);
 END IF;
 RAISE EXCEPTION 'Unknown client-success action';
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_csm_tasks_added(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=public.cockpit_csm_action_context('act',jsonb_build_object('taskId',p_task_id,'kind','left','action','Read task history'));
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_csm_source_state WHERE table_name='outbox' AND ready) THEN RAISE EXCEPTION 'Task history has not been reconciled';END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY (x->>'at')::numeric DESC),'[]') INTO result FROM (
 SELECT jsonb_build_object('id',data->>'_id','title',data->>'action','department',data->>'department','due',data->'due','sent',data->>'sentAt' IS NOT NULL AND nullif(data->>'error','') IS NULL,'error',data->>'error','url',data->>'resultUrl','at',data->'createdAt') x FROM public.cockpit_csm_sources r JOIN public.cockpit_csm_source_state s USING(table_name) WHERE r.table_name='outbox' AND r.source_snapshot_at=s.source_snapshot_at AND data->>'clientTaskId'=p_task_id AND data->>'kind'='task'
 UNION ALL
 SELECT jsonb_build_object('id',id,'title',request->>'action','department',request->>'department','due',request->'due','sent',state='confirmed','error',error,'url',result->>'ticketUrl','at',extract(epoch FROM created_at)*1000) FROM public.cockpit_csm_actions WHERE operation='act' AND context->>'taskId'=p_task_id AND request->>'taskOrigin'='client_profile'
 ) history;
 RETURN coalesce((SELECT jsonb_agg(x) FROM (SELECT value x FROM jsonb_array_elements(result) WITH ORDINALITY x(value,n) ORDER BY n LIMIT 8) limited),'[]');
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_tasks_added(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_tasks_added(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.cockpit_finish_csm_action(p_id uuid,p_result jsonb,p_patch jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.cockpit_csm_actions;d bigint;item jsonb;task jsonb;i integer:=0;name text;actor_exists boolean;
BEGIN
 SELECT * INTO a FROM public.cockpit_csm_actions WHERE id=p_id FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Client-success action not found';END IF;
 IF a.state='confirmed' THEN RETURN a.result;END IF;
 IF a.state<>'sending' THEN RAISE EXCEPTION 'Client-success action needs reconciliation';END IF;
 SELECT EXISTS(SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id WHERE m.auth_user_id=a.actor_id AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email)) AND m.email=a.actor_email AND ('admin'=ANY(m.roles) OR 'csm'=ANY(m.roles) OR m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')) AND ('admin'=ANY(m.roles) OR m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com') OR cardinality(m.clients)=0 OR (a.operation='act' AND EXISTS(SELECT 1 FROM unnest(m.clients) c WHERE lower(btrim(c))=lower(btrim(a.context->>'clientName')))) OR (a.operation='plan' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.request->'items') it WHERE nullif(it->>'clientName','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unnest(m.clients) c WHERE lower(btrim(c))=lower(btrim(it->>'clientName'))))))) INTO actor_exists;
 IF NOT actor_exists THEN RAISE EXCEPTION 'Client-success access changed; reconcile provider result';END IF;
 IF p_result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Provider result was not confirmed';END IF;
 IF a.operation='act' THEN
  name:=a.context->>'clientName';
  IF p_result->>'commentId' IS NULL THEN RAISE EXCEPTION 'ClickUp comment was not confirmed';END IF;
  INSERT INTO public.cockpit_decisions(role,day,subject,action,evidence,kind,clickup_task_id,clickup_task_url,logged_at,reason,metadata,source_system)
   VALUES('csm',(a.context->>'day')::date,name,a.request->>'action',a.context->>'evidence',CASE WHEN a.request->>'kind'='left' THEN 'left' WHEN nullif(a.request->>'department','') IS NOT NULL THEN 'rerouted' ELSE 'approved' END,a.context->>'taskId',coalesce(p_result->>'ticketUrl','https://app.clickup.com/t/'||(a.context->>'taskId')),now(),coalesce(a.request->>'note',a.request->>'reason'),a.request||jsonb_build_object('receiptId',p_id,'commentId',p_result->>'commentId','reroutedTo',a.request->>'department'),'supabase') RETURNING id INTO d;
  IF p_patch<>'{}'::jsonb THEN
   INSERT INTO public.cockpit_csm_client_overrides(task_id,client_name,data,action_id) VALUES(a.context->>'taskId',name,p_patch,p_id) ON CONFLICT(task_id) DO UPDATE SET data=(CASE WHEN EXISTS(SELECT 1 FROM public.cockpit_csm_sources r JOIN public.cockpit_csm_source_state st ON st.table_name=r.table_name AND st.source_snapshot_at=r.source_snapshot_at AND st.ready WHERE r.table_name='clients' AND r.data->>'taskId'=public.cockpit_csm_client_overrides.task_id AND (r.data->>'syncedAt')::numeric>=extract(epoch FROM public.cockpit_csm_client_overrides.confirmed_at)*1000) THEN '{}'::jsonb ELSE public.cockpit_csm_client_overrides.data END)||excluded.data,action_id=p_id,confirmed_at=now();
  END IF;
 ELSE
  IF jsonb_typeof(p_result->'tasks') IS DISTINCT FROM 'array' OR jsonb_array_length(p_result->'tasks')<>jsonb_array_length(a.request->'items') THEN RAISE EXCEPTION 'Every planned task needs a provider confirmation';END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(a.request->'items') LOOP
   task:=p_result->'tasks'->i;i:=i+1;
   IF task->>'id' IS NULL OR task->>'url' IS NULL THEN RAISE EXCEPTION 'Task creation was not confirmed';END IF;
   INSERT INTO public.cockpit_plan_items(role,day,text,reason,client_name,list_name,due_date,owner_id,provider_task_id,provider_task_url,confirmed) VALUES('csm',(a.context->>'day')::date,item->>'text',item->>'reason',item->>'clientName','Client Success',coalesce(nullif(item->>'dueDate','')::date,(a.context->>'day')::date+1),a.actor_id,task->>'id',task->>'url',true);
  END LOOP;
 END IF;
 UPDATE public.cockpit_csm_actions SET state='confirmed',result=p_result||jsonb_build_object('receiptId',p_id),finished_at=now() WHERE id=p_id;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,before,after) VALUES('csm.'||a.operation,'cockpit_csm_actions',p_id::text,a.actor_email,'client-success',to_jsonb(a),p_result||jsonb_build_object('patch',p_patch));
 RETURN p_result||jsonb_build_object('receiptId',p_id);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_action_context(text,jsonb),public.cockpit_finish_csm_action(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_action_context(text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_finish_csm_action(uuid,jsonb,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.cockpit_csm_source_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,before,after) VALUES(lower(TG_OP),'csm_source',NEW.table_name||coalesce(':'||(to_jsonb(NEW)->>'source_id'),''),'client-success',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cockpit_csm_source_audit ON public.cockpit_csm_sources;
CREATE TRIGGER cockpit_csm_source_audit AFTER INSERT OR UPDATE ON public.cockpit_csm_sources FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_source_audit();
DROP TRIGGER IF EXISTS cockpit_csm_state_audit ON public.cockpit_csm_source_state;
CREATE TRIGGER cockpit_csm_state_audit AFTER INSERT OR UPDATE ON public.cockpit_csm_source_state FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_source_audit();
CREATE OR REPLACE FUNCTION public.cockpit_csm_action_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,before,after) VALUES(lower(TG_OP),'cockpit_csm_actions',NEW.id::text,NEW.actor_email,'client-success',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cockpit_csm_action_audit ON public.cockpit_csm_actions;
CREATE TRIGGER cockpit_csm_action_audit AFTER INSERT OR UPDATE ON public.cockpit_csm_actions FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_action_audit();
REVOKE ALL ON FUNCTION public.cockpit_csm_action_audit() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cockpit_csm_source_read(),public.cockpit_csm_source_audit() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_source_read() TO authenticated;
COMMIT;
