-- The money rails, waves 5 and 6 (docs/forms/WAVE56-CONTRACT.md 2.1 to 2.3,
-- 3.3 g, 3.4, 3.5, 3.9, 3.10, 4.1, 4.4 to 4.6). Creative Triage
-- (bldgtotkfmhoxmlzowdx). Additive; applies twice. The first file of the
-- waves 5-6 block (20261102g to 20261102j); h, i and j insert the events and
-- notices this file defines.
--
-- 1. Three notice kinds (3.9): win.logged and client.reactivated to
--    #csm-announcements, receipt.in to #csm-general, each seeded off, in the
--    eleven notice functions that know kinds, with a live rule each.
-- 2. Billing kinds win (a card comment only) and reactivate (Client Status
--    back, the churn and pause fields cleared, the date), the date comment of
--    a confirm, the two system MRR categories in words, and the canary for
--    ltv, win, reactivate and date on the test card.
-- 3. One LTV writer (E10, 4.4): cockpit_ltv_plan is ltv.preview's rule over
--    checked money only; the morning run writes billing kind ltv while
--    billing.ltv is on, holds a jump over maxDeltaUsd for the CEO
--    (cockpit_ltv_held, cockpit_ltv_release), and the CEO and finance read it.
-- 4. Confirm paid moves the next payment date (4.6): the part due on the
--    card's date moves it to the next later part, or a month on a monthly
--    plan, one date write per save; its withdraw moves it back while the card
--    still shows the moved date. Off until billing.confirm_date.on.
-- 5. The billing agent's own login (AG, 3.4): keys kept as sha256 only, every
--    call one row, 60 calls a minute, a repeated request answered with the
--    first result, and two service-only door functions; no key exists here,
--    so the door refuses everything until D-AG puts one.
-- 6. cockpit_form_doors gains wins, receipts, reactivate, kickoff, agent and
--    ltv, each with why (missing or off).
--
-- Nothing here writes ClickUp, posts to Slack or reaches a client: every
-- writer is dark (billing.ltv and billing.confirm_date off, the notice rows
-- off, the door markers false, no agent key). Settings seeds merge with the
-- existing keys winning, so a second apply never switches a door back off.
-- Every function is SECURITY DEFINER with an empty search path, revoked from
-- all four roles, then granted as 2.2 and 3.3 say.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard (2.1): each replaced body is the one the contract read
--    (the live md5, 2.2) or this file's own (a second apply).

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_slack_notice_shape(text)', '65bee7a75bc943031bf3d71beaf9bd7c', '79a47d2467936175cac4f70fd69a1f42'),
      ('public.cockpit_slack_notice_kind_label(text)', '75d4d7515419d0a968d092b44d416dbb', '3814a1a495f8d3a8352bc79d523ff943'),
      ('public.cockpit_slack_notice_live(public.cockpit_slack_notices)', 'eecd54cfe2ea8411174d16cb479ad261', 'd2805faa43de1f095f941fe4513941ae'),
      ('public.cockpit_slack_notice_inputs(jsonb)', 'd665b505014dc61c4d71ff59126dc90e', '919c29bbf9911450b2005375122d5ba9'),
      ('public.cockpit_slack_notice_doctor_inputs()', 'a7c6a68324e3d601156e0f13f5f9e513', 'f16f990536120d5a2f391cc398b3f44a'),
      ('public.cockpit_slack_notice_settings_read()', '29bb5362cd8426cec51ff24fb6178c58', 'ee462686482bf46b3ebfe05900b729ac'),
      ('public.cockpit_slack_notice_settings_set(text,jsonb)', '60751ee78283238fc89d33bb76b050df', '784cde1ae7819dd46a15e9a695623b67'),
      ('public.cockpit_slack_channel_remove(text)', 'f9e0c0f36bd2d8450e90e8aece898926', 'd02c8362144fe0b8c2029108558f7256'),
      ('public.cockpit_slack_notice_rehearse(text)', '2ea83a6770947fce31d587f214d16817', '0c278023edeae28729cb209dd466c27f'),
      ('public.cockpit_slack_notice_rehearse_service(text,text)', '044ba3be2c44da6d6ebe8fa73f20d5d8', 'f3fc3ea803a89918850fa96b2dfc09ea'),
      ('public.cockpit_slack_notice_read(text)', '56e3035431a069a6f4d2f74b3425a267', '9fb46adcbbcbe599b2dfdcc93f29a639'),
      ('public.cockpit_billing_writeback_writes(text,text,text,jsonb)', '547e7750bfaf4473c50365bcbdcf8dac', '27abd8e1c88a7e06a2773d4753dbbc6b'),
      ('public.cockpit_billing_writeback_comment(text,text,text,jsonb,text)', '850a7430b7b8cfc62a170ecccf127d63', '3f84c6e1fb7fcc3cc19bc7fe35887692'),
      ('public.cockpit_billing_detail(text,jsonb)', '6b483cc5047953d545123e00cb87cb07', 'cdd2a451965794db25e7330c789420fe'),
      ('public.cockpit_billing_canary(text,jsonb)', '066b53ffb9b4a8be423ee464e4d897c5', 'c73b594b4589bf2b17f3b55e30025333'),
      ('public.cockpit_billing_daily_run(date)', '1c4087aa6bd3fda9ef35a5b8360fc38c', 'd537a02fb8c11f5d688bbfc7ee1a85ad'),
      ('public.cockpit_billing_balance_write(text,jsonb)', 'fb245e7e7c292a68f07b91e8cb2aaa79', '37f45147c089f984c9e31e75d4611741'),
      ('public.cockpit_billing_balances_read()', 'cfd508625131949f69ca153ef457e2d3', '840d9bf5540a31db6a74c34dc88a979b'),
      ('public.cockpit_form_doors()', '2991d3cbadd1003f4f85d0a91de10af2', '87a1f657c81293fb45211720f4285535')
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

-- What this file stands on, read but not replaced (W12, W34): the billing
-- rails' queue and voids, checked money, the confirmations, the form doors'
-- base, the forms refuse-delete trigger and the billing notice helper.
DO $$
BEGIN
  IF to_regclass('public.cockpit_billing_event_voids') IS NULL
     OR to_regclass('public.cockpit_billing_confirmations') IS NULL
     OR to_regclass('public.cockpit_clickup_writeback_queue') IS NULL
     OR to_regclass('public.cockpit_form_invites') IS NULL
     OR to_regprocedure('public.cockpit_billing_writeback_enqueue()') IS NULL
     OR to_regprocedure('public.cockpit_billing_ladder_settings()') IS NULL
     OR to_regprocedure('public.cockpit_billing_day(text)') IS NULL
     OR to_regprocedure('public.cockpit_billing_day_words(date)') IS NULL
     OR to_regprocedure('public.cockpit_forms_refuse_delete()') IS NULL
     OR to_regprocedure('public.cockpit_manual_clean_text(text,integer)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261101l to 20261101r and 20261102a to 20261102f before 20261102g.' USING ERRCODE = '55000';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. CHECKs, each widened only from the definition the contract read (11.2-f)
--    or already widened; any other definition stops the file.

DO $$
DECLARE v_def text;
BEGIN
  -- The settings' kinds.
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_slack_notice_settings'::regclass AND c.conname = 'cockpit_slack_notice_settings_kind_check';
  IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''kickoff''::text, ''kickoff.late''::text, ''kickoff.second''::text, ''kickoff.updated''::text, ''blueprint.close''::text, ''blueprint.updated''::text, ''blueprint.media''::text, ''blueprint.offer''::text, ''checkin.grade''::text, ''checkin.recap_late''::text, ''termination.notice''::text, ''termination.submitted''::text, ''churn.confirmed''::text, ''extension.granted''::text, ''pause.agreed''::text, ''client.resumed''::text, ''pause.consent''::text, ''nps.received''::text, ''csat.received''::text, ''voice.low''::text, ''feedback.received''::text, ''legacy.received''::text, ''win.logged''::text, ''receipt.in''::text, ''client.reactivated''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''kickoff''::text, ''kickoff.late''::text, ''kickoff.second''::text, ''kickoff.updated''::text, ''blueprint.close''::text, ''blueprint.updated''::text, ''blueprint.media''::text, ''blueprint.offer''::text, ''checkin.grade''::text, ''checkin.recap_late''::text, ''termination.notice''::text, ''termination.submitted''::text, ''churn.confirmed''::text, ''extension.granted''::text, ''pause.agreed''::text, ''client.resumed''::text, ''pause.consent''::text, ''nps.received''::text, ''csat.received''::text, ''voice.low''::text, ''feedback.received''::text, ''legacy.received''::text])))' THEN
      RAISE EXCEPTION 'cockpit_slack_notice_settings_kind_check changed since the waves 5-6 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_slack_notice_settings DROP CONSTRAINT cockpit_slack_notice_settings_kind_check;
    ALTER TABLE public.cockpit_slack_notice_settings ADD CONSTRAINT cockpit_slack_notice_settings_kind_check
      CHECK (kind IN ('kickoff','kickoff.late','kickoff.second','kickoff.updated',
                      'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer',
                      'checkin.grade','checkin.recap_late',
                      'termination.notice','termination.submitted','churn.confirmed',
                      'extension.granted','pause.agreed','client.resumed',
                      'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received',
                      'win.logged','receipt.in','client.reactivated'));
  END IF;

  -- The kinds that name a channel: the three new ones post top level.
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_slack_notice_settings'::regclass AND c.conname = 'cockpit_slack_notice_settings_check';
  IF v_def IS DISTINCT FROM 'CHECK (((kind = ANY (ARRAY[''kickoff''::text, ''blueprint.close''::text, ''blueprint.media''::text, ''checkin.grade''::text, ''checkin.recap_late''::text, ''termination.notice''::text, ''termination.submitted''::text, ''churn.confirmed''::text, ''extension.granted''::text, ''pause.agreed''::text, ''client.resumed''::text, ''pause.consent''::text, ''nps.received''::text, ''csat.received''::text, ''voice.low''::text, ''feedback.received''::text, ''legacy.received''::text, ''win.logged''::text, ''receipt.in''::text, ''client.reactivated''::text])) = (channel IS NOT NULL)))' THEN
    IF v_def IS DISTINCT FROM 'CHECK (((kind = ANY (ARRAY[''kickoff''::text, ''blueprint.close''::text, ''blueprint.media''::text, ''checkin.grade''::text, ''checkin.recap_late''::text, ''termination.notice''::text, ''termination.submitted''::text, ''churn.confirmed''::text, ''extension.granted''::text, ''pause.agreed''::text, ''client.resumed''::text, ''pause.consent''::text, ''nps.received''::text, ''csat.received''::text, ''voice.low''::text, ''feedback.received''::text, ''legacy.received''::text])) = (channel IS NOT NULL)))' THEN
      RAISE EXCEPTION 'cockpit_slack_notice_settings_check changed since the waves 5-6 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_slack_notice_settings DROP CONSTRAINT cockpit_slack_notice_settings_check;
    ALTER TABLE public.cockpit_slack_notice_settings ADD CONSTRAINT cockpit_slack_notice_settings_check
      CHECK ((kind IN ('kickoff','blueprint.close','blueprint.media','checkin.grade','checkin.recap_late',
                       'termination.notice','termination.submitted','churn.confirmed',
                       'extension.granted','pause.agreed','client.resumed',
                       'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received',
                       'win.logged','receipt.in','client.reactivated'))
             = (channel IS NOT NULL));
  END IF;

  -- The outbox's kinds.
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_slack_notices'::regclass AND c.conname = 'cockpit_slack_notices_kind_check';
  IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''kickoff''::text, ''kickoff.updated''::text, ''blueprint.close''::text, ''blueprint.updated''::text, ''blueprint.media''::text, ''blueprint.offer''::text, ''rehearsal''::text, ''checkin.grade''::text, ''checkin.recap_late''::text, ''termination.notice''::text, ''termination.submitted''::text, ''churn.confirmed''::text, ''extension.granted''::text, ''pause.agreed''::text, ''client.resumed''::text, ''pause.consent''::text, ''nps.received''::text, ''csat.received''::text, ''voice.low''::text, ''feedback.received''::text, ''legacy.received''::text, ''win.logged''::text, ''receipt.in''::text, ''client.reactivated''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''kickoff''::text, ''kickoff.updated''::text, ''blueprint.close''::text, ''blueprint.updated''::text, ''blueprint.media''::text, ''blueprint.offer''::text, ''rehearsal''::text, ''checkin.grade''::text, ''checkin.recap_late''::text, ''termination.notice''::text, ''termination.submitted''::text, ''churn.confirmed''::text, ''extension.granted''::text, ''pause.agreed''::text, ''client.resumed''::text, ''pause.consent''::text, ''nps.received''::text, ''csat.received''::text, ''voice.low''::text, ''feedback.received''::text, ''legacy.received''::text])))' THEN
      RAISE EXCEPTION 'cockpit_slack_notices_kind_check changed since the waves 5-6 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_slack_notices DROP CONSTRAINT cockpit_slack_notices_kind_check;
    ALTER TABLE public.cockpit_slack_notices ADD CONSTRAINT cockpit_slack_notices_kind_check
      CHECK (kind IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated',
                      'blueprint.media','blueprint.offer','rehearsal','checkin.grade','checkin.recap_late',
                      'termination.notice','termination.submitted','churn.confirmed',
                      'extension.granted','pause.agreed','client.resumed',
                      'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received',
                      'win.logged','receipt.in','client.reactivated'));
  END IF;

  -- The billing events' kinds: win and reactivate (3.5).
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_billing_events'::regclass AND c.conname = 'cockpit_billing_events_kind_check';
  IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''amount''::text, ''assign''::text, ''chase''::text, ''churn''::text, ''confirm''::text, ''date''::text, ''exclude''::text, ''extension''::text, ''invoice''::text, ''late''::text, ''link''::text, ''ltv''::text, ''method''::text, ''mrr''::text, ''note''::text, ''pause''::text, ''payment''::text, ''plan''::text, ''resume''::text, ''unconfirm''::text, ''unexclude''::text, ''unlink''::text, ''survey''::text, ''nps_sent''::text, ''win''::text, ''reactivate''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''amount''::text, ''assign''::text, ''chase''::text, ''churn''::text, ''confirm''::text, ''date''::text, ''exclude''::text, ''extension''::text, ''invoice''::text, ''late''::text, ''link''::text, ''ltv''::text, ''method''::text, ''mrr''::text, ''note''::text, ''pause''::text, ''payment''::text, ''plan''::text, ''resume''::text, ''unconfirm''::text, ''unexclude''::text, ''unlink''::text, ''survey''::text, ''nps_sent''::text])))' THEN
      RAISE EXCEPTION 'cockpit_billing_events_kind_check changed since the waves 5-6 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_billing_events DROP CONSTRAINT cockpit_billing_events_kind_check;
    ALTER TABLE public.cockpit_billing_events ADD CONSTRAINT cockpit_billing_events_kind_check CHECK (kind IN (
      'amount','assign','chase','churn','confirm','date','exclude','extension','invoice','late','link','ltv','method','mrr',
      'note','pause','payment','plan','resume','unconfirm','unexclude','unlink','survey','nps_sent','win','reactivate'));
  END IF;
END $$;

-- The write-back trigger's WHEN (2.3): a seat's win and reactivate are queued;
-- the agent's (maher) never are, and a system pause still never is.
DROP TRIGGER IF EXISTS cockpit_billing_events_clickup_writeback ON public.cockpit_billing_events;
CREATE TRIGGER cockpit_billing_events_clickup_writeback AFTER INSERT ON public.cockpit_billing_events
 FOR EACH ROW WHEN ((NEW.source IN ('ceo','csm') AND NEW.kind IN ('method','plan','amount','date','extension','pause','resume','payment','note','churn','mrr','win','reactivate'))
                 OR (NEW.source = 'system' AND NEW.kind IN ('extension','ltv','late','survey','nps_sent')))
 EXECUTE FUNCTION public.cockpit_billing_writeback_enqueue();

-- ---------------------------------------------------------------------------
-- 2. Settings: merged, the existing keys winning (2.1), so a second apply
--    after a go-live never switches anything back off.

SELECT set_config('cockpit.audit_actor', 'migration 20261102g', true);
INSERT INTO public.cockpit_settings (key, value, updated_by)
VALUES ('billing.ltv', '{"on":false,"maxDeltaUsd":5000}'::jsonb, 'migration 20261102g')
ON CONFLICT (key) DO UPDATE SET value = excluded.value || public.cockpit_settings.value,
  updated_by = 'migration 20261102g', updated_at = now()
WHERE NOT (public.cockpit_settings.value ?& array['on','maxDeltaUsd']);
INSERT INTO public.cockpit_settings (key, value, updated_by)
VALUES ('billing.confirm_date', '{"on":false,"windowDays":7}'::jsonb, 'migration 20261102g')
ON CONFLICT (key) DO UPDATE SET value = excluded.value || public.cockpit_settings.value,
  updated_by = 'migration 20261102g', updated_at = now()
WHERE NOT (public.cockpit_settings.value ?& array['on','windowDays']);
-- Written by D-AG (4.5): whether the agent's runtime can still read a Supabase key.
INSERT INTO public.cockpit_settings (key, value, updated_by)
VALUES ('billing.agent', '{"separated":false}'::jsonb, 'migration 20261102g')
ON CONFLICT (key) DO UPDATE SET value = excluded.value || public.cockpit_settings.value,
  updated_by = 'migration 20261102g', updated_at = now()
WHERE NOT (public.cockpit_settings.value ?& array['separated']);
INSERT INTO public.cockpit_settings (key, value, updated_by)
VALUES ('forms.doors', '{"agent":false,"ltv":false,"wins":false,"receipts":false,"reactivate":false}'::jsonb, 'migration 20261102g')
ON CONFLICT (key) DO UPDATE SET value = excluded.value || public.cockpit_settings.value,
  updated_by = 'migration 20261102g', updated_at = now()
WHERE NOT (public.cockpit_settings.value ?& array['agent','ltv','wins','receipts','reactivate']);
SELECT set_config('cockpit.audit_actor', '', true);

-- The three notice rows, off (1.4): Win logged turns on at D-W, Receipt in at
-- D-BR, Client is back at D-RA.
DO $$
DECLARE s record;
BEGIN
  FOR s IN
    INSERT INTO public.cockpit_slack_notice_settings (kind, enabled, channel, mention_rule, updated_by) VALUES
      ('win.logged', false, 'C09SNG5BP53', '{}'::text[], 'migration'),
      ('receipt.in', false, 'C09RZ0GS0V9', '{}'::text[], 'migration'),
      ('client.reactivated', false, 'C09SNG5BP53', '{}'::text[], 'migration')
    ON CONFLICT (kind) DO NOTHING
    RETURNING kind, enabled, channel
  LOOP
    INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('notices.setting_seeded', 'cockpit_slack_notice_settings', s.kind, 'migration', 'client-success', 'supabase', NULL,
            jsonb_build_object('kind', s.kind, 'enabled', s.enabled, 'channel', s.channel), jsonb_build_object('op', 'insert'));
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Tables (2.3): the held LTV jumps, the agent's keys and its calls.

-- An audit row per write; a key's hash is never copied, a call's detail holds no secret.
CREATE OR REPLACE FUNCTION public.cockpit_money_rails_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old jsonb; v_new jsonb; v_actor text;
BEGIN
  IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD) - 'key_sha256'; END IF;
  v_new := to_jsonb(NEW) - 'key_sha256';
  v_actor := nullif(current_setting('cockpit.audit_actor', true), '');
  IF v_actor IS NULL AND auth.uid() IS NOT NULL THEN
    SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
  END IF;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, v_new->>'id', coalesce(v_actor, 'the cockpit'),
          'client-success', 'supabase', v_old, v_new, jsonb_build_object('op', TG_OP));
  RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS public.cockpit_ltv_held (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id        text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  target         numeric NOT NULL,
  card           numeric,
  delta          numeric NOT NULL,
  first_held_on  date NOT NULL,
  released_by    text,
  released_at    timestamptz,
  CHECK ((released_by IS NULL) = (released_at IS NULL))
);
-- One open hold per card; a released row is kept, so a card can be held again later.
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_ltv_held_one_open ON public.cockpit_ltv_held (task_id) WHERE released_at IS NULL;
ALTER TABLE public.cockpit_ltv_held ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_ltv_held FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_ltv_held TO service_role;
DROP TRIGGER IF EXISTS cockpit_ltv_held_audit ON public.cockpit_ltv_held;
CREATE TRIGGER cockpit_ltv_held_audit AFTER INSERT OR UPDATE ON public.cockpit_ltv_held
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_money_rails_audit();

CREATE TABLE IF NOT EXISTS public.cockpit_agent_keys (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent           text NOT NULL CHECK (agent IN ('billing_agent')),
  key_sha256      text NOT NULL UNIQUE CHECK (key_sha256 ~ '^[0-9a-f]{64}$'),
  note            text CHECK (note IS NULL OR char_length(note) <= 200),
  added_by        text NOT NULL,
  added_at        timestamptz NOT NULL DEFAULT now(),
  revoked_by      text,
  revoked_at      timestamptz,
  revoked_reason  text CHECK (revoked_reason IS NULL OR char_length(revoked_reason) BETWEEN 3 AND 300),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_agent_keys_one_live ON public.cockpit_agent_keys (agent) WHERE revoked_at IS NULL;
ALTER TABLE public.cockpit_agent_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_agent_keys FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_agent_keys TO service_role;
DROP TRIGGER IF EXISTS cockpit_agent_keys_audit ON public.cockpit_agent_keys;
CREATE TRIGGER cockpit_agent_keys_audit AFTER INSERT OR UPDATE ON public.cockpit_agent_keys
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_money_rails_audit();

CREATE TABLE IF NOT EXISTS public.cockpit_agent_calls (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key_id      bigint NOT NULL REFERENCES public.cockpit_agent_keys(id),
  at          timestamptz NOT NULL DEFAULT now(),
  op          text NOT NULL CHECK (op ~ '^[a-z][a-z_.:]{0,40}$'),
  request_id  uuid,
  outcome     text NOT NULL CHECK (outcome IN ('ok','refused','limited','duplicate')),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object' AND octet_length(detail::text) <= 2048)
);
-- The first call of a request id only; a repeat is a duplicate row with request_id NULL.
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_agent_calls_first ON public.cockpit_agent_calls (key_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cockpit_agent_calls_key_at ON public.cockpit_agent_calls (key_id, at);
ALTER TABLE public.cockpit_agent_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_agent_calls FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.cockpit_agent_calls TO service_role;
DROP TRIGGER IF EXISTS cockpit_agent_calls_audit ON public.cockpit_agent_calls;
CREATE TRIGGER cockpit_agent_calls_audit AFTER INSERT ON public.cockpit_agent_calls
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_money_rails_audit();

-- No delete (per row) and no truncate (per statement) on agent keys and agent calls.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_agent_keys','cockpit_agent_calls'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_forms_no_delete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_forms_no_delete BEFORE DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_refuse_delete()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_forms_no_truncate ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_forms_no_truncate BEFORE TRUNCATE ON public.%I '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_forms_refuse_delete()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. One LTV writer (E10, 4.4)

-- The ltv.preview guards (20260927h:110-114) as one refusal for the whole
-- run, and checked money's own (4.4.1): a tied payment without its check
-- state refuses the run instead of being counted or skipped. NULL: none.
CREATE OR REPLACE FUNCTION public.cockpit_ltv_refusal()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_manual_payment_state WHERE history_ready AND revision = totals_revision) THEN
    RETURN 'Finance totals need reconciliation before updating lifetime value.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_sections WHERE key = 'money' AND ok AND computed_at > now() - interval '24 hours'
                    AND jsonb_typeof(payload #> '{attribution,transactions}') = 'array') THEN
    RETURN 'Money attribution is missing or stale; refresh it before lifetime value.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_client_billing_days WHERE captured_at > now() - interval '24 hours') THEN
    RETURN 'Client billing source is missing or stale.';
  END IF;
  IF EXISTS (SELECT 1 FROM (SELECT DISTINCT ON (clickup_task_id) * FROM public.cockpit_client_billing_days ORDER BY clickup_task_id, day DESC) c
              WHERE captured_at < now() - interval '24 hours'
                AND (stage NOT IN ('Paused','Stopped','CANCELLED ONBOARDING','SALES TEAM TO CONTACT') OR stage IS NULL)
                AND client_name !~* 'playing account|\[internal test\]') THEN
    RETURN 'Some active client billing rows are stale; refresh before lifetime value.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_metric_days WHERE metric = 'money.ltv.card' AND value::text IN ('NaN','Infinity','-Infinity')) THEN
    RETURN 'Lifetime value baseline is invalid.';
  END IF;
  IF EXISTS (
    WITH cards AS (SELECT DISTINCT ON (clickup_task_id) * FROM public.cockpit_client_billing_days ORDER BY clickup_task_id, day DESC),
    base AS (SELECT DISTINCT ON (scope) scope, day FROM public.cockpit_metric_days WHERE metric = 'money.ltv.card' ORDER BY scope, day)
    SELECT 1
      FROM cards c
      JOIN base b ON b.scope = 'client:' || c.clickup_task_id
      CROSS JOIN public.cockpit_sections s
      CROSS JOIN LATERAL jsonb_array_elements(s.payload #> '{attribution,transactions}') t
     WHERE s.key = 'money' AND t->>'direction' = 'in' AND t->>'clientTaskId' = c.clickup_task_id
       AND (t->>'day')::date >= b.day AND NOT (t ? 'checked')
       AND (c.stage NOT IN ('Paused','Stopped','CANCELLED ONBOARDING','SALES TEAM TO CONTACT') OR c.stage IS NULL)
       AND c.client_name !~* 'playing account|\[internal test\]') THEN
    RETURN 'The money section has payments without their check state; refresh Money before LTV is written.';
  END IF;
  RETURN NULL;
END $$;

-- The plan (4.4.1): ltv.preview's cards, baseline and tied sum, with the one
-- change that only checked money counts. While the run is refused every
-- card in scope reads missing with the refusal as its why.
CREATE OR REPLACE FUNCTION public.cockpit_ltv_plan(p_today date)
RETURNS TABLE (task_id text, client_name text, stage text, baseline numeric, baseline_day date, checked_usd numeric,
               rows integer, target numeric, card numeric, delta numeric, state text, why text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE v_refusal text := public.cockpit_ltv_refusal(); v_max numeric; v_set jsonb;
BEGIN
  SELECT s.value INTO v_set FROM public.cockpit_settings s WHERE s.key = 'billing.ltv';
  v_max := CASE WHEN v_set->>'maxDeltaUsd' ~ '^[0-9]+(\.[0-9]+)?$' THEN (v_set->>'maxDeltaUsd')::numeric ELSE 5000 END;
  RETURN QUERY
  WITH cards AS (SELECT DISTINCT ON (d.clickup_task_id) d.* FROM public.cockpit_client_billing_days d ORDER BY d.clickup_task_id, d.day DESC),
  base AS (SELECT DISTINCT ON (m.scope) m.scope, m.day, m.value FROM public.cockpit_metric_days m WHERE m.metric = 'money.ltv.card' ORDER BY m.scope, m.day),
  scoped AS (
    SELECT c.clickup_task_id, c.client_name, c.stage, c.ltv_usd, b.day AS base_day, b.value::numeric AS base_value,
           coalesce((c.stage NOT IN ('Paused','Stopped','CANCELLED ONBOARDING','SALES TEAM TO CONTACT') OR c.stage IS NULL)
                    AND c.client_name !~* 'playing account|\[internal test\]', false) AS eligible
      FROM cards c LEFT JOIN base b ON b.scope = 'client:' || c.clickup_task_id),
  summed AS (
    SELECT x.*, p.usd AS sum_usd, coalesce(p.n, 0)::integer AS n
      FROM scoped x
      LEFT JOIN LATERAL (
        SELECT sum((t->>'usd')::numeric) AS usd, count(*) AS n
          FROM public.cockpit_sections s
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.payload #> '{attribution,transactions}') = 'array'
                                                       THEN s.payload #> '{attribution,transactions}' ELSE '[]'::jsonb END) t
         WHERE v_refusal IS NULL AND x.eligible AND x.base_day IS NOT NULL
           AND s.key = 'money' AND t->>'direction' = 'in' AND t->>'clientTaskId' = x.clickup_task_id
           AND (t->>'day')::date >= x.base_day
           AND (CASE WHEN t->>'checked' IN ('true','false') THEN (t->>'checked')::boolean END) IS TRUE) p ON true),
  priced AS (
    SELECT y.*,
           CASE WHEN v_refusal IS NULL AND y.eligible AND y.base_day IS NOT NULL THEN round(coalesce(y.sum_usd, 0), 2) END AS checked,
           CASE WHEN v_refusal IS NULL AND y.eligible AND y.base_day IS NOT NULL THEN round(y.base_value + coalesce(y.sum_usd, 0), 2) END AS goal
      FROM summed y)
  SELECT z.clickup_task_id, z.client_name, z.stage, round(z.base_value, 2), z.base_day, z.checked,
         CASE WHEN z.checked IS NULL THEN NULL ELSE z.n END,
         z.goal, z.ltv_usd, round(z.goal - z.ltv_usd, 2),
         CASE WHEN NOT z.eligible THEN 'out_of_scope'
              WHEN v_refusal IS NOT NULL OR z.base_day IS NULL OR z.ltv_usd IS NULL THEN 'missing'
              WHEN abs(z.goal - z.ltv_usd) < 0.01 THEN 'same'
              WHEN abs(z.goal - z.ltv_usd) > v_max THEN 'held'
              ELSE 'write' END,
         CASE WHEN NOT z.eligible THEN 'Paused, stopped, cancelled, back with sales or internal.'
              WHEN v_refusal IS NOT NULL THEN v_refusal
              WHEN z.base_day IS NULL THEN 'No starting value on record for this card.'
              WHEN z.ltv_usd IS NULL THEN 'The card''s lifetime value field is empty.'
              WHEN abs(z.goal - z.ltv_usd) > v_max
                THEN format('Over the $%s cap: waits for the CEO.', to_char(v_max, 'FM999,999,990')) END
    FROM priced z
   ORDER BY z.client_name, z.clickup_task_id;
END $$;

-- A card already on its way: an undelivered ltv item, or an ltv event for this
-- target written after the mirror's last read of the card (so a second run the
-- same day, before the mirror catches up, writes nothing again).
CREATE OR REPLACE FUNCTION public.cockpit_ltv_on_its_way(p_task_id text, p_target numeric)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.cockpit_clickup_writeback_queue q
                  WHERE q.kind = 'billing' AND q.task_id = p_task_id AND q.payload->>'kind' = 'ltv'
                    AND q.state NOT IN ('delivered','skipped','failed'))
      OR EXISTS (SELECT 1 FROM public.cockpit_billing_events e
                  WHERE e.clickup_task_id = p_task_id AND e.kind = 'ltv'
                    AND e.to_value ~ '^-?[0-9]+(\.[0-9]+)?$' AND e.to_value::numeric = p_target
                    AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id)
                    AND e.at >= coalesce((SELECT max(d.captured_at) FROM public.cockpit_client_billing_days d
                                           WHERE d.clickup_task_id = p_task_id), '-infinity'::timestamptz))
$$;

-- One ltv billing event (source system); the write-back trigger queues it.
CREATE OR REPLACE FUNCTION public.cockpit_ltv_event(p_row jsonb, p_released_by text, p_note text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id bigint; v_as_of date;
BEGIN
  SELECT (s.computed_at AT TIME ZONE 'Asia/Kuwait')::date INTO v_as_of FROM public.cockpit_sections s WHERE s.key = 'money';
  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (p_row->>'task_id', p_row->>'client_name', 'ltv', trim_scale((p_row->>'card')::numeric)::text,
          trim_scale((p_row->>'target')::numeric)::text,
          'Lifetime value: the starting value plus checked payments since',
          public.cockpit_billing_detail('ltv', jsonb_build_object(
            'seatRole', 'system', 'sum', p_row->'checked_usd', 'rows', p_row->'rows', 'asOf', v_as_of::text,
            'baseline', p_row->'baseline', 'baselineDay', p_row->>'baseline_day', 'checkedUsd', p_row->'checked_usd',
            'releasedBy', p_released_by, 'note', p_note)),
          'system', 'the cockpit')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- The morning step (4.4.2), called by cockpit_billing_daily_run after the late records.
CREATE OR REPLACE FUNCTION public.cockpit_ltv_daily_step(p_today date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_set jsonb; v_refusal text; p record;
  v_written integer := 0; v_held integer := 0; v_missing integer := 0; v_waiting integer := 0;
  v_note text; v_out jsonb;
BEGIN
  SELECT s.value INTO v_set FROM public.cockpit_settings s WHERE s.key = 'billing.ltv';
  IF NOT coalesce(v_set->'on' = 'true'::jsonb, false) THEN
    RETURN jsonb_build_object('ran', false, 'why', 'billing.ltv is off');
  END IF;
  v_refusal := public.cockpit_ltv_refusal();
  IF v_refusal IS NOT NULL THEN
    v_out := jsonb_build_object('ran', false, 'refused', v_refusal, 'note', 'LTV: not written. ' || v_refusal);
  ELSE
    FOR p IN SELECT * FROM public.cockpit_ltv_plan(p_today) LOOP
      IF p.state = 'missing' THEN
        v_missing := v_missing + 1;
      ELSIF p.state IN ('write', 'held') AND public.cockpit_ltv_on_its_way(p.task_id, p.target) THEN
        v_waiting := v_waiting + 1;
      ELSIF p.state = 'write' THEN
        UPDATE public.cockpit_ltv_held SET released_by = 'the cockpit: back within the cap', released_at = now()
         WHERE task_id = p.task_id AND released_at IS NULL;
        PERFORM public.cockpit_ltv_event(to_jsonb(p), NULL, NULL);
        v_written := v_written + 1;
      ELSIF p.state = 'held' THEN
        INSERT INTO public.cockpit_ltv_held(task_id, target, card, delta, first_held_on)
        VALUES (p.task_id, p.target, p.card, p.delta, p_today)
        ON CONFLICT (task_id) WHERE released_at IS NULL
        DO UPDATE SET target = EXCLUDED.target, card = EXCLUDED.card, delta = EXCLUDED.delta
        WHERE (public.cockpit_ltv_held.target, public.cockpit_ltv_held.card, public.cockpit_ltv_held.delta)
              IS DISTINCT FROM (EXCLUDED.target, EXCLUDED.card, EXCLUDED.delta);
        v_held := v_held + 1;
      ELSIF p.state = 'same' THEN
        UPDATE public.cockpit_ltv_held SET released_by = 'the cockpit: the card already shows it', released_at = now()
         WHERE task_id = p.task_id AND released_at IS NULL;
      END IF;
    END LOOP;
    v_note := format('LTV: %s written, %s held for the CEO, %s missing a baseline.', v_written, v_held, v_missing);
    IF v_waiting > 0 THEN
      v_note := v_note || format(' %s waiting on a write already on its way.', v_waiting);
    END IF;
    v_out := jsonb_build_object('ran', true, 'written', v_written, 'held', v_held, 'missing', v_missing,
                                'waiting', v_waiting, 'note', v_note);
  END IF;
  INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, rows_seen, detail, updated_at)
  VALUES ('billing-ltv', now(), CASE WHEN v_refusal IS NULL THEN now() END, v_refusal IS NULL, v_out->>'note',
          v_written + v_held, v_out || jsonb_build_object('day', p_today, 'at', now()), now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = EXCLUDED.last_run_at,
    last_ok_at = coalesce(EXCLUDED.last_ok_at, public.cockpit_sync_state.last_ok_at), ok = EXCLUDED.ok,
    note = EXCLUDED.note, rows_seen = EXCLUDED.rows_seen, detail = EXCLUDED.detail, updated_at = EXCLUDED.updated_at;
  RETURN v_out;
END $$;

-- The CEO's and finance's read (3.3 g, 5.5).
CREATE OR REPLACE FUNCTION public.cockpit_ltv_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_set jsonb; v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date; v_refusal text; s public.cockpit_sync_state;
BEGIN
  IF auth.uid() IS NULL OR NOT (coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('finance'), false)) THEN
    RAISE EXCEPTION 'Lifetime value is for the CEO and finance.' USING ERRCODE = '42501';
  END IF;
  SELECT x.value INTO v_set FROM public.cockpit_settings x WHERE x.key = 'billing.ltv';
  SELECT * INTO s FROM public.cockpit_sync_state x WHERE x.key = 'billing-ltv';
  v_refusal := public.cockpit_ltv_refusal();
  RETURN jsonb_build_object(
    'asOf', (SELECT x.computed_at FROM public.cockpit_sections x WHERE x.key = 'money'),
    'on', coalesce(v_set->'on' = 'true'::jsonb, false),
    'maxDeltaUsd', CASE WHEN v_set->>'maxDeltaUsd' ~ '^[0-9]+(\.[0-9]+)?$' THEN (v_set->>'maxDeltaUsd')::numeric ELSE 5000 END,
    'refused', v_refusal,
    'lastRun', CASE WHEN s.key IS NULL THEN NULL ELSE jsonb_build_object('at', s.last_run_at, 'note', s.note) END,
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object(
               'taskId', p.task_id, 'client', p.client_name, 'stage', p.stage, 'baseline', p.baseline, 'baselineDay', p.baseline_day,
               'checkedUsd', p.checked_usd, 'rows', p.rows, 'target', p.target, 'card', p.card, 'delta', p.delta,
               'state', p.state, 'why', p.why) ORDER BY p.client_name, p.task_id)
                        FROM public.cockpit_ltv_plan(v_today) p), '[]'::jsonb),
    'held', coalesce((SELECT jsonb_agg(jsonb_build_object(
               'taskId', h.task_id, 'client', (SELECT a.client_name FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = h.task_id),
               'target', h.target, 'card', h.card, 'delta', h.delta, 'heldOn', h.first_held_on) ORDER BY h.first_held_on, h.task_id)
                        FROM public.cockpit_ltv_held h WHERE h.released_at IS NULL), '[]'::jsonb),
    'writtenToday', (SELECT count(*) FROM public.cockpit_billing_events e
                      WHERE e.kind = 'ltv' AND e.source = 'system' AND (e.at AT TIME ZONE 'Asia/Kuwait')::date = v_today),
    -- Hand-logged payments tied to a card in scope that wait on a check: not counted yet (5.5).
    'loggedWaiting', CASE WHEN v_refusal IS NULL THEN (
      WITH cards AS (SELECT DISTINCT ON (d.clickup_task_id) d.* FROM public.cockpit_client_billing_days d ORDER BY d.clickup_task_id, d.day DESC),
      base AS (SELECT DISTINCT ON (m.scope) m.scope, m.day FROM public.cockpit_metric_days m WHERE m.metric = 'money.ltv.card' ORDER BY m.scope, m.day)
      SELECT count(*)::integer FROM cards c JOIN base b ON b.scope = 'client:' || c.clickup_task_id
        CROSS JOIN public.cockpit_sections x
        CROSS JOIN LATERAL jsonb_array_elements(x.payload #> '{attribution,transactions}') t
       WHERE x.key = 'money' AND t->>'direction' = 'in' AND t->>'clientTaskId' = c.clickup_task_id
         AND (t->>'day')::date >= b.day AND t->>'checked' = 'false'
         AND (c.stage NOT IN ('Paused','Stopped','CANCELLED ONBOARDING','SALES TEAM TO CONTACT') OR c.stage IS NULL)
         AND c.client_name !~* 'playing account|\[internal test\]') END);
END $$;

-- The CEO writes one held jump (3.3 g), at the amount he looked at.
CREATE OR REPLACE FUNCTION public.cockpit_ltv_release(p_task_id text, p_target numeric, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.cockpit_ltv_held; p record; v_who text; v_refusal text; v_id bigint; v_after public.cockpit_ltv_held;
  v_note text := public.cockpit_manual_clean_text(p_note, 300);
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.cockpit_is_ceo(), false) THEN
    RAISE EXCEPTION 'Only the CEO releases a lifetime value jump.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(u.email)) INTO v_who FROM auth.users u WHERE u.id = auth.uid();
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO h FROM public.cockpit_ltv_held x WHERE x.task_id = p_task_id AND x.released_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no held lifetime value for this client.' USING ERRCODE = '22023';
  END IF;
  v_refusal := public.cockpit_ltv_refusal();
  IF v_refusal IS NOT NULL THEN RAISE EXCEPTION '%', v_refusal USING ERRCODE = '22023'; END IF;
  SELECT * INTO p FROM public.cockpit_ltv_plan((now() AT TIME ZONE 'Asia/Kuwait')::date) x WHERE x.task_id = p_task_id;
  IF p_target IS NULL OR p.target IS NULL OR p.state NOT IN ('held', 'write') OR p.target <> p_target OR h.target <> p_target THEN
    RAISE EXCEPTION 'The amount changed since you looked. Reload it.' USING ERRCODE = '22023';
  END IF;
  IF public.cockpit_ltv_on_its_way(p_task_id, p.target) THEN
    RAISE EXCEPTION 'A lifetime value write for this client is already on its way.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_actor', v_who, true);
  v_id := public.cockpit_ltv_event(to_jsonb(p), 'the CEO', v_note);
  UPDATE public.cockpit_ltv_held SET released_by = v_who, released_at = now() WHERE id = h.id RETURNING * INTO v_after;
  PERFORM set_config('cockpit.audit_actor', '', true);
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('billing.ltv_release', 'cockpit_ltv_held', h.id::text, v_who, 'media-buyer-cockpit', 'supabase', to_jsonb(h), to_jsonb(v_after),
          jsonb_build_object('event_id', v_id, 'task_id', p_task_id));
  RETURN jsonb_build_object('ok', true, 'eventId', v_id, 'sentence', 'Written. It reaches the card within a few minutes.');
END $$;

-- ---------------------------------------------------------------------------
-- 5. Confirm paid moves the next payment date (4.6)

-- Whether a plan reads monthly (billingBalances.ts planOf: month to month,
-- or monthly that is not paid in full or split).
CREATE OR REPLACE FUNCTION public.cockpit_billing_plan_monthly(p_plan text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(p_plan, '') ~* 'month.?to.?month'
      OR (coalesce(p_plan, '') ~* 'monthly' AND coalesce(p_plan, '') !~* 'full' AND coalesce(p_plan, '') !~* 'split')
$$;

-- What Confirm paid would do on a card, before any part is chosen (5.6): the
-- switch, the window, the card's date and the month-on day. Read per card by
-- cockpit_billing_balances_read; the parts are worked out on the screen.
CREATE OR REPLACE FUNCTION public.cockpit_billing_confirm_date_card(p_task text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_set jsonb; v_acc public.cockpit_billing_accounts; v_window integer;
BEGIN
  SELECT s.value INTO v_set FROM public.cockpit_settings s WHERE s.key = 'billing.confirm_date';
  v_window := CASE WHEN v_set->>'windowDays' ~ '^[0-9]{1,2}$' THEN (v_set->>'windowDays')::integer ELSE 7 END;
  SELECT * INTO v_acc FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = p_task;
  RETURN jsonb_build_object(
    'on', coalesce(v_set->'on' = 'true'::jsonb, false),
    'windowDays', v_window,
    'cardDate', v_acc.next_payment_date,
    'monthlyPlan', public.cockpit_billing_plan_monthly(v_acc.payment_plan),
    'plusMonth', CASE WHEN v_acc.next_payment_date IS NOT NULL AND public.cockpit_billing_plan_monthly(v_acc.payment_plan)
                      THEN (v_acc.next_payment_date + interval '1 month')::date END,
    'why', CASE WHEN v_acc.next_payment_date IS NULL
                THEN 'The card has no next payment date, so Confirm paid moves nothing. Set it by hand if they continue.' END);
END $$;

-- The rule (4.6.1, 4.6.2): the part confirmed is a later part due within the
-- window of the card's date (dueOn, the day the screen shows for it); the date
-- moves to the next unconfirmed later part of the same deal (nextPartNo and
-- nextDueOn, from the screen, checked here), else a month on for a monthly
-- plan, else it stays. {on, move, from, to, fromRule, why}.
CREATE OR REPLACE FUNCTION public.cockpit_billing_confirm_date_rule(p_task text, p_deal text, p_part text, p_part_no integer, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c jsonb := public.cockpit_billing_confirm_date_card(p_task);
  a jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_from date; v_due date; v_next date; v_next_no integer; v_window integer;
BEGIN
  IF NOT (c->>'on')::boolean THEN RETURN jsonb_build_object('on', false, 'move', false); END IF;
  v_from := (c->>'cardDate')::date;
  v_window := (c->>'windowDays')::integer;
  IF p_part IS DISTINCT FROM 'later' THEN
    RETURN jsonb_build_object('on', true, 'move', false, 'from', v_from, 'why', NULL);
  END IF;
  IF v_from IS NULL THEN
    RETURN jsonb_build_object('on', true, 'move', false, 'from', NULL, 'why', c->>'why');
  END IF;
  v_due := public.cockpit_billing_day(a->>'dueOn');
  IF v_due IS NULL OR abs(v_due - v_from) > v_window THEN
    RETURN jsonb_build_object('on', true, 'move', false, 'from', v_from,
      'why', format('Next payment date stays %s: this payment was not the one due on it.', public.cockpit_billing_day_words(v_from)));
  END IF;
  v_next := public.cockpit_billing_day(a->>'nextDueOn');
  IF v_next IS NOT NULL THEN
    v_next_no := CASE WHEN jsonb_typeof(a->'nextPartNo') = 'number' AND (a->>'nextPartNo') ~ '^[0-9]{1,2}$' THEN (a->>'nextPartNo')::integer END;
    IF p_deal IS NULL OR v_next_no IS NULL OR v_next_no <= coalesce(p_part_no, 0) OR v_next_no > 36
       OR v_next <= v_from OR v_next > v_from + 70
       OR EXISTS (SELECT 1 FROM public.cockpit_billing_confirmations x
                   WHERE x.deal_response_id = p_deal AND x.part = 'later' AND x.part_no = v_next_no AND x.withdrawn_at IS NULL) THEN
      RETURN jsonb_build_object('on', true, 'move', false, 'from', v_from,
        'why', format('Next payment date stays %s: the next part could not be read. Reload the page and confirm again.', public.cockpit_billing_day_words(v_from)));
    END IF;
    RETURN jsonb_build_object('on', true, 'move', true, 'from', v_from, 'to', v_next, 'fromRule', 'next_part', 'why', NULL);
  END IF;
  IF (c->>'monthlyPlan')::boolean THEN
    RETURN jsonb_build_object('on', true, 'move', true, 'from', v_from, 'to', (c->>'plusMonth')::date, 'fromRule', 'plus_month', 'why', NULL);
  END IF;
  RETURN jsonb_build_object('on', true, 'move', false, 'from', v_from,
    'why', format('Next payment date stays %s: there is no later payment on this plan. Set it by hand if they continue.', public.cockpit_billing_day_words(v_from)));
END $$;

-- The date write of a confirm (4.6.1), inside cockpit_billing_balance_write's save.
CREATE OR REPLACE FUNCTION public.cockpit_billing_confirm_date_apply(p_conf public.cockpit_billing_confirmations, p_args jsonb,
  p_source text, p_who text, p_app text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; v_acc public.cockpit_billing_accounts; v_next public.cockpit_billing_accounts; v_event bigint; v_to date;
BEGIN
  r := public.cockpit_billing_confirm_date_rule(p_conf.clickup_task_id, p_conf.deal_response_id, p_conf.part, p_conf.part_no, p_args);
  IF NOT (r->>'on')::boolean THEN RETURN jsonb_build_object('on', false, 'moved', false); END IF;
  IF NOT (r->>'move')::boolean THEN
    RETURN jsonb_build_object('on', true, 'moved', false, 'from', r->'from', 'why', r->'why',
      'sentence', CASE WHEN r->>'from' IS NOT NULL
                       THEN format('Confirmed. Next payment date stays %s.', public.cockpit_billing_day_words((r->>'from')::date)) END);
  END IF;
  v_to := (r->>'to')::date;
  SELECT * INTO v_acc FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = p_conf.clickup_task_id FOR UPDATE;
  UPDATE public.cockpit_billing_accounts SET next_payment_date = v_to, source = p_source, synced_at = now()
   WHERE clickup_task_id = p_conf.clickup_task_id RETURNING * INTO v_next;
  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (p_conf.clickup_task_id, v_acc.client_name, 'date', v_acc.next_payment_date::text, v_to::text, 'Confirmed paid; next payment moved',
          public.cockpit_billing_detail('date', jsonb_build_object('seatRole', p_source, 'confirmId', p_conf.id, 'part', p_conf.part,
            'partNo', p_conf.part_no, 'fromRule', r->>'fromRule', 'paidOn', p_conf.paid_on::text)),
          p_source, p_who)
  RETURNING id INTO v_event;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('billing.date', 'cockpit_billing_accounts', p_conf.clickup_task_id, p_who, p_app, 'supabase', to_jsonb(v_acc), to_jsonb(v_next),
          jsonb_build_object('event_id', v_event, 'confirmation_id', p_conf.id, 'from_rule', r->>'fromRule'));
  RETURN jsonb_build_object('on', true, 'moved', true, 'from', v_acc.next_payment_date, 'to', v_to, 'fromRule', r->>'fromRule',
    'eventId', v_event, 'sentence', format('Confirmed. Next payment %s.', public.cockpit_billing_day_words(v_to)));
END $$;

-- The withdraw of a confirm that moved the date (4.6.3): back while the card
-- (its mirror) still shows the moved date, else it stays and says so.
CREATE OR REPLACE FUNCTION public.cockpit_billing_confirm_date_undo(p_conf public.cockpit_billing_confirmations,
  p_source text, p_who text, p_app text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.cockpit_billing_events; v_acc public.cockpit_billing_accounts; v_next public.cockpit_billing_accounts; v_event bigint;
BEGIN
  SELECT * INTO e FROM public.cockpit_billing_events x
   WHERE x.clickup_task_id = p_conf.clickup_task_id AND x.kind = 'date' AND x.detail->>'confirm_id' = p_conf.id::text
     AND x.detail->>'from_rule' IN ('next_part', 'plus_month')
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = x.id)
   ORDER BY x.id DESC LIMIT 1;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM public.cockpit_billing_events y
                           WHERE y.kind = 'date' AND y.detail->>'reverses' = e.id::text) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_acc FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = p_conf.clickup_task_id FOR UPDATE;
  IF v_acc.next_payment_date IS DISTINCT FROM public.cockpit_billing_day(e.to_value) OR public.cockpit_billing_day(e.from_value) IS NULL THEN
    RETURN jsonb_build_object('moved', false, 'stays', v_acc.next_payment_date,
      'sentence', format('Withdrawn. The card''s next payment date was changed since; it stays %s.',
                         coalesce(public.cockpit_billing_day_words(v_acc.next_payment_date), 'empty')));
  END IF;
  UPDATE public.cockpit_billing_accounts SET next_payment_date = public.cockpit_billing_day(e.from_value), source = p_source, synced_at = now()
   WHERE clickup_task_id = p_conf.clickup_task_id RETURNING * INTO v_next;
  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (p_conf.clickup_task_id, v_acc.client_name, 'date', e.to_value, e.from_value, 'Confirm withdrawn; next payment moved back',
          public.cockpit_billing_detail('date', jsonb_build_object('seatRole', p_source, 'confirmId', p_conf.id, 'part', p_conf.part,
            'partNo', p_conf.part_no, 'fromRule', 'withdraw', 'reverses', e.id)),
          p_source, p_who)
  RETURNING id INTO v_event;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('billing.date', 'cockpit_billing_accounts', p_conf.clickup_task_id, p_who, p_app, 'supabase', to_jsonb(v_acc), to_jsonb(v_next),
          jsonb_build_object('event_id', v_event, 'confirmation_id', p_conf.id, 'from_rule', 'withdraw', 'reverses', e.id));
  RETURN jsonb_build_object('moved', true, 'to', v_next.next_payment_date, 'eventId', v_event,
    'sentence', format('Withdrawn. Next payment back to %s.', public.cockpit_billing_day_words(v_next.next_payment_date)));
END $$;

-- What the press would write, before it (5.6): the same rule the confirm runs.
CREATE OR REPLACE FUNCTION public.cockpit_billing_confirm_date_preview(p_task_id text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ceo boolean; v_acc public.cockpit_billing_accounts; r jsonb; a jsonb;
  v_part_no integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to see pending payments.' USING ERRCODE = '42501'; END IF;
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT (v_ceo OR coalesce(public.cockpit_has_role('csm'), false) OR coalesce(public.cockpit_has_role('finance'), false)) THEN
    RAISE EXCEPTION 'Pending payments need a client success, finance or CEO seat. Ask an admin to add the role.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_acc FROM public.cockpit_billing_accounts x WHERE x.clickup_task_id = p_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That client is not on the billing sheet. Reload the page.' USING ERRCODE = '22023'; END IF;
  IF NOT v_ceo AND NOT coalesce(public.cockpit_has_role('finance'), false)
     AND NOT coalesce(public.cockpit_client_allowed(v_acc.client_name), false) THEN
    RAISE EXCEPTION 'That client is not on your access list' USING ERRCODE = '42501';
  END IF;
  a := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_part_no := CASE WHEN jsonb_typeof(a->'partNo') = 'number' AND (a->>'partNo') ~ '^[0-9]{1,2}$' THEN (a->>'partNo')::integer END;
  r := public.cockpit_billing_confirm_date_rule(p_task_id, nullif(btrim(coalesce(a->>'dealResponseId', '')), ''), a->>'part', v_part_no, a);
  RETURN jsonb_build_object('on', (r->>'on')::boolean, 'from', r->'from',
    'dateIfConfirmed', CASE WHEN (r->>'move')::boolean THEN r->'to' END, 'fromRule', r->'fromRule', 'dateWhy', r->'why');
END $$;

-- ---------------------------------------------------------------------------
-- 6. The billing agent's own login (AG, 3.4)

-- D-AG puts the key's sha256 (never the key): the agent's previous key is revoked as Replaced.
CREATE OR REPLACE FUNCTION public.cockpit_agent_key_put_owner(p_agent text, p_key_sha256 text, p_note text, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text := lower(btrim(coalesce(p_key_sha256, ''))); v_id bigint; v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'An agent key is set only through the deploy connection.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_agent, '') <> 'billing_agent' THEN RAISE EXCEPTION 'The only agent is billing_agent.' USING ERRCODE = '22023'; END IF;
  IF v_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Send the key''s sha256 as 64 hex characters, never the key.' USING ERRCODE = '22023'; END IF;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Say who sets the key.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_agent_keys k WHERE k.key_sha256 = v_hash) THEN
    RAISE EXCEPTION 'That key was set before. Make a new one.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_actor', v_actor, true);
  UPDATE public.cockpit_agent_keys SET revoked_by = v_actor, revoked_at = now(), revoked_reason = 'Replaced'
   WHERE agent = p_agent AND revoked_at IS NULL;
  INSERT INTO public.cockpit_agent_keys(agent, key_sha256, note, added_by)
  VALUES (p_agent, v_hash, public.cockpit_manual_clean_text(p_note, 200), v_actor)
  RETURNING id INTO v_id;
  PERFORM set_config('cockpit.audit_actor', '', true);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

-- The CEO's card (5.7): never a hash.
CREATE OR REPLACE FUNCTION public.cockpit_agent_keys_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.cockpit_is_ceo(), false) THEN
    RAISE EXCEPTION 'Only the CEO sees the agent''s login.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'separated', coalesce((SELECT s.value->'separated' = 'true'::jsonb FROM public.cockpit_settings s WHERE s.key = 'billing.agent'), false),
    'keys', coalesce((SELECT jsonb_agg(jsonb_build_object(
               'id', k.id, 'agent', k.agent, 'note', k.note, 'addedAt', k.added_at, 'revokedAt', k.revoked_at,
               'revokedReason', k.revoked_reason,
               'lastCallAt', (SELECT max(c.at) FROM public.cockpit_agent_calls c WHERE c.key_id = k.id),
               'callsToday', (SELECT count(*) FROM public.cockpit_agent_calls c
                               WHERE c.key_id = k.id AND (c.at AT TIME ZONE 'Asia/Kuwait')::date = v_today))
             ORDER BY k.added_at DESC, k.id DESC)
                        FROM public.cockpit_agent_keys k), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_agent_key_revoke(p_id bigint, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_who text; v_reason text := public.cockpit_manual_clean_text(p_reason, 300); k public.cockpit_agent_keys;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.cockpit_is_ceo(), false) THEN
    RAISE EXCEPTION 'Only the CEO revokes the agent''s key.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(u.email)) INTO v_who FROM auth.users u WHERE u.id = auth.uid();
  IF coalesce(char_length(v_reason), 0) < 3 THEN RAISE EXCEPTION 'Say why in 3 to 300 characters.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO k FROM public.cockpit_agent_keys x WHERE x.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That key is not on the list. Reload the page.' USING ERRCODE = '22023'; END IF;
  IF k.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'That key was already revoked.' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('cockpit.audit_actor', v_who, true);
  UPDATE public.cockpit_agent_keys SET revoked_by = v_who, revoked_at = now(), revoked_reason = v_reason WHERE id = k.id;
  PERFORM set_config('cockpit.audit_actor', '', true);
  RETURN jsonb_build_object('ok', true, 'sentence', 'Revoked. The agent cannot write until a new key is set on the server.');
END $$;

-- The key behind a call: the identity is the row's agent, never a parameter.
-- {key} for a live key; {refusal} (with no row to log against) otherwise.
CREATE OR REPLACE FUNCTION public.cockpit_agent_key_of(p_key_sha256 text)
RETURNS public.cockpit_agent_keys LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE k public.cockpit_agent_keys; v_hash text := lower(btrim(coalesce(p_key_sha256, '')));
BEGIN
  IF v_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO k FROM public.cockpit_agent_keys x WHERE x.key_sha256 = v_hash;
  RETURN k;
END $$;

-- One call row (never a secret: the op, the outcome and a small detail).
CREATE OR REPLACE FUNCTION public.cockpit_agent_call_log(p_key_id bigint, p_op text, p_request_id uuid, p_outcome text, p_detail jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id bigint; v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
BEGIN
  IF octet_length(v_detail::text) > 2048 THEN
    v_detail := jsonb_build_object('response', jsonb_build_object('ok', v_detail->'response'->'ok', 'outcome', v_detail->'response'->'outcome',
                                                                  'status', v_detail->'response'->'status'), 'cut', true);
  END IF;
  PERFORM set_config('cockpit.audit_actor', 'the billing agent', true);
  INSERT INTO public.cockpit_agent_calls(key_id, op, request_id, outcome, detail)
  VALUES (p_key_id, left(p_op, 41), p_request_id, p_outcome, v_detail)
  RETURNING id INTO v_id;
  PERFORM set_config('cockpit.audit_actor', '', true);
  RETURN v_id;
END $$;

-- The door's common start (3.4): the key, a revoked key, a repeated request,
-- the rate limit. NULL to go on; else the answer to give (logged where a key exists).
CREATE OR REPLACE FUNCTION public.cockpit_agent_door_open(k public.cockpit_agent_keys, p_op text, p_request_id uuid, p_read boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.cockpit_agent_calls; v_n integer; v_out jsonb;
BEGIN
  IF k.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'status', 401, 'error', 'This key is not known.');
  END IF;
  -- One call at a time per key, so the count and the repeat check are exact.
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_agent_door:' || k.id::text, 0));
  IF k.revoked_at IS NOT NULL THEN
    v_out := jsonb_build_object('ok', false, 'outcome', 'refused', 'status', 401, 'error', 'This key was revoked.');
    PERFORM public.cockpit_agent_call_log(k.id, p_op, NULL, 'refused', jsonb_build_object('response', v_out));
    RETURN v_out;
  END IF;
  IF p_request_id IS NOT NULL THEN
    SELECT * INTO f FROM public.cockpit_agent_calls c WHERE c.key_id = k.id AND c.request_id = p_request_id;
    IF FOUND THEN
      PERFORM public.cockpit_agent_call_log(k.id, p_op, NULL, 'duplicate', jsonb_build_object('firstCallId', f.id));
      -- A write answers with its first result; a read is read again (it changes nothing).
      IF p_read THEN RETURN jsonb_build_object('duplicate', true, 'firstCallId', f.id); END IF;
      RETURN coalesce(f.detail->'response', jsonb_build_object('ok', false, 'status', 409, 'error', 'The first call''s answer was not kept.'))
             || jsonb_build_object('outcome', 'duplicate', 'firstCallId', f.id);
    END IF;
  END IF;
  SELECT count(*) INTO v_n FROM public.cockpit_agent_calls c WHERE c.key_id = k.id AND c.at > now() - interval '1 minute';
  IF v_n >= 60 THEN
    v_out := jsonb_build_object('ok', false, 'outcome', 'limited', 'status', 429, 'error', 'That is 60 calls in a minute. Wait a minute and try again.');
    PERFORM public.cockpit_agent_call_log(k.id, p_op, NULL, 'limited', jsonb_build_object('response', v_out));
    RETURN v_out;
  END IF;
  RETURN NULL;
END $$;

-- The card a call names: on the billing sheet.
CREATE OR REPLACE FUNCTION public.cockpit_agent_card(p_body jsonb)
RETURNS public.cockpit_billing_accounts LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_acc public.cockpit_billing_accounts; v_task text := p_body->>'taskId';
BEGIN
  IF v_task IS NULL OR v_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Send the ClickUp card id as taskId.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_acc FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = v_task;
  IF NOT FOUND THEN RAISE EXCEPTION 'That card is not on the billing sheet.' USING ERRCODE = '22023'; END IF;
  RETURN v_acc;
END $$;

-- The agent's writes (3.4): chase, invoice and note as billing events of
-- source maher (never queued for ClickUp), payment into the billing inbox.
-- No op writes ClickUp, LTV, a next payment date or a manual payment.
CREATE OR REPLACE FUNCTION public.cockpit_billing_agent_write(p_key_sha256 text, p_op text, p_body jsonb, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  k public.cockpit_agent_keys := public.cockpit_agent_key_of(p_key_sha256);
  v_op text := coalesce(nullif(btrim(coalesce(p_op, '')), ''), 'unknown');
  b jsonb := CASE WHEN jsonb_typeof(p_body) = 'object' THEN p_body ELSE '{}'::jsonb END;
  v_gate jsonb; v_out jsonb; v_acc public.cockpit_billing_accounts; v_id bigint; v_text text; v_note text;
  v_amount numeric; v_day date; v_ref text; v_url text; v_msg text; v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
BEGIN
  IF v_op !~ '^[a-z][a-z_]{0,30}$' THEN v_op := 'unknown'; END IF;
  v_gate := public.cockpit_agent_door_open(k, 'write:' || v_op, p_request_id, false);
  IF v_gate IS NOT NULL THEN RETURN v_gate; END IF;
  BEGIN
    IF octet_length(b::text) > 16384 THEN RAISE EXCEPTION 'Send the body under 16 KB.' USING ERRCODE = '22023'; END IF;
    CASE v_op
    WHEN 'chase' THEN
      v_acc := public.cockpit_agent_card(b);
      v_text := public.cockpit_manual_clean_text(b->>'step', 60);
      IF v_text IS NULL THEN RAISE EXCEPTION 'Say which chase step this is (up to 60 characters).' USING ERRCODE = '22023'; END IF;
      v_note := public.cockpit_manual_clean_text(b->>'note', 500);
      INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
      VALUES (v_acc.clickup_task_id, v_acc.client_name, 'chase', NULL, v_text, v_note,
              jsonb_strip_nulls(jsonb_build_object('step', v_text, 'request_id', p_request_id, 'via', 'door', 'key_id', k.id)), 'maher', 'maher')
      RETURNING id INTO v_id;
      v_out := jsonb_build_object('ok', true, 'outcome', 'ok', 'status', 200, 'result', jsonb_build_object('eventId', v_id, 'kind', 'chase'));
    WHEN 'invoice' THEN
      v_acc := public.cockpit_agent_card(b);
      v_text := public.cockpit_manual_clean_text(b->>'invoiceNo', 60);
      IF v_text IS NULL THEN RAISE EXCEPTION 'Send the invoice number.' USING ERRCODE = '22023'; END IF;
      IF jsonb_typeof(b->'amount') IS DISTINCT FROM 'number' OR NOT ((b->>'amount')::numeric > 0 AND (b->>'amount')::numeric <= 1000000) THEN
        RAISE EXCEPTION 'Send the amount as a number above 0.' USING ERRCODE = '22023';
      END IF;
      IF coalesce(b->>'currency', '') NOT IN ('USD', 'KWD') THEN RAISE EXCEPTION 'Send the currency as USD or KWD.' USING ERRCODE = '22023'; END IF;
      v_day := public.cockpit_billing_day(b->>'dueOn');
      IF b->>'dueOn' IS NOT NULL AND v_day IS NULL THEN RAISE EXCEPTION 'Send the due day as YYYY-MM-DD.' USING ERRCODE = '22023'; END IF;
      v_note := public.cockpit_manual_clean_text(b->>'note', 500);
      INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
      VALUES (v_acc.clickup_task_id, v_acc.client_name, 'invoice', NULL, v_text, v_note,
              jsonb_strip_nulls(jsonb_build_object('invoice_no', v_text, 'amount', (b->>'amount')::numeric, 'currency', b->>'currency',
                'due_on', v_day, 'request_id', p_request_id, 'via', 'door', 'key_id', k.id)), 'maher', 'maher')
      RETURNING id INTO v_id;
      v_out := jsonb_build_object('ok', true, 'outcome', 'ok', 'status', 200, 'result', jsonb_build_object('eventId', v_id, 'kind', 'invoice'));
    WHEN 'payment' THEN
      v_acc := public.cockpit_agent_card(b);
      v_day := public.cockpit_billing_day(b->>'paidOn');
      IF v_day IS NULL OR v_day > v_today OR v_day < v_today - 120 THEN
        RAISE EXCEPTION 'Send the day they paid (YYYY-MM-DD), today or within the last 120 days.' USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(b->'amount') IS DISTINCT FROM 'number' OR NOT ((b->>'amount')::numeric > 0 AND (b->>'amount')::numeric <= 1000000) THEN
        RAISE EXCEPTION 'Send the amount as a number above 0.' USING ERRCODE = '22023';
      END IF;
      v_amount := round((b->>'amount')::numeric, 3);
      IF coalesce(b->>'currency', '') NOT IN ('USD', 'KWD') THEN RAISE EXCEPTION 'Send the currency as USD or KWD.' USING ERRCODE = '22023'; END IF;
      IF coalesce(b->>'method', '') NOT IN ('bank_transfer', 'cheque', 'cash') THEN
        RAISE EXCEPTION 'The agent logs a bank transfer, a cheque or cash. Card payments arrive on their own.' USING ERRCODE = '22023';
      END IF;
      v_ref := public.cockpit_manual_clean_text(b->>'reference', 120);
      v_url := nullif(btrim(coalesce(b->>'evidenceUrl', '')), '');
      IF v_url IS NOT NULL AND (v_url !~ '^https://[^[:space:]<>"'']+$' OR length(v_url) > 1000) THEN
        RAISE EXCEPTION 'The receipt has to be a link that opens, starting https://.' USING ERRCODE = '22023';
      END IF;
      IF b->>'method' = 'bank_transfer' AND (v_url IS NULL OR coalesce(char_length(v_ref), 0) < 3) THEN
        RAISE EXCEPTION 'A bank transfer needs its receipt link and the bank reference. Without them it counts as unpaid.' USING ERRCODE = '22023';
      END IF;
      v_note := public.cockpit_manual_clean_text(b->>'note', 500);
      INSERT INTO public.cockpit_billing_inbox(clickup_task_id, client_name, paid_on, amount, currency, method, reference,
                                               evidence_url, note, source, logged_by)
      VALUES (v_acc.clickup_task_id, v_acc.client_name, v_day, v_amount, b->>'currency', b->>'method', v_ref, v_url, v_note,
              'maher', 'the billing agent')
      RETURNING id INTO v_id;
      v_out := jsonb_build_object('ok', true, 'outcome', 'ok', 'status', 200,
        'result', jsonb_build_object('inboxId', v_id, 'checkState', 'logged',
                                     'sentence', 'Logged. It counts once finance or the CEO checks it.'));
    WHEN 'note' THEN
      v_acc := public.cockpit_agent_card(b);
      v_text := public.cockpit_manual_clean_text(b->>'text', 1000);
      IF coalesce(char_length(v_text), 0) < 2 THEN RAISE EXCEPTION 'Write the note first.' USING ERRCODE = '22023'; END IF;
      INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
      VALUES (v_acc.clickup_task_id, v_acc.client_name, 'note', NULL, NULL, v_text,
              jsonb_strip_nulls(jsonb_build_object('request_id', p_request_id, 'via', 'door', 'key_id', k.id)), 'maher', 'maher')
      RETURNING id INTO v_id;
      v_out := jsonb_build_object('ok', true, 'outcome', 'ok', 'status', 200, 'result', jsonb_build_object('eventId', v_id, 'kind', 'note'));
    ELSE
      RAISE EXCEPTION 'The agent writes chase, invoice, payment or note, not %.', v_op USING ERRCODE = '22023';
    END CASE;
  EXCEPTION WHEN sqlstate '22023' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    v_out := jsonb_build_object('ok', false, 'outcome', 'refused', 'status', 422, 'error', left(v_msg, 300));
  END;
  PERFORM public.cockpit_agent_call_log(k.id, 'write:' || v_op, p_request_id, v_out->>'outcome',
    jsonb_build_object('response', v_out, 'taskId', b->>'taskId'));
  RETURN v_out;
END $$;

-- The agent's reads (3.4). VOLATILE: each writes its calls row.
CREATE OR REPLACE FUNCTION public.cockpit_billing_agent_read(p_key_sha256 text, p_what text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  k public.cockpit_agent_keys := public.cockpit_agent_key_of(p_key_sha256);
  v_what text := coalesce(nullif(btrim(coalesce(p_what, '')), ''), 'unknown');
  a jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_req uuid; v_gate jsonb; v_result jsonb; v_out jsonb; v_dup boolean := false;
BEGIN
  IF v_what !~ '^[a-z][a-z_]{0,30}$' THEN v_what := 'unknown'; END IF;
  v_req := CASE WHEN a->>'requestId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                THEN (a->>'requestId')::uuid END;
  v_gate := public.cockpit_agent_door_open(k, 'read:' || v_what, v_req, true);
  IF v_gate IS NOT NULL AND NOT coalesce((v_gate->>'duplicate')::boolean, false) THEN RETURN v_gate; END IF;
  v_dup := v_gate IS NOT NULL;
  CASE v_what
  WHEN 'accounts' THEN
    -- The billing sheet as the agent uses it; no payer emails, no names of people beyond the CSM's seat.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'taskId', x.clickup_task_id, 'client', x.client_name, 'status', x.client_status, 'group', x.stage_group,
             'plan', x.payment_plan, 'method', x.payment_method, 'nextUsd', x.next_payment_usd, 'nextDate', x.next_payment_date,
             'mrrUsd', x.mrr_usd, 'extensionWeeks', x.extension_weeks, 'pausedOn', x.paused_on, 'country', x.country)
             ORDER BY x.client_name, x.clickup_task_id), '[]'::jsonb) INTO v_result
      FROM public.cockpit_billing_accounts x;
  WHEN 'ladder' THEN
    v_result := public.cockpit_billing_ladder_settings();
  WHEN 'balances' THEN
    -- What Pending payments reads, as the CEO's view without payer names: each listed card, its newest
    -- deal's terms, the payments that count for it, and the confirmations that still hold.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'taskId', x.clickup_task_id, 'client', x.client_name, 'status', x.client_status, 'group', x.stage_group,
             'plan', x.payment_plan, 'method', x.payment_method, 'nextUsd', x.next_payment_usd, 'nextDate', x.next_payment_date,
             'deal', (SELECT jsonb_build_object('responseId', d.response_id, 'signedOn', (d.submitted_at AT TIME ZONE 'Asia/Kuwait')::date,
                                                'paymentStructure', d.payment_structure, 'contractUsd', d.contracted_revenue,
                                                'depositUsd', d.cash_collected, 'atOnboardingUsd', d.cash_at_onboarding,
                                                'secondPaymentUsd', d.second_payment, 'newMrrUsd', d.new_mrr)
                        FROM public.cockpit_billing_deal_cards() dc JOIN public.cockpit_sales_deals d ON d.response_id = dc.deal_response_id
                       WHERE dc.clickup_task_id = x.clickup_task_id LIMIT 1),
             'payments', (SELECT coalesce(jsonb_agg(jsonb_build_object('paymentId', r.payment_id, 'day', r.day, 'usd', r.usd,
                                                                       'rail', r.rail, 'checked', r.checked) ORDER BY r.day, r.payment_id), '[]'::jsonb)
                            FROM public.cockpit_billing_deal_cards() dc
                            CROSS JOIN LATERAL public.cockpit_billing_deal_rails_shown(dc.deal_response_id, dc.clickup_task_id) r
                           WHERE dc.clickup_task_id = x.clickup_task_id),
             'confirmations', (SELECT coalesce(jsonb_agg(jsonb_build_object('part', c.part, 'partNo', c.part_no, 'usd', c.usd,
                                                                            'rail', c.rail, 'paidOn', c.paid_on) ORDER BY c.confirmed_at, c.id), '[]'::jsonb)
                                 FROM public.cockpit_billing_confirmations c
                                WHERE c.clickup_task_id = x.clickup_task_id AND c.withdrawn_at IS NULL))
             ORDER BY x.client_name, x.clickup_task_id), '[]'::jsonb) INTO v_result
      FROM public.cockpit_billing_accounts x
     WHERE public.cockpit_billing_card_listed(x.clickup_task_id, true);
  WHEN 'inbox' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', i.id, 'taskId', i.clickup_task_id, 'paidOn', i.paid_on, 'amount', i.amount, 'currency', i.currency,
             'method', i.method, 'status', i.status, 'statusNote', i.status_note, 'checkState', i.check_state, 'loggedAt', i.logged_at)
             ORDER BY i.logged_at DESC, i.id DESC), '[]'::jsonb) INTO v_result
      FROM public.cockpit_billing_inbox i
     WHERE i.source = 'maher' AND i.logged_at > now() - interval '60 days';
  WHEN 'chases' THEN
    -- The agent's own chase and invoice steps, so the overdue ladder keeps its history (3.4).
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'taskId', e.clickup_task_id, 'kind', e.kind,
             'step', CASE WHEN e.kind = 'chase' THEN coalesce(e.detail->>'step', e.to_value) ELSE coalesce(e.detail->>'invoice_no', e.to_value) END,
             'at', e.at)
             ORDER BY e.clickup_task_id, e.at, e.id), '[]'::jsonb) INTO v_result
      FROM public.cockpit_billing_events e
     WHERE e.source = 'maher' AND e.kind IN ('chase', 'invoice') AND e.at > now() - interval '60 days';
  ELSE
    v_out := jsonb_build_object('ok', false, 'outcome', 'refused', 'status', 422,
      'error', format('The agent reads accounts, ladder, balances, inbox or chases, not %s.', v_what));
    PERFORM public.cockpit_agent_call_log(k.id, 'read:' || v_what, CASE WHEN v_dup THEN NULL ELSE v_req END,
      CASE WHEN v_dup THEN 'duplicate' ELSE 'refused' END, jsonb_build_object('response', v_out));
    RETURN v_out;
  END CASE;
  v_out := jsonb_build_object('ok', true, 'outcome', CASE WHEN v_dup THEN 'duplicate' ELSE 'ok' END, 'status', 200, 'result', v_result);
  IF NOT v_dup THEN
    PERFORM public.cockpit_agent_call_log(k.id, 'read:' || v_what, v_req, 'ok',
      jsonb_build_object('rows', CASE WHEN jsonb_typeof(v_result) = 'array' THEN jsonb_array_length(v_result) END));
  ELSE
    v_out := v_out || jsonb_build_object('firstCallId', v_gate->'firstCallId');
  END IF;
  RETURN v_out;
END $$;

-- ---------------------------------------------------------------------------
-- 7. The replaced functions (2.2), each the live body with this file's change.

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_shape(p_kind text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_kind IN ('kickoff','blueprint.close','blueprint.media','checkin.grade','checkin.recap_late',
                    'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed',
                    'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received',
                    'win.logged','receipt.in','client.reactivated') THEN 'post'
    WHEN p_kind IN ('kickoff.updated','blueprint.updated','blueprint.offer') THEN 'reply'
    WHEN p_kind IN ('kickoff.late','kickoff.second') THEN 'variant'
    WHEN p_kind = 'rehearsal' THEN 'test'
  END
$function$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_kind_label(p_kind text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE p_kind
    WHEN 'kickoff' THEN 'Kickoff complete'
    WHEN 'kickoff.late' THEN 'Kickoff late'
    WHEN 'kickoff.second' THEN 'Second kickoff'
    WHEN 'kickoff.updated' THEN 'Kickoff card updated'
    WHEN 'blueprint.close' THEN 'Brand Blueprint closed'
    WHEN 'blueprint.media' THEN 'Brand Blueprint completed, for media'
    WHEN 'blueprint.updated' THEN 'Blueprint card confirmed'
    WHEN 'blueprint.offer' THEN 'Offer locked'
    WHEN 'checkin.grade' THEN 'Call grade'
    WHEN 'checkin.recap_late' THEN 'Recap not sent'
    WHEN 'termination.notice' THEN 'Termination notice in'
    WHEN 'termination.submitted' THEN 'Termination survey sent'
    WHEN 'churn.confirmed' THEN 'Client has left'
    WHEN 'extension.granted' THEN 'Extension given'
    WHEN 'pause.agreed' THEN 'Pause agreed'
    WHEN 'client.resumed' THEN 'Client resumed'
    WHEN 'pause.consent' THEN 'Pause consent signed'
    WHEN 'nps.received' THEN 'NPS answer in'
    WHEN 'csat.received' THEN 'Onboarding survey answer in'
    WHEN 'voice.low' THEN 'Low score'
    WHEN 'feedback.received' THEN 'Portal feedback in'
    WHEN 'legacy.received' THEN 'Old form link used'
    WHEN 'win.logged' THEN 'Win logged'
    WHEN 'receipt.in' THEN 'Receipt in'
    WHEN 'client.reactivated' THEN 'Client is back'
    ELSE p_kind
  END
$function$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_live(p_row cockpit_slack_notices)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_status text; v_updated timestamptz; v_links jsonb; v_sub timestamptz; v_by text; v_launch timestamptz;
  v_rec text; v_grade jsonb; v_class text; v_gone timestamptz; v_call_gone boolean; v_email text; v_starts timestamptz;
  v_share text; v_effect text; v_ref text; v_message text;
  v_rid uuid; v_answered boolean; v_resp_task text; v_resp_at timestamptz; v_notice_on date; v_covered boolean;
  v_event bigint; v_voided boolean; v_dep bigint; v_removed boolean;
  v_vform text; v_newer boolean; v_paused boolean; v_ticket boolean;
BEGIN
  -- A 1-1 notes notice (2b). The call grade's words come from the draft its
  -- facts name, read now and only once that draft is ready; they are never
  -- stored in the outbox (Z7). Who took the call is a role, never a name.
  IF p_row.kind = 'checkin.grade' THEN
    v_rec := p_row.facts->>'recordingId';
    IF coalesce(p_row.facts->>'draftId', '') ~ '^[0-9a-fA-F-]{36}$' THEN
      SELECT jsonb_build_object('criteria', d.output->'criteria', 'overall', d.output->'overall', 'color', d.output->'color',
                                'score', d.output->'score', 'draftId', d.id)
        INTO v_grade
        FROM public.cockpit_form_drafts d
       WHERE d.id = (p_row.facts->>'draftId')::uuid AND d.kind = 'grade' AND d.state = 'ready'
         AND d.recording_id = v_rec AND jsonb_typeof(d.output) = 'object';
    END IF;
    SELECT m.class, m.gone_at, lower(btrim(m.recorded_by_email)), m.starts_at, m.share_url
      INTO v_class, v_gone, v_email, v_starts, v_share
      FROM public.cockpit_fathom_meetings m WHERE m.recording_id = v_rec;
    v_call_gone := EXISTS (SELECT 1 FROM public.cockpit_csm_calls c
                            WHERE c.source = 'fathom' AND c.source_id = v_rec AND c.status = 'gone');
    v_by := CASE WHEN nullif(v_email, '') IS NOT NULL THEN public.cockpit_slack_notice_role_of(v_email) END;
    IF v_by IS NULL AND coalesce(p_row.facts->>'responseId', '') ~ '^[0-9a-fA-F-]{36}$' THEN
      SELECT public.cockpit_slack_notice_role_of(r.submitted_by) INTO v_by
        FROM public.cockpit_form_responses r WHERE r.id = (p_row.facts->>'responseId')::uuid;
    END IF;
    RETURN jsonb_build_object(
      'takenByRole', v_by,
      'callAt', public.cockpit_slack_notice_iso(v_starts),
      'shareUrl', v_share,
      'recordingShown', coalesce(v_class IN ('client','candidate') AND v_gone IS NULL AND NOT v_call_gone, false))
      || CASE WHEN v_grade IS NOT NULL THEN jsonb_build_object('grade', v_grade) ELSE '{}'::jsonb END;
  ELSIF p_row.kind = 'checkin.recap_late' THEN
    -- Where the recap is now: its effect, and the message the effect points at.
    IF coalesce(p_row.facts->>'responseId', '') ~ '^[0-9a-fA-F-]{36}$' THEN
      SELECT e.state, e.delivery_ref INTO v_effect, v_ref
        FROM public.cockpit_form_effects e
       WHERE e.response_id = (p_row.facts->>'responseId')::uuid AND e.effect_key = 'recap';
    END IF;
    IF coalesce(v_ref, '') ~ '^[0-9a-fA-F-]{36}$' THEN
      SELECT m.state INTO v_message FROM public.cockpit_client_messages m WHERE m.id = v_ref::uuid;
    END IF;
    RETURN jsonb_build_object('recap', jsonb_build_object('effectState', v_effect, 'messageState', v_message));
  ELSIF p_row.kind IN ('termination.notice','termination.submitted') THEN
    -- Waves 1-2 (3.4): a termination notice is still true while its survey
    -- is unanswered and no churn confirmed after it covers the card. The
    -- confirm's columns arrive with 20261101o, so they are read by name.
    IF coalesce(p_row.facts->>'responseId', '') ~ '^[0-9a-fA-F-]{36}$' THEN
      v_rid := (p_row.facts->>'responseId')::uuid;
      SELECT r.answer_meta ? 'answered', r.task_id, r.submitted_at, (r.answer_meta->>'notice_on')::date
        INTO v_answered, v_resp_task, v_resp_at, v_notice_on
        FROM public.cockpit_form_responses r WHERE r.id = v_rid AND r.form_key = 'exit_survey';
    END IF;
    IF v_resp_task IS NOT NULL AND EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = 'public.cockpit_churn_departures'::regclass AND a.attname = 'confirmed_at' AND NOT a.attisdropped) THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.cockpit_churn_departures d WHERE d.clickup_task_id = $1 AND d.removed_at IS NULL'
              ' AND d.confirmed_at IS NOT NULL AND (d.confirmed_at >= $2 OR d.left_on >= $3))'
        INTO v_covered USING v_resp_task, v_resp_at, v_notice_on;
    END IF;
    RETURN jsonb_build_object(
      'responseFound', v_answered IS NOT NULL,
      'matched', v_resp_task IS NOT NULL,
      'stillTrue', CASE WHEN p_row.kind = 'termination.submitted' THEN v_answered IS NOT NULL
                        ELSE v_answered IS FALSE AND NOT coalesce(v_covered, false) END,
      'why', CASE WHEN v_answered IS NULL THEN 'The survey is no longer in the cockpit.'
                  WHEN p_row.kind = 'termination.notice' AND v_answered THEN 'The notice was answered in the cockpit before it went out.'
                  WHEN p_row.kind = 'termination.notice' AND coalesce(v_covered, false)
                    THEN 'The churn was confirmed in the cockpit before the notice went out.' END);
  ELSIF p_row.kind = 'churn.confirmed' THEN
    IF coalesce(p_row.facts->>'departureId', '') ~ '^[0-9]{1,18}$' THEN
      v_dep := (p_row.facts->>'departureId')::bigint;
      SELECT d.removed_at IS NOT NULL INTO v_removed FROM public.cockpit_churn_departures d WHERE d.id = v_dep;
    END IF;
    RETURN jsonb_build_object('stillTrue', v_removed IS FALSE,
      'why', CASE WHEN v_removed IS NULL THEN 'The departure is no longer in the register.'
                  WHEN v_removed THEN 'The departure was removed from the register before the notice went out.' END);
  ELSIF p_row.kind IN ('extension.granted','pause.agreed','client.resumed') THEN
    -- A voided billing event (20261101m's voids, read by name) is no news.
    IF coalesce(p_row.facts->>'eventId', '') ~ '^[0-9]{1,18}$' THEN
      v_event := (p_row.facts->>'eventId')::bigint;
      IF NOT EXISTS (SELECT 1 FROM public.cockpit_billing_events e WHERE e.id = v_event) THEN
        v_event := NULL;
      ELSIF to_regclass('public.cockpit_billing_event_voids') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = $1)'
          INTO v_voided USING v_event;
      END IF;
    END IF;
    RETURN jsonb_build_object('stillTrue', v_event IS NOT NULL AND NOT coalesce(v_voided, false),
      'why', CASE WHEN v_event IS NULL THEN 'The billing change is no longer in the cockpit.'
                  WHEN v_voided THEN 'The billing change was voided before the notice went out.' END);
  ELSIF p_row.kind IN ('pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received') THEN
    -- Waves 3-4 (3.4): the client's answer the notice is about, read now.
    -- Names, dates and scores travel in the facts; nothing here is posted.
    IF coalesce(p_row.facts->>'responseId', '') ~ '^[0-9a-fA-F-]{36}$' THEN
      SELECT r.form_key, r.task_id, r.submitted_at INTO v_vform, v_resp_task, v_resp_at
        FROM public.cockpit_form_responses r
       WHERE r.id = (p_row.facts->>'responseId')::uuid AND r.state IN ('submitted','confirmed','legacy');
    END IF;
    IF v_vform IS NULL THEN
      RETURN jsonb_build_object('stillTrue', false, 'why', 'The answer is no longer in the cockpit.');
    END IF;
    IF p_row.kind = 'pause.consent' THEN
      -- The card's latest consent, and no pause recorded after it.
      v_newer := EXISTS (SELECT 1 FROM public.cockpit_form_responses r2
                          WHERE r2.form_key = 'pause_consent' AND r2.task_id = v_resp_task
                            AND r2.state IN ('submitted','confirmed') AND r2.submitted_at > v_resp_at);
      SELECT EXISTS (SELECT 1 FROM public.cockpit_billing_events e
                      WHERE e.clickup_task_id = v_resp_task AND e.kind = 'pause' AND e.at >= v_resp_at
                        AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id))
        INTO v_paused;
      RETURN jsonb_build_object('stillTrue', NOT v_newer AND NOT v_paused,
        'why', CASE WHEN v_newer THEN 'A newer pause consent came in before the notice went out.'
                    WHEN v_paused THEN 'The pause was confirmed in the cockpit before the notice went out.' END);
    ELSIF p_row.kind = 'voice.low' THEN
      IF v_resp_task IS NOT NULL AND to_regclass('public.cockpit_requests') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.cockpit_requests q WHERE q.type_key = ''client_low_score'''
                ' AND q.client_task_id = $1 AND q.created_at >= $2 AND q.state <> ''cancelled'')'
          INTO v_ticket USING v_resp_task, v_resp_at;
      END IF;
      RETURN jsonb_build_object('stillTrue', NOT coalesce(v_ticket, false),
        'why', CASE WHEN v_ticket THEN 'A low-score ticket was opened before the notice went out.' END);
    END IF;
    RETURN jsonb_build_object('stillTrue', true);
  ELSIF p_row.kind IN ('win.logged','receipt.in','client.reactivated') THEN
    -- Waves 5-6 (3.9): the win, the receipt or the return the notice is
    -- about, read now. The wins ledger arrives with 20261102h, so it is read
    -- by name; amounts travel in the facts and nothing here is posted.
    IF p_row.kind = 'win.logged' THEN
      IF to_regclass('public.cockpit_csm_wins') IS NULL OR coalesce(p_row.facts->>'winId', '') !~ '^[0-9a-fA-F-]{36}$' THEN
        RETURN jsonb_build_object('stillTrue', false, 'why', 'The win is no longer in the cockpit.');
      END IF;
      EXECUTE 'SELECT w.stage FROM public.cockpit_csm_wins w WHERE w.id = $1' INTO v_vform USING (p_row.facts->>'winId')::uuid;
      RETURN jsonb_build_object('stillTrue', v_vform IS NOT NULL AND v_vform <> 'void',
        'why', CASE WHEN v_vform IS NULL THEN 'The win is no longer in the cockpit.'
                    WHEN v_vform = 'void' THEN 'The win was voided before the notice went out.' END);
    ELSIF p_row.kind = 'receipt.in' THEN
      IF coalesce(p_row.facts->>'responseId', '') ~ '^[0-9a-fA-F-]{36}$' THEN
        SELECT r.form_key INTO v_vform FROM public.cockpit_form_responses r
         WHERE r.id = (p_row.facts->>'responseId')::uuid AND r.state IN ('submitted','confirmed');
      END IF;
      RETURN jsonb_build_object('stillTrue', v_vform IS NOT NULL,
        'why', CASE WHEN v_vform IS NULL THEN 'The receipt is no longer in the cockpit.' END);
    END IF;
    IF coalesce(p_row.facts->>'eventId', '') ~ '^[0-9]{1,18}$' THEN
      v_event := (p_row.facts->>'eventId')::bigint;
      IF NOT EXISTS (SELECT 1 FROM public.cockpit_billing_events e WHERE e.id = v_event AND e.kind = 'reactivate') THEN
        v_event := NULL;
      ELSE
        v_voided := EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = v_event);
      END IF;
    END IF;
    RETURN jsonb_build_object('stillTrue', v_event IS NOT NULL AND NOT coalesce(v_voided, false),
      'why', CASE WHEN v_event IS NULL THEN 'The return is no longer in the cockpit.'
                  WHEN v_voided THEN 'The return was voided before the notice went out.' END);
  END IF;
  IF p_row.task_id IS NULL OR p_row.kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.media') THEN
    RETURN '{}'::jsonb;
  END IF;
  SELECT o.client_status, o.card_updated_at, o.links INTO v_status, v_updated, v_links
    FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_row.task_id;
  IF p_row.kind = 'kickoff' THEN
    v_sub := public.cockpit_slack_notice_ts(p_row.facts->>'submittedAt');
    SELECT public.cockpit_slack_notice_role_of(s.sent_by_email) INTO v_by
      FROM public.cockpit_csm_form_sends s WHERE s.response_id = p_row.facts->>'responseId'
     ORDER BY s.sent_at DESC LIMIT 1;
    RETURN jsonb_build_object(
      'clientStatus', v_status,
      'cardUpdatedAt', public.cockpit_slack_notice_iso(v_updated),
      'blueprintLink', nullif(btrim(coalesce(v_links->>'blueprint_form', '')), '') IS NOT NULL,
      'looksDone', public.cockpit_slack_notice_card_done(v_status, v_updated, v_sub),
      'filledByRole', v_by,
      'dueBy', public.cockpit_slack_notice_iso(v_sub + interval '20 minutes'));
  ELSIF p_row.kind = 'kickoff.updated' THEN
    RETURN jsonb_build_object('clientStatus', v_status, 'cardUpdatedAt', public.cockpit_slack_notice_iso(v_updated));
  ELSIF p_row.kind = 'blueprint.close' THEN
    SELECT c.starts_at INTO v_launch FROM public.cockpit_csm_calls c
     WHERE c.task_id = p_row.task_id AND c.kind = 'launch' AND c.starts_at > now() AND c.status IN ('booked','confirmed')
     ORDER BY c.starts_at LIMIT 1;
    RETURN jsonb_build_object('clientStatus', v_status, 'launchCallAt', public.cockpit_slack_notice_iso(v_launch));
  END IF;
  RETURN jsonb_build_object('clientStatus', v_status);
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_inputs(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_kind text;
  v_task text;
  v_client text;
  v_forms jsonb;
  v_facts jsonb;
  v_row public.cockpit_slack_notices;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR NOT (p ? 'responseId' OR (p ? 'kind' AND p ? 'taskId' AND p ? 'facts')) THEN
    RAISE EXCEPTION 'Send {"responseId": ...} or {"kind": ..., "taskId": ..., "facts": {...}}.' USING ERRCODE = '22023';
  END IF;
  IF p ? 'responseId' THEN
    SELECT o.clickup_task_id, o.client_name, o.forms INTO v_task, v_client, v_forms
      FROM public.cockpit_client_onboarding o
     WHERE nullif(p->>'responseId', '') IS NOT NULL AND o.forms->'kickoff'->>'response_id' = p->>'responseId'
     ORDER BY o.synced_at DESC LIMIT 1;
    IF v_task IS NULL THEN
      RAISE EXCEPTION 'No kickoff with that response ID is in the mirror.' USING ERRCODE = '22023';
    END IF;
    v_kind := 'kickoff';
    v_facts := public.cockpit_slack_notice_kickoff_facts(v_task, v_client, v_forms, NULL);
  ELSE
    v_kind := p->>'kind';
    v_task := p->>'taskId';
    IF v_kind IS NULL OR v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','checkin.grade','checkin.recap_late',
                                       'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed',
                                       'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received',
                    'win.logged','receipt.in','client.reactivated') THEN
      RAISE EXCEPTION 'There is no notice called %.', coalesce(v_kind, '') USING ERRCODE = '22023';
    END IF;
    IF v_task IS NULL OR v_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN
      RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p->'facts') IS DISTINCT FROM 'object' OR octet_length((p->'facts')::text) > 16384 THEN
      RAISE EXCEPTION 'Send the facts as an object under 16 KB.' USING ERRCODE = '22023';
    END IF;
    v_facts := p->'facts';
    SELECT o.client_name INTO v_client FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = v_task;
    v_client := coalesce(v_client, nullif(v_facts->>'client', ''));
  END IF;
  v_row.kind := v_kind;
  v_row.task_id := v_task;
  v_row.client_name := v_client;
  v_row.facts := v_facts;
  RETURN jsonb_build_object(
    'kind', v_kind,
    'taskId', v_task,
    'clientName', v_client,
    'ref', 'CN-dryrun00',
    'facts', v_facts,
    'live', public.cockpit_slack_notice_live(v_row),
    'target', public.cockpit_slack_notice_target(v_kind),
    'threadTs', NULL,
    'mentions', public.cockpit_slack_notice_claim_mentions(v_kind, v_client));
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_doctor_inputs()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'channels', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'private', c.private, 'state', c.state)
                                           ORDER BY c.added_at, c.id)
                            FROM public.cockpit_slack_channels c WHERE c.state <> 'removed'), '[]'::jsonb),
    'settings', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', s.kind, 'enabled', s.enabled, 'channel', s.channel,
                                             'mentions', public.cockpit_slack_notice_mentions(s.mention_rule, s.mention_people, NULL))
                                           ORDER BY array_position(ARRAY['kickoff','kickoff.late','kickoff.second','kickoff.updated',
                                             'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer',
                                             'checkin.grade','checkin.recap_late',
                                             'termination.notice','termination.submitted','churn.confirmed',
                                             'extension.granted','pause.agreed','client.resumed',
                                             'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received',
                    'win.logged','receipt.in','client.reactivated'], s.kind))
                            FROM public.cockpit_slack_notice_settings s), '[]'::jsonb))
$function$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_settings_read()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_can jsonb;
  v_edit boolean;
  v_editors boolean;
  v_notices jsonb := '[]'::jsonb;
  v_shape text;
  v_last public.cockpit_slack_notices;
  v_test public.cockpit_slack_notices;
  v_test_view jsonb;
  s public.cockpit_slack_notice_settings;
BEGIN
  v_can := public.cockpit_slack_notice_viewer();
  v_edit := (v_can->>'edit')::boolean;
  v_editors := (v_can->>'editors')::boolean;

  FOR s IN
    SELECT * FROM public.cockpit_slack_notice_settings x
     ORDER BY array_position(ARRAY['kickoff','kickoff.late','kickoff.second','kickoff.updated',
                                   'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer',
                                   'checkin.grade','checkin.recap_late',
                                   'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed',
                                   'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received',
                    'win.logged','receipt.in','client.reactivated'], x.kind)
  LOOP
    v_shape := public.cockpit_slack_notice_shape(s.kind);
    v_last := NULL;
    SELECT * INTO v_last FROM public.cockpit_slack_notices n
     WHERE CASE s.kind
             WHEN 'kickoff.late' THEN n.kind = 'kickoff' AND n.variant = 'late'
             WHEN 'kickoff.second' THEN n.kind = 'kickoff' AND n.facts->>'second' = 'true'
             ELSE n.kind = s.kind END
     ORDER BY n.created_at DESC, n.id LIMIT 1;
    v_notices := v_notices || jsonb_build_array(jsonb_build_object(
      'kind', s.kind,
      'shape', v_shape,
      'on', s.enabled,
      'fixedOn', v_shape = 'variant',
      'channel', CASE WHEN v_shape = 'post' AND s.channel IS NOT NULL THEN
                   jsonb_build_object('id', s.channel, 'name', (SELECT c.name FROM public.cockpit_slack_channels c WHERE c.id = s.channel)) END,
      'mentionRule', to_jsonb(s.mention_rule),
      -- A named person reads as their role to everyone (the sentence the
      -- team sees); only an editor's picker shows the first name. `slack`
      -- says what the next notice does with them (contract X4).
      'mentionPeople', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', u.id,
                 'label', CASE WHEN pp.id IS NULL OR NOT pp.active THEN 'Not on the team list'
                               WHEN v_edit THEN split_part(btrim(pp.name), ' ', 1) || coalesce(', ' || nullif(btrim(pp.role), ''), '')
                               ELSE public.cockpit_slack_person_label(pp.role) END,
                 'role', CASE WHEN pp.id IS NULL OR NOT pp.active THEN 'a team member'
                              ELSE public.cockpit_slack_person_label(pp.role) END,
                 'slack', CASE WHEN pp.id IS NULL OR NOT pp.active THEN 'not_found'
                               ELSE public.cockpit_slack_person_state(pp.id) END,
                 'slackKnown', coalesce(pp.active, false) AND public.cockpit_slack_person_id(pp.id) IS NOT NULL)
               ORDER BY u.ord)
          FROM unnest(s.mention_people) WITH ORDINALITY AS u(id, ord)
          LEFT JOIN public.cockpit_people pp ON pp.id = u.id), '[]'::jsonb),
      'tags', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'rule', u.rule,
                 'found', EXISTS (SELECT 1 FROM jsonb_array_elements(m.list) e WHERE NOT coalesce((e->>'missing')::boolean, false)),
                 'slackKnown', EXISTS (SELECT 1 FROM jsonb_array_elements(m.list) e WHERE e->>'slackId' IS NOT NULL),
                 'checking', EXISTS (SELECT 1 FROM jsonb_array_elements(m.list) e
                                      WHERE e->>'slackId' IS NULL AND e->>'personId' ~ '^[0-9]+$'
                                        AND public.cockpit_slack_person_state((e->>'personId')::bigint) = 'checking'))
               ORDER BY u.ord)
          FROM unnest(s.mention_rule) WITH ORDINALITY AS u(rule, ord)
          CROSS JOIN LATERAL (SELECT public.cockpit_slack_notice_mentions(ARRAY[u.rule], '{}'::bigint[], NULL) AS list) m), '[]'::jsonb),
      'updatedBy', CASE WHEN s.updated_by = 'migration' THEN 'the migration'
                        ELSE coalesce(public.cockpit_slack_notice_role_of(s.updated_by), 'a team member') END,
      'updatedAt', s.updated_at,
      'last', public.cockpit_slack_notice_view(v_last)));
  END LOOP;

  v_test := NULL;
  SELECT * INTO v_test FROM public.cockpit_slack_notices n
   WHERE n.kind = 'rehearsal' AND auth.uid() IS NOT NULL AND n.facts->>'requestedBy' = auth.uid()::text
     AND n.created_at > now() - interval '1 hour'
   ORDER BY n.created_at DESC, n.id LIMIT 1;
  IF v_test.id IS NOT NULL THEN
    v_test_view := public.cockpit_slack_notice_view(v_test);
    v_test_view := jsonb_build_object('id', v_test.id, 'kind', v_test.facts->>'of', 'state', v_test.state,
      'at', v_test_view->'at', 'reason', v_test_view->'reason');
  END IF;

  RETURN jsonb_build_object(
    'can', jsonb_build_object('edit', v_edit, 'editors', v_editors),
    'notices', v_notices,
    'channels', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'private', c.private, 'state', c.state, 'note', c.note,
               'checkedAt', c.checked_at,
               'inUse', EXISTS (SELECT 1 FROM public.cockpit_slack_notice_settings x WHERE x.channel = c.id))
             ORDER BY c.added_at, c.id)
        FROM public.cockpit_slack_channels c WHERE c.state <> 'removed'), '[]'::jsonb),
    'people', CASE WHEN v_edit THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', pp.id,
               'label', split_part(btrim(pp.name), ' ', 1) || coalesce(', ' || nullif(btrim(pp.role), ''), ''))
             ORDER BY lower(pp.name), pp.id)
        FROM public.cockpit_people pp WHERE pp.active AND nullif(btrim(pp.email), '') IS NOT NULL), '[]'::jsonb)
      ELSE '[]'::jsonb END,
    'editors', CASE WHEN v_editors THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('memberId', e.member_id,
               'label', public.cockpit_slack_notice_seat_label(m.email, m.name)) ORDER BY e.added_at, e.member_id)
        FROM public.cockpit_forms_editors e JOIN public.cockpit_members m ON m.id = e.member_id), '[]'::jsonb)
      ELSE '[]'::jsonb END,
    'members', CASE WHEN v_editors THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('memberId', m.id,
               'label', public.cockpit_slack_notice_seat_label(m.email, m.name)) ORDER BY lower(m.email), m.id)
        FROM public.cockpit_members m
       WHERE m.active AND NOT ('admin' = ANY(m.roles))
         AND lower(btrim(m.email)) NOT IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')
         AND NOT EXISTS (SELECT 1 FROM public.cockpit_forms_editors e WHERE e.member_id = m.id)), '[]'::jsonb)
      ELSE '[]'::jsonb END,
    'test', v_test_view,
    'now', now());
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_settings_set(p_kind text, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  g jsonb;
  s public.cockpit_slack_notice_settings;
  v_key text;
  v_shape text;
  v_on boolean;
  v_channel text;
  v_rule text[];
  v_people bigint[];
BEGIN
  g := public.cockpit_forms_editor_gate();
  SELECT * INTO s FROM public.cockpit_slack_notice_settings x WHERE x.kind = p_kind FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no notice called %.', coalesce(p_kind, '') USING ERRCODE = '22023';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Send the changes as an object.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('on','channel','mentionRule','mentionPeople') THEN
      RAISE EXCEPTION 'Unknown setting: %.', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_shape := public.cockpit_slack_notice_shape(s.kind);
  v_on := s.enabled;
  v_channel := s.channel;
  v_rule := s.mention_rule;
  v_people := s.mention_people;

  IF p_patch ? 'on' THEN
    IF jsonb_typeof(p_patch->'on') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'Send on as true or false.' USING ERRCODE = '22023';
    END IF;
    IF v_shape = 'variant' AND NOT (p_patch->>'on')::boolean THEN
      RAISE EXCEPTION 'This one is part of the kickoff notice and stays on. Turn the kickoff notice off instead.' USING ERRCODE = '22023';
    END IF;
    v_on := (p_patch->>'on')::boolean;
  END IF;

  IF p_patch ? 'channel' THEN
    IF v_shape <> 'post' THEN
      RAISE EXCEPTION 'Replies post in their first notice''s thread.' USING ERRCODE = '22023';
    END IF;
    v_channel := upper(btrim(CASE WHEN jsonb_typeof(p_patch->'channel') = 'string' THEN p_patch->>'channel' END));
    IF v_channel IS NULL OR NOT EXISTS (SELECT 1 FROM public.cockpit_slack_channels c WHERE c.id = v_channel AND c.state = 'ok') THEN
      RAISE EXCEPTION 'Add that channel under Channels first; the cockpit checks the bot is in it.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'mentionRule' THEN
    IF jsonb_typeof(p_patch->'mentionRule') IS DISTINCT FROM 'array' OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'mentionRule') e
          WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') NOT IN ('seat:creative','seat:csm','seat:systems_manager')) THEN
      RAISE EXCEPTION 'Choose who to tag from the list.' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(array_agg(q.v ORDER BY q.first), '{}'::text[]) INTO v_rule
      FROM (SELECT t.v, min(t.ord) AS first FROM jsonb_array_elements_text(p_patch->'mentionRule') WITH ORDINALITY AS t(v, ord)
             GROUP BY t.v) q;
  END IF;

  IF p_patch ? 'mentionPeople' THEN
    IF jsonb_typeof(p_patch->'mentionPeople') IS DISTINCT FROM 'array' OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'mentionPeople') e
          WHERE jsonb_typeof(e) NOT IN ('number','string') OR (e #>> '{}') !~ '^[0-9]{1,18}$') THEN
      RAISE EXCEPTION 'Choose people from the team list.' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(array_agg(q.v ORDER BY q.first), '{}'::bigint[]) INTO v_people
      FROM (SELECT (t.e #>> '{}')::bigint AS v, min(t.ord) AS first
              FROM jsonb_array_elements(p_patch->'mentionPeople') WITH ORDINALITY AS t(e, ord)
             GROUP BY (t.e #>> '{}')::bigint) q;
    IF cardinality(v_people) > 10 OR EXISTS (
         SELECT 1 FROM unnest(v_people) AS u(id)
          WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_people pp
                             WHERE pp.id = u.id AND pp.active AND nullif(btrim(pp.email), '') IS NOT NULL)) THEN
      RAISE EXCEPTION 'Choose people from the team list.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- The call grade (2b) is about a person's call: it tags nobody and posts
  -- only in a channel the cockpit has checked as private.
  IF s.kind = 'checkin.grade' THEN
    IF cardinality(v_rule) > 0 OR cardinality(v_people) > 0 THEN
      RAISE EXCEPTION 'The call grade tags nobody.' USING ERRCODE = '22023';
    END IF;
    IF p_patch ? 'channel' AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_channels c
                                            WHERE c.id = v_channel AND c.private IS TRUE) THEN
      RAISE EXCEPTION 'The call grade posts only in a private channel. Choose one the cockpit has checked as private.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Termination survey sent stays off while Make's own post still runs in
  -- #csm-announcements (W4): one post per event per channel. Wave 3 (C4b)
  -- merges {"c4b": true} into forms.doors when that post is off.
  IF s.kind = 'termination.submitted' AND v_on AND NOT s.enabled
     AND coalesce((SELECT c.value->>'c4b' FROM public.cockpit_settings c WHERE c.key = 'forms.doors'), '') <> 'true' THEN
    RAISE EXCEPTION 'Termination survey sent stays off while the old Make post still runs in #csm-announcements. It turns on when that post is switched off.'
      USING ERRCODE = '22023';
  END IF;

  -- Win logged stays off while the five Four Rs Make scenarios still post
  -- in #csm-announcements (waves 5-6, 4.7): D-W turns Log a win on (the
  -- forms.doors marker wins) in the hour those scenarios go off, then this.
  IF s.kind = 'win.logged' AND v_on AND NOT s.enabled
     AND coalesce((SELECT c.value->>'wins' FROM public.cockpit_settings c WHERE c.key = 'forms.doors'), '') <> 'true' THEN
    RAISE EXCEPTION 'Win logged stays off until Log a win is switched on, because the old Four Rs posts still run in #csm-announcements.'
      USING ERRCODE = '22023';
  END IF;

  IF (v_on, v_channel, v_rule, v_people) IS NOT DISTINCT FROM (s.enabled, s.channel, s.mention_rule, s.mention_people) THEN
    RETURN public.cockpit_slack_notice_settings_read();
  END IF;
  UPDATE public.cockpit_slack_notice_settings
     SET enabled = v_on, channel = v_channel, mention_rule = v_rule, mention_people = v_people,
         updated_by = g->>'email', updated_at = now()
   WHERE kind = s.kind;
  -- Everyone the change tags with no Slack id yet is checked by the sender
  -- within a minute: the named people, and whoever holds the seats now.
  IF (v_rule, v_people) IS DISTINCT FROM (s.mention_rule, s.mention_people) THEN
    PERFORM public.cockpit_slack_people_queue(
      v_people || coalesce((SELECT array_agg(DISTINCT (e->>'personId')::bigint)
                              FROM jsonb_array_elements(public.cockpit_slack_notice_mentions(v_rule, '{}'::bigint[], NULL)) e
                             WHERE e->>'personId' ~ '^[0-9]+$' AND e->>'slackId' IS NULL), '{}'::bigint[]),
      g->>'email');
  END IF;
  RETURN public.cockpit_slack_notice_settings_read();
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_channel_remove(p_channel text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE g jsonb; c public.cockpit_slack_channels; v_kind text; v_id text := upper(btrim(coalesce(p_channel, '')));
BEGIN
  g := public.cockpit_forms_editor_gate();
  SELECT * INTO c FROM public.cockpit_slack_channels x WHERE x.id = v_id FOR UPDATE;
  IF NOT FOUND OR c.state = 'removed' THEN
    RAISE EXCEPTION 'That channel is not on the list.' USING ERRCODE = '22023';
  END IF;
  SELECT s.kind INTO v_kind FROM public.cockpit_slack_notice_settings s WHERE s.channel = v_id
   ORDER BY array_position(ARRAY['kickoff','blueprint.close','blueprint.media','checkin.grade','checkin.recap_late',
                                 'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed',
                                 'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received',
                    'win.logged','receipt.in','client.reactivated'], s.kind) LIMIT 1;
  IF v_kind IS NOT NULL THEN
    RAISE EXCEPTION 'The % notice posts there. Choose another channel for it first.', public.cockpit_slack_notice_kind_label(v_kind)
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.cockpit_slack_channels SET state = 'removed', note = 'Removed from the list.', updated_at = now() WHERE id = v_id;
  RETURN public.cockpit_slack_notice_settings_read();
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_rehearse(p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE g jsonb; v_uid text; v_kind text := coalesce(nullif(btrim(p_kind), ''), 'kickoff'); v_id uuid;
BEGIN
  g := public.cockpit_forms_editor_gate();
  v_uid := g->>'actorId';
  IF v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','checkin.grade','checkin.recap_late',
                    'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed',
                    'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received',
                    'win.logged','receipt.in','client.reactivated') THEN
    RAISE EXCEPTION 'There is no notice called %.', v_kind USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_slack_rehearse:' || v_uid, 0));
  IF EXISTS (SELECT 1 FROM public.cockpit_slack_notices n
              WHERE n.kind = 'rehearsal' AND n.facts->>'requestedBy' = v_uid AND n.state IN ('queued','sending')) THEN
    RAISE EXCEPTION 'A test is already on its way. Wait for it, then send another.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.cockpit_slack_notices n
       WHERE n.kind = 'rehearsal' AND n.facts->>'requestedBy' = v_uid AND n.created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'That is five tests in an hour. Try again later.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_slack_notices(kind, dedupe_key, task_id, target, facts)
  VALUES ('rehearsal', 'rehearsal:' || gen_random_uuid()::text, NULL, NULL,
          jsonb_build_object('of', v_kind, 'variant', NULL, 'sample', true, 'requestedBy', v_uid))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'state', 'queued',
    'note', 'Your test reaches your Slack direct messages within a minute.');
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_rehearse_service(p_kind text, p_target text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_kind text := coalesce(nullif(btrim(p_kind), ''), 'kickoff'); v_id uuid;
BEGIN
  IF v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','checkin.grade','checkin.recap_late',
                    'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed',
                    'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received',
                    'win.logged','receipt.in','client.reactivated') THEN
    RAISE EXCEPTION 'There is no notice called %.', v_kind USING ERRCODE = '22023';
  END IF;
  IF p_target IS NULL OR p_target !~ '^[UW][A-Z0-9]{8,12}$' THEN
    RAISE EXCEPTION 'Send a Slack member ID (it starts with U or W).' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  INSERT INTO public.cockpit_slack_notices(kind, dedupe_key, task_id, target, facts)
  VALUES ('rehearsal', 'rehearsal:' || gen_random_uuid()::text, NULL, p_target,
          jsonb_build_object('of', v_kind, 'variant', NULL, 'sample', true, 'requestedBy', 'cron'))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_read(p_task_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_ok boolean := false; v_msg text; v_code text; v_name text; v_checkin boolean := false;
  v_creative boolean := false; v_finance boolean := false;
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  IF coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false) THEN
    v_ok := true;
    v_checkin := true;
  ELSE
    BEGIN
      PERFORM public.cockpit_csm_client_gate(p_task_id);
      v_ok := true;
      v_checkin := true;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_code = RETURNED_SQLSTATE;
    END;
    IF NOT v_ok AND coalesce(public.cockpit_has_role('creative'), false) THEN
      SELECT o.client_name INTO v_name FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task_id;
      IF v_name IS NULL THEN
        SELECT n.client_name INTO v_name FROM public.cockpit_slack_notices n
         WHERE n.task_id = p_task_id AND n.client_name IS NOT NULL ORDER BY n.created_at DESC LIMIT 1;
      END IF;
      v_creative := coalesce(public.cockpit_client_allowed(v_name), false);
      v_ok := v_creative;
    END IF;
    -- Waves 5-6 (3.9): wins and money news joins the same two lists below.
    -- The client lifecycle notices (waves 1-2, 3.4) and the client's voice
    -- (waves 3-4, 3.4) are money, status and client news: finance sees them
    -- on every card, and only them.
    IF NOT v_checkin AND coalesce(public.cockpit_has_role('finance'), false) THEN
      v_finance := true;
      v_ok := true;
    END IF;
    IF NOT v_ok THEN
      IF coalesce(public.cockpit_has_role('csm'), false) AND v_msg IS NOT NULL THEN
        RAISE EXCEPTION USING MESSAGE = v_msg, ERRCODE = coalesce(v_code, '42501');
      END IF;
      RAISE EXCEPTION 'That client is not on your access list' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'taskId', p_task_id,
    'now', now(),
    'notices', coalesce((SELECT jsonb_agg(v.j ORDER BY v.created_at DESC, v.id)
                           FROM (SELECT public.cockpit_slack_notice_view(x) AS j, x.created_at, x.id
                                   FROM public.cockpit_slack_notices x
                                  WHERE x.task_id = p_task_id AND x.kind <> 'rehearsal'
                                    -- The 1-1 notes notices are client success's: never a creative-only seat's.
                                    AND (v_checkin OR x.kind NOT LIKE 'checkin.%')
                                    -- Lifecycle news is client success's, finance's and the CEO's,
                                    -- never a creative-only seat's; a finance seat sees only it.
                                    AND (v_checkin
                                         OR (v_creative AND x.kind NOT IN ('termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed',
                                                                       'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received',
                    'win.logged','receipt.in','client.reactivated'))
                                         OR (v_finance AND x.kind IN ('termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed',
                                                                 'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received',
                    'win.logged','receipt.in','client.reactivated')))
                                  ORDER BY x.created_at DESC, x.id LIMIT 20) v), '[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_billing_writeback_writes(p_kind text, p_from text, p_to text, p_detail jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
 d jsonb:=CASE WHEN jsonb_typeof(p_detail)='object' THEN p_detail ELSE '{}'::jsonb END;
 w jsonb:='[]'::jsonb;
 num text:='^-?[0-9]+(\.[0-9]+)?$';
 v_reason text;
BEGIN
 CASE p_kind
 WHEN 'method' THEN w:=jsonb_build_array(jsonb_build_object('field','method','value',p_to,'old',p_from));
 WHEN 'plan' THEN w:=jsonb_build_array(jsonb_build_object('field','plan','value',p_to,'old',p_from));
 WHEN 'amount' THEN w:=jsonb_build_array(jsonb_build_object('field','nextAmount',
   'value',CASE WHEN p_to~num THEN p_to::numeric END,'old',CASE WHEN p_from~num THEN p_from::numeric END));
 WHEN 'date' THEN w:=jsonb_build_array(jsonb_build_object('field','nextDate','value',p_to,'old',p_from));
 WHEN 'extension' THEN
  -- A system clear carries weeks 0 and no moved date: the field goes back to 0.
  w:=jsonb_build_array(jsonb_build_object('field','extension','value',CASE WHEN d->>'weeks'~num THEN (d->>'weeks')::numeric END));
  IF d->'movedDate'='true'::jsonb THEN
   w:=w||jsonb_build_object('field','nextDate','value',coalesce(p_to,d->>'new_date'),'old',p_from);
  END IF;
  IF jsonb_typeof(d->'at_risk')='boolean' THEN w:=w||jsonb_build_object('field','willNotContinue','value',d->'at_risk'); END IF;
 WHEN 'pause' THEN
  w:=jsonb_build_array(jsonb_build_object('field','status','value','Paused','old',p_from),
                       jsonb_build_object('field','pausedOn','value',d->>'on'),
                       jsonb_build_object('field','resumeOn','value',d->>'restart'));
 WHEN 'resume' THEN
  -- Paused On is cleared, or the next pause is measured from this one (billingCore); Resume On goes with it.
  w:=jsonb_build_array(jsonb_build_object('field','status','value','Active','old',p_from),
                       jsonb_build_object('field','pausedOn','value',NULL,'clear',true),
                       jsonb_build_object('field','resumeOn','value',NULL,'clear',true));
  IF d->>'nextDate' IS NOT NULL THEN w:=w||jsonb_build_object('field','nextDate','value',d->>'nextDate'); END IF;
 WHEN 'payment' THEN
  IF p_to IS NOT NULL AND p_to IS DISTINCT FROM p_from THEN
   w:=jsonb_build_array(jsonb_build_object('field','nextDate','value',p_to,'old',p_from));
  END IF;
 WHEN 'churn' THEN
  -- The date first: a ClickUp automation appears to date cards when Client Status moves (20261101g).
  v_reason:=CASE WHEN d ? 'card_reason' THEN d->>'card_reason' ELSE public.cockpit_churn_reason_card(d->>'reason') END;
  w:=jsonb_build_array(jsonb_build_object('field','churnDate','value',d->>'left_on'),
                       jsonb_build_object('field','status','value','Stopped','old',p_from),
                       jsonb_build_object('field','churnReason','value',v_reason),
                       jsonb_build_object('field','churnType','value',d->>'card_type'));
  IF d->'clear_paused'='true'::jsonb THEN w:=w||jsonb_build_object('field','pausedOn','value',NULL,'clear',true); END IF;
 WHEN 'mrr' THEN w:=jsonb_build_array(jsonb_build_object('field','mrr',
   'value',CASE WHEN p_to~num THEN p_to::numeric END,'old',CASE WHEN p_from~num THEN p_from::numeric END));
 WHEN 'ltv' THEN w:=jsonb_build_array(jsonb_build_object('field','ltv','value',CASE WHEN p_to~num THEN p_to::numeric END));
 -- Waves 3-4 (20261102b, contract 3.8): NPS Survey Sent is the Kuwait day the NPS invite went out.
 WHEN 'nps_sent' THEN w:=jsonb_build_array(jsonb_build_object('field','npsSent','value',d->>'on'));
 -- An exit survey changes no card field (D11): its comment is its whole write.
 WHEN 'survey' THEN NULL;
 -- Waves 5-6 (20261102g, contract 3.5): a win writes no field, its comment is its whole write.
 WHEN 'win' THEN NULL;
 -- A churned client returning: the status back, the churn and pause fields cleared, then the date.
 WHEN 'reactivate' THEN
  w:=jsonb_build_array(jsonb_build_object('field','status','value',d->>'status','old',p_from),
                       jsonb_build_object('field','churnDate','value',NULL,'clear',true),
                       jsonb_build_object('field','churnReason','value',NULL,'clear',true),
                       jsonb_build_object('field','churnType','value',NULL,'clear',true),
                       jsonb_build_object('field','pausedOn','value',NULL,'clear',true),
                       jsonb_build_object('field','resumeOn','value',NULL,'clear',true));
  IF d->>'next_date' IS NOT NULL THEN w:=w||jsonb_build_object('field','nextDate','value',d->>'next_date'); END IF;
 ELSE NULL; -- late and every other kind write no field (a late close writes its comment only).
 END CASE;
 -- A value the event does not carry is not guessed; only a deliberate clear is empty.
 RETURN (SELECT coalesce(jsonb_agg(x-'clear' ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(w) WITH ORDINALITY AS t(x,n)
         WHERE x->'value'<>'null'::jsonb OR x->'clear'='true'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_billing_writeback_comment(p_kind text, p_from text, p_to text, p_detail jsonb, p_client text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  d jsonb := CASE WHEN jsonb_typeof(p_detail) = 'object' THEN p_detail ELSE '{}'::jsonb END;
  l text[] := '{}';
  v_by text := CASE d->>'seat_role' WHEN 'csm' THEN 'the CSM' WHEN 'finance' THEN 'finance'
                                    WHEN 'ceo' THEN 'the CEO' WHEN 'system' THEN 'the cockpit'
                                    WHEN 'the CSM' THEN 'the CSM' WHEN 'the CEO' THEN 'the CEO'
                                    WHEN 'the cockpit' THEN 'the cockpit' END;
  -- Waves 5-6 (3.5): the two system categories read as words; every other category as before.
  v_why text := nullif(concat_ws(': ', nullif(btrim(coalesce(CASE d->>'reason_cat' WHEN 'new_client' THEN 'New client'
                                                               WHEN 'reactivation' THEN 'Reactivation'
                                                               ELSE d->>'reason_cat' END, '')), ''),
                                       nullif(btrim(coalesce(d->>'reason', '')), '')), '');
  v_n integer;
  v_text text;
  v_from numeric;
  v_to numeric;
  v_part text;
BEGIN
  CASE p_kind
  WHEN 'extension' THEN
    IF coalesce(d->>'weeks', '') !~ '^[1-9][0-9]*$' THEN RETURN NULL; END IF; -- a system clear posts nothing
    v_n := (d->>'weeks')::integer;
    v_text := coalesce(d->>'new_date', CASE WHEN d->'movedDate' = 'true'::jsonb THEN p_to END);
    l := l || ('CLIENT EXTENSION: ' || v_n || CASE WHEN v_n = 1 THEN ' week' ELSE ' weeks' END || coalesce(', to ' || v_text, ''));
    IF v_why IS NOT NULL THEN l := l || ('Why: ' || v_why); END IF;
    IF jsonb_typeof(d->'ours') = 'boolean' THEN
      l := l || ('Ours to control: ' || CASE WHEN (d->>'ours')::boolean THEN 'yes' ELSE 'no' END);
    END IF;
    IF jsonb_typeof(d->'limitations') = 'array' AND jsonb_array_length(d->'limitations') > 0 THEN
      l := l || ('Client limits: ' || (SELECT string_agg(x, ', ' ORDER BY n) FROM jsonb_array_elements_text(d->'limitations') WITH ORDINALITY AS t(x, n)));
    END IF;
    IF jsonb_typeof(d->'at_risk') = 'boolean' THEN
      l := l || ('Will not continue if billed on schedule: ' || CASE WHEN (d->>'at_risk')::boolean THEN 'yes' ELSE 'no' END);
    END IF;
    IF d ? 'call_on' OR d ? 'call_id' THEN l := l || ('Call: ' || coalesce(d->>'call_on', 'logged in the cockpit'));
    ELSIF d ? 'no_call_reason' THEN l := l || ('No call: ' || (d->>'no_call_reason'));
    END IF;
  WHEN 'pause' THEN
    l := l || ('PAUSE AGREED ' || coalesce(d->>'on', 'today') || ' to ' || coalesce(d->>'restart', 'no restart date'));
    IF d ? 'pause_kind' THEN
      l := l || ('Kind: ' || CASE d->>'pause_kind' WHEN 'non_payment' THEN 'non-payment' ELSE 'client request' END);
    END IF;
    IF v_why IS NOT NULL THEN l := l || ('Why: ' || v_why); END IF;
    IF d->'consent'->>'kind' = 'call' THEN
      l := l || ('Consent: on the call ' || coalesce(d->>'call_on', 'logged in the cockpit'));
    -- Waves 3-4 (20261102b): the client's own signed consent; the day only, never a name or an address.
    ELSIF d->'consent'->>'kind' = 'signed' THEN
      l := l || ('Consent: signed ' || CASE d->'consent'->>'via' WHEN 'link' THEN 'by link' ELSE 'in the portal' END
                 || coalesce(' ' || nullif(left(coalesce(d->'consent'->>'signed_at', ''), 10), ''), ''));
    ELSIF d->'consent'->>'kind' IS NOT NULL THEN
      l := l || ('Consent: ' || (d->'consent'->>'kind'));
    END IF;
  WHEN 'resume' THEN
    l := l || ('RESUMED ' || coalesce(d->>'on', 'today'));
    IF d ? 'nextDate' THEN l := l || ('Next payment: ' || (d->>'nextDate')); END IF;
  WHEN 'churn' THEN
    l := l || ('CHURN CONFIRMED: left ' || coalesce(d->>'left_on', 'on a day not recorded'));
    IF d ? 'reason' THEN
      l := l || ('Reason: ' || (d->>'reason'));
      -- No write reaches the field in either case, so the card keeps whatever reason it holds.
      IF lower(btrim(d->>'reason')) = 'other' THEN
        l := l || 'Reason Other: the card''s Churn Reason is left as it is.'::text;
      ELSIF d ? 'card_reason' AND d->>'card_reason' IS NULL THEN
        l := l || 'Not on the card''s list, so the card''s Churn Reason is left as it is.'::text;
      END IF;
    END IF;
    IF coalesce(d->>'card_type', d->>'churn_type') IS NOT NULL THEN
      l := l || ('Type: ' || coalesce(d->>'card_type', d->>'churn_type'));
    END IF;
    IF d ? 'why_detail' THEN l := l || ('Why: ' || (d->>'why_detail')); END IF;
    IF d ? 'notice_on' THEN l := l || ('Notice on: ' || (d->>'notice_on')); END IF;
    IF d ? 'survey_state' THEN
      l := l || ('Exit survey: ' || CASE d->>'survey_state' WHEN 'not_sent' THEN 'not sent' WHEN 'filled' THEN 'filled in'
                                                              ELSE d->>'survey_state' END);
    END IF;
  WHEN 'mrr' THEN
    v_from := CASE WHEN p_from ~ '^-?[0-9]+(\.[0-9]+)?$' THEN p_from::numeric END;
    v_to := CASE WHEN p_to ~ '^-?[0-9]+(\.[0-9]+)?$' THEN p_to::numeric END;
    IF v_to IS NULL THEN RETURN NULL; END IF;
    l := l || ('MRR '
      || coalesce('$' || to_char(v_from, CASE WHEN v_from = trunc(v_from) THEN 'FM999,999,990' ELSE 'FM999,999,990.00' END), 'none')
      || ' → $' || to_char(v_to, CASE WHEN v_to = trunc(v_to) THEN 'FM999,999,990' ELSE 'FM999,999,990.00' END)
      || coalesce(' from ' || (d->>'effective'), ''));
    IF v_why IS NOT NULL THEN l := l || ('Why: ' || v_why); END IF;
  WHEN 'survey' THEN
    -- The exit survey's answer on the card (contract 3.8): reasons, the three
    -- ratings, the recommend score and the two typed answers (each at most 300
    -- characters, cut by the detail builder). No name, no address, no field.
    l := l || ('CONTRACT TERMINATION SURVEY (notice received ' || coalesce(d->>'notice_on', 'on a day not recorded') || ')');
    l := l || ('Why: ' || coalesce((SELECT string_agg(CASE x WHEN 'results' THEN 'The results'
                                                              WHEN 'company_changes' THEN 'Changes in their company'
                                                              WHEN 'cheaper_provider' THEN 'A cheaper provider'
                                                              WHEN 'in_house' THEN 'Moving it in-house'
                                                              WHEN 'other' THEN 'Something else'
                                                              ELSE x END, ', ' ORDER BY n)
                                      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d->'reasons') = 'array'
                                                                          THEN d->'reasons' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(x, n)),
                                    'not said'));
    l := l || ('Ads ' || coalesce((d->'ratings'->>'ads') || '/10', 'not rated')
               || ' · The people who reached them ' || coalesce((d->'ratings'->>'people') || '/10', 'not rated')
               || ' · Communication ' || coalesce((d->'ratings'->>'comms') || '/10', 'not rated'));
    l := l || ('Would recommend: ' || coalesce((d->>'recommend') || '/10', 'not said'));
    l := l || ('What would have kept them: ' || coalesce(nullif(btrim(coalesce(d->>'kept_us', '')), ''), 'not said'));
    l := l || ('Comments: ' || coalesce(nullif(btrim(coalesce(d->>'comments', '')), ''), 'none'));
    l := l || ('Filled: ' || CASE d->>'via' WHEN 'portal' THEN 'in the portal' WHEN 'link' THEN 'by link' ELSE 'not recorded' END);
    l := l || 'Confirm the churn or answer the notice in the cockpit.'::text;
    RETURN array_to_string(l, E'\n');
  WHEN 'late' THEN
    IF NOT d ? 'closes' OR coalesce(d->>'days_late', '') !~ '^[0-9]+$' THEN RETURN NULL; END IF; -- an open spell posts nothing
    v_n := (d->>'days_late')::integer;
    RETURN 'LATE ' || v_n || CASE WHEN v_n = 1 THEN ' day' ELSE ' days' END || coalesce(': due ' || (d->>'due'), '') || ', '
      || CASE WHEN d ? 'paid_on' THEN 'paid ' || (d->>'paid_on')
              WHEN d->>'closed_how' = 'extended' THEN 'extension moved the date'
              WHEN d->>'closed_how' = 'stopped' THEN 'client stopped'
              ELSE 'the date moved on the card' END;
  WHEN 'win' THEN
    -- Waves 5-6 (3.5): the win on the card; a link or "on file", never an email or a name.
    l := l || ('WIN: ' || CASE d->>'kind' WHEN 'review' THEN 'Google review' WHEN 'video_testimonial' THEN 'Video testimonial'
                                          WHEN 'podcast' THEN 'Podcast case study' WHEN 'referral' THEN 'Referral'
                                          WHEN 'renewal' THEN 'Renewal' WHEN 'reactivation' THEN 'Reactivation'
                                          WHEN 'upsell_website' THEN 'Website' WHEN 'upsell_smm' THEN 'Social media management'
                                          WHEN 'upsell_backend' THEN 'Back-end programme' WHEN 'upsell_seo_geo' THEN 'SEO and AI search'
                                          WHEN 'upsell_second_campaign' THEN 'Second campaign' ELSE 'a win' END
               || ' on ' || coalesce(d->>'won_on', 'a day not recorded'));
    v_to := CASE WHEN d->>'quoted_usd' ~ '^[0-9]+(\.[0-9]+)?$' THEN (d->>'quoted_usd')::numeric END;
    l := l || ('Stage: ' || CASE d->>'stage' WHEN 'quote_given' THEN 'Offered at '
                                    || coalesce('$' || to_char(v_to, CASE WHEN v_to = trunc(v_to) THEN 'FM999,999,990' ELSE 'FM999,999,990.00' END), 'a price not recorded')
                                  WHEN 'signed' THEN 'Accepted' WHEN 'paid' THEN 'Paid' WHEN 'void' THEN 'Voided' ELSE 'Logged' END);
    l := l || ('Proof: ' || coalesce(nullif(btrim(coalesce(d->>'proof_url', '')), ''), nullif(btrim(coalesce(d->>'agreement', '')), ''),
                                     'on file in the cockpit'));
  WHEN 'reactivate' THEN
    l := l || ('REACTIVATED ' || coalesce(d->>'return_on', 'today'));
    l := l || ('Back as: ' || coalesce(d->>'status', 'a status not recorded'));
    l := l || ('Churned ' || coalesce(d->>'left_on', 'on a day not recorded') || ': ' || coalesce(nullif(btrim(coalesce(d->>'reason_was', '')), ''), 'no reason recorded')
               || coalesce(' (' || nullif(btrim(coalesce(d->>'type_was', '')), '') || ')', ''));
    IF nullif(btrim(coalesce(d->>'why', '')), '') IS NOT NULL THEN l := l || ('Why they came back: ' || btrim(d->>'why')); END IF;
  WHEN 'date' THEN
    -- Only a date Confirm paid moved (20261102g, 4.6) says why on the card; a hand edit posts nothing, as before.
    IF NOT d ? 'confirm_id' THEN RETURN NULL; END IF;
    v_part := CASE WHEN d->>'part_no' ~ '^[0-9]{1,2}$' THEN 'payment ' || ((d->>'part_no')::integer + 1) || ' of the plan' ELSE 'a payment of the plan' END;
    l := l || ('NEXT PAYMENT ' || coalesce(p_from, 'none') || ' → ' || coalesce(p_to, 'none'));
    l := l || ('Because: ' || CASE WHEN d->>'from_rule' = 'withdraw' THEN 'the confirm of ' || v_part || ' was withdrawn'
                                   ELSE v_part || ' was confirmed paid' || coalesce(' on ' || (d->>'paid_on'), '') END);
  ELSE
    RETURN NULL; -- method, plan, amount, payment, note, ltv and nps_sent post no comment (a note is its own comment)
  END CASE;
  IF v_by IS NOT NULL THEN l := l || ('By: ' || v_by); END IF;
  RETURN array_to_string(l, E'\n');
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_billing_detail(p_kind text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  a jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_seat text := nullif(btrim(coalesce(a->>'seatRole', '')), '');
  d jsonb;
  v_extra jsonb := '{}'::jsonb;
  k text;
  v_type text;
BEGIN
  IF v_seat IS NOT NULL AND v_seat NOT IN ('csm', 'finance', 'ceo', 'system') THEN
    RAISE EXCEPTION 'A billing change comes from the CSM, finance, the CEO or the cockpit, not %.', v_seat USING ERRCODE = '22023';
  END IF;
  d := jsonb_build_object('request_id', a->'requestId', 'response_id', a->'responseId', 'seat_role', v_seat);
  CASE p_kind
  WHEN 'extension' THEN
    IF a->'system' = 'true'::jsonb THEN
      d := d || jsonb_build_object('weeks', 0, 'reason', 'grant ended', 'grant_id', a->'grantId');
    ELSE
      IF coalesce(a->>'weeks', '') NOT IN ('1', '2', '4') THEN
        RAISE EXCEPTION 'Give 1, 2 or 4 weeks.' USING ERRCODE = '22023';
      END IF;
      d := d || jsonb_build_object(
        'weeks', (a->>'weeks')::integer,
        'ours', CASE WHEN jsonb_typeof(a->'ours') = 'boolean' THEN a->'ours' END,
        -- Extend always moves the date (W13).
        'movedDate', CASE WHEN jsonb_typeof(a->'movedDate') = 'boolean' THEN a->'movedDate' ELSE 'true'::jsonb END,
        'new_date', a->>'newDate', 'from', a->>'from',
        'reason_cat', a->>'reasonCat', 'reason', a->>'reason',
        'limitations', CASE WHEN jsonb_typeof(a->'limitations') = 'array' AND jsonb_array_length(a->'limitations') > 0 THEN a->'limitations' END,
        'at_risk', CASE WHEN jsonb_typeof(a->'atRisk') = 'boolean' THEN a->'atRisk' END,
        'call_id', a->>'callId', 'call_on', a->>'callOn', 'no_call_reason', a->>'noCallReason',
        'prevent', a->>'prevent', 'replaces_grant_id', a->'replacesGrantId');
    END IF;
  WHEN 'pause' THEN
    IF coalesce(a->>'pauseKind', 'client_request') NOT IN ('client_request', 'non_payment') THEN
      RAISE EXCEPTION 'A pause is a client request or non-payment.' USING ERRCODE = '22023';
    END IF;
    d := d || jsonb_build_object(
      'pause_kind', a->>'pauseKind', 'on', a->>'on', 'restart', a->>'restart',
      'reason_cat', a->>'reasonCat', 'reason', a->>'reason',
      'call_id', a->>'callId', 'call_on', a->>'callOn',
      'consent', CASE WHEN jsonb_typeof(a->'consent') = 'object' THEN jsonb_strip_nulls(jsonb_build_object(
                   'kind', a->'consent'->>'kind', 'call_id', a->'consent'->>'call_id', 'evidence_url', a->'consent'->>'evidence_url',
                   -- Waves 3-4 (20261102b): a signed consent names its response, when and how it was signed.
                   'response_id', a->'consent'->>'response_id', 'signed_at', a->'consent'->>'signed_at',
                   'via', CASE WHEN a->'consent'->>'via' IN ('portal', 'link') THEN a->'consent'->>'via' END,
                   'term_runs', CASE WHEN jsonb_typeof(a->'consent'->'term_runs') = 'boolean' THEN a->'consent'->'term_runs' END,
                   'over_14_ends', CASE WHEN jsonb_typeof(a->'consent'->'over_14_ends') = 'boolean' THEN a->'consent'->'over_14_ends' END)) END);
  WHEN 'resume' THEN
    d := d || jsonb_build_object('on', a->>'on', 'nextDate', a->>'nextDate');
  WHEN 'churn' THEN
    IF coalesce(a->>'leftOn', '') = '' THEN
      RAISE EXCEPTION 'Pick the day they left, today or before.' USING ERRCODE = '22023';
    END IF;
    v_type := CASE a->>'churnType' WHEN 'mid_programme' THEN 'mid_programme' WHEN 'completed' THEN 'completed' END;
    d := d || jsonb_build_object(
      'left_on', a->>'leftOn', 'reason', a->>'reason', 'churn_type', v_type,
      -- The card's own option names (the churn-confirm file's cockpit_churn_type_card says the same).
      'card_type', CASE v_type WHEN 'mid_programme' THEN 'Mid-programme loss (counts as churn)'
                               WHEN 'completed' THEN 'Completed term (does NOT count as churn)' END,
      'clear_paused', CASE WHEN jsonb_typeof(a->'clearPaused') = 'boolean' THEN a->'clearPaused' END,
      'departure_id', a->'departureId', 'why_detail', a->>'whyDetail', 'notice_on', a->>'noticeOn',
      'survey_state', a->>'surveyState', 'exit_call_id', a->>'exitCallId');
    v_extra := jsonb_build_object('card_reason', public.cockpit_churn_reason_card(a->>'reason'));
  WHEN 'mrr' THEN
    IF coalesce(a->>'to', '') !~ '^[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'Set MRR to a dollar amount of 0 or more.' USING ERRCODE = '22023';
    END IF;
    d := d || jsonb_build_object(
      'from', CASE WHEN a->>'from' ~ '^[0-9]+(\.[0-9]+)?$' THEN (a->>'from')::numeric END, 'to', (a->>'to')::numeric,
      'reason_cat', a->>'reasonCat', 'reason', a->>'reason', 'effective', a->>'effective', 'win_id', a->'winId',
      -- Waves 5-6 (3.5): the two system categories carry their words.
      'reason_label', CASE a->>'reasonCat' WHEN 'new_client' THEN 'New client' WHEN 'reactivation' THEN 'Reactivation' END);
  WHEN 'ltv' THEN
    d := d || jsonb_build_object('sum', a->'sum', 'rows', a->'rows', 'as_of', a->>'asOf',
      -- Waves 5-6 (4.4): the morning writer's sums, and who released a held jump.
      'baseline', a->'baseline', 'baseline_day', a->>'baselineDay', 'checked_usd', a->'checkedUsd',
      'released_by', a->>'releasedBy', 'note', nullif(left(btrim(coalesce(a->>'note', '')), 300), ''));
  WHEN 'late' THEN
    IF a ? 'closes' THEN
      IF coalesce(a->>'closedHow', '') NOT IN ('extended', 'stopped', 'date_moved') THEN
        RAISE EXCEPTION 'A late spell closes as extended, stopped or date_moved.' USING ERRCODE = '22023';
      END IF;
      d := d || jsonb_build_object('closes', a->'closes', 'due', a->>'due', 'days_late', a->'daysLate',
                                   'paid_on', a->>'paidOn', 'closed_how', a->>'closedHow');
    ELSE
      d := d || jsonb_build_object('due', a->>'due', 'spell_day', a->'spellDay', 'amount_usd', a->'amountUsd');
    END IF;
  WHEN 'survey' THEN
    -- The exit survey's answer (contract 3.8): option values, whole-number ratings, typed answers cut to 300.
    d := d || jsonb_build_object(
      'form_key', 'exit_survey', 'invite_id', a->>'inviteId', 'notice_on', a->>'noticeOn',
      'reasons', (SELECT jsonb_agg(x ORDER BY n) FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(a->'reasons') = 'array' THEN a->'reasons' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(x, n)
                   WHERE x ~ '^[a-z][a-z0-9_]{1,30}$'),
      'ratings', nullif(jsonb_strip_nulls(jsonb_build_object(
                   'ads', CASE WHEN a->'ratings'->>'ads' ~ '^([0-9]|10)$' THEN (a->'ratings'->>'ads')::integer END,
                   'people', CASE WHEN a->'ratings'->>'people' ~ '^([0-9]|10)$' THEN (a->'ratings'->>'people')::integer END,
                   'comms', CASE WHEN a->'ratings'->>'comms' ~ '^([0-9]|10)$' THEN (a->'ratings'->>'comms')::integer END)), '{}'::jsonb),
      'recommend', CASE WHEN a->>'recommend' ~ '^([0-9]|10)$' THEN (a->>'recommend')::integer END,
      'kept_us', nullif(left(btrim(regexp_replace(coalesce(a->>'keptUs', ''), '\s+', ' ', 'g')), 300), ''),
      'comments', nullif(left(btrim(regexp_replace(coalesce(a->>'comments', ''), '\s+', ' ', 'g')), 300), ''),
      'via', CASE WHEN a->>'via' IN ('portal', 'link') THEN a->>'via' END);
  WHEN 'nps_sent' THEN
    IF coalesce(a->>'on', '') = '' THEN
      RAISE EXCEPTION 'An NPS sent event needs the day it went out (YYYY-MM-DD).' USING ERRCODE = '22023';
    END IF;
    d := d || jsonb_build_object('invite_id', a->>'inviteId', 'on', a->>'on',
      'round', CASE WHEN a->>'round' ~ '^[1-9][0-9]{0,3}$' THEN (a->>'round')::integer END);
  WHEN 'win' THEN
    -- Waves 5-6 (3.5): what the card comment says about a win (20261102h logs it).
    IF coalesce(a->>'winId', '') !~ '^[0-9a-fA-F-]{36}$' THEN
      RAISE EXCEPTION 'A win event names its win.' USING ERRCODE = '22023';
    END IF;
    IF coalesce(a->>'kind', '') NOT IN ('review', 'video_testimonial', 'podcast', 'referral', 'renewal', 'reactivation',
                                        'upsell_website', 'upsell_smm', 'upsell_backend', 'upsell_seo_geo', 'upsell_second_campaign') THEN
      RAISE EXCEPTION 'That is not a kind of win.' USING ERRCODE = '22023';
    END IF;
    IF coalesce(a->>'stage', '') NOT IN ('logged', 'quote_given', 'signed', 'paid', 'void') THEN
      RAISE EXCEPTION 'That is not a stage of a win.' USING ERRCODE = '22023';
    END IF;
    d := d || jsonb_build_object('win_id', a->>'winId', 'kind', a->>'kind', 'stage', a->>'stage', 'won_on', a->>'wonOn',
      'proof_url', CASE WHEN a->>'proofUrl' ~ '^https://[^[:space:]]+$' AND char_length(a->>'proofUrl') <= 1000 THEN a->>'proofUrl' END,
      'quoted_usd', CASE WHEN a->>'quotedUsd' ~ '^[0-9]+(\.[0-9]+)?$' THEN (a->>'quotedUsd')::numeric END,
      'agreement', CASE WHEN a->>'agreementUrl' ~ '^https://[^[:space:]]+$' AND char_length(a->>'agreementUrl') <= 1000 THEN a->>'agreementUrl' END);
  WHEN 'reactivate' THEN
    -- Waves 5-6 (3.5): a churned client returning (20261102i's act).
    IF coalesce(a->>'status', '') NOT IN ('Active', 'Onboarding Booked') THEN
      RAISE EXCEPTION 'A returning client comes back as Active or Onboarding Booked.' USING ERRCODE = '22023';
    END IF;
    IF char_length(btrim(coalesce(a->>'why', ''))) NOT BETWEEN 10 AND 500 THEN
      RAISE EXCEPTION 'Say why they came back in 10 to 500 characters.' USING ERRCODE = '22023';
    END IF;
    IF coalesce(a->>'returnOn', '') = '' THEN
      RAISE EXCEPTION 'Pick the day they came back.' USING ERRCODE = '22023';
    END IF;
    d := d || jsonb_build_object('return_on', a->>'returnOn', 'status', a->>'status', 'departure_id', a->'departureId',
      'left_on', a->>'leftOn', 'reason_was', a->>'reasonWas', 'type_was', a->>'typeWas', 'next_date', a->>'nextDate',
      'why', btrim(a->>'why'), 'call_id', a->>'callId');
  WHEN 'date' THEN
    -- Waves 5-6 (4.6): a date Confirm paid moved (or its withdraw moved back) names its confirmation.
    IF a ? 'confirmId' THEN
      IF coalesce(a->>'fromRule', '') NOT IN ('next_part', 'plus_month', 'withdraw') THEN
        RAISE EXCEPTION 'A confirmed date moves to the next part, a month on, or back on a withdraw.' USING ERRCODE = '22023';
      END IF;
      d := d || jsonb_build_object('confirm_id', a->'confirmId', 'part', a->>'part', 'part_no', a->'partNo',
        'from_rule', a->>'fromRule', 'paid_on', a->>'paidOn', 'reverses', a->'reverses');
    END IF;
  WHEN 'payment', 'method', 'plan', 'amount', 'note' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'No billing detail is defined for kind %.', coalesce(p_kind, 'null') USING ERRCODE = '22023';
  END CASE;
  d := jsonb_strip_nulls(d);
  -- Every day is a real day, written as ClickUp's date fields take it.
  FOREACH k IN ARRAY ARRAY['new_date', 'from', 'on', 'restart', 'left_on', 'notice_on', 'effective', 'due', 'paid_on',
                           'as_of', 'nextDate', 'call_on', 'won_on', 'return_on', 'next_date', 'baseline_day'] LOOP
    IF jsonb_typeof(d->k) = 'string' AND (CASE WHEN d->>k !~ '^\d{4}-\d{2}-\d{2}$' THEN true
                                               ELSE to_char((d->>k)::date, 'YYYY-MM-DD') <> d->>k END) THEN
      RAISE EXCEPTION 'That is not a day (YYYY-MM-DD): %.', d->>k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN d || v_extra;
END $function$;

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
  IF coalesce(p_kind, '') NOT IN ('churn', 'extension', 'pause', 'resume', 'mrr', 'late', 'date', 'survey', 'nps_sent', 'ltv', 'win', 'reactivate') THEN
    RAISE EXCEPTION 'The canary takes churn, extension, pause, resume, mrr, late, date, survey, nps_sent, ltv, win or reactivate.' USING ERRCODE = '22023';
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
  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (v_task, 'Test card (canary)', p_kind, v_from, v_to,
          coalesce(nullif(a->>'reason', ''), 'Canary on the test card'), v_detail,
          CASE WHEN v_system THEN 'system' ELSE 'ceo' END, 'canary')
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_billing_daily_run(p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_today date := coalesce(p_today, public.cockpit_billing_today());
  v_on boolean;
  v_lad jsonb; v_p integer;
  v_cleared integer := 0; v_opened integer := 0; v_closed integer := 0;
  v_note text; v_id bigint;
  g record; l record; o record;
  v_ltv jsonb := '{}'::jsonb;
BEGIN
  SELECT coalesce(s.value->'on' = 'true'::jsonb, false) INTO v_on FROM public.cockpit_settings s WHERE s.key = 'billing.daily';
  IF NOT coalesce(v_on, false) THEN
    INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, rows_seen, detail, updated_at)
    VALUES ('billing-daily', now(), now(), true, 'Off: billing.daily is off, so no extension was cleared and no late record was written.', 0,
            jsonb_build_object('ran', false), now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, last_ok_at = EXCLUDED.last_ok_at, ok = true,
      note = EXCLUDED.note, rows_seen = 0, detail = EXCLUDED.detail, updated_at = EXCLUDED.updated_at;
    RETURN jsonb_build_object('ran', false, 'why', 'billing.daily is off');
  END IF;
  -- One run at a time; a second run the same day finds nothing left to do.
  PERFORM pg_advisory_xact_lock(hashtext('cockpit_billing_daily'));
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  v_lad := public.cockpit_billing_ladder_settings();
  v_p := (v_lad->>'pauseReviewDay')::integer;

  -- (1) A grant that ended yesterday or before, not replaced, not cleared yet,
  --     while the card still shows extension weeks: the cockpit clears it.
  FOR g IN
    SELECT x.grant_id, x.clickup_task_id, x.client_name, x.until, a.extension_weeks
      FROM public.cockpit_extensions_v x
      JOIN public.cockpit_billing_accounts a ON a.clickup_task_id = x.clickup_task_id
     WHERE x.until < v_today AND x.replaced_by IS NULL AND x.cleared_at IS NULL AND coalesce(a.extension_weeks, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_extensions_v n
                        WHERE n.clickup_task_id = x.clickup_task_id AND n.grant_id > x.grant_id)
     ORDER BY x.grant_id
  LOOP
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (g.clickup_task_id, g.client_name, 'extension', trim_scale(g.extension_weeks)::text, '0', 'grant ended',
            jsonb_build_object('weeks', 0, 'reason', 'grant ended', 'grant_id', g.grant_id, 'until', g.until, 'seat_role', 'the cockpit'),
            'system', 'the cockpit');
    UPDATE public.cockpit_billing_accounts SET extension_weeks = 0, synced_at = now() WHERE clickup_task_id = g.clickup_task_id;
    v_cleared := v_cleared + 1;
  END LOOP;

  -- (2) Open a late record for each run that reached the pause review day,
  --     unless a grant still runs for the card (it opens when the grant ends unpaid).
  FOR l IN
    SELECT v.clickup_task_id, v.client_name, v.due_on, v.amount_usd
      FROM public.cockpit_late_payments_v v
     WHERE v.closed_how = 'open' AND v.late_event_id IS NULL AND v_today - v.due_on >= v_p
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_extensions_v x
                        WHERE x.clickup_task_id = v.clickup_task_id AND x.replaced_by IS NULL AND x.until >= v_today)
  LOOP
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (l.clickup_task_id, l.client_name, 'late', NULL, l.due_on::text,
            format('Late payment: day %s past %s', v_today - l.due_on, public.cockpit_billing_day_words(l.due_on)),
            jsonb_build_object('due', l.due_on, 'spell_day', v_today - l.due_on, 'amount_usd', l.amount_usd, 'seat_role', 'the cockpit'),
            'system', 'the cockpit');
    v_opened := v_opened + 1;
  END LOOP;

  -- ...and close each open record whose run has ended.
  FOR o IN
    SELECT e.id, e.clickup_task_id, e.client_name, v.due_on, v.days_late, v.paid_on, v.closed_how
      FROM public.cockpit_billing_events e
      JOIN public.cockpit_late_payments_v v ON v.clickup_task_id = e.clickup_task_id AND v.due_on::text = e.detail->>'due'
     WHERE e.kind = 'late' AND NOT (e.detail ? 'closes') AND v.closed_how <> 'open'
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids x WHERE x.event_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_events c WHERE c.kind = 'late' AND c.detail->>'closes' = e.id::text
                         AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids cv WHERE cv.event_id = c.id))
  LOOP
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (o.clickup_task_id, o.client_name, 'late', o.due_on::text, coalesce(o.paid_on::text, o.closed_how),
            format('Late %s days: due %s, %s', o.days_late, public.cockpit_billing_day_words(o.due_on),
                   CASE o.closed_how WHEN 'stopped' THEN 'client stopped' WHEN 'extended' THEN 'extension moved the date'
                                     ELSE coalesce('paid ' || public.cockpit_billing_day_words(o.paid_on), 'the date moved on the card') END),
            jsonb_strip_nulls(jsonb_build_object('closes', o.id, 'due', o.due_on, 'days_late', o.days_late, 'paid_on', o.paid_on,
                                                 'closed_how', o.closed_how, 'seat_role', 'the cockpit')),
            'system', 'the cockpit')
    RETURNING id INTO v_id;
    v_closed := v_closed + 1;
  END LOOP;

  v_note := format('Ran for %s: %s extension%s cleared, %s late record%s opened, %s closed.', v_today,
                   v_cleared, CASE WHEN v_cleared = 1 THEN '' ELSE 's' END, v_opened, CASE WHEN v_opened = 1 THEN '' ELSE 's' END, v_closed);
  -- (3) Waves 5-6 (4.4): lifetime value, after the late records, only while billing.ltv is on.
  v_ltv := public.cockpit_ltv_daily_step(v_today);
  IF v_ltv->>'note' IS NOT NULL THEN v_note := v_note || ' ' || (v_ltv->>'note'); END IF;
  INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, rows_seen, detail, updated_at)
  VALUES ('billing-daily', now(), now(), true, v_note, v_cleared + v_opened + v_closed,
          jsonb_build_object('ran', true, 'day', v_today, 'cleared', v_cleared, 'lateOpened', v_opened, 'lateClosed', v_closed, 'at', now(),
                             'ltv', v_ltv), now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, last_ok_at = EXCLUDED.last_ok_at, ok = true,
    note = EXCLUDED.note, rows_seen = EXCLUDED.rows_seen, detail = EXCLUDED.detail, updated_at = EXCLUDED.updated_at;
  IF v_cleared + v_opened + v_closed > 0 THEN
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.daily', 'cockpit_billing_events', v_today::text, 'the cockpit', 'client-success', 'supabase', NULL,
            jsonb_build_object('cleared', v_cleared, 'lateOpened', v_opened, 'lateClosed', v_closed), jsonb_build_object('day', v_today));
  END IF;
  RETURN jsonb_build_object('ran', true, 'day', v_today, 'cleared', v_cleared, 'lateOpened', v_opened, 'lateClosed', v_closed, 'ltv', v_ltv);
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_billing_balance_write(p_action text, p_args jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_date jsonb;
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
    -- Waves 5-6 (4.6): a confirm that moved the next payment date moves it back while the card still shows it.
    v_date := public.cockpit_billing_confirm_date_undo(v_conf, v_source, v_who, v_app);
    RETURN jsonb_build_object('ok', true, 'sentence', 'Withdrawn.',
      'confirmation', jsonb_build_object('id', v_conf.id, 'taskId', v_conf.clickup_task_id, 'withdrawnAt', v_conf.withdrawn_at,
                                         'withdrawnReason', v_conf.withdrawn_reason),
      'date', v_date);
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

  -- Waves 5-6 (4.6): the part due on the card's date moves the next payment date, one date write per save.
  v_date := public.cockpit_billing_confirm_date_apply(v_conf, p_args, v_source, v_who, v_app);

  RETURN jsonb_build_object('ok', true,
    'sentence', format('Confirmed by you · waiting for %s', v_rail_name),
    'confirmation', jsonb_build_object('id', v_conf.id, 'taskId', v_conf.clickup_task_id, 'dealResponseId', v_conf.deal_response_id,
      'part', v_conf.part, 'partNo', v_conf.part_no, 'amount', v_conf.amount, 'currency', v_conf.currency, 'usd', v_conf.usd,
      'rail', v_conf.rail, 'paidOn', v_conf.paid_on, 'evidenceUrl', v_conf.evidence_url, 'note', v_conf.note,
      'railsUsdAtConfirm', v_conf.rails_usd_at_confirm, 'railsAsOf', v_conf.rails_as_of, 'source', v_conf.source,
      'confirmedByCeo', v_conf.confirmed_by_ceo, 'byYou', true, 'confirmedAt', v_conf.confirmed_at),
    'date', v_date);
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_billing_balances_read()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
    'csm', a.csm,
    -- Waves 5-6 (4.6): what Confirm paid would do to the next payment date (cockpit_billing_confirm_date_rule's inputs).
    'dateIfConfirmed', public.cockpit_billing_confirm_date_card(a.clickup_task_id)
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
    'checked', r.checked,
    'byHand', r.rail IN ('manual', 'transfer', 'bank') OR r.payment_id ~ '^(manual|transfer|bank):')
    ORDER BY dc.deal_response_id, r.day, r.payment_id), '[]'::jsonb) INTO v_rails
  FROM public.cockpit_billing_deal_cards() dc
  CROSS JOIN LATERAL public.cockpit_billing_deal_rails_shown(dc.deal_response_id, dc.clickup_task_id) r
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
                  'checked', r.checked,
                  'byHand', r.rail IN ('manual', 'transfer', 'bank') OR r.payment_id ~ '^(manual|transfer|bank):')
                  ORDER BY r.day, r.payment_id), '[]'::jsonb)
                FROM public.cockpit_billing_deal_rails_shown(d.response_id, NULL) r))
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
          'checked', r.checked,
          'byHand', r.rail IN ('manual', 'transfer', 'bank') OR r.payment_id ~ '^(manual|transfer|bank):')
          ORDER BY r.day, r.payment_id), '[]'::jsonb)
        FROM public.cockpit_billing_deal_rails_shown(d.response_id, a.clickup_task_id) r) END)
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
  v_new := jsonb_build_object(
    'wins', jsonb_build_array(to_regprocedure('public.cockpit_csm_win_log(jsonb)') IS NOT NULL,
                              coalesce(v_marks->>'wins', '') = 'true'),
    'receipts', jsonb_build_array(to_regprocedure('public.portal_form_file_slot(text,text,text,uuid,text,text,bigint,text)') IS NOT NULL,
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
                             coalesce(v_marks->>'ltv', '') = 'true'));
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
-- 8. Grants: every function revoked from all four roles, then granted as 2.2
--    (the replaced ones keep their live ACL) and 3.3 say.

REVOKE ALL ON FUNCTION
  public.cockpit_money_rails_audit(),
  public.cockpit_ltv_refusal(),
  public.cockpit_ltv_plan(date),
  public.cockpit_ltv_on_its_way(text,numeric),
  public.cockpit_ltv_event(jsonb,text,text),
  public.cockpit_ltv_daily_step(date),
  public.cockpit_ltv_read(),
  public.cockpit_ltv_release(text,numeric,text),
  public.cockpit_billing_plan_monthly(text),
  public.cockpit_billing_confirm_date_card(text),
  public.cockpit_billing_confirm_date_rule(text,text,text,integer,jsonb),
  public.cockpit_billing_confirm_date_apply(public.cockpit_billing_confirmations,jsonb,text,text,text),
  public.cockpit_billing_confirm_date_undo(public.cockpit_billing_confirmations,text,text,text),
  public.cockpit_billing_confirm_date_preview(text,jsonb),
  public.cockpit_agent_key_put_owner(text,text,text,text),
  public.cockpit_agent_keys_read(),
  public.cockpit_agent_key_revoke(bigint,text),
  public.cockpit_agent_key_of(text),
  public.cockpit_agent_call_log(bigint,text,uuid,text,jsonb),
  public.cockpit_agent_door_open(public.cockpit_agent_keys,text,uuid,boolean),
  public.cockpit_agent_card(jsonb),
  public.cockpit_billing_agent_write(text,text,jsonb,uuid),
  public.cockpit_billing_agent_read(text,text,jsonb),
  public.cockpit_slack_notice_shape(text),
  public.cockpit_slack_notice_kind_label(text),
  public.cockpit_slack_notice_live(public.cockpit_slack_notices),
  public.cockpit_slack_notice_inputs(jsonb),
  public.cockpit_slack_notice_doctor_inputs(),
  public.cockpit_slack_notice_settings_read(),
  public.cockpit_slack_notice_settings_set(text,jsonb),
  public.cockpit_slack_channel_remove(text),
  public.cockpit_slack_notice_rehearse(text),
  public.cockpit_slack_notice_rehearse_service(text,text),
  public.cockpit_slack_notice_read(text),
  public.cockpit_billing_writeback_writes(text,text,text,jsonb),
  public.cockpit_billing_writeback_comment(text,text,text,jsonb,text),
  public.cockpit_billing_detail(text,jsonb),
  public.cockpit_billing_canary(text,jsonb),
  public.cockpit_billing_daily_run(date),
  public.cockpit_billing_balance_write(text,jsonb),
  public.cockpit_billing_balances_read(),
  public.cockpit_form_doors()
  FROM PUBLIC, anon, authenticated, service_role;

-- Browser RPCs (the gate is inside each).
GRANT EXECUTE ON FUNCTION
  public.cockpit_ltv_read(),
  public.cockpit_ltv_release(text,numeric,text),
  public.cockpit_billing_confirm_date_preview(text,jsonb),
  public.cockpit_agent_keys_read(),
  public.cockpit_agent_key_revoke(bigint,text),
  public.cockpit_slack_notice_settings_read(),
  public.cockpit_slack_notice_settings_set(text,jsonb),
  public.cockpit_slack_channel_remove(text),
  public.cockpit_slack_notice_rehearse(text),
  public.cockpit_slack_notice_read(text),
  public.cockpit_billing_balance_write(text,jsonb),
  public.cockpit_billing_balances_read(),
  public.cockpit_form_doors()
  TO authenticated;

-- The service door (the billing-agent function, the notices sender and its doctor).
GRANT EXECUTE ON FUNCTION
  public.cockpit_billing_agent_write(text,text,jsonb,uuid),
  public.cockpit_billing_agent_read(text,text,jsonb),
  public.cockpit_slack_notice_inputs(jsonb),
  public.cockpit_slack_notice_doctor_inputs(),
  public.cockpit_slack_notice_rehearse_service(text,text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
