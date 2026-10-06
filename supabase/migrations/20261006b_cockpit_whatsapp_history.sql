BEGIN;
CREATE TABLE public.cockpit_wa_thread_captures(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 source_app text NOT NULL CHECK(source_app IN('client-success','creative-director')),
 chat_id text NOT NULL,channel text NOT NULL,name text NOT NULL,client_name text,contact_id text NOT NULL,
 source text NOT NULL CHECK(source='ghl'),is_group boolean NOT NULL,unread integer CHECK(unread>=0),last_from_us boolean NOT NULL,
 silent_days double precision,draft text,draft_at timestamptz,recent jsonb NOT NULL CHECK(jsonb_typeof(recent)='array'),last_at timestamptz NOT NULL,
 waiting_since timestamptz,synced_at timestamptz,creation_time timestamptz NOT NULL,
 source_deployment text NOT NULL,source_id text NOT NULL,source_record jsonb NOT NULL CHECK(jsonb_typeof(source_record)='object'),
 UNIQUE(source_deployment,source_id),UNIQUE(source_app,chat_id)
);
CREATE TABLE public.cockpit_wa_draft_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 source_app text NOT NULL CHECK(source_app='media-buyer'),chat_id text NOT NULL,status text NOT NULL CHECK(status IN('done','queued','declined')),
 job_id text,draft text,at timestamptz NOT NULL,last_at timestamptz,creation_time timestamptz NOT NULL,
 source_deployment text NOT NULL,source_id text NOT NULL,source_record jsonb NOT NULL CHECK(jsonb_typeof(source_record)='object'),
 UNIQUE(source_deployment,source_id)
);
CREATE INDEX cockpit_wa_capture_subject ON public.cockpit_wa_thread_captures(chat_id,client_name);
CREATE INDEX cockpit_wa_capture_page ON public.cockpit_wa_thread_captures(source_app,last_at DESC,id DESC);
CREATE INDEX cockpit_wa_draft_page ON public.cockpit_wa_draft_history(at DESC,id DESC);
ALTER TABLE public.cockpit_wa_thread_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_wa_draft_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_wa_thread_captures,public.cockpit_wa_draft_history FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.cockpit_wa_thread_captures,public.cockpit_wa_draft_history TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.cockpit_wa_thread_captures_id_seq,public.cockpit_wa_draft_history_id_seq TO service_role;
CREATE TRIGGER cockpit_wa_capture_history_audit AFTER INSERT ON public.cockpit_wa_thread_captures FOR EACH ROW EXECUTE FUNCTION public.cockpit_audit_csm_state();
CREATE TRIGGER cockpit_wa_draft_history_audit AFTER INSERT ON public.cockpit_wa_draft_history FOR EACH ROW EXECUTE FUNCTION public.cockpit_audit_csm_state();

CREATE FUNCTION public.cockpit_wa_history(p_app text,p_kind text DEFAULT 'captures',p_before timestamptz DEFAULT NULL,p_before_id bigint DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.cockpit_members;full_scope boolean;source_app_name text;rows jsonb;
BEGIN
 IF p_app IS NULL OR p_app NOT IN('media-buyer','client-success','creative') OR NOT public.cockpit_ask_ai_owner_allowed(auth.uid(),p_app,NULL) THEN RAISE EXCEPTION 'Current confirmed cockpit access is required for history' USING ERRCODE='42501';END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_kind NOT IN('captures','drafts') OR ((p_before IS NULL)<>(p_before_id IS NULL)) THEN RAISE EXCEPTION 'Choose a valid history page';END IF;
 SELECT * INTO m FROM public.cockpit_members WHERE auth_user_id=auth.uid();
 full_scope:='admin'=ANY(m.roles) OR m.email IN('aziz@maharamedia.com','awaheedi2008@gmail.com') OR cardinality(m.clients)=0;
 source_app_name:=CASE p_app WHEN 'creative' THEN 'creative-director' ELSE p_app END;
 IF p_kind='captures' THEN
  IF p_app='media-buyer' THEN RAISE EXCEPTION 'This cockpit has no original thread captures';END IF;
  SELECT coalesce(jsonb_agg(value ORDER BY page_at DESC,page_id DESC),'[]') INTO rows FROM(
   SELECT jsonb_build_object('id',c.id,'chatId',c.chat_id,'contactId',c.contact_id,'name',c.name,'clientName',c.client_name,'channel',c.channel,'source','ghl','isGroup',c.is_group,'lastAt',c.last_at,'lastFromUs',c.last_from_us,'unread',c.unread,'draft',c.draft,'draftAt',c.draft_at,'recent',c.recent,'waitingSince',c.waiting_since,'silentDays',c.silent_days,'capturedAt',c.synced_at,'author',NULL,'deliveryConfirmed',false) value,c.last_at page_at,c.id page_id
   FROM public.cockpit_wa_thread_captures c WHERE c.source_app=source_app_name AND (p_before IS NULL OR (c.last_at,c.id)<(p_before,p_before_id))
    AND (full_scope OR (nullif(btrim(c.client_name),'') IS NOT NULL AND public.cockpit_ask_ai_owner_allowed(auth.uid(),p_app,c.client_name)))
   ORDER BY c.last_at DESC,c.id DESC LIMIT p_limit
  ) page;
 ELSE
  IF p_app<>'media-buyer' THEN RAISE EXCEPTION 'Original generated reply versions belong to the media-buyer cockpit';END IF;
  SELECT coalesce(jsonb_agg(value ORDER BY page_at DESC,page_id DESC),'[]') INTO rows FROM(
   SELECT jsonb_build_object('id',d.id,'chatId',d.chat_id,'clientName',matched.client_name,'draft',d.draft,'jobId',d.job_id,'generationStatus',d.status,'at',d.at,'lastAt',d.last_at,'author',NULL,'deliveryConfirmed',false,'mappingNote',CASE WHEN matched.client_name IS NULL THEN 'The original client mapping is missing or ambiguous.' END) value,d.at page_at,d.id page_id
   FROM public.cockpit_wa_draft_history d LEFT JOIN LATERAL(
    SELECT CASE WHEN count(DISTINCT lower(btrim(c.client_name)))=1 THEN min(c.client_name) END client_name FROM public.cockpit_wa_thread_captures c WHERE c.chat_id=d.chat_id AND nullif(btrim(c.client_name),'') IS NOT NULL
   ) matched ON true WHERE d.source_app='media-buyer' AND (p_before IS NULL OR (d.at,d.id)<(p_before,p_before_id))
    AND (full_scope OR (matched.client_name IS NOT NULL AND public.cockpit_ask_ai_owner_allowed(auth.uid(),p_app,matched.client_name)))
   ORDER BY d.at DESC,d.id DESC LIMIT p_limit
  ) page;
 END IF;
 RETURN jsonb_build_object('rows',rows,'source','Original cockpit captures. Text may already be clipped. History cannot send messages.','replayAllowed',false);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_wa_history(text,text,timestamptz,bigint,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_wa_history(text,text,timestamptz,bigint,integer) TO authenticated;
COMMIT;
