-- This monitor runs in Supabase, independently of the VPS worker and guardian.
CREATE TABLE public.cockpit_ad_billing_watchdog (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 kind text NOT NULL DEFAULT 'healthy',
 event_id uuid,
 state text NOT NULL DEFAULT 'idle' CHECK(state IN('idle','sending','accepted','failed','unknown')),
 checked_at timestamptz,
 attempted_at timestamptz,
 provider_id text,
 error text
);
ALTER TABLE public.cockpit_ad_billing_watchdog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_ad_billing_watchdog FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.cockpit_ad_billing_watchdog TO service_role;
INSERT INTO public.cockpit_ad_billing_watchdog(singleton) VALUES(true);

CREATE FUNCTION public.cockpit_ad_billing_watchdog_claim() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.cockpit_ad_billing_config; w public.cockpit_ad_billing_watchdog; k text; eid uuid;
BEGIN
 SELECT * INTO w FROM public.cockpit_ad_billing_watchdog WHERE singleton FOR UPDATE;
 UPDATE public.cockpit_ad_billing_watchdog SET checked_at=now() WHERE singleton;
 SELECT * INTO c FROM public.cockpit_ad_billing_config WHERE singleton;
 IF c.apply IS NOT TRUE THEN RETURN NULL; END IF;
 k:=CASE WHEN c.last_finished_at IS NULL OR c.last_finished_at<now()-interval '15 minutes'
  OR c.last_finished_at>now()+interval '1 minute' THEN 'stale'
  WHEN c.last_error IS NOT NULL THEN 'source_error'
  WHEN EXISTS(SELECT 1 FROM public.cockpit_ad_billing_deliveries WHERE state IN('failed','unknown')
   OR (state IN('queued','retry','claimed','sending') AND created_at<now()-interval '15 minutes')) THEN 'delivery_error'
  ELSE 'healthy' END;
 IF k=w.kind THEN RETURN NULL; END IF;
 -- Claim before the HTTP request. A timeout is never blindly retried.
 eid:=gen_random_uuid();
 UPDATE public.cockpit_ad_billing_watchdog SET kind=k,event_id=eid,state='sending',attempted_at=now(),provider_id=NULL,error=NULL WHERE singleton;
 RETURN jsonb_build_object('id',eid,'kind',k);
END $$;
CREATE FUNCTION public.cockpit_ad_billing_watchdog_result(p_id uuid,p_state text,p_provider_id text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_state NOT IN('accepted','failed','unknown') THEN RAISE EXCEPTION 'Invalid watchdog result'; END IF;
 IF p_state='accepted' AND coalesce(length(p_provider_id),0)=0 THEN RAISE EXCEPTION 'Slack receipt required'; END IF;
 UPDATE public.cockpit_ad_billing_watchdog SET state=p_state,provider_id=p_provider_id,
  error=CASE WHEN p_state<>'accepted' THEN 'Watchdog delivery needs review. Do not resend an unknown result.' END
 WHERE singleton AND event_id=p_id AND state='sending';
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ad_billing_watchdog_claim(),public.cockpit_ad_billing_watchdog_result(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_ad_billing_watchdog_claim(),public.cockpit_ad_billing_watchdog_result(uuid,text,text) TO service_role;
