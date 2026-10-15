-- Invoices from the client success cockpit (11 Oct 2026).
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive. Needs 20260922a (members,
-- audit log), 20260923m (cockpit_is_ceo, cockpit_has_role), 20260923a (the
-- billing accounts) and 20260926m (cockpit_client_allowed).
--
-- Muhammed approved (11 Oct 2026): a client success, finance, sales, admin or
-- CEO seat asks for an invoice from the cockpit. The VPS worker
-- hermes/invoice-desk renders it with the invoice template (the Madana design),
-- numbers it from the Churn Tracker's 07: Invoice Register, uploads it to the
-- client's Drive folder, locks it and adds the register row. The person who
-- asks types every value, what was paid included; the audit row records who.
-- Nothing is sent to the client.
--
-- 1. cockpit_invoices: one row per request, its state and its result.
-- 2. cockpit_client_drive_folders: the Drive folder a client's invoices go to.
-- 3. Browser RPCs: request, cancel, retry, set folder. Reads go through RLS.
-- 4. Worker RPCs (service role only): claim, progress, finish, save folder.

BEGIN;

-- 1. Tables ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cockpit_invoices(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clickup_task_id text NOT NULL,
 client_name text NOT NULL,
 kind text NOT NULL CHECK(kind IN('checkout','autocharge','paid')),
 amount_usd numeric(12,2) NOT NULL CHECK(amount_usd>0 AND amount_usd<1000000),
 description text NOT NULL CHECK(char_length(btrim(description)) BETWEEN 1 AND 120),
 line_note text CHECK(line_note IS NULL OR char_length(line_note)<=200),
 client_detail text CHECK(client_detail IS NULL OR char_length(client_detail)<=120),
 period text CHECK(period IS NULL OR char_length(period)<=60),
 pay_note text CHECK(pay_note IS NULL OR char_length(pay_note)<=400),
 issue_date date NOT NULL,
 due_date date,
 checkout_url text CHECK(checkout_url IS NULL OR (checkout_url~'^https://[^\s<>"'']+$' AND char_length(checkout_url)<=500)),
 payments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(payments)='array'),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','rendering','issued','failed','cancelled')),
 invoice_no text UNIQUE CHECK(invoice_no IS NULL OR invoice_no~'^INV-[0-9]{4}-[0-9]{3,}$'),
 drive_file_id text,
 drive_url text,
 register_row integer,
 error text,
 attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz,
 requested_by text NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT now(),
 issued_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT cockpit_invoices_kind_fields CHECK(
  (kind='checkout' AND checkout_url IS NOT NULL AND due_date IS NOT NULL) OR
  (kind='autocharge' AND due_date IS NOT NULL) OR
  (kind='paid' AND jsonb_array_length(payments) BETWEEN 1 AND 12)),
 CONSTRAINT cockpit_invoices_issued_result CHECK(status<>'issued' OR (invoice_no IS NOT NULL AND drive_url IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS cockpit_invoices_status_idx ON public.cockpit_invoices(status,requested_at);
CREATE INDEX IF NOT EXISTS cockpit_invoices_task_idx ON public.cockpit_invoices(clickup_task_id,requested_at DESC);
COMMENT ON TABLE public.cockpit_invoices IS
 'Invoices asked for from the client success cockpit. queued -> rendering (hermes/invoice-desk holds a lease) -> issued (numbered, in Drive, locked, on the register) or failed (error says what to do). Rows are written only through the cockpit_invoice_* functions.';

CREATE TABLE IF NOT EXISTS public.cockpit_client_drive_folders(
 clickup_task_id text PRIMARY KEY,
 client_name text NOT NULL,
 folder_id text NOT NULL CHECK(folder_id~'^[A-Za-z0-9_-]{10,100}$'),
 folder_name text,
 matched_by text NOT NULL CHECK(matched_by IN('name','admin')),
 set_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cockpit_client_drive_folders IS
 'The Drive folder a client''s invoices are filed in. The invoice worker saves an exact single name match (matched_by name); an admin or the CEO sets or corrects one (matched_by admin).';

-- The worker's ledger of every Google call, and its last check-in. The page
-- says when the worker has gone quiet: missing is never zero.
CREATE TABLE IF NOT EXISTS public.cockpit_invoice_desk_health(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 invoice_id uuid,
 provider text NOT NULL,
 method text NOT NULL,
 resource text NOT NULL,
 http_status integer,
 ok boolean NOT NULL,
 detail text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cockpit_invoice_desk_health_at_idx ON public.cockpit_invoice_desk_health(created_at DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_invoice_desk_status(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 beat_at timestamptz NOT NULL,
 ok boolean NOT NULL,
 detail text,
 version text
);
COMMENT ON TABLE public.cockpit_invoice_desk_status IS
 'One row: when hermes/invoice-desk last ran, whether its checks passed, and the plain sentence the invoices page shows when they did not.';

ALTER TABLE public.cockpit_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_client_drive_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_invoice_desk_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_invoice_desk_status ENABLE ROW LEVEL SECURITY;

-- 2. Who may ask, and who may see -------------------------------------------------

-- cockpit_has_role is true for an admin seat whatever role is asked.
CREATE OR REPLACE FUNCTION public.cockpit_invoice_seat()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(public.cockpit_is_ceo(),false)
     OR coalesce(public.cockpit_has_role('csm'),false)
     OR coalesce(public.cockpit_has_role('finance'),false)
     OR coalesce(public.cockpit_has_role('sales'),false)
$$;
COMMENT ON FUNCTION public.cockpit_invoice_seat() IS
 'True for a client success, finance, sales, admin or CEO seat: the seats that may ask for invoices (Muhammed, 11 Oct 2026).';

CREATE OR REPLACE FUNCTION public.cockpit_invoice_visible(p_client text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.cockpit_invoice_seat()
    AND (coalesce(public.cockpit_is_ceo(),false) OR coalesce(public.cockpit_client_allowed(p_client),false))
$$;

DROP POLICY IF EXISTS cockpit_invoices_read ON public.cockpit_invoices;
CREATE POLICY cockpit_invoices_read ON public.cockpit_invoices
 FOR SELECT TO authenticated USING (public.cockpit_invoice_visible(client_name));
DROP POLICY IF EXISTS cockpit_client_drive_folders_read ON public.cockpit_client_drive_folders;
CREATE POLICY cockpit_client_drive_folders_read ON public.cockpit_client_drive_folders
 FOR SELECT TO authenticated USING (public.cockpit_invoice_visible(client_name));
DROP POLICY IF EXISTS cockpit_invoice_desk_status_read ON public.cockpit_invoice_desk_status;
CREATE POLICY cockpit_invoice_desk_status_read ON public.cockpit_invoice_desk_status
 FOR SELECT TO authenticated USING (public.cockpit_invoice_seat());

-- 3. Browser RPCs -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_invoice_text(p_args jsonb,p_key text,p_max integer,p_label text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v text:=nullif(btrim(coalesce(p_args->>p_key,'')),'');
BEGIN
 IF v IS NOT NULL AND char_length(v)>p_max THEN
  RAISE EXCEPTION '% is too long. Keep it under % characters.',p_label,p_max USING ERRCODE='22023';
 END IF;
 RETURN v;
END $$;

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
 v_due date;
 v_url text;
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

 IF nullif(p_args->>'dueDate','') IS NOT NULL THEN
  BEGIN v_due:=(p_args->>'dueDate')::date;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'Pick a valid due date.' USING ERRCODE='22023'; END;
 END IF;
 IF v_kind IN('checkout','autocharge') AND v_due IS NULL THEN
  RAISE EXCEPTION 'Pick the date the payment is due.' USING ERRCODE='22023';
 END IF;
 IF v_kind='checkout' THEN
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

 INSERT INTO public.cockpit_invoices(clickup_task_id,client_name,kind,amount_usd,description,line_note,client_detail,period,
   pay_note,issue_date,due_date,checkout_url,payments,requested_by)
 VALUES(v_acc.clickup_task_id,v_acc.client_name,v_kind,v_amount,v_desc,
   public.cockpit_invoice_text(p_args,'lineNote',200,'The line under the description'),
   public.cockpit_invoice_text(p_args,'clientDetail',120,'The client location'),
   public.cockpit_invoice_text(p_args,'period',60,'The period'),
   public.cockpit_invoice_text(p_args,'payNote',400,'The note'),
   v_today,v_due,CASE WHEN v_kind='checkout' THEN v_url END,v_pay,v_who)
 RETURNING * INTO v_row;

 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata)
 VALUES('invoice.request','cockpit_invoices',v_row.id::text,v_who,'client-success','supabase',NULL,to_jsonb(v_row),
  jsonb_build_object('clickup_task_id',v_acc.clickup_task_id));
 RETURN to_jsonb(v_row);
END $$;
COMMENT ON FUNCTION public.cockpit_invoice_request(jsonb) IS
 'Queue an invoice: {taskId, kind checkout|autocharge|paid, amount, description, lineNote?, clientDetail?, period?, payNote?, dueDate?, checkoutUrl?, payments?[{date, method, amount, ref?}]}. Seat and client scope checked; payments must add up to the amount; audit row.';

-- Cancel a queued or failed invoice, or send a failed one back to the worker.
CREATE OR REPLACE FUNCTION public.cockpit_invoice_change(p_id uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_uid uuid:=auth.uid();
 v_who text;
 v_old public.cockpit_invoices;
 v_new public.cockpit_invoices;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN('cancel','retry') THEN
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
 ELSE
  IF v_old.status<>'failed' THEN
   RAISE EXCEPTION 'Only a failed invoice can be tried again. This one is %.',v_old.status USING ERRCODE='22023';
  END IF;
  UPDATE public.cockpit_invoices SET status='queued',error=NULL,attempts=0,lease_until=NULL,updated_at=now() WHERE id=p_id RETURNING * INTO v_new;
 END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata)
 VALUES('invoice.'||p_action,'cockpit_invoices',p_id::text,v_who,'client-success','supabase',to_jsonb(v_old),to_jsonb(v_new),'{}'::jsonb);
 RETURN to_jsonb(v_new);
END $$;

-- An admin or the CEO points a client at its Drive folder (a link or an id).
CREATE OR REPLACE FUNCTION public.cockpit_invoice_set_folder(p_task text,p_folder text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_uid uuid:=auth.uid();
 v_who text;
 v_acc public.cockpit_billing_accounts;
 v_id text;
 v_old public.cockpit_client_drive_folders;
 v_new public.cockpit_client_drive_folders;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE='42501'; END IF;
 IF NOT (coalesce(public.cockpit_is_ceo(),false) OR coalesce(public.cockpit_has_role('admin'),false)) THEN
  RAISE EXCEPTION 'Only an admin or the CEO can set a client''s Drive folder.' USING ERRCODE='42501';
 END IF;
 SELECT lower(btrim(au.email)) INTO v_who FROM auth.users au WHERE au.id=v_uid;
 SELECT * INTO v_acc FROM public.cockpit_billing_accounts WHERE clickup_task_id=p_task;
 IF NOT FOUND THEN RAISE EXCEPTION 'That client card is not on the billing sheet.' USING ERRCODE='P0002'; END IF;
 v_id:=coalesce(substring(p_folder FROM '/folders/([A-Za-z0-9_-]{10,100})'),substring(btrim(coalesce(p_folder,'')) FROM '^([A-Za-z0-9_-]{10,100})$'));
 IF v_id IS NULL THEN
  RAISE EXCEPTION 'Paste the Drive folder link, the one that contains /folders/.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_old FROM public.cockpit_client_drive_folders WHERE clickup_task_id=p_task;
 INSERT INTO public.cockpit_client_drive_folders(clickup_task_id,client_name,folder_id,folder_name,matched_by,set_by,updated_at)
 VALUES(p_task,v_acc.client_name,v_id,NULL,'admin',v_who,now())
 ON CONFLICT(clickup_task_id) DO UPDATE SET client_name=excluded.client_name,folder_id=excluded.folder_id,folder_name=NULL,
  matched_by='admin',set_by=excluded.set_by,updated_at=now()
 RETURNING * INTO v_new;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata)
 VALUES('invoice.folder','cockpit_client_drive_folders',p_task,v_who,'client-success','supabase',to_jsonb(v_old),to_jsonb(v_new),'{}'::jsonb);
 RETURN to_jsonb(v_new);
END $$;

-- 4. Worker RPCs (service role) ------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_invoice_claim(p_lease_seconds integer DEFAULT 300)
RETURNS SETOF public.cockpit_invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- A worker that died five times on the same invoice stops trying it.
 UPDATE public.cockpit_invoices SET status='failed',lease_until=NULL,updated_at=now(),
  error='The invoice worker stopped five times on this invoice. Press Try again, or tell Muhammed.'
 WHERE status='rendering' AND lease_until<now() AND attempts>=5;
 RETURN QUERY
 UPDATE public.cockpit_invoices i SET status='rendering',attempts=i.attempts+1,
  lease_until=now()+make_interval(secs=>greatest(60,least(coalesce(p_lease_seconds,300),900))),updated_at=now()
 WHERE i.id=(SELECT c.id FROM public.cockpit_invoices c
  WHERE c.status='queued' OR (c.status='rendering' AND c.lease_until<now())
  ORDER BY c.requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)
 RETURNING i.*;
END $$;

-- The worker records each step as it lands, so a retry reads back instead of redoing it.
CREATE OR REPLACE FUNCTION public.cockpit_invoice_progress(p_id uuid,p_patch jsonb)
RETURNS public.cockpit_invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.cockpit_invoices;
BEGIN
 UPDATE public.cockpit_invoices SET
  invoice_no=coalesce(invoice_no,p_patch->>'invoiceNo'),
  drive_file_id=coalesce(p_patch->>'driveFileId',drive_file_id),
  drive_url=coalesce(p_patch->>'driveUrl',drive_url),
  register_row=coalesce((p_patch->>'registerRow')::integer,register_row),
  lease_until=CASE WHEN p_patch ? 'extendSeconds' THEN now()+make_interval(secs=>least((p_patch->>'extendSeconds')::integer,900)) ELSE lease_until END,
  updated_at=now()
 WHERE id=p_id AND status='rendering'
 RETURNING * INTO v;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice % is not being rendered.',p_id USING ERRCODE='P0002'; END IF;
 IF p_patch ? 'invoiceNo' AND v.invoice_no<>p_patch->>'invoiceNo' THEN
  RAISE EXCEPTION 'Invoice % already has number %.',p_id,v.invoice_no USING ERRCODE='23505';
 END IF;
 RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_invoice_finish(p_id uuid,p_ok boolean,p_error text DEFAULT NULL)
RETURNS public.cockpit_invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_old public.cockpit_invoices; v_new public.cockpit_invoices;
BEGIN
 SELECT * INTO v_old FROM public.cockpit_invoices WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR v_old.status<>'rendering' THEN RAISE EXCEPTION 'Invoice % is not being rendered.',p_id USING ERRCODE='P0002'; END IF;
 IF p_ok THEN
  UPDATE public.cockpit_invoices SET status='issued',error=NULL,lease_until=NULL,issued_at=now(),updated_at=now()
  WHERE id=p_id RETURNING * INTO v_new;
 ELSE
  UPDATE public.cockpit_invoices SET status='failed',lease_until=NULL,updated_at=now(),
   error=left(coalesce(nullif(btrim(p_error),''),'The invoice could not be made. Press Try again, or tell Muhammed.'),500)
  WHERE id=p_id RETURNING * INTO v_new;
 END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata)
 VALUES(CASE WHEN p_ok THEN 'invoice.issued' ELSE 'invoice.failed' END,'cockpit_invoices',p_id::text,'invoice-desk','hermes','supabase',
  to_jsonb(v_old),to_jsonb(v_new),'{}'::jsonb);
 RETURN v_new;
END $$;

-- An exact single name match the worker found. An admin's choice is never overwritten.
CREATE OR REPLACE FUNCTION public.cockpit_invoice_save_folder(p_task text,p_client text,p_folder_id text,p_folder_name text)
RETURNS public.cockpit_client_drive_folders LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.cockpit_client_drive_folders;
BEGIN
 INSERT INTO public.cockpit_client_drive_folders(clickup_task_id,client_name,folder_id,folder_name,matched_by,set_by)
 VALUES(p_task,p_client,p_folder_id,p_folder_name,'name','invoice-desk')
 ON CONFLICT(clickup_task_id) DO NOTHING;
 SELECT * INTO v FROM public.cockpit_client_drive_folders WHERE clickup_task_id=p_task;
 RETURN v;
END $$;

-- 5. Privileges ---------------------------------------------------------------------

REVOKE ALL ON public.cockpit_invoices,public.cockpit_client_drive_folders,
 public.cockpit_invoice_desk_health,public.cockpit_invoice_desk_status FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.cockpit_invoice_desk_health_id_seq FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.cockpit_invoices,public.cockpit_client_drive_folders,public.cockpit_invoice_desk_status TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_invoices,public.cockpit_client_drive_folders,public.cockpit_invoice_desk_status TO service_role;
GRANT SELECT,INSERT ON public.cockpit_invoice_desk_health TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.cockpit_invoice_desk_health_id_seq TO service_role;

REVOKE ALL ON FUNCTION
 public.cockpit_invoice_seat(),
 public.cockpit_invoice_visible(text),
 public.cockpit_invoice_text(jsonb,text,integer,text),
 public.cockpit_invoice_request(jsonb),
 public.cockpit_invoice_change(uuid,text),
 public.cockpit_invoice_set_folder(text,text),
 public.cockpit_invoice_claim(integer),
 public.cockpit_invoice_progress(uuid,jsonb),
 public.cockpit_invoice_finish(uuid,boolean,text),
 public.cockpit_invoice_save_folder(text,text,text,text)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 public.cockpit_invoice_seat(),
 public.cockpit_invoice_visible(text),
 public.cockpit_invoice_request(jsonb),
 public.cockpit_invoice_change(uuid,text),
 public.cockpit_invoice_set_folder(text,text)
TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 public.cockpit_invoice_text(jsonb,text,integer,text),
 public.cockpit_invoice_claim(integer),
 public.cockpit_invoice_progress(uuid,jsonb),
 public.cockpit_invoice_finish(uuid,boolean,text),
 public.cockpit_invoice_save_folder(text,text,text,text)
TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
