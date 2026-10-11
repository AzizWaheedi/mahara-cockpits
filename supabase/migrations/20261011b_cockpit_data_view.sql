-- Data view: every lead and appointment, admin only (Muhammed, 2026-10-11).
-- Plan: docs/superpowers/plans/2026-10-11-data-layers.md.
--
-- Read-only over the warehouse tables. No new tables. Two kinds of rows leave
-- an audit row: opening one record, and every CSV export.
--
-- Mapping rules, checked against production on 2026-10-11:
--  * A lead or appointment belongs to the client of its GHL location
--    (ghl_clients.location_id). Never client_id, never a name.
--  * A Meta campaign belongs to a location through its ad account:
--    cockpit_campaigns.meta_account_id -> clients.meta_ad_account_id ->
--    ghl_client_ad_accounts (or clients.ghl_location_id). A campaign whose
--    account maps to more than one location, or none, stays unmapped and is
--    reported, never dropped.
--  * Native booking events (source_deployment 'native:media') carry the GHL
--    appointment id. Convex-era events do not, so before the first native
--    day they match by location and booking day ("matched by day").
--  * From 2026-09-08 to 2026-09-27 both deployments recorded the same
--    bookings. A native event with a Convex-era twin (same campaign, day and
--    start date) is reported as "counted twice".
--  * Days are Riyadh days.

BEGIN;

CREATE INDEX IF NOT EXISTS appointments_ghl_contact_id_idx ON public.appointments (ghl_contact_id);

-- Gate: a confirmed active admin or founder. Returns the actor's email.
CREATE OR REPLACE FUNCTION public.cockpit_data_view_actor() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE access jsonb;
BEGIN
 access:=public.cockpit_get_my_access();
 IF NOT(coalesce((access->>'is_admin')::boolean,false) OR coalesce((access->>'is_ceo')::boolean,false)) THEN
  RAISE EXCEPTION 'Admin access required for the data view' USING ERRCODE='42501';
 END IF;
 RETURN access->>'email';
END;$$;

-- Start of the range: Riyadh midnight, p_days days back including today.
CREATE OR REPLACE FUNCTION public.cockpit_data_view_from(p_days integer) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT (((now() AT TIME ZONE 'Asia/Riyadh')::date - (least(greatest(coalesce(p_days,30),1),92)-1))::timestamp) AT TIME ZONE 'Asia/Riyadh';
$$;

-- Meta campaign name -> GHL location, through the ad account.
CREATE OR REPLACE FUNCTION public.cockpit_data_view_campaign_locations()
RETURNS TABLE(campaign_name text, location_id text)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH camp AS (
  SELECT DISTINCT ON (c.raw_data->>'campaignName') c.raw_data->>'campaignName' AS name,
   regexp_replace(c.meta_account_id,'^act_','') AS acct
  FROM public.cockpit_campaigns c WHERE c.raw_data->>'campaignName' IS NOT NULL
  ORDER BY c.raw_data->>'campaignName', c.source_deleted, c.synced_at DESC NULLS LAST
 ), acct AS (
  SELECT DISTINCT regexp_replace(cl.meta_ad_account_id,'^act_','') AS acct, coalesce(a.location_id,cl.ghl_location_id) AS location_id
  FROM public.clients cl LEFT JOIN public.ghl_client_ad_accounts a ON a.client_id=cl.id
  WHERE cl.meta_ad_account_id IS NOT NULL AND coalesce(a.location_id,cl.ghl_location_id) IS NOT NULL
 )
 SELECT camp.name, CASE WHEN count(DISTINCT acct.location_id)=1 THEN min(acct.location_id) END
 FROM camp LEFT JOIN acct ON acct.acct=camp.acct GROUP BY camp.name;
$$;

-- Leads with every Master Dashboard column the warehouse holds.
-- p_key, when set, selects one contact and ignores the range.
-- p_filter: any, all, meta, other, booked, no_ad, deleted.
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
  SELECT l.ghl_contact_id AS id, l.location_id, coalesce(g.client_name,'Location '||l.location_id) AS client,
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

-- Appointments with the Master Dashboard columns, the portal outcome, and
-- whether the media buyer cockpit counted the booking:
--  counted        native event with this appointment id
--  twice          counted, and a Convex-era copy of the same booking too
--  by_day         before native events began; a Convex-era event exists for
--                 the same client and booking day
--  missing_old    before native events began; Facebook lead, no event that day
--  missing        Facebook lead, no event, and the client has cockpit campaigns
--                 or booking events
--  other_booking  this contact's other booking was counted (a reschedule)
--  not_tracked    Facebook lead at a client with no cockpit campaign and no
--                 booking events
--  not_ad         not a Facebook lead; the cockpit does not count it
-- p_key, when set, selects one contact id or one appointment id.
-- p_filter: any, all, upcoming, showed, not_counted, no_result, calendar, twice.
CREATE OR REPLACE FUNCTION public.cockpit_data_view_appointments(p_location text,p_from timestamptz,p_key text,
 p_filter text,p_like text,p_digits text,p_exact text)
RETURNS TABLE(id text,contact_id text,location_id text,client text,booked_at timestamptz,start_at timestamptz,status text,
 ghl_source text,calendar text,name text,phone text,lead_found boolean,lead_channel text,lead_source text,lead_ad_name text,
 lead_campaign_name text,updated_at timestamptz,deal text,quotation boolean,project_value numeric,currency text,feedback text,
 lead_quality numeric,not_closed_reason text,outcome_at timestamptz,cockpit text,cockpit_at timestamptz)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH a AS (
  SELECT ap.*, (ap.booked_at AT TIME ZONE 'Asia/Riyadh')::date AS bday
  FROM public.appointments ap
  WHERE (p_key IS NOT NULL AND (ap.ghl_contact_id=p_key OR ap.ghl_appointment_id=p_key))
   OR (p_key IS NULL AND ap.booked_at>=p_from AND (p_location IS NULL OR ap.ghl_location_id=p_location))
 ), nat AS (
  SELECT e.data->>'eventId' AS event_id, e.data->>'contactId' AS contact_id, e.data->>'locationId' AS loc,
   e.campaign_name, e.day, left(coalesce(e.data->>'startTime',e.data->>'appointmentDate'),10) AS sd, e.imported_at
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
   n.imported_at AS cockpit_at
  FROM a
  LEFT JOIN public.ghl_clients g ON g.location_id=a.ghl_location_id
  LEFT JOIN public.client_leads l ON l.ghl_contact_id=a.ghl_contact_id
  LEFT JOIN ads ON ads.ad_id=l.ad_id
  LEFT JOIN LATERAL (SELECT c.name FROM public.ghl_calendars c WHERE c.calendar_id=a.calendar_id ORDER BY c.location_id=a.ghl_location_id DESC LIMIT 1) cal ON true
  LEFT JOIN outc o ON o.appointment_id=a.ghl_appointment_id AND o.location_id=a.ghl_location_id
  LEFT JOIN (SELECT DISTINCT ON (nat.event_id) nat.event_id,nat.imported_at FROM nat WHERE nat.event_id IS NOT NULL ORDER BY nat.event_id,nat.imported_at) n
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
$$;

-- Shared argument checks for rows and export. Returns the normalized search
-- pieces: like pattern, digits, exact id.
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
 IF p_location IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ghl_clients g WHERE g.location_id=p_location) THEN
  RAISE EXCEPTION 'Unknown client location' USING ERRCODE='22023';END IF;
 IF length(q)>100 THEN RAISE EXCEPTION 'Search is too long' USING ERRCODE='22023';END IF;
 IF q IS NOT NULL THEN
  like_pattern:='%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%';
  digits:=nullif(regexp_replace(q,'\D','','g'),'');
  IF length(digits)<4 THEN digits:=NULL;END IF;
  exact:=q;
 END IF;
END;$$;

-- One page of rows, newest first. Cursor is "<timestamp>|<id>" from next_cursor.
CREATE OR REPLACE FUNCTION public.cockpit_data_view_rows(p_kind text,p_location text DEFAULT NULL,p_days integer DEFAULT 30,
 p_filter text DEFAULT 'all',p_search text DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE args record; v_from timestamptz; v_limit integer; c_t timestamptz; c_id text; v_total bigint; v_rows jsonb; v_next text;
BEGIN
 PERFORM public.cockpit_data_view_actor();
 SELECT * INTO args FROM public.cockpit_data_view_args(p_kind,p_location,p_filter,p_search);
 v_from:=public.cockpit_data_view_from(p_days);
 v_limit:=least(greatest(coalesce(p_limit,100),1),200);
 IF p_cursor IS NOT NULL THEN
  BEGIN
   c_t:=split_part(p_cursor,'|',1)::timestamptz; c_id:=substr(p_cursor,position('|' IN p_cursor)+1);
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid page cursor' USING ERRCODE='22023';
  END;
 END IF;
 IF p_kind='leads' THEN
  WITH r AS (SELECT * FROM public.cockpit_data_view_leads(p_location,v_from,NULL,coalesce(p_filter,'all'),args.like_pattern,args.digits,args.exact)),
  page AS (SELECT * FROM r WHERE c_t IS NULL OR (r.created_at,r.id)<(c_t,c_id) ORDER BY r.created_at DESC,r.id DESC LIMIT v_limit+1)
  SELECT (SELECT count(*) FROM r),
   (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC,p.id DESC),'[]'::jsonb) FROM (SELECT * FROM page ORDER BY page.created_at DESC,page.id DESC LIMIT v_limit) p),
   (SELECT p.created_at::text||'|'||p.id FROM (SELECT * FROM page ORDER BY page.created_at DESC,page.id DESC OFFSET v_limit-1 LIMIT 1) p WHERE (SELECT count(*) FROM page)>v_limit)
  INTO v_total,v_rows,v_next;
 ELSE
  WITH r AS (SELECT * FROM public.cockpit_data_view_appointments(p_location,v_from,NULL,coalesce(p_filter,'all'),args.like_pattern,args.digits,args.exact)),
  page AS (SELECT * FROM r WHERE c_t IS NULL OR (r.booked_at,r.id)<(c_t,c_id) ORDER BY r.booked_at DESC,r.id DESC LIMIT v_limit+1)
  SELECT (SELECT count(*) FROM r),
   (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.booked_at DESC,p.id DESC),'[]'::jsonb) FROM (SELECT * FROM page ORDER BY page.booked_at DESC,page.id DESC LIMIT v_limit) p),
   (SELECT p.booked_at::text||'|'||p.id FROM (SELECT * FROM page ORDER BY page.booked_at DESC,page.id DESC OFFSET v_limit-1 LIMIT 1) p WHERE (SELECT count(*) FROM page)>v_limit)
  INTO v_total,v_rows,v_next;
 END IF;
 RETURN jsonb_build_object('kind',p_kind,'total',v_total,'rows',v_rows,'next_cursor',v_next);
END;$$;

-- CSV source: up to 5,000 rows with the same filter. One audit row per call.
CREATE OR REPLACE FUNCTION public.cockpit_data_view_export(p_kind text,p_location text DEFAULT NULL,p_days integer DEFAULT 30,
 p_filter text DEFAULT 'all',p_search text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text; args record; v_from timestamptz; v_total bigint; v_rows jsonb;
BEGIN
 actor:=public.cockpit_data_view_actor();
 SELECT * INTO args FROM public.cockpit_data_view_args(p_kind,p_location,p_filter,p_search);
 v_from:=public.cockpit_data_view_from(p_days);
 IF p_kind='leads' THEN
  WITH r AS (SELECT * FROM public.cockpit_data_view_leads(p_location,v_from,NULL,coalesce(p_filter,'all'),args.like_pattern,args.digits,args.exact))
  SELECT (SELECT count(*) FROM r),
   (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC,p.id DESC),'[]'::jsonb) FROM (SELECT * FROM r ORDER BY r.created_at DESC,r.id DESC LIMIT 5000) p)
  INTO v_total,v_rows;
 ELSE
  WITH r AS (SELECT * FROM public.cockpit_data_view_appointments(p_location,v_from,NULL,coalesce(p_filter,'all'),args.like_pattern,args.digits,args.exact))
  SELECT (SELECT count(*) FROM r),
   (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.booked_at DESC,p.id DESC),'[]'::jsonb) FROM (SELECT * FROM r ORDER BY r.booked_at DESC,r.id DESC LIMIT 5000) p)
  INTO v_total,v_rows;
 END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata)
 VALUES('data_view.export',p_kind,coalesce(p_location,'all'),actor,'media-buyer','supabase',
  jsonb_build_object('days',least(greatest(coalesce(p_days,30),1),92),'filter',coalesce(p_filter,'all'),
   'search',nullif(btrim(coalesce(p_search,'')),''),'rows',jsonb_array_length(v_rows),'total',v_total));
 RETURN jsonb_build_object('kind',p_kind,'total',v_total,'rows',v_rows,'truncated',v_total>5000);
END;$$;

-- One person's full trail: the lead, every appointment, and the raw source
-- rows. p_id is a contact id or an appointment id. One audit row per call.
CREATE OR REPLACE FUNCTION public.cockpit_data_view_record(p_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text; v_contact text; v_loc text; v_lead jsonb; v_appts jsonb; v_raw jsonb; v_sync jsonb;
BEGIN
 actor:=public.cockpit_data_view_actor();
 IF p_id IS NULL OR length(p_id) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Choose a record' USING ERRCODE='22023';END IF;
 SELECT l.ghl_contact_id,l.location_id INTO v_contact,v_loc FROM public.client_leads l WHERE l.ghl_contact_id=p_id;
 IF v_contact IS NULL THEN
  SELECT a.ghl_contact_id,a.ghl_location_id INTO v_contact,v_loc FROM public.appointments a WHERE a.ghl_appointment_id=p_id;
  IF v_loc IS NULL THEN RAISE EXCEPTION 'Record not found' USING ERRCODE='P0002';END IF;
 END IF;
 SELECT to_jsonb(r) INTO v_lead FROM public.cockpit_data_view_leads(NULL,NULL,v_contact,'any',NULL,NULL,NULL) r;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.booked_at),'[]'::jsonb) INTO v_appts
  FROM public.cockpit_data_view_appointments(NULL,NULL,coalesce(v_contact,p_id),'any',NULL,NULL,NULL) r;
 v_raw:=jsonb_build_object(
  'client_lead',(SELECT to_jsonb(l) FROM public.client_leads l WHERE l.ghl_contact_id=v_contact),
  'appointments',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.booked_at),'[]'::jsonb) FROM public.appointments a
   WHERE a.ghl_contact_id=v_contact OR a.ghl_appointment_id=p_id),
  'booking_events',(SELECT coalesce(jsonb_agg(jsonb_build_object('source_deployment',e.source_deployment,'source_id',e.source_id,
    'campaign_name',e.campaign_name,'day',e.day,'imported_at',e.imported_at,'data',e.data) ORDER BY e.day),'[]'::jsonb)
   FROM public.cockpit_media_booking_events e WHERE e.source_deployment='native:media' AND (e.data->>'contactId'=v_contact OR e.data->>'eventId'=p_id)));
 SELECT jsonb_build_object('leads_synced_at',(SELECT s.last_synced_at FROM public.lead_sync_state s WHERE s.location_id=v_loc),
  'appointments_synced_at',(SELECT s.last_synced_at FROM public.appointment_sync_state s WHERE s.location_id=v_loc)) INTO v_sync;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata)
 VALUES('data_view.record',CASE WHEN v_contact=p_id THEN 'client_lead' ELSE 'appointment' END,p_id,actor,'media-buyer','supabase',
  jsonb_build_object('location_id',v_loc));
 RETURN jsonb_build_object('id',p_id,'contact_id',v_contact,'location_id',v_loc,'lead',v_lead,'appointments',v_appts,'raw',v_raw,'sync',v_sync);
END;$$;

-- Everything the overview and the compare tab need, in one call.
CREATE OR REPLACE FUNCTION public.cockpit_data_view_summary(p_location text DEFAULT NULL,p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_days integer:=least(greatest(coalesce(p_days,30),1),92); v_from timestamptz; v_from_day date; v_today date;
 v_meta_last date; v_cmp_to date; v_clients jsonb; v_fresh jsonb; v_leads jsonb; v_appts jsonb; v_per jsonb; v_gaps jsonb;
 v_lineage jsonb; v_unmapped jsonb;
BEGIN
 PERFORM public.cockpit_data_view_actor();
 IF p_location IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ghl_clients g WHERE g.location_id=p_location) THEN
  RAISE EXCEPTION 'Unknown client location' USING ERRCODE='22023';END IF;
 v_from:=public.cockpit_data_view_from(v_days);
 v_today:=(now() AT TIME ZONE 'Asia/Riyadh')::date;
 v_from_day:=v_today-(v_days-1);
 SELECT max(d.day) INTO v_meta_last FROM public.cockpit_media_daily_stats d;
 v_cmp_to:=least(v_today,coalesce(v_meta_last,v_from_day-1));

 SELECT coalesce(jsonb_agg(jsonb_build_object('location_id',g.location_id,'name',g.client_name,'status',g.status,'clickup_id',g.clickup_id)
   ORDER BY (g.status IN ('Active','Launching','New Sign Up','Paused')) DESC,lower(g.client_name)),'[]'::jsonb)
  INTO v_clients FROM public.ghl_clients g;

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
  SELECT locs.location_id, coalesce(g.client_name,'Location '||locs.location_id) AS client,
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
  (SELECT coalesce(jsonb_agg(jsonb_build_object('location_id',gaps.location_id,'client',coalesce(g.client_name,'Location '||gaps.location_id),
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

REVOKE ALL ON FUNCTION public.cockpit_data_view_actor() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_data_view_from(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_data_view_campaign_locations() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_data_view_leads(text,timestamptz,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_data_view_appointments(text,timestamptz,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_data_view_args(text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_data_view_rows(text,text,integer,text,text,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_data_view_export(text,text,integer,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_data_view_record(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_data_view_summary(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_data_view_rows(text,text,integer,text,text,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_data_view_export(text,text,integer,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_data_view_record(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_data_view_summary(text,integer) TO authenticated;

COMMIT;
