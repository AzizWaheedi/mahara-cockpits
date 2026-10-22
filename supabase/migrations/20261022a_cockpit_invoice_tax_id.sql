-- Invoices: the client's tax number on the invoice (22 Oct 2026).
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive. Needs 20261015a.
--
-- Muhammed, 22 Oct 2026: some clients sent their tax numbers and asked for
-- them on the invoice. The form has an optional "Tax number" field, filled in
-- from the client's last invoice that had one. hermes/invoice-desk prints it
-- under the client's location as "Tax no. ...". An invoice without one prints
-- exactly as before. No tax amount is added: the invoice still shows Tax 0.00.
--
-- cockpit_invoice_request is the live function (md5 51ac8195 checked against
-- 20261015a on 22 Oct) with only the taxId lines added.

BEGIN;

ALTER TABLE public.cockpit_invoices
 ADD COLUMN IF NOT EXISTS client_tax_id text
  CONSTRAINT cockpit_invoices_client_tax_id_check
  CHECK(client_tax_id IS NULL OR client_tax_id~'^[A-Za-z0-9][A-Za-z0-9 ./-]{0,39}$');
COMMENT ON COLUMN public.cockpit_invoices.client_tax_id IS
 'The client''s own tax number (for example a Saudi VAT number or a UAE TRN), printed under Billed to. Optional.';

CREATE OR REPLACE FUNCTION public.cockpit_invoice_request(p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  RAISE EXCEPTION 'Choose whether to create the Whop link or paste one.' USING ERRCODE='22023';
 END IF;
 IF v_kind='checkout' AND coalesce((p_args->>'createLink')::boolean,false) THEN
  v_source:='whop';
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
END $$;
COMMENT ON FUNCTION public.cockpit_invoice_request(jsonb) IS
 'Queue an invoice: {taskId, kind checkout|autocharge|paid, amount, description, lineNote?, clientDetail?, taxId?, period?, payNote?, dueDate?, checkoutUrl? or createLink: true, payments?[{date, method, amount, ref?}]}. Seat and client scope checked; payments must add up to the amount; audit row.';

NOTIFY pgrst,'reload schema';
COMMIT;
