-- The ad billing worker applies an account change itself (Muhammed, 26 Oct 2026). The worker proves the change
-- first: an open ads task for the client links the account, its own Meta token reads it, and Client Data names it.
-- This function is the only write. It holds the monitor lease, refuses a stale revision or an account that another
-- binding has, and leaves one audit row with the old and new identity. The binding trigger then raises the revision,
-- resets the signal and skips unsent messages, as for a manual change.
BEGIN;
CREATE FUNCTION public.cockpit_ad_billing_move(p_lease uuid,p_binding uuid,p_revision integer,p_kind text,p_account text,p_ref text,p_ads_tasks text[],p_evidence text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.cockpit_ad_billing_bindings; n public.cockpit_ad_billing_bindings; other text;
BEGIN
 PERFORM 1 FROM public.cockpit_ad_billing_config WHERE lease=p_lease AND lease_until>now() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Monitor lease expired'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN('rename','tasks','move') THEN RAISE EXCEPTION 'Invalid account change'; END IF;
 IF p_account IS NULL OR p_account !~ '^[0-9]{5,25}$' THEN RAISE EXCEPTION 'Invalid Meta account'; END IF;
 IF p_ref IS NULL OR length(btrim(p_ref)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid Client Data reference'; END IF;
 IF p_evidence IS NULL OR length(p_evidence) NOT BETWEEN 11 AND 2000 THEN RAISE EXCEPTION 'Identity evidence is required'; END IF;
 IF p_ads_tasks IS NULL OR cardinality(p_ads_tasks) NOT BETWEEN 1 AND 20
  OR EXISTS(SELECT 1 FROM unnest(p_ads_tasks) t WHERE t IS NULL OR t !~ '^[a-zA-Z0-9]+$')
  OR (SELECT count(DISTINCT t) FROM unnest(p_ads_tasks) t)<>cardinality(p_ads_tasks) THEN RAISE EXCEPTION 'Invalid ads tasks'; END IF;
 SELECT * INTO b FROM public.cockpit_ad_billing_bindings WHERE id=p_binding FOR UPDATE;
 IF NOT FOUND OR b.revision<>p_revision OR NOT b.enabled THEN
  RETURN jsonb_build_object('ok',false,'reason','the binding changed during the check');
 END IF;
 IF (p_kind='move')<>(p_account<>b.account_id) THEN RAISE EXCEPTION 'Account change kind does not match'; END IF;
 IF b.client_task_id=ANY(p_ads_tasks) THEN RAISE EXCEPTION 'Invalid ads tasks'; END IF;
 SELECT client_name INTO other FROM public.cockpit_ad_billing_bindings WHERE account_id=p_account AND id<>b.id;
 IF FOUND THEN RETURN jsonb_build_object('ok',false,'reason','Meta account '||p_account||' already belongs to '||other); END IF;
 UPDATE public.cockpit_ad_billing_bindings SET account_id=p_account,sheet_account_ref=btrim(p_ref),ads_task_ids=p_ads_tasks,
  identity_evidence=p_evidence,identity_verified_at=now()
 WHERE id=b.id RETURNING * INTO n;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata)
 VALUES('billing.account_'||p_kind,'cockpit_ad_billing_bindings',b.id::text,'ad-billing-guard','media-buyer','supabase',
  jsonb_build_object('account_id',b.account_id,'sheet_account_ref',b.sheet_account_ref,'ads_task_ids',to_jsonb(b.ads_task_ids),
   'identity_evidence',b.identity_evidence,'revision',b.revision),
  jsonb_build_object('account_id',n.account_id,'sheet_account_ref',n.sheet_account_ref,'ads_task_ids',to_jsonb(n.ads_task_ids),
   'identity_evidence',n.identity_evidence,'revision',n.revision),
  jsonb_build_object('client',b.client_name,'client_task_id',b.client_task_id,'kind',p_kind));
 RETURN jsonb_build_object('ok',true,'binding',to_jsonb(n));
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ad_billing_move(uuid,uuid,integer,text,text,text,text[],text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ad_billing_move(uuid,uuid,integer,text,text,text,text[],text) TO service_role;
COMMIT;
