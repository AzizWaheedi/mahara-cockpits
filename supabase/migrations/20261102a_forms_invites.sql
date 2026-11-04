-- Form invites, the client channel's cockpit side (docs/forms/WAVE34-CONTRACT.md
-- 2.2 'a' rows, 2.3, 3.1 to 3.4, 3.6, 3.9, 3.10 and 4.1). Creative Triage
-- (bldgtotkfmhoxmlzowdx). Additive; applies twice. The first file of the
-- waves 3-4 block (20261102a to 20261102d); b, c and d call what is made here.
--
-- 1. Invites: one open invite per card, form and purpose, 14 days, one
--    answer (cockpit_form_invites), every step an event row, per-channel link
--    tokens kept only as sha256, token-open counts for the rate limits, and
--    the portal's presence counts (no email anywhere).
-- 2. Client form schema v1 (3.1): cockpit_form_schema_check and the one
--    answer checker every client form shares (cockpit_form_answers_check,
--    pure, so the portal's mirror is tested on the same fixture), and the
--    client text rule (cockpit_client_text_ok: no leads or cost per lead, no
--    results guarantee).
-- 3. The seat RPCs (view, issue, withdraw, link, today, answer read), the
--    portal RPCs and their token twins, the worker's link mint, the owner's
--    go-live, schedule issuer and canary door, and the sweep helpers.
-- 4. Message kind form_invite: the approve, claim and view learn it; the
--    effect gate asks the invite for a form_invite message.
-- 5. Six notice kinds (3.4) in the ten notice functions that list kinds
--    (cockpit_slack_notice_settings_set holds no kind list, so it is not
--    replaced), their settings rows, and the outbox CHECKs.
-- 6. Registry rows nps, csat and portal_feedback (native, client, not live),
--    forms.client {"live":[],"presence":false} (nothing reaches a client until
--    a form goes live by cockpit_form_client_go_live), forms.doors invites.
--
-- Nothing here posts, writes a card, sends a message or reaches a client.
-- Every function is SECURITY DEFINER with an empty search path, revoked from
-- all four roles, then granted as 2.2 and 3.3 say. Reads are STABLE and never
-- expire an invite (V25): they report an open invite past its end as expired;
-- the write paths and the schedule's sweep expire it.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard (2.1): each replaced body is the one the contract read
--    (the live body md5, 11.2-c) or this file's own (a second apply).

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_slack_notice_shape(text)', '19fdd9d7e444648e6b7a8ec37789b00c', '65bee7a75bc943031bf3d71beaf9bd7c'),
      ('public.cockpit_slack_notice_kind_label(text)', 'd44ee66b9ff6f0eb01cc6d053e0b9176', '75d4d7515419d0a968d092b44d416dbb'),
      ('public.cockpit_slack_notice_live(public.cockpit_slack_notices)', '61d9e369f2b555acb1ac3e185df28dae', 'eecd54cfe2ea8411174d16cb479ad261'),
      ('public.cockpit_slack_notice_inputs(jsonb)', '8f03d16f00739d63b2ed2442526f5a3b', 'd665b505014dc61c4d71ff59126dc90e'),
      ('public.cockpit_slack_notice_doctor_inputs()', 'b535391a05c453ec109eb81f29b89898', 'a7c6a68324e3d601156e0f13f5f9e513'),
      ('public.cockpit_slack_notice_settings_read()', 'ea3863b49c25ed786fa7b3e81e1c6d17', '29bb5362cd8426cec51ff24fb6178c58'),
      ('public.cockpit_slack_channel_remove(text)', '06adfc699c3110b99f084d1e60cb16a0', 'f9e0c0f36bd2d8450e90e8aece898926'),
      ('public.cockpit_slack_notice_rehearse(text)', '20cab5786b0a54be30f88fcaa5f1931f', '2ea83a6770947fce31d587f214d16817'),
      ('public.cockpit_slack_notice_rehearse_service(text,text)', '4cfbc884fe8c2c6946f09d818fa7be17', '044ba3be2c44da6d6ebe8fa73f20d5d8'),
      ('public.cockpit_slack_notice_read(text)', 'cfdcb4241f40a4452d50219f3ba11291', '56e3035431a069a6f4d2f74b3425a267'),
      ('public.cockpit_client_message_approve(uuid,text,text,uuid,text[])', '528d7d0f273333ed734480ed947211c2', '2de20d1e0f44a1e379e5b57848d6a8e0'),
      ('public.cockpit_client_message_claim(text[],text[],integer)', '66c32c23fa588801b2cccbd3ec6e5f40', '937293e8d0421580fc47f8341ff9cae2'),
      ('public.cockpit_client_message_view(public.cockpit_client_messages)', '3f04490fe00e1d627896c21a4530e1f2', '5145dbe3460c3947c82c8420871581ef'),
      ('public.cockpit_form_effect_gate(text,text)', 'e498f48795c2644fb037df056828c736', 'c679cd114e6aa8d5e2dccbfb4207d1c8'),
      ('public.cockpit_form_doors()', '2ceb94ae0589b54ce53b6810e3eac87c', '2991d3cbadd1003f4f85d0a91de10af2')
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

-- What this file stands on, read but not replaced: the messages guard (the
-- skip rule of 3.3 moves only draft and approved rows, which is all it
-- allows), and waves 1-2 (the voids, the confirm columns, the asks).
DO $$
DECLARE v text;
BEGIN
  SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v
    FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.cockpit_client_messages_guard()');
  IF v IS DISTINCT FROM 'c676efff216517fc709ec927ca9edc55' THEN
    RAISE EXCEPTION 'cockpit_client_messages_guard changed since the waves 3-4 contract read it; stop and re-read it.'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.cockpit_billing_event_voids') IS NULL
     OR to_regclass('public.cockpit_client_asks') IS NULL
     OR to_regclass('public.cockpit_client_ask_events') IS NULL
     OR to_regclass('portal_data.workspaces') IS NULL
     OR to_regprocedure('public.portal_client_ask_person(text)') IS NULL
     OR to_regprocedure('public.cockpit_form_staff_record(text,text,jsonb,uuid,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                     WHERE a.attrelid = 'public.cockpit_churn_departures'::regclass AND a.attname = 'confirmed_at'
                       AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'Apply 20261029170000 and 20261101l to 20261101r before 20261102a.' USING ERRCODE = '55000';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Columns and CHECKs, each widened only from the definition the contract
--    read (11.2-d, e, k); any other definition stops the file, and one
--    already widened changes nothing.

ALTER TABLE public.cockpit_form_responses
  ADD COLUMN IF NOT EXISTS invite_id uuid,
  ADD COLUMN IF NOT EXISTS signer text CHECK (signer IS NULL OR char_length(btrim(signer)) BETWEEN 2 AND 120),
  ADD COLUMN IF NOT EXISTS lang text CHECK (lang IS NULL OR lang IN ('ar','en'));

DO $$
DECLARE v_def text;
BEGIN
  -- The responses' sources: portal joins (public is the token path's).
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_form_responses'::regclass AND c.conname = 'cockpit_form_responses_source_check';
  IF v_def IS DISTINCT FROM 'CHECK ((source = ANY (ARRAY[''cockpit''::text, ''embed''::text, ''typeform_webhook''::text, ''typeform_sync''::text, ''public''::text, ''import''::text, ''portal''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((source = ANY (ARRAY[''cockpit''::text, ''embed''::text, ''typeform_webhook''::text, ''typeform_sync''::text, ''public''::text, ''import''::text])))' THEN
      RAISE EXCEPTION 'cockpit_form_responses_source_check changed since the waves 3-4 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_form_responses DROP CONSTRAINT cockpit_form_responses_source_check;
    ALTER TABLE public.cockpit_form_responses ADD CONSTRAINT cockpit_form_responses_source_check
      CHECK (source IN ('cockpit','embed','typeform_webhook','typeform_sync','public','import','portal'));
  END IF;

  -- The message kinds: form_invite joins (3.9).
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_client_messages'::regclass AND c.conname = 'cockpit_client_messages_kind_check';
  IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''recap_checkin''::text, ''recap_kickoff''::text, ''recap_blueprint''::text, ''phase5''::text, ''form_invite''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''recap_checkin''::text, ''recap_kickoff''::text, ''recap_blueprint''::text, ''phase5''::text])))' THEN
      RAISE EXCEPTION 'cockpit_client_messages_kind_check changed since the waves 3-4 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_client_messages DROP CONSTRAINT cockpit_client_messages_kind_check;
    ALTER TABLE public.cockpit_client_messages ADD CONSTRAINT cockpit_client_messages_kind_check
      CHECK (kind IN ('recap_checkin','recap_kickoff','recap_blueprint','phase5','form_invite'));
  END IF;

  -- The settings' kinds.
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_slack_notice_settings'::regclass AND c.conname = 'cockpit_slack_notice_settings_kind_check';
  IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''kickoff''::text, ''kickoff.late''::text, ''kickoff.second''::text, ''kickoff.updated''::text, ''blueprint.close''::text, ''blueprint.updated''::text, ''blueprint.media''::text, ''blueprint.offer''::text, ''checkin.grade''::text, ''checkin.recap_late''::text, ''termination.notice''::text, ''termination.submitted''::text, ''churn.confirmed''::text, ''extension.granted''::text, ''pause.agreed''::text, ''client.resumed''::text, ''pause.consent''::text, ''nps.received''::text, ''csat.received''::text, ''voice.low''::text, ''feedback.received''::text, ''legacy.received''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''kickoff''::text, ''kickoff.late''::text, ''kickoff.second''::text, ''kickoff.updated''::text, ''blueprint.close''::text, ''blueprint.updated''::text, ''blueprint.media''::text, ''blueprint.offer''::text, ''checkin.grade''::text, ''checkin.recap_late''::text, ''termination.notice''::text, ''termination.submitted''::text, ''churn.confirmed''::text, ''extension.granted''::text, ''pause.agreed''::text, ''client.resumed''::text])))' THEN
      RAISE EXCEPTION 'cockpit_slack_notice_settings_kind_check changed since the waves 3-4 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_slack_notice_settings DROP CONSTRAINT cockpit_slack_notice_settings_kind_check;
    ALTER TABLE public.cockpit_slack_notice_settings ADD CONSTRAINT cockpit_slack_notice_settings_kind_check
      CHECK (kind IN ('kickoff','kickoff.late','kickoff.second','kickoff.updated',
                      'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer',
                      'checkin.grade','checkin.recap_late',
                      'termination.notice','termination.submitted','churn.confirmed',
                      'extension.granted','pause.agreed','client.resumed',
                      'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received'));
  END IF;

  -- The kinds that name a channel: all six new ones post top level.
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_slack_notice_settings'::regclass AND c.conname = 'cockpit_slack_notice_settings_check';
  IF v_def IS DISTINCT FROM 'CHECK (((kind = ANY (ARRAY[''kickoff''::text, ''blueprint.close''::text, ''blueprint.media''::text, ''checkin.grade''::text, ''checkin.recap_late''::text, ''termination.notice''::text, ''termination.submitted''::text, ''churn.confirmed''::text, ''extension.granted''::text, ''pause.agreed''::text, ''client.resumed''::text, ''pause.consent''::text, ''nps.received''::text, ''csat.received''::text, ''voice.low''::text, ''feedback.received''::text, ''legacy.received''::text])) = (channel IS NOT NULL)))' THEN
    IF v_def IS DISTINCT FROM 'CHECK (((kind = ANY (ARRAY[''kickoff''::text, ''blueprint.close''::text, ''blueprint.media''::text, ''checkin.grade''::text, ''checkin.recap_late''::text, ''termination.notice''::text, ''termination.submitted''::text, ''churn.confirmed''::text, ''extension.granted''::text, ''pause.agreed''::text, ''client.resumed''::text])) = (channel IS NOT NULL)))' THEN
      RAISE EXCEPTION 'cockpit_slack_notice_settings_check changed since the waves 3-4 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_slack_notice_settings DROP CONSTRAINT cockpit_slack_notice_settings_check;
    ALTER TABLE public.cockpit_slack_notice_settings ADD CONSTRAINT cockpit_slack_notice_settings_check
      CHECK ((kind IN ('kickoff','blueprint.close','blueprint.media','checkin.grade','checkin.recap_late',
                       'termination.notice','termination.submitted','churn.confirmed',
                       'extension.granted','pause.agreed','client.resumed',
                       'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received'))
             = (channel IS NOT NULL));
  END IF;

  -- The outbox's kinds.
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_slack_notices'::regclass AND c.conname = 'cockpit_slack_notices_kind_check';
  IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''kickoff''::text, ''kickoff.updated''::text, ''blueprint.close''::text, ''blueprint.updated''::text, ''blueprint.media''::text, ''blueprint.offer''::text, ''rehearsal''::text, ''checkin.grade''::text, ''checkin.recap_late''::text, ''termination.notice''::text, ''termination.submitted''::text, ''churn.confirmed''::text, ''extension.granted''::text, ''pause.agreed''::text, ''client.resumed''::text, ''pause.consent''::text, ''nps.received''::text, ''csat.received''::text, ''voice.low''::text, ''feedback.received''::text, ''legacy.received''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''kickoff''::text, ''kickoff.updated''::text, ''blueprint.close''::text, ''blueprint.updated''::text, ''blueprint.media''::text, ''blueprint.offer''::text, ''rehearsal''::text, ''checkin.grade''::text, ''checkin.recap_late''::text, ''termination.notice''::text, ''termination.submitted''::text, ''churn.confirmed''::text, ''extension.granted''::text, ''pause.agreed''::text, ''client.resumed''::text])))' THEN
      RAISE EXCEPTION 'cockpit_slack_notices_kind_check changed since the waves 3-4 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_slack_notices DROP CONSTRAINT cockpit_slack_notices_kind_check;
    ALTER TABLE public.cockpit_slack_notices ADD CONSTRAINT cockpit_slack_notices_kind_check
      CHECK (kind IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated',
                      'blueprint.media','blueprint.offer','rehearsal','checkin.grade','checkin.recap_late',
                      'termination.notice','termination.submitted','churn.confirmed',
                      'extension.granted','pause.agreed','client.resumed',
                      'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received'));
  END IF;

  -- The outbox's card rule: an old form link's answer may have no card (V16).
  v_def := NULL;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_slack_notices'::regclass AND c.conname = 'cockpit_slack_notices_check1';
  IF v_def IS DISTINCT FROM 'CHECK (((kind = ANY (ARRAY[''rehearsal''::text, ''termination.notice''::text, ''legacy.received''::text])) OR (task_id IS NOT NULL)))' THEN
    IF v_def IS DISTINCT FROM 'CHECK (((kind = ANY (ARRAY[''rehearsal''::text, ''termination.notice''::text])) OR (task_id IS NOT NULL)))' THEN
      RAISE EXCEPTION 'cockpit_slack_notices_check1 changed since the waves 3-4 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_slack_notices DROP CONSTRAINT cockpit_slack_notices_check1;
    ALTER TABLE public.cockpit_slack_notices ADD CONSTRAINT cockpit_slack_notices_check1
      CHECK (kind IN ('rehearsal','termination.notice','legacy.received') OR task_id IS NOT NULL);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The tables (3.2)

CREATE TABLE IF NOT EXISTS public.cockpit_form_invites (
  -- The seat's request id (gen_random_uuid() for the schedule and the canary).
  id               uuid PRIMARY KEY,
  task_id          text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name      text NOT NULL CHECK (char_length(btrim(client_name)) BETWEEN 1 AND 200),
  -- portal_data.workspaces.location_id when exactly one workspace carries the card.
  location_id      text CHECK (location_id IS NULL OR location_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  form_key         text NOT NULL REFERENCES public.cockpit_forms(key),
  form_version     integer NOT NULL,
  purpose          text NOT NULL CHECK (purpose IN ('pause_consent','exit_survey','nps','csat')),
  context          jsonb NOT NULL DEFAULT '{}'::jsonb
                     CHECK (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= 4096),
  channels         text[] NOT NULL
                     CHECK (cardinality(channels) BETWEEN 1 AND 3 AND channels <@ ARRAY['portal','whatsapp','copy']::text[]),
  audience         text NOT NULL CHECK (audience IN ('any','admin')),
  -- Client-facing: shown under the title. Passes cockpit_client_text_ok.
  note             text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 280),
  lang             text NOT NULL DEFAULT 'ar' CHECK (lang IN ('ar','en')),
  origin           text NOT NULL CHECK (origin IN ('csm','schedule','pause','churn','canary')),
  state            text NOT NULL DEFAULT 'open' CHECK (state IN ('open','answered','withdrawn','expired')),
  -- Roles in screens and cards; the address is for the audit only.
  issued_by        uuid,
  issued_by_email  text,
  issued_by_role   text NOT NULL CHECK (char_length(btrim(issued_by_role)) BETWEEN 2 AND 60),
  issued_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  answered_at      timestamptz,
  response_id      uuid REFERENCES public.cockpit_form_responses(id),
  closed_at        timestamptz,
  closed_by        text CHECK (closed_by IS NULL OR char_length(closed_by) <= 120),
  closed_reason    text CHECK (closed_reason IS NULL OR char_length(closed_reason) <= 240),
  push             boolean NOT NULL DEFAULT false,
  push_state       text NOT NULL DEFAULT 'off' CHECK (push_state IN ('off','waiting','sending','sent','no_device','failed')),
  push_claim_until timestamptz,
  push_result      jsonb CHECK (push_result IS NULL OR jsonb_typeof(push_result) = 'object'),
  push_at          timestamptz,
  message_id       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (form_key, form_version) REFERENCES public.cockpit_form_versions(form_key, version),
  CHECK (purpose = form_key),
  CHECK (expires_at > issued_at),
  CHECK (state <> 'answered' OR (response_id IS NOT NULL AND answered_at IS NOT NULL)),
  CHECK (state = 'open' OR closed_at IS NOT NULL),
  CHECK (origin <> 'schedule' OR issued_by IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_form_invites_one_open
  ON public.cockpit_form_invites (task_id, form_key, purpose) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS cockpit_form_invites_location ON public.cockpit_form_invites (location_id, state);
CREATE INDEX IF NOT EXISTS cockpit_form_invites_task ON public.cockpit_form_invites (task_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS cockpit_form_invites_push
  ON public.cockpit_form_invites (push_state, issued_at) WHERE push_state IN ('waiting','sending');
CREATE INDEX IF NOT EXISTS cockpit_form_invites_open_end
  ON public.cockpit_form_invites (expires_at) WHERE state = 'open';

CREATE TABLE IF NOT EXISTS public.cockpit_form_invite_events (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invite_id uuid NOT NULL REFERENCES public.cockpit_form_invites(id),
  at        timestamptz NOT NULL DEFAULT now(),
  source    text NOT NULL CHECK (source IN ('cockpit','schedule','portal','token','push','worker')),
  event     text NOT NULL CHECK (event IN ('issued','shown','opened','later','answered','withdrawn','expired',
                                           'link_made','link_sent','refused','hook_failed')),
  -- The portal person's lowercased email for a portal event, else NULL.
  person    text CHECK (person IS NULL OR (source = 'portal' AND person = lower(person))),
  -- Never a token, a hash or an answer.
  detail    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object' AND octet_length(detail::text) <= 2048)
);
CREATE INDEX IF NOT EXISTS cockpit_form_invite_events_invite ON public.cockpit_form_invite_events (invite_id, at);
CREATE INDEX IF NOT EXISTS cockpit_form_invite_events_person
  ON public.cockpit_form_invite_events (person, at) WHERE source = 'portal';

CREATE TABLE IF NOT EXISTS public.cockpit_form_invite_tokens (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invite_id      uuid NOT NULL REFERENCES public.cockpit_form_invites(id),
  channel        text NOT NULL CHECK (channel IN ('whatsapp','copy')),
  -- Only the hash is kept (3.6): the raw token lives in one WhatsApp
  -- message or one copy answer, never here.
  token_sha256   text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  message_id     uuid UNIQUE,
  made_by        text NOT NULL CHECK (char_length(btrim(made_by)) BETWEEN 2 AND 60),
  made_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_reason text CHECK (revoked_reason IS NULL OR char_length(revoked_reason) <= 120),
  opens          integer NOT NULL DEFAULT 0 CHECK (opens >= 0),
  last_opened_at timestamptz,
  CHECK ((channel = 'whatsapp') = (message_id IS NOT NULL)),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_form_invite_tokens_one_copy
  ON public.cockpit_form_invite_tokens (invite_id) WHERE channel = 'copy' AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS cockpit_form_invite_tokens_invite ON public.cockpit_form_invite_tokens (invite_id);

-- Counts for the rate limits: hashes of the network and the browser, never
-- an address or a person. The schedule's sweep deletes rows older than 2 days.
CREATE TABLE IF NOT EXISTS public.cockpit_form_token_opens (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  net_hash     text NOT NULL CHECK (net_hash ~ '^[0-9a-f]{64}$'),
  browser_hash text CHECK (browser_hash IS NULL OR browser_hash ~ '^[0-9a-f]{64}$'),
  outcome      text NOT NULL CHECK (outcome IN ('ok','unknown','expired','used','withdrawn','not_live','limited','submitted','refused')),
  token_id     bigint
);
CREATE INDEX IF NOT EXISTS cockpit_form_token_opens_net ON public.cockpit_form_token_opens (net_hash, at);
CREATE INDEX IF NOT EXISTS cockpit_form_token_opens_browser ON public.cockpit_form_token_opens (browser_hash, at);

-- The portal's own client sessions, as counts per workspace (V12).
CREATE TABLE IF NOT EXISTS public.cockpit_portal_presence (
  location_id     text PRIMARY KEY CHECK (location_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  last_session_at timestamptz,
  admins          integer NOT NULL CHECK (admins BETWEEN 0 AND 10000),
  members         integer NOT NULL CHECK (members BETWEEN 0 AND 10000),
  pushed_at       timestamptz NOT NULL
);

-- The links between the new rows and the old tables, added once.
ALTER TABLE public.cockpit_client_messages ADD COLUMN IF NOT EXISTS invite_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'cockpit_form_responses_invite_fk') THEN
    ALTER TABLE public.cockpit_form_responses ADD CONSTRAINT cockpit_form_responses_invite_fk
      FOREIGN KEY (invite_id) REFERENCES public.cockpit_form_invites(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'cockpit_client_messages_invite_fk') THEN
    ALTER TABLE public.cockpit_client_messages ADD CONSTRAINT cockpit_client_messages_invite_fk
      FOREIGN KEY (invite_id) REFERENCES public.cockpit_form_invites(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'cockpit_client_messages_invite_kind') THEN
    ALTER TABLE public.cockpit_client_messages ADD CONSTRAINT cockpit_client_messages_invite_kind
      CHECK ((kind = 'form_invite') = (invite_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'cockpit_form_invites_message_fk') THEN
    ALTER TABLE public.cockpit_form_invites ADD CONSTRAINT cockpit_form_invites_message_fk
      FOREIGN KEY (message_id) REFERENCES public.cockpit_client_messages(id);
  END IF;
END $$;
-- One answer per invite (V3), whichever channel it came by.
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_form_responses_one_per_invite
  ON public.cockpit_form_responses (invite_id) WHERE invite_id IS NOT NULL AND state IN ('submitted','confirmed');
CREATE INDEX IF NOT EXISTS cockpit_client_messages_invite ON public.cockpit_client_messages (invite_id) WHERE invite_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Row security, grants, the audit and no deletes (2.1)

ALTER TABLE public.cockpit_form_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_form_invite_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_form_invite_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_form_token_opens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_portal_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_form_invites, public.cockpit_form_invite_events, public.cockpit_form_invite_tokens,
  public.cockpit_form_token_opens, public.cockpit_portal_presence FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.cockpit_form_invite_events_id_seq, public.cockpit_form_invite_tokens_id_seq,
  public.cockpit_form_token_opens_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_form_invites, public.cockpit_form_invite_tokens,
  public.cockpit_portal_presence TO service_role;
GRANT SELECT, INSERT ON public.cockpit_form_invite_events TO service_role;
GRANT SELECT, INSERT, DELETE ON public.cockpit_form_token_opens TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cockpit_form_invite_events_id_seq, public.cockpit_form_invite_tokens_id_seq,
  public.cockpit_form_token_opens_id_seq TO service_role;

-- One audit function for the three invite tables. It names its keys, so a
-- token's hash, an event's person and an invite's note never reach the log.
CREATE OR REPLACE FUNCTION public.cockpit_form_invites_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old jsonb;
  v_new jsonb := to_jsonb(NEW);
  v_keys text[];
  v_before jsonb;
  v_after jsonb;
  v_changed text[];
  v_actor text;
  v_invite text;
BEGIN
  IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD); END IF;
  v_keys := CASE TG_TABLE_NAME
    WHEN 'cockpit_form_invites' THEN ARRAY['task_id','form_key','form_version','purpose','origin','channels','state',
                                           'push_state','message_id','response_id','closed_reason','location_id','expires_at']
    WHEN 'cockpit_form_invite_events' THEN ARRAY['invite_id','source','event','detail']
    ELSE ARRAY['invite_id','channel','message_id','made_by','revoked_at','revoked_reason'] END;
  IF v_old IS NOT NULL THEN
    SELECT jsonb_object_agg(k, v_old->k) INTO v_before FROM unnest(v_keys) AS k;
  END IF;
  SELECT jsonb_object_agg(k, v_new->k) INTO v_after FROM unnest(v_keys) AS k;
  SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO v_changed
    FROM unnest(v_keys) AS k WHERE v_old IS NULL OR (v_old->k) IS DISTINCT FROM (v_new->k);
  IF v_old IS NOT NULL AND cardinality(v_changed) = 0 THEN
    RETURN NULL;
  END IF;
  v_invite := CASE WHEN TG_TABLE_NAME = 'cockpit_form_invites' THEN v_new->>'id' ELSE v_new->>'invite_id' END;
  SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (coalesce(nullif(current_setting('cockpit.forms_action', true), ''), 'forms.' || TG_TABLE_NAME || '.' || lower(TG_OP)),
          TG_TABLE_NAME, v_new->>'id',
          coalesce(v_actor, nullif(current_setting('cockpit.audit_actor', true), ''), session_user::text),
          'client-success', coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'),
          v_before, v_after,
          jsonb_build_object('op', lower(TG_OP), 'invite_id', v_invite, 'changed', to_jsonb(v_changed)));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cockpit_form_invites_audit ON public.cockpit_form_invites;
CREATE TRIGGER cockpit_form_invites_audit AFTER INSERT OR UPDATE ON public.cockpit_form_invites
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_invites_audit();
DROP TRIGGER IF EXISTS cockpit_form_invite_events_audit ON public.cockpit_form_invite_events;
CREATE TRIGGER cockpit_form_invite_events_audit AFTER INSERT ON public.cockpit_form_invite_events
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_invites_audit();
DROP TRIGGER IF EXISTS cockpit_form_invite_tokens_audit ON public.cockpit_form_invite_tokens;
CREATE TRIGGER cockpit_form_invite_tokens_audit AFTER INSERT OR UPDATE OF revoked_at ON public.cockpit_form_invite_tokens
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_invites_audit();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_form_invites','cockpit_form_invite_events','cockpit_form_invite_tokens'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_forms_no_delete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_forms_no_delete BEFORE DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_refuse_delete()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_forms_no_truncate ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_forms_no_truncate BEFORE TRUNCATE ON public.%I '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_forms_refuse_delete()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The client text rule and client form schema v1 (3.1, V18). Pure, and
--    owner-only: the portal mirrors them (client-form-schema.ts) on the same
--    fixture (apps/media-buyer-cockpit/scripts/fixtures/client-form-answers.json).

-- NULL when a client-facing text is fine, else the refusal sentence. The
-- leads pattern is 20261012f_wa_send_rules.sql line 77's, word for word.
CREATE OR REPLACE FUNCTION public.cockpit_client_text_ok(p_text text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_text IS NULL THEN RETURN NULL; END IF;
  IF p_text ~* '(^|[^ء-ي٠-٩A-Za-z0-9_])([وف]?(ال|لل|[بكل]|[بك]ال))?ليد(ز|ات)?(كم|كن|هم|هن|ها|ه|نا|ك)?($|[^ء-ي٠-٩A-Za-z0-9_])|(ال)?عملاء\s+(ال)?محتمل(ين|ون)|\mleads?\M|\mcpls?\M|\mcost\s+per\s+lead\M' THEN
    RETURN 'Client messages never quote leads or cost per lead. Say how the campaign is doing, or count appointments for clients we book for.';
  END IF;
  IF p_text ~* '\mguarantee[sd]?\M|\mguaranteeing\M|ضمان|نضمن|مضمون' THEN
    RETURN 'Client forms never promise results. Remove the guarantee wording.';
  END IF;
  RETURN NULL;
END $$;

-- A text of the schema: {en, ar}, both non-empty, each p_max characters at most.
CREATE OR REPLACE FUNCTION public.cockpit_form_schema_pair(p jsonb, p_max integer)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN jsonb_typeof(p) = 'object'
     AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k) = ARRAY['ar','en']
     AND jsonb_typeof(p->'en') = 'string' AND jsonb_typeof(p->'ar') = 'string'
     AND btrim(p->>'en') <> '' AND btrim(p->>'ar') <> ''
     AND char_length(p->>'en') <= p_max AND char_length(p->>'ar') <= p_max;
END $$;

-- NULL when the schema is a valid client form schema v1, else its first
-- problem as a sentence. Read by issue, go-live, the canary and the editor.
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
  IF jsonb_typeof(p_schema->'minutes') IS DISTINCT FROM 'number'
     OR (p_schema->>'minutes')::numeric NOT IN (1,2,3,4,5,6,7,8,9,10) THEN
    RETURN 'Minutes must be a whole number from 1 to 10.';
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
    IF k = ANY(v_keys) THEN
      RETURN format('Two questions share the key %s.', k);
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(f) fk
                WHERE fk NOT IN ('key','type','label','hint','required','min','max','lowLabel','highLabel',
                                 'options','maxLength','showIf','boldIf')) THEN
      RETURN format('Question %s has a setting it does not know.', k);
    END IF;
    t := CASE WHEN jsonb_typeof(f->'type') = 'string' THEN f->>'type' END;
    IF t IN ('date','file') THEN
      RETURN format('Question %s is a %s question, which client forms cannot take yet.', k, t);
    END IF;
    IF t IS NULL OR t NOT IN ('scale','choice','multi','text','longtext','tick') THEN
      RETURN format('Question %s has a type client forms do not know.', k);
    END IF;
    IF NOT public.cockpit_form_schema_pair(f->'label', 200) THEN
      RETURN format('Question %s needs an English and an Arabic label, each 200 characters at most.', k);
    END IF;
    IF f ? 'hint' AND f->'hint' <> 'null'::jsonb AND NOT public.cockpit_form_schema_pair(f->'hint', 600) THEN
      RETURN format('The hint of question %s needs English and Arabic, each 600 characters at most.', k);
    END IF;
    IF jsonb_typeof(f->'required') IS DISTINCT FROM 'boolean' THEN
      RETURN format('Question %s must say whether it is required.', k);
    END IF;

    -- Settings that belong to one type only.
    IF t <> 'scale' AND (f ? 'min' OR f ? 'max' OR f ? 'lowLabel' OR f ? 'highLabel') THEN
      RETURN format('Question %s has scale settings but is not a scale.', k);
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
    v_keys := v_keys || k;
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

-- NULL when every client-facing string of a schema passes the text rule,
-- else the rule's sentence. Run at seed, go-live and issue (and at publish, d).
CREATE OR REPLACE FUNCTION public.cockpit_form_schema_text_problem(p_schema jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text;
BEGIN
  IF jsonb_typeof(p_schema) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  SELECT public.cockpit_client_text_ok(s #>> '{}') INTO v
    FROM jsonb_path_query(p_schema, 'strict $.** ? (@.type() == "string")') s
   WHERE public.cockpit_client_text_ok(s #>> '{}') IS NOT NULL
   LIMIT 1;
  RETURN v;
END $$;

-- The one answer checker of every client form (3.1): {ok, errors, answers},
-- errors {fieldKey: code}, codes required, range, option, length, unknown,
-- hidden; answers the checked ones (texts trimmed and collapsed), which is
-- what is stored. A question is shown when its showIf holds on the checked
-- earlier answer (an unanswered tick reads false); a hidden question is never
-- required and its answer is refused. With a typed signer, a context that
-- carries "signer" (the link page's typed name) has it checked as "signer".
CREATE OR REPLACE FUNCTION public.cockpit_form_answers_check(p_schema jsonb, p_answers jsonb, p_context jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
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
    IF NOT v_vis THEN
      IF v IS NOT NULL THEN v_errors := v_errors || jsonb_build_object(k, 'hidden'); END IF;
      CONTINUE;
    END IF;
    -- Blank: missing, an empty or blank text, an empty list.
    IF v IS NULL OR (jsonb_typeof(v) = 'string' AND btrim(regexp_replace(v #>> '{}', '\s+', ' ', 'g')) = '')
       OR (jsonb_typeof(v) = 'array' AND jsonb_array_length(v) = 0) THEN
      IF v_req THEN v_errors := v_errors || jsonb_build_object(k, 'required'); END IF;
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

-- ---------------------------------------------------------------------------
-- 5. Small helpers (owner-only)

-- The switch (1.4): {"live":[...], "presence":bool}, defaults when missing.
CREATE OR REPLACE FUNCTION public.cockpit_form_client_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  SELECT CASE WHEN jsonb_typeof(c.value) = 'object' THEN c.value END INTO v
    FROM public.cockpit_settings c WHERE c.key = 'forms.client';
  RETURN jsonb_build_object(
    'live', CASE WHEN jsonb_typeof(v->'live') = 'array' THEN v->'live' ELSE '[]'::jsonb END,
    'presence', coalesce(v->>'presence', '') = 'true');
END $$;

-- A client form is live when its key is in forms.client.live and its
-- registry row is native and for clients (V5).
CREATE OR REPLACE FUNCTION public.cockpit_form_client_live(p_form_key text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.cockpit_forms f
                  WHERE f.key = p_form_key AND f.provider = 'native' AND f.audience = 'client')
     AND (public.cockpit_form_client_settings()->'live') ? coalesce(p_form_key, '');
END $$;

-- The newest version whose schema is client form schema v1 (2.3).
CREATE OR REPLACE FUNCTION public.cockpit_form_client_version(p_form_key text)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN (SELECT max(v.version) FROM public.cockpit_form_versions v
           WHERE v.form_key = p_form_key AND v.schema->'v' = '1'::jsonb);
END $$;

-- The card's latest departure that still holds: not removed and no resume
-- after it (W12 W21). Its id and whether it is confirmed, or NULL.
CREATE OR REPLACE FUNCTION public.cockpit_form_departure_of(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.cockpit_churn_departures;
BEGIN
  SELECT * INTO d FROM public.cockpit_churn_departures x
   WHERE x.clickup_task_id = p_task_id AND x.removed_at IS NULL
   ORDER BY x.left_on DESC, x.id DESC LIMIT 1;
  IF d.id IS NULL OR EXISTS (
       SELECT 1 FROM public.cockpit_billing_events e
        WHERE e.clickup_task_id = p_task_id AND e.kind = 'resume'
          AND (e.at AT TIME ZONE 'Asia/Kuwait')::date > d.left_on
          AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id)) THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('id', d.id, 'confirmed', d.confirmed_at IS NOT NULL, 'surveyState', d.survey_state,
                            'leftOn', d.left_on);
END $$;

-- NULL when the card may receive the form, else the refusal sentence (2.3,
-- V28). NPS, CSAT and pause consent go only to a card the billing mirror
-- holds as Active with no open departure; the exit survey only with an open
-- or confirmed departure, or a Stopped card. A card the mirror does not hold
-- (the test card) passes.
CREATE OR REPLACE FUNCTION public.cockpit_form_card_allows(p_task_id text, p_form_key text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.cockpit_billing_accounts; v_dep jsonb;
BEGIN
  SELECT * INTO a FROM public.cockpit_billing_accounts x WHERE x.clickup_task_id = p_task_id;
  IF a.clickup_task_id IS NULL THEN RETURN NULL; END IF;
  v_dep := public.cockpit_form_departure_of(p_task_id);
  IF p_form_key = 'exit_survey' THEN
    IF v_dep IS NOT NULL OR a.client_status = 'Stopped' THEN RETURN NULL; END IF;
    RETURN 'Mark Client is leaving first, then send the exit survey.';
  ELSIF p_form_key IN ('nps','csat','pause_consent') THEN
    IF v_dep IS NOT NULL AND NOT (v_dep->>'confirmed')::boolean THEN
      RETURN coalesce(nullif(btrim(a.client_name), ''), 'This client') || ' is leaving. Send the exit survey instead.';
    END IF;
    IF a.client_status IS DISTINCT FROM 'Active' THEN
      RETURN coalesce(nullif(btrim(a.client_name), ''), 'This client') || ' is not an active client, so this form does not go to them.';
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- The card's portal workspace: {n, locationId, name, status, closed}.
CREATE OR REPLACE FUNCTION public.cockpit_form_workspace_of(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer; w record;
BEGIN
  SELECT count(*) INTO n FROM portal_data.workspaces x WHERE x.clickup_id = p_task_id;
  IF n <> 1 THEN RETURN jsonb_build_object('n', n); END IF;
  SELECT x.location_id, x.name, x.status INTO w FROM portal_data.workspaces x WHERE x.clickup_id = p_task_id;
  RETURN jsonb_build_object('n', 1, 'locationId', w.location_id, 'name', w.name, 'status', w.status,
                            'closed', w.status IN ('Cancelled','Removed from sheet'));
END $$;

-- Who can see the portal now: a live client session in the last 14 days.
CREATE OR REPLACE FUNCTION public.cockpit_form_portal_live(p_presence public.cockpit_portal_presence, p_audience text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN p_presence.location_id IS NOT NULL AND p_presence.last_session_at > now() - interval '14 days'
     AND CASE WHEN p_audience = 'admin' THEN p_presence.admins > 0
              ELSE p_presence.admins + p_presence.members > 0 END;
END $$;

-- The default channels of one form for one card (3.3): no open workspace,
-- the link; a live session of someone who may answer, the portal; else both,
-- and both while the portal has not reported its sessions yet.
CREATE OR REPLACE FUNCTION public.cockpit_form_default_channels(p_audience text, p_ws jsonb, p_presence public.cockpit_portal_presence)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce((p_ws->>'n')::integer, 0) <> 1 OR coalesce((p_ws->>'closed')::boolean, true) THEN
    RETURN ARRAY['whatsapp'];
  END IF;
  IF p_presence.location_id IS NULL THEN
    RETURN ARRAY['portal','whatsapp'];
  END IF;
  IF public.cockpit_form_portal_live(p_presence, p_audience) THEN
    RETURN ARRAY['portal'];
  END IF;
  RETURN ARRAY['portal','whatsapp'];
END $$;

-- A form in a sentence: {words, article} ("An NPS survey").
CREATE OR REPLACE FUNCTION public.cockpit_form_words(p_form_key text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_form_key
    WHEN 'nps' THEN '{"words":"NPS survey","article":"An"}'::jsonb
    WHEN 'csat' THEN '{"words":"onboarding survey","article":"An"}'::jsonb
    WHEN 'exit_survey' THEN '{"words":"exit survey","article":"An"}'::jsonb
    WHEN 'pause_consent' THEN '{"words":"pause consent","article":"A"}'::jsonb
    WHEN 'portal_feedback' THEN '{"words":"portal feedback","article":"A"}'::jsonb
    ELSE jsonb_build_object('words', 'form', 'article', 'A') END
$$;

-- "1 Nov 2026" in Kuwait time.
CREATE OR REPLACE FUNCTION public.cockpit_form_day_words(p timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_char(public.cockpit_form_kuwait_day(p), 'FMDD Mon YYYY')
$$;

-- The seat's role in words, never an address.
CREATE OR REPLACE FUNCTION public.cockpit_form_role_words(p_seat jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce((p_seat->>'ceo')::boolean, false) THEN RETURN 'the CEO'; END IF;
  RETURN left(coalesce(public.cockpit_slack_notice_role_of(p_seat->>'email'),
                       CASE WHEN coalesce((p_seat->>'admin')::boolean, false) THEN 'an admin'
                            WHEN coalesce((p_seat->>'csm')::boolean, false) THEN 'the CSM'
                            ELSE 'a team member' END), 60);
END $$;

-- The schema an invite was issued with.
CREATE OR REPLACE FUNCTION public.cockpit_form_invite_schema(p_invite public.cockpit_form_invites)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT v.schema FROM public.cockpit_form_versions v
   WHERE v.form_key = p_invite.form_key AND v.version = p_invite.form_version
$$;

-- An invite's state as a reader tells it: open past its end reads expired (V25).
CREATE OR REPLACE FUNCTION public.cockpit_form_invite_state(p_invite public.cockpit_form_invites)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p_invite.state = 'open' AND p_invite.expires_at <= now() THEN 'expired' ELSE p_invite.state END
$$;

-- One event row. Never a token or an answer in the detail.
CREATE OR REPLACE FUNCTION public.cockpit_form_invite_event(p_invite uuid, p_source text, p_event text, p_person text, p_detail jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.cockpit_form_invite_events(invite_id, source, event, person, detail)
  VALUES (p_invite, p_source, p_event, CASE WHEN p_source = 'portal' THEN lower(btrim(p_person)) END,
          CASE WHEN jsonb_typeof(p_detail) = 'object' THEN p_detail ELSE '{}'::jsonb END);
END $$;

-- ---------------------------------------------------------------------------
-- 6. The replaced functions (2.2): each live body with the smallest edit,
--    the six kinds of 3.4 in each list, the live rules of the client's voice,
--    message kind form_invite, the invite's message gate, the four doors.

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_shape(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_kind IN ('kickoff','blueprint.close','blueprint.media','checkin.grade','checkin.recap_late',
                    'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed',
                    'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received') THEN 'post'
    WHEN p_kind IN ('kickoff.updated','blueprint.updated','blueprint.offer') THEN 'reply'
    WHEN p_kind IN ('kickoff.late','kickoff.second') THEN 'variant'
    WHEN p_kind = 'rehearsal' THEN 'test'
  END
$$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_kind_label(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
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
    ELSE p_kind
  END
$$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_live(p_row public.cockpit_slack_notices)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_inputs(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
                                       'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received') THEN
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
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_doctor_inputs()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
                                             'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received'], s.kind))
                            FROM public.cockpit_slack_notice_settings s), '[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_settings_read()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
                                   'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received'], x.kind)
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
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_channel_remove(p_channel text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
                                 'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received'], s.kind) LIMIT 1;
  IF v_kind IS NOT NULL THEN
    RAISE EXCEPTION 'The % notice posts there. Choose another channel for it first.', public.cockpit_slack_notice_kind_label(v_kind)
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.cockpit_slack_channels SET state = 'removed', note = 'Removed from the list.', updated_at = now() WHERE id = v_id;
  RETURN public.cockpit_slack_notice_settings_read();
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_rehearse(p_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; v_uid text; v_kind text := coalesce(nullif(btrim(p_kind), ''), 'kickoff'); v_id uuid;
BEGIN
  g := public.cockpit_forms_editor_gate();
  v_uid := g->>'actorId';
  IF v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','checkin.grade','checkin.recap_late',
                    'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed',
                    'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received') THEN
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
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_rehearse_service(p_kind text, p_target text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_kind text := coalesce(nullif(btrim(p_kind), ''), 'kickoff'); v_id uuid;
BEGIN
  IF v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer','checkin.grade','checkin.recap_late',
                    'termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed',
                    'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received') THEN
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
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_read(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
                                                                       'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received'))
                                         OR (v_finance AND x.kind IN ('termination.notice','termination.submitted','churn.confirmed','extension.granted','pause.agreed','client.resumed',
                                                                 'pause.consent','nps.received','csat.received','voice.low','feedback.received','legacy.received')))
                                  ORDER BY x.created_at DESC, x.id LIMIT 20) v), '[]'::jsonb));
END $$;

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
  v_word := CASE WHEN m.kind = 'form_invite' THEN 'message' ELSE 'recap' END;
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
       SELECT 1 FROM unnest(p_kinds) AS k(v) WHERE k.v IS NULL OR k.v NOT IN ('recap_checkin','recap_kickoff','recap_blueprint','phase5','form_invite')) THEN
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
                                             WHEN 'recap_blueprint' THEN 'blueprint' END);
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
                  WHEN v_form IS NOT NULL THEN public.cockpit_form_effect_owner(v_form, 'recap') END,
    'formKey', v_form,
    'inviteId', v_invite,
    'effectState', v_effect,
    'triesUsedUp', p_row.attempts >= 3);
END $$;

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
    SELECT x.id, x.response_id, x.form_key, x.effect_key, x.state, x.owner, r.mode, r.submitted_at,
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

CREATE OR REPLACE FUNCTION public.cockpit_form_doors()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
  RETURN jsonb_build_object(
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
END $$;


-- ---------------------------------------------------------------------------
-- 7. The invite core (owner-only)

-- Close one open invite: its state, its tokens revoked, its unsent message
-- skipped when it is a draft or approved (the only moves the messages guard
-- allows; a claimed or sending one is left to the gate, 3.3), one event.
-- False when the invite was not open.
CREATE OR REPLACE FUNCTION public.cockpit_form_invite_close(p_invite uuid, p_state text, p_reason text, p_by text,
  p_source text, p_detail jsonb, p_skip_reason text, p_response uuid DEFAULT NULL, p_person text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.cockpit_form_invites; v_prev text := current_setting('cockpit.forms_action', true);
BEGIN
  IF p_state NOT IN ('answered','withdrawn','expired') THEN
    RAISE EXCEPTION 'An invite closes as answered, withdrawn or expired.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.forms_action', 'forms.invite_' || p_state, true);
  UPDATE public.cockpit_form_invites x
     SET state = p_state,
         closed_at = CASE WHEN p_state = 'expired' THEN least(now(), x.expires_at) ELSE now() END,
         closed_by = left(p_by, 120), closed_reason = left(p_reason, 240),
         answered_at = CASE WHEN p_state = 'answered' THEN now() END,
         response_id = CASE WHEN p_state = 'answered' THEN p_response END,
         push_state = CASE WHEN x.push_state = 'waiting' THEN 'off' ELSE x.push_state END,
         push_result = CASE WHEN x.push_state = 'waiting' THEN jsonb_build_object('reason', 'invite_closed_first') ELSE x.push_result END,
         updated_at = now()
   WHERE x.id = p_invite AND x.state = 'open'
  RETURNING * INTO i;
  IF i.id IS NULL THEN
    PERFORM set_config('cockpit.forms_action', coalesce(v_prev, ''), true);
    RETURN false;
  END IF;
  UPDATE public.cockpit_form_invite_tokens t
     SET revoked_at = now(),
         revoked_reason = CASE p_state WHEN 'answered' THEN 'The form was answered.'
                                       WHEN 'withdrawn' THEN 'The form was withdrawn.' ELSE 'The invite ran out.' END
   WHERE t.invite_id = p_invite AND t.revoked_at IS NULL;
  PERFORM set_config('cockpit.forms_action', 'forms.message_skipped', true);
  UPDATE public.cockpit_client_messages m
     SET state = 'skipped', reason = left(p_skip_reason, 240), claim_token = NULL
   WHERE m.invite_id = p_invite AND m.kind = 'form_invite' AND m.state IN ('draft','approved');
  PERFORM set_config('cockpit.forms_action', 'forms.invite_' || p_state, true);
  PERFORM public.cockpit_form_invite_event(p_invite, p_source, p_state, p_person, p_detail);
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev, ''), true);
  RETURN true;
END $$;

-- Open invites past their 14 days become expired (V25). VOLATILE: only the
-- write paths and the schedule's sweep call it, never a read.
CREATE OR REPLACE FUNCTION public.cockpit_form_invites_expire()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT x.id FROM public.cockpit_form_invites x
            WHERE x.state = 'open' AND x.expires_at <= now()
            ORDER BY x.expires_at, x.id FOR UPDATE SKIP LOCKED LOOP
    IF public.cockpit_form_invite_close(r.id, 'expired', 'Ran out after 14 days.', 'the cockpit', 'cockpit', '{}'::jsonb,
         'The form link ran out after 14 days, so it was not sent.') THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;

-- Every open invite whose card no longer qualifies (2.3), withdrawn; the
-- schedule's sweep calls it. The portal paths refuse such an invite at once.
CREATE OR REPLACE FUNCTION public.cockpit_form_invites_withdraw_ineligible()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; v_why text; v_reason text; n integer := 0;
BEGIN
  FOR r IN SELECT x.id, x.task_id, x.form_key FROM public.cockpit_form_invites x
            WHERE x.state = 'open' AND x.origin <> 'canary'
            ORDER BY x.issued_at, x.id FOR UPDATE SKIP LOCKED LOOP
    v_why := public.cockpit_form_card_allows(r.task_id, r.form_key);
    CONTINUE WHEN v_why IS NULL;
    v_reason := CASE WHEN r.form_key = 'exit_survey' THEN 'The client is no longer leaving.'
                     WHEN v_why LIKE '% is leaving.%' THEN 'The client is leaving.'
                     ELSE 'The client is no longer active.' END;
    IF public.cockpit_form_invite_close(r.id, 'withdrawn', v_reason, 'the cockpit', 'schedule',
         jsonb_build_object('by', 'schedule', 'reason', v_reason), 'Withdrawn: ' || v_reason) THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;

-- A new link token (3.6): f1 plus 43 base64url characters, 256 bits. Only
-- its sha256 is stored; the raw token is returned once to the caller.
CREATE OR REPLACE FUNCTION public.cockpit_form_token_mint(p_invite uuid, p_channel text, p_message uuid, p_by text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_token text;
BEGIN
  v_token := 'f1' || translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  IF v_token !~ '^f1[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'The link could not be made. Try again.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_form_invite_tokens(invite_id, channel, token_sha256, message_id, made_by)
  VALUES (p_invite, p_channel, encode(pg_catalog.sha256(convert_to(v_token, 'UTF8')), 'hex'), p_message, left(p_by, 60));
  RETURN v_token;
END $$;

-- The message gate of a form_invite message (2.2): open and not past its end,
-- the form live (or a canary invite), the card still allowed (the exit survey
-- is exempt: it goes to clients who left), WhatsApp among its channels.
CREATE OR REPLACE FUNCTION public.cockpit_form_invite_gate(p_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.cockpit_client_messages; i public.cockpit_form_invites; v_why text; v_state text;
BEGIN
  SELECT * INTO m FROM public.cockpit_client_messages x WHERE x.id = p_message_id;
  IF m.id IS NOT NULL AND m.kind = 'form_invite' THEN
    SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = m.invite_id;
  END IF;
  IF i.id IS NULL THEN
    v_why := 'This message has no form invite, so nothing was sent.';
  ELSE
    v_state := public.cockpit_form_invite_state(i);
    v_why := CASE
      WHEN v_state = 'answered' THEN 'The client already answered the form, so the link was not sent.'
      WHEN v_state = 'withdrawn' THEN 'The form was withdrawn, so the link was not sent.'
      WHEN v_state = 'expired' THEN 'The form ran out after 14 days, so the link was not sent.'
      WHEN NOT 'whatsapp' = ANY(i.channels) THEN 'This form does not go by WhatsApp, so the link was not sent.'
      WHEN i.origin <> 'canary' AND NOT public.cockpit_form_client_live(i.form_key)
        THEN 'This form is switched off for clients, so the link was not sent.'
      WHEN i.form_key <> 'exit_survey' THEN public.cockpit_form_card_allows(i.task_id, i.form_key)
    END;
  END IF;
  RETURN jsonb_build_object('ok', v_why IS NULL, 'effectId', NULL, 'responseId', NULL,
    'formKey', i.form_key, 'effectKey', 'form_invite', 'effectState', NULL, 'inviteId', i.id, 'reason', v_why);
END $$;

-- The dispatchers (V19). An issue hook is a rule: its refusal rolls the issue
-- back. A canary's notices are muted where they were queued.
CREATE OR REPLACE FUNCTION public.cockpit_form_client_issued(p_invite_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.cockpit_form_invites; v_hook text;
BEGIN
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = p_invite_id;
  IF i.id IS NULL THEN
    RAISE EXCEPTION 'There is no invite with that ID.' USING ERRCODE = '22023';
  END IF;
  v_hook := 'cockpit_form_issue_hook_' || i.form_key;
  IF to_regprocedure('public.' || v_hook || '(uuid)') IS NOT NULL THEN
    EXECUTE format('SELECT public.%I($1)', v_hook) USING p_invite_id;
  ELSE
    v_hook := NULL;
  END IF;
  IF i.origin = 'canary' THEN
    UPDATE public.cockpit_slack_notices n
       SET state = 'muted', finished_at = now(), error = 'Canary on the test card: not posted'
     WHERE n.state = 'queued' AND n.task_id = i.task_id AND n.created_at = now();
  END IF;
  RETURN jsonb_build_object('hook', v_hook);
END $$;

-- A link has left the cockpit (a seat copied it, or the invite's WhatsApp
-- message was sent: cockpit_form_invite_message_sent, never the worker's
-- mint, since a send can still fail after it): the form's link hook, when
-- 20261102c makes one (NPS Survey Sent for an invite with no portal channel
-- waits for this).
-- Caught like an answer hook: a raise writes hook_failed and the link still
-- goes, since the send must not depend on a card field.
CREATE OR REPLACE FUNCTION public.cockpit_form_client_link_out(p_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.cockpit_form_invites; v_hook text;
BEGIN
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = p_invite_id;
  IF i.id IS NULL THEN RETURN; END IF;
  v_hook := 'cockpit_form_link_hook_' || i.form_key;
  IF to_regprocedure('public.' || v_hook || '(uuid)') IS NULL THEN RETURN; END IF;
  BEGIN
    EXECUTE format('SELECT public.%I($1)', v_hook) USING p_invite_id;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_form_invite_event(i.id, 'cockpit', 'hook_failed', NULL,
      jsonb_build_object('hook', v_hook, 'sqlstate', SQLSTATE));
  END;
END $$;

-- After an answer is stored (4.1.2): the invite to answered (its tokens
-- revoked, its unsent message skipped, event answered), then the form's hook
-- in a caught block: a raise rolls back the hook's own writes only, writes
-- hook_failed (the hook and the SQLSTATE, never the message or an answer),
-- and the answer stays (E19, V30). Idempotent: a re-run by the owner after a
-- fix finds the invite answered and runs the hook again, whose dedupe keys
-- stop doubles.
CREATE OR REPLACE FUNCTION public.cockpit_form_client_submitted(p_response_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_form_responses;
  i public.cockpit_form_invites;
  v_hook text;
  v_state text;
  v_failed boolean := false;
  v_source text;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF r.id IS NULL OR r.invite_id IS NULL THEN
    RAISE EXCEPTION 'There is no client answer with that ID.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = r.invite_id FOR UPDATE;
  v_source := CASE r.source WHEN 'portal' THEN 'portal' WHEN 'public' THEN 'token' ELSE 'cockpit' END;
  IF i.state = 'open' THEN
    PERFORM public.cockpit_form_invite_close(i.id, 'answered', NULL,
      CASE v_source WHEN 'portal' THEN 'the client' WHEN 'token' THEN 'the client by link' ELSE 'the cockpit' END,
      v_source, jsonb_build_object('responseId', r.id),
      CASE v_source WHEN 'portal' THEN 'Answered in the portal.' ELSE 'Answered by link.' END,
      r.id, CASE WHEN v_source = 'portal' THEN r.submitted_by END);
  END IF;
  v_hook := 'cockpit_form_hook_' || r.form_key;
  IF to_regprocedure('public.' || v_hook || '(uuid)') IS NOT NULL THEN
    BEGIN
      EXECUTE format('SELECT public.%I($1)', v_hook) USING p_response_id;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      v_failed := true;
      PERFORM public.cockpit_form_invite_event(i.id, 'cockpit', 'hook_failed', NULL,
        jsonb_build_object('hook', v_hook, 'sqlstate', v_state));
    END;
  ELSE
    v_hook := NULL;
  END IF;
  IF i.origin = 'canary' THEN
    UPDATE public.cockpit_slack_notices n
       SET state = 'muted', finished_at = now(), error = 'Canary on the test card: not posted'
     WHERE n.state = 'queued' AND n.task_id = i.task_id AND n.created_at = now();
  END IF;
  RETURN jsonb_build_object('hook', v_hook, 'hookFailed', v_failed);
END $$;

-- The portal's view of one invite (PortalInvite, 3.3).
CREATE OR REPLACE FUNCTION public.cockpit_form_portal_invite(p_invite public.cockpit_form_invites)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s jsonb := public.cockpit_form_invite_schema(p_invite); v_from text;
BEGIN
  IF p_invite.origin NOT IN ('schedule','canary') AND p_invite.issued_by_email IS NOT NULL THEN
    SELECT nullif(split_part(btrim(coalesce(nullif(btrim(m.name), ''), nullif(btrim(pp.name), ''), '')), ' ', 1), '')
      INTO v_from
      FROM public.cockpit_members m
      LEFT JOIN public.cockpit_people pp ON lower(btrim(pp.email)) = m.email
     WHERE m.email = lower(btrim(p_invite.issued_by_email))
     ORDER BY m.updated_at DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'id', p_invite.id, 'formKey', p_invite.form_key, 'version', p_invite.form_version,
    'title', s->'title', 'minutes', s->'minutes', 'note', p_invite.note, 'from', v_from,
    'issuedAt', p_invite.issued_at, 'expiresAt', p_invite.expires_at, 'audience', p_invite.audience,
    'lang', p_invite.lang);
END $$;

-- Whether a signed-in client of this card may see the invite in the portal.
CREATE OR REPLACE FUNCTION public.cockpit_form_portal_visible(p_invite public.cockpit_form_invites, p_access_role text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN public.cockpit_form_invite_state(p_invite) = 'open'
     AND p_invite.origin <> 'canary'
     AND 'portal' = ANY(p_invite.channels)
     AND public.cockpit_form_client_live(p_invite.form_key)
     AND (p_invite.audience = 'any' OR p_access_role = 'admin')
     AND public.cockpit_form_card_allows(p_invite.task_id, p_invite.form_key) IS NULL;
END $$;

-- The portal's workspace check (3.3): ids well formed, one open workspace
-- with both, and no other open workspace carrying the card (the issue path
-- refuses the portal then too), else form_invite_not_in_workspace (the
-- portal's 403). Each portal read and answer also requires the invite's own
-- location_id, so a second workspace on the card never sees another's.
CREATE OR REPLACE FUNCTION public.cockpit_form_portal_workspace(p_location_id text, p_clickup_id text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_location_id IS NULL OR p_clickup_id IS NULL OR p_location_id !~ '^[A-Za-z0-9_-]{1,100}$'
     OR p_clickup_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'form_invite_invalid_workspace' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM portal_data.workspaces w
       WHERE w.location_id = p_location_id AND w.clickup_id = p_clickup_id
         AND w.status NOT IN ('Cancelled','Removed from sheet')) <> 1
     OR (SELECT count(*) FROM portal_data.workspaces w
          WHERE w.clickup_id = p_clickup_id AND w.status NOT IN ('Cancelled','Removed from sheet')) <> 1 THEN
    RAISE EXCEPTION 'form_invite_not_in_workspace' USING ERRCODE = '42501';
  END IF;
END $$;

-- The invite's context as a client may see it (3.3): only the facts the
-- schema declares, the keys its boldIf lines read, and over14. Anything
-- else the cockpit keeps on the invite (the call id, the reason category)
-- stays in the cockpit.
CREATE OR REPLACE FUNCTION public.cockpit_form_client_context(p_invite public.cockpit_form_invites)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s jsonb := public.cockpit_form_invite_schema(p_invite); v_keys text[];
BEGIN
  SELECT coalesce(array_agg(k), '{}') INTO v_keys FROM (
    SELECT c->>'key' AS k
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s->'context') = 'array' THEN s->'context' ELSE '[]'::jsonb END) c
     WHERE jsonb_typeof(c) = 'object'
    UNION
    SELECT f->'boldIf'->>'context'
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s->'fields') = 'array' THEN s->'fields' ELSE '[]'::jsonb END) f
     WHERE jsonb_typeof(f) = 'object' AND jsonb_typeof(f->'boldIf') = 'object'
    UNION
    SELECT 'over14') u WHERE k IS NOT NULL;
  RETURN coalesce((SELECT jsonb_object_agg(e.key, e.value)
                     FROM jsonb_each(CASE WHEN jsonb_typeof(p_invite.context) = 'object' THEN p_invite.context ELSE '{}'::jsonb END) e
                    WHERE e.key = ANY(v_keys)), '{}'::jsonb);
END $$;

-- One invite as the cockpit shows it (InviteRow, 3.3). Roles, never addresses.
CREATE OR REPLACE FUNCTION public.cockpit_form_invite_row(p_invite public.cockpit_form_invites)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_opened timestamptz; v_seen timestamptz; v_msg text; v_link boolean;
BEGIN
  SELECT min(e.at) FILTER (WHERE e.event = 'opened'), min(e.at) FILTER (WHERE e.event = 'shown')
    INTO v_opened, v_seen
    FROM public.cockpit_form_invite_events e WHERE e.invite_id = p_invite.id;
  SELECT m.state INTO v_msg FROM public.cockpit_client_messages m WHERE m.id = p_invite.message_id;
  v_link := EXISTS (SELECT 1 FROM public.cockpit_form_invite_tokens t WHERE t.invite_id = p_invite.id);
  RETURN jsonb_build_object(
    'id', p_invite.id, 'formKey', p_invite.form_key,
    'title', coalesce(public.cockpit_form_invite_schema(p_invite)->'title'->>'en', p_invite.form_key),
    'state', public.cockpit_form_invite_state(p_invite), 'channels', to_jsonb(p_invite.channels),
    'origin', p_invite.origin, 'issuedAt', p_invite.issued_at, 'issuedByRole', p_invite.issued_by_role,
    'expiresAt', p_invite.expires_at, 'opened', v_opened IS NOT NULL, 'openedAt', v_opened, 'seenAt', v_seen,
    'answeredAt', p_invite.answered_at, 'responseId', p_invite.response_id, 'messageId', p_invite.message_id,
    'messageState', v_msg, 'linkMade', v_link,
    'closedReason', CASE WHEN p_invite.state = 'open' AND p_invite.expires_at <= now() THEN 'Ran out after 14 days.'
                         ELSE p_invite.closed_reason END);
END $$;

-- The client page's view of one card (3.3). Reads only.
CREATE OR REPLACE FUNCTION public.cockpit_form_invite_build_view(p_task_id text, p_client text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws jsonb := public.cockpit_form_workspace_of(p_task_id);
  p public.cockpit_portal_presence;
  v_status text;
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
  v_csat timestamptz;
  v_words jsonb;
  v_note text;
  v_problem text;
  v_days integer;
  v_people integer;
  v_defaults text[];
  v_admin_note text;
BEGIN
  IF (v_ws->>'n')::integer = 1 THEN
    SELECT * INTO p FROM public.cockpit_portal_presence x WHERE x.location_id = v_ws->>'locationId';
  END IF;
  SELECT a.client_status INTO v_status FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = p_task_id;
  v_problem := CASE WHEN (v_ws->>'n')::integer = 0 THEN 'no_workspace'
                    WHEN (v_ws->>'n')::integer > 1 THEN 'two_workspaces'
                    WHEN (v_ws->>'closed')::boolean THEN 'workspace_closed'
                    WHEN p.location_id IS NOT NULL AND NOT public.cockpit_form_portal_live(p, 'any') THEN 'no_recent_session' END;
  v_days := CASE WHEN p.last_session_at IS NOT NULL THEN greatest(0, (now()::date - p.last_session_at::date)) END;
  v_people := CASE WHEN p.location_id IS NOT NULL THEN p.admins + p.members END;
  v_note := CASE
    WHEN (v_ws->>'n')::integer = 0 THEN 'No Mahara OS workspace: the WhatsApp link goes.'
    WHEN (v_ws->>'n')::integer > 1 THEN 'Two Mahara OS workspaces carry this card, so the WhatsApp link goes. Fix the Client Data sheet.'
    WHEN (v_ws->>'closed')::boolean THEN 'Workspace closed: send the link by WhatsApp.'
    WHEN p.location_id IS NULL THEN 'We can''t see portal visits yet, so it goes to the portal and by WhatsApp.'
    WHEN NOT public.cockpit_form_portal_live(p, 'any') THEN 'Has not opened the portal in 14 days, so the WhatsApp link goes too.'
    ELSE 'Opened the portal ' || CASE v_days WHEN 0 THEN 'today' WHEN 1 THEN '1 day ago' ELSE v_days || ' days ago' END
         || ' · ' || v_people || CASE WHEN v_people = 1 THEN ' person' ELSE ' people' END END;
  v_admin_note := CASE WHEN (v_ws->>'n')::integer = 1 AND NOT (v_ws->>'closed')::boolean AND p.location_id IS NOT NULL
                            AND public.cockpit_form_portal_live(p, 'any') AND NOT public.cockpit_form_portal_live(p, 'admin')
                       THEN 'No admin has opened the portal in 14 days, so the WhatsApp link goes too.' END;

  FOREACH v_key IN ARRAY ARRAY['nps','csat','exit_survey','pause_consent'] LOOP
    SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = v_key;
    CONTINUE WHEN f.key IS NULL;
    v_ver := public.cockpit_form_client_version(v_key);
    v_schema := CASE WHEN v_ver IS NOT NULL THEN (SELECT v.schema FROM public.cockpit_form_versions v
                                                   WHERE v.form_key = v_key AND v.version = v_ver) END;
    v_live := public.cockpit_form_client_live(v_key);
    v_aud := coalesce(v_schema->>'audience', CASE WHEN v_key IN ('exit_survey','pause_consent') THEN 'admin' ELSE 'any' END);
    v_words := public.cockpit_form_words(v_key);
    v_open := NULL;
    SELECT * INTO v_open FROM public.cockpit_form_invites x
     WHERE x.task_id = p_task_id AND x.form_key = v_key AND x.state = 'open' AND x.expires_at > now()
     ORDER BY x.issued_at DESC LIMIT 1;
    v_csat := NULL;
    IF v_key = 'csat' THEN
      SELECT max(r.submitted_at) INTO v_csat FROM public.cockpit_form_responses r
       WHERE r.form_key = 'csat' AND r.task_id = p_task_id AND r.state IN ('submitted','confirmed') AND r.mode = 'live';
    END IF;
    v_why := CASE
      WHEN NOT v_live THEN 'Opens to clients after its switch-on.'
      WHEN v_key = 'pause_consent' THEN 'Sent from Pause this client.'
      WHEN v_csat IS NOT NULL THEN 'They already filled it on ' || public.cockpit_form_day_words(v_csat) || '.'
      ELSE public.cockpit_form_card_allows(p_task_id, v_key) END;
    IF v_why IS NULL AND v_open.id IS NOT NULL THEN
      v_why := (v_words->>'article') || ' ' || (v_words->>'words') || ' is already out to ' || coalesce(p_client, 'this client')
               || ', sent ' || public.cockpit_form_day_words(v_open.issued_at) || '. Withdraw it to send a new one.';
    END IF;
    v_defaults := public.cockpit_form_default_channels(v_aud, v_ws, p);
    v_forms := v_forms || jsonb_build_array(jsonb_build_object(
      'key', v_key,
      'title', coalesce(v_schema->'title', jsonb_build_object('en', f.title, 'ar', NULL)),
      'live', v_live, 'sendable', v_why IS NULL, 'why', v_why, 'audience', v_aud,
      'defaultChannels', to_jsonb(v_defaults),
      'note', CASE WHEN v_aud = 'admin' THEN v_admin_note END));
    IF jsonb_typeof(v_schema->'invite'->'whatsapp') = 'object' THEN
      v_templates := v_templates || jsonb_build_object(v_key, v_schema->'invite'->'whatsapp');
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'taskId', p_task_id, 'clientName', p_client, 'cardStatus', v_status,
    'workspace', CASE WHEN (v_ws->>'n')::integer = 1
                      THEN jsonb_build_object('locationId', v_ws->>'locationId', 'name', v_ws->>'name', 'status', v_ws->>'status') END,
    'presence', jsonb_build_object('lastSessionAt', p.last_session_at,
                  'admins', CASE WHEN p.location_id IS NOT NULL THEN p.admins END,
                  'members', CASE WHEN p.location_id IS NOT NULL THEN p.members END,
                  'pushedAt', p.pushed_at, 'note', v_note),
    'problem', v_problem,
    'defaultChannels', to_jsonb(public.cockpit_form_default_channels('any', v_ws, p)),
    'forms', v_forms,
    'open', coalesce((SELECT jsonb_agg(public.cockpit_form_invite_row(x) ORDER BY x.issued_at DESC, x.id)
                        FROM public.cockpit_form_invites x
                       WHERE x.task_id = p_task_id AND x.state = 'open' AND x.expires_at > now()), '[]'::jsonb),
    'history', coalesce((SELECT jsonb_agg(public.cockpit_form_invite_row(h) ORDER BY h.issued_at DESC, h.id)
                           FROM (SELECT * FROM public.cockpit_form_invites x
                                  WHERE x.task_id = p_task_id AND NOT (x.state = 'open' AND x.expires_at > now())
                                  ORDER BY x.issued_at DESC, x.id LIMIT 10) h), '[]'::jsonb),
    'templates', v_templates,
    'now', now());
END $$;

-- Every rule of issue but the seat gate (3.3, 3.10), shared by the seats, the
-- schedule's issuer and the canary door. p_actor {id, email, role, source}.
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
  v_words jsonb := public.cockpit_form_words(p_form_key);
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
  IF f.key IS NULL OR f.audience <> 'client' OR p_form_key NOT IN ('pause_consent','exit_survey','nps','csat') THEN
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
  IF p_form_key = 'pause_consent' AND p_origin NOT IN ('pause','canary') THEN
    RAISE EXCEPTION 'Send the pause consent from Pause this client.' USING ERRCODE = '22023';
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

-- ---------------------------------------------------------------------------
-- 8. The seat RPCs (authenticated; each gated first: the CEO, an admin, or a
--    CSM through the client gate of the card)

-- The seat and the card's client name, or a refusal (42501 who, 22023 what).
CREATE OR REPLACE FUNCTION public.cockpit_form_invite_seat(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seat jsonb; v_client text;
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  v_seat := public.cockpit_form_actor();
  IF NOT (coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'admin')::boolean, false)) THEN
    v_client := public.cockpit_csm_client_gate(p_task_id)->>'clientName';
  END IF;
  SELECT coalesce(a.client_name, v_client) INTO v_client FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = p_task_id;
  RETURN v_seat || jsonb_build_object('clientName', v_client);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_form_invite_view(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seat jsonb := public.cockpit_form_invite_seat(p_task_id);
BEGIN
  RETURN public.cockpit_form_invite_build_view(p_task_id, v_seat->>'clientName');
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
  IF v_origin NOT IN ('csm','pause','churn') THEN
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
      'view', public.cockpit_form_invite_build_view(p_task_id, v_seat->>'clientName'));
  END IF;
  PERFORM public.cockpit_form_invites_expire();
  PERFORM set_config('cockpit.audit_source', 'cockpit', true);
  v_out := public.cockpit_form_invite_issue_core(p_task_id, p_form_key, p_channels, p_note, p_lang, p_push, p_context,
    p_request_id, v_origin,
    jsonb_build_object('id', v_seat->>'actorId', 'email', v_seat->>'email',
                       'role', public.cockpit_form_role_words(v_seat), 'source', 'cockpit'));
  RETURN v_out || jsonb_build_object('view', public.cockpit_form_invite_build_view(p_task_id, v_seat->>'clientName'));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_form_invite_withdraw(p_task_id text, p_invite_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_form_invite_seat(p_task_id);
  v_reason text := nullif(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), '');
  i public.cockpit_form_invites;
BEGIN
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 4 AND 240 THEN
    RAISE EXCEPTION 'Say why you are withdrawing it, in 4 to 240 characters.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cockpit_form_invites_expire();
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = p_invite_id AND x.task_id = p_task_id FOR UPDATE;
  IF i.id IS NULL THEN
    RAISE EXCEPTION 'That form is not on this client.' USING ERRCODE = '22023';
  END IF;
  IF i.state <> 'open' THEN
    RAISE EXCEPTION 'This form is no longer out (%). Reload the client.', i.state USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_source', 'cockpit', true);
  PERFORM public.cockpit_form_invite_close(i.id, 'withdrawn', v_reason, public.cockpit_form_role_words(v_seat), 'cockpit',
    jsonb_build_object('by', 'seat', 'reason', left(v_reason, 240)),
    'Withdrawn in the cockpit: ' || v_reason);
  RETURN public.cockpit_form_invite_build_view(p_task_id, v_seat->>'clientName');
END $$;

-- A copy link (3.6): the only place a raw token leaves the database for a
-- seat, shown once and never stored. A new one revokes the last.
CREATE OR REPLACE FUNCTION public.cockpit_form_invite_link(p_task_id text, p_invite_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_form_invite_seat(p_task_id);
  i public.cockpit_form_invites;
  v_token text;
  v_role text := public.cockpit_form_role_words(v_seat);
BEGIN
  PERFORM public.cockpit_form_invites_expire();
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = p_invite_id AND x.task_id = p_task_id FOR UPDATE;
  IF i.id IS NULL THEN
    RAISE EXCEPTION 'That form is not on this client.' USING ERRCODE = '22023';
  END IF;
  IF i.state <> 'open' THEN
    RAISE EXCEPTION 'This form is no longer out (%), so it has no link. Send a new one.', i.state USING ERRCODE = '22023';
  END IF;
  IF i.origin <> 'canary' AND NOT public.cockpit_form_client_live(i.form_key) THEN
    RAISE EXCEPTION 'This form opens to clients after its switch-on.' USING ERRCODE = '22023';
  END IF;
  -- The pause consent and the exit survey reach the client only in the
  -- portal (admins) or through the approved WhatsApp message: a link a seat
  -- copies could be answered by anyone holding it, and a signed consent from
  -- it would read the same as the client's own.
  IF i.audience = 'admin' OR public.cockpit_form_invite_schema(i)->>'signer' = 'typed' THEN
    RAISE EXCEPTION 'This form goes to the client only in the portal or by the approved WhatsApp message, so it has no link to copy.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_source', 'cockpit', true);
  PERFORM set_config('cockpit.forms_action', 'forms.invite_link_replaced', true);
  UPDATE public.cockpit_form_invite_tokens t SET revoked_at = now(), revoked_reason = 'Replaced by a new link.'
   WHERE t.invite_id = i.id AND t.channel = 'copy' AND t.revoked_at IS NULL;
  PERFORM set_config('cockpit.forms_action', 'forms.invite_link_made', true);
  v_token := public.cockpit_form_token_mint(i.id, 'copy', NULL, v_role);
  IF NOT 'copy' = ANY(i.channels) THEN
    UPDATE public.cockpit_form_invites SET channels = channels || ARRAY['copy'], updated_at = now() WHERE id = i.id;
  END IF;
  PERFORM public.cockpit_form_invite_event(i.id, 'cockpit', 'link_made', NULL, jsonb_build_object('by', v_role));
  PERFORM public.cockpit_form_client_link_out(i.id);
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN jsonb_build_object('url', 'https://portal.maharamedia.com/f#' || v_token, 'expiresAt', i.expires_at);
END $$;

-- Today's rows (3.3): the seat's clients (all for the CEO and an admin). An
-- incomplete roster is an error, never an empty list. Canary invites never show.
CREATE OR REPLACE FUNCTION public.cockpit_form_invites_today()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_form_actor();
  v_all boolean;
  v_allowed text[] := '{}';
  v_denied text[] := '{}';
  v_msg text;
  v_out jsonb := '[]'::jsonb;
  v_remind integer := 7;
  v_today date := public.cockpit_form_kuwait_day(now());
  r record;
BEGIN
  v_all := coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'admin')::boolean, false);
  IF NOT v_all AND NOT coalesce((v_seat->>'csm')::boolean, false) THEN
    RAISE EXCEPTION 'Current confirmed client-success access is required' USING ERRCODE = '42501';
  END IF;
  -- The reminder day comes from the NPS schedule rule once 20261102c makes it.
  IF to_regclass('public.cockpit_form_schedules') IS NOT NULL THEN
    EXECUTE 'SELECT CASE WHEN (s.rule->>''remindAfterDays'') ~ ''^[0-9]{1,3}$'' THEN (s.rule->>''remindAfterDays'')::integer END'
            ' FROM public.cockpit_form_schedules s WHERE s.form_key = ''nps'''
      INTO v_remind;
    v_remind := coalesce(v_remind, 7);
  END IF;
  FOR r IN
    WITH inv AS (
      SELECT i.*, public.cockpit_form_invite_state(i) AS eff,
             coalesce(public.cockpit_form_invite_schema(i)->'title'->>'en', i.form_key) AS title_en,
             (SELECT m.state FROM public.cockpit_client_messages m WHERE m.id = i.message_id) AS msg_state,
             EXISTS (SELECT 1 FROM public.cockpit_form_invite_events e WHERE e.invite_id = i.id AND e.event = 'opened') AS was_opened
        FROM public.cockpit_form_invites i
       WHERE i.origin <> 'canary'
         AND (i.state = 'open' OR i.answered_at > now() - interval '24 hours'
              OR public.cockpit_form_kuwait_day(i.issued_at) = public.cockpit_form_kuwait_day(now()))),
    rows AS (
      SELECT 'sent_today'::text AS kind, x.id AS invite_id, x.task_id, x.client_name, x.form_key, x.title_en AS title,
             x.issued_at AS at, NULL::bigint AS departure_id, NULL::uuid AS message_id
        FROM inv x WHERE public.cockpit_form_kuwait_day(x.issued_at) = v_today
      UNION ALL
      SELECT 'not_answered', x.id, x.task_id, x.client_name, x.form_key, x.title_en, x.issued_at, NULL, x.message_id
        FROM inv x WHERE x.eff = 'open' AND x.issued_at <= now() - make_interval(days => v_remind)
      UNION ALL
      SELECT 'approve_link', x.id, x.task_id, x.client_name, x.form_key, x.title_en, x.issued_at, NULL, x.message_id
        FROM inv x WHERE x.eff = 'open' AND x.msg_state = 'draft'
      UNION ALL
      SELECT 'answered', x.id, x.task_id, x.client_name, x.form_key, x.title_en, x.answered_at, NULL, NULL
        FROM inv x WHERE x.state = 'answered' AND x.answered_at > now() - interval '24 hours'
      UNION ALL
      -- A departure that holds (open or confirmed) whose survey was never sent.
      SELECT 'exit_survey_due', NULL, d.clickup_task_id, coalesce(a.client_name, d.client), 'exit_survey', 'Exit survey',
             coalesce(d.confirmed_at, d.created_at), d.id, NULL
        FROM public.cockpit_churn_departures d
        LEFT JOIN public.cockpit_billing_accounts a ON a.clickup_task_id = d.clickup_task_id
       WHERE d.clickup_task_id IS NOT NULL AND d.removed_at IS NULL AND d.survey_state = 'not_sent'
         AND (public.cockpit_form_departure_of(d.clickup_task_id)->>'id')::bigint = d.id
         AND NOT EXISTS (SELECT 1 FROM public.cockpit_form_invites i
                          WHERE i.task_id = d.clickup_task_id AND i.form_key = 'exit_survey'
                            AND i.state = 'open' AND i.expires_at > now()))
    SELECT * FROM rows ORDER BY at DESC, task_id LIMIT 500
  LOOP
    EXIT WHEN jsonb_array_length(v_out) >= 200;
    IF NOT v_all THEN
      CONTINUE WHEN r.task_id = ANY(v_denied);
      IF NOT (r.task_id = ANY(v_allowed)) THEN
        BEGIN
          PERFORM public.cockpit_csm_client_gate(r.task_id);
          v_allowed := v_allowed || r.task_id;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
          IF v_msg LIKE 'The client roster is incomplete%' THEN
            RAISE;
          END IF;
          v_denied := v_denied || r.task_id;
          CONTINUE;
        END;
      END IF;
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', r.kind, 'inviteId', r.invite_id, 'taskId', r.task_id, 'clientName', r.client_name, 'formKey', r.form_key,
      'title', r.title, 'at', r.at, 'days', greatest(0, v_today - public.cockpit_form_kuwait_day(r.at)),
      'messageId', r.message_id, 'departureId', r.departure_id));
  END LOOP;
  RETURN v_out;
END $$;

-- One stored client answer, in labels (3.3). Gate on its card; never an
-- email; a legacy row shows its raw keys; a canary (shadow) answer only on
-- the test card.
CREATE OR REPLACE FUNCTION public.cockpit_form_answer_read(p_response_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_form_actor();
  r public.cockpit_form_responses;
  f public.cockpit_forms;
  s jsonb;
  fld jsonb;
  v jsonb;
  v_fields jsonb := '[]'::jsonb;
  v_display text;
  v_signer text;
  k text;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = r.form_key;
  IF r.id IS NULL OR f.audience IS DISTINCT FROM 'client' OR r.state NOT IN ('submitted','confirmed','legacy')
     OR (r.mode = 'shadow' AND r.task_id IS DISTINCT FROM '86eywg1cq') THEN
    RAISE EXCEPTION 'There is no client answer with that ID.' USING ERRCODE = '22023';
  END IF;
  IF NOT (coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'admin')::boolean, false)) THEN
    IF r.task_id IS NULL THEN
      RAISE EXCEPTION 'That answer is not matched to a client yet. Pick its card in the churn tracker.' USING ERRCODE = '42501';
    END IF;
    PERFORM public.cockpit_csm_client_gate(r.task_id);
  END IF;
  SELECT v2.schema INTO s FROM public.cockpit_form_versions v2 WHERE v2.form_key = r.form_key AND v2.version = r.form_version;
  IF r.state = 'legacy' OR s->'v' IS DISTINCT FROM '1'::jsonb THEN
    FOR k, v IN SELECT * FROM jsonb_each(r.answers) ORDER BY 1 LOOP
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('key', k, 'label', k, 'value', v,
        'display', CASE WHEN jsonb_typeof(v) = 'string' THEN v #>> '{}' ELSE left(v::text, 2000) END));
    END LOOP;
  ELSE
    FOR fld IN SELECT x FROM jsonb_array_elements(s->'fields') x LOOP
      v := r.answers -> (fld->>'key');
      CONTINUE WHEN v IS NULL;
      v_display := CASE fld->>'type'
        WHEN 'scale' THEN (v #>> '{}') || '/' || (fld->>'max')
        WHEN 'tick' THEN CASE WHEN v = 'true'::jsonb THEN 'Yes' ELSE 'No' END
        WHEN 'choice' THEN coalesce((SELECT o->'label'->>'en' FROM jsonb_array_elements(fld->'options') o
                                      WHERE o->>'value' = v #>> '{}'), v #>> '{}')
        WHEN 'multi' THEN (SELECT string_agg(coalesce((SELECT o->'label'->>'en' FROM jsonb_array_elements(fld->'options') o
                                                        WHERE o->>'value' = e #>> '{}'), e #>> '{}'), ', ' ORDER BY ord)
                             FROM jsonb_array_elements(v) WITH ORDINALITY AS u(e, ord))
        ELSE v #>> '{}' END;
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('key', fld->>'key', 'label', fld->'label'->>'en',
        'value', v, 'display', v_display));
    END LOOP;
  END IF;
  v_signer := CASE
    WHEN r.source = 'portal' THEN CASE WHEN r.answer_meta->>'person_role' = 'admin' THEN 'the client admin' ELSE 'a client member' END
    WHEN r.source = 'public' THEN coalesce(nullif(btrim(r.signer), ''), 'someone with the link')
    ELSE 'the old form' END;
  RETURN jsonb_build_object('responseId', r.id, 'formKey', r.form_key,
    'title', coalesce(s->'title'->>'en', f.title), 'submittedAt', r.submitted_at, 'source', r.source,
    'signer', v_signer, 'lang', r.lang, 'state', r.state, 'taskId', r.task_id, 'fields', v_fields);
END $$;

-- The live client forms, for the client page's Links rows (4.11).
CREATE OR REPLACE FUNCTION public.cockpit_form_client_live_list()
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_form_actor();
  RETURN coalesce((SELECT array_agg(f.key ORDER BY f.key) FROM public.cockpit_forms f
                    WHERE public.cockpit_form_client_live(f.key)), '{}'::text[]);
END $$;

-- ---------------------------------------------------------------------------
-- 9. The portal RPCs (service_role: the portal's business key). p_person is
--    the signed-in client's email; the portal has checked the session. The
--    token twins never see a raw token: the portal hashes it first (3.6).

-- The pop-up pick (3.3, V8): at most one ask or invite pop-up a day per
-- person and workspace (both event tables; checked first, so /api/asks stops
-- here), "Not now" waits 3 days, a phone alert's deep link passes both.
CREATE OR REPLACE FUNCTION public.portal_form_for_person(p_location_id text, p_clickup_id text, p_person text,
  p_access_role text, p_invite_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_person text := public.portal_client_ask_person(p_person);
  i public.cockpit_form_invites;
  v_any boolean := false;
  v_snooze_csat integer;
BEGIN
  PERFORM public.cockpit_form_portal_workspace(p_location_id, p_clickup_id);
  -- "Not now" waits the CSAT rule's snoozeDays (the forms editor sets it,
  -- 1 to 14) once 20261102c makes the schedules; 3 days for every other form.
  IF to_regclass('public.cockpit_form_schedules') IS NOT NULL THEN
    EXECUTE 'SELECT CASE WHEN (s.rule->>''snoozeDays'') ~ ''^[0-9]{1,2}$'' THEN (s.rule->>''snoozeDays'')::integer END'
            ' FROM public.cockpit_form_schedules s WHERE s.form_key = ''csat'''
      INTO v_snooze_csat;
  END IF;
  v_snooze_csat := least(greatest(coalesce(v_snooze_csat, 3), 1), 14);
  IF p_invite_id IS NULL AND (
       EXISTS (SELECT 1 FROM public.cockpit_client_ask_events e JOIN public.cockpit_client_asks x ON x.id = e.ask_id
                WHERE e.source = 'portal' AND e.person = v_person AND e.event = 'shown'
                  AND e.at > now() - interval '20 hours' AND x.location_id = p_location_id)
    OR EXISTS (SELECT 1 FROM public.cockpit_form_invite_events e JOIN public.cockpit_form_invites x ON x.id = e.invite_id
                WHERE e.source = 'portal' AND e.person = v_person AND e.event = 'shown'
                  AND e.at > now() - interval '20 hours' AND x.task_id = p_clickup_id)) THEN
    RETURN jsonb_build_object('invite', NULL, 'reason', 'shown_today');
  END IF;
  FOR i IN SELECT * FROM public.cockpit_form_invites x
            WHERE x.task_id = p_clickup_id AND x.location_id IS NOT DISTINCT FROM p_location_id
              AND (p_invite_id IS NULL OR x.id = p_invite_id)
            ORDER BY x.issued_at, x.id LOOP
    CONTINUE WHEN NOT public.cockpit_form_portal_visible(i, p_access_role);
    v_any := true;
    CONTINUE WHEN p_invite_id IS NULL AND EXISTS (
      SELECT 1 FROM public.cockpit_form_invite_events e
       WHERE e.invite_id = i.id AND e.source = 'portal' AND e.person = v_person AND e.event = 'later'
         AND e.at > now() - make_interval(days => CASE WHEN i.form_key = 'csat' THEN v_snooze_csat ELSE 3 END));
    RETURN jsonb_build_object('invite', public.cockpit_form_portal_invite(i), 'reason', NULL);
  END LOOP;
  RETURN jsonb_build_object('invite', NULL, 'reason', CASE WHEN v_any THEN 'snoozed' ELSE 'nothing_waiting' END);
END $$;

-- The forms page: open invites, and those answered in the last 7 days.
CREATE OR REPLACE FUNCTION public.portal_form_list(p_location_id text, p_clickup_id text, p_person text, p_access_role text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_person text := public.portal_client_ask_person(p_person);
BEGIN
  PERFORM public.cockpit_form_portal_workspace(p_location_id, p_clickup_id);
  RETURN jsonb_build_object('forms', coalesce((
    SELECT jsonb_agg(public.cockpit_form_portal_invite(x)
                     || jsonb_build_object('state', CASE WHEN x.state = 'answered' THEN 'answered' ELSE 'open' END,
                                           'answeredAt', x.answered_at)
                     ORDER BY x.issued_at, x.id)
      FROM public.cockpit_form_invites x
     WHERE x.task_id = p_clickup_id AND x.location_id IS NOT DISTINCT FROM p_location_id AND x.origin <> 'canary'
       AND (public.cockpit_form_portal_visible(x, p_access_role)
            OR (x.state = 'answered' AND x.answered_at > now() - interval '7 days' AND 'portal' = ANY(x.channels)
                AND (x.audience = 'any' OR p_access_role = 'admin')))), '[]'::jsonb));
END $$;

-- One invite with its schema, or why not; records "opened" once a day per person.
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
                          'state', 'open'));
END $$;

-- What a person did with the pop-up: shown, opened, later.
CREATE OR REPLACE FUNCTION public.portal_form_invite_record(p_location_id text, p_clickup_id text, p_invite_id uuid,
  p_person text, p_event text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_person text := public.portal_client_ask_person(p_person); i public.cockpit_form_invites; v_detail jsonb := '{}'::jsonb;
BEGIN
  IF p_event IS NULL OR p_event NOT IN ('shown','opened','later') THEN
    RAISE EXCEPTION 'form_invite_invalid_event' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cockpit_form_portal_workspace(p_location_id, p_clickup_id);
  IF jsonb_typeof(p_detail->'via') = 'string' AND p_detail->>'via' = 'push' THEN v_detail := '{"via":"push"}'::jsonb; END IF;
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = p_invite_id;
  IF i.id IS NULL OR i.task_id <> p_clickup_id OR i.location_id IS DISTINCT FROM p_location_id THEN
    RAISE EXCEPTION 'form_invite_not_in_workspace' USING ERRCODE = '42501';
  END IF;
  IF public.cockpit_form_invite_state(i) <> 'open' THEN
    RETURN jsonb_build_object('ok', true, 'recorded', false);
  END IF;
  -- A page reload is not a second showing; at most 30 events per person and invite.
  IF (p_event IN ('shown','opened') AND EXISTS (
        SELECT 1 FROM public.cockpit_form_invite_events e
         WHERE e.invite_id = i.id AND e.source = 'portal' AND e.person = v_person AND e.event = p_event
           AND e.at > now() - interval '20 hours'))
     OR (SELECT count(*) FROM public.cockpit_form_invite_events e
          WHERE e.invite_id = i.id AND e.source = 'portal' AND e.person = v_person) >= 30 THEN
    RETURN jsonb_build_object('ok', true, 'recorded', false);
  END IF;
  PERFORM set_config('cockpit.audit_source', 'portal', true);
  PERFORM public.cockpit_form_invite_event(i.id, 'portal', p_event, v_person, v_detail);
  RETURN jsonb_build_object('ok', true, 'recorded', true);
END $$;

-- The thank-you line for an answer: the first doneIf that holds, else done.
CREATE OR REPLACE FUNCTION public.cockpit_form_done_text(p_schema jsonb, p_answers jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT d->'text' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_schema->'doneIf') = 'array'
                                                                    THEN p_schema->'doneIf' ELSE '[]'::jsonb END)
                                         WITH ORDINALITY AS u(d, ord)
                    WHERE p_answers -> (d->>'key') = d->'equals' ORDER BY ord LIMIT 1),
                  p_schema->'done')
$$;

-- One stored answer, from either path (3.3). Refusals are reason codes, never
-- a raise for a client's mistake; answers are checked before anything is
-- stored. A canary answer is stored shadow (V29).
CREATE OR REPLACE FUNCTION public.cockpit_form_store_answer(i public.cockpit_form_invites, p_source text, p_external text,
  p_person text, p_role text, p_channel text, p_answers jsonb, p_signer text, p_lang text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s jsonb := public.cockpit_form_invite_schema(i);
  v_check jsonb;
  v_ctx jsonb;
  v_id uuid;
  v_signer text;
  v_meta jsonb;
BEGIN
  v_ctx := i.context || CASE WHEN p_source = 'public' AND s->>'signer' = 'typed'
                             THEN jsonb_build_object('signer', coalesce(p_signer, '')) ELSE '{}'::jsonb END;
  v_check := public.cockpit_form_answers_check(s, p_answers, v_ctx);
  IF NOT (v_check->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'errors', v_check->'errors');
  END IF;
  v_signer := CASE WHEN p_source = 'public' AND s->>'signer' = 'typed'
                   THEN left(btrim(regexp_replace(p_signer, '\s+', ' ', 'g')), 120) END;
  v_meta := jsonb_build_object('invite_id', i.id, 'notice_on', public.cockpit_form_kuwait_day(now()))
            || CASE WHEN p_source = 'portal' THEN jsonb_build_object('person_role', CASE WHEN p_role = 'admin' THEN 'admin' ELSE 'member' END)
                    ELSE jsonb_build_object('channel', p_channel) END
            || CASE WHEN i.origin = 'canary' THEN '{"canary":true}'::jsonb ELSE '{}'::jsonb END;
  PERFORM set_config('cockpit.forms_action', 'forms.client_answer', true);
  PERFORM set_config('cockpit.audit_actor', CASE WHEN p_source = 'portal' THEN 'portal' ELSE 'link' END, true);
  BEGIN
    INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
      answers, answer_meta, hidden, created_by, submitted_by, submitted_at, invite_id, signer, lang)
    VALUES (i.form_key, i.form_version, p_source, p_external, i.task_id, i.client_name,
            CASE WHEN i.origin = 'canary' THEN 'shadow' ELSE 'live' END, 'submitted',
            v_check->'answers', v_meta, '{}'::jsonb, CASE WHEN p_source = 'portal' THEN 'portal' ELSE 'link' END,
            CASE WHEN p_source = 'portal' THEN lower(btrim(p_person)) ELSE 'link' END, now(), i.id, v_signer,
            CASE WHEN p_lang IN ('ar','en') THEN p_lang END)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'answered');
  END;
  PERFORM set_config('cockpit.forms_action', '', true);
  PERFORM public.cockpit_form_client_submitted(v_id);
  RETURN jsonb_build_object('ok', true, 'responseId', v_id, 'done', public.cockpit_form_done_text(s, v_check->'answers'));
END $$;

CREATE OR REPLACE FUNCTION public.portal_form_submit(p_location_id text, p_clickup_id text, p_person text, p_access_role text,
  p_invite_id uuid, p_answers jsonb, p_request_id uuid, p_lang text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_person text := public.portal_client_ask_person(p_person);
  i public.cockpit_form_invites;
  r public.cockpit_form_responses;
  v_state text;
BEGIN
  PERFORM public.cockpit_form_portal_workspace(p_location_id, p_clickup_id);
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'form_invite_invalid_request' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cockpit_form_invites_expire();
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = p_invite_id FOR UPDATE;
  IF i.id IS NULL OR i.task_id <> p_clickup_id OR i.location_id IS DISTINCT FROM p_location_id OR i.origin = 'canary' THEN
    RAISE EXCEPTION 'form_invite_not_in_workspace' USING ERRCODE = '42501';
  END IF;
  -- A retry of the same request returns the first answer.
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.form_key = i.form_key AND x.external_id = 'portal:' || p_request_id::text;
  IF r.id IS NOT NULL THEN
    IF r.invite_id IS DISTINCT FROM i.id THEN
      RAISE EXCEPTION 'form_invite_invalid_request' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('ok', true, 'responseId', r.id,
      'done', public.cockpit_form_done_text(public.cockpit_form_invite_schema(i), r.answers));
  END IF;
  v_state := public.cockpit_form_invite_state(i);
  IF v_state <> 'open' THEN RETURN jsonb_build_object('ok', false, 'reason', v_state); END IF;
  IF public.cockpit_form_card_allows(i.task_id, i.form_key) IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'withdrawn');
  END IF;
  IF NOT public.cockpit_form_client_live(i.form_key) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_live'); END IF;
  IF i.audience = 'admin' AND p_access_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'admin_only');
  END IF;
  PERFORM set_config('cockpit.audit_source', 'portal', true);
  RETURN public.cockpit_form_store_answer(i, 'portal', 'portal:' || p_request_id::text, v_person, p_access_role, NULL,
                                          p_answers, NULL, p_lang);
END $$;

-- The link page's rate limits (3.6): per browser 30 tries a minute, per
-- network 120 a minute, and 10 unknown tokens in 10 minutes per browser on a
-- network (50 for the whole network, so one shared mobile address with a few
-- stale links does not lock out every client behind it). False when within.
CREATE OR REPLACE FUNCTION public.cockpit_form_token_limited(p_net text, p_browser text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN (p_browser IS NOT NULL AND (SELECT count(*) FROM public.cockpit_form_token_opens o
                                      WHERE o.browser_hash = p_browser AND o.at > now() - interval '1 minute') >= 30)
      OR (SELECT count(*) FROM public.cockpit_form_token_opens o
           WHERE o.net_hash = p_net AND o.at > now() - interval '1 minute') >= 120
      OR (SELECT count(*) FROM public.cockpit_form_token_opens o
           WHERE o.net_hash = p_net AND o.browser_hash IS NOT DISTINCT FROM p_browser AND o.outcome = 'unknown'
             AND o.at > now() - interval '10 minutes') >= 10
      OR (SELECT count(*) FROM public.cockpit_form_token_opens o
           WHERE o.net_hash = p_net AND o.outcome = 'unknown' AND o.at > now() - interval '10 minutes') >= 50;
END $$;

-- A limited caller leaves one row a minute per network, not one per request,
-- so a flood cannot fill the table (the limits count the rows already there).
CREATE OR REPLACE FUNCTION public.cockpit_form_token_limited_note(p_net text, p_browser text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_form_token_opens o
                  WHERE o.net_hash = p_net AND o.outcome = 'limited' AND o.at > now() - interval '1 minute') THEN
    INSERT INTO public.cockpit_form_token_opens(net_hash, browser_hash, outcome) VALUES (p_net, p_browser, 'limited');
  END IF;
END $$;

-- What a token opens now: the invite and the outcome code of 3.3.
CREATE OR REPLACE FUNCTION public.cockpit_form_token_find(p_token_sha256 text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.cockpit_form_invite_tokens; i public.cockpit_form_invites; v_state text;
BEGIN
  SELECT * INTO t FROM public.cockpit_form_invite_tokens x WHERE x.token_sha256 = p_token_sha256;
  IF t.id IS NULL THEN RETURN jsonb_build_object('reason', 'unknown'); END IF;
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = t.invite_id;
  v_state := public.cockpit_form_invite_state(i);
  IF v_state <> 'open' THEN RETURN jsonb_build_object('reason', v_state, 'tokenId', t.id, 'inviteId', i.id); END IF;
  -- A copy link replaced by a newer one opens nothing.
  IF t.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('reason', 'unknown', 'tokenId', t.id); END IF;
  -- A card that stopped qualifying (2.3) is refused at once, before the sweep withdraws it.
  IF public.cockpit_form_card_allows(i.task_id, i.form_key) IS NOT NULL THEN
    RETURN jsonb_build_object('reason', 'withdrawn', 'tokenId', t.id, 'inviteId', i.id);
  END IF;
  IF i.origin <> 'canary' AND NOT public.cockpit_form_client_live(i.form_key) THEN
    RETURN jsonb_build_object('reason', 'not_live', 'tokenId', t.id, 'inviteId', i.id);
  END IF;
  RETURN jsonb_build_object('reason', NULL, 'tokenId', t.id, 'inviteId', i.id, 'channel', t.channel);
END $$;

CREATE OR REPLACE FUNCTION public.portal_form_token_open(p_token_sha256 text, p_net text, p_browser text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb; i public.cockpit_form_invites; v_reason text;
BEGIN
  IF p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$' OR p_net IS NULL OR p_net !~ '^[0-9a-f]{64}$'
     OR (p_browser IS NOT NULL AND p_browser !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'form_token_invalid' USING ERRCODE = '22023';
  END IF;
  IF public.cockpit_form_token_limited(p_net, p_browser) THEN
    PERFORM public.cockpit_form_token_limited_note(p_net, p_browser);
    RETURN jsonb_build_object('ok', false, 'reason', 'limited');
  END IF;
  PERFORM public.cockpit_form_invites_expire();
  v := public.cockpit_form_token_find(p_token_sha256);
  v_reason := v->>'reason';
  INSERT INTO public.cockpit_form_token_opens(net_hash, browser_hash, outcome, token_id)
  VALUES (p_net, p_browser, CASE WHEN v_reason IS NULL THEN 'ok' WHEN v_reason = 'answered' THEN 'used' ELSE v_reason END,
          (v->>'tokenId')::bigint);
  IF v_reason IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = (v->>'inviteId')::uuid;
  UPDATE public.cockpit_form_invite_tokens SET opens = opens + 1, last_opened_at = now() WHERE id = (v->>'tokenId')::bigint;
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_form_invite_events e
                  WHERE e.invite_id = i.id AND e.source = 'token' AND e.event = 'opened' AND e.at > now() - interval '20 hours') THEN
    PERFORM set_config('cockpit.audit_source', 'portal', true);
    PERFORM public.cockpit_form_invite_event(i.id, 'token', 'opened', NULL, jsonb_build_object('channel', v->>'channel'));
  END IF;
  RETURN jsonb_build_object('ok', true, 'invite', public.cockpit_form_portal_invite(i)
    || jsonb_build_object('schema', public.cockpit_form_invite_schema(i), 'context', public.cockpit_form_client_context(i),
                          'clientName', i.client_name,
                          'signer', public.cockpit_form_invite_schema(i)->>'signer'));
END $$;

CREATE OR REPLACE FUNCTION public.portal_form_token_submit(p_token_sha256 text, p_net text, p_browser text, p_answers jsonb,
  p_signer text, p_request_id uuid, p_lang text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb; i public.cockpit_form_invites; r public.cockpit_form_responses; v_reason text; v_out jsonb;
BEGIN
  IF p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$' OR p_net IS NULL OR p_net !~ '^[0-9a-f]{64}$'
     OR (p_browser IS NOT NULL AND p_browser !~ '^[0-9a-f]{64}$') OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'form_token_invalid' USING ERRCODE = '22023';
  END IF;
  IF public.cockpit_form_token_limited(p_net, p_browser) THEN
    PERFORM public.cockpit_form_token_limited_note(p_net, p_browser);
    RETURN jsonb_build_object('ok', false, 'reason', 'limited');
  END IF;
  PERFORM public.cockpit_form_invites_expire();
  v := public.cockpit_form_token_find(p_token_sha256);
  v_reason := v->>'reason';
  IF v->>'inviteId' IS NOT NULL THEN
    SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = (v->>'inviteId')::uuid FOR UPDATE;
    -- A retry of the same request returns the first answer.
    SELECT * INTO r FROM public.cockpit_form_responses x
     WHERE x.form_key = i.form_key AND x.external_id = 'token:' || p_request_id::text AND x.invite_id = i.id;
    IF r.id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'responseId', r.id,
        'done', public.cockpit_form_done_text(public.cockpit_form_invite_schema(i), r.answers));
    END IF;
  END IF;
  IF v_reason IS NOT NULL THEN
    INSERT INTO public.cockpit_form_token_opens(net_hash, browser_hash, outcome, token_id)
    VALUES (p_net, p_browser, CASE WHEN v_reason = 'answered' THEN 'used' ELSE v_reason END, (v->>'tokenId')::bigint);
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;
  PERFORM set_config('cockpit.audit_source', 'portal', true);
  v_out := public.cockpit_form_store_answer(i, 'public', 'token:' || p_request_id::text, NULL, NULL, v->>'channel',
                                            p_answers, p_signer, p_lang);
  INSERT INTO public.cockpit_form_token_opens(net_hash, browser_hash, outcome, token_id)
  VALUES (p_net, p_browser, CASE WHEN (v_out->>'ok')::boolean THEN 'submitted' ELSE 'refused' END, (v->>'tokenId')::bigint);
  RETURN v_out;
END $$;

-- A staff preview (3.7): the published schema, or the editor's draft once
-- 20261102d makes drafts, with a fixed sample context. Nothing is recorded.
CREATE OR REPLACE FUNCTION public.portal_form_preview(p_form_key text, p_draft boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.cockpit_forms; v_schema jsonb; v_today date := public.cockpit_form_kuwait_day(now());
BEGIN
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = p_form_key AND x.audience = 'client';
  IF f.key IS NULL THEN
    RAISE EXCEPTION 'form_preview_unknown' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_draft, false) AND to_regclass('public.cockpit_form_schema_drafts') IS NOT NULL THEN
    EXECUTE 'SELECT d.schema FROM public.cockpit_form_schema_drafts d WHERE d.form_key = $1' INTO v_schema USING p_form_key;
  END IF;
  IF v_schema IS NULL THEN
    SELECT v.schema INTO v_schema FROM public.cockpit_form_versions v
     WHERE v.form_key = p_form_key AND v.version = public.cockpit_form_client_version(p_form_key);
  END IF;
  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'form_preview_unknown' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('schema', v_schema, 'draft', coalesce(p_draft, false), 'context', CASE p_form_key
    WHEN 'pause_consent' THEN jsonb_build_object('start', v_today, 'restart', v_today + 14, 'reasonCat', 'client_asked', 'over14', false)
    WHEN 'nps' THEN '{"round":1}'::jsonb
    WHEN 'csat' THEN '{"try":1}'::jsonb
    ELSE '{}'::jsonb END);
END $$;

-- Phone alerts (the asks' pattern): the portal's client-tasks cron claims
-- invites still waiting for one (a five-minute lease), sends and reports
-- back. An alert not sent within a day is never sent.
CREATE OR REPLACE FUNCTION public.portal_form_invites_push_claim(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'form_invite_invalid_limit' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cockpit_form_invites_expire();
  PERFORM set_config('cockpit.audit_source', 'portal', true);
  UPDATE public.cockpit_form_invites
     SET push_state = 'failed', push_result = jsonb_build_object('reason', 'not_sent_within_a_day'), push_at = now(), updated_at = now()
   WHERE push_state IN ('waiting','sending') AND issued_at <= now() - interval '1 day';
  UPDATE public.cockpit_form_invites
     SET push_state = 'off', push_result = jsonb_build_object('reason', 'invite_closed_first'), push_at = now(), updated_at = now()
   WHERE push_state IN ('waiting','sending') AND (state <> 'open' OR location_id IS NULL);
  WITH due AS (
    SELECT x.id FROM public.cockpit_form_invites x
     WHERE x.state = 'open' AND x.expires_at > now() AND x.location_id IS NOT NULL
       AND (x.push_state = 'waiting' OR (x.push_state = 'sending' AND x.push_claim_until < now()))
       AND public.cockpit_form_client_live(x.form_key)
     ORDER BY x.issued_at LIMIT p_limit FOR UPDATE SKIP LOCKED),
  claimed AS (
    UPDATE public.cockpit_form_invites x SET push_state = 'sending', push_claim_until = now() + interval '5 minutes', updated_at = now()
      FROM due WHERE x.id = due.id
    RETURNING x.*)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'locationId', c.location_id, 'clickupId', c.task_id, 'formKey', c.form_key,
           'audience', c.audience, 'lang', c.lang,
           'title', (SELECT v2.schema->'title' FROM public.cockpit_form_versions v2 WHERE v2.form_key = c.form_key AND v2.version = c.form_version),
           'push', (SELECT v2.schema->'invite'->'push' FROM public.cockpit_form_versions v2 WHERE v2.form_key = c.form_key AND v2.version = c.form_version),
           'issuedAt', c.issued_at) ORDER BY c.issued_at), '[]'::jsonb)
    INTO v FROM claimed c;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.portal_form_invite_push_done(p_invite_id uuid, p_location_id text, p_state text, p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.cockpit_form_invites; v_result jsonb := '{}'::jsonb; k text;
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('sent','no_device','failed') THEN
    RAISE EXCEPTION 'form_invite_invalid_push_state' USING ERRCODE = '22023';
  END IF;
  -- Counts and one reason only: no device, address or person leaves the portal.
  FOREACH k IN ARRAY ARRAY['devices','accepted','failed','uncertain','expired'] LOOP
    IF jsonb_typeof(p_result->k) = 'number' THEN
      v_result := v_result || jsonb_build_object(k, least(greatest(round((p_result->>k)::numeric)::integer, 0), 1000));
    END IF;
  END LOOP;
  IF jsonb_typeof(p_result->'reason') = 'string' AND p_result->>'reason' ~ '^[a-z_]{1,40}$' THEN
    v_result := v_result || jsonb_build_object('reason', p_result->>'reason');
  END IF;
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = p_invite_id FOR UPDATE;
  IF i.id IS NULL OR i.location_id IS DISTINCT FROM p_location_id THEN
    RAISE EXCEPTION 'form_invite_not_in_workspace' USING ERRCODE = '42501';
  END IF;
  IF i.push_state <> 'sending' THEN
    RETURN jsonb_build_object('ok', true, 'pushState', i.push_state, 'recorded', false);
  END IF;
  PERFORM set_config('cockpit.audit_source', 'portal', true);
  UPDATE public.cockpit_form_invites
     SET push_state = p_state, push_result = v_result, push_at = now(), push_claim_until = NULL, updated_at = now()
   WHERE id = i.id;
  PERFORM public.cockpit_form_invite_event(i.id, 'push', 'link_sent', NULL, v_result || jsonb_build_object('state', p_state, 'via', 'push'));
  RETURN jsonb_build_object('ok', true, 'pushState', p_state, 'recorded', true);
END $$;

-- Whether a phone alert may still show its text: the invite is open in that
-- workspace, visible to the person's role (the portal passes the device's
-- current grant: admin or member) and not answered.
CREATE OR REPLACE FUNCTION public.portal_form_invite_display(p_location_id text, p_clickup_id text, p_invite_id uuid, p_person text,
  p_access_role text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.cockpit_form_invites;
BEGIN
  PERFORM public.portal_client_ask_person(p_person);
  IF p_access_role IS NULL OR p_access_role NOT IN ('admin','member') THEN
    RETURN false;
  END IF;
  SELECT * INTO i FROM public.cockpit_form_invites x
   WHERE x.id = p_invite_id AND x.location_id = p_location_id AND x.task_id = p_clickup_id;
  RETURN i.id IS NOT NULL AND public.cockpit_form_portal_visible(i, p_access_role);
END $$;

-- The portal's sessions as counts per workspace (V12), refused while
-- forms.client.presence is off. A workspace the portal no longer lists is
-- left as it was.
CREATE OR REPLACE FUNCTION public.portal_form_presence_put(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e jsonb; n integer := 0; v_at timestamptz;
BEGIN
  IF NOT (public.cockpit_form_client_settings()->>'presence')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'off');
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 200 THEN
    RAISE EXCEPTION 'form_presence_invalid' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_rows) x LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR coalesce(e->>'locationId', '') !~ '^[A-Za-z0-9_-]{1,100}$'
       OR jsonb_typeof(e->'admins') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'members') IS DISTINCT FROM 'number'
       OR (e->>'admins') !~ '^[0-9]{1,4}$' OR (e->>'members') !~ '^[0-9]{1,4}$'
       OR (e ? 'lastSessionAt' AND e->'lastSessionAt' <> 'null'::jsonb AND jsonb_typeof(e->'lastSessionAt') <> 'string') THEN
      RAISE EXCEPTION 'form_presence_invalid' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_at := CASE WHEN jsonb_typeof(e->'lastSessionAt') = 'string' THEN (e->>'lastSessionAt')::timestamptz END;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'form_presence_invalid' USING ERRCODE = '22023';
    END;
    INSERT INTO public.cockpit_portal_presence(location_id, last_session_at, admins, members, pushed_at)
    VALUES (e->>'locationId', v_at, (e->>'admins')::integer, (e->>'members')::integer, now())
    ON CONFLICT (location_id) DO UPDATE
      SET last_session_at = EXCLUDED.last_session_at, admins = EXCLUDED.admins, members = EXCLUDED.members, pushed_at = now();
    n := n + 1;
  END LOOP;
  INSERT INTO public.cockpit_sync_state(key, last_run_at, ok, note, updated_at)
  VALUES ('portal-presence', now(), true, format('The portal reported %s workspaces.', n), now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = now(), ok = true, note = EXCLUDED.note, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'rows', n);
END $$;

-- ---------------------------------------------------------------------------
-- 10. The worker's link mint (service_role) and the owner's doors

-- Right after cockpit_client_message_intent answered ok for a claimed
-- form_invite message (4.1.6): mint the WhatsApp token for this message,
-- once (unique message_id), and hand back the URL. The URL is not stored and
-- the event holds no token.
CREATE OR REPLACE FUNCTION public.cockpit_client_message_invite_link(p_id uuid, p_claim uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.cockpit_client_messages; i public.cockpit_form_invites; v_token text;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  SELECT * INTO m FROM public.cockpit_client_messages x WHERE x.id = p_id FOR UPDATE;
  IF m.id IS NULL OR m.kind <> 'form_invite' OR m.state <> 'sending' OR p_claim IS NULL OR m.claim_token IS DISTINCT FROM p_claim THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_held');
  END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_form_invite_tokens t WHERE t.message_id = m.id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_made');
  END IF;
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = m.invite_id FOR UPDATE;
  IF i.id IS NULL OR public.cockpit_form_invite_state(i) <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'closed');
  END IF;
  PERFORM set_config('cockpit.audit_source', 'client-messages', true);
  PERFORM set_config('cockpit.forms_action', 'forms.invite_link_sent', true);
  BEGIN
    v_token := public.cockpit_form_token_mint(i.id, 'whatsapp', m.id, 'the cockpit');
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_made');
  END;
  PERFORM public.cockpit_form_invite_event(i.id, 'worker', 'link_sent', NULL, jsonb_build_object('messageId', m.id));
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN jsonb_build_object('ok', true, 'url', 'https://portal.maharamedia.com/f#' || v_token);
END $$;

-- A form_invite message moved to sent (the worker's sent, a reconcile or
-- read-back, or a person's fix of an unknown send): the link has left, so
-- the form's link hook runs (NPS Survey Sent). A failed, refused or skipped
-- message never gets here. link_out catches a hook's raise, so the send's
-- own write never depends on a card field.
CREATE OR REPLACE FUNCTION public.cockpit_form_invite_message_sent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.kind = 'form_invite' AND NEW.invite_id IS NOT NULL AND NEW.state = 'sent'
     AND OLD.state IS DISTINCT FROM 'sent' THEN
    PERFORM public.cockpit_form_client_link_out(NEW.invite_id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS cockpit_form_invite_message_sent ON public.cockpit_client_messages;
CREATE TRIGGER cockpit_form_invite_message_sent AFTER UPDATE OF state ON public.cockpit_client_messages
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_invite_message_sent();

-- The only switch for clients to see a form (1.4, V5), owner only (deploy).
-- On: the newest v1 version must pass the schema check and the text rule;
-- the exit survey's registry moves typeform to native with that version in
-- the same statement, keeping its typeform_id (V16). Off: every open invite
-- of the form is withdrawn.
CREATE OR REPLACE FUNCTION public.cockpit_form_client_go_live(p_form_key text, p_on boolean, p_actor text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.cockpit_forms;
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_ver integer;
  v_schema jsonb;
  v_problem text;
  v_live jsonb;
  v_n integer := 0;
  r record;
BEGIN
  IF v_actor IS NULL OR char_length(v_actor) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'Say who turns the form on or off.' USING ERRCODE = '22023';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'Say on or off.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = p_form_key FOR UPDATE;
  IF f.key IS NULL OR f.audience <> 'client' THEN
    RAISE EXCEPTION 'Only a client form goes live here.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_actor', v_actor, true);
  PERFORM set_config('cockpit.audit_source', 'deploy', true);
  v_live := public.cockpit_form_client_settings()->'live';
  IF p_on THEN
    v_ver := public.cockpit_form_client_version(p_form_key);
    IF v_ver IS NULL THEN
      RAISE EXCEPTION 'The % form has no client version to go live with.', p_form_key USING ERRCODE = '22023';
    END IF;
    SELECT v.schema INTO v_schema FROM public.cockpit_form_versions v WHERE v.form_key = p_form_key AND v.version = v_ver;
    v_problem := coalesce(public.cockpit_form_schema_check(v_schema), public.cockpit_form_schema_text_problem(v_schema));
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION 'Version % cannot go live: %', v_ver, v_problem USING ERRCODE = '22023';
    END IF;
    IF f.provider = 'typeform' AND p_form_key = 'exit_survey' THEN
      PERFORM set_config('cockpit.forms_action', 'forms.registry_native', true);
      UPDATE public.cockpit_forms SET provider = 'native', schema = v_schema, version = v_ver,
             updated_by = v_actor, updated_at = now()
       WHERE key = p_form_key;
    ELSIF f.provider <> 'native' THEN
      RAISE EXCEPTION 'Only a native client form goes live.' USING ERRCODE = '22023';
    END IF;
    IF NOT v_live ? p_form_key THEN
      v_live := v_live || to_jsonb(p_form_key);
    END IF;
  ELSE
    SELECT coalesce(jsonb_agg(e ORDER BY ord), '[]'::jsonb) INTO v_live
      FROM jsonb_array_elements(v_live) WITH ORDINALITY AS u(e, ord) WHERE e #>> '{}' IS DISTINCT FROM p_form_key;
    FOR r IN SELECT x.id FROM public.cockpit_form_invites x
              WHERE x.form_key = p_form_key AND x.state = 'open' ORDER BY x.issued_at FOR UPDATE LOOP
      IF public.cockpit_form_invite_close(r.id, 'withdrawn', 'Form switched off', 'the cockpit', 'cockpit',
           jsonb_build_object('by', 'switch'), 'Withdrawn: the form was switched off.') THEN
        v_n := v_n + 1;
      END IF;
    END LOOP;
  END IF;
  INSERT INTO public.cockpit_settings(key, value, updated_by)
  VALUES ('forms.client', jsonb_build_object('live', v_live, 'presence', false), v_actor)
  ON CONFLICT (key) DO UPDATE SET value = public.cockpit_settings.value || jsonb_build_object('live', v_live),
    updated_by = v_actor, updated_at = now()
  WHERE public.cockpit_settings.value->'live' IS DISTINCT FROM v_live;
  INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('forms.client_go_live', 'cockpit_forms', p_form_key, v_actor, 'client-success', 'deploy',
          jsonb_build_object('provider', f.provider, 'version', f.version),
          jsonb_build_object('live', p_on, 'version', coalesce(v_ver, f.version)),
          jsonb_build_object('op', CASE WHEN p_on THEN 'on' ELSE 'off' END, 'withdrawn', v_n));
  PERFORM set_config('cockpit.forms_action', '', true);
  RETURN jsonb_build_object('formKey', p_form_key, 'live', public.cockpit_form_client_live(p_form_key),
                            'version', coalesce(v_ver, f.version), 'withdrawn', v_n);
END $$;

-- The schedule's issuer (3.10): every rule of issue but the seat gate; NULL
-- on a refusal, whose sentence is left in the transaction-local setting
-- cockpit.form_issue_refusal for the run's report.
CREATE OR REPLACE FUNCTION public.cockpit_form_invite_issue_system(p_task_id text, p_form_key text, p_channels text[],
  p_context jsonb, p_origin text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid := gen_random_uuid(); v_msg text;
BEGIN
  PERFORM set_config('cockpit.form_issue_refusal', '', true);
  IF p_origin IS DISTINCT FROM 'schedule' THEN
    PERFORM set_config('cockpit.form_issue_refusal', 'The cockpit issues with origin schedule only.', true);
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM set_config('cockpit.audit_source', 'schedule', true);
    PERFORM public.cockpit_form_invite_issue_core(p_task_id, p_form_key, p_channels, NULL, 'ar', true, coalesce(p_context, '{}'::jsonb),
      v_id, 'schedule', jsonb_build_object('id', NULL, 'email', NULL, 'role', 'the cockpit', 'source', 'schedule'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    PERFORM set_config('cockpit.form_issue_refusal', left(coalesce(v_msg, 'Refused.'), 240), true);
    RETURN NULL;
  END;
  RETURN v_id;
END $$;

-- The canary door (3.10), owner only: the test card 86eywg1cq only, whatever
-- the live list says; a copy link shown once, and a WhatsApp draft on the
-- test card when asked. Its answer is stored shadow; its notices are muted.
CREATE OR REPLACE FUNCTION public.cockpit_form_invite_canary(p_form_key text, p_context jsonb, p_channels text[] DEFAULT '{copy}')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid := gen_random_uuid(); v jsonb; v_token text;
BEGIN
  PERFORM set_config('cockpit.audit_actor', 'canary', true);
  PERFORM set_config('cockpit.audit_source', 'deploy', true);
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

-- ---------------------------------------------------------------------------
-- 11. Seeds: the six notice settings (3.4), the client switch, the door
--     marker, and the registry rows nps, csat and portal_feedback with their
--     version 1 (3.1; the copy of 5.7, 5.8 and the portal's own Share
--     feedback words). Not live: nothing reaches a client until go-live.

DO $$
DECLARE s record;
BEGIN
  FOR s IN
    INSERT INTO public.cockpit_slack_notice_settings (kind, enabled, channel, mention_rule, updated_by) VALUES
      ('pause.consent', true, 'C09RZ0GS0V9', ARRAY['seat:csm']::text[], 'migration'),
      -- Fail closed ("Not posted: the bot is not in #nps-survey-feedback") until the CEO invites the bot (Q4).
      ('nps.received', true, 'C09TTGBRQ0G', '{}'::text[], 'migration'),
      ('csat.received', true, 'C09TTGBRQ0G', '{}'::text[], 'migration'),
      ('voice.low', true, 'C09RZ0GS0V9', ARRAY['seat:csm']::text[], 'migration'),
      ('feedback.received', true, 'C09RZ0GS0V9', ARRAY['seat:csm']::text[], 'migration'),
      ('legacy.received', true, 'C09RZ0GS0V9', '{}'::text[], 'migration')
    ON CONFLICT (kind) DO NOTHING
    RETURNING kind, enabled, channel
  LOOP
    INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('notices.setting_seeded', 'cockpit_slack_notice_settings', s.kind, 'migration', 'client-success', 'supabase', NULL,
            jsonb_build_object('kind', s.kind, 'enabled', s.enabled, 'channel', s.channel), jsonb_build_object('op', 'insert'));
  END LOOP;
END $$;

SELECT set_config('cockpit.audit_actor', 'migration 20261102a', true);
INSERT INTO public.cockpit_settings (key, value, updated_by)
VALUES ('forms.client', '{"live":[],"presence":false}'::jsonb, 'migration 20261102a')
ON CONFLICT (key) DO NOTHING;
-- A merge, never an overwrite; a second apply touches nothing.
INSERT INTO public.cockpit_settings (key, value, updated_by)
VALUES ('forms.doors', '{"invites":true}'::jsonb, 'migration 20261102a')
ON CONFLICT (key) DO UPDATE SET value = public.cockpit_settings.value || '{"invites":true}'::jsonb,
  updated_by = 'migration 20261102a', updated_at = now()
WHERE NOT (public.cockpit_settings.value @> '{"invites":true}'::jsonb);
SELECT set_config('cockpit.audit_actor', '', true);

DO $$
DECLARE
  v_nps jsonb := $json${
    "v": 1, "key": "nps",
    "title": {"en": "How are we doing?", "ar": "شلون شغلنا معاك؟"},
    "intro": {"en": "One minute. Your account manager reads every answer.", "ar": "دقيقة وحدة بس. مدير حسابك يقرا كل رد."},
    "minutes": 1, "audience": "any", "signer": "none", "context": [],
    "fields": [
      {"key": "recommend", "type": "scale", "required": true, "min": 0, "max": 10,
       "label": {"en": "How likely are you to recommend Mahara to a friend or another business owner?", "ar": "شكثر ممكن تنصح فينا ربعك أو صاحب شركة ثاني؟"},
       "lowLabel": {"en": "Not at all likely", "ar": "أبد"}, "highLabel": {"en": "Extremely likely", "ar": "أكيد"}},
      {"key": "results", "type": "scale", "required": false, "min": 0, "max": 10,
       "label": {"en": "How happy are you with the results so far?", "ar": "شكثر راضي عن النتائج لين الحين؟"},
       "lowLabel": {"en": "Not happy", "ar": "مو راضي"}, "highLabel": {"en": "Very happy", "ar": "راضي وايد"}},
      {"key": "communication", "type": "scale", "required": false, "min": 1, "max": 10,
       "label": {"en": "How is communication with your Mahara team?", "ar": "شلون التواصل مع فريق مهارة؟"},
       "lowLabel": {"en": "Poor", "ar": "ضعيف"}, "highLabel": {"en": "Excellent", "ar": "ممتاز"}},
      {"key": "startStop", "type": "longtext", "required": false, "maxLength": 2000,
       "label": {"en": "What should we start or stop doing?", "ar": "شنو تبينا نبدي فيه أو نوقفه؟"}}
    ],
    "reads": {"low_score": ["recommend"], "nps_notice": ["recommend", "results"]},
    "submit": {"en": "Send", "ar": "أرسل"},
    "done": {"en": "Thanks. Your account manager reads every answer.", "ar": "مشكور. مدير حسابك يقرا كل رد."},
    "invite": {
      "whatsapp": {"en": "Hi {client} team, a quick question from Mahara: how likely are you to recommend us? It takes a minute: {form_link}",
                   "ar": "هلا فريق {client}، عندنا سؤال سريع من مهارة: شكثر ممكن تنصحون فينا؟ ما ياخذ إلا دقيقة: {form_link}"},
      "push": {"en": "A one-minute question from your Mahara team. Tap to answer.", "ar": "سؤال من فريق مهارة ياخذ دقيقة. اضغط وجاوب."}}
  }$json$;
  v_csat jsonb := $json${
    "v": 1, "key": "csat",
    "title": {"en": "How was getting started?", "ar": "شلون كانت البداية معانا؟"},
    "intro": {"en": "Your campaign is live. Tell us how the first steps felt.", "ar": "حملتك اشتغلت. قول لنا شلون كانت أول الخطوات."},
    "minutes": 1, "audience": "any", "signer": "none", "context": [],
    "fields": [
      {"key": "onboarding", "type": "scale", "required": true, "min": 1, "max": 10,
       "label": {"en": "How would you rate getting started with Mahara?", "ar": "من ١ لين ١٠، شكثر تعطي البداية معانا؟"},
       "lowLabel": {"en": "Poor", "ar": "ضعيف"}, "highLabel": {"en": "Excellent", "ar": "ممتاز"}},
      {"key": "liked", "type": "longtext", "required": false, "maxLength": 2000,
       "label": {"en": "What did you like?", "ar": "شنو عجبك؟"}},
      {"key": "disliked", "type": "longtext", "required": false, "maxLength": 2000,
       "label": {"en": "What could we have done better?", "ar": "شنو كان ممكن نسويه أحسن؟"}}
    ],
    "reads": {"low_score": ["onboarding"], "csat_notice": ["onboarding"]},
    "submit": {"en": "Send", "ar": "أرسل"},
    "done": {"en": "Thank you. This helps the next client too.", "ar": "مشكور. هذا يساعدنا مع العميل الياي بعد."},
    "invite": {
      "whatsapp": {"en": "Hi {client} team, now that your campaign is live, how was getting started with us? Tell us in a minute: {form_link}",
                   "ar": "هلا فريق {client}، الحين حملتكم اشتغلت. شلون كانت البداية معانا؟ قولوا لنا بدقيقة: {form_link}"},
      "push": {"en": "How was getting started? Tell your Mahara team in a minute.", "ar": "شلون كانت البداية؟ قول لفريق مهارة بدقيقة."}}
  }$json$;
  -- The portal's own Share feedback words (MaharaFeedback, mahara-feedback-policy.ts): no invite path (5.9).
  v_feedback jsonb := $json${
    "v": 1, "key": "portal_feedback",
    "title": {"en": "Share feedback", "ar": "شاركنا رأيك"},
    "intro": null,
    "minutes": 2, "audience": "any", "signer": "none", "context": [],
    "fields": [
      {"key": "kind", "type": "choice", "required": true,
       "label": {"en": "What’s on your mind?", "ar": "ماذا في بالك؟"},
       "options": [
         {"value": "idea", "label": {"en": "New idea", "ar": "فكرة جديدة"}},
         {"value": "improvement", "label": {"en": "Make it better", "ar": "اقتراح للتحسين"}},
         {"value": "problem", "label": {"en": "Something’s not right", "ar": "شيء يحتاج إصلاحاً"}},
         {"value": "appreciation", "label": {"en": "Something I love", "ar": "شيء أعجبني"}}]},
      {"key": "topic", "type": "choice", "required": true,
       "label": {"en": "This is about", "ar": "بخصوص"},
       "options": [
         {"value": "service", "label": {"en": "Mahara service", "ar": "خدمة مهارة"}},
         {"value": "portal", "label": {"en": "The portal", "ar": "المنصة"}},
         {"value": "communication", "label": {"en": "Communication", "ar": "التواصل"}},
         {"value": "results", "label": {"en": "Results", "ar": "النتائج"}},
         {"value": "onboarding", "label": {"en": "Getting started", "ar": "البداية معنا"}},
         {"value": "other", "label": {"en": "Something else", "ar": "شيء آخر"}}]},
      {"key": "message", "type": "longtext", "required": true, "maxLength": 2000,
       "label": {"en": "What would make things better for you?", "ar": "ما الذي نقدر نحسّنه لك؟"}},
      {"key": "rating", "type": "scale", "required": false, "min": 1, "max": 5,
       "label": {"en": "Overall experience", "ar": "تجربتك بشكل عام"},
       "lowLabel": {"en": "frustrating", "ar": "سيئة"}, "highLabel": {"en": "wonderful", "ar": "ممتازة"}},
      {"key": "contactOk", "type": "tick", "required": false,
       "label": {"en": "Mahara can contact me to understand more.", "ar": "يمكن لفريق مهارة التواصل معي لمعرفة المزيد."}}
    ],
    "reads": {"feedback_notice": ["kind", "topic"]},
    "submit": {"en": "Send feedback", "ar": "أرسل رأيك"},
    "done": {"en": "You just made Mahara a little better.", "ar": "شكراً لأنك تساعدنا نتحسّن."}
  }$json$;
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('nps', v_nps), ('csat', v_csat), ('portal_feedback', v_feedback)) AS x(k, s) LOOP
    IF public.cockpit_form_schema_check(r.s) IS NOT NULL OR public.cockpit_form_schema_text_problem(r.s) IS NOT NULL THEN
      RAISE EXCEPTION 'The % seed schema is not valid: %', r.k,
        coalesce(public.cockpit_form_schema_check(r.s), public.cockpit_form_schema_text_problem(r.s)) USING ERRCODE = '55000';
    END IF;
  END LOOP;
  PERFORM set_config('cockpit.forms_action', 'forms.registry_seeded', true);
  PERFORM set_config('cockpit.audit_actor', 'migration 20261102a', true);
  INSERT INTO public.cockpit_forms (key, title, audience, provider, typeform_id, version, schema, seats, client_scoped, effects, updated_by)
  VALUES
    ('nps', 'NPS survey', 'client', 'native', 'fuPgs85S', 1, v_nps, ARRAY['csm'], true,
     '[{"key":"record","owner":"cockpit","delivery":"sql","label":"Stored in the cockpit"},
       {"key":"nps_notice","owner":"cockpit","delivery":"slack_notice","label":"NPS answer in #nps-survey-feedback"},
       {"key":"low_score","owner":"cockpit","delivery":"slack_notice","label":"Low score in #csm-general"},
       {"key":"nps_sent","owner":"cockpit","delivery":"clickup_queue","label":"NPS Survey Sent on the card"},
       {"key":"invite_link","owner":"cockpit","delivery":"client_message","label":"The form link by WhatsApp"}]'::jsonb,
     'migration 20261102a'),
    ('csat', 'Onboarding survey', 'client', 'native', 'KbcbPA73', 1, v_csat, ARRAY['csm'], true,
     '[{"key":"record","owner":"cockpit","delivery":"sql","label":"Stored in the cockpit"},
       {"key":"csat_notice","owner":"cockpit","delivery":"slack_notice","label":"Onboarding survey answer in #nps-survey-feedback"},
       {"key":"low_score","owner":"cockpit","delivery":"slack_notice","label":"Low score in #csm-general"},
       {"key":"invite_link","owner":"cockpit","delivery":"client_message","label":"The form link by WhatsApp"}]'::jsonb,
     'migration 20261102a'),
    ('portal_feedback', 'Portal feedback', 'client', 'native', NULL, 1, v_feedback, ARRAY['csm'], true,
     '[{"key":"record","owner":"cockpit","delivery":"sql","label":"Stored in the cockpit"},
       {"key":"feedback_notice","owner":"cockpit","delivery":"slack_notice","label":"Portal feedback in #csm-general"}]'::jsonb,
     'migration 20261102a')
  ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.cockpit_form_versions (form_key, version, schema, published_by, note)
  SELECT f.key, 1, f.schema, 'migration 20261102a',
         CASE f.key WHEN 'portal_feedback' THEN 'What the portal''s Share feedback sends; edited in the portal.'
                    ELSE 'Client form schema v1 (waves 3-4, 5.7 and 5.8).' END
    FROM public.cockpit_forms f
   WHERE f.key IN ('nps','csat','portal_feedback')
  ON CONFLICT DO NOTHING;
  PERFORM set_config('cockpit.forms_action', '', true);
  PERFORM set_config('cockpit.audit_actor', '', true);
END $$;

-- ---------------------------------------------------------------------------
-- 12. Function privileges: revoked from all four roles, then exactly the
--     grants of 2.2 (replaced functions keep their live grant) and 3.3.

REVOKE ALL ON FUNCTION
  public.cockpit_slack_notice_shape(text), public.cockpit_slack_notice_kind_label(text),
  public.cockpit_slack_notice_live(public.cockpit_slack_notices), public.cockpit_slack_notice_inputs(jsonb),
  public.cockpit_slack_notice_doctor_inputs(), public.cockpit_slack_notice_settings_read(),
  public.cockpit_slack_channel_remove(text), public.cockpit_slack_notice_rehearse(text),
  public.cockpit_slack_notice_rehearse_service(text,text), public.cockpit_slack_notice_read(text),
  public.cockpit_client_message_approve(uuid,text,text,uuid,text[]), public.cockpit_client_message_claim(text[],text[],integer),
  public.cockpit_client_message_view(public.cockpit_client_messages), public.cockpit_form_effect_gate(text,text),
  public.cockpit_form_doors(),
  public.cockpit_form_invites_audit(),
  public.cockpit_client_text_ok(text), public.cockpit_form_schema_pair(jsonb,integer), public.cockpit_form_schema_check(jsonb),
  public.cockpit_form_schema_text_problem(jsonb), public.cockpit_form_answers_check(jsonb,jsonb,jsonb),
  public.cockpit_form_client_settings(), public.cockpit_form_client_live(text), public.cockpit_form_client_version(text),
  public.cockpit_form_departure_of(text), public.cockpit_form_card_allows(text,text), public.cockpit_form_workspace_of(text),
  public.cockpit_form_portal_live(public.cockpit_portal_presence,text),
  public.cockpit_form_default_channels(text,jsonb,public.cockpit_portal_presence),
  public.cockpit_form_words(text), public.cockpit_form_day_words(timestamptz), public.cockpit_form_role_words(jsonb),
  public.cockpit_form_invite_schema(public.cockpit_form_invites), public.cockpit_form_invite_state(public.cockpit_form_invites),
  public.cockpit_form_invite_event(uuid,text,text,text,jsonb),
  public.cockpit_form_invite_close(uuid,text,text,text,text,jsonb,text,uuid,text),
  public.cockpit_form_invites_expire(), public.cockpit_form_invites_withdraw_ineligible(),
  public.cockpit_form_token_mint(uuid,text,uuid,text), public.cockpit_form_invite_gate(uuid),
  public.cockpit_form_client_issued(uuid), public.cockpit_form_client_submitted(uuid),
  public.cockpit_form_client_link_out(uuid),
  public.cockpit_form_portal_invite(public.cockpit_form_invites),
  public.cockpit_form_portal_visible(public.cockpit_form_invites,text), public.cockpit_form_portal_workspace(text,text),
  public.cockpit_form_client_context(public.cockpit_form_invites),
  public.cockpit_form_invite_row(public.cockpit_form_invites), public.cockpit_form_invite_build_view(text,text),
  public.cockpit_form_invite_issue_core(text,text,text[],text,text,boolean,jsonb,uuid,text,jsonb),
  public.cockpit_form_invite_seat(text),
  public.cockpit_form_invite_view(text), public.cockpit_form_invite_issue(text,text,text[],text,text,boolean,jsonb,uuid,text),
  public.cockpit_form_invite_withdraw(text,uuid,text), public.cockpit_form_invite_link(text,uuid),
  public.cockpit_form_invites_today(), public.cockpit_form_answer_read(uuid), public.cockpit_form_client_live_list(),
  public.portal_form_for_person(text,text,text,text,uuid), public.portal_form_list(text,text,text,text),
  public.portal_form_get(text,text,text,text,uuid), public.portal_form_invite_record(text,text,uuid,text,text,jsonb),
  public.cockpit_form_done_text(jsonb,jsonb),
  public.cockpit_form_store_answer(public.cockpit_form_invites,text,text,text,text,text,jsonb,text,text),
  public.portal_form_submit(text,text,text,text,uuid,jsonb,uuid,text),
  public.cockpit_form_token_limited(text,text), public.cockpit_form_token_limited_note(text,text),
  public.cockpit_form_token_find(text),
  public.portal_form_token_open(text,text,text), public.portal_form_token_submit(text,text,text,jsonb,text,uuid,text),
  public.portal_form_preview(text,boolean), public.portal_form_invites_push_claim(integer),
  public.portal_form_invite_push_done(uuid,text,text,jsonb), public.portal_form_invite_display(text,text,uuid,text,text),
  public.portal_form_presence_put(jsonb),
  public.cockpit_client_message_invite_link(uuid,uuid), public.cockpit_form_invite_message_sent(),
  public.cockpit_form_client_go_live(text,boolean,text),
  public.cockpit_form_invite_issue_system(text,text,text[],jsonb,text), public.cockpit_form_invite_canary(text,jsonb,text[])
  FROM PUBLIC, anon, authenticated, service_role;

-- Replaced functions: their live grant (2.2).
GRANT EXECUTE ON FUNCTION public.cockpit_slack_notice_inputs(jsonb), public.cockpit_slack_notice_doctor_inputs(),
  public.cockpit_slack_notice_rehearse_service(text,text),
  public.cockpit_client_message_approve(uuid,text,text,uuid,text[]), public.cockpit_client_message_claim(text[],text[],integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_slack_notice_settings_read(), public.cockpit_slack_channel_remove(text),
  public.cockpit_slack_notice_rehearse(text), public.cockpit_slack_notice_read(text), public.cockpit_form_doors()
  TO authenticated;

-- The seats (3.3).
GRANT EXECUTE ON FUNCTION public.cockpit_form_invite_view(text),
  public.cockpit_form_invite_issue(text,text,text[],text,text,boolean,jsonb,uuid,text),
  public.cockpit_form_invite_withdraw(text,uuid,text), public.cockpit_form_invite_link(text,uuid),
  public.cockpit_form_invites_today(), public.cockpit_form_answer_read(uuid), public.cockpit_form_client_live_list()
  TO authenticated;

-- The portal and the client-messages worker (3.3).
GRANT EXECUTE ON FUNCTION public.portal_form_for_person(text,text,text,text,uuid), public.portal_form_list(text,text,text,text),
  public.portal_form_get(text,text,text,text,uuid), public.portal_form_invite_record(text,text,uuid,text,text,jsonb),
  public.portal_form_submit(text,text,text,text,uuid,jsonb,uuid,text),
  public.portal_form_token_open(text,text,text), public.portal_form_token_submit(text,text,text,jsonb,text,uuid,text),
  public.portal_form_preview(text,boolean), public.portal_form_invites_push_claim(integer),
  public.portal_form_invite_push_done(uuid,text,text,jsonb), public.portal_form_invite_display(text,text,uuid,text,text),
  public.portal_form_presence_put(jsonb), public.cockpit_client_message_invite_link(uuid,uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
