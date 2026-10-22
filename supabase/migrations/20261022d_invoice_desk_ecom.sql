BEGIN;
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
 IF v_kind='checkout' AND coalesce((p_args->>'createLink')::boolean,false) THEN
  v_source:='ecom';
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
 VALUES('invoice.request','cockpit_invoices',v_row.id::text,v_who,'client-success','supabase',NULL,to_jsonb(v_row),
  jsonb_build_object('clickup_task_id',v_acc.clickup_task_id));
 RETURN to_jsonb(v_row);
END $function$
;
CREATE OR REPLACE FUNCTION public.cockpit_invoice_progress(p_id uuid, p_patch jsonb)
 RETURNS cockpit_invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.cockpit_invoices;
BEGIN
 SELECT * INTO v FROM public.cockpit_invoices WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR v.status<>'rendering' THEN RAISE EXCEPTION 'Invoice % is not being rendered.',p_id USING ERRCODE='P0002'; END IF;
 IF (p_patch ? 'whopStarted' OR p_patch ? 'whopPlanId') AND v.checkout_source<>'whop' THEN
  RAISE EXCEPTION 'Invoice % does not take a Whop link.',p_id USING ERRCODE='22023';
 END IF;
 IF (p_patch ? 'ecomStarted' OR p_patch ? 'ecomInvoiceId') AND v.checkout_source<>'ecom' THEN
  RAISE EXCEPTION 'Invoice % does not take an Ecom link.',p_id USING ERRCODE='22023';
 END IF;
 IF p_patch ? 'ecomInvoiceId' THEN
  IF coalesce(p_patch->>'ecomInvoiceId','')!~'^INV_[A-Za-z0-9]+$'
   OR coalesce(p_patch->>'checkoutUrl','')!~'^https://invoice\.ecom\.io/[^[:space:]<>"'']+$'
   OR coalesce(p_patch->>'amountKwd','')!~'^[0-9]+\.[0-9]{3}$'
   OR (p_patch->>'amountKwd')::numeric<=0
   OR coalesce(p_patch->>'kwdRate','')!~'^[0-9]+\.[0-9]{1,6}$'
   OR (p_patch->>'kwdRate')::numeric<=0
   OR coalesce(p_patch->>'kwdRateAt','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' THEN
   RAISE EXCEPTION 'The Ecom id, checkout URL, KWD amount or exchange rate is invalid.' USING ERRCODE='22023';
  END IF;
  IF v.ecom_invoice_id IS NOT NULL AND (v.ecom_invoice_id<>p_patch->>'ecomInvoiceId'
    OR v.checkout_url<>p_patch->>'checkoutUrl' OR v.amount_kwd<>(p_patch->>'amountKwd')::numeric
    OR v.kwd_rate<>(p_patch->>'kwdRate')::numeric OR v.kwd_rate_at<>(p_patch->>'kwdRateAt')::timestamptz) THEN
   RAISE EXCEPTION 'Invoice % already has Ecom invoice %.',p_id,v.ecom_invoice_id USING ERRCODE='23505';
  END IF;
 END IF;
 IF p_patch ? 'whopPlanId' THEN
  IF coalesce(p_patch->>'whopPlanId','')!~'^plan_[A-Za-z0-9]{6,40}$'
   OR p_patch->>'checkoutUrl' IS DISTINCT FROM 'https://whop.com/checkout/'||(p_patch->>'whopPlanId') THEN
   RAISE EXCEPTION 'The Whop plan id and its checkout link do not match.' USING ERRCODE='22023';
  END IF;
  IF v.whop_plan_id IS NOT NULL AND v.whop_plan_id<>p_patch->>'whopPlanId' THEN
   RAISE EXCEPTION 'Invoice % already has Whop plan %.',p_id,v.whop_plan_id USING ERRCODE='23505';
  END IF;
 END IF;
 UPDATE public.cockpit_invoices SET
  invoice_no=coalesce(invoice_no,p_patch->>'invoiceNo'),
  drive_file_id=coalesce(p_patch->>'driveFileId',drive_file_id),
  drive_url=coalesce(p_patch->>'driveUrl',drive_url),
  register_row=coalesce((p_patch->>'registerRow')::integer,register_row),
  whop_started_at=CASE WHEN p_patch ? 'whopStarted' THEN coalesce(whop_started_at,now()) ELSE whop_started_at END,
  whop_plan_id=coalesce(whop_plan_id,p_patch->>'whopPlanId'),
  ecom_started_at=CASE WHEN p_patch ? 'ecomStarted' THEN coalesce(ecom_started_at,now()) ELSE ecom_started_at END,
  ecom_invoice_id=coalesce(ecom_invoice_id,p_patch->>'ecomInvoiceId'),
  amount_kwd=coalesce(amount_kwd,(p_patch->>'amountKwd')::numeric),
  kwd_rate=coalesce(kwd_rate,(p_patch->>'kwdRate')::numeric),
  kwd_rate_at=coalesce(kwd_rate_at,(p_patch->>'kwdRateAt')::timestamptz),
  checkout_url=CASE WHEN p_patch ? 'whopPlanId' OR p_patch ? 'ecomInvoiceId' THEN p_patch->>'checkoutUrl' ELSE checkout_url END,
  lease_until=CASE WHEN p_patch ? 'extendSeconds' THEN now()+make_interval(secs=>least((p_patch->>'extendSeconds')::integer,900)) ELSE lease_until END,
  updated_at=now()
 WHERE id=p_id
 RETURNING * INTO v;
 IF p_patch ? 'invoiceNo' AND v.invoice_no<>p_patch->>'invoiceNo' THEN
  RAISE EXCEPTION 'Invoice % already has number %.',p_id,v.invoice_no USING ERRCODE='23505';
 END IF;
 RETURN v;
END $function$
;
COMMIT;
