-- Data view: real names for every GHL account, and the booking's notes and
-- call agent (Muhammed, 2026-10-13).
--
-- 1. A location that is not in ghl_clients showed as "Location <id>" (for
--    example 7NI8yyJtwsh2OOWA5Icr, Mahara's own sales account). The name now
--    falls back to the cockpit's client list (public.clients), then to the
--    account name GHL gave the booking ("Main" is GHL's default, so it is
--    skipped), then to "Unknown GHL account <id>".
-- 2. Picking such an account (the Compare tab links to it) raised "Unknown
--    client location". Any account with leads or bookings is now accepted,
--    and the picker lists it after the clients as "Not a client".
-- 3. Appointments gain notes and agent (portal_data.appointments, the
--    Master Dashboard's Additional Notes and Agent) and agent_number, the
--    Agent Data tab's code (DATABASE sheet), kept in cockpit_call_agents.
--    An agent who is not in that table keeps the name and has no number.
--
-- Function bodies are the live ones (prosrc md5 checked against the repo
-- files on 2026-10-13) with only the lines above changed. The appointments
-- return type gains columns, so it is dropped and created; its callers
-- (rows, export, record, summary) read it with SELECT * and to_jsonb.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cockpit_call_agents(
 agent_number integer PRIMARY KEY,
 agent_name text NOT NULL CHECK (btrim(agent_name)<>''),
 active boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_call_agents_name_key ON public.cockpit_call_agents(lower(btrim(agent_name)));
ALTER TABLE public.cockpit_call_agents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_call_agents FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.cockpit_call_agents TO service_role;
COMMENT ON TABLE public.cockpit_call_agents IS
 'Call agents and their numbers, from the DATABASE sheet tab "Agent Data". Add a row when that tab gains an agent.';

-- The Agent Data tab on 2026-10-13.
INSERT INTO public.cockpit_call_agents(agent_number,agent_name,active) VALUES
 (1,'Abdulaziz',true),(2,'Lama harb',true),(3,'Miriam Al Laham',true),(4,'Oways Sayour',true),
 (5,'Saleh Attal',true),(6,'Yasmin Ayoub',true),(7,'Daniya Ziad',true)
ON CONFLICT (agent_number) DO UPDATE SET agent_name=excluded.agent_name,active=excluded.active,updated_at=now();

-- The name for a GHL location that is not in ghl_clients. Never empty.
CREATE OR REPLACE FUNCTION public.cockpit_data_view_account_name(p_location text) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(
  (SELECT c.name FROM public.clients c WHERE c.ghl_location_id=p_location AND btrim(c.name)<>'' ORDER BY c.name LIMIT 1),
  (SELECT a.ghl_location FROM public.appointments a WHERE a.ghl_location_id=p_location
    AND btrim(a.ghl_location) NOT IN ('','Main') ORDER BY a.booked_at DESC LIMIT 1),
  'Unknown GHL account '||p_location);
$$;

-- A location the data view may scope to: a client, or any account that holds
-- leads or bookings.
CREATE OR REPLACE FUNCTION public.cockpit_data_view_known_location(p_location text) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.ghl_clients g WHERE g.location_id=p_location)
  OR EXISTS(SELECT 1 FROM public.clients c WHERE c.ghl_location_id=p_location)
  OR EXISTS(SELECT 1 FROM public.client_leads l WHERE l.location_id=p_location)
  OR EXISTS(SELECT 1 FROM public.appointments a WHERE a.ghl_location_id=p_location);
$$;

CREATE OR REPLACE FUNCTION public.cockpit_data_view_leads(p_location text,p_from timestamptz,p_key text,
 p_filter text,p_like text,p_digits text,p_exact text)
RETURNS TABLE(id text,location_id text,client text,created_at timestamptz,synced_at timestamptz,channel text,source text,
 ad_id text,adset_id text,campaign_id text,ad_name text,adset_name text,campaign_name text,utm_campaign text,
 name text,phone text,email text,deleted boolean,deleted_at timestamptz,utm_source text,utm_content text,utm_medium text,first_url text,
 meeting_id text,meeting_start timestamptz,meeting_status text,meeting_source text,meetings integer)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH ads AS (
  SELECT DISTINCT ON (d.data->>'metaAdId') d.data->>'metaAdId' AS ad_id, d.data->>'adName' AS ad_name,
   d.data->>'adSetName' AS adset_name, coalesce(d.data->>'campaignName',d.campaign_name) AS campaign_name
  FROM public.cockpit_media_daily_stats d WHERE d.data->>'metaAdId' IS NOT NULL
  ORDER BY d.data->>'metaAdId', d.day DESC
 ), r AS (
  SELECT l.ghl_contact_id AS id, l.location_id, coalesce(g.client_name,public.cockpit_data_view_account_name(l.location_id)) AS client,
   l.created_at, l.synced_at, l.channel, l.source_field AS source, l.ad_id, l.adset_id, l.campaign_id,
   ads.ad_name, ads.adset_name, ads.campaign_name, nullif(l.attribution_raw->>'utmCampaign','') AS utm_campaign,
   l.contact_name AS name, l.contact_phone AS phone, l.contact_email AS email, coalesce(l.deleted,false) AS deleted, l.deleted_at,
   nullif(l.attribution_raw->>'utmSource','') AS utm_source, nullif(l.attribution_raw->>'utmContent','') AS utm_content,
   nullif(l.attribution_raw->>'utmMedium','') AS utm_medium, nullif(l.attribution_raw->>'url','') AS first_url,
   m.ghl_appointment_id AS meeting_id, m.start_at AS meeting_start, m.status AS meeting_status, m.ghl_source AS meeting_source,
   coalesce(m.n,0)::integer AS meetings
  FROM public.client_leads l
  LEFT JOIN public.ghl_clients g ON g.location_id=l.location_id
  LEFT JOIN ads ON ads.ad_id=l.ad_id
  LEFT JOIN LATERAL (SELECT a.ghl_appointment_id,a.start_at,a.status,a.ghl_source,count(*) OVER () AS n
   FROM public.appointments a WHERE a.ghl_contact_id=l.ghl_contact_id
   ORDER BY a.booked_at DESC,a.ghl_appointment_id DESC LIMIT 1) m ON true
  WHERE (p_key IS NOT NULL AND l.ghl_contact_id=p_key)
   OR (p_key IS NULL AND l.created_at>=p_from AND (p_location IS NULL OR l.location_id=p_location))
 )
 SELECT * FROM r
 WHERE CASE coalesce(p_filter,'any')
   WHEN 'any' THEN true
   WHEN 'all' THEN NOT r.deleted
   WHEN 'meta' THEN NOT r.deleted AND r.channel='Meta'
   WHEN 'other' THEN NOT r.deleted AND r.channel IS DISTINCT FROM 'Meta'
   WHEN 'booked' THEN NOT r.deleted AND r.meeting_id IS NOT NULL
   WHEN 'no_ad' THEN NOT r.deleted AND r.channel='Meta' AND r.ad_id IS NULL
   WHEN 'deleted' THEN r.deleted
   ELSE false END
  AND (p_like IS NULL OR r.id=p_exact OR r.name ILIKE p_like OR r.client ILIKE p_like OR r.campaign_name ILIKE p_like
   OR r.ad_name ILIKE p_like OR r.utm_campaign ILIKE p_like OR r.ad_id=p_exact OR r.email ILIKE p_like
   OR (p_digits IS NOT NULL AND regexp_replace(coalesce(r.phone,''),'\D','','g') LIKE '%'||p_digits||'%'));
$$;

CREATE OR REPLACE FUNCTION public.cockpit_data_view_args(p_kind text,p_location text,p_filter text,p_search text,
 OUT like_pattern text,OUT digits text,OUT exact text)
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE q text:=nullif(btrim(coalesce(p_search,'')),'');
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('leads','appointments') THEN
  RAISE EXCEPTION 'Choose leads or appointments' USING ERRCODE='22023';END IF;
 IF p_kind='leads' AND coalesce(p_filter,'all') NOT IN ('all','meta','other','booked','no_ad','deleted') THEN
  RAISE EXCEPTION 'Unknown lead filter' USING ERRCODE='22023';END IF;
 IF p_kind='appointments' AND coalesce(p_filter,'all') NOT IN ('all','upcoming','showed','not_counted','no_result','calendar','twice') THEN
  RAISE EXCEPTION 'Unknown appointment filter' USING ERRCODE='22023';END IF;
 IF p_location IS NOT NULL AND NOT public.cockpit_data_view_known_location(p_location) THEN
  RAISE EXCEPTION 'Unknown client location' USING ERRCODE='22023';END IF;
 IF length(q)>100 THEN RAISE EXCEPTION 'Search is too long' USING ERRCODE='22023';END IF;
 IF q IS NOT NULL THEN
  like_pattern:='%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%';
  digits:=nullif(regexp_replace(q,'\D','','g'),'');
  IF length(digits)<4 THEN digits:=NULL;END IF;
  exact:=q;
 END IF;
END;$$;

CREATE OR REPLACE FUNCTION public.cockpit_data_view_summary(p_location text DEFAULT NULL,p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_days integer:=least(greatest(coalesce(p_days,30),1),92); v_from timestamptz; v_from_day date; v_today date;
 v_meta_last date; v_cmp_to date; v_clients jsonb; v_fresh jsonb; v_leads jsonb; v_appts jsonb; v_per jsonb; v_gaps jsonb;
 v_lineage jsonb; v_unmapped jsonb;
BEGIN
 PERFORM public.cockpit_data_view_actor();
 IF p_location IS NOT NULL AND NOT public.cockpit_data_view_known_location(p_location) THEN
  RAISE EXCEPTION 'Unknown client location' USING ERRCODE='22023';END IF;
 v_from:=public.cockpit_data_view_from(v_days);
 v_today:=(now() AT TIME ZONE 'Asia/Riyadh')::date;
 v_from_day:=v_today-(v_days-1);
 SELECT max(d.day) INTO v_meta_last FROM public.cockpit_media_daily_stats d;
 v_cmp_to:=least(v_today,coalesce(v_meta_last,v_from_day-1));

 -- The clients, then any GHL account with leads or bookings in the range that
 -- is not a client (Mahara's own accounts), so the picker can show it.
 SELECT coalesce(jsonb_agg(jsonb_build_object('location_id',c.location_id,'name',c.name,'status',c.status,'clickup_id',c.clickup_id)
   ORDER BY c.extra,(c.status IN ('Active','Launching','New Sign Up','Paused')) DESC,lower(c.name)),'[]'::jsonb)
  INTO v_clients FROM (
   SELECT g.location_id,g.client_name AS name,g.status,g.clickup_id,false AS extra FROM public.ghl_clients g
   UNION ALL
   SELECT x.location_id,public.cockpit_data_view_account_name(x.location_id),'Not a client',NULL,true
   FROM (SELECT l.location_id FROM public.client_leads l WHERE l.created_at>=v_from
    UNION SELECT a.ghl_location_id FROM public.appointments a WHERE a.booked_at>=v_from) x
   WHERE x.location_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ghl_clients g WHERE g.location_id=x.location_id)
  ) c;

 SELECT jsonb_build_object(
  'now',now(),
  'leads',(SELECT jsonb_build_object('newest',max(s.last_synced_at),'oldest',min(s.last_synced_at),'locations',count(*),
    'ok',count(*) FILTER (WHERE s.last_status='success'),
    'failing',coalesce(jsonb_agg(jsonb_build_object('location_id',s.location_id,'status',s.last_status,'error',s.last_error,'at',s.last_synced_at))
     FILTER (WHERE s.last_status IS DISTINCT FROM 'success'),'[]'::jsonb))
   FROM public.lead_sync_state s WHERE p_location IS NULL OR s.location_id=p_location),
  'appointments',(SELECT jsonb_build_object('newest',max(s.last_synced_at),'oldest',min(s.last_synced_at),'locations',count(*),
    'ok',count(*) FILTER (WHERE s.last_status='success'),
    'failing',coalesce(jsonb_agg(jsonb_build_object('location_id',s.location_id,'status',s.last_status,'at',s.last_synced_at))
     FILTER (WHERE s.last_status IS DISTINCT FROM 'success'),'[]'::jsonb))
   FROM public.appointment_sync_state s WHERE p_location IS NULL OR s.location_id=p_location),
  'meta_last_day',v_meta_last,
  'bookings_last_day',(SELECT max(e.day) FROM public.cockpit_media_booking_events e WHERE e.source_deployment='native:media'),
  'bookings_imported_at',(SELECT max(e.imported_at) FROM public.cockpit_media_booking_events e WHERE e.source_deployment='native:media'),
  'outcomes_last_at',(SELECT max(o.captured_at) FROM portal_data.appointment_outcomes o)
 ) INTO v_fresh;

 -- Per client: leads, appointments, Meta, and the days where leads went missing.
 WITH l AS (SELECT * FROM public.cockpit_data_view_leads(p_location,v_from,NULL,'any',NULL,NULL,NULL)),
 a AS (SELECT * FROM public.cockpit_data_view_appointments(p_location,v_from,NULL,'any',NULL,NULL,NULL)),
 camp AS (SELECT * FROM public.cockpit_data_view_campaign_locations()),
 meta AS (
  SELECT camp.location_id, d.day, sum(coalesce((d.data->>'leads')::numeric,0)) AS leads
  FROM public.cockpit_media_daily_stats d LEFT JOIN camp ON camp.campaign_name=d.campaign_name
  WHERE d.day BETWEEN v_from_day AND v_cmp_to AND (p_location IS NULL OR camp.location_id=p_location)
  GROUP BY 1,2
 ), ghl_meta AS (
  SELECT l.location_id, (l.created_at AT TIME ZONE 'Asia/Riyadh')::date AS day, count(*) AS leads
  FROM l WHERE NOT l.deleted AND l.channel='Meta' AND (l.created_at AT TIME ZONE 'Asia/Riyadh')::date<=v_cmp_to
  GROUP BY 1,2
 ), days AS (
  SELECT coalesce(m.location_id,gm.location_id) AS location_id, coalesce(m.day,gm.day) AS day,
   coalesce(m.leads,0) AS meta, coalesce(gm.leads,0) AS ghl
  FROM (SELECT * FROM meta WHERE meta.location_id IS NOT NULL) m
  FULL JOIN ghl_meta gm ON gm.location_id=m.location_id AND gm.day=m.day
 ), tracked AS (SELECT DISTINCT meta.location_id FROM meta WHERE meta.location_id IS NOT NULL),
 gaps AS (SELECT * FROM days WHERE days.meta-days.ghl>=3),
 locs AS (
  SELECT DISTINCT x.location_id FROM (SELECT l.location_id FROM l UNION SELECT a.location_id FROM a UNION SELECT days.location_id FROM days) x
  WHERE x.location_id IS NOT NULL
 ), lagg AS (
  SELECT l.location_id, count(*) FILTER (WHERE NOT l.deleted) AS leads,
   count(*) FILTER (WHERE NOT l.deleted AND l.channel='Meta') AS meta_leads,
   count(*) FILTER (WHERE NOT l.deleted AND l.channel='Meta' AND l.ad_id IS NULL) AS no_ad,
   count(*) FILTER (WHERE l.deleted) AS deleted
  FROM l GROUP BY 1
 ), aagg AS (
  SELECT a.location_id, count(*) AS appts,
   count(*) FILTER (WHERE a.cockpit IN ('counted','twice','by_day')) AS counted,
   count(*) FILTER (WHERE a.cockpit IN ('missing','missing_old')) AS not_counted,
   count(*) FILTER (WHERE a.cockpit='twice') AS twice,
   count(*) FILTER (WHERE a.cockpit='not_tracked') AS not_tracked,
   count(*) FILTER (WHERE a.ghl_source='google_calendar') AS calendar,
   count(*) FILTER (WHERE a.start_at<now() AND a.status='confirmed' AND a.ghl_source IS DISTINCT FROM 'google_calendar') AS no_result,
   count(*) FILTER (WHERE a.start_at<now() AND a.status IS DISTINCT FROM 'cancelled') AS passed,
   count(*) FILTER (WHERE a.status IN ('showed','noshow')) AS recorded,
   count(*) FILTER (WHERE a.status='showed') AS showed,
   count(*) FILTER (WHERE a.start_at>=now() AND a.status IS DISTINCT FROM 'cancelled') AS upcoming,
   count(*) FILTER (WHERE a.status='cancelled') AS cancelled,
   count(*) FILTER (WHERE a.deal='won') AS won
  FROM a GROUP BY 1
 ), dagg AS (
  SELECT days.location_id, sum(days.meta) AS meta_reported, sum(days.ghl) AS meta_received,
   sum(days.meta-days.ghl) FILTER (WHERE days.meta-days.ghl>=3) AS never_reached
  FROM days GROUP BY 1
 ), per AS (
  SELECT locs.location_id, coalesce(g.client_name,public.cockpit_data_view_account_name(locs.location_id)) AS client,
   coalesce(lagg.leads,0) AS leads, coalesce(lagg.meta_leads,0) AS meta_leads, coalesce(lagg.no_ad,0) AS no_ad,
   coalesce(lagg.deleted,0) AS deleted, EXISTS(SELECT 1 FROM tracked WHERE tracked.location_id=locs.location_id) AS meta_tracked,
   CASE WHEN EXISTS(SELECT 1 FROM tracked WHERE tracked.location_id=locs.location_id) THEN coalesce(dagg.meta_reported,0) END AS meta_reported,
   coalesce(dagg.meta_received,0) AS meta_received, coalesce(dagg.never_reached,0) AS never_reached,
   coalesce(aagg.appts,0) AS appts, coalesce(aagg.counted,0) AS counted, coalesce(aagg.not_counted,0) AS not_counted,
   coalesce(aagg.twice,0) AS twice, coalesce(aagg.not_tracked,0) AS not_tracked, coalesce(aagg.calendar,0) AS calendar,
   coalesce(aagg.no_result,0) AS no_result, coalesce(aagg.passed,0) AS passed, coalesce(aagg.recorded,0) AS recorded,
   coalesce(aagg.showed,0) AS showed, coalesce(aagg.upcoming,0) AS upcoming, coalesce(aagg.cancelled,0) AS cancelled,
   coalesce(aagg.won,0) AS won
  FROM locs LEFT JOIN public.ghl_clients g ON g.location_id=locs.location_id
  LEFT JOIN lagg ON lagg.location_id=locs.location_id LEFT JOIN aagg ON aagg.location_id=locs.location_id
  LEFT JOIN dagg ON dagg.location_id=locs.location_id
 )
 SELECT
  (SELECT coalesce(jsonb_agg(to_jsonb(per) ORDER BY per.leads DESC,per.appts DESC,lower(per.client)),'[]'::jsonb) FROM per),
  (SELECT coalesce(jsonb_agg(jsonb_build_object('location_id',gaps.location_id,'client',coalesce(g.client_name,public.cockpit_data_view_account_name(gaps.location_id)),
    'day',gaps.day,'meta',gaps.meta,'ghl',gaps.ghl) ORDER BY gaps.day DESC,gaps.meta-gaps.ghl DESC),'[]'::jsonb)
   FROM gaps LEFT JOIN public.ghl_clients g ON g.location_id=gaps.location_id),
  (SELECT jsonb_build_object('leads',coalesce(sum(meta.leads),0),
    'campaigns',(SELECT coalesce(jsonb_agg(DISTINCT d.campaign_name),'[]'::jsonb) FROM public.cockpit_media_daily_stats d
     LEFT JOIN camp ON camp.campaign_name=d.campaign_name WHERE d.day BETWEEN v_from_day AND v_cmp_to AND camp.location_id IS NULL))
   FROM meta WHERE meta.location_id IS NULL AND p_location IS NULL),
  (SELECT jsonb_build_object(
    'all',count(*) FILTER (WHERE NOT l.deleted),'meta',count(*) FILTER (WHERE NOT l.deleted AND l.channel='Meta'),
    'other',count(*) FILTER (WHERE NOT l.deleted AND l.channel IS DISTINCT FROM 'Meta'),
    'booked',count(*) FILTER (WHERE NOT l.deleted AND l.meeting_id IS NOT NULL),
    'no_ad',count(*) FILTER (WHERE NOT l.deleted AND l.channel='Meta' AND l.ad_id IS NULL),
    'deleted',count(*) FILTER (WHERE l.deleted)) FROM l),
  (SELECT jsonb_build_object(
    'all',count(*),'upcoming',count(*) FILTER (WHERE a.start_at>=now() AND a.status IS DISTINCT FROM 'cancelled'),
    'showed',count(*) FILTER (WHERE a.status='showed'),
    'not_counted',count(*) FILTER (WHERE a.cockpit IN ('missing','missing_old')),
    'no_result',count(*) FILTER (WHERE a.start_at<now() AND a.status='confirmed' AND a.ghl_source IS DISTINCT FROM 'google_calendar'),
    'calendar',count(*) FILTER (WHERE a.ghl_source='google_calendar'),
    'calendar_counted',count(*) FILTER (WHERE a.ghl_source='google_calendar' AND a.cockpit IN ('counted','twice','by_day')),
    'twice',count(*) FILTER (WHERE a.cockpit='twice'),
    'not_tracked',count(*) FILTER (WHERE a.cockpit='not_tracked'),
    'other_booking',count(*) FILTER (WHERE a.cockpit='other_booking'),
    'counted',count(*) FILTER (WHERE a.cockpit IN ('counted','twice','by_day')),
    'by_day',count(*) FILTER (WHERE a.cockpit='by_day'),
    'meta_leads',count(*) FILTER (WHERE a.lead_channel='Meta')) FROM a),
  (SELECT jsonb_build_object(
    'meta_reported',(SELECT coalesce(sum(days.meta),0) FROM days),
    'meta_received',(SELECT coalesce(sum(days.ghl),0) FROM days JOIN tracked ON tracked.location_id=days.location_id),
    'meta_received_untracked',(SELECT coalesce(sum(days.ghl),0) FROM days WHERE days.location_id NOT IN (SELECT tracked.location_id FROM tracked)),
    'tracked_clients',(SELECT count(*) FROM tracked),
    'never_reached',(SELECT coalesce(sum(gaps.meta-gaps.ghl),0) FROM gaps),
    'with_ad',(SELECT count(*) FROM l JOIN tracked ON tracked.location_id=l.location_id
      WHERE NOT l.deleted AND l.channel='Meta' AND l.ad_id IS NOT NULL AND (l.created_at AT TIME ZONE 'Asia/Riyadh')::date<=v_cmp_to),
    'appts',(SELECT count(*) FROM a),
    'cockpit_rows',(SELECT count(*) FROM public.cockpit_media_booking_events e LEFT JOIN camp ON camp.campaign_name=e.campaign_name
      WHERE e.day BETWEEN v_from_day AND v_today
       AND (p_location IS NULL OR coalesce(e.data->>'locationId',camp.location_id,
        (SELECT min(g.location_id) FROM public.ghl_clients g WHERE lower(btrim(g.client_name))=lower(btrim(e.data->>'client'))
         HAVING count(*)=1))=p_location)),
    'passed',(SELECT count(*) FROM a WHERE a.start_at<now() AND a.status IS DISTINCT FROM 'cancelled'),
    'recorded',(SELECT count(*) FROM a WHERE a.status IN ('showed','noshow')),
    'compare_to',v_cmp_to))
 INTO v_per,v_gaps,v_unmapped,v_leads,v_appts,v_lineage;

 RETURN jsonb_build_object('location_id',p_location,'days',v_days,'from_day',v_from_day,'to_day',v_today,
  'clients',v_clients,'freshness',v_fresh,'leads',v_leads,'appointments',v_appts,'lineage',v_lineage,
  'per_client',v_per,'gap_days',v_gaps,'meta_unmapped',v_unmapped);
END;$$;

DROP FUNCTION public.cockpit_data_view_appointments(text,timestamptz,text,text,text,text,text);

CREATE FUNCTION public.cockpit_data_view_appointments(p_location text, p_from timestamp with time zone, p_key text, p_filter text, p_like text, p_digits text, p_exact text)
 RETURNS TABLE(id text, contact_id text, location_id text, client text, booked_at timestamp with time zone, start_at timestamp with time zone, status text, ghl_source text, calendar text, name text, phone text, lead_found boolean, lead_channel text, lead_source text, lead_ad_name text, lead_campaign_name text, updated_at timestamp with time zone, deal text, quotation boolean, project_value numeric, currency text, feedback text, lead_quality numeric, not_closed_reason text, outcome_at timestamp with time zone, cockpit text, cockpit_at timestamp with time zone, cockpit_attribution text, notes text, agent text, agent_number text)
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
   coalesce(g.client_name,public.cockpit_data_view_account_name(a.ghl_location_id)) AS client, a.booked_at, a.start_at, a.status, a.ghl_source,
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
   n.attribution AS cockpit_attribution,
   nullif(btrim(pa.notes),'') AS notes, nullif(btrim(pa.assigned_agent),'') AS agent, ag.agent_number::text AS agent_number
  FROM a
  LEFT JOIN public.ghl_clients g ON g.location_id=a.ghl_location_id
  LEFT JOIN public.client_leads l ON l.ghl_contact_id=a.ghl_contact_id
  LEFT JOIN ads ON ads.ad_id=l.ad_id
  LEFT JOIN LATERAL (SELECT c.name FROM public.ghl_calendars c WHERE c.calendar_id=a.calendar_id ORDER BY c.location_id=a.ghl_location_id DESC LIMIT 1) cal ON true
  LEFT JOIN outc o ON o.appointment_id=a.ghl_appointment_id AND o.location_id=a.ghl_location_id
  LEFT JOIN portal_data.appointments pa ON pa.location_id=a.ghl_location_id AND pa.appointment_id=a.ghl_appointment_id
  LEFT JOIN public.cockpit_call_agents ag ON lower(btrim(ag.agent_name))=lower(btrim(pa.assigned_agent))
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

-- Internal helpers: no client role may call them directly (as in 20261011b).
REVOKE ALL ON FUNCTION public.cockpit_data_view_account_name(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_data_view_known_location(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_data_view_leads(text,timestamptz,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_data_view_appointments(text,timestamptz,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_data_view_args(text,text,text,text) FROM PUBLIC,anon,authenticated;
-- The page's entry point keeps its grant (as in 20261011b).
REVOKE ALL ON FUNCTION public.cockpit_data_view_summary(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_data_view_summary(text,integer) TO authenticated;

COMMIT;
