-- Slack notices: one outbox for the kickoff and the Brand Blueprint
-- (docs/forms/STAGE1-CONTRACT.md 2.1, docs/forms/PLAN.md 1.3 and 4.8).
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive; applies twice.
--
-- 1. cockpit_slack_channels: the channels a notice may use. A row is added
--    as "checking" and the sender checks the bot is in it; a channel is
--    marked removed, never deleted.
-- 2. cockpit_slack_notice_settings: one row per notice kind (and per kickoff
--    variant): on or off, the channel, who to tag (seat rules and named
--    people). Every routing read happens at send time.
-- 3. cockpit_forms_editors: the seats the CEO or an admin lets change the
--    notices and routing, beside the CEO, admins and a forms_editor role.
-- 4. cockpit_slack_notices: the outbox. Triggers on cockpit_client_onboarding
--    and cockpit_creative_outbox queue it, the sweep backs them up, and the
--    cockpit-notices Edge Function claims, posts and records each row. A
--    state-move guard allows only the sender's moves; nothing is deleted.
--
-- Row security is on for all four tables, every browser and default grant is
-- revoked, and the service role may only read them: every write goes through
-- the SECURITY DEFINER functions below, and every write leaves an audit row
-- in cockpit_audit_log (by trigger). The kick reads its secret from the
-- vault, and pg_cron, pg_net and the vault are touched only where they exist.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables

CREATE TABLE IF NOT EXISTS public.cockpit_slack_channels (
  id         text PRIMARY KEY CHECK (id ~ '^[CG][A-Z0-9]{8,12}$'),
  -- Without the "#".
  name       text CHECK (name IS NULL OR (char_length(name) BETWEEN 1 AND 80 AND name !~ '[<>&#\s]')),
  -- Null until the sender has checked it.
  private    boolean,
  state      text NOT NULL DEFAULT 'checking' CHECK (state IN ('checking','ok','refused','removed')),
  -- The plain sentence of the last check.
  note       text CHECK (note IS NULL OR char_length(note) <= 240),
  checked_at timestamptz,
  added_by   text NOT NULL CHECK (btrim(added_by) <> ''),
  added_at   timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cockpit_slack_notice_settings (
  kind           text PRIMARY KEY CHECK (kind IN ('kickoff','kickoff.late','kickoff.second','kickoff.updated',
                   'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer')),
  -- "on" is a reserved word; the browser sees it as "on".
  enabled        boolean NOT NULL DEFAULT true,
  channel        text REFERENCES public.cockpit_slack_channels(id),
  -- The seats to tag. "people" is mention_people not empty; "none" is both empty.
  mention_rule   text[] NOT NULL DEFAULT '{}'::text[]
                   CHECK (mention_rule <@ ARRAY['seat:creative','seat:csm','seat:systems_manager']::text[]),
  -- cockpit_people ids, resolved to Slack at send time.
  mention_people bigint[] NOT NULL DEFAULT '{}'::bigint[] CHECK (cardinality(mention_people) <= 10),
  updated_by     text NOT NULL CHECK (btrim(updated_by) <> ''),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- Only the three top-level kinds name a channel; replies post in their
  -- parent's thread, and the two variant rows post where the kickoff posts.
  CHECK ((kind IN ('kickoff','blueprint.close','blueprint.media')) = (channel IS NOT NULL)),
  -- The variant rows only choose tags.
  CHECK (kind NOT IN ('kickoff.late','kickoff.second') OR enabled)
);

CREATE TABLE IF NOT EXISTS public.cockpit_forms_editors (
  member_id uuid PRIMARY KEY REFERENCES public.cockpit_members(id) ON DELETE CASCADE,
  added_by  text NOT NULL CHECK (btrim(added_by) <> ''),
  added_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cockpit_slack_notices (
  -- The marker in Slack is "Ref CN-" || left(id::text, 8).
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated',
                    'blueprint.media','blueprint.offer','rehearsal')),
  dedupe_key      text NOT NULL UNIQUE CHECK (char_length(dedupe_key) BETWEEN 3 AND 200),
  task_id         text CHECK (task_id IS NULL OR task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name     text,
  parent_id       uuid REFERENCES public.cockpit_slack_notices(id),
  -- Names, ids, times and links only (contract section 3).
  facts           jsonb NOT NULL DEFAULT '{}'::jsonb
                    CHECK (jsonb_typeof(facts) = 'object' AND octet_length(facts::text) <= 16384),
  variant         text CHECK (variant IS NULL OR variant ~ '^[a-z_]{1,20}$'),
  -- The id the sender asked for, and the id Slack answered with.
  target          text CHECK (target IS NULL OR target ~ '^[CGUW][A-Z0-9]{8,12}$'),
  channel         text CHECK (channel IS NULL OR channel ~ '^[CGD][A-Z0-9]{8,12}$'),
  -- Kept for the audit; never shown to a browser.
  text            text CHECK (text IS NULL OR char_length(text) <= 4000),
  blocks          jsonb CHECK (blocks IS NULL OR jsonb_typeof(blocks) = 'array'),
  state           text NOT NULL DEFAULT 'queued'
                    CHECK (state IN ('queued','sending','posted','failed','unknown','skipped','muted')),
  -- Counted retries only (outcome retry); waiting is never an attempt.
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at      timestamptz,
  finished_at     timestamptz,
  -- The last reconcile look at an unknown.
  checked_at      timestamptz,
  slack_ts        text CHECK (slack_ts IS NULL OR slack_ts ~ '^[0-9]+\.[0-9]+$'),
  permalink       text CHECK (permalink IS NULL OR permalink ~ '^https://[a-z0-9.-]+\.slack\.com/'),
  -- A plain sentence.
  error           text CHECK (error IS NULL OR char_length(error) <= 240),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (state <> 'posted' OR (slack_ts IS NOT NULL AND channel IS NOT NULL)),
  CHECK (kind = 'rehearsal' OR task_id IS NOT NULL),
  -- A rehearsal never targets a channel.
  CHECK (kind <> 'rehearsal' OR target IS NULL OR target ~ '^[UW]')
);

CREATE INDEX IF NOT EXISTS cockpit_slack_notices_due
  ON public.cockpit_slack_notices (next_attempt_at) WHERE state = 'queued';
CREATE INDEX IF NOT EXISTS cockpit_slack_notices_task
  ON public.cockpit_slack_notices (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cockpit_slack_notices_open
  ON public.cockpit_slack_notices (state, created_at) WHERE state IN ('queued','sending','unknown');
CREATE INDEX IF NOT EXISTS cockpit_slack_notices_parent
  ON public.cockpit_slack_notices (parent_id) WHERE parent_id IS NOT NULL;

ALTER TABLE public.cockpit_slack_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_slack_notice_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_forms_editors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_slack_notices ENABLE ROW LEVEL SECURITY;
-- No policies: the browser reaches these only through the functions below.
REVOKE ALL ON public.cockpit_slack_channels, public.cockpit_slack_notice_settings,
  public.cockpit_forms_editors, public.cockpit_slack_notices FROM PUBLIC, anon, authenticated, service_role;
-- The guardian reads; every write goes through the definer functions.
GRANT SELECT ON public.cockpit_slack_channels, public.cockpit_slack_notice_settings,
  public.cockpit_forms_editors, public.cockpit_slack_notices TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Small helpers (internal: no role may execute them)

-- A safe cast: NULL when empty or not a time.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_ts(p text)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v timestamptz;
BEGIN
  IF p IS NULL OR btrim(p) = '' THEN RETURN NULL; END IF;
  v := btrim(p)::timestamptz;
  IF NOT isfinite(v) THEN RETURN NULL; END IF;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

-- A stored time in facts: ISO 8601 in UTC, so every reader parses it alike.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_iso(p timestamptz)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p IS NULL OR NOT isfinite(p) THEN NULL
              ELSE to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
$$;

-- "The card looks done": the stage pattern is byte for byte BLUEPRINT_ON in
-- apps/client-success-cockpit/src/forms/formStatus.ts (flag i, so ~*), and
-- ClickUp says the card changed at or after the kickoff.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_card_done(p_status text, p_card_updated timestamptz, p_since timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(p_status, '') ~* 'brand blueprint booked|launch booked|ready for launch|^\s*active\s*$'
     AND p_card_updated IS NOT NULL AND p_since IS NOT NULL AND p_card_updated >= p_since
$$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_shape(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_kind IN ('kickoff','blueprint.close','blueprint.media') THEN 'post'
    WHEN p_kind IN ('kickoff.updated','blueprint.updated','blueprint.offer') THEN 'reply'
    WHEN p_kind IN ('kickoff.late','kickoff.second') THEN 'variant'
    WHEN p_kind = 'rehearsal' THEN 'test'
  END
$$;

-- The words a refusal uses for a notice (the labels of the Settings card).
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
    ELSE p_kind
  END
$$;

-- The role label of a seat, for everything the team sees.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_role_of(p_email text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_email text := lower(btrim(p_email)); v_roles text[];
BEGIN
  IF v_email IS NULL OR v_email = '' THEN RETURN NULL; END IF;
  IF v_email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com') THEN RETURN 'the CEO'; END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_people pp
              WHERE pp.active AND lower(btrim(pp.email)) = v_email AND lower(btrim(pp.role)) = 'systems manager') THEN
    RETURN 'the systems manager';
  END IF;
  SELECT m.roles INTO v_roles FROM public.cockpit_members m
   WHERE lower(btrim(m.email)) = v_email ORDER BY m.active DESC, m.updated_at DESC LIMIT 1;
  RETURN CASE
    WHEN 'csm' = ANY(v_roles) THEN 'the CSM'
    WHEN 'creative' = ANY(v_roles) THEN 'the creative director'
    WHEN 'media_buyer' = ANY(v_roles) THEN 'the media buyer'
    WHEN 'editor' = ANY(v_roles) THEN 'the video editor'
    WHEN 'admin' = ANY(v_roles) THEN 'an admin'
    ELSE 'a team member'
  END;
END $$;

-- A seat as an editor list shows it: first name and role.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_seat_label(p_email text, p_name text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_email text := lower(btrim(coalesce(p_email, ''))); v_first text; v_role text;
BEGIN
  SELECT nullif(split_part(btrim(pp.name), ' ', 1), ''), nullif(btrim(pp.role), '')
    INTO v_first, v_role
    FROM public.cockpit_people pp
   WHERE pp.active AND lower(btrim(pp.email)) = v_email
   ORDER BY pp.id LIMIT 1;
  IF v_first IS NULL AND nullif(btrim(p_name), '') IS NOT NULL AND p_name NOT LIKE '%@%' THEN
    v_first := split_part(btrim(p_name), ' ', 1);
  END IF;
  v_first := coalesce(v_first, nullif(split_part(v_email, '@', 1), ''), 'A seat');
  IF v_role IS NULL THEN
    -- "the media buyer" reads "Media buyer", as the people list writes roles.
    v_role := regexp_replace(coalesce(public.cockpit_slack_notice_role_of(v_email), 'a team member'), '^(the|an|a) ', '');
    v_role := upper(left(v_role, 1)) || substr(v_role, 2);
  END IF;
  RETURN v_first || ', ' || v_role;
END $$;

-- Who a notice tags, resolved now (contract 3.9). Seat rules come from the
-- seats (active, confirmed, not admin, the role, the client or no client
-- list), joined to the active people list and its Slack ids; the systems
-- manager is an admin seat, so it comes from the people list by role. A rule
-- that finds nobody gives one entry marked missing. Deduped by person, or by
-- address when there is no person row. p_client NULL counts every seat.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_mentions(p_rules text[], p_people bigint[], p_client text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}'::text[];
  v_rule text;
  v_role text;
  v_label text;
  v_found integer;
  v_key text;
  v_id bigint;
  rec record;
BEGIN
  FOREACH v_rule IN ARRAY coalesce(p_rules, '{}'::text[]) LOOP
    v_found := 0;
    IF v_rule IN ('seat:creative','seat:csm') THEN
      v_role := CASE v_rule WHEN 'seat:creative' THEN 'creative' ELSE 'csm' END;
      v_label := CASE v_rule WHEN 'seat:creative' THEN 'the creative director' ELSE 'the CSM' END;
      FOR rec IN
        SELECT DISTINCT ON (coalesce(pp.id::text, 'e:' || lower(btrim(m.email))))
               pp.id AS person_id, lower(btrim(coalesce(pp.email, m.email))) AS email, sid.slack_user_id
          FROM public.cockpit_members m
          JOIN auth.users u ON u.id = m.auth_user_id AND u.email_confirmed_at IS NOT NULL
          LEFT JOIN public.cockpit_people pp
                 ON pp.active AND lower(btrim(pp.email)) = lower(btrim(m.email))
          LEFT JOIN public.cockpit_eod_radar_slack_ids sid
                 ON sid.person_id = pp.id AND sid.state = 'ok' AND sid.slack_user_id IS NOT NULL
         WHERE m.active
           AND NOT ('admin' = ANY(m.roles))
           AND v_role = ANY(m.roles)
           AND (p_client IS NULL OR cardinality(m.clients) = 0 OR EXISTS (
                 SELECT 1 FROM unnest(m.clients) AS c(n) WHERE lower(btrim(c.n)) = lower(btrim(p_client))))
         ORDER BY coalesce(pp.id::text, 'e:' || lower(btrim(m.email))), sid.slack_user_id NULLS LAST
      LOOP
        v_found := v_found + 1;
        v_key := coalesce(rec.person_id::text, 'e:' || rec.email);
        CONTINUE WHEN v_key = ANY(v_seen);
        v_seen := v_seen || v_key;
        v_out := v_out || jsonb_build_array(jsonb_build_object('rule', v_rule, 'personId', rec.person_id,
          'label', v_label, 'slackId', rec.slack_user_id, 'email', rec.email, 'missing', false));
      END LOOP;
    ELSIF v_rule = 'seat:systems_manager' THEN
      v_label := 'the systems manager';
      FOR rec IN
        SELECT pp.id AS person_id, lower(btrim(pp.email)) AS email,
               (SELECT sid.slack_user_id FROM public.cockpit_eod_radar_slack_ids sid
                 WHERE sid.person_id = pp.id AND sid.state = 'ok' AND sid.slack_user_id IS NOT NULL) AS slack_user_id
          FROM public.cockpit_people pp
         WHERE pp.active AND lower(btrim(pp.role)) = 'systems manager'
         ORDER BY pp.id
      LOOP
        v_found := v_found + 1;
        v_key := rec.person_id::text;
        CONTINUE WHEN v_key = ANY(v_seen);
        v_seen := v_seen || v_key;
        v_out := v_out || jsonb_build_array(jsonb_build_object('rule', v_rule, 'personId', rec.person_id,
          'label', v_label, 'slackId', rec.slack_user_id, 'email', nullif(rec.email, ''), 'missing', false));
      END LOOP;
    ELSE
      CONTINUE;
    END IF;
    IF v_found = 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('rule', v_rule, 'personId', NULL,
        'label', v_label, 'slackId', NULL, 'email', NULL, 'missing', true));
    END IF;
  END LOOP;

  FOREACH v_id IN ARRAY coalesce(p_people, '{}'::bigint[]) LOOP
    SELECT pp.id AS person_id, lower(btrim(pp.email)) AS email,
           CASE WHEN nullif(btrim(pp.role), '') IS NULL THEN 'a team member'
                WHEN btrim(pp.role) = upper(btrim(pp.role)) THEN 'the ' || btrim(pp.role)
                ELSE 'the ' || lower(btrim(pp.role)) END AS label,
           (SELECT sid.slack_user_id FROM public.cockpit_eod_radar_slack_ids sid
             WHERE sid.person_id = pp.id AND sid.state = 'ok' AND sid.slack_user_id IS NOT NULL) AS slack_user_id
      INTO rec
      FROM public.cockpit_people pp WHERE pp.id = v_id AND pp.active;
    IF NOT FOUND THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('rule', 'people', 'personId', v_id,
        'label', 'a team member', 'slackId', NULL, 'email', NULL, 'missing', true));
      CONTINUE;
    END IF;
    CONTINUE WHEN rec.person_id::text = ANY(v_seen);
    v_seen := v_seen || rec.person_id::text;
    v_out := v_out || jsonb_build_array(jsonb_build_object('rule', 'people', 'personId', rec.person_id,
      'label', rec.label, 'slackId', rec.slack_user_id, 'email', nullif(rec.email, ''), 'missing', false));
  END LOOP;
  RETURN v_out;
END $$;

-- The mentions a claimed row carries: main from its own kind; for a kickoff
-- also late and second from the two variant rows; a rehearsal tags nobody.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_claim_mentions(p_kind text, p_client text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF p_kind = 'rehearsal' THEN RETURN jsonb_build_object('main', '[]'::jsonb); END IF;
  v := jsonb_build_object('main', coalesce((SELECT public.cockpit_slack_notice_mentions(s.mention_rule, s.mention_people, p_client)
                                              FROM public.cockpit_slack_notice_settings s WHERE s.kind = p_kind), '[]'::jsonb));
  IF p_kind = 'kickoff' THEN
    v := v || jsonb_build_object(
      'late', coalesce((SELECT public.cockpit_slack_notice_mentions(s.mention_rule, s.mention_people, p_client)
                          FROM public.cockpit_slack_notice_settings s WHERE s.kind = 'kickoff.late'), '[]'::jsonb),
      'second', coalesce((SELECT public.cockpit_slack_notice_mentions(s.mention_rule, s.mention_people, p_client)
                            FROM public.cockpit_slack_notice_settings s WHERE s.kind = 'kickoff.second'), '[]'::jsonb));
  END IF;
  RETURN v;
END $$;

-- Where a top-level notice of a kind posts: its own channel, or for a reply
-- that could not go in a thread, the channel of the notice it answers.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_target(p_kind text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.channel FROM public.cockpit_slack_notice_settings s
   WHERE s.kind = CASE p_kind WHEN 'kickoff.updated' THEN 'kickoff'
                              WHEN 'blueprint.updated' THEN 'blueprint.close'
                              WHEN 'blueprint.offer' THEN 'blueprint.close'
                              ELSE p_kind END
$$;

-- Insert one notice once. NULL when the key existed.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_queue(p_kind text, p_dedupe text, p_task text, p_client text,
  p_facts jsonb, p_parent uuid, p_state text, p_error text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_state text := coalesce(p_state, 'queued');
BEGIN
  INSERT INTO public.cockpit_slack_notices(kind, dedupe_key, task_id, client_name, parent_id, facts, state, error, finished_at)
  VALUES (p_kind, p_dedupe, p_task, p_client, p_parent, coalesce(p_facts, '{}'::jsonb), v_state,
          left(nullif(btrim(p_error), ''), 240), CASE WHEN v_state = 'skipped' THEN now() END)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Facts (contract section 3): names, ids, times and links only

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_kickoff_facts(p_task text, p_client text, p_forms jsonb, p_old_response text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_k jsonb := coalesce(p_forms->'kickoff', '{}'::jsonb);
  v_rid text := nullif(v_k->>'response_id', '');
  v_old text := nullif(btrim(p_old_response), '');
  v_other boolean := v_old IS NOT NULL AND v_old IS DISTINCT FROM v_rid;
BEGIN
  RETURN jsonb_build_object(
    'taskId', p_task,
    'client', p_client,
    'responseId', v_rid,
    'formId', nullif(v_k->>'form_id', ''),
    'submittedAt', v_k->>'submitted_at',
    'second', v_other OR coalesce((SELECT s.second FROM public.cockpit_csm_form_sends s WHERE s.response_id = v_rid), false),
    'previousResponseId', CASE WHEN v_other THEN v_old END);
END $$;

-- The old Typeform Blueprint (until A1 removes it).
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_typeform_facts(p_task text, p_client text, p_forms jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'taskId', p_task, 'client', p_client, 'source', 'typeform', 'outboxId', NULL::text,
    'responseId', nullif(p_forms->'blueprint'->>'response_id', ''), 'settled', NULL::text,
    'closedAt', p_forms->'blueprint'->>'submitted_at', 'closedByRole', NULL::text,
    'launchTaskId', NULL::text, 'mapPhase', NULL::integer, 'service', NULL::text)
$$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_close_facts(p_row public.cockpit_creative_outbox)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'taskId', p_row.task_id,
    'client', p_row.client_name,
    'source', 'cockpit',
    'outboxId', p_row.id::text,
    'responseId', NULL::text,
    'settled', CASE WHEN p_row.state IN ('done','reconcile') THEN p_row.state END,
    'closedAt', public.cockpit_slack_notice_iso(coalesce(p_row.settled_at, now())),
    'closedByRole', public.cockpit_slack_notice_role_of(p_row.actor_email),
    'launchTaskId', nullif(p_row.result->>'launchTaskId', ''),
    'mapPhase', CASE WHEN p_row.result->>'mapPhase' ~ '^[0-9]{1,3}$' THEN (p_row.result->>'mapPhase')::integer END,
    'service', nullif(p_row.payload->>'service', ''))
$$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_media_facts(p_row public.cockpit_creative_outbox)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'taskId', p_row.task_id,
    'client', p_row.client_name,
    'outboxId', p_row.id::text,
    'service', nullif(p_row.payload->>'service', ''),
    'launchTaskId', nullif(p_row.result->>'launchTaskId', ''),
    'mapPhase', CASE WHEN p_row.result->>'mapPhase' ~ '^[0-9]{1,3}$' THEN (p_row.result->>'mapPhase')::integer END)
$$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_updated_facts(p_row public.cockpit_creative_outbox)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'taskId', p_row.task_id,
    'client', p_row.client_name,
    'outboxId', p_row.id::text,
    'confirmedAt', public.cockpit_slack_notice_iso(coalesce(p_row.settled_at, now())))
$$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_offer_facts(p_row public.cockpit_creative_outbox)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'taskId', p_row.task_id,
    'client', p_row.client_name,
    'outboxId', p_row.id::text,
    'offeredAt', public.cockpit_slack_notice_iso(coalesce(p_row.settled_at, now())),
    'offeredByRole', public.cockpit_slack_notice_role_of(p_row.actor_email),
    'dnaComplete', coalesce(p_row.payload->>'dna_status', '') = 'complete')
$$;

-- What the card shows now (contract 3.8). Never stored.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_live(p_row public.cockpit_slack_notices)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status text; v_updated timestamptz; v_links jsonb; v_sub timestamptz; v_by text; v_launch timestamptz;
BEGIN
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

-- One notice as a browser sees it (NoticeView): never its text, blocks or
-- facts (other than the response and outbox ids), never a rehearsal's target.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_view(p_row public.cockpit_slack_notices)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_channel text; v_name text; v_reason text; v_due timestamptz;
BEGIN
  IF p_row.id IS NULL THEN RETURN NULL; END IF;
  v_channel := coalesce(p_row.channel, CASE WHEN p_row.kind <> 'rehearsal' THEN p_row.target END);
  IF v_channel IS NOT NULL THEN
    SELECT c.name INTO v_name FROM public.cockpit_slack_channels c WHERE c.id = v_channel;
  END IF;
  IF p_row.state = 'queued' THEN
    IF p_row.kind = 'kickoff' THEN
      v_due := public.cockpit_slack_notice_ts(p_row.facts->>'submittedAt') + interval '20 minutes';
      v_reason := coalesce(p_row.error, 'Waiting for Make to update the card.');
    ELSE
      v_due := p_row.next_attempt_at;
      v_reason := CASE WHEN p_row.parent_id IS NOT NULL THEN 'Waiting for its first notice.' ELSE 'Queued.' END;
    END IF;
  ELSIF p_row.state = 'sending' THEN
    v_reason := 'Posting now.';
  ELSIF p_row.state <> 'posted' THEN
    v_reason := coalesce(p_row.error, 'No reason was recorded. Tell the tech lead.');
  END IF;
  RETURN jsonb_build_object(
    'id', p_row.id,
    'kind', p_row.kind,
    'state', p_row.state,
    'variant', p_row.variant,
    'responseId', p_row.facts->>'responseId',
    'outboxId', p_row.facts->>'outboxId',
    'parentKind', (SELECT p.kind FROM public.cockpit_slack_notices p WHERE p.id = p_row.parent_id),
    'channel', CASE WHEN v_channel IS NOT NULL THEN jsonb_build_object('id', v_channel, 'name', v_name) END,
    'at', CASE WHEN p_row.finished_at IS NOT NULL THEN p_row.finished_at
               WHEN p_row.state = 'sending' AND p_row.claimed_at IS NOT NULL THEN p_row.claimed_at
               ELSE p_row.created_at END,
    'dueAt', v_due,
    'permalink', p_row.permalink,
    'reason', v_reason);
END $$;

-- ---------------------------------------------------------------------------
-- 4. Gates

-- The editor gate (D17): the CEO, an admin seat, or a seat with the
-- forms_editor role or a cockpit_forms_editors row. cockpit_has_role is true
-- for every admin seat, so the role is read here directly.
CREATE OR REPLACE FUNCTION public.cockpit_forms_editor_gate()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_email text; v_roles text[]; v_who text;
BEGIN
  SELECT cm.id, cm.email, cm.roles INTO v_id, v_email, v_roles
    FROM public.cockpit_members cm JOIN auth.users u ON u.id = cm.auth_user_id
   WHERE cm.active AND cm.auth_user_id = auth.uid() AND u.email_confirmed_at IS NOT NULL
     AND cm.email = lower(btrim(u.email))
   ORDER BY cm.updated_at DESC LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Only the CEO, an admin or someone they add can change notices and routing.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(public.cockpit_is_ceo(), false) THEN
    v_who := 'ceo';
  ELSIF 'admin' = ANY(v_roles) THEN
    v_who := 'admin';
  ELSIF 'forms_editor' = ANY(v_roles) OR EXISTS (SELECT 1 FROM public.cockpit_forms_editors e WHERE e.member_id = v_id) THEN
    v_who := 'forms_editor';
  ELSE
    RAISE EXCEPTION 'Only the CEO, an admin or someone they add can change notices and routing.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('actorId', auth.uid(), 'memberId', v_id, 'email', v_email, 'who', v_who,
    'label', public.cockpit_slack_notice_role_of(v_email));
END $$;

-- Who may read the settings: an editor, a client success seat or a creative seat.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_viewer()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_edit boolean := false;
BEGIN
  BEGIN
    PERFORM public.cockpit_forms_editor_gate();
    v_edit := true;
  EXCEPTION WHEN insufficient_privilege THEN
    v_edit := false;
  END;
  IF NOT v_edit AND NOT coalesce(public.cockpit_has_role('csm'), false) AND NOT coalesce(public.cockpit_has_role('creative'), false) THEN
    RAISE EXCEPTION 'Current confirmed client-success or creative access is required' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('edit', v_edit,
    'editors', coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false));
END $$;

-- ---------------------------------------------------------------------------
-- 5. Triggers: the guard, no deletes, the audit

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_fix boolean := coalesce(current_setting('cockpit.notice_fix', true), '') = 'on';
  v_check boolean;
  v_parent_channel text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('queued','skipped') THEN
      RAISE EXCEPTION 'A notice starts queued or skipped' USING ERRCODE = '55000';
    END IF;
    v_check := NEW.target IS NOT NULL;
  ELSE
    IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
       OR NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'A notice keeps its kind, key, card, parent and creation time' USING ERRCODE = '55000';
    END IF;
    IF OLD.slack_ts IS NOT NULL AND NEW.slack_ts IS DISTINCT FROM OLD.slack_ts THEN
      RAISE EXCEPTION 'A posted notice keeps its Slack message' USING ERRCODE = '55000';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
         (OLD.state = 'queued' AND NEW.state IN ('sending','skipped','muted'))
      OR (OLD.state = 'sending' AND NEW.state IN ('queued','posted','failed','unknown'))
      OR (OLD.state = 'unknown' AND NEW.state = 'posted')
      OR (OLD.state = 'unknown' AND NEW.state = 'failed' AND v_fix)
      OR (OLD.state = 'failed' AND NEW.state = 'queued' AND v_fix)) THEN
      RAISE EXCEPTION 'A notice goes from % to % only through the sender', OLD.state, NEW.state USING ERRCODE = '55000';
    END IF;
    NEW.updated_at := now();
    -- An unchanged target is never checked again, so removing a channel
    -- never blocks recording a post that already went there.
    v_check := NEW.target IS NOT NULL AND NEW.target IS DISTINCT FROM OLD.target;
  END IF;
  IF v_check AND NEW.kind <> 'rehearsal'
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_channels c WHERE c.id = NEW.target AND c.state = 'ok') THEN
    IF NEW.parent_id IS NOT NULL THEN
      SELECT p.channel INTO v_parent_channel FROM public.cockpit_slack_notices p WHERE p.id = NEW.parent_id;
    END IF;
    IF v_parent_channel IS NULL OR v_parent_channel <> NEW.target THEN
      RAISE EXCEPTION 'The channel % is not ready for notices. Choose one in Settings, Notices and routing.', NEW.target
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_refuse_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'cockpit_slack_channels' THEN
    RAISE EXCEPTION 'A channel is never deleted. Remove it from the list instead.' USING ERRCODE = '55000';
  ELSIF TG_TABLE_NAME = 'cockpit_slack_notice_settings' THEN
    RAISE EXCEPTION 'A notice setting is never deleted. Turn the notice off instead.' USING ERRCODE = '55000';
  END IF;
  RAISE EXCEPTION 'A notice is never deleted' USING ERRCODE = '55000';
END $$;

-- One audit function for the four tables. A notice records its state and
-- delivery fields only, never its text, blocks or facts.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_action text;
  v_entity text;
  v_before jsonb;
  v_after jsonb;
  v_meta jsonb;
  v_actor text;
  v_keys constant text[] := ARRAY['state','attempts','variant','target','channel','slack_ts','error'];
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN v_new := to_jsonb(NEW); END IF;
  v_row := coalesce(v_new, v_old);
  IF TG_TABLE_NAME = 'cockpit_slack_notices' THEN
    -- Only an insert or a state change (a reconcile look moves checked_at only).
    IF TG_OP = 'UPDATE' AND (v_old->>'state') IS NOT DISTINCT FROM (v_new->>'state') THEN RETURN NULL; END IF;
    v_action := 'slack_notice.' || (v_new->>'state');
    v_entity := v_new->>'id';
    IF v_old IS NOT NULL THEN
      SELECT jsonb_object_agg(k, v_old->k) INTO v_before FROM unnest(v_keys) AS k;
    END IF;
    SELECT jsonb_object_agg(k, v_new->k) INTO v_after FROM unnest(v_keys) AS k;
    v_meta := jsonb_build_object('kind', v_new->>'kind', 'task_id', v_new->>'task_id',
      'dedupe_key', v_new->>'dedupe_key', 'op', lower(TG_OP));
  ELSE
    v_before := v_old;
    v_after := v_new;
    v_meta := jsonb_build_object('op', lower(TG_OP));
    IF TG_TABLE_NAME = 'cockpit_slack_notice_settings' THEN
      v_action := 'slack_notice.setting';
      v_entity := v_row->>'kind';
    ELSIF TG_TABLE_NAME = 'cockpit_slack_channels' THEN
      v_action := 'slack_notice.channel';
      v_entity := v_row->>'id';
    ELSE
      v_action := CASE WHEN TG_OP = 'DELETE' THEN 'forms.editor_removed' ELSE 'forms.editor_added' END;
      v_entity := v_row->>'member_id';
    END IF;
  END IF;
  v_action := coalesce(nullif(current_setting('cockpit.notice_action', true), ''), v_action);
  SELECT u.email INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (v_action, TG_TABLE_NAME, v_entity, coalesce(lower(btrim(v_actor)), session_user::text), 'client-success',
          coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'), v_before, v_after, v_meta);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cockpit_slack_notices_guard ON public.cockpit_slack_notices;
CREATE TRIGGER cockpit_slack_notices_guard BEFORE INSERT OR UPDATE ON public.cockpit_slack_notices
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_slack_notice_guard();
DROP TRIGGER IF EXISTS cockpit_slack_notices_no_delete ON public.cockpit_slack_notices;
CREATE TRIGGER cockpit_slack_notices_no_delete BEFORE DELETE ON public.cockpit_slack_notices
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_slack_notice_refuse_delete();
DROP TRIGGER IF EXISTS cockpit_slack_notices_no_truncate ON public.cockpit_slack_notices;
CREATE TRIGGER cockpit_slack_notices_no_truncate BEFORE TRUNCATE ON public.cockpit_slack_notices
  FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_slack_notice_refuse_delete();
DROP TRIGGER IF EXISTS cockpit_slack_notices_audit ON public.cockpit_slack_notices;
CREATE TRIGGER cockpit_slack_notices_audit AFTER INSERT OR UPDATE OF state ON public.cockpit_slack_notices
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_slack_notice_audit();

DROP TRIGGER IF EXISTS cockpit_slack_notice_settings_audit ON public.cockpit_slack_notice_settings;
CREATE TRIGGER cockpit_slack_notice_settings_audit AFTER INSERT OR UPDATE ON public.cockpit_slack_notice_settings
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_slack_notice_audit();
DROP TRIGGER IF EXISTS cockpit_slack_notice_settings_no_delete ON public.cockpit_slack_notice_settings;
CREATE TRIGGER cockpit_slack_notice_settings_no_delete BEFORE DELETE ON public.cockpit_slack_notice_settings
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_slack_notice_refuse_delete();
DROP TRIGGER IF EXISTS cockpit_slack_notice_settings_no_truncate ON public.cockpit_slack_notice_settings;
CREATE TRIGGER cockpit_slack_notice_settings_no_truncate BEFORE TRUNCATE ON public.cockpit_slack_notice_settings
  FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_slack_notice_refuse_delete();

DROP TRIGGER IF EXISTS cockpit_slack_channels_audit ON public.cockpit_slack_channels;
CREATE TRIGGER cockpit_slack_channels_audit AFTER INSERT OR UPDATE ON public.cockpit_slack_channels
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_slack_notice_audit();
DROP TRIGGER IF EXISTS cockpit_slack_channels_no_delete ON public.cockpit_slack_channels;
CREATE TRIGGER cockpit_slack_channels_no_delete BEFORE DELETE ON public.cockpit_slack_channels
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_slack_notice_refuse_delete();
DROP TRIGGER IF EXISTS cockpit_slack_channels_no_truncate ON public.cockpit_slack_channels;
CREATE TRIGGER cockpit_slack_channels_no_truncate BEFORE TRUNCATE ON public.cockpit_slack_channels
  FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_slack_notice_refuse_delete();

DROP TRIGGER IF EXISTS cockpit_forms_editors_audit ON public.cockpit_forms_editors;
CREATE TRIGGER cockpit_forms_editors_audit AFTER INSERT OR DELETE ON public.cockpit_forms_editors
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_slack_notice_audit();

-- ---------------------------------------------------------------------------
-- 6. The queue triggers. Neither ever raises: the onboarding one runs inside
--    cockpit_csm_onboarding_cron_publish, and the outbox one inside the
--    creative API's settle. A failure is a plain note in cockpit_sync_state.

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_queue_failed(p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    INSERT INTO public.cockpit_sync_state(key, last_run_at, ok, note, updated_at)
    VALUES ('slack-notices-queue', now(), false, left(coalesce(p_note, 'A notice could not be queued.'), 240), now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now(), ok = false, note = EXCLUDED.note, updated_at = now();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_from_onboarding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old jsonb;
  v_rid text;
  v_old_rid text;
  v_bid text;
  v_sub timestamptz;
  v_state text;
  v_error text;
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' THEN v_old := OLD.forms; END IF;

    -- 1. The kickoff: a new response ID queues one row (the key makes it once only).
    v_rid := nullif(NEW.forms->'kickoff'->>'response_id', '');
    v_old_rid := nullif(v_old->'kickoff'->>'response_id', '');
    IF v_rid IS NOT NULL AND (TG_OP = 'INSERT' OR v_old_rid IS DISTINCT FROM v_rid) THEN
      v_sub := public.cockpit_slack_notice_ts(NEW.forms->'kickoff'->>'submitted_at');
      IF v_sub IS NULL THEN
        v_state := 'skipped';
        v_error := 'The kickoff has no readable submit time, so it was not posted.';
      ELSIF v_sub <= now() - interval '48 hours' THEN
        v_state := 'skipped';
        v_error := 'This kickoff was more than 48 hours old when the mirror listed it, so it was not posted.';
      ELSE
        v_state := 'queued';
        v_error := NULL;
      END IF;
      PERFORM public.cockpit_slack_notice_queue('kickoff', 'kickoff:' || v_rid, NEW.clickup_task_id, NEW.client_name,
        public.cockpit_slack_notice_kickoff_facts(NEW.clickup_task_id, NEW.client_name, NEW.forms, v_old_rid),
        NULL, v_state, v_error);
    END IF;

    -- 2. The old Typeform Blueprint (until A1 removes it): only a record from
    --    the last 48 hours, so an old one never blocks a native close notice.
    v_bid := nullif(NEW.forms->'blueprint'->>'response_id', '');
    IF v_bid IS NOT NULL
       AND (TG_OP = 'INSERT' OR nullif(v_old->'blueprint'->>'response_id', '') IS DISTINCT FROM v_bid)
       AND public.cockpit_slack_notice_ts(NEW.forms->'blueprint'->>'submitted_at') > now() - interval '48 hours' THEN
      PERFORM public.cockpit_slack_notice_queue('blueprint.close', 'blueprint:' || NEW.clickup_task_id || ':close',
        NEW.clickup_task_id, NEW.client_name,
        public.cockpit_slack_notice_typeform_facts(NEW.clickup_task_id, NEW.client_name, NEW.forms), NULL, 'queued', NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_slack_notice_queue_failed(SQLERRM);
  END;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_from_outbox()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_close text;
  v_close_id uuid;
  v_close_settled text;
  v_new uuid;
BEGIN
  BEGIN
    IF NOT ((NEW.kind = 'blueprintClose' AND ((OLD.state = 'sending' AND NEW.state IN ('done','reconcile'))
                                           OR (OLD.state = 'reconcile' AND NEW.state = 'done')))
         OR (NEW.kind = 'blueprintOffer' AND OLD.state = 'sending' AND NEW.state = 'done')) THEN
      RETURN NULL;
    END IF;
    IF NEW.task_id IS NULL OR btrim(NEW.task_id) = '' THEN
      RAISE EXCEPTION 'The Brand Blueprint press % has no card ID, so no notice was queued.', NEW.id;
    END IF;
    v_close := 'blueprint:' || NEW.task_id || ':close';

    IF NEW.kind = 'blueprintClose' AND OLD.state = 'sending' THEN
      -- The first close that leaves sending posts; later presses hit the key.
      v_new := public.cockpit_slack_notice_queue('blueprint.close', v_close, NEW.task_id, NEW.client_name,
        public.cockpit_slack_notice_close_facts(NEW), NULL, 'queued', NULL);
      PERFORM public.cockpit_slack_notice_queue('blueprint.media', 'blueprint:' || NEW.task_id || ':media',
        NEW.task_id, NEW.client_name, public.cockpit_slack_notice_media_facts(NEW), NULL, 'queued', NULL);
      IF v_new IS NULL AND NEW.state = 'done' THEN
        -- A later press confirmed a card the first close left to check.
        SELECT n.id, n.facts->>'settled' INTO v_close_id, v_close_settled
          FROM public.cockpit_slack_notices n WHERE n.dedupe_key = v_close;
        IF v_close_settled = 'reconcile' THEN
          PERFORM public.cockpit_slack_notice_queue('blueprint.updated', 'blueprint:' || NEW.task_id || ':updated',
            NEW.task_id, NEW.client_name, public.cockpit_slack_notice_updated_facts(NEW), v_close_id, 'queued', NULL);
        END IF;
      END IF;
    ELSIF NEW.kind = 'blueprintClose' THEN
      -- reconcile to done
      SELECT n.id INTO v_close_id FROM public.cockpit_slack_notices n WHERE n.dedupe_key = v_close;
      PERFORM public.cockpit_slack_notice_queue('blueprint.updated', 'blueprint:' || NEW.task_id || ':updated',
        NEW.task_id, NEW.client_name, public.cockpit_slack_notice_updated_facts(NEW), v_close_id, 'queued', NULL);
    ELSE
      SELECT n.id INTO v_close_id FROM public.cockpit_slack_notices n WHERE n.dedupe_key = v_close;
      PERFORM public.cockpit_slack_notice_queue('blueprint.offer', 'blueprint:' || NEW.task_id || ':offer',
        NEW.task_id, NEW.client_name, public.cockpit_slack_notice_offer_facts(NEW), v_close_id, 'queued', NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_slack_notice_queue_failed(SQLERRM);
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cockpit_slack_notice_kickoff ON public.cockpit_client_onboarding;
CREATE TRIGGER cockpit_slack_notice_kickoff AFTER INSERT OR UPDATE ON public.cockpit_client_onboarding
  FOR EACH ROW WHEN ((NEW.forms ? 'kickoff') OR (NEW.forms ? 'blueprint'))
  EXECUTE FUNCTION public.cockpit_slack_notice_from_onboarding();
DROP TRIGGER IF EXISTS cockpit_slack_notice_blueprint ON public.cockpit_creative_outbox;
CREATE TRIGGER cockpit_slack_notice_blueprint AFTER UPDATE OF state ON public.cockpit_creative_outbox
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.kind IN ('blueprintClose','blueprintOffer'))
  EXECUTE FUNCTION public.cockpit_slack_notice_from_outbox();

-- ---------------------------------------------------------------------------
-- 7. Service RPCs (the cockpit-notices sender; service_role only)

-- The second source behind the triggers: stuck sends become unknown, missed
-- notices are inserted, follow-ups are queued.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_sweep()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_unknown integer := 0;
  v_kickoffs integer := 0;
  v_closes integer := 0;
  v_media integer := 0;
  v_offers integer := 0;
  v_followups integer := 0;
  v_facts jsonb;
  v_prev text;
  v_close_id uuid;
  v_status text;
  v_updated timestamptz;
  o record;
  ob public.cockpit_creative_outbox;
  n public.cockpit_slack_notices;
BEGIN
  PERFORM set_config('cockpit.audit_source', 'cron', true);

  -- 1. A send that stopped part way: never sent again, a person looks for its Ref.
  UPDATE public.cockpit_slack_notices s
     SET state = 'unknown', finished_at = now(),
         error = 'The sender stopped while posting. Look in Slack for this notice''s Ref before anything else.'
   WHERE s.state = 'sending' AND s.claimed_at < now() - interval '10 minutes';
  GET DIAGNOSTICS v_unknown = ROW_COUNT;

  -- 2. Kickoffs the trigger missed (the last 48 hours only).
  FOR o IN
    SELECT x.clickup_task_id, x.client_name, x.forms, x.forms->'kickoff'->>'response_id' AS rid
      FROM public.cockpit_client_onboarding x
     WHERE nullif(x.forms->'kickoff'->>'response_id', '') IS NOT NULL
       AND public.cockpit_slack_notice_ts(x.forms->'kickoff'->>'submitted_at') > now() - interval '48 hours'
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_notices k
                        WHERE k.dedupe_key = 'kickoff:' || (x.forms->'kickoff'->>'response_id'))
  LOOP
    BEGIN
      v_facts := public.cockpit_slack_notice_kickoff_facts(o.clickup_task_id, o.client_name, o.forms, NULL);
      IF NOT coalesce((v_facts->>'second')::boolean, false) THEN
        SELECT k.facts->>'responseId' INTO v_prev FROM public.cockpit_slack_notices k
         WHERE k.kind = 'kickoff' AND k.task_id = o.clickup_task_id AND (k.facts->>'responseId') IS DISTINCT FROM o.rid
         ORDER BY k.created_at DESC LIMIT 1;
        IF FOUND THEN
          v_facts := v_facts || jsonb_build_object('second', true, 'previousResponseId', v_prev);
        END IF;
      END IF;
      IF public.cockpit_slack_notice_queue('kickoff', 'kickoff:' || o.rid, o.clickup_task_id, o.client_name,
           v_facts, NULL, 'queued', NULL) IS NOT NULL THEN
        v_kickoffs := v_kickoffs + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.cockpit_slack_notice_queue_failed(SQLERRM);
    END;
  END LOOP;

  -- 3. Closes the trigger missed: the first close that settled posts.
  FOR ob IN
    SELECT * FROM public.cockpit_creative_outbox x
     WHERE x.kind = 'blueprintClose' AND x.state IN ('done','reconcile') AND nullif(btrim(x.task_id), '') IS NOT NULL
       AND coalesce(x.settled_at, x.created_at) > now() - interval '48 hours'
     ORDER BY coalesce(x.settled_at, x.created_at), x.id
  LOOP
    BEGIN
      IF public.cockpit_slack_notice_queue('blueprint.close', 'blueprint:' || ob.task_id || ':close', ob.task_id,
           ob.client_name, public.cockpit_slack_notice_close_facts(ob), NULL, 'queued', NULL) IS NOT NULL THEN
        v_closes := v_closes + 1;
      END IF;
      IF public.cockpit_slack_notice_queue('blueprint.media', 'blueprint:' || ob.task_id || ':media', ob.task_id,
           ob.client_name, public.cockpit_slack_notice_media_facts(ob), NULL, 'queued', NULL) IS NOT NULL THEN
        v_media := v_media + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.cockpit_slack_notice_queue_failed(SQLERRM);
    END;
  END LOOP;

  -- 4. Offers the trigger missed.
  FOR ob IN
    SELECT * FROM public.cockpit_creative_outbox x
     WHERE x.kind = 'blueprintOffer' AND x.state = 'done' AND nullif(btrim(x.task_id), '') IS NOT NULL
       AND x.settled_at > now() - interval '48 hours'
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_notices k WHERE k.dedupe_key = 'blueprint:' || x.task_id || ':offer')
     ORDER BY x.settled_at, x.id
  LOOP
    BEGIN
      SELECT k.id INTO v_close_id FROM public.cockpit_slack_notices k WHERE k.dedupe_key = 'blueprint:' || ob.task_id || ':close';
      IF public.cockpit_slack_notice_queue('blueprint.offer', 'blueprint:' || ob.task_id || ':offer', ob.task_id,
           ob.client_name, public.cockpit_slack_notice_offer_facts(ob), v_close_id, 'queued', NULL) IS NOT NULL THEN
        v_offers := v_offers + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.cockpit_slack_notice_queue_failed(SQLERRM);
    END;
  END LOOP;

  -- 5. A close left to check that a later press confirmed.
  FOR n IN
    SELECT * FROM public.cockpit_slack_notices k
     WHERE k.kind = 'blueprint.close' AND k.facts->>'settled' = 'reconcile'
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_notices u WHERE u.dedupe_key = 'blueprint:' || k.task_id || ':updated')
  LOOP
    BEGIN
      SELECT * INTO ob FROM public.cockpit_creative_outbox x
       WHERE x.kind = 'blueprintClose' AND x.task_id = n.task_id AND x.state = 'done' AND x.settled_at > n.created_at
       ORDER BY x.settled_at, x.id LIMIT 1;
      IF FOUND AND public.cockpit_slack_notice_queue('blueprint.updated', 'blueprint:' || n.task_id || ':updated',
           n.task_id, n.client_name, public.cockpit_slack_notice_updated_facts(ob), n.id, 'queued', NULL) IS NOT NULL THEN
        v_followups := v_followups + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.cockpit_slack_notice_queue_failed(SQLERRM);
    END;
  END LOOP;

  -- 6. A late kickoff whose card has since caught up: a reply under it.
  FOR n IN
    SELECT * FROM public.cockpit_slack_notices k
     WHERE k.kind = 'kickoff' AND k.variant = 'late' AND k.state = 'posted' AND k.created_at > now() - interval '48 hours'
       AND nullif(k.facts->>'responseId', '') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_notices u
                        WHERE u.dedupe_key = 'kickoff:' || (k.facts->>'responseId') || ':updated')
  LOOP
    BEGIN
      v_status := NULL;
      v_updated := NULL;
      SELECT x.client_status, x.card_updated_at INTO v_status, v_updated
        FROM public.cockpit_client_onboarding x WHERE x.clickup_task_id = n.task_id;
      IF public.cockpit_slack_notice_card_done(v_status, v_updated, public.cockpit_slack_notice_ts(n.facts->>'submittedAt'))
         AND public.cockpit_slack_notice_queue('kickoff.updated', 'kickoff:' || (n.facts->>'responseId') || ':updated',
               n.task_id, n.client_name,
               jsonb_build_object('taskId', n.task_id, 'client', n.client_name, 'responseId', n.facts->>'responseId',
                                  'cardUpdatedAt', public.cockpit_slack_notice_iso(v_updated)),
               n.id, 'queued', NULL) IS NOT NULL THEN
        v_followups := v_followups + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.cockpit_slack_notice_queue_failed(SQLERRM);
    END;
  END LOOP;

  -- 7. Typeform Blueprint records the trigger missed (the last 48 hours only).
  FOR o IN
    SELECT x.clickup_task_id, x.client_name, x.forms
      FROM public.cockpit_client_onboarding x
     WHERE nullif(x.forms->'blueprint'->>'response_id', '') IS NOT NULL
       AND public.cockpit_slack_notice_ts(x.forms->'blueprint'->>'submitted_at') > now() - interval '48 hours'
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_notices k WHERE k.dedupe_key = 'blueprint:' || x.clickup_task_id || ':close')
  LOOP
    BEGIN
      IF public.cockpit_slack_notice_queue('blueprint.close', 'blueprint:' || o.clickup_task_id || ':close',
           o.clickup_task_id, o.client_name,
           public.cockpit_slack_notice_typeform_facts(o.clickup_task_id, o.client_name, o.forms), NULL, 'queued', NULL) IS NOT NULL THEN
        v_closes := v_closes + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.cockpit_slack_notice_queue_failed(SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('unknown', v_unknown, 'kickoffs', v_kickoffs, 'closes', v_closes, 'media', v_media,
    'offers', v_offers, 'followups', v_followups);
END $$;

-- Claim due rows for one sender run (contract 2.1, the claim).
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_claim(p_limit integer, p_only uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lim integer := least(greatest(coalesce(p_limit, 10), 1), 25);
  v_n integer := 0;
  v_rows jsonb := '[]'::jsonb;
  r public.cockpit_slack_notices;
  p public.cockpit_slack_notices;
  v_found boolean;
  v_enabled boolean;
  v_top boolean;
  v_target text;
  v_thread text;
  v_lookup text;
  v_email text;
  v_sub timestamptz;
  v_status text;
  v_updated timestamptz;
  v_row jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('cockpit_slack_notices', 0)) THEN
    RETURN jsonb_build_object('busy', true, 'rows', '[]'::jsonb);
  END IF;
  PERFORM set_config('cockpit.audit_source', 'cron', true);

  FOR r IN
    SELECT * FROM public.cockpit_slack_notices x
     WHERE x.state = 'queued' AND x.next_attempt_at <= now() AND (p_only IS NULL OR x.id = p_only)
     ORDER BY x.created_at, x.id
     FOR UPDATE SKIP LOCKED
  LOOP
    EXIT WHEN v_n >= v_lim;
    v_top := true;
    v_target := NULL;
    v_thread := NULL;
    v_lookup := NULL;

    -- 1. Turned off: muted, never sent.
    v_enabled := NULL;
    IF r.kind <> 'rehearsal' THEN
      SELECT s.enabled INTO v_enabled FROM public.cockpit_slack_notice_settings s WHERE s.kind = r.kind;
    END IF;
    IF v_enabled IS FALSE THEN
      UPDATE public.cockpit_slack_notices SET state = 'muted', finished_at = now(),
             error = 'Turned off in Settings, Notices and routing.'
       WHERE id = r.id;
      CONTINUE;
    END IF;

    -- 2. A reply waits for its first notice, then goes in its thread.
    IF r.parent_id IS NOT NULL THEN
      SELECT * INTO p FROM public.cockpit_slack_notices x WHERE x.id = r.parent_id;
      v_found := FOUND;
      IF v_found AND (p.state IN ('queued','sending') OR (p.state = 'unknown' AND p.claimed_at > now() - interval '30 minutes')) THEN
        CONTINUE;
      ELSIF v_found AND p.state = 'posted' THEN
        v_thread := p.slack_ts;
        v_target := p.channel;
        v_top := false;
      ELSIF v_found AND p.state IN ('muted','skipped') AND r.kind <> 'blueprint.offer' THEN
        UPDATE public.cockpit_slack_notices SET state = 'skipped', finished_at = now(),
               error = 'Its first notice did not post, so this reply was not sent.'
         WHERE id = r.id;
        CONTINUE;
      END IF;
      -- Otherwise (failed, an old unknown, or an offer whose close did not post): top level.
    END IF;

    -- 3. Where it goes.
    IF v_top THEN
      IF r.kind = 'rehearsal' THEN
        v_target := r.target;
        IF v_target IS NULL THEN
          v_email := NULL;
          IF coalesce(r.facts->>'requestedBy', '') ~ '^[0-9a-fA-F-]{36}$' THEN
            SELECT lower(btrim(m.email)) INTO v_email FROM public.cockpit_members m
             WHERE m.auth_user_id = (r.facts->>'requestedBy')::uuid
             ORDER BY m.active DESC, m.updated_at DESC LIMIT 1;
          END IF;
          IF v_email IS NOT NULL THEN
            SELECT sid.slack_user_id INTO v_target
              FROM public.cockpit_people pp
              JOIN public.cockpit_eod_radar_slack_ids sid
                ON sid.person_id = pp.id AND sid.state = 'ok' AND sid.slack_user_id IS NOT NULL
             WHERE pp.active AND lower(btrim(pp.email)) = v_email
             ORDER BY pp.id LIMIT 1;
            IF v_target IS NULL THEN v_lookup := v_email; END IF;
          END IF;
          IF v_target IS NULL AND v_lookup IS NULL THEN
            UPDATE public.cockpit_slack_notices SET state = 'sending', claimed_at = now() WHERE id = r.id;
            UPDATE public.cockpit_slack_notices SET state = 'failed', finished_at = now(),
                   error = 'No Slack account was found for you. Ask the tech lead to add your address to the team list.'
             WHERE id = r.id;
            CONTINUE;
          END IF;
        END IF;
      ELSE
        v_target := public.cockpit_slack_notice_target(r.kind);
      END IF;
    END IF;

    -- 4. A kickoff waits until the card looks done, or 20 minutes have passed.
    IF r.kind = 'kickoff' THEN
      v_sub := public.cockpit_slack_notice_ts(r.facts->>'submittedAt');
      v_status := NULL;
      v_updated := NULL;
      SELECT o.client_status, o.card_updated_at INTO v_status, v_updated
        FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = r.task_id;
      IF v_sub IS NOT NULL AND NOT public.cockpit_slack_notice_card_done(v_status, v_updated, v_sub)
         AND now() < v_sub + interval '20 minutes' THEN
        CONTINUE;
      END IF;
    END IF;

    -- 5. A top-level notice needs a ready channel (the target is not written,
    --    so the guard does not refuse the move).
    IF v_top AND r.kind <> 'rehearsal'
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_channels c WHERE c.id = v_target AND c.state = 'ok') THEN
      UPDATE public.cockpit_slack_notices SET state = 'sending', claimed_at = now() WHERE id = r.id;
      UPDATE public.cockpit_slack_notices SET state = 'failed', finished_at = now(),
             error = format('The channel for this notice is not ready (%s). Choose one in Settings, Notices and routing.',
                            coalesce(v_target, 'none'))
       WHERE id = r.id;
      CONTINUE;
    END IF;

    -- 6. Claimed.
    UPDATE public.cockpit_slack_notices SET state = 'sending', claimed_at = now(), target = v_target
     WHERE id = r.id RETURNING * INTO r;

    -- 7. The row the sender works from.
    v_row := jsonb_build_object(
      'id', r.id,
      'ref', 'CN-' || left(r.id::text, 8),
      'kind', r.kind,
      'taskId', r.task_id,
      'clientName', r.client_name,
      'attempts', r.attempts,
      'createdAt', r.created_at,
      'facts', r.facts,
      'live', public.cockpit_slack_notice_live(r),
      'target', r.target,
      'threadTs', v_thread,
      'parentId', r.parent_id,
      'mentions', public.cockpit_slack_notice_claim_mentions(r.kind, r.client_name));
    IF r.kind = 'rehearsal' THEN
      v_row := v_row || jsonb_build_object('rehearsal', jsonb_build_object('of', r.facts->>'of', 'lookupEmail', v_lookup));
    END IF;
    v_rows := v_rows || jsonb_build_array(v_row);
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('busy', false, 'rows', v_rows);
END $$;

-- Record what Slack answered for one claimed row.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_result(p_id uuid, p_outcome text, p_ts text, p_channel text,
  p_error text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_slack_notices;
  d jsonb := CASE WHEN jsonb_typeof(p_detail) = 'object' THEN p_detail ELSE '{}'::jsonb END;
  v_err text := left(nullif(btrim(p_error), ''), 240);
  v_variant text;
  v_text text;
  v_blocks jsonb;
  v_permalink text;
  v_target text;
  v_facts jsonb;
  v_after integer;
  v_to text;
  v_from text[];
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('posted','failed','unknown','requeue','retry') THEN
    RAISE EXCEPTION 'Choose posted, failed, unknown, requeue or retry' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  SELECT * INTO r FROM public.cockpit_slack_notices x WHERE x.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no notice with that ID' USING ERRCODE = '22023';
  END IF;

  -- Repeating a post with the same message changes nothing.
  IF p_outcome = 'posted' AND r.state = 'posted' AND r.slack_ts = p_ts THEN
    RETURN public.cockpit_slack_notice_view(r);
  END IF;
  v_from := CASE WHEN p_outcome = 'posted' THEN ARRAY['sending','unknown'] ELSE ARRAY['sending'] END;
  IF NOT (r.state = ANY(v_from)) THEN
    v_to := CASE p_outcome WHEN 'requeue' THEN 'queued' WHEN 'retry' THEN 'queued' ELSE p_outcome END;
    RAISE EXCEPTION 'A notice goes from % to % only through the sender', r.state, v_to USING ERRCODE = '55000';
  END IF;

  -- The detail keys, each applied only when present and well formed.
  v_variant := CASE WHEN d->>'variant' ~ '^[a-z_]{1,20}$' THEN d->>'variant' END;
  v_text := CASE WHEN jsonb_typeof(d->'text') = 'string' THEN left(d->>'text', 4000) END;
  v_blocks := CASE WHEN jsonb_typeof(d->'blocks') = 'array' THEN d->'blocks' END;
  v_permalink := CASE WHEN d->>'permalink' ~ '^https://[a-z0-9.-]+\.slack\.com/' THEN d->>'permalink' END;
  v_target := CASE WHEN r.kind = 'rehearsal' AND r.target IS NULL AND d->>'target' ~ '^[UW][A-Z0-9]{8,12}$'
                   THEN d->>'target' END;
  v_facts := r.facts;
  IF jsonb_typeof(d->'facts') = 'object' AND octet_length((r.facts || (d->'facts'))::text) <= 16384 THEN
    v_facts := r.facts || (d->'facts');
  END IF;
  v_after := CASE WHEN d->>'retryAfterSec' ~ '^[0-9]{1,6}$' THEN (d->>'retryAfterSec')::integer END;

  IF p_outcome = 'posted' THEN
    v_to := coalesce(r.target, v_target);
    IF p_ts IS NULL OR p_ts !~ '^[0-9]+\.[0-9]+$' OR p_channel IS NULL OR p_channel !~ '^[CGD][A-Z0-9]{8,12}$'
       OR v_to IS NULL
       OR NOT ((v_to ~ '^[CGD]' AND v_to = p_channel) OR (v_to ~ '^[UW]' AND p_channel ~ '^D')) THEN
      RAISE EXCEPTION 'Slack answered for another channel' USING ERRCODE = '22023';
    END IF;
    UPDATE public.cockpit_slack_notices
       SET state = 'posted', slack_ts = p_ts, channel = p_channel, finished_at = now(), error = NULL,
           target = coalesce(target, v_target), variant = coalesce(v_variant, variant), text = coalesce(v_text, text),
           blocks = coalesce(v_blocks, blocks), permalink = coalesce(v_permalink, permalink), facts = v_facts
     WHERE id = r.id RETURNING * INTO r;
  ELSIF p_outcome IN ('failed','unknown') THEN
    IF v_err IS NULL THEN
      RAISE EXCEPTION 'Say what happened in a plain sentence' USING ERRCODE = '22023';
    END IF;
    UPDATE public.cockpit_slack_notices
       SET state = p_outcome, error = v_err, finished_at = now(),
           target = coalesce(target, v_target), variant = coalesce(v_variant, variant), text = coalesce(v_text, text),
           blocks = coalesce(v_blocks, blocks), facts = v_facts
     WHERE id = r.id RETURNING * INTO r;
  ELSIF p_outcome = 'requeue' THEN
    -- Waiting, not an attempt.
    UPDATE public.cockpit_slack_notices
       SET state = 'queued', error = v_err,
           next_attempt_at = now() + make_interval(secs => greatest(coalesce(v_after, 60), 30)),
           variant = coalesce(v_variant, variant), facts = v_facts
     WHERE id = r.id RETURNING * INTO r;
  ELSE
    -- retry: a counted attempt, three at most.
    IF r.attempts + 1 >= 3 THEN
      UPDATE public.cockpit_slack_notices
         SET attempts = r.attempts + 1, state = 'failed', finished_at = now(),
             error = coalesce(v_err, 'It could not be sent after 3 tries.'),
             variant = coalesce(v_variant, variant), text = coalesce(v_text, text), blocks = coalesce(v_blocks, blocks),
             facts = v_facts
       WHERE id = r.id RETURNING * INTO r;
    ELSE
      UPDATE public.cockpit_slack_notices
         SET attempts = r.attempts + 1, state = 'queued', error = v_err,
             next_attempt_at = now() + make_interval(secs => greatest(coalesce(v_after, 1), 1)),
             variant = coalesce(v_variant, variant), facts = v_facts
       WHERE id = r.id RETURNING * INTO r;
    END IF;
  END IF;
  RETURN public.cockpit_slack_notice_view(r);
END $$;

-- Unknowns for the sender to look for in Slack, at most once every 10 minutes
-- each, for 24 hours.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_unknowns(p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lim integer := least(greatest(coalesce(p_limit, 10), 1), 10);
  v_out jsonb := '[]'::jsonb;
  v_thread text;
  r public.cockpit_slack_notices;
BEGIN
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  FOR r IN
    SELECT * FROM public.cockpit_slack_notices x
     WHERE x.state = 'unknown' AND x.claimed_at > now() - interval '24 hours'
       AND (x.checked_at IS NULL OR x.checked_at < now() - interval '10 minutes')
     ORDER BY x.claimed_at, x.id
     LIMIT v_lim
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.cockpit_slack_notices SET checked_at = now() WHERE id = r.id;
    v_thread := NULL;
    IF r.parent_id IS NOT NULL THEN
      SELECT p.slack_ts INTO v_thread FROM public.cockpit_slack_notices p WHERE p.id = r.parent_id AND p.state = 'posted';
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', r.id,
      'ref', 'CN-' || left(r.id::text, 8),
      'kind', r.kind,
      'target', r.target,
      'channel', coalesce(r.channel, CASE WHEN r.target ~ '^[CG]' THEN r.target END),
      'threadTs', v_thread,
      'oldest', (extract(epoch FROM r.claimed_at) - 60)::text));
  END LOOP;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_channel_pending()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.updated_at, c.id), '[]'::jsonb)
    FROM (SELECT x.id, x.name, x.updated_at FROM public.cockpit_slack_channels x
           WHERE x.state = 'checking' ORDER BY x.updated_at, x.id LIMIT 5) c
$$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_channel_checked(p_id text, p_ok boolean, p_name text, p_private boolean, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.cockpit_slack_channels;
  v_name text := nullif(btrim(regexp_replace(btrim(coalesce(p_name, '')), '^#+', '')), '');
BEGIN
  IF p_ok IS NULL THEN
    RAISE EXCEPTION 'Say whether the check passed' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  SELECT * INTO c FROM public.cockpit_slack_channels x WHERE x.id = upper(btrim(coalesce(p_id, ''))) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That channel is not on the list.' USING ERRCODE = '22023';
  END IF;
  IF c.state = 'removed' THEN RETURN to_jsonb(c); END IF;
  IF v_name IS NOT NULL AND (char_length(v_name) > 80 OR v_name ~ '[<>&#\s]') THEN v_name := NULL; END IF;
  UPDATE public.cockpit_slack_channels
     SET state = CASE WHEN p_ok THEN 'ok' ELSE 'refused' END,
         name = coalesce(v_name, name),
         private = coalesce(p_private, private),
         note = left(nullif(btrim(p_note), ''), 240),
         checked_at = now(),
         updated_at = now()
   WHERE id = c.id RETURNING * INTO c;
  RETURN to_jsonb(c);
END $$;

-- The dry run's inputs: builds what a claim would hand the sender, writes nothing.
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
    IF v_kind IS NULL OR v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer') THEN
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
                                             'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer'], s.kind))
                            FROM public.cockpit_slack_notice_settings s), '[]'::jsonb))
$$;

-- A rehearsal to one person's direct messages, from the sender's door.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_rehearse_service(p_kind text, p_target text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_kind text := coalesce(nullif(btrim(p_kind), ''), 'kickoff'); v_id uuid;
BEGIN
  IF v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer') THEN
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

-- The runbook's two hand fixes, for a person who checked Slack.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_fix(p_id uuid, p_action text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_slack_notices;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('requeue','not_posted') THEN
    RAISE EXCEPTION 'Choose requeue or not_posted' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  SELECT * INTO r FROM public.cockpit_slack_notices x WHERE x.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no notice with that ID' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'requeue' AND r.state <> 'failed' THEN
    RAISE EXCEPTION 'A notice goes from % to queued only through the sender', r.state USING ERRCODE = '55000';
  ELSIF p_action = 'not_posted' AND r.state <> 'unknown' THEN
    RAISE EXCEPTION 'A notice goes from % to failed only through the sender', r.state USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('cockpit.notice_fix', 'on', true);
  PERFORM set_config('cockpit.notice_action', 'slack_notice.fix_' || p_action, true);
  IF p_action = 'requeue' THEN
    UPDATE public.cockpit_slack_notices
       SET state = 'queued', attempts = 0, next_attempt_at = now(), error = NULL, finished_at = NULL
     WHERE id = r.id RETURNING * INTO r;
  ELSE
    UPDATE public.cockpit_slack_notices
       SET state = 'failed', finished_at = now(),
           error = left('Checked by a person: not in Slack. ' || coalesce(btrim(p_note), ''), 240)
     WHERE id = r.id RETURNING * INTO r;
  END IF;
  PERFORM set_config('cockpit.notice_fix', 'off', true);
  PERFORM set_config('cockpit.notice_action', '', true);
  RETURN public.cockpit_slack_notice_view(r);
END $$;

-- ---------------------------------------------------------------------------
-- 8. Browser RPCs (authenticated only, each gated first)

-- The notices of one card, for the trail stops.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_read(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ok boolean := false; v_msg text; v_code text; v_name text;
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  IF coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false) THEN
    v_ok := true;
  ELSE
    BEGIN
      PERFORM public.cockpit_csm_client_gate(p_task_id);
      v_ok := true;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_code = RETURNED_SQLSTATE;
    END;
    IF NOT v_ok AND coalesce(public.cockpit_has_role('creative'), false) THEN
      SELECT o.client_name INTO v_name FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task_id;
      IF v_name IS NULL THEN
        SELECT n.client_name INTO v_name FROM public.cockpit_slack_notices n
         WHERE n.task_id = p_task_id AND n.client_name IS NOT NULL ORDER BY n.created_at DESC LIMIT 1;
      END IF;
      v_ok := coalesce(public.cockpit_client_allowed(v_name), false);
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
                                  ORDER BY x.created_at DESC, x.id LIMIT 20) v), '[]'::jsonb));
END $$;

-- The Notices and routing card (SettingsRead).
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
                                   'blueprint.close','blueprint.updated','blueprint.media','blueprint.offer'], x.kind)
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
      'mentionPeople', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', u.id,
                 'label', coalesce(split_part(btrim(pp.name), ' ', 1) || coalesce(', ' || nullif(btrim(pp.role), ''), ''),
                                   'Not on the team list'),
                 'slackKnown', coalesce(pp.active, false) AND EXISTS (
                   SELECT 1 FROM public.cockpit_eod_radar_slack_ids sid
                    WHERE sid.person_id = pp.id AND sid.state = 'ok' AND sid.slack_user_id IS NOT NULL))
               ORDER BY u.ord)
          FROM unnest(s.mention_people) WITH ORDINALITY AS u(id, ord)
          LEFT JOIN public.cockpit_people pp ON pp.id = u.id), '[]'::jsonb),
      'tags', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'rule', u.rule,
                 'found', EXISTS (SELECT 1 FROM jsonb_array_elements(m.list) e WHERE NOT coalesce((e->>'missing')::boolean, false)),
                 'slackKnown', EXISTS (SELECT 1 FROM jsonb_array_elements(m.list) e WHERE e->>'slackId' IS NOT NULL))
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

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_settings_set(p_kind text, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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

  IF (v_on, v_channel, v_rule, v_people) IS NOT DISTINCT FROM (s.enabled, s.channel, s.mention_rule, s.mention_people) THEN
    RETURN public.cockpit_slack_notice_settings_read();
  END IF;
  UPDATE public.cockpit_slack_notice_settings
     SET enabled = v_on, channel = v_channel, mention_rule = v_rule, mention_people = v_people,
         updated_by = g->>'email', updated_at = now()
   WHERE kind = s.kind;
  RETURN public.cockpit_slack_notice_settings_read();
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_slack_channel_add(p_channel text, p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb;
  c public.cockpit_slack_channels;
  v_id text := upper(btrim(coalesce(p_channel, '')));
  v_name text := nullif(btrim(regexp_replace(btrim(coalesce(p_name, '')), '^#+', '')), '');
BEGIN
  g := public.cockpit_forms_editor_gate();
  IF v_id !~ '^[CG][A-Z0-9]{8,12}$' THEN
    RAISE EXCEPTION 'Paste the channel''s ID from Slack (it starts with C or G).' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NOT NULL AND (char_length(v_name) > 80 OR v_name ~ '[<>&#\s]') THEN
    RAISE EXCEPTION 'Type the channel''s name as Slack shows it, without spaces.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.cockpit_slack_channels x WHERE x.id = v_id FOR UPDATE;
  IF FOUND AND c.state = 'ok' THEN
    RAISE EXCEPTION 'That channel is already on the list.' USING ERRCODE = '22023';
  END IF;
  IF FOUND AND c.state = 'checking' THEN
    RETURN public.cockpit_slack_notice_settings_read();
  END IF;
  INSERT INTO public.cockpit_slack_channels AS t(id, name, state, note, added_by)
  VALUES (v_id, v_name, 'checking', 'Checking that mahara-club-bot is in it.', g->>'email')
  ON CONFLICT (id) DO UPDATE
     SET state = 'checking', note = EXCLUDED.note, name = coalesce(EXCLUDED.name, t.name),
         added_by = EXCLUDED.added_by, checked_at = NULL, updated_at = now();
  RETURN public.cockpit_slack_notice_settings_read();
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
   ORDER BY array_position(ARRAY['kickoff','blueprint.close','blueprint.media'], s.kind) LIMIT 1;
  IF v_kind IS NOT NULL THEN
    RAISE EXCEPTION 'The % notice posts there. Choose another channel for it first.', public.cockpit_slack_notice_kind_label(v_kind)
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.cockpit_slack_channels SET state = 'removed', note = 'Removed from the list.', updated_at = now() WHERE id = v_id;
  RETURN public.cockpit_slack_notice_settings_read();
END $$;

-- "Send a test to me": a queued rehearsal; the claim finds the editor's Slack id.
CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_rehearse(p_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; v_uid text; v_kind text := coalesce(nullif(btrim(p_kind), ''), 'kickoff'); v_id uuid;
BEGIN
  g := public.cockpit_forms_editor_gate();
  v_uid := g->>'actorId';
  IF v_kind NOT IN ('kickoff','kickoff.updated','blueprint.close','blueprint.updated','blueprint.media','blueprint.offer') THEN
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

CREATE OR REPLACE FUNCTION public.cockpit_forms_editor_set(p_member_id uuid, p_on boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_email text;
BEGIN
  IF NOT (coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false)) THEN
    RAISE EXCEPTION 'Only the CEO or an admin chooses who changes notices and routing.' USING ERRCODE = '42501';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'Choose on or off.' USING ERRCODE = '22023';
  END IF;
  SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u WHERE u.id = auth.uid();
  IF p_on THEN
    IF NOT EXISTS (SELECT 1 FROM public.cockpit_members m WHERE m.id = p_member_id AND m.active) THEN
      RAISE EXCEPTION 'Choose an active seat.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.cockpit_forms_editors(member_id, added_by) VALUES (p_member_id, coalesce(v_email, 'unknown'))
    ON CONFLICT (member_id) DO NOTHING;
  ELSE
    -- A seat that has since been switched off can still be taken off the list.
    IF NOT EXISTS (SELECT 1 FROM public.cockpit_members m WHERE m.id = p_member_id) THEN
      RAISE EXCEPTION 'Choose an active seat.' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.cockpit_forms_editors WHERE member_id = p_member_id;
  END IF;
  RETURN public.cockpit_slack_notice_settings_read();
END $$;

-- ---------------------------------------------------------------------------
-- 9. The minute kick: sweep, and post a run only when there is work

CREATE OR REPLACE FUNCTION public.cockpit_slack_notices_kick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_url constant text := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-notices';
  v_secret text;
  v_anon text;
  v_headers jsonb;
  v_request bigint;
  v_note text;
BEGIN
  -- A sweep that fails is noted with the queue's other failures; what is
  -- already queued still goes out.
  BEGIN
    PERFORM public.cockpit_slack_notice_sweep();
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_slack_notice_queue_failed('The sweep failed: ' || SQLERRM);
  END;
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_slack_notices n WHERE n.state = 'queued' AND n.next_attempt_at <= now())
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_notices n
                      WHERE n.state = 'unknown' AND n.claimed_at > now() - interval '24 hours'
                        AND (n.checked_at IS NULL OR n.checked_at < now() - interval '10 minutes'))
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_slack_channels c WHERE c.state = 'checking') THEN
    INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, updated_at)
    VALUES ('slack-notices-kick', now(), now(), true, 'Nothing to send', now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = now(), ok = true, note = EXCLUDED.note, updated_at = now();
    RETURN NULL;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = $1 LIMIT 1'
      INTO v_secret USING 'cockpit_notices_cron_secret';
    EXECUTE 'SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = $1 LIMIT 1'
      INTO v_anon USING 'cockpit_anon_key';
  END IF;
  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    v_note := 'The vault has no cockpit_notices_cron_secret, so the Slack notices did not run. Add it to the vault.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace ns ON ns.oid = f.pronamespace
                     WHERE ns.nspname = 'net' AND f.proname = 'http_post') THEN
    v_note := 'pg_net is not installed, so the Slack notices did not run.';
  END IF;
  IF v_note IS NOT NULL THEN
    INSERT INTO public.cockpit_sync_state(key, last_run_at, ok, note, updated_at)
    VALUES ('slack-notices-kick', now(), false, v_note, now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now(), ok = false, note = EXCLUDED.note, updated_at = now();
    RETURN NULL;
  END IF;
  v_headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret);
  IF nullif(btrim(v_anon), '') IS NOT NULL THEN
    v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || btrim(v_anon));
  END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)' INTO v_request
    USING v_url, jsonb_build_object('job', 'run'), v_headers;
  INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, updated_at)
  VALUES ('slack-notices-kick', now(), now(), true, 'Posted a notices run', now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = now(), ok = true, note = EXCLUDED.note, updated_at = now();
  RETURN v_request;
END $$;

DO $$ BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname=''mahara-slack-notices''';
    EXECUTE $q$SELECT cron.schedule('mahara-slack-notices','* * * * *',$job$SELECT public.cockpit_slack_notices_kick();$job$)$q$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 10. Function privileges: revoked from all four roles, then exactly one grant

DO $$
DECLARE f text;
BEGIN
  -- Internal: no role at all (definer functions, triggers and pg_cron as owner).
  FOREACH f IN ARRAY ARRAY[
    'cockpit_slack_notice_ts(text)', 'cockpit_slack_notice_iso(timestamptz)',
    'cockpit_slack_notice_card_done(text,timestamptz,timestamptz)', 'cockpit_slack_notice_shape(text)',
    'cockpit_slack_notice_kind_label(text)', 'cockpit_slack_notice_role_of(text)', 'cockpit_slack_notice_seat_label(text,text)',
    'cockpit_slack_notice_mentions(text[],bigint[],text)', 'cockpit_slack_notice_claim_mentions(text,text)',
    'cockpit_slack_notice_target(text)', 'cockpit_slack_notice_queue(text,text,text,text,jsonb,uuid,text,text)',
    'cockpit_slack_notice_kickoff_facts(text,text,jsonb,text)', 'cockpit_slack_notice_typeform_facts(text,text,jsonb)',
    'cockpit_slack_notice_close_facts(public.cockpit_creative_outbox)', 'cockpit_slack_notice_media_facts(public.cockpit_creative_outbox)',
    'cockpit_slack_notice_updated_facts(public.cockpit_creative_outbox)', 'cockpit_slack_notice_offer_facts(public.cockpit_creative_outbox)',
    'cockpit_slack_notice_live(public.cockpit_slack_notices)', 'cockpit_slack_notice_view(public.cockpit_slack_notices)',
    'cockpit_forms_editor_gate()', 'cockpit_slack_notice_viewer()',
    'cockpit_slack_notice_guard()', 'cockpit_slack_notice_refuse_delete()', 'cockpit_slack_notice_audit()',
    'cockpit_slack_notice_queue_failed(text)', 'cockpit_slack_notice_from_onboarding()', 'cockpit_slack_notice_from_outbox()',
    'cockpit_slack_notices_kick()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- The sender's RPCs: the service key only.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_slack_notice_sweep()', 'cockpit_slack_notice_claim(integer,uuid)',
    'cockpit_slack_notice_result(uuid,text,text,text,text,jsonb)', 'cockpit_slack_notice_unknowns(integer)',
    'cockpit_slack_channel_pending()', 'cockpit_slack_channel_checked(text,boolean,text,boolean,text)',
    'cockpit_slack_notice_inputs(jsonb)', 'cockpit_slack_notice_doctor_inputs()',
    'cockpit_slack_notice_rehearse_service(text,text)', 'cockpit_slack_notice_fix(uuid,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  -- The screens' RPCs: a signed-in seat, gated inside.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_slack_notice_read(text)', 'cockpit_slack_notice_settings_read()', 'cockpit_slack_notice_settings_set(text,jsonb)',
    'cockpit_slack_channel_add(text,text)', 'cockpit_slack_channel_remove(text)', 'cockpit_slack_notice_rehearse(text)',
    'cockpit_forms_editor_set(uuid,boolean)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 11. Seeds (after the triggers exist)

INSERT INTO public.cockpit_slack_channels(id, name, private, state, note, checked_at, added_by) VALUES
  ('C09RZ0GS0V9', 'csm-general', true, 'ok', 'Seeded: mahara-club-bot was a member on 2026-10-25.', now(), 'migration'),
  ('C0AE8G5MT7Y', 'media-general', true, 'ok', 'Seeded: mahara-club-bot was a member on 2026-10-25.', now(), 'migration')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.cockpit_slack_notice_settings(kind, enabled, channel, mention_rule, updated_by) VALUES
  ('kickoff', true, 'C09RZ0GS0V9', ARRAY['seat:creative']::text[], 'migration'),
  ('kickoff.late', true, NULL, ARRAY['seat:csm','seat:systems_manager']::text[], 'migration'),
  ('kickoff.second', true, NULL, ARRAY['seat:csm']::text[], 'migration'),
  ('kickoff.updated', true, NULL, '{}'::text[], 'migration'),
  ('blueprint.close', true, 'C09RZ0GS0V9', ARRAY['seat:csm']::text[], 'migration'),
  ('blueprint.updated', true, NULL, '{}'::text[], 'migration'),
  ('blueprint.media', true, 'C0AE8G5MT7Y', '{}'::text[], 'migration'),
  ('blueprint.offer', true, NULL, '{}'::text[], 'migration')
ON CONFLICT (kind) DO NOTHING;

-- Every kickoff already in the mirror and older than 48 hours is recorded as
-- skipped, so switching the notices on posts nothing old. Newer ones are left
-- to the sweep. No Blueprint record is seeded (an old one would silence that
-- card's first native close).
SELECT public.cockpit_slack_notice_queue('kickoff', 'kickoff:' || (o.forms->'kickoff'->>'response_id'),
  o.clickup_task_id, o.client_name,
  public.cockpit_slack_notice_kickoff_facts(o.clickup_task_id, o.client_name, o.forms, NULL),
  NULL, 'skipped', 'This kickoff was more than 48 hours old when the notices began, so it was not posted.')
FROM public.cockpit_client_onboarding o
WHERE nullif(o.forms->'kickoff'->>'response_id', '') IS NOT NULL
  AND coalesce(public.cockpit_slack_notice_ts(o.forms->'kickoff'->>'submitted_at'), '-infinity') <= now() - interval '48 hours';

NOTIFY pgrst, 'reload schema';
COMMIT;
