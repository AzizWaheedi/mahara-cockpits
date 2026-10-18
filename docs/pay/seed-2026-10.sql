-- Pay plans seed, October 2026 (docs/pay/PAY-PLANS.md section 2; go-live
-- order section 11 step 3).
--
-- Run as postgres, once, after 20261018c, 20261018a and 20261018b are
-- applied and read back. Safe to run twice: the same role and month replace
-- the plan (pay.planFix) and the confirmation is an upsert.
--
-- It acts as the CEO: the CEO's seat is looked up, the JWT claims are set for
-- this transaction only and the role is switched to authenticated, so every
-- write goes through cockpit_ceo_pay_plan_save and cockpit_ceo_pay_confirm,
-- with their checks and an audit row each. Nothing is written straight into a
-- table.
--
-- People are found by role when it runs; no name or id is written here.
--
-- Not in this file, on purpose: moving the two call centre agents' commission
-- lines to per_client_appt_shown and per_client_deal_closed. That waits for
-- the web bundle that knows the new bases (section 11 step 5); the statement
-- is at the end, commented out.

BEGIN;

DO $$
DECLARE
  v_ceo_email text:='aziz@maharamedia.com';
  v_uid uuid;
  v_csm bigint;
  v_n int;
  r text;
  v_from text:='2026-10-01';
  v_note text:='Seeded from docs/pay/PAY-PLANS.md section 2 (the CEO, 2026-10-18).';
  plans jsonb:=$json${
    "Media buyer": {"version":1,"parts":[
      {"key":"cpl_bonus","kind":"band","label":"Bonus by cost per lead","metric":"cpl","covers":"all_clients",
       "bands":[{"upTo":8,"inclusive":false,"amount":400},{"upTo":10,"inclusive":false,"amount":300},
                {"upTo":13,"inclusive":false,"amount":200},{"upTo":15,"inclusive":true,"amount":100},
                {"upTo":null,"amount":0}]}]},
    "Creative strategist": {"version":1,"parts":[
      {"key":"churn_bonus","kind":"band","label":"Bonus by last month's churn","metric":"logo_churn_prior",
       "bands":[{"upTo":5,"inclusive":false,"amount":1200},{"upTo":8,"inclusive":false,"amount":700},
                {"upTo":10,"inclusive":false,"amount":300},{"upTo":12,"inclusive":true,"amount":150},
                {"upTo":null,"amount":0}]},
      {"key":"cpl_bonus","kind":"band","label":"Bonus by cost per lead","metric":"cpl","covers":"owned_creative",
       "guard":{"minClients":5,"minSpendUsd":500,"excludeDays":14},
       "bands":[{"upTo":10,"inclusive":false,"amount":300},{"upTo":13,"inclusive":false,"amount":200},
                {"upTo":15,"inclusive":false,"amount":100},{"upTo":null,"amount":0}]},
      {"key":"smm","kind":"share","label":"Social media management commission","of":"smm_revenue",
       "steps":[{"fromMonth":1,"rate":0},{"fromMonth":2,"rate":0.10},{"fromMonth":7,"rate":0.05}],
       "ends":{"onCancel":true},"prorateOnCancel":true}]},
    "Client success manager": {"version":1,"parts":[
      {"key":"over_20","kind":"per_above","label":"Per qualifying client over 20","measure":"qualifying_clients","over":20,"amount":50},
      {"key":"ramp","kind":"floor","label":"Ramp guarantee","amount":1200,"days":60},
      {"key":"retention","kind":"band","label":"Retention bonus by churn","metric":"csm_churn",
       "bands":[{"upTo":0,"inclusive":true,"amount":2000},{"upTo":5,"inclusive":false,"amount":1500},
                {"upTo":9,"inclusive":false,"amount":1000},{"upTo":11,"inclusive":false,"amount":500},
                {"upTo":13,"inclusive":false,"amount":250},{"upTo":15,"inclusive":true,"amount":0},
                {"upTo":null,"amount":-250}]},
      {"key":"renewals","kind":"per_event","label":"Renewals","event":"renewal","amount":300},
      {"key":"reactivations","kind":"per_event","label":"Reactivations","event":"reactivation","amount":300},
      {"key":"upsells","kind":"share","label":"Backend upsells","of":"upsell_cash","steps":[{"fromMonth":1,"rate":0.10}]},
      {"key":"recurring","kind":"share","label":"Recurring services","of":"recurring_revenue",
       "steps":[{"fromMonth":1,"rate":0.20},{"fromMonth":2,"rate":0.05}],"ends":{"onCancel":true,"lapseDays":30}},
      {"key":"referrals","kind":"per_event","label":"Referrals","event":"referral","amount":250},
      {"key":"video_testimonials","kind":"per_event","label":"Video testimonials","event":"video_testimonial","amount":150},
      {"key":"google_reviews","kind":"per_event","label":"Google reviews","event":"google_review","amount":75},
      {"key":"podcasts","kind":"per_event","label":"Podcast case studies","event":"podcast_case_study","amount":250}]},
    "Systems manager": {"version":1,"parts":[
      {"key":"systems","kind":"per_event","label":"Fully built-out systems","event":"system_built","amount":200},
      {"key":"systems_large","kind":"per_event","label":"Huge built-out systems","event":"system_built_large","amount":400}]},
    "Call centre agent": {"version":1,"parts":[],
      "commission":[{"basis":"per_client_appt_shown","rate":5},{"basis":"per_client_deal_closed","rate":20}]},
    "Closer": {"version":1,"parts":[
      {"key":"pif","kind":"per_event","label":"Paid-in-full bonus","event":"pif_deal_closed","amount":250}],
      "commission":[{"basis":"closed_cash","rate":0.10},{"basis":"set_cash","rate":0.05}]}
  }$json$::jsonb;
BEGIN
  SELECT m.auth_user_id INTO v_uid FROM public.cockpit_members m
    WHERE m.email=v_ceo_email AND m.active AND m.auth_user_id IS NOT NULL;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'The CEO''s seat was not found; nothing seeded'; END IF;

  -- The client success manager, by role: exactly one working person.
  SELECT count(*) INTO v_n FROM public.cockpit_people p
    WHERE lower(btrim(p.role))='client success manager' AND p.active AND p.engagement<>'bot';
  IF v_n<>1 THEN RAISE EXCEPTION 'Expected one client success manager on the roster, found %; nothing seeded', v_n; END IF;
  SELECT p.id INTO v_csm FROM public.cockpit_people p
    WHERE lower(btrim(p.role))='client success manager' AND p.active AND p.engagement<>'bot';

  -- A role plan nobody holds is still saved; say so.
  FOR r IN SELECT jsonb_object_keys(plans) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.cockpit_people p WHERE lower(btrim(p.role))=lower(r) AND p.active AND p.engagement<>'bot') THEN
      RAISE NOTICE 'Nobody on the roster has the role "%" today; its plan is saved anyway', r;
    END IF;
  END LOOP;

  -- Act as the CEO for the rest of this transaction.
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_uid,'role','authenticated','email',v_ceo_email)::text, true);
  SET LOCAL ROLE authenticated;

  FOR r IN SELECT jsonb_object_keys(plans) ORDER BY 1 LOOP
    PERFORM public.cockpit_ceo_pay_plan_save(jsonb_build_object('role',r,'fromMonth',v_from,'plan',plans->r,'note',v_note));
  END LOOP;
  PERFORM public.cockpit_ceo_pay_confirm(jsonb_build_object('month',v_from,'key','ramp_start:'||v_csm,
    'value',jsonb_build_object('day','2026-10-02'),'note','The contract start (PAY-PLANS.md decision 11).'));

  RESET ROLE;
END $$;

COMMIT;

-- Read back (as postgres): six role plans from October and the ramp start.
SELECT pl.id, pl.role, pl.from_month, jsonb_array_length(pl.plan->'parts') AS parts,
       coalesce(jsonb_array_length(pl.plan->'commission'),0) AS commission_lines, pl.set_by
  FROM public.cockpit_pay_plans pl WHERE pl.role IS NOT NULL AND pl.from_month='2026-10-01' ORDER BY pl.role;
SELECT c.month, c.key, c.value, c.set_by FROM public.cockpit_pay_confirmations c WHERE c.key LIKE 'ramp_start:%';

-- Section 11 step 5, only after the live bundle check and a reload of the
-- installed app (run as the CEO the same way as above, inside a DO block):
--
--   FOR v_id IN SELECT p.id FROM public.cockpit_people p
--       WHERE lower(btrim(p.role))='call centre agent' AND p.active AND p.engagement<>'bot' LOOP
--     PERFORM public.cockpit_ceo_people_save(jsonb_build_object('id',v_id,
--       'commissionBasis','per_client_appt_shown','commissionRate',5,
--       'commission2Basis','per_client_deal_closed','commission2Rate',20));
--   END LOOP;
