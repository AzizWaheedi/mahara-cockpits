-- Data view: say how the cockpit attributed each counted booking (Muhammed, 2026-10-12).
--
-- The media sync now counts every booking a client's GHL holds, under the
-- campaign whose ad bought it. A booking whose lead has no ad, or names an ad
-- the cockpit never saw, still counts under the client's current campaign,
-- and the booking row says so in data->>'attribution' ("ad", "unknown_ad",
-- "none"). This adds that word to each appointment as cockpit_attribution so
-- the page can mention it. Everything else in the function is unchanged
-- (body from live pg_get_functiondef, 2026-10-12).
--
-- The return type gains a column, so the function is dropped and created.
-- Its callers (rows, export, record, summary) are LANGUAGE sql bodies that
-- resolve it at call time and read rows through to_jsonb or by name.

BEGIN;

DROP FUNCTION public.cockpit_data_view_appointments(text,timestamptz,text,text,text,text,text);

CREATE FUNCTION public.cockpit_data_view_appointments(p_location text, p_from timestamp with time zone, p_key text, p_filter text, p_like text, p_digits text, p_exact text)
 RETURNS TABLE(id text, contact_id text, location_id text, client text, booked_at timestamp with time zone, start_at timestamp with time zone, status text, ghl_source text, calendar text, name text, phone text, lead_found boolean, lead_channel text, lead_source text, lead_ad_name text, lead_campaign_name text, updated_at timestamp with time zone, deal text, quotation boolean, project_value numeric, currency text, feedback text, lead_quality numeric, not_closed_reason text, outcome_at timestamp with time zone, cockpit text, cockpit_at timestamp with time zone, cockpit_attribution text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 WITH a AS (
  SELECT ap.*, (ap.booked_at AT TIME ZONE 'Asia/Riyadh')::date AS bday
  FROM public.appointments ap
  WHERE (p_key IS NOT NULL AND (ap.ghl_contact_id=p_key OR ap.ghl_appointment_id=p_key))
   OR (p_key IS NULL AND ap.booked_at>=p_from AND (p_location IS NULL OR ap.ghl_location_id=p_location))
 ), nat AS (
  SELECT e.data->>'eventId' AS event_id, e.data->>'contactId' AS contact_id, e.data->>'locationId' AS loc,
   e.campaign_name, e.day, left(coalesce(e.data->>'startTime',e.data->>'appointmentDate'),10) AS sd, e.imported_at,
   e.data->>'attribution' AS attribution
  FROM public.cockpit_media_booking_events e WHERE e.source_deployment='native:media'
 ), nstart AS (SELECT min(nat.day) AS d FROM nat),
 camp AS (SELECT * FROM public.cockpit_data_view_campaign_locations()),
 names AS (
  SELECT lower(btrim(g.client_name)) AS k, min(g.location_id) AS loc FROM public.ghl_clients g
  GROUP BY 1 HAVING count(*)=1
 ), cvx AS (
  SELECT coalesce(camp.location_id,names.loc) AS loc, e.campaign_name, e.day,
   left(coalesce(e.data->>'startTime',e.data->>'appointmentDate'),10) AS sd
  FROM public.cockpit_media_booking_events e
  LEFT JOIN camp ON camp.campaign_name=e.campaign_name
  LEFT JOIN names ON names.k=lower(btrim(e.data->>'client'))
  WHERE e.source_deployment<>'native:media'
   AND e.day>=least((SELECT min(a.bday) FROM a),(SELECT nstart.d FROM nstart))
 ), twin AS (
  SELECT n.event_id FROM
   (SELECT nat.event_id,nat.campaign_name,nat.day,nat.sd,row_number() OVER (PARTITION BY nat.campaign_name,nat.day,nat.sd ORDER BY nat.event_id) AS rn FROM nat) n
   JOIN (SELECT cvx.campaign_name,cvx.day,cvx.sd,row_number() OVER (PARTITION BY cvx.campaign_name,cvx.day,cvx.sd) AS rn FROM cvx) c
   ON c.campaign_name=n.campaign_name AND c.day=n.day AND c.sd=n.sd AND c.rn=n.rn
 ), outc AS (
  SELECT DISTINCT ON (o.location_id,o.appointment_id) o.*
  FROM portal_data.appointment_outcomes o WHERE o.appointment_id IN (SELECT a.ghl_appointment_id FROM a)
  ORDER BY o.location_id,o.appointment_id,o.revision DESC,o.captured_at DESC
 ), ads AS (
  SELECT DISTINCT ON (d.data->>'metaAdId') d.data->>'metaAdId' AS ad_id, d.data->>'adName' AS ad_name,
   coalesce(d.data->>'campaignName',d.campaign_name) AS campaign_name
  FROM public.cockpit_media_daily_stats d WHERE d.data->>'metaAdId' IS NOT NULL
  ORDER BY d.data->>'metaAdId', d.day DESC
 ), r AS (
  SELECT a.ghl_appointment_id AS id, a.ghl_contact_id AS contact_id, a.ghl_location_id AS location_id,
   coalesce(g.client_name,'Location '||a.ghl_location_id) AS client, a.booked_at, a.start_at, a.status, a.ghl_source,
   cal.name AS calendar, coalesce(nullif(a.contact_name,''),l.contact_name) AS name, coalesce(nullif(a.contact_phone,''),l.contact_phone) AS phone,
   l.ghl_contact_id IS NOT NULL AS lead_found, l.channel AS lead_channel, l.source_field AS lead_source,
   ads.ad_name AS lead_ad_name, coalesce(ads.campaign_name,nullif(l.attribution_raw->>'utmCampaign','')) AS lead_campaign_name, a.updated_at,
   o.deal, o.quotation, o.project_value, o.currency, o.feedback, o.lead_quality, o.not_closed_reason, o.captured_at AS outcome_at,
   CASE
    WHEN n.event_id IS NOT NULL THEN CASE WHEN tw.event_id IS NOT NULL THEN 'twice' ELSE 'counted' END
    WHEN a.bday<(SELECT nstart.d FROM nstart) THEN
     CASE WHEN cd.n IS NOT NULL THEN 'by_day' WHEN l.channel='Meta' THEN 'missing_old' ELSE 'not_ad' END
    WHEN l.channel IS DISTINCT FROM 'Meta' THEN 'not_ad'
    WHEN nl.loc IS NULL AND NOT EXISTS(SELECT 1 FROM camp WHERE camp.location_id=a.ghl_location_id) THEN 'not_tracked'
    WHEN nc.contact_id IS NOT NULL THEN 'other_booking'
    ELSE 'missing' END AS cockpit,
   n.imported_at AS cockpit_at,
   n.attribution AS cockpit_attribution
  FROM a
  LEFT JOIN public.ghl_clients g ON g.location_id=a.ghl_location_id
  LEFT JOIN public.client_leads l ON l.ghl_contact_id=a.ghl_contact_id
  LEFT JOIN ads ON ads.ad_id=l.ad_id
  LEFT JOIN LATERAL (SELECT c.name FROM public.ghl_calendars c WHERE c.calendar_id=a.calendar_id ORDER BY c.location_id=a.ghl_location_id DESC LIMIT 1) cal ON true
  LEFT JOIN outc o ON o.appointment_id=a.ghl_appointment_id AND o.location_id=a.ghl_location_id
  LEFT JOIN (SELECT DISTINCT ON (nat.event_id) nat.event_id,nat.imported_at,nat.attribution FROM nat WHERE nat.event_id IS NOT NULL ORDER BY nat.event_id,nat.imported_at) n
   ON n.event_id=a.ghl_appointment_id
  LEFT JOIN (SELECT DISTINCT twin.event_id FROM twin) tw ON tw.event_id=a.ghl_appointment_id
  LEFT JOIN (SELECT cvx.loc,cvx.day,count(*) AS n FROM cvx GROUP BY 1,2) cd ON cd.loc=a.ghl_location_id AND cd.day=a.bday
  LEFT JOIN (SELECT DISTINCT nat.loc FROM nat) nl ON nl.loc=a.ghl_location_id
  LEFT JOIN (SELECT DISTINCT nat.contact_id FROM nat) nc ON nc.contact_id=a.ghl_contact_id
 )
 SELECT * FROM r
 WHERE CASE coalesce(p_filter,'any')
   WHEN 'any' THEN true
   WHEN 'all' THEN true
   WHEN 'upcoming' THEN r.start_at>=now() AND r.status IS DISTINCT FROM 'cancelled'
   WHEN 'showed' THEN r.status='showed'
   WHEN 'not_counted' THEN r.cockpit IN ('missing','missing_old')
   WHEN 'no_result' THEN r.start_at<now() AND r.status='confirmed' AND r.ghl_source IS DISTINCT FROM 'google_calendar'
   WHEN 'calendar' THEN r.ghl_source='google_calendar'
   WHEN 'twice' THEN r.cockpit='twice'
   ELSE false END
  AND (p_like IS NULL OR r.id=p_exact OR r.contact_id=p_exact OR r.name ILIKE p_like OR r.client ILIKE p_like
   OR r.calendar ILIKE p_like OR r.lead_campaign_name ILIKE p_like OR r.lead_ad_name ILIKE p_like
   OR (p_digits IS NOT NULL AND regexp_replace(coalesce(r.phone,''),'\D','','g') LIKE '%'||p_digits||'%'));
$function$;

-- Internal helper: no client role may call it directly (as in 20261011b).
REVOKE ALL ON FUNCTION public.cockpit_data_view_appointments(text,timestamptz,text,text,text,text,text) FROM PUBLIC,anon,authenticated;

COMMIT;
