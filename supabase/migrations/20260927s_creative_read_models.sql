BEGIN;
CREATE TABLE IF NOT EXISTS public.cockpit_creative_source_state(
 table_name text PRIMARY KEY CHECK(table_name IN('clients','creativeTasks','videoJobs','contentPosts','touchLog','campaigns','ads','metaTree','funnels','winnersArchive','marketPlays','blueprints')),
 ready boolean NOT NULL DEFAULT false,row_count integer,source_snapshot_at timestamptz,
 CHECK(NOT ready OR (row_count IS NOT NULL AND row_count>=0 AND source_snapshot_at IS NOT NULL))
);
INSERT INTO public.cockpit_creative_source_state(table_name) SELECT unnest(ARRAY['clients','creativeTasks','videoJobs','contentPosts','touchLog','campaigns','ads','metaTree','funnels','winnersArchive','marketPlays','blueprints']) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.cockpit_creative_sources(
 table_name text NOT NULL REFERENCES public.cockpit_creative_source_state(table_name),source_id text NOT NULL,
 client_names text[] NOT NULL DEFAULT '{}',data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),source_snapshot_at timestamptz NOT NULL,
 PRIMARY KEY(table_name,source_id),CHECK(data ? '_id' AND data->>'_id'=source_id)
);
ALTER TABLE public.cockpit_creative_source_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_creative_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_creative_source_state,public.cockpit_creative_sources FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_creative_source_state,public.cockpit_creative_sources TO service_role;
CREATE OR REPLACE FUNCTION public.cockpit_creative_source_current(p_table text,p_stamp timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.cockpit_creative_source_state s WHERE s.table_name=p_table AND s.ready AND s.source_snapshot_at=p_stamp);
$$;
REVOKE ALL ON FUNCTION public.cockpit_creative_source_current(text,timestamptz) FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS public.cockpit_creative_touch_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_name text NOT NULL,kind text NOT NULL,note text,actor_id uuid NOT NULL,actor_email text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.cockpit_creative_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_name text NOT NULL,kind text NOT NULL,task_id text,payload jsonb NOT NULL,actor_id uuid NOT NULL,actor_email text NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','sending','done','failed','reconcile')),result jsonb,error text,created_at timestamptz NOT NULL DEFAULT now(),settled_at timestamptz);
ALTER TABLE public.cockpit_creative_touch_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_creative_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_creative_touch_log,public.cockpit_creative_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.cockpit_creative_touch_log TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_creative_outbox TO service_role;
CREATE OR REPLACE FUNCTION public.cockpit_creative_source_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members;result jsonb;missing text;
BEGIN
 IF NOT(public.cockpit_has_role('creative') OR public.cockpit_has_role('csm') OR public.cockpit_is_ceo()) THEN RAISE EXCEPTION 'Verified creative access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.cockpit_members WHERE auth_user_id=auth.uid();
 SELECT string_agg(table_name,', ' ORDER BY table_name) INTO missing FROM public.cockpit_creative_source_state WHERE NOT ready;
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'Creative source history is not verified: %',missing; END IF;
 SELECT string_agg(s.table_name,', ' ORDER BY s.table_name) INTO missing FROM public.cockpit_creative_source_state s WHERE s.row_count IS DISTINCT FROM (SELECT count(*) FROM public.cockpit_creative_sources r WHERE r.table_name=s.table_name AND r.source_snapshot_at=s.source_snapshot_at);
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'Creative source row count does not match its verified snapshot: %',missing;END IF;
 SELECT jsonb_object_agg(s.table_name,coalesce((SELECT jsonb_agg(r.data ORDER BY r.source_id) FROM public.cockpit_creative_sources r WHERE r.table_name=s.table_name AND (
 s.table_name IN('winnersArchive','marketPlays') OR public.cockpit_is_ceo() OR 'admin'=ANY(m.roles) OR cardinality(m.clients)=0 OR EXISTS(SELECT 1 FROM unnest(r.client_names) c WHERE public.cockpit_client_allowed(c))
 ) AND r.source_snapshot_at=s.source_snapshot_at),'[]'::jsonb)) INTO result FROM public.cockpit_creative_source_state s;
 result:=jsonb_set(result,'{touchLog}',coalesce(result->'touchLog','[]')||coalesce((SELECT jsonb_agg(jsonb_build_object('_id',id,'client',client_name,'kind',kind,'note',note,'at',extract(epoch FROM created_at)*1000,'day',(created_at AT TIME ZONE 'Asia/Kuwait')::date)) FROM public.cockpit_creative_touch_log WHERE public.cockpit_client_allowed(client_name)),'[]'));
 RETURN jsonb_build_object('tables',result,'source',jsonb_build_object('system','creative-director snapshot','snapshotAt',(SELECT min(source_snapshot_at) FROM public.cockpit_creative_source_state),'tables',(SELECT jsonb_object_agg(table_name,jsonb_build_object('rows',row_count,'snapshotAt',source_snapshot_at)) FROM public.cockpit_creative_source_state)));
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_creative_client_action(p_operation text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE client text;email text;row_id uuid;result jsonb;unrestricted boolean;queued public.cockpit_creative_outbox;kind text:=p_args->>'kind';task text:=nullif(p_args->>'taskId','');payload jsonb:=coalesce(p_args->'payload','{}'::jsonb);
BEGIN
 IF NOT(public.cockpit_has_role('creative') OR public.cockpit_is_ceo()) THEN RAISE EXCEPTION 'Verified creative access required' USING ERRCODE='42501'; END IF;
 SELECT lower(btrim(u.email)) INTO email FROM auth.users u WHERE u.id=auth.uid();
 unrestricted:=public.cockpit_has_role('admin') OR public.cockpit_is_ceo() OR EXISTS(SELECT 1 FROM public.cockpit_members WHERE auth_user_id=auth.uid() AND cardinality(clients)=0);
 IF p_operation='get' THEN
  SELECT * INTO queued FROM public.cockpit_creative_outbox WHERE id=(p_args->>'id')::uuid;
  IF NOT FOUND OR NOT public.cockpit_client_allowed(queued.client_name) OR (queued.actor_id<>auth.uid() AND NOT public.cockpit_is_ceo()) THEN RAISE EXCEPTION 'Client action is not available for your account' USING ERRCODE='42501';END IF;
  RETURN to_jsonb(queued)||jsonb_build_object('sourceTask',(SELECT r.data FROM public.cockpit_creative_sources r WHERE r.table_name IN('creativeTasks','videoJobs','contentPosts') AND public.cockpit_creative_source_current(r.table_name,r.source_snapshot_at) AND r.data->>'taskId'=queued.task_id LIMIT 1));
 END IF;
 IF p_operation='outbox' THEN
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'createdAt')::numeric DESC),'[]') INTO result FROM(SELECT jsonb_build_object('_id',o.id,'kind',o.kind,'taskId',o.task_id,'payload',o.payload,'state',o.state,'by',o.actor_email,'createdAt',extract(epoch FROM o.created_at)*1000,'result',o.result,'error',o.error) x FROM public.cockpit_creative_outbox o WHERE public.cockpit_client_allowed(o.client_name) ORDER BY created_at DESC LIMIT 40) r;RETURN result;
 END IF;
 IF p_operation='touch' THEN client:=p_args->>'client';
 ELSIF p_operation='queue' THEN
  IF kind IS NULL OR kind NOT IN('comment','complete','videoRequest','planScript','schedule') THEN RAISE EXCEPTION 'Choose a supported client action';END IF;
  client:=coalesce(payload->>'client',payload->>'clientName');
  IF task IS NOT NULL THEN
   SELECT r.client_names[1] INTO client FROM public.cockpit_creative_sources r WHERE r.table_name IN('creativeTasks','videoJobs','contentPosts') AND public.cockpit_creative_source_current(r.table_name,r.source_snapshot_at) AND r.data->>'taskId'=task LIMIT 1;
   IF client IS NULL AND unrestricted AND EXISTS(SELECT 1 FROM public.cockpit_creative_sources r WHERE r.table_name IN('creativeTasks','videoJobs','contentPosts') AND public.cockpit_creative_source_current(r.table_name,r.source_snapshot_at) AND r.data->>'taskId'=task AND cardinality(r.client_names)=0) THEN client:='Unassigned work';END IF;
   IF client IS NULL OR EXISTS(SELECT 1 FROM public.cockpit_creative_sources r CROSS JOIN unnest(r.client_names) c WHERE r.table_name IN('creativeTasks','videoJobs','contentPosts') AND public.cockpit_creative_source_current(r.table_name,r.source_snapshot_at) AND r.data->>'taskId'=task AND NOT public.cockpit_client_allowed(c)) THEN RAISE EXCEPTION 'Task is outside your assigned clients' USING ERRCODE='42501';END IF;
  ELSIF kind IN('comment','complete','schedule') THEN RAISE EXCEPTION 'Choose a task first';END IF;
 ELSE RAISE EXCEPTION 'Unknown client action'; END IF;
 IF NOT(task IS NOT NULL AND client='Unassigned work' AND unrestricted) AND (NOT EXISTS(SELECT 1 FROM public.cockpit_creative_sources WHERE table_name='clients' AND public.cockpit_creative_source_current(table_name,source_snapshot_at) AND data->>'name'=client) OR public.cockpit_client_allowed(client) IS NOT TRUE) THEN RAISE EXCEPTION 'Choose an assigned client' USING ERRCODE='42501';END IF;
 IF p_operation='touch' THEN
  INSERT INTO public.cockpit_creative_touch_log(client_name,kind,note,actor_id,actor_email) VALUES(client,coalesce(nullif(kind,''),'touchpoint'),nullif(left(p_args->>'note',4000),''),auth.uid(),email) RETURNING id INTO row_id;
 ELSE
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR octet_length(payload::text)>100000 THEN RAISE EXCEPTION 'Client action content is invalid';END IF;
  row_id:=coalesce(nullif(p_args->>'requestId','')::uuid,gen_random_uuid());
  INSERT INTO public.cockpit_creative_outbox(id,client_name,kind,task_id,payload,actor_id,actor_email) VALUES(row_id,client,kind,task,payload||jsonb_build_object('client',client),auth.uid(),email) ON CONFLICT(id) DO NOTHING;
  IF NOT FOUND THEN
   SELECT * INTO queued FROM public.cockpit_creative_outbox WHERE id=row_id;
   IF queued.actor_id<>auth.uid() OR queued.kind<>kind OR queued.task_id IS DISTINCT FROM task OR queued.payload IS DISTINCT FROM (payload||jsonb_build_object('client',client)) THEN RAISE EXCEPTION 'Client action retry does not match its original request';END IF;
   RETURN jsonb_build_object('id',row_id,'state',queued.state);
  END IF;
 END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,after) VALUES(p_operation,'creative_client_action',row_id::text,email,'creative',jsonb_build_object('client',client,'kind',kind,'args',p_args));
 RETURN jsonb_build_object('id',row_id,'state',CASE WHEN p_operation='queue' THEN 'pending' ELSE 'logged' END);
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_creative_source_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,before,after) VALUES(lower(TG_OP),'creative_source',NEW.table_name||':'||NEW.source_id,'creative',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW)); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cockpit_creative_source_audit ON public.cockpit_creative_sources;
CREATE TRIGGER cockpit_creative_source_audit AFTER INSERT OR UPDATE ON public.cockpit_creative_sources FOR EACH ROW EXECUTE FUNCTION public.cockpit_creative_source_audit();
CREATE OR REPLACE FUNCTION public.cockpit_creative_source_state_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,before,after) VALUES(lower(TG_OP),'creative_source_state',NEW.table_name,'creative_import',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_creative_source_state_audit() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS cockpit_creative_source_state_audit ON public.cockpit_creative_source_state;
CREATE TRIGGER cockpit_creative_source_state_audit AFTER INSERT OR UPDATE ON public.cockpit_creative_source_state FOR EACH ROW EXECUTE FUNCTION public.cockpit_creative_source_state_audit();
REVOKE ALL ON FUNCTION public.cockpit_creative_source_read(),public.cockpit_creative_source_audit() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_creative_source_read() TO authenticated;
REVOKE ALL ON FUNCTION public.cockpit_creative_client_action(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_creative_client_action(text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.cockpit_creative_outbox_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,before,after) VALUES(lower(TG_OP),'creative_outbox',NEW.id::text,NEW.actor_email,'creative',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_creative_outbox_audit() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS cockpit_creative_outbox_audit ON public.cockpit_creative_outbox;
CREATE TRIGGER cockpit_creative_outbox_audit AFTER INSERT OR UPDATE ON public.cockpit_creative_outbox FOR EACH ROW EXECUTE FUNCTION public.cockpit_creative_outbox_audit();
COMMIT;
