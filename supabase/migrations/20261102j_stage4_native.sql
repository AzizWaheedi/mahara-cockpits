-- Stage 4: the kickoff and the client onboarding native (docs/forms/WAVE56-CONTRACT.md 2.6, 3.3 (j),
-- 3.8, 4.13 to 4.15, 6.1, the stage4 row of 8; revision 1). Creative Triage (bldgtotkfmhoxmlzowdx).
-- Additive; applies twice. The fourth file of the waves 5-6 block (20261102g to 20261102j): it stands
-- on g, h and i (i widens the invite purposes to onboarding and the origins to portal, and gives
-- cockpit_form_card_allows and cockpit_form_invite_issue_system their onboarding rules).
--
-- 1. Versions: kickoff version 2 (a staff marker, {lives:'cockpit'}, the 41 answers of tG7dnxBn in
--    the Typeform's order with their refs, plus New MRR) and onboarding version 2 (client schema v1:
--    the 36 questions of KFRCXPFx with the stored wording, three headings, the lines of 5.9). The
--    registry rows stay typeform, version 1, with their live effects arrays (11.2-d), until
--    cockpit_form_stage4_go_live writes the version-2 array in one statement.
-- 2. cockpit_form_stage4_effects(form, version): the whole effects array of each form and version as
--    constants (version 1 = the live arrays byte for byte; version 2 = 4.15.2's).
-- 3. The kickoff: prefill, the answers check, submit (one kickoff per card counting every stored
--    kickoff, the 30 from tG7dnxBn included; a second needs a reason and posts only the handoff
--    comment), the Typeform-shaped read model and the planner.
-- 4. The onboarding: the portal's open (an invite through cockpit_form_invite_issue_system, or the
--    day an answer is already stored), the answer hook, and cockpit_form_onboarding_typeform, so a
--    KFRCXPFx delivery after the go-live runs the same native planner (X26); a card already
--    answered stores it legacy.
-- 5. One planner for both forms (cockpit_form_stage4_plan) and the parity plan Make's recorded
--    inputs are compared with (cockpit_form_parity_plan, make_parity.py).
-- 6. Deliveries: ClickUp writes through the forms queue (kind form, held by CLICKUP_WRITEBACK_FORMS_KEYS
--    in clickup-writeback), phase 3 and phase 4 WhatsApp drafts the CSM approves (message kinds
--    phase3, phase4), the Stage 1 kickoff notice, two request types made by the system
--    (cockpit_request_create_system, deduped per response and per card), New MRR as the live mrr
--    write (reason_cat new_client), and the relay outbox for the Client Data row and the GitHub
--    dispatch (hermes/forms-relay).
-- 7. The read model keeps a native kickoff or onboarding entry against the onboarding sync's
--    wholesale forms replace (a trigger, cockpit_client_onboarding_keep_native).
-- 8. The go-live (owner only): on writes provider native, version 2 and the version-2 array, off
--    writes them back; it refuses when the current array is neither (drift). recap stays shadow.
--
-- Nothing here posts, writes a card, sends a message or reaches a client: every writer is dark at
-- deploy (forms.stage4 both false, the registry still typeform, the effect owners make), and the
-- test card 86eywg1cq is the only card the planner serves before the go-live (the canary).
-- Every function is SECURITY DEFINER with an empty search path, revoked from all four roles, then
-- granted as 2.6 and 3.3 say.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard (2.1): each replaced body is the one the contract read (the live md5, 11.2-c)
--    or this file's own (a second apply).

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_forms_effects_valid(jsonb)', '1f6acfa213bd2516c618568c866ddf9e', '0b883bdecf8bed8b23863d1c699a62ac'),
      ('public.cockpit_form_effect_gate(text,text)', 'c679cd114e6aa8d5e2dccbfb4207d1c8', 'a683c23676194229cc175e4d47cb8b2b'),
      ('public.cockpit_client_message_claim(text[],text[],integer)', '937293e8d0421580fc47f8341ff9cae2', '1f4539442061c1304b015060771245a8'),
      ('public.cockpit_client_message_view(public.cockpit_client_messages)', '5145dbe3460c3947c82c8420871581ef', '480b6ba8827ecfa80a508b57fd173f53'),
      ('public.cockpit_client_message_approve(uuid,text,text,uuid,text[])', '2de20d1e0f44a1e379e5b57848d6a8e0', '0450b471cd3dd06f13b184a0becd9db5'),
      ('public.cockpit_form_record_legacy(jsonb)', '0c58ecc6de3d27a56d618e20ecffdfc3', '32b3716c8c2e6bc69cd62a46922012f1')
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
END $$;

-- What this file stands on: client-tail's widened invite CHECKs (purpose onboarding, origin portal)
-- and the functions this file calls by name (2.1 order: g, h, i before j).
DO $$
DECLARE v_purpose text; v_origin text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_purpose FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = to_regclass('public.cockpit_form_invites') AND c.conname = 'cockpit_form_invites_purpose_check';
  SELECT pg_get_constraintdef(c.oid) INTO v_origin FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = to_regclass('public.cockpit_form_invites') AND c.conname = 'cockpit_form_invites_origin_check';
  IF coalesce(v_purpose, '') NOT LIKE '%''onboarding''%' OR coalesce(v_origin, '') NOT LIKE '%''portal''%'
     OR to_regprocedure('public.cockpit_form_invite_issue_system(text,text,text[],jsonb,text)') IS NULL
     OR to_regprocedure('public.cockpit_form_card_allows(text,text)') IS NULL
     OR to_regprocedure('public.cockpit_form_client_go_live(text,boolean,text)') IS NULL
     OR to_regprocedure('public.cockpit_request_plan(public.cockpit_request_types,uuid,text,text,jsonb,date,text,text,text)') IS NULL
     OR to_regprocedure('public.cockpit_form_effects_settle(text,text,text,text,jsonb,boolean)') IS NULL
     OR to_regclass('public.cockpit_client_onboarding') IS NULL
     OR to_regclass('public.cockpit_billing_accounts') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261102g to 20261102i before 20261102j.' USING ERRCODE = '55000';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Columns and CHECKs, each widened only from the definition the contract read (11.2-f); any
--    other definition stops the file, and one already widened changes nothing.

ALTER TABLE public.cockpit_requests ADD COLUMN IF NOT EXISTS form_response_id uuid
  REFERENCES public.cockpit_form_responses(id);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_requests_form_response_type
  ON public.cockpit_requests (form_response_id, type_key) WHERE form_response_id IS NOT NULL;

DO $$
DECLARE v_def text;
BEGIN
  -- The message kinds: phase3 and phase4 join (5.12, 5.16).
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_client_messages'::regclass AND c.conname = 'cockpit_client_messages_kind_check';
  IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''recap_checkin''::text, ''recap_kickoff''::text, ''recap_blueprint''::text, ''phase5''::text, ''form_invite''::text, ''phase3''::text, ''phase4''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''recap_checkin''::text, ''recap_kickoff''::text, ''recap_blueprint''::text, ''phase5''::text, ''form_invite''::text])))' THEN
      RAISE EXCEPTION 'cockpit_client_messages_kind_check changed since the waves 5-6 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_client_messages DROP CONSTRAINT cockpit_client_messages_kind_check;
    ALTER TABLE public.cockpit_client_messages ADD CONSTRAINT cockpit_client_messages_kind_check
      CHECK (kind IN ('recap_checkin','recap_kickoff','recap_blueprint','phase5','form_invite','phase3','phase4'));
  END IF;

  -- The requests' sources: form joins (the system's requests, 2.6).
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_requests'::regclass AND c.conname = 'cockpit_requests_source_check';
  IF v_def IS DISTINCT FROM 'CHECK ((source = ANY (ARRAY[''requests_page''::text, ''client_page''::text, ''import''::text, ''form''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((source = ANY (ARRAY[''requests_page''::text, ''client_page''::text, ''import''::text])))' THEN
      RAISE EXCEPTION 'cockpit_requests_source_check changed since the waves 5-6 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_requests DROP CONSTRAINT cockpit_requests_source_check;
    ALTER TABLE public.cockpit_requests ADD CONSTRAINT cockpit_requests_source_check
      CHECK (source IN ('requests_page','client_page','import','form'));
  END IF;

  -- A request the system makes may have no requester seat (the client's onboarding answer).
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_requests'::regclass AND c.conname = 'cockpit_requests_check1';
  IF v_def IS DISTINCT FROM 'CHECK (((source = ANY (ARRAY[''import''::text, ''form''::text])) OR (requester_member_id IS NOT NULL)))' THEN
    IF v_def IS DISTINCT FROM 'CHECK (((source = ''import''::text) OR (requester_member_id IS NOT NULL)))' THEN
      RAISE EXCEPTION 'cockpit_requests_check1 changed since the waves 5-6 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_requests DROP CONSTRAINT cockpit_requests_check1;
    ALTER TABLE public.cockpit_requests ADD CONSTRAINT cockpit_requests_check1
      CHECK ((source IN ('import','form')) OR (requester_member_id IS NOT NULL));
  END IF;

  -- The effects' deliveries: relay joins (3.8).
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_form_effects'::regclass AND c.conname = 'cockpit_form_effects_delivery_check';
  IF v_def IS DISTINCT FROM 'CHECK ((delivery = ANY (ARRAY[''clickup_queue''::text, ''slack_notice''::text, ''client_message''::text, ''creative_outbox''::text, ''sql''::text, ''relay''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((delivery = ANY (ARRAY[''clickup_queue''::text, ''slack_notice''::text, ''client_message''::text, ''creative_outbox''::text, ''sql''::text])))' THEN
      RAISE EXCEPTION 'cockpit_form_effects_delivery_check changed since the waves 5-6 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_form_effects DROP CONSTRAINT cockpit_form_effects_delivery_check;
    ALTER TABLE public.cockpit_form_effects ADD CONSTRAINT cockpit_form_effects_delivery_check
      CHECK (delivery IN ('clickup_queue','slack_notice','client_message','creative_outbox','sql','relay'));
  END IF;

  -- The client's timeline (hermes/csm-calls): the native kickoff and onboarding answers join.
  IF to_regclass('public.cockpit_csm_call_forms') IS NOT NULL THEN
    v_def := NULL;
    SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = 'public.cockpit_csm_call_forms'::regclass AND c.conname = 'cockpit_csm_call_forms_form_id_check';
    IF v_def IS DISTINCT FROM 'CHECK ((form_id = ANY (ARRAY[''fRokTITH''::text, ''KFRCXPFx''::text, ''tG7dnxBn''::text, ''BbJy6xg4''::text, ''oYZKtogO''::text, ''cockpit-checkin''::text, ''knIe4eF3''::text, ''cockpit-nps''::text, ''cockpit-csat''::text, ''cockpit-feedback''::text, ''cockpit-kickoff''::text, ''cockpit-onboarding''::text])))' THEN
      IF v_def IS DISTINCT FROM 'CHECK ((form_id = ANY (ARRAY[''fRokTITH''::text, ''KFRCXPFx''::text, ''tG7dnxBn''::text, ''BbJy6xg4''::text, ''oYZKtogO''::text, ''cockpit-checkin''::text, ''knIe4eF3''::text, ''cockpit-nps''::text, ''cockpit-csat''::text, ''cockpit-feedback''::text])))' THEN
        RAISE EXCEPTION 'cockpit_csm_call_forms_form_id_check changed since the waves 5-6 contract read it; stop and re-read it.' USING ERRCODE = '55000';
      END IF;
      ALTER TABLE public.cockpit_csm_call_forms DROP CONSTRAINT cockpit_csm_call_forms_form_id_check;
      ALTER TABLE public.cockpit_csm_call_forms ADD CONSTRAINT cockpit_csm_call_forms_form_id_check
        CHECK (form_id IN ('fRokTITH','KFRCXPFx','tG7dnxBn','BbJy6xg4','oYZKtogO','cockpit-checkin','knIe4eF3',
                           'cockpit-nps','cockpit-csat','cockpit-feedback','cockpit-kickoff','cockpit-onboarding'));
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The tables (3.8 and 2.6)

-- The nine kickoff dropdowns: the kickoff's answer to the ClickUp option name. The kickoff's choices
-- carry ClickUp's own option names (read 2026-11-02, 11.2-m), so each answer maps to itself; D-S4.0
-- compares these rows with Make 12's switch().
CREATE TABLE IF NOT EXISTS public.cockpit_form_option_maps (
  form_key    text NOT NULL CHECK (form_key IN ('kickoff','onboarding')),
  field_id    text NOT NULL CHECK (field_id ~ '^[0-9a-f-]{36}$'),
  answer      text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 200),
  option_name text NOT NULL CHECK (char_length(option_name) BETWEEN 1 AND 200),
  PRIMARY KEY (form_key, field_id, answer)
);

-- The relay outbox (3.8): the Client Data row and the GitHub dispatch, sent by hermes/forms-relay.
CREATE TABLE IF NOT EXISTS public.cockpit_form_relay_outbox (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  response_id uuid NOT NULL REFERENCES public.cockpit_form_responses(id),
  effect_key  text NOT NULL CHECK (effect_key IN ('client_data_row','github_dispatch')),
  task_id     text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  payload     jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 16384),
  dedupe_key  text NOT NULL UNIQUE CHECK (dedupe_key ~ '^relay:[0-9a-f-]{36}:(client_data_row|github_dispatch)$'),
  state       text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','claimed','sent','failed','unknown','skipped')),
  claim       uuid,
  claim_until timestamptz,
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  result      jsonb CHECK (result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 2048)),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (state <> 'claimed' OR (claim IS NOT NULL AND claim_until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS cockpit_form_relay_outbox_open
  ON public.cockpit_form_relay_outbox (state, updated_at) WHERE state IN ('queued','claimed','failed');

ALTER TABLE public.cockpit_form_option_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_form_relay_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_form_option_maps, public.cockpit_form_relay_outbox FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_form_option_maps TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_form_relay_outbox TO service_role;

-- One audit row per write of the two tables (never a payload: the row's keys and state only).
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old jsonb; v_new jsonb; v_keep text[]; v_before jsonb; v_after jsonb; v_actor text;
BEGIN
  IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD); END IF;
  v_new := to_jsonb(NEW);
  v_keep := CASE TG_TABLE_NAME WHEN 'cockpit_form_relay_outbox' THEN ARRAY['id','response_id','effect_key','task_id','state','attempts']
                               ELSE ARRAY['form_key','field_id','answer','option_name'] END;
  IF v_old IS NOT NULL THEN
    SELECT jsonb_object_agg(k, v_old->k) INTO v_before FROM unnest(v_keep) AS k;
  END IF;
  SELECT jsonb_object_agg(k, v_new->k) INTO v_after FROM unnest(v_keep) AS k;
  SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (coalesce(nullif(current_setting('cockpit.forms_action', true), ''), 'forms.' || TG_TABLE_NAME || '.' || lower(TG_OP)),
          TG_TABLE_NAME, coalesce(v_new->>'id', (v_new->>'form_key') || ':' || (v_new->>'field_id') || ':' || (v_new->>'answer')),
          coalesce(v_actor, nullif(current_setting('cockpit.audit_actor', true), ''), session_user::text),
          'client-success', coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'),
          v_before, v_after, jsonb_build_object('op', lower(TG_OP), 'task_id', v_new->>'task_id'));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cockpit_form_option_maps_audit ON public.cockpit_form_option_maps;
CREATE TRIGGER cockpit_form_option_maps_audit AFTER INSERT OR UPDATE ON public.cockpit_form_option_maps
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_stage4_audit();
DROP TRIGGER IF EXISTS cockpit_form_relay_outbox_audit ON public.cockpit_form_relay_outbox;
CREATE TRIGGER cockpit_form_relay_outbox_audit AFTER INSERT OR UPDATE OF state ON public.cockpit_form_relay_outbox
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_stage4_audit();
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_form_option_maps','cockpit_form_relay_outbox'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_forms_no_delete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_forms_no_delete BEFORE DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_refuse_delete()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_forms_no_truncate ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_forms_no_truncate BEFORE TRUNCATE ON public.%I '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_forms_refuse_delete()', t);
  END LOOP;
END $$;

SELECT set_config('cockpit.audit_source', 'migration', true);
INSERT INTO public.cockpit_form_option_maps(form_key, field_id, answer, option_name) VALUES
  ('kickoff', '924bba47-32d4-4557-94d4-f475cd548dd2', 'Logged In', 'Logged In'),
  ('kickoff', '924bba47-32d4-4557-94d4-f475cd548dd2', 'Tech Issue', 'Tech Issue'),
  ('kickoff', '924bba47-32d4-4557-94d4-f475cd548dd2', 'Didn''t Receive Access', 'Didn''t Receive Access'),
  ('kickoff', '924bba47-32d4-4557-94d4-f475cd548dd2', 'Doesn''t Want To', 'Doesn''t Want To'),
  ('kickoff', 'a1520ef3-ec23-47a4-9584-e24257486a3e', 'Requested', 'Requested'),
  ('kickoff', 'a1520ef3-ec23-47a4-9584-e24257486a3e', 'Waiting on Client', 'Waiting on Client'),
  ('kickoff', 'a1520ef3-ec23-47a4-9584-e24257486a3e', 'Integrated', 'Integrated'),
  ('kickoff', 'a1520ef3-ec23-47a4-9584-e24257486a3e', 'Needs Integrating', 'Needs Integrating'),
  ('kickoff', 'a1520ef3-ec23-47a4-9584-e24257486a3e', 'Pending', 'Pending'),
  ('kickoff', 'a1520ef3-ec23-47a4-9584-e24257486a3e', 'Not Integrating', 'Not Integrating'),
  ('kickoff', 'a1520ef3-ec23-47a4-9584-e24257486a3e', 'Google Synched - Not Integrated', 'Google Synched - Not Integrated'),
  ('kickoff', 'ac976d4a-409b-441c-8c13-4b0e73a0c12f', 'Signed', 'Signed'),
  ('kickoff', 'ac976d4a-409b-441c-8c13-4b0e73a0c12f', 'Sent and waiting on client', 'Sent and waiting on client'),
  ('kickoff', 'ac976d4a-409b-441c-8c13-4b0e73a0c12f', 'Adjustments requested by client', 'Adjustments requested by client'),
  ('kickoff', 'ac976d4a-409b-441c-8c13-4b0e73a0c12f', 'Not sent yet', 'Not sent yet'),
  ('kickoff', 'ac976d4a-409b-441c-8c13-4b0e73a0c12f', 'NA - already signed', 'NA - already signed'),
  ('kickoff', 'bab9a58b-15af-4b0d-8e20-b8e5a4bee2cc', 'Design and build', 'Design and build'),
  ('kickoff', 'bab9a58b-15af-4b0d-8e20-b8e5a4bee2cc', 'Interior design', 'Interior design'),
  ('kickoff', 'bab9a58b-15af-4b0d-8e20-b8e5a4bee2cc', 'Architectural design', 'Architectural design'),
  ('kickoff', 'bab9a58b-15af-4b0d-8e20-b8e5a4bee2cc', 'Fit out and renovation', 'Fit out and renovation'),
  ('kickoff', 'bab9a58b-15af-4b0d-8e20-b8e5a4bee2cc', 'Construction only', 'Construction only'),
  ('kickoff', 'bab9a58b-15af-4b0d-8e20-b8e5a4bee2cc', 'Other', 'Other'),
  ('kickoff', 'bc7e70a2-1623-426f-8ed7-fac8fed9b160', 'Requested', 'Requested'),
  ('kickoff', 'bc7e70a2-1623-426f-8ed7-fac8fed9b160', 'Waiting on Client', 'Waiting on Client'),
  ('kickoff', 'bc7e70a2-1623-426f-8ed7-fac8fed9b160', 'Access Confirmed', 'Access Confirmed'),
  ('kickoff', 'bc7e70a2-1623-426f-8ed7-fac8fed9b160', 'Pending', 'Pending'),
  ('kickoff', 'bc7e70a2-1623-426f-8ed7-fac8fed9b160', 'Using Ours', 'Using Ours'),
  ('kickoff', 'bc7e70a2-1623-426f-8ed7-fac8fed9b160', 'Need Tech Help', 'Need Tech Help'),
  ('kickoff', 'bc7e70a2-1623-426f-8ed7-fac8fed9b160', 'Their Page Our Ad Acc', 'Their Page Our Ad Acc'),
  ('kickoff', 'cc14ad2d-28ca-4eac-bbef-89b4f299ef8f', 'Requested', 'Requested'),
  ('kickoff', 'cc14ad2d-28ca-4eac-bbef-89b4f299ef8f', 'Waiting on Client', 'Waiting on Client'),
  ('kickoff', 'cc14ad2d-28ca-4eac-bbef-89b4f299ef8f', 'Integrated', 'Integrated'),
  ('kickoff', 'cc14ad2d-28ca-4eac-bbef-89b4f299ef8f', 'Needs Integrating', 'Needs Integrating'),
  ('kickoff', 'cc14ad2d-28ca-4eac-bbef-89b4f299ef8f', 'Pending', 'Pending'),
  ('kickoff', 'cc14ad2d-28ca-4eac-bbef-89b4f299ef8f', 'Not Integrating', 'Not Integrating'),
  ('kickoff', 'd113cd99-9d35-4b12-a8fa-0cd0c19ec777', 'Access confirmed.', 'Access confirmed.'),
  ('kickoff', 'd113cd99-9d35-4b12-a8fa-0cd0c19ec777', 'Pending.', 'Pending.'),
  ('kickoff', 'd113cd99-9d35-4b12-a8fa-0cd0c19ec777', 'Invited.', 'Invited.'),
  ('kickoff', 'd113cd99-9d35-4b12-a8fa-0cd0c19ec777', 'Waiting on client.', 'Waiting on client.'),
  ('kickoff', 'e7d158a8-e303-4df8-a78a-61a0eb3843eb', 'Approved', 'Approved'),
  ('kickoff', 'e7d158a8-e303-4df8-a78a-61a0eb3843eb', 'Declined', 'Declined'),
  ('kickoff', 'e7d158a8-e303-4df8-a78a-61a0eb3843eb', 'Waiting On Client', 'Waiting On Client'),
  ('kickoff', 'e7d158a8-e303-4df8-a78a-61a0eb3843eb', 'Wants To See Them First', 'Wants To See Them First'),
  ('kickoff', 'f0a20cef-e902-4200-8f55-43431b2574c6', 'Confirmed', 'Confirmed'),
  ('kickoff', 'f0a20cef-e902-4200-8f55-43431b2574c6', 'Requested', 'Requested'),
  ('kickoff', 'f0a20cef-e902-4200-8f55-43431b2574c6', 'Need Tech Help', 'Need Tech Help'),
  ('kickoff', 'f0a20cef-e902-4200-8f55-43431b2574c6', 'Waiting On Client', 'Waiting On Client')
ON CONFLICT (form_key, field_id, answer) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Settings (2.6). Existing keys win (2.1): a re-apply after a go-live never switches it back.

INSERT INTO public.cockpit_settings(key, value, updated_by)
VALUES ('forms.stage4', '{"kickoff":false,"onboarding":false}'::jsonb, 'migration 20261102j')
ON CONFLICT (key) DO UPDATE SET value = excluded.value || public.cockpit_settings.value, updated_at = now()
WHERE NOT (public.cockpit_settings.value ?& array['kickoff','onboarding']);
-- Filled at D-S4.0 from the saved blueprints: {"3": url, "4": url} with {task} for the card id.
INSERT INTO public.cockpit_settings(key, value, updated_by)
VALUES ('onboarding.map_urls', '{}'::jsonb, 'migration 20261102j') ON CONFLICT (key) DO NOTHING;
-- Filled at D-S4.0: {"phase3": text, "phase4": text}, each passing cockpit_client_text_ok, with
-- {client} and {map_link} where Make's text has them.
INSERT INTO public.cockpit_settings(key, value, updated_by)
VALUES ('stage4.messages', '{}'::jsonb, 'migration 20261102j') ON CONFLICT (key) DO NOTHING;
-- Optional, filled at D-S4.0 when make_parity.py says a text differs: {"handoff", "profile",
-- "rawAnswers"} templates with {{hidden:<name>}}, {{answer:<ref>}}, {{client}}, {{task}},
-- {{answers}} and {{newMrr}}. Empty: the built-in texts below.
INSERT INTO public.cockpit_settings(key, value, updated_by)
VALUES ('stage4.templates', '{}'::jsonb, 'migration 20261102j') ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. The constants: effects arrays, field maps, card fields

-- The whole effects array of each form and version (4.15.2). Version 1 is the live array (11.2-d)
-- byte for byte; version 2 is the native one. recap stays shadow (Q22).
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_effects(p_form_key text, p_version integer)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_form_key = 'kickoff' AND p_version = 1 THEN
    RETURN '[{"key":"handoff_comment","label":"Handoff comment","owner":"make","delivery":"clickup_queue"},
             {"key":"onboarding_tasks","label":"Onboarding tasks","owner":"make","delivery":"clickup_queue"},
             {"key":"card_fields","label":"Card fields","owner":"make","delivery":"clickup_queue"},
             {"key":"map_phase4","label":"Map phase 4","owner":"make","delivery":"clickup_queue"},
             {"key":"phase4_whatsapp","label":"Phase 4 WhatsApp","owner":"make","delivery":"client_message"},
             {"key":"kickoff_notice","label":"Kickoff notice","owner":"cockpit","delivery":"slack_notice"},
             {"key":"recap","label":"Recap","owner":"shadow","delivery":"client_message"}]'::jsonb;
  ELSIF p_form_key = 'kickoff' AND p_version = 2 THEN
    RETURN '[{"key":"handoff_comment","label":"Handoff comment","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"native_status","label":"Task status In progress","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"card_fields","label":"Card fields","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"onboarding_tasks","label":"Tech and creative onboarding tasks","owner":"cockpit","delivery":"sql"},
             {"key":"map_phase4","label":"Map phase 4","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"phase4_whatsapp","label":"Phase 4 WhatsApp","owner":"cockpit","delivery":"client_message"},
             {"key":"kickoff_notice","label":"Kickoff notice","owner":"cockpit","delivery":"slack_notice"},
             {"key":"new_mrr","label":"New MRR","owner":"cockpit","delivery":"sql"},
             {"key":"recap","label":"Recap","owner":"shadow","delivery":"client_message"}]'::jsonb;
  ELSIF p_form_key = 'onboarding' AND p_version = 1 THEN
    RETURN '[{"key":"card_fields","label":"Onboarding answers on the card (Make)","owner":"make","delivery":"clickup_queue"},
             {"key":"client_data_row","label":"Client Data sheet row (Make)","owner":"make","delivery":"sql"},
             {"key":"phase3_whatsapp","label":"Phase 3 WhatsApp message (Make)","owner":"make","delivery":"client_message"},
             {"key":"brand_dna_task","label":"Brand DNA task (Make)","owner":"make","delivery":"clickup_queue"},
             {"key":"github_dispatch","label":"GitHub dispatch (Make)","owner":"make","delivery":"sql"}]'::jsonb;
  ELSIF p_form_key = 'onboarding' AND p_version = 2 THEN
    RETURN '[{"key":"profile_fields","label":"Client Profile and kickoff link","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"raw_answers_comment","label":"Raw answers comment","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"map_phase3","label":"Map phase 3","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"client_data_row","label":"Client Data sheet row","owner":"cockpit","delivery":"relay"},
             {"key":"github_dispatch","label":"Market intel dispatch","owner":"cockpit","delivery":"relay"},
             {"key":"phase3_whatsapp","label":"Phase 3 WhatsApp","owner":"cockpit","delivery":"client_message"},
             {"key":"brand_dna_task","label":"Brand DNA task","owner":"cockpit","delivery":"sql"},
             {"key":"read_model","label":"Answers in the client record","owner":"cockpit","delivery":"sql"}]'::jsonb;
  END IF;
  RAISE EXCEPTION 'There is no Stage 4 effects array for % version %.', coalesce(p_form_key, '(none)'), coalesce(p_version::text, '(none)')
    USING ERRCODE = '22023';
END $$;

-- Each form's questions with their Typeform refs and titles (the one map: the read model, the
-- Typeform door and the parity plan all use it). Kickoff: the 41 answers of tG7dnxBn as the stored
-- responses carry them (11.2-o: the union of the 30 read-model rows; conditional follow-ups
-- included), choices by ClickUp's own option names. Onboarding: the 36 questions of KFRCXPFx with
-- each choice's exact Typeform label.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_fields(p_form_key text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_form_key = 'kickoff' THEN
    RETURN '[{"key":"detailsCorrect","typeformRef":"c0000001-0000-4000-8000-000000000001","title":"Is all of the above still correct?","type":"choice","options":["Yes","No"]},{"key":"detailsFix","typeformRef":"c0000001-0000-4000-8000-000000000002","title":"Anything to add?","type":"longtext"},{"key":"linksCorrect","typeformRef":"c0000001-0000-4000-8000-000000000003","title":"Is all of the above still correct?","type":"choice","options":["Yes","No"]},{"key":"linksFix","typeformRef":"c0000001-0000-4000-8000-000000000004","title":"Anything to add?","type":"longtext"},{"key":"operationsCorrect","typeformRef":"c0000001-0000-4000-8000-000000000005","title":"Is all of the above still correct?","type":"choice","options":["Yes","No"]},{"key":"operationsFix","typeformRef":"c0000001-0000-4000-8000-000000000006","title":"Anything to add?","type":"longtext"},{"key":"serviceAdvertised","typeformRef":"c0000001-0000-4000-8000-000000000007","title":"Which service are we advertising?","type":"multi","options":["Design and build","Interior design","Architectural design","Fit out and renovation","Construction only","Other"]},{"key":"consultationTypes","typeformRef":"c0000001-0000-4000-8000-000000000008","title":"Which consultation types do they offer?","type":"multi","options":["In-office","In-home or onsite","Online"]},{"key":"profileComplete","typeformRef":"c0000001-0000-4000-8000-000000000009","title":"Is the profile complete?","type":"choice","options":["Yes","No"]},{"key":"profileFix","typeformRef":"c0000001-0000-4000-8000-000000000011","title":"Anything to add?","type":"longtext"},{"key":"contractStatus","typeformRef":"c0000001-0000-4000-8000-00000000000a","title":"Contract status","type":"choice","options":["Signed","Sent and waiting on client","Adjustments requested by client","Not sent yet","NA - already signed"]},{"key":"inWhatsappGroup","typeformRef":"3db082bb-1939-444b-8b32-d0067fc9878c","title":"Have you been added to the WhatsApp group?","type":"choice","options":["Yes","No"]},{"key":"whatsappAdd","typeformRef":"071c480f-17f9-48db-8155-56030f952e85","title":"Who else should we add to the WhatsApp group?","type":"text"},{"key":"driveDiscussed","typeformRef":"87c68a44-b19b-4a86-a286-0a2c8c32134e","title":"Have drive folders and filling out spreadsheets been discussed? (Intro message Whatsapp group)","type":"choice","options":["Yes","No"]},{"key":"whatsappStatus","typeformRef":"92fab954-d771-431c-9fc4-b9f15c53cbb8","title":"WhatsApp Status","type":"choice","options":["Access confirmed.","Pending.","Invited.","Waiting on client."]},{"key":"adPlatforms","typeformRef":"7d16afbb-b99a-4ee9-8718-4418cbeba534","title":"Which platforms will we advertise on?","type":"text"},{"key":"dailyBudget","typeformRef":"cf53482c-3d7d-45ab-b294-0230e917ea5f","title":"What is your daily budget for the ads?","type":"text"},{"key":"adAccountName","typeformRef":"e4b9dbd3-c12c-4d6f-a0e3-c3ba17c97728","title":"What is the name of the ad account? (has to be exact)","type":"text"},{"key":"facebookPageName","typeformRef":"940f494c-f99b-4920-b203-200576ddd780","title":"What is the name of the Facebook page? (has to be exact)","type":"text"},{"key":"cardLinked","typeformRef":"8bee68fc-0764-41a8-b90a-db2a3f401e9d","title":"Correct Card Linked To The Account With Funds?","type":"choice","options":["Yes","No"]},{"key":"facebookAccess","typeformRef":"6fcbd33c-60e9-4df7-bfaa-e76b588dd887","title":"Facebook Access Status?","type":"choice","options":["Requested","Waiting on Client","Access Confirmed","Pending","Using Ours","Need Tech Help","Their Page Our Ad Acc"]},{"key":"whatsappSynced","typeformRef":"a813378f-06ce-499e-8f0e-14761b89b474","title":"Whatsapp synced to Mahara OS?","type":"choice","options":["Requested","Waiting on Client","Integrated","Needs Integrating","Pending","Not Integrating"]},{"key":"bookingConnects","typeformRef":"03b0600d-04d2-40a0-a7de-75a488888eb7","title":"Does the booking platform connect to ours?","type":"choice","options":["Yes","No"]},{"key":"calendarComplete","typeformRef":"3bebf47d-c00b-4f26-8624-933b84e42ebc","title":"Google Calendar Integration Complete?","type":"choice","options":["Yes","No"]},{"key":"calendarStatus","typeformRef":"b657c5a5-d199-42b5-8437-c8d04f78e376","title":"Booking platform & Google Calendar Integration Status","type":"choice","options":["Requested","Waiting on Client","Integrated","Needs Integrating","Pending","Not Integrating","Google Synched - Not Integrated"]},{"key":"maharaOsAccess","typeformRef":"ad562fc2-6858-4e37-81c5-c4cc2375a330","title":"Mahara OS Access Status","type":"choice","options":["Logged In","Tech Issue","Didn''t Receive Access","Doesn''t Want To"]},{"key":"contentLinks","typeformRef":"3418ef58-72df-49aa-aac3-1e095e155d45","title":"Provide any marketing content links or notes.","type":"longtext"},{"key":"contentDiscussed","typeformRef":"753c4cde-4d28-4719-8459-06e4db640180","title":"Content Discussed","type":"choice","options":["Yes","No"]},{"key":"templatedAdsDiscussed","typeformRef":"f54986bc-e120-4345-afee-31c1000a5a9a","title":"Templated Ads Discussed","type":"choice","options":["Yes","No"]},{"key":"templatedAdsStatus","typeformRef":"eb7ed18c-8388-4d84-9b5c-2e3d4a030287","title":"Templated Ads Status","type":"choice","options":["Approved","Declined","Waiting On Client","Wants To See Them First"]},{"key":"hasLeads","typeformRef":"dff79b66-89dd-43ef-9664-3fa4e6a61d69","title":"Do you have pre-existing leads?","type":"choice","options":["Yes","No"]},{"key":"reachLeads","typeformRef":"85d7ebb5-ce36-4ac3-aff8-3ce464737abd","title":"Do you want us to reach out to those leads?","type":"choice","options":["Yes","No"]},{"key":"leadsLinks","typeformRef":"86a6cce0-9111-4d98-97e7-7af5b6d518c8","title":"Provide link or notes for those leads.","type":"longtext"},{"key":"coldLeadsExperience","typeformRef":"0cb88b75-f193-43a1-b802-d382178a0946","title":"Do you have experience selling to cold leads (leads from ads)?","type":"choice","options":["Yes","No"]},{"key":"coldCloseRate","typeformRef":"079812c4-bb7e-4cc3-8e57-24c3b9e886d9","title":"What is your current close rate on cold leads?","type":"text"},{"key":"academyConfirmed","typeformRef":"4379c2f7-c5cf-4104-92c5-9b2294d65b59","title":"Premium Projects Academy Confirmed?","type":"choice","options":["Yes","No"]},{"key":"firstStepsDiscussed","typeformRef":"dc6eafd2-516e-4ca9-9d9c-89dee060e224","title":"Discussed First Steps and Important Videos?","type":"choice","options":["Yes","No"]},{"key":"trainingAccess","typeformRef":"c56a7e2d-6f18-4bf9-a9f6-11367eab4c11","title":"Training Course Access","type":"choice","options":["Confirmed","Requested","Need Tech Help","Waiting On Client"]},{"key":"paymentAmount","typeformRef":"75e97e7d-4c19-437a-b4b8-67570c29344f","title":"Payment Amount","type":"number"},{"key":"postCallFormFilled","typeformRef":"34310b2e-4df4-4ed5-b67e-9aefa9087d6e","title":"Post call form filled?","type":"text"},{"key":"callRecording","typeformRef":"b5578678-d0c2-475b-b66f-7ea54d55fe31","title":"Call Recording Link","type":"url"}]'::jsonb;
  ELSIF p_form_key = 'onboarding' THEN
    RETURN '[{"key":"fullName","typeformRef":"533f14a0-712f-4de9-9ac7-67e1be6bc0c8","title":"Full Name","type":"text"},{"key":"phone","typeformRef":"64f2fb80-b074-4017-b8b7-b7d549947e52","title":"Phone","type":"text"},{"key":"email","typeformRef":"7994f0d2-baeb-451b-983a-816290873a68","title":"Email","type":"text"},{"key":"businessName","typeformRef":"514bfd3f-4ca1-469e-b9e7-87656503f65c","title":"Business Name","type":"text"},{"key":"address","typeformRef":"e5caee43-e9b5-427d-8583-6982c5dd9be8","title":"Please enter your business address.","type":"text"},{"key":"mapsLink","typeformRef":"f7f9f2eb-1761-4c28-83ed-a53621c2cf88","title":"Paste a Google Maps link to your location (optional).","type":"text"},{"key":"website","typeformRef":"454a425f-2ac6-4d94-92db-cec08618600e","title":"Website URL","type":"text"},{"key":"instagram","typeformRef":"adecfe45-5d55-4319-98ff-3761e04bfc9b","title":"Instagram URL","type":"text"},{"key":"facebook","typeformRef":"575d17ed-e26d-4e55-87d3-7cb31cb71939","title":"Facebook Page URL","type":"text"},{"key":"paymentOptions","typeformRef":"ee25f923-d5e1-4d1a-a95f-cd9c17abbe83","title":"What payment options do you currently offer to your clients (e.g., full payment, installment plans, minimum down payment, in-house financing, third-party financing)?","type":"longtext"},{"key":"frontDeskPhone","typeformRef":"282dac48-5031-4acb-96b6-ea469e8a5a8b","title":"Front Desk Phone","type":"text"},{"key":"personalPhone","typeformRef":"09d2e62a-51d4-4665-a3a9-30f5279b71bc","title":"Personal Phone Number","type":"text"},{"key":"yearsInBusiness","typeformRef":"ed1ba2fe-2827-4eea-a678-62205f1ce9f5","title":"How long have you been in business?","type":"text"},{"key":"bookingSoftware","typeformRef":"7a120dbb-0169-4bcc-9193-5c525a470d02","title":"Current booking software","type":"text"},{"key":"facebookAds","typeformRef":"ddf2767d-5725-4df2-b200-f0aab77a2db5","title":"Do you have a facebook business manager or have you ever ran ads on meta (Facebook & Instagram) in the past?","type":"choice","options":[{"value":"yes","typeform":"Yes"},{"value":"unsure","typeform":"IM UNSURE | لست متأكدًا"},{"value":"ran_before","typeform":"I''ve ran ads before but dont know how to access my Account |شغّلت إعلانات من قبل لكنني لا أعرف كيف أصل إلى حسابي"},{"value":"never_ran","typeform":"I Have a Business Account but have never ran ads | لديّ حساب أعمال على فيسبوك لكنني لم أقم بتشغيل إعلانات من قبل"}]},{"key":"projectsDone","typeformRef":"0a6b5704-c46d-480c-a592-b59108683596","title":"How many projects has your company completed to date?","type":"text"},{"key":"hours","typeformRef":"b7873d40-d154-42ac-bf24-cb3b667e84cc","title":"Business hours - When are you open to schedule?","type":"text"},{"key":"services","typeformRef":"d976036f-6c2e-4d5d-999a-64cf9bb2ef02","title":"1) What services do you offer list all of them? Also I want to know which ones have the HIGHEST price point and Highest Profit 2) What is the PRICE of the services?","type":"longtext"},{"key":"serviceFocus","typeformRef":"6271b610-6946-4056-bb08-d03ffc274141","title":"Out of those what is the #1 service/type of project you want to focus on scaling?","type":"longtext"},{"key":"faqs","typeformRef":"f2b7bc2b-2a79-4640-9e21-377e7aa39d45","title":"What are your top five most frequently asked questions and their answers? (Feel free to add more — the more detailed, the better.)","type":"longtext"},{"key":"idealProject","typeformRef":"6c819933-3eb9-4db8-bd59-d39be11cb7f0","title":"Please describe your ideal project in detail.","type":"longtext"},{"key":"serviceAreas","typeformRef":"fa017616-3fb5-4e64-9fbd-39cea6e26c47","title":"What service areas do you cover? Please list all cities and neighborhoods you serve so we can target your ads precisely.","type":"longtext"},{"key":"appointmentTypes","typeformRef":"b370341c-6ea3-43c9-bd8c-16e278a2d2d5","title":"What types of appointments do you offer? (Select all that apply)","type":"multi","options":[{"value":"online","typeform":"عن بُعد (أونلاين) | Online"},{"value":"onsite","typeform":"في موقع العميل / في المنزل | Onsite / In-home"},{"value":"office","typeform":"في مقرّكم / مكتبكم | In your office"}]},{"key":"maxDistance","typeformRef":"35ea63c3-090a-425d-b75c-e3d183d48cd1","title":"What''s the maximum distance you would travel from your office to do an in-home consultation?","type":"text"},{"key":"landmark","typeformRef":"b7c403ea-8d66-4814-80cf-7e8d7fdb8d11","title":"Local Landmark Information (Please type this in the format shown) - Located next to the Burger King down King Saud street on the left hand side.","type":"text"},{"key":"appointmentLength","typeformRef":"a20cfc1a-0228-413d-80ab-d97fc97574e0","title":"Appointment length + details + buffer","type":"text"},{"key":"consultants","typeformRef":"0a80a0a8-3a09-4907-a1d1-6c57e57d4c47","title":"Who are the engineers in your business that will be giving these consultations?","type":"longtext"},{"key":"whyJoined","typeformRef":"7426c6c5-344f-44c9-9999-3b9daf3a06b8","title":"What motivated you to join our program? What was the reason you signed up?","type":"longtext"},{"key":"freeConsults","typeformRef":"ec89854f-d006-402b-958a-91738e2b3e7a","title":"Do you offer free consultations?","type":"choice","options":[{"value":"yes","typeform":"Yes, we do offer free consultations / نعم، نقدم استشارات مجانية✅"},{"value":"open_to_it","typeform":"No, but we''re open to considering it / حاليا لا نقدمها، لكن يمكننا مناقشه🤝"},{"value":"no","typeform":"No, we do not offer free consultations / لا، لا نقدم استشارات مجانية❌"}]},{"key":"marketing","typeformRef":"bf8c7c7b-fff9-463f-b30a-8d8ca8b622f6","title":"What is your marketing process? In other words... please explain EVERYTHING A-Z that you have in place or have tried to generate new projects","type":"longtext"},{"key":"lastRevenue","typeformRef":"7ff5d37a-df7f-4002-8248-d0b4af6c28e8","title":"Last Calendar Year - How Much Total Revenue did you do?","type":"text"},{"key":"challenges","typeformRef":"fcf43e6a-cc84-4ae7-9cef-2336069d0280","title":"What are the TOP 3 challenges that - if we were able to help you with - would make you 100% satisfied with your investment? - Be specific.","type":"longtext"},{"key":"goal90","typeformRef":"791b99b8-c7e9-40a4-96d6-868399e1ae97","title":"What is your realistic goal revenue in 90 Days?","type":"text"},{"key":"goal12","typeformRef":"f4b96a9b-bd7c-4398-98b4-6a28a7d3595a","title":"What is your ideal/stretch revenue goal within the next 12-24 months?","type":"text"},{"key":"additionalInfo","typeformRef":"41d2d5bb-b023-4fa4-906c-72aeef7a5e46","title":"Any additional information we should know before starting?","type":"longtext"},{"key":"driveLink","typeformRef":"64d23c81-1784-4f07-8356-107af764fc95","title":"Please attach a Google Drive link to all the content you have for your office (See check list below)","type":"text"}]'::jsonb;
  END IF;
  RAISE EXCEPTION 'There is no Stage 4 field map for %.', coalesce(p_form_key, '(none)') USING ERRCODE = '22023';
END $$;

-- The nine dropdowns Make 12 [21] writes, each with the kickoff question it reads (4.13.3).
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_card_fields()
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT '[{"fieldId":"924bba47-32d4-4557-94d4-f475cd548dd2","ref":"ad562fc2-6858-4e37-81c5-c4cc2375a330","label":"Mahara OS Access"},
           {"fieldId":"a1520ef3-ec23-47a4-9584-e24257486a3e","ref":"b657c5a5-d199-42b5-8437-c8d04f78e376","label":"Google Calendar Integration"},
           {"fieldId":"ac976d4a-409b-441c-8c13-4b0e73a0c12f","ref":"c0000001-0000-4000-8000-00000000000a","label":"Contract Status"},
           {"fieldId":"bab9a58b-15af-4b0d-8e20-b8e5a4bee2cc","ref":"c0000001-0000-4000-8000-000000000007","label":"Service Advertised"},
           {"fieldId":"bc7e70a2-1623-426f-8ed7-fac8fed9b160","ref":"6fcbd33c-60e9-4df7-bfaa-e76b588dd887","label":"Meta Ad Account Access"},
           {"fieldId":"cc14ad2d-28ca-4eac-bbef-89b4f299ef8f","ref":"a813378f-06ce-499e-8f0e-14761b89b474","label":"WhatsApp CRM Sync"},
           {"fieldId":"d113cd99-9d35-4b12-a8fa-0cd0c19ec777","ref":"92fab954-d771-431c-9fc4-b9f15c53cbb8","label":"WhatsApp Group Status"},
           {"fieldId":"e7d158a8-e303-4df8-a78a-61a0eb3843eb","ref":"eb7ed18c-8388-4d84-9b5c-2e3d4a030287","label":"Templated Ads Status"},
           {"fieldId":"f0a20cef-e902-4200-8f55-43431b2574c6","ref":"c56a7e2d-6f18-4bf9-a9f6-11367eab4c11","label":"Training Course Access"}]'::jsonb
$$;

-- The 23 hidden fields the kickoff carries (apps/client-success-cockpit/src/forms/prefill.ts
-- KICKOFF_HIDDEN), each with the onboarding question it is read from.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_hidden_map()
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT '[{"key":"onboarding_client_id","ref":null,"label":"Client ID"},
           {"key":"legal_name","ref":"514bfd3f-4ca1-469e-b9e7-87656503f65c","label":"Business name"},
           {"key":"email","ref":"7994f0d2-baeb-451b-983a-816290873a68","label":"Email"},
           {"key":"phone","ref":"64f2fb80-b074-4017-b8b7-b7d549947e52","label":"Phone"},
           {"key":"address","ref":"e5caee43-e9b5-427d-8583-6982c5dd9be8","label":"Address"},
           {"key":"maps_link","ref":"f7f9f2eb-1761-4c28-83ed-a53621c2cf88","label":"Google Maps link"},
           {"key":"instagram","ref":"adecfe45-5d55-4319-98ff-3761e04bfc9b","label":"Instagram"},
           {"key":"website","ref":"454a425f-2ac6-4d94-92db-cec08618600e","label":"Website"},
           {"key":"facebook","ref":"575d17ed-e26d-4e55-87d3-7cb31cb71939","label":"Facebook page"},
           {"key":"booking_platform","ref":"7a120dbb-0169-4bcc-9193-5c525a470d02","label":"Booking software"},
           {"key":"hours","ref":"b7873d40-d154-42ac-bf24-cb3b667e84cc","label":"Business hours"},
           {"key":"consultants","ref":"0a80a0a8-3a09-4907-a1d1-6c57e57d4c47","label":"Who gives consultations"},
           {"key":"service_focus","ref":"6271b610-6946-4056-bb08-d03ffc274141","label":"Service to grow first"},
           {"key":"consultation_types","ref":"b370341c-6ea3-43c9-bd8c-16e278a2d2d5","label":"Appointment types"},
           {"key":"payment_options","ref":"ee25f923-d5e1-4d1a-a95f-cd9c17abbe83","label":"Payment options"},
           {"key":"last_revenue","ref":"7ff5d37a-df7f-4002-8248-d0b4af6c28e8","label":"Revenue last year"},
           {"key":"goal_90d","ref":"791b99b8-c7e9-40a4-96d6-868399e1ae97","label":"90-day goal"},
           {"key":"goal_12_24","ref":"f4b96a9b-bd7c-4398-98b4-6a28a7d3595a","label":"12 to 24-month goal"},
           {"key":"marketing_tried","ref":"bf8c7c7b-fff9-463f-b30a-8d8ca8b622f6","label":"Marketing tried"},
           {"key":"challenges","ref":"fcf43e6a-cc84-4ae7-9cef-2336069d0280","label":"Top challenges"},
           {"key":"why_joined","ref":"7426c6c5-344f-44c9-9999-3b9daf3a06b8","label":"Why they joined"},
           {"key":"client_notes","ref":"41d2d5bb-b023-4fa4-906c-72aeef7a5e46","label":"Anything else"},
           {"key":"content_drive","ref":"64d23c81-1784-4f07-8356-107af764fc95","label":"Content Drive link"}]'::jsonb
$$;

-- ---------------------------------------------------------------------------
-- 5. The versions (2.6): kickoff version 2 (the staff marker) and onboarding version 2 (client
--    schema v1). The registry rows are not touched here.

INSERT INTO public.cockpit_form_versions(form_key, version, schema, published_by, note)
VALUES ('kickoff', 2, '{"key":"kickoff","lives":"cockpit","version":2,"fields":[{"key":"detailsCorrect","typeformRef":"c0000001-0000-4000-8000-000000000001","title":"Is all of the above still correct?","type":"choice","options":["Yes","No"]},{"key":"detailsFix","typeformRef":"c0000001-0000-4000-8000-000000000002","title":"Anything to add?","type":"longtext"},{"key":"linksCorrect","typeformRef":"c0000001-0000-4000-8000-000000000003","title":"Is all of the above still correct?","type":"choice","options":["Yes","No"]},{"key":"linksFix","typeformRef":"c0000001-0000-4000-8000-000000000004","title":"Anything to add?","type":"longtext"},{"key":"operationsCorrect","typeformRef":"c0000001-0000-4000-8000-000000000005","title":"Is all of the above still correct?","type":"choice","options":["Yes","No"]},{"key":"operationsFix","typeformRef":"c0000001-0000-4000-8000-000000000006","title":"Anything to add?","type":"longtext"},{"key":"serviceAdvertised","typeformRef":"c0000001-0000-4000-8000-000000000007","title":"Which service are we advertising?","type":"multi","options":["Design and build","Interior design","Architectural design","Fit out and renovation","Construction only","Other"]},{"key":"consultationTypes","typeformRef":"c0000001-0000-4000-8000-000000000008","title":"Which consultation types do they offer?","type":"multi","options":["In-office","In-home or onsite","Online"]},{"key":"profileComplete","typeformRef":"c0000001-0000-4000-8000-000000000009","title":"Is the profile complete?","type":"choice","options":["Yes","No"]},{"key":"profileFix","typeformRef":"c0000001-0000-4000-8000-000000000011","title":"Anything to add?","type":"longtext"},{"key":"contractStatus","typeformRef":"c0000001-0000-4000-8000-00000000000a","title":"Contract status","type":"choice","options":["Signed","Sent and waiting on client","Adjustments requested by client","Not sent yet","NA - already signed"]},{"key":"inWhatsappGroup","typeformRef":"3db082bb-1939-444b-8b32-d0067fc9878c","title":"Have you been added to the WhatsApp group?","type":"choice","options":["Yes","No"]},{"key":"whatsappAdd","typeformRef":"071c480f-17f9-48db-8155-56030f952e85","title":"Who else should we add to the WhatsApp group?","type":"text"},{"key":"driveDiscussed","typeformRef":"87c68a44-b19b-4a86-a286-0a2c8c32134e","title":"Have drive folders and filling out spreadsheets been discussed? (Intro message Whatsapp group)","type":"choice","options":["Yes","No"]},{"key":"whatsappStatus","typeformRef":"92fab954-d771-431c-9fc4-b9f15c53cbb8","title":"WhatsApp Status","type":"choice","options":["Access confirmed.","Pending.","Invited.","Waiting on client."]},{"key":"adPlatforms","typeformRef":"7d16afbb-b99a-4ee9-8718-4418cbeba534","title":"Which platforms will we advertise on?","type":"text"},{"key":"dailyBudget","typeformRef":"cf53482c-3d7d-45ab-b294-0230e917ea5f","title":"What is your daily budget for the ads?","type":"text"},{"key":"adAccountName","typeformRef":"e4b9dbd3-c12c-4d6f-a0e3-c3ba17c97728","title":"What is the name of the ad account? (has to be exact)","type":"text"},{"key":"facebookPageName","typeformRef":"940f494c-f99b-4920-b203-200576ddd780","title":"What is the name of the Facebook page? (has to be exact)","type":"text"},{"key":"cardLinked","typeformRef":"8bee68fc-0764-41a8-b90a-db2a3f401e9d","title":"Correct Card Linked To The Account With Funds?","type":"choice","options":["Yes","No"]},{"key":"facebookAccess","typeformRef":"6fcbd33c-60e9-4df7-bfaa-e76b588dd887","title":"Facebook Access Status?","type":"choice","options":["Requested","Waiting on Client","Access Confirmed","Pending","Using Ours","Need Tech Help","Their Page Our Ad Acc"]},{"key":"whatsappSynced","typeformRef":"a813378f-06ce-499e-8f0e-14761b89b474","title":"Whatsapp synced to Mahara OS?","type":"choice","options":["Requested","Waiting on Client","Integrated","Needs Integrating","Pending","Not Integrating"]},{"key":"bookingConnects","typeformRef":"03b0600d-04d2-40a0-a7de-75a488888eb7","title":"Does the booking platform connect to ours?","type":"choice","options":["Yes","No"]},{"key":"calendarComplete","typeformRef":"3bebf47d-c00b-4f26-8624-933b84e42ebc","title":"Google Calendar Integration Complete?","type":"choice","options":["Yes","No"]},{"key":"calendarStatus","typeformRef":"b657c5a5-d199-42b5-8437-c8d04f78e376","title":"Booking platform & Google Calendar Integration Status","type":"choice","options":["Requested","Waiting on Client","Integrated","Needs Integrating","Pending","Not Integrating","Google Synched - Not Integrated"]},{"key":"maharaOsAccess","typeformRef":"ad562fc2-6858-4e37-81c5-c4cc2375a330","title":"Mahara OS Access Status","type":"choice","options":["Logged In","Tech Issue","Didn''t Receive Access","Doesn''t Want To"]},{"key":"contentLinks","typeformRef":"3418ef58-72df-49aa-aac3-1e095e155d45","title":"Provide any marketing content links or notes.","type":"longtext"},{"key":"contentDiscussed","typeformRef":"753c4cde-4d28-4719-8459-06e4db640180","title":"Content Discussed","type":"choice","options":["Yes","No"]},{"key":"templatedAdsDiscussed","typeformRef":"f54986bc-e120-4345-afee-31c1000a5a9a","title":"Templated Ads Discussed","type":"choice","options":["Yes","No"]},{"key":"templatedAdsStatus","typeformRef":"eb7ed18c-8388-4d84-9b5c-2e3d4a030287","title":"Templated Ads Status","type":"choice","options":["Approved","Declined","Waiting On Client","Wants To See Them First"]},{"key":"hasLeads","typeformRef":"dff79b66-89dd-43ef-9664-3fa4e6a61d69","title":"Do you have pre-existing leads?","type":"choice","options":["Yes","No"]},{"key":"reachLeads","typeformRef":"85d7ebb5-ce36-4ac3-aff8-3ce464737abd","title":"Do you want us to reach out to those leads?","type":"choice","options":["Yes","No"]},{"key":"leadsLinks","typeformRef":"86a6cce0-9111-4d98-97e7-7af5b6d518c8","title":"Provide link or notes for those leads.","type":"longtext"},{"key":"coldLeadsExperience","typeformRef":"0cb88b75-f193-43a1-b802-d382178a0946","title":"Do you have experience selling to cold leads (leads from ads)?","type":"choice","options":["Yes","No"]},{"key":"coldCloseRate","typeformRef":"079812c4-bb7e-4cc3-8e57-24c3b9e886d9","title":"What is your current close rate on cold leads?","type":"text"},{"key":"academyConfirmed","typeformRef":"4379c2f7-c5cf-4104-92c5-9b2294d65b59","title":"Premium Projects Academy Confirmed?","type":"choice","options":["Yes","No"]},{"key":"firstStepsDiscussed","typeformRef":"dc6eafd2-516e-4ca9-9d9c-89dee060e224","title":"Discussed First Steps and Important Videos?","type":"choice","options":["Yes","No"]},{"key":"trainingAccess","typeformRef":"c56a7e2d-6f18-4bf9-a9f6-11367eab4c11","title":"Training Course Access","type":"choice","options":["Confirmed","Requested","Need Tech Help","Waiting On Client"]},{"key":"paymentAmount","typeformRef":"75e97e7d-4c19-437a-b4b8-67570c29344f","title":"Payment Amount","type":"number"},{"key":"postCallFormFilled","typeformRef":"34310b2e-4df4-4ed5-b67e-9aefa9087d6e","title":"Post call form filled?","type":"text"},{"key":"callRecording","typeformRef":"b5578678-d0c2-475b-b66f-7ea54d55fe31","title":"Call Recording Link","type":"url"},{"key":"newMrrUsd","typeformRef":null,"title":"New MRR (USD a month)","type":"number","required":true,"hint":"What this client pays us each month from now. 0 if they paid in full with no monthly fee."}]}'::jsonb, 'migration 20261102j',
        'Native in the cockpit (Stage 4): the 41 answers of tG7dnxBn with their refs, plus New MRR.')
ON CONFLICT (form_key, version) DO NOTHING;
INSERT INTO public.cockpit_form_versions(form_key, version, schema, published_by, note)
VALUES ('onboarding', 2, '{"v":1,"key":"onboarding","title":{"en":"Tell us about your business","ar":"عرّفونا على شغلكم"},"intro":{"en":"Tell us about your business so your onboarding call starts in the right place. It takes about 25 minutes. Your answers stay on this device, so you can finish it in more than one sitting.","ar":"عرّفونا على شغلكم عشان مكالمة الانطلاق تبدي من المكان الصح. تاخذ تقريباً ٢٥ دقيقة، وردودكم تنحفظ على هالجهاز، فتقدرون تكملونها على كم مرة."},"minutes":25,"audience":"any","signer":"none","context":[],"fields":[{"key":"aboutYou","type":"heading","label":{"en":"About you and your business","ar":"عنكم وعن شغلكم"},"hint":null,"required":false},{"key":"fullName","type":"text","label":{"en":"Full Name","ar":"الاسم الكامل"},"required":true,"maxLength":200},{"key":"phone","type":"text","label":{"en":"Phone","ar":"رقم التلفون"},"required":true,"maxLength":200,"format":"phone"},{"key":"email","type":"text","label":{"en":"Email","ar":"الإيميل"},"required":true,"maxLength":200,"format":"email"},{"key":"businessName","type":"text","label":{"en":"Business Name","ar":"اسم الشركة"},"required":true,"maxLength":200},{"key":"address","type":"text","label":{"en":"Please enter your business address.","ar":"اكتبوا عنوان الشركة."},"required":true,"maxLength":200},{"key":"mapsLink","type":"text","label":{"en":"Paste a Google Maps link to your location.","ar":"حطوا رابط موقعكم على قوقل ماب."},"required":false,"maxLength":200},{"key":"website","type":"text","label":{"en":"Website URL","ar":"رابط الموقع"},"required":true,"maxLength":200},{"key":"instagram","type":"text","label":{"en":"Instagram URL","ar":"رابط الإنستقرام"},"required":true,"maxLength":200},{"key":"facebook","type":"text","label":{"en":"Facebook Page URL","ar":"رابط صفحة الفيسبوك"},"required":true,"maxLength":200},{"key":"paymentOptions","type":"longtext","label":{"en":"What payment options do you currently offer to your clients (e.g., full payment, installment plans, minimum down payment, in-house financing, third-party financing)?","ar":"شنو طرق الدفع اللي تعطونها لعملائكم الحين؟ (مثلاً دفعة كاملة، أقساط، دفعة أولى، تمويل منكم أو من جهة ثانية)"},"required":true,"maxLength":2000},{"key":"frontDeskPhone","type":"text","label":{"en":"Front Desk Phone","ar":"رقم الاستقبال"},"required":true,"maxLength":200,"format":"phone"},{"key":"personalPhone","type":"text","label":{"en":"Personal Phone Number","ar":"رقمك الشخصي"},"required":true,"maxLength":200,"format":"phone"},{"key":"yearsInBusiness","type":"text","label":{"en":"How long have you been in business?","ar":"من متى وانتو شغالين؟"},"required":true,"maxLength":200},{"key":"bookingSoftware","type":"text","label":{"en":"Current booking software","ar":"شنو برنامج الحجوزات اللي تستخدمونه الحين؟"},"required":true,"maxLength":200},{"key":"facebookAds","type":"choice","label":{"en":"Do you have a facebook business manager or have you ever ran ads on meta (Facebook & Instagram) in the past?","ar":"عندكم حساب أعمال على فيسبوك، أو شغّلتوا إعلانات على ميتا (فيسبوك وإنستقرام) قبل؟"},"required":true,"options":[{"value":"yes","label":{"en":"Yes","ar":"إي"}},{"value":"unsure","label":{"en":"I''m not sure","ar":"مو متأكد"}},{"value":"ran_before","label":{"en":"I''ve run ads before but don''t know how to access my account","ar":"شغّلت إعلانات قبل بس ما أعرف شلون أدخل حسابي"}},{"value":"never_ran","label":{"en":"I have a business account but have never run ads","ar":"عندي حساب أعمال بس عمري ما شغّلت إعلانات"}}]},{"key":"projectsDone","type":"text","label":{"en":"How many projects has your company completed to date?","ar":"كم مشروع خلّصت شركتكم لين الحين؟"},"required":true,"maxLength":200},{"key":"hours","type":"text","label":{"en":"Business hours - When are you open to schedule?","ar":"أوقات الدوام: متى تقدرون تستقبلون مواعيد؟"},"required":true,"maxLength":200},{"key":"servicesHeading","type":"heading","label":{"en":"Your services and appointments","ar":"خدماتكم ومواعيدكم"},"hint":null,"required":false},{"key":"services","type":"longtext","label":{"en":"1) What services do you offer list all of them? Also I want to know which ones have the HIGHEST price point and Highest Profit 2) What is the PRICE of the services?","ar":"١) شنو الخدمات اللي تقدمونها؟ اكتبوها كلها، وقولوا لنا أي وحدة سعرها أعلى وأي وحدة ربحها أعلى. ٢) شكثر سعر كل خدمة؟"},"required":true,"maxLength":2000},{"key":"serviceFocus","type":"longtext","label":{"en":"Out of those what is the #1 service/type of project you want to focus on scaling?","ar":"من هالخدمات، شنو أهم خدمة أو نوع مشروع تبون تكبرونه؟"},"required":true,"maxLength":2000},{"key":"faqs","type":"longtext","label":{"en":"What are your top five most frequently asked questions and their answers? (Feel free to add more — the more detailed, the better.)","ar":"شنو أكثر خمس أسئلة يسألونكم عنها العملاء، وشنو أجوبتها؟ (تقدرون تزيدون، وكل ما كانت التفاصيل أكثر كان أحسن.)"},"required":true,"maxLength":2000},{"key":"idealProject","type":"longtext","label":{"en":"Please describe your ideal project in detail.","ar":"وصفوا لنا المشروع المثالي لكم بالتفصيل."},"required":true,"maxLength":2000},{"key":"serviceAreas","type":"longtext","label":{"en":"What service areas do you cover? Please list all cities and neighborhoods you serve so we can target your ads precisely.","ar":"شنو المناطق اللي تخدمونها؟ اكتبوا كل المدن والمناطق عشان نوجّه الإعلانات صح."},"required":true,"maxLength":2000},{"key":"appointmentTypes","type":"multi","label":{"en":"What types of appointments do you offer? (Select all that apply)","ar":"شنو أنواع المواعيد اللي تقدمونها؟ (اختاروا كل اللي ينطبق)"},"required":true,"options":[{"value":"online","label":{"en":"Online","ar":"أونلاين"}},{"value":"onsite","label":{"en":"Onsite / In-home","ar":"في موقع العميل أو بيته"}},{"value":"office","label":{"en":"In your office","ar":"في مكتبكم"}}]},{"key":"maxDistance","type":"text","label":{"en":"What''s the maximum distance you would travel from your office to do an in-home consultation?","ar":"شكثر أبعد مسافة تروحونها من مكتبكم عشان استشارة في بيت العميل؟"},"required":false,"hint":{"en":"Only if you visit clients at home.","ar":"بس إذا تزورون العملاء في بيوتهم."},"maxLength":200},{"key":"landmark","type":"text","label":{"en":"Local Landmark Information (Please type this in the format shown) - Located next to the Burger King down King Saud street on the left hand side.","ar":"معلم قريب منكم (اكتبوه بنفس الطريقة): مثلاً جنب برقر كنق بشارع الملك سعود على اليسار."},"required":true,"maxLength":200},{"key":"appointmentLength","type":"text","label":{"en":"Appointment length + details + buffer","ar":"مدة الموعد، تفاصيله، والوقت بين كل موعد والثاني"},"required":true,"maxLength":200},{"key":"consultants","type":"longtext","label":{"en":"Who are the engineers in your business that will be giving these consultations?","ar":"منو المهندسين في شركتكم اللي بيعطون الاستشارات ضمن هالبرنامج؟"},"required":true,"maxLength":2000},{"key":"goalsHeading","type":"heading","label":{"en":"Your goals and marketing","ar":"أهدافكم والتسويق"},"hint":null,"required":false},{"key":"whyJoined","type":"longtext","label":{"en":"What motivated you to join our program? What was the reason you signed up?","ar":"شنو اللي خلاكم تنضمون للبرنامج؟ ليش اشتركتوا؟"},"required":true,"maxLength":2000},{"key":"freeConsults","type":"choice","label":{"en":"Do you offer free consultations?","ar":"تقدمون استشارات مجانية؟"},"required":true,"options":[{"value":"yes","label":{"en":"Yes, we offer free consultations","ar":"إي، نقدم استشارات مجانية"}},{"value":"open_to_it","label":{"en":"No, but we are open to it","ar":"لا، بس نقدر نفكر فيها"}},{"value":"no","label":{"en":"No, we do not offer them","ar":"لا، ما نقدمها"}}]},{"key":"marketing","type":"longtext","label":{"en":"What is your marketing process? In other words... please explain EVERYTHING A-Z that you have in place or have tried to generate new projects","ar":"شلون تسوقون الحين؟ يعني اشرحوا لنا كل شي من الألف للياء، اللي عندكم أو اللي جربتوه عشان تجيبون مشاريع يديدة."},"required":true,"maxLength":2000},{"key":"lastRevenue","type":"text","label":{"en":"Last Calendar Year - How Much Total Revenue did you do?","ar":"السنة اللي طافت: شكثر كان مجموع دخلكم؟"},"required":true,"maxLength":200},{"key":"challenges","type":"longtext","label":{"en":"What are the TOP 3 challenges that - if we were able to help you with - would make you 100% satisfied with your investment? - Be specific.","ar":"شنو أكبر ٣ تحديات، لو ساعدناكم فيها، بتكونون راضين ١٠٠٪ عن استثماركم؟ خلكم محددين."},"required":true,"maxLength":2000},{"key":"goal90","type":"text","label":{"en":"What is your realistic goal revenue in 90 Days?","ar":"شكثر الدخل اللي تطمحون له بشكل واقعي خلال ٩٠ يوم؟"},"required":true,"maxLength":200},{"key":"goal12","type":"text","label":{"en":"What is your ideal/stretch revenue goal within the next 12-24 months?","ar":"شكثر الدخل اللي تحلمون فيه خلال ١٢ إلى ٢٤ شهر؟"},"required":true,"maxLength":200},{"key":"additionalInfo","type":"longtext","label":{"en":"Any additional information we should know before starting?","ar":"فيه شي ثاني لازم نعرفه قبل لا نبدي؟"},"required":false,"maxLength":2000},{"key":"driveLink","type":"text","label":{"en":"Please attach a Google Drive link to all the content you have for your office.","ar":"حطوا رابط قوقل درايف فيه كل المحتوى اللي عندكم لمكتبكم."},"required":false,"hint":{"en":"Photos, videos, your logo and past projects, all in one shared folder.","ar":"الصور والفيديوهات والشعار والمشاريع اللي سويتوها، كلها في فولدر واحد."},"maxLength":200}],"reads":{"profile":["lastRevenue","goal90","goal12","marketing","challenges","whyJoined","additionalInfo"],"contact":["fullName","businessName"]},"submit":{"en":"Send my answers","ar":"أرسل ردودي"},"done":{"en":"Got it. Your account manager will see your answers before your onboarding call.","ar":"وصلنا. مدير حسابكم بيشوف ردودكم قبل مكالمة الانطلاق."},"invite":{"whatsapp":{"en":"Hi {client} team, here is your onboarding form. Fill it before our onboarding call: {form_link}","ar":"هلا فريق {client}، هذا فورم التعريف. عبّوه قبل مكالمة الانطلاق: {form_link}"},"push":{"en":"Your onboarding form is ready. Tap to start.","ar":"فورم التعريف جاهز. اضغط وابدِ."}}}'::jsonb, 'migration 20261102j',
        'Native in the portal (Stage 4): the 36 questions of KFRCXPFx; other-language lines are drafts for the CEO.')
ON CONFLICT (form_key, version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Small readers (internal)

CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_setting(p_key text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT CASE WHEN jsonb_typeof(s.value) = 'object' THEN s.value END
                     FROM public.cockpit_settings s WHERE s.key = p_key), '{}'::jsonb)
$$;

-- forms.stage4.<form> is exactly true.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_on(p_form_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(public.cockpit_form_stage4_setting('forms.stage4')->p_form_key = 'true'::jsonb, false)
$$;

CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_ts(p text)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN p::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

-- The card's first stored kickoff, whatever its door: the read model (any form_id, the 30 from
-- tG7dnxBn and BbJy6xg4 included) or a kickoff response that is not void (the 8 pointer rows, the
-- native ones). NULL when none. p_except leaves one response out (the one being planned).
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_kickoff_at(p_task_id text, p_except uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT least(
    (SELECT coalesce(public.cockpit_form_stage4_ts(o.forms->'kickoff'->>'submitted_at'), o.synced_at)
       FROM public.cockpit_client_onboarding o
      WHERE o.clickup_task_id = p_task_id AND jsonb_typeof(o.forms->'kickoff') = 'object'
        AND (p_except IS NULL OR o.forms->'kickoff'->>'response_id' IS DISTINCT FROM p_except::text)),
    (SELECT min(coalesce(r.submitted_at, r.created_at)) FROM public.cockpit_form_responses r
      WHERE r.form_key = 'kickoff' AND r.task_id = p_task_id AND r.state NOT IN ('draft','void') AND r.mode = 'live'
        AND (p_except IS NULL OR r.id <> p_except)))
$$;

-- The card's first stored onboarding answer (the read model with any form_id, or a live onboarding
-- response that is not void: Typeform, legacy or native), else its first stored kickoff (the card is
-- past onboarding). NULL when neither. The once-per-card rule of 4.14. p_except leaves one response
-- out, and p_except_ref the read model entry of the same answer (its Typeform token, which the
-- onboarding sync may have written first).
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_answered_at(p_task_id text, p_except uuid, p_except_ref text DEFAULT NULL)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(
    least(
      (SELECT coalesce(public.cockpit_form_stage4_ts(o.forms->'onboarding'->>'submitted_at'), o.synced_at)
         FROM public.cockpit_client_onboarding o
        WHERE o.clickup_task_id = p_task_id AND jsonb_typeof(o.forms->'onboarding') = 'object'
          AND (p_except IS NULL OR o.forms->'onboarding'->>'response_id' IS DISTINCT FROM p_except::text)
          AND (p_except_ref IS NULL OR o.forms->'onboarding'->>'response_id' IS DISTINCT FROM p_except_ref)),
      (SELECT min(coalesce(r.submitted_at, r.created_at)) FROM public.cockpit_form_responses r
        WHERE r.form_key = 'onboarding' AND r.task_id = p_task_id AND r.state NOT IN ('draft','void') AND r.mode = 'live'
          AND (p_except IS NULL OR r.id <> p_except))),
    public.cockpit_form_stage4_kickoff_at(p_task_id, p_except))
$$;

-- An answer as Typeform words it: a list joined with ", ", a number without trailing zeros.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_text(p jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE jsonb_typeof(p)
    WHEN 'string' THEN p #>> '{}'
    WHEN 'number' THEN trim_scale((p #>> '{}')::numeric)::text
    WHEN 'boolean' THEN CASE WHEN (p #>> '{}')::boolean THEN 'Yes' ELSE 'No' END
    WHEN 'array' THEN (SELECT string_agg(x #>> '{}', ', ' ORDER BY n) FROM jsonb_array_elements(p) WITH ORDINALITY AS u(x, n))
    ELSE NULL END
$$;

-- Native answers (keyed by question key) as the Typeform answers list [{ref, title, value}], in the
-- form's order, blanks left out: the shape the read model, the texts and Make's inputs share.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_typeform_answers(p_form_key text, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s jsonb; v jsonb; v_text text; v_out jsonb := '[]'::jsonb;
BEGIN
  FOR s IN SELECT x FROM jsonb_array_elements(public.cockpit_form_stage4_fields(p_form_key)) WITH ORDINALITY AS u(x, n) ORDER BY n LOOP
    v := p_answers -> (s->>'key');
    CONTINUE WHEN v IS NULL OR v = 'null'::jsonb;
    IF p_form_key = 'onboarding' AND s->>'type' IN ('choice','multi') THEN
      SELECT string_agg(o->>'typeform', ', ' ORDER BY n) INTO v_text
        FROM jsonb_array_elements(s->'options') WITH ORDINALITY AS u(o, n)
       WHERE (jsonb_typeof(v) = 'string' AND v #>> '{}' = o->>'value')
          OR (jsonb_typeof(v) = 'array' AND v ? (o->>'value'));
    ELSIF s->>'type' = 'multi' AND jsonb_typeof(v) = 'array' THEN
      -- The kickoff's lists keep the form's option order.
      SELECT string_agg(o #>> '{}', ', ' ORDER BY n) INTO v_text
        FROM jsonb_array_elements(s->'options') WITH ORDINALITY AS u(o, n) WHERE v ? (o #>> '{}');
    ELSE
      v_text := public.cockpit_form_stage4_text(v);
    END IF;
    CONTINUE WHEN v_text IS NULL OR btrim(v_text) = '';
    v_out := v_out || jsonb_build_array(jsonb_build_object('ref', s->>'typeformRef', 'title', s->>'title', 'value', v_text));
  END LOOP;
  RETURN v_out;
END $$;

-- A Typeform answers list mapped back to native answers by ref (the Typeform door, the parity plan):
-- a choice by its exact Typeform label, a list split on ", ". A label the map does not know is kept
-- out and named in _unmapped (refs only), never guessed.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_native_answers(p_form_key text, p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s jsonb; a jsonb; v_raw text; v_out jsonb := '{}'::jsonb; v_un text[] := '{}'; v_vals jsonb; v_part text; v_hit text;
BEGIN
  FOR s IN SELECT x FROM jsonb_array_elements(public.cockpit_form_stage4_fields(p_form_key)) x LOOP
    SELECT y INTO a FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_fields) = 'array' THEN p_fields ELSE '[]'::jsonb END) y
     WHERE y->>'ref' = s->>'typeformRef' LIMIT 1;
    CONTINUE WHEN a IS NULL;
    v_raw := public.cockpit_form_stage4_text(a->'value');
    a := NULL;
    CONTINUE WHEN v_raw IS NULL OR btrim(v_raw) = '';
    IF s->>'type' IN ('choice','multi') THEN
      v_vals := '[]'::jsonb;
      FOREACH v_part IN ARRAY CASE WHEN s->>'type' = 'multi' THEN string_to_array(v_raw, ', ') ELSE ARRAY[v_raw] END LOOP
        v_hit := NULL;
        IF p_form_key = 'onboarding' THEN
          SELECT o->>'value' INTO v_hit FROM jsonb_array_elements(s->'options') o WHERE o->>'typeform' = btrim(v_part) LIMIT 1;
        ELSE
          SELECT o #>> '{}' INTO v_hit FROM jsonb_array_elements(s->'options') o WHERE o #>> '{}' = btrim(v_part) LIMIT 1;
        END IF;
        IF v_hit IS NULL THEN
          v_un := v_un || (s->>'typeformRef');
        ELSE
          v_vals := v_vals || to_jsonb(v_hit);
        END IF;
      END LOOP;
      IF jsonb_array_length(v_vals) > 0 THEN
        v_out := v_out || jsonb_build_object(s->>'key', CASE WHEN s->>'type' = 'multi' THEN v_vals ELSE v_vals->0 END);
      END IF;
    ELSIF s->>'type' = 'number' THEN
      IF btrim(replace(replace(v_raw, ',', ''), '$', '')) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
        v_out := v_out || jsonb_build_object(s->>'key', btrim(replace(replace(v_raw, ',', ''), '$', ''))::numeric);
      ELSE
        v_out := v_out || jsonb_build_object(s->>'key', v_raw);
      END IF;
    ELSE
      v_out := v_out || jsonb_build_object(s->>'key', v_raw);
    END IF;
  END LOOP;
  IF cardinality(v_un) > 0 THEN
    v_out := v_out || jsonb_build_object('_unmapped', (SELECT jsonb_agg(DISTINCT u) FROM unnest(v_un) u));
  END IF;
  RETURN v_out;
END $$;

-- The kickoff's hidden values for one card, each with where it came from (4.13.1): the newest
-- stored onboarding answer (the read model, any door), the card's id and name. Never stored on a
-- response (the client's email and phone ride here).
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_hidden(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o public.cockpit_client_onboarding; h jsonb; v text; v_out jsonb := '{}'::jsonb; v_name text;
BEGIN
  SELECT * INTO o FROM public.cockpit_client_onboarding x WHERE x.clickup_task_id = p_task_id;
  SELECT a.client_name INTO v_name FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = p_task_id;
  v_name := coalesce(nullif(btrim(v_name), ''), nullif(btrim(o.client_name), ''));
  FOR h IN SELECT x FROM jsonb_array_elements(public.cockpit_form_stage4_hidden_map()) x LOOP
    v := NULL;
    IF h->>'key' = 'onboarding_client_id' THEN
      v_out := v_out || jsonb_build_object(h->>'key', jsonb_build_object('value', p_task_id, 'source', 'card'));
      CONTINUE;
    END IF;
    IF jsonb_typeof(o.forms->'onboarding'->'answers') = 'array' THEN
      SELECT nullif(btrim(a->>'value'), '') INTO v FROM jsonb_array_elements(o.forms->'onboarding'->'answers') a
       WHERE a->>'ref' = h->>'ref' LIMIT 1;
    END IF;
    IF v IS NOT NULL THEN
      v_out := v_out || jsonb_build_object(h->>'key', jsonb_build_object('value', v, 'source', 'onboarding'));
    ELSIF h->>'key' = 'legal_name' AND v_name IS NOT NULL THEN
      v_out := v_out || jsonb_build_object(h->>'key', jsonb_build_object('value', v_name, 'source', 'card'));
    END IF;
  END LOOP;
  RETURN v_out;
END $$;

-- A template with {{hidden:<name>}}, {{answer:<ref>}}, {{client}}, {{task}}, {{answers}} and
-- {{newMrr}}; a placeholder with no value is left empty.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_render(p_template text, p_vars jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_out text := p_template; m text[];
BEGIN
  IF p_template IS NULL THEN RETURN NULL; END IF;
  FOR m IN SELECT regexp_matches(p_template, '\{\{(hidden|answer):([A-Za-z0-9_-]{1,60})\}\}', 'g') LOOP
    v_out := replace(v_out, '{{' || m[1] || ':' || m[2] || '}}',
                     coalesce(CASE m[1] WHEN 'hidden' THEN p_vars->'hidden'->>m[2] ELSE p_vars->'byRef'->>m[2] END, ''));
  END LOOP;
  v_out := replace(v_out, '{{client}}', coalesce(p_vars->>'client', ''));
  v_out := replace(v_out, '{{task}}', coalesce(p_vars->>'task', ''));
  v_out := replace(v_out, '{{answers}}', coalesce(p_vars->>'answers', ''));
  v_out := replace(v_out, '{{newMrr}}', coalesce(p_vars->>'newMrr', ''));
  RETURN v_out;
END $$;

-- A phase message from stage4.messages, or the sentence why it cannot go: never a blank text.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_message(p_phase text, p_client text, p_map text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_text text := public.cockpit_form_stage4_setting('stage4.messages')->>p_phase; v_rule text;
BEGIN
  IF v_text IS NULL OR btrim(v_text) = '' THEN
    RETURN jsonb_build_object('missing', format('The %s WhatsApp text is not set up yet (stage4.messages.%s), so no message was drafted.',
                                                replace(p_phase, 'phase', 'phase '), p_phase));
  END IF;
  IF position('{map_link}' IN v_text) > 0 AND p_map IS NULL THEN
    RETURN jsonb_build_object('missing', format('The %s WhatsApp text needs the map link, which is not set up yet.', replace(p_phase, 'phase', 'phase ')));
  END IF;
  v_text := replace(replace(v_text, '{client}', coalesce(p_client, '')), '{map_link}', coalesce(p_map, ''));
  v_rule := public.cockpit_client_text_ok(v_text);
  IF v_rule IS NOT NULL THEN
    RETURN jsonb_build_object('missing', v_rule);
  END IF;
  IF char_length(v_text) > 1500 THEN
    RETURN jsonb_build_object('missing', format('The %s WhatsApp text is over 1,500 characters.', replace(p_phase, 'phase', 'phase ')));
  END IF;
  RETURN jsonb_build_object('body', v_text);
END $$;

-- A map link for one phase, the card's id in it (onboarding.map_urls, {task} or {cid}).
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_map_url(p_phase integer, p_task_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT nullif(replace(replace(btrim(public.cockpit_form_stage4_setting('onboarding.map_urls')->>(p_phase::text)),
                                '{task}', p_task_id), '{cid}', p_task_id), '')
$$;

-- ---------------------------------------------------------------------------
-- 7. The plan builder: one input in, every effect's write out (4.13.3, 4.14.3). Pure but for the
--    settings it reads (map links, phase texts, templates) and the option maps. The planner and the
--    parity plan both use it, so a recorded Make input and a native answer are planned alike.
--
--    Input: {formKey, taskId, client, responseId, submittedAt, second, answers: [{ref, title, value}],
--    hidden: {name: value}, newMrrUsd, cardMrr, cardOnSheet, readModelFormId, readModelResponseId}.
--    Out: [{key, delivery, plan, skip, missing}] in the version-2 order; skip and missing are
--    sentences (skip: nothing to do; missing: it cannot be done and says why).

CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_build(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_form text := p_input->>'formKey';
  v_task text := p_input->>'taskId';
  v_client text := coalesce(nullif(btrim(p_input->>'client'), ''), 'this client');
  v_answers jsonb := CASE WHEN jsonb_typeof(p_input->'answers') = 'array' THEN p_input->'answers' ELSE '[]'::jsonb END;
  v_hidden jsonb := CASE WHEN jsonb_typeof(p_input->'hidden') = 'object' THEN p_input->'hidden' ELSE '{}'::jsonb END;
  v_second boolean := coalesce((p_input->>'second')::boolean, false);
  v_templates jsonb := public.cockpit_form_stage4_setting('stage4.templates');
  v_by_ref jsonb;
  v_vars jsonb;
  v_list text;
  v_hidden_lines text;
  v_handoff text;
  v_new numeric;
  v_card numeric;
  v_fields jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  c jsonb;
  v_answer text;
  v_option text;
  v_part text;
  v_map text;
  v_msg jsonb;
  v_profile text;
  v_raw text;
  v_out jsonb := '[]'::jsonb;
  v_skip text;
  e jsonb;
BEGIN
  IF v_form NOT IN ('kickoff','onboarding') OR v_task IS NULL OR v_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'The Stage 4 plan needs the form and the card.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_object_agg(a->>'ref', a->>'value'), '{}'::jsonb) INTO v_by_ref FROM jsonb_array_elements(v_answers) a;
  SELECT string_agg((a->>'title') || ': ' || (a->>'value'), E'\n' ORDER BY n) INTO v_list
    FROM jsonb_array_elements(v_answers) WITH ORDINALITY AS u(a, n);

  IF v_form = 'kickoff' THEN
    -- The handoff text (Make 12 [11], [18], [23]): the hidden values, then every answer.
    SELECT string_agg((h->>'label') || ': ' || (v_hidden->>(h->>'key')), E'\n' ORDER BY n) INTO v_hidden_lines
      FROM jsonb_array_elements(public.cockpit_form_stage4_hidden_map()) WITH ORDINALITY AS u(h, n)
     WHERE nullif(btrim(coalesce(v_hidden->>(h->>'key'), '')), '') IS NOT NULL;
    v_new := CASE WHEN jsonb_typeof(p_input->'newMrrUsd') = 'number' THEN (p_input->>'newMrrUsd')::numeric END;
    v_card := CASE WHEN jsonb_typeof(p_input->'cardMrr') = 'number' THEN (p_input->>'cardMrr')::numeric END;
    v_vars := jsonb_build_object('hidden', v_hidden, 'byRef', v_by_ref, 'client', v_client, 'task', v_task,
                                 'answers', coalesce(v_list, ''),
                                 'newMrr', CASE WHEN v_new IS NULL THEN '' ELSE trim_scale(v_new)::text END);
    v_handoff := CASE WHEN nullif(btrim(coalesce(v_templates->>'handoff', '')), '') IS NOT NULL
                      THEN public.cockpit_form_stage4_render(v_templates->>'handoff', v_vars)
                      ELSE array_to_string(ARRAY[
                             'KICKOFF HANDOFF for ' || v_client,
                             'CLIENT DETAILS' || E'\n' || coalesce(v_hidden_lines, 'No onboarding answers on file.'),
                             'KICKOFF ANSWERS' || E'\n' || coalesce(v_list, 'No answers.'),
                             'New MRR: ' || CASE WHEN v_new IS NULL THEN 'not given' ELSE '$' || trim_scale(v_new)::text || ' a month' END],
                           E'\n\n') END;

    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'handoff_comment', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'comment_text', v_handoff,
                                 'lines', jsonb_build_array('Handoff comment on the card (' || char_length(v_handoff) || ' characters)'))));
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'native_status', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'status', 'IN PROGRESS', 'lines', jsonb_build_array('Task status: IN PROGRESS'))));

    -- The card fields (Make 12 [21]): Client Status, the nine dropdowns by the option maps, and the
    -- Blueprint link pointing at the cockpit Blueprint (the intended difference of 4.13.3).
    v_fields := jsonb_build_array(jsonb_build_object('fieldId', '9368ca9e-3549-4320-84ff-9abd0a2901cb', 'kind', 'drop_down',
      'optionId', 'dbd21650-59ce-429c-882d-5afd7d8aaa8a', 'optionName', 'Brand Blueprint Booked♠️', 'label', 'Client Status'));
    v_lines := jsonb_build_array('Client Status: Brand Blueprint Booked♠️');
    FOR c IN SELECT x FROM jsonb_array_elements(public.cockpit_form_stage4_card_fields()) WITH ORDINALITY AS u(x, n) ORDER BY n LOOP
      v_answer := nullif(btrim(coalesce(v_by_ref->>(c->>'ref'), '')), '');
      CONTINUE WHEN v_answer IS NULL;
      v_option := NULL;
      -- A list (Service Advertised is a multi choice): the first listed answer the map knows. Make's
      -- switch() never matches a list (kickoff-path.md 2), so this field was empty on every card.
      FOREACH v_part IN ARRAY string_to_array(v_answer, ', ') LOOP
        SELECT m.option_name INTO v_option FROM public.cockpit_form_option_maps m
         WHERE m.form_key = 'kickoff' AND m.field_id = c->>'fieldId' AND m.answer = btrim(v_part);
        EXIT WHEN v_option IS NOT NULL;
      END LOOP;
      CONTINUE WHEN v_option IS NULL;
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', c->>'fieldId', 'kind', 'drop_down',
        'optionName', v_option, 'label', c->>'label'));
      v_lines := v_lines || to_jsonb((c->>'label') || ': ' || v_option);
    END LOOP;
    v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', '1b7a4a74-d0e7-4a7f-9218-59c80a738186', 'kind', 'url',
      'value', 'https://cockpit.maharamedia.com/client-success/clients/' || v_task || '/present/blueprint?view=prep',
      'label', '🧬 Brand Blueprint Form Link'));
    v_lines := v_lines || to_jsonb('🧬 Brand Blueprint Form Link: the cockpit Blueprint'::text);
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'card_fields', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'fields', v_fields, 'lines', v_lines)));

    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'onboarding_tasks', 'delivery', 'sql',
      'plan', jsonb_build_object('typeKey', 'client_onboarding', 'details', left(v_handoff, 4000),
                                 'lines', jsonb_build_array('Technical Onboarding Check and Creative Onboarding tasks'))));

    v_map := public.cockpit_form_stage4_map_url(4, v_task);
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'map_phase4', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'fieldId', '51f49cb1-9f76-48be-b639-c42ca552d20a', 'phase', 4, 'value', v_map,
                                 'lines', jsonb_build_array('Onboarding Map: phase 4')),
      'missing', CASE WHEN v_map IS NULL THEN 'The phase 4 map link is not set up yet (onboarding.map_urls), so the map was not moved.' END));

    v_msg := public.cockpit_form_stage4_message('phase4', p_input->>'client', v_map);
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'phase4_whatsapp', 'delivery', 'client_message',
      'plan', jsonb_build_object('kind', 'phase4', 'body', v_msg->>'body', 'lines', jsonb_build_array('Phase 4 WhatsApp, waiting for the CSM''s approval')),
      'missing', v_msg->>'missing'));

    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'kickoff_notice', 'delivery', 'slack_notice',
      'plan', jsonb_build_object('dedupe', 'kickoff:' || coalesce(p_input->>'readModelResponseId', p_input->>'responseId', ''),
                                 'lines', jsonb_build_array('Kickoff notice in #csm-general'))));

    -- New MRR (Q21, 3.5): the live mrr write only when the answer differs from the card's; never for
    -- 0 against an empty card MRR; never for a card off the billing sheet.
    v_skip := CASE
      WHEN v_new IS NULL THEN 'No New MRR answer, so the card''s MRR is left as it is.'
      WHEN NOT coalesce((p_input->>'cardOnSheet')::boolean, false) THEN 'This card is not on the billing sheet, so New MRR is not written.'
      WHEN v_card IS NOT NULL AND v_card = v_new THEN 'The card already shows that MRR.'
      WHEN v_new = 0 AND coalesce(v_card, 0) = 0 THEN 'New MRR is 0 and the card''s MRR is empty, so nothing changes.'
    END;
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'new_mrr', 'delivery', 'sql',
      'plan', jsonb_build_object('from', v_card, 'to', v_new,
                                 'reason', CASE WHEN v_new = 0 THEN 'Kickoff: paid in full, no monthly fee' ELSE 'Kickoff: New MRR answer' END,
                                 'lines', jsonb_build_array('MRR: ' || coalesce('$' || trim_scale(v_card)::text, 'empty') || ' to '
                                                            || coalesce('$' || trim_scale(v_new)::text, 'not given'))),
      'skip', v_skip));
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'recap', 'delivery', 'client_message',
      'plan', jsonb_build_object('lines', jsonb_build_array('Recap: stays off (Q22)')),
      'skip', 'Kickoff recaps stay off (Q22).'));

    -- A second kickoff (4.13, 3.3): only the handoff comment again.
    IF v_second THEN
      SELECT coalesce(jsonb_agg(CASE WHEN x->>'key' = 'handoff_comment' THEN x
                                     ELSE x || jsonb_build_object('skip', coalesce(x->>'skip',
                                       'A second kickoff posts only the handoff comment.')) END ORDER BY n), '[]'::jsonb)
        INTO v_out FROM jsonb_array_elements(v_out) WITH ORDINALITY AS u(x, n);
    END IF;
    RETURN v_out;
  END IF;

  -- Onboarding (Make 13): the Client Profile and the kickoff link, the raw answers comment, the map
  -- at phase 3, the Client Data row and the market intel dispatch (relay), the phase 3 WhatsApp, the
  -- Brand DNA task and the read model.
  v_vars := jsonb_build_object('hidden', v_hidden, 'byRef', v_by_ref, 'client', v_client, 'task', v_task,
                               'answers', coalesce(v_list, ''), 'newMrr', '');
  SELECT string_agg(x.label || ': ' || (v_by_ref->>x.ref), E'\n' ORDER BY x.n) INTO v_profile
    FROM (VALUES (1, '7ff5d37a-df7f-4002-8248-d0b4af6c28e8', 'Revenue last year'),
                 (2, '791b99b8-c7e9-40a4-96d6-868399e1ae97', '90-day goal'),
                 (3, 'f4b96a9b-bd7c-4398-98b4-6a28a7d3595a', '12 to 24-month goal'),
                 (4, 'bf8c7c7b-fff9-463f-b30a-8d8ca8b622f6', 'Marketing tried'),
                 (5, 'fcf43e6a-cc84-4ae7-9cef-2336069d0280', 'Top challenges'),
                 (6, '7426c6c5-344f-44c9-9999-3b9daf3a06b8', 'Why they joined'),
                 (7, '41d2d5bb-b023-4fa4-906c-72aeef7a5e46', 'Anything else')) AS x(n, ref, label)
   WHERE nullif(btrim(coalesce(v_by_ref->>x.ref, '')), '') IS NOT NULL;
  v_profile := CASE WHEN nullif(btrim(coalesce(v_templates->>'profile', '')), '') IS NOT NULL
                    THEN public.cockpit_form_stage4_render(v_templates->>'profile', v_vars)
                    ELSE coalesce(v_profile, '') END;
  v_raw := CASE WHEN nullif(btrim(coalesce(v_templates->>'rawAnswers', '')), '') IS NOT NULL
                THEN public.cockpit_form_stage4_render(v_templates->>'rawAnswers', v_vars)
                ELSE 'Raw Onboarding Form Answers' || E'\n\n' || coalesce(v_list, 'No answers.') END;
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'profile_fields', 'delivery', 'clickup_queue',
    'plan', jsonb_build_object('taskId', v_task, 'fields', jsonb_build_array(
        jsonb_build_object('fieldId', '7755485f-74a8-496c-85d8-562588e77944', 'kind', 'text', 'value', left(v_profile, 5000), 'label', 'Client Profile'),
        jsonb_build_object('fieldId', '87d7d889-afea-42f8-9485-6f3ead5b857f', 'kind', 'url',
                           'value', 'https://cockpit.maharamedia.com/client-success/clients/' || v_task || '?form=kickoff',
                           'label', 'Kickoff Form Link')),
      'lines', jsonb_build_array('Client Profile (' || char_length(v_profile) || ' characters)', 'Kickoff Form Link: the cockpit kickoff'))));
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'raw_answers_comment', 'delivery', 'clickup_queue',
    'plan', jsonb_build_object('taskId', v_task, 'comment_text', v_raw,
                               'lines', jsonb_build_array('Raw answers comment (' || char_length(v_raw) || ' characters)'))));
  v_map := public.cockpit_form_stage4_map_url(3, v_task);
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'map_phase3', 'delivery', 'clickup_queue',
    'plan', jsonb_build_object('taskId', v_task, 'fieldId', '51f49cb1-9f76-48be-b639-c42ca552d20a', 'phase', 3, 'value', v_map,
                               'lines', jsonb_build_array('Onboarding Map: phase 3')),
    'missing', CASE WHEN v_map IS NULL THEN 'The phase 3 map link is not set up yet (onboarding.map_urls), so the map was not moved.' END));
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'client_data_row', 'delivery', 'relay',
    'plan', jsonb_build_object('payload', jsonb_build_object('taskId', v_task, 'client', p_input->>'client',
                                                             'submittedAt', p_input->>'submittedAt', 'answers', v_by_ref),
                               'lines', jsonb_build_array('Client Data sheet row'))));
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'github_dispatch', 'delivery', 'relay',
    'plan', jsonb_build_object('payload', jsonb_build_object('taskId', v_task, 'client', p_input->>'client'),
                               'lines', jsonb_build_array('Market intel dispatch'))));
  v_msg := public.cockpit_form_stage4_message('phase3', p_input->>'client', v_map);
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'phase3_whatsapp', 'delivery', 'client_message',
    'plan', jsonb_build_object('kind', 'phase3', 'body', v_msg->>'body', 'lines', jsonb_build_array('Phase 3 WhatsApp, waiting for the CSM''s approval')),
    'missing', v_msg->>'missing'));
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'brand_dna_task', 'delivery', 'sql',
    'plan', jsonb_build_object('typeKey', 'brand_dna', 'details', left(v_raw, 4000), 'lines', jsonb_build_array('Brand DNA task'))));
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'read_model', 'delivery', 'sql',
    'plan', jsonb_build_object('entry', jsonb_build_object('form_id', coalesce(p_input->>'readModelFormId', 'native'),
                                                           'response_id', coalesce(p_input->>'readModelResponseId', p_input->>'responseId'),
                                                           'submitted_at', p_input->>'submittedAt', 'answers', v_answers),
                               'lines', jsonb_build_array('Answers in the client record'))));
  RETURN v_out;
END $$;

-- One response as the builder's input. Kickoff: the hidden values are read now from the card's
-- onboarding answers (never stored on the response); New MRR and the card's MRR from the billing
-- sheet. Onboarding: a Typeform door answer keeps its token as the read model's response id.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_input(p_response_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_form_responses; a public.cockpit_billing_accounts; v_hidden jsonb := '{}'::jsonb; h record;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF r.id IS NULL OR r.form_key NOT IN ('kickoff','onboarding') OR r.task_id IS NULL THEN
    RAISE EXCEPTION 'There is no Stage 4 answer with that ID.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM public.cockpit_billing_accounts x WHERE x.clickup_task_id = r.task_id;
  IF r.form_key = 'kickoff' THEN
    FOR h IN SELECT k, v FROM jsonb_each(public.cockpit_form_stage4_hidden(r.task_id)) AS e(k, v) LOOP
      v_hidden := v_hidden || jsonb_build_object(h.k, h.v->>'value');
    END LOOP;
  END IF;
  RETURN jsonb_build_object(
    'formKey', r.form_key, 'taskId', r.task_id,
    'client', coalesce(nullif(btrim(a.client_name), ''), r.client_name),
    'responseId', r.id, 'submittedAt', to_char(r.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'second', coalesce((r.answer_meta->>'second')::boolean, false),
    'answers', public.cockpit_form_stage4_typeform_answers(r.form_key, r.answers),
    'hidden', v_hidden,
    'newMrrUsd', CASE WHEN jsonb_typeof(r.answers->'newMrrUsd') = 'number' THEN r.answers->'newMrrUsd' END,
    'cardMrr', to_jsonb(a.mrr_usd), 'cardOnSheet', a.clickup_task_id IS NOT NULL,
    'readModelFormId', CASE WHEN r.source IN ('typeform_webhook','typeform_sync') THEN 'KFRCXPFx' ELSE 'native' END,
    'readModelResponseId', CASE WHEN r.source IN ('typeform_webhook','typeform_sync') THEN r.external_id ELSE r.id::text END);
END $$;

-- ---------------------------------------------------------------------------
-- 8. The system's requests (2.6): the two onboarding tasks and the Brand DNA task, through the
--    requests writer like any request. Deduped per response and per card: a card that already has
--    a live request of that type made by a form gets none. The types are added at D-S4.0
--    (cockpit_request_type_add); until then this says so and makes nothing.

CREATE OR REPLACE FUNCTION public.cockpit_request_create_system(p_type_key text, p_task_id text, p_answers jsonb, p_response_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.cockpit_request_types;
  r public.cockpit_form_responses;
  v_existing public.cockpit_requests;
  v_id uuid := gen_random_uuid();
  v_answers jsonb := '{}'::jsonb;
  v_client text;
  v_member uuid;
  v_email text;
  v_label text;
  v_due date;
  v_plan jsonb;
  v_e jsonb;
  v_queue uuid;
  v_details text := nullif(btrim(coalesce(p_answers->>'details', '')), '');
BEGIN
  IF p_type_key NOT IN ('client_onboarding','brand_dna') THEN
    RAISE EXCEPTION 'The system makes only the onboarding tasks and the Brand DNA task.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF r.id IS NULL OR r.task_id IS DISTINCT FROM p_task_id THEN
    RAISE EXCEPTION 'The request must come from an answer on the same card.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.cockpit_request_types x WHERE x.key = p_type_key;
  IF t.key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'missing', format('The %s request type is not set up yet, so no task was made.', p_type_key));
  END IF;
  IF NOT t.enabled THEN
    RETURN jsonb_build_object('ok', false, 'missing', format('The %s request type is turned off, so no task was made.', p_type_key));
  END IF;
  SELECT * INTO v_existing FROM public.cockpit_requests q WHERE q.form_response_id = p_response_id AND q.type_key = p_type_key;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'requestId', v_existing.id, 'reused', true);
  END IF;
  SELECT * INTO v_existing FROM public.cockpit_requests q
   WHERE q.type_key = p_type_key AND q.client_task_id = p_task_id AND q.source = 'form'
     AND q.state NOT IN ('cancelled','failed','routed')
   ORDER BY q.created_at DESC LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'skipped', 'Already made for this client.', 'requestId', v_existing.id);
  END IF;
  SELECT coalesce(nullif(btrim(o.client_name), ''), nullif(btrim(a.client_name), ''), r.client_name) INTO v_client
    FROM (SELECT 1) one
    LEFT JOIN public.cockpit_client_onboarding o ON o.clickup_task_id = p_task_id
    LEFT JOIN public.cockpit_billing_accounts a ON a.clickup_task_id = p_task_id;
  -- The requester: the CSM who sent the kickoff; the client's onboarding answer has none.
  IF r.created_by_id IS NOT NULL THEN
    SELECT m.id, m.email INTO v_member, v_email FROM public.cockpit_members m
     WHERE m.auth_user_id = r.created_by_id AND m.active ORDER BY m.updated_at DESC LIMIT 1;
  END IF;
  v_label := CASE WHEN v_member IS NOT NULL THEN coalesce(public.cockpit_slack_notice_role_of(v_email), 'the CSM')
                  ELSE 'the cockpit (client onboarding form)' END;
  IF v_details IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.fields) f WHERE f->>'key' = 'details') THEN
    v_answers := jsonb_build_object('details', v_details);
  END IF;
  v_due := public.cockpit_request_due_default(t.due_days);
  v_plan := public.cockpit_request_plan(t, v_id, p_task_id, v_client, v_answers, v_due, t.priority, v_label, NULL);
  PERFORM set_config('cockpit.audit_source', 'forms-stage4', true);
  INSERT INTO public.cockpit_requests(id, type_key, type_version, type_label, requester_member_id, requester_email, requester_label,
    source, client_task_id, client_name, answers, due_on, priority, state, content_hash, form_response_id)
  VALUES (v_id, t.key, t.version, t.label, v_member, v_email, v_label, 'form', p_task_id, v_client, v_answers, v_due, t.priority,
          'sending', public.cockpit_request_hash(t.key, p_task_id, v_answers, v_due, t.priority, NULL), p_response_id);
  FOR v_e IN SELECT e FROM jsonb_array_elements(v_plan) WITH ORDINALITY AS x(e, n) ORDER BY n LOOP
    INSERT INTO public.cockpit_request_parts(request_id, part, list_id, team, template_id, template_name, task_name,
      owner_rule, owner_clickup_id, owner_how, owner_label, owner_note, state)
    SELECT v_id, v_e->>'part', v_e->>'listId', v_e->>'team', v_e->>'templateId', v_e->>'templateName', v_e->>'taskName',
      g->>'owner_rule', CASE WHEN jsonb_typeof(v_e->'owner'->'clickupId') = 'number' THEN (v_e->'owner'->>'clickupId')::bigint END,
      v_e->'owner'->>'how', v_e->'owner'->>'label', v_e->'owner'->>'note', 'queued'
      FROM jsonb_array_elements(t.targets) g WHERE g->>'part' = v_e->>'part';
    INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, campaign_name, payload)
    VALUES ('request:' || v_id::text || ':' || (v_e->>'part'), 'request', 'cockpit_requests', v_id::text, NULL, v_e->'payload')
    RETURNING id INTO v_queue;
    UPDATE public.cockpit_request_parts SET queue_id = v_queue WHERE request_id = v_id AND part = v_e->>'part';
  END LOOP;
  PERFORM public.cockpit_request_audit('request.submitted', 'cockpit_requests', v_id::text, coalesce(v_email, 'forms-stage4'), NULL,
    (SELECT to_jsonb(q) FROM public.cockpit_requests q WHERE q.id = v_id),
    jsonb_build_object('type', t.key, 'type_version', t.version, 'source', 'form', 'response_id', p_response_id,
      'parts', (SELECT coalesce(jsonb_agg(e->>'part' ORDER BY n), '[]'::jsonb) FROM jsonb_array_elements(v_plan) WITH ORDINALITY AS x(e, n))));
  BEGIN
    PERFORM public.cockpit_clickup_requests_kick();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN jsonb_build_object('ok', true, 'requestId', v_id, 'reused', false, 'parts', jsonb_array_length(v_plan));
END $$;

-- New MRR (3.5): the live mrr write, the card's MRR and one billing event (source csm or ceo, the
-- ClickUp write through the billing trigger), with its audit row. Returns the event id.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_mrr(p_response_id uuid, p_plan jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_form_responses;
  v_acc public.cockpit_billing_accounts;
  v_next public.cockpit_billing_accounts;
  v_seat jsonb;
  v_source text := 'csm';
  v_who text;
  v_role text;
  v_to numeric := (p_plan->>'to')::numeric;
  v_event bigint;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  SELECT * INTO v_acc FROM public.cockpit_billing_accounts x WHERE x.clickup_task_id = r.task_id FOR UPDATE;
  IF v_acc.clickup_task_id IS NULL THEN
    RAISE EXCEPTION 'This card is not on the billing sheet.' USING ERRCODE = '22023';
  END IF;
  v_who := coalesce(r.submitted_by, r.created_by);
  IF r.created_by_id IS NOT NULL THEN
    BEGIN
      v_seat := public.cockpit_form_seat(r.created_by_id);
      IF coalesce((v_seat->>'ceo')::boolean, false) THEN v_source := 'ceo'; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_seat := NULL;
    END;
  END IF;
  v_role := CASE WHEN v_source = 'ceo' THEN 'the CEO' ELSE coalesce(public.cockpit_slack_notice_role_of(v_who), 'the CSM') END;
  UPDATE public.cockpit_billing_accounts SET mrr_usd = v_to, source = v_source, synced_at = now()
   WHERE clickup_task_id = r.task_id RETURNING * INTO v_next;
  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (r.task_id, v_acc.client_name, 'mrr', trim_scale(v_acc.mrr_usd)::text, trim_scale(v_to)::text, p_plan->>'reason',
          jsonb_strip_nulls(jsonb_build_object('from', v_acc.mrr_usd, 'to', v_to, 'reason_cat', 'new_client', 'reason', p_plan->>'reason',
            'effective', public.cockpit_form_kuwait_day(r.submitted_at), 'win_id', NULL, 'seat_role', v_role,
            'response_id', r.id, 'request_id', r.external_id)),
          v_source, v_who)
  RETURNING id INTO v_event;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('billing.mrr', 'cockpit_billing_accounts', r.task_id, v_who, 'client-success', 'supabase', to_jsonb(v_acc), to_jsonb(v_next),
          jsonb_build_object('event_id', v_event, 'response_id', r.id, 'via', 'kickoff'));
  RETURN v_event;
END $$;

-- The onboarding read model (4.14.3), Typeform-shaped: written only when the card holds no
-- onboarding answer or an older one (cockpit_form_record_make's rule).
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_read_model(p_task_id text, p_key text, p_entry jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_held jsonb; v_held_at timestamptz; v_at timestamptz := public.cockpit_form_stage4_ts(p_entry->>'submitted_at');
BEGIN
  SELECT o.forms->p_key INTO v_held FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'no_row'; END IF;
  v_held_at := public.cockpit_form_stage4_ts(v_held->>'submitted_at');
  IF p_key = 'onboarding' AND jsonb_typeof(v_held) = 'object' AND v_held_at IS NOT NULL AND v_at IS NOT NULL AND v_held_at > v_at THEN
    RETURN 'newer_kept';
  END IF;
  UPDATE public.cockpit_client_onboarding o
     SET forms = coalesce(o.forms, '{}'::jsonb) || jsonb_build_object(p_key, p_entry)
   WHERE o.clickup_task_id = p_task_id;
  RETURN 'written';
END $$;

-- ---------------------------------------------------------------------------
-- 9. The planner (4.13.3, 4.14.3): the builder's effects with their owners, each queued, drafted
--    or done once. Owners: the registry's version-2 array once the form is live; before that the
--    version-2 owners for the test card only (the canary), and make (dry run) for every other card;
--    shadow for a shadow answer off the test card. p_apply false returns the plan and writes nothing.

CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_plan(p_response_id uuid, p_apply boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_form_responses;
  f public.cockpit_forms;
  v_input jsonb;
  v_built jsonb;
  v_v2 jsonb;
  v_live boolean;
  v_canary boolean;
  v_once timestamptz;
  b jsonb;
  spec jsonb;
  v_owner text;
  v_state text;
  v_reason text;
  e public.cockpit_form_effects;
  v_out jsonb := '[]'::jsonb;
  v_ref text;
  v_qstate text;
  v_qerror text;
  v_payload jsonb;
  v_res jsonb;
  v_event bigint;
  v_text text;
  v_prev text := current_setting('cockpit.forms_action', true);
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF r.id IS NULL OR r.form_key NOT IN ('kickoff','onboarding') OR r.form_version < 2 OR r.task_id IS NULL
     OR r.state NOT IN ('submitted','confirmed') THEN
    RETURN jsonb_build_object('planned', false, 'reason', 'Only a native kickoff or onboarding answer on a card is planned.', 'effects', '[]'::jsonb);
  END IF;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = r.form_key;
  v_v2 := public.cockpit_form_stage4_effects(r.form_key, 2);
  v_live := f.effects = v_v2 AND f.provider = 'native';
  v_canary := r.task_id = '86eywg1cq';
  v_input := public.cockpit_form_stage4_input(r.id);
  v_built := public.cockpit_form_stage4_build(v_input);
  -- Once per card (4.14.3): an onboarding answer after another stored answer or kickoff plans nothing.
  -- The test card's rehearsal answer (a canary invite, stored shadow) is exempt: the kickoff canary
  -- may already have left a kickoff on that card.
  IF r.form_key = 'onboarding' AND NOT (v_canary AND r.mode = 'shadow') THEN
    v_once := public.cockpit_form_stage4_answered_at(r.task_id, r.id, v_input->>'readModelResponseId');
  END IF;

  FOR spec IN SELECT x FROM jsonb_array_elements(v_v2) WITH ORDINALITY AS u(x, n) ORDER BY n LOOP
    SELECT x INTO b FROM jsonb_array_elements(v_built) x WHERE x->>'key' = spec->>'key';
    v_owner := CASE
      WHEN spec->>'owner' = 'shadow' THEN 'shadow'
      WHEN v_live THEN coalesce(public.cockpit_form_effect_owner(r.form_key, spec->>'key'), 'make')
      WHEN v_canary THEN spec->>'owner'
      ELSE 'make' END;
    IF r.mode = 'shadow' AND NOT v_canary THEN v_owner := 'shadow'; END IF;
    v_reason := NULL;
    IF v_owner <> 'cockpit' THEN
      v_state := CASE WHEN v_owner = 'shadow' AND spec->>'key' <> 'recap' THEN 'skipped' ELSE 'dry_run' END;
      v_reason := CASE v_owner WHEN 'make' THEN 'Make does this until the go-live.'
                               ELSE coalesce(b->>'skip', 'A rehearsal answer: nothing is written.') END;
    ELSIF v_once IS NOT NULL THEN
      v_state := 'skipped';
      v_reason := 'This client already answered on ' || public.cockpit_form_day_words(v_once) || ', so nothing runs again.';
    ELSIF b->>'skip' IS NOT NULL THEN
      v_state := 'skipped';
      v_reason := b->>'skip';
    ELSE
      v_state := 'planned';
    END IF;
    IF NOT coalesce(p_apply, false) THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', spec->>'key', 'delivery', spec->>'delivery', 'owner', v_owner,
        'state', CASE WHEN v_state = 'planned' AND b->>'missing' IS NOT NULL THEN 'failed' ELSE v_state END,
        'reason', coalesce(v_reason, b->>'missing'), 'plan', b->'plan'));
      CONTINUE;
    END IF;

    PERFORM set_config('cockpit.forms_action', 'forms.stage4_planned', true);
    INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, plan, state, reason)
    VALUES (r.id, r.form_key, spec->>'key', r.id::text || ':' || (spec->>'key'), v_owner, spec->>'delivery',
            coalesce(b->'plan', '{}'::jsonb), v_state, left(v_reason, 240))
    ON CONFLICT (response_id, effect_key) DO NOTHING
    RETURNING * INTO e;
    IF e.id IS NULL OR e.state <> 'planned' THEN
      SELECT * INTO e FROM public.cockpit_form_effects x WHERE x.response_id = r.id AND x.effect_key = spec->>'key';
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', e.effect_key, 'delivery', e.delivery, 'owner', e.owner,
        'state', e.state, 'reason', e.reason));
      e := NULL;
      CONTINUE;
    END IF;

    -- Dispatch one planned effect; an error keeps it planned with the error as its reason.
    BEGIN
      PERFORM set_config('cockpit.forms_action', 'forms.effect_dispatched', true);
      IF b->>'missing' IS NOT NULL THEN
        UPDATE public.cockpit_form_effects x SET state = 'failed', reason = left(b->>'missing', 240) WHERE x.id = e.id;

      ELSIF e.delivery = 'clickup_queue' THEN
        v_payload := jsonb_build_object('formKey', r.form_key, 'responseId', r.id, 'effectId', e.id, 'effectKey', e.effect_key,
                       'taskId', r.task_id, 'clientName', v_input->>'client')
                     || (e.plan - 'lines' - 'comment_text');
        IF jsonb_typeof(e.plan->'comment_text') = 'string' THEN
          v_payload := v_payload || jsonb_build_object(
            'commentChars', char_length(e.plan->>'comment_text'),
            'commentSha256', encode(pg_catalog.sha256(convert_to(e.plan->>'comment_text', 'UTF8')), 'hex'));
        END IF;
        INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, task_id, payload)
        VALUES (e.dedupe_key, 'form', 'cockpit_form_effects', e.id::text, r.task_id, v_payload)
        ON CONFLICT (dedupe_key) DO NOTHING;
        SELECT q.id::text, q.state, q.error INTO v_ref, v_qstate, v_qerror
          FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key = e.dedupe_key;
        UPDATE public.cockpit_form_effects x
           SET state = 'queued', delivery_ref = v_ref, receipt = jsonb_build_object('queueId', v_ref), reason = NULL
         WHERE x.id = e.id;

      ELSIF e.delivery = 'client_message' THEN
        v_text := b->'plan'->>'body';
        INSERT INTO public.cockpit_client_messages(dedupe_key, task_id, client_name, kind, response_id, body, body_sha256)
        VALUES (e.dedupe_key, r.task_id, v_input->>'client', b->'plan'->>'kind', r.id, v_text,
                encode(pg_catalog.sha256(convert_to(v_text, 'UTF8')), 'hex'))
        ON CONFLICT (dedupe_key) DO NOTHING;
        SELECT m.id::text INTO v_ref FROM public.cockpit_client_messages m WHERE m.dedupe_key = e.dedupe_key;
        UPDATE public.cockpit_form_effects x
           SET state = 'queued', delivery_ref = v_ref, receipt = jsonb_build_object('messageId', v_ref),
               reason = 'Waiting for the CSM''s approval.'
         WHERE x.id = e.id;

      ELSIF e.delivery = 'slack_notice' THEN
        SELECT n.id::text, n.state, n.error INTO v_ref, v_qstate, v_qerror
          FROM public.cockpit_slack_notices n WHERE n.dedupe_key = b->'plan'->>'dedupe';
        IF v_ref IS NULL THEN
          UPDATE public.cockpit_form_effects x
             SET state = 'failed', reason = 'No kickoff notice was queued: this client has no onboarding record in the cockpit yet.'
           WHERE x.id = e.id;
        ELSE
          UPDATE public.cockpit_form_effects x
             SET state = 'queued', delivery_ref = v_ref, receipt = jsonb_build_object('noticeId', v_ref), reason = NULL
           WHERE x.id = e.id;
          IF v_qstate IN ('posted','failed','unknown','skipped','muted') THEN
            PERFORM public.cockpit_form_effects_settle('slack_notice', v_ref,
              CASE v_qstate WHEN 'posted' THEN 'delivered' WHEN 'muted' THEN 'skipped' ELSE v_qstate END,
              CASE WHEN v_qstate = 'muted' THEN 'The kickoff notice is off in Notices and routing.' ELSE v_qerror END,
              jsonb_build_object('table', 'cockpit_slack_notices', 'id', v_ref, 'state', v_qstate, 'at', now()), false);
          END IF;
        END IF;

      ELSIF e.delivery = 'relay' THEN
        INSERT INTO public.cockpit_form_relay_outbox(response_id, effect_key, task_id, payload, dedupe_key)
        VALUES (r.id, e.effect_key, r.task_id, coalesce(b->'plan'->'payload', '{}'::jsonb), 'relay:' || r.id::text || ':' || e.effect_key)
        ON CONFLICT (dedupe_key) DO NOTHING;
        SELECT o.id::text INTO v_ref FROM public.cockpit_form_relay_outbox o WHERE o.dedupe_key = 'relay:' || r.id::text || ':' || e.effect_key;
        UPDATE public.cockpit_form_effects x
           SET state = 'queued', delivery_ref = v_ref, receipt = jsonb_build_object('relayId', v_ref), reason = NULL
         WHERE x.id = e.id;

      ELSIF e.effect_key IN ('onboarding_tasks','brand_dna_task') THEN
        v_res := public.cockpit_request_create_system(b->'plan'->>'typeKey', r.task_id,
                   jsonb_build_object('details', b->'plan'->>'details'), r.id);
        IF coalesce((v_res->>'ok')::boolean, false) THEN
          UPDATE public.cockpit_form_effects x
             SET state = 'delivered', delivery_ref = v_res->>'requestId', receipt = v_res, reason = NULL WHERE x.id = e.id;
        ELSIF v_res->>'skipped' IS NOT NULL THEN
          UPDATE public.cockpit_form_effects x
             SET state = 'skipped', delivery_ref = v_res->>'requestId', receipt = v_res, reason = left(v_res->>'skipped', 240) WHERE x.id = e.id;
        ELSE
          UPDATE public.cockpit_form_effects x SET state = 'failed', receipt = v_res, reason = left(v_res->>'missing', 240) WHERE x.id = e.id;
        END IF;

      ELSIF e.effect_key = 'new_mrr' THEN
        v_event := public.cockpit_form_stage4_mrr(r.id, b->'plan');
        UPDATE public.cockpit_form_effects x
           SET state = 'delivered', delivery_ref = v_event::text, receipt = jsonb_build_object('eventId', v_event), reason = NULL
         WHERE x.id = e.id;

      ELSIF e.effect_key = 'read_model' THEN
        v_text := public.cockpit_form_stage4_read_model(r.task_id, 'onboarding', b->'plan'->'entry');
        UPDATE public.cockpit_form_effects x
           SET state = CASE WHEN v_text = 'written' THEN 'delivered' ELSE 'skipped' END,
               receipt = jsonb_build_object('readModel', v_text),
               reason = CASE v_text WHEN 'no_row' THEN 'This client has no onboarding record in the cockpit yet.'
                                    WHEN 'newer_kept' THEN 'The client record already holds a newer onboarding answer.' END
         WHERE x.id = e.id;
      ELSE
        UPDATE public.cockpit_form_effects x SET state = 'failed', reason = 'This effect has no writer.' WHERE x.id = e.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.cockpit_form_effect_note(e.id, left(SQLERRM, 240));
    END;
    SELECT * INTO e FROM public.cockpit_form_effects x WHERE x.id = e.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', e.effect_key, 'delivery', e.delivery, 'owner', e.owner,
      'state', e.state, 'reason', e.reason));
    e := NULL;
  END LOOP;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev, ''), true);
  RETURN jsonb_build_object('planned', true, 'live', v_live, 'canary', v_canary AND NOT v_live, 'effects', v_out);
END $$;

-- ---------------------------------------------------------------------------
-- 10. The kickoff (4.13, 3.3): the answers check, the prefill and the submit

-- The kickoff's answers against its 41 questions and New MRR: {ok, errors: {key: code}, answers}
-- with the codes of W34 3.1 (required, range, option, length, unknown) plus format. A choice is one
-- of its options, a list a subset, a number a number (New MRR 0 to 100,000), a link https.
-- replaceReason is the second kickoff's reason and is checked by the submit, not here.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_answers_check(p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_in jsonb := CASE WHEN jsonb_typeof(p_answers) = 'object' THEN p_answers - 'replaceReason' ELSE '{}'::jsonb END;
  v_specs jsonb := public.cockpit_form_stage4_fields('kickoff')
                   || '[{"key":"newMrrUsd","type":"number","required":true}]'::jsonb;
  s jsonb;
  k text;
  v jsonb;
  v_text text;
  v_errors jsonb := '{}'::jsonb;
  v_out jsonb := '{}'::jsonb;
  v_n numeric;
  v_max numeric;
BEGIN
  FOR k IN SELECT jsonb_object_keys(v_in) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_specs) x WHERE x->>'key' = k) THEN
      v_errors := v_errors || jsonb_build_object(left(k, 40), 'unknown');
    END IF;
  END LOOP;
  FOR s IN SELECT x FROM jsonb_array_elements(v_specs) x LOOP
    k := s->>'key';
    v := v_in -> k;
    IF v = 'null'::jsonb THEN v := NULL; END IF;
    IF jsonb_typeof(v) = 'string' THEN
      v_text := btrim(regexp_replace(v #>> '{}', '\s+', ' ', 'g'));
      IF s->>'type' = 'longtext' THEN v_text := btrim(v #>> '{}'); END IF;
      IF v_text = '' THEN v := NULL; END IF;
    END IF;
    IF jsonb_typeof(v) = 'array' AND jsonb_array_length(v) = 0 THEN v := NULL; END IF;
    IF v IS NULL THEN
      IF coalesce((s->>'required')::boolean, false) THEN v_errors := v_errors || jsonb_build_object(k, 'required'); END IF;
      CONTINUE;
    END IF;
    CASE s->>'type'
      WHEN 'choice' THEN
        IF jsonb_typeof(v) <> 'string' OR NOT (s->'options') ? (v #>> '{}') THEN
          v_errors := v_errors || jsonb_build_object(k, 'option');
        ELSE
          v_out := v_out || jsonb_build_object(k, v);
        END IF;
      WHEN 'multi' THEN
        IF jsonb_typeof(v) <> 'array'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x) <> 'string' OR NOT (s->'options') ? (x #>> '{}'))
           OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(v) x) <> jsonb_array_length(v) THEN
          v_errors := v_errors || jsonb_build_object(k, 'option');
        ELSE
          v_out := v_out || jsonb_build_object(k, v);
        END IF;
      WHEN 'number' THEN
        IF jsonb_typeof(v) <> 'number' THEN
          v_errors := v_errors || jsonb_build_object(k, 'range');
        ELSE
          v_n := (v #>> '{}')::numeric;
          v_max := CASE WHEN k = 'newMrrUsd' THEN 100000 ELSE 10000000 END;
          IF v_n < 0 OR v_n > v_max OR scale(v_n) > 2 THEN
            v_errors := v_errors || jsonb_build_object(k, 'range');
          ELSE
            v_out := v_out || jsonb_build_object(k, v_n);
          END IF;
        END IF;
      ELSE
        IF jsonb_typeof(v) <> 'string' THEN
          v_errors := v_errors || jsonb_build_object(k, 'length');
        ELSIF char_length(v_text) > (CASE s->>'type' WHEN 'longtext' THEN 4000 ELSE 500 END) THEN
          v_errors := v_errors || jsonb_build_object(k, 'length');
        ELSIF s->>'type' = 'url' AND v_text !~ '^https?://[^\s]+\.[^\s]+$' THEN
          v_errors := v_errors || jsonb_build_object(k, 'format');
        ELSE
          v_out := v_out || jsonb_build_object(k, v_text);
        END IF;
    END CASE;
  END LOOP;
  RETURN jsonb_build_object('ok', v_errors = '{}'::jsonb, 'errors', v_errors, 'answers', v_out);
END $$;

-- The seat for a kickoff: the CEO, or a CSM allowed on the client (cockpit_csm_client_gate).
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_seat(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seat jsonb := public.cockpit_form_actor();
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce((v_seat->>'ceo')::boolean, false) THEN
    IF NOT coalesce((v_seat->>'csm')::boolean, false) THEN
      RAISE EXCEPTION 'Only the CEO or the client''s CSM sends the kickoff.' USING ERRCODE = '42501';
    END IF;
    PERFORM public.cockpit_csm_client_gate(p_task_id);
  END IF;
  RETURN v_seat;
END $$;

-- What the kickoff sheet opens with (3.3, 5.13): whether it is open here, the stored kickoff, the
-- 23 hidden values with their source chips, the card's MRR for New MRR.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_prefill(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_kickoff_seat(p_task_id);
  a public.cockpit_billing_accounts;
  o public.cockpit_client_onboarding;
  r public.cockpit_form_responses;
  v_live boolean;
  v_at timestamptz;
  v_fields jsonb;
BEGIN
  SELECT * INTO a FROM public.cockpit_billing_accounts x WHERE x.clickup_task_id = p_task_id;
  SELECT * INTO o FROM public.cockpit_client_onboarding x WHERE x.clickup_task_id = p_task_id;
  v_live := public.cockpit_form_stage4_on('kickoff') OR (p_task_id = '86eywg1cq' AND coalesce((v_seat->>'ceo')::boolean, false));
  v_at := public.cockpit_form_stage4_kickoff_at(p_task_id, NULL);
  SELECT * INTO r FROM public.cockpit_form_responses x
   WHERE x.form_key = 'kickoff' AND x.task_id = p_task_id AND x.state NOT IN ('draft','void') AND x.mode = 'live'
   ORDER BY x.submitted_at DESC NULLS LAST LIMIT 1;
  v_fields := public.cockpit_form_stage4_hidden(p_task_id)
    || jsonb_build_object('newMrrUsd', jsonb_build_object('value', to_jsonb(a.mrr_usd), 'source', 'card'));
  RETURN jsonb_build_object(
    'live', v_live,
    'why', CASE WHEN NOT v_live THEN 'The kickoff moves into the cockpit after its switch-on.' END,
    'client', coalesce(nullif(btrim(a.client_name), ''), nullif(btrim(o.client_name), '')),
    'answered', CASE WHEN v_at IS NOT NULL THEN jsonb_build_object('at', v_at,
                  'byRole', CASE WHEN r.created_by_id IS NOT NULL THEN coalesce(public.cockpit_slack_notice_role_of(r.created_by), 'the CSM') END) END,
    'fields', v_fields,
    'onboarding', CASE WHEN jsonb_typeof(o.forms->'onboarding') = 'object'
                       THEN jsonb_build_object('submittedAt', o.forms->'onboarding'->>'submitted_at') END,
    'card', jsonb_build_object('mrrUsd', a.mrr_usd, 'status', coalesce(a.client_status, o.client_status)));
END $$;

-- The kickoff's send (3.3): the gate, the switch (or the test card for the CEO's canary), one
-- kickoff per card counting every stored kickoff (a second needs replaceReason and posts only the
-- handoff comment), the answers check, the response (version 2, source cockpit, submitted), the
-- Typeform-shaped read model and the planner. A retry of the same request returns the first send.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_submit(p_task_id text, p_answers jsonb, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_kickoff_seat(p_task_id);
  v_canary boolean;
  v_check jsonb;
  v_reason text := nullif(btrim(regexp_replace(coalesce(p_answers->>'replaceReason', ''), '\s+', ' ', 'g')), '');
  v_prev_at timestamptz;
  v_second boolean := false;
  v_client text;
  v_role text;
  r public.cockpit_form_responses;
  v_ta jsonb;
  v_model text;
  v_plan jsonb;
  v_trail jsonb;
  v_prev text := current_setting('cockpit.forms_action', true);
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Send the kickoff''s request id, so a second press saves nothing twice.' USING ERRCODE = '22023';
  END IF;
  v_canary := p_task_id = '86eywg1cq' AND coalesce((v_seat->>'ceo')::boolean, false);
  IF NOT public.cockpit_form_stage4_on('kickoff') AND NOT v_canary THEN
    RAISE EXCEPTION 'The kickoff opens here after its switch-on. Until then use the kickoff form as before.' USING ERRCODE = '22023';
  END IF;
  -- A retry of the same press.
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.form_key = 'kickoff' AND x.external_id = 'req:' || p_request_id::text;
  IF r.id IS NOT NULL THEN
    IF r.task_id IS DISTINCT FROM p_task_id THEN
      RAISE EXCEPTION 'This kickoff was already sent for another client. Reload the sheet.' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('step', x.effect_key, 'state', x.state, 'reason', x.reason) ORDER BY x.created_at, x.effect_key), '[]'::jsonb)
      INTO v_trail FROM public.cockpit_form_effects x WHERE x.response_id = r.id;
    RETURN jsonb_build_object('ok', true, 'responseId', r.id, 'reused', true, 'trail', v_trail);
  END IF;
  SELECT coalesce(nullif(btrim(a.client_name), ''), nullif(btrim(o.client_name), '')) INTO v_client
    FROM (SELECT 1) one
    LEFT JOIN public.cockpit_billing_accounts a ON a.clickup_task_id = p_task_id
    LEFT JOIN public.cockpit_client_onboarding o ON o.clickup_task_id = p_task_id;
  IF v_client IS NULL AND NOT v_canary THEN
    RAISE EXCEPTION 'This client is not in the cockpit yet, so the kickoff cannot be sent from here.' USING ERRCODE = '22023';
  END IF;
  v_client := coalesce(v_client, 'Test card');
  -- One kickoff per card, counting every stored kickoff (the 30 from tG7dnxBn and BbJy6xg4 included).
  v_prev_at := public.cockpit_form_stage4_kickoff_at(p_task_id, NULL);
  IF v_prev_at IS NOT NULL THEN
    IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 3 AND 300 THEN
      RAISE EXCEPTION 'A kickoff was sent for % on %. Say why you are sending it again.', v_client,
        public.cockpit_form_day_words(v_prev_at) USING ERRCODE = '22023';
    END IF;
    v_second := true;
  END IF;
  v_check := public.cockpit_kickoff_answers_check(p_answers);
  IF NOT (v_check->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'errors', v_check->'errors');
  END IF;
  v_role := CASE WHEN coalesce((v_seat->>'ceo')::boolean, false) THEN 'the CEO'
                 ELSE coalesce(public.cockpit_slack_notice_role_of(v_seat->>'email'), 'the CSM') END;

  PERFORM set_config('cockpit.forms_action', 'forms.kickoff_sent', true);
  PERFORM set_config('cockpit.audit_source', 'cockpit-forms', true);
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
    answers, answer_meta, hidden, created_by, created_by_id, submitted_by, submitted_at)
  VALUES ('kickoff', 2, 'cockpit', 'req:' || p_request_id::text, p_task_id, v_client, 'live', 'submitted',
          v_check->'answers',
          jsonb_strip_nulls(jsonb_build_object('notice_on', public.cockpit_form_kuwait_day(now()), 'second', v_second,
            'replace_reason', CASE WHEN v_second THEN v_reason END, 'seat_role', v_role, 'canary', CASE WHEN v_canary THEN true END)),
          jsonb_build_object('onboarding_client_id', p_task_id),
          v_seat->>'email', (v_seat->>'actorId')::uuid, v_seat->>'email', now())
  RETURNING * INTO r;

  -- The read model (4.13.2), Typeform-shaped, so growth.js, Pending payments and the Blueprint
  -- prefill read it unchanged. Its new response id queues the Stage 1 kickoff notice.
  v_ta := public.cockpit_form_stage4_typeform_answers('kickoff', r.answers);
  v_model := public.cockpit_form_stage4_read_model(p_task_id, 'kickoff', jsonb_build_object(
    'form_id', 'native', 'response_id', r.id::text, 'answers', v_ta,
    'payment', (SELECT a->>'value' FROM jsonb_array_elements(v_ta) a WHERE a->>'ref' = '75e97e7d-4c19-437a-b4b8-67570c29344f' LIMIT 1),
    'recording', (SELECT a->>'value' FROM jsonb_array_elements(v_ta) a WHERE a->>'ref' = 'b5578678-d0c2-475b-b66f-7ea54d55fe31' LIMIT 1),
    'submitted_at', to_char(r.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev, ''), true);
  v_plan := public.cockpit_form_stage4_plan(r.id, true);
  v_trail := jsonb_build_array(jsonb_build_object('step', 'stored', 'state', 'delivered'),
                               jsonb_build_object('step', 'read_model', 'state', CASE WHEN v_model = 'written' THEN 'delivered' ELSE 'skipped' END,
                                                  'reason', CASE WHEN v_model = 'no_row' THEN 'This client has no onboarding record in the cockpit yet.' END))
    || coalesce((SELECT jsonb_agg(jsonb_build_object('step', x->>'key', 'state', x->>'state', 'reason', x->>'reason'))
                   FROM jsonb_array_elements(v_plan->'effects') x), '[]'::jsonb);
  RETURN jsonb_build_object('ok', true, 'responseId', r.id, 'reused', false, 'second', v_second, 'trail', v_trail);
END $$;

-- ---------------------------------------------------------------------------
-- 11. The onboarding (4.14, 3.3)

-- After a client's onboarding answer is stored (cockpit_form_client_submitted calls it by name; the
-- Typeform door calls it too): the planner, once per card.
CREATE OR REPLACE FUNCTION public.cockpit_form_hook_onboarding(p_response_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_form_responses;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF r.id IS NULL OR r.form_key <> 'onboarding' THEN
    RAISE EXCEPTION 'There is no onboarding answer with that ID.' USING ERRCODE = '22023';
  END IF;
  RETURN public.cockpit_form_stage4_plan(r.id, true);
END $$;

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
  -- The business name from the New Client Form the cockpit stores, as the form's context.
  SELECT nullif(btrim(coalesce(r.answers->>'businessName', '')), '') INTO v_name FROM public.cockpit_form_responses r
   WHERE r.form_key = 'new_client' AND r.task_id = p_clickup_id ORDER BY r.submitted_at DESC NULLS LAST LIMIT 1;
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

-- A KFRCXPFx delivery after the onboarding go-live (X26), from forms-door: mapped by Typeform ref
-- into version-2 answers and stored (source typeform_webhook, version 2, submitted), then the same
-- planner as a portal answer. A card that already holds an answer or a kickoff, or no card, stores
-- it legacy with the "Old form link used" notice and runs nothing. One row per Typeform token.
-- The card comes from a hidden field anyone holding the public link can set, so the planner runs
-- only for a card that is onboarding now: in onboarding on its card, in the pipeline group on the
-- billing sheet, or signed up or signed a deal in the last 30 days. Any other card's answer is
-- stored legacy (why 'not_onboarding') and changes nothing.
CREATE OR REPLACE FUNCTION public.cockpit_form_onboarding_typeform(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.cockpit_forms;
  v_token text := p_payload->>'externalId';
  v_at timestamptz;
  v_raw jsonb;
  v_hidden jsonb;
  v_card text;
  v_task text;
  v_client text;
  v_answered timestamptz;
  v_onboarding boolean := false;
  v_native jsonb;
  v_id uuid;
  v_state text;
  v_plan jsonb;
  v_prev_action text := current_setting('cockpit.forms_action', true);
  v_prev_actor text := current_setting('cockpit.audit_actor', true);
  v_prev_source text := current_setting('cockpit.audit_source', true);
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'formKey' IS DISTINCT FROM 'onboarding' THEN
    RAISE EXCEPTION 'Only the client onboarding form is taken here.' USING ERRCODE = '22023';
  END IF;
  IF v_token IS NULL OR v_token !~ '^[A-Za-z0-9]{8,64}$' THEN
    RAISE EXCEPTION 'That is not a Typeform response token.' USING ERRCODE = '22023';
  END IF;
  v_at := public.cockpit_form_stage4_ts(p_payload->>'submittedAt');
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'The response has no readable submit time.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_payload->'answers') IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'answers'->'fields') IS DISTINCT FROM 'array'
     OR octet_length((p_payload->'answers')::text) > 1048576 THEN
    RAISE EXCEPTION 'Send the answers as {fields: [...]} under 1 MB.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = 'onboarding';
  v_raw := CASE WHEN jsonb_typeof(p_payload->'hidden') = 'object' THEN p_payload->'hidden' ELSE '{}'::jsonb END;
  v_hidden := jsonb_strip_nulls(jsonb_build_object(
    'client_name', CASE WHEN jsonb_typeof(v_raw->'client_name') = 'string' THEN left(nullif(btrim(v_raw->>'client_name'), ''), 200) END,
    'onboarding_client_id', CASE WHEN jsonb_typeof(v_raw->'onboarding_client_id') = 'string'
                                 THEN left(nullif(btrim(v_raw->>'onboarding_client_id'), ''), 60) END));
  v_card := coalesce(nullif(btrim(p_payload->>'taskId'), ''), v_hidden->>'onboarding_client_id');
  IF v_card ~ '^[A-Za-z0-9_-]{1,40}$' THEN
    SELECT x.t, x.n INTO v_task, v_client FROM (
      SELECT a.clickup_task_id AS t, a.client_name AS n, 1 AS o FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = v_card
      UNION ALL
      SELECT o.clickup_task_id, o.client_name, 2 FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = v_card) x
     ORDER BY x.o LIMIT 1;
  END IF;
  -- A token already stored: the same answer again.
  SELECT r.id, r.state INTO v_id, v_state FROM public.cockpit_form_responses r WHERE r.form_key = 'onboarding' AND r.external_id = v_token;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('inserted', false, 'responseId', v_id, 'taskId', v_task, 'stored', v_state);
  END IF;
  IF v_task IS NOT NULL THEN
    v_answered := public.cockpit_form_stage4_answered_at(v_task, NULL, v_token);
    v_onboarding := EXISTS (SELECT 1 FROM public.cockpit_client_onboarding o
                             WHERE o.clickup_task_id = v_task
                               AND (coalesce(o.in_onboarding, false) OR o.signup_on >= public.cockpit_billing_today() - 30))
                 OR EXISTS (SELECT 1 FROM public.cockpit_billing_accounts a
                             WHERE a.clickup_task_id = v_task AND a.stage_group = 'pipeline')
                 OR EXISTS (SELECT 1 FROM public.cockpit_billing_deal_cards() dc
                              JOIN public.cockpit_sales_deals d ON d.response_id = dc.deal_response_id
                             WHERE dc.clickup_task_id = v_task AND d.submitted_at >= now() - interval '30 days');
  END IF;

  PERFORM set_config('cockpit.audit_actor', 'typeform', true);
  PERFORM set_config('cockpit.audit_source', 'forms-door', true);
  IF v_task IS NULL OR v_answered IS NOT NULL OR NOT v_onboarding THEN
    -- Kept as an old link's answer (4.15.3), version 1's Typeform shape, never planned.
    PERFORM set_config('cockpit.forms_action', 'forms.legacy_recorded', true);
    INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
      answers, answer_meta, hidden, created_by, submitted_by, submitted_at)
    VALUES ('onboarding', 1, 'typeform_webhook', v_token, v_task, coalesce(v_client, v_hidden->>'client_name'), 'live', 'legacy',
            p_payload->'answers',
            jsonb_build_object('notice_on', public.cockpit_form_kuwait_day(v_at), 'owner', 'cockpit',
                               'why', CASE WHEN v_task IS NULL THEN 'no_card' WHEN v_answered IS NOT NULL THEN 'answered'
                                           ELSE 'not_onboarding' END)
              || CASE WHEN v_task IS NOT NULL THEN jsonb_build_object('match', 'hidden_id_unverified') ELSE '{}'::jsonb END,
            v_hidden, 'forms-door', 'typeform', v_at)
    RETURNING id INTO v_id;
    PERFORM public.cockpit_slack_notice_queue('legacy.received', 'legacy:' || v_id::text, v_task,
      CASE WHEN v_task IS NOT NULL THEN v_client END,
      jsonb_strip_nulls(jsonb_build_object('responseId', v_id, 'form', 'onboarding', 'matched', v_task IS NOT NULL, 'taskId', v_task,
        'client', CASE WHEN v_task IS NOT NULL THEN v_client END, 'submittedAt', public.cockpit_slack_notice_iso(v_at))),
      NULL, NULL, NULL);
    PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
    PERFORM set_config('cockpit.audit_actor', coalesce(v_prev_actor, ''), true);
    PERFORM set_config('cockpit.audit_source', coalesce(v_prev_source, ''), true);
    RETURN jsonb_build_object('inserted', true, 'responseId', v_id, 'taskId', v_task, 'stored', 'legacy');
  END IF;

  v_native := public.cockpit_form_stage4_native_answers('onboarding', p_payload->'answers'->'fields');
  PERFORM set_config('cockpit.forms_action', 'forms.onboarding_typeform', true);
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
    answers, answer_meta, hidden, created_by, submitted_by, submitted_at)
  VALUES ('onboarding', greatest(coalesce(public.cockpit_form_client_version('onboarding'), 2), 2), 'typeform_webhook', v_token, v_task,
          v_client, 'live', 'submitted', v_native - '_unmapped',
          jsonb_strip_nulls(jsonb_build_object('notice_on', public.cockpit_form_kuwait_day(v_at), 'owner', 'cockpit', 'via', 'typeform',
            'match', 'hidden_id_unverified', 'unmapped', v_native->'_unmapped')),
          v_hidden, 'forms-door', 'typeform', v_at)
  RETURNING id INTO v_id;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
  v_plan := public.cockpit_form_hook_onboarding(v_id);
  PERFORM set_config('cockpit.audit_actor', coalesce(v_prev_actor, ''), true);
  PERFORM set_config('cockpit.audit_source', coalesce(v_prev_source, ''), true);
  RETURN jsonb_build_object('inserted', true, 'responseId', v_id, 'taskId', v_task, 'stored', 'native',
    'effects', jsonb_array_length(coalesce(v_plan->'effects', '[]'::jsonb)));
END $$;

-- ---------------------------------------------------------------------------
-- 12. The parity plan (4.15.1): the cockpit's plan for one recorded Make input, for make_parity.py.
--     Input: {taskId, client, submittedAt, hidden: {...}, answers: [{ref, title, value}], newMrrUsd?,
--     cardMrr?, cardOnSheet?}. It reads settings and the option maps and writes nothing.

CREATE OR REPLACE FUNCTION public.cockpit_form_parity_plan(p_form_key text, p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_in jsonb; v_hidden jsonb := '{}'::jsonb; h jsonb;
BEGIN
  IF p_form_key NOT IN ('kickoff','onboarding') OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Send the kickoff or onboarding form and one recorded input.' USING ERRCODE = '22023';
  END IF;
  -- Only the hidden fields the kickoff carries, never anything else of the input.
  FOR h IN SELECT x FROM jsonb_array_elements(public.cockpit_form_stage4_hidden_map()) x LOOP
    IF jsonb_typeof(p_input->'hidden'->(h->>'key')) = 'string' THEN
      v_hidden := v_hidden || jsonb_build_object(h->>'key', p_input->'hidden'->>(h->>'key'));
    END IF;
  END LOOP;
  v_in := jsonb_build_object('formKey', p_form_key,
    'taskId', coalesce(nullif(p_input->>'taskId', ''), v_hidden->>'onboarding_client_id'),
    'client', p_input->>'client', 'responseId', coalesce(p_input->>'token', 'parity'), 'submittedAt', p_input->>'submittedAt',
    'second', false,
    'answers', public.cockpit_form_stage4_typeform_answers(p_form_key,
                 public.cockpit_form_stage4_native_answers(p_form_key, p_input->'answers') - '_unmapped'),
    'hidden', v_hidden,
    'newMrrUsd', p_input->'newMrrUsd', 'cardMrr', p_input->'cardMrr',
    'cardOnSheet', coalesce((p_input->>'cardOnSheet')::boolean, true),
    'readModelFormId', 'KFRCXPFx', 'readModelResponseId', coalesce(p_input->>'token', 'parity'));
  RETURN jsonb_build_object('formKey', p_form_key, 'effects', public.cockpit_form_stage4_build(v_in),
    'unmapped', public.cockpit_form_stage4_native_answers(p_form_key, p_input->'answers')->'_unmapped');
END $$;

-- ---------------------------------------------------------------------------
-- 13. The go-live (4.15.2), owner only: on writes provider native, version 2 and the version-2
--     array in one statement and sets forms.stage4.<form> (onboarding also goes live for clients
--     through cockpit_form_client_go_live); off writes version 1 back. It refuses when the current
--     array is neither (drift). One audit row.

CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_go_live(p_form_key text, p_on boolean, p_actor text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.cockpit_forms;
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_v1 jsonb;
  v_v2 jsonb;
  v_version integer;
  v_schema jsonb;
  v_client jsonb;
BEGIN
  IF v_actor IS NULL OR char_length(v_actor) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'Say who turns the form on or off.' USING ERRCODE = '22023';
  END IF;
  IF p_on IS NULL OR p_form_key NOT IN ('kickoff','onboarding') THEN
    RAISE EXCEPTION 'Say the kickoff or the onboarding, and on or off.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = p_form_key FOR UPDATE;
  v_v1 := public.cockpit_form_stage4_effects(p_form_key, 1);
  v_v2 := public.cockpit_form_stage4_effects(p_form_key, 2);
  IF f.effects IS DISTINCT FROM v_v1 AND f.effects IS DISTINCT FROM v_v2 THEN
    RAISE EXCEPTION 'The % effects changed since the waves 5-6 contract read them; stop and re-read them.', p_form_key
      USING ERRCODE = '55000';
  END IF;
  v_version := CASE WHEN p_on THEN
                 CASE WHEN p_form_key = 'onboarding' THEN greatest(coalesce(public.cockpit_form_client_version('onboarding'), 2), 2) ELSE 2 END
               ELSE 1 END;
  SELECT v.schema INTO v_schema FROM public.cockpit_form_versions v WHERE v.form_key = p_form_key AND v.version = v_version;
  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'The % form has no version %.', p_form_key, v_version USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_actor', v_actor, true);
  PERFORM set_config('cockpit.audit_source', 'deploy', true);
  PERFORM set_config('cockpit.forms_action', CASE WHEN p_on THEN 'forms.stage4_native' ELSE 'forms.stage4_typeform' END, true);
  UPDATE public.cockpit_forms
     SET provider = CASE WHEN p_on THEN 'native' ELSE 'typeform' END, version = v_version, schema = v_schema,
         effects = CASE WHEN p_on THEN v_v2 ELSE v_v1 END, updated_by = v_actor, updated_at = now()
   WHERE key = p_form_key;
  INSERT INTO public.cockpit_settings(key, value, updated_by)
  VALUES ('forms.stage4', jsonb_build_object('kickoff', false, 'onboarding', false) || jsonb_build_object(p_form_key, p_on), v_actor)
  ON CONFLICT (key) DO UPDATE SET value = public.cockpit_settings.value || jsonb_build_object(p_form_key, p_on),
    updated_by = v_actor, updated_at = now();
  IF p_form_key = 'onboarding' THEN
    v_client := public.cockpit_form_client_go_live('onboarding', p_on, v_actor);
  END IF;
  PERFORM set_config('cockpit.forms_action', '', true);
  INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('forms.stage4_go_live', 'cockpit_forms', p_form_key, v_actor, 'client-success', 'deploy',
          jsonb_build_object('provider', f.provider, 'version', f.version),
          jsonb_build_object('provider', CASE WHEN p_on THEN 'native' ELSE 'typeform' END, 'version', v_version),
          jsonb_build_object('op', CASE WHEN p_on THEN 'on' ELSE 'off' END, 'client', v_client));
  RETURN jsonb_build_object('formKey', p_form_key, 'on', p_on, 'version', v_version,
    'effects', CASE WHEN p_on THEN v_v2 ELSE v_v1 END, 'client', v_client);
END $$;

-- ---------------------------------------------------------------------------
-- 14. The relay (3.8): hermes/forms-relay claims and settles the Client Data row and the dispatch

-- Queued rows, and failed ones under 3 attempts after 10 minutes, while the owner gate passes (the
-- effect's owner is the cockpit); a row the gate refuses is skipped with its reason. A claim older
-- than its window stopped mid-send and turns unknown (never sent again: a person checks).
CREATE OR REPLACE FUNCTION public.cockpit_form_relay_claim(p_limit integer DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.cockpit_form_relay_outbox;
  g jsonb;
  v_claim uuid;
  v_out jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_lim integer := least(greatest(coalesce(p_limit, 5), 1), 10);
BEGIN
  PERFORM public.cockpit_hours_require_service();
  PERFORM set_config('cockpit.audit_source', 'forms-relay', true);
  FOR o IN SELECT * FROM public.cockpit_form_relay_outbox x
            WHERE x.state = 'claimed' AND x.claim_until < now() ORDER BY x.id FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.cockpit_form_relay_outbox SET state = 'unknown', claim = NULL, claim_until = NULL, updated_at = now(),
           result = jsonb_build_object('reason', 'A relay run stopped in the middle of sending. Check it by hand; it is not sent again.')
     WHERE id = o.id;
    PERFORM public.cockpit_form_effects_settle('relay', o.id::text, 'unknown',
      'A relay run stopped in the middle of sending. Check it by hand; it is not sent again.',
      jsonb_build_object('table', 'cockpit_form_relay_outbox', 'id', o.id, 'state', 'unknown', 'at', now()), false);
  END LOOP;
  FOR o IN SELECT * FROM public.cockpit_form_relay_outbox x
            WHERE x.state = 'queued' OR (x.state = 'failed' AND x.attempts < 3 AND x.updated_at < now() - interval '10 minutes')
            ORDER BY x.id FOR UPDATE SKIP LOCKED LOOP
    EXIT WHEN v_n >= v_lim;
    g := public.cockpit_form_effect_gate('relay', o.id::text);
    IF NOT coalesce((g->>'ok')::boolean, false) THEN
      UPDATE public.cockpit_form_relay_outbox SET state = 'skipped', updated_at = now(),
             result = jsonb_build_object('reason', left(coalesce(g->>'reason', 'Make owns this again.'), 240))
       WHERE id = o.id;
      PERFORM public.cockpit_form_effects_settle('relay', o.id::text, 'skipped', left(coalesce(g->>'reason', 'Make owns this again.'), 240),
        jsonb_build_object('table', 'cockpit_form_relay_outbox', 'id', o.id, 'state', 'skipped', 'at', now()), false);
      CONTINUE;
    END IF;
    v_claim := gen_random_uuid();
    UPDATE public.cockpit_form_relay_outbox SET state = 'claimed', claim = v_claim, claim_until = now() + interval '10 minutes',
           attempts = attempts + 1, updated_at = now()
     WHERE id = o.id RETURNING * INTO o;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', o.id, 'claim', o.claim, 'effectKey', o.effect_key,
      'taskId', o.task_id, 'responseId', o.response_id, 'payload', o.payload, 'attempts', o.attempts));
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('rows', v_out);
END $$;

-- The relay's outcome for one claimed row: sent, failed (tried again under 3 attempts), unknown
-- (never tried again) or skipped. The effect settles with it: delivered, failed on the last try,
-- unknown or skipped. detail is short and never holds an answer or a secret (2 KB).
CREATE OR REPLACE FUNCTION public.cockpit_form_relay_done(p_id bigint, p_claim uuid, p_outcome text, p_detail jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o public.cockpit_form_relay_outbox; v_detail jsonb; v_reason text; v_effect text;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent','failed','unknown','skipped') THEN
    RAISE EXCEPTION 'Say sent, failed, unknown or skipped.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM public.cockpit_form_relay_outbox x WHERE x.id = p_id FOR UPDATE;
  IF o.id IS NULL OR o.state <> 'claimed' OR p_claim IS NULL OR o.claim IS DISTINCT FROM p_claim THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'This relay row is not claimed by this run.');
  END IF;
  v_detail := CASE WHEN jsonb_typeof(p_detail) = 'object' AND octet_length(p_detail::text) <= 2048 THEN p_detail ELSE '{}'::jsonb END;
  v_reason := left(nullif(btrim(coalesce(v_detail->>'reason', '')), ''), 240);
  PERFORM set_config('cockpit.audit_source', 'forms-relay', true);
  UPDATE public.cockpit_form_relay_outbox SET state = p_outcome, claim = NULL, claim_until = NULL, result = v_detail, updated_at = now()
   WHERE id = o.id RETURNING * INTO o;
  v_effect := CASE p_outcome WHEN 'sent' THEN 'delivered'
                             WHEN 'failed' THEN CASE WHEN o.attempts >= 3 THEN 'failed' END
                             ELSE p_outcome END;
  IF v_effect IS NOT NULL THEN
    PERFORM public.cockpit_form_effects_settle('relay', o.id::text, v_effect, v_reason,
      jsonb_build_object('table', 'cockpit_form_relay_outbox', 'id', o.id, 'state', p_outcome, 'at', now()), false);
  END IF;
  RETURN jsonb_build_object('ok', true, 'state', o.state, 'attempts', o.attempts);
END $$;

-- What the relay's doctor and runs report: open rows by state, the oldest claim.
CREATE OR REPLACE FUNCTION public.cockpit_form_relay_counts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_hours_require_service();
  RETURN jsonb_build_object(
    'byState', (SELECT coalesce(jsonb_object_agg(s.state, s.n), '{}'::jsonb)
                  FROM (SELECT x.state, count(*) AS n FROM public.cockpit_form_relay_outbox x GROUP BY x.state) s),
    'oldestClaim', (SELECT min(x.updated_at) FROM public.cockpit_form_relay_outbox x WHERE x.state = 'claimed'));
END $$;

-- ---------------------------------------------------------------------------
-- 15. Settling the effects of the phase messages and the kickoff notice

-- The phase 3 and phase 4 messages settle through the same mover as the 1-1 recaps.
DROP TRIGGER IF EXISTS cockpit_form_effects_from_phase_messages ON public.cockpit_client_messages;
CREATE TRIGGER cockpit_form_effects_from_phase_messages AFTER UPDATE OF state ON public.cockpit_client_messages
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.kind IN ('phase3','phase4'))
  EXECUTE FUNCTION public.cockpit_form_effects_from_messages();

-- The kickoff notice's moves, for a Stage 4 kickoff's kickoff_notice effect.
CREATE OR REPLACE FUNCTION public.cockpit_form_effects_from_kickoff_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_source text := current_setting('cockpit.audit_source', true); v_receipt jsonb;
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.cockpit_form_effects e WHERE e.delivery = 'slack_notice' AND e.delivery_ref = NEW.id::text) THEN
      RETURN NULL;
    END IF;
    PERFORM set_config('cockpit.audit_source', 'cockpit-notices', true);
    v_receipt := jsonb_build_object('table', 'cockpit_slack_notices', 'id', NEW.id, 'state', NEW.state, 'at', now());
    IF NEW.state = 'posted' THEN
      PERFORM public.cockpit_form_effects_settle('slack_notice', NEW.id::text, 'delivered', NULL,
        v_receipt || jsonb_build_object('channel', NEW.channel, 'ts', NEW.slack_ts), false);
    ELSIF NEW.state IN ('failed','unknown','skipped') THEN
      PERFORM public.cockpit_form_effects_settle('slack_notice', NEW.id::text, NEW.state, NEW.error, v_receipt, false);
    ELSIF NEW.state = 'muted' THEN
      PERFORM public.cockpit_form_effects_settle('slack_notice', NEW.id::text, 'skipped',
        'The kickoff notice is off in Notices and routing.', v_receipt, false);
    ELSIF OLD.state = 'failed' AND NEW.state = 'queued' THEN
      PERFORM public.cockpit_form_effects_settle('slack_notice', NEW.id::text, 'queued', NULL, v_receipt, true);
    END IF;
    PERFORM set_config('cockpit.audit_source', coalesce(v_source, ''), true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_form_effects_health(false, 'An effect could not be settled: ' || left(SQLERRM, 200), NULL);
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS cockpit_form_effects_from_kickoff_notice ON public.cockpit_slack_notices;
CREATE TRIGGER cockpit_form_effects_from_kickoff_notice AFTER UPDATE OF state ON public.cockpit_slack_notices
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.kind = 'kickoff')
  EXECUTE FUNCTION public.cockpit_form_effects_from_kickoff_notice();

-- ---------------------------------------------------------------------------
-- 16. The read model keeps a native entry (7): the onboarding sync replaces forms wholesale from
--     Typeform every 10 minutes (20261009b), which holds no native answer. A native kickoff or
--     onboarding entry is kept unless the new value is a newer answer of its own.

CREATE OR REPLACE FUNCTION public.cockpit_client_onboarding_keep_native()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text; v_old jsonb; v_new jsonb;
BEGIN
  FOREACH k IN ARRAY ARRAY['kickoff','onboarding'] LOOP
    v_old := OLD.forms->k;
    CONTINUE WHEN jsonb_typeof(v_old) IS DISTINCT FROM 'object' OR v_old->>'form_id' IS DISTINCT FROM 'native';
    v_new := NEW.forms->k;
    IF jsonb_typeof(v_new) IS DISTINCT FROM 'object'
       OR coalesce(public.cockpit_form_stage4_ts(v_new->>'submitted_at'), '-infinity'::timestamptz)
          < coalesce(public.cockpit_form_stage4_ts(v_old->>'submitted_at'), 'infinity'::timestamptz) THEN
      NEW.forms := coalesce(NEW.forms, '{}'::jsonb) || jsonb_build_object(k, v_old);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cockpit_client_onboarding_keep_native ON public.cockpit_client_onboarding;
CREATE TRIGGER cockpit_client_onboarding_keep_native BEFORE UPDATE OF forms ON public.cockpit_client_onboarding
  FOR EACH ROW WHEN (OLD.forms IS DISTINCT FROM NEW.forms)
  EXECUTE FUNCTION public.cockpit_client_onboarding_keep_native();

-- ---------------------------------------------------------------------------
-- 17. The replaced functions (2.2)

-- 1. cockpit_forms_effects_valid: delivery relay joins (3.8); every other rule byte for byte.
CREATE OR REPLACE FUNCTION public.cockpit_forms_effects_valid(p jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e jsonb; v_keys text[] := '{}';
BEGIN
  IF p IS NULL OR jsonb_typeof(p) IS DISTINCT FROM 'array' OR jsonb_array_length(p) > 20 THEN RETURN false; END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p) x LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) IS DISTINCT FROM ARRAY['delivery','key','label','owner'] THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(e->'key') IS DISTINCT FROM 'string' OR jsonb_typeof(e->'owner') IS DISTINCT FROM 'string'
       OR jsonb_typeof(e->'delivery') IS DISTINCT FROM 'string' OR jsonb_typeof(e->'label') IS DISTINCT FROM 'string' THEN
      RETURN false;
    END IF;
    IF (e->>'key') !~ '^[a-z][a-z0-9_]{1,40}$'
       OR (e->>'owner') NOT IN ('make','shadow','cockpit')
       OR (e->>'delivery') NOT IN ('clickup_queue','slack_notice','client_message','creative_outbox','sql','relay')
       OR char_length(e->>'label') NOT BETWEEN 1 AND 80
       OR (e->>'key') = ANY(v_keys) THEN
      RETURN false;
    END IF;
    v_keys := v_keys || (e->>'key');
  END LOOP;
  RETURN true;
END $$;

-- 2. cockpit_form_effect_gate: the Stage 4 canary branch; every other branch byte for byte.
CREATE OR REPLACE FUNCTION public.cockpit_form_effect_gate(p_delivery text, p_ref text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rows integer := 0;
  v_open integer := 0;
  e record;
  v_pass jsonb;
  v_held jsonb;
  v_first jsonb;
  v_pick jsonb;
  v_reason text;
BEGIN
  -- Waves 3-4 (2.2): a form link message answers to its invite, not to a
  -- 1-1 notes effect. Every other write below is unchanged.
  IF p_delivery = 'client_message' AND p_ref ~ '^[0-9a-fA-F-]{36}$' AND EXISTS (
       SELECT 1 FROM public.cockpit_client_messages cm WHERE cm.id = p_ref::uuid AND cm.kind = 'form_invite') THEN
    RETURN public.cockpit_form_invite_gate(p_ref::uuid);
  END IF;
  -- A queued effect before an unknown one, then the oldest.
  FOR e IN
    SELECT x.id, x.response_id, x.form_key, x.effect_key, x.state, x.owner, r.mode, r.submitted_at, r.form_version, r.task_id,
           public.cockpit_form_native_since(x.form_key) AS since
      FROM public.cockpit_form_effects x
      JOIN public.cockpit_form_responses r ON r.id = x.response_id
     WHERE x.delivery = p_delivery AND x.delivery_ref = p_ref
     ORDER BY CASE x.state WHEN 'queued' THEN 0 WHEN 'unknown' THEN 1 WHEN 'planned' THEN 2 ELSE 3 END,
              x.created_at, x.id
  LOOP
    v_rows := v_rows + 1;
    v_pick := jsonb_build_object('effectId', e.id, 'responseId', e.response_id, 'formKey', e.form_key,
      'effectKey', e.effect_key, 'effectState', e.state);
    IF v_first IS NULL THEN v_first := v_pick; END IF;
    IF e.state NOT IN ('delivered','skipped','failed','dry_run') THEN
      v_open := v_open + 1;
      IF v_held IS NULL THEN v_held := v_pick; END IF;
    END IF;
    -- No send time, or no native window (since is NULL): the comparison is
    -- NULL and this effect does not pass (missing is never a pass).
    IF v_pass IS NULL AND e.state IN ('queued','unknown') AND e.owner = 'cockpit' AND e.mode = 'live'
       AND public.cockpit_form_effect_owner(e.form_key, e.effect_key) = 'cockpit'
       AND e.submitted_at >= e.since THEN
      v_pass := v_pick;
    END IF;
    -- Waves 5-6 (Stage 4): before the go-live, a native kickoff or onboarding answer on the test card
    -- 86eywg1cq (the canary) passes on its own effect's owner, whatever the registry says.
    IF v_pass IS NULL AND e.state IN ('queued','unknown') AND e.owner = 'cockpit'
       AND e.form_key IN ('kickoff','onboarding') AND e.form_version >= 2 AND e.task_id = '86eywg1cq' THEN
      v_pass := v_pick;
    END IF;
  END LOOP;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'effectId', NULL, 'responseId', NULL, 'formKey', NULL, 'effectKey', NULL,
      'effectState', NULL, 'reason', 'No 1-1 notes effect points at this write, so nothing was written.');
  END IF;
  IF v_pass IS NOT NULL THEN
    v_pick := v_pass;
    v_reason := NULL;
  ELSIF v_open = 0 THEN
    v_pick := v_first;
    v_reason := 'This write was settled in the cockpit, so nothing was written.';
  ELSE
    v_pick := v_held;
    v_reason := 'Make owns this again.';
  END IF;
  RETURN v_pick || jsonb_build_object('ok', v_pass IS NOT NULL, 'reason', v_reason);
END $$;

-- 3. cockpit_client_message_claim: kinds phase3 and phase4.
CREATE OR REPLACE FUNCTION public.cockpit_client_message_claim(p_kinds text[], p_only_cards text[] DEFAULT NULL,
  p_limit integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lim integer := least(greatest(coalesce(p_limit, 1), 1), 3);
  v_n integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_uid uuid;
  v_seat jsonb;
  v_keep boolean;
  v_wait boolean;
  v_msg text;
  g jsonb;
  m public.cockpit_client_messages;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF p_kinds IS NULL OR cardinality(p_kinds) = 0 OR EXISTS (
       SELECT 1 FROM unnest(p_kinds) AS k(v) WHERE k.v IS NULL OR k.v NOT IN ('recap_checkin','recap_kickoff','recap_blueprint','phase5','form_invite','phase3','phase4')) THEN
    RAISE EXCEPTION 'Choose the kinds of message to claim.' USING ERRCODE = '22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('cockpit_client_messages', 0)) THEN
    RETURN jsonb_build_object('busy', true, 'rows', '[]'::jsonb);
  END IF;
  PERFORM set_config('cockpit.audit_source', 'client-messages', true);
  FOR m IN
    SELECT * FROM public.cockpit_client_messages x
     WHERE x.state = 'approved' AND x.kind = ANY(p_kinds)
       AND (p_only_cards IS NULL OR cardinality(p_only_cards) = 0 OR x.task_id = ANY(p_only_cards))
     ORDER BY x.approved_at, x.id
     FOR UPDATE SKIP LOCKED
  LOOP
    EXIT WHEN v_n >= v_lim;

    -- 1. An approval lasts 24 hours.
    IF m.expires_at IS NULL OR m.expires_at <= now() THEN
      PERFORM set_config('cockpit.forms_action', 'forms.message_expired', true);
      UPDATE public.cockpit_client_messages
         SET state = 'draft', approved_by = NULL, approved_at = NULL, expires_at = NULL,
             reason = 'The approval ran out after 24 hours. Approve it again.'
       WHERE id = m.id;
      CONTINUE;
    END IF;

    -- 2. The owner gate (3.1).
    g := public.cockpit_form_effect_gate('client_message', m.id::text);
    IF NOT coalesce((g->>'ok')::boolean, false) THEN
      PERFORM set_config('cockpit.forms_action', 'forms.message_skipped', true);
      UPDATE public.cockpit_client_messages
         SET state = 'skipped', reason = left(coalesce(nullif(g->>'reason', ''), 'Make owns this again.'), 240)
       WHERE id = m.id;
      CONTINUE;
    END IF;

    -- 3. The approver still holds this client (Z27).
    v_keep := false;
    v_wait := false;
    v_uid := NULL;
    SELECT cm.auth_user_id INTO v_uid FROM public.cockpit_members cm
     WHERE cm.active AND cm.email = lower(btrim(coalesce(m.approved_by, '')))
     ORDER BY cm.updated_at DESC LIMIT 1;
    BEGIN
      v_seat := public.cockpit_form_seat(v_uid);
      IF NOT (coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'admin')::boolean, false)) THEN
        PERFORM public.cockpit_csm_client_gate_for_actor(v_uid, m.task_id);
      END IF;
      v_keep := true;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      v_wait := v_msg LIKE 'The client roster is incomplete%';
    END;
    CONTINUE WHEN v_wait;
    IF NOT v_keep THEN
      PERFORM set_config('cockpit.forms_action', 'forms.message_approver_lost', true);
      UPDATE public.cockpit_client_messages
         SET state = 'draft', approved_by = NULL, approved_at = NULL, expires_at = NULL,
             reason = 'The person who approved it no longer has this client. Approve it again.'
       WHERE id = m.id;
      CONTINUE;
    END IF;

    -- 4. Claimed.
    PERFORM set_config('cockpit.forms_action', 'forms.message_claimed', true);
    UPDATE public.cockpit_client_messages
       SET state = 'claimed', claim_token = gen_random_uuid(), claimed_at = now(), reason = NULL
     WHERE id = m.id RETURNING * INTO m;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', m.id, 'claimToken', m.claim_token, 'taskId', m.task_id, 'clientName', m.client_name, 'kind', m.kind,
      'body', m.body, 'bodySha256', m.body_sha256, 'approvedAt', m.approved_at, 'claimedAt', m.claimed_at));
    v_n := v_n + 1;
  END LOOP;
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN jsonb_build_object('busy', false, 'rows', v_rows);
END $$;

-- 4. cockpit_client_message_view: the phase messages' form (phase 4 the kickoff, phase 3 the onboarding) and owner.
CREATE OR REPLACE FUNCTION public.cockpit_client_message_view(p_row public.cockpit_client_messages)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_call text; v_form text; v_effect text; v_invite uuid;
BEGIN
  IF p_row.id IS NULL THEN RETURN NULL; END IF;
  IF p_row.response_id IS NOT NULL THEN
    SELECT coalesce(nullif(r.answers->'call'->>'endsAt', ''), nullif(r.answers->'call'->>'startsAt', '')), r.form_key
      INTO v_call, v_form
      FROM public.cockpit_form_responses r WHERE r.id = p_row.response_id;
  END IF;
  -- A form link (waves 3-4, 3.9) names the form of its invite.
  IF p_row.kind = 'form_invite' THEN
    SELECT i.form_key, i.id INTO v_form, v_invite FROM public.cockpit_form_invites i WHERE i.id = p_row.invite_id;
  END IF;
  v_form := coalesce(v_form, CASE p_row.kind WHEN 'recap_checkin' THEN 'checkin' WHEN 'recap_kickoff' THEN 'kickoff'
                                             WHEN 'recap_blueprint' THEN 'blueprint' WHEN 'phase4' THEN 'kickoff'
                                             WHEN 'phase3' THEN 'onboarding' END);
  SELECT e.state INTO v_effect FROM public.cockpit_form_effects e
   WHERE e.delivery = 'client_message' AND e.delivery_ref = p_row.id::text
   ORDER BY e.created_at, e.id LIMIT 1;
  RETURN jsonb_build_object(
    'id', p_row.id,
    'kind', p_row.kind,
    'state', p_row.state,
    'taskId', p_row.task_id,
    'clientName', p_row.client_name,
    'responseId', p_row.response_id,
    'body', p_row.body,
    'reason', p_row.reason,
    'callAt', public.cockpit_slack_notice_iso(public.cockpit_slack_notice_ts(v_call)),
    'approvedBy', public.cockpit_slack_notice_role_of(p_row.approved_by),
    'approvedAt', p_row.approved_at,
    'expiresAt', p_row.expires_at,
    'sentAt', p_row.sent_at,
    'readBack', CASE WHEN p_row.read_back_at IS NOT NULL
                     THEN jsonb_build_object('by', p_row.read_back->>'by', 'at', p_row.read_back_at) END,
    'owner', CASE WHEN p_row.kind = 'form_invite' THEN 'cockpit'
                  WHEN p_row.kind IN ('phase3','phase4') THEN coalesce((SELECT e.owner FROM public.cockpit_form_effects e
                                                                        WHERE e.delivery = 'client_message' AND e.delivery_ref = p_row.id::text
                                                                        ORDER BY e.created_at LIMIT 1),
                                                                       public.cockpit_form_effect_owner(v_form, p_row.kind || '_whatsapp'))
                  WHEN v_form IS NOT NULL THEN public.cockpit_form_effect_owner(v_form, 'recap') END,
    'formKey', v_form,
    'inviteId', v_invite,
    'effectState', v_effect,
    'triesUsedUp', p_row.attempts >= 3);
END $$;

-- 5. cockpit_client_message_approve: phase 3 and phase 4 bodies under the client text rule.
CREATE OR REPLACE FUNCTION public.cockpit_client_message_approve(p_id uuid, p_body text, p_body_sha256 text, p_actor uuid,
  p_warnings text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seat jsonb; m public.cockpit_client_messages; g jsonb; v_hash text; v_warn text[];
  -- Waves 3-4 (3.9): a form link is a message, not a recap.
  v_word text; v_rule text;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  v_seat := public.cockpit_form_seat(p_actor);
  SELECT * INTO m FROM public.cockpit_client_messages x WHERE x.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no message with that ID.' USING ERRCODE = '22023';
  END IF;
  IF NOT (coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'admin')::boolean, false)) THEN
    PERFORM public.cockpit_csm_client_gate_for_actor(p_actor, m.task_id);
  END IF;
  v_word := CASE WHEN m.kind IN ('form_invite','phase3','phase4') THEN 'message' ELSE 'recap' END;
  IF m.state <> 'draft' THEN
    RAISE EXCEPTION '%', CASE m.state
        WHEN 'approved' THEN 'This ' || v_word || ' is already approved. It sends within about 3 minutes.'
        WHEN 'sent' THEN 'This ' || v_word || ' was already sent.'
        WHEN 'skipped' THEN 'This ' || v_word || ' was skipped. Nothing was sent.'
        WHEN 'unknown' THEN 'This ' || v_word || ' may already be in the group. Look in the group; the tech lead settles it.'
        -- A form link has no reopen (the Messages card hides it, and a reopened row meets its first link).
        WHEN 'refused' THEN CASE WHEN m.kind = 'form_invite'
                                 THEN 'This message was not sent. Withdraw the form and send it again from Send a form.'
                                 ELSE 'Reopen this ' || v_word || ' first, then approve it.' END
        WHEN 'failed' THEN CASE WHEN m.kind = 'form_invite'
                                THEN 'This message was not sent. Withdraw the form and send it again from Send a form.'
                                ELSE 'Reopen this ' || v_word || ' first, then approve it.' END
        ELSE 'This ' || v_word || ' is being sent now.' END
      USING ERRCODE = '22023';
  END IF;
  g := public.cockpit_form_effect_gate('client_message', m.id::text);
  IF NOT coalesce((g->>'ok')::boolean, false) THEN
    IF coalesce(g->>'reason', 'Make owns this again.') = 'Make owns this again.' THEN
      -- Native, and this recap's response was sent before the window opened (an old
      -- recap after a second cut-over): Make does not send it, and neither does the cockpit.
      IF EXISTS (SELECT 1 FROM public.cockpit_form_responses r
                  WHERE r.id = m.response_id
                    AND r.submitted_at < public.cockpit_form_native_since(r.form_key)) THEN
        RAISE EXCEPTION 'This recap is from before the latest switch-over, so it is not sent from here. Press Skip.' USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION 'Make still sends 1-1 recaps until the switch-over, so this one is not sent from here.' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION '%', g->>'reason' USING ERRCODE = '22023';
  END IF;
  IF m.kind = 'form_invite' THEN
    -- The form link (3.9): the placeholder exactly once (the worker puts the
    -- link in at send), the client text rule, and 1,000 characters at most.
    IF p_body IS NULL OR btrim(p_body) = '' OR char_length(p_body) > 1000 THEN
      RAISE EXCEPTION 'The message is empty or over 1,000 characters. Edit the text, then approve again.' USING ERRCODE = '22023';
    END IF;
    IF (char_length(p_body) - char_length(replace(p_body, '{form_link}', ''))) / char_length('{form_link}') <> 1 THEN
      RAISE EXCEPTION 'Keep {form_link} in the message exactly once: the link goes there when it sends.' USING ERRCODE = '22023';
    END IF;
    v_rule := public.cockpit_client_text_ok(p_body);
    IF v_rule IS NOT NULL THEN
      RAISE EXCEPTION '%', v_rule USING ERRCODE = '22023';
    END IF;
  ELSIF m.kind IN ('phase3','phase4') THEN
    -- Waves 5-6 (Stage 4): a phase message is the client's text, under the client text rule.
    IF p_body IS NULL OR btrim(p_body) = '' OR char_length(p_body) > 1500 THEN
      RAISE EXCEPTION 'The message is empty or over 1,500 characters. Edit the text, then approve again.' USING ERRCODE = '22023';
    END IF;
    v_rule := public.cockpit_client_text_ok(p_body);
    IF v_rule IS NOT NULL THEN
      RAISE EXCEPTION '%', v_rule USING ERRCODE = '22023';
    END IF;
  ELSIF p_body IS NULL OR btrim(p_body) = '' OR char_length(p_body) > 4096 THEN
    RAISE EXCEPTION 'The recap is empty or over 4,096 characters. Edit the text, then approve again.' USING ERRCODE = '22023';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(p_body, 'UTF8')), 'hex');
  IF p_body_sha256 IS NULL OR lower(btrim(p_body_sha256)) <> v_hash THEN
    RAISE EXCEPTION 'The text changed after it was checked. Approve it again.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(left(btrim(u.w), 240) ORDER BY u.o), '{}'::text[]) INTO v_warn
    FROM unnest(coalesce(p_warnings, '{}'::text[])) WITH ORDINALITY AS u(w, o)
   WHERE nullif(btrim(u.w), '') IS NOT NULL AND u.o <= 14;
  PERFORM set_config('cockpit.forms_action', 'forms.message_approved', true);
  PERFORM set_config('cockpit.audit_actor', v_seat->>'email', true);
  PERFORM set_config('cockpit.audit_source', 'cockpit-forms-api', true);
  UPDATE public.cockpit_client_messages
     SET state = 'approved', body = p_body, body_sha256 = v_hash, approved_by = v_seat->>'email', approved_at = now(),
         expires_at = now() + interval '24 hours', reason = NULL
   WHERE id = m.id RETURNING * INTO m;
  -- "Approve anyway": the warnings the person read and accepted, never the text.
  IF cardinality(v_warn) > 0 THEN
    INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('forms.message_warnings_accepted', 'cockpit_client_messages', m.id::text, v_seat->>'email', 'client-success',
            'cockpit-forms-api', NULL, NULL,
            jsonb_build_object('op', 'approve', 'task_id', m.task_id, 'warnings', to_jsonb(v_warn)));
  END IF;
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN public.cockpit_client_message_view(m);
END $$;

-- 6. cockpit_form_record_legacy: the kickoff once native (stored legacy, legacy.received), the onboarding to
--    cockpit_form_onboarding_typeform once native; every other form byte for byte.
CREATE OR REPLACE FUNCTION public.cockpit_form_record_legacy(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.cockpit_forms;
  v_form text;
  v_token text;
  v_at timestamptz;
  v_backfill boolean;
  v_answers jsonb;
  v_hidden jsonb := '{}'::jsonb;
  v_raw jsonb;
  v_card text;
  v_task text;
  v_client text;
  v_form_client text;
  v_day date;
  v_id uuid;
  v_version integer;
  v_inserted boolean := false;
  v_matched boolean := false;
  v_notice uuid;
  v_retired boolean;
  v_prev_action text := current_setting('cockpit.forms_action', true);
  v_prev_actor text := current_setting('cockpit.audit_actor', true);
  v_prev_source text := current_setting('cockpit.audit_source', true);
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Send the response as an object.' USING ERRCODE = '22023';
  END IF;
  v_form := p->>'formKey';
  IF v_form IS NULL OR v_form NOT IN ('exit_survey','pause_request','nps','csat','kickoff','onboarding') THEN
    RAISE EXCEPTION 'Only the termination survey, the pause request and the old NPS and onboarding surveys are recorded here.'
      USING ERRCODE = '22023';
  END IF;
  -- Waves 5-6 (Stage 4, 4.15.3): an old kickoff link's answer once the kickoff is native is kept
  -- here; an onboarding Typeform answer once it is native goes to the native door (X26).
  IF v_form IN ('kickoff','onboarding') THEN
    IF NOT EXISTS (SELECT 1 FROM public.cockpit_forms x WHERE x.key = v_form AND x.provider = 'native') THEN
      RAISE EXCEPTION 'The % form is recorded by its own store until its go-live.', v_form USING ERRCODE = '22023';
    END IF;
    IF v_form = 'onboarding' THEN
      RETURN public.cockpit_form_onboarding_typeform(p);
    END IF;
  END IF;
  v_token := p->>'externalId';
  IF v_token IS NULL OR v_token !~ '^[A-Za-z0-9]{8,64}$' THEN
    RAISE EXCEPTION 'That is not a Typeform response token.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_at := (p->>'submittedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    v_at := NULL;
  END;
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'The response has no readable submit time.' USING ERRCODE = '22023';
  END IF;
  v_answers := CASE WHEN jsonb_typeof(p->'answers') = 'object' THEN p->'answers' END;
  IF v_answers IS NULL OR octet_length(v_answers::text) > 65536 THEN
    RAISE EXCEPTION 'Send the answers as an object under 64 KB.' USING ERRCODE = '22023';
  END IF;
  IF p ? 'backfill' AND jsonb_typeof(p->'backfill') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'Send backfill as true or false.' USING ERRCODE = '22023';
  END IF;
  v_backfill := coalesce((p->>'backfill')::boolean, false);
  -- The old NPS and onboarding surveys have no cockpit webhook: their two answers come by the backfill (V17).
  IF v_form IN ('nps','csat') AND NOT v_backfill THEN
    RAISE EXCEPTION 'The old NPS and onboarding survey answers are recorded only by the backfill.' USING ERRCODE = '22023';
  END IF;
  -- Only the form's two hidden fields are kept (inventory 3.3 and 3.4), each a short string.
  v_raw := CASE WHEN jsonb_typeof(p->'hidden') = 'object' THEN p->'hidden' ELSE '{}'::jsonb END;
  v_hidden := jsonb_strip_nulls(jsonb_build_object(
    'client_name', CASE WHEN jsonb_typeof(v_raw->'client_name') = 'string'
                        THEN left(nullif(btrim(v_raw->>'client_name'), ''), 200) END,
    'onboarding_client_id', CASE WHEN jsonb_typeof(v_raw->'onboarding_client_id') = 'string'
                                 THEN left(nullif(btrim(v_raw->>'onboarding_client_id'), ''), 60) END));

  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = v_form;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The % form is not in the registry.', v_form USING ERRCODE = '22023';
  END IF;
  -- The Typeform-shaped version (2.5), else the registry's.
  SELECT max(v.version) INTO v_version FROM public.cockpit_form_versions v
   WHERE v.form_key = v_form AND v.schema->>'lives' = 'typeform';
  v_version := coalesce(v_version, f.version);

  -- The card: the form's own hidden id, when it is a card on the billing sheet. Never for NPS and CSAT: the old
  -- answers are not guessed onto a card (V17).
  IF v_form IN ('exit_survey','pause_request','kickoff') THEN
    v_card := coalesce(nullif(btrim(p->>'taskId'), ''), v_hidden->>'onboarding_client_id');
    IF v_card ~ '^[A-Za-z0-9_-]{1,40}$' THEN
      SELECT a.clickup_task_id, a.client_name INTO v_task, v_client
        FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = v_card;
      IF v_task IS NULL AND v_form = 'kickoff' THEN
        SELECT o.clickup_task_id, o.client_name INTO v_task, v_client
          FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = v_card;
      END IF;
    END IF;
  END IF;
  v_form_client := coalesce(left(nullif(btrim(p->>'clientName'), ''), 200), v_hidden->>'client_name');
  v_day := public.cockpit_form_kuwait_day(v_at);

  PERFORM set_config('cockpit.forms_action', 'forms.legacy_recorded', true);
  PERFORM set_config('cockpit.audit_actor', 'typeform', true);
  PERFORM set_config('cockpit.audit_source', CASE WHEN v_backfill THEN 'forms-backfill' ELSE 'forms-door' END, true);
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
    answers, answer_meta, hidden, created_by, submitted_by, submitted_at)
  VALUES (v_form, v_version, CASE WHEN v_backfill THEN 'typeform_sync' ELSE 'typeform_webhook' END, v_token, v_task,
          coalesce(v_client, v_form_client), 'live', 'legacy',
          v_answers,
          jsonb_build_object('notice_on', v_day)
            || CASE WHEN v_task IS NOT NULL THEN jsonb_build_object('match', 'hidden_id_unverified') ELSE '{}'::jsonb END,
          v_hidden, 'forms-door', 'typeform', v_at)
  ON CONFLICT (form_key, external_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    v_inserted := true;
    IF v_form = 'exit_survey' THEN
      -- Not attached to a departure here (the card is unverified, above); v_matched stays false.
      IF NOT v_backfill THEN
        -- Matched: the CSM of the card is tagged by name of the client.
        -- Unmatched: no card and no client, so every CSM seat is tagged and
        -- the form's own name is shown as the form gave it (W22).
        v_notice := public.cockpit_slack_notice_queue('termination.notice', 'termination:' || v_id::text, v_task,
          CASE WHEN v_task IS NOT NULL THEN v_client END,
          jsonb_strip_nulls(jsonb_build_object(
            'responseId', v_id, 'submittedAt', public.cockpit_slack_notice_iso(v_at), 'noticeOn', v_day,
            'matched', v_task IS NOT NULL, 'client', CASE WHEN v_task IS NOT NULL THEN v_client END,
            'formClientName', CASE WHEN v_task IS NULL THEN v_form_client END)),
          NULL, NULL, NULL);
      END IF;
    END IF;
    -- An answer through a retired link (V16): the exit survey once its registry row is native, the pause request once
    -- the pause consent is live. Kept, never lost, and said in #csm-general.
    v_retired := f.provider = 'native'
                 OR (v_form = 'pause_request' AND coalesce(public.cockpit_form_client_live('pause_consent'), false));
    IF v_retired AND NOT v_backfill THEN
      PERFORM public.cockpit_slack_notice_queue('legacy.received', 'legacy:' || v_id::text, v_task,
        CASE WHEN v_task IS NOT NULL THEN v_client END,
        jsonb_strip_nulls(jsonb_build_object(
          'responseId', v_id, 'form', v_form, 'matched', v_task IS NOT NULL, 'taskId', v_task,
          'client', CASE WHEN v_task IS NOT NULL THEN v_client END,
          'submittedAt', public.cockpit_slack_notice_iso(v_at))),
        NULL, NULL, NULL);
    END IF;
  ELSE
    SELECT r.id, r.task_id INTO v_id, v_task FROM public.cockpit_form_responses r
     WHERE r.form_key = v_form AND r.external_id = v_token;
  END IF;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
  PERFORM set_config('cockpit.audit_actor', coalesce(v_prev_actor, ''), true);
  PERFORM set_config('cockpit.audit_source', coalesce(v_prev_source, ''), true);
  RETURN jsonb_build_object('inserted', v_inserted, 'responseId', v_id, 'matched', v_matched,
    'noticeQueued', v_notice IS NOT NULL, 'taskId', v_task);
END $$;

-- ---------------------------------------------------------------------------
-- 18. Function privileges: revoked from all four roles, then exactly as 2.6 and 3.3 say. The
--     replaced ones keep their live grants (11.2-c). cockpit_form_parity_plan is read only and is
--     also granted to service_role, because make_parity.py calls it on the VPS with the service key.

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'cockpit_form_stage4_audit()', 'cockpit_form_stage4_effects(text,integer)', 'cockpit_form_stage4_fields(text)',
    'cockpit_form_stage4_card_fields()', 'cockpit_form_stage4_hidden_map()', 'cockpit_form_stage4_setting(text)',
    'cockpit_form_stage4_on(text)', 'cockpit_form_stage4_ts(text)', 'cockpit_form_stage4_kickoff_at(text,uuid)',
    'cockpit_form_stage4_answered_at(text,uuid,text)', 'cockpit_form_stage4_text(jsonb)', 'cockpit_form_stage4_typeform_answers(text,jsonb)',
    'cockpit_form_stage4_native_answers(text,jsonb)', 'cockpit_form_stage4_hidden(text)', 'cockpit_form_stage4_render(text,jsonb)',
    'cockpit_form_stage4_message(text,text,text)', 'cockpit_form_stage4_map_url(integer,text)', 'cockpit_form_stage4_build(jsonb)',
    'cockpit_form_stage4_input(uuid)', 'cockpit_request_create_system(text,text,jsonb,uuid)', 'cockpit_form_stage4_mrr(uuid,jsonb)',
    'cockpit_form_stage4_read_model(text,text,jsonb)', 'cockpit_form_stage4_plan(uuid,boolean)', 'cockpit_kickoff_answers_check(jsonb)',
    'cockpit_kickoff_seat(text)', 'cockpit_kickoff_prefill(text)', 'cockpit_kickoff_submit(text,jsonb,uuid)',
    'cockpit_form_hook_onboarding(uuid)', 'portal_form_onboarding_open(text,text,text,text)', 'cockpit_form_onboarding_typeform(jsonb)',
    'cockpit_form_parity_plan(text,jsonb)', 'cockpit_form_stage4_go_live(text,boolean,text)', 'cockpit_form_relay_claim(integer)',
    'cockpit_form_relay_done(bigint,uuid,text,jsonb)', 'cockpit_form_relay_counts()', 'cockpit_form_effects_from_kickoff_notice()',
    'cockpit_client_onboarding_keep_native()',
    'cockpit_forms_effects_valid(jsonb)', 'cockpit_form_effect_gate(text,text)', 'cockpit_client_message_claim(text[],text[],integer)',
    'cockpit_client_message_view(public.cockpit_client_messages)', 'cockpit_client_message_approve(uuid,text,text,uuid,text[])',
    'cockpit_form_record_legacy(jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.cockpit_kickoff_prefill(text), public.cockpit_kickoff_submit(text,jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_form_onboarding_open(text,text,text,text), public.cockpit_form_onboarding_typeform(jsonb),
  public.cockpit_form_relay_claim(integer), public.cockpit_form_relay_done(bigint,uuid,text,jsonb), public.cockpit_form_relay_counts(),
  public.cockpit_form_parity_plan(text,jsonb),
  public.cockpit_client_message_claim(text[],text[],integer), public.cockpit_client_message_approve(uuid,text,text,uuid,text[]),
  public.cockpit_form_record_legacy(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
