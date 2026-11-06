-- Tap as a second backup for invoice payment links (Aziz, 2026-11-05):
-- "Ecom is the main one, but I need to have WHOP and Tap as backups just in
-- case they don't work ... including the CSM and anybody to do with billing".
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive; the two invoices already
-- in the table are untouched.
--
-- 1. cockpit_invoices takes a fourth link source, 'tap'. The invoice worker
--    asks the Edge Function invoice-tap (the only holder of the live Tap key,
--    TAP_SECRET_KEY) for a Tap invoice in KWD at the day's rate, as it does
--    for Ecom, and records the Tap id and the rate it used. Tap will not make
--    an invoice without the client's email or phone, so client_email is asked
--    for when Tap is picked. It shows on Tap's payment page only: the worker
--    turns Tap's own messages off (notifications.dispatch false, receipts off).
-- 2. cockpit_invoice_change: a failed pay-online invoice whose link was never
--    made can switch to any of the three (Ecom, Whop, Tap). 'whop' keeps its
--    meaning; 'ecom' and 'tap' are new. A fourth argument carries the email
--    when switching to Tap. Each processor's started mark now survives a
--    switch (review 2026-11-05): going back to a processor that may already
--    hold an unrecorded invoice looks it up first instead of making another.
-- 3. cockpit_tap_invoices: the status of each cockpit Tap invoice, read back
--    by invoice-tap every 15 minutes. It is not cash: the money is the
--    captured charge tap-charges-sync already reads into cockpit_tap_charges.
-- 4. cockpit_invoice_payments reads Tap as well as Ecom, so the invoice lists
--    show "Paid" for both.

begin;

-- 1. Columns and rules ----------------------------------------------------------
alter table public.cockpit_invoices
  add column if not exists tap_invoice_id text,
  add column if not exists tap_started_at timestamptz,
  add column if not exists client_email   text;

comment on column public.cockpit_invoices.tap_invoice_id is
  'The Tap invoice (inv_...) the invoice worker made through the invoice-tap Edge Function. Set once.';
comment on column public.cockpit_invoices.tap_started_at is
  'When the worker first asked Tap for this invoice''s link. Set before the create, so a retry looks the Tap invoice up by its metadata before making another.';
comment on column public.cockpit_invoices.client_email is
  'The client''s email, asked for when the link is a Tap link (Tap needs one). Shown on Tap''s payment page; Tap sends nothing.';

alter table public.cockpit_invoices drop constraint if exists cockpit_invoices_checkout_source_check;
alter table public.cockpit_invoices add constraint cockpit_invoices_checkout_source_check
  check (checkout_source = any (array['pasted','whop','ecom','tap']));

-- A recorded link belongs to its own processor. The started marks may stay
-- when an invoice switches, so a later switch back looks before it creates.
alter table public.cockpit_invoices drop constraint if exists cockpit_invoices_ecom_only;
alter table public.cockpit_invoices add constraint cockpit_invoices_ecom_only
  check (checkout_source = 'ecom' or ecom_invoice_id is null);
alter table public.cockpit_invoices drop constraint if exists cockpit_invoices_whop_only;
alter table public.cockpit_invoices add constraint cockpit_invoices_whop_only
  check (checkout_source = 'whop' or whop_plan_id is null);
-- The KWD amount and rate now belong to Ecom and Tap alike.
alter table public.cockpit_invoices drop constraint if exists cockpit_invoices_kwd_only;
alter table public.cockpit_invoices add constraint cockpit_invoices_kwd_only
  check (checkout_source in ('ecom','tap') or (amount_kwd is null and kwd_rate is null and kwd_rate_at is null));

alter table public.cockpit_invoices drop constraint if exists cockpit_invoices_tap_only;
alter table public.cockpit_invoices add constraint cockpit_invoices_tap_only
  check (checkout_source = 'tap' or tap_invoice_id is null);
alter table public.cockpit_invoices drop constraint if exists cockpit_invoices_tap_invoice_id_check;
alter table public.cockpit_invoices add constraint cockpit_invoices_tap_invoice_id_check
  check (tap_invoice_id is null or tap_invoice_id ~ '^inv_[A-Za-z0-9]{6,80}$');
alter table public.cockpit_invoices drop constraint if exists cockpit_invoices_client_email_check;
alter table public.cockpit_invoices add constraint cockpit_invoices_client_email_check
  check (client_email is null or (char_length(client_email) <= 254
    and client_email ~ '^[^\s@<>"'']+@[^\s@<>"'']+\.[a-z]{2,}$'));
alter table public.cockpit_invoices drop constraint if exists cockpit_invoices_tap_email;
alter table public.cockpit_invoices add constraint cockpit_invoices_tap_email
  check (checkout_source <> 'tap' or client_email is not null);

alter table public.cockpit_invoices drop constraint if exists cockpit_invoices_kind_fields;
alter table public.cockpit_invoices add constraint cockpit_invoices_kind_fields check (
  ((kind = 'checkout') and (due_date is not null)
    and ((checkout_url is not null) or (checkout_source = any (array['whop','ecom','tap']))))
  or ((kind = 'autocharge') and (due_date is not null))
  or ((kind = 'paid') and (jsonb_array_length(payments) >= 1) and (jsonb_array_length(payments) <= 12)));

create unique index if not exists cockpit_invoices_tap_invoice_uq
  on public.cockpit_invoices (tap_invoice_id) where tap_invoice_id is not null;

-- 2. Asking for an invoice --------------------------------------------------------
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
 v_email text;
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
 v_email:=lower(public.cockpit_invoice_text(p_args,'clientEmail',254,'The client email'));
 IF v_email IS NOT NULL AND v_email!~'^[^\s@<>"'']+@[^\s@<>"'']+\.[a-z]{2,}$' THEN
  RAISE EXCEPTION 'Type the client''s email in full, for example name@company.com.' USING ERRCODE='22023';
 END IF;

 IF nullif(p_args->>'dueDate','') IS NOT NULL THEN
  BEGIN v_due:=(p_args->>'dueDate')::date;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'Pick a valid due date.' USING ERRCODE='22023'; END;
 END IF;
 IF v_kind IN('checkout','autocharge') AND v_due IS NULL THEN
  RAISE EXCEPTION 'Pick the date the payment is due.' USING ERRCODE='22023';
 END IF;
 IF p_args ? 'createLink' AND jsonb_typeof(p_args->'createLink') IS DISTINCT FROM 'boolean' THEN
  RAISE EXCEPTION 'Choose whether to create the payment link or paste one.' USING ERRCODE='22023';
 END IF;
 -- The link the worker makes: Ecom (KNET and cards, in KWD) by default; Whop
 -- (cards, in USD) or Tap (KNET and cards, in KWD) when Ecom does not work
 -- for the client (2026-10-29, Tap 2026-11-05).
 IF p_args ? 'provider' AND coalesce(p_args->>'provider','') NOT IN('ecom','whop','tap') THEN
  RAISE EXCEPTION 'Choose Ecom, Whop or Tap for the payment link.' USING ERRCODE='22023';
 END IF;
 IF v_kind='checkout' AND coalesce((p_args->>'createLink')::boolean,false) THEN
  v_source:=CASE p_args->>'provider' WHEN 'whop' THEN 'whop' WHEN 'tap' THEN 'tap' ELSE 'ecom' END;
  IF v_source='tap' AND v_email IS NULL THEN
   RAISE EXCEPTION 'Tap needs the client''s email. It shows on Tap''s payment page; Tap sends nothing.' USING ERRCODE='22023';
  END IF;
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
   pay_note,issue_date,due_date,checkout_url,checkout_source,payments,requested_by,client_email)
 VALUES(v_acc.clickup_task_id,v_acc.client_name,v_kind,v_amount,v_desc,
   public.cockpit_invoice_text(p_args,'lineNote',200,'The line under the description'),
   public.cockpit_invoice_text(p_args,'clientDetail',120,'The client location'),
   v_tax,
   public.cockpit_invoice_text(p_args,'period',60,'The period'),
   public.cockpit_invoice_text(p_args,'payNote',400,'The note'),
   v_today,v_due,CASE WHEN v_kind='checkout' THEN v_url END,v_source,v_pay,v_who,v_email)
 RETURNING * INTO v_row;

 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata)
 VALUES('invoice.request','cockpit_invoices',v_row.id::text,v_who,
  CASE WHEN p_args->>'app'='sales' THEN 'sales' ELSE 'client-success' END,'supabase',NULL,to_jsonb(v_row),
  jsonb_build_object('clickup_task_id',v_acc.clickup_task_id));
 RETURN to_jsonb(v_row);
END $function$;

-- 3. Cancel, try again, or switch a failed link to another processor ---------------
DROP FUNCTION IF EXISTS public.cockpit_invoice_change(uuid, text, text);
CREATE OR REPLACE FUNCTION public.cockpit_invoice_change(p_id uuid, p_action text, p_app text DEFAULT NULL, p_email text DEFAULT NULL)
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
 v_email text;
 v_from text;
 v_to text;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN('cancel','retry','ecom','whop','tap') THEN
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
 ELSIF p_action IN('ecom','whop','tap') THEN
  -- The link was not made: the same invoice goes out with another processor's
  -- link. Only while no link was ever recorded on it, so a client never holds two.
  -- The started marks stay: a processor that may hold an unrecorded invoice
  -- for this one is asked for it before it is asked for another.
  v_from:=CASE v_old.checkout_source WHEN 'ecom' THEN 'Ecom' WHEN 'whop' THEN 'Whop' WHEN 'tap' THEN 'Tap' ELSE 'a pasted' END;
  v_to:=CASE p_action WHEN 'ecom' THEN 'Ecom' WHEN 'whop' THEN 'Whop' ELSE 'Tap' END;
  IF v_old.status<>'failed' OR v_old.kind<>'checkout' OR v_old.checkout_source NOT IN('ecom','whop','tap') THEN
   RAISE EXCEPTION 'Only a failed pay-online invoice whose link the cockpit makes can switch to %.',v_to USING ERRCODE='22023';
  END IF;
  IF v_old.checkout_source=p_action THEN
   RAISE EXCEPTION 'This invoice already uses %. Press Try again instead.',v_to USING ERRCODE='22023';
  END IF;
  IF v_old.checkout_url IS NOT NULL OR v_old.ecom_invoice_id IS NOT NULL OR v_old.whop_plan_id IS NOT NULL OR v_old.tap_invoice_id IS NOT NULL THEN
   RAISE EXCEPTION '% already made a link for this invoice, so it cannot switch. Cancel it and make a new invoice with %.',v_from,v_to USING ERRCODE='22023';
  END IF;
  v_email:=lower(nullif(btrim(coalesce(p_email,'')),''));
  IF v_email IS NOT NULL AND (char_length(v_email)>254 OR v_email!~'^[^\s@<>"'']+@[^\s@<>"'']+\.[a-z]{2,}$') THEN
   RAISE EXCEPTION 'Type the client''s email in full, for example name@company.com.' USING ERRCODE='22023';
  END IF;
  v_email:=coalesce(v_email,v_old.client_email);
  IF p_action='tap' AND v_email IS NULL THEN
   RAISE EXCEPTION 'Tap needs the client''s email. It shows on Tap''s payment page; Tap sends nothing.' USING ERRCODE='22023';
  END IF;
  UPDATE public.cockpit_invoices SET checkout_source=p_action,
    amount_kwd=NULL,kwd_rate=NULL,kwd_rate_at=NULL,
    client_email=v_email,status='queued',error=NULL,attempts=0,lease_until=NULL,updated_at=now()
   WHERE id=p_id RETURNING * INTO v_new;
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
revoke all on function public.cockpit_invoice_change(uuid, text, text, text) from public, anon;
grant execute on function public.cockpit_invoice_change(uuid, text, text, text) to authenticated, service_role;

-- 4. The worker's steps, now with a Tap link ----------------------------------------
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
 IF (p_patch ? 'tapStarted' OR p_patch ? 'tapInvoiceId') AND v.checkout_source<>'tap' THEN
  RAISE EXCEPTION 'Invoice % does not take a Tap link.',p_id USING ERRCODE='22023';
 END IF;
 IF (p_patch ? 'ecomInvoiceId' OR p_patch ? 'tapInvoiceId')
   AND (coalesce(p_patch->>'amountKwd','')!~'^[0-9]+\.[0-9]{3}$'
   OR (p_patch->>'amountKwd')::numeric<=0
   OR coalesce(p_patch->>'kwdRate','')!~'^[0-9]+\.[0-9]{1,6}$'
   OR (p_patch->>'kwdRate')::numeric<=0
   OR coalesce(p_patch->>'kwdRateAt','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T') THEN
  RAISE EXCEPTION 'The KWD amount or exchange rate is invalid.' USING ERRCODE='22023';
 END IF;
 IF p_patch ? 'ecomInvoiceId' THEN
  IF coalesce(p_patch->>'ecomInvoiceId','')!~'^INV_[A-Za-z0-9]+$'
   OR coalesce(p_patch->>'checkoutUrl','')!~'^https://invoice\.ecom\.io/[^[:space:]<>"'']+$' THEN
   RAISE EXCEPTION 'The Ecom id or checkout URL is invalid.' USING ERRCODE='22023';
  END IF;
  IF v.ecom_invoice_id IS NOT NULL AND (v.ecom_invoice_id<>p_patch->>'ecomInvoiceId'
    OR v.checkout_url<>p_patch->>'checkoutUrl' OR v.amount_kwd<>(p_patch->>'amountKwd')::numeric
    OR v.kwd_rate<>(p_patch->>'kwdRate')::numeric OR v.kwd_rate_at<>(p_patch->>'kwdRateAt')::timestamptz) THEN
   RAISE EXCEPTION 'Invoice % already has Ecom invoice %.',p_id,v.ecom_invoice_id USING ERRCODE='23505';
  END IF;
 END IF;
 IF p_patch ? 'tapInvoiceId' THEN
  -- A live Tap invoice page; a sandbox page never reaches a client.
  IF coalesce(p_patch->>'tapInvoiceId','')!~'^inv_[A-Za-z0-9]{6,80}$'
   OR coalesce(p_patch->>'checkoutUrl','')!~'^https://([a-z0-9-]+\.)*tap\.company/[^[:space:]<>"'']+$'
   OR (p_patch->>'checkoutUrl') ~* 'sandbox' OR char_length(p_patch->>'checkoutUrl')>500 THEN
   RAISE EXCEPTION 'The Tap id or payment URL is invalid.' USING ERRCODE='22023';
  END IF;
  IF v.tap_invoice_id IS NOT NULL AND (v.tap_invoice_id<>p_patch->>'tapInvoiceId'
    OR v.checkout_url<>p_patch->>'checkoutUrl' OR v.amount_kwd<>(p_patch->>'amountKwd')::numeric
    OR v.kwd_rate<>(p_patch->>'kwdRate')::numeric OR v.kwd_rate_at<>(p_patch->>'kwdRateAt')::timestamptz) THEN
   RAISE EXCEPTION 'Invoice % already has Tap invoice %.',p_id,v.tap_invoice_id USING ERRCODE='23505';
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
  tap_started_at=CASE WHEN p_patch ? 'tapStarted' THEN coalesce(tap_started_at,now()) ELSE tap_started_at END,
  tap_invoice_id=coalesce(tap_invoice_id,p_patch->>'tapInvoiceId'),
  amount_kwd=coalesce(amount_kwd,(p_patch->>'amountKwd')::numeric),
  kwd_rate=coalesce(kwd_rate,(p_patch->>'kwdRate')::numeric),
  kwd_rate_at=coalesce(kwd_rate_at,(p_patch->>'kwdRateAt')::timestamptz),
  checkout_url=CASE WHEN p_patch ? 'whopPlanId' OR p_patch ? 'ecomInvoiceId' OR p_patch ? 'tapInvoiceId'
    THEN p_patch->>'checkoutUrl' ELSE checkout_url END,
  lease_until=CASE WHEN p_patch ? 'extendSeconds' THEN now()+make_interval(secs=>least((p_patch->>'extendSeconds')::integer,900)) ELSE lease_until END,
  updated_at=now()
 WHERE id=p_id
 RETURNING * INTO v;
 IF p_patch ? 'invoiceNo' AND v.invoice_no<>p_patch->>'invoiceNo' THEN
  RAISE EXCEPTION 'Invoice % already has number %.',p_id,v.invoice_no USING ERRCODE='23505';
 END IF;
 RETURN v;
END $function$;

-- 5. Tap invoice status (not cash) ----------------------------------------------------
create table if not exists public.cockpit_tap_invoices (
  id                 text primary key check (id ~ '^inv_[A-Za-z0-9]{6,80}$'),
  cockpit_invoice_id uuid not null references public.cockpit_invoices(id),
  status             text not null check (status in ('UNPAID','PAID','CANCELLED','EXPIRED')),
  tap_status         text not null check (char_length(tap_status) between 1 and 40),
  amount             numeric(14,3),
  currency           text,
  paid_at            timestamptz,
  url                text,
  synced_at          timestamptz not null default now()
);
comment on table public.cockpit_tap_invoices is
  'Status of each Tap invoice the cockpit made (cockpit_invoices.checkout_source tap), read back from Tap by the invoice-tap Edge Function every 15 minutes. Not cash: a paid Tap invoice''s money is its captured charge in cockpit_tap_charges.';
create index if not exists cockpit_tap_invoices_cockpit_idx on public.cockpit_tap_invoices (cockpit_invoice_id);
alter table public.cockpit_tap_invoices enable row level security;
revoke all on public.cockpit_tap_invoices from public, anon, authenticated;
grant select, insert, update on public.cockpit_tap_invoices to service_role;

CREATE OR REPLACE FUNCTION public.cockpit_tap_invoice_sync(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 r jsonb;
 v_inv public.cockpit_invoices;
 v_old public.cockpit_tap_invoices;
 v_new public.cockpit_tap_invoices;
 n integer:=0;
BEGIN
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Tap invoice rows must be a list.' USING ERRCODE='22023';
 END IF;
 FOR r IN SELECT x FROM jsonb_array_elements(p_rows) AS t(x) LOOP
  SELECT * INTO v_inv FROM public.cockpit_invoices
   WHERE id=(r->>'cockpitInvoiceId')::uuid AND checkout_source='tap' AND tap_invoice_id=r->>'id';
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Tap invoice % is not on cockpit invoice %.',r->>'id',r->>'cockpitInvoiceId' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_old FROM public.cockpit_tap_invoices WHERE id=r->>'id' FOR UPDATE;
  INSERT INTO public.cockpit_tap_invoices AS t(id,cockpit_invoice_id,status,tap_status,amount,currency,paid_at,url,synced_at)
  VALUES(r->>'id',v_inv.id,r->>'status',left(r->>'tapStatus',40),(r->>'amount')::numeric,r->>'currency',
   CASE WHEN r->>'status'='PAID' THEN coalesce((r->>'paidAt')::timestamptz,now()) END,left(r->>'url',500),now())
  ON CONFLICT (id) DO UPDATE SET status=excluded.status,tap_status=excluded.tap_status,amount=excluded.amount,
   currency=excluded.currency,paid_at=coalesce(t.paid_at,excluded.paid_at),url=excluded.url,synced_at=now()
  RETURNING * INTO v_new;
  IF v_old.id IS NULL OR v_old.status IS DISTINCT FROM v_new.status THEN
   INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata)
   VALUES('invoice.tap_status','cockpit_invoices',v_inv.id::text,'invoice-tap','hermes','supabase',
    CASE WHEN v_old.id IS NULL THEN NULL ELSE to_jsonb(v_old) END,to_jsonb(v_new),
    jsonb_build_object('invoice_no',v_inv.invoice_no));
  END IF;
  n:=n+1;
 END LOOP;
 RETURN n;
END $function$;
revoke all on function public.cockpit_tap_invoice_sync(jsonb) from public, anon, authenticated;
grant execute on function public.cockpit_tap_invoice_sync(jsonb) to service_role;

-- 6. Paid state for the invoice lists: Ecom and Tap -----------------------------------
CREATE OR REPLACE FUNCTION public.cockpit_invoice_payments(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(x.item), '[]'::jsonb) from (
    -- The recorded Ecom link only: an Ecom invoice made on an attempt that
    -- was never recorded also carries this id (metadata key1), and must not
    -- speak for the link the client holds.
    select jsonb_build_object('id', i.id, 'status', e.status, 'paid_at', e.paid_at, 'method', e.payment_method) as item
      from public.cockpit_invoices as i
      join lateral (
        select y.status, y.paid_at, y.payment_method
          from public.cockpit_ecom_invoices as y
         where y.cockpit_invoice_id = i.id
           and (i.ecom_invoice_id is null or y.id = i.ecom_invoice_id)
         order by y.synced_at desc nulls last, y.id
         limit 1) as e on true
     where i.id = any (p_ids)
       and i.checkout_source = 'ecom'
       and public.cockpit_invoice_visible(i.client_name)
    union all
    select jsonb_build_object('id', i.id, 'status', t.status, 'paid_at', t.paid_at, 'method', 'Tap') as item
      from public.cockpit_invoices as i
      join public.cockpit_tap_invoices as t on t.id = i.tap_invoice_id and t.cockpit_invoice_id = i.id
     where i.id = any (p_ids)
       and i.checkout_source = 'tap'
       and public.cockpit_invoice_visible(i.client_name)) as x;
$function$;
revoke all on function public.cockpit_invoice_payments(uuid[]) from public, anon;
grant execute on function public.cockpit_invoice_payments(uuid[]) to authenticated, service_role;

commit;
