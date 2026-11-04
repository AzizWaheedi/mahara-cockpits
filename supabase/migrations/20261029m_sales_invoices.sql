-- Invoices from the sales cockpit (Aziz, 2026-10-29: "add the same invoices
-- section to the sales cockpit ... the same one that the CSM has for the
-- deposit ... If the ecom link doesn't work, they can generate a WHOP link
-- as well and make the invoice").
--
-- The request and change functions are the live ones as read on 2026-10-29
-- (request md5 97e810ab79cb83a3a039316829322602, change md5
-- 76b9399d76a1a5e44556ead43cc3c284) with these changes only:
-- - cockpit_invoice_request takes provider 'ecom' (default) or 'whop' for a
--   link the worker makes; the invoice desk on the VPS already makes both
--   (desk/whop.py, doctor 2026-10-29: "Whop key may create plans").
-- - cockpit_invoice_change takes 'whop': a failed Ecom invoice that never
--   got an Ecom link goes out again with a Whop link instead.
-- - Both record the asking cockpit in the audit (app 'sales'), which they
--   always called client-success.
-- cockpit_invoice_payments tells the list whether an Ecom invoice was paid,
-- for invoices the caller can see (cockpit_ecom_invoices is finance-only).

begin;

CREATE OR REPLACE FUNCTION public.cockpit_invoice_request(p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_uid uuid:=auth.uid();
 v_who text;
 v_ceo boolean;
 v_acc public.cockpit_billing_accounts;
 v_kind text;
 v_amount numeric;
 v_desc text;
 v_tax text;
 v_due date;
 v_url text;
 v_source text:='pasted';
 v_pay jsonb:='[]'::jsonb;
 v_sum numeric:=0;
 v_item jsonb;
 v_day date;
 v_value numeric;
 v_method text;
 v_today date:=(now() AT TIME ZONE 'Asia/Kuwait')::date;
 v_row public.cockpit_invoices;
 num constant text:='^[0-9]{1,6}(\.[0-9]{1,2})?$';
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in before making an invoice.' USING ERRCODE='42501'; END IF;
 IF NOT public.cockpit_invoice_seat() THEN
  RAISE EXCEPTION 'Invoices need a client success, finance, sales, admin or CEO seat. Ask an admin to add the role.' USING ERRCODE='42501';
 END IF;
 v_ceo:=coalesce(public.cockpit_is_ceo(),false);
 SELECT lower(btrim(au.email)) INTO v_who FROM auth.users au WHERE au.id=v_uid;
 IF p_args IS NULL OR jsonb_typeof(p_args)<>'object' THEN
  RAISE EXCEPTION 'The invoice details are missing. Fill in the form and try again.' USING ERRCODE='22023';
 END IF;

 SELECT * INTO v_acc FROM public.cockpit_billing_accounts WHERE clickup_task_id=nullif(btrim(coalesce(p_args->>'taskId','')),'');
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Pick a client from the list. That card is not on the billing sheet.' USING ERRCODE='P0002';
 END IF;
 IF NOT v_ceo AND NOT coalesce(public.cockpit_client_allowed(v_acc.client_name),false) THEN
  RAISE EXCEPTION '% is not one of your clients, so you cannot invoice it.',v_acc.client_name USING ERRCODE='42501';
 END IF;

 v_kind:=p_args->>'kind';
 IF v_kind IS NULL OR v_kind NOT IN('checkout','autocharge','paid') THEN
  RAISE EXCEPTION 'Choose the invoice type: pay online, card on file or paid.' USING ERRCODE='22023';
 END IF;
 IF coalesce(p_args->>'amount','')!~num THEN
  RAISE EXCEPTION 'Type the amount in US dollars, for example 1500 or 1500.50.' USING ERRCODE='22023';
 END IF;
 v_amount:=(p_args->>'amount')::numeric;
 IF v_amount<=0 THEN RAISE EXCEPTION 'The amount must be more than 0.' USING ERRCODE='22023'; END IF;
 v_desc:=public.cockpit_invoice_text(p_args,'description',120,'The description');
 IF v_desc IS NULL THEN
  RAISE EXCEPTION 'Type a description, for example "90-day agreement".' USING ERRCODE='22023';
 END IF;
 v_tax:=public.cockpit_invoice_text(p_args,'taxId',40,'The tax number');
 IF v_tax IS NOT NULL AND v_tax!~'^[A-Za-z0-9][A-Za-z0-9 ./-]*$' THEN
  RAISE EXCEPTION 'Type the tax number with letters, numbers, spaces, dots or dashes only.' USING ERRCODE='22023';
 END IF;

 IF nullif(p_args->>'dueDate','') IS NOT NULL THEN
  BEGIN v_due:=(p_args->>'dueDate')::date;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'Pick a valid due date.' USING ERRCODE='22023'; END;
 END IF;
 IF v_kind IN('checkout','autocharge') AND v_due IS NULL THEN
  RAISE EXCEPTION 'Pick the date the payment is due.' USING ERRCODE='22023';
 END IF;
 IF p_args ? 'createLink' AND jsonb_typeof(p_args->'createLink') IS DISTINCT FROM 'boolean' THEN
  RAISE EXCEPTION 'Choose whether to create the Ecom link or paste one.' USING ERRCODE='22023';
 END IF;
 -- The link the worker makes: Ecom (KNET and cards, in KWD) by default, or
 -- Whop (cards, in USD) when Ecom does not work for the client (2026-10-29).
 IF p_args ? 'provider' AND coalesce(p_args->>'provider','') NOT IN('ecom','whop') THEN
  RAISE EXCEPTION 'Choose Ecom or Whop for the payment link.' USING ERRCODE='22023';
 END IF;
 IF v_kind='checkout' AND coalesce((p_args->>'createLink')::boolean,false) THEN
  v_source:=CASE WHEN p_args->>'provider'='whop' THEN 'whop' ELSE 'ecom' END;
 ELSIF v_kind='checkout' THEN
  v_url:=btrim(coalesce(p_args->>'checkoutUrl',''));
  IF v_url!~'^https://[^\s<>"'']+$' OR char_length(v_url)>500 THEN
   RAISE EXCEPTION 'Paste the full payment link, starting with https://.' USING ERRCODE='22023';
  END IF;
 END IF;

 IF v_kind='paid' THEN
  IF jsonb_typeof(p_args->'payments') IS DISTINCT FROM 'array' OR jsonb_array_length(p_args->'payments') NOT BETWEEN 1 AND 12 THEN
   RAISE EXCEPTION 'Add each payment received, with its date, method and amount (up to 12).' USING ERRCODE='22023';
  END IF;
  FOR v_item IN SELECT x FROM jsonb_array_elements(p_args->'payments') AS t(x) LOOP
   BEGIN v_day:=(v_item->>'date')::date; EXCEPTION WHEN others THEN v_day:=NULL; END;
   IF v_day IS NULL OR v_day>v_today THEN
    RAISE EXCEPTION 'Each payment needs the day it arrived, today or before.' USING ERRCODE='22023';
   END IF;
   IF coalesce(v_item->>'amount','')!~num OR (v_item->>'amount')::numeric<=0 THEN
    RAISE EXCEPTION 'Each payment needs an amount in US dollars, more than 0.' USING ERRCODE='22023';
   END IF;
   v_method:=public.cockpit_invoice_text(v_item,'method',40,'A payment method');
   IF v_method IS NULL THEN
    RAISE EXCEPTION 'Each payment needs a method, for example "Bank transfer".' USING ERRCODE='22023';
   END IF;
   v_value:=(v_item->>'amount')::numeric;
   v_sum:=v_sum+v_value;
   v_pay:=v_pay||jsonb_build_array(jsonb_build_object('date',v_day,'method',v_method,'amount',v_value,
     'ref',public.cockpit_invoice_text(v_item,'ref',40,'A payment reference')));
  END LOOP;
  IF v_sum<>v_amount THEN
   RAISE EXCEPTION 'The payments add up to %, but the invoice total is %. Make them match.',
    to_char(v_sum,'FM999,999,990.00'),to_char(v_amount,'FM999,999,990.00') USING ERRCODE='22023';
  END IF;
 END IF;

 -- A double click, or the same form sent twice, makes one invoice.
 IF EXISTS(SELECT 1 FROM public.cockpit_invoices i
  WHERE i.clickup_task_id=v_acc.clickup_task_id AND i.kind=v_kind AND i.amount_usd=v_amount
    AND i.requested_by=v_who AND i.status IN('queued','rendering') AND i.requested_at>now()-interval '2 minutes') THEN
  RAISE EXCEPTION 'This invoice is already being made. Wait a minute for it to appear in the list.' USING ERRCODE='23505';
 END IF;

 INSERT INTO public.cockpit_invoices(clickup_task_id,client_name,kind,amount_usd,description,line_note,client_detail,client_tax_id,period,
   pay_note,issue_date,due_date,checkout_url,checkout_source,payments,requested_by)
 VALUES(v_acc.clickup_task_id,v_acc.client_name,v_kind,v_amount,v_desc,
   public.cockpit_invoice_text(p_args,'lineNote',200,'The line under the description'),
   public.cockpit_invoice_text(p_args,'clientDetail',120,'The client location'),
   v_tax,
   public.cockpit_invoice_text(p_args,'period',60,'The period'),
   public.cockpit_invoice_text(p_args,'payNote',400,'The note'),
   v_today,v_due,CASE WHEN v_kind='checkout' THEN v_url END,v_source,v_pay,v_who)
 RETURNING * INTO v_row;

 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata)
 VALUES('invoice.request','cockpit_invoices',v_row.id::text,v_who,
  CASE WHEN p_args->>'app'='sales' THEN 'sales' ELSE 'client-success' END,'supabase',NULL,to_jsonb(v_row),
  jsonb_build_object('clickup_task_id',v_acc.clickup_task_id));
 RETURN to_jsonb(v_row);
END $function$;

drop function if exists public.cockpit_invoice_change(uuid, text);
CREATE OR REPLACE FUNCTION public.cockpit_invoice_change(p_id uuid, p_action text, p_app text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_uid uuid:=auth.uid();
 v_who text;
 v_old public.cockpit_invoices;
 v_new public.cockpit_invoices;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN('cancel','retry','whop') THEN
  RAISE EXCEPTION 'Unknown invoice action.' USING ERRCODE='22023';
 END IF;
 SELECT lower(btrim(au.email)) INTO v_who FROM auth.users au WHERE au.id=v_uid;
 SELECT * INTO v_old FROM public.cockpit_invoices WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT public.cockpit_invoice_visible(v_old.client_name) THEN
  RAISE EXCEPTION 'That invoice is not in your list. Refresh the page.' USING ERRCODE='P0002';
 END IF;
 IF p_action='cancel' THEN
  IF v_old.status NOT IN('queued','failed') THEN
   RAISE EXCEPTION 'Only a waiting or failed invoice can be cancelled. This one is %.',v_old.status USING ERRCODE='22023';
  END IF;
  UPDATE public.cockpit_invoices SET status='cancelled',lease_until=NULL,updated_at=now() WHERE id=p_id RETURNING * INTO v_new;
 ELSIF p_action='whop' THEN
  -- Ecom did not make the link: the same invoice goes out with a Whop link.
  -- Only while no Ecom link was ever recorded on it, so a client never holds two.
  IF v_old.status<>'failed' OR v_old.kind<>'checkout' OR v_old.checkout_source<>'ecom' THEN
   RAISE EXCEPTION 'Only a failed pay-online invoice with an Ecom link can switch to Whop.' USING ERRCODE='22023';
  END IF;
  IF v_old.ecom_invoice_id IS NOT NULL OR v_old.checkout_url IS NOT NULL THEN
   RAISE EXCEPTION 'Ecom already made a link for this invoice, so it cannot switch. Cancel it and make a new invoice with Whop.' USING ERRCODE='22023';
  END IF;
  UPDATE public.cockpit_invoices SET checkout_source='whop',ecom_started_at=NULL,amount_kwd=NULL,kwd_rate=NULL,kwd_rate_at=NULL,
    status='queued',error=NULL,attempts=0,lease_until=NULL,updated_at=now() WHERE id=p_id RETURNING * INTO v_new;
 ELSE
  IF v_old.status<>'failed' THEN
   RAISE EXCEPTION 'Only a failed invoice can be tried again. This one is %.',v_old.status USING ERRCODE='22023';
  END IF;
  UPDATE public.cockpit_invoices SET status='queued',error=NULL,attempts=0,lease_until=NULL,updated_at=now() WHERE id=p_id RETURNING * INTO v_new;
 END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata)
 VALUES('invoice.'||p_action,'cockpit_invoices',p_id::text,v_who,
  CASE WHEN p_app='sales' THEN 'sales' ELSE 'client-success' END,'supabase',to_jsonb(v_old),to_jsonb(v_new),'{}'::jsonb);
 RETURN to_jsonb(v_new);
END $function$;
revoke all on function public.cockpit_invoice_change(uuid, text, text) from public, anon;
grant execute on function public.cockpit_invoice_change(uuid, text, text) to authenticated, service_role;

create or replace function public.cockpit_invoice_payments(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id,
           'status', e.status,
           'paid_at', e.paid_at,
           'method', e.payment_method)), '[]'::jsonb)
    from public.cockpit_invoices as i
    join lateral (
      select x.status, x.paid_at, x.payment_method
        from public.cockpit_ecom_invoices as x
       where x.cockpit_invoice_id = i.id
       order by x.synced_at desc nulls last
       limit 1) as e on true
   where i.id = any (p_ids)
     and public.cockpit_invoice_visible(i.client_name);
$$;
revoke all on function public.cockpit_invoice_payments(uuid[]) from public, anon;
grant execute on function public.cockpit_invoice_payments(uuid[]) to authenticated, service_role;

commit;
