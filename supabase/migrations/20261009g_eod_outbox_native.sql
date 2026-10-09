-- Native end of day reports reach Slack and the EOD sheet again.
--
-- On Convex, every staff EOD was queued into eod_outbox (eodOut.send for the
-- CSM and the creative director, writeback.submitEod for the media buyer) and
-- the VPS worker hermes/eod-out/out.py posted it to the EOD channel and
-- appended it to the EOD Reports sheet, where EOD Radar reads it. The native
-- save, cockpit_save_personal_eod (20260927e), never queued anything, so no
-- EOD filed in a native cockpit has reached Slack, the sheet or the radar.
--
-- What this changes:
-- * A submit queues exactly one eod_outbox row for that report, in the same
--   transaction as the submit. A draft queues nothing.
-- * eod_outbox.report_id links the row to its report and is unique, so a
--   repeated submit returns the row that is already there and never posts
--   twice. An existing row is only rewritten while it is still queued and
--   untouched (no claim, no send started, no receipt); the delivery trigger
--   from 20260927b refuses anything else.
-- * Name and Slack id come from the server (cockpit_members, team_people),
--   never from the typed answers, so nobody can file as somebody else.
-- * The message and the sheet row keep the shape the Convex producers used:
--   title, "*Date - ", "*Name - ", "Submitted by: <@id>", then the sections,
--   filled from the native forms' own answer keys.
-- * cockpit_personal_eod returns the delivery state as `outbox`. `delivery`
--   keeps the constant today's screens validate ('not_configured'); switch
--   the screens to `outbox` and retire that constant together.
--
-- Nothing is posted until the VPS cron runs out.py with --apply. out.py's
-- claim, send-start and receipt RPCs are in 20260927b_eod_delivery_claims.sql;
-- this migration refuses to apply without them rather than queue rows that
-- nobody can claim. Applying it does not authorize outward delivery.
BEGIN;

DO $$
DECLARE missing text[] := ARRAY[]::text[];
BEGIN
 IF to_regclass('public.eod_outbox') IS NULL THEN
  missing := array_append(missing,'public.eod_outbox (20260922a_eod_outbox.sql)');
 END IF;
 IF to_regclass('public.team_people') IS NULL THEN
  missing := array_append(missing,'public.team_people (20260922b_team_meetings.sql)');
 END IF;
 IF to_regprocedure('public.cockpit_claim_eod_outbox(text,integer,integer)') IS NULL
  OR to_regprocedure('public.cockpit_start_eod_send(bigint,text,uuid,text)') IS NULL
  OR to_regprocedure('public.cockpit_record_eod_receipt(bigint,text,uuid,text,text,timestamptz,text,text,boolean,text)') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger
                WHERE tgname='trg_protect_eod_outbox' AND tgrelid=to_regclass('public.eod_outbox')) THEN
  missing := array_append(missing,'the EOD delivery claims (20260927b_eod_delivery_claims.sql)');
 END IF;
 IF to_regprocedure('public.cockpit_eod_actor(text)') IS NULL
  OR to_regprocedure('public.cockpit_eod_working_day(timestamptz)') IS NULL THEN
  missing := array_append(missing,'the personal EOD model (20260927e_cockpit_personal_eod.sql)');
 END IF;
 IF cardinality(missing)>0 THEN
  RAISE EXCEPTION 'Apply these first: %',array_to_string(missing,'; ');
 END IF;
END $$;

ALTER TABLE public.eod_outbox ADD COLUMN IF NOT EXISTS report_id bigint;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint
               WHERE conname='eod_outbox_report_id_fkey' AND conrelid='public.eod_outbox'::regclass) THEN
  -- No cascade: a delivered EOD keeps pointing at the report it carried.
  ALTER TABLE public.eod_outbox ADD CONSTRAINT eod_outbox_report_id_fkey
   FOREIGN KEY(report_id) REFERENCES public.cockpit_eod_reports(id);
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS eod_outbox_report_id_key ON public.eod_outbox(report_id) WHERE report_id IS NOT NULL;

-- The first answer that is filled in, as text; '' when none is. Zero stays "0".
CREATE OR REPLACE FUNCTION public.cockpit_eod_pick(p jsonb,VARIADIC p_keys text[])
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce((SELECT p->>t.k FROM unnest(p_keys) WITH ORDINALITY AS t(k,n)
   WHERE jsonb_typeof(p->t.k) IN ('string','number','boolean') AND btrim(p->>t.k)<>''
   ORDER BY t.n LIMIT 1),'');
$$;

-- The Slack message and the sheet row for one report, per role. Channels and
-- tabs are the ones the Convex producers wrote to. The media buyer's 21 sheet
-- columns follow the 'Media Buyer' tab header (writeback.ts). The CSM and
-- creative director rows keep the 10 columns Convex's eodOut.ts wrote.
CREATE OR REPLACE FUNCTION public.cockpit_eod_outbox_payload(r public.cockpit_eod_reports,p_name text,p_slack_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
 a jsonb:=coalesce(r.answers,'{}'::jsonb);
 c jsonb:=coalesce(r.computed,'{}'::jsonb);
 v_date text:=to_char(r.day,'DD-MM-YYYY');
 v_submitted text:=to_char(coalesce(r.submitted_at,now()) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS');
 v_response text:='cockpit-'||to_char(r.day,'YYYY-MM-DD')||'-'||r.id::text;
 v_energy text;
 v_stress text:=coalesce(r.stress::text,'');
 v_by text;
 v_head text[];
 v_channel text;
 v_tab text;
 v_body text[];
 v_values jsonb;
BEGIN
 v_energy:=public.cockpit_eod_pick(a,'energy');
 IF v_energy='' THEN v_energy:=coalesce(r.energy::text,''); END IF;
 v_by:='Submitted by: '||CASE WHEN nullif(btrim(p_slack_id),'') IS NOT NULL THEN '<@'||btrim(p_slack_id)||'>' ELSE p_name END;
 IF r.role='media_buyer' THEN
  v_channel:='C0AQ2LD0PL1';v_tab:='Media Buyer';
  -- Line for line the live form's output, quirks included (the unclosed
  -- asterisk on the Date line, the newline before two of the values).
  v_body:=ARRAY['*MEDIA BUYER EOD*','*Date - '||v_date,'','*Name - '||p_name||'*',v_by,'',
   '*HEALTH*',
   'Focus - '||public.cockpit_eod_pick(a,'focus'),
   'Energy - '||v_energy,
   'Food, Sleep, Water - '||E'\n'||public.cockpit_eod_pick(a,'biology'),
   '',
   '*TASKS*',
   'Did you check and update the Master Fulfillment Dashboard for all active clients today? - '||public.cockpit_eod_pick(a,'dashboard'),
   'Are all client ad accounts within their daily budget targets? - '||public.cockpit_eod_pick(a,'onBudget'),
   'Did you flag any off-KPI client accounts to the CSM today? - '||public.cockpit_eod_pick(a,'flagged'),
   'Did you submit any video requests or creative briefs that were due today? - '||public.cockpit_eod_pick(a,'videoRequests'),
   'Did you upload any approved creatives to the client''s Google Drive Creatives folder? - '||public.cockpit_eod_pick(a,'creativesUploaded'),
   '',
   '*Today''s Numbers*',
   'Total Ad Spend Today - '||public.cockpit_eod_pick(c,'spend'),
   'Leads Generated - '||public.cockpit_eod_pick(c,'leads'),
   'Average CPL - '||public.cockpit_eod_pick(c,'cpl'),
   'Active Accounts Managed - '||public.cockpit_eod_pick(c,'accounts'),
   'Any Clients Above KPI? - '||E'\n'||public.cockpit_eod_pick(c,'overGate'),
   'Any new creatives launched or paused today? - '||public.cockpit_eod_pick(a,'launchedPaused'),
   '',
   '*DAILY WRAP UP*',
   'Account Summary - '||public.cockpit_eod_pick(a,'accountSummary'),
   'Actions to get back into KPI - '||coalesce(nullif(public.cockpit_eod_pick(a,'outOfKpi'),''),'--'),
   '',
   '*ADDITIONAL NOTES*',
   '1% improvement - '||coalesce(nullif(public.cockpit_eod_pick(a,'one_percent_better'),''),'--')];
  v_values:=jsonb_build_array(v_submitted,p_name,v_response,v_date,v_energy,
   public.cockpit_eod_pick(a,'focus'),public.cockpit_eod_pick(a,'biology'),public.cockpit_eod_pick(a,'dashboard'),
   public.cockpit_eod_pick(a,'onBudget'),public.cockpit_eod_pick(a,'flagged'),public.cockpit_eod_pick(a,'videoRequests'),
   public.cockpit_eod_pick(a,'creativesUploaded'),public.cockpit_eod_pick(c,'spend'),public.cockpit_eod_pick(c,'leads'),
   public.cockpit_eod_pick(c,'cpl'),public.cockpit_eod_pick(c,'accounts'),public.cockpit_eod_pick(c,'overGate'),
   public.cockpit_eod_pick(a,'launchedPaused'),public.cockpit_eod_pick(a,'accountSummary'),
   public.cockpit_eod_pick(a,'outOfKpi'),public.cockpit_eod_pick(a,'one_percent_better'));
 ELSIF r.role='csm' THEN
  v_channel:='#eods-csms';v_tab:='Account Manager';
  v_body:=ARRAY['*CSM EOD*','*Date - '||v_date,'','*Name - '||p_name||'*',v_by,'',
   '*HEALTH*','Energy - '||v_energy,'Stress - '||v_stress,'',
   '*OUTPUT*',
   'Clients handled today - '||public.cockpit_eod_pick(c,'handled','contacted'),
   'Calls held - '||public.cockpit_eod_pick(c,'calls'),
   'Signups or onboarding steps - '||public.cockpit_eod_pick(c,'signups'),
   'Upsells, referrals or reviews logged - '||public.cockpit_eod_pick(c,'hot'),
   'Tickets rerouted - '||public.cockpit_eod_pick(c,'tickets'),
   'Clients marked left - '||public.cockpit_eod_pick(c,'left'),
   '',
   '*CALLS*',coalesce(nullif(public.cockpit_eod_pick(a,'callSummary'),''),'--'),'',
   '*EXPECTATIONS*',coalesce(nullif(public.cockpit_eod_pick(a,'expectations'),''),'--'),'',
   '*CHECKLIST*',
   'Touchpoints for DEFCON 3 clients - '||public.cockpit_eod_pick(a,'touchpoints'),
   'Fathom summaries sent - '||public.cockpit_eod_pick(a,'fathom'),
   'New signups or pre-onboarding - '||public.cockpit_eod_pick(a,'newSignups'),
   'Upsells - '||public.cockpit_eod_pick(a,'upsells'),
   'Google reviews - '||public.cockpit_eod_pick(a,'reviews'),
   'Referrals - '||public.cockpit_eod_pick(a,'referrals'),
   '',
   '*LOST OR AT RISK*',coalesce(nullif(public.cockpit_eod_pick(a,'lost'),''),'--'),'',
   '*OFFBOARDED*',coalesce(nullif(public.cockpit_eod_pick(a,'offboarded'),''),'--'),'',
   '*EXTENDED*',coalesce(nullif(public.cockpit_eod_pick(a,'extended'),''),'--'),'',
   '*PAUSED*',coalesce(nullif(public.cockpit_eod_pick(a,'paused'),''),'--'),'',
   '*1% BETTER*',coalesce(nullif(public.cockpit_eod_pick(a,'onePercent','one_percent_better'),''),'--'),'',
   '*DAY SUMMARY*',coalesce(nullif(public.cockpit_eod_pick(a,'rollup','summary'),''),'--')];
  v_values:=jsonb_build_array(v_submitted,p_name,v_response,v_date,v_energy,
   public.cockpit_eod_pick(a,'focus'),public.cockpit_eod_pick(a,'wins'),public.cockpit_eod_pick(a,'blockers'),
   public.cockpit_eod_pick(a,'tomorrow'),public.cockpit_eod_pick(a,'summary','rollup'));
 ELSIF r.role='creative' THEN
  v_channel:='C0AQ2LD0PL1';v_tab:='Creative Director';
  v_body:=ARRAY['*CREATIVE DIRECTOR EOD*','*Date - '||v_date,'','*Name - '||p_name||'*',v_by,'',
   '*HEALTH*','Energy - '||v_energy,'Stress - '||v_stress,'',
   '*OUTPUT*',
   'Scripts completed today - '||public.cockpit_eod_pick(a,'scripts'),
   'Videos briefed to editors today - '||public.cockpit_eod_pick(a,'briefed'),
   'Client adjustments: all feedback received & logged? - '||public.cockpit_eod_pick(a,'feedbackLogged'),
   'Client adjustments: all clients replied to? - '||public.cockpit_eod_pick(a,'clientsReplied'),
   'Client adjustments: all adjustments sent to editors? - '||public.cockpit_eod_pick(a,'adjustmentsSent'),
   '',
   '*TODAY IN THE COCKPIT*',
   'Checks done - '||public.cockpit_eod_pick(c,'checksDone')||' of '||public.cockpit_eod_pick(c,'checksTotal'),
   'Touchpoints done - '||public.cockpit_eod_pick(c,'touchpointsDone'),
   'Brand DNA open - '||public.cockpit_eod_pick(c,'brandDnaOpen'),
   'Scripts open - '||public.cockpit_eod_pick(c,'scriptsOpen')||' ('||public.cockpit_eod_pick(c,'scriptsStale')||' stale)',
   'Videos late - '||public.cockpit_eod_pick(c,'videosOverdue'),
   'Posts past date - '||public.cockpit_eod_pick(c,'postsLate'),
   '',
   '*IDEAS*',coalesce(nullif(public.cockpit_eod_pick(a,'ideas'),''),'--'),'',
   '*BLOCKERS*',coalesce(nullif(public.cockpit_eod_pick(a,'blockers'),''),'--'),'',
   '*TOMORROW*',coalesce(nullif(public.cockpit_eod_pick(a,'priorities','tomorrow'),''),'--'),'',
   '*DAY SUMMARY*',coalesce(nullif(public.cockpit_eod_pick(a,'summary'),''),'--')];
  v_values:=jsonb_build_array(v_submitted,p_name,v_response,v_date,v_energy,
   public.cockpit_eod_pick(a,'focus'),public.cockpit_eod_pick(a,'wins'),public.cockpit_eod_pick(a,'blockers'),
   public.cockpit_eod_pick(a,'tomorrow','priorities'),public.cockpit_eod_pick(a,'summary'));
 ELSE
  RAISE EXCEPTION 'No EOD channel is set for the % role',r.role;
 END IF;
 RETURN jsonb_build_object('channel',v_channel,'tab',v_tab,'body',array_to_string(v_body,E'\n'),'row_values',v_values);
END;
$$;

-- Queue one submitted personal report. Returns the outbox id, or NULL when an
-- EOD for the same person and day already left through another producer (a
-- Convex-era row that was claimed or sent); nothing is posted twice.
CREATE OR REPLACE FUNCTION public.cockpit_enqueue_personal_eod(p_report_id bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_eod_reports;v_name text;v_people_name text;v_slack text;v_person text;v_payload jsonb;v_id bigint;
BEGIN
 SELECT * INTO r FROM public.cockpit_eod_reports WHERE id=p_report_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'EOD report % does not exist',p_report_id; END IF;
 IF r.owner_user_id IS NULL OR r.submitted_at IS NULL THEN
  RAISE EXCEPTION 'Only a submitted personal EOD can be queued for delivery';
 END IF;
 -- One outbox row per report, ever.
 SELECT o.id INTO v_id FROM public.eod_outbox o WHERE o.report_id=p_report_id;
 IF FOUND THEN RETURN v_id; END IF;
 SELECT nullif(btrim(m.name),'') INTO v_name FROM public.cockpit_members m WHERE m.auth_user_id=r.owner_user_id;
 SELECT nullif(btrim(t.name),''),nullif(btrim(t.slack_id),'') INTO v_people_name,v_slack
 FROM public.team_people t
 WHERE r.owner_email IS NOT NULL AND lower(btrim(t.email))=lower(btrim(r.owner_email))
 ORDER BY t.active DESC,t.updated_at DESC LIMIT 1;
 v_name:=left(coalesce(v_name,v_people_name,nullif(split_part(r.owner_email,'@',1),''),'Unknown'),120);
 -- The three filers Convex hardcoded, matched by first name, until team_people
 -- carries their Slack ids. EOD Radar matches the "Submitted by" id.
 IF v_slack IS NULL THEN
  SELECT k.slack_id INTO v_slack FROM (VALUES('media_buyer','nada','U0AJQ8P1ACF'),('csm','saleh','U09SHBK2C9F'),
   ('creative','sabri','U0B2SHGS1JA')) AS k(role,first_name,slack_id)
  WHERE k.role=r.role AND k.first_name=lower(split_part(v_name,' ',1));
 END IF;
 v_person:=v_name;
 -- Two people with one display name in one role: the second is told apart by email.
 IF EXISTS(SELECT 1 FROM public.eod_outbox o WHERE o.role=r.role AND o.day=to_char(r.day,'YYYY-MM-DD')
           AND o.person=v_person AND o.report_id IS NOT NULL AND o.report_id<>p_report_id) THEN
  v_person:=left(v_name||' <'||coalesce(r.owner_email,r.owner_user_id::text)||'>',200);
 END IF;
 v_payload:=public.cockpit_eod_outbox_payload(r,v_name,v_slack);
 INSERT INTO public.eod_outbox AS o(role,day,person,slack_id,channel,tab,body,row_values,status,attempts,error,report_id)
 VALUES(r.role,to_char(r.day,'YYYY-MM-DD'),v_person,v_slack,v_payload->>'channel',v_payload->>'tab',
  v_payload->>'body',v_payload->'row_values','queued',0,NULL,p_report_id)
 ON CONFLICT(role,day,person) DO UPDATE SET slack_id=EXCLUDED.slack_id,channel=EXCLUDED.channel,tab=EXCLUDED.tab,
  body=EXCLUDED.body,row_values=EXCLUDED.row_values,attempts=0,error=NULL,report_id=EXCLUDED.report_id
 -- Only an unlinked row nobody has touched yet (a Convex-era queue entry) is taken over.
 WHERE o.report_id IS NULL AND o.status='queued' AND o.claimed_by IS NULL AND o.claim_token IS NULL
  AND o.slack_started_at IS NULL AND o.sheet_started_at IS NULL AND o.slack_ts IS NULL AND o.sheet_at IS NULL
  AND NOT o.reconciliation_needed
 RETURNING o.id INTO v_id;
 RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_personal_eod(p_role text,p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid;day_for date;report jsonb;outbox jsonb;
BEGIN
 uid:=public.cockpit_eod_actor(p_role);
 day_for:=coalesce(p_day,public.cockpit_eod_working_day(now()));
 IF day_for>public.cockpit_eod_working_day(now()) THEN RAISE EXCEPTION 'EOD day cannot be in the future';END IF;
 SELECT to_jsonb(r) INTO report FROM public.cockpit_eod_reports r
 WHERE r.owner_user_id=uid AND r.role=p_role AND r.day=day_for;
 IF report IS NOT NULL THEN
  SELECT jsonb_build_object('status',o.status,'attempts',o.attempts,'slack_posted',o.slack_ts IS NOT NULL,
   'sheet_filed',o.sheet_at IS NOT NULL,'sent_at',o.sent_at,'error',o.error,'sheet_error',o.sheet_error,
   'needs_reconciliation',o.reconciliation_needed)
  INTO outbox FROM public.eod_outbox o WHERE o.report_id=(report->>'id')::bigint;
 END IF;
 -- 'delivery' is the constant today's screens validate; 'outbox' is the real state.
 RETURN jsonb_build_object('owner',uid,'day',day_for,'report',report,'delivery','not_configured','outbox',outbox);
END;
$$;

-- 20260927e, plus the queue: a submit queues the report; a draft does not.
CREATE OR REPLACE FUNCTION public.cockpit_save_personal_eod(p_role text,p_patch jsonb,p_expected_owner uuid,p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid;email text;day_for date;r public.cockpit_eod_reports;oldrow public.cockpit_eod_reports;
 fresh boolean;submit boolean;field text;rating numeric;saved_id bigint;
BEGIN
 uid:=public.cockpit_eod_actor(p_role);
 IF p_expected_owner IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Your session changed. Reload the report before saving' USING ERRCODE='42501';END IF;
 day_for:=coalesce(p_day,public.cockpit_eod_working_day(clock_timestamp()));
 IF day_for>public.cockpit_eod_working_day(clock_timestamp()) THEN RAISE EXCEPTION 'EOD day cannot be in the future';END IF;
 IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'EOD changes must be an object';END IF;
 FOR field IN SELECT jsonb_object_keys(p_patch) LOOP
 IF field NOT IN ('energy','stress','body','answers','computed','submit') THEN RAISE EXCEPTION 'Unsupported EOD field: %',field;END IF;END LOOP;
 IF p_patch ? 'submit' AND jsonb_typeof(p_patch->'submit') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Submit must be true or false';END IF;
 submit:=coalesce((p_patch->>'submit')::boolean,false);
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||p_role||day_for::text,0));
 SELECT * INTO r FROM public.cockpit_eod_reports WHERE owner_user_id=uid AND role=p_role AND day=day_for FOR UPDATE;
 fresh:=NOT FOUND;oldrow:=r;
 IF fresh THEN r.answers:='{}';r.computed:='{}';END IF;
 FOREACH field IN ARRAY ARRAY['energy','stress'] LOOP
 IF p_patch ? field THEN
   IF jsonb_typeof(p_patch->field) NOT IN ('number','string','null') THEN RAISE EXCEPTION 'Energy and stress must be numeric ratings';END IF;
   rating:=nullif(btrim(p_patch->>field),'')::numeric;
   IF rating<0 OR rating>10 THEN RAISE EXCEPTION 'Energy and stress must be between 0 and 10';END IF;
   IF field='energy' THEN r.energy:=rating;ELSE r.stress:=rating;END IF;
 END IF;END LOOP;
 FOREACH field IN ARRAY ARRAY['answers','computed'] LOOP
 IF p_patch ? field THEN
   IF jsonb_typeof(p_patch->field) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'EOD answers and computed values must be objects';END IF;
   IF field='answers' THEN r.answers:=r.answers||(p_patch->field);ELSE r.computed:=r.computed||(p_patch->field);END IF;
 END IF;END LOOP;
 IF p_patch ? 'body' THEN
 IF jsonb_typeof(p_patch->'body') NOT IN ('string','null') THEN RAISE EXCEPTION 'EOD body must be text';END IF;
 r.body:=p_patch->>'body';END IF;
 IF NOT fresh AND oldrow.submitted_at IS NOT NULL THEN
   IF ROW(r.energy,r.stress,r.answers,r.computed,r.body) IS DISTINCT FROM ROW(oldrow.energy,oldrow.stress,oldrow.answers,oldrow.computed,oldrow.body) THEN
     RAISE EXCEPTION 'This EOD was submitted and cannot be overwritten';
   END IF;
   -- A repeated submit returns the queued row; a native one submitted before the queue existed is queued now.
   -- Reports imported from Convex were already posted by Convex, so they are never queued here.
   IF submit AND oldrow.source_system='supabase' THEN PERFORM public.cockpit_enqueue_personal_eod(oldrow.id); END IF;
   RETURN public.cockpit_personal_eod(p_role,day_for);
 END IF;
 SELECT m.email INTO email FROM public.cockpit_members m WHERE m.auth_user_id=uid;
 IF fresh THEN
   INSERT INTO public.cockpit_eod_reports(owner_user_id,owner_email,role,day,energy,stress,answers,computed,body,submitted_at,source_system)
   VALUES(uid,email,p_role,day_for,r.energy,r.stress,r.answers,r.computed,r.body,CASE WHEN submit THEN clock_timestamp() END,'supabase')
   RETURNING id INTO saved_id;
 ELSE
   UPDATE public.cockpit_eod_reports SET energy=r.energy,stress=r.stress,answers=r.answers,computed=r.computed,body=r.body,
    submitted_at=CASE WHEN submit THEN clock_timestamp() END,updated_at=clock_timestamp() WHERE id=r.id
   RETURNING id INTO saved_id;
 END IF;
 IF submit THEN PERFORM public.cockpit_enqueue_personal_eod(saved_id); END IF;
 RETURN public.cockpit_personal_eod(p_role,day_for);
END;
$$;

ALTER TABLE public.eod_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.eod_outbox FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.eod_outbox TO service_role;
REVOKE ALL ON FUNCTION public.cockpit_eod_pick(jsonb,text[]),
 public.cockpit_eod_outbox_payload(public.cockpit_eod_reports,text,text),
 public.cockpit_enqueue_personal_eod(bigint) FROM PUBLIC,anon,authenticated,service_role;
-- For a backfill a person has approved; the worker never needs it.
GRANT EXECUTE ON FUNCTION public.cockpit_enqueue_personal_eod(bigint) TO service_role;
REVOKE ALL ON FUNCTION public.cockpit_personal_eod(text,date),public.cockpit_save_personal_eod(text,jsonb,uuid,date)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_personal_eod(text,date),public.cockpit_save_personal_eod(text,jsonb,uuid,date) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
