-- 20261102h_wins_pay.sql: the wins ledger, upsell stages, the back-end rule's
-- win ties, pay proposals and the C7 rule (docs/forms/WAVE56-CONTRACT.md
-- sections 2.4, 3.1-3.3, 4.2, 4.3, 4.8, 4.9; decisions X2-X6, X31-X33).
--
-- What this file holds:
--   1. The wins ledger (cockpit_csm_wins), its events and the CSM's tie
--      proposals, each with row security, no browser grant, an audit row for
--      every write and no delete. A guard trigger allows only the stage moves
--      of 3.2.
--   2. cockpit_payment_ties.win_id and cockpit_invoices.win_id: a win tie is
--      always a payment tie to the win's card, and one payment ties to one win
--      at most, so upsell cash is attributed once (X3).
--   3. The registry row "win" (code-defined sheet) and the pay.proposals
--      switch, off.
--   4. The seat RPCs of 3.3: Log a win, stage moves, the reads, the tie
--      candidates, the CSM's tie proposal, the CEO's confirm or decline, the
--      CEO's clear (the only way a win tie goes), the invoice link.
--   5. cockpit_ceo_payment_tie and cockpit_ceo_payment_untie replaced: they
--      refuse a row with a win_id and are otherwise byte for byte the live
--      bodies (2.2).
--   6. Pay proposals derived on read from the ledger (cockpit_win_pay_rows),
--      the CEO's confirm into an ordinary pay entry, and the C7 rule in the
--      replaced cockpit_ceo_pay_entry_save (active only while pay.proposals is
--      on; everything else byte for byte).
--   7. The owner-only import of the 35 old Typeform wins (void, history only).
--   8. cockpit_wins_v for the CEO refresh, readable by supabase_read_only_user.
--
-- Builds on 20261102g (billing kind "win", notice kind "win.logged", the
-- forms.doors marker "wins"). Applies twice. Writes nothing live by itself:
-- the door marker "wins" and pay.proposals stay false until deploy D-W.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Drift guard and order (2.1). Each replaced function must be the body the
--    contract read live on 2026-11-02, or this file's own "after" body.

DO $$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('cockpit_ceo_pay_entry_save', 'p jsonb', '48ff70e02b66ffefc858342146b41998', 'ea917bb7adf730d787bf34beadc7aa30'),
      ('cockpit_ceo_payment_tie', 'p jsonb', 'b46f90ce93bbf07f35614de78805534d', 'f0e9b33d147639c890966b9e83c2af48'),
      ('cockpit_ceo_payment_untie', 'p jsonb', 'e569f8c08d8260b4cdbc4a237c1c51c9', 'ee27b60cc0c347be5fee32d71fb8086e')
    ) AS x(fn, args, live, after)
  LOOP
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = r.fn AND pg_get_function_identity_arguments(p.oid) = r.args;
    IF v IS NULL THEN
      RAISE EXCEPTION '%(%) is missing; apply the waves 1-4 chain first.', r.fn, r.args USING ERRCODE = '55000';
    END IF;
    IF v NOT IN (r.live, r.after) THEN
      RAISE EXCEPTION '% changed since the waves 5-6 contract read it; stop and re-read it.', r.fn USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- 20261102g first: the billing kind "win", the notice kind "win.logged" and the door marker "wins".
  IF coalesce((SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                WHERE c.conrelid = 'public.cockpit_billing_events'::regclass AND c.conname = 'cockpit_billing_events_kind_check'), '') NOT LIKE '%''win''%'
     OR coalesce((SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                WHERE c.conrelid = 'public.cockpit_slack_notices'::regclass AND c.conname = 'cockpit_slack_notices_kind_check'), '') NOT LIKE '%''win.logged''%'
     OR NOT coalesce((SELECT s.value ? 'wins' FROM public.cockpit_settings s WHERE s.key = 'forms.doors'), false)
     OR to_regclass('public.cockpit_upsell_proposals') IS NULL
     OR to_regclass('public.cockpit_pay_entries') IS NULL
     OR to_regprocedure('public.cockpit_billing_notice(text,text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261102g_money_rails_w5.sql (and waves 1-4) before 20261102h_wins_pay.sql.' USING ERRCODE = '55000';
  END IF;
END $$;

SELECT set_config('cockpit.audit_actor', 'migration', true), set_config('cockpit.audit_source', 'migration', true);

-- ---------------------------------------------------------------------------
-- 1. Words and small helpers (owner only)

-- The staff words of 3.1.
CREATE OR REPLACE FUNCTION public.cockpit_win_kind_label(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_kind
    WHEN 'review' THEN 'Google review'
    WHEN 'video_testimonial' THEN 'Video testimonial'
    WHEN 'podcast' THEN 'Podcast case study'
    WHEN 'referral' THEN 'Referral'
    WHEN 'renewal' THEN 'Renewal'
    WHEN 'reactivation' THEN 'Reactivation'
    WHEN 'upsell_website' THEN 'Website'
    WHEN 'upsell_smm' THEN 'Social media management'
    WHEN 'upsell_backend' THEN 'Back-end programme'
    WHEN 'upsell_seo_geo' THEN 'SEO and AI search'
    WHEN 'upsell_second_campaign' THEN 'Second campaign'
  END
$$;

CREATE OR REPLACE FUNCTION public.cockpit_win_stage_label(p_stage text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_stage WHEN 'logged' THEN 'Logged' WHEN 'quote_given' THEN 'Offered' WHEN 'signed' THEN 'Accepted'
                      WHEN 'paid' THEN 'Paid' WHEN 'void' THEN 'Voided' END
$$;

CREATE OR REPLACE FUNCTION public.cockpit_win_is_upsell(p_kind text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(p_kind LIKE 'upsell\_%', false)
$$;

-- Case and spacing folded (4.2.4): the one rule for matching a name.
CREATE OR REPLACE FUNCTION public.cockpit_win_fold(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT nullif(lower(regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g')), '')
$$;

-- The pay plan part a win kind is paid from (4.9).
CREATE OR REPLACE FUNCTION public.cockpit_win_part(p_kind text, p_recurring boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_kind = 'review' THEN 'google_reviews'
    WHEN p_kind = 'video_testimonial' THEN 'video_testimonials'
    WHEN p_kind = 'podcast' THEN 'podcasts'
    WHEN p_kind = 'referral' THEN 'referrals'
    WHEN p_kind = 'renewal' THEN 'renewals'
    WHEN p_kind = 'reactivation' THEN 'reactivations'
    WHEN p_kind LIKE 'upsell\_%' AND coalesce(p_recurring, false) THEN 'recurring'
    WHEN p_kind LIKE 'upsell\_%' THEN 'upsells'
  END
$$;

CREATE OR REPLACE FUNCTION public.cockpit_win_part_label(p_part text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_part
    WHEN 'google_reviews' THEN 'Google reviews' WHEN 'video_testimonials' THEN 'Video testimonials'
    WHEN 'podcasts' THEN 'Podcast case studies' WHEN 'referrals' THEN 'Referrals' WHEN 'renewals' THEN 'Renewals'
    WHEN 'reactivations' THEN 'Reactivations' WHEN 'upsells' THEN 'Backend upsells' WHEN 'recurring' THEN 'Recurring services'
    ELSE p_part END
$$;

CREATE OR REPLACE FUNCTION public.cockpit_win_month_words(p_month date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT to_char(p_month, 'FMMonth YYYY')
$$;

-- A link as the ledger keeps it: https only, 1,000 characters at most.
CREATE OR REPLACE FUNCTION public.cockpit_win_link(p jsonb, p_key text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v text;
BEGIN
  IF NOT (p ? p_key) OR p->p_key = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(p->p_key) <> 'string' THEN RAISE EXCEPTION 'A link is text.' USING ERRCODE = '22023'; END IF;
  v := nullif(btrim(p->>p_key), '');
  IF v IS NULL THEN RETURN NULL; END IF;
  IF v !~ '^https://[^[:space:]]+$' OR char_length(v) > 1000 THEN
    RAISE EXCEPTION 'A link starts with https:// and is at most 1,000 characters.' USING ERRCODE = '22023';
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_win_usd(p jsonb, p_key text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF NOT (p ? p_key) OR p->p_key = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(p->p_key) <> 'number' THEN RAISE EXCEPTION 'Type the price as a number.' USING ERRCODE = '22023'; END IF;
  RETURN round((p->>p_key)::numeric, 2);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_win_uuid(p jsonb, p_key text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF NOT (p ? p_key) OR p->p_key = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(p->p_key) <> 'string'
     OR p->>p_key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'That could not be read. Reload the page and try again.' USING ERRCODE = '22023';
  END IF;
  RETURN lower(p->>p_key)::uuid;
END $$;

-- Refuses a payload that is not an object or carries a key outside the list.
CREATE OR REPLACE FUNCTION public.cockpit_win_only(p jsonb, p_allowed text[])
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE k text;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text) > 16384 THEN
    RAISE EXCEPTION 'That could not be read. Reload the page and try again.' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p) LOOP
    IF NOT (k = ANY (p_allowed)) THEN RAISE EXCEPTION 'Unknown field: %', k USING ERRCODE = '22023'; END IF;
  END LOOP;
END $$;

-- The internal test card the canaries run on (W12, W34).
CREATE OR REPLACE FUNCTION public.cockpit_win_canary_card()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '86eywg1cq'::text $$;

-- Log a win is open only once its door marker is on (1.4).
CREATE OR REPLACE FUNCTION public.cockpit_win_door_open()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT s.value->'wins' = 'true'::jsonb FROM public.cockpit_settings s WHERE s.key = 'forms.doors'), false)
$$;

CREATE OR REPLACE FUNCTION public.cockpit_win_proposals_on()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT s.value->'on' = 'true'::jsonb FROM public.cockpit_settings s WHERE s.key = 'pay.proposals'), false)
$$;

-- The seat acting on a card's wins: the CEO, or a CSM the client gate allows
-- (cockpit_csm_client_gate). 42501 for who, never a name.
CREATE OR REPLACE FUNCTION public.cockpit_win_seat(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_email text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to work with wins.' USING ERRCODE = '42501'; END IF;
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'That is not a ClickUp card id.' USING ERRCODE = '22023';
  END IF;
  SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u WHERE u.id = v_uid;
  IF coalesce(public.cockpit_is_ceo(), false) THEN
    RETURN jsonb_build_object('ceo', true, 'role', 'the CEO', 'source', 'ceo', 'uid', v_uid, 'email', v_email);
  END IF;
  IF NOT coalesce(public.cockpit_has_role('csm'), false) THEN
    RAISE EXCEPTION 'Wins need a client success or CEO seat. Ask an admin to add the role.' USING ERRCODE = '42501';
  END IF;
  IF p_task_id = public.cockpit_win_canary_card() THEN
    RAISE EXCEPTION 'The test card is the CEO''s.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.cockpit_csm_client_gate(p_task_id);
  RETURN jsonb_build_object('ceo', false, 'role', 'the CSM', 'source', 'csm', 'uid', v_uid, 'email', v_email);
END $$;

-- The card's CSM on the win day: the billing card's CSM field matched to the
-- roster by name, case and spacing folded, exactly one hit; NULL otherwise
-- (the CEO picks the person at confirm).
CREATE OR REPLACE FUNCTION public.cockpit_win_csm_person(p_task_id text)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN count(*) = 1 THEN min(p.id) END
    FROM public.cockpit_billing_accounts a
    JOIN public.cockpit_people p ON public.cockpit_win_fold(p.name) = public.cockpit_win_fold(a.csm)
   WHERE a.clickup_task_id = p_task_id AND public.cockpit_win_fold(a.csm) IS NOT NULL
$$;

-- An upsell proposal's prices: the sent total, the list total (NULL when no
-- part has a list price), and the monthly part of the sent price.
CREATE OR REPLACE FUNCTION public.cockpit_win_proposal_prices(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'quoted', (SELECT sum((x.value #>> '{}')::numeric) FROM jsonb_each(coalesce(u.sent_price->'parts', '{}'::jsonb)) x
                WHERE jsonb_typeof(x.value) = 'number'),
    'list', (SELECT sum((x.value #>> '{}')::numeric) FROM jsonb_each(coalesce(u.sent_list_price, '{}'::jsonb)) x
              WHERE jsonb_typeof(x.value) = 'number'),
    'monthly', (SELECT sum((x.value #>> '{}')::numeric) FROM jsonb_each(coalesce(u.sent_price->'parts', '{}'::jsonb)) x
                 JOIN LATERAL jsonb_array_elements(coalesce(c.parts, '[]'::jsonb)) cp ON cp->>'key' = x.key
                WHERE jsonb_typeof(x.value) = 'number' AND cp->>'cadence' = 'monthly'),
    'offer', coalesce(c.copy->'en'->>'name', u.offer_key),
    'offerKey', u.offer_key,
    'status', u.status)
  FROM public.cockpit_upsell_proposals u
  LEFT JOIN public.cockpit_upsell_catalog c ON c.offer_key = u.offer_key
  WHERE u.id = p_id
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables (3.2)

CREATE TABLE IF NOT EXISTS public.cockpit_csm_wins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name text NOT NULL CHECK (btrim(client_name) <> '' AND char_length(client_name) <= 200),
  kind text NOT NULL CHECK (kind IN ('review','video_testimonial','podcast','referral','renewal','reactivation',
    'upsell_website','upsell_smm','upsell_backend','upsell_seo_geo','upsell_second_campaign')),
  stage text NOT NULL CHECK (stage IN ('logged','quote_given','signed','paid','void')),
  won_on date NOT NULL,
  proof_url text CHECK (proof_url IS NULL OR (proof_url ~ '^https://' AND char_length(proof_url) <= 1000)),
  proposal_id uuid REFERENCES public.cockpit_upsell_proposals(id),
  quoted_usd numeric CHECK (quoted_usd IS NULL OR (quoted_usd > 0 AND quoted_usd <= 1000000)),
  list_usd numeric CHECK (list_usd IS NULL OR (list_usd > 0 AND list_usd <= 1000000)),
  below_list_reason text CHECK (below_list_reason IS NULL OR char_length(btrim(below_list_reason)) BETWEEN 3 AND 140),
  recurring boolean NOT NULL DEFAULT false,
  monthly_usd numeric CHECK (monthly_usd IS NULL OR (monthly_usd > 0 AND monthly_usd <= 1000000)),
  agreement_url text CHECK (agreement_url IS NULL OR (agreement_url ~ '^https://' AND char_length(agreement_url) <= 1000)),
  referral_deal_response_id text CHECK (referral_deal_response_id IS NULL OR char_length(referral_deal_response_id) BETWEEN 1 AND 200),
  departure_id bigint REFERENCES public.cockpit_churn_departures(id),
  csm_person_id bigint REFERENCES public.cockpit_people(id),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  source text NOT NULL CHECK (source IN ('cockpit','import','reactivate','canary')),
  imported_from text CHECK (imported_from IS NULL OR imported_from ~ '^typeform:[A-Za-z0-9]{8}:[A-Za-z0-9_-]{1,120}$'),
  logged_by uuid,
  logged_by_email text,
  logged_by_role text NOT NULL CHECK (char_length(btrim(logged_by_role)) BETWEEN 2 AND 60),
  logged_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  voided_by text,
  voided_at timestamptz,
  void_reason text CHECK (void_reason IS NULL OR char_length(btrim(void_reason)) BETWEEN 3 AND 300),
  -- The stage of a kind: a non-upsell is logged or void; an upsell is staged.
  CONSTRAINT cockpit_csm_wins_stage_of_kind CHECK (
    CASE WHEN kind LIKE 'upsell\_%' THEN stage IN ('quote_given','signed','paid','void') ELSE stage IN ('logged','void') END),
  CONSTRAINT cockpit_csm_wins_void_pair CHECK ((stage = 'void') = (voided_at IS NOT NULL) AND (stage = 'void') = (void_reason IS NOT NULL)),
  CONSTRAINT cockpit_csm_wins_import_pair CHECK ((source = 'import') = (imported_from IS NOT NULL)),
  CONSTRAINT cockpit_csm_wins_import_void CHECK (source <> 'import' OR stage = 'void'),
  CONSTRAINT cockpit_csm_wins_recurring CHECK (NOT recurring OR monthly_usd IS NOT NULL),
  CONSTRAINT cockpit_csm_wins_upsell_price CHECK (source = 'import' OR kind NOT LIKE 'upsell\_%' OR quoted_usd IS NOT NULL),
  CONSTRAINT cockpit_csm_wins_accepted_has_agreement CHECK (stage NOT IN ('signed','paid') OR agreement_url IS NOT NULL),
  CONSTRAINT cockpit_csm_wins_referral_deal CHECK (source = 'import' OR kind <> 'referral' OR referral_deal_response_id IS NOT NULL),
  CONSTRAINT cockpit_csm_wins_departure_kind CHECK (departure_id IS NULL OR kind = 'reactivation'),
  CONSTRAINT cockpit_csm_wins_below_list CHECK (source = 'import' OR quoted_usd IS NULL OR list_usd IS NULL OR quoted_usd >= list_usd
    OR below_list_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS cockpit_csm_wins_task_day ON public.cockpit_csm_wins (task_id, won_on);
CREATE INDEX IF NOT EXISTS cockpit_csm_wins_stage ON public.cockpit_csm_wins (stage);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_csm_wins_one_per_referral
  ON public.cockpit_csm_wins (referral_deal_response_id) WHERE stage <> 'void' AND referral_deal_response_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_csm_wins_one_per_return
  ON public.cockpit_csm_wins (departure_id) WHERE kind = 'reactivation' AND stage <> 'void' AND departure_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_csm_wins_imported_once
  ON public.cockpit_csm_wins (imported_from) WHERE imported_from IS NOT NULL;
CREATE INDEX IF NOT EXISTS cockpit_csm_wins_proposal ON public.cockpit_csm_wins (proposal_id) WHERE proposal_id IS NOT NULL;
COMMENT ON TABLE public.cockpit_csm_wins IS
  'The wins ledger (WAVE56-CONTRACT 3.2): reviews, video testimonials, podcasts, referrals, renewals, reactivations and five upsells, each with its proof. Written only through the cockpit_csm_win_* functions and Reactivate; never deleted. A void win pays nothing.';

CREATE TABLE IF NOT EXISTS public.cockpit_csm_win_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  win_id uuid NOT NULL REFERENCES public.cockpit_csm_wins(id),
  at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL CHECK (event IN ('logged','offered','accepted','proof_added','tie_proposed','tie_confirmed','tie_declined',
    'tie_cleared','paid','invoice_linked','voided','imported')),
  by_role text NOT NULL CHECK (char_length(btrim(by_role)) BETWEEN 2 AND 60),
  by_email text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object' AND octet_length(detail::text) <= 2048)
);
CREATE INDEX IF NOT EXISTS cockpit_csm_win_events_win_at ON public.cockpit_csm_win_events (win_id, at);
CREATE INDEX IF NOT EXISTS cockpit_csm_win_events_request ON public.cockpit_csm_win_events ((detail->>'request_id'))
  WHERE detail ? 'request_id';

CREATE TABLE IF NOT EXISTS public.cockpit_win_tie_proposals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  win_id uuid NOT NULL REFERENCES public.cockpit_csm_wins(id),
  payment_id text NOT NULL CHECK (payment_id ~ '^(whop|tap|ecom|transfer|bank|manual):[A-Za-z0-9_.-]+$' AND char_length(payment_id) <= 200),
  usd numeric NOT NULL CHECK (usd > 0),
  paid_on date NOT NULL,
  rail text NOT NULL CHECK (char_length(rail) BETWEEN 2 AND 20),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','confirmed','declined','withdrawn')),
  proposed_by_email text,
  proposed_by_role text NOT NULL CHECK (char_length(btrim(proposed_by_role)) BETWEEN 2 AND 60),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_by text,
  decided_at timestamptz,
  reason text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 300),
  tie_id bigint REFERENCES public.cockpit_payment_ties(id),
  CONSTRAINT cockpit_win_tie_proposals_decided CHECK ((state = 'open') = (decided_at IS NULL)),
  CONSTRAINT cockpit_win_tie_proposals_confirmed_tie CHECK ((state = 'confirmed') = (tie_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_win_tie_proposals_one_open
  ON public.cockpit_win_tie_proposals (payment_id) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS cockpit_win_tie_proposals_win ON public.cockpit_win_tie_proposals (win_id);

-- A win tie: a payment tie to the win's card, one live win tie per payment (X3).
ALTER TABLE public.cockpit_payment_ties ADD COLUMN IF NOT EXISTS win_id uuid REFERENCES public.cockpit_csm_wins(id);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_payment_ties_one_win_per_payment
  ON public.cockpit_payment_ties (payment_id) WHERE win_id IS NOT NULL AND cleared_at IS NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.cockpit_payment_ties'::regclass
                  AND conname = 'cockpit_payment_ties_win_is_payment_to_card') THEN
    ALTER TABLE public.cockpit_payment_ties ADD CONSTRAINT cockpit_payment_ties_win_is_payment_to_card
      CHECK (win_id IS NULL OR (payment_id IS NOT NULL AND clickup_task_id IS NOT NULL));
  END IF;
END $$;

ALTER TABLE public.cockpit_invoices ADD COLUMN IF NOT EXISTS win_id uuid REFERENCES public.cockpit_csm_wins(id);
CREATE INDEX IF NOT EXISTS cockpit_invoices_win ON public.cockpit_invoices (win_id) WHERE win_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cockpit_pay_proposal_decisions (
  key text PRIMARY KEY CHECK (key ~ '^win:[0-9a-f-]{36}:[a-z][a-z0-9_]{0,39}:[0-9]{4}-[0-9]{2}$'),
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  decision text NOT NULL CHECK (decision IN ('confirmed','declined')),
  entry_id bigint REFERENCES public.cockpit_pay_entries(id),
  reason text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 300),
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cockpit_pay_proposal_decisions_entry CHECK ((decision = 'confirmed') = (entry_id IS NOT NULL)),
  CONSTRAINT cockpit_pay_proposal_decisions_reason CHECK (decision <> 'declined' OR reason IS NOT NULL)
);

-- Row security, grants (no browser grant; the service key reads and writes
-- what the workers and the guardian need), audit and no delete.
ALTER TABLE public.cockpit_csm_wins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_csm_win_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_win_tie_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_pay_proposal_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_csm_wins, public.cockpit_csm_win_events, public.cockpit_win_tie_proposals,
  public.cockpit_pay_proposal_decisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_csm_wins, public.cockpit_win_tie_proposals TO service_role;
GRANT SELECT, INSERT ON public.cockpit_csm_win_events, public.cockpit_pay_proposal_decisions TO service_role;

-- One audit row for every insert and change (cockpit_audit_log), the action
-- named through the transaction-local cockpit.wins_action.
CREATE OR REPLACE FUNCTION public.cockpit_wins_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor text; v_new jsonb := to_jsonb(NEW); v_old jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD); END IF;
  SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (coalesce(nullif(current_setting('cockpit.wins_action', true), ''), 'wins.' || TG_TABLE_NAME || '.' || lower(TG_OP)),
          TG_TABLE_NAME, coalesce(v_new->>'id', v_new->>'key'),
          coalesce(v_actor, nullif(current_setting('cockpit.audit_actor', true), ''), session_user::text),
          'client-success', coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'),
          v_old, v_new,
          jsonb_build_object('op', lower(TG_OP), 'task_id', v_new->>'task_id', 'win_id', coalesce(v_new->>'win_id', v_new->>'id')));
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_csm_wins','cockpit_csm_win_events','cockpit_win_tie_proposals','cockpit_pay_proposal_decisions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_wins_audit ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_wins_audit AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cockpit_wins_audit()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_wins_no_delete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_wins_no_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_refuse_delete()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_wins_no_truncate ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_wins_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_forms_refuse_delete()', t);
  END LOOP;
END $$;

-- Events and decisions are written once; a decided tie proposal stays decided.
CREATE OR REPLACE FUNCTION public.cockpit_wins_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'This record is written once and never changed.' USING ERRCODE = '55000';
END $$;
DROP TRIGGER IF EXISTS cockpit_wins_append_only ON public.cockpit_csm_win_events;
CREATE TRIGGER cockpit_wins_append_only BEFORE UPDATE ON public.cockpit_csm_win_events
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_wins_append_only();
DROP TRIGGER IF EXISTS cockpit_wins_append_only ON public.cockpit_pay_proposal_decisions;
CREATE TRIGGER cockpit_wins_append_only BEFORE UPDATE ON public.cockpit_pay_proposal_decisions
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_wins_append_only();

CREATE OR REPLACE FUNCTION public.cockpit_win_tie_proposals_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.win_id IS DISTINCT FROM OLD.win_id OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.usd IS DISTINCT FROM OLD.usd OR NEW.paid_on IS DISTINCT FROM OLD.paid_on OR NEW.rail IS DISTINCT FROM OLD.rail
     OR NEW.proposed_at IS DISTINCT FROM OLD.proposed_at OR NEW.proposed_by_role IS DISTINCT FROM OLD.proposed_by_role THEN
    RAISE EXCEPTION 'A tie proposal keeps its payment and its win.' USING ERRCODE = '55000';
  END IF;
  IF OLD.state <> 'open' THEN RAISE EXCEPTION 'That proposal was already decided.' USING ERRCODE = '22023'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cockpit_win_tie_proposals_guard ON public.cockpit_win_tie_proposals;
CREATE TRIGGER cockpit_win_tie_proposals_guard BEFORE UPDATE ON public.cockpit_win_tie_proposals
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_win_tie_proposals_guard();

-- The stage moves of 3.2, and a win's identity never changes. paid -> signed
-- only from cockpit_ceo_win_tie_clear (cockpit.win_act = 'tie_clear'); paid ->
-- void only once no live win tie is left.
CREATE OR REPLACE FUNCTION public.cockpit_csm_wins_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_act text := coalesce(current_setting('cockpit.win_act', true), '');
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.source IS DISTINCT FROM OLD.source OR NEW.won_on IS DISTINCT FROM OLD.won_on
     OR NEW.imported_from IS DISTINCT FROM OLD.imported_from OR NEW.logged_at IS DISTINCT FROM OLD.logged_at
     OR NEW.logged_by IS DISTINCT FROM OLD.logged_by OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id
     OR NEW.referral_deal_response_id IS DISTINCT FROM OLD.referral_deal_response_id OR NEW.departure_id IS DISTINCT FROM OLD.departure_id
     OR NEW.quoted_usd IS DISTINCT FROM OLD.quoted_usd OR NEW.recurring IS DISTINCT FROM OLD.recurring
     OR NEW.monthly_usd IS DISTINCT FROM OLD.monthly_usd THEN
    RAISE EXCEPTION 'A win keeps its card, kind, day and price. Void it and log it again.' USING ERRCODE = '55000';
  END IF;
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF NOT ((OLD.stage, NEW.stage) IN (('quote_given','signed'), ('quote_given','void'), ('signed','paid'), ('signed','void'),
                                       ('paid','signed'), ('paid','void'), ('logged','void'))) THEN
      RAISE EXCEPTION 'That win cannot move from % to %.', public.cockpit_win_stage_label(OLD.stage), public.cockpit_win_stage_label(NEW.stage)
        USING ERRCODE = '22023';
    END IF;
    IF OLD.stage = 'paid' AND NEW.stage = 'signed' AND v_act <> 'tie_clear' THEN
      RAISE EXCEPTION 'That win cannot move from Paid to Accepted.' USING ERRCODE = '22023';
    END IF;
    IF OLD.stage = 'paid' AND NEW.stage = 'void' AND EXISTS (SELECT 1 FROM public.cockpit_payment_ties t
         WHERE t.win_id = OLD.id AND t.cleared_at IS NULL) THEN
      RAISE EXCEPTION 'Clear the payment tie first. Only the CEO voids a paid win.' USING ERRCODE = '22023';
    END IF;
  ELSIF OLD.stage = 'void' AND (NEW.agreement_url IS DISTINCT FROM OLD.agreement_url OR NEW.proof_url IS DISTINCT FROM OLD.proof_url) THEN
    RAISE EXCEPTION 'That win was voided.' USING ERRCODE = '22023';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cockpit_csm_wins_guard ON public.cockpit_csm_wins;
CREATE TRIGGER cockpit_csm_wins_guard BEFORE UPDATE ON public.cockpit_csm_wins
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_wins_guard();

-- ---------------------------------------------------------------------------
-- 3. The registry row "win" (a code-defined staff sheet, V13 of W34) and the
--    pay proposals switch, off (1.4). Existing keys win on a re-apply (2.1).

INSERT INTO public.cockpit_forms (key, title, audience, provider, typeform_id, version, schema, seats, client_scoped, effects, updated_by)
VALUES ('win', 'Log a win', 'team', 'native', NULL, 1,
  '{"key":"win","version":1,"lives":"cockpit",
    "fields":[{"key":"kind"},{"key":"wonOn"},{"key":"proofUrl"},{"key":"proposalId"},{"key":"quotedUsd"},{"key":"listUsd"},
              {"key":"belowListReason"},{"key":"recurring"},{"key":"monthlyUsd"},{"key":"agreementUrl"},
              {"key":"referralDealResponseId"},{"key":"note"}]}'::jsonb,
  ARRAY['csm'], true, '[]'::jsonb, 'migration 20261102h')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.cockpit_form_versions (form_key, version, schema, published_by, note)
SELECT f.key, 1, f.schema, 'migration 20261102h', 'A record of the Log a win sheet (FormSheet def win); set in code.'
  FROM public.cockpit_forms f WHERE f.key = 'win'
ON CONFLICT DO NOTHING;

INSERT INTO public.cockpit_settings AS s (key, value, updated_by)
VALUES ('pay.proposals', '{"on":false}'::jsonb, 'migration 20261102h')
ON CONFLICT (key) DO UPDATE SET value = excluded.value || s.value, updated_by = 'migration 20261102h', updated_at = now()
  WHERE NOT (s.value ?& ARRAY['on']);

-- ---------------------------------------------------------------------------
-- 4. Shared reads (owner only; the view and the RPCs call them)

-- The payments tied to a win: confirmed proposals whose tie is still live,
-- each with its check state (cockpit_payment_checked, the finance rule).
CREATE OR REPLACE FUNCTION public.cockpit_win_ties(p_win_id uuid)
RETURNS TABLE (proposal_id bigint, tie_id bigint, payment_id text, rail text, usd numeric, paid_on date, checked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT tp.id, tp.tie_id, tp.payment_id, tp.rail, tp.usd, tp.paid_on, public.cockpit_payment_checked(tp.payment_id, tp.rail)
    FROM public.cockpit_win_tie_proposals tp
    JOIN public.cockpit_payment_ties t ON t.id = tp.tie_id AND t.cleared_at IS NULL AND t.win_id = tp.win_id
   WHERE tp.win_id = p_win_id AND tp.state = 'confirmed'
   ORDER BY tp.paid_on, tp.id
$$;

-- The Kuwait day of a win's first event of a kind (offered, accepted, ...).
CREATE OR REPLACE FUNCTION public.cockpit_win_event_day(p_win_id uuid, p_event text)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (min(e.at) AT TIME ZONE 'Asia/Kuwait')::date FROM public.cockpit_csm_win_events e
   WHERE e.win_id = p_win_id AND e.event = p_event
$$;

-- The facts of the tied money in one value: totals, the first payment day
-- and each payment (no payer, no email).
CREATE OR REPLACE FUNCTION public.cockpit_win_tie_facts(p_win_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'tiedUsd', coalesce(round(sum(t.usd), 2), 0),
    'tiedCheckedUsd', coalesce(round(sum(t.usd) FILTER (WHERE t.checked), 2), 0),
    'paidOn', min(t.paid_on),
    'ties', coalesce(jsonb_agg(jsonb_build_object('paymentId', t.payment_id, 'rail', t.rail, 'usd', t.usd, 'paidOn', t.paid_on,
                                                  'checked', t.checked) ORDER BY t.paid_on, t.proposal_id), '[]'::jsonb))
  FROM public.cockpit_win_ties(p_win_id) t
$$;

-- The deal ledger row of a payment, if the last money refresh put one there.
CREATE OR REPLACE FUNCTION public.cockpit_win_deal_row(p_payment_id text)
RETURNS public.cockpit_deal_payments LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT dp.* FROM public.cockpit_deal_payments dp WHERE dp.payment_id = p_payment_id AND dp.active
   ORDER BY dp.recorded_at DESC LIMIT 1
$$;

-- A deal's own contract money (X33): a deposit row, deposit money on the row,
-- or a match by Whop's own deal link, the deal's email or name or a payer tie
-- (anything but a card match). A rule-2 card-match remainder is not.
CREATE OR REPLACE FUNCTION public.cockpit_win_contract_money(p_payment_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.cockpit_deal_payments dp
                  WHERE dp.payment_id = p_payment_id AND dp.active
                    AND (dp.kind = 'deposit' OR dp.deposit_usd > 0 OR dp.matched_by NOT LIKE 'card\_%'))
$$;

-- Closer commission already paid on a payment (X31): the payment is an active
-- deal ledger row whose month is on or before the closer's last approved pay
-- month. The closer is the deal's closer matched to the roster by name
-- (folded, one hit); a closer the roster does not name falls back to the
-- latest approved month of any closer seat, so cash is never paid twice.
CREATE OR REPLACE FUNCTION public.cockpit_win_closer_paid(p_payment_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE dp public.cockpit_deal_payments; v_closer text; v_person bigint; v_last date; v_month date;
BEGIN
  dp := public.cockpit_win_deal_row(p_payment_id);
  IF dp.payment_id IS NULL THEN RETURN NULL; END IF;
  v_month := date_trunc('month', dp.day)::date;
  SELECT d.closer INTO v_closer FROM public.cockpit_sales_deals d WHERE d.response_id = dp.deal_response_id;
  SELECT CASE WHEN count(*) = 1 THEN min(p.id) END INTO v_person
    FROM public.cockpit_people p WHERE public.cockpit_win_fold(p.name) = public.cockpit_win_fold(v_closer);
  IF v_person IS NOT NULL THEN
    v_last := public.cockpit_pay_last_approved(v_person);
  ELSE
    SELECT max(m.month) INTO v_last FROM public.cockpit_pay_months m JOIN public.cockpit_people p ON p.id = m.person_id
     WHERE m.status = 'approved' AND p.role ~* 'closer';
  END IF;
  IF v_last IS NOT NULL AND v_month <= v_last THEN
    RETURN jsonb_build_object('month', to_char(v_month, 'YYYY-MM'), 'closer', 'the closer');
  END IF;
  RETURN NULL;
END $$;

-- A part priced with a person's plan for a month, the way cockpit_pay_compute
-- reads it: per event = amount x quantity; share = cash x the rate of the
-- step whose fromMonth is the highest at or under the engagement month.
CREATE OR REPLACE FUNCTION public.cockpit_win_price(p_person bigint, p_month date, p_part text, p_quantity numeric,
  p_cash numeric, p_engagement integer)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE part jsonb; v_rate numeric;
BEGIN
  IF p_person IS NULL THEN RETURN NULL; END IF;
  part := (SELECT x FROM jsonb_array_elements(coalesce(public.cockpit_pay_plan_for(p_person, p_month)->'plan'->'parts', '[]'::jsonb)) x
            WHERE x->>'key' = p_part LIMIT 1);
  IF part IS NULL THEN RETURN NULL; END IF;
  IF part->>'kind' = 'per_event' AND jsonb_typeof(part->'amount') = 'number' AND p_quantity IS NOT NULL THEN
    RETURN round((part->>'amount')::numeric * p_quantity, 2);
  END IF;
  IF part->>'kind' = 'share' AND p_cash IS NOT NULL THEN
    SELECT (s->>'rate')::numeric INTO v_rate FROM jsonb_array_elements(coalesce(part->'steps', '[]'::jsonb)) s
     WHERE jsonb_typeof(s->'rate') = 'number' AND coalesce((s->>'fromMonth')::numeric, 1) <= coalesce(p_engagement, 1)
     ORDER BY coalesce((s->>'fromMonth')::numeric, 1) DESC LIMIT 1;
    RETURN CASE WHEN v_rate IS NULL THEN NULL ELSE round(p_cash * v_rate, 2) END;
  END IF;
  RETURN NULL;
END $$;

-- One win as the screens read it (3.3 WinRow). Never a payer or an email.
CREATE OR REPLACE FUNCTION public.cockpit_win_row(p_win_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.cockpit_csm_wins; f jsonb; v_pending jsonb; v_pay jsonb; v_invoice uuid; v_offer text;
BEGIN
  SELECT * INTO w FROM public.cockpit_csm_wins x WHERE x.id = p_win_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  f := public.cockpit_win_tie_facts(w.id);
  SELECT jsonb_build_object('id', tp.id, 'usd', tp.usd, 'paidOn', tp.paid_on) INTO v_pending
    FROM public.cockpit_win_tie_proposals tp WHERE tp.win_id = w.id AND tp.state = 'open' ORDER BY tp.id DESC LIMIT 1;
  SELECT i.id INTO v_invoice FROM public.cockpit_invoices i WHERE i.win_id = w.id ORDER BY i.requested_at DESC LIMIT 1;
  IF w.proposal_id IS NOT NULL THEN v_offer := public.cockpit_win_proposal_prices(w.proposal_id)->>'offer'; END IF;
  -- The pay state, from the proposals of every month since the win (4.9).
  IF w.stage = 'void' THEN
    v_pay := jsonb_build_object('state', 'none', 'why', NULL, 'amountUsd', NULL);
  ELSE
    SELECT CASE
      WHEN count(*) FILTER (WHERE r.state = 'confirmed') > 0 THEN
        jsonb_build_object('state', 'confirmed', 'why', NULL, 'amountUsd', sum(r.amount_usd) FILTER (WHERE r.state = 'confirmed'))
      WHEN count(*) FILTER (WHERE r.state = 'proposed') > 0 THEN
        jsonb_build_object('state', 'proposed', 'why', NULL, 'amountUsd', sum(r.amount_usd) FILTER (WHERE r.state = 'proposed'))
      WHEN count(*) FILTER (WHERE r.state = 'waiting') > 0 THEN
        jsonb_build_object('state', 'waiting', 'why', min(r.why) FILTER (WHERE r.state = 'waiting'), 'amountUsd', NULL)
      WHEN count(*) FILTER (WHERE r.state = 'declined') > 0 THEN
        jsonb_build_object('state', 'declined', 'why', min(r.why) FILTER (WHERE r.state = 'declined'), 'amountUsd', NULL)
      END INTO v_pay
      FROM generate_series(date_trunc('month', w.won_on)::date,
                           greatest(date_trunc('month', w.won_on)::date, date_trunc('month', public.cockpit_billing_today())::date),
                           interval '1 month') AS m(month)
      CROSS JOIN LATERAL public.cockpit_win_pay_rows(m.month::date) r
     WHERE r.win_id = w.id;
    v_pay := coalesce(v_pay, jsonb_build_object('state', 'none', 'why', NULL, 'amountUsd', NULL));
  END IF;
  RETURN jsonb_build_object(
    'id', w.id, 'kind', w.kind, 'kindLabel', public.cockpit_win_kind_label(w.kind), 'stage', w.stage,
    'stageLabel', public.cockpit_win_stage_label(w.stage), 'wonOn', w.won_on, 'proofUrl', w.proof_url,
    'proposalId', w.proposal_id, 'offer', v_offer, 'quotedUsd', w.quoted_usd, 'listUsd', w.list_usd,
    'recurring', w.recurring, 'monthlyUsd', w.monthly_usd, 'agreementUrl', w.agreement_url,
    'tiedUsd', (f->>'tiedUsd')::numeric, 'tiedCheckedUsd', (f->>'tiedCheckedUsd')::numeric,
    'tiePending', v_pending, 'invoiceId', v_invoice, 'pay', v_pay,
    'loggedByRole', w.logged_by_role, 'loggedAt', w.logged_at, 'voidReason', w.void_reason,
    'source', w.source, 'imported', w.source = 'import');
END $$;

-- One event on a win.
CREATE OR REPLACE FUNCTION public.cockpit_win_event(p_win_id uuid, p_event text, p_role text, p_email text, p_detail jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id bigint;
BEGIN
  PERFORM set_config('cockpit.wins_action', 'wins.event.' || p_event, true);
  INSERT INTO public.cockpit_csm_win_events(win_id, event, by_role, by_email, detail)
  VALUES (p_win_id, p_event, p_role, p_email, coalesce(jsonb_strip_nulls(p_detail), '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- The billing event kind "win" (3.5): the card comment rides the billing
-- rails, held until D-W puts the kind in the billing switch. No field write.
CREATE OR REPLACE FUNCTION public.cockpit_win_billing_event(p_win_id uuid, p_source text, p_email text, p_role text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.cockpit_csm_wins; v_id bigint;
BEGIN
  SELECT * INTO w FROM public.cockpit_csm_wins x WHERE x.id = p_win_id;
  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (w.task_id, w.client_name, 'win', NULL, w.stage, public.cockpit_win_kind_label(w.kind),
          jsonb_strip_nulls(jsonb_build_object('win_id', w.id, 'kind', w.kind, 'stage', w.stage, 'won_on', w.won_on,
            'proof_url', w.proof_url, 'quoted_usd', w.quoted_usd, 'agreement', w.agreement_url, 'seat_role', p_role)),
          p_source, coalesce(p_email, 'cockpit'))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- The notice win.logged (3.9): facts only, never an email; one per win and stage.
CREATE OR REPLACE FUNCTION public.cockpit_win_notice(p_win_id uuid, p_role text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.cockpit_csm_wins; v_offer text;
BEGIN
  SELECT * INTO w FROM public.cockpit_csm_wins x WHERE x.id = p_win_id;
  IF w.source = 'canary' THEN RETURN NULL; END IF;
  IF w.proposal_id IS NOT NULL THEN v_offer := public.cockpit_win_proposal_prices(w.proposal_id)->>'offer'; END IF;
  RETURN public.cockpit_billing_notice('win.logged',
    'win:' || w.id::text || CASE WHEN w.stage = 'signed' THEN ':accepted' ELSE '' END,
    w.task_id, w.client_name,
    jsonb_strip_nulls(jsonb_build_object('winId', w.id, 'kind', w.kind, 'kindLabel', public.cockpit_win_kind_label(w.kind),
      'stage', w.stage, 'usd', w.quoted_usd, 'offer', coalesce(v_offer, public.cockpit_win_kind_label(w.kind)), 'seatRole', p_role)));
END $$;

-- ---------------------------------------------------------------------------
-- 5. Log a win (3.3)

CREATE OR REPLACE FUNCTION public.cockpit_csm_win_log(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb; v_task text; v_req uuid; v_first public.cockpit_csm_wins; v_client text; v_canary boolean;
  v_kind text; v_upsell boolean; v_won date; v_today date := public.cockpit_billing_today();
  v_proof text; v_agreement text; v_proposal uuid; v_prices jsonb; v_quoted numeric; v_list numeric; v_below text;
  v_recurring boolean; v_monthly numeric; v_deal text; v_note text; v_confirm boolean; v_hit record;
  v_stage text; v_id uuid; v_role text; v_email text; v_source text; v_next text;
  v_form public.cockpit_forms; v_answers jsonb; v_event bigint; v_response uuid;
BEGIN
  PERFORM public.cockpit_win_only(p, ARRAY['requestId','taskId','kind','wonOn','proofUrl','proposalId','quotedUsd','listUsd',
    'belowListReason','recurring','monthlyUsd','agreementUrl','referralDealResponseId','note','confirmDuplicate']);
  v_task := btrim(coalesce(p->>'taskId', ''));
  v_seat := public.cockpit_win_seat(v_task);
  v_role := v_seat->>'role'; v_email := v_seat->>'email'; v_source := v_seat->>'source';
  v_req := public.cockpit_win_uuid(p, 'requestId');
  IF v_req IS NULL THEN RAISE EXCEPTION 'That form is out of date. Reload the page and send it again.' USING ERRCODE = '22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_csm_wins:' || v_task, 0));

  -- One request, one win: a retry returns the first.
  SELECT * INTO v_first FROM public.cockpit_csm_wins w WHERE w.request_id = v_req;
  IF FOUND THEN
    IF v_first.task_id IS DISTINCT FROM v_task THEN
      RAISE EXCEPTION 'That could not be read. Reload the page and try again.' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('ok', true, 'repeat', true, 'winId', v_first.id, 'stage', v_first.stage, 'sentence', 'Already saved.');
  END IF;

  v_canary := v_task = public.cockpit_win_canary_card();
  IF NOT public.cockpit_win_door_open() AND NOT (v_canary AND (v_seat->>'ceo')::boolean) THEN
    RAISE EXCEPTION 'Log a win opens after its switch-on.' USING ERRCODE = '22023';
  END IF;
  SELECT a.client_name INTO v_client FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = v_task;
  IF v_client IS NULL AND v_canary THEN v_client := 'Test card'; END IF;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'That client card is not on the billing sheet. Refresh the page and pick it again.' USING ERRCODE = 'P0002';
  END IF;

  v_kind := nullif(btrim(coalesce(p->>'kind', '')), '');
  IF v_kind IS NULL OR public.cockpit_win_kind_label(v_kind) IS NULL THEN
    RAISE EXCEPTION 'Choose what kind of win this is.' USING ERRCODE = '22023';
  END IF;
  v_upsell := public.cockpit_win_is_upsell(v_kind);
  BEGIN
    v_won := CASE WHEN p->>'wonOn' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (p->>'wonOn')::date END;
  EXCEPTION WHEN others THEN v_won := NULL;
  END;
  IF v_won IS NULL OR v_won > v_today OR v_won < v_today - 30 THEN
    RAISE EXCEPTION 'The win date is today or within the last 30 days.' USING ERRCODE = '22023';
  END IF;
  v_proof := public.cockpit_win_link(p, 'proofUrl');
  v_agreement := public.cockpit_win_link(p, 'agreementUrl');
  IF p ? 'note' AND p->'note' <> 'null'::jsonb AND jsonb_typeof(p->'note') <> 'string' THEN
    RAISE EXCEPTION 'The note is text.' USING ERRCODE = '22023';
  END IF;
  v_note := nullif(btrim(coalesce(p->>'note', '')), '');
  IF char_length(v_note) > 500 THEN RAISE EXCEPTION 'Keep the note to 500 characters.' USING ERRCODE = '22023'; END IF;
  v_confirm := coalesce(p->'confirmDuplicate' = 'true'::jsonb, false);

  -- Proof per kind (4.2.2).
  IF v_kind = 'review' AND v_proof IS NULL THEN RAISE EXCEPTION 'Add the review link or a screenshot link.' USING ERRCODE = '22023'; END IF;
  IF v_kind = 'video_testimonial' AND v_proof IS NULL THEN RAISE EXCEPTION 'Add the video link.' USING ERRCODE = '22023'; END IF;
  IF v_kind = 'podcast' AND v_proof IS NULL THEN RAISE EXCEPTION 'Add the episode link.' USING ERRCODE = '22023'; END IF;
  IF v_kind = 'referral' THEN
    v_deal := nullif(btrim(coalesce(p->>'referralDealResponseId', '')), '');
    IF v_deal IS NULL OR NOT EXISTS (SELECT 1 FROM public.cockpit_sales_deals d
         WHERE d.response_id = v_deal AND d.submitted_at IS NOT NULL AND NOT d.voided) THEN
      RAISE EXCEPTION 'Pick the referred client''s signed deal.' USING ERRCODE = '22023';
    END IF;
    SELECT w.won_on INTO v_hit FROM public.cockpit_csm_wins w
     WHERE w.referral_deal_response_id = v_deal AND w.stage <> 'void' ORDER BY w.won_on LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'That deal is already logged as a referral win on %.', public.cockpit_billing_day_words(v_hit.won_on) USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_kind IN ('renewal', 'reactivation') AND v_agreement IS NULL THEN
    v_next := 'Add the agreement link or tie a payment later.';
  END IF;
  -- A hand-logged reactivation never doubles a Reactivate (4.3.6).
  IF v_kind = 'reactivation' THEN
    SELECT w.won_on INTO v_hit FROM public.cockpit_csm_wins w
     WHERE w.task_id = v_task AND w.kind = 'reactivation' AND w.stage <> 'void'
       AND (w.departure_id IS NOT NULL OR w.source = 'reactivate') AND w.won_on >= v_won - 60
     ORDER BY w.won_on DESC LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION '% was reopened on % and that return already has its win.', v_client, public.cockpit_billing_day_words(v_hit.won_on)
        USING ERRCODE = '22023';
    END IF;
  END IF;
  -- A second review or renewal within 30 days asks first; nothing is stored.
  IF v_kind IN ('review', 'renewal') AND NOT v_confirm THEN
    SELECT w.won_on INTO v_hit FROM public.cockpit_csm_wins w
     WHERE w.task_id = v_task AND w.kind = v_kind AND w.stage <> 'void' AND w.won_on BETWEEN v_won - 30 AND v_won + 30
     ORDER BY w.won_on DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', false, 'warning',
        format('A %s was logged for %s on %s. Log this one too?', CASE v_kind WHEN 'review' THEN 'Google review' ELSE 'renewal' END,
               v_client, public.cockpit_billing_day_words(v_hit.won_on)));
    END IF;
  END IF;

  -- Upsells: offered from a sent proposal, or with a proof link and a price.
  IF v_upsell THEN
    v_proposal := public.cockpit_win_uuid(p, 'proposalId');
    IF v_proposal IS NOT NULL THEN
      v_prices := public.cockpit_win_proposal_prices(v_proposal);
      IF v_prices IS NULL OR NOT EXISTS (SELECT 1 FROM public.cockpit_upsell_proposals u WHERE u.id = v_proposal AND u.task_id = v_task) THEN
        RAISE EXCEPTION 'That proposal is not on this client.' USING ERRCODE = '22023';
      END IF;
      IF v_prices->>'status' = 'draft' THEN RAISE EXCEPTION 'Send the proposal first. A draft is not a win.' USING ERRCODE = '22023'; END IF;
      IF v_prices->>'status' NOT IN ('sent', 'link_copied', 'accepted') THEN
        RAISE EXCEPTION 'That proposal was archived or set to not now. Open a new one to mark it offered.' USING ERRCODE = '22023';
      END IF;
      SELECT w.won_on INTO v_hit FROM public.cockpit_csm_wins w WHERE w.proposal_id = v_proposal AND w.stage <> 'void' LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'That proposal is already marked as offered on %.', public.cockpit_billing_day_words(v_hit.won_on) USING ERRCODE = '22023';
      END IF;
    ELSIF v_proof IS NULL THEN
      RAISE EXCEPTION 'Add a link that shows the offer, or mark it offered from its sent proposal.' USING ERRCODE = '22023';
    END IF;
    v_quoted := coalesce(public.cockpit_win_usd(p, 'quotedUsd'), (v_prices->>'quoted')::numeric);
    IF v_quoted IS NULL OR v_quoted <= 0 OR v_quoted > 1000000 THEN RAISE EXCEPTION 'Add the quoted price.' USING ERRCODE = '22023'; END IF;
    v_list := coalesce(public.cockpit_win_usd(p, 'listUsd'), (v_prices->>'list')::numeric);
    IF v_list IS NOT NULL AND (v_list <= 0 OR v_list > 1000000) THEN v_list := NULL; END IF;
    v_below := nullif(btrim(coalesce(p->>'belowListReason', '')), '');
    IF v_list IS NOT NULL AND v_quoted < v_list AND (v_below IS NULL OR char_length(v_below) NOT BETWEEN 3 AND 140) THEN
      RAISE EXCEPTION 'Say why the price is below the list price.' USING ERRCODE = '22023';
    END IF;
    IF v_list IS NULL OR v_quoted >= v_list THEN v_below := NULL; END IF;
    IF p ? 'recurring' AND p->'recurring' <> 'null'::jsonb THEN
      IF jsonb_typeof(p->'recurring') <> 'boolean' THEN RAISE EXCEPTION 'Say whether it is paid monthly.' USING ERRCODE = '22023'; END IF;
      v_recurring := (p->>'recurring')::boolean;
    ELSE
      v_recurring := coalesce((v_prices->>'monthly')::numeric, 0) > 0;
    END IF;
    IF v_recurring THEN
      v_monthly := coalesce(public.cockpit_win_usd(p, 'monthlyUsd'), (v_prices->>'monthly')::numeric);
      IF v_monthly IS NULL OR v_monthly <= 0 OR v_monthly > 1000000 THEN RAISE EXCEPTION 'Add the monthly price.' USING ERRCODE = '22023'; END IF;
    END IF;
    v_stage := 'quote_given';
  ELSE
    v_stage := 'logged';
  END IF;

  PERFORM set_config('cockpit.wins_action', 'wins.logged', true);
  INSERT INTO public.cockpit_csm_wins(request_id, task_id, client_name, kind, stage, won_on, proof_url, proposal_id, quoted_usd, list_usd,
    below_list_reason, recurring, monthly_usd, agreement_url, referral_deal_response_id, csm_person_id, note, source,
    logged_by, logged_by_email, logged_by_role)
  VALUES (v_req, v_task, v_client, v_kind, v_stage, v_won, v_proof, v_proposal, v_quoted, v_list, v_below,
    coalesce(v_recurring, false), v_monthly, CASE WHEN v_upsell THEN NULL ELSE v_agreement END, v_deal,
    public.cockpit_win_csm_person(v_task), v_note, CASE WHEN v_canary THEN 'canary' ELSE 'cockpit' END,
    (v_seat->>'uid')::uuid, v_email, v_role)
  RETURNING id INTO v_id;
  PERFORM public.cockpit_win_event(v_id, CASE WHEN v_upsell THEN 'offered' ELSE 'logged' END, v_role, v_email,
    jsonb_build_object('request_id', v_req, 'proposal_id', v_proposal, 'quoted_usd', v_quoted));
  -- An upsell with its agreement at log: offered, then accepted in the same call.
  IF v_upsell AND v_agreement IS NOT NULL THEN
    PERFORM set_config('cockpit.wins_action', 'wins.accepted', true);
    UPDATE public.cockpit_csm_wins SET agreement_url = v_agreement, stage = 'signed' WHERE id = v_id;
    PERFORM public.cockpit_win_event(v_id, 'accepted', v_role, v_email, jsonb_build_object('request_id', v_req, 'at_log', true));
    v_stage := 'signed';
  END IF;

  v_event := public.cockpit_win_billing_event(v_id, v_source, v_email, v_role);
  PERFORM public.cockpit_win_notice(v_id, v_role);
  -- The history the forms pages read: one confirmed response per request.
  SELECT * INTO v_form FROM public.cockpit_forms f WHERE f.key = 'win';
  v_answers := (p - 'confirmDuplicate' - 'requestId' - 'taskId') || jsonb_build_object('winId', v_id, 'stage', v_stage);
  PERFORM set_config('cockpit.forms_action', 'forms.staff_recorded', true);
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
    answers, created_by, created_by_id, submitted_by, submitted_at, confirmed_by, confirmed_at)
  VALUES ('win', v_form.version, 'cockpit', 'req:' || v_req::text, v_task, v_client, 'live', 'confirmed',
    v_answers, coalesce(v_email, 'cockpit'), (v_seat->>'uid')::uuid, coalesce(v_email, 'cockpit'), now(), coalesce(v_email, 'cockpit'), now())
  ON CONFLICT (form_key, external_id) DO NOTHING
  RETURNING id INTO v_response;

  -- eventId and responseId are what the after-send trail follows (cockpit_form_trail).
  RETURN jsonb_strip_nulls(jsonb_build_object('ok', true, 'winId', v_id, 'stage', v_stage, 'eventId', v_event, 'responseId', v_response,
    'sentence', CASE WHEN v_stage = 'signed' THEN 'Marked as accepted.' WHEN v_upsell THEN 'Marked as offered.' ELSE 'Logged.' END,
    'next', v_next));
END $$;

-- ---------------------------------------------------------------------------
-- 6. Stage moves: accept, void, add proof (3.3)

CREATE OR REPLACE FUNCTION public.cockpit_csm_win_stage(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_req uuid; v_win uuid; w public.cockpit_csm_wins; v_seat jsonb; v_act text; v_role text; v_email text;
  v_agreement text; v_proof text; v_reason text; v_ceo boolean; v_done record;
BEGIN
  PERFORM public.cockpit_win_only(p, ARRAY['requestId','winId','act','agreementUrl','reason','proofUrl']);
  v_req := public.cockpit_win_uuid(p, 'requestId');
  v_win := public.cockpit_win_uuid(p, 'winId');
  IF v_req IS NULL OR v_win IS NULL THEN RAISE EXCEPTION 'That form is out of date. Reload the page and send it again.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO w FROM public.cockpit_csm_wins x WHERE x.id = v_win;
  IF NOT FOUND THEN RAISE EXCEPTION 'That win is not in the ledger. Reload the page.' USING ERRCODE = '22023'; END IF;
  v_seat := public.cockpit_win_seat(w.task_id);
  v_role := v_seat->>'role'; v_email := v_seat->>'email'; v_ceo := (v_seat->>'ceo')::boolean;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_csm_wins:' || w.task_id, 0));
  SELECT * INTO w FROM public.cockpit_csm_wins x WHERE x.id = v_win FOR UPDATE;
  -- A repeat press returns what the first did.
  SELECT e.event INTO v_done FROM public.cockpit_csm_win_events e WHERE e.win_id = w.id AND e.detail->>'request_id' = v_req::text LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'repeat', true, 'winId', w.id, 'stage', w.stage, 'sentence', 'Already saved.');
  END IF;
  IF NOT public.cockpit_win_door_open() AND NOT (w.source = 'canary' AND v_ceo) THEN
    RAISE EXCEPTION 'Log a win opens after its switch-on.' USING ERRCODE = '22023';
  END IF;
  v_act := coalesce(p->>'act', '');
  IF v_act = 'accept' THEN
    IF w.stage <> 'quote_given' THEN
      RAISE EXCEPTION 'Only an offered upsell is marked accepted. This one is %.', lower(public.cockpit_win_stage_label(w.stage)) USING ERRCODE = '22023';
    END IF;
    v_agreement := public.cockpit_win_link(p, 'agreementUrl');
    IF v_agreement IS NULL THEN RAISE EXCEPTION 'Add the signed agreement link to mark it accepted.' USING ERRCODE = '22023'; END IF;
    PERFORM set_config('cockpit.wins_action', 'wins.accepted', true);
    UPDATE public.cockpit_csm_wins SET agreement_url = v_agreement, stage = 'signed' WHERE id = w.id;
    PERFORM public.cockpit_win_event(w.id, 'accepted', v_role, v_email, jsonb_build_object('request_id', v_req));
    PERFORM public.cockpit_win_billing_event(w.id, v_seat->>'source', v_email, v_role);
    PERFORM public.cockpit_win_notice(w.id, v_role);
    RETURN jsonb_build_object('ok', true, 'winId', w.id, 'stage', 'signed', 'sentence', 'Marked as accepted.');
  ELSIF v_act = 'void' THEN
    v_reason := btrim(coalesce(p->>'reason', ''));
    IF char_length(v_reason) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'Say why in 3 to 300 characters.' USING ERRCODE = '22023'; END IF;
    IF w.stage = 'void' THEN RAISE EXCEPTION 'That win is already voided.' USING ERRCODE = '22023'; END IF;
    IF w.stage = 'paid' AND (NOT v_ceo OR EXISTS (SELECT 1 FROM public.cockpit_payment_ties t WHERE t.win_id = w.id AND t.cleared_at IS NULL)) THEN
      RAISE EXCEPTION 'Clear the payment tie first. Only the CEO voids a paid win.' USING ERRCODE = '22023';
    END IF;
    PERFORM set_config('cockpit.wins_action', 'wins.voided', true);
    UPDATE public.cockpit_csm_wins SET stage = 'void', voided_by = coalesce(v_email, v_role), voided_at = now(), void_reason = v_reason
     WHERE id = w.id;
    UPDATE public.cockpit_win_tie_proposals SET state = 'withdrawn', decided_by = coalesce(v_email, v_role), decided_at = now(),
           reason = 'The win was voided.'
     WHERE win_id = w.id AND state = 'open';
    PERFORM public.cockpit_win_event(w.id, 'voided', v_role, v_email, jsonb_build_object('request_id', v_req, 'reason', v_reason));
    RETURN jsonb_build_object('ok', true, 'winId', w.id, 'stage', 'void', 'sentence', 'Voided.');
  ELSIF v_act = 'proof' THEN
    IF w.stage = 'void' THEN RAISE EXCEPTION 'That win was voided.' USING ERRCODE = '22023'; END IF;
    v_proof := public.cockpit_win_link(p, 'proofUrl');
    v_agreement := CASE WHEN w.kind IN ('renewal', 'reactivation') THEN public.cockpit_win_link(p, 'agreementUrl') END;
    IF v_proof IS NULL AND v_agreement IS NULL THEN RAISE EXCEPTION 'Add the link.' USING ERRCODE = '22023'; END IF;
    PERFORM set_config('cockpit.wins_action', 'wins.proof_added', true);
    UPDATE public.cockpit_csm_wins SET proof_url = coalesce(v_proof, proof_url), agreement_url = coalesce(v_agreement, agreement_url)
     WHERE id = w.id;
    PERFORM public.cockpit_win_event(w.id, 'proof_added', v_role, v_email,
      jsonb_build_object('request_id', v_req, 'proof', v_proof IS NOT NULL, 'agreement', v_agreement IS NOT NULL));
    RETURN jsonb_build_object('ok', true, 'winId', w.id, 'stage', w.stage, 'sentence', 'Saved.');
  END IF;
  RAISE EXCEPTION 'Choose accept, void or proof.' USING ERRCODE = '22023';
END $$;

-- ---------------------------------------------------------------------------
-- 7. Reads (3.3)

CREATE OR REPLACE FUNCTION public.cockpit_csm_wins_read(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seat jsonb := public.cockpit_win_seat(p_task_id);
BEGIN
  RETURN jsonb_build_object(
    'wins', coalesce((SELECT jsonb_agg(public.cockpit_win_row(w.id) ORDER BY w.won_on DESC, w.logged_at DESC)
                        FROM public.cockpit_csm_wins w WHERE w.task_id = p_task_id), '[]'::jsonb),
    'acceptedProposals', coalesce((SELECT jsonb_agg(jsonb_build_object('proposalId', u.id,
                                     'offerName', public.cockpit_win_proposal_prices(u.id)->>'offer', 'acceptedAt', u.updated_at)
                                     ORDER BY u.updated_at DESC)
                                     FROM public.cockpit_upsell_proposals u
                                    WHERE u.task_id = p_task_id AND u.status = 'accepted'
                                      AND NOT EXISTS (SELECT 1 FROM public.cockpit_csm_wins w
                                                       WHERE w.proposal_id = u.id AND w.stage IN ('signed', 'paid'))), '[]'::jsonb),
    -- What Log a win picks from (5.2): this card's sent proposals at their sent prices, and the
    -- signed deals of the last 120 days not yet logged as a referral (the referred client's deal).
    'proposals', coalesce((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'offerName', pr->>'offer', 'status', u.status,
                             'totalUsd', (pr->>'quoted')::numeric, 'listUsd', (pr->>'list')::numeric, 'sentAt', u.sent_at)
                             ORDER BY u.sent_at DESC NULLS LAST)
                             FROM public.cockpit_upsell_proposals u
                             CROSS JOIN LATERAL public.cockpit_win_proposal_prices(u.id) pr
                            WHERE u.task_id = p_task_id AND u.status IN ('sent', 'link_copied', 'accepted')), '[]'::jsonb),
    'referralDeals', coalesce((SELECT jsonb_agg(jsonb_build_object('responseId', d.response_id,
                                 'business', coalesce(nullif(btrim(d.business_name), ''), nullif(btrim(d.client_name), ''), 'A signed client'),
                                 'signedOn', (d.submitted_at AT TIME ZONE 'Asia/Kuwait')::date)
                                 ORDER BY d.submitted_at DESC)
                                 FROM public.cockpit_sales_deals d
                                WHERE d.submitted_at IS NOT NULL AND NOT d.voided
                                  AND d.submitted_at >= now() - interval '120 days'
                                  AND NOT EXISTS (SELECT 1 FROM public.cockpit_csm_wins w
                                                   WHERE w.referral_deal_response_id = d.response_id AND w.stage <> 'void')), '[]'::jsonb),
    'doorOpen', public.cockpit_win_door_open(),
    'seatRole', v_seat->>'role');
END $$;

-- Every card for the CEO, a CSM's own cards (cockpit_client_allowed). Default
-- window: the Kuwait month to date.
CREATE OR REPLACE FUNCTION public.cockpit_csm_wins_list(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ceo boolean; v_from date; v_to date; v_rows jsonb; v_totals jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to work with wins.' USING ERRCODE = '42501'; END IF;
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT v_ceo AND NOT coalesce(public.cockpit_has_role('csm'), false) THEN
    RAISE EXCEPTION 'Wins need a client success or CEO seat. Ask an admin to add the role.' USING ERRCODE = '42501';
  END IF;
  v_to := coalesce(p_to, public.cockpit_billing_today());
  v_from := coalesce(p_from, date_trunc('month', v_to)::date);
  IF v_from > v_to OR v_to - v_from > 400 THEN RAISE EXCEPTION 'Choose a window of up to 400 days.' USING ERRCODE = '22023'; END IF;
  WITH mine AS (
    SELECT w.* FROM public.cockpit_csm_wins w
     WHERE (v_ceo OR (w.source <> 'canary' AND coalesce(public.cockpit_client_allowed(w.client_name), false)))
  ), events AS (
    SELECT e.event, (e.at AT TIME ZONE 'Asia/Kuwait')::date AS day, m.id
      FROM mine m JOIN public.cockpit_csm_win_events e ON e.win_id = m.id
     WHERE m.stage <> 'void' AND e.event IN ('offered', 'accepted')
  )
  SELECT
    coalesce((SELECT jsonb_agg(public.cockpit_win_row(m.id) || jsonb_build_object('taskId', m.task_id, 'client', m.client_name)
                               ORDER BY m.won_on DESC, m.logged_at DESC)
                FROM mine m WHERE m.won_on BETWEEN v_from AND v_to), '[]'::jsonb),
    jsonb_build_object(
      'byKind', coalesce((SELECT jsonb_object_agg(k.kind, k.n) FROM (SELECT m.kind, count(*) n FROM mine m
                           WHERE m.stage <> 'void' AND m.won_on BETWEEN v_from AND v_to GROUP BY m.kind) k), '{}'::jsonb),
      'upsellsOffered', (SELECT count(DISTINCT e.id) FROM events e WHERE e.event = 'offered' AND e.day BETWEEN v_from AND v_to),
      'upsellsAccepted', (SELECT count(DISTINCT e.id) FROM events e WHERE e.event = 'accepted' AND e.day BETWEEN v_from AND v_to),
      'upsellCashChecked', coalesce((SELECT round(sum(t.usd), 2) FROM mine m CROSS JOIN LATERAL public.cockpit_win_ties(m.id) t
                                      WHERE m.stage <> 'void' AND t.checked AND t.paid_on BETWEEN v_from AND v_to), 0))
    INTO v_rows, v_totals;
  RETURN jsonb_build_object('from', v_from, 'to', v_to, 'wins', v_rows, 'totals', v_totals);
END $$;

-- The Today bands of 4.3: accepted with no agreement, an invoice paid but not
-- tied (Ecom: the paid E-Link of the invoice), and for the CEO, ties waiting.
CREATE OR REPLACE FUNCTION public.cockpit_csm_wins_today()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ceo boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to work with wins.' USING ERRCODE = '42501'; END IF;
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT v_ceo AND NOT coalesce(public.cockpit_has_role('csm'), false) THEN
    RAISE EXCEPTION 'Wins need a client success or CEO seat. Ask an admin to add the role.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('rows', coalesce((
    SELECT jsonb_agg(r ORDER BY r->>'kind', r->>'client') FROM (
      SELECT jsonb_build_object('kind', 'accepted_no_agreement', 'taskId', u.task_id, 'client', u.client_name, 'proposalId', u.id,
               'winId', (SELECT w.id FROM public.cockpit_csm_wins w WHERE w.proposal_id = u.id AND w.stage = 'quote_given' LIMIT 1),
               'sentence', 'Client accepted: send the agreement') AS r
        FROM public.cockpit_upsell_proposals u
       WHERE u.status = 'accepted'
         AND NOT EXISTS (SELECT 1 FROM public.cockpit_csm_wins w WHERE w.proposal_id = u.id AND w.stage IN ('signed', 'paid'))
         AND (v_ceo OR coalesce(public.cockpit_client_allowed(u.client_name), false))
      UNION ALL
      SELECT jsonb_build_object('kind', 'invoice_paid_untied', 'taskId', w.task_id, 'client', w.client_name, 'winId', w.id,
               'invoiceId', i.id, 'paymentId', 'ecom:' || e.id,
               'sentence', format('Invoice paid: tie it to the %s', coalesce(public.cockpit_win_proposal_prices(w.proposal_id)->>'offer',
                                                                      public.cockpit_win_kind_label(w.kind))),
               'action', 'Tie the payment')
        FROM public.cockpit_invoices i
        JOIN public.cockpit_csm_wins w ON w.id = i.win_id AND w.stage IN ('signed', 'paid')
        JOIN public.cockpit_ecom_invoices e ON e.cockpit_invoice_id = i.id AND e.status = 'PAID'
       WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_win_tie_proposals tp
                          WHERE tp.payment_id = 'ecom:' || e.id AND tp.state IN ('open', 'confirmed'))
         AND NOT EXISTS (SELECT 1 FROM public.cockpit_payment_ties t WHERE t.payment_id = 'ecom:' || e.id AND t.cleared_at IS NULL)
         AND (v_ceo OR coalesce(public.cockpit_client_allowed(w.client_name), false))
      UNION ALL
      SELECT jsonb_build_object('kind', 'tie_waiting', 'taskId', w.task_id, 'client', w.client_name, 'winId', w.id,
               'proposalId', tp.id, 'usd', tp.usd, 'paidOn', tp.paid_on, 'proposedAt', tp.proposed_at, 'rail', tp.rail,
               'offer', coalesce(public.cockpit_win_proposal_prices(w.proposal_id)->>'offer', public.cockpit_win_kind_label(w.kind)),
               'checked', coalesce(public.cockpit_payment_checked(tp.payment_id, tp.rail), false),
               'inDealLedger', EXISTS (SELECT 1 FROM public.cockpit_deal_payments dp WHERE dp.payment_id = tp.payment_id AND dp.active),
               'sentence', format('Confirm the %s payment for the %s', public.cockpit_billing_usd_words(tp.usd),
                                  public.cockpit_win_kind_label(w.kind)))
        FROM public.cockpit_win_tie_proposals tp JOIN public.cockpit_csm_wins w ON w.id = tp.win_id
       WHERE v_ceo AND tp.state = 'open'
    ) x), '[]'::jsonb));
END $$;

-- ---------------------------------------------------------------------------
-- 8. Ties: candidates, the CSM's proposal, the CEO's confirm or decline, the
--    CEO's clear, the invoice link (3.3, 4.3, X3, X4, X31, X33)

-- Payments on the win's card since 30 days before the win, with no live tie,
-- not waiting on another proposal, and not a deal's own contract money. Read
-- from the last published money section and, for a payment logged by hand
-- since, from the hand-logged ledger. A CSM never sees the payer.
CREATE OR REPLACE FUNCTION public.cockpit_win_candidate_rows(p_win_id uuid, p_ceo boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH w AS (SELECT * FROM public.cockpit_csm_wins x WHERE x.id = p_win_id),
  section AS (
    SELECT t->>'id' AS payment_id, coalesce(t->>'rail', split_part(t->>'id', ':', 1)) AS rail,
           round((t->>'usd')::numeric, 2) AS usd, (t->>'day')::date AS paid_on,
           -- A hand-logged payment's check state is read from its ledger row (it may have been checked since the refresh).
           CASE WHEN t->>'id' LIKE 'manual:%' OR NOT (t ? 'checked') THEN public.cockpit_payment_checked(t->>'id', t->>'rail')
                ELSE (t->>'checked')::boolean END AS checked,
           nullif(t->>'payerName', '') AS payer
      FROM public.cockpit_sections s CROSS JOIN w
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.payload#>'{attribution,transactions}') = 'array'
                                                   THEN s.payload#>'{attribution,transactions}' ELSE '[]'::jsonb END) t
     WHERE s.key = 'money' AND t->>'direction' = 'in' AND t->>'clientTaskId' = w.task_id
       AND t->>'day' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND (t->>'day')::date >= w.won_on - 30
       AND jsonb_typeof(t->'usd') = 'number' AND (t->>'usd')::numeric > 0
  ),
  manual AS (
    SELECT 'manual:' || m.id AS payment_id, 'manual'::text AS rail, round(m.amount_usd, 2) AS usd, m.day AS paid_on,
           public.cockpit_payment_checked('manual:' || m.id, 'manual') AS checked, nullif(m.client_name, '') AS payer
      FROM public.cockpit_manual_payments m CROSS JOIN w
     WHERE m.clickup_task_id = w.task_id AND m.deleted_at IS NULL AND m.kind <> 'refund' AND m.check_state <> 'rejected'
       AND m.day >= w.won_on - 30 AND m.amount_usd > 0
       AND NOT EXISTS (SELECT 1 FROM section s WHERE s.payment_id = 'manual:' || m.id)
  ),
  every AS (SELECT * FROM section UNION ALL SELECT * FROM manual)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'paymentId', e.payment_id, 'rail', e.rail, 'usd', e.usd, 'paidOn', e.paid_on, 'checked', coalesce(e.checked, false),
           'inDealLedger', (SELECT jsonb_build_object('closerRole', 'the closer', 'month', to_char(dp.day, 'YYYY-MM'))
                              FROM public.cockpit_deal_payments dp WHERE dp.payment_id = e.payment_id AND dp.active LIMIT 1),
           'closerPaidMonth', public.cockpit_win_closer_paid(e.payment_id)->>'month',
           'payer', CASE WHEN p_ceo THEN e.payer END) ORDER BY e.paid_on DESC, e.payment_id), '[]'::jsonb)
    FROM every e
   WHERE e.payment_id ~ '^(whop|tap|ecom|transfer|bank|manual):[A-Za-z0-9_.-]+$'
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_payment_ties t WHERE t.payment_id = e.payment_id AND t.cleared_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_win_tie_proposals tp WHERE tp.payment_id = e.payment_id AND tp.state = 'open')
     AND NOT public.cockpit_win_contract_money(e.payment_id)
$$;

CREATE OR REPLACE FUNCTION public.cockpit_win_tie_candidates(p_win_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.cockpit_csm_wins; v_seat jsonb;
BEGIN
  SELECT * INTO w FROM public.cockpit_csm_wins x WHERE x.id = p_win_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That win is not in the ledger. Reload the page.' USING ERRCODE = '22023'; END IF;
  v_seat := public.cockpit_win_seat(w.task_id);
  RETURN public.cockpit_win_candidate_rows(w.id, (v_seat->>'ceo')::boolean);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_win_tie_propose(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_req uuid; v_win uuid; v_payment text; w public.cockpit_csm_wins; v_seat jsonb; v_role text; v_email text;
  c jsonb; v_id bigint; v_done record;
BEGIN
  PERFORM public.cockpit_win_only(p, ARRAY['requestId','winId','paymentId']);
  v_req := public.cockpit_win_uuid(p, 'requestId');
  v_win := public.cockpit_win_uuid(p, 'winId');
  v_payment := btrim(coalesce(p->>'paymentId', ''));
  IF v_req IS NULL OR v_win IS NULL THEN RAISE EXCEPTION 'That form is out of date. Reload the page and send it again.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO w FROM public.cockpit_csm_wins x WHERE x.id = v_win;
  IF NOT FOUND THEN RAISE EXCEPTION 'That win is not in the ledger. Reload the page.' USING ERRCODE = '22023'; END IF;
  v_seat := public.cockpit_win_seat(w.task_id);
  v_role := v_seat->>'role'; v_email := v_seat->>'email';
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_csm_wins:' || w.task_id, 0));
  SELECT tp.id, tp.state INTO v_done FROM public.cockpit_csm_win_events e JOIN public.cockpit_win_tie_proposals tp
      ON tp.id = (e.detail->>'proposal_id')::bigint
   WHERE e.win_id = w.id AND e.event = 'tie_proposed' AND e.detail->>'request_id' = v_req::text LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'repeat', true, 'proposalId', v_done.id, 'sentence', 'Sent to the CEO to confirm.');
  END IF;
  IF NOT public.cockpit_win_door_open() AND NOT (w.source = 'canary' AND (v_seat->>'ceo')::boolean) THEN
    RAISE EXCEPTION 'Log a win opens after its switch-on.' USING ERRCODE = '22023';
  END IF;
  -- An accepted upsell takes its first payment; a paid one takes its later months.
  IF w.stage NOT IN ('signed', 'paid') THEN RAISE EXCEPTION 'Mark it accepted first.' USING ERRCODE = '22023'; END IF;
  SELECT x INTO c FROM jsonb_array_elements(public.cockpit_win_candidate_rows(w.id, true)) x WHERE x->>'paymentId' = v_payment;
  IF c IS NULL THEN
    RAISE EXCEPTION 'That payment is not one of this client''s to tie. Refresh Money and pick it again.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.wins_action', 'wins.tie_proposed', true);
  INSERT INTO public.cockpit_win_tie_proposals(win_id, payment_id, usd, paid_on, rail, proposed_by_email, proposed_by_role)
  VALUES (w.id, v_payment, (c->>'usd')::numeric, (c->>'paidOn')::date, c->>'rail', v_email, v_role)
  RETURNING id INTO v_id;
  PERFORM public.cockpit_win_event(w.id, 'tie_proposed', v_role, v_email,
    jsonb_build_object('request_id', v_req, 'proposal_id', v_id, 'payment_id', v_payment, 'usd', (c->>'usd')::numeric,
                       'checked', (c->>'checked')::boolean, 'in_deal_ledger', c->'inDealLedger' <> 'null'::jsonb));
  RETURN jsonb_build_object('ok', true, 'proposalId', v_id, 'checked', (c->>'checked')::boolean, 'sentence', 'Sent to the CEO to confirm.');
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_win_tie_decide(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text; v_id bigint; v_decision text; v_reason text; tp public.cockpit_win_tie_proposals; w public.cockpit_csm_wins;
  v_paid jsonb; v_tie bigint; n integer; v_moved boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.cockpit_is_ceo(), false) THEN
    RAISE EXCEPTION 'Only the CEO confirms a win tie.' USING ERRCODE = '42501';
  END IF;
  v_actor := public.cockpit_hours_ceo_email();
  PERFORM public.cockpit_win_only(p, ARRAY['proposalId','decision','reason']);
  IF coalesce(jsonb_typeof(p->'proposalId'), '') NOT IN ('number', 'string') OR coalesce(p->>'proposalId', '') !~ '^[0-9]{1,18}$' THEN
    RAISE EXCEPTION 'Choose a proposal.' USING ERRCODE = '22023';
  END IF;
  v_id := (p->>'proposalId')::bigint;
  v_decision := coalesce(p->>'decision', '');
  v_reason := nullif(btrim(coalesce(p->>'reason', '')), '');
  IF v_reason IS NOT NULL AND char_length(v_reason) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'Say why in 3 to 300 characters.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_payment_ties', 0));
  SELECT * INTO tp FROM public.cockpit_win_tie_proposals x WHERE x.id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That proposal does not exist. Reload the list.' USING ERRCODE = '22023'; END IF;
  IF tp.state <> 'open' THEN RAISE EXCEPTION 'That proposal was already decided.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO w FROM public.cockpit_csm_wins x WHERE x.id = tp.win_id FOR UPDATE;

  IF v_decision = 'decline' THEN
    IF v_reason IS NULL THEN RAISE EXCEPTION 'Say why in 3 to 300 characters.' USING ERRCODE = '22023'; END IF;
    PERFORM set_config('cockpit.wins_action', 'wins.tie_declined', true);
    UPDATE public.cockpit_win_tie_proposals SET state = 'declined', decided_by = v_actor, decided_at = now(), reason = v_reason WHERE id = tp.id;
    PERFORM public.cockpit_win_event(w.id, 'tie_declined', 'the CEO', v_actor, jsonb_build_object('proposal_id', tp.id, 'reason', v_reason));
    RETURN jsonb_build_object('ok', true, 'proposalId', tp.id, 'state', 'declined', 'sentence', 'Declined.');
  END IF;
  IF v_decision <> 'confirm' THEN RAISE EXCEPTION 'Choose confirm or decline.' USING ERRCODE = '22023'; END IF;

  IF w.stage NOT IN ('signed', 'paid') THEN
    RAISE EXCEPTION 'That win is %, so it takes no payment.', lower(public.cockpit_win_stage_label(w.stage)) USING ERRCODE = '22023';
  END IF;
  -- Only money that arrived counts (E8).
  IF NOT public.cockpit_payment_checked(tp.payment_id, tp.rail) THEN
    RAISE EXCEPTION 'This transfer is not checked yet. Check it first, then confirm the tie.' USING ERRCODE = '22023';
  END IF;
  -- A deal's own contract money stays with the deal (X33).
  IF public.cockpit_win_contract_money(tp.payment_id) THEN
    RAISE EXCEPTION 'This payment is the deal''s own contract money. It stays with the deal.' USING ERRCODE = '22023';
  END IF;
  -- Never paid twice (X31): cash already in an approved closer month stays with the deal.
  v_paid := public.cockpit_win_closer_paid(tp.payment_id);
  IF v_paid IS NOT NULL THEN
    RAISE EXCEPTION 'This payment was paid to the closer in %. It stays with the deal.',
      public.cockpit_win_month_words((v_paid->>'month' || '-01')::date) USING ERRCODE = '22023';
  END IF;
  -- A rule-2 card match counts for the closer now: the CEO says why it is the upsell's.
  IF (public.cockpit_win_deal_row(tp.payment_id)).payment_id IS NOT NULL AND v_reason IS NULL THEN
    RAISE EXCEPTION 'This payment counts for the closer now. Say why it is the upsell''s.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_payment_ties t WHERE t.payment_id = tp.payment_id AND t.cleared_at IS NULL) THEN
    RAISE EXCEPTION 'This payment is already tied. Clear that tie first.' USING ERRCODE = '22023';
  END IF;
  -- The tie, as cockpit_ceo_payment_tie writes one: the row, the finance fence, the audit.
  INSERT INTO public.cockpit_payment_ties(payment_id, payer_email, payer_key, deal_response_id, clickup_task_id, not_client, note, evidence, set_by, win_id)
  VALUES (tp.payment_id, NULL, NULL, NULL, w.task_id, false, 'Upsell payment for ' || public.cockpit_win_kind_label(w.kind),
          w.agreement_url, v_actor, w.id)
  RETURNING id INTO v_tie;
  UPDATE public.cockpit_manual_payment_state SET revision = revision + 1, updated_at = now() WHERE id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'The finance source state is missing; nothing was tied'; END IF;
  PERFORM public.cockpit_hours_audit('money.tie', 'cockpit_payment_ties', v_tie::text,
    jsonb_strip_nulls(jsonb_build_object('id', v_tie, 'scope', 'payment', 'paymentId', tp.payment_id, 'target', 'card',
      'clickupTaskId', w.task_id, 'winId', w.id, 'proposalId', tp.id, 'reason', v_reason)), v_actor);
  PERFORM set_config('cockpit.wins_action', 'wins.tie_confirmed', true);
  UPDATE public.cockpit_win_tie_proposals SET state = 'confirmed', decided_by = v_actor, decided_at = now(), reason = v_reason, tie_id = v_tie
   WHERE id = tp.id;
  PERFORM public.cockpit_win_event(w.id, 'tie_confirmed', 'the CEO', v_actor,
    jsonb_build_object('proposal_id', tp.id, 'tie_id', v_tie, 'payment_id', tp.payment_id, 'usd', tp.usd, 'reason', v_reason));
  IF w.stage = 'signed' THEN
    PERFORM set_config('cockpit.wins_action', 'wins.paid', true);
    UPDATE public.cockpit_csm_wins SET stage = 'paid' WHERE id = w.id;
    PERFORM public.cockpit_win_event(w.id, 'paid', 'the CEO', v_actor, jsonb_build_object('proposal_id', tp.id, 'paid_on', tp.paid_on));
    v_moved := true;
  END IF;
  RETURN jsonb_build_object('ok', true, 'proposalId', tp.id, 'tieId', v_tie, 'state', 'confirmed', 'stage', 'paid',
    'sentence', CASE WHEN v_moved THEN 'Confirmed. The upsell is paid; the payment counts as back-end money from the next money refresh.'
                     ELSE 'Confirmed. The payment counts as back-end money from the next money refresh.' END);
END $$;

-- The only way a win tie is cleared (2.2). Refused once the CSM was paid for
-- this win in an approved month (X31); otherwise every live tie of the win is
-- cleared, the win goes back to Accepted, and the confirmed pay entries of
-- open months are listed for the CEO to remove or adjust by hand.
CREATE OR REPLACE FUNCTION public.cockpit_ceo_win_tie_clear(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text; v_win uuid; v_reason text; w public.cockpit_csm_wins; v_hit record; v_ties jsonb; v_entries jsonb; n integer; t record;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.cockpit_is_ceo(), false) THEN
    RAISE EXCEPTION 'Only the CEO clears a win tie.' USING ERRCODE = '42501';
  END IF;
  v_actor := public.cockpit_hours_ceo_email();
  PERFORM public.cockpit_win_only(p, ARRAY['winId','reason']);
  v_win := public.cockpit_win_uuid(p, 'winId');
  IF v_win IS NULL THEN RAISE EXCEPTION 'Choose a win.' USING ERRCODE = '22023'; END IF;
  v_reason := btrim(coalesce(p->>'reason', ''));
  IF char_length(v_reason) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'Say why in 3 to 300 characters.' USING ERRCODE = '22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_payment_ties', 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_pay', 0));
  SELECT * INTO w FROM public.cockpit_csm_wins x WHERE x.id = v_win FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That win is not in the ledger. Reload the page.' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_payment_ties x WHERE x.win_id = w.id AND x.cleared_at IS NULL) THEN
    RAISE EXCEPTION 'This win has no payment tied.' USING ERRCODE = '22023';
  END IF;
  SELECT e.month INTO v_hit
    FROM public.cockpit_pay_proposal_decisions d JOIN public.cockpit_pay_entries e ON e.id = d.entry_id
   WHERE d.key LIKE 'win:' || w.id::text || ':%' AND d.decision = 'confirmed' AND e.voided_at IS NULL
     AND EXISTS (SELECT 1 FROM public.cockpit_pay_months pm WHERE pm.person_id = e.person_id AND pm.month = e.month AND pm.status = 'approved')
   ORDER BY e.month DESC LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'The CSM was paid for this upsell in %. It stays tied; add an adjustment in % if it was wrong.',
      public.cockpit_win_month_words(v_hit.month), public.cockpit_win_month_words((v_hit.month + interval '1 month')::date)
      USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('tieId', x.id, 'paymentId', x.payment_id) ORDER BY x.id), '[]'::jsonb) INTO v_ties
    FROM public.cockpit_payment_ties x WHERE x.win_id = w.id AND x.cleared_at IS NULL;
  FOR t IN SELECT x.id FROM public.cockpit_payment_ties x WHERE x.win_id = w.id AND x.cleared_at IS NULL ORDER BY x.id LOOP
    UPDATE public.cockpit_payment_ties SET cleared_by = v_actor, cleared_at = now(), cleared_reason = v_reason WHERE id = t.id;
    PERFORM public.cockpit_hours_audit('money.untie', 'cockpit_payment_ties', t.id::text,
      jsonb_build_object('id', t.id, 'winId', w.id, 'reason', v_reason), v_actor);
  END LOOP;
  UPDATE public.cockpit_manual_payment_state SET revision = revision + 1, updated_at = now() WHERE id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'The finance source state is missing; the tie stays'; END IF;
  IF w.stage = 'paid' THEN
    PERFORM set_config('cockpit.win_act', 'tie_clear', true);
    PERFORM set_config('cockpit.wins_action', 'wins.tie_cleared', true);
    UPDATE public.cockpit_csm_wins SET stage = 'signed' WHERE id = w.id;
    PERFORM set_config('cockpit.win_act', '', true);
  END IF;
  PERFORM public.cockpit_win_event(w.id, 'tie_cleared', 'the CEO', v_actor, jsonb_build_object('reason', v_reason, 'ties', v_ties));
  SELECT coalesce(jsonb_agg(jsonb_build_object('entryId', e.id, 'month', to_char(e.month, 'YYYY-MM'), 'person', p2.name,
           'part', public.cockpit_win_part_label(e.part_key),
           'amountUsd', coalesce(e.amount_usd, public.cockpit_win_price(e.person_id, e.month, e.part_key, e.quantity, e.cash_usd, e.engagement_month)))
           ORDER BY e.month, e.id), '[]'::jsonb)
    INTO v_entries
    FROM public.cockpit_pay_entries e JOIN public.cockpit_people p2 ON p2.id = e.person_id
   WHERE e.evidence_ref = 'win:' || w.id::text AND e.voided_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_pay_months pm WHERE pm.person_id = e.person_id AND pm.month = e.month AND pm.status = 'approved');
  RETURN jsonb_build_object('ok', true, 'winId', w.id, 'stage', CASE WHEN w.stage = 'paid' THEN 'signed' ELSE w.stage END,
    'entries', v_entries,
    'sentence', CASE WHEN jsonb_array_length(v_entries) = 0 THEN 'Tie cleared.'
                     ELSE format('Tie cleared. %s pay %s came from this win; check them on Team & payroll.', jsonb_array_length(v_entries),
                                 CASE WHEN jsonb_array_length(v_entries) = 1 THEN 'entry' ELSE 'entries' END) END);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_win_invoice_link(p_win_id uuid, p_invoice_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.cockpit_csm_wins; v_seat jsonb; i public.cockpit_invoices; v_inv uuid;
BEGIN
  SELECT * INTO w FROM public.cockpit_csm_wins x WHERE x.id = p_win_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That win is not in the ledger. Reload the page.' USING ERRCODE = '22023'; END IF;
  v_seat := public.cockpit_win_seat(w.task_id);
  IF NOT public.cockpit_win_door_open() AND NOT (w.source = 'canary' AND (v_seat->>'ceo')::boolean) THEN
    RAISE EXCEPTION 'Log a win opens after its switch-on.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_invoice_id, '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'That invoice is not on this client.' USING ERRCODE = '22023';
  END IF;
  v_inv := lower(p_invoice_id)::uuid;
  IF NOT public.cockpit_win_is_upsell(w.kind) THEN RAISE EXCEPTION 'Only an upsell is invoiced from its win.' USING ERRCODE = '22023'; END IF;
  IF w.stage = 'void' THEN RAISE EXCEPTION 'That win was voided.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO i FROM public.cockpit_invoices x WHERE x.id = v_inv FOR UPDATE;
  IF NOT FOUND OR i.clickup_task_id IS DISTINCT FROM w.task_id THEN
    RAISE EXCEPTION 'That invoice is not on this client.' USING ERRCODE = '22023';
  END IF;
  IF i.win_id = w.id THEN RETURN jsonb_build_object('ok', true, 'repeat', true, 'sentence', 'Already linked.'); END IF;
  IF i.win_id IS NOT NULL THEN RAISE EXCEPTION 'That invoice is already linked to a win.' USING ERRCODE = '22023'; END IF;
  UPDATE public.cockpit_invoices SET win_id = w.id WHERE id = i.id;
  PERFORM public.cockpit_win_event(w.id, 'invoice_linked', v_seat->>'role', v_seat->>'email', jsonb_build_object('invoice_id', i.id));
  RETURN jsonb_build_object('ok', true, 'winId', w.id, 'invoiceId', i.id, 'sentence', 'Linked.');
END $$;

-- ---------------------------------------------------------------------------
-- 9. Pay proposals (4.9, E12, X5, X32): derived on read, confirmed by the CEO
--    into an ordinary pay entry; nothing pays itself.

CREATE OR REPLACE FUNCTION public.cockpit_win_pay_rows(p_month date)
RETURNS TABLE (key text, win_id uuid, task_id text, client text, person_id bigint, part_key text, quantity numeric, cash_usd numeric,
  engagement_month integer, cleared_on date, posted_on date, evidence_ref text, proof_url text, amount_usd numeric,
  state text, why text, entry_id bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m0 date := date_trunc('month', p_month)::date;
  w public.cockpit_csm_wins; v_part text; v_q numeric; v_cash numeric; v_em integer; v_cleared date; v_posted date;
  v_state text; v_why text; v_first date; v_any boolean; v_plan jsonb; v_role text; d public.cockpit_pay_proposal_decisions;
BEGIN
  FOR w IN SELECT * FROM public.cockpit_csm_wins x
            WHERE x.stage <> 'void' AND x.source IN ('cockpit', 'reactivate') AND x.task_id <> public.cockpit_win_canary_card()
              AND x.won_on < (m0 + interval '1 month')::date
            ORDER BY x.won_on, x.logged_at LOOP
    v_part := public.cockpit_win_part(w.kind, w.recurring);
    v_q := NULL; v_cash := NULL; v_em := NULL; v_cleared := NULL; v_posted := NULL; v_state := 'proposed'; v_why := NULL;
    IF w.kind IN ('review', 'video_testimonial', 'podcast') THEN
      CONTINUE WHEN date_trunc('month', w.won_on)::date <> m0;
      v_q := 1; v_cleared := w.won_on; v_posted := w.won_on;
    ELSIF w.kind = 'referral' THEN
      SELECT min(dp.day) INTO v_cleared FROM public.cockpit_deal_payments dp
       WHERE dp.deal_response_id = w.referral_deal_response_id AND dp.active;
      IF v_cleared IS NULL THEN
        CONTINUE WHEN date_trunc('month', w.won_on)::date <> m0;
        v_state := 'waiting'; v_why := 'The referred client has not paid yet.';
      ELSE
        CONTINUE WHEN date_trunc('month', v_cleared)::date <> m0;
        v_q := 1;
      END IF;
    ELSIF w.kind IN ('renewal', 'reactivation') THEN
      v_cleared := CASE WHEN w.agreement_url IS NOT NULL THEN w.won_on END;
      IF v_cleared IS NULL THEN SELECT min(t.paid_on) INTO v_cleared FROM public.cockpit_win_ties(w.id) t WHERE t.checked; END IF;
      IF v_cleared IS NULL THEN
        CONTINUE WHEN date_trunc('month', w.won_on)::date <> m0;
        v_state := 'waiting'; v_why := 'No agreement link or tied payment yet.';
      ELSE
        CONTINUE WHEN date_trunc('month', v_cleared)::date <> m0;
        v_q := 1;
      END IF;
    ELSE
      -- An upsell pays on the checked cash tied to it, month by month.
      SELECT min(t.paid_on) INTO v_first FROM public.cockpit_win_ties(w.id) t;
      CONTINUE WHEN v_first IS NULL;
      SELECT round(sum(t.usd) FILTER (WHERE t.checked), 2), min(t.paid_on) FILTER (WHERE t.checked), count(*) > 0
        INTO v_cash, v_cleared, v_any
        FROM public.cockpit_win_ties(w.id) t WHERE date_trunc('month', t.paid_on)::date = m0;
      CONTINUE WHEN NOT coalesce(v_any, false);
      IF v_cash IS NULL OR v_cash <= 0 THEN
        v_state := 'waiting'; v_why := 'Cash not checked yet.'; v_cash := NULL;
      END IF;
      v_em := CASE WHEN w.recurring
                   THEN ((extract(year FROM m0) - extract(year FROM v_first)) * 12 + extract(month FROM m0) - extract(month FROM v_first))::integer + 1
                   ELSE 1 END;
    END IF;
    -- The part must be in the person's plan for the month.
    IF v_state = 'proposed' AND w.csm_person_id IS NOT NULL THEN
      v_plan := public.cockpit_pay_plan_for(w.csm_person_id, m0);
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_plan->'plan'->'parts', '[]'::jsonb)) x WHERE x->>'key' = v_part) THEN
        v_role := coalesce(nullif(lower(btrim(v_plan->>'role')), ''), 'person');
        v_state := 'waiting';
        v_why := format('%s is not in the %s''s plan for %s.', public.cockpit_win_part_label(v_part), v_role, public.cockpit_win_month_words(m0));
      END IF;
    ELSIF v_state = 'proposed' THEN
      v_why := 'No CSM on the roster matches this card. Pick the person when you confirm.';
    END IF;
    key := format('win:%s:%s:%s', w.id, v_part, to_char(m0, 'YYYY-MM'));
    SELECT * INTO d FROM public.cockpit_pay_proposal_decisions x WHERE x.key = format('win:%s:%s:%s', w.id, v_part, to_char(m0, 'YYYY-MM'));
    IF d.key IS NOT NULL THEN
      v_state := d.decision; entry_id := d.entry_id;
      IF d.decision = 'declined' THEN v_why := d.reason; END IF;
    ELSE
      entry_id := NULL;
    END IF;
    win_id := w.id; task_id := w.task_id; client := w.client_name; person_id := w.csm_person_id; part_key := v_part;
    quantity := v_q; cash_usd := v_cash; engagement_month := v_em; cleared_on := v_cleared; posted_on := v_posted;
    evidence_ref := 'win:' || w.id::text; proof_url := coalesce(w.proof_url, w.agreement_url);
    amount_usd := CASE WHEN v_state IN ('proposed', 'confirmed') THEN public.cockpit_win_price(w.csm_person_id, m0, v_part, v_q, v_cash, v_em) END;
    state := v_state; why := v_why;
    RETURN NEXT;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_pay_proposals(p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m0 date;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.cockpit_is_ceo(), false) THEN
    RAISE EXCEPTION 'Only the CEO sees pay proposals.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.cockpit_win_proposals_on() THEN RAISE EXCEPTION 'Pay proposals open after their switch-on.' USING ERRCODE = '22023'; END IF;
  IF p_month IS NULL THEN RAISE EXCEPTION 'Choose a month, as YYYY-MM' USING ERRCODE = '22023'; END IF;
  m0 := date_trunc('month', p_month)::date;
  RETURN jsonb_build_object(
    'month', to_char(m0, 'YYYY-MM'), 'on', true,
    'approved', EXISTS (SELECT 1 FROM public.cockpit_pay_months pm WHERE pm.month = m0 AND pm.status = 'approved'),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'key', r.key, 'winId', r.win_id, 'personId', r.person_id, 'person', pp.name, 'partKey', r.part_key,
        'partLabel', public.cockpit_win_part_label(r.part_key), 'quantity', r.quantity, 'cashUsd', r.cash_usd,
        'engagementMonth', r.engagement_month, 'client', r.client, 'taskId', r.task_id, 'clearedOn', r.cleared_on, 'postedOn', r.posted_on,
        'evidenceRef', r.evidence_ref, 'proofUrl', r.proof_url, 'amountUsd', r.amount_usd, 'state', r.state, 'why', r.why,
        'entryId', r.entry_id,
        'carryTo', CASE WHEN r.state = 'proposed' AND r.person_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.cockpit_pay_months pm
                          WHERE pm.person_id = r.person_id AND pm.month = m0 AND pm.status = 'approved')
                        THEN to_char((public.cockpit_pay_last_approved(r.person_id) + interval '1 month')::date, 'YYYY-MM') END)
        ORDER BY r.client, r.part_key, r.key)
      FROM public.cockpit_win_pay_rows(m0) r LEFT JOIN public.cockpit_people pp ON pp.id = r.person_id), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_pay_proposal_decide(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text; m0 date; v_key text; v_decision text; v_reason text; r record; v_person bigint; v_target date; v_carried boolean := false;
  v_entry jsonb; v_entry_id bigint; v_existing public.cockpit_pay_proposal_decisions;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.cockpit_is_ceo(), false) THEN
    RAISE EXCEPTION 'Only the CEO confirms pay.' USING ERRCODE = '42501';
  END IF;
  v_actor := public.cockpit_hours_ceo_email();
  IF NOT public.cockpit_win_proposals_on() THEN RAISE EXCEPTION 'Pay proposals open after their switch-on.' USING ERRCODE = '22023'; END IF;
  PERFORM public.cockpit_win_only(p, ARRAY['month','key','decision','personId','reason']);
  m0 := public.cockpit_hours_month(p->>'month');
  v_key := coalesce(p->>'key', '');
  v_decision := coalesce(p->>'decision', '');
  v_reason := nullif(btrim(coalesce(p->>'reason', '')), '');
  IF v_reason IS NOT NULL AND char_length(v_reason) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'Say why in 3 to 300 characters.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_pay_proposal:' || v_key, 0));
  SELECT * INTO v_existing FROM public.cockpit_pay_proposal_decisions d WHERE d.key = v_key;
  IF v_existing.key IS NOT NULL THEN
    RAISE EXCEPTION 'That proposal was already %.', v_existing.decision USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.cockpit_win_pay_rows(m0) x WHERE x.key = v_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That proposal is not in %. Reload the list.', public.cockpit_win_month_words(m0) USING ERRCODE = '22023';
  END IF;

  IF v_decision = 'decline' THEN
    IF v_reason IS NULL THEN RAISE EXCEPTION 'Say why in 3 to 300 characters.' USING ERRCODE = '22023'; END IF;
    PERFORM set_config('cockpit.wins_action', 'pay.proposal_declined', true);
    INSERT INTO public.cockpit_pay_proposal_decisions(key, month, decision, entry_id, reason, decided_by)
    VALUES (v_key, m0, 'declined', NULL, v_reason, v_actor);
    RETURN jsonb_build_object('ok', true, 'key', v_key, 'state', 'declined', 'sentence', 'Declined.');
  END IF;
  IF v_decision <> 'confirm' THEN RAISE EXCEPTION 'Choose confirm or decline.' USING ERRCODE = '22023'; END IF;
  IF r.state = 'waiting' THEN RAISE EXCEPTION '%', r.why USING ERRCODE = '22023'; END IF;
  IF p ? 'personId' AND p->'personId' <> 'null'::jsonb THEN
    v_person := (public.cockpit_hours_person(jsonb_build_object('personId', p->'personId'))).id;
  ELSE
    v_person := r.person_id;
  END IF;
  IF v_person IS NULL THEN RAISE EXCEPTION 'Pick the person this pay goes to.' USING ERRCODE = '22023'; END IF;
  -- A proposal whose month is approved goes into the first open month (X32).
  v_target := m0;
  IF EXISTS (SELECT 1 FROM public.cockpit_pay_months pm WHERE pm.person_id = v_person AND pm.month = m0 AND pm.status = 'approved') THEN
    v_target := (public.cockpit_pay_last_approved(v_person) + interval '1 month')::date;
    v_carried := true;
  END IF;
  -- The entry save path, as the CEO: its gate, its rules (the C7 rule included) and its audit.
  v_entry := public.cockpit_ceo_pay_entry_save(jsonb_strip_nulls(jsonb_build_object(
    'personId', v_person, 'month', to_char(v_target, 'YYYY-MM'), 'partKey', r.part_key,
    'quantity', r.quantity, 'cashUsd', r.cash_usd, 'engagementMonth', r.engagement_month,
    'client', left(r.client, 120), 'clearedOn', to_char(r.cleared_on, 'YYYY-MM-DD'), 'postedOn', to_char(r.posted_on, 'YYYY-MM-DD'),
    'evidenceRef', r.evidence_ref, 'evidence', r.proof_url,
    'note', public.cockpit_win_part_label(r.part_key),
    'forMonth', CASE WHEN v_carried THEN to_char(m0, 'YYYY-MM') END)));
  v_entry_id := (v_entry->>'id')::bigint;
  PERFORM set_config('cockpit.wins_action', 'pay.proposal_confirmed', true);
  INSERT INTO public.cockpit_pay_proposal_decisions(key, month, decision, entry_id, reason, decided_by)
  VALUES (v_key, m0, 'confirmed', v_entry_id, v_reason, v_actor);
  RETURN jsonb_build_object('ok', true, 'key', v_key, 'state', 'confirmed', 'entryId', v_entry_id, 'month', to_char(v_target, 'YYYY-MM'),
    'sentence', CASE WHEN v_carried
                     THEN format('Added to %s: %s is approved.', public.cockpit_win_month_words(v_target), public.cockpit_win_month_words(m0))
                     ELSE format('Added to %s.', public.cockpit_win_month_words(v_target)) END);
END $$;

-- ---------------------------------------------------------------------------
-- 10. The 35 old Typeform wins (4.2.4, Q16): owner only, from deploy D-W.
--     Each becomes a void win with source 'import' and one 'imported' event:
--     no billing event, no card comment, no notice and no form response. The
--     card is the hidden or typed ClickUp id when it is on the billing sheet,
--     else the typed business name folded with exactly one hit; otherwise the
--     row is skipped and counted as "no card". Idempotent on imported_from.
--     p = {"rows":[{"importedFrom":"typeform:<form>:<response>","kind":"...","wonOn":"YYYY-MM-DD",
--                   "clickupId":"..."|null,"businessName":"..."|null,"proofUrl":"https://..."|null,
--                   "quotedUsd":123|null,"note":"..."|null}]}

CREATE OR REPLACE FUNCTION public.cockpit_csm_win_import(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r jsonb; v_task text; v_client text; v_from text; v_kind text; v_won date; v_proof text; v_quoted numeric; v_note text;
  v_inserted integer := 0; v_existing integer := 0; v_no_card integer := 0; v_id uuid; v_hits integer; v_key text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'An import runs only from the owner''s SQL, never from a seat.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'rows') > 500 THEN
    RAISE EXCEPTION 'Send {"rows":[...]} with at most 500 rows.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_actor', 'import', true);
  PERFORM set_config('cockpit.audit_source', 'wins-backfill', true);
  FOR r IN SELECT x FROM jsonb_array_elements(p->'rows') x LOOP
    v_from := r->>'importedFrom';
    v_kind := r->>'kind';
    IF v_from IS NULL OR v_from !~ '^typeform:[A-Za-z0-9]{8}:[A-Za-z0-9_-]{1,120}$' OR public.cockpit_win_kind_label(v_kind) IS NULL THEN
      RAISE EXCEPTION 'An import row needs importedFrom (typeform:<form>:<response>) and a win kind.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.cockpit_csm_wins w WHERE w.imported_from = v_from) THEN
      v_existing := v_existing + 1;
      CONTINUE;
    END IF;
    BEGIN
      v_won := (r->>'wonOn')::date;
    EXCEPTION WHEN others THEN v_won := NULL;
    END;
    IF v_won IS NULL THEN RAISE EXCEPTION 'An import row needs its day (wonOn).' USING ERRCODE = '22023'; END IF;
    -- The card: the ClickUp id on the billing sheet, else one folded name match.
    v_task := NULL; v_client := NULL;
    SELECT a.clickup_task_id, a.client_name INTO v_task, v_client FROM public.cockpit_billing_accounts a
     WHERE a.clickup_task_id = nullif(btrim(coalesce(r->>'clickupId', '')), '');
    IF v_task IS NULL THEN
      v_key := public.cockpit_win_fold(r->>'businessName');
      SELECT count(*) INTO v_hits FROM public.cockpit_billing_accounts a WHERE public.cockpit_win_fold(a.client_name) = v_key;
      IF v_key IS NOT NULL AND v_hits = 1 THEN
        SELECT a.clickup_task_id, a.client_name INTO v_task, v_client FROM public.cockpit_billing_accounts a
         WHERE public.cockpit_win_fold(a.client_name) = v_key;
      END IF;
    END IF;
    IF v_task IS NULL THEN
      v_no_card := v_no_card + 1;
      CONTINUE;
    END IF;
    v_proof := CASE WHEN r->>'proofUrl' ~ '^https://[^[:space:]]+$' AND char_length(r->>'proofUrl') <= 1000 THEN r->>'proofUrl' END;
    v_quoted := CASE WHEN jsonb_typeof(r->'quotedUsd') = 'number' AND (r->>'quotedUsd')::numeric > 0 AND (r->>'quotedUsd')::numeric <= 1000000
                     THEN round((r->>'quotedUsd')::numeric, 2) END;
    v_note := left(nullif(btrim(coalesce(r->>'note', '')), ''), 500);
    PERFORM set_config('cockpit.wins_action', 'wins.imported', true);
    INSERT INTO public.cockpit_csm_wins(request_id, task_id, client_name, kind, stage, won_on, proof_url, quoted_usd, recurring, note,
      source, imported_from, logged_by_role, voided_by, voided_at, void_reason)
    VALUES (gen_random_uuid(), v_task, v_client, v_kind, 'void', v_won, v_proof, v_quoted, false, v_note,
      'import', v_from, 'the CSM', 'import', now(), 'imported, pre-cockpit')
    RETURNING id INTO v_id;
    PERFORM public.cockpit_win_event(v_id, 'imported', 'the CSM', NULL, jsonb_build_object('from', v_from));
    v_inserted := v_inserted + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted, 'alreadyThere', v_existing, 'noCard', v_no_card);
END $$;

-- ---------------------------------------------------------------------------
-- 11. The ordinary tie and untie, replaced (2.2): a win tie is refused with
--     "This payment is tied to a win. Clear it from the win."; every other
--     line is the live body of 2026-11-02.

CREATE OR REPLACE FUNCTION public.cockpit_ceo_payment_tie(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); k text;
  v_payment text; v_email text; v_name text; v_key text; v_deal text; v_card text; v_not_client boolean;
  v_note text; v_evidence text; v_scope text; v_target text; d public.cockpit_sales_deals; v_old bigint; v_id bigint; n integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_payment_ties',0));
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'A tie must be an object' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p) LOOP
    IF k<>ALL(ARRAY['paymentId','payerEmail','payerKey','dealResponseId','clickupTaskId','notClient','note','evidence']) THEN
      RAISE EXCEPTION 'Unsupported field: %',k USING ERRCODE='22023';
    END IF;
    IF k='notClient' AND jsonb_typeof(p->k) NOT IN ('boolean','null') THEN
      RAISE EXCEPTION 'notClient is true or false' USING ERRCODE='22023';
    ELSIF k<>'notClient' AND jsonb_typeof(p->k) NOT IN ('string','null') THEN
      RAISE EXCEPTION '% must be text',k USING ERRCODE='22023';
    END IF;
  END LOOP;
  v_payment:=nullif(btrim(p->>'paymentId'),'');
  v_email:=lower(nullif(btrim(p->>'payerEmail'),''));
  v_name:=nullif(btrim(p->>'payerKey'),'');
  v_deal:=nullif(btrim(p->>'dealResponseId'),'');
  v_card:=nullif(btrim(p->>'clickupTaskId'),'');
  v_not_client:=coalesce((p->>'notClient')::boolean,false);
  v_note:=btrim(coalesce(p->>'note',''));
  v_evidence:=nullif(btrim(p->>'evidence'),'');

  IF num_nonnulls(v_payment,v_email,v_name)<>1 THEN
    RAISE EXCEPTION 'Tie one payment, one payer email or one payer name' USING ERRCODE='22023';
  END IF;
  IF num_nonnulls(v_deal,v_card)+(CASE WHEN v_not_client THEN 1 ELSE 0 END)<>1 THEN
    RAISE EXCEPTION 'Choose one: a signed deal, a client card or not client money' USING ERRCODE='22023';
  END IF;
  IF length(v_note) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Say why in a note of 3 to 500 characters' USING ERRCODE='22023'; END IF;
  IF length(v_evidence)>1000 THEN RAISE EXCEPTION 'Keep the evidence under 1,000 characters' USING ERRCODE='22023'; END IF;

  -- The scope.
  IF v_payment IS NOT NULL THEN
    v_scope:='payment';
    IF length(v_payment)>200 OR v_payment !~ '^(whop|tap|ecom|transfer|bank|manual):[A-Za-z0-9_.-]+$' THEN
      RAISE EXCEPTION 'That is not a payment id from the Transactions tab' USING ERRCODE='22023';
    END IF;
    -- In the last published money transactions (money in), or in a source table Triage holds.
    IF NOT EXISTS(SELECT 1 FROM public.cockpit_sections s
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.payload#>'{attribution,transactions}')='array'
            THEN s.payload#>'{attribution,transactions}' ELSE '[]'::jsonb END) t
          WHERE s.key='money' AND t->>'id'=v_payment AND t->>'direction'='in')
      AND NOT (v_payment LIKE 'ecom:%' AND EXISTS(SELECT 1 FROM public.cockpit_ecom_invoices i WHERE i.id=substr(v_payment,6) AND i.status='PAID')) AND NOT (v_payment LIKE 'tap:%' AND EXISTS(SELECT 1 FROM public.cockpit_tap_charges c
          WHERE c.id=substr(v_payment,5) AND c.live AND c.status='CAPTURED'))
      AND NOT (v_payment LIKE 'bank:%' AND EXISTS(SELECT 1 FROM public.cockpit_bank_lines l
          WHERE l.id::text=substr(v_payment,6) AND l.usd>0))
      AND NOT (v_payment LIKE 'manual:%' AND EXISTS(SELECT 1 FROM public.cockpit_manual_payments m
          WHERE m.id=substr(v_payment,8) AND m.deleted_at IS NULL AND m.kind<>'refund')) THEN
      RAISE EXCEPTION 'That payment is not in the ledger yet; refresh Money first.' USING ERRCODE='22023';
    END IF;
  ELSIF v_email IS NOT NULL THEN
    v_scope:='payerEmail';
    IF length(v_email)>320 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' THEN
      RAISE EXCEPTION 'That is not an email address' USING ERRCODE='22023';
    END IF;
  ELSE
    v_scope:='payerKey';
    v_key:=regexp_replace(lower(v_name),'[^[:alnum:]]','','g');
    -- Never a first name alone (the "Dena" lesson): six letters or more, two words or more.
    IF length(v_name)>200 OR length(v_key)<6 OR v_name !~ '[^[:space:]][[:space:]]+[^[:space:]]' THEN
      RAISE EXCEPTION 'Tie by email or the full payer name.' USING ERRCODE='22023';
    END IF;
  END IF;

  -- The target.
  IF v_deal IS NOT NULL THEN
    v_target:='deal';
    SELECT * INTO d FROM public.cockpit_sales_deals WHERE response_id=v_deal;
    IF d.response_id IS NULL OR d.submitted_at IS NULL THEN
      RAISE EXCEPTION 'That deal is not a signed closer-form deal. Choose one from the list.' USING ERRCODE='22023';
    END IF;
    IF d.voided THEN RAISE EXCEPTION 'That deal was voided. Choose a signed deal.' USING ERRCODE='22023'; END IF;
  ELSIF v_card IS NOT NULL THEN
    v_target:='card';
    IF NOT EXISTS(SELECT 1 FROM public.cockpit_client_billing_days b WHERE b.clickup_task_id=v_card)
      AND NOT EXISTS(SELECT 1 FROM public.cockpit_finance_client_aliases a WHERE a.task_id=v_card) THEN
      RAISE EXCEPTION 'That client card is unknown. Choose a card from the list.' USING ERRCODE='22023';
    END IF;
  ELSE
    v_target:='notClient';
  END IF;

  -- A win tie (20261102h) is cleared only from its win: an ordinary tie never displaces it.
  IF v_payment IS NOT NULL AND EXISTS(SELECT 1 FROM public.cockpit_payment_ties t
      WHERE t.cleared_at IS NULL AND t.payment_id=v_payment AND t.win_id IS NOT NULL) THEN
    RAISE EXCEPTION 'This payment is tied to a win. Clear it from the win.' USING ERRCODE='22023';
  END IF;
  UPDATE public.cockpit_payment_ties t SET cleared_by=v_actor,cleared_at=now(),cleared_reason='Replaced by a new tie'
    WHERE t.cleared_at IS NULL
      AND ((v_payment IS NOT NULL AND t.payment_id=v_payment)
        OR (v_email IS NOT NULL AND lower(btrim(t.payer_email))=v_email)
        OR (v_key IS NOT NULL AND t.payer_key=v_key))
    RETURNING t.id INTO v_old;
  INSERT INTO public.cockpit_payment_ties(payment_id,payer_email,payer_key,deal_response_id,clickup_task_id,not_client,note,evidence,set_by)
    VALUES(v_payment,v_email,v_key,v_deal,v_card,v_not_client,v_note,v_evidence,v_actor)
    RETURNING id INTO v_id;
  -- The fence: a refresh already running fails at its finish; the next one reads the tie.
  UPDATE public.cockpit_manual_payment_state SET revision=revision+1,updated_at=now() WHERE id;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'The finance source state is missing; nothing was tied'; END IF;
  PERFORM public.cockpit_hours_audit('money.tie','cockpit_payment_ties',v_id::text,
    jsonb_strip_nulls(jsonb_build_object('id',v_id,'replaced',v_old,'scope',v_scope,'paymentId',v_payment,
      'target',v_target,'dealResponseId',v_deal,'clickupTaskId',v_card)),v_actor);
  RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_payment_untie(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); k text; v_id bigint; v_reason text; t public.cockpit_payment_ties; n integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_payment_ties',0));
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Removing a tie needs an object' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p) LOOP
    IF k<>ALL(ARRAY['id','reason']) THEN RAISE EXCEPTION 'Unsupported field: %',k USING ERRCODE='22023'; END IF;
  END LOOP;
  IF coalesce(jsonb_typeof(p->'id'),'') NOT IN ('number','string') OR coalesce(p->>'id','') !~ '^[0-9]{1,18}$' THEN
    RAISE EXCEPTION 'Choose a tie to remove' USING ERRCODE='22023';
  END IF;
  v_id:=(p->>'id')::bigint;
  IF p ? 'reason' AND jsonb_typeof(p->'reason') NOT IN ('string','null') THEN RAISE EXCEPTION 'reason must be text' USING ERRCODE='22023'; END IF;
  v_reason:=btrim(coalesce(p->>'reason',''));
  IF length(v_reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Say why the tie goes, in 3 to 500 characters' USING ERRCODE='22023'; END IF;
  SELECT * INTO t FROM public.cockpit_payment_ties WHERE id=v_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'That tie does not exist' USING ERRCODE='22023'; END IF;
  IF t.cleared_at IS NOT NULL THEN RAISE EXCEPTION 'That tie is already removed' USING ERRCODE='22023'; END IF;
  -- A win tie (20261102h) is cleared only from its win (cockpit_ceo_win_tie_clear).
  IF t.win_id IS NOT NULL THEN RAISE EXCEPTION 'This payment is tied to a win. Clear it from the win.' USING ERRCODE='22023'; END IF;
  UPDATE public.cockpit_payment_ties SET cleared_by=v_actor,cleared_at=now(),cleared_reason=v_reason WHERE id=v_id;
  UPDATE public.cockpit_manual_payment_state SET revision=revision+1,updated_at=now() WHERE id;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'The finance source state is missing; the tie stays'; END IF;
  PERFORM public.cockpit_hours_audit('money.untie','cockpit_payment_ties',v_id::text,jsonb_build_object('id',v_id),v_actor);
  RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 12. The pay entry save, replaced (4.9.3): the C7 rule while pay.proposals is
--     on (a win-backed part names its win:<id> or says why it is outside the
--     ledger; one entry per win, part and proposal month; a carried confirm
--     names its approved month in forMonth). Adjustments and every other part
--     are the live body of 2026-11-02, byte for byte.

CREATE OR REPLACE FUNCTION public.cockpit_ceo_pay_entry_save(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_person public.cockpit_people; m0 date; mname text; nname text; pk text; part jsonb; kind text; ev text;
  qty numeric; cash numeric; amt numeric; em numeric; v_client text; v_product text; cleared date; posted date; cancelled date;
  eref text; evid text; v_note text; fm date; v_id bigint; d date; lapse numeric; general boolean:=false;
  v_c7 boolean:=false; v_outside text; v_for date; v_win uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_pay',0));
  PERFORM public.cockpit_pay_only(p, ARRAY['personId','month','partKey','quantity','cashUsd','amountUsd','engagementMonth','client','product',
    'clearedOn','postedOn','cancelledOn','evidenceRef','evidence','note','fromMonth','outsideLedger','forMonth']);
  v_person:=public.cockpit_hours_person(p);
  m0:=public.cockpit_hours_month(p->>'month'); mname:=public.cockpit_hours_month_name(m0);
  nname:=public.cockpit_hours_month_name((m0+interval '1 month')::date);
  IF EXISTS (SELECT 1 FROM public.cockpit_pay_months pm WHERE pm.person_id=v_person.id AND pm.month=m0 AND pm.status='approved') THEN
    RAISE EXCEPTION '% is approved. Add it to % as an adjustment.', mname, nname USING ERRCODE='22023';
  END IF;
  pk:=public.cockpit_pay_text(p,'partKey',40);
  IF pk IS NULL THEN RAISE EXCEPTION 'Choose the part of the plan.' USING ERRCODE='22023'; END IF;
  qty:=public.cockpit_pay_number(p,'quantity'); cash:=public.cockpit_pay_number(p,'cashUsd'); amt:=public.cockpit_pay_number(p,'amountUsd');
  em:=public.cockpit_pay_number(p,'engagementMonth');
  v_client:=public.cockpit_pay_text(p,'client',120); v_product:=public.cockpit_pay_text(p,'product',120);
  cleared:=public.cockpit_pay_date(p,'clearedOn'); posted:=public.cockpit_pay_date(p,'postedOn'); cancelled:=public.cockpit_pay_date(p,'cancelledOn');
  eref:=public.cockpit_pay_text(p,'evidenceRef',200); evid:=public.cockpit_pay_text(p,'evidence',1000); v_note:=public.cockpit_pay_text(p,'note',500);
  fm:=CASE WHEN p ? 'fromMonth' AND p->'fromMonth'<>'null'::jsonb THEN public.cockpit_hours_month(p->>'fromMonth') END;
  -- The C7 rule (waves 5-6 4.9.3), only while pay proposals are on: a part the wins ledger pays
  -- names its win (win:<id>) or says why it is outside the ledger, and a win is paid once per
  -- proposal month (its own month, or the month a carried confirm names in forMonth).
  v_c7:=coalesce((SELECT s.value->'on'='true'::jsonb FROM public.cockpit_settings s WHERE s.key='pay.proposals'),false)
    AND pk=ANY(ARRAY['google_reviews','video_testimonials','podcasts','referrals','renewals','reactivations','upsells','recurring']);
  IF v_c7 THEN
    v_outside:=public.cockpit_pay_text(p,'outsideLedger',300);
    v_for:=CASE WHEN p ? 'forMonth' AND p->'forMonth'<>'null'::jsonb THEN public.cockpit_hours_month(p->>'forMonth') END;
    IF eref ~ '^win:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_win:=substr(eref,5)::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.cockpit_csm_wins w WHERE w.id=v_win AND w.stage<>'void') THEN
        RAISE EXCEPTION 'That win is not in the ledger, or it was voided.' USING ERRCODE='22023';
      END IF;
      IF v_for IS NOT NULL AND (v_for>=m0 OR NOT EXISTS (SELECT 1 FROM public.cockpit_pay_months pm
          WHERE pm.person_id=v_person.id AND pm.month=v_for AND pm.status='approved')) THEN
        RAISE EXCEPTION 'A carried entry names an approved month before the one it goes into.' USING ERRCODE='22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.cockpit_pay_entries e WHERE e.evidence_ref=eref AND e.part_key=pk AND e.voided_at IS NULL
          AND CASE WHEN e.note ~ '^For [A-Z][a-z]+ [0-9]{4}: ' THEN to_date(substring(e.note FROM '^For ([A-Z][a-z]+ [0-9]{4}): '),'FMMonth YYYY')
                   ELSE e.month END=coalesce(v_for,m0)) THEN
        RAISE EXCEPTION 'This win is already paid for %.', to_char(coalesce(v_for,m0),'FMMonth YYYY') USING ERRCODE='22023';
      END IF;
      IF v_for IS NOT NULL THEN v_note:=left('For '||to_char(v_for,'FMMonth YYYY')||': '||coalesce(v_note,pk),500); END IF;
    ELSE
      IF v_outside IS NULL OR length(v_outside)<10 THEN
        RAISE EXCEPTION 'This part comes from the wins ledger. Confirm its proposal, or say why it is not in the ledger.' USING ERRCODE='22023';
      END IF;
      v_note:=left('Outside the wins ledger: '||v_outside||coalesce('. '||v_note,''),500);
    END IF;
  END IF;

  IF pk='adjustment' THEN
    IF amt IS NULL OR amt=0 OR abs(amt)>100000 THEN RAISE EXCEPTION 'An adjustment needs an amount in USD that is not 0.' USING ERRCODE='22023'; END IF;
    IF v_note IS NULL OR length(v_note)<3 THEN RAISE EXCEPTION 'Say what the adjustment is for in the note.' USING ERRCODE='22023'; END IF;
    IF fm IS NOT NULL AND fm>=m0 THEN RAISE EXCEPTION 'An adjustment corrects an earlier month.' USING ERRCODE='22023'; END IF;
    INSERT INTO public.cockpit_pay_entries(person_id,month,part_key,amount_usd,client,evidence_ref,evidence,note,from_month,entered_by)
    VALUES(v_person.id,m0,'adjustment',round(amt,2),v_client,eref,evid,v_note,fm,v_actor) RETURNING id INTO v_id;
  ELSE
    part:=(SELECT x FROM jsonb_array_elements(coalesce(public.cockpit_pay_plan_for(v_person.id,m0)->'plan'->'parts','[]'::jsonb)) x WHERE x->>'key'=pk LIMIT 1);
    IF part IS NULL THEN RAISE EXCEPTION '%''s plan for % has no part "%".', v_person.name, mname, pk USING ERRCODE='22023'; END IF;
    kind:=part->>'kind'; ev:=part->>'event';
    IF kind='per_event' THEN
      IF ev='pif_deal_closed' THEN RAISE EXCEPTION 'The cockpit counts paid-in-full deals; there is nothing to type.' USING ERRCODE='22023'; END IF;
      IF qty IS NULL OR qty<>trunc(qty) OR abs(qty)>1000 THEN RAISE EXCEPTION 'Type a whole number.' USING ERRCODE='22023'; END IF;
      IF qty<0 AND v_note IS NULL THEN RAISE EXCEPTION 'A negative count is a clawback: say why in the note.' USING ERRCODE='22023'; END IF;
      general:=ev IN ('renewal','reactivation','referral');
      IF ev='google_review' AND qty>0 THEN
        IF evid IS NULL OR evid !~ '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION 'Paste the link to the review.' USING ERRCODE='22023'; END IF;
        IF posted IS NULL THEN RAISE EXCEPTION 'Type the day the review was posted.' USING ERRCODE='22023'; END IF;
      END IF;
      cash:=NULL; amt:=NULL; em:=NULL;
    ELSIF kind='share' THEN
      IF cash IS NULL OR cash<0 OR cash>10000000 THEN RAISE EXCEPTION 'Type the cash in USD (0 or more).' USING ERRCODE='22023'; END IF;
      IF em IS NULL AND jsonb_array_length(part->'steps')>1 THEN
        RAISE EXCEPTION 'Say which month of the engagement this is (1 for the first).' USING ERRCODE='22023';
      END IF;
      em:=coalesce(em,1);
      IF em<>trunc(em) OR em NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Say which month of the engagement this is (1 for the first).' USING ERRCODE='22023'; END IF;
      general:=part->>'of' IN ('upsell_cash','recurring_revenue');
      IF jsonb_typeof(part->'ends')='object' AND v_client IS NULL THEN RAISE EXCEPTION 'Name the client.' USING ERRCODE='22023'; END IF;
      -- A residual ends on cancellation or a payment lapse (decision 13, the CSM contract 7.4).
      IF em>=2 AND jsonb_typeof(part->'ends')='object' THEN
        IF part->'ends'->'onCancel'='true'::jsonb THEN
          SELECT min(e.cancelled_on) INTO d FROM public.cockpit_pay_entries e
            WHERE e.person_id=v_person.id AND e.part_key=pk AND e.voided_at IS NULL AND lower(btrim(e.client))=lower(v_client)
              AND (v_product IS NULL OR e.product IS NULL OR lower(btrim(e.product))=lower(v_product)) AND e.cancelled_on IS NOT NULL AND e.cancelled_on<m0;
          IF d IS NOT NULL THEN RAISE EXCEPTION 'The residual ended: % cancelled on %.', v_client, to_char(d,'FMDD Mon YYYY') USING ERRCODE='22023'; END IF;
        END IF;
        lapse:=public.cockpit_pay_num(part->'ends'->'lapseDays');
        IF lapse IS NOT NULL THEN
          SELECT max(e.cleared_on) INTO d FROM public.cockpit_pay_entries e
            WHERE e.person_id=v_person.id AND e.part_key=pk AND e.voided_at IS NULL AND lower(btrim(e.client))=lower(v_client)
              AND (v_product IS NULL OR e.product IS NULL OR lower(btrim(e.product))=lower(v_product)) AND e.cash_usd>0 AND e.month<m0 AND e.cleared_on IS NOT NULL;
          IF d IS NOT NULL AND coalesce(cleared,m0)-d>lapse THEN
            RAISE EXCEPTION 'The residual ended: no payment for over % days after %.', lapse, to_char(d,'FMDD Mon YYYY') USING ERRCODE='22023';
          END IF;
        END IF;
      END IF;
      qty:=NULL; amt:=NULL;
    ELSE
      RAISE EXCEPTION 'This part is worked out by the cockpit; confirm its input instead of typing it.' USING ERRCODE='22023';
    END IF;
    -- General conditions: a client, a cleared date in the month and an evidence reference.
    IF general AND coalesce(qty,cash,0)<>0 THEN
      IF v_client IS NULL THEN RAISE EXCEPTION 'Name the client.' USING ERRCODE='22023'; END IF;
      IF cleared IS NULL THEN RAISE EXCEPTION 'Type the day the payment cleared.' USING ERRCODE='22023'; END IF;
      IF date_trunc('month',cleared)::date<>coalesce(v_for,m0) THEN
        RAISE EXCEPTION 'Cleared on %: add it to %.', to_char(cleared,'FMDD Mon'), public.cockpit_hours_month_name(date_trunc('month',cleared)::date) USING ERRCODE='22023';
      END IF;
      IF eref IS NULL THEN RAISE EXCEPTION 'Add the payment id or the signed contract id.' USING ERRCODE='22023'; END IF;
    END IF;
    INSERT INTO public.cockpit_pay_entries(person_id,month,part_key,quantity,cash_usd,engagement_month,client,product,cleared_on,posted_on,cancelled_on,
      evidence_ref,evidence,note,entered_by)
    VALUES(v_person.id,m0,pk,qty,cash,em::int,v_client,v_product,cleared,posted,cancelled,eref,evid,v_note,v_actor) RETURNING id INTO v_id;
  END IF;
  PERFORM public.cockpit_hours_audit('pay.entry','cockpit_pay_entries',v_id::text,
    jsonb_build_object('id',v_id,'personId',v_person.id,'month',to_char(m0,'YYYY-MM'),'partKey',pk,'kind',coalesce(kind,'adjustment')),v_actor);
  RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 13. cockpit_wins_v: one row per non-void win, for the CEO refresh (goals,
--     lock-in, metrics). offered_on and accepted_on are the Kuwait days of the
--     first offered and accepted events (upsells are counted by event day,
--     4.8); ties lists each tied payment with its check state.

CREATE OR REPLACE VIEW public.cockpit_wins_v WITH (security_invoker = true) AS
SELECT w.id, w.task_id, w.client_name, w.kind, w.stage, w.won_on, w.quoted_usd, w.recurring, w.monthly_usd, w.csm_person_id,
       (f.facts->>'tiedCheckedUsd')::numeric AS tied_checked_usd,
       (f.facts->>'paidOn')::date AS paid_on,
       (w.source = 'import') AS imported,
       public.cockpit_win_event_day(w.id, 'offered') AS offered_on,
       public.cockpit_win_event_day(w.id, 'accepted') AS accepted_on,
       f.facts->'ties' AS ties,
       w.source
  FROM public.cockpit_csm_wins w
  CROSS JOIN LATERAL (SELECT public.cockpit_win_tie_facts(w.id) AS facts) f
 WHERE w.stage <> 'void';
COMMENT ON VIEW public.cockpit_wins_v IS
  'Non-void wins (WAVE56-CONTRACT 2.4, 4.8): read by the CEO refresh for goals, the lock-in and the wins metrics. Imported Typeform wins are void and never here; canary wins carry source canary and readers leave them out.';
REVOKE ALL ON public.cockpit_wins_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cockpit_wins_v TO service_role;

-- ---------------------------------------------------------------------------
-- 14. Grants: every function revoked from the four roles first; the seat RPCs
--     to authenticated (each gates first); the view's helpers to the
--     service role and the read-only user; the import and the helpers owner only.

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.cockpit_win_kind_label(text)', 'public.cockpit_win_stage_label(text)', 'public.cockpit_win_is_upsell(text)',
    'public.cockpit_win_fold(text)', 'public.cockpit_win_part(text,boolean)', 'public.cockpit_win_part_label(text)',
    'public.cockpit_win_month_words(date)', 'public.cockpit_win_link(jsonb,text)', 'public.cockpit_win_usd(jsonb,text)',
    'public.cockpit_win_uuid(jsonb,text)', 'public.cockpit_win_only(jsonb,text[])', 'public.cockpit_win_canary_card()',
    'public.cockpit_win_door_open()', 'public.cockpit_win_proposals_on()', 'public.cockpit_win_seat(text)',
    'public.cockpit_win_csm_person(text)', 'public.cockpit_win_proposal_prices(uuid)', 'public.cockpit_wins_audit()',
    'public.cockpit_wins_append_only()', 'public.cockpit_win_tie_proposals_guard()', 'public.cockpit_csm_wins_guard()',
    'public.cockpit_win_ties(uuid)', 'public.cockpit_win_event_day(uuid,text)', 'public.cockpit_win_tie_facts(uuid)',
    'public.cockpit_win_deal_row(text)', 'public.cockpit_win_contract_money(text)', 'public.cockpit_win_closer_paid(text)',
    'public.cockpit_win_price(bigint,date,text,numeric,numeric,integer)', 'public.cockpit_win_row(uuid)',
    'public.cockpit_win_event(uuid,text,text,text,jsonb)', 'public.cockpit_win_billing_event(uuid,text,text,text)',
    'public.cockpit_win_notice(uuid,text)', 'public.cockpit_csm_win_log(jsonb)', 'public.cockpit_csm_win_stage(jsonb)',
    'public.cockpit_csm_wins_read(text)', 'public.cockpit_csm_wins_list(date,date)', 'public.cockpit_csm_wins_today()',
    'public.cockpit_win_candidate_rows(uuid,boolean)', 'public.cockpit_win_tie_candidates(uuid)',
    'public.cockpit_csm_win_tie_propose(jsonb)', 'public.cockpit_ceo_win_tie_decide(jsonb)', 'public.cockpit_ceo_win_tie_clear(jsonb)',
    'public.cockpit_csm_win_invoice_link(uuid,text)', 'public.cockpit_win_pay_rows(date)', 'public.cockpit_ceo_pay_proposals(date)',
    'public.cockpit_ceo_pay_proposal_decide(jsonb)', 'public.cockpit_csm_win_import(jsonb)',
    'public.cockpit_ceo_payment_tie(jsonb)', 'public.cockpit_ceo_payment_untie(jsonb)', 'public.cockpit_ceo_pay_entry_save(jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.cockpit_csm_win_log(jsonb)', 'public.cockpit_csm_win_stage(jsonb)', 'public.cockpit_csm_wins_read(text)',
    'public.cockpit_csm_wins_list(date,date)', 'public.cockpit_csm_wins_today()', 'public.cockpit_win_tie_candidates(uuid)',
    'public.cockpit_csm_win_tie_propose(jsonb)', 'public.cockpit_ceo_win_tie_decide(jsonb)', 'public.cockpit_ceo_win_tie_clear(jsonb)',
    'public.cockpit_csm_win_invoice_link(uuid,text)', 'public.cockpit_ceo_pay_proposals(date)', 'public.cockpit_ceo_pay_proposal_decide(jsonb)',
    'public.cockpit_ceo_payment_tie(jsonb)', 'public.cockpit_ceo_payment_untie(jsonb)', 'public.cockpit_ceo_pay_entry_save(jsonb)'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  -- The view's helpers: the service role (guardian, workers) and the CEO refresh's read-only user (lesson of 20261101r).
  FOREACH f IN ARRAY ARRAY['public.cockpit_win_tie_facts(uuid)', 'public.cockpit_win_ties(uuid)', 'public.cockpit_win_event_day(uuid,text)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_read_only_user') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO supabase_read_only_user', f);
    END IF;
  END LOOP;
  -- The guardian's pay-proposals check reads the proposal rule with the service key (6.2).
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_win_pay_rows(date) TO service_role';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_read_only_user') THEN
    EXECUTE 'GRANT SELECT ON public.cockpit_wins_v TO supabase_read_only_user';
  END IF;
END $$;

COMMENT ON FUNCTION public.cockpit_csm_win_log(jsonb) IS
  'Log a win (WAVE56-CONTRACT 3.3): the CEO, or a CSM the client gate allows. Door marker wins. Writes the win, its event, a billing event kind win (card comment, held until D-W), the win.logged notice and a confirmed form response. Never an email on a screen.';
COMMENT ON FUNCTION public.cockpit_ceo_win_tie_clear(jsonb) IS
  'The only way a win tie is cleared (2.2): refused once the CSM was paid for the win in an approved month (X31); lists the confirmed pay entries of open months.';
COMMENT ON FUNCTION public.cockpit_win_pay_rows(date) IS
  'The pay proposal rule of WAVE56-CONTRACT 4.9 as rows, derived on read from the wins ledger; only the CEO''s decisions are stored.';

NOTIFY pgrst, 'reload schema';
COMMIT;
