-- Team end-of-day reports that name a client, on that client's page.
-- hermes/csm-calls stores only the passages that name the client (never energy,
-- stress or other personal answers), from the cockpit EODs, the EOD Reports
-- sheet and the Slack EOD channels the bot can read. Browser reads only through
-- the gated cockpit_csm_client_timeline, so a CSM sees mentions of their own clients.

CREATE TABLE IF NOT EXISTS public.cockpit_csm_eod_mentions(
  id bigserial PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('cockpit','sheet','slack')),
  source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 200),
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name text,
  day date NOT NULL,
  at timestamptz NOT NULL,
  author text,
  role text,
  location text,
  link text,
  excerpt text NOT NULL CHECK (length(excerpt) BETWEEN 1 AND 1600),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id, task_id)
);
COMMENT ON TABLE public.cockpit_csm_eod_mentions IS
  'Passages of team EODs (cockpit, EOD Reports sheet, Slack EOD channels) that name a client, one row per report and client. Written by hermes/csm-calls; never browser-readable except through cockpit_csm_client_timeline.';
CREATE INDEX IF NOT EXISTS cockpit_csm_eod_mentions_task_idx ON public.cockpit_csm_eod_mentions(task_id, at DESC);
ALTER TABLE public.cockpit_csm_eod_mentions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_csm_eod_mentions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cockpit_csm_eod_mentions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cockpit_csm_eod_mentions_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_csm_client_timeline(p_task_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE g jsonb; v_name text; v_calls jsonb; v_forms jsonb; v_changes jsonb; v_health jsonb; v_briefs jsonb; v_eods jsonb;
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
                 FROM public.cockpit_csm_call_forms f WHERE f.linked_call_id=c.id AND f.task_id=p_task_id ORDER BY f.submitted_at DESC LIMIT 1)
    ) ORDER BY (c.starts_at>now() AND c.status IN ('booked','confirmed')) DESC,
               CASE WHEN c.starts_at>now() THEN c.starts_at END ASC,
               c.starts_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_calls
    FROM public.cockpit_csm_calls c
    LEFT JOIN LATERAL (
      SELECT x.recording_url, x.summary, x.transcript_text, x.transcript_path FROM public.cockpit_csm_calls x
       WHERE x.linked_call_id=c.id AND x.task_id=p_task_id AND x.source IN ('fathom','zoom') ORDER BY x.starts_at DESC LIMIT 1) r ON true
   WHERE c.task_id=p_task_id AND (c.linked_call_id IS NULL OR NOT EXISTS
       (SELECT 1 FROM public.cockpit_csm_calls p WHERE p.id=c.linked_call_id AND p.task_id=p_task_id AND p.status<>'gone')) AND c.status<>'gone';

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

  SELECT coalesce(jsonb_agg(jsonb_build_object('day', e.day, 'at', e.at, 'author', e.author, 'role', e.role,
      'where', e.location, 'link', e.link, 'excerpt', e.excerpt, 'source', e.source) ORDER BY e.at DESC), '[]'::jsonb)
    INTO v_eods FROM (SELECT * FROM public.cockpit_csm_eod_mentions WHERE task_id=p_task_id AND at>now()-interval '90 days'
                      ORDER BY at DESC LIMIT 60) e;

  SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'ok',ok,'lastOkAt',last_ok_at,'lastRunAt',last_run_at,'note',note,'detail',detail) ORDER BY key), '[]'::jsonb)
    INTO v_health FROM public.cockpit_sync_state WHERE key LIKE 'csm-%';

  RETURN jsonb_build_object('taskId', p_task_id, 'clientName', v_name, 'calls', v_calls, 'forms', v_forms,
    'changes', coalesce(v_changes, '[]'::jsonb), 'eods', v_eods, 'health', v_health,
    'unmatchedCount', (SELECT count(*) FROM public.cockpit_csm_unmatched WHERE resolved_at IS NULL), 'at', now());
END $$;
-- CREATE OR REPLACE may reset settings, privileges; state them explicitly.
ALTER FUNCTION public.cockpit_csm_client_timeline(text) SET search_path='';
REVOKE ALL ON FUNCTION public.cockpit_csm_client_timeline(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_client_timeline(text) TO authenticated;

