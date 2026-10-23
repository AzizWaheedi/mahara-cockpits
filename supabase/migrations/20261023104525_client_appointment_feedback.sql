-- Client-authored reports are visible once accepted, independently of provider
-- delivery. No grants on the private source tables are added.
BEGIN;

CREATE TABLE portal_data.outcome_occurrences (
 location_id text NOT NULL, appointment_id text NOT NULL, revision bigint NOT NULL,
 contact_id text NOT NULL, start_at timestamptz NOT NULL, calendar_id text,
 captured_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(location_id,appointment_id,revision),
 FOREIGN KEY(location_id,appointment_id,revision)
  REFERENCES portal_data.appointment_outcomes(location_id,appointment_id,revision)
);
ALTER TABLE portal_data.outcome_occurrences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_data.outcome_occurrences FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE portal_data.outcome_occurrences IS
 'Immutable occurrence at direct feedback acceptance. Written only by the private accept RPC, never by browsers or projection refreshes.';

CREATE OR REPLACE FUNCTION public.portal_feedback_accept(
 p_location_id text,p_appointment_id text,p_request_id uuid,p_payload jsonb,
 p_source_updated_at timestamptz,p_contact_id text,p_start_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a portal_data.appointments; previous portal_data.outcome_occurrences; result jsonb;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_payload='{}'::jsonb OR
    EXISTS(SELECT 1 FROM jsonb_each(p_payload) e WHERE e.value='null'::jsonb) THEN
  RAISE EXCEPTION 'invalid_outcome_payload'; END IF;
 IF coalesce(p_contact_id,'')='' OR p_start_at IS NULL THEN RAISE EXCEPTION 'outcome_binding_changed'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('portal-outcome:'||p_location_id||':'||p_appointment_id,0));
 SELECT x.* INTO previous FROM portal_data.outcome_occurrences x
 JOIN portal_data.appointment_outcomes o USING(location_id,appointment_id,revision)
 WHERE o.location_id=p_location_id AND o.request_id=p_request_id::text;
 IF FOUND THEN
  IF previous.appointment_id<>p_appointment_id OR previous.contact_id<>p_contact_id OR previous.start_at<>p_start_at THEN
   RAISE EXCEPTION 'outcome_binding_changed'; END IF;
  -- A lost response can be recovered after a later reschedule. The original
  -- immutable request is returned; no new feedback or occurrence is written.
  RETURN public.portal_outcome_accept(p_location_id,p_appointment_id,p_request_id,p_payload,p_source_updated_at);
 END IF;
 IF EXISTS(SELECT 1 FROM portal_data.outbox WHERE location_id=p_location_id AND request_id=p_request_id::text) THEN
  RAISE EXCEPTION 'outcome_idempotency_conflict'; END IF;
 SELECT * INTO a FROM portal_data.appointments WHERE location_id=p_location_id AND appointment_id=p_appointment_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_in_canonical_store'; END IF;
 IF a.contact_id IS DISTINCT FROM p_contact_id OR a.start_at IS DISTINCT FROM p_start_at OR a.deleted_at IS NOT NULL THEN
  RAISE EXCEPTION 'outcome_binding_changed'; END IF;
 IF p_payload ? 'lead_quality' AND coalesce(p_payload->>'attendance',(
  SELECT o.attendance FROM portal_data.client_feedback_current(p_location_id) o
  WHERE o.appointment_id=p_appointment_id AND o.occurrence_verified
   AND o.reported_start_at=p_start_at AND o.reported_contact_id=p_contact_id
  LIMIT 1
 ))='no_show' THEN RAISE EXCEPTION 'invalid_outcome_payload'; END IF;
 result:=public.portal_outcome_accept(p_location_id,p_appointment_id,p_request_id,p_payload,p_source_updated_at);
 INSERT INTO portal_data.outcome_occurrences(location_id,appointment_id,revision,contact_id,start_at,calendar_id)
 VALUES(p_location_id,p_appointment_id,(result->>'revision')::bigint,p_contact_id,p_start_at,a.calendar_id);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.portal_feedback_accept(text,text,uuid,jsonb,timestamptz,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.portal_feedback_accept(text,text,uuid,jsonb,timestamptz,text,timestamptz) TO service_role;

-- Internal shared read used by cockpit reports and reminder checks. The caller
-- owns authorization; this function is never exposed as a browser/API grant.
CREATE OR REPLACE FUNCTION portal_data.client_feedback_current(p_location text)
RETURNS TABLE(appointment_id text,reported_start_at timestamptz,reported_contact_id text,
 captured_at timestamptz,source text,delivery_state text,attendance text,deal text,
 lead_quality numeric,feedback text,consultation_feedback text,not_closed_reason text,quotation boolean,project_value numeric,currency text,occurrence_verified boolean)
LANGUAGE sql STABLE SET search_path='' AS $feedback$
 WITH accepted AS MATERIALIZED (
  SELECT o.*, b.state AS delivery_state,
    coalesce(x.start_at,j.start_at) AS reported_start_at,
    coalesce(x.contact_id,j.contact_id) AS reported_contact_id
  FROM portal_data.appointment_outcomes o
  JOIN portal_data.appointments a ON a.location_id=o.location_id AND a.appointment_id=o.appointment_id
  LEFT JOIN portal_data.journey_outcome_bindings j ON j.location_id=o.location_id
   AND j.appointment_id=o.appointment_id AND j.revision=o.revision
  LEFT JOIN portal_data.outcome_occurrences x ON x.location_id=o.location_id
   AND x.appointment_id=o.appointment_id AND x.revision=o.revision
  LEFT JOIN portal_data.outbox b ON b.location_id=o.location_id AND b.request_id=o.request_id
   AND b.object_id=o.appointment_id AND b.expected_revision=o.revision::text AND b.operation='appointment-outcome'
  WHERE o.location_id=p_location AND (
   o.source='portal' AND b.state IN ('pending','leased','failed','review','succeeded') OR
   o.source IN ('portal-capture','reporting-capture') AND o.request_id IS NULL
  )
 ), reports AS (
  SELECT o.appointment_id,o.reported_start_at,o.reported_contact_id,
   (array_agg(o.captured_at ORDER BY (o.source='portal') DESC,o.revision DESC))[1] AS captured_at,
   (array_agg(o.source ORDER BY (o.source='portal') DESC,o.revision DESC))[1] AS source,
   (array_agg(o.delivery_state ORDER BY (o.source='portal') DESC,o.revision DESC))[1] AS delivery_state,
   (array_agg(o.attendance ORDER BY (o.source='portal') DESC,o.revision DESC) FILTER (WHERE o.attendance IS NOT NULL))[1] AS attendance,
   (array_agg(o.deal ORDER BY (o.source='portal') DESC,o.revision DESC) FILTER (WHERE o.deal IS NOT NULL))[1] AS deal,
   (array_agg(o.lead_quality ORDER BY (o.source='portal') DESC,o.revision DESC) FILTER (WHERE o.lead_quality IS NOT NULL))[1] AS lead_quality,
   (array_agg(o.feedback ORDER BY (o.source='portal') DESC,o.revision DESC) FILTER (WHERE o.feedback IS NOT NULL))[1] AS feedback,
   (array_agg(o.consultation_feedback ORDER BY (o.source='portal') DESC,o.revision DESC) FILTER (WHERE o.consultation_feedback IS NOT NULL))[1] AS consultation_feedback,
   (array_agg(o.not_closed_reason ORDER BY (o.source='portal') DESC,o.revision DESC) FILTER (WHERE o.not_closed_reason IS NOT NULL))[1] AS not_closed_reason,
   (array_agg(o.quotation ORDER BY (o.source='portal') DESC,o.revision DESC) FILTER (WHERE o.quotation IS NOT NULL))[1] AS quotation,
   (array_agg(o.project_value ORDER BY (o.source='portal') DESC,o.revision DESC) FILTER (WHERE o.project_value IS NOT NULL))[1] AS project_value,
   (array_agg(o.currency ORDER BY (o.source='portal') DESC,o.revision DESC) FILTER (WHERE o.currency IS NOT NULL))[1] AS currency,
   (o.reported_start_at IS NOT NULL AND o.reported_contact_id IS NOT NULL) AS occurrence_verified
  FROM accepted o
  GROUP BY o.appointment_id,o.reported_start_at,o.reported_contact_id
 )
 SELECT * FROM reports;
$feedback$;
REVOKE ALL ON FUNCTION portal_data.client_feedback_current(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cockpit_client_appointment_feedback(
 p_location text DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL,
 p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_task_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 c public.cockpit_board_clients;
 matches integer;
 result jsonb;
BEGIN
 IF NOT coalesce(public.cockpit_has_active_seat(), false) THEN
  RAISE EXCEPTION 'Sign in with an active cockpit seat to read client feedback.' USING ERRCODE='42501';
 END IF;
 IF (p_location IS NULL AND p_task_id IS NULL) OR
    p_location IS NOT NULL AND p_location !~ '^[A-Za-z0-9_-]{1,100}$' OR
    p_task_id IS NOT NULL AND p_task_id !~ '^[A-Za-z0-9_-]{1,100}$' OR
    p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 OR
    p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
  RAISE EXCEPTION 'Choose a client and a valid feedback period.' USING ERRCODE='22023';
 END IF;
 SELECT count(*) INTO matches FROM public.cockpit_board_clients b
 WHERE (p_location IS NULL OR b.location_id=p_location) AND (p_task_id IS NULL OR b.clickup_id=p_task_id);
 IF matches<>1 THEN
  RAISE EXCEPTION 'This client is not available in your cockpit.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO c FROM public.cockpit_board_clients b
 WHERE (p_location IS NULL OR b.location_id=p_location) AND (p_task_id IS NULL OR b.clickup_id=p_task_id);
 IF NOT coalesce(public.cockpit_client_allowed(c.client_name),false) THEN
  RAISE EXCEPTION 'This client is not available in your cockpit.' USING ERRCODE='42501';
 END IF;

 WITH reports AS (
  SELECT * FROM portal_data.client_feedback_current(c.location_id) o
  WHERE (p_from IS NULL OR o.reported_start_at >= p_from::timestamp AT TIME ZONE 'Asia/Riyadh')
   AND (p_to IS NULL OR o.reported_start_at < (p_to+1)::timestamp AT TIME ZONE 'Asia/Riyadh')
 ), merged AS (
  SELECT l.*,l.reported_contact_id AS contact_id,coalesce(nullif(ct.name,''),'') AS contact_name,a.ad_name,a.campaign_name
  FROM reports l
  JOIN portal_data.appointments a ON a.location_id=c.location_id AND a.appointment_id=l.appointment_id
  LEFT JOIN portal_data.contacts ct ON ct.location_id=a.location_id AND ct.contact_id=l.reported_contact_id
 ), page AS (
  SELECT * FROM merged ORDER BY captured_at DESC,appointment_id,reported_start_at DESC NULLS LAST LIMIT p_limit OFFSET p_offset
 )
 SELECT jsonb_build_object('locationId',c.location_id,'generatedAt',now(),
  'total',(SELECT count(*) FROM merged),'hasMore',(SELECT count(*) FROM merged)>p_offset+p_limit,
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'appointmentId',p.appointment_id,'contactId',p.contact_id,'contactName',nullif(p.contact_name,''),
   'startAt',p.reported_start_at,'occurrenceVerified',p.occurrence_verified,'attendance',p.attendance,'deal',p.deal,
   'leadQuality',CASE WHEN p.attendance='no_show' THEN NULL ELSE p.lead_quality END,
   'feedback',p.feedback,'consultationFeedback',p.consultation_feedback,'notClosedReason',p.not_closed_reason,
   'updatedAt',p.captured_at,'source',p.source,'deliveryState',p.delivery_state,
   'adName',p.ad_name,'campaignName',p.campaign_name
  ) ORDER BY p.captured_at DESC,p.appointment_id,p.reported_start_at DESC NULLS LAST) FROM page p),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.cockpit_client_appointment_feedback(text,date,date,integer,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_client_appointment_feedback(text,date,date,integer,integer,text) TO authenticated;
COMMENT ON FUNCTION public.cockpit_client_appointment_feedback(text,date,date,integer,integer,text) IS
 'Client-authored appointment reports. Active seat and exact client access required. Accepted reports appear before provider delivery. No internal call notes or direct table grants.';
NOTIFY pgrst,'reload schema';
COMMIT;
