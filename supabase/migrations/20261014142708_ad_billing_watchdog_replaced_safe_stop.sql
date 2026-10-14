-- A replaced safe stop is not a delivery problem (14 Oct 2026, same rule as the cockpit guardian's checks/ad_billing.py).
-- Before every send the worker re-reads Meta. If the status moved on, it sends nothing and records the delivery as
-- 'failed' with 0 attempts and no receipt. When a newer event exists for that client binding, the next poll has
-- already handled the change, so the row needs no person. Counting it kept the watchdog on 'delivery_error' from
-- 12:07 Kuwait and made each one-run source blip post a second, false "delivery" line (14:12 and 14:17).
-- A stop nothing replaced, a send a provider refused (attempts or a receipt) and every 'unknown' result still alert.
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
  WHEN EXISTS(SELECT 1 FROM public.cockpit_ad_billing_deliveries d WHERE d.state='unknown'
   OR (d.state='failed' AND NOT (coalesce(d.attempts,0)=0 AND d.provider_id IS NULL AND d.binding_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.cockpit_ad_billing_events e WHERE e.binding_id=d.binding_id AND e.created_at>d.created_at)))
   OR (d.state IN('queued','retry','claimed','sending') AND d.created_at<now()-interval '15 minutes')) THEN 'delivery_error'
  ELSE 'healthy' END;
 IF k=w.kind THEN RETURN NULL; END IF;
 -- Claim before the HTTP request. A timeout is never blindly retried.
 eid:=gen_random_uuid();
 UPDATE public.cockpit_ad_billing_watchdog SET kind=k,event_id=eid,state='sending',attempted_at=now(),provider_id=NULL,error=NULL WHERE singleton;
 RETURN jsonb_build_object('id',eid,'kind',k);
END $$;
