BEGIN;

-- Record when the complete provider scan began. Completion time alone is not
-- coverage proof: a scan may have run for hours before its last page finished.
ALTER TABLE mahara_reporting.sync_jobs ADD COLUMN source_complete_at timestamptz;
DO $patch$
DECLARE old text; patched text;
BEGIN
 old:=pg_get_functiondef('public.mahara_reporting_sync(text,jsonb,text)'::regprocedure);
 patched:=replace(old,
  'last_complete=case when complete then stamp else last_complete end,',
  'last_complete=case when complete then stamp else last_complete end, source_complete_at=case when complete then j.run_at else source_complete_at end,');
 IF old=patched THEN RAISE EXCEPTION 'Reporting sync contract changed; review before replacing.'; END IF;
 EXECUTE patched;
END $patch$;

CREATE TABLE portal_data.reporting_reader_config (
 id text PRIMARY KEY CHECK(id='weekly-reporting-reminders'),
 token_sha256 text NOT NULL CHECK(token_sha256 ~ '^[a-f0-9]{64}$'),
 enabled boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE portal_data.reporting_reader_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_data.reporting_reader_config FROM PUBLIC,anon,authenticated,service_role;

-- One narrowly scoped job credential; no service-role key is held by Apps Script.
-- Incomplete/stale source data is a failed read, never a fabricated empty report.
CREATE OR REPLACE FUNCTION public.portal_reporting_reminder_gaps(p_token text,p_location_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $gaps$
DECLARE source_at timestamptz; total integer; invalid integer; result jsonb; job mahara_reporting.sync_jobs;
 floor_at timestamptz:=(((now() AT TIME ZONE 'Asia/Kuwait')::date-13)::timestamp AT TIME ZONE 'Asia/Kuwait');
BEGIN
 IF p_token IS NULL OR length(p_token) NOT BETWEEN 40 AND 200 OR NOT EXISTS(
  SELECT 1 FROM portal_data.reporting_reader_config c WHERE c.id='weekly-reporting-reminders'
   AND c.enabled AND c.expires_at>now()
   AND c.token_sha256=encode(sha256(convert_to(p_token,'UTF8')),'hex')
 ) THEN RAISE EXCEPTION 'Invalid reporting reader credential' USING ERRCODE='42501'; END IF;
 IF p_location_id IS NULL OR p_location_id !~ '^[A-Za-z0-9_-]{1,100}$' OR
  NOT EXISTS(SELECT 1 FROM public.ghl_clients c WHERE c.location_id=p_location_id AND c.status='Active') OR
  NOT EXISTS(SELECT 1 FROM portal_data.workspaces w WHERE w.location_id=p_location_id) THEN
  RAISE EXCEPTION 'Unknown active reporting workspace' USING ERRCODE='42501'; END IF;
 SELECT * INTO job FROM mahara_reporting.sync_jobs s WHERE s.namespace='production' AND s.source='ghl'
  AND s.location_id=p_location_id AND s.kind='appointments_recent';
 source_at:=job.source_complete_at;
 IF source_at IS NULL OR source_at<now()-interval '2 hours' OR source_at>now()+interval '1 minute'
  OR job.error IS NOT NULL OR job.last_complete<source_at THEN
  RETURN jsonb_build_object('schemaVersion',1,'locationId',p_location_id,'generatedAt',now(),
   'sourceFreshThrough',source_at,'complete',false,'reason','provider_snapshot_not_ready','showGaps','[]'::jsonb,'closeGaps','[]'::jsonb);
 END IF;
 WITH provider AS MATERIALIZED (
  SELECT f.data,f.conflict,i.present,i.checked_at,
   cal.data AS calendar,cal.conflict AS calendar_conflict,
   (f.data->>'startAt')::timestamptz AS occurrence_start
  FROM mahara_reporting.facts f
  LEFT JOIN mahara_reporting.inventory i ON i.namespace=f.namespace AND i.source=f.source AND i.kind=f.kind AND i.external_id=f.external_id
  LEFT JOIN mahara_reporting.facts cal ON cal.namespace=f.namespace AND cal.source=f.source AND cal.kind='calendar'
   AND cal.external_id=p_location_id||':'||(f.data->>'calendarId') AND cal.data->>'locationId'=p_location_id
  WHERE f.namespace='production' AND f.source='ghl' AND f.kind='appointment' AND f.data->>'locationId'=p_location_id
   AND (f.data->>'startAt')::timestamptz>=floor_at AND (f.data->>'startAt')::timestamptz<=now()
 ), eligible AS MATERIALIZED (
  SELECT p.*,r.attendance AS client_attendance,r.deal,
   coalesce(nullif(ct.name,''),'Appointment '||to_char(p.occurrence_start AT TIME ZONE 'Asia/Kuwait','DD Mon HH24:MI')) AS name
  FROM provider p
  LEFT JOIN portal_data.client_feedback_current(p_location_id) r ON r.appointment_id=p.data->>'id'
   AND r.reported_contact_id=p.data->>'contactId' AND r.reported_start_at=p.occurrence_start
  LEFT JOIN portal_data.contacts ct ON ct.location_id=p_location_id AND ct.contact_id=p.data->>'contactId'
  WHERE p.present IS TRUE AND coalesce((p.data->>'deleted')::boolean,false) IS FALSE
   AND lower(coalesce(p.data->>'status','')) NOT IN ('cancelled','canceled','invalid','deleted')
   AND coalesce((p.calendar->>'callback')::boolean,false) IS FALSE
 ), statuses AS (
  SELECT e.*,coalesce(e.client_attendance,CASE lower(e.data->>'status') WHEN 'showed' THEN 'showed' WHEN 'noshow' THEN 'no_show' WHEN 'no_show' THEN 'no_show' END) AS attendance
  FROM eligible e
 )
 SELECT jsonb_build_object('schemaVersion',1,'locationId',p_location_id,'generatedAt',now(),'sourceFreshThrough',source_at,
  'complete',(SELECT count(*)<=5000 AND count(*) FILTER(WHERE conflict OR calendar_conflict OR calendar IS NULL OR present IS NULL OR checked_at IS NULL OR checked_at<source_at)=0 FROM provider),
  'showGaps',coalesce((SELECT jsonb_agg(jsonb_build_object('appointmentId',data->>'id','occurrenceStart',occurrence_start,'name',name) ORDER BY occurrence_start,data->>'id') FROM statuses WHERE attendance IS NULL),'[]'::jsonb),
  'closeGaps',coalesce((SELECT jsonb_agg(jsonb_build_object('appointmentId',data->>'id','occurrenceStart',occurrence_start,'name',name) ORDER BY occurrence_start,data->>'id') FROM statuses WHERE attendance='showed' AND deal IS NULL),'[]'::jsonb)
 ) INTO result;
 IF (result->>'complete')::boolean IS NOT TRUE THEN
  RETURN result||jsonb_build_object('reason','provider_snapshot_incomplete','showGaps','[]'::jsonb,'closeGaps','[]'::jsonb);
 END IF;
 RETURN result;
END $gaps$;
REVOKE ALL ON FUNCTION public.portal_reporting_reminder_gaps(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.portal_reporting_reminder_gaps(text,text) TO anon;
COMMENT ON FUNCTION public.portal_reporting_reminder_gaps(text,text) IS 'Narrow token-protected reminder read. Fresh completed provider scan plus exact-occurrence accepted client reports. Does not send messages.';
NOTIFY pgrst,'reload schema';
COMMIT;
