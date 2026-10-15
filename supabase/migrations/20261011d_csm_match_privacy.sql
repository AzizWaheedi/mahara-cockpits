-- CSM call privacy and match integrity after 20261011c.
-- A manually matched recording may not attach to another client's appointment.
-- Unassigned items do not become visible to every CSM. The manual-match command
-- must check the source item too, not only the destination client.

UPDATE public.cockpit_csm_calls r
SET linked_call_id=NULL, updated_at=now()
FROM public.cockpit_csm_calls a
WHERE r.linked_call_id=a.id AND r.task_id IS DISTINCT FROM a.task_id;

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
       (SELECT 1 FROM public.cockpit_csm_calls p WHERE p.id=c.linked_call_id AND p.task_id=p_task_id)) AND c.status<>'gone';

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
-- CREATE OR REPLACE may reset settings, privileges; state them explicitly.
ALTER FUNCTION public.cockpit_csm_client_timeline(text) SET search_path='';
REVOKE ALL ON FUNCTION public.cockpit_csm_client_timeline(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_client_timeline(text) TO authenticated;

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
    FROM (SELECT * FROM public.cockpit_csm_unmatched WHERE resolved_at IS NULL AND (boss OR lower(host_email)=m.email)
          ORDER BY at DESC NULLS LAST LIMIT 100) u), '[]'::jsonb);
END $$;
ALTER FUNCTION public.cockpit_csm_unmatched_list() SET search_path='';
REVOKE ALL ON FUNCTION public.cockpit_csm_unmatched_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_unmatched_list() TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_csm_manual_match(p_unmatched_id bigint, p_task_id text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE g jsonb; u public.cockpit_csm_unmatched; m public.cockpit_members; boss boolean;
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
                          THEN linked_call_id ELSE NULL END, updated_at=now()
     WHERE id=u.item_ref::bigint;
  ELSE
    UPDATE public.cockpit_csm_call_forms SET task_id=p_task_id, matched_by='manual', updated_at=now() WHERE token=u.item_ref;
  END IF;
  INSERT INTO public.cockpit_csm_match_audit(item_kind,item_ref,task_id,actor_id,actor_email) VALUES(u.item_kind,u.item_ref,p_task_id,(g->>'actorId')::uuid,g->>'email');
  RETURN jsonb_build_object('ok',true,'taskId',p_task_id,'clientName',g->>'clientName');
END $$;
ALTER FUNCTION public.cockpit_csm_manual_match(bigint,text) SET search_path='';
REVOKE ALL ON FUNCTION public.cockpit_csm_manual_match(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_manual_match(bigint,text) TO authenticated;
