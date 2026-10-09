-- ClickUp writeback and tracking audit, native (9 Oct 2026).
--
-- The media Convex deployment was paused on 7 Oct 2026. Four of its jobs wrote
-- to ClickUp or read Meta and have no native code yet:
--   writeback.pushMetrics   board KPI columns, hourly at :05, 03-18 UTC
--   writeback.logDecision / logManualChange (+ the Ad Status move)
--   dosDonts.tidyClient     Do's & Don'ts clean format on client cards
--   tracking.audit          daily 02:30 UTC, URL tags and lead forms
-- The Edge Functions clickup-writeback and tracking-audit run them. This
-- migration gives them their tables, service-role RPCs and pg_cron schedules.
--
-- Safety
-- - Nothing reaches ClickUp unless the Edge Function secret
--   CLICKUP_WRITEBACK_APPLY is exactly "true". A dry run records each write it
--   would make (task id, field, old value, new value) on
--   cockpit_clickup_writeback_runs.planned and on the queue item's planned.
-- - The cockpit save never waits on ClickUp. Decisions, typed changes and
--   confirmed provider actions are queued by triggers that cannot fail the
--   save; the drain's sweep catches anything a trigger missed.
-- - No table the native media publication fingerprints is written
--   (cockpit_native_manifest: cockpit_media_sources, cockpit_decisions, ...).
--   Tracking issues live in their own table, so the CAS publication used by
--   hermes/cockpit-sync is untouched.
--
-- Operator notes
-- - Dry-run items stay in state 'dry_run'. To deliver them after going live:
--     UPDATE public.cockpit_clickup_writeback_queue SET state='queued',attempts=0,
--       next_attempt_at=now(),planned=NULL WHERE state='dry_run' AND created_at>now()-interval '1 day';
-- - Native decisions logged between the Convex pause and this migration are
--   not queued. To include them, lower cockpit_clickup_writeback_config.enqueue_since.

BEGIN;

-- 1. Tables -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cockpit_clickup_writeback_config(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enqueue_since timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.cockpit_clickup_writeback_config(singleton) VALUES(true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.cockpit_clickup_writeback_queue(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 dedupe_key text NOT NULL UNIQUE,
 kind text NOT NULL CHECK(kind IN('decision','manual_change','provider_action','tracking_backlog')),
 source_table text NOT NULL,
 source_id text NOT NULL,
 campaign_name text,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','sending','retry','unknown','delivered','dry_run','skipped','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 claim_token uuid,
 claimed_at timestamptz,
 task_id text,
 steps jsonb CHECK(steps IS NULL OR jsonb_typeof(steps)='array'),
 progress jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(progress)='object'),
 planned jsonb CHECK(planned IS NULL OR jsonb_typeof(planned)='array'),
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz,
 CHECK((state='sending')=(claim_token IS NOT NULL))
);
COMMENT ON TABLE public.cockpit_clickup_writeback_queue IS
 'ClickUp log entries waiting for the clickup-writeback Edge Function: one row per native decision, typed change, confirmed provider action or weekly tracking backlog. steps freeze the exact text before the first write; progress records each step so a retry reads back instead of posting twice.';
CREATE INDEX IF NOT EXISTS cockpit_clickup_writeback_due ON public.cockpit_clickup_writeback_queue(next_attempt_at) WHERE state IN('queued','retry','unknown');
CREATE INDEX IF NOT EXISTS cockpit_clickup_writeback_sending ON public.cockpit_clickup_writeback_queue(claimed_at) WHERE state='sending';

CREATE TABLE IF NOT EXISTS public.cockpit_clickup_writeback_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job text NOT NULL CHECK(job IN('kpi','log','dosdonts')),
 mode text NOT NULL CHECK(mode IN('dry_run','apply','apply_limited')),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 ok boolean,
 note text,
 counts jsonb NOT NULL DEFAULT '{}'::jsonb,
 planned jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(planned)='array')
);
COMMENT ON TABLE public.cockpit_clickup_writeback_runs IS
 'One row per clickup-writeback run. planned lists every write the run made or, in a dry run, would make: task id, field, old value, new value, status.';
CREATE INDEX IF NOT EXISTS cockpit_clickup_writeback_runs_job ON public.cockpit_clickup_writeback_runs(job,started_at DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_media_tracking_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 status text NOT NULL DEFAULT 'running' CHECK(status IN('running','published','failed')),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 accounts integer,
 accounts_read integer,
 accounts_failed jsonb NOT NULL DEFAULT '[]'::jsonb,
 ads_checked integer,
 issues integer,
 note text
);
CREATE INDEX IF NOT EXISTS cockpit_media_tracking_runs_finished ON public.cockpit_media_tracking_runs(finished_at DESC) WHERE status='published';

CREATE TABLE IF NOT EXISTS public.cockpit_media_tracking_issues(
 id text PRIMARY KEY,
 client text NOT NULL,
 account_id text NOT NULL,
 ad_id text NOT NULL,
 ad_name text NOT NULL,
 issue text NOT NULL CHECK(issue IN('No URL parameters','No lead form attached')),
 detail text,
 found_at timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz NOT NULL DEFAULT now(),
 run_id uuid NOT NULL REFERENCES public.cockpit_media_tracking_runs(id)
);
COMMENT ON TABLE public.cockpit_media_tracking_issues IS
 'Open tracking faults on live ads, from the tracking-audit Edge Function (convex/tracking.ts rules). found_at is first seen; checked_at is the last audit that saw it. An account Meta refused keeps its earlier rows.';
CREATE INDEX IF NOT EXISTS cockpit_media_tracking_issues_account ON public.cockpit_media_tracking_issues(account_id);

ALTER TABLE public.cockpit_clickup_writeback_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_clickup_writeback_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_clickup_writeback_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_media_tracking_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_media_tracking_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_clickup_writeback_config,public.cockpit_clickup_writeback_queue,public.cockpit_clickup_writeback_runs,
 public.cockpit_media_tracking_runs,public.cockpit_media_tracking_issues FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_clickup_writeback_config,public.cockpit_clickup_writeback_queue,public.cockpit_clickup_writeback_runs TO service_role;
GRANT SELECT ON public.cockpit_media_tracking_runs,public.cockpit_media_tracking_issues TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_sync_state TO service_role;

-- 2. Audit rows ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE after_row jsonb:=to_jsonb(NEW)-'planned'-'steps'; before_row jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN before_row:=to_jsonb(OLD)-'planned'-'steps'; END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after",metadata)
 VALUES(lower(TG_OP)||':'||coalesce(after_row->>'state',after_row->>'status',CASE WHEN after_row->>'finished_at' IS NOT NULL THEN 'finished' ELSE 'started' END),
  TG_TABLE_NAME,after_row->>'id',CASE WHEN TG_TABLE_NAME LIKE 'cockpit_media_tracking%' THEN 'tracking-audit' ELSE 'clickup-writeback' END,
  'media-buyer','supabase',before_row,after_row,'{}'::jsonb);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_clickup_writeback_audit() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_insert ON public.cockpit_clickup_writeback_queue;
CREATE TRIGGER cockpit_clickup_writeback_queue_audit_insert AFTER INSERT ON public.cockpit_clickup_writeback_queue
 FOR EACH ROW EXECUTE FUNCTION public.cockpit_clickup_writeback_audit();
DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_state ON public.cockpit_clickup_writeback_queue;
CREATE TRIGGER cockpit_clickup_writeback_queue_audit_state AFTER UPDATE OF state ON public.cockpit_clickup_writeback_queue
 FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.state<>'sending') EXECUTE FUNCTION public.cockpit_clickup_writeback_audit();
DROP TRIGGER IF EXISTS cockpit_clickup_writeback_runs_audit ON public.cockpit_clickup_writeback_runs;
CREATE TRIGGER cockpit_clickup_writeback_runs_audit AFTER INSERT OR UPDATE OF finished_at ON public.cockpit_clickup_writeback_runs
 FOR EACH ROW EXECUTE FUNCTION public.cockpit_clickup_writeback_audit();
DROP TRIGGER IF EXISTS cockpit_clickup_writeback_config_audit ON public.cockpit_clickup_writeback_config;
CREATE TRIGGER cockpit_clickup_writeback_config_audit AFTER INSERT OR UPDATE ON public.cockpit_clickup_writeback_config
 FOR EACH ROW EXECUTE FUNCTION public.cockpit_clickup_writeback_audit();
DROP TRIGGER IF EXISTS cockpit_media_tracking_runs_audit ON public.cockpit_media_tracking_runs;
CREATE TRIGGER cockpit_media_tracking_runs_audit AFTER INSERT OR UPDATE OF status ON public.cockpit_media_tracking_runs
 FOR EACH ROW EXECUTE FUNCTION public.cockpit_clickup_writeback_audit();

-- 3. Freshness row (tap-charges-sync's cockpit_sync_state pattern) ------------------

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_state(p_key text,p_ok boolean,p_note text,p_rows integer DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- A failed run keeps the last good time, and rows_seen stays empty rather than zero.
 INSERT INTO public.cockpit_sync_state AS s(key,last_run_at,last_ok_at,ok,note,rows_seen,updated_at)
 VALUES(p_key,now(),CASE WHEN p_ok THEN now() END,coalesce(p_ok,false),left(p_note,500),p_rows,now())
 ON CONFLICT(key) DO UPDATE SET last_run_at=excluded.last_run_at,last_ok_at=coalesce(excluded.last_ok_at,s.last_ok_at),
  ok=excluded.ok,note=excluded.note,rows_seen=excluded.rows_seen,updated_at=excluded.updated_at;
END $$;

-- 4. Enqueue: triggers plus the drain's sweep --------------------------------------
-- Only native media buyer rows after the watermark. Imported Convex history was
-- already posted by Convex; CSM decisions post their own ClickUp comment.
-- Provider actions follow convex/control.ts and edit.ts: switches, budgets,
-- copies, new ads and creatives, executed recommendations and builds. Board
-- actions are ClickUp writes themselves; questions and requests are not changes.

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_sweep(p_kind text DEFAULT NULL,p_source_id text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE since timestamptz; n integer:=0; k integer;
BEGIN
 IF p_kind IS NOT NULL AND p_kind NOT IN('decision','manual_change','provider_action') THEN RAISE EXCEPTION 'Unsupported writeback kind'; END IF;
 SELECT enqueue_since INTO since FROM public.cockpit_clickup_writeback_config WHERE singleton;
 IF since IS NULL THEN RAISE EXCEPTION 'The ClickUp writeback configuration row is missing'; END IF;
 IF p_kind IS NULL OR p_kind='decision' THEN
  INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,campaign_name,payload)
  SELECT 'decision:'||d.id,'decision','cockpit_decisions',d.id::text,d.subject,jsonb_build_object(
    'decisionId',d.id,'subject',d.subject,'action',d.action,'kind',coalesce(nullif(btrim(d.kind),''),'decision'),
    'evidence',coalesce(d.evidence,''),'reason',nullif(btrim(coalesce(d.reason,'')),''),
    'snooze',nullif(btrim(coalesce(d.metadata->>'snooze','')),''),
    'reroutedTo',nullif(btrim(coalesce(d.metadata->>'reroutedTo',d.metadata->>'rerouted_to','')),''),
    'byEmail',(SELECT a.actor_email FROM public.cockpit_audit_log a WHERE a.entity_type='cockpit_decisions' AND a.entity_id=d.id::text
      AND a.action='INSERT' AND a.actor_email LIKE '%@%' ORDER BY a.created_at LIMIT 1),
    'at',round(extract(epoch FROM coalesce(d.logged_at,d.created_at))*1000))
  FROM public.cockpit_decisions d
  WHERE d.role='media_buyer' AND d.source_system='supabase' AND d.created_at>=since
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
   AND a.operation IN('control.setStatus','execute.runAction','edit.setAdSetBudget','edit.duplicateAdSet','edit.newAdsFromExisting','edit.addCreativeToCampaign','cockpit.launchBuild')
   AND (p_source_id IS NULL OR m.id::text=p_source_id)
   AND NOT EXISTS(SELECT 1 FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key='action:'||m.id)
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS k=ROW_COUNT; n:=n+k;
 END IF;
 RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_enqueue_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 BEGIN
  PERFORM public.cockpit_clickup_writeback_sweep(TG_ARGV[0],NEW.id::text);
 EXCEPTION WHEN OTHERS THEN
  -- Never fail the cockpit save over the ClickUp log. The drain's sweep enqueues it later.
  RAISE WARNING 'ClickUp writeback enqueue deferred for % %: %',TG_ARGV[0],NEW.id,SQLERRM;
 END;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_clickup_writeback_enqueue_trigger() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS trg_cockpit_decisions_clickup_writeback ON public.cockpit_decisions;
CREATE TRIGGER trg_cockpit_decisions_clickup_writeback AFTER INSERT ON public.cockpit_decisions
 FOR EACH ROW WHEN (NEW.role='media_buyer' AND NEW.source_system='supabase')
 EXECUTE FUNCTION public.cockpit_clickup_writeback_enqueue_trigger('decision');
DROP TRIGGER IF EXISTS cockpit_media_native_records_clickup_writeback ON public.cockpit_media_native_records;
CREATE TRIGGER cockpit_media_native_records_clickup_writeback AFTER INSERT ON public.cockpit_media_native_records
 FOR EACH ROW WHEN (NEW.kind='manual')
 EXECUTE FUNCTION public.cockpit_clickup_writeback_enqueue_trigger('manual_change');
DROP TRIGGER IF EXISTS cockpit_campaign_action_messages_clickup_writeback ON public.cockpit_campaign_action_messages;
CREATE TRIGGER cockpit_campaign_action_messages_clickup_writeback AFTER INSERT ON public.cockpit_campaign_action_messages
 FOR EACH ROW EXECUTE FUNCTION public.cockpit_clickup_writeback_enqueue_trigger('provider_action');

-- The weekly tracking backlog task, queued by tracking-audit.
CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_enqueue(p_dedupe_key text,p_kind text,p_source_table text,p_source_id text,p_payload jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k integer;
BEGIN
 IF p_kind IS DISTINCT FROM 'tracking_backlog' OR p_dedupe_key !~ '^tracking-backlog:[0-9]{4}-W[0-9]{2}$' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
  OR nullif(btrim(p_payload->>'name'),'') IS NULL OR coalesce(p_payload->>'listId','') !~ '^[0-9]+$' OR nullif(p_source_id,'') IS NULL THEN
  RAISE EXCEPTION 'Unsupported writeback item';
 END IF;
 INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,payload)
 VALUES(p_dedupe_key,p_kind,coalesce(p_source_table,'cockpit_media_tracking_runs'),p_source_id,p_payload) ON CONFLICT (dedupe_key) DO NOTHING;
 GET DIAGNOSTICS k=ROW_COUNT;
 RETURN k=1;
END $$;

-- 5. Drain: claim, save, runs ------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_claim(p_token uuid,p_limit integer DEFAULT 15) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE out jsonb;
BEGIN
 IF p_token IS NULL THEN RAISE EXCEPTION 'A claim token is required'; END IF;
 -- A 'sending' claim older than ten minutes died mid-run: it is claimed again and read back first.
 WITH picked AS (
  SELECT q.id FROM public.cockpit_clickup_writeback_queue q
  WHERE (q.state IN('queued','retry','unknown') AND q.next_attempt_at<=now())
     OR (q.state='sending' AND q.claimed_at<now()-interval '10 minutes')
  ORDER BY q.created_at
  LIMIT greatest(1,least(coalesce(p_limit,15),50))
  FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE public.cockpit_clickup_writeback_queue q
  SET state='sending',claim_token=p_token,claimed_at=now(),attempts=q.attempts+1,updated_at=now()
  FROM picked WHERE q.id=picked.id
  RETURNING q.*
 )
 SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('source_exists',CASE c.kind
   WHEN 'decision' THEN EXISTS(SELECT 1 FROM public.cockpit_decisions d WHERE d.id=c.source_id::bigint)
   WHEN 'manual_change' THEN EXISTS(SELECT 1 FROM public.cockpit_media_native_records r WHERE r.id=c.source_id::uuid)
   ELSE true END) ORDER BY c.created_at),'[]'::jsonb)
 INTO out FROM claimed c;
 RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_save(p_id uuid,p_token uuid,p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.cockpit_clickup_writeback_queue; next_state text;
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
 RETURN jsonb_build_object('id',q.id,'state',q.state);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_begin(p_job text,p_mode text,p_exclusive boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_clickup_writeback_runs;
BEGIN
 IF p_job NOT IN('kpi','log','dosdonts') OR p_mode NOT IN('dry_run','apply','apply_limited') THEN RAISE EXCEPTION 'Unsupported writeback run'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_clickup_writeback:'||p_job,0));
 UPDATE public.cockpit_clickup_writeback_runs SET finished_at=now(),ok=false,note=coalesce(note,'This run stopped without reporting back.')
 WHERE job=p_job AND finished_at IS NULL AND started_at<=now()-interval '15 minutes';
 IF p_exclusive THEN
  SELECT * INTO r FROM public.cockpit_clickup_writeback_runs WHERE job=p_job AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1;
  IF r.id IS NOT NULL THEN
   RETURN jsonb_build_object('id',NULL,'note','A '||p_job||' run that started at '||to_char(r.started_at AT TIME ZONE 'Asia/Kuwait','HH24:MI')||' Kuwait is still running.');
  END IF;
 END IF;
 INSERT INTO public.cockpit_clickup_writeback_runs(job,mode) VALUES(p_job,p_mode) RETURNING * INTO r;
 RETURN jsonb_build_object('id',r.id);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_finish(p_run uuid,p_ok boolean,p_note text,p_counts jsonb DEFAULT '{}'::jsonb,p_planned jsonb DEFAULT '[]'::jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_clickup_writeback_runs;
BEGIN
 UPDATE public.cockpit_clickup_writeback_runs SET finished_at=now(),ok=coalesce(p_ok,false),note=left(p_note,1000),
  counts=CASE WHEN jsonb_typeof(p_counts)='object' THEN p_counts ELSE '{}'::jsonb END,
  planned=CASE WHEN jsonb_typeof(p_planned)='array' THEN p_planned ELSE '[]'::jsonb END
 WHERE id=p_run AND finished_at IS NULL RETURNING * INTO r;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Unknown or already finished writeback run'; END IF;
 PERFORM public.cockpit_clickup_writeback_state('clickup-writeback:'||r.job,r.ok,
  CASE r.mode WHEN 'dry_run' THEN '' ELSE r.mode||': ' END||coalesce(r.note,''),jsonb_array_length(r.planned));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_idle(p_job text,p_ok boolean,p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_job NOT IN('kpi','log','dosdonts') THEN RETURN; END IF;
 PERFORM public.cockpit_clickup_writeback_state('clickup-writeback:'||p_job,p_ok,p_note,CASE WHEN p_ok THEN 0 END);
END $$;

-- 6. Inputs: board campaigns and the 7-day ledgers ---------------------------------
-- The KPI job recomputes CPL from cockpit_media_daily_stats (spend is stored in
-- USD by the producer) and checks it against the campaign row before writing.

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_inputs(p_with_stats boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE today date:=(now() AT TIME ZONE 'Asia/Kuwait')::date; out jsonb;
BEGIN
 out:=jsonb_build_object('workingDay',today,
  'campaigns',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'campaignName',c.raw_data->>'campaignName','clientName',nullif(c.raw_data->>'clientName',''),'clientTag',nullif(c.raw_data->>'clientTag',''),
    'taskId',nullif(coalesce(c.raw_data->>'taskId',c.task_id),''),'taskUrl',coalesce(c.raw_data->>'taskUrl',c.task_url),
    'internal',coalesce(c.raw_data->>'internal','false')='true',
    'cpl',c.raw_data->'cpl','spend7d',c.raw_data->'spend7d','leads7d',c.raw_data->'leads7d','bookings7d',c.raw_data->'bookings7d',
    'metaCampaignId',coalesce(nullif(c.raw_data->>'metaCampaignId',''),c.meta_campaign_id),'boardAdStatus',c.raw_data->>'boardAdStatus',
    'syncedAt',c.synced_at) ORDER BY c.id)
   FROM public.cockpit_campaigns c WHERE NOT c.source_deleted AND nullif(c.raw_data->>'campaignName','') IS NOT NULL),'[]'::jsonb),
  'latestPublishAt',(SELECT max(r.published_at) FROM public.cockpit_native_media_runs r WHERE r.status='published'),
  'latestSyncedAt',(SELECT max(c.synced_at) FROM public.cockpit_campaigns c WHERE NOT c.source_deleted));
 IF p_with_stats THEN
  out:=out||jsonb_build_object(
   'dailyReady',coalesce((SELECT f.ready FROM public.cockpit_media_feed_state f WHERE f.feed='dailyStats'),false),
   'bookingsReady',coalesce((SELECT f.ready FROM public.cockpit_media_feed_state f WHERE f.feed='bookingEvents'),false),
   'daily',coalesce((SELECT jsonb_agg(jsonb_build_object('campaignName',s.campaign_name,'day',s.day,'spend',s.spend,'leads',s.leads))
    FROM (SELECT d.campaign_name,d.day,sum((d.data->>'spend')::numeric) AS spend,sum((d.data->>'leads')::numeric) AS leads
     FROM public.cockpit_media_daily_stats d WHERE d.day>=today-8 GROUP BY d.campaign_name,d.day) s),'[]'::jsonb),
   'bookings',coalesce((SELECT jsonb_agg(jsonb_build_object('client',b.client,'day',b.day,'booked',b.n))
    FROM (SELECT lower(btrim(e.data->>'client')) AS client,e.day,count(*) AS n FROM public.cockpit_media_booking_events e
     WHERE e.day>=today-8 AND nullif(btrim(e.data->>'client'),'') IS NOT NULL GROUP BY 1,2) b),'[]'::jsonb));
 END IF;
 RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_clickup_writeback_doctor() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'enqueueSince',(SELECT c.enqueue_since FROM public.cockpit_clickup_writeback_config c WHERE c.singleton),
  'queue',(SELECT coalesce(jsonb_object_agg(s.state,s.n),'{}'::jsonb) FROM (SELECT q.state,count(*) AS n FROM public.cockpit_clickup_writeback_queue q GROUP BY q.state) s),
  'oldestDue',(SELECT min(q.next_attempt_at) FROM public.cockpit_clickup_writeback_queue q WHERE q.state IN('queued','retry','unknown')),
  'stuckSending',(SELECT count(*) FROM public.cockpit_clickup_writeback_queue q WHERE q.state='sending' AND q.claimed_at<now()-interval '10 minutes'),
  'lastRuns',(SELECT coalesce(jsonb_object_agg(r.job,jsonb_build_object('startedAt',r.started_at,'finishedAt',r.finished_at,'ok',r.ok,'mode',r.mode,'note',r.note)),'{}'::jsonb)
   FROM (SELECT DISTINCT ON (x.job) x.* FROM public.cockpit_clickup_writeback_runs x ORDER BY x.job,x.started_at DESC) r),
  'state',(SELECT coalesce(jsonb_object_agg(s.key,jsonb_build_object('lastRunAt',s.last_run_at,'lastOkAt',s.last_ok_at,'ok',s.ok,'note',s.note)),'{}'::jsonb)
   FROM public.cockpit_sync_state s WHERE s.key LIKE 'clickup-writeback:%' OR s.key='tracking-audit'),
  'trackingOpen',(SELECT count(*) FROM public.cockpit_media_tracking_issues));
$$;

-- 7. Tracking audit ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_media_tracking_inputs() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE feed public.cockpit_media_source_state;
BEGIN
 -- The accounts Convex audited: every ad account in the market plays (convex/tracking.ts accounts).
 SELECT * INTO feed FROM public.cockpit_media_source_state WHERE table_name='marketPlays';
 IF feed.ready IS DISTINCT FROM true OR feed.source_snapshot_at IS NULL OR feed.row_count IS NULL
  OR feed.row_count<>(SELECT count(*) FROM public.cockpit_media_sources s WHERE s.table_name='marketPlays' AND s.source_snapshot_at=feed.source_snapshot_at) THEN
  RETURN jsonb_build_object('ready',false,'accounts','[]'::jsonb);
 END IF;
 RETURN jsonb_build_object('ready',true,'sourceAt',feed.source_snapshot_at,'accounts',coalesce((
  SELECT jsonb_agg(jsonb_build_object('accountId',a.account_id,'client',a.client) ORDER BY a.account_id) FROM (
   SELECT DISTINCT ON (regexp_replace(btrim(s.data->>'accountId'),'^act_',''))
    regexp_replace(btrim(s.data->>'accountId'),'^act_','') AS account_id,btrim(s.data->>'client') AS client
   FROM public.cockpit_media_sources s
   WHERE s.table_name='marketPlays' AND s.source_snapshot_at=feed.source_snapshot_at
    AND nullif(btrim(s.data->>'accountId'),'') IS NOT NULL AND nullif(btrim(s.data->>'client'),'') IS NOT NULL
   ORDER BY regexp_replace(btrim(s.data->>'accountId'),'^act_',''),s.source_id) a),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_media_tracking_begin(p_accounts integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_media_tracking',0));
 UPDATE public.cockpit_media_tracking_runs SET status='failed',finished_at=now(),note=coalesce(note,'This audit stopped without reporting back.')
 WHERE status='running' AND started_at<=now()-interval '30 minutes';
 IF EXISTS(SELECT 1 FROM public.cockpit_media_tracking_runs WHERE status='running') THEN
  RETURN jsonb_build_object('id',NULL,'note','Another tracking audit is still running.');
 END IF;
 INSERT INTO public.cockpit_media_tracking_runs(accounts) VALUES(p_accounts) RETURNING id INTO v;
 RETURN jsonb_build_object('id',v);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_media_tracking_publish(p_run uuid,p_issues jsonb,p_read text[],p_failed jsonb DEFAULT '[]'::jsonb,p_checked integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_media_tracking_runs; v_upserted integer; v_removed integer; v_open integer; v_note text; v_rows jsonb; v_failed integer;
BEGIN
 SELECT * INTO r FROM public.cockpit_media_tracking_runs WHERE id=p_run FOR UPDATE;
 IF r.id IS NULL OR r.status<>'running' THEN RAISE EXCEPTION 'This tracking audit run is not running'; END IF;
 IF jsonb_typeof(p_issues) IS DISTINCT FROM 'array' OR coalesce(cardinality(p_read),0)=0 THEN RAISE EXCEPTION 'A complete audit result with at least one read account is required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_issues) e WHERE jsonb_typeof(e)<>'object' OR NOT(coalesce(e->>'accountId','')=ANY(p_read))
  OR nullif(e->>'adId','') IS NULL OR nullif(btrim(e->>'client'),'') IS NULL OR coalesce(e->>'issue','') NOT IN('No URL parameters','No lead form attached')) THEN
  RAISE EXCEPTION 'Every issue needs a read account, an ad, a client and a known issue';
 END IF;
 v_failed:=CASE WHEN jsonb_typeof(p_failed)='array' THEN jsonb_array_length(p_failed) ELSE 0 END;
 INSERT INTO public.cockpit_media_tracking_issues(id,client,account_id,ad_id,ad_name,issue,detail,found_at,checked_at,run_id)
 SELECT DISTINCT ON (x.k) x.k,btrim(x.e->>'client'),x.e->>'accountId',x.e->>'adId',coalesce(x.e->>'adName',''),x.e->>'issue',x.e->>'detail',now(),now(),p_run
 FROM (SELECT (value->>'accountId')||':'||(value->>'adId')||':'||(value->>'issue') AS k,value AS e FROM jsonb_array_elements(p_issues)) x
 ORDER BY x.k
 ON CONFLICT (id) DO UPDATE SET client=excluded.client,ad_name=excluded.ad_name,detail=excluded.detail,checked_at=excluded.checked_at,run_id=excluded.run_id;
 GET DIAGNOSTICS v_upserted=ROW_COUNT;
 -- Fixed since the last audit: gone from an account that was read this time.
 DELETE FROM public.cockpit_media_tracking_issues WHERE account_id=ANY(p_read) AND run_id<>p_run;
 GET DIAGNOSTICS v_removed=ROW_COUNT;
 SELECT count(*) INTO v_open FROM public.cockpit_media_tracking_issues;
 v_note:=coalesce(p_checked,0)||' live ads checked across '||cardinality(p_read)||' accounts: '||v_open||' tracking issues open, '||v_removed||' fixed since the last audit.'
  ||CASE WHEN v_failed>0 THEN ' '||v_failed||' accounts could not be read; their earlier issues are kept.' ELSE '' END;
 UPDATE public.cockpit_media_tracking_runs SET status='published',finished_at=now(),accounts_read=cardinality(p_read),
  accounts_failed=CASE WHEN jsonb_typeof(p_failed)='array' THEN p_failed ELSE '[]'::jsonb END,ads_checked=coalesce(p_checked,0),issues=v_open,note=v_note
 WHERE id=p_run;
 PERFORM public.cockpit_clickup_writeback_state('tracking-audit',true,v_note,v_open);
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata)
 VALUES('tracking.publish','cockpit_media_tracking_issues',p_run::text,'tracking-audit','media-buyer','supabase',
  jsonb_build_object('upserted',v_upserted,'removed',v_removed,'open',v_open,'accountsRead',cardinality(p_read),'accountsFailed',v_failed));
 SELECT coalesce(jsonb_agg(jsonb_build_object('client',i.client,'adName',i.ad_name,'issue',i.issue) ORDER BY i.client,i.ad_name,i.issue),'[]'::jsonb)
 INTO v_rows FROM public.cockpit_media_tracking_issues i;
 RETURN jsonb_build_object('note',v_note,'open',v_open,'removed',v_removed,'current',v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_media_tracking_fail(p_run uuid,p_note text,p_failed jsonb DEFAULT '[]'::jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.cockpit_media_tracking_runs SET status='failed',finished_at=now(),note=left(p_note,1000),
  accounts_failed=CASE WHEN jsonb_typeof(p_failed)='array' THEN p_failed ELSE '[]'::jsonb END
 WHERE id=p_run AND status='running';
 PERFORM public.cockpit_clickup_writeback_state('tracking-audit',false,p_note,NULL);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_media_tracking_idle(p_ok boolean,p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.cockpit_clickup_writeback_state('tracking-audit',p_ok,p_note,NULL);
END $$;

-- 8. Read path: the cockpit's tracking backlog reads the native audit once it has
-- published, and the imported Convex snapshot before that. Otherwise unchanged
-- from 20261004d_media_native_surface.sql.

CREATE OR REPLACE FUNCTION public.cockpit_media_native_source(p_table text,p_campaign text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE feed public.cockpit_media_source_state; rows jsonb; native_at timestamptz;
BEGIN
 PERFORM public.cockpit_media_scope('board.adStatusOptions',NULL);
 IF p_table NOT IN('marketPlays','trackingIssues','adChanges','manualChanges','campaignChat','syncRuns','onboardings','launchWatch','clientPrefs','boardCards') THEN RAISE EXCEPTION 'Unsupported media source'; END IF;
 IF p_campaign IS NOT NULL THEN PERFORM public.cockpit_media_scope('chat.thread',p_campaign); END IF;
 IF p_table='trackingIssues' AND p_campaign IS NULL THEN
  SELECT max(t.finished_at) INTO native_at FROM public.cockpit_media_tracking_runs t WHERE t.status='published';
  IF native_at IS NOT NULL THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('_id',i.id,'client',i.client,'accountId',i.account_id,'adId',i.ad_id,'adName',i.ad_name,
     'issue',i.issue,'detail',i.detail,'foundAt',round(extract(epoch FROM i.found_at)*1000)) ORDER BY i.client,i.ad_name,i.issue),'[]')
   INTO rows FROM public.cockpit_media_tracking_issues i
   WHERE public.cockpit_ask_ai_owner_allowed(auth.uid(),'media-buyer',i.client);
   RETURN jsonb_build_object('rows',rows,'sourceAt',native_at);
  END IF;
 END IF;
 SELECT * INTO feed FROM public.cockpit_media_source_state WHERE table_name=p_table;
 IF feed.ready IS DISTINCT FROM true OR feed.source_snapshot_at IS NULL OR feed.row_count IS NULL OR feed.row_count<>(SELECT count(*) FROM public.cockpit_media_sources WHERE table_name=p_table AND source_snapshot_at=feed.source_snapshot_at) THEN
  RAISE EXCEPTION 'The % source has not been imported and verified. Run the media source producer before using this view.',p_table;
 END IF;
 SELECT coalesce(jsonb_agg(s.data),'[]') INTO rows FROM public.cockpit_media_sources s
 WHERE s.table_name=p_table AND s.source_snapshot_at=feed.source_snapshot_at
 AND (p_campaign IS NULL OR coalesce(s.data->>'campaignName',s.data->>'campaignId')=p_campaign)
 AND (p_table='syncRuns' OR EXISTS(SELECT 1 FROM unnest(s.client_names) n WHERE public.cockpit_ask_ai_owner_allowed(auth.uid(),'media-buyer',n)));
 RETURN jsonb_build_object('rows',rows,'sourceAt',feed.source_snapshot_at);
END $$;

-- 9. Privileges: service role only ---------------------------------------------------

REVOKE ALL ON FUNCTION
 public.cockpit_clickup_writeback_state(text,boolean,text,integer),
 public.cockpit_clickup_writeback_sweep(text,text),
 public.cockpit_clickup_writeback_enqueue(text,text,text,text,jsonb),
 public.cockpit_clickup_writeback_claim(uuid,integer),
 public.cockpit_clickup_writeback_save(uuid,uuid,jsonb),
 public.cockpit_clickup_writeback_begin(text,text,boolean),
 public.cockpit_clickup_writeback_finish(uuid,boolean,text,jsonb,jsonb),
 public.cockpit_clickup_writeback_idle(text,boolean,text),
 public.cockpit_clickup_writeback_inputs(boolean),
 public.cockpit_clickup_writeback_doctor(),
 public.cockpit_media_tracking_inputs(),
 public.cockpit_media_tracking_begin(integer),
 public.cockpit_media_tracking_publish(uuid,jsonb,text[],jsonb,integer),
 public.cockpit_media_tracking_fail(uuid,text,jsonb),
 public.cockpit_media_tracking_idle(boolean,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
 public.cockpit_clickup_writeback_sweep(text,text),
 public.cockpit_clickup_writeback_enqueue(text,text,text,text,jsonb),
 public.cockpit_clickup_writeback_claim(uuid,integer),
 public.cockpit_clickup_writeback_save(uuid,uuid,jsonb),
 public.cockpit_clickup_writeback_begin(text,text,boolean),
 public.cockpit_clickup_writeback_finish(uuid,boolean,text,jsonb,jsonb),
 public.cockpit_clickup_writeback_idle(text,boolean,text),
 public.cockpit_clickup_writeback_inputs(boolean),
 public.cockpit_clickup_writeback_doctor(),
 public.cockpit_media_tracking_inputs(),
 public.cockpit_media_tracking_begin(integer),
 public.cockpit_media_tracking_publish(uuid,jsonb,text[],jsonb,integer),
 public.cockpit_media_tracking_fail(uuid,text,jsonb),
 public.cockpit_media_tracking_idle(boolean,text)
TO service_role;

-- 10. Schedules (Convex crons.ts times; the drain replaces the scheduler's runAfter(0)) --

SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname IN('mahara-clickup-writeback-kpi','mahara-clickup-writeback-log','mahara-clickup-writeback-dosdonts','mahara-tracking-audit');
SELECT cron.schedule('mahara-clickup-writeback-kpi','5 3-18 * * *',$job$ select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/clickup-writeback', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')), body := jsonb_build_object('job','kpi'), timeout_milliseconds := 150000); $job$);
SELECT cron.schedule('mahara-clickup-writeback-log','*/2 * * * *',$job$ select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/clickup-writeback', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')), body := jsonb_build_object('job','log'), timeout_milliseconds := 150000); $job$);
SELECT cron.schedule('mahara-clickup-writeback-dosdonts','35 3-18 * * *',$job$ select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/clickup-writeback', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')), body := jsonb_build_object('job','dosdonts'), timeout_milliseconds := 150000); $job$);
SELECT cron.schedule('mahara-tracking-audit','30 2 * * *',$job$ select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/tracking-audit', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')), body := jsonb_build_object('job','audit'), timeout_milliseconds := 150000); $job$);

NOTIFY pgrst,'reload schema';
COMMIT;
