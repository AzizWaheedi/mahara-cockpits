-- Review and referral asks (docs/client-asks/PLAN.md). Creative Triage
-- (bldgtotkfmhoxmlzowdx). Additive; applies twice.
--
-- A client success seat asks one client, from the client's page in the
-- cockpit, for a Google review or a referral. The client's Mahara OS portal
-- (mahara-client-portal, same database) shows the ask as a pop-up the next
-- time someone from that client opens it, and its client-tasks cron sends one
-- phone alert to devices with task alerts on. Every step is an event row:
-- asked, push, shown, opened, later, no, done, withdrawn.
--
-- Rules the database keeps, so neither app can skip them:
--  * one open ask of each kind per client; withdraw it to send another;
--  * an ask closes by itself 30 days after it was sent;
--  * a client who said they posted a Google review is not asked again;
--  * a person sees an ask at most twice, at most one ask a day, never again
--    after "No thanks", and "Not now" waits seven days; a tap on the phone
--    alert opens the ask whatever the day's count;
--  * nothing here decides who deserves a review ask: Google forbids asking
--    only happy customers, so the button is the same for every client.
--
-- The cockpit_* functions run as the signed-in seat behind the client gate
-- (cockpit_csm_client_gate, 20261006c). The portal_* functions are for the
-- portal's server key only and check the workspace on every call.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cockpit_client_asks(
  -- The seat's request id, so a double click or a retry sends one ask.
  id uuid PRIMARY KEY,
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name text NOT NULL,
  -- portal_data.workspaces.location_id: the portal workspace it shows in.
  location_id text NOT NULL CHECK (location_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  kind text NOT NULL CHECK (kind IN ('review','referral')),
  note text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 280),
  -- The page the client's main button opens, as it was when sent.
  link text NOT NULL,
  push boolean NOT NULL,
  push_state text NOT NULL CHECK (push_state IN ('off','waiting','sending','sent','no_device','failed')),
  push_claim_until timestamptz,
  push_result jsonb,
  push_at timestamptz,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','done','withdrawn','expired')),
  asked_by uuid NOT NULL,
  asked_by_email text NOT NULL,
  asked_by_name text,
  asked_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closed_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_client_asks_one_open ON public.cockpit_client_asks(task_id,kind) WHERE state='open';
CREATE INDEX IF NOT EXISTS cockpit_client_asks_location ON public.cockpit_client_asks(location_id,state);
CREATE INDEX IF NOT EXISTS cockpit_client_asks_push ON public.cockpit_client_asks(push_state,asked_at) WHERE push_state IN ('waiting','sending');

CREATE TABLE IF NOT EXISTS public.cockpit_client_ask_events(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ask_id uuid NOT NULL REFERENCES public.cockpit_client_asks(id),
  client_name text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('cockpit','portal','push')),
  event text NOT NULL CHECK (event IN ('asked','withdrawn','push','shown','opened','later','no','done')),
  -- The seat's email for cockpit events, the portal person's email for theirs.
  person text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS cockpit_client_ask_events_ask ON public.cockpit_client_ask_events(ask_id,at);
CREATE INDEX IF NOT EXISTS cockpit_client_ask_events_person ON public.cockpit_client_ask_events(person,at) WHERE source='portal';

ALTER TABLE public.cockpit_client_asks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_client_ask_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_client_asks, public.cockpit_client_ask_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_client_asks, public.cockpit_client_ask_events TO service_role;

DROP TRIGGER IF EXISTS cockpit_client_asks_audit ON public.cockpit_client_asks;
CREATE TRIGGER cockpit_client_asks_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_client_asks
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_audit_csm_state();
DROP TRIGGER IF EXISTS cockpit_client_ask_events_audit ON public.cockpit_client_ask_events;
CREATE TRIGGER cockpit_client_ask_events_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_client_ask_events
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_audit_csm_state();

-- The page each kind sends the client to: Mahara's Google review form and
-- the referral programme document (anyone with the link can read it).
CREATE OR REPLACE FUNCTION public.cockpit_client_ask_link(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_kind
    WHEN 'review' THEN 'https://g.page/r/CeRMcUwFPpe7EAI/review'
    WHEN 'referral' THEN 'https://docs.google.com/document/d/15gPXbB98N9TtNqbTa0Ro7O2odcio8XuW0rL-S_qfHcs/edit?usp=sharing'
  END
$$;

-- An open ask past its 30 days is closed as expired before anyone reads it.
CREATE OR REPLACE FUNCTION public.cockpit_client_asks_expire(p_task_id text, p_location_id text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.cockpit_client_asks
     SET state = 'expired', closed_at = asked_at + interval '30 days', closed_by = 'expired', updated_at = now()
   WHERE state = 'open' AND asked_at <= now() - interval '30 days'
     AND (p_task_id IS NULL OR task_id = p_task_id)
     AND (p_location_id IS NULL OR location_id = p_location_id)
$$;

-- What the cockpit shows for one client: its portal workspace (or why there
-- is none), and the last ten asks with every event.
CREATE OR REPLACE FUNCTION public.cockpit_client_asks_view(p_task_id text, p_client_name text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  n integer;
  v_location text;
  v_name text;
  v_status text;
  v_asks jsonb;
BEGIN
  SELECT count(*) INTO n FROM portal_data.workspaces WHERE clickup_id = p_task_id;
  IF n = 1 THEN SELECT location_id, name, status INTO v_location, v_name, v_status FROM portal_data.workspaces WHERE clickup_id = p_task_id; END IF;
  PERFORM public.cockpit_client_asks_expire(p_task_id, NULL);
  SELECT coalesce(jsonb_agg(x.v ORDER BY x.asked_at DESC), '[]'::jsonb) INTO v_asks
    FROM (SELECT a.asked_at, jsonb_build_object(
            'id', a.id, 'kind', a.kind, 'state', a.state, 'note', a.note, 'link', a.link,
            'push', a.push, 'pushState', a.push_state, 'pushResult', a.push_result, 'pushAt', a.push_at,
            'askedAt', a.asked_at, 'askedBy', coalesce(a.asked_by_name, a.asked_by_email),
            'closedAt', a.closed_at, 'closedBy', a.closed_by,
            'events', coalesce((SELECT jsonb_agg(jsonb_build_object('at', e.at, 'source', e.source, 'event', e.event,
                                  'person', e.person, 'detail', e.detail) ORDER BY e.at, e.id)
                                FROM public.cockpit_client_ask_events e WHERE e.ask_id = a.id), '[]'::jsonb)) AS v
            FROM public.cockpit_client_asks a WHERE a.task_id = p_task_id
           ORDER BY a.asked_at DESC LIMIT 10) x;
  RETURN jsonb_build_object(
    'taskId', p_task_id, 'clientName', p_client_name,
    'workspace', CASE WHEN n = 1 THEN jsonb_build_object('locationId', v_location, 'name', v_name, 'status', v_status) END,
    'problem', CASE WHEN n = 0 THEN 'no_workspace' WHEN n > 1 THEN 'two_workspaces'
                    WHEN v_status IN ('Cancelled','Removed from sheet') THEN 'workspace_closed' END,
    'links', jsonb_build_object('review', public.cockpit_client_ask_link('review'), 'referral', public.cockpit_client_ask_link('referral')),
    'asks', v_asks, 'now', now());
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_client_asks_read(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx jsonb;
BEGIN
  ctx := public.cockpit_csm_client_gate(p_task_id);
  RETURN public.cockpit_client_asks_view(p_task_id, ctx->>'clientName');
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_client_ask_send(p_task_id text, p_kind text, p_note text, p_push boolean, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ctx jsonb := public.cockpit_csm_client_gate(p_task_id);
  v_actor uuid := (ctx->>'actorId')::uuid;
  v_email text := ctx->>'email';
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
  v_name text;
  n integer;
  w record;
  prior public.cockpit_client_asks;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('review','referral') THEN RAISE EXCEPTION 'Choose a review or a referral' USING ERRCODE = '22023'; END IF;
  IF p_push IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Send needs a request id and the phone alert choice' USING ERRCODE = '22023'; END IF;
  IF char_length(v_note) > 280 THEN RAISE EXCEPTION 'Keep your line to 280 characters' USING ERRCODE = '22023'; END IF;

  -- A retry of the same request returns what it sent the first time.
  SELECT * INTO prior FROM public.cockpit_client_asks WHERE id = p_request_id;
  IF FOUND THEN
    IF prior.task_id <> p_task_id OR prior.kind <> p_kind OR prior.asked_by <> v_actor THEN
      RAISE EXCEPTION 'This request id belongs to another ask. Reload the client and try again';
    END IF;
    RETURN public.cockpit_client_asks_view(p_task_id, ctx->>'clientName');
  END IF;

  SELECT count(*) INTO n FROM portal_data.workspaces WHERE clickup_id = p_task_id;
  IF n = 0 THEN RAISE EXCEPTION 'This client has no Mahara OS workspace yet, so there is nowhere to show the ask'; END IF;
  IF n > 1 THEN RAISE EXCEPTION 'Two Mahara OS workspaces carry this client card. Fix the Client Data sheet first'; END IF;
  SELECT location_id, status INTO w FROM portal_data.workspaces WHERE clickup_id = p_task_id;
  IF w.status IN ('Cancelled','Removed from sheet') THEN RAISE EXCEPTION 'This client has left (%). Asks go to current clients only', w.status; END IF;

  PERFORM public.cockpit_client_asks_expire(p_task_id, NULL);
  IF EXISTS (SELECT 1 FROM public.cockpit_client_asks WHERE task_id = p_task_id AND kind = p_kind AND state = 'open') THEN
    RAISE EXCEPTION 'A % ask is already waiting in their portal. Withdraw it to send a new one',
      CASE p_kind WHEN 'review' THEN 'review' ELSE 'referral' END;
  END IF;
  IF p_kind = 'review' AND EXISTS (SELECT 1 FROM public.cockpit_client_asks WHERE task_id = p_task_id AND kind = 'review' AND state = 'done') THEN
    RAISE EXCEPTION 'They told us they posted a Google review already, so they are not asked again';
  END IF;

  SELECT coalesce(nullif(btrim(m.name), ''), nullif(btrim(p.name), '')) INTO v_name
    FROM public.cockpit_members m
    LEFT JOIN public.cockpit_people p ON lower(btrim(p.email)) = m.email
   WHERE m.auth_user_id = v_actor
   LIMIT 1;

  INSERT INTO public.cockpit_client_asks(id, task_id, client_name, location_id, kind, note, link, push, push_state,
                                         asked_by, asked_by_email, asked_by_name)
  VALUES (p_request_id, p_task_id, ctx->>'clientName', w.location_id, p_kind, v_note, public.cockpit_client_ask_link(p_kind),
          p_push, CASE WHEN p_push THEN 'waiting' ELSE 'off' END, v_actor, v_email, v_name);
  INSERT INTO public.cockpit_client_ask_events(ask_id, client_name, source, event, person, detail)
  VALUES (p_request_id, ctx->>'clientName', 'cockpit', 'asked', v_email,
          jsonb_build_object('push', p_push, 'note', v_note IS NOT NULL));
  RETURN public.cockpit_client_asks_view(p_task_id, ctx->>'clientName');
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_client_ask_withdraw(p_task_id text, p_ask_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ctx jsonb := public.cockpit_csm_client_gate(p_task_id);
  a public.cockpit_client_asks;
BEGIN
  SELECT * INTO a FROM public.cockpit_client_asks WHERE id = p_ask_id AND task_id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That ask is not on this client'; END IF;
  IF a.state = 'open' AND a.asked_at > now() - interval '30 days' THEN
    UPDATE public.cockpit_client_asks
       SET state = 'withdrawn', closed_at = now(), closed_by = ctx->>'email', updated_at = now(),
           push_state = CASE WHEN push_state = 'waiting' THEN 'off' ELSE push_state END
     WHERE id = a.id;
    INSERT INTO public.cockpit_client_ask_events(ask_id, client_name, source, event, person)
    VALUES (a.id, a.client_name, 'cockpit', 'withdrawn', ctx->>'email');
  END IF;
  RETURN public.cockpit_client_asks_view(p_task_id, ctx->>'clientName');
END $$;

-- The portal's side. p_person is the signed-in client's email; the portal has
-- already checked the session, the workspace and its ClickUp card.
CREATE OR REPLACE FUNCTION public.portal_client_ask_person(p_person text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text := lower(btrim(coalesce(p_person, '')));
BEGIN
  IF v !~ '^[^@\s]{1,128}@[^@\s]{1,253}$' THEN RAISE EXCEPTION 'client_ask_invalid_person' USING ERRCODE = '22023'; END IF;
  RETURN v;
END $$;

-- The ask this person should see now, or null with the reason.
CREATE OR REPLACE FUNCTION public.portal_client_ask_for_person(p_location_id text, p_clickup_id text, p_person text, p_ask_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_person text := public.portal_client_ask_person(p_person);
  a record;
BEGIN
  IF p_location_id IS NULL OR p_clickup_id IS NULL OR p_location_id !~ '^[A-Za-z0-9_-]{1,100}$' OR p_clickup_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'client_ask_invalid_workspace' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cockpit_client_asks_expire(NULL, p_location_id);
  -- One ask a day: a deep link from the phone alert is the only way past it.
  IF p_ask_id IS NULL AND EXISTS (
    SELECT 1 FROM public.cockpit_client_ask_events e JOIN public.cockpit_client_asks x ON x.id = e.ask_id
     WHERE e.source = 'portal' AND e.person = v_person AND e.event = 'shown' AND e.at > now() - interval '20 hours'
       AND x.location_id = p_location_id) THEN
    RETURN jsonb_build_object('ask', NULL, 'reason', 'shown_today');
  END IF;
  SELECT x.*, s.shows, s.opened, s.later_at
    INTO a
    FROM public.cockpit_client_asks x
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE e.event = 'shown') AS shows,
             bool_or(e.event = 'opened') AS opened,
             max(e.at) FILTER (WHERE e.event = 'later') AS later_at,
             bool_or(e.event IN ('no','done')) AS finished
        FROM public.cockpit_client_ask_events e
       WHERE e.ask_id = x.id AND e.source = 'portal' AND e.person = v_person) s
   WHERE x.location_id = p_location_id AND x.task_id = p_clickup_id AND x.state = 'open'
     AND (p_ask_id IS NULL OR x.id = p_ask_id)
     AND NOT coalesce(s.finished, false)
     -- A referral is answered once they open the programme or WhatsApp.
     AND NOT (x.kind = 'referral' AND coalesce(s.opened, false))
     AND (p_ask_id IS NOT NULL OR (s.shows < 2 AND (s.later_at IS NULL OR s.later_at <= now() - interval '7 days')))
   ORDER BY x.asked_at
   LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ask', NULL, 'reason', 'nothing_waiting'); END IF;
  RETURN jsonb_build_object('ask', jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'note', a.note, 'link', a.link, 'askedAt', a.asked_at,
    'from', nullif(split_part(btrim(coalesce(a.asked_by_name, '')), ' ', 1), ''),
    -- Someone who opened the review form earlier is asked only whether they posted it.
    'stage', CASE WHEN a.kind = 'review' AND coalesce(a.opened, false) THEN 'confirm' ELSE 'ask' END),
    'reason', NULL);
END $$;

-- A staff preview: the open ask of that kind as the client would see it, or null.
CREATE OR REPLACE FUNCTION public.portal_client_ask_preview(p_location_id text, p_clickup_id text, p_kind text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('ask', (
    SELECT jsonb_build_object('id', x.id, 'kind', x.kind, 'note', x.note, 'link', x.link, 'askedAt', x.asked_at,
             'from', nullif(split_part(btrim(coalesce(x.asked_by_name, '')), ' ', 1), ''), 'stage', 'ask')
      FROM public.cockpit_client_asks x
     WHERE x.location_id = p_location_id AND x.task_id = p_clickup_id AND x.kind = p_kind
       AND x.state = 'open' AND x.asked_at > now() - interval '30 days'
     ORDER BY x.asked_at DESC LIMIT 1),
    'link', public.cockpit_client_ask_link(p_kind))
$$;

-- What a person did with an ask. Answers on a closed ask are kept out quietly.
CREATE OR REPLACE FUNCTION public.portal_client_ask_record(p_location_id text, p_clickup_id text, p_ask_id uuid, p_person text, p_event text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_person text := public.portal_client_ask_person(p_person);
  v_detail jsonb := '{}'::jsonb;
  a public.cockpit_client_asks;
BEGIN
  IF p_event IS NULL OR p_event NOT IN ('shown','opened','later','no','done') THEN RAISE EXCEPTION 'client_ask_invalid_event' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_detail->'target') = 'string' AND p_detail->>'target' IN ('google','programme','whatsapp','email') THEN
    v_detail := jsonb_build_object('target', p_detail->>'target');
  END IF;
  IF jsonb_typeof(p_detail->'via') = 'string' AND p_detail->>'via' = 'push' THEN v_detail := v_detail || '{"via":"push"}'::jsonb; END IF;
  PERFORM public.cockpit_client_asks_expire(NULL, p_location_id);
  SELECT * INTO a FROM public.cockpit_client_asks WHERE id = p_ask_id FOR UPDATE;
  IF NOT FOUND OR a.location_id <> p_location_id OR a.task_id <> p_clickup_id THEN RAISE EXCEPTION 'client_ask_not_in_workspace' USING ERRCODE = '42501'; END IF;
  IF p_event = 'done' AND a.kind <> 'review' THEN RAISE EXCEPTION 'client_ask_invalid_event' USING ERRCODE = '22023'; END IF;
  IF a.state <> 'open' THEN RETURN jsonb_build_object('ok', true, 'state', a.state, 'recorded', false); END IF;
  -- One shown a day per person and ask; a page reload is not a second showing.
  IF p_event = 'shown' AND EXISTS (SELECT 1 FROM public.cockpit_client_ask_events WHERE ask_id = a.id AND source = 'portal'
                                     AND person = v_person AND event = 'shown' AND at > now() - interval '20 hours') THEN
    RETURN jsonb_build_object('ok', true, 'state', a.state, 'recorded', false);
  END IF;
  IF (SELECT count(*) FROM public.cockpit_client_ask_events WHERE ask_id = a.id AND source = 'portal' AND person = v_person) >= 30 THEN
    RETURN jsonb_build_object('ok', true, 'state', a.state, 'recorded', false);
  END IF;
  INSERT INTO public.cockpit_client_ask_events(ask_id, client_name, source, event, person, detail)
  VALUES (a.id, a.client_name, 'portal', p_event, v_person, v_detail);
  IF p_event = 'done' THEN
    UPDATE public.cockpit_client_asks SET state = 'done', closed_at = now(), closed_by = v_person, updated_at = now() WHERE id = a.id;
    RETURN jsonb_build_object('ok', true, 'state', 'done', 'recorded', true);
  END IF;
  RETURN jsonb_build_object('ok', true, 'state', a.state, 'recorded', true);
END $$;

-- Phone alerts: the portal's client-tasks cron claims asks still waiting for
-- one (a five-minute lease), sends, and reports back. An alert not sent within
-- a day is never sent: it is marked failed with that reason.
CREATE OR REPLACE FUNCTION public.portal_client_asks_push_claim(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'client_ask_invalid_limit' USING ERRCODE = '22023'; END IF;
  UPDATE public.cockpit_client_asks
     SET push_state = 'failed', push_result = jsonb_build_object('reason', 'not_sent_within_a_day'), push_at = now(), updated_at = now()
   WHERE push_state IN ('waiting','sending') AND asked_at <= now() - interval '1 day';
  UPDATE public.cockpit_client_asks
     SET push_state = 'off', push_result = jsonb_build_object('reason', 'ask_closed_first'), push_at = now(), updated_at = now()
   WHERE push_state IN ('waiting','sending') AND state <> 'open';
  WITH due AS (
    SELECT id FROM public.cockpit_client_asks
     WHERE state = 'open' AND (push_state = 'waiting' OR push_state = 'sending' AND push_claim_until < now())
     ORDER BY asked_at LIMIT p_limit FOR UPDATE SKIP LOCKED),
  claimed AS (
    UPDATE public.cockpit_client_asks x SET push_state = 'sending', push_claim_until = now() + interval '5 minutes', updated_at = now()
      FROM due WHERE x.id = due.id
    RETURNING x.id, x.location_id, x.task_id, x.kind, x.asked_by_name, x.asked_at)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'locationId', location_id, 'clickupId', task_id, 'kind', kind,
           'from', nullif(split_part(btrim(coalesce(asked_by_name, '')), ' ', 1), ''), 'askedAt', asked_at) ORDER BY asked_at), '[]'::jsonb)
    INTO v FROM claimed;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.portal_client_ask_push_done(p_ask_id uuid, p_location_id text, p_state text, p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.cockpit_client_asks;
  v_result jsonb := '{}'::jsonb;
  k text;
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('sent','no_device','failed') THEN RAISE EXCEPTION 'client_ask_invalid_push_state' USING ERRCODE = '22023'; END IF;
  -- Counts and one reason only: no device, address or person leaves the portal.
  FOREACH k IN ARRAY ARRAY['devices','accepted','failed','uncertain','expired'] LOOP
    IF jsonb_typeof(p_result->k) = 'number' THEN v_result := v_result || jsonb_build_object(k, least(greatest(round((p_result->>k)::numeric)::integer, 0), 1000)); END IF;
  END LOOP;
  IF jsonb_typeof(p_result->'reason') = 'string' AND p_result->>'reason' ~ '^[a-z_]{1,40}$' THEN v_result := v_result || jsonb_build_object('reason', p_result->>'reason'); END IF;
  SELECT * INTO a FROM public.cockpit_client_asks WHERE id = p_ask_id FOR UPDATE;
  IF NOT FOUND OR a.location_id <> p_location_id THEN RAISE EXCEPTION 'client_ask_not_in_workspace' USING ERRCODE = '42501'; END IF;
  IF a.push_state <> 'sending' THEN RETURN jsonb_build_object('ok', true, 'pushState', a.push_state, 'recorded', false); END IF;
  UPDATE public.cockpit_client_asks SET push_state = p_state, push_result = v_result, push_at = now(), push_claim_until = NULL, updated_at = now()
   WHERE id = a.id;
  INSERT INTO public.cockpit_client_ask_events(ask_id, client_name, source, event, detail)
  VALUES (a.id, a.client_name, 'push', 'push', v_result || jsonb_build_object('state', p_state));
  RETURN jsonb_build_object('ok', true, 'pushState', p_state, 'recorded', true);
END $$;

-- Whether a phone alert for this ask may still show its text: the ask is open
-- in that workspace and the person has not answered it.
CREATE OR REPLACE FUNCTION public.portal_client_ask_display(p_location_id text, p_clickup_id text, p_ask_id uuid, p_person text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cockpit_client_asks x
     WHERE x.id = p_ask_id AND x.location_id = p_location_id AND x.task_id = p_clickup_id
       AND x.state = 'open' AND x.asked_at > now() - interval '30 days'
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_client_ask_events e
                        WHERE e.ask_id = x.id AND e.source = 'portal' AND e.event IN ('no','done')
                          AND e.person = public.portal_client_ask_person(p_person)))
$$;

REVOKE ALL ON FUNCTION public.cockpit_client_ask_link(text), public.cockpit_client_asks_expire(text,text),
  public.cockpit_client_asks_view(text,text), public.portal_client_ask_person(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_csm_client_asks_read(text), public.cockpit_csm_client_ask_send(text,text,text,boolean,uuid),
  public.cockpit_csm_client_ask_withdraw(text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_client_asks_read(text), public.cockpit_csm_client_ask_send(text,text,text,boolean,uuid),
  public.cockpit_csm_client_ask_withdraw(text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_client_ask_for_person(text,text,text,uuid), public.portal_client_ask_preview(text,text,text),
  public.portal_client_ask_record(text,text,uuid,text,text,jsonb), public.portal_client_asks_push_claim(integer),
  public.portal_client_ask_push_done(uuid,text,text,jsonb), public.portal_client_ask_display(text,text,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_client_ask_for_person(text,text,text,uuid), public.portal_client_ask_preview(text,text,text),
  public.portal_client_ask_record(text,text,uuid,text,text,jsonb), public.portal_client_asks_push_claim(integer),
  public.portal_client_ask_push_done(uuid,text,text,jsonb), public.portal_client_ask_display(text,text,uuid,text)
  TO service_role;

COMMIT;
