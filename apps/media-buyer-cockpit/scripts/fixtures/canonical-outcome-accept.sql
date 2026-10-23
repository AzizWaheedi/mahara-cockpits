-- Existing portal RPC, verified against the live function on 23 October 2026.
CREATE OR REPLACE FUNCTION public.portal_outcome_accept(
 p_location_id text,p_appointment_id text,p_request_id uuid,p_payload jsonb,p_source_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_command portal_data.outbox%ROWTYPE;next_revision bigint;allowed_keys text[]:=ARRAY[
 'attendance','deal','quotation','project_value','currency','feedback','lead_quality','consultation_feedback','not_closed_reason'
];
BEGIN
 IF p_location_id IS NULL OR p_appointment_id IS NULL OR p_request_id IS NULL OR p_source_updated_at IS NULL OR
    p_source_updated_at>now()+interval '5 minutes' OR jsonb_typeof(p_payload)<>'object' OR p_payload='{}'::jsonb THEN
  RAISE EXCEPTION 'invalid_outcome_command';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(key) WHERE key<>ALL(allowed_keys)) OR
    p_payload ? 'attendance' AND p_payload->>'attendance' NOT IN ('unknown','showed','no_show') OR
    p_payload ? 'deal' AND p_payload->>'deal' NOT IN ('unknown','pending','won','lost') OR
    p_payload ? 'quotation' AND jsonb_typeof(p_payload->'quotation')<>'boolean' OR
    p_payload ? 'project_value' AND jsonb_typeof(p_payload->'project_value')<>'number' OR
    p_payload ? 'lead_quality' AND (jsonb_typeof(p_payload->'lead_quality')<>'number' OR (p_payload->>'lead_quality')::numeric NOT BETWEEN 1 AND 10) OR
    p_payload ? 'currency' AND p_payload->>'currency'<>'USD' OR
    p_payload ? 'project_value' AND NOT (p_payload ? 'currency') OR
    p_payload ? 'feedback' AND jsonb_typeof(p_payload->'feedback')<>'string' OR
    p_payload ? 'consultation_feedback' AND jsonb_typeof(p_payload->'consultation_feedback')<>'string' OR
    p_payload ? 'not_closed_reason' AND jsonb_typeof(p_payload->'not_closed_reason')<>'string' THEN
  RAISE EXCEPTION 'invalid_outcome_payload';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM portal_data.appointments a WHERE a.location_id=p_location_id AND a.appointment_id=p_appointment_id) THEN
  RAISE EXCEPTION 'appointment_not_in_canonical_store';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('portal-outcome:'||p_location_id||':'||p_appointment_id,0));
 SELECT * INTO current_command FROM portal_data.outbox o WHERE o.location_id=p_location_id AND o.request_id=p_request_id::text FOR UPDATE;
 IF current_command.request_id IS NOT NULL THEN
  IF current_command.object_id<>p_appointment_id OR current_command.operation<>'appointment-outcome' OR current_command.payload<>p_payload THEN
   RAISE EXCEPTION 'outcome_idempotency_conflict';
  END IF;
  IF current_command.state='review' THEN RAISE EXCEPTION 'outcome_requires_review'; END IF;
  IF current_command.state='failed' THEN
   UPDATE portal_data.outbox SET state='pending',next_attempt_at=now(),last_error=NULL WHERE location_id=p_location_id AND request_id=p_request_id::text;
   current_command.state='pending';
  END IF;
  RETURN jsonb_build_object('revision',current_command.expected_revision::bigint,'state',current_command.state,'unchanged',true);
 END IF;
 IF EXISTS(SELECT 1 FROM portal_data.outbox o WHERE o.location_id=p_location_id AND o.operation='appointment-outcome' AND o.object_id=p_appointment_id AND o.state IN ('pending','leased','failed','review')) THEN
  RAISE EXCEPTION 'appointment_outcome_in_progress';
 END IF;
 SELECT coalesce(max(revision),0)+1 INTO next_revision FROM portal_data.appointment_outcomes o WHERE o.location_id=p_location_id AND o.appointment_id=p_appointment_id;
 INSERT INTO portal_data.appointment_outcomes(
  location_id,appointment_id,revision,attendance,deal,quotation,project_value,currency,feedback,lead_quality,
  consultation_feedback,not_closed_reason,source,source_record_id,source_updated_at,captured_at,request_id
 ) VALUES (
  p_location_id,p_appointment_id,next_revision,p_payload->>'attendance',p_payload->>'deal',
  CASE WHEN p_payload ? 'quotation' THEN (p_payload->>'quotation')::boolean END,
  CASE WHEN p_payload ? 'project_value' THEN (p_payload->>'project_value')::numeric END,p_payload->>'currency',
  p_payload->>'feedback',CASE WHEN p_payload ? 'lead_quality' THEN (p_payload->>'lead_quality')::numeric END,
  p_payload->>'consultation_feedback',p_payload->>'not_closed_reason','portal',p_request_id::text,p_source_updated_at,now(),p_request_id::text
 );
 INSERT INTO portal_data.outbox(location_id,request_id,operation,object_id,expected_revision,payload,state,next_attempt_at,created_at)
 VALUES(p_location_id,p_request_id::text,'appointment-outcome',p_appointment_id,next_revision::text,p_payload,'pending',now(),now());
 RETURN jsonb_build_object('revision',next_revision,'state','pending','unchanged',false);
END $$;

