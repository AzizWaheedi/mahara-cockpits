-- The client's voice (docs/forms/WAVE34-CONTRACT.md 2.5, 3.3 c, 3.5, 4.5 to
-- 4.8, 6): NPS and the onboarding survey (CSAT) on their daily schedule, the
-- answers' hooks, the client voice view and its CEO number, the portal's
-- "Share feedback" bridge, and the two Typeforms Make keeps (client
-- onboarding KFRCXPFx and the New Client Form BTzMwXiw) recorded by
-- forms-door. Creative Triage (bldgtotkfmhoxmlzowdx). The third file of the
-- waves 3-4 block: 20261102a (invites) and 20261102b (client lifecycle) come
-- first, and this file stops with a sentence when either is missing.
--
-- 1. cockpit_form_schedules: one rule per client form, read key by key. A
--    missing or non-integer key stops that form for the run
--    (skipped.ruleNotSet) and says which key; it is never read as NULL or a
--    default. Seeded nps {firstDay 60, everyDays 90, remindAfterDays 7} and
--    csat {afterLaunchDays 0, whatsappAfterDays 3, snoozeDays 3, reissues 3,
--    retryAfterDays 7, maxAgeDays 60}, both rows on: inert while the master
--    switch forms.schedule.on is false, which is how this file leaves it.
-- 2. cockpit_form_schedule_run(p_now, p_apply): the daily sweep (expire,
--    withdraw ineligible, refused messages of closed invites to skipped, token
--    opens older than 2 days), then, only while forms.schedule.on, NPS on day
--    60 after the first launch and every 90 days after, CSAT after launch
--    until filled (portal on day 0 for a client with a live portal session,
--    else held to launch + 3 with the WhatsApp link; later tries portal only,
--    7 days after the last close; never again once a CSM withdrew one; never
--    past 60 days from launch). One client form per card per run (CSAT
--    first), at most 3 new invites per form a day. p_apply false returns the
--    plan and writes nothing. pg_cron mahara-form-schedule at 07:00 UTC.
-- 3. Hooks by name (V19), called by 20261102a's dispatchers: the NPS and CSAT
--    issue hooks (the round or the try, and NPS Survey Sent through billing
--    event nps_sent), the NPS and CSAT answer hooks (nps.received or
--    csat.received, and voice.low at or under voice.low_score.max). A canary
--    answer's notices are queued and muted at once (the live notice guard lets
--    a notice start only queued or skipped).
-- 4. cockpit_client_voice_v (one row per answer) and
--    cockpit_form_invites_daily_v (counts), both readable by the CEO refresh's
--    read-only role; three seat reads (cockpit_client_voice_read, _today,
--    _summary, all STABLE); portal_feedback_record (the portal's Share
--    feedback, refused until portal_feedback is live).
-- 5. forms-door's two Make-owned forms: their registry rows (every effect
--    Make's), their signing keys (the keys CHECK and the five key functions),
--    cockpit_form_record_make (records only, no notice; the onboarding read
--    model gets the answer when it has none or an older one) and
--    portal_form_status (the portal's onboarding gate evidence).
-- 6. cockpit_form_record_legacy learns nps and csat (backfill only, never a
--    card), pins legacy rows to the newest Typeform-shaped version, and
--    queues legacy.received when an answer comes through a retired link.
-- 7. The CSM call store's form CHECKs widen for the three native kinds, so
--    hermes/csm-calls can put NPS, CSAT and portal feedback on the client's
--    timeline.
--
-- Nothing here posts, writes a card or reaches a client: notices and card
-- writes are queued, invites are issued only by the schedule (off) or a seat.
-- Every function is SECURITY DEFINER with an empty search path, revoked from
-- all four roles, then granted as 2.5 and 3.3 say. Applies twice.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. What this file stands on, and the drift guard (2.1)

DO $$
BEGIN
  IF to_regclass('public.cockpit_form_invites') IS NULL
     OR to_regclass('public.cockpit_form_invite_events') IS NULL
     OR to_regclass('public.cockpit_portal_presence') IS NULL
     OR to_regclass('public.cockpit_form_token_opens') IS NULL
     OR to_regprocedure('public.cockpit_form_invite_issue_system(text,text,text[],jsonb,text)') IS NULL
     OR to_regprocedure('public.cockpit_form_card_allows(text,text)') IS NULL
     OR to_regprocedure('public.cockpit_form_client_live(text)') IS NULL
     OR to_regprocedure('public.cockpit_form_invites_expire()') IS NULL
     OR to_regprocedure('public.cockpit_form_invites_withdraw_ineligible()') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261102a_forms_invites.sql first: this file calls its invites, issuer and card rule.'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conrelid = 'public.cockpit_billing_events'::regclass
                    AND c.conname = 'cockpit_billing_events_kind_check'
                    AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%nps_sent%') THEN
    RAISE EXCEPTION 'Apply 20261102b_client_lifecycle.sql first: the NPS issue hook writes billing event nps_sent.'
      USING ERRCODE = '55000';
  END IF;
END $$;

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_forms_door_seen(text,text,text)', '063bd0689f11f79aeebc6270b370d28a', '4e8148a9a2194f3540c211b54d0d235f'),
      ('public.cockpit_forms_key_put(jsonb)', '24478cd132a02c9a370f27bccff506dc', '1ffafd171e65c8d8c8608df8e2a0b724'),
      ('public.cockpit_forms_key_mark(jsonb)', '1075daac5191d53bae1e17c87b296160', '8e13ca6391b8545ff452f344783c70da'),
      ('public.cockpit_forms_key_label(text)', '85af18f124fd053ef832cca3eae6eb2b', 'f8d864c78e69f1c7e7d09c5412dcaa2e'),
      ('public.cockpit_forms_keys_status()', '695113cef48b9994447a539ae5fd7949', '32ee90fd277e2c3c2f66e443a5470fff'),
      ('public.cockpit_form_record_legacy(jsonb)', '50c4257c579f6269e2f8b8318086c743', '0c58ecc6de3d27a56d618e20ecffdfc3')
    ) AS x(fn, live_md5, after_md5)
  LOOP
    v_now := NULL;
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(g.fn);
    IF v_now IS NULL OR v_now NOT IN (g.live_md5, g.after_md5) THEN
      RAISE EXCEPTION '% changed since the waves 3-4 contract read it; stop and re-read it.', replace(g.fn, 'public.', '')
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The CHECKs, each widened only from the definition read on 2026-11-01

DO $$
DECLARE v_def text;
BEGIN
  -- The forms keys: the two Make-owned Typeforms' signing keys.
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_forms_keys'::regclass AND c.conname = 'cockpit_forms_keys_provider_check';
  IF v_def IS DISTINCT FROM 'CHECK ((provider = ANY (ARRAY[''fathom''::text, ''fathom_webhook''::text, ''anthropic''::text, ''deepseek''::text, ''typeform_kickoff''::text, ''typeform_exit_survey''::text, ''typeform_pause_request''::text, ''typeform_onboarding''::text, ''typeform_new_client''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((provider = ANY (ARRAY[''fathom''::text, ''fathom_webhook''::text, ''anthropic''::text, ''deepseek''::text, ''typeform_kickoff''::text, ''typeform_exit_survey''::text, ''typeform_pause_request''::text])))' THEN
      RAISE EXCEPTION 'cockpit_forms_keys_provider_check changed since the waves 3-4 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_forms_keys DROP CONSTRAINT IF EXISTS cockpit_forms_keys_provider_check;
    ALTER TABLE public.cockpit_forms_keys ADD CONSTRAINT cockpit_forms_keys_provider_check
      CHECK (provider IN ('fathom','fathom_webhook','anthropic','deepseek','typeform_kickoff',
                          'typeform_exit_survey','typeform_pause_request','typeform_onboarding','typeform_new_client'));
  END IF;

  -- The CSM call store: NPS, CSAT and portal feedback on the client's timeline (hermes/csm-calls sources.ts).
  v_def := NULL;
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_csm_call_forms'::regclass AND c.conname = 'cockpit_csm_call_forms_form_id_check';
  IF v_def IS DISTINCT FROM 'CHECK ((form_id = ANY (ARRAY[''fRokTITH''::text, ''KFRCXPFx''::text, ''tG7dnxBn''::text, ''BbJy6xg4''::text, ''oYZKtogO''::text, ''cockpit-checkin''::text, ''knIe4eF3''::text, ''cockpit-nps''::text, ''cockpit-csat''::text, ''cockpit-feedback''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((form_id = ANY (ARRAY[''fRokTITH''::text, ''KFRCXPFx''::text, ''tG7dnxBn''::text, ''BbJy6xg4''::text, ''oYZKtogO''::text, ''cockpit-checkin''::text, ''knIe4eF3''::text])))' THEN
      RAISE EXCEPTION 'cockpit_csm_call_forms_form_id_check changed since the waves 3-4 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_csm_call_forms DROP CONSTRAINT IF EXISTS cockpit_csm_call_forms_form_id_check;
    ALTER TABLE public.cockpit_csm_call_forms ADD CONSTRAINT cockpit_csm_call_forms_form_id_check
      CHECK (form_id = ANY (ARRAY['fRokTITH','KFRCXPFx','tG7dnxBn','BbJy6xg4','oYZKtogO','cockpit-checkin','knIe4eF3',
                                  'cockpit-nps','cockpit-csat','cockpit-feedback']));
  END IF;
  v_def := NULL;
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_csm_call_forms'::regclass AND c.conname = 'cockpit_csm_call_forms_form_kind_check';
  IF v_def IS DISTINCT FROM 'CHECK ((form_kind = ANY (ARRAY[''checkin''::text, ''onboarding''::text, ''kickoff''::text, ''kickoff_old''::text, ''blueprint''::text, ''checkin_late''::text, ''exit_survey''::text, ''nps''::text, ''csat''::text, ''portal_feedback''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((form_kind = ANY (ARRAY[''checkin''::text, ''onboarding''::text, ''kickoff''::text, ''kickoff_old''::text, ''blueprint''::text, ''checkin_late''::text, ''exit_survey''::text])))' THEN
      RAISE EXCEPTION 'cockpit_csm_call_forms_form_kind_check changed since the waves 3-4 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_csm_call_forms DROP CONSTRAINT IF EXISTS cockpit_csm_call_forms_form_kind_check;
    ALTER TABLE public.cockpit_csm_call_forms ADD CONSTRAINT cockpit_csm_call_forms_form_kind_check
      CHECK (form_kind = ANY (ARRAY['checkin','onboarding','kickoff','kickoff_old','blueprint','checkin_late','exit_survey',
                                    'nps','csat','portal_feedback']));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The schedules (2.5): one rule per client form, audited, never deleted

CREATE TABLE IF NOT EXISTS public.cockpit_form_schedules (
  form_key   text PRIMARY KEY REFERENCES public.cockpit_forms(key),
  "on"       boolean NOT NULL,
  rule       jsonb NOT NULL CHECK (jsonb_typeof(rule) = 'object' AND octet_length(rule::text) <= 2048),
  updated_by text NOT NULL CHECK (btrim(updated_by) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cockpit_form_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_form_schedules FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_form_schedules TO service_role;
COMMENT ON TABLE public.cockpit_form_schedules IS
  'The client forms'' automatic schedule (waves 3-4 2.5, E20): one rule per form, every key read by name by cockpit_form_schedule_run; a missing key stops that form for the run (ruleNotSet). The forms editor writes it; nothing is ever deleted.';

-- One audit row per change, with the rule before and after (the forms audit's
-- column list does not fit this table, so it has its own small trigger).
CREATE OR REPLACE FUNCTION public.cockpit_form_schedules_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."on" IS NOT DISTINCT FROM OLD."on" AND NEW.rule IS NOT DISTINCT FROM OLD.rule THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('forms.schedule_' || CASE TG_OP WHEN 'INSERT' THEN 'seeded' ELSE 'set' END,
          'cockpit_form_schedules', NEW.form_key,
          coalesce(nullif(current_setting('cockpit.audit_actor', true), ''), nullif(btrim(NEW.updated_by), ''), session_user::text),
          'client-success', coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'),
          CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('on', OLD."on", 'rule', OLD.rule) END,
          jsonb_build_object('on', NEW."on", 'rule', NEW.rule),
          jsonb_build_object('op', lower(TG_OP), 'form_key', NEW.form_key));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cockpit_form_schedules_audit ON public.cockpit_form_schedules;
CREATE TRIGGER cockpit_form_schedules_audit AFTER INSERT OR UPDATE ON public.cockpit_form_schedules
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_schedules_audit();
DROP TRIGGER IF EXISTS cockpit_forms_no_delete ON public.cockpit_form_schedules;
CREATE TRIGGER cockpit_forms_no_delete BEFORE DELETE ON public.cockpit_form_schedules
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_refuse_delete();
DROP TRIGGER IF EXISTS cockpit_forms_no_truncate ON public.cockpit_form_schedules;
CREATE TRIGGER cockpit_forms_no_truncate BEFORE TRUNCATE ON public.cockpit_form_schedules
  FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_forms_refuse_delete();

INSERT INTO public.cockpit_form_schedules (form_key, "on", rule, updated_by) VALUES
  ('nps', true, '{"firstDay":60,"everyDays":90,"remindAfterDays":7}'::jsonb, 'migration 20261102c'),
  ('csat', true, '{"afterLaunchDays":0,"whatsappAfterDays":3,"snoozeDays":3,"reissues":3,"retryAfterDays":7,"maxAgeDays":60}'::jsonb,
   'migration 20261102c')
ON CONFLICT (form_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. The settings: the master switch (off), the low-score line, the voice door

-- forms.% rows are audited by cockpit_settings_forms_audit (20261029z, 20261101p).
INSERT INTO public.cockpit_settings (key, value, updated_by)
VALUES ('forms.schedule', '{"on":false,"maxPerRun":3,"hourKuwait":10}'::jsonb, 'migration 20261102c')
ON CONFLICT (key) DO NOTHING;

-- voice.low_score is not a forms.% key, so its seed writes its own audit row (only when inserted).
DO $$
DECLARE v_key text;
BEGIN
  INSERT INTO public.cockpit_settings (key, value, updated_by)
  VALUES ('voice.low_score', '{"max":6}'::jsonb, 'migration 20261102c')
  ON CONFLICT (key) DO NOTHING
  RETURNING key INTO v_key;
  IF v_key IS NOT NULL THEN
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('voice.setting_seeded', 'cockpit_settings', v_key, 'migration 20261102c', 'client-success', 'supabase', NULL,
            jsonb_build_object('value', '{"max":6}'::jsonb), jsonb_build_object('op', 'insert', 'key', v_key));
  END IF;
END $$;

-- The voice door opens with this file (read by cockpit_form_doors, 20261102a). A merge, never an overwrite.
INSERT INTO public.cockpit_settings (key, value, updated_by)
VALUES ('forms.doors', '{"voice":true}'::jsonb, 'migration 20261102c')
ON CONFLICT (key) DO UPDATE SET value = public.cockpit_settings.value || '{"voice":true}'::jsonb,
  updated_by = 'migration 20261102c', updated_at = now()
WHERE NOT (public.cockpit_settings.value @> '{"voice":true}'::jsonb);

-- ---------------------------------------------------------------------------
-- 4. The registry rows of the two Typeforms Make keeps (4.7, 4.8): every effect Make's

INSERT INTO public.cockpit_forms (key, title, audience, provider, typeform_id, version, schema, seats, client_scoped, effects, updated_by)
VALUES
  ('onboarding', 'Client onboarding form', 'client', 'typeform', 'KFRCXPFx', 1,
   '{"key":"onboarding","version":1,"fields":[],"lives":"typeform","typeformId":"KFRCXPFx"}'::jsonb, ARRAY['csm'], true,
   '[{"key":"card_fields","owner":"make","delivery":"clickup_queue","label":"Onboarding answers on the card (Make)"},
     {"key":"client_data_row","owner":"make","delivery":"sql","label":"Client Data sheet row (Make)"},
     {"key":"phase3_whatsapp","owner":"make","delivery":"client_message","label":"Phase 3 WhatsApp message (Make)"},
     {"key":"brand_dna_task","owner":"make","delivery":"clickup_queue","label":"Brand DNA task (Make)"},
     {"key":"github_dispatch","owner":"make","delivery":"sql","label":"GitHub dispatch (Make)"}]'::jsonb,
   'migration 20261102c'),
  ('new_client', 'New Client Form', 'team', 'typeform', 'BTzMwXiw', 1,
   '{"key":"new_client","version":1,"fields":[],"lives":"typeform","typeformId":"BTzMwXiw"}'::jsonb, ARRAY['sales'], false,
   '[{"key":"onboarding_main","owner":"make","delivery":"sql","label":"Sub-account, Mahara OS, welcome, card, CSM post, CS pipeline (Make 8979157)"},
     {"key":"highlevel_workflow","owner":"make","delivery":"sql","label":"HighLevel workflow (its own webhook)"},
     {"key":"cortana","owner":"make","delivery":"sql","label":"Cortana (its own webhook)"},
     {"key":"b2b_closed_deals","owner":"make","delivery":"sql","label":"B2B closed deals (typeform-sync)"}]'::jsonb,
   'migration 20261102c')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.cockpit_form_versions (form_key, version, schema, published_by, note)
SELECT f.key, 1, f.schema, 'migration 20261102c', 'Filled in Typeform; Make owns every effect; forms-door records the answers.'
  FROM public.cockpit_forms f
 WHERE f.key IN ('onboarding','new_client')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Small helpers (owner only)

-- An integer rule key, or NULL when it is missing, not a whole number or negative.
CREATE OR REPLACE FUNCTION public.cockpit_form_rule_int(p_rule jsonb, p_key text)
RETURNS integer LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN jsonb_typeof(p_rule->p_key) = 'number' AND (p_rule->>p_key) ~ '^[0-9]{1,5}$'
              THEN (p_rule->>p_key)::integer END
$$;

-- A whole-number answer inside [lo, hi], else NULL.
CREATE OR REPLACE FUNCTION public.cockpit_form_answer_int(p_answers jsonb, p_key text, p_lo integer, p_hi integer)
RETURNS integer LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN jsonb_typeof(p_answers->p_key) = 'number' AND (p_answers->>p_key) ~ '^[0-9]{1,3}$'
                   AND (p_answers->>p_key)::integer BETWEEN p_lo AND p_hi
              THEN (p_answers->>p_key)::integer END
$$;

-- The low-score line (voice.low_score.max). The seeded 6 when the row is unreadable: the line decides who gets a
-- call, so an edited row that cannot be read keeps the contract's line rather than calling no one.
CREATE OR REPLACE FUNCTION public.cockpit_client_voice_low_max()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT public.cockpit_form_rule_int(c.value, 'max') FROM public.cockpit_settings c
                    WHERE c.key = 'voice.low_score'), 6)
$$;

-- One more in a counter object.
CREATE OR REPLACE FUNCTION public.cockpit_form_schedule_bump(p jsonb, p_key text, p_by integer DEFAULT 1)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p || jsonb_build_object(p_key, coalesce((p->>p_key)::integer, 0) + p_by)
$$;

-- ---------------------------------------------------------------------------
-- 6. The hooks (V19), called by 20261102a's dispatchers when they exist

-- NPS issued: the round (the card's highest earlier round + 1) and NPS Survey Sent through the billing rails
-- (kind nps_sent, 20261102b), written once the kind is open. A canary invite's event is by_whom 'canary', so the
-- deploy voids it by record after the read-back (3.10).
CREATE OR REPLACE FUNCTION public.cockpit_form_issue_hook_nps(p_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i public.cockpit_form_invites;
  v_round integer;
  v_on date;
BEGIN
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = p_invite_id FOR UPDATE;
  IF NOT FOUND OR i.form_key IS DISTINCT FROM 'nps' THEN
    RAISE EXCEPTION 'The NPS hook was called for an invite that is not an NPS survey.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(max(CASE WHEN (x.context->>'round') ~ '^[0-9]{1,4}$' THEN (x.context->>'round')::integer END), 0) + 1
    INTO v_round
    FROM public.cockpit_form_invites x
   WHERE x.task_id = i.task_id AND x.form_key = 'nps' AND x.id <> i.id
     AND (x.origin <> 'canary' OR i.origin = 'canary');
  UPDATE public.cockpit_form_invites x
     SET context = x.context || jsonb_build_object('round', v_round), updated_at = now()
   WHERE x.id = i.id;
  v_on := public.cockpit_form_kuwait_day(i.issued_at);
  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (i.task_id, i.client_name, 'nps_sent', NULL, v_on::text, 'NPS survey sent',
          jsonb_build_object('invite_id', i.id, 'on', v_on, 'round', v_round),
          'system', CASE WHEN i.origin = 'canary' THEN 'canary' ELSE 'the cockpit' END);
END $$;

-- CSAT issued: the try (earlier CSAT invites of the card + 1).
CREATE OR REPLACE FUNCTION public.cockpit_form_issue_hook_csat(p_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i public.cockpit_form_invites;
  v_try integer;
BEGIN
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = p_invite_id FOR UPDATE;
  IF NOT FOUND OR i.form_key IS DISTINCT FROM 'csat' THEN
    RAISE EXCEPTION 'The onboarding survey hook was called for an invite that is not one.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*)::integer + 1 INTO v_try
    FROM public.cockpit_form_invites x
   WHERE x.task_id = i.task_id AND x.form_key = 'csat' AND x.id <> i.id
     AND (x.origin <> 'canary' OR i.origin = 'canary');
  UPDATE public.cockpit_form_invites x
     SET context = x.context || jsonb_build_object('try', v_try), updated_at = now()
   WHERE x.id = i.id;
END $$;

-- One notice of an answer. A canary answer's (shadow) is queued and muted in the same statement's transaction: the
-- live notice guard lets a notice start only queued or skipped, and moves queued to muted (20261025n), so no sender
-- ever sees it queued.
CREATE OR REPLACE FUNCTION public.cockpit_form_voice_queue(p_kind text, p_dedupe text, p_task text, p_client text, p_facts jsonb,
  p_canary boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  v_id := public.cockpit_slack_notice_queue(p_kind, p_dedupe, p_task, p_client, p_facts, NULL, NULL, NULL);
  IF v_id IS NOT NULL AND p_canary THEN
    UPDATE public.cockpit_slack_notices n
       SET state = 'muted', error = 'Canary on the test card: not posted', finished_at = now()
     WHERE n.id = v_id AND n.state = 'queued';
  END IF;
  RETURN v_id;
END $$;

-- An answer's notices: the "answer in" post and, at or under the line, the low-score call. Facts are names, days
-- and scores only (3.4): never a free-text answer, an email or a phone.
CREATE OR REPLACE FUNCTION public.cockpit_form_voice_notices(r public.cockpit_form_responses, p_kind text, p_score integer,
  p_results integer, p_round integer, p_survey text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_canary boolean := r.mode = 'shadow' OR coalesce(r.answer_meta->>'canary', '') = 'true';
  v_client text := coalesce((SELECT a.client_name FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = r.task_id),
                            r.client_name);
  v_facts jsonb;
BEGIN
  v_facts := jsonb_strip_nulls(jsonb_build_object(
    'taskId', r.task_id, 'client', v_client, 'responseId', r.id, 'form', r.form_key,
    'score', p_score, 'results', p_results, 'round', p_round, 'survey', p_survey,
    'submittedAt', public.cockpit_slack_notice_iso(r.submitted_at)));
  PERFORM public.cockpit_form_voice_queue(p_kind, split_part(p_kind, '.', 1) || ':' || r.id::text, r.task_id, v_client,
                                          v_facts, v_canary);
  IF p_score IS NOT NULL AND p_score <= public.cockpit_client_voice_low_max() THEN
    PERFORM public.cockpit_form_voice_queue('voice.low', 'low:' || r.id::text, r.task_id, v_client, v_facts, v_canary);
  END IF;
END $$;

-- NPS answered. Reads only recommend and results (the schema's reads: low_score, nps_notice).
CREATE OR REPLACE FUNCTION public.cockpit_form_hook_nps(p_response_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_form_responses;
  v_round integer;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF NOT FOUND OR r.form_key IS DISTINCT FROM 'nps' THEN
    RAISE EXCEPTION 'The NPS answer hook was called for a response that is not an NPS answer.' USING ERRCODE = '22023';
  END IF;
  SELECT CASE WHEN (i.context->>'round') ~ '^[0-9]{1,4}$' THEN (i.context->>'round')::integer END INTO v_round
    FROM public.cockpit_form_invites i WHERE i.id = r.invite_id;
  PERFORM public.cockpit_form_voice_notices(r, 'nps.received',
    public.cockpit_form_answer_int(r.answers, 'recommend', 0, 10),
    public.cockpit_form_answer_int(r.answers, 'results', 0, 10), v_round, 'NPS survey');
END $$;

-- CSAT answered. Reads only onboarding (the schema's reads: low_score, csat_notice).
CREATE OR REPLACE FUNCTION public.cockpit_form_hook_csat(p_response_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_form_responses;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF NOT FOUND OR r.form_key IS DISTINCT FROM 'csat' THEN
    RAISE EXCEPTION 'The onboarding survey answer hook was called for a response that is not one.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cockpit_form_voice_notices(r, 'csat.received',
    public.cockpit_form_answer_int(r.answers, 'onboarding', 1, 10), NULL, NULL, 'onboarding survey');
END $$;

-- ---------------------------------------------------------------------------
-- 7. The schedule run (4.5.4)

CREATE OR REPLACE FUNCTION public.cockpit_form_schedule_run(p_now timestamptz DEFAULT now(), p_apply boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := public.cockpit_form_kuwait_day(coalesce(p_now, now()));
  v_now timestamptz := coalesce(p_now, now());
  v_master jsonb;
  v_on boolean;
  v_cap integer;
  v_skip jsonb := jsonb_build_object('notActive',0,'leaving',0,'noLaunch',0,'open',0,'notLive',0,'formOff',0,'filled',0,
                    'tooOld',0,'cap',0,'withdrawnBySeat',0,'tooSoon',0,'waitingForWhatsAppDay',0,'noPortal',0,
                    'oneFormToday',0,'ruleNotSet',0,'triesUsed',0);
  v_issued jsonb := '{"nps":0,"csat":0}'::jsonb;
  v_swept jsonb := jsonb_build_object('expired', 0, 'ineligible', 0, 'messagesSkipped', 0, 'opensDeleted', 0);
  v_refused jsonb := '[]'::jsonb;
  v_plan jsonb := '[]'::jsonb;
  v_notes text[] := '{}';
  v_rules jsonb := '{}'::jsonb;
  v_ready jsonb := '{}'::jsonb;
  v_form text;
  v_key text;
  v_rule jsonb;
  v_row public.cockpit_form_schedules;
  v_n integer;
  v_m integer;
  v_csat jsonb := '[]'::jsonb;
  v_nps jsonb := '[]'::jsonb;
  v_csat_cards text[] := '{}';
  v_today_cards text[] := '{}';
  v_left integer;
  c record;
  x jsonb;
  v_why text;
  v_ws_open boolean;
  v_live boolean;
  v_tries integer;
  v_last_close timestamptz;
  v_newest timestamptz;
  v_channels text[];
  v_id uuid;
  v_err text;
  v_note text;
  v_result jsonb;
  -- Rule values, read once.
  n_first integer; n_every integer;
  s_after integer; s_wa integer; s_reissues integer; s_retry integer; s_max integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_form_schedule_run', 0));

  -- 1. The sweep, every run while applied: what expired, who stopped qualifying, refused messages of closed
  --    invites, old token opens. A dry plan writes nothing, so it does not sweep.
  IF p_apply THEN
    SELECT count(*) INTO v_n FROM public.cockpit_form_invites WHERE state = 'expired';
    PERFORM public.cockpit_form_invites_expire();
    SELECT count(*) - v_n INTO v_m FROM public.cockpit_form_invites WHERE state = 'expired';
    v_swept := v_swept || jsonb_build_object('expired', v_m);
    SELECT count(*) INTO v_n FROM public.cockpit_form_invites WHERE state = 'withdrawn';
    PERFORM public.cockpit_form_invites_withdraw_ineligible();
    SELECT count(*) - v_n INTO v_m FROM public.cockpit_form_invites WHERE state = 'withdrawn';
    v_swept := v_swept || jsonb_build_object('ineligible', v_m);
    -- A message the gate refused after its invite closed (answered, withdrawn, expired) is skipped; the live
    -- messages guard allows refused -> skipped (11.2-r).
    WITH s AS (
      UPDATE public.cockpit_client_messages m
         SET state = 'skipped', reason = left('The form invite is ' || i.state || ', so this link is not sent.', 240), updated_at = now()
        FROM public.cockpit_form_invites i
       WHERE m.kind = 'form_invite' AND m.state = 'refused' AND m.invite_id = i.id AND i.state <> 'open'
      RETURNING m.id)
    SELECT count(*) INTO v_m FROM s;
    v_swept := v_swept || jsonb_build_object('messagesSkipped', v_m);
    WITH d AS (DELETE FROM public.cockpit_form_token_opens o WHERE o.at < now() - interval '2 days' RETURNING o.id)
    SELECT count(*) INTO v_m FROM d;
    v_swept := v_swept || jsonb_build_object('opensDeleted', v_m);
  END IF;

  -- 2. The master switch. Off: only the sweep ran. A dry plan is made whatever the switch says (D-C5 step 7).
  SELECT CASE WHEN jsonb_typeof(s.value) = 'object' THEN s.value END INTO v_master
    FROM public.cockpit_settings s WHERE s.key = 'forms.schedule';
  v_on := coalesce(v_master->>'on', '') = 'true';
  IF p_apply AND NOT v_on THEN
    v_note := CASE WHEN v_master IS NULL THEN 'The schedule switch (forms.schedule) is not set, so only the sweep ran.'
                   ELSE 'The schedule is off.' END
              || ' Swept: ' || (v_swept->>'expired') || ' expired, ' || (v_swept->>'ineligible') || ' withdrawn (no longer active or leaving).';
    INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, detail, updated_at)
    VALUES ('form-schedule', now(), now(), true, v_note,
            jsonb_build_object('ran', false, 'why', 'The schedule is off.', 'swept', v_swept, 'withdrawn',
                               jsonb_build_object('ineligible', (v_swept->>'ineligible')::integer), 'at', now()), now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = now(), ok = true, note = EXCLUDED.note,
      detail = EXCLUDED.detail, updated_at = now();
    RETURN jsonb_build_object('ran', false, 'apply', true, 'why', 'The schedule is off.', 'swept', v_swept,
      'withdrawn', jsonb_build_object('ineligible', (v_swept->>'ineligible')::integer), 'note', v_note);
  END IF;
  v_cap := public.cockpit_form_rule_int(v_master, 'maxPerRun');
  IF v_cap IS NULL THEN
    v_notes := v_notes || 'The schedule has no maxPerRun. Set it in the forms editor.'::text;
  END IF;

  -- 3. Each form's rule, key by key. A form runs only when its row is on, it is live, and every key it reads is set.
  FOREACH v_form IN ARRAY ARRAY['csat','nps'] LOOP
    v_row := NULL;
    SELECT * INTO v_row FROM public.cockpit_form_schedules s WHERE s.form_key = v_form;
    IF v_row.form_key IS NULL OR NOT v_row."on" THEN
      v_skip := public.cockpit_form_schedule_bump(v_skip, 'formOff');
      v_notes := v_notes || format('The %s schedule is off.', CASE v_form WHEN 'nps' THEN 'NPS' ELSE 'onboarding survey' END);
      CONTINUE;
    END IF;
    IF NOT coalesce(public.cockpit_form_client_live(v_form), false) THEN
      v_skip := public.cockpit_form_schedule_bump(v_skip, 'notLive');
      v_notes := v_notes || format('The %s is not switched on for clients yet.', CASE v_form WHEN 'nps' THEN 'NPS survey' ELSE 'onboarding survey' END);
      CONTINUE;
    END IF;
    v_rule := v_row.rule;
    v_why := NULL;
    FOREACH v_key IN ARRAY CASE v_form WHEN 'nps' THEN ARRAY['firstDay','everyDays']
                                      ELSE ARRAY['afterLaunchDays','whatsappAfterDays','reissues','retryAfterDays','maxAgeDays'] END LOOP
      IF public.cockpit_form_rule_int(v_rule, v_key) IS NULL THEN
        v_why := coalesce(v_why, v_key);
      END IF;
    END LOOP;
    IF v_why IS NOT NULL THEN
      v_skip := public.cockpit_form_schedule_bump(v_skip, 'ruleNotSet');
      v_notes := v_notes || format('The %s rule has no %s. Set it in the forms editor.', v_form, v_why);
      CONTINUE;
    END IF;
    IF v_cap IS NULL THEN
      v_skip := public.cockpit_form_schedule_bump(v_skip, 'ruleNotSet');
      CONTINUE;
    END IF;
    v_ready := v_ready || jsonb_build_object(v_form, true);
    v_rules := v_rules || jsonb_build_object(v_form, v_rule);
  END LOOP;
  n_first := public.cockpit_form_rule_int(v_rules->'nps', 'firstDay');
  n_every := public.cockpit_form_rule_int(v_rules->'nps', 'everyDays');
  s_after := public.cockpit_form_rule_int(v_rules->'csat', 'afterLaunchDays');
  s_wa := public.cockpit_form_rule_int(v_rules->'csat', 'whatsappAfterDays');
  s_reissues := public.cockpit_form_rule_int(v_rules->'csat', 'reissues');
  s_retry := public.cockpit_form_rule_int(v_rules->'csat', 'retryAfterDays');
  s_max := public.cockpit_form_rule_int(v_rules->'csat', 'maxAgeDays');

  -- 4. Every card on the billing sheet: Active with no open departure (cockpit_form_card_allows), a first launch
  --    (the earliest Launch Date the daily snapshots kept, V21), its workspace and the portal's presence count.
  IF v_ready <> '{}'::jsonb THEN
    FOR c IN
      SELECT a.clickup_task_id AS task, a.client_name AS client,
             public.cockpit_form_card_allows(a.clickup_task_id, 'nps') AS why_nps,
             public.cockpit_form_card_allows(a.clickup_task_id, 'csat') AS why_csat,
             (SELECT min(b.launch_date) FROM public.cockpit_client_billing_days b
               WHERE b.clickup_task_id = a.clickup_task_id) AS first_launch,
             w.n AS ws_n, w.status AS ws_status, pr.last_session_at
        FROM public.cockpit_billing_accounts a
        LEFT JOIN LATERAL (SELECT count(*) OVER () AS n, y.location_id, y.status
                             FROM portal_data.workspaces y WHERE y.clickup_id = a.clickup_task_id LIMIT 1) w ON true
        LEFT JOIN public.cockpit_portal_presence pr ON pr.location_id = w.location_id AND w.n = 1
       ORDER BY a.clickup_task_id
    LOOP
      IF c.why_nps IS NOT NULL AND c.why_csat IS NOT NULL THEN
        v_skip := public.cockpit_form_schedule_bump(v_skip,
                    CASE WHEN c.why_nps ILIKE '%is leaving%' THEN 'leaving' ELSE 'notActive' END);
        CONTINUE;
      END IF;
      IF c.first_launch IS NULL THEN
        v_skip := public.cockpit_form_schedule_bump(v_skip, 'noLaunch');
        CONTINUE;
      END IF;
      v_ws_open := coalesce(c.ws_n = 1, false) AND coalesce(c.ws_status, '') NOT IN ('Cancelled','Removed from sheet');
      -- A live session: someone opened the portal in the last 14 days. No presence row yet (before the portal
      -- pushes it) is not a live session.
      v_live := v_ws_open AND coalesce(c.last_session_at >= v_now - interval '14 days', false);

      -- CSAT (4.5.4.5 and 6).
      IF v_ready ? 'csat' AND c.why_csat IS NULL THEN
        v_tries := NULL;
        IF EXISTS (SELECT 1 FROM public.cockpit_form_responses r
                    WHERE r.form_key = 'csat' AND r.task_id = c.task AND r.state IN ('submitted','confirmed') AND r.mode = 'live') THEN
          v_skip := public.cockpit_form_schedule_bump(v_skip, 'filled');
        ELSIF v_today < c.first_launch + s_after THEN
          v_skip := public.cockpit_form_schedule_bump(v_skip, 'tooSoon');
        ELSIF v_today - c.first_launch > s_max THEN
          v_skip := public.cockpit_form_schedule_bump(v_skip, 'tooOld');
        ELSIF EXISTS (SELECT 1 FROM public.cockpit_form_invites i
                       WHERE i.task_id = c.task AND i.form_key = 'csat' AND i.origin <> 'canary'
                         AND i.state = 'open' AND i.expires_at > v_now) THEN
          v_skip := public.cockpit_form_schedule_bump(v_skip, 'open');
        ELSIF EXISTS (SELECT 1 FROM public.cockpit_form_invite_events e JOIN public.cockpit_form_invites i ON i.id = e.invite_id
                       WHERE i.task_id = c.task AND i.form_key = 'csat' AND i.origin <> 'canary' AND e.event = 'withdrawn'
                         AND coalesce(e.detail->>'by', '') = 'seat'
                         AND coalesce(nullif(e.detail->>'reason', ''), i.closed_reason, '') !~* '(^|:\s*)sent again\.?\s*$') THEN
          -- A CSM's withdraw is final for the schedule (V26).
          v_skip := public.cockpit_form_schedule_bump(v_skip, 'withdrawnBySeat');
        ELSE
          SELECT count(*)::integer,
                 max(coalesce(i.closed_at, i.answered_at,
                              CASE WHEN i.state = 'expired' OR i.expires_at <= v_now THEN i.expires_at END))
            INTO v_tries, v_last_close
            FROM public.cockpit_form_invites i
           WHERE i.task_id = c.task AND i.form_key = 'csat' AND i.origin <> 'canary';
          IF v_tries >= 1 + s_reissues THEN
            v_skip := public.cockpit_form_schedule_bump(v_skip, 'triesUsed');
          ELSIF v_tries > 0 AND (v_last_close IS NULL OR v_today - public.cockpit_form_kuwait_day(v_last_close) < s_retry) THEN
            v_skip := public.cockpit_form_schedule_bump(v_skip, 'tooSoon');
          ELSIF v_tries > 0 AND NOT v_ws_open THEN
            -- Later tries go to the portal only; a card with no workspace had its one WhatsApp link.
            v_skip := public.cockpit_form_schedule_bump(v_skip, 'noPortal');
          ELSE
            v_channels := NULL;
            IF v_tries > 0 THEN
              v_channels := ARRAY['portal'];
            ELSIF v_live THEN
              v_channels := ARRAY['portal'];
            ELSIF v_today < c.first_launch + greatest(s_after, s_wa) THEN
              v_skip := public.cockpit_form_schedule_bump(v_skip, 'waitingForWhatsAppDay');
            ELSE
              v_channels := CASE WHEN v_ws_open THEN ARRAY['portal','whatsapp'] ELSE ARRAY['whatsapp'] END;
            END IF;
            IF v_channels IS NOT NULL THEN
              v_csat := v_csat || jsonb_build_array(jsonb_build_object(
                'taskId', c.task, 'client', c.client, 'form', 'csat', 'channels', to_jsonb(v_channels),
                'firstLaunch', c.first_launch, 'daysSinceLaunch', v_today - c.first_launch,
                'context', jsonb_build_object('try', v_tries + 1)));
            END IF;
          END IF;
        END IF;
      END IF;

      -- NPS (4.5.4.4): day firstDay after the first launch, then every everyDays after the newest NPS invite of
      -- any origin (a manual send resets the clock, V21).
      IF v_ready ? 'nps' AND c.why_nps IS NULL THEN
        IF v_today < c.first_launch + n_first THEN
          v_skip := public.cockpit_form_schedule_bump(v_skip, 'tooSoon');
        ELSIF EXISTS (SELECT 1 FROM public.cockpit_form_invites i
                       WHERE i.task_id = c.task AND i.form_key = 'nps' AND i.origin <> 'canary'
                         AND i.state = 'open' AND i.expires_at > v_now) THEN
          v_skip := public.cockpit_form_schedule_bump(v_skip, 'open');
        ELSE
          SELECT max(i.issued_at) INTO v_newest FROM public.cockpit_form_invites i
           WHERE i.task_id = c.task AND i.form_key = 'nps' AND i.origin <> 'canary';
          IF v_newest IS NOT NULL AND v_today - public.cockpit_form_kuwait_day(v_newest) < n_every THEN
            v_skip := public.cockpit_form_schedule_bump(v_skip, 'tooSoon');
          ELSE
            SELECT coalesce(max(CASE WHEN (i.context->>'round') ~ '^[0-9]{1,4}$' THEN (i.context->>'round')::integer END), 0)
              INTO v_n FROM public.cockpit_form_invites i
             WHERE i.task_id = c.task AND i.form_key = 'nps' AND i.origin <> 'canary';
            v_nps := v_nps || jsonb_build_array(jsonb_build_object(
              'taskId', c.task, 'client', c.client, 'form', 'nps',
              'channels', to_jsonb(CASE WHEN NOT v_ws_open THEN ARRAY['whatsapp']
                                        WHEN v_live THEN ARRAY['portal'] ELSE ARRAY['portal','whatsapp'] END),
              'firstLaunch', c.first_launch, 'daysSinceLaunch', v_today - c.first_launch,
              'context', jsonb_build_object('round', v_n + 1)));
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 5. Oldest launch first, at most maxPerRun new invites per form a Kuwait day (so a second run the same day adds
  --    nothing once the day's cap is used), and one client form per card a day: CSAT first.
  SELECT coalesce(array_agg(DISTINCT i.task_id), '{}') INTO v_today_cards
    FROM public.cockpit_form_invites i
   WHERE i.origin = 'schedule' AND i.form_key IN ('nps','csat') AND public.cockpit_form_kuwait_day(i.issued_at) = v_today;
  FOREACH v_form IN ARRAY ARRAY['csat','nps'] LOOP
    IF NOT v_ready ? v_form THEN CONTINUE; END IF;
    SELECT v_cap - count(*)::integer INTO v_left FROM public.cockpit_form_invites i
     WHERE i.origin = 'schedule' AND i.form_key = v_form AND public.cockpit_form_kuwait_day(i.issued_at) = v_today;
    FOR x IN
      SELECT e FROM jsonb_array_elements(CASE v_form WHEN 'csat' THEN v_csat ELSE v_nps END) e
       ORDER BY e->>'firstLaunch', e->>'taskId'
    LOOP
      IF v_form = 'nps' AND (x->>'taskId' = ANY(v_csat_cards) OR x->>'taskId' = ANY(v_today_cards)) THEN
        v_skip := public.cockpit_form_schedule_bump(v_skip, 'oneFormToday');
        CONTINUE;
      END IF;
      IF v_form = 'csat' THEN
        -- Due for CSAT today, sent or capped: NPS waits for another day.
        v_csat_cards := v_csat_cards || (x->>'taskId');
        IF x->>'taskId' = ANY(v_today_cards) THEN
          v_skip := public.cockpit_form_schedule_bump(v_skip, 'oneFormToday');
          CONTINUE;
        END IF;
      END IF;
      IF v_left <= 0 THEN
        v_skip := public.cockpit_form_schedule_bump(v_skip, 'cap');
        CONTINUE;
      END IF;
      v_left := v_left - 1;
      v_plan := v_plan || jsonb_build_array(x - 'context');
      IF p_apply THEN
        v_id := NULL;
        v_err := NULL;
        BEGIN
          v_id := public.cockpit_form_invite_issue_system(x->>'taskId', v_form,
                    ARRAY(SELECT jsonb_array_elements_text(x->'channels')), x->'context', 'schedule');
        EXCEPTION WHEN OTHERS THEN
          -- An issue hook's rule (or any refusal) keeps the run going; the code alone is kept, never the text.
          v_id := NULL;
          v_err := SQLSTATE;
        END;
        IF v_id IS NULL THEN
          v_refused := v_refused || jsonb_build_array(jsonb_build_object('taskId', x->>'taskId', 'form', v_form,
                                                                         'code', coalesce(v_err, 'refused')));
        ELSE
          v_issued := public.cockpit_form_schedule_bump(v_issued, v_form);
          v_today_cards := v_today_cards || (x->>'taskId');
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- 6. The report and its plain note.
  v_note := CASE WHEN p_apply
                 THEN format('Sent %s NPS and %s onboarding %s.', v_issued->>'nps', v_issued->>'csat',
                             CASE WHEN (v_issued->>'csat')::integer = 1 THEN 'survey' ELSE 'surveys' END)
                 ELSE format('Plan: %s NPS and %s onboarding %s would go%s.',
                             (SELECT count(*) FROM jsonb_array_elements(v_plan) e WHERE e->>'form' = 'nps'),
                             (SELECT count(*) FROM jsonb_array_elements(v_plan) e WHERE e->>'form' = 'csat'),
                             CASE WHEN (SELECT count(*) FROM jsonb_array_elements(v_plan) e WHERE e->>'form' = 'csat') = 1
                                  THEN 'survey' ELSE 'surveys' END,
                             CASE WHEN v_on THEN '' ELSE ' once the schedule is on' END) END;
  IF (v_skip->>'cap')::integer > 0 THEN
    v_note := v_note || format(' %s more wait for the next day''s cap of %s per form.', v_skip->>'cap', v_cap);
  END IF;
  IF jsonb_array_length(v_refused) > 0 THEN
    v_note := v_note || format(' %s could not be issued; the report names each card.', jsonb_array_length(v_refused));
  END IF;
  IF cardinality(v_notes) > 0 THEN
    v_note := v_note || ' ' || array_to_string(v_notes, ' ');
  END IF;
  v_result := jsonb_build_object('ran', true, 'apply', p_apply, 'today', v_today, 'issued', v_issued, 'skipped', v_skip,
    'withdrawn', jsonb_build_object('ineligible', (v_swept->>'ineligible')::integer), 'swept', v_swept,
    'refused', v_refused, 'plan', v_plan, 'note', v_note, 'at', now());
  IF p_apply THEN
    INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, detail, updated_at)
    VALUES ('form-schedule', now(), now(), jsonb_array_length(v_refused) = 0, v_note, v_result - 'plan', now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now(),
      last_ok_at = CASE WHEN jsonb_array_length(v_refused) = 0 THEN now() ELSE s0.last_ok_at END,
      ok = EXCLUDED.ok, note = EXCLUDED.note, detail = EXCLUDED.detail, updated_at = now();
  END IF;
  RETURN v_result;
END $$;
COMMENT ON FUNCTION public.cockpit_form_schedule_run(timestamptz, boolean) IS
  'The client forms'' daily schedule (waves 3-4 4.5.4): the sweep, then (while forms.schedule.on) NPS on day 60 and every 90 days, CSAT after launch until filled, one form per card a day, at most maxPerRun per form a day, through cockpit_form_invite_issue_system. p_apply false returns the plan and writes nothing. pg_cron mahara-form-schedule, 07:00 UTC.';

-- ---------------------------------------------------------------------------
-- 8. The client voice view and the daily invite counts (3.5), read by the CEO refresh

CREATE OR REPLACE VIEW public.cockpit_client_voice_v WITH (security_invoker = true) AS
SELECT r.id AS response_id,
       r.task_id AS clickup_task_id,
       coalesce(a.client_name, r.client_name) AS client_name,
       r.form_key,
       r.invite_id,
       CASE WHEN r.form_key = 'nps' AND (i.context->>'round') ~ '^[0-9]{1,4}$' THEN (i.context->>'round')::integer END AS round,
       r.submitted_at,
       ((r.submitted_at AT TIME ZONE 'UTC') + interval '3 hours')::date AS submitted_day,
       r.source,
       CASE r.form_key
         WHEN 'nps' THEN CASE WHEN jsonb_typeof(r.answers->'recommend') = 'number' AND (r.answers->>'recommend') ~ '^([0-9]|10)$'
                              THEN (r.answers->>'recommend')::integer END
         WHEN 'csat' THEN CASE WHEN jsonb_typeof(r.answers->'onboarding') = 'number' AND (r.answers->>'onboarding') ~ '^([1-9]|10)$'
                               THEN (r.answers->>'onboarding')::integer END
         ELSE CASE WHEN jsonb_typeof(r.answers->'rating') = 'number' AND (r.answers->>'rating') ~ '^[1-5]$'
                   THEN (r.answers->>'rating')::integer END
       END AS score,
       CASE WHEN r.form_key = 'nps' AND jsonb_typeof(r.answers->'results') = 'number' AND (r.answers->>'results') ~ '^([0-9]|10)$'
            THEN (r.answers->>'results')::integer END AS results,
       CASE WHEN r.form_key = 'nps' AND jsonb_typeof(r.answers->'communication') = 'number'
                 AND (r.answers->>'communication') ~ '^([1-9]|10)$'
            THEN (r.answers->>'communication')::integer END AS communication,
       CASE WHEN r.form_key = 'nps' AND jsonb_typeof(r.answers->'recommend') = 'number' AND (r.answers->>'recommend') ~ '^([0-9]|10)$'
            THEN CASE WHEN (r.answers->>'recommend')::integer >= 9 THEN 'promoter'
                      WHEN (r.answers->>'recommend')::integer >= 7 THEN 'passive'
                      ELSE 'detractor' END END AS band
  FROM public.cockpit_form_responses r
  LEFT JOIN public.cockpit_form_invites i ON i.id = r.invite_id
  LEFT JOIN public.cockpit_billing_accounts a ON a.clickup_task_id = r.task_id
 WHERE r.form_key IN ('nps','csat','portal_feedback')
   AND r.state IN ('submitted','confirmed')
   AND r.mode = 'live'
   AND r.task_id IS NOT NULL
   AND coalesce(r.answer_meta->>'canary', '') <> 'true'
   AND (i.id IS NULL OR i.origin <> 'canary');
COMMENT ON VIEW public.cockpit_client_voice_v IS
  'One row per client answer of NPS, the onboarding survey (CSAT) or portal feedback (waves 3-4 3.5): live, submitted or confirmed, on a card; legacy Typeform answers (no card), canary (shadow) answers and canary invites are left out. band is NPS only (9-10 promoter, 7-8 passive, 0-6 detractor); a feedback rating (1-5) never enters NPS.';
REVOKE ALL ON public.cockpit_client_voice_v FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_client_voice_v TO service_role;

CREATE OR REPLACE VIEW public.cockpit_form_invites_daily_v WITH (security_invoker = true) AS
SELECT x.day, x.form_key, sum(x.issued)::integer AS issued, sum(x.answered)::integer AS answered
  FROM (
    SELECT ((i.issued_at AT TIME ZONE 'UTC') + interval '3 hours')::date AS day, i.form_key, 1 AS issued, 0 AS answered
      FROM public.cockpit_form_invites i WHERE i.origin <> 'canary'
    UNION ALL
    SELECT ((i.answered_at AT TIME ZONE 'UTC') + interval '3 hours')::date, i.form_key, 0, 1
      FROM public.cockpit_form_invites i WHERE i.origin <> 'canary' AND i.state = 'answered' AND i.answered_at IS NOT NULL
  ) x
 GROUP BY x.day, x.form_key;
COMMENT ON VIEW public.cockpit_form_invites_daily_v IS
  'Client form invites issued and answered per Kuwait day and form (waves 3-4 3.5): counts only, never a person; canary invites left out.';
REVOKE ALL ON public.cockpit_form_invites_daily_v FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_form_invites_daily_v TO service_role;

-- The CEO refresh and the VPS read through the management API's read-only role (lesson of 20261101r): both views
-- call no function, so the grant is the views themselves.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_read_only_user') THEN
    EXECUTE 'GRANT SELECT ON public.cockpit_client_voice_v, public.cockpit_form_invites_daily_v TO supabase_read_only_user';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9. The seat reads (3.3 c), all STABLE: they never expire an invite, they read one past expires_at as expired

-- The NPS score of a set of answers: each card's latest answer once.
CREATE OR REPLACE FUNCTION public.cockpit_client_voice_nps(p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH latest AS (
    SELECT DISTINCT ON (v.clickup_task_id) v.clickup_task_id, v.score, v.band
      FROM public.cockpit_client_voice_v v
     WHERE v.form_key = 'nps' AND v.score IS NOT NULL AND v.submitted_day BETWEEN p_from AND p_to
     ORDER BY v.clickup_task_id, v.submitted_at DESC, v.response_id DESC),
  answered AS (
    SELECT count(DISTINCT i.task_id) AS cards
      FROM public.cockpit_form_invite_events e JOIN public.cockpit_form_invites i ON i.id = e.invite_id
     WHERE e.event = 'answered' AND i.form_key = 'nps' AND i.origin <> 'canary'
       AND ((e.at AT TIME ZONE 'UTC') + interval '3 hours')::date BETWEEN p_from AND p_to),
  n AS (
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE band = 'promoter')::integer AS p,
           count(*) FILTER (WHERE band = 'passive')::integer AS pa,
           count(*) FILTER (WHERE band = 'detractor')::integer AS d
      FROM latest)
  SELECT jsonb_build_object(
    'score', CASE WHEN n.n > 0 THEN round(100.0 * (n.p - n.d) / n.n)::integer END,
    'n', n.n, 'promoters', n.p, 'passives', n.pa, 'detractors', n.d, 'from', p_from, 'to', p_to,
    'cardsAnswered', answered.cards::integer,
    'note', concat_ws(' ',
      CASE WHEN n.n = 0 THEN 'No scores yet.' END,
      CASE WHEN answered.cards <> n.n THEN format('Cards with an answered invite %s, cards with an answer %s.', answered.cards, n.n) END))
    FROM n, answered
$$;

CREATE OR REPLACE FUNCTION public.cockpit_client_voice_invite_row(i public.cockpit_form_invites)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', i.id, 'formKey', i.form_key,
    'title', CASE i.form_key WHEN 'nps' THEN 'NPS survey' WHEN 'csat' THEN 'Onboarding survey' ELSE i.form_key END,
    'state', CASE WHEN i.state = 'open' AND i.expires_at <= now() THEN 'expired' ELSE i.state END,
    'channels', to_jsonb(i.channels), 'origin', i.origin, 'issuedAt', i.issued_at, 'issuedByRole', i.issued_by_role,
    'expiresAt', i.expires_at,
    'opened', EXISTS (SELECT 1 FROM public.cockpit_form_invite_events e WHERE e.invite_id = i.id AND e.event = 'opened'),
    'openedAt', (SELECT min(e.at) FROM public.cockpit_form_invite_events e WHERE e.invite_id = i.id AND e.event = 'opened'),
    'answeredAt', i.answered_at, 'responseId', i.response_id)
$$;

CREATE OR REPLACE FUNCTION public.cockpit_client_voice_read(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_legacy integer;
  v_nps jsonb;
  v_csat jsonb;
BEGIN
  PERFORM public.cockpit_csm_client_gate(p_task_id);
  SELECT jsonb_build_object('score', v.score, 'results', v.results, 'communication', v.communication,
           'startStop', nullif(btrim(coalesce(r.answers->>'startStop', '')), ''), 'at', v.submitted_at, 'round', v.round)
    INTO v_nps
    FROM public.cockpit_client_voice_v v JOIN public.cockpit_form_responses r ON r.id = v.response_id
   WHERE v.clickup_task_id = p_task_id AND v.form_key = 'nps'
   ORDER BY v.submitted_at DESC, v.response_id DESC LIMIT 1;
  SELECT jsonb_build_object('score', v.score, 'liked', nullif(btrim(coalesce(r.answers->>'liked', '')), ''),
           'disliked', nullif(btrim(coalesce(r.answers->>'disliked', '')), ''), 'at', v.submitted_at)
    INTO v_csat
    FROM public.cockpit_client_voice_v v JOIN public.cockpit_form_responses r ON r.id = v.response_id
   WHERE v.clickup_task_id = p_task_id AND v.form_key = 'csat'
   ORDER BY v.submitted_at DESC, v.response_id DESC LIMIT 1;
  SELECT count(*)::integer INTO v_legacy FROM public.cockpit_form_responses r
   WHERE r.form_key IN ('nps','csat') AND r.state = 'legacy' AND r.task_id IS NULL;
  RETURN jsonb_build_object(
    'nps', jsonb_build_object(
      'latest', v_nps,
      'history', coalesce((SELECT jsonb_agg(jsonb_build_object('score', h.score, 'at', h.submitted_at) ORDER BY h.submitted_at DESC)
                             FROM (SELECT v.score, v.submitted_at FROM public.cockpit_client_voice_v v
                                    WHERE v.clickup_task_id = p_task_id AND v.form_key = 'nps'
                                    ORDER BY v.submitted_at DESC, v.response_id DESC LIMIT 6) h), '[]'::jsonb)),
    'csat', coalesce(v_csat, jsonb_build_object('score', NULL, 'liked', NULL, 'disliked', NULL, 'at', NULL)),
    'feedback', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', r.answers->>'kind', 'topic', r.answers->>'topic',
                                   'rating', v.score, 'message', r.answers->>'message', 'at', v.submitted_at)
                                 ORDER BY v.submitted_at DESC)
                            FROM (SELECT * FROM public.cockpit_client_voice_v v0
                                   WHERE v0.clickup_task_id = p_task_id AND v0.form_key = 'portal_feedback'
                                   ORDER BY v0.submitted_at DESC, v0.response_id DESC LIMIT 5) v
                            JOIN public.cockpit_form_responses r ON r.id = v.response_id), '[]'::jsonb),
    'open', coalesce((SELECT jsonb_agg(public.cockpit_client_voice_invite_row(i) ORDER BY i.issued_at DESC)
                        FROM public.cockpit_form_invites i
                       WHERE i.task_id = p_task_id AND i.form_key IN ('nps','csat') AND i.origin <> 'canary'
                         AND i.state = 'open' AND i.expires_at > now()), '[]'::jsonb),
    'source', 'From the client''s own answers in the portal or by link.'
              || CASE WHEN v_legacy > 0
                      THEN format(' The %s old Typeform %s could not be matched to a client, so %s left out.', v_legacy,
                                  CASE WHEN v_legacy = 1 THEN 'answer' ELSE 'answers' END,
                                  CASE WHEN v_legacy = 1 THEN 'it is' ELSE 'they are' END)
                      ELSE '' END);
END $$;
COMMENT ON FUNCTION public.cockpit_client_voice_read(text) IS
  'One client''s voice (waves 3-4 3.3): the latest NPS and its last six scores, the onboarding survey, the last five portal feedback notes and the open NPS or onboarding invites. The CEO, or a CSM allowed on the client (cockpit_csm_client_gate). Never an email.';

CREATE OR REPLACE FUNCTION public.cockpit_client_voice_today()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ceo boolean;
  v_max integer := public.cockpit_client_voice_low_max();
BEGIN
  PERFORM public.cockpit_form_actor();
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT v_ceo AND NOT coalesce(public.cockpit_has_role('csm'), false) THEN
    RAISE EXCEPTION 'Low scores are for client success and the CEO.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'kind', 'low_score', 'responseId', v.response_id, 'taskId', v.clickup_task_id, 'clientName', v.client_name,
             'formKey', v.form_key, 'score', v.score, 'at', v.submitted_at,
             -- One client_low_score request raised at or after the answer covers every low score of the card before it.
             'ticketOpen', EXISTS (SELECT 1 FROM public.cockpit_requests q
                                    WHERE q.type_key = 'client_low_score' AND q.client_task_id = v.clickup_task_id
                                      AND q.created_at >= v.submitted_at AND q.state <> 'cancelled'))
           ORDER BY v.submitted_at DESC)
      FROM public.cockpit_client_voice_v v
     WHERE v.form_key IN ('nps','csat') AND v.score IS NOT NULL AND v.score <= v_max
       AND v.submitted_at >= now() - interval '14 days'
       AND (v_ceo OR coalesce(public.cockpit_client_allowed(v.client_name), false))), '[]'::jsonb);
END $$;
COMMENT ON FUNCTION public.cockpit_client_voice_today() IS
  'Today''s low scores (waves 3-4 3.3): NPS or onboarding answers at or under voice.low_score.max in the last 14 days, with ticketOpen once a client_low_score request for the card exists after the answer. CSM: their clients; the CEO: all.';

CREATE OR REPLACE FUNCTION public.cockpit_client_voice_summary(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_csat jsonb;
BEGIN
  PERFORM public.cockpit_form_actor();
  IF NOT coalesce(public.cockpit_is_ceo(), false) AND NOT coalesce(public.cockpit_has_role('csm'), false) THEN
    RAISE EXCEPTION 'The client voice summary is for client success and the CEO.' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'Pick a window of at most 400 days, the start before the end.' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_build_object('average', CASE WHEN count(*) > 0 THEN round(avg(v.score), 1) END, 'n', count(*)::integer,
           'note', CASE WHEN count(*) = 0 THEN 'No onboarding answers yet.' ELSE 'Average of onboarding answers, 1 to 10, kept apart from NPS.' END)
    INTO v_csat
    FROM public.cockpit_client_voice_v v
   WHERE v.form_key = 'csat' AND v.score IS NOT NULL AND v.submitted_day BETWEEN p_from AND p_to;
  RETURN jsonb_build_object(
    'nps', public.cockpit_client_voice_nps(p_from, p_to),
    'csat', v_csat,
    'invites', jsonb_build_object(
      'nps', jsonb_build_object(
        'sent', (SELECT coalesce(sum(d.issued), 0)::integer FROM public.cockpit_form_invites_daily_v d
                  WHERE d.form_key = 'nps' AND d.day BETWEEN p_from AND p_to),
        'answered', (SELECT coalesce(sum(d.answered), 0)::integer FROM public.cockpit_form_invites_daily_v d
                      WHERE d.form_key = 'nps' AND d.day BETWEEN p_from AND p_to),
        'cardsAnswered', (public.cockpit_client_voice_nps(p_from, p_to)->>'cardsAnswered')::integer),
      'csat', jsonb_build_object(
        'sent', (SELECT coalesce(sum(d.issued), 0)::integer FROM public.cockpit_form_invites_daily_v d
                  WHERE d.form_key = 'csat' AND d.day BETWEEN p_from AND p_to),
        'answered', (SELECT coalesce(sum(d.answered), 0)::integer FROM public.cockpit_form_invites_daily_v d
                      WHERE d.form_key = 'csat' AND d.day BETWEEN p_from AND p_to))));
END $$;
COMMENT ON FUNCTION public.cockpit_client_voice_summary(date, date) IS
  'NPS (each card once with its latest answer in the window; promoters minus detractors over n, NULL with "No scores yet." when n is 0, checked against the cards with an answered invite), the onboarding average and the invite counts, for a window of Kuwait days. CEO and CSM seats.';

-- ---------------------------------------------------------------------------
-- 10. The feedback bridge (4.6): the portal's Share feedback, refused until portal_feedback is live

CREATE OR REPLACE FUNCTION public.portal_feedback_record(p_location_id text, p_clickup_id text, p_person text, p_feedback jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_person text := public.portal_client_ask_person(p_person);
  v_id text;
  v_kind text;
  v_topic text;
  v_message text;
  v_rating integer;
  v_contact boolean;
  v_at timestamptz;
  v_n integer;
  v_client text;
  v_version integer;
  v_response uuid;
  v_inserted boolean := false;
  v_prev_action text := current_setting('cockpit.forms_action', true);
  v_prev_actor text := current_setting('cockpit.audit_actor', true);
  v_prev_source text := current_setting('cockpit.audit_source', true);
BEGIN
  IF p_location_id IS NULL OR p_clickup_id IS NULL OR p_location_id !~ '^[A-Za-z0-9_-]{1,100}$'
     OR p_clickup_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'form_invite_not_in_workspace' USING ERRCODE = '42501';
  END IF;
  -- Before D-FB the portal's own save is the only one; the bridge says so and stores nothing.
  IF NOT coalesce(public.cockpit_form_client_live('portal_feedback'), false) THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'not_live');
  END IF;
  SELECT count(*)::integer INTO v_n FROM portal_data.workspaces w
   WHERE w.location_id = p_location_id AND w.clickup_id = p_clickup_id
     AND coalesce(w.status, '') NOT IN ('Cancelled','Removed from sheet');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'form_invite_not_in_workspace' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_feedback) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'invalid');
  END IF;
  v_id := CASE WHEN jsonb_typeof(p_feedback->'feedbackId') = 'string' THEN p_feedback->>'feedbackId' END;
  v_kind := CASE WHEN jsonb_typeof(p_feedback->'kind') = 'string' THEN p_feedback->>'kind' END;
  v_topic := CASE WHEN jsonb_typeof(p_feedback->'topic') = 'string' THEN p_feedback->>'topic' END;
  v_message := CASE WHEN jsonb_typeof(p_feedback->'message') = 'string'
                    THEN btrim(regexp_replace(p_feedback->>'message', '[\u0000-\u0008\u000b\u000c\u000e-\u001f]', '', 'g')) END;
  v_rating := CASE WHEN jsonb_typeof(p_feedback->'rating') = 'number' AND (p_feedback->>'rating') ~ '^[1-5]$'
                   THEN (p_feedback->>'rating')::integer END;
  v_contact := CASE WHEN jsonb_typeof(p_feedback->'contactOk') = 'boolean' THEN (p_feedback->>'contactOk')::boolean END;
  BEGIN
    v_at := CASE jsonb_typeof(p_feedback->'createdAt')
              WHEN 'number' THEN to_timestamp((p_feedback->>'createdAt')::double precision / 1000.0)
              WHEN 'string' THEN (p_feedback->>'createdAt')::timestamptz END;
  EXCEPTION WHEN OTHERS THEN
    v_at := NULL;
  END;
  IF v_id IS NULL OR v_id !~ '^[A-Za-z0-9_-]{6,80}$'
     OR v_kind IS NULL OR v_kind NOT IN ('idea','improvement','problem','appreciation')
     OR v_topic IS NULL OR v_topic NOT IN ('service','portal','communication','results','onboarding','other')
     OR v_message IS NULL OR char_length(v_message) NOT BETWEEN 1 AND 2400
     OR (jsonb_typeof(p_feedback->'rating') IS DISTINCT FROM 'null' AND p_feedback ? 'rating' AND v_rating IS NULL)
     OR v_contact IS NULL
     OR (v_at IS NOT NULL AND (v_at > now() + interval '1 day' OR v_at < now() - interval '400 days')) THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'invalid');
  END IF;
  SELECT f.version INTO v_version FROM public.cockpit_forms f WHERE f.key = 'portal_feedback';
  SELECT coalesce((SELECT a.client_name FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = p_clickup_id),
                  (SELECT w.name FROM portal_data.workspaces w WHERE w.location_id = p_location_id))
    INTO v_client;
  PERFORM set_config('cockpit.forms_action', 'forms.feedback_bridged', true);
  PERFORM set_config('cockpit.audit_actor', 'portal', true);
  PERFORM set_config('cockpit.audit_source', 'portal', true);
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
    answers, answer_meta, hidden, created_by, submitted_by, submitted_at)
  VALUES ('portal_feedback', v_version, 'portal', 'feedback:' || v_id, p_clickup_id, v_client, 'live', 'submitted',
          jsonb_build_object('kind', v_kind, 'topic', v_topic, 'message', v_message, 'rating', v_rating, 'contactOk', v_contact),
          jsonb_build_object('notice_on', public.cockpit_form_kuwait_day(coalesce(v_at, now())), 'bridge', 'portal_feedback'),
          '{}'::jsonb, 'portal', v_person, coalesce(v_at, now()))
  ON CONFLICT (form_key, external_id) DO NOTHING
  RETURNING id INTO v_response;
  IF v_response IS NOT NULL THEN
    v_inserted := true;
    PERFORM public.cockpit_slack_notice_queue('feedback.received', 'feedback:' || v_response::text, p_clickup_id, v_client,
      jsonb_build_object('taskId', p_clickup_id, 'client', v_client, 'responseId', v_response, 'feedbackKind', v_kind, 'topic', v_topic,
                         'submittedAt', public.cockpit_slack_notice_iso(coalesce(v_at, now()))),
      NULL, NULL, NULL);
  ELSE
    SELECT r.id INTO v_response FROM public.cockpit_form_responses r
     WHERE r.form_key = 'portal_feedback' AND r.external_id = 'feedback:' || v_id;
  END IF;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
  PERFORM set_config('cockpit.audit_actor', coalesce(v_prev_actor, ''), true);
  PERFORM set_config('cockpit.audit_source', coalesce(v_prev_source, ''), true);
  RETURN jsonb_build_object('recorded', true, 'inserted', v_inserted, 'responseId', v_response);
END $$;
COMMENT ON FUNCTION public.portal_feedback_record(text, text, text, jsonb) IS
  'The portal''s Share feedback, bridged (waves 3-4 4.6): refused {recorded:false, reason:not_live} until portal_feedback is live; one portal_feedback response per feedback id; queues feedback.received. The rating never enters NPS. Service role only.';

-- ---------------------------------------------------------------------------
-- 11. The Make-owned Typeforms (4.7, 4.8): records only, never a notice, never an imitated submission

CREATE OR REPLACE FUNCTION public.cockpit_form_record_make(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.cockpit_forms;
  v_form text;
  v_token text;
  v_at timestamptz;
  v_backfill boolean;
  v_answers jsonb;
  v_raw jsonb;
  v_hidden jsonb;
  v_card text;
  v_task text;
  v_client text;
  v_id uuid;
  v_inserted boolean := false;
  v_model text := 'not_onboarding';
  v_held jsonb;
  v_held_at timestamptz;
  v_prev_action text := current_setting('cockpit.forms_action', true);
  v_prev_actor text := current_setting('cockpit.audit_actor', true);
  v_prev_source text := current_setting('cockpit.audit_source', true);
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Send the response as an object.' USING ERRCODE = '22023';
  END IF;
  v_form := p->>'formKey';
  IF v_form IS NULL OR v_form NOT IN ('onboarding','new_client') THEN
    RAISE EXCEPTION 'Only the client onboarding form and the New Client Form are recorded here.' USING ERRCODE = '22023';
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
  v_answers := CASE WHEN jsonb_typeof(p->'answers') = 'object' AND jsonb_typeof(p->'answers'->'fields') = 'array' THEN p->'answers' END;
  IF v_answers IS NULL OR octet_length(v_answers::text) > 65536 THEN
    RAISE EXCEPTION 'Send the answers as {fields: [...]} under 64 KB.' USING ERRCODE = '22023';
  END IF;
  IF p ? 'backfill' AND jsonb_typeof(p->'backfill') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'Send backfill as true or false.' USING ERRCODE = '22023';
  END IF;
  v_backfill := coalesce((p->>'backfill')::boolean, false);
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = v_form;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The % form is not in the registry.', v_form USING ERRCODE = '22023';
  END IF;
  -- Only each form's own hidden fields, each a short string.
  v_raw := CASE WHEN jsonb_typeof(p->'hidden') = 'object' THEN p->'hidden' ELSE '{}'::jsonb END;
  IF v_form = 'onboarding' THEN
    v_hidden := jsonb_strip_nulls(jsonb_build_object(
      'client_name', CASE WHEN jsonb_typeof(v_raw->'client_name') = 'string' THEN left(nullif(btrim(v_raw->>'client_name'), ''), 200) END,
      'onboarding_client_id', CASE WHEN jsonb_typeof(v_raw->'onboarding_client_id') = 'string'
                                   THEN left(nullif(btrim(v_raw->>'onboarding_client_id'), ''), 60) END));
    -- The card: the hidden onboarding_client_id when it names a card the cockpit mirrors (the billing sheet or the
    -- onboarding read model). The signature proves Typeform sent it, not who filled it: kept as hidden_id_unverified.
    v_card := coalesce(nullif(btrim(p->>'taskId'), ''), v_hidden->>'onboarding_client_id');
    IF v_card ~ '^[A-Za-z0-9_-]{1,40}$' THEN
      SELECT x.t, x.n INTO v_task, v_client FROM (
        SELECT a.clickup_task_id AS t, a.client_name AS n, 1 AS o FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = v_card
        UNION ALL
        SELECT o.clickup_task_id, o.client_name, 2 FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = v_card) x
       ORDER BY x.o LIMIT 1;
    END IF;
  ELSE
    v_hidden := jsonb_strip_nulls(jsonb_build_object(
      'contact_id', CASE WHEN jsonb_typeof(v_raw->'contact_id') = 'string' THEN left(nullif(btrim(v_raw->>'contact_id'), ''), 60) END,
      'closer', CASE WHEN jsonb_typeof(v_raw->'closer') = 'string' THEN left(nullif(btrim(v_raw->>'closer'), ''), 120) END,
      'setter', CASE WHEN jsonb_typeof(v_raw->'setter') = 'string' THEN left(nullif(btrim(v_raw->>'setter'), ''), 120) END));
  END IF;

  PERFORM set_config('cockpit.forms_action', 'forms.make_recorded', true);
  PERFORM set_config('cockpit.audit_actor', 'typeform', true);
  PERFORM set_config('cockpit.audit_source', CASE WHEN v_backfill THEN 'forms-backfill' ELSE 'forms-door' END, true);
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
    answers, answer_meta, hidden, created_by, submitted_by, submitted_at)
  VALUES (v_form, f.version, CASE WHEN v_backfill THEN 'typeform_sync' ELSE 'typeform_webhook' END, v_token, v_task,
          coalesce(v_client, v_hidden->>'client_name'), 'live', 'submitted', v_answers,
          jsonb_build_object('notice_on', public.cockpit_form_kuwait_day(v_at), 'owner', 'make')
            || CASE WHEN v_task IS NOT NULL THEN jsonb_build_object('match', 'hidden_id_unverified') ELSE '{}'::jsonb END,
          v_hidden, 'forms-door', 'typeform', v_at)
  ON CONFLICT (form_key, external_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    v_inserted := true;
  ELSE
    SELECT r.id, r.task_id INTO v_id, v_task FROM public.cockpit_form_responses r
     WHERE r.form_key = v_form AND r.external_id = v_token;
  END IF;

  -- The onboarding read model (V14), in the poll's own shape: only when it holds no onboarding answer or an older one.
  IF v_form = 'onboarding' THEN
    IF v_task IS NULL THEN
      v_model := 'no_card';
    ELSE
      SELECT o.forms->'onboarding' INTO v_held FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = v_task FOR UPDATE;
      IF NOT FOUND THEN
        v_model := 'no_row';
      ELSE
        BEGIN
          v_held_at := (v_held->>'submitted_at')::timestamptz;
        EXCEPTION WHEN OTHERS THEN
          v_held_at := NULL;
        END;
        IF jsonb_typeof(v_held) = 'object' AND v_held_at IS NOT NULL AND v_held_at >= v_at THEN
          v_model := 'newer_kept';
        ELSE
          UPDATE public.cockpit_client_onboarding o
             SET forms = coalesce(o.forms, '{}'::jsonb) || jsonb_build_object('onboarding', jsonb_build_object(
                           'form_id', 'KFRCXPFx', 'response_id', v_token, 'submitted_at', p->>'submittedAt',
                           'answers', v_answers->'fields'))
           WHERE o.clickup_task_id = v_task;
          v_model := 'written';
        END IF;
      END IF;
    END IF;
  END IF;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
  PERFORM set_config('cockpit.audit_actor', coalesce(v_prev_actor, ''), true);
  PERFORM set_config('cockpit.audit_source', coalesce(v_prev_source, ''), true);
  RETURN jsonb_build_object('inserted', v_inserted, 'responseId', v_id, 'taskId', v_task, 'readModel', v_model);
END $$;
COMMENT ON FUNCTION public.cockpit_form_record_make(jsonb) IS
  'forms-door''s writer for the live Typeforms Make owns (waves 3-4 4.7, 4.8): client onboarding KFRCXPFx and the New Client Form BTzMwXiw. One submitted response per Typeform token, no notice (V23); an onboarding answer on a mirrored card fills cockpit_client_onboarding.forms.onboarding only when it is empty or older. Service role only.';

CREATE OR REPLACE FUNCTION public.portal_form_status(p_location_id text, p_clickup_id text, p_form_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_n integer;
  r public.cockpit_form_responses;
BEGIN
  IF p_location_id IS NULL OR p_clickup_id IS NULL OR p_location_id !~ '^[A-Za-z0-9_-]{1,100}$'
     OR p_clickup_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'form_invite_not_in_workspace' USING ERRCODE = '42501';
  END IF;
  IF p_form_key IS DISTINCT FROM 'onboarding' THEN
    RAISE EXCEPTION 'form_status_unknown_form' USING ERRCODE = '22023';
  END IF;
  SELECT count(*)::integer INTO v_n FROM portal_data.workspaces w
   WHERE w.location_id = p_location_id AND w.clickup_id = p_clickup_id
     AND coalesce(w.status, '') NOT IN ('Cancelled','Removed from sheet');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'form_invite_not_in_workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.cockpit_form_responses x
   WHERE x.form_key = 'onboarding' AND x.task_id = p_clickup_id AND x.state IN ('submitted','confirmed') AND x.mode = 'live'
   ORDER BY x.submitted_at DESC, x.id DESC LIMIT 1;
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('submitted', false, 'submittedAt', NULL, 'reference', NULL, 'source', NULL, 'unverified', false);
  END IF;
  RETURN jsonb_build_object('submitted', true, 'submittedAt', r.submitted_at, 'reference', r.id, 'source', r.source,
    'unverified', coalesce(r.answer_meta->>'match', '') = 'hidden_id_unverified');
END $$;
COMMENT ON FUNCTION public.portal_form_status(text, text, text) IS
  'The portal''s onboarding gate evidence (waves 3-4 4.7): the card''s newest stored onboarding answer. Service role only; the workspace pair is checked first.';

-- ---------------------------------------------------------------------------
-- 12. The forms door and its keys: the two Make-owned forms (replaced, 2.2)

CREATE OR REPLACE FUNCTION public.cockpit_forms_key_put(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_provider text := p->>'provider';
  v_secret text := p->>'secret';
  v_by text := lower(btrim(coalesce(p->>'savedBy', '')));
  v_state text := coalesce(nullif(p->>'state', ''), 'unchecked');
  v_meta jsonb := CASE WHEN jsonb_typeof(p->'meta') = 'object' THEN p->'meta' ELSE '{}'::jsonb END;
  v_name text;
  v_id uuid;
  v_ok boolean;
  v_registered boolean;
  v_form text;
  v_noun text;
  k public.cockpit_forms_keys;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF v_provider IS NULL OR v_provider NOT IN ('fathom','fathom_webhook','anthropic','deepseek','typeform_kickoff',
                                              'typeform_exit_survey','typeform_pause_request',
                                              'typeform_onboarding','typeform_new_client') THEN
    RAISE EXCEPTION 'Choose fathom, fathom_webhook, anthropic, deepseek, typeform_kickoff, typeform_exit_survey, typeform_pause_request, typeform_onboarding or typeform_new_client.'
      USING ERRCODE = '22023';
  END IF;
  -- A Typeform form's signing key (kickoff since 2b; the termination survey and the pause request since waves 1-2;
  -- client onboarding and the New Client Form since waves 3-4): its form and the noun its notes use.
  v_form := CASE WHEN v_provider LIKE 'typeform\_%' THEN substr(v_provider, 10) END;
  v_noun := CASE v_form WHEN 'kickoff' THEN 'kickoff' WHEN 'exit_survey' THEN 'termination survey'
                        WHEN 'pause_request' THEN 'pause request' WHEN 'onboarding' THEN 'client onboarding form'
                        WHEN 'new_client' THEN 'New Client Form' END;
  v_ok := CASE v_provider
    WHEN 'fathom' THEN char_length(v_secret) BETWEEN 20 AND 400 AND v_secret !~ '[[:space:]]'
    WHEN 'fathom_webhook' THEN v_secret ~ '^whsec_[A-Za-z0-9+/=_-]{16,}$'
    WHEN 'anthropic' THEN v_secret ~ '^sk-ant-[A-Za-z0-9_-]{20,}$'
    WHEN 'deepseek' THEN v_secret ~ '^sk-[A-Za-z0-9]{20,}$'
    ELSE v_secret ~ '^[A-Za-z0-9_-]{32,128}$' END;
  IF NOT coalesce(v_ok, false) AND v_form IS NOT NULL THEN
    RAISE EXCEPTION 'That doesn''t look like a Typeform signing secret: 32 to 128 letters, digits, - or _. Nothing was changed.'
      USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'That doesn''t look like % % key. Nothing was changed.',
      CASE WHEN v_provider = 'anthropic' THEN 'an' ELSE 'a' END, public.cockpit_forms_key_label(v_provider)
      USING ERRCODE = '22023';
  END IF;
  IF v_by <> 'server' AND v_by !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'A key is saved by a verified email or the server.' USING ERRCODE = '22023';
  END IF;
  IF v_state NOT IN ('connected','unchecked','refused') THEN
    RAISE EXCEPTION 'Choose connected, unchecked or refused.' USING ERRCODE = '22023';
  END IF;
  v_name := 'cockpit_forms_key_' || v_provider;
  -- Two pastes of one key at once take turns, so the second finds the first's
  -- secret and updates it instead of racing it on the vault's unique name.
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_forms_key:' || v_provider, 0));
  SELECT s.id INTO v_id FROM vault.secrets s WHERE s.name = v_name LIMIT 1;
  IF v_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_id, v_secret);
  ELSE
    PERFORM vault.create_secret(v_secret, v_name, 'cockpit forms key: ' || v_provider);
  END IF;
  INSERT INTO public.cockpit_forms_keys AS k0 (provider, vault_name, last4, state, state_note, saved_by, saved_at, checked_at, meta)
  VALUES (v_provider, v_name, right(v_secret, 4), v_state, left(p->>'stateNote', 240), v_by, now(),
          CASE WHEN v_state <> 'unchecked' THEN now() END, v_meta)
  ON CONFLICT (provider) DO UPDATE
     SET last4 = EXCLUDED.last4, state = EXCLUDED.state, state_note = EXCLUDED.state_note, saved_by = EXCLUDED.saved_by,
         saved_at = now(), checked_at = EXCLUDED.checked_at,
         meta = CASE WHEN EXCLUDED.provider = 'fathom_webhook' OR EXCLUDED.provider LIKE 'typeform\_%'
                     THEN EXCLUDED.meta ELSE k0.meta || EXCLUDED.meta END
  RETURNING * INTO k;
  IF v_provider = 'fathom_webhook' THEN
    INSERT INTO public.cockpit_sync_state AS s0 (key, note, detail, updated_at)
    VALUES ('fathom-webhook',
            CASE WHEN nullif(btrim(coalesce(k.meta->>'webhookId', '')), '') IS NOT NULL
                 THEN 'Registered webhook ending ' || right(btrim(k.meta->>'webhookId'), 4)
                 ELSE 'The webhook key is saved without a webhook ID.' END,
            public.cockpit_forms_webhook_detail(k.meta, k.saved_at), now())
    ON CONFLICT (key) DO UPDATE SET note = EXCLUDED.note, detail = EXCLUDED.detail, updated_at = now();
  END IF;
  IF v_form IS NOT NULL THEN
    -- Registered: a webhook id and no unregisteredAt, as the Fathom webhook.
    v_registered := (public.cockpit_forms_webhook_detail(k.meta, k.saved_at)->>'registered')::boolean;
    -- A saved key is no failing job. While nothing is registered there is no
    -- delivery to lose, so an earlier failure stops counting too.
    INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, detail, updated_at)
    VALUES ('forms-door:' || v_form, now(), now(), true,
            CASE WHEN v_registered THEN 'The ' || v_noun || ' webhook is registered.'
                 ELSE 'The ' || v_noun || ' signing key is saved; the webhook is not registered with it yet.' END,
            jsonb_build_object('registered', v_registered,
                               'registeredAt', CASE WHEN v_registered THEN coalesce(k.meta->'registeredAt', to_jsonb(k.saved_at)) END,
                               'lastDelivery', NULL, 'outcome', NULL), now())
    ON CONFLICT (key) DO UPDATE
       SET note = EXCLUDED.note,
           ok = s0.ok OR NOT v_registered,
           last_ok_at = CASE WHEN s0.ok OR v_registered THEN s0.last_ok_at ELSE now() END,
           detail = coalesce(s0.detail, '{}'::jsonb)
                    || jsonb_build_object('registered', EXCLUDED.detail->'registered', 'registeredAt', EXCLUDED.detail->'registeredAt'),
           updated_at = now();
  END IF;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('forms.keySaved', 'cockpit_forms_keys', v_provider, v_by, 'client-success',
          CASE WHEN v_by = 'server' THEN 'forms_key.py' ELSE 'cockpit-forms-api' END, NULL, NULL,
          jsonb_build_object('provider', v_provider, 'savedBy', v_by, 'state', v_state, 'last4', right(v_secret, 4)));
  RETURN jsonb_build_object('ok', true, 'provider', v_provider, 'last4', right(v_secret, 4), 'state', v_state);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_forms_key_mark(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_provider text := p->>'provider';
  v_state text := p->>'state';
  v_meta jsonb := CASE WHEN jsonb_typeof(p->'meta') = 'object' THEN p->'meta' ELSE '{}'::jsonb END;
  v_saved timestamptz;
  v_off timestamptz;
  k public.cockpit_forms_keys;
  n public.cockpit_forms_keys;
  v_was boolean;
  v_now boolean;
  v_form text;
  v_noun text;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF v_provider IS NULL OR v_provider NOT IN ('fathom','fathom_webhook','anthropic','deepseek','typeform_kickoff',
                                              'typeform_exit_survey','typeform_pause_request',
                                              'typeform_onboarding','typeform_new_client') THEN
    RAISE EXCEPTION 'Choose fathom, fathom_webhook, anthropic, deepseek, typeform_kickoff, typeform_exit_survey, typeform_pause_request, typeform_onboarding or typeform_new_client.'
      USING ERRCODE = '22023';
  END IF;
  -- A Typeform form's signing key and the noun its notes use (as cockpit_forms_key_put).
  v_form := CASE WHEN v_provider LIKE 'typeform\_%' THEN substr(v_provider, 10) END;
  v_noun := CASE v_form WHEN 'kickoff' THEN 'kickoff' WHEN 'exit_survey' THEN 'termination survey'
                        WHEN 'pause_request' THEN 'pause request' WHEN 'onboarding' THEN 'client onboarding form'
                        WHEN 'new_client' THEN 'New Client Form' END;
  IF v_state IS NULL OR v_state NOT IN ('connected','refused') THEN
    RAISE EXCEPTION 'Choose connected or refused.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_saved := (p->>'savedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    v_saved := NULL;
  END;
  SELECT * INTO k FROM public.cockpit_forms_keys x WHERE x.provider = v_provider FOR UPDATE;
  IF NOT FOUND OR v_saved IS NULL OR k.saved_at IS DISTINCT FROM v_saved THEN
    RETURN jsonb_build_object('ok', false, 'note', 'The key changed during the check');
  END IF;
  UPDATE public.cockpit_forms_keys x
     SET state = v_state, state_note = left(p->>'note', 240), checked_at = now(), meta = x.meta || v_meta
   WHERE x.provider = v_provider
  RETURNING * INTO n;
  IF v_provider = 'fathom_webhook' THEN
    v_was := (public.cockpit_forms_webhook_detail(k.meta, k.saved_at)->>'registered')::boolean;
    v_now := (public.cockpit_forms_webhook_detail(n.meta, n.saved_at)->>'registered')::boolean;
    IF coalesce(jsonb_typeof(v_meta->'unregisteredAt'), 'null') <> 'null' THEN
      BEGIN
        v_off := (v_meta->>'unregisteredAt')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        v_off := now();
      END;
    END IF;
    INSERT INTO public.cockpit_sync_state AS s0 (key, note, detail, updated_at)
    VALUES ('fathom-webhook',
            CASE WHEN v_off IS NOT NULL
                 THEN 'Webhook ending ' || coalesce(right(btrim(n.meta->>'webhookId'), 4), '????') || ' unregistered at '
                      || public.cockpit_form_kuwait_time(v_off) END,
            public.cockpit_forms_webhook_detail(n.meta, n.saved_at), now())
    ON CONFLICT (key) DO UPDATE
       SET note = coalesce(EXCLUDED.note, s0.note), detail = EXCLUDED.detail, updated_at = now();
  ELSIF v_form IS NOT NULL THEN
    -- Registered: a webhook id and no unregisteredAt, as the Fathom webhook.
    -- registeredAt is the registration's own time, so the guardian counts
    -- missed deliveries only from then.
    v_was := (public.cockpit_forms_webhook_detail(k.meta, k.saved_at)->>'registered')::boolean;
    v_now := (public.cockpit_forms_webhook_detail(n.meta, n.saved_at)->>'registered')::boolean;
    INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, detail, updated_at)
    VALUES ('forms-door:' || v_form, now(), now(), true,
            CASE WHEN v_now THEN 'The ' || v_noun || ' webhook is registered.'
                 WHEN v_form = 'kickoff' THEN 'The kickoff webhook is not registered: kickoffs arrive by the 15-minute read.'
                 WHEN v_form = 'onboarding' THEN 'The client onboarding webhook is not registered: answers arrive by the 10-minute onboarding read.'
                 WHEN v_form = 'new_client' THEN 'The New Client Form webhook is not registered: Make still gets every answer; the cockpit does not record them.'
                 ELSE 'The ' || v_noun || ' webhook is not registered: its answers wait in Typeform until it is.' END,
            jsonb_build_object('registered', v_now,
                               'registeredAt', CASE WHEN v_now THEN coalesce(n.meta->'registeredAt', to_jsonb(n.checked_at)) END,
                               'lastDelivery', NULL, 'outcome', NULL), now())
    ON CONFLICT (key) DO UPDATE
       SET note = EXCLUDED.note,
           ok = s0.ok OR NOT v_now,
           last_ok_at = CASE WHEN s0.ok OR v_now THEN s0.last_ok_at ELSE now() END,
           detail = coalesce(s0.detail, '{}'::jsonb)
                    || jsonb_build_object('registered', v_now, 'registeredAt', EXCLUDED.detail->'registeredAt'),
           updated_at = now();
  END IF;
  IF k.state IS DISTINCT FROM n.state OR v_was IS DISTINCT FROM v_now THEN
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('forms.keyState', 'cockpit_forms_keys', v_provider,
            coalesce(nullif(current_setting('cockpit.audit_actor', true), ''), 'server'), 'client-success',
            coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'service'),
            jsonb_build_object('state', k.state, 'registered', v_was), jsonb_build_object('state', n.state, 'registered', v_now),
            jsonb_build_object('provider', v_provider, 'state', n.state, 'note', left(p->>'note', 240)));
  END IF;
  RETURN jsonb_build_object('ok', true, 'provider', v_provider, 'state', n.state);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_forms_key_label(p_provider text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_provider WHEN 'fathom' THEN 'Fathom' WHEN 'fathom_webhook' THEN 'Fathom webhook'
                         WHEN 'anthropic' THEN 'Anthropic' WHEN 'deepseek' THEN 'DeepSeek'
                         WHEN 'typeform_kickoff' THEN 'Typeform kickoff signing key'
                         WHEN 'typeform_exit_survey' THEN 'Termination survey webhook'
                         WHEN 'typeform_pause_request' THEN 'Pause request webhook'
                         WHEN 'typeform_onboarding' THEN 'Client onboarding webhook'
                         WHEN 'typeform_new_client' THEN 'New Client Form webhook' END
$$;

CREATE OR REPLACE FUNCTION public.cockpit_forms_keys_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p text;
  k public.cockpit_forms_keys;
  hook public.cockpit_forms_keys;
  s public.cockpit_sync_state;
  v_keys jsonb := '[]'::jsonb;
  v_registered boolean;
  v_label text;
  v_sentence text;
  tk public.cockpit_forms_keys;
  v_door public.cockpit_sync_state;
  v_form text;
  v_typeform jsonb := '[]'::jsonb;
BEGIN
  IF NOT coalesce(public.cockpit_is_ceo(), false) THEN
    RAISE EXCEPTION 'Only the CEO can see the 1-1 notes connections.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO hook FROM public.cockpit_forms_keys x WHERE x.provider = 'fathom_webhook';
  v_registered := hook.provider IS NOT NULL AND (public.cockpit_forms_webhook_detail(hook.meta, hook.saved_at)->>'registered')::boolean;
  FOREACH p IN ARRAY ARRAY['fathom','fathom_webhook','deepseek','anthropic'] LOOP
    SELECT * INTO k FROM public.cockpit_forms_keys x WHERE x.provider = p;
    v_label := public.cockpit_forms_key_label(p);
    v_sentence := CASE
      WHEN k.provider IS NULL OR (p = 'fathom_webhook' AND NOT v_registered) THEN CASE p
        WHEN 'fathom' THEN 'Not connected: calls come only from the 15-minute read.'
        WHEN 'deepseek' THEN 'Not connected: client notes drafts are off.'
        WHEN 'anthropic' THEN 'Not connected: DEFCON and priority suggestions, the call grade and the recap drafts are off.'
        -- The notes pull on open only with a Fathom key saved (A7.16), as the card says.
        ELSE CASE WHEN EXISTS (SELECT 1 FROM public.cockpit_forms_keys f WHERE f.provider = 'fathom')
                  THEN 'Not registered: calls arrive by the 15-minute read and when the notes open.'
                  ELSE 'Not registered: calls arrive by the 15-minute read.' END END
      WHEN k.state = 'connected' THEN 'Connected.'
      WHEN k.state = 'unchecked' THEN 'Saved, not checked yet.'
      ELSE v_label || ' refused this key. Paste a new one.' END;
    v_keys := v_keys || jsonb_build_array(jsonb_build_object(
      'provider', p,
      'label', v_label,
      'connected', coalesce(k.state = 'connected', false) AND (p <> 'fathom_webhook' OR v_registered),
      'state', coalesce(k.state, 'missing'),
      'last4', k.last4,
      'savedAt', k.saved_at,
      'savedBy', CASE WHEN k.saved_by IS NULL THEN NULL WHEN k.saved_by = 'server' THEN 'the server'
                      ELSE coalesce(public.cockpit_slack_notice_role_of(k.saved_by), 'a team member') END,
      'checkedAt', k.checked_at,
      'sentence', v_sentence));
  END LOOP;
  SELECT * INTO s FROM public.cockpit_sync_state x WHERE x.key = 'fathom-pull';
  -- Each Typeform form's signing key, apart from keys (Z57): kickoff since
  -- 2b, the termination survey and the pause request since waves 1-2, client
  -- onboarding and the New Client Form since waves 3-4.
  FOREACH v_form IN ARRAY ARRAY['kickoff','exit_survey','pause_request','onboarding','new_client'] LOOP
    tk := NULL;
    v_door := NULL;
    SELECT * INTO tk FROM public.cockpit_forms_keys x WHERE x.provider = 'typeform_' || v_form;
    SELECT * INTO v_door FROM public.cockpit_sync_state x WHERE x.key = 'forms-door:' || v_form;
    v_typeform := v_typeform || jsonb_build_array(jsonb_build_object(
      'form', v_form,
      'connected', coalesce(tk.state = 'connected', false),
      'last4', tk.last4,
      'registered', coalesce((public.cockpit_forms_webhook_detail(tk.meta, tk.saved_at)->>'registered')::boolean, false),
      'lastDelivery', v_door.detail->'lastDelivery'));
  END LOOP;
  RETURN jsonb_build_object(
    'keys', v_keys,
    'webhook', jsonb_build_object(
      'registered', coalesce(v_registered, false),
      'triggeredFor', CASE WHEN jsonb_typeof(hook.meta->'triggeredFor') = 'array' THEN hook.meta->'triggeredFor' ELSE '[]'::jsonb END,
      'lastDeliveryAt', (SELECT max(d.last_at) FROM public.cockpit_fathom_webhook_deliveries d WHERE d.outcome IN ('stored','ignored')),
      'stored24h', (SELECT count(*) FROM public.cockpit_fathom_webhook_deliveries d
                     WHERE d.outcome = 'stored' AND d.last_at > now() - interval '24 hours'),
      'ignored24h', (SELECT count(*) FROM public.cockpit_fathom_webhook_deliveries d
                      WHERE d.outcome = 'ignored' AND d.last_at > now() - interval '24 hours'),
      'failed24h', (SELECT count(*) FROM public.cockpit_fathom_webhook_deliveries d
                     WHERE d.outcome = 'failed' AND d.last_at > now() - interval '24 hours')),
    'pull', jsonb_build_object('lastRunAt', s.last_run_at, 'ok', s.ok, 'note', s.note),
    'typeform', v_typeform,
    'now', now());
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_forms_door_seen(p_form_key text, p_outcome text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_at text := public.cockpit_form_kuwait_time(now());
  v_reason text := left(nullif(btrim(p_reason), ''), 240);
  v_fault boolean;
  v_quiet boolean;
  v_note text;
  k public.cockpit_forms_keys;
  v_registered boolean;
  v_noun text;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  -- forms-door's FORM_KEYS: kickoff, the termination survey and the pause request (waves 1-2, 4.4), client onboarding
  -- and the New Client Form (waves 3-4, 4.7 and 4.8).
  v_noun := CASE p_form_key WHEN 'kickoff' THEN 'kickoff' WHEN 'exit_survey' THEN 'termination survey'
                            WHEN 'pause_request' THEN 'pause request' WHEN 'onboarding' THEN 'client onboarding form'
                            WHEN 'new_client' THEN 'New Client Form' END;
  IF v_noun IS NULL THEN
    RAISE EXCEPTION 'Only kickoff, the termination survey, the pause request, client onboarding and the New Client Form have a cockpit webhook.' USING ERRCODE = '22023';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('recorded','repeat','ignored','probe','unsigned','failed') THEN
    RAISE EXCEPTION 'Choose recorded, repeat, ignored, probe, unsigned or failed.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO k FROM public.cockpit_forms_keys x WHERE x.provider = 'typeform_' || p_form_key;
  v_registered := coalesce((public.cockpit_forms_webhook_detail(k.meta, k.saved_at)->>'registered')::boolean, false);
  -- The URL is open, so what anyone can cause without the key says nothing about
  -- the door: an unsigned request, or any request while no key is saved and no
  -- webhook is registered. Those are quiet: recorded, but they neither fail the
  -- job nor clear a real failure. The job fails only when a signed delivery
  -- could not be stored, or a registered webhook has lost its key.
  v_fault := p_outcome = 'failed' AND (v_registered OR v_reason IS DISTINCT FROM 'No signing key saved');
  v_quiet := p_outcome = 'unsigned' OR (p_outcome = 'failed' AND NOT v_fault);
  v_note := CASE
    WHEN p_outcome = 'failed' AND NOT v_fault THEN 'A delivery at ' || v_at || ' could not be checked: no signing key is saved yet.'
    ELSE CASE p_outcome
    WHEN 'recorded' THEN 'A ' || v_noun || ' arrived and was stored at ' || v_at || '.'
    WHEN 'repeat' THEN 'Typeform sent a ' || v_noun || ' again at ' || v_at || '; it was already stored.'
    WHEN 'ignored' THEN 'A signed delivery at ' || v_at || ' was not a ' || v_noun || ' response, so nothing was stored.'
    WHEN 'probe' THEN 'The signed probe reached the door at ' || v_at || '.'
    WHEN 'unsigned' THEN 'A delivery at ' || v_at || ' had no valid signature, so nothing was stored.'
    ELSE 'A ' || v_noun || ' could not be stored at ' || v_at || ': ' || coalesce(v_reason, 'no reason was given.') END
  END;
  INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, detail, updated_at)
  VALUES ('forms-door:' || p_form_key, now(), CASE WHEN NOT v_fault THEN now() END, NOT v_fault, v_note,
          jsonb_build_object('registered', v_registered,
                             'registeredAt', CASE WHEN v_registered THEN coalesce(k.meta->'registeredAt', to_jsonb(coalesce(k.checked_at, k.saved_at))) END,
                             'lastDelivery', now(), 'outcome', p_outcome, 'reason', v_reason), now())
  ON CONFLICT (key) DO UPDATE
     SET last_run_at = now(),
         last_ok_at = CASE WHEN v_fault OR v_quiet THEN s0.last_ok_at ELSE now() END,
         ok = CASE WHEN v_quiet THEN s0.ok ELSE NOT v_fault END,
         note = CASE WHEN v_quiet AND NOT s0.ok THEN s0.note ELSE v_note END,
         detail = coalesce(s0.detail, '{}'::jsonb)
                  || jsonb_build_object('lastDelivery', now(), 'outcome', p_outcome, 'reason', v_reason),
         updated_at = now();
  RETURN jsonb_build_object('ok', true, 'outcome', p_outcome);
END $$;

-- ---------------------------------------------------------------------------
-- 13. The legacy writer (replaced, 2.2): NPS and CSAT by the backfill only, the Typeform-shaped version, and
--     legacy.received when an answer comes through a retired link (V16)

-- The forms door's writer for the client Typeforms that stay live in waves 1
-- and 2 (the termination survey knIe4eF3 and the pause request CTUjv6l3), and
-- the backfill's, which since waves 3-4 also imports the old NPS (fuPgs85S)
-- and onboarding survey (KbcbPA73) answers with no card (V17). One legacy
-- response per Typeform token. The card is the form's hidden
-- onboarding_client_id when it is a card on the billing sheet, else none (NPS
-- and CSAT: never). A new termination survey queues its "Termination notice
-- in" for the CSM; a pause request queues nothing; a backfilled row queues
-- nothing at all. Each row is stamped with the newest version of the form
-- whose schema still lives in Typeform (lives = typeform), else the registry
-- version, so an exit survey after C4b (registry version 2, native) keeps
-- version 1's Typeform shape. A live delivery for a form whose registry row
-- is native (the exit survey after C4b), or a pause request once the pause
-- consent is live, also queues "Old form link used" (legacy.received).
--
-- The Typeform signature proves Typeform delivered the response, not who
-- filled it or which card it is for: the hidden id is in a public link anyone
-- can edit. So a card found that way is kept as hidden_id_unverified in
-- answer_meta, and the survey is never attached to a departure here.
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
  IF v_form IS NULL OR v_form NOT IN ('exit_survey','pause_request','nps','csat') THEN
    RAISE EXCEPTION 'Only the termination survey, the pause request and the old NPS and onboarding surveys are recorded here.'
      USING ERRCODE = '22023';
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
  IF v_form IN ('exit_survey','pause_request') THEN
    v_card := coalesce(nullif(btrim(p->>'taskId'), ''), v_hidden->>'onboarding_client_id');
    IF v_card ~ '^[A-Za-z0-9_-]{1,40}$' THEN
      SELECT a.clickup_task_id, a.client_name INTO v_task, v_client
        FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = v_card;
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
-- 14. The daily schedule (pg_cron). Calls the run directly as the owner; while forms.schedule.on is false it only
--     sweeps and writes form-schedule "The schedule is off."

-- cron:begin
DO $cron$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'No pg_cron here (cron.job is missing), so the client forms schedule was not scheduled.';
    RETURN;
  END IF;
  EXECUTE 'SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname = ''mahara-form-schedule''';
  EXECUTE $q$SELECT cron.schedule('mahara-form-schedule', '0 7 * * *', $job$ select public.cockpit_form_schedule_run(); $job$)$q$;
END
$cron$;
-- cron:end

-- ---------------------------------------------------------------------------
-- 15. Function privileges: revoked from all four roles, then exactly as 2.5 and 3.3 say. The replaced ones keep
--     their live grants (11.2-c).

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'cockpit_form_schedules_audit()', 'cockpit_form_rule_int(jsonb,text)', 'cockpit_form_answer_int(jsonb,text,integer,integer)',
    'cockpit_client_voice_low_max()', 'cockpit_form_schedule_bump(jsonb,text,integer)',
    'cockpit_form_issue_hook_nps(uuid)', 'cockpit_form_issue_hook_csat(uuid)',
    'cockpit_form_voice_queue(text,text,text,text,jsonb,boolean)',
    'cockpit_form_voice_notices(public.cockpit_form_responses,text,integer,integer,integer,text)',
    'cockpit_form_hook_nps(uuid)', 'cockpit_form_hook_csat(uuid)',
    'cockpit_form_schedule_run(timestamptz,boolean)',
    'cockpit_client_voice_nps(date,date)', 'cockpit_client_voice_invite_row(public.cockpit_form_invites)',
    'cockpit_client_voice_read(text)', 'cockpit_client_voice_today()', 'cockpit_client_voice_summary(date,date)',
    'portal_feedback_record(text,text,text,jsonb)', 'cockpit_form_record_make(jsonb)', 'portal_form_status(text,text,text)',
    'cockpit_forms_key_put(jsonb)', 'cockpit_forms_key_mark(jsonb)', 'cockpit_forms_key_label(text)',
    'cockpit_forms_keys_status()', 'cockpit_forms_door_seen(text,text,text)', 'cockpit_form_record_legacy(jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.cockpit_client_voice_read(text), public.cockpit_client_voice_today(),
  public.cockpit_client_voice_summary(date,date), public.cockpit_forms_keys_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_form_schedule_run(timestamptz,boolean), public.portal_feedback_record(text,text,text,jsonb),
  public.cockpit_form_record_make(jsonb), public.portal_form_status(text,text,text),
  public.cockpit_forms_key_put(jsonb), public.cockpit_forms_key_mark(jsonb), public.cockpit_forms_door_seen(text,text,text),
  public.cockpit_form_record_legacy(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
