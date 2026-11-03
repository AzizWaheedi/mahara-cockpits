-- The sale tie: every New Client Form (the sale) on its client card (CEO-6, 2026-11-02: "Should already be synced,
-- if not do it fully now"; the next-design plan's build B3, letter g). Creative Triage (bldgtotkfmhoxmlzowdx).
-- Contract: docs/forms/WAVE56-CONTRACT.md 4.19. Design: next-design/sale-tie.md 2.1 to 2.9 and 2.11.
--
-- Dark at apply: the setting forms.sale_tie {on, fill, salesLink} is seeded all false, so the door only stores the
-- sale's two digests in a waiting row, nothing ties, nothing is mirrored and nothing is planned for a card. Applies
-- twice. Stands on 20261102o (cockpit_form_typeform_text) and its chain, the billing balances (20261023x:
-- cockpit_billing_card_listed, cockpit_billing_deal_assignments), the cockpit identity and the vault.
--
-- 1. Keys, exact and unique only, phone first, then email, never a name (2.1). A phone is E.164 after one
--    normaliser (cockpit_sale_tie_norm): spaces, dashes, dots and brackets out, a leading 00 becomes +, and the
--    New Client Form's raw-phone answer (typed without the +) gets a + in front; anything else is no key. An email is
--    lower(btrim()), with no folding of dots or plus tags. Keys are kept only as HMAC-SHA256 digests under a vault
--    secret, cockpit_sale_tie_pepper, made here from 32 random bytes when absent and read only by owner functions.
--    A phone or an email travels into the database inside one service call (the door's tie_open, the sync's offer
--    and backfill) and is digested at once: never stored, logged, audited or returned. No digest is in an audit row.
-- 2. cockpit_sale_ties (append-only, the house style of cockpit_payment_ties): one live row per sale
--    (response_id, the Typeform token), its state (waiting, tied, ambiguous, conflict, unmatched, void,
--    not_client), the card when tied and how (phone, email, phone_email, person), which card key matched
--    (card_fields, onboarding_answer, both), the candidates and older cards with the same key (ids only), the
--    suggestion for a person, billing's card at the time (the second source), the sale's two digests, a person's
--    note. A new decision clears the live row once (cleared_*) and inserts the next. Delete and truncate refused.
--    cockpit_sale_tie_cards keeps each card's own Phone Number and Email digests (K1, never the values) and its
--    creation time in ClickUp, as the onboarding sync offers them, so a tie needs no second read of the card.
--    Row security on both, no policy, every grant revoked, SELECT for service_role only (the guardian).
-- 3. One match rule for every path (cockpit_sale_tie_match, 2.3). Candidates are cards on the billing sheet, and a
--    card the onboarding sync already keeps that billing-sync has not listed yet (cockpit_client_onboarding, so a card
--    Make made tonight is a candidate from the sync run that saw it, not from billing-sync's next morning run); never
--    the playing account or an internal test, by the billing name, else the onboarding name. A candidate's card key
--    (K1) or client onboarding answer (K2) has the sale's digest. Phone first: one card ties `phone`, and
--    `phone_email` when the email points at it too; the email on
--    other cards only is a `conflict` for a person. Several cards share the key (a returning client: Make makes a
--    card on every sale): the one card ClickUp made in [sale - 10 minutes, sale + 48 hours] ties, the older cards
--    are kept as also_on. While the sale is under 2 days old a card made before that window never ties it: the
--    row waits for the card Make is making (this build's reading of 2.3.3, so a returning client is never tied to
--    the old card while the new one is minutes away). No phone match: the same by email. Still several cards:
--    `ambiguous`. No card: `waiting` for 2 days, then `unmatched`. Voided in B2B: `void`. A person's decision is
--    never changed by the system; only waiting and unmatched rows are checked again (the backfill also re-checks
--    the system's own ambiguous and conflict rows, and its own tied rows whose card notes are not planned yet, with
--    every card's K1 and creation time in hand: a sync run between `on` and the job ties from K2 alone, and the job
--    settles those ties; a tie with a sale_facts effect stays as it is).
-- 4. The live tie is mirrored on the stored sale: cockpit_form_responses.task_id and client_name, and answer_meta's
--    match and matched, in the same transaction, under cockpit.forms_legacy = 'sale_tie'. The responses guard
--    (cockpit_form_responses_guard, drift-guarded) gains exactly that carve-out: a submitted new_client response,
--    answers unchanged, answer_meta changed only in match and matched, the card equal to its live tied row or none.
-- 5. Card fields (2.8): with forms.sale_tie.fill on, the newest live tie on a card on the books plans one
--    cockpit_form_effects row new_client/sale_facts and its writeback queue row, exactly as build B1's writer reads
--    it: the plan {taskId, fields:[{fieldId, kind, label, value, onlyIfEmpty:true, source}]} holds the texts; the
--    queue payload is {formKey:'new_client', effectKey:'sale_facts', effectId, responseId, taskId} and never a text
--    (the queue's audit trigger copies payloads). Only Go-live expectation (d4483463) and Handoff problems
--    (e17a1c27), as typed (cockpit_form_typeform_text), and the Sales Meeting Link (1f2e9ad1, https) only while
--    forms.sale_tie.salesLink is on. Never the Closer, Closer Notes, Daily Budget, Country, Email, Phone Number or
--    a billing field. A gone card or an older sale plans a skipped effect with its sentence; while fill is off
--    nothing is planned, so turning fill on later plans every tie then (cockpit_sale_tie_sweep). A card billing-sync
--    has not listed yet plans nothing until it does. Nothing is planned either until the forms gate carries build
--    B2's (new_client, sale_facts) branch (20261103c; cockpit_sale_tie_gate_ready reads the gate's body): today's gate
--    (20261102j) does not hold such a row, the claim's first pass settles it skipped "Make owns this again." in any
--    mode, and the sale's one effect slot would be spent. The sweep's health note says so. With the branch, the writer
--    holds the row until CLICKUP_WRITEBACK_FORMS_KEYS lists new_client. This file does not touch the gate.
--    Taking a write back: a person moving, clearing or marking not a client a tie whose write has not started, and
--    forms.sale_tie losing on or fill, settle that queue row skipped with a plain sentence, so the live settle trigger
--    skips its effect and nothing reaches the card (cockpit_sale_tie_take_back). A write already sending or unknown is
--    never taken back: a move waits for it, and the switch leaves it to finish.
-- 6. Paths. The door (forms-door, service role): cockpit_sale_tie_open after the record, and
--    cockpit_sale_tie_door_failed when that call fails (detail.tie on forms-door:new_client). The onboarding sync
--    (service role, every 10 minutes): cockpit_sale_tie_waiting, cockpit_sale_tie_offer per card page, and
--    cockpit_sale_tie_sweep at the end of a run; its job {"job":"saleTies","dryRun":...} calls
--    cockpit_sale_tie_backfill with every card's K1 (a dry run writes nothing and answers counts only). People
--    (authenticated, gated here): cockpit_sale_tie_list ("Sales not on a card"), cockpit_sale_tie_decide (yes,
--    pick, not_client, clear; the CEO any row, a CSM only for their own clients, a CSM never moves a tie whose
--    notes are on a card already) and cockpit_csm_sale_read (the kickoff rail and the OnboardingKit).
-- 7. portal_form_onboarding_open (drift-guarded): the business name context comes from the card's newest live,
--    tied sale's answer a1be4eee (contract 4.14.1's promise, which never fired: the sales had no card and no
--    businessName key). Nothing else in the function changes.
-- 8. The new_client registry row gains sale_tie (sql) and sale_facts (clickup_queue), both the cockpit's, one audit
--    row each; cockpit_form_doors() (drift-guarded) reports saleTie, saleFacts and salesLink with their why.
--
-- Billing's money tie (cockpit_billing_deal_assignments) is read, never changed. Every write leaves an audit row:
-- the tie rows by their own trigger (ids, states and methods; never a digest or a note), the card digests one row
-- per call (counts), the mirror, the effects, the queue, the registry and the setting by their live triggers.
--
-- Rollback: forms.sale_tie all false stops ties and new plans at once, and its trigger takes back every card write
-- that has not started (its effect ends skipped "Card writes for sales were turned off, so nothing was written.";
-- that sale's one effect slot is spent, so its notes are a hand step if fill comes back on); a write already sending or
-- unknown finishes, and the forms trail shows where it landed. The three replaced bodies go back from
-- notes/forms-w56/deploy/before-<name>.sql (their live md5s are in the guard below). Ties are append-only (a person
-- clears one with a reason); fills are only-if-empty, and every written card is in the effects' trail.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. What this file stands on, then the drift guard on the three replaced functions.

DO $$
BEGIN
  IF to_regclass('public.cockpit_form_responses') IS NULL OR to_regclass('public.cockpit_form_effects') IS NULL
     OR to_regclass('public.cockpit_clickup_writeback_queue') IS NULL OR to_regclass('public.cockpit_sales_deals') IS NULL
     OR to_regclass('public.cockpit_billing_accounts') IS NULL OR to_regclass('public.cockpit_client_onboarding') IS NULL
     OR to_regclass('public.cockpit_settings') IS NULL OR to_regclass('public.cockpit_sync_state') IS NULL
     OR to_regclass('public.cockpit_forms') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.cockpit_forms f WHERE f.key = 'new_client')
     OR to_regprocedure('public.cockpit_form_typeform_text(text)') IS NULL
     OR to_regprocedure('public.cockpit_form_responses_guard()') IS NULL
     OR to_regprocedure('public.portal_form_onboarding_open(text,text,text,text)') IS NULL
     OR to_regprocedure('public.cockpit_form_doors()') IS NULL
     OR to_regprocedure('public.cockpit_billing_card_listed(text,boolean)') IS NULL
     OR to_regprocedure('public.cockpit_billing_deal_assignments()') IS NULL
     OR to_regprocedure('public.cockpit_hours_require_service()') IS NULL
     OR to_regprocedure('public.cockpit_hours_refuse_delete()') IS NULL
     OR to_regprocedure('public.cockpit_client_allowed(text)') IS NULL
     OR to_regprocedure('public.cockpit_csm_actor()') IS NULL
     OR to_regprocedure('public.cockpit_csm_client_gate(text)') IS NULL
     OR to_regprocedure('public.cockpit_form_actor()') IS NULL
     OR to_regprocedure('extensions.hmac(text,text,text)') IS NULL
     OR to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261102o (Stage 4, match Make) and the billing balances (20261023x) before 20261103g.'
      USING ERRCODE = '55000';
  END IF;
END $$;

DO $$
DECLARE
  v text;
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('cockpit_form_responses_guard()', 'd013e81456ebe7a8791270fe8858b972', 'f6caf2beba4c83801001f7e603844e62'),
      ('portal_form_onboarding_open(text,text,text,text)', '81c9ede6f7c2c511d1e34c22388ddf24', 'fce6f339b02986b2d5cfcc09729a5def'),
      ('cockpit_form_doors()', '709af1bfae87a41adaa5edf46ca5f0a9', '2f0ada3d4b667de7d9d7139677960bdf')
    ) AS x(fn, live, after) LOOP
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.' || r.fn);
    IF v IS DISTINCT FROM r.live AND v IS DISTINCT FROM r.after THEN
      RAISE EXCEPTION '% changed since the sale tie design read it; stop and re-read it.', r.fn USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

SELECT set_config('cockpit.audit_actor', 'migration', true), set_config('cockpit.audit_source', 'migration', true);

-- ---------------------------------------------------------------------------
-- 1. The pepper: the HMAC key the digests are made under. Made once; never shown, never rotated by this file.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = 'cockpit_sale_tie_pepper') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cockpit_sale_tie_pepper',
      'The sale tie''s HMAC key (20261103g): phones and emails are kept only as digests under it. Never shown. Rotating it orphans every stored digest until the backfill derives them again.');
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before,
      after, metadata)
    VALUES ('forms.sale_tie_pepper_created', 'vault.secrets', 'cockpit_sale_tie_pepper', 'migration', 'client-success',
            'migration', NULL, NULL, '{"bytes":32}'::jsonb);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Tables

CREATE TABLE IF NOT EXISTS public.cockpit_sale_ties (
  id                 bigserial PRIMARY KEY,
  -- The sale's Typeform token (cockpit_form_responses.external_id, cockpit_sales_deals.response_id).
  response_id        text NOT NULL CHECK (response_id ~ '^[A-Za-z0-9]{8,64}$'),
  -- The stored sale, when the cockpit stores it.
  form_response_id   uuid REFERENCES public.cockpit_form_responses(id),
  state              text NOT NULL CHECK (state IN ('waiting','tied','ambiguous','conflict','unmatched','void','not_client')),
  clickup_task_id    text CHECK (clickup_task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  matched_by         text CHECK (matched_by IN ('phone','email','phone_email','person')),
  key_source         text CHECK (key_source IN ('card_fields','onboarding_answer','both')),
  candidates         text[] NOT NULL DEFAULT '{}',
  also_on            text[] NOT NULL DEFAULT '{}',
  suggested_task_id  text CHECK (suggested_task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  suggested_by       text CHECK (suggested_by IN ('billing','sales_call')),
  billing_task_id    text CHECK (billing_task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  billing_matched_by text CHECK (char_length(billing_matched_by) <= 40),
  -- HMAC-SHA256 digests of the sale's keys, never the values.
  phone_key          text CHECK (phone_key ~ '^[0-9a-f]{64}$'),
  email_key          text CHECK (email_key ~ '^[0-9a-f]{64}$'),
  note               text CHECK (char_length(btrim(note)) BETWEEN 3 AND 500),
  set_by             text NOT NULL CHECK (btrim(set_by) <> '' AND char_length(set_by) <= 200),
  set_at             timestamptz NOT NULL DEFAULT now(),
  cleared_by         text,
  cleared_at         timestamptz,
  cleared_reason     text,
  CONSTRAINT cockpit_sale_ties_card CHECK ((state = 'tied') = (clickup_task_id IS NOT NULL)),
  CONSTRAINT cockpit_sale_ties_method CHECK ((state = 'tied') = (matched_by IS NOT NULL)),
  CONSTRAINT cockpit_sale_ties_person_note CHECK (note IS NOT NULL OR (matched_by IS DISTINCT FROM 'person' AND state <> 'not_client')),
  CONSTRAINT cockpit_sale_ties_cleared CHECK ((cleared_at IS NULL) = (cleared_by IS NULL) AND (cleared_at IS NULL) = (cleared_reason IS NULL))
);
COMMENT ON TABLE public.cockpit_sale_ties IS
  'The sale tie (20261103g, contract 4.19): each New Client Form (response_id, the Typeform token) on its client card, by an exact phone or email digest or a person, never a name. One live row per sale; append-only: a new decision clears the live row once and inserts the next. phone_key and email_key are HMAC digests under the vault''s cockpit_sale_tie_pepper, never values. Browsers read it only through cockpit_sale_tie_list and cockpit_csm_sale_read.';
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_sale_ties_live ON public.cockpit_sale_ties (response_id) WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS cockpit_sale_ties_card ON public.cockpit_sale_ties (clickup_task_id) WHERE cleared_at IS NULL AND state = 'tied';

CREATE TABLE IF NOT EXISTS public.cockpit_sale_tie_cards (
  clickup_task_id text PRIMARY KEY CHECK (clickup_task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  -- The card's own Phone Number (085d5e18) and Email (a90c8230) as digests, never values.
  phone_key       text CHECK (phone_key ~ '^[0-9a-f]{64}$'),
  email_key       text CHECK (email_key ~ '^[0-9a-f]{64}$'),
  -- When ClickUp made the card (its date_created): the window rule's evidence.
  created_at      timestamptz,
  seen_at         timestamptz NOT NULL DEFAULT now(),
  seen_by         text NOT NULL CHECK (seen_by IN ('system:onboarding-sync','system:backfill'))
);
COMMENT ON TABLE public.cockpit_sale_tie_cards IS
  'The sale tie''s card keys (20261103g): each card''s Phone Number and Email as HMAC digests (never values) and its ClickUp creation time, as the onboarding sync last offered them. Written only by cockpit_sale_tie_offer and cockpit_sale_tie_backfill, one audit row per call.';

ALTER TABLE public.cockpit_sale_ties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_sale_tie_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_sale_ties, public.cockpit_sale_tie_cards FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_sale_ties, public.cockpit_sale_tie_cards TO service_role;
REVOKE ALL ON SEQUENCE public.cockpit_sale_ties_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- A tie is never deleted, truncated or edited: removing it sets cleared_* once.
CREATE OR REPLACE FUNCTION public.cockpit_sale_ties_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.cleared_at IS NOT NULL THEN
    RAISE EXCEPTION 'A cleared sale tie is kept as it was: decide the sale again instead.' USING ERRCODE = '42501';
  END IF;
  IF (pg_catalog.to_jsonb(NEW) - ARRAY['cleared_by','cleared_at','cleared_reason'])
       IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - ARRAY['cleared_by','cleared_at','cleared_reason'])
     OR NEW.cleared_at IS NULL OR NEW.cleared_by IS NULL THEN
    RAISE EXCEPTION 'A sale tie is never edited: clear it and decide again.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cockpit_sale_ties_guard_delete ON public.cockpit_sale_ties;
CREATE TRIGGER cockpit_sale_ties_guard_delete BEFORE DELETE ON public.cockpit_sale_ties
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_hours_refuse_delete();
DROP TRIGGER IF EXISTS cockpit_sale_ties_guard_truncate ON public.cockpit_sale_ties;
CREATE TRIGGER cockpit_sale_ties_guard_truncate BEFORE TRUNCATE ON public.cockpit_sale_ties
  FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_hours_refuse_delete();
DROP TRIGGER IF EXISTS cockpit_sale_ties_lock ON public.cockpit_sale_ties;
CREATE TRIGGER cockpit_sale_ties_lock BEFORE UPDATE ON public.cockpit_sale_ties
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_sale_ties_lock();
DROP TRIGGER IF EXISTS cockpit_sale_tie_cards_guard_delete ON public.cockpit_sale_tie_cards;
CREATE TRIGGER cockpit_sale_tie_cards_guard_delete BEFORE DELETE ON public.cockpit_sale_tie_cards
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_hours_refuse_delete();
DROP TRIGGER IF EXISTS cockpit_sale_tie_cards_guard_truncate ON public.cockpit_sale_tie_cards;
CREATE TRIGGER cockpit_sale_tie_cards_guard_truncate BEFORE TRUNCATE ON public.cockpit_sale_tie_cards
  FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_hours_refuse_delete();

-- One audit row per tie row written or cleared: ids, states and methods; never a digest, a note or a reason's text.
CREATE OR REPLACE FUNCTION public.cockpit_sale_ties_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_keys text[] := ARRAY['id','response_id','form_response_id','state','clickup_task_id','matched_by','key_source',
                         'candidates','also_on','suggested_task_id','suggested_by','billing_task_id','billing_matched_by',
                         'set_by','set_at','cleared_by','cleared_at'];
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb;
  b jsonb;
  a jsonb;
  v_actor text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    SELECT jsonb_object_agg(k, v_old->k) INTO b FROM unnest(v_keys) k;
  END IF;
  SELECT jsonb_object_agg(k, v_new->k) INTO a FROM unnest(v_keys) k;
  SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before,
    after, metadata)
  VALUES (CASE WHEN TG_OP = 'UPDATE' THEN 'forms.sale_tie_cleared'
               ELSE coalesce(nullif(current_setting('cockpit.forms_action', true), ''), 'forms.sale_tie.insert') END,
          'cockpit_sale_ties', NEW.id::text,
          coalesce(v_actor, CASE WHEN TG_OP = 'UPDATE' THEN NEW.cleared_by ELSE NEW.set_by END),
          'client-success', coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'),
          b, a,
          jsonb_build_object('op', lower(TG_OP), 'form_key', 'new_client', 'task_id', NEW.clickup_task_id,
                             'has_note', NEW.note IS NOT NULL)
            || CASE WHEN TG_OP = 'INSERT' THEN jsonb_strip_nulls(jsonb_build_object(
                 'choice', nullif(current_setting('cockpit.sale_tie_choice', true), ''),
                 'role', nullif(current_setting('cockpit.sale_tie_role', true), ''),
                 'factsOnCard', nullif(current_setting('cockpit.sale_tie_facts_on', true), ''),
                 'factsTakenBack', nullif(current_setting('cockpit.sale_tie_facts_back', true), '')))
               ELSE '{}'::jsonb END);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS cockpit_sale_ties_audit ON public.cockpit_sale_ties;
CREATE TRIGGER cockpit_sale_ties_audit AFTER INSERT OR UPDATE ON public.cockpit_sale_ties
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_sale_ties_audit();

-- ---------------------------------------------------------------------------
-- 3. Keys and digests (owner only)

-- forms.sale_tie as three booleans; anything but true is false.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_flags()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'on', coalesce((SELECT c.value->>'on' FROM public.cockpit_settings c WHERE c.key = 'forms.sale_tie'), '') = 'true',
    'fill', coalesce((SELECT c.value->>'fill' FROM public.cockpit_settings c WHERE c.key = 'forms.sale_tie'), '') = 'true',
    'salesLink', coalesce((SELECT c.value->>'salesLink' FROM public.cockpit_settings c WHERE c.key = 'forms.sale_tie'), '') = 'true')
$$;

-- One key in one shape, or NULL (never a guess). p_kind: 'phone' (a typed or card phone: it must carry its country
-- code, + or 00), 'raw_phone' (the New Client Form's raw-phone answer and the client's onboarding answer: digits, a +
-- put in front of 10 to 15 digits), 'email'.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_norm(p_kind text, p_value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v text;
BEGIN
  IF p_value IS NULL OR char_length(p_value) > 320 THEN
    RETURN NULL;
  END IF;
  IF p_kind = 'email' THEN
    v := lower(btrim(p_value));
    IF char_length(v) > 254 OR v !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RETURN NULL;
    END IF;
    RETURN v;
  END IF;
  IF p_kind NOT IN ('phone','raw_phone') THEN
    RETURN NULL;
  END IF;
  v := translate(regexp_replace(p_value, '[[:space:] ‎‏‪-‮]+', '', 'g'), '.()[]-', '');
  IF left(v, 2) = '00' THEN
    v := '+' || substr(v, 3);
  ELSIF p_kind = 'raw_phone' AND left(v, 1) <> '+' THEN
    IF v !~ '^[0-9]{10,15}$' THEN
      RETURN NULL;
    END IF;
    v := '+' || v;
  END IF;
  IF v !~ '^\+[1-9][0-9]{7,14}$' THEN
    RETURN NULL;
  END IF;
  RETURN v;
END $$;

-- HMAC-SHA256 of '<kind>:<normalised key>' under the pepper, hex. NULL in, NULL out.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_digest(p_kind text, p_norm text, p_pepper text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_norm IS NULL OR p_pepper IS NULL OR p_pepper = '' OR p_kind NOT IN ('phone','email') THEN
    RETURN NULL;
  END IF;
  RETURN encode(extensions.hmac(p_kind || ':' || p_norm, p_pepper, 'sha256'), 'hex');
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_pepper()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text;
BEGIN
  SELECT s.decrypted_secret INTO v FROM vault.decrypted_secrets s WHERE s.name = 'cockpit_sale_tie_pepper' LIMIT 1;
  IF v IS NULL OR char_length(v) < 32 THEN
    RAISE EXCEPTION 'The sale tie key is missing from the vault. Apply 20261103g again: it makes one.' USING ERRCODE = '55000';
  END IF;
  RETURN v;
END $$;

-- One key's digest, or NULL when the value is no key.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_key(p_kind text, p_value text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_norm text := public.cockpit_sale_tie_norm(p_kind, p_value);
BEGIN
  IF v_norm IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN public.cockpit_sale_tie_digest(CASE WHEN p_kind = 'email' THEN 'email' ELSE 'phone' END, v_norm,
                                        public.cockpit_sale_tie_pepper());
END $$;

-- A stored answer's value by its Typeform ref ({fields: [...]} or a bare list).
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_answer(p_answers jsonb, p_ref text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT f->>'value' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_answers->'fields') = 'array' THEN p_answers->'fields'
                                                    WHEN jsonb_typeof(p_answers) = 'array' THEN p_answers
                                                    ELSE '[]'::jsonb END) f
   WHERE jsonb_typeof(f) = 'object' AND f->>'ref' = p_ref AND jsonb_typeof(f->'value') IN ('string','number')
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_ts(p text)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF p IS NULL OR p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN
    RETURN NULL;
  END IF;
  RETURN p::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

-- The sale's keys from what the cockpit stores (the backfill, and the sweep when the door opened no row): the raw
-- phone answer (f322053a) only when its last 8 digits equal B2B's phone8, and B2B's email.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_stored_keys(p_token text, p_pepper text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_raw text;
  v_phone8 text;
  v_email text;
  v_norm text;
BEGIN
  SELECT public.cockpit_sale_tie_answer(r.answers, 'f322053a-3b86-4e8c-8596-93d31a096679') INTO v_raw
    FROM public.cockpit_form_responses r WHERE r.form_key = 'new_client' AND r.external_id = p_token;
  SELECT d.phone8, d.email INTO v_phone8, v_email FROM public.cockpit_sales_deals d WHERE d.response_id = p_token LIMIT 1;
  v_norm := public.cockpit_sale_tie_norm('raw_phone', v_raw);
  v_phone8 := regexp_replace(coalesce(v_phone8, ''), '[^0-9]', '', 'g');
  IF v_norm IS NULL OR char_length(v_phone8) < 8 OR right(v_norm, 8) <> right(v_phone8, 8) THEN
    v_norm := NULL;
  END IF;
  RETURN jsonb_build_object(
    'phone', public.cockpit_sale_tie_digest('phone', v_norm, p_pepper),
    'email', public.cockpit_sale_tie_digest('email', public.cockpit_sale_tie_norm('email', v_email), p_pepper));
END $$;

-- The candidate cards: every card on the billing sheet, and every card the onboarding sync keeps that billing-sync
-- has not listed yet (a card Make made since billing-sync's last run; never the playing account or an internal test,
-- by the billing name, else the onboarding name) with a key, as [{t, p1, e1, p2, e2, c}]: K1 the card's own Phone
-- Number and Email (given now, else as last stored), K2 the client's onboarding answer (64f2fb80, 7994f0d2), c when
-- ClickUp made the card. Digests only.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_card_keys(p_cards jsonb, p_pepper text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  WITH given AS (
    SELECT DISTINCT ON (c->>'taskId') c->>'taskId' AS t,
           public.cockpit_sale_tie_digest('phone', public.cockpit_sale_tie_norm('phone', c->>'phone'), p_pepper) AS p1,
           public.cockpit_sale_tie_digest('email', public.cockpit_sale_tie_norm('email', c->>'email'), p_pepper) AS e1,
           public.cockpit_sale_tie_ts(c->>'createdAt') AS c
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_cards) = 'array' THEN p_cards ELSE '[]'::jsonb END) c
     WHERE jsonb_typeof(c) = 'object' AND coalesce(c->>'taskId', '') ~ '^[A-Za-z0-9_-]{1,40}$'
     ORDER BY c->>'taskId'
  ), k1 AS (
    SELECT coalesce(g.t, s.clickup_task_id) AS t,
           CASE WHEN g.t IS NOT NULL THEN g.p1 ELSE s.phone_key END AS p1,
           CASE WHEN g.t IS NOT NULL THEN g.e1 ELSE s.email_key END AS e1,
           coalesce(g.c, s.created_at) AS c
      FROM given g FULL JOIN public.cockpit_sale_tie_cards s ON s.clickup_task_id = g.t
  ), k2 AS (
    SELECT o.clickup_task_id AS t,
           public.cockpit_sale_tie_digest('phone', public.cockpit_sale_tie_norm('raw_phone',
             public.cockpit_sale_tie_answer(o.forms->'onboarding'->'answers', '64f2fb80-b074-4017-b8b7-b7d549947e52')), p_pepper) AS p2,
           public.cockpit_sale_tie_digest('email', public.cockpit_sale_tie_norm('email',
             public.cockpit_sale_tie_answer(o.forms->'onboarding'->'answers', '7994f0d2-baeb-451b-983a-816290873a68')), p_pepper) AS e2
      FROM public.cockpit_client_onboarding o
     WHERE jsonb_typeof(o.forms->'onboarding'->'answers') = 'array'
  ), cards AS (
    SELECT b.clickup_task_id AS t, b.client_name AS name FROM public.cockpit_billing_accounts b
    UNION ALL
    SELECT o.clickup_task_id, o.client_name FROM public.cockpit_client_onboarding o
     WHERE nullif(btrim(coalesce(o.client_name, '')), '') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_accounts b WHERE b.clickup_task_id = o.clickup_task_id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('t', a.t, 'p1', k1.p1, 'e1', k1.e1, 'p2', k2.p2,
                                               'e2', k2.e2, 'c', k1.c) ORDER BY a.t), '[]'::jsonb)
    INTO v
    FROM cards a
    LEFT JOIN k1 ON k1.t = a.t
    LEFT JOIN k2 ON k2.t = a.t
   WHERE coalesce(a.name, '') !~* 'playing account|\[internal test\]'
     AND num_nonnulls(k1.p1, k1.e1, k2.p2, k2.e2) > 0;
  RETURN v;
END $$;

-- One key's candidates resolved by the window: {state: none | pick | ambiguous | waiting, pick, cands, also}.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_resolve(p_cands text[], p_at timestamptz, p_keys jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_win text[];
  v_fresh boolean := p_at IS NOT NULL AND now() < p_at + interval '48 hours';
BEGIN
  IF coalesce(cardinality(p_cands), 0) = 0 THEN
    RETURN jsonb_build_object('state', 'none', 'cands', '[]'::jsonb);
  END IF;
  SELECT coalesce(array_agg(DISTINCT k->>'t' ORDER BY k->>'t'), '{}') INTO v_win
    FROM jsonb_array_elements(p_keys) k
   WHERE k->>'t' = ANY(p_cands) AND p_at IS NOT NULL AND k->>'c' IS NOT NULL
     AND (k->>'c')::timestamptz BETWEEN p_at - interval '10 minutes' AND p_at + interval '48 hours';
  IF cardinality(v_win) = 1 THEN
    RETURN jsonb_build_object('state', 'pick', 'pick', v_win[1], 'cands', to_jsonb(p_cands),
                              'also', to_jsonb(array_remove(p_cands, v_win[1])));
  ELSIF cardinality(v_win) > 1 THEN
    RETURN jsonb_build_object('state', 'ambiguous', 'cands', to_jsonb(v_win));
  ELSIF v_fresh THEN
    -- Only cards made before the sale: the card Make is making may still come.
    RETURN jsonb_build_object('state', 'waiting', 'cands', to_jsonb(p_cands));
  ELSIF cardinality(p_cands) = 1 THEN
    RETURN jsonb_build_object('state', 'pick', 'pick', p_cands[1], 'cands', to_jsonb(p_cands), 'also', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('state', 'ambiguous', 'cands', to_jsonb(p_cands));
END $$;

-- The one match rule (2.3), on the sale's digests, its signing time and the candidate cards. Answers
-- {state: tied | ambiguous | conflict | waiting, taskId, matchedBy, keySource, candidates, alsoOn}; waiting means no
-- card yet (the caller turns it unmatched after 2 days).
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_match(p_phone text, p_email text, p_at timestamptz, p_keys jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_keys jsonb := CASE WHEN jsonb_typeof(p_keys) = 'array' THEN p_keys ELSE '[]'::jsonb END;
  v_pc text[];
  v_ec text[];
  p jsonb;
  e jsonb;
  v_pick text;
  v_by text;
  v_k1 boolean;
  v_k2 boolean;
  v_also text[];
  card jsonb;
BEGIN
  SELECT coalesce(array_agg(DISTINCT k->>'t' ORDER BY k->>'t'), '{}') INTO v_pc
    FROM jsonb_array_elements(v_keys) k WHERE p_phone IS NOT NULL AND (k->>'p1' = p_phone OR k->>'p2' = p_phone);
  SELECT coalesce(array_agg(DISTINCT k->>'t' ORDER BY k->>'t'), '{}') INTO v_ec
    FROM jsonb_array_elements(v_keys) k WHERE p_email IS NOT NULL AND (k->>'e1' = p_email OR k->>'e2' = p_email);
  p := public.cockpit_sale_tie_resolve(v_pc, p_at, v_keys);
  e := public.cockpit_sale_tie_resolve(v_ec, p_at, v_keys);

  IF p->>'state' = 'pick' THEN
    v_pick := p->>'pick';
    IF cardinality(v_ec) = 0 THEN
      v_by := 'phone';
    ELSIF v_pick = ANY(v_ec) THEN
      v_by := 'phone_email';
    ELSE
      RETURN jsonb_build_object('state', 'conflict', 'candidates',
        to_jsonb((SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(array_append(v_ec, v_pick)) x)), 'alsoOn', '[]'::jsonb);
    END IF;
  ELSIF p->>'state' = 'ambiguous' THEN
    IF e->>'state' = 'pick' AND (e->>'pick') = ANY(v_pc) THEN
      v_pick := e->>'pick';
      v_by := 'phone_email';
    ELSE
      RETURN jsonb_build_object('state', 'ambiguous', 'candidates', p->'cands', 'alsoOn', '[]'::jsonb);
    END IF;
  ELSIF p->>'state' = 'waiting' THEN
    RETURN jsonb_build_object('state', 'waiting', 'candidates', '[]'::jsonb, 'alsoOn', '[]'::jsonb);
  ELSIF e->>'state' = 'pick' THEN
    v_pick := e->>'pick';
    v_by := 'email';
  ELSIF e->>'state' = 'ambiguous' THEN
    RETURN jsonb_build_object('state', 'ambiguous', 'candidates', e->'cands', 'alsoOn', '[]'::jsonb);
  ELSE
    RETURN jsonb_build_object('state', 'waiting', 'candidates', '[]'::jsonb, 'alsoOn', '[]'::jsonb);
  END IF;

  SELECT k INTO card FROM jsonb_array_elements(v_keys) k WHERE k->>'t' = v_pick LIMIT 1;
  v_k1 := (v_by IN ('phone','phone_email') AND card->>'p1' = p_phone) OR (v_by IN ('email','phone_email') AND card->>'e1' = p_email);
  v_k2 := (v_by IN ('phone','phone_email') AND card->>'p2' = p_phone) OR (v_by IN ('email','phone_email') AND card->>'e2' = p_email);
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_also FROM unnest(v_pc || v_ec) x WHERE x <> v_pick;
  RETURN jsonb_build_object('state', 'tied', 'taskId', v_pick, 'matchedBy', v_by,
    'keySource', CASE WHEN v_k1 AND v_k2 THEN 'both' WHEN v_k1 THEN 'card_fields' ELSE 'onboarding_answer' END,
    'candidates', '[]'::jsonb, 'alsoOn', to_jsonb(v_also));
END $$;

-- Billing's card for every live deal (the second source), as {<token>: {t, by}}; NULL when billing cannot be read
-- (never treated as "no card").
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_billing()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  SELECT coalesce(jsonb_object_agg(a.deal_response_id, jsonb_build_object('t', a.clickup_task_id, 'by', a.matched_by)), '{}'::jsonb)
    INTO v FROM public.cockpit_billing_deal_assignments() a
   WHERE a.deal_response_id IS NOT NULL AND a.clickup_task_id IS NOT NULL;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

-- The one-tap "Yes" for a person: billing's card, else the one card with the sale's sales-call link. Never a name.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_suggest(p_token text, p_billing jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_card text := p_billing->p_token->>'t';
  v_link text;
BEGIN
  IF v_card IS NOT NULL AND EXISTS (SELECT 1 FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = v_card
                                      AND coalesce(a.client_name, '') !~* 'playing account|\[internal test\]') THEN
    RETURN jsonb_build_object('t', v_card, 'by', 'billing', 'method', p_billing->p_token->>'by');
  END IF;
  SELECT btrim(public.cockpit_sale_tie_answer(r.answers, '52ca9be9-8f56-4bb8-a130-dc1754e7d84d')) INTO v_link
    FROM public.cockpit_form_responses r WHERE r.form_key = 'new_client' AND r.external_id = p_token;
  IF v_link ~ '^https://\S+$' THEN
    SELECT min(o.clickup_task_id) INTO v_card
      FROM public.cockpit_client_onboarding o JOIN public.cockpit_billing_accounts a ON a.clickup_task_id = o.clickup_task_id
     WHERE btrim(o.links->>'sales_call') = v_link AND coalesce(a.client_name, '') !~* 'playing account|\[internal test\]'
    HAVING count(DISTINCT o.clickup_task_id) = 1;
    IF v_card IS NOT NULL THEN
      RETURN jsonb_build_object('t', v_card, 'by', 'sales_call');
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- One sale's decision by the system, written nowhere: {state, taskId, matchedBy, keySource, candidates, alsoOn,
-- suggestedTaskId, suggestedBy, billingTaskId, billingMatchedBy, phoneKey, emailKey}.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_evaluate(p_token text, p_phone text, p_email text, p_keys jsonb,
  p_billing jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_at timestamptz;
  m jsonb;
  s jsonb;
BEGIN
  SELECT r.submitted_at INTO v_at FROM public.cockpit_form_responses r WHERE r.form_key = 'new_client' AND r.external_id = p_token;
  IF v_at IS NULL THEN
    SELECT d.submitted_at INTO v_at FROM public.cockpit_sales_deals d WHERE d.response_id = p_token LIMIT 1;
  END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_sales_deals d WHERE d.response_id = p_token AND d.voided IS TRUE) THEN
    m := jsonb_build_object('state', 'void', 'candidates', '[]'::jsonb, 'alsoOn', '[]'::jsonb);
  ELSE
    m := public.cockpit_sale_tie_match(p_phone, p_email, v_at, p_keys);
    IF m->>'state' = 'waiting' AND (v_at IS NULL OR now() >= v_at + interval '48 hours') THEN
      m := m || jsonb_build_object('state', 'unmatched');
    END IF;
  END IF;
  IF m->>'state' IN ('ambiguous','conflict','unmatched','waiting') THEN
    s := public.cockpit_sale_tie_suggest(p_token, coalesce(p_billing, '{}'::jsonb));
  END IF;
  RETURN m || jsonb_build_object(
    'suggestedTaskId', s->>'t', 'suggestedBy', s->>'by',
    'billingTaskId', p_billing->p_token->>'t', 'billingMatchedBy', p_billing->p_token->>'by',
    'phoneKey', p_phone, 'emailKey', p_email);
END $$;

-- The client's name on the billing sheet, for the mirror and the screens.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_card_name(p_task text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT a.client_name FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = p_task),
                  (SELECT o.client_name FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task))
$$;

-- Writes one decision: clears the live row (once), inserts the next, and mirrors the live tie on the stored sale.
-- p_row is cockpit_sale_tie_evaluate's shape (plus note for a person). Answers the new row's id.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_write(p_token text, p_row jsonb, p_by text, p_action text,
  p_reason text, p_person text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old public.cockpit_sale_ties;
  r public.cockpit_form_responses;
  v_id bigint;
  v_state text := p_row->>'state';
  v_task text := CASE WHEN p_row->>'state' = 'tied' THEN p_row->>'taskId' END;
  v_meta jsonb;
  v_prev_action text := current_setting('cockpit.forms_action', true);
  v_prev_legacy text := current_setting('cockpit.forms_legacy', true);
BEGIN
  SELECT * INTO old FROM public.cockpit_sale_ties x WHERE x.response_id = p_token AND x.cleared_at IS NULL FOR UPDATE;
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.form_key = 'new_client' AND x.external_id = p_token;
  IF old.id IS NOT NULL THEN
    UPDATE public.cockpit_sale_ties x SET cleared_by = p_by, cleared_at = now(),
           cleared_reason = coalesce(nullif(btrim(p_reason), ''), 'Decided again.')
     WHERE x.id = old.id;
  END IF;
  PERFORM set_config('cockpit.forms_action', p_action, true);
  INSERT INTO public.cockpit_sale_ties(response_id, form_response_id, state, clickup_task_id, matched_by, key_source,
    candidates, also_on, suggested_task_id, suggested_by, billing_task_id, billing_matched_by, phone_key, email_key,
    note, set_by)
  VALUES (p_token, r.id, v_state, v_task, CASE WHEN v_state = 'tied' THEN p_row->>'matchedBy' END,
          CASE WHEN v_state = 'tied' AND p_row->>'matchedBy' <> 'person' THEN p_row->>'keySource' END,
          coalesce((SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(
                      CASE WHEN jsonb_typeof(p_row->'candidates') = 'array' THEN p_row->'candidates' ELSE '[]'::jsonb END) x), '{}'),
          coalesce((SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(
                      CASE WHEN jsonb_typeof(p_row->'alsoOn') = 'array' THEN p_row->'alsoOn' ELSE '[]'::jsonb END) x), '{}'),
          p_row->>'suggestedTaskId', p_row->>'suggestedBy', p_row->>'billingTaskId', left(p_row->>'billingMatchedBy', 40),
          coalesce(p_row->>'phoneKey', old.phone_key), coalesce(p_row->>'emailKey', old.email_key),
          nullif(btrim(p_row->>'note'), ''), p_by)
  RETURNING id INTO v_id;

  -- The mirror: the stored sale sits on its live tie's card, or on none.
  IF r.id IS NOT NULL AND r.state = 'submitted' THEN
    v_meta := r.answer_meta - 'match' - 'matched';
    IF v_task IS NOT NULL THEN
      v_meta := v_meta || jsonb_build_object(
        'match', CASE WHEN p_row->>'matchedBy' = 'person' THEN 'confirmed_by_person' ELSE p_row->>'matchedBy' END,
        'matched', jsonb_strip_nulls(jsonb_build_object(
          'by', coalesce(p_person, 'the cockpit'), 'at', now(), 'via', 'sale_tie', 'taskId', v_task,
          'from', CASE WHEN r.task_id IS DISTINCT FROM v_task THEN r.task_id END)));
    END IF;
    IF r.task_id IS DISTINCT FROM v_task OR (r.answer_meta - 'match' - 'matched') IS DISTINCT FROM v_meta - 'match' - 'matched'
       OR (r.answer_meta->>'match') IS DISTINCT FROM (v_meta->>'match')
       OR (r.answer_meta->'matched'->>'taskId') IS DISTINCT FROM (v_meta->'matched'->>'taskId') THEN
      PERFORM set_config('cockpit.forms_legacy', 'sale_tie', true);
      PERFORM set_config('cockpit.forms_action', 'forms.sale_tie_mirrored', true);
      UPDATE public.cockpit_form_responses x
         SET task_id = v_task, client_name = CASE WHEN v_task IS NOT NULL THEN public.cockpit_sale_tie_card_name(v_task) END,
             answer_meta = v_meta
       WHERE x.id = r.id;
      PERFORM set_config('cockpit.forms_legacy', coalesce(v_prev_legacy, ''), true);
    END IF;
  END IF;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
  RETURN v_id;
END $$;

-- A system decision against the live row: a person's decision, a settled system state outside p_recheck, or a tie
-- whose card notes are planned (a sale_facts effect exists) is never changed; the same state, card and candidates
-- write nothing. Answers 'written', 'same' or 'kept'.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_apply(p_token text, p_row jsonb, p_by text, p_recheck text[])
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old public.cockpit_sale_ties;
BEGIN
  SELECT * INTO old FROM public.cockpit_sale_ties x WHERE x.response_id = p_token AND x.cleared_at IS NULL;
  IF old.id IS NOT NULL THEN
    IF old.set_by NOT LIKE 'system:%' OR NOT (old.state = ANY(p_recheck)) THEN
      RETURN 'kept';
    END IF;
    IF old.state = 'tied' AND EXISTS (
         SELECT 1 FROM public.cockpit_form_effects e
           JOIN public.cockpit_form_responses r ON r.id = e.response_id
          WHERE r.form_key = 'new_client' AND r.external_id = p_token AND e.effect_key = 'sale_facts') THEN
      RETURN 'kept';
    END IF;
    IF old.state = p_row->>'state' AND old.clickup_task_id IS NOT DISTINCT FROM (p_row->>'taskId')
       AND old.candidates = coalesce((SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(
                                        CASE WHEN jsonb_typeof(p_row->'candidates') = 'array' THEN p_row->'candidates'
                                             ELSE '[]'::jsonb END) x), '{}') THEN
      RETURN 'same';
    END IF;
  END IF;
  PERFORM public.cockpit_sale_tie_write(p_token, p_row, p_by,
    CASE WHEN p_row->>'state' = 'tied' THEN 'forms.sale_tied' ELSE 'forms.sale_tie_state' END,
    'Checked again: ' || (p_row->>'state') || '.');
  RETURN 'written';
END $$;

-- ---------------------------------------------------------------------------
-- 4. The card fields (2.8): one sale_facts effect and its queue row for the newest live tie on a card on the books.

-- Whether the live forms gate carries build B2's (new_client, sale_facts) branch (20261103c). Today's gate (20261102j)
-- has none: the claim's first pass settles every open sale_facts row skipped "Make owns this again." in any mode, so
-- nothing is planned until the branch is there.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_gate_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT p.prosrc LIKE '%''sale_facts''%' FROM pg_catalog.pg_proc p
                    WHERE p.oid = to_regprocedure('public.cockpit_form_effect_gate(text,text)')), false)
$$;

-- Takes back the sale's card notes write (p_response; NULL is every sale) before it starts: each queue row of a
-- queued sale_facts effect that is queued or retry with no step started or done ends skipped with p_reason, and the
-- live settle trigger (cockpit_form_effects_from_queue) moves its effect to skipped, so the gate answers "settled in
-- the cockpit" and nothing is written. A row sending, unknown, or with a step started or done, and any unknown
-- effect, is left to finish and counted in inFlight. Every queue and effect change is audited by those tables' own
-- triggers. Answers {takenBack, inFlight}.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_take_back(p_response uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  q record;
  v_back integer := 0;
  v_busy integer := 0;
BEGIN
  FOR q IN
    SELECT x.id, x.state, x.progress, e.state AS effect_state
      FROM public.cockpit_form_effects e
      JOIN public.cockpit_clickup_writeback_queue x ON x.id::text = e.delivery_ref
     WHERE e.form_key = 'new_client' AND e.effect_key = 'sale_facts' AND e.delivery = 'clickup_queue'
       AND e.state IN ('queued','unknown') AND (p_response IS NULL OR e.response_id = p_response)
       AND x.state IN ('queued','retry','sending','unknown')
     ORDER BY x.created_at, x.id
     FOR UPDATE OF x
  LOOP
    IF q.effect_state = 'queued' AND q.state IN ('queued','retry')
       AND NOT pg_catalog.jsonb_path_exists(coalesce(q.progress, '{}'::jsonb),
                                            '$.steps.* ? (@.state == "started" || @.state == "done")') THEN
      UPDATE public.cockpit_clickup_writeback_queue x
         SET state = 'skipped', error = left(p_reason, 500), claim_token = NULL, claimed_at = NULL, updated_at = now()
       WHERE x.id = q.id;
      v_back := v_back + 1;
    ELSE
      v_busy := v_busy + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('takenBack', v_back, 'inFlight', v_busy);
END $$;

-- forms.sale_tie losing on or fill (or the setting going) takes back every card notes write that has not started.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_switch_off()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NOT (coalesce(NEW.value->>'on', '') = 'true' AND coalesce(NEW.value->>'fill', '') = 'true') THEN
    PERFORM public.cockpit_sale_tie_take_back(NULL, 'Card writes for sales were turned off, so nothing was written.');
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS cockpit_sale_tie_switch_off ON public.cockpit_settings;
CREATE TRIGGER cockpit_sale_tie_switch_off AFTER UPDATE OR DELETE ON public.cockpit_settings
  FOR EACH ROW WHEN (OLD.key = 'forms.sale_tie') EXECUTE FUNCTION public.cockpit_sale_tie_switch_off();

CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_plan_facts(p_tie_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.cockpit_sale_ties;
  r public.cockpit_form_responses;
  e public.cockpit_form_effects;
  fl jsonb := public.cockpit_sale_tie_flags();
  v_skip text;
  v_fields jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_go text;
  v_hand text;
  v_link text;
  v_payload jsonb;
  v_ref text;
  v_prev_action text := current_setting('cockpit.forms_action', true);
BEGIN
  SELECT * INTO t FROM public.cockpit_sale_ties x WHERE x.id = p_tie_id;
  IF t.id IS NULL OR t.cleared_at IS NOT NULL OR t.state <> 'tied' THEN
    RETURN jsonb_build_object('planned', false, 'reason', 'This sale is not on a card.');
  END IF;
  IF NOT (fl->>'on')::boolean OR NOT (fl->>'fill')::boolean THEN
    RETURN jsonb_build_object('planned', false, 'reason', 'Card writes for sales are off.');
  END IF;
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.form_key = 'new_client' AND x.external_id = t.response_id;
  IF r.id IS NULL OR r.state <> 'submitted' OR r.mode <> 'live' THEN
    RETURN jsonb_build_object('planned', false, 'reason', 'The cockpit does not store this sale, so it has nothing to write.');
  END IF;
  SELECT * INTO e FROM public.cockpit_form_effects x WHERE x.response_id = r.id AND x.effect_key = 'sale_facts';
  IF e.id IS NOT NULL THEN
    RETURN jsonb_build_object('planned', false, 'effectId', e.id, 'state', e.state, 'reason', e.reason);
  END IF;
  -- Nothing is spent before the gate passes the row, nor before billing-sync lists the card (both wait for a sweep).
  IF NOT public.cockpit_sale_tie_gate_ready() THEN
    RETURN jsonb_build_object('planned', false,
      'reason', 'Card notes wait for the forms gate that passes them (20261103c), so none were planned.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = t.clickup_task_id) THEN
    RETURN jsonb_build_object('planned', false,
      'reason', 'This card is not on the billing sheet yet, so its notes wait for the next sync after billing lists it.');
  END IF;

  IF NOT public.cockpit_billing_card_listed(t.clickup_task_id, true) THEN
    v_skip := 'The client has left: no card fields to fill.';
  ELSIF EXISTS (SELECT 1 FROM public.cockpit_sale_ties o
                  JOIN public.cockpit_form_responses ro ON ro.form_key = 'new_client' AND ro.external_id = o.response_id
                 WHERE o.cleared_at IS NULL AND o.state = 'tied' AND o.clickup_task_id = t.clickup_task_id AND o.id <> t.id
                   AND (ro.submitted_at > r.submitted_at OR (ro.submitted_at = r.submitted_at AND o.response_id > t.response_id))) THEN
    v_skip := 'A newer sale on this card fills its fields.';
  END IF;

  v_go := public.cockpit_form_typeform_text(public.cockpit_sale_tie_answer(r.answers, 'e30bc458-1bf3-4840-a849-f2443843ed8a'));
  v_hand := public.cockpit_form_typeform_text(public.cockpit_sale_tie_answer(r.answers, '3cf4bfdf-f42a-447c-a109-a0d24468c5cd'));
  v_link := btrim(public.cockpit_sale_tie_answer(r.answers, '52ca9be9-8f56-4bb8-a130-dc1754e7d84d'));
  IF coalesce(v_go, '') <> '' THEN
    v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', 'd4483463-840f-4730-ae7f-bfa77c5bb22a',
      'kind', 'text', 'label', 'Go-live expectation', 'value', v_go, 'onlyIfEmpty', true, 'source', 'new_client: e30bc458'));
    v_lines := v_lines || to_jsonb('Go-live expectation from the sale, only if the card leaves it empty'::text);
  END IF;
  IF coalesce(v_hand, '') <> '' THEN
    v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', 'e17a1c27-ec34-4f87-8796-3cf1f8fa80f9',
      'kind', 'text', 'label', 'Handoff problems', 'value', v_hand, 'onlyIfEmpty', true, 'source', 'new_client: 3cf4bfdf'));
    v_lines := v_lines || to_jsonb('Handoff problems from the sale, only if the card leaves it empty'::text);
  END IF;
  IF (fl->>'salesLink')::boolean AND v_link ~ '^https://\S+$' THEN
    v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', '1f2e9ad1-98d8-410d-9994-ac6da91ff91d',
      'kind', 'url', 'label', 'Sales Meeting Link', 'value', v_link, 'onlyIfEmpty', true, 'source', 'new_client: 52ca9be9'));
    v_lines := v_lines || to_jsonb('Sales Meeting Link from the sale, only if the card leaves it empty'::text);
  END IF;
  IF v_skip IS NULL AND jsonb_array_length(v_fields) = 0 THEN
    v_skip := 'The sale left go-live and handoff problems empty, so there is nothing to write.';
  END IF;

  PERFORM set_config('cockpit.forms_action', 'forms.sale_facts_planned', true);
  INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, plan, state, reason)
  VALUES (r.id, 'new_client', 'sale_facts', r.id::text || ':sale_facts', 'cockpit', 'clickup_queue',
          CASE WHEN v_skip IS NULL THEN jsonb_build_object('taskId', t.clickup_task_id, 'tieId', t.id, 'fields', v_fields,
                                                           'lines', v_lines)
               ELSE jsonb_build_object('taskId', t.clickup_task_id, 'tieId', t.id) END,
          CASE WHEN v_skip IS NULL THEN 'planned' ELSE 'skipped' END, v_skip)
  ON CONFLICT (response_id, effect_key) DO NOTHING
  RETURNING * INTO e;
  IF e.id IS NULL OR v_skip IS NOT NULL THEN
    PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
    SELECT * INTO e FROM public.cockpit_form_effects x WHERE x.response_id = r.id AND x.effect_key = 'sale_facts';
    RETURN jsonb_build_object('planned', false, 'effectId', e.id, 'state', e.state, 'reason', e.reason);
  END IF;

  -- The queue row, exactly as build B1's writer reads it: no text in the payload (the queue audit copies payloads).
  v_payload := jsonb_build_object('formKey', 'new_client', 'effectKey', 'sale_facts', 'effectId', e.id,
                                  'responseId', r.id, 'taskId', t.clickup_task_id);
  PERFORM set_config('cockpit.forms_action', 'forms.effect_dispatched', true);
  INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, task_id, payload)
  VALUES (e.dedupe_key, 'form', 'cockpit_form_effects', e.id::text, t.clickup_task_id, v_payload)
  ON CONFLICT (dedupe_key) DO NOTHING;
  SELECT q.id::text INTO v_ref FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key = e.dedupe_key;
  UPDATE public.cockpit_form_effects x
     SET state = 'queued', delivery_ref = v_ref, receipt = jsonb_build_object('queueId', v_ref), reason = NULL
   WHERE x.id = e.id;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
  RETURN jsonb_build_object('planned', true, 'effectId', e.id, 'queueId', v_ref, 'fields', jsonb_array_length(v_fields));
END $$;

-- Every live tie with no sale_facts effect yet, newest sale first, while fill is on. Answers how many were queued.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_plan_pending()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t record;
  v_n integer := 0;
  fl jsonb := public.cockpit_sale_tie_flags();
BEGIN
  IF NOT (fl->>'on')::boolean OR NOT (fl->>'fill')::boolean OR NOT public.cockpit_sale_tie_gate_ready() THEN
    RETURN 0;
  END IF;
  FOR t IN
    SELECT x.id FROM public.cockpit_sale_ties x
      JOIN public.cockpit_form_responses r ON r.form_key = 'new_client' AND r.external_id = x.response_id
     WHERE x.cleared_at IS NULL AND x.state = 'tied'
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_form_effects e WHERE e.response_id = r.id AND e.effect_key = 'sale_facts')
     ORDER BY r.submitted_at DESC, x.response_id DESC
  LOOP
    IF coalesce((public.cockpit_sale_tie_plan_facts(t.id)->>'planned')::boolean, false) THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END $$;

-- K1 for a page of cards, as digests and creation times; only what changed is written, with one audit row (counts).
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_store_cards(p_cards jsonb, p_pepper text, p_by text, p_run bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n integer := 0;
BEGIN
  INSERT INTO public.cockpit_sale_tie_cards AS s0 (clickup_task_id, phone_key, email_key, created_at, seen_at, seen_by)
  SELECT DISTINCT ON (c->>'taskId') c->>'taskId',
         public.cockpit_sale_tie_digest('phone', public.cockpit_sale_tie_norm('phone', c->>'phone'), p_pepper),
         public.cockpit_sale_tie_digest('email', public.cockpit_sale_tie_norm('email', c->>'email'), p_pepper),
         public.cockpit_sale_tie_ts(c->>'createdAt'), now(), p_by
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_cards) = 'array' THEN p_cards ELSE '[]'::jsonb END) c
   WHERE jsonb_typeof(c) = 'object' AND coalesce(c->>'taskId', '') ~ '^[A-Za-z0-9_-]{1,40}$'
   ORDER BY c->>'taskId'
  ON CONFLICT (clickup_task_id) DO UPDATE
     SET phone_key = excluded.phone_key, email_key = excluded.email_key,
         created_at = coalesce(excluded.created_at, s0.created_at), seen_at = now(), seen_by = excluded.seen_by
   WHERE s0.phone_key IS DISTINCT FROM excluded.phone_key OR s0.email_key IS DISTINCT FROM excluded.email_key
      OR (excluded.created_at IS NOT NULL AND s0.created_at IS DISTINCT FROM excluded.created_at);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before,
      after, metadata)
    VALUES ('forms.sale_tie_cards_seen', 'cockpit_sale_tie_cards', NULL, p_by, 'client-success',
            coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'), NULL, NULL,
            jsonb_build_object('cards', jsonb_array_length(CASE WHEN jsonb_typeof(p_cards) = 'array' THEN p_cards ELSE '[]'::jsonb END),
                               'changed', v_n, 'run', p_run));
  END IF;
  RETURN v_n;
END $$;

-- ---------------------------------------------------------------------------
-- 5. The service paths (service role only)

-- forms-door, after cockpit_form_record_make stored a sale: {externalId, submittedAt, tieKeys: {phone, email}}, the
-- delivery's own typed phone (95a3901f) and email (a6ea04df). Opens the sale's row once (a repeat delivery changes
-- nothing): waiting while forms.sale_tie.on is off, else the match rule at once. The two values are digested here and
-- go nowhere else. Answers {ok, state, tieId, repeat}.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_open(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_token text := p->>'externalId';
  v_keys jsonb := CASE WHEN jsonb_typeof(p->'tieKeys') = 'object' THEN p->'tieKeys' ELSE '{}'::jsonb END;
  old public.cockpit_sale_ties;
  fl jsonb := public.cockpit_sale_tie_flags();
  v_pepper text;
  v_phone text;
  v_email text;
  v_row jsonb;
  v_id bigint;
  v_planned jsonb;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR v_token IS NULL OR v_token !~ '^[A-Za-z0-9]{8,64}$' THEN
    RAISE EXCEPTION 'That is not a Typeform response token.' USING ERRCODE = '22023';
  END IF;
  IF (v_keys ? 'phone' AND jsonb_typeof(v_keys->'phone') NOT IN ('string','null'))
     OR (v_keys ? 'email' AND jsonb_typeof(v_keys->'email') NOT IN ('string','null')) THEN
    RAISE EXCEPTION 'Send tieKeys as {phone, email}, each text or null.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_sale_ties', 0));
  PERFORM set_config('cockpit.audit_source', 'forms-door', true);
  SELECT * INTO old FROM public.cockpit_sale_ties x WHERE x.response_id = v_token AND x.cleared_at IS NULL;
  IF old.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'state', old.state, 'tieId', old.id, 'repeat', true);
  END IF;
  v_pepper := public.cockpit_sale_tie_pepper();
  v_phone := public.cockpit_sale_tie_digest('phone', public.cockpit_sale_tie_norm('phone', v_keys->>'phone'), v_pepper);
  v_email := public.cockpit_sale_tie_digest('email', public.cockpit_sale_tie_norm('email', v_keys->>'email'), v_pepper);
  IF (fl->>'on')::boolean THEN
    v_row := public.cockpit_sale_tie_evaluate(v_token, v_phone, v_email, public.cockpit_sale_tie_card_keys('[]'::jsonb, v_pepper),
                                              public.cockpit_sale_tie_billing());
  ELSE
    v_row := jsonb_build_object('state', 'waiting', 'phoneKey', v_phone, 'emailKey', v_email);
  END IF;
  v_id := public.cockpit_sale_tie_write(v_token, v_row, 'system:forms-door',
            CASE WHEN v_row->>'state' = 'tied' THEN 'forms.sale_tied' ELSE 'forms.sale_tie_opened' END, NULL);
  IF v_row->>'state' = 'tied' THEN
    v_planned := public.cockpit_sale_tie_plan_facts(v_id);
  END IF;
  UPDATE public.cockpit_sync_state s
     SET detail = coalesce(s.detail, '{}'::jsonb) || jsonb_build_object('tie', 'ok', 'tieAt', now()), updated_at = now()
   WHERE s.key = 'forms-door:new_client';
  RETURN jsonb_build_object('ok', true, 'state', v_row->>'state', 'tieId', v_id, 'repeat', false);
END $$;

-- forms-door, when cockpit_sale_tie_open failed: detail.tie on forms-door:new_client, for the guardian. The sale is
-- stored; the next sweep opens its row from what the cockpit stores.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_door_failed()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_hours_require_service();
  UPDATE public.cockpit_sync_state s
     SET detail = coalesce(s.detail, '{}'::jsonb) || jsonb_build_object('tie', 'failed', 'tieAt', now()), updated_at = now()
   WHERE s.key = 'forms-door:new_client';
  RETURN jsonb_build_object('ok', true);
END $$;

-- The onboarding sync's first call each run: how many sales wait for their card and since when (the oldest waiting
-- sale's signing time). The sync offers cards made since a day before that, and only while on.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_waiting()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_n integer;
  v_since timestamptz;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  SELECT count(*)::int, min(coalesce(r.submitted_at, t.set_at)) INTO v_n, v_since
    FROM public.cockpit_sale_ties t
    LEFT JOIN public.cockpit_form_responses r ON r.form_key = 'new_client' AND r.external_id = t.response_id
   WHERE t.cleared_at IS NULL AND t.state = 'waiting';
  RETURN jsonb_build_object('on', (public.cockpit_sale_tie_flags()->>'on')::boolean, 'waiting', v_n, 'since', v_since);
END $$;

-- The onboarding sync, per card page while sales wait: [{taskId, createdAt, phone, email}] (K1 fresh from ClickUp,
-- at most 200). Stores the digests and creation times, checks every waiting and unmatched system row again, and
-- answers counts only.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_offer(p_run bigint, p_cards jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  fl jsonb := public.cockpit_sale_tie_flags();
  v_pepper text;
  v_keys jsonb;
  v_billing jsonb;
  v_stored integer := 0;
  v_tied integer := 0;
  v_out text;
  v_row jsonb;
  t record;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF jsonb_typeof(p_cards) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cards) > 200 THEN
    RAISE EXCEPTION 'Send at most 200 cards as a list.' USING ERRCODE = '22023';
  END IF;
  IF NOT (fl->>'on')::boolean THEN
    RETURN jsonb_build_object('on', false, 'offered', jsonb_array_length(p_cards), 'stored', 0, 'tied', 0,
      'waiting', (SELECT count(*) FROM public.cockpit_sale_ties x WHERE x.cleared_at IS NULL AND x.state = 'waiting'));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_sale_ties', 0));
  PERFORM set_config('cockpit.audit_source', 'onboarding-sync', true);
  v_pepper := public.cockpit_sale_tie_pepper();
  v_stored := public.cockpit_sale_tie_store_cards(p_cards, v_pepper, 'system:onboarding-sync', p_run);
  FOR t IN SELECT x.response_id, x.phone_key, x.email_key FROM public.cockpit_sale_ties x
            WHERE x.cleared_at IS NULL AND x.state IN ('waiting','unmatched') AND x.set_by LIKE 'system:%'
            ORDER BY x.id LOOP
    IF v_keys IS NULL THEN
      v_keys := public.cockpit_sale_tie_card_keys('[]'::jsonb, v_pepper);
      v_billing := public.cockpit_sale_tie_billing();
    END IF;
    v_row := public.cockpit_sale_tie_evaluate(t.response_id, t.phone_key, t.email_key, v_keys, v_billing);
    v_out := public.cockpit_sale_tie_apply(t.response_id, v_row, 'system:onboarding-sync', ARRAY['waiting','unmatched']);
    IF v_out = 'written' AND v_row->>'state' = 'tied' THEN
      v_tied := v_tied + 1;
    END IF;
  END LOOP;
  IF v_tied > 0 THEN
    PERFORM public.cockpit_sale_tie_plan_pending();
  END IF;
  RETURN jsonb_build_object('on', true, 'offered', jsonb_array_length(p_cards), 'stored', v_stored, 'tied', v_tied,
    'waiting', (SELECT count(*) FROM public.cockpit_sale_ties x WHERE x.cleared_at IS NULL AND x.state = 'waiting'));
END $$;

-- The onboarding sync, at the end of each run while on: a row for every stored sale that has none (the door did not
-- open one: its keys from what the cockpit stores), every waiting and unmatched system row checked again against the
-- stored card keys and the onboarding answers (a waiting row over 2 days old becomes unmatched), every tie planned
-- for the card while fill is on, and the sale-ties health row. Answers counts only.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_sweep(p_run bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  fl jsonb := public.cockpit_sale_tie_flags();
  v_pepper text;
  v_keys jsonb;
  v_billing jsonb;
  v_stored jsonb;
  v_row jsonb;
  v_out text;
  v_opened integer := 0;
  v_tied integer := 0;
  v_planned integer := 0;
  v_waiting integer;
  v_unmatched integer;
  v_person integer;
  s record;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF NOT (fl->>'on')::boolean THEN
    RETURN jsonb_build_object('on', false);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_sale_ties', 0));
  PERFORM set_config('cockpit.audit_source', 'onboarding-sync', true);
  v_pepper := public.cockpit_sale_tie_pepper();
  FOR s IN
    SELECT r.external_id AS token, t.id AS tie, t.phone_key, t.email_key
      FROM public.cockpit_form_responses r
      LEFT JOIN public.cockpit_sale_ties t ON t.response_id = r.external_id AND t.cleared_at IS NULL
     WHERE r.form_key = 'new_client' AND r.state = 'submitted' AND r.mode = 'live' AND r.external_id ~ '^[A-Za-z0-9]{8,64}$'
       AND (t.id IS NULL OR (t.state IN ('waiting','unmatched') AND t.set_by LIKE 'system:%'))
     ORDER BY r.submitted_at, r.external_id
  LOOP
    IF v_keys IS NULL THEN
      v_keys := public.cockpit_sale_tie_card_keys('[]'::jsonb, v_pepper);
      v_billing := public.cockpit_sale_tie_billing();
    END IF;
    v_stored := public.cockpit_sale_tie_stored_keys(s.token, v_pepper);
    v_row := public.cockpit_sale_tie_evaluate(s.token, coalesce(s.phone_key, v_stored->>'phone'),
                                              coalesce(s.email_key, v_stored->>'email'), v_keys, v_billing);
    v_out := public.cockpit_sale_tie_apply(s.token, v_row, 'system:onboarding-sync', ARRAY['waiting','unmatched']);
    IF v_out = 'written' AND s.tie IS NULL THEN
      v_opened := v_opened + 1;
    END IF;
    IF v_out = 'written' AND v_row->>'state' = 'tied' THEN
      v_tied := v_tied + 1;
    END IF;
  END LOOP;
  v_planned := public.cockpit_sale_tie_plan_pending();
  SELECT count(*) FILTER (WHERE x.state = 'waiting'), count(*) FILTER (WHERE x.state = 'unmatched'),
         count(*) FILTER (WHERE x.state IN ('ambiguous','conflict','unmatched'))
    INTO v_waiting, v_unmatched, v_person
    FROM public.cockpit_sale_ties x WHERE x.cleared_at IS NULL;
  INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, rows_seen, updated_at, detail)
  VALUES ('sale-ties', now(), now(), true,
          'Sales checked against the cards: ' || v_tied || ' tied this run, ' || v_waiting || ' waiting for their card, '
            || v_person || ' waiting for a person.'
            || CASE WHEN (fl->>'fill')::boolean AND NOT public.cockpit_sale_tie_gate_ready()
                    THEN ' Card notes wait for the forms gate that passes them (20261103c), so none were planned.'
                    ELSE '' END,
          NULL, now(),
          jsonb_build_object('opened', v_opened, 'tied', v_tied, 'planned', v_planned, 'waiting', v_waiting,
                             'unmatched', v_unmatched, 'forPerson', v_person, 'run', p_run))
  ON CONFLICT (key) DO UPDATE
     SET last_run_at = excluded.last_run_at, last_ok_at = excluded.last_ok_at, ok = true, note = excluded.note,
         updated_at = excluded.updated_at, detail = excluded.detail;
  RETURN jsonb_build_object('on', true, 'opened', v_opened, 'tied', v_tied, 'planned', v_planned, 'waiting', v_waiting,
                            'unmatched', v_unmatched, 'forPerson', v_person);
END $$;

-- The onboarding sync's job {"job":"saleTies","dryRun":...}: every stored sale against every card's K1 (all of them,
-- read once) and every onboarding answer (K2). A dry run writes nothing and answers counts only; a real run needs
-- forms.sale_tie.on, stores the card keys, writes every changed system decision (a person's never) and plans the
-- card fields while fill is on. It checks again every system row but void and not_client, its own and the sync's
-- ties included (a sweep between `on` and the job ties from K2 alone, with no card creation times), except a tie
-- whose card notes are planned already (a sale_facts effect), which stays. The counts describe where every sale
-- stands after the run.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_backfill(p_cards jsonb, p_dry boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  fl jsonb := public.cockpit_sale_tie_flags();
  v_dry boolean := coalesce(p_dry, true);
  v_pepper text;
  v_keys jsonb;
  v_billing jsonb;
  v_stored jsonb;
  v_row jsonb;
  v_final jsonb;
  v_link text;
  v_link_card text;
  v_out text;
  v_written integer := 0;
  v_planned integer := 0;
  c jsonb := jsonb_build_object('sales', 0, 'tied', 0, 'phone', 0, 'email', 0, 'phoneEmail', 0, 'person', 0,
    'cardFields', 0, 'onboardingAnswer', 0, 'both', 0, 'waiting', 0, 'ambiguous', 0, 'conflict', 0, 'unmatched', 0,
    'void', 0, 'notClient', 0, 'billingAgree', 0, 'billingDisagree', 0, 'billingOnly', 0, 'salesCallAgree', 0,
    'salesCallDisagree', 0);
  v_ties jsonb := '[]'::jsonb;
  s record;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF jsonb_typeof(p_cards) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cards) > 2000 THEN
    RAISE EXCEPTION 'Send every card as one list of at most 2,000.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_dry AND NOT (fl->>'on')::boolean THEN
    RAISE EXCEPTION 'Sale ties are off. Read the dry run first, then turn forms.sale_tie.on on and run the job again.'
      USING ERRCODE = '22023';
  END IF;
  v_pepper := public.cockpit_sale_tie_pepper();
  IF NOT v_dry THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_sale_ties', 0));
    PERFORM set_config('cockpit.audit_source', 'onboarding-sync', true);
    PERFORM public.cockpit_sale_tie_store_cards(p_cards, v_pepper, 'system:backfill', NULL);
  END IF;
  v_keys := public.cockpit_sale_tie_card_keys(p_cards, v_pepper);
  v_billing := public.cockpit_sale_tie_billing();
  FOR s IN
    SELECT r.external_id AS token, r.answers, t.id AS tie, t.state, t.set_by, t.clickup_task_id, t.matched_by,
           t.key_source, t.phone_key, t.email_key,
           EXISTS (SELECT 1 FROM public.cockpit_form_effects e WHERE e.response_id = r.id AND e.effect_key = 'sale_facts') AS facts
      FROM public.cockpit_form_responses r
      LEFT JOIN public.cockpit_sale_ties t ON t.response_id = r.external_id AND t.cleared_at IS NULL
     WHERE r.form_key = 'new_client' AND r.state = 'submitted' AND r.mode = 'live' AND r.external_id ~ '^[A-Za-z0-9]{8,64}$'
     ORDER BY r.submitted_at, r.external_id
  LOOP
    c := jsonb_set(c, '{sales}', to_jsonb((c->>'sales')::int + 1));
    IF s.tie IS NOT NULL AND (s.set_by NOT LIKE 'system:%' OR s.state IN ('void','not_client') OR (s.state = 'tied' AND s.facts)) THEN
      v_final := jsonb_build_object('state', s.state, 'taskId', s.clickup_task_id, 'matchedBy', s.matched_by,
                                    'keySource', s.key_source);
    ELSE
      v_stored := public.cockpit_sale_tie_stored_keys(s.token, v_pepper);
      v_row := public.cockpit_sale_tie_evaluate(s.token, coalesce(s.phone_key, v_stored->>'phone'),
                                                coalesce(s.email_key, v_stored->>'email'), v_keys, v_billing);
      v_final := v_row;
      IF NOT v_dry THEN
        v_out := public.cockpit_sale_tie_apply(s.token, v_row, 'system:backfill',
                                               ARRAY['waiting','unmatched','ambiguous','conflict','tied']);
        IF v_out = 'written' THEN
          v_written := v_written + 1;
        END IF;
      END IF;
    END IF;
    c := jsonb_set(c, ARRAY[CASE v_final->>'state' WHEN 'not_client' THEN 'notClient' ELSE v_final->>'state' END],
                   to_jsonb(coalesce((c->>CASE v_final->>'state' WHEN 'not_client' THEN 'notClient' ELSE v_final->>'state' END)::int, 0) + 1));
    IF v_final->>'state' = 'tied' THEN
      c := jsonb_set(c, ARRAY[CASE v_final->>'matchedBy' WHEN 'phone_email' THEN 'phoneEmail' ELSE v_final->>'matchedBy' END],
                     to_jsonb((c->>CASE v_final->>'matchedBy' WHEN 'phone_email' THEN 'phoneEmail' ELSE v_final->>'matchedBy' END)::int + 1));
      IF v_final->>'keySource' IS NOT NULL THEN
        c := jsonb_set(c, ARRAY[CASE v_final->>'keySource' WHEN 'card_fields' THEN 'cardFields'
                                     WHEN 'onboarding_answer' THEN 'onboardingAnswer' ELSE 'both' END],
                       to_jsonb((c->>CASE v_final->>'keySource' WHEN 'card_fields' THEN 'cardFields'
                                       WHEN 'onboarding_answer' THEN 'onboardingAnswer' ELSE 'both' END)::int + 1));
      END IF;
      IF v_billing ? s.token AND v_billing->s.token->>'t' = v_final->>'taskId' THEN
        c := jsonb_set(c, '{billingAgree}', to_jsonb((c->>'billingAgree')::int + 1));
      ELSIF v_billing ? s.token THEN
        c := jsonb_set(c, '{billingDisagree}', to_jsonb((c->>'billingDisagree')::int + 1));
      END IF;
      v_link := btrim(public.cockpit_sale_tie_answer(s.answers, '52ca9be9-8f56-4bb8-a130-dc1754e7d84d'));
      v_link_card := NULL;
      IF v_link ~ '^https://\S+$' THEN
        SELECT min(o.clickup_task_id) INTO v_link_card FROM public.cockpit_client_onboarding o
         WHERE btrim(o.links->>'sales_call') = v_link HAVING count(DISTINCT o.clickup_task_id) = 1;
      END IF;
      IF v_link_card = v_final->>'taskId' THEN
        c := jsonb_set(c, '{salesCallAgree}', to_jsonb((c->>'salesCallAgree')::int + 1));
      ELSIF v_link_card IS NOT NULL THEN
        c := jsonb_set(c, '{salesCallDisagree}', to_jsonb((c->>'salesCallDisagree')::int + 1));
      END IF;
      v_ties := v_ties || jsonb_build_array(jsonb_build_object('t', v_final->>'taskId', 'token', s.token));
    ELSIF v_billing ? s.token THEN
      c := jsonb_set(c, '{billingOnly}', to_jsonb((c->>'billingOnly')::int + 1));
    END IF;
  END LOOP;
  IF NOT v_dry THEN
    v_planned := public.cockpit_sale_tie_plan_pending();
  END IF;
  -- Who would get the card fields: the newest tie on each card, by where the card stands.
  RETURN c || jsonb_build_object(
    'dryRun', v_dry, 'written', v_written, 'planned', v_planned,
    'billingRead', v_billing IS NOT NULL,
    'cards', jsonb_array_length(p_cards),
    'cardsWithPhone', (SELECT count(*) FROM jsonb_array_elements(p_cards) x
                        WHERE public.cockpit_sale_tie_norm('phone', x->>'phone') IS NOT NULL),
    'cardsWithEmail', (SELECT count(*) FROM jsonb_array_elements(p_cards) x
                        WHERE public.cockpit_sale_tie_norm('email', x->>'email') IS NOT NULL),
    'fillCards', (SELECT count(DISTINCT x->>'t') FROM jsonb_array_elements(v_ties) x),
    'fillOnBooks', (SELECT count(DISTINCT x->>'t') FROM jsonb_array_elements(v_ties) x
                     WHERE public.cockpit_billing_card_listed(x->>'t', true)),
    'fillInOnboarding', (SELECT count(DISTINCT x->>'t') FROM jsonb_array_elements(v_ties) x
                          JOIN public.cockpit_client_onboarding o ON o.clickup_task_id = x->>'t'
                         WHERE public.cockpit_billing_card_listed(x->>'t', true) AND o.in_onboarding IS TRUE),
    'fillGone', (SELECT count(DISTINCT x->>'t') FROM jsonb_array_elements(v_ties) x
                  JOIN public.cockpit_billing_accounts a ON a.clickup_task_id = x->>'t'
                  WHERE NOT public.cockpit_billing_card_listed(x->>'t', true)));
END $$;

-- ---------------------------------------------------------------------------
-- 6. People (authenticated; the gate is inside)

-- "Sales not on a card" (2.7): the open rows (ambiguous, conflict, unmatched, and waiting over 2 hours), and for the
-- CEO the ties billing puts on another card. The CEO sees every row; a CSM the rows whose candidate or suggested card
-- is one of their clients, with only those cards. Never a phone, an email or a digest. Answers {on, fill, salesLink,
-- rows, summary}; summary is counts only (the CEO's forms-health line).
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ceo boolean := coalesce(public.cockpit_is_ceo(), false);
  fl jsonb;
  v_pepper text;
  v_keys jsonb;
  v_billing jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_cards jsonb;
  v_sugg jsonb;
  v_item jsonb;
  v_card text;
  v_name text;
  v_reason text;
  v_sentence text;
  v_k jsonb;
  v_summary jsonb;
  t record;
BEGIN
  IF NOT v_ceo AND NOT coalesce(public.cockpit_has_role('csm'), false) THEN
    RAISE EXCEPTION 'Only a client success seat or the CEO sees the sales not on a card.' USING ERRCODE = '42501';
  END IF;
  fl := public.cockpit_sale_tie_flags();
  FOR t IN
    SELECT x.*, r.submitted_at, r.answers, r.hidden
      FROM public.cockpit_sale_ties x
      LEFT JOIN public.cockpit_form_responses r ON r.form_key = 'new_client' AND r.external_id = x.response_id
     WHERE x.cleared_at IS NULL
       AND (x.state IN ('ambiguous','conflict','unmatched')
            OR (x.state = 'waiting' AND coalesce(r.submitted_at, x.set_at) < now() - interval '2 hours')
            OR (v_ceo AND x.state = 'tied' AND x.billing_task_id IS NOT NULL AND x.billing_task_id <> x.clickup_task_id))
     ORDER BY coalesce(r.submitted_at, x.set_at) DESC, x.id
  LOOP
    IF v_keys IS NULL THEN
      v_pepper := public.cockpit_sale_tie_pepper();
      v_keys := public.cockpit_sale_tie_card_keys('[]'::jsonb, v_pepper);
      v_billing := coalesce(public.cockpit_sale_tie_billing(), '{}'::jsonb);
    END IF;
    v_cards := '[]'::jsonb;
    FOREACH v_card IN ARRAY t.candidates LOOP
      SELECT k INTO v_k FROM jsonb_array_elements(v_keys) k WHERE k->>'t' = v_card LIMIT 1;
      v_reason := CASE
        WHEN t.phone_key IS NOT NULL AND t.phone_key IN (v_k->>'p1', v_k->>'p2')
             AND t.email_key IS NOT NULL AND t.email_key IN (v_k->>'e1', v_k->>'e2') THEN 'Same phone and email as the card'
        WHEN t.phone_key IS NOT NULL AND t.phone_key IN (v_k->>'p1', v_k->>'p2') THEN 'Same phone as the card'
        WHEN t.email_key IS NOT NULL AND t.email_key IN (v_k->>'e1', v_k->>'e2') THEN 'Same email as the card'
        ELSE 'A card the sale''s phone or email pointed at' END;
      v_name := public.cockpit_sale_tie_card_name(v_card);
      IF v_ceo OR coalesce(public.cockpit_client_allowed(v_name), false) THEN
        v_cards := v_cards || jsonb_build_array(jsonb_build_object('taskId', v_card, 'clientName', v_name, 'reason', v_reason));
      END IF;
    END LOOP;
    v_sugg := NULL;
    IF t.state = 'tied' THEN
      v_item := v_billing->t.response_id;
      v_name := public.cockpit_sale_tie_card_name(t.billing_task_id);
      v_sugg := jsonb_build_object('taskId', t.billing_task_id, 'clientName', v_name,
        'reason', CASE t.billing_matched_by WHEN 'ledger' THEN 'Billing ties this sale to this card by its payments'
                                            WHEN 'link' THEN 'The CEO linked this sale to this card in billing'
                                            ELSE 'Billing ties this sale to this card by its name' END);
      v_sentence := 'Billing ties this sale to another card.';
    ELSE
      v_item := public.cockpit_sale_tie_suggest(t.response_id, v_billing);
      IF v_item IS NOT NULL THEN
        v_name := public.cockpit_sale_tie_card_name(v_item->>'t');
        IF v_ceo OR coalesce(public.cockpit_client_allowed(v_name), false) THEN
          v_sugg := jsonb_build_object('taskId', v_item->>'t', 'clientName', v_name, 'by', v_item->>'by',
            'reason', CASE WHEN v_item->>'by' = 'sales_call' THEN 'Same sales-call link as the card'
                           WHEN v_item->>'method' = 'ledger' THEN 'Billing ties this sale to this card by its payments'
                           WHEN v_item->>'method' = 'link' THEN 'The CEO linked this sale to this card in billing'
                           ELSE 'Billing ties this sale to this card by its name' END);
        END IF;
      END IF;
      v_sentence := CASE t.state
        WHEN 'waiting' THEN 'No card has this sale''s phone or email yet. The next sync looks again.'
        WHEN 'unmatched' THEN 'No card has this sale''s phone or email after 2 days. Check Make 10''s run, or pick the card.'
        WHEN 'ambiguous' THEN 'More than one card has this sale''s phone or email. Pick the right card.'
        ELSE 'The phone points to one card and the email to another. Pick the right card.' END;
    END IF;
    IF NOT v_ceo AND jsonb_array_length(v_cards) = 0 AND v_sugg IS NULL THEN
      CONTINUE;
    END IF;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'responseId', t.response_id,
      'state', t.state,
      'sentence', v_sentence,
      'businessName', left(nullif(btrim(public.cockpit_sale_tie_answer(t.answers, 'a1be4eee-8219-4228-8423-8cbf64919c5f')), ''), 200),
      'signedAt', t.submitted_at,
      'signedOn', to_char((t.submitted_at AT TIME ZONE 'Asia/Kuwait')::date, 'YYYY-MM-DD'),
      'closer', left(coalesce(nullif(btrim(public.cockpit_sale_tie_answer(t.answers, 'a86cbf90-2154-44d9-84e3-b4a20f8e96a2')), ''),
                              nullif(btrim(t.hidden->>'closer'), '')), 120),
      'tiedTo', CASE WHEN t.state = 'tied' THEN jsonb_build_object('taskId', t.clickup_task_id,
                       'clientName', public.cockpit_sale_tie_card_name(t.clickup_task_id), 'tiedBy', t.matched_by) END,
      'candidates', v_cards,
      'suggestion', v_sugg));
  END LOOP;
  SELECT jsonb_build_object(
      'sales', (SELECT count(*) FROM public.cockpit_form_responses r
                 WHERE r.form_key = 'new_client' AND r.mode = 'live' AND r.state IN ('submitted','confirmed')),
      'onCard', count(*) FILTER (WHERE x.state = 'tied'),
      'byPhone', count(*) FILTER (WHERE x.state = 'tied' AND x.matched_by = 'phone'),
      'byEmail', count(*) FILTER (WHERE x.state = 'tied' AND x.matched_by = 'email'),
      'byPhoneAndEmail', count(*) FILTER (WHERE x.state = 'tied' AND x.matched_by = 'phone_email'),
      'byPerson', count(*) FILTER (WHERE x.state = 'tied' AND x.matched_by = 'person'),
      'forPerson', count(*) FILTER (WHERE x.state IN ('ambiguous','conflict','unmatched')),
      'waiting', count(*) FILTER (WHERE x.state = 'waiting'),
      'void', count(*) FILTER (WHERE x.state = 'void'),
      'notClient', count(*) FILTER (WHERE x.state = 'not_client'),
      'rows', count(*))
    INTO v_summary
    FROM public.cockpit_sale_ties x WHERE x.cleared_at IS NULL;
  RETURN jsonb_build_object('on', (fl->>'on')::boolean, 'fill', (fl->>'fill')::boolean,
                            'salesLink', (fl->>'salesLink')::boolean, 'rows', v_rows, 'summary', v_summary);
END $$;

-- A person's decision on one sale (2.7): yes (the suggestion, or the one candidate), pick (another card on the
-- billing sheet), not_client (a test or duplicate sale, with a reason), clear (take a tie off, with a reason). The CEO
-- decides any sale; a CSM only for cards of their own clients, and never moves or clears a tie whose go-live and
-- handoff notes are already on its card. The CEO's move, clear or not_client of a tie whose card write has not started
-- takes that write back (cockpit_sale_tie_take_back: nothing reaches the card just rejected), and is refused while the
-- write is in flight (sending, unknown or a step started). Writes the next row, the mirror and an audit row; plans the
-- card fields while fill is on. Answers {ok, responseId, state, taskId, clientName, movedFrom?, facts, handFill?}:
-- handFill {taskId, sentence} names the new card when the sale's one notes write was planned for another tie first.
CREATE OR REPLACE FUNCTION public.cockpit_sale_tie_decide(p_response_id text, p_choice text, p_task text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ceo boolean := coalesce(public.cockpit_is_ceo(), false);
  g jsonb;
  fl jsonb := public.cockpit_sale_tie_flags();
  r public.cockpit_form_responses;
  old public.cockpit_sale_ties;
  a public.cockpit_billing_accounts;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_target text;
  v_sugg jsonb;
  v_old_name text;
  v_facts text;
  v_row jsonb;
  v_id bigint;
  v_who text;
  v_plan jsonb;
  v_back jsonb;
  v_hand jsonb;
BEGIN
  g := public.cockpit_form_actor();
  IF NOT v_ceo AND NOT coalesce(public.cockpit_has_role('csm'), false) THEN
    RAISE EXCEPTION 'Only a client success seat or the CEO ties a sale to a card.' USING ERRCODE = '42501';
  END IF;
  IF NOT (fl->>'on')::boolean THEN
    RAISE EXCEPTION 'Sale ties are off. They open once the CEO turns them on.' USING ERRCODE = '22023';
  END IF;
  IF p_choice IS NULL OR p_choice NOT IN ('yes','pick','not_client','clear') THEN
    RAISE EXCEPTION 'Choose yes, pick, not_client or clear.' USING ERRCODE = '22023';
  END IF;
  IF p_response_id IS NULL OR p_response_id !~ '^[A-Za-z0-9]{8,64}$' THEN
    RAISE EXCEPTION 'That is not a sale''s ID.' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Keep the note between 3 and 500 characters.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_sale_ties', 0));
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.form_key = 'new_client' AND x.external_id = p_response_id;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'The cockpit does not store a sale with that ID.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO old FROM public.cockpit_sale_ties x WHERE x.response_id = p_response_id AND x.cleared_at IS NULL FOR UPDATE;
  v_who := CASE WHEN v_ceo THEN 'the CEO' ELSE 'the CSM' END;

  -- The card a yes or a pick goes to, and who may see it.
  IF p_choice = 'yes' THEN
    v_sugg := public.cockpit_sale_tie_suggest(p_response_id, coalesce(public.cockpit_sale_tie_billing(), '{}'::jsonb));
    v_target := coalesce(v_sugg->>'t', CASE WHEN cardinality(old.candidates) = 1 THEN old.candidates[1] END);
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'This sale has no suggested card. Pick one from the list.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_choice = 'pick' THEN
    IF p_task IS NULL OR p_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN
      RAISE EXCEPTION 'Pick a card from the list.' USING ERRCODE = '22023';
    END IF;
    v_target := p_task;
  END IF;
  IF v_target IS NOT NULL THEN
    SELECT * INTO a FROM public.cockpit_billing_accounts x WHERE x.clickup_task_id = v_target;
    IF a.clickup_task_id IS NULL OR coalesce(a.client_name, '') ~* 'playing account|\[internal test\]' THEN
      RAISE EXCEPTION 'That card is not on the billing sheet. Pick another.' USING ERRCODE = '22023';
    END IF;
    IF NOT v_ceo AND NOT coalesce(public.cockpit_client_allowed(a.client_name), false) THEN
      RAISE EXCEPTION '% is not one of your clients. Ask its CSM or the CEO to tie this sale.', a.client_name USING ERRCODE = '42501';
    END IF;
    IF old.state = 'tied' AND old.clickup_task_id = v_target THEN
      RAISE EXCEPTION 'This sale is already on that card.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_choice IN ('not_client','clear') AND v_note IS NULL THEN
    RAISE EXCEPTION 'Say why in a note of 3 to 500 characters.' USING ERRCODE = '22023';
  END IF;
  -- A CSM marks a sale not a client's only when the sale shows one of their clients (as the list shows it to them).
  IF p_choice = 'not_client' AND NOT v_ceo AND NOT EXISTS (
       SELECT 1 FROM unnest(coalesce(old.candidates, '{}'::text[]) || ARRAY[old.clickup_task_id,
                     public.cockpit_sale_tie_suggest(p_response_id, coalesce(public.cockpit_sale_tie_billing(), '{}'::jsonb))->>'t']) c
        WHERE c IS NOT NULL AND coalesce(public.cockpit_client_allowed(public.cockpit_sale_tie_card_name(c)), false)) THEN
    RAISE EXCEPTION 'This sale does not show one of your clients. Ask the CEO to mark it.' USING ERRCODE = '42501';
  END IF;
  IF p_choice = 'clear' AND old.state IS DISTINCT FROM 'tied' THEN
    RAISE EXCEPTION 'This sale is not on a card.' USING ERRCODE = '22023';
  END IF;

  -- Moving or clearing a tie: the CSM must see the card it is on, and never moves notes already on a card.
  IF old.state = 'tied' THEN
    v_old_name := public.cockpit_sale_tie_card_name(old.clickup_task_id);
    IF NOT v_ceo AND NOT coalesce(public.cockpit_client_allowed(v_old_name), false) THEN
      RAISE EXCEPTION 'This sale sits on %, not one of your clients. Ask its CSM or the CEO to move it.',
        coalesce(v_old_name, 'another card') USING ERRCODE = '42501';
    END IF;
    SELECT e.state INTO v_facts FROM public.cockpit_form_effects e WHERE e.response_id = r.id AND e.effect_key = 'sale_facts';
    IF NOT v_ceo AND v_facts IN ('queued','unknown','delivered') THEN
      RAISE EXCEPTION 'This sale''s go-live and handoff notes are already on another card. Ask the CEO to move it.'
        USING ERRCODE = '42501';
    END IF;
    -- The CEO's move takes back a write that has not started, so nothing reaches the card just rejected; a write in
    -- flight settles first (a move under it could land the notes on that card after the move).
    IF v_facts IN ('queued','unknown') THEN
      v_back := public.cockpit_sale_tie_take_back(r.id,
        'The CEO took this sale off this card before its notes were written, so nothing was written.');
      IF v_facts = 'unknown' OR coalesce((v_back->>'inFlight')::int, 0) > 0 THEN
        RAISE EXCEPTION 'This sale''s go-live and handoff notes are being written to its card now. Try again once that write finishes.'
          USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  v_row := jsonb_build_object(
    'state', CASE p_choice WHEN 'not_client' THEN 'not_client' WHEN 'clear' THEN 'unmatched' ELSE 'tied' END,
    'taskId', v_target, 'matchedBy', CASE WHEN v_target IS NOT NULL THEN 'person' END,
    'candidates', CASE WHEN p_choice = 'clear' THEN to_jsonb(ARRAY[old.clickup_task_id]) ELSE to_jsonb(old.candidates) END,
    'alsoOn', to_jsonb(old.also_on),
    'suggestedTaskId', old.suggested_task_id, 'suggestedBy', old.suggested_by,
    'billingTaskId', old.billing_task_id, 'billingMatchedBy', old.billing_matched_by,
    'note', coalesce(v_note, CASE p_choice WHEN 'yes' THEN 'Yes to the suggested card.' ELSE 'Picked from the list.' END));
  -- The audit row of the new tie row (cockpit_sale_ties_audit) carries the choice, the role and, when the sale's notes
  -- already went to the first card, that card (factsOnCard: the trail names it for a hand fix), or, when its write was
  -- taken back before it started, that card (factsTakenBack: nothing was written there).
  PERFORM set_config('cockpit.sale_tie_choice', p_choice, true);
  PERFORM set_config('cockpit.sale_tie_role', CASE WHEN v_ceo THEN 'ceo' ELSE 'csm' END, true);
  PERFORM set_config('cockpit.sale_tie_facts_on', CASE WHEN old.state = 'tied' AND v_facts = 'delivered'
                                                       THEN old.clickup_task_id ELSE '' END, true);
  PERFORM set_config('cockpit.sale_tie_facts_back', CASE WHEN coalesce((v_back->>'takenBack')::int, 0) > 0
                                                         THEN old.clickup_task_id ELSE '' END, true);
  v_id := public.cockpit_sale_tie_write(p_response_id, v_row, coalesce(g->>'email', v_who), 'forms.sale_tie_person',
            'Replaced by ' || v_who || '''s decision.', v_who);
  PERFORM set_config('cockpit.sale_tie_choice', '', true), set_config('cockpit.sale_tie_role', '', true),
          set_config('cockpit.sale_tie_facts_on', '', true), set_config('cockpit.sale_tie_facts_back', '', true);
  IF v_target IS NOT NULL THEN
    v_plan := public.cockpit_sale_tie_plan_facts(v_id);
    -- One sale_facts effect per sale: when it was planned for another tie first, the new card's notes are a hand step.
    IF NOT coalesce((v_plan->>'planned')::boolean, false) AND v_plan ? 'effectId'
       AND (SELECT e.plan->>'tieId' FROM public.cockpit_form_effects e WHERE e.id = (v_plan->>'effectId')::uuid)
             IS DISTINCT FROM v_id::text
       AND public.cockpit_billing_card_listed(v_target, true)
       AND (coalesce(public.cockpit_form_typeform_text(public.cockpit_sale_tie_answer(r.answers, 'e30bc458-1bf3-4840-a849-f2443843ed8a')), '') <> ''
            OR coalesce(public.cockpit_form_typeform_text(public.cockpit_sale_tie_answer(r.answers, '3cf4bfdf-f42a-447c-a109-a0d24468c5cd')), '') <> '') THEN
      v_hand := jsonb_build_object('taskId', v_target,
        'sentence', 'This sale''s notes were planned for another card first, and the cockpit writes them once. Fill Go-live expectation and Handoff problems on this card by hand if they are empty.');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'responseId', p_response_id, 'state', v_row->>'state', 'taskId', v_target,
                            'clientName', public.cockpit_sale_tie_card_name(v_target), 'facts', v_plan)
    || CASE WHEN old.state = 'tied' AND old.clickup_task_id IS DISTINCT FROM v_target
            THEN jsonb_build_object('movedFrom', old.clickup_task_id) ELSE '{}'::jsonb END
    || CASE WHEN v_hand IS NOT NULL THEN jsonb_build_object('handFill', v_hand) ELSE '{}'::jsonb END;
END $$;

-- The CSM screens' read (2.10), gated like cockpit_csm_onboarding_read: a CSM or CEO seat and each card through
-- cockpit_csm_client_gate. Per card, the newest live tie: the signing day, how it was tied, the closer, and the
-- sale's go-live, handoff problems, expectations and sales-call link; {state: 'none'} when no sale is tied. Never a
-- phone, an email, a name, a money answer or the transcript.
CREATE OR REPLACE FUNCTION public.cockpit_csm_sale_read(p_task_ids text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  task text;
  v_out jsonb := '[]'::jsonb;
  t record;
  v_link text;
BEGIN
  PERFORM public.cockpit_csm_actor();
  IF cardinality(p_task_ids) > 200 THEN
    RAISE EXCEPTION 'Choose at most 200 client cards.' USING ERRCODE = '22023';
  END IF;
  FOR task IN SELECT DISTINCT value FROM unnest(coalesce(p_task_ids, '{}')) value LOOP
    PERFORM public.cockpit_csm_client_gate(task);
  END LOOP;
  FOR task IN SELECT DISTINCT value FROM unnest(coalesce(p_task_ids, '{}')) value ORDER BY value LOOP
    SELECT x.response_id, x.matched_by, r.submitted_at, r.answers, r.hidden,
           (SELECT d.voided FROM public.cockpit_sales_deals d WHERE d.response_id = x.response_id LIMIT 1) AS voided,
           (SELECT count(*) FROM public.cockpit_sale_ties o
             WHERE o.cleared_at IS NULL AND o.state = 'tied' AND o.clickup_task_id = task AND o.id <> x.id) AS others
      INTO t
      FROM public.cockpit_sale_ties x
      JOIN public.cockpit_form_responses r ON r.form_key = 'new_client' AND r.external_id = x.response_id
     WHERE x.cleared_at IS NULL AND x.state = 'tied' AND x.clickup_task_id = task
     ORDER BY r.submitted_at DESC, x.response_id DESC LIMIT 1;
    IF t.response_id IS NULL THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('taskId', task, 'state', 'none'));
      CONTINUE;
    END IF;
    v_link := btrim(public.cockpit_sale_tie_answer(t.answers, '52ca9be9-8f56-4bb8-a130-dc1754e7d84d'));
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'taskId', task, 'state', 'tied', 'responseId', t.response_id,
      'signedAt', t.submitted_at,
      'signedOn', to_char((t.submitted_at AT TIME ZONE 'Asia/Kuwait')::date, 'YYYY-MM-DD'),
      'tiedBy', t.matched_by,
      'closer', left(coalesce(nullif(btrim(public.cockpit_sale_tie_answer(t.answers, 'a86cbf90-2154-44d9-84e3-b4a20f8e96a2')), ''),
                              nullif(btrim(t.hidden->>'closer'), '')), 120),
      'goLive', nullif(public.cockpit_form_typeform_text(public.cockpit_sale_tie_answer(t.answers, 'e30bc458-1bf3-4840-a849-f2443843ed8a')), ''),
      'handoffProblems', nullif(public.cockpit_form_typeform_text(public.cockpit_sale_tie_answer(t.answers, '3cf4bfdf-f42a-447c-a109-a0d24468c5cd')), ''),
      'expectations', nullif(public.cockpit_form_typeform_text(public.cockpit_sale_tie_answer(t.answers, '23dd5b40-144e-462e-bfac-795058701f2b')), ''),
      'salesCallLink', CASE WHEN v_link ~ '^https://\S+$' THEN v_link END,
      'voidedInB2B', coalesce(t.voided, false),
      'otherSales', t.others));
  END LOOP;
  RETURN jsonb_build_object('on', (public.cockpit_sale_tie_flags()->>'on')::boolean, 'cards', v_out);
END $$;

-- ---------------------------------------------------------------------------
-- 7. The three replaced functions, each the live body with its change and nothing else.

CREATE OR REPLACE FUNCTION public.cockpit_form_responses_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- Waves 1-2: carve-outs for a stored termination survey or pause
  -- request (state legacy), each only under its transaction-local
  -- setting: a person's match to a card (task_id from none, or off a card
  -- found only by the link's hidden id, set by cockpit_form_legacy_match),
  -- a person's word that such a card is right (answer_meta.match from
  -- hidden_id_unverified to confirmed_by_person with answer_meta.matched,
  -- once, by the match or 20261101o's churn confirm), and the one answer to
  -- its notice (answer_meta.answered, added once, by 20261101o's notice answer).
  v_legacy boolean := OLD.state = 'legacy' AND OLD.form_key IN ('exit_survey','pause_request');
  -- Waves 3-4 (20261102b): a client's own exit survey or pause consent from the
  -- portal or the link (state submitted) takes the same one answer to its notice.
  v_native boolean := OLD.state = 'submitted' AND OLD.form_key IN ('exit_survey','pause_consent');
  v_setting text := coalesce(current_setting('cockpit.forms_legacy', true), '');
  v_unverified boolean := coalesce(OLD.answer_meta->>'match', '') = 'hidden_id_unverified';
  v_match boolean := false;
  v_mark boolean := false;
  v_answer boolean := false;
  -- 20261103g (the sale tie, contract 4.19): a stored New Client Form (state submitted) sits on the card of its live
  -- row in cockpit_sale_ties, only under cockpit.forms_legacy = 'sale_tie': the card and answer_meta's match and
  -- matched follow that row; the answers and every other key stay.
  v_sale boolean := false;
  v_card text;
BEGIN
  v_mark := v_legacy AND v_setting IN ('match','confirm') AND v_unverified
            AND NOT (OLD.answer_meta ? 'matched')
            AND coalesce(NEW.answer_meta->>'match', '') = 'confirmed_by_person'
            AND jsonb_typeof(NEW.answer_meta->'matched') = 'object'
            AND (NEW.answer_meta - 'match' - 'matched') = (OLD.answer_meta - 'match');
  -- A card moves only with the person's mark in the same write.
  v_match := v_legacy AND v_setting = 'match' AND NEW.task_id IS NOT NULL
             AND (OLD.task_id IS NULL OR v_mark);
  v_answer := (v_legacy OR v_native) AND v_setting = 'answer'
              AND NOT (OLD.answer_meta ? 'answered') AND jsonb_typeof(NEW.answer_meta->'answered') = 'object'
              AND (NEW.answer_meta - 'answered') = OLD.answer_meta;
  IF v_setting = 'sale_tie' AND OLD.form_key = 'new_client' AND OLD.state = 'submitted' AND NEW.state = 'submitted'
     AND NEW.answers IS NOT DISTINCT FROM OLD.answers
     AND (NEW.answer_meta - 'match' - 'matched') = (OLD.answer_meta - 'match' - 'matched') THEN
    SELECT t.clickup_task_id INTO v_card FROM public.cockpit_sale_ties t
     WHERE t.response_id = OLD.external_id AND t.cleared_at IS NULL AND t.state = 'tied';
    v_sale := CASE WHEN v_card IS NULL
                   THEN NEW.task_id IS NULL AND NOT (NEW.answer_meta ? 'match') AND NOT (NEW.answer_meta ? 'matched')
                   ELSE NEW.task_id IS NOT DISTINCT FROM v_card
                        AND coalesce(NEW.answer_meta->>'match', '') IN ('phone','email','phone_email','confirmed_by_person')
                        AND jsonb_typeof(NEW.answer_meta->'matched') = 'object'
                        AND (NEW.answer_meta->'matched'->>'taskId') IS NOT DISTINCT FROM v_card
                        AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.answer_meta->'matched') k
                                         WHERE k NOT IN ('by','at','via','taskId','from')) END;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.form_key IS DISTINCT FROM OLD.form_key
     OR NEW.form_version IS DISTINCT FROM OLD.form_version OR NEW.source IS DISTINCT FROM OLD.source
     OR (NEW.task_id IS DISTINCT FROM OLD.task_id AND NOT (v_match OR v_sale)) OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A response keeps its form, version, source, card, mode, seat and creation time' USING ERRCODE = '55000';
  END IF;
  IF OLD.state <> 'draft' AND (NEW.answers IS DISTINCT FROM OLD.answers
                              OR (NEW.answer_meta IS DISTINCT FROM OLD.answer_meta AND NOT (v_answer OR v_mark OR v_sale))) THEN
    RAISE EXCEPTION 'Sent notes keep their answers' USING ERRCODE = '55000';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'draft' AND NEW.state IN ('submitted','void'))
    OR (OLD.state = 'submitted' AND NEW.state = 'confirmed')) THEN
    RAISE EXCEPTION 'A response goes from % to % only through the cockpit', OLD.state, NEW.state USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

-- The portal's Getting started (3.3): live only while onboarding is in forms.client.live and
-- forms.stage4.onboarding is on; answered for any stored onboarding answer or kickoff of the card;
-- else the card's open invite, or a new one issued for the portal.
CREATE OR REPLACE FUNCTION public.portal_form_onboarding_open(p_location_id text, p_clickup_id text, p_person text, p_role text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_at timestamptz;
  i public.cockpit_form_invites;
  v_id uuid;
  v_ctx jsonb := '{}'::jsonb;
  v_name text;
BEGIN
  PERFORM public.cockpit_form_portal_workspace(p_location_id, p_clickup_id);
  IF NOT (public.cockpit_form_client_live('onboarding') AND public.cockpit_form_stage4_on('onboarding')) THEN
    RETURN jsonb_build_object('live', false);
  END IF;
  v_at := public.cockpit_form_stage4_answered_at(p_clickup_id, NULL);
  IF v_at IS NOT NULL THEN
    RETURN jsonb_build_object('live', true, 'answeredAt', v_at, 'inviteId', NULL);
  END IF;
  PERFORM public.cockpit_form_invites_expire();
  SELECT * INTO i FROM public.cockpit_form_invites x
   WHERE x.task_id = p_clickup_id AND x.form_key = 'onboarding' AND x.state = 'open' AND x.origin <> 'canary'
   ORDER BY x.issued_at DESC LIMIT 1;
  IF i.id IS NOT NULL THEN
    RETURN jsonb_build_object('live', true, 'answeredAt', NULL, 'inviteId', i.id);
  END IF;
  -- The business name from the card's newest live, tied New Client Form (20261103g: its own answer a1be4eee), as the
  -- form's context.
  SELECT nullif(btrim(coalesce(public.cockpit_sale_tie_answer(r.answers, 'a1be4eee-8219-4228-8423-8cbf64919c5f'), '')), '')
    INTO v_name
    FROM public.cockpit_sale_ties t
    JOIN public.cockpit_form_responses r ON r.form_key = 'new_client' AND r.external_id = t.response_id
   WHERE t.cleared_at IS NULL AND t.state = 'tied' AND t.clickup_task_id = p_clickup_id
   ORDER BY r.submitted_at DESC NULLS LAST, t.response_id DESC LIMIT 1;
  IF v_name IS NOT NULL THEN v_ctx := jsonb_build_object('businessName', left(v_name, 200)); END IF;
  v_id := public.cockpit_form_invite_issue_system(p_clickup_id, 'onboarding', ARRAY['portal'], v_ctx, 'portal');
  IF v_id IS NULL AND v_ctx <> '{}'::jsonb THEN
    v_id := public.cockpit_form_invite_issue_system(p_clickup_id, 'onboarding', ARRAY['portal'], '{}'::jsonb, 'portal');
  END IF;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('live', true, 'answeredAt', NULL, 'inviteId', NULL,
      'reason', nullif(current_setting('cockpit.form_issue_refusal', true), ''));
  END IF;
  RETURN jsonb_build_object('live', true, 'answeredAt', NULL, 'inviteId', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_form_doors()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_marks jsonb;
  v_churn boolean;
  v_money boolean;
  v_checks boolean;
  v_base boolean;
  v_invites boolean;
  v_lifecycle boolean;
  v_voice boolean;
  v_editor boolean;
  v_new jsonb;
  v_live jsonb;
  v_stage4 jsonb;
  v_tie jsonb;
  v_why jsonb := '{}'::jsonb;
  v_flags jsonb := '{}'::jsonb;
  k text;
BEGIN
  PERFORM public.cockpit_form_actor();
  SELECT CASE WHEN jsonb_typeof(c.value) = 'object' THEN c.value END INTO v_marks
    FROM public.cockpit_settings c WHERE c.key = 'forms.doors';
  v_marks := coalesce(v_marks, '{}'::jsonb);
  v_churn := coalesce(v_marks->>'churn', '') = 'true';
  v_money := coalesce(v_marks->>'money', '') = 'true';
  v_checks := coalesce(v_marks->>'checks', '') = 'true';
  -- Waves 3-4 (3.3): each wave 3-4 file merges its own marker.
  v_invites := coalesce(v_marks->>'invites', '') = 'true';
  v_lifecycle := coalesce(v_marks->>'lifecycle', '') = 'true';
  v_voice := coalesce(v_marks->>'voice', '') = 'true';
  v_editor := coalesce(v_marks->>'editor', '') = 'true';
  -- This file's own reads and record, which every door's screen uses.
  v_base := to_regprocedure('public.cockpit_form_trail(jsonb)') IS NOT NULL
            AND to_regprocedure('public.cockpit_form_notices_in()') IS NOT NULL
            AND to_regprocedure('public.cockpit_form_staff_record(text,text,jsonb,uuid,text)') IS NOT NULL;
  -- Waves 5-6 (3.10): each new door is open when its functions exist and its
  -- marker or switch is on; why says which is missing (functions) or off.
  SELECT CASE WHEN jsonb_typeof(c.value->'live') = 'array' THEN c.value->'live' END INTO v_live
    FROM public.cockpit_settings c WHERE c.key = 'forms.client';
  SELECT CASE WHEN jsonb_typeof(c.value) = 'object' THEN c.value END INTO v_stage4
    FROM public.cockpit_settings c WHERE c.key = 'forms.stage4';
  -- 20261103g (contract 4.19): the sale tie's three switches.
  SELECT CASE WHEN jsonb_typeof(c.value) = 'object' THEN c.value END INTO v_tie
    FROM public.cockpit_settings c WHERE c.key = 'forms.sale_tie';
  v_new := jsonb_build_object(
    'wins', jsonb_build_array(to_regprocedure('public.cockpit_csm_win_log(jsonb)') IS NOT NULL,
                              coalesce(v_marks->>'wins', '') = 'true'),
    'receipts', jsonb_build_array(to_regprocedure('public.portal_form_file_slot(text,text,text,text,uuid,text,text,bigint,text)') IS NOT NULL,
                                  coalesce(v_live, '[]'::jsonb) ? 'bank_receipt'),
    'reactivate', jsonb_build_array(EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                                             WHERE a.attrelid = 'public.cockpit_churn_departures'::regclass AND a.attname = 'returned_on'
                                               AND NOT a.attisdropped),
                                    coalesce(v_marks->>'reactivate', '') = 'true'),
    'kickoff', jsonb_build_array(to_regprocedure('public.cockpit_kickoff_submit(text,jsonb,uuid)') IS NOT NULL,
                                 coalesce(v_stage4->>'kickoff', '') = 'true'),
    'agent', jsonb_build_array(to_regprocedure('public.cockpit_agent_keys_read()') IS NOT NULL,
                               coalesce(v_marks->>'agent', '') = 'true'),
    'ltv', jsonb_build_array(to_regprocedure('public.cockpit_ltv_read()') IS NOT NULL,
                             coalesce(v_marks->>'ltv', '') = 'true'),
    'saleTie', jsonb_build_array(to_regprocedure('public.cockpit_sale_tie_list()') IS NOT NULL
                                   AND to_regprocedure('public.cockpit_sale_tie_decide(text,text,text,text)') IS NOT NULL
                                   AND to_regprocedure('public.cockpit_csm_sale_read(text[])') IS NOT NULL,
                                 coalesce(v_tie->>'on', '') = 'true'),
    'saleFacts', jsonb_build_array(to_regprocedure('public.cockpit_sale_tie_plan_facts(bigint)') IS NOT NULL,
                                   coalesce(v_tie->>'fill', '') = 'true'),
    'salesLink', jsonb_build_array(to_regprocedure('public.cockpit_sale_tie_plan_facts(bigint)') IS NOT NULL,
                                   coalesce(v_tie->>'salesLink', '') = 'true'));
  FOR k IN SELECT jsonb_object_keys(v_new) LOOP
    v_flags := v_flags || jsonb_build_object(k, (v_new->k->>0)::boolean AND (v_new->k->>1)::boolean);
    v_why := v_why || jsonb_build_object(k, CASE WHEN NOT (v_new->k->>0)::boolean THEN 'missing'
                                                 WHEN NOT (v_new->k->>1)::boolean THEN 'off' END);
  END LOOP;
  RETURN v_flags || jsonb_build_object('why', v_why) || jsonb_build_object(
    'churnConfirm', v_base AND v_churn
      AND to_regprocedure('public.cockpit_client_lifecycle_confirm(text,jsonb)') IS NOT NULL
      AND to_regprocedure('public.cockpit_form_notice_answer(uuid,text,text)') IS NOT NULL
      AND to_regprocedure('public.cockpit_client_lifecycle_read(text)') IS NOT NULL
      AND to_regprocedure('public.cockpit_form_legacy_match(uuid,text)') IS NOT NULL,
    'extension', v_base AND v_money
      AND to_regprocedure('public.cockpit_billing_write(text,jsonb)') IS NOT NULL
      AND to_regprocedure('public.cockpit_extensions_read(date,date)') IS NOT NULL
      AND to_regprocedure('public.cockpit_form_prefill(text,text)') IS NOT NULL,
    'pause', v_base AND v_money
      AND to_regprocedure('public.cockpit_billing_write(text,jsonb)') IS NOT NULL
      AND to_regprocedure('public.cockpit_billing_ladder_read()') IS NOT NULL
      AND to_regprocedure('public.cockpit_form_prefill(text,text)') IS NOT NULL,
    'mrr', v_base AND v_money
      AND to_regprocedure('public.cockpit_billing_write(text,jsonb)') IS NOT NULL
      AND to_regprocedure('public.cockpit_mrr_read()') IS NOT NULL,
    'reviews', v_base AND v_money
      AND to_regprocedure('public.cockpit_billing_ladder_due()') IS NOT NULL
      AND to_regprocedure('public.cockpit_billing_ladder_read()') IS NOT NULL,
    'checks', v_base AND v_checks
      AND to_regprocedure('public.cockpit_manual_payment_check(text,text,text,text)') IS NOT NULL
      AND to_regprocedure('public.cockpit_manual_payments_to_check()') IS NOT NULL,
    'prefill', v_base AND v_money
      AND to_regprocedure('public.cockpit_form_prefill(text,text)') IS NOT NULL,
    'invites', v_invites
      AND to_regprocedure('public.cockpit_form_invite_view(text)') IS NOT NULL
      AND to_regprocedure('public.cockpit_form_invite_issue(text,text,text[],text,text,boolean,jsonb,uuid,text)') IS NOT NULL
      AND to_regprocedure('public.cockpit_form_invite_withdraw(text,uuid,text)') IS NOT NULL
      AND to_regprocedure('public.cockpit_form_invite_link(text,uuid)') IS NOT NULL
      AND to_regprocedure('public.cockpit_form_invites_today()') IS NOT NULL
      AND to_regprocedure('public.cockpit_form_answer_read(uuid)') IS NOT NULL,
    'lifecycle', v_lifecycle
      AND to_regprocedure('public.cockpit_form_hook_pause_consent(uuid)') IS NOT NULL
      AND to_regprocedure('public.cockpit_form_hook_exit_survey(uuid)') IS NOT NULL
      AND to_regprocedure('public.cockpit_pause_consent_for(text)') IS NOT NULL,
    'voice', v_voice
      AND to_regprocedure('public.cockpit_client_voice_read(text)') IS NOT NULL,
    'editor', v_editor
      AND to_regprocedure('public.cockpit_form_publish(text,text,integer)') IS NOT NULL);
END $function$;

-- ---------------------------------------------------------------------------
-- 8. The registry (one audit row per entry, by the live cockpit_forms_audit) and the setting (all false; an
--    existing value is kept, so a second apply never turns a switch back off).

SELECT set_config('cockpit.forms_action', 'forms.sale_tie_registry', true);
UPDATE public.cockpit_forms
   SET effects = effects || '[{"key":"sale_tie","label":"Sale tied to its card","owner":"cockpit","delivery":"sql"}]'::jsonb,
       updated_by = 'migration 20261103g', updated_at = now()
 WHERE key = 'new_client' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(effects) e WHERE e->>'key' = 'sale_tie');
UPDATE public.cockpit_forms
   SET effects = effects || '[{"key":"sale_facts","label":"Go-live and handoff problems on the card, when empty","owner":"cockpit","delivery":"clickup_queue"}]'::jsonb,
       updated_by = 'migration 20261103g', updated_at = now()
 WHERE key = 'new_client' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(effects) e WHERE e->>'key' = 'sale_facts');
SELECT set_config('cockpit.forms_action', '', true);

INSERT INTO public.cockpit_settings (key, value, updated_by)
VALUES ('forms.sale_tie', '{"on": false, "fill": false, "salesLink": false}'::jsonb, 'migration 20261103g')
ON CONFLICT (key) DO UPDATE
   SET value = excluded.value || public.cockpit_settings.value, updated_by = excluded.updated_by, updated_at = now()
 WHERE NOT (public.cockpit_settings.value ?& array['on','fill','salesLink']);

-- ---------------------------------------------------------------------------
-- 9. Grants: every new and replaced function revoked from the four roles first, then granted as section 3 of the
--    contract says. The helpers are the owner's only.

REVOKE ALL ON FUNCTION
  public.cockpit_sale_ties_lock(), public.cockpit_sale_ties_audit(),
  public.cockpit_sale_tie_flags(), public.cockpit_sale_tie_norm(text,text), public.cockpit_sale_tie_digest(text,text,text),
  public.cockpit_sale_tie_pepper(), public.cockpit_sale_tie_key(text,text), public.cockpit_sale_tie_answer(jsonb,text),
  public.cockpit_sale_tie_ts(text), public.cockpit_sale_tie_stored_keys(text,text), public.cockpit_sale_tie_card_keys(jsonb,text),
  public.cockpit_sale_tie_resolve(text[],timestamptz,jsonb), public.cockpit_sale_tie_match(text,text,timestamptz,jsonb),
  public.cockpit_sale_tie_billing(), public.cockpit_sale_tie_suggest(text,jsonb),
  public.cockpit_sale_tie_evaluate(text,text,text,jsonb,jsonb), public.cockpit_sale_tie_card_name(text),
  public.cockpit_sale_tie_write(text,jsonb,text,text,text,text), public.cockpit_sale_tie_apply(text,jsonb,text,text[]),
  public.cockpit_sale_tie_plan_facts(bigint), public.cockpit_sale_tie_plan_pending(),
  public.cockpit_sale_tie_gate_ready(), public.cockpit_sale_tie_take_back(uuid,text), public.cockpit_sale_tie_switch_off(),
  public.cockpit_sale_tie_store_cards(jsonb,text,text,bigint),
  public.cockpit_sale_tie_open(jsonb), public.cockpit_sale_tie_door_failed(), public.cockpit_sale_tie_waiting(),
  public.cockpit_sale_tie_offer(bigint,jsonb), public.cockpit_sale_tie_sweep(bigint), public.cockpit_sale_tie_backfill(jsonb,boolean),
  public.cockpit_sale_tie_list(), public.cockpit_sale_tie_decide(text,text,text,text), public.cockpit_csm_sale_read(text[]),
  public.cockpit_form_responses_guard(), public.portal_form_onboarding_open(text,text,text,text), public.cockpit_form_doors()
  FROM PUBLIC, anon, authenticated, service_role;

-- The door, the sync and its job (service role; each also checks the role inside).
GRANT EXECUTE ON FUNCTION
  public.cockpit_sale_tie_open(jsonb), public.cockpit_sale_tie_door_failed(), public.cockpit_sale_tie_waiting(),
  public.cockpit_sale_tie_offer(bigint,jsonb), public.cockpit_sale_tie_sweep(bigint), public.cockpit_sale_tie_backfill(jsonb,boolean)
  TO service_role;
-- The cockpit (the gate is inside each).
GRANT EXECUTE ON FUNCTION
  public.cockpit_sale_tie_list(), public.cockpit_sale_tie_decide(text,text,text,text), public.cockpit_csm_sale_read(text[]),
  public.cockpit_form_doors()
  TO authenticated;
-- As live: the portal's open is the portal's service door.
GRANT EXECUTE ON FUNCTION public.portal_form_onboarding_open(text,text,text,text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
