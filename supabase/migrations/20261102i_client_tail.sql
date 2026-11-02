-- Waves 5 and 6, client tail (docs/forms/WAVE56-CONTRACT.md 2.1, 2.2 'i' rows, 2.5, 3.3, 3.6, 3.7, 4.10 to
-- 4.12, 5.8 and 11.3). Creative Triage only. Every new writer is dark at deploy: bank_receipt is not in
-- forms.client.live, the reactivate door marker (seeded false by 20261102g) is false, and the retire
-- registry is data only (its switch-offs are deploy steps).
--
-- 1. File, date, number and heading fields and the text formats in client form schema v1 (3.6): the
--    schema check, the answer check (now STABLE: it reads storage.objects and the file slots, and is
--    called only from the submit paths), the private bucket cockpit-form-files and its file slots.
-- 2. The bank receipt (4.10): the registry row bank_receipt (client, not live), its issue rule (origin
--    billing only, its context, one open per card), the hook that attaches a receipt to a logged
--    transfer (named in the invite, or one near match) or else writes one portal row into the billing
--    inbox, cockpit_payment_receipts, the inbox's portal source, and the trigger that puts a receipt on
--    its ledger twin when ingest marks the portal row duplicate. Nothing here is cash, LTV or pay until
--    finance or the CEO checks the payment.
-- 3. Reactivate (4.12): cockpit_client_lifecycle_confirm('reactivate', ...) reopens a confirmed
--    departure in one audited act (billing kind reactivate, the departure's returned_on, an mrr event
--    when the MRR differs, one reactivation win, the notice client.reactivated, a reactivate response);
--    the departure is never removed, so the month the client left keeps its churn.
-- 4. The C9 retire registry (3.7, 11.3): cockpit_retire_items, its seed, its owner-only mover with the
--    14-quiet-days rule and the rollback, its browser read and the guardian's view.
--
-- Applies twice. The drift guard below refuses any replaced body that is neither the live one the
-- contract read (11.2-c) nor this file's own. cockpit_form_invite_issue_core and
-- cockpit_form_invite_build_view are read here as well: issue_core is replaced (it names the client
-- forms and their context keys; the contract's list missed it, see the slice report), build_view is not.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard (2.1) and what this file stands on

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_form_schema_check(jsonb)', '30b96e79a5257d98cb0c22b5d00d7af9', '1f5d9016571ed472b83dbffa17363095'),
      ('public.cockpit_form_answers_check(jsonb,jsonb,jsonb)', 'ae2318509ab88246c8b9deb15ef6c8b6', 'd1d8bb66ae056415f8a2a968627220df'),
      ('public.cockpit_form_card_allows(text,text)', 'd6f88a6602190b25c3e795124bd95335', '972374b009d453246503b585858a65b3'),
      ('public.cockpit_form_invite_issue_core(text,text,text[],text,text,boolean,jsonb,uuid,text,jsonb)', 'd9fd866ad86caeaf87b4887684c1fe3e', 'da7a50edf7252dc8ff3deb2779348e9a'),
      ('public.cockpit_form_invite_issue(text,text,text[],text,text,boolean,jsonb,uuid,text)', 'd1240e841250b3fb3d89f78af903ff4e', 'f08f6e3a20e2ec3a500317048a196bb7'),
      ('public.cockpit_form_invite_issue_system(text,text,text[],jsonb,text)', '408eeff14da78b14089948764b306a5c', '3d6a1d9540ae56120c43289d63630925'),
      ('public.cockpit_form_invite_view(text)', '8822e64244f5b953756108fd9a1e16a4', '70c02ed29db88796bd226e26d10e98cd'),
      ('public.cockpit_form_invite_canary(text,jsonb,text[])', 'd59801aa8335418583ef8635355e54df', '726ed2a2614d92a8986bb3dd4f15ada9'),
      ('public.portal_form_get(text,text,text,text,uuid)', '507d4b31908437433eebea478c728439', 'f0a0b46fe264a01281895b7b35d6196a'),
      ('public.cockpit_manual_payments_to_check()', 'd0651c549d7fe53714705dd537ea1a27', '260f79ee4f3bc222a453264e861628de'),
      ('public.cockpit_client_lifecycle_confirm(text,jsonb)', '559e2d89e5e53c269f8d200a1c03e354', '5b706fc1c502c92acc302c5fe2c7fb57'),
      ('public.cockpit_csm_churn_read()', '47e621e9a67da0fc195d87d407885497', 'b2cabb70d810f8901bdb16e5ecb207ae'),
      ('public.cockpit_form_prefill(text,text)', 'c8b2a34b4b1635844ddd310c7ec2d217', '25df98f605431990c4489daf375bebb8')
    ) AS x(fn, live_md5, after_md5)
  LOOP
    v_now := NULL;
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(g.fn);
    IF v_now IS NULL OR v_now NOT IN (g.live_md5, g.after_md5) THEN
      RAISE EXCEPTION '% changed since the waves 5-6 contract read it; stop and re-read it.', replace(g.fn, 'public.', '')
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  -- The view, by its definition.
  v_now := NULL;
  SELECT md5(regexp_replace(pg_catalog.pg_get_viewdef('public.cockpit_client_lifecycle_v'::regclass), '\s+', ' ', 'g')) INTO v_now;
  IF v_now IS NULL OR v_now NOT IN ('43a401c28835ecd33b5c5c545eaa86cd', 'f5c427664fbfbbb7dba7ee5dcd40ef32') THEN
    RAISE EXCEPTION 'cockpit_client_lifecycle_v changed since the waves 5-6 contract read it; stop and re-read it.'
      USING ERRCODE = '55000';
  END IF;
  -- Read, not replaced: the duplicate twin trigger relies on ingest marking an exact twin duplicate with
  -- its ledger id (W12 CK), and the bank receipt reuses the build view as it is.
  v_now := NULL;
  SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
    FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.cockpit_billing_ingest_inbox(boolean,integer)');
  IF v_now IS DISTINCT FROM '1355ad42efb3e9a7b02e0944f2d784f5' THEN
    RAISE EXCEPTION 'cockpit_billing_ingest_inbox changed since the waves 5-6 contract read it; stop and re-read it.'
      USING ERRCODE = '55000';
  END IF;
  v_now := NULL;
  SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
    FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.cockpit_form_invite_build_view(text,text)');
  IF v_now IS DISTINCT FROM 'c470f2f58628dba8d07c7879f4e20e6a' THEN
    RAISE EXCEPTION 'cockpit_form_invite_build_view changed since the waves 5-6 contract read it; stop and re-read it.'
      USING ERRCODE = '55000';
  END IF;
END $$;

-- 20261102g (billing kind reactivate, the three notice kinds, the door markers) and 20261102h (the
-- wins ledger) come first (2.1 order; the reactivation win and the reactivate event need both).
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_billing_events'::regclass AND c.conname = 'cockpit_billing_events_kind_check';
  IF v_def IS NULL OR v_def NOT LIKE '%''reactivate''%'
     OR to_regclass('public.cockpit_csm_wins') IS NULL OR to_regclass('public.cockpit_csm_win_events') IS NULL
     OR to_regclass('public.cockpit_form_invites') IS NULL OR to_regclass('public.cockpit_payment_ties') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                     WHERE c.conrelid = 'public.cockpit_slack_notices'::regclass AND c.conname = 'cockpit_slack_notices_kind_check'
                       AND pg_get_constraintdef(c.oid) LIKE '%''client.reactivated''%'
                       AND pg_get_constraintdef(c.oid) LIKE '%''receipt.in''%') THEN
    RAISE EXCEPTION 'Apply 20261102a to 20261102h before 20261102i.' USING ERRCODE = '55000';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. CHECKs and columns, each widened only from the definition the contract read (11.2-f); any other
--    definition stops the file, and one already widened changes nothing.

DO $$
DECLARE v_def text;
BEGIN
  -- Invites: the bank receipt and the native onboarding (purpose = form_key stays).
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_form_invites'::regclass AND c.conname = 'cockpit_form_invites_purpose_check';
  IF v_def IS DISTINCT FROM 'CHECK ((purpose = ANY (ARRAY[''pause_consent''::text, ''exit_survey''::text, ''nps''::text, ''csat''::text, ''bank_receipt''::text, ''onboarding''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((purpose = ANY (ARRAY[''pause_consent''::text, ''exit_survey''::text, ''nps''::text, ''csat''::text])))' THEN
      RAISE EXCEPTION 'cockpit_form_invites_purpose_check changed since the waves 5-6 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_form_invites DROP CONSTRAINT cockpit_form_invites_purpose_check;
    ALTER TABLE public.cockpit_form_invites ADD CONSTRAINT cockpit_form_invites_purpose_check
      CHECK (purpose IN ('pause_consent','exit_survey','nps','csat','bank_receipt','onboarding'));
  END IF;

  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_form_invites'::regclass AND c.conname = 'cockpit_form_invites_origin_check';
  IF v_def IS DISTINCT FROM 'CHECK ((origin = ANY (ARRAY[''csm''::text, ''schedule''::text, ''pause''::text, ''churn''::text, ''canary''::text, ''billing''::text, ''portal''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((origin = ANY (ARRAY[''csm''::text, ''schedule''::text, ''pause''::text, ''churn''::text, ''canary''::text])))' THEN
      RAISE EXCEPTION 'cockpit_form_invites_origin_check changed since the waves 5-6 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_form_invites DROP CONSTRAINT cockpit_form_invites_origin_check;
    ALTER TABLE public.cockpit_form_invites ADD CONSTRAINT cockpit_form_invites_origin_check
      CHECK (origin IN ('csm','schedule','pause','churn','canary','billing','portal'));
  END IF;

  -- The billing inbox: a receipt the client sent from the portal or a link.
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_billing_inbox'::regclass AND c.conname = 'cockpit_billing_inbox_source_check';
  IF v_def IS DISTINCT FROM 'CHECK ((source = ANY (ARRAY[''csm''::text, ''maher''::text, ''other''::text, ''portal''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((source = ANY (ARRAY[''csm''::text, ''maher''::text, ''other''::text])))' THEN
      RAISE EXCEPTION 'cockpit_billing_inbox_source_check changed since the waves 5-6 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_billing_inbox DROP CONSTRAINT cockpit_billing_inbox_source_check;
    ALTER TABLE public.cockpit_billing_inbox ADD CONSTRAINT cockpit_billing_inbox_source_check
      CHECK (source IN ('csm','maher','other','portal'));
  END IF;
END $$;

ALTER TABLE public.cockpit_billing_inbox
  ADD COLUMN IF NOT EXISTS response_id uuid REFERENCES public.cockpit_form_responses(id);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_billing_inbox_one_per_response
  ON public.cockpit_billing_inbox (response_id) WHERE response_id IS NOT NULL;

-- The departure register's return (4.12): written only by the reactivate act.
ALTER TABLE public.cockpit_churn_departures
  ADD COLUMN IF NOT EXISTS returned_on date,
  ADD COLUMN IF NOT EXISTS return_event_id bigint REFERENCES public.cockpit_billing_events(id),
  ADD COLUMN IF NOT EXISTS returned_by text;

CREATE OR REPLACE FUNCTION public.cockpit_churn_departure_return_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.returned_on, NEW.return_event_id, NEW.returned_by) IS DISTINCT FROM (OLD.returned_on, OLD.return_event_id, OLD.returned_by)
     AND coalesce(current_setting('cockpit.reactivate', true), '') IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION 'A departure''s return is written only by Client is back.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cockpit_churn_departure_return_guard ON public.cockpit_churn_departures;
CREATE TRIGGER cockpit_churn_departure_return_guard BEFORE UPDATE ON public.cockpit_churn_departures
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_churn_departure_return_guard();

-- ---------------------------------------------------------------------------
-- 2. The bucket and the tables (2.5, 3.6, 3.7)

-- Private, 10 MB, photos and PDFs. No storage policy for anon or authenticated: only the service key
-- reaches it (the portal server's signed upload URL, the cockpit forms door's signed download URL).
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('cockpit-form-files', 'cockpit-form-files', false, 10485760,
            ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.cockpit_form_file_slots (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invite_id  uuid NOT NULL REFERENCES public.cockpit_form_invites(id),
  field_key  text NOT NULL CHECK (field_key ~ '^[a-z][a-zA-Z0-9]{1,30}$'),
  -- forms/{invite_id}/{field_key}/{sha256}.{jpg|png|webp|heic|pdf}
  path       text NOT NULL UNIQUE CHECK (path ~ '^forms/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z][a-zA-Z0-9]{1,30}/[0-9a-f]{64}\.(jpg|png|webp|heic|pdf)$'),
  mime       text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp','image/heic','application/pdf')),
  bytes      bigint NOT NULL CHECK (bytes BETWEEN 1 AND 10485760),
  sha256     text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  made_at    timestamptz NOT NULL DEFAULT now(),
  made_via   text NOT NULL CHECK (made_via IN ('portal','token','canary')),
  used_by    uuid REFERENCES public.cockpit_form_responses(id),
  CHECK (path = 'forms/' || invite_id::text || '/' || field_key || '/' || sha256 || '.' ||
               CASE mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp'
                         WHEN 'image/heic' THEN 'heic' ELSE 'pdf' END)
);
CREATE INDEX IF NOT EXISTS cockpit_form_file_slots_invite ON public.cockpit_form_file_slots (invite_id, field_key);

CREATE TABLE IF NOT EXISTS public.cockpit_payment_receipts (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  manual_payment_id text NOT NULL REFERENCES public.cockpit_manual_payments(id),
  response_id       uuid NOT NULL UNIQUE REFERENCES public.cockpit_form_responses(id),
  path              text NOT NULL CHECK (path ~ '^forms/'),
  amount            numeric CHECK (amount IS NULL OR amount > 0),
  currency          text CHECK (currency IS NULL OR currency IN ('USD','KWD')),
  paid_on           date,
  reference         text CHECK (reference IS NULL OR char_length(reference) <= 60),
  -- How it was attached: named in the invite, one near match, or the twin of a duplicate inbox row.
  attached_by       text NOT NULL DEFAULT 'invite' CHECK (attached_by IN ('invite','near_match','twin')),
  added_at          timestamptz NOT NULL DEFAULT now()
);
-- One receipt per logged payment: a second invite, a near match or a twin never stacks a second one.
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_payment_receipts_one_per_payment ON public.cockpit_payment_receipts (manual_payment_id);

CREATE TABLE IF NOT EXISTS public.cockpit_retire_items (
  id              text PRIMARY KEY CHECK (id ~ '^(make|typeform|webhook):[A-Za-z0-9_.-]{1,60}$'),
  kind            text NOT NULL CHECK (kind IN ('make','typeform','webhook')),
  external_id     text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 60),
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  used_for        text NOT NULL CHECK (char_length(used_for) BETWEEN 1 AND 240),
  owner_role      text NOT NULL CHECK (char_length(owner_role) BETWEEN 1 AND 60),
  replacement     text NOT NULL CHECK (char_length(replacement) BETWEEN 1 AND 240),
  wave            text NOT NULL CHECK (char_length(wave) BETWEEN 1 AND 20),
  state           text NOT NULL CHECK (state IN ('on','off','closed','removed','archived','kept')),
  switch_off_step text CHECK (switch_off_step IS NULL OR char_length(switch_off_step) <= 40),
  off_at          timestamptz,
  quiet_since     timestamptz,
  archived_at     timestamptz,
  backup_path     text CHECK (backup_path IS NULL OR char_length(backup_path) <= 300),
  note            text CHECK (note IS NULL OR char_length(note) <= 500),
  updated_by      text NOT NULL CHECK (char_length(btrim(updated_by)) BETWEEN 2 AND 120),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (id = kind || ':' || external_id),
  CHECK ((state = 'archived') = (archived_at IS NOT NULL)),
  CHECK (state <> 'closed' OR kind = 'typeform'),
  CHECK (state <> 'removed' OR kind = 'webhook')
);

-- Row security, grants, no deletes (2.1).
ALTER TABLE public.cockpit_form_file_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_retire_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_form_file_slots, public.cockpit_payment_receipts, public.cockpit_retire_items
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.cockpit_form_file_slots_id_seq, public.cockpit_payment_receipts_id_seq
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_form_file_slots, public.cockpit_retire_items TO service_role;
GRANT SELECT, INSERT ON public.cockpit_payment_receipts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cockpit_form_file_slots_id_seq, public.cockpit_payment_receipts_id_seq TO service_role;

-- One audit function for the three tables. It names its keys: a slot's hash and a receipt's path are
-- not secrets, but the log keeps only what a reader needs to follow a change.
CREATE OR REPLACE FUNCTION public.cockpit_client_tail_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old jsonb;
  v_new jsonb := to_jsonb(NEW);
  v_keys text[];
  v_before jsonb;
  v_after jsonb;
  v_changed text[];
  v_actor text;
BEGIN
  IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD); END IF;
  v_keys := CASE TG_TABLE_NAME
    WHEN 'cockpit_form_file_slots' THEN ARRAY['invite_id','field_key','mime','bytes','made_via','used_by']
    WHEN 'cockpit_payment_receipts' THEN ARRAY['manual_payment_id','response_id','amount','currency','paid_on','attached_by']
    ELSE ARRAY['state','switch_off_step','off_at','quiet_since','archived_at','backup_path','note'] END;
  IF v_old IS NOT NULL THEN
    SELECT jsonb_object_agg(k, v_old->k) INTO v_before FROM unnest(v_keys) AS k;
  END IF;
  SELECT jsonb_object_agg(k, v_new->k) INTO v_after FROM unnest(v_keys) AS k;
  SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO v_changed
    FROM unnest(v_keys) AS k WHERE v_old IS NULL OR (v_old->k) IS DISTINCT FROM (v_new->k);
  IF v_old IS NOT NULL AND cardinality(v_changed) = 0 THEN
    RETURN NULL;
  END IF;
  SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (coalesce(nullif(current_setting('cockpit.forms_action', true), ''), 'forms.' || TG_TABLE_NAME || '.' || lower(TG_OP)),
          TG_TABLE_NAME, v_new->>'id',
          coalesce(v_actor, nullif(current_setting('cockpit.audit_actor', true), ''), v_new->>'updated_by', session_user::text),
          'client-success', coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'),
          v_before, v_after, jsonb_build_object('op', lower(TG_OP), 'changed', to_jsonb(v_changed)));
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_form_file_slots','cockpit_payment_receipts','cockpit_retire_items'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_client_tail_audit ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_client_tail_audit AFTER INSERT OR UPDATE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.cockpit_client_tail_audit()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_forms_no_delete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_forms_no_delete BEFORE DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_refuse_delete()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_forms_no_truncate ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_forms_no_truncate BEFORE TRUNCATE ON public.%I '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_forms_refuse_delete()', t);
  END LOOP;
END $$;

-- A slot is a promise of one file: its identity never changes, and it is used by one answer once.
CREATE OR REPLACE FUNCTION public.cockpit_form_file_slots_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (to_jsonb(NEW) - 'used_by') IS DISTINCT FROM (to_jsonb(OLD) - 'used_by')
     OR (OLD.used_by IS NOT NULL AND NEW.used_by IS DISTINCT FROM OLD.used_by) THEN
    RAISE EXCEPTION 'A file slot never changes once made; only its first answer is recorded.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cockpit_form_file_slots_guard ON public.cockpit_form_file_slots;
CREATE TRIGGER cockpit_form_file_slots_guard BEFORE UPDATE ON public.cockpit_form_file_slots
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_file_slots_guard();

-- A receipt row never changes either (no UPDATE grant); this keeps the owner honest too.
CREATE OR REPLACE FUNCTION public.cockpit_payment_receipts_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'A payment receipt is never edited; it stays beside its payment.' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS cockpit_payment_receipts_guard ON public.cockpit_payment_receipts;
CREATE TRIGGER cockpit_payment_receipts_guard BEFORE UPDATE ON public.cockpit_payment_receipts
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_payment_receipts_guard();


-- ---------------------------------------------------------------------------
-- 4. New helpers and acts of this file

-- The bank receipt and onboarding rows of the client page's Send panel (3.3 view): listed with why
-- each can or cannot go now. The bank receipt is preset only: Pending payments and Checks waiting open
-- the panel on it with its facts (4.10.5), so the panel never offers it bare.
CREATE OR REPLACE FUNCTION public.cockpit_form_invite_tail_forms(p_task_id text, p_client text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws jsonb := public.cockpit_form_workspace_of(p_task_id);
  p public.cockpit_portal_presence;
  v_forms jsonb := '[]'::jsonb;
  v_templates jsonb := '{}'::jsonb;
  v_key text;
  f public.cockpit_forms;
  v_ver integer;
  v_schema jsonb;
  v_live boolean;
  v_aud text;
  v_why text;
  v_open public.cockpit_form_invites;
  v_words text;
BEGIN
  IF (v_ws->>'n')::integer = 1 THEN
    SELECT * INTO p FROM public.cockpit_portal_presence x WHERE x.location_id = v_ws->>'locationId';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['bank_receipt','onboarding'] LOOP
    SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = v_key;
    CONTINUE WHEN f.key IS NULL;
    v_ver := public.cockpit_form_client_version(v_key);
    v_schema := CASE WHEN v_ver IS NOT NULL THEN (SELECT v.schema FROM public.cockpit_form_versions v
                                                   WHERE v.form_key = v_key AND v.version = v_ver) END;
    v_live := public.cockpit_form_client_live(v_key);
    v_aud := coalesce(v_schema->>'audience', CASE WHEN v_key = 'bank_receipt' THEN 'admin' ELSE 'any' END);
    v_words := CASE v_key WHEN 'bank_receipt' THEN 'A receipt request' ELSE 'An onboarding form' END;
    v_open := NULL;
    SELECT * INTO v_open FROM public.cockpit_form_invites x
     WHERE x.task_id = p_task_id AND x.form_key = v_key AND x.state = 'open' AND x.expires_at > now()
     ORDER BY x.issued_at DESC LIMIT 1;
    v_why := CASE WHEN NOT v_live THEN 'Opens to clients after its switch-on.'
                  ELSE public.cockpit_form_card_allows(p_task_id, v_key) END;
    IF v_why IS NULL AND v_open.id IS NOT NULL THEN
      v_why := v_words || ' is already out to ' || coalesce(p_client, 'this client') || ', sent '
               || public.cockpit_form_day_words(v_open.issued_at) || '. Withdraw it to send a new one.';
    END IF;
    v_forms := v_forms || jsonb_build_array(jsonb_build_object(
      'key', v_key,
      'title', coalesce(v_schema->'title', jsonb_build_object('en', f.title, 'ar', NULL)),
      'live', v_live, 'sendable', v_why IS NULL, 'why', v_why, 'audience', v_aud,
      'defaultChannels', to_jsonb(public.cockpit_form_default_channels(v_aud, v_ws, p)),
      'presetOnly', v_key = 'bank_receipt',
      'presetWhy', CASE WHEN v_key = 'bank_receipt' THEN 'Ask for the receipt from Pending payments or Checks waiting.' END,
      'note', NULL));
    IF jsonb_typeof(v_schema->'invite'->'whatsapp') = 'object' THEN
      v_templates := v_templates || jsonb_build_object(v_key, v_schema->'invite'->'whatsapp');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('forms', v_forms, 'templates', v_templates);
END $$;

-- The build view (unchanged) with the two rows above added.
CREATE OR REPLACE FUNCTION public.cockpit_form_invite_view_with_tail(p_task_id text, p_client text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb := public.cockpit_form_invite_build_view(p_task_id, p_client); t jsonb;
BEGIN
  t := public.cockpit_form_invite_tail_forms(p_task_id, p_client);
  RETURN v || jsonb_build_object('forms', coalesce(v->'forms', '[]'::jsonb) || (t->'forms'),
                                 'templates', coalesce(v->'templates', '{}'::jsonb) || (t->'templates'));
END $$;

-- The file fields of an invite's schema and how many slots each has used (portal_form_get, 3.6).
CREATE OR REPLACE FUNCTION public.cockpit_form_file_slots_state(p_invite public.cockpit_form_invites)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s jsonb := public.cockpit_form_invite_schema(p_invite); v jsonb := '{}'::jsonb; f jsonb; n integer;
BEGIN
  FOR f IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s->'fields') = 'array' THEN s->'fields' ELSE '[]'::jsonb END) x
            WHERE x->>'type' = 'file' LOOP
    SELECT count(*) INTO n FROM public.cockpit_form_file_slots sl WHERE sl.invite_id = p_invite.id AND sl.field_key = f->>'key';
    v := v || jsonb_build_object(f->>'key', jsonb_build_object('made', n, 'left', greatest(0, 5 - n)));
  END LOOP;
  RETURN v;
END $$;

-- One slot for one file the client is about to upload (3.6): every check but the caller's own. The
-- portal server then signs an upload URL for exactly this path (service key, 10 minutes), so the file
-- goes straight to Storage. A file picked again (same hash) gets its slot back.
CREATE OR REPLACE FUNCTION public.cockpit_form_file_slot_make(i public.cockpit_form_invites, p_field text, p_mime text,
  p_bytes bigint, p_sha256 text, p_via text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s jsonb := public.cockpit_form_invite_schema(i);
  f jsonb;
  v_path text;
  v_n integer;
  v_prev text := current_setting('cockpit.forms_action', true);
BEGIN
  IF p_field IS NULL OR p_field !~ '^[a-z][a-zA-Z0-9]{1,30}$' OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
     OR p_mime IS NULL OR p_bytes IS NULL THEN
    RAISE EXCEPTION 'form_file_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT x INTO f FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s->'fields') = 'array' THEN s->'fields' ELSE '[]'::jsonb END) x
   WHERE x->>'key' = p_field LIMIT 1;
  IF f IS NULL OR f->>'type' IS DISTINCT FROM 'file' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_file');
  END IF;
  IF NOT (coalesce(f->'accept', '[]'::jsonb) ? p_mime) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'type');
  END IF;
  IF p_bytes < 1 OR p_bytes > coalesce((f->>'maxBytes')::bigint, 10485760) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'size');
  END IF;
  v_path := 'forms/' || i.id::text || '/' || p_field || '/' || p_sha256 || '.' ||
            CASE p_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp'
                        WHEN 'image/heic' THEN 'heic' ELSE 'pdf' END;
  IF EXISTS (SELECT 1 FROM public.cockpit_form_file_slots x WHERE x.path = v_path) THEN
    RETURN jsonb_build_object('ok', true, 'path', v_path);
  END IF;
  SELECT count(*) INTO v_n FROM public.cockpit_form_file_slots x WHERE x.invite_id = i.id AND x.field_key = p_field;
  IF v_n >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'slots',
      'sentence', 'You can replace the file 4 times. Ask your account manager for a new link.');
  END IF;
  PERFORM set_config('cockpit.forms_action', 'forms.file_slot', true);
  INSERT INTO public.cockpit_form_file_slots(invite_id, field_key, path, mime, bytes, sha256, made_via)
  VALUES (i.id, p_field, v_path, p_mime, p_bytes, p_sha256, p_via);
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev, ''), true);
  RETURN jsonb_build_object('ok', true, 'path', v_path);
END $$;

-- The portal's slot (service_role): the workspace checks of portal_form_get.
CREATE OR REPLACE FUNCTION public.portal_form_file_slot(p_location_id text, p_clickup_id text, p_person text, p_access_role text,
  p_invite_id uuid, p_field text, p_mime text, p_bytes bigint, p_sha256 text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_person text := public.portal_client_ask_person(p_person); i public.cockpit_form_invites; v_state text;
BEGIN
  PERFORM public.cockpit_form_portal_workspace(p_location_id, p_clickup_id);
  PERFORM public.cockpit_form_invites_expire();
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = p_invite_id;
  IF i.id IS NULL OR i.origin = 'canary' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF i.task_id <> p_clickup_id OR i.location_id IS DISTINCT FROM p_location_id THEN
    RAISE EXCEPTION 'form_invite_not_in_workspace' USING ERRCODE = '42501';
  END IF;
  -- The audience of portal_form_get: an admin-only invite (the bank receipt) takes files from an admin only.
  IF i.audience = 'admin' AND p_access_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'admin_only');
  END IF;
  v_state := public.cockpit_form_invite_state(i);
  IF v_state <> 'open' THEN RETURN jsonb_build_object('ok', false, 'reason', v_state); END IF;
  IF public.cockpit_form_card_allows(i.task_id, i.form_key) IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'withdrawn'); END IF;
  IF NOT public.cockpit_form_client_live(i.form_key) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_live'); END IF;
  PERFORM set_config('cockpit.audit_source', 'portal', true);
  PERFORM set_config('cockpit.audit_actor', 'portal', true);
  RETURN public.cockpit_form_file_slot_make(i, p_field, p_mime, p_bytes, p_sha256, 'portal');
END $$;

-- The link page's slot (service_role): the token checks and rate limits of portal_form_token_open,
-- logged the same way (one cockpit_form_token_opens row per call).
CREATE OR REPLACE FUNCTION public.portal_form_token_file_slot(p_token_sha256 text, p_net_hash text, p_browser_hash text,
  p_field text, p_mime text, p_bytes bigint, p_sha256 text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb; i public.cockpit_form_invites; v_reason text; v_out jsonb;
BEGIN
  IF p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$' OR p_net_hash IS NULL OR p_net_hash !~ '^[0-9a-f]{64}$'
     OR (p_browser_hash IS NOT NULL AND p_browser_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'form_token_invalid' USING ERRCODE = '22023';
  END IF;
  IF public.cockpit_form_token_limited(p_net_hash, p_browser_hash) THEN
    PERFORM public.cockpit_form_token_limited_note(p_net_hash, p_browser_hash);
    RETURN jsonb_build_object('ok', false, 'reason', 'limited');
  END IF;
  PERFORM public.cockpit_form_invites_expire();
  v := public.cockpit_form_token_find(p_token_sha256);
  v_reason := v->>'reason';
  INSERT INTO public.cockpit_form_token_opens(net_hash, browser_hash, outcome, token_id)
  VALUES (p_net_hash, p_browser_hash, CASE WHEN v_reason IS NULL THEN 'ok' WHEN v_reason = 'answered' THEN 'used' ELSE v_reason END,
          (v->>'tokenId')::bigint);
  IF v_reason IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = (v->>'inviteId')::uuid;
  PERFORM set_config('cockpit.audit_source', 'portal', true);
  PERFORM set_config('cockpit.audit_actor', 'link', true);
  v_out := public.cockpit_form_file_slot_make(i, p_field, p_mime, p_bytes, p_sha256,
                                              CASE WHEN i.origin = 'canary' THEN 'canary' ELSE 'token' END);
  RETURN v_out;
END $$;

-- An answer uses its slots: each file answer of a stored client answer must be a slot of that very
-- invite (the answer check matched the form and the invite's facts; this pins the invite), and the
-- slot records the answer once.
CREATE OR REPLACE FUNCTION public.cockpit_form_file_slots_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f jsonb; v_path text; v_n integer;
BEGIN
  FOR f IN SELECT x FROM public.cockpit_form_versions fv,
                  jsonb_array_elements(CASE WHEN jsonb_typeof(fv.schema->'fields') = 'array' THEN fv.schema->'fields' ELSE '[]'::jsonb END) x
            WHERE fv.form_key = NEW.form_key AND fv.version = NEW.form_version AND x->>'type' = 'file' LOOP
    v_path := NEW.answers->(f->>'key')->>'path';
    CONTINUE WHEN v_path IS NULL;
    UPDATE public.cockpit_form_file_slots s SET used_by = NEW.id
     WHERE s.path = v_path AND s.invite_id = NEW.invite_id AND s.field_key = f->>'key' AND s.used_by IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'form_file_not_this_invite' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS cockpit_form_file_slots_claim ON public.cockpit_form_responses;
CREATE TRIGGER cockpit_form_file_slots_claim AFTER INSERT ON public.cockpit_form_responses
  FOR EACH ROW WHEN (NEW.invite_id IS NOT NULL) EXECUTE FUNCTION public.cockpit_form_file_slots_claim();

-- A staff seat's view of one stored file (4.10.4): the gate of cockpit_form_answer_read (finance too,
-- since finance checks receipts), then the object for the forms door to sign for 5 minutes.
CREATE OR REPLACE FUNCTION public.cockpit_form_file_read(p_response_id uuid, p_field text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_form_actor();
  r public.cockpit_form_responses;
  f public.cockpit_forms;
  s jsonb;
  v jsonb;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = r.form_key;
  IF r.id IS NULL OR f.audience IS DISTINCT FROM 'client' OR r.state NOT IN ('submitted','confirmed','legacy')
     OR (r.mode = 'shadow' AND r.task_id IS DISTINCT FROM '86eywg1cq') THEN
    RAISE EXCEPTION 'There is no client answer with that ID.' USING ERRCODE = '22023';
  END IF;
  IF NOT (coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'admin')::boolean, false)
          OR coalesce(public.cockpit_has_role('finance'), false)) THEN
    IF r.task_id IS NULL THEN
      RAISE EXCEPTION 'That answer is not matched to a client yet. Pick its card in the churn tracker.' USING ERRCODE = '42501';
    END IF;
    PERFORM public.cockpit_csm_client_gate(r.task_id);
  END IF;
  SELECT fv.schema INTO s FROM public.cockpit_form_versions fv WHERE fv.form_key = r.form_key AND fv.version = r.form_version;
  v := r.answers -> p_field;
  IF p_field IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT (v ? 'path')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s->'fields') = 'array' THEN s->'fields' ELSE '[]'::jsonb END) x
                     WHERE x->>'key' = p_field AND x->>'type' = 'file') THEN
    RAISE EXCEPTION 'That answer has no file there.' USING ERRCODE = '22023';
  END IF;
  -- The path must be a slot this response used, made for an invite of the same card: the read itself
  -- guarantees a seat sees only its own client's files, whatever wrote the answer.
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_form_file_slots sl JOIN public.cockpit_form_invites iv ON iv.id = sl.invite_id
                  WHERE sl.path = v->>'path' AND sl.used_by = r.id AND iv.task_id IS NOT DISTINCT FROM r.task_id) THEN
    RAISE EXCEPTION 'That answer has no file there.' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('path', v->>'path', 'mime', v->>'mime', 'bytes', (v->>'bytes')::bigint,
                            'name', v->>'name', 'bucket', 'cockpit-form-files');
END $$;

-- ---------------------------------------------------------------------------
-- 5. The bank receipt (4.10)

-- Its issue rule (3.6): the context the Pending payments part or the Checks waiting row sends. The
-- keys are already limited by issue; this checks their values and the named transfer.
CREATE OR REPLACE FUNCTION public.cockpit_form_issue_hook_bank_receipt(p_invite_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.cockpit_form_invites; c jsonb; mp public.cockpit_manual_payments; v_due date;
BEGIN
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = p_invite_id;
  c := i.context;
  IF i.origin NOT IN ('billing','canary') THEN
    RAISE EXCEPTION 'Ask for the receipt from Pending payments or Checks waiting.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(c->'part') IS DISTINCT FROM 'string' OR c->>'part' NOT IN ('deposit','onboarding','later','all','payment') THEN
    RAISE EXCEPTION 'Say which payment the receipt is for.' USING ERRCODE = '22023';
  END IF;
  IF c ? 'partNo' AND c->'partNo' <> 'null'::jsonb
     AND (jsonb_typeof(c->'partNo') <> 'number' OR (c->>'partNo') !~ '^[1-9][0-9]?$') THEN
    RAISE EXCEPTION 'The part number is a whole number from 1.' USING ERRCODE = '22023';
  END IF;
  -- The amount due and its currency are sent only when the card's billing currency is known (5.6):
  -- never a figure converted to dollars for a client who pays in dinars.
  IF c ? 'expectedAmount' AND c->'expectedAmount' <> 'null'::jsonb
     AND (jsonb_typeof(c->'expectedAmount') <> 'number' OR (c->>'expectedAmount')::numeric <= 0
          OR (c->>'expectedAmount')::numeric > 1000000) THEN
    RAISE EXCEPTION 'Send the amount due, above 0.' USING ERRCODE = '22023';
  END IF;
  IF c ? 'currency' AND c->'currency' <> 'null'::jsonb
     AND (jsonb_typeof(c->'currency') <> 'string' OR c->>'currency' NOT IN ('USD','KWD')) THEN
    RAISE EXCEPTION 'The currency is USD or KWD.' USING ERRCODE = '22023';
  END IF;
  IF c ? 'expectedAmount' AND c->'expectedAmount' <> 'null'::jsonb AND NOT (c ? 'currency' AND c->'currency' <> 'null'::jsonb) THEN
    RAISE EXCEPTION 'Send the currency with the amount due.' USING ERRCODE = '22023';
  END IF;
  IF c ? 'dueOn' AND c->'dueOn' <> 'null'::jsonb THEN
    BEGIN
      v_due := (c->>'dueOn')::date;
    EXCEPTION WHEN OTHERS THEN v_due := NULL;
    END;
    IF v_due IS NULL OR jsonb_typeof(c->'dueOn') <> 'string' THEN
      RAISE EXCEPTION 'The due day is a date.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF c ? 'dealResponseId' AND c->'dealResponseId' <> 'null'::jsonb
     AND (jsonb_typeof(c->'dealResponseId') <> 'string' OR char_length(c->>'dealResponseId') NOT BETWEEN 1 AND 200) THEN
    RAISE EXCEPTION 'Send the deal as its id.' USING ERRCODE = '22023';
  END IF;
  IF c ? 'manualPaymentId' AND c->'manualPaymentId' <> 'null'::jsonb THEN
    IF jsonb_typeof(c->'manualPaymentId') <> 'string' THEN
      RAISE EXCEPTION 'That transfer is not a logged bank transfer of this client.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO mp FROM public.cockpit_manual_payments x WHERE x.id = c->>'manualPaymentId';
    IF mp.id IS NULL OR mp.clickup_task_id IS DISTINCT FROM i.task_id OR mp.rail <> 'bank_transfer'
       OR mp.check_state <> 'logged' OR mp.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'That transfer is not a logged bank transfer of this client.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.cockpit_payment_receipts r WHERE r.manual_payment_id = mp.id)
       OR EXISTS (SELECT 1 FROM public.cockpit_billing_inbox b
                   WHERE mp.source_deployment = 'billing-inbox' AND b.id::text = mp.source_id AND b.response_id IS NOT NULL) THEN
      RAISE EXCEPTION 'This transfer already has its receipt.' USING ERRCODE = '22023';
    END IF;
  END IF;
END $$;

-- A stored receipt answer (4.10.3). Never a card change, never cash, LTV or pay until a check.
CREATE OR REPLACE FUNCTION public.cockpit_form_hook_bank_receipt(p_response_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_form_responses;
  i public.cockpit_form_invites;
  v_amount numeric;
  v_currency text;
  v_paid date;
  v_ref text;
  v_path text;
  v_mp text;
  v_hits text[];
  v_canary boolean;
  v_inbox bigint;
  v_how text;
  v_prev text := current_setting('cockpit.forms_action', true);
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = r.invite_id;
  IF r.id IS NULL OR i.id IS NULL OR r.form_key <> 'bank_receipt' THEN
    RAISE EXCEPTION 'There is no receipt answer with that ID.' USING ERRCODE = '22023';
  END IF;
  v_canary := i.origin = 'canary';
  v_amount := round((r.answers->>'amount')::numeric, 3);
  v_currency := upper(r.answers->>'currency');
  v_paid := (r.answers->>'paidOn')::date;
  v_ref := nullif(btrim(coalesce(r.answers->>'reference', '')), '');
  v_path := r.answers->'receipt'->>'path';
  v_mp := nullif(i.context->>'manualPaymentId', '');

  PERFORM set_config('cockpit.forms_action', 'forms.receipt_in', true);
  -- The transfer the invite named, checked again now: deleted, rejected or given a receipt since the
  -- invite went out (a second invite, a near match, a twin) and it is not attached; the answer then
  -- takes the near-match or inbox path below like any other.
  IF v_mp IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.cockpit_manual_payments p
        WHERE p.id = v_mp AND p.clickup_task_id = i.task_id AND p.deleted_at IS NULL AND p.check_state IN ('logged','checked')
          AND NOT EXISTS (SELECT 1 FROM public.cockpit_payment_receipts x WHERE x.manual_payment_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_inbox b
                           WHERE p.source_deployment = 'billing-inbox' AND b.id::text = p.source_id AND b.response_id IS NOT NULL)) THEN
    v_mp := NULL;
  END IF;
  IF v_mp IS NOT NULL THEN
    -- The transfer the CSM named: the receipt sits beside it (X11), no inbox row.
    INSERT INTO public.cockpit_payment_receipts(manual_payment_id, response_id, path, amount, currency, paid_on, reference, attached_by)
    VALUES (v_mp, r.id, v_path, v_amount, v_currency, v_paid, v_ref, 'invite')
    ON CONFLICT DO NOTHING;
    v_how := 'attached';
  ELSE
    -- The same transfer logged by the agent or a CSM: one logged transfer on the card, same currency,
    -- within 1% of the answer and 3 days of its day, with no receipt yet.
    SELECT coalesce(array_agg(p.id ORDER BY p.added_at, p.id), '{}') INTO v_hits
      FROM public.cockpit_manual_payments p
     WHERE NOT v_canary AND p.clickup_task_id = i.task_id AND p.rail = 'bank_transfer' AND p.check_state = 'logged'
       AND p.deleted_at IS NULL AND p.currency = v_currency
       AND abs(p.amount - v_amount) <= 0.01 * v_amount AND abs(p.day - v_paid) <= 3
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_payment_receipts x WHERE x.manual_payment_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_inbox b
                        WHERE p.source_deployment = 'billing-inbox' AND b.id::text = p.source_id AND b.response_id IS NOT NULL);
    IF cardinality(v_hits) = 1 THEN
      INSERT INTO public.cockpit_payment_receipts(manual_payment_id, response_id, path, amount, currency, paid_on, reference, attached_by)
      VALUES (v_hits[1], r.id, v_path, v_amount, v_currency, v_paid, v_ref, 'near_match')
      ON CONFLICT DO NOTHING;
      v_how := 'attached';
    ELSE
      -- A transfer nobody logged yet: one inbox row, which ingest takes in as logged (W12 CK). A canary
      -- answer's row is rejected at once, so ingest never takes it in.
      INSERT INTO public.cockpit_billing_inbox(clickup_task_id, client_name, paid_on, amount, currency, method, reference,
        evidence_url, note, source, logged_by, status, status_note, settled_at, check_state, response_id)
      VALUES (i.task_id, i.client_name, v_paid, v_amount, v_currency, 'bank_transfer', v_ref,
              'storage://cockpit-form-files/' || v_path,
              CASE WHEN r.source = 'portal' THEN 'Receipt sent by the client in the portal' ELSE 'Receipt sent by the client by link' END,
              'portal', 'the client',
              CASE WHEN v_canary THEN 'rejected' ELSE 'pending' END,
              CASE WHEN v_canary THEN 'Canary on the test card' END,
              CASE WHEN v_canary THEN now() END,
              CASE WHEN v_canary THEN 'rejected' ELSE 'logged' END,
              r.id)
      ON CONFLICT (response_id) WHERE response_id IS NOT NULL DO NOTHING
      RETURNING id INTO v_inbox;
      v_how := 'inbox';
      IF v_inbox IS NOT NULL THEN
        INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
        VALUES ('billingInbox.portal_receipt', 'cockpit_billing_inbox', v_inbox::text, 'the client', 'client-success', 'portal', NULL,
                jsonb_build_object('amount', v_amount, 'currency', v_currency, 'paid_on', v_paid, 'status',
                                   CASE WHEN v_canary THEN 'rejected' ELSE 'pending' END),
                jsonb_build_object('response_id', r.id, 'invite_id', i.id, 'canary', v_canary));
      END IF;
    END IF;
  END IF;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev, ''), true);

  -- "Receipt in" for #csm-general (3.9). A notice that cannot be queued never undoes the answer.
  BEGIN
    PERFORM public.cockpit_slack_notice_queue('receipt.in', 'receipt:' || r.id::text, i.task_id, i.client_name,
      jsonb_build_object('taskId', i.task_id, 'client', i.client_name, 'responseId', r.id, 'amount', v_amount,
                         'currency', v_currency, 'day', v_paid, 'how', v_how),
      NULL, 'queued', NULL);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_slack_notice_queue_failed('A receipt notice could not be queued: ' || SQLERRM);
  END;
END $$;

-- Ingest marked a portal row duplicate (an exact twin was already logged, W12 CK): the receipt goes on
-- that twin, so Checks waiting shows the twin with its receipt (4.10.3). Ingest itself is unchanged.
CREATE OR REPLACE FUNCTION public.cockpit_billing_inbox_portal_twin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_prev text := current_setting('cockpit.forms_action', true);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_manual_payments p WHERE p.id = NEW.ledger_id) THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('cockpit.forms_action', 'forms.receipt_twin', true);
  INSERT INTO public.cockpit_payment_receipts(manual_payment_id, response_id, path, amount, currency, paid_on, reference, attached_by)
  VALUES (NEW.ledger_id, NEW.response_id, regexp_replace(coalesce(NEW.evidence_url, ''), '^storage://cockpit-form-files/', ''),
          NEW.amount, NEW.currency, NEW.paid_on, left(NEW.reference, 60), 'twin')
  ON CONFLICT DO NOTHING;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev, ''), true);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS cockpit_billing_inbox_portal_twin ON public.cockpit_billing_inbox;
CREATE TRIGGER cockpit_billing_inbox_portal_twin AFTER UPDATE OF status ON public.cockpit_billing_inbox
  FOR EACH ROW WHEN (NEW.source = 'portal' AND NEW.status = 'duplicate' AND NEW.response_id IS NOT NULL AND NEW.ledger_id IS NOT NULL)
  EXECUTE FUNCTION public.cockpit_billing_inbox_portal_twin();

-- The receipt of one logged payment for Checks waiting: attached beside it, or the one its inbox row
-- carried. Never the storage path's signature: the forms door signs on View the receipt.
CREATE OR REPLACE FUNCTION public.cockpit_manual_payment_receipt(p_payment_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb; x record;
BEGIN
  SELECT r.response_id, r.amount, r.currency, r.paid_on, r.reference, r.attached_by, rs.answers->'receipt' AS f, rs.source
    INTO x
    FROM public.cockpit_payment_receipts r JOIN public.cockpit_form_responses rs ON rs.id = r.response_id
   WHERE r.manual_payment_id = p_payment_id ORDER BY r.id DESC LIMIT 1;
  IF x.response_id IS NULL THEN
    SELECT b.response_id, b.amount, b.currency, b.paid_on, b.reference, 'inbox'::text AS attached_by, rs.answers->'receipt' AS f, rs.source
      INTO x
      FROM public.cockpit_manual_payments p
      JOIN public.cockpit_billing_inbox b ON p.source_deployment = 'billing-inbox' AND b.id::text = p.source_id
      JOIN public.cockpit_form_responses rs ON rs.id = b.response_id
     WHERE p.id = p_payment_id;
  END IF;
  IF x.response_id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('responseId', x.response_id, 'field', 'receipt', 'mime', x.f->>'mime',
    'bytes', (x.f->>'bytes')::bigint, 'name', x.f->>'name', 'amount', x.amount, 'currency', x.currency,
    'paidOn', x.paid_on, 'reference', x.reference, 'attachedBy', x.attached_by,
    'via', CASE x.source WHEN 'portal' THEN 'portal' ELSE 'link' END,
    'viewable', coalesce(x.f->>'mime', '') <> 'image/heic');
END $$;

-- "May be the same transfer as {date} {amount}" (4.10.3): a portal row taken in as its own payment
-- while another logged transfer of the card is within 3 days and 1%.
CREATE OR REPLACE FUNCTION public.cockpit_manual_payment_near_match(p public.cockpit_manual_payments)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o public.cockpit_manual_payments;
BEGIN
  IF p.rail <> 'bank_transfer' OR p.source_deployment IS DISTINCT FROM 'billing-inbox' OR NOT EXISTS (
       SELECT 1 FROM public.cockpit_billing_inbox b WHERE b.id::text = p.source_id AND b.source = 'portal') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO o FROM public.cockpit_manual_payments x
   WHERE x.id <> p.id AND x.clickup_task_id = p.clickup_task_id AND x.rail = 'bank_transfer' AND x.deleted_at IS NULL
     AND x.check_state IN ('logged','checked') AND x.currency = p.currency
     AND abs(x.amount - p.amount) <= 0.01 * p.amount AND abs(x.day - p.day) <= 3
   ORDER BY abs(x.day - p.day), x.added_at, x.id LIMIT 1;
  IF o.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id', o.id, 'day', o.day, 'amount', o.amount, 'currency', o.currency,
    'sentence', 'May be the same transfer as ' || public.cockpit_billing_day_words(o.day) || ' '
                || regexp_replace(to_char(o.amount, 'FM999,999,990.000'), '\.?0+$', '') || ' ' || o.currency);
END $$;

-- ---------------------------------------------------------------------------
-- 6. Reactivate (4.12): Client is back

CREATE OR REPLACE FUNCTION public.cockpit_client_reactivate(p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_who text;
  v_ceo boolean;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_task text;
  v_req uuid;
  v_test boolean;
  v_acc public.cockpit_billing_accounts;
  v_client text;
  v_dep public.cockpit_churn_departures;
  v_first public.cockpit_billing_events;
  v_dep_id bigint;
  v_return date;
  v_status text;
  v_why text;
  v_next date;
  v_mrr numeric;
  v_agree text;
  v_call text;
  v_seat text;
  v_role text;
  v_event bigint;
  v_mrr_event bigint;
  v_resp uuid;
  v_win uuid;
  v_person bigint;
  v_card text;
  v_answers jsonb;
  v_detail jsonb;
  v_marker boolean;
  v_type_words text;
  v_prev_action text := current_setting('cockpit.forms_action', true);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in before reopening a client.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR octet_length(p_args::text) > 12000 THEN
    RAISE EXCEPTION 'That form could not be read. Reload the page and send it again.' USING ERRCODE = '22023';
  END IF;
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT (v_ceo OR coalesce(public.cockpit_has_role('csm'), false)) THEN
    RAISE EXCEPTION 'Reopening a client needs a client success or CEO seat. Ask an admin to add the role.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(u.email)) INTO v_who FROM auth.users u WHERE u.id = v_uid;

  v_task := btrim(coalesce(p_args->>'taskId', ''));
  IF v_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN RAISE EXCEPTION 'That is not a ClickUp card id.' USING ERRCODE = '22023'; END IF;
  BEGIN
    v_req := (p_args->>'requestId')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN v_req := NULL;
  END;
  IF v_req IS NULL THEN
    RAISE EXCEPTION 'That form could not be read. Reload the page and send it again.' USING ERRCODE = '22023';
  END IF;
  v_test := v_task = '86eywg1cq';
  v_marker := coalesce((SELECT s.value->>'reactivate' = 'true' FROM public.cockpit_settings s WHERE s.key = 'forms.doors'), false);
  IF NOT v_marker AND NOT v_test THEN
    RAISE EXCEPTION 'Reactivate opens after its switch-on.' USING ERRCODE = '22023';
  END IF;

  -- One press at a time per card; the second waits, then finds the first.
  SELECT * INTO v_acc FROM public.cockpit_billing_accounts WHERE clickup_task_id = v_task FOR UPDATE;
  IF NOT FOUND AND NOT v_test THEN
    RAISE EXCEPTION 'That client card is not on the billing sheet. Refresh the page and pick it again.' USING ERRCODE = 'P0002';
  END IF;
  v_client := coalesce(nullif(btrim(v_acc.client_name), ''), CASE WHEN v_test THEN 'Test card' END);
  IF NOT v_ceo AND NOT coalesce(public.cockpit_client_allowed(v_client), false) THEN
    RAISE EXCEPTION '% is not one of your clients. Ask its CSM or the CEO to reopen them.', v_client USING ERRCODE = '42501';
  END IF;

  -- A repeat of the same press returns the first result and writes nothing.
  SELECT * INTO v_first FROM public.cockpit_billing_events e
   WHERE e.clickup_task_id = v_task AND e.kind = 'reactivate' AND e.detail->>'request_id' = v_req::text
   ORDER BY e.id LIMIT 1;
  IF FOUND THEN
    SELECT q.state INTO v_card FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key = 'billing:' || v_first.id;
    RETURN jsonb_build_object('eventId', v_first.id, 'departureId', (v_first.detail->>'departure_id')::bigint,
      'winId', v_first.detail->>'win_id', 'responseId', v_first.detail->>'response_id',
      'cardState', CASE WHEN v_card IS NULL THEN 'none' WHEN v_card = 'dry_run' THEN 'held' ELSE v_card END,
      'sentence', 'Reopened. The card updates within a few minutes.', 'repeat', true);
  END IF;

  -- A confirmed departure that has not returned (X30): the register keeps the month they left.
  IF p_args ? 'departureId' AND jsonb_typeof(p_args->'departureId') = 'number' AND (p_args->>'departureId') ~ '^[0-9]{1,18}$' THEN
    v_dep_id := (p_args->>'departureId')::bigint;
  END IF;
  SELECT * INTO v_dep FROM public.cockpit_churn_departures d
   WHERE d.id = v_dep_id AND d.clickup_task_id = v_task AND d.removed_at IS NULL FOR UPDATE;
  IF v_dep.id IS NULL OR v_dep.confirmed_at IS NULL OR v_dep.returned_on IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.cockpit_churn_departures d
                    WHERE d.clickup_task_id = v_task AND d.removed_at IS NULL AND d.confirmed_at IS NOT NULL AND d.returned_on IS NULL) THEN
      IF v_acc.client_status = 'Stopped' THEN
        RAISE EXCEPTION '% has no confirmed churn. Confirm the churn first with Client is leaving, then reopen.', v_client
          USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION '% is not marked as left. Nothing to reactivate.', v_client USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'That departure is not the one to reopen. Reload the client and try again.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_return := (p_args->>'returnOn')::date;
  EXCEPTION WHEN OTHERS THEN v_return := NULL;
  END;
  IF v_return IS NULL OR v_return < v_dep.left_on OR v_return > v_today + 14 THEN
    RAISE EXCEPTION 'The return date is on or after the day they left, and within 14 days from now.' USING ERRCODE = '22023';
  END IF;
  v_status := p_args->>'status';
  IF v_status IS NULL OR v_status NOT IN ('Active','Onboarding Booked') THEN
    RAISE EXCEPTION 'Pick Active, or Onboarding again.' USING ERRCODE = '22023';
  END IF;
  v_why := btrim(regexp_replace(coalesce(p_args->>'why', ''), '\s+', ' ', 'g'));
  IF char_length(v_why) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'Say why they came back in 10 to 500 characters.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_args->>'nextPaymentDate', '')), '') IS NOT NULL THEN
    BEGIN
      v_next := (p_args->>'nextPaymentDate')::date;
    EXCEPTION WHEN OTHERS THEN v_next := NULL;
    END;
    IF v_next IS NULL OR v_next < v_return OR v_next > v_today + 400 THEN
      RAISE EXCEPTION 'Pick the next payment day on or after the return day.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_args ? 'mrrUsd' AND p_args->'mrrUsd' <> 'null'::jsonb THEN
    IF jsonb_typeof(p_args->'mrrUsd') IS DISTINCT FROM 'number' OR (p_args->>'mrrUsd')::numeric < 0
       OR (p_args->>'mrrUsd')::numeric > 100000 THEN
      RAISE EXCEPTION 'Type the MRR in dollars, 0 or more.' USING ERRCODE = '22023';
    END IF;
    v_mrr := round((p_args->>'mrrUsd')::numeric, 2);
  END IF;
  v_agree := nullif(btrim(coalesce(p_args->>'agreementUrl', '')), '');
  IF v_agree IS NOT NULL AND (v_agree !~ '^https://[^\s]+$' OR char_length(v_agree) > 1000) THEN
    RAISE EXCEPTION 'The agreement link starts with https://.' USING ERRCODE = '22023';
  END IF;
  v_call := nullif(left(btrim(coalesce(p_args->>'callId', '')), 200), '');

  v_seat := CASE WHEN v_ceo THEN 'ceo' ELSE 'csm' END;
  v_role := CASE WHEN v_ceo THEN 'the CEO' ELSE coalesce(public.cockpit_slack_notice_role_of(v_who), 'the CSM') END;
  v_type_words := CASE v_dep.churn_type WHEN 'mid_programme' THEN 'mid-programme' WHEN 'completed' THEN 'completed term'
                                        ELSE coalesce(v_dep.churn_type, 'type not set') END;

  -- The staff form's record: one response per request id (the forms pages read it).
  v_answers := jsonb_strip_nulls(jsonb_build_object(
    'departureId', v_dep.id, 'returnOn', v_return, 'status', v_status, 'nextPaymentDate', v_next, 'mrrUsd', v_mrr,
    'agreementUrl', v_agree, 'why', v_why, 'callId', v_call));
  PERFORM set_config('cockpit.forms_action', 'forms.staff_recorded', true);
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
    answers, created_by, created_by_id, submitted_by, submitted_at, confirmed_by, confirmed_at)
  VALUES ('reactivate', (SELECT f.version FROM public.cockpit_forms f WHERE f.key = 'reactivate'), 'cockpit', 'req:' || v_req::text,
          v_task, v_client, CASE WHEN v_test THEN 'shadow' ELSE 'live' END, 'confirmed',
          v_answers, v_who, v_uid, v_who, now(), v_who, now())
  ON CONFLICT (form_key, external_id) DO NOTHING
  RETURNING id INTO v_resp;
  IF v_resp IS NULL THEN
    SELECT r.id INTO v_resp FROM public.cockpit_form_responses r WHERE r.form_key = 'reactivate' AND r.external_id = 'req:' || v_req::text;
  END IF;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);

  -- The reactivation win: one per departure (the unique index of 20261102h), its pay waits for proof.
  SELECT p.id INTO v_person FROM public.cockpit_people p
   WHERE v_acc.csm IS NOT NULL
     AND lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(v_acc.csm), '\s+', ' ', 'g'))
   ORDER BY p.active DESC, p.id LIMIT 1;
  -- A reactivation the CSM already logged by hand for this return (within 60 days) becomes this
  -- return's win: it is attached to the departure, never doubled (4.3.6), so one return pays once.
  SELECT w.id INTO v_win FROM public.cockpit_csm_wins w
   WHERE w.task_id = v_task AND w.kind = 'reactivation' AND w.stage <> 'void' AND w.departure_id IS NULL
     AND w.won_on >= v_return - 60
   ORDER BY w.won_on DESC, w.logged_at DESC LIMIT 1;
  IF v_win IS NOT NULL THEN
    PERFORM set_config('cockpit.win_act', 'reactivate_attach', true);
    PERFORM set_config('cockpit.wins_action', 'wins.reactivate_attached', true);
    UPDATE public.cockpit_csm_wins SET departure_id = v_dep.id, agreement_url = coalesce(agreement_url, v_agree) WHERE id = v_win;
    PERFORM set_config('cockpit.win_act', '', true);
    PERFORM set_config('cockpit.wins_action', '', true);
    INSERT INTO public.cockpit_csm_win_events(win_id, event, by_role, by_email, detail)
    VALUES (v_win, 'proof_added', v_role, v_who,
            jsonb_build_object('source', 'reactivate', 'departure_id', v_dep.id, 'attached', true, 'agreement', v_agree IS NOT NULL));
  ELSE
    BEGIN
      INSERT INTO public.cockpit_csm_wins(request_id, task_id, client_name, kind, stage, won_on, agreement_url, departure_id,
        csm_person_id, note, source, logged_by, logged_by_email, logged_by_role)
      VALUES (md5('reactivate-win:' || v_req::text)::uuid, v_task, v_client, 'reactivation', 'logged', least(v_return, v_today),
              v_agree, v_dep.id, v_person, 'Reopened with Client is back.', 'reactivate', v_uid, v_who, v_role)
      RETURNING id INTO v_win;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'This return already has its reactivation win.' USING ERRCODE = '22023';
    END;
    INSERT INTO public.cockpit_csm_win_events(win_id, event, by_role, by_email, detail)
    VALUES (v_win, 'logged', v_role, v_who, jsonb_build_object('source', 'reactivate', 'departure_id', v_dep.id));
  END IF;

  -- The card write (3.5): status back, churn fields cleared, the old churn in the comment. Held until D-RA.
  v_detail := jsonb_strip_nulls(jsonb_build_object(
    'return_on', v_return, 'status', v_status, 'departure_id', v_dep.id, 'left_on', v_dep.left_on,
    'reason_was', v_dep.reason, 'type_was', v_type_words, 'next_date', v_next, 'why', v_why, 'call_id', v_call,
    'seat_role', v_seat, 'request_id', v_req, 'response_id', v_resp, 'win_id', v_win));
  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (v_task, v_client, 'reactivate', v_acc.client_status, v_status, left(v_why, 140), v_detail, v_seat, v_who)
  RETURNING id INTO v_event;

  PERFORM set_config('cockpit.reactivate', v_dep.id::text, true);
  UPDATE public.cockpit_churn_departures SET returned_on = v_return, return_event_id = v_event, returned_by = v_who,
         updated_by = v_who, updated_at = now()
   WHERE id = v_dep.id;
  PERFORM set_config('cockpit.reactivate', '', true);

  -- The MRR they come back on, when it differs from the card (3.5 detail, category reactivation).
  IF v_mrr IS NOT NULL AND v_mrr IS DISTINCT FROM v_acc.mrr_usd AND NOT (v_mrr = 0 AND coalesce(v_acc.mrr_usd, 0) = 0) THEN
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_task, v_client, 'mrr', trim_scale(v_acc.mrr_usd)::text, trim_scale(v_mrr)::text, 'Reactivated: ' || left(v_why, 140),
            jsonb_build_object('from', v_acc.mrr_usd, 'to', v_mrr, 'reason_cat', 'reactivation',
                               'reason', 'Reactivated: ' || left(v_why, 140), 'effective', v_return, 'win_id', v_win,
                               'seat_role', v_seat,
                               -- One request, one event (20261101p): the MRR event carries its own id, made from the press's.
                               'request_id', md5('reactivate-mrr:' || v_req::text)::uuid, 'reactivate_request_id', v_req),
            v_seat, v_who)
    RETURNING id INTO v_mrr_event;
  END IF;

  -- The mirror follows the decision until the card confirms it (as the churn confirm does).
  UPDATE public.cockpit_billing_accounts SET
    client_status = v_status, stage = v_status, stage_group = CASE WHEN v_status = 'Active' THEN 'active' ELSE 'pipeline' END,
    churn_date = NULL, paused_on = NULL, next_payment_date = coalesce(v_next, next_payment_date),
    mrr_usd = CASE WHEN v_mrr_event IS NOT NULL THEN v_mrr ELSE mrr_usd END,
    source = v_seat, synced_at = now()
  WHERE clickup_task_id = v_task;

  BEGIN
    PERFORM public.cockpit_slack_notice_queue('client.reactivated', 'reactivate:' || v_event, v_task, v_client,
      jsonb_build_object('taskId', v_task, 'client', v_client, 'eventId', v_event, 'status', v_status,
                         'leftOn', v_dep.left_on),
      NULL, CASE WHEN v_test THEN 'skipped' ELSE 'queued' END, CASE WHEN v_test THEN 'Canary on the test card: not posted' END);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_slack_notice_queue_failed('A reactivation notice could not be queued: ' || SQLERRM);
  END;

  INSERT INTO public.cockpit_churn_log(by_whom, what, detail)
  VALUES (v_who, 'reopened ' || v_client,
          jsonb_build_object('client', v_client, 'departureId', v_dep.id, 'eventId', v_event, 'winId', v_win,
                             'responseId', v_resp, 'returnOn', v_return, 'status', v_status));
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('churn.reactivate', 'cockpit_churn_departures', v_dep.id::text, v_who,
          CASE WHEN v_ceo THEN 'media-buyer-cockpit' ELSE 'client-success-cockpit' END, 'supabase',
          jsonb_build_object('returned_on', NULL, 'client_status', v_acc.client_status, 'mrr_usd', v_acc.mrr_usd),
          jsonb_build_object('returned_on', v_return, 'client_status', v_status),
          jsonb_build_object('event_id', v_event, 'mrr_event_id', v_mrr_event, 'win_id', v_win, 'response_id', v_resp,
                             'request_id', v_req));

  SELECT q.state INTO v_card FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key = 'billing:' || v_event;
  RETURN jsonb_build_object('eventId', v_event, 'departureId', v_dep.id, 'winId', v_win, 'responseId', v_resp,
    'mrrEventId', v_mrr_event,
    'cardState', CASE WHEN v_card IS NULL THEN 'none' WHEN v_card = 'dry_run' THEN 'held' ELSE v_card END,
    'sentence', 'Reopened. The card updates within a few minutes.');
END $$;

-- ---------------------------------------------------------------------------
-- 6b. The Today rows (5.12), whole: 20261102h's three win rows, and the four this file's tables feed.
--     Replaces h's body in the same deploy (h's version reads no receipt or return).
--     receipt_in:      a client's bank receipt (14 days) whose payment nobody has checked yet;
--     receipt_checked: a checked receipt for a later part (14 days) with no next payment date set since
--                      the check: a transfer never passes Confirm paid, so the CSM sets the date (the
--                      W12 date edit) and the row says the date the rule of 4.6 gives;
--     back:            a return (Client is back) in the last 7 days;
--     due_no_money:    a client who pays by bank transfer, whose next payment date passed in the last
--                      30 days with no payment of any rail since a week before it, no open receipt
--                      invite, not paused or stopped (4.10.6). The amount is sent only in dollars a
--                      card states and only for a client whose last transfer was in dollars.
CREATE OR REPLACE FUNCTION public.cockpit_csm_wins_today()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ceo boolean; v_today date := public.cockpit_billing_today();
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
      UNION ALL
      -- A receipt in, its payment not checked yet (one row per answer).
      SELECT jsonb_build_object('kind', 'receipt_in', 'taskId', rs.task_id, 'client', rs.client_name, 'responseId', rs.id)
        FROM public.cockpit_form_responses rs
       WHERE rs.form_key = 'bank_receipt' AND rs.state IN ('submitted', 'confirmed') AND rs.mode = 'live'
         AND rs.submitted_at >= now() - interval '14 days'
         AND (EXISTS (SELECT 1 FROM public.cockpit_payment_receipts pr JOIN public.cockpit_manual_payments p ON p.id = pr.manual_payment_id
                       WHERE pr.response_id = rs.id AND p.deleted_at IS NULL AND p.check_state = 'logged')
              OR EXISTS (SELECT 1 FROM public.cockpit_billing_inbox b
                          WHERE b.response_id = rs.id AND (b.status = 'pending'
                            OR EXISTS (SELECT 1 FROM public.cockpit_manual_payments p
                                        WHERE p.source_deployment = 'billing-inbox' AND p.source_id = b.id::text
                                          AND p.deleted_at IS NULL AND p.check_state = 'logged'))))
         AND (v_ceo OR coalesce(public.cockpit_client_allowed(rs.client_name), false))
      UNION ALL
      -- A checked receipt for a later part, no date set on the card since the check.
      SELECT jsonb_build_object('kind', 'receipt_checked', 'taskId', x.task_id, 'client', x.client_name, 'responseId', x.response_id,
               'part', 'later', 'partNo', x.part_no, 'checkedAt', x.checked_at,
               'dateIfConfirmed', CASE WHEN (x.rule->>'move')::boolean THEN x.rule->'to' END, 'dateWhy', x.rule->'why')
        FROM (
          SELECT rs.id AS response_id, rs.task_id, rs.client_name, p.checked_at,
                 CASE WHEN iv.context->>'partNo' ~ '^[1-9][0-9]?$' THEN (iv.context->>'partNo')::integer END AS part_no,
                 public.cockpit_billing_confirm_date_rule(rs.task_id, nullif(iv.context->>'dealResponseId', ''), 'later',
                   CASE WHEN iv.context->>'partNo' ~ '^[1-9][0-9]?$' THEN (iv.context->>'partNo')::integer END,
                   jsonb_strip_nulls(jsonb_build_object('dueOn', iv.context->>'dueOn'))) AS rule
            FROM public.cockpit_form_responses rs
            JOIN public.cockpit_form_invites iv ON iv.id = rs.invite_id
            JOIN public.cockpit_manual_payments p ON p.deleted_at IS NULL AND p.check_state = 'checked' AND (
                   p.id IN (SELECT pr.manual_payment_id FROM public.cockpit_payment_receipts pr WHERE pr.response_id = rs.id)
                   OR (p.source_deployment = 'billing-inbox'
                       AND p.source_id IN (SELECT b.id::text FROM public.cockpit_billing_inbox b WHERE b.response_id = rs.id)))
           WHERE rs.form_key = 'bank_receipt' AND rs.mode = 'live' AND iv.context->>'part' = 'later'
             AND p.checked_at >= now() - interval '14 days'
             AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_events e
                              WHERE e.clickup_task_id = rs.task_id AND e.kind = 'date' AND e.at >= p.checked_at
                                AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id))
             AND (v_ceo OR coalesce(public.cockpit_client_allowed(rs.client_name), false))) x
      UNION ALL
      -- Back: a return in the last 7 days.
      SELECT jsonb_build_object('kind', 'back', 'taskId', d.clickup_task_id, 'client', d.client, 'returnedOn', d.returned_on)
        FROM public.cockpit_churn_departures d
       WHERE d.removed_at IS NULL AND d.returned_on IS NOT NULL AND d.returned_on BETWEEN v_today - 6 AND v_today
         AND (v_ceo OR coalesce(public.cockpit_client_allowed(d.client), false))
      UNION ALL
      -- Due, no money in, for a client who pays by bank transfer.
      SELECT jsonb_build_object('kind', 'due_no_money', 'taskId', a.clickup_task_id, 'client', a.client_name, 'part', 'later',
               'dueOn', a.next_payment_date, 'currency', t.currency,
               'expectedAmount', CASE WHEN t.currency = 'USD' AND a.next_payment_usd > 0 THEN a.next_payment_usd END)
        FROM public.cockpit_billing_accounts a
        CROSS JOIN LATERAL (SELECT p.currency FROM public.cockpit_manual_payments p
                             WHERE p.clickup_task_id = a.clickup_task_id AND p.rail = 'bank_transfer' AND p.deleted_at IS NULL
                               AND p.check_state <> 'rejected' AND p.day >= v_today - 400
                             ORDER BY p.day DESC, p.added_at DESC LIMIT 1) t
       WHERE a.next_payment_date BETWEEN v_today - 30 AND v_today - 1
         AND a.paused_on IS NULL AND coalesce(a.client_status, '') NOT IN ('Paused', 'Stopped', 'Churned')
         AND NOT EXISTS (SELECT 1 FROM public.cockpit_manual_payments p
                          WHERE p.clickup_task_id = a.clickup_task_id AND p.deleted_at IS NULL AND p.check_state <> 'rejected'
                            AND p.day >= a.next_payment_date - 7)
         AND NOT EXISTS (SELECT 1 FROM public.cockpit_client_payments cp
                          WHERE cp.clickup_task_id = a.clickup_task_id AND cp.active AND cp.day >= a.next_payment_date - 7)
         AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_inbox b
                          WHERE b.clickup_task_id = a.clickup_task_id AND b.status = 'pending' AND b.paid_on >= a.next_payment_date - 7)
         AND NOT EXISTS (SELECT 1 FROM public.cockpit_form_invites iv
                          WHERE iv.task_id = a.clickup_task_id AND iv.form_key = 'bank_receipt'
                            AND public.cockpit_form_invite_state(iv) = 'open')
         AND (v_ceo OR coalesce(public.cockpit_client_allowed(a.client_name), false))
    ) x), '[]'::jsonb));
END $$;

-- ---------------------------------------------------------------------------
-- 7. The C9 retire registry (3.7, 4.11)

CREATE OR REPLACE VIEW public.cockpit_retire_items_v WITH (security_invoker = true) AS
SELECT r.id, r.kind, r.external_id, r.name, r.used_for, r.owner_role, r.replacement, r.wave, r.state, r.switch_off_step,
       r.off_at, r.quiet_since, r.archived_at, r.backup_path, r.note, r.updated_by, r.updated_at,
       r.quiet_since + interval '14 days' AS archive_from,
       (r.state IN ('off','closed') AND r.quiet_since IS NOT NULL AND r.quiet_since + interval '14 days' <= now()) AS ready
  FROM public.cockpit_retire_items r;
REVOKE ALL ON public.cockpit_retire_items_v FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_retire_items_v TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_read_only_user') THEN
    EXECUTE 'GRANT SELECT ON public.cockpit_retire_items_v TO supabase_read_only_user';
  END IF;
END $$;

-- The deploy's one door into the registry (owner only). p_patch: {state?, step?, note?, backupPath?,
-- offAt?, quietSince?}. Moves of 3.7 and their rollbacks; a later run or old-link answer moves
-- quiet_since forward (never back), which pushes the archive day.
CREATE OR REPLACE FUNCTION public.cockpit_retire_item_set(p_id text, p_patch jsonb, p_actor text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_retire_items;
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_to text;
  v_step text;
  v_note text;
  v_backup text;
  v_off timestamptz;
  v_quiet timestamptz;
  v_after public.cockpit_retire_items;
BEGIN
  IF v_actor IS NULL OR char_length(v_actor) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'Say who moves the item.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Send the change as an object.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN ('state','step','note','backupPath','offAt','quietSince')) THEN
    RAISE EXCEPTION 'The change names a part the registry does not have.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.cockpit_retire_items x WHERE x.id = p_id FOR UPDATE;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'There is no retire item %.', left(coalesce(p_id, ''), 80) USING ERRCODE = '22023';
  END IF;
  v_to := coalesce(p_patch->>'state', r.state);
  v_step := nullif(btrim(coalesce(p_patch->>'step', '')), '');
  v_note := nullif(btrim(coalesce(p_patch->>'note', '')), '');
  v_backup := nullif(btrim(coalesce(p_patch->>'backupPath', '')), '');
  IF v_step IS NOT NULL AND char_length(v_step) > 40 THEN
    RAISE EXCEPTION 'The deploy step is a row id of 40 characters at most.' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'Keep the note to 500 characters.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_off := (p_patch->>'offAt')::timestamptz;
    v_quiet := (p_patch->>'quietSince')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Send the times as ISO dates.' USING ERRCODE = '22023';
  END;
  PERFORM set_config('cockpit.audit_actor', v_actor, true);
  PERFORM set_config('cockpit.audit_source', 'deploy', true);
  PERFORM set_config('cockpit.forms_action', 'forms.retire_' || v_to, true);

  IF v_to = r.state THEN
    -- No move: a backup path, a note, or a later run that pushes quiet_since forward.
    IF r.state NOT IN ('on','off','closed','removed') AND (v_quiet IS NOT NULL OR v_backup IS NOT NULL) THEN
      RAISE EXCEPTION '% is % and stays as it is.', r.name, r.state USING ERRCODE = '22023';
    END IF;
    IF v_quiet IS NOT NULL AND (r.state NOT IN ('off','closed','removed') OR (r.quiet_since IS NOT NULL AND v_quiet < r.quiet_since)) THEN
      RAISE EXCEPTION 'Quiet since only moves forward, on an item that is off.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.cockpit_retire_items SET quiet_since = coalesce(v_quiet, quiet_since), backup_path = coalesce(v_backup, backup_path),
           note = coalesce(v_note, note), updated_by = v_actor, updated_at = now()
     WHERE id = r.id RETURNING * INTO v_after;
  ELSIF r.state = 'on' AND v_to IN ('off','closed','removed','kept') THEN
    IF v_to = 'closed' AND r.kind <> 'typeform' THEN
      RAISE EXCEPTION 'Only a Typeform is closed; switch a scenario off and remove a webhook.' USING ERRCODE = '22023';
    END IF;
    IF v_to = 'removed' AND r.kind <> 'webhook' THEN
      RAISE EXCEPTION 'Only a webhook is removed; switch a scenario off and close a Typeform.' USING ERRCODE = '22023';
    END IF;
    IF v_to = 'off' AND r.kind <> 'make' THEN
      RAISE EXCEPTION 'Only a Make scenario is switched off; close a Typeform and remove a webhook.' USING ERRCODE = '22023';
    END IF;
    IF v_to <> 'kept' AND v_step IS NULL THEN
      RAISE EXCEPTION 'Name the deploy step that switched it off.' USING ERRCODE = '22023';
    END IF;
    IF v_to = 'kept' AND v_note IS NULL THEN
      RAISE EXCEPTION 'Say why it is kept.' USING ERRCODE = '22023';
    END IF;
    v_off := CASE WHEN v_to = 'kept' THEN NULL ELSE coalesce(v_off, now()) END;
    UPDATE public.cockpit_retire_items SET state = v_to, switch_off_step = coalesce(v_step, switch_off_step), off_at = v_off,
           quiet_since = CASE WHEN v_to = 'kept' THEN NULL ELSE greatest(v_off, coalesce(v_quiet, v_off)) END,
           backup_path = coalesce(v_backup, backup_path), note = coalesce(v_note, note), updated_by = v_actor, updated_at = now()
     WHERE id = r.id RETURNING * INTO v_after;
  ELSIF r.state IN ('off','closed') AND v_to = 'archived' THEN
    IF r.quiet_since IS NULL OR r.quiet_since > now() - interval '14 days' THEN
      RAISE EXCEPTION '% has not been quiet for 14 days yet. Archive it from %.', r.name,
        to_char((coalesce(r.quiet_since, now()) + interval '14 days') AT TIME ZONE 'Asia/Kuwait', 'FMDD Mon YYYY')
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.cockpit_retire_items SET state = 'archived', archived_at = now(), backup_path = coalesce(v_backup, backup_path),
           note = coalesce(v_note, note), updated_by = v_actor, updated_at = now()
     WHERE id = r.id RETURNING * INTO v_after;
  ELSIF r.state IN ('off','closed','removed') AND v_to = 'on' THEN
    -- A rollback: switched back on at a deploy step, with its reason.
    IF v_note IS NULL OR char_length(v_note) < 3 OR v_step IS NULL THEN
      RAISE EXCEPTION 'A rollback needs its reason (3 to 500 characters) and the deploy step that undid it.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.cockpit_retire_items SET state = 'on', switch_off_step = v_step, off_at = NULL, quiet_since = NULL,
           note = v_note, updated_by = v_actor, updated_at = now()
     WHERE id = r.id RETURNING * INTO v_after;
  ELSE
    RAISE EXCEPTION '% cannot move from % to %.', r.name, r.state, v_to USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN to_jsonb(v_after) || jsonb_build_object('archive_from', v_after.quiet_since + interval '14 days');
END $$;

-- Settings, Forms: Old forms and scenarios (5.14). The CEO or an admin.
CREATE OR REPLACE FUNCTION public.cockpit_retire_items_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false)) THEN
    RAISE EXCEPTION 'The old forms list is for the CEO and admins.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('items', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', v.id, 'kind', v.kind, 'externalId', v.external_id, 'name', v.name, 'usedFor', v.used_for,
      'ownerRole', v.owner_role, 'replacement', v.replacement, 'wave', v.wave, 'state', v.state,
      'switchOffStep', v.switch_off_step, 'offAt', v.off_at, 'quietSince', v.quiet_since, 'archiveFrom', v.archive_from,
      'ready', v.ready, 'archivedAt', v.archived_at, 'note', v.note)
      ORDER BY CASE v.state WHEN 'on' THEN 0 WHEN 'off' THEN 1 WHEN 'closed' THEN 1 WHEN 'removed' THEN 2
                            WHEN 'archived' THEN 3 ELSE 4 END, v.kind, v.id)
    FROM public.cockpit_retire_items_v v), '[]'::jsonb));
END $$;


-- ---------------------------------------------------------------------------
-- 3. Client form schema v1, wave 5 (3.6), and who may receive which form (2.2)

CREATE OR REPLACE FUNCTION public.cockpit_form_schema_check(p_schema jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f jsonb;
  o jsonb;
  c jsonb;
  d jsonb;
  k text;
  t text;
  v_keys text[] := '{}';
  v_ctx text[] := '{}';
  v_vals text[];
  v_n integer := 0;
  v_max integer;
  -- Waves 5-6 (20261102i): headings are shown, never answered, so a show-if, a read or a
  -- thank-you line names only the answered questions (v_keys); v_all holds every key.
  v_all text[] := '{}';
  v_bucket text[] := ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf'];
BEGIN
  IF jsonb_typeof(p_schema) IS DISTINCT FROM 'object' THEN
    RETURN 'The schema must be an object.';
  END IF;
  IF p_schema->'v' IS DISTINCT FROM '1'::jsonb THEN
    RETURN 'The schema must be client form schema version 1.';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_schema) LOOP
    IF k NOT IN ('v','key','title','intro','minutes','audience','signer','context','fields','reads','submit','done','doneIf','invite') THEN
      RETURN format('The schema has a part it does not know: %s.', left(k, 40));
    END IF;
  END LOOP;
  IF jsonb_typeof(p_schema->'key') IS DISTINCT FROM 'string' OR (p_schema->>'key') !~ '^[a-z][a-z0-9_]{1,30}$' THEN
    RETURN 'The schema needs the form''s key.';
  END IF;
  IF NOT public.cockpit_form_schema_pair(p_schema->'title', 200) THEN
    RETURN 'The title needs English and Arabic, each 200 characters at most.';
  END IF;
  IF p_schema ? 'intro' AND p_schema->'intro' <> 'null'::jsonb AND NOT public.cockpit_form_schema_pair(p_schema->'intro', 600) THEN
    RETURN 'The introduction needs English and Arabic, each 600 characters at most.';
  END IF;
  -- Up to an hour (waves 5-6): the native onboarding honestly takes about 25 minutes.
  IF jsonb_typeof(p_schema->'minutes') IS DISTINCT FROM 'number'
     OR (p_schema->>'minutes') !~ '^[0-9]{1,2}$' OR (p_schema->>'minutes')::integer NOT BETWEEN 1 AND 60 THEN
    RETURN 'Minutes must be a whole number from 1 to 60.';
  END IF;
  IF coalesce(p_schema->>'audience', '') NOT IN ('any','admin') OR jsonb_typeof(p_schema->'audience') <> 'string' THEN
    RETURN 'Who answers must be any or admin.';
  END IF;
  IF coalesce(p_schema->>'signer', '') NOT IN ('none','typed') OR jsonb_typeof(p_schema->'signer') <> 'string' THEN
    RETURN 'The signer must be none or typed.';
  END IF;

  -- Read-only facts shown from the invite's context.
  IF p_schema ? 'context' THEN
    IF jsonb_typeof(p_schema->'context') IS DISTINCT FROM 'array' OR jsonb_array_length(p_schema->'context') > 10 THEN
      RETURN 'The context is a list of at most 10 facts.';
    END IF;
    FOR c IN SELECT x FROM jsonb_array_elements(p_schema->'context') x LOOP
      IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR EXISTS (
           SELECT 1 FROM jsonb_object_keys(c) ck WHERE ck NOT IN ('key','type','label'))
         OR coalesce(c->>'key', '') !~ '^[a-z][a-zA-Z0-9]{1,30}$' OR jsonb_typeof(c->'key') <> 'string'
         OR coalesce(c->>'type', '') NOT IN ('date','text','number','boolean')
         OR NOT public.cockpit_form_schema_pair(c->'label', 200) THEN
        RETURN 'Each context fact needs a key, a type (date, text, number or boolean) and English and Arabic labels.';
      END IF;
      IF (c->>'key') = ANY(v_ctx) THEN
        RETURN format('Two context facts share the key %s.', c->>'key');
      END IF;
      v_ctx := v_ctx || (c->>'key');
    END LOOP;
  END IF;

  -- The questions, in order.
  IF jsonb_typeof(p_schema->'fields') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_schema->'fields') NOT BETWEEN 1 AND 40 THEN
    RETURN 'A form needs 1 to 40 questions.';
  END IF;
  FOR f IN SELECT x FROM jsonb_array_elements(p_schema->'fields') x LOOP
    v_n := v_n + 1;
    IF jsonb_typeof(f) IS DISTINCT FROM 'object' THEN
      RETURN format('Question %s is not an object.', v_n);
    END IF;
    k := CASE WHEN jsonb_typeof(f->'key') = 'string' THEN f->>'key' END;
    IF k IS NULL OR k !~ '^[a-z][a-zA-Z0-9]{1,30}$' THEN
      RETURN format('Question %s needs a key: a lowercase letter, then 1 to 30 letters or digits.', v_n);
    END IF;
    IF k = ANY(v_all) THEN
      RETURN format('Two questions share the key %s.', k);
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(f) fk
                WHERE fk NOT IN ('key','type','label','hint','required','min','max','lowLabel','highLabel',
                                 'options','maxLength','showIf','boldIf',
                                 'accept','maxBytes','notAfter','notBeforeDays','decimals','format')) THEN
      RETURN format('Question %s has a setting it does not know.', k);
    END IF;
    t := CASE WHEN jsonb_typeof(f->'type') = 'string' THEN f->>'type' END;
    IF t IS NULL OR t NOT IN ('scale','choice','multi','text','longtext','tick','file','date','number','heading') THEN
      RETURN format('Question %s has a type client forms do not know.', k);
    END IF;
    IF NOT public.cockpit_form_schema_pair(f->'label', 200) THEN
      RETURN format('Question %s needs an English and an Arabic label, each 200 characters at most.', k);
    END IF;
    IF f ? 'hint' AND f->'hint' <> 'null'::jsonb AND NOT public.cockpit_form_schema_pair(f->'hint', 600) THEN
      RETURN format('The hint of question %s needs English and Arabic, each 600 characters at most.', k);
    END IF;
    IF t = 'heading' THEN
      IF f ? 'required' AND f->'required' IS DISTINCT FROM 'false'::jsonb THEN
        RETURN format('Heading %s is shown, never answered, so it cannot be required.', k);
      END IF;
    ELSIF jsonb_typeof(f->'required') IS DISTINCT FROM 'boolean' THEN
      RETURN format('Question %s must say whether it is required.', k);
    END IF;

    -- Settings that belong to one type only.
    IF (t NOT IN ('scale','number') AND (f ? 'min' OR f ? 'max')) OR (t <> 'scale' AND (f ? 'lowLabel' OR f ? 'highLabel')) THEN
      RETURN format('Question %s has scale settings but is not a scale.', k);
    END IF;
    IF t <> 'number' AND f ? 'decimals' THEN
      RETURN format('Question %s has decimals but is not a number.', k);
    END IF;
    IF t <> 'file' AND (f ? 'accept' OR f ? 'maxBytes') THEN
      RETURN format('Question %s has file settings but is not a file.', k);
    END IF;
    IF t <> 'date' AND (f ? 'notAfter' OR f ? 'notBeforeDays') THEN
      RETURN format('Question %s has date limits but is not a date.', k);
    END IF;
    IF t <> 'text' AND f ? 'format' THEN
      RETURN format('Question %s has a text format but is not a short text.', k);
    END IF;
    IF t NOT IN ('choice','multi') AND f ? 'options' THEN
      RETURN format('Question %s has choices but is not a choice.', k);
    END IF;
    IF t NOT IN ('text','longtext') AND f ? 'maxLength' THEN
      RETURN format('Question %s has a length limit but is not a text.', k);
    END IF;
    IF t <> 'tick' AND f ? 'boldIf' AND f->'boldIf' <> 'null'::jsonb THEN
      RETURN format('Question %s can be bold only on a tick and a context fact.', k);
    END IF;

    IF t = 'scale' THEN
      IF jsonb_typeof(f->'min') IS DISTINCT FROM 'number' OR jsonb_typeof(f->'max') IS DISTINCT FROM 'number'
         OR (f->>'min')::numeric NOT IN (0, 1) OR (f->>'max')::numeric <> trunc((f->>'max')::numeric)
         OR (f->>'max')::numeric <= (f->>'min')::numeric OR (f->>'max')::numeric > 10 THEN
        RETURN format('Question %s needs a scale from 0 or 1 up to at most 10.', k);
      END IF;
      IF NOT public.cockpit_form_schema_pair(f->'lowLabel', 200) OR NOT public.cockpit_form_schema_pair(f->'highLabel', 200) THEN
        RETURN format('Question %s needs English and Arabic words for both ends of the scale.', k);
      END IF;
    ELSIF t IN ('choice','multi') THEN
      IF jsonb_typeof(f->'options') IS DISTINCT FROM 'array' OR jsonb_array_length(f->'options') NOT BETWEEN 2 AND 12 THEN
        RETURN format('Question %s needs 2 to 12 choices.', k);
      END IF;
      v_vals := '{}';
      FOR o IN SELECT x FROM jsonb_array_elements(f->'options') x LOOP
        IF jsonb_typeof(o) IS DISTINCT FROM 'object'
           OR (SELECT array_agg(ok ORDER BY ok) FROM jsonb_object_keys(o) ok) IS DISTINCT FROM ARRAY['label','value']
           OR jsonb_typeof(o->'value') IS DISTINCT FROM 'string' OR (o->>'value') !~ '^[a-z][a-z0-9_]{1,30}$'
           OR NOT public.cockpit_form_schema_pair(o->'label', 200) THEN
          RETURN format('Each choice of question %s needs a value and English and Arabic labels.', k);
        END IF;
        IF (o->>'value') = ANY(v_vals) THEN
          RETURN format('Question %s repeats the choice %s.', k, o->>'value');
        END IF;
        v_vals := v_vals || (o->>'value');
      END LOOP;
    ELSIF t IN ('text','longtext') THEN
      v_max := CASE t WHEN 'text' THEN 200 ELSE 2000 END;
      IF f ? 'maxLength' AND (jsonb_typeof(f->'maxLength') IS DISTINCT FROM 'number'
           OR (f->>'maxLength')::numeric <> trunc((f->>'maxLength')::numeric)
           OR (f->>'maxLength')::numeric NOT BETWEEN 1 AND v_max) THEN
        RETURN format('Question %s allows at most %s characters.', k, v_max);
      END IF;
      IF f ? 'format' AND (jsonb_typeof(f->'format') IS DISTINCT FROM 'string'
                           OR f->>'format' NOT IN ('plain','url','email','phone')) THEN
        RETURN format('Question %s has a format that is not plain, url, email or phone.', k);
      END IF;
    ELSIF t = 'number' THEN
      IF jsonb_typeof(f->'min') IS DISTINCT FROM 'number' OR jsonb_typeof(f->'max') IS DISTINCT FROM 'number'
         OR (f->>'min')::numeric >= (f->>'max')::numeric
         OR abs((f->>'min')::numeric) > 1000000000 OR abs((f->>'max')::numeric) > 1000000000 THEN
        RETURN format('Question %s needs a lowest and a highest number, the lowest below the highest.', k);
      END IF;
      IF f ? 'decimals' AND (jsonb_typeof(f->'decimals') IS DISTINCT FROM 'number'
                             OR (f->>'decimals')::numeric NOT IN (0, 1, 2, 3)) THEN
        RETURN format('Question %s allows 0 to 3 decimals.', k);
      END IF;
    ELSIF t = 'date' THEN
      IF f ? 'notAfter' AND f->'notAfter' <> 'null'::jsonb AND f->'notAfter' IS DISTINCT FROM '"today"'::jsonb THEN
        RETURN format('Question %s can only stop at today.', k);
      END IF;
      IF f ? 'notBeforeDays' AND f->'notBeforeDays' <> 'null'::jsonb
         AND (jsonb_typeof(f->'notBeforeDays') IS DISTINCT FROM 'number'
              OR (f->>'notBeforeDays')::numeric <> trunc((f->>'notBeforeDays')::numeric)
              OR (f->>'notBeforeDays')::numeric NOT BETWEEN 1 AND 3650) THEN
        RETURN format('Question %s goes back 1 to 3,650 days.', k);
      END IF;
    ELSIF t = 'file' THEN
      IF jsonb_typeof(f->'accept') IS DISTINCT FROM 'array' OR jsonb_array_length(f->'accept') = 0
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(f->'accept') e
                     WHERE jsonb_typeof(e) <> 'string' OR NOT ((e #>> '{}') = ANY(v_bucket)))
         OR (SELECT count(DISTINCT e #>> '{}') FROM jsonb_array_elements(f->'accept') e) <> jsonb_array_length(f->'accept') THEN
        RETURN format('Question %s takes photos (JPG, PNG, WEBP, HEIC) or PDFs only, each named once.', k);
      END IF;
      IF jsonb_typeof(f->'maxBytes') IS DISTINCT FROM 'number'
         OR (f->>'maxBytes')::numeric <> trunc((f->>'maxBytes')::numeric)
         OR (f->>'maxBytes')::numeric NOT BETWEEN 1 AND 10485760 THEN
        RETURN format('Question %s takes files of 10 MB at most.', k);
      END IF;
    END IF;

    -- One equality on an earlier question.
    IF f ? 'showIf' AND f->'showIf' <> 'null'::jsonb THEN
      IF jsonb_typeof(f->'showIf') IS DISTINCT FROM 'object'
         OR (SELECT array_agg(sk ORDER BY sk) FROM jsonb_object_keys(f->'showIf') sk) IS DISTINCT FROM ARRAY['equals','key']
         OR jsonb_typeof(f->'showIf'->'key') IS DISTINCT FROM 'string'
         OR jsonb_typeof(f->'showIf'->'equals') NOT IN ('string','number','boolean') THEN
        RETURN format('Question %s shows on one answer of an earlier question: give its key and the answer.', k);
      END IF;
      IF NOT ((f->'showIf'->>'key') = ANY(v_keys)) THEN
        RETURN format('Question %s can only follow an earlier question, and %s is not before it.', k, left(f->'showIf'->>'key', 40));
      END IF;
    END IF;
    IF f ? 'boldIf' AND f->'boldIf' <> 'null'::jsonb THEN
      IF jsonb_typeof(f->'boldIf') IS DISTINCT FROM 'object'
         OR (SELECT array_agg(bk ORDER BY bk) FROM jsonb_object_keys(f->'boldIf') bk) IS DISTINCT FROM ARRAY['context','equals']
         OR jsonb_typeof(f->'boldIf'->'context') IS DISTINCT FROM 'string'
         OR (f->'boldIf'->>'context') !~ '^[a-z][a-zA-Z0-9]{1,30}$'
         OR jsonb_typeof(f->'boldIf'->'equals') NOT IN ('string','number','boolean') THEN
        RETURN format('Question %s can be bold only on a tick and a context fact.', k);
      END IF;
    END IF;
    v_all := v_all || k;
    IF t <> 'heading' THEN v_keys := v_keys || k; END IF;
  END LOOP;

  -- Which questions each effect reads (the editor's guard).
  IF p_schema ? 'reads' THEN
    IF jsonb_typeof(p_schema->'reads') IS DISTINCT FROM 'object' THEN
      RETURN 'The reads list must be an object of effect keys.';
    END IF;
    FOR k, d IN SELECT * FROM jsonb_each(p_schema->'reads') LOOP
      IF k !~ '^[a-z][a-z0-9_]{1,40}$' OR jsonb_typeof(d) IS DISTINCT FROM 'array' THEN
        RETURN 'The reads list must map effect keys to lists of questions.';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(d) e WHERE jsonb_typeof(e) <> 'string' OR NOT ((e #>> '{}') = ANY(v_keys))) THEN
        RETURN format('The reads list of %s names a question the form does not have.', k);
      END IF;
    END LOOP;
  END IF;

  IF NOT public.cockpit_form_schema_pair(p_schema->'submit', 200) THEN
    RETURN 'The send button needs English and Arabic words.';
  END IF;
  IF NOT public.cockpit_form_schema_pair(p_schema->'done', 600) THEN
    RETURN 'The thank-you line needs English and Arabic.';
  END IF;
  -- Another thank-you line for one answer (the pause consent's dates wrong).
  IF p_schema ? 'doneIf' THEN
    IF jsonb_typeof(p_schema->'doneIf') IS DISTINCT FROM 'array' OR jsonb_array_length(p_schema->'doneIf') > 3 THEN
      RETURN 'The other thank-you lines are a list of at most 3.';
    END IF;
    FOR d IN SELECT x FROM jsonb_array_elements(p_schema->'doneIf') x LOOP
      IF jsonb_typeof(d) IS DISTINCT FROM 'object'
         OR (SELECT array_agg(dk ORDER BY dk) FROM jsonb_object_keys(d) dk) IS DISTINCT FROM ARRAY['equals','key','text']
         OR jsonb_typeof(d->'key') IS DISTINCT FROM 'string' OR NOT ((d->>'key') = ANY(v_keys))
         OR jsonb_typeof(d->'equals') NOT IN ('string','number','boolean')
         OR NOT public.cockpit_form_schema_pair(d->'text', 600) THEN
        RETURN 'Each other thank-you line names a question, its answer and English and Arabic words.';
      END IF;
    END LOOP;
  END IF;

  -- The WhatsApp text and the phone alert (a form with no invite path has none).
  IF p_schema ? 'invite' THEN
    IF jsonb_typeof(p_schema->'invite') IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_schema->'invite') ik WHERE ik NOT IN ('whatsapp','push')) THEN
      RETURN 'The invite holds the WhatsApp text and the phone alert only.';
    END IF;
    IF p_schema->'invite' ? 'whatsapp' THEN
      IF NOT public.cockpit_form_schema_pair(p_schema->'invite'->'whatsapp', 1000) THEN
        RETURN 'The WhatsApp text needs English and Arabic, each 1,000 characters at most.';
      END IF;
      IF (char_length(p_schema->'invite'->'whatsapp'->>'en') - char_length(replace(p_schema->'invite'->'whatsapp'->>'en', '{form_link}', ''))) <> char_length('{form_link}')
         OR (char_length(p_schema->'invite'->'whatsapp'->>'ar') - char_length(replace(p_schema->'invite'->'whatsapp'->>'ar', '{form_link}', ''))) <> char_length('{form_link}') THEN
        RETURN 'The WhatsApp text needs {form_link} exactly once in each language.';
      END IF;
    END IF;
    IF p_schema->'invite' ? 'push' AND NOT public.cockpit_form_schema_pair(p_schema->'invite'->'push', 200) THEN
      RETURN 'The phone alert needs English and Arabic, each 200 characters at most.';
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_form_answers_check(p_schema jsonb, p_answers jsonb, p_context jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_answers jsonb := CASE WHEN jsonb_typeof(p_answers) = 'object' THEN p_answers ELSE '{}'::jsonb END;
  v_errors jsonb := '{}'::jsonb;
  v_out jsonb := '{}'::jsonb;
  v_types jsonb := '{}'::jsonb;
  v_keys text[] := '{}';
  f jsonb;
  k text;
  t text;
  v jsonb;
  v_cmp jsonb;
  v_vis boolean;
  v_req boolean;
  v_s text;
  v_num numeric;
  v_ok boolean;
  -- Waves 5-6 (20261102i): numbers, dates and files.
  v_today date := public.cockpit_form_kuwait_day(now());
  v_d date;
  v_dec integer;
  v_code text;
  v_path text;
  v_meta jsonb;
  v_slot record;
BEGIN
  FOR f IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_schema->'fields') = 'array'
                                                  THEN p_schema->'fields' ELSE '[]'::jsonb END) x LOOP
    k := f->>'key';
    t := f->>'type';
    CONTINUE WHEN k IS NULL;
    v_keys := v_keys || k;
    v_types := v_types || jsonb_build_object(k, t);
    v_req := coalesce(f->>'required', '') = 'true';
    v_vis := true;
    IF jsonb_typeof(f->'showIf') = 'object' THEN
      v_cmp := v_out -> (f->'showIf'->>'key');
      IF v_cmp IS NULL AND v_types->>(f->'showIf'->>'key') = 'tick' THEN
        v_cmp := 'false'::jsonb;
      END IF;
      v_vis := v_cmp IS NOT NULL AND v_cmp = f->'showIf'->'equals';
    END IF;
    v := v_answers -> k;
    IF v = 'null'::jsonb THEN v := NULL; END IF;
    -- A heading is shown, never answered.
    IF t = 'heading' THEN
      IF v IS NOT NULL THEN v_errors := v_errors || jsonb_build_object(k, 'unknown'); END IF;
      CONTINUE;
    END IF;
    IF NOT v_vis THEN
      IF v IS NOT NULL THEN v_errors := v_errors || jsonb_build_object(k, 'hidden'); END IF;
      CONTINUE;
    END IF;
    -- Blank: missing, an empty or blank text, an empty list.
    IF v IS NULL OR (jsonb_typeof(v) = 'string' AND btrim(regexp_replace(v #>> '{}', '\s+', ' ', 'g')) = '')
       OR (jsonb_typeof(v) = 'array' AND jsonb_array_length(v) = 0) THEN
      IF v_req THEN v_errors := v_errors || jsonb_build_object(k, CASE WHEN t = 'file' THEN 'file_missing' ELSE 'required' END); END IF;
      CONTINUE;
    END IF;
    CASE t
      WHEN 'scale' THEN
        v_ok := jsonb_typeof(v) = 'number';
        IF v_ok THEN
          v_num := (v #>> '{}')::numeric;
          v_ok := v_num = trunc(v_num) AND v_num >= (f->>'min')::numeric AND v_num <= (f->>'max')::numeric;
        END IF;
        IF v_ok THEN v_out := v_out || jsonb_build_object(k, v_num::integer);
        ELSE v_errors := v_errors || jsonb_build_object(k, 'range'); END IF;
      WHEN 'choice' THEN
        IF jsonb_typeof(v) = 'string' AND EXISTS (SELECT 1 FROM jsonb_array_elements(f->'options') o WHERE o->>'value' = v #>> '{}') THEN
          v_out := v_out || jsonb_build_object(k, v);
        ELSE v_errors := v_errors || jsonb_build_object(k, 'option'); END IF;
      WHEN 'multi' THEN
        IF jsonb_typeof(v) = 'array'
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e
                            WHERE jsonb_typeof(e) <> 'string'
                               OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f->'options') o WHERE o->>'value' = e #>> '{}'))
           AND (SELECT count(DISTINCT e #>> '{}') FROM jsonb_array_elements(v) e) = jsonb_array_length(v) THEN
          v_out := v_out || jsonb_build_object(k, v);
        ELSE v_errors := v_errors || jsonb_build_object(k, 'option'); END IF;
      WHEN 'text', 'longtext' THEN
        IF jsonb_typeof(v) <> 'string' THEN
          v_errors := v_errors || jsonb_build_object(k, 'required');
        ELSE
          v_s := btrim(regexp_replace(v #>> '{}', '\s+', ' ', 'g'));
          IF char_length(v_s) > coalesce((f->>'maxLength')::integer, CASE t WHEN 'text' THEN 200 ELSE 2000 END) THEN
            v_errors := v_errors || jsonb_build_object(k, 'length');
          ELSIF t = 'text' AND (CASE f->>'format'
                  WHEN 'url' THEN v_s !~ '^https?://[^\s]+\.[^\s]+$'
                  WHEN 'email' THEN v_s !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                  WHEN 'phone' THEN v_s !~ '^\+?[0-9 ()-]{7,20}$'
                  ELSE false END) THEN
            v_errors := v_errors || jsonb_build_object(k, 'format');
          ELSE
            v_out := v_out || jsonb_build_object(k, v_s);
          END IF;
        END IF;
      WHEN 'tick' THEN
        IF jsonb_typeof(v) <> 'boolean' THEN
          v_errors := v_errors || jsonb_build_object(k, 'option');
        ELSIF v_req AND v = 'false'::jsonb THEN
          v_errors := v_errors || jsonb_build_object(k, 'required');
        ELSE
          v_out := v_out || jsonb_build_object(k, v);
        END IF;
      WHEN 'number' THEN
        v_ok := jsonb_typeof(v) = 'number';
        IF v_ok THEN
          v_num := (v #>> '{}')::numeric;
          v_dec := coalesce((f->>'decimals')::integer, 0);
          v_ok := v_num >= (f->>'min')::numeric AND v_num <= (f->>'max')::numeric AND v_num = round(v_num, v_dec);
        END IF;
        IF v_ok THEN v_out := v_out || jsonb_build_object(k, v_num);
        ELSE v_errors := v_errors || jsonb_build_object(k, 'range'); END IF;
      WHEN 'date' THEN
        v_d := NULL;
        IF jsonb_typeof(v) = 'string' AND (v #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
          BEGIN
            v_d := (v #>> '{}')::date;
          EXCEPTION WHEN OTHERS THEN v_d := NULL;
          END;
        END IF;
        IF v_d IS NULL OR (f->>'notAfter' = 'today' AND v_d > v_today)
           OR (jsonb_typeof(f->'notBeforeDays') = 'number' AND v_d < v_today - (f->>'notBeforeDays')::integer) THEN
          v_errors := v_errors || jsonb_build_object(k, 'range');
        ELSE
          v_out := v_out || jsonb_build_object(k, to_char(v_d, 'YYYY-MM-DD'));
        END IF;
      WHEN 'file' THEN
        -- {path, mime, bytes, sha256, name}: a slot of an open invite of this form with these facts, for
        -- this field, unused, and an object in the private bucket whose type and size match.
        v_code := NULL;
        IF jsonb_typeof(v) <> 'object'
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(v) fk WHERE fk NOT IN ('path','mime','bytes','sha256','name'))
           OR jsonb_typeof(v->'path') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'mime') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v->'bytes') IS DISTINCT FROM 'number' OR jsonb_typeof(v->'sha256') IS DISTINCT FROM 'string'
           OR (v ? 'name' AND jsonb_typeof(v->'name') NOT IN ('string','null')) THEN
          v_code := 'file_missing';
        ELSE
          v_path := v->>'path';
          v_slot := NULL;
          SELECT s.id, s.mime, s.bytes INTO v_slot
            FROM public.cockpit_form_file_slots s JOIN public.cockpit_form_invites i ON i.id = s.invite_id
           WHERE s.path = v_path AND s.field_key = k AND s.sha256 = v->>'sha256' AND s.used_by IS NULL
             AND i.form_key = p_schema->>'key' AND i.state = 'open'
             AND i.context = (CASE WHEN jsonb_typeof(p_context) = 'object' THEN p_context ELSE '{}'::jsonb END) - 'signer'
           LIMIT 1;
          v_meta := NULL;
          SELECT o.metadata INTO v_meta FROM storage.objects o WHERE o.bucket_id = 'cockpit-form-files' AND o.name = v_path LIMIT 1;
          IF v_slot.id IS NULL OR v_meta IS NULL THEN
            v_code := 'file_missing';
          ELSIF NOT (coalesce(f->'accept', '[]'::jsonb) ? (v->>'mime')) OR v->>'mime' IS DISTINCT FROM v_slot.mime
                OR v->>'mime' IS DISTINCT FROM v_meta->>'mimetype' THEN
            v_code := 'file_type';
          ELSIF (v->>'bytes')::numeric > coalesce((f->>'maxBytes')::numeric, 10485760)
                OR (v->>'bytes')::numeric IS DISTINCT FROM v_slot.bytes::numeric
                OR (v->>'bytes')::numeric IS DISTINCT FROM (CASE WHEN v_meta->>'size' ~ '^[0-9]+$' THEN (v_meta->>'size')::numeric END) THEN
            v_code := 'file_size';
          END IF;
        END IF;
        IF v_code IS NULL THEN
          v_out := v_out || jsonb_build_object(k, jsonb_build_object('path', v_path, 'mime', v->>'mime',
                     'bytes', (v->>'bytes')::bigint, 'sha256', v->>'sha256',
                     'name', nullif(left(btrim(regexp_replace(coalesce(v->>'name', ''), '\s+', ' ', 'g')), 120), '')));
        ELSE
          v_errors := v_errors || jsonb_build_object(k, v_code);
        END IF;
      ELSE
        v_errors := v_errors || jsonb_build_object(k, 'unknown');
    END CASE;
  END LOOP;
  FOR k IN SELECT jsonb_object_keys(v_answers) LOOP
    IF NOT (k = ANY(v_keys)) THEN v_errors := v_errors || jsonb_build_object(k, 'unknown'); END IF;
  END LOOP;
  IF p_schema->>'signer' = 'typed' AND jsonb_typeof(p_context) = 'object' AND p_context ? 'signer' THEN
    v_s := btrim(regexp_replace(coalesce(CASE WHEN jsonb_typeof(p_context->'signer') = 'string' THEN p_context->>'signer' END, ''), '\s+', ' ', 'g'));
    IF v_s = '' THEN
      v_errors := v_errors || jsonb_build_object('signer', 'required');
    ELSIF char_length(v_s) NOT BETWEEN 2 AND 120 THEN
      v_errors := v_errors || jsonb_build_object('signer', 'length');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', v_errors = '{}'::jsonb, 'errors', v_errors, 'answers', v_out);
END $$;

-- NULL when the card may receive the form, else the refusal sentence (2.3, V28; waves 5-6 2.2). NPS,
-- CSAT and pause consent go only to a card the billing mirror holds as Active with no open departure;
-- the exit survey only with an open or confirmed departure, or a Stopped card. Waves 5-6
-- (20261102i): a departure the client came back from is closed; the bank receipt goes to a card on
-- the billing sheet that is not Stopped; the onboarding form never goes to a card that already has an
-- onboarding answer or a kickoff, whatever form it came through. A card the mirror does not hold (the
-- test card) passes the mirror's rules. Review fix: an answer the cockpit's own Typeform door stored
-- from a hidden card id only (owner cockpit, match hidden_id_unverified), and the read model entry of
-- the same token, do not count until a person confirms the card (match confirmed_by_person).
CREATE OR REPLACE FUNCTION public.cockpit_form_card_allows(p_task_id text, p_form_key text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.cockpit_billing_accounts; v_dep jsonb; v_name text; v_at timestamptz; o jsonb;
BEGIN
  SELECT * INTO a FROM public.cockpit_billing_accounts x WHERE x.clickup_task_id = p_task_id;
  v_name := coalesce(nullif(btrim(a.client_name), ''), 'This client');
  IF p_form_key = 'onboarding' THEN
    SELECT x.forms INTO o FROM public.cockpit_client_onboarding x WHERE x.clickup_task_id = p_task_id;
    IF jsonb_typeof(o->'onboarding') = 'object'
       AND EXISTS (SELECT 1 FROM public.cockpit_form_responses u
                    WHERE u.form_key = 'onboarding' AND u.task_id = p_task_id AND u.external_id = o->'onboarding'->>'response_id'
                      AND coalesce(u.answer_meta->>'owner', '') = 'cockpit'
                      AND coalesce(u.answer_meta->>'match', '') = 'hidden_id_unverified') THEN
      o := o - 'onboarding';
    END IF;
    IF jsonb_typeof(o->'onboarding') = 'object' THEN
      v_at := CASE WHEN o->'onboarding'->>'submitted_at' ~ '^\d{4}-\d{2}-\d{2}' THEN (o->'onboarding'->>'submitted_at')::timestamptz END;
    END IF;
    IF v_at IS NULL THEN
      SELECT min(coalesce(r.submitted_at, r.created_at)) INTO v_at FROM public.cockpit_form_responses r
       WHERE r.form_key = 'onboarding' AND r.task_id = p_task_id AND r.state IN ('submitted','confirmed','legacy') AND r.mode = 'live'
         AND NOT (coalesce(r.answer_meta->>'owner', '') = 'cockpit' AND coalesce(r.answer_meta->>'match', '') = 'hidden_id_unverified');
    END IF;
    IF v_at IS NOT NULL OR jsonb_typeof(o->'onboarding') = 'object'
       OR EXISTS (SELECT 1 FROM public.cockpit_form_responses r
                   WHERE r.form_key = 'onboarding' AND r.task_id = p_task_id AND r.state IN ('submitted','confirmed','legacy') AND r.mode = 'live'
                     AND NOT (coalesce(r.answer_meta->>'owner', '') = 'cockpit' AND coalesce(r.answer_meta->>'match', '') = 'hidden_id_unverified')) THEN
      RETURN 'An onboarding answer is already stored for ' || coalesce(nullif(btrim(a.client_name), ''), 'this client')
             || coalesce(' (' || public.cockpit_form_day_words(v_at) || ')', '') || '.';
    END IF;
    IF jsonb_typeof(o->'kickoff') = 'object'
       OR EXISTS (SELECT 1 FROM public.cockpit_form_responses r
                   WHERE r.form_key = 'kickoff' AND r.task_id = p_task_id AND r.state IN ('submitted','confirmed','legacy') AND r.mode = 'live') THEN
      v_at := CASE WHEN o->'kickoff'->>'submitted_at' ~ '^\d{4}-\d{2}-\d{2}' THEN (o->'kickoff'->>'submitted_at')::timestamptz END;
      RETURN 'A kickoff is already stored for ' || coalesce(nullif(btrim(a.client_name), ''), 'this client') || coalesce(' (' || public.cockpit_form_day_words(v_at) || ')', '')
             || ', so the onboarding form is done.';
    END IF;
  END IF;
  IF a.clickup_task_id IS NULL THEN RETURN NULL; END IF;
  v_dep := public.cockpit_form_departure_of(p_task_id);
  -- A departure the client came back from (Client is back) is closed.
  IF v_dep IS NOT NULL AND EXISTS (SELECT 1 FROM public.cockpit_churn_departures d
                                    WHERE d.id = (v_dep->>'id')::bigint AND d.returned_on IS NOT NULL) THEN
    v_dep := NULL;
  END IF;
  IF p_form_key = 'exit_survey' THEN
    IF v_dep IS NOT NULL OR a.client_status = 'Stopped' THEN RETURN NULL; END IF;
    RETURN 'Mark Client is leaving first, then send the exit survey.';
  ELSIF p_form_key IN ('nps','csat','pause_consent') THEN
    IF v_dep IS NOT NULL AND NOT (v_dep->>'confirmed')::boolean THEN
      RETURN v_name || ' is leaving. Send the exit survey instead.';
    END IF;
    IF a.client_status IS DISTINCT FROM 'Active' THEN
      RETURN v_name || ' is not an active client, so this form does not go to them.';
    END IF;
  ELSIF p_form_key = 'bank_receipt' THEN
    IF a.client_status = 'Stopped' THEN
      RETURN v_name || ' has stopped, so no receipt request goes to them.';
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 8. The replaced functions (2.2): each live body with the smallest edit, marked
--    "Waves 5-6 (20261102i)".

CREATE OR REPLACE FUNCTION public.cockpit_form_invite_issue_core(p_task_id text, p_form_key text, p_channels text[],
  p_note text, p_lang text, p_push boolean, p_context jsonb, p_id uuid, p_origin text, p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.cockpit_forms;
  v_canary boolean := p_origin = 'canary';
  v_ver integer;
  v_schema jsonb;
  v_problem text;
  v_client text;
  v_open public.cockpit_form_invites;
  v_csat timestamptz;
  -- Waves 5-6 (20261102i): the bank receipt and the onboarding form in a sentence.
  v_words jsonb := CASE p_form_key WHEN 'bank_receipt' THEN '{"words":"receipt request","article":"A"}'::jsonb
                                   WHEN 'onboarding' THEN '{"words":"onboarding form","article":"An"}'::jsonb
                                   ELSE public.cockpit_form_words(p_form_key) END;
  v_channels text[];
  v_allowed text[];
  v_ws jsonb;
  v_location text;
  v_lang text := coalesce(nullif(btrim(p_lang), ''), 'ar');
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
  v_ctx jsonb := coalesce(p_context, '{}'::jsonb);
  v_key text;
  v_start date;
  v_restart date;
  v_today date := public.cockpit_form_kuwait_day(now());
  v_body text;
  v_msg uuid;
  v_push boolean;
  v_prev text := current_setting('cockpit.forms_action', true);
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = p_form_key;
  IF f.key IS NULL OR f.audience <> 'client' OR p_form_key NOT IN ('pause_consent','exit_survey','nps','csat','bank_receipt','onboarding') THEN
    RAISE EXCEPTION 'This form is not sent to clients from here.' USING ERRCODE = '22023';
  END IF;
  IF v_canary AND p_task_id <> '86eywg1cq' THEN
    RAISE EXCEPTION 'The canary writes only the test card 86eywg1cq.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_canary AND NOT public.cockpit_form_client_live(p_form_key) THEN
    RAISE EXCEPTION 'This form opens to clients after its switch-on.' USING ERRCODE = '22023';
  END IF;
  v_ver := public.cockpit_form_client_version(p_form_key);
  IF v_ver IS NULL THEN
    RAISE EXCEPTION 'This form has no client version yet, so it cannot be sent.' USING ERRCODE = '22023';
  END IF;
  SELECT v.schema INTO v_schema FROM public.cockpit_form_versions v WHERE v.form_key = p_form_key AND v.version = v_ver;
  v_problem := coalesce(public.cockpit_form_schema_check(v_schema), public.cockpit_form_schema_text_problem(v_schema));
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'This form''s version % cannot be sent: %', v_ver, v_problem USING ERRCODE = '22023';
  END IF;
  -- Review fix: the portal before waves 5-6 (v1.6.0) refuses an invite over 10 minutes, and its
  -- release (D-P1) comes after this file. Until a waves 5-6 portal form (the bank receipt or the
  -- onboarding form) is live for clients, which the deploy order puts after D-P1, a longer form is
  -- not sent. The onboarding form is never held: it reaches clients only after its own go-live.
  IF p_form_key <> 'onboarding' AND (v_schema->>'minutes') ~ '^[0-9]{1,2}$' AND (v_schema->>'minutes')::integer > 10
     AND NOT (public.cockpit_form_client_live('bank_receipt') OR public.cockpit_form_client_live('onboarding')) THEN
    RAISE EXCEPTION 'This form takes % minutes, and the client portal shows a form of 10 minutes at most until the new portal is live. Publish it with 10 minutes or less.',
      (v_schema->>'minutes')::integer USING ERRCODE = '22023';
  END IF;
  IF p_form_key = 'pause_consent' AND p_origin NOT IN ('pause','canary') THEN
    RAISE EXCEPTION 'Send the pause consent from Pause this client.' USING ERRCODE = '22023';
  END IF;
  IF p_form_key = 'bank_receipt' AND p_origin NOT IN ('billing','canary') THEN
    RAISE EXCEPTION 'Ask for the receipt from Pending payments or Checks waiting.' USING ERRCODE = '22023';
  END IF;
  IF p_origin = 'billing' AND p_form_key <> 'bank_receipt' THEN
    RAISE EXCEPTION 'Pending payments and Checks waiting send the receipt request only.' USING ERRCODE = '22023';
  END IF;
  IF p_form_key = 'onboarding' AND p_origin NOT IN ('csm','portal','canary') THEN
    RAISE EXCEPTION 'Send the onboarding form from the client page.' USING ERRCODE = '22023';
  END IF;
  IF p_origin = 'portal' AND p_form_key <> 'onboarding' THEN
    RAISE EXCEPTION 'The portal opens the onboarding form only.' USING ERRCODE = '22023';
  END IF;

  SELECT a.client_name INTO v_client FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = p_task_id;
  IF v_client IS NULL THEN
    IF NOT v_canary THEN
      RAISE EXCEPTION 'This client is not on the billing sheet, so no form goes to them.' USING ERRCODE = '22023';
    END IF;
    v_client := 'Test card';
  END IF;
  v_client := left(btrim(v_client), 200);

  IF p_form_key = 'csat' THEN
    SELECT max(r.submitted_at) INTO v_csat FROM public.cockpit_form_responses r
     WHERE r.form_key = 'csat' AND r.task_id = p_task_id AND r.state IN ('submitted','confirmed') AND r.mode = 'live';
    IF v_csat IS NOT NULL THEN
      RAISE EXCEPTION 'They already filled the onboarding survey on %.', public.cockpit_form_day_words(v_csat) USING ERRCODE = '22023';
    END IF;
  END IF;
  SELECT * INTO v_open FROM public.cockpit_form_invites x
   WHERE x.task_id = p_task_id AND x.form_key = p_form_key AND x.purpose = p_form_key AND x.state = 'open';
  IF v_open.id IS NOT NULL THEN
    RAISE EXCEPTION '% % is already out to %, sent %. Withdraw it to send a new one.', v_words->>'article', v_words->>'words',
      v_client, public.cockpit_form_day_words(v_open.issued_at) USING ERRCODE = '22023';
  END IF;
  v_problem := public.cockpit_form_card_allows(p_task_id, p_form_key);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023';
  END IF;

  -- Channels: the seats and the schedule pick the portal, WhatsApp or both;
  -- the canary takes a copy link, with or without a WhatsApp draft.
  v_allowed := CASE WHEN v_canary THEN ARRAY['copy','whatsapp'] ELSE ARRAY['portal','whatsapp'] END;
  SELECT coalesce(array_agg(DISTINCT c ORDER BY c), '{}') INTO v_channels FROM unnest(coalesce(p_channels, '{}')) c;
  IF cardinality(v_channels) = 0 OR NOT v_channels <@ v_allowed OR (v_canary AND NOT 'copy' = ANY(v_channels)) THEN
    RAISE EXCEPTION '%', CASE WHEN v_canary THEN 'The canary takes copy, or copy and whatsapp.'
                              ELSE 'Pick Portal, WhatsApp link or both.' END USING ERRCODE = '22023';
  END IF;
  v_ws := public.cockpit_form_workspace_of(p_task_id);
  v_location := CASE WHEN (v_ws->>'n')::integer = 1 THEN v_ws->>'locationId' END;
  IF 'portal' = ANY(v_channels) AND ((v_ws->>'n')::integer <> 1 OR (v_ws->>'closed')::boolean) THEN
    RAISE EXCEPTION '% has no open Mahara OS workspace. Send the WhatsApp link.', v_client USING ERRCODE = '22023';
  END IF;
  IF v_lang NOT IN ('ar','en') THEN
    RAISE EXCEPTION 'Pick Arabic or English for the WhatsApp text.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) > 280 THEN
    RAISE EXCEPTION 'Keep the line for the client to 280 characters.' USING ERRCODE = '22023';
  END IF;
  v_problem := public.cockpit_client_text_ok(v_note);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023';
  END IF;

  -- The context, per purpose (3.2); the issue hooks set the rest.
  IF jsonb_typeof(v_ctx) IS DISTINCT FROM 'object' OR octet_length(v_ctx::text) > 4096 THEN
    RAISE EXCEPTION 'Send the form''s facts as an object under 4 KB.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_ctx) LOOP
    IF NOT (v_key = ANY(CASE p_form_key WHEN 'pause_consent' THEN ARRAY['start','restart','reasonCat','callId','over14']
                                        WHEN 'exit_survey' THEN ARRAY['departureId']
                                        WHEN 'nps' THEN ARRAY['round']
                                        WHEN 'bank_receipt' THEN ARRAY['part','partNo','expectedAmount','currency','dueOn',
                                                                       'manualPaymentId','dealResponseId']
                                        WHEN 'onboarding' THEN ARRAY[]::text[]
                                        ELSE ARRAY['try'] END)) THEN
      RAISE EXCEPTION 'The % does not take %.', v_words->>'words', left(v_key, 40) USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_form_key = 'pause_consent' THEN
    BEGIN
      v_start := (v_ctx->>'start')::date;
      v_restart := (v_ctx->>'restart')::date;
    EXCEPTION WHEN OTHERS THEN
      v_start := NULL;
    END;
    IF v_start IS NULL OR v_start < v_today OR v_start > v_today + 14 THEN
      RAISE EXCEPTION 'The pause starts today or within 14 days.' USING ERRCODE = '22023';
    END IF;
    IF v_restart IS NULL OR v_restart <= v_start THEN
      RAISE EXCEPTION 'Pick the restart day, after the start.' USING ERRCODE = '22023';
    END IF;
    IF (v_ctx ? 'reasonCat' AND (jsonb_typeof(v_ctx->'reasonCat') <> 'string' OR char_length(v_ctx->>'reasonCat') > 60))
       OR (v_ctx ? 'callId' AND v_ctx->'callId' <> 'null'::jsonb
           AND (jsonb_typeof(v_ctx->'callId') <> 'string' OR char_length(v_ctx->>'callId') > 200)) THEN
      RAISE EXCEPTION 'Send the pause reason and the call as short texts.' USING ERRCODE = '22023';
    END IF;
    v_ctx := v_ctx || jsonb_build_object('start', v_start, 'restart', v_restart, 'over14', (v_restart - v_start) > 14);
  ELSIF p_form_key = 'exit_survey' AND v_ctx ? 'departureId'
        AND (jsonb_typeof(v_ctx->'departureId') <> 'number' OR (v_ctx->>'departureId') !~ '^[0-9]{1,18}$') THEN
    RAISE EXCEPTION 'Send the departure as its number.' USING ERRCODE = '22023';
  ELSIF p_form_key = 'nps' AND v_ctx ? 'round'
        AND (jsonb_typeof(v_ctx->'round') <> 'number' OR (v_ctx->>'round') !~ '^[1-9][0-9]{0,3}$') THEN
    RAISE EXCEPTION 'The NPS round is a whole number from 1.' USING ERRCODE = '22023';
  ELSIF p_form_key = 'csat' AND v_ctx ? 'try'
        AND (jsonb_typeof(v_ctx->'try') <> 'number' OR (v_ctx->>'try') !~ '^[1-4]$') THEN
    RAISE EXCEPTION 'The onboarding survey try is a whole number from 1 to 4.' USING ERRCODE = '22023';
  END IF;

  IF 'whatsapp' = ANY(v_channels) THEN
    v_body := v_schema->'invite'->'whatsapp'->>v_lang;
    IF v_body IS NULL THEN
      RAISE EXCEPTION 'This form has no WhatsApp text yet.' USING ERRCODE = '22023';
    END IF;
    v_body := replace(v_body, '{client}', v_client);
    v_problem := public.cockpit_client_text_ok(v_body);
    IF v_problem IS NOT NULL OR char_length(v_body) > 1000 THEN
      RAISE EXCEPTION '%', coalesce(v_problem, 'The WhatsApp text is over 1,000 characters with the client''s name in it.')
        USING ERRCODE = '22023';
    END IF;
  END IF;
  v_push := coalesce(p_push, false) AND 'portal' = ANY(v_channels) AND NOT v_canary;

  PERFORM set_config('cockpit.forms_action', 'forms.invite_issued', true);
  BEGIN
    INSERT INTO public.cockpit_form_invites(id, task_id, client_name, location_id, form_key, form_version, purpose, context,
      channels, audience, note, lang, origin, issued_by, issued_by_email, issued_by_role, expires_at, push, push_state)
    VALUES (p_id, p_task_id, v_client, v_location, p_form_key, v_ver, p_form_key, v_ctx, v_channels,
            coalesce(v_schema->>'audience', 'any'), v_note, v_lang, p_origin,
            CASE WHEN p_actor->>'id' ~ '^[0-9a-fA-F-]{36}$' THEN (p_actor->>'id')::uuid END,
            lower(nullif(btrim(p_actor->>'email'), '')), coalesce(nullif(btrim(p_actor->>'role'), ''), 'the cockpit'),
            now() + interval '14 days', v_push, CASE WHEN v_push THEN 'waiting' ELSE 'off' END);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION '% % is already out to %. Withdraw it to send a new one.', v_words->>'article', v_words->>'words', v_client
      USING ERRCODE = '22023';
  END;
  PERFORM public.cockpit_form_invite_event(p_id, coalesce(p_actor->>'source', 'cockpit'), 'issued', NULL,
    jsonb_build_object('channels', to_jsonb(v_channels), 'push', v_push, 'origin', p_origin, 'note', v_note IS NOT NULL));
  IF v_body IS NOT NULL THEN
    PERFORM set_config('cockpit.forms_action', 'forms.message_drafted', true);
    INSERT INTO public.cockpit_client_messages(dedupe_key, task_id, client_name, kind, body, body_sha256, group_source, invite_id)
    VALUES ('invite:' || p_id::text, p_task_id, v_client, 'form_invite', v_body,
            encode(pg_catalog.sha256(convert_to(v_body, 'UTF8')), 'hex'), 'client_data_f', p_id)
    RETURNING id INTO v_msg;
    PERFORM set_config('cockpit.forms_action', 'forms.invite_message', true);
    UPDATE public.cockpit_form_invites SET message_id = v_msg, updated_at = now() WHERE id = p_id;
  END IF;
  PERFORM public.cockpit_form_client_issued(p_id);
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev, ''), true);
  RETURN jsonb_build_object('inviteId', p_id, 'messageId', v_msg,
    'delivered', CASE WHEN 'portal' = ANY(v_channels) THEN 'portal'
                      WHEN 'whatsapp' = ANY(v_channels) THEN 'waiting_approval' ELSE 'copy' END);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_form_invite_view(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seat jsonb := public.cockpit_form_invite_seat(p_task_id);
BEGIN
  -- Waves 5-6 (20261102i): the bank receipt and onboarding rows added.
  RETURN public.cockpit_form_invite_view_with_tail(p_task_id, v_seat->>'clientName');
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_form_invite_issue(p_task_id text, p_form_key text, p_channels text[], p_note text,
  p_lang text, p_push boolean, p_context jsonb, p_request_id uuid, p_origin text DEFAULT 'csm')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_form_invite_seat(p_task_id);
  v_origin text := coalesce(nullif(btrim(p_origin), ''), 'csm');
  prior public.cockpit_form_invites;
  v_out jsonb;
BEGIN
  -- Waves 5-6 (20261102i): billing is Pending payments and Checks waiting (the bank receipt).
  IF v_origin NOT IN ('csm','pause','churn','billing') THEN
    RAISE EXCEPTION 'Pick where this form is sent from.' USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Send needs a request id. Reload the client and try again.' USING ERRCODE = '22023';
  END IF;
  -- A retry of the same request returns what it sent the first time.
  SELECT * INTO prior FROM public.cockpit_form_invites x WHERE x.id = p_request_id;
  IF prior.id IS NOT NULL THEN
    IF prior.task_id <> p_task_id OR prior.form_key IS DISTINCT FROM p_form_key
       OR prior.issued_by IS DISTINCT FROM (v_seat->>'actorId')::uuid THEN
      RAISE EXCEPTION 'This request id belongs to another form. Reload the client and try again.' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('inviteId', prior.id, 'messageId', prior.message_id,
      'delivered', CASE WHEN 'portal' = ANY(prior.channels) THEN 'portal' ELSE 'waiting_approval' END,
      'view', public.cockpit_form_invite_view_with_tail(p_task_id, v_seat->>'clientName'));
  END IF;
  PERFORM public.cockpit_form_invites_expire();
  PERFORM set_config('cockpit.audit_source', 'cockpit', true);
  v_out := public.cockpit_form_invite_issue_core(p_task_id, p_form_key, p_channels, p_note, p_lang, p_push, p_context,
    p_request_id, v_origin,
    jsonb_build_object('id', v_seat->>'actorId', 'email', v_seat->>'email',
                       'role', public.cockpit_form_role_words(v_seat), 'source', 'cockpit'));
  RETURN v_out || jsonb_build_object('view', public.cockpit_form_invite_view_with_tail(p_task_id, v_seat->>'clientName'));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_form_invite_issue_system(p_task_id text, p_form_key text, p_channels text[],
  p_context jsonb, p_origin text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid := gen_random_uuid(); v_msg text;
BEGIN
  PERFORM set_config('cockpit.form_issue_refusal', '', true);
  -- Waves 5-6 (20261102i): origin portal, for the onboarding form the portal opens (20261102j).
  IF p_origin IS NULL OR p_origin NOT IN ('schedule','portal') OR (p_origin = 'portal' AND p_form_key IS DISTINCT FROM 'onboarding') THEN
    PERFORM set_config('cockpit.form_issue_refusal', 'The cockpit issues with origin schedule, or portal for the onboarding form.', true);
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM set_config('cockpit.audit_source', p_origin, true);
    PERFORM public.cockpit_form_invite_issue_core(p_task_id, p_form_key, p_channels, NULL, 'ar', p_origin = 'schedule',
      coalesce(p_context, '{}'::jsonb), v_id, p_origin,
      jsonb_build_object('id', NULL, 'email', NULL, 'role', CASE WHEN p_origin = 'portal' THEN 'the portal' ELSE 'the cockpit' END,
                         'source', p_origin));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    PERFORM set_config('cockpit.form_issue_refusal', left(coalesce(v_msg, 'Refused.'), 240), true);
    RETURN NULL;
  END;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_form_invite_canary(p_form_key text, p_context jsonb, p_channels text[] DEFAULT '{copy}')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid := gen_random_uuid(); v jsonb; v_token text;
BEGIN
  PERFORM set_config('cockpit.audit_actor', 'canary', true);
  PERFORM set_config('cockpit.audit_source', 'deploy', true);
  -- Waves 5-6 (20261102i): the bank receipt's facts, when the deploy sends none (1 KWD, one payment).
  IF p_form_key = 'bank_receipt' AND NOT (coalesce(p_context, '{}'::jsonb) ? 'expectedAmount') THEN
    p_context := '{"part":"payment","partNo":1,"expectedAmount":1,"currency":"KWD"}'::jsonb || coalesce(p_context, '{}'::jsonb);
  END IF;
  v := public.cockpit_form_invite_issue_core('86eywg1cq', p_form_key, coalesce(p_channels, ARRAY['copy']), NULL, 'ar', false,
    coalesce(p_context, '{}'::jsonb), v_id, 'canary',
    jsonb_build_object('id', NULL, 'email', NULL, 'role', 'the tech lead', 'source', 'cockpit'));
  PERFORM set_config('cockpit.forms_action', 'forms.invite_link_made', true);
  v_token := public.cockpit_form_token_mint(v_id, 'copy', NULL, 'the tech lead');
  PERFORM public.cockpit_form_invite_event(v_id, 'cockpit', 'link_made', NULL, jsonb_build_object('by', 'canary'));
  PERFORM public.cockpit_form_client_link_out(v_id);
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN jsonb_build_object('inviteId', v_id, 'url', 'https://portal.maharamedia.com/f#' || v_token, 'messageId', v->'messageId');
END $$;

CREATE OR REPLACE FUNCTION public.portal_form_get(p_location_id text, p_clickup_id text, p_person text, p_access_role text,
  p_invite_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_person text := public.portal_client_ask_person(p_person); i public.cockpit_form_invites; v_state text;
BEGIN
  PERFORM public.cockpit_form_portal_workspace(p_location_id, p_clickup_id);
  PERFORM public.cockpit_form_invites_expire();
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = p_invite_id;
  IF i.id IS NULL OR i.origin = 'canary' THEN
    RETURN jsonb_build_object('reason', 'not_found');
  END IF;
  IF i.task_id <> p_clickup_id OR i.location_id IS DISTINCT FROM p_location_id THEN
    RAISE EXCEPTION 'form_invite_not_in_workspace' USING ERRCODE = '42501';
  END IF;
  v_state := public.cockpit_form_invite_state(i);
  IF v_state <> 'open' THEN RETURN jsonb_build_object('reason', v_state); END IF;
  IF public.cockpit_form_card_allows(i.task_id, i.form_key) IS NOT NULL THEN RETURN jsonb_build_object('reason', 'withdrawn'); END IF;
  IF NOT public.cockpit_form_client_live(i.form_key) THEN RETURN jsonb_build_object('reason', 'not_live'); END IF;
  IF i.audience = 'admin' AND p_access_role IS DISTINCT FROM 'admin' THEN RETURN jsonb_build_object('reason', 'admin_only'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_form_invite_events e
                  WHERE e.invite_id = i.id AND e.source = 'portal' AND e.person = v_person AND e.event = 'opened'
                    AND e.at > now() - interval '20 hours') THEN
    PERFORM set_config('cockpit.audit_source', 'portal', true);
    PERFORM public.cockpit_form_invite_event(i.id, 'portal', 'opened', v_person, '{}'::jsonb);
  END IF;
  RETURN jsonb_build_object('invite', public.cockpit_form_portal_invite(i)
    || jsonb_build_object('schema', public.cockpit_form_invite_schema(i), 'context', public.cockpit_form_client_context(i),
                          'state', 'open',
                          -- Waves 5-6 (20261102i): how many uploads each file question has left.
                          'fileSlots', public.cockpit_form_file_slots_state(i)));
END $$;

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
      'daysWaiting', v_today - (p.added_at AT TIME ZONE 'Asia/Kuwait')::date,
      -- Waves 5-6 (20261102i): the client's receipt, whether the CSM can ask for one, a likely twin.
      'receipt', public.cockpit_manual_payment_receipt(p.id),
      'askable', p.rail = 'bank_transfer' AND public.cockpit_manual_payment_receipt(p.id) IS NULL
                 AND NOT EXISTS (SELECT 1 FROM public.cockpit_form_invites fi
                                  WHERE fi.task_id = p.clickup_task_id AND fi.form_key = 'bank_receipt' AND fi.state = 'open'
                                    AND fi.expires_at > now()),
      'openReceiptInvite', (SELECT jsonb_build_object('inviteId', fi.id, 'issuedAt', fi.issued_at,
                                                      'forThisPayment', fi.context->>'manualPaymentId' = p.id)
                              FROM public.cockpit_form_invites fi
                             WHERE fi.task_id = p.clickup_task_id AND fi.form_key = 'bank_receipt' AND fi.state = 'open'
                               AND fi.expires_at > now() LIMIT 1),
      'nearMatch', public.cockpit_manual_payment_near_match(p))
      ORDER BY p.added_at, p.id)
    FROM public.cockpit_manual_payments p
    LEFT JOIN public.cockpit_billing_accounts a ON a.clickup_task_id = p.clickup_task_id
    LEFT JOIN public.cockpit_billing_inbox i ON p.source_deployment = 'billing-inbox' AND i.id::text = p.source_id
    WHERE p.check_state = 'logged' AND p.deleted_at IS NULL
      AND (v_all OR coalesce(public.cockpit_client_allowed(coalesce(a.client_name, p.client_name)), false))
  ), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_client_lifecycle_confirm(p_kind text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_who text;
  v_ceo boolean;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_task text;
  v_req uuid;
  v_acc public.cockpit_billing_accounts;
  v_dep public.cockpit_churn_departures;
  v_before public.cockpit_churn_departures;
  v_first public.cockpit_billing_events;
  v_left date; v_notice date; v_reason text; v_type text; v_why text; v_how text;
  v_mrr numeric; v_call text; v_survey text; v_survey_id uuid; v_launch date;
  v_clear boolean; v_seat text; v_source text;
  v_resp uuid; v_event bigint; v_detail jsonb; v_built jsonb; v_card text;
  v_answers jsonb; v_survey_mark boolean := false;
  v_prev_action text := current_setting('cockpit.forms_action', true);
  v_prev_legacy text := current_setting('cockpit.forms_legacy', true);
BEGIN
  -- Waves 5-6 (20261102i): Client is back (4.12) has its own act.
  IF p_kind = 'reactivate' THEN
    RETURN public.cockpit_client_reactivate(p_args);
  END IF;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in before confirming a churn.' USING ERRCODE = '42501'; END IF;
  IF p_kind IS DISTINCT FROM 'churn' THEN
    RAISE EXCEPTION 'Only a churn or a return is confirmed here.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR octet_length(p_args::text) > 12000 THEN
    RAISE EXCEPTION 'That form could not be read. Reload the page and send it again.' USING ERRCODE = '22023';
  END IF;
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT (v_ceo OR coalesce(public.cockpit_has_role('csm'), false)) THEN
    RAISE EXCEPTION 'Confirming a churn needs a client success or CEO seat. Ask an admin to add the role.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(u.email)) INTO v_who FROM auth.users u WHERE u.id = v_uid;

  v_task := btrim(coalesce(p_args->>'taskId', ''));
  IF v_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN RAISE EXCEPTION 'That is not a ClickUp card id.' USING ERRCODE = '22023'; END IF;
  BEGIN
    v_req := (p_args->>'requestId')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN v_req := NULL;
  END;
  IF v_req IS NULL THEN
    RAISE EXCEPTION 'That form could not be read. Reload the page and send it again.' USING ERRCODE = '22023';
  END IF;

  -- One confirm at a time per card: the second press waits, then finds the first.
  SELECT * INTO v_acc FROM public.cockpit_billing_accounts WHERE clickup_task_id = v_task FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That client card is not on the billing sheet. Refresh the page and pick it again.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_ceo AND NOT coalesce(public.cockpit_client_allowed(v_acc.client_name), false) THEN
    RAISE EXCEPTION '% is not one of your clients. Ask its CSM or the CEO to confirm the churn.', v_acc.client_name
      USING ERRCODE = '42501';
  END IF;

  -- A repeat of the same press returns the first result and writes nothing.
  SELECT * INTO v_first FROM public.cockpit_billing_events e
   WHERE e.clickup_task_id = v_task AND e.kind = 'churn' AND e.detail->>'request_id' = v_req::text
   ORDER BY e.id LIMIT 1;
  IF FOUND THEN
    SELECT q.state INTO v_card FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key = 'billing:' || v_first.id;
    RETURN jsonb_build_object('departureId', (v_first.detail->>'departure_id')::bigint, 'eventId', v_first.id,
      'responseId', v_first.detail->>'response_id',
      'cardState', CASE WHEN v_card IS NULL THEN 'none' WHEN v_card = 'dry_run' THEN 'held' ELSE v_card END,
      'repeat', true);
  END IF;

  -- What the form says, checked as the form checks it (formDefs churn_confirm).
  BEGIN
    v_left := (p_args->>'leftOn')::date;
  EXCEPTION WHEN OTHERS THEN v_left := NULL;
  END;
  IF v_left IS NULL OR v_left > v_today OR v_left < date '2025-01-01' THEN
    RAISE EXCEPTION 'Pick the day they left, today or before.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_args->>'noticeOn', '')), '') IS NOT NULL THEN
    BEGIN
      v_notice := (p_args->>'noticeOn')::date;
    EXCEPTION WHEN OTHERS THEN v_notice := NULL;
    END;
    IF v_notice IS NULL OR v_notice > v_today OR v_notice < date '2025-01-01' THEN
      RAISE EXCEPTION 'Pick the day the notice came, today or before.' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_reason := p_args->>'reason';
  IF v_reason IS NULL OR v_reason NOT IN ('Cancelled', 'Refund', 'Chargeback', 'Non-payment 14+ days',
       'Paused past 14 days', 'Ghosted', 'Completed term, did not renew', 'Other') THEN
    RAISE EXCEPTION 'Pick the reason they left.' USING ERRCODE = '22023';
  END IF;
  v_type := p_args->>'churnType';
  IF v_type IS NULL OR v_type NOT IN ('mid_programme', 'completed') THEN
    RAISE EXCEPTION 'Pick the churn type.' USING ERRCODE = '22023';
  END IF;
  v_why := left(btrim(regexp_replace(coalesce(p_args->>'whyDetail', ''), '\s+', ' ', 'g')), 2000);
  IF char_length(v_why) < 10 THEN
    RAISE EXCEPTION 'Say why they left in detail, so the lock-in reads back.' USING ERRCODE = '22023';
  END IF;
  v_how := left(btrim(regexp_replace(coalesce(p_args->>'howToStop', ''), '\s+', ' ', 'g')), 2000);
  IF char_length(v_how) < 10 THEN
    RAISE EXCEPTION 'Say how we stop this next time.' USING ERRCODE = '22023';
  END IF;
  IF p_args ? 'mrrLostUsd' AND p_args->'mrrLostUsd' <> 'null'::jsonb THEN
    IF jsonb_typeof(p_args->'mrrLostUsd') IS DISTINCT FROM 'number' OR (p_args->>'mrrLostUsd')::numeric < 0
       OR (p_args->>'mrrLostUsd')::numeric > 1000000 THEN
      RAISE EXCEPTION 'MRR lost is a dollar amount, 0 or more.' USING ERRCODE = '22023';
    END IF;
    v_mrr := round((p_args->>'mrrLostUsd')::numeric, 2);
  END IF;
  v_call := nullif(left(btrim(coalesce(p_args->>'exitCallId', '')), 200), '');
  v_survey := coalesce(nullif(p_args->>'surveyState', ''), 'not_sent');
  IF v_survey NOT IN ('not_sent', 'sent', 'filled', 'declined') THEN
    RAISE EXCEPTION 'Pick what happened with the exit survey.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_args->>'surveyResponseId', '')), '') IS NOT NULL THEN
    BEGIN
      v_survey_id := (p_args->>'surveyResponseId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN v_survey_id := NULL;
    END;
    IF v_survey_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.cockpit_form_responses r
         WHERE r.id = v_survey_id AND r.form_key = 'exit_survey' AND r.task_id = v_task) THEN
      RAISE EXCEPTION 'That termination survey is not this client''s. Pick the card on the survey first.' USING ERRCODE = '22023';
    END IF;
    -- A card found only by the link's hidden id (20261101l) is no proof: a
    -- person ticks that the survey is this client's before it is attached.
    SELECT coalesce(r.answer_meta->>'match', '') = 'hidden_id_unverified' AND NOT (r.answer_meta ? 'matched')
      INTO v_survey_mark FROM public.cockpit_form_responses r WHERE r.id = v_survey_id;
    IF v_survey_mark AND p_args->'surveyConfirmed' IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'This survey came with the client''s link, and nobody has checked it is theirs. Tick "This survey is from this client" if it is, or send the form without the survey.'
        USING ERRCODE = '22023';
    END IF;
    v_survey := 'filled';
  END IF;

  v_seat := CASE WHEN v_ceo THEN 'ceo' ELSE 'csm' END;
  v_source := v_seat;
  v_clear := v_acc.paused_on IS NOT NULL;

  -- The card's open departure: not removed, not confirmed, and no resume after
  -- it (W21). Otherwise a new departure; the (task, left_on) index refuses a
  -- second row on the same day.
  SELECT * INTO v_before FROM public.cockpit_churn_departures d
   WHERE d.clickup_task_id = v_task AND d.removed_at IS NULL
   ORDER BY d.left_on DESC, d.id DESC LIMIT 1 FOR UPDATE;
  IF FOUND AND (v_before.confirmed_at IS NOT NULL OR EXISTS (
       SELECT 1 FROM public.cockpit_billing_events e
        WHERE e.clickup_task_id = v_task AND e.kind = 'resume'
          AND (e.at AT TIME ZONE 'Asia/Kuwait')::date > v_before.left_on
          AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id))) THEN
    v_before := NULL;
  END IF;

  SELECT s.launch_date INTO v_launch FROM public.cockpit_client_billing_days s
   WHERE s.clickup_task_id = v_task ORDER BY s.day DESC LIMIT 1;

  BEGIN
    IF v_before.id IS NOT NULL THEN
      v_launch := coalesce(v_before.launched_on, v_launch);
      UPDATE public.cockpit_churn_departures SET
        left_on = v_left,
        launched_on = CASE WHEN v_launch IS NOT NULL AND v_launch <= v_left THEN v_launch END,
        reason = v_reason,
        mrr_lost_usd = CASE WHEN p_args ? 'mrrLostUsd' THEN v_mrr ELSE mrr_lost_usd END,
        notice_on = v_notice, exit_call_id = v_call,
        survey_response_id = coalesce(v_survey_id, survey_response_id),
        survey_state = CASE WHEN survey_response_id IS NOT NULL AND v_survey_id IS NULL THEN 'filled' ELSE v_survey END,
        why_detail = v_why, how_to_stop = v_how, churn_type = v_type,
        confirmed_by = v_who, confirmed_at = now(), updated_by = v_who, updated_at = now()
      WHERE id = v_before.id
      RETURNING * INTO v_dep;
    ELSE
      INSERT INTO public.cockpit_churn_departures(client, clickup_task_id, left_on, launched_on, reason, mrr_lost_usd, csm,
        source, created_by, updated_by, notice_on, exit_call_id, survey_response_id, survey_state, why_detail, how_to_stop,
        churn_type, confirmed_by, confirmed_at)
      VALUES (v_acc.client_name, v_task, v_left, CASE WHEN v_launch IS NOT NULL AND v_launch <= v_left THEN v_launch END,
        v_reason, coalesce(v_mrr, CASE WHEN p_args ? 'mrrLostUsd' THEN NULL ELSE v_acc.mrr_usd END), v_acc.csm,
        'cockpit', v_who, v_who, v_notice, v_call, v_survey_id, v_survey, v_why, v_how, v_type, v_who, now())
      RETURNING * INTO v_dep;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This client already has a departure on %; confirm that one.', to_char(v_left, 'FMDD Mon YYYY')
      USING ERRCODE = '22023';
  END;

  -- The person's tick on a survey found by the link's hidden id: kept on the
  -- survey (by role, never an address) and in its audit row.
  IF v_survey_mark THEN
    PERFORM set_config('cockpit.forms_action', 'forms.survey_confirmed', true);
    PERFORM set_config('cockpit.forms_legacy', 'confirm', true);
    UPDATE public.cockpit_form_responses r SET answer_meta = r.answer_meta || jsonb_build_object(
             'match', 'confirmed_by_person',
             'matched', jsonb_build_object('by', CASE WHEN v_ceo THEN 'the CEO' ELSE 'the CSM' END, 'at', now(),
                                           'via', 'churn_confirm', 'taskId', v_task, 'departureId', v_dep.id))
     WHERE r.id = v_survey_id;
    PERFORM set_config('cockpit.forms_legacy', coalesce(v_prev_legacy, ''), true);
    PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
  END IF;

  -- The staff form's record (20261101l): one response per request id.
  v_answers := jsonb_strip_nulls(jsonb_build_object(
    'leftOn', v_left, 'noticeOn', v_notice, 'reason', v_reason, 'churnType', v_type,
    'whyDetail', v_why, 'howToStop', v_how, 'mrrLostUsd', v_mrr, 'exitCallId', v_call,
    'surveyState', v_dep.survey_state, 'surveyResponseId', v_dep.survey_response_id));
  v_resp := public.cockpit_form_staff_record('churn_confirm', v_task, v_answers, v_req, 'cockpit');

  -- The event's detail, through the one builder (20261101m). Keys the builder
  -- leaves out are filled from this confirm, so the card write always has the
  -- shape of contract 3.3.
  v_built := public.cockpit_billing_detail('churn', jsonb_build_object(
    'taskId', v_task, 'leftOn', v_left, 'noticeOn', v_notice, 'reason', v_reason, 'churnType', v_type,
    'whyDetail', v_why, 'howToStop', v_how, 'surveyState', v_dep.survey_state, 'exitCallId', v_call,
    'departureId', v_dep.id, 'responseId', v_resp, 'requestId', v_req, 'seatRole', v_seat,
    'clearPaused', v_clear, 'cardType', public.cockpit_churn_type_card(v_type)));
  v_detail := jsonb_build_object(
    'left_on', v_left, 'card_reason', public.cockpit_churn_reason_card(v_reason),
    'card_type', public.cockpit_churn_type_card(v_type), 'clear_paused', v_clear,
    'departure_id', v_dep.id, 'response_id', v_resp, 'request_id', v_req, 'seat_role', v_seat,
    'why_detail', v_why, 'notice_on', v_notice, 'survey_state', v_dep.survey_state, 'churn_type', v_type)
    || jsonb_strip_nulls(coalesce(v_built, '{}'::jsonb));

  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (v_task, v_acc.client_name, 'churn', v_acc.client_status, 'Stopped', v_reason, v_detail, v_source, v_who)
  RETURNING id INTO v_event;
  UPDATE public.cockpit_churn_departures SET billing_event_id = v_event WHERE id = v_dep.id RETURNING * INTO v_dep;

  -- The mirror follows the decision until the card confirms it (billing-sync
  -- keeps a cockpit edit while its item waits, 20261101m).
  UPDATE public.cockpit_billing_accounts SET
    client_status = 'Stopped', stage = 'Stopped', stage_group = 'gone', churn_date = v_left,
    paused_on = CASE WHEN v_clear THEN NULL ELSE paused_on END,
    source = v_source, synced_at = now()
  WHERE clickup_task_id = v_task;

  -- "Client has left" in #csm-announcements (20261101l). A notice that cannot
  -- be queued never undoes the confirm; the queue says why.
  BEGIN
    PERFORM public.cockpit_slack_notice_queue('churn.confirmed', 'churn:' || v_dep.id, v_task, v_acc.client_name,
      jsonb_build_object('taskId', v_task, 'client', v_acc.client_name, 'departureId', v_dep.id,
                         'reason', v_reason, 'leftOn', v_left),
      NULL, 'queued', NULL);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_slack_notice_queue_failed('A churn notice could not be queued: ' || SQLERRM);
  END;

  INSERT INTO public.cockpit_churn_log(by_whom, what, detail)
  VALUES (v_who, 'confirmed ' || v_acc.client_name || ' leaving',
          jsonb_build_object('client', v_acc.client_name, 'departureId', v_dep.id, 'eventId', v_event,
                             'responseId', v_resp, 'leftOn', v_left, 'reason', v_reason, 'churnType', v_type));
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('churn.confirm', 'cockpit_churn_departures', v_dep.id::text, v_who,
          CASE WHEN v_ceo THEN 'media-buyer-cockpit' ELSE 'client-success-cockpit' END, 'supabase',
          CASE WHEN v_before.id IS NOT NULL THEN to_jsonb(v_before) END, to_jsonb(v_dep),
          jsonb_build_object('event_id', v_event, 'response_id', v_resp, 'request_id', v_req)
            || CASE WHEN v_survey_mark THEN jsonb_build_object('survey_confirmed', true, 'survey_response_id', v_survey_id)
                    ELSE '{}'::jsonb END);

  SELECT q.state INTO v_card FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key = 'billing:' || v_event;
  RETURN jsonb_build_object('departureId', v_dep.id, 'eventId', v_event, 'responseId', v_resp,
    'cardState', CASE WHEN v_card IS NULL THEN 'none' WHEN v_card = 'dry_run' THEN 'held' ELSE v_card END);
END $$;
COMMENT ON FUNCTION public.cockpit_client_lifecycle_confirm(text, jsonb) IS
  'Client is leaving / Confirm churn (contract W34 3.1) and, since 20261102i, Client is back (reactivate, W56 4.12): the CEO, or a CSM allowed on the client. churn: updates the card''s open departure or inserts one, records churn_confirm, one billing event churn, queues churn.confirmed. reactivate: needs a confirmed departure that has not returned; one billing event reactivate, the departure''s returned_on, an mrr event when the MRR differs, one reactivation win, client.reactivated, a reactivate response. A repeated requestId returns the first result.';

CREATE OR REPLACE FUNCTION public.cockpit_csm_churn_read()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  uid uuid; today date := (now() AT TIME ZONE 'Asia/Kuwait')::date; mon text; src jsonb; roster jsonb; starts jsonb;
  v_in jsonb; v_notices jsonb; v_unmatched jsonb; v_stopped jsonb;
BEGIN
  uid := public.cockpit_csm_actor(); mon := to_char(today, 'YYYY-MM');
  src := public.cockpit_csm_source_read()->'tables';
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', c->>'taskId', 'name', c->>'name', 'stage', coalesce(c->>'stage', ''),
    'launchedOn', c->>'launchDate', 'csm', c->>'csmAssigned', 'pausedSince', c->>'pausedSince', 'pausedDays', c->'pausedDays')), '[]')
    INTO roster FROM jsonb_array_elements(src->'clients') c;
  SELECT coalesce(jsonb_agg(jsonb_build_object('month', months.mon, 'day', r.data->>'day', 'paying', r.data->'paying') ORDER BY months.mon), '[]')
    INTO starts
    FROM (SELECT to_char(generate_series(date_trunc('month', today) - interval '3 months', date_trunc('month', today), interval '1 month'), 'YYYY-MM') mon) months
    LEFT JOIN LATERAL (SELECT d AS data FROM jsonb_array_elements(src->'rosterDays') d WHERE d->>'month' = months.mon ORDER BY d->>'day' LIMIT 1) r ON true;

  -- The derived notice rows (20261101l): its own scope rules, so a CSM sees
  -- matched notices of their clients and every unmatched one (W22).
  v_in := coalesce(public.cockpit_form_notices_in(), '[]'::jsonb);
  SELECT coalesce(jsonb_agg(n || jsonb_build_object(
           -- A portal or link exit survey (20261102b) has flat answers; a Typeform one a field list.
           'ratings', CASE WHEN r.invite_id IS NOT NULL THEN public.cockpit_exit_survey_native_ratings(r.answers)
                           ELSE public.cockpit_churn_survey_ratings(r.answers) END,
           'typeDefault', public.cockpit_churn_type_default(n->>'taskId', today))
         ORDER BY n->>'submittedAt' DESC), '[]')
    INTO v_notices
    FROM jsonb_array_elements(v_in) n
    LEFT JOIN public.cockpit_form_responses r ON r.id::text = n->>'responseId'
   WHERE n->>'kind' = 'termination' AND (n->>'matched')::boolean IS TRUE;
  SELECT coalesce(jsonb_agg(n ORDER BY n->>'submittedAt' DESC), '[]')
    INTO v_unmatched
    FROM jsonb_array_elements(v_in) n
   WHERE n->>'kind' = 'termination' AND (n->>'matched')::boolean IS NOT TRUE;

  -- Stopped on the card with no departure in the register: a review list,
  -- never a bulk write (Q5). stoppedSince is NULL when every snapshot of the
  -- card reads Stopped, so the day it stopped is not known.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'taskId', b.clickup_task_id, 'clientName', b.client_name, 'churnDate', b.churn_date,
           'mrrUsd', b.mrr_usd, 'csm', b.csm,
           'stoppedSince', (SELECT min(s.day) FROM public.cockpit_client_billing_days s
                             WHERE s.clickup_task_id = b.clickup_task_id AND s.stage = 'Stopped'
                               AND s.day > (SELECT max(o.day) FROM public.cockpit_client_billing_days o
                                             WHERE o.clickup_task_id = b.clickup_task_id AND o.stage IS DISTINCT FROM 'Stopped')),
           'typeDefault', public.cockpit_churn_type_default(b.clickup_task_id, coalesce(b.churn_date, today)))
         ORDER BY b.churn_date DESC NULLS LAST, b.client_name), '[]')
    INTO v_stopped
    FROM public.cockpit_billing_accounts b
   WHERE b.client_status = 'Stopped'
     AND public.cockpit_client_allowed(b.client_name)
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_churn_departures d
                      WHERE d.clickup_task_id = b.clickup_task_id AND d.removed_at IS NULL AND d.returned_on IS NULL);

  RETURN jsonb_build_object('today', today, 'month', mon,
    'me', jsonb_build_object('email', (SELECT email FROM auth.users WHERE id = uid), 'isCeo', public.cockpit_is_ceo(),
                             'isAdmin', public.cockpit_has_role('admin')),
    'deps', coalesce((SELECT jsonb_agg(to_jsonb(d) || jsonb_build_object(
               'confirmed_role', CASE WHEN d.confirmed_at IS NULL THEN NULL
                                      WHEN d.confirmed_by LIKE 'the CEO%' THEN 'the CEO'
                                      ELSE coalesce(public.cockpit_slack_notice_role_of(d.confirmed_by), 'a team member') END,
               'card_state', CASE WHEN d.billing_event_id IS NULL THEN NULL
                                  ELSE coalesce((SELECT CASE q.state WHEN 'dry_run' THEN 'held' ELSE q.state END
                                                   FROM public.cockpit_clickup_writeback_queue q
                                                  WHERE q.dedupe_key = 'billing:' || d.billing_event_id), 'none') END,
               'card_error', (SELECT left(q.error, 240) FROM public.cockpit_clickup_writeback_queue q
                               WHERE q.dedupe_key = 'billing:' || d.billing_event_id AND q.state IN ('failed', 'skipped')),
               'churn_type_default', CASE WHEN d.clickup_task_id IS NOT NULL
                                          THEN public.cockpit_churn_type_default(d.clickup_task_id, d.left_on) END,
               -- The departure's exit survey invite (20261102b): its own, else the card's latest with no departure named.
               'surveyInvite', CASE WHEN d.clickup_task_id IS NOT NULL
                                    THEN public.cockpit_exit_survey_invite_for(d.clickup_task_id, d.id) END,
               -- Waves 5-6 (20261102i): Client is back.
               'returnedOn', d.returned_on,
               'backWords', CASE WHEN d.returned_on IS NOT NULL THEN 'Back since ' || public.cockpit_billing_day_words(d.returned_on) END,
               'returned_role', CASE WHEN d.returned_on IS NULL THEN NULL
                                     ELSE coalesce(public.cockpit_slack_notice_role_of(d.returned_by), 'a team member') END)
             ORDER BY left_on DESC, id DESC)
             FROM public.cockpit_churn_departures d WHERE removed_at IS NULL AND public.cockpit_client_allowed(client)), '[]'),
    'monthRows', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY month) FROM public.cockpit_churn_months m WHERE public.cockpit_csm_scope_all()), '[]'),
    'cards', coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM public.cockpit_billing_accounts b WHERE public.cockpit_client_allowed(client_name)), '[]'),
    'log', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY at DESC) FROM public.cockpit_churn_log l
                      WHERE public.cockpit_csm_scope_all() OR public.cockpit_client_allowed(coalesce(detail->>'client', detail->'after'->>'client', detail->'before'->>'client'))), '[]'),
    'roster', jsonb_build_object('cards', roster, 'starts', starts,
      'left', coalesce((SELECT jsonb_agg(jsonb_build_object('key', e->>'key', 'name', e->>'name', 'day', e->>'day', 'to', coalesce(e->>'to', e->>'kind')))
                          FROM jsonb_array_elements(src->'churnEvents') e
                         WHERE e->>'kind' IN ('lost', 'removed', 'offboarded') AND e->>'month' >= to_char(today - interval '3 months', 'YYYY-MM')), '[]')),
    'notices', v_notices,
    'unmatched', v_unmatched,
    'stoppedNotInRegister', v_stopped);
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_form_prefill(p_form_key text, p_task_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_today date := public.cockpit_billing_today();
  a public.cockpit_billing_accounts;
  v_values jsonb := '[]'::jsonb;
  v_calls jsonb;
  v_hints jsonb := '[]'::jsonb;
  v_grant jsonb;
  v_survey jsonb;
  v_type jsonb;
  v_last jsonb;
  v_checkin record;
  v_late record;
  v_card text := 'the ClickUp card';
  -- Waves 3-4 (20261102b): the pause consent and the exit survey's invite.
  v_consent jsonb;
  v_invite jsonb;
  -- Waves 5-6 (20261102i): Client is back.
  v_dep public.cockpit_churn_departures;
  v_dep_json jsonb;
BEGIN
  PERFORM public.cockpit_billing_read_gate();
  IF p_form_key IS NULL OR p_form_key NOT IN ('extension','pause','resume','churn_confirm','mrr','reactivate') THEN
    RAISE EXCEPTION 'That is not one of the staff forms.' USING ERRCODE = '22023';
  END IF;
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'That is not a ClickUp card id.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM public.cockpit_billing_accounts WHERE clickup_task_id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That client card is not on the billing sheet. Refresh the page and pick it again.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.cockpit_billing_reader_ok(a.client_name) THEN
    RAISE EXCEPTION '% is not one of your clients in the portal.', a.client_name USING ERRCODE = '42501';
  END IF;

  -- The card's last 30 days of calls and 1-1 notes, newest first.
  SELECT coalesce(jsonb_agg(c ORDER BY c->>'at' DESC), '[]'::jsonb) INTO v_calls FROM (
    SELECT jsonb_build_object('id', k.id::text, 'at', k.starts_at, 'kind', k.kind,
             'source', CASE k.source WHEN 'fathom' THEN 'Fathom' WHEN 'ghl_appointment' THEN 'the booking'
                                     WHEN 'zoom' THEN 'Zoom' WHEN 'checkin_form' THEN 'the 1-1 notes'
                                     ELSE 'the call log' END
                       || ', ' || public.cockpit_billing_day_words((k.starts_at AT TIME ZONE 'Asia/Kuwait')::date),
             'title', k.title) AS c
      FROM public.cockpit_csm_calls k
     WHERE k.task_id = p_task_id AND k.starts_at >= now() - interval '30 days' AND k.starts_at <= now()
       AND coalesce(k.status, '') NOT IN ('cancelled','canceled','no_show','noshow')
    UNION ALL
    SELECT jsonb_build_object('id', r.id::text, 'at', coalesce(r.submitted_at, r.created_at), 'kind', 'checkin',
             'source', 'the 1-1 notes, ' || public.cockpit_billing_day_words((coalesce(r.submitted_at, r.created_at) AT TIME ZONE 'Asia/Kuwait')::date),
             'title', '1-1 notes')
      FROM public.cockpit_form_responses r
     WHERE r.form_key = 'checkin' AND r.task_id = p_task_id AND r.state IN ('submitted','confirmed')
       AND coalesce(r.submitted_at, r.created_at) >= now() - interval '30 days'
  ) t;
  v_last := CASE WHEN jsonb_array_length(v_calls) > 0 THEN v_calls->0 END;

  -- An extension hint when the latest 1-1 notes in 30 days mention one.
  SELECT r.id, coalesce(r.submitted_at, r.created_at) AS at, r.answers INTO v_checkin
    FROM public.cockpit_form_responses r
   WHERE r.form_key = 'checkin' AND r.task_id = p_task_id AND r.state IN ('submitted','confirmed')
     AND coalesce(r.submitted_at, r.created_at) >= now() - interval '30 days'
   ORDER BY coalesce(r.submitted_at, r.created_at) DESC LIMIT 1;
  IF v_checkin.id IS NOT NULL AND v_checkin.answers::text ILIKE '%extension%' THEN
    v_hints := v_hints || jsonb_build_array(jsonb_build_object('text', 'The last 1-1 notes mention an extension',
      'source', 'the 1-1 notes, ' || public.cockpit_billing_day_words((v_checkin.at AT TIME ZONE 'Asia/Kuwait')::date)));
  END IF;

  SELECT jsonb_build_object('grantId', x.grant_id, 'weeks', x.weeks, 'from', x.from_date, 'until', x.until,
           'grantedOn', x.granted_on, 'reason', x.reason, 'seatRole', x.seat_role) INTO v_grant
    FROM public.cockpit_extensions_v x WHERE x.clickup_task_id = p_task_id AND x.state = 'live'
   ORDER BY x.grant_id DESC LIMIT 1;

  -- unverified: the card came only from the link's unsigned hidden id (20261101l), so the survey fills
  -- nothing until the CSM says it is this client's.
  -- A portal or link survey (20261102b) is on the card by its invite, so it is verified.
  SELECT jsonb_build_object('responseId', r.id, 'submittedAt', r.submitted_at, 'state', r.state,
           'noticeOn', coalesce(r.answer_meta->>'notice_on', ((r.submitted_at AT TIME ZONE 'Asia/Kuwait')::date)::text),
           'unverified', coalesce(r.answer_meta->>'match' = 'hidden_id_unverified', false),
           'native', r.invite_id IS NOT NULL, 'inviteId', r.invite_id,
           'via', CASE WHEN r.invite_id IS NULL THEN 'typeform' WHEN r.source = 'portal' THEN 'portal' ELSE 'link' END) INTO v_survey
    FROM public.cockpit_form_responses r
   WHERE r.form_key = 'exit_survey' AND r.task_id = p_task_id AND r.state <> 'void' AND r.mode = 'live'
     AND (r.invite_id IS NULL OR EXISTS (SELECT 1 FROM public.cockpit_form_invites i
                                          WHERE i.id = r.invite_id AND i.task_id = r.task_id AND i.origin <> 'canary'))
   ORDER BY r.submitted_at DESC NULLS LAST LIMIT 1;
  IF p_form_key = 'pause' THEN
    v_consent := public.cockpit_pause_consent_for(p_task_id)
                 || jsonb_build_object('live', coalesce(public.cockpit_form_client_live('pause_consent'), false));
  ELSIF p_form_key = 'churn_confirm' THEN
    v_invite := public.cockpit_exit_survey_invite_for(p_task_id, NULL);
  END IF;

  SELECT l.due_on, l.days_late INTO v_late FROM public.cockpit_late_payments_v l
   WHERE l.clickup_task_id = p_task_id AND l.closed_how = 'open' ORDER BY l.due_on DESC LIMIT 1;

  IF p_form_key = 'reactivate' THEN
    SELECT * INTO v_dep FROM public.cockpit_churn_departures d
     WHERE d.clickup_task_id = p_task_id AND d.removed_at IS NULL AND d.confirmed_at IS NOT NULL AND d.returned_on IS NULL
     ORDER BY d.left_on DESC, d.id DESC LIMIT 1;
    v_dep_json := CASE WHEN v_dep.id IS NOT NULL THEN jsonb_build_object(
        'id', v_dep.id, 'leftOn', v_dep.left_on, 'reason', v_dep.reason, 'churnType', v_dep.churn_type,
        'mrrLostUsd', v_dep.mrr_lost_usd,
        'words', 'Left on ' || public.cockpit_billing_day_words(v_dep.left_on) || ' · ' || coalesce(v_dep.reason, 'no reason given')
                 || ' · ' || CASE v_dep.churn_type WHEN 'mid_programme' THEN 'mid-programme' WHEN 'completed' THEN 'completed term'
                                                   ELSE 'type not set' END) END;
  END IF;

  CASE p_form_key
  WHEN 'reactivate' THEN
    v_values := jsonb_build_array(
      jsonb_build_object('key', 'departureId', 'value', v_dep.id,
        'source', CASE WHEN v_dep.id IS NOT NULL THEN 'the churn register, confirmed ' || public.cockpit_billing_day_words((v_dep.confirmed_at AT TIME ZONE 'Asia/Kuwait')::date)
                       ELSE 'No confirmed churn in the register.' END),
      jsonb_build_object('key', 'returnOn', 'value', v_today, 'source', 'today'),
      jsonb_build_object('key', 'status', 'value', NULL, 'source', 'Nobody holds this yet: pick Active, or Onboarding again if they start over.'),
      jsonb_build_object('key', 'nextPaymentDate', 'value', NULL, 'source', 'Set it when they pay again on a known day.'),
      CASE WHEN a.mrr_usd IS NOT NULL AND a.mrr_usd > 0 THEN jsonb_build_object('key', 'mrrUsd', 'value', a.mrr_usd, 'source', v_card)
           WHEN v_dep.mrr_lost_usd IS NOT NULL THEN jsonb_build_object('key', 'mrrUsd', 'value', v_dep.mrr_lost_usd, 'source', 'the MRR they left with')
           ELSE jsonb_build_object('key', 'mrrUsd', 'value', NULL, 'source', 'The card has no MRR.') END,
      jsonb_build_object('key', 'agreementUrl', 'value', NULL, 'source', 'Add the signed agreement link; the reactivation pay waits for it.'),
      CASE WHEN v_last IS NOT NULL THEN jsonb_build_object('key', 'callId', 'value', NULL,
                  'source', 'Pick the call if there was one; the calls of the last 30 days are listed.')
           ELSE jsonb_build_object('key', 'callId', 'value', NULL, 'source', 'No call or 1-1 notes on this client in the last 30 days.') END);
  WHEN 'extension' THEN
    v_values := jsonb_build_array(
      CASE WHEN v_last IS NOT NULL THEN jsonb_build_object('key', 'callId', 'value', v_last->>'id', 'source', v_last->>'source')
           ELSE jsonb_build_object('key', 'callId', 'value', NULL, 'source', 'No call or 1-1 notes on this client in the last 30 days.') END);
  WHEN 'pause' THEN
    v_values := jsonb_build_array(
      CASE WHEN v_late.due_on IS NOT NULL
           THEN jsonb_build_object('key', 'pauseKind', 'value', 'non_payment',
                  'source', format('the late-payment record: due %s, %s days late', public.cockpit_billing_day_words(v_late.due_on), v_late.days_late))
           ELSE jsonb_build_object('key', 'pauseKind', 'value', NULL, 'source', 'Nobody holds this yet: say whether the client asked or is not paying.') END,
      CASE WHEN v_last IS NOT NULL THEN jsonb_build_object('key', 'callId', 'value', v_last->>'id', 'source', v_last->>'source')
           ELSE jsonb_build_object('key', 'callId', 'value', NULL, 'source', 'No call or 1-1 notes on this client in the last 30 days.') END);
  WHEN 'resume' THEN
    v_values := jsonb_build_array(
      jsonb_build_object('key', 'on', 'value', v_today, 'source', 'today'),
      CASE WHEN a.next_payment_date IS NOT NULL AND a.paused_on IS NOT NULL
           THEN jsonb_build_object('key', 'nextDate', 'value', a.next_payment_date + greatest(0, v_today - a.paused_on),
                  'source', format('the ClickUp card: its date %s plus %s paused days',
                                   public.cockpit_billing_day_words(a.next_payment_date), greatest(0, v_today - a.paused_on)))
           ELSE jsonb_build_object('key', 'nextDate', 'value', NULL,
                  'source', CASE WHEN a.paused_on IS NULL THEN 'The card has no Paused On date, so no next date is suggested.'
                                 ELSE 'The card has no Next Payment Date, so no next date is suggested.' END) END);
  WHEN 'churn_confirm' THEN
    IF to_regprocedure('public.cockpit_churn_type_default(text,date)') IS NOT NULL THEN
      EXECUTE 'SELECT to_jsonb(public.cockpit_churn_type_default($1, $2))' INTO v_type USING p_task_id, v_today;
    END IF;
    v_values := jsonb_build_array(
      jsonb_build_object('key', 'leftOn', 'value', NULL, 'source', 'Nobody holds this yet: pick the day they left.'),
      CASE WHEN v_survey->'unverified' = 'true'::jsonb
           THEN jsonb_build_object('key', 'noticeOn', 'value', NULL,
                  'source', 'The termination survey''s card came from its link, not checked: pick the notice day if it is this client''s.')
           WHEN v_survey IS NOT NULL
           THEN jsonb_build_object('key', 'noticeOn', 'value', v_survey->>'noticeOn',
                  'source', 'the termination survey, ' || public.cockpit_billing_day_words((v_survey->>'noticeOn')::date))
           ELSE jsonb_build_object('key', 'noticeOn', 'value', NULL, 'source', 'No termination survey from this client.') END,
      jsonb_build_object('key', 'reason', 'value', NULL, 'source', 'Nobody holds this yet: pick why they left.'),
      CASE WHEN v_type IS NOT NULL AND jsonb_typeof(v_type) = 'string'
           THEN jsonb_build_object('key', 'churnType', 'value', v_type #>> '{}', 'source', 'the day-90 rule')
           ELSE jsonb_build_object('key', 'churnType', 'value', NULL, 'source', 'The day-90 rule is not live yet: pick the type.') END,
      CASE WHEN a.mrr_usd IS NOT NULL THEN jsonb_build_object('key', 'mrrLostUsd', 'value', a.mrr_usd, 'source', v_card)
           ELSE jsonb_build_object('key', 'mrrLostUsd', 'value', NULL, 'source', 'The card has no MRR.') END,
      CASE WHEN v_survey->'unverified' = 'true'::jsonb
           THEN jsonb_build_object('key', 'surveyState', 'value', NULL,
                  'source', 'The termination survey''s card came from its link, not checked: say whether this client filled it.')
           WHEN v_survey IS NOT NULL THEN jsonb_build_object('key', 'surveyState', 'value', 'filled',
                  'source', 'the termination survey, ' || public.cockpit_billing_day_words((v_survey->>'noticeOn')::date))
           WHEN v_invite->>'state' = 'open' THEN jsonb_build_object('key', 'surveyState', 'value', 'sent',
                  'source', 'the exit survey, sent ' || public.cockpit_billing_day_words(((v_invite->>'issuedAt')::timestamptz AT TIME ZONE 'Asia/Kuwait')::date))
           ELSE jsonb_build_object('key', 'surveyState', 'value', NULL, 'source', 'No termination survey from this client.') END,
      -- Never preselected: the latest call is not the exit call unless the CSM says so.
      CASE WHEN v_last IS NOT NULL THEN jsonb_build_object('key', 'exitCallId', 'value', NULL,
                  'source', 'Pick the exit call if there was one; the calls of the last 30 days are listed.')
           ELSE jsonb_build_object('key', 'exitCallId', 'value', NULL, 'source', 'No call or 1-1 notes on this client in the last 30 days.') END);
  WHEN 'mrr' THEN
    v_values := jsonb_build_array(
      CASE WHEN a.mrr_usd IS NOT NULL THEN jsonb_build_object('key', 'mrrUsd', 'value', a.mrr_usd, 'source', v_card)
           ELSE jsonb_build_object('key', 'mrrUsd', 'value', NULL, 'source', 'The card has no MRR yet.') END,
      jsonb_build_object('key', 'effective', 'value', v_today, 'source', 'today'));
  END CASE;

  RETURN jsonb_build_object(
    'formKey', p_form_key, 'taskId', p_task_id, 'clientName', a.client_name,
    'values', v_values, 'calls', v_calls, 'hints', v_hints,
    'card', jsonb_build_object(
      'status', jsonb_build_object('value', a.client_status, 'source', v_card),
      'nextDate', jsonb_build_object('value', a.next_payment_date, 'source', v_card),
      'nextAmountUsd', jsonb_build_object('value', a.next_payment_usd, 'source', v_card),
      'plan', jsonb_build_object('value', a.payment_plan, 'source', v_card),
      'mrrUsd', jsonb_build_object('value', a.mrr_usd, 'source', v_card),
      'pausedOn', jsonb_build_object('value', a.paused_on, 'source', v_card),
      'extensionWeeks', jsonb_build_object('value', a.extension_weeks, 'source', v_card),
      'syncedAt', a.synced_at),
    'grant', v_grant, 'survey', v_survey,
    'consent', v_consent, 'surveyInvite', v_invite,
    'late', CASE WHEN v_late.due_on IS NOT NULL THEN jsonb_build_object('dueOn', v_late.due_on, 'daysLate', v_late.days_late) END,
    'departure', CASE WHEN p_form_key = 'reactivate' THEN v_dep_json END,
    'refusal', CASE WHEN p_form_key = 'reactivate' AND v_dep.id IS NULL THEN
                      CASE WHEN a.client_status = 'Stopped'
                           THEN a.client_name || ' has no confirmed churn. Confirm the churn first with Client is leaving, then reopen.'
                           ELSE a.client_name || ' is not marked as left. Nothing to reactivate.' END END,
    'churnTypeDefault', CASE WHEN p_form_key = 'churn_confirm' AND jsonb_typeof(v_type) = 'string' THEN v_type #>> '{}' END);
END $function$;

-- The lifecycle view gains the return (4.12.4); columns only at the end.
CREATE OR REPLACE VIEW public.cockpit_client_lifecycle_v WITH (security_invoker = true) AS
WITH k AS (SELECT (now() AT TIME ZONE 'Asia/Kuwait')::date AS today),
ladder AS (
  SELECT coalesce((SELECT (s.value->>'pauseReviewDay')::integer FROM public.cockpit_settings s
                    WHERE s.key = 'billing.ladder' AND s.value->>'pauseReviewDay' ~ '^[0-9]{1,2}$'), 4) AS pause_day,
         coalesce((SELECT (s.value->>'cancelReviewDay')::integer FROM public.cockpit_settings s
                    WHERE s.key = 'billing.ladder' AND s.value->>'cancelReviewDay' ~ '^[0-9]{1,2}$'), 15) AS cancel_day
),
ev AS (
  SELECT e.* FROM public.cockpit_billing_events e
   WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id)
)
SELECT
  b.clickup_task_id,
  b.client_name,
  b.client_status,
  b.paused_on,
  p.id AS pause_event_id,
  CASE WHEN p.detail->>'pause_kind' IN ('client_request', 'non_payment') THEN p.detail->>'pause_kind' END AS pause_kind,
  CASE WHEN p.detail->>'restart' ~ '^\d{4}-\d{2}-\d{2}$' THEN (p.detail->>'restart')::date END AS pause_restart,
  CASE WHEN b.client_status = 'Paused' AND b.paused_on IS NOT NULL THEN k.today - b.paused_on END AS pause_days,
  x.until AS extension_until,
  d.id AS departure_id,
  d.left_on,
  d.confirmed_at AS churn_confirmed_at,
  d.survey_state,
  late.days_late,
  -- The same rule as cockpit_billing_ladder_due, so the client page, the cadence and Today agree: an open run on
  -- an Active card whose date has not moved since, with no live extension, counted from the due day.
  CASE
    WHEN b.client_status = 'Paused' AND b.paused_on IS NOT NULL AND k.today - b.paused_on >= 14 THEN 'pause_day14'
    WHEN late.due_on IS NULL OR x.until IS NOT NULL OR b.client_status IS DISTINCT FROM 'Active'
         OR b.next_payment_date IS DISTINCT FROM late.due_on THEN 'none'
    WHEN k.today - late.due_on >= ladder.cancel_day THEN 'cancel_review'
    WHEN k.today - late.due_on >= ladder.pause_day THEN 'pause_review'
    ELSE 'none'
  END AS ladder_step,
  -- Waves 5-6 (20261102i): a departure the client came back from reads returned.
  d.returned_on,
  CASE WHEN d.id IS NULL THEN NULL WHEN d.returned_on IS NOT NULL THEN 'returned'
       WHEN d.confirmed_at IS NOT NULL THEN 'confirmed' ELSE 'open' END AS departure_state
FROM public.cockpit_billing_accounts b
CROSS JOIN k
CROSS JOIN ladder
LEFT JOIN LATERAL (
  SELECT e.id, e.detail FROM ev e
   WHERE e.clickup_task_id = b.clickup_task_id AND e.kind = 'pause' AND b.client_status = 'Paused'
     AND NOT EXISTS (SELECT 1 FROM ev r WHERE r.clickup_task_id = e.clickup_task_id AND r.kind = 'resume' AND r.at > e.at)
   ORDER BY e.at DESC, e.id DESC LIMIT 1
) p ON true
LEFT JOIN LATERAL (
  SELECT max(g.until) AS until FROM public.cockpit_extensions_v g
   WHERE g.clickup_task_id = b.clickup_task_id AND g.state = 'live'
) x ON true
LEFT JOIN LATERAL (
  SELECT dd.id, dd.left_on, dd.confirmed_at, dd.survey_state, dd.returned_on FROM public.cockpit_churn_departures dd
   WHERE dd.clickup_task_id = b.clickup_task_id AND dd.removed_at IS NULL
   ORDER BY dd.left_on DESC, dd.id DESC LIMIT 1
) d ON true
LEFT JOIN LATERAL (
  SELECT l.days_late, l.due_on FROM public.cockpit_late_payments_v l
   WHERE l.clickup_task_id = b.clickup_task_id AND l.closed_how = 'open'
   ORDER BY l.due_on DESC LIMIT 1
) late ON true;
REVOKE ALL ON public.cockpit_client_lifecycle_v FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_client_lifecycle_v TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_read_only_user') THEN
    EXECUTE 'GRANT SELECT ON public.cockpit_client_lifecycle_v TO supabase_read_only_user';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 9. Seeds: the registry rows bank_receipt (client, not live) and reactivate (staff, code-defined),
--    each with its version 1 (5.8, 5.11), and the C9 retire registry (11.3). Nothing here goes live.

DO $$
DECLARE
  v_receipt jsonb := $json${
    "v": 1, "key": "bank_receipt",
    "title": {"en": "Send your transfer receipt", "ar": "أرسل لنا إيصال التحويل"},
    "intro": {"en": "Your account manager asked for the receipt of your bank transfer. We check it against our bank and confirm.",
              "ar": "مدير حسابك طلب إيصال التحويل البنكي. بنشيّك عليه مع البنك وبنأكد لك."},
    "minutes": 2, "audience": "admin", "signer": "typed",
    "context": [
      {"key": "expectedAmount", "type": "number", "label": {"en": "Amount due", "ar": "المبلغ المطلوب"}},
      {"key": "currency", "type": "text", "label": {"en": "Currency", "ar": "العملة"}},
      {"key": "dueOn", "type": "date", "label": {"en": "Due on", "ar": "تاريخ الاستحقاق"}}
    ],
    "fields": [
      {"key": "amount", "type": "number", "required": true, "min": 0.001, "max": 1000000, "decimals": 3,
       "label": {"en": "Amount you transferred", "ar": "المبلغ اللي حولته"}},
      {"key": "currency", "type": "choice", "required": true,
       "label": {"en": "Currency", "ar": "العملة"},
       "options": [{"value": "kwd", "label": {"en": "Kuwaiti dinar (KWD)", "ar": "دينار كويتي (KWD)"}},
                   {"value": "usd", "label": {"en": "US dollar (USD)", "ar": "دولار أمريكي (USD)"}}]},
      {"key": "paidOn", "type": "date", "required": true, "notAfter": "today", "notBeforeDays": 120,
       "label": {"en": "Day you made the transfer", "ar": "يوم التحويل"}},
      {"key": "reference", "type": "text", "required": false, "maxLength": 60, "format": "plain",
       "label": {"en": "Bank reference (if you have it)", "ar": "رقم المرجع من البنك (إذا عندك)"}},
      {"key": "receipt", "type": "file", "required": true,
       "accept": ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"], "maxBytes": 10485760,
       "label": {"en": "The receipt", "ar": "الإيصال"},
       "hint": {"en": "A photo or a PDF, up to 10 MB.", "ar": "صورة أو PDF، لين ١٠ ميغا."}}
    ],
    "reads": {"receipt_hook": ["amount", "currency", "paidOn", "reference", "receipt"]},
    "submit": {"en": "Send the receipt", "ar": "أرسل الإيصال"},
    "done": {"en": "Thanks. We'll check it against our bank and confirm.", "ar": "مشكور. بنشيّك عليه مع البنك ونأكد لك."},
    "invite": {
      "whatsapp": {"en": "Hi {client} team, could you send us the receipt of your bank transfer here: {form_link}",
                   "ar": "هلا فريق {client}، ممكن ترسلون لنا إيصال التحويل البنكي من هني: {form_link}"},
      "push": {"en": "Your account manager asked for your transfer receipt. Tap to send it.",
               "ar": "مدير حسابك يبي إيصال التحويل. اضغط وأرسله."}
    }
  }$json$::jsonb;
  v_problem text;
BEGIN
  v_problem := coalesce(public.cockpit_form_schema_check(v_receipt), public.cockpit_form_schema_text_problem(v_receipt));
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'The bank receipt schema does not pass its own check: %', v_problem USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('cockpit.audit_actor', 'migration 20261102i', true);
  INSERT INTO public.cockpit_forms (key, title, audience, provider, typeform_id, version, schema, seats, client_scoped, effects, updated_by)
  VALUES
    ('bank_receipt', 'Bank transfer receipt', 'client', 'native', NULL, 1, v_receipt, ARRAY['csm'], true,
     '[{"key":"record","owner":"cockpit","delivery":"sql","label":"Stored in the cockpit"},
       {"key":"receipt_hook","owner":"cockpit","delivery":"sql","label":"The receipt in Checks waiting"},
       {"key":"receipt_notice","owner":"cockpit","delivery":"slack_notice","label":"Receipt in, in #csm-general"},
       {"key":"invite_link","owner":"cockpit","delivery":"client_message","label":"The form link by WhatsApp"}]'::jsonb,
     'migration 20261102i'),
    ('reactivate', 'Client is back', 'team', 'native', NULL, 1, '{"lives":"cockpit"}'::jsonb, ARRAY['csm'], true,
     '[{"key":"record","owner":"cockpit","delivery":"sql","label":"Stored in the cockpit"},
       {"key":"card","owner":"cockpit","delivery":"clickup_queue","label":"Status back and churn fields cleared on the card"},
       {"key":"back_notice","owner":"cockpit","delivery":"slack_notice","label":"Client is back, in #csm-announcements"}]'::jsonb,
     'migration 20261102i')
  ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.cockpit_form_versions (form_key, version, schema, published_by, note)
  SELECT f.key, 1, f.schema, 'migration 20261102i',
         CASE f.key WHEN 'bank_receipt' THEN 'Client form schema v1 with a file, a date and a number (waves 5-6, 5.8).'
                    ELSE 'Code-defined staff sheet (FormSheet def reactivate, waves 5-6, 5.11).' END
    FROM public.cockpit_forms f
   WHERE f.key IN ('bank_receipt','reactivate')
  ON CONFLICT DO NOTHING;
  PERFORM set_config('cockpit.audit_actor', '', true);
END $$;

-- The C9 retire registry, as of 2026-11-02 (11.3). ON CONFLICT DO NOTHING: a second apply never
-- resets a state a deploy moved. Owner roles: the systems manager for Make, Typeform and webhooks.
-- Dates are Kuwait days of the deploy windows that switched each item off; "ready" items were off
-- before the 2026-10-25 inventory and ran nothing in its 30 days.
SELECT set_config('cockpit.audit_actor', 'migration 20261102i', true);
SELECT set_config('cockpit.forms_action', 'forms.retire_seed', true);
INSERT INTO public.cockpit_retire_items (id, kind, external_id, name, used_for, owner_role, replacement, wave, state,
  switch_off_step, off_at, quiet_since, note, updated_by)
SELECT 'make:' || x.ext, 'make', x.ext, x.name, x.used_for, 'the systems manager', x.repl, x.wave, x.state, x.step,
       x.off_at::timestamptz, x.quiet::timestamptz, x.note, 'migration 20261102i'
  FROM (VALUES
    ('9805665', 'Extension (Make)', 'extension, Confirm Charge', 'Extend and Confirm paid on the billing sheet', 'W12', 'off', 'W12 D-C1', '2026-11-01 00:00+03', '2026-11-01 00:00+03', NULL),
    ('9000763', 'Confirm Charge (Make)', 'extension, Confirm Charge', 'Extend and Confirm paid on the billing sheet', 'W12', 'off', 'W12 D-C1', '2026-11-01 00:00+03', '2026-11-01 00:00+03', NULL),
    ('8069181', 'Confirm Charge, old (Make)', 'extension, Confirm Charge', 'Extend and Confirm paid on the billing sheet', 'W12', 'off', 'W12 D-C1', '2026-11-01 00:00+03', '2026-11-01 00:00+03', NULL),
    ('9585358', 'Extension sheet (Make)', 'extension, Confirm Charge', 'Extend and Confirm paid on the billing sheet', 'W12', 'off', 'W12 D-C1', '2026-11-01 00:00+03', '2026-11-01 00:00+03', NULL),
    ('9805613', 'Pause on submit (Make)', 'pause on the client''s submit', 'The pause sheet and the client''s pause consent', 'W12', 'off', 'W12 D-C2', '2026-11-01 00:00+03', '2026-11-01 00:00+03', NULL),
    ('9805538', 'Termination on submit (Make)', 'termination on submit', 'The exit survey and Client is leaving', 'W34', 'off', 'W34 D-C4b', '2026-11-02 00:00+03', '2026-11-02 00:00+03', NULL),
    ('9209179', '1-1 notes (Make)', '1-1 notes', '1-1 notes in the cockpit', '2b', 'off', '2b cut-over', '2026-11-01 00:00+03', '2026-11-01 00:00+03', NULL),
    ('9523861', 'Recap sender (Make)', 'recap sender', 'Client messages in the cockpit', '2b', 'off', '2b cut-over', '2026-11-01 00:00+03', '2026-11-01 00:00+03', NULL),
    ('8962418', 'Old cancellation to sheet (Make)', 'old cancellation to sheet (invalid)', 'Exit survey', 'C9', 'off', NULL, NULL, '2026-09-25 00:00+03', 'Off (invalid) before the 2026-10-25 inventory; no run in its 30 days.'),
    ('9169732', 'Closed to RAW LEADS (Make)', 'closed to RAW LEADS', 'None needed (webhook WHTP4096881 disabled 2026-11-02)', 'C9', 'off', NULL, '2026-11-02 00:00+03', '2026-11-02 00:00+03', NULL),
    ('9783436', 'Draft internal request (Make)', 'draft internal request', 'The /requests page', 'C9', 'off', NULL, NULL, '2026-09-25 00:00+03', 'Off before the 2026-10-25 inventory; no run in its 30 days.'),
    ('8063994', 'Monday-era ticketing (Make)', 'Monday-era ticketing, QA', 'The /requests page', 'C9', 'off', NULL, NULL, '2026-09-25 00:00+03', 'Off before the 2026-10-25 inventory; no run in its 30 days.'),
    ('8064859', 'Monday-era ticketing (Make)', 'Monday-era ticketing, QA', 'The /requests page', 'C9', 'off', NULL, NULL, '2026-09-25 00:00+03', 'Off before the 2026-10-25 inventory; no run in its 30 days.'),
    ('8065434', 'Monday-era QA (Make)', 'Monday-era ticketing, QA', 'The /requests page', 'C9', 'off', NULL, NULL, '2026-09-25 00:00+03', 'Off before the 2026-10-25 inventory; no run in its 30 days.'),
    ('8962328', 'NPS to Slack (Make)', 'NPS to Slack', 'Native NPS', 'W34', 'on', 'W34 D-C5', NULL, NULL, 'Waits for the cockpit bot to be invited to #nps-survey-feedback.'),
    ('8962387', 'CSAT to Slack (Make)', 'CSAT to Slack', 'Native onboarding survey', 'W34', 'on', 'W34 D-C5', NULL, NULL, 'Waits for the cockpit bot to be invited to #nps-survey-feedback.'),
    ('8068892', 'Old NPS and CSAT to Slack and sheet (Make)', 'old NPS and CSAT to Slack and sheet (0 runs)', 'Native NPS and onboarding survey', 'C9', 'on', 'D-C9', NULL, NULL, NULL),
    ('9169735', 'Four Rs: reviews (Make)', 'Four Rs to sheet, comment, Slack', 'Log a win', 'W5', 'on', 'D-W', NULL, NULL, NULL),
    ('9188441', 'Four Rs: testimonials (Make)', 'Four Rs to sheet, comment, Slack', 'Log a win', 'W5', 'on', 'D-W', NULL, NULL, NULL),
    ('9190294', 'Four Rs: referrals (Make)', 'Four Rs to sheet, comment, Slack', 'Log a win', 'W5', 'on', 'D-W', NULL, NULL, NULL),
    ('9195843', 'Four Rs: upsells (Make)', 'Four Rs to sheet, comment, Slack', 'Log a win', 'W5', 'on', 'D-W', NULL, NULL, NULL),
    ('9205789', 'Four Rs: podcasts (Make)', 'Four Rs to sheet, comment, Slack', 'Log a win', 'W5', 'on', 'D-W', NULL, NULL, NULL),
    ('9122691', 'Lead list (Make)', 'lead list', 'The WhatsApp reactivation request', 'C9', 'on', 'D-C9', NULL, NULL, NULL),
    ('9282377', 'Website sell form (Make)', 'website sell form', 'The landing page request', 'C9', 'on', 'D-C9', NULL, NULL, NULL),
    ('9018535', 'Client card info to sheet and DM (Make)', 'client card info to sheet and DM', 'None: card data is not collected (retired 2026-10-26)', 'C9', 'on', 'D-C9', NULL, NULL, NULL),
    ('7908153', 'Old Monday kickoff (Make)', 'old Monday kickoff and card info', 'None', 'C9', 'on', 'D-C9', NULL, NULL, '0 runs; first in the D-C9 window (it maps card number and CVV).'),
    ('8069605', 'Old Monday card info (Make)', 'old Monday kickoff and card info', 'None', 'C9', 'on', 'D-C9', NULL, NULL, '0 runs; first in the D-C9 window (it maps card number and CVV).'),
    ('8925654', 'Kickoff effects (Make 12)', 'kickoff effects', 'Native kickoff', 'W6', 'on', 'D-S4K', NULL, NULL, 'Switched off only once every effect it has is proven the same in the cockpit.'),
    ('8922994', 'Onboarding effects (Make 13)', 'onboarding effects', 'Native client onboarding', 'W6', 'on', 'D-S4O', NULL, NULL, 'Switched off only once every effect it has is proven the same in the cockpit.'),
    ('9748311', 'Blueprint (Make 14)', 'Blueprint', 'Blueprint in the cockpit', 'A1', 'on', 'after first native Blueprint close', NULL, NULL, NULL),
    ('8979157', 'New Client Form MAIN (Make)', 'New Client Form MAIN', 'Stays. Its kickoff link points at the cockpit kickoff once the native kickoff is live.', 'kept', 'kept', NULL, NULL, NULL, 'Kept: the New Client Form feeds HighLevel, Cortana and the B2B.'),
    ('9686154', 'Resume reminder (Make)', 'resume reminder', 'Stays (not a form scenario)', 'kept', 'kept', NULL, NULL, NULL, 'Kept: not a form scenario, or still the writer of record.'),
    ('9356423', 'First launch date (Make)', 'first launch date', 'Stays (not a form scenario)', 'kept', 'kept', NULL, NULL, NULL, 'Kept: not a form scenario, or still the writer of record.'),
    ('9744107', 'Status forward (Make)', 'status forward', 'Stays (not a form scenario)', 'kept', 'kept', NULL, NULL, NULL, 'Kept: not a form scenario, or still the writer of record.'),
    ('9742600', 'Contracts (Make)', 'contracts', 'Stays (not a form scenario)', 'kept', 'kept', NULL, NULL, NULL, 'Kept: not a form scenario, or still the writer of record.'),
    ('8866601', 'Payment failure (Make)', 'payment failure', 'Stays (not a form scenario)', 'kept', 'kept', NULL, NULL, NULL, 'Kept: not a form scenario, or still the writer of record.'),
    ('8903351', 'Client update (Make)', 'client update', 'Stays (not a form scenario)', 'kept', 'kept', NULL, NULL, NULL, 'Kept: not a form scenario, or still the writer of record.'),
    ('9799073', 'WhatsApp reconnect (Make)', 'WhatsApp reconnect', 'Stays (not a form scenario)', 'kept', 'kept', NULL, NULL, NULL, 'Kept: not a form scenario, or still the writer of record.'),
    ('9808298', 'Market intel verified (Make)', 'market intel verified', 'Stays (not a form scenario)', 'kept', 'kept', NULL, NULL, NULL, 'Kept: not a form scenario, or still the writer of record.')
  ) AS x(ext, name, used_for, repl, wave, state, step, off_at, quiet, note)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.cockpit_retire_items (id, kind, external_id, name, used_for, owner_role, replacement, wave, state,
  switch_off_step, off_at, quiet_since, note, updated_by)
SELECT 'typeform:' || x.ext, 'typeform', x.ext, x.name, x.used_for, 'the systems manager', x.repl, x.wave, x.state, x.step,
       x.off_at::timestamptz, x.quiet::timestamptz, x.note, 'migration 20261102i'
  FROM (VALUES
    ('gqBcyK6g', 'Extension (Typeform)', 'extension', 'Native extension', 'W12', 'closed', 'W12 D-C1', '2026-11-01 00:00+03', '2026-11-01 00:00+03', 'Archive 14 days after close if no legacy answer.'),
    ('CTUjv6l3', 'Pause request (Typeform)', 'pause', 'Native pause and the client''s pause consent', 'W12', 'closed', 'W12 D-C2', '2026-11-01 00:00+03', '2026-11-01 00:00+03', 'Archive 14 days after close if no legacy answer.'),
    ('knIe4eF3', 'Termination (Typeform)', 'termination', 'Native exit survey', 'W34', 'closed', 'W34 D-C4b', '2026-11-02 00:00+03', '2026-11-02 00:00+03', 'Archive 14 days after close if no legacy answer.'),
    ('fRokTITH', '1-1 notes (Typeform)', '1-1 notes', 'Native 1-1 notes', '2b', 'closed', '2b cut-over', '2026-11-01 00:00+03', '2026-11-01 00:00+03', 'Archive 14 days after close if no legacy answer.'),
    ('fuPgs85S', 'NPS (Typeform)', 'NPS', 'Native NPS', 'W34', 'on', 'W34 D-C5', NULL, NULL, 'Waits for the cockpit bot to be invited to #nps-survey-feedback.'),
    ('KbcbPA73', 'CSAT (Typeform)', 'CSAT', 'Native onboarding survey', 'W34', 'on', 'W34 D-C5', NULL, NULL, 'Waits for the cockpit bot to be invited to #nps-survey-feedback.'),
    ('ETEynRgb', 'Four Rs: reviews (Typeform)', 'Four Rs', 'Log a win', 'W5', 'on', 'D-W', NULL, NULL, NULL),
    ('bAmbMKM2', 'Four Rs: testimonials (Typeform)', 'Four Rs', 'Log a win', 'W5', 'on', 'D-W', NULL, NULL, NULL),
    ('cKItPZVI', 'Four Rs: referrals (Typeform)', 'Four Rs', 'Log a win', 'W5', 'on', 'D-W', NULL, NULL, NULL),
    ('VP3zmaj2', 'Four Rs: upsells (Typeform)', 'Four Rs', 'Log a win', 'W5', 'on', 'D-W', NULL, NULL, NULL),
    ('IVHO9BMC', 'Four Rs: podcasts (Typeform)', 'Four Rs', 'Log a win', 'W5', 'on', 'D-W', NULL, NULL, NULL),
    ('uXtImBuZ', 'Lead list (Typeform)', 'lead list', 'The WhatsApp reactivation request', 'C9', 'on', 'D-C9', NULL, NULL, NULL),
    ('PjfTJypg', 'Site design (Typeform)', 'site design', 'The landing page request', 'C9', 'on', 'D-C9', NULL, NULL, NULL),
    ('Aa6nUPOs', 'Old onboarding (Typeform)', 'old onboarding', 'Native onboarding', 'C9', 'on', 'D-C9', NULL, NULL, NULL),
    ('uUEp9YwJ', 'Old onboarding, second (Typeform)', 'old onboarding', 'Native onboarding', 'C9', 'on', 'D-C9', NULL, NULL, NULL),
    ('BbJy6xg4', 'Old kickoff (Typeform)', 'old kickoff', 'Native kickoff', 'C9', 'on', 'D-C9', NULL, NULL, NULL),
    ('Uju17Z13', 'Card info (Typeform)', 'card info', 'None: card data is not collected', 'C9', 'on', 'D-C9', NULL, NULL, 'The CEO clears the card data it collected.'),
    ('ecJQ5Z5C', 'Reactivate your ads (Typeform)', 'reactivate ads', 'None: the ad-billing guard decides', 'C9', 'on', 'D-C9', NULL, NULL, NULL),
    ('oYZKtogO', 'Old Blueprint (Typeform)', 'old Blueprint', 'Blueprint in the cockpit', 'A1', 'on', 'after first native Blueprint close', NULL, NULL, NULL),
    ('tG7dnxBn', 'Kickoff (Typeform)', 'kickoff', 'Native kickoff', 'W6', 'on', 'D-S4K', NULL, NULL, NULL),
    ('KFRCXPFx', 'Client onboarding (Typeform)', 'onboarding', 'Native client onboarding; once it is live, this form''s answers go through the same steps', 'W6', 'on', 'after [40] sends native invite', NULL, NULL, 'Stays open until the New Client Form scenario sends the native onboarding link.'),
    ('BTzMwXiw', 'New Client Form (Typeform)', 'New Client Form', 'Stays', 'kept', 'kept', NULL, NULL, NULL, 'Kept: never imitate a submission (Make, HighLevel, Cortana and the B2B read it).')
  ) AS x(ext, name, used_for, repl, wave, state, step, off_at, quiet, note)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.cockpit_retire_items (id, kind, external_id, name, used_for, owner_role, replacement, wave, state,
  switch_off_step, note, updated_by)
SELECT 'webhook:' || x.ext, 'webhook', x.ext, x.name, x.used_for, 'the systems manager', x.repl, x.wave, 'on', x.step, x.note,
       'migration 20261102i'
  FROM (VALUES
    ('WHTP4364124', 'Sandbox ticket form webhook (o0ULXQhD)', 'sandbox ticket form to the inactive 9783436', 'None', 'C9', 'D-C9', NULL),
    ('WHTP4007419', 'NPS webhook (fuPgs85S)', 'NPS', 'Native NPS', 'W34', 'W34 D-C5', NULL),
    ('WHTP4007430', 'CSAT webhook (KbcbPA73)', 'CSAT', 'Native onboarding survey', 'W34', 'W34 D-C5', NULL),
    ('WHTP4149695', 'Site design webhook (PjfTJypg)', 'site design', 'The landing page request', 'C9', 'D-C9', NULL),
    ('WHTP4077499', 'Lead list webhook (uXtImBuZ)', 'lead list', 'The WhatsApp reactivation request', 'C9', 'D-C9', NULL),
    ('WHTP4030451', 'Card info webhook (Uju17Z13)', 'card info', 'None', 'C9', 'D-C9', NULL),
    ('WHTP4096883', 'Four Rs: reviews webhook (ETEynRgb)', 'Four Rs', 'Log a win', 'W5', 'D-W', NULL),
    ('WHTP4105426', 'Four Rs: testimonials webhook (bAmbMKM2)', 'Four Rs', 'Log a win', 'W5', 'D-W', NULL),
    ('phoenix-bAmbMKM2', 'Phoenix webhook on testimonials (bAmbMKM2)', 'Four Rs', 'Log a win', 'W5', 'D-W', 'Already disabled in Typeform; D-W removes it.'),
    ('WHTP4105956', 'Four Rs: referrals webhook (cKItPZVI)', 'Four Rs', 'Log a win', 'W5', 'D-W', NULL),
    ('WHTP4108828', 'Four Rs: upsells webhook (VP3zmaj2)', 'Four Rs', 'Log a win', 'W5', 'D-W', NULL),
    ('WHTP4112950', 'Four Rs: podcasts webhook (IVHO9BMC)', 'Four Rs', 'Log a win', 'W5', 'D-W', NULL),
    ('WHTP3992232', 'Kickoff webhook (tG7dnxBn)', 'kickoff', 'Native kickoff', 'W6', 'D-S4K', NULL),
    ('postcallsummary', 'Post-call summary webhook (tG7dnxBn)', 'kickoff recap drafts (Make hook 4114295, Make 06 9209179)',
     'Nothing: client recaps are sent from the cockpit (client messages)', 'W6', 'D-S4K',
     'Its only reader is Make 06 (9209179), the recap drafter; the CEO turned this webhook off on 2026-10-26 (A3) after 0 of 8 recaps ever reached a client. Removing it drops nothing.'),
    ('WHTP3991048', 'Make''s onboarding webhook (KFRCXPFx)', 'onboarding', 'Native client onboarding (the cockpit''s own webhook on the form stays)', 'W6', 'D-S4O', NULL)
  ) AS x(ext, name, used_for, repl, wave, step, note)
ON CONFLICT (id) DO NOTHING;
SELECT set_config('cockpit.forms_action', '', true);
SELECT set_config('cockpit.audit_actor', '', true);

-- ---------------------------------------------------------------------------
-- 10. Function privileges: revoked from all four roles, then exactly the grants of 2.2 (replaced
--     functions keep their live grant) and 3.3.

REVOKE ALL ON FUNCTION
  public.cockpit_churn_departure_return_guard(), public.cockpit_client_tail_audit(),
  public.cockpit_form_file_slots_guard(), public.cockpit_payment_receipts_guard(),
  public.cockpit_form_invite_tail_forms(text,text), public.cockpit_form_invite_view_with_tail(text,text),
  public.cockpit_form_file_slots_state(public.cockpit_form_invites),
  public.cockpit_form_file_slot_make(public.cockpit_form_invites,text,text,bigint,text,text),
  public.portal_form_file_slot(text,text,text,text,uuid,text,text,bigint,text),
  public.portal_form_token_file_slot(text,text,text,text,text,bigint,text),
  public.cockpit_form_file_slots_claim(), public.cockpit_form_file_read(uuid,text),
  public.cockpit_form_issue_hook_bank_receipt(uuid), public.cockpit_form_hook_bank_receipt(uuid),
  public.cockpit_billing_inbox_portal_twin(), public.cockpit_manual_payment_receipt(text),
  public.cockpit_manual_payment_near_match(public.cockpit_manual_payments),
  public.cockpit_client_reactivate(jsonb),
  public.cockpit_retire_item_set(text,jsonb,text), public.cockpit_retire_items_read(),
  public.cockpit_form_schema_check(jsonb), public.cockpit_form_answers_check(jsonb,jsonb,jsonb),
  public.cockpit_form_card_allows(text,text),
  public.cockpit_form_invite_issue_core(text,text,text[],text,text,boolean,jsonb,uuid,text,jsonb),
  public.cockpit_form_invite_view(text), public.cockpit_form_invite_issue(text,text,text[],text,text,boolean,jsonb,uuid,text),
  public.cockpit_form_invite_issue_system(text,text,text[],jsonb,text), public.cockpit_form_invite_canary(text,jsonb,text[]),
  public.portal_form_get(text,text,text,text,uuid), public.cockpit_manual_payments_to_check(),
  public.cockpit_client_lifecycle_confirm(text,jsonb), public.cockpit_csm_churn_read(), public.cockpit_form_prefill(text,text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Replaced functions: their live grant (2.2). The rest of 2.2's replaced functions are owner only.
GRANT EXECUTE ON FUNCTION public.cockpit_form_invite_view(text),
  public.cockpit_form_invite_issue(text,text,text[],text,text,boolean,jsonb,uuid,text),
  public.cockpit_manual_payments_to_check(), public.cockpit_client_lifecycle_confirm(text,jsonb),
  public.cockpit_csm_churn_read(), public.cockpit_form_prefill(text,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_form_get(text,text,text,text,uuid) TO service_role;

-- New (3.3): the portal's two slots, the staff file read and the retire list.
GRANT EXECUTE ON FUNCTION public.portal_form_file_slot(text,text,text,text,uuid,text,text,bigint,text),
  public.portal_form_token_file_slot(text,text,text,text,text,bigint,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_form_file_read(uuid,text), public.cockpit_retire_items_read() TO authenticated;

COMMENT ON FUNCTION public.cockpit_form_file_read(uuid, text) IS
  'One stored client file for a staff seat (W56 4.10.4): the gate of cockpit_form_answer_read (the CEO, an admin, finance, or a CSM allowed on the client), then {path, mime, bytes, name} for cockpit-forms-api file.url to sign for 5 minutes. Never a URL.';
COMMENT ON FUNCTION public.portal_form_file_slot(text, text, text, text, uuid, text, text, bigint, text) IS
  'The portal''s upload slot (W56 3.6): the workspace checks of portal_form_get, then forms/{invite}/{field}/{sha256}.{ext} for the portal server to sign an upload URL for (10 minutes). At most 5 slots per invite and field.';
COMMENT ON FUNCTION public.portal_form_token_file_slot(text, text, text, text, text, bigint, text) IS
  'The link page''s upload slot (W56 3.6): the token checks and rate limits of portal_form_token_open, logged the same way.';
COMMENT ON FUNCTION public.cockpit_retire_item_set(text, jsonb, text) IS
  'Deploy only (W56 3.7, 4.11): moves one retire item on to off, closed, removed or kept; off or closed to archived after 14 quiet days; off, closed or removed back to on with a note and a step (a rollback). Audited.';
COMMENT ON TABLE public.cockpit_retire_items IS
  'The C9 retire list (W56 3.7, 11.3): every Make scenario, Typeform and webhook the CSM work used, its owner role, replacement, switch-off step and the 14-quiet-days archive rule. Archive = Make folder 09 Archive or a closed Typeform marked archived; never deleted.';
COMMENT ON TABLE public.cockpit_payment_receipts IS
  'A client''s transfer receipt beside an already logged payment (W56 4.10, X11): named in the invite, the one near match (same currency, 1%, 3 days), or the ledger twin of a duplicate portal inbox row. Never cash, LTV or pay by itself.';
COMMENT ON TABLE public.cockpit_form_file_slots IS
  'Upload slots of client form files (W56 3.6): one path per file in the private bucket cockpit-form-files, at most 5 per invite and field, used by one answer.';

-- The lifecycle view (read by the VPS sync and the CEO refresh through supabase_read_only_user) reads
-- cockpit_extensions_v, which calls cockpit_billing_iso_day; 20261101r granted it, this keeps it so
-- (the lesson of 20261101r).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_read_only_user')
     AND to_regprocedure('public.cockpit_billing_iso_day(text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_billing_iso_day(text) TO supabase_read_only_user';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
