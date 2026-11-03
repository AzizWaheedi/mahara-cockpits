-- How they pay on the ClickUp card: the canary for method, plan and amount. Creative Triage
-- (bldgtotkfmhoxmlzowdx). Aziz, 2026-11-02: "How they pay should update the ClickUp and client
-- profile card."
--
-- A How they pay save is already queued for the card in the save's own transaction:
-- cockpit_billing_write logs kind method, plan or amount, the trigger (20261102g) queues it, and
-- cockpit_billing_writeback_writes maps it to Payment Method, Payment Plan and Next Payment Amount.
-- clickup-writeback writes it once CLICKUP_WRITEBACK_BILLING_KINDS lists the kind, a secret, not
-- this file. What this file adds is the test card first, as every other billing kind had: the
-- deploy connection's cockpit_billing_canary takes method, plan and amount on 86eywg1cq, each
-- checked as cockpit_billing_write checks it (one of the card's 5 Payment Method options, one of
-- its 5 Payment Plan options, a dollar amount above 0 and up to 100,000 with at most 2 decimals),
-- and never as the cockpit itself (system true stays refused for them).
--
-- Nothing else changes: cockpit_billing_write, the trigger, the write map and the enqueue function
-- already handle the three kinds. The canary stays owner only (revoked from all four roles) and
-- refuses a signed-in caller. Applies twice.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard: the body replaced is the one read live on 2026-11-03 (20261102g's), or this
--    file's own on a second apply.

DO $$
DECLARE v_now text;
BEGIN
  SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
    FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.cockpit_billing_canary(text,jsonb)');
  IF v_now IS NULL OR v_now NOT IN ('c73b594b4589bf2b17f3b55e30025333', 'fe1b9a5e6532c7fea089b30959b19ab4') THEN
    RAISE EXCEPTION 'cockpit_billing_canary(text,jsonb) changed since How they pay read it; stop and re-read it.'
      USING ERRCODE = '55000';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The canary: 20261102g's body, with method, plan and amount.

CREATE OR REPLACE FUNCTION public.cockpit_billing_canary(p_kind text, p_args jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  a jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_task text := coalesce(nullif(btrim(coalesce(a->>'taskId', '')), ''), '86eywg1cq');
  v_system boolean := coalesce(a->'system' = 'true'::jsonb, false);
  v_detail jsonb;
  v_from text;
  v_to text;
  v_id bigint;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'The canary runs only through the deploy connection.' USING ERRCODE = '42501';
  END IF;
  IF v_task <> '86eywg1cq' THEN
    RAISE EXCEPTION 'The canary writes only the test card 86eywg1cq.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_kind, '') NOT IN ('churn', 'extension', 'pause', 'resume', 'mrr', 'late', 'date', 'survey', 'nps_sent', 'ltv', 'win', 'reactivate',
                                  'method', 'plan', 'amount') THEN
    RAISE EXCEPTION 'The canary takes churn, extension, pause, resume, mrr, late, date, survey, nps_sent, ltv, win, reactivate, method, plan or amount.' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'late' AND NOT v_system THEN
    RAISE EXCEPTION 'A late event comes from the cockpit itself: send system true.' USING ERRCODE = '22023';
  END IF;
  -- Waves 3-4 (20261102b): an exit survey comment and NPS Survey Sent come from the cockpit itself.
  IF p_kind IN ('survey', 'nps_sent') AND NOT v_system THEN
    RAISE EXCEPTION 'A survey or NPS sent event comes from the cockpit itself: send system true.' USING ERRCODE = '22023';
  END IF;
  -- Waves 5-6 (20261102g): the morning LTV write comes from the cockpit itself.
  IF p_kind = 'ltv' AND NOT v_system THEN
    RAISE EXCEPTION 'An LTV event comes from the cockpit itself: send system true.' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'ltv' AND coalesce(a->>'to', '') !~ '^[0-9]+(\.[0-9]+)?$' THEN
    RAISE EXCEPTION 'An LTV canary needs the dollar amount in to.' USING ERRCODE = '22023';
  END IF;
  IF v_system AND p_kind NOT IN ('extension', 'late', 'survey', 'nps_sent', 'ltv') THEN
    RAISE EXCEPTION 'Only an extension clear, a late event, a survey, NPS sent or LTV comes from the cockpit itself.' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'nps_sent' AND coalesce(a->>'on', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'An NPS sent canary needs the day in on (YYYY-MM-DD).' USING ERRCODE = '22023';
  END IF;
  v_detail := public.cockpit_billing_detail(p_kind,
    a || jsonb_build_object('seatRole', coalesce(nullif(a->>'seatRole', ''), CASE WHEN v_system THEN 'system' ELSE 'ceo' END)));
  v_from := CASE WHEN p_kind = 'reactivate' THEN coalesce(nullif(a->>'from', ''), 'Stopped') ELSE nullif(a->>'from', '') END;
  v_to := CASE p_kind
    WHEN 'churn' THEN 'Stopped' WHEN 'pause' THEN 'Paused' WHEN 'resume' THEN 'Active'
    WHEN 'extension' THEN CASE WHEN v_system THEN NULL ELSE coalesce(nullif(a->>'newDate', ''), nullif(a->>'to', '')) END
    WHEN 'late' THEN NULL
    WHEN 'survey' THEN NULL WHEN 'nps_sent' THEN NULL
    WHEN 'win' THEN NULL WHEN 'reactivate' THEN nullif(a->>'status', '')
    ELSE nullif(a->>'to', '') END;
  IF p_kind = 'date' AND coalesce(v_to, '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'A date canary needs the new day in to (YYYY-MM-DD).' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'extension' AND NOT v_system AND v_to IS NULL THEN
    RAISE EXCEPTION 'An extension canary needs the new day in newDate (YYYY-MM-DD).' USING ERRCODE = '22023';
  END IF;
  -- How they pay (20261103a): the card's own options and a real payment, as cockpit_billing_write takes them.
  IF p_kind = 'method' AND coalesce(v_to, '') NOT IN ('Card on file', 'Bank transfer', 'Tap link', 'Whop link', 'Check') THEN
    RAISE EXCEPTION 'A method canary needs one of the payment methods on the card in to.' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'plan' AND coalesce(v_to, '') NOT IN ('Monthly', 'Split Pay (2x payments)', 'Paid in full (90 days)',
                                                    '1.0K Start / $2K Months After', 'Performance ($3k/$3k)') THEN
    RAISE EXCEPTION 'A plan canary needs one of the payment plans on the card in to.' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'amount' THEN
    -- The shape first, so the cast below only ever sees a number.
    IF coalesce(v_to, '') !~ '^[0-9]+(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'An amount canary needs a dollar amount above 0 and up to 100000 in to.' USING ERRCODE = '22023';
    END IF;
    IF NOT (v_to::numeric > 0 AND v_to::numeric <= 100000) THEN
      RAISE EXCEPTION 'An amount canary needs a dollar amount above 0 and up to 100000 in to.' USING ERRCODE = '22023';
    END IF;
    -- Written as the real door writes it: 1234.50 is 1234.5.
    v_to := trim_scale(v_to::numeric)::text;
  END IF;
  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (v_task, 'Test card (canary)', p_kind, v_from, v_to,
          coalesce(nullif(a->>'reason', ''), 'Canary on the test card'), v_detail,
          CASE WHEN v_system THEN 'system' ELSE 'ceo' END, 'canary')
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

COMMENT ON FUNCTION public.cockpit_billing_canary(text, jsonb) IS
  'Owner only, the deploy connection''s canary: inserts one billing event on the test card 86eywg1cq (never another card), its detail built by cockpit_billing_detail to the keys the real doors write. Since 20261103a it also takes How they pay (method, plan, amount), checked as cockpit_billing_write checks them. Never used by a screen.';

-- ---------------------------------------------------------------------------
-- 2. Grants: as 20261102g left them, owner only.

REVOKE ALL ON FUNCTION public.cockpit_billing_canary(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
