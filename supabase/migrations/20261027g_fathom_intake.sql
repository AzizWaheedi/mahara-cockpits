-- The Fathom intake for the 1-1 notes (docs/forms/STAGE2-CONTRACT.md section
-- 2.2, 3.5, 3.6 and 4.3). Creative Triage (bldgtotkfmhoxmlzowdx). Additive;
-- applies twice. Migration w of three: after 20261027f_forms_core (v), before
-- 20261027h_checkin_plans (x).
--
-- 1. The store gains a meeting class (client, candidate, internal, sales), a
--    room, the recorder's team and the gone marks; a call row gains candidate,
--    room, hints and settled_reason. The match-method and form CHECKs widen
--    for same_room and the native write-through.
-- 2. The class rule of 4.2, written once in SQL (cockpit_fathom_class), sets
--    every meeting's class; then the content of internal and sales meetings
--    and of their call rows is stripped (one audit row records how much), and
--    a trigger keeps it stripped whoever writes: the old worker release, the
--    new one, the ingest or a person with the service key. A Customer Success
--    recording, or one the sales desk marked client service, is never sales.
-- 3. cockpit_forms_keys: key metadata only, no grant to any role; the secrets
--    live in the vault. cockpit_fathom_webhook_deliveries: receipts of
--    Fathom's deliveries, never their bodies. cockpit_forms_key_checks: the
--    receipts of a pasted key's tests, kept out of the monitored ledger.
-- 4. The service RPCs of the forms door, the webhook and the worker (ingest,
--    match inputs, the link lookup, draft inputs, pull state, the doctor's
--    store numbers, the keys) and two browser RPCs (the queue's "Not a 1-1
--    call" and the CEO's connections card).
-- 5. Four replaced functions: the calls summary (form_kind, lastNoteAt,
--    nextCallJoinUrl), the sales exclusion (same_room and Customer Success),
--    the manual match (the booking rule) and the queue (candidate).
--
-- Sync writes of the store keep the worker's rule (a health row and
-- receipts, no per-row audit). The vault is touched only inside plpgsql
-- bodies, so PGlite applies the file. No channel row and no cron job.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columns and constraints on the store

ALTER TABLE public.cockpit_fathom_meetings
  ADD COLUMN IF NOT EXISTS class text CHECK (class IS NULL OR class IN ('client','candidate','internal','sales'));
ALTER TABLE public.cockpit_fathom_meetings ADD COLUMN IF NOT EXISTS room text;
ALTER TABLE public.cockpit_fathom_meetings ADD COLUMN IF NOT EXISTS recorder_team text;
-- First found missing from a complete window read, and marked gone 60 minutes after.
ALTER TABLE public.cockpit_fathom_meetings ADD COLUMN IF NOT EXISTS missing_since timestamptz;
ALTER TABLE public.cockpit_fathom_meetings ADD COLUMN IF NOT EXISTS gone_at timestamptz;
CREATE INDEX IF NOT EXISTS cockpit_fathom_meetings_room ON public.cockpit_fathom_meetings (room) WHERE room IS NOT NULL;
CREATE INDEX IF NOT EXISTS cockpit_fathom_meetings_recorder ON public.cockpit_fathom_meetings (recorded_by_email, starts_at DESC);

-- An impromptu client-side recording with no client yet.
ALTER TABLE public.cockpit_csm_calls ADD COLUMN IF NOT EXISTS candidate boolean NOT NULL DEFAULT false;
ALTER TABLE public.cockpit_csm_calls ADD COLUMN IF NOT EXISTS room text;
-- At most three suggested clients, business names only.
ALTER TABLE public.cockpit_csm_calls ADD COLUMN IF NOT EXISTS hints jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(hints) = 'array' AND jsonb_array_length(hints) <= 3);
-- A candidate the CSM set aside as not a 1-1 call (candidate is false while it is set).
ALTER TABLE public.cockpit_csm_calls ADD COLUMN IF NOT EXISTS settled_reason text
  CHECK (settled_reason IS NULL OR settled_reason IN ('part_of_call','onboarding','blueprint','not_client'));
CREATE INDEX IF NOT EXISTS cockpit_csm_calls_room ON public.cockpit_csm_calls (room) WHERE room IS NOT NULL;
CREATE INDEX IF NOT EXISTS cockpit_csm_calls_candidates ON public.cockpit_csm_calls (starts_at DESC) WHERE candidate;

-- Three CHECKs widen; each is replaced only while it still lacks the new value.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('cockpit_csm_calls', 'cockpit_csm_calls_match_method_check', 'same_room',
       'CHECK (match_method IS NULL OR match_method IN (''client_id_field'',''invitee_email'',''appointment_time'',''name'',''manual'',''form_task_id'',''imported'',''same_room''))'),
      ('cockpit_csm_call_forms', 'cockpit_csm_call_forms_form_id_check', 'cockpit-checkin',
       'CHECK (form_id IN (''fRokTITH'',''KFRCXPFx'',''tG7dnxBn'',''BbJy6xg4'',''oYZKtogO'',''cockpit-checkin''))'),
      ('cockpit_csm_call_forms', 'cockpit_csm_call_forms_matched_by_check', 'cockpit_form',
       'CHECK (matched_by IS NULL OR matched_by IN (''typed_task_id'',''hidden_field'',''manual'',''cockpit_form''))')
    ) AS v(tbl, name, marker, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                    WHERE k.conrelid = format('public.%I', c.tbl)::regclass AND k.conname = c.name
                      AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%' || c.marker || '%') THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', c.tbl, c.name);
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', c.tbl, c.name, c.def);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The room, the class and the booking rule (internal)

-- A call's room from its link: zoom:<meeting id> or meet:<code>, else NULL.
-- Equal to normalizeRoom in hermes/csm-calls/callMatch.ts on every pair of
-- hermes/csm-calls/rooms.cases.json.
CREATE OR REPLACE FUNCTION public.cockpit_call_room(p_url text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text := lower(coalesce(p_url, '')); m text[];
BEGIN
  m := regexp_match(v, 'zoom\.us/(?:j|w|s)/([0-9]{9,12})');
  IF m IS NOT NULL THEN RETURN 'zoom:' || m[1]; END IF;
  m := regexp_match(v, 'meet\.google\.com/([a-z]{3}-[a-z]{4}-[a-z]{3})');
  IF m IS NOT NULL THEN RETURN 'meet:' || m[1]; END IF;
  RETURN NULL;
END $$;

-- The class of a meeting (the rule of 4.2, in order): sales when the sales
-- desk indexed it, its index row is not client service and its recorder is
-- not on Customer Success; client when an invitee is external; candidate for
-- a Customer Success recording flagged external, shared with the team and 5
-- minutes or longer (or summarised); else internal.
CREATE OR REPLACE FUNCTION public.cockpit_fathom_class(p_recording_id text, p_raw jsonb, p_summary text, p_starts timestamptz, p_ends timestamptz)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_team text := coalesce(p_raw->'recorded_by'->>'team', '');
BEGIN
  IF v_team <> 'Customer Success' AND EXISTS (
       SELECT 1 FROM public.cockpit_sales_recordings s
        WHERE s.recording_id = p_recording_id AND coalesce(s.hidden_reason, '') <> 'client service') THEN
    RETURN 'sales';
  END IF;
  IF jsonb_typeof(p_raw->'calendar_invitees') = 'array' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_raw->'calendar_invitees') i WHERE i->>'is_external' = 'true') THEN
    RETURN 'client';
  END IF;
  IF p_raw->>'calendar_invitees_domains_type' = 'one_or_more_external' AND v_team = 'Customer Success'
     AND coalesce(p_raw->>'shared_with', '') <> 'no_teams'
     AND (p_ends - p_starts >= interval '5 minutes' OR p_summary IS NOT NULL) THEN
    RETURN 'candidate';
  END IF;
  RETURN 'internal';
END $$;

-- The one booking-link rule of the database side, equal to exactMatch's
-- bookingId (callMatch.ts): (1) the same room within 90 minutes, when every
-- booking in that window with that room is on this card (the closest of
-- them); a room another card's booking also uses there proves nothing; (2)
-- else this card's booking within 30 minutes either side, the closest; (3)
-- else NULL. Rooms are reused across days, so the room is proof only inside
-- the window.
CREATE OR REPLACE FUNCTION public.cockpit_csm_booking_for(p_task_id text, p_room text, p_starts timestamptz)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id bigint;
BEGIN
  IF p_task_id IS NULL OR p_starts IS NULL THEN RETURN NULL; END IF;
  IF p_room IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.cockpit_csm_calls b
        WHERE b.source = 'ghl_appointment' AND b.status <> 'gone' AND b.task_id IS NOT NULL AND b.task_id <> p_task_id
          AND b.room = p_room AND b.starts_at BETWEEN p_starts - interval '90 minutes' AND p_starts + interval '90 minutes') THEN
    SELECT b.id INTO v_id FROM public.cockpit_csm_calls b
     WHERE b.source = 'ghl_appointment' AND b.status <> 'gone' AND b.task_id = p_task_id
       AND b.room = p_room AND b.starts_at BETWEEN p_starts - interval '90 minutes' AND p_starts + interval '90 minutes'
     ORDER BY abs(extract(epoch FROM b.starts_at - p_starts)), b.id LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  SELECT b.id INTO v_id FROM public.cockpit_csm_calls b
   WHERE b.source = 'ghl_appointment' AND b.status <> 'gone' AND b.task_id = p_task_id
     AND b.starts_at BETWEEN p_starts - interval '30 minutes' AND p_starts + interval '30 minutes'
   ORDER BY abs(extract(epoch FROM b.starts_at - p_starts)), b.id LIMIT 1;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Backfill, the privacy strip and the privacy trigger

UPDATE public.cockpit_csm_calls SET room = public.cockpit_call_room(join_url)
 WHERE source = 'ghl_appointment' AND join_url IS NOT NULL AND room IS NULL;
UPDATE public.cockpit_fathom_meetings
   SET room = public.cockpit_call_room(raw->>'meeting_url'), recorder_team = raw->'recorded_by'->>'team'
 WHERE room IS NULL;
UPDATE public.cockpit_csm_calls c SET room = m.room
  FROM public.cockpit_fathom_meetings m
 WHERE c.source = 'fathom' AND c.source_id = m.recording_id AND c.room IS NULL;
-- The worker's next runs and fathomActionsBackfill set it again with classifyMeeting.
UPDATE public.cockpit_fathom_meetings
   SET class = public.cockpit_fathom_class(recording_id, raw, summary, starts_at, ends_at)
 WHERE class IS NULL;

-- Sales, hiring and team meetings keep metadata only (PLAN 2.2). The content
-- is gone for good here (Fathom still holds it), so one audit row records
-- what was removed, and only when something was: a second apply adds none.
-- transcript_path stays on both rows until the worker removes each object and
-- clears it, so no object is left without a pointer.
DO $$
DECLARE v_meetings integer; v_calls integer; v_pending jsonb;
BEGIN
  UPDATE public.cockpit_fathom_meetings
     SET summary = NULL, raw = raw - 'default_summary' - 'action_items' - 'highlights' - 'transcript'
   WHERE class IN ('internal','sales')
     AND (summary IS NOT NULL OR coalesce(raw->'default_summary', 'null'::jsonb) <> 'null'::jsonb
          OR coalesce(raw->'action_items', 'null'::jsonb) <> 'null'::jsonb
          OR coalesce(raw->'highlights', 'null'::jsonb) <> 'null'::jsonb OR raw ? 'transcript');
  GET DIAGNOSTICS v_meetings = ROW_COUNT;
  UPDATE public.cockpit_csm_calls c SET summary = NULL, transcript_text = NULL
    FROM public.cockpit_fathom_meetings m
   WHERE c.source = 'fathom' AND c.source_id = m.recording_id AND m.class IN ('internal','sales')
     AND (c.summary IS NOT NULL OR c.transcript_text IS NOT NULL);
  GET DIAGNOSTICS v_calls = ROW_COUNT;
  IF v_meetings > 0 OR v_calls > 0 THEN
    SELECT coalesce(jsonb_agg(m.recording_id ORDER BY m.recording_id), '[]'::jsonb) INTO v_pending
      FROM public.cockpit_fathom_meetings m
     WHERE m.class IN ('internal','sales')
       AND (m.transcript_path IS NOT NULL OR EXISTS (
             SELECT 1 FROM public.cockpit_csm_calls c
              WHERE c.source = 'fathom' AND c.source_id = m.recording_id AND c.transcript_path IS NOT NULL));
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('fathom.privacy_strip', 'cockpit_fathom_meetings', NULL, 'migration', 'client-success', 'migration', NULL, NULL,
            jsonb_build_object('meetings', v_meetings, 'callRows', v_calls, 'pendingObjects', v_pending));
  END IF;
END $$;

-- No writer can put content back on an internal or sales meeting, and a
-- meeting written without a class gets one by the rule. Until the worker
-- swap the old release writes summary and raw for every external meeting
-- before its sales check, and a rollback to it would too. transcript_path is
-- never touched here.
CREATE OR REPLACE FUNCTION public.cockpit_fathom_meetings_privacy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.class IS NULL THEN
    NEW.class := public.cockpit_fathom_class(NEW.recording_id, NEW.raw, NEW.summary, NEW.starts_at, NEW.ends_at);
  END IF;
  IF NEW.class IN ('internal','sales') THEN
    NEW.summary := NULL;
    NEW.raw := NEW.raw - 'default_summary' - 'action_items' - 'highlights' - 'transcript';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cockpit_fathom_meetings_privacy ON public.cockpit_fathom_meetings;
CREATE TRIGGER cockpit_fathom_meetings_privacy BEFORE INSERT OR UPDATE ON public.cockpit_fathom_meetings
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_fathom_meetings_privacy();

-- The intent of 20261011c: the service key reads, inserts and updates the
-- store and never deletes or truncates it (nothing in the repo deletes them).
REVOKE DELETE, TRUNCATE ON public.cockpit_csm_calls, public.cockpit_csm_call_forms,
  public.cockpit_fathom_meetings, public.cockpit_csm_unmatched FROM service_role;

-- ---------------------------------------------------------------------------
-- 4. Tables

CREATE TABLE IF NOT EXISTS public.cockpit_forms_keys (
  provider   text PRIMARY KEY CHECK (provider IN ('fathom','fathom_webhook','anthropic','deepseek')),
  vault_name text NOT NULL UNIQUE,
  last4      text,
  state      text NOT NULL DEFAULT 'unchecked' CHECK (state IN ('connected','unchecked','refused')),
  -- A plain sentence, never the key.
  state_note text CHECK (state_note IS NULL OR char_length(state_note) <= 240),
  -- An email or server.
  saved_by   text NOT NULL CHECK (btrim(saved_by) <> ''),
  saved_at   timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  -- fathom_webhook: {webhookId, triggeredFor, includes, destination, createdAt,
  -- unregisteredAt}; fathom: {users, adminOk, csFilterOk}.
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),
  CHECK (vault_name = 'cockpit_forms_key_' || provider)
);
COMMENT ON TABLE public.cockpit_forms_keys IS
  'Metadata of the 1-1 notes keys (Fathom, the Fathom webhook secret, DeepSeek, Anthropic). The secrets live in the vault under vault_name. No role has any grant: reached only through service-only SECURITY DEFINER functions; only last4 ever reaches a browser.';

CREATE TABLE IF NOT EXISTS public.cockpit_fathom_webhook_deliveries (
  -- Fathom's webhook-id, kept by its retries.
  webhook_id    text PRIMARY KEY CHECK (char_length(webhook_id) BETWEEN 1 AND 200),
  -- The webhook-timestamp header.
  msg_timestamp timestamptz,
  first_at      timestamptz NOT NULL DEFAULT now(),
  last_at       timestamptz NOT NULL DEFAULT now(),
  receipts      integer NOT NULL DEFAULT 1,
  recording_id  text CHECK (recording_id IS NULL OR recording_id ~ '^[0-9]{1,20}$'),
  outcome       text NOT NULL DEFAULT 'received' CHECK (outcome IN ('received','stored','ignored','failed')),
  reason        text CHECK (reason IS NULL OR char_length(reason) <= 240)
);
CREATE INDEX IF NOT EXISTS cockpit_fathom_webhook_deliveries_last
  ON public.cockpit_fathom_webhook_deliveries (last_at DESC);

-- The tests keys.save runs on a pasted key that is not saved yet. They stay
-- out of cockpit_csm_provider_health, whose latest bad receipt per provider
-- turns the native monitor red for 24 hours: a refused paste is a user error.
CREATE TABLE IF NOT EXISTS public.cockpit_forms_key_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL CHECK (provider IN ('fathom','deepseek','anthropic')),
  method      text NOT NULL CHECK (method = 'GET'),
  -- As the ledger writes it, with no query (api.fathom.ai/external/v1/users).
  resource    text NOT NULL CHECK (char_length(resource) BETWEEN 1 AND 300 AND resource !~ '[[:space:]?#@]'),
  phase       text NOT NULL CHECK (phase IN ('intent','response','unknown')),
  http_status integer,
  run_key     text CHECK (run_key IS NULL OR run_key ~* '^keys:[0-9a-f-]{36}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cockpit_forms_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_fathom_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_forms_key_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_forms_keys, public.cockpit_fathom_webhook_deliveries, public.cockpit_forms_key_checks
  FROM PUBLIC, anon, authenticated, service_role;
-- cockpit_forms_keys: no grant to any role, service_role included.
GRANT SELECT ON public.cockpit_fathom_webhook_deliveries TO service_role;
GRANT SELECT, INSERT ON public.cockpit_forms_key_checks TO service_role;

-- No delete (per row) and no truncate (per statement), as on the forms tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_forms_keys','cockpit_fathom_webhook_deliveries','cockpit_forms_key_checks'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_forms_no_delete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_forms_no_delete BEFORE DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.cockpit_forms_refuse_delete()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS cockpit_forms_no_truncate ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cockpit_forms_no_truncate BEFORE TRUNCATE ON public.%I '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_forms_refuse_delete()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Small helpers (internal)

CREATE OR REPLACE FUNCTION public.cockpit_forms_key_label(p_provider text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_provider WHEN 'fathom' THEN 'Fathom' WHEN 'fathom_webhook' THEN 'Fathom webhook'
                         WHEN 'anthropic' THEN 'Anthropic' WHEN 'deepseek' THEN 'DeepSeek' END
$$;

-- The registration detail the guardian reads from cockpit_sync_state
-- fathom-webhook (cockpit_forms_keys has no grant to any role).
CREATE OR REPLACE FUNCTION public.cockpit_forms_webhook_detail(p_meta jsonb, p_saved_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id text := nullif(btrim(coalesce(p_meta->>'webhookId', '')), '');
  v_off boolean := coalesce(jsonb_typeof(p_meta->'unregisteredAt'), 'null') <> 'null';
BEGIN
  RETURN jsonb_build_object(
    'registered', v_id IS NOT NULL AND NOT v_off,
    'webhookIdLast4', right(v_id, 4),
    'registeredAt', CASE WHEN v_id IS NOT NULL THEN coalesce(p_meta->'createdAt', to_jsonb(p_saved_at)) END,
    'unregisteredAt', CASE WHEN v_off THEN p_meta->'unregisteredAt' END);
END $$;

-- A form answer by its Typeform title, as text (the brief reads them so).
CREATE OR REPLACE FUNCTION public.cockpit_fathom_form_answer(p_answers jsonb, p_title text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb;
BEGIN
  IF jsonb_typeof(p_answers) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  SELECT x INTO a FROM jsonb_array_elements(p_answers) x
   WHERE lower(btrim(x->>'title')) = lower(p_title) LIMIT 1;
  IF a IS NULL OR jsonb_typeof(a->'value') IS NULL OR jsonb_typeof(a->'value') = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(a->'value') = 'array' THEN
    RETURN nullif(btrim((SELECT string_agg(v, ', ') FROM jsonb_array_elements_text(a->'value') v)), '');
  END IF;
  RETURN nullif(btrim(a->'value' #>> '{}'), '');
END $$;

-- One recording as the matcher sees it (MatchInputs.store, section 3.5).
-- notes: the newest live native 1-1 notes on this recording, else the newest
-- stored check-in form with its share link or linked to its call or booking.
-- A shadow run is never read here.
-- onTaskConfidence (A7.14 rule 2, round 3, A7.17; agreed with forms-api): the
-- call row's match_confidence as a JSON number, null with no call row or no
-- confidence, beside onTaskMethod. The door reads rule 2 as v does: a row on
-- the card ties only when onTaskMethod is same_room, appointment_time,
-- form_task_id, manual or client_id_field, or invitee_email with
-- onTaskConfidence >= 0.9; a name row (0.6) or a company-domain row
-- (invitee_email 0.8) is asked about like a row on no card. MatchInputs
-- client.onClient carries the same number as confidence, beside method.
CREATE OR REPLACE FUNCTION public.cockpit_fathom_store_item(p_recording_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.cockpit_fathom_meetings; c public.cockpit_csm_calls; v_notes jsonb;
BEGIN
  SELECT * INTO m FROM public.cockpit_fathom_meetings x WHERE x.recording_id = p_recording_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.cockpit_csm_calls x WHERE x.source = 'fathom' AND x.source_id = p_recording_id;
  SELECT jsonb_build_object('at', r.submitted_at, 'source', 'cockpit') INTO v_notes
    FROM public.cockpit_form_responses r
   WHERE r.form_key = 'checkin' AND r.mode = 'live' AND r.state IN ('submitted','confirmed')
     AND r.answers->'call'->>'kind' = 'fathom' AND r.answers->'call'->>'recordingId' = p_recording_id
   ORDER BY r.submitted_at DESC LIMIT 1;
  IF v_notes IS NULL THEN
    SELECT jsonb_build_object('at', f.submitted_at, 'source', 'typeform') INTO v_notes
      FROM public.cockpit_csm_call_forms f
     WHERE f.form_kind = 'checkin'
       AND ((m.share_url IS NOT NULL AND substring(f.recording_url FROM 'https://fathom\.video/share/[A-Za-z0-9_-]+') = m.share_url)
         OR (c.id IS NOT NULL AND f.linked_call_id = c.id)
         OR (c.linked_call_id IS NOT NULL AND f.linked_call_id = c.linked_call_id))
     ORDER BY f.submitted_at DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'recordingId', m.recording_id,
    'startsAt', m.starts_at,
    'endsAt', m.ends_at,
    'room', m.room,
    'title', m.title,
    -- Fathom's own title as stored in raw, never the calendar's (A7.12, A7.13):
    -- the title column falls back to meeting_title.
    'editedTitle', CASE WHEN jsonb_typeof(m.raw->'title') = 'string' THEN m.raw->>'title' END,
    'meetingTitle', m.raw->>'meeting_title',
    'class', m.class,
    'recorderEmail', lower(btrim(m.recorded_by_email)),
    'recorderTeam', coalesce(m.recorder_team, m.raw->'recorded_by'->>'team'),
    'shareUrl', m.share_url,
    'inviteeEmails', coalesce((SELECT jsonb_agg(DISTINCT lower(btrim(i->>'email')))
                                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.invitees) = 'array' THEN m.invitees ELSE '[]'::jsonb END) i
                                WHERE nullif(btrim(i->>'email'), '') IS NOT NULL), '[]'::jsonb),
    'onTask', c.task_id,
    'onTaskMethod', c.match_method,
    'onTaskConfidence', c.match_confidence,
    'callId', c.id,
    'linkedCallId', c.linked_call_id,
    'gone', m.gone_at IS NOT NULL OR coalesce(c.status, '') = 'gone',
    'settled', c.settled_reason IS NOT NULL,
    'hasSummary', coalesce(m.summary, c.summary) IS NOT NULL,
    'hasTranscript', coalesce(m.transcript_path, c.transcript_path) IS NOT NULL,
    -- Missing is never zero: null until the action items have been read.
    'actionItems', CASE WHEN jsonb_typeof(m.raw->'action_items') = 'array' THEN jsonb_array_length(m.raw->'action_items') END,
    'notes', v_notes);
END $$;

-- ---------------------------------------------------------------------------
-- 6. Service RPCs (service_role only; cockpit_hours_require_service first)

CREATE OR REPLACE FUNCTION public.cockpit_forms_key_get(p_provider text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE k public.cockpit_forms_keys; v_secret text;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  SELECT * INTO k FROM public.cockpit_forms_keys x WHERE x.provider = p_provider;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT ds.decrypted_secret INTO v_secret FROM vault.decrypted_secrets ds WHERE ds.name = k.vault_name LIMIT 1;
  RETURN jsonb_build_object('provider', k.provider, 'secret', v_secret, 'last4', k.last4, 'state', k.state,
    'savedAt', k.saved_at, 'meta', k.meta);
END $$;

-- Save a key: the secret into the vault (updated when its name exists,
-- created otherwise), the metadata here, one forms.keySaved audit row. A
-- webhook key is a new registration, so its meta is replaced whole and an old
-- unregisteredAt never sticks to a new webhook. Never returns or logs the secret.
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
  k public.cockpit_forms_keys;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF v_provider IS NULL OR v_provider NOT IN ('fathom','fathom_webhook','anthropic','deepseek') THEN
    RAISE EXCEPTION 'Choose fathom, fathom_webhook, anthropic or deepseek.' USING ERRCODE = '22023';
  END IF;
  v_ok := CASE v_provider
    WHEN 'fathom' THEN char_length(v_secret) BETWEEN 20 AND 400 AND v_secret !~ '[[:space:]]'
    WHEN 'fathom_webhook' THEN v_secret ~ '^whsec_[A-Za-z0-9+/=_-]{16,}$'
    WHEN 'anthropic' THEN v_secret ~ '^sk-ant-[A-Za-z0-9_-]{20,}$'
    WHEN 'deepseek' THEN v_secret ~ '^sk-[A-Za-z0-9]{20,}$' END;
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
         meta = CASE WHEN EXCLUDED.provider = 'fathom_webhook' THEN EXCLUDED.meta ELSE k0.meta || EXCLUDED.meta END
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
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('forms.keySaved', 'cockpit_forms_keys', v_provider, v_by, 'client-success',
          CASE WHEN v_by = 'server' THEN 'forms_key.py' ELSE 'cockpit-forms-api' END, NULL, NULL,
          jsonb_build_object('provider', v_provider, 'savedBy', v_by, 'state', v_state, 'last4', right(v_secret, 4)));
  RETURN jsonb_build_object('ok', true, 'provider', v_provider, 'last4', right(v_secret, 4), 'state', v_state);
END $$;

-- Mark a key after a check, compare-and-swap on saved_at: a key pasted
-- meanwhile is never marked by the old key's failure. For the webhook it
-- rewrites the registration detail, and the note when it was unregistered.
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
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF v_provider IS NULL OR v_provider NOT IN ('fathom','fathom_webhook','anthropic','deepseek') THEN
    RAISE EXCEPTION 'Choose fathom, fathom_webhook, anthropic or deepseek.' USING ERRCODE = '22023';
  END IF;
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

-- Store meetings and their call rows from the pull or the webhook (section
-- 4.3). A row already on a client keeps its whole match block (task, client,
-- method, confidence, booking link, kind): only the worker re-matches a
-- matched row. A settled row keeps its stored block the same way, so it stays
-- on no client (2.2, A7.13): only a person places a set-aside recording (the
-- window's attach, "This is {client}"). A link is never set to NULL over a
-- stored one, and a settled candidate stays settled. Hints are for an
-- unplaced, unsettled candidate only (A7.12, A7.13): the item's hints land
-- only when the row ends with no task_id and no settled_reason and the item
-- is a candidate; every other row stores none, a settled one included.
-- Whatever the input says, a recording the sales desk indexed (not client
-- service, not recorded by Customer Success) is stored as sales, metadata
-- only, and gets no call row. The pull never turns a stored client or
-- candidate meeting internal.
CREATE OR REPLACE FUNCTION public.cockpit_fathom_ingest(p_items jsonb, p_via text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it jsonb;
  mt jsonb;
  cl jsonb;
  v_rid text;
  v_raw jsonb;
  v_summary text;
  v_team text;
  v_class text;
  v_starts timestamptz;
  v_ends timestamptz;
  was public.cockpit_fathom_meetings;
  prior public.cockpit_csm_calls;
  c public.cockpit_csm_calls;
  v_task text;
  v_client text;
  v_method text;
  v_conf numeric;
  v_link bigint;
  v_kind text;
  v_candidate boolean;
  v_meetings integer := 0;
  v_calls jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF p_via IS NULL OR p_via NOT IN ('pull','webhook') THEN
    RAISE EXCEPTION 'Choose pull or webhook.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_source', CASE WHEN p_via = 'webhook' THEN 'fathom-webhook' ELSE 'cockpit-forms-api' END, true);
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'Send at most 50 meetings at a time.' USING ERRCODE = '22023';
  END IF;
  FOR it IN SELECT x FROM jsonb_array_elements(p_items) x LOOP
    mt := it->'meeting';
    v_rid := mt->>'recording_id';
    IF jsonb_typeof(mt) IS DISTINCT FROM 'object' OR v_rid IS NULL OR v_rid !~ '^[0-9]{3,20}$' THEN
      RAISE EXCEPTION 'Each item needs a meeting with its recording ID.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO was FROM public.cockpit_fathom_meetings x WHERE x.recording_id = v_rid FOR UPDATE;
    v_raw := CASE WHEN jsonb_typeof(mt->'raw') = 'object' THEN mt->'raw' ELSE '{}'::jsonb END;
    v_starts := (mt->>'starts_at')::timestamptz;
    v_ends := (mt->>'ends_at')::timestamptz;
    -- The pull reads a light list without summaries: it keeps what is stored.
    IF p_via = 'pull' THEN
      v_raw := coalesce(was.raw, '{}'::jsonb) || jsonb_strip_nulls(v_raw);
      v_summary := coalesce(nullif(mt->>'summary', ''), was.summary);
    ELSE
      v_summary := nullif(mt->>'summary', '');
    END IF;
    v_team := coalesce(mt->'raw'->'recorded_by'->>'team', was.raw->'recorded_by'->>'team');
    v_class := mt->>'class';
    IF coalesce(v_team, '') <> 'Customer Success' AND EXISTS (
         SELECT 1 FROM public.cockpit_sales_recordings s
          WHERE s.recording_id = v_rid AND coalesce(s.hidden_reason, '') <> 'client service') THEN
      v_class := 'sales';
    ELSIF v_class IS NULL OR v_class NOT IN ('client','candidate','internal','sales') THEN
      v_class := public.cockpit_fathom_class(v_rid, v_raw, v_summary, v_starts, v_ends);
    END IF;
    -- The light list has no summary, so a short Customer Success call that has
    -- one reads as internal there: the pull keeps a stored client or candidate
    -- class and strips nothing. Only the worker and the webhook, which see
    -- summaries, change a stored class.
    IF p_via = 'pull' AND v_class = 'internal' AND was.class IN ('client','candidate') THEN
      v_class := was.class;
    END IF;
    IF v_class IN ('internal','sales') THEN
      v_summary := NULL;
      v_raw := v_raw - 'default_summary' - 'action_items' - 'highlights' - 'transcript';
    END IF;
    INSERT INTO public.cockpit_fathom_meetings AS m0 (recording_id, title, starts_at, ends_at, recorded_by_email, recorded_by_name,
      external, invitees, url, share_url, summary, raw, class, room, recorder_team, missing_since, gone_at, updated_at)
    VALUES (v_rid, mt->>'title', v_starts, v_ends, lower(nullif(btrim(mt->>'recorded_by_email'), '')), mt->>'recorded_by_name',
            coalesce(mt->'external' = 'true'::jsonb, false),
            CASE WHEN jsonb_typeof(mt->'invitees') = 'array' THEN mt->'invitees' ELSE '[]'::jsonb END,
            mt->>'url', mt->>'share_url', v_summary, v_raw, v_class,
            coalesce(nullif(mt->>'room', ''), public.cockpit_call_room(v_raw->>'meeting_url')),
            -- Fathom's own team first, so the column and the sales test agree.
            coalesce(v_team, nullif(mt->>'recorder_team', '')), NULL, NULL, now())
    ON CONFLICT (recording_id) DO UPDATE
       SET title = EXCLUDED.title, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
           recorded_by_email = EXCLUDED.recorded_by_email, recorded_by_name = EXCLUDED.recorded_by_name,
           external = EXCLUDED.external, invitees = EXCLUDED.invitees, url = EXCLUDED.url, share_url = EXCLUDED.share_url,
           summary = EXCLUDED.summary, raw = EXCLUDED.raw, class = EXCLUDED.class, room = EXCLUDED.room,
           recorder_team = EXCLUDED.recorder_team, missing_since = NULL, gone_at = NULL, updated_at = now();
    v_meetings := v_meetings + 1;

    cl := it->'call';
    CONTINUE WHEN jsonb_typeof(cl) IS DISTINCT FROM 'object' OR v_class NOT IN ('client','candidate');
    SELECT * INTO prior FROM public.cockpit_csm_calls x WHERE x.source = 'fathom' AND x.source_id = v_rid FOR UPDATE;
    -- On a client, or set aside: the stored block stays whatever the item found.
    IF prior.task_id IS NOT NULL OR prior.settled_reason IS NOT NULL THEN
      v_task := prior.task_id;
      v_client := prior.client_name;
      v_method := prior.match_method;
      v_conf := prior.match_confidence;
      v_link := prior.linked_call_id;
      v_kind := prior.kind;
    ELSE
      v_task := nullif(btrim(cl->>'task_id'), '');
      v_client := cl->>'client_name';
      v_method := cl->>'match_method';
      v_conf := (cl->>'match_confidence')::numeric;
      v_link := coalesce((cl->>'linked_call_id')::bigint, prior.linked_call_id);
      v_kind := coalesce(nullif(cl->>'kind', ''), prior.kind, 'other');
    END IF;
    v_candidate := coalesce(cl->'candidate' = 'true'::jsonb, false) AND v_task IS NULL AND prior.settled_reason IS NULL;
    INSERT INTO public.cockpit_csm_calls AS c0 (source, source_id, task_id, client_name, match_method, match_confidence, kind,
      title, starts_at, ends_at, status, provider_status, host_email, host_name, recording_url, summary, transcript_path,
      transcript_text, external_invitees, linked_call_id, raw_hash, candidate, room, hints, updated_at)
    VALUES ('fathom', v_rid, v_task, v_client, v_method, v_conf, v_kind,
            left(coalesce(nullif(btrim(cl->>'title'), ''), nullif(btrim(mt->>'title'), ''), 'Recorded call'), 300),
            (cl->>'starts_at')::timestamptz, (cl->>'ends_at')::timestamptz, 'held', 'recorded',
            lower(nullif(btrim(cl->>'host_email'), '')), cl->>'host_name', cl->>'recording_url',
            coalesce(nullif(cl->>'summary', ''), prior.summary),
            coalesce(nullif(cl->>'transcript_path', ''), prior.transcript_path),
            coalesce(nullif(cl->>'transcript_text', ''), prior.transcript_text),
            CASE WHEN jsonb_typeof(cl->'external_invitees') = 'array' THEN cl->'external_invitees' ELSE '[]'::jsonb END,
            v_link, coalesce(nullif(cl->>'raw_hash', ''), prior.raw_hash),
            v_candidate,
            coalesce(nullif(cl->>'room', ''), nullif(mt->>'room', ''), public.cockpit_call_room(v_raw->>'meeting_url')),
            -- The item's hints only on the row that ends an unplaced, unsettled
            -- candidate; every other row, a settled one included, stores none (A7.13).
            CASE WHEN v_candidate AND jsonb_typeof(cl->'hints') = 'array' THEN cl->'hints' ELSE '[]'::jsonb END,
            now())
    ON CONFLICT (source, source_id) DO UPDATE
       SET task_id = EXCLUDED.task_id, client_name = EXCLUDED.client_name, match_method = EXCLUDED.match_method,
           match_confidence = EXCLUDED.match_confidence, kind = EXCLUDED.kind, title = EXCLUDED.title,
           starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, status = EXCLUDED.status,
           provider_status = EXCLUDED.provider_status, host_email = EXCLUDED.host_email, host_name = EXCLUDED.host_name,
           recording_url = EXCLUDED.recording_url, summary = EXCLUDED.summary, transcript_path = EXCLUDED.transcript_path,
           transcript_text = EXCLUDED.transcript_text, external_invitees = EXCLUDED.external_invitees,
           linked_call_id = EXCLUDED.linked_call_id, raw_hash = EXCLUDED.raw_hash, candidate = EXCLUDED.candidate,
           room = EXCLUDED.room, hints = EXCLUDED.hints, updated_at = now()
    RETURNING * INTO c;
    v_calls := v_calls || jsonb_build_array(jsonb_build_object('recordingId', v_rid, 'callId', c.id, 'taskId', c.task_id));
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'meetings', v_meetings, 'calls', v_calls);
END $$;

-- What the matcher reads for a window (MatchInputs, section 3.5), server side
-- only. Shadow runs feed none of these keys: form links come from stored
-- check-in forms only, lastNoteAt and notes from live native notes only.
CREATE OR REPLACE FUNCTION public.cockpit_fathom_match_inputs(p_from timestamptz, p_to timestamptz, p_task_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_bookings jsonb;
  v_sales jsonb;
  v_links jsonb;
  v_clients jsonb;
  v_staff jsonb;
  v_store jsonb;
  v_client jsonb;
  v_name text;
  v_last timestamptz;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Choose a window: from, then to.' USING ERRCODE = '22023';
  END IF;
  IF p_task_id IS NOT NULL AND p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;

  -- Every status but gone: the matcher needs cancelled and future bookings
  -- for near_booking, the hints and the same-room proof.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'taskId', b.task_id, 'clientName', b.client_name, 'kind', b.kind, 'status', b.status,
      'startsAt', b.starts_at, 'endsAt', b.ends_at, 'room', b.room,
      'emails', coalesce((SELECT jsonb_agg(DISTINCT lower(btrim(i->>'email')))
                            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.external_invitees) = 'array' THEN b.external_invitees ELSE '[]'::jsonb END) i
                           WHERE nullif(btrim(i->>'email'), '') IS NOT NULL), '[]'::jsonb),
      'contactNames', coalesce((SELECT jsonb_agg(DISTINCT btrim(i->>'name'))
                                  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.external_invitees) = 'array' THEN b.external_invitees ELSE '[]'::jsonb END) i
                                 WHERE nullif(btrim(i->>'name'), '') IS NOT NULL), '[]'::jsonb))
      ORDER BY b.starts_at, b.id), '[]'::jsonb)
    INTO v_bookings
    FROM public.cockpit_csm_calls b
   WHERE b.source = 'ghl_appointment' AND b.task_id IS NOT NULL AND b.status <> 'gone'
     AND b.starts_at BETWEEN p_from - interval '2 hours' AND p_to + interval '2 hours';

  -- The rule of 4.2: the sales desk's vault indexes the CSM's calls too.
  SELECT coalesce(jsonb_agg(DISTINCT m.recording_id), '[]'::jsonb) INTO v_sales
    FROM public.cockpit_fathom_meetings m JOIN public.cockpit_sales_recordings s ON s.recording_id = m.recording_id
   WHERE m.starts_at BETWEEN p_from AND p_to AND coalesce(s.hidden_reason, '') <> 'client service'
     AND coalesce(m.recorder_team, m.raw->'recorded_by'->>'team', '') <> 'Customer Success';

  -- The first share link in each stored check-in form with a card (the
  -- Typeform rows today, the native write-through after the cut-over).
  SELECT coalesce(jsonb_agg(jsonb_build_object('shareUrl', l.share, 'taskId', l.task_id) ORDER BY l.share, l.task_id), '[]'::jsonb)
    INTO v_links
    FROM (SELECT DISTINCT substring(f.answers::text FROM 'https://fathom\.video/share/[A-Za-z0-9_-]+') AS share, f.task_id
            FROM public.cockpit_csm_call_forms f WHERE f.form_kind = 'checkin' AND f.task_id IS NOT NULL) l
   WHERE l.share IS NOT NULL;

  -- The board's clients with every alias the media buyer side knows them by
  -- (the worker's loadClients).
  SELECT coalesce(jsonb_agg(jsonb_build_object('taskId', s.data->>'taskId', 'name', s.data->>'name',
      'aliases', coalesce((SELECT jsonb_agg(DISTINCT z.a ORDER BY z.a) FROM (
          SELECT btrim(l.data->>'name') AS a FROM public.cockpit_media_sources l
           WHERE l.table_name = 'clientLinks' AND l.data->>'taskId' = s.data->>'taskId'
          UNION ALL
          SELECT btrim(al) FROM public.cockpit_media_sources l
           CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(l.data->'aliases') = 'array'
                                                             THEN l.data->'aliases' ELSE '[]'::jsonb END) al
           WHERE l.table_name = 'clientLinks' AND l.data->>'taskId' = s.data->>'taskId') z
        WHERE nullif(z.a, '') IS NOT NULL), '[]'::jsonb))
      ORDER BY s.data->>'name', s.data->>'taskId'), '[]'::jsonb)
    INTO v_clients
    FROM public.cockpit_csm_sources s
   WHERE s.table_name = 'clients' AND nullif(s.data->>'taskId', '') IS NOT NULL AND nullif(btrim(s.data->>'name'), '') IS NOT NULL;

  -- The role labels are computed here: cockpit_slack_notice_role_of is
  -- postgres-only, so the Edge Functions cannot call it over REST.
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'email', lower(btrim(p.email)),
      'role', public.cockpit_slack_notice_role_of(p.email)) ORDER BY p.id), '[]'::jsonb)
    INTO v_staff
    FROM public.cockpit_people p WHERE p.active;

  SELECT coalesce(jsonb_agg(public.cockpit_fathom_store_item(m.recording_id) ORDER BY m.starts_at DESC, m.recording_id), '[]'::jsonb)
    INTO v_store
    FROM public.cockpit_fathom_meetings m WHERE m.starts_at BETWEEN p_from AND p_to;

  IF p_task_id IS NOT NULL THEN
    SELECT nullif(btrim(s.data->>'name'), '') INTO v_name
      FROM public.cockpit_csm_sources s WHERE s.table_name = 'clients' AND s.data->>'taskId' = p_task_id LIMIT 1;
    SELECT max(z.at) INTO v_last FROM (
      SELECT max(f.submitted_at) AS at FROM public.cockpit_csm_call_forms f
       WHERE f.task_id = p_task_id AND f.form_kind = 'checkin'
      UNION ALL
      SELECT max(r.submitted_at) FROM public.cockpit_form_responses r
       WHERE r.task_id = p_task_id AND r.form_key = 'checkin' AND r.mode = 'live' AND r.state IN ('submitted','confirmed')) z;
    -- onClient carries no class and no gone flag, so it holds only a call row
    -- whose stored recording may be offered (5.2): class client or candidate,
    -- and gone neither in the store nor on the row. A row whose recording the
    -- sales desk later indexed as sales, one Fathom no longer has, or one with
    -- no store row is left out: missing is never a guess.
    v_client := jsonb_build_object('taskId', p_task_id, 'name', v_name, 'lastNoteAt', v_last,
      'onClient', coalesce((SELECT jsonb_agg(jsonb_build_object('recordingId', c.source_id, 'callId', c.id,
                                     'method', c.match_method, 'confidence', c.match_confidence,
                                     'startsAt', c.starts_at) ORDER BY c.starts_at DESC, c.id)
                              FROM public.cockpit_csm_calls c
                              JOIN public.cockpit_fathom_meetings m ON m.recording_id = c.source_id
                             WHERE c.source = 'fathom' AND c.task_id = p_task_id AND c.status <> 'gone'
                               AND m.class IN ('client','candidate') AND m.gone_at IS NULL
                               AND c.starts_at >= now() - interval '14 days'), '[]'::jsonb));
  END IF;

  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'bookings', v_bookings, 'sales', v_sales, 'formLinks', v_links,
    'clients', v_clients, 'csmEmails', to_jsonb(public.cockpit_form_csm_emails()), 'staff', v_staff,
    'client', v_client, 'store', v_store);
END $$;

-- A pasted Fathom link, found anywhere in the store, whatever its date: the
-- scheme and host lower-cased, the query, the fragment and a trailing slash
-- dropped; /share/{token} by share_url, /calls/{n} by url. A read: no audit.
CREATE OR REPLACE FUNCTION public.cockpit_fathom_find_link(p_url text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m text[]; v_path text; v_rid text;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  m := regexp_match(btrim(coalesce(p_url, '')), '^(?:https?://)?(?:www\.)?fathom\.video(/[^?#]*)?(?:[?#].*)?$', 'i');
  IF m IS NULL THEN RETURN jsonb_build_object('found', false, 'fathom', false); END IF;
  v_path := regexp_replace(coalesce(m[1], ''), '/+$', '');
  IF v_path ~ '^/share/[A-Za-z0-9_-]+$' THEN
    SELECT x.recording_id INTO v_rid FROM public.cockpit_fathom_meetings x
     WHERE rtrim(x.share_url, '/') = 'https://fathom.video' || v_path ORDER BY x.starts_at DESC NULLS LAST LIMIT 1;
  ELSIF v_path ~ '^/calls/[0-9]+$' THEN
    SELECT x.recording_id INTO v_rid FROM public.cockpit_fathom_meetings x
     WHERE rtrim(x.url, '/') = 'https://fathom.video' || v_path ORDER BY x.starts_at DESC NULLS LAST LIMIT 1;
  ELSE
    RETURN jsonb_build_object('found', false, 'fathom', false);
  END IF;
  IF v_rid IS NULL THEN RETURN jsonb_build_object('found', false, 'fathom', true); END IF;
  RETURN jsonb_build_object('found', true, 'store', public.cockpit_fathom_store_item(v_rid));
END $$;

-- The pull on open runs at most once a minute (every 15 seconds after a failure).
CREATE OR REPLACE FUNCTION public.cockpit_fathom_pull_due()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.cockpit_sync_state;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  SELECT * INTO s FROM public.cockpit_sync_state x WHERE x.key = 'fathom-pull';
  RETURN jsonb_build_object(
    'due', s.key IS NULL OR s.last_run_at IS NULL OR s.last_run_at < now() - interval '60 seconds'
           OR (NOT s.ok AND s.last_run_at < now() - interval '15 seconds'),
    'lastRunAt', s.last_run_at, 'ok', s.ok, 'note', s.note);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_fathom_pull_mark(p_ok boolean, p_items integer, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_hours_require_service();
  INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, rows_seen, updated_at)
  VALUES ('fathom-pull', now(), CASE WHEN coalesce(p_ok, false) THEN now() END, coalesce(p_ok, false), left(p_note, 240),
          p_items, now())
  ON CONFLICT (key) DO UPDATE
     SET last_run_at = now(), last_ok_at = CASE WHEN EXCLUDED.ok THEN now() ELSE s0.last_ok_at END, ok = EXCLUDED.ok,
         note = EXCLUDED.note, rows_seen = EXCLUDED.rows_seen, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'lastRunAt', now());
END $$;

-- A delivery's first look: a new webhook-id, a failed one, or one received
-- more than 5 minutes ago and never settled is processed (first); any other
-- receipt of the same id is a duplicate.
CREATE OR REPLACE FUNCTION public.cockpit_fathom_webhook_seen(p_webhook_id text, p_timestamp timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.cockpit_fathom_webhook_deliveries;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF p_webhook_id IS NULL OR char_length(p_webhook_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'A delivery needs its webhook-id.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_fathom_webhook_deliveries(webhook_id, msg_timestamp)
  VALUES (p_webhook_id, p_timestamp) ON CONFLICT (webhook_id) DO NOTHING
  RETURNING * INTO d;
  IF FOUND THEN
    RETURN jsonb_build_object('first', true, 'prior', NULL);
  END IF;
  SELECT * INTO d FROM public.cockpit_fathom_webhook_deliveries x WHERE x.webhook_id = p_webhook_id FOR UPDATE;
  IF d.outcome = 'failed' OR (d.outcome = 'received' AND d.last_at < now() - interval '5 minutes') THEN
    UPDATE public.cockpit_fathom_webhook_deliveries x
       SET outcome = 'received', receipts = x.receipts + 1, last_at = now()
     WHERE x.webhook_id = p_webhook_id;
    RETURN jsonb_build_object('first', true, 'prior', d.outcome);
  END IF;
  UPDATE public.cockpit_fathom_webhook_deliveries x SET receipts = x.receipts + 1, last_at = now()
   WHERE x.webhook_id = p_webhook_id;
  RETURN jsonb_build_object('first', false, 'prior', d.outcome);
END $$;

-- A delivery's outcome, and the webhook's line in cockpit_sync_state. The
-- registration detail is written by the key functions only.
CREATE OR REPLACE FUNCTION public.cockpit_fathom_webhook_settle(p_webhook_id text, p_outcome text, p_recording_id text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rid text := CASE WHEN p_recording_id ~ '^[0-9]{1,20}$' THEN p_recording_id END;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF p_outcome IS NULL OR p_outcome NOT IN ('stored','ignored','failed') THEN
    RAISE EXCEPTION 'Choose stored, ignored or failed.' USING ERRCODE = '22023';
  END IF;
  IF p_webhook_id IS NULL OR char_length(p_webhook_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'A delivery needs its webhook-id.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.cockpit_fathom_webhook_deliveries x
     SET outcome = p_outcome, recording_id = v_rid, reason = left(p_reason, 240)
   WHERE x.webhook_id = p_webhook_id;
  IF NOT FOUND THEN
    INSERT INTO public.cockpit_fathom_webhook_deliveries(webhook_id, outcome, recording_id, reason)
    VALUES (p_webhook_id, p_outcome, v_rid, left(p_reason, 240));
  END IF;
  INSERT INTO public.cockpit_sync_state AS s0 (key, last_run_at, last_ok_at, ok, note, updated_at)
  VALUES ('fathom-webhook', now(), CASE WHEN p_outcome <> 'failed' THEN now() END, p_outcome <> 'failed',
          'Last delivery ' || p_outcome || ' at ' || public.cockpit_form_kuwait_time(now()), now())
  ON CONFLICT (key) DO UPDATE
     SET last_run_at = now(), last_ok_at = CASE WHEN EXCLUDED.ok THEN now() ELSE s0.last_ok_at END, ok = EXCLUDED.ok,
         note = EXCLUDED.note, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'webhookId', p_webhook_id, 'outcome', p_outcome);
END $$;

-- The drafts' one read of the store (section 6.5). Content (the summary, the
-- action items, the transcript) only for a client or candidate recording.
-- Whether the recording may stand for this card is not decided here: the
-- save holds the tie rule (v, cockpit_form_recording_tied), the door checks
-- the store item it reads, and the door can ask the save's rule for the
-- response's seat (v, cockpit_form_recordings_tied). A read: no audit.
CREATE OR REPLACE FUNCTION public.cockpit_form_draft_inputs(p_task_id text, p_recording_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.cockpit_fathom_meetings;
  c public.cockpit_csm_calls;
  f public.cockpit_csm_call_forms;
  v_content boolean;
  v_client jsonb;
  v_last jsonb;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  IF p_recording_id IS NOT NULL AND p_recording_id ~ '^[0-9]{3,20}$' THEN
    SELECT * INTO m FROM public.cockpit_fathom_meetings x WHERE x.recording_id = p_recording_id;
  END IF;
  IF m.recording_id IS NULL THEN
    RAISE EXCEPTION 'That recording is not in the cockpit yet. Check again in a minute.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.cockpit_csm_calls x WHERE x.source = 'fathom' AND x.source_id = p_recording_id;
  v_content := m.class IN ('client','candidate');
  SELECT jsonb_build_object('taskId', p_task_id, 'name', s.data->>'name', 'stage', nullif(btrim(s.data->>'stage'), ''),
                            'happiness', nullif(btrim(s.data->>'happiness'), ''))
    INTO v_client
    FROM public.cockpit_csm_sources s WHERE s.table_name = 'clients' AND s.data->>'taskId' = p_task_id LIMIT 1;
  SELECT * INTO f FROM public.cockpit_csm_call_forms x
   WHERE x.task_id = p_task_id AND x.form_kind = 'checkin' ORDER BY x.submitted_at DESC LIMIT 1;
  IF f.token IS NOT NULL THEN
    v_last := jsonb_build_object(
      'defcon', public.cockpit_fathom_form_answer(f.answers, 'Defcon Status'),
      'priority', public.cockpit_fathom_form_answer(f.answers, 'Task Priority'),
      'notes', nullif(concat_ws(E'\n\n', public.cockpit_fathom_form_answer(f.answers, 'Client Notes'),
                                public.cockpit_fathom_form_answer(f.answers, 'Additional Notes')), ''),
      'at', f.submitted_at);
  END IF;
  RETURN jsonb_build_object(
    'recordingId', m.recording_id,
    'class', m.class,
    'gone', m.gone_at IS NOT NULL OR coalesce(c.status, '') = 'gone',
    'title', m.title,
    'startsAt', m.starts_at,
    'endsAt', m.ends_at,
    'summary', CASE WHEN v_content THEN coalesce(m.summary, c.summary) END,
    'actionItems', CASE WHEN v_content AND jsonb_typeof(m.raw->'action_items') = 'array' THEN m.raw->'action_items' END,
    'transcriptPath', CASE WHEN v_content THEN coalesce(m.transcript_path, c.transcript_path) END,
    'shareUrl', m.share_url,
    'recorderEmail', lower(btrim(m.recorded_by_email)),
    'recorderName', m.recorded_by_name,
    'staff', coalesce((SELECT jsonb_agg(jsonb_build_object('name', p.name, 'email', lower(btrim(p.email)),
                                 'role', public.cockpit_slack_notice_role_of(p.email)) ORDER BY p.id)
                         FROM public.cockpit_people p WHERE p.active), '[]'::jsonb),
    'client', coalesce(v_client, jsonb_build_object('taskId', p_task_id, 'name', NULL, 'stage', NULL, 'happiness', NULL)),
    'lastForm', v_last);
END $$;

-- The forms doctor's store numbers.
CREATE OR REPLACE FUNCTION public.cockpit_forms_doctor_store()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_hours_require_service();
  RETURN jsonb_build_object(
    'csRecordings24h', (SELECT count(*) FROM public.cockpit_fathom_meetings m
                         WHERE coalesce(m.recorder_team, m.raw->'recorded_by'->>'team') = 'Customer Success'
                           AND m.first_seen_at > now() - interval '24 hours'),
    'candidates7d', (SELECT count(*) FROM public.cockpit_csm_calls c
                      WHERE c.candidate AND c.starts_at > now() - interval '7 days'),
    'lastPull', (SELECT s.last_run_at FROM public.cockpit_sync_state s WHERE s.key = 'fathom-pull'),
    'lastDelivery', (SELECT max(d.last_at) FROM public.cockpit_fathom_webhook_deliveries d
                      WHERE d.outcome IN ('stored','ignored')));
END $$;

-- ---------------------------------------------------------------------------
-- 7. Browser RPCs (authenticated only, each gated first)

-- The queue's "Not a 1-1 call": an impromptu recording with no client is set
-- aside with its reason and stays on no client, with no hints (A7.13). The
-- worker and the ingest keep settled_reason; a later attach or "This is
-- {client}" clears it.
CREATE OR REPLACE FUNCTION public.cockpit_csm_candidate_settle(p_unmatched_id bigint, p_reason text, p_same_as text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.cockpit_members;
  boss boolean;
  u public.cockpit_csm_unmatched;
  c public.cockpit_csm_calls;
  v_same text := nullif(btrim(coalesce(p_same_as, '')), '');
BEGIN
  SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users au ON au.id = cm.auth_user_id
   WHERE cm.auth_user_id = auth.uid() AND cm.active AND au.email_confirmed_at IS NOT NULL AND cm.email = lower(btrim(au.email));
  IF m.auth_user_id IS NULL OR NOT ('csm' = ANY(m.roles) OR 'admin' = ANY(m.roles)
                                    OR m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')) THEN
    RAISE EXCEPTION 'Current confirmed client-success access is required' USING ERRCODE = '42501';
  END IF;
  boss := 'admin' = ANY(m.roles) OR m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com');
  SELECT * INTO u FROM public.cockpit_csm_unmatched x WHERE x.id = p_unmatched_id FOR UPDATE;
  IF u.id IS NULL OR u.resolved_at IS NOT NULL OR u.item_kind <> 'call' THEN
    RAISE EXCEPTION 'That item is no longer in the queue.' USING ERRCODE = '22023';
  END IF;
  IF NOT (boss OR lower(u.host_email) = m.email) THEN
    RAISE EXCEPTION 'This item is outside your queue' USING ERRCODE = '42501';
  END IF;
  IF u.item_ref ~ '^[0-9]{1,18}$' THEN
    SELECT * INTO c FROM public.cockpit_csm_calls x WHERE x.id = u.item_ref::bigint FOR UPDATE;
  END IF;
  IF c.id IS NULL OR c.source <> 'fathom' OR NOT c.candidate OR c.task_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only an impromptu recording with no client can be set aside here.' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('part_of_call','onboarding','blueprint','not_client') THEN
    RAISE EXCEPTION 'Pick why this is not a 1-1 call.' USING ERRCODE = '22023';
  END IF;
  IF v_same IS NOT NULL AND (v_same !~ '^[0-9]{3,20}$' OR v_same = c.source_id
       OR NOT EXISTS (SELECT 1 FROM public.cockpit_fathom_meetings x WHERE x.recording_id = v_same)) THEN
    RAISE EXCEPTION 'That recording is not in the cockpit.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.cockpit_csm_calls x SET candidate = false, settled_reason = p_reason, hints = '[]'::jsonb, updated_at = now()
   WHERE x.id = c.id;
  UPDATE public.cockpit_csm_unmatched x
     SET resolved_task_id = NULL, resolved_by = m.email, resolved_at = now(), updated_at = now()
   WHERE x.id = u.id;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('csm.candidate_settled', 'cockpit_csm_calls', c.id::text, m.email, 'client-success', 'supabase',
          jsonb_build_object('candidate', c.candidate, 'settledReason', c.settled_reason),
          jsonb_build_object('candidate', false, 'settledReason', p_reason),
          jsonb_build_object('callId', c.id, 'recordingId', c.source_id, 'reason', p_reason, 'sameAs', v_same));
  RETURN jsonb_build_object('ok', true, 'callId', c.id, 'reason', p_reason);
END $$;

-- The CEO's "Connections for 1-1 notes" card. Only last4 of a key ever
-- leaves the server.
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
    'now', now());
END $$;

-- ---------------------------------------------------------------------------
-- 8. Replaced functions (each from its live body; the changes are marked)

-- 20261011c's body; the frm CTE reads every check-in form (form_kind), and
-- each client gains lastNoteAt and nextCallJoinUrl (https links only). The
-- header's Join covers the call until its end (8.3), and nxt drops a booking
-- at its start, so each client also gains the booking to join: the earliest
-- booked or confirmed one that has not ended (an hour when it has no end),
-- with joinCallAt, joinCallEndsAt (null when unknown) and joinCallUrl. Before
-- any call starts it is nxt's booking; nextCall* keep their meaning.
CREATE OR REPLACE FUNCTION public.cockpit_csm_calls_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE out jsonb;
BEGIN
  WITH v AS (SELECT * FROM public.cockpit_csm_visible_tasks()),
  nxt AS (
    SELECT DISTINCT ON (c.task_id) c.task_id, c.starts_at, c.kind, c.status,
           CASE WHEN c.join_url ~ '^https://' THEN c.join_url END AS join_url
      FROM public.cockpit_csm_calls c JOIN v ON v.task_id=c.task_id
     WHERE c.starts_at>now() AND c.status IN ('booked','confirmed') AND c.source='ghl_appointment'
     ORDER BY c.task_id, c.starts_at),
  jn AS (
    SELECT DISTINCT ON (c.task_id) c.task_id, c.starts_at, c.ends_at,
           CASE WHEN c.join_url ~ '^https://' THEN c.join_url END AS join_url
      FROM public.cockpit_csm_calls c JOIN v ON v.task_id=c.task_id
     WHERE coalesce(c.ends_at, c.starts_at+interval '1 hour')>now() AND c.status IN ('booked','confirmed')
       AND c.source='ghl_appointment'
     ORDER BY c.task_id, c.starts_at),
  lst AS (
    SELECT DISTINCT ON (c.task_id) c.task_id, c.starts_at, c.kind, c.source
      FROM public.cockpit_csm_calls c JOIN v ON v.task_id=c.task_id
     WHERE c.starts_at<=now() AND (c.status IN ('held','showed') OR (c.status='confirmed' AND coalesce(c.ends_at,c.starts_at)<=now()))
     ORDER BY c.task_id, c.starts_at DESC),
  frm AS (
    SELECT DISTINCT ON (f.task_id) f.task_id, f.submitted_at
      FROM public.cockpit_csm_call_forms f JOIN v ON v.task_id=f.task_id
     WHERE f.form_kind='checkin' ORDER BY f.task_id, f.submitted_at DESC),
  cu AS (
    SELECT s.data->>'taskId' task_id, nullif(s.data->>'lastCall','') last_call
      FROM public.cockpit_csm_sources s JOIN v ON v.task_id=s.data->>'taskId' WHERE s.table_name='clients'),
  health AS (
    SELECT jsonb_object_agg(key, jsonb_build_object('ok',ok,'lastOkAt',last_ok_at,'lastRunAt',last_run_at,'note',note)) h
      FROM public.cockpit_sync_state WHERE key LIKE 'csm-%')
  SELECT jsonb_build_object(
    'clients', coalesce(jsonb_object_agg(v.task_id, jsonb_build_object(
      'nextCallAt', nxt.starts_at, 'nextCallKind', nxt.kind, 'nextCallStatus', nxt.status, 'nextCallJoinUrl', nxt.join_url,
      'lastCall', best.at, 'lastCallKind', best.kind, 'lastCallSource', best.src, 'lastNoteAt', fr.submitted_at,
      'joinCallAt', jn.starts_at, 'joinCallEndsAt', jn.ends_at, 'joinCallUrl', jn.join_url
    )) FILTER (WHERE v.task_id IS NOT NULL), '{}'::jsonb),
    'health', coalesce((SELECT h FROM health), '{}'::jsonb),
    'at', now())
  INTO out
  FROM v
  LEFT JOIN nxt ON nxt.task_id=v.task_id
  LEFT JOIN jn ON jn.task_id=v.task_id
  LEFT JOIN frm fr ON fr.task_id=v.task_id
  LEFT JOIN LATERAL (
    SELECT x.at, x.kind, x.src FROM (
      SELECT l.starts_at at, l.kind, l.source src FROM lst l WHERE l.task_id=v.task_id
      UNION ALL SELECT f.submitted_at, 'checkin', 'checkin_form' FROM frm f WHERE f.task_id=v.task_id
      UNION ALL SELECT (cu.last_call||'T09:00:00+03:00')::timestamptz, 'checkin', 'clickup'
        FROM cu WHERE cu.task_id=v.task_id AND cu.last_call ~ '^\d{4}-\d{2}-\d{2}$'
    ) x ORDER BY x.at DESC NULLS LAST LIMIT 1) best ON true;
  RETURN out;
END $$;

-- 20261013112622's body; same_room and form_task_id (a stored 1-1 form's
-- link, 5.2 row 3, A7.2) count as strong client matches, and a Customer
-- Success recording is client service in the sales desk too. The kind list
-- is unchanged: an 'other' call on a client is not client service by its
-- match alone. The internal purpose still comes first. SECURITY INVOKER and
-- the service-only grant stay as they are.
create or replace function public.cockpit_sales_call_exclusion(p_recording_id text, p_title text)
returns text language sql stable security invoker set search_path = '' as $$
  select case when exists (
    select 1 from public.cockpit_sales_call_notes n
    where n.recording_id = p_recording_id and n.notes->>'call_purpose' = 'internal'
      and length(btrim(coalesce(n.notes->>'call_purpose_evidence', ''))) >= 15
  ) then 'internal'
  when coalesce(p_title, '') ~* '(check[ -]?in|onboarding|kick[ -]?off|renewal|brand blueprint|launch call|مكالمة متابعة العميل|مكالمة انطلاق)'
    or exists (
      select 1 from public.cockpit_sales_call_notes n
      where n.recording_id = p_recording_id
        and n.notes->>'call_purpose' = 'client_service'
        and length(btrim(coalesce(n.notes->>'call_purpose_evidence', ''))) >= 15
    )
    or exists (
      select 1 from public.cockpit_csm_calls c
      where c.source = 'fathom' and c.source_id = p_recording_id
        and c.task_id is not null and c.status <> 'gone'
        and c.kind in ('onboarding', 'blueprint', 'launch', 'checkin')
        and c.match_method in ('client_id_field', 'invitee_email', 'appointment_time', 'manual', 'same_room', 'form_task_id')
    )
    or exists (
      select 1 from public.cockpit_fathom_meetings m
      where m.recording_id = p_recording_id
        and coalesce(m.recorder_team, m.raw->'recorded_by'->>'team') = 'Customer Success'
    ) then 'client service' end;
$$;

-- 20261011d's body (the live one); a recording left with no booking takes
-- this client's booking by the attach rule (cockpit_csm_booking_for) and its
-- kind, so the timeline shows one call; the row stops being a candidate and
-- keeps no hints (A7.13); and one csm.manual_match audit row sits beside the
-- match audit row.
CREATE OR REPLACE FUNCTION public.cockpit_csm_manual_match(p_unmatched_id bigint, p_task_id text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE g jsonb; u public.cockpit_csm_unmatched; m public.cockpit_members; boss boolean;
  c public.cockpit_csm_calls; v_link bigint; v_kind text;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  SELECT cm.* INTO m FROM public.cockpit_members cm WHERE cm.auth_user_id=auth.uid() AND cm.active;
  boss := 'admin'=ANY(m.roles) OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com');
  SELECT * INTO u FROM public.cockpit_csm_unmatched WHERE id=p_unmatched_id FOR UPDATE;
  IF u.id IS NULL THEN RAISE EXCEPTION 'That item is no longer in the queue'; END IF;
  IF NOT (boss OR lower(u.host_email)=m.email) THEN
    RAISE EXCEPTION 'This item is outside your queue' USING ERRCODE='42501';
  END IF;
  IF u.resolved_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'already',true,'taskId',u.resolved_task_id); END IF;
  UPDATE public.cockpit_csm_unmatched SET resolved_task_id=p_task_id, resolved_by=g->>'email', resolved_at=now(), updated_at=now() WHERE id=u.id;
  IF u.item_kind='call' THEN
    UPDATE public.cockpit_csm_calls SET task_id=p_task_id, client_name=g->>'clientName', match_method='manual', match_confidence=1,
      linked_call_id=CASE WHEN EXISTS (SELECT 1 FROM public.cockpit_csm_calls a WHERE a.id=linked_call_id AND a.task_id=p_task_id)
                          THEN linked_call_id ELSE NULL END,
      candidate=false, settled_reason=NULL, hints='[]'::jsonb, updated_at=now()
     WHERE id=u.item_ref::bigint
    RETURNING * INTO c;
    IF c.source='fathom' AND c.linked_call_id IS NULL THEN
      v_link := public.cockpit_csm_booking_for(p_task_id, c.room, c.starts_at);
      IF v_link IS NOT NULL THEN
        SELECT a.kind INTO v_kind FROM public.cockpit_csm_calls a WHERE a.id=v_link;
        UPDATE public.cockpit_csm_calls SET linked_call_id=v_link, kind=coalesce(v_kind, kind), updated_at=now()
         WHERE id=c.id
        RETURNING * INTO c;
      END IF;
    END IF;
  ELSE
    UPDATE public.cockpit_csm_call_forms SET task_id=p_task_id, matched_by='manual', updated_at=now() WHERE token=u.item_ref;
  END IF;
  INSERT INTO public.cockpit_csm_match_audit(item_kind,item_ref,task_id,actor_id,actor_email) VALUES(u.item_kind,u.item_ref,p_task_id,(g->>'actorId')::uuid,g->>'email');
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('csm.manual_match', CASE WHEN u.item_kind='call' THEN 'cockpit_csm_calls' ELSE 'cockpit_csm_call_forms' END, u.item_ref,
          g->>'email', 'client-success', 'supabase', NULL, NULL,
          jsonb_build_object('itemKind', u.item_kind, 'itemRef', u.item_ref, 'taskId', p_task_id, 'linkedCallId', c.linked_call_id));
  RETURN jsonb_build_object('ok',true,'taskId',p_task_id,'clientName',g->>'clientName');
END $$;

-- 20261011d's body (the live one); each item says whether its call is a
-- candidate, so the queue shows "Not a 1-1 call" on candidates only. A
-- candidate Fathom no longer has (its call row gone) leaves the list before
-- the limit; its queue row stays as it is.
CREATE OR REPLACE FUNCTION public.cockpit_csm_unmatched_list()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members; boss boolean;
BEGIN
  SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users u ON u.id=cm.auth_user_id
   WHERE cm.auth_user_id=auth.uid() AND cm.active AND u.email_confirmed_at IS NOT NULL AND cm.email=lower(btrim(u.email));
  IF m.auth_user_id IS NULL OR NOT('csm'=ANY(m.roles) OR 'admin'=ANY(m.roles) OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com')) THEN
    RAISE EXCEPTION 'Current confirmed client-success access is required' USING ERRCODE='42501';
  END IF;
  boss := 'admin'=ANY(m.roles) OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com');
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'kind',u.item_kind,'title',u.title,'at',u.at,'reason',u.reason,'hint',u.hint,'host',u.host_email,
      'candidate', CASE WHEN u.item_kind='call' AND u.item_ref ~ '^[0-9]{1,18}$'
                        THEN coalesce((SELECT c.candidate FROM public.cockpit_csm_calls c WHERE c.id=u.item_ref::bigint), false)
                        ELSE false END) ORDER BY u.at DESC NULLS LAST)
    FROM (SELECT * FROM public.cockpit_csm_unmatched q WHERE resolved_at IS NULL AND (boss OR lower(host_email)=m.email)
            AND CASE WHEN q.item_kind='call' AND q.item_ref ~ '^[0-9]{1,18}$'
                     THEN NOT EXISTS (SELECT 1 FROM public.cockpit_csm_calls c
                                       WHERE c.id=q.item_ref::bigint AND c.candidate AND c.status='gone')
                     ELSE true END
          ORDER BY at DESC NULLS LAST LIMIT 100) u), '[]'::jsonb);
END $$;

-- ---------------------------------------------------------------------------
-- 9. Function privileges: revoked from all four roles, then exactly one grant

DO $$
DECLARE f text;
BEGIN
  -- Internal: no role at all (definer functions and the trigger call them).
  FOREACH f IN ARRAY ARRAY[
    'cockpit_call_room(text)', 'cockpit_fathom_class(text,jsonb,text,timestamptz,timestamptz)',
    'cockpit_csm_booking_for(text,text,timestamptz)', 'cockpit_fathom_meetings_privacy()', 'cockpit_forms_key_label(text)',
    'cockpit_forms_webhook_detail(jsonb,timestamptz)', 'cockpit_fathom_form_answer(jsonb,text)',
    'cockpit_fathom_store_item(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- The forms door's, the webhook's and the key script's RPCs: the service key only.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_forms_key_get(text)', 'cockpit_forms_key_put(jsonb)', 'cockpit_forms_key_mark(jsonb)',
    'cockpit_fathom_ingest(jsonb,text)', 'cockpit_fathom_match_inputs(timestamptz,timestamptz,text)',
    'cockpit_fathom_find_link(text)', 'cockpit_fathom_pull_due()', 'cockpit_fathom_pull_mark(boolean,integer,text)',
    'cockpit_fathom_webhook_seen(text,timestamptz)', 'cockpit_fathom_webhook_settle(text,text,text,text)',
    'cockpit_form_draft_inputs(text,text)', 'cockpit_forms_doctor_store()',
    'cockpit_sales_call_exclusion(text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  -- The screens' RPCs: a signed-in seat, gated inside.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_csm_candidate_settle(bigint,text,text)', 'cockpit_forms_keys_status()', 'cockpit_csm_calls_summary()',
    'cockpit_csm_manual_match(bigint,text)', 'cockpit_csm_unmatched_list()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
