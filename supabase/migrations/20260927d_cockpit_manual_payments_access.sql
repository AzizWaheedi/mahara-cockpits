-- The original ceoManualPayments log has no SQL counterpart in the live catalog.
-- History import and total reconciliation are explicit release gates, never assumed.
BEGIN;
CREATE TABLE IF NOT EXISTS public.cockpit_manual_payment_state(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 history_ready boolean NOT NULL DEFAULT false,
 revision bigint NOT NULL DEFAULT 0,
 totals_revision bigint NOT NULL DEFAULT 0 CHECK(totals_revision>=0 AND totals_revision<=revision),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.cockpit_manual_payment_state(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.cockpit_manual_payments(
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 day date NOT NULL,amount numeric(14,3) NOT NULL CHECK(amount>0 AND amount<=1000000),
 currency text NOT NULL CHECK(currency IN ('USD','KWD')),
 amount_usd numeric(16,2) NOT NULL,usd_per_unit numeric(12,6) NOT NULL CHECK(usd_per_unit>0),
 client_name text NOT NULL CHECK(length(btrim(client_name))>0),client_key text NOT NULL,
 clickup_task_id text,rail text NOT NULL CHECK(rail IN ('bank_transfer','cheque','cash','tap','other')),
 kind text NOT NULL DEFAULT 'payment' CHECK(kind IN ('payment','refund')),
 deal_contracted numeric(14,3),deal_contracted_usd numeric(16,2),
 note text,added_by text NOT NULL,added_at timestamptz NOT NULL DEFAULT now(),
 deleted_by text,deleted_at timestamptz,delete_reason text,
 request_id uuid UNIQUE,request_data jsonb,
 source_system text NOT NULL DEFAULT 'supabase',source_deployment text,source_id text,
 CHECK(currency<>'USD' OR amount=round(amount,2)),
 CHECK(deal_contracted IS NULL OR (deal_contracted>0 AND deal_contracted<=1000000 AND kind='payment')),
 CHECK(currency<>'USD' OR deal_contracted=round(deal_contracted,2)),
 CHECK((deleted_at IS NULL)=(deleted_by IS NULL))
);
CREATE INDEX IF NOT EXISTS cockpit_manual_payments_day ON public.cockpit_manual_payments(day,added_at);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_manual_payments_source ON public.cockpit_manual_payments(source_system,source_deployment,source_id)
 WHERE source_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.cockpit_manual_name_key(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT regexp_replace(lower(normalize(coalesce(p_name,''),NFKD)),'[^[:alnum:]]','','g');
$$;
CREATE OR REPLACE FUNCTION public.cockpit_manual_clean_text(p_text text,p_limit integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT nullif(btrim(left(regexp_replace(regexp_replace(coalesce(p_text,''),'[—–]',', ','g'),'[[:space:]]+',' ','g'),p_limit)),'');
$$;
CREATE OR REPLACE FUNCTION public.cockpit_manual_require_founder()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE email text;
BEGIN
 IF public.cockpit_is_ceo() IS NOT TRUE THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
 SELECT m.email INTO email FROM public.cockpit_members m WHERE m.auth_user_id=auth.uid();RETURN email;
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_manual_mask(p_text text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result text;part text[];
BEGIN
 IF p_text IS NULL THEN RETURN NULL;END IF;
 result:=regexp_replace(p_text,'[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+','[email]','g');
 FOR part IN SELECT regexp_matches(result,'[+]?[0-9][0-9[:space:]-]{6,}[0-9]','g') LOOP
 IF part[1]!~'^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$' AND length(regexp_replace(part[1],'[^0-9]','','g'))>=8 THEN
 result:=replace(result,part[1],'[number]');END IF;END LOOP;
 RETURN result;
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_manual_writer(p_email text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN p_email IS NULL OR p_email='' THEN 'unknown'
 WHEN lower(p_email) IN ('aziz@maharamedia.com','awaheedi2008@gmail.com') THEN 'Aziz'
 ELSE upper(left(split_part(p_email,'@',1),1))||substr(split_part(p_email,'@',1),2) END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_manual_public_row(p public.cockpit_manual_payments)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',p.id,'day',p.day,'amount',p.amount,'currency',p.currency,'amount_usd',p.amount_usd,
 'usd_per_unit',p.usd_per_unit,'client_name',public.cockpit_manual_mask(p.client_name),'clickup_task_id',p.clickup_task_id,
 'rail',p.rail,'kind',p.kind,'deal_contracted',p.deal_contracted,'deal_contracted_usd',p.deal_contracted_usd,
 'note',public.cockpit_manual_mask(p.note),'added_by',public.cockpit_manual_writer(p.added_by),'added_at',p.added_at,
 'deleted_by',CASE WHEN p.deleted_at IS NOT NULL THEN public.cockpit_manual_writer(p.deleted_by) END,'deleted_at',p.deleted_at);
$$;
CREATE OR REPLACE FUNCTION public.cockpit_manual_require_history()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT coalesce((SELECT history_ready FROM public.cockpit_manual_payment_state WHERE id),false) THEN
 RAISE EXCEPTION 'Import and reconcile the existing manual-payment history before using this log'; END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_manual_tap_status()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN s.ok AND s.computed_at>now()-interval '1 hour'
  AND jsonb_typeof(s.payload#>'{rails,tap,connected}')='boolean'
  THEN (s.payload#>>'{rails,tap,connected}')::boolean END FROM public.cockpit_sections s WHERE s.key='money';
$$;
CREATE OR REPLACE FUNCTION public.cockpit_manual_payment_protect()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['deleted_by','deleted_at','delete_reason'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['deleted_by','deleted_at','delete_reason']) THEN
 RAISE EXCEPTION 'Payment amounts, attribution and original exchange rates are immutable; remove and re-enter instead';END IF;
 RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_manual_payment_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text;action text;
BEGIN
 SELECT m.email INTO actor FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
 WHERE m.auth_user_id=auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email));
 action:=CASE WHEN TG_OP='INSERT' THEN 'manualPayment.add' WHEN NEW.deleted_at IS NULL THEN 'manualPayment.restore' ELSE 'manualPayment.remove' END;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after",metadata)
 VALUES(action,'cockpit_manual_payments',NEW.id,coalesce(actor,'import-worker'),'ceo','supabase',
 CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW),
 jsonb_build_object('what',CASE action WHEN 'manualPayment.add' THEN 'Logged ' WHEN 'manualPayment.restore' THEN 'Restored ' ELSE 'Removed ' END
 ||NEW.amount::text||' '||NEW.currency||' for '||NEW.client_name||' received '||NEW.day::text
 ||CASE WHEN NEW.deleted_at IS NOT NULL AND NEW.delete_reason IS NOT NULL THEN '. Reason: '||NEW.delete_reason ELSE '' END));
 UPDATE public.cockpit_manual_payment_state SET revision=revision+1,updated_at=clock_timestamp() WHERE id;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cockpit_manual_payment_protect ON public.cockpit_manual_payments;
CREATE TRIGGER cockpit_manual_payment_protect BEFORE UPDATE ON public.cockpit_manual_payments FOR EACH ROW EXECUTE FUNCTION public.cockpit_manual_payment_protect();
DROP TRIGGER IF EXISTS cockpit_manual_payment_audit ON public.cockpit_manual_payments;
CREATE TRIGGER cockpit_manual_payment_audit AFTER INSERT OR UPDATE ON public.cockpit_manual_payments FOR EACH ROW EXECUTE FUNCTION public.cockpit_manual_payment_audit();
CREATE OR REPLACE FUNCTION public.cockpit_ceo_manual_payment_info()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE st public.cockpit_manual_payment_state;
BEGIN
 PERFORM public.cockpit_manual_require_founder();SELECT * INTO st FROM public.cockpit_manual_payment_state WHERE id;
 RETURN jsonb_build_object('usdPerKwd',3.26,'tapLive',public.cockpit_manual_tap_status(),
 'today',(now() AT TIME ZONE 'Asia/Kuwait')::date::text,'historyReady',coalesce(st.history_ready,false),
 'totalsNeedRefresh',NOT coalesce(st.history_ready,false) OR st.revision<>st.totals_revision);
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_ceo_manual_payment_clients()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.cockpit_manual_require_founder();
 SELECT coalesce(jsonb_agg(jsonb_build_object('name',b.client_name,'clickupTaskId',b.clickup_task_id,'bucket',b.stage_group) ORDER BY b.client_name),'[]'::jsonb)
 INTO result FROM public.cockpit_billing_accounts b;RETURN result;
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_ceo_manual_payment_list(p_month text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m text:=coalesce(p_month,to_char(now() AT TIME ZONE 'Asia/Kuwait','YYYY-MM'));result jsonb;
BEGIN
 PERFORM public.cockpit_manual_require_founder();PERFORM public.cockpit_manual_require_history();
 IF m!~'^[0-9]{4}-(0[1-9]|1[0-2])$' OR left(m,4)='0000' THEN RAISE EXCEPTION 'Month must look like YYYY-MM';END IF;
 SELECT coalesce(jsonb_agg(public.cockpit_manual_public_row(p) ORDER BY p.day DESC,p.added_at DESC,p.id),'[]'::jsonb) INTO result
 FROM public.cockpit_manual_payments p WHERE p.day>=(m||'-01')::date AND p.day<((m||'-01')::date+interval '1 month');
 RETURN result;
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_ceo_manual_payment_add(p_input jsonb,p_request_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE actor text;d date;amount numeric;deal numeric;currency text;rail text;kind text;client text;task text;note text;
 rate numeric;key text;req jsonb;existing public.cockpit_manual_payments;id text;k text;tap boolean;
BEGIN
 actor:=public.cockpit_manual_require_founder();PERFORM public.cockpit_manual_require_history();
 IF p_request_id IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'A request identity and payment fields are required';END IF;
 FOR k IN SELECT jsonb_object_keys(p_input) LOOP
 IF k NOT IN ('day','amount','currency','rail','kind','clientName','clickupTaskId','note','dealContracted','allowRepeat') THEN RAISE EXCEPTION 'Unsupported payment field: %',k;END IF;END LOOP;
 IF (p_input->>'day' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') IS NOT TRUE THEN RAISE EXCEPTION 'Day received must use YYYY-MM-DD';END IF;
 d:=(p_input->>'day')::date;
 IF d<'2025-01-01' OR d>(now() AT TIME ZONE 'Asia/Kuwait')::date THEN RAISE EXCEPTION 'Day received is outside the permitted range';END IF;
 currency:=p_input->>'currency';rail:=p_input->>'rail';kind:=coalesce(p_input->>'kind','payment');
 IF currency IS NULL OR currency NOT IN ('USD','KWD') OR rail IS NULL OR rail NOT IN ('bank_transfer','cheque','cash','tap','other') OR kind NOT IN ('payment','refund') THEN RAISE EXCEPTION 'Invalid currency, payment method or kind';END IF;
 IF jsonb_typeof(p_input->'amount') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Amount must be numeric';END IF;
 amount:=(p_input->>'amount')::numeric;
 IF amount<=0 OR amount>1000000 OR abs(amount-round(amount,CASE currency WHEN 'USD' THEN 2 ELSE 3 END))*1000>0.000001 THEN RAISE EXCEPTION 'Amount must be positive, at most 1000000, with two USD or three KWD decimals';END IF;
 amount:=round(amount,3);
 IF p_input ? 'dealContracted' AND p_input->'dealContracted'<>'null'::jsonb THEN
 IF jsonb_typeof(p_input->'dealContracted')<>'number' THEN RAISE EXCEPTION 'Deal value must be numeric';END IF;
 deal:=(p_input->>'dealContracted')::numeric;
 IF deal<=0 OR deal>1000000 OR abs(deal-round(deal,CASE currency WHEN 'USD' THEN 2 ELSE 3 END))*1000>0.000001 OR kind='refund' THEN RAISE EXCEPTION 'Invalid deal value, precision or refund combination';END IF;
 deal:=round(deal,3);END IF;
 IF p_input ? 'allowRepeat' AND jsonb_typeof(p_input->'allowRepeat')<>'boolean' THEN RAISE EXCEPTION 'Repeat confirmation must be true or false';END IF;
 FOR k IN SELECT unnest(ARRAY['clientName','clickupTaskId','note']) LOOP
 IF p_input ? k AND jsonb_typeof(p_input->k) NOT IN ('string','null') THEN RAISE EXCEPTION 'Payment names and notes must be text';END IF;END LOOP;
 client:=public.cockpit_manual_clean_text(p_input->>'clientName',120);note:=public.cockpit_manual_clean_text(p_input->>'note',500);
 IF client IS NULL THEN RAISE EXCEPTION 'Type the client name';END IF;
 task:=nullif(btrim(p_input->>'clickupTaskId'),'');
 req:=jsonb_build_object('day',d,'amount',amount,'currency',currency,'rail',rail,'kind',kind,'client',client,'task',task,'deal',deal,'note',note);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 SELECT * INTO existing FROM public.cockpit_manual_payments WHERE request_id=p_request_id;
 IF FOUND THEN IF existing.request_data IS DISTINCT FROM req THEN RAISE EXCEPTION 'Request identity was reused with different payment details';END IF;RETURN existing.id;END IF;
 IF task IS NOT NULL AND (task!~'^[A-Za-z0-9_-]{1,40}$' OR NOT EXISTS(SELECT 1 FROM public.cockpit_billing_accounts WHERE clickup_task_id=task)) THEN RAISE EXCEPTION 'That client card is not on the billing roster; pick it again';END IF;
 IF rail='tap' THEN tap:=public.cockpit_manual_tap_status();
 IF tap IS TRUE THEN RAISE EXCEPTION 'Tap is connected; logging it manually would count it twice';
 ELSIF tap IS NULL THEN RAISE EXCEPTION 'Tap connection status is unavailable; refresh it before logging a Tap payment';END IF;END IF;
 key:=public.cockpit_manual_name_key(client);
 PERFORM pg_advisory_xact_lock(hashtextextended(d::text||currency||round(amount,3)::text,1));
 IF NOT coalesce((p_input->>'allowRepeat')::boolean,false) AND EXISTS(
 SELECT 1 FROM public.cockpit_manual_payments p WHERE p.deleted_at IS NULL AND p.day=d AND p.currency=currency
 AND p.amount=amount AND ((key<>'' AND p.client_key=key) OR (task IS NOT NULL AND p.clickup_task_id=task))) THEN
 RAISE EXCEPTION 'The same payment is already logged. Confirm only if this is a separate payment' USING DETAIL='{"code":"repeat"}';END IF;
 rate:=CASE currency WHEN 'USD' THEN 1 ELSE 3.26 END;
 INSERT INTO public.cockpit_manual_payments(day,amount,currency,amount_usd,usd_per_unit,client_name,client_key,clickup_task_id,
 rail,kind,deal_contracted,deal_contracted_usd,note,added_by,request_id,request_data)
 VALUES(d,amount,currency,round(amount*rate,2),rate,client,key,task,rail,kind,deal,round(deal*rate,2),note,actor,p_request_id,req) RETURNING cockpit_manual_payments.id INTO id;
 RETURN id;
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_ceo_manual_payment_status(p_id text,p_removed boolean,p_reason text DEFAULT NULL,p_allow_repeat boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text;r public.cockpit_manual_payments;tap boolean;
BEGIN
 actor:=public.cockpit_manual_require_founder();PERFORM public.cockpit_manual_require_history();
 IF p_removed IS NULL OR p_allow_repeat IS NULL THEN RAISE EXCEPTION 'Invalid removal or repeat flag';END IF;
 SELECT * INTO r FROM public.cockpit_manual_payments WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'That payment is not in the log';END IF;
 IF (r.deleted_at IS NOT NULL)=p_removed THEN RETURN jsonb_build_object('ok',true,'changed',false);END IF;
 IF NOT p_removed THEN
   IF r.rail='tap' THEN tap:=public.cockpit_manual_tap_status();
   IF tap IS DISTINCT FROM false THEN RAISE EXCEPTION 'Tap is connected or its state is unavailable; this entry cannot be restored yet';END IF;END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended(r.day::text||r.currency||round(r.amount,3)::text,1));
   IF NOT p_allow_repeat AND EXISTS(SELECT 1 FROM public.cockpit_manual_payments p WHERE p.id<>r.id AND p.deleted_at IS NULL AND p.day=r.day AND p.currency=r.currency
    AND p.amount=r.amount AND ((r.client_key<>'' AND p.client_key=r.client_key) OR (r.clickup_task_id IS NOT NULL AND p.clickup_task_id=r.clickup_task_id))) THEN
   RAISE EXCEPTION 'Restoring this entry would count the same payment twice; confirm only if separate' USING DETAIL='{"code":"repeat"}';END IF;
 END IF;
 UPDATE public.cockpit_manual_payments SET deleted_at=CASE WHEN p_removed THEN clock_timestamp() END,
 deleted_by=CASE WHEN p_removed THEN actor END,delete_reason=CASE WHEN p_removed THEN public.cockpit_manual_clean_text(p_reason,300) END WHERE id=p_id;
 RETURN jsonb_build_object('ok',true,'changed',true);
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_ceo_manual_payment_history(p_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.cockpit_manual_require_founder();PERFORM public.cockpit_manual_require_history();
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_manual_payments WHERE id=p_id) THEN RAISE EXCEPTION 'That payment is not in the log';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC),'[]'::jsonb) INTO result FROM (
 SELECT action,entity_type,entity_id,public.cockpit_manual_writer(actor_email) AS actor_email,created_at,
 jsonb_build_object('what',public.cockpit_manual_mask(metadata->>'what')) AS metadata
 FROM public.cockpit_audit_log WHERE entity_type='cockpit_manual_payments' AND entity_id=p_id ORDER BY created_at DESC LIMIT 20) q;
 RETURN result;
END;
$$;
ALTER TABLE public.cockpit_manual_payments ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.cockpit_manual_state_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.revision<OLD.revision THEN RAISE EXCEPTION 'Payment revision cannot move backwards';END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
 VALUES('manualPayment.readiness','cockpit_manual_payment_state','true',
 coalesce((SELECT m.email FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
 WHERE m.auth_user_id=auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email))),'migration-worker'),
 'ceo','supabase',to_jsonb(OLD),to_jsonb(NEW));RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cockpit_manual_state_audit ON public.cockpit_manual_payment_state;
CREATE TRIGGER cockpit_manual_state_audit AFTER UPDATE ON public.cockpit_manual_payment_state FOR EACH ROW EXECUTE FUNCTION public.cockpit_manual_state_audit();
ALTER TABLE public.cockpit_manual_payment_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_manual_payments,public.cockpit_manual_payment_state FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_manual_payments,public.cockpit_manual_payment_state TO service_role;
REVOKE ALL ON FUNCTION public.cockpit_manual_name_key(text),public.cockpit_manual_clean_text(text,integer),
 public.cockpit_manual_mask(text),public.cockpit_manual_writer(text),public.cockpit_manual_public_row(public.cockpit_manual_payments),
 public.cockpit_manual_require_founder(),public.cockpit_manual_require_history(),public.cockpit_manual_tap_status(),
 public.cockpit_manual_payment_protect(),public.cockpit_manual_payment_audit(),public.cockpit_manual_state_audit() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_ceo_manual_payment_info(),public.cockpit_ceo_manual_payment_clients(),
 public.cockpit_ceo_manual_payment_list(text),public.cockpit_ceo_manual_payment_add(jsonb,uuid),
 public.cockpit_ceo_manual_payment_status(text,boolean,text,boolean),public.cockpit_ceo_manual_payment_history(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_manual_payment_info(),public.cockpit_ceo_manual_payment_clients(),
 public.cockpit_ceo_manual_payment_list(text),public.cockpit_ceo_manual_payment_add(jsonb,uuid),
 public.cockpit_ceo_manual_payment_status(text,boolean,text,boolean),public.cockpit_ceo_manual_payment_history(text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
