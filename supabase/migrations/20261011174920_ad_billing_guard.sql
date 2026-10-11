-- Ad-account billing only. No agency invoices, campaign controls, or payment attempts.
BEGIN;
CREATE TABLE public.cockpit_ad_billing_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 apply boolean NOT NULL DEFAULT false,
 lease uuid, lease_until timestamptz,
 last_started_at timestamptz, last_finished_at timestamptz, last_error text,
 slack_channel text NOT NULL DEFAULT 'C0AF4SDLWNL' CHECK(slack_channel='C0AF4SDLWNL')
);
INSERT INTO public.cockpit_ad_billing_config(singleton) VALUES(true);
CREATE TABLE public.cockpit_ad_billing_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_task_id text NOT NULL CHECK(client_task_id ~ '^[a-zA-Z0-9]+$'),
 client_name text NOT NULL CHECK(length(client_name) BETWEEN 1 AND 150),
 account_id text NOT NULL UNIQUE CHECK(account_id ~ '^[0-9]{5,25}$'),
 ads_task_ids text[] NOT NULL CHECK(cardinality(ads_task_ids)>0),
 whatsapp_group text NOT NULL CHECK(whatsapp_group ~ '^[0-9]+(-[0-9]+)?@g\.us$'),
 sheet_account_ref text NOT NULL CHECK(length(sheet_account_ref)>0),
 identity_evidence text NOT NULL CHECK(length(identity_evidence)>10),
 identity_verified_at timestamptz NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 manual_cutover_verified boolean NOT NULL DEFAULT false,
 manual_cutover_evidence text,
 revision integer NOT NULL DEFAULT 1,
 signal text NOT NULL DEFAULT 'unknown' CHECK(signal IN('unknown','healthy','payment_grace','unsettled','restricted')),
 last_checked_at timestamptz, last_good_at timestamptz, error text,
 last_four text CHECK(last_four IS NULL OR last_four ~ '^[0-9]{4}$'),
 healthy_since timestamptz, episode integer NOT NULL DEFAULT 0, sequence integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT manual_cutover_verified OR coalesce(length(manual_cutover_evidence),0)>10)
);
CREATE TABLE public.cockpit_ad_billing_roster (
 client_task_id text PRIMARY KEY, client_name text NOT NULL, checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.cockpit_ad_billing_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), binding_id uuid NOT NULL REFERENCES public.cockpit_ad_billing_bindings(id),
 sequence integer NOT NULL, episode integer NOT NULL, signal text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(binding_id,sequence)
);
CREATE TABLE public.cockpit_ad_billing_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES public.cockpit_ad_billing_events(id),
 binding_id uuid NOT NULL REFERENCES public.cockpit_ad_billing_bindings(id), revision integer NOT NULL,
 channel text NOT NULL CHECK(channel IN('whatsapp','slack','clickup')),
 destination text NOT NULL, body text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','retry','claimed','sending','accepted','failed','unknown','skipped')),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 claim uuid, claimed_at timestamptz, attempts integer NOT NULL DEFAULT 0,
 provider_id text, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,channel,destination),
 CHECK(state <> 'accepted' OR length(provider_id)>0)
);
CREATE INDEX cockpit_ad_billing_pending ON public.cockpit_ad_billing_deliveries(created_at) WHERE state IN('queued','retry','claimed','sending','unknown');
CREATE INDEX cockpit_ad_billing_events_binding ON public.cockpit_ad_billing_events(binding_id,created_at DESC);
CREATE INDEX cockpit_ad_billing_deliveries_binding ON public.cockpit_ad_billing_deliveries(binding_id,state);

ALTER TABLE public.cockpit_ad_billing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_ad_billing_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_ad_billing_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_ad_billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_ad_billing_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_ad_billing_config,public.cockpit_ad_billing_bindings,public.cockpit_ad_billing_events,public.cockpit_ad_billing_deliveries FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.cockpit_ad_billing_roster FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.cockpit_ad_billing_roster TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_ad_billing_config,public.cockpit_ad_billing_bindings TO service_role;
GRANT SELECT ON public.cockpit_ad_billing_events,public.cockpit_ad_billing_deliveries TO service_role;

CREATE FUNCTION public.cockpit_ad_billing_binding_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['signal','last_checked_at','last_good_at','last_four','error','healthy_since','episode','sequence','updated_at','revision']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['signal','last_checked_at','last_good_at','last_four','error','healthy_since','episode','sequence','updated_at','revision']) THEN
  NEW.revision:=OLD.revision+1;
  NEW.error:='Binding changed. A fresh source check is required.'; NEW.last_good_at:=NULL;
  NEW.signal:='unknown'; NEW.healthy_since:=NULL;
  -- Previously accepted messages remain immutable; unsent messages must not follow a new destination.
  UPDATE public.cockpit_ad_billing_deliveries SET state='skipped',error='Binding changed',updated_at=now()
   WHERE binding_id=OLD.id AND state IN('queued','retry','claimed');
 END IF;
 NEW.updated_at:=now();
 RETURN NEW;
END $$;
CREATE TRIGGER ad_billing_binding_change BEFORE UPDATE ON public.cockpit_ad_billing_bindings FOR EACH ROW EXECUTE FUNCTION public.cockpit_ad_billing_binding_change();

CREATE FUNCTION public.cockpit_ad_billing_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata)
 VALUES('billing.'||lower(TG_OP),TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'id','config'),'ad-billing-guard','media-buyer','supabase',
  jsonb_build_object('state',to_jsonb(NEW)->>'state','apply',to_jsonb(NEW)->>'apply','revision',to_jsonb(NEW)->>'revision'));
 RETURN NEW;
END $$;
CREATE TRIGGER ad_billing_config_audit AFTER INSERT OR UPDATE OF apply ON public.cockpit_ad_billing_config FOR EACH ROW EXECUTE FUNCTION public.cockpit_ad_billing_audit();
CREATE TRIGGER ad_billing_binding_audit_insert AFTER INSERT ON public.cockpit_ad_billing_bindings FOR EACH ROW EXECUTE FUNCTION public.cockpit_ad_billing_audit();
CREATE TRIGGER ad_billing_binding_audit_update AFTER UPDATE ON public.cockpit_ad_billing_bindings FOR EACH ROW WHEN(OLD.revision IS DISTINCT FROM NEW.revision) EXECUTE FUNCTION public.cockpit_ad_billing_audit();
CREATE TRIGGER ad_billing_delivery_audit AFTER INSERT OR UPDATE OF state ON public.cockpit_ad_billing_deliveries FOR EACH ROW EXECUTE FUNCTION public.cockpit_ad_billing_audit();

CREATE FUNCTION public.cockpit_ad_billing_start(p_lease uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.cockpit_ad_billing_config SET lease=p_lease,lease_until=now()+interval '10 minutes',last_started_at=now()
 WHERE singleton AND (lease_until IS NULL OR lease_until<now());
 RETURN FOUND;
END $$;
CREATE FUNCTION public.cockpit_ad_billing_finish(p_lease uuid,p_error text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.cockpit_ad_billing_config SET lease=NULL,lease_until=NULL,last_finished_at=now(),last_error=left(p_error,400) WHERE singleton AND lease=p_lease;
END $$;
CREATE FUNCTION public.cockpit_ad_billing_roster_refresh(p_lease uuid,p_rows jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.cockpit_ad_billing_config WHERE lease=p_lease AND lease_until>now() FOR SHARE;
 IF NOT FOUND OR jsonb_typeof(p_rows)<>'array' THEN RAISE EXCEPTION 'Valid roster and monitor lease required'; END IF;
 DELETE FROM public.cockpit_ad_billing_roster;
 INSERT INTO public.cockpit_ad_billing_roster(client_task_id,client_name)
 SELECT x.id,x.name FROM jsonb_to_recordset(p_rows) x(id text,name text);
END $$;

CREATE FUNCTION public.cockpit_ad_billing_observe(p_lease uuid,p_binding uuid,p_revision integer,p_signal text,p_last_four text,p_error text,p_client_body text,p_internal_body text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.cockpit_ad_billing_bindings; e uuid; kind text; target text; v_episode integer;
BEGIN
 PERFORM 1 FROM public.cockpit_ad_billing_config WHERE lease=p_lease AND lease_until>now() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Monitor lease expired'; END IF;
 SELECT * INTO b FROM public.cockpit_ad_billing_bindings WHERE id=p_binding FOR UPDATE;
 IF NOT FOUND OR b.revision<>p_revision OR NOT b.enabled THEN RAISE EXCEPTION 'Binding changed or disabled'; END IF;
 IF p_signal NOT IN('unknown','healthy','payment_grace','unsettled','restricted') OR p_signal IS NULL THEN RAISE EXCEPTION 'Invalid billing signal'; END IF;
 IF p_last_four IS NOT NULL AND p_last_four !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Invalid card suffix'; END IF;
 UPDATE public.cockpit_ad_billing_bindings SET last_checked_at=now(),error=left(p_error,400),last_four=p_last_four,
  last_good_at=CASE WHEN p_error IS NULL AND p_signal<>'unknown' THEN now() ELSE last_good_at END,
  healthy_since=CASE WHEN p_error IS NOT NULL OR p_signal<>'healthy' THEN NULL ELSE healthy_since END
 WHERE id=b.id;
 -- Source failures never clear an incident or count as a healthy observation.
 IF p_error IS NOT NULL OR p_signal='unknown' THEN
  UPDATE public.cockpit_ad_billing_bindings SET error=coalesce(left(p_error,400),'Meta billing state is unavailable') WHERE id=b.id; RETURN;
 END IF;
 IF p_signal=b.signal THEN RETURN; END IF;
 kind:=p_signal; v_episode:=b.episode;
 IF p_signal='healthy' AND b.signal IN('payment_grace','unsettled','restricted') THEN
  IF b.healthy_since IS NULL THEN
   UPDATE public.cockpit_ad_billing_bindings SET healthy_since=now() WHERE id=b.id; RETURN;
  ELSIF b.healthy_since>now()-interval '4 minutes' THEN RETURN; END IF;
  kind:='recovered';
 ELSIF p_signal IN('payment_grace','unsettled','restricted') AND b.signal IN('unknown','healthy') THEN v_episode:=v_episode+1;
 END IF;
 UPDATE public.cockpit_ad_billing_bindings SET signal=p_signal,last_four=p_last_four,sequence=sequence+1,episode=v_episode,healthy_since=NULL WHERE id=b.id;
 IF p_signal='healthy' AND kind<>'recovered' THEN RETURN; END IF;
 IF p_internal_body IS NULL OR length(p_internal_body)>4000 OR length(p_internal_body)<10 THEN RAISE EXCEPTION 'Notification text is missing or too long'; END IF;
 INSERT INTO public.cockpit_ad_billing_events(binding_id,sequence,episode,signal) VALUES(b.id,b.sequence+1,v_episode,kind) RETURNING id INTO e;
 UPDATE public.cockpit_ad_billing_deliveries SET state='skipped',error='Superseded by a newer observation',updated_at=now()
 WHERE binding_id=b.id AND state IN('queued','retry','claimed');
 INSERT INTO public.cockpit_ad_billing_deliveries(event_id,binding_id,revision,channel,destination,body)
 VALUES(e,b.id,b.revision,'slack','C0AF4SDLWNL',b.client_name||E'\nMeta account: '||b.account_id||E'\n'||p_internal_body||E'\nClient task: https://app.clickup.com/t/'||b.client_task_id);
 FOREACH target IN ARRAY (ARRAY[b.client_task_id]||b.ads_task_ids) LOOP
  INSERT INTO public.cockpit_ad_billing_deliveries(event_id,binding_id,revision,channel,destination,body)
  VALUES(e,b.id,b.revision,'clickup',target,p_internal_body||E'\nMeta account: '||b.account_id||E'\nNotification delivery is tracked separately in the Media Buyer billing panel.') ON CONFLICT DO NOTHING;
 END LOOP;
 IF p_client_body IS NOT NULL AND length(p_client_body) BETWEEN 10 AND 3000 AND NOT EXISTS(
  SELECT 1 FROM public.cockpit_ad_billing_deliveries prior JOIN public.cockpit_ad_billing_events previous ON previous.id=prior.event_id
  WHERE prior.binding_id=b.id AND prior.channel='whatsapp' AND prior.state IN('accepted','sending','unknown') AND previous.episode=v_episode
   AND (previous.signal=kind OR (kind='payment_grace' AND previous.signal='unsettled'))
 ) AND
  (kind IN('payment_grace','unsettled') OR (kind='recovered' AND EXISTS(
   SELECT 1 FROM public.cockpit_ad_billing_deliveries d JOIN public.cockpit_ad_billing_events x ON x.id=d.event_id
   WHERE d.binding_id=b.id AND d.channel='whatsapp' AND d.state='accepted' AND x.episode=v_episode))) THEN
  INSERT INTO public.cockpit_ad_billing_deliveries(event_id,binding_id,revision,channel,destination,body) VALUES(e,b.id,b.revision,'whatsapp',b.whatsapp_group,p_client_body);
 END IF;
END $$;

CREATE FUNCTION public.cockpit_ad_billing_claim(p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.cockpit_ad_billing_deliveries;
BEGIN
 -- A request may already have reached its provider. Never automatically replay it.
 UPDATE public.cockpit_ad_billing_deliveries SET state='unknown',error='Worker stopped after send intent. Reconcile before retry.',updated_at=now() WHERE state='sending' AND claimed_at<now()-interval '5 minutes';
 UPDATE public.cockpit_ad_billing_deliveries SET state='queued',claim=NULL,updated_at=now() WHERE state='claimed' AND claimed_at<now()-interval '5 minutes';
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_ad_billing_config WHERE singleton AND apply) THEN RETURN NULL; END IF;
 SELECT q.* INTO d FROM public.cockpit_ad_billing_deliveries q JOIN public.cockpit_ad_billing_bindings b ON b.id=q.binding_id
 WHERE q.state IN('queued','retry') AND q.next_attempt_at<=now() AND b.enabled AND b.manual_cutover_verified AND q.revision=b.revision AND b.error IS NULL
  AND b.last_good_at>now()-interval '10 minutes'
 ORDER BY q.created_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.cockpit_ad_billing_deliveries SET state='claimed',claim=p_claim,claimed_at=now(),updated_at=now() WHERE id=d.id;
 RETURN to_jsonb(d)||jsonb_build_object('claim',p_claim);
END $$;
CREATE FUNCTION public.cockpit_ad_billing_begin_send(p_id uuid,p_claim uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.cockpit_ad_billing_config WHERE singleton AND apply FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.cockpit_ad_billing_bindings b JOIN public.cockpit_ad_billing_deliveries d ON d.binding_id=b.id
 WHERE d.id=p_id AND b.enabled AND b.manual_cutover_verified AND b.revision=d.revision AND b.error IS NULL AND b.last_good_at>now()-interval '10 minutes' FOR SHARE OF b;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.cockpit_ad_billing_deliveries SET state='sending',attempts=attempts+1,claimed_at=now(),updated_at=now()
 WHERE id=p_id AND claim=p_claim AND state='claimed' AND claimed_at>now()-interval '5 minutes';
 RETURN FOUND;
END $$;
CREATE FUNCTION public.cockpit_ad_billing_result(p_id uuid,p_claim uuid,p_state text,p_provider_id text DEFAULT NULL,p_error text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_state NOT IN('accepted','failed','unknown','skipped','retry') THEN RAISE EXCEPTION 'Invalid delivery outcome'; END IF;
 IF p_state='accepted' AND coalesce(length(p_provider_id),0)=0 THEN RAISE EXCEPTION 'Provider receipt is required'; END IF;
 UPDATE public.cockpit_ad_billing_deliveries SET state=CASE WHEN p_state='retry' AND attempts>=5 THEN 'failed' ELSE p_state END,
  next_attempt_at=CASE WHEN p_state='retry' THEN now()+interval '1 minute'*power(2,least(attempts,5)) ELSE next_attempt_at END,
  provider_id=p_provider_id,error=left(p_error,400),updated_at=now()
 WHERE id=p_id AND claim=p_claim AND state IN('claimed','sending','unknown','failed') AND (p_state<>'accepted' OR state IN('sending','unknown'));
 RETURN FOUND;
END $$;

CREATE FUNCTION public.cockpit_ad_billing_panel() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members; founder boolean; rows jsonb; roster jsonb; cfg public.cockpit_ad_billing_config;
BEGIN
 SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users u ON u.id=cm.auth_user_id
 WHERE cm.auth_user_id=auth.uid() AND cm.active AND u.email_confirmed_at IS NOT NULL AND cm.email=lower(btrim(u.email));
 founder:=m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com');
 IF m.auth_user_id IS NULL OR NOT(founder OR m.roles&&ARRAY['admin','media_buyer']) THEN RAISE EXCEPTION 'Current media buyer access is required' USING ERRCODE='42501'; END IF;
 SELECT * INTO cfg FROM public.cockpit_ad_billing_config WHERE singleton;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'client',b.client_name,'clientTaskId',b.client_task_id,'accountId',b.account_id,
  'enabled',b.enabled,'ready',b.manual_cutover_verified,'signal',b.signal,'checkedAt',b.last_checked_at,'lastGoodAt',b.last_good_at,'error',b.error,
  'deliveries',(SELECT coalesce(jsonb_agg(jsonb_build_object('channel',q.channel,'state',q.state,'at',q.updated_at,'error',q.error,'providerId',q.provider_id,
   'taskId',CASE WHEN q.channel='clickup' THEN q.destination END,'commentRole',CASE WHEN q.channel='clickup' THEN CASE WHEN q.destination=b.client_task_id THEN 'client' ELSE 'ads' END END)),'[]')
   FROM public.cockpit_ad_billing_deliveries q JOIN public.cockpit_ad_billing_events e ON e.id=q.event_id WHERE q.binding_id=b.id AND e.sequence=b.sequence)) ORDER BY b.client_name),'[]') INTO rows
 FROM public.cockpit_ad_billing_bindings b
 WHERE founder OR 'admin'=ANY(m.roles) OR cardinality(m.clients)=0 OR EXISTS(SELECT 1 FROM unnest(m.clients) c WHERE lower(btrim(c))=lower(btrim(b.client_name)));
 SELECT coalesce(jsonb_agg(jsonb_build_object('client',r.client_name,'clientTaskId',r.client_task_id,'checkedAt',r.checked_at,
  'enrolled',EXISTS(SELECT 1 FROM public.cockpit_ad_billing_bindings b WHERE b.client_task_id=r.client_task_id AND b.enabled))),'[]') INTO roster
 FROM public.cockpit_ad_billing_roster r WHERE founder OR 'admin'=ANY(m.roles) OR cardinality(m.clients)=0 OR EXISTS(SELECT 1 FROM unnest(m.clients) c WHERE lower(btrim(c))=lower(btrim(r.client_name)));
 RETURN jsonb_build_object('apply',cfg.apply,'startedAt',cfg.last_started_at,'finishedAt',cfg.last_finished_at,'error',cfg.last_error,'bindings',rows,'roster',roster);
END $$;

-- Supabase defaults can grant new functions to every role. Close all worker RPCs.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'cockpit_ad_billing_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.sig);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.cockpit_ad_billing_panel() TO authenticated;
COMMIT;
