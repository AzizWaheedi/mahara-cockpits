-- Creative Triage: additive Ecom logging and bank-settlement classifications.
-- No client payment rows are rewritten. Preserve the live body of each RPC.
BEGIN;
ALTER TABLE public.cockpit_bank_lines DROP CONSTRAINT IF EXISTS cockpit_bank_lines_kind_check;
ALTER TABLE public.cockpit_bank_lines ADD CONSTRAINT cockpit_bank_lines_kind_check CHECK (kind IN
  ('client_payment','whop_payout','whop_topup','tap_settlement','ecom_settlement','own_transfer','refund_in','expense','fee','excluded','unknown'));
ALTER TABLE public.cockpit_payment_ties DROP CONSTRAINT IF EXISTS cockpit_payment_ties_payment_id_check;
ALTER TABLE public.cockpit_payment_ties ADD CONSTRAINT cockpit_payment_ties_payment_id_check
  CHECK (payment_id ~ '^(whop|tap|ecom|transfer|bank|manual):[A-Za-z0-9_.-]+$');
ALTER TABLE public.cockpit_manual_payments DROP CONSTRAINT IF EXISTS cockpit_manual_payments_rail_check;
ALTER TABLE public.cockpit_manual_payments ADD CONSTRAINT cockpit_manual_payments_rail_check
  CHECK (rail IN ('bank_transfer','cheque','cash','tap','ecom','other'));
-- The guarded RPCs also validate strings independently of the table checks.
DO $body$
DECLARE fn text; name text; changed text;
BEGIN
  FOREACH name IN ARRAY ARRAY['cockpit_ceo_action','cockpit_ceo_payment_tie','cockpit_ceo_manual_payment_add','cockpit_billing_write'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=name ORDER BY p.oid DESC LIMIT 1;
    IF fn IS NULL THEN CONTINUE; END IF;
    changed := fn;
    IF name='cockpit_ceo_action' THEN
      changed := replace(changed,'''tap_settlement'',''own_transfer''','''tap_settlement'',''ecom_settlement'',''own_transfer''');
    ELSIF name='cockpit_ceo_payment_tie' THEN
      changed := replace(changed,'whop|tap|transfer|bank|manual','whop|tap|ecom|transfer|bank|manual');
      changed := replace(changed,
        'AND NOT (v_payment LIKE ''tap:%''',
        'AND NOT (v_payment LIKE ''ecom:%'' AND EXISTS(SELECT 1 FROM public.cockpit_ecom_invoices i WHERE i.id=substr(v_payment,6) AND i.status=''PAID'')) AND NOT (v_payment LIKE ''tap:%''');
    ELSE
      changed := replace(changed,'''tap'', ''other''','''tap'', ''ecom'', ''other''');
      changed := replace(changed,'''tap'',''other''','''tap'',''ecom'',''other''');
    END IF;
    IF changed <> fn THEN EXECUTE changed; END IF;
  END LOOP;
END;
$body$;
COMMIT;
