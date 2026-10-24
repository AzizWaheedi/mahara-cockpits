-- A missing revision is stale, not an exemption from optimistic concurrency.
CREATE OR REPLACE FUNCTION public.cockpit_client_lifecycle_action(p_client text,p_revision integer,p_action text,p_step text DEFAULT NULL,p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; h public.cockpit_client_holds;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('client-hold:'||p_client,0));
 s:=public.cockpit_client_lifecycle_context(auth.uid(),p_client);
 SELECT * INTO h FROM public.cockpit_client_holds WHERE clickup_id=p_client FOR UPDATE;
 IF h.clickup_id IS NULL OR h.revision IS DISTINCT FROM p_revision OR h.state='released' THEN RAISE EXCEPTION 'This record changed. Refresh before saving'; END IF;
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
