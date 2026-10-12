-- Include the current review state so closed Slack cards lose all decision buttons.
-- CREATE OR REPLACE preserves the existing service-role-only execution grant.
BEGIN;
CREATE OR REPLACE FUNCTION public.cockpit_ad_billing_claim(p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.cockpit_ad_billing_deliveries;
BEGIN
 UPDATE public.cockpit_ad_billing_deliveries SET state='unknown',error='Worker stopped after send intent. Reconcile before retry.',updated_at=now() WHERE state='sending' AND claimed_at<now()-interval '5 minutes';
 UPDATE public.cockpit_ad_billing_deliveries SET state='queued',claim=NULL,updated_at=now() WHERE state='claimed' AND claimed_at<now()-interval '5 minutes';
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_ad_billing_config WHERE singleton AND apply) THEN RETURN NULL; END IF;
 SELECT q.* INTO d FROM public.cockpit_ad_billing_deliveries q JOIN public.cockpit_ad_billing_bindings b ON b.id=q.binding_id
 WHERE q.state IN('queued','retry') AND q.next_attempt_at<=now() AND b.enabled AND b.manual_cutover_verified AND q.revision=b.revision AND b.error IS NULL
 AND b.last_good_at>now()-interval '10 minutes' AND (q.channel<>'whatsapp' OR public.cockpit_ad_billing_approved_delivery(q.id))
 ORDER BY q.created_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.cockpit_ad_billing_deliveries SET state='claimed',claim=p_claim,claimed_at=now(),updated_at=now() WHERE id=d.id;
 RETURN to_jsonb(d)||jsonb_build_object('claim',p_claim,
  'review_state',(SELECT state FROM public.cockpit_ad_billing_reviews WHERE id=d.review_id));
END $$;
COMMIT;
