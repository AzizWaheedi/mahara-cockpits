-- Preserve historical booking/finance rules while accepted, occurrence-bound
-- client feedback updates the board without waiting for a Sheet projection.
-- Unbound historical reports keep their previous fallback; they never become
-- authoritative attendance. Bound reports for a different occurrence are not
-- reused after a reschedule or contact change. No public grants are added.
BEGIN;
SET LOCAL lock_timeout='3s';

CREATE OR REPLACE FUNCTION portal_data.cockpit_feedback_outcomes(p_location text)
RETURNS TABLE(appointment_id text,attendance text,deal text,quotation boolean,
 project_value numeric,currency text,lead_quality numeric,captured_at timestamptz,
 authoritative_attendance boolean)
LANGUAGE sql STABLE SET search_path='' AS $outcomes$
 WITH legacy AS MATERIALIZED (
  SELECT DISTINCT ON (o.appointment_id) o.*
  FROM portal_data.appointment_outcomes o
  WHERE o.location_id=p_location
   AND NOT EXISTS(SELECT 1 FROM portal_data.outcome_occurrences x
     WHERE x.location_id=o.location_id AND x.appointment_id=o.appointment_id AND x.revision=o.revision)
   AND NOT EXISTS(SELECT 1 FROM portal_data.journey_outcome_bindings j
     WHERE j.location_id=o.location_id AND j.appointment_id=o.appointment_id AND j.revision=o.revision)
  ORDER BY o.appointment_id,o.revision DESC
 ), verified AS MATERIALIZED (
  SELECT r.* FROM portal_data.client_feedback_current(p_location) r
  WHERE r.occurrence_verified AND EXISTS(
   SELECT 1 FROM public.appointments a
   WHERE coalesce(nullif(a.ghl_location_id,''),nullif(a.ghl_location,''))=p_location
    AND a.ghl_appointment_id=r.appointment_id
    AND a.ghl_contact_id=r.reported_contact_id AND a.start_at=r.reported_start_at
  )
 ), merged AS (
  SELECT coalesce(r.appointment_id,l.appointment_id) AS appointment_id,
   coalesce(r.attendance,l.attendance) AS attendance,coalesce(r.deal,l.deal) AS deal,
   coalesce(r.quotation,l.quotation) AS quotation,coalesce(r.project_value,l.project_value) AS project_value,
   coalesce(r.currency,l.currency) AS currency,coalesce(r.lead_quality,l.lead_quality) AS lead_quality,
   coalesce(r.captured_at,l.captured_at) AS captured_at,
   coalesce(r.attendance IN ('showed','no_show'),false) AS authoritative_attendance
  FROM legacy l FULL JOIN verified r USING(appointment_id)
 )
 SELECT m.appointment_id,m.attendance,m.deal,m.quotation,m.project_value,m.currency,
  CASE WHEN m.attendance='no_show' THEN NULL ELSE m.lead_quality END,m.captured_at,m.authoritative_attendance
 FROM merged m;
$outcomes$;
REVOKE ALL ON FUNCTION portal_data.cockpit_feedback_outcomes(text) FROM PUBLIC,anon,authenticated,service_role;

-- Patch only the verified live bodies. CREATE OR REPLACE retains each existing
-- owner and ACL. A concurrent change causes this transaction to fail closed.
DO $patch$
DECLARE body text; original text; changed text; signature text;
BEGIN
 signature:='public.cockpit_board_facts_refresh(date,date)';
 SELECT p.prosrc INTO body FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(signature);
 IF body IS NULL THEN RAISE EXCEPTION 'Board facts refresh is missing'; END IF;
 IF body NOT LIKE '%portal_data.cockpit_feedback_outcomes(l.location_id)%' THEN
  IF md5(body)<>'9508bf3922c875a27c6052951cb11749' THEN
   RAISE EXCEPTION 'Board facts refresh changed; review its current definition before applying the feedback overlay';
  END IF;
  original:=pg_get_functiondef(to_regprocedure(signature));
  changed:=replace(original,
   'project_value numeric, currency text, lead_quality numeric, captured_at timestamptz) ON COMMIT DROP;',
   'project_value numeric, currency text, lead_quality numeric, captured_at timestamptz, authoritative_attendance boolean) ON COMMIT DROP;');
  changed:=replace(changed,$old$
    SELECT DISTINCT ON (o.location_id, o.appointment_id) o.location_id, o.appointment_id, o.attendance, o.deal, o.quotation,
           o.project_value, nullif(upper(btrim(o.currency)), ''), o.lead_quality, o.captured_at
    FROM portal_data.appointment_outcomes o JOIN pg_temp._bf_loc l ON l.location_id = o.location_id
    ORDER BY o.location_id, o.appointment_id, o.revision DESC;$old$,$new$
    SELECT l.location_id, o.appointment_id, o.attendance, o.deal, o.quotation,
           o.project_value, nullif(upper(btrim(o.currency)), ''), o.lead_quality, o.captured_at, o.authoritative_attendance
    FROM pg_temp._bf_loc l
    CROSS JOIN LATERAL portal_data.cockpit_feedback_outcomes(l.location_id) o;$new$);
  changed:=replace(changed,$old$CASE WHEN a.status = 'showed' THEN 'showed' WHEN a.status = 'noshow' THEN 'noshow'
             WHEN coalesce(a.attended, sm.mark, sd.mark)$old$,$new$CASE WHEN o.authoritative_attendance AND o.attendance = 'showed' THEN 'showed'
             WHEN o.authoritative_attendance AND o.attendance = 'no_show' THEN 'noshow'
             WHEN a.status = 'showed' THEN 'showed' WHEN a.status = 'noshow' THEN 'noshow'
             WHEN coalesce(a.attended, sm.mark, sd.mark)$new$);
  changed:=replace(changed,
   '(''no_outcome'', m.no_outcome::int), (''lq_sum'', m.lq), (''lq_count'', CASE WHEN m.lq IS NOT NULL THEN 1 ELSE 0 END),',
   '(''no_outcome'', m.no_outcome::int), (''lq_sum'', CASE WHEN m.att<>''noshow'' THEN m.lq END), (''lq_count'', CASE WHEN m.att<>''noshow'' AND m.lq IS NOT NULL THEN 1 ELSE 0 END),');
  IF changed=original OR changed NOT LIKE '%portal_data.cockpit_feedback_outcomes(l.location_id)%'
   OR changed NOT LIKE '%WHEN o.authoritative_attendance AND o.attendance = ''no_show''%'
   OR changed NOT LIKE '%CASE WHEN m.att<>''noshow'' THEN m.lq END%' THEN
   RAISE EXCEPTION 'Board facts feedback patch did not match the expected body';
  END IF;
  EXECUTE changed;
 END IF;

 signature:='public.cockpit_board_appointments(text,date,date,jsonb)';
 SELECT p.prosrc INTO body FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(signature);
 IF body IS NULL THEN RAISE EXCEPTION 'Board appointments is missing'; END IF;
 IF body NOT LIKE '%portal_data.cockpit_feedback_outcomes(p_location)%' THEN
  IF md5(body)<>'39bd9ec26b63f9232eea6da4f486c2e0' THEN
   RAISE EXCEPTION 'Board appointments changed; review its current definition before applying the feedback overlay';
  END IF;
  original:=pg_get_functiondef(to_regprocedure(signature));
  changed:=replace(original,$old$
    SELECT DISTINCT ON (o.appointment_id) o.appointment_id, o.attendance
    FROM portal_data.appointment_outcomes o WHERE o.location_id = p_location
    ORDER BY o.appointment_id, o.revision DESC$old$,$new$
    SELECT o.appointment_id, o.attendance, o.authoritative_attendance
    FROM portal_data.cockpit_feedback_outcomes(p_location) o$new$);
  changed:=replace(changed,$old$CASE WHEN a.status = 'showed' THEN 'showed' WHEN a.status = 'noshow' THEN 'noshow'
         WHEN coalesce(a.attended, sm.mark)$old$,$new$CASE WHEN o.authoritative_attendance AND o.attendance = 'showed' THEN 'showed'
         WHEN o.authoritative_attendance AND o.attendance = 'no_show' THEN 'noshow'
         WHEN a.status = 'showed' THEN 'showed' WHEN a.status = 'noshow' THEN 'noshow'
         WHEN coalesce(a.attended, sm.mark)$new$);
  IF changed=original OR changed NOT LIKE '%portal_data.cockpit_feedback_outcomes(p_location)%'
   OR changed NOT LIKE '%WHEN o.authoritative_attendance AND o.attendance = ''no_show''%' THEN
   RAISE EXCEPTION 'Board appointments feedback patch did not match the expected body';
  END IF;
  EXECUTE changed;
 END IF;
END $patch$;
COMMIT;
