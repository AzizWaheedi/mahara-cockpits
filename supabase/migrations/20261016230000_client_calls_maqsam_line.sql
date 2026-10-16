-- Call centre per client: leads contacted is a Maqsam call (2026-10-16,
-- Creative Triage bldgtotkfmhoxmlzowdx).
--
-- The CEO, 2026-10-16: "check the numbers and even make it better and more
-- accurate the data and tell me all sources of truth". The second-source check
-- (docs/client-performance/SOURCES.md, "Leads contacted (the 90% line)") found
-- that a saved dialer outcome with no Maqsam call counted as contact. The
-- Client Performance board now judges the call centre's 90% line on leads
-- with a real Maqsam call (20261016210000, 20261016220000). Six clients passed
-- 90% only through outcome-only touches, almost all on one caller: City Wood
-- 95% touched against 57% called (42 and 25 of 44), Marble and more 100%
-- against 76%, شركة العلا 95% against 80%, mergestudio 94% against 81%,
-- Arcturus 99% against 89%, Khalida 100% against 57%.
--
-- The per-client Calls view in the client success and media buyer cockpits
-- still read the looser share, so City Wood read 57% on the board and 95% on
-- its client page. cockpit_client_calls' waiting now also returns:
--   called       callable leads (dialable, older than one working hour) with
--                an outbound Maqsam call to the contact after it arrived, or
--                an outbound call to the same phone under another lead: the
--                board's verified_called_30d rule;
--   outcomeOnly  callable leads touched only by a saved dialer outcome, with
--                no such call (touched = called + outcomeOnly).
-- The pages judge the 90% line on called / callable and say the outcome-only
-- leads beside it. touched, callable and untouched are unchanged, and so is
-- the waiting list: a lead with a saved outcome is still not listed as
-- waiting. Every other key and note stays as 20261015200000 left it.
--
-- Rollback: re-run cockpit_client_calls, its grants and its comment from
-- 20261015200000_cockpit_client_calls_whatsapp_chats.sql (the readers fall back
-- to the touched share when called is missing).

BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.cockpit_client_calls(p_key text,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_today date:=(now() AT TIME ZONE 'Asia/Kuwait')::date;
 v_now timestamptz:=now();
 v_email text; v_client jsonb; v_loc text;
 v_start timestamptz; v_end timestamptz; v_since timestamptz;
 v_report jsonb; v_report_error text; v_official jsonb;
 v_assigned jsonb; v_other jsonb; v_scheds jsonb; v_hours text:='schedule';
 v_dialer_on boolean;
 v_main jsonb; v_notes jsonb:='[]'::jsonb;
 -- 10:00 to 18:00 Kuwait time, Friday off: both callers' Team & Payroll hours
 -- on 2026-10-13, used only when no assigned caller has a readable schedule.
 v_default jsonb:='{"timezone":"Asia/Kuwait","exceptions":[],"week":{
   "sun":{"on":true,"start":"10:00","end":"18:00"},"mon":{"on":true,"start":"10:00","end":"18:00"},
   "tue":{"on":true,"start":"10:00","end":"18:00"},"wed":{"on":true,"start":"10:00","end":"18:00"},
   "thu":{"on":true,"start":"10:00","end":"18:00"},"fri":{"on":false,"start":"10:00","end":"18:00"},
   "sat":{"on":true,"start":"10:00","end":"18:00"}}}';
BEGIN
 v_email:=public.cockpit_call_centre_seat();
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>92 OR p_to>v_today THEN
  RAISE EXCEPTION 'Choose dates up to today, covering at most 93 days.' USING ERRCODE='22023';
 END IF;
 v_client:=public.cockpit_call_centre_client(p_key);
 IF NOT public.cockpit_client_allowed(v_client->>'name') THEN
  RAISE EXCEPTION 'This client is not on your cockpit seat. Ask the CEO to add it.' USING ERRCODE='42501';
 END IF;
 v_loc:=v_client->>'locationId';
 v_start:=p_from::timestamp AT TIME ZONE 'Asia/Kuwait';
 v_end:=least((p_to+1)::timestamp AT TIME ZONE 'Asia/Kuwait',v_now);
 v_since:=v_start-interval '180 days';

 -- The official headline: the dialer's report for this client alone.
 BEGIN
  v_report:=public.mahara_call_center_report(p_from,p_to,NULL,v_loc);
 EXCEPTION WHEN OTHERS THEN
  v_report:=NULL; v_report_error:=left(SQLERRM,300);
 END;
 SELECT c INTO v_official FROM jsonb_array_elements(coalesce(v_report->'clients','[]'::jsonb)) c
 WHERE c->>'id'=v_loc LIMIT 1;

 -- The assigned callers: the dialer's active assignments that hold this
 -- location (mahara_console.metadata 'access:agent:<email>'), kept when the
 -- dialer's own account says agent (identity:account role), or, with no
 -- dialer account, when Team & Payroll says call centre agent. Admin seats
 -- hold assignments to see the queue; they are listed apart, never as callers.
 SELECT
  coalesce(jsonb_agg(jsonb_build_object('email',x.email,'name',x.name) ORDER BY x.name) FILTER (WHERE x.agent),'[]'::jsonb),
  coalesce(jsonb_agg(jsonb_build_object('email',x.email,'name',x.name,'why',x.why) ORDER BY x.name) FILTER (WHERE NOT x.agent),'[]'::jsonb),
  coalesce(jsonb_agg(x.schedule) FILTER (WHERE x.agent AND x.schedule_ok),'[]'::jsonb)
 INTO v_assigned,v_other,v_scheds
 FROM (
  SELECT a.email, coalesce(nullif(btrim(pp.name),''),a.email) AS name, cp.schedule,
   cp.schedule IS NOT NULL AND mahara_reporting.cc_window(cp.schedule,v_today) IS NOT NULL AS schedule_ok,
   CASE WHEN i.id IS NOT NULL THEN coalesce(i.data->>'role'='agent' AND i.data->>'enabled'='true',false)
        ELSE coalesce(pp.role ~* '^call cent(re|er) agent' AND pp.active,false) END AS agent,
   CASE WHEN i.data->>'role'='admin' THEN 'Dialer admin, not a caller'
        WHEN i.id IS NOT NULL AND i.data->>'enabled' IS DISTINCT FROM 'true' THEN 'Dialer account switched off'
        ELSE 'Not a call centre agent' END AS why
  FROM (SELECT DISTINCT lower(btrim(m.data->>'email')) AS email FROM mahara_console.metadata m
        WHERE m.namespace='production' AND m.id LIKE 'access:agent:%' AND m.data->>'active'='true'
          AND jsonb_typeof(m.data->'locationIds')='array' AND m.data->'locationIds' ? v_loc
          AND nullif(btrim(m.data->>'email'),'') IS NOT NULL) a
  LEFT JOIN mahara_console.metadata i ON i.namespace='production' AND i.id='identity:account:'||a.email
  LEFT JOIN mahara_reporting.cc_people cp ON cp.email=a.email
  LEFT JOIN LATERAL (SELECT p.name,p.role,p.active FROM public.cockpit_people p WHERE lower(btrim(p.email))=a.email
                     ORDER BY p.active DESC,p.id DESC LIMIT 1) pp ON true
 ) x;
 IF jsonb_array_length(v_scheds)=0 THEN v_scheds:=jsonb_build_array(v_default); v_hours:='default'; END IF;
 SELECT coalesce((m.data->>'active')<>'false',true) INTO v_dialer_on FROM mahara_console.metadata m
 WHERE m.namespace='production' AND m.id='access:client:'||v_loc;
 v_dialer_on:=coalesce(v_dialer_on,true);

 WITH
 client_leads_all AS MATERIALIZED (
  SELECT l.contact_id,l.created_at,l.phone FROM mahara_reporting.cc_leads l WHERE l.location_id=v_loc),
 client_phones AS MATERIALIZED (SELECT DISTINCT phone FROM client_leads_all WHERE phone IS NOT NULL),
 calls AS MATERIALIZED (
  SELECT c.id,c.started_at,c.agent,c.data->>'type' AS type,c.data->>'state' AS state,c.duration,c.conflict,
   c.location_id,c.contact_id,c.attribution,mahara_reporting.cc_phone(c.data->>'phone') AS phone
  FROM mahara_reporting.cc_calls c WHERE c.started_at>=v_since),
 -- This client's calls, and calls to its leads' phones that the link rule
 -- could not give to one lead (a phone shared by two leads).
 ccalls AS MATERIALIZED (
  SELECT * FROM calls c WHERE c.location_id=v_loc OR c.phone IN (SELECT phone FROM client_phones)),
 vc AS MATERIALIZED (
  SELECT * FROM ccalls c WHERE c.location_id=v_loc AND c.type='outbound' AND NOT c.conflict AND c.agent IS NOT NULL),
 att AS MATERIALIZED (
  SELECT a.id,a.agent,a.contact_id,a.call_id,a.outcome_at,
   a.data->'disposition'->>'outcome' AS outcome,a.data->'disposition'->>'reason' AS reason,
   a.data->'disposition'->>'note' AS note,a.data->>'mode' AS mode,a.data->>'leadName' AS lead_name,
   mahara_reporting.cc_time(nullif(a.data->>'scheduledCallbackAt','0')) AS callback_at
  FROM mahara_reporting.cc_attempts a
  WHERE a.location_id=v_loc AND NOT public.cockpit_call_centre_is_test(a.data)),
 latest AS MATERIALIZED (
  SELECT DISTINCT ON (a.contact_id) a.* FROM att a WHERE a.outcome_at IS NOT NULL AND a.contact_id IS NOT NULL
  ORDER BY a.contact_id,a.outcome_at DESC,a.id),
 appts AS MATERIALIZED (
  SELECT a.contact_id,a.booked_at,a.booking_kind FROM mahara_reporting.cc_appointments a
  WHERE a.location_id=v_loc AND NOT a.conflict AND a.status IS DISTINCT FROM 'deleted'
    AND a.booking_kind IN ('confirmed','provisional') AND a.booked_at IS NOT NULL),
 -- A WhatsApp chat is a contact who wrote to the client's WhatsApp and came
 -- from no ad: GoHighLevel tags it "inbound whatsapp". It is not a lead for the
 -- call centre, so every figure worked out here leaves it out.
 cohort_all AS MATERIALIZED (
  SELECT l.contact_id,l.created_at,l.phone,
   nullif(btrim(coalesce(cl.contact_phone,f.data->>'phone')),'') AS raw_phone,
   nullif(cl.ad_id,'') AS ad_id,nullif(cl.campaign_id,'') AS campaign_id,cl.channel,
   cl.ghl_contact_id IS NOT NULL AS in_client_leads,
   (nullif(cl.ad_id,'') IS NULL AND nullif(cl.campaign_id,'') IS NULL
    AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.data->'tags')='array'
                 THEN f.data->'tags' ELSE '[]'::jsonb END) t(x) WHERE lower(btrim(t.x))='inbound whatsapp')) AS chat
  FROM client_leads_all l
  LEFT JOIN public.client_leads cl ON cl.ghl_contact_id=l.contact_id AND cl.location_id=v_loc
  LEFT JOIN mahara_reporting.facts f ON f.namespace='production' AND f.source='ghl' AND f.kind='contact'
   AND f.external_id=v_loc||':'||l.contact_id
  WHERE l.created_at>=v_start AND l.created_at<v_end),
 cohort AS MATERIALIZED (SELECT * FROM cohort_all WHERE NOT chat),
 chats AS (
  SELECT count(*) AS n,
   count(*) FILTER (WHERE EXISTS (SELECT 1 FROM vc v WHERE v.contact_id=c.contact_id AND v.started_at>=c.created_at)) AS called
  FROM cohort_all c WHERE c.chat),
 lead_calls AS (
  SELECT c.contact_id,count(*) AS dials,min(v.started_at) AS first_at,
   bool_or(v.state='completed' AND v.duration>0) AS reached,
   bool_or(v.state='completed' AND v.duration>=30) AS t30,
   bool_or(v.state='completed' AND v.duration>=120) AS t120,
   count(*) FILTER (WHERE v.started_at<c.created_at+interval '72 hours') AS d72,
   bool_or(v.state='completed' AND v.duration>0 AND v.started_at<c.created_at+interval '72 hours') AS r72
  FROM cohort c JOIN vc v ON v.contact_id=c.contact_id AND v.started_at>=c.created_at
  GROUP BY c.contact_id),
 elsewhere AS (
  SELECT DISTINCT c.contact_id FROM cohort c
  JOIN ccalls x ON x.phone=c.phone AND x.type='outbound' AND x.started_at>=c.created_at
  WHERE NOT (x.location_id IS NOT DISTINCT FROM v_loc AND x.contact_id IS NOT DISTINCT FROM c.contact_id)),
 attempted AS (SELECT DISTINCT a.contact_id FROM att a WHERE a.contact_id IS NOT NULL),
 booked AS (
  SELECT c.contact_id,bool_or(a.booking_kind='confirmed') AS confirmed
  FROM cohort c JOIN appts a ON a.contact_id=c.contact_id AND a.booked_at>=c.created_at
  GROUP BY c.contact_id),
 leads AS MATERIALIZED (
  SELECT c.*,coalesce(k.dials,0)::int AS dials,k.first_at,
   coalesce(k.reached,false) AS reached,coalesce(k.t30,false) AS t30,coalesce(k.t120,false) AS t120,
   coalesce(k.d72,0)::int AS d72,coalesce(k.r72,false) AS r72,
   e.contact_id IS NOT NULL AS elsewhere,t.contact_id IS NOT NULL AS attempted,
   b.contact_id IS NOT NULL AS booked,coalesce(b.confirmed,false) AS confirmed,
   coalesce(c.phone ~ '^(966|965|971|974)',false) AS dialable,
   EXISTS (SELECT 1 FROM jsonb_array_elements(v_scheds) s(x)
    CROSS JOIN LATERAL (SELECT mahara_reporting.cc_window(s.x,mahara_reporting.cc_day(s.x,c.created_at)) AS w) z
    WHERE z.w IS NOT NULL AND NOT lower_inf(z.w) AND z.w @> c.created_at) AS in_hours,
   -- Older than one working hour. Four calendar days always hold one.
   (c.created_at<=v_now-interval '4 days' OR coalesce((SELECT bool_or(mahara_reporting.cc_work_seconds(s.x,c.created_at,v_now)>=3600)
     FROM jsonb_array_elements(v_scheds) s(x)),false)) AS aged
  FROM cohort c
  LEFT JOIN lead_calls k ON k.contact_id=c.contact_id
  LEFT JOIN elsewhere e ON e.contact_id=c.contact_id
  LEFT JOIN attempted t ON t.contact_id=c.contact_id
  LEFT JOIN booked b ON b.contact_id=c.contact_id),
 untouched AS (
  SELECT * FROM leads WHERE dialable AND aged AND dials=0 AND NOT elsewhere AND NOT attempted),
 lost AS MATERIALIZED (
  SELECT l.*,public.cockpit_call_centre_lost_key(l.reason,l.note) AS key
  FROM latest l WHERE l.outcome='LOST' AND l.outcome_at>=v_start AND l.outcome_at<v_end),
 lost_calls AS (
  SELECT l.contact_id,count(v.id)::int AS calls,max(v.duration) FILTER (WHERE v.state='completed') AS longest,
   (array_agg(v.id ORDER BY v.duration DESC,v.started_at DESC) FILTER (WHERE v.state='completed' AND v.duration>0))[1] AS longest_id,
   coalesce(bool_or(v.state='completed' AND v.duration>0),false) AS connected
  FROM lost l LEFT JOIN vc v ON v.contact_id=l.contact_id AND v.started_at<=l.outcome_at
  GROUP BY l.contact_id),
 ads AS MATERIALIZED (
  SELECT DISTINCT ON (d.data->>'metaAdId') d.data->>'metaAdId' AS ad_id,nullif(btrim(d.data->>'adName'),'') AS ad_name,
   nullif(btrim(coalesce(d.data->>'campaignName',d.campaign_name)),'') AS campaign_name
  FROM public.cockpit_media_daily_stats d
  WHERE d.data->>'metaAdId' IN (SELECT ad_id FROM leads WHERE ad_id IS NOT NULL
                                UNION SELECT cl.ad_id FROM lost x JOIN public.client_leads cl ON cl.ghl_contact_id=x.contact_id WHERE cl.ad_id IS NOT NULL)
  ORDER BY d.data->>'metaAdId',d.day DESC),
 grains AS (
  SELECT GROUPING(l.ad_id) AS g_ad,GROUPING(l.campaign_id) AS g_camp,l.ad_id,l.campaign_id,
   max(a.ad_name) AS ad_name,
   (array_agg(a.campaign_name ORDER BY l.created_at DESC) FILTER (WHERE a.campaign_name IS NOT NULL))[1] AS campaign_name,
   (array_agg(l.campaign_id ORDER BY l.created_at DESC) FILTER (WHERE l.campaign_id IS NOT NULL))[1] AS last_campaign,
   count(*) AS leads,count(*) FILTER (WHERE l.dials>0) AS called,coalesce(sum(l.dials),0) AS dials,
   count(*) FILTER (WHERE l.reached) AS reached,count(*) FILTER (WHERE l.t30) AS talked30,
   count(*) FILTER (WHERE l.t120) AS talked120,count(*) FILTER (WHERE l.booked) AS booked,
   count(*) FILTER (WHERE l.confirmed) AS confirmed,
   round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM l.first_at-l.created_at)) FILTER (WHERE l.first_at IS NOT NULL))::numeric) AS median_first
  FROM leads l LEFT JOIN ads a ON a.ad_id=l.ad_id
  GROUP BY GROUPING SETS ((l.ad_id),(l.campaign_id),())),
 grain_json AS (
  SELECT g_ad,g_camp,ad_id,campaign_id,jsonb_build_object(
   'id',CASE WHEN g_ad=0 THEN ad_id WHEN g_camp=0 THEN campaign_id END,
   'name',CASE WHEN g_ad=0 THEN ad_name WHEN g_camp=0 THEN campaign_name END,
   'campaignId',CASE WHEN g_ad=0 THEN last_campaign END,
   'campaignName',CASE WHEN g_ad=0 THEN campaign_name END,
   'leads',leads,'called',called,'dials',dials,'reached',reached,'talked30',talked30,'talked120',talked120,
   'booked',booked,'confirmed',confirmed,'medianFirstCallSeconds',median_first) AS j
  FROM grains),
 missed AS (
  SELECT m.id,m.started_at,m.phone,
   (SELECT min(o.started_at) FROM ccalls o WHERE o.phone=m.phone AND o.type='outbound' AND o.started_at>m.started_at) AS back_at
  FROM ccalls m
  WHERE m.type='inbound' AND m.state IN ('abandoned','missed','no_answer','unanswered')
    AND m.phone IS NOT NULL AND m.started_at>=v_start AND m.started_at<v_end),
 callbacks AS (
  SELECT l.contact_id,l.callback_at,
   greatest(l.outcome_at,(SELECT max(v.started_at) FROM vc v WHERE v.contact_id=l.contact_id)) AS last_touch
  FROM latest l WHERE l.outcome='CALLBACK'),
 stages AS (
  SELECT p.stage_name,min(p.position) AS position,count(*) AS n,
   round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM v_now-coalesce(o.last_stage_change_at,o.created_at))/86400))::numeric,1) AS median_days,
   round((max(extract(epoch FROM v_now-coalesce(o.last_stage_change_at,o.created_at)))/86400)::numeric,1) AS oldest_days,
   count(*) FILTER (WHERE v_now-coalesce(o.last_stage_change_at,o.created_at)>interval '7 days') AS over_week
  FROM public.client_opportunities o
  JOIN public.ghl_pipelines p ON p.location_id=o.location_id AND p.stage_id=o.stage_id
  WHERE o.location_id=v_loc AND o.status='open' AND p.pipeline_name ILIKE 'new leads%'
  GROUP BY p.stage_name)
 SELECT jsonb_build_object(
  'cohort',(SELECT jsonb_build_object('leads',count(*),'called',count(*) FILTER (WHERE dials>0),'dials',coalesce(sum(dials),0),
    'reached',count(*) FILTER (WHERE reached),'talked30',count(*) FILTER (WHERE t30),'talked120',count(*) FILTER (WHERE t120),
    'booked',count(*) FILTER (WHERE booked),'confirmed',count(*) FILTER (WHERE confirmed)) FROM leads),
  'window',(SELECT jsonb_build_object('dials',count(*),
    'reached',count(*) FILTER (WHERE state='completed' AND duration>0),
    'talked30',count(*) FILTER (WHERE state='completed' AND duration>=30),
    'talked120',count(*) FILTER (WHERE state='completed' AND duration>=120),
    'talkSeconds',coalesce(sum(duration) FILTER (WHERE state='completed'),0))
    FROM vc WHERE started_at>=v_start AND started_at<v_end),
  'notCalled',(SELECT jsonb_build_object('total',count(*),
    'noPhone',count(*) FILTER (WHERE raw_phone IS NULL),
    'unreadablePhone',count(*) FILTER (WHERE raw_phone IS NOT NULL AND phone IS NULL),
    'dialledUnderAnotherLead',count(*) FILTER (WHERE phone IS NOT NULL AND elsewhere),
    'neverDialled',count(*) FILTER (WHERE phone IS NOT NULL AND NOT elsewhere),
    'neverDialledOutsideDialerCountries',count(*) FILTER (WHERE phone IS NOT NULL AND NOT elsewhere AND NOT dialable),
    'neverDialledWithSavedOutcome',count(*) FILTER (WHERE phone IS NOT NULL AND NOT elsewhere AND attempted))
    FROM leads WHERE dials=0),
  'speed',(SELECT jsonb_build_object('hoursSource',v_hours,'leads',count(*),
    'medianClockSeconds',round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_at-created_at)) FILTER (WHERE first_at IS NOT NULL))::numeric),
    'withinFiveMinutes',count(*) FILTER (WHERE first_at<=created_at+interval '5 minutes'),
    'inHours',jsonb_build_object('leads',count(*) FILTER (WHERE in_hours),'called',count(*) FILTER (WHERE in_hours AND first_at IS NOT NULL),
      'withinFiveMinutes',count(*) FILTER (WHERE in_hours AND first_at<=created_at+interval '5 minutes'),
      'withinThirtyMinutes',count(*) FILTER (WHERE in_hours AND first_at<=created_at+interval '30 minutes'),
      'medianClockSeconds',round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_at-created_at)) FILTER (WHERE in_hours AND first_at IS NOT NULL))::numeric)),
    'outOfHours',jsonb_build_object('leads',count(*) FILTER (WHERE NOT in_hours),'called',count(*) FILTER (WHERE NOT in_hours AND first_at IS NOT NULL),
      'withinFiveMinutes',count(*) FILTER (WHERE NOT in_hours AND first_at<=created_at+interval '5 minutes'),
      'withinThirtyMinutes',count(*) FILTER (WHERE NOT in_hours AND first_at<=created_at+interval '30 minutes'),
      'medianClockSeconds',round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_at-created_at)) FILTER (WHERE NOT in_hours AND first_at IS NOT NULL))::numeric)))
    FROM leads),
  'followUp',(SELECT jsonb_build_object('leads',count(*),'calls',coalesce(sum(d72),0),'threePlus',count(*) FILTER (WHERE d72>=3))
    FROM leads WHERE created_at<=v_now-interval '72 hours' AND d72>0 AND NOT r72),
  'messages',(SELECT jsonb_build_object('handled',count(*) FILTER (WHERE mode='message'),
    'outcomesWithoutCall',count(*) FILTER (WHERE coalesce(mode,'')<>'message' AND outcome IN ('NO ANSWER','LOST') AND call_id IS NULL))
    FROM att WHERE outcome_at>=v_start AND outcome_at<v_end),
  'byAd',(SELECT coalesce(jsonb_agg(j ORDER BY (j->>'leads')::int DESC,j->>'id'),'[]'::jsonb) FROM grain_json WHERE g_ad=0 AND ad_id IS NOT NULL),
  'byCampaign',(SELECT coalesce(jsonb_agg(j ORDER BY (j->>'leads')::int DESC,j->>'id'),'[]'::jsonb) FROM grain_json WHERE g_ad=1 AND g_camp=0 AND campaign_id IS NOT NULL),
  'clientAverage',(SELECT j FROM grain_json WHERE g_ad=1 AND g_camp=1 LIMIT 1),
  'waiting',jsonb_build_object(
    'callable',(SELECT count(*) FROM leads WHERE dialable AND aged),
    'touched',(SELECT count(*) FROM leads WHERE dialable AND aged AND (dials>0 OR elsewhere OR attempted)),
    'called',(SELECT count(*) FROM leads WHERE dialable AND aged AND (dials>0 OR elsewhere)),
    'outcomeOnly',(SELECT count(*) FROM leads WHERE dialable AND aged AND NOT (dials>0 OR elsewhere) AND attempted),
    'untouched',(SELECT jsonb_build_object('count',count(*),'oldestAt',min(created_at),
      'oldestWorkSeconds',(SELECT round(max(mahara_reporting.cc_work_seconds(s.x,o.oldest,v_now)))
        FROM (SELECT min(created_at) AS oldest FROM untouched) o CROSS JOIN jsonb_array_elements(v_scheds) s(x)
        WHERE o.oldest IS NOT NULL))
      FROM untouched),
    'stages',(SELECT coalesce(jsonb_agg(jsonb_build_object('stage',stage_name,'position',position,'count',n,'medianDays',median_days,
      'oldestDays',oldest_days,'overSevenDays',over_week) ORDER BY position,stage_name),'[]'::jsonb) FROM stages),
    'callbacks',(SELECT jsonb_build_object('count',count(*),'overThreeDays',count(*) FILTER (WHERE last_touch<v_now-interval '3 days'),
      'oldestTouchAt',min(last_touch),'scheduled',count(*) FILTER (WHERE callback_at IS NOT NULL),
      'overdue',count(*) FILTER (WHERE callback_at<v_now)) FROM callbacks),
    'missedInbound',(SELECT jsonb_build_object('count',count(*),'callers',count(DISTINCT phone),
      'withinFifteenMinutes',count(*) FILTER (WHERE back_at<=started_at+interval '15 minutes'),
      'withinTwoHours',count(*) FILTER (WHERE back_at<=started_at+interval '2 hours'),
      'withinDay',count(*) FILTER (WHERE back_at<=started_at+interval '1 day'),
      'never',count(*) FILTER (WHERE back_at IS NULL),'oldestNeverAt',min(started_at) FILTER (WHERE back_at IS NULL)) FROM missed)),
  'lost',jsonb_build_object(
    'total',(SELECT count(*) FROM lost),
    'reasons',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'count',n) ORDER BY n DESC,key),'[]'::jsonb)
      FROM (SELECT key,count(*) AS n FROM lost GROUP BY key) r),
    'otherNotes',(SELECT jsonb_build_object('total',count(*),'sorted',count(*) FILTER (WHERE key<>'unclassified')) FROM lost WHERE reason='Other'),
    'unreachable',(SELECT jsonb_build_object('leads',count(*),'calls',coalesce(sum(k.calls),0),'noCall',count(*) FILTER (WHERE k.calls=0),
      'fourPlus',count(*) FILTER (WHERE k.calls>=4),'connected',count(*) FILTER (WHERE k.connected))
      FROM lost l JOIN lost_calls k ON k.contact_id=l.contact_id WHERE l.reason='Unreachable'),
    'latest',(SELECT coalesce(jsonb_agg(y.j ORDER BY y.at DESC),'[]'::jsonb) FROM (
      SELECT l.outcome_at AS at,jsonb_build_object(
       'at',l.outcome_at,'day',(l.outcome_at AT TIME ZONE 'Asia/Kuwait')::date,
       'firstName',nullif(split_part(btrim(regexp_replace(CASE WHEN coalesce(cl.contact_name,l.lead_name,'') ~* '^\s*<test lead' THEN ''
         ELSE coalesce(nullif(btrim(cl.contact_name),''),l.lead_name,'') END,'\s+',' ','g')),' ',1),''),
       'adId',cl.ad_id,'adName',a.ad_name,'reason',l.reason,'key',l.key,
       'note',public.cockpit_call_centre_note(l.note),'agent',coalesce(p.name,l.agent),
       'calls',k.calls,'longestSeconds',k.longest,'longestCallId',k.longest_id) AS j
      FROM lost l
      JOIN lost_calls k ON k.contact_id=l.contact_id
      LEFT JOIN public.client_leads cl ON cl.ghl_contact_id=l.contact_id
      LEFT JOIN ads a ON a.ad_id=cl.ad_id
      LEFT JOIN mahara_reporting.cc_people p ON p.email=l.agent
      ORDER BY l.outcome_at DESC,l.contact_id LIMIT 25) y)),
  'dialled',(SELECT coalesce(jsonb_agg(jsonb_build_object('email',d.agent,'name',coalesce(p.name,d.agent),'dials',d.n) ORDER BY d.n DESC,d.agent),'[]'::jsonb)
    FROM (SELECT agent,count(*) AS n FROM vc WHERE started_at>=v_start AND started_at<v_end GROUP BY agent) d
    LEFT JOIN mahara_reporting.cc_people p ON p.email=d.agent),
  'coverage',jsonb_build_object(
    'unlinkedCalls',(SELECT count(*) FROM ccalls WHERE type='outbound' AND location_id IS NULL AND started_at>=v_start AND started_at<v_end),
    'leadsWithoutPhone',(SELECT count(*) FROM leads WHERE raw_phone IS NULL),
    'leadsWithUnreadablePhone',(SELECT count(*) FROM leads WHERE raw_phone IS NOT NULL AND phone IS NULL),
    'leadsWithoutAdId',(SELECT count(*) FROM leads WHERE ad_id IS NULL),
    'metaLeadsWithoutAdId',(SELECT count(*) FROM leads WHERE ad_id IS NULL AND channel='Meta'),
    'leadsOnlyInGhl',(SELECT count(*) FROM leads WHERE NOT in_client_leads),
    'whatsappChats',(SELECT n FROM chats),
    'whatsappChatsCalled',(SELECT called FROM chats),
    'newestCallAt',(SELECT max(started_at) FROM calls),
    'newestClientCallAt',(SELECT max(started_at) FROM ccalls),
    'newestAttemptAt',(SELECT to_timestamp(max(a.updated)/1000.0) FROM mahara_console.attempts a WHERE a.namespace='production'),
    'newestClientAttemptAt',(SELECT max(outcome_at) FROM att),
    'leadSyncAt',(SELECT max(synced_at) FROM public.client_leads WHERE location_id=v_loc)))
 INTO v_main;

 -- What the reader should know, in plain words.
 v_notes:=v_notes||jsonb_build_array(
  'Leads, dials, reached, first call in working time and bookings are the dialer''s own report, the same as the CEO Calls tab. The rest is worked out here with the dialer''s link rule.',
  'Dials are verified Maqsam calls. Outcomes the agent saved without a Maqsam call are shown apart and never counted as dials.',
  'Per lead figures follow the leads that arrived in these dates, with every verified call made to them so far, also after the end date.',
  'Reached includes voicemail. Talked 30 s and talked 2 min show real conversations.',
  CASE WHEN v_hours='schedule' THEN 'In hours means the assigned callers'' working hours on Team & Payroll.'
       ELSE 'In hours means 10:00 to 18:00 Kuwait time, Friday off: no assigned caller has hours on Team & Payroll.' END,
  'Lost reasons come from the dialer. Notes under Other are sorted by keyword; the rest stay unsorted. Leads marked lost in GoHighLevel outside the dialer are not here.',
  'A phone shared by two leads is not linked to either, so those leads show as dialled under another lead.',
  'Test calls and test bookings saved in the dialer are left out.');
 IF (v_main->'coverage'->>'whatsappChats')::int>0 THEN
  v_notes:=v_notes||jsonb_build_array(format('%s left out of the figures worked out here: tagged "inbound whatsapp" in GoHighLevel, with no ad. The dialer''s headline still counts them.',
   CASE WHEN (v_main->'coverage'->>'whatsappChats')::int=1 THEN '1 WhatsApp chat contact is'
        ELSE (v_main->'coverage'->>'whatsappChats')||' WhatsApp chat contacts are' END));
 END IF;
 IF v_official IS NULL THEN
  v_notes:=v_notes||jsonb_build_array(CASE WHEN v_report_error IS NOT NULL
   THEN 'The dialer''s report did not answer, so the official headline is missing. Try again in a minute.'
   ELSE 'The dialer''s report has no row for this client, so the official headline is missing.' END);
 ELSE
  IF (v_official->>'providerDials')::numeric IS DISTINCT FROM (v_main->'window'->>'dials')::numeric THEN
   v_notes:=v_notes||jsonb_build_array(format('Dials here (%s) differ from the dialer''s report (%s). The report is the one shown.',
    v_main->'window'->>'dials',v_official->>'providerDials'));
  END IF;
  IF (v_official->>'leads')::numeric IS DISTINCT FROM (v_main->'cohort'->>'leads')::numeric+(v_main->'coverage'->>'whatsappChats')::numeric
     OR (v_official->>'leadsDialed')::numeric IS DISTINCT FROM (v_main->'cohort'->>'called')::numeric+(v_main->'coverage'->>'whatsappChatsCalled')::numeric THEN
   v_notes:=v_notes||jsonb_build_array(format('Leads or leads called here (%s, %s) differ from the dialer''s report (%s, %s). The report is the one shown.',
    (v_main->'cohort'->>'leads')::numeric+(v_main->'coverage'->>'whatsappChats')::numeric,
    (v_main->'cohort'->>'called')::numeric+(v_main->'coverage'->>'whatsappChatsCalled')::numeric,
    v_official->>'leads',v_official->>'leadsDialed'));
  END IF;
 END IF;
 IF NOT v_dialer_on THEN
  v_notes:=v_notes||jsonb_build_array('This client is switched off in the dialer, so no new leads reach the callers.');
 END IF;

 RETURN jsonb_build_object('version',1,'generatedAt',v_now,'timezone','Asia/Kuwait','from',p_from,'to',p_to,
  'client',v_client||jsonb_build_object('dialerActive',v_dialer_on),
  'official',v_official,
  'officialCoverage',v_report->'coverage',
  'callers',jsonb_build_object('assigned',v_assigned,'otherAccess',v_other,'dialled',v_main->'dialled'),
  'notes',v_notes)
  ||(v_main-'dialled');
END $$;

REVOKE ALL ON FUNCTION public.cockpit_client_calls(text,date,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_client_calls(text,date,date) TO authenticated;

COMMENT ON FUNCTION public.cockpit_client_calls(text,date,date) IS
 'One client''s call centre for client success and the media buyer: the dialer''s report as the headline, then campaigns, ads, waiting leads, lost reasons and callers. WhatsApp chats (tagged inbound whatsapp, no ad) are left out of the figures worked out here. Waiting counts callable leads with a Maqsam call (called) apart from those touched only by a saved outcome (outcomeOnly). Gated on the seat and the client.';

NOTIFY pgrst,'reload schema';
COMMIT;
