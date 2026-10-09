-- Comment watch and call briefs, native (9 Oct 2026).
--
-- Two Hermes jobs died with the media Convex pause on 7 Oct 2026:
--   commentWatch.scan/apply  every 15 minutes: new comments on each current
--                            client card (Clients - Mahara) were digested by
--                            Hermes (kind comment_digest); the digest showed in
--                            all three cockpits and new rules were added to the
--                            card's Do's & Don'ts field.
--   csmProfiles call briefs  when a client's set of recorded calls changed,
--                            Hermes wrote one brief per call and one overall
--                            paragraph (kind call_brief).
-- This migration runs both on the native Ask AI queue (cockpit_ask_ai_jobs,
-- worker hermes/cockpit-ask-ai/scripts/askai.py).
--
-- Flow
-- 1. Comments: the Edge Function comment-watch (pg_cron, minute 7/22/37/52)
--    reads the cards and their comments through cockpit-csm-api/tools.ts and
--    calls cockpit_comment_watch_record. Every comment is recorded once in
--    cockpit_comment_watch_items (the durable checkpoint; comments imported
--    from Convex in the clientComments feed also count as seen). A comment
--    worth reading becomes one comment_digest job, idempotent per comment id.
-- 2. Calls: cockpit_call_brief_enqueue reads the calls the native CSM feed
--    already published on each client profile (cockpit_csm_sources
--    clientProfiles, collected from Fathom by hermes/cockpit-sync). A set of
--    calls with no done brief becomes one call_brief job, idempotent per
--    client and set (the Convex key: sorted call urls joined by "|").
-- 3. Hermes claims these kinds only through the new four-argument claim
--    (p_kinds). The old three-argument claim now hands out chat only, so a
--    worker that does not know the new kinds never sees them.
-- 4. cockpit_complete_ask_ai_job checks each background answer against its
--    contract before it is accepted.
-- 5. cockpit_ai_watch_tick (pg_cron every 5 minutes, and at the start of
--    every comment-watch run) settles answers into the ledger, queues call
--    briefs, and publishes:
--      * digests into the media feed clientComments (cockpit_media_sources),
--        which the media cockpit reads directly and hermes/cockpit-sync
--        copies into the CSM profiles and creative clients;
--      * briefs into cockpit_media_call_briefs (new rows per set of calls;
--        imported and human-edited done rows are never changed).
--    Both tables are fingerprinted by the native feed publication
--    (cockpit_native_manifest). The tick therefore writes them only while it
--    holds the native claim lock (advisory 1835102821,1, tried, never waited
--    for) and no native feed run holds a live lease. A run that claims later
--    reads the new rows; a tick that finds the lock taken or a live lease
--    publishes nothing and tries again 5 minutes later.
-- 6. The comment-watch run adds a digest's new rules to the card's Do's &
--    Don'ts field. Nothing reaches ClickUp unless the Edge Function secret
--    COMMENT_WATCH_APPLY is exactly "true"; otherwise each planned write
--    (task, old value, new value) is kept on the ledger row and on the run.
--
-- Backpressure
-- - At most 5 background jobs are open at a time (cockpit_ai_watch_room), so
--   the oldest open Ask AI job stays inside one Hermes run and the native
--   monitor's 20-minute queue check holds. Comments that do not fit stay
--   unrecorded and are queued by a later scan; call sets wait for a later tick.
--
-- Differences from Convex, on purpose
-- - A comment posted more than 21 days before it is first seen is recorded
--   as skipped, on every scan (Convex applied this on its first scan only).
--   A card that becomes current again does not get months of history read.
-- - A failed digest stays failed (as in Convex). A failed call brief is
--   tried again only when the set of calls changes.
-- - Rules wait while the field still holds notes the Do's & Don'ts tidy job
--   (clickup-writeback dosdonts) has not moved yet, so no note is lost.
--
-- Operator notes
-- - Health: SELECT public.cockpit_ai_watch_doctor();
-- - Freshness rows in cockpit_sync_state: 'comment-watch', 'ai-watch-tick'.
-- - To deliver planned rules after going live, nothing is needed: rows in
--   rules_state 'dry_run' from the last 7 days are written by the next live run.
--
-- Idempotent. Service role only; no browser door.

BEGIN;

-- 1. Ask AI queue: two background kinds ---------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_cockpit_ask_ai_jobs_system_key
 ON public.cockpit_ask_ai_jobs(kind,idempotency_key) WHERE auth_user_id IS NULL AND idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cockpit_ask_ai_jobs_system_open
 ON public.cockpit_ask_ai_jobs(kind,status,created_at) WHERE auth_user_id IS NULL;

-- A background job has no owner seat; its scope is the source it was made from.
CREATE OR REPLACE FUNCTION public.cockpit_ask_ai_is_system(p_uid uuid,p_kind text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_uid IS NULL AND coalesce(p_kind IN ('comment_digest','call_brief'),false);
$$;

CREATE OR REPLACE FUNCTION public.cockpit_comment_digest_schema()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT '{"type":"object","additionalProperties":false,"required":["summary","nextSteps","clientRequests","risks","forAds","forCreative","dos","donts"],"properties":{"summary":{"type":"string"},"nextSteps":{"type":"array","items":{"type":"string"}},"clientRequests":{"type":"array","items":{"type":"string"}},"risks":{"type":"array","items":{"type":"string"}},"forAds":{"type":"array","items":{"type":"string"}},"forCreative":{"type":"array","items":{"type":"string"}},"dos":{"type":"array","items":{"type":"string"}},"donts":{"type":"array","items":{"type":"string"}}}}'::jsonb;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_call_brief_schema()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT '{"type":"object","additionalProperties":false,"required":["overall","perCall"],"properties":{"overall":{"type":"string"},"perCall":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["url","brief"],"properties":{"url":{"type":"string"},"brief":{"type":"string"}}}}}}'::jsonb;
$$;

-- NULL when the answer keeps its contract, else what is wrong in plain words.
CREATE OR REPLACE FUNCTION public.cockpit_ask_ai_system_result_problem(p_kind text,p_result jsonb,p_context jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE list_key text; item jsonb;
BEGIN
 IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' THEN RETURN 'The answer must be one JSON object.'; END IF;
 IF octet_length(p_result::text)>60000 THEN RETURN 'The answer is longer than 60,000 bytes.'; END IF;
 IF p_kind='comment_digest' THEN
  IF NOT p_result ?& ARRAY['summary','nextSteps','clientRequests','risks','forAds','forCreative','dos','donts']
   OR (SELECT count(*) FROM jsonb_object_keys(p_result))<>8 THEN
   RETURN 'A comment digest has exactly these keys: summary, nextSteps, clientRequests, risks, forAds, forCreative, dos, donts.';
  END IF;
  IF jsonb_typeof(p_result->'summary')<>'string' OR length(p_result->>'summary')>2000 THEN
   RETURN 'summary must be text of at most 2,000 characters.';
  END IF;
  FOREACH list_key IN ARRAY ARRAY['nextSteps','clientRequests','risks','forAds','forCreative','dos','donts'] LOOP
   IF jsonb_typeof(p_result->list_key)<>'array' OR jsonb_array_length(p_result->list_key)>20 THEN
    RETURN list_key||' must be a list of at most 20 lines.';
   END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_result->list_key) e
    WHERE jsonb_typeof(e)<>'string' OR length(btrim(e#>>'{}')) NOT BETWEEN 1 AND 600) THEN
    RETURN list_key||' must hold only lines of 1 to 600 characters.';
   END IF;
  END LOOP;
  RETURN NULL;
 ELSIF p_kind='call_brief' THEN
  IF NOT p_result ?& ARRAY['overall','perCall'] OR (SELECT count(*) FROM jsonb_object_keys(p_result))<>2 THEN
   RETURN 'A call brief has exactly these keys: overall, perCall.';
  END IF;
  IF jsonb_typeof(p_result->'overall')<>'string' OR length(btrim(p_result->>'overall')) NOT BETWEEN 1 AND 4000 THEN
   RETURN 'overall must be text of 1 to 4,000 characters.';
  END IF;
  IF jsonb_typeof(p_result->'perCall')<>'array' OR jsonb_array_length(p_result->'perCall')>20 THEN
   RETURN 'perCall must be a list of at most 20 calls.';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_result->'perCall') LOOP
   IF jsonb_typeof(item)<>'object' OR NOT item ?& ARRAY['url','brief'] OR (SELECT count(*) FROM jsonb_object_keys(item))<>2
    OR jsonb_typeof(item->'url')<>'string' OR jsonb_typeof(item->'brief')<>'string'
    OR length(btrim(item->>'brief')) NOT BETWEEN 1 AND 2000 THEN
    RETURN 'Each perCall item has exactly url and brief, both text, and the brief is 1 to 2,000 characters.';
   END IF;
   IF NOT coalesce(p_context->'urls','[]'::jsonb) ? (item->>'url') THEN
    RETURN 'perCall names a call that is not in this job.';
   END IF;
  END LOOP;
  IF (SELECT count(DISTINCT e->>'url') FROM jsonb_array_elements(p_result->'perCall') e)<>jsonb_array_length(p_result->'perCall') THEN
   RETURN 'perCall names the same call twice.';
  END IF;
  RETURN NULL;
 END IF;
 RETURN 'This kind has no answer contract.';
END $$;

-- The claim, by kind. Chat keeps every 20260927a rule; background jobs keep
-- the context they were queued with and wait behind chat.
CREATE OR REPLACE FUNCTION public.cockpit_claim_ask_ai_jobs(p_worker_id text,p_kinds text[],p_limit integer DEFAULT 5,p_lease_seconds integer DEFAULT 300)
RETURNS TABLE(id uuid,app text,role text,client_name text,kind text,prompt text,context jsonb,attempts integer,max_attempts integer,lease_token uuid,lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz:=clock_timestamp();
BEGIN
 IF nullif(btrim(p_worker_id),'') IS NULL OR length(p_worker_id)>160 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
 OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 3600 THEN RAISE EXCEPTION 'Invalid worker, limit or lease'; END IF;
 IF p_kinds IS NULL OR cardinality(p_kinds) NOT BETWEEN 1 AND 10
  OR EXISTS(SELECT 1 FROM unnest(p_kinds) k WHERE k IS NULL OR k NOT IN ('chat','comment_digest','call_brief')) THEN
  RAISE EXCEPTION 'Invalid job kinds';
 END IF;
 UPDATE public.cockpit_ask_ai_jobs j SET status='failed',error='Owner no longer has access',completed_at=v_now
 WHERE j.status IN ('queued','claimed') AND (j.hidden OR (NOT public.cockpit_ask_ai_is_system(j.auth_user_id,j.kind)
  AND NOT public.cockpit_ask_ai_owner_allowed(j.auth_user_id,j.app,j.client_name)));
 UPDATE public.cockpit_ask_ai_jobs j SET status='failed',error='Maximum attempts exceeded',completed_at=v_now
 WHERE (j.status='queued' OR (j.status='claimed' AND j.lease_expires_at<=v_now)) AND j.attempts>=j.max_attempts;
 RETURN QUERY WITH candidates AS (
 SELECT j.id FROM public.cockpit_ask_ai_jobs j
 WHERE (j.status='queued' OR (j.status='claimed' AND j.lease_expires_at<=v_now)) AND NOT j.hidden AND j.attempts<j.max_attempts
 AND j.kind=ANY(p_kinds)
 AND (public.cockpit_ask_ai_is_system(j.auth_user_id,j.kind)
  OR (j.kind NOT IN ('comment_digest','call_brief') AND public.cockpit_ask_ai_owner_allowed(j.auth_user_id,j.app,j.client_name)))
 ORDER BY (j.auth_user_id IS NULL),j.created_at,j.id LIMIT p_limit FOR UPDATE SKIP LOCKED)
 UPDATE public.cockpit_ask_ai_jobs j SET status='claimed',attempts=j.attempts+1,claimed_at=v_now,claimed_by=p_worker_id,
 lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),lease_token=gen_random_uuid(),
 scope_fingerprint=CASE WHEN public.cockpit_ask_ai_is_system(j.auth_user_id,j.kind) THEN NULL ELSE public.cockpit_ask_ai_scope(j.auth_user_id) END,
 context=CASE WHEN public.cockpit_ask_ai_is_system(j.auth_user_id,j.kind) THEN j.context ELSE public.cockpit_ask_ai_context(j.auth_user_id,j.app,j.client_name) END
 FROM candidates c WHERE j.id=c.id
 RETURNING j.id,j.app,j.role,j.client_name,j.kind,j.prompt,j.context,j.attempts,j.max_attempts,j.lease_token,j.lease_expires_at;
END;
$$;
-- The three-argument claim (every worker installed before this migration) hands out chat only.
CREATE OR REPLACE FUNCTION public.cockpit_claim_ask_ai_jobs(p_worker_id text,p_limit integer DEFAULT 5,p_lease_seconds integer DEFAULT 300)
RETURNS TABLE(id uuid,app text,role text,client_name text,kind text,prompt text,context jsonb,attempts integer,max_attempts integer,lease_token uuid,lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN QUERY SELECT * FROM public.cockpit_claim_ask_ai_jobs(p_worker_id,ARRAY['chat']::text[],p_limit,p_lease_seconds);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_complete_ask_ai_job(p_job_id uuid,p_lease_token uuid,p_result jsonb,p_worker_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer; reply text; v_kind text; v_uid uuid; v_context jsonb; v_found boolean; problem text;
BEGIN
 SELECT j.kind,j.auth_user_id,j.context,true INTO v_kind,v_uid,v_context,v_found FROM public.cockpit_ask_ai_jobs j WHERE j.id=p_job_id;
 IF v_found AND public.cockpit_ask_ai_is_system(v_uid,v_kind) THEN
  problem:=public.cockpit_ask_ai_system_result_problem(v_kind,p_result,v_context);
  IF problem IS NOT NULL THEN RAISE EXCEPTION 'Invalid % answer: %',v_kind,problem; END IF;
  UPDATE public.cockpit_ask_ai_jobs j SET status='completed',result=p_result,error=NULL,completed_at=clock_timestamp()
  WHERE j.id=p_job_id AND j.status='claimed' AND NOT j.hidden AND j.lease_token=p_lease_token
  AND j.claimed_by=p_worker_id AND j.lease_expires_at>clock_timestamp();
  GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
 END IF;
 -- Chat: unchanged from 20260927a.
 reply:=CASE WHEN jsonb_typeof(p_result)='string' THEN p_result#>>'{}'
 WHEN jsonb_typeof(p_result)='object' THEN coalesce(
 CASE WHEN jsonb_typeof(p_result->'reply')='string' THEN p_result->>'reply' END,
 CASE WHEN jsonb_typeof(p_result->'answer')='string' THEN p_result->>'answer' END,
 CASE WHEN jsonb_typeof(p_result->'text')='string' THEN p_result->>'text' END) END;
 IF nullif(btrim(reply),'') IS NULL OR length(reply)>40000 THEN RAISE EXCEPTION 'Nonempty chat answer required'; END IF;
 UPDATE public.cockpit_ask_ai_jobs j SET status='completed',result=p_result,error=NULL,completed_at=clock_timestamp()
 WHERE j.id=p_job_id AND j.status='claimed' AND NOT j.hidden AND j.lease_token=p_lease_token
 AND j.claimed_by=p_worker_id AND j.lease_expires_at>clock_timestamp()
 AND public.cockpit_ask_ai_owner_allowed(j.auth_user_id,j.app,j.client_name)
 AND j.scope_fingerprint=public.cockpit_ask_ai_scope(j.auth_user_id);
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_fail_ask_ai_job(p_job_id uuid,p_lease_token uuid,p_error text,p_worker_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 UPDATE public.cockpit_ask_ai_jobs j SET
 status=CASE WHEN j.attempts<j.max_attempts AND NOT j.hidden AND (public.cockpit_ask_ai_is_system(j.auth_user_id,j.kind)
  OR public.cockpit_ask_ai_owner_allowed(j.auth_user_id,j.app,j.client_name)) THEN 'queued' ELSE 'failed' END,
 error=left(coalesce(nullif(btrim(p_error),''),'Worker could not answer'),1000),
 completed_at=CASE WHEN j.attempts>=j.max_attempts THEN clock_timestamp() ELSE NULL END,
 lease_token=NULL,lease_expires_at=NULL,claimed_by=NULL
 WHERE j.id=p_job_id AND j.status='claimed' AND j.lease_token=p_lease_token AND j.claimed_by=p_worker_id AND j.lease_expires_at>clock_timestamp();
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END;
$$;

-- 2. The comment ledger ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cockpit_comment_watch_items(
 comment_id text PRIMARY KEY CHECK(comment_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 task_id text NOT NULL CHECK(task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
 client_name text NOT NULL CHECK(length(btrim(client_name)) BETWEEN 1 AND 200),
 posted_at timestamptz NOT NULL,
 author text CHECK(author IS NULL OR length(author)<=200),
 kind text NOT NULL CHECK(kind IN ('call','kickoff','brief','note','skip')),
 status text NOT NULL CHECK(status IN ('skipped','queued','done','failed')),
 skip_reason text,
 job_id uuid UNIQUE REFERENCES public.cockpit_ask_ai_jobs(id),
 digest jsonb CHECK(digest IS NULL OR jsonb_typeof(digest)='object'),
 rules_state text CHECK(rules_state IN ('dry_run','written','unchanged','failed')),
 rules jsonb,
 rules_added integer CHECK(rules_added IS NULL OR rules_added>=0),
 rules_at timestamptz,
 published_status text,
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'queued' OR job_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS cockpit_comment_watch_items_queued ON public.cockpit_comment_watch_items(job_id) WHERE status='queued';
CREATE INDEX IF NOT EXISTS cockpit_comment_watch_items_rules ON public.cockpit_comment_watch_items(posted_at) WHERE status='done' AND (rules_state IS NULL OR rules_state='dry_run');
CREATE INDEX IF NOT EXISTS cockpit_comment_watch_items_unpublished ON public.cockpit_comment_watch_items(posted_at) WHERE status IN ('done','failed') AND kind<>'skip';

CREATE TABLE IF NOT EXISTS public.cockpit_comment_watch_runs(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 mode text NOT NULL CHECK(mode IN ('dry_run','apply','apply_limited')),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 ok boolean,
 counts jsonb NOT NULL DEFAULT '{}'::jsonb,
 planned jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(planned)='array'),
 note text
);
CREATE INDEX IF NOT EXISTS cockpit_comment_watch_runs_started ON public.cockpit_comment_watch_runs(started_at DESC);

CREATE OR REPLACE FUNCTION public.cockpit_comment_watch_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN NEW.updated_at:=clock_timestamp(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS cockpit_comment_watch_items_touch ON public.cockpit_comment_watch_items;
CREATE TRIGGER cockpit_comment_watch_items_touch BEFORE UPDATE ON public.cockpit_comment_watch_items
 FOR EACH ROW EXECUTE FUNCTION public.cockpit_comment_watch_touch();

-- Every write leaves an audit row; an update that changes nothing does not.
CREATE OR REPLACE FUNCTION public.cockpit_comment_watch_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)-'updated_at') IS NOT DISTINCT FROM (to_jsonb(NEW)-'updated_at') THEN RETURN NEW; END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
 VALUES(lower(TG_OP),TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'comment_id',to_jsonb(NEW)->>'id'),'comment-watch','media-buyer','supabase',
  CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cockpit_comment_watch_items_audit ON public.cockpit_comment_watch_items;
CREATE TRIGGER cockpit_comment_watch_items_audit AFTER INSERT OR UPDATE ON public.cockpit_comment_watch_items
 FOR EACH ROW EXECUTE FUNCTION public.cockpit_comment_watch_audit();
DROP TRIGGER IF EXISTS cockpit_comment_watch_runs_audit ON public.cockpit_comment_watch_runs;
CREATE TRIGGER cockpit_comment_watch_runs_audit AFTER INSERT OR UPDATE OF finished_at ON public.cockpit_comment_watch_runs
 FOR EACH ROW EXECUTE FUNCTION public.cockpit_comment_watch_audit();

ALTER TABLE public.cockpit_comment_watch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_comment_watch_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_comment_watch_items,public.cockpit_comment_watch_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_comment_watch_items,public.cockpit_comment_watch_runs TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_sync_state TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ai_watch_state(p_key text,p_ok boolean,p_note text,p_rows integer DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.cockpit_sync_state AS s(key,last_run_at,last_ok_at,ok,note,rows_seen,updated_at)
 VALUES(p_key,now(),CASE WHEN p_ok THEN now() END,p_ok,left(p_note,500),p_rows,now())
 ON CONFLICT(key) DO UPDATE SET last_run_at=now(),last_ok_at=CASE WHEN p_ok THEN now() ELSE s.last_ok_at END,
  ok=p_ok,note=left(p_note,500),rows_seen=p_rows,updated_at=now();
$$;

-- How many more background jobs may be queued now. The native monitor
-- (20261004z) alerts when the oldest open Ask AI job is 20 minutes old, and
-- Hermes claims 5 jobs every 5 minutes; at most 5 open background jobs keeps
-- the queue inside one worker run. What does not fit waits at its source:
-- comments stay unrecorded until the next scan, call sets until the next tick.
CREATE OR REPLACE FUNCTION public.cockpit_ai_watch_room() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT greatest(0,5-count(*))::integer FROM public.cockpit_ask_ai_jobs j
 WHERE j.auth_user_id IS NULL AND j.kind IN ('comment_digest','call_brief') AND j.status IN ('queued','claimed') AND NOT j.hidden;
$$;

-- 3. Comment watch: seen, record, rules, runs -----------------------------------

-- Which of these ClickUp comment ids are already known (ledger, or imported from Convex).
CREATE OR REPLACE FUNCTION public.cockpit_comment_watch_seen(p_comment_ids text[]) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE known text[];
BEGIN
 IF p_comment_ids IS NULL OR cardinality(p_comment_ids)>5000 THEN RAISE EXCEPTION 'Send at most 5000 comment ids'; END IF;
 WITH ids AS (SELECT DISTINCT x AS id FROM unnest(p_comment_ids) x WHERE x IS NOT NULL),
 imported AS (SELECT s.data->>'commentId' AS id FROM public.cockpit_media_sources s WHERE s.table_name='clientComments')
 SELECT coalesce(array_agg(i.id ORDER BY i.id),'{}') INTO known FROM ids i
 WHERE EXISTS(SELECT 1 FROM public.cockpit_comment_watch_items w WHERE w.comment_id=i.id)
  OR i.id IN (SELECT m.id FROM imported m WHERE m.id IS NOT NULL);
 RETURN known;
END $$;

-- Record new comments once; queue a digest for each one worth reading.
CREATE OR REPLACE FUNCTION public.cockpit_comment_watch_record(p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; v_id text; v_task text; v_client text; v_at timestamptz; v_kind text; v_status text; v_reason text; v_job uuid;
 recorded integer:=0; queued integer:=0; skipped integer:=0; known integer:=0; deferred integer:=0; room integer;
BEGIN
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 200 THEN
  RAISE EXCEPTION 'Send between 1 and 200 comments';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_comment_watch_record',0));
 room:=public.cockpit_ai_watch_room();
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  v_id:=item->>'commentId'; v_task:=item->>'taskId'; v_client:=btrim(item->>'clientName'); v_kind:=item->>'kind';
  IF jsonb_typeof(item)<>'object' OR coalesce(v_id,'')!~'^[A-Za-z0-9_-]{1,64}$' OR coalesce(v_task,'')!~'^[A-Za-z0-9_-]{1,40}$'
   OR coalesce(v_client,'')='' OR length(v_client)>200 OR coalesce(v_kind,'') NOT IN ('call','kickoff','brief','note','skip')
   OR coalesce(item->>'at','')!~'^[0-9]{10,14}$' THEN
   RAISE EXCEPTION 'Every comment needs an id, a card id, a client name, a kind and a time in milliseconds';
  END IF;
  IF EXISTS(SELECT 1 FROM public.cockpit_comment_watch_items w WHERE w.comment_id=v_id)
   OR EXISTS(SELECT 1 FROM public.cockpit_media_sources s WHERE s.table_name='clientComments' AND s.data->>'commentId'=v_id) THEN
   known:=known+1; CONTINUE;
  END IF;
  v_at:=to_timestamp((item->>'at')::numeric/1000);
  v_reason:=NULL; v_job:=NULL;
  IF v_kind='skip' THEN
   v_status:='skipped'; v_reason:='Not a client update: a system or cockpit note, a sales handoff, a research report or under 40 characters.';
  ELSIF v_at<clock_timestamp()-interval '21 days' THEN
   v_status:='skipped'; v_reason:='Posted more than 21 days before the comment watch first saw it.';
  ELSIF v_at>clock_timestamp()+interval '1 day' THEN
   v_status:='skipped'; v_reason:='ClickUp gave this comment a time in the future.';
  ELSIF nullif(btrim(item->>'prompt'),'') IS NULL OR length(item->>'prompt')>30000 THEN
   RAISE EXCEPTION 'A comment to digest needs its prompt (at most 30000 characters)';
  ELSE
   v_status:='queued';
  END IF;
  IF v_status='queued' AND queued>=room THEN
   -- Not recorded: the next scan finds it unseen and queues it when there is room.
   deferred:=deferred+1; CONTINUE;
  END IF;
  IF v_status='queued' THEN
   INSERT INTO public.cockpit_ask_ai_jobs(auth_user_id,actor_email,app,role,client_name,kind,prompt,context,idempotency_key,metadata)
   VALUES(NULL,'hermes:comment-watch','media-buyer','media_buyer',v_client,'comment_digest',item->>'prompt',
    jsonb_build_object('source','comment-watch','commentId',v_id,'taskId',v_task,'clientName',v_client,'commentKind',v_kind,
     'postedAt',to_jsonb(v_at),'read_only',true,'schema',public.cockpit_comment_digest_schema(),
     'instruction','Use only the comment in the prompt. Return one JSON object with exactly the keys in the schema. Do not act outside the cockpit.'),
    'comment:'||v_id,jsonb_build_object('producer','comment-watch'))
   ON CONFLICT (kind,idempotency_key) WHERE auth_user_id IS NULL AND idempotency_key IS NOT NULL DO NOTHING
   RETURNING id INTO v_job;
   IF v_job IS NULL THEN
    SELECT j.id INTO v_job FROM public.cockpit_ask_ai_jobs j WHERE j.auth_user_id IS NULL AND j.kind='comment_digest' AND j.idempotency_key='comment:'||v_id;
   END IF;
   queued:=queued+1;
  ELSE
   skipped:=skipped+1;
  END IF;
  INSERT INTO public.cockpit_comment_watch_items(comment_id,task_id,client_name,posted_at,author,kind,status,skip_reason,job_id)
  VALUES(v_id,v_task,v_client,v_at,left(nullif(btrim(item->>'by'),''),200),v_kind,v_status,v_reason,v_job);
  recorded:=recorded+1;
 END LOOP;
 RETURN jsonb_build_object('recorded',recorded,'queued',queued,'skipped',skipped,'known',known,'deferred',deferred);
END $$;

-- Done digests whose new rules have not reached the card yet. Planned (dry
-- run) rows come back only for a live run, and only from the last 7 days.
CREATE OR REPLACE FUNCTION public.cockpit_comment_watch_rules_pending(p_include_planned boolean DEFAULT false,p_limit integer DEFAULT 15) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE out jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Limit must be 1 to 100'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('commentId',w.comment_id,'taskId',w.task_id,'clientName',w.client_name,'kind',w.kind,
   'at',floor(extract(epoch FROM w.posted_at)*1000)::bigint,'dos',coalesce(w.digest->'dos','[]'::jsonb),'donts',coalesce(w.digest->'donts','[]'::jsonb),
   'state',w.rules_state) ORDER BY w.posted_at,w.comment_id),'[]'::jsonb)
 INTO out FROM (
  SELECT * FROM public.cockpit_comment_watch_items i
  WHERE i.status='done' AND i.created_at>now()-interval '7 days'
   AND (i.rules_state IS NULL OR (p_include_planned AND i.rules_state='dry_run'))
  ORDER BY i.posted_at,i.comment_id LIMIT p_limit) w;
 RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_comment_watch_rules_result(p_comment_id text,p_state text,p_rules jsonb,p_rules_added integer DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 IF p_state IS NULL OR p_state NOT IN ('dry_run','written','unchanged','failed') THEN RAISE EXCEPTION 'Unknown rules state'; END IF;
 IF p_rules IS NOT NULL AND (jsonb_typeof(p_rules)<>'object' OR octet_length(p_rules::text)>40000) THEN RAISE EXCEPTION 'Rules record must be one small object'; END IF;
 UPDATE public.cockpit_comment_watch_items w SET rules_state=p_state,rules=p_rules,
  rules_added=CASE p_state WHEN 'written' THEN greatest(coalesce(p_rules_added,0),0) WHEN 'unchanged' THEN 0 END,rules_at=now()
 WHERE w.comment_id=p_comment_id AND w.status='done' AND (w.rules_state IS NULL OR w.rules_state='dry_run');
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;

-- One run at a time; a run open for over 5 minutes died (the function stops at 150 s).
CREATE OR REPLACE FUNCTION public.cockpit_comment_watch_begin(p_mode text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE run_id bigint;
BEGIN
 IF p_mode IS NULL OR p_mode NOT IN ('dry_run','apply','apply_limited') THEN RAISE EXCEPTION 'Unknown mode'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_comment_watch_begin',0));
 UPDATE public.cockpit_comment_watch_runs SET finished_at=now(),ok=false,note='The comment watch stopped before it finished.'
 WHERE finished_at IS NULL AND started_at<now()-interval '5 minutes';
 IF EXISTS(SELECT 1 FROM public.cockpit_comment_watch_runs WHERE finished_at IS NULL) THEN RETURN jsonb_build_object('busy',true); END IF;
 INSERT INTO public.cockpit_comment_watch_runs(mode) VALUES(p_mode) RETURNING id INTO run_id;
 RETURN jsonb_build_object('busy',false,'run',run_id);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_comment_watch_finish(p_run bigint,p_ok boolean,p_note text,p_counts jsonb DEFAULT '{}'::jsonb,p_planned jsonb DEFAULT '[]'::jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.cockpit_comment_watch_runs SET finished_at=now(),ok=coalesce(p_ok,false),note=left(p_note,1000),
  counts=CASE WHEN jsonb_typeof(p_counts)='object' THEN p_counts ELSE '{}'::jsonb END,
  planned=CASE WHEN jsonb_typeof(p_planned)='array' AND octet_length(p_planned::text)<=500000 THEN p_planned ELSE '[]'::jsonb END
 WHERE id=p_run AND finished_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'The comment watch run is not open'; END IF;
 PERFORM public.cockpit_ai_watch_state('comment-watch',coalesce(p_ok,false),p_note,
  CASE WHEN jsonb_typeof(p_counts->'comments')='number' THEN (p_counts->>'comments')::integer END);
END $$;

-- 4. Call briefs from the published client profiles ------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_call_brief_enqueue(p_limit integer DEFAULT 10,p_dry_run boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE st public.cockpit_csm_source_state; r record; v_key text; v_job uuid; v_calls jsonb; v_urls jsonb; v_prompt text;
 queued integer:=0; waiting integer:=0; superseded integer:=0; planned jsonb:='[]'::jsonb; v_idem text; n integer; v_limit integer;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Limit must be 1 to 100'; END IF;
 SELECT * INTO st FROM public.cockpit_csm_source_state WHERE table_name='clientProfiles';
 IF st.ready IS NOT TRUE OR st.source_snapshot_at IS NULL THEN
  RETURN jsonb_build_object('ok',false,'queued',0,'note','The client profiles are not published, so no call briefs were queued. They queue once the CSM feed publishes.');
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_call_brief_enqueue',0));
 v_limit:=CASE WHEN p_dry_run THEN p_limit ELSE least(p_limit,public.cockpit_ai_watch_room()) END;
 FOR r IN
  SELECT k.* FROM (
   SELECT s.data->>'clientName' AS client_name,s.data->>'taskId' AS task_id,s.data->'calls' AS calls,
    (SELECT string_agg(coalesce(c->>'url',c->>'title',''),'|' ORDER BY coalesce(c->>'url',c->>'title','') COLLATE "C")
     FROM jsonb_array_elements(s.data->'calls') c) AS call_key
   FROM public.cockpit_csm_sources s
   WHERE s.table_name='clientProfiles' AND s.source_snapshot_at=st.source_snapshot_at
    AND nullif(btrim(s.data->>'clientName'),'') IS NOT NULL
    AND jsonb_typeof(s.data->'calls')='array' AND jsonb_array_length(s.data->'calls')>0) k
  WHERE NOT EXISTS(SELECT 1 FROM public.cockpit_media_call_briefs b WHERE b.client_name=k.client_name AND b.key=k.call_key AND b.status='done')
   AND NOT EXISTS(SELECT 1 FROM public.cockpit_ask_ai_jobs j WHERE j.auth_user_id IS NULL AND j.kind='call_brief'
    AND j.idempotency_key='brief:'||md5(k.client_name||chr(31)||k.call_key))
  ORDER BY k.client_name
 LOOP
  IF queued+jsonb_array_length(planned)>=v_limit THEN waiting:=waiting+1; CONTINUE; END IF;
  v_key:=r.call_key; v_idem:='brief:'||md5(r.client_name||chr(31)||v_key);
  SELECT jsonb_agg(jsonb_build_object('url',c->'url','title',c->'title','date',c->'at','kind',c->'kind','summary',left(coalesce(c->>'summary',''),2500)) ORDER BY o),
   coalesce(jsonb_agg(c->>'url' ORDER BY o) FILTER (WHERE jsonb_typeof(c->'url')='string'),'[]'::jsonb)
  INTO v_calls,v_urls FROM jsonb_array_elements(r.calls) WITH ORDINALITY AS x(c,o);
  IF p_dry_run THEN
   planned:=planned||jsonb_build_array(jsonb_build_object('clientName',r.client_name,'calls',jsonb_array_length(r.calls),'key',v_key));
   CONTINUE;
  END IF;
  -- The Convex prompt (csmProfiles.ts briefPrompt), word for word.
  v_prompt:=format($p$You write short call briefs for Mahara Media's client success manager.

Client: %s

Below are recorded calls this client appears in (some are team meetings where the client came up, some are calls with the client). For each call, write ONE short paragraph (2 to 4 sentences) about what was said regarding this client only: decisions, blockers, promises, numbers, next steps. Ignore everything about other clients. No timestamps, no headings, no bullet lists inside the brief. Then write "overall": one paragraph (3 to 5 sentences) that tells the CSM where things stand with this client across all these calls, most recent first in importance.

Rules: use only what the summaries say, invent nothing, no em dashes, plain direct English, name people by first name.

Calls (JSON):
%s

Return JSON: {"overall": "...", "perCall": [{"url": "<call url>", "brief": "..."}]}$p$,r.client_name,v_calls::text);
  v_job:=NULL;
  INSERT INTO public.cockpit_ask_ai_jobs(auth_user_id,actor_email,app,role,client_name,kind,prompt,context,idempotency_key,metadata)
  VALUES(NULL,'hermes:call-briefs','client-success','csm',r.client_name,'call_brief',v_prompt,
   jsonb_build_object('source','call-briefs','clientName',r.client_name,'taskId',r.task_id,'key',v_key,'urls',v_urls,'read_only',true,
    'schema',public.cockpit_call_brief_schema(),
    'instruction','Use only the call summaries in the prompt. Return one JSON object with exactly the keys in the schema; perCall urls must be urls from the prompt.'),
   v_idem,jsonb_build_object('producer','call-briefs'))
  ON CONFLICT (kind,idempotency_key) WHERE auth_user_id IS NULL AND idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_job;
  IF v_job IS NULL THEN CONTINUE; END IF;
  queued:=queued+1;
  -- An older set for the same client that nobody has started is withdrawn
  -- (hidden, so it is not counted as a failure).
  UPDATE public.cockpit_ask_ai_jobs j SET status='failed',hidden=true,error='A newer set of calls replaced this one.',completed_at=clock_timestamp()
  WHERE j.auth_user_id IS NULL AND j.kind='call_brief' AND j.status='queued' AND j.id<>v_job AND j.context->>'clientName'=r.client_name;
  GET DIAGNOSTICS n=ROW_COUNT; superseded:=superseded+n;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'queued',queued,'waiting',waiting,'superseded',superseded,'room',public.cockpit_ai_watch_room(),
  'planned',CASE WHEN p_dry_run THEN planned END,'dryRun',p_dry_run);
END $$;

-- 5. The tick: settle, queue briefs, publish ------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_ai_watch_tick(p_brief_limit integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE settled integer:=0; failed integer:=0; comments_published integer:=0; briefs_published integer:=0; briefs_kept integer:=0;
 briefs jsonb; busy boolean; st public.cockpit_media_source_state; r record; n integer; notes text[]:='{}'; ok boolean:=true; result jsonb;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('cockpit_ai_watch_tick',0)) THEN
  RETURN jsonb_build_object('ok',true,'skipped','busy','note','Another tick is running.');
 END IF;
 -- a) Answers into the ledger. A digest with no new rules needs no card write.
 WITH done AS (
  UPDATE public.cockpit_comment_watch_items w SET status='done',digest=j.result,
   rules_state=CASE WHEN jsonb_array_length(coalesce(j.result->'dos','[]'::jsonb))+jsonb_array_length(coalesce(j.result->'donts','[]'::jsonb))=0 THEN 'unchanged' END,
   rules_added=CASE WHEN jsonb_array_length(coalesce(j.result->'dos','[]'::jsonb))+jsonb_array_length(coalesce(j.result->'donts','[]'::jsonb))=0 THEN 0 END,
   rules_at=CASE WHEN jsonb_array_length(coalesce(j.result->'dos','[]'::jsonb))+jsonb_array_length(coalesce(j.result->'donts','[]'::jsonb))=0 THEN now() END
  FROM public.cockpit_ask_ai_jobs j WHERE w.status='queued' AND j.id=w.job_id AND j.status='completed' AND jsonb_typeof(j.result)='object'
  RETURNING 1)
 SELECT count(*) INTO settled FROM done;
 WITH gone AS (
  UPDATE public.cockpit_comment_watch_items w SET status='failed'
  FROM public.cockpit_ask_ai_jobs j WHERE w.status='queued' AND j.id=w.job_id AND j.status='failed'
  RETURNING 1)
 SELECT count(*) INTO failed FROM gone;
 -- b) New sets of calls become call_brief jobs.
 briefs:=public.cockpit_call_brief_enqueue(p_brief_limit,false);
 IF briefs->>'ok'<>'true' THEN ok:=false; notes:=notes||(briefs->>'note'); END IF;
 -- c) Publish only while no native feed run holds its lease (see the header).
 -- The claim lock is tried, never waited for: a feed run claiming, fencing or
 -- publishing right now counts as busy, and the next tick tries again.
 busy:=NOT pg_try_advisory_xact_lock(1835102821,1)
  OR EXISTS(SELECT 1 FROM public.cockpit_native_media_runs WHERE status='claimed' AND lease_expires_at>clock_timestamp());
 IF busy THEN
  notes:=notes||'A native feed run is in progress, so digests and briefs publish on the next tick.'::text;
 ELSE
  SELECT * INTO st FROM public.cockpit_media_source_state WHERE table_name='clientComments' FOR UPDATE;
  IF st.ready IS NOT TRUE OR st.source_snapshot_at IS NULL OR st.row_count IS NULL THEN
   ok:=false; notes:=notes||'The clientComments feed is not imported, so digests are kept in the ledger and not shown yet.'::text;
  ELSE
   INSERT INTO public.cockpit_media_sources AS s(table_name,source_id,client_names,data,source_snapshot_at)
   SELECT 'clientComments','clickup:'||w.comment_id,ARRAY[w.client_name],
    jsonb_strip_nulls(jsonb_build_object('_id','clickup:'||w.comment_id,'taskId',w.task_id,'clientName',w.client_name,'commentId',w.comment_id,
     'at',floor(extract(epoch FROM w.posted_at)*1000)::bigint,'by',w.author,'kind',w.kind,'status',w.status,'jobId',w.job_id::text,
     'digest',w.digest,'syncedAt',floor(extract(epoch FROM clock_timestamp())*1000)::bigint,'origin','native-comment-watch')),
    st.source_snapshot_at
   FROM (SELECT * FROM public.cockpit_comment_watch_items i WHERE i.status IN ('done','failed') AND i.kind<>'skip'
     AND i.published_status IS DISTINCT FROM i.status ORDER BY i.posted_at,i.comment_id LIMIT 200) w
   ON CONFLICT(table_name,source_id) DO UPDATE SET data=excluded.data,client_names=excluded.client_names;
   GET DIAGNOSTICS comments_published=ROW_COUNT;
   IF comments_published>0 THEN
    UPDATE public.cockpit_comment_watch_items w SET published_status=w.status,published_at=now()
    WHERE w.status IN ('done','failed') AND w.kind<>'skip' AND w.published_status IS DISTINCT FROM w.status
     AND EXISTS(SELECT 1 FROM public.cockpit_media_sources s WHERE s.table_name='clientComments' AND s.source_id='clickup:'||w.comment_id AND s.data->>'status'=w.status);
    UPDATE public.cockpit_media_source_state f SET row_count=(SELECT count(*) FROM public.cockpit_media_sources s WHERE s.table_name='clientComments')
    WHERE f.table_name='clientComments';
   END IF;
  END IF;
  -- Imported and human-edited done rows are never changed; a queued or failed
  -- row with the same set of calls becomes done.
  FOR r IN SELECT j.* FROM public.cockpit_ask_ai_jobs j WHERE j.auth_user_id IS NULL AND j.kind='call_brief' AND j.status='completed'
   AND NOT (j.metadata ? 'published_at') AND jsonb_typeof(j.result)='object' ORDER BY j.completed_at,j.id LIMIT 50 LOOP
   INSERT INTO public.cockpit_media_call_briefs AS b(client_name,key,job_id,status,overall,per_call,at)
   VALUES(r.context->>'clientName',r.context->>'key',r.id::text,'done',btrim(r.result->>'overall'),r.result->'perCall',r.created_at)
   ON CONFLICT(client_name,key) DO UPDATE SET job_id=excluded.job_id,status='done',overall=excluded.overall,per_call=excluded.per_call,at=excluded.at,updated_at=now()
   WHERE b.status<>'done';
   GET DIAGNOSTICS n=ROW_COUNT;
   IF n=1 THEN briefs_published:=briefs_published+1; ELSE briefs_kept:=briefs_kept+1; END IF;
   UPDATE public.cockpit_ask_ai_jobs SET metadata=metadata||jsonb_build_object('published_at',now(),'published',n=1) WHERE id=r.id;
  END LOOP;
 END IF;
 result:=jsonb_build_object('ok',ok,'settled',settled,'failed',failed,'busy',busy,'commentsPublished',comments_published,
  'briefsPublished',briefs_published,'briefsKept',briefs_kept,'briefsQueued',coalesce((briefs->>'queued')::integer,0),
  'briefsWaiting',coalesce((briefs->>'waiting')::integer,0));
 PERFORM public.cockpit_ai_watch_state('ai-watch-tick',ok,
  format('%s digests settled, %s failed; %s digests and %s call briefs published; %s call briefs queued.%s',
   settled,failed,comments_published,briefs_published,coalesce(briefs->>'queued','0'),
   CASE WHEN cardinality(notes)>0 THEN ' '||array_to_string(notes,' ') ELSE '' END),
  comments_published+briefs_published);
 RETURN result||jsonb_build_object('note',array_to_string(notes,' '));
END $$;

-- 6. Doctor: counts and freshness, no writes -------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_ai_watch_doctor() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'comments',(SELECT jsonb_build_object(
    'skipped',count(*) FILTER (WHERE status='skipped'),'queued',count(*) FILTER (WHERE status='queued'),
    'done',count(*) FILTER (WHERE status='done'),'failed',count(*) FILTER (WHERE status='failed'),
    'queuedOverOneHour',count(*) FILTER (WHERE status='queued' AND created_at<now()-interval '1 hour'),
    'rulesPending',count(*) FILTER (WHERE status='done' AND rules_state IS NULL),
    'rulesPlanned',count(*) FILTER (WHERE rules_state='dry_run'),'rulesWritten',count(*) FILTER (WHERE rules_state='written'),
    'unpublished',count(*) FILTER (WHERE status IN ('done','failed') AND kind<>'skip' AND published_status IS DISTINCT FROM status))
   FROM public.cockpit_comment_watch_items),
  'jobs',(SELECT coalesce(jsonb_object_agg(k,v),'{}'::jsonb) FROM (SELECT kind AS k,jsonb_build_object(
    'queued',count(*) FILTER (WHERE status='queued'),'claimed',count(*) FILTER (WHERE status='claimed'),
    'completed',count(*) FILTER (WHERE status='completed'),'failed',count(*) FILTER (WHERE status='failed'),
    'oldestQueuedMinutes',floor(extract(epoch FROM now()-min(created_at) FILTER (WHERE status='queued'))/60),
    'completedUnpublished',count(*) FILTER (WHERE status='completed' AND kind='call_brief' AND NOT (metadata ? 'published_at'))) AS v
   FROM public.cockpit_ask_ai_jobs WHERE auth_user_id IS NULL AND kind IN ('comment_digest','call_brief') GROUP BY kind) q),
  'sources',jsonb_build_object(
    'clientComments',(SELECT jsonb_build_object('ready',ready,'rows',row_count,'at',source_snapshot_at) FROM public.cockpit_media_source_state WHERE table_name='clientComments'),
    'clientProfiles',(SELECT jsonb_build_object('ready',ready,'rows',row_count,'at',source_snapshot_at) FROM public.cockpit_csm_source_state WHERE table_name='clientProfiles')),
  'room',public.cockpit_ai_watch_room(),
  'nativeFeedLeaseLive',EXISTS(SELECT 1 FROM public.cockpit_native_media_runs WHERE status='claimed' AND lease_expires_at>clock_timestamp()),
  'state',(SELECT coalesce(jsonb_object_agg(key,jsonb_build_object('ok',ok,'lastRunAt',last_run_at,'lastOkAt',last_ok_at,'note',note)),'{}'::jsonb)
   FROM public.cockpit_sync_state WHERE key IN ('comment-watch','ai-watch-tick')),
  'lastRun',(SELECT to_jsonb(r)-'planned' FROM public.cockpit_comment_watch_runs r ORDER BY started_at DESC,id DESC LIMIT 1));
$$;

-- 7. Grants -------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.cockpit_ask_ai_is_system(uuid,text),public.cockpit_comment_digest_schema(),public.cockpit_call_brief_schema(),
 public.cockpit_ask_ai_system_result_problem(text,jsonb,jsonb),public.cockpit_comment_watch_touch(),public.cockpit_comment_watch_audit(),
 public.cockpit_ai_watch_state(text,boolean,text,integer),public.cockpit_ai_watch_room()
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_claim_ask_ai_jobs(text,text[],integer,integer),public.cockpit_claim_ask_ai_jobs(text,integer,integer),
 public.cockpit_complete_ask_ai_job(uuid,uuid,jsonb,text),public.cockpit_fail_ask_ai_job(uuid,uuid,text,text),
 public.cockpit_comment_watch_seen(text[]),public.cockpit_comment_watch_record(jsonb),
 public.cockpit_comment_watch_rules_pending(boolean,integer),public.cockpit_comment_watch_rules_result(text,text,jsonb,integer),
 public.cockpit_comment_watch_begin(text),public.cockpit_comment_watch_finish(bigint,boolean,text,jsonb,jsonb),
 public.cockpit_call_brief_enqueue(integer,boolean),public.cockpit_ai_watch_tick(integer),public.cockpit_ai_watch_doctor()
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_claim_ask_ai_jobs(text,text[],integer,integer),public.cockpit_claim_ask_ai_jobs(text,integer,integer),
 public.cockpit_complete_ask_ai_job(uuid,uuid,jsonb,text),public.cockpit_fail_ask_ai_job(uuid,uuid,text,text),
 public.cockpit_comment_watch_seen(text[]),public.cockpit_comment_watch_record(jsonb),
 public.cockpit_comment_watch_rules_pending(boolean,integer),public.cockpit_comment_watch_rules_result(text,text,jsonb,integer),
 public.cockpit_comment_watch_begin(text),public.cockpit_comment_watch_finish(bigint,boolean,text,jsonb,jsonb),
 public.cockpit_call_brief_enqueue(integer,boolean),public.cockpit_ai_watch_tick(integer),public.cockpit_ai_watch_doctor()
 TO service_role;

-- 8. Schedules ----------------------------------------------------------------------
-- cron:begin
SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname IN ('mahara-ai-watch-tick','mahara-comment-watch');
SELECT cron.schedule('mahara-ai-watch-tick','*/5 * * * *',$job$ select public.cockpit_ai_watch_tick(); $job$);
SELECT cron.schedule('mahara-comment-watch','7-59/15 * * * *',$job$ select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/comment-watch', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')), body := '{}'::jsonb, timeout_milliseconds := 150000); $job$);
-- cron:end

NOTIFY pgrst,'reload schema';
COMMIT;
