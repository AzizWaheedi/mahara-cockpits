-- Pending payments: a payment the CEO leaves out of program money (S7)
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive. Needs 20261023x and
-- 20261023y (both live since 23 Oct). Plan: hw-notes/billing-pending/PLAN.md
-- and hw-notes/outsiders/WRITE-PLAN.md section 5, step S7.
--
-- The CEO, 23 Oct 2026: one of Castello's two $1,500 payments "was the
-- website payment", not program money. Both are Whop payments of 21 Aug on
-- the same product and plan, 26 minutes apart; the lead session chose
-- whop:pay_fjRE96EdeUqfmO (10:44 Kuwait). CEO tie 3 (19 Oct) credits both to
-- the closer as front end, and a "not client money" tie would take that
-- credit away, so the mark lives here and only Pending payments reads it.
--
-- What it adds:
--   cockpit_billing_payment_exclusions
--                          the CEO's word that a payment a client's deal holds
--                          was not program money (reason website or other,
--                          with a note). Append-only: withdrawn once
--                          (withdrawn_* set together), never edited or
--                          deleted; one live row per payment. Row security on,
--                          no policy, the service key the only door. A mark
--                          counts only on the deal it was set on: if Money
--                          ties the payment to another deal later, it counts
--                          there, and if Money unties it, it is the CEO's
--                          Possible money again.
--   cockpit_billing_deal_rails_held(text,text)
--                          the payments a deal holds, as cockpit_billing_deal_rails
--                          counted them until now (its 20261023x body, unchanged).
--   cockpit_billing_deal_rails(text,text)
--                          those payments less the live exclusions set on that
--                          deal, so the read, the confirm cap and a
--                          confirmation's proof never count an excluded
--                          payment. Same signature and return.
--   cockpit_billing_balances_read()
--                          also returns `exclusions` (each on the deal it was
--                          set on, while that deal holds the payment, with the
--                          payment's day, dollars and rail; the note for the
--                          CEO only). The untied list is 20261023x's.
--   cockpit_billing_balance_write()
--                          gains `exclude` {taskId, dealResponseId, paymentId,
--                          reason: website|other, note?, source?} and
--                          `unexclude` {paymentId, reason}, CEO only. Each writes
--                          its row, one cockpit_billing_events row (kind exclude
--                          or unexclude) and one cockpit_audit_log row
--                          (billing.exclude, billing.unexclude) in one
--                          transaction, and nothing else: never a payment, a tie,
--                          the ledger, cash, LTV, pay or ClickUp. Exclude takes
--                          only a payment the card's newest deal (or its card)
--                          already holds, on a card on the CEO's list, and
--                          refuses a payment already left out on that deal. A
--                          live mark on another deal (which no listed row can
--                          show while this deal holds the payment) is withdrawn
--                          in the same transaction, with its own unexclude
--                          event and audit row, before the new one is written.
--   cockpit_billing_events_kind_check gains exclude, unexclude (rebuilt from the
--                          live list, as 20261023x did); the restrictive browser
--                          policy cockpit_billing_events_balance_kinds covers them.
--   One seed row: whop:pay_fjRE96EdeUqfmO on Castello Industries (card
--                          86eynfnv5, deal r6zgixh2u6paruulr6zgi2w9lckol261),
--                          reason website, set by aziz@maharamedia.com, with its
--                          event row and audit row. Refused if that payment is
--                          no longer one the deal holds; written once, never
--                          again (a row for the payment, live or withdrawn,
--                          means it was already written).
--
-- Expected after (rule on the 23 Oct read, after the WRITE-PLAN section 5 ties):
-- Castello reads $2,000 not seen on Month 2 of 3, and Later parts $11,532.
--
-- The three replaced bodies are the live ones (prosrc md5, read with
-- pg_get_functiondef on 24 Oct 2026; equal to 20261023x and 20261023y):
--   cockpit_billing_balance_write  099eae83a8d3f34a7a492238d9b91d37
--   cockpit_billing_balances_read  341e38368df44dae7423b164aeb994b6
--   cockpit_billing_deal_rails     31ccd44305e128b29dc899c3cb06c641
-- The file refuses, and changes nothing, if a live body is neither that one
-- nor this file's, so a change made since is never overwritten. Owners and
-- grants are kept (the read and the write: EXECUTE for authenticated only;
-- the helpers: the owner only) and restated. Safe to run twice.
-- Test: apps/media-buyer-cockpit/scripts/billing-balances-supabase.test.ts.
-- Rollback: run 20261023y, then 20261023x (both safe to run twice; their
-- bodies are the live ones this file replaces). x also puts the billing log's
-- restrictive policy back to its four kinds, but the exclude and unexclude
-- rows stay (append-only) and every seat could then read their dollars, rail,
-- deal and the CEO's reason, so put the six-kind policy back by hand: re-run
-- this file's section 2 policy statement (DROP POLICY IF EXISTS
-- cockpit_billing_events_balance_kinds, then its CREATE POLICY naming confirm,
-- unconfirm, link, unlink, exclude and unexclude). Then DROP FUNCTION
-- public.cockpit_billing_deal_rails_held(text, text). The table and its rows
-- are kept (append-only); with the old bodies nothing reads them.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_billing_balance_write(text,jsonb)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('099eae83a8d3f34a7a492238d9b91d37', '6aef5c5dafe1446ef29ede0b70fd5119') THEN
    RAISE EXCEPTION 'cockpit_billing_balance_write is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_billing_balances_read()');
  IF v_md5 IS NULL OR v_md5 NOT IN ('341e38368df44dae7423b164aeb994b6', '5fa83dfe5a7c86abc445214a282879a6') THEN
    RAISE EXCEPTION 'cockpit_billing_balances_read is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_billing_deal_rails(text,text)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('31ccd44305e128b29dc899c3cb06c641', '22c452bb63a69f71d4d20d6a60693c7e') THEN
    RAISE EXCEPTION 'cockpit_billing_deal_rails is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_billing_deal_rails_held(text,text)');
  IF v_md5 IS NOT NULL AND v_md5 <> '31ccd44305e128b29dc899c3cb06c641' THEN
    RAISE EXCEPTION 'cockpit_billing_deal_rails_held is not the definition this file writes (prosrc md5 %). Re-read the live definition and rebase this file', v_md5;
  END IF;
END $guard$;

-- ---------------------------------------------------------------------------
-- 1. The table

CREATE TABLE IF NOT EXISTS public.cockpit_billing_payment_exclusions (
  id               bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  /** A rail payment id as the ledger holds it (whop:pay_..., tap:chg_..., manual:...). */
  payment_id       text NOT NULL CHECK (payment_id ~ '^[a-z_]{2,20}:[A-Za-z0-9_.:-]{1,200}$'),
  /** The card and its newest deal that held the payment when the CEO left it out. */
  clickup_task_id  text NOT NULL CHECK (clickup_task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  deal_response_id text NOT NULL CHECK (deal_response_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  /** website: the client's website, sold beside the program. other: the note says what. */
  reason           text NOT NULL CHECK (reason IN ('website', 'other')),
  note             text CHECK (note IS NULL OR length(note) <= 500),
  set_by           text NOT NULL,
  set_at           timestamptz NOT NULL DEFAULT now(),
  event_id         bigint,
  withdrawn_by     text,
  withdrawn_at     timestamptz,
  withdrawn_reason text CHECK (withdrawn_reason IS NULL OR length(withdrawn_reason) BETWEEN 3 AND 300),
  CONSTRAINT cockpit_billing_payment_exclusions_other_says_what CHECK (reason <> 'other' OR length(btrim(coalesce(note, ''))) >= 3),
  CONSTRAINT cockpit_billing_payment_exclusions_withdrawn_set CHECK (num_nonnulls(withdrawn_by, withdrawn_at, withdrawn_reason) IN (0, 3))
);
COMMENT ON TABLE public.cockpit_billing_payment_exclusions IS
  'The CEO''s word that a rail payment a client''s deal holds was not program money (Pending payments, 24 Oct 2026): cockpit_billing_deal_rails stops counting it on the deal it was set on, so it never fills a part of that plan. It changes nothing else: not the money refresh, a tie, cash, LTV or pay. Written only by cockpit_billing_balance_write (exclude, unexclude) and the 20261024p seed; withdrawn once, never edited or deleted.';
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_billing_payment_exclusions_live
  ON public.cockpit_billing_payment_exclusions (payment_id) WHERE withdrawn_at IS NULL;

-- Never deleted or truncated; an update only withdraws, once (20261023x's guards).
DROP TRIGGER IF EXISTS cockpit_billing_payment_exclusions_guard_delete ON public.cockpit_billing_payment_exclusions;
CREATE TRIGGER cockpit_billing_payment_exclusions_guard_delete BEFORE DELETE ON public.cockpit_billing_payment_exclusions
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_hours_refuse_delete();
DROP TRIGGER IF EXISTS cockpit_billing_payment_exclusions_guard_truncate ON public.cockpit_billing_payment_exclusions;
CREATE TRIGGER cockpit_billing_payment_exclusions_guard_truncate BEFORE TRUNCATE ON public.cockpit_billing_payment_exclusions
  FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_hours_refuse_delete();
DROP TRIGGER IF EXISTS cockpit_billing_payment_exclusions_lock ON public.cockpit_billing_payment_exclusions;
CREATE TRIGGER cockpit_billing_payment_exclusions_lock BEFORE UPDATE ON public.cockpit_billing_payment_exclusions
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_billing_balance_row_lock('withdrawn_by', 'withdrawn_at', 'withdrawn_reason');

-- Row security on, no browser policy, the service key the only door.
ALTER TABLE public.cockpit_billing_payment_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_billing_payment_exclusions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_billing_payment_exclusions TO service_role;
REVOKE ALL ON SEQUENCE public.cockpit_billing_payment_exclusions_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The billing log: two more kinds, read only by the seats that read pending payments

DROP POLICY IF EXISTS cockpit_billing_events_balance_kinds ON public.cockpit_billing_events;
CREATE POLICY cockpit_billing_events_balance_kinds ON public.cockpit_billing_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (kind NOT IN ('confirm', 'unconfirm', 'link', 'unlink', 'exclude', 'unexclude')
         OR (SELECT public.cockpit_is_ceo())
         OR (SELECT public.cockpit_has_role('csm'))
         OR (SELECT public.cockpit_has_role('finance')));

-- Built from the constraint as it stands when this runs (as 20261023x does),
-- so a kind another build added is kept.
DO $kinds$
DECLARE
  v_def text;
  v_live text[];
  v_kinds text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.cockpit_billing_events'::regclass AND c.conname = 'cockpit_billing_events_kind_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'cockpit_billing_events has no cockpit_billing_events_kind_check; read the live table before applying 20261024p.';
  END IF;
  IF v_def !~* '^CHECK \(+kind ' THEN
    RAISE EXCEPTION 'cockpit_billing_events_kind_check is not a list of kinds (%); read it before applying 20261024p.', v_def;
  END IF;
  SELECT coalesce(array_agg(DISTINCT m[1]), '{}'::text[]) INTO v_live
  FROM regexp_matches(v_def, '''([a-z_]+)''', 'g') AS m;
  IF cardinality(v_live) = 0 THEN
    RAISE EXCEPTION 'No kind could be read from cockpit_billing_events_kind_check (%); read it before applying 20261024p.', v_def;
  END IF;
  SELECT array_agg(DISTINCT k ORDER BY k) INTO v_kinds FROM unnest(v_live || ARRAY['exclude', 'unexclude']) AS k;
  ALTER TABLE public.cockpit_billing_events DROP CONSTRAINT cockpit_billing_events_kind_check;
  EXECUTE format(
    'ALTER TABLE public.cockpit_billing_events ADD CONSTRAINT cockpit_billing_events_kind_check CHECK (kind IN (%s))',
    (SELECT string_agg(quote_literal(k), ', ' ORDER BY k) FROM unnest(v_kinds) AS k));
END
$kinds$;

-- ---------------------------------------------------------------------------
-- 3. The rails

-- The payments a deal holds (PLAN 1.2 "Rails"), before any exclusion: the deal
-- ledger's active rows, any day; and the card's own active payments, any side,
-- from seven days before signing, that no other deal's ledger holds. Each
-- payment once. The body is 20261023x's cockpit_billing_deal_rails, unchanged.
CREATE OR REPLACE FUNCTION public.cockpit_billing_deal_rails_held(p_deal text, p_task text)
RETURNS TABLE(payment_id text, day date, usd numeric, rail text, from_ledger boolean, kind text, recorded_at timestamptz)
LANGUAGE sql STABLE SET search_path='' AS $$
  WITH d AS (
    SELECT (s.submitted_at AT TIME ZONE 'Asia/Kuwait')::date AS signed
    FROM public.cockpit_sales_deals s WHERE s.response_id = p_deal AND s.submitted_at IS NOT NULL
  ),
  ledger AS (
    SELECT dp.payment_id, dp.day, dp.usd, dp.rail, true AS from_ledger, dp.kind, dp.recorded_at
    FROM public.cockpit_deal_payments dp
    WHERE dp.deal_response_id = p_deal AND dp.active
  ),
  card AS (
    SELECT cp.payment_id, cp.day, cp.usd, cp.rail, false AS from_ledger, cp.kind, cp.recorded_at
    FROM public.cockpit_client_payments cp CROSS JOIN d
    WHERE p_task IS NOT NULL AND cp.clickup_task_id = p_task AND cp.active AND cp.day >= d.signed - 7
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_deal_payments o
                      WHERE o.payment_id = cp.payment_id AND o.active AND o.deal_response_id <> p_deal)
      AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.payment_id = cp.payment_id)
  )
  SELECT * FROM ledger
  UNION ALL
  SELECT * FROM card
$$;

-- The payments that count for a deal: what it holds, less the payments the CEO
-- left out of program money on this deal.
CREATE OR REPLACE FUNCTION public.cockpit_billing_deal_rails(p_deal text, p_task text)
RETURNS TABLE(payment_id text, day date, usd numeric, rail text, from_ledger boolean, kind text, recorded_at timestamptz)
LANGUAGE sql STABLE SET search_path='' AS $$
  -- What the deal holds (cockpit_billing_deal_rails_held), less every payment
  -- the CEO left out of program money on this deal (a live
  -- cockpit_billing_payment_exclusions row naming it). A mark counts only on
  -- the deal it was set on: a payment Money ties to another deal later counts
  -- there. The read, the confirm cap and a confirmation's proof all count these.
  SELECT h.payment_id, h.day, h.usd, h.rail, h.from_ledger, h.kind, h.recorded_at
  FROM public.cockpit_billing_deal_rails_held(p_deal, p_task) h
  WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_billing_payment_exclusions x
                    WHERE x.payment_id = h.payment_id AND x.deal_response_id = p_deal AND x.withdrawn_at IS NULL)
$$;

REVOKE ALL ON FUNCTION
  public.cockpit_billing_deal_rails_held(text, text),
  public.cockpit_billing_deal_rails(text, text)
FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The read: 20261023x's, plus the exclusions

CREATE OR REPLACE FUNCTION public.cockpit_billing_balances_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
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
      'day', h.day, 'usd', h.usd, 'rail', h.rail, 'reason', x.reason,
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
        'day', h.day, 'usd', h.usd, 'rail', h.rail, 'reason', x.reason,
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
END $$;
COMMENT ON FUNCTION public.cockpit_billing_balances_read() IS
  'Pending payments (23 Oct 2026; exclusions 24 Oct): the rows src/lib/billingBalances.ts turns into parts and figures. CEO, client success or finance seat; a non-CEO seat gets only the cards cockpit_client_allowed lets through, and never untied money, deals with no card, Back with sales, contact names or an exclusion''s note. Rails never carry a payment the CEO left out of program money on their deal; exclusions lists each such payment on the deal it was set on, while that deal holds it. Reads only.';

REVOKE ALL ON FUNCTION public.cockpit_billing_balances_read() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_billing_balances_read() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. The write: 20261023y's, plus exclude and unexclude

CREATE OR REPLACE FUNCTION public.cockpit_billing_balance_write(p_action text, p_args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_who text;
  v_ceo boolean;
  v_source text;
  v_app text;
  v_task text;
  v_acc public.cockpit_billing_accounts;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_deal_id text;
  v_deal public.cockpit_sales_deals;
  v_card_deal text;
  v_signed date;
  v_part text;
  v_part_no integer;
  v_amount numeric;
  v_currency text;
  v_usd numeric;
  v_rail text;
  v_day date;
  v_floor date;
  v_evidence text;
  v_note text;
  v_reason text;
  v_problem text;
  v_rails numeric;
  v_rails_as_of timestamptz;
  v_live numeric;
  v_left numeric;
  v_id bigint;
  v_event bigint;
  v_conf public.cockpit_billing_confirmations;
  v_before public.cockpit_billing_confirmations;
  v_link public.cockpit_billing_deal_links;
  v_link_before public.cockpit_billing_deal_links;
  v_assigned record;
  v_card_signed timestamptz;
  v_rail_name text;
  v_c public.cockpit_billing_confirmations;
  v_pid text;
  v_used text[] := '{}'::text[];
  v_payment text;
  v_why text;
  v_held record;
  v_excl public.cockpit_billing_payment_exclusions;
  v_excl_before public.cockpit_billing_payment_exclusions;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in before changing billing.' USING ERRCODE = '42501'; END IF;
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT (v_ceo OR coalesce(public.cockpit_has_role('csm'), false) OR coalesce(public.cockpit_has_role('finance'), false)) THEN
    RAISE EXCEPTION 'Billing changes need a client success, finance or CEO seat. Ask an admin to add the role.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(au.email)) INTO v_who FROM auth.users au WHERE au.id = v_uid;
  IF v_who IS NULL OR v_who = '' THEN RAISE EXCEPTION 'Sign in before changing billing.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR octet_length(p_args::text) > 20000 THEN
    RAISE EXCEPTION 'That billing change could not be read. Reload the page and try again.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_action, '') NOT IN ('confirm', 'withdraw', 'link', 'unlink', 'exclude', 'unexclude') THEN
    RAISE EXCEPTION 'That is not a pending payments action.' USING ERRCODE = '22023';
  END IF;
  v_source := coalesce(nullif(p_args ->> 'source', ''), CASE WHEN v_ceo THEN 'ceo' ELSE 'csm' END);
  IF v_source NOT IN ('ceo', 'csm') THEN RAISE EXCEPTION 'That billing change came from an unknown cockpit.' USING ERRCODE = '22023'; END IF;
  IF v_source = 'ceo' AND NOT v_ceo THEN
    RAISE EXCEPTION 'Only the CEO can make a change from the CEO cockpit.' USING ERRCODE = '42501';
  END IF;
  IF p_action IN ('link', 'unlink') AND NOT v_ceo THEN
    RAISE EXCEPTION 'Only the CEO can link a signed deal to a client card.' USING ERRCODE = '42501';
  END IF;
  IF p_action IN ('exclude', 'unexclude') AND NOT v_ceo THEN
    RAISE EXCEPTION 'Only the CEO can leave a payment out of program money.' USING ERRCODE = '42501';
  END IF;
  v_app := CASE v_source WHEN 'ceo' THEN 'media-buyer-cockpit' ELSE 'client-success-cockpit' END;

  -- ---------------------------------------------------------------------------
  -- unlink: needs no card id from the request; the live link names it.
  IF p_action = 'unlink' THEN
    v_deal_id := btrim(coalesce(p_args ->> 'dealResponseId', ''));
    IF v_deal_id !~ '^[A-Za-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'That is not a signed deal id.' USING ERRCODE = '22023'; END IF;
    v_reason := public.cockpit_manual_clean_text(p_args ->> 'reason', 300);
    IF coalesce(length(v_reason), 0) < 3 THEN RAISE EXCEPTION 'Say why in 3 to 300 characters.' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_link_before FROM public.cockpit_billing_deal_links l
     WHERE l.deal_response_id = v_deal_id AND l.cleared_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That deal is not linked to a card. Reload the page.' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO v_acc FROM public.cockpit_billing_accounts WHERE clickup_task_id = v_link_before.clickup_task_id FOR UPDATE;
    UPDATE public.cockpit_billing_deal_links SET cleared_by = v_who, cleared_at = now(), cleared_reason = v_reason
     WHERE id = v_link_before.id RETURNING * INTO v_link;
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_link.clickup_task_id, coalesce(v_acc.client_name, v_link.clickup_task_id), 'unlink', v_deal_id, NULL, v_reason,
            jsonb_build_object('linkId', v_link.id, 'dealResponseId', v_deal_id), v_source, v_who)
    RETURNING id INTO v_event;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.unlink', 'cockpit_billing_deal_links', v_link.id::text, v_who, v_app, 'supabase',
            to_jsonb(v_link_before), to_jsonb(v_link), jsonb_build_object('event_id', v_event));
    RETURN jsonb_build_object('ok', true,
      'sentence', format('Unlinked from %s.', coalesce(v_acc.client_name, 'the card')),
      'link', jsonb_build_object('id', v_link.id, 'dealResponseId', v_link.deal_response_id, 'taskId', v_link.clickup_task_id,
                                 'clearedAt', v_link.cleared_at));
  END IF;

  -- ---------------------------------------------------------------------------
  -- unexclude (20261024p): needs no card id from the request; the live
  -- exclusion names it. The payment counts as program money again.
  IF p_action = 'unexclude' THEN
    v_payment := btrim(coalesce(p_args ->> 'paymentId', ''));
    IF v_payment !~ '^[a-z_]{2,20}:[A-Za-z0-9_.:-]{1,200}$' THEN RAISE EXCEPTION 'That is not a payment id.' USING ERRCODE = '22023'; END IF;
    v_reason := public.cockpit_manual_clean_text(p_args ->> 'reason', 300);
    IF coalesce(length(v_reason), 0) < 3 THEN RAISE EXCEPTION 'Say why in 3 to 300 characters.' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_excl_before FROM public.cockpit_billing_payment_exclusions x
     WHERE x.payment_id = v_payment AND x.withdrawn_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That payment already counts as program money. Reload the page.' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO v_acc FROM public.cockpit_billing_accounts WHERE clickup_task_id = v_excl_before.clickup_task_id FOR UPDATE;
    UPDATE public.cockpit_billing_payment_exclusions SET withdrawn_by = v_who, withdrawn_at = now(), withdrawn_reason = v_reason
     WHERE id = v_excl_before.id RETURNING * INTO v_excl;
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_excl.clickup_task_id, coalesce(v_acc.client_name, v_excl.clickup_task_id), 'unexclude', v_payment, NULL, v_reason,
            jsonb_build_object('exclusionId', v_excl.id, 'paymentId', v_payment, 'dealResponseId', v_excl.deal_response_id),
            v_source, v_who)
    RETURNING id INTO v_event;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.unexclude', 'cockpit_billing_payment_exclusions', v_excl.id::text, v_who, v_app, 'supabase',
            to_jsonb(v_excl_before), to_jsonb(v_excl), jsonb_build_object('event_id', v_event, 'payment_id', v_payment));
    RETURN jsonb_build_object('ok', true, 'sentence', 'Counted as program money again.',
      'exclusion', jsonb_build_object('id', v_excl.id, 'paymentId', v_excl.payment_id, 'withdrawnAt', v_excl.withdrawn_at));
  END IF;

  -- Every other action names a card.
  v_task := btrim(coalesce(p_args ->> 'taskId', ''));
  IF v_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN RAISE EXCEPTION 'That is not a ClickUp card id.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_acc FROM public.cockpit_billing_accounts WHERE clickup_task_id = v_task FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That client card is not on the billing sheet. Refresh the page and pick it again.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_ceo AND NOT coalesce(public.cockpit_client_allowed(v_acc.client_name), false) THEN
    RAISE EXCEPTION '% is not one of your clients in the portal, so its billing is not yours to change.', v_acc.client_name USING ERRCODE = '42501';
  END IF;

  -- ---------------------------------------------------------------------------
  IF p_action = 'link' THEN
    v_deal_id := btrim(coalesce(p_args ->> 'dealResponseId', ''));
    IF v_deal_id !~ '^[A-Za-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'That is not a signed deal id.' USING ERRCODE = '22023'; END IF;
    v_note := public.cockpit_manual_clean_text(p_args ->> 'note', 500);
    -- One link at a time: two CEO tabs linking the same deal wait for each other.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_billing_deal_links:' || v_deal_id, 0));
    SELECT * INTO v_assigned FROM public.cockpit_billing_deal_assignments() x WHERE x.deal_response_id = v_deal_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That is not a live signed deal (voided, a test, or not mirrored yet).' USING ERRCODE = 'P0002';
    END IF;
    IF v_assigned.link_id IS NOT NULL THEN
      RAISE EXCEPTION 'That deal is already linked to a card. Unlink it first.' USING ERRCODE = '22023';
    END IF;
    IF v_assigned.clickup_task_id IS NOT NULL THEN
      RAISE EXCEPTION 'That deal already matches % by its %. If that is wrong, tie its payments on Money instead.',
        coalesce((SELECT a.client_name FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = v_assigned.clickup_task_id), 'a card'),
        CASE v_assigned.matched_by WHEN 'ledger' THEN 'payments' WHEN 'alias' THEN 'alias' ELSE 'name' END
        USING ERRCODE = '22023';
    END IF;
    -- The card has to be one the CEO sees on the list, and the deal has to
    -- become its deal: a link to a gone card, or to a card whose own deal is
    -- as new or newer, would take the deal off the no-card group and put it
    -- on no row.
    IF NOT public.cockpit_billing_card_listed(v_task, true) THEN
      RAISE EXCEPTION '% is not on the pending payments list. Link the deal to a client who is.', v_acc.client_name USING ERRCODE = '22023';
    END IF;
    SELECT x.signed_at INTO v_card_signed
    FROM public.cockpit_billing_deal_cards() dc
    JOIN public.cockpit_billing_deal_assignments() x ON x.deal_response_id = dc.deal_response_id
    WHERE dc.clickup_task_id = v_task;
    IF v_card_signed IS NOT NULL AND v_card_signed >= v_assigned.signed_at THEN
      RAISE EXCEPTION '% already has a signed deal from %; link this one to the client it belongs to.',
        v_acc.client_name, to_char((v_card_signed AT TIME ZONE 'Asia/Kuwait')::date, 'FMDD Mon YYYY') USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.cockpit_billing_deal_links(deal_response_id, clickup_task_id, note, set_by)
    VALUES (v_deal_id, v_task, v_note, v_who) RETURNING * INTO v_link;
    -- The note stays in the link row and the audit row: the billing log is
    -- read more widely, so its reason is left empty.
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_task, v_acc.client_name, 'link', NULL, v_deal_id, NULL,
            jsonb_build_object('linkId', v_link.id, 'dealResponseId', v_deal_id), v_source, v_who)
    RETURNING id INTO v_event;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.link', 'cockpit_billing_deal_links', v_link.id::text, v_who, v_app, 'supabase', NULL, to_jsonb(v_link),
            jsonb_build_object('event_id', v_event));
    RETURN jsonb_build_object('ok', true, 'sentence', format('Linked to %s.', v_acc.client_name),
      'link', jsonb_build_object('id', v_link.id, 'dealResponseId', v_link.deal_response_id, 'taskId', v_link.clickup_task_id,
                                 'setAt', v_link.set_at));
  END IF;

  -- ---------------------------------------------------------------------------
  -- exclude (20261024p): the CEO says a payment the client's deal holds was
  -- not program money (the website, or something else he names). Pending
  -- payments stop counting it; the money refresh, the ties, cash and pay are
  -- left as they are.
  IF p_action = 'exclude' THEN
    IF NOT public.cockpit_billing_card_listed(v_task, true) THEN
      RAISE EXCEPTION '% is not on the pending payments list. Reload the page to see who is.', v_acc.client_name USING ERRCODE = '22023';
    END IF;
    v_payment := btrim(coalesce(p_args ->> 'paymentId', ''));
    IF v_payment !~ '^[a-z_]{2,20}:[A-Za-z0-9_.:-]{1,200}$' THEN RAISE EXCEPTION 'That is not a payment id.' USING ERRCODE = '22023'; END IF;
    v_why := coalesce(p_args ->> 'reason', '');
    IF v_why NOT IN ('website', 'other') THEN
      RAISE EXCEPTION 'Say what the payment was for: the website, or something else.' USING ERRCODE = '22023';
    END IF;
    v_note := public.cockpit_manual_clean_text(p_args ->> 'note', 500);
    IF v_why = 'other' AND coalesce(length(v_note), 0) < 3 THEN
      RAISE EXCEPTION 'Say what the payment was for in 3 to 500 characters.' USING ERRCODE = '22023';
    END IF;
    v_deal_id := btrim(coalesce(p_args ->> 'dealResponseId', ''));
    SELECT dc.deal_response_id INTO v_card_deal FROM public.cockpit_billing_deal_cards() dc WHERE dc.clickup_task_id = v_task;
    IF v_card_deal IS NULL THEN
      RAISE EXCEPTION '% has no signed deal on record, so no payment counts toward a plan yet.', v_acc.client_name USING ERRCODE = '22023';
    END IF;
    IF v_card_deal IS DISTINCT FROM v_deal_id THEN
      RAISE EXCEPTION 'That signed deal is not this client''s newest deal on record. Reload the page.' USING ERRCODE = '22023';
    END IF;
    -- One at a time per payment: two CEO tabs leaving the same payment out wait for each other.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_billing_payment_exclusions:' || v_payment, 0));
    -- The payment's live mark, if it has one (one per payment; nulls if none).
    SELECT * INTO v_excl_before FROM public.cockpit_billing_payment_exclusions x
     WHERE x.payment_id = v_payment AND x.withdrawn_at IS NULL FOR UPDATE;
    IF v_excl_before.deal_response_id = v_deal_id THEN
      RAISE EXCEPTION 'That payment is already left out of program money.' USING ERRCODE = '22023';
    END IF;
    -- Only a payment the deal or its card already holds: an exclusion never
    -- names a payment the row does not count, so it can only take money out.
    SELECT * INTO v_held FROM public.cockpit_billing_deal_rails_held(v_deal_id, v_task) r WHERE r.payment_id = v_payment;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That payment is not one of %''s rail payments. Reload the page.', v_acc.client_name USING ERRCODE = 'P0002';
    END IF;
    -- A mark left on another deal counts only there, and no row shows it now:
    -- a payment is in one deal ledger at most and on one card at most, so of
    -- the deals the list shows only this one holds it (Money tied it here
    -- since, or the card has a newer deal). The CEO's new word replaces it:
    -- the old mark is withdrawn here, with its own event and audit row.
    IF v_excl_before.id IS NOT NULL THEN
      UPDATE public.cockpit_billing_payment_exclusions
         SET withdrawn_by = v_who, withdrawn_at = now(),
             withdrawn_reason = 'Left out again on the deal that holds it now (' || v_deal_id || ')'
       WHERE id = v_excl_before.id RETURNING * INTO v_excl;
      INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
      VALUES (v_excl.clickup_task_id,
              coalesce((SELECT a.client_name FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = v_excl.clickup_task_id),
                       v_excl.clickup_task_id),
              'unexclude', v_payment, NULL, v_excl.withdrawn_reason,
              jsonb_build_object('exclusionId', v_excl.id, 'paymentId', v_payment, 'dealResponseId', v_excl.deal_response_id,
                                 'movedToDealResponseId', v_deal_id),
              v_source, v_who)
      RETURNING id INTO v_event;
      INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
      VALUES ('billing.unexclude', 'cockpit_billing_payment_exclusions', v_excl.id::text, v_who, v_app, 'supabase',
              to_jsonb(v_excl_before), to_jsonb(v_excl),
              jsonb_build_object('event_id', v_event, 'payment_id', v_payment, 'moved_to_deal_response_id', v_deal_id));
    END IF;
    v_id := nextval(pg_catalog.pg_get_serial_sequence('public.cockpit_billing_payment_exclusions', 'id'));
    -- The note stays in the exclusion and audit rows: the billing log is read more widely.
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_task, v_acc.client_name, 'exclude', NULL, v_payment, NULL,
            jsonb_build_object('exclusionId', v_id, 'paymentId', v_payment, 'dealResponseId', v_deal_id, 'usd', v_held.usd,
                               'day', v_held.day, 'rail', v_held.rail, 'reason', v_why),
            v_source, v_who)
    RETURNING id INTO v_event;
    INSERT INTO public.cockpit_billing_payment_exclusions(id, payment_id, clickup_task_id, deal_response_id, reason, note, set_by, event_id)
    VALUES (v_id, v_payment, v_task, v_deal_id, v_why, v_note, v_who, v_event)
    RETURNING * INTO v_excl;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.exclude', 'cockpit_billing_payment_exclusions', v_excl.id::text, v_who, v_app, 'supabase', NULL, to_jsonb(v_excl),
            jsonb_build_object('event_id', v_event, 'deal_response_id', v_deal_id, 'payment_id', v_payment,
                               'usd', v_held.usd, 'day', v_held.day, 'rail', v_held.rail));
    RETURN jsonb_build_object('ok', true,
      'sentence', format('Left %s on %s out of program money.',
        '$' || CASE WHEN v_held.usd = trunc(v_held.usd) THEN to_char(v_held.usd, 'FM999,999,990') ELSE to_char(v_held.usd, 'FM999,999,990.00') END,
        to_char(v_held.day, 'FMDD Mon')),
      'exclusion', jsonb_build_object('id', v_excl.id, 'paymentId', v_excl.payment_id, 'taskId', v_excl.clickup_task_id,
        'dealResponseId', v_excl.deal_response_id, 'reason', v_excl.reason, 'usd', v_held.usd, 'day', v_held.day,
        'rail', v_held.rail, 'setAt', v_excl.set_at));
  END IF;

  -- ---------------------------------------------------------------------------
  IF p_action = 'withdraw' THEN
    IF jsonb_typeof(p_args -> 'confirmationId') IS DISTINCT FROM 'number' OR (p_args ->> 'confirmationId') !~ '^[0-9]{1,18}$' THEN
      RAISE EXCEPTION 'Say which confirmation to withdraw.' USING ERRCODE = '22023';
    END IF;
    v_reason := public.cockpit_manual_clean_text(p_args ->> 'reason', 300);
    IF coalesce(length(v_reason), 0) < 3 THEN RAISE EXCEPTION 'Say why in 3 to 300 characters.' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_before FROM public.cockpit_billing_confirmations c
     WHERE c.id = (p_args ->> 'confirmationId')::bigint AND c.clickup_task_id = v_task FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That confirmation is not on this client. Reload the page.' USING ERRCODE = 'P0002'; END IF;
    IF v_before.withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'That confirmation was already withdrawn.' USING ERRCODE = '22023';
    END IF;
    IF NOT v_ceo AND v_before.confirmed_by IS DISTINCT FROM v_who THEN
      RAISE EXCEPTION 'Only the person who confirmed it, or the CEO, can withdraw it.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.cockpit_billing_confirmations SET withdrawn_by = v_who, withdrawn_at = now(), withdrawn_reason = v_reason
     WHERE id = v_before.id RETURNING * INTO v_conf;
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_task, v_acc.client_name, 'unconfirm', trim_scale(v_conf.usd)::text, NULL, v_reason,
            jsonb_build_object('confirmationId', v_conf.id, 'part', v_conf.part, 'partNo', v_conf.part_no,
                               'dealResponseId', v_conf.deal_response_id), v_source, v_who)
    RETURNING id INTO v_event;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.unconfirm', 'cockpit_billing_confirmations', v_conf.id::text, v_who, v_app, 'supabase',
            to_jsonb(v_before), to_jsonb(v_conf), jsonb_build_object('event_id', v_event));
    RETURN jsonb_build_object('ok', true, 'sentence', 'Withdrawn.',
      'confirmation', jsonb_build_object('id', v_conf.id, 'taskId', v_conf.clickup_task_id, 'withdrawnAt', v_conf.withdrawn_at,
                                         'withdrawnReason', v_conf.withdrawn_reason));
  END IF;

  -- ---------------------------------------------------------------------------
  -- confirm: only on a card the caller's pending payments list shows (the
  -- CEO's includes Back with sales), so no confirmation sits where no screen
  -- shows it. Withdraw above stays open, so a stray row can still be taken back.
  IF NOT public.cockpit_billing_card_listed(v_task, v_ceo) THEN
    RAISE EXCEPTION '% is not on the pending payments list. Reload the page to see who is.', v_acc.client_name USING ERRCODE = '22023';
  END IF;
  v_rail := lower(btrim(coalesce(p_args ->> 'rail', '')));
  IF v_rail = '' THEN RAISE EXCEPTION 'Pick how they paid: Whop, Tap or an Ecom link.' USING ERRCODE = '22023'; END IF;
  IF v_rail NOT IN ('whop', 'tap', 'ecom') THEN
    RAISE EXCEPTION 'A transfer, cheque or cash never arrives on its own. Log it as a payment with its receipt instead.' USING ERRCODE = '22023';
  END IF;
  v_rail_name := CASE v_rail WHEN 'whop' THEN 'Whop' WHEN 'tap' THEN 'Tap' ELSE 'Ecom' END;

  v_part := coalesce(p_args ->> 'part', '');
  IF v_part NOT IN ('deposit', 'onboarding', 'later', 'all') THEN
    RAISE EXCEPTION 'Say which part of the plan was paid.' USING ERRCODE = '22023';
  END IF;
  IF p_args -> 'partNo' IS NULL OR jsonb_typeof(p_args -> 'partNo') = 'null' THEN
    v_part_no := CASE WHEN v_part = 'later' THEN NULL ELSE 0 END;
  ELSIF jsonb_typeof(p_args -> 'partNo') = 'number' AND (p_args ->> 'partNo') ~ '^[0-9]{1,2}$' THEN
    v_part_no := (p_args ->> 'partNo')::integer;
  END IF;
  IF v_part_no IS NULL OR (v_part = 'later' AND v_part_no NOT BETWEEN 1 AND 36) OR (v_part <> 'later' AND v_part_no <> 0) THEN
    RAISE EXCEPTION 'Say which part of the plan was paid.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_args -> 'amount') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Type the amount as a number.' USING ERRCODE = '22023'; END IF;
  v_amount := (p_args ->> 'amount')::numeric;
  v_currency := p_args ->> 'currency';
  IF v_currency IS NULL OR v_currency NOT IN ('USD', 'KWD') THEN RAISE EXCEPTION 'Pick dollars or dinars.' USING ERRCODE = '22023'; END IF;
  v_problem := public.cockpit_billing_amount_problem(v_amount, v_currency);
  IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023'; END IF;
  v_usd := CASE v_currency WHEN 'USD' THEN v_amount ELSE round(v_amount * 3.26, 2) END;

  v_day := public.cockpit_billing_day(p_args ->> 'paidOn');
  IF v_day IS NULL OR v_day > v_today THEN
    RAISE EXCEPTION 'Pick the day they paid, today or before.' USING ERRCODE = '22023';
  END IF;

  v_evidence := nullif(btrim(coalesce(p_args ->> 'evidenceUrl', '')), '');
  IF v_evidence IS NOT NULL AND (v_evidence !~ '^https://[^[:space:]<>"'']+$' OR length(v_evidence) > 1000) THEN
    RAISE EXCEPTION 'The receipt has to be a link that opens, starting https://.' USING ERRCODE = '22023';
  END IF;
  v_note := public.cockpit_manual_clean_text(p_args ->> 'note', 500);

  -- The deal: the card's newest live deal, or none for a card with no terms on record.
  v_deal_id := nullif(btrim(coalesce(p_args ->> 'dealResponseId', '')), '');
  SELECT dc.deal_response_id INTO v_card_deal FROM public.cockpit_billing_deal_cards() dc WHERE dc.clickup_task_id = v_task;
  IF v_deal_id IS NULL THEN
    IF v_card_deal IS NOT NULL THEN
      RAISE EXCEPTION 'This client has a signed deal on record. Reload the page and confirm against it.' USING ERRCODE = '22023';
    END IF;
    -- "Terms not on record" is a card in onboarding (PLAN 1.2); a card past
    -- onboarding with no deal is only a footnote on the screen.
    IF coalesce(v_acc.stage_group, '') <> 'pipeline' THEN
      RAISE EXCEPTION '% has no signed deal on record and is past onboarding. Link its closer form to the card first (the CEO''s Link to a card), then confirm against it.',
        v_acc.client_name USING ERRCODE = '22023';
    END IF;
    IF v_part <> 'all' THEN
      RAISE EXCEPTION 'With no signed deal on record, confirm what they paid in all.' USING ERRCODE = '22023';
    END IF;
    v_signed := NULL;
  ELSE
    IF v_card_deal IS DISTINCT FROM v_deal_id THEN
      RAISE EXCEPTION 'That signed deal is not this client''s newest deal on record. Reload the page.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_deal FROM public.cockpit_sales_deals d WHERE d.response_id = v_deal_id;
    v_signed := (v_deal.submitted_at AT TIME ZONE 'Asia/Kuwait')::date;
  END IF;

  v_floor := coalesce(v_signed, (SELECT o.signup_on FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = v_task)) - 7;
  IF v_day < coalesce(v_floor, date '2025-01-01') THEN
    RAISE EXCEPTION 'That day is before they signed. Pick the day they paid.' USING ERRCODE = '22023';
  END IF;

  -- The same confirmation sent twice (a double press) is answered with the first.
  SELECT * INTO v_conf FROM public.cockpit_billing_confirmations c
   WHERE c.clickup_task_id = v_task AND c.deal_response_id IS NOT DISTINCT FROM v_deal_id AND c.part = v_part
     AND c.part_no = v_part_no AND c.rail = v_rail AND c.usd = v_usd AND c.paid_on = v_day
     AND c.confirmed_by = v_who AND c.withdrawn_at IS NULL AND c.confirmed_at > now() - interval '2 minutes'
   ORDER BY c.id DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'repeated', true,
      'sentence', format('Confirmed by you · waiting for %s', v_rail_name),
      'confirmation', jsonb_build_object('id', v_conf.id, 'taskId', v_conf.clickup_task_id, 'dealResponseId', v_conf.deal_response_id,
        'part', v_conf.part, 'partNo', v_conf.part_no, 'amount', v_conf.amount, 'currency', v_conf.currency, 'usd', v_conf.usd,
        'rail', v_conf.rail, 'paidOn', v_conf.paid_on, 'confirmedByCeo', v_conf.confirmed_by_ceo, 'confirmedAt', v_conf.confirmed_at));
  END IF;

  -- The cap: what confirmations still hold, with this one, stays within what
  -- the rails have not shown, plus 1% of the contract.
  IF v_deal_id IS NOT NULL THEN
    SELECT coalesce(sum(r.usd), 0), max(r.recorded_at) INTO v_rails, v_rails_as_of
    FROM public.cockpit_billing_deal_rails(v_deal_id, v_task) r;
    -- What still holds (PLAN 1.2 "reserved") is the live confirmations no
    -- rail payment has proven yet: a proven one's dollars are already inside
    -- the rails, so counting it again would refuse the next part. The deal's
    -- confirmations, and those made on the card before it had a deal (part
    -- 'all'), oldest first. Proof (PLAN 1.2): a payment in the deal's rails on
    -- the rail it named, within 2% of its dollars, dated from 3 days before to
    -- 14 days after its paid-on day, not already proving an older one; the
    -- closest day wins, then the earlier day, then the payment id.
    v_live := 0;
    FOR v_c IN
      SELECT * FROM public.cockpit_billing_confirmations c
       WHERE c.withdrawn_at IS NULL
         AND (c.deal_response_id = v_deal_id OR (c.clickup_task_id = v_task AND c.deal_response_id IS NULL))
       ORDER BY c.confirmed_at, c.id
    LOOP
      SELECT r.payment_id INTO v_pid FROM public.cockpit_billing_deal_rails(v_deal_id, v_task) r
       WHERE lower(r.rail) = v_c.rail AND abs(r.usd - v_c.usd) <= 0.02 * v_c.usd
         AND r.day BETWEEN v_c.paid_on - 3 AND v_c.paid_on + 14
         AND NOT (r.payment_id = ANY (v_used))
       ORDER BY abs(r.day - v_c.paid_on), r.day, r.payment_id
       LIMIT 1;
      IF v_pid IS NULL THEN
        v_live := v_live + v_c.usd;
      ELSE
        v_used := v_used || v_pid;
      END IF;
    END LOOP;
  ELSE
    v_rails := NULL;
    SELECT coalesce(sum(c.usd), 0) INTO v_live FROM public.cockpit_billing_confirmations c
     WHERE c.clickup_task_id = v_task AND c.deal_response_id IS NULL AND c.withdrawn_at IS NULL;
  END IF;
  IF v_deal_id IS NOT NULL AND coalesce(v_deal.contracted_revenue, 0) > 0 THEN
    IF v_live + v_usd > v_deal.contracted_revenue - v_rails + round(0.01 * v_deal.contracted_revenue, 2) THEN
      v_left := greatest(0, round(v_deal.contracted_revenue - v_rails - v_live, 2));
      RAISE EXCEPTION 'That is more than the $% the rails have not shown.%',
        CASE WHEN v_left = trunc(v_left) THEN to_char(v_left, 'FM999,999,990') ELSE to_char(v_left, 'FM999,999,990.00') END,
        CASE WHEN v_live > 0 THEN format(' Confirmations already cover $%s of it.',
          CASE WHEN v_live = trunc(v_live) THEN to_char(v_live, 'FM999,999,990') ELSE to_char(v_live, 'FM999,999,990.00') END) ELSE '' END
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_live + v_usd > 100000 THEN
    -- No contract on the closer form: the only cap is one client's payments.
    RAISE EXCEPTION 'That is too large for one client''s payments; check the amount.' USING ERRCODE = '22023';
  END IF;

  v_id := nextval(pg_catalog.pg_get_serial_sequence('public.cockpit_billing_confirmations', 'id'));
  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (v_task, v_acc.client_name, 'confirm', NULL, trim_scale(v_usd)::text, NULL,
          jsonb_build_object('confirmationId', v_id, 'part', v_part, 'partNo', v_part_no, 'rail', v_rail, 'usd', v_usd,
                             'paidOn', v_day, 'railsUsdAtConfirm', v_rails, 'dealResponseId', v_deal_id),
          v_source, v_who)
  RETURNING id INTO v_event;
  INSERT INTO public.cockpit_billing_confirmations(id, clickup_task_id, deal_response_id, part, part_no, amount, currency, usd, rail,
      paid_on, evidence_url, note, rails_usd_at_confirm, rails_as_of, source, confirmed_by, confirmed_by_ceo, event_id)
  VALUES (v_id, v_task, v_deal_id, v_part, v_part_no, v_amount, v_currency, v_usd, v_rail,
      v_day, v_evidence, v_note, v_rails, v_rails_as_of, v_source, v_who, v_ceo, v_event)
  RETURNING * INTO v_conf;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('billing.confirm', 'cockpit_billing_confirmations', v_conf.id::text, v_who, v_app, 'supabase', NULL, to_jsonb(v_conf),
          jsonb_build_object('event_id', v_event, 'deal_response_id', v_deal_id));

  RETURN jsonb_build_object('ok', true,
    'sentence', format('Confirmed by you · waiting for %s', v_rail_name),
    'confirmation', jsonb_build_object('id', v_conf.id, 'taskId', v_conf.clickup_task_id, 'dealResponseId', v_conf.deal_response_id,
      'part', v_conf.part, 'partNo', v_conf.part_no, 'amount', v_conf.amount, 'currency', v_conf.currency, 'usd', v_conf.usd,
      'rail', v_conf.rail, 'paidOn', v_conf.paid_on, 'evidenceUrl', v_conf.evidence_url, 'note', v_conf.note,
      'railsUsdAtConfirm', v_conf.rails_usd_at_confirm, 'railsAsOf', v_conf.rails_as_of, 'source', v_conf.source,
      'confirmedByCeo', v_conf.confirmed_by_ceo, 'byYou', true, 'confirmedAt', v_conf.confirmed_at));
END $$;
COMMENT ON FUNCTION public.cockpit_billing_balance_write(text, jsonb) IS
  'Pending payments writes (23 Oct 2026; exclude and unexclude 24 Oct): confirm and withdraw (CEO, client success or finance; a success manager only on their portal clients), link and unlink, exclude and unexclude (CEO only). Each write leaves its row, a cockpit_billing_events row and a cockpit_audit_log row in one transaction. A confirmation is a person''s word, never money, and an exclusion only stops Pending payments counting a payment: nothing here writes a payment, a tie, the inbox, the ledger, LTV, pay or ClickUp.';

REVOKE ALL ON FUNCTION public.cockpit_billing_balance_write(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_billing_balance_write(text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. The CEO's mark of 23 Oct: Castello's website $1,500

DO $seed$
DECLARE
  v_pid  constant text := 'whop:pay_fjRE96EdeUqfmO';
  v_task constant text := '86eynfnv5';
  v_deal constant text := 'r6zgixh2u6paruulr6zgi2w9lckol261';
  v_who  constant text := 'aziz@maharamedia.com';
  v_note constant text := 'The CEO, 23 Oct 2026: one of Castello''s two $1,500 payments of 21 Aug was the website, not program money (the two are identical in Whop; the later one carries the mark).';
  v_acc public.cockpit_billing_accounts;
  v_held record;
  v_id bigint;
  v_event bigint;
  v_row public.cockpit_billing_payment_exclusions;
BEGIN
  -- Written once: a row for this payment, live or withdrawn since, means it was.
  IF EXISTS (SELECT 1 FROM public.cockpit_billing_payment_exclusions x WHERE x.payment_id = v_pid) THEN
    RAISE NOTICE '20261024p: % already has an exclusion row; the seed writes nothing.', v_pid;
    RETURN;
  END IF;
  SELECT * INTO v_acc FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = v_task;
  IF NOT FOUND THEN
    -- A database without the Creative Triage cards (a test engine or a fresh branch).
    RAISE NOTICE '20261024p: card % is not in this database; the seed writes nothing.', v_task;
    RETURN;
  END IF;
  IF (SELECT dc.deal_response_id FROM public.cockpit_billing_deal_cards() dc WHERE dc.clickup_task_id = v_task) IS DISTINCT FROM v_deal THEN
    RAISE EXCEPTION '20261024p: Castello''s newest deal is no longer %; read it again before applying.', v_deal;
  END IF;
  SELECT * INTO v_held FROM public.cockpit_billing_deal_rails_held(v_deal, v_task) r WHERE r.payment_id = v_pid;
  IF NOT FOUND THEN
    RAISE EXCEPTION '20261024p: % is not one of Castello''s rail payments any more; read it again before applying.', v_pid;
  END IF;
  v_id := nextval(pg_catalog.pg_get_serial_sequence('public.cockpit_billing_payment_exclusions', 'id'));
  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (v_task, v_acc.client_name, 'exclude', NULL, v_pid, NULL,
          jsonb_build_object('exclusionId', v_id, 'paymentId', v_pid, 'dealResponseId', v_deal, 'usd', v_held.usd,
                             'day', v_held.day, 'rail', v_held.rail, 'reason', 'website'),
          'ceo', v_who)
  RETURNING id INTO v_event;
  INSERT INTO public.cockpit_billing_payment_exclusions(id, payment_id, clickup_task_id, deal_response_id, reason, note, set_by, event_id)
  VALUES (v_id, v_pid, v_task, v_deal, 'website', v_note, v_who, v_event)
  RETURNING * INTO v_row;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('billing.exclude', 'cockpit_billing_payment_exclusions', v_row.id::text, v_who, 'media-buyer-cockpit', 'supabase', NULL, to_jsonb(v_row),
          jsonb_build_object('event_id', v_event, 'deal_response_id', v_deal, 'payment_id', v_pid, 'usd', v_held.usd,
                             'day', v_held.day, 'rail', v_held.rail, 'run_by', 'migration 20261024p',
                             'instruction', 'The CEO, 23 Oct 2026 (WRITE-PLAN section 5, S7)'));
END
$seed$;

NOTIFY pgrst, 'reload schema';
COMMIT;
