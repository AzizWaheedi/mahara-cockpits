BEGIN;
CREATE OR REPLACE FUNCTION portal_data.reporting_reminder_snapshot(p_location_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $gaps$
DECLARE source_at timestamptz; total integer; invalid integer; result jsonb; job mahara_reporting.sync_jobs;
 floor_at timestamptz:=(((now() AT TIME ZONE 'Asia/Kuwait')::date-13)::timestamp AT TIME ZONE 'Asia/Kuwait');
BEGIN
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
REVOKE ALL ON FUNCTION portal_data.reporting_reminder_snapshot(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE portal_data.reporting_reminder_approvals (
 token text PRIMARY KEY CHECK(token ~ '^native-[a-f0-9]{32}$'),
 location_id text NOT NULL,week_key text NOT NULL,snapshot_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 claimed_at timestamptz,
 UNIQUE(location_id,week_key,snapshot_hash)
);
ALTER TABLE portal_data.reporting_reminder_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_data.reporting_reminder_approvals FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION portal_data.reporting_gap_hash(p_snapshot jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('locationId',p_snapshot->'locationId',
  'showGaps',p_snapshot->'showGaps','closeGaps',p_snapshot->'closeGaps')::text,'UTF8')),'hex');
$$;
REVOKE ALL ON FUNCTION portal_data.reporting_gap_hash(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.portal_reporting_reminder_gaps(p_token text,p_location_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; h text; wk text; approval portal_data.reporting_reminder_approvals;
BEGIN
 IF p_token IS NULL OR length(p_token) NOT BETWEEN 40 AND 200 OR NOT EXISTS(
  SELECT 1 FROM portal_data.reporting_reader_config c WHERE c.id='weekly-reporting-reminders'
   AND c.enabled AND c.expires_at>now()
   AND c.token_sha256=encode(sha256(convert_to(p_token,'UTF8')),'hex')
 ) THEN RAISE EXCEPTION 'Invalid reporting reader credential' USING ERRCODE='42501'; END IF;
 result:=portal_data.reporting_reminder_snapshot(p_location_id);
 IF (result->>'complete')::boolean IS NOT TRUE OR
    jsonb_array_length(result->'showGaps')+jsonb_array_length(result->'closeGaps')=0 THEN RETURN result; END IF;
 h:=portal_data.reporting_gap_hash(result);wk:=to_char(now() AT TIME ZONE 'Asia/Kuwait','IYYY-IW');
 PERFORM pg_advisory_xact_lock(hashtextextended('reporting-approval:'||p_location_id||':'||wk,0));
 SELECT * INTO approval FROM portal_data.reporting_reminder_approvals
 WHERE location_id=p_location_id AND week_key=wk AND snapshot_hash=h FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO portal_data.reporting_reminder_approvals(token,location_id,week_key,snapshot_hash,expires_at)
  VALUES('native-'||replace(gen_random_uuid()::text,'-',''),p_location_id,wk,h,now()+interval '24 hours') RETURNING * INTO approval;
 ELSIF approval.claimed_at IS NOT NULL THEN
  RETURN result||jsonb_build_object('approvalToken',NULL,'approvalState','already_claimed');
 ELSIF approval.expires_at<=now() THEN
  UPDATE portal_data.reporting_reminder_approvals SET token='native-'||replace(gen_random_uuid()::text,'-',''),
   created_at=now(),expires_at=now()+interval '24 hours' WHERE token=approval.token RETURNING * INTO approval;
 END IF;
 RETURN result||jsonb_build_object('approvalToken',approval.token,'approvalExpiresAt',approval.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.portal_reporting_reminder_gaps(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.portal_reporting_reminder_gaps(text,text) TO anon;

-- This permission authorizes one dispatch attempt, not a delivery receipt.
-- A lost claim response cannot authorize a retry. Provider delivery uncertainty
-- stays held for staff rather than sending the client a duplicate message.
CREATE OR REPLACE FUNCTION public.portal_reporting_reminder_claim(p_approval_token text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE approval portal_data.reporting_reminder_approvals; snapshot jsonb;
BEGIN
 IF p_approval_token IS NULL OR p_approval_token !~ '^native-[a-f0-9]{32}$' THEN
  RETURN jsonb_build_object('allowed',false,'reason','refresh_review'); END IF;
 SELECT * INTO approval FROM portal_data.reporting_reminder_approvals WHERE token=p_approval_token FOR UPDATE;
 IF NOT FOUND OR approval.expires_at<=now() THEN RETURN jsonb_build_object('allowed',false,'reason','expired'); END IF;
 IF approval.claimed_at IS NOT NULL THEN RETURN jsonb_build_object('allowed',false,'reason','already_claimed'); END IF;
 IF NOT EXISTS(SELECT 1 FROM portal_data.reporting_reader_config WHERE enabled AND expires_at>now()) THEN
  RETURN jsonb_build_object('allowed',false,'reason','reader_disabled'); END IF;
 BEGIN snapshot:=portal_data.reporting_reminder_snapshot(approval.location_id);
 EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('allowed',false,'reason','source_unavailable'); END;
 IF (snapshot->>'complete')::boolean IS NOT TRUE THEN RETURN jsonb_build_object('allowed',false,'reason','source_unavailable'); END IF;
 IF portal_data.reporting_gap_hash(snapshot)<>approval.snapshot_hash THEN
  RETURN jsonb_build_object('allowed',false,'reason','feedback_changed'); END IF;
 UPDATE portal_data.reporting_reminder_approvals SET claimed_at=now() WHERE token=p_approval_token;
 RETURN jsonb_build_object('allowed',true,'locationId',approval.location_id,'expiresAt',approval.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.portal_reporting_reminder_claim(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.portal_reporting_reminder_claim(text) TO anon;
COMMENT ON FUNCTION public.portal_reporting_reminder_claim(text) IS 'Single-use exact-gap approval immediately before dispatch. No client names, phones or feedback returned. Does not prove message delivery.';
DO $score$
DECLARE original text; changed text;
BEGIN
 original:=pg_get_functiondef('public.cockpit_client_appointment_feedback(text,date,date,integer,integer,text)'::regprocedure);
 changed:=replace(original,'CASE WHEN p.attendance=''no_show'' THEN NULL ELSE p.lead_quality END','CASE WHEN p.attendance=''no_show'' OR p.lead_quality NOT BETWEEN 1 AND 10 THEN NULL ELSE p.lead_quality END');
 IF original=changed THEN RAISE EXCEPTION 'Feedback reader contract changed'; END IF;
 EXECUTE changed;
END $score$;
NOTIFY pgrst,'reload schema';
COMMIT;
