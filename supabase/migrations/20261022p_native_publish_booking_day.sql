-- The native media publish keeps a booking's day in step with its data
-- (2026-10-22, Creative Triage bldgtotkfmhoxmlzowdx).
--
-- cockpit_media_booking_events has CHECK ((data->>'date')::date = day)
-- (cockpit_media_booking_events_check1). The publish matched an existing booking by
-- its grain (campaign, location, event id, start time), then updated only data, never
-- day. The grain does not hold the date, so the first booking whose date legitimately
-- changed made every publish fail with that check: the cost-per-booking worker release
-- (R4 of docs/client-performance/CPB-AUDIT-20261021.md) dates a rescheduled booking on
-- the day the lead booked the original, so Arcturus l1Ar6ZhyTqKN4baJush0 moves from
-- 28 Sep to 22 Sep, and three canaries on 22 Oct were refused at publish (400, check1
-- in the Postgres log at 14:29:49 UTC). No earlier release changed a booking's date,
-- which is why the gap never showed.
--
-- What changes, and nothing else: the UPDATE of a matched daily-stats or booking row
-- also sets day from the row's own date. For daily statistics the grain holds the
-- date, so day is unchanged there; for bookings it now follows the data, which is what
-- the check requires and what the INSERT branch already does.
--
-- The body is the live one (prosrc md5 0e40f8ab672f3170a40da019e9f75a10) with only
-- that line changed. The file refuses, and changes nothing, if the live body is neither
-- that one nor this file's (465a54ec1bb9cd1facbcc0f0a38192e5), so a change made since is never overwritten.
-- It takes the publish's own advisory lock, so it never lands inside a running publish.
-- Owner and grants are kept by CREATE OR REPLACE (postgres; EXECUTE for service_role).
-- Safe to run twice.
-- Rollback: ~/.cache/mahara-ship/rollback/cockpit_native_media_publish.before-20261022p.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(1835102821, 1);

DO $guard$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.cockpit_native_media_publish(uuid,uuid,jsonb,text,jsonb)'::regprocedure;
  IF v_md5 IS NULL OR v_md5 NOT IN ('0e40f8ab672f3170a40da019e9f75a10', '465a54ec1bb9cd1facbcc0f0a38192e5') THEN
    RAISE EXCEPTION 'cockpit_native_media_publish is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.cockpit_native_media_publish(p_run_id uuid, p_lease_token uuid, p_plan jsonb, p_plan_sha text, p_receipts jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '50s'
AS $function$
DECLARE r public.cockpit_native_media_runs; state jsonb; family text; section jsonb; tab text; rows jsonb; item jsonb; stamp timestamptz; names text[]; protected boolean; v_receipt jsonb; mapping text; expected_count integer; retained jsonb; feed_table text;
BEGIN
 PERFORM pg_advisory_xact_lock(1835102821,1);
 SELECT * INTO r FROM public.cockpit_native_media_runs WHERE run_id=p_run_id FOR UPDATE;
 IF r.run_id IS NULL OR r.lease_token IS DISTINCT FROM p_lease_token THEN RAISE EXCEPTION 'Stale worker fence';END IF;
 IF r.status='published' THEN
  IF r.plan_sha IS DISTINCT FROM p_plan_sha OR r.plan IS DISTINCT FROM p_plan THEN RAISE EXCEPTION 'Changed retry hash or plan refused';END IF;
  RETURN r.receipt;
 END IF;
 PERFORM public.cockpit_native_media_fence(p_run_id,p_lease_token);
 IF p_plan_sha IS NULL OR p_plan_sha !~ '^[0-9a-f]{64}$' OR p_plan->>'producer' IS DISTINCT FROM 'media-core' OR p_plan->'version' IS DISTINCT FROM '1'::jsonb THEN RAISE EXCEPTION 'Invalid native plan';END IF;
 stamp:=(p_plan->>'source_snapshot_at')::timestamptz;
 IF stamp IS NULL OR stamp<r.created_at-interval '1 minute' OR stamp<clock_timestamp()-interval '30 minutes' OR stamp>clock_timestamp()+interval '1 minute' THEN RAISE EXCEPTION 'Stale or future snapshot';END IF;
 LOCK TABLE public.cockpit_media_sources,public.cockpit_media_source_state,public.cockpit_csm_sources,public.cockpit_csm_source_state,
 public.cockpit_creative_sources,public.cockpit_creative_source_state,public.cockpit_campaigns,public.cockpit_ads,
 public.cockpit_media_feed_state,public.cockpit_media_daily_stats,public.cockpit_media_booking_events,public.cockpit_offboard_dismissals,
 public.cockpit_client_profiles,public.cockpit_csm_client_overrides,public.cockpit_native_stills,public.cockpit_native_mirror_owners,public.cockpit_daily_checks,public.cockpit_decisions,public.cockpit_media_call_briefs IN SHARE ROW EXCLUSIVE MODE;
 state:=public.cockpit_native_media_state();
 IF p_plan->'expected' IS DISTINCT FROM state->'expected' THEN RAISE EXCEPTION 'Source revision conflict; calculate again';END IF;
 -- Validate the complete wire contract before any write, including protected histories.
 FOREACH family IN ARRAY ARRAY['media','csm','creative'] LOOP
  mapping:=CASE family WHEN 'media' THEN 'tables' ELSE family END;section:=p_plan->mapping;
  IF jsonb_typeof(section) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Missing % output',family;END IF;
  FOR tab IN SELECT jsonb_object_keys(state->family) UNION SELECT unnest(CASE family WHEN 'media' THEN ARRAY['campaigns','ads','dailyStats','bookingEvents','checkProposals','adStills','winnersArchive'] WHEN 'csm' THEN ARRAY['checks'] ELSE ARRAY[]::text[] END) LOOP
   rows:=section->tab;
   IF jsonb_typeof(rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Missing complete %.% array',family,tab;END IF;
   IF p_plan->'counts'->>(CASE family WHEN 'media' THEN '' ELSE family||'_' END||tab) IS DISTINCT FROM jsonb_array_length(rows)::text THEN RAISE EXCEPTION 'Output count mismatch %.%',family,tab;END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(rows) e WHERE jsonb_typeof(e)<>'object' OR nullif(e->>'_id','') IS NULL) THEN RAISE EXCEPTION 'Missing source identity %.%',family,tab;END IF;
   IF (SELECT count(DISTINCT e->>'_id') FROM jsonb_array_elements(rows) e)<>jsonb_array_length(rows) THEN RAISE EXCEPTION 'Duplicate logical identity %.%',family,tab;END IF;
  END LOOP;
  FOR tab,rows IN SELECT * FROM jsonb_each(section) LOOP
   IF NOT(state->family ? tab) AND NOT(family='media' AND tab=ANY(ARRAY['campaigns','ads','dailyStats','bookingEvents','checkProposals','adStills','winnersArchive'])) AND NOT(family='csm' AND tab='checks') THEN RAISE EXCEPTION 'Unknown %.% output',family,tab;END IF;
  END LOOP;
 END LOOP;
 IF p_plan->'creative'->'winnersArchive' IS DISTINCT FROM p_plan->'tables'->'winnersArchive' THEN RAISE EXCEPTION 'Winner feeds disagree';END IF;
 PERFORM public.cockpit_native_mirrors('cockpit_campaigns',p_plan->'tables'->'campaigns',stamp);
 PERFORM public.cockpit_native_mirrors('cockpit_ads',p_plan->'tables'->'ads',stamp);
 FOREACH family IN ARRAY ARRAY['media','csm','creative'] LOOP
  mapping:=CASE family WHEN 'media' THEN 'tables' ELSE family END;
  FOR tab IN SELECT jsonb_object_keys(state->family) LOOP
   rows:=p_plan->mapping->tab;
   protected:=CASE family WHEN 'media' THEN tab=ANY(ARRAY['clientComments','manualChanges','clickupMembers','clientPrefs','feedback','syncRuns','trackingIssues','campaignChat']) WHEN 'csm' THEN tab=ANY(ARRAY['decisions','reportDocs','outbox','syncRuns']) ELSE tab=ANY(ARRAY['touchLog','blueprints']) END;
   IF protected THEN
    IF rows IS DISTINCT FROM state->family->tab THEN RAISE EXCEPTION 'Protected history %.% must remain unchanged',family,tab;END IF;
    CONTINUE;
   END IF;
   -- Historical roster days, human churn and archived winners cannot disappear or mutate.
   IF (family='csm' AND tab IN('rosterDays','churnEvents')) OR (family='creative' AND tab='winnersArchive') THEN
    FOR item IN SELECT value FROM jsonb_array_elements(state->family->tab) LOOP
     IF family='creative' THEN
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) e WHERE e->>'adId'=item->>'adId') THEN RAISE EXCEPTION 'Winner archive cannot delete history';END IF;
      SELECT e INTO retained FROM jsonb_array_elements(rows) e WHERE e->>'adId'=item->>'adId';
      IF NOT (retained @> (item-ARRAY['spend','leads','cpl','headline','body','cta','transcript','hook','voice','format','adName','client','serviceLine','city','country','language','copyTraits','playType','interests','adsetName','creativeId','accountId','campaignName','lastSeenAt','thumbUrl','stillKey','stillUrl','stillTinyUrl','autoFirstAt','wonFrom','wonTo','stillLive','retiredOn','previewSrc'])) THEN RAISE EXCEPTION 'Winner annotations or immutable identity changed';END IF;
     ELSIF item->>'day'<>p_plan->>'working_day' OR (tab='churnEvents' AND item->>'kind' NOT IN('new','new_inactive','regained','lost','paused','removed')) THEN
      IF NOT rows @> jsonb_build_array(item) THEN RAISE EXCEPTION 'Human or historical CSM row changed';END IF;
     END IF;
    END LOOP;
   END IF;
   IF family='csm' AND tab='appointments' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(state->family->tab) LOOP
     IF item->>'startTime' IS NULL OR (item->>'startTime')::timestamptz<((p_plan->>'working_day')||'T00:00:00+03:00')::timestamptz-interval '14 days'
      OR (item->>'startTime')::timestamptz>=((p_plan->>'working_day')||'T00:00:00+03:00')::timestamptz+interval '42 days' THEN
      IF NOT rows @> jsonb_build_array(item) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) e WHERE e->>'apptId'=item->>'apptId'
       AND (e->>'startTime')::timestamptz>=((p_plan->>'working_day')||'T00:00:00+03:00')::timestamptz-interval '14 days'
       AND (e->>'startTime')::timestamptz<((p_plan->>'working_day')||'T00:00:00+03:00')::timestamptz+interval '42 days') THEN RAISE EXCEPTION 'Appointment history outside refreshed window cannot disappear';END IF;
     END IF;
    END LOOP;
   END IF;
   EXECUTE format('DELETE FROM public.cockpit_%I_sources WHERE table_name=$1 AND NOT(source_id IN(SELECT value->>''_id'' FROM jsonb_array_elements($2)))',family) USING tab,rows;
   FOR item IN SELECT value FROM jsonb_array_elements(rows) LOOP
    SELECT coalesce(array_agg(DISTINCT btrim(n)) FILTER(WHERE nullif(btrim(n),'') IS NOT NULL),'{}') INTO names FROM (
     SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(item->'clientNames')='array' THEN item->'clientNames' ELSE '[]' END) n
     UNION ALL SELECT value #>> '{}' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(item->'clients')='array' THEN item->'clients' ELSE '[]' END) WHERE jsonb_typeof(value)='string'
     UNION ALL SELECT coalesce(item->>'clientName',item->>'client',CASE WHEN tab IN('clients','churnEvents','clientLinks') THEN item->>'name' END)
     UNION ALL SELECT coalesce(nullif(c->>'clientName',''),c->>'accountName') FROM jsonb_array_elements(p_plan->'tables'->'campaigns') c WHERE c->>'campaignName'=item->>'campaignName' OR (nullif(item->>'taskId','') IS NOT NULL AND c->>'taskId'=item->>'taskId')
    ) scope;
    EXECUTE format('INSERT INTO public.cockpit_%I_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(table_name,source_id) DO UPDATE SET client_names=excluded.client_names,data=excluded.data,source_snapshot_at=excluded.source_snapshot_at',family) USING tab,item->>'_id',names,item,stamp;
   END LOOP;
   EXECUTE format('UPDATE public.cockpit_%I_source_state SET ready=true,row_count=$2,source_snapshot_at=$3 WHERE table_name=$1',family) USING tab,jsonb_array_length(rows),stamp;
  END LOOP;
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['dailyStats','bookingEvents'] LOOP
  feed_table:=CASE tab WHEN 'dailyStats' THEN 'cockpit_media_daily_stats' ELSE 'cockpit_media_booking_events' END;
  rows:=p_plan->'tables'->tab;
  IF (SELECT count(DISTINCT public.cockpit_native_grain_key(tab,e)) FROM jsonb_array_elements(rows) e)<>jsonb_array_length(rows) THEN RAISE EXCEPTION 'Duplicate logical statistics grain';END IF;
  IF p_plan->>'window_since' IS NULL OR (p_plan->>'window_since')::date>(p_plan->>'working_day')::date THEN RAISE EXCEPTION 'Statistics coverage window required';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(rows) LOOP
   IF tab='bookingEvents' AND nullif(item->>'eventId','') IS NULL AND (nullif(item->>'contactId','') IS NULL OR nullif(item->>'startTime','') IS NULL) THEN RAISE EXCEPTION 'Booking provider identity missing';END IF;
   IF (item->>'date')::date<(p_plan->>'window_since')::date OR (item->>'date')::date>(p_plan->>'working_day')::date THEN RAISE EXCEPTION 'Statistics row outside complete window';END IF;
   -- Match the real daily grain across the imported/native boundary; never add it twice.
   EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t WHERE public.cockpit_native_grain_key($1,data)=public.cockpit_native_grain_key($1,$2)',feed_table) INTO retained USING tab,item;
   IF jsonb_array_length(retained)>1 THEN RAISE EXCEPTION 'Ambiguous existing statistics grain';END IF;
   IF jsonb_array_length(retained)=1 THEN
    EXECUTE format('UPDATE public.%I SET data=$1,day=($1->>''date'')::date,imported_at=clock_timestamp() WHERE source_deployment=$2 AND source_id=$3',feed_table) USING item,retained->0->>'source_deployment',retained->0->>'source_id';
   ELSE
    EXECUTE format('INSERT INTO public.%I(source_deployment,source_id,campaign_name,day,data) VALUES(''native:media'',$1,$2,$3,$4)',feed_table) USING item->>'_id',item->>'campaignName',(item->>'date')::date,item;
   END IF;
  END LOOP;
  IF tab='bookingEvents' THEN DELETE FROM public.cockpit_media_booking_events b WHERE day BETWEEN (p_plan->>'window_since')::date AND (p_plan->>'working_day')::date AND source_deployment='native:media' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) e WHERE public.cockpit_native_grain_key(tab,b.data)=public.cockpit_native_grain_key(tab,e));END IF;
  EXECUTE format('SELECT count(*) FROM public.%I',feed_table) INTO expected_count;
  UPDATE public.cockpit_media_feed_state SET ready=true,source_rows=expected_count,source_snapshot_at=stamp,updated_at=clock_timestamp() WHERE feed=tab;
 END LOOP;
 FOREACH family IN ARRAY ARRAY['media_buyer','csm'] LOOP
  rows:=CASE family WHEN 'media_buyer' THEN p_plan->'tables'->'checkProposals' ELSE p_plan->'csm'->'checks' END;
  FOR item IN SELECT value FROM jsonb_array_elements(rows) LOOP
   IF nullif(item->>'key','') IS NULL OR nullif(item->>'label','') IS NULL THEN RAISE EXCEPTION 'Checklist proposal identity missing';END IF;
   INSERT INTO public.cockpit_daily_checks(role,owner_app,day,check_key,label,detail,phase,block,display_order,href,done,source_system,source_deployment,source_id,source_snapshot_ts,source_row,changed_by)
   VALUES(family,CASE family WHEN 'media_buyer' THEN 'media-buyer' ELSE 'client-success' END,(p_plan->>'working_day')::date,item->>'key',item->>'label',item->>'detail',item->>'phase',item->>'block',nullif(item->>'order','')::numeric,item->>'href',false,'supabase','native:'||family,item->>'_id',stamp::text,item,'native-feed')
   ON CONFLICT ON CONSTRAINT cockpit_daily_checks_logical_unique DO UPDATE SET
    label=CASE WHEN public.cockpit_daily_checks.label IS NOT DISTINCT FROM public.cockpit_daily_checks.source_row->>'label' THEN excluded.label ELSE public.cockpit_daily_checks.label END,
    detail=CASE WHEN public.cockpit_daily_checks.detail IS NOT DISTINCT FROM public.cockpit_daily_checks.source_row->>'detail' THEN excluded.detail ELSE public.cockpit_daily_checks.detail END,
    source_snapshot_ts=excluded.source_snapshot_ts,source_row=public.cockpit_daily_checks.source_row||excluded.source_row,changed_by='native-feed',source_revision=public.cockpit_daily_checks.source_revision+1,
    source_deleted=CASE WHEN public.cockpit_daily_checks.changed_by='native-feed' AND public.cockpit_daily_checks.source_deployment='native:'||family THEN false ELSE public.cockpit_daily_checks.source_deleted END;
  END LOOP;
  UPDATE public.cockpit_daily_checks SET source_deleted=true,source_revision=source_revision+1,changed_by='native-feed'
  WHERE role=family AND day=(p_plan->>'working_day')::date AND source_deployment='native:'||family AND NOT source_deleted AND NOT(check_key IN(SELECT e->>'key' FROM jsonb_array_elements(rows) e));
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_plan->'tables'->'adStills') LOOP
  IF item->>'status'='captured' THEN RAISE EXCEPTION 'Unstored still cannot be published';END IF;
  INSERT INTO public.cockpit_native_stills(key,data) VALUES(item->>'key',item) ON CONFLICT(key) DO UPDATE SET data=excluded.data,updated_at=clock_timestamp();
 END LOOP;
 PERFORM public.cockpit_native_receipts(p_run_id,p_receipts);
 PERFORM public.cockpit_native_media_fence(p_run_id,p_lease_token);
 v_receipt:=jsonb_build_object('status','published','run_id',p_run_id,'plan_sha',p_plan_sha,'published_at',clock_timestamp(),'counts',p_plan->'counts');
 UPDATE public.cockpit_native_media_runs SET status='published',published_at=(v_receipt->>'published_at')::timestamptz,plan_sha=p_plan_sha,plan=p_plan,receipt=v_receipt,updated_at=clock_timestamp() WHERE run_id=p_run_id;
 RETURN v_receipt;
END $function$;

COMMIT;
