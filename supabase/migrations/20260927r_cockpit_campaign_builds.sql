BEGIN;
CREATE TABLE IF NOT EXISTS public.cockpit_campaign_drafts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id text UNIQUE,client_tag text NOT NULL,client_name text NOT NULL,account_id text NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),status text NOT NULL DEFAULT 'building' CHECK(status IN('building','ready','failed','launching','launched','discarded')),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cockpit_campaign_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_campaign_drafts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_campaign_drafts TO service_role;
CREATE OR REPLACE FUNCTION public.cockpit_build_scope(p_tag text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.cockpit_campaigns; n int;
BEGIN
 IF NOT (public.cockpit_has_role('media_buyer') OR public.cockpit_is_ceo()) THEN RAISE EXCEPTION 'Media buyer access required' USING ERRCODE='42501'; END IF;
 SELECT count(DISTINCT regexp_replace(meta_account_id,'^act_','')) INTO n FROM public.cockpit_campaigns cr WHERE raw_data->>'clientTag'=p_tag AND nullif(meta_account_id,'') IS NOT NULL AND coalesce((to_jsonb(cr)->>'source_deleted')::boolean,false)=false;
 IF n<>1 THEN RAISE EXCEPTION 'The client ad account is missing or ambiguous. Refresh its mapping first'; END IF;
 SELECT cr.* INTO c FROM public.cockpit_campaigns cr WHERE raw_data->>'clientTag'=p_tag AND nullif(meta_account_id,'') IS NOT NULL AND coalesce((to_jsonb(cr)->>'source_deleted')::boolean,false)=false
 ORDER BY CASE WHEN (raw_data->>'leads7d')::numeric>0 THEN (raw_data->>'cpl')::numeric END ASC NULLS LAST, id LIMIT 1;
 IF NOT public.cockpit_client_allowed(c.client_name) THEN RAISE EXCEPTION 'Client is outside your assignments' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('actor',auth.uid(),'client',c.client_name,'clientTag',p_tag,'account',regexp_replace(c.meta_account_id,'^act_',''),'campaign',c.meta_campaign_id,'campaignName',c.raw_data->>'campaignName','source',c.raw_data);
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_build_action(p_operation text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_campaign_drafts;scope jsonb; result jsonb;variants jsonb:=p_args->'variants';
BEGIN
 IF p_operation='list' THEN
  scope:=public.cockpit_build_scope(p_args->>'clientTag');
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'at')::numeric DESC),'[]') INTO result FROM(
   SELECT data||jsonb_build_object('_id',id,'clientTag',client_tag,'clientName',client_name,'accountId',account_id,'status',status,'by',created_by,'at',extract(epoch FROM created_at)*1000) x FROM public.cockpit_campaign_drafts WHERE client_tag=p_args->>'clientTag' AND status<>'discarded'
  ) rows;RETURN result;
 END IF;
 SELECT * INTO r FROM public.cockpit_campaign_drafts WHERE id=(p_args->>'id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Campaign draft not found'; END IF;
 scope:=public.cockpit_build_scope(r.client_tag);
 IF scope->>'account'<>r.account_id OR scope->>'client'<>r.client_name THEN RAISE EXCEPTION 'Client mapping changed. Reconcile this draft first'; END IF;
 IF p_operation='get' THEN RETURN r.data||jsonb_build_object('_id',r.id,'_version',r.updated_at,'clientTag',r.client_tag,'clientName',r.client_name,'accountId',r.account_id,'status',r.status); END IF;
 IF r.status<>'ready' THEN RAISE EXCEPTION 'Only a ready draft can be edited or discarded'; END IF;
 IF p_operation='saveVariants' THEN
  IF jsonb_typeof(variants) IS DISTINCT FROM 'array' OR jsonb_array_length(variants) NOT BETWEEN 1 AND 5 OR EXISTS(SELECT 1 FROM jsonb_array_elements(variants) v WHERE jsonb_typeof(v) IS DISTINCT FROM 'object' OR jsonb_typeof(v->'headline') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'primaryText') IS DISTINCT FROM 'string' OR length(v->>'headline')>120 OR length(v->>'primaryText')>1200 OR length(coalesce(v->>'description',''))>300) THEN RAISE EXCEPTION 'Provide one to five valid copy variants'; END IF;
  UPDATE public.cockpit_campaign_drafts SET data=data||jsonb_build_object('variants',variants),updated_at=now() WHERE id=r.id AND data->'variants' IS DISTINCT FROM variants;
 ELSIF p_operation='discard' THEN UPDATE public.cockpit_campaign_drafts SET status='discarded',updated_at=now() WHERE id=r.id;
 ELSE RAISE EXCEPTION 'Unknown campaign draft operation'; END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_build_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE email text;
BEGIN
 SELECT lower(btrim(u.email)) INTO email FROM auth.users u WHERE u.id=auth.uid();
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,before,after) VALUES(lower(TG_OP),'campaign_draft',NEW.id::text,coalesce(email,NEW.created_by),'media_buyer',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cockpit_campaign_draft_audit ON public.cockpit_campaign_drafts;
CREATE TRIGGER cockpit_campaign_draft_audit AFTER INSERT OR UPDATE ON public.cockpit_campaign_drafts FOR EACH ROW EXECUTE FUNCTION public.cockpit_build_audit();
REVOKE ALL ON FUNCTION public.cockpit_build_scope(text),public.cockpit_build_action(text,jsonb),public.cockpit_build_audit() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_build_scope(text),public.cockpit_build_action(text,jsonb) TO authenticated;
COMMIT;
