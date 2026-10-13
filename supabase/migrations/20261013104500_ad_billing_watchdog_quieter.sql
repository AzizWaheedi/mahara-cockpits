-- Watchdog alerts moved to #mahara-systems-health (edge function). Stale threshold 15 -> 30 minutes:
-- the five-minute worker hit transient Supabase 500/network errors, which produced stale/recovered pairs.
CREATE OR REPLACE FUNCTION public.cockpit_ad_billing_watchdog_claim() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.cockpit_ad_billing_config; w public.cockpit_ad_billing_watchdog; k text; eid uuid;
BEGIN
 SELECT * INTO w FROM public.cockpit_ad_billing_watchdog WHERE singleton FOR UPDATE;
 UPDATE public.cockpit_ad_billing_watchdog SET checked_at=now() WHERE singleton;
 SELECT * INTO c FROM public.cockpit_ad_billing_config WHERE singleton;
 IF c.apply IS NOT TRUE THEN RETURN NULL; END IF;
 k:=CASE WHEN c.last_finished_at IS NULL OR c.last_finished_at<now()-interval '30 minutes'
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
