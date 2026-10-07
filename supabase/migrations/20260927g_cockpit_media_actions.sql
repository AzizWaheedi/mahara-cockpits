BEGIN;
-- Durable provider intent precedes every write. An interrupted intent is never retried automatically.
CREATE TABLE public.cockpit_media_actions (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL, operation text NOT NULL,
 campaign_name text, request jsonb NOT NULL, state text NOT NULL DEFAULT 'pending'
 CHECK(state IN ('pending','confirmed','reconcile')), result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE public.cockpit_media_provider_health (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, action_id uuid,
 provider text NOT NULL, method text NOT NULL, resource text NOT NULL,
 phase text NOT NULL CHECK(phase IN ('intent','response','unknown')),
 http_status integer, object_id text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cockpit_media_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_media_provider_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_media_actions,public.cockpit_media_provider_health FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_media_actions TO service_role;
GRANT SELECT,INSERT ON public.cockpit_media_provider_health TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.cockpit_media_provider_health_id_seq TO service_role;

CREATE FUNCTION public.cockpit_media_scope(p_operation text,p_campaign text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members; c public.cockpit_campaigns; n integer; founder boolean; client text;
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
 SELECT count(*) INTO n FROM public.cockpit_campaigns WHERE raw_data->>'campaignName'=p_campaign;
 IF n<>1 THEN RAISE EXCEPTION 'Campaign is missing or ambiguous; refresh the campaign source'; END IF;
 SELECT * INTO c FROM public.cockpit_campaigns WHERE raw_data->>'campaignName'=p_campaign;
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

-- Successful receipts are immutable; pending work can only be finalized once.
CREATE FUNCTION public.cockpit_media_action_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state<>'pending' OR NEW.id<>OLD.id OR NEW.actor_id<>OLD.actor_id OR NEW.operation<>OLD.operation
 OR NEW.request<>OLD.request OR NEW.campaign_name IS DISTINCT FROM OLD.campaign_name
 THEN RAISE EXCEPTION 'Provider receipt is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cockpit_media_action_immutable BEFORE UPDATE ON public.cockpit_media_actions
 FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_action_guard();

CREATE FUNCTION public.cockpit_finish_media_action(p_id uuid,p_result jsonb,p_actual jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.cockpit_media_actions; patch jsonb:='{}';
BEGIN
 SELECT * INTO a FROM public.cockpit_media_actions WHERE id=p_id FOR UPDATE;
 IF a.id IS NULL OR a.state<>'pending' THEN RAISE EXCEPTION 'Pending provider intent required'; END IF;
 IF p_result->>'ok'<>'true' THEN RAISE EXCEPTION 'Confirmed provider result required'; END IF;
 IF a.operation='board.setAdStatus' THEN patch:=jsonb_build_object('boardAdStatus',a.request->'args'->>'status');
 ELSIF a.operation='board.setAdvertisingCities' THEN patch:=jsonb_build_object('advertisingCities',a.request->'args'->'cities');
 ELSIF a.operation='board.renameCard' THEN patch:=jsonb_build_object('staleTaskName',NULL);
 ELSIF a.operation='board.addToBoard' THEN
   patch:=jsonb_build_object('taskId',p_actual->>'id','taskUrl',p_actual->>'url','boardAdStatus',coalesce(a.request->'args'->>'status','Active'));
 END IF;
 UPDATE public.cockpit_campaigns SET raw_data=raw_data||patch,
   task_id=CASE WHEN a.operation='board.addToBoard' THEN p_actual->>'id' ELSE task_id END,
   task_url=CASE WHEN a.operation='board.addToBoard' THEN p_actual->>'url' ELSE task_url END,
   updated_at=now() WHERE raw_data->>'campaignName'=a.campaign_name;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"after",metadata)
 VALUES(a.operation,'provider_action',a.id::text,(SELECT email FROM auth.users WHERE id=a.actor_id),
   'media-buyer','supabase',p_result,jsonb_build_object('campaign',a.campaign_name,'request',a.request,'provider_confirmed',true));
 UPDATE public.cockpit_media_actions SET state='confirmed',result=p_result,completed_at=now() WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_finish_media_action(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_finish_media_action(uuid,jsonb,jsonb) TO service_role;
COMMIT;
