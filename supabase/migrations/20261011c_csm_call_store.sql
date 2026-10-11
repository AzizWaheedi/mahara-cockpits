-- CSM call store: every call, every call form and every media buyer change per client.
--
-- Aziz, 2026-10-11: "any check-in call forms that are being filled out and any calls
-- that the CSM has with the client are actually syncing to the CSM cockpit ... every
-- single call with the client, including the brand blueprint call, the form, all the
-- context, all the changes the media buyer makes ... day by day, and it never breaks."
--
-- Written by hermes/csm-calls (its own worker, its own cron and lock) with the service
-- key. Browsers never read these tables: only the two SECURITY DEFINER reads below,
-- gated per client by public.cockpit_csm_client_gate (the booking path's scope), and
-- the one manual-match command, which writes an audit row.
--
-- Pattern of 20261009o: REVOKE ALL FROM PUBLIC, anon, authenticated; grant service_role.

-- 1. Tables ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cockpit_csm_calls(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('ghl_appointment','fathom','checkin_form','zoom','manual','imported')),
  source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 200),
  task_id text CHECK (task_id IS NULL OR task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name text,
  match_method text CHECK (match_method IS NULL OR match_method IN ('client_id_field','invitee_email','appointment_time','name','manual','form_task_id','imported')),
  match_confidence numeric CHECK (match_confidence IS NULL OR match_confidence BETWEEN 0 AND 1),
  kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('onboarding','blueprint','launch','checkin','other')),
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','confirmed','showed','no_show','cancelled','held','gone')),
  provider_status text,
  host_email text,
  host_name text,
  join_url text,
  recording_url text,
  summary text,
  transcript_path text,
  transcript_text text,
  external_invitees jsonb NOT NULL DEFAULT '[]'::jsonb,
  linked_call_id bigint REFERENCES public.cockpit_csm_calls(id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_hash text,
  UNIQUE (source, source_id)
);
COMMENT ON TABLE public.cockpit_csm_calls IS
  'One row per real client call, keyed (source, source_id). Upserted by hermes/csm-calls, never deleted: an appointment missing from a fully read window becomes gone. transcript_text holds the check-in form''s typed transcript when no recording exists; recording transcripts live in the private csm-call-transcripts bucket (transcript_path).';
CREATE INDEX IF NOT EXISTS cockpit_csm_calls_task_idx ON public.cockpit_csm_calls(task_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS cockpit_csm_calls_start_idx ON public.cockpit_csm_calls(starts_at DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_csm_call_forms(
  token text PRIMARY KEY CHECK (length(token) BETWEEN 1 AND 200),
  form_id text NOT NULL CHECK (form_id IN ('fRokTITH','KFRCXPFx','tG7dnxBn','BbJy6xg4','oYZKtogO')),
  form_kind text NOT NULL CHECK (form_kind IN ('checkin','onboarding','kickoff','kickoff_old','blueprint')),
  task_id text CHECK (task_id IS NULL OR task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  typed_client text,
  matched_by text CHECK (matched_by IS NULL OR matched_by IN ('typed_task_id','hidden_field','manual')),
  submitted_at timestamptz NOT NULL,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  hidden jsonb NOT NULL DEFAULT '{}'::jsonb,
  recording_url text,
  linked_call_id bigint REFERENCES public.cockpit_csm_calls(id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cockpit_csm_call_forms IS
  'Every response of the 1-1 call notes form and the onboarding, kickoff (current and retired) and Brand Blueprint forms, with every answer (raw ref, type, value, question title), kept even when the ref left the current form definition.';
CREATE INDEX IF NOT EXISTS cockpit_csm_call_forms_task_idx ON public.cockpit_csm_call_forms(task_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_fathom_meetings(
  recording_id text PRIMARY KEY,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  recorded_by_email text,
  recorded_by_name text,
  external boolean NOT NULL DEFAULT false,
  invitees jsonb NOT NULL DEFAULT '[]'::jsonb,
  url text,
  share_url text,
  summary text,
  transcript_path text,
  raw jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cockpit_fathom_meetings IS
  'Every Fathom meeting the CSM worker read, raw, stored before matching so matching can rerun. summary and transcript kept only for meetings with an external invitee (privacy: the key also sees sales, hiring and team meetings). Never browser-readable.';
CREATE INDEX IF NOT EXISTS cockpit_fathom_meetings_start_idx ON public.cockpit_fathom_meetings(starts_at DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_csm_meta_activities(
  account_id text NOT NULL,
  event_time timestamptz NOT NULL,
  object_id text NOT NULL DEFAULT '',
  event_type text NOT NULL,
  actor_name text,
  object_name text,
  object_type text,
  translated_event_type text,
  extra_data jsonb,
  task_id text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, event_time, object_id, event_type)
);
COMMENT ON TABLE public.cockpit_csm_meta_activities IS
  'Meta ad account activity events made by a person, read by hermes/csm-calls with the system token. Separate from ad_account_activities so the creative dashboard''s mirror is never duplicated when it recovers.';
CREATE INDEX IF NOT EXISTS cockpit_csm_meta_activities_task_idx ON public.cockpit_csm_meta_activities(task_id, event_time DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_csm_changes(
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  change_key text NOT NULL,
  day date NOT NULL,
  at timestamptz NOT NULL,
  kind text NOT NULL,
  action text NOT NULL,
  evidence text,
  actor text,
  source text NOT NULL CHECK (source IN ('decision','media_action','campaign_message','native_manual','legacy_manual','meta_activity')),
  subject text,
  link text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, change_key)
);
COMMENT ON TABLE public.cockpit_csm_changes IS
  'Media buyer changes per client (port of convex/changeLog.ts changesForCard): decisions, cockpit campaign operations and notes, native manual changes, legacy manual changes and Meta activities by a person, matched by the ClickUp client links and aliases with one-letter tolerance. 90 days kept.';
CREATE INDEX IF NOT EXISTS cockpit_csm_changes_task_idx ON public.cockpit_csm_changes(task_id, at DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_csm_unmatched(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_kind text NOT NULL CHECK (item_kind IN ('call','form')),
  item_ref text NOT NULL,
  title text,
  at timestamptz,
  reason text NOT NULL,
  hint text,
  host_email text,
  resolved_task_id text,
  resolved_by text,
  resolved_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_kind, item_ref)
);
COMMENT ON TABLE public.cockpit_csm_unmatched IS
  'Calls (by cockpit_csm_calls id) and form responses (by token) that matched no client, with the reason. A CSM resolves one with cockpit_csm_manual_match; the worker re-matches the rest every run.';

CREATE TABLE IF NOT EXISTS public.cockpit_csm_match_audit(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_kind text NOT NULL,
  item_ref text NOT NULL,
  task_id text NOT NULL,
  actor_id uuid NOT NULL,
  actor_email text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;
ALTER TABLE public.cockpit_csm_provider_health ADD COLUMN IF NOT EXISTS run_key text;

-- 2. Access ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_csm_calls','cockpit_csm_call_forms','cockpit_fathom_meetings',
    'cockpit_csm_meta_activities','cockpit_csm_changes','cockpit_csm_unmatched','cockpit_csm_match_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO service_role', t);
  END LOOP;
END $$;
REVOKE UPDATE ON public.cockpit_csm_match_audit FROM service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cockpit_csm_calls_id_seq, public.cockpit_csm_unmatched_id_seq,
  public.cockpit_csm_match_audit_id_seq TO service_role;

INSERT INTO storage.buckets(id, name, public)
VALUES ('csm-call-transcripts', 'csm-call-transcripts', false)
ON CONFLICT (id) DO NOTHING;

-- 3. Reads ----------------------------------------------------------------------------

-- The clients the caller may see, by ClickUp id, from the gate's own scope rule.
CREATE OR REPLACE FUNCTION public.cockpit_csm_visible_tasks()
RETURNS TABLE(task_id text, client_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members;
BEGIN
  SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users u ON u.id=cm.auth_user_id
   WHERE cm.auth_user_id=auth.uid() AND cm.active AND u.email_confirmed_at IS NOT NULL AND cm.email=lower(btrim(u.email));
  IF m.auth_user_id IS NULL OR NOT('csm'=ANY(m.roles) OR 'admin'=ANY(m.roles) OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com')) THEN
    RAISE EXCEPTION 'Current confirmed client-success access is required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
   SELECT s.data->>'taskId', s.data->>'name' FROM public.cockpit_csm_sources s
    WHERE s.table_name='clients' AND nullif(s.data->>'taskId','') IS NOT NULL
      AND public.cockpit_ask_ai_owner_allowed(auth.uid(),'client-success',s.data->>'name');
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_visible_tasks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_visible_tasks() TO authenticated, service_role;

-- Next and last call per client, for the client list and the header.
-- Rules (Aziz): confirmed counts as shown once its time has passed; cancelled and gone
-- never become the next call; ClickUp Last Check-in Call and manual logs also count.
CREATE OR REPLACE FUNCTION public.cockpit_csm_calls_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE out jsonb;
BEGIN
  WITH v AS (SELECT * FROM public.cockpit_csm_visible_tasks()),
  nxt AS (
    SELECT DISTINCT ON (c.task_id) c.task_id, c.starts_at, c.kind, c.status
      FROM public.cockpit_csm_calls c JOIN v ON v.task_id=c.task_id
     WHERE c.starts_at>now() AND c.status IN ('booked','confirmed') AND c.source='ghl_appointment'
     ORDER BY c.task_id, c.starts_at),
  lst AS (
    SELECT DISTINCT ON (c.task_id) c.task_id, c.starts_at, c.kind, c.source
      FROM public.cockpit_csm_calls c JOIN v ON v.task_id=c.task_id
     WHERE c.starts_at<=now() AND (c.status IN ('held','showed') OR (c.status='confirmed' AND coalesce(c.ends_at,c.starts_at)<=now()))
     ORDER BY c.task_id, c.starts_at DESC),
  frm AS (
    SELECT DISTINCT ON (f.task_id) f.task_id, f.submitted_at
      FROM public.cockpit_csm_call_forms f JOIN v ON v.task_id=f.task_id
     WHERE f.form_id='fRokTITH' ORDER BY f.task_id, f.submitted_at DESC),
  cu AS (
    SELECT s.data->>'taskId' task_id, nullif(s.data->>'lastCall','') last_call
      FROM public.cockpit_csm_sources s JOIN v ON v.task_id=s.data->>'taskId' WHERE s.table_name='clients'),
  health AS (
    SELECT jsonb_object_agg(key, jsonb_build_object('ok',ok,'lastOkAt',last_ok_at,'lastRunAt',last_run_at,'note',note)) h
      FROM public.cockpit_sync_state WHERE key LIKE 'csm-%')
  SELECT jsonb_build_object(
    'clients', coalesce(jsonb_object_agg(v.task_id, jsonb_build_object(
      'nextCallAt', nxt.starts_at, 'nextCallKind', nxt.kind, 'nextCallStatus', nxt.status,
      'lastCall', best.at, 'lastCallKind', best.kind, 'lastCallSource', best.src
    )) FILTER (WHERE v.task_id IS NOT NULL), '{}'::jsonb),
    'health', coalesce((SELECT h FROM health), '{}'::jsonb),
    'at', now())
  INTO out
  FROM v
  LEFT JOIN nxt ON nxt.task_id=v.task_id
  LEFT JOIN LATERAL (
    SELECT x.at, x.kind, x.src FROM (
      SELECT l.starts_at at, l.kind, l.source src FROM lst l WHERE l.task_id=v.task_id
      UNION ALL SELECT f.submitted_at, 'checkin', 'checkin_form' FROM frm f WHERE f.task_id=v.task_id
      UNION ALL SELECT (cu.last_call||'T09:00:00+03:00')::timestamptz, 'checkin', 'clickup'
        FROM cu WHERE cu.task_id=v.task_id AND cu.last_call ~ '^\d{4}-\d{2}-\d{2}$'
    ) x ORDER BY x.at DESC NULLS LAST LIMIT 1) best ON true;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_calls_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_calls_summary() TO authenticated;

-- One client's timeline: calls (upcoming first, then newest), forms, media buyer changes,
-- and the health lines that affect this client.
CREATE OR REPLACE FUNCTION public.cockpit_csm_client_timeline(p_task_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE g jsonb; v_name text; v_calls jsonb; v_forms jsonb; v_changes jsonb; v_health jsonb; v_briefs jsonb;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  v_name := g->>'clientName';
  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb) INTO v_briefs FROM (
    SELECT jsonb_array_elements(b.per_call) elem FROM (
      SELECT DISTINCT ON (client_name) per_call FROM public.cockpit_media_call_briefs
       WHERE lower(btrim(client_name))=lower(btrim(v_name)) AND status='done' AND jsonb_typeof(per_call)='array'
       ORDER BY client_name, at DESC NULLS LAST) b) z;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'source', c.source, 'kind', c.kind, 'title', c.title,
      'startsAt', c.starts_at, 'endsAt', c.ends_at, 'status', c.status, 'providerStatus', c.provider_status,
      'upcoming', c.starts_at>now() AND c.status IN ('booked','confirmed'),
      'host', coalesce(c.host_name, c.host_email), 'joinUrl', c.join_url,
      'recordingUrl', coalesce(c.recording_url, r.recording_url),
      'summary', coalesce(c.summary, r.summary),
      'transcript', coalesce(c.transcript_text, r.transcript_text),
      'transcriptPath', coalesce(c.transcript_path, r.transcript_path),
      'brief', (SELECT b->>'brief' FROM jsonb_array_elements(v_briefs) b WHERE b->>'url' IN (coalesce(c.recording_url,''), coalesce(r.recording_url,'')) LIMIT 1),
      'matchMethod', c.match_method,
      'form', (SELECT jsonb_build_object('token',f.token,'submittedAt',f.submitted_at,'answers',f.answers)
                 FROM public.cockpit_csm_call_forms f WHERE f.linked_call_id=c.id ORDER BY f.submitted_at DESC LIMIT 1)
    ) ORDER BY (c.starts_at>now() AND c.status IN ('booked','confirmed')) DESC,
               CASE WHEN c.starts_at>now() THEN c.starts_at END ASC,
               c.starts_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_calls
    FROM public.cockpit_csm_calls c
    LEFT JOIN LATERAL (
      SELECT x.recording_url, x.summary, x.transcript_text, x.transcript_path FROM public.cockpit_csm_calls x
       WHERE x.linked_call_id=c.id AND x.source IN ('fathom','zoom') ORDER BY x.starts_at DESC LIMIT 1) r ON true
   WHERE c.task_id=p_task_id AND c.linked_call_id IS NULL AND c.status<>'gone';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'token', f.token, 'formId', f.form_id, 'kind', f.form_kind, 'submittedAt', f.submitted_at,
      'answers', f.answers, 'recordingUrl', f.recording_url, 'linkedCallId', f.linked_call_id
    ) ORDER BY f.submitted_at DESC), '[]'::jsonb)
    INTO v_forms FROM public.cockpit_csm_call_forms f WHERE f.task_id=p_task_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('day', x.day, 'at', (extract(epoch FROM x.at)*1000)::bigint, 'kind', x.kind,
      'action', x.action, 'evidence', x.evidence, 'actor', x.actor, 'source', x.source, 'subject', x.subject, 'link', x.link)
      ORDER BY x.at DESC), '[]'::jsonb)
    INTO v_changes FROM (SELECT * FROM public.cockpit_csm_changes WHERE task_id=p_task_id AND at>now()-interval '90 days'
                         ORDER BY at DESC LIMIT 40) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'ok',ok,'lastOkAt',last_ok_at,'lastRunAt',last_run_at,'note',note,'detail',detail) ORDER BY key), '[]'::jsonb)
    INTO v_health FROM public.cockpit_sync_state WHERE key LIKE 'csm-%';

  RETURN jsonb_build_object('taskId', p_task_id, 'clientName', v_name, 'calls', v_calls, 'forms', v_forms,
    'changes', coalesce(v_changes, '[]'::jsonb), 'health', v_health,
    'unmatchedCount', (SELECT count(*) FROM public.cockpit_csm_unmatched WHERE resolved_at IS NULL), 'at', now());
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_client_timeline(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_client_timeline(text) TO authenticated;

-- The caller's unmatched queue: everything open (recent first). CSMs see items whose host
-- is themselves plus any without a host; admins and the CEO see all.
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
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'kind',u.item_kind,'title',u.title,'at',u.at,'reason',u.reason,'hint',u.hint,'host',u.host_email) ORDER BY u.at DESC NULLS LAST)
    FROM (SELECT * FROM public.cockpit_csm_unmatched WHERE resolved_at IS NULL AND (boss OR host_email IS NULL OR lower(host_email)=m.email)
          ORDER BY at DESC NULLS LAST LIMIT 100) u), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_unmatched_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_unmatched_list() TO authenticated;

-- One-click "This is <client>": gated by the client gate, audited, re-applied by the worker.
CREATE OR REPLACE FUNCTION public.cockpit_csm_manual_match(p_unmatched_id bigint, p_task_id text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE g jsonb; u public.cockpit_csm_unmatched;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  SELECT * INTO u FROM public.cockpit_csm_unmatched WHERE id=p_unmatched_id FOR UPDATE;
  IF u.id IS NULL THEN RAISE EXCEPTION 'That item is no longer in the queue'; END IF;
  IF u.resolved_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'already',true,'taskId',u.resolved_task_id); END IF;
  UPDATE public.cockpit_csm_unmatched SET resolved_task_id=p_task_id, resolved_by=g->>'email', resolved_at=now(), updated_at=now() WHERE id=u.id;
  IF u.item_kind='call' THEN
    UPDATE public.cockpit_csm_calls SET task_id=p_task_id, client_name=g->>'clientName', match_method='manual', match_confidence=1, updated_at=now()
     WHERE id=u.item_ref::bigint;
  ELSE
    UPDATE public.cockpit_csm_call_forms SET task_id=p_task_id, matched_by='manual', updated_at=now() WHERE token=u.item_ref;
  END IF;
  INSERT INTO public.cockpit_csm_match_audit(item_kind,item_ref,task_id,actor_id,actor_email) VALUES(u.item_kind,u.item_ref,p_task_id,(g->>'actorId')::uuid,g->>'email');
  RETURN jsonb_build_object('ok',true,'taskId',p_task_id,'clientName',g->>'clientName');
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_manual_match(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_manual_match(bigint,text) TO authenticated;

-- A manual call log from the page ("Log a call"): writes the store row with the task id
-- as subject, after the ClickUp write succeeded in cockpit-csm-api.
CREATE OR REPLACE FUNCTION public.cockpit_csm_log_manual_call(p_task_id text, p_note text, p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE g jsonb; v_id bigint;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A request id is required'; END IF;
  IF length(coalesce(p_note,''))>8000 THEN RAISE EXCEPTION 'The note is too long'; END IF;
  INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,match_method,match_confidence,kind,title,starts_at,status,host_email,summary)
  VALUES('manual',p_request_id::text,p_task_id,g->>'clientName','manual',1,'checkin','Call logged in the cockpit',now(),'held',g->>'email',nullif(btrim(p_note),''))
  ON CONFLICT (source,source_id) DO UPDATE SET updated_at=now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'id',v_id);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_log_manual_call(text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_log_manual_call(text,text,uuid) TO authenticated;
