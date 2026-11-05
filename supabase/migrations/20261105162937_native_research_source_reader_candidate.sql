-- OFFLINE REVIEW ONLY: no login, role membership, issuer or cutover. Not a publication fence.
BEGIN;
CREATE ROLE cockpit_native_research_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA native_research_private;
REVOKE ALL ON SCHEMA native_research_private FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE native_research_private.settings (singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), enabled boolean NOT NULL DEFAULT false);
INSERT INTO native_research_private.settings VALUES (true, false);
CREATE TABLE native_research_private.capabilities (
 capability_sha256 text PRIMARY KEY CHECK (capability_sha256 ~ '^[0-9a-f]{64}$'),
 response_id uuid NOT NULL UNIQUE, task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
 form_version integer NOT NULL CHECK (form_version IN (2,3)), comment_id text NOT NULL CHECK (comment_id ~ '^[A-Za-z0-9_-]{1,80}$'),
 comment_sha256 text NOT NULL CHECK (comment_sha256 ~ '^[0-9a-f]{64}$'), issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 run_id text, run_attempt integer, uses integer NOT NULL DEFAULT 0 CHECK (uses BETWEEN 0 AND 6),
 CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '15 minutes'),
 CHECK ((run_id IS NULL AND run_attempt IS NULL AND uses=0) OR (run_id IS NOT NULL AND run_attempt IS NOT NULL
        AND run_id ~ '^[1-9][0-9]{0,19}$' AND run_attempt BETWEEN 1 AND 9999 AND uses BETWEEN 1 AND 6))
);
REVOKE ALL ON ALL TABLES IN SCHEMA native_research_private FROM PUBLIC, anon, authenticated, service_role;

-- Caller must be a separately authenticated service, never the browser. The
-- reader role has no login or members, and the independent gate remains off.
-- Locks do not stop concurrent INSERT of a newer response; the service must
-- recheck and publication additionally needs a shared source-level fence.
CREATE FUNCTION native_research_private.read_source(p_secret text,p_task text,p_response uuid,p_version integer,
 p_comment text,p_digest text,p_run text,p_attempt integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET lock_timeout = '1s' AS $$
DECLARE
 c native_research_private.capabilities%ROWTYPE; r public.cockpit_form_responses%ROWTYPE;
 i public.cockpit_form_invites%ROWTYPE; e public.cockpit_form_effects%ROWTYPE;
 q public.cockpit_clickup_writeback_queue%ROWTYPE; s jsonb; titles jsonb; checked jsonb; printed jsonb;
 cap bytea; caphash text; expected_schema text; enabled boolean;
BEGIN
 SELECT s.enabled INTO enabled FROM native_research_private.settings s WHERE s.singleton FOR SHARE;
 IF enabled IS DISTINCT FROM true
 OR p_secret IS NULL OR p_secret !~ '^[A-Za-z0-9_-]{43}$' OR p_task IS NULL OR p_task !~ '^[A-Za-z0-9_-]{1,40}$'
 OR p_response IS NULL OR p_version IS NULL OR p_version NOT IN (2,3) OR p_comment IS NULL OR p_comment !~ '^[A-Za-z0-9_-]{1,80}$'
 OR p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' OR p_run IS NULL OR p_run !~ '^[1-9][0-9]{0,19}$'
 OR p_attempt IS NULL OR p_attempt NOT BETWEEN 1 AND 9999 THEN RETURN NULL; END IF;
 BEGIN cap := decode(translate(p_secret,'-_','+/') || '=', 'base64'); EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
 IF octet_length(cap) <> 32 OR rtrim(translate(encode(cap,'base64'),'+/','-_'),'=') <> p_secret THEN RETURN NULL; END IF;
 caphash := encode(pg_catalog.sha256(cap),'hex');
 SELECT * INTO c FROM native_research_private.capabilities WHERE capability_sha256=caphash FOR UPDATE;
 IF NOT FOUND OR c.task_id IS DISTINCT FROM p_task OR c.response_id IS DISTINCT FROM p_response
 OR c.form_version IS DISTINCT FROM p_version OR c.comment_id IS DISTINCT FROM p_comment OR c.comment_sha256 IS DISTINCT FROM p_digest
 OR c.issued_at > clock_timestamp() OR c.expires_at <= clock_timestamp() OR c.uses >= 6
 OR (c.run_id IS NOT NULL AND (c.run_id <> p_run OR c.run_attempt <> p_attempt)) THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.cockpit_form_responses WHERE id=p_response FOR SHARE;
 IF NOT FOUND OR r.task_id IS DISTINCT FROM p_task OR r.form_key <> 'onboarding' OR r.form_version IS DISTINCT FROM p_version
 OR r.source NOT IN ('public','portal') OR r.state NOT IN ('submitted','confirmed') OR r.mode <> 'live' OR r.submitted_at IS NULL
 OR coalesce(r.answer_meta->>'canary','false') <> 'false' OR r.invite_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO i FROM public.cockpit_form_invites WHERE id=r.invite_id FOR SHARE;
 IF NOT FOUND OR i.task_id IS DISTINCT FROM p_task OR i.form_key <> 'onboarding' OR i.form_version IS DISTINCT FROM p_version
 OR i.response_id IS DISTINCT FROM p_response THEN RETURN NULL; END IF;
 IF EXISTS (SELECT 1 FROM public.cockpit_form_responses n WHERE n.task_id=p_task AND n.form_key='onboarding' AND n.mode='live'
 AND n.state IN ('submitted','confirmed') AND n.id<>r.id
 AND (n.submitted_at IS NULL OR n.submitted_at >= r.submitted_at)) THEN RETURN NULL; END IF;
 SELECT * INTO e FROM public.cockpit_form_effects WHERE response_id=p_response AND effect_key='raw_answers_comment' FOR SHARE;
 IF NOT FOUND OR e.form_key <> 'onboarding' OR e.owner <> 'cockpit' OR e.delivery <> 'clickup_queue' OR e.state <> 'delivered'
 OR e.plan->>'taskId' IS DISTINCT FROM p_task OR e.delivery_ref IS NULL
 OR e.delivery_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR encode(pg_catalog.sha256(convert_to(e.plan->>'comment_text','UTF8')),'hex') IS DISTINCT FROM p_digest THEN RETURN NULL; END IF;
 SELECT * INTO q FROM public.cockpit_clickup_writeback_queue WHERE id=e.delivery_ref::uuid FOR SHARE;
 IF NOT FOUND OR q.state <> 'delivered' OR q.kind <> 'form' OR q.source_table <> 'cockpit_form_effects'
 OR q.source_id IS DISTINCT FROM e.id::text OR q.task_id IS DISTINCT FROM p_task OR q.dedupe_key IS DISTINCT FROM e.dedupe_key
 OR q.payload->>'responseId' IS DISTINCT FROM p_response::text OR q.payload->>'effectId' IS DISTINCT FROM e.id::text
 OR q.payload->>'effectKey' IS DISTINCT FROM 'raw_answers_comment' OR q.payload->>'taskId' IS DISTINCT FROM p_task
 OR q.payload->>'formKey' IS DISTINCT FROM 'onboarding' OR q.payload->>'commentSha256' IS DISTINCT FROM p_digest
 OR q.progress#>>'{steps,raw_answers_comment,state}' IS DISTINCT FROM 'done'
 OR q.progress#>>'{steps,raw_answers_comment,commentId}' IS DISTINCT FROM p_comment THEN RETURN NULL; END IF;
 SELECT schema INTO s FROM public.cockpit_form_versions WHERE form_key='onboarding' AND version=p_version FOR SHARE;
 expected_schema := CASE p_version WHEN 2 THEN 'acafcf8c397502000d5ff7314e8d21ba513f116e726efdd7b991b7d3cafebf9e'
 WHEN 3 THEN '175f46516fd0bf33423e47dc74a2571e6f881d26d88fdf05bb08b3462f0df3e7' END;
 IF NOT FOUND OR encode(pg_catalog.sha256(convert_to(s::text,'UTF8')),'hex') IS DISTINCT FROM expected_schema
 OR EXISTS (SELECT 1 FROM jsonb_array_elements(s->'fields') x WHERE x->>'type' IN ('file','date')) THEN RETURN NULL; END IF;
 -- Submitted answers must still be protected by the reviewed immutable-response
 -- trigger. If the trigger or its function changes, fail closed.
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
   WHERE t.tgrelid='public.cockpit_form_responses'::regclass AND t.tgname='cockpit_form_responses_guard'
     AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
     AND t.tgtype=19 AND t.tgnargs=0 AND t.tgqual IS NULL AND t.tgattr::text=''
     AND t.tgfoid=to_regprocedure('public.cockpit_form_responses_guard()')
     AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
     AND encode(pg_catalog.sha256(convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') = '37c56aa8e315838c4b101d2e10cb99569f1a2bdacec3d2007bb940c37c8b7b50') THEN RETURN NULL; END IF;
 IF EXISTS (SELECT 1 FROM (VALUES
 ('public.cockpit_form_answers_check_v1(jsonb,jsonb,jsonb)','f9afbecec65c8ab4044afc3724ab2f42a126bf639ff1b8d0074efa1a5b2a2f1c'),
 ('public.cockpit_form_answers_check_v2(jsonb,jsonb,jsonb)','766205feb33703e04fbcf9378a3dc5ea57953b017bc47bc8b978a67181956ced'),
 ('public.cockpit_form_answers_check(jsonb,jsonb,jsonb)','be4fcb2f54b0b166258a2b52e4f86691c12b6762b4cf454173c8e4e472878597'),
 ('public.cockpit_form_kuwait_day(timestamp with time zone)','26c828b405deb8004b7b716d2724943dfb4ef8bfc54a900c04ecb9106d198678'),
 ('public.cockpit_form_rows_blank_cell(jsonb)','a9e607b8d7705054b71f9e3b0de96b7008db9cecdf427b286e0417c7e662e6cd'),
 ('public.cockpit_form_stage4_fields(text)','9606ea9a62d7c6f92438afc2d8541f6541004c855ef1c8ea14f1ddfbd85db349'),
 ('public.cockpit_form_stage4_print_map(integer)','0f090dbc8a5595c8bcdf052b781b11988e3ccee23a3c21db6e32b07b428292d4'),
 ('public.cockpit_form_stage4_print_part(jsonb,jsonb)','643638ebd1d2a7851f26f75a7d28554cb3c58212888dc5997521dfe7b4f21614'),
 ('public.cockpit_form_stage4_print(text,integer,jsonb)','90b4ca1f3f29e3ddae7a1ef6b6d666b80d24a616a5fbe7f508d7c5d8e7fceb5f'),
 ('public.cockpit_form_stage4_raw_answers_text(jsonb,jsonb)','d74340e867e5c0472e72248a687e5a5ec45fa2eef3ed00ad9af79a0b23389fc8'),
 ('public.cockpit_form_stage4_make_text(text,text)','abd590d0cde5ce6bab06221a173ca91273046bb684233fd2b8962e187deaf5fc'),
 ('public.cockpit_form_stage4_text(jsonb)','af13eecc268a7c17bccac0c17d293a298b586689ee44cf5b8be0ed216c3a9cad'),
 ('public.cockpit_form_stage4_typeform_answers(text,jsonb)','6ebdbfe18e84d83b138afeb9b755479c7831072f18ca9cdb7946a5a2559b338e'),
 ('public.cockpit_form_typeform_text(text)','558307f0c58c1cd44253185fee4b0ed9155976aa2693c3820f7bbd494a509733')
 ) AS pins(sig,expected) LEFT JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure(pins.sig)
 WHERE p.oid IS NULL OR pg_catalog.pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
    OR encode(pg_catalog.sha256(convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM pins.expected) THEN RETURN NULL; END IF;
 checked := public.cockpit_form_answers_check(s,r.answers,i.context);
 IF checked->'ok' IS DISTINCT FROM 'true'::jsonb OR checked->'answers' IS DISTINCT FROM r.answers THEN RETURN NULL; END IF;
 printed := public.cockpit_form_stage4_print('onboarding',p_version,r.answers);
 IF jsonb_typeof(printed) IS DISTINCT FROM 'array' OR jsonb_array_length(printed) NOT BETWEEN 1 AND 36 THEN RETURN NULL; END IF;
 SELECT value->'fields' INTO titles FROM public.cockpit_settings WHERE key='onboarding.raw_titles' FOR SHARE;
 IF NOT FOUND OR jsonb_typeof(titles) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
 IF jsonb_array_length(titles) <> 36 OR EXISTS (SELECT 1 FROM jsonb_array_elements(titles) t
   WHERE jsonb_typeof(t->'ref') IS DISTINCT FROM 'string' OR jsonb_typeof(t->'title') IS DISTINCT FROM 'string' OR btrim(t->>'title')='')
   OR (SELECT count(DISTINCT t->>'ref') FROM jsonb_array_elements(titles) t) <> 36
   OR EXISTS (SELECT 1 FROM jsonb_array_elements(printed) a WHERE NOT EXISTS
      (SELECT 1 FROM jsonb_array_elements(titles) t WHERE t->>'ref'=a->>'ref'))
   OR public.cockpit_form_stage4_raw_answers_text(printed,titles) IS DISTINCT FROM e.plan->>'comment_text' THEN RETURN NULL; END IF;
 IF c.expires_at <= clock_timestamp() THEN RETURN NULL; END IF;
 UPDATE native_research_private.capabilities SET run_id=coalesce(run_id,p_run),run_attempt=coalesce(run_attempt,p_attempt),uses=uses+1 WHERE capability_sha256=caphash;
 RETURN jsonb_build_object('taskId',p_task,'responseId',p_response,'schemaVersion',p_version,'commentId',p_comment,
 'commentSha256',p_digest,'submittedAt',to_char(r.submitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'schemaHash',expected_schema,'printerHash',encode(pg_catalog.sha256(convert_to(pg_catalog.pg_get_functiondef('public.cockpit_form_stage4_print(text,integer,jsonb)'::regprocedure),'UTF8')),'hex'),
 'source','native','state',r.state,'mode','live','latest',true,'verifiedReceipt',true,'complete',true,'answers',printed);
END $$;
REVOKE ALL ON FUNCTION native_research_private.read_source(text,text,uuid,integer,text,text,text,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA native_research_private TO cockpit_native_research_reader;
GRANT EXECUTE ON FUNCTION native_research_private.read_source(text,text,uuid,integer,text,text,text,integer) TO cockpit_native_research_reader;
COMMIT;
