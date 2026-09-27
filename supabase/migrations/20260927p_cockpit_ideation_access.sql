BEGIN;
-- The board is intentionally shared across creative, media buyer and editor teams.
-- Keep confirmed legacy editor seats during the coordinated portal cutover.
CREATE OR REPLACE FUNCTION public.cockpit_ideation_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL)
 AND (public.cockpit_has_role('creative') OR public.cockpit_has_role('media_buyer') OR public.cockpit_has_role('editor') OR public.cockpit_is_ceo()
 OR (public.is_editor() AND NOT EXISTS(SELECT 1 FROM public.cockpit_members m WHERE m.auth_user_id=auth.uid() AND NOT m.active)));
$$;
REVOKE ALL ON FUNCTION public.cockpit_ideation_allowed() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_ideation_allowed() TO authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_ideation_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE email text; label text; before_data jsonb; after_data jsonb; editable text[];
BEGIN
 -- Service workers retain their existing capture/result-writing contract.
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF NOT public.cockpit_ideation_allowed() THEN RAISE EXCEPTION 'Active ideation access required' USING ERRCODE='42501'; END IF;
 SELECT lower(btrim(u.email)),coalesce(nullif(btrim(m.name),''),split_part(u.email,'@',1)) INTO email,label
 FROM auth.users u LEFT JOIN public.cockpit_members m ON m.auth_user_id=u.id WHERE u.id=auth.uid();
 after_data:=to_jsonb(NEW); before_data:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
 IF TG_TABLE_NAME='ideation_posts' AND current_setting('cockpit.ideation_copy',true)='verified' THEN
  NULL; -- Only the private server-side copy below sets this transaction-local marker.
 ELSIF TG_TABLE_NAME='ideation_posts' THEN
  editable:=ARRAY['status','saved_by','saved_by_name','saved_at','saved_note','note','dismissed_by','dismissed_at','attempts','error','at','updated_at'];
  IF TG_OP='INSERT' THEN
   IF NEW.origin IS DISTINCT FROM 'manual' OR NEW.status IS DISTINCT FROM 'queued' OR NEW.url !~* '^https?://' THEN RAISE EXCEPTION 'Paste a valid post link'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_each(after_data-ARRAY['key','platform','url','origin','status','at','created_at','updated_at','industry','tags','note','saved_note','pasted_by','pasted_by_name','pasted_at','saved_by','saved_by_name','saved_at','attempts']) e WHERE e.value NOT IN ('null'::jsonb,'[]'::jsonb)) THEN RAISE EXCEPTION 'Captured content is worker-owned'; END IF;
   NEW:=jsonb_populate_record(NEW,jsonb_build_object('pasted_by',email,'pasted_by_name',label,'pasted_at',now(),'saved_by',email,'saved_by_name',label,'saved_at',now(),'attempts',0,'created_at',now(),'updated_at',now()));
  ELSE
   IF (after_data-editable) IS DISTINCT FROM (before_data-editable) THEN RAISE EXCEPTION 'Captured content is worker-owned'; END IF;
   IF (after_data->'attempts' IS DISTINCT FROM before_data->'attempts' AND coalesce(NEW.attempts,0)<>0) OR (after_data->'error' IS DISTINCT FROM before_data->'error' AND NEW.error IS NOT NULL) THEN RAISE EXCEPTION 'Fetch results are worker-owned'; END IF;
   IF NEW.status NOT IN ('proposed','queued','saved','dismissed') OR (NEW.status='saved' AND before_data->>'captured_at' IS NULL AND OLD.status<>'saved') THEN RAISE EXCEPTION 'The worker has not saved this post yet'; END IF;
   IF OLD.status='fetching' AND NEW.status<>'dismissed' THEN RAISE EXCEPTION 'This post is being fetched. Wait for it to finish'; END IF;
   NEW:=jsonb_populate_record(NEW,jsonb_build_object('saved_by',coalesce(before_data->>'saved_by',email),'saved_by_name',coalesce(before_data->>'saved_by_name',label),'saved_at',coalesce(before_data->'saved_at','null'::jsonb)));
   IF before_data->>'saved_at' IS NULL AND NEW.status IN ('queued','saved') THEN NEW:=jsonb_populate_record(NEW,jsonb_build_object('saved_at',now())); END IF;
   IF NEW.status='dismissed' THEN NEW:=jsonb_populate_record(NEW,jsonb_build_object('dismissed_by',email,'dismissed_at',now()));
   ELSE NEW:=jsonb_populate_record(NEW,jsonb_build_object('dismissed_by',NULL,'dismissed_at',NULL)); END IF;
  END IF;
 ELSIF TG_TABLE_NAME='ideation_watchlist' THEN
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM jsonb_each(after_data-ARRAY['key','platform','kind','value','industry','tags','active','note','source','added_by','added_at','updated_at']) e WHERE e.value<>'null'::jsonb) THEN RAISE EXCEPTION 'Scan results are worker-owned'; END IF;
  IF TG_OP='UPDATE' AND (after_data-ARRAY['industry','tags','active','note','source','added_by','updated_at']) IS DISTINCT FROM (before_data-ARRAY['industry','tags','active','note','source','added_by','updated_at']) THEN RAISE EXCEPTION 'A watchlist source cannot be replaced'; END IF;
  NEW:=jsonb_populate_record(NEW,jsonb_build_object('added_by',coalesce(before_data->>'added_by',email),'updated_at',now()));
 ELSIF TG_TABLE_NAME='ideation_requests' THEN
  IF TG_OP<>'INSERT' OR NEW.status IS DISTINCT FROM 'queued' OR NEW.kind NOT IN ('profile','ads') OR nullif(btrim(NEW.input),'') IS NULL THEN RAISE EXCEPTION 'Create a queued scrape request'; END IF;
  IF NEW.params->>'client' IS NOT NULL AND NOT public.cockpit_client_allowed(NEW.params->>'client') THEN RAISE EXCEPTION 'Client is outside your assigned clients' USING ERRCODE='42501'; END IF;
  NEW:=jsonb_populate_record(NEW,jsonb_build_object('requested_by',email,'requested_by_name',label,'created_at',now(),'updated_at',now(),'attempts',0,'started_at',NULL,'finished_at',NULL,'result',NULL,'error',NULL));
 END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,before,after)
 VALUES(lower(TG_OP),TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'key',to_jsonb(NEW)->>'id'),email,'ideation',CASE WHEN TG_OP='UPDATE' THEN before_data ELSE NULL END,to_jsonb(NEW));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ideation_write_guard() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_ideation_copy(p_source text,p_id text,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE src jsonb; body jsonb; k text; email text; label text; prior public.ideation_posts; rec public.ideation_posts; previous_marker text;
BEGIN
 IF NOT public.cockpit_ideation_allowed() THEN RAISE EXCEPTION 'Active ideation access required' USING ERRCODE='42501'; END IF;
 SELECT lower(btrim(u.email)),coalesce(nullif(btrim(m.name),''),split_part(u.email,'@',1)) INTO email,label FROM auth.users u LEFT JOIN public.cockpit_members m ON m.auth_user_id=u.id WHERE u.id=auth.uid();
 IF p_source='foreplay' THEN
  SELECT to_jsonb(f) INTO src FROM public.foreplay_ads f WHERE f.id=p_id;
  IF src IS NULL THEN RAISE EXCEPTION 'That ad is no longer in the swipe file'; END IF;
  k:='foreplay:'||p_id;
  body:=jsonb_build_object('platform',lower(coalesce(src->'publisher_platform'->>0,'meta')),'url',coalesce(nullif(src->>'link_url',''),src->>'foreplay_url'),'origin','foreplay','industry','other','author_name',src->>'name','caption',left(coalesce(nullif(src->>'headline',''),nullif(src->>'description',''),src->>'name',''),2000),'thumb_url',coalesce(src->>'thumbnail',src->>'image'),'media_url',src->>'video','transcript',nullif(src->>'full_transcription',''),'duration_sec',src->'video_duration','running_days',src->'running_duration','why_it_works',CASE WHEN (src->>'running_duration')::numeric>0 THEN 'Still running after '||(src->>'running_duration')||' days, which is why it was kept.' END);
 ELSIF p_source='winner' THEN
  SELECT to_jsonb(w) INTO src FROM public.winner_ads w WHERE w.ad_id=p_id;
  IF src IS NULL THEN RAISE EXCEPTION 'Winner is not available in the shared archive' USING ERRCODE='42501'; END IF;
  IF coalesce((src->>'cockpit_manual_only')::boolean,false) THEN
   IF NOT public.cockpit_winner_saved_visible(p_id) THEN RAISE EXCEPTION 'This saved winner has been withdrawn'; END IF;
  END IF;
  k:='meta_ads:'||p_id;
  body:=jsonb_build_object('platform','meta_ads','post_id',p_id,'url',coalesce(src->>'watch_url','https://www.facebook.com/ads/library/?id='||p_id),'origin','library','industry','ours','author_name',src->>'client','client',src->>'client','advertiser',src->>'client','caption',coalesce(nullif(src->>'headline',''),src->>'body',''),'transcript',src->>'transcript','thumb_url',src->>'thumb_url','voice',src->>'voice','cta',src->>'cta','ad_format',src->>'format','spend',src->'spend','leads',src->'leads','cpl',src->'cpl','hook',CASE WHEN src->>'hook' IS NOT NULL THEN jsonb_build_object('text',src->>'hook','type','') END,'language',src->>'service_line','tags',jsonb_build_array('ours','winner'));
 ELSIF p_source='client_ad' THEN
  SELECT to_jsonb(a)||jsonb_build_object('client',c.client_name) INTO src FROM public.cockpit_ads a JOIN public.cockpit_campaigns c ON c.raw_data->>'campaignName'=a.campaign_name WHERE a.meta_ad_id=p_id AND coalesce((to_jsonb(a)->>'source_deleted')::boolean,false)=false AND coalesce((to_jsonb(c)->>'source_deleted')::boolean,false)=false AND public.cockpit_client_allowed(c.client_name) ORDER BY a.synced_at DESC NULLS LAST LIMIT 1;
  IF src IS NULL THEN RAISE EXCEPTION 'Ad is not available for your assigned clients' USING ERRCODE='42501'; END IF;
  k:='meta_ads:'||p_id;
  body:=jsonb_build_object('platform','meta_ads','post_id',p_id,'url','https://www.facebook.com/ads/library/?id='||p_id,'origin','library','industry','ours','client',src->>'client','author_name',src->>'client','caption',src->>'ad_name','thumb_url',coalesce(src->>'still_url',src->>'thumbnail_url'),'spend',src->'spend','leads',src->'leads','cpl',CASE WHEN (src->>'leads')::numeric>0 THEN (src->>'spend')::numeric/(src->>'leads')::numeric END,'tags',jsonb_build_array('ours'));
 ELSE RAISE EXCEPTION 'Choose a saved ad source'; END IF;
 IF nullif(body->>'url','') IS NULL THEN RAISE EXCEPTION 'That ad has no link to save'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(k,0));
 SELECT * INTO prior FROM public.ideation_posts WHERE key=k FOR UPDATE;
 body:=body||jsonb_build_object('key',k,'status',CASE WHEN prior.status='dismissed' THEN 'saved' ELSE coalesce(prior.status,'saved') END,'at',now(),'updated_at',now(),'created_at',coalesce(prior.created_at,now()),'saved_by',coalesce(prior.saved_by,email),'saved_by_name',coalesce(prior.saved_by_name,label),'saved_at',coalesce(prior.saved_at,now()),'pasted_by',coalesce(prior.pasted_by,email),'pasted_by_name',coalesce(prior.pasted_by_name,label),'saved_note',coalesce(nullif(left(btrim(p_note),500),''),prior.saved_note),'note',coalesce(nullif(left(btrim(p_note),500),''),prior.note),'attempts',coalesce(prior.attempts,0));
 rec:=jsonb_populate_record(prior,body);
 rec.tags:=coalesce(rec.tags,'[]'::jsonb);rec.on_screen_text:=coalesce(rec.on_screen_text,'[]'::jsonb);rec.beats:=coalesce(rec.beats,'[]'::jsonb);rec.adaptations:=coalesce(rec.adaptations,'[]'::jsonb);rec.warnings:=coalesce(rec.warnings,'[]'::jsonb);
 previous_marker:=current_setting('cockpit.ideation_copy',true);
 PERFORM set_config('cockpit.ideation_copy','verified',true);
 IF prior.key IS NULL THEN
  INSERT INTO public.ideation_posts SELECT (rec).*;
 ELSE
  UPDATE public.ideation_posts SET platform=rec.platform,url=rec.url,origin=rec.origin,industry=rec.industry,status=rec.status,author_name=rec.author_name,caption=rec.caption,thumb_url=rec.thumb_url,media_url=rec.media_url,transcript=rec.transcript,duration_sec=rec.duration_sec,running_days=rec.running_days,why_it_works=rec.why_it_works,client=rec.client,advertiser=rec.advertiser,voice=rec.voice,cta=rec.cta,ad_format=rec.ad_format,spend=rec.spend,leads=rec.leads,cpl=rec.cpl,hook=rec.hook,language=rec.language,saved_by=rec.saved_by,saved_by_name=rec.saved_by_name,saved_at=rec.saved_at,saved_note=rec.saved_note,note=rec.note,updated_at=rec.updated_at WHERE key=k;
 END IF;
 PERFORM set_config('cockpit.ideation_copy',coalesce(previous_marker,''),true);
 RETURN jsonb_build_object('key',k,'status',rec.status);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ideation_copy(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_ideation_copy(text,text,text) TO authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ideation_posts','ideation_watchlist','ideation_requests'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS cockpit_ideation_guard ON public.%I',t);
  EXECUTE format('CREATE TRIGGER cockpit_ideation_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cockpit_ideation_write_guard()',t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS cockpit_ideation_member_read ON public.%I',t);
  EXECUTE format('CREATE POLICY cockpit_ideation_member_read ON public.%I FOR SELECT TO authenticated USING(public.cockpit_ideation_allowed())',t);
  EXECUTE format('DROP POLICY IF EXISTS cockpit_ideation_member_insert ON public.%I',t);
  EXECUTE format('CREATE POLICY cockpit_ideation_member_insert ON public.%I FOR INSERT TO authenticated WITH CHECK(public.cockpit_ideation_allowed())',t);
  EXECUTE format('DROP POLICY IF EXISTS cockpit_ideation_active_guard ON public.%I',t);
  EXECUTE format('CREATE POLICY cockpit_ideation_active_guard ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(public.cockpit_ideation_allowed()) WITH CHECK(public.cockpit_ideation_allowed())',t);
  EXECUTE format('GRANT SELECT,INSERT ON public.%I TO authenticated',t);
  EXECUTE format('REVOKE DELETE ON public.%I FROM authenticated',t);
  IF t<>'ideation_requests' THEN
   EXECUTE format('DROP POLICY IF EXISTS cockpit_ideation_member_update ON public.%I',t);
   EXECUTE format('CREATE POLICY cockpit_ideation_member_update ON public.%I FOR UPDATE TO authenticated USING(public.cockpit_ideation_allowed()) WITH CHECK(public.cockpit_ideation_allowed())',t);
   EXECUTE format('GRANT UPDATE ON public.%I TO authenticated',t);
  END IF;
 END LOOP;
END $$;
-- Like the original winners/Foreplay pages, reusable ad examples are shared
-- between creative roles; this does not widen access to private client sources.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['winner_ads','foreplay_ads','foreplay_boards'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS cockpit_ideation_source_read ON public.%I',t);
  EXECUTE format('CREATE POLICY cockpit_ideation_source_read ON public.%I FOR SELECT TO authenticated USING(public.cockpit_ideation_allowed())',t);
  EXECUTE format('DROP POLICY IF EXISTS cockpit_ideation_source_active ON public.%I',t);
  EXECUTE format('CREATE POLICY cockpit_ideation_source_active ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING(public.cockpit_ideation_allowed())',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 END LOOP;
END $$;
COMMIT;
