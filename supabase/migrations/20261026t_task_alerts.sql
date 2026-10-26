-- Task alerts: one task mirror and one alert feed for every seat
-- (docs/requests/CONTRACT.md section 3; PLAN D19, D17). Creative Triage
-- (bldgtotkfmhoxmlzowdx). Applies after 20261026r_requests.sql and
-- 20261026s_request_types_seed.sql; additive; applies twice.
--
-- 1. cockpit_task_mirror: one row per ClickUp task a read has seen, filled by
--    the Edge Function cockpit-tasks (a workspace delta every 2 minutes, a
--    full read per linked seat every hour, and the focus view's live read).
--    It is a cache of ClickUp: one audit row per run, never one per task.
-- 2. cockpit_task_alerts: append-only alert rows per seat (assigned, due
--    today, overdue, a comment, a mention, a status change, a request done or
--    failed). Only read_at ever changes, once. Made here in SQL, never in a
--    browser. No alert before the first complete seats run (the baseline), so
--    switching the mirror on or linking a seat never floods a bell.
-- 3. cockpit_task_alert_rules: which kinds a seat wants and its shift (when
--    the daily due and overdue alerts appear). Absent means every kind and the
--    seat's own schedule. Slack messages are not in this build: slack_dm is
--    held false by a CHECK the DM slice lifts.
-- 4. The browser RPCs: Your tasks, the bell, the focus view, a tick, comment
--    or Mark done (a cockpit_clickup_writeback_queue row of kind task_action,
--    written by clickup-writeback job requests behind its own switch), and the
--    alert rules. The service RPCs cockpit-tasks calls. Two kicks on pg_cron.
--
-- Row security is on for every new table, every browser and default grant is
-- revoked, and the service role may only read them: every write goes through
-- the SECURITY DEFINER functions below. pg_cron, pg_net and the vault are
-- touched only where they exist, so PGlite applies the file.
--
-- Operator notes
-- - The kicks post to cockpit-tasks with x-cron-secret from the vault's
--   cockpit_tasks_cron_secret (the function secret TASKS_CRON_SECRET). Until
--   it exists, cockpit_sync_state key task-mirror:kick says so and nothing runs.
-- - Your tasks and the bell say "not linked" for a seat with no ClickUp user;
--   link it in Requests settings, People in ClickUp (20261026r).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables

CREATE TABLE IF NOT EXISTS public.cockpit_task_mirror (
  task_id          text PRIMARY KEY CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  list_id          text NOT NULL,
  list_name        text,
  folder_id        text,
  space_id         text,
  parent_id        text,
  name             text NOT NULL CHECK (char_length(name) <= 500),
  status           text NOT NULL,
  status_type      text NOT NULL,
  priority         text CHECK (priority IS NULL OR priority IN ('urgent','high','normal','low')),
  due_at           timestamptz,
  -- The Kuwait day of due_at.
  due_on           date,
  -- NULL until the focus read fills it: the team endpoint has no due_date_time.
  due_has_time     boolean,
  assignee_ids     bigint[] NOT NULL DEFAULT '{}'::bigint[],
  watcher_ids      bigint[] NOT NULL DEFAULT '{}'::bigint[],
  creator_id       bigint,
  tags             text[] NOT NULL DEFAULT '{}'::text[],
  -- The card itself on Clients - Mahara; else the request's card; else one tag
  -- equal to exactly one card's client name.
  client_task_id   text,
  url              text NOT NULL,
  date_created     timestamptz NOT NULL,
  date_updated     timestamptz NOT NULL,
  date_closed      timestamptz,
  archived         boolean NOT NULL DEFAULT false,
  checklist_done   integer,
  checklist_total  integer,
  comments_read_at timestamptz,
  -- A comment thread read that failed: how many in a row, and when the last
  -- one failed (cockpit_task_mirror_comment_due steps such a task back).
  comments_failures  integer NOT NULL DEFAULT 0 CHECK (comments_failures >= 0),
  comments_failed_at timestamptz,
  -- The focus read's cache: {dueHasTime, description, checklists, subtasks, comments, statuses}.
  detail           jsonb CHECK (detail IS NULL OR jsonb_typeof(detail) = 'object'),
  detail_at        timestamptz,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  seen_at          timestamptz NOT NULL DEFAULT now(),
  -- Not seen by any read for 7 days.
  gone_at          timestamptz
);
ALTER TABLE public.cockpit_task_mirror ADD COLUMN IF NOT EXISTS comments_failures integer NOT NULL DEFAULT 0 CHECK (comments_failures >= 0);
ALTER TABLE public.cockpit_task_mirror ADD COLUMN IF NOT EXISTS comments_failed_at timestamptz;
CREATE INDEX IF NOT EXISTS cockpit_task_mirror_assignees ON public.cockpit_task_mirror USING gin (assignee_ids);
CREATE INDEX IF NOT EXISTS cockpit_task_mirror_updated ON public.cockpit_task_mirror (date_updated);
CREATE INDEX IF NOT EXISTS cockpit_task_mirror_list ON public.cockpit_task_mirror (list_id);
CREATE INDEX IF NOT EXISTS cockpit_task_mirror_client ON public.cockpit_task_mirror (client_task_id);

CREATE TABLE IF NOT EXISTS public.cockpit_task_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid NOT NULL REFERENCES public.cockpit_members(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('assigned','due_today','overdue','comment','mention','status','request_done','request_failed')),
  dedupe_key  text NOT NULL UNIQUE CHECK (char_length(dedupe_key) BETWEEN 3 AND 300),
  task_id     text,
  request_id  uuid,
  list_id     text,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 240),
  client_name text,
  actor_label text,
  -- Which cockpits show it: NULL every one; 'editor' only the editor desk;
  -- 'not_editor' every one but the editor desk (a due today count that holds
  -- Video Pipeline tasks, which the editor desk keeps on its Jobs page).
  scope       text CHECK (scope IS NULL OR scope IN ('editor','not_editor')),
  -- When it happened.
  at          timestamptz NOT NULL,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cockpit_task_alerts ADD COLUMN IF NOT EXISTS scope text CHECK (scope IS NULL OR scope IN ('editor','not_editor'));
CREATE INDEX IF NOT EXISTS cockpit_task_alerts_member ON public.cockpit_task_alerts (member_id, at DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_task_alert_rules (
  member_id   uuid PRIMARY KEY REFERENCES public.cockpit_members(id) ON DELETE CASCADE,
  kinds       text[] NOT NULL DEFAULT ARRAY['assigned','due_today','overdue','comment','mention','status','request_done','request_failed']::text[],
  -- NULL together: the seat's cockpit_people schedule, else 10:00 to 18:00 Sunday to Thursday.
  shift_start time,
  shift_end   time,
  slack_dm    boolean NOT NULL DEFAULT false,
  updated_by  text NOT NULL CHECK (btrim(updated_by) <> ''),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cockpit_task_alert_rules_kinds CHECK (
    kinds <@ ARRAY['assigned','due_today','overdue','comment','mention','status','request_done','request_failed']::text[]
    AND 'request_failed' = ANY(kinds)),
  CONSTRAINT cockpit_task_alert_rules_shift CHECK (
    (shift_start IS NULL) = (shift_end IS NULL) AND (shift_start IS NULL OR shift_start < shift_end)),
  -- The Slack DM slice lifts this (contract R10).
  CONSTRAINT cockpit_task_alert_rules_no_dm CHECK (slack_dm = false)
);

ALTER TABLE public.cockpit_task_mirror ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_task_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_task_alert_rules ENABLE ROW LEVEL SECURITY;
-- No policies: the browser reaches these only through the functions below.
REVOKE ALL ON public.cockpit_task_mirror, public.cockpit_task_alerts, public.cockpit_task_alert_rules
  FROM PUBLIC, anon, authenticated, service_role;
-- The guardian reads; every write goes through the definer functions.
GRANT SELECT ON public.cockpit_task_mirror, public.cockpit_task_alerts, public.cockpit_task_alert_rules TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Internal helpers (no role may execute them)

-- The eight alert kinds, in the order the settings list them.
CREATE OR REPLACE FUNCTION public.cockpit_task_alert_kinds()
RETURNS text[] LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ARRAY['assigned','due_today','overdue','comment','mention','status','request_done','request_failed']::text[]
$$;

-- The cockpit a read is for; anything else refuses.
CREATE OR REPLACE FUNCTION public.cockpit_task_cockpit(p_cockpit text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_cockpit IS NULL OR p_cockpit NOT IN ('portal','media_buyer','csm','creative','editor','sales') THEN
    RAISE EXCEPTION 'Unknown cockpit. Use portal, media_buyer, csm, creative, editor or sales.' USING ERRCODE = '22023';
  END IF;
  RETURN p_cockpit;
END $$;

-- Whether a cockpit leaves a task out (review 2026-10-26, asks F1 and F2):
-- - a client card itself (a top-level task on Clients - Mahara), never a
--   real subtask of a card assigned to someone; a mention on a card still
--   shows in the bell;
-- - in the editor desk, Video Pipeline tasks on Your tasks only (p_kind
--   NULL), because its Jobs page lists them. The editor's own Video Pipeline
--   alerts always show: no other screen there tells them.
-- p_top: the task has no parent (NULL when not known, read as top-level).
DROP FUNCTION IF EXISTS public.cockpit_task_hidden(text, text, text);
CREATE OR REPLACE FUNCTION public.cockpit_task_hidden(p_cockpit text, p_list text, p_kind text, p_top boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (coalesce(p_list, '') = '901816559981' AND coalesce(p_top, true) AND coalesce(p_kind, '') <> 'mention')
      OR (p_kind IS NULL AND coalesce(p_cockpit, '') = 'editor' AND coalesce(p_list, '') = '901816720767')
$$;

-- Whether a cockpit's bell leaves an alert out: its scope, then the rule above
-- (a card's subtask is known from the mirror).
CREATE OR REPLACE FUNCTION public.cockpit_task_alert_hidden(p_cockpit text, a public.cockpit_task_alerts)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (coalesce(a.scope, '') = 'editor' AND coalesce(p_cockpit, '') <> 'editor')
      OR (coalesce(a.scope, '') = 'not_editor' AND coalesce(p_cockpit, '') = 'editor')
      OR public.cockpit_task_hidden(p_cockpit, a.list_id, a.kind,
           NOT EXISTS (SELECT 1 FROM public.cockpit_task_mirror m WHERE m.task_id = a.task_id AND m.parent_id IS NOT NULL))
$$;

-- One audit row, as every person's write here leaves.
CREATE OR REPLACE FUNCTION public.cockpit_task_audit(p_action text, p_entity_type text, p_entity_id text, p_actor text,
  p_before jsonb, p_after jsonb, p_meta jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (p_action, p_entity_type, p_entity_id, p_actor, 'shared-cockpits',
          coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'),
          p_before, p_after, coalesce(p_meta, '{}'::jsonb))
$$;

-- The mirror's freshness and the baseline: {sourceAt, ready, baselinedAt}.
CREATE OR REPLACE FUNCTION public.cockpit_task_state()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.cockpit_sync_state; s public.cockpit_sync_state; v_base timestamptz;
BEGIN
  SELECT * INTO d FROM public.cockpit_sync_state WHERE key = 'task-mirror:delta';
  SELECT * INTO s FROM public.cockpit_sync_state WHERE key = 'task-mirror:seats';
  BEGIN
    v_base := (s.detail->>'baselinedAt')::timestamptz;
  EXCEPTION WHEN others THEN
    v_base := NULL;
  END;
  RETURN jsonb_build_object('sourceAt', d.last_ok_at,
    'ready', coalesce(d.ok, false) AND d.last_ok_at IS NOT NULL AND d.last_ok_at >= now() - interval '10 minutes',
    'baselinedAt', v_base);
END $$;

-- When the first complete seats run finished; NULL before it (no alert then).
CREATE OR REPLACE FUNCTION public.cockpit_task_baseline()
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN (public.cockpit_task_state()->>'baselinedAt')::timestamptz;
END $$;

-- The active seats linked to a ClickUp user, and when the link was made.
CREATE OR REPLACE FUNCTION public.cockpit_task_linked()
RETURNS TABLE(member_id uuid, clickup_user_id bigint, email text, linked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.id, l.clickup_user_id, lower(btrim(m.email)), l.updated_at
    FROM public.cockpit_member_clickup l JOIN public.cockpit_members m ON m.id = l.member_id
   WHERE m.active AND l.state IN ('ok','manual') AND l.clickup_user_id IS NOT NULL
$$;

-- The kinds a seat wants (every kind when it has no rules row).
CREATE OR REPLACE FUNCTION public.cockpit_task_kinds(p_member uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT r.kinds FROM public.cockpit_task_alert_rules r WHERE r.member_id = p_member),
                  public.cockpit_task_alert_kinds())
$$;

-- One alert row: only for an active seat that wants the kind (a failed
-- request always alerts), once per dedupe key. Returns 1 when it was made.
DROP FUNCTION IF EXISTS public.cockpit_task_alert_add(uuid, text, text, text, uuid, text, text, text, text, text, timestamptz);
CREATE OR REPLACE FUNCTION public.cockpit_task_alert_add(p_member uuid, p_kind text, p_key text, p_task text, p_request uuid,
  p_list text, p_title text, p_body text, p_client text, p_actor text, p_at timestamptz, p_scope text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
  IF p_member IS NULL OR p_key IS NULL THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_members m WHERE m.id = p_member AND m.active) THEN RETURN 0; END IF;
  IF p_kind <> 'request_failed' AND NOT (p_kind = ANY(public.cockpit_task_kinds(p_member))) THEN RETURN 0; END IF;
  INSERT INTO public.cockpit_task_alerts(member_id, kind, dedupe_key, task_id, request_id, list_id, title, body,
    client_name, actor_label, scope, at)
  VALUES (p_member, p_kind, left(p_key, 300), p_task, p_request, p_list,
    left(coalesce(nullif(btrim(p_title), ''), 'A ClickUp task'), 200),
    left(coalesce(nullif(btrim(p_body), ''), 'Open it to see what changed.'), 240),
    p_client, p_actor, p_scope, coalesce(p_at, now()))
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- "The systems manager commented" from a role label; anyone the cockpit
-- cannot name is "A teammate".
CREATE OR REPLACE FUNCTION public.cockpit_task_actor_phrase(p_label text, p_verb text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_label IS NULL OR btrim(p_label) = '' OR p_label IN ('a ClickUp member','a team member','Nobody yet','the cockpit')
      THEN 'A teammate ' || p_verb
    ELSE upper(left(btrim(p_label), 1)) || substr(btrim(p_label), 2) || ' ' || p_verb
  END
$$;

-- The client card a task belongs to (contract 3.1).
CREATE OR REPLACE FUNCTION public.cockpit_task_client_of(p_task text, p_list text, p_tags text[])
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_card text; v_cards text[];
BEGIN
  IF p_list = '901816559981' THEN RETURN p_task; END IF;
  SELECT r.client_task_id INTO v_card
    FROM public.cockpit_request_parts p JOIN public.cockpit_requests r ON r.id = p.request_id
   WHERE p.clickup_task_id = p_task AND r.client_task_id IS NOT NULL
   ORDER BY p.created_at LIMIT 1;
  IF v_card IS NOT NULL THEN RETURN v_card; END IF;
  IF coalesce(cardinality(p_tags), 0) > 0 THEN
    SELECT array_agg(DISTINCT o.clickup_task_id) INTO v_cards FROM public.cockpit_client_onboarding o
     WHERE lower(btrim(o.client_name)) IN (SELECT lower(btrim(t)) FROM unnest(p_tags) t WHERE btrim(t) <> '');
    IF coalesce(cardinality(v_cards), 0) = 1 THEN RETURN v_cards[1]; END IF;
  END IF;
  RETURN NULL;
END $$;

-- One task as the screens read it (TaskRow, contract 3.3).
CREATE OR REPLACE FUNCTION public.cockpit_task_row(m public.cockpit_task_mirror)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_late boolean; v_req_id uuid; v_req_label text; v_client text;
BEGIN
  v_late := m.due_on IS NOT NULL AND (m.due_on < v_today OR (m.due_has_time IS TRUE AND m.due_at < now()));
  SELECT r.id, r.type_label INTO v_req_id, v_req_label
    FROM public.cockpit_request_parts p JOIN public.cockpit_requests r ON r.id = p.request_id
   WHERE p.clickup_task_id = m.task_id ORDER BY p.created_at LIMIT 1;
  IF m.client_task_id IS NOT NULL THEN
    SELECT o.client_name INTO v_client FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = m.client_task_id;
  END IF;
  RETURN jsonb_build_object('taskId', m.task_id, 'title', m.name, 'clientName', v_client, 'clientTaskId', m.client_task_id,
    'listId', m.list_id, 'listName', m.list_name, 'status', m.status, 'statusType', m.status_type,
    'dueOn', to_char(m.due_on, 'YYYY-MM-DD'), 'dueAt', m.due_at, 'dueHasTime', m.due_has_time,
    'overdue', v_late, 'dueToday', coalesce(m.due_on = v_today, false) AND NOT v_late,
    'priority', m.priority, 'url', m.url, 'createdAt', m.date_created, 'parentId', m.parent_id,
    'checklist', CASE WHEN coalesce(m.checklist_total, 0) > 0
                      THEN jsonb_build_object('done', coalesce(m.checklist_done, 0), 'total', m.checklist_total) END,
    'requestId', v_req_id, 'requestTypeLabel', v_req_label);
END $$;

-- Whether a seat may open a task: an assignee or watcher, the seat that
-- filed the request the task came from, an admin or the CEO.
CREATE OR REPLACE FUNCTION public.cockpit_task_may_open(p_seat jsonb, p_task_id text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_cu bigint := CASE WHEN jsonb_typeof(p_seat->'clickupUserId') = 'number' THEN (p_seat->>'clickupUserId')::bigint END;
BEGIN
  IF coalesce((p_seat->>'isAdmin')::boolean, false) OR coalesce((p_seat->>'isCeo')::boolean, false) THEN RETURN true; END IF;
  IF v_cu IS NOT NULL AND EXISTS (SELECT 1 FROM public.cockpit_task_mirror m
                                   WHERE m.task_id = p_task_id AND (v_cu = ANY(m.assignee_ids) OR v_cu = ANY(m.watcher_ids))) THEN
    RETURN true;
  END IF;
  RETURN public.cockpit_task_requester_of(p_seat, p_task_id);
END $$;

-- Whether the seat filed the request this task came from.
CREATE OR REPLACE FUNCTION public.cockpit_task_requester_of(p_seat jsonb, p_task_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.cockpit_request_parts p JOIN public.cockpit_requests r ON r.id = p.request_id
                  WHERE p.clickup_task_id = p_task_id AND r.requester_member_id IS NOT NULL
                    AND r.requester_member_id::text = p_seat->>'memberId')
$$;

-- Whether a list is one of the team request boards (the five department
-- lists and All Tasks), where ticking and Mark done work.
CREATE OR REPLACE FUNCTION public.cockpit_task_board(p_list text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(public.cockpit_request_lists()) x WHERE x->>'listId' = p_list)
$$;

-- Whether the writer would take a change on this task now.
CREATE OR REPLACE FUNCTION public.cockpit_task_writer_open(p_client_task text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_mode jsonb := public.cockpit_clickup_requests_mode();
BEGIN
  RETURN v_mode->>'mode' = 'apply'
      OR (v_mode->>'mode' = 'apply_limited' AND p_client_task IS NOT NULL AND coalesce(v_mode->'onlyCards', '[]'::jsonb) ? p_client_task);
END $$;

-- What the focus view may offer on a task: {tick, comment, done, why}.
CREATE OR REPLACE FUNCTION public.cockpit_task_can(p_seat jsonb, m public.cockpit_task_mirror)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_priv boolean := coalesce((p_seat->>'isAdmin')::boolean, false) OR coalesce((p_seat->>'isCeo')::boolean, false);
  v_linked boolean := jsonb_typeof(p_seat->'clickupUserId') = 'number';
  v_board boolean; v_card boolean;
BEGIN
  IF NOT (v_linked OR v_priv) THEN
    RETURN jsonb_build_object('tick', false, 'comment', false, 'done', false,
      'why', 'Link your seat to ClickUp to tick, comment and mark done here. Ask the systems manager.');
  END IF;
  IF m.task_id IS NULL THEN
    RETURN jsonb_build_object('tick', false, 'comment', false, 'done', false,
      'why', 'This task has not been read from ClickUp yet. Try again in two minutes.');
  END IF;
  IF NOT public.cockpit_task_writer_open(m.client_task_id) THEN
    RETURN jsonb_build_object('tick', false, 'comment', false, 'done', false,
      'why', 'Changes from the cockpit are not switched on yet. Open the task in ClickUp.');
  END IF;
  v_card := m.list_id = '901816559981';
  v_board := public.cockpit_task_board(m.list_id);
  RETURN jsonb_build_object('tick', v_board, 'comment', NOT v_card, 'done', v_board,
    'why', CASE WHEN v_card THEN 'This is a client card. Open it in ClickUp.'
                WHEN NOT v_board THEN 'Ticking and Mark done work on the team request boards. Open this one in ClickUp.' END);
END $$;

-- Who wrote a comment, as the team sees it: {label, memberId, cockpit, quiet}.
-- The API user 284616470 is the CEO's own ClickUp account, which the cockpit
-- also writes with (review 2026-10-26, F8):
-- - with a focus view's "Cockpit ref T-" that matches a press: the seat that
--   pressed Comment;
-- - with any other "Cockpit ref" marker (a request's card comment, or a T-
--   that matches no press): the cockpit (cockpit true);
-- - with no marker: the CEO, by role. ClickUp cannot tell the CEO's own hand
--   from an automation on the same account, so such a comment makes no
--   comment alert (quiet true); a mention in it still alerts.
CREATE OR REPLACE FUNCTION public.cockpit_task_comment_author(p_author bigint, p_text text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ref text; v_payload jsonb; v_member uuid;
BEGIN
  IF p_author = 284616470 THEN
    v_ref := substring(coalesce(p_text, '') FROM 'Cockpit ref (T-[0-9a-f]{10})');
    IF v_ref IS NOT NULL THEN
      SELECT q.payload INTO v_payload FROM public.cockpit_clickup_writeback_queue q
       WHERE q.kind = 'task_action' AND q.payload->>'ref' = v_ref ORDER BY q.created_at LIMIT 1;
      IF v_payload IS NOT NULL THEN
        RETURN jsonb_build_object('label', coalesce(v_payload->'actor'->>'label', 'a team member'),
          'memberId', v_payload->'actor'->>'memberId', 'cockpit', false, 'quiet', false);
      END IF;
    END IF;
    IF coalesce(p_text, '') ~ 'Cockpit ref [A-Za-z0-9-]+' THEN
      RETURN jsonb_build_object('label', 'the cockpit', 'memberId', NULL, 'cockpit', true, 'quiet', true);
    END IF;
    SELECT l.member_id INTO v_member FROM public.cockpit_task_linked() l WHERE l.clickup_user_id = p_author LIMIT 1;
    RETURN jsonb_build_object('label', 'the CEO', 'memberId', v_member, 'cockpit', false, 'quiet', true);
  END IF;
  SELECT l.member_id INTO v_member FROM public.cockpit_task_linked() l WHERE l.clickup_user_id = p_author LIMIT 1;
  RETURN jsonb_build_object('label', public.cockpit_request_owner_label(p_author), 'memberId', v_member, 'cockpit', false,
    'quiet', false);
END $$;

-- The tasks one seat's Your tasks shows in one cockpit at p_now (contract
-- 3.3): open, not archived, not gone, not hidden there, and a subtask whose
-- parent is in the set folds under it. The daily due today count reads the
-- same set (review 2026-10-26, contract F2), so the alert and the card agree.
CREATE OR REPLACE FUNCTION public.cockpit_task_my_set(p_cu bigint, p_cockpit text, p_now timestamptz)
RETURNS TABLE(task_id text, due_on date, due_at timestamptz, date_created timestamptz, late boolean, today boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH mine AS (
    SELECT m.task_id, m.parent_id, m.due_on, m.due_at, m.due_has_time, m.date_created
      FROM public.cockpit_task_mirror m
     WHERE p_cu IS NOT NULL AND m.assignee_ids @> ARRAY[p_cu] AND m.status_type NOT IN ('done','closed')
       AND NOT m.archived AND m.gone_at IS NULL
       AND NOT public.cockpit_task_hidden(p_cockpit, m.list_id, NULL, m.parent_id IS NULL)
  )
  SELECT x.task_id, x.due_on, x.due_at, x.date_created,
         x.due_on IS NOT NULL AND (x.due_on < (p_now AT TIME ZONE 'Asia/Kuwait')::date
                                   OR (x.due_has_time IS TRUE AND x.due_at < p_now)),
         coalesce(x.due_on = (p_now AT TIME ZONE 'Asia/Kuwait')::date, false)
    FROM mine x
   WHERE x.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM mine y WHERE y.task_id = x.parent_id)
$$;

-- A seat's shift on the day of p_at (contract 3.2): the rules' times, else
-- the seat's cockpit_people schedule (exceptions first), else 10:00 to 18:00
-- Kuwait, Sunday to Thursday. A day the schedule has off, or a Friday or
-- Saturday with no schedule, is not a working day.
CREATE OR REPLACE FUNCTION public.cockpit_task_shift(p_member uuid, p_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email text; v_sched jsonb; v_tz text := 'Asia/Kuwait'; v_local timestamp; v_day date; v_dow text;
  v_line jsonb; v_ex jsonb; v_on boolean; v_start time; v_end time; v_source text;
  v_rules public.cockpit_task_alert_rules; v_days jsonb; v_first jsonb; d text;
  v_dows constant text[] := ARRAY['sun','mon','tue','wed','thu','fri','sat'];
BEGIN
  SELECT lower(btrim(m.email)) INTO v_email FROM public.cockpit_members m WHERE m.id = p_member;
  SELECT pp.schedule INTO v_sched FROM public.cockpit_people pp
   WHERE pp.active AND lower(btrim(pp.email)) = v_email
     AND jsonb_typeof(pp.schedule) = 'object' AND jsonb_typeof(pp.schedule->'week') = 'object'
   ORDER BY pp.id LIMIT 1;
  IF v_sched IS NOT NULL AND nullif(btrim(v_sched->>'timezone'), '') IS NOT NULL THEN
    BEGIN
      v_local := p_at AT TIME ZONE btrim(v_sched->>'timezone');
      v_tz := btrim(v_sched->>'timezone');
    EXCEPTION WHEN others THEN
      v_tz := 'Asia/Kuwait';
    END;
  END IF;
  v_local := p_at AT TIME ZONE v_tz;
  v_day := v_local::date;
  v_dow := v_dows[extract(dow FROM v_day)::integer + 1];
  SELECT * INTO v_rules FROM public.cockpit_task_alert_rules r WHERE r.member_id = p_member;
  IF v_sched IS NOT NULL THEN
    v_source := 'schedule';
    SELECT e INTO v_ex FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_sched->'exceptions') = 'array'
                                                      THEN v_sched->'exceptions' ELSE '[]'::jsonb END) e
     WHERE jsonb_typeof(e) = 'object' AND e->>'date' = to_char(v_day, 'YYYY-MM-DD') LIMIT 1;
    v_line := CASE WHEN v_ex IS NOT NULL THEN v_ex ELSE v_sched->'week'->v_dow END;
    IF v_ex IS NOT NULL AND lower(coalesce(v_ex->>'off', '')) = 'true' THEN
      v_on := false;
    ELSIF v_ex IS NOT NULL THEN
      v_on := true;
    ELSE
      v_on := lower(coalesce(v_line->>'on', '')) = 'true';
    END IF;
    IF coalesce(v_line->>'start', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN v_start := (v_line->>'start')::time; END IF;
    IF coalesce(v_line->>'end', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN v_end := (v_line->>'end')::time; END IF;
    v_days := '[]'::jsonb;
    FOREACH d IN ARRAY v_dows LOOP
      IF lower(coalesce(v_sched->'week'->d->>'on', '')) = 'true' THEN
        v_days := v_days || to_jsonb(initcap(d));
        IF v_first IS NULL THEN v_first := v_sched->'week'->d; END IF;
      END IF;
    END LOOP;
    -- On a day off, the times shown are the first working day's.
    IF NOT v_on AND v_first IS NOT NULL THEN
      v_start := CASE WHEN coalesce(v_first->>'start', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN (v_first->>'start')::time END;
      v_end := CASE WHEN coalesce(v_first->>'end', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN (v_first->>'end')::time END;
    END IF;
  ELSE
    v_source := 'default';
    v_on := v_dow IN ('sun','mon','tue','wed','thu');
    v_start := '10:00'; v_end := '18:00';
    v_days := '["Sun","Mon","Tue","Wed","Thu"]'::jsonb;
  END IF;
  IF v_rules.shift_start IS NOT NULL THEN
    v_source := 'rules'; v_start := v_rules.shift_start; v_end := v_rules.shift_end;
  END IF;
  v_start := coalesce(v_start, '10:00'::time);
  RETURN jsonb_build_object('source', v_source, 'start', to_char(v_start, 'HH24:MI'), 'end', to_char(v_end, 'HH24:MI'),
    'days', v_days, 'working', v_on, 'day', to_char(v_day, 'YYYY-MM-DD'), 'timezone', v_tz,
    'started', v_on AND v_local >= v_day + v_start);
END $$;

-- The rules read for one seat (cockpit_task_alert_rules_read's shape).
CREATE OR REPLACE FUNCTION public.cockpit_task_rules_view(p_member uuid, p_editor boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.cockpit_members; r public.cockpit_task_alert_rules; v_shift jsonb; v_seats jsonb;
BEGIN
  SELECT * INTO m FROM public.cockpit_members WHERE id = p_member;
  SELECT * INTO r FROM public.cockpit_task_alert_rules WHERE member_id = p_member;
  v_shift := public.cockpit_task_shift(p_member, now());
  IF p_editor THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('memberId', s.id,
             'label', public.cockpit_slack_notice_seat_label(s.email, s.name))
             ORDER BY public.cockpit_slack_notice_seat_label(s.email, s.name), s.id), '[]'::jsonb)
      INTO v_seats FROM public.cockpit_members s WHERE s.active;
  END IF;
  RETURN jsonb_build_object(
    'member', jsonb_build_object('id', m.id,
      'label', CASE WHEN p_editor THEN public.cockpit_slack_notice_seat_label(m.email, m.name)
                    ELSE coalesce(public.cockpit_slack_notice_role_of(m.email), 'a team member') END),
    'rules', jsonb_build_object('kinds', to_jsonb(coalesce(r.kinds, public.cockpit_task_alert_kinds())),
      'shiftStart', to_char(r.shift_start, 'HH24:MI'), 'shiftEnd', to_char(r.shift_end, 'HH24:MI'),
      'slackDm', coalesce(r.slack_dm, false)),
    'shift', jsonb_build_object('source', v_shift->>'source', 'start', v_shift->>'start', 'end', v_shift->>'end',
      'days', v_shift->'days'),
    'seats', v_seats,
    'canEditOthers', p_editor);
END $$;

-- Whose rules a call may read or change: its own, or anyone's for an editor.
CREATE OR REPLACE FUNCTION public.cockpit_task_rules_target(p_seat jsonb, p_member uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_target uuid := coalesce(p_member, (p_seat->>'memberId')::uuid);
BEGIN
  IF v_target::text <> p_seat->>'memberId' AND NOT coalesce((p_seat->>'isEditor')::boolean, false) THEN
    RAISE EXCEPTION 'Only the CEO, an admin or someone they add can see or change another seat''s alerts.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_members m WHERE m.id = v_target AND m.active) THEN
    RAISE EXCEPTION 'That seat is not active. Pick another.' USING ERRCODE = '22023';
  END IF;
  RETURN v_target;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Triggers: the alert guard, the rules audit, a failed request part

-- An alert changes once: read_at from empty to a time. It is never deleted
-- (only with its seat).
CREATE OR REPLACE FUNCTION public.cockpit_task_alerts_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'An alert is never deleted. Mark it read instead.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- The seat itself is being deleted (ON DELETE CASCADE): its alerts go with it.
    IF NOT EXISTS (SELECT 1 FROM public.cockpit_members m WHERE m.id = OLD.member_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'An alert is never deleted. Mark it read instead.' USING ERRCODE = '42501';
  END IF;
  IF OLD.read_at IS NOT NULL OR NEW.read_at IS NULL
     OR (to_jsonb(NEW) - 'read_at') IS DISTINCT FROM (to_jsonb(OLD) - 'read_at') THEN
    RAISE EXCEPTION 'An alert only changes once, when it is read.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cockpit_task_alerts_guard ON public.cockpit_task_alerts;
CREATE TRIGGER cockpit_task_alerts_guard BEFORE UPDATE OR DELETE ON public.cockpit_task_alerts
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_task_alerts_guard();
DROP TRIGGER IF EXISTS cockpit_task_alerts_no_truncate ON public.cockpit_task_alerts;
CREATE TRIGGER cockpit_task_alerts_no_truncate BEFORE TRUNCATE ON public.cockpit_task_alerts
  FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_task_alerts_guard();

CREATE OR REPLACE FUNCTION public.cockpit_task_alert_rules_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_task_audit('task_alert_rules.saved', 'cockpit_task_alert_rules', NEW.member_id::text, NEW.updated_by,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END, to_jsonb(NEW), jsonb_build_object('op', lower(TG_OP)));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cockpit_task_alert_rules_audit ON public.cockpit_task_alert_rules;
CREATE TRIGGER cockpit_task_alert_rules_audit AFTER INSERT OR UPDATE ON public.cockpit_task_alert_rules
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_task_alert_rules_audit();

-- A request part that ended failed or skipped tells the seat that asked
-- (linked or not), unless the request was cancelled.
CREATE OR REPLACE FUNCTION public.cockpit_task_request_failed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_requests;
BEGIN
  IF NEW.state NOT IN ('failed','skipped') OR (TG_OP = 'UPDATE' AND OLD.state IS NOT DISTINCT FROM NEW.state) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO r FROM public.cockpit_requests WHERE id = NEW.request_id;
  IF r.id IS NULL OR r.state = 'cancelled' OR r.requester_member_id IS NULL THEN RETURN NULL; END IF;
  PERFORM public.cockpit_task_alert_add(r.requester_member_id, 'request_failed',
    'request_failed:' || r.id::text || ':' || NEW.part, NEW.clickup_task_id, r.id, NEW.list_id,
    r.type_label || coalesce(': ' || nullif(btrim(r.client_name), ''), ''),
    'Did not reach ClickUp: ' || coalesce(nullif(btrim(NEW.error), ''), 'no reason was recorded.'),
    r.client_name, NULL, now());
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cockpit_task_request_failed ON public.cockpit_request_parts;
CREATE TRIGGER cockpit_task_request_failed AFTER INSERT OR UPDATE OF state ON public.cockpit_request_parts
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_task_request_failed();

-- The writeback queue's audit trigger (20261009f, live body read 2026-10-26)
-- copies each queue row into the audit log. A focus-view comment's words stay
-- out of it, as they stay out of task.act (contract 3.4): the audit keeps how
-- long the comment was. Every other table and kind is audited as before, and
-- the function keeps its live grant (service_role).
CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE after_row jsonb:=to_jsonb(NEW)-'planned'-'steps'; before_row jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN before_row:=to_jsonb(OLD)-'planned'-'steps'; END IF;
 IF TG_TABLE_NAME='cockpit_clickup_writeback_queue' AND after_row->>'kind'='task_action' THEN
   IF jsonb_typeof(after_row->'payload'->'text')='string' THEN
     after_row:=jsonb_set(after_row,'{payload,text}',to_jsonb(format('(%s characters, left out of the audit)',length(after_row->'payload'->>'text'))));
   END IF;
   IF jsonb_typeof(before_row->'payload'->'text')='string' THEN
     before_row:=jsonb_set(before_row,'{payload,text}',to_jsonb(format('(%s characters, left out of the audit)',length(before_row->'payload'->>'text'))));
   END IF;
 END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after",metadata)
 VALUES(lower(TG_OP)||':'||coalesce(after_row->>'state',after_row->>'status',CASE WHEN after_row->>'finished_at' IS NOT NULL THEN 'finished' ELSE 'started' END),
  TG_TABLE_NAME,after_row->>'id',CASE WHEN TG_TABLE_NAME LIKE 'cockpit_media_tracking%' THEN 'tracking-audit' ELSE 'clickup-writeback' END,
  'media-buyer','supabase',before_row,after_row,'{}'::jsonb);
 RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Browser RPCs (a signed-in seat; the gate first)

-- Your tasks (contract 3.3, MyTasks).
CREATE OR REPLACE FUNCTION public.cockpit_my_tasks(p_cockpit text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  v_cockpit text := public.cockpit_task_cockpit(p_cockpit);
  v_state jsonb := public.cockpit_task_state();
  v_cu bigint; v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_rows jsonb; v_total integer; v_late integer; v_due integer;
BEGIN
  v_cu := CASE WHEN jsonb_typeof(v_seat->'clickupUserId') = 'number' THEN (v_seat->>'clickupUserId')::bigint END;
  IF v_cu IS NULL THEN
    RETURN jsonb_build_object('asOf', now(), 'sourceAt', v_state->'sourceAt', 'ready', v_state->'ready', 'link', 'not_linked',
      'note', 'Your seat is not linked to a ClickUp user, so your tasks cannot show here. Ask the systems manager to link it.',
      'counts', jsonb_build_object('overdue', 0, 'today', 0, 'total', 0), 'tasks', '[]'::jsonb, 'more', 0);
  END IF;
  WITH shown AS (
    -- A subtask whose parent is in the list shows with its parent, not apart.
    SELECT x.* FROM public.cockpit_task_my_set(v_cu, v_cockpit, now()) x
  ), ranked AS (
    SELECT s.task_id, s.late, s.today,
           row_number() OVER (ORDER BY CASE WHEN s.late THEN 0 WHEN s.today THEN 1 ELSE 2 END,
                                       CASE WHEN s.late OR s.today THEN s.due_at END ASC NULLS LAST,
                                       s.date_created DESC, s.task_id) AS n
      FROM shown s
  )
  SELECT coalesce(jsonb_agg(public.cockpit_task_row(m2) ORDER BY rk.n) FILTER (WHERE rk.n <= 200), '[]'::jsonb),
         count(*)::integer, (count(*) FILTER (WHERE rk.late))::integer, (count(*) FILTER (WHERE rk.today AND NOT rk.late))::integer
    INTO v_rows, v_total, v_late, v_due
    FROM ranked rk JOIN public.cockpit_task_mirror m2 ON m2.task_id = rk.task_id;
  RETURN jsonb_build_object('asOf', now(), 'sourceAt', v_state->'sourceAt', 'ready', v_state->'ready', 'link', 'linked',
    'note', NULL, 'counts', jsonb_build_object('overdue', v_late, 'today', v_due, 'total', v_total),
    'tasks', v_rows, 'more', greatest(v_total - 200, 0));
END $$;

-- The bell (contract 3.3, TaskAlerts): the last 14 days, newest first, at most 50.
CREATE OR REPLACE FUNCTION public.cockpit_task_alerts(p_cockpit text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  v_cockpit text := public.cockpit_task_cockpit(p_cockpit);
  v_state jsonb := public.cockpit_task_state();
  v_member uuid := (v_seat->>'memberId')::uuid;
  v_rows jsonb; v_unread integer;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'taskId', a.task_id, 'requestId', a.request_id,
           'title', a.title, 'body', a.body, 'clientName', a.client_name, 'at', a.at, 'read', a.read_at IS NOT NULL)
           ORDER BY a.at DESC, a.created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (SELECT * FROM public.cockpit_task_alerts x
           WHERE x.member_id = v_member AND x.at > now() - interval '14 days'
             AND NOT public.cockpit_task_alert_hidden(v_cockpit, x)
           ORDER BY x.at DESC, x.created_at DESC LIMIT 50) a;
  SELECT count(*)::integer INTO v_unread FROM public.cockpit_task_alerts x
   WHERE x.member_id = v_member AND x.at > now() - interval '14 days' AND x.read_at IS NULL
     AND NOT public.cockpit_task_alert_hidden(v_cockpit, x);
  RETURN jsonb_build_object('asOf', now(), 'sourceAt', v_state->'sourceAt', 'ready', v_state->'ready',
    'link', v_seat->>'link',
    'note', CASE WHEN v_seat->>'link' = 'not_linked'
                 THEN 'Your seat is not linked to a ClickUp user, so only request alerts show here. Ask the systems manager to link it.' END,
    'unread', v_unread, 'alerts', v_rows);
END $$;

-- Mark up to 200 of the seat's own alerts read; one audit row.
CREATE OR REPLACE FUNCTION public.cockpit_task_alerts_seen(p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  v_member uuid := (v_seat->>'memberId')::uuid;
  v_n integer; v_ids jsonb;
BEGIN
  IF p_ids IS NULL OR coalesce(cardinality(p_ids), 0) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'marked', 0);
  END IF;
  WITH upd AS (
    UPDATE public.cockpit_task_alerts a SET read_at = now()
     WHERE a.id = ANY(p_ids[1:200]) AND a.member_id = v_member AND a.read_at IS NULL
    RETURNING a.id
  )
  SELECT count(*)::integer, coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_n, v_ids FROM upd;
  IF v_n > 0 THEN
    PERFORM public.cockpit_task_audit('task_alerts.seen', 'cockpit_task_alerts', v_member::text, v_seat->>'email',
      NULL, NULL, jsonb_build_object('count', v_n, 'ids', v_ids));
  END IF;
  RETURN jsonb_build_object('ok', true, 'marked', v_n);
END $$;

-- The focus view (contract 3.3, TaskDetail).
CREATE OR REPLACE FUNCTION public.cockpit_task_detail(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  v_cu bigint; m public.cockpit_task_mirror; p public.cockpit_request_parts; r public.cockpit_requests;
  v_task jsonb; v_detail jsonb; v_comments jsonb; v_actions jsonb; v_sop text; v_mode jsonb; v_today date;
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'That is not a ClickUp task id.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.cockpit_task_may_open(v_seat, p_task_id) THEN
    RAISE EXCEPTION 'This task is not assigned to you. Open it in ClickUp.' USING ERRCODE = '42501';
  END IF;
  v_cu := CASE WHEN jsonb_typeof(v_seat->'clickupUserId') = 'number' THEN (v_seat->>'clickupUserId')::bigint END;
  SELECT * INTO m FROM public.cockpit_task_mirror WHERE task_id = p_task_id;
  SELECT * INTO p FROM public.cockpit_request_parts x WHERE x.clickup_task_id = p_task_id ORDER BY x.created_at LIMIT 1;
  IF p.request_id IS NOT NULL THEN
    SELECT * INTO r FROM public.cockpit_requests WHERE id = p.request_id;
    SELECT t.sop_url INTO v_sop FROM public.cockpit_request_types t WHERE t.key = r.type_key;
  END IF;
  IF m.task_id IS NULL AND p.request_id IS NULL THEN
    RAISE EXCEPTION 'This task has not been read from ClickUp yet. Open it in ClickUp.' USING ERRCODE = 'P0002';
  END IF;
  IF m.task_id IS NOT NULL THEN
    v_task := public.cockpit_task_row(m) || jsonb_build_object('description', m.detail->>'description');
  ELSE
    -- A request's task the mirror has not read yet: what the request knows.
    v_today := (now() AT TIME ZONE 'Asia/Kuwait')::date;
    v_task := jsonb_build_object('taskId', p_task_id, 'title', p.task_name, 'clientName', r.client_name,
      'clientTaskId', r.client_task_id, 'listId', p.list_id, 'listName', public.cockpit_request_team_label(p.team),
      'status', coalesce(p.status, 'to do'), 'statusType', coalesce(p.status_type, 'open'),
      'dueOn', to_char(r.due_on, 'YYYY-MM-DD'), 'dueAt', NULL, 'dueHasTime', NULL,
      'overdue', coalesce(r.due_on < v_today, false), 'dueToday', coalesce(r.due_on = v_today, false),
      'priority', r.priority, 'url', coalesce(p.clickup_url, 'https://app.clickup.com/t/' || p_task_id),
      'createdAt', p.created_at, 'parentId', NULL, 'checklist', NULL,
      'requestId', r.id, 'requestTypeLabel', r.type_label, 'description', NULL);
  END IF;
  IF m.detail_at IS NOT NULL AND m.detail IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.e->>'id', 'authorLabel', c.who->>'label',
             'mine', CASE WHEN c.who->>'memberId' IS NOT NULL THEN c.who->>'memberId' = v_seat->>'memberId'
                          ELSE v_cu IS NOT NULL AND c.author = v_cu AND NOT coalesce((c.who->>'cockpit')::boolean, false) END,
             'at', CASE WHEN c.ms IS NOT NULL THEN to_timestamp(c.ms / 1000.0) END,
             'text', left(btrim(regexp_replace(coalesce(c.e->>'text', ''), '\s*Cockpit ref [A-Za-z0-9-]+\s*$', '')), 1000))
             ORDER BY c.ms DESC NULLS LAST), '[]'::jsonb)
      INTO v_comments
      FROM (SELECT x.e, x.ms, x.author, public.cockpit_task_comment_author(x.author, x.e->>'text') AS who
              FROM (SELECT e,
                           CASE WHEN coalesce(e->>'atMs', '') ~ '^[0-9]{1,15}$' THEN (e->>'atMs')::bigint END AS ms,
                           CASE WHEN coalesce(e->>'authorId', '') ~ '^[0-9]{1,18}$' THEN (e->>'authorId')::bigint END AS author
                      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.detail->'comments') = 'array'
                                                     THEN m.detail->'comments' ELSE '[]'::jsonb END) e) x
             ORDER BY x.ms DESC NULLS LAST LIMIT 10) c;
    v_detail := jsonb_build_object('at', m.detail_at,
      'dueHasTime', CASE WHEN jsonb_typeof(m.detail->'dueHasTime') = 'boolean' THEN (m.detail->>'dueHasTime')::boolean END,
      'description', m.detail->>'description',
      'checklists', CASE WHEN jsonb_typeof(m.detail->'checklists') = 'array' THEN m.detail->'checklists' ELSE '[]'::jsonb END,
      'subtasks', CASE WHEN jsonb_typeof(m.detail->'subtasks') = 'array' THEN m.detail->'subtasks' ELSE '[]'::jsonb END,
      'comments', v_comments);
  END IF;
  -- Only this seat's own presses: another seat's action ids never leave the
  -- database (review 2026-10-26, SEC-5).
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'op', q.payload->>'op', 'state', q.state, 'error', q.error,
           'at', q.updated_at, 'itemId', q.payload->>'itemId') ORDER BY q.created_at DESC), '[]'::jsonb)
    INTO v_actions
    FROM public.cockpit_clickup_writeback_queue q
   WHERE q.kind = 'task_action' AND q.task_id = p_task_id AND q.created_at > now() - interval '24 hours'
     AND q.payload->'actor'->>'memberId' = v_seat->>'memberId';
  v_mode := public.cockpit_clickup_requests_mode();
  RETURN jsonb_build_object('asOf', now(), 'task', v_task,
    'request', CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('id', r.id, 'typeLabel', r.type_label,
                    'requesterLabel', r.requester_label, 'part', p.part) END,
    'sopUrl', v_sop, 'detail', v_detail, 'detailNote', NULL, 'actions', v_actions,
    'can', public.cockpit_task_can(v_seat, m),
    'writer', jsonb_build_object('mode', v_mode->>'mode', 'live', coalesce((v_mode->>'live')::boolean, false)));
END $$;

-- A tick, untick, comment or Mark done from the focus view (contract 3.4):
-- one task_action row on the writeback queue, which clickup-writeback job
-- requests writes and reads back. The row's id is the action id.
CREATE OR REPLACE FUNCTION public.cockpit_task_act(p_action_id uuid, p_task_id text, p_op text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  v_cu bigint; v_priv boolean; m public.cockpit_task_mirror; q public.cockpit_clickup_writeback_queue;
  v_in jsonb := coalesce(p_payload, '{}'::jsonb); v_core jsonb; v_payload jsonb; v_text text; v_name text;
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'That is not a ClickUp task id.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.cockpit_task_may_open(v_seat, p_task_id) THEN
    RAISE EXCEPTION 'This task is not assigned to you. Open it in ClickUp.' USING ERRCODE = '42501';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'Send the change with its action id.' USING ERRCODE = '22023';
  END IF;
  IF p_op IS NULL OR p_op NOT IN ('tick','untick','comment','done') THEN
    RAISE EXCEPTION 'Unknown change. Use tick, untick, comment or done.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_in) <> 'object' THEN
    RAISE EXCEPTION 'Send the change as an object.' USING ERRCODE = '22023';
  END IF;
  -- What the person asked for, to tell a repeat from a different change: the
  -- same keys the payload below stores, read the same way.
  v_core := jsonb_build_object('op', p_op, 'taskId', p_task_id, 'memberId', v_seat->>'memberId',
    'checklistId', CASE WHEN p_op IN ('tick','untick') THEN v_in->>'checklistId' END,
    'itemId', CASE WHEN p_op IN ('tick','untick') THEN v_in->>'itemId' END,
    'itemName', CASE WHEN p_op IN ('tick','untick') THEN v_in->>'itemName' END,
    'from', CASE WHEN p_op IN ('tick','untick') THEN v_in->'from' END,
    'text', CASE WHEN p_op = 'comment' THEN btrim(coalesce(v_in->>'text', '')) END,
    'statusSeen', CASE WHEN p_op = 'done' THEN v_in->>'statusSeen' END);
  SELECT * INTO q FROM public.cockpit_clickup_writeback_queue WHERE dedupe_key = 'task:' || p_action_id::text;
  IF q.id IS NOT NULL THEN
    IF jsonb_build_object('op', q.payload->>'op', 'taskId', q.payload->>'taskId', 'memberId', q.payload->'actor'->>'memberId',
         'checklistId', q.payload->>'checklistId', 'itemId', q.payload->>'itemId', 'itemName', q.payload->>'itemName',
         'from', CASE WHEN jsonb_typeof(q.payload->'from') = 'boolean' THEN q.payload->'from' END,
         'text', q.payload->>'text', 'statusSeen', q.payload->>'statusSeen') = v_core THEN
      RETURN jsonb_build_object('id', q.id, 'state', q.state, 'reused', true);
    END IF;
    RAISE EXCEPTION 'This change was already sent. Reload the task.' USING ERRCODE = '55000';
  END IF;
  v_cu := CASE WHEN jsonb_typeof(v_seat->'clickupUserId') = 'number' THEN (v_seat->>'clickupUserId')::bigint END;
  v_priv := coalesce((v_seat->>'isAdmin')::boolean, false) OR coalesce((v_seat->>'isCeo')::boolean, false);
  IF v_cu IS NULL AND NOT v_priv THEN
    RAISE EXCEPTION 'Link your seat to ClickUp to tick, comment and mark done here. Ask the systems manager.' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO m FROM public.cockpit_task_mirror WHERE task_id = p_task_id;
  IF m.task_id IS NULL THEN
    RAISE EXCEPTION 'This task has not been read from ClickUp yet. Try again in two minutes.' USING ERRCODE = '55000';
  END IF;
  IF p_op = 'comment' AND m.list_id = '901816559981' THEN
    RAISE EXCEPTION 'This is a client card. Open it in ClickUp.' USING ERRCODE = '55000';
  END IF;
  IF p_op <> 'comment' AND NOT public.cockpit_task_board(m.list_id) THEN
    RAISE EXCEPTION 'Ticking and Mark done work on the team request boards. Open this one in ClickUp.' USING ERRCODE = '55000';
  END IF;
  IF NOT public.cockpit_task_writer_open(m.client_task_id) THEN
    RAISE EXCEPTION 'Changes from the cockpit are not switched on yet. Open the task in ClickUp.' USING ERRCODE = '55000';
  END IF;
  IF p_op IN ('tick','untick') THEN
    v_name := v_in->>'itemName';
    IF coalesce(v_in->>'checklistId', '') !~ '^[A-Za-z0-9_-]{1,40}$' OR coalesce(v_in->>'itemId', '') !~ '^[A-Za-z0-9_-]{1,40}$'
       OR v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 500 OR jsonb_typeof(v_in->'from') <> 'boolean' THEN
      RAISE EXCEPTION 'That step could not be read. Reload the task.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_op = 'comment' THEN
    v_text := btrim(coalesce(v_in->>'text', ''));
    IF char_length(v_text) NOT BETWEEN 1 AND 2000 THEN
      RAISE EXCEPTION 'Write the comment first, in under 2,000 characters.' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF char_length(btrim(coalesce(v_in->>'statusSeen', ''))) NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'The task''s status could not be read. Reload the task.' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- The comment's marker is chosen here, never from the browser's action id,
  -- so no press can take another's ref (review 2026-10-26, SEC-5).
  v_payload := jsonb_build_object('actionId', p_action_id,
    'ref', 'T-' || left(md5(p_action_id::text || ':' || clock_timestamp()::text || ':' || random()::text), 10),
    'op', p_op, 'taskId', p_task_id, 'listId', m.list_id, 'clientTaskId', m.client_task_id,
    'checklistId', CASE WHEN p_op IN ('tick','untick') THEN v_in->>'checklistId' END,
    'itemId', CASE WHEN p_op IN ('tick','untick') THEN v_in->>'itemId' END,
    'itemName', CASE WHEN p_op IN ('tick','untick') THEN v_name END,
    'from', CASE WHEN p_op IN ('tick','untick') THEN v_in->'from' END,
    'to', CASE WHEN p_op IN ('tick','untick') THEN to_jsonb(p_op = 'tick') END,
    'text', CASE WHEN p_op = 'comment' THEN v_text END,
    'statusSeen', CASE WHEN p_op = 'done' THEN v_in->>'statusSeen' END,
    'actor', jsonb_build_object('memberId', v_seat->>'memberId', 'clickupUserId', v_cu, 'label', v_seat->>'label',
      'isAdmin', v_priv),
    'requesterOfTask', public.cockpit_task_requester_of(v_seat, p_task_id));
  INSERT INTO public.cockpit_clickup_writeback_queue(id, dedupe_key, kind, source_table, source_id, task_id, payload)
  VALUES (p_action_id, 'task:' || p_action_id::text, 'task_action', 'cockpit_task_mirror', p_task_id, p_task_id, v_payload)
  RETURNING * INTO q;
  -- Never the comment's text in the audit log.
  PERFORM public.cockpit_task_audit('task.act', 'cockpit_task_mirror', p_task_id, v_seat->>'email', NULL, NULL,
    jsonb_build_object('op', p_op, 'taskId', p_task_id, 'itemId', v_payload->>'itemId', 'actionId', p_action_id));
  BEGIN
    PERFORM public.cockpit_clickup_requests_kick();
  EXCEPTION WHEN OTHERS THEN
    NULL; -- The minute cron picks it up.
  END;
  RETURN jsonb_build_object('id', q.id, 'state', q.state, 'reused', false);
END $$;

-- A seat's alert rules: its own, or another seat's for an editor.
CREATE OR REPLACE FUNCTION public.cockpit_task_alert_rules_read(p_member_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  v_target uuid := public.cockpit_task_rules_target(v_seat, p_member_id);
BEGIN
  RETURN public.cockpit_task_rules_view(v_target, coalesce((v_seat->>'isEditor')::boolean, false));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_task_alert_rules_set(p_member_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  v_target uuid := public.cockpit_task_rules_target(v_seat, p_member_id);
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  r public.cockpit_task_alert_rules; v_kinds text[]; v_start time; v_end time; k text;
BEGIN
  IF jsonb_typeof(v_patch) <> 'object' THEN
    RAISE EXCEPTION 'Send the change as an object.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_patch) x WHERE x NOT IN ('kinds','shiftStart','shiftEnd','slackDm')) THEN
    RAISE EXCEPTION 'Only the alert kinds and the shift can change here.' USING ERRCODE = '22023';
  END IF;
  IF v_patch ? 'slackDm' AND v_patch->'slackDm' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'Slack messages for alerts are not switched on yet. New assignments already post in your team''s Slack channel.'
      USING ERRCODE = '55000';
  END IF;
  SELECT * INTO r FROM public.cockpit_task_alert_rules WHERE member_id = v_target FOR UPDATE;
  v_kinds := coalesce(r.kinds, public.cockpit_task_alert_kinds());
  v_start := r.shift_start; v_end := r.shift_end;
  IF v_patch ? 'kinds' THEN
    IF jsonb_typeof(v_patch->'kinds') <> 'array' THEN
      RAISE EXCEPTION 'Send the alert kinds as a list.' USING ERRCODE = '22023';
    END IF;
    FOR k IN SELECT x FROM jsonb_array_elements_text(v_patch->'kinds') x LOOP
      IF NOT (k = ANY(public.cockpit_task_alert_kinds())) THEN
        RAISE EXCEPTION 'Unknown alert kind: %.', left(k, 40) USING ERRCODE = '22023';
      END IF;
    END LOOP;
    -- A failed request always alerts; the order is the settings' order.
    SELECT array_agg(x ORDER BY array_position(public.cockpit_task_alert_kinds(), x)) INTO v_kinds
      FROM (SELECT DISTINCT x FROM jsonb_array_elements_text(v_patch->'kinds') x UNION SELECT 'request_failed') s(x);
  END IF;
  IF v_patch ? 'shiftStart' THEN
    IF v_patch->'shiftStart' = 'null'::jsonb THEN v_start := NULL;
    ELSIF coalesce(v_patch->>'shiftStart', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN v_start := (v_patch->>'shiftStart')::time;
    ELSE RAISE EXCEPTION 'Write the shift times as HH:MM, for example 10:00.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_patch ? 'shiftEnd' THEN
    IF v_patch->'shiftEnd' = 'null'::jsonb THEN v_end := NULL;
    ELSIF coalesce(v_patch->>'shiftEnd', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN v_end := (v_patch->>'shiftEnd')::time;
    ELSE RAISE EXCEPTION 'Write the shift times as HH:MM, for example 10:00.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF (v_start IS NULL) <> (v_end IS NULL) THEN
    RAISE EXCEPTION 'Set both the start and the end of the shift, or neither.' USING ERRCODE = '22023';
  END IF;
  IF v_start IS NOT NULL AND v_start >= v_end THEN
    RAISE EXCEPTION 'The shift must end after it starts.' USING ERRCODE = '22023';
  END IF;
  IF r.member_id IS NULL OR r.kinds IS DISTINCT FROM v_kinds OR r.shift_start IS DISTINCT FROM v_start
     OR r.shift_end IS DISTINCT FROM v_end THEN
    INSERT INTO public.cockpit_task_alert_rules AS x(member_id, kinds, shift_start, shift_end, slack_dm, updated_by, updated_at)
    VALUES (v_target, v_kinds, v_start, v_end, false, v_seat->>'email', now())
    ON CONFLICT (member_id) DO UPDATE SET kinds = EXCLUDED.kinds, shift_start = EXCLUDED.shift_start,
      shift_end = EXCLUDED.shift_end, updated_by = EXCLUDED.updated_by, updated_at = now();
  END IF;
  RETURN public.cockpit_task_rules_view(v_target, coalesce((v_seat->>'isEditor')::boolean, false));
END $$;

-- ---------------------------------------------------------------------------
-- 5. Service RPCs (cockpit-tasks)

-- What a run needs: the cursor, the baseline and the linked seats.
CREATE OR REPLACE FUNCTION public.cockpit_task_mirror_inputs()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.cockpit_sync_state; s public.cockpit_sync_state; v_linked jsonb; v_not integer;
BEGIN
  SELECT * INTO d FROM public.cockpit_sync_state WHERE key = 'task-mirror:delta';
  SELECT * INTO s FROM public.cockpit_sync_state WHERE key = 'task-mirror:seats';
  SELECT coalesce(jsonb_agg(jsonb_build_object('memberId', l.member_id, 'clickupUserId', l.clickup_user_id,
           'label', coalesce(public.cockpit_slack_notice_role_of(l.email), 'a team member'))
           ORDER BY l.clickup_user_id, l.member_id), '[]'::jsonb)
    INTO v_linked FROM public.cockpit_task_linked() l;
  SELECT count(*)::integer INTO v_not FROM public.cockpit_members m
   WHERE m.active AND NOT EXISTS (SELECT 1 FROM public.cockpit_task_linked() l WHERE l.member_id = m.id);
  RETURN jsonb_build_object(
    'cursorMs', CASE WHEN jsonb_typeof(d.detail->'cursorMs') = 'number' THEN d.detail->'cursorMs' END,
    'baselinedAt', public.cockpit_task_baseline(),
    'teamId', '90182518398', 'linked', v_linked, 'notLinked', v_not,
    -- The last delta stopped part way (over 1,000 changes): the next starts at the cursor itself.
    'deltaTruncated', coalesce(CASE WHEN jsonb_typeof(d.detail->'truncated') = 'boolean' THEN (d.detail->>'truncated')::boolean END, false),
    'allTasksList', '901816723226', 'fieldsList', '901816723190',
    'states', jsonb_build_object(
      'delta', CASE WHEN d.key IS NOT NULL THEN jsonb_build_object('at', d.last_run_at, 'okAt', d.last_ok_at, 'ok', d.ok, 'note', d.note) END,
      'seats', CASE WHEN s.key IS NOT NULL THEN jsonb_build_object('at', s.last_run_at, 'okAt', s.last_ok_at, 'ok', s.ok, 'note', s.note) END));
END $$;

-- One mirror row changed (old is all NULL for a row new to the mirror): the
-- request parts take its status and owners, and the alerts of 3.2 are made.
-- Every write path calls it (the delta, the hourly seat read, the focus
-- view's read and its cache), so no read swallows a change another would
-- have told (review 2026-10-26, contract F1). Assigned and status alerts need
-- p_real, a change ClickUp itself reports (its date_updated moved on, or the
-- live read's status differs), so the mirror correcting itself (a seat read
-- putting back an id the mirror took off) never alerts. None before the
-- baseline; a row new to the mirror alerts a seat only when it changed after
-- the baseline and after that seat was linked, so a seat linked later is
-- never flooded with its old tasks. Never on a client card itself.
CREATE OR REPLACE FUNCTION public.cockpit_task_mirror_changed(old public.cockpit_task_mirror, cur public.cockpit_task_mirror,
  p_real boolean, p_base timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_new boolean := old.task_id IS NULL;
  v_alerts integer := 0; v_client_name text; s record; pt record;
BEGIN
  IF cur.task_id IS NULL THEN RETURN 0; END IF;
  IF cur.client_task_id IS NOT NULL THEN
    SELECT o.client_name INTO v_client_name FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = cur.client_task_id;
  END IF;

  -- The request parts this task is, and their requests.
  FOR pt IN SELECT p.request_id, p.part, p.status_type AS old_type, p.list_id,
                   r.requester_member_id, r.state AS request_state, r.type_label, r.client_name
              FROM public.cockpit_request_parts p JOIN public.cockpit_requests r ON r.id = p.request_id
             WHERE p.clickup_task_id = cur.task_id LOOP
    UPDATE public.cockpit_request_parts SET status = cur.status, status_type = cur.status_type,
      assignee_ids = cur.assignee_ids, mirrored_at = now(), updated_at = now()
     WHERE request_id = pt.request_id AND part = pt.part;
    PERFORM public.cockpit_request_refresh(pt.request_id);
    IF p_base IS NOT NULL AND cur.status_type IN ('done','closed') AND coalesce(pt.old_type, '') NOT IN ('done','closed')
       AND pt.request_state <> 'cancelled' AND pt.requester_member_id IS NOT NULL THEN
      v_alerts := v_alerts + public.cockpit_task_alert_add(pt.requester_member_id, 'request_done',
        'request_done:' || pt.request_id::text || ':' || pt.part, cur.task_id, pt.request_id, cur.list_id,
        pt.type_label || coalesce(': ' || nullif(btrim(pt.client_name), ''), ''),
        CASE WHEN cur.status_type = 'closed' THEN 'Closed in ClickUp.' ELSE 'Done in ClickUp.' END,
        pt.client_name, NULL, coalesce(cur.date_closed, cur.date_updated));
    END IF;
  END LOOP;

  -- Assigned and status.
  IF p_base IS NULL OR NOT coalesce(p_real, false) THEN RETURN v_alerts; END IF;
  IF cur.list_id = '901816559981' AND cur.parent_id IS NULL THEN RETURN v_alerts; END IF;
  FOR s IN SELECT * FROM public.cockpit_task_linked() LOOP
    CONTINUE WHEN NOT (s.clickup_user_id = ANY(cur.assignee_ids));
    IF (v_new OR NOT (s.clickup_user_id = ANY(coalesce(old.assignee_ids, '{}'::bigint[]))))
       AND cur.status_type NOT IN ('done','closed') AND NOT cur.archived
       AND NOT (v_new AND cur.creator_id IS NOT DISTINCT FROM s.clickup_user_id)
       AND NOT (v_new AND cur.date_updated < greatest(p_base, s.linked_at))
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_request_parts p JOIN public.cockpit_requests r ON r.id = p.request_id
                        WHERE p.clickup_task_id = cur.task_id AND r.requester_member_id = s.member_id) THEN
      v_alerts := v_alerts + public.cockpit_task_alert_add(s.member_id, 'assigned',
        'assigned:' || cur.task_id || ':' || s.member_id::text || ':' || (extract(epoch FROM cur.date_updated) * 1000)::bigint::text,
        cur.task_id, NULL, cur.list_id, cur.name, 'Assigned to you', v_client_name, NULL, cur.date_updated);
    END IF;
    -- ClickUp's task read names no one who moved it, so the only mover known
    -- is a seat's own Mark done from the focus view (contract 3.2, F9).
    IF NOT v_new AND old.status IS DISTINCT FROM cur.status
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_clickup_writeback_queue q
                        WHERE q.kind = 'task_action' AND q.task_id = cur.task_id AND q.state = 'delivered'
                          AND q.payload->'actor'->>'memberId' = s.member_id::text
                          AND coalesce(q.delivered_at, q.updated_at) > now() - interval '10 minutes') THEN
      v_alerts := v_alerts + public.cockpit_task_alert_add(s.member_id, 'status',
        'status:' || cur.task_id || ':' || s.member_id::text || ':' || cur.status || ':'
          || (extract(epoch FROM cur.date_updated) * 1000)::bigint::text,
        cur.task_id, NULL, cur.list_id, cur.name, 'Moved to ' || cur.status, v_client_name, NULL, cur.date_updated);
    END IF;
  END LOOP;
  RETURN v_alerts;
END $$;

-- Tasks as a read saw them (MirrorTask, contract 5.2), at most 200, from any
-- read (delta, seat or detail): each row through the shared diff above.
CREATE OR REPLACE FUNCTION public.cockpit_task_mirror_upsert(p_tasks jsonb, p_source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e jsonb; old public.cockpit_task_mirror; cur public.cockpit_task_mirror;
  v_base timestamptz := public.cockpit_task_baseline();
  v_upserted integer := 0; v_alerts integer := 0; v_skipped integer := 0;
  v_id text; v_due timestamptz; v_has boolean; v_assignees bigint[]; v_watchers bigint[]; v_tags text[];
  v_created timestamptz; v_updated timestamptz; v_closed timestamptz; v_client text;
  v_priority text; v_status text; v_type text; v_new boolean;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('delta','seat','detail') THEN
    RAISE EXCEPTION 'Say which read this is: delta, seat or detail.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_tasks) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Send the tasks as a list.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_tasks) > 200 THEN
    RAISE EXCEPTION 'Send at most 200 tasks at a time.' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_tasks) x LOOP
    v_id := e->>'taskId';
    IF jsonb_typeof(e) <> 'object' OR coalesce(v_id, '') !~ '^[A-Za-z0-9_-]{1,40}$'
       OR coalesce(e->>'listId', '') !~ '^[0-9]{1,20}$'
       OR nullif(btrim(coalesce(e->>'name', '')), '') IS NULL
       OR coalesce(e->>'dateCreatedMs', '') !~ '^[0-9]{10,15}$' OR coalesce(e->>'dateUpdatedMs', '') !~ '^[0-9]{10,15}$' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    v_created := to_timestamp((e->>'dateCreatedMs')::bigint / 1000.0);
    v_updated := to_timestamp((e->>'dateUpdatedMs')::bigint / 1000.0);
    v_closed := CASE WHEN coalesce(e->>'dateClosedMs', '') ~ '^[0-9]{10,15}$' THEN to_timestamp((e->>'dateClosedMs')::bigint / 1000.0) END;
    v_due := CASE WHEN coalesce(e->>'dueAtMs', '') ~ '^[0-9]{10,15}$' THEN to_timestamp((e->>'dueAtMs')::bigint / 1000.0) END;
    v_assignees := ARRAY(SELECT DISTINCT x::bigint FROM jsonb_array_elements_text(
                     CASE WHEN jsonb_typeof(e->'assigneeIds') = 'array' THEN e->'assigneeIds' ELSE '[]'::jsonb END) x
                    WHERE x ~ '^[0-9]{1,18}$' ORDER BY 1);
    v_watchers := ARRAY(SELECT DISTINCT x::bigint FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(e->'watcherIds') = 'array' THEN e->'watcherIds' ELSE '[]'::jsonb END) x
                   WHERE x ~ '^[0-9]{1,18}$' ORDER BY 1);
    v_tags := ARRAY(SELECT DISTINCT lower(btrim(x)) FROM jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(e->'tags') = 'array' THEN e->'tags' ELSE '[]'::jsonb END) x
               WHERE btrim(x) <> '' ORDER BY 1);
    v_priority := CASE WHEN lower(coalesce(e->>'priority', '')) IN ('urgent','high','normal','low') THEN lower(e->>'priority') END;
    v_status := coalesce(nullif(btrim(e->>'status'), ''), 'unknown');
    v_type := coalesce(nullif(lower(btrim(e->>'statusType')), ''), 'custom');
    SELECT * INTO old FROM public.cockpit_task_mirror WHERE task_id = v_id FOR UPDATE;
    v_new := old.task_id IS NULL;
    -- A read older than what the mirror holds only says the task is still there.
    IF NOT v_new AND old.date_updated > v_updated THEN
      UPDATE public.cockpit_task_mirror SET seen_at = now(), gone_at = NULL WHERE task_id = v_id;
      v_upserted := v_upserted + 1;
      CONTINUE;
    END IF;
    v_has := CASE WHEN jsonb_typeof(e->'dueHasTime') = 'boolean' THEN (e->>'dueHasTime')::boolean
                  WHEN v_due IS NULL THEN NULL
                  WHEN NOT v_new AND old.due_at IS NOT DISTINCT FROM v_due THEN old.due_has_time END;
    v_client := public.cockpit_task_client_of(v_id, e->>'listId', v_tags);
    INSERT INTO public.cockpit_task_mirror AS t(task_id, list_id, list_name, folder_id, space_id, parent_id, name, status,
      status_type, priority, due_at, due_on, due_has_time, assignee_ids, watcher_ids, creator_id, tags, client_task_id, url,
      date_created, date_updated, date_closed, archived, checklist_done, checklist_total, first_seen_at, seen_at, gone_at)
    VALUES (v_id, e->>'listId', nullif(btrim(e->>'listName'), ''), nullif(e->>'folderId', ''), nullif(e->>'spaceId', ''),
      CASE WHEN coalesce(e->>'parentId', '') ~ '^[A-Za-z0-9_-]{1,40}$' THEN e->>'parentId' END,
      left(btrim(e->>'name'), 500), v_status, v_type, v_priority, v_due,
      CASE WHEN v_due IS NOT NULL THEN (v_due AT TIME ZONE 'Asia/Kuwait')::date END, v_has,
      v_assignees, v_watchers,
      CASE WHEN coalesce(e->>'creatorId', '') ~ '^[0-9]{1,18}$' THEN (e->>'creatorId')::bigint END,
      v_tags, v_client, coalesce(nullif(e->>'url', ''), 'https://app.clickup.com/t/' || v_id),
      v_created, v_updated, v_closed, coalesce((e->>'archived')::boolean, false),
      CASE WHEN coalesce(e->>'checklistDone', '') ~ '^[0-9]{1,6}$' THEN (e->>'checklistDone')::integer END,
      CASE WHEN coalesce(e->>'checklistTotal', '') ~ '^[0-9]{1,6}$' THEN (e->>'checklistTotal')::integer END,
      now(), now(), NULL)
    ON CONFLICT (task_id) DO UPDATE SET list_id = EXCLUDED.list_id, list_name = EXCLUDED.list_name,
      folder_id = EXCLUDED.folder_id, space_id = EXCLUDED.space_id, parent_id = EXCLUDED.parent_id, name = EXCLUDED.name,
      status = EXCLUDED.status, status_type = EXCLUDED.status_type, priority = EXCLUDED.priority, due_at = EXCLUDED.due_at,
      due_on = EXCLUDED.due_on, due_has_time = EXCLUDED.due_has_time, assignee_ids = EXCLUDED.assignee_ids,
      watcher_ids = EXCLUDED.watcher_ids, creator_id = coalesce(EXCLUDED.creator_id, t.creator_id), tags = EXCLUDED.tags,
      client_task_id = EXCLUDED.client_task_id, url = EXCLUDED.url, date_created = EXCLUDED.date_created,
      date_updated = EXCLUDED.date_updated, date_closed = EXCLUDED.date_closed, archived = EXCLUDED.archived,
      checklist_done = coalesce(EXCLUDED.checklist_done, t.checklist_done),
      checklist_total = coalesce(EXCLUDED.checklist_total, t.checklist_total),
      seen_at = now(), gone_at = NULL
    RETURNING * INTO cur;
    v_upserted := v_upserted + 1;
    v_alerts := v_alerts + public.cockpit_task_mirror_changed(old, cur, v_new OR cur.date_updated > old.date_updated, v_base);
  END LOOP;
  RETURN jsonb_build_object('upserted', v_upserted, 'alerts', v_alerts, 'skipped', v_skipped);
END $$;

-- After a full read of one seat's open tasks: the seat's id comes off the
-- open rows the read did not return (the next delta has the truth), and rows
-- no read has seen for 7 days are gone.
CREATE OR REPLACE FUNCTION public.cockpit_task_mirror_seat(p_clickup_user_id bigint, p_task_ids text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_removed integer; v_ids text[];
BEGIN
  IF p_clickup_user_id IS NULL THEN
    RAISE EXCEPTION 'Say whose tasks these are.' USING ERRCODE = '22023';
  END IF;
  WITH upd AS (
    UPDATE public.cockpit_task_mirror m SET assignee_ids = array_remove(m.assignee_ids, p_clickup_user_id)
     WHERE m.assignee_ids @> ARRAY[p_clickup_user_id] AND m.status_type NOT IN ('done','closed') AND m.gone_at IS NULL
       AND NOT (m.task_id = ANY(coalesce(p_task_ids, '{}'::text[])))
    RETURNING m.task_id
  )
  SELECT count(*)::integer, coalesce(array_agg(upd.task_id), '{}'::text[]) INTO v_removed, v_ids FROM upd;
  UPDATE public.cockpit_request_parts p SET assignee_ids = m.assignee_ids, mirrored_at = now(), updated_at = now()
    FROM public.cockpit_task_mirror m WHERE m.task_id = p.clickup_task_id AND p.clickup_task_id = ANY(v_ids);
  UPDATE public.cockpit_task_mirror m SET gone_at = now()
   WHERE m.gone_at IS NULL AND m.seen_at < now() - interval '7 days';
  RETURN jsonb_build_object('removed', v_removed);
END $$;

-- The tasks whose comments to read now: changed in the last 24 hours after
-- their cut-off, a linked seat's tasks first. Nothing before the baseline.
CREATE OR REPLACE FUNCTION public.cockpit_task_mirror_comment_due(p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_base timestamptz := public.cockpit_task_baseline(); v_out jsonb;
BEGIN
  IF v_base IS NULL THEN RETURN '[]'::jsonb; END IF;
  WITH linked AS (SELECT array_agg(DISTINCT l.clickup_user_id) AS ids FROM public.cockpit_task_linked() l),
  due AS (
    SELECT m.task_id, m.date_updated,
           coalesce(m.comments_read_at, greatest(v_base, m.first_seen_at - interval '10 minutes')) AS cutoff,
           (m.assignee_ids && coalesce((SELECT ids FROM linked), '{}'::bigint[])) AS mine
      FROM public.cockpit_task_mirror m
     WHERE m.date_updated > now() - interval '24 hours' AND m.gone_at IS NULL
       -- A thread whose last reads failed steps back: 2, 4, 8 ... minutes, at most an hour.
       AND NOT (m.comments_failures > 0 AND m.comments_failed_at IS NOT NULL
                AND m.comments_failed_at > now() - least(interval '2 minutes' * power(2, least(m.comments_failures - 1, 10)),
                                                          interval '1 hour'))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('taskId', d.task_id,
           'sinceMs', (extract(epoch FROM d.cutoff) * 1000)::bigint) ORDER BY d.mine DESC, d.date_updated DESC), '[]'::jsonb)
    INTO v_out
    FROM (SELECT * FROM due WHERE due.date_updated > due.cutoff
           ORDER BY due.mine DESC, due.date_updated DESC
           LIMIT greatest(0, least(coalesce(p_limit, 40), 60))) d;
  RETURN v_out;
END $$;

-- One task's comments, newest first, as cockpit-tasks read them: comment and
-- mention alerts (3.2), then the task's comments count as read up to
-- p_read_at, the moment that thread's read began (review 2026-10-26, F6), so
-- a comment posted while the run went on is read next time. A read that
-- failed (p_failed) makes no alert, leaves the read time alone and counts a
-- failure, so cockpit_task_mirror_comment_due steps the task back.
DROP FUNCTION IF EXISTS public.cockpit_task_mirror_comments(text, jsonb);
CREATE OR REPLACE FUNCTION public.cockpit_task_mirror_comments(p_task_id text, p_comments jsonb,
  p_read_at timestamptz DEFAULT now(), p_failed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.cockpit_task_mirror; v_base timestamptz := public.cockpit_task_baseline(); v_cut timestamptz;
  c jsonb; v_at timestamptz; v_author bigint; v_who jsonb; v_cockpit boolean; v_quiet boolean; v_tags bigint[];
  v_assignee bigint; s record; v_alerts integer := 0; v_client text; v_n integer;
  v_read timestamptz := least(coalesce(p_read_at, now()), now());
BEGIN
  IF coalesce(p_failed, false) THEN
    UPDATE public.cockpit_task_mirror SET comments_failures = comments_failures + 1, comments_failed_at = now()
     WHERE task_id = p_task_id;
    RETURN jsonb_build_object('alerts', 0);
  END IF;
  IF jsonb_typeof(p_comments) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Send the comments as a list.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM public.cockpit_task_mirror WHERE task_id = p_task_id FOR UPDATE;
  IF m.task_id IS NULL THEN RETURN jsonb_build_object('alerts', 0); END IF;
  v_cut := coalesce(m.comments_read_at, greatest(v_base, m.first_seen_at - interval '10 minutes'));
  IF m.client_task_id IS NOT NULL THEN
    SELECT o.client_name INTO v_client FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = m.client_task_id;
  END IF;
  IF v_base IS NOT NULL THEN
    FOR c IN SELECT x FROM jsonb_array_elements(p_comments) x LOOP
      CONTINUE WHEN jsonb_typeof(c) <> 'object' OR coalesce(c->>'id', '') !~ '^[A-Za-z0-9_-]{1,40}$'
                 OR coalesce(c->>'atMs', '') !~ '^[0-9]{10,15}$';
      v_at := to_timestamp((c->>'atMs')::bigint / 1000.0);
      CONTINUE WHEN v_at <= v_cut;
      v_author := CASE WHEN coalesce(c->>'authorId', '') ~ '^[0-9]{1,18}$' THEN (c->>'authorId')::bigint END;
      v_who := public.cockpit_task_comment_author(v_author, c->>'text');
      -- The cockpit's own note (a Cockpit ref marker no press owns): no name, no comment alert.
      v_cockpit := coalesce((v_who->>'cockpit')::boolean, false);
      -- The API user without a marker (the CEO by hand, or an automation on that account) makes no
      -- comment alert either; a mention in it still alerts, said as the CEO.
      v_quiet := coalesce((v_who->>'quiet')::boolean, false);
      v_tags := ARRAY(SELECT x::bigint FROM jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(c->'tagIds') = 'array' THEN c->'tagIds' ELSE '[]'::jsonb END) x
                 WHERE x ~ '^[0-9]{1,18}$');
      v_assignee := CASE WHEN coalesce(c->>'assigneeId', '') ~ '^[0-9]{1,18}$' THEN (c->>'assigneeId')::bigint END;
      FOR s IN SELECT * FROM public.cockpit_task_linked() LOOP
        -- Never the person who wrote it.
        CONTINUE WHEN s.clickup_user_id IS NOT DISTINCT FROM v_author AND NOT (v_author = 284616470 AND v_who->>'memberId' IS NOT NULL);
        CONTINUE WHEN (v_who->>'memberId') = s.member_id::text;
        v_n := 0;
        IF (s.clickup_user_id = ANY(v_tags) OR s.clickup_user_id IS NOT DISTINCT FROM v_assignee) THEN
          v_n := public.cockpit_task_alert_add(s.member_id, 'mention', 'mention:' || (c->>'id') || ':' || s.member_id::text,
            m.task_id, NULL, m.list_id, m.name,
            CASE WHEN v_cockpit THEN 'You were mentioned in a comment'
                 ELSE public.cockpit_task_actor_phrase(v_who->>'label', 'mentioned you') END,
            v_client, CASE WHEN NOT v_cockpit THEN v_who->>'label' END, v_at);
          -- A mention replaces the comment alert for that seat.
          IF v_n = 0 AND EXISTS (SELECT 1 FROM public.cockpit_task_alerts a
                                  WHERE a.dedupe_key = 'mention:' || (c->>'id') || ':' || s.member_id::text) THEN
            v_n := -1;
          END IF;
        END IF;
        IF v_n = 0 AND NOT v_cockpit AND NOT v_quiet AND s.clickup_user_id = ANY(m.assignee_ids)
           AND NOT (m.list_id = '901816559981' AND m.parent_id IS NULL) THEN
          v_n := public.cockpit_task_alert_add(s.member_id, 'comment', 'comment:' || (c->>'id') || ':' || s.member_id::text,
            m.task_id, NULL, m.list_id, m.name, public.cockpit_task_actor_phrase(v_who->>'label', 'commented'),
            v_client, v_who->>'label', v_at);
        END IF;
        v_alerts := v_alerts + greatest(v_n, 0);
      END LOOP;
    END LOOP;
  END IF;
  -- Read up to when this thread's read began; never back in time.
  UPDATE public.cockpit_task_mirror
     SET comments_read_at = greatest(coalesce(comments_read_at, v_read), v_read),
         comments_failures = 0, comments_failed_at = NULL
   WHERE task_id = p_task_id;
  RETURN jsonb_build_object('alerts', v_alerts);
END $$;

-- The daily alerts at a moment (internal, so tests can pick the moment):
-- due today once a day after the shift starts, overdue once per task and due day.
CREATE OR REPLACE FUNCTION public.cockpit_task_alerts_tick_at(p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_base timestamptz := public.cockpit_task_baseline(); s record; v_shift jsonb; v_today date; v_all integer; v_ed integer;
  v_due integer := 0; v_over integer := 0; t record; v_from date; v_key text;
BEGIN
  IF v_base IS NULL THEN RETURN jsonb_build_object('dueToday', 0, 'overdue', 0); END IF;
  v_today := (p_now AT TIME ZONE 'Asia/Kuwait')::date;
  FOR s IN SELECT * FROM public.cockpit_task_linked() LOOP
    v_shift := public.cockpit_task_shift(s.member_id, p_now);
    CONTINUE WHEN NOT coalesce((v_shift->>'started')::boolean, false);
    -- The tasks due today on the seat's Your tasks (review 2026-10-26, contract F2). The editor desk
    -- keeps Video Pipeline on its Jobs page, so when that changes the count the desk gets its own.
    SELECT count(*) FILTER (WHERE x.today)::integer INTO v_all FROM public.cockpit_task_my_set(s.clickup_user_id, 'portal', p_now) x;
    SELECT count(*) FILTER (WHERE x.today)::integer INTO v_ed FROM public.cockpit_task_my_set(s.clickup_user_id, 'editor', p_now) x;
    v_key := 'due_today:' || s.member_id::text || ':' || v_today::text;
    IF NOT EXISTS (SELECT 1 FROM public.cockpit_task_alerts a WHERE a.dedupe_key = v_key) THEN
      IF v_all > 0 THEN
        v_due := v_due + public.cockpit_task_alert_add(s.member_id, 'due_today', v_key,
          NULL, NULL, NULL, CASE WHEN v_all = 1 THEN '1 task is due today' ELSE v_all || ' tasks are due today' END,
          'Open Your tasks to see them.', NULL, NULL, p_now, CASE WHEN v_all <> v_ed THEN 'not_editor' END);
      END IF;
      IF v_all <> v_ed AND v_ed > 0 THEN
        v_due := v_due + public.cockpit_task_alert_add(s.member_id, 'due_today', v_key || ':editor',
          NULL, NULL, NULL, CASE WHEN v_ed = 1 THEN '1 task is due today' ELSE v_ed || ' tasks are due today' END,
          'Open Your tasks to see them.', NULL, NULL, p_now, 'editor');
      END IF;
    END IF;
    -- Only what fell due after the alerts began for this seat.
    v_from := greatest((v_base AT TIME ZONE 'Asia/Kuwait')::date, (s.linked_at AT TIME ZONE 'Asia/Kuwait')::date);
    FOR t IN SELECT m.task_id, m.list_id, m.name, m.due_on, m.client_task_id FROM public.cockpit_task_mirror m
              WHERE m.assignee_ids @> ARRAY[s.clickup_user_id] AND m.status_type NOT IN ('done','closed') AND NOT m.archived
                AND m.gone_at IS NULL AND NOT (m.list_id = '901816559981' AND m.parent_id IS NULL)
                AND m.due_on < v_today AND m.due_on >= v_from LOOP
      v_over := v_over + public.cockpit_task_alert_add(s.member_id, 'overdue',
        'overdue:' || t.task_id || ':' || s.member_id::text || ':' || t.due_on::text, t.task_id, NULL, t.list_id, t.name,
        'Was due ' || public.cockpit_request_day_words(t.due_on),
        (SELECT o.client_name FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = t.client_task_id), NULL, p_now);
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('dueToday', v_due, 'overdue', v_over);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_task_alerts_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN public.cockpit_task_alerts_tick_at(now());
END $$;

-- The focus view's live read, cached on the row (contract 3.5).
-- A status it finds that the mirror did not have goes through the shared
-- diff, so its status alert is made here, not swallowed (contract F1).
CREATE OR REPLACE FUNCTION public.cockpit_task_detail_cache(p_task_id text, p_detail jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_lists jsonb; v_subtasks jsonb; v_comments jsonb; v_done integer; v_total integer; v_has boolean;
  old public.cockpit_task_mirror; cur public.cockpit_task_mirror;
BEGIN
  IF jsonb_typeof(p_detail) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Send the task''s detail as an object.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO old FROM public.cockpit_task_mirror WHERE task_id = p_task_id FOR UPDATE;
  IF old.task_id IS NULL THEN
    RAISE EXCEPTION 'This task is not in the mirror yet; read it first.' USING ERRCODE = 'P0002';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', cl->>'id', 'name', left(coalesce(cl->>'name', ''), 200),
           'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', it->>'id', 'name', left(coalesce(it->>'name', ''), 500),
                               'resolved', coalesce((it->>'resolved')::boolean, false)) ORDER BY n)
                                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cl->'items') = 'array' THEN cl->'items' ELSE '[]'::jsonb END)
                                     WITH ORDINALITY AS i(it, n)
                               WHERE jsonb_typeof(it) = 'object' AND it->>'id' IS NOT NULL), '[]'::jsonb))
           ORDER BY k), '[]'::jsonb)
    INTO v_lists
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_detail->'checklists') = 'array' THEN p_detail->'checklists' ELSE '[]'::jsonb END)
         WITH ORDINALITY AS l(cl, k)
   WHERE jsonb_typeof(cl) = 'object' AND cl->>'id' IS NOT NULL;
  SELECT count(*) FILTER (WHERE (it->>'resolved')::boolean)::integer, count(*)::integer INTO v_done, v_total
    FROM jsonb_array_elements(v_lists) cl, jsonb_array_elements(cl->'items') it;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', st->>'id', 'name', left(coalesce(st->>'name', ''), 500),
           'status', st->>'status', 'statusType', st->>'statusType') ORDER BY k), '[]'::jsonb)
    INTO v_subtasks
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_detail->'subtasks') = 'array' THEN p_detail->'subtasks' ELSE '[]'::jsonb END)
         WITH ORDINALITY AS s(st, k)
   WHERE jsonb_typeof(st) = 'object' AND st->>'id' IS NOT NULL;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', c->>'id', 'authorId', c->'authorId', 'atMs', c->'atMs',
           'text', left(coalesce(c->>'text', ''), 1000)) ORDER BY k), '[]'::jsonb)
    INTO v_comments
    FROM (SELECT c, k FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_detail->'comments') = 'array'
                                                     THEN p_detail->'comments' ELSE '[]'::jsonb END) WITH ORDINALITY AS x(c, k)
           WHERE jsonb_typeof(c) = 'object' AND c->>'id' IS NOT NULL ORDER BY k LIMIT 25) y;
  v_has := CASE WHEN jsonb_typeof(p_detail->'dueHasTime') = 'boolean' THEN (p_detail->>'dueHasTime')::boolean END;
  UPDATE public.cockpit_task_mirror m SET
    detail = jsonb_build_object('dueHasTime', v_has, 'description', left(p_detail->>'description', 2000),
      'checklists', v_lists, 'subtasks', v_subtasks, 'comments', v_comments,
      'statuses', CASE WHEN jsonb_typeof(p_detail->'statuses') = 'array' THEN p_detail->'statuses' END),
    detail_at = now(),
    status = coalesce(nullif(btrim(p_detail->>'status'), ''), m.status),
    status_type = coalesce(nullif(lower(btrim(p_detail->>'statusType')), ''), m.status_type),
    due_has_time = CASE WHEN m.due_at IS NULL THEN NULL ELSE coalesce(v_has, m.due_has_time) END,
    checklist_done = v_done, checklist_total = v_total
   WHERE m.task_id = p_task_id
  RETURNING * INTO cur;
  IF old.status IS DISTINCT FROM cur.status OR old.status_type IS DISTINCT FROM cur.status_type THEN
    PERFORM public.cockpit_task_mirror_changed(old, cur, old.status IS DISTINCT FROM cur.status, public.cockpit_task_baseline());
  END IF;
END $$;

-- One run's report: cockpit_sync_state task-mirror:delta or task-mirror:seats,
-- and one audit row a run. The cursor never goes back; the baseline is set
-- once, by the first seats run that finished every linked seat.
CREATE OR REPLACE FUNCTION public.cockpit_task_mirror_state(p_job text, p_ok boolean, p_note text, p_detail jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_key text; s public.cockpit_sync_state; v_detail jsonb := coalesce(p_detail, '{}'::jsonb); v_old numeric; v_new numeric;
BEGIN
  IF p_job IS NULL OR p_job NOT IN ('delta','seats') THEN
    RAISE EXCEPTION 'Say which run this is: delta or seats.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_detail) <> 'object' THEN v_detail := '{}'::jsonb; END IF;
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  v_key := 'task-mirror:' || p_job;
  SELECT * INTO s FROM public.cockpit_sync_state WHERE key = v_key FOR UPDATE;
  IF p_job = 'delta' THEN
    v_old := CASE WHEN jsonb_typeof(s.detail->'cursorMs') = 'number' THEN (s.detail->>'cursorMs')::numeric END;
    v_new := CASE WHEN jsonb_typeof(v_detail->'cursorMs') = 'number' THEN (v_detail->>'cursorMs')::numeric END;
    v_detail := v_detail || jsonb_build_object('cursorMs', CASE WHEN v_old IS NULL AND v_new IS NULL THEN NULL
                                                                ELSE to_jsonb(greatest(coalesce(v_old, v_new), coalesce(v_new, v_old))) END);
  ELSE
    -- Only this function sets the baseline, and only once.
    v_detail := (v_detail - 'baselinedAt') || jsonb_build_object('baselinedAt',
      CASE WHEN jsonb_typeof(s.detail->'baselinedAt') = 'string' THEN s.detail->'baselinedAt'
           WHEN lower(coalesce(v_detail->>'complete', '')) = 'true' THEN to_jsonb(now()) END);
  END IF;
  INSERT INTO public.cockpit_sync_state AS x(key, last_run_at, last_ok_at, ok, note, detail, updated_at)
  VALUES (v_key, now(), CASE WHEN p_ok THEN now() END, coalesce(p_ok, false), left(p_note, 500), v_detail, now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = coalesce(EXCLUDED.last_ok_at, x.last_ok_at),
    ok = EXCLUDED.ok, note = EXCLUDED.note, detail = EXCLUDED.detail, updated_at = now();
  PERFORM public.cockpit_task_audit('task_mirror.run', 'cockpit_sync_state', v_key, 'cockpit-tasks', NULL, NULL,
    v_detail || jsonb_build_object('ok', coalesce(p_ok, false), 'job', p_job));
END $$;

-- ---------------------------------------------------------------------------
-- 6. The kicks and their schedule (only where pg_cron exists)

CREATE OR REPLACE FUNCTION public.cockpit_task_mirror_kick(p_job text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_url constant text := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-tasks';
  v_secret text; v_note text; v_request bigint;
BEGIN
  IF p_job IS NULL OR p_job NOT IN ('delta','seats') THEN
    RAISE EXCEPTION 'Say which run to start: delta or seats.' USING ERRCODE = '22023';
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = $1 LIMIT 1'
      INTO v_secret USING 'cockpit_tasks_cron_secret';
  END IF;
  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    v_note := 'The vault has no cockpit_tasks_cron_secret, so the task mirror did not run. Add it to the vault.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace ns ON ns.oid = f.pronamespace
                     WHERE ns.nspname = 'net' AND f.proname = 'http_post') THEN
    v_note := 'pg_net is not installed, so the task mirror did not run.';
  END IF;
  IF v_note IS NOT NULL THEN
    INSERT INTO public.cockpit_sync_state(key, last_run_at, ok, note, updated_at)
    VALUES ('task-mirror:kick', now(), false, v_note, now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now(), ok = false, note = EXCLUDED.note, updated_at = now();
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)' INTO v_request
    USING v_url, jsonb_build_object('job', p_job),
          jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret);
  INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, updated_at)
  VALUES ('task-mirror:kick', now(), now(), true, 'Posted a ' || p_job || ' run', now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = now(), ok = true, note = EXCLUDED.note, updated_at = now();
  RETURN v_request;
END $$;

DO $$ BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname IN (''mahara-task-mirror'',''mahara-task-mirror-seats'')';
    EXECUTE $q$SELECT cron.schedule('mahara-task-mirror','*/2 * * * *',$job$SELECT public.cockpit_task_mirror_kick('delta');$job$)$q$;
    EXECUTE $q$SELECT cron.schedule('mahara-task-mirror-seats','11 * * * *',$job$SELECT public.cockpit_task_mirror_kick('seats');$job$)$q$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Function privileges: revoked from all four roles, then exactly one grant

DO $$
DECLARE f text;
BEGIN
  -- Internal: the helpers, the triggers' functions and the kick.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_task_alert_kinds()', 'cockpit_task_cockpit(text)', 'cockpit_task_hidden(text,text,text,boolean)',
    'cockpit_task_alert_hidden(text,public.cockpit_task_alerts)', 'cockpit_task_my_set(bigint,text,timestamptz)',
    'cockpit_task_mirror_changed(public.cockpit_task_mirror,public.cockpit_task_mirror,boolean,timestamptz)',
    'cockpit_task_audit(text,text,text,text,jsonb,jsonb,jsonb)', 'cockpit_task_state()', 'cockpit_task_baseline()',
    'cockpit_task_linked()', 'cockpit_task_kinds(uuid)',
    'cockpit_task_alert_add(uuid,text,text,text,uuid,text,text,text,text,text,timestamptz,text)',
    'cockpit_task_actor_phrase(text,text)', 'cockpit_task_client_of(text,text,text[])',
    'cockpit_task_row(public.cockpit_task_mirror)', 'cockpit_task_may_open(jsonb,text)', 'cockpit_task_requester_of(jsonb,text)',
    'cockpit_task_board(text)', 'cockpit_task_writer_open(text)', 'cockpit_task_can(jsonb,public.cockpit_task_mirror)',
    'cockpit_task_comment_author(bigint,text)', 'cockpit_task_shift(uuid,timestamptz)', 'cockpit_task_rules_view(uuid,boolean)',
    'cockpit_task_rules_target(jsonb,uuid)', 'cockpit_task_alerts_guard()', 'cockpit_task_alert_rules_audit()',
    'cockpit_task_request_failed()', 'cockpit_task_alerts_tick_at(timestamptz)', 'cockpit_task_mirror_kick(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- cockpit-tasks: the service key only.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_task_mirror_inputs()', 'cockpit_task_mirror_upsert(jsonb,text)', 'cockpit_task_mirror_seat(bigint,text[])',
    'cockpit_task_mirror_comment_due(integer)', 'cockpit_task_mirror_comments(text,jsonb,timestamptz,boolean)', 'cockpit_task_alerts_tick()',
    'cockpit_task_detail_cache(text,jsonb)', 'cockpit_task_mirror_state(text,boolean,text,jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  -- The screens' RPCs: a signed-in seat, gated inside.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_my_tasks(text)', 'cockpit_task_alerts(text)', 'cockpit_task_alerts_seen(uuid[])', 'cockpit_task_detail(text)',
    'cockpit_task_act(uuid,text,text,jsonb)', 'cockpit_task_alert_rules_read(uuid)', 'cockpit_task_alert_rules_set(uuid,jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
