-- A service hold is separate from the synced ClickUp status. It never edits client data.
CREATE TABLE IF NOT EXISTS public.cockpit_client_holds (
 clickup_id text PRIMARY KEY, client_name text NOT NULL, location_id text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('pause','offboard')), state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','released','complete')),
 action_id uuid NOT NULL REFERENCES public.cockpit_media_actions(id), task_id text, reason text NOT NULL,
 campaigns_checked_at timestamptz, unverified jsonb NOT NULL DEFAULT '[]',
 checks jsonb NOT NULL DEFAULT '{}', revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cockpit_client_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_client_holds FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.cockpit_client_holds TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_client_lifecycle_context(p_actor uuid,p_client text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members; b public.cockpit_board_clients; accounts text[]; h public.cockpit_client_holds; admin boolean;
BEGIN
 SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users u ON u.id=cm.auth_user_id WHERE cm.auth_user_id=p_actor AND cm.active AND u.email_confirmed_at IS NOT NULL AND cm.email=lower(btrim(u.email));
 admin:=coalesce(m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com') OR 'admin'=ANY(m.roles),false);
 IF m.auth_user_id IS NULL OR NOT(admin OR 'media_buyer'=ANY(m.roles)) THEN RAISE EXCEPTION 'Current media buyer membership required'; END IF;
 SELECT * INTO b FROM public.cockpit_board_clients WHERE clickup_id=p_client;
 IF b.clickup_id IS NULL OR NOT(admin OR cardinality(m.clients)=0 OR EXISTS(SELECT 1 FROM unnest(m.clients)n WHERE lower(btrim(n))=lower(btrim(b.client_name)))) THEN RAISE EXCEPTION 'This client is not on your access list'; END IF;
 accounts:=public.cockpit_launch_accounts(b.location_id);
 IF EXISTS(SELECT 1 FROM public.cockpit_board_clients x WHERE x.location_id<>b.location_id AND public.cockpit_launch_accounts(x.location_id)&&accounts) OR EXISTS(SELECT 1 FROM public.cockpit_board_account_ties t WHERE t.account_id=ANY(accounts) AND (t.kept_out OR t.location_id<>b.location_id)) THEN RAISE EXCEPTION 'The account mapping is ambiguous. Resolve it before pausing'; END IF;
 SELECT * INTO h FROM public.cockpit_client_holds WHERE clickup_id=p_client;
 RETURN jsonb_build_object('actor',p_actor,'clickupId',p_client,'client',b.client_name,'locationId',b.location_id,'accounts',to_jsonb(accounts),'lifecycle',CASE WHEN h.clickup_id IS NOT NULL THEN to_jsonb(h)||jsonb_build_object('actionState',(SELECT state FROM public.cockpit_media_actions WHERE id=h.action_id),'actionError',(SELECT result->>'error' FROM public.cockpit_media_actions WHERE id=h.action_id)) END,'canRelease',admin OR h.mode='pause');
END $$;
REVOKE ALL ON FUNCTION public.cockpit_client_lifecycle_context(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_client_lifecycle_context(uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.cockpit_client_lifecycle_scope(p_client text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.cockpit_client_lifecycle_context(auth.uid(),p_client) $$;
REVOKE ALL ON FUNCTION public.cockpit_client_lifecycle_scope(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_client_lifecycle_scope(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_client_stop_begin(p_actor uuid,p_id uuid,p_operation text,p_args jsonb,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; a public.cockpit_media_actions; h public.cockpit_client_holds; mode text;
BEGIN
 IF p_operation NOT IN ('client.pause','client.offboard') OR p_id IS NULL OR length(btrim(coalesce(p_args->>'reason',''))) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Choose pause or offboarding and add a reason'; END IF;
 s:=public.cockpit_client_lifecycle_context(p_actor,p_args->>'clickupId');
 PERFORM pg_advisory_xact_lock(hashtextextended('client-hold:'||(s->>'clickupId'),0));
 SELECT * INTO a FROM public.cockpit_media_actions WHERE id=p_id;
 IF FOUND THEN
  IF a.actor_id=p_actor AND a.operation=p_operation AND a.request->'args'=p_args AND a.state='confirmed' THEN RETURN jsonb_build_object('reused',true,'result',a.result); END IF;
  RAISE EXCEPTION 'This request already has an intent. Review its receipt before retrying';
 END IF;
 s:=public.cockpit_client_lifecycle_context(p_actor,p_args->>'clickupId');
 IF s IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'Client access or its service hold changed. Refresh before continuing'; END IF;
 SELECT * INTO h FROM public.cockpit_client_holds WHERE clickup_id=s->>'clickupId';
 IF h.state<>'released' AND EXISTS(SELECT 1 FROM public.cockpit_media_actions WHERE id=h.action_id AND state<>'confirmed') THEN RAISE EXCEPTION 'An earlier pause needs reconciliation. Check its receipts first'; END IF;
 mode:=CASE WHEN p_operation='client.offboard' THEN 'offboard' ELSE 'pause' END;
 IF h.mode='offboard' AND h.state<>'released' AND mode='pause' THEN RAISE EXCEPTION 'Full offboarding is already open. Use its review'; END IF;
 INSERT INTO public.cockpit_media_actions(id,actor_id,operation,request) VALUES(p_id,p_actor,p_operation,jsonb_build_object('args',p_args));
 INSERT INTO public.cockpit_client_holds(clickup_id,client_name,location_id,mode,action_id,reason) VALUES(s->>'clickupId',s->>'client',s->>'locationId',mode,p_id,btrim(p_args->>'reason'))
 ON CONFLICT(clickup_id) DO UPDATE SET mode=excluded.mode,state='active',action_id=p_id,reason=excluded.reason,revision=cockpit_client_holds.revision+1,updated_at=now(),checks=CASE WHEN cockpit_client_holds.state='released' THEN '{}'::jsonb ELSE cockpit_client_holds.checks END,task_id=CASE WHEN cockpit_client_holds.state='released' THEN NULL ELSE cockpit_client_holds.task_id END;
 RETURN jsonb_build_object('reused',false);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_client_stop_begin(uuid,uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_client_stop_begin(uuid,uuid,text,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_client_stop_finish(p_id uuid,p_result jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_client_holds WHERE action_id=p_id AND state='active') THEN RAISE EXCEPTION 'The client hold changed'; END IF;
 PERFORM public.cockpit_finish_media_action(p_id,p_result,p_result);
 UPDATE public.cockpit_client_holds SET task_id=p_result->>'taskId',campaigns_checked_at=(p_result->>'checkedAt')::timestamptz,unverified=coalesce(p_result->'unverified','[]'),revision=revision+1,updated_at=now() WHERE action_id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_client_stop_finish(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_client_stop_finish(uuid,jsonb) TO service_role;

-- Human confirmations are labelled as such and carry the member, time and evidence.
CREATE OR REPLACE FUNCTION public.cockpit_client_lifecycle_action(p_client text,p_revision integer,p_action text,p_step text DEFAULT NULL,p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; h public.cockpit_client_holds;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('client-hold:'||p_client,0));
 s:=public.cockpit_client_lifecycle_context(auth.uid(),p_client);
 SELECT * INTO h FROM public.cockpit_client_holds WHERE clickup_id=p_client FOR UPDATE;
 IF h.clickup_id IS NULL OR h.revision<>p_revision OR h.state='released' THEN RAISE EXCEPTION 'This record changed. Refresh before saving'; END IF;
 IF length(btrim(coalesce(p_note,''))) NOT BETWEEN 12 AND 2000 THEN RAISE EXCEPTION 'Add what you checked and the evidence link, up to 2000 characters'; END IF;
 IF EXISTS(SELECT 1 FROM public.cockpit_media_actions WHERE id=h.action_id AND state<>'confirmed') THEN RAISE EXCEPTION 'The pause receipt needs reconciliation first'; END IF;
 IF p_action='release' THEN
  IF NOT coalesce((s->>'canRelease')::boolean,false) THEN RAISE EXCEPTION 'An admin reviews offboarding before reopening launches'; END IF;
  UPDATE public.cockpit_client_holds SET state='released' WHERE clickup_id=p_client;
 ELSIF p_action='check' THEN
  IF h.mode<>'offboard' OR h.state<>'active' OR p_step NOT IN ('campaigns','client_access','agency_access','connections') THEN RAISE EXCEPTION 'Choose an open offboarding step'; END IF;
  UPDATE public.cockpit_client_holds SET checks=checks||jsonb_build_object(p_step,jsonb_build_object('note',btrim(p_note),'actor',auth.uid(),'at',now(),'confirmation','team')) WHERE clickup_id=p_client;
 ELSIF p_action='complete' THEN
  IF h.mode<>'offboard' OR h.state<>'active' OR NOT(h.checks ?& ARRAY['campaigns','client_access','agency_access','connections']) THEN RAISE EXCEPTION 'Confirm every offboarding step first'; END IF;
  UPDATE public.cockpit_client_holds SET state='complete' WHERE clickup_id=p_client;
 ELSE RAISE EXCEPTION 'Unknown offboarding action'; END IF;
 UPDATE public.cockpit_client_holds SET revision=revision+1,updated_at=now() WHERE clickup_id=p_client RETURNING * INTO h;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata) VALUES('client.'||p_action,'client_offboarding',p_client,(SELECT email FROM auth.users WHERE id=auth.uid()),'media-buyer','supabase',jsonb_build_object('step',p_step,'note',p_note,'actor',auth.uid(),'confirmation','team'));
 RETURN jsonb_build_object('ok',true,'lifecycle',to_jsonb(h));
END $$;
REVOKE ALL ON FUNCTION public.cockpit_client_lifecycle_action(text,integer,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_client_lifecycle_action(text,integer,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_assert_no_client_hold(p_client text,p_account text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.cockpit_client_holds h WHERE state<>'released' AND (lower(btrim(h.client_name))=lower(btrim(p_client)) OR p_account=ANY(public.cockpit_launch_accounts(h.location_id)))) THEN RAISE EXCEPTION 'This client has a pause or offboarding hold. Review it in Clients before changing campaigns'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_assert_no_client_hold(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_assert_no_client_hold(text,text) TO service_role;

DO $$ BEGIN IF to_regprocedure('public.cockpit_media_account_scope_before_client_hold(text,text,text,uuid)') IS NULL THEN ALTER FUNCTION public.cockpit_media_account_scope(text,text,text,uuid) RENAME TO cockpit_media_account_scope_before_client_hold; END IF; END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_account_scope_before_client_hold(text,text,text,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.cockpit_media_account_scope(p_operation text,p_clickup_id text,p_account text,p_launch uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; BEGIN s:=public.cockpit_media_account_scope_before_client_hold(p_operation,p_clickup_id,p_account,p_launch); IF p_operation NOT IN ('launch.readiness','launch.copyIdeas','launch.discard') THEN PERFORM public.cockpit_assert_no_client_hold(s->>'client',s->>'account'); END IF; RETURN s; END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_account_scope(text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_account_scope(text,text,text,uuid) TO authenticated;

DO $$ BEGIN IF to_regprocedure('public.cockpit_media_scope_before_client_hold(text,text)') IS NULL THEN ALTER FUNCTION public.cockpit_media_scope(text,text) RENAME TO cockpit_media_scope_before_client_hold; END IF; END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_scope_before_client_hold(text,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.cockpit_media_scope(p_operation text,p_campaign text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; BEGIN s:=public.cockpit_media_scope_before_client_hold(p_operation,p_campaign); IF p_operation NOT IN ('board.adStatusOptions','board.advertisingCityOptions','funnel.read') AND p_operation NOT LIKE 'ceo.%' THEN PERFORM public.cockpit_assert_no_client_hold(s->>'client',s->>'account'); END IF; RETURN s; END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_scope(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_scope(text,text) TO authenticated;

DO $$ BEGIN IF to_regprocedure('public.cockpit_media_native_guard_before_client_hold(uuid,uuid)') IS NULL THEN ALTER FUNCTION public.cockpit_media_native_guard(uuid,uuid) RENAME TO cockpit_media_native_guard_before_client_hold; END IF; END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_native_guard_before_client_hold(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.cockpit_media_native_guard(p_job_id uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; BEGIN s:=public.cockpit_media_native_guard_before_client_hold(p_job_id,p_token); PERFORM public.cockpit_assert_no_client_hold(s->'record'->>'client_name',coalesce(s->'record'->'data'->>'accountId',s->'campaign'->>'meta_account_id')); RETURN s; END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_native_guard(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_native_guard(uuid,uuid) TO service_role;

DO $$ BEGIN IF to_regprocedure('public.cockpit_launch_import_scope_before_client_hold(uuid,text,text)') IS NULL THEN ALTER FUNCTION public.cockpit_launch_import_scope(uuid,text,text) RENAME TO cockpit_launch_import_scope_before_client_hold; END IF; END $$;
REVOKE ALL ON FUNCTION public.cockpit_launch_import_scope_before_client_hold(uuid,text,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.cockpit_launch_import_scope(p_actor uuid,p_client text,p_account text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; BEGIN s:=public.cockpit_launch_import_scope_before_client_hold(p_actor,p_client,p_account); PERFORM public.cockpit_assert_no_client_hold(s->>'client',s->>'account'); RETURN s; END $$;
REVOKE ALL ON FUNCTION public.cockpit_launch_import_scope(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_launch_import_scope(uuid,text,text) TO service_role;

DO $$ BEGIN IF to_regprocedure('public.cockpit_media_clients_before_client_hold(text)') IS NULL THEN ALTER FUNCTION public.cockpit_media_clients(text) RENAME TO cockpit_media_clients_before_client_hold; END IF; END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_clients_before_client_hold(text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.cockpit_media_clients(p_clickup_id text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p jsonb; rows jsonb; history jsonb; BEGIN
 p:=public.cockpit_media_clients_before_client_hold(p_clickup_id);
 SELECT coalesce(jsonb_agg(c||jsonb_build_object('serviceHold',CASE WHEN h.clickup_id IS NOT NULL THEN jsonb_build_object('mode',h.mode,'state',h.state,'reason',h.reason) END)),'[]') INTO rows FROM jsonb_array_elements(p->'clients')c LEFT JOIN public.cockpit_client_holds h ON h.clickup_id=c->>'id';
 IF p_clickup_id IS NOT NULL AND jsonb_array_length(rows)=1 THEN
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'at' DESC),'[]') INTO history FROM (SELECT x FROM (
   SELECT x FROM jsonb_array_elements(coalesce(rows->0->'actionHistory','[]'))x
   UNION ALL SELECT jsonb_build_object('id',a.id,'operation',a.action,'state','recorded','at',a.created_at,'actor',coalesce(m.name,'Team member'),'did',CASE a.action WHEN 'client.check' THEN 'Team confirmed: '||replace(a.metadata->>'step','_',' ') WHEN 'client.release' THEN 'Campaign hold reopened. No campaign was switched on.' ELSE 'Offboarding completed by the team.' END) FROM public.cockpit_audit_log a LEFT JOIN public.cockpit_members m ON m.auth_user_id::text=a.metadata->>'actor' WHERE a.entity_type='client_offboarding' AND a.entity_id=p_clickup_id
  ) e ORDER BY x->>'at' DESC LIMIT 50) q;
  rows:=jsonb_set(rows,'{0,actionHistory}',history);
 END IF;
 RETURN jsonb_set(p,'{clients}',rows);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_clients(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_clients(text) TO authenticated;

-- A paused/offboarded client must not receive an automatic relaunch suggestion.
DO $$ BEGIN IF to_regprocedure('public.cockpit_media_client_notices_before_client_hold()') IS NULL THEN ALTER FUNCTION public.cockpit_media_client_notices() RENAME TO cockpit_media_client_notices_before_client_hold; END IF; END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_client_notices_before_client_hold() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.cockpit_media_client_notices() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p jsonb; items jsonb; additions jsonb; m public.cockpit_members;
BEGIN
 p:=public.cockpit_media_client_notices_before_client_hold();
 SELECT coalesce(jsonb_agg(n),'[]') INTO items FROM jsonb_array_elements(p->'notices')n WHERE NOT(n->>'kind' IN ('relaunch','review','delivery') AND EXISTS(SELECT 1 FROM public.cockpit_client_holds h WHERE h.clickup_id=n->>'clientId' AND h.state<>'released'));
 m:=public.cockpit_launch_member();
 SELECT coalesce(jsonb_agg(jsonb_build_object('id','service:'||h.clickup_id,'kind','service','title',h.client_name,'body',CASE WHEN h.mode='offboard' THEN 'Offboarding is open. Review access removal and team confirmations.' ELSE 'Campaign changes are on hold. Review before relaunching.' END,'clientId',h.clickup_id,'clientName',h.client_name,'href','/clients?client='||h.clickup_id||'&tab=service','version',h.revision::text,'priority',CASE WHEN h.mode='offboard' THEN 1 ELSE 2 END,'read',r.version=h.revision::text)),'[]') INTO additions
 FROM public.cockpit_client_holds h LEFT JOIN public.cockpit_media_notice_reads r ON r.actor_id=m.auth_user_id AND r.notice_id='service:'||h.clickup_id
 WHERE h.state='active' AND (m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com') OR 'admin'=ANY(m.roles) OR cardinality(m.clients)=0 OR EXISTS(SELECT 1 FROM unnest(m.clients)n WHERE lower(btrim(n))=lower(btrim(h.client_name))));
 RETURN jsonb_set(p,'{notices}',items||additions);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_media_client_notices() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_client_notices() TO authenticated;
