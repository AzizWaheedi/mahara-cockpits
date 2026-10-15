-- Compact Slack approvals; unresolved incidents update the same card without repeat posts.
BEGIN;
CREATE OR REPLACE FUNCTION public.cockpit_ad_billing_refresh_cards(p_binding uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.cockpit_ad_billing_bindings; r public.cockpit_ad_billing_reviews; prior public.cockpit_ad_billing_deliveries;
 e uuid; channel_id text; copy text; ts text; posted timestamptz; delivery_state text; prior_episode integer; existing_ts text;
BEGIN
 SELECT * INTO b FROM public.cockpit_ad_billing_bindings WHERE id=p_binding FOR UPDATE;
 IF NOT b.enabled THEN RETURN; END IF;
 SELECT * INTO r FROM public.cockpit_ad_billing_reviews WHERE binding_id=b.id ORDER BY created_at DESC,id DESC LIMIT 1;
 SELECT id INTO e FROM public.cockpit_ad_billing_events WHERE binding_id=b.id AND sequence=b.sequence;
 IF e IS NULL THEN RETURN; END IF;
 SELECT state INTO delivery_state FROM public.cockpit_ad_billing_deliveries WHERE review_id=r.id AND channel='whatsapp';
 copy:='⚠️ '||b.client_name||E'\n'||CASE
 WHEN b.error IS NOT NULL THEN 'Billing check needs attention'
 WHEN b.signal='payment_grace' THEN 'Payment warning before a possible ad interruption'
 WHEN b.signal='unsettled' THEN 'Unsettled Meta balance'
 WHEN b.signal='restricted' THEN 'Meta account needs investigation'
 WHEN b.signal='healthy' THEN 'Payment warning cleared'
 ELSE 'Billing check needs attention' END
 ||E'\n'||CASE WHEN b.signal='healthy' THEN 'No client message queued'
 WHEN r.state='pending' THEN 'Needs approval · CSM or media buyer'
 WHEN r.state='approved' AND delivery_state='accepted' THEN 'WhatsApp accepted by provider'
 WHEN r.state='approved' THEN 'Approved · '||coalesce(delivery_state,'awaiting delivery')
 WHEN r.state='denied' THEN 'Denied · '||left(r.reason,120)
 ELSE 'Internal follow-up only' END;
 FOREACH channel_id IN ARRAY ARRAY['C09RZ0GS0V9','C0AF4SDLWNL'] LOOP
  -- Do not race an in-flight/ambiguous request or create a second copy after a lost receipt.
  IF EXISTS(SELECT 1 FROM public.cockpit_ad_billing_deliveries WHERE binding_id=b.id AND channel='slack' AND destination=channel_id AND state IN('sending','unknown','claimed')) THEN CONTINUE; END IF;
  SELECT * INTO prior FROM public.cockpit_ad_billing_deliveries WHERE binding_id=b.id AND channel='slack' AND destination=channel_id AND state IN('accepted','queued','retry','failed') ORDER BY created_at DESC,id DESC LIMIT 1;
  SELECT max(to_timestamp(split_part(provider_id,'.',1)::bigint)) INTO posted FROM public.cockpit_ad_billing_deliveries WHERE binding_id=b.id AND channel='slack' AND destination=channel_id AND slack_update_ts IS NULL AND state='accepted';
  -- Never blindly recreate a deleted/inaccessible Slack card. It remains a visible failed delivery.
  IF prior.id IS NOT NULL AND (prior.state='failed' OR (prior.body=copy AND prior.review_id IS NOT DISTINCT FROM r.id
    )) THEN CONTINUE; END IF;
  UPDATE public.cockpit_ad_billing_deliveries SET state='skipped',error='Replaced by current approval card',updated_at=now()
    WHERE binding_id=b.id AND channel='slack' AND destination=channel_id AND state IN('queued','retry');
  ts:=NULL;
  SELECT d.provider_id,ev.episode INTO existing_ts,prior_episode
   FROM public.cockpit_ad_billing_deliveries d JOIN public.cockpit_ad_billing_events ev ON ev.id=d.event_id
   WHERE d.binding_id=b.id AND d.channel='slack' AND d.destination=channel_id AND d.state='accepted'
   ORDER BY d.created_at DESC,d.id DESC LIMIT 1;
  -- One persistent card for an unresolved incident, even after 72 hours.
  -- A genuinely new incident can post only when the existing 72-hour gate allows it.
  IF existing_ts IS NOT NULL AND (posted>now()-interval '72 hours' OR prior_episode=b.episode OR coalesce(r.state,'')<>'pending') THEN
   ts:=existing_ts;
  END IF;
  -- Recovery only updates an existing card; it does not create a new notification.
  IF ts IS NULL AND b.signal='healthy' THEN CONTINUE; END IF;
  INSERT INTO public.cockpit_ad_billing_deliveries(event_id,binding_id,revision,channel,destination,body,review_id,slack_update_ts)
  VALUES(e,b.id,b.revision,'slack',channel_id,copy,r.id,ts);
 END LOOP;
END $$;
COMMIT;
