-- Client success "Ask a team" requests reach the other team's ClickUp board
-- again (2026-10-12).
--
-- Live cause: under Convex every client success action went into an outbox
-- that an outside job wrote to ClickUp. The native cockpit only inserts the
-- decision row, and the ClickUp log (20261009f) enqueues media buyer rows only,
-- on the belief that client success decisions post their own comment. They do
-- not, so no request raised since the move reached a team.
--
-- 1. The four client success rows saved since the move carry the client's old
--    record id as their subject, so "Handled today" never matched them. Each
--    gets its client's name back; the old subject and the ClickUp id stay in
--    metadata. The audit trigger records the change.
-- 2. The ClickUp log also enqueues client success tickets, with the client's
--    ClickUp task and the note. Every other client success entry stays in the
--    cockpit. The clickup-writeback function decides whether each one is live.
-- 3. A delivered request writes its ticket link back to the decision, which is
--    what the page shows as "On the board".
BEGIN;

UPDATE public.cockpit_decisions d SET
  subject=btrim(c.data->>'name'),
  metadata=coalesce(d.metadata,'{}'::jsonb)||jsonb_build_object('taskId',c.data->>'taskId','subjectWas',d.subject)
FROM public.cockpit_csm_sources c
WHERE d.role='csm' AND d.subject ~ '^[a-z0-9]{32}$'
  AND c.table_name='clients' AND c.data->>'_id'=d.subject
  AND nullif(btrim(c.data->>'name'),'') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_sweep(p_kind text DEFAULT NULL::text, p_source_id text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE since timestamptz; n integer:=0; k integer;
BEGIN
 IF p_kind IS NOT NULL AND p_kind NOT IN('decision','manual_change','provider_action') THEN RAISE EXCEPTION 'Unsupported writeback kind'; END IF;
 SELECT enqueue_since INTO since FROM public.cockpit_clickup_writeback_config WHERE singleton;
 IF since IS NULL THEN RAISE EXCEPTION 'The ClickUp writeback configuration row is missing'; END IF;
 IF p_kind IS NULL OR p_kind='decision' THEN
  INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,campaign_name,payload)
  SELECT 'decision:'||d.id,'decision','cockpit_decisions',d.id::text,d.subject,jsonb_build_object(
    'decisionId',d.id,'role',d.role,'subject',d.subject,'action',d.action,'kind',coalesce(nullif(btrim(d.kind),''),'decision'),
    'evidence',coalesce(d.evidence,''),'reason',nullif(btrim(coalesce(d.reason,'')),''),
    'snooze',nullif(btrim(coalesce(d.metadata->>'snooze','')),''),
    'reroutedTo',nullif(btrim(coalesce(d.metadata->>'reroutedTo',d.metadata->>'rerouted_to','')),''),
    'clientTaskId',nullif(btrim(coalesce(d.metadata->>'taskId','')),''),
    'note',nullif(btrim(coalesce(d.metadata->>'note','')),''),
    'byEmail',(SELECT a.actor_email FROM public.cockpit_audit_log a WHERE a.entity_type='cockpit_decisions' AND a.entity_id=d.id::text
      AND a.action='INSERT' AND a.actor_email LIKE '%@%' ORDER BY a.created_at LIMIT 1),
    'at',round(extract(epoch FROM coalesce(d.logged_at,d.created_at))*1000))
  FROM public.cockpit_decisions d
  WHERE (d.role='media_buyer' OR (d.role='csm' AND d.kind='ticket')) AND d.source_system='supabase' AND d.created_at>=since
   AND (p_source_id IS NULL OR d.id::text=p_source_id)
   AND NOT EXISTS(SELECT 1 FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key='decision:'||d.id)
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS k=ROW_COUNT; n:=n+k;
 END IF;
 IF p_kind IS NULL OR p_kind='manual_change' THEN
  INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,campaign_name,payload)
  SELECT 'manual:'||r.id,'manual_change','cockpit_media_native_records',r.id::text,r.campaign_name,jsonb_build_object(
    'recordId',r.id,'campaignName',coalesce(nullif(r.data->>'campaignName',''),r.campaign_name),'adName',nullif(btrim(coalesce(r.data->>'adName','')),''),
    'what',coalesce(r.data->>'what',''),'by',coalesce(nullif(r.data->>'by',''),(SELECT u.email FROM auth.users u WHERE u.id=r.actor_id),'cockpit'),
    'at',round(extract(epoch FROM r.created_at)*1000))
  FROM public.cockpit_media_native_records r
  WHERE r.kind='manual' AND r.created_at>=since
   AND (p_source_id IS NULL OR r.id::text=p_source_id)
   AND NOT EXISTS(SELECT 1 FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key='manual:'||r.id)
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS k=ROW_COUNT; n:=n+k;
 END IF;
 IF p_kind IS NULL OR p_kind='provider_action' THEN
  INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,campaign_name,payload)
  SELECT 'action:'||m.id,'provider_action','cockpit_campaign_action_messages',m.id::text,m.campaign_name,jsonb_build_object(
    'actionId',m.id,'operation',a.operation,'campaignName',m.campaign_name,'what',m.text,
    'by',coalesce((SELECT u.email FROM auth.users u WHERE u.id=m.actor_id),'cockpit'),
    'at',round(extract(epoch FROM m.at)*1000),
    'adName',CASE WHEN a.operation='control.setStatus' AND coalesce(a.request->'args'->>'level','')<>'campaign' THEN nullif(a.request->'args'->>'name','') END,
    'metaId',CASE WHEN a.operation='control.setStatus' AND a.request->'args'->>'level'='campaign' THEN a.request->'args'->>'metaId' END,
    'syncAdStatus',(a.operation='control.setStatus' AND a.request->'args'->>'level'='campaign')
      OR (a.operation='execute.runAction' AND a.request->'args'->>'action'='Turn it off'))
  FROM public.cockpit_campaign_action_messages m JOIN public.cockpit_media_actions a ON a.id=m.id
  WHERE a.state='confirmed' AND m.at>=since
   AND a.operation IN('control.setStatus','execute.runAction','edit.setAdSetBudget','edit.duplicateAdSet','edit.newAdsFromExisting','edit.addCreativeToCampaign','cockpit.launchBuild','forms.publish','forms.switch')
   AND (p_source_id IS NULL OR m.id::text=p_source_id)
   AND NOT EXISTS(SELECT 1 FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key='action:'||m.id)
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS k=ROW_COUNT; n:=n+k;
 END IF;
 RETURN n;
END $function$;

DROP TRIGGER IF EXISTS trg_cockpit_decisions_clickup_writeback ON public.cockpit_decisions;
CREATE TRIGGER trg_cockpit_decisions_clickup_writeback AFTER INSERT ON public.cockpit_decisions
 FOR EACH ROW WHEN (NEW.source_system='supabase' AND (NEW.role='media_buyer' OR (NEW.role='csm' AND NEW.kind='ticket')))
 EXECUTE FUNCTION public.cockpit_clickup_writeback_enqueue_trigger('decision');

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_save(p_id uuid, p_token uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE q public.cockpit_clickup_writeback_queue; next_state text; ticket_url text;
BEGIN
 IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'A queue change is required'; END IF;
 SELECT * INTO q FROM public.cockpit_clickup_writeback_queue WHERE id=p_id FOR UPDATE;
 IF q.id IS NULL OR q.state<>'sending' OR q.claim_token IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'This queue item is no longer claimed by this run'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN('state','steps','progress','planned','task_id','error','next_attempt_at','delivered_at')) THEN
  RAISE EXCEPTION 'Unsupported queue change';
 END IF;
 next_state:=coalesce(p_patch->>'state','sending');
 IF next_state NOT IN('sending','retry','unknown','delivered','dry_run','skipped','failed') THEN RAISE EXCEPTION 'Unsupported queue state'; END IF;
 -- Steps are frozen once written: a retry posts exactly the same text.
 IF p_patch ? 'steps' AND q.steps IS NOT NULL AND q.steps IS DISTINCT FROM p_patch->'steps' THEN RAISE EXCEPTION 'Planned steps are frozen'; END IF;
 UPDATE public.cockpit_clickup_writeback_queue SET
  state=next_state,
  claim_token=CASE WHEN next_state='sending' THEN claim_token END,
  claimed_at=CASE WHEN next_state='sending' THEN claimed_at END,
  steps=CASE WHEN p_patch ? 'steps' AND jsonb_typeof(p_patch->'steps')='array' THEN p_patch->'steps' ELSE steps END,
  progress=CASE WHEN jsonb_typeof(p_patch->'progress')='object' THEN p_patch->'progress' ELSE progress END,
  planned=CASE WHEN p_patch ? 'planned' AND jsonb_typeof(p_patch->'planned')='array' THEN p_patch->'planned' ELSE planned END,
  task_id=CASE WHEN p_patch ? 'task_id' THEN p_patch->>'task_id' ELSE task_id END,
  error=CASE WHEN p_patch ? 'error' THEN left(p_patch->>'error',500) ELSE error END,
  next_attempt_at=coalesce((p_patch->>'next_attempt_at')::timestamptz,next_attempt_at),
  delivered_at=coalesce((p_patch->>'delivered_at')::timestamptz,delivered_at),
  updated_at=now()
 WHERE id=p_id RETURNING * INTO q;
 -- A request delivered to another team's board: its link shows on the cockpit entry.
 ticket_url:=q.progress->'ticket'->>'url';
 IF q.state='delivered' AND q.source_table='cockpit_decisions' AND ticket_url ~ '^https://app\.clickup\.com/' THEN
  UPDATE public.cockpit_decisions SET clickup_task_url=ticket_url,clickup_task_id=nullif(q.progress->'ticket'->>'id','')
  WHERE id=q.source_id::bigint AND clickup_task_url IS NULL;
 END IF;
 RETURN jsonb_build_object('id',q.id,'state',q.state);
END $function$;

REVOKE ALL ON FUNCTION public.cockpit_clickup_writeback_sweep(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_clickup_writeback_sweep(text,text) TO service_role;
REVOKE ALL ON FUNCTION public.cockpit_clickup_writeback_save(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_clickup_writeback_save(uuid,uuid,jsonb) TO service_role;
COMMIT;
