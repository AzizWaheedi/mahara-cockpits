BEGIN;
ALTER TABLE public.cockpit_payer_clients ADD COLUMN IF NOT EXISTS cleared_at timestamptz;
COMMENT ON TABLE public.cockpit_manual_payment_state IS 'Finance source revision: manual payments, bank imports and classification, exclusions and payer assignment. totals_revision advances only after verified recomputation.';
CREATE TABLE IF NOT EXISTS public.cockpit_ceo_provider_health(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,provider text NOT NULL,method text NOT NULL CHECK(method='GET'),resource text NOT NULL,phase text NOT NULL,http_status integer,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.cockpit_ceo_provider_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_ceo_provider_health FROM anon,authenticated;
GRANT SELECT,INSERT ON public.cockpit_ceo_provider_health TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.cockpit_ceo_provider_health_id_seq TO service_role;
ALTER TABLE public.cockpit_expense_exclusions ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE public.cockpit_bank_lines ADD COLUMN IF NOT EXISTS base_kind text;
ALTER TABLE public.cockpit_bank_lines ADD COLUMN IF NOT EXISTS manual_kind boolean NOT NULL DEFAULT false;
-- Existing classified rows and human notes are never bulk rewritten by this migration.
CREATE TABLE IF NOT EXISTS public.cockpit_team_status_state(id boolean PRIMARY KEY DEFAULT true CHECK(id),history_ready boolean NOT NULL DEFAULT false);
INSERT INTO public.cockpit_team_status_state(id) VALUES(true) ON CONFLICT DO NOTHING;
ALTER TABLE public.cockpit_team_status_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_team_status_state FROM anon,authenticated;
GRANT SELECT,UPDATE ON public.cockpit_team_status_state TO service_role;
CREATE OR REPLACE FUNCTION public.cockpit_mask_staff_note(t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT left(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(t,''),('[[:space:]]*['||chr(8212)||chr(8211)||'][[:space:]]*'),', ','g'),'[[:alnum:]_.+-]+@[[:alnum:]-]+([.][[:alnum:]-]+)+','[email]','g'),'[+]?[0-9]( ?[0-9]){7,}','[number]','g'),'[[:space:]]+',' ','g')),300)
$$;
REVOKE ALL ON FUNCTION public.cockpit_mask_staff_note(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE IF NOT EXISTS public.cockpit_team_status (
 person_key text PRIMARY KEY, status text NOT NULL CHECK(status IN ('active','paused','left')), since date NOT NULL,
 note text, set_by text NOT NULL, set_at timestamptz NOT NULL DEFAULT now(), source_record jsonb
);
ALTER TABLE public.cockpit_team_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_team_status FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_team_status TO service_role;
ALTER TABLE public.cockpit_person_files ADD COLUMN IF NOT EXISTS upload_status text NOT NULL DEFAULT 'ready' CHECK(upload_status IN ('uploading','ready','removed'));
-- Storage bytes remain private and are retained when the file is removed from the profile.
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('cockpit-people','cockpit-people',false,8388608)
 ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=8388608;
CREATE OR REPLACE FUNCTION public.cockpit_profile_object_allowed(p_path text,p_upload boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.cockpit_is_ceo() AND EXISTS(SELECT 1 FROM cockpit_person_files WHERE path=p_path AND upload_status=CASE WHEN p_upload THEN 'uploading' ELSE 'ready' END)
$$;
REVOKE ALL ON FUNCTION public.cockpit_profile_object_allowed(text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_profile_object_allowed(text,boolean) TO authenticated;
GRANT SELECT,INSERT ON storage.objects TO authenticated;
DROP POLICY IF EXISTS cockpit_profile_upload ON storage.objects;
CREATE POLICY cockpit_profile_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='cockpit-people' AND public.cockpit_profile_object_allowed(name,true));
DROP POLICY IF EXISTS cockpit_profile_read ON storage.objects;
CREATE POLICY cockpit_profile_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='cockpit-people' AND public.cockpit_profile_object_allowed(name,false));
-- Founder-only local state actions. No provider calls and no browser table grants.
CREATE OR REPLACE FUNCTION public.cockpit_ceo_action(p_action text,p_args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who text; old jsonb; result jsonb; obj jsonb; target text; rid text; n bigint; k text; col text; v jsonb; batch_id text; line jsonb; kept jsonb; line_kind text; rate numeric; changed_count integer;
BEGIN
 IF NOT public.cockpit_is_ceo() THEN RAISE EXCEPTION 'Founder access required'; END IF;
 SELECT lower(email) INTO who FROM auth.users WHERE id=auth.uid();
 IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR octet_length(p_args::text)>6000000 THEN RAISE EXCEPTION 'Invalid action data'; END IF;
 -- Serialize local saves, including insert-if-absent and dispatch selection.
 PERFORM pg_advisory_xact_lock(hashtext('cockpit_ceo_action'));
 IF p_action LIKE 'teamStatus.%' AND NOT coalesce((SELECT history_ready FROM cockpit_team_status_state WHERE id),false) THEN RAISE EXCEPTION 'Staffing status history is still being reconciled'; END IF;
 CASE p_action
 WHEN 'settings.get' THEN
  RETURN jsonb_build_object('row',(SELECT to_jsonb(s) FROM cockpit_settings s WHERE key='working_hours'));
 WHEN 'settings.setWorkingHours' THEN
  IF coalesce(p_args->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR coalesce(p_args->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   OR p_args->>'end'<=p_args->>'start' OR coalesce(p_args->>'timezone','Asia/Kuwait')<>'Asia/Kuwait' THEN RAISE EXCEPTION 'Choose valid working hours in Asia/Kuwait'; END IF;
  IF jsonb_typeof(p_args->'days') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Choose working days'; END IF;
  IF jsonb_array_length(p_args->'days') NOT BETWEEN 1 AND 7 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_args->'days') d WHERE d !~ '^[1-7]$') THEN RAISE EXCEPTION 'Choose valid working days'; END IF;
  IF (SELECT count(DISTINCT d) FROM jsonb_array_elements_text(p_args->'days') d)<>jsonb_array_length(p_args->'days') THEN RAISE EXCEPTION 'Duplicate working days'; END IF;
  target:='cockpit_settings'; rid:='working_hours';
  SELECT to_jsonb(s) INTO old FROM cockpit_settings s WHERE key=rid;
  INSERT INTO cockpit_settings(key,value,updated_by) VALUES(rid,jsonb_build_object('start',p_args->>'start','end',p_args->>'end','days',p_args->'days','timezone','Asia/Kuwait'),who)
   ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=who,updated_at=now() RETURNING to_jsonb(cockpit_settings.*) INTO obj;
  result:=jsonb_build_object('ok',true,'row',obj);
 WHEN 'feedback.list' THEN
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY created_at DESC) FROM (SELECT * FROM cockpit_feedback ORDER BY created_at DESC LIMIT 200) f),'[]'::jsonb);
 WHEN 'feedback.add' THEN
  IF coalesce(p_args->>'kind','') NOT IN ('bug','change') OR length(btrim(coalesce(p_args->>'text',''))) NOT BETWEEN 3 AND 4000 THEN RAISE EXCEPTION 'Say what to change or what broke (3 to 4000 characters)'; END IF;
  target:='cockpit_feedback';
  INSERT INTO cockpit_feedback(kind,text,created_by) VALUES(p_args->>'kind',btrim(p_args->>'text'),who) RETURNING to_jsonb(cockpit_feedback.*),id::text INTO obj,rid;
  result:=obj;
 WHEN 'feedback.setStatus' THEN
  IF coalesce(p_args->>'status','') NOT IN ('queued','dismissed','done') THEN RAISE EXCEPTION 'Invalid feedback status'; END IF;
  target:='cockpit_feedback'; rid:=p_args->>'id';
  SELECT to_jsonb(f) INTO old FROM cockpit_feedback f WHERE id=rid::bigint FOR UPDATE;
  IF old IS NULL THEN RAISE EXCEPTION 'Feedback no longer exists'; END IF;
  UPDATE cockpit_feedback SET status=p_args->>'status',updated_at=now(),done_at=CASE WHEN p_args->>'status'='done' THEN now() ELSE done_at END WHERE id=rid::bigint RETURNING to_jsonb(cockpit_feedback.*) INTO obj;
  result:=jsonb_build_object('ok',true);
 WHEN 'feedback.dispatch' THEN
  target:='cockpit_feedback'; batch_id:='batch-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS'); rid:=batch_id;
  SELECT coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) INTO old FROM cockpit_feedback f WHERE status='queued';
  IF jsonb_array_length(old)=0 THEN RETURN jsonb_build_object('dispatched',0,'batch',null); END IF;
  WITH changed AS(UPDATE cockpit_feedback SET status='dispatched',batch=batch_id,dispatched_at=now(),updated_at=now() WHERE status='queued' RETURNING *)
   SELECT jsonb_agg(to_jsonb(changed)),count(*) INTO obj,n FROM changed;
  result:=jsonb_build_object('dispatched',n,'batch',batch_id);
 WHEN 'payers.context' THEN
  IF NOT EXISTS(SELECT 1 FROM cockpit_client_billing_days WHERE captured_at>now()-interval '24 hours') THEN RAISE EXCEPTION 'Client billing source is missing or stale; refresh it before mapping payers'; END IF;
  RETURN jsonb_build_object('cards',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM (SELECT DISTINCT ON(clickup_task_id) clickup_task_id AS "clickupTaskId",client_name AS client FROM cockpit_client_billing_days ORDER BY clickup_task_id,day DESC) c),'mappings',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM cockpit_payer_clients m WHERE cleared_at IS NULL),'[]'::jsonb));
 WHEN 'payers.assign' THEN
  target:='cockpit_payer_clients';rid:=regexp_replace(lower(btrim(p_args->>'payer')),'[^[:alnum:]]','','g');
  IF coalesce(rid,'')='' OR length(coalesce(p_args->>'payer',''))>200 THEN RAISE EXCEPTION 'Choose a payer name up to 200 characters'; END IF;
  SELECT to_jsonb(m) INTO old FROM cockpit_payer_clients m WHERE payer_key=rid FOR UPDATE;
  IF NOT(p_args ? 'clickupTaskId') THEN RAISE EXCEPTION 'Choose a client or clear the assignment'; END IF;
  IF p_args->>'clickupTaskId' IS NULL THEN
   IF old IS NULL OR old->>'cleared_at' IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'cleared',true); END IF;
   UPDATE cockpit_payer_clients SET cleared_at=now() WHERE payer_key=rid RETURNING to_jsonb(cockpit_payer_clients.*) INTO obj;
   result:=jsonb_build_object('ok',true,'cleared',true);
  ELSE
   SELECT to_jsonb(c) INTO v FROM cockpit_client_billing_days c WHERE clickup_task_id=p_args->>'clickupTaskId' ORDER BY day DESC LIMIT 1;
   IF v IS NULL OR (v->>'captured_at')::timestamptz<now()-interval '24 hours' THEN RAISE EXCEPTION 'Client card is missing or stale; refresh before assigning'; END IF;
   INSERT INTO cockpit_payer_clients(payer,payer_key,clickup_task_id,client_name,note,mapped_by) VALUES(btrim(p_args->>'payer'),rid,p_args->>'clickupTaskId',v->>'client_name',CASE WHEN p_args ? 'note' THEN nullif(btrim(p_args->>'note'),'') ELSE old->>'note' END,who)
    ON CONFLICT(payer_key) DO UPDATE SET payer=excluded.payer,clickup_task_id=excluded.clickup_task_id,client_name=excluded.client_name,note=excluded.note,mapped_by=who,mapped_at=now(),cleared_at=NULL RETURNING to_jsonb(cockpit_payer_clients.*) INTO obj;
   result:=jsonb_build_object('ok',true,'client',v->>'client_name');
  END IF;
 WHEN 'ltv.preview' THEN
  IF NOT EXISTS(SELECT 1 FROM cockpit_manual_payment_state WHERE history_ready AND revision=totals_revision) THEN RAISE EXCEPTION 'Finance totals need reconciliation before updating lifetime value'; END IF;
  IF NOT EXISTS(SELECT 1 FROM cockpit_sections WHERE key='money' AND ok AND computed_at>now()-interval '24 hours' AND jsonb_typeof(payload#>'{attribution,transactions}')='array') THEN RAISE EXCEPTION 'Money attribution is missing or stale; refresh it before lifetime value'; END IF;
  IF NOT EXISTS(SELECT 1 FROM cockpit_client_billing_days WHERE captured_at>now()-interval '24 hours') THEN RAISE EXCEPTION 'Client billing source is missing or stale'; END IF;
  IF EXISTS(SELECT 1 FROM (SELECT DISTINCT ON(clickup_task_id) * FROM cockpit_client_billing_days ORDER BY clickup_task_id,day DESC) c WHERE captured_at<now()-interval '24 hours' AND (stage NOT IN ('Paused','Stopped','CANCELLED ONBOARDING','SALES TEAM TO CONTACT') OR stage IS NULL) AND client_name!~*'playing account|\[internal test\]') THEN RAISE EXCEPTION 'Some active client billing rows are stale; refresh before lifetime value'; END IF;
  IF EXISTS(SELECT 1 FROM cockpit_metric_days WHERE metric='money.ltv.card' AND value::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Lifetime value baseline is invalid'; END IF;
  WITH cards AS (SELECT DISTINCT ON(clickup_task_id) * FROM cockpit_client_billing_days ORDER BY clickup_task_id,day DESC),
  base AS(SELECT DISTINCT ON(scope) scope,day,value FROM cockpit_metric_days WHERE metric='money.ltv.card' ORDER BY scope,day),
  rows AS(SELECT c.*,b.day AS base_day,b.value AS baseline,(c.stage NOT IN ('Paused','Stopped','CANCELLED ONBOARDING','SALES TEAM TO CONTACT') OR c.stage IS NULL) AND c.client_name!~*'playing account|\[internal test\]' AS eligible FROM cards c LEFT JOIN base b ON b.scope='client:'||c.clickup_task_id),
  totals AS(SELECT r.*,coalesce(p.logged,0) AS logged,coalesce(p.payment_count,0) AS payment_count FROM rows r LEFT JOIN LATERAL(SELECT sum((t->>'usd')::numeric) AS logged,count(*) AS payment_count FROM cockpit_sections s CROSS JOIN LATERAL jsonb_array_elements(s.payload#>'{attribution,transactions}') t WHERE s.key='money' AND t->>'direction'='in' AND t->>'clientTaskId'=r.clickup_task_id AND (t->>'day')::date>=r.base_day) p ON true),
  final AS(SELECT *,round(baseline::numeric+logged,2) AS ltv_target,round(baseline::numeric+logged-ltv_usd,2) AS delta FROM totals)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(jsonb_build_object('clickupTaskId',clickup_task_id,'client',client_name,'baseline',round(baseline::numeric,2),'baselineDay',base_day,'logged',round(logged,2),'loggedCount',payment_count,'target',ltv_target,'current',ltv_usd,'delta',delta) ORDER BY abs(delta) DESC) FROM final WHERE eligible AND base_day IS NOT NULL AND ltv_usd IS NOT NULL AND (payment_count>0 OR abs(delta)>=0.01)),'[]'::jsonb),
   'missing',coalesce((SELECT jsonb_agg(jsonb_build_object('clickupTaskId',clickup_task_id,'client',client_name,'stage',stage) ORDER BY client_name) FROM final WHERE eligible AND (base_day IS NULL OR ltv_usd IS NULL)),'[]'::jsonb),'outOfScope',(SELECT count(*) FROM final WHERE NOT eligible)) INTO result;
  RETURN result;
 WHEN 'bankImport.overview' THEN
  RETURN jsonb_build_object('statements',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY to_day DESC NULLS LAST,imported_at DESC) FROM (SELECT * FROM cockpit_statements ORDER BY to_day DESC NULLS LAST,imported_at DESC LIMIT 36) t),'[]'::jsonb),'exclusions',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM cockpit_expense_exclusions e WHERE removed_at IS NULL),'[]'::jsonb));
 WHEN 'bankImport.commit' THEN
  target:='cockpit_statements'; rid:=p_args#>>'{statement,id}'; obj:=p_args->'statement';
  IF coalesce(rid,'')='' OR jsonb_typeof(p_args->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_args->'lines') NOT BETWEEN 1 AND 10000 OR length(coalesce(obj->>'account','')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid bank statement'; END IF;
  rate:=CASE obj->>'currency' WHEN 'USD' THEN 1 WHEN 'KWD' THEN 3.26 WHEN 'AED' THEN 0.2723 WHEN 'SAR' THEN 0.2666 WHEN 'QAR' THEN 0.2747 END;
  IF rate IS NULL THEN RAISE EXCEPTION 'No fixed rate for this statement currency'; END IF;
  SELECT to_jsonb(t) INTO old FROM cockpit_statements t WHERE id=rid;
  IF old IS NOT NULL AND (old->>'account'<>obj->>'account' OR old->>'currency'<>obj->>'currency') THEN RAISE EXCEPTION 'Statement identity conflicts with the stored original'; END IF;
  INSERT INTO cockpit_statements(id,account,account_kind,currency,from_day,to_day,lines,total_debit,total_credit,closing_balance,file_name,imported_by)
   SELECT rid,obj->>'account',obj->>'account_kind',obj->>'currency',(obj->>'from_day')::date,(obj->>'to_day')::date,jsonb_array_length(p_args->'lines'),
    coalesce(sum((l->>'amount')::numeric) FILTER(WHERE (l->>'amount')::numeric<0),0),coalesce(sum((l->>'amount')::numeric) FILTER(WHERE (l->>'amount')::numeric>0),0),(obj->>'closing_balance')::numeric,left(obj->>'file_name',120),who
    FROM jsonb_array_elements(p_args->'lines') l ON CONFLICT(id) DO NOTHING;
  kept:='[]'::jsonb;
  FOR line IN SELECT * FROM jsonb_array_elements(p_args->'lines') LOOP
   IF jsonb_typeof(line->'amount') IS DISTINCT FROM 'number' OR abs((line->>'amount')::numeric)>100000000 OR coalesce(line->>'hash','')='' OR coalesce(line->>'day','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR coalesce(line->>'kind','') NOT IN ('client_payment','whop_payout','whop_topup','tap_settlement','own_transfer','refund_in','expense','fee','unknown') THEN RAISE EXCEPTION 'Invalid bank transaction'; END IF;
   -- A duplicate never overwrites a note, matched amount or manual classification.
   IF EXISTS(SELECT 1 FROM cockpit_bank_lines WHERE hash=line->>'hash' AND (day<>(line->>'day')::date OR amount<>(line->>'amount')::numeric OR currency<>obj->>'currency')) THEN RAISE EXCEPTION 'A transaction hash conflicts with a stored original'; END IF;
   line_kind:=line->>'kind';
   IF (line->>'amount')::numeric<0 AND EXISTS(SELECT 1 FROM cockpit_expense_exclusions e WHERE removed_at IS NULL AND ((e.kind='card' AND lower(e.pattern)=lower(obj->>'account')) OR (e.kind='vendor' AND position(lower(e.pattern) in lower(coalesce(line->>'reference','')))>0))) THEN line_kind:='excluded'; END IF;
   INSERT INTO cockpit_bank_lines(statement_id,account,account_kind,trsh,hash,day,amount,balance,reference,currency,usd,kind,category,base_kind)
    VALUES(rid,obj->>'account',obj->>'account_kind',line->>'trsh',line->>'hash',(line->>'day')::date,(line->>'amount')::numeric,(line->>'balance')::numeric,line->>'reference',obj->>'currency',round((line->>'amount')::numeric*rate,2),line_kind,line->>'category',line->>'kind')
    ON CONFLICT(hash) DO NOTHING RETURNING to_jsonb(cockpit_bank_lines.*) INTO v;
   IF v IS NOT NULL THEN kept:=kept||jsonb_build_array(v); END IF;
  END LOOP;
  obj:=jsonb_build_object('statement',(SELECT to_jsonb(t) FROM cockpit_statements t WHERE id=rid),'inserted',kept,'problems',p_args->'problems');
  result:=jsonb_build_object('statementId',rid,'kept',jsonb_array_length(kept),'inserted',kept);
 WHEN 'bankImport.reclassify' THEN
  target:='cockpit_bank_lines'; rid:=p_args->>'id';
  IF coalesce(p_args->>'kind','') NOT IN ('client_payment','whop_payout','whop_topup','tap_settlement','own_transfer','refund_in','expense','fee','excluded','unknown') THEN RAISE EXCEPTION 'Choose a valid bank transaction kind'; END IF;
  SELECT to_jsonb(t) INTO old FROM cockpit_bank_lines t WHERE id=rid::bigint FOR UPDATE;
  IF old IS NULL THEN RAISE EXCEPTION 'Bank transaction no longer exists'; END IF;
  UPDATE cockpit_bank_lines SET kind=p_args->>'kind',manual_kind=true,note=CASE WHEN p_args ? 'note' THEN nullif(btrim(p_args->>'note'),'') ELSE note END WHERE id=rid::bigint RETURNING to_jsonb(cockpit_bank_lines.*) INTO obj;
  result:=jsonb_build_object('ok',true);
 WHEN 'bankImport.addExclusion','bankImport.removeExclusion' THEN
  target:='cockpit_expense_exclusions';
  IF p_action='bankImport.addExclusion' THEN
   IF coalesce(p_args->>'kind','') NOT IN ('card','vendor') OR length(btrim(coalesce(p_args->>'pattern',''))) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'An exclusion needs 3 to 300 characters'; END IF;
   INSERT INTO cockpit_expense_exclusions(kind,pattern,note,added_by) VALUES(p_args->>'kind',btrim(p_args->>'pattern'),nullif(btrim(p_args->>'note'),''),who) RETURNING to_jsonb(cockpit_expense_exclusions.*),id::text INTO obj,rid;
  ELSE
   rid:=p_args->>'id'; SELECT to_jsonb(e) INTO old FROM cockpit_expense_exclusions e WHERE id=rid::bigint AND removed_at IS NULL;
   IF old IS NULL THEN RAISE EXCEPTION 'Exclusion no longer exists'; END IF;
   UPDATE cockpit_expense_exclusions SET removed_at=now() WHERE id=rid::bigint RETURNING to_jsonb(cockpit_expense_exclusions.*) INTO obj;
  END IF;
  changed_count:=0;
  FOR line IN SELECT to_jsonb(l) FROM cockpit_bank_lines l WHERE amount<0 AND NOT manual_kind AND base_kind IS NOT NULL FOR UPDATE LOOP
   line_kind:=line->>'base_kind';
   IF EXISTS(SELECT 1 FROM cockpit_expense_exclusions e WHERE removed_at IS NULL AND ((e.kind='card' AND lower(e.pattern)=lower(line->>'account')) OR (e.kind='vendor' AND position(lower(e.pattern) in lower(coalesce(line->>'reference','')))>0))) THEN line_kind:='excluded'; END IF;
   IF line_kind<>line->>'kind' THEN
    UPDATE cockpit_bank_lines SET kind=line_kind WHERE id=(line->>'id')::bigint;
    INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after) VALUES('bank.exclusionReclassify','cockpit_bank_lines',line->>'id',who,'media-buyer-cockpit','supabase',line,line||jsonb_build_object('kind',line_kind));
    changed_count:=changed_count+1;
   END IF;
  END LOOP;
  result:=jsonb_build_object('id',rid::bigint,'changed',changed_count,'preservedHistorical',(SELECT count(*) FROM cockpit_bank_lines WHERE amount<0 AND base_kind IS NULL));
 WHEN 'teamStatus.list' THEN
  RETURN coalesce((SELECT jsonb_agg((to_jsonb(t)-'source_record')||jsonb_build_object('note',CASE WHEN note IS NULL THEN NULL ELSE cockpit_mask_staff_note(note) END) ORDER BY person_key) FROM cockpit_team_status t),'[]'::jsonb);
 WHEN 'teamStatus.history' THEN
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY created_at DESC) FROM (SELECT action,entity_type,entity_id,actor_email,created_at,(after-'source_record')||jsonb_build_object('note',cockpit_mask_staff_note(after->>'note')) AS after FROM cockpit_audit_log WHERE entity_type='cockpit_team_status' AND entity_id=p_args->>'personKey' ORDER BY created_at DESC LIMIT 20) a),'[]'::jsonb);
 WHEN 'teamStatus.set' THEN
  target:='cockpit_team_status'; rid:=btrim(p_args->>'personKey');
  IF coalesce(rid,'') !~ '^[a-z][a-z_]*:[[:alpha:]]+$' OR length(rid)>80 OR rid<>lower(rid) OR coalesce(p_args->>'status','') NOT IN ('active','paused','left') OR length(coalesce(p_args->>'note',''))>300 THEN RAISE EXCEPTION 'Choose a valid person, status and a note up to 300 characters'; END IF;
  IF coalesce(p_args->>'since','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (p_args->>'since')::date<'2025-01-01'::date OR (p_args->>'since')::date>(now() AT TIME ZONE 'Asia/Kuwait')::date+(CASE WHEN p_args->>'status'='active' THEN 0 ELSE 31 END) THEN RAISE EXCEPTION 'Choose a valid status start date'; END IF;
  SELECT to_jsonb(t) INTO old FROM cockpit_team_status t WHERE person_key=rid FOR UPDATE;
  IF old IS NULL AND NOT EXISTS(SELECT 1 FROM cockpit_sections s CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.payload->'people','[]'::jsonb)||coalesce(s.payload->'inactive','[]'::jsonb)) person WHERE s.key='team' AND person->>'key'=rid) THEN RAISE EXCEPTION 'Person is not on the Management list'; END IF;
  INSERT INTO cockpit_team_status(person_key,status,since,note,set_by) VALUES(rid,p_args->>'status',(p_args->>'since')::date,CASE WHEN p_args ? 'note' AND p_args->>'note' IS DISTINCT FROM cockpit_mask_staff_note(old->>'note') THEN nullif(btrim(p_args->>'note'),'') ELSE old->>'note' END,who)
   ON CONFLICT(person_key) DO UPDATE SET status=excluded.status,since=excluded.since,note=excluded.note,set_by=who,set_at=now() RETURNING to_jsonb(cockpit_team_status.*) INTO obj;
  result:=jsonb_build_object('ok',true);
 WHEN 'profiles.page' THEN
  n:=(p_args->>'personId')::bigint;
  IF NOT EXISTS(SELECT 1 FROM cockpit_people WHERE id=n) THEN RAISE EXCEPTION 'Person no longer exists'; END IF;
  RETURN jsonb_build_object('person',(SELECT to_jsonb(t) FROM cockpit_people t WHERE id=n),'profile',(SELECT to_jsonb(t) FROM cockpit_person_profiles t WHERE person_id=n),
   'files',coalesce((SELECT jsonb_agg(to_jsonb(t)-'path' ORDER BY uploaded_at DESC) FROM cockpit_person_files t WHERE person_id=n AND upload_status='ready'),'[]'::jsonb),
   'cards',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY month DESC) FROM cockpit_scorecards t WHERE person_id=n),'[]'::jsonb),
   'templates',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY title) FROM cockpit_scorecard_templates t),'[]'::jsonb));
 WHEN 'profiles.reserveFile' THEN
  n:=(p_args->>'personId')::bigint; target:='cockpit_person_files';
  IF coalesce(p_args->>'kind','') NOT IN ('cv','contract','other') OR length(btrim(coalesce(p_args->>'name',''))) NOT BETWEEN 1 AND 160 OR (p_args->>'sizeBytes')::bigint NOT BETWEEN 1 AND 8388608 OR p_args->>'sizeBytes' IS NULL THEN RAISE EXCEPTION 'Choose a file up to 8 MB with a name'; END IF;
  INSERT INTO cockpit_person_files(person_id,kind,name,path,size_bytes,mime,uploaded_by,upload_status)
   VALUES(n,p_args->>'kind',btrim(p_args->>'name'),n::text||'/'||gen_random_uuid()::text,(p_args->>'sizeBytes')::bigint,coalesce(nullif(p_args->>'mime',''),'application/octet-stream'),who,'uploading') RETURNING to_jsonb(cockpit_person_files.*),id::text INTO obj,rid;
  result:=jsonb_build_object('id',rid::bigint,'path',obj->>'path','name',obj->>'name');
 WHEN 'profiles.confirmFile' THEN
  target:='cockpit_person_files'; rid:=p_args->>'id';
  SELECT to_jsonb(f) INTO old FROM cockpit_person_files f WHERE id=rid::bigint AND upload_status IN ('uploading','ready') FOR UPDATE;
  IF old IS NULL THEN RAISE EXCEPTION 'File reservation no longer exists'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='cockpit-people' AND name=old->>'path' AND (metadata->>'size')::bigint=(old->>'size_bytes')::bigint) THEN RAISE EXCEPTION 'The uploaded file was not confirmed by storage'; END IF;
  IF old->>'upload_status'='ready' THEN RETURN jsonb_build_object('id',rid::bigint,'name',old->>'name'); END IF;
  UPDATE cockpit_person_files SET upload_status='ready' WHERE id=rid::bigint RETURNING to_jsonb(cockpit_person_files.*) INTO obj;
  result:=jsonb_build_object('id',rid::bigint,'name',obj->>'name');
 WHEN 'profiles.filePath' THEN
  SELECT jsonb_build_object('path',path) INTO result FROM cockpit_person_files WHERE id=(p_args->>'id')::bigint AND upload_status='ready';
  IF result IS NULL THEN RAISE EXCEPTION 'File no longer exists'; END IF;
  RETURN result;
 WHEN 'profiles.removeFile' THEN
  target:='cockpit_person_files'; rid:=p_args->>'id';
  SELECT to_jsonb(f) INTO old FROM cockpit_person_files f WHERE id=rid::bigint FOR UPDATE;
  IF old IS NULL THEN RAISE EXCEPTION 'File no longer exists'; END IF;
  IF old->>'upload_status'='removed' THEN RETURN jsonb_build_object('ok',true); END IF;
  UPDATE cockpit_person_files SET upload_status='removed' WHERE id=rid::bigint RETURNING to_jsonb(cockpit_person_files.*) INTO obj;
  result:=jsonb_build_object('ok',true);
 WHEN 'profiles.templates' THEN
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY title) FROM cockpit_scorecard_templates t),'[]'::jsonb);
 WHEN 'profiles.saveProfile' THEN
  n:=(p_args->>'personId')::bigint; target:='cockpit_person_profiles'; rid:=n::text;
  IF NOT EXISTS(SELECT 1 FROM cockpit_people WHERE id=n) THEN RAISE EXCEPTION 'Person no longer exists'; END IF;
  SELECT to_jsonb(t) INTO old FROM cockpit_person_profiles t WHERE person_id=n;
  INSERT INTO cockpit_person_profiles(person_id,updated_by) VALUES(n,who) ON CONFLICT(person_id) DO NOTHING;
  FOR k,col IN SELECT * FROM (VALUES ('personalGoals','personal_goals'),('professionalGoals','professional_goals'),('greenFlags','green_flags'),('redFlags','red_flags'),('doThis','do_this'),('dontDoThis','dont_do_this'),('notes','notes'),('gradesNote','grades_note')) m(a,b) LOOP
   IF p_args ? k THEN
    IF jsonb_typeof(p_args->k) NOT IN ('string','null') OR length(coalesce(p_args->>k,''))>20000 THEN RAISE EXCEPTION 'Invalid profile text'; END IF;
    EXECUTE format('UPDATE cockpit_person_profiles SET %I=$1 WHERE person_id=$2',col) USING nullif(btrim(p_args->>k),''),n;
   END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['skill','will','culture'] LOOP
   IF p_args ? k THEN
    IF p_args->k<>'null'::jsonb AND (jsonb_typeof(p_args->k)<>'number' OR (p_args->>k)::numeric<>trunc((p_args->>k)::numeric) OR (p_args->>k)::numeric NOT BETWEEN 1 AND 10) THEN RAISE EXCEPTION 'Grades must be whole numbers from 1 to 10'; END IF;
    EXECUTE format('UPDATE cockpit_person_profiles SET %I=$1 WHERE person_id=$2',k) USING (p_args->>k)::integer,n;
   END IF;
  END LOOP;
  UPDATE cockpit_person_profiles SET updated_by=who,updated_at=now() WHERE person_id=n RETURNING to_jsonb(cockpit_person_profiles.*) INTO obj;
  result:=jsonb_build_object('ok',true);
 WHEN 'profiles.saveScorecard' THEN
  target:='cockpit_scorecards'; n:=(p_args->>'personId')::bigint;
  IF coalesce(p_args->>'month','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR coalesce(p_args->>'status','') NOT IN ('draft','final') OR coalesce(p_args->>'roleKey','')='' OR jsonb_typeof(p_args->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid scorecard'; END IF;
  IF (p_args->>'overall' IS NOT NULL AND p_args->>'overall' NOT IN ('A','B','C','D')) OR (p_args->>'status'='final' AND p_args->>'overall' IS NULL) THEN RAISE EXCEPTION 'Choose an overall grade before signing off'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_args->'items') i WHERE jsonb_typeof(i)<>'object' OR coalesce(i->>'key','')='' OR (i->>'grade' IS NOT NULL AND i->>'grade' NOT IN ('A','B','C','D'))) THEN RAISE EXCEPTION 'Invalid scorecard items'; END IF;
  SELECT to_jsonb(t) INTO old FROM cockpit_scorecards t WHERE person_id=n AND month=p_args->>'month';
  INSERT INTO cockpit_scorecards(person_id,month,role_key,title,mission,items,overall,summary,reviewed_on,reviewed_by,status,created_by)
   VALUES(n,p_args->>'month',p_args->>'roleKey',coalesce(nullif(btrim(p_args->>'title'),''),p_args->>'roleKey'),nullif(btrim(p_args->>'mission'),''),p_args->'items',p_args->>'overall',nullif(btrim(p_args->>'summary'),''),coalesce(nullif(p_args->>'reviewedOn','')::date,CASE WHEN p_args->>'status'='final' THEN (now() AT TIME ZONE 'Asia/Kuwait')::date END),CASE WHEN p_args->>'status'='final' THEN who END,p_args->>'status',who)
   ON CONFLICT(person_id,month) DO UPDATE SET role_key=excluded.role_key,title=excluded.title,mission=excluded.mission,items=excluded.items,overall=excluded.overall,summary=excluded.summary,reviewed_on=excluded.reviewed_on,reviewed_by=excluded.reviewed_by,status=excluded.status,updated_at=now()
   RETURNING to_jsonb(cockpit_scorecards.*),id::text INTO obj,rid;
  result:=jsonb_build_object('id',rid::bigint);
 WHEN 'profiles.saveTemplate' THEN
  target:='cockpit_scorecard_templates'; rid:=trim(both '-' from regexp_replace(replace(lower(btrim(p_args->>'roleKey')),'&',' and '),'[^a-z0-9]+','-','g'));
  IF coalesce(rid,'')='' OR jsonb_typeof(p_args->'items') IS DISTINCT FROM 'array' OR jsonb_typeof(p_args->'competencies') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid role template'; END IF;
  SELECT to_jsonb(t) INTO old FROM cockpit_scorecard_templates t WHERE role_key=rid;
  INSERT INTO cockpit_scorecard_templates(role_key,title,mission,items,competencies,bonus,updated_by)
   VALUES(rid,coalesce(nullif(btrim(p_args->>'title'),''),rid),nullif(btrim(p_args->>'mission'),''),p_args->'items',p_args->'competencies',nullif(btrim(p_args->>'bonus'),''),who)
   ON CONFLICT(role_key) DO UPDATE SET title=excluded.title,mission=excluded.mission,items=excluded.items,competencies=excluded.competencies,bonus=excluded.bonus,updated_by=who,updated_at=now()
   RETURNING to_jsonb(cockpit_scorecard_templates.*) INTO obj;
  result:=jsonb_build_object('ok',true);
 ELSE RAISE EXCEPTION 'Unsupported CEO action: %',p_action;
 END CASE;
 IF p_action IN ('payers.assign','bankImport.commit','bankImport.reclassify','bankImport.addExclusion','bankImport.removeExclusion') AND (p_action<>'bankImport.commit' OR jsonb_array_length(kept)>0) THEN
  UPDATE cockpit_manual_payment_state SET revision=revision+1,updated_at=now() WHERE id;
 END IF;
 INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after)
  VALUES(p_action,target,rid,who,'media-buyer-cockpit','supabase',old,obj);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_action(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_action(text,jsonb) TO authenticated;
COMMIT;
