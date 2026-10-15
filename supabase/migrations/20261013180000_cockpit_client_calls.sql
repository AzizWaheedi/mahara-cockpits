-- Call centre numbers for one client, for client success and the media buyer
-- (Aziz, 2026-10-13): "dials, dials per ad, dials per campaign ... How much time
-- have the leads been caught in? ... is this a call center issue or is it not?
-- ... where we can actually listen to the calls ... see why exactly the leads
-- were lost". And: "The CSM needs to be able to see the assigned caller for each
-- client easily."
--
-- Three functions a signed-in seat may call, all SECURITY DEFINER with an empty
-- search path:
--
--   cockpit_client_calls(key, from, to)   one client's calls, by campaign and ad,
--                                         who is waiting, why leads were lost, the
--                                         assigned callers; at most 93 days
--   cockpit_call_recording_scope(call id) may this seat hear this call?
--   cockpit_call_recording_played(call id) the audit row for one play
--
-- The gate: the CEO, or a seat with the csm or media_buyer role (admins pass
-- through cockpit_has_role), and the client must pass cockpit_client_allowed.
-- cockpit_members.clients is empty for every seat today, and that function is
-- the one place that reads it (empty means every client).
--
-- Numbers. The headline is the dialer's own report,
-- public.mahara_call_center_report(from, to, null, location), so it equals the
-- CEO Calls tab. Everything else reads the dialer's prepared views in
-- mahara_reporting (cc_leads, cc_calls, cc_attempts, cc_appointments,
-- cc_people) and helpers (cc_phone, cc_time, cc_window, cc_work_seconds), so a
-- call links to a lead by the dialer's own rule: the saved call id, or a full
-- phone that belongs to one lead only. Nothing is created in mahara_reporting.
-- The function owner (postgres) may read those views; browsers may not.
--
-- "Verified call" here is the report's own: outbound, one known agent, no
-- conflicting link. Reached means a completed call with any talk time, so it
-- includes voicemail; talked 30 s and talked 2 min are the human-contact signal.
-- Test attempts saved in production (a note that starts "Test", a Meta test
-- lead) are left out of everything read from the dialer's attempts.
--
-- Not applied by this file's author. Before applying, run on the largest
-- client, as postgres:
--   explain (analyze, buffers) select public.cockpit_client_calls('<location>', current_date-29, current_date);
-- after setting request.jwt.claim.sub to the CEO's auth id. Authenticated calls
-- run under the role's statement timeout (8 s on Supabase).

BEGIN;
SET LOCAL lock_timeout = '3s';

-- 1. Who is asking -------------------------------------------------------------

-- The signed-in seat's email when it may see call centre numbers at all.
-- Client scope is checked separately, once the client is known.
CREATE OR REPLACE FUNCTION public.cockpit_call_centre_seat() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_email text;
BEGIN
 IF auth.uid() IS NOT NULL THEN
  SELECT cm.email INTO v_email FROM public.cockpit_members cm JOIN auth.users au ON au.id=cm.auth_user_id
  WHERE cm.auth_user_id=auth.uid() AND cm.active AND au.email_confirmed_at IS NOT NULL
    AND cm.email=lower(btrim(au.email));
 END IF;
 IF v_email IS NULL THEN
  RAISE EXCEPTION 'Sign in with your cockpit account to see call centre numbers.' USING ERRCODE='42501';
 END IF;
 IF NOT (public.cockpit_is_ceo() OR public.cockpit_has_role('csm') OR public.cockpit_has_role('media_buyer')) THEN
  RAISE EXCEPTION 'Call centre numbers are for client success and media buyers. Ask the CEO for access.' USING ERRCODE='42501';
 END IF;
 RETURN v_email;
END $$;

-- 2. Which client --------------------------------------------------------------

-- A ClickUp task id (client success), a Meta ad account id with or without
-- "act_" (media buyer) or a GHL location id, to one client. Ad accounts map the
-- way the data view maps them (public.clients and ghl_client_ad_accounts), then
-- by an id written into ghl_clients.meta_ad_account (that column is mostly the
-- account's name), then through the account's campaigns and their leads (one
-- client, Brillant, has no ad account on file but its leads carry campaign ids).
CREATE OR REPLACE FUNCTION public.cockpit_call_centre_client(p_key text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_key text:=btrim(coalesce(p_key,'')); v_acct text; v_locs text[]; v_out jsonb;
BEGIN
 IF v_key !~ '^[A-Za-z0-9_-]{1,64}$' THEN
  RAISE EXCEPTION 'Choose a client first.' USING ERRCODE='22023';
 END IF;
 SELECT array_agg(DISTINCT g.location_id) INTO v_locs FROM public.ghl_clients g WHERE g.location_id=v_key;
 IF v_locs IS NULL THEN
  SELECT array_agg(DISTINCT g.location_id) INTO v_locs FROM public.ghl_clients g WHERE g.clickup_id=v_key;
 END IF;
 v_acct:=regexp_replace(lower(v_key),'^act_','');
 IF v_locs IS NULL AND v_acct ~ '^[0-9]{5,20}$' THEN
  SELECT array_agg(DISTINCT x.location_id) INTO v_locs FROM (
   SELECT coalesce(a.location_id,cl.ghl_location_id) AS location_id
   FROM public.clients cl LEFT JOIN public.ghl_client_ad_accounts a ON a.client_id=cl.id
   WHERE regexp_replace(lower(coalesce(cl.meta_ad_account_id,'')),'^act_','')=v_acct
   UNION
   SELECT g.location_id FROM public.ghl_clients g
   WHERE substring(coalesce(g.meta_ad_account,'') FROM '^\s*(?:act_)?([0-9]{5,20})')=v_acct
  ) x WHERE x.location_id IS NOT NULL;
  IF v_locs IS NULL THEN
   SELECT array_agg(DISTINCT l.location_id) INTO v_locs FROM public.client_leads l
   WHERE NOT coalesce(l.deleted,false) AND l.campaign_id IN (
    SELECT c.meta_campaign_id FROM public.cockpit_campaigns c
    WHERE regexp_replace(lower(coalesce(c.meta_account_id,'')),'^act_','')=v_acct AND c.meta_campaign_id IS NOT NULL);
  END IF;
 END IF;
 IF v_locs IS NULL OR cardinality(v_locs)=0 THEN
  RAISE EXCEPTION 'No client matches this link. Open the client again from the client list.' USING ERRCODE='22023';
 END IF;
 -- Only an ad account can match two clients (location and ClickUp ids are
 -- unique), so this is said for the media buyer seat that can hit it.
 IF cardinality(v_locs)>1 THEN
  RAISE EXCEPTION 'This ad account is linked to more than one client. Ask the CEO to fix the ad account on the client record.' USING ERRCODE='22023';
 END IF;
 SELECT jsonb_build_object('locationId',g.location_id,'name',g.client_name,'clickupId',g.clickup_id,
  'status',g.status,'serviceMode',g.service_mode,'country',g.country)
 INTO v_out FROM public.ghl_clients g WHERE g.location_id=v_locs[1];
 IF v_out IS NULL THEN
  RAISE EXCEPTION 'No client matches this link. Open the client again from the client list.' USING ERRCODE='22023';
 END IF;
 RETURN v_out;
END $$;

-- 3. Small rules ---------------------------------------------------------------

-- Attempts saved in production as tests: Aziz's test booking of 29 September
-- ("TEST ONLY ..."), and Meta's test leads ("Test lead", "<test lead: ...>").
CREATE OR REPLACE FUNCTION public.cockpit_call_centre_is_test(p_data jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(p_data->'disposition'->>'note','') ~* '^\s*test\M'
     OR coalesce(p_data->>'leadName','') ~* '^\s*<test lead';
$$;

-- What the agent wrote, without the dialer's system lines: the automatic
-- no-answer line, the ladder line, the Maqsam and sheet lines, the [mahara:]
-- tag, and the "Client handover" / "Feedback shared with client" copy that
-- repeats the note for the client. The same lines convex/lostNotes.ts cuts.
CREATE OR REPLACE FUNCTION public.cockpit_call_centre_note(p_note text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT nullif(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
   coalesce(p_note,''),
   '\n?[ \t]*(Client handover|Feedback shared with client):.*$','','i'),
   '\[mahara:[^]]*\]','','g'),
   '(No answer verified by Maqsam call [0-9]+; duration [0-9]+ seconds\. Automatic follow-up disposition\.|:?[ \t]*Follow-up ladder exhausted\. Lost: Unreachable\.|Outcome recorded by the agent; this does not establish a verified Maqsam call\.|Manual call reported by the agent; Maqsam duration is unverified\.|No-show attempt [0-9]+ of [0-9]+\.( Earlier attempts are unknown; this is the conservative retry budget\.)?|Client requested sales follow-up: [^ \n]+\.|Client sheet: [^;\n]*; row [^ \n]+\.|Returned missed Maqsam call: [^ \n]+\.)','','g'),
   '^\s*Call notes:\s*','','i'),
   '\s+',' ','g')),'');
$$;

-- One key per lost lead. The dialer's own reasons keep their meaning; "Other"
-- is sorted by the agent's note with plain keyword rules (English, Gulf and
-- Levantine Arabic as the agents type them). Order matters: "not interested,
-- filled it by mistake" is a mistake, "agreed with another company, not
-- interested" went elsewhere. A no-answer note under "Other" joins the
-- dialer's own Unreachable.
CREATE OR REPLACE FUNCTION public.cockpit_call_centre_lost_key(p_reason text,p_note text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE coalesce(p_reason,'')
  WHEN 'Distance Issue' THEN 'distance'
  WHEN 'Financial Issue' THEN 'financial'
  WHEN 'Client Had Unrealistic Expectations' THEN 'unrealistic'
  WHEN 'Has a setup issue' THEN 'setup_issue'
  WHEN 'Unsure of reason or never came back' THEN 'never_came_back'
  WHEN 'Unreachable' THEN 'unreachable'
  WHEN 'Other' THEN CASE
   WHEN n ~* '(invalid n|wrong n|n[ou]mber too long|too long|الرقم (غلط|علط|طويل|غير|لا يستطيع)|مفصول|غير داخل)' THEN 'bad_number'
   WHEN n ~* '(mistake|did ?n.?t fill|has ?n.?t fill|بالغلط|بلغلط|بالخطأ|بالخطا|مو مقدم|مو انا)' THEN 'applied_by_mistake'
   WHEN n ~* '(another company|other company|someone else|agreed with|made a deal|another one|عميل آخر|عميل اخر|شركة ثانية|شركة ثانيه|غير اكاونت)' THEN 'went_elsewhere'
   WHEN n ~* '(distance|too far|far away|مسافة|مسافه|بعيد)' THEN 'distance'
   WHEN n ~* '(not ready|ready in|months|later|next year|مو الحين|بعد اشهر|بعد أشهر|بعد سنة|مو جاهز|غير جاهز|ما شاري|مو شاري|للحين|ما يريد بعد|design phase|bought the land|land isn.t)' THEN 'not_ready'
   WHEN n ~* '(project|plot|not suitable|not our target|real estate|not available|budget|expensive|price|financ|contractor|not arab|n.?t speak|n.?t understand|indian|african|collaborat|dig only|looking for something else|مقاول|ما عند|لا عندي|ماعندي|ما عندو|غير مناسب|ما يقدم|ميزانية|غالي|عقار|يتعاون|مشروع)' THEN 'not_a_fit'
   WHEN n ~* '(int?e?re?s?ted|uninterested|closed the line|block|cancel|not serious|rude|sakr|كنسل|مهتم|بلوك|سكر|صرفت نظر|غير جاد|اتركوني)' THEN 'not_interested'
   WHEN n ~* '(no answer|لا ?يرد|ما ?يرد|unreachable)' THEN 'unreachable'
   ELSE 'unclassified' END
  ELSE 'unclassified' END
 FROM (SELECT coalesce(public.cockpit_call_centre_note(p_note),'') AS n) x;
$$;

-- 4. One client's call centre --------------------------------------------------

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
 cohort AS MATERIALIZED (
  SELECT l.contact_id,l.created_at,l.phone,
   nullif(btrim(coalesce(cl.contact_phone,f.data->>'phone')),'') AS raw_phone,
   nullif(cl.ad_id,'') AS ad_id,nullif(cl.campaign_id,'') AS campaign_id,cl.channel,
   cl.ghl_contact_id IS NOT NULL AS in_client_leads
  FROM client_leads_all l
  LEFT JOIN public.client_leads cl ON cl.ghl_contact_id=l.contact_id AND cl.location_id=v_loc
  LEFT JOIN mahara_reporting.facts f ON f.namespace='production' AND f.source='ghl' AND f.kind='contact'
   AND f.external_id=v_loc||':'||l.contact_id
  WHERE l.created_at>=v_start AND l.created_at<v_end),
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
 IF v_official IS NULL THEN
  v_notes:=v_notes||jsonb_build_array(CASE WHEN v_report_error IS NOT NULL
   THEN 'The dialer''s report did not answer, so the official headline is missing. Try again in a minute.'
   ELSE 'The dialer''s report has no row for this client, so the official headline is missing.' END);
 ELSE
  IF (v_official->>'providerDials')::numeric IS DISTINCT FROM (v_main->'window'->>'dials')::numeric THEN
   v_notes:=v_notes||jsonb_build_array(format('Dials here (%s) differ from the dialer''s report (%s). The report is the one shown.',
    v_main->'window'->>'dials',v_official->>'providerDials'));
  END IF;
  IF (v_official->>'leads')::numeric IS DISTINCT FROM (v_main->'cohort'->>'leads')::numeric
     OR (v_official->>'leadsDialed')::numeric IS DISTINCT FROM (v_main->'cohort'->>'called')::numeric THEN
   v_notes:=v_notes||jsonb_build_array(format('Leads or leads called here (%s, %s) differ from the dialer''s report (%s, %s). The report is the one shown.',
    v_main->'cohort'->>'leads',v_main->'cohort'->>'called',v_official->>'leads',v_official->>'leadsDialed'));
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

-- 5. Recordings ----------------------------------------------------------------

-- May this seat hear this Maqsam call? Only a call the dialer's rule links to a
-- client the seat may see. The Edge Function cockpit-call-recording asks with
-- the caller's own token before it fetches anything from Maqsam.
CREATE OR REPLACE FUNCTION public.cockpit_call_recording_scope(p_call_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_loc text; v_name text;
BEGIN
 PERFORM public.cockpit_call_centre_seat();
 IF coalesce(p_call_id,'') !~ '^[0-9]{1,20}$' THEN
  RAISE EXCEPTION 'Choose a call to play.' USING ERRCODE='22023';
 END IF;
 SELECT c.location_id INTO v_loc FROM mahara_reporting.cc_calls c
 WHERE c.id=p_call_id AND c.location_id IS NOT NULL LIMIT 1;
 IF v_loc IS NULL THEN
  RAISE EXCEPTION 'This call is not linked to a client, so it cannot be played here.' USING ERRCODE='42501';
 END IF;
 SELECT g.client_name INTO v_name FROM public.ghl_clients g WHERE g.location_id=v_loc;
 IF v_name IS NULL OR NOT public.cockpit_client_allowed(v_name) THEN
  RAISE EXCEPTION 'This call belongs to a client that is not on your cockpit seat.' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('ok',true,'clientName',v_name,'locationId',v_loc);
END $$;

-- One audit row per play, written as the seat that pressed play.
CREATE OR REPLACE FUNCTION public.cockpit_call_recording_played(p_call_id text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_email text; v_scope jsonb;
BEGIN
 v_email:=public.cockpit_call_centre_seat();
 v_scope:=public.cockpit_call_recording_scope(p_call_id);
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata)
 VALUES ('call.recording.play','maqsam_call',p_call_id,v_email,'cockpit-call-recording','supabase',
  jsonb_build_object('clientName',v_scope->>'clientName','locationId',v_scope->>'locationId'));
END $$;

-- 6. Grants --------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.cockpit_call_centre_seat() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cockpit_call_centre_client(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cockpit_call_centre_is_test(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cockpit_call_centre_note(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cockpit_call_centre_lost_key(text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cockpit_client_calls(text,date,date) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.cockpit_call_recording_scope(text) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.cockpit_call_recording_played(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_client_calls(text,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_call_recording_scope(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_call_recording_played(text) TO authenticated;

COMMENT ON FUNCTION public.cockpit_client_calls(text,date,date) IS
 'One client''s call centre for client success and the media buyer: the dialer''s report as the headline, then campaigns, ads, waiting leads, lost reasons and callers. Gated on the seat and the client.';

NOTIFY pgrst,'reload schema';
COMMIT;
