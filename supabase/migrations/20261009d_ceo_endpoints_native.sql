-- CEO endpoints that still pointed at Convex, now native to Creative Triage:
--   1. webinar pitch times typed on the Frontend tab,
--   2. the current client extension written to the ClickUp cards,
--   3. the posting desk (create, edit, queue, approve, Instagram progress).
--
-- Additive. Every function checks the founder (the browser RPC through
-- cockpit_is_ceo, the gateway RPCs through the verified actor ID the
-- cockpit-ceo-api gateway passes) and writes its audit row in the same
-- transaction as the change. The one new table has row security on and is
-- reachable only through the service key.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Webinar pitch times. hermes/webinar-pull never writes these columns
--    (cockpit_ingest_webinar_snapshot leaves them out of its upsert), and both
--    CEO refreshes read pitch1_at/pitch2_at from cockpit_webinar_sessions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cockpit_ceo_webinar_pitch_set(p_session_uuid text,p_pitch1_min numeric,p_pitch2_min numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE who text; s public.cockpit_webinar_sessions; after_row jsonb; words1 text; words2 text;
BEGIN
  IF NOT public.cockpit_is_ceo() THEN RAISE EXCEPTION 'Founder access required' USING ERRCODE='42501'; END IF;
  SELECT pg_catalog.lower(pg_catalog.btrim(u.email)) INTO who FROM auth.users u WHERE u.id=auth.uid();
  IF p_session_uuid IS NULL OR pg_catalog.btrim(p_session_uuid)='' OR pg_catalog.length(p_session_uuid)>200 THEN
    RAISE EXCEPTION 'Choose a webinar session.' USING ERRCODE='22023';
  END IF;
  IF p_pitch1_min IS NOT NULL AND (p_pitch1_min<>pg_catalog.trunc(p_pitch1_min) OR p_pitch1_min<0 OR p_pitch1_min>300) THEN
    RAISE EXCEPTION 'Pitch 1 has to be a whole minute between 0 and 300.' USING ERRCODE='22023';
  END IF;
  IF p_pitch2_min IS NOT NULL AND (p_pitch2_min<>pg_catalog.trunc(p_pitch2_min) OR p_pitch2_min<0 OR p_pitch2_min>300) THEN
    RAISE EXCEPTION 'Pitch 2 has to be a whole minute between 0 and 300.' USING ERRCODE='22023';
  END IF;
  IF p_pitch1_min IS NOT NULL AND p_pitch2_min IS NOT NULL AND p_pitch2_min<=p_pitch1_min THEN
    RAISE EXCEPTION 'Pitch 2 has to come after pitch 1.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO s FROM public.cockpit_webinar_sessions WHERE uuid=p_session_uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No Zoom session with that id.' USING ERRCODE='P0002'; END IF;
  IF s.started_at IS NULL THEN RAISE EXCEPTION 'The session has no start time to count minutes from.' USING ERRCODE='22023'; END IF;
  UPDATE public.cockpit_webinar_sessions SET
    pitch1_at=CASE WHEN p_pitch1_min IS NULL THEN NULL ELSE s.started_at+pg_catalog.make_interval(mins=>p_pitch1_min::integer) END,
    pitch2_at=CASE WHEN p_pitch2_min IS NULL THEN NULL ELSE s.started_at+pg_catalog.make_interval(mins=>p_pitch2_min::integer) END,
    pitch_set_by=who,pitch_set_at=pg_catalog.now()
  WHERE uuid=p_session_uuid
  RETURNING pg_catalog.jsonb_build_object('pitch1_at',pitch1_at,'pitch2_at',pitch2_at,'pitch_set_by',pitch_set_by,'pitch_set_at',pitch_set_at) INTO after_row;
  words1:=CASE WHEN p_pitch1_min IS NULL THEN 'not set' ELSE 'minute '||p_pitch1_min::integer END;
  words2:=CASE WHEN p_pitch2_min IS NULL THEN 'not set' ELSE 'minute '||p_pitch2_min::integer END;
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata)
  VALUES('webinar.pitches','cockpit_webinar_sessions',p_session_uuid,who,'media-buyer-cockpit','supabase',
    pg_catalog.jsonb_build_object('pitch1_at',s.pitch1_at,'pitch2_at',s.pitch2_at),after_row,
    pg_catalog.jsonb_build_object('what','Set the webinar pitches: pitch 1 '||words1||', pitch 2 '||words2));
  RETURN pg_catalog.jsonb_build_object('ok',true,'pitch1At',after_row->'pitch1_at','pitch2At',after_row->'pitch2_at',
    'note','The webinar numbers use these times from the next CEO refresh.');
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_webinar_pitch_set(text,numeric,numeric) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_webinar_pitch_set(text,numeric,numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The extension field on ClickUp. The table remembers what the field said
--    after the last confirmed write, so the automatic pass sends only changes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cockpit_ceo_extension_field_writes (
  clickup_task_id text PRIMARY KEY CHECK (clickup_task_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  client_name text NOT NULL,
  weeks integer NOT NULL CHECK (weeks IN (0,1,2,4)),
  until_day date NOT NULL,
  granted_day date NOT NULL,
  field_id text NOT NULL CHECK (field_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  written_by text NOT NULL,
  written_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cockpit_ceo_extension_field_writes IS
  'What the ClickUp field ''Current extension (weeks)'' said on each card after the last confirmed write. Written only by cockpit_ceo_extension_write_record, beside its audit row.';
ALTER TABLE public.cockpit_ceo_extension_field_writes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_ceo_extension_field_writes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.cockpit_ceo_extension_field_writes TO service_role;

-- The automatic pass records its last run here, as tap-charges-sync does.
GRANT SELECT,INSERT,UPDATE ON public.cockpit_sync_state TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_extension_cards()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE newest timestamptz; cards jsonb;
BEGIN
  SELECT pg_catalog.max(captured_at) INTO newest FROM public.cockpit_client_billing_days;
  IF newest IS NULL THEN RAISE EXCEPTION 'the client billing snapshot is missing' USING ERRCODE='P0002'; END IF;
  IF newest<pg_catalog.now()-interval '24 hours' THEN RAISE EXCEPTION 'the client billing snapshot is more than 24 hours old; refresh the ClickUp billing source' USING ERRCODE='22023'; END IF;
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('taskId',c.clickup_task_id,'name',c.client_name,'stage',c.stage) ORDER BY c.clickup_task_id) INTO cards
  FROM (SELECT DISTINCT ON (b.clickup_task_id) b.clickup_task_id,b.client_name,b.stage
        FROM public.cockpit_client_billing_days b ORDER BY b.clickup_task_id,b.day DESC) c;
  RETURN coalesce(cards,'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_extension_cards() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_extension_cards() TO service_role;

-- p_actor_id NULL is the automatic pass; only the service key can call this.
CREATE OR REPLACE FUNCTION public.cockpit_ceo_extension_write_record(p_actor_id uuid,p_write jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE who text; old_row jsonb; new_row jsonb; v_task text; v_weeks integer;
BEGIN
  IF p_actor_id IS NULL THEN
    who:='the cockpit, after the extension form sync';
  ELSE
    who:=public.cockpit_ceo_verified_actor_email(p_actor_id);
    IF who IS NULL THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  END IF;
  IF pg_catalog.jsonb_typeof(p_write) IS DISTINCT FROM 'object'
    OR coalesce(p_write->>'taskId','') !~ '^[A-Za-z0-9_-]{1,64}$'
    OR coalesce(p_write->>'fieldId','') !~ '^[A-Za-z0-9_-]{1,64}$'
    OR coalesce(p_write->>'weeks','') NOT IN ('0','1','2','4')
    OR coalesce(p_write->>'until','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR coalesce(p_write->>'grantedDay','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR pg_catalog.length(pg_catalog.btrim(coalesce(p_write->>'client','')))=0 OR pg_catalog.length(p_write->>'client')>300
    OR pg_catalog.length(coalesce(p_write->>'what',''))>600 THEN
    RAISE EXCEPTION 'The extension write was not confirmed' USING ERRCODE='22023';
  END IF;
  v_task:=p_write->>'taskId'; v_weeks:=(p_write->>'weeks')::integer;
  SELECT pg_catalog.to_jsonb(w) INTO old_row FROM public.cockpit_ceo_extension_field_writes w WHERE w.clickup_task_id=v_task FOR UPDATE;
  INSERT INTO public.cockpit_ceo_extension_field_writes(clickup_task_id,client_name,weeks,until_day,granted_day,field_id,written_by,written_at)
  VALUES(v_task,pg_catalog.btrim(p_write->>'client'),v_weeks,(p_write->>'until')::date,(p_write->>'grantedDay')::date,p_write->>'fieldId',who,pg_catalog.now())
  ON CONFLICT(clickup_task_id) DO UPDATE SET client_name=excluded.client_name,weeks=excluded.weeks,until_day=excluded.until_day,
    granted_day=excluded.granted_day,field_id=excluded.field_id,written_by=excluded.written_by,written_at=excluded.written_at;
  SELECT pg_catalog.to_jsonb(w) INTO new_row FROM public.cockpit_ceo_extension_field_writes w WHERE w.clickup_task_id=v_task;
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata)
  VALUES('extension.write','clickup_task',v_task,who,'media-buyer-cockpit','clickup',old_row,new_row,
    pg_catalog.jsonb_build_object('what',coalesce(p_write->>'what',''),'automatic',p_actor_id IS NULL));
  RETURN pg_catalog.jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_extension_write_record(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_extension_write_record(uuid,jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The posting desk. The VPS worker (radar.py posts) keeps its service-key
--    door; these grants only add to it.
-- ---------------------------------------------------------------------------
GRANT SELECT,INSERT,UPDATE ON public.cockpit_posts,public.cockpit_post_jobs,public.cockpit_channels TO service_role;
-- One Instagram publish at a time per post, across tabs and retries.
ALTER TABLE public.cockpit_posts ADD COLUMN IF NOT EXISTS ig_lease_until timestamptz;
COMMENT ON COLUMN public.cockpit_posts.ig_lease_until IS
  'Set while the cockpit is creating or publishing the Instagram container, so a second press cannot publish the post twice.';

-- The worker writes `published` from the copy it read when its job started.
-- Never let such a write drop a platform that already has a published ID,
-- and close the post when every target has one.
CREATE OR REPLACE FUNCTION public.cockpit_posts_keep_published()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE k text; v jsonb; merged jsonb;
BEGIN
  merged:=coalesce(NEW.published,'{}'::jsonb);
  FOR k,v IN SELECT e.key,e.value FROM pg_catalog.jsonb_each(coalesce(OLD.published,'{}'::jsonb)) e LOOP
    IF coalesce(v->>'id','')<>'' AND coalesce(merged->k->>'id','')='' THEN
      merged:=pg_catalog.jsonb_set(merged,ARRAY[k],v,true);
    END IF;
  END LOOP;
  NEW.published:=merged;
  IF NEW.status='publishing' AND pg_catalog.cardinality(NEW.targets)>0
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.unnest(NEW.targets) t WHERE coalesce(merged->t->>'id','')='') THEN
    NEW.status:='published';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_posts_keep_published() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS cockpit_posts_keep_published ON public.cockpit_posts;
CREATE TRIGGER cockpit_posts_keep_published BEFORE UPDATE ON public.cockpit_posts
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_posts_keep_published();

CREATE OR REPLACE FUNCTION public.cockpit_ceo_posting_actor(p_actor_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE who text;
BEGIN
  who:=public.cockpit_ceo_verified_actor_email(p_actor_id);
  IF who IS NULL THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  RETURN who;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_posting_actor(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_posting_audit(p_action text,p_id text,p_who text,p_before jsonb,p_after jsonb,p_what text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata)
  VALUES(p_action,'cockpit_posts',p_id,p_who,'media-buyer-cockpit','supabase',p_before,p_after,pg_catalog.jsonb_build_object('what',pg_catalog.left(p_what,600)))
$$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_posting_audit(text,text,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

-- A plain string array from JSON, or an exception naming the field.
CREATE OR REPLACE FUNCTION public.cockpit_ceo_posting_texts(p_value jsonb,p_name text,p_max_items integer,p_max_len integer)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
  IF p_value IS NULL OR p_value='null'::jsonb THEN RETURN '{}'::text[]; END IF;
  IF pg_catalog.jsonb_typeof(p_value)<>'array' OR pg_catalog.jsonb_array_length(p_value)>p_max_items
     OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_value) e WHERE pg_catalog.jsonb_typeof(e)<>'string' OR pg_catalog.length(e#>>'{}')>p_max_len) THEN
    RAISE EXCEPTION 'Choose a valid % list.',p_name USING ERRCODE='22023';
  END IF;
  RETURN ARRAY(SELECT e FROM pg_catalog.jsonb_array_elements_text(p_value) WITH ORDINALITY AS x(e,n) ORDER BY n);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_posting_texts(jsonb,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_posting_targets(p_targets text[],p_kind text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE kept text[];
BEGIN
  kept:=ARRAY(SELECT t FROM pg_catalog.unnest(p_targets) WITH ORDINALITY AS x(t,n)
              WHERE t IN ('instagram','youtube','facebook','tiktok','linkedin','x') GROUP BY t ORDER BY pg_catalog.min(n));
  IF pg_catalog.cardinality(kept)=0 THEN RAISE EXCEPTION 'Pick at least one place to post.' USING ERRCODE='22023'; END IF;
  IF p_kind='post' AND kept<>ARRAY['instagram'] THEN RAISE EXCEPTION 'An image post goes to Instagram from here.' USING ERRCODE='22023'; END IF;
  RETURN kept;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_posting_targets(text[],text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_posting_create(p_actor_id uuid,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE who text; v_kind text; v_source text; v_ref text; v_images text[]; v_brief text; v_title text; v_targets text[];
  v_row public.cockpit_posts; f text; label text;
BEGIN
  who:=public.cockpit_ceo_posting_actor(p_actor_id);
  IF pg_catalog.jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid post' USING ERRCODE='22023'; END IF;
  v_kind:=p_args->>'kind'; v_source:=p_args->>'sourceKind';
  IF v_kind IS NULL OR v_kind NOT IN ('reel','video','post') THEN RAISE EXCEPTION 'Choose a reel, a video or a post.' USING ERRCODE='22023'; END IF;
  IF v_source IS NULL OR v_source NOT IN ('upload','drive','url','image') THEN RAISE EXCEPTION 'Choose where the file comes from.' USING ERRCODE='22023'; END IF;
  v_ref:=pg_catalog.btrim(coalesce(p_args->>'sourceRef',''));
  v_images:=ARRAY(SELECT pg_catalog.btrim(i) FROM pg_catalog.unnest(public.cockpit_ceo_posting_texts(p_args->'images','image',100,200)) WITH ORDINALITY AS x(i,n) WHERE pg_catalog.btrim(i)<>'' ORDER BY n);
  v_brief:=nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_args->>'brief','')),2000),'');
  v_title:=nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_args->>'titleWorking','')),200),'');
  IF v_kind='post' THEN
    IF v_source<>'image' THEN RAISE EXCEPTION 'A post is made of images; upload one to ten.' USING ERRCODE='22023'; END IF;
    IF pg_catalog.cardinality(v_images) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'A post needs between one and ten images.' USING ERRCODE='22023'; END IF;
    IF v_brief IS NULL THEN RAISE EXCEPTION 'Say what the post is about, so the caption has a source.' USING ERRCODE='22023'; END IF;
    v_ref:=v_images[1];
  ELSE
    IF v_source='image' THEN RAISE EXCEPTION 'A reel or a video needs a video, not images.' USING ERRCODE='22023'; END IF;
    IF v_ref='' THEN RAISE EXCEPTION 'Point at a file, a Drive link or a link first.' USING ERRCODE='22023'; END IF;
    IF v_source<>'upload' AND v_ref !~ '^(https?://|[A-Za-z0-9_-]{20,}$)' THEN RAISE EXCEPTION 'That does not look like a link.' USING ERRCODE='22023'; END IF;
    v_images:='{}';
  END IF;
  IF pg_catalog.length(v_ref)>2000 THEN RAISE EXCEPTION 'That link is too long.' USING ERRCODE='22023'; END IF;
  -- An uploaded file has to be in the private bucket already, under uploads/.
  FOREACH f IN ARRAY (CASE WHEN v_kind='post' THEN v_images WHEN v_source='upload' THEN ARRAY[v_ref] ELSE '{}'::text[] END) LOOP
    IF f !~ '^uploads/[0-9a-z]+-[A-Za-z0-9_.-]{1,80}$' THEN RAISE EXCEPTION 'Upload the file through the Posting tab first.' USING ERRCODE='22023'; END IF;
    IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='posting' AND o.name=f) THEN
      RAISE EXCEPTION 'The upload has not arrived in storage. Upload the file again.' USING ERRCODE='P0002';
    END IF;
  END LOOP;
  IF p_args ? 'targets' AND p_args->'targets'<>'null'::jsonb THEN
    v_targets:=public.cockpit_ceo_posting_targets(public.cockpit_ceo_posting_texts(p_args->'targets','target',10,20),v_kind);
  ELSE
    v_targets:=CASE v_kind WHEN 'reel' THEN ARRAY['instagram','youtube'] WHEN 'video' THEN ARRAY['youtube'] ELSE ARRAY['instagram'] END;
  END IF;
  INSERT INTO public.cockpit_posts(kind,title_working,source_kind,source_ref,images,brief,targets,status,created_by)
  VALUES(v_kind,v_title,v_source,v_ref,pg_catalog.to_jsonb(v_images),v_brief,v_targets,'new',who) RETURNING * INTO v_row;
  INSERT INTO public.cockpit_post_jobs(kind,post_id,params) VALUES('prepare',v_row.id,'{}'::jsonb);
  label:=coalesce(v_title,pg_catalog.left(v_brief,60),pg_catalog.left(v_ref,60));
  PERFORM public.cockpit_ceo_posting_audit('posting.create',v_row.id::text,who,NULL,
    pg_catalog.jsonb_build_object('kind',v_kind,'sourceKind',v_source,'targets',v_targets,'images',pg_catalog.cardinality(v_images)),
    'Queued '||v_kind||' "'||label||'" for '||pg_catalog.array_to_string(v_targets,' and '));
  RETURN pg_catalog.to_jsonb(v_row);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_posting_create(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_posting_create(uuid,jsonb) TO service_role;

-- p_patch carries column names the gateway has already normalised.
CREATE OR REPLACE FUNCTION public.cockpit_ceo_posting_save(p_actor_id uuid,p_id bigint,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE who text; old_row public.cockpit_posts; new_row public.cockpit_posts; k text; v_targets text[]; v_scheduled timestamptz;
BEGIN
  who:=public.cockpit_ceo_posting_actor(p_actor_id);
  IF pg_catalog.jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid edit' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT pg_catalog.jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('title_working','yt_title','yt_description','yt_tags','ig_caption','ig_hashtags','thumb_text','targets','scheduled_at') THEN
      RAISE EXCEPTION 'The field % cannot be edited here.',k USING ERRCODE='22023';
    END IF;
    IF k IN ('title_working','yt_title','yt_description','ig_caption','thumb_text','scheduled_at') AND pg_catalog.jsonb_typeof(p_patch->k) NOT IN ('string','null') THEN
      RAISE EXCEPTION 'Choose a valid %.',k USING ERRCODE='22023';
    END IF;
  END LOOP;
  SELECT * INTO old_row FROM public.cockpit_posts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That post is gone.' USING ERRCODE='P0002'; END IF;
  IF old_row.status NOT IN ('ready','failed','new') THEN RAISE EXCEPTION 'A % post cannot be edited any more.',old_row.status USING ERRCODE='22023'; END IF;
  IF p_patch='{}'::jsonb THEN RETURN pg_catalog.to_jsonb(old_row); END IF;
  IF pg_catalog.length(p_patch->>'title_working')>200 OR pg_catalog.length(p_patch->>'yt_title')>100 OR pg_catalog.length(p_patch->>'yt_description')>5000
     OR pg_catalog.length(p_patch->>'ig_caption')>2200 OR pg_catalog.length(p_patch->>'thumb_text')>60 THEN
    RAISE EXCEPTION 'An edit is longer than its place allows.' USING ERRCODE='22023';
  END IF;
  IF p_patch ? 'targets' THEN v_targets:=public.cockpit_ceo_posting_targets(public.cockpit_ceo_posting_texts(p_patch->'targets','target',10,20),old_row.kind); END IF;
  IF p_patch ? 'scheduled_at' AND p_patch->>'scheduled_at' IS NOT NULL THEN
    BEGIN v_scheduled:=(p_patch->>'scheduled_at')::timestamptz;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'Choose a valid time to post.' USING ERRCODE='22023'; END;
  END IF;
  UPDATE public.cockpit_posts SET
    title_working=CASE WHEN p_patch ? 'title_working' THEN p_patch->>'title_working' ELSE title_working END,
    yt_title=CASE WHEN p_patch ? 'yt_title' THEN p_patch->>'yt_title' ELSE yt_title END,
    yt_description=CASE WHEN p_patch ? 'yt_description' THEN p_patch->>'yt_description' ELSE yt_description END,
    yt_tags=CASE WHEN p_patch ? 'yt_tags' THEN public.cockpit_ceo_posting_texts(p_patch->'yt_tags','tag',30,30) ELSE yt_tags END,
    ig_caption=CASE WHEN p_patch ? 'ig_caption' THEN p_patch->>'ig_caption' ELSE ig_caption END,
    ig_hashtags=CASE WHEN p_patch ? 'ig_hashtags' THEN public.cockpit_ceo_posting_texts(p_patch->'ig_hashtags','hashtag',30,200) ELSE ig_hashtags END,
    thumb_text=CASE WHEN p_patch ? 'thumb_text' THEN p_patch->>'thumb_text' ELSE thumb_text END,
    targets=CASE WHEN p_patch ? 'targets' THEN v_targets ELSE targets END,
    scheduled_at=CASE WHEN p_patch ? 'scheduled_at' THEN v_scheduled ELSE scheduled_at END
  WHERE id=p_id RETURNING * INTO new_row;
  PERFORM public.cockpit_ceo_posting_audit('posting.save',p_id::text,who,
    (SELECT pg_catalog.jsonb_object_agg(e.key,pg_catalog.to_jsonb(old_row)->e.key) FROM pg_catalog.jsonb_each(p_patch) e),
    (SELECT pg_catalog.jsonb_object_agg(e.key,pg_catalog.to_jsonb(new_row)->e.key) FROM pg_catalog.jsonb_each(p_patch) e),
    'Edited post '||p_id||': '||(SELECT pg_catalog.string_agg(e,', ' ORDER BY e) FROM pg_catalog.jsonb_object_keys(p_patch) e));
  RETURN pg_catalog.to_jsonb(new_row);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_posting_save(uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_posting_save(uuid,bigint,jsonb) TO service_role;

-- Jobs for the VPS worker: render (a new thumbnail), prepare (again), youtube_auth.
CREATE OR REPLACE FUNCTION public.cockpit_ceo_posting_queue(p_actor_id uuid,p_id bigint,p_kind text,p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE who text; old_row public.cockpit_posts; v_params jsonb; v_job bigint; v_action text; v_what text;
BEGIN
  who:=public.cockpit_ceo_posting_actor(p_actor_id);
  IF pg_catalog.jsonb_typeof(p_params) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid job' USING ERRCODE='22023'; END IF;
  IF p_kind='youtube_auth' THEN
    IF p_id IS NOT NULL THEN RAISE EXCEPTION 'The YouTube consent is not about one post.' USING ERRCODE='22023'; END IF;
    IF pg_catalog.jsonb_typeof(p_params->'redirect_url') IS DISTINCT FROM 'string' OR pg_catalog.length(p_params->>'redirect_url')>4000
       OR (p_params->>'redirect_url' !~ 'code=' AND p_params->>'redirect_url' !~ '^4/') THEN
      RAISE EXCEPTION 'Paste the whole address of the page Google sent you to; it carries a code=.' USING ERRCODE='22023';
    END IF;
    v_params:=pg_catalog.jsonb_build_object('redirect_url',p_params->>'redirect_url','by',who);
    v_action:='posting.youtubeConnect'; v_what:='Sent the YouTube consent code to the posting worker';
  ELSIF p_kind IN ('render','prepare') THEN
    SELECT * INTO old_row FROM public.cockpit_posts WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That post is gone.' USING ERRCODE='P0002'; END IF;
    IF p_kind='render' THEN
      IF old_row.status NOT IN ('ready','failed') THEN RAISE EXCEPTION 'A % post is not being re-rendered.',old_row.status USING ERRCODE='22023'; END IF;
      IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(p_params) k WHERE k NOT IN ('thumb_text','frame_ms'))
         OR (p_params ? 'thumb_text' AND (pg_catalog.jsonb_typeof(p_params->'thumb_text')<>'string' OR pg_catalog.length(p_params->>'thumb_text')>60))
         OR (p_params ? 'frame_ms' AND (pg_catalog.jsonb_typeof(p_params->'frame_ms')<>'number' OR (p_params->>'frame_ms')::numeric<0
             OR (p_params->>'frame_ms')::numeric<>pg_catalog.trunc((p_params->>'frame_ms')::numeric))) THEN
        RAISE EXCEPTION 'Choose a line of up to 60 characters or a frame from the strip.' USING ERRCODE='22023';
      END IF;
      v_params:=p_params; v_action:='posting.rerender'; v_what:='Asked for a new thumbnail and cover for post '||p_id;
    ELSE
      IF old_row.status IN ('approved','publishing','published') THEN RAISE EXCEPTION 'A % post is not prepared again.',old_row.status USING ERRCODE='22023'; END IF;
      v_params:='{}'::jsonb; v_action:='posting.reprepare'; v_what:='Asked the worker to prepare post '||p_id||' again';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown posting job' USING ERRCODE='22023';
  END IF;
  -- A double press returns the job already waiting and changes nothing.
  SELECT j.id INTO v_job FROM public.cockpit_post_jobs j
   WHERE j.kind=p_kind AND j.status='queued' AND j.post_id IS NOT DISTINCT FROM p_id AND j.params=v_params ORDER BY j.id LIMIT 1;
  IF v_job IS NOT NULL THEN RETURN pg_catalog.jsonb_build_object('jobId',v_job,'existing',true); END IF;
  IF p_kind='render' AND p_params ? 'thumb_text' THEN UPDATE public.cockpit_posts SET thumb_text=nullif(p_params->>'thumb_text','') WHERE id=p_id; END IF;
  IF p_kind='prepare' THEN UPDATE public.cockpit_posts SET status='new',error=NULL WHERE id=p_id; END IF;
  INSERT INTO public.cockpit_post_jobs(kind,post_id,params) VALUES(p_kind,p_id,v_params) RETURNING id INTO v_job;
  PERFORM public.cockpit_ceo_posting_audit(v_action,coalesce(p_id::text,'youtube'),who,
    CASE WHEN old_row.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object('status',old_row.status,'thumb_text',old_row.thumb_text) END,
    pg_catalog.jsonb_build_object('job',v_job,'kind',p_kind,'params',v_params-'redirect_url'),v_what);
  RETURN pg_catalog.jsonb_build_object('jobId',v_job,'existing',false);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_posting_queue(uuid,bigint,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_posting_queue(uuid,bigint,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_posting_discard(p_actor_id uuid,p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE who text; old_row public.cockpit_posts; new_row public.cockpit_posts;
BEGIN
  who:=public.cockpit_ceo_posting_actor(p_actor_id);
  SELECT * INTO old_row FROM public.cockpit_posts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That post is gone.' USING ERRCODE='P0002'; END IF;
  IF old_row.status='published' THEN RAISE EXCEPTION 'A published post stays on the list.' USING ERRCODE='22023'; END IF;
  IF old_row.status='publishing' THEN RAISE EXCEPTION 'A post that is publishing cannot be discarded. Check Instagram first.' USING ERRCODE='22023'; END IF;
  IF old_row.status='discarded' THEN RETURN pg_catalog.to_jsonb(old_row); END IF;
  UPDATE public.cockpit_posts SET status='discarded' WHERE id=p_id RETURNING * INTO new_row;
  PERFORM public.cockpit_ceo_posting_audit('posting.discard',p_id::text,who,pg_catalog.jsonb_build_object('status',old_row.status),
    pg_catalog.jsonb_build_object('status','discarded'),'Discarded post '||p_id);
  RETURN pg_catalog.to_jsonb(new_row);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_posting_discard(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_posting_discard(uuid,bigint) TO service_role;

-- Approval is the only door to publishing. YouTube is queued for the worker;
-- the gateway publishes Instagram right after this returns.
CREATE OR REPLACE FUNCTION public.cockpit_ceo_posting_approve(p_actor_id uuid,p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE who text; old_row public.cockpit_posts; new_row public.cockpit_posts; not_live text;
BEGIN
  who:=public.cockpit_ceo_posting_actor(p_actor_id);
  SELECT * INTO old_row FROM public.cockpit_posts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That post is gone.' USING ERRCODE='P0002'; END IF;
  IF old_row.status<>'ready' THEN RAISE EXCEPTION 'A % post cannot be approved.',old_row.status USING ERRCODE='22023'; END IF;
  IF pg_catalog.cardinality(old_row.targets)=0 THEN RAISE EXCEPTION 'Pick at least one place to post.' USING ERRCODE='22023'; END IF;
  SELECT pg_catalog.string_agg(t,', ') INTO not_live FROM pg_catalog.unnest(old_row.targets) t WHERE t NOT IN ('instagram','youtube');
  IF not_live IS NOT NULL THEN RAISE EXCEPTION '% cannot be published from here yet; take them off the targets first.',not_live USING ERRCODE='22023'; END IF;
  IF 'youtube'=ANY(old_row.targets) AND coalesce(pg_catalog.btrim(old_row.yt_title),'')='' THEN RAISE EXCEPTION 'YouTube needs a title.' USING ERRCODE='22023'; END IF;
  IF 'instagram'=ANY(old_row.targets) AND coalesce(pg_catalog.btrim(old_row.ig_caption),'')='' THEN RAISE EXCEPTION 'Instagram needs a caption.' USING ERRCODE='22023'; END IF;
  UPDATE public.cockpit_posts SET status='approved',approved_by=who,approved_at=pg_catalog.now(),error=NULL WHERE id=p_id RETURNING * INTO new_row;
  IF 'youtube'=ANY(old_row.targets) THEN
    INSERT INTO public.cockpit_post_jobs(kind,post_id,params) VALUES('publish_youtube',p_id,'{"privacy":"public"}'::jsonb);
  END IF;
  PERFORM public.cockpit_ceo_posting_audit('posting.approve',p_id::text,who,pg_catalog.jsonb_build_object('status',old_row.status),
    pg_catalog.jsonb_build_object('status','approved','targets',old_row.targets),
    'Approved "'||coalesce(old_row.yt_title,old_row.title_working,p_id::text)||'" for '||pg_catalog.array_to_string(old_row.targets,' and '));
  RETURN pg_catalog.to_jsonb(new_row);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_posting_approve(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_posting_approve(uuid,bigint) TO service_role;

-- The Instagram publish, step by step: claim (a five-minute lease), container,
-- published, release (with or without an error). A real publish is always
-- recorded, even when the lease has run out.
CREATE OR REPLACE FUNCTION public.cockpit_ceo_posting_instagram(p_actor_id uuid,p_id bigint,p_stage text,p_value jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE who text; old_row public.cockpit_posts; new_row public.cockpit_posts; ig jsonb; v_status text;
BEGIN
  who:=public.cockpit_ceo_posting_actor(p_actor_id);
  IF pg_catalog.jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid Instagram step' USING ERRCODE='22023'; END IF;
  SELECT * INTO old_row FROM public.cockpit_posts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That post is gone.' USING ERRCODE='P0002'; END IF;
  ig:=coalesce(old_row.published->'instagram','{}'::jsonb);
  IF p_stage='claim' THEN
    IF NOT 'instagram'=ANY(old_row.targets) THEN RAISE EXCEPTION 'Instagram is not one of this post''s targets.' USING ERRCODE='22023'; END IF;
    IF old_row.status NOT IN ('approved','publishing','failed') THEN RAISE EXCEPTION 'A % post has nothing to finish.',old_row.status USING ERRCODE='22023'; END IF;
    IF coalesce(ig->>'id','')<>'' THEN RETURN pg_catalog.to_jsonb(old_row); END IF;
    IF old_row.ig_lease_until>pg_catalog.now() THEN
      RAISE EXCEPTION 'Instagram is already being published for this post. Check again in a minute.' USING ERRCODE='55P03';
    END IF;
    UPDATE public.cockpit_posts SET ig_lease_until=pg_catalog.now()+interval '5 minutes',
      status=CASE WHEN status='failed' THEN 'publishing' ELSE status END,
      error=CASE WHEN status='failed' THEN NULL ELSE error END
    WHERE id=p_id RETURNING * INTO new_row;
    PERFORM public.cockpit_ceo_posting_audit('posting.instagram.claim',p_id::text,who,pg_catalog.jsonb_build_object('status',old_row.status),
      pg_catalog.jsonb_build_object('status',new_row.status),'Started the Instagram publish of post '||p_id);
  ELSIF p_stage='container' THEN
    IF coalesce(p_value->>'container','') !~ '^[0-9]{1,40}$' THEN RAISE EXCEPTION 'Meta gave no valid container.' USING ERRCODE='22023'; END IF;
    IF old_row.ig_lease_until IS NULL OR old_row.ig_lease_until<=pg_catalog.now() THEN
      RAISE EXCEPTION 'The Instagram publish took too long. Press Check Instagram to finish it.' USING ERRCODE='40001';
    END IF;
    UPDATE public.cockpit_posts SET status='publishing',
      published=published||pg_catalog.jsonb_build_object('instagram',pg_catalog.jsonb_build_object('container',p_value->>'container','at',pg_catalog.now()))
    WHERE id=p_id RETURNING * INTO new_row;
    PERFORM public.cockpit_ceo_posting_audit('posting.instagram.container',p_id::text,who,ig,new_row.published->'instagram',
      'Meta took the Instagram container for post '||p_id);
  ELSIF p_stage='published' THEN
    IF coalesce(p_value->>'id','') !~ '^[0-9]{1,40}$' OR coalesce(p_value->>'container','') !~ '^[0-9]{1,40}$'
       OR (p_value->>'permalink' IS NOT NULL AND p_value->>'permalink' !~ '^https://(www\.)?instagram\.com/[A-Za-z0-9_./?=&-]{1,255}$') THEN
      RAISE EXCEPTION 'Meta''s publish receipt is invalid.' USING ERRCODE='22023';
    END IF;
    ig:=pg_catalog.jsonb_build_object('id',p_value->>'id','permalink',p_value->'permalink','container',p_value->>'container','at',pg_catalog.now());
    UPDATE public.cockpit_posts SET published=published||pg_catalog.jsonb_build_object('instagram',ig),ig_lease_until=NULL,error=NULL,
      status=CASE WHEN status IN ('discarded') THEN status ELSE 'publishing' END
    WHERE id=p_id RETURNING * INTO new_row;  -- the keep-published trigger closes the post when every target is out
    PERFORM public.cockpit_ceo_posting_audit('posting.publish',p_id::text,who,old_row.published,new_row.published,
      'Published on Instagram: '||coalesce(p_value->>'permalink',p_value->>'id'));
  ELSIF p_stage='release' THEN
    IF p_value ? 'error' AND (pg_catalog.jsonb_typeof(p_value->'error')<>'string' OR pg_catalog.length(p_value->>'error')>300) THEN
      RAISE EXCEPTION 'Invalid Instagram error' USING ERRCODE='22023';
    END IF;
    UPDATE public.cockpit_posts SET ig_lease_until=NULL,
      error=CASE WHEN p_value ? 'error' THEN p_value->>'error' ELSE error END,
      published=CASE WHEN p_value->>'dropContainer'='true' AND coalesce(ig->>'id','')='' THEN published-'instagram' ELSE published END
    WHERE id=p_id RETURNING * INTO new_row;
    PERFORM public.cockpit_ceo_posting_audit('posting.instagram.release',p_id::text,who,pg_catalog.jsonb_build_object('error',old_row.error),
      pg_catalog.jsonb_build_object('error',new_row.error),
      CASE WHEN p_value ? 'error' THEN 'Instagram did not publish post '||p_id||': '||(p_value->>'error') ELSE 'Meta is still processing post '||p_id||'; Check Instagram finishes it' END);
  ELSE
    RAISE EXCEPTION 'Unknown Instagram step' USING ERRCODE='22023';
  END IF;
  RETURN pg_catalog.to_jsonb(new_row);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_posting_instagram(uuid,bigint,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_posting_instagram(uuid,bigint,text,jsonb) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
