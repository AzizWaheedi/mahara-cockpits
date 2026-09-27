BEGIN;
CREATE TABLE IF NOT EXISTS public.cockpit_media_source_state(
 table_name text PRIMARY KEY CHECK(table_name IN('inbox','clientLinks','clientComments','boardCards','offBoardCampaigns','manualChanges','adChanges','metaTree','clickupMembers','clientPrefs','feedback','syncRuns','onboardings','launchWatch','trackingIssues','marketPlays','campaignChat')),
 ready boolean NOT NULL DEFAULT false,row_count integer CHECK(row_count>=0),source_snapshot_at timestamptz
);
INSERT INTO public.cockpit_media_source_state(table_name) SELECT unnest(ARRAY['inbox','clientLinks','clientComments','boardCards','offBoardCampaigns','manualChanges','adChanges','metaTree','clickupMembers','clientPrefs','feedback','syncRuns','onboardings','launchWatch','trackingIssues','marketPlays','campaignChat']) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.cockpit_media_sources(
 table_name text NOT NULL REFERENCES public.cockpit_media_source_state(table_name),source_id text NOT NULL,
 client_names text[] NOT NULL DEFAULT '{}',data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 source_snapshot_at timestamptz NOT NULL,PRIMARY KEY(table_name,source_id),CHECK(data ? '_id' AND data->>'_id'=source_id)
);
ALTER TABLE public.cockpit_media_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_media_source_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_media_sources,public.cockpit_media_source_state FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_media_sources,public.cockpit_media_source_state TO service_role;
CREATE OR REPLACE FUNCTION public.cockpit_media_source_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW;END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
 VALUES(TG_OP,TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'source_id',to_jsonb(NEW)->>'table_name'),'source-import','media-buyer','supabase',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS cockpit_media_sources_audit ON public.cockpit_media_sources;
CREATE TRIGGER cockpit_media_sources_audit AFTER INSERT OR UPDATE ON public.cockpit_media_sources FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_source_audit();
DROP TRIGGER IF EXISTS cockpit_media_source_state_audit ON public.cockpit_media_source_state;
CREATE TRIGGER cockpit_media_source_state_audit AFTER INSERT OR UPDATE ON public.cockpit_media_source_state FOR EACH ROW EXECUTE FUNCTION public.cockpit_media_source_audit();

CREATE OR REPLACE FUNCTION public.cockpit_media_source_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE seat public.cockpit_members; feed record; result jsonb:='{}'; provenance jsonb:='{}'; rows jsonb; unrestricted boolean;
BEGIN
 IF NOT(public.cockpit_has_role('media_buyer') OR public.cockpit_has_role('admin') OR public.cockpit_is_ceo()) THEN RAISE EXCEPTION 'Verified media-buyer access required' USING ERRCODE='42501';END IF;
 SELECT * INTO seat FROM public.cockpit_members WHERE auth_user_id=auth.uid();
 unrestricted:=cardinality(seat.clients)=0 OR 'admin'=ANY(seat.roles) OR public.cockpit_is_ceo();
 IF (SELECT count(*) FROM public.cockpit_media_source_state)<>17 THEN RAISE EXCEPTION 'Media source configuration is incomplete';END IF;
 FOR feed IN SELECT * FROM public.cockpit_media_source_state LOOP
  IF NOT feed.ready OR feed.source_snapshot_at IS NULL OR feed.row_count IS NULL OR feed.row_count<>(SELECT count(*) FROM public.cockpit_media_sources WHERE table_name=feed.table_name AND source_snapshot_at=feed.source_snapshot_at) THEN
   RAISE EXCEPTION 'Media source % is not imported and verified yet',feed.table_name;END IF;
  SELECT coalesce(jsonb_agg(safe.data ORDER BY safe.at),'[]'::jsonb) INTO rows FROM (
   SELECT CASE
    WHEN feed.table_name='clientComments' THEN jsonb_build_object('_id',s.source_id,'taskId',s.data->'taskId','clientName',s.data->'clientName','at',s.data->'at','kind',s.data->'kind','status',s.data->'status',
      'digest',jsonb_build_object('forAds',coalesce((SELECT jsonb_agg(item) FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(s.data->'digest'->'forAds')='array' THEN s.data->'digest'->'forAds' ELSE '[]'::jsonb END) AS item
       WHERE item!~* 'contract|payment|paid|deposit|invoice|revenue|signed|\mfees?\M'),'[]'::jsonb)))
    WHEN feed.table_name='syncRuns' THEN jsonb_build_object('_id',s.source_id,'at',s.data->'at','problems',s.data->'problems','health',s.data->'health')
    WHEN feed.table_name='clickupMembers' THEN jsonb_build_object('_id',s.source_id,'id',s.data->'id','name',s.data->'name','username',s.data->'username')
    ELSE s.data END AS data,coalesce((s.data->>'at')::numeric,0) AS at
   FROM public.cockpit_media_sources s WHERE s.table_name=feed.table_name AND s.source_snapshot_at=feed.source_snapshot_at
    AND (feed.table_name IN('syncRuns','clickupMembers','marketPlays') OR unrestricted OR EXISTS(
     SELECT 1 FROM unnest(s.client_names) n JOIN unnest(seat.clients) c ON lower(btrim(n))=lower(btrim(c))
    ))
    AND (feed.table_name<>'syncRuns' OR s.source_id=(SELECT source_id FROM public.cockpit_media_sources WHERE table_name='syncRuns' AND source_snapshot_at=feed.source_snapshot_at ORDER BY (data->>'at')::numeric DESC LIMIT 1))
  ) safe;
  result:=result||jsonb_build_object(feed.table_name,rows);
  provenance:=provenance||jsonb_build_object(feed.table_name,jsonb_build_object('at',feed.source_snapshot_at,'rowCount',feed.row_count));
 END LOOP;
 RETURN jsonb_build_object('tables',result,'source',provenance);
END;$$;
REVOKE ALL ON FUNCTION public.cockpit_media_source_audit(),public.cockpit_media_source_read() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_source_read() TO authenticated;
COMMIT;
