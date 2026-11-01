-- Checked money (docs/forms/WAVE12-CONTRACT.md sections 2.5, 3.1, 4.2 and 8;
-- the plan's E8 and piece CK). Creative Triage (bldgtotkfmhoxmlzowdx).
-- Additive; applies twice. The third waves 1-2 file.
--
-- Only money that arrived counts as cash. Until today every payment someone
-- logged by hand went straight into the cash ledger. From this file on:
--
-- 1. cockpit_manual_payments carries check_state (logged, checked, rejected),
--    checked_by, checked_at, checked_ref and statement_line_id. The column is
--    added with DEFAULT 'logged', so every row starts logged and nothing is
--    checked by a default. The protect trigger lets the five check columns
--    move once, logged to checked or rejected, and only inside
--    cockpit_manual_payment_check or the Q20 statement below (the
--    transaction-local setting cockpit.payment_check); anyone else gets the
--    trigger's existing refusal.
-- 2. Q20 (approved default): the 8 rows already in the ledger (7 transfers and
--    1 cheque, $21,239.16, logged before the check rule) are marked checked
--    by id, so today's cash, LTV and pay do not move. A row added after the
--    contract's read (11.2-i) stays logged. A database that holds none of the
--    8 ids (a test or a fresh branch) has nothing to mark.
-- 3. The inbox carries the same state: rows 2, 3 and 5 (ingested, the Q20
--    ledger rows) checked, row 4 (the refused Tap row) rejected. Ingest writes
--    every new ledger row logged; a CEO entry with a named bank reference is
--    checked at once.
-- 4. cockpit_client_payments.checked is worked out in SQL by the finance
--    refresh (cockpit_payment_checked), never read from the refresh output:
--    a rail payment is true, a hand-logged one true only once checked. So an
--    older money adapter cannot land a logged row as checked. The deal ledger
--    (pay, front-end cash) keeps checked rows only.
-- 5. The readers count checked money and say the rest apart: Pending payments
--    gets checked on every rail ("Receipt in, not checked", never "Paid"),
--    the deal match counts checked payments, and the CSM projections show
--    logged money on its own line, never as collected.
-- 6. cockpit_manual_payment_check (finance or the CEO) and
--    cockpit_manual_payments_to_check (the Checks waiting list). A check bumps
--    the finance revision, so a refresh already running fails and reruns.
-- 7. The manual ledger's audit trigger fires on an add, a remove and a
--    restore only (UPDATE OF the deleted_* columns); a check writes its own
--    billing.payment_check row, so the payment's history never reads
--    "Restored" for a check.
-- 8. forms.doors gains {"checks":true}: Checks waiting shows itself.
--
-- Every replaced function keeps its live grant; every function is revoked
-- from all four roles first. No row reaches a card, Slack or a client.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard: each replaced function is the body the contract read
--    (11.2-c) or this file's own, on a second apply.

DO $$
DECLARE
  v text;
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('cockpit_manual_payment_protect()', '19483bd59d40ab35dc3d6b1fb21ab78c', '7c672491a02ac404af300a631aef1868'),
      ('cockpit_billing_ingest_inbox(boolean,integer)', 'a27d47d94049c1c9919d02885935ce50', '1355ad42efb3e9a7b02e0944f2d784f5'),
      ('cockpit_ceo_manual_payment_add(jsonb,uuid)', '272114d96de1b84e7c53f7eee8a1a1fb', '50981d2ef217a95980fb7efc4ca93e7e'),
      ('cockpit_finish_finance_refresh(uuid,jsonb,text)', '49223dfc3d24eb5cdc0bd11f8c7fb13b', '991d4a15915820c4025f5b30b5472164'),
      ('cockpit_billing_deal_rails_held(text,text)', '745278bd6a3bf712b9b7eeee2084babf', '3e82c670b0f93c88ebb6723b8ed23705'),
      ('cockpit_billing_balances_read()', '411d7ff4533e3d827743e30b2995501d', 'abb1d695835c99779da110e7d132fdf3'),
      ('cockpit_billing_deal_assignments()', 'eb1a61f0aca100e728815a2aad81456e', 'c0930161e6da777d0ef944e7ff0b21ac'),
      ('cockpit_csm_projection_facts(jsonb)', '587087c9805f7b307cbda006f0a839a5', '0b0c77cb58c4a815234a65ba9c4f2761'),
      ('cockpit_csm_projection_refresh_billing()', '9e77236725e5f3e65e082fac970dab70', 'f1949f20d77991a04d01ff005dc3b59a'),
      ('cockpit_csm_projection_read(text,text)', 'd1d31a5b449215156b8145820c75d52f', '1500450e62217ab615d4e30b8e15b5eb')
    ) AS x(fn, live, after) LOOP
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.' || r.fn);
    IF v IS DISTINCT FROM r.live AND v IS DISTINCT FROM r.after THEN
      RAISE EXCEPTION '% changed since the waves 1-2 contract read it; stop and re-read it.', r.fn USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The check columns. Added with DEFAULT 'logged': adding a column fires no
--    UPDATE trigger, so every row, the 8 included, starts logged.

ALTER TABLE public.cockpit_manual_payments
  ADD COLUMN IF NOT EXISTS check_state text NOT NULL DEFAULT 'logged'
    CHECK (check_state IN ('logged','checked','rejected')),
  ADD COLUMN IF NOT EXISTS checked_by text,
  ADD COLUMN IF NOT EXISTS checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS checked_ref text
    CHECK (checked_ref IS NULL OR char_length(checked_ref) BETWEEN 3 AND 200),
  ADD COLUMN IF NOT EXISTS statement_line_id text;

ALTER TABLE public.cockpit_billing_inbox
  ADD COLUMN IF NOT EXISTS check_state text NOT NULL DEFAULT 'logged'
    CHECK (check_state IN ('logged','checked','rejected'));

ALTER TABLE public.cockpit_client_payments
  ADD COLUMN IF NOT EXISTS checked boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. The protect trigger, replaced before any row moves. Amounts, attribution
--    and rates stay immutable; remove and restore stay free; the check
--    columns move once, logged to checked or rejected, only where the check
--    door (or the Q20 statement) set cockpit.payment_check for this row, and
--    never in the same update as a remove or a restore.

CREATE OR REPLACE FUNCTION public.cockpit_manual_payment_protect()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_free text[] := ARRAY['deleted_by','deleted_at','delete_reason'];
  v_check text[] := ARRAY['check_state','checked_by','checked_at','checked_ref','statement_line_id'];
  v_door text := coalesce(current_setting('cockpit.payment_check', true), '');
BEGIN
  IF (to_jsonb(NEW) - v_free - v_check) IS DISTINCT FROM (to_jsonb(OLD) - v_free - v_check) THEN
    RAISE EXCEPTION 'Payment amounts, attribution and original exchange rates are immutable; remove and re-enter instead';
  END IF;
  IF (to_jsonb(NEW) - v_free) IS DISTINCT FROM (to_jsonb(OLD) - v_free) THEN
    IF OLD.check_state IS DISTINCT FROM 'logged'
       OR NEW.check_state NOT IN ('checked','rejected')
       OR v_door NOT IN ('q20', OLD.id)
       OR (to_jsonb(NEW) - v_check) IS DISTINCT FROM (to_jsonb(OLD) - v_check) THEN
      RAISE EXCEPTION 'Payment amounts, attribution and original exchange rates are immutable; remove and re-enter instead';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- The audit trigger: an add, a remove and a restore (what the status RPC
-- writes); a check is audited by its own door.
DROP TRIGGER IF EXISTS cockpit_manual_payment_audit ON public.cockpit_manual_payments;
CREATE TRIGGER cockpit_manual_payment_audit
  AFTER INSERT OR UPDATE OF deleted_by, deleted_at, delete_reason ON public.cockpit_manual_payments
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_manual_payment_audit();

-- ---------------------------------------------------------------------------
-- 3. Q20: the 8 rows of 11.2-i, checked as "logged before the check rule".

DO $$
DECLARE
  v_ids text[] := ARRAY[
    'sx7fc98m8am8fgyjfqtjnwy4718ey703', 'sx764zvpnc7gt1sb9yepq7vn4h8ftjds', 'sx7bhrq78qtqa1mn5yvagcz0198fvqsn',
    '54be0e69-fd63-4dec-95d2-adc32b5a8bd1', 'cef7fc83-5eee-45bc-83c9-234d5330ec6a', '768e486a-6bef-47ae-9d2e-781ccdbf93a5',
    '1ccf2cb8-3478-48fa-b4ff-2c44b7009978', 'bdf92a9d-9d6e-4e7f-8617-90088e35b5e7'];
  v_seen integer;
  v_live integer;
  v_usd numeric;
  v_marked integer := 0;
  r record;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE deleted_at IS NULL), sum(amount_usd) FILTER (WHERE deleted_at IS NULL)
    INTO v_seen, v_live, v_usd
    FROM public.cockpit_manual_payments WHERE id = ANY (v_ids);
  IF v_seen = 0 THEN
    RAISE NOTICE 'Q20: none of the 8 ledger rows is in this database, so nothing is marked.';
    RETURN;
  END IF;
  IF v_live <> 8 OR v_usd IS DISTINCT FROM 21239.16 THEN
    RAISE EXCEPTION 'The Q20 rows changed since the contract read them; stop and re-read.' USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('cockpit.payment_check', 'q20', true);
  FOR r IN
    UPDATE public.cockpit_manual_payments
       SET check_state = 'checked', checked_by = 'migration 20261101n (Q20)', checked_at = now(),
           checked_ref = 'logged before the check rule, 2026-11-01'
     WHERE check_state = 'logged' AND id = ANY (v_ids)
    RETURNING id, amount, currency, client_name, day
  LOOP
    v_marked := v_marked + 1;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.payment_check', 'cockpit_manual_payments', r.id, 'migration 20261101n (Q20)', 'ceo', 'supabase',
            jsonb_build_object('check_state', 'logged'),
            jsonb_build_object('check_state', 'checked', 'checked_ref', 'logged before the check rule, 2026-11-01'),
            jsonb_build_object('what', 'Checked ' || r.amount::text || ' ' || r.currency || ' for ' || r.client_name
                                 || ' received ' || r.day::text || ': logged before the check rule (Q20)'));
  END LOOP;
  PERFORM set_config('cockpit.payment_check', '', true);
  IF v_marked > 0 THEN
    UPDATE public.cockpit_manual_payment_state SET revision = revision + 1, updated_at = clock_timestamp() WHERE id;
  END IF;

  -- The inbox rows behind them: 2, 3 and 5 ingested into the Q20 rows, 4 the refused Tap row.
  IF (SELECT count(*) FROM public.cockpit_billing_inbox i
       WHERE (i.id = 2 AND i.status = 'ingested' AND i.ledger_id = 'sx764zvpnc7gt1sb9yepq7vn4h8ftjds')
          OR (i.id = 3 AND i.status = 'ingested' AND i.ledger_id = 'sx7bhrq78qtqa1mn5yvagcz0198fvqsn')
          OR (i.id = 5 AND i.status = 'ingested' AND i.ledger_id = '1ccf2cb8-3478-48fa-b4ff-2c44b7009978')
          OR (i.id = 4 AND i.status = 'rejected' AND i.ledger_id IS NULL)) <> 4 THEN
    RAISE EXCEPTION 'The inbox rows 2 to 5 changed since the contract read them; stop and re-read.' USING ERRCODE = '55000';
  END IF;
  UPDATE public.cockpit_billing_inbox SET check_state = 'checked' WHERE id IN (2, 3, 5) AND check_state = 'logged';
  UPDATE public.cockpit_billing_inbox SET check_state = 'rejected' WHERE id = 4 AND check_state = 'logged';
END $$;

-- ---------------------------------------------------------------------------
-- 4. The rule the CHECK below holds, added last: a logged row has no check
--    time, a checked or rejected one has one.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid = 'public.cockpit_manual_payments'::regclass
                    AND conname = 'cockpit_manual_payments_checked_when') THEN
    ALTER TABLE public.cockpit_manual_payments
      ADD CONSTRAINT cockpit_manual_payments_checked_when CHECK ((check_state = 'logged') = (checked_at IS NULL));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. One rule for "checked money", in two reads.

-- The finance refresh's rule, from the ledger itself: a hand-logged payment
-- (manual:<id>, rail manual) is checked only when its ledger row is checked
-- and not removed; one with no ledger row is not; every rail payment is.
CREATE OR REPLACE FUNCTION public.cockpit_payment_checked(p_payment_id text, p_rail text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN coalesce(p_payment_id, '') LIKE 'manual:%' OR p_rail = 'manual' THEN EXISTS (
      SELECT 1 FROM public.cockpit_manual_payments m
       WHERE 'manual:' || m.id = p_payment_id AND m.check_state = 'checked' AND m.deleted_at IS NULL)
    ELSE true
  END
$$;

-- The readers' rule, from what the last refresh wrote: a payment is not
-- checked when its live client payment row says so.
CREATE OR REPLACE FUNCTION public.cockpit_payment_row_checked(p_payment_id text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.cockpit_client_payments c
                      WHERE c.payment_id = p_payment_id AND c.active AND NOT c.checked)
$$;

-- The rows already in cockpit_client_payments, by the same rule, so no reader
-- drops to nothing between this file and the next money refresh.
UPDATE public.cockpit_client_payments c
   SET checked = public.cockpit_payment_checked(c.payment_id, c.rail)
 WHERE c.checked IS DISTINCT FROM public.cockpit_payment_checked(c.payment_id, c.rail);

-- ---------------------------------------------------------------------------
-- 6. The writers: ingest writes logged, the CEO's entry is checked with a bank
--    reference, the finance refresh computes checked.

CREATE OR REPLACE FUNCTION public.cockpit_billing_ingest_inbox(p_apply boolean, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  r public.cockpit_billing_inbox;
  v_twin public.cockpit_manual_payments;
  v_verdict text; v_note text; v_ledger text; v_fresh boolean;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_tap boolean; v_client text; v_key text; v_amount numeric; v_rate numeric; v_problem text; v_event bigint;
  v_rows jsonb := '[]'::jsonb; v_in integer := 0; v_dup integer := 0; v_rej integer := 0; v_wait integer := 0; v_pending integer;
BEGIN
  IF p_apply IS NULL THEN RAISE EXCEPTION 'Say whether to apply or only preview' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO v_pending FROM public.cockpit_billing_inbox WHERE status = 'pending';
  IF NOT coalesce((SELECT history_ready FROM public.cockpit_manual_payment_state WHERE id), false) THEN
    RETURN jsonb_build_object('ready', false, 'pending', v_pending,
      'note', 'The manual payment history is not reconciled, so inbox payments wait in the inbox.');
  END IF;
  v_tap := public.cockpit_manual_tap_status();
  FOR r IN SELECT * FROM public.cockpit_billing_inbox WHERE status = 'pending'
           ORDER BY logged_at, id LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
           FOR UPDATE SKIP LOCKED LOOP
    v_verdict := NULL; v_note := NULL; v_ledger := NULL; v_fresh := false; v_event := NULL;
    v_problem := public.cockpit_billing_amount_problem(r.amount, r.currency);
    IF r.paid_on > v_today OR r.paid_on < date '2025-01-01' THEN
      v_verdict := 'rejected'; v_note := format('The day %s is not a day money could have arrived.', r.paid_on);
    ELSIF v_problem IS NOT NULL THEN
      v_verdict := 'rejected'; v_note := v_problem;
    ELSIF r.method = 'tap' AND v_tap IS TRUE THEN
      v_verdict := 'rejected';
      v_note := 'Tap is connected, so a Tap payment arrives on the Tap rail by itself; logging it would count it twice.';
    ELSIF r.method = 'tap' AND v_tap IS NULL THEN
      v_note := 'Not taken in yet: the Tap connection state is unknown. It is tried again at the next run.';
    ELSIF NOT EXISTS (SELECT 1 FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = r.clickup_task_id)
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_client_billing_days b WHERE b.clickup_task_id = r.clickup_task_id) THEN
      v_verdict := 'rejected'; v_note := 'That client card is not on the roster any more.';
    ELSE
      v_client := coalesce(public.cockpit_manual_clean_text(r.client_name, 120), r.clickup_task_id);
      v_amount := round(r.amount, 3);
      v_rate := CASE r.currency WHEN 'USD' THEN 1 ELSE 3.26 END;
      v_key := public.cockpit_manual_name_key(v_client);
      -- Already taken in by an earlier run that stopped before marking it.
      SELECT * INTO v_twin FROM public.cockpit_manual_payments p
       WHERE p.source_system = 'supabase' AND p.source_deployment = 'billing-inbox' AND p.source_id = r.id::text;
      IF FOUND THEN
        v_verdict := 'ingested'; v_ledger := v_twin.id; v_note := 'In the ledger.';
      ELSE
        SELECT * INTO v_twin FROM public.cockpit_manual_payments p
         WHERE p.deleted_at IS NULL AND p.day = r.paid_on AND p.currency = r.currency
           AND abs(p.amount - v_amount) < 0.0005
           AND ((v_key <> '' AND p.client_key = v_key) OR p.clickup_task_id = r.clickup_task_id)
         ORDER BY p.added_at, p.id LIMIT 1;
        IF FOUND THEN
          v_verdict := 'duplicate'; v_ledger := v_twin.id;
          v_note := format('%s from %s on %s was already in the ledger (%s), so this was not counted a second time.',
            '$' || to_char(v_twin.amount_usd, 'FM999,999,990.00') ||
              CASE WHEN v_twin.currency = 'USD' THEN ''
                   ELSE ' (' || regexp_replace(to_char(v_twin.amount, 'FM999,999,990.000'), '\.?0+$', '') || ' ' || v_twin.currency || ')' END,
            v_twin.client_name, r.paid_on,
            CASE v_twin.rail WHEN 'bank_transfer' THEN 'bank transfer' WHEN 'tap' THEN 'Tap' ELSE v_twin.rail END);
        ELSE
          v_verdict := 'ingested'; v_note := 'In the ledger.'; v_fresh := true;
          IF p_apply THEN
            INSERT INTO public.cockpit_manual_payments(day, amount, currency, amount_usd, usd_per_unit, client_name, client_key,
              clickup_task_id, rail, kind, note, added_by, source_system, source_deployment, source_id, check_state)
            VALUES (r.paid_on, v_amount, r.currency, round(v_amount * v_rate, 2), v_rate, v_client, v_key,
              r.clickup_task_id, r.method, 'payment',
              public.cockpit_manual_clean_text(concat_ws('; ', 'ref ' || r.reference, r.note, 'receipt ' || r.evidence_url), 500),
              r.source || ': ' || coalesce(public.cockpit_manual_clean_text(r.logged_by, 80), 'unknown'),
              'supabase', 'billing-inbox', r.id::text,
              -- checked money (20261101n): every hand-logged row waits on finance's check.
              'logged')
            RETURNING id INTO v_ledger;
          END IF;
        END IF;
      END IF;
    END IF;

    IF v_verdict IS NULL THEN v_wait := v_wait + 1;
    ELSIF v_verdict = 'ingested' THEN v_in := v_in + 1;
    ELSIF v_verdict = 'duplicate' THEN v_dup := v_dup + 1;
    ELSE v_rej := v_rej + 1;
    END IF;

    IF p_apply AND (v_verdict IS NOT NULL OR r.status_note IS DISTINCT FROM v_note) THEN
      IF v_verdict IS NULL THEN
        UPDATE public.cockpit_billing_inbox SET status_note = v_note WHERE id = r.id;
      ELSE
        -- checked money (20261101n): a refused row reads rejected; any other reads as its ledger row does.
        UPDATE public.cockpit_billing_inbox
           SET status = v_verdict, ledger_id = v_ledger, status_note = v_note, settled_at = now(),
               check_state = CASE WHEN v_verdict = 'rejected' THEN 'rejected'
                                  ELSE coalesce((SELECT m.check_state FROM public.cockpit_manual_payments m WHERE m.id = v_ledger), 'logged') END
         WHERE id = r.id;
        IF v_fresh THEN
          INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
          VALUES (r.clickup_task_id, r.client_name, 'payment', NULL, NULL, NULL,
            jsonb_build_object('amount', r.amount, 'currency', r.currency, 'day', r.paid_on, 'rail', r.method,
                               'reference', r.reference, 'inbox', r.id, 'ledgerId', v_ledger),
            CASE WHEN r.source = 'maher' THEN 'maher' ELSE 'csm' END, r.logged_by)
          RETURNING id INTO v_event;
        END IF;
      END IF;
      INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
      VALUES ('billingInbox.' || coalesce(v_verdict, 'waiting'), 'cockpit_billing_inbox', r.id::text, 'billing-sync', 'billing-sync',
              'supabase', to_jsonb(r), (SELECT to_jsonb(i) FROM public.cockpit_billing_inbox i WHERE i.id = r.id),
              jsonb_build_object('ledger_id', v_ledger, 'event_id', v_event));
    END IF;
    v_rows := v_rows || jsonb_build_object('id', r.id, 'verdict', coalesce(v_verdict, 'waiting'), 'note', v_note, 'ledgerId', v_ledger);
  END LOOP;
  RETURN jsonb_build_object('ready', true, 'pending', v_pending, 'ingested', v_in, 'duplicate', v_dup,
                            'rejected', v_rej, 'waiting', v_wait, 'rows', v_rows);
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_manual_payment_add(p_input jsonb, p_request_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
#variable_conflict use_variable
DECLARE actor text;d date;amount numeric;deal numeric;currency text;rail text;kind text;client text;task text;note text;
 rate numeric;key text;req jsonb;existing public.cockpit_manual_payments;id text;k text;tap boolean;ref text;
BEGIN
 actor:=public.cockpit_manual_require_founder();PERFORM public.cockpit_manual_require_history();
 IF p_request_id IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'A request identity and payment fields are required';END IF;
 FOR k IN SELECT jsonb_object_keys(p_input) LOOP
 IF k NOT IN ('day','amount','currency','rail','kind','clientName','clickupTaskId','note','dealContracted','allowRepeat','reference','checkedRef') THEN RAISE EXCEPTION 'Unsupported payment field: %',k;END IF;END LOOP;
 IF (p_input->>'day' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') IS NOT TRUE THEN RAISE EXCEPTION 'Day received must use YYYY-MM-DD';END IF;
 d:=(p_input->>'day')::date;
 IF d<'2025-01-01' OR d>(now() AT TIME ZONE 'Asia/Kuwait')::date THEN RAISE EXCEPTION 'Day received is outside the permitted range';END IF;
 currency:=p_input->>'currency';rail:=p_input->>'rail';kind:=coalesce(p_input->>'kind','payment');
 IF currency IS NULL OR currency NOT IN ('USD','KWD') OR rail IS NULL OR rail NOT IN ('bank_transfer','cheque','cash','tap','ecom','other') OR kind NOT IN ('payment','refund') THEN RAISE EXCEPTION 'Invalid currency, payment method or kind';END IF;
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
 FOR k IN SELECT unnest(ARRAY['clientName','clickupTaskId','note','reference','checkedRef']) LOOP
 IF p_input ? k AND jsonb_typeof(p_input->k) NOT IN ('string','null') THEN RAISE EXCEPTION 'Payment names and notes must be text';END IF;END LOOP;
 client:=public.cockpit_manual_clean_text(p_input->>'clientName',120);note:=public.cockpit_manual_clean_text(p_input->>'note',500);
 IF client IS NULL THEN RAISE EXCEPTION 'Type the client name';END IF;
 task:=nullif(btrim(p_input->>'clickupTaskId'),'');
 -- checked money (20261101n): a bank reference of 3 or more characters makes the entry checked at once.
 ref:=public.cockpit_manual_clean_text(coalesce(p_input->>'checkedRef',p_input->>'reference'),200);
 IF ref IS NOT NULL AND char_length(ref)<3 THEN RAISE EXCEPTION 'Type the whole bank reference (3 characters or more), or leave it empty to log the payment as not checked';END IF;
 req:=jsonb_build_object('day',d,'amount',amount,'currency',currency,'rail',rail,'kind',kind,'client',client,'task',task,'deal',deal,'note',note);
 IF ref IS NOT NULL THEN req:=req||jsonb_build_object('reference',ref);END IF;
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
 rail,kind,deal_contracted,deal_contracted_usd,note,added_by,request_id,request_data,check_state,checked_by,checked_at,checked_ref)
 VALUES(d,amount,currency,round(amount*rate,2),rate,client,key,task,rail,kind,deal,round(deal*rate,2),note,actor,p_request_id,req,
 CASE WHEN ref IS NULL THEN 'logged' ELSE 'checked' END,CASE WHEN ref IS NOT NULL THEN actor END,CASE WHEN ref IS NOT NULL THEN now() END,ref)
 RETURNING cockpit_manual_payments.id INTO id;
 RETURN id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cockpit_finish_finance_refresh(p_id uuid, p_output jsonb DEFAULT NULL::jsonb, p_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE job cockpit_finance_refreshes; rev bigint; section jsonb; point jsonb; row_data jsonb; previous jsonb; section_count integer; since_day date;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('cockpit_finance_refresh'));
 SELECT * INTO job FROM cockpit_finance_refreshes WHERE id=p_id FOR UPDATE;
 IF job.id IS NULL THEN RAISE EXCEPTION 'Finance refresh not found'; END IF;
 IF job.status='confirmed' THEN RETURN job.result; END IF;
 IF job.status<>'running' THEN RAISE EXCEPTION 'Finance refresh is no longer running'; END IF;
 IF p_error IS NOT NULL THEN
  UPDATE cockpit_finance_refreshes SET status='failed',error=left(p_error,2000),finished_at=now() WHERE id=p_id;
  INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata) VALUES('finance.failed','cockpit_finance_refreshes',p_id::text,job.actor_email,'media-buyer-cockpit','supabase',jsonb_build_object('error',left(p_error,2000)));
  RETURN jsonb_build_object('ok',false,'error',left(p_error,2000));
 END IF;
 PERFORM cockpit_finance_refresh_input(p_id); -- Re-check founder and source import readiness at the write boundary.
 SELECT revision INTO rev FROM cockpit_manual_payment_state WHERE id FOR UPDATE;
 IF rev<>job.revision THEN RAISE EXCEPTION 'Finance inputs changed during this refresh; run it again'; END IF;
 IF job.created_at<now()-interval '5 minutes' THEN RAISE EXCEPTION 'Finance refresh expired'; END IF;
 IF jsonb_typeof(p_output->'sections') IS DISTINCT FROM 'array' OR jsonb_array_length(p_output->'sections')<>2 OR jsonb_typeof(p_output->'payments') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Incomplete finance output'; END IF;
 SELECT count(DISTINCT s->>'key') INTO section_count FROM jsonb_array_elements(p_output->'sections') s WHERE s->>'key' IN ('money','expenses');
 IF section_count<>2 THEN RAISE EXCEPTION 'Money and expenses must commit together'; END IF;
 FOR section IN SELECT * FROM jsonb_array_elements(p_output->'sections') LOOP
  IF jsonb_typeof(section->'payload') IS DISTINCT FROM 'object' OR jsonb_typeof(section->'sources') IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(section->'sources') s WHERE (s->>'ok')::boolean IS NOT TRUE) THEN RAISE EXCEPTION 'Unconfirmed finance source'; END IF;
  IF section->>'key'='money' AND (jsonb_typeof(section#>'{payload,attribution,transactions}') IS DISTINCT FROM 'array' OR section#>'{payload,rails,manual}' IS NULL) THEN RAISE EXCEPTION 'Attribution or manual source missing'; END IF;
  SELECT to_jsonb(s) INTO previous FROM cockpit_sections s WHERE key=section->>'key';
  INSERT INTO cockpit_sections(key,label,ok,error,computed_at,payload,sources) VALUES(section->>'key',section->>'label',true,NULL,now(),section->'payload',section->'sources')
   ON CONFLICT(key) DO UPDATE SET label=excluded.label,ok=true,error=NULL,computed_at=now(),payload=excluded.payload,sources=excluded.sources,updated_at=now();
  INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata) VALUES('finance.refreshed','cockpit_sections',section->>'key',job.actor_email,'media-buyer-cockpit','supabase',previous,section,jsonb_build_object('refreshId',p_id,'revision',rev));
  FOR point IN SELECT * FROM jsonb_array_elements(coalesce(section->'daily','[]'::jsonb)) LOOP
   IF point->>'metric' !~ '^(money|expenses)[.]' OR jsonb_typeof(point->'value') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid finance history point'; END IF;
   INSERT INTO cockpit_metric_days(day,metric,scope,value) VALUES((point->>'date')::date,point->>'metric',point->>'scope',(point->>'value')::double precision)
    ON CONFLICT(day,metric,scope) DO UPDATE SET value=excluded.value,captured_at=now();
  END LOOP;
 END LOOP;
 since_day:=date_trunc('month',now() AT TIME ZONE 'Asia/Kuwait')::date-interval '11 months';
 UPDATE cockpit_client_payments SET active=false,source_refresh_id=p_id WHERE day>=since_day AND active;
 FOR row_data IN SELECT * FROM jsonb_array_elements(p_output->'payments') LOOP
  -- checked money (20261101n): checked is worked out here, never read from the output. A rail
  -- payment is money that arrived; a hand-logged one counts only once finance checked it.
  INSERT INTO cockpit_client_payments(payment_id,clickup_task_id,client_name,day,usd,rail,side,kind,person,active,source_refresh_id,checked)
   VALUES(row_data->>'payment_id',row_data->>'clickup_task_id',row_data->>'client_name',(row_data->>'day')::date,(row_data->>'usd')::numeric,row_data->>'rail',row_data->>'side',row_data->>'kind',row_data->>'person',true,p_id,
    cockpit_payment_checked(row_data->>'payment_id',row_data->>'rail'))
   ON CONFLICT(payment_id) DO UPDATE SET clickup_task_id=excluded.clickup_task_id,client_name=excluded.client_name,day=excluded.day,usd=excluded.usd,rail=excluded.rail,side=excluded.side,kind=excluded.kind,person=excluded.person,active=true,source_refresh_id=p_id,recorded_at=now(),checked=excluded.checked;
 END LOOP;
 -- money ties: the deal ledger, rewritten like cockpit_client_payments when this output carries it; without the key it is left alone.
 -- money ties: each row as {payment_id, deal_response_id, day, usd, rail, kind, deposit_usd?, matched_by, tie_id?, payer?} (camelCase accepted);
 -- money ties: without deposit_usd a deposit row is all deposit and a remainder row none (a worker from before the split).
 IF p_output ? 'dealPayments' THEN -- money ties
  IF jsonb_typeof(p_output->'dealPayments') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Incomplete finance output'; END IF; -- money ties
  UPDATE cockpit_deal_payments SET active=false,source_refresh_id=p_id WHERE day>=since_day AND active; -- money ties
  FOR row_data IN SELECT jsonb_build_object( -- money ties
     'payment_id',coalesce(d->'payment_id',d->'paymentId'),'deal_response_id',coalesce(d->'deal_response_id',d->'dealResponseId'), -- money ties
     'day',d->'day','usd',d->'usd','rail',d->'rail','kind',d->'kind','deposit_usd',coalesce(d->'deposit_usd',d->'depositUsd'), -- money ties
     'matched_by',coalesce(d->'matched_by',d->'matchedBy'), -- money ties
     'tie_id',coalesce(d->'tie_id',d->'tieId'),'payer',d->'payer') -- money ties
    FROM jsonb_array_elements(p_output->'dealPayments') d LOOP -- money ties
   IF coalesce(btrim(row_data->>'payment_id'),'')='' OR coalesce(btrim(row_data->>'deal_response_id'),'')='' -- money ties
    OR coalesce(row_data->>'day','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR jsonb_typeof(row_data->'usd') IS DISTINCT FROM 'number' -- money ties
    OR coalesce(btrim(row_data->>'rail'),'')='' OR coalesce(row_data->>'kind','') NOT IN ('deposit','remainder') -- money ties
    OR coalesce(btrim(row_data->>'matched_by'),'')='' OR (row_data->'tie_id' IS NOT NULL AND jsonb_typeof(row_data->'tie_id') NOT IN ('number','null')) -- money ties
    OR (row_data->'deposit_usd' IS NOT NULL AND jsonb_typeof(row_data->'deposit_usd') NOT IN ('number','null')) -- money ties
    OR (jsonb_typeof(row_data->'deposit_usd')='number' AND ((row_data->>'deposit_usd')::numeric<0 OR (row_data->>'deposit_usd')::numeric>(row_data->>'usd')::numeric)) THEN -- money ties
    RAISE EXCEPTION 'Invalid deal payment %',left(coalesce(row_data->>'payment_id','(no id)'),120); -- money ties
   END IF; -- money ties
   -- checked money (20261101n): pay and front-end cash read the ledger, so a payment not checked stays out of it.
   IF NOT cockpit_payment_checked(row_data->>'payment_id',row_data->>'rail') THEN CONTINUE; END IF;
   INSERT INTO cockpit_deal_payments(payment_id,deal_response_id,day,usd,rail,kind,deposit_usd,matched_by,tie_id,payer,active,source_refresh_id) -- money ties
    VALUES(row_data->>'payment_id',row_data->>'deal_response_id',(row_data->>'day')::date,(row_data->>'usd')::numeric,row_data->>'rail',row_data->>'kind', -- money ties
     coalesce((row_data->>'deposit_usd')::numeric,CASE WHEN row_data->>'kind'='deposit' THEN (row_data->>'usd')::numeric ELSE 0 END), -- money ties
     row_data->>'matched_by',(row_data->>'tie_id')::bigint,row_data->>'payer',true,p_id) -- money ties
    ON CONFLICT(payment_id) DO UPDATE SET deal_response_id=excluded.deal_response_id,day=excluded.day,usd=excluded.usd,rail=excluded.rail,kind=excluded.kind,deposit_usd=excluded.deposit_usd,matched_by=excluded.matched_by,tie_id=excluded.tie_id,payer=excluded.payer,active=true,source_refresh_id=p_id,recorded_at=now(); -- money ties
  END LOOP; -- money ties
 END IF; -- money ties
 UPDATE cockpit_manual_payment_state SET totals_revision=rev,history_ready=true,updated_at=now() WHERE id;
 UPDATE cockpit_finance_refreshes SET status='confirmed',result=jsonb_build_object('ok',true,'id',p_id,'revision',rev,'sections',jsonb_build_array('money','expenses'),'payments',jsonb_array_length(p_output->'payments')),finished_at=now() WHERE id=p_id RETURNING result INTO previous;
 INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,after) VALUES('finance.confirmed','cockpit_finance_refreshes',p_id::text,job.actor_email,'media-buyer-cockpit','supabase',previous);
 RETURN previous;
END $function$;

-- ---------------------------------------------------------------------------
-- 7. The readers.

-- What a deal holds, now with checked: a ledger row is checked money (the
-- refresh writes only those); a card row says what its client payment says.
-- The return type grows by one column, so the function is dropped and made
-- again (cockpit_billing_deal_rails names its columns; plpgsql callers read a
-- record).
DROP FUNCTION IF EXISTS public.cockpit_billing_deal_rails_held(text, text);
CREATE FUNCTION public.cockpit_billing_deal_rails_held(p_deal text, p_task text)
 RETURNS TABLE(payment_id text, day date, usd numeric, rail text, from_ledger boolean, kind text, recorded_at timestamp with time zone, checked boolean)
 LANGUAGE sql
 STABLE
 SET search_path = ''
AS $function$
  WITH d AS (
    SELECT (s.submitted_at AT TIME ZONE 'Asia/Kuwait')::date AS signed
    FROM public.cockpit_sales_deals s WHERE s.response_id = p_deal AND s.submitted_at IS NOT NULL
  ),
  ledger AS (
    SELECT dp.payment_id, dp.day, dp.usd, dp.rail, true AS from_ledger, dp.kind, dp.recorded_at,
           public.cockpit_payment_row_checked(dp.payment_id) AS checked
    FROM public.cockpit_deal_payments dp
    WHERE dp.deal_response_id = p_deal AND dp.active
  ),
  card AS (
    SELECT cp.payment_id, cp.day, cp.usd, cp.rail, false AS from_ledger, cp.kind, cp.recorded_at, cp.checked
    FROM public.cockpit_client_payments cp CROSS JOIN d
    WHERE p_task IS NOT NULL AND cp.clickup_task_id = p_task AND cp.active AND cp.day >= d.signed - 7
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_deal_payments o
                      WHERE o.payment_id = cp.payment_id AND o.active AND o.deal_response_id <> p_deal)
      AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.payment_id = cp.payment_id)
  )
  SELECT * FROM ledger
  UNION ALL
  SELECT * FROM card
$function$;

CREATE OR REPLACE FUNCTION public.cockpit_billing_balances_read()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ceo boolean;
  v_who text;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_since date := (now() AT TIME ZONE 'Asia/Kuwait')::date - 400;
  v_tasks text[];
  v_sales_tasks text[] := '{}'::text[];
  v_carded text[];
  v_cards jsonb; v_deal_rows jsonb; v_rails jsonb; v_calls jsonb; v_kickoffs jsonb; v_history jsonb;
  v_events jsonb; v_inbox jsonb; v_invoices jsonb; v_ecom jsonb; v_confirmations jsonb;
  v_untied jsonb := '[]'::jsonb; v_unlinked jsonb := '[]'::jsonb; v_sales jsonb := '[]'::jsonb;
  v_exclusions jsonb := '[]'::jsonb; v_excluded_unlinked jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to see pending payments.' USING ERRCODE = '42501';
  END IF;
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT (v_ceo OR coalesce(public.cockpit_has_role('csm'), false) OR coalesce(public.cockpit_has_role('finance'), false)) THEN
    RAISE EXCEPTION 'Pending payments need a client success, finance or CEO seat. Ask an admin to add the role.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(au.email)) INTO v_who FROM auth.users au WHERE au.id = v_uid;

  -- The cards on the list (cockpit_billing_card_listed, PLAN 1.2 "Scope").
  -- A success manager gets only the cards allowed to them.
  SELECT coalesce(array_agg(a.clickup_task_id ORDER BY a.clickup_task_id), '{}'::text[]) INTO v_tasks
  FROM public.cockpit_billing_accounts a
  WHERE public.cockpit_billing_card_listed(a.clickup_task_id, false)
    AND (v_ceo OR coalesce(public.cockpit_client_allowed(a.client_name), false));
  -- The CEO's Back with sales cards (SALES TEAM TO CONTACT).
  IF v_ceo THEN
    SELECT coalesce(array_agg(a.clickup_task_id ORDER BY a.clickup_task_id), '{}'::text[]) INTO v_sales_tasks
    FROM public.cockpit_billing_accounts a
    WHERE a.stage_group = 'sales' AND public.cockpit_billing_card_listed(a.clickup_task_id, true);
  END IF;

  -- Every card that has a signed deal of its own (for the CEO's suggested card).
  SELECT coalesce(array_agg(dc.clickup_task_id), '{}'::text[]) INTO v_carded FROM public.cockpit_billing_deal_cards() dc;

  -- Cards ----------------------------------------------------------------
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'taskId', a.clickup_task_id,
    'name', a.client_name,
    'url', a.task_url,
    'group', a.stage_group,
    'status', a.client_status,
    'previousStatus', (SELECT h.stage FROM public.cockpit_client_billing_days h
                        WHERE h.clickup_task_id = a.clickup_task_id AND h.stage IS DISTINCT FROM a.client_status
                        ORDER BY h.day DESC LIMIT 1),
    'quiet', upper(btrim(coalesce(a.client_status, ''))) = 'GHOSTED',
    'plan', a.payment_plan,
    'method', a.payment_method,
    'nextUsd', a.next_payment_usd,
    'nextDate', a.next_payment_date,
    'extensionWeeks', a.extension_weeks,
    'ltvFieldUsd', a.ltv_field_usd,
    'launchOn', coalesce(o.launch_on, (SELECT h.launch_date FROM public.cockpit_client_billing_days h
                  WHERE h.clickup_task_id = a.clickup_task_id AND h.launch_date IS NOT NULL ORDER BY h.day DESC LIMIT 1)),
    'signupOn', coalesce(o.signup_on, (SELECT h.signup_date FROM public.cockpit_client_billing_days h
                  WHERE h.clickup_task_id = a.clickup_task_id AND h.signup_date IS NOT NULL ORDER BY h.day DESC LIMIT 1)),
    'cardCallOn', o.onboarding_call_on,
    'noteAtOnboardingUsd', nullif(replace(substring(coalesce(o.handover ->> 'billing_notes', '')
                  FROM '(?i)cash to be collected on onboarding\s*:\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)'), ',', ''), '')::numeric,
    'noteContractUsd', nullif(replace(substring(coalesce(o.handover ->> 'billing_notes', '')
                  FROM '(?i)total contracted revenue\s*:\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)'), ',', ''), '')::numeric,
    'inOnboarding', coalesce(o.in_onboarding, false),
    -- The first day the card was seen past Onboarding Booked, coming from
    -- Needs Contacting or Onboarding Booked (the history starts 7 Oct 2026,
    -- so a card already past it then has none).
    'firstPastOnboardingBookedOn', (
      SELECT min(h.day) FROM public.cockpit_client_billing_days h
      WHERE h.clickup_task_id = a.clickup_task_id
        AND h.stage ~* '^\s*(brand blueprint booked|launch booked|ready for launch|active)'
        AND EXISTS (SELECT 1 FROM public.cockpit_client_billing_days e
                    WHERE e.clickup_task_id = a.clickup_task_id AND e.day < h.day
                      AND e.stage ~* '^\s*(needs contacting|onboarding booked)')),
    'csm', a.csm
  ) ORDER BY a.client_name, a.clickup_task_id), '[]'::jsonb) INTO v_cards
  FROM public.cockpit_billing_accounts a
  LEFT JOIN public.cockpit_client_onboarding o ON o.clickup_task_id = a.clickup_task_id
  WHERE a.clickup_task_id = ANY (v_tasks);

  -- Each listed card's newest deal ------------------------------------------
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'responseId', d.response_id,
    'signedAt', d.submitted_at,
    'signedOn', (d.submitted_at AT TIME ZONE 'Asia/Kuwait')::date,
    'business', d.business_name,
    'closer', d.closer,
    'paymentStructure', d.payment_structure,
    'agreementType', d.agreement_type,
    'contractUsd', d.contracted_revenue,
    'depositUsd', d.cash_collected,
    'atOnboardingUsd', d.cash_at_onboarding,
    'secondPaymentUsd', d.second_payment,
    'newMrrUsd', d.new_mrr,
    'taskId', dc.clickup_task_id,
    'matchedBy', dc.matched_by,
    'linkedByName', public.cockpit_billing_person_name(dc.linked_by),
    'conflict', dc.conflict,
    'otherForms', dc.other_forms)
    || CASE WHEN v_ceo THEN jsonb_build_object(
         'contactName', d.client_name,
         'conflictWith', coalesce((SELECT jsonb_agg(jsonb_build_object('taskId', x.clickup_task_id, 'name', x.client_name) ORDER BY x.client_name)
                                   FROM public.cockpit_billing_accounts x WHERE x.clickup_task_id = ANY (dc.conflict_with)), '[]'::jsonb))
       ELSE '{}'::jsonb END
    ORDER BY d.submitted_at DESC, d.response_id), '[]'::jsonb) INTO v_deal_rows
  FROM public.cockpit_billing_deal_cards() dc
  JOIN public.cockpit_sales_deals d ON d.response_id = dc.deal_response_id
  WHERE dc.clickup_task_id = ANY (v_tasks);

  -- Rails: the payments that count for each listed deal ---------------------
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'dealResponseId', dc.deal_response_id, 'paymentId', r.payment_id, 'day', r.day, 'usd', r.usd,
    'rail', r.rail, 'kind', r.kind, 'fromLedger', r.from_ledger,
    -- checked money (20261101n): false for a hand-logged payment finance has not checked.
    'checked', public.cockpit_payment_row_checked(r.payment_id),
    'byHand', r.rail IN ('manual', 'transfer', 'bank') OR r.payment_id ~ '^(manual|transfer|bank):')
    ORDER BY dc.deal_response_id, r.day, r.payment_id), '[]'::jsonb) INTO v_rails
  FROM public.cockpit_billing_deal_cards() dc
  CROSS JOIN LATERAL public.cockpit_billing_deal_rails(dc.deal_response_id, dc.clickup_task_id) r
  WHERE dc.clickup_task_id = ANY (v_tasks);

  -- Onboarding calls ----------------------------------------------------------
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'taskId', c.task_id, 'startsAt', c.starts_at, 'status', c.status, 'source', c.source,
    'matchMethod', c.match_method, 'confidence', c.match_confidence,
    'booked', c.status IN ('booked', 'confirmed') AND c.starts_at > now())
    ORDER BY c.task_id, c.starts_at), '[]'::jsonb) INTO v_calls
  FROM public.cockpit_csm_calls c
  WHERE c.task_id = ANY (v_tasks) AND c.kind = 'onboarding';

  -- Kickoff forms (current and retired) -------------------------------------
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'taskId', f.task_id, 'submittedAt', f.submitted_at, 'kind', f.form_kind,
    'typedPayment', (SELECT CASE WHEN jsonb_typeof(x -> 'value') = 'number' THEN (x ->> 'value')::numeric
                                 WHEN (x ->> 'value') ~ '^\s*[0-9][0-9,]*(\.[0-9]+)?\s*$' THEN replace(btrim(x ->> 'value'), ',', '')::numeric END
                     FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.answers) = 'array' THEN f.answers ELSE '[]'::jsonb END) x
                     WHERE x ->> 'ref' = '75e97e7d-4c19-437a-b4b8-67570c29344f' OR lower(btrim(x ->> 'title')) = 'payment amount'
                     LIMIT 1))
    ORDER BY f.task_id, f.submitted_at), '[]'::jsonb) INTO v_kickoffs
  FROM public.cockpit_csm_call_forms f
  WHERE f.task_id = ANY (v_tasks) AND f.form_kind IN ('kickoff', 'kickoff_old');

  -- The card's daily billing history: only the days something changed --------
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'taskId', h.clickup_task_id, 'day', h.day, 'ltvUsd', h.ltv_usd, 'nextDate', h.next_payment_date,
    'nextUsd', h.next_payment_usd, 'stage', h.stage) ORDER BY h.clickup_task_id, h.day), '[]'::jsonb) INTO v_history
  FROM (
    SELECT b.clickup_task_id, b.day, b.ltv_usd, b.next_payment_date, b.next_payment_usd, b.stage,
           lag(b.ltv_usd) OVER w AS p_ltv, lag(b.next_payment_date) OVER w AS p_date,
           lag(b.next_payment_usd) OVER w AS p_usd, lag(b.stage) OVER w AS p_stage,
           row_number() OVER w AS n
    FROM public.cockpit_client_billing_days b
    WHERE b.clickup_task_id = ANY (v_tasks) AND b.day >= v_since
    WINDOW w AS (PARTITION BY b.clickup_task_id ORDER BY b.day)
  ) h
  WHERE h.n = 1 OR h.ltv_usd IS DISTINCT FROM h.p_ltv OR h.next_payment_date IS DISTINCT FROM h.p_date
     OR h.next_payment_usd IS DISTINCT FROM h.p_usd OR h.stage IS DISTINCT FROM h.p_stage;

  -- Billing log: what moved a date or an amount, and payments and invoices ---
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'taskId', e.clickup_task_id, 'kind', e.kind, 'from', e.from_value, 'to', e.to_value,
    'reason', e.reason,
    'weeks', CASE WHEN e.detail ->> 'weeks' ~ '^[0-9]+(\.[0-9]+)?$' THEN (e.detail ->> 'weeks')::numeric END,
    'movedDate', CASE WHEN jsonb_typeof(e.detail -> 'movedDate') = 'boolean' THEN (e.detail ->> 'movedDate')::boolean END,
    'source', e.source, 'byName', public.cockpit_billing_person_name(e.by_whom), 'at', e.at)
    ORDER BY e.clickup_task_id, e.at, e.id), '[]'::jsonb) INTO v_events
  FROM public.cockpit_billing_events e
  WHERE e.clickup_task_id = ANY (v_tasks) AND e.kind IN ('extension', 'date', 'amount', 'payment', 'invoice')
    AND e.at >= now() - interval '400 days';

  -- Billing inbox: payments people logged, whatever became of them -----------
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'taskId', i.clickup_task_id, 'paidOn', i.paid_on, 'amount', i.amount, 'currency', i.currency,
    'usd', CASE i.currency WHEN 'USD' THEN i.amount ELSE round(i.amount * 3.26, 2) END,
    'method', i.method, 'source', i.source, 'status', i.status, 'statusNote', i.status_note,
    'loggedByName', public.cockpit_billing_person_name(i.logged_by), 'loggedAt', i.logged_at)
    ORDER BY i.clickup_task_id, i.logged_at, i.id), '[]'::jsonb) INTO v_inbox
  FROM public.cockpit_billing_inbox i
  WHERE i.clickup_task_id = ANY (v_tasks) AND i.logged_at >= now() - interval '400 days';

  -- Invoices asked for from client success ----------------------------------
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'taskId', v.clickup_task_id, 'invoiceNo', v.invoice_no, 'kind', v.kind, 'amountUsd', v.amount_usd,
    'issueDate', v.issue_date, 'dueDate', v.due_date, 'status', v.status, 'payNote', v.pay_note)
    ORDER BY v.clickup_task_id, v.requested_at, v.id), '[]'::jsonb) INTO v_invoices
  FROM public.cockpit_invoices v
  WHERE v.clickup_task_id = ANY (v_tasks) AND v.requested_at >= now() - interval '400 days';

  -- Open Ecom invoices: status UNPAID only (PAID, EXPIRED, CANCELLED and the
  -- DELETED that ecom-payments-sync marks are not a request still open).
  -- Each invoice goes to one card picked among EVERY card, and only then is
  -- the list cut to the caller's cards; picking among the caller's cards
  -- would hand a success manager another client's invoice. The pick: the
  -- desk's invoice; then a card name or alias key equal to the customer name
  -- key (4+ characters); then one containing the other (both 6+); a card on
  -- the list (the CEO's) beats a gone one, then the longer key.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'taskId', m.task, 'invoiceNumber', m.invoice_number, 'status', m.status, 'amountKwd', m.amount_kwd,
    'usd', m.usd, 'createdAt', m.created_at) ORDER BY m.task, m.created_at), '[]'::jsonb) INTO v_ecom
  FROM (
    SELECT DISTINCT ON (x.id) x.id, x.invoice_number, x.status, x.amount_kwd, x.usd, x.created_at, t.task
    FROM public.cockpit_ecom_invoices x
    CROSS JOIN LATERAL (SELECT public.cockpit_name_key(x.customer_name) AS k) ik
    CROSS JOIN LATERAL (
      SELECT ci.clickup_task_id AS task, 0 AS rank, 0 AS klen
      FROM public.cockpit_invoices ci WHERE ci.id = x.cockpit_invoice_id AND ci.clickup_task_id IS NOT NULL
      UNION ALL
      SELECT n.task, CASE WHEN n.k = ik.k THEN 1 ELSE 2 END, length(n.k)
      FROM (
        SELECT a.clickup_task_id AS task, public.cockpit_name_key(a.client_name) AS k
        FROM public.cockpit_billing_accounts a
        UNION
        SELECT f.task_id, public.cockpit_name_key(f.name)
        FROM public.cockpit_finance_client_aliases f WHERE f.task_id IS NOT NULL
        UNION
        SELECT f.task_id, public.cockpit_name_key(e.v)
        FROM public.cockpit_finance_client_aliases f
        CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.aliases) = 'array' THEN f.aliases ELSE '[]'::jsonb END) AS e(v)
        WHERE f.task_id IS NOT NULL
      ) n
      WHERE (length(n.k) >= 4 AND n.k = ik.k)
         OR (length(n.k) >= 6 AND length(ik.k) >= 6 AND (strpos(ik.k, n.k) > 0 OR strpos(n.k, ik.k) > 0))
    ) t
    WHERE upper(btrim(coalesce(x.status, ''))) = 'UNPAID'
    ORDER BY x.id, t.rank, public.cockpit_billing_card_listed(t.task, true) DESC, t.klen DESC, t.task
  ) m
  WHERE m.task = ANY (v_tasks);

  -- Confirmations made on the listed cards (and, for the CEO, on Back with
  -- sales cards, where only he may confirm) ----------------------------------
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'taskId', c.clickup_task_id, 'dealResponseId', c.deal_response_id, 'part', c.part, 'partNo', c.part_no,
    'amount', c.amount, 'currency', c.currency, 'usd', c.usd, 'rail', c.rail, 'paidOn', c.paid_on,
    'evidenceUrl', c.evidence_url, 'note', c.note, 'railsUsdAtConfirm', c.rails_usd_at_confirm, 'railsAsOf', c.rails_as_of,
    'source', c.source, 'confirmedByName', public.cockpit_billing_person_name(c.confirmed_by),
    'confirmedByCeo', c.confirmed_by_ceo, 'byYou', c.confirmed_by = v_who, 'confirmedAt', c.confirmed_at,
    'withdrawnByName', public.cockpit_billing_person_name(c.withdrawn_by), 'withdrawnAt', c.withdrawn_at,
    'withdrawnReason', c.withdrawn_reason)
    ORDER BY c.clickup_task_id, c.confirmed_at, c.id), '[]'::jsonb) INTO v_confirmations
  FROM public.cockpit_billing_confirmations c
  WHERE c.clickup_task_id = ANY (v_tasks) OR c.clickup_task_id = ANY (v_sales_tasks);

  -- Payments the CEO left out of program money (20261024p) on the deals this
  -- read lists (and, for the CEO, on his Back with sales cards and the deals
  -- with no card), each with its day, dollars and rail from the payments that
  -- deal holds: an exclusion shows only on the row of the deal it was set on,
  -- while that deal holds the payment, and the rails above never carry it.
  IF EXISTS (SELECT 1 FROM public.cockpit_billing_payment_exclusions x WHERE x.withdrawn_at IS NULL) THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'paymentId', x.payment_id, 'dealResponseId', dc.deal_response_id, 'taskId', dc.clickup_task_id,
      'day', h.day, 'usd', h.usd, 'rail', h.rail, 'checked', h.checked, 'reason', x.reason,
      'setByName', public.cockpit_billing_person_name(x.set_by), 'setAt', x.set_at)
      || CASE WHEN v_ceo THEN jsonb_build_object('note', x.note) ELSE '{}'::jsonb END
      ORDER BY dc.deal_response_id, h.day, x.payment_id), '[]'::jsonb) INTO v_exclusions
    FROM public.cockpit_billing_deal_cards() dc
    CROSS JOIN LATERAL public.cockpit_billing_deal_rails_held(dc.deal_response_id, dc.clickup_task_id) h
    JOIN public.cockpit_billing_payment_exclusions x
      ON x.payment_id = h.payment_id AND x.deal_response_id = dc.deal_response_id AND x.withdrawn_at IS NULL
    WHERE dc.clickup_task_id = ANY (v_tasks) OR dc.clickup_task_id = ANY (v_sales_tasks);
    IF v_ceo THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'paymentId', x.payment_id, 'dealResponseId', a.deal_response_id, 'taskId', NULL,
        'day', h.day, 'usd', h.usd, 'rail', h.rail, 'checked', h.checked, 'reason', x.reason,
        'setByName', public.cockpit_billing_person_name(x.set_by), 'setAt', x.set_at, 'note', x.note)
        ORDER BY a.deal_response_id, h.day, x.payment_id), '[]'::jsonb) INTO v_excluded_unlinked
      FROM public.cockpit_billing_deal_assignments() a
      CROSS JOIN LATERAL public.cockpit_billing_deal_rails_held(a.deal_response_id, NULL) h
      JOIN public.cockpit_billing_payment_exclusions x
        ON x.payment_id = h.payment_id AND x.deal_response_id = a.deal_response_id AND x.withdrawn_at IS NULL
      WHERE a.clickup_task_id IS NULL;
      v_exclusions := v_exclusions || v_excluded_unlinked;
    END IF;
  END IF;

  IF v_ceo THEN
    -- Untied money in (the money section's last publish): the CEO's Possible money.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', t ->> 'id', 'day', t ->> 'day', 'rail', t ->> 'rail', 'usd', (t ->> 'usd')::numeric,
      'currency', t ->> 'currency',
      'amount', CASE WHEN jsonb_typeof(t -> 'amount') = 'number' THEN (t ->> 'amount')::numeric END,
      'payerName', t ->> 'payerName')
      ORDER BY t ->> 'day', t ->> 'id'), '[]'::jsonb) INTO v_untied
    FROM public.cockpit_sections s
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.payload #> '{attribution,transactions}') = 'array'
                                                 THEN s.payload #> '{attribution,transactions}' ELSE '[]'::jsonb END) t
    WHERE s.key = 'money' AND t ->> 'direction' = 'in' AND t ->> 'side' = 'unattributed'
      AND t ->> 'rail' IN ('whop', 'tap', 'ecom', 'transfer')
      AND coalesce(t ->> 'bankKind', '') <> 'own_transfer'
      AND jsonb_typeof(t -> 'usd') = 'number' AND (t ->> 'usd')::numeric >= 5;

    -- Signed deals no card claims, each with a suggested card: an in-scope
    -- card with no deal of its own that signed up within 3 days of the form.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'responseId', d.response_id,
      'signedAt', d.submitted_at,
      'signedOn', (d.submitted_at AT TIME ZONE 'Asia/Kuwait')::date,
      'business', d.business_name,
      'closer', d.closer,
      'contactName', d.client_name,
      'paymentStructure', d.payment_structure,
      'agreementType', d.agreement_type,
      'contractUsd', d.contracted_revenue,
      'depositUsd', d.cash_collected,
      'atOnboardingUsd', d.cash_at_onboarding,
      'secondPaymentUsd', d.second_payment,
      'newMrrUsd', d.new_mrr,
      'suggestedTaskId', sg.task, 'suggestedName', sg.name, 'suggestedSignupOn', sg.signup_on,
      'rails', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'dealResponseId', d.response_id, 'paymentId', r.payment_id, 'day', r.day, 'usd', r.usd, 'rail', r.rail,
                  'kind', r.kind, 'fromLedger', r.from_ledger,
                  'checked', public.cockpit_payment_row_checked(r.payment_id),
                  'byHand', r.rail IN ('manual', 'transfer', 'bank') OR r.payment_id ~ '^(manual|transfer|bank):')
                  ORDER BY r.day, r.payment_id), '[]'::jsonb)
                FROM public.cockpit_billing_deal_rails(d.response_id, NULL) r))
      ORDER BY d.submitted_at DESC, d.response_id), '[]'::jsonb) INTO v_unlinked
    FROM public.cockpit_billing_deal_assignments() x
    JOIN public.cockpit_sales_deals d ON d.response_id = x.deal_response_id
    LEFT JOIN LATERAL (
      SELECT a.clickup_task_id AS task, a.client_name AS name, su.signup_on
      FROM public.cockpit_billing_accounts a
      LEFT JOIN public.cockpit_client_onboarding o ON o.clickup_task_id = a.clickup_task_id
      CROSS JOIN LATERAL (SELECT coalesce(o.signup_on, (SELECT h.signup_date FROM public.cockpit_client_billing_days h
                            WHERE h.clickup_task_id = a.clickup_task_id AND h.signup_date IS NOT NULL ORDER BY h.day DESC LIMIT 1)) AS signup_on) su
      WHERE a.clickup_task_id = ANY (v_tasks)
        AND NOT (a.clickup_task_id = ANY (v_carded))
        AND su.signup_on BETWEEN (d.submitted_at AT TIME ZONE 'Asia/Kuwait')::date - 3 AND (d.submitted_at AT TIME ZONE 'Asia/Kuwait')::date + 3
      ORDER BY abs(su.signup_on - (d.submitted_at AT TIME ZONE 'Asia/Kuwait')::date), a.client_name, a.clickup_task_id
      LIMIT 1
    ) sg ON true
    WHERE x.clickup_task_id IS NULL;

    -- Back with sales: SALES TEAM TO CONTACT cards, each with its newest deal and rails.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'taskId', a.clickup_task_id, 'name', a.client_name, 'url', a.task_url, 'status', a.client_status,
      'ltvFieldUsd', a.ltv_field_usd,
      'deal', CASE WHEN d.response_id IS NULL THEN NULL ELSE jsonb_build_object(
        'responseId', d.response_id, 'signedAt', d.submitted_at, 'signedOn', (d.submitted_at AT TIME ZONE 'Asia/Kuwait')::date,
        'business', d.business_name, 'closer', d.closer, 'contactName', d.client_name,
        'paymentStructure', d.payment_structure, 'contractUsd', d.contracted_revenue, 'depositUsd', d.cash_collected,
        'atOnboardingUsd', d.cash_at_onboarding, 'secondPaymentUsd', d.second_payment, 'newMrrUsd', d.new_mrr,
        'matchedBy', dc.matched_by, 'conflict', dc.conflict, 'otherForms', dc.other_forms) END,
      'rails', CASE WHEN d.response_id IS NULL THEN '[]'::jsonb ELSE (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'dealResponseId', d.response_id, 'paymentId', r.payment_id, 'day', r.day, 'usd', r.usd, 'rail', r.rail,
          'kind', r.kind, 'fromLedger', r.from_ledger,
          'checked', public.cockpit_payment_row_checked(r.payment_id),
          'byHand', r.rail IN ('manual', 'transfer', 'bank') OR r.payment_id ~ '^(manual|transfer|bank):')
          ORDER BY r.day, r.payment_id), '[]'::jsonb)
        FROM public.cockpit_billing_deal_rails(d.response_id, a.clickup_task_id) r) END)
      ORDER BY a.client_name, a.clickup_task_id), '[]'::jsonb) INTO v_sales
    FROM public.cockpit_billing_accounts a
    LEFT JOIN public.cockpit_billing_deal_cards() dc ON dc.clickup_task_id = a.clickup_task_id
    LEFT JOIN public.cockpit_sales_deals d ON d.response_id = dc.deal_response_id
    WHERE a.clickup_task_id = ANY (v_sales_tasks);
  END IF;

  RETURN jsonb_build_object(
    'today', v_today,
    'ceo', v_ceo,
    'moneyAsOf', coalesce((SELECT max(p.recorded_at) FROM public.cockpit_deal_payments p WHERE p.active),
                          (SELECT max(p.recorded_at) FROM public.cockpit_client_payments p WHERE p.active)),
    'cardsAsOf', (SELECT s.last_ok_at FROM public.cockpit_sync_state s WHERE s.key = 'billing-sync'),
    'dealsAsOf', (SELECT max(d.mirrored_at) FROM public.cockpit_sales_deals d),
    'callsAsOf', (SELECT s.last_ok_at FROM public.cockpit_sync_state s WHERE s.key = 'csm-ghl-calls'),
    'untiedAsOf', CASE WHEN v_ceo THEN (SELECT s.computed_at FROM public.cockpit_sections s WHERE s.key = 'money') END,
    'cards', v_cards,
    'deals', v_deal_rows,
    'rails', v_rails,
    'calls', v_calls,
    'kickoffs', v_kickoffs,
    'cardHistory', v_history,
    'events', v_events,
    'inbox', v_inbox,
    'invoices', v_invoices,
    'ecomOpen', v_ecom,
    'confirmations', v_confirmations,
    'exclusions', v_exclusions,
    'untied', v_untied,
    'unlinked', v_unlinked,
    'backWithSales', v_sales);
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_billing_deal_assignments()
 RETURNS TABLE(deal_response_id text, signed_at timestamp with time zone, clickup_task_id text, matched_by text, conflict boolean, conflict_with text[], linked_by text, link_id bigint)
 LANGUAGE sql
 STABLE
 SET search_path = ''
AS $function$
  WITH deals AS (
    SELECT d.response_id, d.submitted_at, public.cockpit_name_key(d.business_name) AS k
    FROM public.cockpit_sales_deals d
    WHERE NOT d.voided AND d.submitted_at IS NOT NULL
      AND public.cockpit_name_key(d.business_name) <> 'test'
      AND lower(btrim(coalesce(d.business_name, ''))) !~ '^test([^a-z]|$)'
  ),
  cards AS (
    SELECT a.clickup_task_id AS task,
           (coalesce(a.stage_group, '') IN ('active', 'pipeline', 'sales') AND a.paused_on IS NULL AND a.churn_date IS NULL
            AND a.client_name !~* 'playing account|\[internal test\]') AS listable
    FROM public.cockpit_billing_accounts a
  ),
  names AS (
    SELECT a.clickup_task_id AS task, 0 AS alias, public.cockpit_name_key(a.client_name) AS k
    FROM public.cockpit_billing_accounts a
    UNION
    SELECT f.task_id, 1, public.cockpit_name_key(f.name)
    FROM public.cockpit_finance_client_aliases f WHERE f.task_id IS NOT NULL
    UNION
    SELECT f.task_id, 1, public.cockpit_name_key(e.v)
    FROM public.cockpit_finance_client_aliases f
    CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.aliases) = 'array' THEN f.aliases ELSE '[]'::jsonb END) AS e(v)
    WHERE f.task_id IS NOT NULL
  ),
  cand AS (
    -- rank 0 ledger, 1 exact name, 2 exact alias, 3 one contains the other
    SELECT d.response_id, n.task, CASE WHEN n.k = d.k THEN 1 + n.alias ELSE 3 END AS rank, n.alias, length(n.k) AS klen
    FROM deals d
    JOIN names n ON (length(n.k) >= 4 AND n.k = d.k)
                 OR (length(n.k) >= 6 AND length(d.k) >= 6 AND (strpos(d.k, n.k) > 0 OR strpos(n.k, d.k) > 0))
    UNION
    SELECT dp.deal_response_id, cp.clickup_task_id, 0, 0, 0
    FROM public.cockpit_deal_payments dp
    JOIN public.cockpit_client_payments cp ON cp.payment_id = dp.payment_id AND cp.active AND cp.checked
    JOIN deals d ON d.response_id = dp.deal_response_id
    WHERE dp.active
  ),
  carded AS (
    SELECT c.*, k.listable FROM cand c JOIN cards k ON k.task = c.task
  ),
  best AS (
    SELECT DISTINCT ON (c.response_id) c.response_id, c.task, c.rank, c.alias
    FROM carded c
    ORDER BY c.response_id, c.rank, c.listable DESC, c.klen DESC, c.task
  ),
  spread AS (
    SELECT c.response_id, array_agg(DISTINCT c.task ORDER BY c.task) FILTER (WHERE c.listable) AS tasks
    FROM carded c GROUP BY c.response_id
  ),
  links AS (
    SELECT l.id, l.deal_response_id, l.clickup_task_id, l.set_by
    FROM public.cockpit_billing_deal_links l
    WHERE l.cleared_at IS NULL
      AND EXISTS (SELECT 1 FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = l.clickup_task_id)
  )
  SELECT d.response_id,
         d.submitted_at,
         coalesce(l.clickup_task_id, b.task),
         CASE WHEN l.id IS NOT NULL THEN 'link'
              WHEN b.rank = 0 THEN 'ledger'
              WHEN b.rank IS NULL THEN NULL
              WHEN b.alias = 1 THEN 'alias'
              ELSE 'name' END,
         l.id IS NULL AND coalesce(cardinality(s.tasks), 0) > 1,
         CASE WHEN l.id IS NULL AND coalesce(cardinality(s.tasks), 0) > 1
              THEN array_remove(s.tasks, b.task) ELSE '{}'::text[] END,
         l.set_by,
         l.id
  FROM deals d
  LEFT JOIN best b ON b.response_id = d.response_id
  LEFT JOIN spread s ON s.response_id = d.response_id
  LEFT JOIN links l ON l.deal_response_id = d.response_id
$function$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_projection_facts(p_client jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE facts jsonb:='[]'; k text; labels text[]:=ARRAY['Stage','Happiness','Service','Last call','Last report sent','Next payment']; keys text[]:=ARRAY['stage','happiness','service','lastCall','lastReport','paymentDate']; i integer; profile jsonb; paid numeric; logged numeric;
BEGIN
 FOR i IN 1..array_length(keys,1) LOOP
  k:=keys[i]; IF nullif(p_client->>k,'') IS NOT NULL THEN facts:=facts||jsonb_build_array(jsonb_build_object('label',labels[i],'value',p_client->>k,'source','ClickUp '||labels[i])); END IF;
 END LOOP;
 SELECT p.kpi INTO profile FROM public.cockpit_client_profiles p WHERE lower(btrim(p.client_name))=lower(btrim(p_client->>'name'));
 IF nullif(profile->>'error','') IS NULL THEN
  FOREACH k IN ARRAY ARRAY['leads','booked','closes'] LOOP
   IF jsonb_typeof(profile->'month'->k)='number' THEN facts:=facts||jsonb_build_array(jsonb_build_object('label',initcap(k)||' this month','value',profile->'month'->>k,'source','The client performance sheet')); END IF;
  END LOOP;
 END IF;
 -- checked money (20261101n): paid is checked money; a receipt finance has not checked is its own fact.
 SELECT sum(usd) FILTER (WHERE checked), sum(usd) FILTER (WHERE NOT checked) INTO paid, logged
   FROM public.cockpit_client_payments WHERE active AND (clickup_task_id=p_client->>'taskId' OR lower(btrim(client_name))=lower(btrim(p_client->>'name')));
 IF paid IS NOT NULL THEN facts:=facts||jsonb_build_array(jsonb_build_object('label','Paid so far','value','$'||paid::text,'source','Billing ledger')); END IF;
 IF logged IS NOT NULL THEN facts:=facts||jsonb_build_array(jsonb_build_object('label','Receipt in, not checked','value','$'||logged::text,'source','Billing ledger, logged by hand and waiting on finance''s check')); END IF;
 RETURN facts;
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_projection_refresh_billing()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE actor uuid; finished timestamptz;
BEGIN
  actor:=public.cockpit_csm_actor();
  SELECT finished_at INTO finished FROM public.cockpit_finance_refreshes
    WHERE status='confirmed' AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    -- checked money (20261101n): payments are checked money; logged ones are counted apart.
    'payments',(SELECT count(*) FROM public.cockpit_client_payments p WHERE p.active AND p.checked AND p.day >= (now() AT TIME ZONE 'Asia/Kuwait')::date-400 AND public.cockpit_client_allowed(p.client_name)),
    'logged',(SELECT count(*) FROM public.cockpit_client_payments p WHERE p.active AND NOT p.checked AND p.day >= (now() AT TIME ZONE 'Asia/Kuwait')::date-400 AND public.cockpit_client_allowed(p.client_name)),
    'accounts',(SELECT count(*) FROM public.cockpit_billing_accounts a WHERE public.cockpit_client_allowed(a.client_name)),
    'finishedAt',finished,
    'source','Active native payment facts (last 400 days; hand-logged payments count once finance checks them), ClickUp billing mirror, latest confirmed finance refresh; no provider refresh was requested.');
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_projection_read(p_for_email text DEFAULT NULL::text, p_meeting_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE uid uuid; email text; owner text; missing text; clients jsonb; rows jsonb; tables jsonb:='{}'; t text; ledger_at timestamptz;
BEGIN
 uid:=public.cockpit_csm_projection_actor(p_meeting_id);SELECT u.email INTO email FROM auth.users u WHERE u.id=uid;
 owner:=lower(btrim(coalesce(p_for_email,email)));
 IF owner<>email AND NOT(public.cockpit_is_ceo() OR public.cockpit_has_role('admin')) THEN RAISE EXCEPTION 'Only the CEO or an admin opens another person''s projections' USING ERRCODE='42501'; END IF;
 SELECT string_agg(st.table_name,', ') INTO missing FROM public.cockpit_csm_source_state st
 WHERE st.table_name IN ('clients','decisions','appointments','clientProfiles') AND (NOT st.ready OR st.source_snapshot_at IS NULL OR st.row_count IS DISTINCT FROM (SELECT count(*) FROM public.cockpit_csm_sources s WHERE s.table_name=st.table_name AND s.source_snapshot_at=st.source_snapshot_at));
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'Client-success history is not ready: %',missing; END IF;
 FOREACH t IN ARRAY ARRAY['clients','decisions','appointments','clientProfiles'] LOOP
 SELECT coalesce(jsonb_agg(s.data),'[]') INTO rows FROM public.cockpit_csm_sources s JOIN public.cockpit_csm_source_state st USING(table_name)
 WHERE s.table_name=t AND s.source_snapshot_at=st.source_snapshot_at AND (public.cockpit_csm_scope_all() OR (cardinality(s.client_names)>0 AND NOT EXISTS(SELECT 1 FROM unnest(s.client_names) n WHERE NOT public.cockpit_client_allowed(n))));
 tables:=jsonb_set(tables,ARRAY[t],rows);
 END LOOP;
 SELECT coalesce(jsonb_agg(public.cockpit_csm_projection_client(c->>'taskId')),'[]') INTO clients FROM jsonb_array_elements(tables->'clients') c;
 SELECT max(finished_at) INTO ledger_at FROM public.cockpit_finance_refreshes WHERE status='confirmed';
 RETURN jsonb_build_object('today',(now() AT TIME ZONE 'Asia/Kuwait')::date,'owner',owner,'email',email,
 'canGold',public.cockpit_is_ceo(),'canEditOthers',public.cockpit_is_ceo() OR public.cockpit_has_role('admin'),
 'clients',clients,'appointments',tables->'appointments','profiles',tables->'clientProfiles',
 'decisions',(tables->'decisions')||coalesce((SELECT jsonb_agg(jsonb_build_object('day',d.day,'subject',d.subject,'action',d.action,'kind',coalesce(d.metadata->>'projectionKind',d.kind),'role',d.role)) FROM public.cockpit_decisions d WHERE role='csm' AND d.source_system='supabase' AND public.cockpit_client_allowed(subject)),'[]'),
 'projections',coalesce((SELECT jsonb_agg(p.data||jsonb_build_object('weekStart',p.week_start,'byEmail',p.owner_email,'metric',p.metric,'at',extract(epoch FROM p.updated_at)*1000)) FROM public.cockpit_csm_projections p WHERE p.owner_email=owner OR public.cockpit_is_ceo() OR public.cockpit_has_role('admin')),'[]'),
 'plans',coalesce((SELECT jsonb_agg(p.data||jsonb_build_object('_id',p.id,'taskId',p.task_id,'clientName',p.client_name,'renewalDate',p.renewal_date,'updatedAt',extract(epoch FROM p.updated_at)*1000)) FROM public.cockpit_csm_renewal_plans p WHERE public.cockpit_client_allowed(client_name)),'[]'),
 'feed',jsonb_build_object('okAt',extract(epoch FROM ledger_at)*1000,'ledgerSyncedAt',extract(epoch FROM ledger_at)*1000,'error',CASE WHEN ledger_at IS NULL THEN 'The billing ledger has not completed a native refresh' END,
 'payments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.payment_id,'taskId',p.clickup_task_id,'clientName',p.client_name,'day',p.day,'usd',p.usd,'side',p.side,'kind',p.kind)) FROM public.cockpit_client_payments p WHERE p.active AND p.checked AND public.cockpit_client_allowed(client_name)),'[]'),
 'logged',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.payment_id,'taskId',p.clickup_task_id,'clientName',p.client_name,'day',p.day,'usd',p.usd,'side',p.side,'kind',p.kind,'note','Receipt in, not checked')) FROM public.cockpit_client_payments p WHERE p.active AND NOT p.checked AND public.cockpit_client_allowed(client_name)),'[]'),
 'accounts',coalesce((SELECT jsonb_agg(jsonb_build_object('taskId',b.clickup_task_id,'clientName',b.client_name,'ltvUsd',b.ltv_field_usd)) FROM public.cockpit_billing_accounts b WHERE public.cockpit_client_allowed(client_name)),'[]')));
END $function$;

-- ---------------------------------------------------------------------------
-- 8. The check door and the list it works from.

-- Finance or the CEO checks one logged payment against the bank, or rejects
-- it. A check names the bank reference or the statement line, so it reads
-- back; a rejection says why. The finance revision moves, so a refresh
-- already running fails its write and reruns with the new state.
CREATE OR REPLACE FUNCTION public.cockpit_manual_payment_check(p_id text, p_verdict text, p_ref text, p_statement_line_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_who text;
  v_row public.cockpit_manual_payments;
  v_after public.cockpit_manual_payments;
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
  v_line text := nullif(btrim(coalesce(p_statement_line_id, '')), '');
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to check a payment.' USING ERRCODE = '42501';
  END IF;
  IF NOT (coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('finance'), false)) THEN
    RAISE EXCEPTION 'Only finance or the CEO checks a payment against the bank.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(m.email)) INTO v_who FROM public.cockpit_members m WHERE m.auth_user_id = v_uid AND m.active;
  IF v_who IS NULL THEN
    RAISE EXCEPTION 'Only finance or the CEO checks a payment against the bank.' USING ERRCODE = '42501';
  END IF;
  IF p_verdict IS NULL OR p_verdict NOT IN ('checked', 'rejected') THEN
    RAISE EXCEPTION 'Choose Check or Reject.' USING ERRCODE = '22023';
  END IF;
  IF v_ref IS NOT NULL AND char_length(v_ref) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'Keep the bank reference or the reason between 3 and 200 characters.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.cockpit_manual_payments WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That payment is not in the ledger any more. Refresh the list.' USING ERRCODE = '22023';
  END IF;
  IF v_row.check_state <> 'logged' THEN
    RAISE EXCEPTION 'This payment was already % on %.', v_row.check_state,
      to_char(v_row.checked_at AT TIME ZONE 'Asia/Kuwait', 'FMDD Mon YYYY') USING ERRCODE = '22023';
  END IF;
  IF p_verdict = 'checked' AND v_ref IS NULL AND v_line IS NULL THEN
    RAISE EXCEPTION 'Name the bank reference or pick the statement line, so the check reads back.' USING ERRCODE = '22023';
  END IF;
  IF p_verdict = 'rejected' AND v_ref IS NULL THEN
    RAISE EXCEPTION 'Say why it is rejected (3 to 200 characters), so the log reads back.' USING ERRCODE = '22023';
  END IF;
  IF p_verdict = 'rejected' AND v_line IS NOT NULL THEN
    RAISE EXCEPTION 'A rejected payment has no statement line. Leave the line empty.' USING ERRCODE = '22023';
  END IF;
  IF v_line IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cockpit_bank_lines l WHERE l.id::text = v_line AND l.usd > 0) THEN
    RAISE EXCEPTION 'That statement line is not money in on an uploaded statement. Pick it again.' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('cockpit.payment_check', v_row.id, true);
  UPDATE public.cockpit_manual_payments
     SET check_state = p_verdict, checked_by = v_who, checked_at = now(), checked_ref = v_ref, statement_line_id = v_line
   WHERE id = v_row.id
  RETURNING * INTO v_after;
  PERFORM set_config('cockpit.payment_check', '', true);
  IF v_row.source_deployment = 'billing-inbox' THEN
    UPDATE public.cockpit_billing_inbox SET check_state = p_verdict WHERE id::text = v_row.source_id;
  END IF;
  UPDATE public.cockpit_manual_payment_state SET revision = revision + 1, updated_at = clock_timestamp() WHERE id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'The finance source state is missing, so nothing was checked.' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('billing.payment_check', 'cockpit_manual_payments', v_row.id, v_who, 'cockpit', 'supabase',
          jsonb_build_object('check_state', v_row.check_state),
          jsonb_build_object('check_state', v_after.check_state, 'checked_ref', v_after.checked_ref,
                             'statement_line_id', v_after.statement_line_id, 'checked_at', v_after.checked_at),
          jsonb_build_object('what',
            CASE p_verdict WHEN 'checked' THEN 'Checked ' ELSE 'Rejected ' END
            || v_row.amount::text || ' ' || v_row.currency || ' for ' || v_row.client_name || ' received ' || v_row.day::text
            || CASE WHEN p_verdict = 'checked'
                    THEN ' against ' || coalesce('bank reference ' || v_ref, '') || CASE WHEN v_ref IS NOT NULL AND v_line IS NOT NULL THEN ' and ' ELSE '' END
                         || coalesce('statement line ' || v_line, '')
                    ELSE '. Reason: ' || v_ref END));
  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'state', v_after.check_state, 'checkedAt', v_after.checked_at,
                            'sentence', CASE p_verdict WHEN 'checked' THEN 'Checked' ELSE 'Rejected' END);
END $$;

-- The payments waiting on a check, oldest first. Finance and the CEO see all
-- of them; a client success manager sees their own clients' (read only).
-- addedBy is the seat that logged it, never an email.
CREATE OR REPLACE FUNCTION public.cockpit_manual_payments_to_check()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_all boolean;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to see the payments waiting on a check.' USING ERRCODE = '42501';
  END IF;
  v_all := coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('finance'), false);
  IF NOT (v_all OR coalesce(public.cockpit_has_role('csm'), false)) THEN
    RAISE EXCEPTION 'Checks waiting need a finance, client success or CEO seat. Ask an admin to add the role.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id,
      'day', p.day,
      'clientName', public.cockpit_manual_mask(coalesce(a.client_name, p.client_name)),
      'taskId', p.clickup_task_id,
      'amount', p.amount,
      'currency', p.currency,
      'amountUsd', p.amount_usd,
      'rail', p.rail,
      'kind', p.kind,
      'reference', nullif(btrim(coalesce(i.reference, p.request_data ->> 'reference', '')), ''),
      'evidenceUrl', i.evidence_url,
      'addedBy', CASE
                   WHEN p.source_deployment = 'billing-inbox' THEN
                     CASE i.source WHEN 'csm' THEN 'Client success' WHEN 'maher' THEN 'Billing agent'
                                   WHEN 'portal' THEN 'Client portal' ELSE 'Billing inbox' END
                   WHEN p.request_id IS NOT NULL THEN 'The CEO'
                   ELSE 'Imported' END,
      'addedAt', p.added_at,
      'daysWaiting', v_today - (p.added_at AT TIME ZONE 'Asia/Kuwait')::date)
      ORDER BY p.added_at, p.id)
    FROM public.cockpit_manual_payments p
    LEFT JOIN public.cockpit_billing_accounts a ON a.clickup_task_id = p.clickup_task_id
    LEFT JOIN public.cockpit_billing_inbox i ON p.source_deployment = 'billing-inbox' AND i.id::text = p.source_id
    WHERE p.check_state = 'logged' AND p.deleted_at IS NULL
      AND (v_all OR coalesce(public.cockpit_client_allowed(coalesce(a.client_name, p.client_name)), false))
  ), '[]'::jsonb);
END $$;

-- ---------------------------------------------------------------------------
-- 9. Checks waiting shows itself (cockpit_form_doors, 20261101l).

SELECT set_config('cockpit.audit_actor', 'migration 20261101n', true);
INSERT INTO public.cockpit_settings (key, value, updated_by)
VALUES ('forms.doors', '{"checks":true}'::jsonb, 'migration 20261101n')
ON CONFLICT (key) DO UPDATE
  SET value = public.cockpit_settings.value || '{"checks":true}'::jsonb,
      updated_by = 'migration 20261101n', updated_at = now()
  WHERE NOT (public.cockpit_settings.value @> '{"checks":true}'::jsonb);
SELECT set_config('cockpit.audit_actor', '', true);

-- ---------------------------------------------------------------------------
-- 10. Grants: every function revoked from all four roles, then the live grant
--     back (11.2-c), the two new doors to signed-in seats, the helpers to none.

REVOKE ALL ON FUNCTION
  public.cockpit_manual_payment_protect(),
  public.cockpit_billing_ingest_inbox(boolean, integer),
  public.cockpit_ceo_manual_payment_add(jsonb, uuid),
  public.cockpit_finish_finance_refresh(uuid, jsonb, text),
  public.cockpit_billing_deal_rails_held(text, text),
  public.cockpit_billing_balances_read(),
  public.cockpit_billing_deal_assignments(),
  public.cockpit_csm_projection_facts(jsonb),
  public.cockpit_csm_projection_refresh_billing(),
  public.cockpit_csm_projection_read(text, text),
  public.cockpit_payment_checked(text, text),
  public.cockpit_payment_row_checked(text),
  public.cockpit_manual_payment_check(text, text, text, text),
  public.cockpit_manual_payments_to_check()
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.cockpit_manual_payment_protect(),
  public.cockpit_billing_ingest_inbox(boolean, integer),
  public.cockpit_finish_finance_refresh(uuid, jsonb, text)
TO service_role;

GRANT EXECUTE ON FUNCTION
  public.cockpit_ceo_manual_payment_add(jsonb, uuid),
  public.cockpit_billing_balances_read(),
  public.cockpit_csm_projection_refresh_billing(),
  public.cockpit_csm_projection_read(text, text),
  public.cockpit_manual_payment_check(text, text, text, text),
  public.cockpit_manual_payments_to_check()
TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
